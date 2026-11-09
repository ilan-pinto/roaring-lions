// GH-859 P1b, spec 8.6: what an F1 Column march costs per tick. REPORT-ONLY, NO GATE. Not in CI.
// Run: pnpm --filter @lions/tools perf:formations   (or: npx tsx src/perf/formation-march.ts [--runs=3] [--ticks=1200])
//
// 300 units in 15 groups of 20 start in a 5 x 3 lattice on the southern plain of `qarn_hadid` and each group is
// sent north of the ridge on one `move`, so all fifteen routes squeeze through the ridge's two gaps. Two arms play
// the same world tick for tick:
//   formed  every order carries `formation: 'column'`: a route walk and a slot template per checkpoint at order time,
//           pace and dress while marching, a release scan every checkpoint;
//   plain   the same orders with no `formation`.
// Nothing else is in the world (one side, no enemy), so the delta is the formation machinery and what it changes
// about the march (a paced column crowds the gaps differently from fifteen free flows), not combat.
//
// Reported per run: the median tick time of each arm and their delta; the worst checkpoint-activation tick (the
// slowest formed tick on which a `formationReleased` event fired) and its excess over the plain arm's median; the
// order tick (the first, where the fifteen routes are walked); `flowFieldCount` at its peak in each arm; the groups
// live at tick 1. The PROPOSED bars are <= 1 ms median delta and <= 5 ms worst activation excess; this file prints
// them against the numbers and fails nothing. The first run is preceded by an unreported warm-up of the same world.
//
// How it times: `performance.now()` around `sim.tick()` only (a tool, never the sim), in Node, no renderer. State the
// machine load with the numbers: the arms alternate their order run to run so that a drifting machine does not
// favour one.

import { fileURLToPath } from 'node:url';
import { Sim, fx, type Command, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { units, maps, structures as structureCatalogue, parseMap, applyTerrain, formations } from '@lions/data';

export const GROUPS = 15;
export const PER_GROUP = 20;
export const MAP_ID = 'qarn_hadid';
/** The proposed bars, ms. */
export const BAR_MEDIAN_MS = 1;
export const BAR_WORST_MS = 5;
/** One group of 20: a recon point, armour, light vehicles, rifles, support weapons, a medic and a drone. */
export const GROUP_UNITS: readonly string[] = [
  'scout_shachaf',
  'mbt_lavi', 'mbt_lavi',
  'ifv_namer', 'ifv_namer', 'apc_eitan', 'jeep_shoded', 'jeep_shoded',
  'inf_squad', 'inf_squad', 'inf_squad', 'inf_squad', 'inf_squad', 'inf_squad', 'inf_squad', 'inf_squad',
  'mortar_team', 'mortar_team', 'inf_medic_squad', 'recon_drone',
];

export interface March {
  sim: Sim;
  /** The ids of each group, in GROUP_UNITS order. */
  groups: number[][];
}

/** The world: the real map with its terrain and buildings, every shipped unit type, the formations; 300 units placed
 *  on free vehicle ground in fifteen blocks; one `move` per group, to its own goal north of the ridge. */
export function buildMarch(formed: boolean, seed = 424242): March {
  const map = parseMap(maps[MAP_ID as keyof typeof maps]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 400 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) structIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  const typeOf = new Map<string, number>();
  for (const [id, u] of Object.entries(units)) typeOf.set(id, sim.addUnitType(u as unknown as UnitTypeJson));
  for (const f of formations) sim.addFormationType(f);

  const mask = sim.blockedVehicle;
  const used = new Set<number>();
  const free = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1 || used.has(y * map.width + x)) return false;
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (mask[(y + oy) * map.width + x + ox] !== 0) return false;
    return true;
  };
  const groups: number[][] = [];
  for (let g = 0; g < GROUPS; g++) {
    const cx = 5 + (g % 5) * 9;
    const cy = 34 + Math.floor(g / 5) * 5;
    // Tiles nearest the block's centre first; one unit to a tile.
    const cand: [number, number][] = [];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) cand.push([cx + dx, cy + dy]);
    cand.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cy) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cy) ** 2) || a[1] - b[1] || a[0] - b[0]);
    const ids: number[] = [];
    for (const u of GROUP_UNITS) {
      const t = typeOf.get(u);
      if (t === undefined) throw new Error(`formation march: no shipped unit ${u}`);
      const c = cand.find(([x, y]) => free(x, y));
      if (c === undefined) throw new Error(`formation march: no free tile for group ${g}`);
      used.add(c[1] * map.width + c[0]);
      ids.push(sim.spawn(t, 0, fx.from(c[0] + 0.5), fx.from(c[1] + 0.5), 49152));
    }
    groups.push(ids);
  }
  for (let g = 0; g < GROUPS; g++) {
    const move: Command = { kind: 'move', ids: groups[g], x: fx.from(4 + g * 3 + 0.5), y: fx.from(14.5) };
    sim.queueCommand(formed ? { ...move, formation: 'column' } : move);
  }
  return { sim, groups };
}

