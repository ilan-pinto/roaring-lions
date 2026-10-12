/**
 * N1a final review, network design §5.1: a vehicle the fog hides from a
 * versus seat leaves no trace on that seat's screen -- no tread or tyre
 * print, no dust, no idle exhaust, no damage smoke, no rotor wash. Each is
 * sampled at the moment it would be stamped or spawned, as `fireVisible`
 * samples a shot.
 *
 * Single-player (no `versus`) is asserted beside every room case: it keeps
 * every trace of a fogged hostile vehicle, exactly as main does, because
 * `hiddenFromViewer` reads `versus` before anything else. The seat on side 1
 * is the mirror: its own vehicle always leaves its traces.
 *
 * Harnesses: `ThreeRenderer.vehicle-ambient-fx.test.ts` (dust),
 * `ThreeRenderer.exhaust-clock.test.ts` (exhaust),
 * `ThreeRenderer.rotor-wash-clock.test.ts` (wash) and
 * `ThreeRenderer.blast.test.ts`'s `driveTiles` (prints).
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import vehicleDust from '../../../../data/vfx/vehicle_dust.json';
import vehicleExhaust from '../../../../data/vfx/vehicle_exhaust.json';
import vehicleDamagedSmoke from '../../../../data/vfx/vehicle_damaged_smoke.json';
import rotorWash from '../../../../data/vfx/rotor_wash.json';
import type { EmitterSpec } from '../vfx/emitters';
import type { DecalPool } from './decal-pool';

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
  crownRatio: 0.52, scatter: 'stone',
  groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

type Room = Pick<RendererOptions, 'viewerSide' | 'versus'>;

function makeOpts(room: Room): RendererOptions {
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
    ...room,
  };
}

/** `mbt_lavi` so `trackKindFor` lays tread behind it. */
const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};
const HELI: UnitTypeJson = {
  id: 'heli_peten',
  role: 'attack_helicopter',
  hull: { hp: 400, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 3, domain: 'air' },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};
/** An unarmed side-0 eye, for the "in sight" case of the prints. */
const EYE: UnitTypeJson = {
  id: 't_eye',
  role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 20 },
  weapons: [],
};

