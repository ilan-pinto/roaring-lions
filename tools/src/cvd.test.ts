// tools/src/cvd.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labDistance, simulate, toLab } from './cvd';

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
  // I7 (final review). This test used to read:
  //
  //   for (const k of KINDS)
  //     expect(labDistance(simulate('#808080', k), simulate('#808080', 'tritanopia'))).toBeLessThan(1);
  //
  // ...which tested neither thing in its own title. Its reference was another
  // SIMULATED value, so for k === 'tritanopia' the assertion was
  // `labDistance(x, x) < 1` -- literally 0, unable to fail -- and if all three
  // matrices had darkened grey identically to black it would still have passed,
  // which is exactly the claim. Both of this repository's listed anti-patterns
  // in one line: `x * 1.0 == x`, and an "independent" oracle that imports its
  // arguments from the code under test.
  //
  // The reference is a literal now, computed by hand from the sRGB definition
  // and nothing in this package:
  //   #808080 -> 128/255 = 0.50196078 sRGB
  //   linear  = ((0.50196078 + 0.055) / 1.055) ** 2.4 = 0.21586050
  //   grey, so X/Xn = Y/Yn = Z/Zn = 0.21586050 by construction (every row of
  //   the sRGB->XYZ matrix sums to its own D65 white component)
  //   f = cbrt(0.21586050) = 0.59988...   L = 116f - 16 = 53.5850, a = b = 0
  //
  // The two claims are separate assertions because they are separate claims: a
  // matrix that mapped grey to a DIFFERENT grey would pass the second and fail
  // the first, and one that mapped it to black would pass neither.
  //
  // Falsified by zeroing the middle row of each matrix in turn (three runs,
  // three reds) -- not one, because one mutation only reaches one kind.
  const GREY_LAB = [53.585, 0, 0] as const;
  const dE = (a: readonly [number, number, number], b: readonly [number, number, number]): number =>
    Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

  for (const k of KINDS) {
    it(`${k}: grey survives the simulation as the same grey, and is not darkened toward black`, () => {
      const lab = toLab(simulate('#808080', k)) as [number, number, number];
      expect(dE(lab, GREY_LAB), `${k} grey Lab ${lab.map((v) => v.toFixed(3)).join(', ')}`).toBeLessThan(1);
      expect(lab[0], `${k} lightness`).toBeGreaterThan(40);
    });
  }
});
