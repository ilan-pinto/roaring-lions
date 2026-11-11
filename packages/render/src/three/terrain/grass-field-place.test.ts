import { describe, expect, it } from 'vitest';
import {
  grassDepthKey,
  grassPatchAt,
  placeGrassClumps,
} from './grass-field-place';
import { buildTerrainSurface } from './surface';
import { DECOR_GROVE, DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';

function field(w: number, h: number, edit?: (i: TerrainInput) => void): TerrainInput {
  const n = w * h;
  const i: TerrainInput = {
    width: w,
    height: h,
    decor: new Uint8Array(n),
    elevation: null,
    blocked: new Uint8Array(n),
    cover: new Uint8Array(n),
    boulder: new Uint8Array(n),
  };
  edit?.(i);
  return i;
}
const place = (i: TerrainInput, d?: number) => placeGrassClumps(i, buildTerrainSurface(i), d);

describe('placeGrassClumps', () => {
  it('keeps a mean of 0.7 of 16 candidates a tile at dial 1, and the dial scales it linearly', () => {
    const i = field(32, 32);
    expect(place(i, 1).count / 1024).toBeGreaterThan(11.2 - 1);
    expect(place(i, 1).count / 1024).toBeLessThan(11.2 + 1);
    const half = place(i, 0.5).count / place(i, 1).count;
    expect(half).toBeGreaterThan(0.45);
    expect(half).toBeLessThan(0.55);
  });

  it('places nothing on a blocked, covered, grove, boulder or road tile', () => {
    const i = field(16, 16, (t) => {
      t.blocked[3 * 16 + 3] = 1;
      t.cover[5 * 16 + 5] = 2;
      t.decor![7 * 16 + 7] = DECOR_GROVE;
      t.boulder![9 * 16 + 9] = 1;
      for (let x = 0; x < 16; x++) t.decor![12 * 16 + x] = DECOR_ROAD;
    });
    const c = place(i);
    // Not vacuous: a field with grass in it, so the loop below has clumps to refuse.
    expect(c.count).toBeGreaterThan(500);
    const closed = new Set([3 * 16 + 3, 5 * 16 + 5, 7 * 16 + 7, 9 * 16 + 9]);
    for (let k = 0; k < c.count; k++) {
      const tile = Math.floor(c.z[k]) * 16 + Math.floor(c.x[k]);
      expect(closed.has(tile)).toBe(false);
      expect(Math.floor(c.z[k])).not.toBe(12);
    }
  });

  it('is deterministic and the field has patches and gaps (the keep rate varies across the map)', () => {
    const i = field(48, 48);
    const a = place(i);
    const b = place(i);
    expect(Array.from(b.x)).toEqual(Array.from(a.x));
    expect(Array.from(b.scale)).toEqual(Array.from(a.scale));
    let lo = 1;
    let hi = 0;
    for (let k = 0; k < 2000; k++) {
      const p = grassPatchAt((k % 48) + 0.5, Math.floor(k / 48) + 0.5);
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    expect(hi - lo).toBeGreaterThan(0.5);
  });

  it('the patch field moves the clumps: tiles in the densest patches hold clearly more than those in the sparsest', () => {
    const w = 48;
    const c = place(field(w, w), 1);
    const perTile = new Float64Array(w * w);
    for (let k = 0; k < c.count; k++) perTile[Math.floor(c.z[k]) * w + Math.floor(c.x[k])]++;
    const tiles = Array.from({ length: w * w }, (_, t) => t).sort(
      (a, b) => grassPatchAt((a % w) + 0.5, Math.floor(a / w) + 0.5) - grassPatchAt((b % w) + 0.5, Math.floor(b / w) + 0.5)
    );
    const q = Math.floor(tiles.length / 4);
    const mean = (ts: number[]) => ts.reduce((acc, t) => acc + perTile[t], 0) / ts.length;
    const sparse = mean(tiles.slice(0, q));
    const dense = mean(tiles.slice(-q));
    // Literal floor, not a recomputed rate: a keep rule that ignores the patch field leaves the two within noise.
    expect(dense).toBeGreaterThan(sparse * 1.3);
  });

  it('rolls variants and scales inside their literal ranges (0.85 to 1.15, variants 0 to 2)', () => {
    const c = place(field(24, 24));
    const seen = new Set<number>();
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < c.count; k++) {
      seen.add(c.variant[k]);
      lo = Math.min(lo, c.scale[k]);
      hi = Math.max(hi, c.scale[k]);
      expect(c.yaw[k]).toBeGreaterThanOrEqual(0);
      expect(c.yaw[k]).toBeLessThan(1);
    }
    expect(lo).toBeGreaterThanOrEqual(0.85 - 1e-6);
    expect(hi).toBeLessThanOrEqual(1.15 + 1e-6);
    // The range is used end to end, not a sliver of it.
    expect(lo).toBeLessThan(0.87);
    expect(hi).toBeGreaterThan(1.13);
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('grassDepthKey is the camera-axis distance: literal values, and height counts', () => {
    const k = 0.6123724; // cos(30 deg) * sqrt(1/2)
    expect(grassDepthKey(0, 0, 0)).toBeCloseTo(0, 6);
    expect(grassDepthKey(2, 0, 0)).toBeCloseTo(2 * k, 5);
    expect(grassDepthKey(1, 0, 1)).toBeCloseTo(2 * k, 5);
    expect(grassDepthKey(0, 1, 0)).toBeCloseTo(0.5, 6);
    // A clump 2 up at (1, 1) is nearer the lens than one on the flat at (2, 1).
    expect(grassDepthKey(1, 2, 1)).toBeCloseTo(2 * k + 1, 5);
    expect(grassDepthKey(1, 2, 1)).toBeGreaterThan(grassDepthKey(2, 0, 1));
  });

  it('is sorted back to front: the depth key never decreases, and a nearer clump comes later', () => {
    const c = place(field(24, 24, (t) => { t.elevation = new Uint8Array(24 * 24).map((_, k) => (k % 24 > 12 ? 2 : 0)); }));
    let prev = -Infinity;
    for (let k = 0; k < c.count; k++) {
      // The key spelt out as literals, not read back from the function that sorted.
      const key = (c.x[k] + c.z[k]) * 0.6123724 + c.y[k] * 0.5;
      expect(key).toBeGreaterThanOrEqual(prev - 1e-5);
      prev = key;
    }
    // Far corner (0, 0) first, near corner last.
    expect(c.x[0] + c.z[0]).toBeLessThan(c.x[c.count - 1] + c.z[c.count - 1]);
  });
});
