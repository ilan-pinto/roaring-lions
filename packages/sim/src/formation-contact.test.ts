// GH-859 P1b Task 4: contact and the drills. A member that is fired on by the enemy, or fires, or springs, reports
// the contact point to its group (`fmPend`); the drill runs on the next tick (`stepFormationContact`): `halt` stops
// the whole group and drops its queue, `press` ends the dress and keeps marching and fighting, `spring` opens the
// ring and ends the dress. The quiet clock (`fgQuiet`) restarts at every contact. A hostile hit more than
// `call_radius_tiles` from the member it hit does not raise the call bit. Every world is hand-built and every
// expectation is a literal (casebook: "the oracle imported its arguments"); a table of cases asserts its own length.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import type { FormationJson } from './formation-template';
import { RIFLES, TANK } from './golden-worlds.test-helper';
import { BRACE_DROPPING, BRACE_KNEELING, Sim, type SimEvent, type UnitTypeJson } from './sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loadFormation = (id: string): FormationJson => JSON.parse(readFileSync(join(ROOT, 'data', 'formations', `${id}.json`), 'utf8')) as FormationJson;

// ---- unit types (all test-local) ----------------------------------------------------------
/** An unarmed light vehicle: it can be hit and cannot fire, so a contact on a Column of jeeps and riflemen is a hit. */
const JEEP: UnitTypeJson = {
  id: 'fm4_jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};
/** An armed vehicle: it fires on the move (sight 12, range 12). */
const MBT: UnitTypeJson = { ...TANK, id: 'fm4_mbt', role: 'mbt', mobility: { speed_tiles_s: 1.1, turn_rate_deg_s: 60 } };
const AIR: UnitTypeJson = {
  id: 'fm4_air',
  hull: { hp: 100, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { domain: 'air', speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  weapons: [],
};
/** An unarmed enemy: something to fire at, and it fires at nobody. */
const DUMMY: UnitTypeJson = { ...RIFLES, id: 'fm4_dummy', weapons: [], abilities: [], hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } } };
/** An enemy rifleman who sees and shoots to 10-11 tiles: it hits a marching rifleman (sight 8) before he can see it. */
const POST: UnitTypeJson = {
  ...RIFLES,
  id: 'fm4_post',
  sensors: { optics: 1.0, sight_tiles: 11, signature: 0.6 },
  weapons: [{ ...RIFLES.weapons?.[0], range_tiles: 10 } as never],
};
/** An enemy marksman: it sees and hits at 15 tiles and more. */
const SNIPER: UnitTypeJson = {
  ...RIFLES,
  id: 'fm4_sniper',
  sensors: { optics: 6.0, sight_tiles: 30, signature: 0.6 },
  weapons: [{ ...RIFLES.weapons?.[0], range_tiles: 18 } as never],
};
/** An enemy rifleman who dies to two rounds, so a pressing Attack can clear it and go on. */
const WEAK: UnitTypeJson = { ...RIFLES, id: 'fm4_weak', hull: { hp: 60, armor: { front: 10, side: 10, rear: 10 } } };
/** An enemy with a beam: it dwells on an aircraft and never reaches `fireAt`. */
const BEAM_CARRIER: UnitTypeJson = {
  id: 'fm4_carrier',
  role: 'aa',
  hull: { hp: 1100, armor: { front: 40, side: 25, rear: 20 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1.4, sight_tiles: 12, signature: 0.9 },
  weapons: [
    {
      id: 'beam', type: 'directed_energy', range_tiles: 9, accuracy: 1, penetration: 5, damage: 80,
      rof_per_min: 40, can_target: ['air'], collateral_risk: 0,
      beam: { dwell_s: 1.5, heat_s: 12, cooldown_s: 6 },
    } as never,
  ],
};
/** A soft aircraft the beam can dwell on. */
const DRONE: UnitTypeJson = {
  id: 'fm4_drone',
  role: 'drone',
  hull: { hp: 5000, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1.0, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 6, signature: 1.0 },
};

// ---- test-local formation files -----------------------------------------------------------
/** The shipped Attack with the longest dress the schema allows, so a test has time to act on a waiting member. */
const ATTACK_DRESS10: FormationJson = { ...loadFormation('attack'), id: 'attack_dress10', march: { legs: true, leg_tiles: 8, pace: 'slowest_ground', dress_s: 10 } };
/** The shipped Column with a ten-second dress. */
const COLUMN_DRESS10: FormationJson = { ...loadFormation('column'), id: 'column_dress10', march: { legs: true, leg_tiles: 8, pace: 'slowest_ground', dress_s: 10 } };
/** The shipped Ambush with checkpoints and a ten-second dress: a ring that marches in legs. */
const AMBUSH_LEGS: FormationJson = { ...loadFormation('ambush'), id: 'ambush_legs', march: { legs: true, leg_tiles: 8, pace: 'slowest_ground', dress_s: 10 } };

interface World {
  sim: Sim;
  jeep: number;
  mbt: number;
  inf: number;
  air: number;
  dummy: number;
  post: number;
  sniper: number;
  weak: number;
  events: SimEvent[];
}
function world(): World {
  const sim = new Sim({ seed: 0x8594, width: 48, height: 48, capacity: 64 });
  const w: World = {
    sim,
    jeep: sim.addUnitType(JEEP),
    mbt: sim.addUnitType(MBT),
    inf: sim.addUnitType(RIFLES),
    air: sim.addUnitType(AIR),
    dummy: sim.addUnitType(DUMMY),
    post: sim.addUnitType(POST),
    sniper: sim.addUnitType(SNIPER),
    weak: sim.addUnitType(WEAK),
    events: [],
  };
  for (const id of ['column', 'attack', 'ambush']) sim.addFormationType(loadFormation(id));
  for (const f of [ATTACK_DRESS10, COLUMN_DRESS10, AMBUSH_LEGS]) sim.addFormationType(f);
  return w;
}
const at = (n: number): number => fx.from(n + 0.5);
const spawnAt = (w: World, type: number, side: number, x: number, y: number): number => w.sim.spawn(type, side, at(x), at(y), 0);
function tick(w: World, n = 1): void {
  for (let i = 0; i < n; i++) for (const e of w.sim.tick()) w.events.push(e);
}
const kinds = (w: World, kind: string): SimEvent[] => w.events.filter((e) => e.kind === kind);
const order = (w: World, ids: number[], formation: string, to: [number, number], kind: 'move' | 'attackMove' = 'move'): void => {
  w.sim.queueCommand({ kind, ids, x: at(to[0]), y: at(to[1]), formation } as never);
};

interface Priv {
  posX: Int32Array;
  posY: Int32Array;
  moving: Uint8Array;
  wpCount: Uint8Array;
  goalX: Int32Array;
  goalY: Int32Array;
  wpX: Int32Array;
  wpY: Int32Array;
  facing: Uint16Array;
  restFacing: Uint16Array;
  fmDuty: Uint8Array;
  fgState: Uint8Array;
  fgPending: Uint8Array;
  fgQuiet: Uint16Array;
  fgDress: Uint16Array;
  fgAtCp: Uint16Array;
  fgAway: Uint16Array;
  fgMembers: Uint16Array;
  fgRelease: Uint8Array;
  fgLegs: Uint8Array;
  fgCallX: Int32Array;
  fgCallY: Int32Array;
  fgLive: Uint8Array;
}
const priv = (sim: Sim): Priv => sim as unknown as Priv;
const tileOf = (v: number): number => v >> 16;
const FM_CONTACT = 3;
const FM_SPRUNG = 4;

/** A Column of two jeeps and four riflemen, stacked at (24, 44) and ordered up the open map to (24, 14). */
function column(w: World, types: number[], formation = 'column', from: [number, number] = [24, 44], to: [number, number] = [24, 14]): number[] {
  const ids = types.map((t) => spawnAt(w, t, 0, from[0], from[1]));
  order(w, ids, formation, to);
  return ids;
}
/** Tick until the first `formationContact` has been pushed; returns the tick it was pushed on. */
function untilContact(w: World, limit = 600): number {
  for (let t = 0; t < limit; t++) {
    tick(w);
    if (kinds(w, 'formationContact').length > 0) return w.sim.tickCount - 1;
  }
  throw new Error('no contact');
}
/** The sum over the row's counters that must never exceed its members (the dress invariant). */
const counted = (w: World, g: number): boolean => priv(w.sim).fgAtCp[g] + priv(w.sim).fgAway[g] <= priv(w.sim).fgMembers[g];

// ---------------------------------------------------------------------------------------------
describe('halt: a Column hit on the march stops, whole', () => {
  /** Two jeeps and four riflemen; an enemy post 9-10 tiles east of the lane at (33, 30). */
  function hit(): { w: World; ids: number[]; at: number; post: number } {
    const w = world();
    const ids = column(w, [w.jeep, w.jeep, w.inf, w.inf, w.inf, w.inf]);
    const post = spawnAt(w, w.post, 1, 33, 30);
    const t = untilContact(w);
    return { w, ids, at: t, post };
  }
  it('names the first member hit and the point the fire came from, once', () => {
    const { w, ids, at: t } = hit();
    // The post (33.5, 30.5) shoots the lead jeep from 9.8 tiles, before the riflemen (sight 8) can see it.
    expect(kinds(w, 'formationContact')).toEqual([
      { kind: 'formationContact', tick: 235, side: 0, group: 0, entity: ids[0], x: 2195456, y: 1998848, drill: 1 },
    ]);
    expect(t).toBe(235);
    tick(w, 300);
    expect(kinds(w, 'formationContact')).toHaveLength(1); // once in a group's life
  });
  it('the tick after the first hostile hit, every ground member is stopped with an empty queue, in state 3', () => {
    const { w, ids } = hit();
    const p = priv(w.sim);
    // the tick of the hit: the mark is set, nothing acted on yet; the call bit is set too (the post is 9.8 tiles from the jeep it hit)
    expect([p.fgState[0], p.fgPending[0]]).toEqual([1, 3]);
    expect(ids.map((id) => p.moving[id])).toEqual([1, 1, 1, 1, 1, 1]);
    expect(ids.map((id) => p.wpCount[id])).toEqual([2, 2, 2, 2, 2, 2]);
    tick(w);
    expect([p.fgState[0], p.fgPending[0]]).toEqual([FM_CONTACT, 0]);
    expect(ids.map((id) => p.moving[id])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(ids.map((id) => p.wpCount[id])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect(w.sim.formationMembersOfGroup(0)).toBe(6); // a halt takes nobody out of the group
  });
  it('the vehicles rest facing is the eighth toward the post; the riflemen keep the way they marched', () => {
    const { w, ids } = hit();
    tick(w);
    // jeep 0 at (24.5, 33.9), post (33.5, 30.5): 9 east and 3.4 north, east by more than 2:1 -> 0.
    // jeep 1 at (26.5, 34.7): 7 east and 4.2 north, under 2:1 -> the north-east diagonal 57344.
    // riflemen: the Column's travel facing, north, 49152.
    expect(ids.map((id) => priv(w.sim).restFacing[id])).toEqual([0, 57344, 49152, 49152, 49152, 49152]);
    tick(w, 60);
    // the hulls swung to it: a halted Column rest-faces by CONTACT, not by having reached its final checkpoint
    expect([priv(w.sim).facing[ids[0]], priv(w.sim).facing[ids[1]]]).toEqual([0, 57344]);
  });
  it('infantry brace to fire', () => {
    const { w, ids } = hit();
    const seen = new Set<number>();
    for (let t = 0; t < 80; t++) {
      tick(w);
      for (const id of ids.slice(2)) seen.add(w.sim.state.brace[id]);
    }
    expect(seen.has(BRACE_DROPPING)).toBe(true);
    expect(seen.has(BRACE_KNEELING)).toBe(true);
  });
  it('the march does not resume: 30 seconds on, nobody has moved and the state is still 3 (D9)', () => {
    const { w, ids, post } = hit();
    tick(w);
    // the post is silenced, so no rout or push moves anyone: only the Column's own orders could
    w.sim.debugKill(post);
    const p = priv(w.sim);
    const posAt = (): number[] => ids.flatMap((id) => [p.posX[id], p.posY[id]]);
    const stopped = posAt();
    tick(w, 600);
    expect(posAt()).toEqual(stopped);
    expect(ids.map((id) => p.moving[id])).toEqual([0, 0, 0, 0, 0, 0]);
    expect([p.fgState[0], p.fgRelease[0]]).toEqual([FM_CONTACT, 1]); // checkpoint 1 was released at tick 148; nothing after
    expect(kinds(w, 'formationReleased').filter((e) => (e as { tick: number }).tick > 236)).toHaveLength(0);
  });
});

describe('halt: contact by firing first', () => {
  it('a tank that opens fire on the move reports contact at its target, and the Column halts', () => {
    const w = world();
    const ids = column(w, [w.mbt, w.jeep, w.inf, w.inf, w.inf, w.inf]);
    const dummy = spawnAt(w, w.dummy, 1, 33, 30);
    expect(untilContact(w)).toBe(293);
    // nothing fired on the Column: the dummy is unarmed. The tank (24.5, 31.3) fired at 9 tiles, and the point is the dummy's.
    expect(kinds(w, 'formationContact')).toEqual([
      { kind: 'formationContact', tick: 293, side: 0, group: 0, entity: ids[0], x: 2195456, y: 1998848, drill: 1 },
    ]);
    expect([w.sim.state.posX[dummy], w.sim.state.posY[dummy]]).toEqual([2195456, 1998848]);
    expect(kinds(w, 'fire').every((e) => (e as { shooter: number }).shooter === ids[0])).toBe(true);
    tick(w);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect(ids.map((id) => priv(w.sim).wpCount[id])).toEqual([0, 0, 0, 0, 0, 0]);
    // the jeep (24.5, 31.5) faces the dummy, 9 east and 1 north: east
    expect(priv(w.sim).restFacing[ids[1]]).toBe(0);
  });
  it('a beam on the move is a firing signature too', () => {
    const w = world();
    const carrier = w.sim.addUnitType(BEAM_CARRIER);
    const drone = w.sim.addUnitType(DRONE);
    const ids = [carrier, w.jeep, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 44));
    order(w, ids, 'column', [24, 14]);
    const target = spawnAt(w, drone, 1, 30, 32);
    let first = -1;
    for (let t = 0; t < 600 && first < 0; t++) {
      tick(w);
      if (w.sim.beamState(ids[0]).target >= 0) first = w.sim.tickCount - 1;
    }
    expect(first, 'the beam dwelt on the drone').toBeGreaterThan(0);
    const ev = kinds(w, 'formationContact');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ entity: ids[0], tick: first, x: w.sim.state.posX[target], y: w.sim.state.posY[target], drill: 1 });
    expect(kinds(w, 'fire')).toHaveLength(0); // the beam never reaches fireAt
  });
});

describe('halt: nobody keeps a stale wait', () => {
  it('a Column hit while members dress stops them and clears the dress', () => {
    const w = world();
    const ids = column(w, [w.jeep, w.jeep, w.inf, w.inf, w.inf, w.inf], 'column_dress10');
    const p = priv(w.sim);
    let waiting = 0;
    for (let t = 0; t < 400 && waiting === 0; t++) {
      tick(w);
      waiting = p.fgAtCp[0];
    }
    tick(w); // the dress clock counts from the tick after the first arrival
    expect(waiting).toBeGreaterThan(0);
    const waiters = ids.filter((id) => p.fmDuty[id] === 1);
    expect(waiters.length).toBeGreaterThan(0);
    expect(p.fgDress[0]).toBeGreaterThan(0);
    // an enemy post appears in range of the lane and hits somebody
    spawnAt(w, w.post, 1, 31, w.sim.state.posY[ids[0]] >> 16);
    untilContact(w);
    expect(counted(w, 0)).toBe(true);
    tick(w);
    expect(p.fgState[0]).toBe(FM_CONTACT);
    expect(ids.map((id) => p.fmDuty[id])).toEqual([0, 0, 0, 0, 0, 0]);
    expect([p.fgAtCp[0], p.fgDress[0]]).toEqual([0, 0]);
    expect(ids.map((id) => [p.moving[id], p.wpCount[id]])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
  });
});

describe('halt: the aircraft that will not be called halt too', () => {
  /** A Column of two jeeps, four riflemen and an aircraft; the shooter is spawned by the caller. */
  function withAir(w: World): number[] {
    return column(w, [w.jeep, w.jeep, w.inf, w.inf, w.inf, w.inf, w.air], 'column', [24, 30], [24, 10]);
  }
  it('a hit within the call radius leaves the aircraft on its way for the call; a hit beyond it halts it', () => {
    const near = world();
    const nearIds = withAir(near);
    spawnAt(near, near.post, 1, 33, 20);
    untilContact(near);
    tick(near);
    // the call bit was set, so the aircraft answers (Task 5 sorties it): it is not halted by the drill
    expect(priv(near.sim).moving[nearIds[6]]).toBe(1);
    expect(priv(near.sim).wpCount[nearIds[6]]).toBeGreaterThan(0);

    const far = world();
    const farIds = withAir(far);
    spawnAt(far, far.sniper, 1, 24, 44);
    untilContact(far);
    tick(far);
    expect(priv(far.sim).fgState[0]).toBe(FM_CONTACT);
    expect(priv(far.sim).moving[farIds[6]]).toBe(0);
    expect(priv(far.sim).wpCount[farIds[6]]).toBe(0);
    expect(farIds.slice(0, 6).map((id) => priv(far.sim).moving[id])).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('press: an Attack reaching a post goes on fighting', () => {
  /** Two tanks, three riflemen and an aircraft attack-move up the map; a weak enemy rifleman appears near the first
   *  checkpoint while members dress there. */
  function met(): { w: World; ids: number[]; finals: [number, number][]; post: number } {
    const w = world();
    const ids = [w.mbt, w.mbt, w.inf, w.inf, w.inf, w.air].map((t) => spawnAt(w, t, 0, 24, 30));
    order(w, ids, 'attack_dress10', [24, 4], 'attackMove');
    const p = priv(w.sim);
    for (let t = 0; t < 300 && p.fgAtCp[0] === 0; t++) tick(w);
    expect(p.fgAtCp[0]).toBeGreaterThan(0);
    const finals = ids.map((id): [number, number] => {
      const q = p.wpCount[id];
      return q > 0 ? [tileOf(p.wpX[id * 8 + q - 1]), tileOf(p.wpY[id * 8 + q - 1])] : [tileOf(p.goalX[id]), tileOf(p.goalY[id])];
    });
    const post = spawnAt(w, w.weak, 1, 31, 19);
    return { w, ids, finals, post };
  }
  it('state 3, one formationContact, nobody waits afterwards, the pace and the queues stay', () => {
    const { w, ids, post } = met();
    const p = priv(w.sim);
    const pace = w.sim.formationPaceOfGroup(0);
    expect(pace).toBe(2949);
    expect(ids.some((id) => p.fmDuty[id] === 1)).toBe(true);
    const queued = ids.map((id) => p.wpCount[id]);
    const t = untilContact(w);
    expect(kinds(w, 'formationContact')).toEqual([
      { kind: 'formationContact', tick: t, side: 0, group: 0, entity: ids[0], x: w.sim.state.posX[post], y: w.sim.state.posY[post], drill: 2 },
    ]);
    expect(t).toBe(139);
    expect([w.sim.state.posX[post], w.sim.state.posY[post]]).toEqual([2064384, 1277952]);
    expect(counted(w, 0)).toBe(true);
    tick(w);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect(ids.map((id) => p.fmDuty[id])).toEqual([0, 0, 0, 0, 0, 0]);
    expect([p.fgAtCp[0], p.fgDress[0], p.fgRelease[0], p.fgLegs[0]]).toEqual([0, 0, 3, 4]);
    expect(w.sim.formationPaceOfGroup(0)).toBe(pace);
    expect(queued.some((q) => q > 0)).toBe(true);
    expect(ids.map((id) => p.moving[id])).toEqual([1, 1, 1, 1, 1, 1]); // no one is halted by a press
    tick(w, 200);
    expect(kinds(w, 'formationContact')).toHaveLength(1);
  });
  it('every member goes on to its final slot once the post is cleared', () => {
    const { w, ids, finals, post } = met();
    const p = priv(w.sim);
    expect(finals).toEqual([[24, 4], [26, 4], [24, 6], [25, 6], [23, 6], [24, 17]]);
    for (let t = 0; t < 1200 && !(w.sim.state.alive[post] === 0 && ids.every((id) => p.moving[id] === 0)); t++) tick(w);
    expect(w.sim.state.alive[post]).toBe(0);
    expect(ids.map((id) => p.moving[id])).toEqual([0, 0, 0, 0, 0, 0]);
    // each stands on its slot, or on the tile its neighbour left it when the slot was taken
    expect(ids.map((id): [number, number] => [tileOf(p.posX[id]), tileOf(p.posY[id])])).toEqual(finals);
  });
  it('the call radius is measured from the member that reported, not from the aircraft that would answer', () => {
    const { w, ids } = met();
    const p = priv(w.sim);
    // the aircraft stands 13 tiles behind the lead rank: ~17.5 tiles from the post at (31.5, 19.5), over the radius (12);
    // the tank that fired is 8.4 tiles from it
    expect([tileOf(p.posX[ids[5]]), tileOf(p.posY[ids[5]])]).toEqual([24, 35]);
    untilContact(w);
    expect(p.fgPending[0]).toBe(3); // drill and call
    expect([p.fgCallX[0], p.fgCallY[0]]).toEqual([2064384, 1277952]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('spring: a ring found while marching ends its dress', () => {
  it('the ring springs, the last checkpoint is released and nobody keeps waiting', () => {
    const w = world();
    const ids = [w.inf, w.inf, w.inf, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 40));
    order(w, ids, 'ambush_legs', [24, 12]);
    const p = priv(w.sim);
    for (let t = 0; t < 400 && p.fgAtCp[0] === 0; t++) tick(w);
    expect(p.fgAtCp[0]).toBeGreaterThan(0);
    expect(p.fgLegs[0]).toBeGreaterThan(2);
    const foe = spawnAt(w, w.dummy, 1, 44, 44);
    const h = ids[2];
    w.sim.debugSplash(w.sim.state.posX[h], w.sim.state.posY[h], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    expect(p.fgPending[0]).toBe(1); // marked by the hit; the foe is 18 tiles off, out of call reach, so the drill bit alone (P1a's value)
    tick(w); // the springing runs at the top of the next tick
    expect(kinds(w, 'formationSprung')).toHaveLength(1);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_SPRUNG);
    expect(ids.map((id) => p.fmDuty[id])).toEqual([0, 0, 0, 0, 0]);
    expect([p.fgAtCp[0], p.fgDress[0], p.fgRelease[0]]).toEqual([0, 0, p.fgLegs[0] - 1]);
    expect(counted(w, 0)).toBe(true);
    // the quiet clock counts for a sprung group too: 1 on the tick the drill ran, 11 ten ticks on
    expect(p.fgQuiet[0]).toBe(1);
    tick(w, 10);
    expect(p.fgQuiet[0]).toBe(11);
  });
});

// ---------------------------------------------------------------------------------------------
describe('friendly fire is not contact', () => {
  it('a friendly splash on a Column member marks nothing; a hostile one marks the drill and the call', () => {
    const friendly = world();
    const fIds = column(friendly, [friendly.jeep, friendly.jeep, friendly.inf, friendly.inf, friendly.inf, friendly.inf]);
    tick(friendly, 20);
    const mate = spawnAt(friendly, friendly.inf, 0, 5, 5);
    const m = fIds[3];
    friendly.sim.debugSplash(friendly.sim.state.posX[m], friendly.sim.state.posY[m], fx.fromInt(1), 0, fx.from(0.2), mate, -1);
    tick(friendly, 6);
    expect(priv(friendly.sim).fgPending[0]).toBe(0);
    expect(friendly.sim.formationStateOfGroup(0)).toBe(1);
    expect(kinds(friendly, 'formationContact')).toHaveLength(0);
    expect(fIds.map((id) => priv(friendly.sim).moving[id])).toEqual([1, 1, 1, 1, 1, 1]);

    const hostile = world();
    const hIds = column(hostile, [hostile.jeep, hostile.jeep, hostile.inf, hostile.inf, hostile.inf, hostile.inf]);
    tick(hostile, 20);
    const foe = spawnAt(hostile, hostile.inf, 1, 33, 36);
    const h = hIds[3];
    hostile.sim.debugSplash(hostile.sim.state.posX[h], hostile.sim.state.posY[h], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    expect(priv(hostile.sim).fgPending[0]).toBe(3);
    tick(hostile);
    expect(hostile.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect(kinds(hostile, 'formationContact')).toHaveLength(1);
    // the splash covers the stacked members; the lowest id is the first writer
    expect(kinds(hostile, 'formationContact')[0]).toMatchObject({ side: 0, group: 0, entity: hIds[0], drill: 1, x: 2195456, y: 2392064 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('the quiet clock', () => {
  it('counts the ticks since the last contact for a group in contact, and a later hit restarts it', () => {
    const w = world();
    const ids = column(w, [w.jeep, w.jeep, w.inf, w.inf, w.inf, w.inf]);
    const post = spawnAt(w, w.post, 1, 33, 30);
    const p = priv(w.sim);
    untilContact(w);
    expect(p.fgQuiet[0]).toBe(0); // the contact itself restarted it
    tick(w);
    expect(p.fgQuiet[0]).toBeGreaterThan(0);
    // silence the post: the clock now counts ticks
    w.sim.debugKill(post);
    const at0 = p.fgQuiet[0];
    tick(w, 40);
    expect(p.fgQuiet[0]).toBe(at0 + 40);
    // a later hostile hit while in CONTACT restarts it, exactly
    const foe = spawnAt(w, w.inf, 1, 33, 36);
    const m = ids[3];
    w.sim.debugSplash(w.sim.state.posX[m], w.sim.state.posY[m], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    expect(p.fgQuiet[0]).toBe(0);
    // in contact with no sortie out, a hit within reach asks for a call at the new point (Task 5 answers it)
    expect([p.fgPending[0], p.fgCallX[0], p.fgCallY[0]]).toEqual([2, 2195456, 2392064]);
    tick(w);
    expect(p.fgPending[0]).toBe(0);
    expect(p.fgQuiet[0]).toBe(1);
    expect(p.fgState[0]).toBe(FM_CONTACT);
    tick(w, 9);
    expect(p.fgQuiet[0]).toBe(10);
    expect(kinds(w, 'formationContact')).toHaveLength(1); // a later hit is not a second contact event
  });
  it('a marching group does not count it', () => {
    const w = world();
    column(w, [w.jeep, w.inf]);
    tick(w, 30);
    expect(priv(w.sim).fgQuiet[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('reach: the call needs the contact within call_radius_tiles of the member that reported it', () => {
  it('a marksman hitting the Column from 15 tiles marks the drill and leaves the call bit clear', () => {
    const w = world();
    const ids = column(w, [w.jeep, w.jeep, w.inf, w.inf, w.inf, w.inf, w.air], 'column', [24, 30], [24, 10]);
    spawnAt(w, w.sniper, 1, 24, 44);
    untilContact(w);
    const p = priv(w.sim);
    expect(kinds(w, 'formationContact')).toEqual([
      { kind: 'formationContact', tick: 35, side: 0, group: 0, entity: ids[1], x: 1605632, y: 2916352, drill: 1 },
    ]);
    // jeep 1 stands at (25.6, 29.4), the marksman at (24.5, 44.5): 15.1 tiles, over the radius (12)
    expect(p.fgPending[0]).toBe(1);
    tick(w);
    expect([p.fgState[0], p.fgPending[0]]).toEqual([FM_CONTACT, 0]);
  });
  it('a hit inside the radius sets both bits (the control that the bit can be set)', () => {
    const w = world();
    column(w, [w.jeep, w.jeep, w.inf, w.inf, w.inf, w.inf, w.air], 'column', [24, 30], [24, 10]);
    spawnAt(w, w.post, 1, 33, 20);
    untilContact(w);
    expect(priv(w.sim).fgPending[0]).toBe(3);
  });
});
