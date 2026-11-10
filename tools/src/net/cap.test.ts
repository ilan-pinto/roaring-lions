// GH-976 v2 R0.8: ONE cap everywhere. A flag room on a set-up map plays 30 minutes (36,000 ticks) on every map, set-up included;
// every site that holds the room's config reads it through `matchCapTicksOf`. The sites with no config in hand
// (lane-probe, versus-breach, versus-probe) play no flag room and keep the map form.
import { describe, expect, it, vi } from 'vitest';
import { matchCapTicksOf, validateConfig, type CapConfig, type MatchConfig } from '@lions/net';
import { MAX_LOG_CMD_CHARS, logCmdCharsOf } from '../../../packages/worker/src/match/room-core';
import type { RoomState } from '../../../packages/worker/src/match/room-core';
import { FLAG_BACKSTOP_TICKS, hashTickOutcome, type OutcomeSimAt } from '../../../packages/app/src/net/outcome';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import * as outcome from '../../../packages/app/src/net/outcome';
import { capOutcome } from './cap';
import { judge } from './budget-measure';

// The arena's cap reaches `outcomeOf` as an argument whose value the RESULT never shows (it is asked AT the cap), so the spy reads it.
vi.mock('../../../packages/app/src/net/outcome', async (orig) => {
  const real = await orig<typeof import('../../../packages/app/src/net/outcome')>();
  return { ...real, outcomeOf: vi.fn(real.outcomeOf) };
});

function flagRoom(flagSetup: boolean): MatchConfig {
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: 'rujm_sawda', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, winMode: 'flag', ...(flagSetup ? { flagSetup: true } : {}) });
  if (c === null) throw new Error('bad fixture');
  return c;
}
/** The world's sim, reading as if `tick` ticks had run (the room decides on `sim.tickCount`). */
const atTick = <T extends object>(sim: T, tick: number): T & { readonly tickCount: number } =>
  new Proxy(sim, { get: (t, p) => (p === 'tickCount' ? tick : Reflect.get(t, p, t)) }) as T & { readonly tickCount: number };

describe.each([[true, 30, 36_000], [false, 35, 42_000]] as const)('GH-976 R0.8: one cap everywhere (rujm_sawda flag room, flagSetup %s)', (flagSetup, minutes, ticks) => {
  const config = flagRoom(flagSetup);
  it(`matchCapTicksOf reads ${minutes} minutes (${ticks} ticks)`, () => {
    expect(matchCapTicksOf(config)).toBe(ticks);
  });
  it('the room\'s log scale: the stored-command cap is MAX_LOG_CMD_CHARS x minutes / 25', () => {
    const st = { map: config.map, config } as Pick<RoomState, 'map' | 'config'>;
    expect(logCmdCharsOf(st)).toBe((MAX_LOG_CMD_CHARS * minutes) / 25);
  });
  it('hashTickOutcome decides a standing match on the cap tick and not before', () => {
    const w = buildMatchWorld(config);
    // A hash tick is a frame whose tick closes a 20-tick window (frame f ends tick f + 1).
    expect(hashTickOutcome(ticks - 21, config, atTick(w.sim, ticks - 20))).toBeNull();
    const at = hashTickOutcome(ticks - 1, config, atTick(w.sim, ticks));
    expect(at).not.toBeNull();
    expect(at !== null && 'by' in at ? at.by : null).toBe('time');
  });
  it('the arena\'s capOutcome asks the rule at the room\'s cap', () => {
    const w = buildMatchWorld(config);
    const spy = vi.mocked(outcome.outcomeOf);
    spy.mockClear();
    capOutcome(w.sim, undefined, config);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([spy.mock.calls[0][1], spy.mock.calls[0][4]]).toEqual([ticks, ticks]);
  });
  it('the budget harness judges a full match against the same cap', () => {
    const base = { map: config.map, winMode: config.winMode, flagSetup: config.flagSetup, capTicks: ticks, ticks, rows: { total: 0, batch: 0, snapshot: 0, alarm: 0, state: 0 }, wallSeconds: 0, cmdChars: 1000, commands: 1, storedChars: 0, snapshot: null, snapshotSizes: [], endSnapshot: null, result: 'side 0 won (time)', policy: { calls: 0, orders: 0, units: 0 }, playerErrors: [] };
    const v = judge(base, { heavy: true });
    expect(v.lines.join('\n')).toContain(`of ${(2_000_000 * minutes) / 25} (`);
    // A match that ran to the cap but not to a decision on time is only held to the cap when `capTicks` IS the room's cap.
    expect(judge({ ...base, result: 'draw (mutual)' }, { heavy: true }).failures.join('|')).toMatch(/not a decision on time/);
  });
});

