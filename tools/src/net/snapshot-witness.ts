// The full snapshot witness (net sim snapshot, stage 1, Task 7b): the proof of
// `packages/sim/src/snapshot-witness.ts`, run over real worlds.
//
//   pnpm snapshot:witness                       the matrix and the coverage census
//   pnpm snapshot:witness -- --self-check       ... and the three mutations that must turn it red (CI)
//   pnpm snapshot:witness -- --only=<substr>    the worlds whose id contains it (no census)
//
// WHAT IT RUNS. Every world below is played once by A, uninterrupted, to its end. At each cut
// tick T the sim is encoded, a FRESH world from the same build is restored from those bytes,
// and both are driven with the same inputs for the horizon; one extra fork per world (the tail)
// runs to the end, cut at tick 600 on the long worlds and at tick 100 on the golden ones. Every fork is held to
//   - the restored world re-encoding to exactly the bytes it was restored from, at T,
//   - the match hash equal at T and every 20 ticks (the sim hash folded with the runtime's
//     digest, for a world that has a runtime),
//   - the two canonical encodings byte-equal at the end,
//   - every `config` row of A equal to B right after the restore,
//   - for a world with a runtime or a driver: a deep-equal of A's and B's data at the end,
//   - and all of it with everything the restore promises not to write poisoned.
// The worlds: versus MIRROR rooms (no runtime) on the four fair maps, the three ECONOMY cells,
// the TUNNELS arm, a CAPACITY stress, and the golden worlds (battle, relief, orders, wounded,
// economy). `snapshot-runtime-carry.ts` is the stand-in that moves a runtime and a driver across
// until stage 2 encodes them.
//
// WHAT THE MIRROR WORLDS DO AND DO NOT PROVE. A mirror room's fight ends early (annihilation inside a few
// minutes), so most of its cuts are of a decided world; the live-combat proof comes mainly from the golden
// battle, the economy cells and the stress world.
//
// THINGS THE MATRIX HAD TO LEARN ABOUT THE SIM, found by running it:
//   - in a world with a runtime, `step` queues the rally order of a unit it has just delivered
//     AFTER the tick, so a few frame boundaries (about 14 in 6,000 ticks of an economy room)
//     hold a queued command. The queues are snapshot `state`, so a cut there must round-trip:
//     every runtime world gets one extra cut at such a boundary (`withQueuedCut`) and the CLI
//     fails if no fork of the matrix was cut with a non-empty `commandQueue`.
//   - `UnitType.woundedTypeIdx` is a lazy cache written on the `unitTypes` CONFIG objects; see
//     `resolveLazyConfig`.
//
// THE COVERAGE CENSUS. A fork that restores a row nobody ever changed proves nothing about that
// row. At every cut (and at the end) the census asks `stateRowsMoved` which `state` rows of A
// differ from the same world's tick 0, and unions the answer over all cuts and all worlds. A row
// that never moved must be listed in `SNAPSHOT_COVERAGE_EXEMPT` with a reason naming the world
// that would cover it; an exemption whose row DID move fails too ("delete this exemption").
//
// THE SELF-CHECKS (`--self-check`). A witness that cannot fail proves nothing. Three mutations
// of B right after the restore, each of which must turn its world red, each preceded by the
// same series run clean: see `SELF_CHECKS`.

import { fileURLToPath } from 'node:url';
import { fx, type MissionRuntime, type Sim } from '@lions/sim';
import { doctrines, type MapId } from '@lions/data';
import { VERSUS_FAIR_MAPS, matchDigest, type Faction } from '@lions/net';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { RUNTIME_SNAPSHOT_SCHEMA } from '../../../packages/sim/src/runtime-snapshot-schema';
import { rowsOf } from '../../../packages/sim/src/snapshot-schema';
import { internals } from '../../../packages/sim/src/snapshot';
import { forkWitnessSeries, stateRowsMoved, type SeriesForkVerdict, type WitnessWorld } from '../../../packages/sim/src/snapshot-witness';
import {
  ECONOMY_SEED,
  ECONOMY_TICKS,
  RELIEF_SEED,
  ORDERS_SEED,
  RUN_SEED,
  WW_SEED,
  economyAdvance,
  economyDrive,
  economySetup,
  ordersDrive,
  ordersSetup,
  reliefDrive,
  reliefSetup,
  runDrive,
  runSetup,
  woundedSetup,
} from '../../../packages/sim/src/golden-worlds.test-helper';
import {
  DECIDE_EVERY_TICKS,
  ORDER_EVERY_TICKS,
  TunnelPlan,
  forceMixOf,
  layoutOf,
  livingOf,
  order,
  planRound,
  roomConfig,
  type Arrangement,
  type TunnelCell,
} from '../backtest/versus-probe';
import { carriedDiff, carryOnto, type DiffIgnore, type Rebind } from './snapshot-runtime-carry';

// ---- worlds -----------------------------------------------------------------------------------

