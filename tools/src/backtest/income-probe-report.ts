// F2 Task 2 (GH-183): REPORT-ONLY, NO GATE. Prints what `income-probe.ts` recorded.
//
//   npx tsx src/backtest/income-probe-report.ts <dir> [table]
//
// <dir> holds the `<table>.<pid>.jsonl` files one probed `playtest.ts` run wrote. Every number it
// prints is read off those lines; nothing is recomputed from the runtime. Banking is
// held / (logistics_start + earned) at the run's last tick, earned and held as the runtime counts
// them (`logisticsEarned(0)`, `logistics`), spent = start + earned - held.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { D7_MISSIONS } from './income-proposal';

interface Line {
  table: string;
  id: string;
  label: string;
  expect: string;
  result: string;
  stuck: boolean;
  minutes: number;
  stars: number;
  roe: number;
  credits: number;
  logisticsStart: number;
  ratePerMin: number;
  seed?: number;
  ticks: number;
  rows: { t: number; z: [number, string | null][]; convoy?: string | null; purse: number; base: number; zones: number }[];
  routes: Record<string, [number, number][]>;
  cuts: Record<string, Record<string, number>>;
  cutTicks: Record<string, Record<string, number>>;
  stateTicks: Record<string, Record<string, number>>;
  builds: [number, string, boolean][];
  earned: number;
  zoneEarned: number;
  held: number;
  enemyZoneEarned: number;
}

const dir = process.argv[2];
const only = process.argv[3];
if (dir === undefined) throw new Error('usage: income-probe-report.ts <dir> [table]');
const lines: Line[] = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl') && (only === undefined || n.startsWith(`${only}.`)))) {
  for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) if (l.trim() !== '') lines.push(JSON.parse(l) as Line);
}
const seedOf = (l: Line): number => l.seed ?? 424242;
const kind = (l: Line): 'plan' | 'passive' | 'other' =>
  l.label === l.id ? 'plan' : /\((no orders|passive control)(, seed \d+)?\)$/.test(l.label) ? 'passive' : 'other';
const pct = (a: number, b: number): string => (b === 0 ? '-' : `${((100 * a) / b).toFixed(0)}%`);
const banked = (l: Line): number => (100 * l.held) / (l.logisticsStart + l.earned);
const range = (xs: number[], d = 0): string =>
  xs.length === 0 ? '-' : `${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(d)} [${Math.min(...xs).toFixed(d)}-${Math.max(...xs).toFixed(d)}]`;
const ST: Record<string, string> = { '0': 'kdf', '1': 'sarim', '-1': 'empty', '-2': 'contested' };

