// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { units, type UpgradableUnit } from '@lions/data';
import { specialRefusal } from '@lions/net';
import { coinHalfFor, emptyAccount, emptyRoar } from '@lions/economy';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { setCatalogue } from '../i18n/t';
import type { LedgerData, UnlockGate } from '@lions/sim';
import { showBrigade, type BrigadeUnit } from './brigade';
import { creditBuyEnabled, showStores, tierCreditBuyEnabled, type StoresOptions } from './stores';
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
        canCarry: null,
        canEmbark: false,
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

  it('the balance reads 0 and the preview line says why', () => {
    const { host, dispose } = mountStores({ credits: 5000 });
    expect(host.querySelector('.rl-stores__wallet-n')?.textContent).toBe('0');
    expect(host.querySelector('.rl-stores__notice')?.textContent).toMatch(/cannot keep a Roar-coin wallet/);
    dispose();
  });

  it('the Receipts shelf is empty and says why; so is Cosmetics', () => {
    const { host, dispose } = mountStores();
    expect(host.querySelector('[data-shelf="receipts"].rl-stores__panel .rl-stores__empty')?.textContent).toMatch(/cannot keep a wallet/);
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
    // One Buy, and GH-1076's "What it adds" control beside it.
    expect(kipod?.querySelectorAll('button[data-buy]')).toHaveLength(1);
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

describe('the Stores with a live wallet', () => {
  const wallet = { coins: 400, receipts: [] };

  it('enables a coin Buy exactly where the wallet covers an item for sale; packs stay disabled', () => {
    const asks: unknown[] = [];
    const { host, dispose } = mountStores({ wallet, onBuy: (a) => asks.push(a), credits: 0 });
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
    // The balance shows, and the live wallet says what the coins are, not "preview".
    expect(host.querySelector('.rl-stores__wallet-n')?.textContent).toBe('400');
    expect(host.querySelector('.rl-stores__about')?.textContent).toMatch(/^Roar coins are free\./);
    expect(host.querySelector('.rl-stores__notice')?.textContent).not.toMatch(/cannot keep/);
    dispose();
  });

  it('a coin-bought unit reads "Bought with coins" and offers no Buy', () => {
    const { host, dispose } = mountStores({
      wallet,
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

  it('Receipts lists earned coins and purchases, newest first', () => {
    const { host, dispose } = mountStores({
      wallet: {
        coins: 80,
        receipts: [
          { kind: 'earn', id: '1', at: 1, coins: { free: 400, paid: 0 }, source: 'welcome' },
          { kind: 'unit', id: '2', at: 2, unitId: 'apc_kipod', coins: { free: 320, paid: 0 }, credits: 3200 },
        ],
      },
    });
    const rows = [...host.querySelectorAll('[data-shelf="receipts"] tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-receipt'))).toEqual(['unit', 'earn']);
    expect(rows[0].textContent).toContain('Kipod');
    dispose();
  });

  it('Receipts names a redeemed code\'s coins as a plus row', () => {
    const { host, dispose } = mountStores({
      wallet: { coins: 100000, receipts: [{ kind: 'coupon', id: '1', at: 1, coins: { free: 100000, paid: 0 }, couponIds: ['lead_roar_coins_100k'] }] },
    });
    const row = host.querySelector('[data-shelf="receipts"] tbody tr');
    expect(row?.getAttribute('data-receipt')).toBe('coupon');
    expect(row?.textContent).toContain('Code redeemed: Roar coins');
    expect(row?.textContent).toContain('+100000');
    dispose();
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
    // Every COIN Buy is disabled. A "Buy with credits" is the Garage's own credit
    // purchase and is live exactly where the credits cover the unit (GH-317).
    expect(buys.filter((b) => !b.disabled && !b.classList.contains('rl-stores__buy--credits'))).toEqual([]);
    // ...and back: the Stores is unmounted, not merely hidden.
    views[0].click();
    expect(host.querySelector('.rl-stores')).toBeNull();
    expect(host.querySelector<HTMLElement>('.rl-garage__body')?.hidden).toBe(false);
    dispose();
    expect(host.childElementCount).toBe(0);
  });

  it('a coin buy opens the unit on the garage rail, and the Stores redraws on the same shelf', () => {
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
          wallet: { coins, receipts: [] },
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

describe('GH-317: "Buy with credits" on a Store card', () => {
  const creditBtn = (host: HTMLElement, id: string): HTMLButtonElement | null => host.querySelector(`[data-item="${id}"] button[data-buy="credits:${id}"]`);

  it('is offered, and asks the Garage purchase at the credit price, when the credits cover the unit', () => {
    const asked: [string, number][] = [];
    const { host, dispose } = mountStores({ ledger: { 'roe.mission_ratings': { a: 60 } }, credits: 500, onBuyCredits: (id, n) => asked.push([id, n]) });
    const b = creditBtn(host, 'recon_drone');
    expect(b).not.toBeNull();
    expect(b?.textContent).toBe('Buy with credits · 220');
    b?.click();
    expect(asked).toEqual([['recon_drone', 220]]);
    dispose();
  });

  it('is absent when the credits fall short, the unit is owned, or the caller cannot buy', () => {
    const short = mountStores({ ledger: { 'roe.mission_ratings': { a: 60 } }, credits: 100, onBuyCredits: () => undefined });
    expect(creditBtn(short.host, 'recon_drone')).toBeNull();
    short.dispose();
    const owned = mountStores({ units: roster(new Set(['recon_drone'])), credits: 500, onBuyCredits: () => undefined });
    expect(creditBtn(owned.host, 'recon_drone')).toBeNull();
    owned.dispose();
    const preview = mountStores({ credits: 500 });
    expect(preview.host.querySelectorAll('[data-buy^="credits:"]')).toHaveLength(0);
    preview.dispose();
  });

  it('creditBuyEnabled reads credits alone, never the coin wallet', () => {
    const item = { kind: 'unit', id: 'u', name: 'U', state: 'affordable', credits: 220, coins: 22, honest: { kind: 'payNow' }, specialForces: false } as const;
    expect(creditBuyEnabled(item, 220, true)).toBe(true);
    expect(creditBuyEnabled(item, 219, true)).toBe(false);
    expect(creditBuyEnabled(item, undefined, true)).toBe(false);
    expect(creditBuyEnabled(item, 500, false)).toBe(false);
    expect(creditBuyEnabled({ ...item, state: 'locked' }, 500, true)).toBe(false);
    expect(creditBuyEnabled({ ...item, state: 'coins' }, 500, true)).toBe(false);
  });
});

describe('GH-1076: the "What it adds" panel', () => {
  const control = (host: HTMLElement, id: string): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>(`button[data-focus="adds:${id}"]`);
  const regions = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="region"].rl-stores__adds')];

  it('opening B closes A: exactly one region, aria-expanded follows, focus goes to the heading and back', () => {
    const { host, dispose } = mountStores();
    const a = control(host, 'apc_kipod');
    const b = control(host, 'recon_zikit');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(regions(host)).toHaveLength(0);
    expect(a?.getAttribute('aria-expanded')).toBe('false');
    a?.click();
    expect(regions(host)).toHaveLength(1);
    expect(regions(host)[0].dataset.adds).toBe('apc_kipod');
    expect(a?.getAttribute('aria-expanded')).toBe('true');
    expect(a?.getAttribute('aria-controls')).toBe(regions(host)[0].id);
    // Focus moves to the panel's heading, and the region is named by it (which carries the unit's name).
    const heading = regions(host)[0].querySelector<HTMLElement>('.rl-stores__adds-h');
    expect(document.activeElement).toBe(heading);
    expect(regions(host)[0].getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(heading?.textContent).toContain('Kipod');
    b?.click();
    expect(regions(host)).toHaveLength(1);
    expect(regions(host)[0].dataset.adds).toBe('recon_zikit');
    expect(a?.getAttribute('aria-expanded')).toBe('false');
    expect(b?.getAttribute('aria-expanded')).toBe('true');
    // Closing returns focus to the control that opened it.
    b?.click();
    expect(regions(host)).toHaveLength(0);
    expect(document.activeElement).toBe(b);
    dispose();
    expect(host.childElementCount).toBe(0);
  });

  it('opening scrolls the panel into view (the shell clips it otherwise) and close does not', () => {
    const calls: Element[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: (o?: unknown) => void };
    const prior = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element): void {
      calls.push(this);
    };
    try {
      const { host, dispose } = mountStores();
      const a = control(host, 'apc_kipod');
      a?.click();
      expect(calls).toEqual([regions(host)[0]]);
      a?.click();
      expect(calls).toHaveLength(1);
      dispose();
    } finally {
      if (prior === undefined) delete proto.scrollIntoView;
      else proto.scrollIntoView = prior;
    }
  });

  it('the panel sits in the grid right after its card, and the open id survives a redraw', () => {
    let open: string | undefined;
    const draw = (): { host: HTMLElement; dispose: () => void } =>
      mountStores({ adds: open, onAdds: (id) => (open = id ?? undefined) });
    const first = draw();
    control(first.host, 'recon_zikit')?.click();
    expect(open).toBe('recon_zikit');
    expect(first.host.querySelector('[data-item="recon_zikit"]')?.nextElementSibling).toBe(regions(first.host)[0]);
    first.dispose();
    const second = draw();
    expect(regions(second.host)).toHaveLength(1);
    expect(control(second.host, 'recon_zikit')?.getAttribute('aria-expanded')).toBe('true');
    second.dispose();
  });

  it('under ?pseudo=1 every text node in the panel went through t()', () => {
    setCatalogue('pseudo', en, pseudo);
    try {
      const { host, dispose } = mountStores();
      let nodes = 0;
      for (const id of ['inf_medic_squad', 'spg_long_range', 'apc_kipod']) {
        control(host, id)?.click();
        const panel = regions(host)[0];
        expect(panel.dataset.adds).toBe(id);
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim();
          if (text === '') continue;
          nodes++;
          expect(text, `${id}: ${text}`).toMatch(/^⟦.*⟧$/s);
        }
      }
      // A walk over nothing passes forever.
      expect(nodes).toBeGreaterThan(40);
      dispose();
    } finally {
      setCatalogue('en', en);
    }
  });

  it('the panel never reads the wallet, and the preview draws it in full', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let reads = 0;
    const o: StoresOptions = { units: roster(), ledger: {}, credits: 0, owned: {}, coinSrc, missionName: () => undefined };
    Object.defineProperty(o, 'wallet', {
      enumerable: true,
      get: () => {
        reads++;
        return undefined;
      },
    });
    const dispose = showStores(host, o);
    const mounted = reads;
    expect(mounted).toBeGreaterThan(0); // the spy sees the screen's own reads
    control(host, 'inf_medic_squad')?.click();
    expect(regions(host)).toHaveLength(1);
    expect(regions(host)[0].querySelectorAll('.rl-stores__adds-block').length).toBeGreaterThanOrEqual(6);
    expect(regions(host)[0].querySelector('button[data-buy]')).toBeNull(); // the panel carries no Buy
    expect(reads).toBe(mounted);
    dispose();
  });

  it('buy with the panel open: the card leaves the shelf, the panel goes with it, focus lands on a connected node', () => {
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
          wallet: { coins, receipts: [] },
        }),
        onBuy: (ask) => {
          if (ask.kind !== 'unit') return undefined;
          coinUnits.add(ask.unitId);
          coins -= 425;
          return { units: roster(coinUnits), credits: 0, owned: {} };
        },
      },
    });
    control(host, 'inf_medic_squad')?.click();
    expect(regions(host)).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('button[data-buy="unit:inf_medic_squad"]')?.click();
    expect(host.querySelector('[data-item="inf_medic_squad"]')?.getAttribute('data-state')).toBe('coins');
    expect(regions(host)).toHaveLength(0);
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(focused?.isConnected).toBe(true);
    // The held id was dropped with the panel, so showing owned does not resurrect it.
    host.querySelector<HTMLButtonElement>('.rl-stores__owned')?.click();
    expect(regions(host)).toHaveLength(0);
    dispose();
  });

  it('the toggle hiding an owned card closes its open panel', () => {
    const { host, dispose } = mountStores({ units: roster(new Set(['breach_team'])), showOwned: true });
    control(host, 'breach_team')?.click();
    expect(regions(host)).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('.rl-stores__owned')?.click();
    expect(regions(host)).toHaveLength(0);
    dispose();
  });

  it('the versus line follows the real specialRefusal over all twelve Store specials', () => {
    const specials = Object.values(units)
      .filter((u) => {
        if (u.faction !== 'kdf' || !('unlock' in u)) return false;
        const g = u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number };
        return g.price !== undefined && g.roe_rating_min === undefined && g.stars_min === undefined && g.after_mission === undefined;
      })
      .map((u) => u.id);
    expect(specials).toHaveLength(12);
    const { host, dispose } = mountStores();
    const room = en['stores.adds.where.brigadeRoom'];
    const refused: string[] = [];
    for (const id of specials) {
      control(host, id)?.click();
      const panel = regions(host)[0];
      expect(panel.dataset.adds).toBe(id);
      const room_ = panel.querySelector('[data-where="brigadeRoom"]');
      if (specialRefusal(id) === null) {
        expect(room_?.textContent, id).toBe(room);
      } else {
        refused.push(id);
        expect(room_, id).toBeNull();
        expect(panel.querySelector('[data-where="campaignOnly"]')?.textContent, id).toBe(en['stores.adds.where.campaignOnly']);
      }
    }
    expect(refused.sort()).toEqual(['air_medevac_heli', 'spg_cluster', 'veh_ambulance']);
    dispose();
  });
});


