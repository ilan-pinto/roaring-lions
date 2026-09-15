/**
 * Wiring test for `mesh-vehicle-death.ts` INTO `ThreeRenderer` -- the prune
 * loop's hand-off, `stepVehicleDeaths`, the `addWreck` guard, the
 * billboard-death skip in `onEvents`, and `dispose()`.
 * `units/mesh-vehicle-death.test.ts` already proves every function in that
 * module correct in isolation; this file proves `ThreeRenderer` calls them at
 * the right moment and, just as importantly, that it does NOT call them for a
 * vehicle whose GLB has no `wreck` clip. Harness and `vi.mock` stand-in copied
 * from `ThreeRenderer.mesh-death.test.ts` and
 * `ThreeRenderer.vehicle-mesh-anim.test.ts` -- read either for what the fake
 * `WebGLRenderer` does and does not prove.
 *
 * `mbt_lavi` is the unit type throughout because it is the one the whole
 * feature is about: a real key in `vehicle-mesh-role.ts`'s closed ramp table,
 * and the vehicle whose billboard sheet (`TNK_HULL`) declares no `wreck`
 * clip at all, so before this a destroyed Lavi left nothing but the overlay's
 * grey cross.
 *
 * Per this project's own testing standard: every assertion below that matters
 * was verified by breaking the corresponding line in `ThreeRenderer.ts` by
 * hand and confirming the SPECIFIC test named goes red, then reverting.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import type { DyingVehicle } from './units/mesh-vehicle-death';
import type { MeshWreck } from './units/mesh-death';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

/** `data/units/mbt_lavi.json` in the fields these paths read. `isSoft` falls
 *  out of the armour, which is what routes it down `onEvents`' vehicle-kill
 *  branch as well. */
const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 1800, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};

interface UnitWreckRow {
  typeId: string;
}
interface DyingBillboardRow {
  typeId: string;
}

interface ThreeRendererPrivates {
  scene: THREE.Scene;
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  vehicleDying: DyingVehicle[];
  meshWrecks: MeshWreck[];
  wrecks: UnitWreckRow[];
  dying: DyingBillboardRow[];
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  addWreck(x: number, y: number, facing: number, typeId: string, side: number): void;
}

/** `withWreck: false` is the pre-wreck-pass GLB every shipped vehicle was
 *  until 2026-09-15, and the state `&nomesh` and any un-passed re-export are
 *  still in -- the case that must keep the billboard path byte for byte. */
async function setUp(withWreck: boolean) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const typeIdx = sim.addUnitType(LAVI);
  const id = sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;

  const gltf = await parseRigidFixture({
    parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
    clipNames: withWreck ? ['idle', 'wreck'] : ['idle'],
    ...(withWreck ? { deathRoot: { parts: ['hull_hull'] } } : {}),
  });
  const template = buildVehicleMeshTemplate(gltf, LAVI.id);
  expect(template.hasWreck).toBe(withWreck); // the precondition every test below turns on
  priv.vehicleMeshTemplates.set(LAVI.id, template);

  renderer.snapshot();
  renderer.snapshot();
  return { sim, renderer, priv, id };
}

