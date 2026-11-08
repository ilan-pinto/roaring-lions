/**
 * @vitest-environment jsdom
 *
 * GH-943 P2 (T3) gates for the node ground (`mesh.node.ts`). The twin is compiled on a ground-shaped mesh by three's own
 * `GLSLNodeBuilder` (no GPU), so these read the real generated shader. Each has a one-line falsification, run by hand and listed in
 * the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GroundMaterial, GROUND_SLOTS, slotUniforms } from './mesh';
import { MATERIAL_MATHS } from '../material-maths';
import { buildNodeGround, GROUND_RELIEF_TERM, GROUND_WET_TERM, NODE_GROUND_MATERIAL_NAME, type NodeGround } from './mesh.node';
import { assertNoImplicitSampleInConditional } from '../sample-uniformity';
import { censusUnported } from '../backend/unported';

// jsdom has no ImageBitmap; three's texture-node update tests `image instanceof ImageBitmap` (never true for these DataTextures).
(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

interface Uniform {
  readonly name: string;
  readonly node: { value: unknown; update?: (frame: unknown) => void };
}
interface Built {
  readonly frag: string;
  readonly vert: string;
  readonly ground: NodeGround;
  readonly mesh: THREE.Mesh;
  readonly used: readonly Uniform[];
  /** Runs every node update three would run for one render of this object. */
  readonly renderUpdate: () => void;
}

/** The attributes `toGeometry` gives a ground chunk (position, normal, colour, `wallAlbedo`, `groundUv`). */
function groundGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(0.5), 3));
  g.setAttribute('wallAlbedo', new THREE.BufferAttribute(new Float32Array([-1, -1, -1]), 1));
  g.setAttribute('groundUv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  return g;
}

async function compile(owner: GroundMaterial): Promise<Built> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ground = buildNodeGround({ W, TSL, maths: MATERIAL_MATHS.ground }, owner);
  const mesh = new THREE.Mesh(groundGeometry(), ground.material);
  const r = new W.WebGPURenderer({ forceWebGL: true });
  // The typings hide the builder's working members; this is the slice the test reads.
  const builder = new W.GLSLNodeBuilder(mesh, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { fragment: Uniform[] };
    updateNodes: Array<{ update(frame: unknown): void }>;
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = ground.material;
  builder.build();
  // What a NodeFrame hands every update: the camera, scene, renderer, object and material of this draw.
  const frame = { camera: builder.camera, scene: builder.scene, renderer: r, object: mesh, material: ground.material };
  const renderUpdate = (): void => {
    for (const n of builder.updateNodes) n.update(frame);
  };
  return { frag: builder.fragmentShader, vert: builder.vertexShader, ground, mesh, used: builder.uniforms.fragment, renderUpdate };
}

/**
 * The twin's WGSL fragment, from three's own `WGSLNodeBuilder`. There is no GPU here, so the renderer is never initialised: the
 * builder reads three facts from it (`hasFeature`, the backend's sample count and format for a texture, the device's features),
 * stubbed to an ordinary single-sampled device with no optional features. The texture filterability the builder decides on (whether
 * a sampler is declared, `textureSample` or `textureLoad`) comes from the textures themselves, which are the real ones.
 */
async function compileWgsl(owner: GroundMaterial): Promise<string> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ground = buildNodeGround({ W, TSL, maths: MATERIAL_MATHS.ground }, owner);
  const mesh = new THREE.Mesh(groundGeometry(), ground.material);
  const r = new W.WebGPURenderer({ forceWebGL: false });
  const stubbed = r as unknown as { hasFeature(): boolean; backend: Record<string, unknown> };
  stubbed.hasFeature = () => false;
  stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
  stubbed.backend.device = { features: new Set<string>() };
  const Builder = (W as unknown as { WGSLNodeBuilder: new (m: THREE.Mesh, r: unknown) => unknown }).WGSLNodeBuilder;
  const builder = new Builder(mesh, r) as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = ground.material;
  builder.build();
  return builder.fragmentShader;
}

/** `void main() { ... }` of a generated shader. */
const mainOf = (src: string): string => src.slice(src.indexOf('void main()'));

/** The top-level comma-separated arguments of the call that starts at `src[open]` (the `(`). */
function argsAt(src: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i] as string;
    if (c === '(') {
      depth++;
      if (depth === 1) continue;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        out.push(cur.trim());
        return out;
      }
    } else if (c === ',' && depth === 1) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  throw new Error('unterminated call');
}

