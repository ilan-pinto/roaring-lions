/**
 * The Garage's credit Buy, as the handler in `main.ts` runs it (store/garage WP5).
 * Pure: the caller hands in a FRESH read of the account and of the single-player view,
 * and writes the answer. Kept out of `main.ts` so the stale-ask refusal can be tested.
 */
import { buyUpgradeRun, type BrigadeAccount } from './brigade-account';
import { creditAsk } from './upgrade-pay';

export interface CreditBuyRead {
  readonly account: BrigadeAccount;
  /** The single-player view, `max(earned, coins)` (what `accountView` returns). */
  readonly owned: Record<string, Record<string, number>>;
}

export function buyTierWithCredits(
  read: CreditBuyRead,
  prices: readonly number[],
  unitId: string,
  track: string,
  to: number,
  price: number
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
  const { account, ok } = buyUpgradeRun(read.account, unitId, track, ask.from, ask.to, ask.price);
  return { account, ok, item: `${unitId}.${track}.${to}` };
}
