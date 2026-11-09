/**
 * The credit price of an upgrade tier (store/garage spec 2026-11-07 §2.3, R3, with
 * the lead's R0.1 ruling of 7 Nov). Pure, and credits only: it never reads the wallet.
 *
 * Two records exist per track. `earned` is the brigade account's `upgrades` (paid in
 * credits); `owned` is the single-player tier, `max(earned, coins)`. A credit Buy
 * targets the next single-player tier, `owned + 1`, and fills the EARNED path below
 * it, so it pays for tiers `earned + 1 ... owned + 1`. When coins have not run ahead
 * (`owned === earned`) that is exactly the one-tier Buy.
 *
 * R0.1: when `owned` is at the top of the track there is no ask. The retired "Count
 * online" run would have sold only a catch-up whose sole effect was network play, and
 * nothing on a room path reads it, so the ask is `null`.
 *
 * `owned` rather than the coin tier is the argument (R0.2): when `owned > earned` the
 * coin tier IS `owned`, and otherwise the coin tier cannot change the ask. So no
 * caller reads the wallet to price a credit Buy.
 */
export interface CreditAsk {
  /** The first earned tier the run buys: `earned + 1`. */
  readonly from: number;
  /** The last tier the run buys: `owned + 1`. */
  readonly to: number;
  /** The run's total in credits. */
  readonly price: number;
  /** How many tiers of the run the coin path already holds (`owned - earned`). */
  readonly again: number;
}

export function creditAsk(prices: readonly number[], earned: number, owned: number): CreditAsk | null {
  const have = owned > earned ? owned : earned;
  if (have >= prices.length) return null;
  const from = earned + 1;
  const to = have + 1;
  let price = 0;
  for (let t = from; t <= to; t++) price += prices[t - 1];
  return { from, to, price, again: have - earned };
}
