// GH-943 P0 (design section 6): the quiet-machine ABBA runner's decisions. Pure; the driver is `webgpu-abba-run.ts`.
//
// QUIET MACHINE: the 1-minute load average must be at most 4 (the refusal is checked before EVERY round, since load drifts), at
// least 3 full ABBA rounds on FRESH pages, and the verdict is the median of the round medians with its spread. A difference
// inside the spread counts as no difference.

export const MAX_LOADAVG_1M = 4;
export const MIN_ROUNDS = 3;

export function loadRefusal(loadavg1m: number, max = MAX_LOADAVG_1M): string | null {
  if (!(loadavg1m <= max)) {
    return `1-minute load average is ${loadavg1m.toFixed(2)} (> ${max}): this is not a quiet machine, and a timing taken now measures the load. Refusing.`;
  }
  return null;
}

export function roundsRefusal(rounds: number): string | null {
  return rounds >= MIN_ROUNDS ? null : `${rounds} round(s) requested; at least ${MIN_ROUNDS} full ABBA rounds are required for a verdict`;
}

/** Round r runs A B B A for even r and B A A B for odd r, so drift lands on both arms symmetrically. */
export function abbaOrder<T>(a: T, b: T, round: number): T[] {
  return round % 2 === 0 ? [a, b, b, a] : [b, a, a, b];
}

export function median(v: readonly number[]): number {
  if (v.length === 0) throw new Error('median of nothing');
  const s = [...v].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export interface ArmSummary {
  /** The median of the per-round medians. */
  readonly value: number;
  /** max - min of the per-round medians. */
  readonly spread: number;
  readonly rounds: number;
}

/** `perRound[r]` are the medians of the runs that arm made in round r (an ABBA round gives it two). */
export function summarise(perRound: readonly (readonly number[])[]): ArmSummary {
  const roundMedians = perRound.map((r) => median(r));
  return { value: median(roundMedians), spread: Math.max(...roundMedians) - Math.min(...roundMedians), rounds: roundMedians.length };
}

export interface Comparison {
  readonly ratio: number;
  /** True when |difference| is inside the larger of the two spreads: "no difference". */
  readonly withinSpread: boolean;
}

/** `test` against `base`. A difference inside the spread counts as no difference. */
export function compare(base: ArmSummary, test: ArmSummary): Comparison {
  const diff = Math.abs(test.value - base.value);
  return { ratio: test.value / base.value, withinSpread: diff <= Math.max(base.spread, test.spread) };
}

/** The design's bars: G <= 1.05 x L and F <= 1.10 x L. A bar is met when the ratio is inside it OR the difference is inside the spread. */
export const BARS: Readonly<Record<'F' | 'G', number>> = { G: 1.05, F: 1.1 };

export function barMet(arm: 'F' | 'G', c: Comparison): boolean {
  return c.ratio <= BARS[arm] || c.withinSpread;
}
