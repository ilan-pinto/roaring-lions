import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { pointAtDistance, routeLength } from './tunnels';

const STRAIGHT: [number, number][] = [[0, 0], [3, 0]];
const ELBOW: [number, number][] = [[0, 0], [3, 0], [3, 4]];

describe('route geometry', () => {
  it('measures a straight run', () => {
    expect(fx.toNumber(routeLength(STRAIGHT))).toBeCloseTo(3, 2);
  });

  it('measures a polyline as the sum of its legs', () => {
    // 3 across then 4 down — the classic, so an error in leg summation is obvious.
    expect(fx.toNumber(routeLength(ELBOW))).toBeCloseTo(7, 2);
  });

  it('walks to a point partway along the first leg', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(1.5));
    expect(fx.toNumber(x)).toBeCloseTo(1.5, 2);
    expect(fx.toNumber(y)).toBeCloseTo(0, 2);
  });

  it('walks past the elbow into the second leg', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(5));
    expect(fx.toNumber(x)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y)).toBeCloseTo(2, 2);
  });

  it('clamps past the end to the final point rather than extrapolating', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(999));
    expect(fx.toNumber(x)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y)).toBeCloseTo(4, 2);
  });

  it('clamps before the start to the first point', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(-5));
    expect(fx.toNumber(x)).toBeCloseTo(0, 2);
    expect(fx.toNumber(y)).toBeCloseTo(0, 2);
  });
});
