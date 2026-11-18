import { describe, expect, it } from 'vitest';
import { fastestWins, limitHeadroom } from './time-limit';
import { sweepOutcome } from './playtest-run';
import { branchTwoMaxTierLabel, isFloorReportOnly, isPinnedOnly } from './pinned-only';

const at = (id: string, label: string, seconds: number) => ({ id, label, seconds });

describe('limitHeadroom (GH-540)', () => {
  it("passes a 679 s win under an 840 s limit, and says so", () => {
    const r = limitHeadroom([at('wh4', 'wh4', 408), at('wh4', 'wh4 (gate open)', 679)], () => 840);
    expect(r.failures).toEqual([]);
    expect(r.lines).toEqual(['time limit wh4: 840 s, slowest win 679 s (wh4 (gate open)), headroom 161 s']);
  });
  it('fails a limit inside 120 s of a short win, where 120 s is the larger margin', () => {
    expect(limitHeadroom([at('a', 'a', 300)], () => 419).failures).toHaveLength(1);
    expect(limitHeadroom([at('a', 'a', 300)], () => 420).failures).toEqual([]);
  });
  it('fails a limit inside 20% of a long win, where 20% is the larger margin', () => {
    expect(limitHeadroom([at('a', 'a', 700)], () => 839).failures).toHaveLength(1);
    expect(limitHeadroom([at('a', 'a', 700)], () => 840).failures).toEqual([]);
  });
  it('fails a mission that wins and declares no limit', () => {
    expect(limitHeadroom([at('a', 'a', 60)], () => undefined).failures).toHaveLength(1);
  });
});

describe('sweepOutcome (GH-540)', () => {
  it('reports a defeat by the limit apart from any other defeat', () => {
    expect(sweepOutcome('defeat', 'withdrawn')).toBe('withdrawn');
    expect(sweepOutcome('defeat', 'objective:evac')).toBe('defeat');
    expect(sweepOutcome('ongoing', undefined)).toBe('ongoing');
  });
});

describe('fastestWins (GH-1075 A2)', () => {
  it('fastestWins keeps the minimum', () => {
    const r = fastestWins([at('a', 'a', 300), at('a', 'a (gate open)', 200), at('a', 'a', 400), at('b', 'b', 90)]);
    expect(r.get('a')).toEqual(at('a', 'a (gate open)', 200));
    expect(r.get('b')?.seconds).toBe(90);
    expect(r.size).toBe(2);
  });
  // GH-1384, the lead's ruling on PR 1584: a branch-2 max-tier replay is report-only for the floor, and the branch-1 `(max tier)` replay
  // still counts, exactly as on dev. Labels are literals, as playtest.ts writes them.
  it('skips a branch-2 max-tier replay, however fast, and still counts the branch-1 (max tier) one', () => {
    const r = fastestWins([
      at('a', 'a', 310),
      at('a', 'a (max tier)', 306),
      at('a', 'a branch 2 (max tier)', 302),
      at('b', 'b branch 2 (max tier)', 50),
    ]);
    expect(r.get('a')).toEqual(at('a', 'a (max tier)', 306));
    expect(r.has('b')).toBe(false); // a mission won only by a branch-2 replay has no floor reading from it
  });
  it('the playtest writes the branch-2 label the floor skips, and it stays pinned-only', () => {
    expect(branchTwoMaxTierLabel('x')).toBe('x branch 2 (max tier)');
    expect(isFloorReportOnly(branchTwoMaxTierLabel('x'))).toBe(true);
    expect(isPinnedOnly(branchTwoMaxTierLabel('x'))).toBe(true);
    expect(isFloorReportOnly('x (max tier)')).toBe(false);
  });
});
