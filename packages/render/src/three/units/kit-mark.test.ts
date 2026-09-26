// The kit mark's geometry (WP-S3g plan 2, Task 1). Every number here is the
// table the lead approved at G-N; `KIT_MARK` is its code form, and the first
// test compares them one for one so a drifted constant cannot pass as a
// reasoned one.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KIT_MARK,
  KIT_COLOR_KEY,
  KIT_EDGE_COLOR_KEY,
  kitBarRects,
  kitLevelsByType,
  kitMarkTriangles,
  kitMarkVertexCount,
  kitPlateOutline,
  kitPlateSteel,
  type MarkPoint,
} from './kit-mark';
import { unitOverlayRadiusPx } from './overlays';

const RADII = [unitOverlayRadiusPx(true), unitOverlayRadiusPx(false)] as const; // 7, 11
const LEVELS = [1, 2, 3] as const;

/** Signed distance from p to the line a->b (sign depends on the side). */
function signedDistance(p: MarkPoint, a: MarkPoint, b: MarkPoint): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  return (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / Math.hypot(ex, ey);
}

function centroid(poly: readonly MarkPoint[]): MarkPoint {
  return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
}

/** How far p sits inside a convex polygon: the smallest distance to any edge
 *  line, positive inside. */
function insideDistance(p: MarkPoint, poly: readonly MarkPoint[]): number {
  const c = centroid(poly);
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    min = Math.min(min, Math.sign(signedDistance(c, a, b)) * signedDistance(p, a, b));
  }
  return min;
}

