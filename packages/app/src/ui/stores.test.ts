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

  it('a card carries ONE price line, coins first; off-sale items are a counted line, not cards', () => {
    const { host, dispose } = mountStores({ credits: 1240 });
    const kipod = host.querySelector('[data-item="apc_kipod"]');
    const lines = kipod?.querySelectorAll('.rl-stores__price') ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0].firstElementChild?.querySelector('.rl-stores__coin-n')?.textContent).toBe('320');
    expect(lines[0].querySelector('.rl-stores__credits')?.textContent).toBe('3200 credits');
    // The diet: no "(you have …)", no per-card rule sentence, no Open button.
    expect(kipod?.textContent).not.toMatch(/you have|co-op|Open in the brigade/);
    expect(kipod?.querySelector('.rl-stores__path')?.textContent).toMatch(/^Free in ~\d+ missions?$/);
    expect(kipod?.querySelectorAll('button')).toHaveLength(1);
    // GH-330: a new campaign pays again, so the gunship (8,000, past one
    // campaign's pay) is a card like any other and nothing is off sale.
    expect(host.querySelector('[data-item="heli_peten_gunship"]')?.getAttribute('data-state')).toBe('locked');
    expect(host.querySelector('.rl-stores__offsale-count')).toBeNull();
    // The co-op/skirmish rule is said once, in the shelf's intro.
    expect(host.querySelectorAll('.rl-stores__lede')).toHaveLength(1);
    expect((host.textContent ?? '').match(/co-op and skirmish/g)).toHaveLength(1);
    dispose();
  });

  it('the default view hides owned items; "Show owned (N)" reveals them', () => {
    const { host, dispose } = mountStores({
      units: roster(new Set(['breach_team'])),
      ledger: { 'roe.mission_ratings': { a: 80 } },
      owned: { mbt_lavi: { armour: 3, sensors: 3, firepower: 3 } },
    });
    const visible = (sel: string): boolean => {
      const e = host.querySelector<HTMLElement>(sel);
      return e !== null && e.closest('[hidden]') === null;
    };
    expect(visible('[data-item="breach_team"]')).toBe(false); // bought with credits
    expect(visible('[data-item="recon_drone"]')).toBe(false); // Conduct 70 earned
    expect(visible('[data-item="apc_kipod"]')).toBe(true); // for sale
    const toggle = host.querySelector<HTMLButtonElement>('.rl-stores__owned');
    const owned = host.querySelectorAll('[data-owned="1"]').length;
    expect(owned).toBeGreaterThan(3);
    expect(toggle?.textContent).toMatch(/^Show owned \(\d+\)$/);
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    toggle?.click();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(visible('[data-item="breach_team"]')).toBe(true);
    expect(visible('[data-item="recon_drone"]')).toBe(true);
    expect(visible('[data-item="tiers:mbt_lavi"]')).toBe(true);
    toggle?.click();
    expect(visible('[data-item="breach_team"]')).toBe(false);
    dispose();
  });

  it('groups the cards under Units, Special forces and Upgrades', () => {
    const { host, dispose } = mountStores();
    const groups = [...host.querySelectorAll<HTMLElement>('.rl-stores__group')].map((g) => g.dataset.group);
    expect(groups).toEqual(['units', 'special', 'tiers']);
    expect(host.querySelector('[data-group="special"] [data-item="recon_zikit"]')).not.toBeNull();
    expect(host.querySelector('[data-group="units"] [data-item="recon_zikit"]')).toBeNull();
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

describe('the Stores with a TEST wallet (?testcoins)', () => {
  const test = { coins: 400, grant: 5000, receipts: [] };

  it('enables a coin Buy exactly where the wallet covers an item for sale; packs stay disabled', () => {
    const asks: unknown[] = [];
    const { host, dispose } = mountStores({ test, onBuy: (a) => asks.push(a), credits: 0 });
    const buy = (k: string): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>(`button[data-buy="${k}"]`);
    expect(buy('unit:apc_kipod')?.disabled).toBe(false); // 320 <= 400
    expect(buy('unit:recon_zikit')?.disabled).toBe(true); // 425 > 400
    expect(buy('unit:heli_peten_gunship')?.disabled).toBe(true); // 800 > 400; on sale since GH-330 (G1)
    expect(buy('tier:apc_kipod.armour.1')).toBeNull(); // unit not open yet: nothing to buy
    expect(buy('tier:inf_squad.armour.1')?.disabled).toBe(false);
    const packs = [...host.querySelectorAll<HTMLButtonElement>('button[data-buy^="pack:"]')];
    expect(packs).toHaveLength(COIN_PACKS.length);
    expect(packs.filter((b) => !b.disabled)).toEqual([]);
    buy('unit:apc_kipod')?.click();
    expect(asks).toEqual([{ kind: 'unit', unitId: 'apc_kipod' }]);
    // The balance shows, labelled TEST.
    expect(host.querySelector('.rl-stores__wallet-n')?.textContent).toBe('400');
    expect(host.querySelector('.rl-stores__test')?.textContent).toBe('TEST');
    dispose();
  });

  it('a coin-bought unit reads "Bought with coins" and offers no Buy', () => {
    const { host, dispose } = mountStores({
      test,
      units: roster(new Set(['apc_kipod'])),
      coin: { earnedUnits: new Set(), coinUnits: new Set(['apc_kipod']), earnedTiers: {}, coinTiers: {} },
    });
    const card = host.querySelector('[data-item="apc_kipod"]');
    expect(card?.getAttribute('data-state')).toBe('coins');
    expect(card?.querySelector('button[data-buy]')).toBeNull();
    // ...and its tiers open for coins.
    expect(host.querySelector<HTMLButtonElement>('button[data-buy="tier:apc_kipod.armour.1"]')?.disabled).toBe(false);
    dispose();
  });

  it('Receipts lists TEST grants and purchases, newest first', () => {
    const { host, dispose } = mountStores({
      test: {
        coins: 80,
        grant: 400,
        receipts: [
          { kind: 'grant', id: '1', at: 1, coins: 400 },
          { kind: 'unit', id: '2', at: 2, unitId: 'apc_kipod', coins: 320, credits: 3200 },
        ],
      },
    });
    const rows = [...host.querySelectorAll('[data-shelf="receipts"] tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-receipt'))).toEqual(['unit', 'grant']);
    expect(rows[0].textContent).toContain('Kipod');
    dispose();
  });

  it('Grant shows only with the TEST wallet', () => {
    let grants = 0;
    const withTest = mountStores({ test, onGrant: () => grants++ });
    withTest.host.querySelector<HTMLButtonElement>('button[data-buy="grant"]')?.click();
    expect(grants).toBe(1);
    withTest.dispose();
    const preview = mountStores({ onGrant: () => grants++ });
    expect(preview.host.querySelector('button[data-buy="grant"]')).toBeNull();
    preview.dispose();
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

  it('a TEST-coin buy opens the unit on the garage rail, and the Stores redraws on the same shelf', () => {
    const coinUnits = new Set<string>();
    let coins = 1000;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = showBrigade(host, {
      units: roster(),
      ledger: {},
      missionName: () => undefined,
      baseOf: (id) => ((units as Record<string, unknown>)[id] as { id: string } | undefined) ?? { id },
      possibleStars: 78,
      credits: 0,
      owned: {},
      stores: {
        coinSrc,
        open: true,
        read: () => ({
          coin: { earnedUnits: new Set(), coinUnits, earnedTiers: {}, coinTiers: {} },
          test: { coins, grant: 1000, receipts: [] },
        }),
        onBuy: (ask) => {
          if (ask.kind !== 'unit') return undefined;
          coinUnits.add(ask.unitId);
          coins -= 320;
          return { units: roster(coinUnits), credits: 0, owned: {} };
        },
      },
    });
    expect(host.querySelector('.rl-garage__card[data-unit="apc_kipod"]')?.getAttribute('data-locked')).toBe('1');
    host.querySelector<HTMLButtonElement>('button[data-buy="unit:apc_kipod"]')?.click();
    expect(host.querySelector('.rl-garage__card[data-unit="apc_kipod"]')?.getAttribute('data-locked')).toBe('0');
    expect(host.querySelector('[data-item="apc_kipod"]')?.getAttribute('data-state')).toBe('coins');
    expect(host.querySelector('.rl-stores__wallet-n')?.textContent).toBe('680');
    // Focus lands on what is now for sale for that unit -- its upgrades --
    // never <body> (its own card is owned, so hidden).
    expect(document.activeElement?.getAttribute('data-focus')).toBe('card:tiers:apc_kipod');
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
