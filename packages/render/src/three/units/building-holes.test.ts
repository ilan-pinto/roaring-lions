/**
 * GH-1197 P4: hole growth and the cap, the fbm edge, the cracks, lip and halo, and the cut's depth. Oracles are the
 * design's literals (section 3a) or the geometry restated by hand.
 */
import { describe, expect, it } from 'vitest';
import {
  HOLE_CAP,
  HOLE_EDGE_OCTAVES,
  addHole,
  holeAt,
  holeCrack,
  holeEdgeNoise,
  holeEdgeRadius,
  type Hole,
  type HoleHit,
} from './building-holes';

const wall = (x: number, y: number, r = 0.3, seed = 7): HoleHit => ({ c: [x, y, 0], axis: [0, 0, 1], radius: r, seed });

describe('growth and the cap (design 3a: six holes, 25% growth within 1.2 r, capped at 1.6x)', () => {
  it('a hit within 1.2 r of a hole grows it by 25% instead of taking a slot', () => {
    let holes: Hole[] = addHole([], wall(0, 1));
    holes = addHole(holes, wall(0.35, 1)); // 0.35 < 1.2 x 0.3 = 0.36
    expect(holes).toHaveLength(1);
    expect(holes[0].radius).toBeCloseTo(0.375, 12);
  });
  it('a hit just past 1.2 r opens a second hole', () => {
    let holes: Hole[] = addHole([], wall(0, 1));
    holes = addHole(holes, wall(0.37, 1));
    expect(holes).toHaveLength(2);
  });
  it('growth stops at 1.6x the class radius: 0.48 for a 0.30 hole', () => {
    let holes: Hole[] = addHole([], wall(0, 1));
    for (let i = 0; i < 10; i++) holes = addHole(holes, wall(0, 1));
    expect(holes).toHaveLength(1);
    expect(holes[0].radius).toBeCloseTo(0.48, 12);
  });
  it('six holes at most: a seventh distinct hit grows the nearest', () => {
    let holes: Hole[] = [];
    for (let i = 0; i < 6; i++) holes = addHole(holes, wall(i * 2, 1));
    expect(holes).toHaveLength(HOLE_CAP);
    expect(HOLE_CAP).toBe(6);
    holes = addHole(holes, wall(10.9, 1));
    expect(holes).toHaveLength(6);
    expect(holes[5].radius).toBeCloseTo(0.375, 12);
    expect(holes.slice(0, 5).every((h) => h.radius === 0.3)).toBe(true);
  });
  it('is pure: the list it was handed is untouched', () => {
    const one = addHole([], wall(0, 1));
    const before = JSON.stringify(one);
    addHole(one, wall(0, 1));
    expect(JSON.stringify(one)).toBe(before);
  });
});

describe('the fbm edge (broken masonry, +-15%)', () => {
  it('stays inside 0.85 r .. 1.15 r all the way round, and uses all of it', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let seed = 0; seed < 20; seed++) {
      for (let i = 0; i < 720; i++) {
        const r = holeEdgeRadius(1, (i / 720) * Math.PI * 2, seed);
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(0.85);
    expect(hi).toBeLessThanOrEqual(1.15);
    // A real swing, not a circle: most of the band is reached.
    expect(hi - lo).toBeGreaterThan(0.2);
  });
  it('wraps exactly at 2 pi (no seam), and is the same for the same seed', () => {
    for (const seed of [0, 3, 4095]) {
      expect(holeEdgeNoise(0, seed)).toBeCloseTo(holeEdgeNoise(Math.PI * 2, seed), 12);
      expect(holeEdgeNoise(-0.5, seed)).toBeCloseTo(holeEdgeNoise(Math.PI * 2 - 0.5, seed), 12);
      // Continuous across the seam: just short of a full turn reads what a full turn does.
      expect(holeEdgeNoise(Math.PI * 2 - 1e-9, seed)).toBeCloseTo(holeEdgeNoise(0, seed), 6);
      expect(holeEdgeNoise(1.234, seed)).toBe(holeEdgeNoise(1.234, seed));
    }
    expect(holeEdgeNoise(1.234, 3)).not.toBe(holeEdgeNoise(1.234, 4));
  });
  it('has at least three octaves: detail at 1/32 of a turn that a single octave of 4 cells could not draw', () => {
    expect(HOLE_EDGE_OCTAVES).toBeGreaterThanOrEqual(3);
    // Inside ONE first-octave cell (a quarter turn) a one-octave noise is a smoothstep between two values: monotone.
    // The fbm must turn back at least once in some cell, for most seeds.
    let wiggly = 0;
    for (let seed = 0; seed < 40; seed++) {
      let turns = 0;
      let prev = holeEdgeNoise(0, seed);
      let dir = 0;
      for (let i = 1; i <= 64; i++) {
        const v = holeEdgeNoise((i / 64) * (Math.PI / 2), seed);
        const d = Math.sign(v - prev);
        if (d !== 0 && dir !== 0 && d !== dir) turns++;
        if (d !== 0) dir = d;
        prev = v;
      }
      if (turns > 0) wiggly++;
    }
    expect(wiggly).toBeGreaterThan(30);
  });
});

describe('what a fragment is, against one hole', () => {
  // A hole on a wall facing +z at the origin, radius 0.3.
  const h: Hole = { c: [0, 0, 0], radius: 0.3, axis: [0, 0, 1], seed: 11, classRadius: 0.3 };
  it('cut at the centre, whole well outside', () => {
    expect(holeAt(h, [0, 0, 0]).cut).toBe(true);
    expect(holeAt(h, [0.2, 0.05, 0]).cut).toBe(true);
    const far = holeAt(h, [1, 0, 0]);
    expect(far.cut || far.lip || far.crack || far.halo > 0).toBe(false);
  });
  it('cuts the near wall and never the far one: 0.6 t along the axis either side', () => {
    expect(holeAt(h, [0, 0, 0.59]).cut).toBe(true);
    expect(holeAt(h, [0, 0, -0.59]).cut).toBe(true);
    expect(holeAt(h, [0, 0, 0.61]).cut).toBe(false);
    expect(holeAt(h, [0, 0, -1.0]).cut).toBe(false);
  });
  it('a 0.03 t lip just outside the cut, then the char halo fading over 0.15 t', () => {
    // Along +x the basis' theta is atan2(dot(d, b), dot(d, t)); find the edge radius there by scanning.
    let edge = 0;
    for (let r = 0.2; r < 0.4; r += 0.0005) {
      if (!holeAt(h, [r, 0, 0]).cut) {
        edge = r;
        break;
      }
    }
    expect(holeAt(h, [edge + 0.01, 0, 0]).lip).toBe(true);
    expect(holeAt(h, [edge + 0.04, 0, 0]).lip).toBe(false);
    expect(holeAt(h, [edge + 0.04, 0, 0]).halo).toBeGreaterThan(0.6);
    expect(holeAt(h, [edge + 0.17, 0, 0]).halo).toBeLessThan(0.1);
    expect(holeAt(h, [edge + 0.2, 0, 0]).halo).toBe(0);
  });
  it('six cracks of 0.05-0.1 t, each a wedge at its own angle', () => {
    const lengths = [0, 1, 2, 3, 4, 5].map((k) => holeCrack(h.seed, k).length);
    for (const l of lengths) {
      expect(l).toBeGreaterThanOrEqual(0.05);
      expect(l).toBeLessThanOrEqual(0.1);
    }
    expect(new Set([0, 1, 2, 3, 4, 5].map((k) => holeCrack(h.seed, k).angle)).size).toBe(6);
  });
});
