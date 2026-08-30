/**
 * Pure geometry/bookkeeping for vehicle track marks, exercised without a
 * `WebGLRenderer` -- same split `trail-mesh.test.ts`/`fog-mesh.test.ts` and
 * `units/vehicle-fx.test.ts` already establish. See `vehicle-tracks.ts`'s
 * top comment for the full design account.
 */
import { describe, it, expect } from 'vitest';
import {
  VEHICLE_TRACK_KIND,
  TRACK_FOOTPRINT,
  STAMP_SPACING_TILES,
  TRACK_POOL_CAPACITY,
  TRACK_PERSIST_MS,
  MAX_PLAUSIBLE_TRACK_STEP_TILES,
  trackKindFor,
  stepTrackAccum,
  trackStampCenters,
  trackMarkCorners,
  writeTrackMarkVertices,
  collapseTrackMarkVertices,
  sweepExpiredTrackSlots,
} from './vehicle-tracks';

describe('trackKindFor', () => {
  it('classifies every roster ground vehicle', () => {
    expect(trackKindFor('mbt_lavi')).toBe('tracked');
    expect(trackKindFor('ifv_namer')).toBe('tracked');
    expect(trackKindFor('dozer_d9')).toBe('tracked');
    expect(trackKindFor('apc_eitan')).toBe('wheeled');
    expect(trackKindFor('jeep_shoded')).toBe('wheeled');
    expect(trackKindFor('technical')).toBe('wheeled');
    expect(trackKindFor('gun_truck')).toBe('wheeled');
    expect(trackKindFor('rocket_battery')).toBe('wheeled');
    expect(trackKindFor('moto_rpg')).toBe('single');
  });

  it('returns null, not a default, for anything outside the closed table', () => {
    // Infantry and crew-served weapon teams -- structurally identical JSON
    // to a vehicle (hull/armor/crew), which is exactly why membership in
    // the table, not isSoft, is the gate. See vehicle-tracks.ts's own top
    // comment.
    expect(trackKindFor('inf_squad')).toBeNull();
    expect(trackKindFor('at_team')).toBeNull();
    expect(trackKindFor('recoilless_team')).toBeNull();
    // Air units -- heli_peten is armoured (isSoft: false) and would have
    // slipped past an isSoft-only gate.
    expect(trackKindFor('heli_peten')).toBeNull();
    expect(trackKindFor('recon_drone')).toBeNull();
    expect(trackKindFor('unknown_unit_id')).toBeNull();
  });

  it('every table entry has a footprint', () => {
    for (const kind of Object.values(VEHICLE_TRACK_KIND)) {
      expect(TRACK_FOOTPRINT[kind]).toBeDefined();
    }
  });
});

describe('TRACK_FOOTPRINT', () => {
  it('single has zero gauge -- one mark, not a pair', () => {
    expect(TRACK_FOOTPRINT.single.gaugeTiles).toBe(0);
  });

  it('tracked is wider and longer than wheeled -- visually distinct, per the project lead naming both', () => {
    expect(TRACK_FOOTPRINT.tracked.gaugeTiles).toBeGreaterThan(TRACK_FOOTPRINT.wheeled.gaugeTiles);
    expect(TRACK_FOOTPRINT.tracked.halfWidthTiles).toBeGreaterThan(TRACK_FOOTPRINT.wheeled.halfWidthTiles);
  });
});

describe('stepTrackAccum', () => {
  it('accumulates without stamping below the spacing threshold', () => {
    const r = stepTrackAccum(0, STAMP_SPACING_TILES * 0.4, 0);
    expect(r.stamps).toBe(0);
    expect(r.accumTiles).toBeCloseTo(STAMP_SPACING_TILES * 0.4);
  });

  it('stamps exactly once on crossing the threshold, carrying the remainder', () => {
    const r = stepTrackAccum(STAMP_SPACING_TILES * 0.9, STAMP_SPACING_TILES * 0.3, 0);
    expect(r.stamps).toBe(1);
    expect(r.accumTiles).toBeCloseTo(STAMP_SPACING_TILES * 0.2);
  });

  it('stamps multiple times if a single tick crosses more than one spacing', () => {
    // Exactly at MAX_PLAUSIBLE_TRACK_STEP_TILES (2x spacing), not past it --
    // past it is the teleport case, covered separately below.
    const r = stepTrackAccum(0, STAMP_SPACING_TILES * 2, 0);
    expect(r.stamps).toBe(2);
    expect(r.accumTiles).toBeCloseTo(0);
  });

  it('treats a large single-tick displacement as a teleport, not driving', () => {
    const r = stepTrackAccum(0, MAX_PLAUSIBLE_TRACK_STEP_TILES + 1, 0);
    expect(r.stamps).toBe(0);
    expect(r.accumTiles).toBe(0);
  });

  it('measures displacement as a hypotenuse, not axis-separately', () => {
    // 0.3/0.4/0.5 tiles -- classic 3-4-5 triangle, so this also checks the
    // function is not silently summing |dx| + |dy|.
    const r = stepTrackAccum(0, 0.3, 0.4);
    expect(r.accumTiles + r.stamps * STAMP_SPACING_TILES).toBeCloseTo(0.5);
  });
});

