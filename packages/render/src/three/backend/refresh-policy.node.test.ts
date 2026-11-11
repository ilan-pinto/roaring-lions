/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T14b, GH-1152) F2 end to end, on REAL unit twins: built by the backend's own factory from real legacy materials (a
 * team variant, a running-gear clone, a death-fade clone, a scar), compiled by three's own `GLSLNodeBuilder`, so the update nodes
 * the policy classifies are the ones three will run. Then driven through the real `installRefreshPolicy` with one render object per
 * pass (scene and shadow), as `Renderer` makes them.
 *
 * - G2c: every per-object update node of every unit twin is keyed (three's own, or declared by the twin): `undeclared` is empty.
 * - The reviewer's pin (PR 1237 nit 3): a parked unit goes SHARED, and a MOVING unit, a FADING unit and a unit whose wheels turn
 *   are FULL in both passes that frame. A parked benchmark and parked baselines cannot see a stale uniform; this can.
 *
 * Falsifications (run by hand, in the commit message):
 *  - G2c: drop the `declared.push` from `objectUniform` in `unit-material.node.ts`: `UniformNode:uUnitOpacity` (and the colour,
 *    roughness, metalness) are undeclared and the G2c spec goes red;
 *  - the pin: skip `uUnitOpacity` in the twin's declared reader: the fade reads SHARED and goes red.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VehicleTeamMaterials, TeamMaskSlots } from '../units/team-mask';
import { VehicleScarMaterials } from '../units/vehicle-damage';
import { beginMeshDeathFade, setMeshDeathOpacity } from '../units/mesh-death';
import { parseRunningGear, type RunningGearSpec } from '../units/running-gear';
import { bindRunningGear, runningGearBinding } from '../units/running-gear-binding';
import type { VehicleMeshEntity } from '../units/mesh-vehicle';
import { adoptUnits, builderRenderer, laviMaterial, taggedGeometry, unitDeps, type UnitDeps } from '../units/unit-twin.test-support';
import { classifyUpdateNodes, installRefreshPolicy, objectBindings, REFRESH, type BindingGroupLike, type NodesLike, type RenderObjectLike, type UpdateNodeLike } from './refresh-policy';
import { objectInputsOf } from './object-inputs';

const SPEC = parseRunningGear(
  { rl_running_gear: { version: 1, wheels: [{ side: 'r', index: 0, centre: [0, 0.4, 1], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 }], tracks: [{ side: 'r', loopLength: 6, pitch: 0.2, gauge: 1 }] } },
  'fixture'
) as RunningGearSpec;

interface Program {
  readonly updateNodes: UpdateNodeLike[];
  readonly bindings: BindingGroupLike[];
}
/** The program three's builder makes for `material` drawing `mesh`: the update nodes `NodeManager.updateForRender` will run, and the
 *  REAL bind groups (`NodeBuilder.getBindings`, what `RenderObject.getBindings` hands three's `Bindings`). */
function programOf(d: UnitDeps, mesh: THREE.Object3D, material: THREE.Material): Program {
  const builder = new d.W.GLSLNodeBuilder(mesh, builderRenderer(d)) as unknown as { scene: THREE.Scene; camera: THREE.Camera; material: unknown; build(): void; updateNodes: UpdateNodeLike[]; getBindings(): BindingGroupLike[] };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = material;
  builder.build();
  return { updateNodes: [...builder.updateNodes], bindings: builder.getBindings() };
}

const singletons = (d: UnitDeps): Set<unknown> => new Set<unknown>([d.TSL.modelNormalMatrix, d.TSL.modelWorldMatrixInverse]);

function ro(mesh: THREE.Mesh, camera: THREE.Camera, updateNodes: UpdateNodeLike[], bindings: BindingGroupLike[] = []): RenderObjectLike {
  const state = { updateNodes };
  return {
    object: mesh as unknown as RenderObjectLike['object'],
    material: mesh.material as THREE.Material,
    geometry: mesh.geometry as unknown as RenderObjectLike['geometry'],
    camera: camera as unknown as RenderObjectLike['camera'],
    getMonitor: () => ({ hasNode: true, hasAnimation: false }),
    getNodeBuilderState: () => state,
    getBindings: () => bindings,
  };
}

interface World {
  readonly d: UnitDeps;
  readonly meshes: { readonly rg: THREE.Mesh; readonly faded: THREE.Mesh; readonly scarred: THREE.Mesh; readonly plain: THREE.Mesh };
  readonly fade: ReturnType<typeof beginMeshDeathFade>;
  readonly rgEntity: VehicleMeshEntity;
}

async function world(): Promise<World> {
  const d = await unitDeps();
  const slots = new TeamMaskSlots(['#2F6FD9', '#D93A2B', '#F2E8D5']);
  const variant = new VehicleTeamMaterials(slots).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
  const scene = new THREE.Scene();
  // A running-gear vehicle.
  const rgBase = laviMaterial();
  rgBase.userData = {};
  const rgRoot = new THREE.Object3D();
  const rg = new THREE.Mesh(taggedGeometry(1, 0.5), rgBase);
  rgRoot.add(rg);
  const rgEntity = { root: rgRoot, liveTop: [rg] } as unknown as VehicleMeshEntity;
  if (bindRunningGear(rgEntity, SPEC) === null) throw new Error('spec: nothing tagged');
  // A fading vehicle, a scarred one and a plain team variant.
  const fadeRoot = new THREE.Group().add(new THREE.Mesh(taggedGeometry(0), variant));
  const fade = beginMeshDeathFade(fadeRoot);
  const scarred = new THREE.Mesh(taggedGeometry(0), new VehicleScarMaterials().materialFor(variant, 2));
  const plain = new THREE.Mesh(taggedGeometry(0), variant);
  scene.add(rgRoot, fadeRoot, scarred, plain);
  adoptUnits(d, scene);
  scene.updateMatrixWorld(true);
  return { d, meshes: { rg, faded: fadeRoot.children[0] as THREE.Mesh, scarred, plain }, fade, rgEntity };
}

describe('G2c: every per-object update node of a unit twin is keyed', () => {
  it('the running-gear, fade, scar and team-variant twins: nothing undeclared, so the policy may downgrade them', async () => {
    const w = await world();
    for (const [name, mesh] of Object.entries(w.meshes)) {
      const twin = mesh.material as THREE.Material;
      const prog = programOf(w.d, mesh, twin);
      expect(objectBindings(prog.bindings), `${name}: a binding kind the policy does not key`).not.toBeNull();
      const nodes = prog.updateNodes;
      expect(nodes.length, `${name}: no update nodes at all (the spec reads nothing)`).toBeGreaterThan(0);
      expect(objectInputsOf(twin), `${name}: the twin declares nothing`).toBeDefined();
      const plan = classifyUpdateNodes(nodes, objectInputsOf(twin), singletons(w.d));
      expect(plan.undeclared, name).toEqual([]);
      expect(plan.downgradable).toBe(true);
    }
  });
});

describe('a converted stock material is keyed too (1098 of the 1732 candidates at n600)', () => {
  it('a standard node material with a map, and a basic one: nothing undeclared', async () => {
    const d = await unitDeps();
    for (const m of [new d.W.MeshStandardNodeMaterial({ map: new THREE.DataTexture(new Uint8Array(4), 1, 1), roughness: 0.5 }), new d.W.MeshBasicNodeMaterial({ color: 0x808080 })]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), m as unknown as THREE.Material);
      const prog = programOf(d, mesh, m as unknown as THREE.Material);
      expect(objectBindings(prog.bindings), `${m.type}: a binding kind the policy does not key`).not.toBeNull();
      const plan = classifyUpdateNodes(prog.updateNodes, undefined, singletons(d));
      expect(plan.undeclared, m.type).toEqual([]);
      expect(plan.referenceNodes.length, `${m.type}: no material reference keyed`).toBeGreaterThan(0);
    }
  });
});

