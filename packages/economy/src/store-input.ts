/**
 * The Stores' input, built in one place (GH-1075 A2). The app's Stores and the Garage read it
 * through `storeInputFor`, and the Worker's `spend` decides a purchase over the same input, so a
 * coin ask the screen allows is a coin ask the server allows.
 */
import { units } from '@lions/data';
import type { UnlockGate } from '@lions/sim';
import type { LedgerData } from '@lions/sim';
import type { BrigadeAccount } from './brigade';
import type { CoinHalf, StoreInput, StoreUnit } from './stores';
import { coinTiers, singlePlayerView, type RoarWallet } from './wallet';

/** A KDF unit JSON entry's `unlock` gate, mapped from the authored
 *  `roe_rating_min`/`stars_min`/`after_mission`/`price` field names to `UnlockGate` --
 *  the one mapping `unitInfo`, `kdfUnits` and `resolveUpgrades`'s lookup all share.
 *  `bought` is resolved here and nowhere else (spec §4.4) -- a purchase opens the
 *  unit on every surface that reads this gate by construction. */
export function kdfUnlockGate(u: (typeof units)[keyof typeof units], bought: ReadonlySet<string>): UnlockGate | undefined {
  const unlock = 'unlock' in u
    ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number })
    : undefined;
  if (!unlock) return undefined;
  return {
    roeMin: unlock.roe_rating_min,
    starsMin: unlock.stars_min,
    afterMission: unlock.after_mission,
    price: unlock.price,
    bought: bought.has(u.id),
  };
}

/**
 * The coin half the Stores and the Garage read, as `main.ts` builds it (the one construction path).
 * `earnedTiers` carries an EXPLICIT 0 for every track of every unit the account has not bought:
 * `tierItem` reads `earnedTiers[u][track] ?? owned`, so an absent entry would fall back to `owned`
 * and a coin-held tier would read as earned, pricing a single tier where the run is several.
 */
export function buildCoinHalf(
  units: readonly { readonly id: string; readonly upgrades?: Readonly<Record<string, unknown>> }[],
  account: Pick<BrigadeAccount, 'unlocks' | 'upgrades'>,
  roar: RoarWallet
): CoinHalf {
  const earnedTiers: Record<string, Record<string, number>> = {};
  for (const u of units) {
    const row: Record<string, number> = {};
    for (const track of Object.keys(u.upgrades ?? {})) row[track] = account.upgrades[u.id]?.[track] ?? 0;
    earnedTiers[u.id] = row;
  }
  // A unit or track the account holds that `units` does not list keeps its stored value.
  for (const [id, tracks] of Object.entries(account.upgrades)) {
    earnedTiers[id] = { ...earnedTiers[id], ...tracks };
  }
  return {
    earnedUnits: new Set(account.unlocks),
    coinUnits: new Set(Object.keys(roar.entitlements.units)),
    earnedTiers,
    coinTiers: coinTiers(roar),
  };
}

/** The KDF units the Stores sells, off one account's bought set: a casualty the sim makes
 *  (`wounded`) is not a unit anyone buys, fields or upgrades (GH-707 P2). */
export function storeUnits(bought: ReadonlySet<string>): StoreUnit[] {
  return Object.values(units)
    .filter((u) => u.faction === 'kdf' && u.role !== 'wounded')
    .map((u) => ({ id: u.id, name: u.name, unlock: kdfUnlockGate(u, bought), upgrades: 'upgrades' in u ? u.upgrades : undefined }));
}

/**
 * The Stores' `StoreInput` for one campaign: `owned` and every `unlock.bought` are the
 * single-player view (earned OR coins), `coin` says which part came from coins. The one
 * construction path the app's Buy and the Worker's `spend` both use.
 */
export function storeInputFor(c: { ledger: LedgerData; brigade: BrigadeAccount; roar: RoarWallet }): StoreInput & { readonly coin: CoinHalf } {
  const view = singlePlayerView(c.brigade, c.roar);
  const unitsList = storeUnits(view.boughtUnits);
  return {
    units: unitsList,
    ledger: c.ledger,
    credits: c.brigade.balance,
    owned: view.ownedTiers,
    coin: buildCoinHalf(unitsList, c.brigade, c.roar),
  };
}

/** The coin half alone, over the same construction `storeInputFor` uses. */
export function coinHalfFor(c: { brigade: BrigadeAccount; roar: RoarWallet }): CoinHalf {
  return storeInputFor({ ledger: {}, brigade: c.brigade, roar: c.roar }).coin;
}
