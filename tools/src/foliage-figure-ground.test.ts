/**
 * VR-05 (option 1, the lead's approval of the VR-04/05 mock): foliage moves
 * to `scrub.1`, off the KDF olive.
 *
 * Before this, every mesh foliage family on every theme drew the decor
 * `foliage` ramp's lift, `olive.1` -- the SAME key a KDF uniform lifts to
 * (`units/mesh-role.ts`, the `olive` ramp), so a rifleman in a grove was
 * olive on olive, and the mock measured an arid Namer against arid foliage at
 * ΔE2000 2.0-3.6 in the rendered frame. Option 1 tints every foliage family
 * (`decorColors['<family>:foliage']`) and the scatter tussock (`low`) on arid
 * and highland with `scrub.1` (green kept as it was, by the lead's ruling), the cedar's approved blue-green -- exactly the mock's
 * prototype (`terrainTonesFor` writing all five families plus `low`).
 *
 * `leafDark`/`leafMid`/`leafLit` are NOT moved, because the mock did not move
 * them: they feed `grove.ts`, whose layer has drawn nothing since the mesh
 * trees (CLAUDE.md). Highland `cover` (a ground tint) is not moved either.
 *
 * The oracle takes LITERALS: the uniform key and the untinted decor lift are
 * written here, not imported from the renderer, so a change on either side
 * cannot shift both halves of the comparison together.
 */
import { describe, expect, it } from 'vitest';
import { maps, paletteColor, parseMap } from '@lions/data';
import { TERRAIN_THEMES } from '../../packages/app/src/terrain-themes';
import { decorFamiliesFor } from '../../packages/app/src/mesh-catalogue';
import { labDistance } from './cvd';
import { deltaE2000, linearHex } from './delta-e2000';

/** The KDF uniform's lit albedo (`mesh-role.ts`: the `olive` ramp's lift). */
const KDF_UNIFORM_KEY = 'olive.1';
/** What an UNTINTED foliage family draws: the decor `foliage` ramp's lift
 *  (`decor-role.ts`, `sliceFrom('olive', 0)` through `liftTone`, index 1). */
const UNTINTED_FOLIAGE_KEY = 'olive.1';
/** Every decor family that carries a `foliage` role, on the shipped themes. */
const FOLIAGE_FAMILIES = ['tree', 'desert_tree', 'bush', 'grass', 'cedar'] as const;
/**
 * The wetland's OWN families (GH-871 P2 T4, plan R-1). Arid and highland keep
 * the list above, because a family a theme cannot place is not checked on it:
 * the wetland places no `tree` or `cedar`, and arid places no `willow`. Task 7
 * pins this list against `decorFamiliesFor(ein_qasab)`.
 */
const WETLAND_FAMILIES = ['oak', 'willow', 'shrub', 'reed', 'wet_grass'] as const;
/**
 * Green is EXCLUDED by the lead's ruling: the Wadi Halam frames were mixed (the
 * Eitan reads worse on scrub), so green keeps its foliage as it was. It is
 * pinned UNMOVED below instead.
 */
const THEMES = ['arid', 'highland'] as const;
type Theme = (typeof THEMES)[number] | 'wetland';
/** Each checked theme's foliage families. */
const FAMILIES: Readonly<Record<Theme, readonly string[]>> = {
  arid: FOLIAGE_FAMILIES,
  highland: FOLIAGE_FAMILIES,
  wetland: WETLAND_FAMILIES,
};

/**
 * WHAT THIS GUARD IS: a regression pin on the palette-KEY bracket, nothing
 * more. It refuses `olive.1` and `olive.2` and accepts `scrub.1`, measured as
 * CIE76 against `olive.1` through `tools/src/cvd.ts` (the repo's colour
 * instrument). CIE76 against `olive.1`:
 *   olive.1 0.00 (arid status quo), olive.2 13.77 (highland bush
 *   status quo), scrub.1 15.89 (option 1), scrub.0 16.29.
 * The floor of 15 sits between the two keys that bracket the lead's decision
 * (13.77 refused, 15.89 accepted). It is not a rendered-frame measurement: the
 * mock measured highland's olive.2 bush leaving the highland Namer at ΔE2000
 * 7.4 / 7.7 in the frame against option 1's 13.4 / 12.9.
 *
 * CIE76 is the WRONG ruler for one neighbour. The same keys in ΔE2000 against
 * `olive.1`: olive.2 11.77, scrub.1 12.60, scrub.0 9.81. `scrub.0` would
 * PASS the CIE76 pin (16.29) while being WORSE than `olive.2` in ΔE2000, so
 * it is refused explicitly below, by its ΔE2000 (a floor of 12, between
 * scrub.0's 9.81 and scrub.1's 12.60), computed from `cvd.ts`'s Lab.
 */
