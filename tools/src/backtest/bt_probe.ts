// Bir Tarsha authoring probe: runs ONE mission with its scripted plan from plans/bir_tarsha.ts through `run()`, the instrument `pnpm playtest` uses, and prints
// the harness's own lines (result, minutes, ROE, stars, objectives, credits).
//   cd tools && pnpm exec tsx src/backtest/bt_probe.ts <mission id> [seed=424242] [expect=victory|defeat] [stars]
//   BT_DBG=1 makes a plan print its own trace lines (the plans read it).
import { run, setSweep } from './playtest-run';
import { BIR_TARSHA_PLANS } from './plans/bir_tarsha';

const id = process.argv[2] as keyof typeof BIR_TARSHA_PLANS;
if (BIR_TARSHA_PLANS[id] === undefined) {
  console.error(`usage: bt_probe.ts <${Object.keys(BIR_TARSHA_PLANS).join('|')}> [seed] [victory|defeat] [stars]`);
  process.exit(2);
}
const seedArg = process.argv[3];
if (seedArg !== undefined && Number(seedArg) !== 424242) setSweep(Number(seedArg), false);
const expect = (process.argv[4] ?? 'victory') as 'victory' | 'defeat';
run(id, BIR_TARSHA_PLANS[id], {}, expect, id, Number(process.argv[5] ?? (expect === 'victory' ? 2 : 0)) as 0 | 1 | 2 | 3);