/** A world the witness can fork: the sim, what rides beside it, and how it is driven. */
export interface SnapWorld extends WitnessWorld {
  readonly sim: Sim;
  readonly runtime: MissionRuntime | null;
  /** Objects beside the sim whose data must follow the restore (the runtime, a driver), in a stable order. */
  readonly carried: readonly object[];
  /** Objects that exist once per world (the sim, the mission JSON, the context): rebound, never copied. */
  readonly anchors: readonly object[];
  /** Applies tick `t`'s inputs. */
  readonly driveAt: (t: number) => void;
  /** Steps one tick. */
  readonly advanceOnce: () => void;
  // Bookkeeping the witness sets; a world's builder leaves them alone.
  isA?: boolean;
  parent?: SnapWorld;
  endsAt?: number;
  /** Set on B at its fork's end: where the carried data of A and B differ, or null. */
  carriedDiffAtEnd?: string | null;
}

export interface Plan {
  /** Cut ticks, ascending, none equal to `tailFrom`. */
  readonly Ts: readonly number[];
  readonly horizon: number;
  /** One more fork, cut here, that runs to `end`. */
  readonly tailFrom: number;
  readonly end: number;
}

export interface WorldSpec {
  readonly id: string;
  readonly plan: Plan;
  readonly build: () => SnapWorld;
  /** What this world exists to exercise, asked of A when it reaches the end; a string is a problem. */
  readonly exercised?: (a: SnapWorld) => string | null;
}

const anchorsOf = (sim: Sim, rt: MissionRuntime): object[] => {
  const r = rt as unknown as { mission: object; ctx: object };
  return [sim, r.mission, r.ctx];
};

/** The match hash: the sim's, folded with the runtime's digest when the world has one. */
export function hashOfWorld(w: SnapWorld): number {
  return w.runtime === null ? w.sim.hash() : matchDigest(w.sim.hash(), w.runtime.digest(), 0);
}

function simWorld(sim: Sim, driveAt: (t: number) => void): SnapWorld {
  return { sim, runtime: null, carried: [], anchors: [sim], driveAt, advanceOnce: () => void sim.tick() };
}

/** A versus mirror room: two KDF forces, no runtime, each side attack-moving on the other's centroid. */
export function mirrorWorld(map: MapId, seed: number): SnapWorld {
  const arr: Arrangement = ['kdf', 'kdf'];
  const m = buildMatchWorld(roomConfig(map, arr, seed));
  if (m.runtime !== null) throw new Error(`snapshot witness: the ${map} mirror room built a runtime`);
  const { sideOfEnd } = layoutOf(arr);
  return {
    sim: m.sim,
    runtime: null,
    carried: [],
    anchors: [m.sim],
    driveAt: (t) => {
      if (t % ORDER_EVERY_TICKS === 0) order(m.sim, (side) => livingOf(m.sim, side), sideOfEnd);
    },
    advanceOnce: () => void matchTick(m),
  };
}

/**
 * A room's economy world, played the way `playEconomy` plays it: each line rallies on its own
 * anchor, every round the production plan queues and then every living unit attack-moves. With
 * `tunnels`, the tunnel plan is laid over it exactly as that arm lays it.
 */
export function economyWorld(map: MapId, arr: Arrangement, seed: number, tunnels?: TunnelCell): SnapWorld {
  const m = buildMatchWorld(roomConfig(map, arr, seed));
  const rt = m.runtime;
  if (rt === null) throw new Error(`snapshot witness: ${map} built no economy runtime`);
  for (const side of [0, 1] as const) {
    const [ax, ay] = m.anchors[m.endOfSide[side]];
    if (!rt.setRally(0, fx.from(ax), fx.from(ay), side)) throw new Error(`snapshot witness: ${map} side ${side} refused a rally on its own anchor`);
  }
  const { sideOfEnd } = layoutOf(arr);
  const menus = [doctrines[m.factions[0]].menu, doctrines[m.factions[1]].menu] as const;
  const mixes = [forceMixOf(m.factions[0]), forceMixOf(m.factions[1])] as const;
  const plan = tunnels === undefined ? null : new TunnelPlan(m, tunnels);
  return {
    sim: m.sim,
    runtime: rt,
    carried: plan === null ? [rt] : [rt, plan],
    anchors: anchorsOf(m.sim, rt),
    driveAt: (t) => {
      if (t % ORDER_EVERY_TICKS === 0) {
        plan?.beforeProduction(rt);
        for (const side of sideOfEnd) planRound(rt, m.sim, menus[side], mixes[side], side);
        plan?.round(t);
        order(m.sim, (side) => livingOf(m.sim, side).filter((id) => plan === null || !plan.holds(id)), sideOfEnd);
      }
      if (plan !== null && t % DECIDE_EVERY_TICKS === 0) plan.second(t);
      plan?.beforeTick();
    },
    advanceOnce: () => {
      const ev = matchTick(m);
      plan?.after(ev.sim);
    },
  };
}

/**
 * A mirror world filled to its 256-entity capacity before tick 0: the placed forces, then the
 * same roster copied in turn onto open tiles near each anchor, both sides. The flow-field pool
 * grows past its 128 cap here (every field live), which no ordinary world reaches.
 */
