// N4b task 13: the arena's scoring (decision D7). Each seed is played twice
// with the seats swapped, so a player's score is its own results wherever it
// sat: (wins + draws / 2) / non-void games. Fake records only -- the arena's
// own run is arena.test.ts.
import { describe, expect, it } from 'vitest';
import type { Faction, Matchup } from '@lions/net';
import { binomialP, gateVerdict, headToHead, markdownReport, tally, type GameRecord } from './arena-score';

const LINE = { lost: 0, lostValue: 0, destroyed: 0, destroyedValue: 0, remaining: 100 };
const REPORT = { tokens: null, timeouts: 0, errors: [] };

function game(players: [string, string], outcome: GameRecord['outcome'], o: { matchup?: Matchup; factions?: [Faction, Faction]; seed?: number; by?: string } = {}): GameRecord {
  return {
    seed: o.seed ?? 1000,
    map: 'tel_marum',
    matchup: o.matchup ?? 'mirror',
    players,
    factions: o.factions ?? ['kdf', 'kdf'],
    outcome,
    by: o.by ?? (outcome === 'void' ? 'desync' : outcome === 'draw' ? 'time' : 'annihilation'),
    ticks: 1200,
    score: [LINE, LINE],
    reports: [REPORT, REPORT],
  };
}

describe('tally (D7)', () => {
  it('credits the player, not the seat: seat 0 always wins, A and B alternate seats, each scores 0.5', () => {
    const games = [
      game(['A', 'B'], 'seat0', { seed: 1000 }),
      game(['B', 'A'], 'seat0', { seed: 1000 }),
      game(['A', 'B'], 'seat0', { seed: 8919 }),
      game(['B', 'A'], 'seat0', { seed: 8919 }),
    ];
    const t = tally(games);
    for (const p of ['A', 'B']) {
      const row = t.get(p);
      expect(row).toMatchObject({ player: p, games: 4, wins: 2, draws: 0, losses: 2, voids: 0, score: 0.5 });
      // Both won every game they played from seat 0 and lost every one from seat 1.
      expect(row?.bySeat).toEqual([1, 0]);
    }
  });

  it('counts a draw as half: A wins one and draws one of two, 0.75', () => {
    const t = tally([game(['A', 'B'], 'seat0'), game(['B', 'A'], 'draw')]);
    expect(t.get('A')).toMatchObject({ games: 2, wins: 1, draws: 1, losses: 0, score: 0.75 });
    expect(t.get('B')).toMatchObject({ games: 2, wins: 0, draws: 1, losses: 1, score: 0.25 });
  });

  it('counts a void and leaves it out of the denominator', () => {
    const t = tally([game(['A', 'B'], 'seat0'), game(['B', 'A'], 'void'), game(['A', 'B'], 'seat1')]);
    // One win, one loss, one void: 1 / (3 - 1).
    expect(t.get('A')).toMatchObject({ games: 3, wins: 1, draws: 0, losses: 1, voids: 1, score: 0.5 });
    expect(t.get('B')).toMatchObject({ games: 3, wins: 1, draws: 0, losses: 1, voids: 1, score: 0.5 });
    // All void: no score at all, never a zero that reads as a loss.
    expect(tally([game(['A', 'B'], 'void')]).get('A')?.score).toBeNaN();
  });

  it('splits by faction: A wins every game as KDF and loses every one as Sarim, 0.5 overall', () => {
    // matchup `kdf`: the host's seat (0) is KDF; swapping seats swaps factions.
    const games = [
      game(['A', 'B'], 'seat0', { matchup: 'kdf', factions: ['kdf', 'sarim'] }),
      game(['B', 'A'], 'seat0', { matchup: 'kdf', factions: ['kdf', 'sarim'] }),
    ];
    const a = tally(games).get('A');
    expect(a?.score).toBe(0.5);
    expect(a?.byFaction.kdf).toBe(1);
    expect(a?.byFaction.sarim).toBe(0);
    // A mirror never plays Sarim: no number, not a zero.
    expect(tally([game(['A', 'B'], 'seat0')]).get('A')?.byFaction.sarim).toBeNaN();
  });
});

describe('markdownReport', () => {
  it('names each player\'s tally, each game with its scoreboard, and tokens only when a player said', () => {
    const quiet = markdownReport([game(['A', 'B'], 'seat0'), game(['B', 'A'], 'draw')]);
    expect(quiet).toMatch(/\| A \| 2 \| 1 \| 1 \| 0 \| 0 \| 0\.750 \|/);
    expect(quiet).toMatch(/\| 1000 \| tel_marum \| mirror \| A \| B \| A \| annihilation \| 1200 \|/);
    expect(quiet).not.toMatch(/tokens/i);
    const spoken = game(['A', 'B'], 'seat1');
    spoken.reports = [{ tokens: 4321, timeouts: 0, errors: [] }, REPORT];
    expect(markdownReport([spoken])).toMatch(/tokens/i);
    expect(markdownReport([spoken])).toContain('4321');
  });
});

