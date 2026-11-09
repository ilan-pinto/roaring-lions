/**
 * @vitest-environment jsdom
 *
 * GH-943 P2 (T6) gates for `decor-mesh.node.ts`, the node foliage twin. The twin is compiled on a real `BatchedMesh` (the one
 * `buildDecorMesh` makes) by three's own `GLSLNodeBuilder` (no GPU), so these read the generated vertex program, not a mock. Each has
 * a one-line falsification, run by hand and listed in the commit message:
 *  - batch ordering: read `positionGeometry` instead of the batched `positionLocal` in the twin;
 *  - the shadow keeps the rest pose: drop `twin.castShadowPositionNode`;
 *  - an override pass keeps the rest pose: delete the `builder.material` guard in the twin's position graph;
 *  - the record drives the twin: bind `uSwayAmp` by value (`T.uniform(sway.amp.value)`, no update);
 *  - the origin is the batching matrix's translation: fetch column 2 (`x.add(2)`) instead of 3.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDecorMesh, type SwayUniforms, type SwayingFoliageMaterial } from './decor-mesh';
import { makeWindUniforms } from './wind-uniforms';
import { createFoliageTwinFactory, nodeFoliageBindings, FOLIAGE_UNPORTED_TERMS, type FoliageBindings } from './decor-mesh.node';
import { MATERIAL_MATHS } from '../material-maths';
import { UNPORTED_TERMS_KEY, censusUnported } from '../backend/unported';
import { legacyTwinSlot } from '../node-material-adoption';

type W = typeof import('three/webgpu');

interface Fixture {
  readonly W: W;
  readonly sway: SwayUniforms;
  readonly mesh: THREE.BatchedMesh;
  readonly legacy: SwayingFoliageMaterial;
  readonly twin: THREE.Material & { positionNode: unknown; castShadowPositionNode: unknown };
  readonly bound: FoliageBindings;
  readonly renderer: InstanceType<W['WebGPURenderer']>;
}

/** A foliage (or trunk) batch as the renderer builds it, two instances off the origin, and the twin the backend's factory makes. */
async function fixture(opts: { wet?: boolean; role?: 'foliage' | 'trunk' } = {}): Promise<Fixture> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const role = opts.role ?? 'foliage';
  const parts = new Map([['tree_0', [{ role, geometry: new THREE.BoxGeometry() }]]]);
  const sway: SwayUniforms = { time: { value: 3.25 }, amp: { value: 1 }, wind: makeWindUniforms() };
  const group = buildDecorMesh(
    [
      { family: 'tree', variant: 0, x: 4.5, z: 7.25, y: 0.5, yawTurns: 0.125, scale: 1.2 },
      { family: 'tree', variant: 0, x: 11, z: 2, y: 0, yawTurns: 0, scale: 1 },
    ],
    { parts },
    sway,
    undefined,
    opts.wet ?? false
  );
  const mesh = group.children[0] as THREE.BatchedMesh;
  const legacy = mesh.material as SwayingFoliageMaterial;
  const twin = createFoliageTwinFactory({ W, TSL, maths: MATERIAL_MATHS.foliage })(legacy) as Fixture['twin'];
  const bound = nodeFoliageBindings(twin);
  if (bound === null) throw new Error('spec: the twin registered no bindings');
  const renderer = new W.WebGPURenderer({ forceWebGL: true });
  // `getDrawIndex` reads the backend's extension list; an uninitialised renderer has none (the instance-index path).
  (renderer as unknown as { backend: { extensions: { has(): boolean } } }).backend.extensions = { has: () => false };
  return { W, sway, mesh, legacy, twin, bound, renderer };
}

interface Built {
  readonly vertex: string;
  readonly used: ReadonlySet<unknown>;
}

/** The vertex program three builds for `material` drawing `mesh`. */
function compile(f: Fixture, material: THREE.Material): Built {
  const builder = new f.W.GLSLNodeBuilder(f.mesh, f.renderer) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    vertexShader: string;
    uniforms: { vertex: Array<{ node: unknown }> };
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  builder.build();
  return { vertex: builder.vertexShader, used: new Set(builder.uniforms.vertex.map((u) => u.node)) };
}

