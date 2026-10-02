/**
 * The account as SINGLE-PLAYER plays it: the brigade account's earned unlocks
 * and tiers, joined with the Roar coin TEST wallet's coin-bought ones
 * (`roar-test.ts`'s `singlePlayerView`: `earned OR coins`, a tier
 * `max(earned, coins)`). `main.ts`'s `accountState()` is this function, so the
 * garage, the reinforcement dock, `resolveUpgrades` and the boot-time upgrade
 * prepass all see a coin-bought unit through the one `kdfUnlockGate` read
 * they already share.
 *
 * `balance` is the brigade's EARNED credits and nothing else: a coin purchase
 * never moves it (spec guard G3).
 */
import type { LedgerStore } from './ledger-store';
import { singlePlayerView } from './roar-test';

export interface AccountView {
  boughtUnits: Set<string>;
  ownedTiers: Record<string, Record<string, number>>;
  balance: number;
}

export function accountView(store: Pick<LedgerStore, 'readAccount' | 'readRoarTest'>): AccountView {
  const account = store.readAccount();
  const { boughtUnits, ownedTiers } = singlePlayerView(account, store.readRoarTest());
  return { boughtUnits, ownedTiers, balance: account.balance };
}