const TEXTURE_NAMES = [...GROUND_SLOTS.map((s) => slotUniforms(s).map), 'uControlA', 'uControlB', 'uMacro'];

describe('the node ground graph', () => {
  it('is named as a node twin and draws the legacy material flat: roughness 1, metalness 0, DoubleSide, no envMap, no vertexColors', async () => {
    const { ground } = await compile(new GroundMaterial());
    const m = ground.material as THREE.MeshStandardMaterial;
    expect(m.name).toBe(NODE_GROUND_MATERIAL_NAME);
    expect(m.name.startsWith('rl-node-material-')).toBe(true);
    expect([m.roughness, m.metalness, m.side, m.envMap, m.vertexColors]).toEqual([1, 0, THREE.DoubleSide, null, false]);
  });

  it('samples all five slots, both controls and the macro (each legacy texture is a sampler the shader reads)', async () => {
    const owner = new GroundMaterial();
    const { frag, used } = await compile(owner);
    const body = mainOf(frag);
    for (const name of TEXTURE_NAMES) {
      const tex = owner.uniforms[name]?.value;
      const u = used.find((x) => x.node.value === tex);
      expect(u, `${name}: no sampler uniform holds the legacy texture`).toBeDefined();
      expect(body, `${name} (${u?.name}) is never sampled`).toMatch(new RegExp(`\\btexture(Grad)?\\( ${u?.name},`));
    }
    // Eight distinct samplers, and the vertex stage feeds the two ground attributes.
    expect(new Set(used.filter((x) => (x.node.value as THREE.Texture | null)?.isTexture === true).map((x) => x.name)).size).toBe(8);
  });

  it('reads both ground attributes in the vertex stage', async () => {
    const { vert } = await compile(new GroundMaterial());
    expect(vert).toMatch(/\bin float wallAlbedo;/);
    expect(vert).toMatch(/\bin vec2 groundUv;/);
  });

  it('the road grain tap is a textureGrad on the KNOLL sampler, its two derivatives assigned before any if in main', async () => {
    const owner = new GroundMaterial();
    const { frag, used } = await compile(owner);
    const body = mainOf(frag);
    const knoll = used.find((x) => x.node.value === owner.uniforms.uKnoll?.value);
    expect(knoll).toBeDefined();
    const grads = [...body.matchAll(/\btextureGrad\(/g)];
    expect(grads, 'exactly one explicit-gradient tap (the road grain)').toHaveLength(1);
    const at = (grads[0] as RegExpMatchArray).index as number;
    const [sampler, , dx, dy] = argsAt(body, at + 'textureGrad'.length);
    expect(sampler).toBe(knoll?.name);
    const firstIf = body.search(/\bif \(/);
    expect(firstIf, 'the graph has selects, so main has an if (non-vacuous)').toBeGreaterThan(0);
    for (const [arg, fn] of [[dx, 'dFdx'], [dy, 'dFdy']] as const) {
      expect(arg, `${fn} argument is a variable`).toMatch(/^nodeVar\d+$/);
      const assign = new RegExp(`\\b${arg} = ${fn}\\( (nodeVar\\d+) \\);`).exec(body);
      expect(assign, `${arg} is assigned ${fn}(...)`).not.toBeNull();
      expect((assign as RegExpExecArray).index, `${arg} = ${fn}(...) comes before the first if`).toBeLessThan(firstIf);
      // ...of the grain uv: the world xz over the grain repeat, also assigned before any if.
      const uv = (assign as RegExpExecArray)[1] as string;
      const uvAssign = new RegExp(`\\b${uv} = \\( v_positionWorld\\.xz / `).exec(body);
      expect(uvAssign, `${uv} is the world-xz grain uv`).not.toBeNull();
      expect((uvAssign as RegExpExecArray).index).toBeLessThan(firstIf);
    }
  });

  it('has no implicit-gradient sample inside a conditional (the checker in sample-uniformity.test.ts is falsified on a fixture)', async () => {
    const { frag } = await compile(new GroundMaterial());
    expect(() => assertNoImplicitSampleInConditional(frag)).not.toThrow();
  });
});

describe('the node ground on WGSL (the CI wgpu arm refused this as a GPU validation error before the white pixel was filterable)', () => {
  it('declares a sampler for every sampler it reads, samples every tap filtered, the grain with textureSampleGrad', async () => {
    const wgsl = await compileWgsl(new GroundMaterial());
    const declared = new Set([...wgsl.matchAll(/var (\w+_sampler) : sampler;/g)].map((m) => m[1]));
    const read = new Set([...wgsl.matchAll(/\btexture\w*\( \w+, (\w+_sampler),/g)].map((m) => m[1]));
    expect(read.size, 'the fragment samples (non-vacuous)').toBeGreaterThan(0);
    expect([...read].filter((n) => !declared.has(n)), 'a sampler read but never declared').toEqual([]);
    expect(wgsl, 'an unfiltered load: a texture bound at build was unfilterable').not.toMatch(/\btextureLoad\(/);
    expect(read.size, 'eight filtered samplers: five slots, two controls, the macro').toBe(8);
    expect(wgsl.match(/\btextureSampleGrad\(/g), 'the road grain').toHaveLength(1);
    expect(() => assertNoImplicitSampleInConditional(wgsl)).not.toThrow();
  });
});

describe('the record drives the twin', () => {
  it('setRoadsVisible(false) reaches the road uniform on the next render update', async () => {
    const owner = new GroundMaterial();
    // A sentinel "on" value, so a uniform bound BY VALUE at build time is visible among the used ones.
    (owner.uniforms.uRoadOn as { value: unknown }).value = 0.625;
    const { ground, used, renderUpdate } = await compile(owner);
    expect(used.some((u) => u.node.value === 0.625), 'the sentinel is bound (non-vacuous)').toBe(true);
    owner.setRoadsVisible(false);
    renderUpdate();
    expect(used.filter((u) => u.node.value === 0.625).map((u) => u.name), 'a uniform still holds the build-time value').toEqual([]);
    expect(ground.numbers.uRoadOn?.value).toBe(0);
  });

  it('a slot image that lands after the build is the texture the twin samples', async () => {
    const owner = new GroundMaterial();
    const { ground, used, renderUpdate } = await compile(owner);
    const before = owner.uniforms.uKnoll?.value;
    const landed = new THREE.DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
    (owner.uniforms.uKnoll as { value: unknown }).value = landed;
    (owner.uniforms.uKnollMean as { value: unknown }).value = new THREE.Vector3(0.1, 0.2, 0.3);
    renderUpdate();
    for (const t of ground.textures.uKnoll ?? []) expect(t.value).toBe(landed);
    expect(used.some((u) => u.node.value === landed), 'a sampler holds the landed image').toBe(true);
    expect(used.some((u) => u.node.value === before), 'no sampler still holds the white pixel').toBe(false);
    expect((ground.numbers.uKnollMean?.value as THREE.Vector3).toArray()).toEqual([0.1, 0.2, 0.3]);
    // ...and a control rebind (a collapse rebuild) lands the same way.
    const ctl = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    (owner.uniforms.uControlB as { value: unknown }).value = ctl;
    renderUpdate();
    expect(used.some((u) => u.node.value === ctl)).toBe(true);
  });
});

describe('a wet owner', () => {
  it('compiles the dry graph, byte for byte', async () => {
    const dry = await compile(new GroundMaterial());
    const wet = await compile(new GroundMaterial({ wet: true }));
    expect(wet.frag).toBe(dry.frag);
    expect(wet.vert).toBe(dry.vert);
  });

  it('is named by the census: the wet terms and the relief read, as partial hooks; a dry owner names the relief read only', async () => {
    const wet = await compile(new GroundMaterial({ wet: true }));
    const dry = await compile(new GroundMaterial());
    const partial = (mesh: THREE.Mesh): string[] =>
      censusUnported(mesh)
        .filter((h) => h.kind === 'partial')
        .map((h) => h.key);
    expect(partial(wet.mesh)).toEqual([GROUND_RELIEF_TERM, GROUND_WET_TERM].sort());
    expect(partial(dry.mesh)).toEqual([GROUND_RELIEF_TERM]);
    // The twin itself carries no GLSL hook: nothing but the partial terms is reported.
    expect(censusUnported(dry.mesh).filter((h) => h.kind !== 'partial')).toEqual([]);
  });
});
