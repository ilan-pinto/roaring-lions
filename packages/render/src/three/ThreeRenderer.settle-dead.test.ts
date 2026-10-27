/**
 * `ThreeRenderer.settleDead()` -- `Renderer.settleDead` (`../api.ts`), snapshot S4's D4.
 *
 * A seat that rejoins from a snapshot restores a world at tick T and has watched no death, so the
 * renderer makes nothing for what died before T (`seedFromSim` seeds positions, fog and trail, not
 * wrecks). `settleDead` queues those slots and the frames that load the templates draw each as the
 * wreck or body a watched death settles into. This file replays that on a real `Sim` and a real
 * `ThreeRenderer` with the fixture templates the sibling death specs use, and asks:
 *  - which dead slots are drawn, and which are skipped (a removed unit, a kamikaze, a swarm);
 *  - that what is drawn is SETTLED: nothing mid-death, the wreck clip's final pose, no light, shake,
 *    hit-stop or decal (with a control that proves the same readbacks see a watched death);
 *  - that a slot is drawn once, however many frames or calls follow;
 *  - the fog rule a watched wreck has, and that a structure needs no call at all.
 *
 * One stand-in, as every sibling: `init()` needs a live WebGL context, so `seedFromSim()` (the whole
 * of what `init()` derives from the sim) is called directly. No browser here; the Metal witness is
 * the network stage's Task 16.
 *
 * Every assertion that matters was watched going red under a one-line mutation of the implementation
 * (recorded in the commit body).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { EmitterSpec } from '../vfx/emitters';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import type { DyingVehicle } from './units/mesh-vehicle-death';
import { buildMeshUnitTemplate, type MeshUnitTemplate, type MeshUnitEntity } from './units/mesh-unit';
import { parseFixture } from './units/mesh-fixture';
import { meshYawFromFacing } from './units/mesh-anim';
import type { DyingMeshUnit, MeshWreck } from './units/mesh-death';
import catastrophicJson from '../../../../data/vfx/catastrophic_kill.json';
import missileImpactJson from '../../../../data/vfx/missile_impact.json';
import swarmJson from '../../../../data/units/enemy/drone_swarm.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
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
  haze: '#E0B87A',
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

const INF: UnitTypeJson = {
  id: 'mesh_test_inf',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};
/** Armour 700 is a hard hull, so a watched death of it takes `onEvents`' vehicle-kill branch (the burst). */
const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 1800, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};
/** `data/units/kdf/attack_drone.json` in the fields these paths read: `isKamikaze` is the point. */
const DRONE: UnitTypeJson = {
  id: 'attack_drone',
  role: 'drone',
  hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.8, domain: 'air' },
  sensors: { optics: 1.4, sight_tiles: 13 },
  abilities: ['kamikaze'],
  weapons: [
    {
      id: 'warhead', type: 'heat', range_tiles: 1.2, effective_range_tiles: 1.2, accuracy: 0.9,
      penetration: 480, damage: 520, splash_tiles: 1.2, suppression: 70, rof_per_min: 6,
      can_target: ['ground', 'structure'],
    },
  ],
};
const SWARM = swarmJson as unknown as UnitTypeJson;

const W = 24;
const H = 24;
const EMITTERS = [catastrophicJson, missileImpactJson] as unknown as EmitterSpec[];

interface Privates {
  seedFromSim(): void;
  scene: THREE.Scene;
  meshUnitTemplates: Map<string, MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  meshDying: DyingMeshUnit[];
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  vehicleDying: DyingVehicle[];
  meshWrecks: MeshWreck[];
  updateMeshUnits(alpha: number, dtMs: number): void;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  shakeState: { live: unknown[] };
  flashLights: { liveCount: number };
  decalsPersistent: { liveCount: number };
  hitStop: { remainingMs: number };
}

interface World {
  sim: Sim;
  renderer: ThreeRenderer;
  priv: Privates;
  ids: {
    live: number;
    inf: number;
    lavi: number;
    removed: number;
    drone: number;
    swarm: number;
    far: number;
    farLavi: number;
  };
}

/**
 * A 24x24 world. A living rifle section stands at (4.5, 4.5), its sight covering the NW corner. Before
 * the renderer exists:
 *  - `inf` and `lavi` are killed in sight (`debugKill`);
 *  - `removed` is taken off the board (`removeFromPlay`: an abduction, not a death);
 *  - `drone` (a kamikaze) and `swarm` (a drone swarm) are killed;
 *  - `far` and `farLavi` are killed at (20.5, 20.5) and (18.5, 20.5), outside everything the living
 *    section can see.
 * Every dead type has a template that WOULD draw it, so a slot left out is left out by the renderer's
 * rule and not for lack of art.
 */
