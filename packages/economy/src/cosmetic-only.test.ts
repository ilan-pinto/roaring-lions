// E13 (GH-1415): "coins buy cosmetics only", behind ONE switch that stays off. Both arms run here: every reader takes the
// switch as a defaulted parameter, so `false` is today and `true` is flip day. Oracles take literals (CLAUDE.md): the
// prices below are read off the unit JSON by hand, never from `coinPrice`.
import { describe, expect, it } from 'vitest';
import { emptyAccount, buyUnlock, buyUpgradeRun } from './brigade';
import { storeInputFor } from './store-input';
import {
  COINS_COSMETIC_ONLY,
  COIN_PACKS,
  buyEnabled,
  buyWithCoins,
  coinsMayBuy,
  storeItems,
  type CoinAsk,
} from './stores';
import { buyTierWithCoins, buyUnitWithCoins, emptyRoar, grantCouponCoins, networkView, resetFree, singlePlayerView, type RoarWallet } from './wallet';

const funded = (n = 100_000): RoarWallet => grantCouponCoins(emptyRoar(), n, ['lead_roar_coins_100k'], 1);
const fresh = () => storeInputFor({ ledger: {}, brigade: emptyAccount(), roar: funded() });
// spg_long_range: unlock.price 6500 credits = 650 coins. inf_squad (starting roster) armour tier 1: 115 credits = 15 coins.
const UNIT: CoinAsk = { kind: 'unit', unitId: 'spg_long_range' };
const TIER: CoinAsk = { kind: 'tier', unitId: 'inf_squad', track: 'armour', tier: 1 };

describe('the switch', () => {
  it('ships OFF', () => {
    expect(COINS_COSMETIC_ONLY).toBe(false);
  });

  it('coinsMayBuy: everything while off; a cosmetic and nothing else while on', () => {
    expect([coinsMayBuy('unit', false), coinsMayBuy('tier', false), coinsMayBuy('cosmetic', false)]).toEqual([true, true, true]);
    expect([coinsMayBuy('unit', true), coinsMayBuy('tier', true), coinsMayBuy('cosmetic', true)]).toEqual([false, false, true]);
    // The default is the constant, whichever way it is set (so flip day turns only the pin above red).
    expect([coinsMayBuy('unit'), coinsMayBuy('tier'), coinsMayBuy('cosmetic')]).toEqual([!COINS_COSMETIC_ONLY, !COINS_COSMETIC_ONLY, true]);
  });
});

describe('switch OFF: today, pinned', () => {
  it('buyEnabled enables real items, and with no switch argument answers as the constant\'s arm', () => {
    const items = storeItems(fresh());
    const all = [...items.units, ...items.tiers];
    const wallet = { live: true, coins: 100_000 };
    for (const i of all) expect(buyEnabled(i, wallet)).toBe(buyEnabled(i, wallet, COINS_COSMETIC_ONLY));
    expect(all.filter((i) => buyEnabled(i, wallet, false)).length).toBeGreaterThan(10);
  });

  it('buyWithCoins buys a unit and a tier for coins, as before', () => {
    const u = buyWithCoins(fresh(), funded(), UNIT, 9, false);
    expect(u.ok).toBe(true);
    expect(u.account.coins.free).toBe(100_000 - 650);
    expect(u.account.entitlements.units.spg_long_range).toEqual({ free: true });
    const t = buyWithCoins(fresh(), funded(), TIER, 9, false);
    expect(t.ok).toBe(true);
    expect(t.account.coins.free).toBe(100_000 - 15);
    expect(t.account.entitlements.upgrades.inf_squad?.armour).toEqual({ tier: 1, paidTiers: 0 });
    // The default arm is the constant's arm, byte for byte (today, the purchase above).
    expect(buyWithCoins(fresh(), funded(), UNIT, 9)).toEqual(buyWithCoins(fresh(), funded(), UNIT, 9, COINS_COSMETIC_ONLY));
    expect(buyWithCoins(fresh(), funded(), TIER, 9)).toEqual(buyWithCoins(fresh(), funded(), TIER, 9, COINS_COSMETIC_ONLY));
  });
});

