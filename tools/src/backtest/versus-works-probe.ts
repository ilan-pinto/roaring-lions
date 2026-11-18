// The versus field-works probe (the lead's 18 Nov ask, "bring outposts to free play / versus", versus half):
// what happens to a KDF-against-Sarim economy room if both seats may raise field works?
//
// REPORT-ONLY, and IN MEMORY ONLY. Field works stay dropped in every versus room (`validateCommand`,
// packages/net/src/ownership.ts; `MissionRuntime.applyQueued` takes `raiseWorks` from side 0 alone), and this file
// changes neither rule. It builds its own world: a room's economy world (`buildMatchWorld` of `roomConfig`, exactly
// the economy arm of `versus-probe.ts`) with three things laid over it for the length of one game, every one of them
// put back afterwards whatever the game does (`withWorksOverrides`):
//   1. the KDF runtime is handed a `field_works` list, the campaign's own five (`KDF_WORKS`, one of each), which a
//      versus mission never carries (`versusMissionOf`). The KDF raises them through the runtime's own
//      `requestConstruct`, the very path a `raiseWorks` command takes in a mission: its price, its count, its line cap;
//   2. the four militia works (`militia_*`, owner 1, placed by mission authors as targets and NEVER buildable,
//      GH-277) are given, in memory, the `buildable` block of their KDF counterpart (price, build time, footprint:
//      `MILITIA_MIRROR`). There is no militia production work, so Sarim has no forward camp;
//   3. Sarim has no unit with `construct`, so its rifle section (`sarim_rifles`) is given `construct` in memory, at
//      the D9's `construct_rate`, so a mirrored work takes the same seconds to raise on either side.
// The runtime prices works for side 0 only (`requestConstruct` charges `purse[0]`), so the Sarim seat pays through
// `chargeLogistics`, one narrow write to the runtime's private purse, checked against `logisticsOf` on every call
// (a wrong unit size throws), and queues the sim's own `construct` with its builder. The sim's construction is the
// same for both sides (`applyConstruct`: the site is the builder's side, the structure its owner).
//
// THE PLAY. Everything the economy arm does, unchanged: the doctrine-mix production plan (`planRound`), the
// re-order every 20 s (`order`), the medic arm at its default (`RESCUE_BUY_DEFAULT`), the room's outcome rule
// (`outcomeOf` with `productionOf`), the 10-minute cap, the seeds (`seedOf`). On top, the WORKS POLICY, both seats
// alike, reading nothing of the other side (`WORKS_SCHEDULE`): each step falls due at a fixed second; at the
// first production round at or after it, BEFORE the round's unit purchases, the side raises it if its purse covers
// the price and its builder is free, else it holds the price back from the unit purchases (`planRound`'s
// `extraHold`) until it can. One builder, one site at a time, in schedule order:
//   0 s   outpost / firing position   4 tiles in front of the camp, toward the enemy anchor; garrisoned on completion
//         by one infantry unit (KDF: the nearest `inf_squad`; Sarim: the nearest `atgm_cell`), held out of the march
//   0 s   medic station / field clinic   3 tiles behind the camp
//   60 s  workshop / weapons workshop     3 tiles behind the camp
//   120 s intel centre / observation post at the centre of the side's nearest income zone
//   180 s forward camp (KDF only)        at the centre of the side's nearest income zone
// A site is the legal footprint (the sim's `placementReason`, and for the KDF the runtime's whole `constructReason`)
// nearest the target, never within a tile of either camp (its exit and delivery stay clear). The builder (KDF: the
// placed `dozer_d9`; Sarim: the first placed `sarim_rifles`) is held out of the march until every step is done or
// given up; a dead builder gives up the rest.
//
// THE ARMS. `off` is the economy arm's own game (`play(..., { economy: true })` from `versus-probe.ts`, not a copy);
// `on` the works policy with all five KDF works and four militia works; `no-forward` the same without the forward
// camp, so its share of `on` reads apart. Same seeds, so each arm is read against `off` seed for seed.
//
// THE SELF-CHECK (exit 2), per map, before any table: (a) the `none` arm -- every override and the field-works list
// laid on, no work ever bought -- reads seed for seed the `off` game (the overrides alone are inert, and this file's
// loop is the economy arm's); (b) the `on` arm completes at least one work for EACH faction; (c) one seed twice is
// one game. Seen red: see the commit message.
//
//   pnpm versus:works-probe                                  the three economy maps, both spawn orders, 48 seeds, all arms
//   pnpm versus:works-probe -- --maps=wadi_tarfan --seeds=12 --arms=off,on
//   flags: --maps=<id,id>  --arr=<kdf/sarim,sarim/kdf>  --seeds=<n>  --seed-from=<n>  --cap=<seconds>  --arms=<off,on,no-forward>
//
// It writes nothing: no file, no shipped object left changed (`versus-works-probe.test.ts` holds both).