// The statistical gate (ruled 15 Oct, coordinator, lead-delegated). Every
// expectation below is a LITERAL, computed outside this code (Python's
// math.comb over fractions.Fraction): P(X >= k) for X ~ Bin(n, 1/2), never
// recomputed from the function under test.
describe('binomialP: one-sided exact P(X >= k), X ~ Bin(n, 1/2)', () => {
  it('matches exact fractions', () => {
    expect(binomialP(15, 20)).toBe(21700 / 1048576);         // 0.020695: the ruling's "15 of 20 is p ~ 0.02"
    expect(binomialP(10, 20)).toBe(308333 / 524288);         // 0.588099
    expect(binomialP(30, 40)).toBe(305311533 / 274877906944); // 0.001111
    expect(binomialP(26, 40)).toBe(11090013443 / 274877906944); // 0.040345
    expect(binomialP(25, 40)).toBe(21146349707 / 274877906944); // 0.076930
    expect(binomialP(5, 20)).toBe(260595 / 262144);           // 0.994091
  });
  it('k = n is 2^-n, k = 0 is 1, and no games is 1 (no evidence)', () => {
    expect(binomialP(20, 20)).toBe(1 / 1048576);
    expect(binomialP(5, 5)).toBe(1 / 32);
    expect(binomialP(0, 20)).toBe(1);
    expect(binomialP(0, 0)).toBe(1);
  });
  it('a half point (a draw) is the mean of P(X >= floor k) and P(X >= ceil k)', () => {
    // (15115/262144 + 5425/262144) / 2
    expect(binomialP(14.5, 20)).toBe(5135 / 131072);
    // (P(X>=1|3) + P(X>=2|3)) / 2 = (7/8 + 4/8) / 2
    expect(binomialP(1.5, 3)).toBe(11 / 16);
  });
  it('refuses what is not a count', () => {
    expect(() => binomialP(-1, 20)).toThrow();
    expect(() => binomialP(21, 20)).toThrow();
    expect(() => binomialP(Number.NaN, 20)).toThrow();
    expect(() => binomialP(1, 2.5)).toThrow();
    expect(() => binomialP(0, -1)).toThrow();
  });
});

/** `wins` A-wins, `draws` draws, `losses` A-losses and `voids` voids between A and B, alternating seats. */
function season(wins: number, draws: number, losses: number, voids = 0): GameRecord[] {
  const out: GameRecord[] = [];
  const push = (result: 'A' | 'B' | 'draw' | 'void'): void => {
    const aSeat = out.length % 2;
    const players: [string, string] = aSeat === 0 ? ['A', 'B'] : ['B', 'A'];
    const outcome: GameRecord['outcome'] = result === 'draw' || result === 'void' ? result
      : (result === 'A') === (aSeat === 0) ? 'seat0' : 'seat1';
    out.push(game(players, outcome, { seed: 1000 + 7919 * Math.floor(out.length / 2) }));
  };
  for (let i = 0; i < wins; i++) push('A');
  for (let i = 0; i < draws; i++) push('draw');
  for (let i = 0; i < losses; i++) push('B');
  for (let i = 0; i < voids; i++) push('void');
  return out;
}

describe('headToHead and the gate (p < 0.05, A over B)', () => {
  it('A clearly better (15-0-5): n 20, score 0.750, p 0.020695, PASS', () => {
    const v = gateVerdict(season(15, 0, 5), 'A', 'B');
    expect(v).toMatchObject({ n: 20, wins: 15, draws: 0, losses: 5, score: 0.75, p: 21700 / 1048576, pass: true });
    expect(v.line).toBe('gate: PASS  A over B  n=20  score=0.750  p=0.02069');
  });
  it('the players swapped (B over A on the same games): p 0.994091, FAIL', () => {
    const v = gateVerdict(season(15, 0, 5), 'B', 'A');
    expect(v).toMatchObject({ n: 20, wins: 5, losses: 15, score: 0.25, p: 260595 / 262144, pass: false });
    expect(v.line).toBe('gate: FAIL  B over A  n=20  score=0.250  p=0.9941');
  });
  it('leaves voids out of n: 15-0-5 with three voids is still n 20 and PASS', () => {
    // Counted in n (as losses), it would read 15 of 23, p 0.105: FAIL.
    const v = gateVerdict(season(15, 0, 5, 3), 'A', 'B');
    expect(v).toMatchObject({ n: 20, p: 21700 / 1048576, pass: true });
  });
  it('counts a draw as half: 14-1-5 is k 14.5 of 20, p 0.039177, PASS', () => {
    // As a loss it would be 14 of 20, p 0.057659: FAIL.
    const v = gateVerdict(season(14, 1, 5), 'A', 'B');
    expect(v).toMatchObject({ n: 20, wins: 14, draws: 1, losses: 5, score: 0.725, p: 5135 / 131072, pass: true });
  });
  it('is strict: p equal to alpha fails (5-0 is p 1/32 exactly)', () => {
    // At alpha 0.05 the boundary cannot occur (every p here is dyadic), so the
    // strictness is pinned at a dyadic alpha.
    expect(gateVerdict(season(5, 0, 0), 'A', 'B', 1 / 32).pass).toBe(false);
    expect(gateVerdict(season(5, 0, 0), 'A', 'B', 1 / 16).pass).toBe(true);
    expect(gateVerdict(season(5, 0, 0), 'A', 'B').pass).toBe(true);
  });
  it('reads only games between A and B; with none it is n 0, p 1 and FAIL', () => {
    const others = [game(['A', 'C'], 'seat0'), game(['C', 'B'], 'seat0')];
    expect(headToHead([...season(15, 0, 5), ...others], 'A', 'B')).toMatchObject({ n: 20, wins: 15 });
    const none = gateVerdict(others, 'A', 'B');
    expect(none).toMatchObject({ n: 0, p: 1, pass: false });
    expect(none.score).toBeNaN();
    expect(none.line).toBe('gate: FAIL  A over B  n=0  score=—  p=1.000');
  });
  it('the report names A over B with n, score and p (the first game\'s seat 0 is A)', () => {
    const md = markdownReport(season(15, 0, 5));
    expect(md).toContain('| A over B | 20 | 15 | 0 | 5 | 0.750 | 0.02069 |');
    expect(markdownReport(season(15, 0, 5), ['B', 'A'])).toContain('| B over A | 20 | 5 | 0 | 15 | 0.250 | 0.9941 |');
  });
});
