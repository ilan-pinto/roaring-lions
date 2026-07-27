// Backtest harness plumbing: build headless engagements from the real
// data/units roster, batch-run them across seeds, and measure outcomes.
// This is where the combat model is held against GDD §5.7.

import { Sim, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { units } from '@lions/data';

export { units };

/** MBT with the Trophy removed — the "unprotected armour" target. */
export const MBT_BARE: UnitTypeJson = {
  ...units.mbt_lavi,
  id: 'mbt_bare',
  hull: { ...units.mbt_lavi.hull, aps: undefined },
  weapons: [],
};

export interface BattleResult {
  ticks: number;
  alive: [number, number];
  events: SimEvent[];
}

export function countAlive(sim: Sim): [number, number] {
  const alive: [number, number] = [0, 0];
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] === 1) alive[sim.state.side[i]]++;
  }
  return alive;
}

/** Run until one side is wiped out or maxTicks pass. */
export function runBattle(sim: Sim, maxTicks: number, collectEvents = false): BattleResult {
  const events: SimEvent[] = [];
  let t = 0;
  for (; t < maxTicks; t++) {
    const evs = sim.tick();
    if (collectEvents) events.push(...evs);
    if ((t & 31) === 0) {
      const alive = countAlive(sim);
      if (alive[0] === 0 || alive[1] === 0) break;
    }
  }
  return { ticks: t, alive: countAlive(sim), events };
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface TargetResult {
  name: string;
  detail: string;
  measured: string;
  target: string;
  pass: boolean;
}

export function report(results: TargetResult[]): boolean {
  const w = Math.max(...results.map((r) => r.name.length)) + 2;
  console.log('');
  console.log('GDD §5.7 validation targets');
  console.log('─'.repeat(78));
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(`${status}  ${r.name.padEnd(w)} measured ${r.measured}  (target ${r.target})`);
    console.log(`      ${' '.repeat(w)}${r.detail}`);
  }
  console.log('─'.repeat(78));
  const ok = results.every((r) => r.pass);
  console.log(ok ? 'backtest: all targets met' : 'backtest: TARGETS MISSED — the model is wrong (GDD §5.7)');
  return ok;
}
