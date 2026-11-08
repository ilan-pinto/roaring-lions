// GH-976 P1: the goals-only runtime of a versus WIN-MODE room -- the objective `side`, the `score` (points race)
// objective and the camp `raze`. Every number here is an integer the runtime must produce exactly: a score is
// held in 1/1200ths of a point and a minute is 1200 ticks, so 60 points a minute for a minute is 60 points.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { MissionRuntime, type MissionContext, type MissionEvent, type MissionJson, type ObjectiveJson } from './mission';
import { Sim, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDED } from './tuning';

const SQUAD: UnitTypeJson = {
  id: 'wm_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const CAMP = { id: 'camp', name: 'Field Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 0 };
const TICKS_A_MINUTE = 1200;
// Two zones, 6 x 6 tiles apiece, far apart on a 40 x 20 map.
const ZONES: Record<string, readonly number[]> = { west: [4, 4, 6, 6], east: [30, 4, 6, 6], camp_a: [2, 14, 2, 2], camp_b: [36, 14, 2, 2] };

const score = (side: 0 | 1, over: Partial<NonNullable<ObjectiveJson['score']>> = {}): ObjectiveJson => ({
  id: `score_${side}`, type: 'score', primary: true, side,
  score: { zones: [{ zone: 'west', per_min: 60 }, { zone: 'east', per_min: 30 }], per_value_destroyed: 1, target: 600, ...over },
});

function world(objectives: ObjectiveJson[], over: { goalsOnly?: boolean; value?: (id: string) => number; structures?: MissionJson['structures'] } = {}) {
  const sim = new Sim({ seed: 9, width: 40, height: 20, capacity: 64 });
  const t = sim.addUnitType(SQUAD);
  sim.addStructureType(CAMP);
  const mission: MissionJson = {
    id: 'wm', map: { file: 'none' }, ledger: { requires: [], produces: [] }, objectives,
    ...(over.structures !== undefined ? { structures: over.structures } : {}),
  };
  const ctx: MissionContext = {
    typeIdOf: () => t, markers: {}, zones: ZONES,
    ...(over.goalsOnly === false ? {} : { goalsOnly: true }),
    unitValueOf: over.value ?? (() => 300),
  };
  const rt = new MissionRuntime(sim, mission, ctx);
  rt.start();
  const events: MissionEvent[] = [];
  const step = (n: number): void => { for (let i = 0; i < n; i++) events.push(...rt.step(sim.tick())); };
  /** A squad of `side` standing mid-tile on (x, y). */
  const put = (side: 0 | 1, x: number, y: number): number => sim.spawn(t, side, fx.from(x) + 32768, fx.from(y) + 32768);
  return { sim, rt, step, events, put, t };
}

