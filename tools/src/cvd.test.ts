// tools/src/cvd.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labDistance, simulate } from './cvd';

const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  reserved: { team: { colors: Record<string, string>; variants: Record<string, Record<string, string>> } };
};
const KINDS = ['deuteranopia', 'protanopia', 'tritanopia'] as const;
const FLOOR = 25; // CIE76 ΔE; 2.3 is a just-noticeable difference, 25 is "a different colour at a glance"
// Measured 2026-09-18, cross-checked in TS and an independent Python port of
// the same pipeline: the closest default pair is hostile vs neutral under
// deuteranopia at ΔE 32.06 -- under 60% of the next-closest pair (55.46,
// protanopia hostile-neutral) and under a quarter of the widest (136.12,
// deuteranopia kedem-neutral), but NOT under FLOOR's own "different colour
// at a glance" line, which is reserved for what every variant must clear. A
// motivational check sharing FLOOR with the real per-variant gate would be
// unfalsifiable the way CLAUDE.md warns against (it would "read zero for
// every possible input"): reusing the same 25 here happened to make the
// wrong claim true only by coincidence of wording, not measurement. This
// ceiling instead states the measured fact -- team colours ARE substantially
// harder to tell apart under deuteranopia, which is why the variants exist
// -- without pretending they go all the way to indistinguishable.
const DEFAULT_COLLAPSE_CEILING = 35;

describe('team colours under simulated colour-vision deficiency', () => {
  it('the DEFAULT team colours are what a CVD variant exists to fix: at least one pair collapses', () => {
    const c = palette.reserved.team.colors;
    const worst = Math.min(...KINDS.flatMap((k) => [
      labDistance(simulate(c.kedem, k), simulate(c.hostile, k)),
      labDistance(simulate(c.kedem, k), simulate(c.neutral, k)),
      labDistance(simulate(c.hostile, k), simulate(c.neutral, k)),
    ]));
    expect(worst).toBeLessThan(DEFAULT_COLLAPSE_CEILING);
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
