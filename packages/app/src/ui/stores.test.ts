// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import type { LedgerData, UnlockGate } from '@lions/sim';
import { showBrigade, type BrigadeUnit } from './brigade';
import { showStores, type StoresOptions } from './stores';
import { COIN_PACKS } from './stores-model';

/** The real KDF roster, as `main.ts` builds it for the garage. */
function roster(bought: ReadonlySet<string> = new Set()): BrigadeUnit[] {
  return Object.values(units)
    .filter((u) => u.faction === 'kdf')
    .map((u) => {
      const raw = 'unlock' in u ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number }) : undefined;
      const unlock: UnlockGate | undefined = raw && {
        roeMin: raw.roe_rating_min,
        starsMin: raw.stars_min,
        afterMission: raw.after_mission,
        price: raw.price,
        bought: bought.has(u.id),
      };
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        unlock,
        isKamikaze: false,
        transportSlots: 0,
        isSoft: false,
        upgrades: 'upgrades' in u ? u.upgrades : undefined,
      };
    });
}

const coinSrc = (size: number): string => `/ui/roar_coin/roar_coin_${size}.png`;

function mountStores(over: Partial<StoresOptions> = {}): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = showStores(host, {
    units: roster(),
    ledger: {},
    credits: 0,
    owned: {},
    coinSrc,
    missionName: () => undefined,
    ...over,
  });
  return { host, dispose };
}

/** Accounts across the range a player meets: fresh, mid-campaign, rich, and
 *  one that owns things -- so "no Buy is enabled" is asked of every state. */
const ACCOUNTS: { name: string; ledger: LedgerData; credits: number; bought: string[]; owned: Record<string, Record<string, number>> }[] = [
  { name: 'fresh', ledger: {}, credits: 0, bought: [], owned: {} },
  { name: 'mid', ledger: { 'roe.mission_ratings': { a: 80 } }, credits: 1240, bought: ['breach_team'], owned: { inf_squad: { armour: 1 } } },
  { name: 'rich', ledger: { 'roe.mission_ratings': { a: 95 } }, credits: 99999, bought: ['apc_kipod'], owned: { mbt_lavi: { firepower: 3 } } },
];

describe('the Stores preview: no Buy is ever enabled', () => {
  for (const acct of ACCOUNTS) {
    it(`every coin Buy and every pack is disabled (${acct.name} account)`, () => {
      const { host, dispose } = mountStores({
        units: roster(new Set(acct.bought)),
        ledger: acct.ledger,
        credits: acct.credits,
        owned: acct.owned,
      });
      const buys = [...host.querySelectorAll<HTMLButtonElement>('button[data-buy]')];
      // A guard over nothing passes forever: there must be units, tiers and packs.
      expect(buys.filter((b) => b.dataset.buy?.startsWith('pack:'))).toHaveLength(COIN_PACKS.length);
      expect(buys.filter((b) => b.dataset.buy?.startsWith('unit:')).length).toBeGreaterThan(0);
      expect(buys.filter((b) => b.dataset.buy?.startsWith('tier:')).length).toBeGreaterThan(10);
      expect(buys.filter((b) => !b.disabled).map((b) => b.dataset.buy)).toEqual([]);
      dispose();
    });
  }

  it('the balance reads 0 and the honest preview line is shown', () => {
    const { host, dispose } = mountStores({ credits: 5000 });
    expect(host.querySelector('.rl-stores__wallet-n')?.textContent).toBe('0');
    expect(host.querySelector('.rl-stores__notice')?.textContent).toMatch(/online accounts/);
    dispose();
  });

  it('the Receipts shelf is empty and says why; so is Cosmetics', () => {
    const { host, dispose } = mountStores();
    expect(host.querySelector('[data-shelf="receipts"].rl-stores__panel .rl-stores__empty')?.textContent).toMatch(/Nothing has been bought/);
    expect(host.querySelector('[data-shelf="cosmetics"].rl-stores__panel .rl-stores__empty')).not.toBeNull();
    expect(host.querySelector('[data-shelf="receipts"].rl-stores__panel table')).toBeNull();
    dispose();
  });

  it('every item card shows both prices; an off-sale item has no Buy at all', () => {
    const { host, dispose } = mountStores({ credits: 9999 });
    const kipod = host.querySelector('[data-item="apc_kipod"]');
    expect(kipod?.querySelector('.rl-stores__credits')?.textContent).toBe('3200 credits');
    expect(kipod?.querySelector('.rl-stores__coin-n')?.textContent).toBe('320');
    const gunship = host.querySelector('[data-item="heli_peten_gunship"]');
    expect(gunship?.getAttribute('data-state')).toBe('offSale');
    expect(gunship?.querySelector('button[data-buy]')).toBeNull();
    dispose();
  });

  it('shows each of the three states the brief names', () => {
    const { host, dispose } = mountStores({
      units: roster(new Set(['breach_team'])),
      ledger: { 'roe.mission_ratings': { a: 60 } },
      credits: 500,
    });
    const state = (id: string): string | null | undefined => host.querySelector(`[data-item="${id}"]`)?.getAttribute('data-state');
    expect(state('breach_team')).toBe('earned');
    expect(state('recon_drone')).toBe('affordable'); // 220 <= 500, Conduct 70 not met
    expect(state('apc_kipod')).toBe('locked');
    dispose();
  });

  it('the shelves move with Left/Right and hide what is not selected', () => {
    const { host, dispose } = mountStores();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('.rl-stores__shelf')];
    expect(tabs.map((b) => b.dataset.shelf)).toEqual(['early', 'cosmetics', 'receipts']);
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector<HTMLElement>('[data-shelf="early"].rl-stores__panel')?.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('[data-shelf="cosmetics"].rl-stores__panel')?.hidden).toBe(false);
    dispose();
  });

  it('the disposer removes everything it mounted', () => {
    const { host, dispose } = mountStores();
    expect(host.querySelector('.rl-stores')).not.toBeNull();
    dispose();
    expect(host.childElementCount).toBe(0);
  });
});

