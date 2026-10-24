// N4b task 13: `pnpm arena`, in-process, on the local relay -- the real Worker
// routes and the real `MatchRoom` on 127.0.0.1. Every relay and player the
// arena starts it closes itself; the test's own `--out` is a temp directory,
// removed after each test.
//
// The recorded run (seed 1000 = seedOf(0), `--first-seed 0`, tel_marum,
// pace 40, cap 6,000, tick 1 ms) is a regression pin, not evidence of a rate:
// rush's rate against passive is not 1.0. This seed is one rush wins from both
// seats. Re-seeded 2026-10-24 from seed 40595 (seedOf(5)) when tel_marum's
// versus seat 0 moved to (27,45) (GH-774): on the new seats rush wins from both
// seats on seeds 0, 1, 7, 9 and 10 of 0-11 at pace 40 and at pace 60, and on
// seed 5 passive now holds against rush on seat 1. (Re-seeded 2026-10-22 from
// seed 1000 to 40595 when seat 0 moved to (24,46).)
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bySeat, judge, parseArgs, refusalOf, resolvePlayer, runArena, untrusted, type SeatSnapshot } from './arena';
import type { AgentClient } from './agent-client';
import type { ArenaPlayer } from './players';
import type { GameRecord } from './arena-score';
import { startLocalRelay } from './local-relay';
import type { TransportStatus } from '@lions/net';
import { MATCH_CAP_TICKS, type MatchResult, type OutcomeSim } from '../../../packages/app/src/net/outcome';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});
function outDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'arena-test-'));
  dirs.push(d);
  return d;
}
const quiet = { log: () => {}, print: () => {} };

