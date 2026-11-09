/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T7) gates for `decal-pool.node.ts`: the decal pools' node twin. The graph is compiled by three's own `GLSLNodeBuilder`
 * and `WGSLNodeBuilder` (no GPU) on a REAL `DecalPool` mesh, adopted through the real `adoptMaterials`. Each spec names its
 * one-line falsification, run by hand and listed in the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MATERIAL_MATHS } from './material-maths';
import { NUMBER_OPS } from './fog-ops';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from './node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from './backend/unported';
import { assertNoImplicitSampleInConditional } from './sample-uniformity';
import {
  createDecalMaterial,
  DecalPool,
  setDecalLights,
  DECAL_LIGHTS_KEY,
  type DecalGroundUniforms,
  type DecalLights,
  type DecalPalette,
} from './decal-pool';
import { DECAL_PERSISTENT_RENDER_ORDER, DECAL_FADING_RENDER_ORDER } from './units/render-order';
import { defaultControlB } from './terrain/mesh';
import { isTwin } from './twin-identity';
import type { DecalRimLights } from './decal-maths';
import { buildNodeDecal, createNodeDecalMaterial, DECAL_WET_TERM, NODE_DECAL_MATERIAL_NAME, type NodeDecal } from './decal-pool.node';

// jsdom has no ImageBitmap; three's texture-node update tests `image instanceof ImageBitmap`.
(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const PALETTE: DecalPalette = {
  craterBowl: '#14150F',
  craterLip: '#E6D8BE',
  scorch: '#14150F',
  oil: '#23241F',
  rubbleA: '#A28C6E',
  rubbleB: '#75624A',
  tread: '#8F9464',
  tyre: '#C8B494',
};

interface Scene {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly lights: DecalLights;
}

/** A sun, a sky and one ambient light, each with a matrix (the twin reads their world positions). */
function sceneLights(): Scene {
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.5, 0.25), 2);
  sun.position.set(-3, 5, 4);
  sun.castShadow = true;
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.2, 0.2, 0.2), new THREE.Color(0.1, 0.1, 0.1), 1);
  hemi.updateMatrixWorld();
  const ambient = new THREE.AmbientLight(new THREE.Color(0.05, 0.05, 0.05), 1);
  return { sun, hemi, ambient, lights: { sun, hemisphere: hemi, ambient: [ambient] } };
}

function groundUniforms(): DecalGroundUniforms {
  return {
    uControlB: { value: defaultControlB() },
    uMapSize: { value: new THREE.Vector2(48, 48) },
    uRoadTone: { value: new THREE.Vector3(0.6, 0.55, 0.5) },
    uShoulderTone: { value: new THREE.Vector3(0.7, 0.65, 0.6) },
    uRoadOn: { value: 1 },
  };
}

interface Built {
  readonly legacy: THREE.ShaderMaterial;
  readonly pool: DecalPool;
  readonly twin: THREE.Material;
  readonly scene: Scene;
  readonly ground: DecalGroundUniforms;
}

async function adopted(opts: { wet?: boolean; lights?: Scene } = {}): Promise<Built> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ground = groundUniforms();
  const legacy = createDecalMaterial(
    PALETTE,
    ground,
    opts.wet ? { uWetSky: { value: new THREE.Vector3(0.4, 0.5, 0.6) }, uPuddleReflect: { value: 0.3 } } : undefined
  );
  const scene = opts.lights ?? sceneLights();
  setDecalLights(legacy, scene.lights);
  const pool = new DecalPool({ capacity: 4, grid: 2, renderOrder: DECAL_PERSISTENT_RENDER_ORDER, material: legacy });
  const root = new THREE.Group();
  root.add(pool.mesh);
  const kit = {
    ...NULL_P3_SLOTS,
    ground: null,
    foliage: null,
    ring: null,
    decal: (l: THREE.ShaderMaterial) => createNodeDecalMaterial({ W, TSL, maths: MATERIAL_MATHS.decal }, l),
  };
  adoptMaterials(root, kit, createTwinCache());
  return { legacy, pool, twin: pool.mesh.material, scene, ground };
}

