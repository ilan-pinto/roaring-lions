/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T6) gates for `garrison-banner.node.ts`, the node garrison banner. The twin is compiled on the real
 * `GarrisonBannerBatch` mesh by three's own `GLSLNodeBuilder` (no GPU), so these read the generated programs, not a mock. Each gate
 * has a one-line falsification, run by hand and listed in the commit message:
 *  - G1 the sway on numbers: the gust phase sign (`windGustOps`: `t + dot / SPEED`; `bannerSwayOps`: `phase` subtracted);
 *  - G2 each input wired: `time: T.float(0)`, `amp: T.float(1)`, drop the glow from `emissiveNode`, `mode: T.float(1)`,
 *    `strength: T.float(1)`, `dirX: T.float(...)`, drop `aTeam` from `emissiveNode`, `hem: T.float(1)`;
 *  - G3 the shadow keeps the rest pose: drop `twin.castShadowPositionNode`; an override pass: delete the `builder.material` guard;
 *  - G4 the sim clock: bind `uBannerTime` to `performance.now() / 1000` in its `onRenderUpdate`;
 *  - G5 team colour on a viewer swap: replace `T.instanceColor` in the mix with a constant copied from the buffer at build.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GarrisonBannerBatch, bannerSwayOps, type GarrisonBannerMaterial } from './garrison-banner';
import { createNodeBannerMaterial, nodeBannerBindings, NODE_BANNER_MATERIAL_NAME, type BannerBindings } from './garrison-banner.node';
import { NUMBER_INT_OPS, NUMBER_OPS } from '../fog-ops';
import { MATERIAL_MATHS } from '../material-maths';
import { presentationSimMs } from '../decal-maths';
import { makeWindUniforms } from '../terrain/wind-uniforms';
import { BANNER_HOOK_KEY } from '../material-names';
import { PORTED_MATERIAL_KEYS, censusUnported } from '../backend/unported';
import { legacyTwinSlot } from '../node-material-adoption';
import { RENDER_STATE_KEYS, copyRenderState, isTwin, markTwin } from '../twin-identity';

type W = typeof import('three/webgpu');

afterEach(() => vi.restoreAllMocks());

interface Fixture {
  readonly W: W;
  readonly batch: GarrisonBannerBatch;
  readonly time: { value: number };
  readonly mesh: THREE.InstancedMesh;
  readonly legacy: GarrisonBannerMaterial;
  readonly twin: THREE.MeshStandardMaterial & { positionNode: unknown; castShadowPositionNode: unknown; emissiveNode: unknown };
  readonly bound: BannerBindings;
  readonly renderer: InstanceType<W['WebGPURenderer']>;
}

/** Two banners at (4, 1, 5) and (9, 1, 2), scaled and yawed like a wall's, drawn through the real batch, and the twin the backend makes. */
async function fixture(): Promise<Fixture> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const time = { value: 3 };
  const batch = new GarrisonBannerBatch(time, 8, makeWindUniforms());
  const a = new THREE.Matrix4().compose(new THREE.Vector3(4, 1, 5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(2, 1.5, 1));
  const b = new THREE.Matrix4().compose(new THREE.Vector3(9, 1, 2), new THREE.Quaternion(), new THREE.Vector3(1.2, 1, 1));
  batch.update([
    { s: 0, matrix: a, hex: '#3366CC' },
    { s: 1, matrix: b, hex: '#CC3333' },
  ]);
  const legacy = batch.mesh.material as GarrisonBannerMaterial;
  const twin = createNodeBannerMaterial({ W, TSL, maths: MATERIAL_MATHS.banner }, legacy, legacy.rlBanner) as Fixture['twin'];
  const bound = nodeBannerBindings(twin);
  if (bound === null) throw new Error('spec: the twin registered no bindings');
  const renderer = new W.WebGPURenderer({ forceWebGL: true });
  // An uninitialised renderer has no extension list and no capabilities: the instance-index path, and a 16 KiB uniform buffer limit.
  const backend = (renderer as unknown as { backend: { extensions: unknown; capabilities: unknown } }).backend;
  backend.extensions = { has: () => false };
  backend.capabilities = { getUniformBufferLimit: () => 16384 };
  return { W, batch, time, mesh: batch.mesh, legacy, twin, bound, renderer };
}

