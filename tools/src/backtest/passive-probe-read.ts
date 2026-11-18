// The passive-player probe's reading (civilian drama E11, GH-1438): the per-seed row, the per-mission summary and
// the verdict, as pure functions over plain numbers. A leaf: no sim, no data, so its test is cheap and its oracle is
// literals. The runner that fills the rows is `passive-probe.ts`.
//
// The verdict is the design's P0 pass (docs/campaign/civilian-drama.md, section 10.4 and 11.2): a player who gives
// no orders must LOSE on every seed, and no civilian may be counted in (`evacuated`) on any tick of any of those
// runs. A crowd that walks into its own refuge zone counts itself in, and that is the trap the muster rule closes.
//
//   WINS   at least one seed ended in victory: the mission is won by doing nothing.
//   LEAKS  no seed won, but on at least one a civilian was counted in with nobody sent for him. Not yet a win;
//          it is the margin the next crowd, or a lower count, spends.
//   HOLDS  every seed lost (or ran to the cap) and nobody was counted in on any tick.

export type Outcome = 'victory' | 'defeat' | 'withdrawn' | 'stuck';
export type Verdict = 'WINS' | 'LEAKS' | 'HOLDS';

/** The mission-clock seconds the cumulative `evacuated` count is read at (section 10.4's 60/120/180/240/300 s). */
export const CHECKPOINTS_S: readonly number[] = [60, 120, 180, 240, 300];

/** The seeds a sweep runs on: the pinned 424242 first, then 1, 2, ... (`passive-sweep.ts`'s `SWEEP_SEEDS` for n = 30). */
export function seedsOf(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error(`seeds must be a positive integer, got ${n}`);
  return [424242, ...Array.from({ length: n - 1 }, (_, k) => k + 1)];
}

/** One run's outcome in one word. A defeat by the time limit is `withdrawn`; an ongoing run at the harness's
 *  20-minute cap is `stuck`. */
export function outcomeOf(result: 'ongoing' | 'victory' | 'defeat', cause: string | undefined): Outcome {
  if (result === 'victory') return 'victory';
  if (result === 'ongoing') return 'stuck';
  return cause === 'withdrawn' ? 'withdrawn' : 'defeat';
}

export function isWin(o: Outcome): boolean {
  return o === 'victory';
}

/** One seed of one mission under one control plan. */
export interface SeedRow {
  seed: number;
  outcome: Outcome;
  /** `causeText` of a defeat (`objective:<id>`, `withdrawn`, `force_destroyed`, `roe_collapse`), else undefined. */
  cause?: string;
  /** Mission clock at the end, seconds. */
  endS: number;
  /** `evacuated` mission events over the whole run. */
  evacuated: number;
  /** The cumulative `evacuated` count at each of `CHECKPOINTS_S` (the run's final count past its end). */
  evacuatedAt: number[];
  /** `woundedDown` events whose body is side 2. */
  downed: number;
  /** `destroyed` events whose target is side 2. */
  killed: number;
  /** `removed` sim events of side 2: taken off the map by a `remove` trigger. */
  taken: number;
  /** Most living entities at once, any side. */
  peakLiving: number;
  /** `sim.entityCount` at the end: every body that ever appeared (the 256 capacity is a lifetime budget). */
  lifetime: number;
}

export interface Summary {
  mission: string;
  plan: string;
  seeds: number;
  wins: number;
  /** Seeds that ended in `defeat` or `withdrawn`. */
  losses: number;
  stuck: number;
  /** Seeds on which at least one civilian was counted in. */
  leakSeeds: number;
  evacMean: number;
  evacMax: number;
  /** Mean cumulative `evacuated` at each checkpoint. */
  evacAtMean: number[];
  downedMean: number;
  killedMean: number;
  takenMean: number;
  peakLiving: number;
  lifetimeMax: number;
  /** Outcomes and causes, counted: `defeat:objective:evac_settlements 30`. */
  ends: Map<string, number>;
  /** Seeds that won, in seed order. */
  winSeeds: number[];
  verdict: Verdict;
}

