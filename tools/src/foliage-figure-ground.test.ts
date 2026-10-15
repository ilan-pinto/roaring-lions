/**
 * VR-05 (option 1, the lead's approval of the VR-04/05 mock): foliage moves
 * to `scrub.1`, off the KDF olive.
 *
 * Before this, every mesh foliage family on every theme drew the decor
 * `foliage` ramp's lift, `olive.1` -- the SAME key a KDF uniform lifts to
 * (`units/mesh-role.ts`, the `olive` ramp), so a rifleman in a grove was
 * olive on olive, and the mock measured an arid Namer against arid foliage at
 * ΔE2000 2.0-3.6 in the rendered frame. Option 1 tints every foliage family
 * (`decorColors['<family>:foliage']`) and the scatter tussock (`low`) on every
 * theme with `scrub.1`, the cedar's approved blue-green -- exactly the mock's
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
import { paletteColor } from '@lions/data';
import { TERRAIN_THEMES } from '../../packages/app/src/terrain-themes';
import { labDistance } from './cvd';

/** The KDF uniform's lit albedo (`mesh-role.ts`: the `olive` ramp's lift). */
const KDF_UNIFORM_KEY = 'olive.1';
/** What an UNTINTED foliage family draws: the decor `foliage` ramp's lift
 *  (`decor-role.ts`, `sliceFrom('olive', 0)` through `liftTone`, index 1). */
const UNTINTED_FOLIAGE_KEY = 'olive.1';
/** Every decor family that carries a `foliage` role. */
const FOLIAGE_FAMILIES = ['tree', 'desert_tree', 'bush', 'grass', 'cedar'] as const;
const THEMES = ['arid', 'green', 'highland'] as const;

/**
 * The floor, CIE76 ΔE over CIELAB through `tools/src/cvd.ts` (the repo's
 * colour instrument; it has no ΔE2000). Against `olive.1`:
 *   olive.1 0.00 (arid and green status quo), olive.2 13.77 (highland bush
 *   status quo), scrub.1 15.89 (option 1), scrub.0 16.29.
 * The mock measured highland's olive.2 bush leaving the highland Namer at
 * ΔE2000 7.4 / 7.7 in the rendered frame against option 1's 13.4 / 12.9, so
 * olive.2 is a status quo the guard must REFUSE, and scrub.1 is what the lead
 * approved. 15 sits between the two keys that bracket that decision (13.77
 * refused, 15.89 accepted). It is a key-level guard, not a rendered-frame
 * one: it says "foliage is not drawn in (or one step off) the uniform's own
 * colour", which is the whole of VR-05's defect at the palette level.
 */
const MIN_FIGURE_GROUND_DE76 = 15;

/** A hex to LINEAR RGB, the input `labDistance` takes (the IEC 61966-2-1
 *  curve; `cvd.ts` keeps its own decoder private behind `simulate`). */
const linearHex = (hex: string): readonly [number, number, number] => {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as unknown as readonly [
    number,
    number,
    number,
  ];
};
const linear = (key: string): readonly [number, number, number] => linearHex(paletteColor(key));

/** The palette KEY a family's foliage resolves to on a theme (by hex). */
function foliageHex(theme: (typeof THEMES)[number], family: string): string {
  return TERRAIN_THEMES[theme].decorColors?.[`${family}:foliage`] ?? paletteColor(UNTINTED_FOLIAGE_KEY);
}

describe('VR-05: foliage is scrub.1, off the KDF olive', () => {
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
