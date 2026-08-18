import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { pointAtDistance, routeLength } from './tunnels';

const STRAIGHT: [number, number][] = [[0, 0], [3, 0]];
const ELBOW: [number, number][] = [[0, 0], [3, 0], [3, 4]];
const DEGENERATE: [number, number][] = [[0, 0], [3, 0], [3, 0], [3, 4]];

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

  it('handles routes with repeated points (degenerate legs)', () => {
    // DEGENERATE has a repeated point at [3, 0], creating a zero-length leg.
    // Verify pointAtDistance treats it correctly: the zero-length leg is skipped,
    // and distances map to the same positions as a route without it.
    expect(fx.toNumber(routeLength(DEGENERATE))).toBeCloseTo(7, 2);

    // Walking partway into the first real leg should work.
    const [x1, y1] = pointAtDistance(DEGENERATE, fx.from(1.5));
    expect(fx.toNumber(x1)).toBeCloseTo(1.5, 2);
    expect(fx.toNumber(y1)).toBeCloseTo(0, 2);

    // Walking past the degenerate point into the final leg should work.
    const [x2, y2] = pointAtDistance(DEGENERATE, fx.from(5));
    expect(fx.toNumber(x2)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y2)).toBeCloseTo(2, 2);
  });
});

import { Sim } from './sim';

const ROUTE = { id: 'tn_a', points: [[2, 2], [8, 2]] as const, dig_tiles_per_s: 1 };

function simWithRoute() {
  const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
  const idx = sim.addTunnel(ROUTE);
  return { sim, idx };
}

describe('tunnel state', () => {
  it('registers a route with its measured length and no progress', () => {
    const { sim, idx } = simWithRoute();
    expect(idx).toBe(0);
    expect(sim.tunnelCount).toBe(1);
    expect(sim.tnAlive[idx]).toBe(1);
    expect(sim.tnProgress[idx]).toBe(0);
    expect(fx.toNumber(sim.tnLength[idx])).toBeCloseTo(6, 2);
    expect(sim.tnVentOpen[idx]).toBe(0);
  });

  it('starts every unit on the surface', () => {
    const { sim } = simWithRoute();
    expect(sim.state.tunnelIn[0]).toBe(-1);
  });

  it('refuses a route with fewer than two points', () => {
    const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
    expect(() => sim.addTunnel({ id: 'bad', points: [[1, 1]], dig_tiles_per_s: 1 })).toThrow(
      /at least two points/
    );
  });
});
