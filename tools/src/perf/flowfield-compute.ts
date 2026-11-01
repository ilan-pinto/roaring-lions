// What does one `FlowField.compute` cost, before and after GH-913 L1?
//
//   pnpm --filter @lions/tools exec tsx src/perf/flowfield-compute.ts [--runs=7] [--goals=200]
//
// "Before" is the frozen copy of the binary-heap implementation (`flowfield_oracle.ts`), "after" is the
// live `FlowField`. Both run on the SAME terrains and goals, interleaved per terrain so a load spike
// hits both arms, and the table prints the per-terrain median over `--runs` repeats. The two must also
// agree byte for byte on every goal (the same check `flowfield_exact.test.ts` makes); a speed number
// from arms that disagree is refused. Timing lives here, in tools/, never in the sim.
import { FlowField } from '../../../packages/sim/src/flowfield';
import { OracleFlowField } from '../flowfield_oracle';
import { goalsOn, randomTerrain, shippedTerrains, stretched, type Terrain } from '../flowfield_terrain';
import { cpus, loadavg } from 'node:os';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}
const runs = Number(arg('runs', '7'));
const nGoals = Number(arg('goals', '200'));

const shipped = shippedTerrains();
const byId = (id: string): Terrain => {
  const t = shipped.find((s) => s.id === id);
  if (t === undefined) throw new Error(`no shipped map ${id}`);
  return t;
};
const rows: { label: string; t: Terrain; wheels: boolean }[] = [
  { label: 'wadi_tarfan 48x48 foot', t: byId('wadi_tarfan'), wheels: false },
  { label: 'beit_sahwan_outskirts 48x48', t: byId('beit_sahwan_outskirts'), wheels: false },
  { label: 'qarn_hadid 48x48 (relief)', t: byId('qarn_hadid'), wheels: false },
  { label: 'tel_marum 48x48 wheels', t: byId('tel_marum'), wheels: true },
  { label: 'wadi_tarfan @80x80 foot', t: stretched(byId('wadi_tarfan'), 80), wheels: false },
  { label: 'milh_flats @80x80 foot', t: stretched(byId('milh_flats'), 80), wheels: false },
  { label: 'qarn_hadid @80x80 (relief)', t: stretched(byId('qarn_hadid'), 80), wheels: false },
  { label: 'tel_marum @80x80 wheels', t: stretched(byId('tel_marum'), 80), wheels: true },
  { label: 'open 80x80', t: randomTerrain('open', 80, 80, 1, 0, 0, 0), wheels: false },
  { label: 'random 80x80 walls 12% relief 6', t: randomTerrain('rnd', 80, 80, 7, 12, 0, 6), wheels: false },
];

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

console.log(`node ${process.version}, ${cpus()[0].model}, ${cpus().length} cores, load average at start ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
console.log(`${nGoals} goals per terrain, median of ${runs} repeats, µs per compute (old = binary heap, new = live FlowField)`);
console.log('terrain'.padEnd(34) + 'old µs'.padStart(10) + 'new µs'.padStart(10) + 'speedup'.padStart(10));
let sumOld = 0;
let sumNew = 0;
for (const row of rows) {
  const mask = row.wheels ? row.t.wheels : row.t.foot;
  const goals = goalsOn(mask, nGoals);
  const { w, h, elevation } = row.t;
  const a = new OracleFlowField(w, h);
  const b = new FlowField(w, h);
  // agreement first
  for (const g of goals) {
    a.compute(mask, elevation, g % w, Math.floor(g / w));
    b.compute(mask, elevation, g % w, Math.floor(g / w));
    for (let t = 0; t < w * h; t++) {
      if (a.dirs[t] !== b.dirs[t] || a.costAt(t) !== b.costAt(t)) throw new Error(`${row.label}: goal ${g} tile ${t} disagrees; refusing to time`);
    }
  }
  const oldT: number[] = [];
  const newT: number[] = [];
  for (let r = 0; r < runs + 1; r++) {
    const t0 = process.hrtime.bigint();
    for (const g of goals) a.compute(mask, elevation, g % w, Math.floor(g / w));
    const t1 = process.hrtime.bigint();
    for (const g of goals) b.compute(mask, elevation, g % w, Math.floor(g / w));
    const t2 = process.hrtime.bigint();
    if (r > 0) {
      oldT.push(Number(t1 - t0) / 1e3 / goals.length);
      newT.push(Number(t2 - t1) / 1e3 / goals.length);
    }
  }
  const o = median(oldT);
  const n = median(newT);
  sumOld += o;
  sumNew += n;
  console.log(row.label.padEnd(34) + o.toFixed(1).padStart(10) + n.toFixed(1).padStart(10) + `${(o / n).toFixed(2)}x`.padStart(10));
}
console.log('mean of rows'.padEnd(34) + (sumOld / rows.length).toFixed(1).padStart(10) + (sumNew / rows.length).toFixed(1).padStart(10) + `${(sumOld / sumNew).toFixed(2)}x`.padStart(10));
console.log(`load average at end ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
