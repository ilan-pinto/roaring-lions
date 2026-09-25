// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyUpgrades, readPath, units, type UpgradableUnit } from '@lions/data';
import { PANEL_PATHS, previewDeltas, statBar, statPanel } from './garage-stats';

const kdf = (id: keyof typeof units): UpgradableUnit => units[id] as unknown as UpgradableUnit;

describe('previewDeltas (F5, R-6)', () => {
  const lavi = kdf('mbt_lavi');
  it('previews nothing for a rung already owned (F5: the Lavi read 3750 → 3960)', () => {
    expect(previewDeltas(lavi, 'armour', 1, 1).size).toBe(0);
  });
  it('previews a future rung against the OWNED tier, not the tier below it (R-6)', () => {
    const d = previewDeltas(lavi, 'armour', 1, 3);
    expect(d.get('hull.hp')).toBe(540); // 750 - 210, not 750 - 450
    expect(d.get('hull.armor.front')).toBe(21);
  });
  it('previews the next rung from nothing as the tier itself', () => {
    expect(previewDeltas(lavi, 'armour', 0, 2).get('hull.hp')).toBe(450);
  });
  it('is empty outside the track, never a throw', () => {
    expect(previewDeltas(lavi, 'armour', 0, 4).size).toBe(0);
    expect(previewDeltas(lavi, 'rockets', 0, 1).size).toBe(0);
  });
  it('agrees with applyUpgrades for every shipped unit, track, owned tier and rung', () => {
    let checked = 0;
    for (const raw of Object.values(units)) {
      const u = raw as unknown as UpgradableUnit;
      for (const [track, spec] of Object.entries(u.upgrades ?? {})) {
        for (let owned = 0; owned <= spec.tiers.length; owned++) {
          const from = applyUpgrades(u, { [track]: owned });
          for (let tier = owned + 1; tier <= spec.tiers.length; tier++) {
            const to = applyUpgrades(u, { [track]: tier });
            const d = previewDeltas(u, track, owned, tier);
            for (const path of PANEL_PATHS) {
              const a = readPath(from, path);
              const b = readPath(to, path);
              if (a === undefined || b === undefined) continue;
              expect(d.get(path) ?? 0).toBeCloseTo(b - a, 9);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('statBar', () => {
  it('splits a kitted bar into base and kit, with the figure over a small kit line', () => {
    expect(statBar({ base: 3000, owned: 3750, preview: 0, max: 3750, kind: 'hp' })).toEqual({
      basePct: 80,
      kitPct: 20,
      previewPct: 0,
      figure: '3750',
      kit: '+750 kit',
    });
  });
  it('adds a preview segment and prints before → after', () => {
    expect(statBar({ base: 400, owned: 440, preview: 40, max: 2000, kind: 'hp' })).toEqual({
      basePct: 20,
      kitPct: 2,
      previewPct: 2,
      figure: '440 → 480',
      kit: '+40 kit',
    });
  });
  it('writes a percent stat as a percent, kit included', () => {
    const b = statBar({ base: 0.6, owned: 0.66, preview: 0, max: 1, kind: 'percent' });
    expect([b.figure, b.kit]).toEqual(['66%', '+6% kit']);
  });
  it('never overflows its track', () => {
    expect(statBar({ base: 1900, owned: 2100, preview: 200, max: 2000, kind: 'hp' })).toMatchObject({
      basePct: 95,
      kitPct: 5,
      previewPct: 0,
    });
  });
  it('reads an undeclared stat as an em-dash with nothing drawn', () => {
    expect(statBar({ base: undefined, owned: undefined, preview: 0, max: 100, kind: 'hp' })).toEqual({
      basePct: 0,
      kitPct: 0,
      previewPct: 0,
      figure: '—',
      kit: null,
    });
  });
});

describe('statPanel', () => {
  const inf = kdf('inf_squad');
  const max = new Map([['hull.hp', 2000]]);
  const row = (el: HTMLElement, sel: string): HTMLElement | null =>
    el.querySelector<HTMLElement>(`.rl-garage__stat[data-path="hull.hp"] ${sel}`);

  it('draws base and kit as two segments, and says what the kit added', () => {
    const p = statPanel(inf, applyUpgrades(inf, { armour: 1 }), max);
    expect(row(p.el, '.rl-garage__stat-n')?.textContent).toBe('428');
    expect(row(p.el, '.rl-garage__stat-fill')?.style.width).toBe('20%');
    expect(row(p.el, '.rl-garage__stat-kit')?.style.width).toBe('1.4%');
    expect(row(p.el, '.rl-garage__stat-kitn')?.textContent).toBe('+28 kit');
    expect(row(p.el, '.rl-garage__stat-kitn')?.hidden).toBe(false);
  });
  it('hides the kit line on a stat nothing was bought for', () => {
    expect(row(statPanel(inf, inf, max).el, '.rl-garage__stat-kitn')?.hidden).toBe(true);
  });
  it('previews on top of what is bought, and clears', () => {
    const p = statPanel(inf, applyUpgrades(inf, { armour: 1 }), max);
    p.preview(new Map([['hull.hp', 32]]));
    expect(row(p.el, '.rl-garage__stat-n')?.textContent).toBe('428 → 460');
    expect(row(p.el, '.rl-garage__stat-delta')?.style.width).toBe('1.6%');
    p.preview(null);
    expect(row(p.el, '.rl-garage__stat-n')?.textContent).toBe('428');
    expect(row(p.el, '.rl-garage__stat-delta')?.style.width).toBe('0%');
  });
});
