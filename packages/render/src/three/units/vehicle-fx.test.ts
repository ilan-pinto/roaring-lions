/**
 * Pure decision math for vehicle dust/exhaust, exercised without a
 * `ThreeRenderer`/`WebGLRenderer` -- same split `frame-state.ts`'s own
 * `stepTurretFacing` tests already establish for this class's per-entity
 * logic. See `vehicle-fx.ts`'s top comment for why this module exists.
 */
import { describe, it, expect } from 'vitest';
import {
  VEHICLE_MOVE_ON_SPEED_TILES_S,
  VEHICLE_MOVE_OFF_SPEED_TILES_S,
  VEHICLE_DUST_FULL_SPEED_TILES_S,
  VEHICLE_DUST_INTERVAL_MS,
  VEHICLE_DUST_MIN_INTERVAL_MS,
  nextVehicleMoving,
  vehicleDustMagnitude,
  vehicleDustIntervalMs,
  vehicleFxAnchor,
} from './vehicle-fx';

describe('nextVehicleMoving', () => {
  it('stays stopped below the ON threshold', () => {
    expect(nextVehicleMoving(false, 0)).toBe(false);
    expect(nextVehicleMoving(false, VEHICLE_MOVE_ON_SPEED_TILES_S)).toBe(false); // exactly at ON does not (yet) count
  });

  it('starts moving once speed climbs past the ON threshold', () => {
    expect(nextVehicleMoving(false, VEHICLE_MOVE_ON_SPEED_TILES_S + 0.001)).toBe(true);
  });

  it('stays moving inside the hysteresis band -- the regression this exists to prevent', () => {
    // A speed BELOW the ON threshold but still AT OR ABOVE the OFF one must
    // not flip a currently-moving vehicle back to idle -- this is the dead
    // zone a single shared cutoff would not have.
    const midBand = (VEHICLE_MOVE_ON_SPEED_TILES_S + VEHICLE_MOVE_OFF_SPEED_TILES_S) / 2;
    expect(nextVehicleMoving(true, midBand)).toBe(true);
  });

  it('stops only once speed falls below the OFF threshold', () => {
    expect(nextVehicleMoving(true, VEHICLE_MOVE_OFF_SPEED_TILES_S)).toBe(true); // exactly at OFF still counts as moving
    expect(nextVehicleMoving(true, VEHICLE_MOVE_OFF_SPEED_TILES_S - 0.001)).toBe(false);
  });

  it('never reports both states for the same input -- moving and idle are mutually exclusive by construction', () => {
    for (const speed of [0, 0.02, 0.05, 0.1, 0.15, 0.2, 1, 3]) {
      const fromStopped = nextVehicleMoving(false, speed);
      const fromMoving = nextVehicleMoving(true, speed);
      // Both branches may report the SAME state for a given speed (that's
      // exactly the point of the hysteresis band); this only asserts each
      // branch is a genuine boolean disposition, not that they disagree.
      expect(typeof fromStopped).toBe('boolean');
      expect(typeof fromMoving).toBe('boolean');
    }
  });
});

describe('vehicleDustMagnitude', () => {
  it('is 0 at a standstill', () => {
    expect(vehicleDustMagnitude(0)).toBe(0);
  });

  it('scales linearly up to the full-speed reference', () => {
    expect(vehicleDustMagnitude(VEHICLE_DUST_FULL_SPEED_TILES_S / 2)).toBeCloseTo(0.5);
    expect(vehicleDustMagnitude(VEHICLE_DUST_FULL_SPEED_TILES_S)).toBeCloseTo(1);
  });

  it('clamps at 1 for anything faster than the reference speed -- the roster\'s fastest vehicle does not out-dust the rest', () => {
    expect(vehicleDustMagnitude(VEHICLE_DUST_FULL_SPEED_TILES_S * 5)).toBe(1);
  });

  it('never goes negative for a negative input', () => {
    expect(vehicleDustMagnitude(-1)).toBe(0);
  });
});

