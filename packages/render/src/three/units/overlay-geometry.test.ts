/**
 * Phase C: the pure half of the overlay tier -- pixel-space triangle
 * arithmetic, no `THREE.*`, exercised directly here the same way
 * `fx.test.ts` exercises `particleBillboardGeometry`/`writeParticleInstances`.
 */
import { describe, it, expect } from 'vitest';
import { screenOffsetToWorld } from '../terrain/shared';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import {
  billboardPoint,
  createTriangleSoup,
  resetSoup,
  pushTrianglePx,
  pushRectPx,
  pushRectStrokePx,
  pushEllipseFanPx,
  pushEllipseRingPx,
  OVERLAY_RING_SEGMENTS,
} from './overlay-geometry';

const ANCHOR: [number, number, number] = [3, 0.5, 7];
const RED: readonly [number, number, number] = [1, 0, 0];

describe('billboardPoint', () => {
  it('returns the anchor unchanged at (0, 0)', () => {
    expect(billboardPoint(ANCHOR, 0, 0)).toEqual(ANCHOR);
  });

  it('moves only x/z for a purely horizontal (rightPx) offset', () => {
    const right = screenOffsetToWorld(1, 0);
    const p = billboardPoint(ANCHOR, 10, 0);
    expect(p[0]).toBeCloseTo(ANCHOR[0] + right.dx * 10, 10);
    expect(p[1]).toBeCloseTo(ANCHOR[1], 10); // world Y untouched
    expect(p[2]).toBeCloseTo(ANCHOR[2] + right.dy * 10, 10);
  });

  it('moves only world Y for a purely vertical (upPx) offset', () => {
    const p = billboardPoint(ANCHOR, 0, 8);
    expect(p[0]).toBeCloseTo(ANCHOR[0], 10);
    expect(p[1]).toBeCloseTo(ANCHOR[1] + 8 * WORLD_Y_PER_LIFT_PIXEL, 10);
    expect(p[2]).toBeCloseTo(ANCHOR[2], 10);
  });
});

describe('TriangleSoup capacity', () => {
  it('starts empty and grows by exactly one vertex per corner pushed', () => {
    const soup = createTriangleSoup(16);
    expect(soup.count).toBe(0);
    pushTrianglePx(soup, ANCHOR, [[0, 0], [1, 0], [1, 1]], RED, 1);
    expect(soup.count).toBe(3);
  });

  it('resetSoup drops back to zero without touching capacity', () => {
    const soup = createTriangleSoup(16);
    pushTrianglePx(soup, ANCHOR, [[0, 0], [1, 0], [1, 1]], RED, 1);
    resetSoup(soup);
    expect(soup.count).toBe(0);
    expect(soup.capacity).toBe(16);
  });

  it('silently drops vertices past capacity rather than throwing or wrapping', () => {
    // Capacity 4: a 6-vertex rect (two triangles) should write only the
    // first 4 and stop -- mirrors ParticleInstancer/TracerBatch's own
    // `count >= capacity` early return (fx.ts), not a new policy.
    const soup = createTriangleSoup(4);
    pushRectPx(soup, ANCHOR, 0, 0, 10, 10, RED, 1);
    expect(soup.count).toBe(4);
    // Nothing past the written region should have been touched (still the
    // zero-fill Float32Array default), i.e. no out-of-bounds write occurred.
    expect(soup.positions.length).toBe(4 * 3);
  });
});

describe('pushTrianglePx', () => {
  it('writes exactly one vertex per corner, in Pixi (x-right, y-down) order', () => {
    const soup = createTriangleSoup(3);
    pushTrianglePx(soup, ANCHOR, [[5, -2], [0, 0], [-5, 2]], RED, 0.5);
    expect(soup.count).toBe(3);
    const expected0 = billboardPoint(ANCHOR, 5, 2); // y=-2 (up on screen) -> upPx=+2
    // Float32Array storage (the soup's own backing type): compare to
    // single-precision tolerance, not float64's ~15 digits.
    expect(soup.positions[0]).toBeCloseTo(expected0[0], 5);
    expect(soup.positions[1]).toBeCloseTo(expected0[1], 5);
    expect(soup.positions[2]).toBeCloseTo(expected0[2], 5);
    // colour/alpha applied to every vertex uniformly
    for (let v = 0; v < 3; v++) {
      expect(soup.colors[v * 3]).toBe(1);
      expect(soup.colors[v * 3 + 1]).toBe(0);
      expect(soup.colors[v * 3 + 2]).toBe(0);
      expect(soup.alphas[v]).toBe(0.5);
    }
  });
});

describe('pushRectPx', () => {
  it('covers all four corners across its two triangles', () => {
    const soup = createTriangleSoup(6);
    pushRectPx(soup, ANCHOR, -12, -20, 12, -17, RED, 1);
    expect(soup.count).toBe(6);
    const corners = [
      billboardPoint(ANCHOR, -12, 20),
      billboardPoint(ANCHOR, 12, 20),
      billboardPoint(ANCHOR, 12, 17),
      billboardPoint(ANCHOR, -12, 17),
    ];
    // Every one of the 4 logical corners appears at least once among the
    // 6 written vertices (two triangles sharing an edge).
    for (const c of corners) {
      let found = false;
      for (let v = 0; v < 6; v++) {
        const dx = soup.positions[v * 3] - c[0];
        const dy = soup.positions[v * 3 + 1] - c[1];
        const dz = soup.positions[v * 3 + 2] - c[2];
        // Float32Array storage: single-precision tolerance.
        if (Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5 && Math.abs(dz) < 1e-5) found = true;
      }
      expect(found).toBe(true);
    }
  });
});