import { fileURLToPath } from 'node:url';
import { doctrines, structures, units, versusRules, versusZonesOf, type MapId, type VersusRulesJson } from '@lions/data';
import { FACTION_MATCHUP_MAPS, matchCapTicks, type SpawnEnd } from '@lions/net';
import type { SimEvent } from '@lions/sim';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { outcomeOf, productionOf, unitCost, type MatchResult, type OutcomeProduction } from '../../../packages/app/src/net/outcome';
import {
  CAP_TICKS_DEFAULT,
  DECIDE_EVERY_TICKS,
  FAIR_MAX_PERCENT,
  ORDER_EVERY_TICKS,
  RESCUE_BUY_DEFAULT,
  SEEDS_DEFAULT,
  cellName,
  finish,
  forceMixOf,
  layoutOf,
  marchersOf,
  order,
  parseArrangements,
  planRound,
  play,
  reading,
  rescueRound,
  roomConfig,
  seedOf,
  tally,
  type Arrangement,
  type Played,
} from './versus-probe';

const TICKS_PER_SECOND = 20;

// ---------------------------------------------------------------------------
// The works, and the in-memory overrides
// ---------------------------------------------------------------------------

/** The KDF field works the probe lists, one of each: the five the campaign ships (GH-277; `kdf_aid_post` is buildable
 *  but listed by no mission, so it is left out). */
export const KDF_WORKS: readonly string[] = ['kdf_outpost', 'kdf_medic_station', 'kdf_workshop', 'kdf_intel_centre', 'kdf_forward_camp'];

/** Each militia work and the KDF work whose `buildable` block it borrows, in memory, for the probe. */
export const MILITIA_MIRROR: Readonly<Record<string, string>> = {
  militia_firing_position: 'kdf_outpost',
  militia_field_clinic: 'kdf_medic_station',
  militia_weapons_workshop: 'kdf_workshop',
  militia_observation_post: 'kdf_intel_centre',
};

/** The Sarim unit given `construct` in memory, and the KDF unit whose `construct_rate` it borrows. */
export const SARIM_BUILDER = 'sarim_rifles';
export const KDF_BUILDER = 'dozer_d9';

/** Where a step's site is sought. */
export type WorksSite = 'camp-front' | 'camp-rear' | 'zone';

export interface WorkStep {
  kdf: string;
  /** The militia mirror, or null where Sarim has none (the forward camp). */
  sarim: string | null;
  dueS: number;
  at: WorksSite;
  /** Garrisoned by one infantry unit on completion. */
  garrison?: true;
}

/** The fixed early schedule, both seats alike (see the header). */
export const WORKS_SCHEDULE: readonly WorkStep[] = [
  { kdf: 'kdf_outpost', sarim: 'militia_firing_position', dueS: 0, at: 'camp-front', garrison: true },
  { kdf: 'kdf_medic_station', sarim: 'militia_field_clinic', dueS: 0, at: 'camp-rear' },
  { kdf: 'kdf_workshop', sarim: 'militia_weapons_workshop', dueS: 60, at: 'camp-rear' },
  { kdf: 'kdf_intel_centre', sarim: 'militia_observation_post', dueS: 120, at: 'zone' },
  { kdf: 'kdf_forward_camp', sarim: null, dueS: 180, at: 'zone' },
];

/** The probe's arms: `off` is the economy arm's own game; `none` is the works world with nothing bought (the
 *  self-check's inert control); `on` all works; `no-forward` all but the KDF forward camp. */
export type WorksArm = 'off' | 'none' | 'on' | 'no-forward';
export const REPORT_ARMS: readonly WorksArm[] = ['off', 'on', 'no-forward'];

type Json = Record<string, unknown>;

/**
 * Runs `fn` with the militia works made buildable (their KDF counterpart's `buildable` block) and the Sarim rifle
 * section able to construct (at the D9's rate), IN MEMORY, and puts the shipped objects back afterwards, whatever
 * `fn` does. Nothing is written to disk.
 */
