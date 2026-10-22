// N3 Task 3: a runtime in a two-seat room. Two sim facts the versus economy rests on, each
// from literals (as production-runtime.test.ts builds its world); reads no shipped JSON.
//  - A mission with NO objectives never ends by itself (`checkEnd`'s guard, P-9): production
//    spawns into `playerIds` and a room's placed force does not, so without the guard the
//    runtime ended as a wipe the tick its last BUILT unit died, and income and production
//    stopped for good.
//  - `unitLost` is a human's loss: side 0's, and side 1's only when a human holds side 1.
// N3 Task 4: `applyQueued` runs a production command on its own side when a human holds that
// side, and refuses `support`, `raiseWorks` and `cancelWorks` from any side but 0.
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
function world(o: { objectives?: MissionJson['objectives']; humanHeld?: readonly [boolean, boolean]; sideOneCamp?: boolean } = {}) {
  const sim = new Sim({ seed: 7, width: 40, height: 12, capacity: 64, ...(o.humanHeld ? { humanHeld: o.humanHeld } : {}) });
  const t = sim.addUnitType(SQUAD);
  sim.addStructureType(CAMP);
  const placed = sim.spawn(t, 0, fx.from(21), fx.from(9));
  const mission: MissionJson = {
    id: 'n3_seats', map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: o.objectives ?? [],
    // Task 4: a side-1 camp at (30,3), its line 0 (`side` overrides `produces_for`).
    structures: [{ type: 'camp', at: [10, 3], size: [2, 2] }, ...(o.sideOneCamp ? [{ type: 'camp', at: [30, 3], size: [2, 2], side: 1 }] : [])],
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

describe('side 1 builds through its own lines when a human holds it (N3 Task 4)', () => {
  const BOTH = [true, true] as const;
  const RX = fx.from(33.5);
  const RY = fx.from(6.5);
  /** Side 0 and side 1 each queue one squad on their own line 0 by the command path. */
  const bothBuilding = () => {
    const w = world({ humanHeld: BOTH, sideOneCamp: true });
    w.sim.queueCommand({ kind: 'build', side: 0, unit: 'n3_squad', line: 0 });
    w.sim.queueCommand({ kind: 'build', side: 1, unit: 'n3_squad', line: 0 });
    expect(w.rt.applyQueued()).toBe(2);
    return w;
  };
  const line = (w: ReturnType<typeof world>, side: 0 | 1) => w.rt.productionLines(side)[0];

  it('build{side:1} spends purse[1] and queues on productionLines(1)[0]; side 0 is untouched', () => {
    const w = world({ humanHeld: BOTH, sideOneCamp: true });
    w.sim.queueCommand({ kind: 'build', side: 1, unit: 'n3_squad', line: 0 });
    expect(w.rt.applyQueued()).toBe(1);
    expect([w.rt.logisticsOf(1), w.rt.logisticsOf(0)]).toEqual([900, 1200]);
    expect(line(w, 1).current).toBe('n3_squad');
    expect(line(w, 0).current).toBe(null);
  });

  it('cancelBuild{side:1} refunds side 1, not side 0 (Review Focus 1)', () => {
    const w = bothBuilding();
    expect([w.rt.logisticsOf(0), w.rt.logisticsOf(1)]).toEqual([900, 900]);
    w.sim.queueCommand({ kind: 'cancelBuild', side: 1, line: 0, index: -1 });
    expect(w.rt.applyQueued()).toBe(1);
    expect([w.rt.logisticsOf(0), w.rt.logisticsOf(1)]).toEqual([900, 1200]);
    expect([line(w, 0).current, line(w, 1).current]).toEqual(['n3_squad', null]);
  });

  it('setRally{side:1} and clearRally{side:1} act on side 1\'s line alone', () => {
    const w = world({ humanHeld: BOTH, sideOneCamp: true });
    w.sim.queueCommand({ kind: 'setRally', side: 1, line: 0, x: RX, y: RY });
    expect(w.rt.applyQueued()).toBe(1);
    expect([line(w, 1).rally, line(w, 0).rally]).toEqual([[RX, RY], null]);
    w.sim.queueCommand({ kind: 'setRally', side: 0, line: 0, x: RX, y: RY });
    w.sim.queueCommand({ kind: 'clearRally', side: 1, line: 0 });
    expect(w.rt.applyQueued()).toBe(2);
    expect([line(w, 1).rally, line(w, 0).rally]).toEqual([null, [RX, RY]]);
  });

  it('a side outside 0 and 1 is refused (isHumanHeld holds only 0 and 1; the narrowing backs it)', () => {
    const w = world({ humanHeld: BOTH, sideOneCamp: true });
    for (const side of [2, -1, 0.5]) w.sim.queueCommand({ kind: 'build', side, unit: 'n3_squad', line: 0 });
    expect(w.rt.applyQueued()).toBe(0);
    expect([w.rt.logisticsOf(0), w.rt.logisticsOf(1)]).toEqual([1200, 1200]);
  });

  it('under the default table (single-player) every side-1 kind is refused; side 1 keeps its purse and lines', () => {
    const w = world({ sideOneCamp: true });
    w.sim.queueCommand({ kind: 'build', side: 1, unit: 'n3_squad', line: 0 });
    w.sim.queueCommand({ kind: 'setRally', side: 1, line: 0, x: RX, y: RY });
    w.sim.queueCommand({ kind: 'clearRally', side: 1, line: 0 });
    w.sim.queueCommand({ kind: 'cancelBuild', side: 1, line: 0, index: -1 });
    expect(w.rt.applyQueued()).toBe(0);
    expect(w.rt.logisticsOf(1)).toBe(1200);
    expect([line(w, 1).current, line(w, 1).rally]).toEqual([null, null]);
    // Control: the same build for side 0 lands, so the refusal is the side's.
    w.sim.queueCommand({ kind: 'build', side: 0, unit: 'n3_squad', line: 0 });
    expect(w.rt.applyQueued()).toBe(1);
  });
});

// The three runtime kinds with no side parameter. Each acts for side 0 when it runs, so without
// `applyQueued`'s explicit refusal a side-1 seat would spend side 0's intel and logistics and take
// down side 0's works. A literal fixture: a 20 x 12 map, a 2x2 outpost at 350 logistics, a side-0
// engineer at (7,5) beside the pad (8,5), side 0 at 1000 logistics and 400 intel.
describe('support, raiseWorks and cancelWorks refuse side 1 (N3 Task 4, LD5)', () => {
  const ENGINEER: UnitTypeJson = {
    id: 'n3_engineer', role: 'engineer', abilities: ['construct'],
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 6, signature: 0.6 }, weapons: [],
  };
  const OUTPOST = {
    id: 'n3_outpost', name: 'Outpost', hp_per_tile: 200, owner: 0,
    buildable: { cost: { logistics: 350 }, build_time_s: 20, footprint: [2, 2] },
  };
  const works = () => {
    const sim = new Sim({ seed: 0x4e33, width: 20, height: 12, capacity: 32, humanHeld: [true, true] });
    const eng = sim.addUnitType(ENGINEER);
    const enemy = sim.addUnitType(SQUAD);
    sim.addStructureType(OUTPOST);
    const mission: MissionJson = {
      id: 'n3_works', map: { file: 'none' }, ledger: { requires: [], produces: [] },
      objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
      starting_force: [{ unit: 'n3_engineer', count: 1, at: [7, 5] }],
      enemy: { garrison: [{ unit: 'n3_squad', count: 1, at: [19, 0] }] },
      resources: { logistics_start: 1000, intel_start: 400 },
      field_works: { n3_outpost: 1 },
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => (u === 'n3_engineer' ? eng : enemy), markers: {}, zones: {},
    });
    rt.start();
    const step = (n: number): void => { for (let i = 0; i < n; i++) rt.step(sim.tick()); };
    return { sim, rt, step };
  };

  it('support{side:1} is refused; side 0\'s intel is untouched (control: side 0 is charged)', () => {
    const w = works();
    w.sim.queueCommand({ kind: 'support', side: 1, support: 'drone_sweep', x: fx.from(10), y: fx.from(5) });
    expect(w.rt.applyQueued()).toBe(0);
    expect(w.rt.intel).toBe(400);
    w.sim.queueCommand({ kind: 'support', side: 0, support: 'drone_sweep', x: fx.from(10), y: fx.from(5) });
    expect(w.rt.applyQueued()).toBe(1);
    expect(w.rt.intel).toBeLessThan(400);
  });

  it('raiseWorks{side:1} is refused; side 0\'s purse and works are untouched (control: side 0 raises)', () => {
    const w = works();
    w.sim.queueCommand({ kind: 'raiseWorks', side: 1, works: 'n3_outpost', x: 8, y: 5, ids: [] });
    expect(w.rt.applyQueued()).toBe(0);
    w.step(3);
    expect([w.rt.logisticsOf(0), w.sim.works.alive.filter((a) => a !== 0).length]).toEqual([1000, 0]);
    w.sim.queueCommand({ kind: 'raiseWorks', side: 0, works: 'n3_outpost', x: 8, y: 5, ids: [] });
    expect(w.rt.applyQueued()).toBe(1);
    expect(w.rt.logisticsOf(0)).toBe(650);
  });

  it('cancelWorks{side:1} is refused; side 0\'s site stands and its purse keeps the charge', () => {
    const w = works();
    expect(w.rt.requestConstruct('n3_outpost', 8, 5)).toBe(true);
    w.step(3);
    expect(w.sim.works.alive[0]).toBe(1);
    w.sim.queueCommand({ kind: 'cancelWorks', side: 1, site: 0 });
    expect(w.rt.applyQueued()).toBe(0);
    w.step(3);
    expect([w.sim.works.alive[0], w.rt.logisticsOf(0)]).toEqual([1, 650]);
    // Control: side 0's own cancel takes it down and refunds.
    w.sim.queueCommand({ kind: 'cancelWorks', side: 0, site: 0 });
    expect(w.rt.applyQueued()).toBe(1);
    w.step(3);
    expect(w.sim.works.alive[0]).toBe(0);
    expect(w.rt.logisticsOf(0)).toBeGreaterThan(650);
  });
});
