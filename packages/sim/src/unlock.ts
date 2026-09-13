import type { LedgerData, MissionJson, PlacementJson } from './mission';

/** A campaign progression gate, as parsed from `unlock` in unit or world data.
 *  Authoring spells these `roe_rating_min`, `stars_min` and `after_mission`; the app maps them. */
export interface UnlockGate {
  roeMin?: number;
  starsMin?: number;
  afterMission?: string;
}

/** Earned stars: the integer sum of each mission's best grade. No division. */
export function starsEarned(ledger: LedgerData | undefined): number {
  const results = ledger?.['campaign.mission_results'];
  if (results === null || typeof results !== 'object') return 0;
  let total = 0;
  for (const k of Object.keys(results as Record<string, { stars?: number }>)) {
    const s = (results as Record<string, { stars?: number }>)[k]?.stars;
    if (typeof s === 'number') total += s;
  }
  return total;
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
    return `requires campaign Conduct ${unlock.roeMin}${detail}`;
  }
  if (unlock.starsMin !== undefined) {
    const have = starsEarned(ledger);
    if (have < unlock.starsMin) {
      return `requires ${unlock.starsMin} star${unlock.starsMin === 1 ? '' : 's'} (currently ${have})`;
    }
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
  return r !== null && typeof r === 'object' ? r : null;
};

/**
 * Whether the campaign's average ROE is at least `floor`, decided without dividing.
 *
 * `sum >= floor * count` is the same predicate as `sum / count >= floor` for positive
 * counts, using only integer multiplication -- so this package keeps its no-floating-point
 * invariant. For an integer `floor` it changes no verdict versus a truncated mean: truncating
 * `sum / count` down to an integer is still `>= floor` exactly when `sum / count >= floor`
 * itself. The two forms only diverge for a fractional `roeMin`, which nothing authors.
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

/**
 * Field the earned unit where a placement offers one (spec §4.6, `upgrades_to`). Pure and
 * called ONCE, by the app and by the playtest harness, before `new MissionRuntime` -- so
 * the runtime never learns a gate exists (spawnPlacement stays gate-blind on purpose: the
 * Wadi Halam V D9 hole is a separate decision) and both callers share one implementation.
 */
export function resolveUpgrades(
  mission: MissionJson,
  ledger: LedgerData | undefined,
  unlockOf: (unitId: string) => UnlockGate | undefined
): MissionJson {
  const force = (mission.starting_force ?? []).map((p: PlacementJson) => {
    if (p.upgrades_to === undefined) return p;
    const { upgrades_to, ...rest } = p;
    if (unlockReason(unlockOf(upgrades_to), ledger) === null) return { ...rest, unit: upgrades_to };
    return rest;
  });
  return { ...mission, starting_force: force };
}