export function withWorksOverrides<T>(fn: () => T): T {
  const st = structures as unknown as Record<string, Json>;
  const us = units as unknown as Record<string, Json>;
  const saved: Record<string, Json> = {};
  for (const id of Object.keys(MILITIA_MIRROR)) saved[id] = st[id];
  const savedBuilder = us[SARIM_BUILDER];
  try {
    for (const [id, kdf] of Object.entries(MILITIA_MIRROR)) {
      const b = st[kdf]?.buildable;
      if (b === undefined) throw new Error(`works probe: ${kdf} has no buildable block to mirror`);
      if (st[id] === undefined) throw new Error(`works probe: no structure type ${id}`);
      st[id] = { ...st[id], buildable: b };
    }
    const rate = (us[KDF_BUILDER] as { construct_rate?: number } | undefined)?.construct_rate;
    if (rate === undefined) throw new Error(`works probe: ${KDF_BUILDER} has no construct_rate`);
    const abilities = (savedBuilder.abilities as readonly string[] | undefined) ?? [];
    us[SARIM_BUILDER] = { ...savedBuilder, abilities: [...abilities, 'construct'], construct_rate: rate };
    return fn();
  } finally {
    for (const id of Object.keys(saved)) st[id] = saved[id];
    us[SARIM_BUILDER] = savedBuilder;
  }
}

/** `MissionRuntime`'s purse unit (`PURSE_UNITS`, packages/sim/src/mission.ts, private): COPIED, and checked on every
 *  write by `chargeLogistics`, so a drift throws instead of mispricing. */
const PURSE_UNITS_COPY = 2400;

type Runtime = NonNullable<MatchWorld['runtime']>;

/** Take `logistics` from `side`'s purse (negative gives it back). The runtime prices works for side 0 only, so the
 *  probe's Sarim seat pays here: one write to the private purse, read back through `logisticsOf`. */
export function chargeLogistics(runtime: Runtime, side: 0 | 1, logistics: number): void {
  const before = runtime.logisticsOf(side);
  const purse = (runtime as unknown as { purse?: number[] }).purse;
  if (purse === undefined || typeof purse[side] !== 'number') throw new Error('works probe: the runtime has no purse to charge (renamed?)');
  purse[side] -= logistics * PURSE_UNITS_COPY;
  if (runtime.logisticsOf(side) !== before - logistics) throw new Error(`works probe: charging ${logistics} moved side ${side}'s purse from ${before} to ${runtime.logisticsOf(side)} (PURSE_UNITS changed?)`);
}

/** Hand the KDF runtime its `field_works` list. A versus mission carries none and the runtime reads the list on first
 *  ask (`works()`), so it is laid on the runtime's own mission object before anything asks; the offers are then read
 *  back, and a list that did not take (an earlier read cached an empty one) throws. */
export function listKdfWorks(runtime: Runtime, ids: readonly string[]): void {
  const m = (runtime as unknown as { mission?: { field_works?: Record<string, number> } }).mission;
  if (m === undefined) throw new Error('works probe: the runtime has no mission (renamed?)');
  m.field_works = Object.fromEntries(ids.map((id) => [id, 1]));
  const offered = runtime.worksOffers().map((o) => o.typeId);
  if (offered.length !== ids.length || ids.some((id) => !offered.includes(id))) throw new Error(`works probe: the runtime offers [${offered.join(', ')}], expected [${ids.join(', ')}]`);
}

// ---------------------------------------------------------------------------
// The works policy, one game
// ---------------------------------------------------------------------------

type Status = 'waiting' | 'requested' | 'building' | 'done' | 'given-up';

interface StepState {
  type: string;
  structType: number;
  price: number;
  dueTick: number;
  at: WorksSite;
  garrison: boolean;
  status: Status;
  x: number;
  y: number;
  site: number;
  structure: number;
  requestedTick: number;
  completeTick: number;
  lostTick: number;
  tries: number;
}

interface SideState {
  side: 0 | 1;
  kdf: boolean;
  builder: number;
  steps: StepState[];
  camp: { x: number; y: number; w: number; h: number };
  enemyAnchor: readonly [number, number];
  zoneTarget: readonly [number, number] | null;
  garrisons: Map<number, { structure: number; since: number }>;
}

/** One work's record in a game, by faction. */
export interface WorkRead {
  type: string;
  /** Tick the side asked for it, -1 never. */
  requested: number;
  /** Tick it completed, -1 never. */
  complete: number;
  /** Tick it was destroyed (built or under construction), -1 never. */
  lost: number;
}

/** A works game: the economy read plus each faction's works (`[kdf, sarim]`). */
export interface WorksPlayed extends Played {
  works: [WorkRead[], WorkRead[]];
}

const GIVE_UP_TICKS = 180 * TICKS_PER_SECOND;
const GARRISON_PATIENCE_TICKS = 60 * TICKS_PER_SECOND;
const MAX_TRIES = 3;
const SEARCH_RADIUS = 10;

export class WorksPlan {
  private readonly sides: SideState[] = [];
  private readonly w: MatchWorld;
  private readonly runtime: Runtime;

