// GH-707: the ring under a wounded CIVILIAN against the ring under the viewer's own wounded (amber).
// A down civilian and a down friend must not read as one another in any colour-vision variant. The
// civilian ring is `paletteTeamColors(variant)[2]` (`CIVILIAN_COLOR_KEY`, limestone.0, a pale cream),
// NOT `team.neutral` (the warning yellow, 10-19 from amber). Both colours are read through
// `woundRingHex`, the function `ThreeRenderer.pushWoundRing` calls, so a change of slot or a swap to
// `team.neutral` in the renderer's choice fails here. Replaces closed PR 850 (a dash cue was not needed:
// the cream clears the floor with colour alone).
import { describe, expect, it } from 'vitest';
import { CIVILIAN_COLOR_KEY, paletteColor, paletteTeamColors, variantAwareResolver, type ColorVisionVariant } from '@lions/data';
import { WOUND_OWN_COLOR_KEY, woundRingHex } from '../../packages/render/src/three/units/overlays';
import { labDistance, simulate, type CvdKind } from './cvd';

/** The lead's floor (26 Oct): under about 20 the pair needs a second, non-colour cue. */
const FLOOR = 20;
const CIVILIAN_SIDE = 2;
const VARIANTS: readonly ColorVisionVariant[] = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];

const linear = (hex: string): [number, number, number] => {
  const c = (i: number): number => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [c(0), c(1), c(2)];
};

/** CIE76 dE between two hexes as the variant's viewer sees them (the default is unsimulated). */
const deltaE = (variant: ColorVisionVariant, a: string, b: string): number =>
  variant === 'default' ? labDistance(linear(a), linear(b)) : labDistance(simulate(a, variant as CvdKind), simulate(b, variant as CvdKind));

/** The two rings exactly as `pushWoundRing` is handed them, for a viewer in seat `viewer`. */
const rings = (variant: ColorVisionVariant, viewer: number): { own: string; civilian: string } => {
  const ownColor = variantAwareResolver(variant)(WOUND_OWN_COLOR_KEY);
  const teamColors = paletteTeamColors(variant);
  return { own: woundRingHex(viewer, viewer, ownColor, teamColors), civilian: woundRingHex(CIVILIAN_SIDE, viewer, ownColor, teamColors) };
};

describe('the wounded civilian ring against own amber', () => {
  for (const variant of VARIANTS) {
    for (const viewer of [0, 1]) {
      it(`${variant}, seat ${viewer}: dE >= ${FLOOR}${variant === 'default' ? '' : ' under its own simulation'}`, () => {
        const { own, civilian } = rings(variant, viewer);
        const d = deltaE(variant, own, civilian);
        expect(d, `${own} vs ${civilian}: dE ${d.toFixed(1)}`).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }

  it('the pair compared is amber against a different colour, not a colour against itself', () => {
    for (const variant of VARIANTS) {
      const { own, civilian } = rings(variant, 0);
      expect(own).toBe(variantAwareResolver(variant)(WOUND_OWN_COLOR_KEY));
      expect(civilian).not.toBe(own);
    }
  });

  it('the civilian ring is the civilian colour every other surface wears (CIVILIAN_COLOR_KEY), not a hostile or neutral slot', () => {
    for (const variant of VARIANTS) expect(rings(variant, 0).civilian).toBe(paletteColor(CIVILIAN_COLOR_KEY));
  });

  it('why the guard matters: team.neutral (the warning yellow) is under the floor against amber in every variant', () => {
    const under = VARIANTS.filter((variant) => {
      const resolve = variantAwareResolver(variant);
      return deltaE(variant, resolve(WOUND_OWN_COLOR_KEY), resolve('team.neutral')) < FLOOR;
    });
    expect(under).toEqual(VARIANTS);
  });
});
