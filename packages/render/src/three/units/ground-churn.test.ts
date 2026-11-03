/**
 * Churn and clods (GH-984 N2): when a hull pivots or launches, from the sim's own per-tick numbers.
 * Oracles are literals: the thresholds below are the lead's design retyped, not imported.
 */
import { describe, expect, it } from 'vitest';
import {
  CHURN_EVENT_LAUNCH,
  CHURN_EVENT_NONE,
  CHURN_EVENT_PIVOT,
  CHURN_PIVOT_HOLD_TICKS,
  CHURN_PIVOT_PERIOD_TICKS,
  churnStamps,
  isPivoting,
  makeChurnState,
  stepChurn,
  turnDelta,
} from './ground-churn';

const CRUISE = 1.1;

describe('turnDelta', () => {
  it('is the wrapped change of heading in turns', () => {
    expect(turnDelta(0.1, 0.12)).toBeCloseTo(0.02, 12);
    expect(turnDelta(0.99, 0.01)).toBeCloseTo(0.02, 12);
    expect(turnDelta(0.01, 0.99)).toBeCloseTo(-0.02, 12);
  });
});

describe('isPivoting: one side of the running gear reversing', () => {
  it('needs a real turn (0.05 turn/s) whose track speed beats the ground speed', () => {
    const gauge = 0.22;
    // 0.2 turn/s x 2pi x 0.22 = 0.276 tiles/s of track speed.
    expect(isPivoting(0, 0.2, gauge)).toBe(true);
    expect(isPivoting(0.27, 0.2, gauge)).toBe(true);
    expect(isPivoting(0.3, 0.2, gauge)).toBe(false);
    // A hull cruising round a bend is not pivoting.
    expect(isPivoting(1.1, 0.2, gauge)).toBe(false);
    // A tiny correction is not a turn.
    expect(isPivoting(0, 0.04, gauge)).toBe(false);
    expect(isPivoting(0, -0.2, gauge)).toBe(true);
  });
});

describe('stepChurn', () => {
  const run = (kind: 'tracked' | 'wheeled', ticks: { speed: number; yaw: number }[]): number[] => {
    const s = makeChurnState(1);
    return ticks.map((t, i) => stepChurn(s, 0, 100 + i, t.speed, t.yaw, CRUISE, kind));
  };
  it('a tracked hull turning on the spot throws its first scuff after the hold, then one every 10 ticks', () => {
    const events = run('tracked', Array.from({ length: 30 }, () => ({ speed: 0, yaw: 0.2 })));
    const at = events.flatMap((e, i) => (e === CHURN_EVENT_PIVOT ? [i] : []));
    expect(at[0]).toBe(CHURN_PIVOT_HOLD_TICKS - 1);
    expect(at.slice(1).map((v, i) => v - at[i])).toEqual(Array(at.length - 1).fill(CHURN_PIVOT_PERIOD_TICKS));
    expect(at.length).toBe(3);
    expect(CHURN_PIVOT_HOLD_TICKS).toBe(4);
    expect(CHURN_PIVOT_PERIOD_TICKS).toBe(10);
  });
  it('a wheeled hull does not pivot', () => {
    expect(run('wheeled', Array.from({ length: 30 }, () => ({ speed: 0, yaw: 0.2 }))).filter((e) => e === CHURN_EVENT_PIVOT)).toHaveLength(0);
  });
  it('a turn shorter than the hold, or a turn with speed, throws nothing', () => {
    expect(run('tracked', [...Array(3).fill({ speed: 0, yaw: 0.2 }), { speed: 0, yaw: 0 }, ...Array(3).fill({ speed: 0, yaw: 0.2 })]).every((e) => e === CHURN_EVENT_NONE)).toBe(true);
    expect(run('tracked', Array.from({ length: 20 }, () => ({ speed: 1.1, yaw: 0.2 }))).every((e) => e === CHURN_EVENT_NONE)).toBe(true);
  });
  it('the first tick over a tenth of cruise after six standing ticks is the launch, once per 40 ticks', () => {
    const stand = Array.from({ length: 6 }, () => ({ speed: 0, yaw: 0 }));
    expect(run('wheeled', [...stand, { speed: 0.5, yaw: 0 }, { speed: 1.1, yaw: 0 }]).slice(6)).toEqual([CHURN_EVENT_LAUNCH, CHURN_EVENT_NONE]);
    // Only five standing: no launch.
    expect(run('wheeled', [...stand.slice(1), { speed: 1.1, yaw: 0 }]).at(-1)).toBe(CHURN_EVENT_NONE);
    // A stutter inside the cooldown: stop and go again within 40 ticks throws nothing the second time.
    const twice = run('wheeled', [...stand, { speed: 1.1, yaw: 0 }, ...stand, { speed: 1.1, yaw: 0 }]);
    expect(twice.filter((e) => e === CHURN_EVENT_LAUNCH)).toHaveLength(1);
  });
  it('a pivot that ends in a drive-off launches too (the standing count kept running)', () => {
    const turn = Array.from({ length: 12 }, () => ({ speed: 0, yaw: 0.2 }));
    const events = run('tracked', [...turn, { speed: 1.1, yaw: 0 }]);
    expect(events.at(-1)).toBe(CHURN_EVENT_LAUNCH);
  });
});

describe('churnStamps', () => {
  it('a pivot lays a round scuff under each track; a launch a long one behind each', () => {
    const pivot = churnStamps(CHURN_EVENT_PIVOT, 10, 10, 0, 'tracked');
    expect(pivot).toHaveLength(2);
    expect(pivot.map((p) => p.y).sort((a, b) => a - b)).toEqual([9.78, 10.22]);
    expect(pivot.every((p) => p.halfLength === 0.3 && p.halfWidth === 0.3)).toBe(true);
    const launch = churnStamps(CHURN_EVENT_LAUNCH, 10, 10, 0, 'wheeled');
    expect(launch).toHaveLength(2);
    expect(launch.every((p) => Math.abs(p.x - 9.6) < 1e-9)).toBe(true);
    expect(launch[0].halfLength).toBeGreaterThan(launch[0].halfWidth);
    expect(churnStamps(CHURN_EVENT_NONE, 0, 0, 0, 'tracked')).toEqual([]);
    // A motorcycle has one track line.
    expect(churnStamps(CHURN_EVENT_LAUNCH, 10, 10, 0, 'single')).toHaveLength(1);
  });
});