/** Distinct formation groups the march's members stand in. */
export function liveGroups(m: March): number {
  const rows = new Set<number>();
  for (const ids of m.groups) for (const id of ids) {
    const g = m.sim.formationGroupOf(id);
    if (g >= 0) rows.add(g);
  }
  return rows.size;
}

export interface ArmRun {
  formed: boolean;
  ticks: number;
  /** Every tick's wall time, ms. */
  ms: number[];
  /** Ticks (0-based) on which a `formationReleased` event fired. */
  releaseTicks: number[];
  flowFieldPeak: number;
  groupsAtTick1: number;
  /** Members of those groups at tick 1, summed. */
  membersAtTick1: number;
  /** Units alive at the end, of 300. */
  alive: number;
}

export function runArm(formed: boolean, ticks: number): ArmRun {
  const m = buildMarch(formed);
  const ms = new Array<number>(ticks);
  const releaseTicks: number[] = [];
  let peak = 0;
  let groupsAtTick1 = 0;
  let membersAtTick1 = 0;
  for (let t = 0; t < ticks; t++) {
    const t0 = performance.now();
    const events: SimEvent[] = m.sim.tick();
    ms[t] = performance.now() - t0;
    if (t === 0) {
      groupsAtTick1 = liveGroups(m);
      const rows = new Set<number>();
      for (const ids of m.groups) for (const id of ids) {
        const g = m.sim.formationGroupOf(id);
        if (g >= 0 && !rows.has(g)) {
          rows.add(g);
          membersAtTick1 += m.sim.formationMembersOfGroup(g);
        }
      }
    }
    if (m.sim.flowFieldCount > peak) peak = m.sim.flowFieldCount;
    for (const e of events) if (e.kind === 'formationReleased') {
      releaseTicks.push(t);
      break;
    }
  }
  let alive = 0;
  for (const ids of m.groups) for (const id of ids) if (m.sim.state.alive[id] === 1) alive++;
  return { formed, ticks, ms, releaseTicks, flowFieldPeak: peak, groupsAtTick1, membersAtTick1, alive };
}

export const medianOf = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 === 1 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
};

export interface RunReading {
  medianFormed: number;
  medianPlain: number;
  /** formed - plain, ms. */
  delta: number;
  /** The slowest formed tick with a release on it (ms), and its excess over the plain median; null if none fired. */
  worstActivation: number | null;
  worstActivationExcess: number | null;
  worstActivationTick: number | null;
  /** The median formed tick time over the release ticks, minus the plain median: the typical activation, which a
   *  stray pause (GC, a busy machine) does not move the way it moves the worst one. */
  medianActivationExcess: number | null;
  orderTickFormed: number;
  orderTickPlain: number;
  releases: number;
  flowFieldPeakFormed: number;
  flowFieldPeakPlain: number;
  groupsAtTick1: number;
  plainGroupsAtTick1: number;
}

