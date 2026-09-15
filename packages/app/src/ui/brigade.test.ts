// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showBrigade } from './brigade';

const units = [
  { id: 'inf_squad', name: 'Rifle Squad', role: 'infantry', isKamikaze: false, transportSlots: 0, isSoft: true },
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
      possibleStars: 78,
    });
    expect(host.querySelector('.rl-brigade__stars')?.textContent).toBe('2 of 78 stars');
    expect(host.querySelector('.rl-brigade__conduct')?.textContent).toBe('Conduct 90');
    const rows = [...host.querySelectorAll('[data-unit]')].map((r) => r.getAttribute('data-unit'));
    expect(rows).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('0');
    expect(host.querySelector('[data-unit="breach_team"] .rl-brigade__why')?.textContent).toBe('requires 12 stars (currently 2)');
    expect(host.querySelector('[data-unit="breach_team"] .rl-brigade__gate')?.textContent).toBe('★ 12');
  });

  it('reads a fresh campaign honestly', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__stars')?.textContent).toBe('0 of 78 stars');
    expect(host.querySelector('.rl-brigade__conduct')?.textContent).toBe('no missions rated yet');
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
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
      possibleStars: 78,
    });
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
    const rows = [...host.querySelectorAll('[data-unit]')].map((r) => r.getAttribute('data-unit'));
    expect(rows).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
  });

  it('prints a player-facing role label, never the raw role id', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, possibleStars: 78 });
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
    showBrigade(host, { units, ledger: {}, possibleStars: 78 });
    const art = host.querySelector('[data-unit="breach_team"] .rl-brigade__art');
    expect(art?.getAttribute('data-nosprite')).toBe('1');
    expect(art?.querySelector('svg')).not.toBeNull();
  });

  it('prints the credit balance in the header and asks twice before resetting the account', () => {
    const host = document.createElement('div');
    let resets = 0;
    showBrigade(host, { units, ledger: {}, possibleStars: 78, credits: 460, onReset: () => resets++ });
    expect(host.querySelector('.rl-brigade__credits')?.textContent).toBe('460 credits');
    const btn = host.querySelector<HTMLButtonElement>('.rl-brigade__reset');
    expect(btn?.textContent).toBe('reset brigade account');
    btn?.click();
    expect(resets).toBe(0);
    expect(btn?.textContent).toBe('click again to reset — this cannot be undone');
    btn?.click();
    expect(resets).toBe(1);
  });

  it('prints no credits line and no reset control without an account', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__credits')).toBeNull();
    expect(host.querySelector('.rl-brigade__reset')).toBeNull();
  });
});
