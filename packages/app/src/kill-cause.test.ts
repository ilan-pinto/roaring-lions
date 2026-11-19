/**
 * GH-1380: the kill-cause line. Two layers, both with literals as the oracle:
 *  1. the REAL sim, run until something dies, its own events fed to the tracker -- one case per path (a gun penetration on the front, the side
 *     and the rear plate; a kamikaze on a hard hull and on a soft man; a beam; a soft target shot dead). The expected arc is read off the sim's own
 *     `impact` event for the same round, so the fixture cannot claim a flank it did not produce;
 *  2. hand-built event sequences for what a seed cannot be made to do (the join rules: a stale hit, someone else's hit, a bounce, a pinned victim).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fx, Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { CAUSE_SUMMARY_MAX, CAUSE_WINDOW_TICKS, causeSummary, causeText, KillCauseTracker, parseKillCause, type KillCause } from './kill-cause';
import { setCatalogue } from './i18n/t';
import en from './i18n/en.json';

setCatalogue('en', en as Record<string, string>);

const AT_TEAM: UnitTypeJson = {
  id: 'c_at', hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } }, mobility: { speed_tiles_s: 0.7 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.5 },
  weapons: [{ id: 'spike_atgm', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78, penetration: 900, damage: 400, suppression: 10, rof_per_min: 3 }],
};
/** A hull that one penetration cannot be survived by, with a different plate on each face. */
const HULL: UnitTypeJson = {
  id: 'c_hull', role: 'apc', hull: { hp: 300, armor: { front: 700, side: 300, rear: 150 } }, mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 1 }, weapons: [],
};
const INF: UnitTypeJson = {
  id: 'c_inf', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } }, mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [{ id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 }],
};
const DUMMY_INF: UnitTypeJson = { ...INF, id: 'c_dummy_inf', weapons: [] };
const MUNITION: UnitTypeJson = {
  id: 'k_munition', role: 'drone', hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 } }, mobility: { speed_tiles_s: 3 },
  sensors: { optics: 1.4, sight_tiles: 14, signature: 0.3 }, abilities: ['kamikaze'],
  weapons: [{ id: 'warhead', type: 'heat', range_tiles: 1.3, effective_range_tiles: 1.3, accuracy: 0.9, penetration: 480, damage: 520, splash_tiles: 1.2, suppression: 70, rof_per_min: 60 }],
};
const BEAM_CARRIER: UnitTypeJson = {
  id: 'b_carrier', role: 'aa', hull: { hp: 1100, armor: { front: 40, side: 25, rear: 20 } }, mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1.4, sight_tiles: 12, signature: 0.9 },
  weapons: [{ id: 'beam', type: 'directed_energy', range_tiles: 9, accuracy: 1, penetration: 5, damage: 80, rof_per_min: 40, can_target: ['air'], collateral_risk: 0, beam: { dwell_s: 1.5, heat_s: 12, cooldown_s: 6 } }],
};
const DRONE: UnitTypeJson = {
  id: 'b_drone', role: 'drone', hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } }, mobility: { speed_tiles_s: 1.0, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 6, signature: 1.0 },
};

const CALLER: UnitTypeJson = { id: 's_caller', role: 'infantry', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } }, mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 4, signature: 0.5 } };
const HELI: UnitTypeJson = {
  id: 'h_heli', role: 'apc', hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' }, sensors: { optics: 1, sight_tiles: 10, signature: 1 }, weapons: [],
};

const name = (id: string): string =>
  ({ c_at: 'AT team', c_hull: 'Carrier', c_inf: 'Rifle squad', k_munition: 'Loitering munition', b_carrier: 'Laser truck', b_drone: 'Drone', s_caller: 'Observer' })[id] ?? id;

interface Death {
  victim: number;
  by: number;
  cause: KillCause;
  events: SimEvent[];
}

/** Run `sim` until `victim` is destroyed (or `max` ticks), feeding a tracker the sim's own events. */
function runToDeath(sim: Sim, victim: number, max = 400 * TICKS_PER_SECOND): Death {
  const tracker = new KillCauseTracker({
    typeIdOf: (e) => sim.unitTypes[sim.state.typeIdx[e]]?.id,
    isKamikaze: (e) => sim.unitTypes[sim.state.typeIdx[e]]?.isKamikaze === true,
  });
  const events: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    for (const ev of sim.tick()) {
      events.push(ev);
      const cause = tracker.observe(ev);
      if (ev.kind === 'destroyed' && ev.entity === victim) return { victim, by: ev.by, cause: cause as KillCause, events };
    }
  }
  throw new Error('the victim never died');
}

