/**
 * What a side's held income zones pay it a minute: the sum of `paysPerMin` over the zones whose holder is `side`
 * (the runtime already halves a cut zone and zeroes an empty or contested one). Pure and import-free on purpose:
 * the strip (`room-economy.ts`) and the AI harness's `observe` (`tools/src/net/economy-view.ts`) both call it, and
 * the harness cannot import `room-economy.ts`, whose types reach the UI, because the stdout-purity walk of
 * `agent.test.ts` follows every import.
 */
export function zoneRatePerMin(zones: readonly { readonly holder: number; readonly paysPerMin: number }[], side: 0 | 1): number {
  let rate = 0;
  for (const z of zones) if (z.holder === side) rate += z.paysPerMin;
  return rate;
}