export function stressWorld(map: MapId, seed: number): SnapWorld {
  const arr: Arrangement = ['kdf', 'kdf'];
  const m: MatchWorld = buildMatchWorld(roomConfig(map, arr, seed));
  const sim = m.sim;
  const proto = [...m.bySide[0], ...m.bySide[1]].map((id) => sim.state.typeIdx[id]);
  let k = 0;
  for (let r = 1; sim.entityCount < sim.capacity && r < 24; r++) {
    for (const side of [0, 1] as const) {
      const [ax, ay] = m.anchors[m.endOfSide[side]];
      for (let dx = -r; dx <= r && sim.entityCount < sim.capacity; dx++) {
        for (const dy of [-r, r]) {
          const x = ax + dx;
          const y = ay + dy;
          if (x < 1 || y < 1 || x >= sim.width - 1 || y >= sim.height - 1 || sim.blocked[y * sim.width + x] !== 0) continue;
          if (sim.entityCount >= sim.capacity) break;
          sim.spawn(proto[k++ % proto.length], side, fx.from(x) + fx.from(1) / 2, fx.from(y) + fx.from(1) / 2);
        }
      }
    }
  }
  if (sim.entityCount !== sim.capacity) throw new Error(`snapshot witness: the stress world filled to ${sim.entityCount} of ${sim.capacity}`);
  const { sideOfEnd } = layoutOf(arr);
  return {
    sim,
    runtime: null,
    carried: [],
    anchors: [sim],
    driveAt: (t) => {
      if (t % ORDER_EVERY_TICKS === 0) order(sim, (side) => livingOf(sim, side), sideOfEnd);
    },
    advanceOnce: () => void matchTick(m),
  };
}

// The golden worlds of determinism.test.ts, by relative import of their test helper (a controller
// ruling: tools is outside the sim lint). The pinned replays run 1000 / 900 / 900 / 600 / 2400
// ticks; the witness runs each to exactly that.

export function goldenBattle(): SnapWorld {
  const { sim, ids } = runSetup(RUN_SEED);
  return simWorld(sim, (t) => runDrive(sim, t, ids));
}
export function goldenRelief(): SnapWorld {
  const { sim, up } = reliefSetup(RELIEF_SEED, true);
  return simWorld(sim, (t) => reliefDrive(sim, t, up));
}
export function goldenOrders(): SnapWorld {
  const { sim, ids } = ordersSetup(ORDERS_SEED);
  return simWorld(sim, (t) => ordersDrive(sim, t, ids));
}
export function goldenWounded(): SnapWorld {
  return simWorld(woundedSetup(WW_SEED), () => undefined);
}
export function goldenEconomy(): SnapWorld {
  const ew = economySetup(ECONOMY_SEED);
  return {
    sim: ew.sim,
    runtime: ew.rt,
    // The replay's own record and driver fields ride beside the runtime.
    carried: [ew.rt, ew.run, ew],
    anchors: anchorsOf(ew.sim, ew.rt),
    driveAt: (t) => economyDrive(ew, t),
    advanceOnce: () => economyAdvance(ew, ew.sim.tickCount),
  };
}

// ---- plans ------------------------------------------------------------------------------------

/** A long world: a cut every 1,200 ticks and at four prime offsets, each running `horizon`; a tail from 600. */
export function longPlan(end: number, horizon = 1200): Plan {
  const set = new Set<number>();
  for (let T = 1200; T + horizon <= end; T += 1200) set.add(T);
  for (const p of [97, 1013, 4999, 11003]) if (p + horizon <= end) set.add(p);
  return { Ts: Array.from(set).sort((a, b) => a - b), horizon, tailFrom: 600, end };
}

/**
 * A golden world: a cut every 25 ticks (every 50 in the long economy replay) and at 97, each
 * running 300; a tail from 100. These are the only worlds whose scripts dig, garrison, demolish
 * and wound, and several of those states last well under 100 ticks, so the cuts are close.
 */
export function goldenPlan(end: number): Plan {
  const step = end <= 1000 ? 25 : 50;
  const tailFrom = 100;
  const set = new Set<number>([0, 97]);
  for (let T = step; T + 300 <= end; T += step) if (T !== tailFrom) set.add(T);
  return { Ts: Array.from(set).sort((a, b) => a - b), horizon: 300, tailFrom, end };
}

const MIRROR_SEEDS = [1000, 8919] as const;
const MIRROR_END = 24000;
/** The stress world is the slow one: 256 entities, run to 6,000 ticks only. */
const STRESS_END = 6000;
const ECONOMY_CELLS = [
  { map: 'tel_marum', arr: ['kdf', 'sarim'], seed: 1000 },
  { map: 'wadi_tarfan', arr: ['kdf', 'sarim'], seed: 8919 },
  { map: 'wadi_tarfan', arr: ['sarim', 'kdf'], seed: 16838 },
] as const satisfies readonly { map: MapId; arr: readonly [Faction, Faction]; seed: number }[];

