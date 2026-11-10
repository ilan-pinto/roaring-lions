/**
 * The live Conduct reading on a `no_collateral_above` objective (GH-4).
 *
 * `MissionRuntime.objectiveList` reports the guard's `threshold` (the Conduct floor) and its
 * authored text, but not the live score -- that is `roeScore`, which the HUD strip already
 * shows and which is the ONE source the objective must share rather than re-derive. This
 * decorates an active guard's text with that live reading, exactly as `evacuation.ts` does for
 * an evacuation's tally, so the tracker, the pause list and the strip all read the same
 * "Conduct 82/70" off the runtime's own score instead of a second counter.
 *
 * A completed or failed guard keeps its authored text: the reading is progress, and there is
 * none left to show once the objective is decided.
 */
import { t } from './i18n/t';

interface GuardRow {
  id: string;
  type?: string;
  text: string;
  status: string;
  threshold?: number;
}

export function withConductProgress<R extends GuardRow>(rows: readonly R[], conduct: number): R[] {
  let hasGuard = false;
  for (const r of rows) {
    if (r.type === 'no_collateral_above' && r.threshold !== undefined) {
      hasGuard = true;
      break;
    }
  }
  if (!hasGuard) return rows.slice();
  return rows.map((r) => {
    if (r.type !== 'no_collateral_above' || r.threshold === undefined || r.status !== 'active') return r;
    return { ...r, text: t('objectives.conductProgress', { text: r.text, conduct, threshold: r.threshold }) };
  });
}