describe('objective side (GH-976)', () => {
  it('a hold_for on side 1 counts side 1 units, and side 0 standing there does not complete it', () => {
    const w = world([
      { id: 'hold0', type: 'hold_for', primary: false, target: 'west', seconds: 5, side: 0 },
      { id: 'hold1', type: 'hold_for', primary: false, target: 'west', seconds: 5, side: 1 },
    ]);
    w.put(1, 6, 6);
    w.step(5 * 20 + 2);
    expect(w.rt.objectiveStatus('hold1')).toBe('complete');
    expect(w.rt.objectiveStatus('hold0')).toBe('active');
  });

  it('with no side it is side 0, as every mission has always read it', () => {
    const w = world([{ id: 'hold', type: 'hold_for', primary: false, target: 'west', seconds: 5 }], { goalsOnly: false });
    const enemy = w.put(1, 6, 6);
    w.step(5 * 20 + 2);
    expect(w.rt.objectiveStatus('hold')).toBe('active'); // side 1 alone on the ground is nothing to side 0
    w.sim.debugKill(enemy);
    w.put(0, 7, 7);
    w.step(5 * 20 + 40);
    expect(w.rt.objectiveStatus('hold')).toBe('complete');
  });

  it('a side-1 unit alone completes a side-1 capture, and a side-0 unit alone does not', () => {
    const one = world([{ id: 'cap1', type: 'capture', primary: false, target: 'west', seconds: 3, side: 1 }]);
    one.put(1, 5, 5);
    one.step(3 * 20 + 2);
    expect(one.rt.objectiveStatus('cap1')).toBe('complete');
    const zero = world([{ id: 'cap1', type: 'capture', primary: false, target: 'west', seconds: 3, side: 1 }]);
    zero.put(0, 5, 5);
    zero.step(3 * 20 + 2);
    expect(zero.rt.objectiveStatus('cap1')).toBe('active');
  });

  it('a side-1 capture is contested by side 0, not by side 1 itself', () => {
    const w = world([{ id: 'cap1', type: 'capture', primary: false, target: 'west', seconds: 3, side: 1 }]);
    w.put(1, 5, 5);
    w.put(0, 8, 8); // inside the zone and within the contest radius: contested, the clock never runs
    w.step(3 * 20 + 20);
    expect(w.rt.objectiveStatus('cap1')).toBe('active');
  });

  it('refuses a side on a type that does not read one, and a side that is not 0 or 1', () => {
    expect(() => world([{ id: 'l', type: 'locate', primary: false, count: 1, side: 1 }])).toThrow(/takes no side/);
    expect(() => world([{ id: 's', type: 'survive_until', primary: false, seconds: 60, side: 0 }])).toThrow(/takes no side/);
    expect(() => world([{ id: 'h', type: 'hold_for', primary: false, target: 'west', seconds: 5, side: 2 }])).toThrow(/expected 0 or 1/);
  });
});

describe('flag raid: a capture held alone for the hold, reset by contact (GH-976 P3)', () => {
  const raid = (side: 0 | 1, target: string, seconds = 30): ObjectiveJson => ({ id: `raid_${side}`, type: 'capture', primary: true, side, target, seconds });
  const HOLD = 30 * 20;

  it('a side alone on the enemy flag for the whole hold completes on the last tick of it, and not one tick before', () => {
    const w = world([raid(0, 'east'), raid(1, 'west')]);
    w.put(0, 32, 6);
    w.step(HOLD - 1);
    expect(w.rt.objectiveStatus('raid_0')).toBe('active');
    expect(w.rt.sideWon(0)).toBe(false);
    w.step(1);
    expect(w.rt.objectiveStatus('raid_0')).toBe('complete');
    expect(w.rt.sideWon(0)).toBe(true);
    expect(w.rt.sideWon(1)).toBe(false);
    expect(w.rt.completeTickOf(0)).toBe(HOLD);
  });

  it('contact resets the hold to zero: an enemy unit inside the zone for one second costs the raid the 20 seconds it had banked', () => {
    const w = world([raid(0, 'east'), raid(1, 'west')]);
    w.put(0, 32, 6);
    w.step(20 * 20);
    const defender = w.put(1, 34, 8); // inside the flag zone, within the contest radius
    w.step(20);
    expect(w.rt.objectiveList.find((o) => o.id === 'raid_0')?.paused).toBe('contested');
    w.sim.debugKill(defender);
    w.step(HOLD - 1);
    expect(w.rt.objectiveStatus('raid_0')).toBe('active'); // 29 s since the contact ended: the banked 20 s are gone
    w.step(2);
    expect(w.rt.objectiveStatus('raid_0')).toBe('complete');
  });

  it('a defender standing OUTSIDE the zone does not contest it (a flag is held by the ground, not by the fire on it)', () => {
    const w = world([raid(0, 'east'), raid(1, 'west')]);
    w.put(0, 32, 6);
    w.put(1, 28, 6); // two tiles outside the east flag [30,4,6,6]
    w.step(HOLD + 1);
    expect(w.rt.objectiveStatus('raid_0')).toBe('complete');
  });

  it('leaving the zone resets the hold as well: the raid has to be served in one go', () => {
    const w = world([raid(0, 'east'), raid(1, 'west')]);
    const raider = w.put(0, 32, 6);
    w.step(HOLD - 20);
    w.sim.state.posX[raider] = fx.from(20) + 32768; // one second short, a step out of the zone
    w.step(2);
    expect(w.rt.objectiveList.find((o) => o.id === 'raid_0')?.paused).toBe('unheld');
    w.sim.state.posX[raider] = fx.from(32) + 32768;
    w.step(HOLD - 1);
    expect(w.rt.objectiveStatus('raid_0')).toBe('active');
    w.step(2);
    expect(w.rt.objectiveStatus('raid_0')).toBe('complete');
  });

  it('two raids that finish on one tick finish on one tick: the completion tick is the same for both sides (the draw the probe shows)', () => {
    const w = world([raid(0, 'east'), raid(1, 'west')]);
    w.put(0, 32, 6);
    w.put(1, 6, 6);
    w.step(HOLD + 1);
    expect(w.rt.completeTickOf(0)).toBe(HOLD);
    expect(w.rt.completeTickOf(1)).toBe(HOLD);
  });

  it('a goals-only raid pays nothing and earns nothing: it completes and the score stays zero', () => {
    const w = world([raid(0, 'east'), raid(1, 'west')]);
    w.put(0, 32, 6);
    w.step(HOLD + 1);
    expect(w.rt.scoreUnitsOf(0)).toBe(0);
  });
});

