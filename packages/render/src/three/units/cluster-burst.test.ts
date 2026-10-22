import { describe, it, expect } from 'vitest';
import { ClusterBurstGrouper, clusterCarrierToRetire, CLUSTER_RETIRE_MIN_PROGRESS, BOMBLET_CRATER_RADIUS_TILES, CLUSTER_BURST_LIFT_PX } from './cluster-burst';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';

const bomblet = (by: number, index: number, count: number, x: number, y: number) => ({ by, x, y, index, count });

describe('ClusterBurstGrouper', () => {
  it('answers the centroid on the last bomblet of a round, and nothing before it', () => {
    const g = new ClusterBurstGrouper();
    const pts = [[10, 20], [12, 20], [10, 22], [12, 22]];
    const out = pts.map(([x, y], i) => g.push(bomblet(3, i, 4, x, y)));
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(out[3]).toEqual({ by: 3, x: 11, y: 21 });
  });

  it('keeps two shooters apart even when their bomblets interleave', () => {
    const g = new ClusterBurstGrouper();
    g.push(bomblet(1, 0, 2, 0, 0));
    g.push(bomblet(2, 0, 2, 100, 100));
    expect(g.push(bomblet(1, 1, 2, 2, 2))).toEqual({ by: 1, x: 1, y: 1 });
    expect(g.push(bomblet(2, 1, 2, 102, 102))).toEqual({ by: 2, x: 101, y: 101 });
  });

  it('discards a half-seen group when the next round opens, and ignores a tail with no head', () => {
    const g = new ClusterBurstGrouper();
    expect(g.push(bomblet(1, 1, 3, 50, 50))).toBeNull(); // head never seen
    g.push(bomblet(1, 0, 3, 90, 90));
    g.push(bomblet(1, 0, 3, 0, 0)); // a new round: the 90s are dropped
    g.push(bomblet(1, 1, 3, 2, 0));
    expect(g.push(bomblet(1, 2, 3, 4, 0))).toEqual({ by: 1, x: 2, y: 0 });
  });

  it('a one-bomblet round bursts at the bomblet', () => {
    expect(new ClusterBurstGrouper().push(bomblet(0, 0, 1, 7, 9))).toEqual({ by: 0, x: 7, y: 9 });
  });
});

describe('cluster constants', () => {
  it('a bomblet crater (0.25) is still smaller than a mortar crater (0.15 + 0.3), and the burst sits low', () => {
    expect(BOMBLET_CRATER_RADIUS_TILES).toBeLessThan(0.15 + 0.3);
    const wu = CLUSTER_BURST_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
    expect(wu).toBeGreaterThan(0.5);
    expect(wu).toBeLessThan(1.0);
  });
});

describe('clusterCarrierToRetire', () => {
  const sh = (shooter: number, u: number, cluster = true) => ({ cluster, shooter, t: u * 4, duration: 4 });
  it('retires the shooter\'s carrier that is nearly down, never a younger round of the same gun', () => {
    // Two rounds from shooter 5 in flight: the burst belongs to the one at 0.95.
    expect(clusterCarrierToRetire([sh(5, 0.4), sh(5, 0.95), sh(6, 0.99)], 5)).toBe(1);
  });
  it('retires nothing when the burst\'s own shell has already landed and only a younger one flies', () => {
    expect(clusterCarrierToRetire([sh(5, 0.5)], 5)).toBe(-1);
    expect(CLUSTER_RETIRE_MIN_PROGRESS).toBeGreaterThan(0.5);
  });
  it('ignores plain shells and other shooters', () => {
    expect(clusterCarrierToRetire([sh(5, 0.99, false), sh(6, 0.99)], 5)).toBe(-1);
  });
});