export function readRun(formed: ArmRun, plain: ArmRun): RunReading {
  const medianPlain = medianOf(plain.ms);
  let worst: number | null = null;
  let worstTick: number | null = null;
  for (const t of formed.releaseTicks) if (worst === null || formed.ms[t] > worst) {
    worst = formed.ms[t];
    worstTick = t;
  }
  return {
    medianFormed: medianOf(formed.ms),
    medianPlain,
    delta: medianOf(formed.ms) - medianPlain,
    worstActivation: worst,
    worstActivationExcess: worst === null ? null : worst - medianPlain,
    worstActivationTick: worstTick,
    medianActivationExcess: formed.releaseTicks.length === 0 ? null : medianOf(formed.releaseTicks.map((t) => formed.ms[t])) - medianPlain,
    orderTickFormed: formed.ms[0],
    orderTickPlain: plain.ms[0],
    releases: formed.releaseTicks.length,
    flowFieldPeakFormed: formed.flowFieldPeak,
    flowFieldPeakPlain: plain.flowFieldPeak,
    groupsAtTick1: formed.groupsAtTick1,
    plainGroupsAtTick1: plain.groupsAtTick1,
  };
}

const f = (x: number | null, d = 3): string => (x === null ? 'n/a' : x.toFixed(d));

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const flag = (name: string, fallback: number): number => {
    const a = args.find((x) => x.startsWith(`--${name}=`));
    const v = a === undefined ? fallback : Number(a.slice(name.length + 3));
    if (!Number.isInteger(v) || v < 1) throw new Error(`--${name} must be a whole number of at least 1`);
    return v;
  };
  const runs = flag('runs', 3);
  const ticks = flag('ticks', 1200);
  console.log(`formation march perf (GH-859 P1b spec 8.6; report-only): ${GROUPS * PER_GROUP} units in ${GROUPS} groups of ${PER_GROUP} on ${MAP_ID}, F1 Column vs plain move, ${ticks} ticks, ${runs} runs (after one warm-up)`);
  runArm(false, Math.min(ticks, 200));
  runArm(true, Math.min(ticks, 200));
  const rows: RunReading[] = [];
  for (let r = 0; r < runs; r++) {
    // Alternate which arm goes first so a drifting machine does not favour one.
    let plain: ArmRun;
    let formed: ArmRun;
    if (r % 2 === 0) {
      plain = runArm(false, ticks);
      formed = runArm(true, ticks);
    } else {
      formed = runArm(true, ticks);
      plain = runArm(false, ticks);
    }
    const row = readRun(formed, plain);
    rows.push(row);
    console.log(
      `run ${r + 1}: median ms formed ${f(row.medianFormed)} plain ${f(row.medianPlain)} delta ${f(row.delta)} | worst release tick ${row.worstActivationTick ?? 'n/a'}: ${f(row.worstActivation)} ms (excess ${f(row.worstActivationExcess)}; median release tick excess ${f(row.medianActivationExcess)}) over ${row.releases} release ticks | order tick ms formed ${f(row.orderTickFormed)} plain ${f(row.orderTickPlain)} | flowFieldCount peak formed ${row.flowFieldPeakFormed} plain ${row.flowFieldPeakPlain} | groups live at tick 1: formed ${row.groupsAtTick1} plain ${row.plainGroupsAtTick1} | alive formed ${formed.alive} plain ${plain.alive}`,
    );
  }
  const medDelta = medianOf(rows.map((x) => x.delta));
  const worstExcess = Math.max(...rows.map((x) => x.worstActivationExcess ?? 0));
  const peak = Math.max(...rows.map((x) => x.flowFieldPeakFormed));
  console.log(
    `summary over ${runs} runs: median delta ${f(medDelta)} ms (bar <= ${BAR_MEDIAN_MS}: ${medDelta <= BAR_MEDIAN_MS ? 'within' : 'OVER'}); worst checkpoint-activation excess ${f(worstExcess)} ms (bar <= ${BAR_WORST_MS}: ${worstExcess <= BAR_WORST_MS ? 'within' : 'OVER'}); flowFieldCount peak ${peak} (formed), ${Math.max(...rows.map((x) => x.flowFieldPeakPlain))} (plain)`,
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
