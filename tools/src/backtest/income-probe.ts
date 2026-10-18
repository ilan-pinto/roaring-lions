// F2 Task 2 (GH-183): REPORT-ONLY, NO GATE. Not wired into CI, `pnpm test` or `pnpm playtest`.
//
// A preload for `playtest.ts`: it authors one of `income-proposal.ts`'s tables onto the four D7
// missions IN MEMORY (the parsed `missions` object that `run()` reads, never `data/missions/*.json`:
// ruling C-R1) and records, for every run of those four missions, what the real `MissionRuntime`
// did with it. The ladder, the 30-seed plan sweep and the 30-seed passive sweep all run unchanged,
// because the sweeps fork with `process.execArgv` and so load this preload too.
//
//   cd tools
//   PT_INCOME=<table> PT_INCOME_OUT=<dir> npx tsx --import ./src/backtest/income-probe.ts src/backtest/playtest.ts
//   npx tsx src/backtest/income-probe-report.ts <dir>
//
// Each process appends one JSON line per finished run to `<dir>/<table>.<pid>.jsonl`. How it reads
// the runtime, and why that cannot change an outcome: it wraps `MissionRuntime.prototype.start`,
// `step` and `requestBuild`, calls the originals unchanged, and only READS public getters
// (`incomeZones`, `convoyRoute`, `incomePerMin`, `logistics`, `logisticsEarned`,
// `zoneLogisticsEarned`, `result`, `stars`, `roeScore`, `objectiveList`). The run's label (plan or
// control) is matched afterwards from `runLog`, whose entry `run()` pushes once per `start()`.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MissionRuntime, creditsFor, creditInputFrom, type SimEvent, type MissionEvent } from '@lions/sim';
import { missions, maps } from '@lions/data';
import { runLog } from './playtest-run';
import { INCOME_TABLES, D7_MISSIONS, tableProblems, type MissionIncome } from './income-proposal';

const TABLE = process.env.PT_INCOME;
const OUT = process.env.PT_INCOME_OUT;
/** Ticks between two walk rows: 30 s. */
const WALK_TICKS = 600;
/** `run()`'s cap: 20 minutes of ticks. */
const MAX_TICKS = 20 * 60 * 20;

interface Row {
  t: number;
  /** Per zone: [state, cut]. */
  z: [number, string | null][];
  convoy: string | null | undefined;
  purse: number;
  base: number;
  zones: number;
}
interface Rec {
  index: number;
  pid: number;
  seed: number | undefined;
  ticks: number;
  rows: Row[];
  /** Each zone's (and `convoy`'s) first route, as tile indices y * width + x. */
  routes: Record<string, number[]>;
  /** First tick each cut cause was seen per zone (and `convoy`). */
  cuts: Record<string, Record<string, number>>;
  /** Ticks each zone (and `convoy`) spent cut, by cause. */
  cutTicks: Record<string, Record<string, number>>;
  /** Ticks each zone spent in each state (0, 1, -1, -2). */
  stateTicks: Record<string, Record<string, number>>;
  builds: [number, string, boolean][];
  done: boolean;
}

type MutableMission = { id: string; map: { file: string }; resources?: Record<string, unknown>; roe?: { fail_below?: number } };
type MutableMap = { zones?: Record<string, number[]>; markers?: Record<string, number[]> };

function apply(name: string): void {
  const table = INCOME_TABLES[name];
  if (table === undefined) throw new Error(`income-probe: no table "${name}" (have ${Object.keys(INCOME_TABLES).join(', ')})`);
  const ms = missions as unknown as Record<string, MutableMission>;
  const mp = maps as unknown as Record<string, MutableMap>;
  const problems = tableProblems(
    table,
    (id) => mp[ms[id].map.file].zones ?? {},
    (id) => mp[ms[id].map.file].markers ?? {},
  );
  // Markers added in memory are checked against the map's grid by the runtime itself: an entry on a
  // blocked tile reads 'unreachable' in the walk, which is the reading such a choice would give.
  if (problems.length > 0) throw new Error(`income-probe: table "${name}": ${problems.join('; ')}`);
  for (const [id, m] of Object.entries(table) as [string, MissionIncome][]) {
    const copy = structuredClone(ms[id]);
    copy.resources = { ...(copy.resources ?? {}), income_zones: m.zones.map(([zone, rate]) => ({ zone, rate_per_min: rate })) };
    if (m.supplyEntry !== undefined) copy.resources.supply_entry = m.supplyEntry;
    ms[id] = copy;
    if (m.moveZone || m.addMarkers) {
      const file = copy.map.file;
      const mapCopy = structuredClone(mp[file]);
      if (m.moveZone) mapCopy.zones = { ...(mapCopy.zones ?? {}), [m.moveZone.zone]: [...m.moveZone.rect] };
      if (m.addMarkers) {
        const added = Object.fromEntries(Object.entries(m.addMarkers).map(([k, v]) => [k, [...v]]));
        mapCopy.markers = { ...(mapCopy.markers ?? {}), ...added };
      }
      mp[file] = mapCopy;
    }
  }
}

