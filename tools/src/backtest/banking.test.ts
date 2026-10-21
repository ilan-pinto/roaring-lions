// F2 Task 9: the banking arithmetic. `playtest.ts` pins counts built from it, so the edges are held here.
import { describe, expect, it } from 'vitest';
import { bankedOver, bankedPercent, bankingLine, spentOf, type Banking } from './banking';

const b = (start: number, earned: number, held: number, zoneEarned = 0): Banking => ({ start, earned, held, zoneEarned });

describe('banking', () => {
  it('spent is start + earned - held', () => {
    expect(spentOf(b(300, 200, 150))).toBe(350);
  });
  it('spent is never negative when flooring leaves held one over', () => {
    expect(spentOf(b(0, 0, 1))).toBe(0);
  });
  it('the percent is held over everything available', () => {
    expect(bankedPercent(b(300, 200, 150))).toBe('30%');
    expect(bankedPercent(b(0, 0, 0))).toBe('-');
  });
  it('over 30 is strict: exactly 30 is not over, and the test does not round', () => {
    expect(bankedOver(b(0, 100, 30), 30)).toBe(false);
    expect(bankedOver(b(0, 100, 31), 30)).toBe(true);
    // 30.4% displays as 30% and is over 30.
    expect(bankedPercent(b(0, 1000, 304))).toBe('30%');
    expect(bankedOver(b(0, 1000, 304), 30)).toBe(true);
  });
  it('a run with nothing to bank is not over any threshold', () => {
    expect(bankedOver(b(0, 0, 0), 30)).toBe(false);
  });
  it('prints the line the harness appends', () => {
    expect(bankingLine('m', 'plan', b(100, 50, 60, 20))).toBe('banking m (plan): earned 50 (zones 20), spent 90, banked 60 (40%)');
  });
});
