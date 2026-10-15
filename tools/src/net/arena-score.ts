/**
 * The arena's scoring (N4b task 13, decision D7). Versus has no
 * `MissionRuntime`, so no Conduct: each seed is played twice with the seats
 * swapped, and a player's score is its own results wherever it sat --
 * `(wins + draws / 2) / (games - voids)`. Reported per seat and per faction
 * beside the whole, with the scoreboard (decision 25) in place of Conduct.
 * Tokens are reported when an external player printed them, never scored.
 *
 * Pure: records in, numbers and markdown out. Nothing here plays a game.
 */
import type { Faction, Matchup } from '@lions/net';
import type { MatchScore, SideScore } from '../../../packages/app/src/net/scoreboard';
import type { PlayerReport } from './players';

export interface GameRecord {
  seed: number;
  map: string;
  matchup: Matchup;
  /** By SEAT. */
  players: [string, string];
  /** By seat. */
  factions: [Faction, Faction];
  outcome: 'seat0' | 'seat1' | 'draw' | 'void';
  /** annihilation | stalemate | time | cap | forfeit | surrender | left | mutual;
   *  for a void: desync (the room sent it), disagree (the two sims reported
   *  different results), timeout, unfinished, or the room's own ending reason
   *  (e.g. `expired`). */
  by: string;
  ticks: number;
  /** By SIDE, from seat 0's sim at the end. In versus seat s plays side s
   *  (`match-room.ts`), so index s is also seat s's line. */
  score: MatchScore;
  /** By seat. */
  reports: [PlayerReport, PlayerReport];
}

export interface Tally {
  player: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  voids: number;
  /** D7's score; NaN when every game was void (no result, which is not a zero). */
  score: number;
  /** The same score over the games played from seat 0, and from seat 1; NaN for none. */
  bySeat: [number, number];
  /** The same score over the games played as each faction; NaN for none. */
  byFaction: Record<Faction, number>;
}

/** Points and non-void games, for one cut of a player's record. */
interface Pot { points: number; played: number }
const pot = (): Pot => ({ points: 0, played: 0 });
/** D7: wins + draws / 2 over the non-void games. */
const rate = (p: Pot): number => (p.played === 0 ? Number.NaN : p.points / p.played);

/** Every player's tally, keyed by name, in the order each first appears. */
export function tally(games: readonly GameRecord[]): Map<string, Tally> {
  const acc = new Map<string, { t: Tally; all: Pot; seat: [Pot, Pot]; faction: Record<Faction, Pot> }>();
  for (const g of games) {
    for (const seat of [0, 1] as const) {
      const player = g.players[seat];
      let a = acc.get(player);
      if (a === undefined) {
        a = {
          t: { player, games: 0, wins: 0, draws: 0, losses: 0, voids: 0, score: Number.NaN, bySeat: [Number.NaN, Number.NaN], byFaction: { kdf: Number.NaN, sarim: Number.NaN } },
          all: pot(), seat: [pot(), pot()], faction: { kdf: pot(), sarim: pot() },
        };
        acc.set(player, a);
      }
      a.t.games++;
      if (g.outcome === 'void') { a.t.voids++; continue; }
      let points: number;
      if (g.outcome === 'draw') { a.t.draws++; points = 0.5; }
      else if (g.outcome === `seat${seat}`) { a.t.wins++; points = 1; }
      else { a.t.losses++; points = 0; }
      for (const p of [a.all, a.seat[seat], a.faction[g.factions[seat]]]) { p.points += points; p.played++; }
    }
  }
  const out = new Map<string, Tally>();
  for (const [player, a] of acc) {
    out.set(player, {
      ...a.t,
      score: rate(a.all),
      bySeat: [rate(a.seat[0]), rate(a.seat[1])],
      byFaction: { kdf: rate(a.faction.kdf), sarim: rate(a.faction.sarim) },
    });
  }
  return out;
}

const num = (v: number): string => (Number.isNaN(v) ? '—' : v.toFixed(3));
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const line = (cells: readonly (string | number)[]): string => `| ${cells.map((c) => cell(String(c))).join(' | ')} |`;
const board = (s: SideScore): string[] => [`${s.lost} (${s.lostValue})`, `${s.destroyed} (${s.destroyedValue})`, String(s.remaining)];

function winnerOf(g: GameRecord): string {
  if (g.outcome === 'seat0') return g.players[0];
  if (g.outcome === 'seat1') return g.players[1];
  return g.outcome;
}

/** The report: each player's tally (whole, by seat, by faction), then every
 *  game with its scoreboard, then tokens -- only when a player said any. */
export function markdownReport(games: readonly GameRecord[]): string {
  const out: string[] = [];
  const first = games[0];
  out.push(`# Arena: ${first === undefined ? 'no games' : `${first.map}, ${first.matchup}`}`);
  out.push('');
  out.push(`${games.length} game(s). Score = (wins + draws / 2) / (games - voids), decision D7; — is a cut with no non-void game.`);
  out.push('');
  out.push('## Players');
  out.push('');
  out.push(line(['player', 'games', 'won', 'drawn', 'lost', 'void', 'score', 'seat 0', 'seat 1', 'as KDF', 'as Sarim']));
  out.push(line(Array.from({ length: 11 }, () => '---')));
  for (const t of tally(games).values()) {
    out.push(line([t.player, t.games, t.wins, t.draws, t.losses, t.voids, num(t.score), num(t.bySeat[0]), num(t.bySeat[1]), num(t.byFaction.kdf), num(t.byFaction.sarim)]));
  }
  out.push('');
  out.push('## Games');
  out.push('');
  out.push('Scoreboard columns are each seat\'s units lost and destroyed (with their value) and the force value it has left, read from seat 0\'s sim at the end.');
  out.push('');
  out.push(line(['seed', 'map', 'matchup', 'seat 0', 'seat 1', 'winner', 'by', 'ticks', 'factions', 'seat 0 lost', 'seat 0 destroyed', 'seat 0 left', 'seat 1 lost', 'seat 1 destroyed', 'seat 1 left']));
  out.push(line(Array.from({ length: 15 }, () => '---')));
  for (const g of games) {
    out.push(line([g.seed, g.map, g.matchup, g.players[0], g.players[1], winnerOf(g), g.by, g.ticks, `${g.factions[0]} / ${g.factions[1]}`, ...board(g.score[0]), ...board(g.score[1])]));
  }
  const spoke = games.some((g) => g.reports.some((r) => r.tokens !== null));
  if (spoke) {
    out.push('');
    out.push('## Tokens');
    out.push('');
    out.push('As each external player printed them; never scored.');
    out.push('');
    out.push(line(['seed', 'seat 0', 'seat 0 tokens', 'seat 1', 'seat 1 tokens']));
    out.push(line(Array.from({ length: 5 }, () => '---')));
    for (const g of games) {
      out.push(line([g.seed, g.players[0], g.reports[0].tokens ?? '—', g.players[1], g.reports[1].tokens ?? '—']));
    }
  }
  const troubled = games.flatMap((g) => ([0, 1] as const).filter((s) => g.reports[s].timeouts > 0 || g.reports[s].errors.length > 0).map((s) => ({ g, s })));
  if (troubled.length > 0) {
    out.push('');
    out.push('## Player trouble');
    out.push('');
    out.push(line(['seed', 'player', 'seat', 'timeouts', 'first error']));
    out.push(line(Array.from({ length: 5 }, () => '---')));
    for (const { g, s } of troubled) out.push(line([g.seed, g.players[s], s, g.reports[s].timeouts, g.reports[s].errors[0] ?? '']));
  }
  out.push('');
  return out.join('\n');
}
