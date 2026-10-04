// What survives of the billboard frame decision (WP-A3.3): the turret spring
// the mesh vehicles' `turret_pivot` follows. These five specs were the
// turret-facing block of the retired `entityFrame` suite, re-pointed at
// `stepTurretFacing` directly -- the function `entityFrame` already
// delegated to, so the arithmetic pinned is unchanged.
import { describe, it, expect } from 'vitest';
import { stepTurretFacing, TURRET_STIFFNESS, AIR_LIFT_PX, type TurretSpringInput } from './frame-state';

const input = (over: Partial<TurretSpringInput> = {}): TurretSpringInput => ({
  entityId: 0,
  facingNorm: 0,
  curX: 0,
  curY: 0,
  targetX: null,
  targetY: null,
  dtSeconds: 1 / 60,
  turretFacing: new Float64Array([0]),
  turretVel: new Float64Array([0]),
  turretSeeded: new Uint8Array([1]),
  ...over,
});

describe('stepTurretFacing', () => {
  it('seeds to the hull facing on first use, not from zero', () => {
    const i = input({ facingNorm: 0.5, dtSeconds: 0, turretSeeded: new Uint8Array([0]) });
    expect(stepTurretFacing(i)).toBeCloseTo(0.5, 10);
    expect(i.turretSeeded[0]).toBe(1);
  });

  it('springs toward a live target rather than snapping to it', () => {
    const i = input({ targetX: -5, targetY: 0 });
    const out = stepTurretFacing(i);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(0.1);
    expect(i.turretFacing[0]).toBeCloseTo(out, 10);
    expect(i.turretVel[0]).not.toBe(0);
  });

  it('bounds the Euler step under a long frame hitch (sdt clamped to 1/30)', () => {
    const i = input({ targetX: -5, targetY: 0, dtSeconds: 0.5 });
    const out = stepTurretFacing(i);
    // delta 0.5, accel 0.5 * TURRET_STIFFNESS = 45; clamped sdt 1/30.
    expect(TURRET_STIFFNESS).toBe(90);
    expect(i.turretVel[0]).toBeCloseTo(1.5, 5);
    expect(out).toBeCloseTo(0.05, 5);
  });

  it('converges on the goal over many steps', () => {
    const i = input({ targetX: -5, targetY: 0 });
    let out = 0;
    for (let k = 0; k < 240; k++) out = stepTurretFacing(i);
    expect(out).toBeCloseTo(0.5, 1);
  });

  it('returns to the hull heading over time, not instantly, once the target is lost', () => {
    const i = input({ turretFacing: new Float64Array([0.5]) });
    const first = stepTurretFacing(i);
    expect(Math.abs(first - 0.5)).toBeLessThan(0.05);
    let out = first;
    for (let k = 0; k < 240; k++) out = stepTurretFacing(i);
    expect(Math.min(out, 1 - out)).toBeLessThan(0.05);
  });
});

describe('AIR_LIFT_PX', () => {
  it('is the 14 lift pixels the air units have always flown at', () => {
    expect(AIR_LIFT_PX).toBe(14);
  });
});
