import { describe, expect, it } from 'vitest';
// Type-only, so the VALUE side of `@lions/data` still arrives through the
// dynamic imports below -- the point being that nothing in this file resolves
// a number through the same code `upgrade-benefit.ts` does.
import type { UpgradableUnit } from '@lions/data';
import { formatBenefit, upgradeBenefits } from './upgrade-benefit';

const lavi = {
  id: 'mbt_lavi',
  hull: { hp: 2100, armor: { front: 120, side: 60, rear: 30 }, suppression_resistance: 0.4 },
  sensors: { optics: 1.0, sight_tiles: 9 },
  weapons: [{ accuracy: 0.62, penetration: 520 }],
  upgrades: {
    armour: {
      tiers: [
        { price: 360, patch: { 'hull.hp': 210, 'hull.armor.front': 14, 'hull.armor.side': 6, 'hull.armor.rear': 3 } },
        { price: 545, patch: { 'hull.hp': 450, 'hull.armor.front': 25, 'hull.armor.side': 11, 'hull.armor.rear': 5 } },
      ],
    },
    sensors: { tiers: [{ price: 300, patch: { 'sensors.optics': 0.1, 'sensors.sight_tiles': 1 } }] },
    firepower: { tiers: [{ price: 400, patch: { 'weapons[0].accuracy': 0.04, 'weapons[0].penetration': 40 } }] },
  },
};

describe('upgradeBenefits', () => {
  it('tier 1 reads against the base', () => {
    expect(upgradeBenefits(lavi, 'armour', 1)).toEqual([
      { path: 'hull.hp', label: 'Hit points', before: 2100, after: 2310, unit: 'hp' },
      { path: 'hull.armor.front', label: 'Front armour', before: 120, after: 134, unit: 'armour' },
      { path: 'hull.armor.side', label: 'Side armour', before: 60, after: 66, unit: 'armour' },
      { path: 'hull.armor.rear', label: 'Rear armour', before: 30, after: 33, unit: 'armour' },
    ]);
  });

  it('tier 2 reads against tier 1, because patches are cumulative over the base', () => {
    const t2 = upgradeBenefits(lavi, 'armour', 2);
    expect(t2[0]).toEqual({ path: 'hull.hp', label: 'Hit points', before: 2310, after: 2550, unit: 'hp' });
  });

  it('percent and tile stats carry their unit', () => {
    expect(upgradeBenefits(lavi, 'sensors', 1)).toEqual([
      { path: 'sensors.optics', label: 'Optics', before: 1, after: 1.1, unit: 'ratio' },
      { path: 'sensors.sight_tiles', label: 'Sight', before: 9, after: 10, unit: 'tiles' },
    ]);
    expect(upgradeBenefits(lavi, 'firepower', 1)[0]).toEqual({
      path: 'weapons[0].accuracy',
      label: 'Accuracy',
      before: 0.62,
      after: 0.66,
      unit: 'percent',
    });
  });

  it('an unknown track or tier is empty, never a throw', () => {
    expect(upgradeBenefits(lavi, 'nope', 1)).toEqual([]);
    expect(upgradeBenefits(lavi, 'armour', 9)).toEqual([]);
    expect(upgradeBenefits({ id: 'x' }, 'armour', 1)).toEqual([]);
  });

  it('agrees with applyUpgrades: after-values equal the applied unit at that tier', async () => {
    const { applyUpgrades } = await import('@lions/data');
    const applied = applyUpgrades(lavi, { armour: 2 });
    const t2 = upgradeBenefits(lavi, 'armour', 2);
    expect(t2.find((b) => b.path === 'hull.hp')?.after).toBe(applied.hull.hp);
    expect(t2.find((b) => b.path === 'hull.armor.front')?.after).toBe(applied.hull.armor.front);
  });

  // The whole point of the module: what a rung promises is what the sim will
  // read once that tier is bought. The test above pins two paths of one track
  // on one hand-written fixture; this sweeps every track, every tier and every
  // patched path of every shipped unit that declares upgrades at all, so a
  // path the LABELS table or `readPath` gets wrong cannot hide behind a
  // fixture that never exercises it -- `weapons[i].*` is the one that would,
  // since nothing above reads an indexed segment against real data.
  //
  // The oracle is hand-written here and imports nothing from the module under
  // test: pointing both sides at `readPath` would have made the two agree by
  // construction (CLAUDE.md, "The 'independent' oracle imported its arguments
  // from the code under test").
  it('agrees with applyUpgrades across every shipped unit, track and tier', async () => {
    const data = await import('@lions/data');
    const readAt = (u: Record<string, unknown>, path: string): number | undefined => {
      const indexed = /^(\w+)\[(\d+)\]\.(\w+)$/.exec(path);
      if (indexed) {
        const list = u[indexed[1]];
        const item = Array.isArray(list) ? (list[Number(indexed[2])] as Record<string, unknown> | undefined) : undefined;
        const v = item?.[indexed[3]];
        return typeof v === 'number' ? v : undefined;
      }
      let cur: unknown = u;
      for (const seg of path.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[seg];
      }
      return typeof cur === 'number' ? cur : undefined;
    };
    const round = (v: number | undefined): number | undefined =>
      v === undefined ? undefined : Math.round(v * 100) / 100;

    const all = Object.values(data.units) as unknown as UpgradableUnit[];
    let checked = 0;
    for (const unit of all) {
      for (const [track, def] of Object.entries(unit.upgrades ?? {})) {
        for (let tier = 1; tier <= def.tiers.length; tier++) {
          const applied = data.applyUpgrades(unit, { [track]: tier }) as unknown as Record<string, unknown>;
          const previous = data.applyUpgrades(unit, { [track]: tier - 1 }) as unknown as Record<string, unknown>;
          const lines = upgradeBenefits(unit, track, tier);
          // Every path the tier patches produces a line -- a silently dropped
          // path is the failure mode a per-line loop alone cannot see.
          expect(lines.map((l) => l.path)).toEqual(Object.keys(def.tiers[tier - 1].patch));
          for (const line of lines) {
            expect(line.after).toBe(round(readAt(applied, line.path)));
            expect(line.before).toBe(round(readAt(previous, line.path)));
            checked++;
          }
        }
      }
    }
    // A sweep that walked nothing would pass every assertion in zero time.
    expect(checked).toBeGreaterThan(50);
  });
});