interface Compiled {
  readonly frag: string;
  readonly vert: string;
  /** The GLSL name each fragment uniform node was given (`nodeUniform3`). */
  readonly names: ReadonlyMap<unknown, string>;
  readonly renderUpdate: () => void;
}

/** The twin's GLSL, from three's own `GLSLNodeBuilder`; `shadows` turns the renderer's shadow map on (the node backend's setting). */
async function compileGlsl(mesh: THREE.Mesh, shadows = true): Promise<Compiled> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  r.shadowMap.enabled = shadows;
  // Uninitialised (no GPU): the shadow node asks the backend about texture compatibility. An ordinary device answers "no".
  (r as unknown as { hasCompatibility(): boolean }).hasCompatibility = () => false;
  const builder = new W.GLSLNodeBuilder(mesh, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    updateNodes: Array<{ update(frame: unknown): void }>;
    uniforms: { fragment: Array<{ node: unknown; name: string }> };
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  const frame = { camera: builder.camera, scene: builder.scene, renderer: r, object: mesh, material: mesh.material };
  return {
    frag: builder.fragmentShader,
    vert: builder.vertexShader,
    names: new Map<unknown, string>(builder.uniforms.fragment.map((u) => [u.node, u.name])),
    renderUpdate: () => {
      for (const n of builder.updateNodes) n.update(frame);
    },
  };
}

/**
 * The twin's WGSL fragment, from three's own `WGSLNodeBuilder` (the `mesh.node.test.ts` route): no GPU, so the builder's three device
 * questions are stubbed to an ordinary single-sampled device with no optional features.
 */
async function compileWgsl(mesh: THREE.Mesh, shadows = true): Promise<string> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: false });
  r.shadowMap.enabled = shadows;
  const stubbed = r as unknown as { hasFeature(): boolean; hasCompatibility(): boolean; backend: Record<string, unknown> };
  stubbed.hasFeature = () => false;
  stubbed.hasCompatibility = () => false;
  stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
  stubbed.backend.device = { features: new Set<string>() };
  const Builder = (W as unknown as { WGSLNodeBuilder: new (m: THREE.Mesh, r: unknown) => unknown }).WGSLNodeBuilder;
  const builder = new Builder(mesh, r) as { scene: THREE.Scene; camera: THREE.Camera; material: unknown; build(): void; fragmentShader: string };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return builder.fragmentShader;
}


/** The twin's nodes, rebuilt on the same legacy material (the factory's own `buildNodeDecal`, not the adopted twin's). */
async function nodesOf(b: Built): Promise<NodeDecal> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  return buildNodeDecal({ W, TSL, maths: MATERIAL_MATHS.decal }, b.legacy);
}

/** Compiles the twin `nodes` on the pool's own geometry. */
async function compileNodes(b: Built, nodes: NodeDecal, shadows = true): Promise<Compiled> {
  const mesh = new THREE.Mesh(b.pool.mesh.geometry, nodes.material);
  mesh.receiveShadow = b.pool.mesh.receiveShadow;
  return compileGlsl(mesh, shadows);
}

const mainOf = (src: string): string => src.slice(src.indexOf('void main()'));
const nameOf = (c: Compiled, node: unknown): string => {
  const n = c.names.get(node);
  if (n === undefined) throw new Error('spec: that node is not a fragment uniform of the compiled program');
  return n;
};

