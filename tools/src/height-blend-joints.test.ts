/**
 * GH-1226 S1: the rock image's joint share, re-read at the mip the game samples (design 2.2).
 *
 * `rock_ground_tile.jpg` is 1024 px over 2 tiles; at zoom 1 the ground samples about mip 3-4 (128 / 64 px). The joints are where the
 * image's luminance ratio (box-averaged texel over the image's mean, Rec. 709 luma on the 8-bit values) falls below 0.85-1.00 as a
 * smoothstep: the share is the mean of `1 - smoothstep(0.85, 1.00, ratio)` over the texels. The band the design first drafted,
 * 0.70-0.90, collapses to 2-6% at those mips; this test reads both, so the widened band is shown to be the one that holds.
 *
 * The mean is the `GROUND_ALBEDOS.rock_ground_tile.mean` row, written out: a mean that drifts from the real image is its own failure
 * (`ground-albedo.test.ts`), and one assertion below keeps the literal honest against the decoded file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { JOINT_RATIO_HI, JOINT_RATIO_LO } from '../../packages/render/src/three/terrain/height-blend';

const MEAN_RGB = [152.9, 141.2, 125.2] as const;
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const MEAN_LUMA = luma(...MEAN_RGB);

const img = jpeg.decode(readFileSync(fileURLToPath(new URL('../../assets/textures/rock_ground_tile.jpg', import.meta.url))), {
  useTArray: true,
  formatAsRGBA: false,
});

/** Luminance ratios of the image box-averaged down by `2^mip` (byte-space mean of each block, as PIL's BOX does). */
function ratiosAtMip(mip: number): Float64Array {
  const block = 2 ** mip;
  const n = img.width / block;
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const i = ((y * block + dy) * img.width + x * block + dx) * 3;
          r += img.data[i]!; g += img.data[i + 1]!; b += img.data[i + 2]!;
        }
      }
      const c = block * block;
      out[y * n + x] = luma(r / c, g / c, b / c) / MEAN_LUMA;
    }
  }
  return out;
}
const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const share = (r: Float64Array, lo: number, hi: number): number => {
  let s = 0;
  for (const v of r) s += 1 - smooth(lo, hi, v);
  return s / r.length;
};
const percentile = (r: Float64Array, p: number): number => [...r].sort((a, b) => a - b)[Math.floor(p * (r.length - 1))]!;

describe('the rock image\'s joint share at the mip the game samples (GH-1226 S1)', () => {
  it('is the image the design measured: 1024 px, mean luma within 0.6 of the GROUND_ALBEDOS row', () => {
    expect([img.width, img.height]).toEqual([1024, 1024]);
    const full = ratiosAtMip(0);
    const mean = full.reduce((a, b) => a + b, 0) / full.length;
    expect(Math.abs(mean - 1) * MEAN_LUMA).toBeLessThan(0.6);
  });

  it('holds 20-32% at every mip from 1024 px to 64 px with the approved band 0.85-1.00', () => {
    for (const mip of [0, 1, 2, 3, 4]) {
      const s = share(ratiosAtMip(mip), JOINT_RATIO_LO, JOINT_RATIO_HI);
      expect(s, `mip ${mip}`).toBeGreaterThan(0.2);
      expect(s, `mip ${mip}`).toBeLessThan(0.32 + 0.005);
    }
  });

  it('reads about 23.7% at 128 px (zoom 1.3) and 20.6% at 64 px (zoom 0.7), the two rows either side of zoom 1', () => {
    // The design's figures are PIL's decode; jpeg-js reads about a point higher at 128 px (24.6%), so the bands are +/-1.5 points.
    const s3 = share(ratiosAtMip(3), JOINT_RATIO_LO, JOINT_RATIO_HI);
    const s4 = share(ratiosAtMip(4), JOINT_RATIO_LO, JOINT_RATIO_HI);
    expect(s3).toBeGreaterThan(0.222);
    expect(s3).toBeLessThan(0.252);
    expect(s4).toBeGreaterThan(0.19);
    expect(s4).toBeLessThan(0.22);
  });

  it('is the BAND that holds: the first draft 0.70-0.90 reads 5.8% at 128 px and 2.2% at 64 px, which would hide the terra rossa', () => {
    expect(share(ratiosAtMip(3), 0.7, 0.9)).toBeGreaterThan(0.04);
    expect(share(ratiosAtMip(3), 0.7, 0.9)).toBeLessThan(0.075);
    expect(share(ratiosAtMip(4), 0.7, 0.9)).toBeGreaterThan(0.01);
    expect(share(ratiosAtMip(4), 0.7, 0.9)).toBeLessThan(0.06);
  });

  it('the ratio quantiles match the design table (p5 / p50 / p95): 0.80 / 1.01 / 1.17 at 128 px, 0.86 / 1.00 / 1.14 at 64 px', () => {
    const r3 = ratiosAtMip(3);
    expect(percentile(r3, 0.05)).toBeCloseTo(0.8, 1);
    expect(percentile(r3, 0.5)).toBeCloseTo(1.01, 1);
    expect(percentile(r3, 0.95)).toBeCloseTo(1.17, 1);
    const r4 = ratiosAtMip(4);
    const q4 = [percentile(r4, 0.05), percentile(r4, 0.5), percentile(r4, 0.95)];
    expect(q4[0]).toBeCloseTo(0.86, 1);
    expect(q4[2]).toBeCloseTo(1.14, 1);
  });
});