if (TABLE !== undefined && OUT !== undefined) {
  apply(TABLE);
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${TABLE}.${process.pid}.jsonl`);
  // A passive-sweep worker is told its seed by message; this listener is registered before the
  // worker's own, so it runs first. Only there: a 'message' listener holds the IPC channel open, so in
  // a plan-sweep child (which exits when its ladder is done, and knows its seed from PT_SEED) it would
  // keep the child alive and the parent waiting for it, forever.
  let seed: number | undefined = process.env.PT_SEED !== undefined ? Number(process.env.PT_SEED) : undefined;
  if (process.send !== undefined && process.env.PT_PLAN_CHILD !== '1') {
    process.on('message', (m: unknown) => {
      if (typeof m === 'object' && m !== null && 'seed' in m && typeof (m as { seed: unknown }).seed === 'number') {
        seed = (m as { seed: number }).seed;
      }
    });
  }
  const recs = new WeakMap<MissionRuntime, Rec>();
  const d7 = new Set<string>(D7_MISSIONS);

  const flush = (rec: Rec, rt: MissionRuntime): void => {
    const entry = runLog[rec.index];
    if (entry === undefined || !d7.has(entry.id)) return;
    const mission = (missions as unknown as Record<string, MutableMission>)[entry.id];
    const res = mission.resources ?? {};
    const width = (maps as unknown as Record<string, { width: number }>)[mission.map.file].width;
    appendFileSync(
      file,
      JSON.stringify({
        table: TABLE,
        id: entry.id,
        label: entry.label,
        expect: entry.expect,
        result: entry.result,
        stuck: entry.stuck,
        minutes: entry.minutes,
        stars: entry.stars,
        roe: entry.roe,
        credits: creditsFor(creditInputFrom(rt, rt.roeScore, mission.roe?.fail_below)),
        logisticsStart: (res.logistics_start as number | undefined) ?? 0,
        ratePerMin: (res.logistics_rate_per_min as number | undefined) ?? 0,
        ...rec,
        routes: Object.fromEntries(Object.entries(rec.routes).map(([k, r]) => [k, r.map((i) => [i % width, (i / width) | 0])])),
      }) + '\n',
    );
  };

  const origStart = MissionRuntime.prototype.start;
  MissionRuntime.prototype.start = function (this: MissionRuntime): void {
    recs.set(this, {
      index: runLog.length,
      pid: process.pid,
      seed,
      ticks: 0,
      rows: [],
      routes: {},
      cuts: {},
      cutTicks: {},
      stateTicks: {},
      builds: [],
      done: false,
    });
    origStart.call(this);
  };

  const origBuild = MissionRuntime.prototype.requestBuild;
  MissionRuntime.prototype.requestBuild = function (this: MissionRuntime, unitId: string): boolean {
    const ok = origBuild.call(this, unitId);
    const rec = recs.get(this);
    if (rec) rec.builds.push([rec.ticks, unitId, ok]);
    return ok;
  };

  const noteCut = (rec: Rec, key: string, cut: string): void => {
    const c = (rec.cuts[key] ??= {});
    c[cut] ??= rec.ticks;
    const n = (rec.cutTicks[key] ??= {});
    n[cut] = (n[cut] ?? 0) + 1;
  };

  const origStep = MissionRuntime.prototype.step;
  MissionRuntime.prototype.step = function (this: MissionRuntime, evs: SimEvent[]): MissionEvent[] {
    const out = origStep.call(this, evs);
    const rec = recs.get(this);
    if (rec === undefined || rec.done) return out;
    rec.ticks++;
    const zs = this.incomeZones;
    for (const z of zs) {
      const st = (rec.stateTicks[z.zone] ??= {});
      st[z.state] = (st[z.state] ?? 0) + 1;
      if (z.route !== null && rec.routes[z.zone] === undefined) rec.routes[z.zone] = Array.from(z.route);
      if (z.cut !== null) noteCut(rec, z.zone, z.cut);
    }
    const cv = this.convoyRoute;
    if (cv !== null) {
      if (cv.route !== null && rec.routes.convoy === undefined) rec.routes.convoy = Array.from(cv.route);
      if (cv.cut !== null) noteCut(rec, 'convoy', cv.cut);
    }
    const ended = this.result !== 'ongoing' || rec.ticks >= MAX_TICKS;
    if (rec.ticks % WALK_TICKS === 0 || ended) {
      const inc = this.incomePerMin;
      rec.rows.push({
        t: rec.ticks,
        z: zs.map((z) => [z.state, z.cut]),
        convoy: cv === null ? undefined : cv.cut,
        purse: this.logistics,
        base: inc.base,
        zones: inc.zones,
      });
    }
    if (ended) {
      rec.done = true;
      const final = { earned: this.logisticsEarned(0), zoneEarned: this.zoneLogisticsEarned(0), held: this.logistics, enemyZoneEarned: this.zoneLogisticsEarned(1) };
      // `run()` pushes this run's `runLog` entry after its loop; a microtask runs after that push.
      queueMicrotask(() => flush(Object.assign(rec, final), this));
    }
    return out;
  };
}
