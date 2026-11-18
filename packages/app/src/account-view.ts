/**
 * The account as SINGLE-PLAYER plays it: the brigade account's earned unlocks
 * and tiers, joined with the Roar coin wallet's coin-bought ones
 * (`roar-wallet.ts`'s `singlePlayerView`: `earned OR coins`, a tier
 * `max(earned, coins)`). `main.ts`'s `accountState()` is this function, so the
 * garage, the reinforcement dock, `resolveUpgrades` and the boot-time upgrade
 * prepass all see a coin-bought unit through the one `kdfUnlockGate` read
 * they already share.
 *
 * `balance` is the brigade's EARNED credits and nothing else: a coin purchase
 * never moves it (spec guard G3).
 */
import type { LedgerStore } from './ledger-store';
import type { BranchPick } from '@lions/data';
import { singlePlayerView } from './roar-wallet';

export interface AccountView {
  boughtUnits: Set<string>;
  ownedTiers: Record<string, Record<string, number>>;
  /** GH-1384: per (unit, track) held at its branched last tier, the ONE branch owned (the
   *  earned pick wins where the two stores disagree). It goes wherever `ownedTiers` goes. */
  ownedPicks: Record<string, Record<string, BranchPick>>;
  balance: number;
}

export function accountView(store: Pick<LedgerStore, 'readAccount' | 'readRoar'>): AccountView {
  const account = store.readAccount();
  const { boughtUnits, ownedTiers, ownedPicks } = singlePlayerView(account, store.readRoar());
  return { boughtUnits, ownedTiers, ownedPicks, balance: account.balance };
}