interface Built {
  readonly vertex: string;
  readonly fragment: string;
  readonly vertexUsed: ReadonlySet<unknown>;
  readonly fragmentUsed: ReadonlySet<unknown>;
}

/** The programs three builds for `material` drawing the banner mesh. */
function compile(f: Fixture, material: THREE.Material): Built {
  const builder = new f.W.GLSLNodeBuilder(f.mesh, f.renderer) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    vertexShader: string;
    fragmentShader: string;
    uniforms: { vertex: Array<{ node: unknown }>; fragment: Array<{ node: unknown }> };
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  builder.build();
  return {
    vertex: builder.vertexShader,
    fragment: builder.fragmentShader,
    vertexUsed: new Set(builder.uniforms.vertex.map((u) => u.node)),
    fragmentUsed: new Set(builder.uniforms.fragment.map((u) => u.node)),
  };
}

const mainOf = (src: string): string => src.slice(src.indexOf('void main()'));
/** The swing is in a program iff it reads `aHem` in its main (no rest-pose program has any reason to). */
const swings = (b: Built): boolean => /\baHem\b/.test(mainOf(b.vertex));

/** three's own source file, read from the installed package (for the text pins against 0.186.1). */
function threeSource(rel: string): string {
  const root = dirname(dirname(createRequire(import.meta.url).resolve('three')));
  return readFileSync(join(root, 'src', rel), 'utf8');
}

