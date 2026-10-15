// tools/src/civilian_colour.test.ts -- VR-04 option 1.
//
// Civilians draw in limestone.0 in EVERY colour-vision variant, apart from the
// warning yellow (`team.neutral` and its variants), which keeps meaning
// caution. The civilian colour is the third slot of `paletteTeamColors`, the
// one array the renderer's rings and the minimap's dots both read, so the four
// variants cannot disagree. Floor 25 is cvd.test.ts's own ("a different colour
// at a glance").
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CIVILIAN_COLOR_KEY, paletteColor, paletteTeamColors, variantAwareResolver, type ColorVisionVariant } from '@lions/data';
import { SILHOUETTE_COLOR_KEY_BY_SIDE } from '../../packages/render/src/three/units/silhouette';
import { labDistance, simulate, type CvdKind } from './cvd';

const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  reserved: { team: { colors: Record<string, string>; variants: Record<string, Record<string, string>> } };
};
const FLOOR = 25;
const VARIANTS: readonly ColorVisionVariant[] = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];
/** The simulation each variant is judged under; the default is seen by normal vision. */
const KIND: Record<ColorVisionVariant, CvdKind | null> = { default: null, deuteranopia: 'deuteranopia', protanopia: 'protanopia', tritanopia: 'tritanopia' };
/** Normal vision: sRGB -> linear, no matrix (the default set is judged unsimulated). */
const normal = (hex: string): readonly [number, number, number] => {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const n = parseInt(hex.slice(1), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
};
const seen = (hex: string, v: ColorVisionVariant): readonly [number, number, number] => {
  const k = KIND[v];
  return k === null ? normal(hex) : simulate(hex, k);
};
const warnOf = (v: ColorVisionVariant): string => (v === 'default' ? palette.reserved.team.colors.neutral : palette.reserved.team.variants[v].neutral);
const teamOf = (v: ColorVisionVariant): Record<string, string> => (v === 'default' ? palette.reserved.team.colors : palette.reserved.team.variants[v]);

describe('VR-04: civilians draw pale', () => {
  const PALE = paletteColor('limestone.0');
  for (const v of VARIANTS) {
    it(`${v}: the civilian slot is limestone.0, and the warning yellow is untouched`, () => {
      expect(paletteTeamColors(v)[2].toUpperCase()).toBe(PALE.toUpperCase());
      // Warnings keep the variant's own neutral through the resolver.
      expect(variantAwareResolver(v)('team.neutral')).toBe(warnOf(v));
      // kedem and hostile are unmoved.
      expect(paletteTeamColors(v)[0]).toBe(teamOf(v).kedem);
      expect(paletteTeamColors(v)[1]).toBe(teamOf(v).hostile);
    });
    it(`${v}: civilian vs warning, kedem and hostile are each ΔE ≥ ${FLOOR}`, () => {
      const civ = paletteTeamColors(v)[2];
      const t = teamOf(v);
      for (const [name, other] of [['warn', warnOf(v)], ['kedem', t.kedem], ['hostile', t.hostile]] as const) {
        const d = labDistance(seen(civ, v), seen(other, v));
        expect(d, `${v}: civilian vs ${name}`).toBeGreaterThanOrEqual(FLOOR);
      }
    });
  }
});

describe('VR-04: one meaning, one place', () => {
  it("the silhouette's civilian key and the data package's CIVILIAN_COLOR_KEY are the same key", () => {
    expect(CIVILIAN_COLOR_KEY).toBe('limestone.0');
    expect(SILHOUETTE_COLOR_KEY_BY_SIDE[2]).toBe(CIVILIAN_COLOR_KEY);
  });
});
