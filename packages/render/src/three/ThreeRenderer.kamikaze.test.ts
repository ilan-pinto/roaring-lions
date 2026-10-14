/**
 * GH-85: a kamikaze's warhead going off draws a detonation -- `missile_impact`
 * through the same path a missile landing takes, a scorch through
 * `stampGroundDecal` -- and the munition leaves no wreck and no corpse.
 *
 * The detonation is driven through the REAL `Sim.stepKamikaze` wherever the
 * sim can reach it (a drone diving on a soft body and on a hull), so the
 * inference `onEvents` makes -- `destroyed` + `isKamikaze` + `by ===
 * curTarget` -- is tested against what the sim actually leaves behind and
 * not against a fixture that agrees with it. The negative cases are
 * synthetic `destroyed` events, each one field away from a strike.
 *
 * Harness and `vi.mock` stand-in from `ThreeRenderer.vfx-triggers.test.ts`
 * (read `ThreeRenderer.blast.test.ts`'s top comment for why a real
 * `WebGLRenderer` cannot construct here). The emitters are the SHIPPED JSON.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { EmitterSpec, ParticleSpec } from '../vfx/emitters';
import type { DecalStamp } from './decal-maths';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import type { DyingVehicle } from './units/mesh-vehicle-death';
import { buildMeshUnitTemplate, type MeshUnitTemplate, type MeshUnitEntity } from './units/mesh-unit';
import { parseFixture } from './units/mesh-fixture';
import type { DyingMeshUnit } from './units/mesh-death';
import { KAMIKAZE_BLAST_POWER } from './units/kamikaze-blast';
import { scorchRadiusTiles } from './scorch-decals';
import missileImpactJson from '../../../../data/vfx/missile_impact.json';
import catastrophicJson from '../../../../data/vfx/catastrophic_kill.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
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

const MISSILE_IMPACT = missileImpactJson as unknown as EmitterSpec;
const CATASTROPHIC = catastrophicJson as unknown as EmitterSpec;
const ALL = [MISSILE_IMPACT, CATASTROPHIC];

/** `data/units/kdf/attack_drone.json` in the fields `stepKamikaze` reads. */
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
/** `charge_squad` the same way: a foot kamikaze, the corpse case. */
const CHARGER: UnitTypeJson = {
  ...DRONE,
  id: 'charge_squad',
  role: 'infantry',
  hull: { hp: 190, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1.9 },
};
/** No weapon, so it cannot shoot the munition down: every death below is a strike. */
const SOFT: UnitTypeJson = {
  id: 'digger_crew', role: 'infantry', hull: { hp: 300, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1, sight_tiles: 1 }, weapons: [],
};
/** Armour 300 is past `SOFT_ARMOR_LIMIT`, so a strike is an `impact` event,
 *  and 2400 hp (the D9's own) survives a 520-damage warhead -- no vehicle-kill blast to confuse the reading. */
const HULL: UnitTypeJson = {
  id: 'dozer_d9', role: 'engineer', hull: { hp: 2400, armor: { front: 300, side: 300, rear: 300 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1, sight_tiles: 1 }, weapons: [],
};

interface Privates {
  particleSystem: { spawn(spec: ParticleSpec, ...rest: unknown[]): void } | null;
  flashLights: { liveCount: number };
  decalsPersistent: { liveCount: number };
  stampGroundDecal(s: DecalStamp): boolean;
  hitStop: { remainingMs: number };
  scene: THREE.Scene;
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  vehicleDying: DyingVehicle[];
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  meshUnitTemplates: Map<string, MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  meshDying: DyingMeshUnit[];
  updateMeshUnits(alpha: number, dtMs: number): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

interface World {
  sim: Sim;
  r: ThreeRenderer;
  munition: number;
  target: number;
  /** Every emitter layer spawned, by owning emitter id. */
  log: string[];
  /** Every ground stamp, in order. */
  stamps: DecalStamp[];
}

function world(munitionJson: UnitTypeJson, targetJson: UnitTypeJson, gap = 4): World {
  const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 16 });
  const m = sim.addUnitType(munitionJson);
  const t = sim.addUnitType(targetJson);
  const munition = sim.spawn(m, 0, fx.from(20.5), fx.from(24.5));
  const target = sim.spawn(t, 1, fx.from(20.5 + gap), fx.from(24.5));
  const r = new ThreeRenderer(sim, makeOpts());
  r.useEmitters(ALL, (k) => (k.startsWith('#') ? k : '#E6D8BE'));
  r.snapshot();
  r.snapshot();
  const owner = new Map<ParticleSpec, string>();
  for (const em of ALL) for (const l of em.particles) owner.set(l, em.id);
  const ps = priv(r).particleSystem;
  if (ps === null) throw new Error('fixture: useEmitters built no ParticleSystem');
  const log: string[] = [];
  const realSpawn = ps.spawn.bind(ps);
  ps.spawn = (spec: ParticleSpec, ...rest: unknown[]): void => {
    log.push(owner.get(spec) ?? 'flat');
    realSpawn(spec, ...rest);
  };
  const stamps: DecalStamp[] = [];
  const realStamp = priv(r).stampGroundDecal.bind(r);
  priv(r).stampGroundDecal = (s: DecalStamp): boolean => {
    stamps.push(s);
    return realStamp(s);
  };
  return { sim, r, munition, target, log, stamps };
}

