// How often ground vehicles stand inside each other, measured (GH-421, PA-10). REPORT-ONLY.
// Run: pnpm --filter @lions/tools vehicle-overlap:probe   (or npx tsx tools/src/backtest/vehicle-overlap-probe.ts)
//
// The sim has no unit-to-unit collision. This probe orders real vehicle rosters across shipped
// maps and counts, every tick, the pairs of ground vehicles whose HULLS intersect. It is the
// "before" reading of the vehicle-separation plan
// (docs/superpowers/plans/2026-10-23-vehicle-separation.md) and the falsification of its fix:
// the fix is done when these numbers fall, and the probe is what says by how much.
//
// The hull is an oriented box, not a circle, and it is MEASURED: `unitFootprintTable()`
// (tools/src/perf/unit-footprints.ts) reads each vehicle GLB's hull half-extents, the same
// numbers the selection ellipse is generated from. A circle would hide the nose-to-tail case
// that a column on a shared flow field produces. Float maths is fine here: this file is a
// tool, never the sim.
//
// Each overlapping pair-tick is classed by who moved THIS tick (position changed since the
// last tick): MM both moving, MS one moving into a stationary hull, SS both stationary. The
// class is what picks the design (spec §3): a fix that only ever brakes movers cannot touch
// SS, and a fix that only settles parked hulls cannot touch MM or MS.
//
// Nothing here asserts a level: `vehicle-overlap-probe.test.ts` checks the INSTRUMENT
// (literal geometry, a counted pair, an uncounted pair) and never the defect, so CI stays
// green before and after the fix. The numbers are printed, not gated.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Sim, fx, TICKS_PER_SECOND, type Command, type UnitTypeJson } from '@lions/sim';
import { units, maps, structures as structureCatalogue, parseMap, applyTerrain } from '@lions/data';
import { unitFootprintTable } from '../perf/unit-footprints';

/** A pair counts once its boxes interpenetrate by more than this, in tiles (6 cm). */
export const CONTACT_EPS = 0.02;
/** "Deep": more than a quarter tile (75 cm) of one hull inside another. */
export const DEEP = 0.25;

export interface Hull {
  /** Half-extent along the heading, tiles. */
  along: number;
  /** Half-extent across it, tiles. */
  across: number;
  /** Hull-box centre along the heading from the unit origin, tiles (negative = behind). */
  centreAlong: number;
}

/** Hull half-extents per ground-vehicle type id, measured from the GLBs. Air excluded. */
export function measuredHulls(): Map<string, Hull> {
  const out = new Map<string, Hull>();
  for (const r of unitFootprintTable()) {
    if (r.vehicleHalfExtent === null) continue;
    if (r.ringClass !== 'light' && r.ringClass !== 'armour') continue;
    out.set(r.unit, { ...r.vehicleHalfExtent });
  }
  return out;
}

/** An oriented box: centre, unit heading (ux, uy), half-extents. */
export interface Box {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  a: number;
  b: number;
}

/** The box a hull occupies at a position and a sim facing (65536 = one turn, y down). */
export function boxAt(h: Hull, x: number, y: number, facing: number): Box {
  const ang = (facing / 65536) * 2 * Math.PI;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  return { cx: x + ux * h.centreAlong, cy: y + uy * h.centreAlong, ux, uy, a: h.along, b: h.across };
}

/**
 * Penetration depth of two oriented boxes by the separating-axis test: the smallest overlap
 * over the four face normals, in tiles. <= 0 means apart (or touching).
 */
export function penetration(p: Box, q: Box): number {
  const dx = q.cx - p.cx;
  const dy = q.cy - p.cy;
  const axes: [number, number][] = [
    [p.ux, p.uy],
    [-p.uy, p.ux],
    [q.ux, q.uy],
    [-q.uy, q.ux],
  ];
  let best = Infinity;
  for (const [ax, ay] of axes) {
    const rp = p.a * Math.abs(p.ux * ax + p.uy * ay) + p.b * Math.abs(-p.uy * ax + p.ux * ay);
    const rq = q.a * Math.abs(q.ux * ax + q.uy * ay) + q.b * Math.abs(-q.uy * ax + q.ux * ay);
    const o = rp + rq - Math.abs(dx * ax + dy * ay);
    if (o < best) best = o;
  }
  return best;
}

