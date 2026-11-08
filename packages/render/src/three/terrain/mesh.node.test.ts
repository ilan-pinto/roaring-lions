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
import { buildNodeGround, GROUND_WET_TERM, NODE_GROUND_MATERIAL_NAME, type NodeGround } from './mesh.node';
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

async function compile(owner: GroundMaterial, maths = MATERIAL_MATHS.ground, lit = false): Promise<Built> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ground = buildNodeGround({ W, TSL, maths }, owner);
  const mesh = new THREE.Mesh(groundGeometry(), ground.material);
  const r = new W.WebGPURenderer({ forceWebGL: true });
  // The typings hide the builder's working members; this is the slice the test reads.
  const builder = new W.GLSLNodeBuilder(mesh, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    lightsNode: unknown;
    build(): void;
    uniforms: { fragment: Uniform[] };
    updateNodes: Array<{ update(frame: unknown): void }>;
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = ground.material;
  // LIT (opt-in, the relief tests): the lighting normal is only built when the scene has a light (an unlit build never reads
  // `normalNode`). A lit build adds the standard material's own BRDF lookup, a ninth sampler, so the sampler-count gates stay unlit.
  if (lit) builder.lightsNode = new W.LightsNode().setLights([new THREE.DirectionalLight()]);
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
async function compileWgsl(owner: GroundMaterial, lit = false): Promise<string> {
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
    lightsNode: unknown;
    build(): void;
    fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = ground.material;
  if (lit) builder.lightsNode = new W.LightsNode().setLights([new THREE.DirectionalLight()]);
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

describe('the twin wires its taps and record into the shared composition (ground-maths.test.ts evaluates the composition)', () => {
  it('hands groundBlend the right texture, channel and uniform in every slot', async () => {
    const owner = new GroundMaterial();
    type Split = { node?: { value?: unknown }; components?: string };
    let seen: { taps: Record<string, unknown>; knobs: Record<string, unknown>; range: number } | null = null;
    const maths = {
      ...MATERIAL_MATHS.ground,
      groundBlend: ((o, v, range, taps, knobs) => {
        seen = { taps: taps as never, knobs: knobs as never, range };
        return MATERIAL_MATHS.ground.groundBlend(o, v, range, taps, knobs);
      }) as typeof MATERIAL_MATHS.ground.groundBlend,
    };
    // The colour graph is a `Fn`: its body (and the call) runs when the material is built.
    const { ground } = await compile(owner, maths);
    expect(seen).not.toBeNull();
    const got = seen as unknown as { taps: Record<string, unknown>; knobs: Record<string, unknown>; range: number };
    const tex = (name: string): unknown => owner.uniforms[name]?.value;
    /** `node.components` of a swizzle, and the texture its tap samples. */
    const read = (x: unknown): [string | undefined, unknown] => [(x as Split).components, (x as Split).node?.value];
    const chans = (xs: unknown, name: string): void => {
      const list = (xs as unknown[]).map(read);
      // A swizzle is spelled `r`/`g`/`b`/`a` or `x`/`y`/`z`/`w`: normalise to rgba.
      const norm = list.map(([c]) => (c ?? '').replace('x', 'r').replace('y', 'g').replace('z', 'b').replace('w', 'a'));
      expect(norm, name).toEqual(['r', 'g', 'b', 'a']);
      for (const [, t] of list) expect(t === tex(name), `${name}: a channel from another texture`).toBe(true);
    };
    chans(got.taps.controlA, 'uControlA');
    chans(got.taps.controlB, 'uControlB');
    const slotNames = GROUND_SLOTS.map((sl) => slotUniforms(sl));
    (got.taps.slotTexels as unknown[]).forEach((x, i) => {
      expect(read(x)[1] === tex((slotNames[i] as { map: string }).map), `slot ${i} samples its own image`).toBe(true);
    });
    expect(read(got.taps.grainTexel)[1] === tex('uKnoll'), 'the grain samples the knoll image').toBe(true);
    expect(read(got.taps.macroTexel)[1] === tex('uMacro'), 'the macro byte is the macro field').toBe(true);
    const n = ground.numbers;
    (got.knobs.strengths as unknown[]).forEach((x, i) => expect(x === n[(slotNames[i] as { strength: string }).strength], `strength ${i}`).toBe(true));
    (got.knobs.means as unknown[]).forEach((x, i) => expect(x === n[(slotNames[i] as { mean: string }).mean], `mean ${i}`).toBe(true));
    const knob: Record<string, string> = {
      grainMean: 'uKnollMean', roadOn: 'uRoadOn', grainGain: 'uRoadGrainGain', roadTone: 'uRoadTone', shoulderTone: 'uShoulderTone',
      rutTone: 'uRutTone', macroAmp: 'uMacroAmp', macroBright: 'uMacroBright', macroDark: 'uMacroDark',
    };
    for (const [k, u] of Object.entries(knob)) expect(got.knobs[k] === n[u], `${k} is ${u}`).toBe(true);
    expect(got.range).toBe(1);
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

  it('is named by the census: the wet terms, as a partial hook; a dry owner names nothing (the relief read landed in T4)', async () => {
    const wet = await compile(new GroundMaterial({ wet: true }));
    const dry = await compile(new GroundMaterial());
    const partial = (mesh: THREE.Mesh): string[] =>
      censusUnported(mesh)
        .filter((h) => h.kind === 'partial')
        .map((h) => h.key);
    expect(partial(wet.mesh)).toEqual([GROUND_WET_TERM]);
    expect(partial(dry.mesh)).toEqual([]);
    // The twin itself carries no GLSL hook: nothing but the partial terms is reported.
    expect(censusUnported(dry.mesh).filter((h) => h.kind !== 'partial')).toEqual([]);
  });
});

describe('the relief read (T4): slope light, height contours and tint', () => {
  it('the contour screen rate is a derivative taken before any if in main, on the world height in levels', async () => {
    const { frag } = await compile(new GroundMaterial(), MATERIAL_MATHS.ground, true);
    const body = mainOf(frag);
    const firstIf = body.search(/\bif \(/);
    const rate = /\b(nodeVar\d+) = fwidth\( [^;]*\);/.exec(body);
    expect(rate, 'a variable assigned fwidth(...)').not.toBeNull();
    expect((rate as RegExpExecArray).index, 'fwidth(...) comes before the first if').toBeLessThan(firstIf);
    expect(body.match(/\bfwidth\(/g), 'one derivative, the contour rate').toHaveLength(1);
  });

  it('on WGSL the contour rate is taken in uniform control flow too (before the first if in main)', async () => {
    const wgsl = await compileWgsl(new GroundMaterial(), true);
    expect(() => assertNoImplicitSampleInConditional(wgsl)).not.toThrow();
    const body = wgsl.slice(wgsl.indexOf('fn main('));
    const at = body.search(/\bfwidth\(/);
    expect(at, 'the WGSL fragment takes a fwidth').toBeGreaterThan(-1);
    expect(at, 'fwidth(...) comes before the first if').toBeLessThan(body.search(/\bif \(/));
  });

  it('the lighting normal is replaced: the 38 degree ceiling is in the fragment, and the tilt reads the shared gain uniform', async () => {
    const owner = new GroundMaterial();
    const { frag } = await compile(owner, MATERIAL_MATHS.ground, true);
    // 38 degrees in radians, the legacy GLSL's literal (`RELIEF_FRAGMENT_GLSL`), to five places.
    expect(frag).toMatch(/0\.6632[0-9]*/);
    expect(frag.match(/\batan\(/g)?.length ?? 0, 'two arc tangents: the tilt and the exaggerated tilt').toBeGreaterThanOrEqual(2);
  });

  it('setSlopeLightVisible(false) and setHeightContoursVisible(false) reach the twin on the next render update; the median follows', async () => {
    const owner = new GroundMaterial();
    const u = owner.uniforms as Record<string, { value: unknown }>;
    // Sentinels, so a uniform bound BY VALUE at build is visible among the used ones.
    u.uReliefSlopeGain!.value = 7.5;
    u.uReliefContour!.value = 0.375;
    u.uReliefTint!.value = 0.3125;
    const { ground, used, renderUpdate } = await compile(owner, MATERIAL_MATHS.ground, true);
    for (const v of [7.5, 0.375, 0.3125]) expect(used.some((x) => x.node.value === v), `sentinel ${v} bound (non-vacuous)`).toBe(true);
    owner.setSlopeLightVisible(false);
    owner.setHeightContoursVisible(false);
    owner.setReliefMedianLevel(3);
    renderUpdate();
    for (const v of [7.5, 0.375, 0.3125]) expect(used.filter((x) => x.node.value === v).map((x) => x.name), `a uniform still holds ${v}`).toEqual([]);
    expect([ground.numbers.uReliefSlopeGain?.value, ground.numbers.uReliefContour?.value, ground.numbers.uReliefTint?.value]).toEqual([1, 0, 0]);
    expect(ground.numbers.uReliefMedianY?.value).toBe(u.uReliefMedianY?.value);
    expect(ground.numbers.uReliefMedianY?.value).not.toBe(0);
    owner.setSlopeLightVisible(true);
    renderUpdate();
    expect(ground.numbers.uReliefSlopeGain?.value).toBe(7.5);
  });
});

describe('the relief read GRAPH wiring, gated on the lit fragment text (R12: each input, each mutation named)', () => {
  const one = (re: RegExp, text: string, what: string): RegExpExecArray => {
    const m = re.exec(text);
    expect(m, what).not.toBeNull();
    return m as RegExpExecArray;
  };

  it('the tint end is chosen by the SIGN of the ramp: LOW under t < 0, HIGH otherwise, on the ramp variable itself', async () => {
    // Falsify: `select(ramp.t.lessThan(0), high, low)` (swapped ends).
    const { frag } = await compile(new GroundMaterial(), MATERIAL_MATHS.ground, true);
    const ramp = one(/(\w+) = clamp\( \( \( \w+ - \( \w+ \/ \w+ \) \) \/ 4\.0 \), -1\.0, 1\.0 \);/, frag, 'the tint ramp: clamp((levels - median) / 4, -1, 1)');
    const sel = one(/if \( \( (\w+) < 0\.0 \) \) \{\s*\w+ = vec3\( 0\.88, 0\.9, 0\.94 \);\s*\} else \{\s*\w+ = vec3\( 1\.07, 1\.05, 1\.02 \);/, frag, 'LOW under t < 0, HIGH in the else');
    expect(sel[1], 'the select tests the ramp variable').toBe(ramp[1]);
  });

  it('the normal pass-through: h < 1e-6 keeps the (face-flipped) normal, y <= 0 keeps it too, the tilt is the other branch', async () => {
    // Falsify: `select(h.lessThan(1e-6), tilted, tilted)` (no pass-through), or the outer select's else made the tilted normal.
    const { frag } = await compile(new GroundMaterial(), MATERIAL_MATHS.ground, true);
    const n = one(/(\w+) = \( normalWorldGeometry \* vec3\( \( \( float\( gl_FrontFacing \) \* 2\.0 \) - 1\.0 \) \) \);/, frag, 'the face-flipped world normal');
    const outer = one(/if \( \( (\w+)\.y > 0\.0 \) \) \{/, frag, 'the y > 0 test');
    expect(outer[1], 'y is the flipped normal\'s').toBe(n[1]);
    const inner = one(/if \( \( \w+ < 0\.000001 \) \) \{\s*(\w+) = (\w+);\s*\} else \{[^}]*\bvec3\( \( \w+\.x \* \w+ \), cos\( \w+ \), \( \w+\.z \* \w+ \) \);/, frag, 'h < 1e-6 -> pass-through, else the tilted vec3');
    expect(inner[2], 'the pass-through branch assigns the untilted normal').toBe(n[1]);
    const elseBranch = one(/\} else \{\s*(\w+) = (\w+);\s*\}\s*(?:\w+ = normalize\( \( cameraViewMatrix)/, frag, 'y <= 0 -> the untilted normal');
    expect(elseBranch[2]).toBe(n[1]);
  });

  it('the relief term is masked by `top` (step(wallAlbedo, -0.5)): a wall takes none', async () => {
    // Falsify: `reliefTerm = tint.mul(line)` (mask dropped).
    const { frag } = await compile(new GroundMaterial(), MATERIAL_MATHS.ground, true);
    const top = one(/(\w+) = step\( \w+, -0\.5 \);/, frag, 'top = step(wallAlbedo, -0.5)');
    expect(frag, 'the final mix(1, tint*line, top)').toMatch(
      new RegExp(`mix\\( vec3\\( 1\\.0, 1\\.0, 1\\.0 \\), \\( mix\\( vec3\\( 1\\.0, 1\\.0, 1\\.0 \\), \\w+, \\( abs\\( \\w+ \\) \\* \\w+ \\) \\) \\* vec3\\( \\( 1\\.0 - \\(.*?\\) \\) \\) \\), ${top[1]} \\)`)
    );
  });

  it('a back face flips the normal (gl_FrontFacing reaches the tilt)', async () => {
    // Falsify: drop `.mul(TSL.faceDirection)`.
    const { frag } = await compile(new GroundMaterial(), MATERIAL_MATHS.ground, true);
    expect(frag).toMatch(/normalWorldGeometry \* vec3\( \( \( float\( gl_FrontFacing \) \* 2\.0 \) - 1\.0 \) \)/);
  });
});
