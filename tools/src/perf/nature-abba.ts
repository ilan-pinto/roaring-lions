// The arm-order and paired statistics of `pnpm nature:capture`'s cost phase, kept out of the script (top-level
// side effects) so a test can drive them. GH-984 N3: a fixed off-then-on order every round reads a load that
// drifts upward as an on-minus-off cost (z1 paired on-off was positive in 6 of 6 rounds while the off arm alone
// drifted 28.8 -> 41.7 ms). ABBA alternates the order per round so a linear drift cancels in the paired median.

export type Arm = 'off' | 'on';

/** Round 0 measures off then on, round 1 on then off, and so on (ABBA). */
export function armOrder(round: number): readonly [Arm, Arm] {
  return round % 2 === 0 ? ['off', 'on'] : ['on', 'off'];
}

/** The fixed order the instrument used before: off then on, every round. Kept only so a test can show its bias. */
export function fixedArmOrder(): readonly [Arm, Arm] {
  return ['off', 'on'];
}

/** True median (mean of the middle two on an even count). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type Paired = { deltas: number[]; median: number; positive: number; rounds: number };

/** Per-round on - off, its median, and how many rounds came out strictly positive. */
export function pairedStats(off: readonly number[], on: readonly number[]): Paired {
  if (off.length !== on.length) throw new Error(`pairedStats: ${off.length} off rounds vs ${on.length} on rounds`);
  const deltas = on.map((v, i) => v - off[i]);
  return { deltas, median: median(deltas), positive: deltas.filter((d) => d > 0).length, rounds: deltas.length };
}

/** One line for the log: `paired median +0.12 ms, 3/6 rounds positive`. */
export function pairedLine(p: Paired): string {
  return `paired median (on - off) ${p.median >= 0 ? '+' : ''}${p.median.toFixed(2)} ms, ${p.positive}/${p.rounds} rounds positive`;
}

/**
 * Run `rounds` rounds through `order`, calling `measure(arm)` once per arm in that round's order, and return the
 * per-round samples by arm. `measure` is the only thing that touches the page.
 */
export async function runRounds<T>(
  rounds: number,
  order: (round: number) => readonly [Arm, Arm],
  measure: (arm: Arm, round: number) => Promise<T>
): Promise<{ off: T[]; on: T[] }> {
  const off: T[] = [];
  const on: T[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const arm of order(round)) (arm === 'off' ? off : on).push(await measure(arm, round));
  }
  return { off, on };
}
