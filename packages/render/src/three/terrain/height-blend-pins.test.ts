/**
 * @vitest-environment jsdom
 *
 * GH-1226 S3: the pins that prove the LEGACY (WebGL2) ground and decal, and the node ground's no-record graph, are unchanged by the
 * height blend (design 2026-11-12-gh1226-height-blend-design.md section 3.6, pins L2, L4 and N1). Landed BEFORE any drawing code.
 *
 * Every digest below is a LITERAL, captured on origin/main 3a5590b95 (three r{@link THREE_REVISION_PINNED}) by `digestOf` on the text
 * the program is built from. Nothing here recomputes its right-hand side from the code under test. A red digest means the program text
 * moved: if that is the height blend, it is a defect (the blend is node-path only and adds no legacy uniform, define, anchor or key);
 * if it is a deliberate change to the ground or decal, recapture from the failure message in the commit that makes it, and say why.
 *
 * Each pin's falsification is in the commit message: L2, adding `uniform float uHeightBlendAmp;` to `GROUND_VARYINGS_GLSL` (or a uniform
 * to `groundUniforms()`); L4, a `uniform sampler2D uHeightBlendField;` line in the decal fragment shader; N1, building any extra
 * node (the `amp` 0 stage) into `buildNodeGround`'s no-record path.
 *
 * Theme is not a program input on the legacy ground: `arid`, `green`, `highland` and `wetland` differ only in uniform VALUES and the
 * tones the renderer writes, so the programs are the dry one and the wet ones (full, lite, minimal tier). The theme-free constructor
 * is itself part of what is pinned (`new GroundMaterial()` takes no tones).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GroundMaterial } from './mesh';
import { compiledLegacy, digestOf, LEGACY_GROUND, programOf } from './height-blend-pins.support';
import { buildNodeGround } from './mesh.node';
import { MATERIAL_MATHS } from '../material-maths';
import { createDecalMaterial, DECAL_FRAGMENT_SHADER, DECAL_FRAGMENT_SHADER_WET } from '../decal-pool';

// jsdom has no ImageBitmap; three's texture-node update tests `image instanceof ImageBitmap` (never true for these DataTextures).
(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const THREE_REVISION_PINNED = '186';

describe('the pins were captured on the three revision they name', () => {
  it('three.REVISION is the one the literals below were captured on (an upgrade moves every digest: recapture them, as one commit)', () => {
    expect(THREE.REVISION).toBe(THREE_REVISION_PINNED);
  });
});

// -- L2: the legacy ground program ---------------------------------------------------------------------------------------------------

describe('L2: the legacy ground program (dry and every wet tier) is main\'s, digest for digest', () => {
  it('the table names all four programs (a pin over zero programs passes vacuously)', () => {
    expect(Object.keys(LEGACY_GROUND)).toEqual(['dry', 'wet full', 'wet lite', 'wet minimal']);
  });
  it.each(Object.keys(LEGACY_GROUND))('%s: vertex, fragment, uniform names, defines and cache key', (name) => {
    const { make, pin } = LEGACY_GROUND[name] as (typeof LEGACY_GROUND)[string];
    const m = make();
    const c = compiledLegacy(m);
    expect(c.fragmentShader.length, 'the injection ran: a no-op onBeforeCompile would leave three\'s stock source').toBeGreaterThan(THREE.ShaderChunk.meshphysical_frag.length);
    expect(programOf(m)).toEqual(pin);
  });
});

// -- L4: the legacy decal program ----------------------------------------------------------------------------------------------------

const DECAL_PALETTE = Object.fromEntries(
  ['craterBowl', 'craterLip', 'scorch', 'oil', 'rubbleA', 'rubbleB', 'tread', 'tyre'].map((k) => [k, '#808080'])
) as never;

describe('L4: the legacy decal program is main\'s', () => {
  it.each([
    ['dry', createDecalMaterial(DECAL_PALETTE)],
    ['wet', createDecalMaterial(DECAL_PALETTE, undefined, { uWetSky: { value: new THREE.Vector3() }, uPuddleReflect: { value: 0 } })],
  ] as const)('%s: vertex, fragment, uniform names and defines', (name, m) => {
    expect({
      defines: m.defines,
      vertex: digestOf(m.vertexShader),
      fragment: digestOf(m.fragmentShader),
      uniforms: digestOf(Object.keys(m.uniforms).sort().join(',')),
    }).toEqual(DECAL_PINS[name]);
  });
  it('the exported shader constants are the ones the material compiles (the digests above are over the shipped text)', () => {
    expect(createDecalMaterial(DECAL_PALETTE).fragmentShader).toBe(DECAL_FRAGMENT_SHADER);
    expect(DECAL_FRAGMENT_SHADER_WET.length).toBeGreaterThan(DECAL_FRAGMENT_SHADER.length);
  });
});

const DECAL_PINS: Record<'dry' | 'wet', { defines: unknown; vertex: string; fragment: string; uniforms: string }> = {
  dry: {
    defines: {},
    vertex: '8a87e765903a3a6ed10fca557918b1217114c1dcfab349ba6e8ec1d0b87c6a66:1199',
    fragment: 'e90821deaf672fbe31419a9baf982f2098095e0629d129f969387a9fa7b20010:9296',
    uniforms: '81bca1376fb849126953aa7cbda35fbb75d32748844a716d5b7f15d8498e9815:434',
  },
  wet: {
    defines: { DECAL_WET: '' },
    vertex: '8a87e765903a3a6ed10fca557918b1217114c1dcfab349ba6e8ec1d0b87c6a66:1199',
    fragment: 'e8e4678ee098b46e9c0416a4a318e715cac24be99ff0252bdbce31655b0622b5:9802',
    uniforms: 'f0f060f71c4635e07dc369ce3e9088bfc0183b0756bdb88524629bf8a5136f24:457',
  },
};

// -- N1: the node ground without a record --------------------------------------------------------------------------------------------

interface Uniform {
  readonly name: string;
  readonly node: unknown;
}

function groundGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(0.5), 3));
  g.setAttribute('wallAlbedo', new THREE.BufferAttribute(new Float32Array([-1, -1, -1]), 1));
  g.setAttribute('groundUv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  return g;
}

/** The node ground twin's GLSL (F) fragment and vertex, from three's own `GLSLNodeBuilder` (no GPU). */
async function nodeGlsl(owner: GroundMaterial, lit: boolean): Promise<{ frag: string; vert: string }> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ground = buildNodeGround({ W, TSL, maths: MATERIAL_MATHS.ground }, owner);
  const mesh = new THREE.Mesh(groundGeometry(), ground.material);
  const r = new W.WebGPURenderer({ forceWebGL: true });
  const builder = new W.GLSLNodeBuilder(mesh, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    lightsNode: unknown;
    build(): void;
    uniforms: { fragment: Uniform[] };
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = ground.material;
  if (lit) builder.lightsNode = new W.LightsNode().setLights([new THREE.DirectionalLight()]);
  builder.build();
  return { frag: builder.fragmentShader, vert: builder.vertexShader };
}

