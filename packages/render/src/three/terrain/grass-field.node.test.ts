/**
 * @vitest-environment jsdom
 *
 * GH-1167 S4 gates for `grass-field.node.ts`, the 3D grass field's node material (design 2026-11-11, sections 2.1, 3.3, 3.4; the
 * wiring gates of P2 T6/T7 and P3 T6). The material is compiled on a real grass `InstancedMesh` (a real S2 clump through
 * `grassClumpGeometry`, made by `createGrassFieldMesh`) by three's own `GLSLNodeBuilder` (no GPU), so these read the generated
 * programs, not a mock. Each gate has a one-line falsification, run by hand and listed in the commit message.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import { MATERIAL_MATHS } from '../material-maths';
import { presentationSimMs } from '../decal-maths';
import { ENV_USERDATA_KEY } from '../environment-classes';
import { GRASS_RENDER_ORDER } from '../units/render-order';
import { SILHOUETTE_PX_PER_WORLD_UNIT } from '../units/silhouette';
import { swayingFoliageMaterial, type SwayingFoliageMaterial } from './decor-mesh';
import { createFoliageTwinFactory, nodeDisturbBindings } from './decor-mesh.node';
import { makeWindUniforms } from './wind-uniforms';
import { makeDisturbUniforms } from './disturb-uniforms';
import { buildGrassClump, GRASS_WIDTH_ATTRIBUTE, type GrassColours } from './grass-blade';
import { grassFlutterOps, grassFlutterPeriodOps, grassWidthFloorOps } from './grass-sway';
import {
  createGrassFieldMaterial,
  createGrassFieldMesh,
  grassClumpGeometry,
  GRASS_FIELD_NAME,
  GRASS_INSTANCES_PER_MESH_MAX,
  NODE_GRASS_FIELD_MATERIAL_NAME,
  nodeGrassFieldBindings,
  nodeGrassFieldDisturbBindings,
  type GrassFieldBindings,
  type GrassFieldMaths,
  type GrassFieldRecord,
} from './grass-field.node';

type W = typeof import('three/webgpu');

afterEach(() => vi.restoreAllMocks());

/** Test colours (any hex: the blade linearises them; the material never sees a key). */
const COLOURS: GrassColours = { root: '#3f5a2a', tip3: '#5d7a35', tip2: '#6f8c3f', tip1: '#86a04e', strawRoot: '#8c7a55', strawTip: '#c8b993' };

/** The maths S5 will hand over from `MATERIAL_MATHS`: the foliage slot, the two grass bodies, the attribute and the camera figure. */
const MATHS: GrassFieldMaths = {
  foliage: MATERIAL_MATHS.foliage,
  flutterOps: grassFlutterOps,
  widthFloorOps: grassWidthFloorOps,
  widthAttribute: GRASS_WIDTH_ATTRIBUTE,
  pxPerUnit: SILHOUETTE_PX_PER_WORLD_UNIT,
};

interface Fixture {
  readonly W: W;
  readonly TSL: typeof import('three/tsl');
  readonly rec: GrassFieldRecord;
  readonly foliage: SwayingFoliageMaterial;
  readonly mesh: THREE.InstancedMesh;
  readonly mat: THREE.MeshStandardMaterial & { positionNode: unknown; castShadowPositionNode: unknown; normalNode: unknown };
  readonly bound: GrassFieldBindings;
  readonly renderer: InstanceType<W['WebGPURenderer']>;
}

