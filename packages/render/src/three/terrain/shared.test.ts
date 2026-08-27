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
import { hexToUnit, levelAt, rectCorners, pushPolygon, DECOR_ROAD, DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE } from './shared';
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