describe('formatBenefit', () => {
  it('writes each unit the way the HUD does', () => {
    expect(
      formatBenefit({ path: 'hull.armor.front', label: 'Front armour', before: 120, after: 134, unit: 'armour' })
    ).toBe('Front armour 120 → 134');
    expect(formatBenefit({ path: 'sensors.sight_tiles', label: 'Sight', before: 9, after: 10, unit: 'tiles' })).toBe(
      'Sight 9 → 10 tiles'
    );
    expect(
      formatBenefit({ path: 'weapons[0].accuracy', label: 'Accuracy', before: 0.62, after: 0.66, unit: 'percent' })
    ).toBe('Accuracy 62% → 66%');
    expect(formatBenefit({ path: 'sensors.optics', label: 'Optics', before: 1, after: 1.1, unit: 'ratio' })).toBe(
      'Optics +10%'
    );
    expect(formatBenefit({ path: 'hull.hp', label: 'Hit points', before: 2100, after: 2310, unit: 'hp' })).toBe(
      'Hit points 2100 → 2310'
    );
  });

  it('writes one tile as a singular, and a fall in a ratio with its own sign', () => {
    expect(formatBenefit({ path: 'sensors.sight_tiles', label: 'Sight', before: 0, after: 1, unit: 'tiles' })).toBe(
      'Sight 0 → 1 tile'
    );
    // A ratio reads as a percentage of ITSELF: 1.25 -> 1.0 is a fifth off,
    // so -20%. Reading the raw delta as a percent instead would print -25%
    // here, and would overstate every optics rung on every unit whose base
    // optics is not exactly 1.0 -- which is most of them.
    expect(formatBenefit({ path: 'sensors.optics', label: 'Optics', before: 1.25, after: 1, unit: 'ratio' })).toBe(
      'Optics -20%'
    );
    expect(formatBenefit({ path: 'sensors.optics', label: 'Optics', before: 1.2, after: 1.3, unit: 'ratio' })).toBe(
      'Optics +8%'
    );
  });
});
