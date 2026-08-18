import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { pointAtDistance, routeLength, TRAIL_MAX } from './tunnels';
import type { UnitTypeJson } from './sim';

const STRAIGHT: [number, number][] = [[0, 0], [3, 0]];
const ELBOW: [number, number][] = [[0, 0], [3, 0], [3, 4]];
const DEGENERATE: [number, number][] = [[0, 0], [3, 0], [3, 0], [3, 4]];

/** Minimal unarmed unit that can dig — same shape as combat.test.ts's INF,
 *  zeroed of weapons, with the ability that makes assignDigger meaningful. */
const DIGGER_TYPE: UnitTypeJson = {
  id: 'tn_digger',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['dig_tunnel'],
  weapons: [],
};

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

describe('digging', () => {
  it('advances progress only while a living digger is assigned', () => {
    const { sim, idx } = simWithRoute();
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.tnProgress[idx]).toBe(0); // no digger, no dig

    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);
    for (let t = 0; t < 20; t++) sim.tick();
    expect(fx.toNumber(sim.tnProgress[idx])).toBeCloseTo(1, 1); // 1 tile/s for 1 s
  });

  it('opens the vent and emits once when the head reaches the end', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    const opened = [];
    for (let t = 0; t < 200; t++) {
      for (const e of sim.tick()) if (e.kind === 'ventOpened') opened.push(e);
    }
    expect(sim.tnVentOpen[idx]).toBe(1);
    expect(opened).toHaveLength(1);
    expect(opened[0].tunnel).toBe(idx);
  });

  it('stops advancing when the digger dies but leaves the route standing', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);
    for (let t = 0; t < 20; t++) sim.tick();
    const halted = sim.tnProgress[idx];
    sim.debugKill(id);
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.tnProgress[idx]).toBe(halted);
    expect(sim.tnAlive[idx]).toBe(1); // the tunnel that exists still exists
  });

  it('stamps surface spoil on the tiles the head passes under, and only those', () => {
    const { sim, idx } = simWithRoute(); // ROUTE runs (2,2) -> (8,2)
    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);

    sim.tick();
    // A single tick's advance (~0.05 tile at 1 tile/s) is far under the
    // interior loop's half-tile step, so the loop body never runs on the
    // first tick — the mouth tile is only marked by the trailing endpoint
    // stamp. If that stamp were ever dropped, tick one would dig nothing.
    expect(sim.trail[2 * sim.width + 2]).toBe(TRAIL_MAX); // mouth tile (2,2)

    for (let t = 1; t < 20; t++) sim.tick(); // 20 ticks total: progress crosses 1 tile
    expect(sim.trail[2 * sim.width + 2]).toBe(TRAIL_MAX); // still dug
    expect(sim.trail[2 * sim.width + 3]).toBe(TRAIL_MAX); // one tile in: dug

    expect(sim.trail[2 * sim.width + 4]).toBe(0); // ahead of the head: undug
    expect(sim.trail[10 * sim.width + 10]).toBe(0); // nowhere near the route
  });
});