  constructor(w: MatchWorld, rules: VersusRulesJson, arm: Exclude<WorksArm, 'off'>, structTypeOf: (id: string) => number) {
    this.w = w;
    if (w.runtime === null) throw new Error('works probe: no economy runtime');
    this.runtime = w.runtime;
    const zones = versusZonesOf(rules, w.map.zones);
    for (const side of [0, 1] as const) {
      const kdf = w.factions[side] === 'kdf';
      const end: SpawnEnd = w.endOfSide[side];
      const other: SpawnEnd = w.endOfSide[side === 0 ? 1 : 0];
      const c = rules.ends[end].camp;
      const camp = { x: c.at[0], y: c.at[1], w: c.size[0], h: c.size[1] };
      const unit = kdf ? KDF_BUILDER : SARIM_BUILDER;
      const builder = w.bySide[side].find((id) => w.sim.unitTypes[w.sim.state.typeIdx[id]]?.id === unit) ?? -1;
      if (builder < 0) throw new Error(`works probe: side ${side} fields no ${unit}`);
      const cx = camp.x + camp.w / 2;
      const cy = camp.y + camp.h / 2;
      let zoneTarget: [number, number] | null = null;
      let best = Infinity;
      for (const z of rules.income_zones) {
        const r = zones[z.zone];
        if (r === undefined || r.length < 4) continue;
        const zx = r[0] + r[2] / 2;
        const zy = r[1] + r[3] / 2;
        const d = (zx - cx) ** 2 + (zy - cy) ** 2;
        if (d < best) {
          best = d;
          zoneTarget = [zx, zy];
        }
      }
      const steps: StepState[] = [];
      if (arm !== 'none') {
        for (const s of WORKS_SCHEDULE) {
          const type = kdf ? s.kdf : s.sarim;
          if (type === null) continue;
          if (arm === 'no-forward' && type === 'kdf_forward_camp') continue;
          const structType = structTypeOf(type);
          const b = w.sim.structureTypes[structType]?.buildable;
          if (b === null || b === undefined) throw new Error(`works probe: ${type} is not buildable in this world`);
          steps.push({ type, structType, price: b.costLogistics, dueTick: s.dueS * TICKS_PER_SECOND, at: s.at, garrison: s.garrison === true, status: 'waiting', x: -1, y: -1, site: -1, structure: -1, requestedTick: -1, completeTick: -1, lostTick: -1, tries: 0 });
        }
      }
      this.sides.push({ side, kdf, builder, steps, camp, enemyAnchor: w.anchors[other], zoneTarget, garrisons: new Map() });
    }
  }

  /** Whether `id` is kept out of the attack-move: a builder with work left, or a garrison on its post. */
  holds(id: number): boolean {
    for (const s of this.sides) {
      if (id === s.builder && s.steps.some((st) => st.status !== 'done' && st.status !== 'given-up')) return true;
      if (s.garrisons.has(id)) return true;
    }
    return false;
  }

  /**
   * One side's works at a production round (before its unit purchases). Returns the logistics the unit purchases
   * must leave in the purse: the price of the first due step not yet raised, while one is due.
   */
  round(tick: number, side: 0 | 1): number {
    const s = this.sides[side];
    const sim = this.w.sim;
    // Garrisons that never got in (or whose post is gone) go back to the march.
    for (const [id, g] of s.garrisons) {
      const inside = sim.state.alive[id] === 1 && sim.state.garrisonedIn[id] === g.structure;
      if (sim.state.alive[id] !== 1 || (!inside && tick - g.since > GARRISON_PATIENCE_TICKS)) s.garrisons.delete(id);
    }
    if (sim.state.alive[s.builder] !== 1) {
      for (const st of s.steps) if (st.status === 'waiting' || st.status === 'requested') st.status = 'given-up';
    }
    for (const st of s.steps) {
      if (st.status === 'building' && st.requestedTick >= 0 && tick - st.requestedTick > GIVE_UP_TICKS) st.status = 'given-up';
    }
    if (s.steps.some((st) => st.status === 'requested' || st.status === 'building')) return this.dueHold(s, tick);
    const next = s.steps.find((st) => st.status === 'waiting');
    if (next === undefined || next.dueTick > tick) return 0;
    if (this.runtime.logisticsOf(side) < next.price) return next.price;
    const at = this.siteFor(s, next);
    if (at === null) {
      next.status = 'given-up';
      return 0;
    }
    next.x = at[0];
    next.y = at[1];
    next.tries++;
    if (s.kdf) {
      if (!this.runtime.requestConstruct(next.type, at[0], at[1], [s.builder])) {
        if (next.tries >= MAX_TRIES) next.status = 'given-up';
        return next.price;
      }
    } else {
      chargeLogistics(this.runtime, side, next.price);
      sim.queueCommand({ kind: 'construct', ids: [s.builder], structType: next.structType, x: at[0], y: at[1] });
    }
    next.status = 'requested';
    next.requestedTick = tick;
    return this.dueHold(s, tick);
  }