describe('three 0.186.1, the facts the twin is built on', () => {
  it('REVISION 186: instancedMesh() runs before positionNode, instanceColor multiplies the colour after the vertex colour, the shadow pass prefers castShadowPositionNode, an override pass is handed positionNode', () => {
    // Falsify: bump three. Each line below is the reason a piece of the twin exists.
    expect(THREE.REVISION).toBe('186');
    const setup = threeSource('materials/nodes/NodeMaterial.js');
    const pos = setup.slice(setup.indexOf('setupPosition( builder ) {'));
    expect(pos.indexOf('instancedMesh( object );')).toBeGreaterThan(0);
    expect(pos.indexOf('instancedMesh( object );')).toBeLessThan(pos.indexOf("positionLocal.assign( subBuild( this.positionNode, 'POSITION', 'vec3' ) );"));
    expect(setup).toContain('colorNode = colorNode.mul( vertexColor() );');
    expect(setup).toContain('colorNode = instanceColor.mul( colorNode );');
    const renderer = threeSource('renderers/common/Renderer.js');
    expect(renderer).toMatch(/if \( material\.castShadowPositionNode && material\.castShadowPositionNode\.isNode \) \{\s*positionNode = material\.castShadowPositionNode;\s*\} else if \( material\.positionNode/);
    expect(renderer).toMatch(/if \( material\.positionNode && material\.positionNode\.isNode \) \{\s*overrideMaterial\.positionNode = material\.positionNode;/);
    const instance = threeSource('nodes/accessors/Instance.js');
    expect(instance).toContain("buffer( instanceMatrix.array, 'mat4', matrixCount ).element( instanceIndex )");
    expect(instance).toContain("varyingProperty( 'vec3', 'vInstanceColor' )");
    expect(instance).toContain('instanceColor.assign( instanceColorNode );');
  });
});

describe('G1: the sway on numbers, against readings taken from the legacy GLSL', () => {
  // Hand-computed ONCE by a standalone transcription of `swayChunk` and `windGustGlsl` in plain doubles (its own uint32 hash and
  // smoothstep, nothing imported from the module under test), at instance origin (2.5, -1.25), hem 0.8, amp 1, wind strength 1.3 along
  // (0.6, -0.8). [t, mode, dx, dz]: two wind ticks (875 and 999), then the reduced-motion periodic gust inside (45, 22.15) and outside
  // (58.5) its 2.5 s window. `dz` is the swing out from the wall (never into it: 0 where the cloth swings the other way), `dx` the sideways 0.4.
  const ROWS: ReadonlyArray<readonly [number, number, number, number]> = [
    [43.75, 1, -0.013614498532616438, 0],
    [49.95, 1, 0.010844719021813826, 0.027111797554534564],
    [45, 0, 0.003907653215122324, 0.00976913303780581],
    [58.5, 0, -0.0050270881629017414, 0],
    [22.15, 0, 0.0023032908772572295, 0.005758227193143073],
  ];
  const at = (t: number, mode: number, over: Partial<Record<'amp' | 'hem' | 'ox', number>> = {}): { dx: number; dz: number } =>
    bannerSwayOps(NUMBER_OPS, NUMBER_INT_OPS, {
      t, amp: over.amp ?? 1, ox: over.ox ?? 2.5, oz: -1.25, hem: over.hem ?? 0.8, mode, strength: 1.3, dirX: 0.6, dirZ: -0.8,
    });

  it('matches the legacy GLSL at two wind ticks and three periodic-gust ticks', () => {
    for (const [t, mode, dx, dz] of ROWS) {
      const got = at(t, mode);
      expect(got.dx, `dx at t=${t} mode ${mode}`).toBeCloseTo(dx, 12);
      expect(got.dz, `dz at t=${t} mode ${mode}`).toBeCloseTo(dz, 12);
    }
  });
  it('is anti-vacuous: the rows swing, the two modes differ at one tick, a gust moves the wind row, and the swing scales with aHem squared and amp', () => {
    expect(Math.abs(ROWS[1][2])).toBeGreaterThan(0.005);
    expect(ROWS[1][3]).toBeGreaterThan(0.02);
    expect(at(49.95, 1).dz).not.toBeCloseTo(at(49.95, 0).dz, 3);
    expect(at(49.95, 1, { hem: 0.4 }).dz).toBeCloseTo(at(49.95, 1).dz / 4, 12);
    expect(at(49.95, 1, { amp: 0 })).toEqual({ dx: 0, dz: 0 });
    expect(at(49.95, 1, { hem: 0 })).toEqual({ dx: 0, dz: 0 });
    // The per-banner phase: another origin swings differently at the same tick.
    expect(at(49.95, 0, { ox: 7 }).dx).not.toBeCloseTo(at(49.95, 0).dx, 3);
  });
});

describe('the twin, compiled on the banner mesh', () => {
  it('reads the INSTANCED position: batch order, then the swing built from the instance matrix read by instanceIndex', async () => {
    const f = await fixture();
    const main = mainOf(compile(f, f.twin).vertex);
    // three applies the instance matrix first; the twin does not go back to the geometry attribute afterwards.
    const instanced = main.search(/positionLocal = \( buffer\d+\[ uint\( gl_InstanceID \) \] \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
    expect(instanced).toBeGreaterThan(0);
    expect([...main.matchAll(/\bposition\b/g)].length).toBe(1);
    // The twin's own fetch: the matrix of THIS instance, from a buffer node over the instanceMatrix array, by gl_InstanceID...
    const fetch = /(nodeVar\d+) = (buffer\d+)\[ uint\( gl_InstanceID \) \];/.exec(main);
    expect(fetch).not.toBeNull();
    const m = (fetch as RegExpExecArray)[1];
    expect(main.indexOf((fetch as RegExpExecArray)[0])).toBeGreaterThan(instanced);
    // ...its column 3 is the origin the gust and the phase read, its upper 3x3 carries the swing into the object frame.
    expect(main).toContain(`( ${m}[ 3u ].x * `);
    expect(main).toContain(`( ${m}[ 3u ].z * `);
    expect(main).toMatch(new RegExp(`positionLocal = \\( positionLocal \\+ \\( mat3\\( ${m}\\[ 0 \\]\\.xyz, ${m}\\[ 1 \\]\\.xyz, ${m}\\[ 2 \\]\\.xyz \\) \\* vec3\\(`));
  });

  it('G2: every record uniform and both attributes reach the programs', async () => {
    const f = await fixture();
    const built = compile(f, f.twin);
    const b = f.bound;
    for (const k of ['uBannerTime', 'uBannerAmp', 'uWindMode', 'uWindStrength', 'uWindDir'] as const) {
      expect(built.vertexUsed.has(b[k]), `${k} is bound but the vertex program never reads it`).toBe(true);
    }
    expect(built.fragmentUsed.has(b.uBannerGlow), 'uBannerGlow is bound but the fragment program never reads it').toBe(true);
    const vmain = mainOf(built.vertex);
    // aHem: the weight of the swing, squared.
    expect(vmain).toMatch(/nodeVar\d+ = \( aHem \* aHem \);/);
    // aTeam: the colour mix in the vertex program...
    expect(vmain).toMatch(/vInstanceColor = mix\( vec4\( color, 1\.0 \)\.xyz, vInstanceColor, aTeam \);/);
    // ...and the emissive floor in the fragment: glow x the varying that carries aTeam.
    const varying = /(nodeVarying\d+) = aTeam;/.exec(vmain)?.[1];
    expect(varying, 'aTeam is never passed to the fragment').toBeDefined();
    expect(mainOf(built.fragment)).toMatch(new RegExp(`EmissiveColor = \\( DiffuseColor\\.xyz \\* vec3\\( \\( nodeUniform\\d+ \\* ${varying as string} \\) \\) \\);`));
  });

  it('G3: the shadow program keeps the rest pose (castShadowPositionNode), through three\'s own shadow-node choice', async () => {
    const f = await fixture();
    expect(swings(compile(f, f.twin))).toBe(true); // anti-vacuity: the colour program does swing
    // What `Renderer._renderObjectDirect` does for a shadow pass: the override takes the material's positionNode, then whatever
    // `_getShadowNodes` picks (castShadowPositionNode first).
    const shadow = new f.W.NodeMaterial() as unknown as THREE.Material & { isShadowPassMaterial: boolean; positionNode: unknown };
    shadow.isShadowPassMaterial = true;
    shadow.positionNode = f.twin.positionNode;
    const picked = (f.renderer as unknown as { _getShadowNodes(m: THREE.Material): { positionNode: unknown } })._getShadowNodes(f.twin);
    if (picked.positionNode !== null) shadow.positionNode = picked.positionNode;
    const built = compile(f, shadow);
    expect(swings(built)).toBe(false);
    // ...and it is still the INSTANCED rest position (the cloth casts from where it hangs).
    expect(mainOf(built.vertex)).toMatch(/positionLocal = \( buffer\d+\[ uint\( gl_InstanceID \) \] \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
  });

  it('an override pass that three hands positionNode to (the node AO pre-pass) keeps the rest pose, and draws no team colour of its own', async () => {
    const f = await fixture();
    const TSL = await import('three/tsl');
    const normal = new f.W.NodeMaterial() as THREE.Material & { fragmentNode: unknown; positionNode: unknown };
    normal.name = 'rl-node-ao-normal';
    normal.fragmentNode = TSL.vec4(TSL.normalView, 1);
    normal.positionNode = f.twin.positionNode;
    const built = compile(f, normal);
    expect(swings(built)).toBe(false);
    expect(mainOf(built.vertex)).not.toMatch(/vInstanceColor = mix\(/);
    expect(mainOf(built.vertex)).toMatch(/positionLocal = \( buffer\d+\[ uint\( gl_InstanceID \) \] \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
  });

  it('the twin\'s own program carries the colour mix but the vertex colour is not multiplied in a second time', async () => {
    const f = await fixture();
    const built = compile(f, f.twin);
    // The fragment colour is the instance varying times the material colour: no `vColor` multiplication of its own.
    expect(mainOf(built.fragment)).toMatch(/DiffuseColor = vec4\( \( vInstanceColor \* nodeUniform\d+ \), 1\.0 \);/);
    expect(mainOf(built.fragment)).not.toMatch(/\bvColor\b/);
  });
});

describe('G4: the sim clock', () => {
  const update = (n: unknown): void => (n as { update(): void }).update();
  const v = (n: unknown): unknown => (n as { value: unknown }).value;
  /** `ThreeRenderer.frame` writes `sway.time.value = presentationSimMs(tick, alpha) / 1000` once a frame. */
  const writeClock = (f: Fixture, tick: number, alpha: number): void => {
    f.time.value = presentationSimMs(tick, alpha) / 1000;
  };
  const frame = (f: Fixture, tick: number, alpha: number, wallMs: number): number => {
    vi.spyOn(performance, 'now').mockReturnValue(wallMs);
    vi.spyOn(Date, 'now').mockReturnValue(1.7e12 + wallMs);
    writeClock(f, tick, alpha);
    for (const n of Object.values(f.bound)) update(n);
    return v(f.bound.uBannerTime) as number;
  };

  it('two frame cadences reaching one tick leave every input bit-identical; a tick moves the clock; a zero-time repaint moves nothing', async () => {
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
    expect(snapshot()).toEqual(slow);
    // The repaint at zero elapsed time: the loop runs, the sim does not.
    for (const n of Object.values(f.bound)) update(n);
    expect(snapshot()).toEqual(slow);
    // Anti-vacuity: the clock is the sim's, so a tick moves it (and nothing else would).
    expect(frame(f, 61, 0, 1032)).not.toBe(a0);
    // The bound clock is the sim seconds exactly.
    expect(v(f.bound.uBannerTime)).toBe(presentationSimMs(61, 0) / 1000);
  });

  it('the twin binds the objects the legacy splice binds (the material record), not copies', async () => {
    const f = await fixture();
    expect(f.legacy.rlBanner.time).toBe(f.time);
    expect(f.legacy.rlBanner.amp).toBe(f.batch.amp);
    expect(f.legacy.rlBanner.glow).toBe(f.batch.glow);
    expect(f.legacy.rlBanner.wind).toBe(f.batch.wind);
  });

  it('a write to the record reaches the node on the next render update: the debug amplitude, the glow, reduced motion, the heading', async () => {
    const f = await fixture();
    f.batch.amp.value = 0;
    f.batch.glow.value = 0.6;
    f.batch.wind.mode.value = 0;
    f.batch.wind.strength.value = 1.7;
    f.batch.wind.dir.value.set(-0.6, 0.8);
    for (const n of Object.values(f.bound)) update(n);
    expect(v(f.bound.uBannerAmp)).toBe(0);
    expect(v(f.bound.uBannerGlow)).toBe(0.6);
    expect(v(f.bound.uWindMode)).toBe(0);
    expect(v(f.bound.uWindStrength)).toBe(1.7);
    expect(v(f.bound.uWindDir)).toBe(f.batch.wind.dir.value);
    expect((v(f.bound.uWindDir) as THREE.Vector2).toArray()).toEqual([-0.6, 0.8]);
    f.batch.amp.value = 1;
    update(f.bound.uBannerAmp);
    expect(v(f.bound.uBannerAmp)).toBe(1);
  });

  it('the twin\'s source reads no frame delta, wall clock, TSL clock or random', () => {
    const src = readFileSync(join(dirname(new URL(import.meta.url).pathname), 'garrison-banner.node.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const banned of [/\bdtMs\b/, /performance\.now/, /Date\.now/, /Math\.random/, /\bdeltaTime\b/, /\bT\.time\b/, /\bframeId\b/, /\bTSL\.time\b/]) {
      expect(src, String(banned)).not.toMatch(banned);
    }
  });
});

describe('G5: team colour on a viewer swap', () => {
  it('the cloth colour is read from the instanceColor buffer every frame, not copied: a new colour is data, and the program does not change', async () => {
    const f = await fixture();
    const before = compile(f, f.twin);
    const col = f.mesh.instanceColor;
    if (col === null) throw new Error('spec: the banner mesh has no instanceColor');
    const was = Array.from(col.array.slice(0, 6));
    const version = col.version;
    // `setViewer(1)` swaps the two sides' colours; `GarrisonBannerBatch.update` writes the new hex into the same buffer.
    f.batch.update([
      { s: 0, matrix: new THREE.Matrix4().fromArray(f.mesh.instanceMatrix.array, 0), hex: '#CC3333' },
      { s: 1, matrix: new THREE.Matrix4().fromArray(f.mesh.instanceMatrix.array, 16), hex: '#3366CC' },
    ]);
    expect(Array.from(col.array.slice(0, 6))).not.toEqual(was);
    expect(col.version).toBeGreaterThan(version);
    // The colour is a vertex attribute of the instanced mesh, through three's own `vInstanceColor` varying...
    const vmain = mainOf(before.vertex);
    expect(vmain).toMatch(/vInstanceColor = nodeAttribute\d+;/);
    expect(vmain).toMatch(/vInstanceColor = mix\( vec4\( color, 1\.0 \)\.xyz, vInstanceColor, aTeam \);/);
    // ...so no team colour is a literal in either program, and a rebuild after the swap is the same program.
    const after = compile(f, f.twin);
    const shape = (src: string): string => src.replace(/(nodeVar|nodeUniform|nodeVarying|nodeAttribute|buffer|NodeBuffer_)\d+/g, '$1#');
    expect(shape(after.vertex)).toBe(shape(before.vertex));
    expect(shape(after.fragment)).toBe(shape(before.fragment));
    for (const lit of ['0.0331', '0.1329', '0.6038']) expect(before.vertex + before.fragment).not.toContain(lit);
  });
});

describe('the twin as the census and the adoption see it', () => {
  it('is a node material named rl-node-material-garrison-banner, never taken for a legacy banner, and ported (no unported term)', async () => {
    const f = await fixture();
    expect(f.twin.name).toBe(NODE_BANNER_MATERIAL_NAME);
    expect(legacyTwinSlot(f.legacy)).toBe('banner');
    expect(f.legacy.customProgramCacheKey()).toBe(BANNER_HOOK_KEY);
    expect(legacyTwinSlot(f.twin)).toBeNull();
    expect(PORTED_MATERIAL_KEYS.has(BANNER_HOOK_KEY)).toBe(true);
    markTwin(f.twin, f.legacy);
    expect(isTwin(f.twin)).toBe(true);
    // The legacy hook is censused with the option; the twin has no hook and no term.
    const root = new THREE.Group();
    root.add(f.mesh);
    expect(censusUnported(root, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect(censusUnported(root).map((h) => h.key)).toEqual([BANNER_HOOK_KEY]);
    f.mesh.material = f.twin;
    expect(censusUnported(root)).toEqual([]);
  });

  it('carries the ramp look of its legacy material and survives copyRenderState: DoubleSide arrives, vertexColors stays false', async () => {
    const f = await fixture();
    const t = f.twin;
    expect(t.color).toBe(f.legacy.color);
    expect(t.roughness).toBe(f.legacy.roughness);
    expect(t.metalness).toBe(f.legacy.metalness);
    expect(t.isMeshStandardMaterial).toBe(true);
    expect(f.legacy.vertexColors).toBe(true);
    copyRenderState(f.legacy, t);
    expect(t.side).toBe(THREE.DoubleSide);
    expect(t.vertexColors).toBe(false);
    for (const k of RENDER_STATE_KEYS) if (k !== 'vertexColors') expect((t as unknown as Record<string, unknown>)[k], k).toBe((f.legacy as unknown as Record<string, unknown>)[k]);
    // And the program that results still carries no vertex-colour multiplication.
    expect(compile(f, t).fragment).not.toMatch(/\bvColor\b/);
  });

  it('the batch keeps room in a uniform buffer for the matrices (128 x 64 B), the limit the twin checks', () => {
    // three's own instance matrix is a `buffer` node up to the backend's limit; WebGL2's minimum is 16 KiB.
    expect(128 * 16 * 4).toBeLessThanOrEqual(16384);
  });
});
