import { describe, expect, it } from 'vitest';
import { DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';
import { buildRoadGraph, isJunction, junctionDistanceAt, roadDistanceAt, roadProfile } from './road-graph';

function roads(rows: readonly string[]): TerrainInput {
  const height = rows.length;
  const width = rows[0].length;
  const decor = new Uint8Array(width * height);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'r') decor[y * width + x] = DECOR_ROAD; }));
  return { width, height, decor, elevation: null, blocked: new Uint8Array(width * height), cover: new Uint8Array(width * height) };
}

describe('buildRoadGraph', () => {
  it('links four-neighbours, one edge per pair', () => {
    const g = buildRoadGraph(roads(['rrr']));
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
    expect(g.degree).toEqual([1, 2, 1]);
  });
  // G2: tiles touching only at a corner were beads. The diagonal is bridged
  // exactly when neither orthogonal cell between the two is road.
  it('bridges a diagonal chain into one line (G2)', () => {
    const g = buildRoadGraph(roads(['r..', '.r.', '..r']));
    expect(g.edges).toHaveLength(2);
    expect(roadDistanceAt(g, 1.0, 1.0)).toBeCloseTo(0, 6);
    expect(roadDistanceAt(g, 2.0, 2.0)).toBeCloseTo(0, 6);
  });
  it('bridges the anti-diagonal the same way', () => {
    expect(buildRoadGraph(roads(['..r', '.r.', 'r..'])).edges).toHaveLength(2);
  });
  // An L-bend already joins through its corner tile. A diagonal would add a
  // third edge and draw a filled triangle.
  it('does not cut an L-bend with a diagonal', () => {
    const g = buildRoadGraph(roads(['rr', '.r']));
    expect(g.edges).toHaveLength(2);
  });
  it('makes the centre of a crossroads its one junction', () => {
    const g = buildRoadGraph(roads(['.r.', 'rrr', '.r.']));
    const centre = g.nodeAt[1 * 3 + 1];
    expect(g.degree[centre]).toBe(4);
    expect(isJunction(g, centre)).toBe(true);
    expect(g.nodes.filter((_, i) => isJunction(g, i))).toHaveLength(1);
    expect(junctionDistanceAt(g, 1.5, 1.5)).toBe(0);
    expect(junctionDistanceAt(g, 1.5, 0.5)).toBeCloseTo(1, 6);
  });
});

describe('roadDistanceAt', () => {
  it('measures to the centreline', () => {
    const g = buildRoadGraph(roads(['...', 'rrr', '...']));
    expect(roadDistanceAt(g, 1.5, 1.5)).toBeCloseTo(0, 6);
    expect(roadDistanceAt(g, 1.5, 1.8)).toBeCloseTo(0.3, 6);
    expect(roadDistanceAt(g, 1.5, 0.5)).toBeCloseTo(1, 6);
  });
  it('treats a lone road tile as a point', () => {
    const g = buildRoadGraph(roads(['...', '.r.', '...']));
    expect(g.degree).toEqual([0]);
    expect(roadDistanceAt(g, 1.8, 1.5)).toBeCloseTo(0.3, 6);
  });
  it('is Infinity with no road within two tiles', () => {
    expect(roadDistanceAt(buildRoadGraph(roads(['...'])), 1.5, 0.5)).toBe(Infinity);
    expect(roadDistanceAt(buildRoadGraph(roads(['r......'])), 6.5, 0.5)).toBe(Infinity);
  });
});

/**
 * A street authored two tiles wide (`rr` over `rr`) is ONE street, not a
 * ladder (ground plan Task 6, controller ruling). Built as a plain graph it
 * was two rows joined by a rung at every tile: the centre of each 2x2 cell sat
 * 0.5 from every edge -- a hole in the surface ringed by shoulder -- and every
 * node had degree 3, so the ruts faded out around every tile into a lattice.
 * Four Beit Sahwan maps are built on these streets.
 */
