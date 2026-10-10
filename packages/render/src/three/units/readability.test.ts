import { describe, expect, it } from 'vitest';
import {
  ELLIPSE_BY_TYPE,
  ELLIPSE_PAD_TILES,
  HP_BAR,
  RING_CACHE,
  RING_CLASS_OVERRIDE,
  RING_GRID_LARGE,
  RING_GRID_XL,
  RING_LARGE_TILES,
  RING_XL_TILES,
  RING_GRID_XXL,
  RING_XXL_TILES,
  RING_SAG_STEPS,
  ringClassOf,
  RADIUS_BY_TYPE,
  ringRadiusFor,
  SELECTED_RING_SCALE,
  SELECTION_RING,
  TEAM_RING,
} from './readability';

describe('ringClassOf', () => {
  it("classifies by the sim's own flags, air first", () => {
    expect(ringClassOf({ isAir: true, wheeled: true, isSoft: true })).toBe('air');
    expect(ringClassOf({ isAir: false, wheeled: true, isSoft: true })).toBe('light');
    expect(ringClassOf({ isAir: false, wheeled: true, isSoft: false })).toBe('armour');
    expect(ringClassOf({ isAir: false, wheeled: false, isSoft: true })).toBe('foot');
  });
});

describe('SELECTION_RING', () => {
  it('the thickness floor holds at the zoom clamp', () => {
    expect(Math.max(SELECTION_RING.thicknessTiles * 45.25 * 0.35, SELECTION_RING.minThicknessPx)).toBeGreaterThanOrEqual(1.5);
  });
  it('the floor itself is 2.5 screen px, not merely satisfied by the tile width', () => {
    // 0.10 tiles x 45.25 x 0.35 = 1.58 px: at the zoom clamp the FLOOR is what draws.
    expect(SELECTION_RING.thicknessTiles * 45.25 * 0.35).toBeLessThan(2.5);
    expect(SELECTION_RING.minThicknessPx).toBe(2.5);
  });
  it('carries the approved shape numbers (GH-346: the bigger ring)', () => {
    expect(SELECTION_RING.thicknessTiles).toBe(0.1);
    expect(SELECTION_RING.featherTiles).toBe(0.015);
    expect(SELECTION_RING.coreAlpha).toBe(0.95);
    expect(SELECTION_RING.haloTiles).toBe(0.03);
    expect(SELECTION_RING.haloAlpha).toBe(0.5);
    expect(SELECTION_RING.capacity).toBe(256);
  });
  it('orders the classes: foot < light < armour, and every ring is wider than its own thickness', () => {
    const r = SELECTION_RING.radiusTiles;
    expect(r.foot).toBeLessThan(r.light);
    expect(r.light).toBeLessThan(r.armour);
    for (const v of Object.values(r)) expect(v).toBeGreaterThan(SELECTION_RING.thicknessTiles);
  });
});

describe('GH-346 ring numbers', () => {
  it('the selected ring draws at 1.25 x the type ring, and the team ring carries its approved numbers', () => {
    expect(SELECTED_RING_SCALE).toBe(1.25);
    expect(TEAM_RING).toEqual({ thicknessTiles: 0.05, minThicknessPx: 1.5, coreAlpha: 0.55, haloAlpha: 0.3, capacity: 512 });
  });
});

describe('HP_BAR', () => {
  it('keeps the 24 x 3 fill with a 1 px frame at full alpha (G-MOCK: "Frame 1.0")', () => {
    expect(HP_BAR).toEqual({ widthPx: 24, heightPx: 3, framePx: 1, frameAlpha: 1 });
  });
});

describe('ringRadiusFor', () => {
  it('uses the type row, and the class value for a type with none', () => {
    expect(ringRadiusFor('mbt_lavi', 'armour')).toBe(1.15);
    expect(ringRadiusFor('no_such_unit', 'foot')).toBe(SELECTION_RING.radiusTiles.foot);
  });
  it('overrides only dozer_d9, to light', () => {
    expect(RING_CLASS_OVERRIDE).toEqual({ dozer_d9: 'light' });
  });
});

