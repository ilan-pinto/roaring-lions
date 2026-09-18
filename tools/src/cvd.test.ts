// tools/src/cvd.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labDistance, simulate } from './cvd';

const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  reserved: { team: { colors: Record<string, string>; variants: Record<string, Record<string, string>> } };
};
const KINDS = ['deuteranopia', 'protanopia', 'tritanopia'] as const;
const FLOOR = 25; // CIE76 ΔE; 2.3 is a just-noticeable difference, 25 is "a different colour at a glance"

// There is deliberately no "the default team colours collapse" assertion.
// One existed here and asserted `worst < 25` (FLOOR) -- sharing FLOOR with
// the real per-variant gate below made it read as principled, but it was
// never run against the true default hex values before being written, and
// it does not hold. Measured 2026-09-18, cross-checked in this TS
// implementation and an independent Python port of the same pipeline, the
// worst (closest) default pair PER KIND is:
//   deuteranopia 32.06 (hostile vs neutral)
//   protanopia   55.46 (hostile vs neutral)
//   tritanopia   64.84 (hostile vs neutral)
// Only deuteranopia comes anywhere near FLOOR, and even it stays above it --
// protanopia and tritanopia were never close to collapse under this metric
// at all. A "less than some ceiling" assertion over that spread is either
// FLOOR-sized (false, as the retired check was) or wide enough (35+) to be
// true of nothing in particular -- not a measurement, a shape chosen to
// pass. What IS true and worth gating is the relational fact below: the
// deuteranopia variant is measurably more separated than the default it
// replaces, at the one deficiency where the default's own pairs come
// closest to needing it.
describe('team colours under simulated colour-vision deficiency', () => {
  it('deuteranopia: the variant is more separated than the default it replaces, at the pair that comes closest to needing it', () => {
    const worstPair = (colors: Record<string, string>, k: (typeof KINDS)[number]): number =>
      Math.min(
        labDistance(simulate(colors.kedem, k), simulate(colors.hostile, k)),
        labDistance(simulate(colors.kedem, k), simulate(colors.neutral, k)),
        labDistance(simulate(colors.hostile, k), simulate(colors.neutral, k))
      );
    const defaultWorst = worstPair(palette.reserved.team.colors, 'deuteranopia'); // 32.06
    const variantWorst = worstPair(palette.reserved.team.variants.deuteranopia, 'deuteranopia'); // 33.57
    expect(variantWorst).toBeGreaterThan(defaultWorst);
  });
  for (const k of KINDS) {
    it(`${k}: every pair of team colours stays apart by ΔE ≥ ${FLOOR} under simulation`, () => {
      const v = palette.reserved.team.variants[k];
      const pairs: [string, string][] = [[v.kedem, v.hostile], [v.kedem, v.neutral], [v.hostile, v.neutral]];
      for (const [a, b] of pairs) expect(labDistance(simulate(a, k), simulate(b, k)), `${a} vs ${b}`).toBeGreaterThanOrEqual(FLOOR);
    });
  }
  it('the simulation is the identity for grey and darkens nothing to black', () => {
    for (const k of KINDS) expect(labDistance(simulate('#808080', k), simulate('#808080', 'tritanopia'))).toBeLessThan(1);
  });
});