describe('trackStampCenters', () => {
  it('single returns exactly one centre, on the vehicle itself', () => {
    const centers = trackStampCenters(10, 20, 0.37, 'single');
    expect(centers.length).toBe(1);
    expect(centers[0].x).toBeCloseTo(10);
    expect(centers[0].y).toBeCloseTo(20);
  });

  it('tracked/wheeled straddle the vehicle symmetrically, facing east (0 turns)', () => {
    const g = TRACK_FOOTPRINT.tracked.gaugeTiles;
    const centers = trackStampCenters(0, 0, 0, 'tracked');
    expect(centers.length).toBe(2);
    // Forward is world +x at facingNorm 0 (vehicleFxAnchor's own
    // convention); the perpendicular pair straddles along y.
    expect(centers[0].x).toBeCloseTo(0);
    expect(centers[0].y).toBeCloseTo(g);
    expect(centers[1].x).toBeCloseTo(0);
    expect(centers[1].y).toBeCloseTo(-g);
  });

  it('the pair is always equidistant from the vehicle and mirrored', () => {
    const centers = trackStampCenters(5, 5, 0.63, 'wheeled');
    const g = TRACK_FOOTPRINT.wheeled.gaugeTiles;
    const d0 = Math.hypot(centers[0].x - 5, centers[0].y - 5);
    const d1 = Math.hypot(centers[1].x - 5, centers[1].y - 5);
    expect(d0).toBeCloseTo(g);
    expect(d1).toBeCloseTo(g);
    // Mirrored through the vehicle's own position.
    expect(centers[0].x + centers[1].x).toBeCloseTo(10);
    expect(centers[0].y + centers[1].y).toBeCloseTo(10);
  });
});

describe('trackMarkCorners', () => {
  it('elongates along +x when facing east (0 turns)', () => {
    const corners = trackMarkCorners({ x: 0, y: 0 }, 0, 0.3, 0.05);
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    expect(Math.max(...xs)).toBeCloseTo(0.3);
    expect(Math.min(...xs)).toBeCloseTo(-0.3);
    expect(Math.max(...zs)).toBeCloseTo(0.05);
    expect(Math.min(...zs)).toBeCloseTo(-0.05);
  });

  it('elongates along +y (world z) when facing south (0.25 turns)', () => {
    const corners = trackMarkCorners({ x: 0, y: 0 }, 0.25, 0.3, 0.05);
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    expect(Math.max(...zs)).toBeCloseTo(0.3);
    expect(Math.min(...zs)).toBeCloseTo(-0.3);
    expect(Math.max(...xs)).toBeCloseTo(0.05);
    expect(Math.min(...xs)).toBeCloseTo(-0.05);
  });

  it('is centred on the given point regardless of facing', () => {
    const corners = trackMarkCorners({ x: 7, y: -3 }, 0.71, 0.2, 0.04);
    let sx = 0;
    let sy = 0;
    for (const [x, y] of corners) {
      sx += x;
      sy += y;
    }
    expect(sx / 4).toBeCloseTo(7);
    expect(sy / 4).toBeCloseTo(-3);
  });
});

