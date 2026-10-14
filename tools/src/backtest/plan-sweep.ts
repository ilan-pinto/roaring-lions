// The winning plans, held on thirty seeds rather than one.
//
// `passive-sweep.ts` holds the no-orders controls on PR #533's seed set. The winning plans need the
// same, and for the same reason: a plan written against seed 424242 is a plan for that seed. PR
// #539 measured 15 of 36 winning plans missing on some of seeds 1..29, seven of them broken by
// #537 (a player's attack-move stops where it is sent), so the plans were re-scripted and this
// keeps them honest.
//
// A control can be re-run anywhere from its id alone (its plan is `() => {}`); a winning plan is a
// closure in `playtest.ts`, and its ledger is the output of the plans before it ON THE SAME SEED.
// So a seed here is a whole campaign: one child process per seed runs `playtest.ts` itself with
// `PT_SEED=<seed>` and `PT_PLAN_CHILD=1`, which runs every winning plan down its own chained
// ledgers, skips the controls and the max-tier replay, and sends back what each run did and
// whether the unlock gates opened where `playtest.ts` pins them. The children start before the
// ladder and run beside it; `drainPlanSweeps()` at the end prints one line per winning plan, with
// seed 424242 taken from this process's own runs.
//
// A miss (a defeat, or a run STUCK at the 20-minute cap) sets exit 1, and so does a gate that does
// not open on time, or opens early, on any seed's own ladder.
//
// `PT_PLAN_SWEEP=0` turns the whole sweep off (seed 424242 alone, as before #539).
// `PT_PLAN_WORKERS=<n>` caps the children run at once (default: `passive-sweep.ts`'s count).