describe('D5: "Buy with credits" on a Stores tier row (WP7, T20)', () => {
  // spg_long_range armour: tiers 150 + 250 + 340. Coins hold tiers 1-2 (owned 2, earned 0), so the
  // credit Buy is the RUN to tier 3: 740, while the one rung alone is 340.
  const spg = (unlock?: UnlockGate): BrigadeUnit => ({
    ...roster().find((u) => u.id === 'inf_squad')!,
    id: 'spg_long_range',
    name: 'Long-range SPG',
    unlock,
    upgrades: {
      armour: {
        tiers: [
          { price: 150, label: 'a', patch: {} },
          { price: 250, label: 'b', patch: {} },
          { price: 340, label: 'c', patch: {} },
        ],
      },
    } as unknown as BrigadeUnit['upgrades'],
  });
  const coinRun = { earnedUnits: new Set<string>(), coinUnits: new Set<string>(), earnedTiers: { spg_long_range: { armour: 0 } }, coinTiers: { spg_long_range: { armour: 2 } } };
  const run = (over: Partial<StoresOptions> = {}) =>
    mountStores({
      units: [spg()],
      credits: 345,
      owned: { spg_long_range: { armour: 2 } },
      coin: coinRun,
      wallet: { coins: 2, receipts: [] },
      onBuyTierCredits: () => undefined,
      ...over,
    });
  const btn = (host: HTMLElement): HTMLButtonElement | null => host.querySelector('button[data-buy="credits:spg_long_range.armour"]');

  it('Review Focus 1: 345 credits cover tier 3 (340) but not the run (740): no credit Buy', () => {
    const m = run();
    expect(btn(m.host)).toBeNull();
    m.dispose();
  });

  it('at 740 credits the run label shows, and a press routes the run to onBuyTierCredits', () => {
    const asked: [string, string, number, number][] = [];
    const m = run({ credits: 740, onBuyTierCredits: (u, tr, to, p) => asked.push([u, tr, to, p]) });
    expect(btn(m.host)?.textContent).toContain('Tier 3 · 740 credits (pays for tiers 1-2 again');
    btn(m.host)?.click();
    expect(asked).toEqual([['spg_long_range', 'armour', 3, 740]]);
    m.dispose();
  });

  it('after a credit purchase that maxes the track, focus lands on the unit\'s tier card, not the shelf tab', () => {
    // The press was credits:spg_long_range.armour; the redraw has no such Buy left (tier 3 owned and earned).
    const m = run({
      credits: 0,
      owned: { spg_long_range: { armour: 3 } },
      coin: { ...coinRun, earnedTiers: { spg_long_range: { armour: 3 } }, coinTiers: {} },
      showOwned: true,
      focusKey: 'credits:spg_long_range.armour',
    });
    expect(btn(m.host)).toBeNull();
    expect(document.activeElement?.getAttribute('data-focus')).toBe('card:tiers:spg_long_range');
    expect(document.activeElement?.getAttribute('role')).not.toBe('tab');
    m.dispose();
  });

  it('the row credit figure follows the ask (740, not 340) and the coin figure is unchanged', () => {
    const m = run({ credits: 740 });
    const row = m.host.querySelector('[data-item="tiers:spg_long_range"] .rl-stores__tier');
    expect(row?.querySelector('.rl-stores__credits')?.textContent).toContain('740');
    expect(row?.querySelector('.rl-stores__credits')?.textContent).not.toContain('340');
    expect(row?.querySelector('.rl-stores__coin-n')?.textContent).toBe('35');
    m.dispose();
  });

  it('a plain one-rung ask shows the rung price when coins have not run ahead', () => {
    const m = run({ credits: 340, owned: { spg_long_range: { armour: 2 } }, coin: { ...coinRun, earnedTiers: { spg_long_range: { armour: 2 } }, coinTiers: {} } });
    expect(btn(m.host)?.textContent).toBe('Buy with credits · 340');
    m.dispose();
  });

  it('T20: zero credits with plenty of coins shows no credit Buy; coins are never read', () => {
    const m = run({ credits: 0, wallet: { coins: 99999, receipts: [] } });
    expect(btn(m.host)).toBeNull();
    m.dispose();
  });

  it('Review Focus 3: a locked unit shows no credit Buy', () => {
    const m = run({ units: [spg({ roeMin: 99, price: 500, bought: false })], credits: 99999, ledger: {} });
    // The Stores draws no tier row for an unopened unit at all (`unlockFirst`), so the render path
    // cannot reach the button; `unitOpen` is the second lock, pinned in the pure test below. Guard
    // against a vacuous pass: the unit card itself IS drawn.
    expect(m.host.querySelector('[data-item="spg_long_range"]')).not.toBeNull();
    expect(m.host.querySelector('[data-item="tiers:spg_long_range"]')).toBeNull();
    expect(btn(m.host)).toBeNull();
    m.dispose();
  });

  it('Review Focus 5: the preview (no handler, no wallet) shows no credit Buy', () => {
    const m = run({ credits: 99999, onBuyTierCredits: undefined, wallet: undefined });
    expect(btn(m.host)).toBeNull();
    m.dispose();
  });

  it('tierCreditBuyEnabled reads the ask, credits and openness alone', () => {
    const ask = { from: 1, to: 3, price: 740, again: 2 };
    expect(tierCreditBuyEnabled(ask, 740, true, true)).toBe(true);
    expect(tierCreditBuyEnabled(ask, 739, true, true)).toBe(false);
    expect(tierCreditBuyEnabled(ask, 740, false, true)).toBe(false);
    expect(tierCreditBuyEnabled(ask, 740, true, false)).toBe(false);
    expect(tierCreditBuyEnabled(null, 740, true, true)).toBe(false);
    expect(tierCreditBuyEnabled(ask, undefined, true, true)).toBe(false);
  });
});

