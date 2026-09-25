// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RosterEntry } from '../ledger-store';
import { ROSTER_CAP } from '../roster-cap';
import { t } from '../i18n/t';
import { showBrigade, type BrigadeOptions, type BrigadeUnit } from './brigade';

// No mission is ever gated behind `afterMission` in this fixture set, so the
// resolver is never actually called for a real id -- it only has to exist to
// satisfy `BrigadeOptions`, the same as every other screen's `missionName`.
const noMissionNames = (): string | undefined => undefined;

const units = [
  {
    id: 'inf_squad',
    name: 'Rifle Squad',
    role: 'infantry',
    isKamikaze: false,
    transportSlots: 0,
    isSoft: true,
    upgrades: {
      armour: {
        tiers: [
          { price: 200, patch: { 'hull.hp': 40 } },
          { price: 300, patch: { 'hull.hp': 80 } },
        ],
      },
      sensors: { tiers: [{ price: 150, patch: { 'sensors.sight_tiles': 1 } }] },
    },
  },
  {
    id: 'ifv_namer',
    name: 'Namer IFV',
    role: 'ifv',
    unlock: { roeMin: 40 },
    isKamikaze: false,
    transportSlots: 6,
    isSoft: false,
  },
  {
    id: 'breach_team',
    name: 'Tzinah Breach Team',
    role: 'support',
    unlock: { starsMin: 12 },
    isKamikaze: false,
    transportSlots: 0,
    isSoft: true,
  },
];

/** The raw JSON the garage reads its numbers off. Deliberately three
 *  different SHAPES: a full unit, one whose weapons list is empty (the panel
 *  has to print an em-dash rather than throw), and -- by omission --
 *  `made_up_unit`, which `baseOf` below answers with a bare `{ id }`. */
const BASE: Record<string, Record<string, unknown>> = {
  inf_squad: {
    id: 'inf_squad',
    blurb: 'Holds ground and garrisons buildings.',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    sensors: { optics: 1, sight_tiles: 8 },
    weapons: [{ accuracy: 0.6, penetration: 8 }],
  },
  ifv_namer: {
    id: 'ifv_namer',
    blurb: 'Carries a squad through fire.',
    hull: { hp: 2000, armor: { front: 400, side: 200, rear: 90 } },
    sensors: { optics: 1.1, sight_tiles: 10 },
    weapons: [{ accuracy: 0.7, penetration: 120 }],
  },
  breach_team: {
    id: 'breach_team',
    hull: { hp: 300, armor: { front: 10, side: 10, rear: 10 } },
    sensors: { optics: 1, sight_tiles: 7 },
    weapons: [],
  },
};

const baseOf = (id: string): Record<string, unknown> => BASE[id] ?? { id };

/** Every fixture in this file needs the same two required options; spelling
 *  them at each call site is how one of them silently drifts. `units` also
 *  defaults to empty -- the cap/stood-down specs below mount on a roster
 *  ledger alone and have no rail of their own to classify. */
function mount(opts: Partial<BrigadeOptions>): HTMLElement {
  const host = document.createElement('div');
  showBrigade(host, { missionName: noMissionNames, baseOf, units: [], ...opts } as BrigadeOptions);
  return host;
}

const cardIds = (host: HTMLElement): (string | null)[] =>
  [...host.querySelectorAll('.rl-garage__card')].map((c) => c.getAttribute('data-unit'));

const select = (host: HTMLElement, id: string): void => {
  host.querySelector<HTMLButtonElement>(`.rl-garage__card[data-unit="${id}"]`)?.click();
};

const text = (host: HTMLElement, sel: string): string | undefined =>
  host.querySelector(sel)?.textContent ?? undefined;

