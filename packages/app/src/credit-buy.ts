/**
 * The Garage's credit Buy, as the handler in `main.ts` runs it (store/garage WP5).
 * Pure: the caller hands in a FRESH read of the account and of the single-player view,
 * and writes the answer. Kept out of `main.ts` so the stale-ask refusal can be tested.
 */
import type { BranchPick } from '@lions/data';
import { buyBranch, shippedBranched, type BranchedTable, type RoarWallet } from '@lions/economy';
import { buyUpgradeRun, type BrigadeAccount } from './brigade-account';
import { creditAsk } from './upgrade-pay';
export { buildCoinHalf } from '@lions/economy';

export interface CreditBuyRead {
  readonly account: BrigadeAccount;
  /** The single-player view, `max(earned, coins)` (what `accountView` returns). */
  readonly owned: Record<string, Record<string, number>>;
  /** GH-1384: the coin wallet, read with the account, so a run onto a branched tier refuses the
   *  branch the coins do not hold (`buyBranch`'s guard). */
  readonly roar: Pick<RoarWallet, 'entitlements'>;
}

export function buyTierWithCredits(
  read: CreditBuyRead,
  prices: readonly number[],
  unitId: string,
  track: string,
  to: number,
  price: number,
  /** GH-1384: the branch the Garage's fork chose, for a run onto a branched tier; ignored otherwise. */
  pick?: BranchPick,
  branched: BranchedTable = shippedBranched()
): { account: BrigadeAccount; ok: boolean; item: string } {
  // Recompute the ask from THIS read and refuse unless it is the one the button drew
  // (Review Focus 2): the draw may be stale (a coin Buy in another tab). Never trust
  // the button's price. `owned` is the single-player view, `earned` the account's own.
  const earned = read.account.upgrades[unitId]?.[track] ?? 0;
  const owned = Math.max(earned, read.owned[unitId]?.[track] ?? 0);
  const ask = creditAsk(prices, earned, owned);
  if (ask === null || ask.to !== to || ask.price !== price) {
    return { account: read.account, ok: false, item: `${unitId}.${track}.${to}` };
  }
  // R0.5: the item names the tier the run ends on; `price` is the run's total.
  // GH-1384: a run onto a branched tier buys the branch the fork chose, and with no pick it is
  // refused (`buyBranch` refuses a pick that is not 1 or 2); every other run is the plain tier run.
  const fork = branched[unitId]?.[track];
  const { account, ok } =
    fork !== undefined && ask.to >= fork.tier
      ? pick === undefined
        ? { account: read.account, ok: false }
        : buyBranch(read.account, read.roar, unitId, track, ask.from, pick, prices, branched)
      : buyUpgradeRun(read.account, unitId, track, ask.from, ask.to, prices, branched);
  return { account, ok, item: `${unitId}.${track}.${to}` };
}
