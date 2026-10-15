// F2 Task 10 (GH-183): REPORT-ONLY, NO GATE. Not wired into CI, `pnpm test` or `pnpm playtest`.
//
// What the held-ground income step costs per tick, measured headlessly (node, no browser, no GPU).
// `MissionRuntime.stepIncome` does two kinds of work:
//   - every tick: `zoneStates`, ONE pass over the living units through a per-tile zone bitmask (F2
//     Task 11; until then `zoneState` per zone, O(zones x living units)) -- a presence test;
//   - on a recheck (every CORRIDOR_RECHECK_TICKS = 20 ticks, on a `structureDestroyed`, and on any
//     tick a zone's HOLDER changes): a route per held zone and for the convoy -- since Task 11
//     REUSED unless the vehicle mask, foot mask or elevation changed (a byte compare) or the route's
//     ends did; only then a flow-field compute per goal tile, a road BFS, a field walk -- and
//     `corridorCut` over each route, at every recheck, which is O(living enemies x route tiles)
//     plus, for each enemy near the route, an O(units) contest scan.
//
// The world: the real `deir_amun_2` map (48 x 48, two tunnel routes, a road), the real
// `deir_amun_2_foothold` mission cloned IN MEMORY (never on disk: ruling C-R1) with its starting
// force and enemy emptied, four income zones (`pump_yard`, `hamlet`, `store_yard`, `the_wadi`) and a
// live convoy (`supply_corridor` + a `supply_entry` marker added in memory), and 300 living units:
// 140 + 140 unarmed ground (`dozer_d9`, `digger_crew`, so nobody dies and the count holds) and 10 + 10
// `recon_drone` (air, which zoneState skips). The harness places units and moves the flappers by
// writing the sim's position arrays between ticks, which a bench may do and the game never does.
//
// How it times: it wraps the PROTOTYPE methods `stepIncome` and `recheckCorridors` with a clock
// (TypeScript `private` is compile-time only, the way `sim-scaling.ts` reaches `stepDetection`), and
// times `sim.tick()` and `runtime.step()` around them. The `control` scenario has no zones and no
// convoy, so what it reads is the wrapper's own floor. State the machine load with every number.
//
//   cd tools
//   npx tsx src/perf/income-cost.ts                       # every scenario, 5 runs each
//   npx tsx src/perf/income-cost.ts --scenario=held4-clean --runs=3 --ticks=1000
//   npx tsx src/perf/income-cost.ts --json=/path/out.json
//
// Scenarios (zones in order pump_yard, hamlet, store_yard, the_wadi):
//   control          no income zones, no convoy: the wrapper's floor
//   mixed            side 0 holds one, hamlet contested, side 1 holds one, one empty
//   held4-clean      side 0 holds all four; no enemy within 3.5 tiles of any route (nothing is cut)
//   held4-scatter    side 0 holds all four; the 140 side-1 ground units scattered at random
//   held4-interdict  side 0 holds all four; side-1 units stacked within 1.5 tiles of the routes and
//                    side 0's spread kept 6.5+ tiles from them: every enemy near a route runs the
//                    contest scan. Each zone's 20 occupants stack on its tile farthest from the
//                    routes, and half the enemy stack stands 6.5+ tiles from them, so a line is
//                    really cut (F2 Task 11: with the roads in, the routes are short, and occupants
//                    spread over the zones contested every route tile on seeds 1001 and 1003)
//   flap-one         one zone alternates empty <-> held by side 0 every tick (a recheck every tick)
//   flap-swap        one zone alternates held by side 0 <-> held by side 1 every tick
//   flap-all         every zone alternates empty <-> held every tick, on top of held4-clean
// A flap scenario must recheck on every measured tick (a holder change each tick); a flapper that
// stopped moving would read as a cheap tick, so `assertNotVacuous` requires it (F2 Task 11).

import { writeFileSync } from 'node:fs';
import { FlowField, MissionRuntime, type MissionJson, type SimEvent, type MissionEvent } from '@lions/sim';
import { roadMaskOf } from '@lions/data';
import { missionStage } from '../mission-harness';

const MISSION = 'deir_amun_2_foothold';
const ZONES = ['pump_yard', 'hamlet', 'store_yard', 'the_wadi'] as const;
const ENTRY_MARKER = 'store_road';
const GROUND_PER_SIDE = 140;
const AIR_PER_SIDE = 10;

