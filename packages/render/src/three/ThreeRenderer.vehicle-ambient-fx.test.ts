/**
 * Vehicle ambient FX (dust while moving, exhaust while idle) as a function of
 * ELAPSED TIME rather than of frame count.
 *
 * `units/vehicle-fx.test.ts` pins the pure half -- the moving/idle hysteresis
 * and the spawn geometry. This file pins the half that module cannot see: the
 * per-entity accumulators inside `ThreeRenderer.updateVehicleAmbientFx`, and
 * specifically that no frame can bank more than one spawn's worth of credit.
 *
 * ## Why this file exists: the visual gate's `vehicle` repaint control
 *
 * Every elapsed-time reader in `frame()` clamps its delta to
 * `FRAME_DT_CEILING_MS` (100) through `frameDtMs`/`frameDtSeconds` -- except,
 * until 2026-09-18, these two accumulators, which added the RAW `dtMs`. The
 * particle AGEING those spawns feed (`updateFx`) always clamped, so one long
 * frame aged every live particle by 100 ms while banking seconds of fresh
 * emission.
 *
 * Measured through the visual gate's own protocol on
 * `?sandbox=beit_sahwan_outskirts` (frame loop frozen, `frame(1, 0)`
 * repaints): boot plus the settle left `vehicleExhaustAccumMs` at 5607.9 ms
 * for all seven stationary vehicles, and `__lions.step(140)`'s single repaint
 * with `lastFrameMs` took it to 11198.3 -- twenty-two intervals of credit,
 * spent at one per CALL. The next 22 ZERO-TIME repaints each spawned 7 puffs,
 * which is what the gate photographed as the `vehicle` scenario's
 * 0 px / 0.0002-0.0004 repaint-control drift (a coin flip against its 0.00036
 * stopgap budget on CI: PASS at 0.0003, FAIL at 0.0004, same commit).
 *
 * Both tests below were watched going RED against the one-line mutation that
 * restores the defect (`const dt = this.frameDtMs(dtMs)` -> `const dt =
 * dtMs`): 10 spawns instead of 0 on the exhaust case, 10 instead of 0 on the
 * dust case. The first test in each pair is the anti-vacuity control -- an
 * emitter that never fires at all would otherwise pass the regression test
 * perfectly.
 *
 * That was true of the DUST pair until WP-A1.3 Task 6 (2026-09-23) and is
 * not any more: re-injecting the raw `dtMs` now reddens the exhaust test
 * alone. The speed-driven dust cadence brought two guards of its own -- no
 * dust spawn on a call with no elapsed time, and whole intervals of leftover
 * credit dropped after a spawn -- and either one holds the dust regression
 * test green without the clamp. The clamp is still what the exhaust test
 * pins. What guards the dust half now is two specs in
 * `ThreeRenderer.vehicle-weight.test.ts`: "never spawns on a call with no
 * elapsed time, even after the interval shrank" and "cannot bank a burst
 * when the interval drops sharply", each seen red against its own guard's
 * removal.
 *
 * Harness copied from `ThreeRenderer.vehicle-mesh-anim.test.ts`: a faked
 * `WebGLRenderer`, a real `Sim`, and the emitters wired through the public
 * `useEmitters` seam so the `ParticleSystem` this path needs is the one the
 * app builds.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import vehicleExhaust from '../../../../data/vfx/vehicle_exhaust.json';
import vehicleDust from '../../../../data/vfx/vehicle_dust.json';
import type { EmitterSpec } from '../vfx/emitters';

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
  crownRatio: 0.52, scatter: 'stone',
  groveFamily: 'desert_tree',
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

/** A real vehicle as far as this path is concerned: `armor.front` above
 *  `SOFT_ARMOR_LIMIT`, so `isSoft` is false and `updateVehicleAmbientFx`'s
 *  own infantry gate lets it through. */
const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

interface Privates {
  updateVehicleAmbientFx(dtMs: number): void;
  particleSystem: { spawn(...args: unknown[]): void } | null;
  entitySpeed: Float64Array;
}

function setUp(): { renderer: ThreeRenderer; priv: Privates; id: number; spawns: () => number } {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const typeIdx = sim.addUnitType(TANK);
  const id = sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  // The public seam, so the `ParticleSystem` is the one the app builds.
  renderer.useEmitters(
    [vehicleExhaust as unknown as EmitterSpec, vehicleDust as unknown as EmitterSpec],
    () => '#8E9491'
  );
  const priv = renderer as unknown as Privates;
  // Fills `curX`/`curY`/`entitySpeed` the way a real frame reads them.
  renderer.snapshot();
  renderer.snapshot();

  let n = 0;
  const system = priv.particleSystem;
  if (system === null) throw new Error('useEmitters did not build a ParticleSystem');
  const inner = system.spawn.bind(system);
  system.spawn = (...args: unknown[]): void => {
    n += 1;
    inner(...args);
  };
  return { renderer, priv, id, spawns: () => n };
}

describe('vehicle ambient FX emit on elapsed time, not on frame count', () => {
  it('still emits exhaust at an ordinary cadence -- the anti-vacuity control', () => {
    const { priv, spawns } = setUp();
    // 600 ms of real time at 60 fps, against a 500 ms exhaust interval.
    for (let i = 0; i < 36; i++) priv.updateVehicleAmbientFx(16.67);
    expect(spawns()).toBeGreaterThan(0);
  });

  it('a zero-time repaint after a very long frame spawns no exhaust at all', () => {
    const { priv, spawns } = setUp();
    // The real shape of the bug's input: one frame that waited ten seconds on
    // a cold GLB load. Clamped, it is worth 100 ms -- less than one interval,
    // so it banks nothing a later frame can spend.
    priv.updateVehicleAmbientFx(10_000);
    const afterLongFrame = spawns();
    for (let i = 0; i < 10; i++) priv.updateVehicleAmbientFx(0);
    // No elapsed time, no emission. With the raw `dtMs` this reads
    // `afterLongFrame + 10`.
    expect(spawns()).toBe(afterLongFrame);
    // And the long frame itself bought at most one puff's worth, not twenty.
    expect(afterLongFrame).toBeLessThanOrEqual(vehicleExhaust.particles.length);
  });

  it('still emits dust at an ordinary cadence -- the anti-vacuity control', () => {
    const { priv, id, spawns } = setUp();
    // Above `VEHICLE_MOVE_ON_SPEED_TILES_S`, so `nextVehicleMoving` takes the
    // dust branch. Written straight into the measured-speed array rather than
    // driven through the sim: this test is about the accumulator, and a real
    // move order would also move `curX`/`curY` under it.
    priv.entitySpeed[id] = 1.5;
    for (let i = 0; i < 20; i++) priv.updateVehicleAmbientFx(16.67);
    expect(spawns()).toBeGreaterThan(0);
  });

  it('a zero-time repaint after a very long frame spawns no dust either', () => {
    const { priv, id, spawns } = setUp();
    priv.entitySpeed[id] = 1.5;
    priv.updateVehicleAmbientFx(10_000);
    const afterLongFrame = spawns();
    for (let i = 0; i < 10; i++) priv.updateVehicleAmbientFx(0);
    expect(spawns()).toBe(afterLongFrame);
    expect(afterLongFrame).toBeLessThanOrEqual(vehicleDust.particles.length);
  });
});
