// Civilian-drama E9 (docs/campaign/civilian-drama.md section 11): the SIM-tick cost of the Breach pilot crowd. Report-only; headless; no browser.
//
//   npx tsx tools/src/perf/crowd-tick-budget.ts [--seeds=30] [--plan=passive,optimal] [--gates=open,shut] [--out=<dir>]
//
// The world is `tools/src/backtest/fl_ladder.ts`'s, from the shipped `beit_sahwan_breach` edited to section 11.1.8's crowd: the four village groups
// (3+3+3+2 = 11), 89 road runners (45 west, 44 east) ordered to the two gate aprons at 2 s, the shipped garrison and the six shipped waves, run for
// the whole 300 s hold (6000 ticks). The mission's own objectives are patched so nothing ends the run early (the primary's count is unreachable): the
// numbers are the SIM, not the verdict. NOTHING of E1/E3/E6 exists on `dev`, so:
//   gates=open   the two gaps stay open (today's mission with the crowd added);
//   gates=shut   the two 1x2 gaps are walled for the whole run (a fence in each), the worst case for the crowd: it presses on a gate that never opens
//                (the design's V5: a pressed civilian keeps `moving 1`, its field unreachable).
//
// Two passes per run so the timer cannot lie about itself: pass A times only `sim.tick()` and `rt.step()` (two clock reads a tick); pass B wraps the
// systems (detection, combat, selectTarget, movement, flow-field compute and repair, the civilian flight/shepherd step, the mission step) and costs more
// by its own clock reads (selectTarget runs once per shooter per tick). The report prints both totals so the overhead is visible.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Sim, TICKS_PER_SECOND, MissionRuntime, type MissionJson, type TunnelRouteJson } from '@lions/sim';
import { units, structures as structureCatalogue, parseMap, applyTerrain, roadMaskOf } from '@lions/data';
import { maps, missions } from '@lions/data/content';
import { FlowField } from '../../../packages/sim/src/flowfield';
import { firstLightPlan } from '../backtest/plans/beit_sahwan';
import { START_LAYOUT } from '../mission-harness';

export type Plan = 'passive' | 'optimal';
export type Gates = 'open' | 'shut';
const ID = 'beit_sahwan_breach';
export const RUN_TICKS = 300 * TICKS_PER_SECOND;
export const BUDGET_MS = 50;

/** Section 11.1.8's crowd on the shipped mission: 11 village civilians, 89 on the road, two apron orders at 2 s; nothing ends the run early. */
export function pilotMission(gates: Gates, extra = 0): MissionJson {
  const m = JSON.parse(JSON.stringify(missions[ID])) as Record<string, unknown> & { civilians: { refuge: string; groups: unknown[] }; triggers: unknown[]; objectives: Record<string, unknown>[]; structures: unknown[] };
  const road = (n: number, at: [number, number], group: string) => ({ unit: 'civilians', count: n, at, group });
  m.civilians = {
    refuge: 'civ_refuge',
    groups: [
      { unit: 'civilians', count: 3, at: [10.5, 18.5], group: 'families_nw' },
      { unit: 'civilians', count: 3, at: [37.5, 18.5], group: 'families_ne' },
      { unit: 'civilians', count: 3, at: [9.5, 27.5], group: 'families_sw' },
      { unit: 'civilians', count: 2, at: [37.5, 27.5], group: 'families_se' },
      road(11, [2.5, 19.5], 'road_w'), road(11, [6.5, 19.5], 'road_w'), road(11, [2.5, 24.5], 'road_w'), road(12, [6.5, 24.5], 'road_w'),
      road(11, [44.5, 19.5], 'road_e'), road(11, [40.5, 19.5], 'road_e'), road(11, [44.5, 24.5], 'road_e'), road(11, [40.5, 24.5], 'road_e'),
    ],
  };
  // `extra`: more civilians, parked on the open ground in the south with no order, to hold the living count up to the 180 the design budgets (stress, not the pilot).
  if (extra > 0) {
    const groups = Math.ceil(extra / 7);
    for (let i = 0; i < groups; i++) m.civilians.groups.push({ unit: 'civilians', count: Math.floor(extra / groups) + (i < extra % groups ? 1 : 0), at: [17.5 + 4.5 * (i % 4), i < 4 ? 36 : 41], group: 'extra' });
  }
  m.triggers = [
    ...(m.triggers as { id: string }[]).filter((t) => t.id !== 'the_ring_closes'),
    { id: 'the_road_runs_west', label: 'The road runs for the west gate', on: { kind: 'timer_s', value: 2 }, do: { kind: 'withdraw_to', group: 'road_w', to: 'gate_apron_w' } },
    { id: 'the_road_runs_east', label: 'The road runs for the east gate', on: { kind: 'timer_s', value: 2 }, do: { kind: 'withdraw_to', group: 'road_e', to: 'gate_apron_e' } },
  ];
  // Nothing may end the run before 300 s: the evacuation is unreachable and its clock is the time limit.
  for (const o of m.objectives) if (o.id === 'evac_settlements') { o.count = 1000; o.seconds = 600; delete o.group; }
  if (gates === 'shut') m.structures = [...m.structures, { type: 'fence', at: [17, 21], size: [1, 2] }, { type: 'fence', at: [31, 24], size: [1, 2] }];
  return m as unknown as MissionJson;
}

