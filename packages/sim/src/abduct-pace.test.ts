import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fx } from './fixed';
import { MissionRuntime, type MissionEvent, type MissionJson, type PlacementJson } from './mission';
import { Sim, TICKS_PER_SECOND, type Command, type UnitTypeJson } from './sim';
import { encodeSim, restoreSim } from './snapshot';

// GH-1438 E8 PACING, at the SHIPPED speeds. Without it the escort (`militia_cell`, 0.95 t/s) outwalks its captive
// (`civilians`, 0.8), the gap opens about 0.16 tiles a tile of route, and past six tiles he is let go: PR 1655 measured
// taken to 34 tiles, let go at 36, and capped the route in validate:data. With it the escort halts while a held captive
// is more than three tiles off, walks on when every one is within two, and gives up a wait after ten seconds
// (`stepAbductPace` in mission.ts). The world: a 12-high strip, the escort at (5,5), one villager a tile BEHIND it at
// (4,5), `to` the route length east with a 3-wide exit zone round it. Ids: 0 the escort, 1 the villager.

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'units');
const read = (rel: string): UnitTypeJson => JSON.parse(readFileSync(join(DATA, rel), 'utf8')) as UnitTypeJson;
const MILITIA = read('enemy/militia_cell.json');
const CIVILIANS = read('civilians.json');
/** A captive who cannot keep up at all (a twentieth of a tile a second): the wait cap's case. */
const HOBBLED: UnitTypeJson = { ...CIVILIANS, id: 'hobbled', mobility: { ...CIVILIANS.mobility, speed_tiles_s: 0.05 } };
const ESCORT = 0;
const VILLAGER = 1;
/** The pacing codes, written out (an oracle takes literals): walking 0, off -2, a halt positive (its tick + 1), a
 *  walk-on after a wait ran out below -2 (minus its tick + 3). */
const WALK = 0;
const OFF = -2;

interface PaceWorld {
  readonly sim: Sim;
  readonly rt: MissionRuntime;
  /** One tick: the sim, then the runtime; the runtime's events. */
  tick(): MissionEvent[];
  /** `abductPace` for the abduct trigger (index 0) and every other trigger. */
  pace(): number[];
  /** The tile x of the exit zone's west edge. */
  readonly zoneX: number;
}

/** What a later trigger orders the escort group to `back` with (`laterAt`, default `withdraw_to`). */
type LaterKind = 'withdraw_to' | 'commit' | 'abduct';
const laterDo = (kind: LaterKind): NonNullable<MissionJson['triggers']>[number]['do'] =>
  kind === 'abduct' ? { kind, group: 'takers', captives: 'taken', to: 'back', zone: 'back_zone' } : { kind, group: 'takers', to: 'back' };

function paceWorld(opts: { route: number; captive?: UnitTypeJson; withdrawAt?: number; laterKind?: LaterKind; inert?: boolean }): PaceWorld {
  const tx = 5 + opts.route;
  const sim = new Sim({ seed: 0x1438e8, width: tx + 6, height: 12, capacity: 8 });
  const captive = opts.captive ?? CIVILIANS;
  const ids = new Map<string, number>();
  for (const t of [MILITIA, captive]) ids.set(t.id, sim.addUnitType(t));
  const civ: PlacementJson = { unit: captive.id, count: 1, at: [4, 5], group: 'taken' };
  const mission: MissionJson = {
    id: 'abduct_pace',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 900 }],
    enemy: { garrison: [{ unit: MILITIA.id, count: 1, at: [5, 5], group: 'takers' }] },
    civilians: { refuge: 'refuge', groups: [civ] },
    triggers: [
      {
        id: 'led_away',
        label: 'They are led away',
        on: { kind: 'timer_s', value: 1 },
        do: { kind: 'abduct', group: 'takers', captives: 'taken', to: 'exit', zone: 'exit_zone' },
      },
      ...(opts.withdrawAt === undefined
        ? []
        : [{ id: 'fall_back', label: 'They fall back', on: { kind: 'timer_s' as const, value: opts.withdrawAt }, do: laterDo(opts.laterKind ?? 'withdraw_to') }]),
      // A trigger that never fires, so the table has a word that is not an abduct's.
      ...(opts.inert === true ? [{ id: 'never', label: 'Never', on: { kind: 'timer_s' as const, value: 9999 }, do: { kind: 'withdraw_to', group: 'takers', to: 'back' } }] : []),
    ],
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { exit: [tx, 5], refuge: [1, 10], back: [2, 9] },
    zones: { exit_zone: [tx - 1, 2, 3, 7], back_zone: [1, 8, 3, 3] },
  });
  rt.start();
  return {
    sim,
    rt,
    tick: () => rt.step(sim.tick()),
    pace: () => [...(rt as unknown as { abductPace: number[] }).abductPace],
    zoneX: tx - 1,
  };
}