export interface Reading {
  name: string;
  vehicles: number;
  ticks: number;
  /** Overlapping pair-ticks IN TRANSIT (before the group settled, or the whole run if it never
   *  did), by class. After the settle every pair is SS by definition and is counted in `atRest`
   *  instead, so the duration a scenario runs on after arriving does not inflate these. */
  mm: number;
  ms: number;
  ss: number;
  /** Transit pair-ticks deeper than DEEP. */
  deep: number;
  /** Deepest overlap seen in the whole run, tiles. */
  maxDepth: number;
  /** Deepest overlap among the pairs at rest on the last tick, tiles. */
  restDepth: number;
  /** Distinct pairs that ever overlapped. */
  pairs: number;
  /** Pairs still overlapping on the last tick (where the group came to rest, or, for a run that
   *  never settles, where it stands when the clock stops). */
  atRest: number;
  /** First tick on which no vehicle moved and none had an order (-1: never). */
  settledAt: number;
  /** Vehicles still under an order on the last tick (a stuck or circling hull reads here). */
  unfinished: number;
}

export interface Placed {
  unit: string;
  side: number;
  x: number;
  y: number;
  facingDeg?: number;
}

export interface Scenario {
  name: string;
  map: string;
  seed?: number;
  seconds: number;
  place: readonly Placed[];
  /** Orders, issued before the first tick, by index into `place`. */
  orders: (ids: readonly number[]) => readonly Command[];
}

/** A sim on a shipped map, terrain and buildings as the app raises them, every unit type registered. */
export function worldOn(mapId: string, seed: number, capacity = 256): { sim: Sim; typeOf: Map<string, number>; nameOf: Map<number, string> } {
  const map = parseMap(maps[mapId as keyof typeof maps]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity });
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
  const typeOf = new Map<string, number>();
  for (const [id, u] of Object.entries(units)) typeOf.set(id, sim.addUnitType(u as unknown as UnitTypeJson));
  const nameOf = new Map([...typeOf].map(([id, t]) => [t, id] as [number, string]));
  return { sim, typeOf, nameOf };
}

/** Step a world and count hull overlaps among the ground vehicles in it. */
export function measure(
  name: string,
  sim: Sim,
  nameOf: Map<number, string>,
  hulls: Map<string, Hull>,
  ticks: number
): Reading {
  const s = sim.state;
  const r: Reading = { name, vehicles: 0, ticks, mm: 0, ms: 0, ss: 0, deep: 0, maxDepth: 0, restDepth: 0, pairs: 0, atRest: 0, settledAt: -1, unfinished: 0 };
  const ever = new Set<string>();
  const prevX = new Int32Array(s.posX.length);
  const prevY = new Int32Array(s.posY.length);
  prevX.set(s.posX);
  prevY.set(s.posY);
  const vehicleIds = (): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++) {
      if (s.alive[i] === 0 || s.carriedBy[i] >= 0 || s.garrisonedIn[i] >= 0) continue;
      if (hulls.has(nameOf.get(s.typeIdx[i]) ?? '')) out.push(i);
    }
    return out;
  };
  r.vehicles = vehicleIds().length;
  for (let t = 0; t < ticks; t++) {
    sim.tick();
    const ids = vehicleIds();
    const boxes = ids.map((i) =>
      boxAt(hulls.get(nameOf.get(s.typeIdx[i]) ?? '') as Hull, fx.toNumber(s.posX[i]), fx.toNumber(s.posY[i]), s.facing[i])
    );
    const moved = ids.map((i) => s.posX[i] !== prevX[i] || s.posY[i] !== prevY[i]);
    if (r.settledAt < 0 && ids.every((i, k) => !moved[k] && s.moving[i] === 0)) r.settledAt = t;
    const transit = r.settledAt < 0;
    const last = t === ticks - 1;
    for (let p = 0; p < ids.length; p++) {
      for (let q = p + 1; q < ids.length; q++) {
        const d = penetration(boxes[p], boxes[q]);
        if (d <= CONTACT_EPS) continue;
        if (transit) {
          if (moved[p] && moved[q]) r.mm++;
          else if (moved[p] || moved[q]) r.ms++;
          else r.ss++;
          if (d > DEEP) r.deep++;
        }
        if (d > r.maxDepth) r.maxDepth = d;
        ever.add(`${ids[p]}-${ids[q]}`);
        if (last) {
          r.atRest++;
          if (d > r.restDepth) r.restDepth = d;
        }
      }
    }
    if (last) r.unfinished = ids.filter((i) => s.moving[i] === 1).length;
    prevX.set(s.posX);
    prevY.set(s.posY);
  }
  r.pairs = ever.size;
  return r;
}

