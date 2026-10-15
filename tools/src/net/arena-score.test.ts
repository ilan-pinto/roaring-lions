// N4b task 13: the arena's scoring (decision D7). Each seed is played twice
// with the seats swapped, so a player's score is its own results wherever it
// sat: (wins + draws / 2) / non-void games. Fake records only -- the arena's
// own run is arena.test.ts.
import { describe, expect, it } from 'vitest';
import type { Faction, Matchup } from '@lions/net';
import { markdownReport, tally, type GameRecord } from './arena-score';

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
