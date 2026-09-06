// Mission runtime — the deterministic interpreter for declarative mission
// data (GDD §6). Missions are JSON: spawns, stances, triggers, waves, and an
// objective vocabulary. This module turns them into sim commands and mission
// events; it never reaches into sim internals (commands in, events out —
// invariant 4 applies to the runtime too).
//
// Shapes are declared structurally (the sim package imports nothing); the
// caller passes parsed mission JSON plus a context resolving unit ids and
// map markers/zones.

import { CivilianFlight } from './civilians';
import { fx, HALF, type Fx } from './fixed';
import { TICKS_PER_SECOND, type Sim, type SimEvent } from './sim';
import type { TunnelRouteJson } from './tunnels';
import { unlockReason, type UnlockGate } from './unlock';

// ---------------------------------------------------------------------------

export interface StanceJson {
  /** 'hold_position' | 'ambush' | 'patrol' | 'garrison' — string-typed so
   *  parsed JSON assigns structurally; the schema constrains the vocabulary. */
  kind: string;
  tiles?: number;
  waypoints?: readonly (readonly number[])[];
  /** garrison: tile coordinates of any tile of the building to occupy. */
  building?: readonly number[];
}

export interface PlacementJson {
  unit: string;
  count: number;
  at?: readonly number[];
  marker?: string;
  facing_deg?: number;
  group?: string;
  tag?: string;
  stance?: StanceJson;
  /** Draw survivors (with veterancy) from roster.surviving_units instead of
   *  spawning fresh. Sparse rosters degrade gracefully: fewer units, and a
   *  single fresh remnant when the roster has none of this type. */
  from_ledger?: boolean;
  /** Route id (map `tunnels[].id`) this placement starts inside. The bodies
   *  spawn underground in that route rather than standing on their tile, and
   *  stay below until the route is dug through and vents — or die with it if
   *  it is collapsed first (authored routes start undug). An unknown id
   *  throws at load. */
  in_tunnel?: string;
  /** Route id (map `tunnels[].id`) whose digger this placement is. The
   *  spawned body is assigned to the route at mission start and the dig
   *  advances from the first tick — the declarative form of `assignDigger`,
   *  exactly as `in_tunnel` is of `putInTunnel`. One digger, one route:
   *  validate_data.mjs requires the unit to carry `dig_tunnel`, `count` to
   *  be 1, at most one placement per route, never a `pre_dug` route (nothing
   *  left to excavate), and never on a placement that is itself `in_tunnel`
   *  (the runtime would let a buried body work the dig). An unknown id
   *  throws at load. */
  digs?: string;
  /**
   * Infantry authored *aboard* this carrier, seated at spawn rather than walking
   * in. The only way an AI-driven transport ever has passengers: every other
   * route into `passengers[]` is a player command.
   *
   * Nested rather than a `mounted_in` field on a separate placement, because a
   * carrier and its load are one authored fact and splitting them invites a
   * mission where one exists without the other.
   *
   * `count` on the carrier does not divide the load -- each carrier gets the
   * declared passengers, since that is what "these two technicals each bring an
   * RPG team" means. Capacity is therefore per carrier, and checked by
   * validate_data.mjs, which unlike JSON Schema can see transport_slots.
   */
  passengers?: readonly PlacementJson[];
}

/** A radio line (GDD §11): the story voice, not a game mechanic. `speaker` is
 *  string-typed so parsed JSON assigns structurally — the schema constrains
 *  the vocabulary to `shai | idit | net | enemy`. */
export interface SayJson {
  speaker: string;
  text: string;
}

/** Campaign carry-over: the ledger keys this runtime understands today.
 *  Missions may declare future keys; the runtime produces only what it can. */
export interface LedgerRosterEntry {
  type: string;
  veterancy: number;
}
export interface LedgerData {
  'roster.surviving_units'?: LedgerRosterEntry[];
  'roe.cumulative_rating'?: number;
  /**
   * Best ROE rating each mission has earned, keyed by mission id.
   *
   * This replaces `roe.cumulative_rating`, which was `(previous + this mission) / 2` -- an
   * exponential moving average with three faults: replaying your best mission walked the
   * campaign rating upward without playing anything new, replaying a mission you did badly
   * could never replace the bad sample, and the number depended on the order missions were
   * played in. #22 asks for replay to have a clear effect, and none of those three allow it.
   *
   * Best-of rather than latest, so a replay can only ever help -- which is what makes going
   * back to a mission you scored badly on worth doing.
   *
   * Deliberately not averaged here. An average is division, this package bans floating
   * point, and `| 0` on a float quotient is the "just this one calculation" the invariant
   * exists to refuse. `campaignRoe` in the app averages for display; `unlockReason` gates
   * with `sum >= floor * count`, which needs no division and changes no verdict for an
   * integer floor versus a truncated mean -- the two only diverge for a fractional
   * `roeMin`, which nothing authors.
   * `roe.cumulative_rating` stays on this interface, read as a fallback for saves written
   * before this key existed, and written by nothing.
   */
  'roe.mission_ratings'?: Record<string, number>;
  /**
   * Placement tags whose units recon resolved to *identified*. This is the
   * campaign's carry-over spine (GDD §4, "carry-over is the system"): what a recon
   * mission saw, in a form a later mission can act on.
   *
   * Tags, not entity ids, because entities do not survive a mission boundary --
   * mission II spawns its own. The only durable handle is what the author wrote.
   *
   * Named for positions rather than tunnel mouths, unlike the GDD's example: there
   * are no tunnels in the sim yet, and a ledger key naming something unbuildable
   * would be a lie in the save file. Tags cost nothing to extend when tunnels land.
   */
  'intel.marked_positions'?: string[];
  /** Mission ids already cleared, for `unlock.after_mission` gates. */
  'campaign.completed_missions'?: string[];
  /** How many civilian units got out — reached the refuge zone, latched, so
   *  dying afterwards does not un-count them. Written by missions whose
   *  premise includes an evacuation (the breach), read by later missions
   *  that want to know who made it. */
  'civ.settlements_evacuated'?: number;
  [key: string]: unknown;
}

export interface ObjectiveJson {
  id: string;
  type: string;
  primary: boolean;
  text?: string;
  target?: string;
  count?: number;
  seconds?: number;
  /** Fires as a `MissionEvent` the tick this objective completes, right
   *  after the `objective`/`complete` event it annotates. */
  say?: SayJson;
  /** Same, on the tick this objective fails. */
  say_on_fail?: SayJson;
}

export interface MissionJson {
  id: string;
  name?: string;
  /** The orders, shown on the deploying screen before the mission starts.
   *  Undeclared until 2026-08-21, which is why nothing rendered it: every
   *  mission has carried one since the format was written, and no call site
   *  could reach a field the type did not describe. */
  briefing?: string;
  /** Story voice (GDD §11), shown before the mission starts alongside the
   *  title. The sim never reads these three -- they are carried on the
   *  mission object purely so the app can, off the same JSON it already
   *  loads. ≤ 240 chars each, enforced by the schema and validate_data.mjs. */
  dispatch?: string;
  /** Shown on the victory banner. */
  aftermath?: string;
  /** Shown on the end screen, above the rating -- outcome-aware (G11): a win
   *  and a loss read `victory`/`defeat` respectively, and either may be
   *  absent on its own, independent of the other. A type only, like the
   *  three siblings above it -- the sim never reads any of these four, and
   *  the app is what branches on `victory` vs `defeat` off the same
   *  `missionEnd` event's `result` it already gets. */
  debrief?: { victory?: SayJson; defeat?: SayJson };
  map: { file: string; player_start?: readonly number[] };
  ledger: { requires: readonly string[]; produces: readonly string[] };
  objectives: readonly ObjectiveJson[];
  starting_force?: readonly PlacementJson[];
  /** Buildings this mission raises on top of its map's own. See the schema. */
  structures?: readonly { type: string; at: readonly number[]; size?: readonly number[] }[];
  resources?: {
    logistics_start?: number;
    intel_start?: number;
    logistics_rate_per_min?: number;
    supply_corridor?: boolean;
  };
  civilians?: {
    groups: readonly PlacementJson[];
    refuge?: string;
  };
  roe?: {
    enabled?: boolean;
    civilian_casualty_penalty?: number;
    flagged_structure_penalty?: number;
    disproportionate_ordnance_penalty?: number;
    structure_penalty_mult?: number;
    flagged_zones?: readonly string[];
    fail_below?: number;
  };
  enemy?: {
    faction?: string;
    garrison?: readonly PlacementJson[];
    waves?: readonly {
      at_seconds: number;
      trigger?: string;
      to?: string;
      units: readonly { unit: string; count: number; from?: string; group?: string; tag?: string }[];
    }[];
  };
  triggers?: readonly {
    id?: string;
    on: { kind: string; value?: number; zone?: string };
    /** do.kind: 'commit' | 'withdraw_to' | 'spawn' | 'reinforce' | 'dismount' |
     *  'remove' — string-typed so parsed JSON assigns structurally; the schema
     *  constrains the vocabulary. spawn spawns on side 1 (enemy); reinforce on
     *  side 0 (player). remove: every living entity in `group` (restricted to
     *  `zone` when given) leaves play via `sim.removeFromPlay` — the enemy's
     *  act, not a kill; `to`/`units` are meaningless for it and the schema
     *  refuses them. */
    do: { kind: string; group?: string; to?: string; units?: readonly PlacementJson[]; zone?: string };
    /** Fires as a `MissionEvent` the tick this trigger fires, right after the
     *  `trigger` event it annotates. */
    say?: SayJson;
  }[];
}