const mainOf = (src: string): string => src.slice(src.indexOf('void main()'));
/** The wind is in a program iff it reads the nature attribute (no rest-pose program has any reason to). */
const leans = (b: Built): boolean => /\brlNature\b/.test(mainOf(b.vertex));

/** three's own source file, read from the installed package (for the text pins against 0.186.1). */
function threeSource(rel: string): string {
  const root = dirname(dirname(createRequire(import.meta.url).resolve('three')));
  return readFileSync(join(root, 'src', rel), 'utf8');
}

describe('three 0.186.1, the facts the twin is built on', () => {
  it('REVISION 186: batch() runs before positionNode, the shadow pass prefers castShadowPositionNode, and an override pass is handed positionNode', () => {
    // Falsify: bump three. Each line below is the reason a piece of the twin exists.
    expect(THREE.REVISION).toBe('186');
    const setup = threeSource('materials/nodes/NodeMaterial.js');
    const pos = setup.slice(setup.indexOf('setupPosition( builder ) {'));
    expect(pos.indexOf('batch( object );')).toBeGreaterThan(0);
    expect(pos.indexOf('batch( object );')).toBeLessThan(pos.indexOf("positionLocal.assign( subBuild( this.positionNode, 'POSITION', 'vec3' ) );"));
    const renderer = threeSource('renderers/common/Renderer.js');
    expect(renderer).toMatch(/if \( material\.castShadowPositionNode && material\.castShadowPositionNode\.isNode \) \{\s*positionNode = material\.castShadowPositionNode;\s*\} else if \( material\.positionNode/);
    expect(renderer).toMatch(/if \( material\.positionNode && material\.positionNode\.isNode \) \{\s*overrideMaterial\.positionNode = material\.positionNode;/);
  });

  it("the batching matrix fetch: texel 4 * id + k of a size-wide matrices texture, at the indirect id batch() writes to vBatchIndirectId", () => {
    const batch = threeSource('nodes/accessors/Batch.js');
    expect(batch).toContain('const j = float( id ).mul( 4 ).toInt().toConst();');
    expect(batch).toContain('textureLoad( matricesTexture, ivec2( x.add( 3 ), y ) )');
    expect(batch).toContain("varyingProperty( 'uint', 'vBatchIndirectId' )");
    expect(batch).toContain('batchIndirectIndex.assign( indirectId );');
  });

  it('the matrices texture holds the instance matrix column-major, so texel 4 * id + 3 is its translation', async () => {
    const f = await fixture();
    const tex = (f.mesh as unknown as { _matricesTexture: THREE.DataTexture })._matricesTexture;
    const data = tex.image.data as Float32Array;
    const m = new THREE.Matrix4();
    for (let id = 0; id < 2; id++) {
      f.mesh.getMatrixAt(id, m);
      const t = new THREE.Vector3().setFromMatrixPosition(m);
      expect(Array.from(data.subarray((4 * id + 3) * 4, (4 * id + 3) * 4 + 3))).toEqual([t.x, t.y, t.z].map(Math.fround));
    }
    // Anti-vacuity: the instances are really off the origin, and apart.
    expect(Array.from(data.subarray(12, 15))).toEqual([4.5, 0.5, 7.25]);
    expect(Array.from(data.subarray(28, 31))).toEqual([11, 0, 2]);
  });
});

describe('the twin, compiled on a BatchedMesh', () => {
  it('reads the BATCHED position: the attribute is read once, batch() transforms it, and the lean is built from the result', async () => {
    const f = await fixture();
    const main = mainOf(compile(f, f.twin).vertex);
    const batched = main.search(/positionLocal = \( nodeVar\d+ \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
    expect(batched).toBeGreaterThan(0);
    // `position` (the geometry attribute) is read exactly once, to seed positionLocal: nothing after batch() goes back to it.
    expect([...main.matchAll(/\bposition\b/g)].length).toBe(1);
    // The rest position the lean reads is the batched positionLocal, in world space, after the batch line.
    const rest = main.search(/nodeVar\d+ = \( nodeUniform\d+ \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
    expect(rest).toBeGreaterThan(batched);
    expect(main.indexOf('rlNature')).toBeGreaterThan(batched);
  });

  it("fetches the origin with three's own matrix fetch: the same sampler, the indirect id batch() wrote, column 3", async () => {
    const f = await fixture();
    const main = mainOf(compile(f, f.twin).vertex);
    // three's column 3 of the batching matrix (the fetch it builds the whole matrix from).
    const sampler = /nodeVar\d+ = int\( textureSize\( (nodeUniform\d+), 0 \)\.x \);\s*nodeVar\d+ = int\( \( float\( nodeVar\d+ \) \* 4\.0 \) \);/.exec(main)?.[1];
    expect(sampler).toBeDefined();
    const s = sampler as string;
    // The twin's fetch: one texel, at 4 * vBatchIndirectId + 3, of that sampler.
    const mine = new RegExp(
      `ivec2\\( \\( \\( int\\( \\( float\\( vBatchIndirectId \\) \\* 4\\.0 \\) \\) % int\\( textureSize\\( ${s}, 0 \\)\\.x \\) \\) \\+ 3 \\), ` +
        `\\( int\\( \\( float\\( vBatchIndirectId \\) \\* 4\\.0 \\) \\) / int\\( textureSize\\( ${s}, 0 \\)\\.x \\) \\) \\)`
    );
    expect(main).toMatch(mine);
    // Its .xyz goes through the model matrix into the origin var the lean reads.
    expect(main).toMatch(/nodeVar\d+ = \( nodeUniform\d+ \* vec4\( nodeVar\d+\.xyz, 1\.0 \) \)\.xyz;/);
  });

  it('the shadow program keeps the rest pose (castShadowPositionNode), through three\'s own shadow-node choice', async () => {
    const f = await fixture();
    expect(leans(compile(f, f.twin))).toBe(true); // anti-vacuity: the colour program does lean
    // What `Renderer._renderObjectDirect` does for a shadow pass: the override takes the material's positionNode, then whatever
    // `_getShadowNodes` picks (castShadowPositionNode first).
    const shadow = new f.W.NodeMaterial() as unknown as THREE.Material & { isShadowPassMaterial: boolean; positionNode: unknown };
    shadow.isShadowPassMaterial = true;
    shadow.positionNode = f.twin.positionNode;
    const picked = (f.renderer as unknown as { _getShadowNodes(m: THREE.Material): { positionNode: unknown } })._getShadowNodes(f.twin);
    if (picked.positionNode !== null) shadow.positionNode = picked.positionNode;
    expect(leans(compile(f, shadow))).toBe(false);
  });

  it('an override pass that three hands positionNode to (the node AO pre-pass) keeps the rest pose', async () => {
    const f = await fixture();
    const TSL = await import('three/tsl');
    // The AO pre-pass's normal material (`post-chain.node.ts`), as three's override path leaves it for this object.
    const normal = new f.W.NodeMaterial() as THREE.Material & { fragmentNode: unknown; positionNode: unknown };
    normal.name = 'rl-node-ao-normal';
    normal.fragmentNode = TSL.vec4(TSL.normalView, 1);
    normal.positionNode = f.twin.positionNode;
    const built = compile(f, normal);
    expect(leans(built)).toBe(false);
    // ...and it is still the batched rest position, not the unbatched one.
    expect(mainOf(built.vertex)).toMatch(/positionLocal = \( nodeVar\d+ \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
  });

  it('every record uniform reaches the program', async () => {
    const f = await fixture();
    const { used } = compile(f, f.twin);
    for (const [name, node] of Object.entries(f.bound)) expect(used.has(node), `${name} is bound but the program never reads it`).toBe(true);
  });
});

describe('the record drives the twin (the legacy objects, by reference)', () => {
  const update = (n: unknown): void => (n as { update(): void }).update();

  it('a write to the record reaches the node on the next render update: the wind layer, the clock, reduced motion, the heading', async () => {
    const f = await fixture();
    const wind = f.sway.wind;
    if (wind === undefined) throw new Error('spec: no wind set');
    f.sway.amp.value = 0;
    f.sway.time.value = 12.5;
    wind.mode.value = 0;
    wind.strength.value = 1.7;
    wind.dir.value.set(-0.6, 0.8);
    for (const n of Object.values(f.bound)) update(n);
    const v = (n: unknown): unknown => (n as { value: unknown }).value;
    expect(v(f.bound.uSwayAmp)).toBe(0);
    expect(v(f.bound.uSwayTime)).toBe(12.5);
    expect(v(f.bound.uWindMode)).toBe(0);
    expect(v(f.bound.uWindStrength)).toBe(1.7);
    expect(v(f.bound.uWindDir)).toBe(wind.dir.value);
    expect((v(f.bound.uWindDir) as THREE.Vector2).toArray()).toEqual([-0.6, 0.8]);
    // And back: the layer toggles, it does not latch.
    f.sway.amp.value = 1;
    update(f.bound.uSwayAmp);
    expect(v(f.bound.uSwayAmp)).toBe(1);
  });

  it('the twin binds the objects the legacy splice binds (the material record), not copies', async () => {
    const f = await fixture();
    expect(f.legacy.rlSway.time).toBe(f.sway.time);
    expect(f.legacy.rlSway.amp).toBe(f.sway.amp);
    expect(f.legacy.rlSway.wind).toBe(f.sway.wind);
  });
});

describe('the twin as the census and the adoption see it', () => {
  it('is a node material named rl-node-material-*, never taken for a legacy foliage material, and declares the disturbers it does not draw', async () => {
    const f = await fixture();
    expect(f.twin.name).toBe('rl-node-material-foliage-sway');
    expect(legacyTwinSlot(f.legacy)).toBe('foliage');
    expect(legacyTwinSlot(f.twin)).toBeNull();
    expect((f.twin.userData as Record<string, unknown>)[UNPORTED_TERMS_KEY]).toEqual(['rl-foliage-sway: disturb']);
    expect(FOLIAGE_UNPORTED_TERMS).toEqual(['rl-foliage-sway: disturb']);
    // The legacy material never carries the twin's terms.
    expect((f.legacy.userData as Record<string, unknown>)[UNPORTED_TERMS_KEY]).toBeUndefined();
    const root = new THREE.Group();
    f.mesh.material = f.twin;
    root.add(f.mesh);
    expect(censusUnported(root)).toEqual([{ kind: 'partial', key: 'rl-foliage-sway: disturb', objects: 1 }]);
  });

  it('carries the ramp look of its legacy material: the colour (shared), roughness, metalness, and is a standard material for the env registry', async () => {
    const f = await fixture();
    const t = f.twin as unknown as THREE.MeshStandardMaterial;
    expect(t.color).toBe(f.legacy.color);
    expect(t.roughness).toBe(f.legacy.roughness);
    expect(t.metalness).toBe(f.legacy.metalness);
    expect(t.isMeshStandardMaterial).toBe(true);
  });

  it('the four variants: one name each, from the legacy key', async () => {
    const names = await Promise.all(
      ([[false, 'foliage'], [true, 'foliage'], [false, 'trunk'], [true, 'trunk']] as const).map(async ([wet, role]) => (await fixture({ wet, role })).twin.name)
    );
    expect(names).toEqual(['rl-node-material-foliage-sway', 'rl-node-material-foliage-sway-wet', 'rl-node-material-trunk-sway', 'rl-node-material-trunk-sway-wet']);
  });

  it('wet and trunk are graph choices: the wet program carries the rain gust and gain, the trunk program a legacy amplitude of 0', async () => {
    const dry = mainOf(compile(await fixture(), (await fixture()).twin).vertex);
    const wf = await fixture({ wet: true });
    const wet = mainOf(compile(wf, wf.twin).vertex);
    const tf = await fixture({ role: 'trunk' });
    const trunk = mainOf(compile(tf, tf.twin).vertex);
    // The legacy branch's amplitude literal opens its product: 0.035 dry, 0.035 x 2.2 wet, 0 on a trunk.
    const legacyAmp = (src: string): string | undefined => /= \( \( \( \( ([0-9.e-]+) \* nodeVar\d+ \) \* nodeVar\d+ \) \* \( 1\.0 \+/.exec(src)?.[1];
    expect(legacyAmp(dry)).toBe('0.035');
    expect(Number(legacyAmp(wet))).toBeCloseTo(0.035 * 2.2, 12);
    expect(legacyAmp(trunk)).toBe('0.0');
    // The wind branch: the wet gain 3.0 replaces the class table's 1.5, and the amplitude is multiplied by 2.2.
    expect(wet).toContain('( 3.0 - 1.0 )');
    expect(dry).not.toContain('( 3.0 - 1.0 )');
    expect(wet).toContain('* 2.2 )');
  });
});
