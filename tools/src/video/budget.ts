/**
 * The hard cap, and the one function that decides whether a spend fits it.
 *
 * $150 is the lead's cap on the cinematics route (approved 2026-10-11, from
 * docs/research/2026-10-11-generative-video.md §5). It is a constant in code
 * on purpose: the storyboard (`docs/cinematics/shots.json`) carries a plan,
 * not a limit, so editing a JSON file cannot raise it. Raising it is a code
 * change with a reason in its commit, which is the point.
 *
 * Money is compared in integer micro-dollars, never as floats: 0.1 * 3 is not
 * 0.3, and a cap check that refuses a spend landing exactly on the cap (or
 * lets one a hair over through) because of binary rounding is a check that
 * says something other than what it was written to say.
 */

export const HARD_CAP_USD = 150;

export interface BudgetVerdict {
  readonly allowed: boolean;
  readonly capUsd: number;
  readonly spentUsd: number;
  readonly requestUsd: number;
  readonly remainingBeforeUsd: number;
  readonly remainingAfterUsd: number;
  /** Set when `allowed` is false. */
  readonly reason?: string;
}

const micro = (usd: number): number => Math.round(usd * 1_000_000);

/**
 * Whether spending `requestUsd` on top of `spentUsd` stays within `capUsd`.
 * Landing exactly on the cap is allowed; a single micro-dollar over is not.
 * A non-finite or negative input is refused rather than coerced -- a ledger
 * that sums to NaN must stop the spend, not wave it through. Pure.
 */
export function checkBudget(spentUsd: number, requestUsd: number, capUsd: number = HARD_CAP_USD): BudgetVerdict {
  const base = {
    capUsd,
    spentUsd,
    requestUsd,
    remainingBeforeUsd: capUsd - spentUsd,
    remainingAfterUsd: capUsd - spentUsd - requestUsd,
  };
  for (const [name, v] of [
    ['spent', spentUsd],
    ['request', requestUsd],
    ['cap', capUsd],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) {
      return { ...base, allowed: false, reason: `${name} is ${v}, not a finite non-negative amount` };
    }
  }
  if (micro(spentUsd) + micro(requestUsd) > micro(capUsd)) {
    return {
      ...base,
      allowed: false,
      reason: `$${(spentUsd + requestUsd).toFixed(2)} would pass the $${capUsd.toFixed(2)} cap ($${(capUsd - spentUsd).toFixed(2)} left)`,
    };
  }
  return { ...base, allowed: true };
}
