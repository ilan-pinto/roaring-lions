// GH-707: the wounded ring is amber for the viewer's own men and the team hostile colour for the
// enemy's. Under each colour-vision variant the two must stay apart, or a down enemy reads as a
// down friend. Colours come from the SAME two calls the renderer's inputs do: `WOUND_OWN_COLOR_KEY`
// through `variantAwareResolver` (what `overlayColor` is) and `paletteTeamColors(variant)[1]` (what
// `opts.teamColors` is).
import { describe, expect, it } from 'vitest';
import { paletteTeamColors, variantAwareResolver, type ColorVisionVariant } from '@lions/data';
import { WOUND_OWN_COLOR_KEY } from '../../packages/render/src/three/units/overlays';
import { WOUND_RING } from '../../packages/render/src/three/units/readability';
import { woundRingDashed } from '../../packages/render/src/three/units/wounded-read';
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

/** A pattern the eye can see on a ~50 px ring: at least 4 segments, and a gap of at least a quarter of each. */
const dashedPatternPresent = (): boolean =>
  woundRingDashed(0, 0) && !woundRingDashed(2, 0) && (WOUND_RING.dashSegments ?? 0) >= 4 && (WOUND_RING.dashGapFraction ?? 0) >= 0.25;

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

// GH-707: own amber against a wounded CIVILIAN's ring. GH-844 measured it against `team.neutral`
// (yellow) and found 10.1 / 19.0 / 17.8 under deuteranopia / protanopia / tritanopia. The ring a
// civilian actually wears is `paletteTeamColors(variant)[2]` (`CIVILIAN_COLOR_KEY`, limestone.0, a pale
// cream), which clears the floor everywhere (58.6 / 61.6 / 35.8); `team.neutral` is not what draws. The
// own ring is DASHED anyway, so colour is not the only thing carrying own against civilian, and a civilian
// colour change to the neutral yellow cannot silently reopen the gap: each variant passes on dE OR on
// shape, against BOTH colours.
const CIVILIAN_COLOURS: readonly { readonly name: string; readonly of: (variant: ColorVisionVariant) => string }[] = [
  { name: 'the civilian slot (limestone.0)', of: (variant) => paletteTeamColors(variant)[2] },
  { name: 'team.neutral (the colour GH-844 measured)', of: (variant) => variantAwareResolver(variant)('team.neutral') },
];

const deltaE = (variant: ColorVisionVariant, a: string, b: string): number =>
  variant === 'default' ? labDistance(linear(a), linear(b)) : labDistance(simulate(a, variant as CvdKind), simulate(b, variant as CvdKind));

describe('the wounded ring: own against a wounded civilian, colour or shape', () => {
  for (const civ of CIVILIAN_COLOURS) {
    for (const variant of VARIANTS) {
      it(`${variant} vs ${civ.name}: dE >= ${FLOOR} or the own ring is dashed and the civilian's is not`, () => {
        const own = variantAwareResolver(variant)(WOUND_OWN_COLOR_KEY);
        const c = civ.of(variant);
        const d = deltaE(variant, own, c);
        expect(d >= FLOOR || dashedPatternPresent(), `${own} vs ${c}: dE ${d.toFixed(1)}, dashed ${dashedPatternPresent()}`).toBe(true);
      });
    }
  }
  it('the shape cue is load-bearing: team.neutral is under the floor in every variant (17.7 default, then the three colour-vision ones)', () => {
    const needs = VARIANTS.filter((variant) => deltaE(variant, variantAwareResolver(variant)(WOUND_OWN_COLOR_KEY), variantAwareResolver(variant)('team.neutral')) < FLOOR);
    expect(needs).toEqual(['default', 'deuteranopia', 'protanopia', 'tritanopia']);
  });
  it('the civilian ring actually drawn is the cream slot, not team.neutral', () => {
    for (const variant of VARIANTS) expect(paletteTeamColors(variant)[2]).toBe('#F2E8D5');
  });
});