const tiles = (raw: number): number => raw / 65536;
const gapOf = (sim: Sim): number =>
  Math.hypot(tiles(sim.state.posX[VILLAGER] - sim.state.posX[ESCORT]), tiles(sim.state.posY[VILLAGER] - sim.state.posY[ESCORT]));

/** Run to `seconds`, recording who is taken, the widest gap while the villager was in play, and the halts seen. */
function run(w: PaceWorld, seconds: number): { taken: number[]; widest: number; halts: number; heldTicks: number } {
  const taken: number[] = [];
  let widest = 0;
  let halts = 0;
  let heldTicks = 0;
  let was = WALK;
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
    for (const e of w.tick()) if (e.kind === 'removed' && e.side === 2) taken.push(e.entity);
    if (w.sim.state.alive[VILLAGER] === 1) widest = Math.max(widest, gapOf(w.sim));
    const p = w.pace()[0];
    if (p > 0) heldTicks++;
    if (p > 0 && was <= 0) halts++;
    was = p;
  }
  return { taken, widest, halts, heldTicks };
}

describe('E8 pacing at the shipped speeds: the escort waits for its captive', () => {
  it('reads an escort faster than its captive off data/units (the case pacing exists for)', () => {
    expect([MILITIA.mobility.speed_tiles_s, CIVILIANS.mobility.speed_tiles_s]).toEqual([0.95, 0.8]);
  });

  it('a 60-tile route, which let him go before (PR 1655: let go from 36): he is taken, never more than 3.2 tiles off', () => {
    const r = run(paceWorld({ route: 60 }), 150);
    expect(r.taken).toEqual([VILLAGER]);
    // Three tiles plus one tick of walking before the halt lands, and the follow order's half-second lag: far inside six.
    expect(r.widest).toBeLessThan(3.2);
    // It had to wait to keep him: more than once, on 60 tiles at a 0.15 t/s gap rate and a tile of hysteresis.
    expect(r.halts).toBeGreaterThan(3);
    // ...and the tile of hysteresis (halt past three, walk on within two) is what spaces those waits out. Measured at the
    // shipped values: 7 halts, 182 held ticks (26 a halt). With the walk-on at three tiles as well (`ABDUCT_PACE_GO_SQ`
    // 9 x 65536, no hysteresis) the escort thrashes: 97 halts of one tick each. The bounds sit between, with margin on
    // both sides: at most 12 halts, and at least 10 held ticks (half a second) a halt on average.
    expect(r.halts).toBeLessThanOrEqual(12);
    expect(r.heldTicks).toBeGreaterThanOrEqual(10 * r.halts);
  });

  it('a 120-tile route: still taken (no route is too long)', () => {
    expect(run(paceWorld({ route: 120 }), 300).taken).toEqual([VILLAGER]);
  });

  it('a short route he keeps up on unaided (29 tiles, inside 1655`s bound) is taken as before', () => {
    expect(run(paceWorld({ route: 29 }), 90).taken).toEqual([VILLAGER]);
  });
});