describe('showBrigade — the header and the rail', () => {
  it('shows the campaign line and the whole roster, one card per unit', () => {
    const host = mount({
      units,
      ledger: {
        'campaign.mission_results': { a: { stars: 2, roe: 90, ticks: 1, lost: 0 } },
        'roe.mission_ratings': { a: 90 },
      },
      possibleStars: 78,
    });
    expect(text(host, '.rl-garage__title')).toBe('The garage');
    expect(text(host, '.rl-garage__campaign')).toBe('2 of 78 stars · Conduct 90 · The brigade holds 0 of its 150 places.');
    expect(cardIds(host)).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('0');
    // The chip is the requirement; the card's `title` is the sentence.
    expect(text(host, '.rl-garage__card[data-unit="breach_team"] .rl-garage__card-chip')).toBe('Locked · 12★');
    expect(host.querySelector('.rl-garage__card[data-unit="breach_team"]')?.getAttribute('title')).toBe(
      'Needs 12 stars (you have 2)'
    );
    expect(text(host, '.rl-garage__card[data-unit="ifv_namer"] .rl-garage__card-chip')).toBe('Earned');
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('title')).toBeNull();
  });

  it('reads a fresh campaign honestly, and speaks a Conduct gate as a sentence, never a bare number', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(text(host, '.rl-garage__campaign')).toBe(
      '0 of 78 stars · no missions rated yet · The brigade holds 0 of its 150 places.'
    );
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
    // ifv_namer's gate is `{ roeMin: 40 }`: the bay names what it needs, never
    // the sim's own "requires campaign Conduct 40 (no missions rated yet)".
    select(host, 'ifv_namer');
    expect(text(host, '.rl-garage__gate')).toBe('Needs a campaign Conduct of 40 or better');
  });

  it('sorts on the exact Conduct predicate, not a rounded mean', () => {
    // Exact sum 79 over two ratings is short of a 40 floor (79 < 80): still
    // locked. The ROUNDED mean (79 / 2 = 39.5 -> 40) would read as clearing
    // it, which would misfile ifv_namer as a mission-gated unit (sorted last)
    // instead of a Conduct-gated one (sorted before a stars gate).
    const host = mount({ units, ledger: { 'roe.mission_ratings': { a: 39, b: 40 } }, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
    expect(cardIds(host)).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
  });

  it('sorts a price-only (bought-only) locked unit after a mission-gated one', () => {
    const fixture = [
      {
        id: 'mission_gated',
        name: 'Mission Gated',
        role: 'infantry',
        unlock: { afterMission: 'x' },
        isKamikaze: false,
        transportSlots: 0,
        isSoft: true,
      },
      {
        id: 'price_only',
        name: 'Price Only',
        role: 'infantry',
        unlock: { price: 50 },
        isKamikaze: false,
        transportSlots: 0,
        isSoft: true,
      },
    ];
    const host = mount({ units: fixture, ledger: {}, possibleStars: 78 });
    expect(cardIds(host)).toEqual(['mission_gated', 'price_only']);
  });

  it('filters the rail by role tab without dropping a unit from the roster', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    // `All` leads and is selected, so the screen opens on the whole roster.
    expect([...host.querySelectorAll('.rl-garage__tab')].map((t) => t.getAttribute('data-bucket'))).toEqual([
      'all',
      'transport',
      'soft',
    ]);
    expect(host.querySelector('.rl-garage__tab[data-bucket="all"]')?.getAttribute('aria-selected')).toBe('true');
    const hidden = (id: string): boolean =>
      host.querySelector<HTMLButtonElement>(`.rl-garage__card[data-unit="${id}"]`)?.hidden ?? false;
    expect([hidden('inf_squad'), hidden('ifv_namer'), hidden('breach_team')]).toEqual([false, false, false]);

    host.querySelector<HTMLButtonElement>('.rl-garage__tab[data-bucket="transport"]')?.click();
    // ifv_namer carries six transport slots, so it is the carrier; the two
    // thin-skinned teams drop out of view but stay in the DOM.
    expect([hidden('inf_squad'), hidden('ifv_namer'), hidden('breach_team')]).toEqual([true, false, true]);
    expect(cardIds(host)).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
  });

  it('marks a card data-icon="1" only when iconIds names it, never from portrait alone', () => {
    const host = mount({
      units,
      ledger: {},
      possibleStars: 78,
      portrait: (id) => `/ui/icons/units/${id}.png`,
      iconIds: new Set(['inf_squad']),
    });
    expect(
      host.querySelector('.rl-garage__card[data-unit="inf_squad"] .rl-garage__card-art')?.getAttribute('data-icon')
    ).toBe('1');
    expect(
      host.querySelector('.rl-garage__card[data-unit="ifv_namer"] .rl-garage__card-art')?.getAttribute('data-icon')
    ).toBeNull();
  });

  it('draws a unit with no portrait as the HUD hatch with a role mark, never a bare hatch', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    const art = host.querySelector('.rl-garage__card[data-unit="breach_team"] .rl-garage__card-art');
    expect(art?.getAttribute('data-nosprite')).toBe('1');
    expect(art?.querySelector('svg')).not.toBeNull();
    // Named, so "reserved" cannot be mistaken for "this build is broken".
    expect(art?.getAttribute('title')).toBe('breach_team — no sprite sheet');
  });

  // The whole point of the short form: two units held by the same KIND of gate
  // at different numbers must read differently on the rail. Clipping the
  // sentence made both `Locked · Needs a campaign Conduc…`.
  it('distinguishes two Conduct floors on the chip', () => {
    const host = mount({
      units: [
        { ...units[1], id: 'a', name: 'A', unlock: { roeMin: 35 } },
        { ...units[1], id: 'b', name: 'B', unlock: { roeMin: 75 } },
      ],
      ledger: {},
      possibleStars: 78,
    });
    expect(text(host, '.rl-garage__card[data-unit="a"] .rl-garage__card-chip')).toBe('Locked · Conduct 35');
    expect(text(host, '.rl-garage__card[data-unit="b"] .rl-garage__card-chip')).toBe('Locked · Conduct 75');
  });

  describe('showBrigade — keyboard (F8)', () => {
    const stops = (host: HTMLElement, sel: string): number =>
      [...host.querySelectorAll<HTMLElement>(sel)].filter((e) => e.tabIndex >= 0).length;

    it('is one Tab stop for the tabs and one for the cards', () => {
      const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78 });
      expect(stops(host, '.rl-garage__tab')).toBe(1);
      expect(stops(host, '.rl-garage__card')).toBe(1);
      expect(host.querySelector<HTMLElement>('.rl-garage__card[aria-selected="true"]')?.tabIndex).toBe(0);
      dispose();
    });

    it('moves focus AND the selection down the rail on an arrow', () => {
      const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78 });
      host.querySelector<HTMLButtonElement>('.rl-garage__card[data-unit="inf_squad"]')?.focus();
      host.querySelector('.rl-garage__cards')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement?.getAttribute('data-unit')).toBe('ifv_namer');
      expect(host.querySelector('.rl-garage__card[aria-selected="true"]')?.getAttribute('data-unit')).toBe('ifv_namer');
      expect(text(host, '.rl-garage__name')).toBe('Namer IFV');
      expect(stops(host, '.rl-garage__card')).toBe(1);
      dispose();
    });

    it('moves the tab with the arrows, filtering as it goes, and keeps the card stop on a visible card', () => {
      const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78 });
      host.querySelector<HTMLButtonElement>('.rl-garage__tab[data-bucket="all"]')?.focus();
      host.querySelector('.rl-garage__tabs')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(document.activeElement?.getAttribute('data-bucket')).toBe('transport');
      expect(host.querySelector('.rl-garage__tab[aria-selected="true"]')?.getAttribute('data-bucket')).toBe('transport');
      // inf_squad is still in the bay but hidden by the filter: the one card stop moves to a visible card.
      const stop = [...host.querySelectorAll<HTMLButtonElement>('.rl-garage__card')].find((c) => c.tabIndex === 0);
      expect(stop?.getAttribute('data-unit')).toBe('ifv_namer');
      dispose();
    });

    it('jumps to a track on 1-3, landing on its next rung', () => {
      const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78, credits: 999, onBuyUpgrade: () => undefined });
      host.querySelector('.rl-menu--garage')?.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
      expect(focusKey()).toBe('rung:sensors:1');
      dispose();
    });

    it('buys the focused next tier on Enter', () => {
      const asked: [string, string, number, number][] = [];
      const { host, dispose } = mountLive({
        units, ledger: {}, possibleStars: 78, credits: 999,
        onBuyUpgrade: (u, tr, tier, price) => void asked.push([u, tr, tier, price]),
      });
      host.querySelector('.rl-menu--garage')?.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(asked).toEqual([['inf_squad', 'armour', 1, 200]]);
      dispose();
    });

    // Fix round 2 (issue 1): a unit whose SECOND track is not the board's
    // default (armour, first and still non-maxed, opens by default) --
    // buying into it by keyboard used to be the one path where `renderBay`'s
    // own `board.replaceChildren()` blurred the just-focused rung before the
    // accordion's own `applyExpansion()` ran, collapsing the very track just
    // bought into. Fix round 2, issue 2 closed it at the source: `activeTrack`
    // is set-only now, with no `focusout` listener anywhere on the accordion
    // to have reacted to that blur in the first place -- this test's own
    // manual `focusout` dispatch (there in an earlier revision, to simulate a
    // real browser's blur-on-removal, which jsdom does not fire on its own)
    // is gone because there is no longer a listener for it to reach.
    it('keeps the just-bought track expanded, and focus on something actually rendered, after a keyboard purchase', () => {
      const twoTrack: BrigadeUnit = {
        id: 'two_track',
        name: 'Two Track',
        role: 'infantry',
        isKamikaze: false,
        transportSlots: 0,
        isSoft: true,
        upgrades: {
          armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }, { price: 100, patch: { 'hull.hp': 10 } }] },
          firepower: { tiers: [{ price: 50, patch: { 'weapons[0].accuracy': 0.05 } }, { price: 50, patch: { 'weapons[0].accuracy': 0.05 } }] },
        },
      };
      const { host, dispose } = mountLive({
        units: [twoTrack],
        ledger: {},
        possibleStars: 78,
        credits: 999,
        // A genuinely NEW account each call -- `answer()` must really redraw,
        // not treat this as "the caller answered nothing".
        onBuyUpgrade: (u, tr, tier, price) => ({ units: [twoTrack], credits: 999 - price, owned: { [u]: { [tr]: tier } } }),
      });
      // '2' is the board's SECOND track (firepower), not the default-expanded first.
      host.querySelector('.rl-menu--garage')?.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(host.querySelector('.rl-garage__track[data-track="firepower"]')?.getAttribute('data-expanded')).toBe('1');
      expect(document.activeElement?.closest('[data-expanded="0"]')).toBeNull();
      expect(focusKey()).toBe('buy:firepower');
      dispose();
    });

    // Fix round 2 (issue 1, part 2): `restoreFocus`'s own `unit-buy` fallback
    // -- "the first tier Buy the unit now has" -- picks the first `buy:` key
    // in DOCUMENT order, not the first EXPANDED one. A collapsed track's own
    // Buy sits earlier in the board than whichever track the player actually
    // pointed at, so without the `isRendered` filter it wins by pure DOM
    // order even though it is not there to click. This one needs no manual
    // `focusout` -- the unit-level Buy lives in the bay, not inside any
    // track, so nothing here blurs the rung the digit jump focused; the bug
    // is the naive filter itself, not the blur timing fix round 2's first
    // part addresses.
    it('does not let a unit unlock land on a collapsed track’s Buy (fix round 2, issue 1)', () => {
      const roster: BrigadeUnit[] = units.map((u) =>
        u.id === 'breach_team'
          ? {
              ...u,
              unlock: { starsMin: 12, price: 850 },
              upgrades: {
                armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] },
                firepower: { tiers: [{ price: 50, patch: { 'weapons[0].accuracy': 0.05 } }] },
              },
            }
          : u
      );
      const { host, dispose } = mountLive({
        units: roster,
        ledger: {},
        possibleStars: 78,
        credits: 999,
        // Needed only so the tracks draw a real Buy at all once unlocked --
        // a locked track never does (F7), regardless of this callback -- it
        // is never itself invoked by this test.
        onBuyUpgrade: () => undefined,
        onBuy: (unitId, price) => ({
          units: roster.map((u) => (u.id === unitId && u.unlock ? { ...u, unlock: { ...u.unlock, bought: true } } : u)),
          credits: 999 - price,
          owned: {},
        }),
      });
      select(host, 'breach_team');
      // Point at firepower -- the board's SECOND track -- before unlocking.
      host.querySelector('.rl-menu--garage')?.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
      host.querySelector<HTMLButtonElement>('.rl-garage__buy')?.click();
      expect(host.querySelector('.rl-garage__track[data-track="firepower"]')?.getAttribute('data-expanded')).toBe('1');
      expect(focusKey()).toBe('buy:firepower');
      dispose();
    });
  });
});

