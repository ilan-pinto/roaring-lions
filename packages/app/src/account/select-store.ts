/**
 * Which `LedgerStore` this boot gets (GH-1075 A2, §0.11), decided once and synchronously. A guest, a device with no
 * claim, `?fresh`, or no `?accounts` all get today's `browserLedgerStore`, untouched. Only a claimed binding behind
 * `?accounts` gets the server-backed store; with no cache yet it gets a blocked store (no guest key is read: the claim
 * removed them) and `needsState`, so boot awaits `GET state` before the first screen.
 */
import type { ParsedWorld } from '@lions/economy';
import type { StorageLike } from '../brigade-account';
import { blockedLedgerStore, browserLedgerStore, type LedgerStore, type RoarBackfill } from '../ledger-store';
import { accountLedgerStore } from './account-store';
import { readBinding } from './binding';
import { readCache } from './cache';
import { accountsEnabled } from './enabled';

export interface SelectedStore {
  store: LedgerStore;
  signedIn: boolean;
  needsState: boolean;
}

export interface SelectOptions {
  world: ParsedWorld;
  /** Called after every queued write (the sync loop, Task 2.10). */
  onChange?: () => void;
  tabId?: string;
  newOpId?: () => string;
}

export function selectLedgerStore(query: URLSearchParams, storage: StorageLike | null, backfill: RoarBackfill, o: SelectOptions): SelectedStore {
  const guest: SelectedStore = { store: browserLedgerStore(backfill), signedIn: false, needsState: false };
  if (!accountsEnabled(query)) return guest;
  const binding = readBinding(storage);
  if (binding === null || binding.claimedAt === undefined) return guest;
  const cache = readCache(storage);
  if (cache === null || cache.publicId !== binding.publicId) return { store: blockedLedgerStore(), signedIn: true, needsState: true };
  const store = accountLedgerStore({
    storage,
    cache,
    world: o.world,
    onChange: o.onChange ?? ((): void => {}),
    newOpId: o.newOpId ?? ((): string => crypto.randomUUID()),
    ...(o.tabId !== undefined ? { tabId: o.tabId } : {}),
  });
  return { store, signedIn: true, needsState: false };
}