describe('ELLIPSE_BY_TYPE (G-MOCK: "Team colour + ellipse")', () => {
  it('carries the mocked numbers: pad 0.30, Lavi 1.17 x 0.78 centred 0.18 behind; Namer grown to hold its corners', () => {
    expect(ELLIPSE_PAD_TILES).toBe(0.3);
    expect(ELLIPSE_BY_TYPE.mbt_lavi).toEqual({ along: 1.17, across: 0.78, offsetAlong: -0.18 });
    // Fix round 1: grown from the mocked 1.52 x 0.97 so its hull corners are inside.
    // B8 v2 (2026-10-02): the Namer is a new Meshy remesh (7.3 m x 4.12 m), so
    // the generator re-measured it at 1.61 x 1.05 -- the mock's rule, not its number.
    expect(ELLIPSE_BY_TYPE.ifv_namer).toEqual({ along: 1.61, across: 1.05, offsetAlong: 0 });
  });
  it('is for ground vehicles only: no figure and no aircraft', () => {
    for (const id of ['inf_squad', 'at_team', 'heli_peten', 'paramotor', 'recon_drone']) {
      expect(ELLIPSE_BY_TYPE[id], id).toBeUndefined();
    }
  });
  it('every ellipse is longer than it is wide, and both axes clear the pad', () => {
    for (const [id, e] of Object.entries(ELLIPSE_BY_TYPE)) {
      expect(e.along, id).toBeGreaterThan(e.across);
      expect(e.across, id).toBeGreaterThan(ELLIPSE_PAD_TILES);
    }
  });
});

describe('the ring grid and cache numbers (Task 5, fix round 1)', () => {
  it('large rings: a 6x6 grid over 0.72 tiles (fix round 3, was 0.75), lift measured on a 2-step lattice', () => {
    expect(RING_GRID_LARGE).toBe(6);
    expect(RING_LARGE_TILES).toBe(0.72);
    expect(RING_SAG_STEPS).toBe(2);
    // Every foot ring stays on the small grid; every vehicle ellipse goes large.
    expect(Math.max(...Object.values(RADIUS_BY_TYPE).filter((r) => r < 0.6))).toBeLessThanOrEqual(RING_LARGE_TILES);
    for (const e of Object.values(ELLIPSE_BY_TYPE)) expect(e.along).toBeGreaterThan(RING_LARGE_TILES);
  });
  it('a third tier, 7x7 over 1.23 tiles (1.4, then 1.28 in fix round 3, then 1.23 for GH-346\'s thicker band)', () => {
    expect(RING_GRID_XL).toBe(7);
    expect(RING_XL_TILES).toBe(1.23);
    const xl = Object.entries(ELLIPSE_BY_TYPE).filter(([, e]) => e.along > RING_XL_TILES).map(([id]) => id).sort();
    expect(xl).toEqual(['apc_eitan', 'apc_kipod', 'dozer_d9', 'ifv_namer', 'rocket_battery']);
  });
  it('GH-346: a fourth tier, 9x9 over 1.5 tiles -- at 1x exactly the four grown ellipses', () => {
    expect(RING_GRID_XXL).toBe(9);
    expect(RING_XXL_TILES).toBe(1.5);
    const xxl = Object.entries(ELLIPSE_BY_TYPE).filter(([, e]) => e.along > RING_XXL_TILES).map(([id]) => id).sort();
    expect(xxl).toEqual(['apc_eitan', 'apc_kipod', 'dozer_d9', 'ifv_namer']);
  });
  it('a cached ring is rebuilt past 0.05 tile of travel or about 2 degrees of turn', () => {
    expect(RING_CACHE.moveTiles).toBe(0.05);
    expect(RING_CACHE.turnRad).toBeCloseTo((2 * Math.PI) / 180, 12);
  });
});
