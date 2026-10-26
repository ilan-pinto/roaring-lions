// GH-707: the wounded ring is amber for the viewer's own men and the team hostile colour for the
// enemy's. Under each colour-vision variant the two must stay apart, or a down enemy reads as a
// down friend. Colours come from the SAME two calls the renderer's inputs do: `WOUND_OWN_COLOR_KEY`
// through `variantAwareResolver` (what `overlayColor` is) and `paletteTeamColors(variant)[1]` (what
// `opts.teamColors` is).
import { describe, expect, it } from 'vitest';
import { paletteTeamColors, variantAwareResolver, type ColorVisionVariant } from '@lions/data';
import { WOUND_OWN_COLOR_KEY } from '../../packages/render/src/three/units/overlays';
import { labDistance, simulate, type CvdKind } from './cvd';

/** The lead's floor (26 Oct): under about 20 the pair needs a second, non-colour cue. */
const FLOOR = 20;

const linear = (hex: string): [number, number, number] => {
  const c = (i: number): number => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [c(0), c(1), c(2)];
};

const VARIANTS: readonly ColorVisionVariant[] = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];

describe('the wounded ring: own against enemy under colour-vision variants', () => {
  for (const variant of VARIANTS) {
    it(`${variant}: ΔE >= ${FLOOR}${variant === 'default' ? '' : ' under its own simulation'}`, () => {
      const own = variantAwareResolver(variant)(WOUND_OWN_COLOR_KEY);
      const enemy = paletteTeamColors(variant)[1];
      const d =
        variant === 'default' ? labDistance(linear(own), linear(enemy)) : labDistance(simulate(own, variant as CvdKind), simulate(enemy, variant as CvdKind));
      expect(d, `${own} vs ${enemy}`).toBeGreaterThanOrEqual(FLOOR);
    });
  }
  it('the key is the amber the palette has, not a team colour', () => {
    expect(variantAwareResolver('default')(WOUND_OWN_COLOR_KEY)).toBe('#FFB43C');
  });
});
