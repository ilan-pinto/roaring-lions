/**
 * The last game version whose "What's new" panel this browser has shown (GH-1622). The ONLY reader and writer of
 * `lions.whatsNew.seen`: a bare `X.Y.Z` string.
 *
 * WHY NOT `lions.settings`. The settings blob has one writer, `main.ts`'s `settingsDeps.set`, which persists the WHOLE
 * object it holds in memory. A menu that wrote the field into the stored blob itself would be undone by the next settings
 * change anywhere (that write carries the in-memory copy, without the field), and the panel would open again next load;
 * doing it properly means handing `settingsDeps` to the menu, an edit to `main.ts`. One key with one owner keeps the
 * menu module self-contained. It is a per-browser fact like `lions.qualityHint.answered`, not a preference: Settings has
 * no row for it, a save slot does not snapshot it, and `?fresh` leaves it alone.
 *
 * GUARDED. The store is `safeStorage`'s (null when the access itself throws, with site data blocked), and every read
 * and write is in try/catch as well, so a store that throws on use is the same as no store. What was marked is ALSO
 * held in memory for the page, so with storage blocked the panel still opens at most once per page load, not on every
 * return to the menu.
 */
import { safeStorage, type StorageLike } from './telemetry/identity';

export const WHATS_NEW_SEEN_KEY = 'lions.whatsNew.seen';

/** All this module needs of a store. */
export type SeenStore = Pick<StorageLike, 'getItem' | 'setItem'>;

const VERSION = /^\d+\.\d+\.\d+$/;

/** What this page marked, whatever the store did with it. */
let seenThisPage: string | null = null;

/** The version last marked seen, or null when none was (a first visit, a blocked store, a value that is not `X.Y.Z`). */
export function readSeenVersion(store: SeenStore | null): string | null {
  if (seenThisPage !== null) return seenThisPage;
  if (store === null) return null;
  try {
    const v = store.getItem(WHATS_NEW_SEEN_KEY);
    return v !== null && VERSION.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Mark `version` seen: in memory for this page, and in the store when it takes the write. */
export function markVersionSeen(store: SeenStore | null, version: string): void {
  seenThisPage = version;
  if (store === null) return;
  try {
    store.setItem(WHATS_NEW_SEEN_KEY, version);
  } catch {
    // Blocked or full: the page's memory above still holds it.
  }
}

/** The browser's own store, or null when site data is blocked. */
export function browserWhatsNewStore(): SeenStore | null {
  return safeStorage(() => window.localStorage);
}

/** Tests only: forget what this page marked. */
export function resetWhatsNewMemoryForTest(): void {
  seenThisPage = null;
}
