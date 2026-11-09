/**
 * How a points race scores (GH-1103): one short line, built from the room's own mode data
 * (`data/versus/modes/<map>.json` `modes.points`, the file the sim's score objective is made from) and never written
 * per map. Read by the lobby's mode hint, the arena setup's hint, and the points HUD at match start.
 *
 * Every string goes through `t()` at call time (never a table resolved at module load).
 */
import { t } from '../i18n/t';

/** The slice of a mode file's `points` block the line reads. */
export interface ExplainRules {
  readonly zones: readonly { readonly per_min: number }[];
  readonly per_value_destroyed: number;
  readonly target: number;
}

/** What the zones pay a minute: one figure when they all pay the same, else the span. */
export function payRange(zones: readonly { readonly per_min: number }[]): string {
  if (zones.length === 0) return t('versus.points.range.flat', { n: 0 });
  let lo = Infinity;
  let hi = 0;
  for (const z of zones) {
    if (z.per_min < lo) lo = z.per_min;
    if (z.per_min > hi) hi = z.per_min;
  }
  return lo === hi ? t('versus.points.range.flat', { n: lo }) : t('versus.points.range', { min: lo, max: hi });
}

/** "First to 600. Hold a zone alone to earn its points every minute (10 to 40 a minute). Destroying enemy units ...". */
export function pointsExplainer(rules: ExplainRules): string {
  const head = t('versus.points.explain', { target: rules.target, range: payRange(rules.zones) });
  if (rules.per_value_destroyed <= 0) return head;
  return `${head} ${t('versus.points.explain.kills', { kill: rules.per_value_destroyed })}`;
}