describe('showBrigade — the bay', () => {
  it('opens on the first unit and follows the card that is clicked', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(text(host, '.rl-garage__name')).toBe('Rifle Squad');
    expect(text(host, '.rl-garage__blurb')).toBe('Holds ground and garrisons buildings.');
    select(host, 'ifv_namer');
    expect(text(host, '.rl-garage__name')).toBe('Namer IFV');
    expect(text(host, '.rl-garage__blurb')).toBe('Carries a squad through fire.');
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('prints a player-facing role label, never the raw role id', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    select(host, 'ifv_namer');
    // F2 minor 4: `ifv` used to print verbatim.
    expect(text(host, '.rl-garage__role')).toBe('fighting vehicle');
  });

  it('falls back to the id with underscores turned to spaces for an unrecognised role', () => {
    const host = mount({
      units: [
        {
          id: 'made_up_unit',
          name: 'Made Up Unit',
          role: 'not_a_real_role',
          isKamikaze: false,
          transportSlots: 0,
          isSoft: false,
        },
      ],
      ledger: {},
      possibleStars: 78,
    });
    expect(text(host, '.rl-garage__role')).toBe('not a real role');
    // `baseOf` knows no such id and hands back a bare `{ id }`: six stat rows,
    // every one an em-dash, and not a throw.
    expect(host.querySelectorAll('.rl-garage__stat')).toHaveLength(6);
    expect([...host.querySelectorAll('.rl-garage__stat-n')].map((n) => n.textContent)).toEqual([
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
    ]);
  });

  it('draws the plate when there is one, and the reserved hatch when there is not', () => {
    const host = mount({
      units,
      ledger: {},
      possibleStars: 78,
      plate: (id) =>
        id === 'inf_squad'
          ? { url: '/ui/plates/units/inf_squad.jpg', size: [1800, 1200], extent: [600, 400] }
          : null,
    });
    expect(host.querySelector('.rl-garage__plate-img')?.getAttribute('src')).toBe('/ui/plates/units/inf_squad.jpg');
    select(host, 'ifv_namer');
    const plate = host.querySelector('.rl-garage__plate');
    expect(plate?.getAttribute('data-noplate')).toBe('1');
    expect(plate?.querySelector('svg')).not.toBeNull();
    expect(plate?.getAttribute('title')).toBe('ifv_namer — no plate photographed');
  });

  // "One unit LARGE in a lit bay": every plate is the same frame at the same
  // camera zoom, so the unit inside it is whatever size it is -- 154 of 1800
  // pixels for a sniper team. Drawn at the plate's own scale that is a speck,
  // which is what the first cut shipped. The bay zooms per unit off the
  // measured footprint.
  it('zooms the plate so the unit fills the bay, not the sand', async () => {
    const { plateFit } = await import('./plate-fit');
    const extents: Record<string, [number, number]> = {
      inf_squad: [280, 196], // a rifle squad: asks for 3.86x, clamped to the ceiling
      ifv_namer: [823, 511], // the widest shipped unit: 1.31x
      breach_team: [1800, 1200], // already fills its plate: no zoom at all
    };
    const host = mount({
      units,
      ledger: {},
      possibleStars: 78,
      plate: (id) => ({ url: `/ui/plates/units/${id}.jpg`, size: [1800, 1200], extent: extents[id] }),
    });
    const zoom = (): string | undefined =>
      host.querySelector('.rl-garage__plate')?.getAttribute('data-zoom') ?? undefined;
    const styled = (): string | undefined =>
      host.querySelector<HTMLElement>('.rl-garage__plate-img')?.style.transform;

    expect(zoom()).toBe('2.5');
    expect(styled()).toBe('scale(2.5)');
    select(host, 'ifv_namer');
    expect(zoom()).toBe('1.31');
    expect(styled()).toBe('scale(1.31)');
    select(host, 'breach_team');
    expect(zoom()).toBe('1');

    // And the numbers on the element are the module's own, not a second
    // arithmetic in the screen.
    for (const [id, extent] of Object.entries(extents)) {
      select(host, id);
      expect(zoom(), id).toBe(String(plateFit(extent, [1800, 1200]).scale));
    }
  });

  it('offers a Buy control on a priced locked unit, disabled below the balance with the shortfall', () => {
    const priced = units.map((u) =>
      u.id === 'breach_team'
        ? { ...u, unlock: { starsMin: 12, price: 600 } }
        : u.id === 'ifv_namer'
          ? { ...u, unlock: { price: 1200 } }
          : u
    );
    const bought: [string, number][] = [];
    const host = mount({
      units: priced,
      ledger: {},
      possibleStars: 78,
      credits: 700,
      onBuy: (id, p) => {
        bought.push([id, p]);
      },
    });
    select(host, 'breach_team');
    const buy = host.querySelector<HTMLButtonElement>('.rl-garage__buy');
    expect(buy?.textContent).toBe('Buy for 600 credits');
    expect(buy?.disabled).toBe(false);
    expect(buy?.getAttribute('aria-label')).toBe('buy Tzinah Breach Team for 600 credits');
    expect(host.querySelector('.rl-garage__short')).toBeNull();
    buy?.click();
    expect(bought).toEqual([['breach_team', 600]]);
    // The wallet is struck on the click that ASKS, and stays struck: the
    // wallet node survives the answer's redraw (F3), so the flash is seen
    // through to its end rather than cut off with a removed node.
    expect(host.querySelector('.rl-garage__wallet')?.classList.contains('rl-garage__wallet--spent')).toBe(true);

    select(host, 'ifv_namer');
    const short = host.querySelector<HTMLButtonElement>('.rl-garage__buy');
    expect(short?.textContent).toBe('Buy for 1200 credits');
    expect(short?.disabled).toBe(true);
    expect(text(host, '.rl-garage__short')).toBe('500 more credits');
    // `.rl-garage__gate` is `gateSentence`'s own rendering, never the sim's raw
    // `unlockReason` string -- ifv_namer here is price-only (D1), so it reads the
    // Buy sentence rather than a requires/Conduct/stars line.
    expect(text(host, '.rl-garage__gate')).toBe('Buy for 1200 credits');
  });

  it('shows no Buy control without an account, and none on an unpriced or open unit', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__buy')).toBeNull();

    // With an account present, and locked (roeMin: 40, unmet) but unpriced:
    // the missing control is because there is no price, not because there is
    // no account.
    const host2 = mount({ units, ledger: {}, possibleStars: 78, credits: 999, onBuy: () => {} });
    select(host2, 'ifv_namer');
    expect(host2.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
    expect(host2.querySelector('.rl-garage__buy')).toBeNull();

    // And an OPEN unit shows neither a gate sentence nor a Buy control.
    const host3 = mount({
      units: units.map((u) => ({ ...u, unlock: { price: 5, bought: true } })),
      ledger: {},
      possibleStars: 78,
      credits: 0,
      onBuy: () => {},
    });
    expect(host3.querySelector('.rl-garage__buy')).toBeNull();
    expect(host3.querySelector('.rl-garage__gate')).toBeNull();
    expect(text(host3, '.rl-garage__card-chip')).toBe('Bought');
  });
});

