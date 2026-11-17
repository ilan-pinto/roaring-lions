// F2 Task 9: the banking arithmetic. `playtest.ts` pins counts built from it, so the edges are held here.
import { describe, expect, it } from 'vitest';
import { bankedOver, bankedPercent, bankingBoundFailure, bankingLine, spentOf, type Banking } from './banking';

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
    // GH-1385: the input above cannot see the `avail > 0` guard (0 > 0 is false either way). A purse of nothing that the
    // runtime's flooring leaves holding one logistic is the case the guard is for.
    expect(bankedOver(b(0, 0, 1), 30)).toBe(false);
  });
  it('the percent rounds half up, not down (GH-1385)', () => {
    // 30.5% prints 31%; every other percent in this file is exact or rounds down, so `Math.floor` passed them all.
    expect(bankedPercent(b(0, 1000, 305))).toBe('31%');
  });
  it('prints the line the harness appends', () => {
    expect(bankingLine('m', 'plan', b(100, 50, 60, 20))).toBe('banking m (plan): earned 50 (zones 20), spent 90, banked 60 (40%)');
  });
});

// GH-1385: the gate is an upper bound, with literals for the oracle (nothing here is read from playtest.ts).
describe('bankingBoundFailure: an upper bound on the plans that bank over 30%', () => {
  it('holds at the bound and below it: fewer bankers is an improvement, not a failure', () => {
    expect(bankingBoundFailure(15, 20, 15)).toBeNull();
    expect(bankingBoundFailure(14, 20, 15)).toBeNull();
    expect(bankingBoundFailure(0, 20, 15)).toBeNull();
  });
  it('fails when one more plan banks over 30%, and says how many', () => {
    expect(bankingBoundFailure(16, 20, 15)).toBe('16 of 20 winning plans bank over 30%, expected at most 15');
    expect(bankingBoundFailure(20, 20, 15)).toBe('20 of 20 winning plans bank over 30%, expected at most 15');
  });
  it('fails over no winning plan at all: a bound on an empty set cannot fail', () => {
    expect(bankingBoundFailure(0, 0, 15)).toBe('no winning plan reported banking, so the bound on plans that bank over 30% read nothing');
  });
});
