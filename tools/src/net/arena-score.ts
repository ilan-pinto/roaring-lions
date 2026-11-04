/**
 * The arena's scoring (N4b task 13, decision D7). Versus has no
 * `MissionRuntime`, so no Conduct: each seed is played twice with the seats
 * swapped, and a player's score is its own results wherever it sat --
 * `(wins + draws / 2) / (games - voids)`. Reported per seat and per faction
 * beside the whole, with the scoreboard (decision 25) in place of Conduct.
 * Tokens, cache tokens and cost are reported when an external player printed them (`usageOf`), never scored.
 *
 * Pure: records in, numbers and markdown out. Nothing here plays a game.
 */
import type { Faction, Matchup, WinMode } from '@lions/net';
import type { MatchScore, SideScore } from '../../../packages/app/src/net/scoreboard';
import type { Usage } from './external-player';
import type { JudgeRecord } from './judge';
import { CRITERIA, CRITERION_IDS, SEAT_KEYS, refereeMarkdown, scoresMarkdown, type RefereeStats } from './match-score';
import type { PlayerReport } from './players';

export interface GameRecord {
  seed: number;
  map: string;
  matchup: Matchup;
  /** How the room was won beside annihilation (GH-976 P2): `annihilation` or the win mode. Absent on a record from before. */
  mode?: 'annihilation' | WinMode;
  /** By SEAT. */
  players: [string, string];
  /** By seat. */
  factions: [Faction, Faction];
  outcome: 'seat0' | 'seat1' | 'draw' | 'void';
  /** annihilation | stalemate | time | cap | forfeit | surrender | left | mutual;
   *  for a void: desync (the room sent it), disagree (the two sims reported
   *  different results), timeout, or the room's own ending reason (e.g.
   *  `expired`); `unfinished` when the room never closed (the arena's own
   *  fallback, not a room reason). */
  by: string;
  ticks: number;
  /** GH-954 P1, the run's own terms, so two records can be told comparable or not. Absent on a record from before
   *  (never guessed): read them through `runFieldsOf` (arena-record.ts). `build` is the room's `${version}+${commit}`. */
  build: string;
  /** Ticks a paced round. */
  pace: number;
  /** Wall time a paced round is held to, in ms. */
  roundWallMs: number;
  /** The tick the arena calls the game at. */
  capTicks: number;
  /** sha256 (hex) of the standing prompt and the tool list the players were offered (`currentPromptDigest`). */
  promptDigest: string;
  /** By SEAT (`bySeat` in arena.ts re-indexes the by-side board through the config's sides; LD1 puts a
   *  Sarim host on side 1), from the reading seat's sim at the end (seat 0's in-process, else seat 1's, else the observer's). */
  score: MatchScore;
  /** By seat. */
  reports: [PlayerReport, PlayerReport];
  /** The referee's end-of-match stats for both seats (GH-973), from the reading seat's sim; absent on a record from before. */
  referee?: RefereeStats;
  /** The judge's scores (GH-973); absent: not judged. Scores are for reading and never change `outcome` or a tally (D7). */
  judge?: JudgeRecord;
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

/** The largest n `binomialP` takes: 2^n stays a finite double up to 1023. */
const BINOMIAL_MAX_N = 1000;

/** P(X >= k) for X ~ Bin(n, 1/2) and an integer k, exactly: the sum of
 *  C(n, i) for i = k..n over 2^n, in BigInt. The one rounding is the
 *  numerator's conversion to a double; dividing by a power of two is exact. */
function upperTail(k: number, n: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let c = 1n;          // C(n, 0)
  let sum = 0n;
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += c;
    c = (c * BigInt(n - i)) / BigInt(i + 1);   // C(n, i + 1), exact: C(n,i)(n-i) is divisible by i+1
  }
  return Number(sum) / 2 ** n;
}