  /** The price of the first due step still waiting, or 0. */
  private dueHold(s: SideState, tick: number): number {
    const next = s.steps.find((st) => st.status === 'waiting');
    return next !== undefined && next.dueTick <= tick ? next.price : 0;
  }

  /** The legal footprint origin nearest the step's target, never within a tile of either camp. */
  private siteFor(s: SideState, st: StepState): [number, number] | null {
    const sim = this.w.sim;
    const b = sim.structureTypes[st.structType].buildable;
    if (b === null) return null;
    const cx = s.camp.x + s.camp.w / 2;
    const cy = s.camp.y + s.camp.h / 2;
    let tx: number;
    let ty: number;
    if (st.at === 'zone' && s.zoneTarget !== null) {
      [tx, ty] = s.zoneTarget;
    } else {
      const dx = s.enemyAnchor[0] - cx;
      const dy = s.enemyAnchor[1] - cy;
      const len = Math.hypot(dx, dy) || 1;
      const k = st.at === 'camp-front' ? 4 : -3;
      tx = cx + (dx / len) * k;
      ty = cy + (dy / len) * k;
    }
    const cands: [number, number, number][] = [];
    const camps = this.sides.map((o) => o.camp);
    for (let y = Math.floor(ty - SEARCH_RADIUS); y <= Math.ceil(ty + SEARCH_RADIUS); y++) {
      for (let x = Math.floor(tx - SEARCH_RADIUS); x <= Math.ceil(tx + SEARCH_RADIUS); x++) {
        if (x < 0 || y < 0 || x + b.fw > sim.width || y + b.fh > sim.height) continue;
        const d = (x + b.fw / 2 - tx) ** 2 + (y + b.fh / 2 - ty) ** 2;
        if (d > SEARCH_RADIUS * SEARCH_RADIUS) continue;
        // Keep a one-tile ring round each camp clear: its exit and the line's delivery stay open.
        if (camps.some((c) => x <= c.x + c.w && x + b.fw >= c.x && y <= c.y + c.h && y + b.fh >= c.y)) continue;
        cands.push([d, y, x]);
      }
    }
    cands.sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]);
    for (const [, y, x] of cands) {
      if (sim.placementReason(st.structType, x, y, s.side) !== null) continue;
      if (s.kdf && this.runtime.constructReason(st.type, x, y, [s.builder]) !== null) continue;
      return [x, y];
    }
    return null;
  }

  /** After each tick: the sim's answers. */
  after(ev: readonly SimEvent[], tick: number): void {
    const sim = this.w.sim;
    for (const e of ev) {
      if (e.kind === 'constructQueued') {
        const st = this.find((x) => x.status === 'requested' && x.structType === e.structType && x.x === e.x && x.y === e.y);
        if (st !== null) {
          st.s.status = 'building';
          st.s.site = e.site;
        }
      } else if (e.kind === 'constructRefused') {
        const st = this.find((x) => x.status === 'requested' && x.structType === e.structType && x.x === e.x && x.y === e.y);
        if (st === null) continue;
        // The KDF runtime refunds its own; the Sarim seat's charge was this file's.
        if (!this.sides[st.side].kdf) chargeLogistics(this.runtime, st.side, -st.s.price);
        st.s.status = st.s.tries >= MAX_TRIES ? 'given-up' : 'waiting';
      } else if (e.kind === 'constructStaked') {
        const st = this.find((x) => x.status === 'building' && x.site === e.site);
        if (st !== null) st.s.structure = e.structure;
      } else if (e.kind === 'structureComplete') {
        const st = this.find((x) => x.status === 'building' && x.site === e.site);
        if (st === null) continue;
        st.s.status = 'done';
        st.s.completeTick = tick;
        st.s.structure = e.structure;
        if (st.s.garrison) this.garrison(this.sides[st.side], e.structure, tick);
      } else if (e.kind === 'structureDestroyed') {
        const st = this.find((x) => x.structure === e.structure && x.lostTick < 0);
        if (st === null) continue;
        st.s.lostTick = tick;
        if (st.s.status === 'building') st.s.status = 'given-up';
        for (const [id, g] of this.sides[st.side].garrisons) if (g.structure === e.structure) this.sides[st.side].garrisons.delete(id);
      }
    }
    void sim;
  }

  private find(pred: (s: StepState) => boolean): { side: 0 | 1; s: StepState } | null {
    for (const side of this.sides) for (const s of side.steps) if (pred(s)) return { side: side.side, s };
    return null;
  }

  /** Put the nearest living infantry unit of the post's kind into it (KDF `inf_squad`, Sarim `atgm_cell`). */
  private garrison(s: SideState, structure: number, tick: number): void {
    const sim = this.w.sim;
    const want = s.kdf ? 'inf_squad' : 'atgm_cell';
    const [px, py] = [s.camp.x, s.camp.y];
    let best = -1;
    let bestD = 0;
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.alive[i] !== 1 || sim.state.side[i] !== s.side || i === s.builder || s.garrisons.has(i)) continue;
      if (sim.unitTypes[sim.state.typeIdx[i]]?.id !== want || sim.isDown(i)) continue;
      const d = (sim.state.posX[i] / 65536 - px) ** 2 + (sim.state.posY[i] / 65536 - py) ** 2;
      if (best < 0 || d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best < 0) return;
    sim.queueCommand({ kind: 'garrison', ids: [best], structure });
    s.garrisons.set(best, { structure, since: tick });
  }

  /** Each faction's works (`[kdf, sarim]`). */
  read(): [WorkRead[], WorkRead[]] {
    const of = (s: SideState): WorkRead[] => s.steps.map((st) => ({ type: st.type, requested: st.requestedTick, complete: st.completeTick, lost: st.lostTick }));
    const k = this.sides.find((s) => s.kdf);
    const r = this.sides.find((s) => !s.kdf);
    if (k === undefined || r === undefined) throw new Error('works probe: a works game is KDF against Sarim');
    return [of(k), of(r)];
  }
}

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

