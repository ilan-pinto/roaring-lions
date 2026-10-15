/**
 * N1b follow-up: the quiet catch-up, through the REAL renderer.
 *
 * A seat that rejoins runs the room's log -- thousands of old ticks -- in a
 * few seconds. `setQuiet(true)` is what the app turns on around each tick far
 * behind the live edge: `onEvents` then throws no one-shot burst (muzzle
 * flash, round, puff, fireball, light, shake, freeze, shroud) and keeps every
 * piece of state the same events carry (the scorch under a dead hull, the
 * rubble of a fallen building). Off, it is exactly what it always was.
 *
 * Harness: `ThreeRenderer.versus-leaks.test.ts` and `.blast.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { BURST_ONLY_EVENT_KINDS, isBurstOnlyEvent } from './quiet';
import type { TracerModel } from './units/tracers';
import type { ShellModel } from './units/shells';
import type { EmitterSpec } from '../vfx/emitters';
import catastrophic from '../../../../data/vfx/catastrophic_kill.json';

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

const W = 32;

const RIFLES: UnitTypeJson = {
  id: 't_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 20 },
  weapons: [
    {
      id: 'rifles', type: 'small_arms', range_tiles: 9, effective_range_tiles: 7,
      accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300,
    },
  ],
};
const TARGET: UnitTypeJson = {
  id: 't_target',
  role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 1 },
  weapons: [],
};
const HARD: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};

interface Privates {
  cssWidth: number;
  cssHeight: number;
  tracers: TracerModel[];
  shells: ShellModel[];
  bolts: ShellModel[];
  flashLights: { liveCount: number };
  decalsPersistent: { liveCount: number };
  hitStop: { remainingMs: number };
  spawnSmokeDischarge(by: number, sx: number, sy: number): void;
  spawnCollapseFx(id: string, bx: number, by: number, power?: number, yawTurns?: number): boolean;
  beginCollapseShroud(structure: number, cx: number, cy: number): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

describe('isBurstOnlyEvent', () => {
  it('names exactly the events whose whole effect is a one-shot', () => {
    expect([...BURST_ONLY_EVENT_KINDS].sort()).toEqual(['aps', 'fire', 'impact', 'nearMiss', 'smokeLaid', 'strike']);
    // What leaves something standing is never dropped.
    for (const kind of ['destroyed', 'structureHit', 'structureDestroyed', 'tunnelContact', 'tunnelCollapsed', 'spawn']) {
      expect(isBurstOnlyEvent(kind), kind).toBe(false);
    }
  });
});

describe('a quiet renderer throws no burst for a tick far behind the live edge', () => {
  /** The real events of the tick a side-1 rifle squad first fires on. */
  function fireTick(): { sim: Sim; events: SimEvent[] } {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 8 });
    const shooterType = sim.addUnitType(RIFLES);
    const targetType = sim.addUnitType(TARGET);
    const shooter = sim.spawn(shooterType, 1, fx.from(4), fx.from(4));
    sim.spawn(targetType, 0, fx.from(11), fx.from(4));
    for (let t = 0; t < 400; t++) {
      const events = sim.tick();
      if (events.some((e) => e.kind === 'fire' && e.shooter === shooter)) return { sim, events };
    }
    throw new Error('the side-1 rifles never fired');
  }

  function drawnShots(quiet: boolean | null): number {
    const { sim, events } = fireTick();
    const r = new ThreeRenderer(sim, makeOpts());
    r.snapshot();
    if (quiet !== null) r.setQuiet(quiet);
    r.onEvents(events);
    const p = priv(r);
    const n = p.tracers.length + p.shells.length + p.bolts.length;
    r.dispose();
    return n;
  }

  it('a shot draws its round normally, and none while quiet; quiet off again restores it', () => {
    expect(drawnShots(null)).toBeGreaterThan(0);
    expect(drawnShots(false)).toBeGreaterThan(0);
    expect(drawnShots(true)).toBe(0);
  });

  it('the pop of a smoke launcher is not thrown while quiet', () => {
    const pops = (quiet: boolean): number => {
      const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
      // F-Q8: only a type with the `smoke` ability pops a launcher; any other layer is a called round.
      const t = sim.addUnitType({ ...TARGET, abilities: ['smoke'] });
      sim.spawn(t, 0, fx.from(4.5), fx.from(4.5));
      const layer = sim.spawn(t, 1, fx.from(20.5), fx.from(20.5));
      const r = new ThreeRenderer(sim, makeOpts());
      r.snapshot();
      r.snapshot();
      r.setQuiet(quiet);
      const pop = vi.spyOn(priv(r), 'spawnSmokeDischarge');
      r.onEvents([{ kind: 'smokeLaid', tick: 1, by: layer, x: fx.from(22), y: fx.from(20) }]);
      const n = pop.mock.calls.length;
      r.dispose();
      return n;
    };
    expect(pops(false)).toBe(1);
    expect(pops(true)).toBe(0);
  });

  it('a building\'s fall keeps its rubble and loses its fireball and shroud', () => {
    const fall = (quiet: boolean): { burst: number; shroud: number; rubble: number } => {
      const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
      const t = sim.addUnitType(TARGET);
      sim.spawn(t, 0, fx.from(4.5), fx.from(4.5));
      const block = sim.addStructureType({ id: 'block', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
      const id = sim.addStructure(block, [20 * W + 20, 20 * W + 21, 21 * W + 20, 21 * W + 21]);
      const r = new ThreeRenderer(sim, makeOpts());
      r.snapshot();
      r.snapshot();
      r.setQuiet(quiet);
      const burst = vi.spyOn(priv(r), 'spawnCollapseFx');
      const shroud = vi.spyOn(priv(r), 'beginCollapseShroud');
      sim.debugDestroyStructure(id);
      r.onEvents([{ kind: 'structureDestroyed', tick: sim.tickCount, structure: id, by: -1 }]);
      const out = { burst: burst.mock.calls.length, shroud: shroud.mock.calls.length, rubble: priv(r).decalsPersistent.liveCount };
      r.dispose();
      return out;
    };
    const loud = fall(false);
    expect(loud.burst).toBe(1);
    expect(loud.shroud).toBe(1);
    expect(loud.rubble).toBeGreaterThan(0);
    const quiet = fall(true);
    expect(quiet.burst).toBe(0);
    expect(quiet.shroud).toBe(0);
    // The state the fall leaves is kept: the same rubble stamp as the loud one.
    expect(quiet.rubble).toBe(loud.rubble);
  });

  it('a vehicle kill keeps its scorch and oil and loses its light and freeze', () => {
    const kill = (quiet: boolean): { lights: number; hitStop: number; marks: number } => {
      const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
      const hard = sim.addUnitType(HARD);
      const tank = sim.spawn(hard, 0, fx.from(24.5), fx.from(24.5));
      const r = new ThreeRenderer(sim, makeOpts());
      r.useEmitters([catastrophic as unknown as EmitterSpec], (key) => (key.startsWith('#') ? key : '#FFB43C'));
      priv(r).cssWidth = 1400;
      priv(r).cssHeight = 900;
      r.snapshot();
      r.snapshot();
      r.setQuiet(quiet);
      sim.state.alive[tank] = 0;
      r.onEvents([{ kind: 'destroyed', tick: 1, entity: tank, by: -1 } as unknown as SimEvent]);
      const out = { lights: priv(r).flashLights.liveCount, hitStop: priv(r).hitStop.remainingMs, marks: priv(r).decalsPersistent.liveCount };
      r.dispose();
      return out;
    };
    expect(kill(false)).toEqual({ lights: 1, hitStop: 70, marks: 2 });
    expect(kill(true)).toEqual({ lights: 0, hitStop: 0, marks: 2 });
  });
});