/** Every world of the matrix, in the order they run. */
export function worldSpecs(): WorldSpec[] {
  const out: WorldSpec[] = [];
  for (const map of VERSUS_FAIR_MAPS as readonly MapId[]) {
    for (const seed of MIRROR_SEEDS) out.push({ id: `mirror ${map} ${seed}`, plan: longPlan(MIRROR_END), build: () => mirrorWorld(map, seed) });
  }
  for (const c of ECONOMY_CELLS) {
    out.push({ id: `economy ${c.map} ${c.arr.join('/')} ${c.seed}`, plan: longPlan(MIRROR_END), build: () => economyWorld(c.map, c.arr, c.seed) });
  }
  out.push({
    id: 'tunnels tel_marum kdf/sarim 1000 (answer)',
    plan: longPlan(MIRROR_END),
    build: () => economyWorld('tel_marum', ['kdf', 'sarim'], 1000, 'answer'),
  });
  out.push({
    id: 'stress tel_marum 256 entities 1000',
    plan: longPlan(STRESS_END),
    build: () => stressWorld('tel_marum', 1000),
    // The world exists for a flow-field pool past its 128 cap (every field live) and a full entity table.
    exercised: (a) =>
      a.sim.flowFieldCount > 128 && a.sim.entityCount === a.sim.capacity
        ? null
        : `the stress world stopped stressing: ${a.sim.flowFieldCount} flow fields (need more than 128), ${a.sim.entityCount} of ${a.sim.capacity} entities`,
  });
  out.push({ id: 'golden battle (1000)', plan: goldenPlan(1000), build: goldenBattle });
  out.push({ id: 'golden relief (900)', plan: goldenPlan(900), build: goldenRelief });
  out.push({ id: 'golden orders (900)', plan: goldenPlan(900), build: goldenOrders });
  out.push({ id: 'golden wounded (600)', plan: goldenPlan(600), build: goldenWounded });
  out.push({ id: `golden economy (${ECONOMY_TICKS})`, plan: goldenPlan(ECONOMY_TICKS), build: goldenEconomy });
  return out;
}
// ---- one world --------------------------------------------------------------------------------

export interface WorldRun {
  readonly id: string;
  readonly forks: number;
  /** Everything wrong, over all forks; empty when the world is clean. */
  readonly problems: string[];
  /** Per fork, what was wrong with it (the Bs themselves are dropped). */
  readonly forkProblems: { readonly T: number; readonly horizon: number; readonly problems: string[] }[];
  /** Every `state` row that differed from tick 0 at any cut or at the end. */
  readonly moved: Set<string>;
  readonly garbledUnkeyedSlots: number;
  /** Whether the world has a runtime (so its frames can end with a queued command). */
  readonly hasRuntime: boolean;
  /** How many cuts found A's `commandQueue` / `runtimeQueue` non-empty. */
  readonly queuedCuts: { readonly command: number; readonly runtime: number };
  readonly wallMs: number;
}

export interface RunOptions {
  /** Applied to B right after the restore, poison and carry (a self-check's mutation). */
  readonly mutate?: (b: SnapWorld, a: SnapWorld) => void;
  /** Overrides the spec's plan (a self-check runs a short one). */
  readonly plan?: Plan;
  /** A runtime world gets one extra cut at a boundary with a queued command. Default true; false is the falsification. */
  readonly queuedCut?: boolean;
}

const isColumn = (v: unknown): v is ArrayBufferView => ArrayBuffer.isView(v) && !(v instanceof DataView);

/** Maps every typed-array own property of `a` to the same-named one of `b` (both plain records or class instances). */
function rebindColumns(rebind: Map<object, object>, a: object, b: object): void {
  for (const k of Reflect.ownKeys(a)) {
    const va = (a as Record<string | symbol, unknown>)[k];
    const vb = (b as Record<string | symbol, unknown>)[k];
    if (isColumn(va) && isColumn(vb)) rebind.set(va, vb);
  }
}

/**
 * What exists once per world and must never cross: the anchors, the carried roots, and EVERY
 * sim column. The runtime holds views that alias sim columns (`holdView`: alive, side, posX,
 * posY, tunnelIn, tnAlive, tnVentOpen, tnDigger), and B's views are B's own live columns;
 * without these entries the carry would recurse into the view and `.set` A's column into B's,
 * repairing after the restore the very rows the restore (and the pre-restore poison) are
 * judged on. With them a view resolves to B's own column and nothing is written.
 */
export function rebindOf(b: SnapWorld, a: SnapWorld): Map<object, object> {
  const rebind = new Map<object, object>();
  if (a.anchors.length !== b.anchors.length || a.carried.length !== b.carried.length) throw new Error('snapshot witness: A and B carry different things');
  const ia = internals(a.sim);
  const ib = internals(b.sim);
  rebindColumns(rebind, ia, ib);
  for (const view of ['state', 'structures', 'works']) rebindColumns(rebind, ia[view] as object, ib[view] as object);
  rebindColumns(rebind, ia.rng as object, ib.rng as object);
  a.anchors.forEach((x, i) => rebind.set(x, b.anchors[i]));
  a.carried.forEach((x, i) => rebind.set(x, b.carried[i]));
  return rebind;
}

/**
 * `UnitType.woundedTypeIdx` is a lazy cache the sim writes ON the `unitTypes` config objects the
 * first time a man with wounds falls (`woundedTypeOf`): -1 until then, a pure function of the
 * registered types after. A is at tick T with the cache filled where a man has fallen; a fresh
 * B has it at -1, which `configDiff` reads as a config row that differs. Nothing is lost by it
 * (B resolves it, to the same index, at its first fall: the continued hash says so), so B asks
 * the sim's own resolver for exactly the types A has resolved, before the config check runs.
 */
function resolveLazyConfig(b: SnapWorld, a: SnapWorld): void {
  const ta = internals(a.sim).unitTypes as { woundedTypeIdx: number }[];
  const tb = internals(b.sim).unitTypes as { woundedTypeIdx: number }[];
  const resolve = (internals(b.sim) as unknown as { woundedTypeOf: (t: unknown) => number }).woundedTypeOf.bind(b.sim);
  ta.forEach((t, i) => {
    if (t.woundedTypeIdx >= 0 && tb[i].woundedTypeIdx < 0) resolve(tb[i]);
  });
}