/**
 * The statistical gate's p (ruled 15 Oct, coordinator, lead-delegated): the
 * one-sided exact binomial P(X >= k) for X ~ Bin(n, 1/2), the chance that a
 * player no better than its opponent scores k or more of n non-void games.
 * Draws count half (D7), so k = wins + draws / 2 may end in .5; then p is
 * the MEAN of P(X >= floor k) and P(X >= ceil k), which sits between the
 * draw-as-loss and draw-as-win readings and equals both for an integer k.
 * No games (n = 0) is p = 1: no evidence. n is a whole number 0-1000 and
 * 0 <= k <= n; anything else throws.
 */
export function binomialP(k: number, n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > BINOMIAL_MAX_N) throw new RangeError(`binomialP: n is a whole number 0-${BINOMIAL_MAX_N}, not ${n}`);
  if (Number.isNaN(k) || k < 0 || k > n) throw new RangeError(`binomialP: k is 0-${n}, not ${k}`);
  return (upperTail(Math.floor(k), n) + upperTail(Math.ceil(k), n)) / 2;
}

/** A against B over the games the two of them played, from A's side. */
export interface HeadToHead {
  a: string;
  b: string;
  /** Non-void games between A and B. */
  n: number;
  wins: number;
  draws: number;
  losses: number;
  /** D7's score for A, (wins + draws / 2) / n; NaN when n is 0. */
  score: number;
  /** One-sided, A better than B: `binomialP(wins + draws / 2, n)`. */
  p: number;
}

/** A's record against B. Games with any other player are not read, and a void is not a game here. */
export function headToHead(games: readonly GameRecord[], a: string, b: string): HeadToHead {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const g of games) {
    const seatA = g.players.indexOf(a);
    if (seatA < 0 || g.players[1 - seatA] !== b) continue;
    if (g.outcome === 'void') continue;
    if (g.outcome === 'draw') draws++;
    else if (g.outcome === `seat${seatA}`) wins++;
    else losses++;
  }
  const n = wins + draws + losses;
  const k = wins + draws / 2;
  return { a, b, n, wins, draws, losses, score: n === 0 ? Number.NaN : k / n, p: binomialP(k, n) };
}

/** The gate's level: A must beat B with p < 0.05 (ruled 15 Oct, coordinator, lead-delegated). */
export const GATE_ALPHA = 0.05;

export interface GateVerdict extends HeadToHead {
  pass: boolean;
  /** `gate: PASS|FAIL  <A> over <B>  n=<n>  score=<s>  p=<p>`. */
  line: string;
}

/** Whether the arena told A from B: PASS iff p < alpha, strictly. */
export function gateVerdict(games: readonly GameRecord[], a: string, b: string, alpha: number = GATE_ALPHA): GateVerdict {
  const h = headToHead(games, a, b);
  const pass = h.p < alpha;
  return { ...h, pass, line: `gate: ${pass ? 'PASS' : 'FAIL'}  ${a} over ${b}  n=${h.n}  score=${num(h.score)}  p=${pval(h.p)}` };
}

/** p to four significant figures. */
export const pval = (p: number): string => p.toPrecision(4);
/** What several clients said they spent. A field is null when NO source said it (not zero: a client that did not
 *  say is not a client that spent nothing). */
export type UsageSum = Usage;

const addNullable = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : a + b);

/** The sum of the usages that exist; null when none does. */
export function sumUsage(list: readonly (Usage | null | undefined)[]): UsageSum | null {
  let out: UsageSum | null = null;
  for (const u of list) {
    if (u === null || u === undefined) continue;
    out = out === null
      ? { ...u }
      : {
        inputTokens: out.inputTokens + u.inputTokens,
        outputTokens: out.outputTokens + u.outputTokens,
        cacheCreationInputTokens: addNullable(out.cacheCreationInputTokens, u.cacheCreationInputTokens),
        cacheReadInputTokens: addNullable(out.cacheReadInputTokens, u.cacheReadInputTokens),
        costUsd: addNullable(out.costUsd, u.costUsd),
      };
  }
  return out;
}

