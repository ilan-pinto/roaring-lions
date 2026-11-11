/**
 * GH-1197 P3: the hit face, the ejecta cone and the masonry keys. Literal oracles.
 */
import { describe, expect, it } from 'vitest';
import { HIT_EJECTA_SPREAD_RAD, hitFace, masonryKeyFor, masonryKeysFor } from './building-hit';
import { debrisThrowFor, planDebris } from './debris-flight';

// A 2x2 house over tiles 20..21: its faces are x = 20 and 22, y = 20 and 22.
const face = (sx: number, sy: number): ReturnType<typeof hitFace> => hitFace(20, 20, 21, 21, sx, sy);

describe('the hit face lies toward the shooter, never at the centroid', () => {
  it('east, west, north and south faces, at the shooter-facing point', () => {
    expect(face(27, 20.5)).toEqual({ x: 22, y: 20.5, nx: 1, ny: 0 });
    expect(face(10, 21.2)).toEqual({ x: 20, y: 21.2, nx: -1, ny: 0 });
    expect(face(21, 10)).toEqual({ x: 21, y: 20, nx: 0, ny: -1 });
    expect(face(20.4, 30)).toEqual({ x: 20.4, y: 22, nx: 0, ny: 1 });
  });
  it('a corner takes the diagonal', () => {
    const f = face(30, 30);
    expect([f.x, f.y]).toEqual([22, 22]);
    expect(f.nx).toBeCloseTo(Math.SQRT1_2, 9);
    expect(f.ny).toBeCloseTo(Math.SQRT1_2, 9);
  });
  it('a shooter inside the footprint is answered with a unit normal toward it', () => {
    const f = face(21.5, 21);
    expect(Math.hypot(f.nx, f.ny)).toBeCloseTo(1, 9);
    expect(f.nx).toBeGreaterThan(0);
    expect(face(21, 21)).toEqual({ x: 22, y: 21, nx: 1, ny: 0 });
  });
});

describe('the ejecta leave inside the +-35 degree cone about the face normal (the design)', () => {
  it('every heading within the cone, and the mean velocity toward the shooter', () => {
    expect(HIT_EJECTA_SPREAD_RAD).toBeCloseTo((35 * Math.PI) / 180, 12);
    const t = debrisThrowFor({ clods: 12, chunks: 8, throw_tiles: 1.6, apex_tiles: 1.2 }, 1.3, 1.3);
    const dir = Math.PI / 2; // the south face, +z
    let mean = 0;
    for (let k = 0; k < 20; k++) {
      const p = planDebris(21, 1.5, 22.05, k, k < 12, t, () => 0, { dirRad: dir, spreadRad: HIT_EJECTA_SPREAD_RAD });
      const off = Math.atan2(p.v0[2], p.v0[0]) - dir;
      expect(Math.abs(off)).toBeLessThanOrEqual(HIT_EJECTA_SPREAD_RAD + 1e-9);
      mean += p.v0[2];
    }
    expect(mean / 20).toBeGreaterThan(0);
  });
});

describe("the masonry is the building's own ramp", () => {
  it('limestone.3 -> limestone.3, .4, .5, every fourth piece gunmetal.2', () => {
    const keys = masonryKeysFor('limestone.3');
    expect(keys).toEqual({ ramp: ['limestone.3', 'limestone.4', 'limestone.5'], charred: 'gunmetal.2' });
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => masonryKeyFor(keys, k))).toEqual([
      'limestone.3', 'limestone.4', 'limestone.5', 'gunmetal.2', 'limestone.4', 'limestone.5', 'limestone.3', 'gunmetal.2',
    ]);
  });
});