describe('a gun penetration, from the real sim', () => {
  // Attacker due west of the hull. Facing 32768 turns the hull to meet it; 0 turns its back; 16384 / 49152 turn a flank.
  for (const [facing, arc] of [[32768, 'front'], [0, 'rear']] as const) {
    it(`names the ${arc} plate it met and says it penetrated`, () => {
      const sim = new Sim({ seed: 21, width: 32, height: 32, capacity: 8 });
      const hull = sim.spawn(sim.addUnitType(HULL), 1, fx.from(16.5), fx.from(16.5), facing);
      const at = sim.spawn(sim.addUnitType(AT_TEAM), 0, fx.from(10.5), fx.from(16.5));
      const d = runToDeath(sim, hull);
      const lethal = d.events.filter((e) => e.kind === 'impact' && e.target === hull && e.penetrated).at(-1);
      expect(lethal && lethal.kind === 'impact' ? lethal.arc : undefined).toBe(arc); // the fixture produced the aspect it claims
      expect(d.by).toBe(at);
      expect(d.cause).toEqual({ kind: 'gun', attacker: 'c_at', weapon: 'spike_atgm', arc, penetrated: true, suppressed: false });
      expect(causeText(d.cause, name)).toBe(`Penetrated through the ${arc} by AT team (Spike anti-tank missile).`);
    });
  }

  it('a flank shot: the side plate, and the line says side', () => {
    const arcs = new Set<string>();
    for (const facing of [16384, 49152]) {
      const sim = new Sim({ seed: 21, width: 32, height: 32, capacity: 8 });
      const hull = sim.spawn(sim.addUnitType(HULL), 1, fx.from(16.5), fx.from(16.5), facing);
      sim.spawn(sim.addUnitType(AT_TEAM), 0, fx.from(10.5), fx.from(16.5));
      const d = runToDeath(sim, hull);
      expect(d.cause.kind).toBe('gun');
      expect(d.cause.penetrated).toBe(true);
      arcs.add(d.cause.arc as string);
      expect(causeText(d.cause, name)).toContain(`through the ${d.cause.arc}`);
    }
    expect([...arcs]).toEqual(['side']);
  });
});

describe('a soft target shot dead, from the real sim', () => {
  it('names the weapon and the shooter, with no plate and no penetration claim', () => {
    const sim = new Sim({ seed: 5, width: 32, height: 16, capacity: 8 });
    const man = sim.spawn(sim.addUnitType(DUMMY_INF), 1, fx.from(7.5), fx.from(8.5));
    sim.spawn(sim.addUnitType(INF), 0, fx.from(3.5), fx.from(8.5));
    const d = runToDeath(sim, man);
    expect(d.cause).toMatchObject({ kind: 'gun', attacker: 'c_inf', weapon: 'rifles' });
    expect(d.cause.arc).toBeUndefined();
    expect(d.cause.penetrated).toBeUndefined();
    expect(causeText(d.cause, name).startsWith('Shot by Rifle squad (')).toBe(true);
  });
});

