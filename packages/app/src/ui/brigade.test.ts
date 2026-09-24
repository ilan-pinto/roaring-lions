// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    expect(text(host, '.rl-garage__card[data-unit="ifv_namer"] .rl-garage__card-chip')).toBe('Owned');
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

  it('moves focus down the rail on an arrow, without changing the selection', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    document.body.appendChild(host);
    const first = host.querySelector<HTMLButtonElement>('.rl-garage__card[data-unit="inf_squad"]');
    first?.focus();
    host
      .querySelector('.rl-garage__cards')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.getAttribute('data-unit')).toBe('ifv_namer');
    // Focus moved; the bay did not.
    expect(text(host, '.rl-garage__name')).toBe('Rifle Squad');
    expect(first?.getAttribute('aria-selected')).toBe('true');
    host.remove();
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
    expect(text(host3, '.rl-garage__card-chip')).toBe('Owned');
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

  it('prints every rung’s benefit lines verbatim from formatBenefit', async () => {
    const { formatBenefit, upgradeBenefits } = await import('./upgrade-benefit');
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    const armour = host.querySelector('.rl-garage__track[data-track="armour"]');
    const lines = (tier: string): string[] =>
      [...(armour?.querySelectorAll(`.rl-garage__rung[data-tier="${tier}"] .rl-garage__benefit`) ?? [])].map(
        (l) => l.textContent ?? ''
      );
    // Cumulative patches: tier 2 reads 440 -> 480, not 400 -> 480.
    expect(lines('1')).toEqual(['Hit points 400 → 440']);
    expect(lines('2')).toEqual(['Hit points 440 → 480']);
    // And the strings on screen are the module's own, not a second spelling.
    const unitJson = { ...BASE.inf_squad, upgrades: units[0].upgrades } as never;
    expect(lines('2')).toEqual(upgradeBenefits(unitJson, 'armour', 2).map(formatBenefit));
    expect([...host.querySelectorAll('.rl-garage__track[data-track="sensors"] .rl-garage__benefit')].map(
      (l) => l.textContent
    )).toEqual(['Sight 8 → 9 tiles']);
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

  it('renders no board rungs at all on a locked unit', () => {
    const fixture = units.map((u) =>
      u.id === 'breach_team'
        ? { ...u, upgrades: { armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] } } }
        : u
    );
    const host = mount({ units: fixture, ledger: {}, possibleStars: 78, credits: 999, onBuyUpgrade: () => {} });
    select(host, 'breach_team');
    expect(host.querySelector('.rl-garage__track')).toBeNull();
    // The stat panel still draws -- a locked unit is still a unit you can read.
    expect(host.querySelectorAll('.rl-garage__stat')).toHaveLength(6);
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
