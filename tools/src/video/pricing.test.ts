// The cost table and the cap: the two numbers a spend gate refuses on. Every
// expected value below is a LITERAL from the pricing page (read 2026-10-11),
// never recomputed from pricing.ts's own table, so a wrong row cannot agree
// with itself.
import { describe, expect, it } from 'vitest';
import { checkBudget, HARD_CAP_USD } from './budget';
import { billedSeconds, estimateTakeUsd, takeSpecProblem } from './pricing';

const IN = { images: 1, promptChars: 400 };

describe('estimateTakeUsd', () => {
  it('prices Veo 3.1 per second of output, by tier and resolution', () => {
    expect(estimateTakeUsd({ model: 'veo-3.1', resolution: '720p', seconds: 8 }, IN)).toBeCloseTo(3.2, 10);
    expect(estimateTakeUsd({ model: 'veo-3.1', resolution: '1080p', seconds: 8 }, IN)).toBeCloseTo(3.2, 10);
    expect(estimateTakeUsd({ model: 'veo-3.1', resolution: '4k', seconds: 8 }, IN)).toBeCloseTo(4.8, 10);
    expect(estimateTakeUsd({ model: 'veo-3.1-fast', resolution: '720p', seconds: 8 }, IN)).toBeCloseTo(0.8, 10);
    expect(estimateTakeUsd({ model: 'veo-3.1-fast', resolution: '1080p', seconds: 8 }, IN)).toBeCloseTo(0.96, 10);
    expect(estimateTakeUsd({ model: 'veo-3.1-fast', resolution: '4k', seconds: 8 }, IN)).toBeCloseTo(2.4, 10);
    expect(estimateTakeUsd({ model: 'veo-3.1-lite', resolution: '720p', seconds: 4 }, IN)).toBeCloseTo(0.2, 10);
    expect(estimateTakeUsd({ model: 'veo-3.1-lite', resolution: '1080p', seconds: 8 }, IN)).toBeCloseTo(0.64, 10);
  });

  it('prices an Omni Flash take at its 10 s maximum, whatever length the shot asks for', () => {
    // 5,792 tokens/s x 10 s x $17.50 / 1M = $1.0136, plus 1,600 + 100 input tokens at $1.50 / 1M.
    const usd = estimateTakeUsd({ model: 'omni-flash', resolution: '720p', seconds: 6 }, IN);
    expect(usd).toBeCloseTo(1.0136 + 0.00255, 10);
    expect(estimateTakeUsd({ model: 'omni-flash', resolution: '720p', seconds: 3 }, IN)).toBe(usd);
    expect(billedSeconds({ model: 'omni-flash', resolution: '720p', seconds: 3 })).toBe(10);
    expect(billedSeconds({ model: 'veo-3.1-fast', resolution: '720p', seconds: 6 })).toBe(6);
  });

  it('charges a second Omni input image (a pinned loop)', () => {
    const one = estimateTakeUsd({ model: 'omni-flash', resolution: '720p', seconds: 8 }, { images: 1, promptChars: 0 });
    const two = estimateTakeUsd({ model: 'omni-flash', resolution: '720p', seconds: 8 }, { images: 2, promptChars: 0 });
    expect(two - one).toBeCloseTo(0.0024, 10);
  });

  it('refuses combinations the API does not offer or does not price', () => {
    expect(takeSpecProblem({ model: 'veo-3.1-lite', resolution: '4k', seconds: 8 })).toMatch(/no 4k/);
    expect(takeSpecProblem({ model: 'veo-3.1', resolution: '1080p', seconds: 6 })).toMatch(/needs seconds 8/);
    expect(takeSpecProblem({ model: 'veo-3.1-fast', resolution: '720p', seconds: 5 })).toMatch(/4, 6 or 8/);
    expect(takeSpecProblem({ model: 'omni-flash', resolution: '1080p', seconds: 8 })).toMatch(/unpublished/);
    expect(takeSpecProblem({ model: 'omni-flash', resolution: '720p', seconds: 12 })).toMatch(/3 to 10/);
    expect(() => estimateTakeUsd({ model: 'omni-flash', resolution: '4k', seconds: 8 }, IN)).toThrow(/unpublished/);
    expect(takeSpecProblem({ model: 'veo-3.1-fast', resolution: '720p', seconds: 8 })).toBeNull();
  });
});

describe('checkBudget', () => {
  it('is the lead\'s $150 cap', () => {
    expect(HARD_CAP_USD).toBe(150);
  });

  it('allows a spend that lands exactly on the cap, and refuses one cent over', () => {
    expect(checkBudget(149.2, 0.8).allowed).toBe(true);
    // Eighteen $3.20 takes summed the way the ledger sums them read 57.600000000000016,
    // so a float compare puts this spend (exactly $150.00) over the cap.
    const ledgerSum = Array.from({ length: 18 }, () => 3.2).reduce((a, b) => a + b, 0);
    expect(ledgerSum + 92.4 > 150).toBe(true);
    expect(checkBudget(ledgerSum, 92.4).allowed).toBe(true);
    expect(checkBudget(0, 150).allowed).toBe(true);
    const over = checkBudget(149.2, 0.81);
    expect(over.allowed).toBe(false);
    expect(over.reason).toMatch(/cap/);
  });

  it('refuses everything once the ledger is already past the cap', () => {
    expect(checkBudget(150.01, 0).allowed).toBe(false);
    expect(checkBudget(151, 0.05).allowed).toBe(false);
  });

  it('refuses a NaN, infinite or negative amount rather than coercing it', () => {
    expect(checkBudget(Number.NaN, 1).allowed).toBe(false);
    expect(checkBudget(0, Number.POSITIVE_INFINITY).allowed).toBe(false);
    expect(checkBudget(0, -5).allowed).toBe(false);
    expect(checkBudget(-200, 100).allowed).toBe(false);
  });

  it('reports what is left before and after', () => {
    const v = checkBudget(40, 10);
    expect(v.remainingBeforeUsd).toBe(110);
    expect(v.remainingAfterUsd).toBe(100);
  });
});
