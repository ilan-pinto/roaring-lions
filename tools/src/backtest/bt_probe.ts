// Bir Tarsha authoring probe: runs ONE mission with its scripted plan from plans/bir_tarsha.ts through `run()`, the instrument `pnpm playtest` uses, and prints
// the harness's own lines (result, minutes, ROE, stars, objectives, credits).
//   cd tools && pnpm exec tsx src/backtest/bt_probe.ts <mission id> [seed=424242] [victory|defeat] [stars]   one seed, every harness line
//   cd tools && pnpm exec tsx src/backtest/bt_probe.ts <mission id> sweep [victory|defeat] [stars]            the 30 sweep seeds, one line each and a summary
//   BT_DBG=1 makes a plan print its own trace lines (the plans read it).
import { run, runLog, setSweep } from './playtest-run';
import { SWEEP_SEEDS } from './passive-sweep';
import { BIR_TARSHA_PLANS } from './plans/bir_tarsha';

const id = process.argv[2] as keyof typeof BIR_TARSHA_PLANS;
if (BIR_TARSHA_PLANS[id] === undefined) {
  console.error(`usage: bt_probe.ts <${Object.keys(BIR_TARSHA_PLANS).join('|')}> [seed|sweep] [victory|defeat] [stars]`);
  process.exit(2);
}
const sweep = process.argv[3] === 'sweep';
const expect = (process.argv[sweep ? 4 : 4] ?? 'victory') as 'victory' | 'defeat';
const stars = Number(process.argv[5] ?? (expect === 'victory' ? 2 : 0)) as 0 | 1 | 2 | 3;
if (!sweep) {
  const seedArg = process.argv[3];
  if (seedArg !== undefined && Number(seedArg) !== 424242) setSweep(Number(seedArg), false);
  run(id, BIR_TARSHA_PLANS[id], {}, expect, id, stars);
} else {
  let wins = 0;
  let slowest = 0;
  const lost: number[] = [];
  for (const seed of SWEEP_SEEDS) {
    setSweep(seed === 424242 ? undefined : seed, true);
    const before = runLog.length;
    run(id, BIR_TARSHA_PLANS[id], {}, expect, id, stars);
    const r = runLog[before];
    if (r === undefined) { lost.push(seed); continue; }
    const ok = r.result === expect && (expect !== 'victory' || r.stars >= stars);
    if (ok) wins++;
    else lost.push(seed);
    slowest = Math.max(slowest, r.minutes);
    console.log(`SWEEP seed ${seed}: ${r.result} ${r.minutes.toFixed(1)} min, ROE ${r.roe}, stars ${r.stars}${r.cause ? `, ${r.cause}` : ''}`);
  }
  console.log(`SWEEP ${id}: ${wins}/${SWEEP_SEEDS.length} as expected (${expect}), slowest ${slowest.toFixed(1)} min${lost.length ? `, off on seeds ${lost.join(',')}` : ''}`);
}
