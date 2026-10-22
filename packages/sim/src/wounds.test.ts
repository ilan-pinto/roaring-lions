import { describe, expect, it } from 'vitest';
import { bestCoverTile, figuresStanding, rescuePriority, scaleDown, scarredShare } from './wounds';

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
    // (4,2) = 14 and (2,3) = 17 blocked lie off its line: still taken. ((3,3) = 18 is ON it:
    // see the knight's-move case below.)
    expect(bestCoverTile(grid({ 19: 3 }), grid({ 14: 1, 17: 1 }), 5, 5, 2, 2)).toBe(19);
    // (0,1) = 5: offset (-2,-1) -> midpoint (1,2) = 11.
    expect(bestCoverTile(grid({ 5: 3 }), grid({ 11: 1 }), 5, 5, 2, 2)).toBe(12);
    // A tile one away is never midpoint-checked: (1,1) = 6 with nothing blocked around.
    expect(bestCoverTile(grid({ 6: 1 }), grid({ 7: 1, 11: 1 }), 5, 5, 2, 2)).toBe(6);
  });

  it("refuses a knight's move whose line crosses a blocked tile beside the midpoint (Task 3 review)", () => {
    // From (0,0) to (2,1) = 7: the line (0.5,0.5) -> (2.5,1.5) crosses x = 1..2 at
    // y = 0.75..1.25, i.e. tiles (1,0) = 1 AND (1,1) = 6. The midpoint rule alone checked
    // only (1,0); with (1,1) blocked he crawled into the wall and lay against it for good.
    expect(bestCoverTile(grid({ 7: 3 }), grid({ 6: 1 }), 5, 5, 0, 0)).toBe(0);
    expect(bestCoverTile(grid({ 7: 3 }), grid({ 1: 1 }), 5, 5, 0, 0)).toBe(0); // the midpoint, as before
    expect(bestCoverTile(grid({ 7: 3 }), NONE, 5, 5, 0, 0)).toBe(7);
    // (1,2) = 11, the transpose: crosses (0,1) = 5 (midpoint) and (1,1) = 6.
    expect(bestCoverTile(grid({ 11: 3 }), grid({ 6: 1 }), 5, 5, 0, 0)).toBe(0);
    expect(bestCoverTile(grid({ 11: 3 }), NONE, 5, 5, 0, 0)).toBe(11);
    // Mirrors from (2,2) = 12. (4,3) = 19: crosses (3,2) = 13 and (3,3) = 18.
    expect(bestCoverTile(grid({ 19: 3 }), grid({ 18: 1 }), 5, 5, 2, 2)).toBe(12);
    // (0,1) = 5, offset (-2,-1): crosses (1,2) = 11 (midpoint) and (1,1) = 6.
    expect(bestCoverTile(grid({ 5: 3 }), grid({ 6: 1 }), 5, 5, 2, 2)).toBe(12);
    // (1,4) = 21, offset (-1,2): crosses (2,3) = 17 (midpoint) and (1,3) = 16.
    expect(bestCoverTile(grid({ 21: 3 }), grid({ 16: 1 }), 5, 5, 2, 2)).toBe(12);
    expect(bestCoverTile(grid({ 21: 3 }), grid({ 15: 1, 22: 1 }), 5, 5, 2, 2)).toBe(21); // off the line
    // (3,0) = 3, offset (1,-2): crosses (2,1) = 7 (midpoint) and (3,1) = 8.
    expect(bestCoverTile(grid({ 3: 3 }), grid({ 8: 1 }), 5, 5, 2, 2)).toBe(12);
    // A straight two ((4,2) = 14) or a diagonal two ((4,4) = 24) has only its midpoint between.
    expect(bestCoverTile(grid({ 14: 3 }), grid({ 8: 1, 18: 1 }), 5, 5, 2, 2)).toBe(14);
    expect(bestCoverTile(grid({ 24: 3 }), grid({ 17: 1, 19: 1 }), 5, 5, 2, 2)).toBe(24);
  });

  it('stays on the map at its edge', () => {
    // From (0,0): the window is x 0..2, y 0..2; (2,2) = 12 is the far corner, 24 is outside it.
    expect(bestCoverTile(grid({ 12: 1, 24: 3 }), NONE, 5, 5, 0, 0)).toBe(12);
    expect(bestCoverTile(grid({ 24: 3 }), NONE, 5, 5, 0, 0)).toBe(0);
  });
});

describe('rescuePriority (GH-707 D2)', () => {
  it('own side 0, a civilian 1, an enemy -1, from either fighting side', () => {
    expect([rescuePriority(0, 0), rescuePriority(0, 2), rescuePriority(0, 1)]).toEqual([0, 1, -1]);
    expect([rescuePriority(1, 1), rescuePriority(1, 2), rescuePriority(1, 0)]).toEqual([0, 1, -1]);
    // A civilian-side rescuer: his own are side 2, so they are "own" (0), never "civilian" (1).
    expect([rescuePriority(2, 2), rescuePriority(2, 0)]).toEqual([0, -1]);
  });
});

describe('scarredShare (GH-707 Task 6)', () => {
  it('a 100-hp share is worth 100, 80, 60, 40, then 40 at the 0.4 floor', () => {
    // share 100 = 6553600 raw; fx.mul(6553600, m) = 100 x m exactly. m = 65536 - 13107 x scars,
    // floored at 26214: 65536, 52429, 39322, 26215, then 13108 -> 26214.
    const share = 100 * 65536;
    expect([0, 1, 2, 3, 4, 9].map((n) => scarredShare(share, n))).toEqual([6553600, 5242900, 3932200, 2621500, 2621400, 2621400]);
  });
});