/** The twin's WGSL fragment, from three's own `WGSLNodeBuilder` with the renderer facts stubbed to an ordinary single-sampled device. */
async function nodeWgsl(owner: GroundMaterial, lit: boolean): Promise<string> {
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

const N1_PINS = {
  glslFrag: '1c72a38d88297e237683488d3d12514a118dee1c49dd204389d0891029aa8872:12251',
  glslVert: 'c3eab662955e76b2da6cacf92dea588a5394ef3ab1df113145a24a132dfd702c:2963',
  glslFragLit: 'da67987595eb1ccbcd1cd63d3b0ec5bef53c84dac2bb67e0194179bfc4635d92:24408',
  wgslFrag: '238e25d2a9dbc361e513b296156c37eeb7d787f90a122a09f364acc0ef99f827:12013',
  wgslFragLit: '84282e6be03c3c8ec71dcd7b25ab17c16fa5722ed1da3595ba07e034a3677b21:27154',
};

describe('N1: the node ground graph with no height-blend record is main\'s, in GLSL (F) and WGSL, dry and lit', () => {
  it.each([
    ['a dry owner', () => new GroundMaterial()],
    ['a wet owner (the wet terms are unported: it gets the dry graph, byte for byte)', () => new GroundMaterial({ wet: true })],
  ])('%s', async (_name, make) => {
    const g = await nodeGlsl(make(), false);
    const gl = await nodeGlsl(make(), true);
    expect({
      glslFrag: digestOf(g.frag),
      glslVert: digestOf(g.vert),
      glslFragLit: digestOf(gl.frag),
      wgslFrag: digestOf(await nodeWgsl(make(), false)),
      wgslFragLit: digestOf(await nodeWgsl(make(), true)),
    }).toEqual(N1_PINS);
  });
});