describe('switch ON: coins buy cosmetics only', () => {
  it('buyEnabled refuses every unit and tier, whatever the wallet holds; the packs answer as before', () => {
    const items = storeItems(fresh());
    const wallet = { live: true, coins: 1_000_000 };
    expect([...items.units, ...items.tiers].filter((i) => buyEnabled(i, wallet, true))).toEqual([]);
    for (const p of COIN_PACKS) expect(buyEnabled(p, wallet, true)).toBe(buyEnabled(p, wallet, false));
  });

  it('buyWithCoins refuses a unit ask and a tier ask, handing back the same wallet', () => {
    const w = funded();
    for (const ask of [UNIT, TIER]) {
      const r = buyWithCoins(fresh(), w, ask, 9, true);
      expect(r.ok).toBe(false);
      expect(r.account).toBe(w);
    }
    expect(w.coins.free).toBe(100_000);
    expect(w.entitlements).toEqual({ units: {}, upgrades: {} });
  });

  it('KEEPS what coins already bought: the store reads it as owned, and the single-player view still counts it', () => {
    // Bought before the flip.
    let w = funded();
    w = buyUnitWithCoins(w, 'spg_long_range', 650, 6500, 2).account;
    w = buyTierWithCoins(w, 'inf_squad', 'armour', 1, 0, 15, 115, 3).account;
    const input = storeInputFor({ ledger: {}, brigade: emptyAccount(), roar: w });
    const items = storeItems(input);
    expect(items.units.find((u) => u.id === 'spg_long_range')?.state).toBe('coins');
    expect(items.tiers.find((x) => x.unitId === 'inf_squad' && x.track === 'armour')?.owned).toBe(1);
    const sp = singlePlayerView(emptyAccount(), w);
    expect(sp.boughtUnits.has('spg_long_range')).toBe(true);
    expect(sp.ownedTiers.inf_squad?.armour).toBe(1);
    // A refused ask after the flip moves nothing that was owned.
    const r = buyWithCoins(input, w, { kind: 'tier', unitId: 'inf_squad', track: 'armour', tier: 2 }, 4, true);
    expect(r.ok).toBe(false);
    expect(r.account.entitlements).toEqual(w.entitlements);
    // Network play reads earned only, as before (the switch changes neither view).
    expect(networkView(emptyAccount(), w).boughtUnits.has('spg_long_range')).toBe(false);
  });

  it('credits are unchanged: the credit purchases read no switch, and the unit stays for sale by credits', () => {
    const rich = { ...emptyAccount(), balance: 10_000 };
    const input = storeInputFor({ ledger: {}, brigade: rich, roar: funded() });
    const card = storeItems(input).units.find((u) => u.id === 'spg_long_range');
    // The derivation does not read the switch: the card is `affordable` by credits in both arms.
    expect(card?.state).toBe('affordable');
    const bought = buyUnlock(rich, 'spg_long_range', 6500);
    expect(bought.ok).toBe(true);
    expect(bought.account.balance).toBe(3500);
    const run = buyUpgradeRun(rich, 'inf_squad', 'armour', 1, 1, [115, 175, 250]);
    expect(run.ok).toBe(true);
    expect(run.account.balance).toBe(10_000 - 115);
  });
});

// F5 (the lead's ruling on PR 1565): with the switch on, the brigade reset never revokes what coins bought.
describe('resetFree and the switch', () => {
  /** A wallet that bought a unit and a tier with free coins, with an earn record to clear. */
  const bought = (): RoarWallet => {
    let w = funded();
    w = buyUnitWithCoins(w, 'spg_long_range', 650, 6500, 2).account;
    w = buyTierWithCoins(w, 'inf_squad', 'armour', 1, 0, 15, 115, 3).account;
    return { ...w, earn: { welcomed: true, campaignDone: false, backfilled: true, missions: { m1: { won: true, stars: 2 } } } };
  };

  it('OFF: as today, the free half goes: balance, free unit and tier, earn record and free receipts', () => {
    const r = resetFree(bought(), false);
    expect(r.coins).toEqual({ free: 0, paid: 0 });
    expect(r.entitlements).toEqual({ units: {}, upgrades: {} });
    expect(r.earn).toEqual({ welcomed: false, campaignDone: false, backfilled: true, missions: {} });
    expect(r.receipts).toEqual([]);
  });

  it('ON: KEEPS every coin-bought unit and tier, and the balance, earn record and receipts with them', () => {
    const w = bought();
    const copy = structuredClone(w);
    const r = resetFree(w, true);
    // Nothing in the wallet moved (no cosmetic entitlement exists to refund), so it is the wallet itself, untouched.
    expect(r).toBe(w);
    expect(w).toEqual(copy);
    expect(r.entitlements).toEqual({ units: { spg_long_range: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } });
    expect(r.coins.free).toBe(100_000 - 650 - 15);
    expect(singlePlayerView(emptyAccount(), r).boughtUnits.has('spg_long_range')).toBe(true);
  });

  it('with no switch argument it answers as the constant\'s arm', () => {
    expect(resetFree(bought())).toEqual(resetFree(bought(), COINS_COSMETIC_ONLY));
    expect(resetFree(bought()).entitlements.units.spg_long_range !== undefined).toBe(COINS_COSMETIC_ONLY);
  });
});