export interface WorksOptions {
  capTicks?: number;
}

/** One game of `arm`. `off` is the economy arm's own (`play`), with no works read. */
export function playWorks(mapId: MapId, arrangement: Arrangement, seed: number, arm: WorksArm, opts: WorksOptions = {}): WorksPlayed {
  if (arrangement[0] === arrangement[1]) throw new Error('works probe: a KDF-against-Sarim cell only (a mirror room has no economy)');
  if (arm === 'off') return { ...play(mapId, arrangement, seed, { economy: true, capTicks: opts.capTicks }), works: [[], []] };
  return withWorksOverrides(() => playWorksWorld(mapId, arrangement, seed, arm, opts));
}

function playWorksWorld(mapId: MapId, arrangement: Arrangement, seed: number, arm: Exclude<WorksArm, 'off'>, opts: WorksOptions): WorksPlayed {
  const capTicks = opts.capTicks ?? CAP_TICKS_DEFAULT;
  const roomCap = matchCapTicks(mapId);
  const rules = versusRules[mapId];
  if (rules === undefined) throw new Error(`works probe: ${mapId} has no versus rules file`);
  const w = buildMatchWorld(roomConfig(mapId, arrangement, seed));
  const runtime = w.runtime;
  if (runtime === null) throw new Error(`works probe: ${mapId} built no economy runtime`);
  const structIdx = (id: string): number => {
    const k = w.sim.structureTypes.findIndex((t) => t.id === id);
    if (k < 0) throw new Error(`works probe: no structure type ${id} in the world`);
    return k;
  };
  listKdfWorks(runtime, KDF_WORKS);
  const plan = new WorksPlan(w, rules, arm, structIdx);
  const production: OutcomeProduction | undefined = productionOf(w);
  const { sideOfEnd } = layoutOf(arrangement);
  for (const side of [0, 1] as const) {
    const [ax, ay] = w.anchors[w.endOfSide[side]];
    if (!runtime.setRally(0, ax * 65536, ay * 65536, side)) throw new Error(`works probe: ${mapId} side ${side} refused a rally on its own anchor`);
  }
  const menus = [doctrines[w.factions[0]].menu, doctrines[w.factions[1]].menu] as const;
  const mixes = [forceMixOf(w.factions[0]), forceMixOf(w.factions[1])] as const;
  const builtBySide: [number, number] = [0, 0];
  const rescueBuy = RESCUE_BUY_DEFAULT;
  const read = (o: MatchResult): WorksPlayed => {
    const kdf = w.factions[0] === 'kdf' ? 0 : 1;
    const sarim = kdf === 0 ? 1 : 0;
    return {
      ...finish(o, w.sim.tickCount, sideOfEnd),
      econ: { built: [builtBySide[kdf], builtBySide[sarim]], purse: [runtime.logisticsOf(kdf), runtime.logisticsOf(sarim)] },
      works: plan.read(),
    };
  };
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) {
      for (const side of sideOfEnd) {
        const hold = plan.round(t, side);
        planRound(runtime, w.sim, menus[side], mixes[side], side, rescueBuy, hold);
      }
      order(w.sim, (side) => marchersOf(w.sim, side, (id) => plan.holds(id)), sideOfEnd);
    }
    if (t % DECIDE_EVERY_TICKS === 0) for (const side of sideOfEnd) rescueRound(w.sim, side, w.anchors[w.endOfSide[side]]);
    const ev = matchTick(w);
    plan.after(ev.sim, w.sim.tickCount);
    for (const e of ev.mission) if (e.kind === 'built') builtBySide[e.side]++;
    if (w.sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(w.sim, w.sim.tickCount, unitCost, production, roomCap);
      if (o.kind !== 'ongoing') return read(o);
    }
  }
  const o = outcomeOf(w.sim, roomCap, unitCost, production, roomCap);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a game ongoing');
  return read(o);
}