describe('a kamikaze, from the real sim', () => {
  it('on a hard hull: a kamikaze strike, no plate reported (the sim stamps its arc as a constant), and the munition is "spent"', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 24, capacity: 8 });
    const hull = sim.spawn(sim.addUnitType({ ...HULL, hull: { hp: 60, armor: { front: 300, side: 10, rear: 10 } } }), 1, fx.from(20.5), fx.from(12.5), 32768);
    const drone = sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(20.5), fx.from(6.5), 16384);
    sim.identifyTo(0, hull);
    const d = runToDeath(sim, hull, 20 * 30);
    expect(d.by).toBe(drone);
    expect(d.cause).toMatchObject({ kind: 'kamikaze', attacker: 'k_munition', weapon: 'warhead', penetrated: true });
    expect(d.cause.arc).toBeUndefined();
    expect(causeText(d.cause, name)).toBe('Struck by Loitering munition.');
  });

  it('on a soft man: no impact event exists, so the attacker\'s ability is the whole answer', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 24, capacity: 8 });
    const man = sim.spawn(sim.addUnitType({ ...DUMMY_INF, hull: { hp: 100, armor: { front: 10, side: 10, rear: 10 } } }), 1, fx.from(20.5), fx.from(12.5));
    sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(20.5), fx.from(6.5), 16384);
    sim.identifyTo(0, man);
    const d = runToDeath(sim, man, 20 * 30);
    // GH-1380 sim step: the `destroyed` event now names the warhead, so the soft-target strike carries it too.
    expect(d.cause).toEqual({ kind: 'kamikaze', attacker: 'k_munition', weapon: 'warhead', suppressed: false });
  });

  it('a man beside the hull it struck is caught in the warhead\'s blast: splash, with no plate and no penetration claimed', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 24, capacity: 8 });
    const hull = sim.spawn(sim.addUnitType({ ...HULL, hull: { hp: 60, armor: { front: 300, side: 10, rear: 10 } } }), 1, fx.from(20.5), fx.from(12.5), 32768);
    const man = sim.spawn(sim.addUnitType({ ...DUMMY_INF, hull: { hp: 60, armor: { front: 10, side: 10, rear: 10 } } }), 1, fx.from(20.5), fx.from(12.8));
    const drone = sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(20.5), fx.from(6.5), 16384);
    sim.identifyTo(0, hull);
    const d = runToDeath(sim, man, 20 * 30);
    expect(d.by).toBe(drone);
    expect(d.cause).toEqual({ kind: 'splash', attacker: 'k_munition', weapon: 'warhead', suppressed: false });
    expect(causeText(d.cause, name)).toBe('Caught in a blast from Loitering munition (Explosive warhead).');
  });

  it('the munition\'s own death is "spent on its target", never "destroyed by" the thing it hit', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 24, capacity: 8 });
    const hull = sim.spawn(sim.addUnitType(HULL), 1, fx.from(20.5), fx.from(12.5), 32768);
    const drone = sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(20.5), fx.from(6.5), 16384);
    sim.identifyTo(0, hull);
    const d = runToDeath(sim, drone, 20 * 30);
    expect(d.cause).toEqual({ kind: 'spent', attacker: 'c_hull', suppressed: false });
    expect(causeText(d.cause, name)).toBe('Spent on its target.');
  });
});

describe('a beam, from the real sim', () => {
  it('names the beam weapon and the carrier', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 16, capacity: 16 });
    const drone = sim.spawn(sim.addUnitType(DRONE), 1, fx.from(11.5), fx.from(8.5));
    sim.spawn(sim.addUnitType(BEAM_CARRIER), 0, fx.from(3.5), fx.from(8.5));
    const d = runToDeath(sim, drone, 60 * TICKS_PER_SECOND);
    expect(d.cause).toEqual({ kind: 'beam', attacker: 'b_carrier', weapon: 'beam', suppressed: false });
    expect(causeText(d.cause, name)).toBe('Burned down by Laser truck (Laser beam).');
  });
});