/** Moves A's runtime and driver data onto B's own objects, at A's tick T. */
export function carryWorld(b: SnapWorld, a: SnapWorld): void {
  resolveLazyConfig(b, a);
  const rebind: Rebind = rebindOf(b, a);
  a.carried.forEach((x, i) => carryOnto(b.carried[i], x, rebind));
}

/** The names of the runtime's own `scratch` rows (the schema's), which the reflection comparison does not look at. */
const RUNTIME_SCRATCH_ROWS: ReadonlySet<string> = new Set(RUNTIME_SNAPSHOT_SCHEMA.filter((r) => r.cls === 'scratch').map((r) => r.name));

/**
 * A runtime's `scratch` rows are not data (the codec never writes one, and the witness poisons them natively after the
 * restore since snapshot S2 Task 4), so B holds garbage in a slot the runtime has not rewritten since, where A holds its
 * old tail: `ventOut`, `CivilianFlight.scratch`. The comparison skips them. It dies with the carry in Task 5.
 */
const ignoreScratch: DiffIgnore = (owner, key) =>
  (owner.constructor.name === 'MissionRuntime' && typeof key === 'string' && RUNTIME_SCRATCH_ROWS.has(key)) ||
  (owner.constructor.name === 'CivilianFlight' && key === 'scratch');

function carriedDiffOf(b: SnapWorld, a: SnapWorld): string | null {
  const rebind: Rebind = rebindOf(b, a);
  for (let i = 0; i < a.carried.length; i++) {
    const d = carriedDiff(a.carried[i], b.carried[i], `carried[${i}]`, rebind, ignoreScratch);
    if (d !== null) return d;
  }
  return null;
}

export function problemsOf(v: SeriesForkVerdict<SnapWorld>): string[] {
  const label = `T=${v.T}+${v.horizon}`;
  const out: string[] = [];
  if (v.configDifference !== null) out.push(`${label}: a config row differs after the restore (${v.configDifference})`);
  if (!v.roundTripEqualAtT) out.push(`${label}: the restored world does not re-encode to its own bytes`);
  if (v.hashDivergedAt !== null) out.push(`${label}: the hash diverged at tick ${v.hashDivergedAt}`);
  if (!v.encodingEqualAtEnd) out.push(`${label}: the encodings differ at the end (${v.firstDifference ?? '?'})`);
  if (v.b.carried.length > 0) {
    if (v.b.carriedDiffAtEnd === undefined) out.push(`${label}: the runtime comparison never ran`);
    else if (v.b.carriedDiffAtEnd !== null) out.push(`${label}: the runtime data differs at the end (${v.b.carriedDiffAtEnd})`);
  }
  return out;
}

/**
 * The frame boundaries at which the command queue is NOT empty. In a world with a runtime `step`
 * queues the rally order of a unit it has just delivered AFTER the tick, so on a handful of
 * boundaries (14 in 6,000 ticks of an economy room) a snapshot is cut with a queued command, and
 * the queues are snapshot state. Returned in ascending order, boundary `t` meaning "A at tick
 * `t`, before its inputs": exactly where a cut is taken.
 */
export function queuedBoundaries(spec: WorldSpec, end: number): { command: number[]; runtime: number[] } {
  const w = spec.build();
  const out = { command: [] as number[], runtime: [] as number[] };
  for (let t = 0; t < end; t++) {
    w.driveAt(t);
    w.advanceOnce();
    const self = internals(w.sim);
    if ((self.commandQueue as unknown[]).length > 0) out.command.push(t + 1);
    if ((self.runtimeQueue as unknown[]).length > 0) out.runtime.push(t + 1);
  }
  return out;
}

/**
 * `plan` plus one cut at a boundary whose command queue is non-empty (the first that fits), so a
 * runtime world's matrix always snapshots a queued command at least once. Nothing is moved: the
 * other cuts stay exactly where the plan put them.
 */
export function withQueuedCut(plan: Plan, queued: readonly number[]): Plan {
  const T = queued.find((t) => t > 0 && t + plan.horizon <= plan.end && t !== plan.tailFrom && !plan.Ts.includes(t));
  if (T === undefined) return plan;
  return { ...plan, Ts: [...plan.Ts, T].sort((x, y) => x - y) };
}