describe('showBrigade — the board', () => {
  it('draws the six stat rows off the unit as it stands, owned tiers included', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const rows = [...host.querySelectorAll('.rl-garage__stat')].map((r) => [
      r.getAttribute('data-path'),
      r.querySelector('.rl-garage__stat-label')?.textContent,
      r.querySelector('.rl-garage__stat-n')?.textContent,
    ]);
    expect(rows).toEqual([
      ['hull.hp', 'Hit points', '440'], // 400 base + the 40 of armour tier 1
      ['hull.armor.front', 'Front armour', '10'],
      ['hull.armor.side', 'Side armour', '10'],
      ['hull.armor.rear', 'Rear armour', '10'],
      ['sensors.sight_tiles', 'Sight', '8'],
      ['weapons[0].accuracy', 'Accuracy', '60%'],
    ]);
  });

  it('scales each bar against the roster maximum, not the unit’s own', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    const width = (path: string): string =>
      host.querySelector<HTMLElement>(`.rl-garage__stat[data-path="${path}"] .rl-garage__stat-fill`)?.style.width ?? '';
    // inf_squad is 400 hp against the Namer's 2000 -- a fifth of the bar.
    expect(width('hull.hp')).toBe('20%');
    select(host, 'ifv_namer');
    expect(width('hull.hp')).toBe('100%');
  });

  it('prints an em-dash for a stat the unit does not declare', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    select(host, 'breach_team');
    // breach_team ships an empty weapons list, so there is no weapons[0].
    expect(text(host, '.rl-garage__stat[data-path="weapons[0].accuracy"] .rl-garage__stat-n')).toBe('—');
  });

  it('draws one rung per tier, tier 1 last in the DOM, bought rungs marked', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const tracks = host.querySelectorAll('.rl-garage__track');
    expect([...tracks].map((t) => t.getAttribute('data-track'))).toEqual(['armour', 'sensors']);
    const rungs = [...tracks[0].querySelectorAll('.rl-garage__rung')];
    expect(rungs.map((r) => [r.getAttribute('data-tier'), r.getAttribute('data-owned')])).toEqual([
      ['2', '0'],
      ['1', '1'],
    ]);
    expect(rungs[1].querySelector('.rl-garage__rung-tier')?.textContent).toBe('Tier 1');
    expect(rungs[1].querySelector('.rl-garage__rung-price')?.textContent).toBe('200');
    expect(rungs[1].querySelector('.rl-garage__rung-owned')?.textContent).toBe('Owned');
  });

  it('prints the next rung’s lines verbatim from formatBenefit, and the rest one hover away', async () => {
    const { formatBenefit, upgradeBenefits } = await import('./upgrade-benefit');
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    const armour = host.querySelector('.rl-garage__track[data-track="armour"]');
    const lines = (tier: string): string[] =>
      [...(armour?.querySelectorAll(`.rl-garage__rung[data-tier="${tier}"] .rl-garage__benefit`) ?? [])].map((l) => l.textContent ?? '');
    expect(lines('1')).toEqual(['Hit points 400 → 440']); // nothing owned: tier 1 is next
    expect(lines('2')).toEqual([]);
    const unitJson = { ...BASE.inf_squad, upgrades: units[0].upgrades } as never;
    expect(armour?.querySelector('.rl-garage__rung[data-tier="2"]')?.getAttribute('title')).toBe(
      upgradeBenefits(unitJson, 'armour', 2).map(formatBenefit).join('\n')
    );
    expect([...host.querySelectorAll('.rl-garage__track[data-track="sensors"] .rl-garage__benefit')].map((l) => l.textContent)).toEqual([
      'Sight 8 → 9 tiles',
    ]);
  });

  it('previews a rung in the stat panel on hover, and puts it back on leave', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    const hp = (): string | undefined => text(host, '.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-n');
    const delta = (): string =>
      host.querySelector<HTMLElement>('.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-delta')?.style.width ??
      '';
    expect(hp()).toBe('400');
    expect(delta()).toBe('0%');
    const rung = host.querySelector('.rl-garage__track[data-track="armour"] .rl-garage__rung[data-tier="1"]');
    rung?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(hp()).toBe('400 → 440');
    // 40 of a 2000-hp roster maximum.
    expect(delta()).toBe('2%');
    rung?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(hp()).toBe('400');
    expect(delta()).toBe('0%');
  });

  it('sells the next tier per track, enabled with enough credits', () => {
    const bought: [string, string, number, number][] = [];
    const host = mount({
      units,
      ledger: {},
      possibleStars: 78,
      owned: { inf_squad: { armour: 1 } },
      credits: 999,
      onBuyUpgrade: (unitId, track, tier, price) => {
        bought.push([unitId, track, tier, price]);
      },
    });
    const armourBtn = host.querySelector<HTMLButtonElement>(
      '.rl-garage__track[data-track="armour"] .rl-garage__buy-tier'
    );
    expect(armourBtn?.textContent).toBe('Buy tier 2 · 300');
    expect(armourBtn?.disabled).toBe(false);
    // I5's pseudo pass: the track title is catalogue text now
    // (`garage.track.armour`), not the raw JSON key humanised -- and the Buy
    // control's aria-label reads the same label the heading does, so the two
    // cannot say different words for one track.
    expect(armourBtn?.getAttribute('aria-label')).toBe('buy Rifle Squad Armour tier 2 for 300 credits');
    // Exactly one control per track, and it is on the next rung up.
    expect(host.querySelectorAll('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')).toHaveLength(1);
    expect(armourBtn?.closest('.rl-garage__rung')?.getAttribute('data-tier')).toBe('2');
    armourBtn?.click();
    expect(bought).toEqual([['inf_squad', 'armour', 2, 300]]);
    expect(armourBtn?.disabled).toBe(true);

    const sensorBtn = host.querySelector<HTMLButtonElement>(
      '.rl-garage__track[data-track="sensors"] .rl-garage__buy-tier'
    );
    expect(sensorBtn?.textContent).toBe('Buy tier 1 · 150');
  });

  it('disables both controls when the balance is short', () => {
    const host = mount({
      units,
      ledger: {},
      possibleStars: 78,
      owned: { inf_squad: { armour: 1 } },
      credits: 100,
      onBuyUpgrade: () => {},
    });
    const buttons = host.querySelectorAll<HTMLButtonElement>('.rl-garage__buy-tier');
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) expect(btn.disabled).toBe(true);
  });

  it('says "Maxed" instead of a Buy control on a maxed track, and clamps an owned tier above the track length', () => {
    const host = mount({
      units,
      ledger: {},
      possibleStars: 78,
      owned: { inf_squad: { armour: 2, sensors: 1 } },
      credits: 999,
      onBuyUpgrade: () => {},
    });
    const tracks = host.querySelectorAll('.rl-garage__track');
    expect(tracks).toHaveLength(2);
    for (const track of tracks) {
      expect(track.querySelector('.rl-garage__track-max')?.textContent).toBe('Maxed');
      expect(track.querySelector('.rl-garage__buy-tier')).toBeNull();
    }

    // Data may SHRINK a track after a purchase: an owned tier past its length
    // reads as maxed, never as a crash or a phantom rung.
    const host2 = mount({
      units,
      ledger: {},
      possibleStars: 78,
      owned: { inf_squad: { armour: 9 } },
      credits: 999,
      onBuyUpgrade: () => {},
    });
    const armour = host2.querySelector('.rl-garage__track[data-track="armour"]');
    expect(armour?.querySelector('.rl-garage__track-max')?.textContent).toBe('Maxed');
    expect(armour?.querySelectorAll('.rl-garage__rung')).toHaveLength(2);
  });

  it('shows a locked unit’s tracks read-only, tier-1 prices and "Unlock first" (F7)', () => {
    const fixture = units.map((u) =>
      u.id === 'breach_team' ? { ...u, upgrades: { armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] } } } : u
    );
    const host = mount({ units: fixture, ledger: {}, possibleStars: 78, credits: 999, onBuyUpgrade: () => {} });
    select(host, 'breach_team');
    expect(host.querySelector('.rl-garage__track[data-track="armour"]')?.getAttribute('data-locked')).toBe('1');
    expect(text(host, '.rl-garage__track-lock')).toBe('Unlock first');
    expect(host.querySelector('.rl-garage__buy-tier')).toBeNull();
    expect(host.querySelectorAll('.rl-garage__stat')).toHaveLength(6); // still a unit you can read
  });

  it('says where credits come from at zero, and only at zero', () => {
    const at = (credits: number | undefined): string | undefined =>
      text(mount({ units, ledger: {}, possibleStars: 78, credits, onBuyUpgrade: () => {} }), '.rl-garage__empty');
    expect(at(0)).toBe('Credits come from winning missions.');
    expect(at(5)).toBeUndefined();
    expect(at(undefined)).toBeUndefined(); // no account: as today
  });

  it('stamps Maxed on a maxed unit’s plate, and not on one at level 2 still for sale', () => {
    const maxed = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 2, sensors: 1 } } });
    expect(text(maxed, '.rl-garage__plate-maxed')).toBe('Maxed');
    const two = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 2 } } });
    expect(two.querySelector('.rl-garage__plate')?.getAttribute('data-kit')).toBe('2');
    expect(two.querySelector('.rl-garage__plate-maxed')).toBeNull();
  });

  // Controller ruling T8: the brief's own falsification ("stamp Maxed on
  // `kit.level === 3`") cannot go red against the fixture above, because
  // `inf_squad` there has exactly 3 tiers across its two tracks (armour 2 +
  // sensors 1) -- level 3 and fully-bought coincide, so a level-gated stamp
  // reads no differently from a maxed-gated one. `kitLevel`'s own doc names
  // the case that pulls them apart: 7 of 9 tiers already reads as the top
  // third. Four tiers, three owned, does it in miniature -- `ceil(3*3/4) = 3`
  // is level 3, and 3 of 4 is not everything.
  it('does not stamp Maxed at kit level 3 alone -- level and "everything owned" are different questions (R-11)', () => {
    const fixture = units.map((u) =>
      u.id === 'inf_squad'
        ? {
            ...u,
            upgrades: {
              armour: {
                tiers: [
                  { price: 100, patch: { 'hull.hp': 10 } },
                  { price: 100, patch: { 'hull.hp': 10 } },
                  { price: 100, patch: { 'hull.hp': 10 } },
                  { price: 100, patch: { 'hull.hp': 10 } },
                ],
              },
            },
          }
        : u
    );
    const host = mount({ units: fixture, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 3 } } });
    expect(host.querySelector('.rl-garage__plate')?.getAttribute('data-kit')).toBe('3');
    expect(host.querySelector('.rl-garage__plate-maxed')).toBeNull();
  });

  it('renders the rungs read-only, with no Buy or Maxed control, without credits/onBuyUpgrade', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelectorAll('.rl-garage__track')).toHaveLength(2);
    expect(host.querySelector('.rl-garage__buy-tier')).toBeNull();
    expect(host.querySelector('.rl-garage__track-max')).toBeNull();
  });

  it('renders an underscored track name with spaces, in the label and the aria-label', () => {
    const fixture = units.map((u) =>
      u.id === 'inf_squad'
        ? { ...u, upgrades: { fire_control: { tiers: [{ price: 100, patch: { 'weapons[0].accuracy': 0.05 } }] } } }
        : u
    );
    const bought: [string, string, number, number][] = [];
    const host = mount({
      units: fixture,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      onBuyUpgrade: (unitId, track, tier, price) => {
        bought.push([unitId, track, tier, price]);
      },
    });
    const track = host.querySelector('.rl-garage__track');
    expect(track?.getAttribute('data-track')).toBe('fire_control');
    expect(track?.querySelector('.rl-garage__track-name')?.textContent).toBe('fire control');
    const btn = track?.querySelector<HTMLButtonElement>('.rl-garage__buy-tier');
    expect(btn?.getAttribute('aria-label')).toBe('buy Rifle Squad fire control tier 1 for 100 credits');
    btn?.click();
    // The RAW key still goes to the callback.
    expect(bought).toEqual([['inf_squad', 'fire_control', 1, 100]]);
  });
});