describe('pushRectStrokePx', () => {
  it('writes four border rects worth of vertices (24) for one stroked rect', () => {
    const soup = createTriangleSoup(64);
    pushRectStrokePx(soup, ANCHOR, -10, -10, 10, 10, 2, RED, 1);
    expect(soup.count).toBe(24);
  });
});

describe('pushEllipseFanPx', () => {
  it('fans exactly 3 vertices per segment, all sharing the anchor as one corner', () => {
    const soup = createTriangleSoup(64);
    pushEllipseFanPx(soup, ANCHOR, 10, 5, RED, 1, 4);
    expect(soup.count).toBe(4 * 3);
    // First triangle's first vertex is the anchor itself (local origin).
    expect(soup.positions[0]).toBeCloseTo(ANCHOR[0], 5);
    expect(soup.positions[1]).toBeCloseTo(ANCHOR[1], 5);
    expect(soup.positions[2]).toBeCloseTo(ANCHOR[2], 5);
  });

  it('a true circle (rightR === upR) places its rightmost point straight along the right axis', () => {
    const soup = createTriangleSoup(64);
    pushEllipseFanPx(soup, ANCHOR, 8, 8, RED, 1, 4);
    // Segment 0's second vertex is at angle 0: (rightR, 0) in (rightPx, upPx).
    const expected = billboardPoint(ANCHOR, 8, 0);
    expect(soup.positions[3]).toBeCloseTo(expected[0], 5);
    expect(soup.positions[4]).toBeCloseTo(expected[1], 5);
    expect(soup.positions[5]).toBeCloseTo(expected[2], 5);
  });

  it('a 2:1 squished ellipse (upR = rightR / 2) halves the vertical excursion, matching Pixi\'s own .ellipse(cx, cy, r, r / 2) selection-ring convention', () => {
    const soup = createTriangleSoup(64);
    // At segment index 1 of 4, theta0 = PI/2, so that triangle's SECOND
    // vertex (its first is always the shared anchor/local-origin corner) is
    // purely `upR` away vertically -- the vertical extent, uncontaminated
    // by the horizontal radius. Below `anchor`, not above it: the angle
    // parametrisation feeds `pushTrianglePx`'s own y-down convention
    // (`pushEllipseFanPx`'s own doc comment) -- immaterial to what a full
    // ellipse actually looks like on screen, but this test pins the real
    // sign so a future edit that quietly halves the WRONG axis (upR
    // instead of rightR) still gets caught.
    pushEllipseFanPx(soup, ANCHOR, 20, 10, RED, 1, 4);
    const vIdx = 1 * 3 + 1; // triangle 1's second vertex
    const expected = billboardPoint(ANCHOR, 0, -10);
    expect(soup.positions[vIdx * 3]).toBeCloseTo(expected[0], 5);
    expect(soup.positions[vIdx * 3 + 1]).toBeCloseTo(expected[1], 5);
    expect(soup.positions[vIdx * 3 + 2]).toBeCloseTo(expected[2], 5);
  });

  it('defaults to OVERLAY_RING_SEGMENTS when the caller names none', () => {
    const soup = createTriangleSoup(1024);
    pushEllipseFanPx(soup, ANCHOR, 8, 8, RED, 1);
    expect(soup.count).toBe(OVERLAY_RING_SEGMENTS * 3);
  });
});

describe('pushEllipseRingPx', () => {
  it('writes two triangles (6 vertices) per segment', () => {
    const soup = createTriangleSoup(256);
    pushEllipseRingPx(soup, ANCHOR, 10, 5, 2, RED, 1, 8);
    expect(soup.count).toBe(8 * 6);
  });

  it('the inner edge sits strictly closer to the anchor than the outer edge, by the stroke width', () => {
    const soup = createTriangleSoup(6);
    pushEllipseRingPx(soup, ANCHOR, 10, 10, 4, RED, 1, 1);
    // segment 0, theta=0: in0 = (rIn, 0), out0 = (rOut, 0) in (rightPx,upPx)
    // with rIn = 10 - 2 = 8, rOut = 10 + 2 = 12.
    const inner = billboardPoint(ANCHOR, 8, 0);
    const outer = billboardPoint(ANCHOR, 12, 0);
    expect(soup.positions[0]).toBeCloseTo(inner[0], 5);
    expect(soup.positions[2]).toBeCloseTo(inner[2], 5);
    expect(soup.positions[3]).toBeCloseTo(outer[0], 5);
    expect(soup.positions[5]).toBeCloseTo(outer[2], 5);
  });

  it('clamps the inner radius at 0 rather than crossing to a negative radius', () => {
    const soup = createTriangleSoup(6);
    // strokeWidthPx (20) exceeds 2*rightR (10) -- inner radius would go
    // negative without the clamp, which would fold the ring's inner edge
    // through the centre and out the other side.
    pushEllipseRingPx(soup, ANCHOR, 5, 5, 20, RED, 1, 1);
    const inner = billboardPoint(ANCHOR, 0, 0);
    expect(soup.positions[0]).toBeCloseTo(inner[0], 5);
    expect(soup.positions[1]).toBeCloseTo(inner[1], 5);
    expect(soup.positions[2]).toBeCloseTo(inner[2], 5);
  });
});