function polygonArea(poly: readonly MarkPoint[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function listArea(tris: readonly MarkPoint[]): number {
  let s = 0;
  for (let i = 0; i < tris.length; i += 3) s += polygonArea([tris[i], tris[i + 1], tris[i + 2]]);
  return s;
}

function bbox(points: readonly MarkPoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

describe('the approved numbers (G-N)', () => {
  it('match the table the lead approved, number for number', () => {
    expect(KIT_MARK).toEqual({
      widthPx: 10,
      heightPx: 12,
      bottomAboveR: 11,
      bevelUpPx: 3,
      bevelSweep: 14 / 24,
      outlinePx: 1,
      barWidthPx: 4,
      barHeightPx: 2,
      barGapPx: 1,
      firstBarBottomPx: 10,
    });
    expect(KIT_COLOR_KEY).toBe('gunmetal.0');
    expect(KIT_EDGE_COLOR_KEY).toBe('shadow.0');
  });
});

describe('kitPlateOutline', () => {
  it('is the 10 x 12 box with its two upper corners bevelled', () => {
    expect(kitPlateOutline()).toEqual([
      [0, 12],
      [0, 3],
      [1.75, 0],
      [8.25, 0],
      [10, 3],
      [10, 12],
    ]);
  });

  it('bevels at the chevron sweep: 14 across for every 24 up', () => {
    const [, a, b] = kitPlateOutline();
    expect((b[0] - a[0]) / (a[1] - b[1])).toBeCloseTo(14 / 24, 12);
  });
});

describe('kitPlateSteel', () => {
  it('lies exactly one outline width inside every edge of the plate', () => {
    const outer = kitPlateOutline();
    const inner = kitPlateSteel();
    expect(inner).toHaveLength(outer.length);
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i];
      const b = outer[(i + 1) % outer.length];
      expect(Math.abs(signedDistance(inner[i], a, b)), `inner ${i} vs edge ${i}`).toBeCloseTo(1, 9);
      expect(Math.abs(signedDistance(inner[(i + 1) % inner.length], a, b)), `inner ${i + 1} vs edge ${i}`).toBeCloseTo(1, 9);
    }
  });

  it('reads the bevel inner corners the table quotes', () => {
    const s = kitPlateSteel();
    expect(s[1][0]).toBeCloseTo(1, 9);
    expect(s[1][1]).toBeCloseTo(3.2703, 3);
    expect(s[2][0]).toBeCloseTo(2.3244, 3);
    expect(s[2][1]).toBeCloseTo(1, 9);
  });
});

describe('kitBarRects', () => {
  it('draws one bar per level, climbing from the bottom, 2 px tall with 1 px gaps', () => {
    expect(kitBarRects(1)).toEqual([[3, 8, 7, 10]]);
    expect(kitBarRects(2)).toEqual([
      [3, 8, 7, 10],
      [3, 5, 7, 7],
    ]);
    expect(kitBarRects(3)).toEqual([
      [3, 8, 7, 10],
      [3, 5, 7, 7],
      [3, 2, 7, 4],
    ]);
  });

  it('leaves at least one pixel of steel between every bar and the outline', () => {
    const steel = kitPlateSteel();
    for (const [x0, y0, x1, y1] of kitBarRects(3)) {
      for (const corner of [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ] as const) {
        expect(insideDistance(corner, steel), `bar corner ${corner.join(',')}`).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
  });
});

describe('kitMarkTriangles', () => {
  it.each(RADII)('at r = %i covers exactly the plate, the steel and the bars', (r) => {
    for (const level of LEVELS) {
      const t = kitMarkTriangles(r, level);
      for (const list of [t.edge, t.steel, t.bars]) expect(list.length % 3).toBe(0);
      expect(listArea(t.edge)).toBeCloseTo(polygonArea(kitPlateOutline()), 9);
      expect(listArea(t.steel)).toBeCloseTo(polygonArea(kitPlateSteel()), 9);
      expect(listArea(t.bars)).toBeCloseTo(level * KIT_MARK.barWidthPx * KIT_MARK.barHeightPx, 9);
      expect(t.edge.length + t.steel.length + t.bars.length).toBe(kitMarkVertexCount(level));
    }
  });

  it('costs 24 vertices plus 6 a bar: 30, 36, 42', () => {
    expect(LEVELS.map(kitMarkVertexCount)).toEqual([30, 36, 42]);
  });

  it.each(RADII)('at r = %i sits centred, its bottom one pixel above the HP bar', (r) => {
    const b = bbox(kitMarkTriangles(r, 3).edge);
    expect(b).toEqual({ minX: -5, maxX: 5, minY: -(r + 23), maxY: -(r + 11) });
    // The HP bar is `rect(anchor, -12, -(r + 10), 12, -(r + 7))`: its top is y = -(r + 10).
    expect(-(r + 10) - b.maxY).toBe(1);
  });

  it.each(RADII)('at r = %i clears the veterancy chevron and the group badge', (r) => {
    const b = bbox(kitMarkTriangles(r, 3).edge);
    // Chevron: a 12 x 12 quad centred (r + 4) right, (r + 4) up; its top edge is y = -(r + 10).
    expect(-(r + 4) - 6 - b.maxY).toBeGreaterThanOrEqual(1);
    // Badge: a disc of radius 7 centred (-(r + 4), -(r + 4)).
    const cx = -(r + 4);
    const cy = -(r + 4);
    const nx = Math.min(Math.max(cx, b.minX), b.maxX);
    const ny = Math.min(Math.max(cy, b.minY), b.maxY);
    expect(Math.hypot(cx - nx, cy - ny) - 7).toBeGreaterThanOrEqual(2);
  });

  it('draws 3.5 x 4.2, 10 x 12 and 25 x 30 px at zoom 0.35, 1 and 2.5', () => {
    const b = bbox(kitMarkTriangles(7, 1).edge);
    const sizes = [0.35, 1, 2.5].map((z) => [(b.maxX - b.minX) * z, (b.maxY - b.minY) * z]);
    expect(sizes[0][0]).toBeCloseTo(3.5, 9);
    expect(sizes[0][1]).toBeCloseTo(4.2, 9);
    expect(sizes.slice(1)).toEqual([
      [10, 12],
      [25, 30],
    ]);
  });

  it('returns the same frozen lists every call, so the overlay loop allocates nothing per unit', () => {
    expect(kitMarkTriangles(7, 2)).toBe(kitMarkTriangles(7, 2));
    expect(Object.isFrozen(kitMarkTriangles(11, 3).bars)).toBe(true);
    expect(Object.isFrozen(kitMarkTriangles(11, 3).bars[0])).toBe(true);
  });
});

describe('kitLevelsByType', () => {
  it("resolves each sim type index to its type's level", () => {
    expect([...kitLevelsByType(['inf_squad', 'mbt_lavi', 'militia_cell'], { inf_squad: 1, mbt_lavi: 3 })]).toEqual([1, 3, 0]);
  });

  it('is all zero with no option: a renderer built without one draws no mark', () => {
    expect([...kitLevelsByType(['inf_squad', 'mbt_lavi'], undefined)]).toEqual([0, 0]);
  });

  it('draws nothing for a value that is not a level, rather than a wrong mark', () => {
    expect([...kitLevelsByType(['a', 'b', 'c', 'd', 'e'], { a: 4, b: -1, c: 1.5, d: Number.NaN, e: 0 })]).toEqual([0, 0, 0, 0, 0]);
  });

  it("reads only the record's own keys, never an inherited one", () => {
    const inherited = Object.create({ inf_squad: 2 }) as Record<string, number>;
    expect([...kitLevelsByType(['inf_squad'], inherited)]).toEqual([0]);
  });
});

describe('the Pixi backend', () => {
  it('never reads unitKit: the mark is three-only, permanently (spec §3.4, R-8)', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer.ts'), 'utf8');
    expect(src).not.toContain('unitKit');
  });
});