/** Works a game completed, by faction. */
export const worksBuilt = (g: WorksPlayed): [number, number] => [g.works[0].filter((x) => x.complete >= 0).length, g.works[1].filter((x) => x.complete >= 0).length];

// ---------------------------------------------------------------------------
// The self-check
// ---------------------------------------------------------------------------

export type WorksPlayFn = typeof playWorks;

/** The controls on one map (see the header); each failure is a sentence. */
export function worksSelfCheck(mapId: MapId, playFn: WorksPlayFn = playWorks, seeds = 2, opts: WorksOptions = {}): string[] {
  const failures: string[] = [];
  const arr: Arrangement = ['kdf', 'sarim'];
  for (let n = 0; n < seeds; n++) {
    const seed = seedOf(n);
    const off = playFn(mapId, arr, seed, 'off', opts);
    const none = playFn(mapId, arr, seed, 'none', opts);
    if (off.winner !== none.winner || off.by !== none.by || off.ticks !== none.ticks) {
      failures.push(`${mapId}: the works world with nothing bought should play the economy game; seed ${seed} read ${String(off.winner)}/${off.by}/${off.ticks} off and ${String(none.winner)}/${none.by}/${none.ticks} none`);
    }
    const nb = worksBuilt(none);
    if (nb[0] !== 0 || nb[1] !== 0) failures.push(`${mapId}: the none arm built works (KDF ${nb[0]}, Sarim ${nb[1]})`);
  }
  const a = playFn(mapId, arr, seedOf(0), 'on', opts);
  const b = playFn(mapId, arr, seedOf(0), 'on', opts);
  if (a.winner !== b.winner || a.by !== b.by || a.ticks !== b.ticks || JSON.stringify(a.works) !== JSON.stringify(b.works)) {
    failures.push(`${mapId}: one seed played twice read two games`);
  }
  const built = worksBuilt(a);
  if (built[0] < 1 || built[1] < 1) failures.push(`${mapId}: the on arm should complete at least one work per faction; read KDF ${built[0]}, Sarim ${built[1]}`);
  return failures;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const flag = (args: readonly string[], name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const sec = (ticks: number): string => (ticks / TICKS_PER_SECOND).toFixed(0);

/** The win counts by FACTION `[kdf, sarim]` of a cell's games. */
function factionWins(arr: Arrangement, games: readonly Played[]): [number, number] {
  return reading(arr, tally(games)).wins;
}

/** Prints the report and returns the exit code: 0 for any reading, 2 when the self-check fails. */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  const mapIds = (flag(args, 'maps')?.split(',') ?? Object.keys(versusRules).filter((id) => FACTION_MATCHUP_MAPS.includes(id))) as MapId[];
  for (const id of mapIds) if (!Object.hasOwn(versusRules, id)) throw new Error(`--maps: "${id}" has no versus rules file`);
  const arrangements = parseArrangements(flag(args, 'arr') ?? 'kdf/sarim,sarim/kdf');
  if (arrangements.some(([a, b]) => a === b)) throw new Error('--arr: KDF-against-Sarim cells only');
  const seeds = Number(flag(args, 'seeds') ?? SEEDS_DEFAULT);
  const seedFrom = Number(flag(args, 'seed-from') ?? 0);
  if (!Number.isInteger(seeds) || seeds < 1 || !Number.isInteger(seedFrom) || seedFrom < 0) throw new Error('--seeds / --seed-from must be whole numbers');
  const capTicks = Math.round(Number(flag(args, 'cap') ?? CAP_TICKS_DEFAULT / TICKS_PER_SECOND) * TICKS_PER_SECOND);
  const arms = (flag(args, 'arms')?.split(',') ?? [...REPORT_ARMS]) as WorksArm[];
  for (const a of arms) if (!REPORT_ARMS.includes(a)) throw new Error(`--arms: "${a}" is not off, on or no-forward`);
  if (!arms.includes('off')) arms.unshift('off');

  const failures = mapIds.flatMap((m) => worksSelfCheck(m, playWorks, 2, { capTicks }));
  if (failures.length > 0) {
    console.error('works probe self-check FAILED:');
    for (const f of failures) console.error(`  ${f}`);
    return 2;
  }
  console.log(`versus field-works probe: report only, in memory; seeds ${seedFrom}..${seedFrom + seeds - 1} (seedOf), cap ${sec(capTicks)} s, bar ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT}`);
  console.log('self-check passed: the none arm reads the economy game seed for seed; the on arm builds for both factions; one seed twice is one game');
  console.log('');
  const outcome: string[] = [];
  const timing: string[] = [];
  outcome.push(`${pad('map', 15)}${pad('cell', 16)}${pad('arm', 11)}${pad('KDF', 5)}${pad('Sarim', 6)}${pad('draw', 5)}${pad('leader', 14)}${pad('bar', 9)}${pad('cap', 5)}${pad('stale', 6)}${pad('mean s', 7)}${pad('works/g K', 10)}${pad('works/g S', 10)}${pad('flips', 6)}dKDF dCap`);
  timing.push(`${pad('map', 15)}${pad('cell', 16)}${pad('arm', 11)}${pad('work', 26)}${pad('built', 8)}${pad('mean done s', 12)}${pad('first', 7)}${pad('last', 7)}lost`);
  for (const mapId of mapIds) {
    for (const arr of arrangements) {
      const byArm = new Map<WorksArm, WorksPlayed[]>();
      for (const arm of arms) {
        const games: WorksPlayed[] = [];
        for (let n = seedFrom; n < seedFrom + seeds; n++) games.push(playWorks(mapId, arr, seedOf(n), arm, { capTicks }));
        byArm.set(arm, games);
      }
      const off = byArm.get('off') ?? [];
      const offW = factionWins(arr, off);
      const offCap = off.filter((g) => g.by === 'cap').length;
      for (const arm of arms) {
        const games = byArm.get(arm) ?? [];
        const t = tally(games);
        const rd = reading(arr, t);
        const wins = rd.wins;
        const cap = t.by.cap;
        const flips = arm === 'off' ? 0 : games.filter((g, k) => g.winner !== off[k].winner).length;
        const built = games.reduce((acc, g) => { const b = worksBuilt(g); return [acc[0] + b[0], acc[1] + b[1]] as [number, number]; }, [0, 0] as [number, number]);
        const lean = rd.leader === null ? 'level' : `${rd.leader} ${rd.leaderPercent}%`;
        const delta = arm === 'off' ? '' : `${wins[0] - offW[0] >= 0 ? '+' : ''}${wins[0] - offW[0]} ${cap - offCap >= 0 ? '+' : ''}${cap - offCap}`;
        outcome.push(`${pad(mapId, 15)}${pad(cellName(arr), 16)}${pad(arm, 11)}${pad(wins[0], 5)}${pad(wins[1], 6)}${pad(t.draws, 5)}${pad(lean, 14)}${pad(rd.within ? 'within' : 'OUTSIDE', 9)}${pad(cap, 5)}${pad(t.by.stalemate, 6)}${pad(sec(t.ticks / Math.max(1, t.seeds)), 7)}${pad((built[0] / games.length).toFixed(2), 10)}${pad((built[1] / games.length).toFixed(2), 10)}${pad(flips, 6)}${delta}`);
        if (arm === 'off') continue;
        for (const k of [0, 1] as const) {
          const types = games[0]?.works[k].map((x) => x.type) ?? [];
          for (const type of types) {
            const recs = games.map((g) => g.works[k].find((x) => x.type === type)).filter((x): x is WorkRead => x !== undefined);
            const done = recs.filter((x) => x.complete >= 0).map((x) => x.complete);
            const lost = recs.filter((x) => x.lost >= 0).length;
            const mean = done.length === 0 ? '-' : sec(done.reduce((a, b) => a + b, 0) / done.length);
            const first = done.length === 0 ? '-' : sec(Math.min(...done));
            const last = done.length === 0 ? '-' : sec(Math.max(...done));
            timing.push(`${pad(mapId, 15)}${pad(cellName(arr), 16)}${pad(arm, 11)}${pad(type, 26)}${pad(`${done.length}/${recs.length}`, 8)}${pad(mean, 12)}${pad(first, 7)}${pad(last, 7)}${lost}`);
          }
        }
      }
    }
  }
  console.log('outcome (wins by FACTION; leader is the share of ALL seeds; cap = decided by the clock; flips = seeds whose winner differs from off; dKDF dCap against off):');
  for (const l of outcome) console.log(`  ${l}`);
  console.log('');
  console.log('build timing (seconds from tick 0 to completion, over the games that completed it; lost = destroyed built or mid-build):');
  for (const l of timing) console.log(`  ${l}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
