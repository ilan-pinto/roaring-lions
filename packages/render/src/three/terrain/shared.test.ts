/**
 * Task B3.1: tests for the helpers newly consolidated into `shared.ts`.
 *
 * `hexToUnit`, `levelAt`, `MARK_EPSILON` and the `DECOR_*` values moved here
 * byte-identical (Task B3.1's inventory diffed every copy against every
 * other copy before the move -- see the task report), so their own existing
 * coverage in `ground.test.ts`/`scatter.test.ts`/`grove.test.ts`/
 * `buildings.test.ts` (which exercise them indirectly, through each
 * builder's output) still applies unchanged and is not duplicated here.
 * `pushPolygon` and `rectCorners` did NOT move byte-identical -- they
 * generalise the four callers' own different-but-related versions -- so
 * THIS file's job is proving that generalisation reproduces every original
 * exactly, on the callers' own real inputs, not merely "in spirit".
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  hexToUnit,
  levelAt,
  rectCorners,
  pushPolygon,
  DECOR_ROAD,
  DECOR_GROVE,
  DECOR_KNOLL,
  DECOR_RIDGE,
  DECOR_DITCH,
  DECOR_MARSH,
  srgbToLinear,
  hexToLinear,
  marshWaterAt,
} from './shared';
import type { TerrainInput } from './types';

describe('hexToUnit', () => {
  it('parses a leading-# hex to a 0..1 RGB triple', () => {
    expect(hexToUnit('#FF8000')).toEqual([1, 128 / 255, 0]);
  });

  it('parses a hex with no leading #', () => {
    expect(hexToUnit('FF8000')).toEqual(hexToUnit('#FF8000'));
  });

  it('black and white round-trip exactly', () => {
    expect(hexToUnit('#000000')).toEqual([0, 0, 0]);
    expect(hexToUnit('#FFFFFF')).toEqual([1, 1, 1]);
  });
});

describe('levelAt', () => {
  const flat = (w: number, h: number, elevation: Uint8Array | null): TerrainInput => ({
    width: w,
    height: h,
    decor: null,
    elevation,
    blocked: new Uint8Array(w * h),
    cover: new Uint8Array(w * h),
  });

  it('reads the elevation grid in bounds', () => {
    const input = flat(2, 2, Uint8Array.from([1, 2, 3, 4]));
    expect(levelAt(input, 0, 0)).toBe(1);
    expect(levelAt(input, 1, 0)).toBe(2);
    expect(levelAt(input, 0, 1)).toBe(3);
    expect(levelAt(input, 1, 1)).toBe(4);
  });

  it('is 0 off the map on every side, not just negative', () => {
    const input = flat(2, 2, Uint8Array.from([9, 9, 9, 9]));
    expect(levelAt(input, -1, 0)).toBe(0);
    expect(levelAt(input, 0, -1)).toBe(0);
    expect(levelAt(input, 2, 0)).toBe(0);
    expect(levelAt(input, 0, 2)).toBe(0);
  });

  it('is 0 everywhere when the map has no elevation grid at all', () => {
    const input = flat(2, 2, null);
    expect(levelAt(input, 0, 0)).toBe(0);
  });
});

describe('DECOR_* values', () => {
  // Mirrors @lions/data's `DECOR` (map.ts) and renderer.ts's `TERRAIN_DECOR`
  // -- `@lions/render` may not import `@lions/data` (ESLint-enforced), so
  // this is the same redeclare-not-import guard every terrain builder's own
  // test already relies on (see e.g. buildings.test.ts's "// DECOR_RIDGE"
  // comment next to a literal 4).
  it('matches the canonical road/grove/knoll/ridge numbering', () => {
    expect(DECOR_ROAD).toBe(1);
    expect(DECOR_GROVE).toBe(2);
    expect(DECOR_KNOLL).toBe(3);
    expect(DECOR_RIDGE).toBe(4);
  });

  it('pins the ditch and marsh values, both paired with a mechanic', () => {
    expect(DECOR_DITCH).toBe(5);
    expect(DECOR_MARSH).toBe(6);
  });
});

describe('rectCorners: the unified 4-bound form reproduces both pre-consolidation callers', () => {
  /** `scatter.ts`'s original, pre-consolidation implementation -- kept here,
   *  not imported, specifically so this test cannot pass by both sides
   *  calling the same (possibly wrong) code. */
  function scatterRectCornersOriginal(
    halfW: number,
    topDy: number,
    botDy: number
  ): readonly (readonly [number, number])[] {
    return [
      [-halfW, topDy],
      [halfW, topDy],
      [halfW, botDy],
      [-halfW, botDy],
    ];
  }

  it('reproduces every real scatter.ts call site exactly, via rectCorners(-halfW, halfW, botDy, topDy)', () => {
    // The three distinct (halfW, topDy, botDy) triples scatter.ts actually
    // calls rectCorners with (road rut, sward blade, tussock, cover rubble --
    // road rut and rubble share a shape family but differ in numbers).
    const cases: [number, number, number][] = [
      [26, -0.75, 0.75], // road rut (TILE_W/2 - 6 at TILE_W=64)
      [0.5, -6.2, 0], // sward blade
      [3.2, -6.4, 0.6], // tussock
      [4, -1.25, 1.25], // cover rubble
    ];
    for (const [halfW, topDy, botDy] of cases) {
      const original = scatterRectCornersOriginal(halfW, topDy, botDy);
      const unified = rectCorners(-halfW, halfW, botDy, topDy);
      expect(unified).toEqual(original);
    }
  });

  it('reproduces grove.ts real call sites unchanged (grove.ts already used this exact signature)', () => {
    // grove.ts's trunk highlight rect: rectCorners(-tw*0.15, tw*0.35, th-1, th+1).
    const tw = 3.2;
    const th = 6.5;
    expect(rectCorners(-tw * 0.15, tw * 0.35, th - 1, th + 1)).toEqual([
      [-tw * 0.15, th + 1],
      [tw * 0.35, th + 1],
      [tw * 0.35, th - 1],
      [-tw * 0.15, th - 1],
    ]);
  });
});