for (const table of [...new Set(lines.map((l) => l.table))].sort()) {
  console.log(`\n=== table ${table} ===`);
  for (const id of D7_MISSIONS) {
    const mine = lines.filter((l) => l.table === table && l.id === id);
    if (mine.length === 0) continue;
    console.log(`\n## ${id}`);
    for (const k of ['plan', 'passive'] as const) {
      const ls = mine.filter((l) => kind(l) === k).sort((a, b) => seedOf(a) - seedOf(b));
      if (ls.length === 0) continue;
      const wins = ls.filter((l) => l.result === 'victory').length;
      const misses = ls.filter((l) => l.result !== l.expect).map((l) => `${seedOf(l)}:${l.stuck ? 'STUCK' : l.result}`);
      console.log(
        `${k}: ${ls.length} seeds, victory ${wins}/${ls.length}, misses [${misses.join(' ')}], minutes ${range(ls.map((l) => l.minutes), 2)}, ` +
          `stars ${range(ls.map((l) => l.stars), 2)}, ROE ${range(ls.map((l) => l.roe), 1)}, credits ${range(ls.map((l) => l.credits), 0)}`,
      );
      console.log(
        `  banking: earned ${range(ls.map((l) => l.earned))} (zones ${range(ls.map((l) => l.zoneEarned))}), ` +
          `spent ${range(ls.map((l) => l.logisticsStart + l.earned - l.held))}, held ${range(ls.map((l) => l.held))}, banked% ${range(ls.map(banked), 1)}; ` +
          `sarim zone income ${range(ls.map((l) => l.enemyZoneEarned))}`,
      );
      const builds = ls.map((l) => l.builds.filter((b) => b[2]).length);
      if (builds.some((b) => b > 0)) {
        const first = ls.map((l) => l.builds.filter((b) => b[2]).map((b) => b[0] / 20));
        console.log(`  builds accepted ${range(builds, 2)}; seed 424242 at s [${(first[ls.findIndex((l) => seedOf(l) === 424242)] ?? []).join(', ')}]`);
      }
      const zones = Object.keys(ls[0].stateTicks);
      for (const z of zones) {
        const tot = ls.reduce((a, l) => a + l.ticks, 0);
        const by = (s: string): number => ls.reduce((a, l) => a + (l.stateTicks[z]?.[s] ?? 0), 0);
        const neverKdf = ls.filter((l) => (l.stateTicks[z]?.['0'] ?? 0) === 0).length;
        const allEmpty = ls.filter((l) => (l.stateTicks[z]?.['-1'] ?? 0) + (l.stateTicks[z]?.['-2'] ?? 0) === l.ticks).length;
        const cutSeeds = ls.filter((l) => l.cutTicks[z] !== undefined);
        const cutTot: Record<string, number> = {};
        for (const l of cutSeeds) for (const [c, n] of Object.entries(l.cutTicks[z])) cutTot[c] = (cutTot[c] ?? 0) + n;
        console.log(
          `  zone ${z}: ` +
            ['0', '1', '-2', '-1'].map((s) => `${ST[s]} ${pct(by(s), tot)}`).join(', ') +
            `; never held by kdf on ${neverKdf}/${ls.length}; empty-or-contested all run on ${allEmpty}/${ls.length}; ` +
            `cut on ${cutSeeds.length}/${ls.length} seeds (${Object.entries(cutTot).map(([c, n]) => `${c} ${pct(n, by('0'))} of kdf-held ticks`).join(', ') || 'never'})`,
        );
      }
      const cv = ls.filter((l) => l.rows.some((r) => r.convoy !== undefined));
      if (cv.length > 0) {
        const cutSeeds = cv.filter((l) => l.cutTicks.convoy !== undefined);
        console.log(`  convoy: cut on ${cutSeeds.length}/${cv.length} seeds; route ${cv[0].routes.convoy?.length ?? 0} tiles`);
      }
    }
    const walk = mine.find((l) => kind(l) === 'plan' && seedOf(l) === 424242);
    if (walk) {
      const zones = Object.keys(walk.stateTicks);
      console.log(`\n  walk, plan, seed 424242 (every 30 s; zone = state/cut; purse; income a minute base+zones):`);
      console.log(`  ${'t'.padStart(5)}  ${zones.map((z) => z.padEnd(18)).join('')}${walk.rows[0]?.convoy !== undefined ? 'convoy'.padEnd(13) : ''}purse  base+zones`);
      for (const r of walk.rows) {
        const cells = r.z.map(([s, c]) => `${ST[String(s)]}${c ? '/' + c : ''}`.padEnd(18)).join('');
        const conv = r.convoy !== undefined ? String(r.convoy ?? 'open').padEnd(13) : '';
        console.log(`  ${(r.t / 20).toFixed(0).padStart(4)}s  ${cells}${conv}${String(r.purse).padStart(5)}  ${r.base}+${r.zones}`);
      }
      console.log(`  routes (first seen, seed 424242):`);
      for (const [k, v] of Object.entries(walk.routes)) console.log(`    ${k} (${v.length}): ${v.map(([x, y]) => `${x},${y}`).join(' ')}`);
    }
    const others = mine.filter((l) => kind(l) === 'other' && seedOf(l) === 424242);
    for (const l of others)
      console.log(`  other (424242) ${l.label}: ${l.result} ${l.minutes.toFixed(1)} min, stars ${l.stars}, ROE ${l.roe}, credits ${l.credits}, earned ${l.earned} (zones ${l.zoneEarned}), held ${l.held}, banked ${banked(l).toFixed(1)}%`);
  }
  const passive = lines.filter((l) => l.table === table && kind(l) === 'passive');
  const at424 = passive.filter((l) => seedOf(l) === 424242);
  console.log(
    `\nZONE_PASSIVE_INCOME (${table}): seed 424242 ${at424.reduce((a, l) => a + l.zoneEarned, 0)} over ${at424.length} controls; ` +
      `all seeds ${passive.reduce((a, l) => a + l.zoneEarned, 0)} over ${passive.length} runs (${at424.map((l) => `${l.id} ${l.zoneEarned}`).join(', ')})`,
  );
}
