// @vitest-environment jsdom
// E13 F5 (the lead's ruling on PR 1565): the brigade reset with "coins buy cosmetics only" on KEEPS what coins bought.
// The client half: the garage's confirm line says so (`garage.reset.confirm.cosmeticOnly`, HOLD FOR LEAD copy), and the
// guest store's `resetAccount` keeps the wallet whole. Both arms are injected here (`BrigadeOptions.cosmeticOnly`, the
// test double's `cosmeticOnly`), and the default is checked against the constant's arm; the ON arm through the real
// constant is `reset-cosmetic-flipped.test.ts`.
import { describe, expect, it } from 'vitest';
import { COINS_COSMETIC_ONLY } from '@lions/economy';
import en from './i18n/en.json';
import { setCatalogue } from './i18n/t';
import { memoryLedgerStore } from './ledger-store';
import { buyTierWithCoins, buyUnitWithCoins, emptyRoar, grantCouponCoins, type RoarWallet } from './roar-wallet';
import { showBrigade, type BrigadeOptions } from './ui/brigade';

function armedConfirm(over: Partial<BrigadeOptions> = {}): string | null | undefined {
  setCatalogue('en', en);
  const host = document.createElement('div');
  showBrigade(host, { missionName: () => undefined, baseOf: (id: string) => ({ id }), units: [], ledger: {}, possibleStars: 3, credits: 10, onReset: () => undefined, ...over } as BrigadeOptions);
  const btn = host.querySelector<HTMLButtonElement>('.rl-garage__reset');
  btn?.click();
  return btn?.textContent;
}

// dozer_d9: 560 credits = 60 coins. inf_squad armour tier 1: 115 credits = 15 coins.
function boughtWallet(): RoarWallet {
  let w = grantCouponCoins(emptyRoar(), 1000, ['lead_roar_coins_100k'], 1);
  w = buyUnitWithCoins(w, 'dozer_d9', 60, 560, 2).account;
  return buyTierWithCoins(w, 'inf_squad', 'armour', 1, 0, 15, 115, 3).account;
}
const BOUGHT = { units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } };

describe('the garage reset\'s confirm line and the switch', () => {
  it('OFF says the free coins and purchases are cleared, as today', () => {
    expect(armedConfirm({ cosmeticOnly: false })).toBe(en['garage.reset.confirm']);
  });
  it('ON says the coins and what they bought stay', () => {
    expect(armedConfirm({ cosmeticOnly: true })).toBe(en['garage.reset.confirm.cosmeticOnly']);
    expect(en['garage.reset.confirm.cosmeticOnly']).not.toBe(en['garage.reset.confirm']);
  });
  it('with no option it reads COINS_COSMETIC_ONLY', () => {
    expect(armedConfirm()).toBe(en[COINS_COSMETIC_ONLY ? 'garage.reset.confirm.cosmeticOnly' : 'garage.reset.confirm']);
  });
});

describe('the guest store\'s resetAccount and the switch', () => {
  const reset = (cosmeticOnly: boolean) => {
    const store = memoryLedgerStore({}, undefined, { cosmeticOnly });
    store.writeAccount({ ...store.readAccount(), balance: 450 });
    store.writeRoar(boughtWallet());
    expect(store.resetAccount().balance).toBe(0);
    return store.readRoar();
  };

  it('OFF: the free coins and the coin-bought unit and tier go, as today', () => {
    const w = reset(false);
    expect(w.entitlements).toEqual({ units: {}, upgrades: {} });
    expect(w.coins.free).toBe(0);
  });

  it('ON: the brigade account goes; the coin-bought unit and tier and the balance stay', () => {
    const w = reset(true);
    expect(w.entitlements).toEqual(BOUGHT);
    expect(w.coins.free).toBe(1000 - 60 - 15);
  });

  it('with no option it reads COINS_COSMETIC_ONLY', () => {
    const store = memoryLedgerStore();
    store.writeAccount({ ...store.readAccount(), balance: 450 });
    store.writeRoar(boughtWallet());
    expect(store.resetAccount().balance).toBe(0);
    expect(store.readRoar().entitlements).toEqual(COINS_COSMETIC_ONLY ? BOUGHT : { units: {}, upgrades: {} });
    expect(store.readRoar().coins.free).toBe(COINS_COSMETIC_ONLY ? 1000 - 60 - 15 : 0);
  });
});