/** Spawn a scenario's placements, issue its orders, and measure it. */
export function runScenario(sc: Scenario, hulls: Map<string, Hull>): Reading {
  const { sim, typeOf, nameOf } = worldOn(sc.map, sc.seed ?? 424242);
  const ids: number[] = [];
  for (const p of sc.place) {
    const t = typeOf.get(p.unit);
    if (t === undefined) throw new Error(`unknown unit ${p.unit}`);
    const facing = Math.round((((p.facingDeg ?? 0) % 360) + 360) % 360 / 360 * 65536) & 0xffff;
    ids.push(sim.spawn(t, p.side, fx.from(p.x), fx.from(p.y), facing));
  }
  for (const c of sc.orders(ids)) sim.queueCommand(c);
  return measure(sc.name, sim, nameOf, hulls, sc.seconds * TICKS_PER_SECOND);
}

/** Lay `units` out in a block of columns `gap` tiles apart, on open vehicle ground, centred near (x, y). */
export function block(mapId: string, unitIds: readonly string[], x: number, y: number, side = 0, facingDeg = 0, gap = 2.5): Placed[] {
  const map = parseMap(maps[mapId as keyof typeof maps]);
  const probe = new Sim({ seed: 1, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, probe);
  const mask = probe.blockedVehicle;
  const out: Placed[] = [];
  const used: [number, number][] = [];
  // A square spiral of candidate centres, `gap` apart, nearest first.
  const cand: [number, number][] = [];
  for (let r = 0; r <= 6; r++) {
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        cand.push([x + i * gap, y + j * gap]);
      }
    }
  }
  for (const u of unitIds) {
    for (const [cx, cy] of cand) {
      const tx = Math.floor(cx);
      const ty = Math.floor(cy);
      if (tx < 1 || ty < 1 || tx >= map.width - 1 || ty >= map.height - 1) continue;
      // The hull's own tile and its four neighbours open, so it does not start against a wall.
      let open = true;
      for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (mask[(ty + oy) * map.width + tx + ox] !== 0) open = false;
      }
      if (!open || used.some(([ux, uy]) => ux === cx && uy === cy)) continue;
      used.push([cx, cy]);
      out.push({ unit: u, side, x: cx, y: cy, facingDeg });
      break;
    }
  }
  if (out.length !== unitIds.length) throw new Error(`block: placed ${out.length} of ${unitIds.length} on ${mapId}`);
  return out;
}

/** The mixed group the brief names, plus a Kipod and a second Lavi: six hulls of four lengths. */
export const MIXED = ['mbt_lavi', 'ifv_namer', 'apc_eitan', 'jeep_shoded', 'apc_kipod', 'mbt_lavi'] as const;
/** A company-sized group: nine. */
export const MIXED9 = [...MIXED, 'ifv_namer', 'apc_eitan', 'scout_shachaf'] as const;

const move = (ids: readonly number[], x: number, y: number, extra: { exact?: boolean } = {}): Command => ({
  kind: 'move',
  ids: [...ids],
  x: fx.from(x),
  y: fx.from(y),
  ...extra,
});

