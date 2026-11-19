/**
 * GH-1384 §4.4, the server's sticky pick. A build from before branching reads an account and writes it back without `picks` and
 * `legacy` (`migrateAccount` rebuilds a fixed field set). The next new-build read would see "tier 3, no pick", give it pick 1 and a
 * fresh legacy marker, so a member who chose branch 2 would be moved to branch 1 and handed a free Switch or a full refund: a free
 * respec, which defeats "the choice is final" (Q2). The server holds the stored row, so it keeps its own picks:
 *
 *   For each branched (unit, track), where the STORED account holds the branched tier with a pick, and the INCOMING body holds
 *   that tier or more:
 *     - no incoming pick: the stored pick and the stored marker stand;
 *     - the same pick: the stored marker stands (the body's own `legacy` is never read);
 *     - a different pick: accepted only where the stored row held a marker on that track (a Switch), and then the marker is
 *       cleared; with no stored marker the stored pick stands (a fresh branch buy is final).
 *   Where the stored account holds no pick at the branched tier, an incoming pick is a fresh buy and carries no marker; an
 *   incoming tier with no pick is an old build's linear tier 3, which `migrateAccount` makes pick 1 with a marker, as it should.
 *   A body below the branched tier is untouched: a pick leaves only with its tier (a Return, or a reset).
 *
 * Everything is keyed by (unit, track), never by unit, so a unit with two branched tracks keeps each pick on its own. `stored` is
 * the account as the server holds it SETTLED (its canonical form), `incoming` the raw body. With no branched table in force
 * (the shipped table while branching is closed) the body comes back as the same object.
 */
import type { BrigadeAccount } from './brigade';
import { isPick, migrateLegacy, migratePicks, shippedBranched, type BranchedTable, type LegacyMap, type PicksMap } from './branches';

export function stickyPicks(stored: BrigadeAccount | undefined, incoming: BrigadeAccount, branched: BranchedTable = shippedBranched()): BrigadeAccount {
  if (Object.keys(branched).length === 0) return incoming;
  const picks: PicksMap = migratePicks(incoming.picks);
  const legacy: LegacyMap = migrateLegacy(incoming.legacy);
  const set = (unit: string, track: string, pick: 1 | 2 | undefined, marker: boolean): void => {
    if (pick === undefined) delete picks[unit]?.[track];
    else (picks[unit] ??= {})[track] = pick;
    if (marker) (legacy[unit] ??= {})[track] = true;
    else delete legacy[unit]?.[track];
  };
  for (const [unit, tracks] of Object.entries(branched)) {
    for (const [track, fork] of Object.entries(tracks)) {
      if ((incoming.upgrades?.[unit]?.[track] ?? 0) < fork.tier) continue;
      const incomingPick = picks[unit]?.[track];
      const storedPick = stored !== undefined && (stored.upgrades[unit]?.[track] ?? 0) >= fork.tier ? stored.picks?.[unit]?.[track] : undefined;
      if (!isPick(storedPick)) {
        // A fresh buy of a pick carries no marker; no pick is left for `migrateAccount` (pick 1 and a marker).
        if (incomingPick !== undefined) set(unit, track, incomingPick, false);
        else delete legacy[unit]?.[track];
        continue;
      }
      const storedMarker = stored?.legacy?.[unit]?.[track] === true;
      if (incomingPick === undefined || incomingPick === storedPick) set(unit, track, storedPick, storedMarker);
      else if (storedMarker) set(unit, track, incomingPick, false);
      else set(unit, track, storedPick, false);
    }
  }
  return { ...incoming, picks, legacy };
}
