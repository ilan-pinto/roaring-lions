import { describe, expect, it } from 'vitest';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';
import { buildControlMap, CONTROL_TEXELS_PER_TILE as N, tileSurface } from './control-map';
import { roadDistanceAt, buildRoadGraph } from './road-graph';

/** '.' open, 'r' road, 'o' grove, 'n' knoll, '1'-'3' cover, '#' pad, '^' ridge. */
function map(rows: readonly string[]): TerrainInput {
  const height = rows.length;
  const width = rows[0].length;
  const decor = new Uint8Array(width * height);
  const blocked = new Uint8Array(width * height);
  const cover = new Uint8Array(width * height);
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      const i = y * width + x;
      if (c === 'r') decor[i] = DECOR_ROAD;
      if (c === 'o') { decor[i] = DECOR_GROVE; cover[i] = 1; }
      if (c === 'n') { decor[i] = DECOR_KNOLL; cover[i] = 2; }
      if (c >= '1' && c <= '3') cover[i] = Number(c);
      if (c === '#') blocked[i] = 1;
      if (c === '^') { blocked[i] = 1; decor[i] = DECOR_RIDGE; }
    })
  );
  return { width, height, decor, elevation: null, blocked, cover };
}
/** h rows of one symbol repeated w times. */
const fill = (w: number, h: number, c: string): string[] => Array.from({ length: h }, () => c.repeat(w));
/** h copies of one authored row. */
const rowsOf = (h: number, row: string): string[] => Array.from({ length: h }, () => row);
/** Channel `c` of texture `t` at the texel containing world (x, z). */
function at(cm: ReturnType<typeof buildControlMap>, t: 'a' | 'b', x: number, z: number, c: number): number {
  const i = Math.floor(x * N);
  const j = Math.floor(z * N);
  return cm[t][(j * cm.width + i) * 4 + c];
}
const OPEN = 0, ROCK = 1, SCRUB = 2, GROVE = 3; // control A
const KNOLL = 0, ROADD = 1, JUNCD = 2, BEND = 3; // control B

describe('tileSurface -- albedoFor\'s order, one decision', () => {
  const m = map(['^#ron123.']);
  it.each([
    [0, 'rock', 1], [1, 'pad', 0], [2, 'road', 1], [3, 'grove', 1], [4, 'knoll', 1],
    [5, 'scrub', 0.4], [6, 'scrub', 0.65], [7, 'scrub', 1], [8, 'open', 1],
  ])('tile %i is %s at %f', (x, kind, strength) => {
    expect(tileSurface(m, x, 0)).toEqual({ kind, strength });
  });
});

