/**
 * The end of the campaign, and the two voices that say so.
 *
 * The polish audit's "no campaign-complete line anywhere": the last town's last
 * victory used to end on the same report as any other mission, and the board
 * went on telling the player to "click a front to open its next operation"
 * with nothing left to open. Two surfaces read this file -- the after-action
 * report (`ui/debrief.ts`, the closing exchange) and the campaign board's
 * resting line (`ui/worldmap3d.ts`, `ui/worldmap.ts`).
 *
 * Complete is DERIVED, like everything else on the board: every region with a
 * mission authored is `complete` by `regionProgress`, read off
 * `campaign.completed_missions`. No flag is stored, so a save can never say the
 * war is over while a mission is still open, and "New campaign" undoes it.
 *
 * The words are the catalogue's (`debrief.closing.*`, `world.complete`): a
 * campaign line belongs to no one mission, so it has no mission file to live in.
 * Static text, never conditioned on the ledger (storyline.md D9).
 */
import type { LedgerData } from '@lions/sim';
import { regionProgress, type ParsedWorld } from './campaign';
import { t } from './i18n/t';

/** Every region that has missions is finished, and there is at least one. */
export function campaignComplete(world: ParsedWorld, ledger: LedgerData | undefined): boolean {
  let any = false;
  for (const region of world.regions) {
    const p = regionProgress(region, ledger);
    if (p.total === 0) continue;
    if (p.status !== 'complete') return false;
    any = true;
  }
  return any;
}

export type ClosingSpeaker = 'idit' | 'shai';

/** Who speaks each `debrief.closing.N`, in order: Idit's picture, Shai's
 *  answer, alternating, as every briefing does. */
export const CLOSING_SPEAKERS: readonly ClosingSpeaker[] = ['idit', 'shai', 'idit', 'shai'];

/**
 * The closing exchange for the report of the victory that FINISHED the
 * campaign -- complete after this run's ledger and not before it. Null on a
 * defeat, on any other victory, and on a replay once the war is already over:
 * the exchange is said once, on the win that earned it.
 */
export function closingExchange(
  world: ParsedWorld,
  before: LedgerData | undefined,
  after: LedgerData | undefined,
  result: 'victory' | 'defeat'
): { speaker: ClosingSpeaker; text: string }[] | null {
  if (result !== 'victory') return null;
  if (campaignComplete(world, before) || !campaignComplete(world, after)) return null;
  return CLOSING_SPEAKERS.map((speaker, i) => ({ speaker, text: t(`debrief.closing.${i + 1}`) }));
}

/** The campaign board's resting line: the click hint while anything is open,
 *  and the end of the war once nothing is. */
export function boardRestingLine(world: ParsedWorld, ledger: LedgerData | undefined): string {
  return campaignComplete(world, ledger) ? t('world.complete') : t('world3d.hint');
}
