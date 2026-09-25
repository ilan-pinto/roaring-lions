// The garage's audit state (WP-S3g plan §1, "Audit conditions"): one fixed
// `localStorage` seed the look tasks and the purchase leg both start from,
// instead of the fresh, kit-less account a real player's first visit gets.
//
// `GARAGE_SEED_ACCOUNT` opens the bay on `mbt_lavi` -- fully upgraded (armour
// 3, sensors 3, firepower 3, kit level L3, `upgrades.test.ts`'s own fixture
// numbers) -- with `inf_squad` at L1 (armour 2, sensors 1) and `at_team` at L1
// (firepower 1) also owned, and `2400` credits on hand: enough to buy
// `at_team`'s next firepower tier (175) with plenty left over, not enough to
// look flush. `GARAGE_SEED_LEDGER` gives the campaign three 3-star missions
// and one 2-star mission (11 stars total) all rated Conduct 83, so the
// header's stars/Conduct/roster line reads real numbers rather than "fresh
// start". Every literal here is read back verbatim by
// `garage-seed.test.ts` -- change a number here and that spec is the one that
// notices.
//
// `garageSeedScript` turns the two objects into a `<script>`-safe STRING, not
// a function: `routes-check.ts`'s own `frameCadence` comment already found
// that tsx/esbuild's `keepNames` transform rewrites a named const's inner
// arrow with a `__name` helper the browser page does not have, so a function
// value serialised through `Function.prototype.toString()` throws the moment
// it runs there. A plain string, built with `JSON.stringify` for every
// literal -- the two keys AND the two payloads -- never needs an escaped quote
// written by hand.
import type { BrigadeAccount } from '../../../packages/app/src/brigade-account';
import { ACCOUNT_KEY, ACCOUNT_VERSION } from '../../../packages/app/src/brigade-account';
import type { CampaignLedger } from '../../../packages/app/src/ledger-store';
import { LEDGER_KEY } from '../../../packages/app/src/main-keys';

/** `mbt_lavi` fully kitted (L3), `inf_squad` and `at_team` each part-kitted
 *  (L1) -- the same three fixtures `packages/data/src/upgrades.test.ts` pins
 *  `kitLevel` against, so this seed and that spec cannot silently drift apart.
 *  The `granted` entry is what makes `balance`/`earned_total` a fixed point of
 *  `migrateAccount` (R6, `brigade-account.ts`'s own header): a save with a
 *  `grants` field bounds both to what the log can account for, and this one
 *  covers 2400 with margin to spare. */
export const GARAGE_SEED_ACCOUNT: BrigadeAccount = {
  version: ACCOUNT_VERSION,
  balance: 2400,
  earned_total: 0,
  paid: {},
  unlocks: ['mbt_lavi'],
  upgrades: {
    inf_squad: { armour: 2, sensors: 1 },
    at_team: { firepower: 1 },
    mbt_lavi: { armour: 3, sensors: 3, firepower: 3 },
  },
  grants: [{ source: 'granted', amount: 5000, at: 1 }],
};

/** Three Beit Sahwan missions logged at 3 stars, the breach at 2 (11 total --
 *  `starsEarned`), every one of the four rated Conduct 83 in
 *  `roe.mission_ratings` so `campaignRoe`'s mean reads 83 rather than falling
 *  through to "no rating yet". `ticks`/`lost` are never read by anything this
 *  seed exists for; 0 says nothing about how the mission was played. */
export const GARAGE_SEED_LEDGER: CampaignLedger = {
  'campaign.mission_results': {
    beit_sahwan_1_recon: { stars: 3, roe: 83, ticks: 0, lost: 0 },
    beit_sahwan_2_foothold: { stars: 3, roe: 83, ticks: 0, lost: 0 },
    beit_sahwan_3_clearance: { stars: 3, roe: 83, ticks: 0, lost: 0 },
    beit_sahwan_breach: { stars: 2, roe: 83, ticks: 0, lost: 0 },
  },
  'roe.mission_ratings': {
    beit_sahwan_1_recon: 83,
    beit_sahwan_2_foothold: 83,
    beit_sahwan_3_clearance: 83,
    beit_sahwan_breach: 83,
  },
};

/**
 * An init-script string that writes both keys, JSON-stringified twice over --
 * once for the payload, once so the payload sits inside the script text as a
 * quoted string literal no embedded quote can break out of. `try`/`catch`
 * matches `ledger-store.ts`'s own tolerance of a blocked store: a page run
 * under `--private`/site-data-blocked should still boot, just off the empty
 * account and ledger, rather than throwing before `main()` ever runs.
 */
export function garageSeedScript(
  ledger: CampaignLedger = GARAGE_SEED_LEDGER,
  account: BrigadeAccount = GARAGE_SEED_ACCOUNT
): string {
  return (
    'try { ' +
    `localStorage.setItem(${JSON.stringify(LEDGER_KEY)}, ${JSON.stringify(JSON.stringify(ledger))}); ` +
    `localStorage.setItem(${JSON.stringify(ACCOUNT_KEY)}, ${JSON.stringify(JSON.stringify(account))}); ` +
    '} catch (e) {}'
  );
}