describe('score objective: the points race (GH-976)', () => {
  it('holding a zone for a minute pays exactly per_min points, in whole integers', () => {
    const w = world([score(0), score(1)]);
    w.put(0, 6, 6);
    w.step(TICKS_A_MINUTE);
    expect(w.rt.scoreUnitsOf(0)).toBe(60 * 1200);
    expect(w.rt.scoreOf(0)).toBe(60);
    expect(w.rt.scoreOf(1)).toBe(0);
  });

  it('pays the HOLDER of each zone its own rate, two zones, two sides', () => {
    const w = world([score(0), score(1)]);
    w.put(0, 6, 6); // west: 60 a minute
    w.put(1, 32, 6); // east: 30 a minute
    w.step(TICKS_A_MINUTE);
    expect(w.rt.scoreOf(0)).toBe(60);
    expect(w.rt.scoreOf(1)).toBe(30); // side 1's row lists both zones and it holds east only
  });

  it('a contested zone pays nobody', () => {
    const w = world([score(0), score(1)]);
    w.put(0, 6, 6);
    w.put(1, 8, 8);
    w.step(600);
    expect(w.rt.scoreUnitsOf(0)).toBe(0);
    expect(w.rt.scoreUnitsOf(1)).toBe(0);
  });

  it('an odd rate does not drift: 7 points a minute for 3 minutes is 21 points, to the unit', () => {
    const w = world([score(0, { zones: [{ zone: 'west', per_min: 7 }], per_value_destroyed: 0 }), score(1, { zones: [], per_value_destroyed: 0 })]);
    w.put(0, 6, 6);
    w.step(3 * TICKS_A_MINUTE);
    expect(w.rt.scoreUnitsOf(0)).toBe(7 * 3 * 1200);
    expect(w.rt.scoreOf(0)).toBe(21);
  });

  it('credits the value of the enemy units that die: 1 point per 100, at 300 a squad is 3', () => {
    const w = world([score(0, { zones: [] }), score(1, { zones: [] })]);
    const enemy = w.put(1, 20, 10);
    const own = w.put(0, 22, 10);
    w.sim.debugKill(enemy);
    w.step(2);
    expect(w.rt.scoreOf(0)).toBe(3);
    expect(w.rt.scoreUnitsOf(0)).toBe(300 * 12);
    // A side's own loss is the OTHER side's gain, never its own.
    w.sim.debugKill(own);
    w.step(2);
    expect(w.rt.scoreOf(0)).toBe(3);
    expect(w.rt.scoreOf(1)).toBe(3);
  });

  it('per_value_destroyed scales it, and 0 turns it off', () => {
    const on = world([score(0, { zones: [], per_value_destroyed: 5 }), score(1, { zones: [] })]);
    on.sim.debugKill(on.put(1, 20, 10));
    on.step(2);
    expect(on.rt.scoreOf(0)).toBe(15);
    const off = world([score(0, { zones: [], per_value_destroyed: 0 }), score(1, { zones: [] })]);
    off.sim.debugKill(off.put(1, 20, 10));
    off.step(2);
    expect(off.rt.scoreOf(0)).toBe(0);
  });

  it('completes on the tick the target is reached, and only for the side that reached it', () => {
    const w = world([score(0, { zones: [{ zone: 'west', per_min: 60 }], target: 10, per_value_destroyed: 0 }), score(1, { zones: [{ zone: 'west', per_min: 60 }], target: 10, per_value_destroyed: 0 })]);
    w.put(0, 6, 6);
    w.step(10 * 20 - 1); // 10 points at 60 a minute is 10 seconds
    expect(w.rt.sideWon(0)).toBe(false);
    w.step(1);
    expect(w.rt.sideWon(0)).toBe(true);
    expect(w.rt.sideWon(1)).toBe(false);
    expect(w.events.filter((e) => e.kind === 'objective' && e.status === 'complete').map((e) => (e as { id: string }).id)).toEqual(['score_0']);
  });

  it('stores the tick an objective completed on, per side, and -1 while it has not (GH-976 P2)', () => {
    const w = world([score(0, { zones: [{ zone: 'west', per_min: 60 }], target: 10, per_value_destroyed: 0 }), score(1, { zones: [{ zone: 'east', per_min: 30 }], target: 10, per_value_destroyed: 0 })]);
    w.put(0, 6, 6);
    w.put(1, 32, 6);
    expect([w.rt.completeTickOf(0), w.rt.completeTickOf(1)]).toEqual([-1, -1]);
    w.step(10 * 20 + 5);
    // Side 0: 10 points at 60 a minute is 200 ticks, completing on the 200th step (tick 200). Side 1 at 30 a minute needs 400.
    expect(w.rt.completeTickOf(0)).toBe(200);
    expect(w.rt.completeTickOf(1)).toBe(-1);
    w.step(10 * 20);
    expect(w.rt.completeTickOf(1)).toBe(400);
    expect(w.rt.completeTickOf(0)).toBe(200); // frozen: a later step never moves it
  });

  it('is a goals-only objective: outside such a room the runtime refuses it', () => {
    expect(() => world([score(0)], { goalsOnly: false })).toThrow(/goalsOnly/);
  });

  it('refuses a zone the map does not have, and a fractional or negative number', () => {
    expect(() => world([score(0, { zones: [{ zone: 'nowhere', per_min: 1 }] })])).toThrow(/unknown zone/);
    expect(() => world([score(0, { zones: [{ zone: 'west', per_min: -1 }] })])).toThrow(/whole numbers/);
    expect(() => world([score(0, { target: 0 })])).toThrow(/whole numbers/);
  });

  it('moves digest() (the network hash) with the score: a desync cannot hide in it', () => {
    const a = world([score(0), score(1)]);
    const b = world([score(0), score(1)]);
    a.put(0, 6, 6);
    b.put(0, 6, 6);
    a.step(100);
    b.step(100);
    expect(a.rt.digest()).toBe(b.rt.digest());
    b.sim.debugKill(b.put(1, 20, 10));
    a.put(1, 20, 10);
    a.step(1);
    b.step(1);
    expect(a.rt.digest()).not.toBe(b.rt.digest());
  });
});

