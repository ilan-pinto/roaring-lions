/**
 * GH-85: the effect triggers the schema declared and nothing dispatched,
 * pinned where they are dispatched. Each case asks the one question that
 * puts an effect on screen: does `ThreeRenderer` spawn THIS emitter's layers
 * on THIS event, on the right clock -- and nothing for the events that must
 * stay silent.
 *
 * Harness and `vi.mock` stand-in from `ThreeRenderer.missile.test.ts` /
 * `ThreeRenderer.blast.test.ts` (read the latter's top comment for why a real
 * `WebGLRenderer` cannot construct here). The emitters are the SHIPPED JSON,
 * handed to the real `useEmitters`, so an id the renderer names and no file
 * carries is a red test rather than a stub that agrees with itself.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { EmitterSpec, ParticleSpec } from '../vfx/emitters';
import type { ShellModel } from './units/shells';
import { WRECK_SMOULDER_SECONDS } from './units/trigger-fx';
import ricochetJson from '../../../../data/vfx/armor_ricochet.json';
import penetrationJson from '../../../../data/vfx/armor_penetration.json';
import missileTrailJson from '../../../../data/vfx/missile_trail.json';
import rocketTrailJson from '../../../../data/vfx/rocket_trail.json';
import smoulderJson from '../../../../data/vfx/wreck_smoulder.json';
import apsJson from '../../../../data/vfx/aps_launch.json';
import demolitionJson from '../../../../data/vfx/demolition_blast.json';
import dischargeJson from '../../../../data/vfx/smoke_discharge.json';
import shellImpactJson from '../../../../data/vfx/shell_impact.json';
import barrageImpactJson from '../../../../data/vfx/barrage_impact.json';
import airStrikeImpactJson from '../../../../data/vfx/air_strike_impact.json';
import mortarBaseDustJson from '../../../../data/vfx/mortar_base_dust.json';

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

const RICOCHET = ricochetJson as unknown as EmitterSpec;
const PENETRATION = penetrationJson as unknown as EmitterSpec;
const SMOULDER = smoulderJson as unknown as EmitterSpec;
const APS = apsJson as unknown as EmitterSpec;
const DEMOLITION = demolitionJson as unknown as EmitterSpec;
const DISCHARGE = dischargeJson as unknown as EmitterSpec;
const ROCKET_TRAIL = rocketTrailJson as unknown as EmitterSpec;
const MISSILE_TRAIL = missileTrailJson as unknown as EmitterSpec;
// The shipped pair, as `vfxEmitters` registers them: the rocket's puffs are drawn
// by the missile trail's sprite mesh, which needs both looks wired.
const SHELL_IMPACT = shellImpactJson as unknown as EmitterSpec;
const MORTAR_BASE_DUST = mortarBaseDustJson as unknown as EmitterSpec;
const BARRAGE_IMPACT = barrageImpactJson as unknown as EmitterSpec;
const AIR_STRIKE_IMPACT = airStrikeImpactJson as unknown as EmitterSpec;
const ALL = [RICOCHET, PENETRATION, SMOULDER, APS, DEMOLITION, DISCHARGE, MISSILE_TRAIL, ROCKET_TRAIL, SHELL_IMPACT, MORTAR_BASE_DUST, BARRAGE_IMPACT, AIR_STRIKE_IMPACT];

const weapon = (id: string, type: string, penetration: number, range = 10) => ({
  id, type, range_tiles: range, effective_range_tiles: range * 0.8, accuracy: 0.95,
  penetration, damage: 50, suppression: 10, rof_per_min: 60,
});

/** A tank gun that always defeats the hull below, and one that never does. */
const GUNNER: UnitTypeJson = {
  id: 't_gun', role: 'tank', hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 2, sight_tiles: 20 },
  weapons: [weapon('gun_120', 'apfsds', 5000)],
};
const MACHINE_GUNNER: UnitTypeJson = {
  ...GUNNER, id: 't_mg', weapons: [weapon('coax', 'hmg', 1)],
};
/** A layer that can lay smoke itself (the `smoke` ability), as a carrier does. */
const SMOKER: UnitTypeJson = { ...GUNNER, id: 't_smoker', abilities: ['smoke'] };
const LAUNCHER: UnitTypeJson = {
  ...GUNNER, id: 't_at', weapons: [weapon('spike', 'atgm', 1, 9)],
};
/** A Grad and a mortar: the two arcing rounds. Same range, same everything. */
const ROCKETEER: UnitTypeJson = {
  ...GUNNER, id: 't_grad', weapons: [weapon('grad_122', 'rocket', 40, 14)],
};
const MORTARMAN: UnitTypeJson = {
  ...GUNNER, id: 't_mortar', weapons: [weapon('mortar_60', 'mortar', 20, 14)],
};
const SAPPER: UnitTypeJson = {
  ...GUNNER, id: 't_sapper', role: 'infantry', weapons: [weapon('charges', 'demolition', 200, 1.5)],
};
/** Armour 300 is past `SOFT_ARMOR_LIMIT`, so a hit is an `impact` event. */
const HULL: UnitTypeJson = {
  id: 'mbt_lavi', role: 'mbt', hull: { hp: 100000, armor: { front: 300, side: 300, rear: 300 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1, sight_tiles: 1 }, weapons: [],
};

interface Privates {
  particleSystem: { spawn(spec: ParticleSpec, ...rest: unknown[]): void } | null;
  bolts: ShellModel[];
  fog: Uint8Array;
  updateFx(ms: number, alpha?: number): void;
  shells: ShellModel[];
  missileFx: { trail: { live: number; alive: Uint8Array; style: Uint8Array; pWorldY: Float32Array; capacity: number }; spriteMesh: { count: number } };
  wreckSmoulder: Map<number, unknown>;
  pendingCharges: unknown[];
  hitStop: { remainingMs: number };
  decalsPersistent: { liveCount: number };
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

/** Which emitter each spawned layer belongs to, by object identity -- the
 *  library holds the very objects handed to `useEmitters`. A spawn from no
 *  emitter here (a flat fallback puff) records `'flat'`. */
function record(r: ThreeRenderer, at?: { x: number }[]): string[] {
  const owner = new Map<ParticleSpec, string>();
  for (const em of ALL) for (const l of em.particles) owner.set(l, em.id);
  const ps = priv(r).particleSystem;
  if (ps === null) throw new Error('fixture: useEmitters built no ParticleSystem');
  const out: string[] = [];
  const real = ps.spawn.bind(ps);
  ps.spawn = (spec: ParticleSpec, ...rest: unknown[]): void => {
    out.push(owner.get(spec) ?? 'flat');
    at?.push({ x: rest[0] as number });
    real(spec, ...rest);
  };
  return out;
}

function world(
  shooterJson: UnitTypeJson,
  gap = 6
): { sim: Sim; r: ThreeRenderer; shooter: number; target: number; log: string[]; at: { x: number }[] } {
  const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 16 });
  const s = sim.addUnitType(shooterJson);
  const t = sim.addUnitType(HULL);
  const shooter = sim.spawn(s, 0, fx.from(4.5), fx.from(4.5));
  const target = sim.spawn(t, 1, fx.from(4.5 + gap), fx.from(4.5));
  const r = new ThreeRenderer(sim, makeOpts());
  r.useEmitters(ALL, (k) => (k.startsWith('#') ? k : '#E6D8BE'));
  r.snapshot();
  r.snapshot();
  const at: { x: number }[] = [];
  return { sim, r, shooter, target, log: record(r, at), at };
}

