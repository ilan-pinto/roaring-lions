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
 * `Storage` global: `main.ts`'s `safeStorage()` is what stands between this
 * module and a `window.localStorage` property access that can throw on its
 * own (private mode, site data blocked) -- passing its result straight
 * through, null and all, is what keeps that guard in exactly one place. A
 * caller that already has a definite store (`profile.ts`'s `StorageLike`
 * parameters, never null) can still hand one in unchanged.
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