describe('showBrigade — the wallet and the footer', () => {
  it('prints the balance in the wallet and asks twice before resetting the account', () => {
    let resets = 0;
    const host = mount({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 460,
      onReset: () => {
        resets++;
      },
    });
    expect(text(host, '.rl-garage__wallet-n')).toBe('460');
    expect(text(host, '.rl-garage__wallet-word')).toBe('credits');
    const btn = host.querySelector<HTMLButtonElement>('.rl-garage__reset');
    expect(btn?.textContent).toBe('reset brigade account');
    btn?.click();
    expect(resets).toBe(0);
    expect(btn?.textContent).toBe('click again to reset — this cannot be undone');
    btn?.click();
    expect(resets).toBe(1);
    // The second click is the last one this control can fire: disabled before
    // the handler ran, so a third click on the same button reaches nothing.
    expect(btn?.disabled).toBe(true);
    btn?.click();
    expect(resets).toBe(1);
  });

  it('pluralises the wallet word down to one credit', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, credits: 1 });
    expect(text(host, '.rl-garage__wallet-word')).toBe('credit');
  });

  it('prints no wallet and no reset control without an account', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__wallet')).toBeNull();
    expect(host.querySelector('.rl-garage__reset')).toBeNull();
  });
});

describe('the garage type floor', () => {
  // The screen's own reading ladder is five tokens declared on
  // `.rl-menu--garage` (theme.css), and `--t-small` is the floor. jsdom
  // computes no stylesheet, so this reads the rules back off disk: every
  // `font-size` inside a `.rl-garage`/`.rl-menu--garage` rule must name one
  // of the five, which is what stops a later rule quietly re-introducing the
  // 0.6875rem the old brigade list set its reason text in.
  //
  // Falsified by hand: pointing `.rl-garage__benefit`'s `font-size` at
  // `var(--t-s)` fails, naming that rule.
  it('sets every size on the screen from the five reading-ladder tokens', () => {
    // From the vitest root (this project's `vitest.config.ts` sets none, so it
    // is the repo root, where `pnpm test` runs) -- not from `import.meta.url`,
    // which under the jsdom environment is an http: URL and not a file path.
    const css = readFileSync(resolve(process.cwd(), 'packages/app/src/ui/theme.css'), 'utf8');
    const allowed = new Set(['--t-title', '--t-h2', '--t-h3', '--t-body', '--t-small']);
    const offenders: string[] = [];
    let seen = 0;
    // Rule by rule: `selector { body }`. The body pattern excludes braces, so
    // a media query's own wrapper never matches and its inner rules do.
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!/\.rl-garage|\.rl-menu--garage/.test(selector)) continue;
      for (const decl of rule[2].matchAll(/font-size\s*:\s*([^;]+);/g)) {
        seen++;
        const named = /var\(\s*(--[\w-]+)/.exec(decl[1]);
        if (named === null || !allowed.has(named[1])) offenders.push(`${selector}: ${decl[1].trim()}`);
      }
    }
    // A scan that matched no rule at all would report zero offenders forever.
    expect(seen).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

});
// I5's pseudo pass (final review). The garage's three track headings were the
// raw JSON key with underscores turned to spaces -- "ARMOUR", "FIREPOWER",
// "SENSORS" -- so they stayed English in every locale and came back
// UNBRACKETED under `?pseudo=1`, on the newest and most text-dense screen in
// the phase. `validate_i18n.mjs` cannot see it: the value reaches the sink
// through a variable, blind spot #2 in that validator's own header, which is
// why a human looking at a pseudo capture is still the instrument that found
// it.
describe('the garage track headings', () => {
  it('are catalogue text, not the raw upgrade key', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: {}, credits: 0 });
    const heads = [...host.querySelectorAll('.rl-garage__track')].map((el) => ({
      key: el.getAttribute('data-track'),
      text: el.querySelector('.rl-garage__track-name')?.textContent ?? '',
    }));
    expect(heads.length).toBeGreaterThan(0); // vacuity guard: a unit with no tracks proves nothing
    for (const h of heads) {
      expect(h.text).not.toBe(h.key);
      expect(h.text).toBe(t(`garage.track.${h.key ?? ''}`));
    }
    // The three that ship, spelled out -- so a catalogue entry quietly renamed
    // or deleted (which `t()` answers with the key itself) is caught by name
    // rather than by the loop above agreeing with itself.
    expect(heads.map((h) => h.text)).toContain('Armour');
  });

  it('falls back to the humanised key for a track the catalogue has not caught up with', () => {
    const host = mount({
      units: [{ ...units[0], upgrades: { fire_control: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] } } }],
      ledger: {},
      possibleStars: 78,
      owned: {},
      credits: 0,
    });
    const head = host.querySelector('.rl-garage__track[data-track="fire_control"] .rl-garage__track-name');
    // Not `garage.track.fire_control` -- `t()` returns a missing key as itself,
    // and a heading reading like a dotted identifier is worse than an English
    // word a translator has not reached yet.
    expect(head?.textContent).toBe('fire control');
  });
});

