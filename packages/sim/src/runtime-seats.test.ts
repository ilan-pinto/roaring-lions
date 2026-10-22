// N3 Task 3: a runtime in a two-seat room. Two sim facts the versus economy rests on, each
// from literals (as production-runtime.test.ts builds its world); reads no shipped JSON.
//  - A mission with NO objectives never ends by itself (`checkEnd`'s guard, P-9): production
//    spawns into `playerIds` and a room's placed force does not, so without the guard the
//    runtime ended as a wipe the tick its last BUILT unit died, and income and production
//    stopped for good.
//  - `unitLost` is a human's loss: side 0's, and side 1's only when a human holds side 1.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { MissionRuntime, type MissionEvent, type MissionJson } from './mission';

const SQUAD: UnitTypeJson = {
  id: 'n3_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [{ id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 1, suppression: 0, rof_per_min: 300 }],
};
const CAMP = { id: 'camp', name: 'Field Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 0 };

/** A 40 x 12 map, one side-0 camp at (10,3), one income zone `ridge` (20,8 4x3) at 60/min, and
 *  one side-0 unit PLACED in it before the runtime exists (a room's force: not in `playerIds`).
 *  `n3_squad` costs 300 and builds in 2 s. */
function world(o: { objectives?: MissionJson['objectives']; humanHeld?: readonly [boolean, boolean] } = {}) {
  const sim = new Sim({ seed: 7, width: 40, height: 12, capacity: 64, ...(o.humanHeld ? { humanHeld: o.humanHeld } : {}) });
  const t = sim.addUnitType(SQUAD);
  sim.addStructureType(CAMP);
  const placed = sim.spawn(t, 0, fx.from(21), fx.from(9));
  const mission: MissionJson = {
    id: 'n3_seats', map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: o.objectives ?? [],
    structures: [{ type: 'camp', at: [10, 3], size: [2, 2] }],
    resources: { income_zones: [{ zone: 'ridge', rate_per_min: 60 }] },
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: () => t, markers: {}, zones: { ridge: [20, 8, 4, 3] },
    economy: { logisticsStart: [1200, 1200], logisticsRatePerMin: [0, 0] },
    unitInfo: (u) => (u === 'n3_squad' ? { logistics: 300, buildTimeS: 2, population: 1 } : null),
  });
  rt.start();
  const events: MissionEvent[] = [];
  let lastStep: MissionEvent[] = [];
  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      lastStep = rt.step(sim.tick());
      events.push(...lastStep);
    }
  };
  // Every entity after the runtime's start is a built one (the test spawns none but the enemy).
  const first = sim.entityCount;
  const builtIds = (): number[] => {
    const ids: number[] = [];
    for (let i = first; i < sim.entityCount; i++) if (sim.state.side[i] === 0) ids.push(i);
    return ids;
  };
  return { sim, rt, t, placed, step, events, builtIds, last: () => lastStep };
}

describe('a runtime with no objectives never ends by itself (N3 Task 3, P-9)', () => {
  it('build and lose: the built unit dies, the placed one lives, and the runtime keeps paying and producing', () => {
    const w = world();
    w.step(5);
    expect(w.rt.requestBuild('n3_squad', 0, 0)).toBe(true);
    w.step(60);
    const built = w.builtIds();
    expect(built).toHaveLength(1);
    w.sim.debugKill(built[0]);
    w.step(1);
    // Without the guard: the only `playerIds` entry is dead, `wiped` holds, and this is 'defeat'.
    expect(w.rt.result).toBe('ongoing');
    expect(w.events.some((e) => e.kind === 'missionEnd')).toBe(false);
    // The placed unit, never in `playerIds`, still stands in the zone.
    expect(w.sim.state.alive[w.placed]).toBe(1);
    // `step` still runs: the purse still accrues from the held zone ...
    const purse = w.rt.logisticsOf(0);
    w.step(1200);
    expect(w.rt.logisticsOf(0)).toBeGreaterThan(purse);
    // ... and a second build starts and finishes.
    expect(w.rt.requestBuild('n3_squad', 0, 0)).toBe(true);
    w.step(60);
    expect(w.builtIds()).toHaveLength(2);
    expect(w.events.filter((e) => e.kind === 'built')).toHaveLength(2);
    expect(w.rt.result).toBe('ongoing');
  });

  it('control: the same loss with an objective still ends the mission as a wipe (single-player unchanged)', () => {
    const w = world({ objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }] });
    w.step(5);
    expect(w.rt.requestBuild('n3_squad', 0, 0)).toBe(true);
    w.step(60);
    w.sim.debugKill(w.builtIds()[0]);
    w.step(1);
    expect(w.rt.result).toBe('defeat');
    expect(w.last().some((e) => e.kind === 'missionEnd')).toBe(true);
  });
});

describe('unitLost follows who holds the side (N3 Task 3)', () => {
  const lostFor = (humanHeld: readonly [boolean, boolean] | undefined) => {
    const w = world({ humanHeld });
    const enemy = w.sim.spawn(w.t, 1, fx.from(35), fx.from(2));
    w.step(1);
    w.sim.debugKill(enemy);
    w.sim.debugKill(w.placed);
    w.step(1);
    return w.events
      .flatMap((e) => (e.kind === 'unitLost' ? [[e.entity, e.side]] : []))
      .sort((a, b) => a[0] - b[0]);
  };

  it('with both seats human-held, a side-1 death emits unitLost with side 1', () => {
    const w = world({ humanHeld: [true, true] });
    const enemy = w.sim.spawn(w.t, 1, fx.from(35), fx.from(2));
    expect(lostFor([true, true])).toEqual([[w.placed, 0], [enemy, 1]]);
  });

  it('with the default table (single-player) a side-1 death emits nothing; side 0 is unchanged', () => {
    const w = world();
    expect(lostFor(undefined)).toEqual([[w.placed, 0]]);
  });
});
