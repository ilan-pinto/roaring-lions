/**
 * S-F F2 C3: the world supply route's geometry, as pure maths. The oracle
 * values here are literals (tile centres, lengths, the 8 cm lift), never read
 * back from the module under test.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSupplyRibbon,
  segmentIsCut,
  SUPPLY_ROUTE_HALF_WIDTH_TILES,
  SUPPLY_ROUTE_LIFT,
  SUPPLY_ROUTE_SAMPLES_PER_TILE,
} from './supply-route-maths';

const W = 48;
const flat = (): number => 0;
/** A straight run east along row `y`, `n` tiles from `x0`. */
const eastRun = (x0: number, y: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => y * W + x0 + i);

describe('segmentIsCut', () => {
  it('marks only the segments inside the inclusive cut span', () => {
    // Tiles 0..5; a cut over tiles 2..4 is segments 2-3 and 3-4.
    const span: [number, number] = [2, 4];
    expect([0, 1, 2, 3, 4].map((j) => segmentIsCut(j, span))).toEqual([false, false, true, true, false]);
    expect(segmentIsCut(0, null)).toBe(false);
  });
});

describe('buildSupplyRibbon', () => {
  it('draws nothing for no route, an empty route, or a one-tile route', () => {
    expect(buildSupplyRibbon([], W, flat).vertexCount).toBe(0);
    expect(buildSupplyRibbon([{ tiles: [], cutSpan: null }], W, flat).vertexCount).toBe(0);
    expect(buildSupplyRibbon([{ tiles: [5], cutSpan: null }], W, flat).vertexCount).toBe(0);
  });

  it('runs through the tile centres, a thin strip either side, lifted off the drawn ground', () => {
    const g = buildSupplyRibbon([{ tiles: eastRun(3, 7, 2), cutSpan: null }], W, () => 1.5);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let v = 0; v < g.vertexCount; v++) {
      xs.push(g.positions[v * 3]);
      expect(g.positions[v * 3 + 1]).toBeCloseTo(1.5 + 0.08, 5);
      zs.push(g.positions[v * 3 + 2]);
    }
    expect(Math.min(...xs)).toBeCloseTo(3.5, 5);
    expect(Math.max(...xs)).toBeCloseTo(4.5, 5);
    expect(Math.min(...zs)).toBeCloseTo(7.5 - SUPPLY_ROUTE_HALF_WIDTH_TILES, 5);
    expect(Math.max(...zs)).toBeCloseTo(7.5 + SUPPLY_ROUTE_HALF_WIDTH_TILES, 5);
    expect(SUPPLY_ROUTE_LIFT).toBe(0.08);
  });

  it('samples the ground per vertex, not once per route', () => {
    // A ramp rising one world unit per tile eastward.
    const g = buildSupplyRibbon([{ tiles: eastRun(0, 0, 3), cutSpan: null }], W, (x) => x);
    for (let v = 0; v < g.vertexCount; v++) {
      expect(g.positions[v * 3 + 1]).toBeCloseTo(g.positions[v * 3] + SUPPLY_ROUTE_LIFT, 5);
    }
    const heights = new Set<number>();
    for (let v = 0; v < g.vertexCount; v++) heights.add(Math.round(g.positions[v * 3 + 1] * 1e6));
    expect(heights.size).toBeGreaterThan(3);
  });

  it('carries the distance along the route, continuous across a turn', () => {
    // East two tiles, then a diagonal step: 1 + 1 + sqrt(2).
    const tiles = [W * 5 + 5, W * 5 + 6, W * 5 + 7, W * 6 + 8];
    const g = buildSupplyRibbon([{ tiles, cutSpan: null }], W, flat);
    expect(Math.max(...g.dist.slice(0, g.vertexCount))).toBeCloseTo(2 + Math.SQRT2, 5);
    expect(Math.min(...g.dist.slice(0, g.vertexCount))).toBe(0);
  });

  it('marks only the cut stretch dashed', () => {
    // Tiles 0..5 east; the cut is tiles 2..4. A vertex is dashed exactly when
    // it lies on [x of tile 2, x of tile 4] = [12.5, 14.5].
    const g = buildSupplyRibbon([{ tiles: eastRun(10, 2, 6), cutSpan: [2, 4] }], W, flat);
    let dashed = 0;
    for (let v = 0; v < g.vertexCount; v++) {
      const x = g.positions[v * 3];
      if (g.cut[v] === 1) {
        dashed++;
        expect(x).toBeGreaterThanOrEqual(12.5 - 1e-9);
        expect(x).toBeLessThanOrEqual(14.5 + 1e-9);
      } else {
        expect(g.cut[v]).toBe(0);
        expect(x < 12.5 + 1e-9 || x > 14.5 - 1e-9).toBe(true);
      }
    }
    expect(dashed).toBeGreaterThan(0);
  });

  it('a route with no cut span has no dashed vertex', () => {
    const g = buildSupplyRibbon([{ tiles: eastRun(0, 0, 6), cutSpan: null }], W, flat);
    expect(g.cut.slice(0, g.vertexCount).every((c) => c === 0)).toBe(true);
  });

  it('merges every route into the one geometry', () => {
    const one = buildSupplyRibbon([{ tiles: eastRun(0, 0, 5), cutSpan: null }], W, flat);
    const two = buildSupplyRibbon(
      [
        { tiles: eastRun(0, 0, 5), cutSpan: null },
        { tiles: eastRun(0, 9, 5), cutSpan: [1, 3] },
      ],
      W,
      flat
    );
    expect(two.vertexCount).toBe(2 * one.vertexCount);
    expect(two.indices.length).toBe(2 * one.indices.length);
    // The second route's indices point at its own vertices.
    expect(Math.max(...two.indices)).toBe(two.vertexCount - 1);
  });

  it('cost: a 40-tile straight route is 390 vertices and 312 triangles', () => {
    // 39 one-tile segments, each SAMPLES_PER_TILE (4) steps: 5 sections of 2.
    expect(SUPPLY_ROUTE_SAMPLES_PER_TILE).toBe(4);
    const g = buildSupplyRibbon([{ tiles: eastRun(2, 4, 40), cutSpan: [10, 20] }], W, flat);
    expect(g.vertexCount).toBe(390);
    expect(g.indices.length / 3).toBe(312);
  });

  it('keeps its width through a right-angle turn (a mitred join, not a pinch)', () => {
    // East then south: the corner tile centre is (6.5, 5.5).
    const tiles = [W * 5 + 5, W * 5 + 6, W * 6 + 6];
    const g = buildSupplyRibbon([{ tiles, cutSpan: null }], W, flat);
    let far = 0;
    for (let v = 0; v < g.vertexCount; v++) {
      const dx = g.positions[v * 3] - 6.5;
      const dz = g.positions[v * 3 + 2] - 5.5;
      far = Math.max(far, Math.hypot(dx, dz) <= 0.2 ? Math.hypot(dx, dz) : 0);
    }
    // A 90-degree mitre reaches sqrt(2) half-widths from the corner.
    expect(far).toBeCloseTo(Math.SQRT2 * SUPPLY_ROUTE_HALF_WIDTH_TILES, 5);
  });
});