const entry = (slot: number): RosterEntry => ({ type: 'inf_squad', veterancy: 0, slot });

describe('the brigade line — the cap and who is stood down', () => {
  // R-5: it renders on a fresh campaign too. A sentence that only appears once
  // the cap has been reached is a sentence `pnpm ui:shots` never photographs and
  // `--pseudo` never checks, and a rule the player meets for the first time by
  // breaking it.
  it('says how many places the brigade has, even with an empty roster', () => {
    const host = mount({ ledger: {} });
    expect(text(host, '.rl-garage__campaign')).toContain(`0 of its ${ROSTER_CAP} places`);
  });

  it('counts the active roster, not the whole population', () => {
    const host = mount({ ledger: { 'roster.surviving_units': [entry(1), entry(2)], 'roster.reserve': [entry(3)] } });
    expect(text(host, '.rl-garage__campaign')).toContain(`2 of its ${ROSTER_CAP} places`);
  });

  it('adds the stood-down clause only when somebody is', () => {
    const host1 = mount({ ledger: { 'roster.surviving_units': [entry(1)] } });
    expect(text(host1, '.rl-garage__campaign')).not.toContain('stood down');
    const host2 = mount({ ledger: { 'roster.surviving_units': [entry(1)], 'roster.reserve': [entry(2), entry(3)] } });
    expect(text(host2, '.rl-garage__campaign')).toContain('2 units are stood down');
  });

  it('pluralises one', () => {
    const host = mount({ ledger: { 'roster.surviving_units': [entry(1)], 'roster.reserve': [entry(2)] } });
    expect(text(host, '.rl-garage__campaign')).toContain('1 unit is stood down');
  });

  // The collision the research brief named: two different "reserve"s in one
  // session, meaning two different things to the same player. The deploy screen
  // keeps `{n} in reserve` for what a mission did not draw; this screen must not
  // borrow the phrase.
  it("does not use the deploy screen's word for a different idea", () => {
    const host = mount({ ledger: { 'roster.surviving_units': [entry(1)], 'roster.reserve': [entry(2)] } });
    expect(text(host, '.rl-garage__campaign')).not.toContain('in reserve');
  });
});
/** Mounted IN the document, which `focus()` needs; disposes and detaches. */
function mountLive(opts: Partial<BrigadeOptions>): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = showBrigade(host, { missionName: noMissionNames, baseOf, units: [], ...opts } as BrigadeOptions);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

const focusKey = (): string | null => document.activeElement?.getAttribute('data-focus-key') ?? null;

describe('showBrigade — a purchase re-renders in place (F3)', () => {
  it('keeps the screen, the tab, the unit and focus on the same track’s next Buy', () => {
    let owned: Record<string, Record<string, number>> = {};
    let credits = 999;
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits,
      owned,
      onBuyUpgrade: (unitId, track, tier, price) => {
        owned = { ...owned, [unitId]: { ...(owned[unitId] ?? {}), [track]: tier } };
        credits -= price;
        return { units, credits, owned };
      },
    });
    const screen = host.querySelector('.rl-menu--garage');
    host.querySelector<HTMLButtonElement>('.rl-garage__tab[data-bucket="soft"]')?.click();
    const rail = host.querySelector<HTMLElement>('.rl-garage__cards');
    if (rail) rail.scrollTop = 40; // jsdom does not clamp; ui:routes (Task 4) is this line's falsification
    host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')?.click();

    expect(host.querySelector('.rl-menu--garage')).toBe(screen);
    expect(host.querySelector('.rl-garage__tab[aria-selected="true"]')?.getAttribute('data-bucket')).toBe('soft');
    expect(host.querySelector('.rl-garage__card[aria-selected="true"]')?.getAttribute('data-unit')).toBe('inf_squad');
    expect(host.querySelector<HTMLElement>('.rl-garage__cards')?.scrollTop).toBe(40);
    expect(host.querySelector<HTMLElement>('.rl-garage__wallet-n')?.dataset.value).toBe('799');
    const next = host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier');
    expect(next?.textContent).toBe('Buy tier 2 · 300');
    expect(document.activeElement).toBe(next);
    dispose();
  });

  it('keeps the unit that was bought in the bay (F3: an at_team buy landed on the Lavi)', () => {
    const roster: BrigadeUnit[] = units.map((u) =>
      u.id === 'breach_team' ? { ...u, unlock: { starsMin: 12, price: 850 } } : u
    );
    const { host, dispose } = mountLive({
      units: roster,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      onBuy: (unitId) => ({
        units: roster.map((u) => (u.id === unitId && u.unlock ? { ...u, unlock: { ...u.unlock, bought: true } } : u)),
        credits: 149,
        owned: {},
      }),
    });
    select(host, 'breach_team');
    host.querySelector<HTMLButtonElement>('.rl-garage__buy')?.click();
    expect(host.querySelector('.rl-garage__card[aria-selected="true"]')?.getAttribute('data-unit')).toBe('breach_team');
    expect(host.querySelector('.rl-garage__card[data-unit="breach_team"]')?.getAttribute('data-locked')).toBe('0');
    expect(host.querySelector('.rl-garage__buy')).toBeNull();
    // No unit Buy any more and no tracks on this fixture: focus lands on its own card.
    expect(focusKey()).toBe('card:breach_team');
    dispose();
  });

  it('never sends focus to a card the tab has hidden (review, fix round 1)', () => {
    const roster: BrigadeUnit[] = units.map((u) =>
      u.id === 'breach_team' ? { ...u, unlock: { starsMin: 12, price: 850 } } : u
    );
    const { host, dispose } = mountLive({
      units: roster,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      onBuy: (unitId) => ({
        units: roster.map((u) => (u.id === unitId && u.unlock ? { ...u, unlock: { ...u.unlock, bought: true } } : u)),
        credits: 149,
        owned: {},
      }),
    });
    select(host, 'breach_team');
    // `transport` holds only the Namer: the bay keeps the breach team, its
    // card is hidden, and the breach team has no tracks to catch focus.
    host.querySelector<HTMLButtonElement>('.rl-garage__tab[data-bucket="transport"]')?.click();
    expect(host.querySelector<HTMLElement>('.rl-garage__card[data-unit="breach_team"]')?.hidden).toBe(true);
    host.querySelector<HTMLButtonElement>('.rl-garage__buy')?.click();
    const at = document.activeElement;
    expect(at).not.toBe(document.body);
    expect(at?.closest('[hidden]')).toBeNull();
    // The tab the player is on: the nearest visible thing to where they were.
    expect(focusKey()).toBe('tab:transport');
    dispose();
  });

  it('re-renders a refused purchase off the caller’s answer, with the Buy live again', () => {
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      owned: {},
      onBuyUpgrade: () => ({ units, credits: 999, owned: {} }), // the store refused: nothing moved
    });
    const buy = (): HTMLButtonElement | null =>
      host.querySelector('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier');
    buy()?.click();
    expect(buy()?.textContent).toBe('Buy tier 1 · 200');
    expect(buy()?.disabled).toBe(false);
    dispose();
  });

  it('leaves the screen as it was when the callback answers nothing (a legacy caller)', () => {
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      onBuyUpgrade: () => undefined,
    });
    const buy = host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier');
    buy?.click();
    expect(host.querySelector('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')).toBe(buy);
    expect(buy?.disabled).toBe(true);
    dispose();
  });

  it('answers the reset in place too', () => {
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 500,
      owned: { inf_squad: { armour: 1 } },
      onReset: () => ({ units, credits: 0, owned: {} }),
    });
    const screen = host.querySelector('.rl-menu--garage');
    const reset = (): HTMLButtonElement | null => host.querySelector('.rl-garage__reset');
    reset()?.click();
    reset()?.click();
    expect(host.querySelector('.rl-menu--garage')).toBe(screen);
    expect(host.querySelector<HTMLElement>('.rl-garage__wallet-n')?.dataset.value).toBe('0');
    expect(host.querySelector('.rl-garage__rung[data-owned="1"]')).toBeNull();
    expect(reset()?.textContent).toBe('reset brigade account');
    expect(reset()?.disabled).toBe(false);
    dispose();
  });
});

