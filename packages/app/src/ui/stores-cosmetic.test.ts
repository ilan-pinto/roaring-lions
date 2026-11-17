// @vitest-environment jsdom
// E13 (GH-1415): the Stores under "coins buy cosmetics only". The switch is injected (`StoresOptions.cosmeticOnly`), so
// both arms draw here: off is today's screen, on shows a unit's and a tier's coin price as not for coins with no coin
// Buy, keeps every credit Buy, and still reads a coin-bought item as owned.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import type { UnlockGate } from '@lions/sim';
import en from '../i18n/en.json';
import { showStores, type StoresOptions } from './stores';
import type { BrigadeUnit } from './brigade';

function roster(bought: ReadonlySet<string> = new Set()): BrigadeUnit[] {
  return Object.values(units)
    .filter((u) => u.faction === 'kdf')
    .map((u) => {
      const raw = 'unlock' in u ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number }) : undefined;
      const unlock: UnlockGate | undefined = raw && { roeMin: raw.roe_rating_min, starsMin: raw.stars_min, afterMission: raw.after_mission, price: raw.price, bought: bought.has(u.id) };
      return { id: u.id, name: u.name, role: u.role, unlock, isKamikaze: false, transportSlots: 0, isSoft: false, canCarry: null, canEmbark: false, upgrades: 'upgrades' in u ? u.upgrades : undefined };
    });
}

function mount(over: Partial<StoresOptions> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = showStores(host, {
    units: roster(),
    // recon_drone opens at Conduct 60 and costs 220 credits (25 coins); 500 credits cover it.
    ledger: { 'roe.mission_ratings': { a: 60 } },
    credits: 500,
    owned: {},
    coinSrc: (n) => `/c${n}.png`,
    missionName: () => undefined,
    wallet: { coins: 100_000, receipts: [] },
    onBuy: () => undefined,
    onBuyCredits: () => undefined,
    onBuyTierCredits: () => undefined,
    ...over,
  });
  return { host, dispose };
}
const btn = (host: HTMLElement, key: string) => host.querySelector<HTMLButtonElement>(`button[data-buy="${key}"]`);
const coinBuys = (host: HTMLElement) => [...host.querySelectorAll('button[data-buy^="unit:"], button[data-buy^="tier:"]')];

describe('switch OFF: today\'s Stores', () => {
  it('offers coin Buys for units and tiers, unmarked, with the old lede', () => {
    for (const cosmeticOnly of [false, undefined]) {
      const { host, dispose } = mount(cosmeticOnly === undefined ? {} : { cosmeticOnly });
      expect(btn(host, 'unit:recon_drone')?.disabled).toBe(false);
      expect(btn(host, 'tier:inf_squad.armour.1')?.disabled).toBe(false);
      expect(host.querySelectorAll('[data-closed="1"]')).toHaveLength(0);
      expect(host.querySelector('.rl-stores__lede')?.textContent).toBe(en['stores.lede']);
      expect(host.querySelector('.rl-stores')?.hasAttribute('data-cosmetic-only')).toBe(false);
      dispose();
    }
  });
});

describe('switch ON: coins buy cosmetics only', () => {
  it('draws no coin Buy for any unit or tier, whatever the wallet holds', () => {
    const { host, dispose } = mount({ cosmeticOnly: true });
    expect(coinBuys(host)).toEqual([]);
    dispose();
  });

  it('shows the coin price, marked "Not for coins", on a unit card and a tier row for sale', () => {
    const { host, dispose } = mount({ cosmeticOnly: true });
    const card = host.querySelector('[data-item="recon_drone"]');
    expect(card?.querySelector('[data-closed="1"] .rl-stores__coin-n')?.textContent).toBe('25');
    expect(card?.querySelector('.rl-stores__coin-closed')?.textContent).toBe(en['stores.coins.closed']);
    const row = host.querySelector('[data-item="tiers:inf_squad"] [data-track="armour"]');
    expect(row?.querySelector('[data-closed="1"] .rl-stores__coin-n')?.textContent).toBe('15');
    dispose();
  });

  it('keeps every credit Buy: a unit and a tier still buy with credits', () => {
    const asked: unknown[] = [];
    const { host, dispose } = mount({
      cosmeticOnly: true,
      onBuyCredits: (id, n) => asked.push(['unit', id, n]),
      onBuyTierCredits: (u, tr, to, p) => asked.push(['tier', u, tr, to, p]),
    });
    const unit = btn(host, 'credits:recon_drone');
    const tier = btn(host, 'credits:inf_squad.armour');
    expect(unit?.disabled).toBe(false);
    expect(tier?.disabled).toBe(false);
    unit?.click();
    tier?.click();
    expect(asked).toEqual([['unit', 'recon_drone', 220], ['tier', 'inf_squad', 'armour', 1, 115]]);
    dispose();
  });

  it('a coin-bought unit still reads "Bought with coins", unmarked, and its tracks still draw', () => {
    const { host, dispose } = mount({
      cosmeticOnly: true,
      showOwned: true,
      units: roster(new Set(['apc_kipod'])),
      coin: { earnedUnits: new Set(), coinUnits: new Set(['apc_kipod']), earnedTiers: {}, coinTiers: {} },
    });
    const card = host.querySelector('[data-item="apc_kipod"]');
    expect(card?.getAttribute('data-state')).toBe('coins');
    expect(card?.querySelector('[data-closed]')).toBeNull();
    expect(card?.textContent).toContain(en['stores.state.coins']);
    // The unit is open, so its tracks are on the shelf (for credits), with no coin Buy.
    expect(host.querySelector('[data-item="tiers:apc_kipod"]')).not.toBeNull();
    expect(btn(host, 'tier:apc_kipod.armour.1')).toBeNull();
    dispose();
  });

  it('says so: the lede and the coin note carry the cosmetic-only copy', () => {
    const { host, dispose } = mount({ cosmeticOnly: true });
    expect(host.querySelector('.rl-stores__lede')?.textContent).toBe(en['stores.lede.cosmeticOnly']);
    expect(host.querySelector('.rl-stores__about')?.textContent).toMatch(/They buy cosmetics, which never change a fight\./);
    expect(host.querySelector('.rl-stores')?.getAttribute('data-cosmetic-only')).toBe('1');
    dispose();
  });
});