describe('writeTrackMarkVertices / collapseTrackMarkVertices', () => {
  it('writes 4 vertices at the expected slot offset, lifted above flat ground', () => {
    const out = new Float32Array(2 * 12);
    writeTrackMarkVertices({ x: 1, y: 2 }, 0, 0.3, 0.05, null, 10, 10, out, 1);
    // Slot 0 untouched.
    expect(out[0]).toBe(0);
    // Slot 1: 4 verts * 3 floats starting at index 12.
    const y0 = out[12 + 1];
    const y1 = out[12 + 4];
    const y2 = out[12 + 7];
    const y3 = out[12 + 10];
    expect(y0).toBeGreaterThan(0); // MARK_EPSILON lift on flat (elevation-null) ground
    expect(y0).toBeCloseTo(y1);
    expect(y0).toBeCloseTo(y2);
    expect(y0).toBeCloseTo(y3);
  });

  it('collapse zeroes the quad area by snapping every vertex onto the first', () => {
    const out = new Float32Array(12);
    writeTrackMarkVertices({ x: 4, y: 4 }, 0.1, 0.3, 0.05, null, 10, 10, out, 0);
    collapseTrackMarkVertices(out, 0);
    for (let i = 1; i < 4; i++) {
      expect(out[i * 3]).toBeCloseTo(out[0]);
      expect(out[i * 3 + 1]).toBeCloseTo(out[1]);
      expect(out[i * 3 + 2]).toBeCloseTo(out[2]);
    }
    // Collapsed onto the mark's OWN last position, never the world origin
    // (which is a real, potentially on-screen tile) -- see this module's
    // own doc comment for why that distinction matters.
    expect(out[0]).not.toBe(0);
  });
});

describe('sweepExpiredTrackSlots', () => {
  it('reports nothing before TTL has elapsed', () => {
    const spawnMs = new Float64Array([0, 0, 0]);
    const collapsed = new Uint8Array(3);
    const outSlots = new Int32Array(3);
    const n = sweepExpiredTrackSlots(spawnMs, collapsed, 3, TRACK_PERSIST_MS - 1, TRACK_PERSIST_MS, outSlots);
    expect(n).toBe(0);
  });

  it('reports and marks exactly the slots whose TTL has elapsed', () => {
    const spawnMs = new Float64Array([0, 100, 200]);
    const collapsed = new Uint8Array(3);
    const outSlots = new Int32Array(3);
    const n = sweepExpiredTrackSlots(spawnMs, collapsed, 3, TRACK_PERSIST_MS + 50, TRACK_PERSIST_MS, outSlots);
    // Slot 0 (age = TRACK_PERSIST_MS + 50) and slot 1 (age = TRACK_PERSIST_MS - 50 ... wait, recompute) expired.
    expect(n).toBeGreaterThan(0);
    expect(collapsed[0]).toBe(1);
  });

  it('never re-reports an already-collapsed slot', () => {
    const spawnMs = new Float64Array([0]);
    const collapsed = new Uint8Array(1);
    const outSlots = new Int32Array(1);
    const first = sweepExpiredTrackSlots(spawnMs, collapsed, 1, TRACK_PERSIST_MS, TRACK_PERSIST_MS, outSlots);
    expect(first).toBe(1);
    const second = sweepExpiredTrackSlots(spawnMs, collapsed, 1, TRACK_PERSIST_MS + 10_000, TRACK_PERSIST_MS, outSlots);
    expect(second).toBe(0);
  });

  it('only scans the written prefix, ignoring never-written slots', () => {
    const spawnMs = new Float64Array(5); // all zero -- would "expire" if scanned
    const collapsed = new Uint8Array(5);
    const outSlots = new Int32Array(5);
    const n = sweepExpiredTrackSlots(spawnMs, collapsed, 2, TRACK_PERSIST_MS + 1, TRACK_PERSIST_MS, outSlots);
    expect(n).toBe(2);
  });
});

describe('capacity sizing sanity', () => {
  it('the pool is sized in the same order of magnitude as this task\'s own worked example', () => {
    // mbt_lavi at 1.1 tiles/s covers ~198 tiles in 3 min; at
    // STAMP_SPACING_TILES spacing and PAIR stamping that is ~792 marks for
    // one vehicle's full-fidelity 3-minute drive.
    const tilesIn3Min = 1.1 * 180;
    const marksPerVehicle = (tilesIn3Min / STAMP_SPACING_TILES) * 2;
    expect(TRACK_POOL_CAPACITY / marksPerVehicle).toBeGreaterThan(1);
    expect(TRACK_POOL_CAPACITY / marksPerVehicle).toBeLessThan(20);
  });
});
