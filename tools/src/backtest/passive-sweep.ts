// The no-orders controls, held on thirty seeds rather than one.
//
// A control that holds on one seed is a control on that seed: First Light's passive run lost on
// 424242 and won on seeds 4 and 10 (and 10 of 1..99) before its villages moved off the wire
// (PR #533). Every no-orders control in `playtest.ts` goes through `passiveAcrossSeeds` now.
//
// The first seed runs inline, in place, and prints exactly the two lines a single run always
// printed. The other 29 are handed to worker processes as soon as the control is reached, so they
// run WHILE `playtest.ts` carries on down its campaign ladder; `drainPassiveSweeps()` at the end
// collects them and prints one summary line per control, in file order. Run serially they cost
// ~110 s of a ~130 s `pnpm playtest`; in workers the harness's wall clock barely moves.
//
// A miss prints `run()`'s own run line and FAILED line (from the worker, labelled with its seed)
// and sets the exit code here. `PT_SWEEP_WORKERS=0` runs every seed inline instead, in this
// process, for a reader who wants the serial behaviour; the outcome per seed is the same either
// way, because each run builds its own `Sim` from the seed and nothing else.

import { fork, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { LedgerData } from '@lions/sim';
import { run, lastIntelRun, setSweep, sweepOutcome, type IntelRun } from './playtest-run';
import type { SweepJob, SweepReply } from './passive-sweep-worker';

/** The seeds a swept control runs on: the pinned 424242 first, then 1..29 (PR #533's set). */
export const SWEEP_SEEDS: readonly number[] = [424242, ...Array.from({ length: 29 }, (_, k) => k + 1)];

type Expect = 'defeat' | 'ongoing' | 'withdrawn';

interface Control {
  /** The mission the control runs, which is the id its winning plan is labelled with. */
  id: string;
  label: string;
  expect: Expect;
  seeds: readonly number[];
  /** Seed -> outcome, filled as runs come back. */
  got: Map<number, string>;
  /** Seed -> what the run earned (`intel-gate.ts`), filled with `got`. */
  intel: Map<number, IntelRun>;
}

const controls: Control[] = [];
const workers: ChildProcess[] = [];
/** Runs sent to each worker and not yet answered (`control:seed`), by worker index. A run leaves
 *  its set when it is answered, when its send fails, or when its worker exits; the harness is
 *  idle when every set is empty, so a dead worker can never hang it. */
const owed: Set<string>[] = [];
let nextWorker = 0;
let onIdle: (() => void) | undefined;

function settle(w: number, key: string): void {
  owed[w].delete(key);
  if (owed.every((o) => o.size === 0)) onIdle?.();
}

function workerCount(): number {
  const env = process.env.PT_SWEEP_WORKERS;
  if (env !== undefined && env !== '') return Math.max(0, Math.floor(Number(env)) || 0);
  // Leave one core to `playtest.ts` itself, which keeps running its ladder meanwhile.
  return Math.max(1, Math.min(8, availableParallelism() - 1));
}

/** The label a swept seed prints under: `x (passive control)` -> `x (passive control, seed 7)`. */
export function seedLabel(label: string, seed: number): string {
  return `${label.slice(0, -1)}, seed ${seed})`;
}

function runInline(id: string, label: string, expect: Expect, ledger: LedgerData, seed: number, quiet: boolean): { result: string; intel: IntelRun } {
  const m = { result: 'ongoing', stars: 0, roeScore: 0, credits: 0 } as NonNullable<Parameters<typeof run>[10]>;
  try {
    setSweep(seed, quiet);
    run(id as Parameters<typeof run>[0], () => {}, ledger, expect === 'withdrawn' ? 'defeat' : expect, label, 0, undefined, new Set(), undefined, undefined, m);
  } finally {
    setSweep(undefined, false);
  }
  return { result: sweepOutcome(m.result, m.cause), intel: lastIntelRun() };
}

function spawnWorkers(n: number): void {
  const path = fileURLToPath(new URL('./passive-sweep-worker.ts', import.meta.url));
  for (let w = 0; w < n; w++) {
    owed.push(new Set());
    // `execArgv` carries tsx's own loader flags, so the child runs TypeScript the way this
    // process does. `advanced` serialisation hands the ledger over by structured clone.
    const child = fork(path, [], { execArgv: process.execArgv, serialization: 'advanced', stdio: 'inherit' });
    child.on('message', (msg: SweepReply) => {
      controls[msg.control].got.set(msg.seed, msg.result);
      controls[msg.control].intel.set(msg.seed, msg.intel);
      settle(w, `${msg.control}:${msg.seed}`);
    });
    // A worker that dies with runs owed must not hang the harness: what it owed stays without a
    // result, which the summary reports as a miss. A send to a dead worker lands here too.
    child.on('error', (err) => console.error(`passive sweep: worker ${w}: ${err.message}`));
    child.on('exit', (code) => {
      if (owed[w].size === 0) return;
      console.error(`passive sweep: FAILED — worker ${w} exited (code ${code}) with ${owed[w].size} run(s) unanswered`);
      process.exitCode = 1;
      for (const key of [...owed[w]]) settle(w, key);
    });
    workers.push(child);
  }
}

/**
 * A no-orders control held across `seeds`. The first seed runs here and prints what a single run
 * always printed; the rest are dispatched and stay quiet unless they miss.
 */
export function passiveAcrossSeeds(
  id: string,
  label: string,
  expect: Expect,
  ledger: LedgerData = {},
  seeds: readonly number[] = SWEEP_SEEDS
): void {
  // A seed's child process in the plan sweep (`plan-sweep.ts`) runs the winning plans only.
  if (process.env.PT_PLAN_CHILD === '1') return;
  const control: Control = { id, label, expect, seeds, got: new Map(), intel: new Map() };
  const index = controls.push(control) - 1;
  const first = runInline(id, label, expect, ledger, seeds[0], false);
  control.got.set(seeds[0], first.result);
  control.intel.set(seeds[0], first.intel);
  const n = workerCount();
  for (const seed of seeds.slice(1)) {
    if (n === 0) {
      const r = runInline(id, seedLabel(label, seed), expect, ledger, seed, true);
      control.got.set(seed, r.result);
      control.intel.set(seed, r.intel);
      continue;
    }
    if (workers.length === 0) spawnWorkers(n);
    const job: SweepJob = { control: index, id, label: seedLabel(label, seed), expect, ledger, seed };
    const w = nextWorker++ % workers.length;
    const key = `${index}:${seed}`;
    owed[w].add(key);
    workers[w].send(job, (err) => {
      if (err) settle(w, key);
    });
  }
}

/** Each control's mission id and what it earned on each seed it came back from (`intel-gate.ts`). */
export function controlIntel(): { id: string; label: string; intel: ReadonlyMap<number, IntelRun> }[] {
  return controls.map((c) => ({ id: c.id, label: c.label, intel: c.intel }));
}

/** A control runs to its own deadline (4-5 min), so one still ONGOING was at the 20-minute cap. */
function missLabel(got: string | undefined): string {
  return got === undefined ? 'no result' : got === 'ongoing' ? 'stuck' : got;
}

/** Waits for every dispatched seed, stops the workers, and prints one line per control. */
export async function drainPassiveSweeps(): Promise<void> {
  if (owed.some((o) => o.size > 0)) await new Promise<void>((resolve) => (onIdle = resolve));
  for (const w of workers) if (w.connected) w.disconnect();
  for (const c of controls) {
    const missed = c.seeds.filter((s) => c.got.get(s) !== c.expect);
    console.log(
      `${c.label}: ${c.expect.toUpperCase()} on ${c.seeds.length - missed.length}/${c.seeds.length} seeds` +
        (missed.length ? ` -- missed on ${missed.map((s) => `${s} (${missLabel(c.got.get(s))})`).join(', ')}` : '')
    );
    if (missed.length) process.exitCode = 1;
  }
}