/** `main.ts`'s `runTick` without audio or missions, and with NO frame: the
 *  rounds stay where they were launched until a frame moves them. */
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

function landAll(r: ThreeRenderer): void {
  for (let i = 0; i < 120 && priv(r).bolts.length > 0; i++) priv(r).updateFx(1000 / 60);
}

describe('a direct-fire round meeting a hull lands its outcome where it lands (GH-85)', () => {
  it('a round the plate stops throws armor_ricochet -- on the frame it lands, not on the tick', () => {
    const { sim, r, shooter, log } = world(MACHINE_GUNNER);
    const hit = tickUntil(sim, r, (e) => e.kind === 'impact' && e.shooter === shooter);
    expect(hit.kind === 'impact' && hit.penetrated).toBe(false);
    // Latched, not thrown: the streak carrying it is still in the air.
    expect(log).not.toContain('armor_ricochet');
    expect(priv(r).bolts.some((b) => b.strike?.penetrated === false)).toBe(true);
    landAll(r);
    expect(log).toContain('armor_ricochet');
    expect(log).not.toContain('armor_penetration');
    r.dispose();
  });

  it('a round that defeats it throws armor_penetration instead of the flat flash', () => {
    const { sim, r, shooter, log, at } = world(GUNNER);
    tickUntil(sim, r, (e) => e.kind === 'impact' && e.shooter === shooter && e.penetrated);
    // The flat flash this used to throw at once, AT THE HULL (x 10.5), is
    // gone. (The shooter's own muzzle puff, x ~5, is the unloaded fire
    // emitter's flat fallback and is not this.)
    expect(log.filter((k, i) => (k === 'flat' || k === 'armor_penetration') && at[i].x > 8)).toEqual([]);
    landAll(r);
    expect(log).toContain('armor_penetration');
    expect(log).not.toContain('armor_ricochet');
    r.dispose();
  });

  it('a missile hitting the same hull throws neither: missile_impact owns it', () => {
    const { sim, r, shooter, log } = world(LAUNCHER, 6);
    tickUntil(sim, r, (e) => (e.kind === 'impact' || e.kind === 'nearMiss') && e.shooter === shooter);
    for (let i = 0; i < 300; i++) priv(r).updateFx(1000 / 60);
    expect(log).not.toContain('armor_ricochet');
    expect(log).not.toContain('armor_penetration');
    r.dispose();
  });
});