export interface MissionContext {
  typeIdOf: (unitId: string) => number;
  markers: Record<string, readonly number[]>;
  zones: Record<string, readonly number[]>;
  /** Authored tunnel routes, in the order they were registered with
   *  `sim.addTunnel`: the position in this array IS the sim's route index.
   *  The runtime needs the id (placements name routes by string) and the
   *  mouth — `points[0]`, for `collapse` zone membership; the sim keeps the
   *  live state. Absent when the map has no tunnels. */
  tunnels?: readonly TunnelRouteJson[];
  /** Campaign ledger read on entry (mission.ledger.requires). Absent or
   *  sparse values make the mission harder, never broken. */
  ledger?: LedgerData;
  /** Production catalogue: cost and build time per unit id, null if the
   *  unit cannot be built in the field. */
  unitInfo?: (
    unitId: string
  ) => {
    logistics: number;
    intel?: number;
    buildTimeS: number;
    /** Progression gate from the unit schema (GDD §6): restraint is what
     *  pays for the good equipment. */
    unlock?: { roeMin?: number; afterMission?: string };
  } | null;
}

export type ObjectiveStatus = 'active' | 'complete' | 'failed';

export type MissionEvent =
  | { kind: 'objective'; tick: number; id: string; status: ObjectiveStatus }
  | { kind: 'trigger'; tick: number; id: string }
  | { kind: 'wave'; tick: number; count: number }
  | { kind: 'roe'; tick: number; penalty: number; reason: string; score: number }
  | { kind: 'built'; tick: number; unit: string }
  /**
   * One civilian got out: reached the evacuation zone and was counted.
   *
   * Emitted for exactly the ids `CivilianFlight.collect` returns, which is the
   * same branch that latches them and clears `alive`, so it is exactly the set
   * of civilians who SURVIVED — never a casualty. It carries the entity id
   * (every other `MissionEvent` id is an AUTHORED string, hence the different
   * field name) because the one thing outside the sim that needs this cannot
   * use anything else: the renderer
   * reads `alive === 0` and cannot otherwise tell a rescue from a killing,
   * so it drew the crawl-and-fade death pose for both. Invariant 4 permits
   * exactly this shape — the runtime already knows the difference and says
   * so on the way out, rather than the renderer inferring it from positions.
   */
  | { kind: 'evacuated'; tick: number; entity: number }
  /**
   * A `remove` trigger took this entity off the board — the enemy's act
   * (an abduction, a narrative capture), never a death and never scored.
   * Mirrors `SimEvent`'s own `removed`, emitted right after
   * `sim.removeFromPlay(id)` returns, and carries what `describeMissionEvent`
   * needs to word it without reaching into sim state: `side` distinguishes a
   * civilian (2) from a player unit (0) for "taken (<n>)" versus "<unit>
   * taken", and `unit` is the type id, the same field `built` already uses.
   */
  | { kind: 'removed'; tick: number; entity: number; side: number; unit: string }
  /**
   * The story voice (GDD §11): a `say` on a trigger or objective, fired
   * immediately after the event it annotates so a listener can pair them by
   * position in the same tick's array. Pure translation of mission data —
   * `speaker`/`text` are copied from the JSON verbatim, string-typed for the
   * same reason every other vocabulary field here is: the schema constrains
   * `speaker` to `shai | idit | net | enemy`, this type does not need to.
   */
  | { kind: 'say'; tick: number; speaker: string; text: string }
  | {
      kind: 'missionEnd';
      tick: number;
      result: 'victory' | 'defeat';
      roeRating: number;
      survivors: string[];
      /** The produced carry-over, filtered to mission.ledger.produces. The
       *  app merges this into the campaign ledger on victory. */
      ledger: LedgerData;
    };

/** Every `MissionEvent` kind, as a value. See `SIM_EVENT_KINDS`. */
export const MISSION_EVENT_KINDS = [
  'objective', 'trigger', 'wave', 'roe', 'built', 'evacuated', 'removed', 'say', 'missionEnd',
] as const satisfies readonly MissionEvent['kind'][];

/** Compile-time proof the list above covers the whole union. See
 *  `SimEventKindsAreExhaustive`. */
type MissingMissionEventKind = Exclude<MissionEvent['kind'], (typeof MISSION_EVENT_KINDS)[number]>;
type AssertNoMissingMissionKind<T extends never> = T;
export type MissionEventKindsAreExhaustive = AssertNoMissingMissionKind<MissingMissionEventKind>;

const SUPPORTED = new Set([
  'locate', 'eliminate_hvt', 'capture', 'hold_for', 'survive_until', 'destroy_all',
  'evacuate_before', 'raze', 'collapse',
]);

/** Spread for multi-unit placements: 1.25 tiles. */
const SPREAD = 81920;
/** "Danger close": civilians within this of an aimpoint make heavy ordnance
 *  disproportionate (2 tiles, squared, Q16.16). */
const DANGER_CLOSE_SQ = 262144;
/** Weapons at or above this collateral_risk count as heavy ordnance (0.5). */
const HEAVY_COLLATERAL = 32768;
/** Below this collateral_risk a stray does not damage structures (0.3):
 *  rifle fire does not level clinics; shells and bombs do. */
const STRUCTURAL_COLLATERAL = 19661;
/** One structure deduction per zone per this many ticks (10 s): damage to a
 *  protected site is assessed per incident, not per round. */
const ZONE_DEDUCT_COOLDOWN = 200;
/** How close an enemy must be to your troops to be contesting the ground
 *  rather than merely standing somewhere inside a large rectangle: 6 tiles,
 *  squared, in Q16.16. Objective zones are big — 'no enemy anywhere in the
 *  zone' let one routed survivor in a far corner freeze a hold forever. */
const CONTEST_RADIUS_SQ = 2359296;
/** Intel prices, GDD §3. */
const SWEEP_COST = 150;
const STRIKE_COST = 250;
/** Intel earned per minute, GDD §3: a drone on station, a scout team holding
 *  an observation post. Watching is what pays for certainty. */
const INTEL_PER_MIN_DRONE = 8;
const INTEL_PER_MIN_SCOUT = 5;

interface ObjectiveState {
  def: ObjectiveJson;
  status: ObjectiveStatus;
  holdTicks: number;
  /** Why a timed hold is not counting down, if it is not. */
  paused: 'contested' | 'unheld' | null;
}

interface PatrolState {
  id: number;
  waypoints: [Fx, Fx][];
  idx: number;
}

/** Is a tile inside an `[x, y, w, h]` zone rectangle? Upper bound exclusive.
 *
 *  Exported because three callers must agree: stepRoe's fire branch, its
 *  strike branch, and the app's cursor, which tells the player whether firing
 *  here will cost them. A private copy in any of the three is a chance for the
 *  warning and the penalty to disagree by a tile. */
export function zoneContains(
  zone: readonly number[] | undefined,
  tx: number,
  ty: number
): boolean {
  if (!zone) return false;
  return tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3];
}

export class MissionRuntime {
  private readonly sim: Sim;
  private readonly mission: MissionJson;
  private readonly ctx: MissionContext;

  private readonly objectives: ObjectiveState[] = [];
  private readonly groups = new Map<string, number[]>();
  private readonly tags = new Map<string, number[]>();
  private readonly patrols: PatrolState[] = [];
  private readonly playerIds: number[] = [];
  private readonly enemyIds: number[] = [];
  /**
   * The enemy force that was on the ground when the player arrived.
   *
   * `casualties_pct` needs this and `enemyIds` will not do, because `enemyIds`
   * grows with every wave and trigger spawn: a trigger authored against a
   * starting garrison of five silently re-based itself on eight the moment
   * reinforcements landed, so the percentage the author wrote was not the
   * percentage that fired. Both halves of the fraction are scoped to this list,
   * so the reading is "n% of the force that was here when you arrived is down"
   * — a number an author can count off the mission file, and one reinforcements
   * cannot move in either direction.
   *
   * `enemyIds` keeps growing, and `destroy_all` still reads it: "destroy all
   * enemies" genuinely should include everyone who turns up later.
   */
  private readonly enemyAtStart: number[] = [];
  private readonly civIds: number[] = [];
  /** The flight-and-count rule, shared with the sandbox (`./civilians`).
   *  Owns both latches: who has broken for the refuge, and who reached it. */
  private readonly civFlight = new CivilianFlight();
  private readonly zoneDeductedAt = new Map<string, number>();
  /** Objective id -> the structure indices its zone held at mission start.
   *
   *  Snapshotted, not rescanned. `structureAt` returns -1 once a structure is
   *  dead and `destroyStructure` clears `blocked` on its tiles, so a per-tick
   *  rescan would find fewer structures each time one fell and would report
   *  "all zero are destroyed" the moment the last one dropped -- the right
   *  answer for the wrong reason, and a silent completion at t=0 for a zone
   *  that never held anything. Sorted, because an insertion-ordered array whose
   *  order depends on a scan is a latent determinism question. */
  private readonly razeTargets = new Map<string, readonly number[]>();
  /** Objective id -> the route indices whose mouths its zone held at mission
   *  start. Mirrors razeTargets, though for a different reason: ctx.tunnels
   *  is static so a rescan could not shrink, but snapshotting at start() is
   *  what makes a mis-wired route set throw at load rather than read as
   *  "already down" on the first evaluation, and it keeps the per-tick work
   *  an index walk instead of a zone test. */
  private readonly collapseTargets = new Map<string, readonly number[]>();
  private roeScoreValue = 100;
  private roeFailed = false;
  private logisticsValue = 0;
  private intelValue = 0;
  private readonly buildQueue: { unit: string; startTick: number; readyTick: number }[] = [];
  private readonly identified = new Set<number>();
  /** Tags marked by a previous mission, read from the incoming ledger. */
  private readonly marked: Set<string>;
  /** Tags whose units were identified *this* mission, for the outgoing ledger. */
  private readonly markedThisMission = new Set<string>();
  private readonly kills = new Map<number, number>();
  private readonly rosterPool: LedgerRosterEntry[];
  private readonly firedTriggers: boolean[] = [];
  private readonly spawnedWaves: boolean[] = [];
  private firstContact = false;
  private ended = false;
  /** Objectives completed from outside since the last step(), so their
   *  events are emitted on the tick the completion takes effect. */
  private readonly externallyCompleted: string[] = [];
  private resultValue: 'ongoing' | 'victory' | 'defeat' = 'ongoing';