/** Plays one world's series: A once, a fork at every cut, the census read at every cut. */
export function runWorld(spec: WorldSpec, opts: RunOptions = {}): WorldRun {
  const started = performance.now();
  const base = spec.build(); // the world at tick 0, for the census
  const wanted = opts.plan ?? spec.plan;
  const plan = base.runtime === null || opts.queuedCut === false ? wanted : withQueuedCut(wanted, queuedBoundaries(spec, wanted.end).command);
  if (plan.Ts.includes(plan.tailFrom)) throw new Error(`snapshot witness: ${spec.id}: tailFrom ${plan.tailFrom} is also a cut`);
  const moved = new Set<string>();
  const readCensus = (a: SnapWorld): void => {
    for (const name of stateRowsMoved(base.sim, a.sim)) moved.add(name);
  };
  let builds = 0;
  const queuedCuts = { command: 0, runtime: 0 };
  const exercisedProblems: string[] = [];
  const verdicts = forkWitnessSeries<SnapWorld>({
    build: () => {
      const w = spec.build();
      if (builds++ === 0) w.isA = true;
      return w;
    },
    drive: (w, t) => w.driveAt(t),
    advance: (w) => {
      w.advanceOnce();
      if (w.isA === true) {
        if (w.sim.tickCount === plan.end) {
          readCensus(w);
          const missing = spec.exercised?.(w) ?? null;
          if (missing !== null) exercisedProblems.push(missing);
        }
      } else if (w.parent !== undefined && w.endsAt === w.sim.tickCount && w.carried.length > 0) {
        w.carriedDiffAtEnd = carriedDiffOf(w, w.parent);
      }
    },
    hash: hashOfWorld,
    hashEvery: 20,
    afterRestore: (b, a) => {
      carryWorld(b, a);
      b.parent = a;
      b.endsAt = a.sim.tickCount === plan.tailFrom ? plan.end : a.sim.tickCount + plan.horizon;
      readCensus(a);
      const self = internals(a.sim);
      if ((self.commandQueue as unknown[]).length > 0) queuedCuts.command++;
      if ((self.runtimeQueue as unknown[]).length > 0) queuedCuts.runtime++;
    },
    poison: true,
    ...(opts.mutate === undefined ? {} : { mutate: opts.mutate }),
    Ts: plan.Ts,
    horizon: plan.horizon,
    tailFrom: plan.tailFrom,
    endTick: plan.end,
  });
  const problems: string[] = [...exercisedProblems];
  const forkProblems: WorldRun['forkProblems'] = [];
  let garbled = 0;
  for (const v of verdicts) {
    const p = problemsOf(v);
    problems.push(...p);
    forkProblems.push({ T: v.T, horizon: v.horizon, problems: p });
    garbled += v.garbledUnkeyedSlots;
  }
  return { id: spec.id, forks: verdicts.length, problems, forkProblems, moved, garbledUnkeyedSlots: garbled, hasRuntime: base.runtime !== null, queuedCuts, wallMs: performance.now() - started };
}

// ---- the coverage census ----------------------------------------------------------------------

const rows = (names: string, reason: string): { readonly name: string; readonly reason: string }[] =>
  names.split(' ').map((name) => ({ name, reason }));

/**
 * `state` rows that no witness world ever moved, and why each is let off. Every entry names the
 * world that would cover it; a row that moves in the current matrix must NOT be listed (the
 * census fails on it: delete the entry). Found by running the matrix, 25 Oct 2026.
 */
export const SNAPSHOT_COVERAGE_EXEMPT: readonly { readonly name: string; readonly reason: string }[] = [
  ...rows(
    'elevation structureCount_ stMaxHp stTypeIdx stCx stCy stMinX stMinY stMaxX stMaxY stTiles structureOfTile stRouteMask ' +
      'stProducesFor tnLength tnOwner tnCapacity tnTravelTicks tnDigRate tnDigger tnVentX tnVentY tunnelCount_ ' +
      'evacX evacY evacSide evacCount aidPosts woundLive veterancy',
    'never moves after build in any witness world (written only by applyTerrain, addStructure, addTunnel, addEvacPoint, addUnitType and spawn at veterancy 0). ' +
      'Their RESTORE is proved in every fork regardless, because B\'s state rows are poisoned before `restoreSim` and a restore that skipped one fails; ' +
      'what is missing is a world in which the row holds a value other than its build value at a cut. Covered dynamically by a world that adds structures ' +
      'or tunnels mid-match (a field-works mission), or one that promotes veterancy and lays a new evacuation point'
  ),
  ...rows(
    'siteAlive siteType siteX siteY siteSide siteStructure buildSite stProgress constructedAt fwLive stOwner stKnown sealGen ' +
      'auraHealRate auraHealCap auraCompAt auraRepairTicks auraAccMult unitAuraLive',
    'field works: construction sites, owned structures, their auras and the fog latch on an owned structure. No witness world builds, owns or auras a structure ' +
      '(versus never uses field works). Covered by a field-works mission world'
  ),
  ...rows('placedLive stChargeTicks stChargeBy', 'placed charges (setPlacedCharge): no witness driver sets one. Covered by a world whose driver places a charge on a structure'),
  ...rows('beamTgt beamDwell beamHeat beamAt beamLock beamLive', 'beam weapons (stepBeam): no unit of any witness world carries one. Covered by a world that fields a beam unit'),
  ...rows('focusTarget focusLost', 'the attack order (right-click focus): no witness driver issues one, only attack-moves. Covered by a mirror world whose driver sends an `attack` order'),
  ...rows('wpX wpY wpAttack wpSweep wpCount', 'queued (shift) waypoints: no witness driver appends an order. Covered by a world whose driver issues appended moves'),
  ...rows('boardGoal', 'embarking onto a transport: no witness driver issues board or air-carrier orders. Covered by a world that loads infantry into a carrier'),
  ...rows('stance ambushRadiusSq patrolX patrolY patrolCount patrolIdx patrolLive patrolLegIds', 'stances (ambush, patrol): no witness driver or placement sets one. Covered by a world whose units patrol or ambush'),
  ...rows('smoke smokeCooldown pendingStrikes', 'abilities reachable only from the player UI (smoke, fire-support strikes): no witness driver calls them. Covered by a world whose driver lays smoke and calls a strike'),
  ...rows('airWant', 'air carriers (GH-698): the air units of the witness worlds are drones, which never take a load or unload order. Covered by an air-carrier world'),
  ...rows(
    'runtimeQueue',
    'runtime commands (build, setRally, cancelBuild) queued through `queueCommand`: every witness driver calls the runtime directly (`requestBuild`), and the golden economy\'s `command` variant ' +
      'drains its queue inside the same drive, so no boundary of any world holds one (scanned at every tick of every runtime world). Covered by a world whose frame queues a `build` command that the cut precedes (a room\'s frame applier)'
  ),
  ...rows('curStructure prStructure', 'a unit or a projectile aimed at a structure: no witness world has a building that is shot at. Covered by a world whose force attacks buildings'),
];

