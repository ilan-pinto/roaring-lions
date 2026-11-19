/**
 * The income-zone board as a human reads it off the HUD, for the commander (GH-1391): which zones the room has, where, what each pays, and who
 * holds each now. The HOLDER is read from the runtime, never the units standing in it (those stay behind the fog, `SideView.contacts`).
 *
 * What a seat may know differs by room, and this follows the HUD:
 *   - a POINTS RACE shows both sides' holders to both seats (`points-view.ts`: the race is only a race if both can read it), so `theirs` is
 *     public there;
 *   - an ECONOMY room's HUD (`income-view.ts`) shows held / unheld / contested and does NOT tell an enemy-held zone from an empty one, so
 *     `theirs` would reveal an enemy unit standing in a fogged zone. There it reads `none`, and a unit's presence in the zone is learned only
 *     as the unit's own fog shows it (`SideView.contacts`).
 * Empty in every room with no zones.
 */
import type { MatchWorld } from '../match-world';
import type { ZoneFact, ZoneHolderNow } from './commander';

/** `ZONE_CONTESTED` (`@lions/sim`'s income.ts), restated as `points-view.ts` restates it: contested is not a holder. */
const CONTESTED = -2;

export function zoneFacts(w: Pick<MatchWorld, 'runtime' | 'winMode'>, side: 0 | 1): ZoneFact[] {
  const rt = w.runtime;
  if (rt === null) return [];
  const other: 0 | 1 = side === 0 ? 1 : 0;
  return rt.incomeZones.map((z) => {
    const holder: ZoneHolderNow = z.state === CONTESTED ? 'contested' : z.holder === side ? 'mine' : z.holder === other && w.winMode === 'points' ? 'theirs' : 'none';
    return { zone: z.zone, at: [z.rect[0], z.rect[1], z.rect[2], z.rect[3]] as const, holder, perMin: z.ratePerMin };
  });
}