describe('the rail card — status and kit (WP-S3g §3.1, F1)', () => {
  const four: BrigadeUnit[] = [
    units[0], // inf_squad: no gate -> Earned
    { ...units[1], unlock: { roeMin: 40, price: 520, bought: true } }, // bought, no tracks -> Bought
    {
      ...units[1],
      id: 'namer_kitted',
      name: 'Namer (kitted)',
      unlock: { roeMin: 40, price: 520, bought: true },
      upgrades: { armour: { tiers: [{ price: 250, patch: { 'hull.hp': 154 } }] } },
    }, // bought and every tier owned -> Maxed
    units[2], // breach_team: locked by stars
  ];
  const read = (host: HTMLElement, id: string): [string | undefined, string | null | undefined] => [
    text(host, `.rl-garage__card[data-unit="${id}"] .rl-garage__card-chip`),
    host.querySelector(`.rl-garage__card[data-unit="${id}"]`)?.getAttribute('data-status'),
  ];

  it('says Earned, Bought or Maxed where it used to say Owned', () => {
    const host = mount({ units: four, ledger: {}, possibleStars: 78, owned: { namer_kitted: { armour: 1 } } });
    expect(read(host, 'inf_squad')).toEqual(['Earned', 'earned']);
    expect(read(host, 'ifv_namer')).toEqual(['Bought', 'bought']);
    expect(read(host, 'namer_kitted')).toEqual(['Maxed', 'maxed']);
    expect(read(host, 'breach_team')).toEqual(['Locked · 12★', 'locked']);
  });

  it('draws a pip column per track, filled from the account', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const col = (track: string): Element | null =>
      host.querySelector(`.rl-garage__card[data-unit="inf_squad"] .rl-kit-pips__col[data-track="${track}"]`);
    const count = (track: string, sel: string): number => col(track)?.querySelectorAll(sel).length ?? -1;
    expect([count('armour', '[data-on="1"]'), count('armour', '.rl-kit-pips__pip')]).toEqual([1, 2]);
    expect([count('sensors', '[data-on="1"]'), count('sensors', '.rl-kit-pips__pip')]).toEqual([0, 1]);
    expect(count('firepower', '.rl-kit-pips__pip')).toBe(0); // the fixture has no firepower track
    expect(host.querySelector('.rl-garage__card[data-unit="inf_squad"]')?.getAttribute('data-kit')).toBe('1');
  });

  it('draws no pips on a card whose unit has no tracks', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"] .rl-kit-pips')).toBeNull();
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('data-kit')).toBe('0');
  });

  it('fills the new pip when a tier is bought in place', () => {
    let owned: Record<string, Record<string, number>> = {};
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      owned,
      onBuyUpgrade: (id, track, tier) => {
        owned = { [id]: { [track]: tier } };
        return { units, credits: 799, owned };
      },
    });
    host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')?.click();
    expect(
      host.querySelectorAll('.rl-garage__card[data-unit="inf_squad"] .rl-kit-pips__col[data-track="armour"] [data-on="1"]')
    ).toHaveLength(1);
    dispose();
  });
});

describe('showBrigade — the bay carries the kit (§3.1, F4, F5)', () => {
  it('moves the stat panel into the bay, straight under the name and role', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__bay .rl-garage__stats')).not.toBeNull();
    expect(host.querySelector('.rl-garage__board .rl-garage__stats')).toBeNull();
    const kids = [...(host.querySelector('.rl-garage__bay')?.children ?? [])].map((e) => e.classList[0]);
    expect(kids.indexOf('rl-garage__stats')).toBe(kids.indexOf('rl-garage__role') + 1);
  });
  it('frames a kitted plate in steel and marks it with the level', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    expect(host.querySelector('.rl-garage__plate')?.getAttribute('data-kit')).toBe('1');
    expect(host.querySelector('.rl-garage__plate .rl-garage__plate-kit svg')).not.toBeNull();
    expect(text(host, '.rl-garage__plate-kit-label')).toBe('Kit I');
  });
  it('leaves an unkitted plate as it was', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__plate')?.getAttribute('data-kit')).toBe('0');
    expect(host.querySelector('.rl-garage__plate-kit')).toBeNull();
    expect(host.querySelector('.rl-garage__kit-total')).toBeNull();
  });
  it('says what the kit on this unit cost', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1, sensors: 1 } } });
    expect(text(host, '.rl-garage__kit-total')).toBe('350 credits of kit');
  });
  // R-5: against a base-JSON maximum, the roster's strongest unit fills its
  // bar with base and has no room left to draw what it bought.
  it('leaves the roster’s strongest unit room to draw its kit', () => {
    const host = mount({ units: [units[0]], ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const kit = host.querySelector<HTMLElement>('.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-kit');
    expect(kit?.style.width).not.toBe('0%'); // 40 of a fully kitted 480
  });
  it('previews nothing over a rung already owned, and the next one from what is owned (F5)', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const hp = (): string | undefined => text(host, '.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-n');
    const rung = (tier: number): Element | null =>
      host.querySelector(`.rl-garage__track[data-track="armour"] .rl-garage__rung[data-tier="${tier}"]`);
    rung(1)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(hp()).toBe('440');
    rung(2)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(hp()).toBe('440 → 480');
  });
  // R-6, exercised at the call site: hovering an already-owned rung BELOW the
  // one just bought must still preview nothing -- the case
  // `garage-stats.test.ts`'s own tier-equals-owned assertion cannot catch,
  // because `trackPatchAt(spec, owned)` diffed against itself is trivially
  // zero regardless of the guard. Two tiers owned here, hovering the lower
  // one, is what actually depends on the `tier <= owned` check.
  it('previews nothing over an owned rung below the top of what is owned (R-6, F5)', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 2 } } });
    const hp = (): string | undefined => text(host, '.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-n');
    const rung1 = host.querySelector('.rl-garage__track[data-track="armour"] .rl-garage__rung[data-tier="1"]');
    expect(hp()).toBe('480'); // 400 base + tier 2's own cumulative +80
    rung1?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(hp()).toBe('480');
  });
});

