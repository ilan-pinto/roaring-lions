// GH-1387 S0 (REPORT-ONLY, not wired into CI, `pnpm test` or `pnpm playtest`): a preload for `playtest.ts` that, with `PT_NOSPEND=1`,
// refuses every `requestBuild`, `requestSupport` and `requestConstruct` and prints, when the process exits, the table of `spend-table.ts` over the
// winning plans' first-seed runs (the ones `BANKING_OVER_30_MAX` counts). Without `PT_NOSPEND` it refuses nothing and prints the same
// table, so the two runs are directly comparable. The harness's own plan code runs unchanged: a refused spend is the only difference,
// and a plan that goes on to win has shown that the purse did not bind it. The sweeps fork with `process.execArgv` and so refuse too,
// but print nothing (a child has an IPC channel). The install guard is a `globalThis` symbol, per PROCESS: an environment variable
// would be inherited by every forked child (plan-sweep.ts spreads `process.env`), and the child would then skip the refusal.
//
//   cd tools
//   PT_NOSPEND=1 pnpm exec tsx --import ./src/backtest/spend-probe.ts src/backtest/playtest.ts
//
// The playtest prints each FAILED its plans raise when they expect a spend (the plan noticing it could not spend), and ends non-zero
// for the same reason; that is expected noise. This file adds its own failures (the refusal refused nothing, a SPEND_BOUND mission won)
// as `spend probe: FAILED` lines.
import { MissionRuntime } from '@lions/sim';
import { runLog } from './playtest-run';
import { installRefusal, spendProbeFailures, spendReport, spendRows, type SpendRun } from './spend-table';

const INSTALLED = Symbol.for('lions.spendProbe.installed');
const realm = globalThis as unknown as Record<symbol, unknown>;
if (realm[INSTALLED] !== true) {
  realm[INSTALLED] = true;
  const refusalOn = process.env.PT_NOSPEND === '1';
  /** runLog index -> refusals during that run (`start()` is called once per `run()`, which pushes its record). */
  const refusals: number[] = [];
  const starts = new WeakMap<object, number>();
  const origStart = MissionRuntime.prototype.start;
  MissionRuntime.prototype.start = function (this: MissionRuntime): void {
    starts.set(this, runLog.length);
    origStart.call(this);
  };
  if (refusalOn) {
    installRefusal(MissionRuntime.prototype, (rt) => {
      const i = starts.get(rt);
      if (i !== undefined) refusals[i] = (refusals[i] ?? 0) + 1;
    });
  }
  if (typeof process.send !== 'function') {
    process.on('exit', () => {
      const runs: SpendRun[] = [];
      runLog.forEach((r, i) => {
        if (r.banking === undefined || r.expect !== 'victory' || r.label !== r.id) return;
        runs.push({ id: r.id, result: r.result, minutes: r.minutes, stars: r.stars, roe: r.roe, banking: r.banking, refused: refusals[i] ?? 0 });
      });
      const rows = spendRows(runs);
      for (const line of spendReport(rows, refusalOn)) console.log(line);
      for (const f of spendProbeFailures(rows, refusalOn)) {
        console.error(`spend probe: FAILED — ${f}`);
        process.exitCode = 1;
      }
    });
  }
}
