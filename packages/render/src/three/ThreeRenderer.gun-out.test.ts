import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { vehicleGunOutDrawn } from './units/gun-out';
import { GUN_OUT_FIRE_LIFT_TILES, GUN_OUT_FIRE_REACH_TILES, liftShiftTiles } from './units/gun-out-fx';
import vehicleDamagedSmoke from '../../../../data/vfx/vehicle_damaged_smoke.json';
import puffJson from '../../../../data/vfx/gun_out_puff.json';
import fireJson from '../../../../data/vfx/gun_out_fire.json';
import type { EmitterSpec } from '../vfx/emitters';

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


const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 1800, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};

interface Privates {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  particleSystem: { spawn: (...a: unknown[]) => void } | null;
  fog: Uint8Array;
  reducedPrefNow: boolean;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  beginGunOutFx(entity: number, tick: number): void;
  updateGunOutFx(alpha: number): void;
}

/** One spawn the renderer made: which layer (by sprite) and at what magnitude. */
interface Spawn {
  sprite: string;
  magnitude: number;
  tick: number;
  x: number;
  y: number;
}

async function setUp(opts: { reduced?: boolean } = {}) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const id = sim.spawn(sim.addUnitType(LAVI), 0, fx.from(9.5), fx.from(11.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.useEmitters([puffJson, fireJson, vehicleDamagedSmoke] as unknown as EmitterSpec[], () => '#8E9491');
  const priv = renderer as unknown as Privates;
  const gltf = await parseRigidFixture({
    parts: [
      { nodeName: 'hull_hull', extrasRole: 'hull' },
      { nodeName: 'turret_hull', extrasRole: 'hull' },
      { nodeName: 'turret_metal', extrasRole: 'metal' },
    ],
    pivot: { pivotName: 'turret_pivot', pivotChildren: [1, 2] },
    clipNames: ['idle', 'wreck'],
    deathRoot: { parts: ['hull_hull'] },
  });
  priv.vehicleMeshTemplates.set(LAVI.id, buildVehicleMeshTemplate(gltf, LAVI.id));
  renderer.snapshot();
  renderer.snapshot();
  priv.fog.fill(2);
  priv.reducedPrefNow = opts.reduced === true;
  const log: Spawn[] = [];
  const system = priv.particleSystem;
  if (!system) throw new Error('no particle system');
  const inner = system.spawn.bind(system);
  system.spawn = (...args: unknown[]): void => {
    const spec = args[0] as { sprite: string };
    const isGunOut = (spec.sprite === 'soft_dot' || spec.sprite === 'spark') || (spec.sprite === 'smoke_puff' && (args[4] as number) === 0.5);
    if (isGunOut) log.push({ sprite: spec.sprite, magnitude: args[4] as number, tick: sim.tickCount, x: args[1] as number, y: args[2] as number });
    inner(...args);
  };
  const barrel = (): THREE.Mesh => {
    const e = priv.vehicleMeshEntities.get(id);
    if (!e) throw new Error('no entity');
    let found: THREE.Mesh | null = null;
    e.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name === 'turret_metal' && m.userData.rl_wreck !== true) found = m;
    });
    if (!found) throw new Error('no barrel');
    return found;
  };
  const setGunOut = (on: boolean): void => {
    (sim.state.firepowerKilled as Uint8Array)[id] = on ? 1 : 0;
  };
  /** Knocks the gun out now, then runs `seconds` of sim time with a frame each tick. */
  const run = (seconds: number, perTick?: () => void): void => {
    for (let t = 0; t < seconds * 20; t++) {
      sim.tick();
      priv.updateGunOutFx(1);
      perTick?.();
    }
  };
  return { sim, renderer, priv, id, barrel, setGunOut, run, log };
}

describe('the droop hook in updateVehicleMeshes', () => {
  it('draws the shipped barrel until the sim says the gun is out, bends it then, and restores it on repair', async () => {
    const h = await setUp();
    h.priv.updateVehicleMeshes(1, 16);
    const shipped = h.barrel().geometry;
    expect(vehicleGunOutDrawn(h.priv.vehicleMeshEntities.get(h.id) as VehicleMeshEntity)).toBe(false);
    h.priv.updateVehicleMeshes(1, 16);
    // Break check: apply the droop unconditionally (`const gunOut = true`) -> the shipped barrel is gone here.
    expect(h.barrel().geometry).toBe(shipped);

    h.setGunOut(true);
    h.priv.updateVehicleMeshes(1, 16);
    // Break check: delete the `applyGunOut` call in the hook -> the geometry stays the shipped one.
    expect(h.barrel().geometry).not.toBe(shipped);

    h.setGunOut(false);
    h.priv.updateVehicleMeshes(1, 16);
    expect(h.barrel().geometry).toBe(shipped);
    h.renderer.dispose();
  });

  it('keeps the droop under reduced motion (only the flicker goes)', async () => {
    const h = await setUp({ reduced: true });
    h.priv.updateVehicleMeshes(1, 16);
    const shipped = h.barrel().geometry;
    h.setGunOut(true);
    h.priv.updateVehicleMeshes(1, 16);
    expect(h.barrel().geometry).not.toBe(shipped);
    h.renderer.dispose();
  });
});