describe('E8 pacing: no deadlock', () => {
  /** Step until the escort is halted for the first time; the tick. */
  const toFirstHalt = (w: PaceWorld): number => {
    for (let i = 0; i < 60 * TICKS_PER_SECOND; i++) {
      w.tick();
      if (w.pace()[0] > 0) return w.sim.tickCount;
    }
    throw new Error('the escort never halted');
  };
  /** Steps until the escort's tile reaches the exit zone; the ticks it took, or -1. */
  const toZone = (w: PaceWorld, limit: number): number => {
    for (let i = 0; i < limit; i++) {
      w.tick();
      if (w.sim.state.posX[ESCORT] >> 16 >= w.zoneX) return i + 1;
    }
    return -1;
  };

  it('the captive killed while the escort waits: it walks on at once and reaches the exit', () => {
    const w = paceWorld({ route: 60 });
    toFirstHalt(w);
    w.sim.debugKill(VILLAGER);
    w.tick(); // the kill lands; the runtime sees nobody held and re-issues the move
    expect(w.pace()[0]).toBe(WALK);
    w.tick(); // the move lands
    expect(w.sim.state.moving[ESCORT]).toBe(1);
    expect(toZone(w, 120 * TICKS_PER_SECOND)).toBeGreaterThan(0);
  });

  it('the captive gone more than six tiles off while the escort waits (no longer held): it walks on', () => {
    const w = paceWorld({ route: 60 });
    toFirstHalt(w);
    w.sim.teleport(VILLAGER, fx.sub(w.sim.state.posX[ESCORT], fx.from(7)), w.sim.state.posY[ESCORT]);
    w.tick();
    expect(w.pace()[0]).toBe(WALK);
    expect(toZone(w, 120 * TICKS_PER_SECOND)).toBeGreaterThan(0);
  });

  it('a captive who cannot follow: the wait gives up after ten seconds, he is left behind, and the escort goes on to the exit', () => {
    const w = paceWorld({ route: 40, captive: HOBBLED });
    const from = toFirstHalt(w);
    let resumedAt = -1;
    for (let i = 0; i < 30 * TICKS_PER_SECOND && resumedAt < 0; i++) {
      w.tick();
      if (w.pace()[0] <= 0) resumedAt = w.sim.tickCount;
    }
    // The halt was ordered on tick `from` (the word holds it plus one) and the walk-on is ordered on the 200-tick cap exactly.
    expect(resumedAt - from).toBe(10 * TICKS_PER_SECOND);
    expect(w.pace()[0]).toBe(-(resumedAt + 3));
    // ...and walks unpaced for ten seconds: no halt in that time, whoever lags.
    for (let i = 0; i < 10 * TICKS_PER_SECOND - 1; i++) {
      w.tick();
      expect(w.pace()[0], `tick ${w.sim.tickCount}`).toBeLessThan(OFF);
    }
    const taken: number[] = [];
    let reached = -1;
    for (let i = 0; i < 120 * TICKS_PER_SECOND && reached < 0; i++) {
      for (const e of w.tick()) if (e.kind === 'removed' && e.side === 2) taken.push(e.entity);
      if (w.sim.state.posX[ESCORT] >> 16 >= w.zoneX) reached = i;
    }
    expect(reached).toBeGreaterThan(0);
    expect(taken).toEqual([]);
    expect(w.sim.state.alive[VILLAGER]).toBe(1);
    // Re-armed after the walk-on, with him past six and let go: no halt since.
    expect(w.pace()[0]).toBe(WALK);
  });
});

