import { describe, expect, it } from 'vitest';
import { AIR_AIRBORNE, AIR_LAND_TICKS, AIR_LANDED, AIR_LANDING, AIR_LIFT_TICKS, AIR_LIFTING } from '@lions/sim';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { airLiftFrac } from './air-lift';
import { AIR_LIFT_PX } from './frame-state';
import {
  ROTOR_WASH_MIN_STRENGTH,
  rotorWashHeightNorm,
  rotorWashPuffSpeed,
  rotorWashStrength,
} from './rotor-wash';

describe('rotorWashStrength', () => {
  it('is strongest on the ground and hovering', () => {
    expect(rotorWashStrength(0, 0)).toBe(1);
  });
  it('falls with height and vanishes high up', () => {
    expect(rotorWashStrength(0.9, 0)).toBeLessThan(rotorWashStrength(0.3, 0));
    expect(rotorWashStrength(1.5, 0)).toBe(0);
    expect(rotorWashStrength(3.5, 0)).toBe(0);
    expect(rotorWashStrength(3.5, 0)).toBeLessThan(ROTOR_WASH_MIN_STRENGTH);
  });
  it('thins with speed but never below half at low height', () => {
    expect(rotorWashStrength(0.3, 2)).toBeLessThan(rotorWashStrength(0.3, 0));
    expect(rotorWashStrength(0, 9)).toBe(0.5);
  });
  it('reads the height norm: 0 on the ground, 1 at 1.5 wu (the design\'s radius is R0 x (1.5 + this))', () => {
    expect(rotorWashHeightNorm(0)).toBe(0);
    expect(rotorWashHeightNorm(0.75)).toBeCloseTo(0.5, 12);
    expect(rotorWashHeightNorm(1.5)).toBe(1);
    expect(rotorWashHeightNorm(9)).toBe(1);
    expect(rotorWashHeightNorm(-1)).toBe(0);
  });
});

describe('GH-984 N3: the wash rises as the aircraft comes down (a landing, over airLiftFrac)', () => {
  /** The drawn lift above the ground, world units: the renderer's `airLiftY`. */
  const lift = (airState: number, timer: number, alpha: number): number =>
    AIR_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL * airLiftFrac(airState, timer, alpha);

  it('the airborne lift is the literal 0.357 wu the whole design is written against', () => {
    expect(lift(AIR_AIRBORNE, 0, 1)).toBeCloseTo(0.357, 3);
  });

  it('a hover is 0.76 and a touchdown 1.0: the curve is no longer on its flat top over the drawn range', () => {
    expect(rotorWashStrength(lift(AIR_AIRBORNE, 0, 1), 0)).toBeCloseTo(0.762, 3);
    expect(rotorWashStrength(lift(AIR_LANDED, 0, 1), 0)).toBe(1);
  });

  it('rises tick after tick (never down, strictly most ticks) as a landing brings the height down', () => {
    let last = rotorWashStrength(lift(AIR_LANDING, AIR_LAND_TICKS, 1), 0);
    let rises = 0;
    for (let t = AIR_LAND_TICKS - 1; t >= 1; t--) {
      const s = rotorWashStrength(lift(AIR_LANDING, t, 1), 0);
      // Never down at any tick; the smoothstep ends are flat, so the count of strict rises below carries the strictness.
      expect(s, `timer ${t}`).toBeGreaterThanOrEqual(last);
      if (s > last) rises++;
      last = s;
    }
    expect(rises).toBeGreaterThan(AIR_LAND_TICKS - 8);
    // The whole descent is worth at least 0.2 (literal): hover 0.762 to touchdown 1.0.
    expect(last - rotorWashStrength(lift(AIR_LANDING, AIR_LAND_TICKS, 1), 0)).toBeGreaterThan(0.2);
    // and the middle of the descent sits between the two ends
    const mid = rotorWashStrength(lift(AIR_LANDING, AIR_LAND_TICKS / 2, 1), 0);
    expect(mid).toBeGreaterThan(0.85);
    expect(mid).toBeLessThan(0.95);
  });

  it('falls again as a lift-off climbs away', () => {
    let last = rotorWashStrength(lift(AIR_LIFTING, AIR_LIFT_TICKS, 1), 0);
    expect(last).toBe(1);
    for (let t = AIR_LIFT_TICKS - 1; t >= 1; t--) {
      const s = rotorWashStrength(lift(AIR_LIFTING, t, 1), 0);
      expect(s, `timer ${t}`).toBeLessThanOrEqual(last);
      last = s;
    }
    expect(last).toBeLessThan(0.8);
  });

  it('a frame between two ticks (alpha) moves it too: the wash is a function of (tick, alpha)', () => {
    const a = rotorWashStrength(lift(AIR_LANDING, 20, 0.25), 0);
    const b = rotorWashStrength(lift(AIR_LANDING, 20, 0.75), 0);
    expect(b).toBeGreaterThan(a);
  });
});

describe('GH-984 N3: the dust ring follows the strength (puff speed; count and size already did)', () => {
  it('is full speed at full strength and half at none, rising with strength', () => {
    expect(rotorWashPuffSpeed(1)).toBe(1);
    expect(rotorWashPuffSpeed(0)).toBe(0.5);
    expect(rotorWashPuffSpeed(0.8)).toBeGreaterThan(rotorWashPuffSpeed(0.4));
    expect(rotorWashPuffSpeed(2)).toBe(1);
    expect(rotorWashPuffSpeed(-1)).toBe(0.5);
  });
});
