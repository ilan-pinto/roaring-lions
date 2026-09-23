// tools/src/ui-review/outcome-guard.ts
//
// Fix round 1 (Task 6 review): `shoot.ts`'s `shot()` never checked, after
// taking the outcome-moment screenshots, that the moment (`ui/outcome-
// moment.ts`) was still the thing on screen. Under load, a real run
// captured `25-outcome-defeat.png` AFTER the moment's own hold had already
// elapsed and `showEndScreen` had already replaced it -- the PNG showed
// `.rl-bigbanner`/`showEndScreen`'s "Withdraw and regroup" card, not the
// moment, under the outcome-moment's own filename, and the script still
// exited 0.
//
// `outcomeMoment` (`ui/outcome-moment.ts`) has no intermediate "dismissing"
// state to check separately from presence -- its own header is explicit
// that `dismiss()`/`finish()` takes the node off the document SYNCHRONOUSLY
// (`el.remove()`), unlike `titleCard`'s 250ms fade-then-remove. So there is
// nothing "half-dismissed" to catch: the moment is either still in the DOM
// (and, since removal is one-way and nothing re-creates the same node, was
// therefore in the DOM for the whole screenshot that just ran) or it is
// gone, and gone is the only failure mode worth naming.
//
// Extracted from `shoot.ts` itself so the check has a seam `pnpm test` can
// exercise directly -- Playwright never has to boot for this file.
export class OutcomeMomentDismissedError extends Error {
  constructor(label: string) {
    super(`outcome moment dismissed before its photograph (${label})`);
    this.name = 'OutcomeMomentDismissedError';
  }
}

/**
 * Throws {@link OutcomeMomentDismissedError} when `stillPresent` is false.
 *
 * The caller reads `stillPresent` from the page right after `shot()`
 * returns -- `(await page.locator('.rl-outcome[data-outcome="…"]').count()) >
 * 0` -- so this function itself never touches a browser and can be driven
 * with a plain boolean.
 */
export function assertOutcomeStillPresent(stillPresent: boolean, label: string): void {
  if (!stillPresent) throw new OutcomeMomentDismissedError(label);
}
