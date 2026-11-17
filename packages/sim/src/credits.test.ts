import { describe, expect, it } from 'vitest';
import { creditsFor, creditInputFrom, type CreditInput } from './credits';

// GH-1385: the oracles are literals. These used to read `CREDIT_WEIGHTS.win + 10 * CREDIT_WEIGHTS.unitHome`, a right-hand
// side recomputed from the code under test, so a changed weight (win 100 -> 101) moved both sides and left every test green.
// The weights are still the balance analyst's to change (credits.ts); a change now has to be made here as well, on purpose.

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
    expect(creditsFor(base())).toBe(200);
    expect(creditsFor(base({ lost: 4 }))).toBe(160);
  });

  it('pays each carrying secondary completed', () => {
    expect(creditsFor(base({ carryingComplete: 2 })) - creditsFor(base())).toBe(80);
  });

  it('pays Conduct only above the two-star floor, and never below zero', () => {
    // Floor is fail_below + 20 = 60; roe 75 is 15 over.
    expect(creditsFor(base({ roe: 75, failBelow: 40 })) - creditsFor(base({ roe: 60, failBelow: 40 }))).toBe(15);
    // Under the floor pays the same as at it: the term floors at zero, it never deducts.
    expect(creditsFor(base({ roe: 30, failBelow: 40 }))).toBe(creditsFor(base({ roe: 60, failBelow: 40 })));
    // No declared floor: the default ★★ floor of 70 applies.
    expect(creditsFor(base({ roe: 80 })) - creditsFor(base({ roe: 70 }))).toBe(10);
    // One point over the floor pays one: the boundary, where `over > 1` would pay nothing.
    expect(creditsFor(base({ roe: 71 }))).toBe(201);
  });

  it('pays the one unit a force of one brings home', () => {
    // The boundary, where `home > 1` would pay nothing.
    expect(creditsFor(base({ fielded: 1 }))).toBe(110);
  });

  it('never pays a negative home count when lost exceeds fielded', () => {
    // Defensive: a corrupt input must not deduct.
    expect(creditsFor(base({ fielded: 2, lost: 5 }))).toBe(100);
  });
});

describe('creditInputFrom', () => {
  it('extracts a CreditInput from a finished MissionRuntime, scoped to the starting force', () => {
    const roe = 75;
    const failBelow = 40;
    const rt = {
      result: 'victory' as const,
      // Two carrying secondaries complete and one not, so counting the wrong status (1) cannot pass for the right one (2);
      // a complete primary flagged `carries` and a complete secondary that does not carry must both count nothing.
      objectiveList: [
        { id: 'primary', type: 'survive_until', text: 'Survive', primary: true, carries: true, status: 'complete' as const },
        { id: 'secondary1', type: 'evacuate_before', text: 'Evacuate', primary: false, carries: true, status: 'complete' as const },
        { id: 'secondary2', type: 'raze', text: 'Raze', primary: false, carries: true, status: 'active' as const },
        { id: 'secondary3', type: 'raze', text: 'Raze', primary: false, carries: true, status: 'complete' as const },
        { id: 'secondary4', type: 'raze', text: 'Raze', primary: false, carries: false, status: 'complete' as const },
      ],
      // 8 started, 5 came home -- production units never enter either figure
      // (ruling R4), which is exactly what distinguishes this from fieldedCount.
      startingCount: 8,
      startingHome: 5,
    };

    const input = creditInputFrom(rt, roe, failBelow);

    expect(input).toEqual({
      result: 'victory',
      carryingComplete: 2,
      fielded: 8,
      lost: 3,
      roe,
      failBelow,
    });
  });
});
