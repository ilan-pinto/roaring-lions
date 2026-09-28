// The `vi.mock('three', ...)` block, `TONES` and `makeOpts` below are copied
// verbatim from `ThreeRenderer.indirect-projectile.test.ts`.
/**
 * GH-250: an ATGM or an RPG is MissileFx's, not a bolt. The wiring is the
 * risk here, so -- like the indirect-projectile suite -- every case is fed
 * `fire` events a real `Sim` produced, and the resolution-tick case reads the
 * sim's own `impact`/`nearMiss`/`aps` to prove the drawn flight lands on it.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { EmitterSpec } from '../vfx';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { MissileLanding, MissileModel } from './units/missiles';
import { MISSILE_IMPACT_EMITTER_ID } from './units/missile-fx';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {
      // Real `WebGLRenderer#setClearColor` reads `outputColorSpace`
      // synchronously; this stand-in only needs to accept the call.
    }
    // `ThreeRenderer.dispose` loses the context last (`context-release.ts`).
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {
      // Nothing to release: this stand-in holds no GPU context.
    }
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

const SPIKE: UnitTypeJson = {
  id: 't_at', role: 'at_team',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1.2, sight_tiles: 20 },
  weapons: [{ id: 'spike_atgm', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78,
    penetration: 900, damage: 800, suppression: 60, rof_per_min: 3, min_range_tiles: 1 }],
};
const RPG: UnitTypeJson = {
  id: 't_rpg', role: 'at_team',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1.2, sight_tiles: 20 },
  weapons: [{ id: 'rpg7', type: 'rpg', range_tiles: 5, effective_range_tiles: 4, accuracy: 0.6,
    penetration: 500, damage: 600, suppression: 50, rof_per_min: 4 }],
};
// Armour 300, not 10: below SOFT_ARMOR_LIMIT a hit is plain damage with no
// `impact` event, and the resolution test below reads that event.
const HULL: UnitTypeJson = {
  id: 't_hull', role: 'mbt',
  hull: { hp: 100000, armor: { front: 300, side: 300, rear: 300 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1, sight_tiles: 1 }, weapons: [],
};
const IMPACT: EmitterSpec = {
  id: 'missile_impact', trigger: 'impact_armor', layer: 'above_units',
  screen_shake: { amplitude_px: 2, duration_ms: 140, falloff_tiles: 8 },
  light: { color: 'vfx.fire', intensity: 2.6, radius_tiles: 3.5, decay_ms: 200 },
  particles: [{ sprite: 'shard', count: [8, 12], lifetime_ms: [250, 450], cone_deg: 70, color_over_life: ['vfx.fire'] }],
};

interface Privates {
  missileFx: { missiles: MissileModel[] };
  bolts: unknown[];
  tracers: unknown[];
  flashLights: { liveCount: number };
  updateFx(ms: number): void;
  spawnMissileImpactFx(l: MissileLanding): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

function fire(shooterJson: UnitTypeJson, gap: number): { sim: Sim; shooter: number; target: number; events: SimEvent[]; tick: number } {
  const sim = new Sim({ seed: 11, width: 32, height: 32, capacity: 8 });
  const s = sim.addUnitType(shooterJson);
  const t = sim.addUnitType(HULL);
  const shooter = sim.spawn(s, 0, fx.from(4), fx.from(4));
  const target = sim.spawn(t, 1, fx.from(4 + gap), fx.from(4));
  for (let i = 0; i < 600; i++) {
    const events = sim.tick();
    if (events.some((e) => e.kind === 'fire' && e.shooter === shooter)) return { sim, shooter, target, events, tick: sim.tickCount };
  }
  throw new Error(`${shooterJson.id} never fired`);
}
function rendererFor(sim: Sim, events: SimEvent[]): ThreeRenderer {
  const r = new ThreeRenderer(sim, makeOpts());
  r.snapshot();
  r.onEvents(events);
  return r;
}

describe('an ATGM is a missile, not a bolt (GH-250)', () => {
  it('the Spike flies top-attack in MissileFx, with no bolt and no tracer', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    expect(priv(r).missileFx.missiles.map((m) => m.variant)).toEqual(['top_attack']);
    expect(priv(r).bolts).toHaveLength(0);
    expect(priv(r).tracers).toHaveLength(0);
    r.dispose();
  });

  it('an RPG flies unguided', () => {
    const { sim, events } = fire(RPG, 4);
    const r = rendererFor(sim, events);
    expect(priv(r).missileFx.missiles.map((m) => m.variant)).toEqual(['unguided']);
    r.dispose();
  });

  it('lands on the sim\'s own resolution tick, give or take one (spec D1, P-1)', () => {
    for (const [json, gap] of [[SPIKE, 7], [RPG, 4]] as const) {
      const { sim, shooter, events, tick } = fire(json, gap);
      const r = rendererFor(sim, events);
      const duration = priv(r).missileFx.missiles[0].duration;
      let resolvedAt = -1;
      for (let i = 0; i < 400 && resolvedAt < 0; i++) {
        const ev = sim.tick();
        if (ev.some((e) => (e.kind === 'impact' || e.kind === 'nearMiss' || e.kind === 'aps') && e.shooter === shooter)) {
          resolvedAt = sim.tickCount;
        }
      }
      expect(resolvedAt).toBeGreaterThan(0);
      expect(Math.abs((resolvedAt - tick) * 0.05 - duration)).toBeLessThanOrEqual(0.05 + 1e-9);
      r.dispose();
    }
  });

  it('throws the HEAT impact once, on the frame the missile lands, at its own power and heading', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    r.useEmitters([IMPACT], (k) => (k.startsWith('#') ? k : '#FFB43C'));
    const calls: MissileLanding[] = [];
    const real = priv(r).spawnMissileImpactFx.bind(r);
    priv(r).spawnMissileImpactFx = (l) => {
      calls.push(l);
      real(l);
    };
    const frames = Math.ceil(priv(r).missileFx.missiles[0].duration * 60);
    for (let i = 0; i < frames - 2; i++) priv(r).updateFx(1000 / 60);
    expect(calls).toHaveLength(0);
    for (let i = 0; i < 4; i++) priv(r).updateFx(1000 / 60);
    expect(calls).toHaveLength(1);
    expect(calls[0].power).toBe(0.25);
    expect(calls[0].x).toBeCloseTo(11, 0);
    expect(priv(r).flashLights.liveCount).toBeGreaterThan(0);
    r.dispose();
  });

  it('an APS intercept detonates the in-flight missile at that target, at half scale (spec D4)', () => {
    const { sim, target, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    const calls: MissileLanding[] = [];
    priv(r).spawnMissileImpactFx = (l) => calls.push(l);
    priv(r).updateFx(300);
    const aps: SimEvent = { kind: 'aps', tick: 1, target, shooter: 0, pIntercept: 0, roll: 0, intercepted: true };
    r.onEvents([aps]);
    expect(calls).toHaveLength(1);
    expect(calls[0].scale).toBe(0.5);
    expect(priv(r).missileFx.missiles).toHaveLength(0);
    r.dispose();
  });

  it('names the impact emitter the data ships', () => {
    expect(MISSILE_IMPACT_EMITTER_ID).toBe('missile_impact');
  });

  it('the missiles debug layer hides all three meshes and answers 3', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    expect(r.setDebugLayerVisible('missiles', false)).toBe(3);
    r.dispose();
  });
});