export interface CensusVerdict {
  readonly stateRows: number;
  /** Never moved and not exempt: the witness proves nothing about these rows. */
  readonly uncovered: string[];
  /** Exempt but moved: delete the exemption. */
  readonly staleExemptions: string[];
  /** Exempt but not a `state` row of the schema (or listed twice). */
  readonly badExemptions: string[];
}

export function censusVerdict(moved: ReadonlySet<string>, exempt: readonly { readonly name: string; readonly reason: string }[] = SNAPSHOT_COVERAGE_EXEMPT): CensusVerdict {
  const names = rowsOf('state').map((r) => r.name);
  const known = new Set(names);
  const listed = new Set<string>();
  const bad: string[] = [];
  for (const e of exempt) {
    if (!known.has(e.name)) bad.push(`${e.name} (not a state row)`);
    else if (listed.has(e.name)) bad.push(`${e.name} (listed twice)`);
    else if (e.reason.trim() === '') bad.push(`${e.name} (no reason)`);
    listed.add(e.name);
  }
  return {
    stateRows: names.length,
    uncovered: names.filter((n) => !moved.has(n) && !listed.has(n)),
    staleExemptions: exempt.filter((e) => moved.has(e.name)).map((e) => e.name),
    badExemptions: bad,
  };
}

export function censusFailures(c: CensusVerdict): string[] {
  return [
    ...c.uncovered.map((n) => `census: ${n} never moved in any witness world; cover it or exempt it with a reason`),
    ...c.staleExemptions.map((n) => `census: ${n} is exempt but DID move; delete this exemption`),
    ...c.badExemptions.map((n) => `census: bad exemption ${n}`),
  ];
}

// ---- the self-checks --------------------------------------------------------------------------

export interface SelfCheck {
  readonly name: string;
  readonly spec: WorldSpec;
  readonly plan: Plan;
  /** Builds the mutation. `effective(T)` is true for a cut where the mutation changed something. */
  readonly mutation: (effective: Set<number>) => (b: SnapWorld, a: SnapWorld) => void;
}

/**
 * The three mutations of the spec's section 6.2, each applied to B right after the restore. A
 * mutation that changes nothing at a cut is not evidence, so each records the cuts where it did
 * (and throws if it could not have: the `trail` one asserts A's trail is non-zero first).
 */
export function selfChecks(): SelfCheck[] {
  const eco = ECONOMY_CELLS[0];
  return [
    {
      // The reflection probe saw this leave every hash equal while the runtime's income routes
      // diverged. A restore leaves B's own value in place, which in a world built from one config
      // equals A's, so "reset to B's tick-0 value" would be a no-op; the mutation writes the value
      // a restore that skipped the row would leave a producing structure with: none.
      name: 'stProducesFor reset (economy cell)',
      spec: { id: `economy ${eco.map} ${eco.arr.join('/')} ${eco.seed}`, plan: longPlan(MIRROR_END), build: () => economyWorld(eco.map, eco.arr, eco.seed) },
      plan: { Ts: [97, 1200], horizon: 600, tailFrom: 600, end: 1800 },
      mutation: (effective) => (b) => {
        const col = internals(b.sim).stProducesFor as Int8Array;
        let changed = 0;
        for (let i = 0; i < col.length; i++) {
          if (col[i] >= 0) {
            col[i] = -1;
            changed++;
          }
        }
        if (changed > 0) effective.add(b.sim.tickCount);
      },
    },
    {
      name: 'fieldByGoal emptied (mirror cell)',
      spec: { id: 'mirror tel_marum 1000', plan: longPlan(MIRROR_END), build: () => mirrorWorld('tel_marum', 1000) },
      plan: { Ts: [97, 1200], horizon: 600, tailFrom: 600, end: 1800 },
      mutation: (effective) => (b) => {
        let held = 0;
        for (const m of internals(b.sim).fieldByGoal as Map<number, number>[]) {
          held += m.size;
          m.clear();
        }
        if (held > 0) effective.add(b.sim.tickCount);
      },
    },
    {
      // The brief put this in the tunnels arm. There `trail` is zero at every tick of 24,000 on all
      // three rules-file cells (the versus routes are pre-dug, nothing digs, nothing stamps the
      // trail), so a zeroing there changes nothing: the spec's own "no route was dug" trap.
      // The golden battle digs from tick 0, so its trail is non-zero at the cuts below.
      name: 'trail zeroed (golden battle, which digs)',
      spec: { id: 'golden battle (1000)', plan: goldenPlan(1000), build: goldenBattle },
      plan: { Ts: [200, 300], horizon: 300, tailFrom: 100, end: 800 },
      mutation: (effective) => (b, a) => {
        const aTrail = internals(a.sim).trail as Uint8Array;
        if (!aTrail.some((v) => v !== 0)) return; // nothing to zero here: not evidence, not counted
        (internals(b.sim).trail as Uint8Array).fill(0);
        effective.add(b.sim.tickCount);
      },
    },
  ];
}

