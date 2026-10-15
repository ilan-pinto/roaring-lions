// The versus probe's own checks (#561). The probe is report-only -- no verdict it
// prints fails anything -- so what must NOT be allowed to pass quietly is the
// probe itself: a table from an instrument that cannot tell west from east.
// Each test below is seen red under a one-line mutation of versus-probe.ts (the
// header there lists them; the commit message says which was run).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapId } from '@lions/data';
import { VERSUS_FAIR_MAPS } from '@lions/net';
import {
  CAP_TICKS_DEFAULT, DECIDE_EVERY_TICKS, FAIR_MAX_PERCENT, ORDER_EVERY_TICKS, SEEDS_DEFAULT,
  candidateMaps, main, parseArrangements, play, reading, seedOf, selfCheck, tally, type Played, type PlayFn,
} from './versus-probe';

// Every test that plays FULL games carries this instead of vitest's 5 s
// default: the M1, M3 and uncut mutants and `main`'s two runs (four or more
// tel_marum games each), the cut-side control (eight, on four maps), and
// "one seed as one game" (two, but the file's first, so it also pays the
// sim's first-game warm-up).
// They are CPU-bound sim runs with no I/O, and each game is the claim, so
// they are not cut. Measured single-file, Apple M3 Pro, 2026-10-15, six
// runs with the load average at 38-106 on 12 cores throughout (no idle run
// was to be had): the fastest two read M3 0.42-0.51 s, uncut 0.65-0.68 s,
// main 0.73-0.84 s; the other four up to 2.9 / 3.3 / 3.1 s; and under a full
// parallel `pnpm test` on a loaded machine they crossed 5 s more than once.
// Re-measured 2026-10-15 for the four added since, three runs each at a load
// average of 12-20 then three at 31-78: one seed 0.34-0.35 / 0.62-3.30 s, the
// cut side 0.16-0.18 / 0.30-1.04 s, M1 0.26-0.28 / 0.35-2.07 s, main's exit 2
// 0.26 / 0.33-2.09 s; "one seed" crossed 5 s under a full parallel run.
// The margin is for contention only: needing it on a quiet machine would be
// a regression. (`selfCheck` on every open map, below, keeps its own 60 s.)
const FULL_GAMES_TIMEOUT_MS = 30_000;

const game = (winner: 0 | 1 | null, by: Played['by'] = 'annihilation', ticks = 1200): Played => ({ winner, by, ticks });

describe('the probe parameters the lead set (#561, #589)', () => {
  it('re-orders every 20 s, decides on surviving value at a 10-minute cap, and the bar is 60/40 at 48 seeds', () => {
    expect(ORDER_EVERY_TICKS).toBe(20 * 20);
    expect(CAP_TICKS_DEFAULT).toBe(10 * 60 * 20);
    expect(DECIDE_EVERY_TICKS).toBe(20);
    expect(FAIR_MAX_PERCENT).toBe(60);
    expect(SEEDS_DEFAULT).toBe(48);
    expect(seedOf(0)).toBe(1000);
    expect(seedOf(2)).toBe(1000 + 2 * 7919);
  });
});