  constructor(sim: Sim, mission: MissionJson, ctx: MissionContext) {
    this.sim = sim;
    this.mission = mission;
    this.ctx = ctx;
    for (const def of mission.objectives) {
      if (!SUPPORTED.has(def.type)) {
        throw new Error(
          `mission ${mission.id}: objective type "${def.type}" is not supported by the runtime yet`
        );
      }
      this.objectives.push({ def, status: 'active', holdTicks: 0, paused: null });
    }
    this.firedTriggers = new Array(mission.triggers?.length ?? 0).fill(false);
    this.spawnedWaves = new Array(mission.enemy?.waves?.length ?? 0).fill(false);
    this.rosterPool = [...(ctx.ledger?.['roster.surviving_units'] ?? [])];
    // What recon marked last mission. A tag in here spawns pre-revealed and gives up
    // its ambush; everything else spawns exactly as authored.
    this.marked = new Set(ctx.ledger?.['intel.marked_positions'] ?? []);
    this.logisticsValue = mission.resources?.logistics_start ?? 0;
    this.intelValue = mission.resources?.intel_start ?? 0;
  }

  /** Spendable logistics, floored for display. */
  get logistics(): number {
    return this.logisticsValue - (this.logisticsValue % 1);
  }

  get intel(): number {
    return this.intelValue - (this.intelValue % 1);
  }

  /** Field production: spend logistics/intel, deploy at player_start after
   *  the build time. Returns false when unaffordable or unknown. */
  /**
   * Why this unit cannot be built, or null when it can. Campaign gates only:
   * affordability changes tick to tick and is shown as a price, but a locked
   * unit needs to say what would unlock it (GDD §6).
   */
  /**
   * The living structure this side produces from, or -1. A camp is the only
   * structure type that declares `produces_for`; everything else in the
   * catalogue is neutral terrain, so this scan finds at most a handful.
   *
   * First one wins. With several camps the player keeps producing until the
   * last falls, which is the behaviour "losing the camp loses production"
   * asks for — losing *a* camp must not.
   */
  private productionAnchor(side: number): number {
    for (let s = 0; s < this.sim.structureCount; s++) {
      if (this.sim.structures.alive[s] === 0) continue;
      if (this.sim.structureTypes[this.sim.structures.typeIdx[s]].producesFor === side) return s;
    }
    return -1;
  }

  buildBlockedReason(unitId: string): string | null {
    const info = this.ctx.unitInfo?.(unitId);
    if (!info) return 'not available in the field';
    const unlock = unlockReason(info.unlock as UnlockGate | undefined, this.ctx.ledger);
    if (unlock !== null) return unlock;
    // Where would it deploy? A camp if the mission placed one, else the map's
    // `player_start` — the fallback that keeps every mission authored before
    // camps existed producing exactly as it did. Only a mission that HAS a
    // camp can lose production by losing it; a mission with neither was never
    // able to build in the first place.
    if (this.productionAnchor(0) >= 0) return null;
    // No camp standing. Whether that BLOCKS production depends on whether this
    // mission ever had one -- asked of the mission JSON, not the live sim.
    // Reading it off the sim instead would make `player_start` a silent
    // fallback the moment the camp fell, which is precisely the coupling this
    // feature exists to create: a mission that fields a camp loses production
    // with it, and a mission that never fielded one is untouched.
    if (this.declaresProduction(0)) return 'field camp destroyed — no production';
    if (!this.mission.map.player_start) return 'no field camp — production needs one standing';
    return null;
  }

  /** Does this mission field a production structure at all, alive or dead? */
  private declaresProduction(side: number): boolean {
    for (const spec of this.mission.structures ?? []) {
      const t = this.sim.structureTypes.find((x) => x.id === spec.type);
      if (t !== undefined && t.producesFor === side) return true;
    }
    return false;
  }

  /** What a satellite sweep and a precision strike cost, for the HUD. */
  get sweepCost(): number {
    return SWEEP_COST;
  }
  get strikeCost(): number {
    return STRIKE_COST;
  }

  /**
   * Buy certainty: everything hostile around a point becomes identified.
   * Intel is the scarce resource, so this is the recon you did not have time
   * to do yourself (GDD §3).
   */
  requestSweep(x: Fx, y: Fx): boolean {
    if (this.ended || this.intelValue < SWEEP_COST) return false;
    this.intelValue -= SWEEP_COST;
    this.sim.queueCommand({ kind: 'reveal', side: 0, x, y });
    return true;
  }

  /**
   * Call a precision strike. Attributed to a living caller so ROE charges
   * the consequences to the player who ordered it — a strike beside a
   * civilian block is meant to be a decision, not a reflex.
   */
  requestStrike(x: Fx, y: Fx): boolean {
    if (this.ended || this.intelValue < STRIKE_COST) return false;
    // Living AND on the surface: a buried unit can neither observe the
    // strike nor own its ROE bill, and drawing scatter from its RNG stream
    // would consume a stream the containment rule says is idle down there.
    const caller = this.playerIds.find(
      (id) => this.sim.state.alive[id] === 1 && this.sim.state.tunnelIn[id] < 0,
    );
    if (caller === undefined) return false;
    this.intelValue -= STRIKE_COST;
    this.sim.queueCommand({ kind: 'callStrike', caller, x, y });
    return true;
  }

  requestBuild(unitId: string): boolean {
    if (this.ended) return false;
    const info = this.ctx.unitInfo?.(unitId);
    if (!info) return false;
    if (this.buildBlockedReason(unitId) !== null) return false;
    if (this.logisticsValue < info.logistics || this.intelValue < (info.intel ?? 0)) return false;
    this.logisticsValue -= info.logistics;
    this.intelValue -= info.intel ?? 0;
    this.buildQueue.push({
      unit: unitId,
      startTick: this.sim.tickCount,
      readyTick: this.sim.tickCount + info.buildTimeS * TICKS_PER_SECOND,
    });
    return true;
  }

  /**
   * Complete a declared objective from outside the runtime. The tutorial's
   * "every lesson cleared" is a fact about player input, which the runtime
   * deliberately cannot observe (see tutorial.schema.json) — this is the
   * same app→runtime channel as requestStrike. The completion event and
   * any mission end come out of the next step(), through the normal path.
   */
  completeObjective(id: string): boolean {
    if (this.ended) return false;
    const o = this.objectives.find((x) => x.def.id === id);
    if (!o || o.status !== 'active') return false;
    o.status = 'complete';
    this.externallyCompleted.push(id);
    return true;
  }

  get result(): 'ongoing' | 'victory' | 'defeat' {
    return this.resultValue;
  }

  /** Live ROE score 0-100 — must be visible in the HUD at all times. */
  get roeScore(): number {
    return this.roeScoreValue;
  }

  /** In-flight production for the HUD, in whole ticks — the presentation
   *  layer turns these into a bar and a countdown (no floats in the sim). */
  get production(): { unit: string; doneTicks: number; totalTicks: number; ticksLeft: number }[] {
    const tick = this.sim.tickCount;
    return this.buildQueue.map((b) => {
      const totalTicks = b.readyTick - b.startTick;
      const rawDone = tick - b.startTick;
      const doneTicks = rawDone < 0 ? 0 : rawDone > totalTicks ? totalTicks : rawDone;
      const rawLeft = b.readyTick - tick;
      return { unit: b.unit, doneTicks, totalTicks, ticksLeft: rawLeft < 0 ? 0 : rawLeft };
    });
  }

  objectiveStatus(id: string): ObjectiveStatus {
    const o = this.objectives.find((x) => x.def.id === id);
    if (!o) throw new Error(`no objective ${id}`);
    return o.status;
  }