// GH-1075 A2: a guest's Buy is the synchronous handler it always was; only a signed-in handler answers a promise.
describe('a guest Buy still answers synchronously', () => {
  it('the redraw follows the click with no promise in between, and nothing reads as pending', () => {
    setCatalogue('en', en);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const asked: unknown[] = [];
    const state = { units: roster(), credits: 0, owned: {} as Record<string, Record<string, number>> };
    const dispose = showBrigade(host, {
      units: roster(),
      ledger: {},
      missionName: () => undefined,
      baseOf: (id) => ((units as Record<string, unknown>)[id] as UpgradableUnit | undefined) ?? { id },
      possibleStars: 3,
      credits: 0,
      reducedMotion: () => true,
      stores: {
        coinSrc,
        open: true,
        read: () => ({ coin: coinHalfFor({ brigade: emptyAccount(), roar: emptyRoar() }), wallet: { coins: 99999, receipts: [] } }),
        onBuy: (ask) => {
          asked.push(ask);
          return state; // a GarageState, not a promise
        },
      },
    });
    const buy = [...host.querySelectorAll<HTMLButtonElement>('[data-buy^="unit:"]')].find((b) => !b.disabled);
    expect(buy, 'premise: a coin Buy is live').toBeDefined();
    buy?.click();
    expect(asked).toHaveLength(1);
    expect(host.textContent).not.toContain(en['stores.pending']);
    expect([...host.querySelectorAll('button[data-buy]')].some((b) => b.textContent?.includes(en['stores.pending']))).toBe(false);
    dispose();
  });
});