async function world(opts: { events?: 'watch' } = {}): Promise<World> {
  const sim = new Sim({ seed: 1, width: W, height: H, capacity: 16 });
  const inf = sim.addUnitType(INF);
  const lavi = sim.addUnitType(LAVI);
  const drone = sim.addUnitType(DRONE);
  const swarm = sim.addUnitType(SWARM);

  const live = sim.spawn(inf, 0, fx.from(4.5), fx.from(4.5));
  const deadInf = sim.spawn(inf, 1, fx.from(6.5), fx.from(4.5));
  const deadLavi = sim.spawn(lavi, 1, fx.from(5.5), fx.from(7.5));
  const removed = sim.spawn(inf, 1, fx.from(7.5), fx.from(5.5));
  const deadDrone = sim.spawn(drone, 1, fx.from(6.5), fx.from(6.5));
  const deadSwarm = sim.spawn(swarm, 1, fx.from(7.5), fx.from(7.5));
  const far = sim.spawn(inf, 1, fx.from(20.5), fx.from(20.5));
  const farLavi = sim.spawn(lavi, 1, fx.from(18.5), fx.from(20.5));
  // A quarter turn, so a wreck that ignored the sim's facing would read 0.
  sim.state.facing[deadInf] = fx.from(0.25);
  sim.state.facing[deadLavi] = fx.from(0.25);
  sim.debugKill(deadInf);
  sim.debugKill(deadLavi);
  sim.removeFromPlay(removed);
  sim.debugKill(deadDrone);
  sim.debugKill(deadSwarm);
  sim.debugKill(far);
  sim.debugKill(farLavi);
  // `debugKill` queued `destroyed` events; a rejoin's renderer never sees them. The control reads them.
  const events: SimEvent[] = sim.tick();

  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.useEmitters(EMITTERS, (k) => (k.startsWith('#') ? k : '#E6D8BE'));
  const priv = renderer as unknown as Privates;

  const infGltf = await parseFixture({ roleName: 'uniform', clipName: ['idle', 'down', 'wreck'] });
  priv.meshUnitTemplates.set(INF.id, [buildMeshUnitTemplate(infGltf, 'kdf')]);
  for (const t of [LAVI, DRONE, SWARM]) {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'wreck'],
      deathRoot: { parts: ['hull_hull'] },
    });
    priv.vehicleMeshTemplates.set(t.id, buildVehicleMeshTemplate(gltf, t.id));
  }

  priv.seedFromSim();
  if (opts.events === 'watch') renderer.onEvents(events);
  return {
    sim, renderer, priv,
    ids: { live, inf: deadInf, lavi: deadLavi, removed, drone: deadDrone, swarm: deadSwarm, far, farLavi },
  };
}

/** Frames that load templates and draw: both mesh paths, a few of them. */
function frames(w: World, n = 4): void {
  for (let k = 0; k < n; k++) {
    w.priv.updateMeshUnits(1, 16);
    w.priv.updateVehicleMeshes(1, 16);
  }
}

