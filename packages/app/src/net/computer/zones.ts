/**
 * The income-zone board as a human reads it off the HUD, for the commander (GH-1391): which zones the room has, where, what each pays, and who
 * holds each now. Public by design, exactly as `points-view.ts` is: the HOLDER of a zone is read from the runtime, never the units standing in
 * it (those stay behind the fog, `SideView.contacts`). Present in an economy room and in a points race; empty in every other room.
 */
import type { MatchWorld } from '../match-world';
import type { ZoneFact, ZoneHolderNow } from './commander';

/** `ZONE_CONTESTED` (`@lions/sim`'s income.ts), restated as `points-view.ts` restates it: contested is not a holder. */
const CONTESTED = -2;

export function zoneFacts(w: Pick<MatchWorld, 'runtime'>, side: 0 | 1): ZoneFact[] {
  const rt = w.runtime;
  if (rt === null) return [];
  const other: 0 | 1 = side === 0 ? 1 : 0;
  return rt.incomeZones.map((z) => {
    const holder: ZoneHolderNow = z.state === CONTESTED ? 'contested' : z.holder === side ? 'mine' : z.holder === other ? 'theirs' : 'none';
    return { zone: z.zone, at: [z.rect[0], z.rect[1], z.rect[2], z.rect[3]] as const, holder, perMin: z.ratePerMin };
  });
}