/** A run's spend (GH-954 W2): per player (by the name a tally keys on), the judge's, and all together. Reported, never scored (D7). */
export interface UsageTotals {
  byPlayer: { player: string; usage: UsageSum }[];
  judge: UsageSum | null;
  all: UsageSum | null;
}

export function usageTotals(games: readonly GameRecord[]): UsageTotals {
  const by = new Map<string, Usage[]>();
  for (const g of games) {
    for (const s of [0, 1] as const) {
      const u = g.reports[s].usage;
      if (u !== undefined) by.set(g.players[s], [...(by.get(g.players[s]) ?? []), u]);
    }
  }
  const judges = games.map((g) => (g.judge === undefined || g.judge.status === 'skipped' ? undefined : g.judge.usage));
  const judge = sumUsage(judges);
  const byPlayer = [...by.entries()].flatMap(([player, list]) => {
    const usage = sumUsage(list);
    return usage === null ? [] : [{ player, usage }];
  });
  return { byPlayer, judge, all: sumUsage([...byPlayer.map((b) => b.usage), judge]) };
}

const orDash = (v: number | null): string | number => (v === null ? '—' : v);
const usd = (v: number | null): string => (v === null ? '—' : `$${v.toFixed(4)}`);

const num = (v: number): string => (Number.isNaN(v) ? '—' : v.toFixed(3));
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const line = (cells: readonly (string | number)[]): string => `| ${cells.map((c) => cell(String(c))).join(' | ')} |`;
const board = (s: SideScore): string[] => [`${s.lost} (${s.lostValue})`, `${s.destroyed} (${s.destroyedValue})`, String(s.remaining)];

/** What decided a game, in words a report reader wants (GH-976 P2): a win mode's goal by name, surviving force for a limit or a
 *  stalemate, anything else as the raw `by`. */
export function decidedBy(g: Pick<GameRecord, 'by' | 'mode'>): string {
  if (g.by === 'objective') return g.mode === 'points' ? 'points race' : g.mode === 'camp' ? 'camp razed' : 'objective';
  if (g.by === 'cap' || g.by === 'time' || g.by === 'stalemate') return 'surviving force';
  return g.by;
}

const modeOf = (g: Pick<GameRecord, 'mode'>): string => g.mode ?? 'annihilation';

function winnerOf(g: GameRecord): string {
  if (g.outcome === 'seat0') return g.players[0];
  if (g.outcome === 'seat1') return g.players[1];
  return g.outcome;
}

/**
 * The scores (GH-973): what the judge made of each game, or `not judged`. A
 * table of every judged game, each player's mean per criterion, then the
 * judge's reasons game by game, with the referee's numbers beside them. A game
 * the judge could not score says why; nothing is filled in.
 */
