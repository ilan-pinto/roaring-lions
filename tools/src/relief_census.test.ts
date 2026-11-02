// The two relief measurements of tools/src/relief_census.ts (GH-920 B1/B2), held to literals.
import { describe, expect, it } from 'vitest';
import { contourWander, fatStairs } from './relief_census';

const N = 40;
const none = new Uint8Array(N * N);
const bank = (f: (x: number, y: number) => number, n = N) => {
  const a = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = f(x, y);
  return a;
};

describe('fatStairs: the 2x2 staircase, found in the grid', () => {
  it('a bank on 2x2 cells has them, and a bank one tile a step has none', () => {
    // scallop.py's two banks: level 1 where x + y >= 40 (per tile), and where x/2 + y/2 >= 20 (per 2x2 cell)
    const cell = bank((x, y) => ((x >> 1) + (y >> 1) >= 20 ? 1 : 0));
    const tile = bank((x, y) => (x + y >= 40 ? 1 : 0));
    // the cell bank steps every two rows from column 40 down to 0 ... a 40-wide map holds 19 steps, so 17 windows of 3
    expect(fatStairs(cell, N, N).count).toBe(17);
    expect(fatStairs(tile, N, N).count).toBe(0);
  });

  it('names where it found them, as "column,row L<level>"', () => {
    const cell = bank((x, y) => ((x >> 1) + (y >> 1) >= 20 ? 1 : 0));
    expect(fatStairs(cell, N, N).first[0]).toMatch(/^\d+,\d+ L1$/);
  });

  it('a bank at 2:1 or 1:2 per tile is not a 2x2 stair, nor is a straight edge', () => {
    expect(fatStairs(bank((x, y) => (2 * x + y >= 60 ? 1 : 0)), N, N).count).toBe(0);
    expect(fatStairs(bank((x, y) => (x + 2 * y >= 60 ? 1 : 0)), N, N).count).toBe(0);
    expect(fatStairs(bank((x) => (x >= 20 ? 1 : 0)), N, N).count).toBe(0);
    expect(fatStairs(bank((_x, y) => (y >= 20 ? 1 : 0)), N, N).count).toBe(0);
  });

  it('sees the stair from either side and in either direction', () => {
    const flipX = bank((x, y) => ((((N - 1 - x) >> 1) + (y >> 1)) >= 20 ? 1 : 0));
    const below = bank((x, y) => ((x >> 1) + (y >> 1) < 20 ? 1 : 0));
    expect(fatStairs(flipX, N, N).count).toBeGreaterThan(0);
    expect(fatStairs(below, N, N).count).toBeGreaterThan(0);
  });
});

describe('contourWander: scallop.py on a whole map', () => {
  it('reads PR 928\'s two banks: 0.13 for one tile a step, 1.08 for 2x2 cells (scallop.py: 0.15 and 0.94)', () => {
    const tile = contourWander(bank((x, y) => (x + y >= 40 ? 1 : 0)), none, N, N);
    const cell = contourWander(bank((x, y) => ((x >> 1) + (y >> 1) >= 20 ? 1 : 0)), none, N, N);
    expect(tile.wander).toBeGreaterThan(0.08);
    expect(tile.wander).toBeLessThan(0.16);
    expect(cell.wander).toBeGreaterThan(0.9);
    expect(cell.wander).toBeLessThan(1.25);
    expect(tile.measured).toBe(1);
  });

  it('reads a flat map and a short contour as nothing measured', () => {
    expect(contourWander(none, none, N, N)).toMatchObject({ wander: 0, measured: 0, at: null });
    const knoll = bank((x, y) => (Math.abs(x - 20) < 3 && Math.abs(y - 20) < 3 ? 1 : 0));
    expect(contourWander(knoll, none, N, N).measured).toBe(0);
  });

  it('is NOT a staircase detector: a per-tile bank at 2:1 reads 0.4 and at 3:1 0.76, which is why it is report-only', () => {
    // level = floor((a x + b y) / (a + b) / 12) % 3: the same banks, drawn one tile a step at the slope
    const slope = (a: number, b: number, n = 64) => bank((x, y) => Math.floor((a * x + b * y) / (a + b) / 12) % 3, n);
    const read = (a: number, b: number) => contourWander(slope(a, b), new Uint8Array(64 * 64), 64, 64).wander;
    expect(read(1, 1)).toBeLessThan(0.2);
    expect(read(2, 1)).toBeGreaterThan(0.3);
    expect(read(3, 1)).toBeGreaterThan(0.6);
  });
});
