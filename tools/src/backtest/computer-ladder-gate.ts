// GH-1389: the computer ladder's pure parts -- the tally, the ordering gate and the table -- apart from the match runner
// so a test can feed them literal win counts. Nothing here plays a match or reads the sim.

export const LADDER_LEVELS = ['easy', 'medium', 'hard'] as const;
export type LadderLevel = (typeof LADDER_LEVELS)[number];

/** The computer's record in one cell: games it won, games the player won, draws. */
export interface Tally { computer: number; player: number; draw: number }

export const games = (t: Tally): number => t.computer + t.player + t.draw;
/** The computer's win rate: its wins over ALL games (a draw is not a win). 0 for an empty cell. */
export const winRate = (t: Tally): number => (games(t) === 0 ? 0 : t.computer / games(t));

/**
 * The stated noise margins (GH-1389). Each is a win-rate difference, a share of games.
 *
 * - `pooledStep`: POOLED over every open map, per plan (210 games a level at 30 seeds on 7 maps), each level must beat the one
 *   below it by MORE than this. The standard error of a difference of two such rates is at most sqrt(2 x 0.25 / 210) = 0.049, so
 *   0.05 is one standard error: a step no larger than that is not told apart from a tie, and fails.
 * - `cellInversion`: in ONE map and plan (30 games a level), a lower level may beat a higher one by at most this. The standard
 *   error of a difference there is at most 0.129; 0.2 (6 games of 30) is about 1.5 of them. A larger inversion fails.
 */
export const LADDER_MARGINS = { pooledStep: 0.05, cellInversion: 0.2 } as const;
export type LadderMargins = { pooledStep: number; cellInversion: number };

/** cells[map][plan][level] */
export type LadderCells = Record<string, Record<string, Record<LadderLevel, Tally>>>;

export interface Violation { scope: 'pooled' | 'cell'; map: string | null; plan: string; lower: LadderLevel; higher: LadderLevel; lowerRate: number; higherRate: number; why: string }

const sum = (a: Tally, b: Tally): Tally => ({ computer: a.computer + b.computer, player: a.player + b.player, draw: a.draw + b.draw });
const ZERO: Tally = { computer: 0, player: 0, draw: 0 };

/** Each plan's tallies pooled over every map in `cells`. */
export function pooled(cells: LadderCells): Record<string, Record<LadderLevel, Tally>> {
  const out: Record<string, Record<LadderLevel, Tally>> = {};
  for (const byPlan of Object.values(cells)) {
    for (const [plan, byLevel] of Object.entries(byPlan)) {
      out[plan] ??= { easy: ZERO, medium: ZERO, hard: ZERO };
      for (const l of LADDER_LEVELS) out[plan][l] = sum(out[plan][l], byLevel[l] ?? ZERO);
    }
  }
  return out;
}

const pct = (r: number): string => `${(100 * r).toFixed(1)}%`;

/**
 * The ordering gate. A violation is (1) a pooled plan where a level does not beat the one below it by more than
 * `pooledStep` (strict order, beyond noise), or (2) a map and plan where a lower level beats a higher one by more than
 * `cellInversion`. Every adjacent pair is checked, and (2) also checks easy against hard. Empty `cells` is a violation:
 * a gate that compared nothing must not pass.
 */
export function orderingViolations(cells: LadderCells, m: LadderMargins = LADDER_MARGINS): Violation[] {
  const out: Violation[] = [];
  const pools = pooled(cells);
  if (Object.keys(pools).length === 0) {
    return [{ scope: 'pooled', map: null, plan: '(none)', lower: 'easy', higher: 'hard', lowerRate: 0, higherRate: 0, why: 'no games were played: nothing was compared' }];
  }
  const adjacent: [LadderLevel, LadderLevel][] = [['easy', 'medium'], ['medium', 'hard']];
  for (const [plan, byLevel] of Object.entries(pools)) {
    for (const [lo, hi] of adjacent) {
      if (games(byLevel[lo]) === 0 || games(byLevel[hi]) === 0) {
        out.push({ scope: 'pooled', map: null, plan, lower: lo, higher: hi, lowerRate: 0, higherRate: 0, why: `no games at ${games(byLevel[lo]) === 0 ? lo : hi}` });
        continue;
      }
      const a = winRate(byLevel[lo]);
      const b = winRate(byLevel[hi]);
      if (!(b - a > m.pooledStep)) out.push({ scope: 'pooled', map: null, plan, lower: lo, higher: hi, lowerRate: a, higherRate: b, why: `${hi} ${pct(b)} is not above ${lo} ${pct(a)} by more than ${pct(m.pooledStep)}` });
    }
  }
  for (const [map, byPlan] of Object.entries(cells)) {
    for (const [plan, byLevel] of Object.entries(byPlan)) {
      for (const [lo, hi] of [...adjacent, ['easy', 'hard'] as [LadderLevel, LadderLevel]]) {
        const a = winRate(byLevel[lo] ?? ZERO);
        const b = winRate(byLevel[hi] ?? ZERO);
        if (a - b > m.cellInversion) out.push({ scope: 'cell', map, plan, lower: lo, higher: hi, lowerRate: a, higherRate: b, why: `${lo} ${pct(a)} beats ${hi} ${pct(b)} by more than ${pct(m.cellInversion)}` });
      }
    }
  }
  return out;
}

/** What a level states about boosts, as the ladder prints it (`levelBoosts` in tools/validate_computer_levels.mjs). */
export interface LevelStatement { level: LadderLevel; forceShare: number; withheld: string; income: boolean; vision: boolean }

const yesNo = (b: boolean): string => (b ? 'YES' : 'no');

/** The table: one row per map and plan, the computer's win rate at each level, then the pooled rows and the statements. */
export function ladderTable(cells: LadderCells, statements: readonly LevelStatement[], plans: readonly string[]): string {
  const lines: string[] = [];
  const cell = (t: Tally | undefined): string => (t === undefined || games(t) === 0 ? '-' : `${pct(winRate(t))} (${t.computer}/${t.player}/${t.draw})`);
  lines.push('Computer win rate by level (computer wins / player wins / draws), the player on each plan:');
  lines.push('');
  lines.push(`| map | plan | ${LADDER_LEVELS.join(' | ')} |`);
  lines.push(`|---|---|${LADDER_LEVELS.map(() => '---').join('|')}|`);
  for (const [map, byPlan] of Object.entries(cells)) {
    for (const plan of plans) {
      const byLevel = byPlan[plan];
      if (byLevel === undefined) continue;
      lines.push(`| ${map} | ${plan} | ${LADDER_LEVELS.map((l) => cell(byLevel[l])).join(' | ')} |`);
    }
  }
  const pools = pooled(cells);
  for (const plan of plans) {
    const byLevel = pools[plan];
    if (byLevel === undefined) continue;
    lines.push(`| ALL MAPS | ${plan} | ${LADDER_LEVELS.map((l) => cell(byLevel[l])).join(' | ')} |`);
  }
  lines.push('');
  lines.push('What each level is (derived from data/computer/levels.json):');
  lines.push('');
  lines.push('| level | force fielded (share of value) | left at home | income boosted | vision boosted |');
  lines.push('|---|---|---|---|---|');
  for (const s of statements) lines.push(`| ${s.level} | ${pct(s.forceShare)} | ${s.withheld} | ${yesNo(s.income)} | ${yesNo(s.vision)} |`);
  return lines.join('\n');
}
