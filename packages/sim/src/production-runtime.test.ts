// F4 Task 3: production lines in MissionRuntime, serial, keyed by side. Builds its own runtime
// from literals (as runtime-commands.test.ts does); reads no shipped JSON.
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { MissionRuntime, type MissionEvent, type MissionJson } from './mission';

const SQUAD: UnitTypeJson = {
  id: 'n2_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [{ id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 1, suppression: 0, rof_per_min: 300 }],
};
const DRONE: UnitTypeJson = {
  id: 'n4_drone', role: 'recon',
  hull: { hp: 100, armor: { front: 1, side: 1, rear: 1 } },
  mobility: { speed_tiles_s: 3, domain: 'air' }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const CAMP = { id: 'camp', name: 'Field Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 0 };
const CAMP_S1 = { id: 'camp_s1', name: 'Enemy Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 1 };

interface Opts {
  camps?: readonly (readonly [number, number])[];
  /** Camps raised on the sim before the runtime exists, as a map-grid `c` tile would be. */
  gridCamps?: readonly (readonly [number, number])[];
  campsS1?: readonly (readonly [number, number])[];
  /** F4 Task 7: `camp` (a TYPE that produces for side 0) placed with `side: 1`. */
  sided?: readonly (readonly [number, number])[];
  playerStart?: boolean;
  start?: readonly [number, number];
  popCaps?: readonly [number | null, number | null];
  intelCost?: number;
}

/** A 40 x 12 map; `n2_squad` costs 300 and builds in 2 s = 40 ticks, population 1, for either side. */
function world(o: Opts = {}) {
  const sim = new Sim({ seed: 11, width: 40, height: 12, capacity: 64 });
  const t = sim.addUnitType(SQUAD);
  const drone = sim.addUnitType(DRONE);
  sim.addStructureType(CAMP);
  sim.addStructureType(CAMP_S1);
  for (const [gx, gy] of o.gridCamps ?? []) {
    sim.addStructure(0, [gy * 40 + gx, gy * 40 + gx + 1, (gy + 1) * 40 + gx, (gy + 1) * 40 + gx + 1]);
  }
  const camps = o.camps ?? (o.gridCamps !== undefined ? [] : [[10, 3]]);
  const campsS1 = o.campsS1 ?? [];
  const asked: [string, number][] = [];
  const mission: MissionJson = {
    id: 'f4_lines', map: { file: 'none', ...(o.playerStart === false ? {} : { player_start: [3, 5] }) },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    starting_force: [{ unit: 'n2_squad', count: 1, at: [3, 8] }],
    structures: [
      ...camps.map(([x, y]) => ({ type: 'camp', at: [x, y], size: [2, 2] })),
      ...campsS1.map(([x, y]) => ({ type: 'camp_s1', at: [x, y], size: [2, 2] })),
      ...(o.sided ?? []).map(([x, y]) => ({ type: 'camp', at: [x, y], size: [2, 2], side: 1 as const })),
    ],
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: () => t, markers: {}, zones: {},
    economy: { logisticsStart: o.start ?? [1200, 1200], logisticsRatePerMin: [0, 0] },
    ...(o.popCaps !== undefined ? { popCaps: o.popCaps } : {}),
    unitInfo: (u, side) => {
      asked.push([u, side]);
      if (u === 'n2_squad') return { logistics: 300, buildTimeS: 2, population: 1 };
      if (u === 'n2_intel') return { logistics: 300, intel: o.intelCost ?? 10, buildTimeS: 2, population: 1 };
      return null;
    },
  });
  rt.start();
  const events: MissionEvent[] = [];
  const step = (n: number): void => { for (let i = 0; i < n; i++) events.push(...rt.step(sim.tick())); };
  const built = () => events.filter((e) => e.kind === 'built');
  const builtTicks = () => built().map((e) => e.tick);
  const campIdx: number[] = [];
  for (let i = 0; i < sim.structureCount; i++) campIdx.push(i);
  return { sim, rt, step, events, built, builtTicks, asked, campIdx, t, drone };
}

const pos = (w: ReturnType<typeof world>, id: number): [number, number] =>
  [fx.toNumber(w.sim.state.posX[id]), fx.toNumber(w.sim.state.posY[id])];
const dist = (a: readonly [number, number], b: readonly [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('production lines in the runtime (F4 Task 3)', () => {
  it('two builds queued in one tick deploy one build time apart', () => {
    const w = world();
    w.step(10);
    expect(w.rt.requestBuild('n2_squad')).toBe(true);
    expect(w.rt.requestBuild('n2_squad')).toBe(true);
    w.step(100);
    expect(w.builtTicks()).toEqual([50, 90]);
  });

  it('two camps are two lines', () => {
    const w = world({ camps: [[10, 3], [10, 8]] });
    w.step(10);
    expect(w.rt.requestBuild('n2_squad', 0)).toBe(true);
    expect(w.rt.requestBuild('n2_squad', 1)).toBe(true);
    const before = w.sim.entityCount;
    w.step(40);
    expect(w.builtTicks()).toEqual([50, 50]);
    const lines = w.rt.productionLines(0);
    expect(lines).toHaveLength(2);
    const [e0, e1] = [lines[0].exit, lines[1].exit];
    expect(e0).not.toEqual(e1);
    const exit = (s: number): [number, number] => {
      const e = w.sim.structureExit(s);
      return [fx.toNumber(e[0]), fx.toNumber(e[1])];
    };
    expect(w.sim.entityCount).toBe(before + 2);
    expect(dist(pos(w, before), exit(lines[0].anchor))).toBeLessThan(1.5);
    expect(dist(pos(w, before + 1), exit(lines[1].anchor))).toBeLessThan(1.5);
    expect(dist(exit(lines[0].anchor), exit(lines[1].anchor))).toBeGreaterThan(3);
  });

  it('D6: three builds with no line named go to lines [0, 1, 0]', () => {
    const w = world({ camps: [[10, 3], [10, 8]] });
    w.step(10);
    for (let i = 0; i < 3; i++) expect(w.rt.requestBuild('n2_squad')).toBe(true);
    const lines = w.rt.productionLines(0);
    expect(lines.map((l) => l.queued + (l.current !== null ? 1 : 0))).toEqual([2, 1]);
  });

  it('a mission with no camp builds at player_start, serially (D2)', () => {
    const w = world({ camps: [] });
    w.step(10);
    w.rt.requestBuild('n2_squad');
    w.rt.requestBuild('n2_squad');
    const before = w.sim.entityCount;
    w.step(100);
    expect(w.builtTicks()).toEqual([50, 90]);
    expect(dist(pos(w, before), [3, 5])).toBeLessThan(2);
    expect(dist(pos(w, before + 1), [3, 5])).toBeLessThan(2);
    expect(w.rt.productionLines(0)).toHaveLength(1);
    expect(w.rt.productionLines(0)[0].anchor).toBe(-1);
  });

  it('D4: a camp that dies loses its line -- the item in progress is lost, the queued one refunded', () => {
    const w = world();
    w.step(10);
    w.rt.requestBuild('n2_squad');
    w.rt.requestBuild('n2_squad');
    expect(w.rt.logisticsOf(0)).toBe(600);
    w.step(20);
    w.sim.debugDestroyStructure(w.campIdx[0]);
    w.step(100);
    expect(w.built()).toEqual([]);
    expect(w.rt.logisticsOf(0)).toBe(900);
    expect(w.rt.production).toEqual([]);
    expect(w.rt.buildBlockedReason('n2_squad')).toBe('field camp destroyed — no production');
  });

  it('a map-grid camp that dies with player_start authored refuses canBuild, as requestBuild does', () => {
    const w = world({ gridCamps: [[10, 3]] });
    w.step(10);
    expect(w.rt.canBuild('n2_squad')).toBe(true);
    w.sim.debugDestroyStructure(0);
    w.step(2);
    expect(w.rt.canBuild('n2_squad')).toBe(false);
    expect(w.rt.buildBlockedReason('n2_squad')).toBe('field camp destroyed — no production');
    expect(w.rt.requestBuild('n2_squad')).toBe(false);
  });

  it('the camp dies on its item\'s finishing tick: nothing is delivered', () => {
    const w = world();
    w.step(10);
    w.rt.requestBuild('n2_squad');
    w.step(39); // tick 49: the item finishes on the next step, tick 50
    w.sim.debugDestroyStructure(w.campIdx[0]);
    w.step(5);
    expect(w.built()).toEqual([]);
    expect(w.rt.logisticsOf(0)).toBe(900); // the item in progress is lost, not refunded
  });

  it('a dead camp\'s line keeps its index', () => {
    const w = world({ camps: [[10, 3], [10, 8]] });
    w.step(10);
    expect(w.rt.requestBuild('n2_squad', 0)).toBe(true);
    expect(w.rt.requestBuild('n2_squad', 1)).toBe(true);
    w.step(20);
    w.sim.debugDestroyStructure(w.rt.productionLines(0)[0].anchor);
    w.step(1);
    const lines = w.rt.productionLines(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ current: null, queued: 0 });
    expect(lines[1].current).toBe('n2_squad');
    // The verbs naming the dead line refuse; an unnamed build skips it.
    expect(w.rt.requestBuild('n2_squad', 0)).toBe(false);
    expect(w.rt.canBuild('n2_squad', 0)).toBe(false);
    expect(w.rt.cancelBuild(0, -1)).toBe(false);
    expect(w.rt.setRally(0, fx.from(20), fx.from(5))).toBe(false);
    expect(w.rt.requestBuild('n2_squad')).toBe(true);
    expect(w.rt.productionLines(0)[1].queued).toBe(1);
    w.step(100);
    expect(w.builtTicks()).toEqual([50, 90]);
    expect(w.rt.productionLines(0)).toHaveLength(2);
  });

  it('Review Focus 2: a cancel on the camp that died this tick is refused; the refund is paid once', () => {
    const w = world();
    w.step(10);
    w.rt.requestBuild('n2_squad');
    w.rt.requestBuild('n2_squad');
    w.step(20);
    w.sim.debugDestroyStructure(w.campIdx[0]);
    expect(w.rt.cancelBuild(0, 0)).toBe(false);
    w.step(1);
    expect(w.rt.logisticsOf(0)).toBe(900);
  });

  it('a side-1 camp death refunds purse[1]', () => {
    const w = world({ campsS1: [[30, 5]] });
    w.step(10);
    w.rt.requestBuild('n2_squad', undefined, 1);
    w.rt.requestBuild('n2_squad', undefined, 1);
    expect([w.rt.logisticsOf(0), w.rt.logisticsOf(1)]).toEqual([1200, 600]);
    w.step(5);
    w.sim.debugDestroyStructure(w.campIdx[w.campIdx.length - 1]);
    w.step(5);
    expect([w.rt.logisticsOf(0), w.rt.logisticsOf(1)]).toEqual([1200, 900]);
  });

  it('LD6 asks 1-3: a side-1 build spends purse[1], is asked of unitInfo with side 1, and `built` carries it', () => {
    const w = world({ campsS1: [[30, 5]] });
    w.step(10);
    expect(w.rt.requestBuild('n2_squad', undefined, 1)).toBe(true);
    expect([w.rt.logisticsOf(0), w.rt.logisticsOf(1)]).toEqual([1200, 900]);
    expect(w.asked).toContainEqual(['n2_squad', 1]);
    w.step(100);
    expect(w.built()).toEqual([{ kind: 'built', tick: 50, unit: 'n2_squad', side: 1 }]);
    expect(w.rt.productionOf(0)).toEqual([]);
  });

  it('a side-1 build with no side-1 camp is refused, even with player_start authored', () => {
    const w = world();
    expect(w.rt.requestBuild('n2_squad', undefined, 1)).toBe(false);
    expect(w.rt.buildBlockedReason('n2_squad', 1)).toBe('no field camp — production needs one standing');
    expect(w.rt.logisticsOf(1)).toBe(1200);
  });

  it('a side-1 camp that dies refuses with the one side-1 string, never "destroyed"', () => {
    const w = world({ campsS1: [[30, 5]] });
    w.step(10);
    w.sim.debugDestroyStructure(w.campIdx[w.campIdx.length - 1]);
    w.step(2);
    expect(w.rt.buildBlockedReason('n2_squad', 1)).toBe('no field camp — production needs one standing');
    expect(w.rt.canBuild('n2_squad', undefined, 1)).toBe(false);
  });

  it('a side-1 item that costs intel is refused: intel is side 0\'s', () => {
    const w = world({ campsS1: [[30, 5]] });
    expect(w.rt.requestBuild('n2_intel', undefined, 1)).toBe(false);
    expect(w.rt.buildBlockedReason('n2_intel', 1)).toBe('not available in the field');
    expect(w.rt.logisticsOf(1)).toBe(1200);
    expect(w.rt.canBuild('n2_intel', undefined, 1)).toBe(false);
  });

  it('popCaps [null, 1]: the cap binds side 1 and counts only side 1\'s lines', () => {
    const w = world({ campsS1: [[30, 5]], popCaps: [null, 1] });
    expect(w.rt.requestBuild('n2_squad')).toBe(true); // side 0 first: must not count against side 1
    expect(w.rt.requestBuild('n2_squad', undefined, 1)).toBe(true);
    expect(w.rt.requestBuild('n2_squad', undefined, 1)).toBe(false);
    expect(w.rt.buildBlockedReason('n2_squad', 1)).toBe('population cap reached (1/1)');
    expect(w.rt.popCapped('n2_squad', 1)).toBe(true);
    expect(w.rt.populationView(1)).toEqual({ used: 1, cap: 1 });
    expect(w.rt.populationView(0)).toBeNull();
    expect(w.rt.popCapped('n2_squad')).toBe(false);
  });

  it('canBuild agrees with requestBuild on side 1: funded, unfunded, capped', () => {
    const agree = (o: Opts, before = 0): [boolean, boolean] => {
      const w = world({ campsS1: [[30, 5]], ...o });
      for (let i = 0; i < before; i++) w.rt.requestBuild('n2_squad', undefined, 1);
      return [w.rt.canBuild('n2_squad', undefined, 1), w.rt.requestBuild('n2_squad', undefined, 1)];
    };
    expect(agree({})).toEqual([true, true]);
    expect(agree({ start: [1200, 100] })).toEqual([false, false]);
    expect(agree({ popCaps: [null, 1] }, 1)).toEqual([false, false]);
    const one = world({ campsS1: [[30, 5]] });
    expect(one.rt.canBuild('n2_squad', 1, 1)).toBe(false);
  });

  it('F3: the cap and its reservation bind across lines (one pool per side)', () => {
    const w = world({ camps: [[10, 3], [10, 8]], popCaps: [3, null] });
    // The starting squad is 1; two lines, three builds: the third would make 4.
    expect(w.rt.requestBuild('n2_squad')).toBe(true);
    expect(w.rt.requestBuild('n2_squad')).toBe(true);
    expect(w.rt.requestBuild('n2_squad')).toBe(false);
    expect(w.rt.buildBlockedReason('n2_squad')).toBe('population cap reached (3/3)');
  });

  it('cancelBuild refunds exactly, and refuses what is not there', () => {
    for (const side of [0, 1] as const) {
      const w = world({ campsS1: [[30, 5]] });
      const l = (): number => w.rt.logisticsOf(side);
      expect(w.rt.requestBuild('n2_squad', undefined, side)).toBe(true);
      expect(l()).toBe(900);
      expect(w.rt.cancelBuild(0, -1, side)).toBe(true);
      expect(l()).toBe(1200);
    }
    const w = world();
    w.rt.requestBuild('n2_squad');
    w.rt.requestBuild('n2_squad');
    const hash = w.rt.economyHash();
    expect(w.rt.cancelBuild(0, 5)).toBe(false);
    expect(w.rt.cancelBuild(3, -1)).toBe(false);
    expect(w.rt.cancelBuild(0, 1.5)).toBe(false);
    expect(w.rt.economyHash()).toBe(hash);
    expect(w.rt.logisticsOf(0)).toBe(600);
  });

  it('the queue bound: 1 in progress + 16 waiting, the 18th is refused, canBuild agrees', () => {
    const w = world({ start: [100000, 0] });
    const results: boolean[] = [];
    const agreed: boolean[] = [];
    for (let i = 0; i < 18; i++) {
      const can = w.rt.canBuild('n2_squad');
      const did = w.rt.requestBuild('n2_squad');
      agreed.push(can === did);
      results.push(did);
    }
    expect(results.filter(Boolean)).toHaveLength(17);
    expect(results[17]).toBe(false);
    expect(agreed.every(Boolean)).toBe(true);
    expect(w.rt.buildBlockedReason('n2_squad')).toBe('production queue full (16)');
    // Named: only that line's bound counts.
    expect(w.rt.canBuild('n2_squad', 0)).toBe(false);
  });

  it('five side-0 camps throw at start()', () => {
    expect(() => world({ camps: [[4, 1], [8, 1], [12, 1], [16, 1], [20, 1]] })).toThrow(
      'mission f4_lines: 5 production structures for side 0, at most 4'
    );
  });

  it('a queued item is in production from the tick it is queued (GH-469)', () => {
    const w = world({ campsS1: [[30, 5]] });
    w.step(10);
    w.rt.requestBuild('n2_squad');
    w.rt.requestBuild('n2_squad');
    w.rt.requestBuild('n2_squad', undefined, 1);
    expect(w.rt.production).toEqual([
      { unit: 'n2_squad', doneTicks: 0, totalTicks: 40, ticksLeft: 40 },
      { unit: 'n2_squad', doneTicks: 0, totalTicks: 40, ticksLeft: 80 },
    ]);
    expect(w.rt.production).toEqual(w.rt.productionOf(0));
    expect(w.rt.productionOf(1)).toEqual([{ unit: 'n2_squad', doneTicks: 0, totalTicks: 40, ticksLeft: 40 }]);
    w.step(15);
    expect(w.rt.productionLines(0)[0]).toMatchObject({ current: 'n2_squad', queued: 1, progress: 375 });
  });
});

/** A unit of `side` standing `d` tiles east of line `k`'s exit (side 0's lines). */
function foeAt(w: ReturnType<typeof world>, type: number, side: number, d: number, k = 0, lineSide: 0 | 1 = 0): number {
  const e = w.rt.productionLines(lineSide)[k].exit;
  return w.sim.spawn(type, side, e[0] + fx.from(d), e[1]);
}

describe('no production while the camp is contested (F4 Task 4)', () => {
  const run = (d: number, mutate?: (w: ReturnType<typeof world>, id: number) => void, side = 1): number[] => {
    const w = world();
    const id = foeAt(w, side === 3 ? w.drone : w.t, side === 3 ? 1 : side, d);
    mutate?.(w, id);
    w.step(10);
    w.rt.requestBuild('n2_squad');
    w.step(60);
    return w.builtTicks();
  };

  it('a side-1 squad 5 tiles from the exit freezes the line; at 7 tiles it does not', () => {
    expect(run(5)).toEqual([]);
    expect(run(7)).toEqual([50]);
  });

  it('a buried squad (tunnelIn 0) contests nothing; tunnelIn -1 does', () => {
    expect(run(5, (w, id) => { w.sim.state.tunnelIn[id] = 0; })).toEqual([50]);
    expect(run(5, (w, id) => { w.sim.state.tunnelIn[id] = -1; })).toEqual([]);
  });

  it('a side-1 drone over the exit does not contest', () => {
    expect(run(0, undefined, 3)).toEqual([50]);
  });

  it('Review Focus 5 / ask 9: the mirror -- a side-1 line is contested by side 0, not by side 1 or a civilian', () => {
    const go = (foeSide: number): number[] => {
      const w = world({ camps: [], campsS1: [[10, 3]] });
      foeAt(w, w.t, foeSide, 5, 0, 1);
      w.step(10);
      expect(w.rt.requestBuild('n2_squad', 0, 1)).toBe(true);
      w.step(60);
      return w.builtTicks();
    };
    expect(go(1)).toEqual([50]);
    expect(go(0)).toEqual([]);
    expect(go(2)).toEqual([50]);
    // and a side-0 line is not contested by a civilian either
    expect(run(5, undefined, 2)).toEqual([50]);
  });

  it('a line frozen for 300 ticks finishes 300 ticks late, `built` carries the real tick, and `contested` reads true on exactly those ticks', () => {
    const w = world();
    const id = foeAt(w, w.t, 1, 5);
    w.step(10);
    w.rt.requestBuild('n2_squad');
    const flags: boolean[] = [];
    for (let i = 0; i < 300; i++) { w.step(1); flags.push(w.rt.productionLines(0)[0].contested); }
    expect(flags.every((f) => f)).toBe(true);
    expect(w.built()).toEqual([]);
    w.sim.debugKill(id);
    w.step(1);
    expect(w.rt.productionLines(0)[0].contested).toBe(false);
    w.step(60);
    expect(w.builtTicks()).toEqual([350]);
  });

  it('D2: the player_start line is contested by the same rule', () => {
    const w = world({ camps: [] });
    w.sim.spawn(w.t, 1, fx.from(8), fx.from(5));
    w.step(10);
    expect(w.rt.requestBuild('n2_squad')).toBe(true);
    w.step(60);
    expect(w.builtTicks()).toEqual([]);
    expect(w.rt.productionLines(0)[0].contested).toBe(true);
  });
});

describe('the rally point (F4 Task 5)', () => {
  const X = fx.from(20.5);
  const Y = fx.from(5.5);
  const at = (w: ReturnType<typeof world>, id: number) => pos(w, id);
  /** Build one squad at tick 10 on side 0's line 0 and return its entity id (spawned on tick 50). */
  const buildOne = (w: ReturnType<typeof world>): number => {
    w.step(10);
    const before = w.sim.entityCount;
    expect(w.rt.requestBuild('n2_squad')).toBe(true);
    w.step(40);
    expect(w.sim.entityCount).toBe(before + 1);
    return before;
  };

  it('a finished unit gets one no-sweep attackMove on its deploy tick and arrives', () => {
    const w = world();
    expect(w.rt.setRally(0, X, Y)).toBe(true);
    const spy = vi.spyOn(w.sim, 'queueCommand');
    const id = buildOne(w);
    expect(spy).toHaveBeenCalledTimes(1);
    const cmd = spy.mock.calls[0][0];
    expect(cmd).toEqual({ kind: 'attackMove', ids: [id], x: X, y: Y });
    expect('sweep' in cmd).toBe(false);
    w.step(400);
    expect(dist(at(w, id), [20.5, 5.5])).toBeLessThan(1.5);
  });

  it('with no rally point it stands at the exit and nothing is queued', () => {
    const w = world();
    const spy = vi.spyOn(w.sim, 'queueCommand');
    const id = buildOne(w);
    const exit = w.rt.productionLines(0)[0].exit;
    const e: [number, number] = [fx.toNumber(exit[0]), fx.toNumber(exit[1])];
    w.step(100);
    expect(spy).not.toHaveBeenCalled();
    expect(dist(at(w, id), e)).toBeLessThan(1.5);
  });

  it('a point on a blocked tile is refused, the previous one kept, and canSetRally agrees', () => {
    const w = world();
    expect(w.rt.setRally(0, X, Y)).toBe(true);
    const camp = w.rt.productionLines(0)[0];
    const bx = fx.from(10.5);
    const by = fx.from(3.5); // inside the 2x2 camp footprint
    expect(w.sim.blocked[3 * 40 + 10]).toBe(1);
    expect(w.rt.canSetRally(0, bx, by)).toBe(false);
    expect(w.rt.setRally(0, bx, by)).toBe(false);
    expect(w.rt.canSetRally(0, fx.from(-1), Y)).toBe(false);
    expect(w.rt.canSetRally(0, fx.from(40.5), Y)).toBe(false);
    expect(w.rt.canSetRally(0, X, Y)).toBe(true);
    expect(w.rt.canSetRally(5, X, Y)).toBe(false);
    expect(w.rt.productionLines(0)[0].rally).toEqual([X, Y]);
    expect(camp.anchor).toBeGreaterThanOrEqual(0);
  });

  it('a point set while an item is in progress applies to that item', () => {
    const w = world();
    w.step(10);
    w.rt.requestBuild('n2_squad');
    w.step(20);
    const id = w.sim.entityCount;
    expect(w.rt.setRally(0, X, Y)).toBe(true);
    w.step(20);
    w.step(400);
    expect(dist(at(w, id), [20.5, 5.5])).toBeLessThan(1.5);
  });

  it('side 1: its finished unit goes to its own point; a mission with no side-1 line refuses', () => {
    const w = world({ camps: [], campsS1: [[10, 3]] });
    expect(w.rt.setRally(0, X, Y, 1)).toBe(true);
    w.step(10);
    const id = w.sim.entityCount;
    expect(w.rt.requestBuild('n2_squad', 0, 1)).toBe(true);
    w.step(440);
    expect(dist(at(w, id), [20.5, 5.5])).toBeLessThan(1.5);
    const none = world();
    expect(none.rt.setRally(0, X, Y, 1)).toBe(false);
    expect(none.rt.canSetRally(0, X, Y, 1)).toBe(false);
    expect(none.rt.clearRally(0, 1)).toBe(false);
  });

  it('two items one build time apart land on two tiles, not one', () => {
    const w = world();
    w.rt.setRally(0, X, Y);
    w.step(10);
    const a = w.sim.entityCount;
    w.rt.requestBuild('n2_squad');
    w.rt.requestBuild('n2_squad');
    w.step(600);
    expect(dist(at(w, a), [20.5, 5.5])).toBeLessThan(2.5);
    expect(dist(at(w, a + 1), [20.5, 5.5])).toBeLessThan(2.5);
    expect(dist(at(w, a), at(w, a + 1))).toBeGreaterThan(0.4);
  });

  it('a foot unit with a rally point never drops at the exit (#402)', () => {
    const w = world();
    w.rt.setRally(0, X, Y);
    const id = buildOne(w);
    const exit = w.rt.productionLines(0)[0].exit;
    const e: [number, number] = [fx.toNumber(exit[0]), fx.toNumber(exit[1])];
    for (let i = 0; i < 40; i++) {
      w.step(1);
      expect(w.sim.state.brace[id]).toBe(0);
    }
    expect(dist(at(w, id), e)).toBeGreaterThan(1.5);
  });

  it('a rallied unit holds on arrival; the same order with sweep: true walks off', () => {
    const run = (sweep: boolean): number => {
      const w = world();
      // An identified enemy 7.5 tiles from the point: in sight (8), out of the rifles' reach (7).
      w.sim.spawn(w.t, 1, fx.from(28), Y);
      let id: number;
      if (sweep) {
        w.step(10);
        id = w.sim.spawn(w.t, 0, fx.from(9.5), fx.from(2.5));
        w.sim.queueCommand({ kind: 'attackMove', ids: [id], x: X, y: Y, sweep: true });
      } else {
        w.rt.setRally(0, X, Y);
        id = buildOne(w);
      }
      w.step(500); // ample time to arrive and then, for the control, to walk off
      return dist(at(w, id), [20.5, 5.5]);
    };
    expect(run(false)).toBeLessThan(0.3);
    expect(run(true)).toBeGreaterThan(1.5);
  });

  it('clearRally: the next unit stays at the exit, no attackMove queued, and the line reads null', () => {
    const w = world();
    w.rt.setRally(0, X, Y);
    expect(w.rt.clearRally(0)).toBe(true);
    expect(w.rt.productionLines(0)[0].rally).toBeNull();
    const spy = vi.spyOn(w.sim, 'queueCommand');
    buildOne(w);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('structures[].side overrides the type (F4 Task 7, R-F4-9)', () => {
  it('lines: a `camp` placed with side 1 is a side-1 line, and side 0 keeps only its player_start line', () => {
    const w = world({ camps: [], sided: [[30, 5]] });
    expect(w.rt.productionLines(1)).toHaveLength(1);
    expect(w.rt.productionLines(0)).toHaveLength(1);
    expect(w.rt.productionLines(0)[0].anchor).toBe(-1);
    expect(w.rt.productionLines(1)[0].anchor).toBe(0);
    expect(w.sim.structureProducesFor(0)).toBe(1);
  });

  it('the camp clause: side 1 can build, and side 0 reads as in a mission with no camp at all', () => {
    const w = world({ camps: [], sided: [[30, 5]] });
    const none = world({ camps: [] });
    expect(w.rt.buildBlockedReason('n2_squad', 1)).toBeNull();
    expect(none.rt.buildBlockedReason('n2_squad', 1)).toBe('no field camp — production needs one standing');
    expect(w.rt.buildBlockedReason('n2_squad')).toBe(none.rt.buildBlockedReason('n2_squad'));
    // The override camp is not side 0's: with no player_start its death must not matter to side 0.
    const bare = world({ camps: [], sided: [[30, 5]], playerStart: false });
    expect(bare.rt.productionLines(0)).toHaveLength(0);
    expect(bare.rt.buildBlockedReason('n2_squad', 1)).toBeNull();
  });

  it("productionAnchor: side 1's deploy point is the override camp's exit", () => {
    const w = world({ camps: [], sided: [[30, 5]] });
    w.step(10);
    expect(w.rt.requestBuild('n2_squad', undefined, 1)).toBe(true);
    const before = w.sim.entityCount;
    w.step(60);
    const e = w.sim.structureExit(0);
    expect(dist(pos(w, before), [fx.toNumber(e[0]), fx.toNumber(e[1])])).toBeLessThan(1.5);
  });
});
