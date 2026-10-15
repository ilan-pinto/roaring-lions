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
import { paletteColor } from '@lions/data';
import { TERRAIN_THEMES } from '../../packages/app/src/terrain-themes';
import { labDistance, toLab } from './cvd';

/** The KDF uniform's lit albedo (`mesh-role.ts`: the `olive` ramp's lift). */
const KDF_UNIFORM_KEY = 'olive.1';
/** What an UNTINTED foliage family draws: the decor `foliage` ramp's lift
 *  (`decor-role.ts`, `sliceFrom('olive', 0)` through `liftTone`, index 1). */
const UNTINTED_FOLIAGE_KEY = 'olive.1';
/** Every decor family that carries a `foliage` role. */
const FOLIAGE_FAMILIES = ['tree', 'desert_tree', 'bush', 'grass', 'cedar'] as const;
/**
 * Green is EXCLUDED by the lead's ruling: the Wadi Halam frames were mixed (the
 * Eitan reads worse on scrub), so green keeps its foliage as it was. It is
 * pinned UNMOVED below instead.
 */
const THEMES = ['arid', 'highland'] as const;

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

/** CIEDE2000 between two linear-RGB colours (Sharma et al. 2005), on `cvd.ts`'s Lab. */
function deltaE2000(
  c1: readonly [number, number, number],
  c2: readonly [number, number, number]
): number {
  const [L1, a1, b1] = toLab(c1);
  const [L2, a2, b2] = toLab(c2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = ((Math.atan2(b1, a1p) / rad) + 360) % 360;
  const h2p = ((Math.atan2(b2, a2p) / rad) + 360) % 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
    else hbp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
  );
}

/** The ΔE2000 floor: between scrub.0 (9.81, refused) and scrub.1 (12.60). */
const MIN_FIGURE_GROUND_DE2000 = 12;

/** The palette KEY a family's foliage resolves to on a theme (by hex). */
function foliageHex(theme: (typeof THEMES)[number], family: string): string {
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

  for (const theme of THEMES) {
    it(`${theme}: every foliage tone is at least ΔE2000 ${MIN_FIGURE_GROUND_DE2000} from the KDF uniform`, () => {
      const uniform = linear(KDF_UNIFORM_KEY);
      const tones: Array<[string, string]> = FOLIAGE_FAMILIES.map((f) => [`${f}:foliage`, foliageHex(theme, f)]);
      tones.push(['low', TERRAIN_THEMES[theme].low]);
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