type ScenarioName =
  | 'control'
  | 'mixed'
  | 'held4-clean'
  | 'held4-scatter'
  | 'held4-interdict'
  | 'flap-one'
  | 'flap-swap'
  | 'flap-all';
const SCENARIOS: ScenarioName[] = [
  'control',
  'mixed',
  'held4-clean',
  'held4-scatter',
  'held4-interdict',
  'flap-one',
  'flap-swap',
  'flap-all',
];

// --- timing wrappers ------------------------------------------------------------------------

const probe = { incomeMs: 0, recheckMs: 0, rechecks: 0, fieldMs: 0, fields: 0 };
type Method3 = (this: unknown, a: unknown, b: unknown, c: unknown) => unknown;
const proto = MissionRuntime.prototype as unknown as Record<string, Method3>;
const origStepIncome = proto.stepIncome;
const origRecheck = proto.recheckCorridors;
const origCompute = FlowField.prototype.compute;
function installProbes(): void {
  // FlowField.compute is the Dijkstra over the whole map the runtime owns per goal tile; wrapped to
  // attribute a recheck's cost. The sim's own fields (stepMovement) are idle here: nobody is ordered.
  FlowField.prototype.compute = function (this: FlowField, ...args: Parameters<FlowField['compute']>): void {
    const t0 = performance.now();
    origCompute.apply(this, args);
    probe.fieldMs += performance.now() - t0;
    probe.fields++;
  };
  proto.stepIncome = function (this: unknown, a: unknown, b: unknown, c: unknown): unknown {
    const t0 = performance.now();
    const r = origStepIncome.call(this, a, b, c);
    probe.incomeMs = performance.now() - t0;
    return r;
  };
  proto.recheckCorridors = function (this: unknown, a: unknown, b: unknown, c: unknown): unknown {
    const t0 = performance.now();
    const r = origRecheck.call(this, a, b, c);
    probe.recheckMs = performance.now() - t0;
    probe.rechecks++;
    return r;
  };
}

// --- a tiny local PRNG (bench placement only; nothing here is sim state) ---------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- a cheap bench is only a finding if it did the work ------------------------------------------

/** Throws unless the run ended in the state the scenario exists to cost. Without it a bench whose
 *  zones never filled (a mis-placed occupant, a route that came back null) reads as a very cheap
 *  step. `states`/`holders` are in ZONES order; `routes` says which zones must hold a real route. */
function assertNotVacuous(
  scenario: ScenarioName,
  zones: readonly { state: number; holder: number; route: Int32Array | null; cut: string | null }[],
  convoy: { route: Int32Array | null } | null,
  rechecks: number,
  ticks: number,
): void {
  const fail = (why: string): never => {
    throw new Error(`income-cost ${scenario}: the bench did not build the state it measures (${why})`);
  };
  if (scenario === 'control') {
    if (zones.length !== 0 || convoy !== null) fail('the control has zones or a convoy');
    return;
  }
  if (zones.length !== 4) fail(`${zones.length} zones, expected 4`);
  if (convoy === null || convoy.route === null || convoy.route.length < 2) fail('no live convoy route');
  const steady = (k: number, state: number, holder: number, routed: boolean): void => {
    const z = zones[k];
    if (z.state !== state || z.holder !== holder) fail(`${ZONES[k]} is state ${z.state}, holder ${z.holder}`);
    if (routed !== (z.route !== null && z.route.length > 1)) fail(`${ZONES[k]} route ${z.route?.length ?? 'null'}`);
  };
  if (scenario === 'mixed') {
    steady(0, 0, 0, true); // held by side 0, routed
    steady(1, -2, -1, false); // contested
    steady(2, 1, 1, false); // held by side 1, which has no rear
    steady(3, -1, -1, false); // empty
  } else if (scenario.startsWith('held4')) {
    for (let k = 0; k < 4; k++) steady(k, 0, 0, true);
    const cuts = zones.filter((z) => z.cut !== null).length;
    if (scenario === 'held4-interdict' ? cuts === 0 : cuts !== 0) fail(`${cuts} zones cut`);
  } else if (scenario === 'flap-one' || scenario === 'flap-swap') {
    for (let k = 0; k < 3; k++) steady(k, 0, 0, true);
  }
  // flap-all ends on whichever half of the flap it stopped on; the convoy check above is its floor.
  // Every flap scenario changes a holder on every measured tick, so every tick rechecks. A flapper
  // that never moved would recheck on the cadence alone (ticks / 20) and read as cheap.
  if (scenario.startsWith('flap') && rechecks < ticks) fail(`${rechecks} rechecks in ${ticks} ticks: the holder did not flap`);
}

