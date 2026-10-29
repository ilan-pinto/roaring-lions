/**
 * GH-871 P2 T4: the wetland's open ground must leave the KDF uniform readable.
 *
 * A KDF rifleman is `olive.1` (#6E7449, `units/mesh-role.ts`). The wetland's
 * open ground is `fen.0`, a green, so the risk is a squad that dissolves into
 * the sward. The guard: the bundle's resolved `open` hex against the uniform's
 * LITERAL hex, in CIEDE2000 (`delta-e2000.ts`, the ruler
 * `foliage-figure-ground.test.ts` uses). It reads 15.82 today (18.37 for the
 * first cut, #75A659, before the S-6 tone round moved fen olive-ward to #7F9F57);
 * the floor is 15.6. For scale, `scrub.0` (#6B8A4A) on the same uniform reads 9.81 and would
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
/** The floor: between scrub.0's 9.81 (refused) and the open ground's 15.82 (was 18.37). */
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

  it('the instrument is live: it reads 15.82 for the shipped open (was 18.37 at #75A659), and refuses scrub.0 at 9.81', () => {
    expect(de(KDF_UNIFORM_HEX, '#7F9F57')).toBeCloseTo(15.82, 1);
    // the first cut, kept as a second literal so the ruler is checked at both ends
    expect(de(KDF_UNIFORM_HEX, '#75A659')).toBeCloseTo(18.37, 1);
    // the lead's hue-54 target, clearing the floor only as a lighter mustard
    expect(de(KDF_UNIFORM_HEX, '#9D9545')).toBeCloseTo(15.7, 1);
    // and the darker olive-ward step the S-6 round refused: under the floor
    expect(de(KDF_UNIFORM_HEX, '#6D9648')).toBeLessThan(MIN_OPEN_VS_KDF_DE2000);
    expect(de(KDF_UNIFORM_HEX, '#6B8A4A')).toBeCloseTo(9.81, 1);
    expect(de(KDF_UNIFORM_HEX, '#6B8A4A')).toBeLessThan(MIN_OPEN_VS_KDF_DE2000);
    expect(de(KDF_UNIFORM_HEX, KDF_UNIFORM_HEX)).toBe(0);
  });

  it('draws the open ground olive-ward of the first cut: hue below 90, luma below 149, less saturated (S-6)', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(w.open.slice(i, i + 2), 16));
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const hue = (60 * (mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4));
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const hslS = (mx - mn) / 255 / (1 - Math.abs((mx + mn) / 255 - 1));
    expect(w.open.toUpperCase()).toBe('#7F9F57');
    // the first cut #75A659 read hue 98.2, luma 150.0, HSL saturation 0.302
    expect(hue).toBeLessThan(90);
    expect(luma).toBeLessThan(149);
    expect(hslS).toBeLessThan(0.3);
  });

  it('names fen, mud and overcast as ramps, and never basalt (a tint key only)', () => {
    expect(w.paletteRamps).toEqual(['fen', 'mud', 'overcast']);
    expect(w.paletteRamps).not.toContain('basalt');
  });

  it('lifts the boulder one step (luma 90.8, was 69.7) yet keeps it off the overcast stone and warm', () => {
    const hex = w.decorColors?.['boulder:rock'] ?? '';
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luma).toBeGreaterThan(88);
    expect(luma).toBeLessThan(93);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b); // warm: hue 30-42
    // overcast.3 / overcast.4 as LITERALS: wet faces stay a different stone (was 15.7 / 9.4)
    expect(de(hex, '#656B70')).toBeCloseTo(12.5, 1);
    expect(de(hex, '#4A4F54')).toBeCloseTo(11.9, 1);
    expect(de(hex, '#656B70')).toBeGreaterThan(10);
    expect(de(hex, '#4A4F54')).toBeGreaterThan(10);
  });

  it('draws the boulder in basalt, #625A4D (was #4B453D, lifted one step at S-6)', () => {
    expect(w.decorColors?.['boulder:rock']).toBe('#625A4D');
  });
});