/** `main.ts`'s `runTick` without audio or missions. */
function tickUntil(sim: Sim, r: ThreeRenderer, done: (e: SimEvent) => boolean, cap = 600): SimEvent {
  for (let i = 0; i < cap; i++) {
    const events = sim.tick();
    r.snapshot();
    r.onEvents(events);
    const hit = events.find(done);
    if (hit) return hit;
  }
  throw new Error('the event never came');
}

const detonated = (w: World) => (e: SimEvent): boolean => e.kind === 'destroyed' && e.entity === w.munition;

describe('a kamikaze warhead draws a detonation (GH-85)', () => {
  it('on a soft target: missile_impact, a light, a shake, and a scorch where it went off', () => {
    const w = world(DRONE, SOFT);
    const e = tickUntil(w.sim, w.r, detonated(w));
    // The precondition the whole inference rests on: the sim's own strike.
    expect(e.kind === 'destroyed' && e.by).toBe(w.target);
    expect(w.sim.state.curTarget[w.munition]).toBe(w.target);
    expect(w.sim.state.alive[w.target]).toBe(0); // 520 damage on a 300 hp body
    // Break check: `isKamikazeDetonation` -> `return false` turns all four red.
    expect(w.log.filter((id) => id === 'missile_impact').length).toBeGreaterThan(0);
    expect(priv(w.r).flashLights.liveCount).toBe(1);
    const scorch = w.stamps.filter((s) => s.kind === 'scorch');
    expect(scorch).toHaveLength(1);
    expect(scorch[0].halfLength).toBeCloseTo(scorchRadiusTiles(KAMIKAZE_BLAST_POWER));
    // At the target, where the sim centres the splash.
    expect(scorch[0].x).toBeCloseTo(fx.toNumber(w.sim.state.posX[w.target]), 5);
    expect(scorch[0].z).toBeCloseTo(fx.toNumber(w.sim.state.posY[w.target]), 5);
    // Not a vehicle kill: the catastrophic package stays out of it.
    expect(w.log).not.toContain('catastrophic_kill');
    expect(priv(w.r).hitStop.remainingMs).toBe(0);
    w.r.dispose();
  });

  it('on armour: the same detonation, not just the flat flash', () => {
    const w = world(DRONE, HULL);
    tickUntil(w.sim, w.r, detonated(w));
    expect(w.sim.state.alive[w.target]).toBe(1); // the hull survives: nothing else is lighting it
    expect(w.log.filter((id) => id === 'missile_impact').length).toBeGreaterThan(0);
    expect(priv(w.r).flashLights.liveCount).toBe(1);
    expect(w.stamps.filter((s) => s.kind === 'scorch')).toHaveLength(1);
    w.r.dispose();
  });

  it('a foot kamikaze (charge_squad) goes off the same way', () => {
    const w = world(CHARGER, SOFT);
    tickUntil(w.sim, w.r, detonated(w));
    expect(w.log.filter((id) => id === 'missile_impact').length).toBeGreaterThan(0);
    expect(w.stamps.filter((s) => s.kind === 'scorch')).toHaveLength(1);
    w.r.dispose();
  });

  it('a tick far behind the live edge keeps the scorch and throws no burst', () => {
    const w = world(DRONE, SOFT);
    w.r.setQuiet(true);
    tickUntil(w.sim, w.r, detonated(w));
    expect(w.log).not.toContain('missile_impact');
    expect(priv(w.r).flashLights.liveCount).toBe(0);
    expect(w.stamps.filter((s) => s.kind === 'scorch')).toHaveLength(1);
    w.r.dispose();
  });
});

/** A synthetic `destroyed` for the munition, with `alive` cleared and
 *  `curTarget` set the way the sim leaves them. */
