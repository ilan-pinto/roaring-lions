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