describe('G2: each input is wired, by reference', () => {
  it('uNowSec is the record\'s own clock, re-read every render, and the age is uNowSec - aDecal.z', async () => {
    const b = await adopted();
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    b.legacy.uniforms.uNowSec.value = 123.5;
    c.renderUpdate();
    // Falsify: bind uNowSec by value (`TSL.uniform(read('uNowSec').value)` with no render update) -> still 0.
    expect(n.numbers.uNowSec?.value).toBe(123.5);
    const now = nameOf(c, n.numbers.uNowSec);
    expect(mainOf(c.frag)).toMatch(new RegExp(`max\\( \\( ${now} - vRlDecal\\.z \\), 0\\.0 \\)`));
  });

  it('uColors is the record\'s array, by reference, indexed by the kind\'s palette entry', async () => {
    const b = await adopted();
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    const rec = b.legacy.uniforms.uColors.value as THREE.Vector3[];
    c.renderUpdate();
    expect((n.colours as unknown as { array: unknown }).array).toBe(rec);
    const next = rec.map((v) => v.clone().multiplyScalar(0.5));
    b.legacy.uniforms.uColors.value = next;
    c.renderUpdate();
    // Falsify: drop the colours' render update (a replaced palette never reaches the twin).
    expect((n.colours as unknown as { array: unknown }).array).toBe(next);
    expect(mainOf(c.frag)).toMatch(/buffer\d+\[ int\( nodeVar\d+ \) \]\.xyz/);
  });

  it('uRimGain and uRimShape are by reference: the gain gates the rim and scales the bump, the shape is (bowl, rim)', async () => {
    const b = await adopted();
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    b.legacy.uniforms.uRimGain.value = 0;
    (b.legacy.uniforms.uRimShape.value as THREE.Vector2).set(0.3, 0.2);
    c.renderUpdate();
    expect(n.numbers.uRimGain?.value).toBe(0);
    expect(n.numbers.uRimShape?.value).toBe(b.legacy.uniforms.uRimShape.value);
    const gain = nameOf(c, n.numbers.uRimGain);
    const shape = nameOf(c, n.numbers.uRimShape);
    const f = mainOf(c.frag);
    // The gate (`0 < uRimGain`) and the bump's scale (`* halfLength * uRimGain`).
    expect(f).toContain(`( 0.0 < ${gain} )`);
    expect(f).toMatch(new RegExp(`\\* vRlDecal\\.w \\) \\* ${gain} \\)`));
    // The bowl reads x (depth), the rim y (height): CRATER_RIM read as CRATER_BOWL swaps them.
    expect(f).toContain(`( 0.0 - ${shape}.x ) * max(`);
    expect(f).toContain(`( ${shape}.y * smoothstep( 0.6599999999999999, 0.88,`);
  });

  it('uControlB is the record\'s texture, re-bound on every render (a rebuilt control map reaches the decals)', async () => {
    const b = await adopted();
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    const first = b.ground.uControlB.value;
    expect((n.controlB as unknown as { value: unknown }).value).toBe(first);
    const rebuilt = defaultControlB();
    b.ground.uControlB.value = rebuilt;
    c.renderUpdate();
    // Falsify: drop the carried re-bind on uMapSize (the twin keeps the placeholder it was built with).
    expect((n.controlB as unknown as { value: unknown }).value).toBe(rebuilt);
    expect(mainOf(c.frag)).toMatch(/texture\( nodeUniform\d+, nodeVar\d+ \)/);
  });

  it('uMapSize, uRoadTone, uShoulderTone and uRoadOn are the ground\'s SHARED objects, and each reaches its term', async () => {
    const b = await adopted();
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    c.renderUpdate();
    for (const k of ['uMapSize', 'uRoadTone', 'uShoulderTone'] as const) expect(n.numbers[k]?.value).toBe(b.ground[k].value);
    b.ground.uRoadOn.value = 0;
    c.renderUpdate();
    expect(n.numbers.uRoadOn?.value).toBe(0);
    const f = mainOf(c.frag);
    const size = nameOf(c, n.numbers.uMapSize);
    const road = nameOf(c, n.numbers.uRoadTone);
    const shoulder = nameOf(c, n.numbers.uShoulderTone);
    const on = nameOf(c, n.numbers.uRoadOn);
    // The off-map discard and the control map's uv both read the map size.
    expect(f).toContain(`( v_positionWorld.xz.x > ${size}.x )`);
    expect(f).toContain(`( v_positionWorld.xz / ${size} )`);
    // mix(mix(vGround, uRoadTone, uRoadOn * surface), uShoulderTone, uRoadOn * shoulder).
    expect(f).toMatch(new RegExp(`mix\\( mix\\( vRlGround, ${road}, \\( ${on} \\* \\( 1\\.0 - nodeVar\\d+ \\) \\) \\), ${shoulder}, \\( ${on} \\* `));
  });

  it('the light OBJECTS are read every render: colour x intensity, a hidden light reads black, ambient lights sum', async () => {
    const b = await adopted();
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    const { sun, hemi, ambient } = b.scene;
    c.renderUpdate();
    const rgb = (node: unknown): number[] => (node as { value: THREE.Color }).value.toArray();
    expect(rgb(n.lights.sunColor)).toEqual([2, 1, 0.5]);
    expect(rgb(n.lights.hemiSky)).toEqual([0.2, 0.2, 0.2]);
    expect(rgb(n.lights.hemiGround)).toEqual([0.1, 0.1, 0.1]);
    expect(rgb(n.lights.ambient)).toEqual([0.05, 0.05, 0.05]);
    // Falsify: copy the light's colour without its intensity, or read it once at build (no render update).
    sun.intensity = 3;
    hemi.groundColor.setRGB(0.3, 0.2, 0.1);
    ambient.intensity = 2;
    c.renderUpdate();
    expect(rgb(n.lights.sunColor)).toEqual([3, 1.5, 0.75]);
    expect(rgb(n.lights.hemiGround)).toEqual([0.3, 0.2, 0.1]);
    expect(rgb(n.lights.ambient)).toEqual([0.1, 0.1, 0.1]);
    sun.visible = false;
    c.renderUpdate();
    expect(rgb(n.lights.sunColor)).toEqual([0, 0, 0]);
  });

  it('the light DIRECTIONS are the lights\' own world positions, in view space: the sun toward its target, the sky its position', async () => {
    const TSL = await import('three/tsl');
    const b = await adopted();
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    const f = mainOf(c.frag);
    const sunPos = nameOf(c, TSL.lightPosition(b.scene.sun));
    const sunTarget = nameOf(c, TSL.lightTargetPosition(b.scene.sun));
    const hemiPos = nameOf(c, TSL.lightPosition(b.scene.hemi));
    // Falsify: read the sun's direction from a constant, or the sky's from the sun.
    expect(f).toContain(`normalize( ( cameraViewMatrix * vec4( ( ${sunPos} - ${sunTarget} ), 0.0 ) ).xyz )`);
    expect(f).toContain(`normalize( ( cameraViewMatrix * vec4( ${hemiPos}, 0.0 ) ).xyz )`);
  });

  it('the shadow is the sun\'s OWN node shadow, sampled into the sun term only, and shared with the lit materials (one shadow map)', async () => {
    const W = await import('three/webgpu');
    const b = await adopted();
    const n = await nodesOf(b);
    expect(n.shadow).not.toBeNull();
    expect((b.scene.sun.shadow as unknown as { shadowNode?: unknown }).shadowNode).toBe(n.shadow);
    const c = await compileNodes(b, n);
    const f = mainOf(c.frag);
    // Falsify: replace the shadow factor by 1 (no shadow-map tap in the program, the rim lit in full shade).
    const tap = /nodeVar\d+ = step\( nodeVar\d+\.z, texture\( (nodeUniform\d+), /.exec(f);
    expect(tap, 'the twin samples the sun\'s shadow map').not.toBeNull();
    // The shadow lands in a var read by the sun term: sunColor * max(n . sunDir, 0) * shadow.
    const shadowVar = /\n\t(nodeVar\d+) = nodeVar\d+;\n\tnodeVar\d+ = vec4\( 0\.0, 0\.0, 0\.0, 0\.0 \);/.exec(f);
    expect(shadowVar, 'the shadow factor is a statement before the control map tap').not.toBeNull();
    const sv = (shadowVar as RegExpExecArray)[1] as string;
    const sunColour = nameOf(c, n.lights.sunColor);
    expect(f).toMatch(new RegExp(`\\( \\( ${sunColour}\\.x \\* nodeVar\\d+ \\) \\* ${sv} \\)`));
    // One shadow map: a lit material on the same light, built after the twin, takes the same node and its map.
    const map = b.scene.sun.shadow.map;
    expect(map).not.toBeNull();
    const lit = new THREE.Mesh(new THREE.BoxGeometry(), new W.MeshStandardNodeMaterial());
    lit.receiveShadow = true;
    const r = new W.WebGPURenderer({ forceWebGL: true });
    r.shadowMap.enabled = true;
    (r as unknown as { hasCompatibility(): boolean }).hasCompatibility = () => false;
    const builder = new W.GLSLNodeBuilder(lit, r) as unknown as { scene: THREE.Scene; camera: THREE.Camera; material: unknown; lightsNode: unknown; build(): void };
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.OrthographicCamera();
    builder.material = lit.material;
    builder.lightsNode = new W.LightsNode().setLights([b.scene.sun]);
    builder.build();
    // Falsify: build `TSL.shadow(sun)` in the twin without installing it on the light (the lit build makes its own node and map).
    expect(b.scene.sun.shadow.map).toBe(map);
  });

  it('the shadow is used where the legacy material uses it: shadow maps on, the sun casting, the mesh receiving', async () => {
    const b = await adopted();
    const n = await nodesOf(b);
    const tapped = (c: Compiled): boolean => /step\( nodeVar\d+\.z, texture\( nodeUniform\d+, /.test(mainOf(c.frag));
    expect(tapped(await compileNodes(b, n, true))).toBe(true);
    expect(tapped(await compileNodes(b, n, false))).toBe(false);
    const off = new THREE.Mesh(b.pool.mesh.geometry, n.material);
    off.receiveShadow = false;
    expect(tapped(await compileGlsl(off, true))).toBe(false);
    b.scene.sun.castShadow = false;
    expect(tapped(await compileNodes(b, await nodesOf(b), true))).toBe(false);
  });

  it('the vertex stage: aOffset interpolates, aDecal and aGround are flat (the kind and seed are the exact values written)', async () => {
    const b = await adopted();
    const c = await compileGlsl(b.pool.mesh as THREE.Mesh);
    // Falsify: drop `.setInterpolation('flat')` on aDecal.
    expect(c.vert).toMatch(/flat\s+out vec4 vRlDecal;/);
    expect(c.vert).toMatch(/flat\s+out vec3 vRlGround;/);
    expect(c.vert).toMatch(/\nout vec2 nodeVarying\d+;/);
    expect(c.vert).toMatch(/nodeVarying\d+ = aOffset;/);
  });

  it('the rubble hash is uint arithmetic: unsigned conversions and logical shifts (a signed shift drags the top bit down)', async () => {
    const b = await adopted();
    const c = await compileGlsl(b.pool.mesh as THREE.Mesh);
    const f = mainOf(c.frag);
    // Falsify: `fromFloat: (a) => TSL.int(a)` in `tslIntOps` (the products and shifts on int).
    expect(f).toContain('( uint( int( nodeVar');
    expect(f).toMatch(/\( nodeVar\d+ >> 13u \)/);
    expect(f).toMatch(/\( nodeVar\d+ >> 16u \) \) >> 8u \) \) \/ 16777216\.0/);
  });
});

describe('G3: the twin\'s rim reads its lights', () => {
  it('at a literal sun direction and colour, the rim ratio on a known facet is the hand-computed literal; in full shadow, the sky\'s', async () => {
    const lights = sceneLights();
    lights.sun.color.setRGB(1, 0.5, 0.25);
    lights.sun.intensity = 2;
    const b = await adopted({ lights });
    const n = await nodesOf(b);
    const c = await compileNodes(b, n);
    c.renderUpdate();
    const v = (node: unknown): [number, number, number] => (node as { value: THREE.Color }).value.toArray() as [number, number, number];
    // The colours the TWIN read off the light objects; the directions are the G3 facet's literals (view space).
    const read: DecalRimLights<number> = {
      ambient: v(n.lights.ambient),
      sunColor: v(n.lights.sunColor),
      sunDir: [-0.6, 0, 0.8],
      hemiSky: v(n.lights.hemiSky),
      hemiGround: v(n.lights.hemiGround),
      hemiDir: [0, 0, 1],
    };
    const facet = { dpx: [1, 0, 0], dpy: [0, 1, 0], dstx: [1, 0], dsty: [0, 1] } as const;
    const lit = MATERIAL_MATHS.decal.rimRatioOps(NUMBER_OPS, { hs: 0.75, ht: 0 }, 1, 1, facet, read, 1);
    // Falsify: drop the shadow term in decalIrradianceOps (the shaded ratio reads the lit one).
    expect(lit[0]).toBeCloseTo(2.24 / 1.85, 9);
    expect(lit[1]).toBeCloseTo(1.24 / 1.05, 9);
    expect(lit[2]).toBeCloseTo(0.74 / 0.65, 9);
    const shaded = MATERIAL_MATHS.decal.rimRatioOps(NUMBER_OPS, { hs: 0.75, ht: 0 }, 1, 1, facet, read, 0);
    for (const ch of shaded) expect(ch).toBeCloseTo(0.24 / 0.25, 9);
  });
});

describe('G4: the blend and the order hold', () => {
  it('the factory\'s own twin, and the adopted one, multiply: DstColor x Zero, alpha Zero x One, with the legacy depth state', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const b = await adopted();
    const direct = createNodeDecalMaterial({ W, TSL, maths: MATERIAL_MATHS.decal }, b.legacy);
    for (const twin of [direct, b.twin]) {
      expect(twin).not.toBe(b.legacy);
      // Falsify: the twin sets NormalBlending after its copyRenderState.
      expect(twin.blending).toBe(THREE.CustomBlending);
      expect([twin.blendEquation, twin.blendSrc, twin.blendDst]).toEqual([THREE.AddEquation, THREE.DstColorFactor, THREE.ZeroFactor]);
      expect([twin.blendEquationAlpha, twin.blendSrcAlpha, twin.blendDstAlpha]).toEqual([THREE.AddEquation, THREE.ZeroFactor, THREE.OneFactor]);
      expect([twin.transparent, twin.depthTest, twin.depthWrite]).toEqual([true, true, false]);
      expect([twin.polygonOffset, twin.polygonOffsetFactor, twin.polygonOffsetUnits]).toEqual([true, -1, -4]);
      expect(twin.side).toBe(THREE.DoubleSide);
      const flags = twin as unknown as { fog: boolean; toneMapped: boolean; lights: boolean };
      expect([flags.fog, flags.toneMapped, flags.lights]).toEqual([false, false, false]);
    }
  });

  it('the two pools keep their render orders (-1 and 0) on the mesh, and both draw the ONE twin', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const legacy = createDecalMaterial(PALETTE, groundUniforms());
    setDecalLights(legacy, sceneLights().lights);
    const persistent = new DecalPool({ capacity: 4, grid: 4, renderOrder: DECAL_PERSISTENT_RENDER_ORDER, material: legacy });
    const fading = new DecalPool({ capacity: 4, grid: 2, renderOrder: DECAL_FADING_RENDER_ORDER, material: legacy });
    const root = new THREE.Group();
    root.add(persistent.mesh, fading.mesh);
    const kit = { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: null, decal: (l: THREE.ShaderMaterial) => createNodeDecalMaterial({ W, TSL, maths: MATERIAL_MATHS.decal }, l) };
    adoptMaterials(root, kit, createTwinCache());
    expect([persistent.mesh.renderOrder, fading.mesh.renderOrder]).toEqual([-1, 0]);
    expect(isTwin(persistent.mesh.material)).toBe(true);
    expect(fading.mesh.material).toBe(persistent.mesh.material);
    expect(persistent.mesh.material.name).toBe(NODE_DECAL_MATERIAL_NAME);
  });
});