function killMunition(w: World, by: number, curTarget: number): void {
  w.sim.state.alive[w.munition] = 0;
  w.sim.state.curTarget[w.munition] = curTarget;
  w.r.onEvents([{ kind: 'destroyed', tick: 1, entity: w.munition, by } as unknown as SimEvent]);
}

describe('and only for a detonation', () => {
  it('not for a kamikaze killed by nobody', () => {
    const w = world(DRONE, SOFT, 1);
    killMunition(w, -1, -1);
    expect(w.log).not.toContain('missile_impact');
    expect(w.stamps).toHaveLength(0);
    w.r.dispose();
  });

  it('not for a kamikaze killed by something other than its target', () => {
    const w = world(DRONE, SOFT, 1);
    killMunition(w, w.target, -1);
    expect(w.log).not.toContain('missile_impact');
    expect(w.stamps).toHaveLength(0);
    w.r.dispose();
  });

  it('not for a kamikaze its own target shot down from outside the strike reach', () => {
    const w = world(DRONE, SOFT, 6);
    killMunition(w, w.target, w.target);
    expect(w.log).not.toContain('missile_impact');
    expect(w.stamps).toHaveLength(0);
    w.r.dispose();
  });

  it('not for a unit that is not a kamikaze, killed by its own target at arm\'s length', () => {
    const w = world({ ...DRONE, id: 'plain', abilities: [] }, SOFT, 1);
    killMunition(w, w.target, w.target);
    expect(w.log).not.toContain('missile_impact');
    expect(w.stamps).toHaveLength(0);
    w.r.dispose();
  });
});

describe('a detonated munition leaves nothing behind (GH-85)', () => {
  async function withDroneMesh(w: World): Promise<void> {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'wreck'],
      deathRoot: { parts: ['hull_hull'] },
    });
    const template = buildVehicleMeshTemplate(gltf, DRONE.id);
    expect(template.hasWreck).toBe(true); // the precondition: this GLB WOULD leave a wreck
    priv(w.r).vehicleMeshTemplates.set(DRONE.id, template);
  }

  it('a drone that went off leaves no wreck', async () => {
    const w = world(DRONE, SOFT);
    await withDroneMesh(w);
    priv(w.r).updateVehicleMeshes(1, 16);
    const root = priv(w.r).vehicleMeshEntities.get(w.munition)?.root;
    expect(root).toBeDefined();
    tickUntil(w.sim, w.r, detonated(w));
    priv(w.r).updateVehicleMeshes(1, 16);
    // Break check: drop the `detonated` test from the prune loop's fork and
    // the drone takes the wreck path -- `vehicleDying` reads 1.
    expect(priv(w.r).vehicleMeshEntities.has(w.munition)).toBe(false);
    expect(priv(w.r).vehicleDying).toHaveLength(0);
    expect(priv(w.r).scene.children).not.toContain(root);
    w.r.dispose();
  });

  it('a drone killed any other way still leaves its wreck -- the control', async () => {
    const w = world(DRONE, SOFT);
    await withDroneMesh(w);
    priv(w.r).updateVehicleMeshes(1, 16);
    killMunition(w, -1, -1);
    priv(w.r).updateVehicleMeshes(1, 16);
    expect(priv(w.r).vehicleDying).toHaveLength(1);
    w.r.dispose();
  });

  async function withChargerMesh(w: World): Promise<void> {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: ['idle', 'down'] });
    priv(w.r).meshUnitTemplates.set(CHARGER.id, [buildMeshUnitTemplate(gltf, 'enemy')]);
  }

  it('a charge carrier that went off leaves no corpse', async () => {
    const w = world(CHARGER, SOFT);
    await withChargerMesh(w);
    priv(w.r).updateMeshUnits(1, 16);
    const root = priv(w.r).meshUnitEntities.get(w.munition)?.root;
    expect(root).toBeDefined();
    tickUntil(w.sim, w.r, detonated(w));
    priv(w.r).updateMeshUnits(1, 16);
    expect(priv(w.r).meshUnitEntities.has(w.munition)).toBe(false);
    expect(priv(w.r).meshDying).toHaveLength(0);
    expect(priv(w.r).scene.children).not.toContain(root);
    w.r.dispose();
  });

  it('a charge carrier killed any other way still falls -- the control', async () => {
    const w = world(CHARGER, SOFT);
    await withChargerMesh(w);
    priv(w.r).updateMeshUnits(1, 16);
    killMunition(w, -1, -1);
    priv(w.r).updateMeshUnits(1, 16);
    expect(priv(w.r).meshDying).toHaveLength(1);
    w.r.dispose();
  });
});