describe('pnpm arena', () => {
  it('plays a seed twice with the seats swapped, writes two records and scores rush 1.0 on this seed', async () => {
    const out = outDir();
    const printed: string[] = [];
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--first-seed', '0', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '6000', '--out', out], { ...quiet, print: (l) => { printed.push(l); } });
    expect(r.code).toBe(0);
    // A over B, one-sided: printed with or without --gate, and without --gate never a verdict.
    expect(printed).toContain('  rush over passive: n=2  score=1.000  p=0.2500 (one-sided exact binomial, draws half)');
    expect(printed.some((l) => l.startsWith('gate:'))).toBe(false);
    expect(r.gate).toBeNull();
    const files = readdirSync(out).sort();
    const jsonl = files.find((f) => f.endsWith('-rush-vs-passive.jsonl'));
    const md = files.find((f) => f.endsWith('-rush-vs-passive.md'));
    expect(jsonl).toBeDefined();
    expect(md).toBeDefined();
    const records = readFileSync(join(out, jsonl ?? ''), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as GameRecord);
    expect(records).toHaveLength(2);
    // Game 1 has A on seat 0; game 2 has B there. Same seed, same map.
    expect(records[0].players).toEqual(['rush', 'passive']);
    expect(records[1].players).toEqual(['passive', 'rush']);
    expect(records.map((g) => g.seed)).toEqual([1000, 1000]);
    expect(records.map((g) => g.factions)).toEqual([['kdf', 'kdf'], ['kdf', 'kdf']]);
    for (const g of records) {
      expect(g.outcome).not.toBe('void');
      expect(g.ticks).toBeLessThanOrEqual(6000);
      expect(g.reports).toEqual([{ tokens: null, timeouts: 0, errors: [] }, { tokens: null, timeouts: 0, errors: [] }]);
    }
    expect(r.tally?.get('rush')?.score).toBe(1);
    expect(r.tally?.get('passive')?.score).toBe(0);
    const report = readFileSync(join(out, md ?? ''), 'utf8');
    expect(report).toContain('| rush |');
    expect(report).toContain('| passive |');
  }, 120_000);

  it('refuses a map no room offers (qarn_hadid) with exit 2, before any room', async () => {
    let relays = 0;
    const out = outDir();
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--map', 'qarn_hadid', '--out', out], {
      ...quiet, startRelay: (o) => { relays++; return startLocalRelay(o); },
    });
    expect(r.code).toBe(2);
    expect(relays).toBe(0);
    expect(readdirSync(out)).toEqual([]);
  });

  it('refuses a KDF-vs-Sarim matchup on a mirror-only map (milh_flats) with exit 2, before any room', async () => {
    let relays = 0;
    const out = outDir();
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--map', 'milh_flats', '--matchup', 'kdf', '--out', out], {
      ...quiet, startRelay: (o) => { relays++; return startLocalRelay(o); },
    });
    expect(r.code).toBe(2);
    expect(relays).toBe(0);
    // The mirror on the same map is offered.
    expect(refusalOf('milh_flats', 'mirror')).toBeNull();
    expect(refusalOf('milh_flats', 'kdf')).not.toBeNull();
  });

  it('does not trust a room whose start config is not what it asked for: exit 1, no record', async () => {
    // A relay that ignores the arena's seed: the room starts, on the wrong world.
    // Its close then rejects (after really closing): that must not mask why the game failed.
    const out = outDir();
    const lines: string[] = [];
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '400', '--out', out], {
      ...quiet,
      log: (l) => { lines.push(l); },
      startRelay: async (o) => {
        const relay = await startLocalRelay({ ...o, seedFor: () => 1, log: () => {} });
        return { ...relay, close: async () => { await relay.close(); throw new Error('the relay would not close'); } };
      },
    });
    expect(r.code).toBe(1);
    expect(lines.some((l) => l.includes('a game could not be played') && l.includes('seed 1, not 1000'))).toBe(true);
    expect(r.games).toEqual([]);
    const jsonl = readdirSync(out).find((f) => f.endsWith('.jsonl'));
    expect(readFileSync(join(out, jsonl ?? ''), 'utf8')).toBe('');
  }, 30_000);

  it('voids a game in which the room sent desync, read before the arena stops the players', async () => {
    // A rush seat whose transport reports one corrupted hash: the room pairs it
    // with the other seat's true one and sends `desync` (room-core). Nothing
    // touches either sim; only the hash on the wire is wrong.
    const corrupting = (spec: string, log: (line: string) => void): ArenaPlayer => {
      const inner = resolvePlayer(spec, log);
      if (spec !== 'rush') return inner;
      return {
        name: inner.name,
        start: async (s) => {
          const r = await inner.start(s);
          const t = r.client?.transport;
          if (t !== undefined) {
            const report = t.reportTick.bind(t);
            let corrupted = false;
            t.reportTick = (tick, digest) => {
              if (digest !== null && !corrupted) { corrupted = true; report(tick, digest ^ 1); return; }
              report(tick, digest);
            };
          }
          return r;
        },
      };
    };
    // The relay has no D1, so the room's desync log says why on console.error.
    const quietError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = outDir();
      const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '400', '--out', out], { ...quiet, resolvePlayer: corrupting });
      expect(r.code).toBe(0);
      expect(r.games.map((g) => [g.outcome, g.by])).toEqual([['void', 'desync'], ['void', 'desync']]);
      expect(r.tally?.get('rush')).toMatchObject({ games: 2, voids: 2 });
    } finally {
      quietError.mockRestore();
    }
  }, 60_000);

  it('reads its command line: defaults, a bad value, an unknown player', () => {
    const a = parseArgs(['--', '--a', 'rush', '--b', 'passive']);
    expect(a).toMatchObject({ a: 'rush', b: 'passive', seeds: 10, map: 'tel_marum', matchup: 'mirror', pace: 60, roundWallMs: 120_000, capTicks: 12_000, tickMs: 2 });
    expect(parseArgs(['--a', 'rush'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--seeds', '0'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--matchup', 'both'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'nobody'])).toHaveProperty('error');
  });

  it('reads --gate as a flag that takes no value, off by default', () => {
    expect(parseArgs(['--a', 'rush', '--b', 'passive'])).toMatchObject({ gate: false });
    expect(parseArgs(['--a', 'rush', '--gate', '--b', 'passive', '--seeds', '20'])).toMatchObject({ a: 'rush', b: 'passive', seeds: 20, gate: true, firstSeed: 0 });
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--first-seed', '5'])).toMatchObject({ firstSeed: 5 });
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--first-seed', 'x'])).toHaveProperty('error');
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--gate'])).toMatchObject({ gate: true });
    expect(parseArgs(['--a', 'rush', '--b', 'passive', '--gate=yes'])).toHaveProperty('error');
  });

  it('--gate on a run that could not finish is not judged: exit 1 stays exit 1', async () => {
    const out = outDir();
    const printed: string[] = [];
    const startRelay = (): never => { throw new Error('no relay in this test'); };
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--gate', '--out', out], { log: () => {}, print: (l) => { printed.push(l); }, startRelay });
    expect(r.code).toBe(1);
    expect(r.gate).toBeNull();
    expect(printed.some((l) => l.startsWith('gate: not judged'))).toBe(true);
  });

  it('--gate judges rush over passive and exits 3 on FAIL: one seed is two games, p 0.25 at best', async () => {
    const out = outDir();
    const printed: string[] = [];
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--first-seed', '0', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '6000', '--gate', '--out', out], { log: () => {}, print: (l) => { printed.push(l); } });
    expect(r.code).toBe(3);
    expect(r.gate).toMatchObject({ n: 2, score: 1, p: 0.25, pass: false });
    expect(printed).toContain('gate: FAIL  rush over passive  n=2  score=1.000  p=0.2500');
  }, 120_000);

  it('resolves a relative --out (and the default) against INIT_CWD, the directory pnpm was run from, not the cwd', async () => {
    const base = outDir();
    const saved = process.env.INIT_CWD;
    process.env.INIT_CWD = base;
    try {
      // A relay that cannot start ends each run at the first game, after the output directory exists.
      const startRelay = (): never => { throw new Error('no relay in this test'); };
      const r1 = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--out', 'rel-out'], { ...quiet, startRelay });
      expect(r1.code).toBe(1);
      expect(existsSync(join(base, 'rel-out'))).toBe(true);
      expect(existsSync(join(process.cwd(), 'rel-out'))).toBe(false);
      const r2 = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1'], { ...quiet, startRelay });
      expect(r2.code).toBe(1);
      expect(existsSync(join(base, 'arena-results'))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.INIT_CWD; else process.env.INIT_CWD = saved;
      rmSync(join(process.cwd(), 'rel-out'), { recursive: true, force: true });
    }
  });

  it('an observer whose stop rejects still lets the players stop and the relay close', async () => {
    let relayClosed = false;
    const stops: string[] = [];
    const lines: string[] = [];
    const out = outDir();
    const stubPlayer = (name: string): ArenaPlayer => ({
      name,
      start: async () => ({ client: null, done: Promise.resolve({ tokens: null, timeouts: 0, errors: [] }), stop: async () => { stops.push(name); } }),
    });
    const r = await runArena(['--a', 'cmd:x', '--b', 'cmd:y', '--seeds', '1', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '400', '--out', out], {
      ...quiet,
      log: (l) => { lines.push(l); },
      resolvePlayer: (spec) => stubPlayer(spec),
      startRelay: async (o) => {
        const relay = await startLocalRelay({ ...o, log: () => {} });
        return { ...relay, close: async () => { relayClosed = true; await relay.close(); } };
      },
      // The observer's reading fails the game, and its own stop then rejects too.
      startObserver: async () => ({
        client: { ready: Promise.reject(new Error('the observer never saw a start')) } as unknown as AgentClient,
        done: Promise.resolve({ tokens: null, timeouts: 0, errors: [] }),
        stop: () => Promise.reject(new Error('the observer would not stop')),
      }),
    });
    expect(r.code).toBe(1);
    expect(lines.some((l) => l.includes('the observer never saw a start'))).toBe(true);
    expect(stops.sort()).toEqual(['cmd:x', 'cmd:y']);
    expect(relayClosed).toBe(true);
  }, 30_000);

  it('refuses a cmd:<template> naming a placeholder it does not offer ({ticket}), with exit 1 and no room', async () => {
    let relays = 0;
    const out = outDir();
    const r = await runArena(['--a', 'cmd:claude {ticket}', '--b', 'passive', '--seeds', '1', '--out', out], {
      ...quiet, startRelay: (o) => { relays++; return startLocalRelay(o); },
    });
    expect(r.code).toBe(1);
    expect(relays).toBe(0);
  });
});