describe('G6: a wet owner draws dry and says so', () => {
  it('the census names rl-decal: wet terms, and the wet owner\'s compiled graph is the dry one, byte for byte', async () => {
    const dry = await adopted();
    const wet = await adopted({ wet: true });
    expect(wet.legacy.defines?.DECAL_WET).toBe('');
    expect(wet.twin.userData.rlUnportedTerms).toEqual([DECAL_WET_TERM]);
    expect(dry.twin.userData.rlUnportedTerms).toBeUndefined();
    const scene = new THREE.Scene();
    scene.add(wet.pool.mesh);
    expect(censusUnported(scene)).toEqual([{ kind: 'partial', key: DECAL_WET_TERM, objects: 1 }]);
    // Falsify: read the wet define into the graph (e.g. a wet owner's opacity times 0.999).
    const d = await compileGlsl(dry.pool.mesh as THREE.Mesh);
    const w = await compileGlsl(wet.pool.mesh as THREE.Mesh);
    // The one difference allowed: the palette buffer's NAME, which three takes from the node's id (each build makes a new node).
    const ids = (src: string): string => src.replace(/(NodeBuffer_|buffer)\d+/g, '$1#');
    expect(ids(w.frag)).toBe(ids(d.frag));
    expect(ids(w.vert)).toBe(ids(d.vert));
    expect(ids(w.frag)).toContain('buffer#[');
  });
});

