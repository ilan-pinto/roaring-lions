/**
 * The brigade account (spec 2026-09-15 §4.1): what the player has earned and bought,
 * kept BESIDE the campaign ledger under its own key so a fresh campaign leaves it alone.
 * This module is the only reader and writer of that key.
 * The pure rules moved to `@lions/economy` (GH-1075 A0); this module re-exports them so no
 * caller changes.
 *
 * `payMission` is the only CONSTRUCTOR of a grant, and it only ever writes
 * `source: 'earned'`. The paid path (spec §4.6) writes `source: 'granted'` -- from a
 * server or a store entitlement, never from here -- and this module does not destroy
 * one it finds: §4.6 promises the shape of `grants` does not change the day the paid
 * path arrives, so `migrateAccount` keeps a well-formed entry of EITHER source and
 * counts both toward the balance/earned_total bound below (ruling R6).
 *
 * `payMission` is the improvement rule: a mission pays the difference between this run's
 * value and what it has paid before, never less than zero, and the record moves up.
 * Since GH-330 there are TWO records. `paid` is the lifetime best and survives a new
 * campaign, as the account does (spec 2026-09-15 §4.1). `campaign_paid` is the best in
 * THIS campaign, and `startCampaign` clears it, so a new campaign pays again while a
 * replay inside one campaign still pays improvement only. Which record a payout is
 * measured against is the caller's `scope` (`campaign-pay.ts` decides it: a mission
 * that is not open in the campaign is measured against the lifetime record, so a
 * locked mission played by address cannot repeat a payout).
 */
import { emptyAccount, migrateAccount } from '@lions/economy';
import type { BrigadeAccount } from '@lions/economy';

export {
  ACCOUNT_VERSION,
  emptyAccount,
  migrateAccount,
  payMission,
  buyUnlock,
  buyUpgrade,
  buyUpgradeRun,
  startCampaign,
  redeemCoupon,
} from '@lions/economy';
export type { BrigadeAccount, Coupon, Grant, PayScope, Redemption } from '@lions/economy';

export const ACCOUNT_KEY = 'lions.brigade.account';
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadAccount(store: StorageLike, doneInCampaign?: ReadonlySet<string>): BrigadeAccount {
  try {
    const text = store.getItem(ACCOUNT_KEY);
    return text === null ? emptyAccount() : migrateAccount(JSON.parse(text), doneInCampaign);
  } catch {
    return emptyAccount();
  }
}

export function saveAccount(store: StorageLike, account: BrigadeAccount): void {
  store.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function resetAccount(store: StorageLike): BrigadeAccount {
  store.removeItem(ACCOUNT_KEY);
  return emptyAccount();
}