// --- one run --------------------------------------------------------------------------------

interface RunStats {
  scenario: ScenarioName;
  ticks: number;
  rechecks: number;
  /** stepIncome, ms per tick, over every measured tick. */
  amortisedMs: number;
  /** stepIncome on ticks that did not recheck / that did. */
  plainMs: number;
  recheckMs: number;
  /** The recheck itself (recheckCorridors only), mean over the ticks that ran it. */
  recheckOnlyMs: number;
  /** Of that, FlowField.compute: mean ms and mean computes per recheck. */
  fieldMs: number;
  fieldsPerRecheck: number;
  worstMs: number;
  p99Ms: number;
  /** Medians are the load-robust reading: a preempted tick lands in the mean and the tail, not here. */
  plainMedianMs: number;
  recheckMedianMs: number;
  /** (plain median x plain ticks + recheck median x recheck ticks) / ticks. */
  medianAmortisedMs: number;
  simTickMs: number;
  runtimeStepMs: number;
  living: number;
  zones: { zone: string; state: number; holder: number; cut: string | null; routeLen: number }[];
  convoy: { cut: string | null; routeLen: number } | null;
}

interface Placer {
  tx: number;
  ty: number;
}

function runOnce(scenario: ScenarioName, ticks: number, warmup: number, seed: number): RunStats {
  const rand = lcg(seed);
  const stage = missionStage(MISSION, 424242, 512);
  const { sim, map } = stage;
  const w = map.width;
  const h = map.height;

  // The mission is edited as a plain record (the clone is ours; the parsed `missions` is not touched).
  const doc = structuredClone(stage.mission) as unknown as Record<string, unknown>;
  doc.starting_force = [];
  doc.triggers = [];
  // One objective that cannot end the run (the foothold's own need tags and tunnels).
  doc.objectives = [{ id: 'cost_bench', type: 'survive_until', primary: true, seconds: 100000, text: 'bench' }];
  doc.time_limit_s = 200000;
  // The foothold flags `hamlet` for ROE; a bench that parks a hundred dozers in it would lose on
  // the ROE floor (seed 1004 did, at tick 40) and stop stepping. ROE is not what is measured.
  doc.roe = { enabled: false };
  const enemy = doc.enemy as { garrison?: unknown[]; waves?: unknown[] } | undefined;
  if (enemy !== undefined) {
    enemy.garrison = [];
    enemy.waves = [];
  }
  const withZones = scenario !== 'control';
  const resources = { ...((doc.resources as Record<string, unknown> | undefined) ?? {}) };
  if (withZones) {
    resources.income_zones = ZONES.map((zone, i) => ({ zone, rate_per_min: [28, 20, 16, 12][i] }));
    resources.supply_corridor = true;
    resources.supply_entry = 'cost_entry';
  }
  doc.resources = resources;
  const mission = doc as unknown as MissionJson;
  const markers = { ...map.markers, cost_entry: map.markers[ENTRY_MARKER] };
  // The same roads the game hands its runtime (C-R4; tools/src/road_mask_sites.test.ts reads this line).
  const ctx = { ...stage.context({}), markers, roadMask: roadMaskOf(map) };
  const runtime = new MissionRuntime(sim, mission, ctx);
  runtime.start();

  // Unit types by id.
  const typeIdx = (id: string): number => {
    const t = sim.unitTypes.findIndex((u) => u.id === id);
    if (t < 0) throw new Error(`no unit type ${id}`);
    return t;
  };
  const dozer = typeIdx('dozer_d9');
  const digger = typeIdx('digger_crew');
  const drone = typeIdx('recon_drone');
  const spawnAt = (t: number, side: number, tx: number, ty: number): number => {
    const id = sim.spawn(t, side, (tx << 16) + 32768, (ty << 16) + 32768);
    return id;
  };
  const place = (id: number, tx: number, ty: number): void => {
    sim.state.posX[id] = (tx << 16) + 6554 + Math.floor(rand() * 52428);
    sim.state.posY[id] = (ty << 16) + 6554 + Math.floor(rand() * 52428);
  };

  const rects = ZONES.map((z) => map.zones[z]);
  const openTiles: Placer[] = [];
  const zoneTiles: Placer[][] = rects.map(() => []);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (sim.blocked[ty * w + tx] !== 0) continue;
      let zi = -1;
      for (let k = 0; k < rects.length; k++) {
        const r = rects[k];
        if (tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3]) {
          zoneTiles[k].push({ tx, ty });
          zi = k;
        }
      }
      if (zi < 0) openTiles.push({ tx, ty });
    }
  }
  const pick = (arr: Placer[]): Placer => arr[Math.floor(rand() * arr.length)];

  // Unit pools. Side 0 ground first, then side 1 ground, then the air.
  const side0: number[] = [];
  const side1: number[] = [];
  for (let i = 0; i < GROUND_PER_SIDE; i++) side0.push(spawnAt(dozer, 0, 24, 44));
  for (let i = 0; i < GROUND_PER_SIDE; i++) side1.push(spawnAt(digger, 1, 1, 1));
  for (let i = 0; i < AIR_PER_SIDE; i++) {
    const a = spawnAt(drone, 0, 24, 44);
    const b = spawnAt(drone, 1, 1, 1);
    // Air units sit inside the zones: zoneState must skip them.
    const z = pick(zoneTiles[i % 4]);
    place(a, z.tx, z.ty);
    place(b, z.tx, z.ty);
  }
  let s0 = 0;
  let s1 = 0;
  const take0 = (): number => side0[s0++];
  const take1 = (): number => side1[s1++];

  // Flappers and zone occupants, by scenario.
  type Occ = [number, number]; // side-0 count, side-1 count in zone k
  let occ: Occ[] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  if (scenario === 'mixed') occ = [[20, 0], [10, 10], [0, 20], [0, 0]];
  else if (scenario === 'held4-clean' || scenario === 'held4-scatter' || scenario === 'held4-interdict') occ = [[20, 0], [20, 0], [20, 0], [20, 0]];
  else if (scenario === 'flap-one') occ = [[20, 0], [20, 0], [20, 0], [0, 0]];
  else if (scenario === 'flap-swap') occ = [[20, 0], [20, 0], [20, 0], [0, 0]];
  else if (scenario === 'flap-all') occ = [[20, 0], [20, 0], [20, 0], [20, 0]];
  const flap: { a: number; b: number; zone: number }[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < occ[k][0]; i++) {
      const p = pick(zoneTiles[k]);
      place(take0(), p.tx, p.ty);
    }
    for (let i = 0; i < occ[k][1]; i++) {
      const p = pick(zoneTiles[k]);
      place(take1(), p.tx, p.ty);
    }
  }
  // flap-all: the steady occupants placed above are replaced by one flapper per zone, so each zone
  // goes empty <-> held. Taking from side 0's pool again from the start re-places the first 80
  // (they are spread like the rest, below).
  if (scenario === 'flap-all') s0 = 0;

  // The spread: every other ground unit, outside the zones. Step once first so the routes exist.
  const spreadSide0 = (n: number, avoid?: (tx: number, ty: number) => boolean): void => {
    for (let i = 0; i < n; i++) {
      let p = pick(openTiles);
      for (let tries = 0; tries < 200 && avoid !== undefined && avoid(p.tx, p.ty); tries++) p = pick(openTiles);
      place(take0(), p.tx, p.ty);
    }
  };
  if (scenario === 'flap-all') {
    // Four flappers (side 0) are the zones' only occupants. Take them first.
    for (let k = 0; k < 4; k++) {
      const id = take0();
      flap.push({ a: id, b: -1, zone: k });
    }
  } else if (scenario === 'flap-one') {
    const id = take0();
    flap.push({ a: id, b: -1, zone: 3 });
  } else if (scenario === 'flap-swap') {
    const a = take0();
    const b = take1();
    flap.push({ a, b, zone: 3 });
  }
  const remaining0 = GROUND_PER_SIDE - s0;
  // Side 0 spread now (it must stay clear of enemies in `interdict`; routes are not known yet, so
  // place it anywhere outside the zones and re-place it after the first step in that scenario).
  spreadSide0(remaining0);
  // Park side 1's spread and the flappers' second positions out of every zone.
  for (let i = s1; i < side1.length; i++) place(side1[i], 1, 1);

  const parked: Placer = { tx: 1, ty: 1 };
  const inside = (k: number): Placer => zoneTiles[k][Math.floor(zoneTiles[k].length / 2)];

  // First step: computes every route.
  const stepOnce = (): MissionEvent[] => {
    const ev: SimEvent[] = sim.tick();
    return runtime.step(ev);
  };
  for (const f of flap) {
    const p = inside(f.zone);
    place(f.a, p.tx, p.ty);
    if (f.b >= 0) place(f.b, parked.tx, parked.ty);
  }
  stepOnce();

  // Routes are known: place side 1's spread and, for `interdict`, move side 0 off the routes.
  const routeTiles = new Set<number>();
  const collect = (r: Int32Array | null): void => {
    if (r === null) return;
    for (let i = 0; i < r.length; i++) routeTiles.add(r[i]);
  };
  for (const z of runtime.incomeZones) collect(z.route);
  collect(runtime.convoyRoute?.route ?? null);
  const dist2ToRoute = (tx: number, ty: number): number => {
    let best = 1e9;
    for (const t of routeTiles) {
      const rx = t % w;
      const ry = (t - rx) / w;
      const d = (rx - tx) * (rx - tx) + (ry - ty) * (ry - ty);
      if (d < best) best = d;
    }
    return best;
  };
  const spreadIds = side1.slice(s1);
  if (scenario === 'held4-clean' || scenario === 'flap-one' || scenario === 'flap-swap' || scenario === 'flap-all') {
    for (const id of spreadIds) {
      let p = pick(openTiles);
      for (let t = 0; t < 400 && dist2ToRoute(p.tx, p.ty) < 3.5 * 3.5; t++) p = pick(openTiles);
      place(id, p.tx, p.ty);
    }
  } else if (scenario === 'held4-scatter' || scenario === 'mixed') {
    for (const id of spreadIds) {
      const p = pick(openTiles);
      place(id, p.tx, p.ty);
    }
  } else if (scenario === 'held4-interdict') {
    const near = openTiles.filter((p) => dist2ToRoute(p.tx, p.ty) <= 1.5 * 1.5);
    if (near.length === 0) throw new Error('interdict: no open non-zone tile within 1.5 tiles of a route');
    // The zone occupants (side 0's first 80, 20 a zone) stack on their zone's tile farthest from
    // every route tile: still inside, so nothing about the holders or routes changes, but out of
    // contest range (6 tiles) of as much of the line as the zone allows.
    for (let k = 0; k < 4; k++) {
      let best = zoneTiles[k][0];
      for (const q of zoneTiles[k]) if (dist2ToRoute(q.tx, q.ty) > dist2ToRoute(best.tx, best.ty)) best = q;
      for (let i = 20 * k; i < 20 * k + 20; i++) place(side0[i], best.tx, best.ty);
    }
    const occTiles: Placer[] = [];
    for (let i = 0; i < 80; i++) occTiles.push({ tx: sim.state.posX[side0[i]] >> 16, ty: sim.state.posY[side0[i]] >> 16 });
    const clearOfZones = near.filter((p) =>
      occTiles.every((q) => (q.tx - p.tx) * (q.tx - p.tx) + (q.ty - p.ty) * (q.ty - p.ty) >= 6.5 * 6.5),
    );
    if (clearOfZones.length === 0) throw new Error('interdict: no route tile 6.5+ tiles from every zone occupant');
    for (let i = 0; i < spreadIds.length; i++) {
      const p = pick((i & 1) === 0 ? clearOfZones : near);
      place(spreadIds[i], p.tx, p.ty);
    }
    // Side 0's spread (not its zone occupants) at least 6.5 tiles from every route tile.
    const far = openTiles.filter((p) => dist2ToRoute(p.tx, p.ty) >= 6.5 * 6.5);
    const zoneOcc0 = 80;
    for (let i = zoneOcc0; i < s0; i++) {
      const p = pick(far.length > 0 ? far : openTiles);
      place(side0[i], p.tx, p.ty);
    }
  } else {
    for (const id of spreadIds) place(id, 1, 1);
  }
  stepOnce();

  // Warm up (JIT), then measure.
  const tickBody = (t: number): void => {
    for (const f of flap) {
      if (scenario === 'flap-swap') {
        const pa = (t & 1) === 0 ? inside(f.zone) : parked;
        const pb = (t & 1) === 0 ? parked : inside(f.zone);
        place(f.a, pa.tx, pa.ty);
        place(f.b, pb.tx, pb.ty);
      } else {
        const p = (t & 1) === 0 ? inside(f.zone) : parked;
        place(f.a, p.tx, p.ty);
      }
    }
    stepOnce();
  };
  for (let t = 0; t < warmup; t++) tickBody(t);

  const income = new Float64Array(ticks);
  const wasRecheck = new Uint8Array(ticks);
  const recheckOnly = new Float64Array(ticks);
  probe.fieldMs = 0;
  probe.fields = 0;
  let simMs = 0;
  let stepMs = 0;
  const r0 = probe.rechecks;
  for (let t = 0; t < ticks; t++) {
    for (const f of flap) {
      if (scenario === 'flap-swap') {
        const pa = (t & 1) === 0 ? inside(f.zone) : parked;
        const pb = (t & 1) === 0 ? parked : inside(f.zone);
        place(f.a, pa.tx, pa.ty);
        place(f.b, pb.tx, pb.ty);
      } else {
        const p = (t & 1) === 0 ? inside(f.zone) : parked;
        place(f.a, p.tx, p.ty);
      }
    }
    const before = probe.rechecks;
    probe.incomeMs = 0;
    probe.recheckMs = 0;
    const t0 = performance.now();
    const ev = sim.tick();
    const t1 = performance.now();
    runtime.step(ev);
    const t2 = performance.now();
    simMs += t1 - t0;
    stepMs += t2 - t1;
    income[t] = probe.incomeMs;
    if (probe.rechecks !== before) {
      wasRecheck[t] = 1;
      recheckOnly[t] = probe.recheckMs;
    }
  }

  let sum = 0;
  let plainSum = 0;
  let plainN = 0;
  let reSum = 0;
  let reN = 0;
  let reOnlySum = 0;
  let worst = 0;
  for (let t = 0; t < ticks; t++) {
    sum += income[t];
    if (income[t] > worst) worst = income[t];
    if (wasRecheck[t] !== 0) {
      reSum += income[t];
      reOnlySum += recheckOnly[t];
      reN++;
    } else {
      plainSum += income[t];
      plainN++;
    }
  }
  const median = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const s2 = xs.slice().sort((a, b) => a - b);
    return s2[s2.length >> 1];
  };
  const plainXs: number[] = [];
  const recheckXs: number[] = [];
  for (let t = 0; t < ticks; t++) (wasRecheck[t] !== 0 ? recheckXs : plainXs).push(income[t]);
  const plainMedianMs = median(plainXs);
  const recheckMedianMs = median(recheckXs);
  const sorted = Array.from(income).sort((a, b) => a - b);
  const p99 = sorted[Math.min(ticks - 1, Math.floor(ticks * 0.99))];
  let living = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] !== 0) living++;
  if (runtime.result !== 'ongoing') {
    throw new Error(`the bench mission ended (${runtime.result}) at tick ${sim.tickCount}: its numbers would be of an ended runtime`);
  }
  const conv = runtime.convoyRoute;
  assertNotVacuous(scenario, runtime.incomeZones, conv, probe.rechecks - r0, ticks);
  return {
    scenario,
    ticks,
    rechecks: probe.rechecks - r0,
    amortisedMs: sum / ticks,
    plainMs: plainN > 0 ? plainSum / plainN : 0,
    recheckMs: reN > 0 ? reSum / reN : 0,
    recheckOnlyMs: reN > 0 ? reOnlySum / reN : 0,
    fieldMs: reN > 0 ? probe.fieldMs / reN : 0,
    fieldsPerRecheck: reN > 0 ? probe.fields / reN : 0,
    worstMs: worst,
    p99Ms: p99,
    plainMedianMs,
    recheckMedianMs,
    medianAmortisedMs: (plainMedianMs * plainXs.length + recheckMedianMs * recheckXs.length) / ticks,
    simTickMs: simMs / ticks,
    runtimeStepMs: stepMs / ticks,
    living,
    zones: runtime.incomeZones.map((z) => ({
      zone: z.zone,
      state: z.state,
      holder: z.holder,
      cut: z.cut,
      routeLen: z.route?.length ?? 0,
    })),
    convoy: conv === null ? null : { cut: conv.cut, routeLen: conv.route?.length ?? 0 },
  };
}