describe('pushPolygon: the unified fan reproduces both pre-consolidation pushers', () => {
  /** `ground.ts`/`scatter.ts`/`buildings.ts`'s original pushQuad, verbatim --
   *  kept here rather than imported so the comparison is against the exact
   *  literal index sequence that shipped before this task, not a
   *  re-derivation of it. */
  function pushQuadOriginal(
    positions: number[],
    colors: number[],
    indices: number[],
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    color: [number, number, number],
    flip: boolean
  ): void {
    const base = positions.length / 3;
    for (const p of [p0, p1, p2, p3]) positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) colors.push(color[0], color[1], color[2]);
    if (flip) {
      indices.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
    } else {
      indices.push(base + 0, base + 2, base + 1, base + 0, base + 3, base + 2);
    }
  }

  const p0: [number, number, number] = [0, 0, 0];
  const p1: [number, number, number] = [1, 0, 0];
  const p2: [number, number, number] = [1, 0, 1];
  const p3: [number, number, number] = [0, 0, 1];
  const color: [number, number, number] = [0.2, 0.4, 0.6];

  it('flip: false -- identical positions, colors and indices to the original pushQuad', () => {
    const a = { positions: [] as number[], colors: [] as number[], indices: [] as number[] };
    const b = { positions: [] as number[], colors: [] as number[], indices: [] as number[] };
    pushQuadOriginal(a.positions, a.colors, a.indices, p0, p1, p2, p3, color, false);
    pushPolygon(b.positions, b.colors, b.indices, [p0, p1, p2, p3], color, false);
    expect(b).toEqual(a);
  });

  it('flip: true -- identical positions, colors and indices to the original pushQuad', () => {
    const a = { positions: [] as number[], colors: [] as number[], indices: [] as number[] };
    const b = { positions: [] as number[], colors: [] as number[], indices: [] as number[] };
    pushQuadOriginal(a.positions, a.colors, a.indices, p0, p1, p2, p3, color, true);
    pushPolygon(b.positions, b.colors, b.indices, [p0, p1, p2, p3], color, true);
    expect(b).toEqual(a);
  });

  it('appends to arrays that already hold geometry, at the right base index (both quads back to back)', () => {
    const a = { positions: [] as number[], colors: [] as number[], indices: [] as number[] };
    const b = { positions: [] as number[], colors: [] as number[], indices: [] as number[] };
    pushQuadOriginal(a.positions, a.colors, a.indices, p0, p1, p2, p3, color, false);
    pushQuadOriginal(a.positions, a.colors, a.indices, p0, p1, p2, p3, color, true);
    pushPolygon(b.positions, b.colors, b.indices, [p0, p1, p2, p3], color, false);
    pushPolygon(b.positions, b.colors, b.indices, [p0, p1, p2, p3], color, true);
    expect(b).toEqual(a);
  });

  it("grove.ts's original arbitrary-length fan (flip: false, default) is unchanged for an 8-point polygon", () => {
    const octagon: [number, number, number][] = Array.from({ length: 8 }, (_, i) => [i, 0, i * 2]);
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    pushPolygon(positions, colors, indices, octagon, color);
    // grove.ts's original formula: triangle i is (0, i+1, i) for i in [1, n-2].
    const expectedIndices: number[] = [];
    for (let i = 1; i < octagon.length - 1; i++) expectedIndices.push(0, i + 1, i);
    expect(indices).toEqual(expectedIndices);
    expect(positions.length).toBe(octagon.length * 3);
    expect(colors.length).toBe(octagon.length * 3);
  });
});

describe('srgbToLinear / hexToLinear', () => {
  it('decodes the sRGB transfer curve (0, mid grey, white)', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 9);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 9);
  });
  it('hexToLinear agrees with three.js Color (ColorManagement on)', () => {
    const [r, g, b] = hexToLinear('#C8B494');
    const c = new THREE.Color('#C8B494');
    expect(r).toBeCloseTo(c.r, 6);
    expect(g).toBeCloseTo(c.g, 6);
    expect(b).toBeCloseTo(c.b, 6);
  });
});

