import { describe, expect, it } from 'vitest';
import { figuresStanding, scaleDown } from './wounds';

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
