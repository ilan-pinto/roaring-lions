/**
 * The mission grade (spec 2026-09-10 §4.1): three tiers in the brigade's own paperwork.
 *
 *   ★   Entered in the log        -- victory
 *   ★★  Named in brigade orders   -- and Conduct at or above the mission's floor + 20
 *                                    (70 where no floor is declared)
 *   ★★★ Ari'im citation           -- and every secondary flagged `carries` complete
 *
 * Conduct is a THRESHOLD here and never a component: summing it into a score would turn
 * restraint into points. Losses and time are shown on the debrief and never graded -- the
 * roster already prices a loss as next mission's force. Integer-only, no division, so it
 * can live in this package and be the one answer the runtime, the harness and the app share.
 */
import type { ObjectiveStatus } from './mission';

export type Stars = 0 | 1 | 2 | 3;

export const STAR_ROE_MARGIN = 20;
export const STAR_ROE_DEFAULT = 70;

export interface GradedObjective {
  primary: boolean;
  /** A secondary whose result a later mission reads (`carries: true` in the JSON). */
  carries?: boolean;
  status: ObjectiveStatus;
}

export function starRoeFloor(failBelow: number | undefined): number {
  return failBelow === undefined ? STAR_ROE_DEFAULT : failBelow + STAR_ROE_MARGIN;
}

export function starsFor(
  result: 'ongoing' | 'victory' | 'defeat',
  roe: number,
  failBelow: number | undefined,
  objectives: readonly GradedObjective[]
): Stars {
  if (result !== 'victory') return 0;
  if (roe < starRoeFloor(failBelow)) return 1;
  const carrying = objectives.filter((o) => !o.primary && o.carries === true);
  if (carrying.length === 0) return 2;
  return carrying.every((o) => o.status === 'complete') ? 3 : 2;
}

/** One mission's best result, as the ledger stores it. Every field is an integer. */
export interface MissionResult {
  stars: Stars;
  roe: number;
  /** Sim ticks at the end (20 per second). Shown against `target_minutes`; never graded. */
  ticks: number;
  /** Player units that died. Shown on the debrief; never graded. */
  lost: number;
}

/** Whether `a` should replace `b` as the stored best: more stars, then higher Conduct,
 *  then a faster clock. `lost` is deliberately not consulted. */
export function betterResult(a: MissionResult, b: MissionResult): boolean {
  if (a.stars !== b.stars) return a.stars > b.stars;
  if (a.roe !== b.roe) return a.roe > b.roe;
  return a.ticks < b.ticks;
}
