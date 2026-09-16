import type { LedgerData, MissionJson, PlacementJson } from './mission';

/** A campaign progression gate, as parsed from `unlock` in unit or world data.
 *  Authoring spells the earned fields `roe_rating_min`, `stars_min` and `after_mission`,
 *  plus `price` (spec 2026-09-15 §4.4), authored the same way; the app maps them.
 *  `bought` is resolved by the app from the brigade account and is never authored. */
export interface UnlockGate {
  roeMin?: number;
  starsMin?: number;
  afterMission?: string;
  /** Credits that open this unit without the earned gates (spec 2026-09-15 §4.4). Authored. */
  price?: number;
  /** True when the brigade account lists this unit as bought. Resolved by the app; never authored. */
  bought?: boolean;
}

/** True when `unlock` declares no earned field at all and a `price` (D1: the special
 *  forces shape) -- closed until bought, with nothing a player can earn to open it.
 *  Shared by `unlockReason` and the brigade screen's `bindingGate`, which used to
 *  each spell out "no earned field" as their own copy of the same expression. */
export function isBoughtOnly(gate: UnlockGate): boolean {
  const hasEarnedField = gate.roeMin !== undefined || gate.starsMin !== undefined || gate.afterMission !== undefined;
  return !hasEarnedField && gate.price !== undefined;
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
  // A purchase opens the unit outright (spec 2026-09-15 §4.4). Resolved by the app from
  // the brigade account; nothing in data can author it.
  if (unlock.bought === true) return null;
  const earned = earnedReason(unlock, ledger);
  if (earned === null) {
    // No earned field failed. A gate with no earned field at all is bought-only
    // (D1: the special forces shape): closed until bought.
    if (isBoughtOnly(unlock) && unlock.price !== undefined) return `buy for ${unlock.price} credits`;
    return null;
  }
  return unlock.price !== undefined ? `${earned}, or buy for ${unlock.price} credits` : earned;
}

/** The earned checks exactly as before, in the same order (Conduct, stars, mission). */
function earnedReason(unlock: UnlockGate, ledger: LedgerData | undefined): string | null {
  if (unlock.roeMin !== undefined && !conductAtLeast(ledger, unlock.roeMin)) {
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
 * Whether the campaign's average Conduct is at least `floor`, decided without dividing.
 *
 * `sum >= floor * count` is the same predicate as `sum / count >= floor` for positive
 * counts, using only integer multiplication -- so this package keeps its no-floating-point
 * invariant. For an integer `floor` it changes no verdict versus a truncated mean: truncating
 * `sum / count` down to an integer is still `>= floor` exactly when `sum / count >= floor`
 * itself. The two forms only diverge for a fractional `roeMin`, which nothing authors.
 *
 * The message a locked thing shows names only the floor. The player's current figure is
 * rendered beside it by the shell, which may divide freely.
 *
 * Exported (as `conductAtLeast`, `unlockReason`'s own internal name for it) so a caller
 * that needs to know WHICH gate is binding -- the brigade screen's row order, not its
 * lock state -- can ask the exact same question `unlockReason` does, rather than
 * approximating it from `campaignRoe`'s rounded mean. A rounded mean can disagree with
 * this at the boundary (two ratings of 39 and 40 against a floor of 40: exact sum 79 <
 * 80, still short; the rounded mean is 40, which reads as clearing it) -- harmless for
 * display, since `campaignRoe` is presentation-only, but wrong for a gate check.
 */
export function conductAtLeast(ledger: LedgerData | undefined, floor: number): boolean {
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
 *
 * Trust boundary: `unlockOf(upgrades_to)` returning `undefined` reads as an OPEN gate
 * (`unlockReason(undefined, ledger)` is `null`), same as a unit with no `unlock` at all --
 * this function does not distinguish "no gate" from "unlockOf found nothing". It is safe
 * only because `validate_data.mjs` refuses an `upgrades_to` target that declares no
 * `unlock`, so a real caller's `unlockOf` is never asked about an ungated target.
 *
 * `gate_only` (also §4.6): while the gate is closed, the placement is DROPPED rather than
 * fielding the base unit -- `filter` after `map`, so a dropped entry never reaches the
 * output array at all. The 2026-09-14 Qarn Hadid III ladder is why: the closed-gate base
 * body there measured as a net negative for a realistic player, unlike the other five
 * `upgrades_to` sites, so this one must appear only once earned.
 */
export function resolveUpgrades(
  mission: MissionJson,
  ledger: LedgerData | undefined,
  unlockOf: (unitId: string) => UnlockGate | undefined
): MissionJson {
  const force = (mission.starting_force ?? [])
    .map((p: PlacementJson) => {
      if (p.upgrades_to === undefined) return p;
      const { upgrades_to, gate_only, ...rest } = p;
      if (unlockReason(unlockOf(upgrades_to), ledger) === null) return { ...rest, unit: upgrades_to };
      return gate_only === true ? null : rest;
    })
    .filter((p): p is PlacementJson => p !== null);
  return { ...mission, starting_force: force };
}
