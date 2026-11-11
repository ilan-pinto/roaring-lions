import { describe, expect, it } from 'vitest';
import {
  GRASS_CLUMP_SCALE_MIN,
  GRASS_CLUMP_SCALE_SPAN,
  GRASS_VARIANTS,
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

  it('rolls variants and scales inside their ranges', () => {
    const c = place(field(24, 24));
    const seen = new Set<number>();
    for (let k = 0; k < c.count; k++) {
      seen.add(c.variant[k]);
      expect(c.scale[k]).toBeGreaterThanOrEqual(GRASS_CLUMP_SCALE_MIN - 1e-6);
      expect(c.scale[k]).toBeLessThanOrEqual(GRASS_CLUMP_SCALE_MIN + GRASS_CLUMP_SCALE_SPAN + 1e-6);
      expect(c.yaw[k]).toBeGreaterThanOrEqual(0);
      expect(c.yaw[k]).toBeLessThan(1);
    }
    expect([...seen].sort()).toEqual(Array.from({ length: GRASS_VARIANTS }, (_, v) => v));
  });

  it('is sorted back to front: the depth key never decreases, and a nearer clump comes later', () => {
    const c = place(field(24, 24, (t) => { t.elevation = new Uint8Array(24 * 24).map((_, k) => (k % 24 > 12 ? 2 : 0)); }));
    let prev = -Infinity;
    for (let k = 0; k < c.count; k++) {
      const key = grassDepthKey(c.x[k], c.y[k], c.z[k]);
      expect(key).toBeGreaterThanOrEqual(prev - 1e-5);
      prev = key;
    }
    // Far corner (0, 0) first, near corner last.
    expect(c.x[0] + c.z[0]).toBeLessThan(c.x[c.count - 1] + c.z[c.count - 1]);
  });
});
