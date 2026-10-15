// The intel probe, as a gate (F1 Task 9, GH-183).
//
// Task 2's census measured the earn rule with a probe that lived in a scratchpad, and a probe that
// lives in a scratchpad cannot catch the trickle coming back. This reads the same two facts off the
// real runtime, run by run, and `playtest.ts` pins them in the `LADDER_CREDITS` idiom:
//
//  - a no-orders player must not out-earn the player who wins (F-Q12): per pair, intel at the
//    EARLIER of the two runs' end ticks. The earlier, because the passive run is cut off by its own
//    deadline and the winner by its victory, and comparing a finished 30-second win to a passive
//    run's whole four minutes would read the clock and not the rule;
//  - nearly every winning plan earns one drone sweep (150) by doing, which is what lets the menu
//    mean something to a player who plays well.
//
// "Earned" is the sum of the run's `intelEarned` events, so a plan that spends is not read as a plan
// that earned less, and `intel_start` (a grant, not an earning) is never counted.

import type { IntelRun, RunRecord } from './playtest-run';

/** Intel earned by `tick`, inclusive: every `intelEarned` event stamped at or before it. */
export function intelAt(run: IntelRun, tick: number): number {
  let sum = 0;
  for (const [t, amount] of run.intel) if (t <= tick) sum += amount;
  return sum;
}

/** Everything the run earned. */
export function intelTotal(run: IntelRun): number {
  return intelAt(run, Number.POSITIVE_INFINITY);
}

/** One winning plan paired with the no-orders control on its mission. */
export interface IntelPair {
  id: string;
  /** The tick both are read at: the earlier of the two end ticks, on the first seed. */
  tick: number;
  winnerAt: number;
  passiveAt: number;
  winnerEnd: number;
  passiveEnd: number;
  /** Seeds (of `compared`) on which the passive side was ahead at that seed's own earlier end tick. */
  ahead: number;
  compared: number;
}

export interface ControlIntel {
  id: string;
  intel: ReadonlyMap<number, IntelRun>;
}

/** The plain winning run of a mission on one seed: the run labelled with the mission id. */
function winnerOf(runs: readonly RunRecord[] | undefined, id: string): RunRecord | undefined {
  return runs?.find((r) => r.expect === 'victory' && r.label === id && r.id === id);
}

/**
 * Every control that has a plain winning plan, paired on `seeds[0]` (the ledger seed, the one the
 * gate reads) and counted across all `seeds` (report only). A seed missing either side is not
 * compared, and `compared` says how many were.
 */
export function intelPairs(
  controls: readonly ControlIntel[],
  bySeed: ReadonlyMap<number, readonly RunRecord[]>,
  seeds: readonly number[]
): IntelPair[] {
  const out: IntelPair[] = [];
  for (const c of controls) {
    const first = winnerOf(bySeed.get(seeds[0]), c.id);
    const passive = c.intel.get(seeds[0]);
    if (!first || !passive) continue;
    const tick = Math.min(first.endTick, passive.endTick);
    let ahead = 0;
    let compared = 0;
    for (const seed of seeds) {
      const w = winnerOf(bySeed.get(seed), c.id);
      const p = c.intel.get(seed);
      if (!w || !p) continue;
      compared++;
      const at = Math.min(w.endTick, p.endTick);
      if (intelAt(p, at) > intelAt(w, at)) ahead++;
    }
    out.push({
      id: c.id,
      tick,
      winnerAt: intelAt(first, tick),
      passiveAt: intelAt(passive, tick),
      winnerEnd: intelTotal(first),
      passiveEnd: intelTotal(passive),
      ahead,
      compared,
    });
  }
  return out;
}

/** The pairs whose passive control out-earned the winner at the compared tick, on the ledger seed. */
export function passiveBeatsWinner(pairs: readonly IntelPair[]): IntelPair[] {
  return pairs.filter((p) => p.passiveAt > p.winnerAt);
}

