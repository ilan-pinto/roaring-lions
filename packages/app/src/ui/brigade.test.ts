// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showBrigade } from './brigade';

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

describe('showBrigade', () => {
  it('shows the star total and Conduct, and every unit with what opens it', () => {
    const host = document.createElement('div');
    showBrigade(host, {
      units,
      ledger: { 'campaign.mission_results': { a: { stars: 2, roe: 90, ticks: 1, lost: 0 } }, 'roe.mission_ratings': { a: 90 } },
      missionName: noMissionNames,
      possibleStars: 78,
    });
    expect(host.querySelector('.rl-brigade__stars')?.textContent).toBe('2 of 78 stars');
    expect(host.querySelector('.rl-brigade__conduct')?.textContent).toBe('Conduct 90');
    const rows = [...host.querySelectorAll('[data-unit]')].map((r) => r.getAttribute('data-unit'));
    expect(rows).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('0');
    expect(host.querySelector('[data-unit="breach_team"] .rl-brigade__why')?.textContent).toBe('Needs 12 stars (you have 2)');
    expect(host.querySelector('[data-unit="breach_team"] .rl-brigade__gate')?.textContent).toBe('★ 12');
  });

  it('reads a fresh campaign honestly, and speaks a Conduct gate as a sentence, never a bare number', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, missionName: noMissionNames, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__stars')?.textContent).toBe('0 of 78 stars');
    expect(host.querySelector('.rl-brigade__conduct')?.textContent).toBe('no missions rated yet');
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
    // ifv_namer's gate is `{ roeMin: 40 }`: the row names what it needs, never
    // the sim's own "requires campaign Conduct 40 (no missions rated yet)".
    expect(host.querySelector('[data-unit="ifv_namer"] .rl-brigade__why')?.textContent).toBe(
      'Needs a campaign Conduct of 40 or better'
    );
  });

  it('sorts on the exact Conduct predicate, not a rounded mean', () => {
    // Exact sum 79 over two ratings is short of a 40 floor (79 < 80): still
    // locked. The ROUNDED mean (79 / 2 = 39.5 -> 40) would read as clearing
    // it, which would misfile ifv_namer as a mission-gated row (sorted last)
    // instead of a Conduct-gated one (sorted before a stars gate).
    const host = document.createElement('div');
    showBrigade(host, {
      units,
      ledger: { 'roe.mission_ratings': { a: 39, b: 40 } },
      missionName: noMissionNames,
      possibleStars: 78,
    });
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
    const rows = [...host.querySelectorAll('[data-unit]')].map((r) => r.getAttribute('data-unit'));
    expect(rows).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
  });

  it('prints a player-facing role label, never the raw role id', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, missionName: noMissionNames, possibleStars: 78 });
    // F2 minor 4: `ifv` used to print verbatim.
    expect(host.querySelector('[data-unit="ifv_namer"] .rl-brigade__role')?.textContent).toBe('fighting vehicle');
    expect(host.querySelector('[data-unit="ifv_namer"] .rl-brigade__role')?.textContent).not.toBe('ifv');
  });

  it('falls back to the id with underscores turned to spaces for an unrecognised role', () => {
    const host = document.createElement('div');
    showBrigade(host, {
      units: [
        { id: 'made_up_unit', name: 'Made Up Unit', role: 'not_a_real_role', isKamikaze: false, transportSlots: 0, isSoft: false },
      ],
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
    });
    expect(host.querySelector('[data-unit="made_up_unit"] .rl-brigade__role')?.textContent).toBe('not a real role');
  });

  it('draws a unit with no portrait as the HUD hatch with a role mark, never a bare hatch', () => {
    // No `portrait` resolver at all -- the case a type with no sheet hits
    // for real (`civilians` today; the three star-gated units until their
    // sheets landed), and the case every unit hits when its manifest fails
    // to fetch, since main.ts's portrait lookup only ever resolves a sprite
    // sheet URL.
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, missionName: noMissionNames, possibleStars: 78 });
    const art = host.querySelector('[data-unit="breach_team"] .rl-brigade__art');
    expect(art?.getAttribute('data-nosprite')).toBe('1');
    expect(art?.querySelector('svg')).not.toBeNull();
  });

  it('prints the credit balance in the header and asks twice before resetting the account', () => {
    const host = document.createElement('div');
    let resets = 0;
    showBrigade(host, {
      units,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      credits: 460,
      onReset: () => resets++,
    });
    expect(host.querySelector('.rl-brigade__credits')?.textContent).toBe('460 credits');
    const btn = host.querySelector<HTMLButtonElement>('.rl-brigade__reset');
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

  it('prints no credits line and no reset control without an account', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, missionName: noMissionNames, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__credits')).toBeNull();
    expect(host.querySelector('.rl-brigade__reset')).toBeNull();
  });

  // The brief's own version of this test names `mbt_lavi` for the price-only row; this
  // fixture has no such id, so `ifv_namer` (otherwise unused here beyond its `roeMin`
  // gate) stands in for it. Assertions are otherwise identical to the brief.
  it('offers a Buy control on a priced locked row, disabled when the balance is short', () => {
    const host = document.createElement('div');
    const priced = units.map((u) =>
      u.id === 'breach_team' ? { ...u, unlock: { starsMin: 12, price: 600 } } : u.id === 'ifv_namer' ? { ...u, unlock: { price: 1200 } } : u
    );
    const bought: [string, number][] = [];
    showBrigade(host, {
      units: priced,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      credits: 700,
      onBuy: (id, p) => bought.push([id, p]),
    });
    const breach = host.querySelector<HTMLButtonElement>('[data-unit="breach_team"] .rl-brigade__buy');
    expect(breach?.textContent).toBe('buy for 600');
    expect(breach?.disabled).toBe(false);
    breach?.click();
    expect(bought).toEqual([['breach_team', 600]]);
    const lavi = host.querySelector<HTMLButtonElement>('[data-unit="ifv_namer"] .rl-brigade__buy');
    expect(lavi?.textContent).toBe('buy for 1200');
    expect(lavi?.disabled).toBe(true);
    // `.rl-brigade__why` is `gateSentence`'s own rendering, never the sim's raw
    // `unlockReason` string -- ifv_namer here is price-only (D1), so it reads the
    // Buy sentence rather than a requires/Conduct/stars line.
    expect(host.querySelector('[data-unit="ifv_namer"] .rl-brigade__why')?.textContent).toBe('Buy for 1200 credits');
  });

  it('shows no Buy control without an account, and none on an unpriced or open row', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, missionName: noMissionNames, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__buy')).toBeNull();
    const host2 = document.createElement('div');
    showBrigade(host2, {
      units: units.map((u) => ({ ...u, unlock: { price: 5, bought: true } })),
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      credits: 0,
      onBuy: () => {},
    });
    expect(host2.querySelector('.rl-brigade__buy')).toBeNull();
    expect(host2.querySelector('.rl-brigade__why')?.textContent).toBe('available');
  });

  // The test above's first case ("without an account") is vacuous for an unpriced row:
  // it lacks credits AND onBuy, so a Buy control could never render regardless of price.
  // This closes that gap -- `ifv_namer` is locked (roeMin: 40, unmet by an empty ledger)
  // and declares no price, WITH an account present, proving the missing control is
  // because there is no price rather than because there is no account.
  it('renders no Buy control on an unpriced locked row even with an account present', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, missionName: noMissionNames, possibleStars: 78, credits: 999, onBuy: () => {} });
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
    expect(host.querySelector('[data-unit="ifv_namer"] .rl-brigade__buy')).toBeNull();
    expect(host.querySelector('.rl-brigade__buy')).toBeNull();
  });

  it('sorts a price-only (bought-only) locked row after a mission-gated row', () => {
    const host = document.createElement('div');
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
    showBrigade(host, { units: fixture, ledger: {}, missionName: noMissionNames, possibleStars: 78 });
    const rows = [...host.querySelectorAll('.rl-brigade__list [data-unit]')].map((r) => r.getAttribute('data-unit'));
    expect(rows).toEqual(['mission_gated', 'price_only']);
  });

  it('draws one pip per tier, filled up to the owned tier', () => {
    const host = document.createElement('div');
    showBrigade(host, {
      units,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      owned: { inf_squad: { armour: 1 } },
    });
    const tracks = host.querySelectorAll('[data-unit="inf_squad"] .rl-brigade__track');
    expect(tracks).toHaveLength(2);
    const armourPips = [...tracks[0].querySelectorAll('.rl-brigade__pip')].map((p) => p.getAttribute('data-filled'));
    expect(armourPips).toEqual(['1', '0']);
    const sensorPips = [...tracks[1].querySelectorAll('.rl-brigade__pip')].map((p) => p.getAttribute('data-filled'));
    expect(sensorPips).toEqual(['0']);
  });

  // Fix round 1, Important finding: `.rl-brigade__tracks` must be a direct
  // child of `.rl-brigade__row` and the row's LAST child, right after
  // `.rl-brigade__why` -- that structure (plus `.rl-brigade__row`'s own
  // `flex-wrap: wrap` and the tracks block's `flex: 1 0 100%` in theme.css)
  // is what puts it on its own line below the row's first line instead of
  // widening the row past the panel's own width floor.
  it('places .rl-brigade__tracks as a direct child of the row, right after .rl-brigade__why', () => {
    const host = document.createElement('div');
    showBrigade(host, {
      units,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      owned: { inf_squad: { armour: 1 } },
    });
    const row = host.querySelector('[data-unit="inf_squad"]');
    const tracksEl = row?.querySelector(':scope > .rl-brigade__tracks');
    expect(tracksEl).not.toBeNull();
    expect(tracksEl?.parentElement).toBe(row);
    expect(tracksEl?.previousElementSibling?.className).toBe('rl-brigade__why');
    expect(tracksEl?.nextElementSibling).toBeNull();
  });

  it('sells the next tier per track, enabled with enough credits', () => {
    const host = document.createElement('div');
    const bought: [string, string, number, number][] = [];
    showBrigade(host, {
      units,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      owned: { inf_squad: { armour: 1 } },
      credits: 999,
      onBuyUpgrade: (unitId, track, tier, price) => bought.push([unitId, track, tier, price]),
    });
    const tracks = host.querySelectorAll('[data-unit="inf_squad"] .rl-brigade__track');
    const armourBtn = tracks[0].querySelector<HTMLButtonElement>('.rl-brigade__buy-tier');
    expect(armourBtn?.textContent).toBe('tier 2 · 300');
    expect(armourBtn?.disabled).toBe(false);
    expect(armourBtn?.getAttribute('aria-label')).toBe('buy Rifle Squad armour tier 2 for 300 credits');
    armourBtn?.click();
    expect(bought).toEqual([['inf_squad', 'armour', 2, 300]]);
    expect(armourBtn?.disabled).toBe(true);

    const sensorBtn = tracks[1].querySelector<HTMLButtonElement>('.rl-brigade__buy-tier');
    expect(sensorBtn?.textContent).toBe('tier 1 · 150');
  });

  it('disables both controls when the balance is short', () => {
    const host = document.createElement('div');
    showBrigade(host, {
      units,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      owned: { inf_squad: { armour: 1 } },
      credits: 100,
      onBuyUpgrade: () => {},
    });
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-unit="inf_squad"] .rl-brigade__buy-tier');
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) expect(btn.disabled).toBe(true);
  });

  it('shows "maxed" instead of a Buy control on a maxed track, and clamps an owned tier above the track length', () => {
    const host = document.createElement('div');
    showBrigade(host, {
      units,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      owned: { inf_squad: { armour: 2, sensors: 1 } },
      credits: 999,
      onBuyUpgrade: () => {},
    });
    const tracks = host.querySelectorAll('[data-unit="inf_squad"] .rl-brigade__track');
    for (const t of tracks) {
      expect(t.querySelector('.rl-brigade__track-max')?.textContent).toBe('maxed');
      expect(t.querySelector('.rl-brigade__buy-tier')).toBeNull();
    }

    const host2 = document.createElement('div');
    showBrigade(host2, {
      units,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      owned: { inf_squad: { armour: 9 } },
      credits: 999,
      onBuyUpgrade: () => {},
    });
    const armourTrack = host2.querySelectorAll('[data-unit="inf_squad"] .rl-brigade__track')[0];
    expect(armourTrack.querySelector('.rl-brigade__track-max')?.textContent).toBe('maxed');
  });

  it('renders no tracks at all on a locked row', () => {
    const host = document.createElement('div');
    const fixture = units.map((u) =>
      u.id === 'breach_team'
        ? { ...u, upgrades: { armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] } } }
        : u
    );
    showBrigade(host, {
      units: fixture,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      credits: 999,
      onBuyUpgrade: () => {},
    });
    expect(host.querySelector('[data-unit="breach_team"] .rl-brigade__track')).toBeNull();
  });

  it('renders pips read-only, with no Buy or maxed control, without credits/onBuyUpgrade', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, missionName: noMissionNames, possibleStars: 78 });
    const tracks = host.querySelectorAll('[data-unit="inf_squad"] .rl-brigade__track');
    expect(tracks).toHaveLength(2);
    expect(host.querySelector('.rl-brigade__buy-tier')).toBeNull();
    expect(host.querySelector('.rl-brigade__track-max')).toBeNull();
  });

  // Review finding 4: the star-gate badge must render BEFORE the tracks block
  // so it stays on the row's first line. `breach_team` here carries both a
  // `starsMin` gate AND upgrade tracks, and the ledger clears 12 stars so the
  // row is AVAILABLE (unlocked) -- the case the old ordering got wrong, since
  // an available, star-gated unit is exactly where `.rl-brigade__tracks`
  // could otherwise land between `.rl-brigade__why` and the gate span.
  it('renders .rl-brigade__gate before .rl-brigade__tracks on an available, star-gated row', () => {
    const host = document.createElement('div');
    const fixture = units.map((u) =>
      u.id === 'breach_team'
        ? { ...u, upgrades: { armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] } } }
        : u
    );
    const twelveStars = {
      'campaign.mission_results': {
        a: { stars: 2, roe: 90, ticks: 1, lost: 0 },
        b: { stars: 2, roe: 90, ticks: 1, lost: 0 },
        c: { stars: 2, roe: 90, ticks: 1, lost: 0 },
        d: { stars: 2, roe: 90, ticks: 1, lost: 0 },
        e: { stars: 2, roe: 90, ticks: 1, lost: 0 },
        f: { stars: 2, roe: 90, ticks: 1, lost: 0 },
      },
    } as const;
    showBrigade(host, { units: fixture, ledger: twelveStars, missionName: noMissionNames, possibleStars: 78 });
    const row = host.querySelector('[data-unit="breach_team"]');
    expect(row?.getAttribute('data-locked')).toBe('0');
    const gate = row?.querySelector('.rl-brigade__gate');
    const tracks = row?.querySelector('.rl-brigade__tracks');
    expect(gate?.textContent).toBe('★ 12');
    expect(tracks).not.toBeNull();
    expect(gate?.compareDocumentPosition(tracks as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // Review finding 10: an underscored track key (as authored in JSON, e.g.
  // `fire_control`) reads with spaces wherever a player sees it -- the label
  // span and the Buy control's aria-label -- while the raw key keeps going to
  // `onBuyUpgrade`/`nextTierPrice` unchanged.
  it('renders an underscored track name with spaces, in the label and the aria-label', () => {
    const host = document.createElement('div');
    const fixture = units.map((u) =>
      u.id === 'inf_squad'
        ? { ...u, upgrades: { fire_control: { tiers: [{ price: 100, patch: { 'weapons[0].accuracy': 0.05 } }] } } }
        : u
    );
    const bought: [string, string, number, number][] = [];
    showBrigade(host, {
      units: fixture,
      ledger: {},
      missionName: noMissionNames,
      possibleStars: 78,
      credits: 999,
      onBuyUpgrade: (unitId, track, tier, price) => bought.push([unitId, track, tier, price]),
    });
    const track = host.querySelector('[data-unit="inf_squad"] .rl-brigade__track');
    expect(track?.querySelector('.rl-brigade__track-name')?.textContent).toBe('fire control');
    const btn = track?.querySelector<HTMLButtonElement>('.rl-brigade__buy-tier');
    expect(btn?.getAttribute('aria-label')).toBe('buy Rifle Squad fire control tier 1 for 100 credits');
    btn?.click();
    expect(bought).toEqual([['inf_squad', 'fire_control', 1, 100]]);
  });
});