interface World { sim: Sim; rt: MissionRuntime; at: (s: number, fn: () => void) => void; timed: [number, () => void][] }

export function buildWorld(plan: Plan, gates: Gates, seed: number, extra = 0): World {
  const mission = pilotMission(gates, extra);
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const markers = { ...map.markers, gate_apron_w: [15, 22], gate_apron_e: [33, 24] } as Record<string, readonly [number, number]>;
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) structIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  for (const b of map.structures) sim.addStructure(structIdx.get(b.type) as number, b.tiles);
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({ id: t.id, points: t.points, dig_tiles_per_s: t.digTilesPerS, pre_dug: t.preDug }));
  for (const r of tunnelRoutes) sim.addTunnel(r);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));
  const rt = new MissionRuntime(sim, mission, {
    startLayout: START_LAYOUT,
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: markers as never,
    zones: map.zones,
    roadMask: roadMaskOf(map),
    tunnels: tunnelRoutes,
    ledger: {},
    unitInfo: () => null,
  });
  rt.start();
  const timed: [number, () => void][] = [];
  const at = (s: number, fn: () => void): void => { timed.push([s * TICKS_PER_SECOND, fn]); };
  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  if (plan === 'optimal') firstLightPlan(sim, rt, ids, at);
  return { sim, rt, at, timed };
}

const living = (sim: Sim): number => {
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1) n++;
  return n;
};

export interface TickRow { total: number; living: number; lifetime: number }

/** Pass A: the clean total. Two clock reads a tick: `sim.tick()` and `rt.step()`. */
export function passA(plan: Plan, gates: Gates, seed: number, extra = 0, ticks = RUN_TICKS): { rows: TickRow[]; simMs: number[]; missionMs: number[] } {
  const w = buildWorld(plan, gates, seed, extra);
  const rows: TickRow[] = [];
  const simMs: number[] = [];
  const missionMs: number[] = [];
  for (let t = 0; t < ticks; t++) {
    for (const [when, fn] of w.timed) if (when === t) fn();
    const a = performance.now();
    const ev = w.sim.tick();
    const b = performance.now();
    w.rt.step(ev);
    const c = performance.now();
    simMs.push(b - a);
    missionMs.push(c - b);
    rows.push({ total: c - a, living: living(w.sim), lifetime: w.sim.entityCount });
  }
  return { rows, simMs, missionMs };
}

export const SYSTEMS = ['detection', 'combat', 'selectTarget', 'movement', 'fieldCompute', 'fieldRepair', 'civilianFlight', 'missionStep'] as const;
export type System = (typeof SYSTEMS)[number];

