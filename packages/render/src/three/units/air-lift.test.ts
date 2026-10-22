import { describe, expect, it } from 'vitest';
import { AIR_AIRBORNE, AIR_LAND_TICKS, AIR_LANDED, AIR_LANDING, AIR_LIFT_TICKS, AIR_LIFTING } from '@lions/sim';
import { airLiftFrac } from './air-lift';

describe('airLiftFrac (GH-698)', () => {
  it('is exactly 1 airborne and exactly 0 landed, at any alpha', () => {
    for (const a of [0, 0.5, 1]) {
      expect(airLiftFrac(AIR_AIRBORNE, 0, a)).toBe(1);
      expect(airLiftFrac(AIR_LANDED, 0, a)).toBe(0);
    }
  });

  it('starts a landing at full height and descends monotonically to the ground', () => {
    // The tick the landing begins: timer = AIR_LAND_TICKS, no drop yet.
    expect(airLiftFrac(AIR_LANDING, AIR_LAND_TICKS, 0)).toBe(1);
    expect(airLiftFrac(AIR_LANDING, AIR_LAND_TICKS, 1)).toBe(1);
    let last = 1;
    for (let t = AIR_LAND_TICKS; t >= 1; t--) {
      for (const a of [0.25, 0.5, 0.75, 1]) {
        const f = airLiftFrac(AIR_LANDING, t, a);
        expect(f).toBeLessThanOrEqual(last);
        last = f;
      }
    }
    // Halfway through the clock, halfway down (smoothstep is symmetric).
    expect(airLiftFrac(AIR_LANDING, AIR_LAND_TICKS / 2, 1)).toBeCloseTo(0.5, 9);
    expect(last).toBeLessThan(0.01);
  });

  it('lifts off from the ground and climbs monotonically to full height', () => {
    expect(airLiftFrac(AIR_LIFTING, AIR_LIFT_TICKS, 0)).toBe(0);
    expect(airLiftFrac(AIR_LIFTING, AIR_LIFT_TICKS, 1)).toBe(0);
    let last = 0;
    for (let t = AIR_LIFT_TICKS; t >= 1; t--) {
      for (const a of [0.25, 0.5, 0.75, 1]) {
        const f = airLiftFrac(AIR_LIFTING, t, a);
        expect(f).toBeGreaterThanOrEqual(last);
        last = f;
      }
    }
    expect(airLiftFrac(AIR_LIFTING, AIR_LIFT_TICKS / 2, 1)).toBeCloseTo(0.5, 9);
    expect(last).toBeGreaterThan(0.99);
  });

  it('moves between ticks, not only on them', () => {
    expect(airLiftFrac(AIR_LANDING, 20, 0)).toBeGreaterThan(airLiftFrac(AIR_LANDING, 20, 1));
    expect(airLiftFrac(AIR_LIFTING, 10, 0)).toBeLessThan(airLiftFrac(AIR_LIFTING, 10, 1));
  });
});