  /** Objective list for UI: id, type, text, primary, status. */
  get objectiveList(): {
    id: string;
    type: string;
    text: string;
    primary: boolean;
    status: ObjectiveStatus;
    /** Ticks still to run on a timed objective — undefined when it is not
     *  timed. 'Hold for five minutes' is not an order you can follow without
     *  a clock (GDD §5.8). The UI formats it; the sim stays float-free. */
    ticksLeft?: number;
    /** Why the clock is paused: nobody on the objective, or a fight for it. */
    paused?: 'contested' | 'unheld';
    /** Zone this objective is fought over, so the map can show it. */
    zone?: string;
  }[] {
    return this.objectives.map((o) => {
      let ticksLeft: number | undefined;
      if (o.status === 'active') {
        const secs = o.def.seconds;
        if (secs !== undefined) {
          if (o.def.type === 'survive_until' || o.def.type === 'evacuate_before') {
            const left = secs * TICKS_PER_SECOND - this.sim.tickCount;
            ticksLeft = left > 0 ? left : 0;
          } else if (o.def.type === 'hold_for' || o.def.type === 'capture') {
            // Capture resets its clock when the ground is contested, so this
            // reads as 'how much longer, from where you stand now'.
            const left = secs * TICKS_PER_SECOND - o.holdTicks;
            ticksLeft = left > 0 ? left : 0;
          }
        }
      }
      return {
        id: o.def.id,
        type: o.def.type,
        text: o.def.text ?? o.def.id,
        primary: o.def.primary,
        status: o.status,
        ticksLeft,
        paused: o.status === 'active' && o.paused !== null ? o.paused : undefined,
        zone:
          o.def.type === 'hold_for' ||
          o.def.type === 'capture' ||
          o.def.type === 'raze' ||
          o.def.type === 'collapse'
            ? o.def.target
            : undefined,
      };
    });
  }

  /** Spawn everything the mission declares. Call once before the first tick. */
  start(): void {
    // Mission-placed buildings go up BEFORE any force spawns, so a placement
    // can never land inside one.
    this.raiseMissionStructures();
    for (const p of this.mission.starting_force ?? []) this.spawnPlacement(p, 0);
    for (const p of this.mission.enemy?.garrison ?? []) this.spawnPlacement(p, 1);
    for (const p of this.mission.civilians?.groups ?? []) this.spawnPlacement(p, 2);
    // Snapshot the garrison before any wave or trigger can add to it. See
    // `enemyAtStart`.
    this.enemyAtStart.push(...this.enemyIds);
    for (const [tag, ids] of this.tags) {
      if (ids.length === 0) throw new Error(`mission ${this.mission.id}: tag "${tag}" has no units`);
    }
    // Waves spawn minutes in, so a wave aimed into a wall would throw in the
    // middle of a firefight. Their markers are known now, so check them now:
    // a broken wave should fail at mission load, not at t=180s.
    for (const w of this.mission.enemy?.waves ?? []) {
      for (const u of w.units) {
        if (!u.from) continue; // spawnPlacement reports the missing marker itself
        const [wx, wy] = this.markerPos(u.from);
        this.assertGroundClear(u.unit, wx, wy, u.count);
      }
    }
    for (const o of this.objectives) {
      if (o.def.type === 'eliminate_hvt') {
        const tag = o.def.target;
        if (!tag || !this.tags.has(tag)) {
          throw new Error(`mission ${this.mission.id}: eliminate_hvt "${o.def.id}" needs a garrisoned tag`);
        }
      }
      if (
        (o.def.type === 'capture' || o.def.type === 'hold_for' || o.def.type === 'evacuate_before') &&
        !this.zone(o.def.target)
      ) {
        throw new Error(`mission ${this.mission.id}: objective "${o.def.id}" needs a valid zone`);
      }
      if (o.def.type === 'evacuate_before') {
        const refuge = this.mission.civilians?.refuge;
        // Nobody to walk to: an evacuation with no declared refuge marker can never
        // complete, the same class of broken mission as a hold_for with no zone or
        // an eliminate_hvt with no garrisoned tag.
        if (!refuge) {
          throw new Error(`mission ${this.mission.id}: evacuate_before "${o.def.id}" needs civilians.refuge`);
        }
        const z = this.zone(o.def.target);
        const [mx, my] = this.markerPos(refuge);
        const tx = mx >> 16;
        const ty = my >> 16;
        if (z && !(tx >= z[0] && tx < z[0] + z[2] && ty >= z[1] && ty < z[1] + z[3])) {
          throw new Error(
            `mission ${this.mission.id}: evacuate_before "${o.def.id}" refuge marker "${refuge}" ` +
              `is outside zone "${o.def.target}"`
          );
        }
      }
      if (o.def.type === 'raze') {
        const z = this.zone(o.def.target);
        if (!z) {
          throw new Error(`mission ${this.mission.id}: objective "${o.def.id}" needs a valid zone`);
        }
        const found = new Set<number>();
        for (let y = z[1]; y < z[1] + z[3]; y++) {
          for (let x = z[0]; x < z[0] + z[2]; x++) {
            const s = this.sim.structureAt(x, y);
            if (s >= 0) found.add(s);
          }
        }
        if (found.size === 0) {
          throw new Error(
            `mission ${this.mission.id}: raze "${o.def.id}" zone "${o.def.target}" contains ` +
              `no structures, so it would complete on the first tick`
          );
        }
        this.razeTargets.set(o.def.id, [...found].sort((a, b) => a - b));
      }
      if (o.def.type === 'collapse') {
        const z = this.zone(o.def.target);
        if (!z) {
          throw new Error(`mission ${this.mission.id}: objective "${o.def.id}" needs a valid zone`);
        }
        // A route belongs to the objective when its MOUTH — points[0] as
        // authored in the map — lies inside the zone. The rest of the line
        // does not count: a route that merely passes under the district is
        // someone else's problem; one that opens into it is this mission's.
        const routes = this.ctx.tunnels ?? [];
        const found: number[] = [];
        for (let r = 0; r < routes.length; r++) {
          const [mx, my] = routes[r].points[0];
          if (mx >= z[0] && mx < z[0] + z[2] && my >= z[1] && my < z[1] + z[3]) {
            // ctx.tunnels claims to mirror sim registration order. A route
            // the sim never registered would read tnAlive 0 — "already
            // down" — and hand out the win, so refuse the mismatch at load.
            if (r >= this.sim.tunnelCount) {
              throw new Error(
                `mission ${this.mission.id}: collapse "${o.def.id}" targets tunnel ` +
                  `"${routes[r].id}", which was never registered with the sim`
              );
            }
            found.push(r);
          }
        }
        // Unlike raze, an empty set does not throw here. validate_data.mjs
        // rejects a collapse zone containing no tunnel mouths at authoring
        // time (membership by mouth, matching this loop), and for content
        // that skipped the validator the evaluation's length guard keeps
        // this from reading as an instant win — the objective sits active
        // until its `seconds` deadline fails it.
        this.collapseTargets.set(o.def.id, found);
      }
    }
  }

  /** Advance the mission one tick. Call immediately after sim.tick(). */
  step(simEvents: SimEvent[]): MissionEvent[] {
    if (this.ended) return [];
    const out: MissionEvent[] = [];
    const tick = this.sim.tickCount;

    // Digest sim events: contacts feed locate + first_contact; kills feed
    // veterancy progression.
    for (const e of simEvents) {
      if (e.kind === 'fire') this.firstContact = true;
      if (e.kind === 'contact' && e.level === 'identified') {
        this.firstContact = true;
        if (e.side === 0 && this.sim.state.side[e.target] === 1) this.identified.add(e.target);
        // Carry-over, produced. The tag joins the ledger the moment any unit of that
        // placement is identified -- no separate mark verb, and no objective needed:
        // intel is what recon *saw*. Partial credit falls out, because sweeping half
        // the ground marks half the tags and the list length is the grade.
        for (const [tag, ids] of this.tags) {
          if (!this.markedThisMission.has(tag) && ids.includes(e.target)) {
            this.markedThisMission.add(tag);
          }
        }
      }
      if (e.kind === 'destroyed' && e.by >= 0) {
        this.kills.set(e.by, (this.kills.get(e.by) ?? 0) + 1);
      }
    }

    // Income: logistics arrive by rate; interdiction (supply_corridor) is a
    // later slice. Fractional accrual is exact-enough JS arithmetic.
    const rate = this.mission.resources?.logistics_rate_per_min ?? 0;
    if (rate > 0) this.logisticsValue += rate / 1200;
    // Intel accrues from units that are actually observing: a drone on
    // station always, a scout team only while it holds position.
    let intelPerMin = 0;
    const st = this.sim.state;
    for (const id of this.playerIds) {
      if (st.alive[id] === 0) continue;
      // Underground observes nothing and earns nothing. On the loop, not a
      // branch, so the drone half and the stationary-scout half — a buried
      // unit is stationary by definition — are covered by the same line.
      if (st.tunnelIn[id] >= 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[id]];
      if (type.role === 'drone') intelPerMin += INTEL_PER_MIN_DRONE;
      else if (type.canMarkTarget && st.moving[id] === 0) intelPerMin += INTEL_PER_MIN_SCOUT;
    }
    if (intelPerMin > 0) this.intelValue += intelPerMin / 1200;
    for (let i = this.buildQueue.length - 1; i >= 0; i--) {
      const b = this.buildQueue[i];
      if (tick < b.readyTick) continue;
      this.buildQueue.splice(i, 1);
      // Deploy beside the camp that built it. `origin` is the same channel a
      // carrier's passengers use. With no camp this is undefined and the
      // placement falls through to `player_start`, unchanged.
      const anchor = this.productionAnchor(0);
      this.spawnPlacement(
        { unit: b.unit, count: 1 },
        0,
        anchor >= 0 ? this.sim.structureExit(anchor) : undefined
      );
      out.push({ kind: 'built', tick, unit: b.unit });
    }

    this.stepRoe(simEvents, tick, out);
    this.stepCivilians();
    this.stepPatrols();
    this.stepTriggers(tick, out);
    this.stepWaves(tick, out);
    for (const id of this.externallyCompleted.splice(0)) {
      out.push({ kind: 'objective', tick, id, status: 'complete' });
    }
    this.stepObjectives(tick, out);
    this.checkEnd(tick, out);
    return out;
  }