export function verdictOf(rows: readonly SeedRow[]): Verdict {
  if (rows.length === 0) throw new Error('a verdict over no seeds is no verdict');
  if (rows.some((r) => isWin(r.outcome))) return 'WINS';
  if (rows.some((r) => r.evacuated > 0)) return 'LEAKS';
  return 'HOLDS';
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function summarise(mission: string, plan: string, rows: readonly SeedRow[]): Summary {
  const verdict = verdictOf(rows);
  const ends = new Map<string, number>();
  for (const r of rows) {
    const k = r.cause !== undefined && r.outcome === 'defeat' ? `defeat:${r.cause}` : r.outcome;
    ends.set(k, (ends.get(k) ?? 0) + 1);
  }
  return {
    mission,
    plan,
    seeds: rows.length,
    wins: rows.filter((r) => isWin(r.outcome)).length,
    losses: rows.filter((r) => r.outcome === 'defeat' || r.outcome === 'withdrawn').length,
    stuck: rows.filter((r) => r.outcome === 'stuck').length,
    leakSeeds: rows.filter((r) => r.evacuated > 0).length,
    evacMean: mean(rows.map((r) => r.evacuated)),
    evacMax: Math.max(...rows.map((r) => r.evacuated)),
    evacAtMean: CHECKPOINTS_S.map((_, k) => mean(rows.map((r) => r.evacuatedAt[k] ?? r.evacuated))),
    downedMean: mean(rows.map((r) => r.downed)),
    killedMean: mean(rows.map((r) => r.killed)),
    takenMean: mean(rows.map((r) => r.taken)),
    peakLiving: Math.max(...rows.map((r) => r.peakLiving)),
    lifetimeMax: Math.max(...rows.map((r) => r.lifetime)),
    ends,
    winSeeds: rows.filter((r) => isWin(r.outcome)).map((r) => r.seed),
    verdict,
  };
}

/**
 * Report-only by default: 0 whatever the table says. With `gate`, 1 when any NO-ORDERS ('none') control reads WINS
 * or LEAKS (section 10.4's P0: 30/30 lost, no `evacuated` event on any tick). The other plans (`naive`, `parked`)
 * are reports in the design and never move the exit code.
 */
export function exitCodeFor(summaries: readonly Summary[], gate: boolean): 0 | 1 {
  if (!gate) return 0;
  return summaries.some((s) => s.plan === 'none' && s.verdict !== 'HOLDS') ? 1 : 0;
}

const f1 = (x: number): string => x.toFixed(1);

/** The 30-seed table: one line per mission and plan. */
export function formatSummary(s: Summary): string {
  const ends = [...s.ends.entries()].map(([k, n]) => `${k} ${n}`).join(', ');
  return (
    `${s.mission} [${s.plan}]: ${s.verdict} -- won ${s.wins}/${s.seeds}` +
    (s.winSeeds.length > 0 ? ` (seeds ${s.winSeeds.join(' ')})` : '') +
    `; ends ${ends}; evacuated mean ${f1(s.evacMean)} max ${s.evacMax} on ${s.leakSeeds} seed(s)` +
    ` [at ${CHECKPOINTS_S.map((c, k) => `${c}s ${f1(s.evacAtMean[k])}`).join(' ')}]` +
    `; civilians downed ${f1(s.downedMean)} killed ${f1(s.killedMean)} taken ${f1(s.takenMean)}` +
    `; peak living ${s.peakLiving}, lifetime max ${s.lifetimeMax}`
  );
}

/** One seed's line (`--per-seed`). */
export function formatRow(mission: string, plan: string, r: SeedRow): string {
  return (
    `  ${mission} [${plan}] seed ${r.seed}: ${r.outcome}${r.cause !== undefined && r.outcome === 'defeat' ? ` ${r.cause}` : ''} at ${f1(r.endS)} s` +
    `; evacuated ${r.evacuated} [${r.evacuatedAt.join(' ')}]; downed ${r.downed} killed ${r.killed} taken ${r.taken}` +
    `; peak living ${r.peakLiving}, lifetime ${r.lifetime}`
  );
}

/** The cumulative count at each checkpoint, from the ticks the `evacuated` events fired on. */
export function evacuatedAtCheckpoints(evacTicks: readonly number[], ticksPerSecond: number): number[] {
  return CHECKPOINTS_S.map((c) => evacTicks.filter((t) => t <= c * ticksPerSecond).length);
}
