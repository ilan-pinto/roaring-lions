/**
 * GH-871 P2 T4: the wetland's open ground must leave the KDF uniform readable.
 *
 * A KDF rifleman is `olive.1` (#6E7449, `units/mesh-role.ts`). The wetland's
 * open ground is `fen.0`, a green, so the risk is a squad that dissolves into
 * the sward. The guard: the bundle's resolved `open` hex against the uniform's
 * LITERAL hex, in CIEDE2000 (`delta-e2000.ts`, the ruler
 * `foliage-figure-ground.test.ts` uses). It reads 18.37 today; the floor is
 * 15.6. For scale, `scrub.0` (#6B8A4A) on the same uniform reads 9.81 and would
 * fail it.
 *
 * The oracle takes LITERALS: the uniform's hex, the floor, the figures. Only
 * the tone under test (`TERRAIN_THEMES.wetland`) comes from the code.
 */
import { describe, expect, it } from 'vitest';
import { TERRAIN_THEMES } from '../../packages/app/src/terrain-themes';
import { deltaE2000, linearHex } from './delta-e2000';

/** The KDF uniform's lit albedo, `olive.1`, written out. */
const KDF_UNIFORM_HEX = '#6E7449';
/** The floor: between scrub.0's 9.81 (refused) and the open ground's 18.37. */
const MIN_OPEN_VS_KDF_DE2000 = 15.6;
const de = (a: string, b: string) => deltaE2000(linearHex(a), linearHex(b));

describe('the wetland open ground reads against the KDF uniform (GH-871 P2 T4)', () => {
  const w = TERRAIN_THEMES.wetland;

  it(`open is at least ΔE2000 ${MIN_OPEN_VS_KDF_DE2000} from olive.1`, () => {
    const d = de(KDF_UNIFORM_HEX, w.open);
    expect(d, `open ${w.open} vs ${KDF_UNIFORM_HEX}: ΔE2000 ${d.toFixed(2)}`).toBeGreaterThanOrEqual(
      MIN_OPEN_VS_KDF_DE2000
    );
  });

  it('the instrument is live: it reads 18.37 for the shipped open, and refuses scrub.0 at 9.81', () => {
    expect(de(KDF_UNIFORM_HEX, '#75A659')).toBeCloseTo(18.37, 1);
    expect(de(KDF_UNIFORM_HEX, '#6B8A4A')).toBeCloseTo(9.81, 1);
    expect(de(KDF_UNIFORM_HEX, '#6B8A4A')).toBeLessThan(MIN_OPEN_VS_KDF_DE2000);
    expect(de(KDF_UNIFORM_HEX, KDF_UNIFORM_HEX)).toBe(0);
  });

  it('names fen, mud and overcast as ramps, and never basalt (a tint key only)', () => {
    expect(w.paletteRamps).toEqual(['fen', 'mud', 'overcast']);
    expect(w.paletteRamps).not.toContain('basalt');
  });

  it('draws the boulder in basalt, #4B453D', () => {
    expect(w.decorColors?.['boulder:rock']).toBe('#4B453D');
  });
});
