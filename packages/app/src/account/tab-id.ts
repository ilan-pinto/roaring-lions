/**
 * This tab's id (GH-1075 A2, §0.38): minted once per tab and kept in `sessionStorage`, which is per-tab, so each tab
 * writes its own outbox key. Under a refusing storage it falls back to one id per page load, held in memory.
 */
import type { StorageLike } from '../brigade-account';

export const TAB_ID_KEY = 'lions.account.tabId';

let memoryId: string | null = null;

const mint = (): string => crypto.randomUUID();

export function tabIdOf(storage: StorageLike | null): string {
  try {
    const stored = storage?.getItem(TAB_ID_KEY);
    if (typeof stored === 'string' && stored !== '') return stored;
    if (storage) {
      const id = mint();
      storage.setItem(TAB_ID_KEY, id);
      return id;
    }
  } catch {
    /* a refusing storage: fall through to the in-memory id */
  }
  return (memoryId ??= mint());
}

/**
 * R27 (NB2): this tab's outbox key belongs to another member, so this store must not write to it. Mint a new id, keep it in
 * `sessionStorage` for the tab's later boots, and return it; the old key keeps its owner's ops and ages into an orphan.
 */
export function rekeyTabId(storage: StorageLike | null): string {
  const id = mint();
  memoryId = id; // also the fallback when storage is absent or refuses: one id for the page load
  try {
    storage?.setItem(TAB_ID_KEY, id);
  } catch {
    /* as above */
  }
  return id;
}