export function scoreSections(games: readonly GameRecord[]): string[] {
  const out: string[] = ['', '## Scores', ''];
  if (!games.some((g) => g.judge !== undefined)) {
    out.push('Not judged. Run with `--judge "cmd:<template>"` to have a third model score both players of each game 1-10 on five criteria.');
    if (games.some((g) => g.referee !== undefined)) {
      out.push('', '### Referee\'s stats', '');
      out.push(...refereeTable(games));
    }
    return out;
  }
  out.push('A third model (the judge) scored both players of each game, 1-10 per criterion with a one-line reason each, from the referee\'s stats. Scores are for reading: they change no result and no tally (D7).');
  out.push('');
  out.push(line(['game', 'seed', 'seat', 'player', ...CRITERIA.map((c) => c.label), 'Overall']));
  out.push(line(Array.from({ length: 5 + CRITERIA.length }, () => '---')));
  const sums = new Map<string, { n: number; crit: number[]; overall: number }>();
  games.forEach((g, i) => {
    const j = g.judge;
    if (j?.status === 'scored') {
      for (const seat of [0, 1] as const) {
        const p = j.scores[SEAT_KEYS[seat]];
        out.push(line([i + 1, g.seed, seat, g.players[seat], ...CRITERION_IDS.map((id) => p.criteria[id].score), p.overall.score]));
        const acc = sums.get(g.players[seat]) ?? { n: 0, crit: CRITERION_IDS.map(() => 0), overall: 0 };
        acc.n++;
        CRITERION_IDS.forEach((id, k) => { acc.crit[k] += p.criteria[id].score; });
        acc.overall += p.overall.score;
        sums.set(g.players[seat], acc);
      }
    } else {
      out.push(line([i + 1, g.seed, '—', '—', ...(j === undefined ? ['not judged'] : [judgeNote(j)]), ...Array.from({ length: CRITERIA.length }, () => '')]));
    }
  });
  if (sums.size > 0) {
    out.push('', '### Mean scores by player', '');
    out.push(line(['player', 'games scored', ...CRITERIA.map((c) => c.label), 'Overall']));
    out.push(line(Array.from({ length: 3 + CRITERIA.length }, () => '---')));
    for (const [player, a] of sums) out.push(line([player, a.n, ...a.crit.map((v) => (v / a.n).toFixed(1)), (a.overall / a.n).toFixed(1)]));
  }
  games.forEach((g, i) => {
    out.push('', `### Game ${i + 1}: seed ${g.seed}, ${g.players[0]} (seat 0) vs ${g.players[1]} (seat 1)`, '');
    if (g.referee !== undefined) out.push(...refereeMarkdown(g.referee, g.players), '');
    const j = g.judge;
    if (j === undefined) out.push('Not judged.');
    else if (j.status === 'scored') out.push(...scoresMarkdown(j.scores, g.players));
    else out.push(`Not scored: ${judgeNote(j)}.`, ...(j.status === 'invalid' ? j.problems.map((p) => `- ${p}`) : []));
  });
  return out;
}

function judgeNote(j: JudgeRecord): string {
  switch (j.status) {
    case 'scored': return 'scored';
    case 'invalid': return `the judge's reply was not a valid score (${j.problems.length} problem(s))`;
    case 'failed': return `the judge failed: ${j.reason}`;
    case 'skipped': return `skipped: ${j.reason}`;
  }
}

/** The referee's numbers for every game, one row per seat. */
function refereeTable(games: readonly GameRecord[]): string[] {
  const out: string[] = [line(['game', 'seed', 'seat', 'player', 'deaths', 'men killed', 'units lost (value)', 'destroyed (value)', 'wounded fell', 'rescued', 'died', 'idle %', 'orders', 'first order']), line(Array.from({ length: 14 }, () => '---'))];
  games.forEach((g, i) => {
    if (g.referee === undefined) return;
    for (const s of g.referee.seats) {
      out.push(line([i + 1, g.seed, s.seat, g.players[s.seat], s.deaths, s.menKilled, `${s.unitsLost} (${s.lostValue})`, `${s.destroyed} (${s.destroyedValue})`, s.woundedFell, s.woundedRescued, s.woundedDied, s.idlePct ?? '—', s.ordersSent, s.firstOrderTick ?? '—']));
    }
  });
  // GH-976 P2: a points race adds its points by source, per seat.
  if (games.some((g) => g.referee?.seats.some((s) => s.points !== undefined) === true)) {
    out.push('', 'Points by source (a points race): held zones and enemy units destroyed.', '');
    out.push(line(['game', 'seed', 'seat', 'player', 'points', 'from zones', 'from kills', 'by zone']), line(Array.from({ length: 8 }, () => '---')));
    games.forEach((g, i) => {
      for (const s of g.referee?.seats ?? []) {
        if (s.points === undefined) continue;
        const zones = Object.entries(s.points.byZone).map(([z, v]) => `${z} ${v}`).join(', ');
        out.push(line([i + 1, g.seed, s.seat, g.players[s.seat], s.points.total, s.points.fromZones, s.points.fromKills, zones === '' ? '—' : zones]));
      }
    });
  }
  return out;
}

