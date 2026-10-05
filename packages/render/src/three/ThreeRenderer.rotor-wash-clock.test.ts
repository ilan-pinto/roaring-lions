/**
 * GH-391: rotor-wash dust is dated off the SIM clock. The same sim time
 * reached through different frame-delta histories must leave identical
 * puffs, and a zero-time repaint must add none. Before, emission was an
 * accumulator fed the clamped frame delta and every roll came from
 * `Math.random`, so a frozen gate frame carried a different dust cloud on
 * every run. Harness as `ThreeRenderer.vehicle-ambient-fx.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import rotorWash from '../../../../data/vfx/rotor_wash.json';
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

const HELI: UnitTypeJson = {
  id: 'heli_peten',
  role: 'attack_helicopter',
  hull: { hp: 400, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 3, domain: 'air' },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

interface ParticleReader {
  step(dt: number): void;
  forEachLive(layer: number, cb: (x: number, y: number, c: string, a: number, r: number) => void): void;
}
interface Privates {
  updateRotorWash(alpha: number): void;
  particleSystem: ParticleReader | null;
}

function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  sim.spawn(sim.addUnitType(HELI), 0, fx.from(9.5), fx.from(11.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.useEmitters([rotorWash as unknown as EmitterSpec], () => '#8E9491');
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
  return { priv, system, ticksTo, puffs };
}

describe('rotor wash on the sim clock', () => {
  it('leaves the same puffs at the same sim time whatever the frame history', () => {
    const a = setUp();
    // History A: an early burst of short frames, then a long wait (every early
    // puff ages out), then one frame at the target time.
    a.priv.updateRotorWash(1);
    a.ticksTo(10);
    for (let i = 0; i < 12; i++) {
      a.priv.updateRotorWash(1);
      a.system.step(0.1);
    }
    a.ticksTo(120);
    a.priv.updateRotorWash(1);

    // History B: straight there, one frame of a different length.
    const b = setUp();
    b.ticksTo(120);
    b.priv.updateRotorWash(1);

    expect(a.puffs()).not.toBe('');
    expect(a.puffs()).toBe(b.puffs());
  });

  it('a zero-time repaint at the same sim time adds nothing', () => {
    const a = setUp();
    a.ticksTo(120);
    a.priv.updateRotorWash(1);
    const before = a.puffs();
    a.priv.updateRotorWash(1);
    a.priv.updateRotorWash(1);
    expect(a.puffs()).toBe(before);
  });

  it('keeps emitting as sim time advances (anti-vacuity)', () => {
    const a = setUp();
    a.ticksTo(120);
    a.priv.updateRotorWash(1);
    const before = a.puffs();
    a.ticksTo(140);
    a.priv.updateRotorWash(1);
    expect(a.puffs()).not.toBe(before);
  });

  it('dates a puff by sim time: a slot emitted late is as old as one emitted on time', () => {
    // Slot 30 is 6000 ms = tick 120. At tick 123 it is 150 ms old.
    const late = setUp();
    late.ticksTo(123);
    late.priv.updateRotorWash(1);

    const onTime = setUp();
    onTime.ticksTo(120);
    onTime.priv.updateRotorWash(1);
    onTime.system.step(0.05);
    onTime.system.step(0.05);
    onTime.system.step(0.05);
    // Same slot, same seed: only slots 28-30 can be alive at 150 ms.
    const lateRows = late.puffs().split('\n').filter(Boolean).length;
    expect(lateRows).toBeGreaterThan(0);
    expect(onTime.puffs()).toBe(late.puffs());
  });

  it('ages wash puffs by sim time: a sim jump kills them however short the frame', () => {
    const a = setUp();
    a.ticksTo(10);
    a.priv.updateRotorWash(1);
    expect(a.puffs()).not.toBe('');
    a.system.step(0.016, 5.5); // a 16 ms frame that presents 5.5 s of sim time
    expect(a.puffs()).toBe('');
  });
});
