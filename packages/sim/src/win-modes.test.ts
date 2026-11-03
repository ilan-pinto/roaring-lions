// GH-976 P1: the goals-only runtime of a versus WIN-MODE room -- the objective `side`, the `score` (points race)
// objective and the camp `raze`. Every number here is an integer the runtime must produce exactly: a score is
// held in 1/1200ths of a point and a minute is 1200 ticks, so 60 points a minute for a minute is 60 points.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { MissionRuntime, type MissionContext, type MissionEvent, type MissionJson, type ObjectiveJson } from './mission';
import { Sim, type UnitTypeJson } from './sim';

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