/** The foliage record a green map's decor builds (the very record the field binds), two clumps scaled and yawed like S5's, and the material. */
async function fixture(opts: { slots?: number; count?: number } = {}): Promise<Fixture> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const disturb = makeDisturbUniforms();
  if (opts.slots !== undefined) disturb.slots = opts.slots;
  const foliage = swayingFoliageMaterial(['#334422', '#556633'], { time: { value: 3.25 }, amp: { value: 1 }, wind: makeWindUniforms(), disturb });
  const rec: GrassFieldRecord = { sway: foliage.rlSway, zoom: { value: 1 }, dpr: { value: 2 } };
  const mat = createGrassFieldMaterial({ W, TSL, maths: MATHS }, rec) as Fixture['mat'];
  const geo = grassClumpGeometry({ W, maths: MATHS }, buildGrassClump(1, 0, COLOURS));
  const count = opts.count ?? 2;
  const mesh = createGrassFieldMesh({ W }, geo, mat, count, 'c0-v1');
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(4, 1, 5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(1.1, 1.1, 1.1)));
  if (count > 1) mesh.setMatrixAt(1, new THREE.Matrix4().compose(new THREE.Vector3(9, 0.5, 2), new THREE.Quaternion(), new THREE.Vector3(0.9, 0.9, 0.9)));
  const bound = nodeGrassFieldBindings(mat);
  if (bound === null) throw new Error('spec: the material registered no bindings');
  const renderer = new W.WebGPURenderer({ forceWebGL: true });
  // An uninitialised renderer has no extension list and no capabilities: the instance-index path, and a 16 KiB uniform buffer limit.
  const backend = (renderer as unknown as { backend: { extensions: unknown; capabilities: unknown } }).backend;
  backend.extensions = { has: () => false };
  backend.capabilities = { getUniformBufferLimit: () => 16384 };
  return { W, TSL, rec, foliage, mesh, mat, bound, renderer };
}

interface Built {
  readonly vertex: string;
  readonly fragment: string;
  readonly vertexUsed: ReadonlySet<unknown>;
  readonly names: ReadonlyMap<unknown, string>;
}

/** The programs three builds for `material` drawing the grass mesh. `lit` adds a sun, so the fragment reads the normal at all. */
function compile(f: Fixture, material: THREE.Material, lit = false): Built {
  const builder = new f.W.GLSLNodeBuilder(f.mesh, f.renderer) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    vertexShader: string;
    fragmentShader: string;
    uniforms: { vertex: Array<{ node: unknown; name: string }> };
    lightsNode: unknown;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  if (lit) builder.lightsNode = (f.TSL as unknown as { lights(l: THREE.Light[]): unknown }).lights([new f.W.DirectionalLight()]);
  builder.build();
  return {
    vertex: builder.vertexShader,
    fragment: builder.fragmentShader,
    vertexUsed: new Set(builder.uniforms.vertex.map((u) => u.node)),
    names: new Map(builder.uniforms.vertex.map((u) => [u.node, u.name])),
  };
}