export function scenarios(): Scenario[] {
  const bs = 'beit_sahwan_outskirts';
  const tm = 'tel_marum';
  const qh = 'qarn_hadid';
  const sandboxKdf: [string, number, number][] = [
    ['mbt_lavi', 0, -3], ['mbt_lavi', 0, 3], ['ifv_namer', -1, -7], ['ifv_namer', -1, 7],
    ['apc_eitan', -2, 0], ['jeep_shoded', 1, 3], ['dozer_d9', -1, -3],
  ];
  return [
    {
      // A player's group move: one order, formation slots, 27 tiles east across the town's edge.
      name: 'bs group move x6',
      map: bs, seconds: 90,
      place: block(bs, MIXED, 6, 23, 0, 0),
      orders: (ids) => [move(ids, 31, 22)],
    },
    {
      name: 'bs group move x9',
      map: bs, seconds: 90,
      place: block(bs, MIXED9, 6, 23, 0, 0),
      orders: (ids) => [move(ids, 31, 22)],
    },
    {
      // Every hull to ONE point, as an `exact` order does (a patrol leg, a transport chase) and as
      // sweeping closers do at the end of an AI `commit`: no slots.
      name: 'bs exact converge x6',
      map: bs, seconds: 90,
      place: block(bs, MIXED, 6, 23, 0, 0),
      orders: (ids) => [move(ids, 31, 22, { exact: true })],
    },
    {
      // Two groups of one side ordered through each other along the same street: head-on.
      name: 'bs two groups cross',
      map: bs, seconds: 90,
      place: [...block(bs, MIXED.slice(0, 3), 8, 23, 0, 0), ...block(bs, MIXED.slice(3), 28, 23, 0, 180)],
      orders: (ids) => [move(ids.slice(0, 3), 28, 23), move(ids.slice(3), 8, 23)],
    },
    {
      // The sandbox's own task force, no orders: what stands inside what at spawn (versus spawns the same).
      name: 'bs sandbox spawn (idle)',
      map: bs, seconds: 10,
      place: sandboxKdf.map(([u, dx, dy]) => ({ unit: u, side: 0, x: 4 + dx + 0.5, y: 23 + dy + 0.5 })),
      orders: () => [],
    },
    {
      // Up the valley and through the guarded wide saddle: a column on a shared field.
      name: 'tm saddle x6',
      map: tm, seconds: 150,
      place: block(tm, MIXED, 24, 43, 0, 270),
      orders: (ids) => [move(ids, 24, 12)],
    },
    {
      name: 'tm hollow x6',
      map: tm, seconds: 90,
      place: block(tm, MIXED, 24, 43, 0, 270),
      orders: (ids) => [move(ids, 24, 29)],
    },
    {
      name: 'qh gates x6',
      map: qh, seconds: 150,
      place: block(qh, MIXED, 24, 38, 0, 270),
      orders: (ids) => [move(ids, 24, 12)],
    },
    {
      // A fight: the group attack-moves (sweeping, as an AI commit does) onto a Sarim screen at the
      // town centre. Halted, firing hulls are what the column behind drives into.
      name: 'bs attack-move into a screen 6v3',
      map: bs, seconds: 120,
      place: [
        ...block(bs, MIXED, 6, 23, 0, 0),
        ...block(bs, ['technical', 'technical', 'gun_truck'], 31, 22, 1, 180, 3),
        { unit: 'rpg_team', side: 1, x: 30.5, y: 25.5 },
        { unit: 'militia_cell', side: 1, x: 30.5, y: 19.5 },
      ],
      orders: (ids) => [{ kind: 'attackMove', ids: ids.slice(0, 6), x: fx.from(31), y: fx.from(22), sweep: true }],
    },
  ];
}

export function formatReading(r: Reading): string {
  const total = r.mm + r.ms + r.ss;
  return (
    `${r.name.padEnd(34)} veh ${String(r.vehicles).padStart(2)}  transit ${String(total).padStart(5)}` +
    ` (MM ${String(r.mm).padStart(4)} MS ${String(r.ms).padStart(4)} SS ${String(r.ss).padStart(4)})` +
    `  deep ${String(r.deep).padStart(4)}  max ${r.maxDepth.toFixed(2)}  pairs ${String(r.pairs).padStart(2)}` +
    `  at rest ${String(r.atRest).padStart(2)} (max ${r.restDepth.toFixed(2)})` +
    `  settled ${r.settledAt < 0 ? 'no' : (r.settledAt / TICKS_PER_SECOND).toFixed(1) + ' s'}` +
    (r.unfinished > 0 ? `  unfinished ${r.unfinished}` : '')
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hulls = measuredHulls();
  console.log(`vehicle overlap probe (GH-421), report only; contact > ${CONTACT_EPS} tile, deep > ${DEEP} tile`);
  console.log(`hulls (half-extents, tiles): ${[...hulls].map(([id, h]) => `${id} ${h.along.toFixed(2)}x${h.across.toFixed(2)}`).join(', ')}`);
  let transit = 0;
  let rest = 0;
  for (const sc of scenarios()) {
    const r = runScenario(sc, hulls);
    transit += r.mm + r.ms + r.ss;
    rest += r.atRest;
    console.log(formatReading(r));
  }
  console.log(`total: ${transit} overlapping pair-ticks in transit, ${rest} pairs overlapping at rest`);
}
