// The banking report, as a gate (F2 Task 9, GH-183).
//
// "Banking" is how much of the logistics a run could have spent it left in the purse: held at the end
// of the run over everything it had (the mission's `logistics_start` plus what it earned, base income
// and zones together). A plan that banks most of its income has nothing to buy, which is the problem
// F4 exists to give a reason to solve; F2 only measures it. Everything here is read off the real
// `MissionRuntime` by `run()` (`logisticsEarned`, `zoneLogisticsEarned`, `logistics`), none of it is
// recomputed, and `playtest.ts` pins two numbers from it in the `LADDER_CREDITS` idiom.

/** What one run of an economy mission (one with a `resources` block) did with its logistics. */
export interface Banking {
  /** The mission's `resources.logistics_start`: a grant, not an earning. */
  start: number;
  /** Whole logistics side 0 earned, base and zones (`logisticsEarned(0)`). */
  earned: number;
  /** The zones' share of `earned` (`zoneLogisticsEarned(0)`). */
  zoneEarned: number;
  /** What side 0 holds when the run ends (`logistics`). */
  held: number;
}

/** What the run took out of the purse: start + earned - held. Each term is floored to whole
 *  logistics by the runtime, so this can be one off the true spend; it is never negative.
 *  The same flooring nudges the banked percent too: `held` and `earned` are each under one
 *  logistic below the true purse, which moves held / (start + earned) by less than 100 / (start +
 *  earned) points -- under 0.21 of a point on the smallest purse the report prints (484, 15 Oct
 *  2026) and under 0.2 on every other. `bankedOver` can therefore only flip on a run within that
 *  much of 30%. */
export function spentOf(b: Banking): number {
  return Math.max(0, b.start + b.earned - b.held);
}

/** The most the run ever had to spend. */
export function availableOf(b: Banking): number {
  return b.start + b.earned;
}

/** Banked share as a whole-number percent for display, or '-' when there was nothing to bank. */
export function bankedPercent(b: Banking): string {
  const avail = availableOf(b);
  return avail === 0 ? '-' : `${Math.round((100 * b.held) / avail)}%`;
}

/** True when the run banked MORE than `percent` of what it had. Integer arithmetic, so 30.0% exactly
 *  is not over 30 and the answer never turns on a rounding. A run with nothing to bank banked nothing. */
export function bankedOver(b: Banking, percent: number): boolean {
  const avail = availableOf(b);
  return avail > 0 && 100 * b.held > percent * avail;
}

/** The report line for one run: `banking <mission> (<kind>): earned N (zones Z), spent S, banked B (P%)`. */
export function bankingLine(id: string, kind: string, b: Banking): string {
  return `banking ${id} (${kind}): earned ${b.earned} (zones ${b.zoneEarned}), spent ${spentOf(b)}, banked ${b.held} (${bankedPercent(b)})`;
}