const MIN_FIGURE_GROUND_DE76 = 15;

const linear = (key: string): readonly [number, number, number] => linearHex(paletteColor(key));

/** The ΔE2000 floor: between scrub.0 (9.81, refused) and scrub.1 (12.60). */
const MIN_FIGURE_GROUND_DE2000 = 12;

/** The palette KEY a family's foliage resolves to on a theme (by hex). */
function foliageHex(theme: Theme, family: string): string {
  return TERRAIN_THEMES[theme].decorColors?.[`${family}:foliage`] ?? paletteColor(UNTINTED_FOLIAGE_KEY);
}

describe('VR-05: green keeps its foliage, by the lead\'s ruling', () => {
  it('green has no decorColors and its tussock is scrub.0, as on origin/main', () => {
    expect(TERRAIN_THEMES.green.decorColors).toBeUndefined();
    expect(TERRAIN_THEMES.green.low).toBe(paletteColor('scrub.0'));
  });
});

describe('VR-05: foliage is scrub.1, off the KDF olive (arid and highland)', () => {
  for (const theme of THEMES) {
    it(`${theme}: every foliage family and the tussock draw scrub.1`, () => {
      for (const family of FOLIAGE_FAMILIES) {
        expect(foliageHex(theme, family), `${theme} ${family}:foliage`).toBe(paletteColor('scrub.1'));
      }
      expect(TERRAIN_THEMES[theme].low, `${theme} low`).toBe(paletteColor('scrub.1'));
    });

    it(`${theme}: the KDF uniform (olive.1) is at least ΔE76 ${MIN_FIGURE_GROUND_DE76} from every foliage tone`, () => {
      const uniform = linear(KDF_UNIFORM_KEY);
      const tones: Array<[string, string]> = FOLIAGE_FAMILIES.map((f) => [`${f}:foliage`, foliageHex(theme, f)]);
      tones.push(['low', TERRAIN_THEMES[theme].low]);
      for (const [name, hex] of tones) {
        const d = labDistance(uniform, linearHex(hex));
        expect(d, `${theme} ${name} (${hex}) vs ${KDF_UNIFORM_KEY}: ΔE76 ${d.toFixed(2)}`).toBeGreaterThanOrEqual(
          MIN_FIGURE_GROUND_DE76
        );
      }
    });
  }

  it('refuses scrub.0: it passes the CIE76 pin and fails ΔE2000, so foliage must be scrub.1 on ΔE2000 too', () => {
    const u = linear(KDF_UNIFORM_KEY);
    const d = (k: string) => deltaE2000(u, linear(k));
    expect(d('olive.2')).toBeCloseTo(11.77, 1);
    expect(d('scrub.1')).toBeCloseTo(12.6, 1);
    expect(d('scrub.0')).toBeCloseTo(9.81, 1);
    // the CIE76 pin alone would let scrub.0 through
    expect(labDistance(u, linear('scrub.0'))).toBeGreaterThanOrEqual(MIN_FIGURE_GROUND_DE76);
    expect(d('scrub.0')).toBeLessThan(MIN_FIGURE_GROUND_DE2000);
    expect(d('olive.2')).toBeLessThan(MIN_FIGURE_GROUND_DE2000);
    expect(d('scrub.1')).toBeGreaterThanOrEqual(MIN_FIGURE_GROUND_DE2000);
  });

  for (const theme of [...THEMES, 'wetland'] as const) {
    it(`${theme}: every foliage tone is at least ΔE2000 ${MIN_FIGURE_GROUND_DE2000} from the KDF uniform`, () => {
      const uniform = linear(KDF_UNIFORM_KEY);
      const tones: Array<[string, string]> = FAMILIES[theme].map((f) => [`${f}:foliage`, foliageHex(theme, f)]);
      // The wetland's tussock (`low`, `fen.1`, spec 4.2) reads ΔE2000 9.34 from
      // the uniform, under this floor; it is the scatter tussock, not a
      // foliage family, and is reported rather than gated (GH-871 P2 T4).
      if (theme !== 'wetland') tones.push(['low', TERRAIN_THEMES[theme].low]);
      // Not vacuous: the wetland path checked its five families, each tinted.
      if (theme === 'wetland') expect(tones).toHaveLength(5);
      for (const [name, hex] of tones) {
        const d = deltaE2000(uniform, linearHex(hex));
        expect(d, `${theme} ${name} (${hex}): ΔE2000 ${d.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_FIGURE_GROUND_DE2000);
      }
    });
  }

  it('leaves the procedural canopy and highland cover where the mock left them', () => {
    expect([TERRAIN_THEMES.arid.leafDark, TERRAIN_THEMES.arid.leafMid, TERRAIN_THEMES.arid.leafLit]).toEqual(
      ['olive.2', 'olive.1', 'olive.0'].map(paletteColor)
    );
    expect(TERRAIN_THEMES.highland.cover).toEqual(['olive.1', 'olive.2', 'olive.3'].map(paletteColor));
  });

  it('the instrument is live: olive.1 and olive.2 fall under the floor, scrub.1 clears it', () => {
    const u = linear(KDF_UNIFORM_KEY);
    expect(labDistance(u, linear('olive.1'))).toBeLessThan(MIN_FIGURE_GROUND_DE76);
    expect(labDistance(u, linear('olive.2'))).toBeLessThan(MIN_FIGURE_GROUND_DE76);
    expect(labDistance(u, linear('scrub.1'))).toBeGreaterThanOrEqual(MIN_FIGURE_GROUND_DE76);
  });
});

describe('GH-871 P2 T4: the wetland keeps its own foliage off the KDF uniform', () => {
  it('declares a tint for every one of its five families, none of them the untinted olive.1', () => {
    const w = TERRAIN_THEMES.wetland.decorColors ?? {};
    for (const f of WETLAND_FAMILIES) {
      expect(w[`${f}:foliage`], `${f}:foliage`).toBeDefined();
      expect(w[`${f}:foliage`], `${f}:foliage`).not.toBe(paletteColor(UNTINTED_FOLIAGE_KEY));
    }
  });

  it('measures the wetland tones as the plan states them (literal ΔE2000 from olive.1)', () => {
    const d = (hex: string) => deltaE2000(linear(KDF_UNIFORM_KEY), linearHex(hex));
    // oak and shrub #3E5C2E: 12.60 -- the floor's own margin, 0.6 over 12.
    expect(d('#3E5C2E')).toBeCloseTo(12.6, 1);
    // fen.1 as oak foliage would be 9.34, under the floor: the falsification.
    expect(d(paletteColor('fen.1'))).toBeCloseTo(9.34, 1);
    expect(d(paletteColor('fen.1'))).toBeLessThan(MIN_FIGURE_GROUND_DE2000);
  });

  it('lists exactly the foliage-carrying families the Ein Qasab greybox plans to place (Task 7)', () => {
    // The foliage-carrying families, as a LITERAL: ground-and-stone families (sand, boulder, rock, slab, ditch)
    // carry no `foliage` role, so they are not in it.
    const CARRIES_FOLIAGE = new Set(['tree', 'desert_tree', 'bush', 'grass', 'cedar', 'oak', 'willow', 'shrub', 'reed', 'wet_grass']);
    const planned = [...decorFamiliesFor(parseMap(maps.ein_qasab))].filter((f) => CARRIES_FOLIAGE.has(f)).sort();
    // Not vacuous: the wetland path ran and planned all five.
    expect(planned.length).toBeGreaterThan(0);
    expect(planned).toEqual([...WETLAND_FAMILIES].sort());
  });
});
