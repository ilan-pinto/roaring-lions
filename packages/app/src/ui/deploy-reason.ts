// K-11: why the Deploy button is locked, and why a row will not take a click.
//
// The rules are `deploy-select.ts`'s (`slotsLeft`, `isComplete`, `toggleEntry`);
// this only words them. Before it, a disabled Deploy and a dimmed full row
// said nothing, and a refused click was silent.
import { t } from '../i18n/t';
import type { DeployEntry, DeployRosterView } from './deploy-roster';
import { slotsLeft, type DeploySelection } from './deploy-select';

/**
 * How many more bodies the player could still field: per demanded type, the
 * open slots (`slotsLeft`) capped by the unchosen bodies there are to put in
 * them. Zero exactly when `isComplete` is true -- a slot the pool cannot
 * fill is the spawner's to substitute (`mission.ts:1264`), not the player's
 * to fill -- so this and the Deploy button can never disagree.
 */
export function openSlots(view: DeployRosterView, sel: DeploySelection): number {
  let open = 0;
  for (const type of view.demand.keys()) {
    let unchosen = 0;
    for (const e of view.eligible) if (e.type === type && !sel.chosen.has(e.poolIndex)) unchosen++;
    open += Math.max(0, Math.min(slotsLeft(view, sel, type), unchosen));
  }
  return open;
}

/** The sentence under a locked Deploy button, or null when Deploy may go. */
export function deployLockReason(view: DeployRosterView | null, sel: DeploySelection): string | null {
  if (view === null) return null;
  const n = openSlots(view, sel);
  return n > 0 ? t('deploy.locked', { n }) : null;
}

/** Why a row whose type is already full takes no click. */
export function fullRowReason(entry: DeployEntry): string {
  return t('deploy.row.full', { type: entry.typeName });
}