describe('the completion tick is a mode room\'s alone (GH-976 P2: annihilation rooms and missions stay byte-identical)', () => {
  const poke = (rt: unknown, tick: number): void => {
    for (const o of (rt as { objectives: { completeTick: number }[] }).objectives) o.completeTick = tick;
  };
  it('moves digest() in a goals-only room, and moves it not at all in a mission runtime', () => {
    const mk = (goalsOnly: boolean) => world([{ id: 'hold', type: 'hold_for', primary: false, target: 'west', seconds: 3 }], { goalsOnly });
    const mode = mk(true);
    const mission = mk(false);
    const before = [mode.rt.digest(), mission.rt.digest()];
    poke(mode.rt, 777);
    poke(mission.rt, 777);
    expect(mode.rt.digest()).not.toBe(before[0]); // a mode room folds it
    expect(mission.rt.digest()).toBe(before[1]); // a mission does not: the live flag is what keeps it out
  });

  it('is written when an objective is completed from outside the runtime too', () => {
    const w = world([{ id: 'hold', type: 'hold_for', primary: false, target: 'west', seconds: 5 }], { goalsOnly: false });
    w.step(7);
    expect(w.rt.completeObjective('hold')).toBe(true);
    expect((w.rt as unknown as { objectives: { completeTick: number }[] }).objectives[0].completeTick).toBe(7);
  });
});