describe('the one-shot sim events (GH-85)', () => {
  it('an APS engagement throws aps_launch whether or not it got the round', () => {
    for (const intercepted of [true, false]) {
      const { r, shooter, target, log } = world(LAUNCHER);
      r.onEvents([{ kind: 'aps', tick: 1, target, shooter, pIntercept: 0, roll: 0, intercepted } as SimEvent]);
      expect(log).toContain('aps_launch');
      r.dispose();
    }
  });

  it('laying smoke throws smoke_discharge at the unit that laid it', () => {
    const { r, shooter, log } = world(SMOKER);
    r.onEvents([{ kind: 'smokeLaid', tick: 1, by: shooter, x: fx.from(9), y: fx.from(4.5) } as SimEvent]);
    expect(log).toEqual(expect.arrayContaining(['smoke_discharge']));
    expect(log).not.toContain('mortar_base_dust');
    r.dispose();
  });

  it('a called smoke round throws no launcher pop at its caller, a thud at the point instead (F-Q8)', () => {
    // GUNNER has no `smoke` ability: whoever it is, it cannot have lit this itself.
    const { r, shooter, log } = world(GUNNER);
    r.onEvents([{ kind: 'smokeLaid', tick: 1, by: shooter, x: fx.from(9), y: fx.from(4.5) } as SimEvent]);
    expect(log).not.toContain('smoke_discharge');
    expect(log).toContain('mortar_base_dust');
    r.dispose();
  });

  it('a carrier far from its point is a called round too', () => {
    const { r, shooter, log } = world(SMOKER);
    r.onEvents([{ kind: 'smokeLaid', tick: 1, by: shooter, x: fx.from(24.5), y: fx.from(4.5) } as SimEvent]);
    expect(log).not.toContain('smoke_discharge');
    expect(log).toContain('mortar_base_dust');
    r.dispose();
  });

  it('a demolition charge that misses goes off where the sim says it landed', () => {
    const { r, shooter, log } = world(SAPPER, 1);
    r.onEvents([{ kind: 'nearMiss', tick: 1, shooter, weaponId: 'charges', x: fx.from(5), y: fx.from(5) } as SimEvent]);
    expect(log).toContain('demolition_blast');
    // A rifle round's near miss from the same thrower is still a dust puff.
    const rifleLog = world(MACHINE_GUNNER);
    rifleLog.r.onEvents([{ kind: 'nearMiss', tick: 1, shooter: rifleLog.shooter, weaponId: 'coax', x: fx.from(5), y: fx.from(5) } as SimEvent]);
    expect(rifleLog.log).not.toContain('demolition_blast');
    r.dispose();
    rifleLog.r.dispose();
  });

  it('a charge thrown at a building goes off on its structureHit, and not on an earlier rifle hit', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const sType = sim.addStructureType({ id: 'shanty', hp_per_tile: 5000, height_px: 11, color: 'dust.1' });
    const building = sim.addStructure(sType, [5 * 32 + 6]);
    // 1.5 tiles west of the one-tile building's centre (6.5, 5.5).
    const sapper = sim.spawn(sim.addUnitType(SAPPER), 0, fx.from(5), fx.from(5.5));
    const r = new ThreeRenderer(sim, makeOpts());
    r.useEmitters(ALL, (k) => (k.startsWith('#') ? k : '#E6D8BE'));
    r.snapshot();
    r.snapshot();
    const log = record(r);
    const base = { pHit: 0, roll: 0, willHit: true, breakdown: {} };
    r.onEvents([{ kind: 'fire', tick: 10, shooter: sapper, target: -1, structure: building, weaponId: 'charges', ...base } as unknown as SimEvent]);
    expect(priv(r).pendingCharges).toHaveLength(1);
    const hit = (tick: number): SimEvent =>
      ({ kind: 'structureHit', tick, structure: building, by: sapper, damage: 0, hpLeft: fx.from(1) }) as SimEvent;
    // Distance 1.5 tiles: 15 whole ticks, resolving on tick 24. Tick 11 is a
    // rifle round from the same team, long before the charge can arrive.
    r.onEvents([hit(11)]);
    expect(log).not.toContain('demolition_blast');
    r.onEvents([hit(24)]);
    expect(log).toContain('demolition_blast');
    expect(priv(r).pendingCharges).toHaveLength(0);
    r.dispose();
  });

  it('a charge no event names (a hit on a soft unit emits none) still goes off once it is overdue', () => {
    const { sim, r, shooter, target, log } = world(SAPPER, 1);
    const base = { pHit: 0, roll: 0, willHit: true, breakdown: {} };
    r.onEvents([{ kind: 'fire', tick: sim.tickCount - 1, shooter, target, weaponId: 'charges', ...base } as unknown as SimEvent]);
    expect(priv(r).pendingCharges).toHaveLength(1);
    for (let i = 0; i < 20 && priv(r).pendingCharges.length > 0; i++) {
      sim.tick();
      r.snapshot();
      r.onEvents([]);
    }
    expect(priv(r).pendingCharges).toHaveLength(0);
    expect(log).toContain('demolition_blast');
    r.dispose();
  });
});