describe('two-wide streets', () => {
  const junctions = (g: ReturnType<typeof buildRoadGraph>): string[] =>
    g.nodes.filter((_, i) => isJunction(g, i)).map((n) => `${n.x},${n.y}`);

  it('fills a 2x2 block of road: its centre is ON the road, not 0.5 off it', () => {
    const g = buildRoadGraph(roads(['rr', 'rr']));
    expect(roadDistanceAt(g, 1.0, 1.0)).toBe(0);
    const strip = buildRoadGraph(roads(['......', 'rrrrrr', 'rrrrrr', '......']));
    // Every point between the two lane centrelines is road...
    for (const x of [1.0, 2.25, 3.0, 4.5]) for (const z of [1.5, 1.8, 2.0, 2.5]) expect(roadDistanceAt(strip, x, z)).toBe(0);
    // ...and outside them the distance runs from the band's edge, so the
    // surface is one band 1 + 2 x ROAD_HALF_WIDTH wide.
    expect(roadDistanceAt(strip, 3.0, 1.2)).toBeCloseTo(0.3, 6);
    expect(roadDistanceAt(strip, 3.0, 2.8)).toBeCloseTo(0.3, 6);
  });

  it('gives a two-wide strip no junction at all -- a rung across the street is not a branch', () => {
    expect(junctions(buildRoadGraph(roads(['rrrrrr', 'rrrrrr'])))).toEqual([]);
    // A two-wide L-bend turns; it does not branch either.
    expect(junctions(buildRoadGraph(roads(['rrrr', 'rrrr', '..rr', '..rr'])))).toEqual([]);
  });

  it('still finds the junction where a real road branches off a two-wide street', () => {
    const g = buildRoadGraph(roads(['...r..', '...r..', 'rrrrrr', 'rrrrrr']));
    // Both lanes the side road meets -- it crosses the whole width of the
    // street, so the ruts must fade across both -- and nowhere else.
    expect(junctions(g)).toEqual(['3,2', '3,3']);
  });

  it('makes the crossing of two two-wide streets one junction region, and nothing on the arms', () => {
    const g = buildRoadGraph(roads(['..rr..', '..rr..', 'rrrrrr', 'rrrrrr', '..rr..', '..rr..']));
    expect(junctions(g)).toEqual(['2,2', '3,2', '2,3', '3,3']);
    // The ruts fade around the crossing's centre and nowhere down the arms.
    expect(junctionDistanceAt(g, 3.0, 3.0)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(junctionDistanceAt(g, 0.5, 2.5)).toBeCloseTo(2, 6);
  });

  it('draws one surface with two rut tracks and no rings along the street', () => {
    const g = buildRoadGraph(roads(['......', '......', 'rrrrrr', 'rrrrrr', '......', '......']));
    const at = (x: number, z: number): ReturnType<typeof roadProfile> =>
      roadProfile(roadDistanceAt(g, x, z), 0, junctionDistanceAt(g, x, z));
    // Solid across the whole width, the gap between the lanes included.
    for (const x of [1.5, 2.0, 3.0, 3.5]) for (const z of [2.5, 3.0, 3.5]) expect(at(x, z).surface).toBe(1);
    // Two tracks, 0.17 outside each lane centreline, the same at a tile
    // centre and between two -- no ring, no dash.
    for (const x of [2.0, 2.5, 3.0]) {
      expect(at(x, 2.5 - 0.17).rut).toBeCloseTo(0.35, 6);
      expect(at(x, 3.5 + 0.17).rut).toBeCloseTo(0.35, 6);
      expect(at(x, 3.0).rut).toBe(0);
      expect(at(x, 3.0).shoulder).toBe(0);
    }
  });
});

describe('roadProfile -- spec §5, the road rows', () => {
  const far = 10;
  it('is packed surface on the centreline, with no rut and no shoulder there', () => {
    expect(roadProfile(0, 0, far)).toEqual({ surface: 1, shoulder: 0, rut: 0 });
  });
  it('wears its edge across 0.18 tile centred on the 0.36 half-width', () => {
    expect(roadProfile(0.27, 0, far).surface).toBe(1);
    expect(roadProfile(0.36, 0, far).surface).toBeCloseTo(0.5, 6);
    expect(roadProfile(0.45, 0, far).surface).toBe(0);
  });
  it('bends that edge by up to 0.08 tile', () => {
    expect(roadProfile(0.36, 1, far).surface).toBeLessThan(0.05);
    expect(roadProfile(0.36, -1, far).surface).toBeGreaterThan(0.95);
  });
  it('lays two ruts 0.17 either side of the centre, 0.06 wide, at 35%', () => {
    expect(roadProfile(0.17, 0, far).rut).toBeCloseTo(0.35, 6);
    expect(roadProfile(0.2, 0, far).rut).toBeCloseTo(0.175, 6);
    expect(roadProfile(0.1, 0, far).rut).toBe(0);
    expect(roadProfile(0.24, 0, far).rut).toBe(0);
  });
  it('fades the ruts out within 0.4 tile of a junction, so a crossroads is not rings', () => {
    expect(roadProfile(0.17, 0, 0).rut).toBe(0);
    expect(roadProfile(0.17, 0, 0.2).rut).toBeCloseTo(0.175, 6);
    expect(roadProfile(0.17, 0, 0.4).rut).toBeCloseTo(0.35, 6);
  });
  it('lays a bleached shoulder just past the edge, at most 40%, and nothing beyond it', () => {
    const s = roadProfile(0.5, 0, far).shoulder;
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThanOrEqual(0.4);
    expect(roadProfile(0.6, 0, far).shoulder).toBe(0);
    expect(roadProfile(0.2, 0, far).shoulder).toBe(0);
  });
});