describe('capOutcome keeps the map form for a bare map', () => {
  it('rujm_sawda as a string is 35 minutes, and no argument is the 25-minute default', () => {
    const w = buildMatchWorld(flagRoom(false));
    const spy = vi.mocked(outcome.outcomeOf);
    spy.mockClear();
    capOutcome(w.sim, undefined, 'rujm_sawda');
    capOutcome(w.sim);
    expect(spy.mock.calls.map((c) => c[4])).toEqual([42_000, 30_000]);
  });
});

describe('capOutcome applies the flag backstop (GH-1208)', () => {
  // Real unit ids, so `unitCost` reads the shipped data: type 0 is the Lavi (906), type 1 a rifle squad (292). Literals, not the data module.
  const REAL = [
    { id: 'mbt_lavi', weapons: [1], stepPerTick: 1, isAir: false },
    { id: 'inf_squad', weapons: [1], stepPerTick: 1, isAir: false },
  ];
  const setRoom: CapConfig = { map: 'milh_flats_l', winMode: 'flag', flagSetup: true };
  const BELL = 500;
  const STOP = BELL + FLAG_BACKSTOP_TICKS; // 12 minutes of 20 Hz ticks after the bell
  /** A set-up room's sim after the bell, side 0 ahead on value (a Lavi + a squad against a squad: 1198 vs 292). */
  const ahead0: OutcomeSimAt = {
    entityCount: 3,
    state: { side: [0, 0, 1], alive: [1, 1, 1], typeIdx: [0, 1, 1], firepowerKilled: [0, 0, 0], mobilityKilled: [0, 0, 0] },
    unitTypes: REAL,
    tickCount: STOP,
    setupActive: false,
    setupBellTick: BELL,
  };

  it('a set-up room settled through capOutcome at bell + 12 min wins by time on value, asked at the backstop, not the 30-minute cap', () => {
    const spy = vi.mocked(outcome.outcomeOf);
    spy.mockClear();
    const r = capOutcome(ahead0, undefined, setRoom);
    // The value winner on time: side 0 holds the Lavi and a squad (1198) against one squad (292).
    expect(r).toEqual({ kind: 'won', side: 0, by: 'time', forces: [1198, 292] });
    // The rule was asked AT the backstop, as `hashTickOutcome` would have asked it in the room.
    expect([spy.mock.calls[0][1], spy.mock.calls[0][4]]).toEqual([STOP, STOP]);
  });

  it('a no-set-up room is unchanged: the same sim is decided at the map cap, never the backstop', () => {
    const spy = vi.mocked(outcome.outcomeOf);
    for (const room of [{ map: 'milh_flats_l' }, { map: 'milh_flats_l', winMode: 'flag' }, { map: 'milh_flats_l', winMode: 'points', flagSetup: true }, { map: 'milh_flats_l', flagSetup: true }] as CapConfig[]) {
      spy.mockClear();
      capOutcome(ahead0, undefined, room);
      const cap = matchCapTicksOf(room);
      expect([spy.mock.calls[0][1], spy.mock.calls[0][4]]).toEqual([cap, cap]);
    }
  });
});
