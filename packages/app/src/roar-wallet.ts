/**
 * The Roar coin wallet (GH-317). Every player has one, free: coins are earned in
 * the campaign (`roar-earn.ts`) and a coupon can add some; the Stores spend them
 * on what play and credits already open, in single player. No money moves here.
 * Design: `docs/superpowers/specs/2026-11-04-roar-coin-wallet-design.md`.
 *
 * (The pure rules moved to `@lions/economy`, GH-1075 A0; this module re-exports them so no
 * caller changes.)
 *
 * THE ONE READER AND WRITER of `lions.roar`. Nothing else in the app spells that
 * key (`roar-wallet.test.ts` scans for it), and it is the only place that names
 * the retired `lions.roar.test` key, which `migrateTestWallet` reads once.
 *
 * The balance is split `{ free, paid }` from v1 so real money, when Steam opens
 * it (ST7), needs no migration:
 *
 *  - `free` is earned or granted in play. `paid` is bought with money.
 *  - `PURCHASES_OPEN` is false, and while it is, `migrateRoar` clamps `paid` to 0
 *    and no code in this repository raises it (G-M1). The paid side is display-only.
 *  - A purchase spends free first, then paid, and its receipt records both halves
 *    (G-M2), so a later chargeback can take back only what was paid for.
 *  - An entitlement records which kind bought it, so a later narrowing of what a
 *    paid coin may open (decision D4) needs no migration either.
 *
 * It never touches `lions.brigade.account`'s money fields (`balance`,
 * `earned_total`, `grants`): a coin purchase debits `coins` here and nothing else
 * (spec guard G3, "coins never become credits"). The brigade account keeps meaning
 * "earned credits". Its `unlocks` and `upgrades` are the EARNED half of spec §1.5's
 * split, and this key holds the COIN half. `singlePlayerView` reads `earned OR
 * coins` (a tier is `max(earned, coins)`); `networkView` reads `earned` only, and
 * nothing in a versus room calls the first (`roar-fences.test.ts`).
 *
 * Survives `?fresh` and "New campaign", like the brigade account: the coins are a
 * lifetime record. The brigade screen's reset clears the FREE half (`resetFree`)
 * and never the paid.
 */
import type { StorageLike } from './brigade-account';
import { emptyRoar, migrateRoar, migrateTestWallet } from '@lions/economy';
import type { RoarWallet } from '@lions/economy';

export {
  ROAR_VERSION,
  MAX_COINS,
  RECEIPT_CAP,
  PURCHASES_OPEN,
  emptyRoar,
  migrateRoar,
  migrateTestWallet,
  spendable,
  grantFree,
  grantCouponCoins,
  buyUnitWithCoins,
  buyTierWithCoins,
  resetFree,
  coinTiers,
  entitlementsOf,
  singlePlayerView,
  networkView,
} from '@lions/economy';
export type { CoinSplit, EarnRecord, EarnSource, RoarReceipt, RoarWallet, TrackEntitlement, UnitEntitlement } from '@lions/economy';

export const ROAR_KEY = 'lions.roar';
/** The retired TEST wallet's key (`?testcoins`, removed with this module). Read
 *  once by `migrateTestWallet` and then deleted. */
export const LEGACY_TEST_KEY = 'lions.roar.test';

/**
 * Runs once per wallet, until it sets `earn.backfilled` (a new wallet, a migrated
 * test wallet, or one made before the back-payment). It must set the marker: the caller reads the campaign ledger and returns the
 * wallet with the back-payment in it (`roarBackfill`, roar-earn.ts). The result
 * is written at once, so the key then exists and this cannot run again; a slot
 * load or import finds the key and earns nothing (G-E3).
 */
export type RoarSeed = (w: RoarWallet) => RoarWallet;

export function loadRoar(store: StorageLike, seed?: RoarSeed): RoarWallet {
  try {
    const text = store.getItem(ROAR_KEY);
    if (text !== null) {
      const existing = migrateRoar(JSON.parse(text));
      if (existing.earn.backfilled || seed === undefined) return existing;
      // A wallet made before the back-payment existed: settle it once, same write.
      const settled = seed(existing);
      try {
        store.setItem(ROAR_KEY, JSON.stringify(settled));
      } catch {
        /* the wallet still reads correctly from memory; the next read settles again, to the same result */
      }
      return settled;
    }
    const legacy = store.getItem(LEGACY_TEST_KEY);
    const base = legacy === null ? emptyRoar() : migrateTestWallet(JSON.parse(legacy));
    if (legacy === null && seed === undefined) return base;
    const made = seed !== undefined ? seed(base) : base;
    // Once: write the new key, then delete the old. A refusal leaves the old key
    // in place and the next read migrates again, to the same result.
    try {
      store.setItem(ROAR_KEY, JSON.stringify(made));
      if (legacy !== null) store.removeItem(LEGACY_TEST_KEY);
    } catch {
      /* the wallet still reads correctly from memory */
    }
    return made;
  } catch {
    return emptyRoar();
  }
}

export function saveRoar(store: StorageLike, w: RoarWallet): void {
  store.setItem(ROAR_KEY, JSON.stringify(w));
}

/** The raw text under the key, for a both-or-neither write to put back. */
export function snapshotRoarText(store: StorageLike): string | null {
  return store.getItem(ROAR_KEY);
}
export function restoreRoarText(store: StorageLike, text: string | null): void {
  if (text === null) store.removeItem(ROAR_KEY);
  else store.setItem(ROAR_KEY, text);
}

