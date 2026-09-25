// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { units, type UpgradableUnit, type UpgradeTrack } from '@lions/data';
import { rungState, trackEl, trackSummary, visibleBenefits, type TrackDeps } from './garage-board';
import { upgradeBenefits } from './upgrade-benefit';

const kdf = (id: keyof typeof units): UpgradableUnit => units[id] as unknown as UpgradableUnit;
function track(id: keyof typeof units, name: string): UpgradeTrack {
  const found = kdf(id).upgrades?.[name];
  if (found === undefined) throw new Error(`fixture: ${String(id)} has no ${name} track`);
  return found;
}
const lavi = kdf('mbt_lavi');
const deps = (over: Partial<TrackDeps> = {}): TrackDeps => ({
  unit: lavi, unitId: 'mbt_lavi', unitName: 'Lavi MBT', owned: 1, preview: () => {}, ...over,
});

describe('rungState', () => {
  it('is owned up to the owned tier, next one above it, future beyond', () => {
    expect([1, 2, 3].map((tier) => rungState(tier, 1))).toEqual(['owned', 'next', 'future']);
    expect([1, 2, 3].map((tier) => rungState(tier, 3))).toEqual(['owned', 'owned', 'owned']);
  });
});

describe('trackSummary (§4 "spent 360 · 1315 to max")', () => {
  it('prices what is spent and what is left', () => {
    expect(trackSummary(track('mbt_lavi', 'armour'), 1)).toEqual({ owned: 1, length: 3, spent: 360, toMax: 1315, next: 2 });
  });
  it('has no next tier once maxed, and clamps an owned tier past the track', () => {
    expect(trackSummary(track('mbt_lavi', 'armour'), 9)).toEqual({ owned: 3, length: 3, spent: 1675, toMax: 0, next: null });
  });
});

describe('visibleBenefits (F6)', () => {
  it('drops a line that changes nothing: inf_squad armour tier 3 no longer reads "Front armour 12 → 12"', () => {
    const lines = upgradeBenefits(kdf('inf_squad'), 'armour', 3);
    expect(lines).toHaveLength(4); // the data still patches four paths
    expect(visibleBenefits(lines).map((l) => l.path)).toEqual(['hull.hp']);
  });
});

describe('trackEl', () => {
  it('heads the track with its glyph, name, pips, tier and spend', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps());
    expect(el.querySelector('.rl-garage__track-glyph svg')).not.toBeNull();
    expect(el.querySelector('.rl-garage__track-name')?.textContent).toBe('Armour');
    expect(el.querySelectorAll('.rl-garage__track-pips [data-on="1"]')).toHaveLength(1);
    expect(el.querySelector('.rl-garage__track-tier')?.textContent).toBe('tier 1 of 3');
    expect(el.querySelector('.rl-garage__track-spend')?.textContent).toBe('360 spent · 1315 to max');
    expect(el.querySelector('.rl-garage__track-head')?.getAttribute('data-focus-key')).toBe('track:armour');
  });

  it('expands only the next rung: price, benefits, Buy; the rest are one line with their lines a hover away', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ buy: { credits: 5000, onBuy: () => {} } }));
    expect([...el.querySelectorAll('.rl-garage__rung')].map((r) => [r.getAttribute('data-tier'), r.getAttribute('data-state')])).toEqual([
      ['3', 'future'], ['2', 'next'], ['1', 'owned'],
    ]);
    const next = el.querySelector('.rl-garage__rung[data-state="next"]');
    expect(next?.querySelectorAll('.rl-garage__benefit').length).toBeGreaterThan(0);
    expect(next?.querySelector('.rl-garage__buy-tier')?.textContent).toBe('Buy tier 2 · 545');
    for (const r of el.querySelectorAll('.rl-garage__rung:not([data-state="next"])')) {
      expect(r.querySelector('.rl-garage__benefit')).toBeNull();
      expect(r.getAttribute('title')?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('keeps a short-balance Buy legible and disabled', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ buy: { credits: 100, onBuy: () => {} } }));
    expect(el.querySelector<HTMLButtonElement>('.rl-garage__buy-tier')?.disabled).toBe(true);
  });

  it('asks with the tier, its price and the key focus returns to, once', () => {
    const asked: [number, number, string][] = [];
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ buy: { credits: 5000, onBuy: (t, p, k) => asked.push([t, p, k]) } }));
    const buy = el.querySelector<HTMLButtonElement>('.rl-garage__buy-tier');
    buy?.click();
    buy?.click();
    expect(asked).toEqual([[2, 545, 'buy:armour']]);
    expect(buy?.getAttribute('data-focus-key')).toBe('buy:armour');
  });

  it('previews a future rung from the owned tier, nothing on an owned one, and clears', () => {
    const seen: (number | null)[] = [];
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ preview: (d) => seen.push(d === null ? null : (d.get('hull.hp') ?? 0)) }));
    const rung = (t: number): Element | null => el.querySelector(`.rl-garage__rung[data-tier="${t}"]`);
    rung(3)?.dispatchEvent(new MouseEvent('mouseenter'));
    rung(3)?.dispatchEvent(new MouseEvent('mouseleave'));
    rung(1)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(seen).toEqual([540, null, null]);
  });

  it('says Maxed, with no Buy, on a full track', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ owned: 3, buy: { credits: 5000, onBuy: () => {} } }));
    expect(el.querySelector('.rl-garage__track-max')?.textContent).toBe('Maxed');
    expect(el.querySelector('.rl-garage__buy-tier')).toBeNull();
    expect(el.querySelector('.rl-garage__track-spend')?.textContent).toBe('1675 spent · maxed');
  });

  it('prints no zero-change line (F6)', () => {
    const el = trackEl('armour', track('inf_squad', 'armour'), { unit: kdf('inf_squad'), unitId: 'inf_squad', unitName: 'Rifle Squad', owned: 2, preview: () => {} });
    expect([...el.querySelectorAll('.rl-garage__rung[data-tier="3"] .rl-garage__benefit')].map((b) => b.textContent)).toEqual([
      'Hit points 460 → 500',
    ]);
  });
});

describe('trackEl — locked (F7)', () => {
  it('shows a locked unit’s track read-only: tier-1 price and benefits, "Unlock first", no Buy', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ owned: 0, locked: true, buy: { credits: 5000, onBuy: () => {} } }));
    expect(el.getAttribute('data-locked')).toBe('1');
    const first = el.querySelector('.rl-garage__rung[data-tier="1"]');
    expect(first?.getAttribute('data-state')).toBe('next');
    expect(first?.querySelector('.rl-garage__rung-price')?.textContent).toBe('360');
    expect(first?.querySelectorAll('.rl-garage__benefit').length).toBeGreaterThan(0);
    expect(first?.querySelector('.rl-garage__track-lock')?.textContent).toBe('Unlock first');
    expect(el.querySelector('.rl-garage__buy-tier')).toBeNull();
    expect(el.querySelector('.rl-garage__track-max')).toBeNull();
  });

  // A stray account entry must never leak through: `owned` here is nonzero,
  // but this unit is not in the brigade, so the track still reads as if
  // nothing were owned.
  it('ignores a nonzero `owned` while locked', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ owned: 2, locked: true }));
    const first = el.querySelector('.rl-garage__rung[data-tier="1"]');
    expect(first?.getAttribute('data-state')).toBe('next');
    expect(el.querySelector('.rl-garage__rung[data-owned="1"]')).toBeNull();
  });
});
