// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showBrigade } from './brigade';

const units = [
  { id: 'inf_squad', name: 'Rifle Squad', role: 'infantry' },
  { id: 'ifv_namer', name: 'Namer IFV', role: 'ifv', unlock: { roeMin: 40 } },
  { id: 'breach_team', name: 'Tzinah Breach Team', role: 'support', unlock: { starsMin: 12 } },
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
});
