import type { LedgerData } from './mission';

/** A campaign progression gate, as parsed from `unlock` in unit or world data.
 *  Authoring spells these `roe_rating_min` and `after_mission`; the app maps them. */
export interface UnlockGate {
  roeMin?: number;
  afterMission?: string;
}

/**
 * Why this thing is still locked, or null when it is not.
 *
 * Pure, and deliberately outside any class: the campaign menu has to render the same
 * sentence the mission runtime does, and building a Sim to draw a menu would drag the
 * whole simulation into the shell for one string.
 *
 * Campaign gates only. Affordability changes tick to tick and is shown as a price;
 * a locked *thing* needs to say what would open it (GDD §6).
 */
export function unlockReason(unlock: UnlockGate | undefined, ledger: LedgerData | undefined): string | null {
  if (!unlock) return null;
  if (unlock.roeMin !== undefined && !roeAtLeast(ledger, unlock.roeMin)) {
    // Three cases, because two of them are not the same sentence: rated and short,
    // never rated, and an old save whose only record is a single number. Telling a
    // player with a low rating that they have none sends them to do the wrong thing.
    const map = ratings(ledger);
    const rated = Object.keys(map ?? {}).length;
    const legacy = ledger?.['roe.cumulative_rating'];
    let detail = '';
    if (rated === 0 && typeof legacy === 'number') detail = ` (currently ${legacy})`;
    else if (rated === 0) detail = ' (no missions rated yet)';
    return `requires campaign ROE ${unlock.roeMin}${detail}`;
  }
  if (unlock.afterMission !== undefined) {
    const done = ledger?.['campaign.completed_missions'];
    if (!Array.isArray(done) || !done.includes(unlock.afterMission)) {
      return `requires clearing ${unlock.afterMission}`;
    }
  }
  return null;
}

const ratings = (ledger: LedgerData | undefined): Record<string, number> | null => {
  const r = ledger?.['roe.mission_ratings'];
  return r !== null && typeof r === 'object' ? (r as Record<string, number>) : null;
};

/**
 * Whether the campaign's average ROE is at least `floor`, decided without dividing.
 *
 * `sum >= floor * count` is the same predicate as `sum / count >= floor` for positive
 * counts, using only integer multiplication -- so this package keeps its no-floating-point
 * invariant, and the test is *exact* where a truncated mean would wrongly reject a campaign
 * sitting right on the boundary.
 *
 * The message a locked thing shows names only the floor. The player's current figure is
 * rendered beside it by the shell, which may divide freely.
 */
function roeAtLeast(ledger: LedgerData | undefined, floor: number): boolean {
  const map = ratings(ledger);
  if (map !== null) {
    const keys = Object.keys(map);
    if (keys.length > 0) {
      let total = 0;
      for (const k of keys) total += map[k] ?? 0;
      return total >= floor * keys.length;
    }
  }
  // A save written before per-mission ratings existed carries a single number.
  const legacy = ledger?.['roe.cumulative_rating'];
  return typeof legacy === 'number' && legacy >= floor;
}