describe('WGSL uniformity: every tap and derivative in uniform control flow', () => {
  it('no implicit-gradient sample in a conditional, and the control map tap and every derivative come before the first discard', async () => {
    const b = await adopted();
    const wgsl = await compileWgsl(b.pool.mesh as THREE.Mesh);
    // Falsify: read control B inside the kind select (`ctlB.assign` moved after the first discard into the road mix).
    assertNoImplicitSampleInConditional(wgsl);
    const main = wgsl.slice(wgsl.indexOf('fn main('));
    const firstDiscard = main.indexOf('discard;');
    expect(firstDiscard).toBeGreaterThan(0);
    const tap = main.search(/textureSample\( nodeUniform\d+, nodeUniform\d+_sampler, /);
    expect(tap, 'control B is a filtered implicit-gradient tap').toBeGreaterThan(0);
    expect(tap).toBeLessThan(firstDiscard);
    for (const d of ['dpdx( v_positionView )', 'dpdy( v_positionView )']) {
      expect(main.indexOf(d)).toBeGreaterThan(0);
      expect(main.indexOf(d)).toBeLessThan(firstDiscard);
    }
    expect(main.slice(firstDiscard)).not.toMatch(/dpdx|dpdy|fwidth|textureSample/);
  });
});

describe('adoption and the census', () => {
  it('the legacy material is keyed rl-decal on the decal slot, listed as ported; L-matched keeps both pools visible', () => {
    const legacy = createDecalMaterial(PALETTE, groundUniforms());
    expect(legacy.name).toBe('rl-decal');
    expect(legacyTwinSlot(legacy)).toBe('decal');
    expect(PORTED_MATERIAL_KEYS.has('rl-decal')).toBe(true);
    const scene = new THREE.Scene();
    const a = new DecalPool({ capacity: 2, grid: 2, renderOrder: -1, material: legacy });
    const b = new DecalPool({ capacity: 2, grid: 2, renderOrder: 0, material: legacy });
    scene.add(a.mesh, b.mesh);
    expect(censusUnported(scene, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect([a.mesh.visible, b.mesh.visible]).toEqual([true, true]);
    expect(censusUnported(scene)).toEqual([{ kind: 'shader-material', key: 'rl-decal', objects: 2 }]);
  });

  it('the light record is non-enumerable (a clone or a toJSON never carries a light), and a material without one refuses to twin', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const legacy = createDecalMaterial(PALETTE, groundUniforms());
    expect(() => createNodeDecalMaterial({ W, TSL, maths: MATERIAL_MATHS.decal }, legacy)).toThrow(/no scene lights/);
    setDecalLights(legacy, sceneLights().lights);
    expect(Object.keys(legacy.userData)).not.toContain(DECAL_LIGHTS_KEY);
    expect(legacy.clone().userData[DECAL_LIGHTS_KEY]).toBeUndefined();
    expect(MATERIAL_MATHS.decal.lightsKey).toBe(DECAL_LIGHTS_KEY);
  });
});