const mainOf = (src: string): string => src.slice(src.indexOf('void main()'));
/** The material's own terms are in a program iff it reads the width record (no rest-pose program has any reason to). */
const moves = (b: Built): boolean => /\brlGrassWidth\b/.test(mainOf(b.vertex));
const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INSTANCED = /positionLocal = \( buffer\d+\[ uint\( gl_InstanceID \) \] \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/;

/** three's own source file, read from the installed package (for the text pins against 0.186.1). */
function threeSource(rel: string): string {
  const root = dirname(dirname(createRequire(import.meta.url).resolve('three')));
  return readFileSync(join(root, 'src', rel), 'utf8');
}

describe('three 0.186.1, the facts the grass material is built on (design risk 5)', () => {
  it('REVISION 186: instancedMesh() runs before positionNode, the instance matrix is buffer(...).element(instanceIndex) under the limit, the back face negates normalView, the shadow pass prefers castShadowPositionNode, an override pass is handed positionNode', () => {
    // Falsify: bump three. Each line below is the reason a piece of the material exists.
    expect(THREE.REVISION).toBe('186');
    const setup = threeSource('materials/nodes/NodeMaterial.js');
    const pos = setup.slice(setup.indexOf('setupPosition( builder ) {'));
    expect(pos.indexOf('instancedMesh( object );')).toBeGreaterThan(0);
    expect(pos.indexOf('instancedMesh( object );')).toBeLessThan(pos.indexOf("positionLocal.assign( subBuild( this.positionNode, 'POSITION', 'vec3' ) );"));
    expect(setup).toContain('return this.normalNode ? vec3( this.normalNode ) : materialNormal;');
    const instance = threeSource('nodes/accessors/Instance.js');
    expect(instance).toContain("buffer( instanceMatrix.array, 'mat4', matrixCount ).element( instanceIndex )");
    expect(instance).toContain('if ( uniformBufferSize <= builder.getUniformBufferLimit() ) {');
    const normal = threeSource('nodes/accessors/Normal.js');
    expect(normal).toContain('node = negateOnBackSide( node );');
    const renderer = threeSource('renderers/common/Renderer.js');
    expect(renderer).toMatch(/if \( material\.castShadowPositionNode && material\.castShadowPositionNode\.isNode \) \{\s*positionNode = material\.castShadowPositionNode;\s*\} else if \( material\.positionNode/);
    expect(renderer).toMatch(/if \( material\.positionNode && material\.positionNode\.isNode \) \{\s*overrideMaterial\.positionNode = material\.positionNode;/);
  });
});

describe('G1: the flutter and the width floor on numbers (NUMBER_OPS), against literals', () => {
  // Hand-computed ONCE in plain doubles by a standalone transcription of the design's formulas (nothing imported from the module):
  // period = 0.9 + 0.4 * fract(7.31 phase + 0.37); flutter = 0.004 amp mode hN^2 sin(2 pi (t / period + phase)).
  const FLUTTER: ReadonlyArray<readonly [t: number, phase: number, hN: number, amp: number, period: number, out: number]> = [
    [12.5, 0.3, 0.8, 1, 1.1252, 0.0013834282099460609],
    [47.05, 0.71, 1.0, 1, 1.1240399999999997, -0.0016561526427217204],
    [3.2, 0.05, 0.5, 0.5, 1.1942, -0.0004959055729419851],
  ];
  const flutter = (t: number, phase: number, hN: number, amp: number, mode = 1): number => grassFlutterOps(NUMBER_OPS, { t, phase, hN, mode, amp });

  it('matches the literals: period and offset', () => {
    // Falsify: drop the `phase` term inside the sine / use `hN` instead of `hN * hN` / swap PERIOD_MIN and PERIOD_MAX.
    for (const [t, phase, hN, amp, period, out] of FLUTTER) {
      expect(grassFlutterPeriodOps(NUMBER_OPS, phase), `period at phase ${phase}`).toBeCloseTo(period, 12);
      expect(flutter(t, phase, hN, amp), `flutter at t=${t}`).toBeCloseTo(out, 14);
    }
  });

  it('is anti-vacuous: off in reduced motion and at amp 0, rooted at hN 0, every period inside 0.9-1.3 s, and two phases at one tick differ', () => {
    // Falsify: drop `x.mode` from the product (the reduced-motion row goes red).
    expect(Math.abs(FLUTTER[0][5])).toBeGreaterThan(0.001);
    expect(flutter(12.5, 0.3, 0.8, 1, 0)).toBe(0);
    expect(flutter(12.5, 0.3, 0.8, 0)).toBe(0);
    expect(flutter(12.5, 0.3, 0, 1)).toBe(0);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 1000; k++) {
      const p = grassFlutterPeriodOps(NUMBER_OPS, k / 1000);
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    expect(lo).toBeGreaterThanOrEqual(0.9);
    expect(hi).toBeLessThanOrEqual(1.3);
    expect(hi - lo).toBeGreaterThan(0.39);
    expect(flutter(12.5, 0.31, 0.8, 1)).not.toBeCloseTo(flutter(12.5, 0.3, 0.8, 1), 4);
  });

  // floor = signedHalf * (max(1, 0.5 / (pxPerUnit zoom dpr scale) / baseHalf) - 1), pxPerUnit = 64 sqrt(2) / 2.
  const FLOOR: ReadonlyArray<readonly [signedHalf: number, baseHalf: number, scale: number, zoom: number, dpr: number, out: number]> = [
    [0.006, 0.006, 1.0, 0.5, 2, 0.005048543456039804],
    [-0.003, 0.006, 0.9, 0.35, 1, -0.014537370565142546],
    [0.006, 0.006, 1.0, 2.5, 2, 0],
    [0.009, 0.009, 1.1, 0.5, 1, 0.01108826082916328],
  ];
  const floor = (signedHalf: number, baseHalf: number, scale: number, zoom: number, dpr: number): number =>
    grassWidthFloorOps(NUMBER_OPS, { signedHalf, baseHalf, scale, zoom, dpr, pxPerUnit: 45.254833995939045 });

  it('the width floor matches the literals: widens at wide zoom, nothing at close zoom, keeps the sign and the taper', () => {
    // Falsify: drop `x.dpr` from the device-px product / drop `x.scale` (the 0.9 and 1.1 rows go red) / `max(1, ...)` -> the ratio.
    for (const [sh, bh, s, z, d, out] of FLOOR) expect(floor(sh, bh, s, z, d), `floor ${sh} at z${z}`).toBeCloseTo(out, 14);
    expect(SILHOUETTE_PX_PER_WORLD_UNIT).toBeCloseTo(45.254833995939045, 12);
  });

  it('the floored blade is exactly 1 device px wide at its root at z0.5 DPR 2, and the tip stays a point', () => {
    const half = 0.006;
    const widened = half + floor(half, half, 1, 0.5, 2);
    expect(2 * widened * 45.254833995939045 * 0.5 * 2).toBeCloseTo(1, 12);
    expect(floor(0, half, 1, 0.35, 1)).toBe(0);
  });
});

describe('the material, compiled on a grass InstancedMesh', () => {
  it('reads the INSTANCED position, then this clump\'s matrix by gl_InstanceID: column 3 the origin, the 3x3 the clump frame', async () => {
    // Falsify: read column 2 (`im.element(2)`) as the origin / drop `T.mat3(im)` from the local push.
    const f = await fixture();
    const main = mainOf(compile(f, f.mat).vertex);
    const instanced = main.search(INSTANCED);
    expect(instanced).toBeGreaterThan(0);
    expect([...main.matchAll(/\bposition\b/g)].length).toBe(1);
    const fetch = /(nodeVar\d+) = (buffer\d+)\[ uint\( gl_InstanceID \) \];/.exec(main);
    expect(fetch).not.toBeNull();
    const m = (fetch as RegExpExecArray)[1];
    expect(main.indexOf((fetch as RegExpExecArray)[0])).toBeGreaterThan(instanced);
    expect(main).toMatch(new RegExp(`vec4\\( ${m}\\[ 3u \\]\\.xyz, 1\\.0 \\)`));
    expect(main).not.toMatch(new RegExp(`vec4\\( ${m}\\[ 2u \\]\\.xyz, 1\\.0 \\)`));
    expect(main).toMatch(new RegExp(`mat3\\( ${m}\\[ 0 \\]\\.xyz, ${m}\\[ 1 \\]\\.xyz, ${m}\\[ 2 \\]\\.xyz \\) \\* `));
    // The clump's scale for the width floor: the length of column 0.
    expect(main).toContain(`length( ${m}[ 0u ].xyz )`);
  });

  it('G2: every record uniform reaches the vertex program, and so do rlNature (vec3) and the width record (vec4)', async () => {
    // Falsify, one at a time: `t: T.float(0)` in the flutter AND the wind; `amp: T.float(1)` in both; `zoom: T.float(1)`;
    // `dpr: T.float(1)`; `strength: T.float(1)`; `dirX`/`dirZ` literals; `mode: T.float(1)` in both.
    const f = await fixture();
    const built = compile(f, f.mat);
    for (const k of Object.keys(f.bound) as Array<keyof GrassFieldBindings>) {
      expect(built.vertexUsed.has(f.bound[k]), `${k} is bound but the vertex program never reads it`).toBe(true);
    }
    const main = mainOf(built.vertex);
    expect(main).toMatch(/nodeVar\d+ = rlNature;/);
    expect(main).toMatch(/nodeVar\d+ = rlGrassWidth;/);
    expect(built.vertex).toMatch(/in vec3 rlNature;/);
    expect(built.vertex).toMatch(/in vec4 rlGrassWidth;/);
  });

  it('the flutter reads the blade phase (rlNature.z), the height lane (rlNature.x), the sim clock, the mode and the amplitude', async () => {
    // Falsify: `phase: nature.x` / `hN: nature.y` / `mode: T.float(1)` / `amp: T.float(1)` in the flutter call.
    const f = await fixture();
    const built = compile(f, f.mat);
    const main = mainOf(built.vertex);
    const nat = /(nodeVar\d+) = rlNature;/.exec(main)?.[1] as string;
    const name = (n: unknown): string => built.names.get(n) as string;
    // The period from the phase: fract( phase * 7.31 + 0.37 ).
    expect(main).toContain(`fract( ( ( ${nat}.z * 7.31 ) + 0.37 ) )`);
    // The sine: 2 pi (t / period + phase).
    expect(main).toContain(`( ( ${name(f.bound.uSwayTime)} / ( 0.9 + ( 0.4 * fract( ( ( ${nat}.z * 7.31 ) + 0.37 ) ) ) ) ) + ${nat}.z )`);
    // hN squared, gated by the mode, scaled by amp.
    expect(main).toContain(`( ${nat}.x * ${nat}.x )`);
    expect(main).toMatch(new RegExp(`\\( 0\\.004 \\* ${esc(name(f.bound.uSwayAmp))} \\) \\* \\( ${esc(name(f.bound.uWindMode))} \\* `));
  });

  it('the width floor reads the signed half (w.z), the root half (w.w), the zoom and the DPR', async () => {
    // Falsify: `signedHalf: width.w` / `baseHalf: width.z` / `zoom: T.float(1)`.
    const f = await fixture();
    const built = compile(f, f.mat);
    const main = mainOf(built.vertex);
    const w = /(nodeVar\d+) = rlGrassWidth;/.exec(main)?.[1] as string;
    const name = (n: unknown): string => built.names.get(n) as string;
    expect(main).toMatch(new RegExp(`max\\( ${esc(name(f.bound.uGrassZoom))}, 0\\.001 \\)`));
    expect(main).toMatch(new RegExp(`\\( ${esc(name(f.bound.uGrassDpr))} \\* max\\(`));
    expect(main).toMatch(new RegExp(`max\\( ${esc(w)}\\.w, 1e-6 \\)|max\\( ${esc(w)}\\.w, 0\\.000001 \\)`));
    expect(main).toMatch(new RegExp(`\\( ${esc(w)}\\.z \\* \\( max\\(`));
    // The push is along the width axis (w.x, 0, w.y).
    expect(main).toContain(`vec3( ${w}.x, 0.0, ${w}.y )`);
  });

  it('the wind: the grass class from rlNature.y, worldH is the rest height over the ORIGIN, the heading feeds the gust phase as (x, z)', async () => {
    // Falsify: `cls: nature.x` / `worldH: v.restWorld.y` / swap `dirX` and `dirZ`.
    const f = await fixture();
    const built = compile(f, f.mat);
    const main = mainOf(built.vertex);
    const nat = /(nodeVar\d+) = rlNature;/.exec(main)?.[1] as string;
    const rest = /(nodeVar\d+) = \( nodeUniform\d+ \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/.exec(main)?.[1] as string;
    const origin = /(nodeVar\d+) = \( nodeUniform\d+ \* vec4\( nodeVar\d+\[ 3u \]\.xyz, 1\.0 \) \)\.xyz;/.exec(main)?.[1] as string;
    expect(rest).toBeDefined();
    expect(origin).toBeDefined();
    const dir = built.names.get(f.bound.uWindDir) as string;
    expect(main).toContain(`${nat}.y < 0.5`);
    expect(main).not.toContain(`${nat}.x < 0.5`);
    // The wind's worldH, divided by its class height (the disturber bend reads the same difference unscaled, so the division is the
    // wind's own fingerprint).
    expect(main).toMatch(new RegExp(`= \\( \\( ${esc(rest)}\\.y - ${esc(origin)}\\.y \\) / [0-9.]+ \\);`));
    expect(main).toContain(`( ( ${origin}.x * ${dir}.x ) + ( ${origin}.z * ${dir}.y ) )`);
  });

  it('the disturbers: the preset slot budget is the loop bound, inside the early-outs, the bend reads the rest position over the origin', async () => {
    // Falsify: hard-code `maths.foliage.disturbMax` as the bound (the 8 and 16 rows go red) / pass `[]` for the disturbers.
    for (const slots of [24, 16, 8]) {
      const f = await fixture({ slots });
      expect(/for \( int i = 0; i < (\d+); i \+\+ \)/.exec(mainOf(compile(f, f.mat).vertex))?.[1], `slots ${slots}`).toBe(String(slots));
    }
    const none = await fixture({ slots: 0 });
    expect(mainOf(compile(none, none.mat).vertex)).not.toContain('for ( int i');
    const f = await fixture({ slots: 8 });
    const built = compile(f, f.mat);
    const d = nodeGrassFieldDisturbBindings(f.mat);
    if (d === null) throw new Error('spec: no disturbance bindings');
    for (const k of ['uDisturbBox', 'uDisturbN', 'uDisturbAmp', 'uDisturbSpring'] as const) {
      expect(built.vertexUsed.has(d[k]), `${k} is bound but the program never reads it`).toBe(true);
    }
    expect(mainOf(built.vertex)).toMatch(/buffer\d+\[ i \]\.x/);
  });

  it('G3: the shadow program and an AO override pass keep the instanced rest pose', async () => {
    // Falsify: drop `mat.castShadowPositionNode` (shadow red) / delete the `builder.material` guard (override red).
    const f = await fixture();
    expect(moves(compile(f, f.mat))).toBe(true); // anti-vacuity
    const shadow = new f.W.NodeMaterial() as unknown as THREE.Material & { isShadowPassMaterial: boolean; positionNode: unknown };
    shadow.isShadowPassMaterial = true;
    shadow.positionNode = f.mat.positionNode;
    const picked = (f.renderer as unknown as { _getShadowNodes(m: THREE.Material): { positionNode: unknown } })._getShadowNodes(f.mat);
    if (picked.positionNode !== null) shadow.positionNode = picked.positionNode;
    const sb = compile(f, shadow);
    expect(moves(sb)).toBe(false);
    expect(mainOf(sb.vertex)).toMatch(INSTANCED);
    const TSL = await import('three/tsl');
    const normal = new f.W.NodeMaterial() as THREE.Material & { fragmentNode: unknown; positionNode: unknown };
    normal.name = 'rl-node-ao-normal';
    normal.fragmentNode = TSL.vec4(TSL.normalView, 1);
    normal.positionNode = f.mat.positionNode;
    const ob = compile(f, normal);
    expect(moves(ob)).toBe(false);
    expect(mainOf(ob.vertex)).not.toContain('for ( int i');
    expect(mainOf(ob.vertex)).toMatch(INSTANCED);
  });

  it('both faces light with the bent normal: the fragment never negates it on the back face', async () => {
    // Falsify: drop `mat.normalNode` (three's `negateOnBackSide` brings gl_FrontFacing in).
    const f = await fixture();
    expect(f.mat.side).toBe(THREE.DoubleSide);
    const lit = compile(f, f.mat, true).fragment;
    // Anti-vacuity: the lit fragment does read the (bent, interpolated) geometry normal...
    expect(lit).toMatch(/normalViewGeometry = normalize\( v_normalViewGeometry \);/);
    // ...and never flips it by face.
    expect(lit).not.toMatch(/gl_FrontFacing/);
  });

  it('refuses a mesh whose matrices exceed the uniform buffer (three would read an interleaved attribute this material does not)', async () => {
    // Falsify: delete the `bytes > limit` throw (red: it compiles).
    const f = await fixture({ count: GRASS_INSTANCES_PER_MESH_MAX });
    expect(() => compile(f, f.mat)).not.toThrow();
    const backend = (f.renderer as unknown as { backend: { capabilities: unknown } }).backend;
    backend.capabilities = { getUniformBufferLimit: () => 8192 };
    expect(() => compile(f, f.mat)).toThrow(/exceed the uniform buffer limit 8192/);
  });
});

describe('G4: the sim clock, read at the material after two frame cadences', () => {
  const update = (n: unknown): void => (n as { update(): void }).update();
  const v = (n: unknown): unknown => (n as { value: unknown }).value;
  /** `ThreeRenderer.frame` writes `sway.time.value = presentationSimMs(tick, alpha) / 1000` once a frame. */
  const frame = (f: Fixture, tick: number, alpha: number, wallMs: number): number => {
    vi.spyOn(performance, 'now').mockReturnValue(wallMs);
    vi.spyOn(Date, 'now').mockReturnValue(1.7e12 + wallMs);
    f.rec.sway.time.value = presentationSimMs(tick, alpha) / 1000;
    for (const n of Object.values(f.bound)) update(n);
    return v(f.bound.uSwayTime) as number;
  };

  it('two frame cadences reaching one tick leave every input bit-identical; a tick moves the clock; a zero-time repaint moves nothing', async () => {
    // Falsify: `n.value = (n.value as number) + 1 / 60` in `uSwayTime`'s render update (frame-accumulated time).
    const f = await fixture();
    const snapshot = (): unknown[] => Object.values(f.bound).map((n) => v(n));
    const a0 = frame(f, 60, 0, 1000);
    const slow = snapshot();
    const a1 = frame(f, 60, 0, 1016);
    const fast = snapshot();
    const a2 = frame(f, 60, 0, 6016);
    expect(Object.is(a1, a0)).toBe(true);
    expect(Object.is(a2, a0)).toBe(true);
    expect(fast).toEqual(slow);
    for (const n of Object.values(f.bound)) update(n);
    expect(snapshot()).toEqual(slow);
    expect(frame(f, 61, 0, 1032)).not.toBe(a0);
    expect(v(f.bound.uSwayTime)).toBe(presentationSimMs(61, 0) / 1000);
  });

  it('every uniform is bound BY REFERENCE: a write to the record reaches the node on the next render update', async () => {
    // Falsify: bind any one by value (`T.uniform(r.value)` with no `onRenderUpdate`): its row goes red.
    const f = await fixture();
    const s = f.rec.sway;
    s.amp.value = 0;
    s.wind.mode.value = 0;
    s.wind.strength.value = 1.7;
    s.wind.dir.value.set(-0.6, 0.8);
    f.rec.zoom.value = 0.35;
    f.rec.dpr.value = 1.5;
    for (const n of Object.values(f.bound)) update(n);
    expect(v(f.bound.uSwayAmp)).toBe(0);
    expect(v(f.bound.uWindMode)).toBe(0);
    expect(v(f.bound.uWindStrength)).toBe(1.7);
    expect(v(f.bound.uWindDir)).toBe(s.wind.dir.value);
    expect(v(f.bound.uGrassZoom)).toBe(0.35);
    expect(v(f.bound.uGrassDpr)).toBe(1.5);
    f.rec.zoom.value = 2.5;
    update(f.bound.uGrassZoom);
    expect(v(f.bound.uGrassZoom)).toBe(2.5);
  });

  it('the disturbers are the SAME nodes the foliage twin of the same record reads (one set per record), and copy its arrays each render', async () => {
    // Falsify: build the grass its own set (`disturbNodes` on a fresh record) -> not the same object.
    const f = await fixture();
    const TSL = await import('three/tsl');
    const twin = createFoliageTwinFactory({ W: f.W, TSL, maths: MATERIAL_MATHS.foliage })(f.foliage);
    const d = nodeGrassFieldDisturbBindings(f.mat);
    expect(d).not.toBeNull();
    expect(nodeDisturbBindings(twin)).toBe(d);
    const other = await fixture();
    expect(nodeGrassFieldDisturbBindings(other.mat)).not.toBe(d);
    // The record's arrays are replaced after construction (ThreeRenderer points them at the field): the copy follows.
    const rec = f.rec.sway.disturb;
    rec.a.value = new Float32Array(rec.a.value.length).map((_, k) => k + 0.5);
    const node = (d as NonNullable<typeof d>).uDisturbA as unknown as { value: unknown; update(): void; array: Array<{ x: number; w: number }> };
    // An unbuilt uniform array has no upload buffer yet; give it one, as the decor twin's spec does.
    node.value = new Float32Array(node.array.length * 4);
    node.update();
    expect([node.array[2].x, node.array[2].w]).toEqual([8.5, 11.5]);
  });

  it('the source reads no frame delta, wall clock, TSL clock or random', () => {
    const src = readFileSync(join(dirname(new URL(import.meta.url).pathname), 'grass-field.node.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const banned of [/\bdtMs\b/, /performance\.now/, /Date\.now/, /Math\.random/, /\bdeltaTime\b/, /\bT\.time\b/, /\bframeId\b/, /\bTSL\.time\b/]) {
      expect(src, String(banned)).not.toMatch(banned);
    }
  });
});

describe('render state: no depth write, GRASS_RENDER_ORDER, no shadow, no AO, the names', () => {
  it('the material is transparent at opacity 1, depth-tested, writing no depth, roughness 0.85, metalness 0, vertex colours, the ground env class', async () => {
    // Falsify: `mat.depthWrite = true` / `mat.transparent = false`.
    const f = await fixture();
    expect(f.mat.transparent).toBe(true);
    expect(f.mat.opacity).toBe(1);
    expect(f.mat.depthTest).toBe(true);
    expect(f.mat.depthWrite).toBe(false);
    expect(f.mat.roughness).toBe(0.85);
    expect(f.mat.metalness).toBe(0);
    expect(f.mat.vertexColors).toBe(true);
    expect(f.mat.envMap).toBeNull();
    expect((f.mat.userData as Record<string, unknown>)[ENV_USERDATA_KEY]).toBe('ground');
    expect(f.mat.name).toBe(NODE_GRASS_FIELD_MATERIAL_NAME);
    expect(f.mat.name.startsWith('rl-node-material-')).toBe(true);
  });

  it('a grass mesh draws in GRASS_RENDER_ORDER, casts no shadow, receives them, is AO-exempt, and is named under rl-grass-field', async () => {
    // Falsify: `mesh.renderOrder = 0` / `mesh.castShadow = true` / drop `rlAoExempt`.
    const f = await fixture();
    expect(f.mesh.renderOrder).toBe(GRASS_RENDER_ORDER);
    expect(f.mesh.castShadow).toBe(false);
    expect(f.mesh.receiveShadow).toBe(true);
    expect((f.mesh.userData as { rlAoExempt?: unknown }).rlAoExempt).toBe(true);
    expect(f.mesh.name).toBe(`${GRASS_FIELD_NAME}-c0-v1`);
    expect(GRASS_FIELD_NAME).toBe('rl-grass-field');
  });

  it('a grass mesh holds 1 to GRASS_INSTANCES_PER_MESH_MAX (256: 16 KiB of mat4) clumps', async () => {
    // Falsify: drop the cap check (the 257 row compiles a mesh three would read through an attribute).
    expect(GRASS_INSTANCES_PER_MESH_MAX).toBe(256);
    const W = await import('three/webgpu');
    const geo = new THREE.BufferGeometry();
    const m = new THREE.MeshBasicMaterial();
    expect(() => createGrassFieldMesh({ W }, geo, m, 257, 'x')).toThrow(/1 to 256/);
    expect(() => createGrassFieldMesh({ W }, geo, m, 0, 'x')).toThrow(/1 to 256/);
    expect(createGrassFieldMesh({ W }, geo, m, 256, 'x').count).toBe(256);
  });

  it('the clump geometry carries the S2 arrays by reference under the attribute names the material reads', async () => {
    const W = await import('three/webgpu');
    const g = buildGrassClump(2, 1, COLOURS);
    const geo = grassClumpGeometry({ W, maths: MATHS }, g);
    expect(geo.getAttribute('position').array).toBe(g.positions);
    expect(geo.getAttribute('color').array).toBe(g.colors);
    expect(geo.getAttribute('rlNature').itemSize).toBe(3);
    expect(geo.getAttribute('rlNature').array).toBe(g.nature);
    expect(geo.getAttribute(GRASS_WIDTH_ATTRIBUTE).itemSize).toBe(4);
    expect(geo.getAttribute(GRASS_WIDTH_ATTRIBUTE).array).toBe(g.width);
    expect(geo.getIndex()?.count).toBe(g.triangles * 3);
  });
});