describe('a side that is not named is side 0, byte for byte (GH-976: annihilation rooms and every shipped mission are unchanged)', () => {
  it('hold_for and capture with side 0 written out read the same digest as with no side, every tick', () => {
    const mk = (side: { side?: number }) => world([
      { id: 'hold', type: 'hold_for', primary: false, target: 'west', seconds: 3, ...side },
      { id: 'cap', type: 'capture', primary: false, target: 'east', seconds: 2, ...side },
    ], { goalsOnly: false });
    const a = mk({});
    const b = mk({ side: 0 });
    for (const w of [a, b]) { w.put(0, 6, 6); w.put(0, 32, 6); w.put(1, 20, 12); }
    for (let t = 0; t < 120; t++) {
      a.step(1);
      b.step(1);
      expect(b.rt.digest(), `tick ${t}`).toBe(a.rt.digest());
      expect(b.sim.hash(), `tick ${t}`).toBe(a.sim.hash());
    }
    expect(a.rt.objectiveStatus('hold')).toBe('complete');
    expect(a.rt.objectiveStatus('cap')).toBe('complete');
  });
});

describe('goals only: the rest of the runtime is off (GH-976)', () => {
  const rooms = (): ObjectiveJson[] => [score(0), score(1)];

  it('never ends: all units dead and every primary open is still ongoing, and no missionEnd is ever emitted', () => {
    const w = world(rooms());
    const a = w.put(0, 6, 6);
    const b = w.put(1, 32, 6);
    w.sim.debugKill(a);
    w.sim.debugKill(b);
    w.step(40);
    expect(w.rt.result).toBe('ongoing');
    expect(w.events.some((e) => e.kind === 'missionEnd')).toBe(false);
  });

  it('builds no production line and accrues no income', () => {
    const w = world(rooms(), { structures: [{ type: 'camp', at: [2, 14], size: [2, 2], side: 0 }, { type: 'camp', at: [36, 14], size: [2, 2], side: 1 }] });
    expect(w.rt.productionLines(0)).toEqual([]);
    expect(w.rt.productionLines(1)).toEqual([]);
    w.put(0, 6, 6);
    w.step(600);
    expect(w.rt.logisticsOf(0)).toBe(0);
    expect(w.rt.logisticsOf(1)).toBe(0);
  });

  it('a completed objective pays no intel and earns no stripe: a goals-only room has neither', () => {
    const w = world([score(0, { zones: [{ zone: 'west', per_min: 60 }], target: 1, per_value_destroyed: 0 }), score(1, { zones: [], target: 5000 })]);
    w.put(0, 6, 6);
    w.step(2 * 20);
    expect(w.rt.sideWon(0)).toBe(true);
    expect(w.rt.intel).toBe(0);
    // The control: the same objective forced complete in a MISSION runtime pays (D5), so the 0 above is the room's doing.
    const m = world([{ id: 'hold', type: 'hold_for', primary: false, target: 'west', seconds: 5 }], { goalsOnly: false });
    expect(m.rt.completeObjective('hold')).toBe(true);
    expect(m.rt.intel).toBeGreaterThan(0);
  });

  it('a camp raze with a side: the razing side wins when the camp falls, and no deadline is needed', () => {
    const w = world(
      [
        { id: 'raze_1', type: 'raze', primary: true, target: 'camp_b', side: 0 },
        { id: 'raze_0', type: 'raze', primary: true, target: 'camp_a', side: 1 },
      ],
      { structures: [{ type: 'camp', at: [2, 14], size: [2, 2], owner: 0 }, { type: 'camp', at: [36, 14], size: [2, 2], owner: 1 }] },
    );
    w.step(20);
    expect(w.rt.sideWon(0) || w.rt.sideWon(1)).toBe(false);
    // Camp B (side 1's) falls: side 0 has razed it.
    w.sim.debugDestroyStructure(w.sim.structureAt(36, 14));
    w.step(2);
    expect(w.rt.sideWon(0)).toBe(true);
    expect(w.rt.sideWon(1)).toBe(false);
    // And a primary raze with no `seconds` never fails: the match cap is its clock.
    expect(w.rt.objectiveStatus('raze_0')).toBe('active');
    w.step(5000);
    expect(w.rt.objectiveStatus('raze_0')).toBe('active');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GH-976 WP3: `ground_only` (only units standing on the ground hold or contest a flag) and the bell wait (a flag objective
// scores nothing until the set-up ends). Every count is a literal with its arithmetic beside it.

const HELO: UnitTypeJson = {
  id: 'wm_helo', role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' }, sensors: { optics: 1, sight_tiles: 10, signature: 1 }, weapons: [],
};
const JEEP: UnitTypeJson = {
  id: 'wm_jeep', role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 4 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 }, sensors: { optics: 1, sight_tiles: 9, signature: 0.8 }, weapons: [],
};

/** The flag world of `world()`, with a helicopter and a jeep registered, and the east flag [30,4,6,6] as a side-`side` capture. */
function airWorld(groundOnly: boolean | undefined, side: 0 | 1 = 0, seconds = 5) {
  const sim = new Sim({ seed: 9, width: 40, height: 20, capacity: 64 });
  const squad = sim.addUnitType(SQUAD);
  const helo = sim.addUnitType(HELO);
  const jeep = sim.addUnitType(JEEP);
  const objective: ObjectiveJson = { id: 'cap', type: 'capture', primary: true, side, target: 'east', seconds, ...(groundOnly === undefined ? {} : { ground_only: groundOnly }) };
  const mission: MissionJson = { id: 'wm_air', map: { file: 'none' }, ledger: { requires: [], produces: [] }, objectives: [objective] };
  const rt = new MissionRuntime(sim, mission, { typeIdOf: () => squad, markers: {}, zones: ZONES, goalsOnly: true });
  rt.start();
  const step = (n: number): void => { for (let i = 0; i < n; i++) rt.step(sim.tick()); };
  const at = (x: number, y: number): [number, number] => [fx.from(x) + 32768, fx.from(y) + 32768];
  const put = (type: number, s: 0 | 1, x: number, y: number): number => sim.spawn(type, s, ...at(x, y));
  // The hold clock, read from the public list: ticksLeft = seconds x 20 - holdTicks while the objective is active.
  const hold = (): number => {
    const left = rt.objectiveList.find((o) => o.id === 'cap')?.ticksLeft;
    return left === undefined ? seconds * 20 : seconds * 20 - left;
  };
  const status = (): string => rt.objectiveStatus('cap');
  return { sim, rt, step, put, hold, status, squad, helo, jeep };
}
const FIVE_S = 5 * 20;

describe('ground_only: aircraft hold and contest nothing (GH-976 WP3)', () => {
  it('an aircraft-only raider in the zone holds 0 ticks, and a ground raider beside it holds (and completes) as it did', () => {
    const w = airWorld(true);
    w.put(w.helo, 0, 32, 6);
    w.step(FIVE_S + 20);
    expect(w.hold()).toBe(0); // 120 ticks in the zone, none counted
    expect(w.status()).toBe('active');
    w.put(w.squad, 0, 33, 6);
    w.step(FIVE_S - 1);
    expect(w.hold()).toBe(99); // the squad's own clock: 99 ticks, one short of the 100
    expect(w.status()).toBe('active');
    w.step(1);
    expect(w.hold()).toBe(100);
    expect(w.status()).toBe('complete');
  });

  it('without ground_only the same helicopter holds the flag alone, as it always has (today\'s numbers)', () => {
    for (const flag of [undefined, false]) {
      const w = airWorld(flag);
      w.put(w.helo, 0, 32, 6);
      w.step(FIVE_S - 1);
      expect(w.hold(), `flag ${String(flag)}`).toBe(99);
      w.step(1);
      expect(w.status(), `flag ${String(flag)}`).toBe('complete');
    }
  });

  it('an enemy aircraft in the zone does not reset the hold (and does without the flag: the control)', () => {
    const g = airWorld(true);
    g.put(g.squad, 0, 32, 6);
    g.put(g.helo, 1, 33, 7); // inside the zone and well within the contest radius
    g.step(FIVE_S);
    expect(g.status()).toBe('complete');
    const today = airWorld(undefined);
    today.put(today.squad, 0, 32, 6);
    today.put(today.helo, 1, 33, 7);
    today.step(FIVE_S + 40);
    expect(today.hold()).toBe(0);
    expect(today.status()).toBe('active');
  });

  it('a side-0 aircraft is not an anchor of the contest: an enemy beside only the helicopter does not contest the squad holding far away', () => {
    // East flag [30,4,6,6]. Helicopter (30,4), holding squad (35,9), enemy squad (30,5): 1 tile from the helicopter (1 <= 36) and
    // dx 5, dy 4 from the squad (25 + 16 = 41 > 36, outside the 6-tile contest radius), so only the helicopter is contested.
    const setup = (flag: boolean | undefined) => {
      const w = airWorld(flag);
      w.put(w.helo, 0, 30, 4);
      w.put(w.squad, 0, 35, 9);
      w.put(w.squad, 1, 30, 5);
      w.step(FIVE_S);
      return w;
    };
    expect(setup(true).status()).toBe('complete');
    const today = setup(undefined);
    expect(today.status()).toBe('active');
    expect(today.hold()).toBe(0);
  });

  /** A squad of `side` aboard `car` (a helicopter or a jeep), the pair standing on the flag at (32, 6). */
  function aboard(w: ReturnType<typeof airWorld>, car: number, side: 0 | 1): { car: number; riders: number[] } {
    const c = w.put(car, side, 32, 6);
    const riders = [w.put(w.squad, side, 32, 6), w.put(w.squad, side, 32, 6)];
    for (const r of riders) expect(w.sim.embarkAtSpawn(c, r), `rider ${r} aboard`).toBe(true);
    return { car: c, riders };
  }
  const settle = (w: ReturnType<typeof airWorld>, car: number, how: 'landed' | 'hovering'): void => {
    if (how === 'landed') w.sim.state.airState[car] = AIR_LANDED;
    else expect(w.sim.state.airState[car]).toBe(AIR_AIRBORNE);
  };

  for (const how of ['landed', 'hovering'] as const) {
    it(`a squad embarked on a ${how} transport aircraft in the zone neither holds nor contests; the same squad on foot does both`, () => {
      // Holds: side 0 aboard, alone in the zone, 120 ticks.
      const holds = airWorld(true);
      const a = aboard(holds, holds.helo, 0);
      settle(holds, a.car, how);
      holds.step(FIVE_S + 20);
      expect(holds.hold(), 'aboard, alone').toBe(0);
      // Contests: a ground raider of side 0 holds the flag while side 1's squad rides the aircraft in it.
      const contests = airWorld(true);
      contests.put(contests.squad, 0, 31, 5);
      const b = aboard(contests, contests.helo, 1);
      settle(contests, b.car, how);
      contests.step(FIVE_S);
      expect(contests.status(), 'aboard enemy').toBe('complete');
      // The same two squads on foot: the first holds alone, the second contests.
      const onFoot = airWorld(true);
      onFoot.put(onFoot.squad, 0, 32, 6);
      onFoot.step(FIVE_S);
      expect(onFoot.status(), 'on foot, alone').toBe('complete');
      const foe = airWorld(true);
      foe.put(foe.squad, 0, 31, 5);
      foe.put(foe.squad, 1, 32, 6);
      foe.put(foe.squad, 1, 33, 6);
      foe.step(FIVE_S + 40);
      expect(foe.hold(), 'on foot, contested').toBe(0);
    });
  }

  it('a squad inside a GROUND vehicle keeps today\'s rule: it holds, and it contests', () => {
    // The riders must be the ONLY thing that counts, or an over-broad skip (every carried unit) could not show: so the jeep
    // itself is written as buried (tunnelIn >= 0, which livingIn and enemyNear skip), leaving its riders, who still ride
    // its tile, as the one thing standing on the flag. The jeep is parked, so nothing else reads the column.
    const holds = airWorld(true);
    const car = aboard(holds, holds.jeep, 0);
    holds.sim.state.tunnelIn[car.car] = 0;
    holds.step(FIVE_S);
    expect(holds.sim.state.carriedBy[car.riders[0]]).toBe(car.car);
    expect(holds.status(), 'a rider of a ground vehicle still holds').toBe('complete');
    const contests = airWorld(true);
    contests.put(contests.squad, 0, 31, 5);
    const foe = aboard(contests, contests.jeep, 1);
    contests.sim.state.tunnelIn[foe.car] = 0;
    contests.step(FIVE_S + 40);
    expect(contests.sim.state.carriedBy[foe.riders[0]]).toBe(foe.car);
    expect(contests.hold(), 'a rider of a ground vehicle still contests').toBe(0);
    expect(contests.status()).toBe('active');
  });
});

describe('the bell wait: a flag objective scores nothing until the set-up ends (GH-976 R0.7)', () => {
  function bellWorld(untilTick: number | null) {
    const w = airWorld(true);
    if (untilTick !== null) w.sim.beginSetup({ untilTick, region: new Int8Array(40 * 20) });
    w.put(w.squad, 0, 32, 6); // standing on the flag from tick 0
    return w;
  }

  it('holdTicks is 0 until the bell and counts from it: bell at 100, so tick 100 is the first counted', () => {
    const w = bellWorld(100);
    w.step(99);
    expect(w.sim.setupActive).toBe(true);
    expect(w.hold()).toBe(0);
    w.step(1);
    expect(w.sim.setupActive).toBe(false);
    expect(w.hold()).toBe(1); // tick 100: the first tick after the bell clock ran out
    w.step(9);
    expect(w.hold()).toBe(10);
    expect(w.status()).toBe('active');
  });

  it('with the early bell the count starts at the early bell, and a room with no set-up counts from tick 1 as before', () => {
    const early = bellWorld(1000);
    early.sim.queueCommand({ kind: 'setupReady', side: 0 });
    early.sim.queueCommand({ kind: 'setupReady', side: 1 });
    early.step(1); // both ready on tick 0's commands: the bell is at 0 + 100
    expect(early.sim.setupBellTick).toBe(100);
    early.step(98);
    expect(early.hold()).toBe(0);
    early.step(5);
    expect(early.hold()).toBe(5); // 104 ticks run: the counted ones are tickCount 100, 101, 102, 103 and 104
    const none = bellWorld(null);
    none.step(10);
    expect(none.hold()).toBe(10);
  });
});
