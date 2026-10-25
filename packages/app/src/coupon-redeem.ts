/**
 * Redeeming a coupon against the stores that hold its two grants: credits go to the
 * brigade account (`lions.brigade.account`), Roar coins to the TEST wallet
 * (`lions.roar.test`). The two keys are separate on purpose (spec guard G3: coins never
 * become credits), so this is the one place that writes both, and it undoes the account
 * write when the wallet write fails, so a code is never spent for nothing.
 * Client-side and trust-based until the server ledger (GH-205).
 */
import { redeemCoupon, type Coupon } from './brigade-account';
import type { LedgerStore } from './ledger-store';
import { grantCouponCoins } from './roar-test';

export type RedeemOutcome =
  | { result: 'ok'; credits: number; coins: number }
  | { result: 'unknown' | 'used' | 'failed' };

type RedeemStore = Pick<LedgerStore, 'readAccount' | 'writeAccount' | 'readRoarTest' | 'writeRoarTest'>;

export function redeemOnStore(
  store: RedeemStore,
  code: string,
  table: readonly Coupon[],
  hash: (text: string) => string,
  at: number
): RedeemOutcome {
  const before = store.readAccount();
  const r = redeemCoupon(before, code, table, hash, at);
  if (!r.ok) return { result: r.reason };
  try {
    store.writeAccount(r.account);
    if (r.coins > 0) store.writeRoarTest(grantCouponCoins(store.readRoarTest(), r.coins, r.ids, at));
  } catch {
    try {
      store.writeAccount(before);
    } catch {
      /* storage is refusing writes; nothing more can be undone */
    }
    return { result: 'failed' };
  }
  return { result: 'ok', credits: r.credits, coins: r.coins };
}