describe('showBrigade — a purchase is an event (§3.5)', () => {
  function buyer(over: Partial<BrigadeOptions> = {}): { host: HTMLElement; dispose: () => void; cues: string[] } {
    const cues: string[] = [];
    let owned: Record<string, Record<string, number>> = {};
    const live = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      owned,
      reducedMotion: () => true,
      onCue: (c) => void cues.push(c),
      onBuyUpgrade: (id, track, tier) => {
        owned = { [id]: { [track]: tier } };
        return { units, credits: 799, owned };
      },
      ...over,
    });
    return { ...live, cues };
  }
  const buyArmour = (host: HTMLElement): void =>
    host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')?.click();

  it('cues an upgrade once, only when it landed, and stamps its rung and its pip', () => {
    const { host, dispose, cues } = buyer();
    buyArmour(host);
    expect(cues).toEqual(['upgrade']);
    expect(host.querySelector('.rl-garage__rung[data-tier="1"]')?.classList.contains('rl-garage__rung--stamp')).toBe(true);
    const pip = host.querySelector(
      '.rl-garage__card[data-unit="inf_squad"] .rl-kit-pips__col[data-track="armour"] .rl-kit-pips__pip'
    );
    expect(pip?.classList.contains('rl-kit-pips__pip--new')).toBe(true);
    dispose();
  });

  // Controller ruling (T10): the mark is stamped on EVERY landed purchase,
  // not only one that moves the kit level. Six tiers, so one owned and two
  // owned both read level 1 (`ceil(3 * owned / available)`): the purchase
  // below leaves the level exactly where it was, and must stamp anyway.
  it('stamps the plate’s kit mark on every purchase, level change or not', () => {
    const tier = (hp: number): { price: number; patch: Record<string, number> } => ({ price: 100, patch: { 'hull.hp': hp } });
    const six: BrigadeUnit[] = [
      { ...units[0], upgrades: { armour: { tiers: [tier(10), tier(20), tier(30), tier(40), tier(50), tier(60)] } } },
    ];
    let owned: Record<string, Record<string, number>> = { inf_squad: { armour: 1 } };
    const { host, dispose } = buyer({
      units: six,
      owned,
      onBuyUpgrade: (id, track, n) => {
        owned = { [id]: { [track]: n } };
        return { units: six, credits: 899, owned };
      },
    });
    const level = (): string | null | undefined => host.querySelector('.rl-garage__plate')?.getAttribute('data-kit');
    expect(level()).toBe('1');
    buyArmour(host); // armour 1 -> 2 of 6: still level 1
    expect(level()).toBe('1');
    expect(host.querySelector('.rl-garage__plate-kit')?.classList.contains('rl-garage__plate-kit--stamp')).toBe(true);
    dispose();
  });

  it('stays silent and unstamped when the store refused', () => {
    const { host, dispose, cues } = buyer({ onBuyUpgrade: () => ({ units, credits: 999, owned: {} }) });
    buyArmour(host);
    expect(cues).toEqual([]);
    expect(host.querySelector('.rl-garage__rung--stamp')).toBeNull();
    dispose();
  });

  it('cues a unit purchase as a purchase, and stamps Enlisted on the plate', () => {
    const roster: BrigadeUnit[] = units.map((u) =>
      u.id === 'breach_team' ? { ...u, unlock: { starsMin: 12, price: 850 } } : u
    );
    const { host, dispose, cues } = buyer({
      units: roster,
      onBuy: (unitId) => ({
        units: roster.map((u) => (u.id === unitId && u.unlock ? { ...u, unlock: { ...u.unlock, bought: true } } : u)),
        credits: 149,
        owned: {},
      }),
    });
    select(host, 'breach_team');
    host.querySelector<HTMLButtonElement>('.rl-garage__buy')?.click();
    expect(cues).toEqual(['purchase']);
    expect(text(host, '.rl-garage__stamp')).toBe('Enlisted');
    dispose();
  });

  it('steps the wallet at once under reduced motion', () => {
    const { host, dispose } = buyer();
    buyArmour(host);
    expect(text(host, '.rl-garage__wallet-n')).toBe('799');
    dispose();
  });

  it('counts the wallet down over 400 ms, landing exactly on the balance', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const { host, dispose } = buyer({ reducedMotion: () => false });
      buyArmour(host);
      const n = (): number => Number(text(host, '.rl-garage__wallet-n'));
      expect(n()).toBe(999);
      vi.advanceTimersByTime(200);
      expect(n()).toBeLessThan(999);
      expect(n()).toBeGreaterThan(799);
      vi.advanceTimersByTime(400);
      expect(n()).toBe(799);
      expect(host.querySelector<HTMLElement>('.rl-garage__wallet-n')?.dataset.value).toBe('799');
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  // Controller ruling (T10): cleared just before `dispose()` and counted
  // exactly, so this goes red when the DISPOSER's own cancel is removed --
  // `countWallet`'s cancel on the way in would otherwise satisfy a bare
  // `toHaveBeenCalled()` by itself. The timer count is the other half: a
  // stamp's or the spend flash's timeout left pending would reach a node
  // this screen no longer owns.
  it('stops counting when the screen is left', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    try {
      const { host, dispose } = buyer({ reducedMotion: () => false });
      buyArmour(host);
      vi.advanceTimersByTime(50); // mid-count
      cancel.mockClear();
      dispose();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    } finally {
      cancel.mockRestore();
      vi.useRealTimers();
    }
  });

  // A count in flight is headed for the OLD answer; the next answer -- here a
  // reset, back to 999 -- must stop it, or it keeps writing 799 over the
  // figure the reset just set.
  it('stops a count in flight when the next answer lands', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const { host, dispose } = buyer({ reducedMotion: () => false, onReset: () => ({ units, credits: 999, owned: {} }) });
      buyArmour(host);
      vi.advanceTimersByTime(100);
      const reset = host.querySelector<HTMLButtonElement>('.rl-garage__reset');
      reset?.click();
      reset?.click();
      vi.advanceTimersByTime(600);
      expect(text(host, '.rl-garage__wallet-n')).toBe('999');
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  // §3.5: the bars grow old -> new, and only under the grow class -- which a
  // purchase adds and a selection change never does.
  it('grows the bought stat from its old width, under a class the selection never sets', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const { host, dispose } = buyer({ reducedMotion: () => false });
      const kit = (): string | undefined =>
        host.querySelector<HTMLElement>('.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-kit')?.style.width;
      const stats = (): Element | null => host.querySelector('.rl-garage__stats');
      expect(kit()).toBe('0%');
      buyArmour(host);
      expect(stats()?.classList.contains('rl-garage__stats--grow')).toBe(true);
      expect(kit()).not.toBe('0%'); // the NEW width, written last
      vi.advanceTimersByTime(300);
      expect(stats()?.classList.contains('rl-garage__stats--grow')).toBe(false);
      select(host, 'ifv_namer');
      expect(stats()?.classList.contains('rl-garage__stats--grow')).toBe(false);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
