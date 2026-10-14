import { describe, expect, it } from 'vitest';
import { limitHeadroom } from './time-limit';
import { sweepOutcome } from './playtest-run';

const at = (id: string, label: string, seconds: number) => ({ id, label, seconds });

describe('limitHeadroom (GH-540)', () => {
  it("passes Wadi Halam IV's measured slowest win under 840 s, and says so", () => {
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
