// The failure path `shoot.ts`'s outcome captures now run through -- see
// `outcome-guard.ts`'s header for the bug this closes. Both tests drive the
// failure and the pass, the same discipline `capture-guard.test.ts` (its
// neighbour under `golden-diff/`) already uses for this file's family: a
// stub that only ever answers "still present" could not have caught the
// defect this guards against.
import { describe, expect, it } from 'vitest';
import { assertOutcomeStillPresent, OutcomeMomentDismissedError } from './outcome-guard';

describe('assertOutcomeStillPresent', () => {
  it('throws a named error naming the capture when the outcome moment is already gone', () => {
    expect(() => assertOutcomeStillPresent(false, '25-outcome-defeat')).toThrow(OutcomeMomentDismissedError);
    expect(() => assertOutcomeStillPresent(false, '25-outcome-defeat')).toThrow(
      'outcome moment dismissed before its photograph (25-outcome-defeat)'
    );
  });

  it('names the OTHER capture when that is the one that raced', () => {
    expect(() => assertOutcomeStillPresent(false, '24-outcome-victory')).toThrow(
      'outcome moment dismissed before its photograph (24-outcome-victory)'
    );
  });

  it('does nothing when the outcome moment is still present -- the happy path must stay silent', () => {
    expect(() => assertOutcomeStillPresent(true, '25-outcome-defeat')).not.toThrow();
    expect(() => assertOutcomeStillPresent(true, '24-outcome-victory')).not.toThrow();
  });
});