describe('the pin (PR 1237 nit 3): a moving, fading or turning unit stays FULL in both passes', () => {
  it('parked goes SHARED; a move, a fade step and a wheel turn are FULL in the scene AND the shadow render object', async () => {
    const w = await world();
    const nodes: NodesLike = { needsRefresh: () => REFRESH.FULL };
    installRefreshPolicy(nodes, {}, 'parked', singletons(w.d));
    const cam = new THREE.OrthographicCamera();
    const sun = new THREE.OrthographicCamera();
    cam.updateMatrixWorld();
    sun.updateMatrixWorld();
    const pair = (m: THREE.Mesh): [RenderObjectLike, RenderObjectLike] => {
      // Each pass's render object gets its OWN bindings, as three makes them (`RenderObject.getBindings` per render object).
      const a = programOf(w.d, m, m.material as THREE.Material);
      const b = programOf(w.d, m, m.material as THREE.Material);
      return [ro(m, cam, a.updateNodes, a.bindings), ro(m, sun, b.updateNodes, b.bindings)];
    };
    const ros = { rg: pair(w.meshes.rg), faded: pair(w.meshes.faded), scarred: pair(w.meshes.scarred), plain: pair(w.meshes.plain) };
    const frame = (): Record<keyof typeof ros, number[]> => {
      const out = {} as Record<keyof typeof ros, number[]>;
      for (const k of Object.keys(ros) as (keyof typeof ros)[]) out[k] = ros[k].map((r) => nodes.needsRefresh(r));
      return out;
    };
    frame();
    frame();
    const parked = frame();
    for (const k of Object.keys(parked) as (keyof typeof ros)[]) expect(parked[k], `${k} parked`).toEqual([REFRESH.SHARED, REFRESH.SHARED]);

    // A move.
    w.meshes.plain.position.x += 0.25;
    w.meshes.plain.updateMatrixWorld();
    let f = frame();
    expect(f.plain, 'moved').toEqual([REFRESH.FULL, REFRESH.FULL]);
    expect(f.scarred, 'the still neighbour').toEqual([REFRESH.SHARED, REFRESH.SHARED]);
    expect(frame().plain, 'parked again').toEqual([REFRESH.SHARED, REFRESH.SHARED]);

    // A fade step (the legacy clone's opacity, read per object).
    setMeshDeathOpacity(w.fade, 0.5);
    f = frame();
    expect(f.faded, 'fading').toEqual([REFRESH.FULL, REFRESH.FULL]);
    expect(frame().faded).toEqual([REFRESH.SHARED, REFRESH.SHARED]);

    // A wheel turn (what `writeRunningGearUniforms` writes into the clone's own uniform objects every moving frame).
    const u = runningGearBinding(w.rgEntity)?.uniforms[0];
    if (u === undefined) throw new Error('spec: unbound');
    u.uRgRot.value[0]?.set(0, 1, 1, 0);
    f = frame();
    expect(f.rg, 'wheels turning').toEqual([REFRESH.FULL, REFRESH.FULL]);
    expect(frame().rg).toEqual([REFRESH.SHARED, REFRESH.SHARED]);
  });
});

