/**
 * GH-1395 slice 2: the campaign board's challenge mark (design §5.3 3; the lead's D1: "a small coin mark, challenge done").
 *
 * A town pin that holds a mission whose challenge is beaten in THIS campaign gains a coin mark and `done/of` beside its
 * stars, `of` counting the town's missions that have a challenge. It reads the ledger mark slice 1 writes
 * (`campaign.challenge_results`, through `challengeMarksOf`, which drops a wrong-shaped row) and nothing else, and a mark
 * whose id is not the mission's current challenge is not counted.
 *
 * It never feeds stars or unlocks (D2): it is drawn BESIDE `townStars`, never into it, and `starsEarned`, `townStars` and
 * `possibleStars` do not read the key (`challenge-board.test.ts` pins each against a ledger with and without marks).
 *
 * Loaded lazily by the campaign route (main.ts `mountCampaign`, through `importWithRetry`), so the challenge catalogue is
 * not on the entry chunk; a load that fails leaves the board without the mark.
 */
import { challengeOf } from '@lions/data';
import type { LedgerData } from '@lions/sim';
import type { ParsedWorld } from '../campaign';
import { challengeMarksOf } from '../challenge';
import { t } from '../i18n/t';

/** For each town with a challenge mission: how many of those challenges this campaign has beaten. */
export function townChallenges(world: ParsedWorld, ledger: LedgerData | undefined): Map<string, { done: number; of: number }> {
  const marks = challengeMarksOf(ledger);
  const out = new Map<string, { done: number; of: number }>();
  for (const region of world.regions) {
    for (const town of region.towns) {
      let done = 0;
      let of = 0;
      for (const id of town.missions) {
        const c = challengeOf(id);
        if (c === undefined) continue;
        of++;
        if (Object.hasOwn(marks, id) && marks[id]?.id === c.challenge.id) done++;
      }
      if (of > 0) out.set(town.id, { done, of });
    }
  }
  return out;
}

/** The board's `townMark` hook: a coin mark for a town with at least one beaten challenge, else null. */
export function challengeTownMark(world: ParsedWorld, ledger: LedgerData | undefined): (townId: string) => HTMLElement | null {
  const byTown = townChallenges(world, ledger);
  return (townId) => {
    const c = byTown.get(townId);
    if (c === undefined || c.done === 0) return null;
    const mark = document.createElement('span');
    mark.className = 'rl-world__challenge';
    mark.dataset.done = String(c.done);
    mark.dataset.of = String(c.of);
    const label = t('world.challenge', { n: c.done, of: c.of });
    mark.title = label;
    mark.setAttribute('aria-label', label);
    mark.textContent = ` ${c.done}/${c.of}`;
    return mark;
  };
}