/** The report: each player's tally (whole, by seat, by faction), A against B
 *  with its one-sided p, then every game with its scoreboard, then tokens --
 *  only when a player said any. `pair` is [A, B]; by default the first game's
 *  seats, which is the arena's A and B (game 1 has A on seat 0). */
export function markdownReport(games: readonly GameRecord[], pair: readonly [string, string] | undefined = games[0]?.players): string {
  const out: string[] = [];
  const first = games[0];
  out.push(`# Arena: ${first === undefined ? 'no games' : `${first.map}, ${first.matchup}${modeOf(first) === 'annihilation' ? '' : `, ${modeOf(first)}`}`}`);
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
  if (pair !== undefined) {
    const h = headToHead(games, pair[0], pair[1]);
    out.push('');
    out.push('## Head to head');
    out.push('');
    out.push(`n = non-void games between the two; p = one-sided exact binomial P(X >= wins + draws / 2), X ~ Bin(n, 1/2), the chance a player no better than its opponent scores this well (a half point averages the two whole ones). The gate (\`--gate\`) passes at p < ${GATE_ALPHA}.`);
    out.push('');
    out.push(line(['', 'n', 'won', 'drawn', 'lost', 'score', 'p']));
    out.push(line(Array.from({ length: 7 }, () => '---')));
    out.push(line([`${h.a} over ${h.b}`, h.n, h.wins, h.draws, h.losses, num(h.score), pval(h.p)]));
  }
  out.push('');
  out.push('## Games');
  out.push('');
  out.push('Scoreboard columns are each seat\'s units lost and destroyed (with their value) and the force value it has left, read from seat 0\'s sim at the end.');
  out.push('');
  out.push(line(['seed', 'map', 'matchup', 'mode', 'seat 0', 'seat 1', 'winner', 'by', 'decided by', 'ticks', 'factions', 'seat 0 lost', 'seat 0 destroyed', 'seat 0 left', 'seat 1 lost', 'seat 1 destroyed', 'seat 1 left']));
  out.push(line(Array.from({ length: 17 }, () => '---')));
  for (const g of games) {
    out.push(line([g.seed, g.map, g.matchup, modeOf(g), g.players[0], g.players[1], winnerOf(g), g.by, decidedBy(g), g.ticks, `${g.factions[0]} / ${g.factions[1]}`, ...board(g.score[0]), ...board(g.score[1])]));
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
  if (games.some((g) => g.reports.some((r) => r.usage !== undefined))) {
    out.push('');
    out.push('## Usage');
    out.push('');
    out.push('Input, output and cache tokens and the client\'s own cost, as each external player printed them (— = it did not say); never scored (D7).');
    out.push('');
    out.push(line(['seed', 'seat', 'player', 'input', 'output', 'cache written', 'cache read', 'cost']));
    out.push(line(Array.from({ length: 8 }, () => '---')));
    for (const g of games) {
      for (const s of [0, 1] as const) {
        const u = g.reports[s].usage;
        if (u !== undefined) out.push(line([g.seed, s, g.players[s], u.inputTokens, u.outputTokens, orDash(u.cacheCreationInputTokens), orDash(u.cacheReadInputTokens), usd(u.costUsd)]));
      }
    }
    const totals = usageTotals(games);
    out.push('');
    out.push('Run totals:');
    out.push('');
    out.push(line(['', 'input', 'output', 'cache written', 'cache read', 'cost']));
    out.push(line(Array.from({ length: 6 }, () => '---')));
    const row = (who: string, u: UsageSum): string => line([who, u.inputTokens, u.outputTokens, orDash(u.cacheCreationInputTokens), orDash(u.cacheReadInputTokens), usd(u.costUsd)]);
    for (const b of totals.byPlayer) out.push(row(b.player, b.usage));
    if (totals.judge !== null) out.push(row('judge', totals.judge));
    if (totals.all !== null) out.push(row('all', totals.all));
  }
  out.push(...scoreSections(games));
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
