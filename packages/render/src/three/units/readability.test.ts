import { describe, expect, it } from 'vitest';
import { HP_BAR, ringClassOf, SELECTION_RING } from './readability';

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
  it('the floor itself is 1.5 screen px, not merely satisfied by the tile width', () => {
    // 0.06 tiles x 45.25 x 0.35 = 0.95 px: at the zoom clamp the FLOOR is what draws.
    expect(SELECTION_RING.thicknessTiles * 45.25 * 0.35).toBeLessThan(1.5);
    expect(SELECTION_RING.minThicknessPx).toBe(1.5);
  });
  it('carries the approved shape numbers', () => {
    expect(SELECTION_RING.thicknessTiles).toBe(0.06);
    expect(SELECTION_RING.featherTiles).toBe(0.015);
    expect(SELECTION_RING.coreAlpha).toBe(0.9);
    expect(SELECTION_RING.haloTiles).toBe(0.03);
    expect(SELECTION_RING.haloAlpha).toBe(0.35);
    expect(SELECTION_RING.capacity).toBe(256);
  });
  it('orders the classes: foot < light < armour, and every ring is wider than its own thickness', () => {
    const r = SELECTION_RING.radiusTiles;
    expect(r.foot).toBeLessThan(r.light);
    expect(r.light).toBeLessThan(r.armour);
    for (const v of Object.values(r)) expect(v).toBeGreaterThan(SELECTION_RING.thicknessTiles);
  });
});

describe('HP_BAR', () => {
  it('keeps the 24 x 3 fill with a 1 px, 0.8 alpha frame', () => {
    expect(HP_BAR).toEqual({ widthPx: 24, heightPx: 3, framePx: 1, frameAlpha: 0.8 });
  });
});
