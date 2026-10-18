// What does one `recomputeFields` cost with the flow-field pool FULL? (#277 Task 3)
//
//   pnpm perf:recompute [-- --map=beit_sahwan_outskirts --runs=50 --live=128]
//
// Raising or removing a structure recomputes EVERY cached field (`addStructure`
// ends in `recomputeFields`). The pool is capped at MAX_FLOW_FIELDS (128), so
// the worst case is 128 full Dijkstra sweeps of a 48x48 map. Field Works stakes
// and cancels buildings mid-mission, so the number decides whether the
// recompute needs to go lazy (the plan's threshold: median over 10 ms).
//
// The pool is filled the honest way: 128 units, each ordered `exact` to its own
// goal tile, one tick. The tool asserts `flowFieldCount === 128` and that the
// map is the size it claims, so a harness that quietly measured an empty pool
// cannot print a number. Timing lives here, in tools/, never in the sim.
import { Sim, fx } from '@lions/sim';
import { units, maps, structures as structureCatalogue, parseMap, applyTerrain } from '@lions/data';

const MAX_FLOW_FIELDS = 128; // sim.ts; asserted below against flowFieldCount

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const mapId = arg('map', 'beit_sahwan_outskirts') as keyof typeof maps;
const runs = Number(arg('runs', '50'));
// How many of the 128 units keep following their field. The other fields stay
// CACHED but unreferenced, which is what lazy invalidation can skip.
const live = Number(arg('live', '128'));

const map = parseMap(maps[mapId]);
if (map.width !== 48 || map.height !== 48) throw new Error(`${mapId} is ${map.width}x${map.height}, expected 48x48`);
const sim = new Sim({ seed: 1, width: map.width, height: map.height, capacity: 256 });
applyTerrain(map, sim);

const structIdx = new Map<string, number>();
for (const [sid, spec] of Object.entries(structureCatalogue)) {
  structIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
}
for (const b of map.structures) {
  const ti = structIdx.get(b.type);
  if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
  sim.addStructure(ti, b.tiles);
}

const rifle = Object.values(units).find((u) => u.role === 'infantry');
if (rifle === undefined) throw new Error('no infantry unit type in @lions/data');
const rifleIdx = sim.addUnitType(rifle);

// 128 distinct open goal tiles, 1:1 with units, so every field is followed by a living unit.
const open: number[] = [];
for (let t = 0; t < map.width * map.height; t++) if (sim.blocked[t] === 0) open.push(t);
if (open.length < MAX_FLOW_FIELDS * 2) throw new Error('not enough open tiles');
const step = Math.floor(open.length / MAX_FLOW_FIELDS);
const home = open[0];
const ids: number[] = [];
for (let i = 0; i < MAX_FLOW_FIELDS; i++) {
  const g = open[i * step];
  const id = sim.spawn(rifleIdx, 0, fx.from(home % map.width) + fx.from(0.5), fx.from(Math.floor(home / map.width)) + fx.from(0.5));
  ids.push(id);
  sim.queueCommand({
    kind: 'move',
    ids: [id],
    x: fx.from(g % map.width) + fx.from(0.5),
    y: fx.from(Math.floor(g / map.width)) + fx.from(0.5),
    exact: true,
  });
}
sim.tick();
if (sim.flowFieldCount !== MAX_FLOW_FIELDS) throw new Error(`pool holds ${sim.flowFieldCount}, expected ${MAX_FLOW_FIELDS}`);
for (const id of ids.slice(live)) sim.debugKill(id);

// A 2x2 on open ground whose four tiles are all open (scan, top-left first).
let spot = -1;
for (let y = 1; y < map.height - 2 && spot < 0; y++) {
  for (let x = 1; x < map.width - 2; x++) {
    const t = y * map.width + x;
    if (sim.blocked[t] === 0 && sim.blocked[t + 1] === 0 && sim.blocked[t + map.width] === 0 && sim.blocked[t + map.width + 1] === 0) {
      spot = t;
      break;
    }
  }
}
if (spot < 0) throw new Error('no open 2x2');
const tiles = [spot, spot + 1, spot + map.width, spot + map.width + 1];
const typeIdx = structIdx.values().next().value;
if (typeIdx === undefined) throw new Error('no structure type');

const addMs: number[] = [];
const removeMs: number[] = [];
for (let r = 0; r < runs + 3; r++) {
  const t0 = process.hrtime.bigint();
  const s = sim.addStructure(typeIdx, tiles);
  const t1 = process.hrtime.bigint();
  sim.removeStructure(s);
  const t2 = process.hrtime.bigint();
  if (r >= 3) {
    // three warm-up runs dropped (JIT)
    addMs.push(Number(t1 - t0) / 1e6);
    removeMs.push(Number(t2 - t1) / 1e6);
  }
}

function pct(a: number[], p: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}
const line = (name: string, a: number[]) =>
  `${name}: median ${pct(a, 0.5).toFixed(3)} ms, p95 ${pct(a, 0.95).toFixed(3)} ms, max ${Math.max(...a).toFixed(3)} ms (n=${a.length})`;
console.log(`map ${mapId} ${map.width}x${map.height}, ${sim.flowFieldCount} fields cached, ${Math.min(live, MAX_FLOW_FIELDS)} followed, node ${process.version}`);
console.log(line('addStructure 2x2   ', addMs));
console.log(line('removeStructure 2x2', removeMs));
console.log(pct(addMs, 0.5) > 10 ? 'median > 10 ms: lazy invalidation IS needed' : 'median <= 10 ms: lazy invalidation not needed');
