// GH-859 P1b Task 5: the calls. After a contact, a group's aircraft fly out on a sortie to the call point (a `strike` helicopter as
// an attack-move, a `spot` drone as a move), keep their queue and stop where they are sent; ten quiet seconds after the last
// contact (`quiet_s`) they come home, as moves, and rejoin the march. A man going down in the group is answered by the nearest
// free foot medic, within `call_radius_tiles` of him, who keeps his queue too and goes home when he has delivered. Every world
// is hand-built and every expectation a literal (casebook: "the oracle imported its arguments"); a table of cases asserts its
// own length. Positions are tile centres, `Fx` values in the comments are raw Q16.16 (24.5 tiles = 1605632).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import type { FormationJson } from './formation-template';
import { RIFLES, TANK } from './golden-worlds.test-helper';
import { Sim, SIM_EVENT_KINDS, type SimEvent, type UnitTypeJson } from './sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loadFormation = (id: string): FormationJson => JSON.parse(readFileSync(join(ROOT, 'data', 'formations', `${id}.json`), 'utf8')) as FormationJson;

// ---- unit types (all test-local) ----------------------------------------------------------
const GUN = RIFLES.weapons?.[0] as never;
const MBT: UnitTypeJson = { ...TANK, id: 'fm5_mbt', role: 'mbt', mobility: { speed_tiles_s: 1.1, turn_rate_deg_s: 60 } };
/** A gunship: an air type with a weapon that can hit ground (no `can_target` means ground), no seats: a `strike`. */
const HELI: UnitTypeJson = {
  id: 'fm5_heli',
  hull: { hp: 400, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { domain: 'air', speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  weapons: [GUN],
};
/** An unarmed drone: a `spot`. */
const DRONE: UnitTypeJson = {
  id: 'fm5_drone',
  hull: { hp: 100, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { domain: 'air', speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  weapons: [],
};
/** A helicopter with seats: it never sorties (`stay`). */
const SEATED: UnitTypeJson = { ...HELI, id: 'fm5_seated', hull: { hp: 400, armor: { front: 5, side: 5, rear: 5 }, transport_slots: 2 } };
/** A loitering munition: spent by diving, so it never sorties (`stay`). */
const KAMIKAZE: UnitTypeJson = { ...DRONE, id: 'fm5_kamikaze', abilities: ['kamikaze'] };
/** An enemy rifleman who dies to two rounds: a tank clears him and the Attack goes on. */
const WEAK: UnitTypeJson = { ...RIFLES, id: 'fm5_weak', hull: { hp: 60, armor: { front: 10, side: 10, rear: 10 } } };
/** A one-man squad: its fatal hit leaves a wounded whose parent is -1 (the squad's last man). */
const SOLO: UnitTypeJson = {
  ...RIFLES,
  id: 'fm5_solo',
  hull: { hp: 100, armor: { front: 10, side: 10, rear: 10 }, figures: 1, wounds: { wound_chance: 1, bleed_s: 60, type: 'fm5_wounded' } },
};
/** A four-man squad: 100 hp of damage drops one man. */
const SQUAD: UnitTypeJson = {
  ...RIFLES,
  id: 'fm5_squad',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4, wounds: { wound_chance: 1, bleed_s: 60, type: 'fm5_wounded' } },
};
const WOUNDED: UnitTypeJson = {
  id: 'fm5_wounded',
  role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};
const MEDIC: UnitTypeJson = {
  ...RIFLES,
  id: 'fm5_medic',
  abilities: ['rescue'],
  weapons: [],
  hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, figures: 2, transport_slots: 1, can_carry: ['wounded'] },
  rescue: { radius_tiles: 8, treat_s: 6, drag_speed_mult: 0.5, carry_speed_mult: 0.75 },
};
/** The casualty collection point: carries wounded, has no `rescue` block, so it never answers a call. */
const AMBULANCE: UnitTypeJson = {
  id: 'fm5_ambulance',
  role: 'apc',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 }, transport_slots: 4, can_carry: ['wounded'], stabilise_radius: 1.5 },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8 },
};

interface World {
  sim: Sim;
  mbt: number;
  inf: number;
  heli: number;
  drone: number;
  seated: number;
  kamikaze: number;
  weak: number;
  solo: number;
  squad: number;
  medic: number;
  ambulance: number;
  events: SimEvent[];
}
function world(): World {
  const sim = new Sim({ seed: 0x8595, width: 48, height: 48, capacity: 64 });
  const w: World = {
    sim,
    mbt: sim.addUnitType(MBT),
    inf: sim.addUnitType(RIFLES),
    heli: sim.addUnitType(HELI),
    drone: sim.addUnitType(DRONE),
    seated: sim.addUnitType(SEATED),
    kamikaze: sim.addUnitType(KAMIKAZE),
    weak: sim.addUnitType(WEAK),
    solo: sim.addUnitType(SOLO),
    squad: sim.addUnitType(SQUAD),
    medic: sim.addUnitType(MEDIC),
    ambulance: sim.addUnitType(AMBULANCE),
    events: [],
  };
  sim.addUnitType(WOUNDED);
  for (const id of ['column', 'attack', 'ambush']) sim.addFormationType(loadFormation(id));
  // The shipped Column with the longest dress the schema allows, so a test has time to act on a waiting member.
  sim.addFormationType({ ...loadFormation('column'), id: 'column_dress10', march: { legs: true, leg_tiles: 8, pace: 'slowest_ground', dress_s: 10 } });
  // The shipped Column with the shortest quiet the schema allows (2 s), so the aircraft come home while a medic is still at work.
  sim.addFormationType({ ...loadFormation('column'), id: 'column_quiet2', contact: { drill: 'halt', call_radius_tiles: 12, quiet_s: 2 } });
  return w;
}
const at = (n: number): number => fx.from(n + 0.5);
const spawnAt = (w: World, type: number, side: number, x: number, y: number): number => w.sim.spawn(type, side, at(x), at(y), 0);
function tick(w: World, n = 1): void {
  for (let i = 0; i < n; i++) for (const e of w.sim.tick()) w.events.push(e);
}
const kinds = (w: World, kind: string): SimEvent[] => w.events.filter((e) => e.kind === kind);
const calls = (w: World): { tick: number; entity: number; call: string }[] =>
  kinds(w, 'formationCall').map((e) => {
    const c = e as Extract<SimEvent, { kind: 'formationCall' }>;
    return { tick: c.tick, entity: c.entity, call: c.call };
  });