describe('a uniform with NO update type, written by app code (the advisor\'s hole: it is in no update node)', () => {
  it('a plain `uniform(Color)` colour node mutated in place, and a number uniform assigned: FULL that frame', async () => {
    const d = await unitDeps();
    const tint = d.TSL.uniform(new THREE.Color(0.2, 0.3, 0.4));
    const gain = d.TSL.uniform(1);
    const m = new d.W.MeshBasicNodeMaterial();
    m.colorNode = d.TSL.vec4(tint.mul(gain), 1) as never;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), m as unknown as THREE.Material);
    mesh.updateMatrixWorld();
    const prog = programOf(d, mesh, m as unknown as THREE.Material);
    const cam = new THREE.OrthographicCamera();
    cam.updateMatrixWorld();
    const nodes: NodesLike = { needsRefresh: () => REFRESH.FULL };
    installRefreshPolicy(nodes, {}, 'parked', singletons(d));
    const r = ro(mesh, cam, prog.updateNodes, prog.bindings);
    nodes.needsRefresh(r);
    nodes.needsRefresh(r);
    expect(nodes.needsRefresh(r), 'parked').toBe(REFRESH.SHARED);
    (tint.value as THREE.Color).setRGB(0.9, 0.1, 0.1);
    expect(nodes.needsRefresh(r), 'colour mutated in place').toBe(REFRESH.FULL);
    expect(nodes.needsRefresh(r)).toBe(REFRESH.SHARED);
    gain.value = 0.5;
    expect(nodes.needsRefresh(r), 'number assigned').toBe(REFRESH.FULL);
  });
});