describe('a fire-support round draws by its profile (F-Q8)', () => {
  const strike = (shooter: number, profile: number): SimEvent =>
    ({ kind: 'strike', tick: 1, by: shooter, x: fx.from(12.5), y: fx.from(8.5), profile }) as SimEvent;

  // GH-748 (the lead, 22 Oct): each call throws its OWN detonation -- the
  // barrage `barrage_impact` at 0.8, the strike `air_strike_impact` at 1.5 --
  // in place of the mortar's shell burst and the old 18 flat puffs.
  it('a barrage round throws barrage_impact: not the mortar shell, no flat puffs', () => {
    const { r, shooter, log } = world(GUNNER);
    r.onEvents([strike(shooter, 1)]);
    expect(log).toContain('barrage_impact');
    expect(log).not.toContain('shell_impact');
    expect(log).not.toContain('air_strike_impact');
    expect(log.filter((k) => k === 'flat')).toHaveLength(0);
    // No freeze-frame on a barrage round.
    expect(priv(r).hitStop.remainingMs).toBe(0);
    r.dispose();
  });

  it('a precision strike throws air_strike_impact with a 60 ms freeze-frame and a shock ring', () => {
    const { r, shooter, log } = world(GUNNER);
    r.onEvents([strike(shooter, 0)]);
    expect(log).toContain('air_strike_impact');
    expect(log).not.toContain('shell_impact');
    expect(log.filter((k) => k === 'flat')).toHaveLength(0);
    expect(priv(r).hitStop.remainingMs).toBeCloseTo(60, 6);
    expect(r.debugSupport().rings).toBe(1);
    expect(r.debugSupport().lights).toBe(1);
    r.dispose();
  });

  it('a quiet renderer still marks the ground under a strike, and throws nothing else', () => {
    const { r, shooter, log } = world(GUNNER);
    r.setQuiet(true);
    const before = priv(r).decalsPersistent.liveCount;
    r.onEvents([strike(shooter, 0), strike(shooter, 1)]);
    // A crater and a scorch each: the world keeps them (quiet.ts).
    expect(priv(r).decalsPersistent.liveCount - before).toBe(4);
    expect(log).toHaveLength(0);
    expect(r.debugSupport()).toMatchObject({ rings: 0, lights: 0 });
    expect(priv(r).hitStop.remainingMs).toBe(0);
    r.dispose();
  });

  it('a strike whose emitter is not loaded throws no light, shake or ring', () => {
    const { r, shooter } = world(GUNNER);
    r.useEmitters(ALL.filter((e) => e !== AIR_STRIKE_IMPACT), (k) => (k.startsWith('#') ? k : '#E6D8BE'));
    r.onEvents([strike(shooter, 0)]);
    expect(r.debugSupport()).toMatchObject({ rings: 0, lights: 0 });
    r.dispose();
  });

  it('the copied numbers match tuning.ts', () => {
    const tuning = readFileSync(new URL('../../../sim/src/tuning.ts', import.meta.url), 'utf8');
    const num = (name: string): number => Number(new RegExp(`export const ${name} = (\\d+)`).exec(tuning)?.[1]);
    const src = readFileSync(new URL('./ThreeRenderer.ts', import.meta.url), 'utf8');
    expect(src).toContain(`const FS_MORTAR_BARRAGE = ${num('FS_MORTAR_BARRAGE')};`);
    expect(src).toContain(`const CARRIER_SMOKE_RANGE_SQ_TILES = ${num('SMOKE_RANGE_SQ')} / 65536;`);
  });
});