describe('marshWaterAt (GH-871 P2, R-6)', () => {
  const W = 12;
  /** A W x W grid with a 6x6 marsh at tiles 3..8 -- decor 6 is the literal. */
  const marsh = (): Uint8Array => {
    const d = new Uint8Array(W * W);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) d[y * W + x] = 6;
    return d;
  };
  /** Oracle: the exact distance from a point to the nearest non-marsh tile
   *  (out of bounds is not marsh), by brute force over every tile rectangle. */
  const distToNonMarsh = (d: Uint8Array, x: number, z: number): number => {
    let best = Infinity;
    for (let ty = -1; ty <= W; ty++) {
      for (let tx = -1; tx <= W; tx++) {
        const inside = tx >= 0 && ty >= 0 && tx < W && ty < W && d[ty * W + tx] === 6;
        if (inside) continue;
        const gx = Math.max(tx - x, 0, x - (tx + 1));
        const gz = Math.max(ty - z, 0, z - (ty + 1));
        best = Math.min(best, Math.hypot(gx, gz));
      }
    }
    return best;
  };

  it('is deterministic, in [0, 1], and zero with no decor layer or off the marsh', () => {
    const d = marsh();
    expect(marshWaterAt(null, W, W, 5.5, 5.5)).toBe(0);
    expect(marshWaterAt(d, W, W, 1.5, 1.5)).toBe(0);
    expect(marshWaterAt(d, W, W, -3, 40)).toBe(0);
    let max = 0;
    for (let i = 0; i < 400; i++) {
      const x = 3 + (i % 20) * 0.3;
      const z = 3 + Math.floor(i / 20) * 0.3;
      const w = marshWaterAt(d, W, W, x, z);
      expect(w).toBe(marshWaterAt(d, W, W, x, z));
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      max = Math.max(max, w);
    }
    // Not vacuous: the field is wet somewhere.
    expect(max).toBeGreaterThanOrEqual(0.5);
  });

  it('is exactly 0 within 0.25 tile of any non-marsh tile, and wet beyond it', () => {
    const d = marsh();
    let near = 0;
    let wetInside = 0;
    for (let j = 0; j < 12 * 16; j++) {
      for (let i = 0; i < 12 * 16; i++) {
        const x = (i + 0.5) / 16;
        const z = (j + 0.5) / 16;
        if (d[Math.floor(z) * W + Math.floor(x)] !== 6) continue;
        const w = marshWaterAt(d, W, W, x, z);
        if (distToNonMarsh(d, x, z) <= 0.25) {
          near++;
          expect(w, `(${x}, ${z})`).toBe(0);
        } else if (w >= 0.5) wetInside++;
      }
    }
    expect(near).toBeGreaterThan(100);
    expect(wetInside).toBeGreaterThan(100);
  });

  it('holds 25-35% of a 6x6 marsh as open water, sampled 8x8 a tile', () => {
    const d = marsh();
    let wet = 0;
    let total = 0;
    for (let y = 3; y < 9; y++) {
      for (let x = 3; x < 9; x++) {
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            total++;
            if (marshWaterAt(d, W, W, x + (i + 0.5) / 8, y + (j + 0.5) / 8) >= 0.5) wet++;
          }
        }
      }
    }
    const share = wet / total;
    console.info(`marsh water share (6x6 synthetic, 8x8 a tile): ${share.toFixed(4)} (${wet}/${total})`);
    expect(total).toBe(36 * 64);
    expect(share).toBeGreaterThanOrEqual(0.25);
    expect(share).toBeLessThanOrEqual(0.35);
  });

  it('is not tuned to one spot: the mean over 36 placements of a 6x6 marsh stays in the band', () => {
    const N = 48;
    const shares: number[] = [];
    for (let oy = 2; oy < 38; oy += 6) {
      for (let ox = 2; ox < 38; ox += 6) {
        const d = new Uint8Array(N * N);
        for (let y = oy; y < oy + 6; y++) for (let x = ox; x < ox + 6; x++) d[y * N + x] = 6;
        let wet = 0;
        for (let y = oy; y < oy + 6; y++) {
          for (let x = ox; x < ox + 6; x++) {
            for (let j = 0; j < 8; j++) {
              for (let i = 0; i < 8; i++) {
                if (marshWaterAt(d, N, N, x + (i + 0.5) / 8, y + (j + 0.5) / 8) >= 0.5) wet++;
              }
            }
          }
        }
        shares.push(wet / (36 * 64));
      }
    }
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    const inBand = shares.filter((v) => v >= 0.25 && v <= 0.35).length;
    console.info(
      `marsh water share over ${shares.length} placements: mean ${mean.toFixed(3)}, ` +
        `min ${Math.min(...shares).toFixed(3)}, max ${Math.max(...shares).toFixed(3)}, in band ${inBand}`
    );
    expect(shares.length).toBe(36);
    expect(mean).toBeGreaterThan(0.25);
    expect(mean).toBeLessThan(0.35);
    expect(inBand).toBeGreaterThanOrEqual(24);
  });
});