interface Priv {
  posX: Int32Array;
  posY: Int32Array;
  moving: Uint8Array;
  wpCount: Uint8Array;
  goalX: Int32Array;
  goalY: Int32Array;
  attackMove: Uint8Array;
  sweepOrder: Uint8Array;
  routed: Uint8Array;
  fmDuty: Uint8Array;
  fmLeg: Uint8Array;
  fmHomeX: Int32Array;
  fmHomeY: Int32Array;
  fgAway: Uint16Array;
  fgAtCp: Uint16Array;
  fgMembers: Uint16Array;
  fgCalled: Uint8Array;
  fgQuiet: Uint16Array;
  fgState: Uint8Array;
  fgPending: Uint8Array;
  fgLive: Uint8Array;
  fgDress: Uint16Array;
  fgCallX: Int32Array;
  fgCallY: Int32Array;
  medState: Uint8Array;
  medTarget: Int32Array;
  passengers: Uint8Array;
  woundParent: Int32Array;
  facing: Uint16Array;
  restFacing: Uint16Array;
}
const priv = (sim: Sim): Priv => sim as unknown as Priv;
const tileOf = (v: number): number => v >> 16;
const FM_CONTACT = 3;
const DUTY = { none: 0, wait: 1, out: 2, ret: 3 } as const;
/** The dress invariant: waiters and members away on a call never outnumber the group. */
const counted = (w: World, g: number): boolean => priv(w.sim).fgAtCp[g] + priv(w.sim).fgAway[g] <= priv(w.sim).fgMembers[g];

// ---------------------------------------------------------------------------------------------
// The Attack: two tanks and three riflemen with a strike helicopter, a spot drone, a seated helicopter and a loitering
// munition, all ordered from (24, 30) to (24, 4) as an attack-move. An enemy rifleman at (31, 19) is cleared by the lead
// tank at tick 128 (the press), which is the contact; the call is the next tick.
interface Attack {
  w: World;
  ids: number[];
  tank: number;
  heli: number;
  drone: number;
  seated: number;
  kamikaze: number;
  post: number;
}
function attack(): Attack {
  const w = world();
  const ids = [w.mbt, w.mbt, w.inf, w.inf, w.inf, w.heli, w.drone, w.seated, w.kamikaze].map((t) => spawnAt(w, t, 0, 24, 30));
  w.sim.queueCommand({ kind: 'attackMove', ids, x: at(24), y: at(4), formation: 'attack' } as never);
  const post = spawnAt(w, w.weak, 1, 31, 19);
  return { w, ids, tank: ids[0], heli: ids[5], drone: ids[6], seated: ids[7], kamikaze: ids[8], post };
}
/** Tick until the first `formationContact` is pushed (tick 128), leaving the world on that tick. */
function untilContact(w: World, limit = 600): number {
  for (let t = 0; t < limit; t++) {
    tick(w);
    if (kinds(w, 'formationContact').length > 0) return w.sim.tickCount - 1;
  }
  throw new Error('no contact');
}
/** The Attack on the tick after its contact: the call has run. Also returns the aircraft's goal and queue just before it. */
function called(): Attack & { before: { goal: [number, number]; wp: number; heliMoving: number } } {
  const a = attack();
  untilContact(a.w);
  const p = priv(a.w.sim);
  const before = { goal: [p.goalX[a.heli], p.goalY[a.heli]] as [number, number], wp: p.wpCount[a.heli], heliMoving: p.moving[a.heli] };
  tick(a.w);
  return { ...a, before };
}

describe('a strike helicopter and a spot drone answer the contact call', () => {
  it('the contact is the tank firing at the post at tick 128; the call comes the next tick (the world is the literal)', () => {
    const a = attack();
    const t = untilContact(a.w);
    expect(t).toBe(128);
    expect(kinds(a.w, 'formationContact')).toEqual([
      { kind: 'formationContact', tick: 128, side: 0, group: 0, entity: a.tank, x: 2064384, y: 1277952, drill: 2 },
    ]);
    expect(kinds(a.w, 'formationCall')).toHaveLength(0); // nothing has been sent yet: the call runs at the top of the next tick
    expect(priv(a.w.sim).fgPending[0]).toBe(3); // drill and call
  });
  it('the next tick: the helicopter flies to the call point as an attack-move, on duty OUT, queue intact, home its old goal', () => {
    const { w, heli, before } = called();
    const p = priv(w.sim);
    // the post stood at (31.5, 19.5): goal 2064384, 1277952, the tile centre; sweepOrder 0 so it holds there and fights
    expect([p.goalX[heli], p.goalY[heli]]).toEqual([2064384, 1277952]);
    expect([p.moving[heli], p.attackMove[heli], p.sweepOrder[heli]]).toEqual([1, 1, 0]);
    expect(p.fmDuty[heli]).toBe(DUTY.out);
    expect(w.sim.formationDutyOf(heli)).toBe(DUTY.out);
    // two checkpoints still queued behind the goal it was flying to: all kept
    expect([before.wp, p.wpCount[heli]]).toEqual([2, 2]);
    // its old goal, checkpoint 2's slot at (24.5, 27.5): 1605632, 1802240
    expect(before.goal).toEqual([1605632, 1802240]);
    expect([p.fmHomeX[heli], p.fmHomeY[heli]]).toEqual([1605632, 1802240]);
    expect(calls(w).filter((c) => c.entity === heli)).toEqual([{ tick: 129, entity: heli, call: 'strike' }]);
  });
  it('the drone gets the same as a move: attackMove 0', () => {
    const { w, drone } = called();
    const p = priv(w.sim);
    expect([p.goalX[drone], p.goalY[drone]]).toEqual([2064384, 1277952]);
    expect([p.moving[drone], p.attackMove[drone], p.sweepOrder[drone], p.fmDuty[drone], p.wpCount[drone]]).toEqual([1, 0, 0, DUTY.out, 2]);
    expect([p.fmHomeX[drone], p.fmHomeY[drone]]).toEqual([1736704, 1802240]); // (26.5, 27.5)
    expect(calls(w).filter((c) => c.entity === drone)).toEqual([{ tick: 129, entity: drone, call: 'spot' }]);
  });
  it('a seated helicopter and a loitering munition stay: no call, no duty, the goal they had', () => {
    const { w, seated, kamikaze, heli, drone } = called();
    const p = priv(w.sim);
    expect(calls(w)).toEqual([
      { tick: 129, entity: heli, call: 'strike' },
      { tick: 129, entity: drone, call: 'spot' },
    ]);
    expect([p.fmDuty[seated], p.fmDuty[kamikaze]]).toEqual([DUTY.none, DUTY.none]);
    // still bound for the slots the march gave them: (22.5, 27.5) and (24.5, 29.5)
    expect([p.goalX[seated], p.goalY[seated], p.goalX[kamikaze], p.goalY[kamikaze]]).toEqual([1474560, 1802240, 1605632, 1933312]);
    expect([p.attackMove[seated], p.attackMove[kamikaze]]).toEqual([1, 1]);
  });
  it('the row counts the two away: fgAway 2, fgCalled 1, state 3, nothing pending, and the ground members are untouched', () => {
    const { w, ids, tank } = called();
    const p = priv(w.sim);
    expect([p.fgAway[0], p.fgCalled[0], p.fgState[0], p.fgPending[0], p.fgAtCp[0], p.fgMembers[0]]).toEqual([2, 1, FM_CONTACT, 0, 0, 9]);
    expect(ids.map((id) => w.sim.formationDutyOf(id))).toEqual([0, 0, 0, 0, 0, 2, 2, 0, 0]);
    expect(p.moving[tank]).toBe(1);
    expect(w.sim.formationDutyOf(9999)).toBe(0); // out of range reads as no duty
    expect(w.sim.formationDutyOf(-1)).toBe(0);
  });
  it('the dress invariant holds on every tick of the whole sortie and return', () => {
    const { w } = called();
    for (let t = 0; t < 700; t++) {
      tick(w);
      expect(counted(w, 0), `tick ${w.sim.tickCount}`).toBe(true);
    }
  });
  it('formationCall is a registered event kind', () => {
    expect(SIM_EVENT_KINDS).toContain('formationCall');
  });
});

