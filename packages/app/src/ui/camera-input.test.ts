import { describe, expect, it } from 'vitest';
import { EDGE_MARGIN_PX, ZOOM_MAX, ZOOM_MIN, clampZoom, edgeVector, panDelta, zoomAnchor } from './camera-input';

describe('edgeVector', () => {
  const v = (x: number, y: number) => edgeVector(x, y, 1000, 800, EDGE_MARGIN_PX);
  it('is zero in the middle', () => expect(v(500, 400)).toEqual({ right: 0, down: 0 }));
  it('is full strength at an edge and ramps across the margin', () => {
    expect(v(0, 400)).toEqual({ right: -1, down: 0 });
    expect(v(1000, 400)).toEqual({ right: 1, down: 0 });
    expect(v(500, 0)).toEqual({ right: 0, down: -1 });
    expect(v(992, 400).right).toBeCloseTo(0.5);
  });
  it('a corner pushes both ways', () => expect(v(0, 0)).toEqual({ right: -1, down: -1 }));
  // A pointer that has left the window must not pan forever.
  it('is zero outside the surface entirely', () => {
    expect(v(-40, 400)).toEqual({ right: 0, down: 0 });
    expect(v(500, 900)).toEqual({ right: 0, down: 0 });
  });
});

describe('panDelta', () => {
  // The WASD pan (main.ts:3679-3694) IS the reference. Screen-up is (-s,-s),
  // screen-right is (+s,-s) -- if this function disagrees, edge pan and the
  // keys move the camera differently and the player feels it immediately.
  it('reproduces each WASD direction exactly', () => {
    expect(panDelta(0, -1, 2)).toEqual({ dx: -2, dy: -2 });  // up
    expect(panDelta(0, 1, 2)).toEqual({ dx: 2, dy: 2 });     // down
    expect(panDelta(-1, 0, 2)).toEqual({ dx: -2, dy: 2 });   // left
    expect(panDelta(1, 0, 2)).toEqual({ dx: 2, dy: -2 });    // right
  });
  it('a corner is the sum of its two edges', () => {
    expect(panDelta(1, 1, 2)).toEqual({ dx: 4, dy: 0 });
  });
});

describe('zoomAnchor', () => {
  it('shifts the camera so the world point under the cursor does not move', () => {
    expect(zoomAnchor({ x: 10, y: 10 }, { x: 14, y: 6 }, { x: 12, y: 8 })).toEqual({ x: 12, y: 8 });
  });
  it('is a no-op when the point did not move', () => {
    expect(zoomAnchor({ x: 10, y: 10 }, { x: 14, y: 6 }, { x: 14, y: 6 })).toEqual({ x: 10, y: 10 });
  });
});

describe('clampZoom', () => {
  it('holds the range main.ts has always clamped to', () => {
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(1)).toBe(1);
  });
});
