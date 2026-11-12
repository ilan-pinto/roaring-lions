/**
 * The Conduct a `no_collateral_above` objective has lost so far, on its row (GH-4).
 *
 * `MissionRuntime.objectiveList` carries `collateral: { lost, limit }` for that type, read from the same ROE score the
 * HUD shows as Conduct, so the panel and the score cannot disagree. This only words it: an ACTIVE ceiling's text gains
 * "(Conduct lost 15 of 30)", and a completed or failed one keeps its authored text, because the tally is progress and
 * there is none left to make. The wording is `t()`'s, never a literal. A row without `collateral` passes through
 * untouched, and no row ever reaches the sim from here (invariant 4).
 */
import { t } from './i18n/t';

interface RowShape {
  id: string;
  text: string;
  status: string;
  collateral?: { lost: number; limit: number };
}

export function withCollateralProgress<R extends RowShape>(rows: readonly R[]): R[] {
  return rows.map((r) =>
    r.collateral === undefined || r.status !== 'active'
      ? r
      : { ...r, text: t('objectives.collateralProgress', { text: r.text, lost: r.collateral.lost, limit: r.collateral.limit }) },
  );
}
