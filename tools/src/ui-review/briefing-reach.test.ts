import { describe, expect, it } from 'vitest';
import { briefingReachProblems, type BriefingReach } from './briefing-reach';

const good: BriefingReach = { scrollTop: 0, nameTop: 40, deployTop: 800, deployBottom: 850, viewportHeight: 900, ordersHiddenPx: 0 };

describe('briefingReachProblems', () => {
  it('passes a screen that opens at its top with Deploy in view', () => {
    expect(briefingReachProblems(good)).toEqual([]);
  });
  // The four readings origin/main produced on Wadi Halam V, one at a time.
  it.each([
    ['opened scrolled', { scrollTop: 104 }, /opened scrolled by 104/],
    ['name above the edge', { nameTop: -210 }, /210 px above the top edge/],
    ['Deploy below the fold', { deployTop: 1123, deployBottom: 1181, viewportHeight: 1080 }, /Deploy is not wholly on screen/],
    ['orders hidden', { ordersHiddenPx: 280 }, /280 px of the orders hidden/],
  ])('fails when %s', (_, patch, msg) => {
    const got = briefingReachProblems({ ...good, ...patch });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(msg);
  });
  it('allows one pixel of rounding in the orders block', () => {
    expect(briefingReachProblems({ ...good, ordersHiddenPx: 1 })).toEqual([]);
  });
});
