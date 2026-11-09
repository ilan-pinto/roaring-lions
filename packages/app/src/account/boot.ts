/**
 * Boot for a signed-in device (GH-1075 A2, §0.11, Task 2.12): wait for the first `GET state` when a claimed binding has no
 * cache (5 s), then start the sync loop and the spend flow around the account store. A guest, `?fresh`, or a boot without
 * `?accounts` never reaches the network from here: `selected.signedIn` is false and nothing is built.
 *
 * Failure is stated, not hidden: a claimed device with no cache whose state does not arrive keeps the blocked store
 * (the claim removed the guest keys) and reports `unreachable`, which the menu says and which disables the campaign entry.
 */
import type { StorageLike } from '../brigade-account';
import type { SelectedStore } from './select-store';
import { isAccountStore } from './account-store';
import { readBinding } from './binding';
import { writeCache } from './cache';
import type { AccountClient, VictoryAnswer } from './client';
import { spendFlow, type SpendFlow } from './spend-flow';
import { startSync, type SyncHandle } from './sync';

/** How long boot waits for the first `GET state` of a claimed device that has no cache. */
export const FIRST_STATE_MS = 5000;

export interface BootAccountOptions {
  selected: SelectedStore;
  /** Runs `selectLedgerStore` again; called once, after the first state was written to the cache. */
  reselect: () => SelectedStore;
  client: AccountClient;
  storage: StorageLike | null;
  now: () => number;
  schedule: (ms: number, fn: () => void) => () => void;
  locks?: LockManager;
  online?: () => boolean;
  /** The first-state wait; tests shorten it. */
  waitMs?: number;
  /** The view changed (a response landed): the screens re-read. */
  onChange?: () => void;
  onForeignMember?: () => void;
}

export interface BootedAccount {
  selected: SelectedStore;
  sync: SyncHandle | null;
  flow: SpendFlow | null;
  unreachable: boolean;
}

export async function bootAccount(o: BootAccountOptions): Promise<BootedAccount> {
  let selected = o.selected;
  const none = (unreachable: boolean): BootedAccount => ({ selected, sync: null, flow: null, unreachable });
  if (!selected.signedIn) return none(false);
  if (selected.needsState) {
    const binding = readBinding(o.storage);
    let timer: (() => void) | null = null;
    const timeout = new Promise<null>((resolve) => {
      timer = o.schedule(o.waitMs ?? FIRST_STATE_MS, () => resolve(null));
    });
    const got = await Promise.race([o.client.state().catch(() => null), timeout]);
    (timer as (() => void) | null)?.();
    if (got === null || !got.ok || binding === null) return none(true);
    const { campaign, wallet, slots } = got.body;
    writeCache(o.storage, { version: 1, publicId: binding.publicId, confirmed: { campaign, wallet, slots }, bodies: {} });
    selected = o.reselect();
    if (selected.needsState) return none(true); // the cache could not be kept (storage refused): no store to build on
  }
  if (!isAccountStore(selected.store)) return none(false);
  const store = selected.store;
  const flow = spendFlow({ store, online: o.online });
  const sync = startSync({
    store,
    client: o.client,
    storage: o.storage,
    locks: o.locks,
    now: o.now,
    schedule: o.schedule,
    online: o.online,
    onChange: () => {
      flow.notify();
      o.onChange?.();
    },
    onVictory: (opId: string, answer: VictoryAnswer) => flow.onVictory(opId, answer),
    onForeignMember: o.onForeignMember,
  });
  flow.attach(sync);
  void sync.refresh().catch(() => undefined); // the sync loop's header: boot refreshes, then the loop keeps it
  return { selected, sync, flow, unreachable: false };
}