export interface SelfCheckResult {
  readonly name: string;
  readonly cleanProblems: string[];
  /** Cuts where the mutation changed something. */
  readonly effectiveCuts: number[];
  /** Cuts where it did and the witness stayed green. */
  readonly missed: number[];
  readonly ok: boolean;
}

export function runSelfCheck(check: SelfCheck): SelfCheckResult {
  const clean = runWorld(check.spec, { plan: check.plan });
  const effective = new Set<number>();
  const mutated = runWorld(check.spec, { plan: check.plan, mutate: check.mutation(effective) });
  const red = new Set(mutated.forkProblems.filter((f) => f.problems.length > 0).map((f) => f.T));
  const cuts = Array.from(effective).sort((x, y) => x - y);
  const missed = cuts.filter((T) => !red.has(T));
  return { name: check.name, cleanProblems: clean.problems, effectiveCuts: cuts, missed, ok: clean.problems.length === 0 && cuts.length > 0 && missed.length === 0 };
}

// ---- the CLI ----------------------------------------------------------------------------------

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

function main(argv: readonly string[]): number {
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
  const wantSelfCheck = argv.includes('--self-check');
  const started = performance.now();
  const failures: string[] = [];
  const moved = new Set<string>();
  let queuedCommandCuts = 0;
  let ranAll = true;
  for (const spec of worldSpecs()) {
    if (only !== undefined && !spec.id.includes(only)) {
      ranAll = false;
      continue;
    }
    const run = runWorld(spec);
    for (const n of run.moved) moved.add(n);
    queuedCommandCuts += run.queuedCuts.command;
    const verdict = run.problems.length === 0 ? 'clean' : `RED (${run.problems.length})`;
    console.log(
      `${spec.id.padEnd(46)} ${String(run.forks).padStart(3)} forks of ${String(spec.plan.horizon).padStart(4)} ticks to ${String(spec.plan.end).padStart(5)}  ` +
        `${String(run.moved.size).padStart(3)} rows moved  ${String(run.garbledUnkeyedSlots).padStart(4)} unkeyed slots poisoned  ${String(run.queuedCuts.command).padStart(2)}/${run.queuedCuts.runtime} queued cuts  ${verdict.padEnd(9)} ${seconds(run.wallMs)}`
    );
    for (const p of run.problems.slice(0, 5)) console.log(`    ${p}`);
    for (const p of run.problems) failures.push(`${spec.id}: ${p}`);
    // A runtime world's frames end with a queued rally order now and then; the queues are state, so each such world must have been cut at one.
    if (run.hasRuntime && run.queuedCuts.command === 0) {
      failures.push(`${spec.id}: no fork was cut with a non-empty commandQueue`);
      console.log(`    ${spec.id}: no fork was cut with a non-empty commandQueue`);
    }
  }
  const matrixMs = performance.now() - started;
  console.log(`matrix: ${seconds(matrixMs)}`);

  if (ranAll) {
    // The queues are snapshot state: a matrix that never cuts with a command queued proves nothing about them.
    const queued = `${queuedCommandCuts} fork(s) of the matrix were cut with a non-empty commandQueue`;
    console.log(`queued cuts: ${queued}`);
    if (queuedCommandCuts === 0) failures.push(`queued cuts: ${queued}; a runtime world must snapshot a queued command at least once`);
    const census = censusVerdict(moved);
    console.log(`census: ${census.stateRows} state rows, ${moved.size} moved, ${SNAPSHOT_COVERAGE_EXEMPT.length} exempt`);
    const byReason = new Map<string, string[]>();
    for (const e of SNAPSHOT_COVERAGE_EXEMPT) byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e.name]);
    for (const [reason, names] of byReason) console.log(`    exempt ${names.length}: ${names.join(' ')}\n      because ${reason}`);
    for (const f of censusFailures(census)) {
      console.log(`    ${f}`);
      failures.push(f);
    }
  } else {
    const partial = censusVerdict(moved, []);
    console.log(`census: not judged (--only runs part of the matrix); ${partial.uncovered.length} of ${partial.stateRows} state rows did not move here:`);
    console.log(`    ${partial.uncovered.join(' ')}`);
  }

  if (wantSelfCheck) {
    const t0 = performance.now();
    for (const check of selfChecks()) {
      const r = runSelfCheck(check);
      const how = r.ok
        ? `RED as required at ${r.effectiveCuts.join(', ')} (clean control green)`
        : `NOT RED: effective at [${r.effectiveCuts.join(', ')}], missed [${r.missed.join(', ')}], clean problems ${r.cleanProblems.length}`;
      console.log(`self-check ${check.name}: ${how}`);
      if (!r.ok) failures.push(`self-check ${check.name}: ${how}`);
    }
    console.log(`self-checks: ${seconds(performance.now() - t0)}`);
  }

  console.log(`total: ${seconds(performance.now() - started)}`);
  if (failures.length > 0) {
    console.log(`FAILED (${failures.length})`);
    return 1;
  }
  console.log('OK');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