  // ------------------------------------------------------------------ spawns

  /**
   * Refuse to spawn anyone inside a building.
   *
   * A placement's `count` does not stack bodies on one tile: `spawnPlacement`
   * spreads them `SPREAD` apart, so a `count: 3` group occupies its declared
   * tile *plus* two more to the east, and a fourth body starts a second row to
   * the south. That is why checking the declared coordinate proves nothing —
   * a civilian group whose `at` was open street put its middle body inside a
   * mosque, where it could never path out: a family scored against the player
   * that was impossible to rescue. It survived a hand audit and a code review,
   * because both looked only at `at`, and only playing the mission found it.
   *
   * So the engine checks every body, and says which one.
   *
   * Garrison stances are the one exemption, and the caller applies it: a unit
   * ordered into a building is entering it, not trapped in it, and posting a
   * squad at the doorway so it walks in is normal authoring — the spread of a
   * `count: 2` at the door legitimately puts the second body on the building's
   * own tile. Residual risk accepted: an overflowing garrison waits outside,
   * and nothing checks that the tile it waits on is passable.
   */
  private assertGroundClear(unitId: string, bx: Fx, by: Fx, count: number): void {
    for (let k = 0; k < count; k++) {
      const tx = fx.add(bx, (k % 3) * SPREAD) >> 16;
      const ty = fx.add(by, ((k - (k % 3)) / 3) * SPREAD) >> 16;
      if (tx < 0 || ty < 0 || tx >= this.sim.width || ty >= this.sim.height) {
        throw new Error(
          `mission ${this.mission.id}: ${unitId} body ${k + 1} of ${count} spawns at ` +
            `(${tx},${ty}), off the ${this.sim.width}x${this.sim.height} map`
        );
      }
      if (this.sim.blocked[ty * this.sim.width + tx] === 1) {
        throw new Error(
          `mission ${this.mission.id}: ${unitId} body ${k + 1} of ${count} spawns at ` +
            `(${tx},${ty}), which is blocked. A placement spreads its bodies 1.25 tiles ` +
            `apart, so a clear declared position does not mean clear ground`
        );
      }
    }
  }

  private markerPos(name: string): [Fx, Fx] {
    const m = this.ctx.markers[name];
    if (!m) throw new Error(`mission ${this.mission.id}: unknown marker "${name}"`);
    return [fx.add(fx.fromInt(m[0]), HALF), fx.add(fx.fromInt(m[1]), HALF)];
  }

  private zone(name: string | undefined): readonly number[] | undefined {
    return name ? this.ctx.zones[name] : undefined;
  }

  /** Sim route index for an authored tunnel id. `ctx.tunnels` is positional:
   *  entry r describes the route `addTunnel` registered as index r. Throws
   *  on an unknown id, and on an id the sim never registered — both are
   *  load-time wiring faults that must not spawn half a placement. */
  private tunnelIndex(id: string): number {
    const routes = this.ctx.tunnels ?? [];
    for (let r = 0; r < routes.length; r++) {
      if (routes[r].id === id) {
        if (r >= this.sim.tunnelCount) {
          throw new Error(
            `mission ${this.mission.id}: tunnel "${id}" is in the map data but was ` +
              `never registered with the sim`
          );
        }
        return r;
      }
    }
    throw new Error(`mission ${this.mission.id}: unknown tunnel "${id}"`);
  }

  /**
   * Spawn a carrier's authored passengers and seat them.
   *
   * A refusal is a mission authoring error -- over capacity, or a type that cannot
   * ride -- and throws rather than leaving a half-loaded truck, because a mission
   * that quietly delivers two of three squads is a bug that only shows up in
   * playtesting. `pnpm validate:data` is meant to catch all of these first; this
   * is the backstop that makes sure it did.
   */
  private embarkPassengers(
    carrier: number,
    passengers: readonly PlacementJson[],
    side: number,
  ): void {
    const at: readonly [Fx, Fx] = [this.sim.state.posX[carrier], this.sim.state.posY[carrier]];
    for (const q of passengers) {
      if (q.passengers) {
        throw new Error(
          `mission ${this.mission.id}: ${q.unit} is a passenger and cannot carry passengers itself`,
        );
      }
      for (const pid of this.spawnPlacement(q, side, at)) {
        if (!this.sim.embarkAtSpawn(carrier, pid)) {
          throw new Error(
            `mission ${this.mission.id}: cannot seat ${q.unit} in ${this.mission.id}'s carrier ` +
              `-- out of seats, or the type cannot ride`,
          );
        }
      }
    }
  }

  /**
   * Raise this mission's own buildings. The map grid cannot express these: it
   * is shared by every mission that names the file, and a camp belongs to one
   * mission. Everything else about them is identical to a map-parsed
   * structure -- same catalogue, same `addStructure`, same HP and rubble.
   */
  private raiseMissionStructures(): void {
    for (const spec of this.mission.structures ?? []) {
      const ti = this.sim.structureTypes.findIndex((t) => t.id === spec.type);
      if (ti < 0) {
        throw new Error(`mission ${this.mission.id}: unknown structure type "${spec.type}"`);
      }
      const [w, h] = spec.size ?? [2, 2];
      const [ox, oy] = spec.at;  // length pinned to 2 by mission.schema.json
      const tiles: number[] = [];
      for (let y = oy; y < oy + h; y++) {
        for (let x = ox; x < ox + w; x++) {
          if (x < 0 || y < 0 || x >= this.sim.width || y >= this.sim.height) {
            throw new Error(
              `mission ${this.mission.id}: ${spec.type} tile (${x},${y}) is off the map`
            );
          }
          // Silent corruption otherwise: addStructure overwrites structureOfTile,
          // so a camp dropped on a house would orphan the house's own tiles.
          if (this.sim.structureAt(x, y) >= 0) {
            throw new Error(
              `mission ${this.mission.id}: ${spec.type} at (${ox},${oy}) overlaps an existing building at (${x},${y})`
            );
          }
          tiles.push(y * this.sim.width + x);
        }
      }
      this.sim.addStructure(ti, tiles);
    }
  }