import { fork, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { missions } from '@lions/data';
import { outcomeName, runLog, type RunRecord } from './playtest-run';
import { limitHeadroom, type WinTime } from './time-limit';
import { SWEEP_SEEDS } from './passive-sweep';

/** True inside a seed's child process. */
export const PLAN_CHILD = process.env.PT_PLAN_CHILD === '1';

/** One unlock gate's two checks on one seed's ladder. */
export interface GateRecord {
  gate: string;
  /** Open at the mission `playtest.ts` pins it to open after. */
  open: boolean;
  /** Still closed one mission earlier. */
  closed: boolean;
}

interface ChildReply {
  seed: number;
  runs: RunRecord[];
  gates: GateRecord[];
}

const replies = new Map<number, ChildReply>();
const failedSeeds = new Map<number, string>();
let pending = 0;
let onIdle: (() => void) | undefined;

function poolSize(): number {
  const env = process.env.PT_PLAN_WORKERS;
  if (env !== undefined && env !== '') return Math.max(1, Math.floor(Number(env)) || 1);
  return Math.max(1, Math.min(8, availableParallelism() - 1));
}

function launch(seed: number, queue: number[]): void {
  const path = fileURLToPath(new URL('./playtest.ts', import.meta.url));
  // `silent`: a child's own lines (run lines, the pinned 424242 numbers it does not meet) are not
  // this report. What it ran comes back as a message; its stderr is kept for a crash.
  const child: ChildProcess = fork(path, [], {
    execArgv: process.execArgv,
    env: { ...process.env, PT_SEED: String(seed), PT_PLAN_CHILD: '1', PT_SWEEP_WORKERS: '0' },
    serialization: 'advanced',
    silent: true,
  });
  let err = '';
  child.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
  child.stdout?.resume();
  child.on('message', (msg: ChildReply) => replies.set(msg.seed, msg));
  // `close`, not `exit`: it comes after the IPC channel and stdio are drained, so a report the
  // child sent just before exiting has already arrived.
  child.on('close', (code) => {
    if (!replies.has(seed)) {
      // Node's own trailer ("Node.js v25...") is the last stderr line; the error is the line naming it.
      const lines = err.trim().split('\n');
      const why = lines.find((l) => /Error|FAILED/.test(l)) ?? lines.pop() ?? '';
      failedSeeds.set(seed, `child exited (code ${code}) without a report${why ? `: ${why.trim()}` : ''}`);
    }
    pending--;
    const next = queue.shift();
    if (next !== undefined) {
      pending++;
      launch(next, queue);
    } else if (pending === 0) onIdle?.();
  });
}

/** Starts one child per seed after the first (which is this process's own run). */
export function startPlanSweep(seeds: readonly number[] = SWEEP_SEEDS): void {
  if (PLAN_CHILD || process.env.PT_PLAN_SWEEP === '0') return;
  const queue = seeds.slice(1);
  for (let w = 0; w < poolSize() && queue.length > 0; w++) {
    const seed = queue.shift() as number;
    pending++;
    launch(seed, queue);
  }
}

/** In a child: hands what it ran back to the parent. */
export function reportToParent(gates: GateRecord[]): void {
  if (!PLAN_CHILD || !process.send) return;
  process.send({ seed: Number(process.env.PT_SEED), runs: runLog, gates } satisfies ChildReply);
}

/** #540: one line per mission with a winning plan, and exit 1 if a limit sits too close to a win. */
function reportLimitHeadroom(runSets: Iterable<readonly RunRecord[]>): void {
  const wins: WinTime[] = [];
  for (const runs of runSets) {
    for (const r of runs) if (r.result === 'victory') wins.push({ id: r.id, label: r.label, seconds: r.minutes * 60 });
  }
  const limits = missions as Record<string, { time_limit_s?: number } | undefined>;
  const { lines, failures } = limitHeadroom(wins, (id) => limits[id]?.time_limit_s);
  for (const l of lines) console.log(l);
  for (const f of failures) console.error(f);
  if (failures.length > 0) process.exitCode = 1;
}

/**
 * Waits for every seed, then prints one line per winning plan and one per unlock gate.
 *
 * A winning plan must win on every seed, and every gate must open after the mission `playtest.ts`
 * pins it to and stay closed one mission earlier, on every seed's own ladder: a miss of either is
 * red. Each seed's ladder is its own campaign (its stars come from its own runs), so this is the
 * question "would a player who plays these plans on any of these seeds unlock the unit when the
 * campaign says", not a re-reading of the 424242 numbers.
 */
export async function drainPlanSweeps(seeds: readonly number[], gates424242: GateRecord[]): Promise<void> {
  if (PLAN_CHILD) return;
  if (process.env.PT_PLAN_SWEEP === '0') {
    reportLimitHeadroom([runLog]);
    return;
  }
  if (pending > 0) await new Promise<void>((resolve) => (onIdle = resolve));
  const bySeed = new Map<number, RunRecord[]>([[seeds[0], runLog.slice()]]);
  for (const [seed, r] of replies) bySeed.set(seed, r.runs);
  const labels = runLog.filter((r) => r.expect === 'victory' && !r.label.endsWith('(max tier)')).map((r) => r.label);
  let held = 0;
  for (const label of labels) {
    const missed: string[] = [];
    let slowest = 0;
    for (const seed of seeds) {
      const r = bySeed.get(seed)?.find((x) => x.label === label);
      if (!r) {
        missed.push(`${seed} (${failedSeeds.get(seed) ?? 'no run'})`);
        continue;
      }
      if (r.result !== 'victory') missed.push(`${seed} (${outcomeName(r.result, r.stuck).toLowerCase()})`);
      else slowest = Math.max(slowest, r.minutes);
    }
    if (missed.length === 0) held++;
    else process.exitCode = 1;
    console.log(
      `${label}: VICTORY on ${seeds.length - missed.length}/${seeds.length} seeds, slowest ${slowest.toFixed(1)} min` +
        (missed.length ? ` -- missed on ${missed.join(', ')}` : '')
    );
    if (missed.length) console.error(`${label}: FAILED — the plan does not win on every seed`);
  }
  console.log(`plan sweep: ${held} of ${labels.length} winning plans win on all ${seeds.length} seeds`);
  for (const g of gates424242) {
    let open = 0;
    let closed = 0;
    for (const seed of seeds) {
      const rec = seed === seeds[0] ? g : replies.get(seed)?.gates.find((x) => x.gate === g.gate);
      if (rec?.open) open++;
      if (rec?.closed) closed++;
    }
    console.log(`gate ${g.gate} across seeds: OPEN on time on ${open}/${seeds.length}, CLOSED until then on ${closed}/${seeds.length}`);
    if (open !== seeds.length || closed !== seeds.length) {
      console.error(`gate ${g.gate}: FAILED — does not open where it is pinned on every seed`);
      process.exitCode = 1;
    }
  }
  reportLimitHeadroom(bySeed.values());
}
