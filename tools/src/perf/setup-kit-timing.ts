// What do 36 kit placements cost in ONE tick on wadi_tarfan_l with 30 live flow fields? (GH-976 WP3, Step 5: printed, not gated.)
//
//   pnpm --filter @lions/tools exec tsx src/perf/setup-kit-timing.ts [--runs=7]
//
// Both sides' whole kit (12 hesco + 4 sandbag posts + 2 t-walls = 18 each) goes in on tick 1 of a set-up, after a tick 0 that
// issued 30 exact move orders to 30 distinct goals, so the pool holds 30 followed fields. Each accepted `fortify` is one
// `addStructure`, an exact incremental repair of every cached field (GH-913 L2). The tool asserts that all 36 were accepted and
// that the pool holds 30, so a harness that measured nothing cannot print a number. It prints the tick WITH the 36 placements
// and the tick before it without (the same 30 units walking), and the difference is the cost of the kit. Timing lives here, in
// tools/, never in the sim.
import { Sim, fx } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as catalogue, units, versusRules, setupRegionOf, SETUP_KIT_PIECES } from '@lions/data';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}
const RUNS = Number(arg('runs', '7'));
const MAP = 'wadi_tarfan_l';
const LIVE = 30;
const BAND = 12;

const parsed = parseMap(maps[MAP]);
const rules = versusRules[MAP];
const a: [number, number] = [rules.ends.friendly.camp.at[0], rules.ends.friendly.camp.at[1]];
const b: [number, number] = [rules.ends.hostile.camp.at[0], rules.ends.hostile.camp.at[1]];
const region = setupRegionOf(parsed.width, parsed.height, a, b, BAND);
const rifle = Object.values(units).find((u) => u.role === 'infantry');
if (rifle === undefined) throw new Error('no infantry type');

const median = (xs: number[]): number => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];

const once = (): { withKit: number; without: number; cpuWith: number; fields: number; placed: number } => {
  const sim = new Sim({ seed: 976, width: parsed.width, height: parsed.height, capacity: 128 });
  sim.beginSetup({ untilTick: 3600, region });
  const idx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(catalogue)) idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  applyTerrain(parsed, sim);
  for (const s of parsed.structures) {
    const ti = idx.get(s.type);
    if (ti === undefined) throw new Error(`unknown structure type ${s.type}`);
    sim.addStructure(ti, s.tiles);
  }
  const kitTypes = SETUP_KIT_PIECES.map((p) => idx.get(p) ?? -1);
  sim.setSetupKit(kitTypes.map((structType, i) => ({ structType, allowance: [12, 4, 2][i] })), []);
  const rifleIdx = sim.addUnitType(rifle);
  // 30 followed fields: units on side 0's seat, each sent `exact` to its own open tile in its own region.
  const open: number[] = [];
  for (let t = 0; t < parsed.width * parsed.height; t++) if (region[t] === 0 && !(sim as unknown as { blocked: Uint8Array }).blocked[t]) open.push(t);
  const stride = Math.floor(open.length / LIVE);
  for (let i = 0; i < LIVE; i++) {
    const id = sim.spawn(rifleIdx, 0, fx.from(a[0]) + fx.from(0.5), fx.from(a[1]) + fx.from(0.5));
    const g = open[i * stride];
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(g % parsed.width) + fx.from(0.5), y: fx.from(Math.floor(g / parsed.width)) + fx.from(0.5), exact: true });
  }
  sim.tick(); // tick 0
  // 18 valid, well-spaced spots per side (3 apart, scanning outward from the seat), judged by the sim's own pure `fortifyReason`.
  const plan: { side: 0 | 1; kit: number; x: number; y: number }[] = [];
  for (const side of [0, 1] as const) {
    const seat = side === 0 ? a : b;
    const spots: [number, number][] = [];
    for (let y = 0; y < parsed.height; y++) for (let x = 0; x < parsed.width; x++) if (x % 3 === 0 && y % 3 === 0) spots.push([x, y]);
    spots.sort((p, q) => (p[0] - seat[0]) ** 2 + (p[1] - seat[1]) ** 2 - ((q[0] - seat[0]) ** 2 + (q[1] - seat[1]) ** 2) || p[1] - q[1] || p[0] - q[0]);
    const slots = [...Array(12).fill(0), ...Array(4).fill(1), ...Array(2).fill(2)] as number[];
    let k = 0;
    for (const [x, y] of spots) {
      if (k >= slots.length) break;
      if (Math.abs(x - seat[0]) + Math.abs(y - seat[1]) < 6) continue; // not on the camp
      if (sim.fortifyReason(side, slots[k], x, y) === null) plan.push({ side, kit: slots[k++], x, y });
    }
    if (k !== slots.length) throw new Error(`side ${side}: only ${k} of 18 spots found`);
  }
  const t0 = process.hrtime.bigint();
  sim.tick(); // tick 1: the same 30 units walking, no kit
  const t1 = process.hrtime.bigint();
  for (const p of plan) sim.queueCommand({ kind: 'fortify', ...p });
  const c0 = process.cpuUsage();
  const t2 = process.hrtime.bigint();
  const events = sim.tick(); // tick 2: the 36 placements
  const t3 = process.hrtime.bigint();
  const c1 = process.cpuUsage();
  const placed = events.filter((e) => e.kind === 'fortified').length;
  if (placed !== 36) throw new Error(`${placed} of 36 placements accepted: ${events.filter((e) => e.kind === 'fortifyRefused').map((e) => (e.kind === 'fortifyRefused' ? e.reason : '')).join(',')}`);
  if (sim.flowFieldCount < LIVE) throw new Error(`pool holds ${sim.flowFieldCount} fields, expected at least ${LIVE}`);
  return { withKit: Number(t3 - t2) / 1e6, without: Number(t1 - t0) / 1e6, cpuWith: (c1.user + c1.system - c0.user - c0.system) / 1e3, fields: sim.flowFieldCount, placed };
};

once(); // warm-up (JIT)
const runs = Array.from({ length: RUNS }, once);
const w = runs.map((r) => r.withKit);
const wo = runs.map((r) => r.without);
console.log(`${MAP} ${parsed.width}x${parsed.height}, ${runs[0].fields} cached fields, ${runs[0].placed} placements in one tick, ${RUNS} runs after a warm-up`);
console.log(`tick with 36 placements: median ${median(w).toFixed(2)} ms, max ${Math.max(...w).toFixed(2)} ms (cpu median ${median(runs.map((r) => r.cpuWith)).toFixed(2)} ms)`);
console.log(`the tick before, same units, no kit: median ${median(wo).toFixed(2)} ms`);
console.log(`cost of the kit: median ${(median(w) - median(wo)).toFixed(2)} ms (the plan's expectation: each placement is an exact incremental repair, GH-913 L2)`);