  private spawnPlacement(p: PlacementJson, side: number, origin?: readonly [Fx, Fx]): number[] {
    let bx: Fx;
    let by: Fx;
    if (origin !== undefined) {
      // A passenger spawns on its carrier. Position hardly matters -- embarkAtSpawn
      // snaps it onto the hull -- but taking it from the carrier keeps a passenger
      // placement from needing an `at` or a `marker` of its own.
      [bx, by] = origin;
    } else if (p.marker !== undefined) {
      [bx, by] = this.markerPos(p.marker);
    } else if (p.at !== undefined) {
      bx = fx.from(p.at[0]);
      by = fx.from(p.at[1]);
    } else {
      const ps = this.mission.map.player_start;
      if (!ps) throw new Error(`mission ${this.mission.id}: placement of ${p.unit} has no position`);
      bx = fx.from(ps[0]);
      by = fx.from(ps[1]);
    }
    const facing = p.facing_deg !== undefined ? fx.div(fx.from(p.facing_deg), fx.fromInt(360)) & 0xffff : 0;
    const typeIdx = this.ctx.typeIdOf(p.unit);

    // Ledger draw (GDD §6): survivors come back with their veterancy. A
    // sparse roster fields fewer units; a gutted one fields a single fresh
    // remnant — harder mission, never a broken one. A campaign that has not
    // produced a roster yet (key absent) is a fresh start, not a degraded one.
    const hasRoster = this.ctx.ledger?.['roster.surviving_units'] !== undefined;
    let veterancies: number[];
    if (side === 0 && p.from_ledger === true && hasRoster) {
      veterancies = [];
      for (let k = 0; k < p.count; k++) {
        const idx = this.rosterPool.findIndex((r) => r.type === p.unit);
        if (idx < 0) break;
        veterancies.push(this.rosterPool[idx].veterancy);
        this.rosterPool.splice(idx, 1);
      }
      if (veterancies.length === 0) veterancies = [0];
    } else {
      veterancies = new Array(p.count).fill(0);
    }

    // Resolved before any body spawns: a bad route id is an authoring error
    // and must not leave half a placement standing.
    const tunnelIdx = p.in_tunnel !== undefined ? this.tunnelIndex(p.in_tunnel) : -1;
    // Same rule, same reason, for the route this placement digs.
    const digsIdx = p.digs !== undefined ? this.tunnelIndex(p.digs) : -1;

    // Buried and loaded cannot coexist: the hull fits the shaft, the riders
    // do not, and every containment guard keys on the rider's own tunnelIn —
    // which would stay -1 while stepTransport pinned it to a buried hull.
    // Refused rather than silently unloaded, because the unload would put
    // the squad on a cosmetic tile that was never ground-checked.
    if (tunnelIdx >= 0 && p.passengers) {
      throw new Error(
        `mission ${this.mission.id}: ${p.unit} cannot carry passengers into a tunnel -- ` +
          `a placement is either in_tunnel or loaded, never both`,
      );
    }

    // A garrisoning placement is exempt: it is ordered into a building and walks
    // in on the first ticks, so standing on its tile at spawn is the job, not a
    // trap. A buried placement is exempt too: its bodies occupy the route, not
    // the declared tile, and they come back up at the vent — surface clearance
    // where they were authored proves nothing. Everything else must land on
    // ground it can move off.
    if (p.stance?.kind !== 'garrison' && tunnelIdx < 0) {
      this.assertGroundClear(p.unit, bx, by, veterancies.length);
    }

    const ids: number[] = [];
    for (let k = 0; k < veterancies.length; k++) {
      const ox = (k % 3) * SPREAD;
      const oy = ((k - (k % 3)) / 3) * SPREAD;
      const id = this.sim.spawn(typeIdx, side, fx.add(bx, ox), fx.add(by, oy), facing, veterancies[k]);
      ids.push(id);
      // Each carrier gets the declared load, not a share of it.
      if (p.passengers) this.embarkPassengers(id, p.passengers, side);
      (side === 0 ? this.playerIds : side === 1 ? this.enemyIds : this.civIds).push(id);
      if (p.group) {
        const g = this.groups.get(p.group) ?? [];
        g.push(id);
        this.groups.set(p.group, g);
      }
      if (p.tag) {
        const t = this.tags.get(p.tag) ?? [];
        t.push(id);
        this.tags.set(p.tag, t);
      }
      // Below ground from tick zero. putInTunnel owns the tunnelIn/occupant
      // invariant; the spawn position above is cosmetic for a buried body.
      if (tunnelIdx >= 0) this.sim.putInTunnel(id, tunnelIdx);
      // The route's digger from tick zero. assignDigger keeps one digger per
      // route, so on an unvalidated count > 1 the last body silently wins —
      // validate_data.mjs refuses such a placement before it ships.
      if (digsIdx >= 0) this.sim.assignDigger(digsIdx, id);
      // Carry-over, consumed. A placement recon marked last mission is already known:
      // it spawns visible, and it does not get to spring an ambush. This is what makes
      // a thorough recon worth doing -- and why one mission file plays differently by
      // ledger, with no per-outcome variants to author.
      const preMarked = p.tag !== undefined && this.marked.has(p.tag);
      // A buried placement is exempt from BOTH books: last mission's recon
      // saw where the route ran, not who is inside it today, and identifying
      // a body through three metres of earth would complete a `locate` at
      // t=0 against a unit nobody can see or reach. The tunnel contact
      // ladder is the only channel for knowing about a tunnel.
      if (preMarked && side === 1 && tunnelIdx < 0) {
        // Two different books. `identified` is this runtime's own, which is what
        // `locate` objectives read; the sim's contact state is what the renderer draws
        // and what the combat model may shoot at. Writing only the first is how a
        // pre-marked ambusher satisfied its objective while staying invisible on
        // screen -- green tests, nothing on the map.
        this.identified.add(id);
        this.sim.identifyTo(0, id);
      }
      if (p.stance?.kind === 'garrison') {
        const b = p.stance.building;
        if (b === undefined) {
          throw new Error(`mission ${this.mission.id}: garrison stance for ${p.unit} needs "building"`);
        }
        const s = this.sim.structureAt(b[0] | 0, b[1] | 0);
        if (s < 0) {
          throw new Error(
            `mission ${this.mission.id}: no building at (${b[0]},${b[1]}) for ${p.unit} to garrison`
          );
        }
        // They walk in on the first ticks; overflow waits outside, which is
        // the honest outcome of ordering four men into a two-room house.
        this.sim.queueCommand({ kind: 'garrison', ids: [id], structure: s });
      } else if (p.stance?.kind === 'ambush') {
        // Knowing where an ambush is removes the surprise, not the enemy: a marked
        // ambusher simply holds position instead. The GDD calls `ambush` "the entire
        // reason recon quality matters by Phase 5", so this is that sentence made
        // mechanical.
        if (!preMarked) this.sim.setAmbush(id, fx.from(p.stance.tiles ?? 3));
      } else if (p.stance?.kind === 'patrol' && p.stance.waypoints && p.stance.waypoints.length >= 2) {
        this.patrols.push({
          id,
          waypoints: p.stance.waypoints.map((w) => [fx.from(w[0]), fx.from(w[1])]),
          idx: 0,
        });
      }
    }
    return ids;
  }

  // ----------------------------------------------------------------- systems

  /** ROE scoring (GDD §6): civilian casualties, fire into flagged zones, and
   *  heavy ordnance danger-close to civilians all deduct. Only player-caused
   *  harm counts — the score is a judgement of the player's restraint. */
  private stepRoe(simEvents: SimEvent[], tick: number, out: MissionEvent[]): void {
    const roe = this.mission.roe;
    if (roe?.enabled === false) return;
    const st = this.sim.state;
    const deduct = (penalty: number, reason: string): void => {
      this.roeScoreValue = this.roeScoreValue - penalty;
      if (this.roeScoreValue < 0) this.roeScoreValue = 0;
      out.push({ kind: 'roe', tick, penalty, reason, score: this.roeScoreValue });
      const floor = roe?.fail_below;
      if (floor !== undefined && this.roeScoreValue < floor) this.roeFailed = true;
    };

    for (const e of simEvents) {
      if (e.kind === 'structureDestroyed') {
        // Only the player's demolitions are judged: the enemy wrecking its
        // own town is their affair, not a mark against your restraint.
        if (e.by < 0 || st.side[e.by] !== 0) continue;
        const mult = roe?.structure_penalty_mult ?? 1;
        const type = this.sim.structureTypes[this.sim.structures.typeIdx[e.structure]];
        // Round half up without Math (invariant 2): (2v + 1) / 2 truncated.
        const cost = ((type.roePenalty * mult * 2 + 1) / 2) | 0;
        if (cost > 0) deduct(cost, `${type.id.charAt(0).toUpperCase()}${type.id.slice(1)} destroyed`);
      } else if (e.kind === 'destroyed' && this.civIds.includes(e.entity)) {
        if (e.by >= 0 && st.side[e.by] === 0) {
          deduct(roe?.civilian_casualty_penalty ?? 8, 'civilian casualties');
        }
      } else if (e.kind === 'nearMiss' && st.side[e.shooter] === 0) {
        // Only ordnance damages structures — rifle strays do not level clinics.
        const type = this.sim.unitTypes[st.typeIdx[e.shooter]];
        const weapon = type.weapons.find((w) => w.id === e.weaponId);
        if (weapon === undefined || weapon.collateralRisk < STRUCTURAL_COLLATERAL) continue;
        const tx = e.x >> 16;
        const ty = e.y >> 16;
        for (const zoneName of roe?.flagged_zones ?? []) {
          if (zoneContains(this.zone(zoneName), tx, ty)) {
            const last = this.zoneDeductedAt.get(zoneName);
            if (last === undefined || tick - last >= ZONE_DEDUCT_COOLDOWN) {
              this.zoneDeductedAt.set(zoneName, tick);
              deduct(roe?.flagged_structure_penalty ?? 5, `fire into protected structure (${zoneName})`);
            }
            break;
          }
        }
      } else if (e.kind === 'strike' && st.side[e.by] === 0) {
        const tx = e.x >> 16;
        const ty = e.y >> 16;
        for (const zoneName of roe?.flagged_zones ?? []) {
          if (zoneContains(this.zone(zoneName), tx, ty)) {
            const last = this.zoneDeductedAt.get(zoneName);
            if (last === undefined || tick - last >= ZONE_DEDUCT_COOLDOWN) {
              this.zoneDeductedAt.set(zoneName, tick);
              deduct(roe?.flagged_structure_penalty ?? 5, `strike into protected structure (${zoneName})`);
            }
            break;
          }
        }
        for (const civ of this.civIds) {
          // A civilian underground cannot be endangered by surface ordnance:
          // applyDamage and applySuppression both refuse them, so charging
          // the player for their safety would bill restraint the combat
          // model just proved unnecessary. Their coordinates name a tile
          // they are not standing on.
          if (st.alive[civ] === 0 || st.tunnelIn[civ] >= 0) continue;
          const dx = (fx.sub(st.posX[civ], e.x) >> 8) | 0;
          const dy = (fx.sub(st.posY[civ], e.y) >> 8) | 0;
          if (dx * dx + dy * dy <= DANGER_CLOSE_SQ) {
            deduct(roe?.disproportionate_ordnance_penalty ?? 3, 'strike called danger-close to civilians');
            break;
          }
        }
      } else if (e.kind === 'fire' && st.side[e.shooter] === 0) {
        const type = this.sim.unitTypes[st.typeIdx[e.shooter]];
        const weapon = type.weapons.find((w) => w.id === e.weaponId);
        if (weapon !== undefined && weapon.collateralRisk >= HEAVY_COLLATERAL) {
          // The aimpoint is a unit, or a building when target is -1. Reading
          // position[-1] silently yields NaN, which coerced to distance zero
          // and charged every shot at a building as danger-close.
          let tx: number;
          let ty: number;
          if (e.target >= 0) {
            tx = st.posX[e.target];
            ty = st.posY[e.target];
          } else if (e.structure !== undefined && e.structure >= 0) {
            tx = this.sim.structures.cx[e.structure];
            ty = this.sim.structures.cy[e.structure];
          } else {
            continue;
          }
          for (const civ of this.civIds) {
            // Same rule as the strike loop above, and it needs its own line:
            // this branch runs per SHOT with no cooldown, so a buried family
            // under a firefight would walk the score to zero on its own.
            if (st.alive[civ] === 0 || st.tunnelIn[civ] >= 0) continue;
            const dx = (fx.sub(st.posX[civ], tx) >> 8) | 0;
            const dy = (fx.sub(st.posY[civ], ty) >> 8) | 0;
            if (dx * dx + dy * dy <= DANGER_CLOSE_SQ) {
              deduct(
                roe?.disproportionate_ordnance_penalty ?? 3,
                'heavy ordnance danger-close to civilians'
              );
              break;
            }
          }
        }
      }
    }
  }