interface Privates {
  fog: Uint8Array;
  particleSystem: { spawn(...args: unknown[]): void } | null;
  entitySpeed: Float64Array;
  decalsFading: DecalPool;
  updateVehicleAmbientFx(dtMs: number): void;
  updateIdleExhaust(alpha: number): void;
  updateDamageSmoke(alpha: number): void;
  updateRotorWash(alpha: number): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

const W = 24;

/** A side-1 vehicle at (9.5, 11.5) with every emitter loaded, and a spawn
 *  counter on the particle system. Fog is cleared to all-unseen; `inSight`
 *  puts the vehicle's own tile back. */
function particles(room: Room, type: UnitTypeJson, inSight = false) {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
  const id = sim.spawn(sim.addUnitType(type), 1, fx.from(9.5), fx.from(11.5));
  const r = new ThreeRenderer(sim, makeOpts(room));
  r.useEmitters(
    [vehicleDust, vehicleExhaust, vehicleDamagedSmoke, rotorWash].map((e) => e as unknown as EmitterSpec),
    () => '#8E9491'
  );
  r.snapshot();
  r.snapshot();
  const p = priv(r);
  p.fog.fill(0);
  if (inSight) p.fog[11 * W + 9] = 2;
  const system = p.particleSystem;
  if (system === null) throw new Error('useEmitters did not build a ParticleSystem');
  let n = 0;
  const inner = system.spawn.bind(system);
  system.spawn = (...args: unknown[]): void => {
    n += 1;
    inner(...args);
  };
  const ticksTo = (t: number): void => {
    while (sim.tickCount < t) sim.tick();
  };
  return { r, p, sim, id, ticksTo, spawns: () => n };
}

function dust(room: Room, inSight = false): number {
  const h = particles(room, TANK, inSight);
  h.p.entitySpeed[h.id] = 1.5;
  for (let i = 0; i < 20; i++) h.p.updateVehicleAmbientFx(16.67);
  h.r.dispose();
  return h.spawns();
}
function exhaust(room: Room, inSight = false): number {
  const h = particles(room, TANK, inSight);
  h.ticksTo(120);
  h.p.updateIdleExhaust(1);
  h.r.dispose();
  return h.spawns();
}
function damageSmoke(room: Room, inSight = false): number {
  const h = particles(room, TANK, inSight);
  h.sim.state.mobilityKilled[h.id] = 1;
  h.ticksTo(120);
  h.p.updateDamageSmoke(1);
  h.r.dispose();
  return h.spawns();
}
function wash(room: Room, inSight = false): number {
  const h = particles(room, HELI, inSight);
  h.ticksTo(120);
  h.p.updateRotorWash(1);
  h.r.dispose();
  return h.spawns();
}

describe.each([
  ['dust', dust],
  ['idle exhaust', exhaust],
  ['damage smoke', damageSmoke],
  ['rotor wash', wash],
] as const)('%s from a vehicle out of sight (N1a final review)', (_name, emitted) => {
  it('single-player still spawns it for a fogged hostile, as main does', () => {
    expect(emitted({})).toBeGreaterThan(0);
    expect(emitted({ viewerSide: 0 })).toBeGreaterThan(0);
  });
  it('a versus seat spawns none for a hostile the fog hides', () => {
    expect(emitted({ versus: true, viewerSide: 0 })).toBe(0);
  });
  it('a versus seat spawns it once the hostile is in sight', () => {
    expect(emitted({ versus: true, viewerSide: 0 }, true)).toBeGreaterThan(0);
  });
  it('a versus seat always spawns it for its own vehicle', () => {
    expect(emitted({ versus: true, viewerSide: 1 })).toBeGreaterThan(0);
  });
});

describe('the sim-dated slots are still spent while hidden (no backlog)', () => {
  it('idle exhaust hidden at a sim time throws nothing when revealed at that same time', () => {
    const h = particles({ versus: true, viewerSide: 0 }, TANK);
    h.ticksTo(120);
    h.p.updateIdleExhaust(1);
    h.p.fog[11 * W + 9] = 2;
    h.p.updateIdleExhaust(1);
    expect(h.spawns()).toBe(0);
    h.r.dispose();
  });
});

describe('tread prints from a vehicle out of sight (N1a final review)', () => {
  /** Drives a side-1 tank east, three tiles or more, along y = 12.5 and counts the
   *  prints in the fading pool. With `eye`, a side-0 rifleman with 20 tiles
   *  of sight stands at (3.5, 14.5), so the fog `snapshot()` recomputes
   *  keeps the whole drive in sight. */
  function prints(room: Room, eye = false): number {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const tank = sim.spawn(sim.addUnitType(TANK), 1, fx.from(3.5), fx.from(12.5));
    if (eye) sim.spawn(sim.addUnitType(EYE), 0, fx.from(3.5), fx.from(14.5));
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    sim.queueCommand({ kind: 'move', ids: [tank], x: fx.from(11.5), y: fx.from(12.5) });
    for (let t = 0; t < 100; t++) {
      sim.tick();
      r.snapshot();
    }
    expect(fx.toNumber(sim.state.posX[tank]), 'the tank did not move').toBeGreaterThan(6);
    const n = priv(r).decalsFading.liveCount;
    r.dispose();
    return n;
  }

  it('single-player still prints behind a fogged hostile, as main does', () => {
    expect(prints({})).toBeGreaterThan(0);
    expect(prints({ viewerSide: 0 })).toBeGreaterThan(0);
  });
  it('a versus seat gets no prints from a hostile the fog hides', () => {
    expect(prints({ versus: true, viewerSide: 0 })).toBe(0);
  });
  it('a versus seat gets them while the hostile is in sight', () => {
    expect(prints({ versus: true, viewerSide: 0 }, true)).toBeGreaterThan(0);
  });
  it('a versus seat always gets its own vehicle\'s prints', () => {
    expect(prints({ versus: true, viewerSide: 1 })).toBeGreaterThan(0);
  });
});