describe('the sortie ends at the point, and the call is not made twice', () => {
  it('the helicopter stops at the call tile at tick 297 and does not fly on to its next checkpoint', () => {
    const { w, heli, drone } = called();
    const p = priv(w.sim);
    for (let t = 0; t < 400 && p.moving[heli] === 1; t++) tick(w);
    expect(w.sim.tickCount).toBe(298); // tickCount counts the tick that has run: it stopped on tick 297
    expect([tileOf(p.posX[heli]), tileOf(p.posY[heli])]).toEqual([31, 19]);
    expect([p.moving[heli], p.fmDuty[heli], p.wpCount[heli], p.fmLeg[heli]]).toEqual([0, DUTY.out, 2, 2]);
    // thirty ticks on, before the quiet return: still there, queue still two, the drone beside it
    tick(w, 29);
    expect([tileOf(p.posX[heli]), tileOf(p.posY[heli]), p.moving[heli], p.wpCount[heli], p.fmDuty[heli]]).toEqual([31, 19, 0, 2, DUTY.out]);
    expect([tileOf(p.posX[drone]), tileOf(p.posY[drone]), p.moving[drone], p.wpCount[drone]]).toEqual([31, 19, 0, 2]);
  });
  it('a contact while the sortie is out does not call again, and it restarts the quiet clock', () => {
    const { w, heli, drone, ids } = called();
    const p = priv(w.sim);
    tick(w, 100);
    const foe = spawnAt(w, w.inf, 1, 33, 40);
    const m = ids[3];
    // a hostile hit on a rifleman, the foe 12 tiles from him: within reach, but sorties are out, so no call bit
    w.sim.debugSplash(p.posX[m], p.posY[m], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    expect([p.fgPending[0], p.fgQuiet[0]]).toEqual([0, 0]);
    tick(w, 20);
    expect(calls(w)).toEqual([
      { tick: 129, entity: heli, call: 'strike' },
      { tick: 129, entity: drone, call: 'spot' },
    ]);
    expect([p.fmDuty[heli], p.fmDuty[drone], p.fgAway[0]]).toEqual([DUTY.out, DUTY.out, 2]);
    // the return waits for ten quiet seconds from that hit, made after tick 229 and not tick 128: not at 328 but at 429
    tick(w, 150);
    expect(w.sim.tickCount).toBe(400);
    expect(calls(w).filter((c) => c.call === 'return')).toHaveLength(0);
    for (let t = 0; t < 100 && calls(w).filter((c) => c.call === 'return').length === 0; t++) tick(w);
    expect(calls(w).filter((c) => c.call === 'return').map((c) => c.tick)).toEqual([429, 429]);
  });
});

describe('the quiet return', () => {
  /** Run to the tick the return is sent. */
  function untilReturn(a: Attack): void {
    for (let t = 0; t < 800 && kinds(a.w, 'formationCall').filter((e) => (e as { call: string }).call === 'return').length === 0; t++) tick(a.w);
  }
  it('ten seconds after the last contact (tick 328) both go home as moves: goal fmHome, attackMove 0, duty RETURN', () => {
    const a = called();
    const { w, heli, drone } = a;
    const p = priv(w.sim);
    untilReturn(a);
    expect(calls(w).filter((c) => c.call === 'return')).toEqual([
      { tick: 328, entity: heli, call: 'return' },
      { tick: 328, entity: drone, call: 'return' },
    ]);
    expect([p.goalX[heli], p.goalY[heli]]).toEqual([1605632, 1802240]);
    expect([p.goalX[drone], p.goalY[drone]]).toEqual([1736704, 1802240]);
    expect([p.attackMove[heli], p.attackMove[drone], p.sweepOrder[heli]]).toEqual([0, 0, 0]);
    expect([p.fmDuty[heli], p.fmDuty[drone], p.moving[heli], p.wpCount[heli]]).toEqual([DUTY.ret, DUTY.ret, 1, 2]);
    expect([p.fgCalled[0], p.fgAway[0]]).toEqual([0, 2]); // the call is over; both are still away until they arrive
  });
  it('nothing is sent a tick early', () => {
    const a = called();
    const p = priv(a.w.sim);
    while (a.w.sim.tickCount < 327) tick(a.w); // the tick before the return event
    expect(calls(a.w).filter((c) => c.call === 'return')).toHaveLength(0);
    expect([p.fmDuty[a.heli], p.fmDuty[a.drone], p.fgCalled[0]]).toEqual([DUTY.out, DUTY.out, 1]);
  });
  it('on arrival the helicopter is back on duty NONE, an attack-mover again, and goes on through its queue to its final slot', () => {
    const a = called();
    const { w, heli, drone } = a;
    const p = priv(w.sim);
    untilReturn(a);
    while (p.fmDuty[heli] === DUTY.ret) tick(w);
    expect(w.sim.tickCount).toBe(437); // it arrived on tick 436
    expect([p.fmDuty[heli], p.fmDuty[drone], p.fgAway[0]]).toEqual([DUTY.none, DUTY.none, 0]);
    expect(p.attackMove[heli]).toBe(1); // the formation's verb is attackMove
    expect(p.attackMove[drone]).toBe(1);
    // the ordinary march logic took it on to checkpoint 3: goal (24.5, 19.5), one waypoint left, leg 3
    expect([p.goalX[heli], p.goalY[heli], p.wpCount[heli], p.fmLeg[heli], p.moving[heli]]).toEqual([1605632, 1277952, 1, 3, 1]);
    for (let t = 0; t < 400 && p.moving[heli] === 1; t++) tick(w);
    expect([tileOf(p.posX[heli]), tileOf(p.posY[heli]), p.wpCount[heli], p.fmLeg[heli]]).toEqual([24, 17, 0, 4]);
    expect([tileOf(p.posX[drone]), tileOf(p.posY[drone])]).toEqual([26, 17]);
  });
  it('a contact after the return calls again; the second sortie is a fresh one from the new position', () => {
    const a = called();
    const { w, heli, drone, tank } = a;
    const p = priv(w.sim);
    untilReturn(a);
    while (p.fmDuty[heli] === DUTY.ret || p.fmDuty[drone] === DUTY.ret) tick(w);
    expect(p.fgCalled[0]).toBe(0);
    // a second post, seven tiles east of the lead tank
    const ty = tileOf(p.posY[tank]);
    spawnAt(w, w.weak, 1, tileOf(p.posX[tank]) + 7, ty);
    for (let t = 0; t < 200 && calls(w).filter((c) => c.call === 'strike').length < 2; t++) tick(w);
    expect(calls(w).filter((c) => c.call === 'strike' || c.call === 'spot').map((c) => [c.entity, c.call])).toEqual([
      [heli, 'strike'],
      [drone, 'spot'],
      [heli, 'strike'],
      [drone, 'spot'],
    ]);
    expect(p.fmDuty[heli]).toBe(DUTY.out);
    expect(p.fgAway[0]).toBe(2);
    expect(p.fgCalled[0]).toBe(1);
  });
  it('defensive: an aircraft found waiting when the call reaches it leaves the count of those waiting (the drills clear every waiter first, so it takes a poke)', () => {
    const a = called();
    const { w, heli, tank } = a;
    const p = priv(w.sim);
    untilReturn(a);
    while (p.fmDuty[a.heli] === DUTY.ret || p.fmDuty[a.drone] === DUTY.ret) tick(w);
    // put the helicopter back to waiting at a checkpoint, as a march would have (the group is in contact, so nothing would)
    p.fmDuty[heli] = DUTY.wait;
    p.fgAtCp[0] = 1;
    spawnAt(w, w.weak, 1, tileOf(p.posX[tank]) + 7, tileOf(p.posY[tank]));
    for (let t = 0; t < 200 && p.fmDuty[heli] === DUTY.wait; t++) tick(w);
    expect(p.fmDuty[heli]).toBe(DUTY.out);
    expect([p.fgAtCp[0], p.fgAway[0]]).toEqual([0, 2]);
    expect(counted(w, 0)).toBe(true);
  });
  it('only an aircraft is recalled: a quiet return leaves a member that is not an aircraft alone', () => {
    const a = called();
    const p = priv(a.w.sim);
    untilReturn(a);
    expect(a.ids.filter((id) => p.fmDuty[id] === DUTY.ret)).toEqual([a.heli, a.drone]);
  });
});

describe('a player order takes a member on a sortie out of the group', () => {
  it('a move to the helicopter: fgAway 2 -> 1, the group 9 -> 8, the row still live and the drone still out', () => {
    const { w, heli, drone } = called();
    const p = priv(w.sim);
    tick(w, 50);
    w.sim.queueCommand({ kind: 'move', ids: [heli], x: at(40), y: at(40) } as never);
    tick(w);
    expect(w.sim.formationGroupOf(heli)).toBe(-1);
    expect([p.fmDuty[heli], p.fmHomeX[heli], p.fmHomeY[heli], p.fmLeg[heli]]).toEqual([0, 0, 0, 0]);
    expect([p.fgAway[0], p.fgMembers[0], p.fgCalled[0], p.fgState[0]]).toEqual([1, 8, 1, FM_CONTACT]);
    expect(w.sim.formationDutyOf(drone)).toBe(DUTY.out);
    expect([p.goalX[heli], p.goalY[heli], p.moving[heli]]).toEqual([2654208, 2654208, 1]); // (40.5, 40.5): the clicked tile
    expect(counted(w, 0)).toBe(true);
  });
  it('then a move to the drone too: fgAway 0, the group 7; and the quiet return finds nobody to send', () => {
    const { w, heli, drone } = called();
    const p = priv(w.sim);
    tick(w, 50);
    w.sim.queueCommand({ kind: 'move', ids: [heli, drone], x: at(40), y: at(40) } as never);
    tick(w);
    expect([p.fgAway[0], p.fgMembers[0], p.fgCalled[0]]).toEqual([0, 7, 1]);
    while (w.sim.tickCount < 340) tick(w);
    expect(calls(w).filter((c) => c.call === 'return')).toHaveLength(0);
    expect(p.fgCalled[0]).toBe(0); // the call ended on its clock all the same
  });
  it('an aircraft shot down on its sortie leaves the count the same way', () => {
    const { w, heli, drone } = called();
    const p = priv(w.sim);
    tick(w, 20);
    w.sim.debugKill(heli);
    tick(w);
    expect([p.fgAway[0], p.fgMembers[0]]).toEqual([1, 8]);
    expect(w.sim.formationDutyOf(drone)).toBe(DUTY.out);
    expect(counted(w, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The medic. A Column of two four-man squads and a one-man squad, with a medic and an ambulance behind them, all on their own
// tiles at the south edge and ordered up the lane to (24, 20). A splash with no shooter (`by` -1: it is not contact, so the
// group goes on marching) drops a man at tick 30.
interface Convoy {
  w: World;
  ids: number[]; // squad (22,44), squad (26,44), solo (24,42), medic (24,46), ambulance (24,47)
  squadA: number;
  squadB: number;
  solo: number;
  medic: number;
  ambulance: number;
}
function convoy(extra: [number, number, number][] = [], formation = 'column'): Convoy {
  const w = world();
  const pos: [number, number, number][] = [[w.squad, 22, 44], [w.squad, 26, 44], [w.solo, 24, 42], [w.medic, 24, 46], [w.ambulance, 24, 47], ...extra];
  const ids = pos.map(([t, x, y]) => spawnAt(w, t, 0, x, y));
  w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(20), formation } as never);
  tick(w, 30);
  return { w, ids, squadA: ids[0], squadB: ids[1], solo: ids[2], medic: ids[3], ambulance: ids[4] };
}
/** A hit with no shooter on `id`: 100 hp of splash, which drops one man of a four-man squad (and kills the one-man solo). */
function hit(w: World, id: number): void {
  const p = priv(w.sim);
  w.sim.debugSplash(p.posX[id], p.posY[id], fx.fromInt(1), fx.fromInt(100), 0, -1, -1);
}

describe('the medic answers a man going down', () => {
  it('the nearest free medic gets the rescue: medTarget the wounded, duty OUT, queue and place kept', () => {
    const c = convoy();
    const { w, medic, squadA } = c;
    const p = priv(w.sim);
    expect([p.fmDuty[medic], p.moving[medic], p.wpCount[medic], p.goalX[medic], p.goalY[medic]]).toEqual([0, 1, 3, 1605632, 2654208]);
    hit(w, squadA);
    const down = kinds(w, 'woundedDown');
    tick(w);
    const dn = [...down, ...kinds(w, 'woundedDown')];
    expect(dn).toEqual([{ kind: 'woundedDown', tick: 30, entity: 5, parent: squadA, by: -1 }]);
    expect(calls(w)).toEqual([{ tick: 30, entity: medic, call: 'casualty' }]);
    expect([p.fmDuty[medic], p.medTarget[medic], p.wpCount[medic]]).toEqual([DUTY.out, 5, 3]);
    // its place in the march: where it was going, checkpoint 1's slot at (24.5, 40.5)
    expect([p.fmHomeX[medic], p.fmHomeY[medic]]).toEqual([1605632, 2654208]);
    expect([p.fgAway[0], p.fgMembers[0], p.fgCalled[0]]).toEqual([1, 5, 0]); // a casualty call is not a sortie
    // he stays out, with his queue, while he treats (about 6 s) and carries
    for (let t = 0; t < 100; t++) {
      tick(w);
      expect(p.wpCount[medic], `tick ${w.sim.tickCount}`).toBe(3);
      expect(counted(w, 0)).toBe(true);
    }
    expect(p.fmDuty[medic]).toBe(DUTY.out);
  });
  it('the ambulance never answers and never leaves its post in the march', () => {
    const c = convoy();
    const { w, ambulance, medic } = c;
    const p = priv(w.sim);
    hit(w, c.squadA);
    const goalAt30 = [p.goalX[ambulance], p.goalY[ambulance]];
    for (let t = 0; t < 600; t++) {
      tick(w);
      expect(p.fmDuty[ambulance], `tick ${w.sim.tickCount}: waiting at a checkpoint is its only duty`).toBeLessThan(DUTY.out);
      expect(p.medTarget[ambulance]).toBe(-1);
      expect(p.medState[ambulance]).toBe(0);
    }
    expect(calls(w).every((x) => x.entity === medic)).toBe(true);
    expect(calls(w).map((x) => x.call)).toContain('casualty');
    expect(goalAt30).toEqual([1605632, 2785280]); // (24.5, 42.5), its first checkpoint slot: it kept marching to it
  });
  it('delivered, the medic goes home and rejoins: RETURN to fmHome, then NONE and the rest of its queue to its final slot', () => {
    const c = convoy();
    const { w, medic } = c;
    const p = priv(w.sim);
    hit(w, c.squadA);
    let sent = 0;
    for (let t = 0; t < 1500 && sent === 0; t++) {
      tick(w);
      if (calls(w).some((x) => x.call === 'return')) sent = w.sim.tickCount;
    }
    expect(calls(w).filter((x) => x.call === 'return')).toEqual([{ tick: 688, entity: medic, call: 'return' }]);
    expect([p.fmDuty[medic], p.attackMove[medic], p.moving[medic], p.passengers[medic], p.medState[medic]]).toEqual([DUTY.ret, 0, 1, 0, 0]);
    expect([p.goalX[medic], p.goalY[medic], p.wpCount[medic]]).toEqual([1605632, 2654208, 3]);
    expect(p.fgAway[0]).toBe(1); // coming home still counts as away
    for (let t = 0; t < 1500 && p.fmDuty[medic] === DUTY.ret; t++) {
      tick(w);
      expect(counted(w, 0)).toBe(true);
    }
    expect([p.fmDuty[medic], p.fgAway[0]]).toEqual([DUTY.none, 0]);
    for (let t = 0; t < 1500 && (p.moving[medic] === 1 || p.fmDuty[medic] !== 0); t++) tick(w);
    expect([tileOf(p.posX[medic]), tileOf(p.posY[medic]), p.wpCount[medic]]).toEqual([24, 23, 0]);
  });
  it('the last man of a squad is answered too: the group is read before the squad dies', () => {
    const c = convoy();
    const { w, medic, solo } = c;
    const p = priv(w.sim);
    hit(w, solo); // a one-man squad: the hit kills it, and its only man is the squad's last
    tick(w);
    const dn = kinds(w, 'woundedDown');
    expect(dn).toEqual([{ kind: 'woundedDown', tick: 30, entity: 5, parent: -1, by: -1 }]);
    expect(w.sim.state.alive[solo]).toBe(0);
    expect(calls(w)).toEqual([{ tick: 30, entity: medic, call: 'casualty' }]);
    expect([p.fmDuty[medic], p.medTarget[medic]]).toEqual([DUTY.out, 5]);
    expect([p.fgAway[0], p.fgMembers[0]]).toEqual([1, 4]); // the squad left the group when it died
  });
  it('a medic 13 tiles from the man does not answer', () => {
    const w = world();
    // the squad at the head of the lane and the medic 13 tiles behind it, an ambulance beside the medic
    const ids = [[w.squad, 24, 20], [w.solo, 24, 21], [w.medic, 24, 33], [w.ambulance, 24, 34]].map(([t, x, y]) => spawnAt(w, t, 0, x, y));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(2), formation: 'column' } as never);
    tick(w);
    const p = priv(w.sim);
    const d = Math.hypot((p.posX[ids[2]] - p.posX[ids[0]]) / 65536, (p.posY[ids[2]] - p.posY[ids[0]]) / 65536);
    expect(d).toBeGreaterThan(12.9); // the oracle is the float distance: tests may use Math
    expect(d).toBeLessThan(13.1);
    hit(w, ids[0]);
    tick(w, 3);
    expect(kinds(w, 'woundedDown')).toHaveLength(1);
    expect(calls(w)).toEqual([]);
    expect([p.fmDuty[ids[2]], p.medState[ids[2]], p.fgAway[0]]).toEqual([0, 0, 0]);
  });
  it('the same medic 11 tiles from him does answer (the control: the 12-tile radius is the limit)', () => {
    const w = world();
    const ids = [[w.squad, 24, 20], [w.solo, 24, 21], [w.medic, 24, 31], [w.ambulance, 24, 32]].map(([t, x, y]) => spawnAt(w, t, 0, x, y));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(2), formation: 'column' } as never);
    tick(w);
    const p = priv(w.sim);
    const d = Math.hypot((p.posX[ids[2]] - p.posX[ids[0]]) / 65536, (p.posY[ids[2]] - p.posY[ids[0]]) / 65536);
    expect(d).toBeGreaterThan(10.9);
    expect(d).toBeLessThan(11.1);
    hit(w, ids[0]);
    tick(w);
    expect(calls(w).map((c) => [c.entity, c.call])).toEqual([[ids[2], 'casualty']]);
  });
});

describe('which medic answers', () => {
  const dist = (p: Priv, a: number, b: number): number => Math.hypot((p.posX[a] - p.posX[b]) / 65536, (p.posY[a] - p.posY[b]) / 65536);
  it('the nearest by distance, not the lowest id and not the farthest', () => {
    // medic 3 is 2.8 tiles from squad A and medic 5 (spawned later) is 8 tiles away: the nearest is the LOWER id here...
    const a = convoy([[world().medic, 22, 36]]);
    const p = priv(a.w.sim);
    const m2 = a.ids[5];
    expect(dist(p, a.medic, a.squadA)).toBeLessThan(dist(p, m2, a.squadA));
    hit(a.w, a.squadA);
    tick(a.w);
    expect(calls(a.w).map((c) => [c.entity, c.call])).toEqual([[a.medic, 'casualty']]);
    expect([p.fmDuty[m2], p.medTarget[m2]]).toEqual([DUTY.none, -1]);
    // ...and here, with squad B hit and the second medic standing next to it, the HIGHER id answers
    const b = convoy([[world().medic, 26, 43]]);
    const q = priv(b.w.sim);
    const m3 = b.ids[5];
    expect(dist(q, m3, b.squadB)).toBeLessThan(dist(q, b.medic, b.squadB));
    hit(b.w, b.squadB);
    tick(b.w);
    expect(calls(b.w).map((c) => [c.entity, c.call])).toEqual([[m3, 'casualty']]);
    expect([q.fmDuty[b.medic], q.medTarget[b.medic]]).toEqual([DUTY.none, -1]);
  });
  it('two at exactly the same distance: the lowest id', () => {
    const c = convoy([[world().medic, 28, 40]]);
    const { w } = c;
    const p = priv(w.sim);
    const other = c.ids[5];
    // poke the three onto one row: the squad at (24.5, 40.5), the medics 4 tiles either side of it
    const put = (id: number, x: number, y: number): void => {
      p.posX[id] = fx.from(x);
      p.posY[id] = fx.from(y);
    };
    put(c.squadA, 24.5, 40.5);
    put(c.medic, 20.5, 40.5);
    put(other, 28.5, 40.5);
    hit(w, c.squadA);
    tick(w);
    expect(calls(w).map((x) => [x.entity, x.call])).toEqual([[c.medic, 'casualty']]);
  });
  it('a medic already on a call is not free: the second man down is answered by the other medic', () => {
    const c = convoy([[world().medic, 22, 38]]);
    const { w } = c;
    const p = priv(w.sim);
    hit(w, c.squadA);
    tick(w);
    expect(calls(w).map((x) => [x.entity, x.call])).toEqual([[c.medic, 'casualty']]);
    hit(w, c.squadB);
    tick(w);
    expect(calls(w).map((x) => [x.entity, x.call])).toEqual([[c.medic, 'casualty'], [c.ids[5], 'casualty']]);
    expect([p.fgAway[0], p.medTarget[c.medic], p.medTarget[c.ids[5]]]).toEqual([2, 6, 7]);
  });
  it('a medic busy with a patient of his own is not free, whatever his duty (poked: MED_TO_WOUNDED)', () => {
    const c = convoy();
    const { w, medic } = c;
    const p = priv(w.sim);
    p.medState[medic] = 1; // MED_TO_WOUNDED: he picked a man by himself, as an idle medic of a halted group does
    p.medTarget[medic] = 99;
    hit(w, c.squadA);
    tick(w);
    expect(kinds(w, 'woundedDown')).toHaveLength(1);
    expect(calls(w)).toEqual([]);
    expect([p.fmDuty[medic], p.fgAway[0]]).toEqual([DUTY.none, 0]);
  });
  it('with every medic busy, a man down is left to the old rule (no call, no change)', () => {
    const c = convoy();
    const { w } = c;
    hit(w, c.squadA);
    tick(w);
    hit(w, c.squadB);
    tick(w, 3);
    expect(calls(w)).toHaveLength(1);
    expect(kinds(w, 'woundedDown')).toHaveLength(2);
  });
});

describe('a medic waiting at a checkpoint is called away', () => {
  it('WAIT -> OUT: it leaves the count of those waiting, and the dress clock starts over', () => {
    const w = world();
    // the medic starts ahead of the squads, so it reaches checkpoint 1 first and waits for the ten-second dress
    const ids = [[w.squad, 22, 46], [w.squad, 26, 46], [w.medic, 24, 41], [w.ambulance, 24, 47]].map(([t, x, y]) => spawnAt(w, t, 0, x, y));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(20), formation: 'column_dress10' } as never);
    const p = priv(w.sim);
    const m = ids[2];
    for (let t = 0; t < 600 && p.fmDuty[m] !== DUTY.wait; t++) tick(w);
    expect(p.fmDuty[m]).toBe(DUTY.wait);
    expect(w.sim.tickCount).toBe(45);
    tick(w, 5);
    expect([p.fgAtCp[0], p.fgAway[0]]).toEqual([1, 0]);
    expect(p.fgDress[0]).toBeGreaterThan(0);
    hit(w, ids[0]);
    tick(w);
    expect(calls(w).map((c) => [c.entity, c.call])).toEqual([[m, 'casualty']]);
    expect([p.fmDuty[m], p.fgAtCp[0], p.fgAway[0], p.fgDress[0]]).toEqual([DUTY.out, 0, 1, 0]);
    expect([p.fmHomeX[m], p.fmHomeY[m]]).toEqual([1605632, 2588672]); // home is the checkpoint it was waiting at: (24.5, 39.5)
    for (let t = 0; t < 400; t++) {
      tick(w);
      expect(counted(w, 0), `tick ${w.sim.tickCount}`).toBe(true);
      expect(p.fgAtCp[0] + p.fgAway[0] <= p.fgMembers[0]).toBe(true);
    }
  });
});

