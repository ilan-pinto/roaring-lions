/**
 * Pure geometry/sizing for ground-unit shadows, exercised without a
 * `WebGLRenderer` -- same split `vehicle-tracks.test.ts`/`trail-mesh.test.ts`
 * already establish. See `unit-shadows.ts`'s top comment for the full design
 * account.
 */
import { describe, it, expect } from 'vitest';
import {
  SHADOW_SEGMENTS,
  SHADOW_VERTICES,
  SHADOW_EPSILON,
  groundShadowRadiusTiles,
  writeShadowVertices,
} from './unit-shadows';
import { unitOverlayRadiusPx, ISO_K } from './units/overlays';
import { TILE_W } from '../project';

describe('groundShadowRadiusTiles', () => {
  it('is the exact inverse of tileRadiusToEllipsePx applied to the air shadow\'s own screen formula', () => {
    for (const isSoft of [true, false]) {
      const tiles = groundShadowRadiusTiles(isSoft);
      // Re-derive the air shadow's own on-screen radius (ThreeRenderer.
      // updateOverlays: `shadowR = r * 0.7 + 2`) and confirm projecting
      // `tiles` back through the SAME dimetric identity
      // (units/overlays.ts's own tileRadiusToEllipsePx formula) reproduces
      // it exactly -- proving the conversion is algebraic, not a guess.
      const expectedScreenR = unitOverlayRadiusPx(isSoft) * 0.7 + 2;
      const reprojected = tiles * TILE_W * ISO_K;
      expect(reprojected).toBeCloseTo(expectedScreenR, 10);
    }
  });

  it('a vehicle shadow is wider than an infantry shadow', () => {
    expect(groundShadowRadiusTiles(false)).toBeGreaterThan(groundShadowRadiusTiles(true));
  });

  it('is a small, plausible fraction of one tile', () => {
    // Sanity bound, not a tuned assertion: a unit's own footprint should
    // read as a fraction of the tile it stands on, never a whole tile or
    // more, for either roster silhouette size.
    expect(groundShadowRadiusTiles(true)).toBeGreaterThan(0);
    expect(groundShadowRadiusTiles(false)).toBeLessThan(0.5);
  });
});

describe('writeShadowVertices', () => {
  it('writes SHADOW_VERTICES vertices (3 floats each) at the given slot', () => {
    const out = new Float32Array(3 * SHADOW_VERTICES * 3);
    writeShadowVertices(out, 1, 5, 0.2, 7, 0.15);
    // Slot 0 stays untouched (all zero).
    for (let i = 0; i < SHADOW_VERTICES * 3; i++) expect(out[i]).toBe(0);
    // Slot 1 is written -- every fan vertex's own centre point is the blob
    // centre exactly, and every rim vertex sits `radiusTiles` from it in
    // the XZ plane, at the SAME groundY (a flat blob).
    // Precision throughout is float32 (the GPU buffer type), not float64 --
    // `toBeCloseTo(..., 6)` is the appropriate tolerance for a value that
    // has already round-tripped through a Float32Array, not 10.
    const base = 1 * SHADOW_VERTICES * 3;
    for (let tri = 0; tri < SHADOW_SEGMENTS; tri++) {
      const t = base + tri * 9;
      expect(out[t]).toBe(5);
      expect(out[t + 1]).toBeCloseTo(0.2, 6);
      expect(out[t + 2]).toBe(7);
      const rimDx0 = out[t + 3] - 5;
      const rimDz0 = out[t + 5] - 7;
      expect(Math.hypot(rimDx0, rimDz0)).toBeCloseTo(0.15, 6);
      expect(out[t + 4]).toBeCloseTo(0.2, 6);
    }
  });

  it('the fan is a closed loop -- each triangle\'s second rim vertex matches the next triangle\'s first', () => {
    const out = new Float32Array(SHADOW_VERTICES * 3);
    writeShadowVertices(out, 0, 0, 0, 0, 1);
    for (let tri = 0; tri < SHADOW_SEGMENTS; tri++) {
      const nextTri = (tri + 1) % SHADOW_SEGMENTS;
      const thisSecondRim = tri * 9 + 6;
      const nextFirstRim = nextTri * 9 + 3;
      expect(out[thisSecondRim]).toBeCloseTo(out[nextFirstRim], 10);
      expect(out[thisSecondRim + 2]).toBeCloseTo(out[nextFirstRim + 2], 10);
    }
  });

  it('scales linearly with radiusTiles', () => {
    const small = new Float32Array(SHADOW_VERTICES * 3);
    const big = new Float32Array(SHADOW_VERTICES * 3);
    writeShadowVertices(small, 0, 0, 0, 0, 1);
    writeShadowVertices(big, 0, 0, 0, 0, 2);
    for (let i = 0; i < SHADOW_VERTICES * 3; i++) {
      expect(big[i]).toBeCloseTo(small[i] * 2, 10);
    }
  });
});

describe('SHADOW_EPSILON', () => {
  it('is distinct from terrain/shared.ts\'s MARK_EPSILON, to avoid z-fighting vehicle tracks and grove shadows', () => {
    // MARK_EPSILON is 0.01 (terrain/shared.ts) -- checked as a literal here
    // rather than imported, so a future edit to either constant makes this
    // assertion fail loudly instead of silently tracking whatever the other
    // file now says.
    expect(SHADOW_EPSILON).not.toBeCloseTo(0.01, 5);
    expect(SHADOW_EPSILON).toBeGreaterThan(0);
  });
});