/** Pass B: the same run with the systems wrapped. `selectTarget` is a subset of `combat`, `fieldCompute` a subset of `movement` and the civilian step's own `fieldCompute`; the report says so. */
export function passB(plan: Plan, gates: Gates, seed: number, extra = 0, ticks = RUN_TICKS): { per: Record<System, number[]>; calls: Record<'selectTarget' | 'fieldCompute', number[]>; living: number[]; lifetime: number[] } {
  const w = buildWorld(plan, gates, seed, extra);
  const acc = Object.fromEntries(SYSTEMS.map((s) => [s, 0])) as Record<System, number>;
  const cnt = { selectTarget: 0, fieldCompute: 0 };
  const wrap = (obj: Record<string, unknown>, name: string, key: System, count?: 'selectTarget' | 'fieldCompute'): void => {
    const orig = obj[name] as (...a: unknown[]) => unknown;
    if (typeof orig !== 'function') throw new Error(`crowd-tick-budget: no method ${name} to time`);
    obj[name] = function timed(this: unknown, ...a: unknown[]): unknown {
      const t0 = performance.now();
      const r = orig.apply(this, a);
      acc[key] += performance.now() - t0;
      if (count !== undefined) cnt[count]++;
      return r;
    };
  };
  const s = w.sim as unknown as Record<string, unknown>;
  wrap(s, 'stepDetection', 'detection');
  wrap(s, 'stepCombat', 'combat');
  wrap(s, 'selectTarget', 'selectTarget', 'selectTarget');
  wrap(s, 'stepMovement', 'movement');
  wrap(s, 'recomputeFields', 'fieldRepair');
  // The field compute sits on the FlowField prototype: patch it once for this run (the wrap restores below).
  const fieldProto = FlowField.prototype as unknown as Record<string, unknown>;
  const origCompute = fieldProto.compute as (...a: unknown[]) => unknown;
  fieldProto.compute = function timedCompute(this: unknown, ...a: unknown[]): unknown {
    const t0 = performance.now();
    const r = origCompute.apply(this, a);
    acc.fieldCompute += performance.now() - t0;
    cnt.fieldCompute++;
    return r;
  };
  const civ = (w.rt as unknown as { civFlight: Record<string, unknown> }).civFlight;
  wrap(civ, 'step', 'civilianFlight');
  const per = Object.fromEntries(SYSTEMS.map((k) => [k, [] as number[]])) as Record<System, number[]>;
  const calls = { selectTarget: [] as number[], fieldCompute: [] as number[] };
  const liv: number[] = [];
  const life: number[] = [];
  try {
    for (let t = 0; t < ticks; t++) {
      for (const [when, fn] of w.timed) if (when === t) fn();
      for (const k of SYSTEMS) acc[k] = 0;
      cnt.selectTarget = 0;
      cnt.fieldCompute = 0;
      const ev = w.sim.tick();
      const m0 = performance.now();
      w.rt.step(ev);
      acc.missionStep = performance.now() - m0;
      for (const k of SYSTEMS) per[k].push(acc[k]);
      calls.selectTarget.push(cnt.selectTarget);
      calls.fieldCompute.push(cnt.fieldCompute);
      liv.push(living(w.sim));
      life.push(w.sim.entityCount);
    }
  } finally {
    fieldProto.compute = origCompute;
  }
  return { per, calls, living: liv, lifetime: life };
}

export const pct = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
};

const argOf = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<void> {
  const seedsN = Number(argOf('seeds') ?? 30);
  const plans = (argOf('plan') ?? 'passive,optimal').split(',') as Plan[];
  const gatesList = (argOf('gates') ?? 'open,shut').split(',') as Gates[];
  const extra = Number(argOf('extra') ?? 0);
  const out = argOf('out') ?? join(process.env.TMPDIR ?? '/tmp', 'crowd-tick-budget');
  mkdirSync(out, { recursive: true });
  const seeds = [424242, ...Array.from({ length: seedsN - 1 }, (_, k) => k + 1)];
  for (const plan of plans) for (const gates of gatesList) {
    const rec: unknown[] = [];
    for (const seed of seeds) {
      const a = passA(plan, gates, seed, extra);
      const b = passB(plan, gates, seed, extra);
      rec.push({ plan, gates, extra, seed, a, b });
      const peak = Math.max(...a.rows.map((r) => r.living));
      console.log(`${plan} ${gates} +${extra} seed ${seed}: A p50 ${pct(a.rows.map((r) => r.total), 50).toFixed(2)} p95 ${pct(a.rows.map((r) => r.total), 95).toFixed(2)} worst ${Math.max(...a.rows.map((r) => r.total)).toFixed(2)} ms, peak living ${peak}, lifetime ${a.rows[a.rows.length - 1]?.lifetime}`);
    }
    writeFileSync(join(out, `${plan}-${gates}-x${extra}.json`), JSON.stringify(rec));
  }
}

if (process.argv[1]?.endsWith('crowd-tick-budget.ts')) main().catch((e) => { console.error(e); process.exitCode = 1; });