describe('a hostile contact with a medic out or coming home', () => {
  /** A hostile rifleman 10 tiles from squad B hits it; the group is a Column, so it halts. */
  function hostileHit(c: Convoy): void {
    const foe = spawnAt(c.w, c.w.inf, 1, 33, 34);
    const p = priv(c.w.sim);
    c.w.sim.debugSplash(p.posX[c.squadB], p.posY[c.squadB], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
  }
  it('a halt drill takes the queue of a medic that is out and leaves him his rescue; he goes home when he is done, and stops there', () => {
    const w0 = world();
    const c = convoy([[w0.squad, 31, 46]]); // a third squad six tiles east of the medic: he turns east to reach it
    const { w, medic } = c;
    const p = priv(w.sim);
    hit(w, c.ids[5]);
    tick(w, 30);
    expect([p.fmDuty[medic], p.wpCount[medic]]).toEqual([DUTY.out, 3]);
    hostileHit(c);
    tick(w);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect([p.fmDuty[medic], p.wpCount[medic], p.medTarget[medic]]).toEqual([DUTY.out, 0, 6]);
    expect([c.squadB, c.solo].map((id) => p.moving[id])).toEqual([0, 0]);
    // standing at his work in a group in contact, he keeps the way he turned: he does not swing round to the slot's facing
    let treating = -1;
    for (let t = 0; t < 600 && treating < 0; t++) {
      tick(w);
      if (p.moving[medic] === 0 && p.medState[medic] === 2) treating = p.facing[medic];
    }
    expect(treating, 'the medic reached his patient and began treating').toBeGreaterThanOrEqual(0);
    expect(treating).not.toBe(p.restFacing[medic]);
    tick(w, 30);
    expect(p.facing[medic]).toBe(treating);
    for (let t = 0; t < 1500 && p.fmDuty[medic] !== DUTY.none; t++) {
      tick(w);
      expect(counted(w, 0)).toBe(true);
    }
    expect([p.fmDuty[medic], p.fgAway[0]]).toEqual([DUTY.none, 0]);
    for (let t = 0; t < 1500 && p.moving[medic] === 1; t++) tick(w);
    // he stopped where he was sent, checkpoint 1's slot: the halted Column's march does not resume
    expect([tileOf(p.posX[medic]), tileOf(p.posY[medic])]).toEqual([24, 40]);
  });
  it('a halt drill stops a medic already on his way home, and he is no longer away', () => {
    const c = convoy();
    const { w, medic } = c;
    const p = priv(w.sim);
    hit(w, c.squadA);
    for (let t = 0; t < 1500 && p.fmDuty[medic] !== DUTY.ret; t++) tick(w);
    expect(p.fmDuty[medic]).toBe(DUTY.ret);
    expect([p.fgAway[0], w.sim.formationStateOfGroup(0)]).toEqual([1, 1]);
    // the foe must be within 12 tiles of the squad it hits: put it near wherever squad B is now
    const foe = spawnAt(w, w.inf, 1, tileOf(p.posX[c.squadB]) + 8, tileOf(p.posY[c.squadB]));
    w.sim.debugSplash(p.posX[c.squadB], p.posY[c.squadB], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(w);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect([p.fmDuty[medic], p.moving[medic], p.wpCount[medic], p.fgAway[0]]).toEqual([DUTY.none, 0, 0, 0]);
    expect(counted(w, 0)).toBe(true);
  });
});

describe('the medic out of the way of his own job', () => {
  it('a medic routed on his call stays out; back on his feet with nothing to do he goes home', () => {
    const c = convoy();
    const { w, medic } = c;
    const p = priv(w.sim);
    hit(w, c.squadA);
    tick(w, 5);
    expect([p.fmDuty[medic], p.medTarget[medic]]).toEqual([DUTY.out, 5]);
    p.routed[medic] = 1;
    w.sim.debugKill(5); // the man he was going to is gone
    tick(w, 5);
    expect([p.fmDuty[medic], p.fgAway[0], p.medState[medic], p.medTarget[medic]]).toEqual([DUTY.out, 1, 0, -1]);
    p.routed[medic] = 0;
    tick(w);
    expect([p.fmDuty[medic], p.moving[medic], p.attackMove[medic]]).toEqual([DUTY.ret, 1, 0]);
    expect([p.goalX[medic], p.goalY[medic], p.wpCount[medic]]).toEqual([1605632, 2654208, 3]);
    expect(calls(w).map((x) => x.call)).toEqual(['casualty', 'return']);
  });
  it('a player order to a medic on a call takes him out of the group, counts and all', () => {
    const c = convoy();
    const { w, medic } = c;
    const p = priv(w.sim);
    hit(w, c.squadA);
    tick(w, 5);
    expect(p.fgAway[0]).toBe(1);
    w.sim.queueCommand({ kind: 'move', ids: [medic], x: at(40), y: at(40) } as never);
    tick(w);
    expect(w.sim.formationGroupOf(medic)).toBe(-1);
    expect([p.fmDuty[medic], p.fmHomeX[medic], p.fgAway[0], p.fgMembers[0]]).toEqual([0, 0, 0, 4]);
  });
  it('a player order to a medic on his way home takes him out of the group too (RETURN counts as away until it ends)', () => {
    const c = convoy();
    const { w, medic } = c;
    const p = priv(w.sim);
    hit(w, c.squadA);
    for (let t = 0; t < 1500 && p.fmDuty[medic] !== DUTY.ret; t++) tick(w);
    expect([p.fmDuty[medic], p.fgAway[0], p.fgMembers[0]]).toEqual([DUTY.ret, 1, 5]);
    w.sim.queueCommand({ kind: 'move', ids: [medic], x: at(40), y: at(40) } as never);
    tick(w);
    expect(w.sim.formationGroupOf(medic)).toBe(-1);
    expect([p.fmDuty[medic], p.fmHomeY[medic], p.fgAway[0], p.fgMembers[0]]).toEqual([0, 0, 0, 4]);
  });
  it('the last member of the row leaves while away: every counter of the row is cleared and the row is free', () => {
    const w = world();
    const ids = [[w.squad, 22, 44], [w.heli, 24, 30]].map(([t, x, y]) => spawnAt(w, t, 0, x, y));
    // two members; the squad is hit, the row calls its aircraft (a contact) and the aircraft goes out; the squad then leaves
    w.sim.queueCommand({ kind: 'attackMove', ids, x: at(24), y: at(10), formation: 'attack' } as never);
    tick(w, 10);
    const p = priv(w.sim);
    const foe = spawnAt(w, w.inf, 1, 30, 40);
    w.sim.debugSplash(p.posX[ids[0]], p.posY[ids[0]], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(w, 2);
    expect([p.fmDuty[ids[1]], p.fgAway[0], p.fgCalled[0], p.fgMembers[0]]).toEqual([DUTY.out, 1, 1, 2]);
    w.sim.debugKill(ids[0]);
    tick(w);
    expect([p.fgMembers[0], p.fgAway[0]]).toEqual([1, 1]);
    w.sim.queueCommand({ kind: 'move', ids: [ids[1]], x: at(5), y: at(5) } as never);
    tick(w);
    expect([p.fgLive[0], p.fgMembers[0], p.fgAway[0], p.fgCalled[0], p.fgQuiet[0], p.fgAtCp[0], p.fgDress[0], p.fgCallX[0], p.fgCallY[0], p.fgState[0]]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([p.fmDuty[ids[1]], p.fmHomeX[ids[1]], p.fmHomeY[ids[1]]]).toEqual([0, 0, 0]);
  });
});

describe('the quiet return sends aircraft, not a medic still at his rescue', () => {
  it('a Column in contact with a 2 s quiet_s: the aircraft goes home, the medic goes on with his rescue', () => {
    const w0 = world();
    const c = convoy([[w0.heli, 24, 40]], 'column_quiet2');
    const { w, medic } = c;
    const heli = c.ids[5];
    const p = priv(w.sim);
    hit(w, c.squadA); // the casualty call, no contact
    tick(w, 10);
    const foe = spawnAt(w, w.inf, 1, 33, 34);
    w.sim.debugSplash(p.posX[c.squadB], p.posY[c.squadB], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(w);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect([p.fmDuty[medic], p.fmDuty[heli], p.fgAway[0], p.fgCalled[0]]).toEqual([DUTY.out, DUTY.out, 2, 1]);
    const returned: number[] = [];
    for (let t = 0; t < 400 && returned.length === 0; t++) {
      tick(w);
      returned.push(...calls(w).filter((x) => x.call === 'return').map((x) => x.entity));
    }
    expect(returned).toEqual([heli]); // the aircraft only
    expect(w.sim.tickCount).toBe(80); // two quiet seconds on from the contact; the rescue (treating, 120 ticks) is still going on
    expect([p.fmDuty[medic], p.fmDuty[heli], p.fgCalled[0], p.fgAway[0]]).toEqual([DUTY.out, DUTY.ret, 0, 2]);
    expect(p.medTarget[medic]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('a halted row: an answering aircraft loses its queue with everyone, and stops at home', () => {
  it('four riflemen and a strike helicopter ordered up the lane; after the hit the helicopter flies out, comes home and stays', () => {
    const w = world();
    const ids = [w.inf, w.inf, w.inf, w.inf, w.heli].map((t) => spawnAt(w, t, 0, 24, 44));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(10), formation: 'column' } as never);
    tick(w, 30);
    const p = priv(w.sim);
    const heli = ids[4];
    // where it is bound at the moment of the hit: checkpoint 1's slot, with two more behind it
    const bound = [p.goalX[heli], p.goalY[heli], p.wpCount[heli]];
    expect(bound[2]).toBeGreaterThan(0);
    const foe = spawnAt(w, w.inf, 1, 31, 38);
    w.sim.debugSplash(p.posX[ids[0]], p.posY[ids[0]], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(w);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect([p.fmDuty[heli], p.wpCount[heli], p.fmHomeX[heli], p.fmHomeY[heli]]).toEqual([DUTY.out, 0, bound[0], bound[1]]);
    expect(ids.slice(0, 4).map((id) => p.wpCount[id])).toEqual([0, 0, 0, 0]);
    tick(w, 1500);
    // the halted riflemen never moved on (they stand on their start tiles), and the helicopter is at the slot it left, not
    // at the group's final slot far up the lane
    expect(ids.slice(0, 4).every((id) => tileOf(p.posY[id]) >= 43)).toBe(true);
    expect([p.fmDuty[heli], p.moving[heli], p.wpCount[heli], p.fgAway[0]]).toEqual([DUTY.none, 0, 0, 0]);
    expect([tileOf(p.posX[heli]), tileOf(p.posY[heli])]).toEqual([tileOf(bound[0]), tileOf(bound[1])]);
    expect(tileOf(p.posY[heli])).toBeGreaterThan(30); // nowhere near the final slot at y 12
  });
});

describe('fmMarchHold holds a marching row only', () => {
  // After the fix that makes a halt drop an answering aircraft's queue, no aircraft reaches a checkpoint with a queue in a row
  // in contact by itself (every drill but `halt` ends the dress, and `halt` clears queues), so the MARCH-only test in
  // `fmMarchHold` is defensive. Poked, it is still pinned: an aircraft at rest with one waypoint queued arrives in a halted row.
  it('an aircraft arriving at a checkpoint in a row in contact goes straight on and is not counted as waiting', () => {
    const w = world();
    const ids = [w.inf, w.inf, w.inf, w.inf, w.heli].map((t) => spawnAt(w, t, 0, 24, 44));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(10), formation: 'column' } as never);
    tick(w, 30);
    const p = priv(w.sim);
    const heli = ids[4];
    const foe = spawnAt(w, w.inf, 1, 31, 38);
    w.sim.debugSplash(p.posX[ids[0]], p.posY[ids[0]], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(w, 1500);
    expect([w.sim.formationStateOfGroup(0), p.fmDuty[heli], p.wpCount[heli], p.fmLeg[heli]]).toEqual([FM_CONTACT, 0, 0, 1]);
    const leg = p.fmLeg[heli];
    const q = p as unknown as { wpX: Int32Array; wpY: Int32Array; wpAttack: Uint8Array; wpSweep: Uint8Array; fgRelease: Uint8Array; fgLegs: Uint8Array };
    expect(q.fgRelease[0] < leg && leg < q.fgLegs[0], 'the halt left the dress open: a marching row would hold it here').toBe(true);
    q.wpX[heli * 8] = p.posX[heli];
    q.wpY[heli * 8] = p.posY[heli] - fx.fromInt(3);
    p.wpCount[heli] = 1;
    p.goalX[heli] = p.posX[heli];
    p.goalY[heli] = p.posY[heli];
    p.moving[heli] = 1;
    tick(w, 3);
    expect([p.fmDuty[heli], p.fgAtCp[0], p.fmLeg[heli]]).toEqual([DUTY.none, 0, leg + 1]);
  });
});

describe('a group with nobody to call is scanned once, not on every exchange of fire (G-3)', () => {
  it('a ground-only Column in a long fight: one scan, fgCalled 2, many exchanges', () => {
    const w = world();
    const ids = [w.inf, w.inf, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 44));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(10), formation: 'column' } as never);
    for (let k = 0; k < 6; k++) spawnAt(w, w.inf, 1, 33 + (k % 2), 30 + k);
    let scans = 0;
    const sim = w.sim as unknown as { fmCallAircraft: (g: number, tpl: unknown) => void };
    const real = sim.fmCallAircraft.bind(w.sim);
    sim.fmCallAircraft = (g, tpl) => {
      scans++;
      real(g, tpl);
    };
    tick(w, 300);
    const p = priv(w.sim);
    expect(kinds(w, 'fire').length, 'the fight went on: the control that the count is not vacuous').toBeGreaterThan(40);
    expect(w.sim.formationStateOfGroup(0)).toBe(FM_CONTACT);
    expect(scans).toBe(1);
    expect(p.fgCalled[0]).toBe(2);
    expect(calls(w)).toEqual([]);
  });
  it('a group with an aircraft that answers is not latched: the value is 1 while it is out, never 2', () => {
    const { w } = called();
    expect(priv(w.sim).fgCalled[0]).toBe(1);
  });
});