describe('the other ways the sim kills, from the real sim (GH-1380: `destroyed` says how)', () => {
  it('a called strike names the caller, and no weapon', () => {
    const sim = new Sim({ seed: 7, width: 48, height: 32, capacity: 16 });
    const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
    const victim = sim.spawn(sim.addUnitType({ ...CALLER, id: 's_victim', hull: { hp: 50, armor: { front: 10, side: 10, rear: 10 } } }), 1, fx.from(24.5), fx.from(16.5));
    sim.queueCommand({ kind: 'callStrike', caller, x: fx.from(24.5), y: fx.from(16.5) });
    const d = runToDeath(sim, victim, 400);
    expect(d.cause).toEqual({ kind: 'strike', attacker: 's_caller', suppressed: false });
    expect(causeText(d.cause, name)).toBe('Caught in a strike called in by Observer.');
  });

  it('a garrison under a building that comes down: a collapse (here credited to nobody)', () => {
    const sim = new Sim({ seed: 5, width: 32, height: 16, capacity: 16 });
    const house = sim.addStructure(sim.addStructureType({ id: 's_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 }), [6 * 32 + 14, 6 * 32 + 15, 7 * 32 + 14, 7 * 32 + 15]);
    const holder = sim.spawn(sim.addUnitType({ ...DUMMY_INF, abilities: ['garrison'] }), 1, fx.from(13.0), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });
    for (let i = 0; i < 20 * TICKS_PER_SECOND && sim.state.garrisonedIn[holder] !== house; i++) sim.tick();
    expect(sim.state.garrisonedIn[holder]).toBe(house); // the fixture put him inside
    sim.debugDestroyStructure(house);
    const d = runToDeath(sim, holder, 2);
    expect(d.cause).toEqual({ kind: 'collapse', suppressed: false });
    expect(causeText(d.cause, name)).toBe('Killed in a collapse.');
  });

  it('riders of an air carrier killed in the air went down with it', () => {
    const sim = new Sim({ seed: 0x6980_0003, width: 40, height: 40, capacity: 16 });
    const heli = sim.spawn(sim.addUnitType(HELI), 0, fx.from(20.5), fx.from(20.5));
    const rider = sim.spawn(sim.addUnitType({ ...DUMMY_INF, role: 'infantry' }), 0, fx.from(20.5), fx.from(20.5));
    expect(sim.embarkAtSpawn(heli, rider)).toBe(true);
    sim.debugKill(heli);
    const d = runToDeath(sim, rider, 2);
    expect(d.cause).toEqual({ kind: 'carrier', suppressed: false });
    expect(causeText(d.cause, name)).toBe('Went down with its carrier.');
  });
});

describe('the join rules (hand-built events)', () => {
  const world = { typeIdOf: (e: number) => (e === 1 ? 'c_at' : e === 2 ? 'c_inf' : e === 9 ? 'c_hull' : undefined), isKamikaze: (e: number) => e === 5 };
  const impact = (tick: number, shooter: number, target: number, penetrated: boolean, arc: 'front' | 'side' | 'rear' = 'side'): SimEvent => ({
    kind: 'impact', tick, shooter, target, weaponId: 'spike_atgm', arc, effectiveArmor: 0, penetration: 0, pPen: 0, roll: 0, penetrated,
  });
  const destroyed = (tick: number, entity: number, by: number): SimEvent => ({ kind: 'destroyed', tick, entity, by });

  it('a bounce is not the cause: the last PENETRATION is, and its arc is the one reported', () => {
    const tr = new KillCauseTracker(world);
    tr.observe(impact(10, 1, 9, true, 'rear'));
    tr.observe(impact(20, 1, 9, false, 'front'));
    expect(tr.observe(destroyed(30, 9, 1))).toMatchObject({ kind: 'gun', arc: 'rear', penetrated: true });
  });

  it('the next round\'s fire event does not erase the penetration that did the killing', () => {
    const tr = new KillCauseTracker(world);
    tr.observe(impact(10, 1, 9, true, 'side'));
    tr.observe({ kind: 'fire', tick: 12, shooter: 1, target: 9, weaponId: 'spike_atgm', pHit: 0, roll: 0, willHit: true, breakdown: {} as never });
    expect(tr.observe(destroyed(14, 9, 1))).toMatchObject({ kind: 'gun', arc: 'side', penetrated: true });
  });

  it('a MISS is not a hit: a later missed round with another weapon does not change the weapon named', () => {
    const tr = new KillCauseTracker(world);
    const fire = (tick: number, weaponId: string, willHit: boolean): SimEvent => ({ kind: 'fire', tick, shooter: 2, target: 9, weaponId, pHit: 0, roll: 0, willHit, breakdown: {} as never });
    tr.observe(fire(10, 'rifles', true));
    tr.observe(fire(12, 'rpg7', false));
    expect(tr.observe(destroyed(14, 9, 2))).toMatchObject({ kind: 'gun', weapon: 'rifles' });
  });

  it('rounds aimed at a building (target -1) and the beam\'s lockout (target -1) make no entry', () => {
    const tr = new KillCauseTracker(world);
    tr.observe({ kind: 'fire', tick: 1, shooter: 2, target: -1, structure: 3, weaponId: 'rifles', pHit: 0, roll: 0, willHit: true, breakdown: {} as never });
    tr.observe({ kind: 'beam', tick: 2, shooter: 1, target: -1, weaponId: 'beam', phase: 'lockout', until: 400 });
    expect((tr as unknown as { hits: Map<number, unknown> }).hits.size).toBe(0);
  });

  it('a hit from SOMEONE ELSE is not the killing blow: the line names only who is credited', () => {
    const tr = new KillCauseTracker(world);
    tr.observe(impact(10, 2, 9, true, 'rear'));
    expect(tr.observe(destroyed(12, 9, 1))).toEqual({ kind: 'other', attacker: 'c_at', suppressed: false });
  });

  it('a hit older than the window is not a candidate; one exactly at the window still is', () => {
    const old = new KillCauseTracker(world);
    old.observe(impact(10, 1, 9, true));
    expect(old.observe(destroyed(10 + CAUSE_WINDOW_TICKS + 1, 9, 1))).toMatchObject({ kind: 'other' });
    const edge = new KillCauseTracker(world);
    edge.observe(impact(10, 1, 9, true));
    expect(edge.observe(destroyed(10 + CAUSE_WINDOW_TICKS, 9, 1))).toMatchObject({ kind: 'gun' });
  });

  it('pinned at the moment of death is reported; unpinned before it is not; and the flag does not leak to the next victim', () => {
    const a = new KillCauseTracker(world);
    a.observe({ kind: 'pinned', tick: 5, entity: 9 });
    expect(a.observe(destroyed(9, 9, 1))?.suppressed).toBe(true);
    const b = new KillCauseTracker(world);
    b.observe({ kind: 'pinned', tick: 5, entity: 9 });
    b.observe({ kind: 'unpinned', tick: 7, entity: 9 });
    expect(b.observe(destroyed(9, 9, 1))?.suppressed).toBe(false);
    expect(a.observe(destroyed(20, 9, 1))?.suppressed).toBe(false); // 9 died once already; the entry went with it
  });

  it('nobody credited and nothing recorded says so, in words, rather than inventing an attacker', () => {
    const tr = new KillCauseTracker(world);
    const c = tr.observe(destroyed(5, 9, -1)) as KillCause;
    expect(c).toEqual({ kind: 'other', suppressed: false });
    expect(causeText(c, name)).toBe('Cause not recorded.');
  });

  it('a pinned victim adds the one tail sentence, after the head', () => {
    const c: KillCause = { kind: 'gun', attacker: 'c_at', weapon: 'spike_atgm', arc: 'rear', penetrated: true, suppressed: true };
    expect(causeText(c, name)).toBe('Penetrated through the rear by AT team (Spike anti-tank missile). It was pinned down.');
  });

  it('the tracker holds nothing for a unit once it is dead (bounded by the live force)', () => {
    const tr = new KillCauseTracker(world);
    for (let e = 100; e < 140; e++) {
      tr.observe(impact(1, 1, e, true));
      tr.observe(destroyed(2, e, 1));
    }
    expect((tr as unknown as { hits: Map<number, unknown> }).hits.size).toBe(0);
  });
});

describe('the join, with the weapon and the cause the sim now puts on `destroyed` (GH-1380, the PR 1435 review follow-ups)', () => {
  const world = { typeIdOf: (e: number) => (e === 1 ? 'c_at' : e === 2 ? 'c_inf' : e === 9 ? 'c_hull' : undefined), isKamikaze: () => false };
  const fire = (tick: number, shooter: number, target: number, weaponId: string): SimEvent => ({ kind: 'fire', tick, shooter, target, weaponId, pHit: 0, roll: 0, willHit: true, breakdown: {} as never });
  const impact = (tick: number, shooter: number, target: number, weaponId: string, arc: 'front' | 'side' | 'rear'): SimEvent => ({
    kind: 'impact', tick, shooter, target, weaponId, arc, effectiveArmor: 0, penetration: 0, pPen: 0, roll: 0, penetrated: true,
  });
  const beam = (tick: number, shooter: number, target: number): SimEvent => ({ kind: 'beam', tick, shooter, target, weaponId: 'beam', phase: 'struck', until: 0 });
  type Cause = NonNullable<Extract<SimEvent, { kind: 'destroyed' }>['cause']>;
  const dead = (tick: number, entity: number, by: number, cause?: Cause, weaponId?: string): SimEvent => ({
    kind: 'destroyed', tick, entity, by, ...(cause === undefined ? {} : { cause }), ...(weaponId === undefined ? {} : { weaponId }),
  });

  it('two attackers on one man: A fires, B fires, A\'s round kills -- A\'s weapon is named, with or without the event\'s weapon', () => {
    for (const ev of [dead(14, 9, 1, 'direct', 'spike_atgm'), dead(14, 9, 1)]) {
      const tr = new KillCauseTracker(world);
      tr.observe(fire(10, 1, 9, 'spike_atgm'));
      tr.observe(fire(12, 2, 9, 'rifles'));
      expect(tr.observe(ev)).toEqual({ kind: 'gun', attacker: 'c_at', weapon: 'spike_atgm', suppressed: false });
    }
  });

  it('a beam that finishes a hull the same shooter\'s gun had holed names the beam, not the old plate', () => {
    for (const ev of [dead(14, 9, 1, 'direct', 'beam'), dead(14, 9, 1)]) {
      const tr = new KillCauseTracker(world);
      tr.observe(impact(10, 1, 9, 'spike_atgm', 'rear'));
      tr.observe(beam(12, 1, 9));
      expect(tr.observe(ev)).toEqual({ kind: 'beam', attacker: 'c_at', weapon: 'beam', suppressed: false });
    }
  });

  it('the event\'s weapon picks the slot: a later shot with another of the attacker\'s weapons does not take the kill', () => {
    const tr = new KillCauseTracker(world);
    tr.observe(impact(10, 1, 9, 'spike_atgm', 'rear'));
    tr.observe(fire(12, 1, 9, 'rifles'));
    expect(tr.observe(dead(14, 9, 1, 'direct', 'spike_atgm'))).toEqual({ kind: 'gun', attacker: 'c_at', weapon: 'spike_atgm', arc: 'rear', penetrated: true, suppressed: false });
  });

  it('a splash kill by a shooter who holed the hull a moment earlier is a blast, never "penetrated through the rear"', () => {
    const tr = new KillCauseTracker(world);
    tr.observe(impact(10, 1, 9, 'spike_atgm', 'rear'));
    const c = tr.observe(dead(14, 9, 1, 'splash', 'spike_atgm')) as KillCause;
    expect(c).toEqual({ kind: 'splash', attacker: 'c_at', weapon: 'spike_atgm', suppressed: false });
    expect(causeText(c, name)).toBe('Caught in a blast from AT team (Spike anti-tank missile).');
  });

  it('a direct kill whose round left no candidate still names the weapon the event carries', () => {
    expect(new KillCauseTracker(world).observe(dead(14, 9, 2, 'direct', 'rifles'))).toEqual({ kind: 'gun', attacker: 'c_inf', weapon: 'rifles', suppressed: false });
  });

  it('each other cause is its own kind, whatever candidates the victim had, and keeps the pinned flag', () => {
    for (const kind of ['strike', 'bleed', 'collapse', 'carrier', 'other', 'spent'] as const) {
      const tr = new KillCauseTracker(world);
      tr.observe(impact(10, 2, 9, 'rifles', 'side'));
      tr.observe({ kind: 'pinned', tick: 11, entity: 9 });
      expect(tr.observe(dead(14, 9, 2, kind)), kind).toEqual({ kind, attacker: 'c_inf', suppressed: true });
    }
  });
});

describe('the words for each cause (literals)', () => {
  const by = (kind: KillCause['kind'], extra: Partial<KillCause> = {}): KillCause => ({ kind, attacker: 'c_inf', suppressed: false, ...extra });
  const anon = (kind: KillCause['kind']): KillCause => ({ kind, suppressed: false });
  it('names who when the event credited someone', () => {
    expect(causeText(by('splash', { weapon: 'rifles' }), name)).toBe('Caught in a blast from Rifle squad (Rifles).');
    expect(causeText(by('splash'), name)).toBe('Caught in a blast from Rifle squad.');
    expect(causeText(by('strike'), name)).toBe('Caught in a strike called in by Rifle squad.');
    expect(causeText(by('bleed'), name)).toBe('Bled out from wounds dealt by Rifle squad.');
    expect(causeText(by('collapse'), name)).toBe('Killed in a collapse brought down by Rifle squad.');
    expect(causeText(by('carrier'), name)).toBe('Went down with its carrier, destroyed by Rifle squad.');
  });
  it('and never invents one when nobody was', () => {
    expect(causeText(anon('splash'), name)).toBe('Caught in a blast.');
    expect(causeText(anon('strike'), name)).toBe('Caught in a strike.');
    expect(causeText(anon('bleed'), name)).toBe('Bled out from wounds.');
    expect(causeText(anon('collapse'), name)).toBe('Killed in a collapse.');
    expect(causeText(anon('carrier'), name)).toBe('Went down with its carrier.');
    expect(causeText({ ...anon('bleed'), suppressed: true }, name)).toBe('Bled out from wounds. It was pinned down.');
  });
});

describe('causeSummary: several nameless losses of one type (the debrief)', () => {
  const other: KillCause = { kind: 'other', attacker: 'c_inf', suppressed: false };
  const shot: KillCause = { kind: 'gun', attacker: 'c_at', weapon: 'spike_atgm', suppressed: false };
  const blast: KillCause = { kind: 'splash', suppressed: false };
  const fell: KillCause = { kind: 'collapse', suppressed: false };
  it('counts each distinct line, the commonest first', () => {
    expect(causeSummary([shot, other, other], name)).toBe('2× Destroyed by Rifle squad. 1× Shot by AT team (Spike anti-tank missile).');
  });
  it('equal counts keep the order they fell in', () => {
    expect(causeSummary([shot, other], name)).toBe('1× Shot by AT team (Spike anti-tank missile). 1× Destroyed by Rifle squad.');
    expect(causeSummary([other, shot], name)).toBe('1× Destroyed by Rifle squad. 1× Shot by AT team (Spike anti-tank missile).');
  });
  it('shows two lines at most, then how many fell some other way', () => {
    expect(CAUSE_SUMMARY_MAX).toBe(2);
    expect(causeSummary([blast, blast, fell, shot, other], name)).toBe('2× Caught in a blast. 1× Killed in a collapse. 2 more to other causes.');
    expect(causeSummary([blast, blast, fell, shot], name)).toBe('2× Caught in a blast. 1× Killed in a collapse. 1 more to another cause.');
  });
  it('a loss with no stored cause counts as not recorded; an empty list has no line', () => {
    expect(causeSummary([undefined, other, undefined], name)).toBe('2× Cause not recorded. 1× Destroyed by Rifle squad.');
    expect(causeSummary([], name)).toBeUndefined();
  });
  it('all one cause is one line with its count', () => {
    expect(causeSummary([blast, blast, blast], name)).toBe('3× Caught in a blast.');
  });
});

describe('parseKillCause (a save is untrusted)', () => {
  const ok = { kind: 'gun', attacker: 'c_at', weapon: 'spike_atgm', arc: 'rear', penetrated: true, suppressed: false };

  it('round-trips what the tracker produces', () => {
    expect(parseKillCause(ok)).toEqual(ok);
    expect(parseKillCause({ kind: 'spent', suppressed: true })).toEqual({ kind: 'spent', suppressed: true });
    for (const kind of ['splash', 'strike', 'bleed', 'collapse', 'carrier']) expect(parseKillCause({ kind, suppressed: false }), kind).toEqual({ kind, suppressed: false });
  });

  it('refuses every wrong shape, each by itself', () => {
    for (const bad of [null, 'gun', 3, [], { ...ok, kind: 'laser' }, { ...ok, suppressed: 'no' }, { ...ok, arc: 'top' }, { ...ok, attacker: 5 }, { ...ok, weapon: {} }, { ...ok, penetrated: 'yes' }]) {
      expect(parseKillCause(bad)).toBeUndefined();
    }
  });

  it('drops keys it does not know instead of carrying them', () => {
    expect(parseKillCause({ ...ok, evil: '<img>' })).toEqual(ok);
  });
});

describe('the wiring in main.ts (a guard, not a behavioural test: the battlefield cannot be booted here)', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
  it('feeds every sim event to the tracker, hands the cause to the log and to the memorial record, and reads a stored cause only through the parser', () => {
    expect(main).toContain('killCauses.observe(e)');
    expect(main).toContain('causeOf: (id) => causeOfLost.get(id),');
    expect(main).toContain('mev.tick, causeOfLost.get(mev.entity))');
    expect(main).toContain('parseKillCause(record.cause)');
  });
});