/** A world where side 0 keeps a Lavi (906) and side 1 an infantry squad (292): at the cap, side 0 is ahead on forces. */
const capSim: OutcomeSim = {
  entityCount: 2,
  state: { side: [0, 1], alive: [1, 1], typeIdx: [0, 1], mobilityKilled: [0, 0], firepowerKilled: [0, 0] },
  unitTypes: [{ id: 'mbt_lavi', weapons: [{}], stepPerTick: 1, isAir: false }, { id: 'inf_squad', weapons: [{}], stepPerTick: 1, isAir: false }],
};
function client(result: MatchResult | null, o: { tick?: number; status?: TransportStatus } = {}): SeatSnapshot {
  return { result, tick: o.tick ?? 600, sim: capSim, status: o.status ?? { kind: 'live', behind: 0 } };
}
const won = (side: 0 | 1, by: 'annihilation' | 'forfeit' = 'annihilation'): MatchResult => ({ kind: 'won', side, by });
const SIDES: [0, 1] = [0, 1];

describe('judge', () => {
  it('takes the result both sims agree on, by seat', () => {
    expect(judge([client(won(1)), client(won(1))], SIDES, 6000)).toEqual({ outcome: 'seat1', by: 'annihilation' });
    expect(judge([client({ kind: 'draw', by: 'mutual' }), client({ kind: 'draw', by: 'mutual' })], SIDES, 6000)).toEqual({ outcome: 'draw', by: 'mutual' });
  });
  it('voids a game whose two sims report different results', () => {
    // `disagree`, not `desync`: the arena caught it, not the room.
    expect(judge([client(won(0)), client(won(1))], SIDES, 6000)).toEqual({ outcome: 'void', by: 'disagree' });
    // One decided by its own sim and one not: they disagree too.
    expect(judge([client(won(0)), client(null)], SIDES, 6000)).toEqual({ outcome: 'void', by: 'disagree' });
  });
  it('voids a game in which the room sent desync, whatever the sims say', () => {
    expect(judge([client(won(0), { status: { kind: 'desync', tick: 480 } }), client(won(0))], SIDES, 6000)).toEqual({ outcome: 'void', by: 'desync' });
  });
  it('accepts a room ending only one seat heard (the seat that gave up never hears it)', () => {
    expect(judge([client(null), client(won(1, 'forfeit'))], SIDES, 6000)).toEqual({ outcome: 'seat1', by: 'forfeit' });
  });
  it('at the cap, both standing on it with no result, decides on seat 0\'s sim and records by: cap', () => {
    expect(judge([client(null, { tick: 6000 }), client(null, { tick: 6000 })], SIDES, 6000)).toEqual({ outcome: 'seat0', by: 'cap' });
    // Short of the cap with no result: the room closed it, a void named for why.
    expect(judge([client(null, { tick: 300, status: { kind: 'closed', reason: 'expired' } }), client(null, { tick: 300 })], SIDES, 6000)).toEqual({ outcome: 'void', by: 'expired' });
    expect(MATCH_CAP_TICKS).toBeGreaterThan(6000);
  });
});