describe('the knock-out effects, on the sim clock', () => {
  it('the fire sits at the turret ring, lifted to where that height projects, not on the ground under it', async () => {
    const h = await setUp();
    h.priv.updateVehicleMeshes(1, 16);
    h.setGunOut(true);
    h.priv.beginGunOutFx(h.id, h.sim.tickCount);
    h.run(1);
    const flame = h.log.find((s) => s.sprite === 'soft_dot');
    expect(flame).toBeDefined();
    const e = h.priv.vehicleMeshEntities.get(h.id) as VehicleMeshEntity;
    const pivot = e.turretPivot as THREE.Object3D;
    pivot.updateWorldMatrix(true, false);
    const m = pivot.matrixWorld.elements;
    const lift = liftShiftTiles(GUN_OUT_FIRE_LIFT_TILES);
    const dirX = m[0] / Math.hypot(m[0], m[2]);
    const dirZ = m[2] / Math.hypot(m[0], m[2]);
    // Break check: drop the `liftShiftTiles` add in `gunOutAnchor` -> the flame is on the ground under the ring.
    expect((flame as Spawn).x).toBeCloseTo(m[12] + dirX * GUN_OUT_FIRE_REACH_TILES + lift.x, 4);
    expect((flame as Spawn).y).toBeCloseTo(m[14] + dirZ * GUN_OUT_FIRE_REACH_TILES + lift.y, 4);
    h.renderer.dispose();
  });

  it('a brief puff at the moment, a small fire for 8-15 s, then nothing but the wisp', async () => {
    const h = await setUp();
    h.setGunOut(true);
    h.priv.beginGunOutFx(h.id, h.sim.tickCount);
    h.run(20);
    const puffs = h.log.filter((s) => s.sprite === 'smoke_puff');
    const flames = h.log.filter((s) => s.sprite === 'soft_dot');
    const embers = h.log.filter((s) => s.sprite === 'spark');
    // Break check: do not register the emitters (`useEmitters` without them) -> nothing spawns here.
    expect(puffs.length).toBeGreaterThan(0);
    expect(flames.length).toBeGreaterThan(3);
    expect(embers.length).toBeGreaterThan(0);
    // The puff is the moment: all of it inside the first second of sim time (tick 0 is the knock-out).
    expect(Math.max(...puffs.map((s) => s.tick))).toBeLessThanOrEqual(24);
    // The fire starts at once and lasts 8-15 s of SIM time: its last throw is in [7, 15.5] s, and 20 s in nothing is left.
    expect(Math.min(...flames.map((s) => s.tick))).toBeLessThanOrEqual(8);
    const lastSec = Math.max(...flames.map((s) => s.tick)) / 20;
    expect(lastSec).toBeGreaterThan(5);
    expect(lastSec).toBeLessThan(15.6);
    // It dies down: the magnitude at the end is well under the magnitude at the start.
    expect(flames[flames.length - 1].magnitude).toBeLessThan(flames[0].magnitude * 0.6);
    // And after it, a quiet hull: no flame in the last 4 s of the 20.
    expect(flames.filter((s) => s.tick > 16 * 20)).toHaveLength(0);
    h.renderer.dispose();
  });

  it('is a function of sim time alone: a repaint at zero elapsed time emits nothing, and wall time between frames changes nothing', async () => {
    const a = await setUp();
    a.setGunOut(true);
    a.priv.beginGunOutFx(a.id, a.sim.tickCount);
    a.run(6);
    const n = a.log.length;
    expect(n).toBeGreaterThan(3); // a log that is empty on both sides proves nothing
    a.priv.updateGunOutFx(1);
    a.priv.updateGunOutFx(1);
    // Break check: date the slots off `performance.now()` instead of `presentationSimMs` -> the repaint emits.
    expect(a.log.length).toBe(n);

    const b = await setUp();
    b.setGunOut(true);
    b.priv.beginGunOutFx(b.id, b.sim.tickCount);
    for (let t = 0; t < 6 * 20; t++) {
      b.sim.tick();
      const until = Date.now() + 2;
      while (Date.now() < until) { /* real time passes; sim time does not */ }
      b.priv.updateGunOutFx(1);
    }
    const key = (l: Spawn[]): string => l.map((s) => `${s.sprite}@${s.tick}:${s.magnitude.toFixed(4)}`).join('|');
    expect(b.log.length).toBeGreaterThan(3);
    expect(key(b.log)).toBe(key(a.log));
    a.renderer.dispose();
    b.renderer.dispose();
  });

  it('under reduced motion there is no flicker and no puff, and the slots are spent so nothing is banked', async () => {
    const h = await setUp({ reduced: true });
    h.setGunOut(true);
    h.priv.beginGunOutFx(h.id, h.sim.tickCount);
    h.run(10);
    // Break check: drop the `!reduced` gate -> the spawns come back.
    expect(h.log).toHaveLength(0);
    h.priv.reducedPrefNow = false;
    h.run(1);
    expect(h.log).toHaveLength(0);
    h.renderer.dispose();
  });

  it('stops when the gun is repaired', async () => {
    const h = await setUp();
    h.setGunOut(true);
    h.priv.beginGunOutFx(h.id, h.sim.tickCount);
    h.run(2);
    const before = h.log.length;
    expect(before).toBeGreaterThan(0);
    h.setGunOut(false);
    h.run(3);
    expect(h.log.length).toBe(before);
    h.renderer.dispose();
  });
});
