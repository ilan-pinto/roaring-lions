// packages/app/src/roster-cap.test.ts
import { describe, expect, it } from 'vitest';
import { ROSTER_CAP } from './roster-cap';

describe('ROSTER_CAP', () => {
  // The page's rule: "the cap should sit above what a ★★★ campaign accumulates,
  // not below it." The largest roster any threaded chain in `pnpm playtest`
  // produces is 30 (umm_zeitoun_4_clearance, 2026-09-20); the loose
  // sum-of-chain-maxima ceiling, which assumes zero cross-chain draw-down and is
  // therefore an over-estimate, is 126. The harness re-checks the first of those
  // on every push; this pins the DECISION so a silent edit to the constant is a
  // red test rather than a shipped design change.
  it('is 150 -- above the measured 30 and above the loose 126 ceiling', () => {
    expect(ROSTER_CAP).toBe(150);
    expect(ROSTER_CAP).toBeGreaterThan(126);
  });
});