  /** The civilian flight rule (`./civilians`), pointed at this mission's own
   *  refuge marker and its own player force. Shared with `?sandbox=<map>&civ`,
   *  which has no runtime and must not carry a second copy of the rule. */
  private stepCivilians(): void {
    const refuge = this.mission.civilians?.refuge;
    if (refuge === undefined) return;
    this.civFlight.step(this.sim, this.civIds, this.playerIds, this.markerPos(refuge));
  }

  private stepPatrols(): void {
    for (const p of this.patrols) {
      if (this.sim.state.alive[p.id] === 0) continue;
      // A buried patroller holds its place in the cycle: without this the
      // waypoint index advances at 20 Hz against orders the sim refuses, so
      // the patrol resumed from an arbitrary leg when the route vented — and
      // queued one dead command per tick for the whole mission meanwhile.
      if (this.sim.state.tunnelIn[p.id] >= 0) continue;
      if (this.sim.state.moving[p.id] === 1) continue;
      const [wx, wy] = p.waypoints[p.idx];
      p.idx = (p.idx + 1) % p.waypoints.length;
      this.sim.queueCommand({ kind: 'move', ids: [p.id], x: wx, y: wy });
    }
  }

  /**
   * Is the ground being fought over? True when a living enemy stands inside
   * the zone AND close enough to one of your units there to dispute it.
   */
  private contestedIn(zone: readonly number[]): boolean {
    const st = this.sim.state;
    const inZone = (i: number): boolean => {
      const tx = st.posX[i] >> 16;
      const ty = st.posY[i] >> 16;
      return tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3];
    };
    for (let e = 0; e < this.sim.entityCount; e++) {
      if (st.alive[e] === 0 || st.side[e] !== 1 || !inZone(e)) continue;
      // A buried unit contests nothing and anchors no contest — either side.
      // Without this, a stocked route whose spawn point sits inside the zone
      // holds a capture hostage from underground, with nothing on the map
      // for the player to shoot.
      if (st.tunnelIn[e] >= 0) continue;
      for (let f = 0; f < this.sim.entityCount; f++) {
        if (st.alive[f] === 0 || st.side[f] !== 0 || !inZone(f)) continue;
        if (st.tunnelIn[f] >= 0) continue;
        const dx = (fx.sub(st.posX[e], st.posX[f]) >> 8) | 0;
        const dy = (fx.sub(st.posY[e], st.posY[f]) >> 8) | 0;
        if (dx * dx + dy * dy <= CONTEST_RADIUS_SQ) return true;
      }
    }
    return false;
  }

  private livingIn(zone: readonly number[], side: number): number {
    let n = 0;
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0 || st.side[i] !== side) continue;
      // A buried unit holds no ground: its body coordinates name a tile it
      // is not standing on.
      if (st.tunnelIn[i] >= 0) continue;
      const tx = st.posX[i] >> 16;
      const ty = st.posY[i] >> 16;
      if (tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3]) n++;
    }
    return n;
  }

  private stepTriggers(tick: number, out: MissionEvent[]): void {
    const triggers = this.mission.triggers ?? [];
    for (let i = 0; i < triggers.length; i++) {
      if (this.firedTriggers[i]) continue;
      const t = triggers[i];
      let fire = false;
      if (t.on.kind === 'first_contact') {
        fire = this.firstContact;
      } else if (t.on.kind === 'timer_s') {
        fire = tick >= (t.on.value ?? 0) * TICKS_PER_SECOND;
      } else if (t.on.kind === 'casualties_pct') {
        const initial = this.enemyAtStart.length;
        if (initial > 0) {
          let dead = 0;
          // A removed enemy is not a casualty (an abduction, not a kill) --
          // `alive` alone cannot tell the two apart, since `removeFromPlay`
          // sets it exactly as `destroy()` does. `removed` is the one flag
          // that can, so a "50% casualties" trigger is not satisfied by the
          // enemy quietly losing a man to a `remove` trigger of its own.
          for (const id of this.enemyAtStart) {
            if (this.sim.state.alive[id] === 0 && this.sim.state.removed[id] !== 1) dead++;
          }
          fire = dead * 100 >= (t.on.value ?? 100) * initial;
        }
      } else if (t.on.kind === 'zone_entered') {
        const z = this.zone(t.on.zone);
        fire = z !== undefined && this.livingIn(z, 0) > 0;
      }
      if (!fire) continue;
      this.firedTriggers[i] = true;
      out.push({ kind: 'trigger', tick, id: t.id ?? `trigger_${i}` });
      if (t.say) out.push({ kind: 'say', tick, speaker: t.say.speaker, text: t.say.text });

      if (t.do.kind === 'commit' || t.do.kind === 'withdraw_to') {
        // Living AND on the surface: the sim would refuse the buried ids
        // anyway, but filtering here keeps the patrol-splice below honest —
        // a patroller must not lose its beat on the strength of an order it
        // never received. A fully buried group consumes the trigger and
        // commands nothing, which the mission log already records.
        const ids = (this.groups.get(t.do.group ?? '') ?? []).filter(
          (id) => this.sim.state.alive[id] === 1 && this.sim.state.tunnelIn[id] < 0,
        );
        if (ids.length > 0 && t.do.to) {
          const [x, y] = this.markerPos(t.do.to);
          this.sim.queueCommand({ kind: t.do.kind === 'commit' ? 'attackMove' : 'move', ids, x, y });
          // A trigger order overrides the standing stance, and for a patrol it
          // has to say so out loud. `stepPatrols` re-issues the next waypoint
          // the instant a unit stops moving, so without this the ordered move
          // completes and the patrol immediately walks the unit back the way it
          // came -- a `withdraw_to` that returns to the fight, and a `commit`
          // that wanders off it. Silent, and it defeated the trigger entirely.
          const ordered = new Set(ids);
          for (let k = this.patrols.length - 1; k >= 0; k--) {
            if (ordered.has(this.patrols[k].id)) this.patrols.splice(k, 1);
          }
        }
      } else if (t.do.kind === 'spawn') {
        for (const p of t.do.units ?? []) this.spawnPlacement(p, 1);
      } else if (t.do.kind === 'reinforce') {
        // Player-side arrival (GDD §6). `spawn` stays side-1-only so no
        // existing mission changes behaviour.
        for (const p of t.do.units ?? []) this.spawnPlacement(p, 0);
      } else if (t.do.kind === 'dismount') {
        // Everyone out of every carrier in the group. Queued as a command rather
        // than reaching into sim state, same as commit and withdraw_to.
        //
        // Silently does nothing when the group is empty, its carriers are dead,
        // or nobody is aboard. A trigger whose carrier was killed on the way in
        // is ordinary play, not an error -- and the squad has already bailed out
        // shaken, which is the interesting outcome.
        const ids = (this.groups.get(t.do.group ?? '') ?? []).filter(
          // A buried carrier does not open its doors: nobody dismounts into
          // solid earth. (The sim refuses the id too; this keeps the
          // `ids.length > 0` gate honest.)
          (id) => this.sim.state.alive[id] === 1 && this.sim.state.tunnelIn[id] < 0,
        );
        if (ids.length > 0) this.sim.queueCommand({ kind: 'unload', ids });
      } else if (t.do.kind === 'remove') {
        // The enemy's act: every living member of `group`, restricted to
        // `zone` when given, leaves play through `removeFromPlay` rather
        // than a command queued at the sim — there is no Command variant
        // for this, because nothing outside a mission trigger can ever
        // cause it (invariant 4 unaffected: the runtime is still the only
        // caller, and it resolves on a tick boundary with no RNG draw).
        // validate_data.mjs is what keeps `group` naming a real placement
        // and never covering the whole starting_force.
        const zone = t.do.zone !== undefined ? this.zone(t.do.zone) : undefined;
        const ids = (this.groups.get(t.do.group ?? '') ?? []).filter((id) => {
          if (this.sim.state.alive[id] !== 1) return false;
          if (zone === undefined) return true;
          return zoneContains(zone, this.sim.state.posX[id] >> 16, this.sim.state.posY[id] >> 16);
        });
        for (const id of ids) {
          const side = this.sim.state.side[id];
          const unit = this.sim.unitTypes[this.sim.state.typeIdx[id]].id;
          this.sim.removeFromPlay(id);
          out.push({ kind: 'removed', tick, entity: id, side, unit });
        }
      }
    }
  }

  private stepWaves(tick: number, out: MissionEvent[]): void {
    const waves = this.mission.enemy?.waves ?? [];
    for (let i = 0; i < waves.length; i++) {
      if (this.spawnedWaves[i]) continue;
      const w = waves[i];
      let due: boolean;
      if (w.trigger !== undefined) {
        due = this.objectives.some((o) => o.def.id === w.trigger && o.status === 'complete');
      } else {
        due = tick >= w.at_seconds * TICKS_PER_SECOND;
      }
      if (!due) continue;
      this.spawnedWaves[i] = true;
      const spawned: number[] = [];
      for (const u of w.units) {
        if (!u.from) throw new Error(`mission ${this.mission.id}: wave unit ${u.unit} has no "from"`);
        // `group`/`tag` pass through, so a wave can be addressed by the same
        // triggers a garrison can. Dropping them here is why `withdraw_to`,
        // `commit` and `eliminate_hvt` could not name a wave at all, and why
        // `wadi_halam_2_laager` works around it by spawning its four waves
        // through `timer_s` triggers instead (#88).
        spawned.push(
          ...this.spawnPlacement(
            { unit: u.unit, count: u.count, marker: u.from, group: u.group, tag: u.tag },
            1
          )
        );
      }
      out.push({ kind: 'wave', tick, count: spawned.length });
      if (w.to && spawned.length > 0) {
        const [x, y] = this.markerPos(w.to);
        this.sim.queueCommand({ kind: 'attackMove', ids: spawned, x, y });
      }
    }
  }

  private stepObjectives(tick: number, out: MissionEvent[]): void {
    for (const o of this.objectives) {
      if (o.status !== 'active') continue;
      const d = o.def;
      let complete = false;
      let failed = false;
      if (d.type === 'destroy_all') {
        complete = this.enemyIds.length > 0 && this.enemyIds.every((id) => this.sim.state.alive[id] === 0);
      } else if (d.type === 'raze') {
        const targets = this.razeTargets.get(d.id) ?? [];
        complete =
          targets.length > 0 && targets.every((s) => this.sim.structures.alive[s] === 0);
        // A deadline, for the same reason `evacuate_before` has one, and it is
        // load-bearing rather than flavour. The only way a player levels an
        // unoccupied building is the `demolish` order: no command aims gunfire
        // at a structure, the automatic structure-fire path needs a hostile
        // inside it, breaching is refused for side 0 on purpose, and a called
        // strike costs intel a mission need not grant. So losing every unit
        // with the ability makes a raze primary permanently impossible — and
        // without a way to fail it, `checkEnd` has no end condition to reach
        // and the mission becomes unwinnable and unlosable at once. That is the
        // exact trap the comment in `checkEnd` describes.
        //
        // `validate_data.mjs` requires `seconds` on any PRIMARY raze objective,
        // because a primary is what creates the trap; a secondary that quietly
        // never completes costs the player nothing.
        failed = !complete && d.seconds !== undefined && tick >= d.seconds * TICKS_PER_SECOND;
      } else if (d.type === 'collapse') {
        const targets = this.collapseTargets.get(d.id) ?? [];
        // `targets.length > 0` for the same reason raze has it: an empty zone
        // must not read as an instant win. validate_data.mjs refuses a zone
        // containing no tunnel mouths at authoring time; this guard is the
        // runtime backstop for content that skipped the validator.
        complete = targets.length > 0 && targets.every((r) => this.sim.tnAlive[r] === 0);
        // And the same deadline, for the same trap: the only way a route
        // comes down is a charge worked by a unit with the ability, so losing
        // every such unit makes a collapse primary permanently impossible.
        failed = !complete && d.seconds !== undefined && tick >= d.seconds * TICKS_PER_SECOND;
      } else if (d.type === 'eliminate_hvt') {
        const ids = this.tags.get(d.target ?? '') ?? [];
        complete = ids.length > 0 && ids.every((id) => this.sim.state.alive[id] === 0);
      } else if (d.type === 'locate') {
        if (d.target) {
          const ids = this.tags.get(d.target) ?? [];
          complete = ids.length > 0 && ids.every((id) => this.identified.has(id));
        } else {
          complete = this.identified.size >= (d.count ?? 1);
        }
      } else if (d.type === 'survive_until') {
        complete = tick >= (d.seconds ?? 60) * TICKS_PER_SECOND;
      } else if (d.type === 'capture') {
        const z = this.zone(d.target);
        const present = z !== undefined && this.livingIn(z, 0) > 0;
        const held = present && z !== undefined && !this.contestedIn(z);
        o.paused = held ? null : present ? 'contested' : 'unheld';
        if (held) o.holdTicks++;
        else o.holdTicks = 0; // taking ground has to be done in one go
        complete = o.holdTicks >= (d.seconds ?? 10) * TICKS_PER_SECOND;
      } else if (d.type === 'hold_for') {
        const z = this.zone(d.target);
        const present = z !== undefined && this.livingIn(z, 0) > 0;
        const held = present && z !== undefined && !this.contestedIn(z);
        o.paused = held ? null : present ? 'contested' : 'unheld';
        if (held) o.holdTicks++;
        complete = o.holdTicks >= (d.seconds ?? 60) * TICKS_PER_SECOND;
      } else if (d.type === 'evacuate_before') {
        const z = this.zone(d.target);
        // Say so on the way out. `collect` clears `alive`, which is the ONLY
        // record that this civilian left the map and the identical record a
        // casualty leaves -- so without this the renderer has no way to tell a
        // rescue from a killing, and drew the death pose for both. The ids
        // come back from the same branch that latched them, so the two cannot
        // disagree: exactly once per civilian, never for one who died.
        if (z !== undefined) {
          for (const civ of this.civFlight.collect(this.sim, this.civIds, z)) {
            out.push({ kind: 'evacuated', tick, entity: civ });
          }
        }
        complete = this.civFlight.evacuatedCount >= (d.count ?? 1);
        // The deadline is the whole point: a clock the player cannot see expire
        // is a hidden model (GDD §5.8), which is why this latches a status the
        // HUD already draws rather than failing silently.
        failed = !complete && tick >= (d.seconds ?? 300) * TICKS_PER_SECOND;
      }
      if (complete) {
        o.status = 'complete';
        out.push({ kind: 'objective', tick, id: d.id, status: 'complete' });
        if (d.say) out.push({ kind: 'say', tick, speaker: d.say.speaker, text: d.say.text });
      } else if (failed) {
        o.status = 'failed';
        out.push({ kind: 'objective', tick, id: d.id, status: 'failed' });
        if (d.say_on_fail) {
          out.push({ kind: 'say', tick, speaker: d.say_on_fail.speaker, text: d.say_on_fail.text });
        }
      }
    }
  }

  private checkEnd(tick: number, out: MissionEvent[]): void {
    const primaries = this.objectives.filter((o) => o.def.primary);
    const won = primaries.length > 0 && primaries.every((o) => o.status === 'complete');
    const wiped =
      this.playerIds.length > 0 && this.playerIds.every((id) => this.sim.state.alive[id] === 0);
    // An ROE collapse loses the mission even with objectives in hand — and so
    // does a failed primary. `evacuate_before` is the first objective type
    // that can become 'failed'; without this, a mission that marks one
    // primary and misses its deadline can never end: victory needs every
    // primary complete, defeat was wipe-or-ROE only, and the player is left
    // in a mission that is unwinnable and unlosable at once.
    const failedPrimary = primaries.some((o) => o.status === 'failed');
    const lost = wiped || this.roeFailed || failedPrimary;
    if (!lost && !won) return;

    this.ended = true;
    this.resultValue = lost ? 'defeat' : 'victory';
    const roeRating = this.roeScoreValue;

    // Produce the carry-over, filtered to the declared contract. Units that
    // killed something come back a level more veteran (cap 3).
    const survivors: string[] = [];
    const roster: LedgerRosterEntry[] = [];
    for (const id of this.playerIds) {
      if (this.sim.state.alive[id] !== 1) continue;
      const typeId = this.sim.unitTypes[this.sim.state.typeIdx[id]].id;
      survivors.push(typeId);
      let vet = this.sim.state.veterancy[id];
      if ((this.kills.get(id) ?? 0) > 0 && vet < 3) vet++;
      roster.push({ type: typeId, veterancy: vet });
    }
    // Best-of per mission. Storage only -- no averaging here, because an average is
    // division and this package bans floating point. See LedgerData['roe.mission_ratings'].
    const prevRatings = this.ctx.ledger?.['roe.mission_ratings'];
    const merged: Record<string, number> = {};
    if (prevRatings !== null && typeof prevRatings === 'object') {
      const prior = prevRatings as Record<string, number>;
      for (const k of Object.keys(prior)) merged[k] = prior[k];
    }
    const best = merged[this.mission.id];
    if (typeof best !== 'number' || roeRating > best) merged[this.mission.id] = roeRating;
    // Rebuilt in sorted key order -- after this mission's entry is merged in, not
    // before -- so the saved object is stable rather than insertion-ordered regardless
    // of which mission was just played. Matches how intel.marked_positions is sorted
    // below. (Sorting only the incoming prior keys and appending the current mission's
    // key afterward leaves *that* key out of order, which is the bug this guards.)
    const ratings: Record<string, number> = {};
    for (const k of Object.keys(merged).sort()) ratings[k] = merged[k];

    const produced: LedgerData = {};
    for (const key of this.mission.ledger.produces) {
      if (key === 'roster.surviving_units') produced[key] = roster;
      else if (key === 'roe.mission_ratings') produced[key] = ratings;
      else if (key === 'campaign.completed_missions') {
        const prevDone = this.ctx.ledger?.['campaign.completed_missions'];
        const done = Array.isArray(prevDone) ? [...prevDone] : [];
        if (this.resultValue === 'victory' && !done.includes(this.mission.id)) done.push(this.mission.id);
        produced[key] = done;
      }
      else if (key === 'civ.settlements_evacuated') produced[key] = this.civFlight.evacuatedCount;
      else if (key === 'intel.marked_positions') {
        // Union with what came in: intel accumulates across a campaign rather than
        // being replaced, so a later mission cannot un-know what an earlier one saw.
        // Sorted so the ledger is stable rather than insertion-ordered.
        const merged = new Set([...this.marked, ...this.markedThisMission]);
        produced[key] = [...merged].sort();
      }
      // Unknown keys: declared for the future, produced by nothing yet.
    }

    out.push({
      kind: 'missionEnd',
      tick,
      result: this.resultValue,
      roeRating,
      survivors,
      ledger: produced,
    });
  }
}
