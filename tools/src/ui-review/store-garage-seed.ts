// The Store/Garage look sheet's state (plan 2026-11-07 WP10): one fixed `localStorage` seed for
// `store-garage-sheet.ts`, the mixed track the sheet exists to show.
//
//  - `spg_long_range` (the howitzer) is bought with CREDITS (`unlocks`), with NO earned armour tier
//    (`upgrades` empty) but coin armour tier 2 in the wallet: `creditAsk(prices, 0, 2)` is the run
//    `{ from: 1, to: 3, price: 740, again: 2 }`, so the Stores' tier row and the Garage's track
//    both carry the run label beside the coin Buy;
//  - `inf_medic_squad` is NOT bought, so its card sells and "What it adds" reads as a buyer sees it;
//  - 800 credits on hand (one `granted` entry covers the whole balance: `migrateAccount` bounds
//    `balance` to the grants log, so the seed is a fixed point only if they agree) and 600 free
//    coins, welcomed and back-paid so no load-time earn moves the wallet under the camera.
//
// Every literal is read back verbatim by `store-garage-seed.test.ts`. The script is a STRING, not a
// function, for the reason `garage-seed.ts` gives (tsx `keepNames` and `__name`).
import type { BrigadeAccount } from '../../../packages/app/src/brigade-account';
import { ACCOUNT_KEY, ACCOUNT_VERSION } from '../../../packages/app/src/brigade-account';
import { LEDGER_KEY } from '../../../packages/app/src/main-keys';
import { ROAR_KEY, ROAR_VERSION, type RoarWallet } from '../../../packages/app/src/roar-wallet';
import { GARAGE_SEED_LEDGER } from './garage-seed';

export const STORE_SEED_ACCOUNT: BrigadeAccount = {
  version: ACCOUNT_VERSION,
  balance: 800,
  earned_total: 0,
  paid: {},
  campaign_paid: {},
  unlocks: ['spg_long_range'],
  upgrades: {},
  grants: [{ source: 'granted', amount: 800, at: 1 }],
  coupons: [],
};

export const STORE_SEED_WALLET: RoarWallet = {
  version: ROAR_VERSION,
  coins: { free: 600, paid: 0 },
  entitlements: { units: {}, upgrades: { spg_long_range: { armour: { tier: 2, paidTiers: 0 } } } },
  earn: { welcomed: true, campaignDone: false, backfilled: true, missions: {} },
  receipts: [],
};

/** An init-script string writing the ledger, the account and the wallet (same shape as `garageSeedScript`). */
export function storeSeedScript(): string {
  const set = (key: string, value: unknown): string =>
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))}); `;
  return (
    'try { ' +
    set(LEDGER_KEY, GARAGE_SEED_LEDGER) +
    set(ACCOUNT_KEY, STORE_SEED_ACCOUNT) +
    set(ROAR_KEY, STORE_SEED_WALLET) +
    '} catch (e) {}'
  );
}
