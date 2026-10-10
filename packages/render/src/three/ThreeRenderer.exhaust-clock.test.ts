/**
 * GH-391: idle exhaust is dated off the SIM clock, like rotor wash. The same
 * sim time reached through different frame-delta histories leaves identical
 * puffs; a zero-time repaint adds none; a moving vehicle has none. Before,
 * emission was a frame-delta accumulator and every roll came from
 * `Math.random`. Harness as `ThreeRenderer.rotor-wash-clock.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import vehicleExhaust from '../../../../data/vfx/vehicle_exhaust.json';
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

const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

interface ParticleReader {
  step(dt: number, simDt?: number): void;
  forEachLive(layer: number, cb: (x: number, y: number, c: string, a: number, r: number) => void): void;
}
interface Privates {
  updateIdleExhaust(alpha: number): void;
  updateVehicleAmbientFx(dtMs: number): void;
  particleSystem: ParticleReader | null;
  entitySpeed: Float64Array;
}

function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const id = sim.spawn(sim.addUnitType(TANK), 0, fx.from(9.5), fx.from(11.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.useEmitters([vehicleExhaust as unknown as EmitterSpec], () => '#8E9491');
  const priv = renderer as unknown as Privates;
  renderer.snapshot();
  renderer.snapshot();
  if (!priv.particleSystem) throw new Error('no particle system');
  const system = priv.particleSystem;
  const ticksTo = (t: number): void => {
    while (sim.tickCount < t) sim.tick();
  };
  const puffs = (): string => {
    const rows: string[] = [];
    for (let layer = 0; layer < 4; layer++) {
      system.forEachLive(layer, (x, y, c, a, r) =>
        rows.push([layer, x, y, c, a, r].map((v) => (typeof v === 'number' ? v.toFixed(6) : v)).join(',')));
    }
    return rows.sort().join('\n');
  };
  /** One frame's worth, in `updateFx`'s own order. */
  const frame = (frameDtSec: number, simDtSec: number): void => {
    priv.updateVehicleAmbientFx(frameDtSec * 1000);
    system.step(frameDtSec, simDtSec);
    priv.updateIdleExhaust(1);
  };
  return { priv, system, ticksTo, puffs, id, frame };
}

describe('idle exhaust on the sim clock', () => {
  it('leaves the same puffs at the same sim time whatever the frame history', () => {
    const a = setUp();
    a.frame(0.016, 0.016);
    a.ticksTo(10);
    for (let i = 0; i < 14; i++) a.frame(0.1, 0.1);
    a.ticksTo(120);
    a.frame(0.1, 6);

    const b = setUp();
    b.ticksTo(120);
    b.frame(0.007, 6);

    expect(a.puffs()).not.toBe('');
    expect(a.puffs()).toBe(b.puffs());
  });

  it('a zero-time repaint at the same sim time adds nothing', () => {
    const a = setUp();
    a.ticksTo(120);
    a.frame(0.016, 0.016);
    const before = a.puffs();
    a.frame(0, 0);
    a.frame(0.1, 0);
    expect(before).not.toBe('');
    expect(a.puffs()).toBe(before);
  });

  it('dates a puff by sim time, trickle included', () => {
    // Window 24 opens at 12000 ms = tick 240; its trickle ends 500 ms later.
    const late = setUp();
    late.ticksTo(247);
    late.frame(0.016, 0.35);
    const onTime = setUp();
    onTime.ticksTo(240);
    onTime.frame(0.016, 0.016);
    expect(onTime.puffs()).not.toBe('');
    // Build onTime up to the same instant by sim-aged steps of the same size.
    onTime.ticksTo(247);
    onTime.frame(0.016, 0.35);
    expect(onTime.puffs()).toBe(late.puffs());
  });

  it('keeps emitting as sim time advances (anti-vacuity)', () => {
    const a = setUp();
    a.ticksTo(120);
    a.frame(0.016, 0.016);
    const before = a.puffs();
    a.ticksTo(140);
    a.frame(0.016, 1);
    expect(a.puffs()).not.toBe(before);
  });

  it('a moving vehicle throws no idle exhaust', () => {
    const a = setUp();
    a.priv.entitySpeed[a.id] = 1.5;
    a.ticksTo(120);
    a.frame(0.016, 0.016);
    expect(a.puffs()).toBe('');
  });
});
