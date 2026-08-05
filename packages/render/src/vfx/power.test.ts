import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { firePower } from './power';

/** Minimal WeaponStats stand-in — firePower only reads these four fields. */
function w(penetration: number, damage: number, splash: number, suppression: number) {
  return {
    id: 'test',
    cls: 0,
    range: 0, rangeSq: 0, effectiveRange: 0, effectiveRangeSq: 0, minRangeSq: 0,
    accuracy: 0,
    penetration: fx.from(penetration),
    damage: fx.from(damage),
    splash: fx.from(splash),
    suppPerMiss: fx.div(fx.from(suppression), fx.fromInt(700)),
    ticksBetweenShots: 1,
    collateralRisk: 0,
  };
}

// The real roster, so the test fails if tuning drifts away from the design.
const GUN_120 = w(1300, 520, 0, 40);
const MORTAR_82 = w(35, 200, 2.0, 95);
const CANNON_30 = w(120, 90, 0, 45);
const COAX_MG = w(20, 35, 0, 60);
const RIFLES = w(8, 15, 0, 50);
const CARBINES = w(8, 12, 0, 40);

describe('firePower', () => {
  it('ranks a tank gun above a mortar above an MG above rifles', () => {
    expect(firePower(GUN_120)).toBeGreaterThan(firePower(MORTAR_82));
    expect(firePower(MORTAR_82)).toBeGreaterThan(firePower(COAX_MG));
    expect(firePower(COAX_MG)).toBeGreaterThan(firePower(RIFLES));
  });

  it('puts a mortar above an autocannon that out-penetrates it', () => {
    // The composite's whole purpose: penetration alone would rank these the
    // other way round, and it would be wrong to.
    expect(fx.toNumber(CANNON_30.penetration)).toBeGreaterThan(fx.toNumber(MORTAR_82.penetration));
    expect(firePower(MORTAR_82)).toBeGreaterThan(firePower(CANNON_30));
  });

  it('spans the roster across the full 0..1 range', () => {
    expect(firePower(GUN_120)).toBeCloseTo(1, 2);
    expect(firePower(CARBINES)).toBeCloseTo(0, 2);
  });

  it('clamps beyond the roster instead of exceeding 0..1', () => {
    expect(firePower(w(2000, 2000, 0, 0))).toBe(1);
    expect(firePower(w(0, 0, 0, 0))).toBe(0);
  });

  it('returns a finite number for a zero-stat weapon', () => {
    const p = firePower(w(0, 0, 0, 0));
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
  });
});