/**
 * The same pairs read END to END, with no tick alignment: the passive run's whole total against the
 * winner's whole total. Report only. F-Q12 rules the gate at the earlier end tick, which is the fair
 * reading and also the blunt one: a restored per-minute trickle pays the winner's own drone as well, so it
 * leaves the aligned count at 0 (measured on the scratch copy that restored it) and moves this one.
 */
export function passiveEndExceedsWinner(pairs: readonly IntelPair[]): IntelPair[] {
  return pairs.filter((p) => p.passiveEnd > p.winnerEnd);
}

/** Price of a drone sweep (`SUPPORT_COST.drone_sweep`, `packages/sim/src/mission.ts`). */
export const SWEEP_PRICE = 150;

/** Every winning plan (a `(bought)`, `(gate open)` or `(price-only closed)` probe included, a max-tier replay not). */
export function winningPlans(runs: readonly RunRecord[]): RunRecord[] {
  return runs.filter((r) => r.expect === 'victory' && !r.label.endsWith('(max tier)'));
}

/** The winning plans that earned at least one sweep by doing. */
export function earnsSweep(runs: readonly RunRecord[], price: number = SWEEP_PRICE): RunRecord[] {
  return winningPlans(runs).filter((r) => intelTotal(r) >= price);
}

/** Seeds on which the plan `label` did not spend `price` through the menu (a refused call spends nothing). */
export function seedsNotSpent(
  bySeed: ReadonlyMap<number, readonly RunRecord[]>,
  seeds: readonly number[],
  label: string,
  price: number
): number[] {
  return seeds.filter((seed) => bySeed.get(seed)?.find((r) => r.label === label)?.spent !== price);
}

const secs = (tick: number): string => `${(tick / 20).toFixed(1)} s`;

/** The report: one line per pair, then the two numbers the gates pin. Returns them. */
export function reportIntel(
  controls: readonly ControlIntel[],
  bySeed: ReadonlyMap<number, readonly RunRecord[]>,
  seeds: readonly number[]
): { pairs: IntelPair[]; beats: number; sweepers: number; winners: number } {
  const pairs = intelPairs(controls, bySeed, seeds);
  for (const p of pairs) {
    console.log(
      `intel pair ${p.id}: at ${secs(p.tick)} winner ${p.winnerAt}, passive ${p.passiveAt}; ` +
        `end totals winner ${p.winnerEnd}, passive ${p.passiveEnd}; ` +
        `passive ahead on ${p.ahead} of ${p.compared} seeds (report only)`
    );
  }
  const beats = passiveBeatsWinner(pairs);
  const endBeats = passiveEndExceedsWinner(pairs);
  const seedPairs = pairs.reduce((n, p) => n + p.ahead, 0);
  const seedTotal = pairs.reduce((n, p) => n + p.compared, 0);
  console.log(
    `intel: passive beats winner on ${beats.length} of ${pairs.length} pairs on seed ${seeds[0]}` +
      (beats.length ? ` (${beats.map((p) => p.id).join(', ')})` : '') +
      `; ahead on ${seedPairs} of ${seedTotal} seed-pairs across ${seeds.length} seeds (report only); ` +
      `end totals alone, passive over winner on ${endBeats.length} of ${pairs.length} pairs` +
      (endBeats.length ? ` (${endBeats.map((p) => p.id).join(', ')})` : '') +
      ` (report only)`
  );
  const wins = winningPlans(bySeed.get(seeds[0]) ?? []);
  const sweepers = earnsSweep(bySeed.get(seeds[0]) ?? []);
  const short = wins.filter((r) => !sweepers.includes(r));
  console.log(
    `intel: ${sweepers.length} of ${wins.length} winning plans earn a sweep (${SWEEP_PRICE}) on seed ${seeds[0]}` +
      (short.length ? ` -- short: ${short.map((r) => `${r.label} ${intelTotal(r)}`).join(', ')}` : '')
  );
  return { pairs, beats: beats.length, sweepers: sweepers.length, winners: wins.length };
}