describe('buildControlMap', () => {
  it('is 8 texels a tile, RGBA each', () => {
    const cm = buildControlMap(map(fill(6, 4, '.')));
    expect([cm.width, cm.height]).toEqual([6 * N, 4 * N]);
    expect(cm.a.length).toBe(6 * N * 4 * N * 4);
    expect(cm.b.length).toBe(cm.a.length);
  });

  it('is pure open deep in open ground', () => {
    const cm = buildControlMap(map(fill(9, 9, '.')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.5, 4.5, c))).toEqual([255, 0, 0, 0]);
    expect(at(cm, 'b', 4.5, 4.5, KNOLL)).toBe(0);
  });

  it('counts a road tile as open ground under the road', () => {
    const rows = fill(9, 9, '.');
    rows[4] = 'r'.repeat(9);
    const cm = buildControlMap(map(rows));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.44, 4.44, c))).toEqual([255, 0, 0, 0]);
  });

  // D1: the edge is 0.5 tile wide, NOT the plan's 1.5. A lone cover-1 tile's
  // core keeps its strength and nothing smears past 0.45 tile outside it.
  it('keeps a lone cover tile readable and does not smear it (D1)', () => {
    const rows = fill(9, 9, '.');
    rows[4] = '....1....';
    const cm = buildControlMap(map(rows));
    for (const x of [4.4375, 4.5625]) for (const z of [4.4375, 4.5625]) expect(at(cm, 'a', x, z, SCRUB)).toBeGreaterThanOrEqual(92);
    for (let j = 0; j < cm.height; j++)
      for (let i = 0; i < cm.width; i++) {
        const x = (i + 0.5) / N;
        const z = (j + 0.5) / N;
        // Per-axis reach is 0.25 (half band) + 0.2 (bend), so the bound is Chebyshev.
        const dx = Math.max(4 - x, 0, x - 5);
        const dz = Math.max(4 - z, 0, z - 5);
        if (Math.max(dx, dz) > 0.45) expect(cm.a[(j * cm.width + i) * 4 + SCRUB], `(${x}, ${z})`).toBe(0);
      }
  });

  it('centres the band on the tile edge, bent but never more than 0.45 tile off it', () => {
    const cm = buildControlMap(map(rowsOf(32, '......oooooo')));
    let midSum = 0;
    for (let j = 0; j < cm.height; j++) {
      const row = (x: number): number => cm.a[(j * cm.width + Math.floor(x * N)) * 4 + GROVE];
      expect(row(5.4)).toBe(0); // texel centre 5.4375: 0.5625 from the edge, past the 0.45 reach
      expect(row(6.6)).toBe(255); // texel centre 6.5625
      midSum += (row(5.9375) + row(6.0625)) / 2;
    }
    const mid = midSum / cm.height / 255;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('keeps a pad hard and the open ground beside it fully textured (R-4)', () => {
    const cm = buildControlMap(map(rowsOf(3, '...#....')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 3.5, 1.5, c))).toEqual([0, 0, 0, 0]);
    expect(at(cm, 'a', 2.9375, 1.5, OPEN)).toBe(255);
    expect(at(cm, 'a', 4.0625, 1.5, OPEN)).toBe(255);
  });

  it('keeps a ridge top pure rock and lays a 0.5-tile apron on the open side only', () => {
    const cm = buildControlMap(map(rowsOf(3, '....^^^^')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.0625, 1.5, c))).toEqual([0, 255, 0, 0]);
    expect(at(cm, 'a', 3.9375, 1.5, ROCK)).toBeGreaterThanOrEqual(102);
    expect(at(cm, 'a', 3.1875, 1.5, ROCK)).toBe(0);
    expect(at(cm, 'a', 3.1875, 1.5, OPEN)).toBe(255);
  });

  it('writes each cover tier at its own strength, and never draws a grove or knoll as scrub', () => {
    const cm = buildControlMap(map(rowsOf(4, '111222333oooonnnn')));
    expect(at(cm, 'a', 1.5, 1.5, SCRUB)).toBe(102);
    expect(at(cm, 'a', 4.5, 1.5, SCRUB)).toBe(166);
    expect(at(cm, 'a', 7.5, 1.5, SCRUB)).toBe(255);
    expect(at(cm, 'a', 10.5, 1.5, GROVE)).toBe(255);
    expect(at(cm, 'a', 10.5, 1.5, SCRUB)).toBe(0);
    expect(at(cm, 'b', 14.5, 1.5, KNOLL)).toBe(255);
    expect(at(cm, 'a', 14.5, 1.5, SCRUB)).toBe(0);
  });

  it('bakes the road distance, clamped at one tile', () => {
    const rows = fill(9, 9, '.');
    rows[4] = 'r'.repeat(9);
    const input = map(rows);
    const cm = buildControlMap(input);
    const g = buildRoadGraph(input);
    for (const [x, z] of [[4.5625, 4.5625], [2.0625, 4.8125], [3.3125, 5.0625]]) {
      const want = Math.round(Math.min(1, roadDistanceAt(g, x, z)) * 255);
      expect(at(cm, 'b', x, z, ROADD), `(${x}, ${z})`).toBe(want);
    }
    expect(at(cm, 'b', 4.5, 7.5, ROADD)).toBe(255);
    expect(at(cm, 'b', 4.5625, 4.5625, JUNCD)).toBe(255);
  });

  it('marks a crossroads in the junction channel', () => {
    const cm = buildControlMap(map(['.....', '..r..', '.rrr.', '..r..', '.....']));
    expect(at(cm, 'b', 2.5625, 2.5625, JUNCD)).toBeLessThanOrEqual(23);
  });

  it('bakes a signed edge bend that uses both halves of its byte', () => {
    const cm = buildControlMap(map(fill(16, 16, '.')));
    let lo = 255;
    let hi = 0;
    for (let k = BEND; k < cm.b.length; k += 4) {
      lo = Math.min(lo, cm.b[k]);
      hi = Math.max(hi, cm.b[k]);
    }
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(156);
  });

  it('is deterministic', () => {
    const m = map(['..1o^#rn..', '.r..2..3..']);
    const a = buildControlMap(m);
    const b = buildControlMap(m);
    expect(Array.from(a.a)).toEqual(Array.from(b.a));
    expect(Array.from(a.b)).toEqual(Array.from(b.b));
  });
});