describe('the garage\'s Stores tab', () => {
  function mountGarage(): { host: HTMLElement; dispose: () => void } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = showBrigade(host, {
      units: roster(),
      ledger: {},
      missionName: () => undefined,
      baseOf: (id) => ((units as Record<string, unknown>)[id] as { id: string } | undefined) ?? { id },
      possibleStars: 78,
      credits: 300,
      owned: {},
      onBuy: () => undefined,
      onBuyUpgrade: () => undefined,
      stores: { coinSrc },
    });
    return { host, dispose };
  }

  it('is a tab beside the brigade, and swaps the body for the Stores', () => {
    const { host, dispose } = mountGarage();
    const views = [...host.querySelectorAll<HTMLButtonElement>('.rl-garage__view')];
    expect(views.map((v) => v.dataset.view)).toEqual(['brigade', 'stores']);
    expect(host.querySelector('.rl-stores')).toBeNull();
    views[1].click();
    expect(host.querySelector<HTMLElement>('.rl-garage__body')?.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.rl-garage__stores')?.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('.rl-garage__wallet')?.hidden).toBe(true);
    const buys = [...host.querySelectorAll<HTMLButtonElement>('.rl-stores button[data-buy]')];
    expect(buys.length).toBeGreaterThan(10);
    expect(buys.filter((b) => !b.disabled)).toEqual([]);
    // ...and back: the Stores is unmounted, not merely hidden.
    views[0].click();
    expect(host.querySelector('.rl-stores')).toBeNull();
    expect(host.querySelector<HTMLElement>('.rl-garage__body')?.hidden).toBe(false);
    dispose();
    expect(host.childElementCount).toBe(0);
  });

  it('"Open in the brigade" selects that unit on the brigade tab', () => {
    const { host, dispose } = mountGarage();
    host.querySelector<HTMLButtonElement>('.rl-garage__view[data-view="stores"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-item="apc_kipod"] .rl-stores__open')?.click();
    expect(host.querySelector<HTMLElement>('.rl-garage__body')?.hidden).toBe(false);
    expect(host.querySelector('.rl-garage__card[aria-selected="true"]')?.getAttribute('data-unit')).toBe('apc_kipod');
    dispose();
  });

  it('a garage with no stores option draws no view tabs (as before)', () => {
    const host = document.createElement('div');
    const dispose = showBrigade(host, {
      units: roster(),
      ledger: {},
      missionName: () => undefined,
      baseOf: (id) => ({ id }),
      possibleStars: 78,
    });
    expect(host.querySelector('.rl-garage__views')).toBeNull();
    dispose();
  });
});