describe('E8 pacing: a later order to the escort stands', () => {
  /** The escort halted for its hobbled captive (which keeps it halted for the whole ten-second cap), then a later trigger
   *  of `kind` orders its group to `back` (2, 9) two seconds into the halt, eight before the cap. The orders to the
   *  escort from the second that trigger fires, and the first abduct's word at that tick and every tick after. */
  const orderedMidHalt = (kind: LaterKind): { w: PaceWorld; after: (string | number | null)[][]; firstAbduct: number[] } => {
    const probe = paceWorld({ route: 40, captive: HOBBLED });
    let first = -1;
    for (let i = 0; i < 60 * TICKS_PER_SECOND && first < 0; i++) {
      probe.tick();
      if (probe.pace()[0] > 0) first = probe.sim.tickCount;
    }
    const at = Math.ceil(first / TICKS_PER_SECOND) + 2; // seconds: two after the halt began, eight before the cap
    const w = paceWorld({ route: 40, captive: HOBBLED, withdrawAt: at, laterKind: kind });
    const orders: { tick: number; cmd: Command }[] = [];
    const spy = vi.spyOn(w.sim, 'queueCommand').mockImplementation(function (this: Sim, cmd: Command) {
      if ('ids' in cmd && cmd.ids.includes(ESCORT)) orders.push({ tick: w.sim.tickCount, cmd });
      return Sim.prototype.queueCommand.call(w.sim, cmd);
    });
    const firstAbduct: number[] = [];
    for (let i = 0; i < 60 * TICKS_PER_SECOND; i++) {
      // Halted the tick before it fires: the later order really does land inside a halt.
      if (w.sim.tickCount === at * TICKS_PER_SECOND - 1) expect(w.pace()[0], 'halted before the later trigger').toBeGreaterThan(0);
      w.tick();
      if (w.sim.tickCount >= at * TICKS_PER_SECOND) firstAbduct.push(w.pace()[0]);
    }
    spy.mockRestore();
    const after = orders
      .filter((o) => o.tick >= at * TICKS_PER_SECOND)
      .map((o) => [o.cmd.kind, o.cmd.kind === 'move' || o.cmd.kind === 'attackMove' ? o.cmd.x >> 16 : null]);
    return { w, after, firstAbduct };
  };
  const nearBack = (w: PaceWorld): number => Math.hypot(tiles(w.sim.state.posX[ESCORT]) - 2.5, tiles(w.sim.state.posY[ESCORT]) - 9.5);

  it('a withdraw_to of the escort while it waits: pacing is OFF, the escort goes where it was sent, and pacing never re-routes it', () => {
    const { w, after, firstAbduct } = orderedMidHalt('withdraw_to');
    // Exactly one order after the withdraw fired: the withdraw's own move to `back` (2, 9). No halt, no move east.
    expect(after).toEqual([['move', 2]]);
    expect(new Set(firstAbduct)).toEqual(new Set([OFF]));
    expect(nearBack(w)).toBeLessThan(1.5);
  });

  it('a commit of the escort while it waits: the same, the commit`s own attack-move the only order after it', () => {
    const { w, after, firstAbduct } = orderedMidHalt('commit');
    expect(after).toEqual([['attackMove', 2]]);
    expect(new Set(firstAbduct)).toEqual(new Set([OFF]));
    expect(nearBack(w)).toBeLessThan(1.5);
  });

  it('a second abduct of the same escort while it waits: the first stops pacing, and nothing sends the escort east again', () => {
    const { w, after, firstAbduct } = orderedMidHalt('abduct');
    // The second abduct's own move to `back` comes first. It paces its own march (it may halt the escort for the
    // captive it leads), but every move after it is to `back`: the first abduct never re-issues its move to `exit`.
    expect(after[0]).toEqual(['move', 2]);
    for (const o of after) if (o[0] !== 'halt') expect(o).toEqual(['move', 2]);
    expect(new Set(firstAbduct)).toEqual(new Set([OFF]));
    expect(nearBack(w)).toBeLessThan(1.5);
  });
});

describe('E8 pacing: the state word is runtime state', () => {
  it('folds into digest() for an abduct trigger only: another trigger`s word moves nothing', () => {
    const w = paceWorld({ route: 60, inert: true });
    for (let i = 0; i < 5 * TICKS_PER_SECOND; i++) w.tick();
    const words = (w.rt as unknown as { abductPace: number[] }).abductPace;
    expect(words).toHaveLength(2);
    const d0 = w.rt.digest();
    words[1] = 7; // the never-firing withdraw_to's word
    expect(w.rt.digest()).toBe(d0);
    words[1] = 0;
    words[0] = 7; // the abduct's
    expect(w.rt.digest()).not.toBe(d0);
  });

  it('a snapshot cut while the escort waits restores the halt, and the restored world runs on byte for byte', () => {
    const a = paceWorld({ route: 60 });
    for (let i = 0; i < 60 * TICKS_PER_SECOND && a.pace()[0] <= 0; i++) a.tick();
    const halted = a.pace()[0];
    expect(halted).toBeGreaterThan(0);
    const b = paceWorld({ route: 60 });
    restoreSim(b.sim, encodeSim(a.sim, {}, a.rt), b.rt);
    expect(b.pace()).toEqual([halted]);
    let takenA = 0;
    let takenB = 0;
    for (let i = 0; i < 120 * TICKS_PER_SECOND; i++) {
      takenA += a.tick().filter((e) => e.kind === 'removed').length;
      takenB += b.tick().filter((e) => e.kind === 'removed').length;
      expect(b.sim.hash(), `tick ${a.sim.tickCount}`).toBe(a.sim.hash());
      expect(b.rt.digest(), `tick ${a.sim.tickCount}`).toBe(a.rt.digest());
    }
    expect([takenA, takenB]).toEqual([1, 1]);
  });
});