// --- CLI ------------------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

function fmt(ms: number): string {
  return (ms * 1000).toFixed(1).padStart(8);
}

function main(): void {
  installProbes();
  const runs = Number.parseInt(arg('runs') ?? '5', 10);
  const ticks = Number.parseInt(arg('ticks') ?? '2000', 10);
  const warmup = Number.parseInt(arg('warmup') ?? '200', 10);
  const only = arg('scenario');
  const json = arg('json');
  const list = only === undefined ? SCENARIOS : SCENARIOS.filter((s) => s === only);
  if (list.length === 0) throw new Error(`unknown scenario ${only}; have ${SCENARIOS.join(', ')}`);
  console.log(
    `income-cost: ${MISSION} on deir_amun_2 (48x48), ${GROUND_PER_SIDE * 2 + AIR_PER_SIDE * 2} units, ` +
      `${runs} runs x ${ticks} ticks (+${warmup} warmup), node ${process.version}, ${process.platform}/${process.arch}`,
  );
  console.log('all times in microseconds (us); budget = 50000 us a tick');
  const all: RunStats[] = [];
  for (const s of list) {
    const rs: RunStats[] = [];
    for (let r = 0; r < runs; r++) rs.push(runOnce(s, ticks, warmup, 1000 + r));
    all.push(...rs);
    const lo = (f: (x: RunStats) => number): number => Math.min(...rs.map(f));
    const hi = (f: (x: RunStats) => number): number => Math.max(...rs.map(f));
    const first = rs[0];
    console.log(`\n== ${s}  (living ${first.living}; rechecks/run ${rs.map((x) => x.rechecks).join(',')})`);
    console.log(
      `  amortised stepIncome   ${fmt(lo((x) => x.amortisedMs))} .. ${fmt(hi((x) => x.amortisedMs))}   ` +
        `= ${((hi((x) => x.amortisedMs) / 50) * 100).toFixed(4)}% of 50 ms at the high end`,
    );
    console.log(`  amortised, MEDIAN-based ${fmt(lo((x) => x.medianAmortisedMs))} .. ${fmt(hi((x) => x.medianAmortisedMs))}   (load-robust)`);
    console.log(`  per-run amortised (mean) ${rs.map((x) => (x.amortisedMs * 1000).toFixed(1)).join(', ')}`);
    console.log(`  non-recheck tick       ${fmt(lo((x) => x.plainMs))} .. ${fmt(hi((x) => x.plainMs))}   median ${fmt(lo((x) => x.plainMedianMs))} .. ${fmt(hi((x) => x.plainMedianMs))}`);
    console.log(`  recheck tick (income)  ${fmt(lo((x) => x.recheckMs))} .. ${fmt(hi((x) => x.recheckMs))}   median ${fmt(lo((x) => x.recheckMedianMs))} .. ${fmt(hi((x) => x.recheckMedianMs))}`);
    console.log(`  recheckCorridors only  ${fmt(lo((x) => x.recheckOnlyMs))} .. ${fmt(hi((x) => x.recheckOnlyMs))}`);
    console.log(`  of which FlowField.compute ${fmt(lo((x) => x.fieldMs))} .. ${fmt(hi((x) => x.fieldMs))}   (${first.fieldsPerRecheck.toFixed(1)} computes a recheck)`);
    console.log(`  p99 tick               ${fmt(lo((x) => x.p99Ms))} .. ${fmt(hi((x) => x.p99Ms))}`);
    console.log(`  worst tick             ${fmt(lo((x) => x.worstMs))} .. ${fmt(hi((x) => x.worstMs))}`);
    console.log(`  (context) sim.tick     ${fmt(lo((x) => x.simTickMs))} .. ${fmt(hi((x) => x.simTickMs))}`);
    console.log(`  (context) runtime.step ${fmt(lo((x) => x.runtimeStepMs))} .. ${fmt(hi((x) => x.runtimeStepMs))}`);
    console.log(
      '  end state: ' +
        first.zones.map((z) => `${z.zone} st=${z.state} h=${z.holder} cut=${z.cut} route=${z.routeLen}`).join(' | ') +
        (first.convoy === null ? '' : ` | convoy cut=${first.convoy.cut} route=${first.convoy.routeLen}`),
    );
  }
  if (json !== undefined) writeFileSync(json, JSON.stringify(all, null, 1));
}

main();
