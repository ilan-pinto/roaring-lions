// One worker process of the passive-control sweep (`passive-sweep.ts`). It imports `run()` and
// nothing of `playtest.ts`, so it never runs the campaign ladder: it runs the no-orders control it
// is sent, on the seed it is sent, and replies with the outcome. A miss prints `run()`'s own run
// line and FAILED line to this process's stdout/stderr, which the parent shares.

import type { LedgerData } from '@lions/sim';
import { run, setSweep, sweepOutcome } from './playtest-run';

export interface SweepJob {
  /** Index of the control in the parent's list. */
  control: number;
  id: string;
  label: string;
  expect: 'defeat' | 'ongoing' | 'withdrawn';
  ledger: LedgerData;
  seed: number;
}

export interface SweepReply {
  control: number;
  seed: number;
  result: string;
}

if (process.send) {
  process.on('message', (job: SweepJob) => {
    const m = { result: 'ongoing', stars: 0, roeScore: 0, credits: 0 } as NonNullable<Parameters<typeof run>[10]>;
    setSweep(job.seed, true);
    run(job.id as Parameters<typeof run>[0], () => {}, job.ledger, job.expect === 'withdrawn' ? 'defeat' : job.expect, job.label, 0, undefined, new Set(), undefined, undefined, m);
    setSweep(undefined, false);
    // A miss is the parent's to count and report (`drainPassiveSweeps`); this process's own exit
    // code is kept for a crash, which the parent reports as runs left unanswered.
    process.exitCode = 0;
    const reply: SweepReply = { control: job.control, seed: job.seed, result: sweepOutcome(m.result, m.cause) };
    process.send?.(reply);
  });
}
