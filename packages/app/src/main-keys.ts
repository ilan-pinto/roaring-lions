// packages/app/src/main-keys.ts
/**
 * The two `window.localStorage` keys the active campaign lives under, and the
 * pair of functions that read/write the ledger one. Pulled out of `main.ts` so
 * `profile.ts` (save slots) can read and write the SAME keys `main.ts` does --
 * a slot is a snapshot of them, and loading one writes them back -- without
 * either module reaching into the other's internals or duplicating the
 * strings.
 *
 * `loadLedger`/`saveLedger` take a `StorageLike | null` rather than the bare
 * `Storage` global: `ledger-store.ts`'s `safeStorage()` is what stands between
 * this module and a `window.localStorage` property access that can throw on
 * its own (private mode, site data blocked) -- passing its result straight
 * through, null and all, is what keeps that guard in exactly one place.
 *
 * Nothing but `ledger-store.ts` calls these any more. This module is the
 * IMPLEMENTATION of the app's one door to the save, not its API: a screen or a
 * screen's host asks the `LedgerStore` for the ledger and never names a
 * storage key, which is what lets WP-ST6 replace the whole of it.
 */
import type { LedgerData } from '@lions/sim';
import type { StorageLike } from './brigade-account';

/** Campaign persistence: victories merge their produced ledger keys here;
 *  defeats write nothing — replaying a mission for a better ledger is free. */
export const LEDGER_KEY = 'lions.campaign.ledger';

/** Whether this human has been through the tutorial — a fact about the person,
 *  not the campaign, so it survives a ledger reset. Clearing your ledger should
 *  not re-teach you right-click. */
export const TUTORIAL_DONE_KEY = 'lions.tutorial.done';

export function loadLedger(store: StorageLike | null): LedgerData {
  if (!store) return {};
  try {
    return JSON.parse(store.getItem(LEDGER_KEY) ?? '{}') as LedgerData;
  } catch {
    return {};
  }
}

export function saveLedger(store: StorageLike | null, ledger: LedgerData): void {
  store?.setItem(LEDGER_KEY, JSON.stringify(ledger));
}

/**
 * The tutorial flag, read ONE way.
 *
 * Minor 4 (final review): it was read with two different predicates --
 * `getItem(...) === '1'` in `profile.ts` and `!== null` / `=== null` at three
 * places in `main.ts`. Inert today, because `'1'` is the only value ever
 * written; not inert if anything ever writes another, in which case a slot
 * would record `tutorialDone: false` for a player the game itself treats as
 * done, and the two halves would disagree inside one save file. The writer is
 * `markTutorialDone` below, so the value and the test for it are one pair.
 */
export function tutorialDone(store: StorageLike | null): boolean {
  return store?.getItem(TUTORIAL_DONE_KEY) === '1';
}

/** The only writer of `TUTORIAL_DONE_KEY`'s truthy value, and the reason
 *  `tutorialDone` can compare against a literal. */
export function markTutorialDone(store: StorageLike | null): void {
  store?.setItem(TUTORIAL_DONE_KEY, '1');
}