describe('a burnt-out hull smoulders on the sim clock (GH-85)', () => {
  function killed(shooter: UnitTypeJson = GUNNER): { sim: Sim; r: ThreeRenderer; log: string[] } {
    const { sim, r, target, log } = world(shooter);
    sim.debugKill(target);
    const events = sim.tick();
    r.snapshot();
    r.onEvents(events);
    expect(priv(r).wreckSmoulder.size).toBe(1);
    return { sim, r, log };
  }
  const smoulders = (log: string[]): number => log.filter((k) => k === 'wreck_smoulder').length;

  it('emits as sim time passes, and a zero-time repaint emits nothing', () => {
    const { sim, r, log } = killed();
    priv(r).fog.fill(2);
    for (let i = 0; i < 40; i++) {
      sim.tick();
      r.snapshot();
      priv(r).updateFx(50, 0);
    }
    const n = smoulders(log);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) priv(r).updateFx(0, 0);
    expect(smoulders(log)).toBe(n);
    r.dispose();
  });

  it('stays dark on ground nobody has seen', () => {
    // The only friendly sees one tile, so the wreck six tiles off is never
    // explored -- `snapshot()` recomputes the fog from sight every tick.
    const { sim, r, log } = killed({ ...GUNNER, id: 't_blind', sensors: { optics: 1, sight_tiles: 1 } });
    for (let i = 0; i < 40; i++) {
      sim.tick();
      r.snapshot();
      priv(r).updateFx(50, 0);
    }
    expect(smoulders(log)).toBe(0);
    r.dispose();
  });

  it('goes out after WRECK_SMOULDER_SECONDS and lets go of the wreck', () => {
    const { sim, r, log } = killed();
    priv(r).fog.fill(2);
    const ticks = (WRECK_SMOULDER_SECONDS + 5) * 20;
    for (let i = 0; i < ticks; i++) sim.tick();
    r.snapshot();
    priv(r).updateFx(50, 0);
    expect(priv(r).wreckSmoulder.size).toBe(0);
    // Jumping straight past the window emits nothing for it.
    expect(smoulders(log)).toBe(0);
    r.dispose();
  });

  it('a soft unit dying leaves no smoulder', () => {
    const { sim, r, shooter } = world(SAPPER);
    sim.debugKill(shooter);
    const events = sim.tick();
    r.snapshot();
    r.onEvents(events);
    expect(priv(r).wreckSmoulder.size).toBe(0);
    r.dispose();
  });
});

describe('an arcing rocket trails smoke along its real arc (GH-85)', () => {
  /** Fire, then fly the round for `frames` frames; the live trail puffs. */
  function flown(shooterJson: UnitTypeJson, frames: number): { live: number; maxY: number; rockets: boolean; drawn: number } {
    const { sim, r, shooter } = world(shooterJson, 12);
    tickUntil(sim, r, (e) => e.kind === 'fire' && e.shooter === shooter);
    expect(priv(r).shells.length).toBeGreaterThan(0);
    const rockets = priv(r).shells.every((sh) => sh.kind === 'rocket');
    for (let i = 0; i < frames; i++) priv(r).updateFx(1000 / 60);
    const tr = priv(r).missileFx.trail;
    let maxY = 0;
    for (let i = 0; i < tr.capacity; i++) if (tr.alive[i] === 1) maxY = Math.max(maxY, tr.pWorldY[i]);
    const out = { live: tr.live, maxY, rockets, drawn: priv(r).missileFx.spriteMesh.count };
    r.dispose();
    return out;
  }

  it('a Grad rocket leaves a trail that rises with the round, drawn by the missile sprite mesh', () => {
    const f = flown(ROCKETEER, 30);
    expect(f.rockets).toBe(true);
    expect(f.live).toBeGreaterThan(3);
    // A puff laid at height: the ground is world Y 0 on this flat map.
    expect(f.maxY).toBeGreaterThan(0.15);
    expect(f.drawn).toBe(f.live);
  });

  it('a mortar bomb leaves none: it is unpowered', () => {
    const f = flown(MORTARMAN, 30);
    expect(f.rockets).toBe(false);
    expect(f.live).toBe(0);
  });
});