describe('updateVehicleMeshes death hand-off', () => {
  it('hands a newly-dead wreck-bearing vehicle to vehicleDying instead of disposing it on the spot', async () => {
    const { sim, priv, id } = await setUp(true);
    priv.updateVehicleMeshes(1, 16);
    const root = priv.vehicleMeshEntities.get(id)?.root;
    expect(root).toBeDefined();

    sim.debugKill(id);
    priv.updateVehicleMeshes(1, 16);

    // Break check (verified by hand, then reverted): put back the old
    // unconditional `scene.remove` + `disposeVehicleMeshEntity`. `vehicleDying`
    // then reads 0 and the root is gone from the scene -- both go red.
    expect(priv.vehicleMeshEntities.has(id)).toBe(false);
    expect(priv.vehicleDying).toHaveLength(1);
    expect(priv.scene.children).toContain(root);
  });

  it('still removes a vehicle whose GLB has no wreck clip immediately -- the old path, unchanged', async () => {
    const { sim, priv, id } = await setUp(false);
    priv.updateVehicleMeshes(1, 16);
    const root = priv.vehicleMeshEntities.get(id)?.root;

    sim.debugKill(id);
    priv.updateVehicleMeshes(1, 16);

    expect(priv.vehicleDying).toHaveLength(0);
    expect(priv.meshWrecks).toHaveLength(0);
    expect(priv.scene.children).not.toContain(root);
  });

  it('steps a dying vehicle every frame and round-trips it to a persisted MeshWreck', async () => {
    const { sim, priv, id } = await setUp(true);
    priv.updateVehicleMeshes(1, 16);
    const root = priv.vehicleMeshEntities.get(id)?.root;

    sim.debugKill(id);
    priv.updateVehicleMeshes(1, 16); // death starts, t = 0

    // Break check (verified by hand, then reverted): delete the
    // `this.stepVehicleDeaths(dtSeconds)` call. `vehicleDying` stays at 1
    // forever and `meshWrecks` stays empty -- both go red.
    for (let i = 0; i < 20; i++) priv.updateVehicleMeshes(1, 200);

    expect(priv.vehicleDying).toHaveLength(0);
    expect(priv.meshWrecks).toHaveLength(1);
    expect(priv.meshWrecks[0].root).toBe(root);
    expect(priv.scene.children).toContain(root);
  });

  it('prunes a REMOVED vehicle immediately -- an abduction must never draw as a death', async () => {
    const { sim, priv, id } = await setUp(true);
    priv.updateVehicleMeshes(1, 16);
    const root = priv.vehicleMeshEntities.get(id)?.root;

    sim.state.alive[id] = 0;
    sim.state.removed[id] = 1;
    priv.updateVehicleMeshes(1, 16);

    // Break check: drop the `st.removed[id] === 0` clause. `vehicleDying`
    // reads 1 instead of 0 and this goes red.
    expect(priv.vehicleDying).toHaveLength(0);
    expect(priv.meshWrecks).toHaveLength(0);
    expect(priv.scene.children).not.toContain(root);
  });

  it('dispose() tears down every dying vehicle', async () => {
    const { sim, renderer, priv, id } = await setUp(true);
    priv.updateVehicleMeshes(1, 16);
    sim.debugKill(id);
    priv.updateVehicleMeshes(1, 16); // mid-fade, in vehicleDying

    // Break check: comment out the `vehicleDying` teardown block in
    // `dispose()`. This reads 1 and goes red.
    renderer.dispose();
    expect(priv.vehicleDying).toHaveLength(0);
    expect(priv.meshWrecks).toHaveLength(0);
  });
});

describe('the billboard path steps aside, and only for a type that has a mesh wreck coming', () => {
  it('addWreck pushes no sprite wreck for a wreck-bearing vehicle type', async () => {
    const { priv } = await setUp(true);
    priv.addWreck(3, 4, 0, LAVI.id, 0);
    // Break check: delete the `vehicleMeshTemplates.get(typeId)?.hasWreck`
    // guard in `addWreck`. This reads 1 and goes red -- and on screen it is
    // a flat sprite wreck lying underneath the 3D one.
    expect(priv.wrecks).toHaveLength(0);
  });

  it('addWreck STILL pushes one for a mesh vehicle without the clip -- CLAUDE.md\'s recorded trap', async () => {
    const { priv } = await setUp(false);
    priv.addWreck(3, 4, 0, LAVI.id, 0);
    // Break check: widen the guard to a bare `vehicleMeshTemplates.has(typeId)`.
    // This reads 0 and goes red: excluding every mesh vehicle unconditionally
    // deletes the sprite wreck and leaves nothing at all behind.
    expect(priv.wrecks).toHaveLength(1);
    expect(priv.wrecks[0].typeId).toBe(LAVI.id);
  });

  it('addWreck is untouched for a type with no vehicle mesh template at all', async () => {
    const { priv } = await setUp(true);
    priv.addWreck(3, 4, 0, 'inf_squad', 0);
    expect(priv.wrecks).toHaveLength(1);
  });

  it('onEvents queues no billboard death fade for a wreck-bearing vehicle -- no sprite ever flashes', async () => {
    const { sim, renderer, priv, id } = await setUp(true);
    renderer.onEvents([{ kind: 'destroyed', entity: id, by: id, tick: sim.tickCount }]);
    // Break check: remove the `hasWreck` condition around `this.dying.push`.
    // This reads 1 and goes red -- on screen, a flat sprite of the INTACT
    // tank fading on top of its own slumping mesh.
    expect(priv.dying).toHaveLength(0);
  });

  it('onEvents STILL queues one for a vehicle without the clip', async () => {
    const { sim, renderer, priv, id } = await setUp(false);
    renderer.onEvents([{ kind: 'destroyed', entity: id, by: id, tick: sim.tickCount }]);
    expect(priv.dying).toHaveLength(1);
    expect(priv.dying[0].typeId).toBe(LAVI.id);
  });
});
