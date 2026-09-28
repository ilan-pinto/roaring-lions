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

// The Hellfire's shape: an ATGM carried by an `air` unit.
const GUNSHIP: UnitTypeJson = {
  ...SPIKE, id: 't_gunship', role: 'gunship',
  mobility: { speed_tiles_s: 0, domain: 'air' },
  weapons: [{ id: 'hellfire', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78,
    penetration: 900, damage: 800, suppression: 60, rof_per_min: 3, min_range_tiles: 1 }],
};
// `fire_missile`'s ground layers: the backblast plume and the dust ring.
const FIRE_MISSILE: EmitterSpec = {
  id: 'fire_missile', trigger: 'weapon_fire', layer: 'above_units', weapon_classes: ['atgm', 'rpg'],
  light: { color: 'vfx.fire', intensity: 2, radius_tiles: 3, decay_ms: 180 },
  particles: [
    { sprite: 'smoke_puff', count: [8, 12], lifetime_ms: [600, 1200], direction_offset_deg: 180, color_over_life: ['limestone.2'] },
    { sprite: 'smoke_puff', count: [6, 9], lifetime_ms: [500, 900], cone_deg: 360, color_over_life: ['dust.2'] },
  ],
};

interface Privates {
  missileFx: { missiles: MissileModel[] };
  bolts: unknown[];
  tracers: unknown[];
  flashLights: { liveCount: number; spawn(x: number, z: number, groundY: number, spec: { intensity: number }, colorHex: string): void };
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

/** One 60 fps frame of the app's loop: the sim ticks every third frame, as
 *  `main.ts`'s fixed 20 Hz clock does, then the frame draws. The sim's own
 *  events are not delivered -- these cases read only the missile path. */
function playFrame(r: ThreeRenderer, sim: Sim, frame: number): void {
  if (frame % 3 === 0) {
    sim.tick();
    r.snapshot();
  }
  priv(r).updateFx(1000 / 60);
}

/**
 * The race the final fix wave closes. The sim emits `aps` on the round's
 * RESOLUTION tick and never mid-flight; the frame clock can finish the
 * flight first (about 1 time in 3 at 60 fps, every time paused mid-flight).
 * Here it does, as far as it can: the frames run well past the flight with
 * the sim held, then the sim catches up to that tick and its `aps` arrives
 * exactly the way `main.ts`'s `runTick` delivers one -- tick, snapshot,
 * events -- before the next frame draws.
 */
function interceptOnResolutionTick(r: ThreeRenderer, sim: Sim, shooter: number, target: number): void {
  const m = priv(r).missileFx.missiles[0];
  const frames = Math.ceil(m.duration * 60) * 2;
  for (let i = 0; i < frames; i++) priv(r).updateFx(1000 / 60);
  const resolveTick = sim.tickCount - 1 + Math.round(m.duration / 0.05);
  while (sim.tickCount <= resolveTick) sim.tick();
  r.snapshot();
  r.onEvents([{ kind: 'aps', tick: resolveTick, target, shooter, pIntercept: 0, roll: 0, intercepted: true }]);
  for (let i = 0; i < 3; i++) priv(r).updateFx(1000 / 60);
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
    let f = 0;
    for (; f < frames - 2; f++) playFrame(r, sim, f);
    expect(calls).toHaveLength(0);
    for (; f < frames + 2; f++) playFrame(r, sim, f);
    expect(calls).toHaveLength(1);
    expect(calls[0].power).toBe(0.25);
    expect(calls[0].x).toBeCloseTo(11, 0);
    expect(priv(r).flashLights.liveCount).toBeGreaterThan(0);
    r.dispose();
  });

  it('an aps on the resolution tick intercepts the round even when the frame clock finished first -- 1.3 flash, no scorch (spec D4)', () => {
    const { sim, shooter, target, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    r.useEmitters([IMPACT], (k) => (k.startsWith('#') ? k : '#FFB43C'));
    const seen = lightIntensities(r);
    const calls: MissileLanding[] = [];
    const real = priv(r).spawnMissileImpactFx.bind(r);
    priv(r).spawnMissileImpactFx = (l) => {
      calls.push(l);
      real(l);
    };
    interceptOnResolutionTick(r, sim, shooter, target);
    // ONE detonation, and it is the intercept's: half scale, killed in the
    // air (so no scorch), lit at 2.6 x 0.5. A frame-clock landing would have
    // been scale 1 and 2.6, and the aps would then have found nothing.
    expect(calls).toHaveLength(1);
    expect(calls[0].scale).toBe(0.5);
    expect(calls[0].miss).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(1.3, 9);
    expect(priv(r).missileFx.missiles).toHaveLength(0);
    r.dispose();
  });

  it('a paused sim HOLDS a missile whose flight is over, rather than landing it', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    const calls: MissileLanding[] = [];
    priv(r).spawnMissileImpactFx = (l) => calls.push(l);
    const duration = priv(r).missileFx.missiles[0].duration;
    const resolveTick = sim.tickCount - 1 + Math.round(duration / 0.05);
    const frames = Math.ceil(duration * 60) * 3;
    for (let i = 0; i < frames; i++) priv(r).updateFx(1000 / 60);
    expect(calls).toHaveLength(0);
    expect(priv(r).missileFx.missiles).toHaveLength(1);
    // Unpaused: once the sim has passed the resolution tick with no aps, the
    // next frame lands it -- a full hit, at scale 1.
    while (sim.tickCount <= resolveTick) sim.tick();
    r.snapshot();
    priv(r).updateFx(1000 / 60);
    expect(calls).toHaveLength(1);
    expect(calls[0].scale).toBe(1);
    r.dispose();
  });

  // LEAD DECISION (28 Sep): no ground backblast for an air launcher. The
  // missile still leaves from AIR_LIFT_PX (N7); only the muzzle's ground
  // plume, dust ring and ground light go.
  function fireSpawns(json: UnitTypeJson): { particles: number; lights: number; missiles: number } {
    const { sim, events } = fire(json, 7);
    const r = new ThreeRenderer(sim, makeOpts());
    r.useEmitters([FIRE_MISSILE], (k) => (k.startsWith('#') ? k : '#E6D8BE'));
    r.snapshot();
    const ps = (r as unknown as { particleSystem: { spawn(...a: unknown[]): void } | null }).particleSystem;
    if (ps === null) throw new Error('fixture: useEmitters built no ParticleSystem');
    let particles = 0;
    const realSpawn = ps.spawn.bind(ps);
    ps.spawn = (...a: unknown[]): void => {
      particles++;
      realSpawn(...a);
    };
    let lights = 0;
    const fl = priv(r).flashLights;
    const realLight = fl.spawn.bind(fl);
    fl.spawn = (x, z, groundY, spec, colorHex) => {
      lights++;
      realLight(x, z, groundY, spec, colorHex);
    };
    r.onEvents(events.filter((e) => e.kind === 'fire'));
    const missiles = priv(r).missileFx.missiles.length;
    r.dispose();
    return { particles, lights, missiles };
  }

  it('an air launcher throws no ground backblast; a ground launcher still does', () => {
    const air = fireSpawns(GUNSHIP);
    expect(air.missiles).toBe(1);
    expect(air.particles).toBe(0);
    expect(air.lights).toBe(0);
    const ground = fireSpawns(SPIKE);
    expect(ground.missiles).toBe(1);
    expect(ground.particles).toBe(FIRE_MISSILE.particles.length);
    expect(ground.lights).toBe(1);
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

  it('hands MissileFx the same track object every frame -- bound once, not built per frame', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    const seen: unknown[] = [];
    const fxObj = priv(r).missileFx as unknown as { step: (...a: unknown[]) => MissileLanding[] };
    const realStep = fxObj.step.bind(fxObj);
    fxObj.step = (...a: unknown[]): MissileLanding[] => {
      seen.push(a[1]);
      return realStep(...a);
    };
    priv(r).updateFx(1000 / 60);
    priv(r).updateFx(1000 / 60);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    r.dispose();
  });

  it('an aps event from a DIFFERENT shooter leaves the missile flying -- the event names the round', () => {
    const { sim, shooter, target, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    const calls: MissileLanding[] = [];
    priv(r).spawnMissileImpactFx = (l) => calls.push(l);
    priv(r).updateFx(300);
    const aps: SimEvent = { kind: 'aps', tick: 1, target, shooter: shooter + 1, pIntercept: 0, roll: 0, intercepted: true };
    r.onEvents([aps]);
    expect(calls).toHaveLength(0);
    expect(priv(r).missileFx.missiles).toHaveLength(1);
    r.dispose();
  });

  // P-4: light (and shake) are the emitter's authored values x `scale`, NOT
  // x `power`. IMPACT authors intensity 2.6; a landing is scale 1, an
  // intercept 0.5. `power` is 0.25 for the Spike, so the wrong factor reads
  // 0.65 / 0.325 and fails both.
  function lightIntensities(r: ThreeRenderer): number[] {
    const out: number[] = [];
    const lights = priv(r).flashLights;
    const real = lights.spawn.bind(lights);
    lights.spawn = (x, z, groundY, spec, colorHex) => {
      out.push(spec.intensity);
      real(x, z, groundY, spec, colorHex);
    };
    return out;
  }

  it('lights a landing at the authored intensity x scale 1 -- 2.6 (P-4)', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    r.useEmitters([IMPACT], (k) => (k.startsWith('#') ? k : '#FFB43C'));
    const seen = lightIntensities(r);
    const frames = Math.ceil(priv(r).missileFx.missiles[0].duration * 60) + 3;
    for (let f = 0; f < frames; f++) playFrame(r, sim, f);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(2.6, 9);
    r.dispose();
  });

  it('lights an intercept at the authored intensity x scale 0.5 -- 1.3 (P-4)', () => {
    const { sim, shooter, target, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    r.useEmitters([IMPACT], (k) => (k.startsWith('#') ? k : '#FFB43C'));
    const seen = lightIntensities(r);
    interceptOnResolutionTick(r, sim, shooter, target);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(1.3, 9);
    r.dispose();
  });
});