describe('ThreeRenderer.settleDead', () => {
  it('premise: a restored world draws nothing for the dead until settleDead is called', async () => {
    const w = await world();
    frames(w);
    expect(w.priv.meshWrecks).toHaveLength(0);
    expect(w.priv.meshDying).toHaveLength(0);
    expect(w.priv.vehicleDying).toHaveLength(0);
  });

  it('control: the same readbacks see a WATCHED death (so the zeros below mean something)', async () => {
    const w = await world({ events: 'watch' });
    expect(w.priv.flashLights.liveCount).toBeGreaterThan(0);
    expect(w.priv.decalsPersistent.liveCount).toBeGreaterThan(0);
    expect(w.priv.hitStop.remainingMs).toBeGreaterThan(0);
    expect(w.priv.shakeState.live.length).toBeGreaterThan(0);
  });

  it('draws the vehicle and the two infantrymen killed before the snapshot as settled wrecks, with nothing mid-death', async () => {
    const w = await world();
    w.renderer.settleDead();
    frames(w);
    const drawn = w.priv.meshWrecks.length;
    // inf, lavi, far, farLavi: the four bodies with a wreck to leave.
    expect(drawn).toBe(4);
    expect(w.renderer.debugSettle()).toEqual({ pending: 0, taken: 4, wrecks: 4 });
    // Settled: nothing is mid-death, and nothing was handed a live entity to become one.
    expect(w.priv.meshDying).toHaveLength(0);
    expect(w.priv.vehicleDying).toHaveLength(0);
    expect(w.priv.meshUnitEntities.size).toBe(1); // the living section only
    expect(w.priv.vehicleMeshEntities.size).toBe(0);
    for (const wreck of w.priv.meshWrecks) expect(w.priv.scene.children).toContain(wreck.root);
  });

  it('leaves nothing for a removed unit, a kamikaze or a swarm, though each has a template that would draw it', async () => {
    const w = await world();
    w.renderer.settleDead();
    const taken = w.renderer.debugSettle().taken;
    expect(taken).toBe(4); // inf, lavi, far, farLavi -- not removed, drone, swarm
    frames(w, 8);
    const at = (x: number, z: number): MeshWreck[] =>
      w.priv.meshWrecks.filter((m) => Math.abs(m.x - x) < 0.01 && Math.abs(m.y - z) < 0.01);
    expect(at(7.5, 5.5)).toHaveLength(0); // removed
    expect(at(6.5, 6.5)).toHaveLength(0); // kamikaze
    expect(at(7.5, 7.5)).toHaveLength(0); // swarm
    expect(at(6.5, 4.5)).toHaveLength(1); // the control: a real body at its own place
    expect(at(5.5, 7.5)).toHaveLength(1);
  });

  it('emits no light, shake, hit-stop or decal, and replays no death', async () => {
    const w = await world();
    w.renderer.settleDead();
    frames(w, 8);
    expect(w.priv.meshWrecks).toHaveLength(4);
    expect(w.priv.flashLights.liveCount).toBe(0);
    expect(w.priv.shakeState.live).toHaveLength(0);
    expect(w.priv.decalsPersistent.liveCount).toBe(0);
    expect(w.priv.hitStop.remainingMs).toBe(0);
  });

  it('draws the wreck clip in its final pose: the infantry body clamped, the vehicle on its death root', async () => {
    const w = await world();
    w.renderer.settleDead();
    frames(w);
    const wrecks = w.priv.meshWrecks;
    const body = wrecks.find((m) => Math.abs(m.x - 6.5) < 0.01 && Math.abs(m.y - 4.5) < 0.01);
    const hull = wrecks.find((m) => Math.abs(m.x - 5.5) < 0.01 && Math.abs(m.y - 7.5) < 0.01);
    if (!body || !hull) throw new Error('expected both wrecks');
    // The fixture's `wreck` clip turns its bone 90 degrees about X; idle leaves it at rest.
    let turned = 0;
    body.root.traverse((o) => {
      if ((o as THREE.Bone).isBone && Math.abs(o.quaternion.x) > 0.7) turned++;
    });
    expect(turned).toBeGreaterThan(0);
    // On the ground at its own tile, as `stepMeshDeath` hands a settled body over.
    expect(body.root.position.x).toBeCloseTo(6.5, 6);
    expect(body.root.position.z).toBeCloseTo(4.5, 6);
    // The hull: the wreck group shown, the live nodes hidden (`stepVehicleDeath`'s own hand-off).
    const death = hull.root.children.find((c) => c.name === 'death_root');
    expect(death?.visible).toBe(true);
    const live = hull.root.children.find((c) => c.name.startsWith('hull'));
    expect(live?.visible).toBe(false);
  });

  it('draws each slot once: later frames and a second call add nothing', async () => {
    const w = await world();
    w.renderer.settleDead();
    frames(w, 6);
    expect(w.priv.meshWrecks).toHaveLength(4);
    w.renderer.settleDead();
    frames(w, 6);
    expect(w.priv.meshWrecks).toHaveLength(4);
    expect(w.renderer.debugSettle()).toEqual({ pending: 0, taken: 4, wrecks: 4 });
  });

  it('settleDead before any template has loaded keeps the queue and draws once they have', async () => {
    const w = await world();
    const infTemplates = w.priv.meshUnitTemplates.get(INF.id)!;
    const laviTemplate = w.priv.vehicleMeshTemplates.get(LAVI.id)!;
    w.priv.meshUnitTemplates.delete(INF.id);
    w.priv.vehicleMeshTemplates.delete(LAVI.id);
    w.renderer.settleDead();
    frames(w);
    expect(w.priv.meshWrecks).toHaveLength(0);
    expect(w.renderer.debugSettle().pending).toBe(4);
    w.priv.meshUnitTemplates.set(INF.id, infTemplates);
    w.priv.vehicleMeshTemplates.set(LAVI.id, laviTemplate);
    frames(w);
    expect(w.priv.meshWrecks).toHaveLength(4);
    expect(w.renderer.debugSettle().pending).toBe(0);
  });

  it('draws at most 24 settled bodies a frame, so a long match does not hitch the first frame', async () => {
    const sim = new Sim({ seed: 1, width: W, height: H, capacity: 64 });
    const inf = sim.addUnitType(INF);
    const ids: number[] = [];
    for (let k = 0; k < 30; k++) ids.push(sim.spawn(inf, 1, fx.from(2.5 + (k % 10)), fx.from(2.5 + Math.floor(k / 10))));
    for (const id of ids) sim.debugKill(id);
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as Privates;
    priv.meshUnitTemplates.set(INF.id, [buildMeshUnitTemplate(await parseFixture({ roleName: 'uniform', clipName: ['idle', 'down', 'wreck'] }), 'kdf')]);
    priv.seedFromSim();
    renderer.settleDead();
    priv.updateMeshUnits(1, 16);
    expect(priv.meshWrecks).toHaveLength(24);
    expect(renderer.debugSettle().pending).toBe(6);
    priv.updateMeshUnits(1, 16);
    expect(priv.meshWrecks).toHaveLength(30);
    expect(renderer.debugSettle().pending).toBe(0);
  });

  it('applies the fog a watched wreck has: unexplored ground stays hidden, a seen tile shows, body and hull alike', async () => {
    const w = await world();
    w.renderer.settleDead();
    frames(w);
    const wreckAt = (x: number, z: number): MeshWreck => {
      const m = w.priv.meshWrecks.find((c) => Math.abs(c.x - x) < 0.01 && Math.abs(c.y - z) < 0.01);
      if (!m) throw new Error(`no wreck at ${x}, ${z}`);
      return m;
    };
    for (const [x, z] of [[6.5, 4.5], [5.5, 7.5]]) {
      expect(wreckAt(x, z).shown).toBe(true);
      expect(wreckAt(x, z).root.visible).toBe(true);
    }
    for (const [x, z] of [[20.5, 20.5], [18.5, 20.5]]) {
      expect(wreckAt(x, z).shown).toBe(false);
      expect(wreckAt(x, z).root.visible).toBe(false);
    }
  });

  it('lays each body down facing the way the sim says it faced', async () => {
    const w = await world();
    w.renderer.settleDead();
    frames(w);
    const yaw = meshYawFromFacing(0.25);
    const body = w.priv.meshWrecks.find((m) => Math.abs(m.x - 6.5) < 0.01 && Math.abs(m.y - 4.5) < 0.01);
    const hull = w.priv.meshWrecks.find((m) => Math.abs(m.x - 5.5) < 0.01 && Math.abs(m.y - 7.5) < 0.01);
    if (!body || !hull) throw new Error('expected both wrecks');
    expect(yaw).not.toBeCloseTo(0, 3); // the premise: a wreck that ignored facing would read 0
    expect(body.root.rotation.y).toBeCloseTo(yaw, 6);
    expect(hull.root.rotation.y).toBeCloseTo(yaw, 6);
  });

  it('a structure collapsed before the seed draws as rubble with no settleDead call', async () => {
    // The structure half of Ruling 10: rubble is drawn from `structures.alive`, which a restore carries.
    const sim = new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
    const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
    const idx = sim.addStructure(type, [0]);
    sim.structures.alive[idx] = 0;
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as {
      seedFromSim(): void;
      buildingMeshIdleTemplates: Map<string, { root: THREE.Group; materials: never[]; geometries: never[] }>;
      buildingMeshWreckTemplates: Map<string, { root: THREE.Group; materials: never[]; geometries: never[] }>;
      buildingMeshWreckEntities: Map<number, THREE.Object3D>;
      buildingMeshIdleEntities: Map<number, THREE.Object3D>;
      updateBuildingMeshes(): void;
    };
    priv.seedFromSim();
    priv.buildingMeshIdleTemplates.set('shanty', { root: new THREE.Group(), materials: [], geometries: [] });
    priv.buildingMeshWreckTemplates.set('shanty', { root: new THREE.Group(), materials: [], geometries: [] });
    priv.updateBuildingMeshes();
    expect(priv.buildingMeshWreckEntities.has(idx)).toBe(true);
    expect(priv.buildingMeshIdleEntities.has(idx)).toBe(false);
  });

  it('is a no-op on a world with no dead, and leaves a living unit to the live path', async () => {
    const sim = new Sim({ seed: 1, width: W, height: H, capacity: 4 });
    const inf = sim.addUnitType(INF);
    const id = sim.spawn(inf, 0, fx.from(4.5), fx.from(4.5));
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as Privates;
    priv.seedFromSim();
    renderer.settleDead();
    expect(renderer.debugSettle()).toEqual({ pending: 0, taken: 0, wrecks: 0 });
    expect(sim.state.alive[id]).toBe(1);
  });
});
