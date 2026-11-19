// Bir Tarsha authoring probe: runs ONE mission with its scripted plan from plans/bir_tarsha.ts through `run()`, the instrument `pnpm playtest` uses, and prints
// the harness's own lines (result, minutes, ROE, stars, objectives, credits).
//   cd tools && pnpm exec tsx src/backtest/bt_probe.ts <mission id> [seed=424242] [victory|defeat] [stars]   one seed, every harness line
//   cd tools && pnpm exec tsx src/backtest/bt_probe.ts <mission id> sweep [victory|defeat] [stars]            the 30 sweep seeds, one line each and a summary
//   BT_DBG=1 makes a plan print its own trace lines (the plans read it).
import { run, runLog, setSweep, tapMissionEvents } from './playtest-run';
import { SWEEP_SEEDS } from './passive-sweep';
import { BIR_TARSHA_CHAIN, BIR_TARSHA_PLANS } from './plans/bir_tarsha';
import type { LedgerData } from '@lions/sim';

const id = process.argv[2] as keyof typeof BIR_TARSHA_PLANS;
if (BIR_TARSHA_PLANS[id] === undefined) {
  console.error(`usage: bt_probe.ts <${Object.keys(BIR_TARSHA_PLANS).join('|')}> [seed|sweep] [victory|defeat] [stars]`);
  process.exit(2);
}
if (process.env.BT_ROE)
  tapMissionEvents((evs, _rt, sim) => {
    for (const e of evs) {
      if (e.kind !== 'roe') continue;
      console.log(`ROE t=${(e.tick / 20).toFixed(0)}s -${e.penalty} ${e.reason} -> ${e.score}`);
      if (process.env.BT_ROE === '2') {
        const rows: string[] = [];
        for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.side[i] !== 2) rows.push(`${sim.state.side[i]}:${sim.unitTypes[sim.state.typeIdx[i]].id}#${i}@${Math.round(Number(sim.state.posX[i]) / 65536)},${Math.round(Number(sim.state.posY[i]) / 65536)}`);
        console.log(`   units ${rows.join(' ')}`);
      }
    }
  });
const sweep = process.argv[3] === 'sweep';
// The ledger the mission is played on: what the scripted plans of the missions before it in the chain produce on the same seed, as `pnpm playtest` does
// (an empty ledger locks the units a campaign has opened, which changes what a camp can buy).
const ledgerFor = (): LedgerData => {
  let led: LedgerData = {};
  for (const prior of BIR_TARSHA_CHAIN.slice(0, BIR_TARSHA_CHAIN.indexOf(id))) led = { ...led, ...run(prior, BIR_TARSHA_PLANS[prior], led, 'victory', prior) };
  return led;
};
const expect = (process.argv[sweep ? 4 : 4] ?? 'victory') as 'victory' | 'defeat';
const stars = Number(process.argv[5] ?? (expect === 'victory' ? 2 : 0)) as 0 | 1 | 2 | 3;
if (!sweep) {
  const seedArg = process.argv[3];
  if (seedArg !== undefined && Number(seedArg) !== 424242) setSweep(Number(seedArg), false);
  // BT_EVENTS=1 prints the sim's own rout, kill and Lavi-gun events (tick, entities, hit chance) so an author can see why a plan's force broke or a target survived.
  const onEvents = process.env.BT_EVENTS
    ? (evs: readonly { kind: string; tick?: number }[]): void => {
        for (const e of evs) {
          const x = e as unknown as Record<string, unknown>;
          if (e.kind === 'routed' || e.kind === 'destroyed' || e.kind === 'structureDestroyed') console.log(`EV t=${((e.tick ?? 0) / 20).toFixed(0)}s ${e.kind} ${JSON.stringify(x)}`);
          else if (e.kind === 'fire' && (x.shooter === 2 || x.shooter === 3 || x.shooter === 5) && (e.tick ?? 0) > 3600 && (e.tick ?? 0) < 4800) console.log(`EV t=${((e.tick ?? 0) / 20).toFixed(0)}s fire shooter ${x.shooter} ${x.weaponId} target ${x.target} pHit ${x.pHit} willHit ${x.willHit}`);
        }
      }
    : undefined;
  run(id, BIR_TARSHA_PLANS[id], ledgerFor(), expect, id, stars, undefined, undefined, undefined, undefined, undefined, undefined, onEvents);
} else {
  let wins = 0;
  let slowest = 0;
  const lost: number[] = [];
  const only = process.env.BT_SEEDS?.split(',').map(Number);
  for (const seed of SWEEP_SEEDS.filter((x) => only === undefined || only.includes(x))) {
    setSweep(seed === 424242 ? undefined : seed, true);
    const before = runLog.length;
    const led = ledgerFor();
    const mark = runLog.length;
    void before;
    run(id, BIR_TARSHA_PLANS[id], led, expect, id, stars);
    const r = runLog[runLog.length - 1];
    void mark;
    if (r === undefined) { lost.push(seed); continue; }
    const ok = r.result === expect && (expect !== 'victory' || r.stars >= stars);
    if (ok) wins++;
    else lost.push(seed);
    slowest = Math.max(slowest, r.minutes);
    console.log(`SWEEP seed ${seed}: ${r.result} ${r.minutes.toFixed(1)} min, ROE ${r.roe}, stars ${r.stars}${r.cause ? `, ${r.cause}` : ''}`);
  }
  console.log(`SWEEP ${id}: ${wins}/${SWEEP_SEEDS.length} as expected (${expect}), slowest ${slowest.toFixed(1)} min${lost.length ? `, off on seeds ${lost.join(',')}` : ''}`);
}
