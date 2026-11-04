// What does a wall FALLING cost the tick? (GH-974, design section 4 risk: "every wall tile destroyed calls
// `recomputeFields('opened')`".) The tick probe for a map with many per-tile structures.
//
//   pnpm exec tsx src/perf/wall-fall.ts [--map=rujm_sawda] [--live=128] [--rounds=3]
//
// The room's own world (`world`, `standMapStructures`: every wall tile is a structure of its own), its real
// forces spawned, then the flow-field pool filled the honest way (as `recompute-fields.ts` does): `--live`
// extra riflemen, each ordered `exact` to its own goal tile spread over the map, one tick, and the tool
// asserts the pool holds that many fields. Then EVERY structure on the map is levelled through
// `debugDestroyStructure` -- the `destroyStructure` path a shell takes, `beginFlips`, `noteFlip` and
// `recomputeFields('opened')` -- one at a time, each timed on the wall clock and the CPU clock. The pool of 128 is the worst case
// (MAX_FLOW_FIELDS: every field followed); a real match follows far fewer. The plan's threshold (#277) is
// a median over 10 ms; the tick is 50 ms. A tool that destroys nothing, or measures an empty pool, cannot print
// a number: both are asserted. Timing lives here, in tools/, never in the sim. Several rounds on fresh worlds.
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fx } from '@lions/sim';
import type { MapId } from '@lions/data';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';
import { standMapStructures } from '../../../packages/app/src/map-sim';
import { humanHeldOf, layoutOf, world, type Arrangement } from '../backtest/versus-probe';

export interface WallFall {
  map: string;
  structures: number;
  walls: number;
  followed: number;
  fields: number;
  wallMs: number[];
  cpuMs: number[];
  /** Tiles that were blocked before and are open after, summed over every structure. */
  opened: number;
}

export const pct = (a: readonly number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};

export function wallFall(mapId: MapId, live: number, seed = 1): WallFall {
  const arr: Arrangement = ['kdf', 'kdf'];
  const { sim, typeOf, map } = world(mapId, seed, humanHeldOf('room', mapId, arr, seed));
  const { factions, ends } = layoutOf(arr);
  versusSpawns(sim, typeOf, versusAnchors(map), factions, ends);
  const rifle = typeOf.get('inf_squad');
  if (rifle === undefined) throw new Error('no inf_squad in the room roster');
  const open: number[] = [];
  for (let t = 0; t < map.width * map.height; t++) if (sim.blocked[t] === 0) open.push(t);
  const step = Math.floor(open.length / Math.max(1, live));
  const home = open[0];
  for (let i = 0; i < live; i++) {
    const g = open[i * step];
    const id = sim.spawn(rifle, 0, fx.from(home % map.width) + fx.from(0.5), fx.from(Math.floor(home / map.width)) + fx.from(0.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(g % map.width) + fx.from(0.5), y: fx.from(Math.floor(g / map.width)) + fx.from(0.5), exact: true });
  }
  sim.tick();
  if (sim.flowFieldCount < live) throw new Error(`the pool holds ${sim.flowFieldCount} fields, expected at least ${live}`);
  const n = sim.structureCount;
  if (n === 0) throw new Error(`${mapId} stands no structures`);
  const wallMs: number[] = [];
  const cpuMs: number[] = [];
  let opened = 0;
  let walls = 0;
  for (let s = 0; s < n; s++) {
    if (sim.structures.alive[s] !== 1) continue;
    const st = sim.structures;
    const tiles: number[] = [];
    for (let y = st.minY[s]; y <= st.maxY[s]; y++) for (let x = st.minX[s]; x <= st.maxX[s]; x++) if (sim.structureAt(x, y) === s) tiles.push(y * map.width + x);
    if (tiles.length === 1) walls++;
    const was = tiles.filter((t) => sim.blocked[t] !== 0).length;
    const c0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    sim.debugDestroyStructure(s);
    const t1 = process.hrtime.bigint();
    const c1 = process.cpuUsage(c0);
    wallMs.push(Number(t1 - t0) / 1e6);
    cpuMs.push((c1.user + c1.system) / 1e3);
    const now = tiles.filter((t) => sim.blocked[t] !== 0).length;
    opened += was - now;
  }
  if (wallMs.length !== n || opened === 0) throw new Error(`levelled ${wallMs.length} of ${n} structures and opened ${opened} tiles`);
  return { map: mapId, structures: n, walls, followed: live, fields: sim.flowFieldCount, wallMs, cpuMs, opened };
}

function flag(args: readonly string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const mapId = (flag(args, 'map') ?? 'rujm_sawda') as MapId;
  const live = Number(flag(args, 'live') ?? 128);
  const rounds = Number(flag(args, 'rounds') ?? 3);
  const ms: number[] = [];
  const cpu: number[] = [];
  let last: WallFall | null = null;
  for (let r = 0; r < rounds + 1; r++) {
    const w = wallFall(mapId, live, 1 + r);
    last = w;
    if (r === 0) continue; // the first world pays the JIT
    ms.push(...w.wallMs);
    cpu.push(...w.cpuMs);
  }
  const w = last as WallFall;
  const line = (name: string, a: number[]) => `${name}: median ${pct(a, 0.5).toFixed(3)} ms, p95 ${pct(a, 0.95).toFixed(3)} ms, p99 ${pct(a, 0.99).toFixed(3)} ms, max ${Math.max(...a).toFixed(3)} ms (n=${a.length})`;
  console.log(`map ${mapId}: ${w.structures} structures (${w.walls} single-tile walls), ${w.fields} flow fields cached, ${live} followed, ${w.opened} tiles opened per world, node ${process.version}`);
  console.log(line('destroy one structure, wall clock', ms));
  console.log(line('destroy one structure, cpu time  ', cpu));
  console.log(`load average ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
  console.log(pct(cpu, 0.5) > 10 ? 'median > 10 ms: the plan threshold (lazy invalidation) IS crossed' : 'median <= 10 ms: under the plan threshold');
  console.log(Math.max(...cpu) > 50 ? 'max > 50 ms: one wall can overrun a 20 Hz tick' : 'max <= 50 ms: no single wall overruns a tick');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