describe('play', () => {
  it('reads one seed as one game, run to run', () => {
    const a = play('tel_marum', ['kdf', 'kdf'], seedOf(3));
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(3))).toEqual(a);
    expect(a.ticks).toBeGreaterThan(0);
  }, FULL_GAMES_TIMEOUT_MS);
  it('a game nobody closes in is decided on surviving value at the cap: level forces draw, the larger force wins', () => {
    // 2 s: the forces are 28 tiles apart and no one has fired.
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(0), { capTicks: 40 })).toEqual({ winner: null, by: 'cap', ticks: 40 });
    // Side 1 cut to one unit: side 0 holds more value at the cap, whichever the ground.
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(0), { capTicks: 40, cutSide: 1 })).toEqual({ winner: 0, by: 'cap', ticks: 40 });
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(0), { capTicks: 40, cutSide: 0 })).toEqual({ winner: 1, by: 'cap', ticks: 40 });
  });
  it('a side cut to one unit loses to the other by annihilation, on each spawn: the sides are told apart', () => {
    for (const map of VERSUS_FAIR_MAPS) {
      expect(play(map as MapId, ['kdf', 'kdf'], seedOf(0), { cutSide: 1 })).toMatchObject({ winner: 0, by: 'annihilation' });
      expect(play(map as MapId, ['kdf', 'kdf'], seedOf(0), { cutSide: 0 })).toMatchObject({ winner: 1, by: 'annihilation' });
    }
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('selfCheck', () => {
  // Four games a map, on every map a room is offered on: four maps since the
  // versus maps (2026-10-14), ~2 s alone and ~8 s under a full parallel run.
  it('passes on the probe as shipped, on each map a room is offered on', () => {
    for (const map of VERSUS_FAIR_MAPS) expect(selfCheck(map as MapId), map).toEqual([]);
  }, 60_000);

  // The mutants below stand in for the source mutations in versus-probe.ts's
  // header (M1 swaps the winner, M2 orders nobody, M3 unseeds the sim): each is
  // a `play` that is wrong in one way, and the check has to name it.
  const swapped: PlayFn = (m, a, s, o) => {
    const g = play(m, a, s, o);
    return { ...g, winner: g.winner === null ? null : g.winner === 0 ? 1 : 0 };
  };
  const ordersNobody: PlayFn = (m, a, s, o) => play(m, a, s, { ...o, capTicks: 100 });   // nobody closes before the cap
  const unseeded = (): PlayFn => { let n = 0; return (m, a, s, o) => play(m, a, s + (n++ % 2), o); };
  const uncut: PlayFn = (m, a, s, o) => play(m, a, s, { ...o, cutSide: undefined });

  it('goes red when the sides are swapped (M1)', () => {
    const failed = selfCheck('tel_marum', swapped);
    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('should win by annihilation');
  }, FULL_GAMES_TIMEOUT_MS);
  it('goes red when the orders never close the distance, so a control runs to the cap (M2)', () => {
    const failed = selfCheck('tel_marum', ordersNobody);
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(failed.join('\n')).toContain('by cap');
  });
  it('goes red when one seed reads two different games (M3)', () => {
    const failed = selfCheck('tel_marum', unseeded());
    expect(failed.some((f) => f.includes('one seed played twice'))).toBe(true);
  }, FULL_GAMES_TIMEOUT_MS);
  it('goes red when the control does not cut the weak side', () => {
    expect(selfCheck('tel_marum', uncut).length).toBeGreaterThanOrEqual(1);
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('tally', () => {
  it('counts wins by side, draws, how the games ended and their length', () => {
    const t = tally([game(0), game(0, 'cap', 12000), game(1, 'stalemate', 600), game(null, 'mutual', 400), game(null, 'cap', 12000)]);
    expect(t).toEqual({ seeds: 5, wins: [2, 1], draws: 2, by: { annihilation: 1, mutual: 1, stalemate: 1, cap: 2 }, ticks: 1200 + 12000 + 600 + 400 + 12000 });
  });
  it('an empty cell is zero everywhere', () => {
    expect(tally([])).toEqual({ seeds: 0, wins: [0, 0], draws: 0, by: { annihilation: 0, mutual: 0, stalemate: 0, cap: 0 }, ticks: 0 });
  });
});

describe('reading (the 60/40 bar)', () => {
  const cell = (w0: number, w1: number, seeds = 48) => tally([...Array(w0).fill(game(0)), ...Array(w1).fill(game(1)), ...Array(seeds - w0 - w1).fill(game(null, 'cap'))]);

  it('a mirror cell is read by side: west against east', () => {
    expect(reading(['kdf', 'kdf'], cell(20, 28))).toMatchObject({ labels: ['west', 'east'], wins: [20, 28], leader: 'east', leaderPercent: 58.3, within: true });
  });
  it('28 of 48 is within 60/40 and 29 of 48 is not, from either side', () => {
    expect(reading(['kdf', 'kdf'], cell(20, 28)).within).toBe(true);
    expect(reading(['kdf', 'kdf'], cell(19, 29)).within).toBe(false);
    expect(reading(['kdf', 'kdf'], cell(29, 19)).within).toBe(false);
    expect(reading(['kdf', 'kdf'], cell(28, 20)).within).toBe(true);
  });
  it('the bar is inclusive: exactly 60% is within, one more is not', () => {
    expect(reading(['kdf', 'kdf'], cell(6, 4, 10)).within).toBe(true);
    expect(reading(['kdf', 'kdf'], cell(3, 7, 10)).within).toBe(false);
  });
  it('level is no leader', () => {
    expect(reading(['kdf', 'kdf'], cell(24, 24))).toMatchObject({ leader: null, leaderPercent: 50, within: true });
  });
  it('a draw is nobody\'s: the share is of all the seeds', () => {
    expect(reading(['kdf', 'kdf'], cell(29, 0, 48))).toMatchObject({ leaderPercent: 60.4, within: false });
    expect(reading(['kdf', 'kdf'], cell(28, 0, 48))).toMatchObject({ leaderPercent: 58.3, within: true });
  });
  it('a KDF-against-Sarim cell is read by faction, whichever spawn each stands on', () => {
    // KDF west: the west wins are the KDF's.
    expect(reading(['kdf', 'sarim'], cell(19, 29))).toMatchObject({ labels: ['KDF', 'Sarim'], wins: [19, 29], leader: 'Sarim' });
    // Sarim west: the east wins are the KDF's.
    expect(reading(['sarim', 'kdf'], cell(19, 29))).toMatchObject({ labels: ['KDF', 'Sarim'], wins: [29, 19], leader: 'KDF' });
  });
});

describe('the command line', () => {
  it('reads arrangements as <faction>/<faction>', () => {
    expect(parseArrangements('kdf/kdf,kdf/sarim,sarim/kdf')).toEqual([['kdf', 'kdf'], ['kdf', 'sarim'], ['sarim', 'kdf']]);
    for (const bad of ['kdf', 'kdf/rif', 'kdf/sarim/kdf', '', 'kdf/kdf,']) expect(() => parseArrangements(bad), bad).toThrow(/--arr/);
  });
  it('--maps=all is every shipped map but the tile studies and the tutorial, the open ones among them', () => {
    const all = candidateMaps();
    for (const map of VERSUS_FAIR_MAPS) expect(all).toContain(map);
    expect(all.filter((m) => m.startsWith('tile_') || m === 'tutorial_ground')).toEqual([]);
    expect(all.length).toBeGreaterThan(VERSUS_FAIR_MAPS.length);
  });
});

describe('main', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const run = (playFn?: PlayFn) => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
    const code = main(['--maps=tel_marum', '--seeds=2', '--arr=kdf/kdf'], playFn);
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('prints the table and exits 0 -- report-only -- whatever the reading says', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('self-check: 1 map(s)');
    expect(r.out).toMatch(/tel_marum\s+kdf\/kdf\s+\d+\s+\d+/);
    // Two seeds are not the bar, and it says so.
    expect(r.out).toContain('only 2 seeds: the bar is 48');
  }, FULL_GAMES_TIMEOUT_MS);
  it('a failed self-check exits 2 and prints no table: a probe that cannot tell its sides apart reports nothing', () => {
    const swapped: PlayFn = (m, a, s, o) => {
      const g = play(m, a, s, o);
      return { ...g, winner: g.winner === null ? null : g.winner === 0 ? 1 : 0 };
    };
    const r = run(swapped);
    expect(r.code).toBe(2);
    expect(r.err).toContain('SELF-CHECK FAILED');
    expect(r.out).not.toMatch(/tel_marum\s+kdf\/kdf/);
  }, FULL_GAMES_TIMEOUT_MS);
  it('refuses a map the build does not ship', () => {
    expect(() => main(['--maps=atlantis'])).toThrow(/not a shipped map/);
  });
});
