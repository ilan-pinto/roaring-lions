import { describe, expect, it } from 'vitest';
import { CREDIT_WEIGHTS, creditsFor, creditInputFrom, type CreditInput } from './credits';

const base = (over: Partial<CreditInput> = {}): CreditInput => ({
  result: 'victory',
  carryingComplete: 0,
  fielded: 10,
  lost: 0,
  roe: 70,
  failBelow: undefined,
  ...over,
});

describe('creditsFor', () => {
  it('pays nothing for anything but a victory', () => {
    expect(creditsFor(base({ result: 'defeat' }))).toBe(0);
    expect(creditsFor(base({ result: 'ongoing' }))).toBe(0);
  });

  it('pays the win, then every unit brought home', () => {
    // 100 + 10 units home × 10; Conduct exactly at the default floor pays no extra.
    expect(creditsFor(base())).toBe(CREDIT_WEIGHTS.win + 10 * CREDIT_WEIGHTS.unitHome);
    expect(creditsFor(base({ lost: 4 }))).toBe(CREDIT_WEIGHTS.win + 6 * CREDIT_WEIGHTS.unitHome);
  });

  it('pays each carrying secondary completed', () => {
    expect(creditsFor(base({ carryingComplete: 2 })) - creditsFor(base())).toBe(2 * CREDIT_WEIGHTS.carryingSecondary);
  });

  it('pays Conduct only above the two-star floor, and never below zero', () => {
    // Floor is fail_below + 20 = 60; roe 75 is 15 over.
    expect(creditsFor(base({ roe: 75, failBelow: 40 })) - creditsFor(base({ roe: 60, failBelow: 40 }))).toBe(15);
    // Under the floor pays the same as at it: the term floors at zero, it never deducts.
    expect(creditsFor(base({ roe: 30, failBelow: 40 }))).toBe(creditsFor(base({ roe: 60, failBelow: 40 })));
    // No declared floor: the default ★★ floor of 70 applies.
    expect(creditsFor(base({ roe: 80 })) - creditsFor(base({ roe: 70 }))).toBe(10);
  });

  it('never pays a negative home count when lost exceeds fielded', () => {
    // Defensive: a corrupt input must not deduct.
    expect(creditsFor(base({ fielded: 2, lost: 5 }))).toBe(CREDIT_WEIGHTS.win);
  });
});

describe('creditInputFrom', () => {
  it('extracts a CreditInput from a finished MissionRuntime, scoped to the starting force', () => {
    const roe = 75;
    const failBelow = 40;
    const rt = {
      result: 'victory' as const,
      objectiveList: [
        { id: 'primary', type: 'survive_until', text: 'Survive', primary: true, carries: false, status: 'complete' as const },
        { id: 'secondary1', type: 'evacuate_before', text: 'Evacuate', primary: false, carries: true, status: 'complete' as const },
        { id: 'secondary2', type: 'raze', text: 'Raze', primary: false, carries: true, status: 'active' as const },
      ],
      // 8 started, 5 came home -- production units never enter either figure
      // (ruling R4), which is exactly what distinguishes this from fieldedCount.
      startingCount: 8,
      startingHome: 5,
    };

    const input = creditInputFrom(rt, roe, failBelow);

    expect(input).toEqual({
      result: 'victory',
      carryingComplete: 1,
      fielded: 8,
      lost: 3,
      roe,
      failBelow,
    });
  });
});
