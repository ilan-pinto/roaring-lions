// GH-976 v2 R0.8: ONE cap everywhere. A flag room on a set-up map plays 30 minutes (36,000 ticks) on every map, set-up included;
// every site that holds the room's config reads it through `matchCapTicksOf`. The sites with no config in hand
// (lane-probe, versus-breach, versus-probe) play no flag room and keep the map form.
import { describe, expect, it, vi } from 'vitest';
import { matchCapTicksOf, validateConfig, type MatchConfig } from '@lions/net';
import { MAX_LOG_CMD_CHARS, logCmdCharsOf } from '../../../packages/worker/src/match/room-core';
import type { RoomState } from '../../../packages/worker/src/match/room-core';
import { hashTickOutcome } from '../../../packages/app/src/net/outcome';
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
