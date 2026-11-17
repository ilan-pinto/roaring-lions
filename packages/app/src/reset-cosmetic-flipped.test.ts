// @vitest-environment jsdom
// E13 F5: the client's brigade reset under the REAL constant flipped. The economy's `wallet` module is mocked with
// `COINS_COSMETIC_ONLY: true` and the rest real, so every module that imports the constant sees flip day (a mock of
// `@lions/economy` alone would leave `stores.ts`'s defaults bound to the real `false`; see the Worker's
// `claim-cosmetic-flipped.test.ts`). `wallet.ts`'s OWN reads are not mocked, which is why the guest store takes its
// switch from `ledger-store.ts`'s default (read through `@lions/economy`) and passes it to `resetFree`. The store's
// reset must keep the coin-bought unit and tier, and the garage's confirm line must say so, with no switch passed by
// the test.
import { describe, expect, it, vi } from 'vitest';
import { COINS_COSMETIC_ONLY } from '@lions/economy';
import en from './i18n/en.json';
import { setCatalogue } from './i18n/t';
import { ACCOUNT_KEY } from './brigade-account';
import { memoryLedgerStore } from './ledger-store';
import { buyTierWithCoins, buyUnitWithCoins, emptyRoar, grantCouponCoins, type RoarWallet } from './roar-wallet';
import { showBrigade, type BrigadeOptions } from './ui/brigade';

vi.mock('../../economy/src/wallet', async (importOriginal) => ({ ...(await importOriginal<object>()), COINS_COSMETIC_ONLY: true }));

// dozer_d9: 560 credits = 60 coins. inf_squad armour tier 1: 115 credits = 15 coins.
function boughtWallet(): RoarWallet {
  let w = grantCouponCoins(emptyRoar(), 1000, ['lead_roar_coins_100k'], 1);
  w = buyUnitWithCoins(w, 'dozer_d9', 60, 560, 2).account;
  return buyTierWithCoins(w, 'inf_squad', 'armour', 1, 0, 15, 115, 3).account;
}

describe('the client reset with COINS_COSMETIC_ONLY true', () => {
  it('the mock reaches the constant', () => {
    expect(COINS_COSMETIC_ONLY).toBe(true);
  });

  it('the guest store removes the brigade account and keeps the coin-bought unit, tier and balance', () => {
    const store = memoryLedgerStore();
    store.writeAccount({ ...store.readAccount(), balance: 450 });
    store.writeRoar(boughtWallet());
    expect(store.resetAccount().balance).toBe(0);
    expect(store.raw(ACCOUNT_KEY)).toBe(null);
    expect(store.readRoar().entitlements).toEqual({ units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } });
    expect(store.readRoar().coins.free).toBe(1000 - 60 - 15);
  });

  it('the garage, given no switch, arms the reset with the cosmetic-only line', () => {
    setCatalogue('en', en);
    const host = document.createElement('div');
    showBrigade(host, { missionName: () => undefined, baseOf: (id: string) => ({ id }), units: [], ledger: {}, possibleStars: 3, credits: 10, onReset: () => undefined } as BrigadeOptions);
    const btn = host.querySelector<HTMLButtonElement>('.rl-garage__reset');
    btn?.click();
    expect(btn?.textContent).toBe(en['garage.reset.confirm.cosmeticOnly']);
  });
});