describe('untrusted', () => {
  const seats = [{ faction: 'kdf' }, { faction: 'kdf' }] as unknown as Parameters<typeof untrusted>[0]['seats'];
  const args = { pace: 40, roundWallMs: 120_000, map: 'tel_marum', matchup: 'mirror' as const };
  it('trusts the start config only when it says the pace, seed, map and factions asked for', () => {
    expect(untrusted({ pace: { kind: 'paced', roundTicks: 40, roundWallMs: 120_000 }, seed: 1000, map: 'tel_marum', seats }, args, 1000)).toBeNull();
    // A malformed pace reaches the room as realtime, silently: refused here.
    expect(untrusted({ pace: { kind: 'realtime' }, seed: 1000, map: 'tel_marum', seats }, args, 1000)).toMatch(/pace/);
    expect(untrusted({ pace: { kind: 'paced', roundTicks: 20, roundWallMs: 120_000 }, seed: 1000, map: 'tel_marum', seats }, args, 1000)).toMatch(/pace/);
    expect(untrusted({ pace: { kind: 'paced', roundTicks: 40, roundWallMs: 120_000 }, seed: 7, map: 'tel_marum', seats }, args, 1000)).toMatch(/seed/);
    expect(untrusted({ pace: { kind: 'paced', roundTicks: 40, roundWallMs: 120_000 }, seed: 1000, map: 'tel_marum', seats }, { ...args, matchup: 'kdf' }, 1000)).toMatch(/seated/);
  });
});

describe('bySeat (LD1)', () => {
  // A by-side board read by seat: a Sarim host is seat 0 on side 1, so its columns are side 1's.
  const a = { lost: 1 } as never;
  const b = { lost: 2 } as never;
  it('keeps a mirror board as it is, and swaps a Sarim host\'s', () => {
    expect(bySeat([a, b], [0, 1])).toEqual([a, b]);
    expect(bySeat([a, b], [1, 0])).toEqual([b, a]);
  });
});
