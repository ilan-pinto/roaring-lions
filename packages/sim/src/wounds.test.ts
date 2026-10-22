import { describe, expect, it } from 'vitest';
import { bestCoverTile, figuresStanding, scaleDown } from './wounds';

// GH-707 Task 2: the pure share arithmetic. Literals only: 400 hp is 400 x 65536 = 26214400.
const HP400 = 26214400;

describe('figuresStanding (GH-707)', () => {
  it('rounds up to whole men: ceil(hp x figures / typeHp), clamped to 0..figures', () => {
    expect(figuresStanding(HP400, HP400, 4)).toBe(4); // full
    expect(figuresStanding(300 * 65536, HP400, 4)).toBe(3); // exactly three shares
    expect(figuresStanding(299 * 65536, HP400, 4)).toBe(3); // 2.99 shares -> 3
    expect(figuresStanding(101 * 65536, HP400, 4)).toBe(2); // 1.01 shares -> 2
    expect(figuresStanding(65536, HP400, 4)).toBe(1); // 1 hp still stands one man
    expect(figuresStanding(1, HP400, 4)).toBe(1); // one raw unit of hp too
    expect(figuresStanding(0, HP400, 4)).toBe(0);
    expect(figuresStanding(-65536, HP400, 4)).toBe(0);
    expect(figuresStanding(HP400 + 65536, HP400, 4)).toBe(4); // over full clamps
    expect(figuresStanding(30 * 65536, 30 * 65536, 1)).toBe(1);
  });
});

describe('scaleDown (GH-707)', () => {
  it('truncates a x num / den', () => {
    // 18350000 x 1 / 4 = 4587500; x 3 / 4 = 13762500; 7 x 1 / 2 = 3.5 -> 3.
    expect(scaleDown(18350000, 1, 4)).toBe(4587500);
    expect(scaleDown(18350000, 3, 4)).toBe(13762500);
    expect(scaleDown(7, 1, 2)).toBe(3);
    expect(scaleDown(18350000, 0, 4)).toBe(0);
  });
});

describe('bestCoverTile (GH-707 Task 3)', () => {
  // A 5x5 map, index = y x 5 + x; the wounded lies at (2,2) = 12 unless said otherwise.
  const grid = (cells: Record<number, number>): Uint8Array => {
    const g = new Uint8Array(25);
    for (const [k, v] of Object.entries(cells)) g[Number(k)] = v;
    return g;
  };
  const NONE = grid({});

  it('takes the highest cover in the window, and the start when nothing beats it', () => {
    expect(bestCoverTile(grid({ 13: 1, 19: 3 }), NONE, 5, 5, 2, 2)).toBe(19);
    expect(bestCoverTile(NONE, NONE, 5, 5, 2, 2)).toBe(12);
    // Equal to the start is not better: lying on cover 2 next to cover 2, he stays.
    expect(bestCoverTile(grid({ 12: 2, 7: 2, 13: 2 }), NONE, 5, 5, 2, 2)).toBe(12);
  });

  it('a tie goes to the lowest tile index', () => {
    // (2,1) = 7 and (1,2) = 11, both cover 2: 7.
    expect(bestCoverTile(grid({ 11: 2, 7: 2 }), NONE, 5, 5, 2, 2)).toBe(7);
    // (4,4) = 24 and (0,4) = 20, both 3: 20.
    expect(bestCoverTile(grid({ 24: 3, 20: 3 }), NONE, 5, 5, 2, 2)).toBe(20);
  });

  it('never picks a blocked tile', () => {
    expect(bestCoverTile(grid({ 13: 3, 17: 1 }), grid({ 13: 1 }), 5, 5, 2, 2)).toBe(17);
  });

  it('refuses a tile two away whose midpoint is blocked; the midpoint halves each offset toward zero', () => {
    // (0,0) = 0, cover 3, two away diagonally; midpoint (1,1) = 6.
    expect(bestCoverTile(grid({ 0: 3 }), grid({ 6: 1 }), 5, 5, 2, 2)).toBe(12);
    expect(bestCoverTile(grid({ 0: 3 }), NONE, 5, 5, 2, 2)).toBe(0);
    // (4,3) = 19: offset (2,1) -> midpoint (2+1, 2+0) = (3,2) = 13.
    expect(bestCoverTile(grid({ 19: 3 }), grid({ 13: 1 }), 5, 5, 2, 2)).toBe(12);
    // (3,3) = 18 blocked is not its midpoint: still taken.
    expect(bestCoverTile(grid({ 19: 3 }), grid({ 18: 1 }), 5, 5, 2, 2)).toBe(19);
    // (0,1) = 5: offset (-2,-1) -> midpoint (1,2) = 11.
    expect(bestCoverTile(grid({ 5: 3 }), grid({ 11: 1 }), 5, 5, 2, 2)).toBe(12);
    // A tile one away is never midpoint-checked: (1,1) = 6 with nothing blocked around.
    expect(bestCoverTile(grid({ 6: 1 }), grid({ 7: 1, 11: 1 }), 5, 5, 2, 2)).toBe(6);
  });

  it('stays on the map at its edge', () => {
    // From (0,0): the window is x 0..2, y 0..2; (2,2) = 12 is the far corner, 24 is outside it.
    expect(bestCoverTile(grid({ 12: 1, 24: 3 }), NONE, 5, 5, 0, 0)).toBe(12);
    expect(bestCoverTile(grid({ 24: 3 }), NONE, 5, 5, 0, 0)).toBe(0);
  });
});