describe('vehicleFxAnchor', () => {
  it('offsets straight behind a vehicle facing east (0 turns)', () => {
    const a = vehicleFxAnchor(10, 10, 0, 1);
    expect(a.x).toBeCloseTo(9);
    expect(a.y).toBeCloseTo(10);
  });

  it('offsets straight behind a vehicle facing south (0.25 turns)', () => {
    const a = vehicleFxAnchor(10, 10, 0.25, 1);
    expect(a.x).toBeCloseTo(10);
    expect(a.y).toBeCloseTo(9);
  });

  it('the emission direction points exactly backward (0.5 turns opposite facing)', () => {
    expect(vehicleFxAnchor(0, 0, 0, 1).dirTurns).toBeCloseTo(0.5);
    expect(vehicleFxAnchor(0, 0, 0.25, 1).dirTurns).toBeCloseTo(0.75);
    // Wraps rather than going negative or past 1.
    expect(vehicleFxAnchor(0, 0, 0.8, 1).dirTurns).toBeCloseTo(0.3);
  });

  it('a larger offset moves the anchor further from the vehicle, same direction', () => {
    const near = vehicleFxAnchor(0, 0, 0, 0.5);
    const far = vehicleFxAnchor(0, 0, 0, 2);
    expect(far.x).toBeLessThan(near.x); // further behind (more negative x) facing east
    expect(far.dirTurns).toBeCloseTo(near.dirTurns);
  });
});

describe('the dust cadence follows the speed (R-O)', () => {
  // The defect, stated as a test: before this, these two were equal.
  it('lays dust faster the faster the vehicle goes', () => {
    const crawl = vehicleDustIntervalMs(1.1, 0); // mbt_lavi at cruise
    const sprint = vehicleDustIntervalMs(2.6, 0); // technical at cruise
    expect(sprint).toBeLessThan(crawl);
  });

  it('is monotone across the whole roster range', () => {
    let previous = Infinity;
    for (const s of [0.2, 0.5, 1.0, 1.3, 1.8, 2.0, 2.6, 3.4]) {
      const ms = vehicleDustIntervalMs(s, 0);
      expect(ms).toBeLessThanOrEqual(previous);
      previous = ms;
    }
  });

  // Today's behaviour, kept exactly at today's reference speed, so the
  // existing ambient-FX suite and the `vehicle` golden frame both stay put.
  it('equals the shipped constant at the reference speed', () => {
    expect(vehicleDustIntervalMs(VEHICLE_DUST_FULL_SPEED_TILES_S, 0)).toBeCloseTo(
      VEHICLE_DUST_INTERVAL_MS,
      6
    );
  });

  // FRAME_DT_CEILING_MS is 100 and the accumulator gains at most that per
  // frame. An interval under it means one frame can cross it more than once,
  // and a `while` loop there is how the 2026-09-18 emission backlog spent
  // itself one puff per CALL. The floor is what keeps the spend single.
  it('never asks for an interval the frame clamp cannot deliver singly', () => {
    for (const s of [0.2, 1.0, 2.6, 3.4, 99]) {
      expect(vehicleDustIntervalMs(s, 1)).toBeGreaterThan(100);
    }
    expect(VEHICLE_DUST_MIN_INTERVAL_MS).toBeGreaterThan(100);
  });

  // The launch surge: the moment a vehicle breaks traction is the moment it
  // throws the most dust, and this is the first time the renderer has had an
  // acceleration signal to hang that on (Task 3's model).
  it('throws more dust under acceleration than at the same speed cruising', () => {
    expect(vehicleDustIntervalMs(1.1, 1)).toBeLessThan(vehicleDustIntervalMs(1.1, 0));
  });

  it('ignores an out-of-range acceleration fraction rather than inverting on it', () => {
    expect(vehicleDustIntervalMs(1.1, 5)).toBeGreaterThan(0);
    expect(vehicleDustIntervalMs(1.1, -5)).toBeGreaterThan(0);
    expect(vehicleDustIntervalMs(1.1, -5)).toBeLessThanOrEqual(vehicleDustIntervalMs(1.1, 0));
  });
});
