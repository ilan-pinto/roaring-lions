// The deterministic core. Commands in → 20 Hz tick → state + events out
// (invariant 4). Struct-of-arrays over typed arrays: no per-entity object
// allocation inside the hot loops — GC pauses are visible at 400 units.
// Event payloads (a handful per tick) are the one sanctioned allocation.
//
// Tick order is part of the contract (replays depend on it):
//   commands → detection → combat (target/face/fire) → projectiles →
//   movement → upkeep (suppression decay, pins, cooldowns, APS reload).

import { fx, ONE, HALF, type Fx } from './fixed';
import { Rng } from './rng';
import { HASH_SEED, hashArray, hashWord } from './hash';
import { FlowField, DIR_NONE, DIR_VX, DIR_VY } from './flowfield';
import {
  structureTypeFromJson,
  STRUCT_DAMAGE,
  DEMO_TICKS,
  DEMO_RANGE_SQ,
  GARRISON_ENTER_RANGE_SQ,
  COLLAPSE_SHOCK_SQ,
  COLLAPSE_SHOCK,
  STRUCT_BASE_ACCURACY,
  PROTECTED_ROE,
  type StructureType,
  type StructureTypeJson,
} from './structures';
import {
  K_DETECT,
  CONTACT_DECAY,
  SUSPECTED_AT,
  IDENTIFIED_AT,
  LOST_AT,
  MOTION_SIG,
  COVER_SIG,
  OCCL_PER_COVER,
  FIRING_SIG_TICKS,
  MIN_DETECT_DIST_SQ,
  COVER_HIT,
  FALLOFF_SCALE,
  TARGET_MOTION_MOD,
  MOVING_STANCE_MOD,
  SUPP_K,
  PEN_SIGMA_MULT,
  SIGMA_MIN,
  OBLIQ_MAX,
  ERA_SHAPED_MULT,
  ARC_60,
  ARC_120,
  SOFT_ARMOR_LIMIT,
  COMP_CREW_SHAKEN,
  COMP_MOBILITY,
  COMP_FIREPOWER,
  COMP_BOTH,
  COMP_CATASTROPHIC,
  OVERMATCH_SHIFT_PER_Z,
  OVERMATCH_SHIFT_MAX,
  SUPP_DECAY,
  PIN_AT,
  UNPIN_AT,
  SUPP_CAP,
  NEAR_MISS_RADIUS_SQ,
  COVER_SUPP,
  HARMLESS_SUPP,
  BOUNCE_SUPP_MULT,
  CREW_SHAKEN_SUPP,
  SUPP_STAT_DIVISOR,
  APS_INTERCEPTABLE_MASK,
  APS_VEL_F,
  APS_SAT_WINDOW,
  APS_SAT_PENALTY,
  APS_SAT_CAP,
  PROJ_SPEED,
  SCATTER_BASE,
  AMBUSH_SIG,
  VET_ACC_BONUS,
  VET_SUPP_BONUS,
  DEFAULT_TURN_DEG_S,
  PIN_SPEED_SHIFT,
  ROUT_AFTER_TICKS,
  ROUT_SPEED_SHIFT,
  ROUT_DISTANCE,
  SWEEP_ARRIVE_SQ,
  LOAD_RANGE_SQ,
  BAILOUT_DAMAGE_FRAC,
  BAILOUT_SHOCK,
  KAMIKAZE_STRIKE_SQ,
  SMOKE_MAX,
  SMOKE_DECAY,
  SMOKE_RADIUS,
  SMOKE_BLOCKS_AT,
  SMOKE_HIT_MULT,
  SMOKE_HIT_FLOOR,
  SMOKE_COOLDOWN,
  SMOKE_RANGE_SQ,
  STRIKE_DAMAGE,
  STRIKE_SPLASH,
  STRIKE_SUPPRESSION,
  STRIKE_DELAY_TICKS,
  STRIKE_SCATTER,
  SWEEP_RADIUS_SQ,
  REGEN_DELAY_TICKS,
  REGEN_FRAC,
  REGEN_CAP,
} from './tuning';

export const TICKS_PER_SECOND = 20;
/** Tick length in Q16.16 seconds (65536 / 20, rounded). Time IS the tick
 *  counter; DT exists only for rate integration, never for wall clocks. */
export const DT = 3277;

// ---------------------------------------------------------------------------
// Schema-shaped input (structural: the sim declares the shape, imports nothing)
// ---------------------------------------------------------------------------

export interface WeaponJson {
  id: string;
  type: string;
  range_tiles: number;
  effective_range_tiles?: number;
  accuracy: number;
  penetration?: number;
  damage?: number;
  splash_tiles?: number;
  suppression?: number;
  rof_per_min?: number;
  min_range_tiles?: number;
  can_target?: string[];
  collateral_risk?: number;
}

export interface UnitTypeJson {
  id: string;
  name?: string;
  role?: string;
  abilities?: readonly string[];
  hull: {
    hp: number;
    armor: { front: number; side: number; rear: number; top?: number };
    era?: boolean;
    crew?: number;
    suppression_resistance?: number;
    /** Seats for infantry. 0 = carries nobody. */
    transport_slots?: number;
    /** Can ride inside a transport. Defaults from role — see FOOT_ROLES. */
    can_embark?: boolean;
    aps?: {
      base_pk?: number;
      magazine?: number;
      reload_s?: number;
      ineffective_vs?: string[];
    };
  };
  mobility: { speed_tiles_s: number; turn_rate_deg_s?: number };
  sensors: {
    optics: number;
    sight_tiles: number;
    signature?: number;
    thermal?: boolean;
    firing_signature_mult?: number;
  };
  weapons?: WeaponJson[];
}

/**
 * Roles that dismount and can ride inside a transport.
 *
 * A carrier is not a flatbed. The rule used to be "anything that is not itself
 * a carrier can be a passenger", which is true of a tank — so a box-select over
 * an armoured force filled an APC's seats with Merkavas and left the infantry
 * in the road. Thin armour is not the right test either: it would admit
 * technicals and drones.
 *
 * A unit may override this with `hull.can_embark`.
 */
const FOOT_ROLES = new Set(['infantry', 'at_team', 'artillery', 'engineer', 'sniper', 'support']);

/** Weapon classes as ints — string compares stay out of the hot loop. */
export const WEAPON_CLASS: Record<string, number> = {
  apfsds: 0,
  heat: 1,
  he: 2,
  atgm: 3,
  rpg: 4,
  small_arms: 5,
  hmg: 6,
  autocannon: 7,
  mortar: 8,
  rocket: 9,
  interceptor: 10,
  demolition: 11,
};

/** Classes that fire indirect — no line of sight needed, only a side contact. */
const INDIRECT_MASK = (1 << WEAPON_CLASS.mortar) | (1 << WEAPON_CLASS.rocket);
/** Shaped-charge family for ERA purposes. */
const SHAPED_MASK = (1 << WEAPON_CLASS.heat) | (1 << WEAPON_CLASS.atgm) | (1 << WEAPON_CLASS.rpg);

export interface WeaponStats {
  id: string;
  cls: number;
  range: Fx;
  rangeSq: Fx;
  effectiveRange: Fx;
  effectiveRangeSq: Fx;
  minRangeSq: Fx;
  accuracy: Fx;
  penetration: Fx;
  damage: Fx;
  splash: Fx;
  suppPerMiss: Fx;
  ticksBetweenShots: number;
  collateralRisk: Fx;
}

/** Every multiplier behind one shot's hit probability, and their product.
 *  GDD 5.2. Pure: computing these touches no state and no RNG. */
export interface HitFactors {
  p: Fx;
  accuracy: Fx;
  rangeFalloff: Fx;
  coverMod: Fx;
  motionMod: Fx;
  stanceMod: Fx;
  suppressionMod: Fx;
}

/**
 * What the overlay can say about a hovered target. Four outcomes rather than
 * a nullable shot, because "you have not identified that", "you cannot reach
 * that", and "this unit has gone to ground / is lying in ambush" are
 * different facts and the player needs to know which.
 */
export type HitProjection =
  | { kind: 'shot'; weaponId: string; pHit: Fx; hurts: boolean; factors: HitFactors }
  | { kind: 'unidentified' }
  | { kind: 'noSolution' }
  | { kind: 'holdingFire' };

export interface UnitType {
  id: string;
  /** Display name for the HUD; falls back to the id. */
  name: string;
  /** Schema role (mbt/infantry/drone/…) — presentation uses it for silhouettes. */
  role: string;
  /** Can fight from inside a building. */
  canGarrison: boolean;
  /** Can bring a building down by holding position beside it. */
  canDemolish: boolean;
  /** Flies into its target and is spent doing it. */
  isKamikaze: boolean;
  /** Seats for infantry. */
  transportSlots: number;
  /** Dismounted element: can ride inside a transport. */
  canEmbark: boolean;
  /** Trained observer: earns intel while holding position (GDD §3). */
  canMarkTarget: boolean;
  /** Carries smoke: the counterplay to prepared fire. */
  canSmoke: boolean;
  hp: Fx;
  armorFront: Fx;
  armorSide: Fx;
  armorRear: Fx;
  isSoft: boolean;
  era: boolean;
  suppResFactor: Fx; // incoming suppression multiplier, 1 - res/2
  hasAps: boolean;
  apsPk: Fx;
  apsMagazine: number;
  apsReloadTicks: number;
  apsIneffectiveMask: number;
  speed: Fx;
  stepPerTick: Fx;
  turnPerTick: Fx; // turns/tick
  optics: Fx;
  sight: Fx;
  sightSq: Fx;
  signature: Fx;
  firingSigMult: Fx;
  thermal: boolean;
  weapons: WeaponStats[];
}

function weaponFromJson(w: WeaponJson): WeaponStats {
  const rof = w.rof_per_min ?? 0;
  const tbs = rof > 0 ? fx.toInt(fx.div(fx.fromInt(60 * TICKS_PER_SECOND), fx.from(rof))) : 0;
  const cls = WEAPON_CLASS[w.type];
  if (cls === undefined) throw new Error(`unknown weapon type ${w.type}`);
  const range = fx.from(w.range_tiles);
  const minRange = fx.from(w.min_range_tiles ?? 0);
  const effRange = fx.from(w.effective_range_tiles ?? w.range_tiles);
  return {
    id: w.id,
    cls,
    range,
    rangeSq: fx.mul(range, range),
    effectiveRange: effRange,
    effectiveRangeSq: fx.mul(effRange, effRange),
    minRangeSq: fx.mul(minRange, minRange),
    accuracy: fx.from(w.accuracy),
    penetration: fx.from(w.penetration ?? 0),
    damage: fx.from(w.damage ?? 0),
    splash: fx.from(w.splash_tiles ?? 0),
    suppPerMiss: fx.div(fx.from(w.suppression ?? 0), fx.fromInt(SUPP_STAT_DIVISOR)),
    ticksBetweenShots: tbs > 0 ? tbs : 1,
    collateralRisk: fx.from(w.collateral_risk ?? 0),
  };
}

export function unitTypeFromJson(json: UnitTypeJson): UnitType {
  const aps = json.hull.aps;
  let apsMask = 0;
  for (const t of aps?.ineffective_vs ?? []) {
    if (t === 'apfsds' || t === 'kinetic') {
      apsMask |= (1 << WEAPON_CLASS.apfsds) | (1 << WEAPON_CLASS.autocannon);
    }
    if (t === 'gun_he') apsMask |= 1 << WEAPON_CLASS.he;
    if (t === 'small_arms') apsMask |= (1 << WEAPON_CLASS.small_arms) | (1 << WEAPON_CLASS.hmg);
  }
  const speed = fx.from(json.mobility.speed_tiles_s);
  const sight = fx.from(json.sensors.sight_tiles);
  const armorFront = fx.from(json.hull.armor.front);
  const suppRes = fx.from(json.hull.suppression_resistance ?? 1 / 2);
  const turnDeg = json.mobility.turn_rate_deg_s ?? DEFAULT_TURN_DEG_S;
  // deg/s → turns/tick: deg/360 * DT
  const turnPerTick = fx.mul(fx.div(fx.from(turnDeg), fx.fromInt(360)), DT);
  const abilities = json.abilities ?? [];
  return {
    id: json.id,
    name: json.name ?? json.id,
    role: json.role ?? '',
    canGarrison: abilities.includes('garrison'),
    canDemolish: abilities.includes('demolish'),
    isKamikaze: abilities.includes('kamikaze'),
    transportSlots: json.hull.transport_slots ?? 0,
    canEmbark: json.hull.can_embark ?? FOOT_ROLES.has(json.role ?? ''),
    canMarkTarget: abilities.includes('mark_target'),
    canSmoke: abilities.includes('smoke'),
    hp: fx.from(json.hull.hp),
    armorFront,
    armorSide: fx.from(json.hull.armor.side),
    armorRear: fx.from(json.hull.armor.rear),
    isSoft: armorFront < SOFT_ARMOR_LIMIT,
    era: json.hull.era ?? false,
    suppResFactor: fx.sub(ONE, suppRes >> 1),
    hasAps: aps !== undefined,
    apsPk: fx.from(aps?.base_pk ?? 0),
    apsMagazine: aps?.magazine ?? 0,
    apsReloadTicks: fx.toInt(fx.mul(fx.from(aps?.reload_s ?? 0), fx.fromInt(TICKS_PER_SECOND))),
    apsIneffectiveMask: apsMask,
    speed,
    stepPerTick: fx.mul(speed, DT),
    turnPerTick: turnPerTick > 0 ? turnPerTick : ONE,
    optics: fx.from(json.sensors.optics),
    sight,
    sightSq: fx.mul(sight, sight),
    signature: fx.from(json.sensors.signature ?? 1),
    firingSigMult: fx.from(json.sensors.firing_signature_mult ?? 4),
    thermal: json.sensors.thermal ?? false,
    weapons: (json.weapons ?? []).map(weaponFromJson),
  };
}

// ---------------------------------------------------------------------------
// Commands and events
// ---------------------------------------------------------------------------

export type Command =
  | { kind: 'move'; ids: number[]; x: Fx; y: Fx; append?: boolean }
  | { kind: 'attackMove'; ids: number[]; x: Fx; y: Fx; append?: boolean }
  | { kind: 'halt'; ids: number[] }
  | { kind: 'garrison'; ids: number[]; structure: number }
  /** Climb aboard a vehicle with seats. */
  | { kind: 'load'; ids: number[]; carrier: number }
  /** Put the passengers down beside the vehicle. */
  | { kind: 'unload'; ids: number[] }
  /** Bought with intel: reveal everything hostile around a point. */
  | { kind: 'reveal'; side: number; x: Fx; y: Fx }
  /** Bought with intel: a precision strike, attributed to the caller so
   *  ROE charges it to the player who ordered it. */
  | { kind: 'callStrike'; caller: number; x: Fx; y: Fx }
  /** Lay a screen: the counterplay to prepared fire. */
  | { kind: 'smoke'; ids: number[]; x: Fx; y: Fx };

export type ContactLevel = 'suspected' | 'identified' | 'lost';
export type FacingArc = 'front' | 'side' | 'rear';
export type ComponentResult =
  | 'crew_shaken'
  | 'mobility_kill'
  | 'firepower_kill'
  | 'combat_ineffective'
  | 'catastrophic';

/** Every roll the model makes is on an event, in full, for the debug overlay.
 *  All numeric payloads are raw Q16.16 — the render side converts. */
export type SimEvent =
  | { kind: 'spawn'; tick: number; entity: number; typeId: string; side: number }
  | { kind: 'contact'; tick: number; side: number; target: number; level: ContactLevel; confidence: Fx }
  | {
      kind: 'fire';
      tick: number;
      shooter: number;
      /** Target unit, or -1 when the round is aimed at a building. */
      target: number;
      /** Target structure when `target` is -1. */
      structure?: number;
      weaponId: string;
      pHit: Fx;
      roll: Fx;
      willHit: boolean;
      breakdown: {
        accuracy: Fx;
        rangeFalloff: Fx;
        coverMod: Fx;
        motionMod: Fx;
        stanceMod: Fx;
        suppressionMod: Fx;
      };
    }
  | { kind: 'aps'; tick: number; target: number; shooter: number; pIntercept: Fx; roll: Fx; intercepted: boolean }
  | {
      kind: 'impact';
      tick: number;
      shooter: number;
      target: number;
      weaponId: string;
      arc: FacingArc;
      effectiveArmor: Fx;
      penetration: Fx;
      pPen: Fx;
      roll: Fx;
      penetrated: boolean;
    }
  | { kind: 'component'; tick: number; target: number; result: ComponentResult; overmatch: Fx }
  | { kind: 'nearMiss'; tick: number; shooter: number; weaponId: string; x: Fx; y: Fx }
  | { kind: 'ambushSprung'; tick: number; entity: number }
  | { kind: 'strike'; tick: number; by: number; x: Fx; y: Fx }
  | { kind: 'smokeLaid'; tick: number; by: number; x: Fx; y: Fx }
  | { kind: 'revealed'; tick: number; side: number; count: number }
  | { kind: 'structureHit'; tick: number; structure: number; by: number; damage: Fx; hpLeft: Fx }
  | { kind: 'structureDestroyed'; tick: number; structure: number; by: number }
  | { kind: 'garrison'; tick: number; entity: number; structure: number; entered: boolean }
  | { kind: 'transport'; tick: number; entity: number; carrier: number; loaded: boolean }
  | { kind: 'routed'; tick: number; entity: number }
  | { kind: 'rallied'; tick: number; entity: number }
  | { kind: 'pinned'; tick: number; entity: number }
  | { kind: 'unpinned'; tick: number; entity: number }
  | { kind: 'destroyed'; tick: number; entity: number; by: number };

/** Every `SimEvent` kind, as a value.
 *
 *  A `type` cannot be iterated at runtime, and the tutorial validates step JSON
 *  against this list. `satisfies` ties it to the union: adding an event kind
 *  without adding it here fails typecheck.
 */
export const SIM_EVENT_KINDS = [
  'spawn', 'contact', 'fire', 'aps', 'impact', 'component', 'nearMiss', 'ambushSprung',
  'strike', 'smokeLaid', 'revealed', 'structureHit', 'structureDestroyed', 'garrison',
  'transport', 'routed', 'rallied', 'pinned', 'unpinned', 'destroyed',
] as const satisfies readonly SimEvent['kind'][];

/** Compile-time proof the list above covers the whole union.
 *
 *  `satisfies` catches a name that is not a kind. This catches a kind that is
 *  not in the list: add an event to `SimEvent` and forget this array, and
 *  `MissingSimEventKind` stops being `never`, so the alias below fails to
 *  compile naming the kind you forgot.
 */
type MissingSimEventKind = Exclude<SimEvent['kind'], (typeof SIM_EVENT_KINDS)[number]>;
type AssertNoMissingKind<T extends never> = T;
export type SimEventKindsAreExhaustive = AssertNoMissingKind<MissingSimEventKind>;

export interface SimConfig {
  seed: number;
  width: number;
  height: number;
  capacity: number;
}

/** Read-only detection factors for one observer→target pair (debug overlay). */
export interface DetectionDebug {
  visible: boolean;
  p: Fx;
  strength: Fx;
  signature: Fx;
  occlusion: Fx;
  distSq: Fx;
  confidence: Fx;
}

const PROJ_CAP = 1024;
const MAX_STRUCTURES = 256;
/** Queued path points per unit. Enough for a route around a block; a cap
 *  keeps the storage flat and the hash cheap. */
const MAX_WAYPOINTS = 8;

// ---------------------------------------------------------------------------

/** distance² in Q16.16 tile² without overflow: (d>>8)² == d²>>16 exactly
 *  enough for ranges; safe out to ±176 tiles. */
function distSqFx(dx: Fx, dy: Fx): Fx {
  const x = dx >> 8;
  const y = dy >> 8;
  return (x * x + y * y) | 0;
}

export class Sim {
  readonly width: number;
  readonly height: number;
  readonly capacity: number;
  tickCount = 0;

  readonly unitTypes: UnitType[] = [];
  readonly rng: Rng;

  readonly blocked: Uint8Array;
  readonly cover: Uint8Array;
  /** Smoke density per tile, 0-255. Presentation reads it; LOS respects it. */
  readonly smoke: Uint8Array;

  // --- entity SoA ---
  private count = 0;
  private readonly alive: Uint8Array;
  private readonly side: Uint8Array;
  private readonly typeIdx: Uint16Array;
  private readonly posX: Int32Array;
  private readonly posY: Int32Array;
  private readonly facing: Int32Array;
  private readonly hp: Int32Array;
  private readonly suppression: Int32Array;
  private readonly moving: Uint8Array;
  private readonly attackMove: Uint8Array;
  private readonly goalX: Int32Array;
  private readonly goalY: Int32Array;
  private readonly fieldRef: Int32Array;
  // combat state
  private readonly cooldown: Int32Array; // 2 slots per entity
  private readonly lastFired: Int32Array;
  private readonly engaging: Uint8Array;
  private readonly curTarget: Int32Array;
  /** Structure this unit is currently engaging, -1 when none. */
  private readonly curStructure: Int32Array;
  private readonly mobilityKilled: Uint8Array;
  private readonly firepowerKilled: Uint8Array;
  private readonly pinned: Uint8Array;
  /** 0 = normal, 1 = ambush (hold fire + minimum signature until sprung). */
  private readonly stance: Uint8Array;
  private readonly ambushRadiusSq: Int32Array;
  /** Structure this unit is fighting from, -1 when in the open. */
  private readonly garrisonedIn: Int32Array;
  /** Structure this unit has been ordered into but has not reached yet. */
  private readonly garrisonGoal: Int32Array;
  /** 1 when the unit actually changed position this tick. */
  private readonly displaced: Uint8Array;
  private readonly demoTicks: Int32Array;
  private readonly demoTarget: Int32Array;
  private readonly smokeCooldown: Int32Array;
  /** Queued path: points a unit walks after its current goal. */
  private readonly wpX: Int32Array;
  private readonly wpY: Int32Array;
  private readonly wpAttack: Uint8Array;
  private readonly wpCount: Uint8Array;
  /** Vehicle this unit is riding in, -1 when on its own feet. */
  private readonly carriedBy: Int32Array;
  /** Vehicle this unit has been ordered to board but has not reached. */
  private readonly boardGoal: Int32Array;
  private readonly passengers: Uint8Array;
  /** Called-for strikes still in the air. */
  private pendingStrikes: { x: Fx; y: Fx; by: number; readyTick: number }[] = [];

  // --- structure SoA ---
  private structureCount_ = 0;
  readonly structureTypes: StructureType[] = [];
  private readonly stAlive: Uint8Array;
  private readonly stHp: Int32Array;
  private readonly stMaxHp: Int32Array;
  private readonly stTypeIdx: Uint16Array;
  private readonly stOccupants: Uint8Array;
  private readonly stCx: Int32Array;
  private readonly stCy: Int32Array;
  private readonly stMinX: Int32Array;
  private readonly stMinY: Int32Array;
  private readonly stMaxX: Int32Array;
  private readonly stMaxY: Int32Array;
  /** Tile index lists, one per structure. Cold data — never touched in the
   *  hot loops, only on damage, collapse and targeting. */
  private readonly stTiles: number[][] = [];
  /** tile → structure index, -1 for open ground. */
  private readonly structureOfTile: Int32Array;
  private readonly pinnedTicks: Int32Array;
  private readonly routed: Uint8Array;
  private readonly lastDamagedTick: Int32Array;
  /** Veterancy 0-3, from the campaign ledger. Better aim, steadier nerve. */
  private readonly veterancy: Uint8Array;
  private readonly apsAmmo: Int32Array;
  private readonly apsReloadLeft: Int32Array;
  private readonly apsRecent: Int32Array;
  private readonly apsLastTick: Int32Array;
  /** contact confidence and state per (side, target): index side*capacity+target */
  private readonly contact: Int32Array;
  private readonly contactState: Uint8Array;
  private readonly seenThisTick: Uint8Array;
  /** Per (side, target): where that enemy was last actually observed, and
   *  whether that memory is still worth walking to. Troops do not forget a
   *  position the moment they lose sight of it. */
  private readonly lastSeenX: Int32Array;
  private readonly lastSeenY: Int32Array;
  private readonly lastSeenValid: Uint8Array;

  // --- projectile SoA (ring) ---
  private readonly prActive: Uint8Array;
  private readonly prShooter: Int32Array;
  private readonly prTarget: Int32Array;
  /** Structure this round is aimed at, -1 when it is aimed at a unit. */
  private readonly prStructure: Int32Array;
  private readonly prCls: Uint8Array;
  private readonly prWillHit: Uint8Array;
  private readonly prTicksLeft: Int32Array;
  private readonly prOriginX: Int32Array;
  private readonly prOriginY: Int32Array;
  private readonly prAimX: Int32Array;
  private readonly prAimY: Int32Array;
  private readonly prPen: Int32Array;
  private readonly prDamage: Int32Array;
  private readonly prSupp: Int32Array;
  private readonly prSplash: Int32Array;
  private readonly prWeaponIdx: Uint16Array; // typeIdx<<1 | slot, for event weapon ids

  /** Read-only view for the renderer/debug side. Never write through this —
   *  nothing outside the sim may mutate sim state (invariant 4). */
  readonly state: {
    readonly alive: Uint8Array;
    readonly side: Uint8Array;
    readonly typeIdx: Uint16Array;
    readonly posX: Int32Array;
    readonly posY: Int32Array;
    readonly facing: Int32Array;
    readonly hp: Int32Array;
    readonly suppression: Int32Array;
    readonly moving: Uint8Array;
    readonly pinned: Uint8Array;
    readonly mobilityKilled: Uint8Array;
    readonly firepowerKilled: Uint8Array;
    readonly apsAmmo: Int32Array;
    readonly veterancy: Uint8Array;
    /** Current primary engagement target per unit, -1 when none. */
    readonly curTarget: Int32Array;
    readonly routed: Uint8Array;
    /** Structure the unit is fighting from, -1 when in the open. */
    readonly garrisonedIn: Int32Array;
    /** Structure the unit is currently shooting at, -1 when none. */
    readonly curStructure: Int32Array;
    /** Vehicle this unit is riding in, -1 when on foot. */
    readonly carriedBy: Int32Array;
  };

  /** Read-only structure view for the renderer and HUD. */
  readonly structures: {
    readonly alive: Uint8Array;
    readonly hp: Int32Array;
    readonly maxHp: Int32Array;
    readonly typeIdx: Uint16Array;
    readonly occupants: Uint8Array;
    readonly cx: Int32Array;
    readonly cy: Int32Array;
    readonly minX: Int32Array;
    readonly minY: Int32Array;
    readonly maxX: Int32Array;
    readonly maxY: Int32Array;
  };

  private readonly seed: number;
  private commandQueue: Command[] = [];
  private pendingEvents: SimEvent[] = [];
  private readonly fields: FlowField[] = [];
  private readonly fieldByGoal = new Map<number, number>();

  constructor(config: SimConfig) {
    this.width = config.width;
    this.height = config.height;
    this.capacity = config.capacity;
    this.seed = config.seed | 0;
    this.rng = new Rng(config.seed, config.capacity);
    const n = config.capacity;
    const tiles = config.width * config.height;
    this.blocked = new Uint8Array(tiles);
    this.cover = new Uint8Array(tiles);
    this.smoke = new Uint8Array(tiles);
    this.alive = new Uint8Array(n);
    this.side = new Uint8Array(n);
    this.typeIdx = new Uint16Array(n);
    this.posX = new Int32Array(n);
    this.posY = new Int32Array(n);
    this.facing = new Int32Array(n);
    this.hp = new Int32Array(n);
    this.suppression = new Int32Array(n);
    this.moving = new Uint8Array(n);
    this.attackMove = new Uint8Array(n);
    this.goalX = new Int32Array(n);
    this.goalY = new Int32Array(n);
    this.fieldRef = new Int32Array(n).fill(-1);
    this.cooldown = new Int32Array(n * 2);
    this.lastFired = new Int32Array(n).fill(-100000);
    this.engaging = new Uint8Array(n);
    this.curTarget = new Int32Array(n).fill(-1);
    this.curStructure = new Int32Array(n).fill(-1);
    this.mobilityKilled = new Uint8Array(n);
    this.firepowerKilled = new Uint8Array(n);
    this.pinned = new Uint8Array(n);
    this.stance = new Uint8Array(n);
    this.ambushRadiusSq = new Int32Array(n);
    this.garrisonedIn = new Int32Array(n).fill(-1);
    this.garrisonGoal = new Int32Array(n).fill(-1);
    this.displaced = new Uint8Array(n);
    this.demoTicks = new Int32Array(n);
    this.demoTarget = new Int32Array(n).fill(-1);
    this.smokeCooldown = new Int32Array(n);
    this.wpX = new Int32Array(n * MAX_WAYPOINTS);
    this.wpY = new Int32Array(n * MAX_WAYPOINTS);
    this.wpAttack = new Uint8Array(n * MAX_WAYPOINTS);
    this.wpCount = new Uint8Array(n);
    this.carriedBy = new Int32Array(n).fill(-1);
    this.boardGoal = new Int32Array(n).fill(-1);
    this.passengers = new Uint8Array(n);
    const sc = MAX_STRUCTURES;
    this.stAlive = new Uint8Array(sc);
    this.stHp = new Int32Array(sc);
    this.stMaxHp = new Int32Array(sc);
    this.stTypeIdx = new Uint16Array(sc);
    this.stOccupants = new Uint8Array(sc);
    this.stCx = new Int32Array(sc);
    this.stCy = new Int32Array(sc);
    this.stMinX = new Int32Array(sc);
    this.stMinY = new Int32Array(sc);
    this.stMaxX = new Int32Array(sc);
    this.stMaxY = new Int32Array(sc);
    this.structureOfTile = new Int32Array(tiles).fill(-1);
    this.pinnedTicks = new Int32Array(n);
    this.routed = new Uint8Array(n);
    this.lastDamagedTick = new Int32Array(n).fill(-100000);
    this.veterancy = new Uint8Array(n);
    this.apsAmmo = new Int32Array(n);
    this.apsReloadLeft = new Int32Array(n);
    this.apsRecent = new Int32Array(n);
    this.apsLastTick = new Int32Array(n).fill(-100000);
    this.contact = new Int32Array(2 * n);
    this.contactState = new Uint8Array(2 * n);
    this.seenThisTick = new Uint8Array(2 * n);
    this.lastSeenX = new Int32Array(2 * n);
    this.lastSeenY = new Int32Array(2 * n);
    this.lastSeenValid = new Uint8Array(2 * n);

    this.prActive = new Uint8Array(PROJ_CAP);
    this.prShooter = new Int32Array(PROJ_CAP);
    this.prTarget = new Int32Array(PROJ_CAP);
    this.prStructure = new Int32Array(PROJ_CAP).fill(-1);
    this.prCls = new Uint8Array(PROJ_CAP);
    this.prWillHit = new Uint8Array(PROJ_CAP);
    this.prTicksLeft = new Int32Array(PROJ_CAP);
    this.prOriginX = new Int32Array(PROJ_CAP);
    this.prOriginY = new Int32Array(PROJ_CAP);
    this.prAimX = new Int32Array(PROJ_CAP);
    this.prAimY = new Int32Array(PROJ_CAP);
    this.prPen = new Int32Array(PROJ_CAP);
    this.prDamage = new Int32Array(PROJ_CAP);
    this.prSupp = new Int32Array(PROJ_CAP);
    this.prSplash = new Int32Array(PROJ_CAP);
    this.prWeaponIdx = new Uint16Array(PROJ_CAP);

    this.state = {
      alive: this.alive,
      side: this.side,
      typeIdx: this.typeIdx,
      posX: this.posX,
      posY: this.posY,
      facing: this.facing,
      hp: this.hp,
      suppression: this.suppression,
      moving: this.moving,
      pinned: this.pinned,
      mobilityKilled: this.mobilityKilled,
      firepowerKilled: this.firepowerKilled,
      apsAmmo: this.apsAmmo,
      veterancy: this.veterancy,
      curTarget: this.curTarget,
      routed: this.routed,
      garrisonedIn: this.garrisonedIn,
      curStructure: this.curStructure,
      carriedBy: this.carriedBy,
    };
    this.structures = {
      alive: this.stAlive,
      hp: this.stHp,
      maxHp: this.stMaxHp,
      typeIdx: this.stTypeIdx,
      occupants: this.stOccupants,
      cx: this.stCx,
      cy: this.stCy,
      minX: this.stMinX,
      minY: this.stMinY,
      maxX: this.stMaxX,
      maxY: this.stMaxY,
    };
  }

  get entityCount(): number {
    return this.count;
  }

  addUnitType(json: UnitTypeJson): number {
    this.unitTypes.push(unitTypeFromJson(json));
    return this.unitTypes.length - 1;
  }

  setBlocked(x: number, y: number, b: boolean): void {
    this.blocked[y * this.width + x] = b ? 1 : 0;
    this.recomputeFields();
  }

  /** Terrain changed (building raised or levelled): every cached flow field
   *  is stale. Flow fields are shared per destination, so this is cheap
   *  compared to the per-unit repathing it replaces. */
  private recomputeFields(): void {
    for (const [goal, idx] of this.fieldByGoal) {
      const gx = goal % this.width;
      this.fields[idx].compute(this.blocked, gx, (goal - gx) / this.width);
    }
  }

  setCover(x: number, y: number, c: number): void {
    this.cover[y * this.width + x] = c;
  }

  // ------------------------------------------------------------- structures

  get structureCount(): number {
    return this.structureCount_;
  }

  addStructureType(json: StructureTypeJson): number {
    this.structureTypes.push(structureTypeFromJson(json));
    return this.structureTypes.length - 1;
  }

  /** Raise a building over `tiles` (tile indices). Blocks until it falls. */
  addStructure(typeIdx: number, tiles: readonly number[]): number {
    if (this.structureCount_ >= MAX_STRUCTURES) throw new Error('too many structures');
    const type = this.structureTypes[typeIdx];
    if (type === undefined) throw new Error(`no structure type ${typeIdx}`);
    if (tiles.length === 0) throw new Error('structure has no tiles');
    const id = this.structureCount_++;
    const w = this.width;
    let minX = w;
    let minY = this.height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    for (const t of tiles) {
      const tx = t % w;
      const ty = (t - tx) / w;
      this.structureOfTile[t] = id;
      this.blocked[t] = 1;
      if (tx < minX) minX = tx;
      if (ty < minY) minY = ty;
      if (tx > maxX) maxX = tx;
      if (ty > maxY) maxY = ty;
      sumX += tx;
      sumY += ty;
    }
    this.stTiles[id] = [...tiles];
    this.stAlive[id] = 1;
    this.stTypeIdx[id] = typeIdx;
    this.stMaxHp[id] = fx.mul(type.hpPerTile, fx.fromInt(tiles.length));
    this.stHp[id] = this.stMaxHp[id];
    this.stOccupants[id] = 0;
    // Centroid of the footprint, tile centres.
    this.stCx[id] = fx.add(fx.div(fx.fromInt(sumX), fx.fromInt(tiles.length)), HALF);
    this.stCy[id] = fx.add(fx.div(fx.fromInt(sumY), fx.fromInt(tiles.length)), HALF);
    this.stMinX[id] = minX;
    this.stMinY[id] = minY;
    this.stMaxX[id] = maxX;
    this.stMaxY[id] = maxY;
    this.recomputeFields();
    return id;
  }

  /** Clamp a point to somewhere a unit can actually stand: inside the map,
   *  a half tile off the edge. Orders past the border are common (a drag
   *  that overshoots) and must not walk anyone off the world. */
  private clampX(x: Fx): Fx {
    const lo = HALF;
    const hi = fx.sub(fx.fromInt(this.width), HALF);
    return x < lo ? lo : x > hi ? hi : x;
  }
  private clampY(y: Fx): Fx {
    const lo = HALF;
    const hi = fx.sub(fx.fromInt(this.height), HALF);
    return y < lo ? lo : y > hi ? hi : y;
  }

  /** Where a unit is currently headed, for drawing its route. */
  goalOf(id: number): [Fx, Fx] {
    return [this.goalX[id], this.goalY[id]];
  }

  /** How many infantry are riding in this vehicle. */
  passengerCount(id: number): number {
    return this.passengers[id];
  }

  /** How many path points a unit still has queued. */
  waypointCount(id: number): number {
    return this.wpCount[id];
  }

  /** Queued path point `i` (0 = next), for the renderer. */
  waypointAt(id: number, i: number): [Fx, Fx] {
    const k = id * MAX_WAYPOINTS + i;
    return [this.wpX[k], this.wpY[k]];
  }

  /** Structure occupying a tile, or -1. */
  structureAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    const s = this.structureOfTile[y * this.width + x];
    return s >= 0 && this.stAlive[s] === 1 ? s : -1;
  }

  /** Demolition charge progress 0..1 for the HUD. */
  demolitionProgress(id: number): number {
    return this.demoTicks[id] / DEMO_TICKS;
  }

  /** Dev/test hook: level a building instantly. */
  debugDestroyStructure(id: number): void {
    if (this.stAlive[id] === 1) this.destroyStructure(id, -1);
  }

  /** facing: initial hull heading in Q16.16 turns (deployment orientation —
   *  defenders face the expected threat axis). veterancy: 0-3 from the
   *  campaign ledger. */
  spawn(typeIdx: number, side: number, x: Fx, y: Fx, facing: Fx = 0, veterancy = 0): number {
    if (this.count >= this.capacity) throw new Error('sim at capacity');
    const type = this.unitTypes[typeIdx];
    if (type === undefined) throw new Error(`no unit type ${typeIdx}`);
    const id = this.count++;
    this.veterancy[id] = veterancy > 3 ? 3 : veterancy < 0 ? 0 : veterancy;
    this.alive[id] = 1;
    this.side[id] = side;
    this.typeIdx[id] = typeIdx;
    this.posX[id] = x;
    this.posY[id] = y;
    this.facing[id] = facing & 0xffff;
    this.hp[id] = type.hp;
    this.suppression[id] = 0;
    this.moving[id] = 0;
    this.attackMove[id] = 0;
    this.fieldRef[id] = -1;
    this.apsAmmo[id] = type.apsMagazine;
    this.pendingEvents.push({ kind: 'spawn', tick: this.tickCount, entity: id, typeId: type.id, side });
    return id;
  }

  queueCommand(cmd: Command): void {
    this.commandQueue.push(cmd);
  }

  /** Put a unit in ambush: hold fire and minimum signature until a target
   *  closes to `tiles` (Q16.16). Cleared when sprung or when re-ordered. */
  setAmbush(id: number, tiles: Fx): void {
    this.stance[id] = 1;
    this.ambushRadiusSq[id] = fx.mul(tiles, tiles);
  }

  /** Dev/test hook: place a unit somewhere directly (sandbox tooling). */
  teleport(id: number, x: Fx, y: Fx): void {
    this.posX[id] = x;
    this.posY[id] = y;
  }

  /** Dev/test hook: remove a unit as if destroyed (sandbox tooling). */
  debugKill(id: number): void {
    if (this.alive[id] === 1) this.destroy(id, -1);
  }

  /** Dev/test hook: disable a unit's firepower as if its weapons were
   *  knocked out (sandbox tooling). */
  debugDisableFirepower(id: number): void {
    this.firepowerKilled[id] = 1;
  }

  /** Advance exactly one 20 Hz tick. Returns the events it produced. */
  tick(): SimEvent[] {
    this.applyCommands();
    this.stepDetection();
    this.stepCombat();
    this.stepProjectiles();
    this.stepStrikes();
    this.stepKamikaze();
    this.stepSweep();
    this.stepMovement();
    this.stepTransport();
    this.stepSmoke();
    this.stepGarrison();
    this.stepDemolition();
    this.stepUpkeep();
    this.tickCount++;
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  // ----------------------------------------------------------------- commands

  private fieldFor(gx: number, gy: number): number {
    const key = gy * this.width + gx;
    const existing = this.fieldByGoal.get(key);
    if (existing !== undefined) return existing;
    const field = new FlowField(this.width, this.height);
    field.compute(this.blocked, gx, gy);
    const idx = this.fields.length;
    this.fields.push(field);
    this.fieldByGoal.set(key, idx);
    return idx;
  }

  private applyCommands(): void {
    const q = this.commandQueue;
    for (let c = 0; c < q.length; c++) {
      const cmd = q[c];
      if (cmd.kind === 'move' || cmd.kind === 'attackMove') {
        const gx = this.clampX(cmd.x);
        const gy = this.clampY(cmd.y);
        const fieldIdx = this.fieldFor(fx.toInt(gx), fx.toInt(gy));
        const attack = cmd.kind === 'attackMove' ? 1 : 0;
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue; // broken troops aren't listening
          // Appending to a unit already under way queues the point instead of
          // overriding it: that is how a player draws a route round a block.
          if (cmd.append === true && this.moving[id] === 1) {
            const n = this.wpCount[id];
            if (n < MAX_WAYPOINTS) {
              const k = id * MAX_WAYPOINTS + n;
              this.wpX[k] = gx;
              this.wpY[k] = gy;
              this.wpAttack[k] = attack;
              this.wpCount[id] = n + 1;
            }
            continue;
          }
          // A passenger is inside a vehicle and does not walk anywhere: the
          // carrier decides where it goes, and `unload` is how it gets out.
          // This used to disembark instead, which made the ordinary workflow
          // fail — a box-select still holds the infantry after they board, so
          // the next right-click dumped them in the road while the APC drove
          // off. They are already untargetable while aboard; being immune to
          // movement orders is the same idea.
          if (this.carriedBy[id] >= 0) continue;
          this.wpCount[id] = 0; // a fresh order replaces the whole path
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.boardGoal[id] = -1;
          this.garrisonGoal[id] = -1;
          this.goalX[id] = gx;
          this.goalY[id] = gy;
          this.fieldRef[id] = fieldIdx;
          this.moving[id] = 1;
          this.attackMove[id] = cmd.kind === 'attackMove' ? 1 : 0;
          this.engaging[id] = 0;
          this.stance[id] = 0; // any order overrides a held stance
        }
      } else if (cmd.kind === 'smoke') {
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || !this.unitTypes[this.typeIdx[id]].canSmoke) continue;
          if (this.smokeCooldown[id] > 0) continue;
          if (distSqFx(fx.sub(cmd.x, this.posX[id]), fx.sub(cmd.y, this.posY[id])) > SMOKE_RANGE_SQ) continue;
          this.smokeCooldown[id] = SMOKE_COOLDOWN;
          const cx = cmd.x >> 16;
          const cy = cmd.y >> 16;
          for (let y = cy - SMOKE_RADIUS; y <= cy + SMOKE_RADIUS; y++) {
            for (let x = cx - SMOKE_RADIUS; x <= cx + SMOKE_RADIUS; x++) {
              if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
              const ddx = x - cx;
              const ddy = y - cy;
              if (ddx * ddx + ddy * ddy > SMOKE_RADIUS * SMOKE_RADIUS) continue;
              this.smoke[y * this.width + x] = SMOKE_MAX;
            }
          }
          this.pendingEvents.push({
            kind: 'smokeLaid',
            tick: this.tickCount,
            by: id,
            x: cmd.x,
            y: cmd.y,
          });
        }
      } else if (cmd.kind === 'reveal') {
        // Certainty, purchased: contacts inside the footprint go straight to
        // identified, and are remembered so the sweep behaviour can use them.
        const cap = this.capacity;
        let count = 0;
        for (let t = 0; t < this.count; t++) {
          if (this.alive[t] === 0 || this.side[t] === cmd.side || this.side[t] > 1) continue;
          const d = distSqFx(fx.sub(this.posX[t], cmd.x), fx.sub(this.posY[t], cmd.y));
          if (d > SWEEP_RADIUS_SQ) continue;
          const k = cmd.side * cap + t;
          this.contact[k] = ONE;
          this.lastSeenX[k] = this.posX[t];
          this.lastSeenY[k] = this.posY[t];
          this.lastSeenValid[k] = 1;
          if (this.contactState[k] !== 2) {
            this.contactState[k] = 2;
            this.pendingEvents.push({
              kind: 'contact',
              tick: this.tickCount,
              side: cmd.side,
              target: t,
              level: 'identified',
              confidence: ONE,
            });
          }
          count++;
        }
        this.pendingEvents.push({ kind: 'revealed', tick: this.tickCount, side: cmd.side, count });
      } else if (cmd.kind === 'callStrike') {
        if (this.alive[cmd.caller] === 1) {
          // Guided, but not perfect: scatter is drawn from the caller's own
          // stream so replays stay identical (invariant 3).
          const ang = this.rng.nextU32(cmd.caller) & 0xffff;
          const rad = (this.rng.nextU32(cmd.caller) >>> 16) % (STRIKE_SCATTER + 1);
          this.pendingStrikes.push({
            x: fx.add(cmd.x, fx.mul(fx.cos(ang), rad)),
            y: fx.add(cmd.y, fx.mul(fx.sin(ang), rad)),
            by: cmd.caller,
            readyTick: this.tickCount + STRIKE_DELAY_TICKS,
          });
        }
      } else if (cmd.kind === 'load') {
        const car = cmd.carrier;
        if (car < 0 || car >= this.count || this.alive[car] === 0) continue;
        if (this.unitTypes[this.typeIdx[car]].transportSlots === 0) continue;
        // Walk to the vehicle; stepTransport puts them aboard on arrival.
        const gx = this.posX[car];
        const gy = this.posY[car];
        const fieldIdx = this.fieldFor(fx.toInt(gx), fx.toInt(gy));
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1 || id === car) continue;
          // Only dismounted elements ride. This also covers vehicle stacking,
          // since no carrier is a foot role.
          if (!this.unitTypes[this.typeIdx[id]].canEmbark) continue;
          if (this.carriedBy[id] >= 0) continue;
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.boardGoal[id] = car;
          this.wpCount[id] = 0;
          this.goalX[id] = gx;
          this.goalY[id] = gy;
          this.fieldRef[id] = fieldIdx;
          this.moving[id] = 1;
          this.attackMove[id] = 0;
          this.stance[id] = 0;
        }
      } else if (cmd.kind === 'unload') {
        for (const id of cmd.ids) this.unloadAll(id);
      } else if (cmd.kind === 'garrison') {
        const s = cmd.structure;
        if (s < 0 || s >= this.structureCount_ || this.stAlive[s] === 0) continue;
        // Walk to the doorway; stepGarrison lets them in when they arrive
        // and there is room. Overflow simply waits outside.
        const [gx, gy] = [this.stCx[s], this.stCy[s]];
        const fieldIdx = this.fieldFor(fx.toInt(gx), fx.toInt(gy));
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue;
          if (!this.unitTypes[this.typeIdx[id]].canGarrison) continue;
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.garrisonGoal[id] = s;
          this.goalX[id] = gx;
          this.goalY[id] = gy;
          this.fieldRef[id] = fieldIdx;
          this.moving[id] = 1;
          this.attackMove[id] = 0;
          this.engaging[id] = 0;
          this.stance[id] = 0;
        }
      } else {
        for (const id of cmd.ids) {
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.garrisonGoal[id] = -1;
          this.wpCount[id] = 0;
          this.moving[id] = 0;
          this.fieldRef[id] = -1;
          this.engaging[id] = 0;
          this.stance[id] = 0;
        }
      }
    }
    this.commandQueue = [];
  }

  // ---------------------------------------------------------------- detection

  /** Actually displacing this tick — not merely under a move order. An
   *  attack-mover halted to fight counts as stationary for stance, target
   *  motion, and signature purposes. */
  private isEffectivelyMoving(i: number): boolean {
    return this.moving[i] === 1 && !(this.attackMove[i] === 1 && this.engaging[i] === 1);
  }

  /** Smoke density crossed by a sight line (endpoints included). */
  private raySmoke(x0: number, y0: number, x1: number, y1: number): number {
    const w = this.width;
    let dx = x1 - x0;
    let dy = y1 - y0;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    let total = this.smoke[y0 * w + x0];
    for (;;) {
      if (x === x1 && y === y1) return total;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      total += this.smoke[y * w + x];
      if (x === x1 && y === y1) return total;
    }
  }

  /** Smoke density on a tile, for tests and presentation. */
  smokeAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.smoke[y * this.width + x];
  }

  /** Bresenham over tiles: -1 if a blocked tile interrupts the ray, else the
   *  number of cover tiles crossed (endpoints excluded, capped at 8). */
  private losRay(x0: number, y0: number, x1: number, y1: number): number {
    const w = this.width;
    // A building never blocks sight into or out of itself: men at the windows
    // can see and be seen. Only the structures at the ends of the ray are
    // transparent to it — everything between still blocks.
    const sFrom = this.structureOfTile[y0 * w + x0];
    const sTo = this.structureOfTile[y1 * w + x1];
    // A screen thick enough simply stops the sight line; thinner smoke
    // counts as obscuration below.
    const smoke = this.raySmoke(x0, y0, x1, y1);
    if (smoke >= SMOKE_BLOCKS_AT) return -1;
    const smokeCover = smoke > 0 ? 1 + ((smoke / SMOKE_MAX) | 0) : 0;
    let dx = x1 - x0;
    let dy = y1 - y0;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    let coverCount = smokeCover;
    for (;;) {
      if (x === x1 && y === y1) return coverCount;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return coverCount;
      const t = y * w + x;
      if (this.blocked[t] !== 0) {
        const st = this.structureOfTile[t];
        if (st < 0 || (st !== sFrom && st !== sTo)) return -1;
      }
      if (this.cover[t] !== 0 && coverCount < 8) coverCount++;
    }
  }

  /** Signature × strength × p for one observer→target pair. Shared by the
   *  detection system and the debug overlay (which is why it exists). */
  private detectionPair(obs: number, tgt: number): DetectionDebug {
    const none: DetectionDebug = {
      visible: false,
      p: 0,
      strength: 0,
      signature: 0,
      occlusion: ONE,
      distSq: 0,
      confidence: this.contact[this.side[obs] * this.capacity + tgt],
    };
    const oType = this.unitTypes[this.typeIdx[obs]];
    const tType = this.unitTypes[this.typeIdx[tgt]];
    const dx = fx.sub(this.posX[tgt], this.posX[obs]);
    const dy = fx.sub(this.posY[tgt], this.posY[obs]);
    const dSq = distSqFx(dx, dy);
    none.distSq = dSq;
    if (dSq > oType.sightSq) return none;
    const cov = this.losRay(
      this.posX[obs] >> 16,
      this.posY[obs] >> 16,
      this.posX[tgt] >> 16,
      this.posY[tgt] >> 16
    );
    if (cov < 0) return none;

    let sig = tType.signature;
    if (this.stance[tgt] === 1) sig = fx.mul(sig, AMBUSH_SIG);
    if (this.isEffectivelyMoving(tgt)) sig = fx.mul(sig, MOTION_SIG);
    if (this.tickCount - this.lastFired[tgt] < FIRING_SIG_TICKS) {
      sig = fx.mul(sig, tType.firingSigMult);
    }
    sig = fx.mul(sig, COVER_SIG[this.cover[(this.posY[tgt] >> 16) * this.width + (this.posX[tgt] >> 16)]]);

    const occl = fx.add(ONE, cov * OCCL_PER_COVER);
    const denom = fx.mul(fx.max(dSq, MIN_DETECT_DIST_SQ), occl);
    const strength = fx.div(fx.mul(oType.optics, sig), denom);
    const p = fx.sub(ONE, fx.expNeg(fx.mul(K_DETECT, fx.mul(strength, DT))));
    return {
      visible: true,
      p,
      strength,
      signature: sig,
      occlusion: occl,
      distSq: dSq,
      confidence: this.contact[this.side[obs] * this.capacity + tgt],
    };
  }

  /** Contact state of `target` as known to `side`: 0 unknown, 1 suspected,
   *  2 identified. Read-only accessor for the renderer/overlay. */
  contactLevel(side: number, target: number): number {
    return this.contactState[side * this.capacity + target];
  }

  /** Contact confidence 0..ONE of `target` as known to `side`. */
  contactConfidence(side: number, target: number): Fx {
    return this.contact[side * this.capacity + target];
  }

  /**
   * What would happen if `shooter` engaged `target` right now — the sim's own
   * hit calculation, without taking the shot. GDD 5.8: the player should know
   * what a shot will cost before paying for it.
   *
   * Eligibility deliberately mirrors bestTargetFor rather than inventing its
   * own rules, so the panel can never offer a shot the unit would refuse.
   *
   * bestTargetFor is not the whole gate, though: stepCombat holds fire
   * entirely — before target selection ever runs — for a pinned unit (gone
   * to ground, GDD 5.5) or an ambushing one that has not yet sprung (GDD
   * 5.5a). Mirror both checks exactly, in the same order stepCombat applies
   * them, so a suppressed or lying-in-wait unit never gets offered a shot it
   * would refuse to take.
   *
   * Note the identification test is on contact CONFIDENCE, not contactState.
   * contactState latches at 2 once confidence passes IDENTIFIED_AT and only
   * falls back below the much lower LOST_AT, so there is a wide band where the
   * level claims "identified" while bestTargetFor would skip the target.
   */
  projectHit(shooter: number, target: number): HitProjection {
    const cap = this.capacity;
    if (this.alive[shooter] === 0 || this.alive[target] === 0) return { kind: 'noSolution' };
    if (this.firepowerKilled[shooter] === 1) return { kind: 'noSolution' };
    // Gone to ground: no aimed return fire at all this tick (stepCombat).
    if (this.pinned[shooter] === 1) return { kind: 'holdingFire' };
    // Ambush: weapons stay cold until a target closes inside the trap radius
    // with LOS (stepCombat, via checkAmbushSpring) — regardless of which
    // enemy is being hovered.
    if (this.stance[shooter] === 1 && !this.checkAmbushSpring(shooter)) {
      return { kind: 'holdingFire' };
    }
    const sSide = this.side[shooter];
    // Civilians are never aimpoints; collateral comes from ordnance.
    if (this.side[target] === sSide || this.side[target] > 1) return { kind: 'noSolution' };
    // Men inside a building or aboard a vehicle cannot be shot at.
    if (this.garrisonedIn[target] >= 0 || this.carriedBy[target] >= 0) {
      return { kind: 'noSolution' };
    }
    if (this.contact[sSide * cap + target] < IDENTIFIED_AT) return { kind: 'unidentified' };

    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const type = this.unitTypes[this.typeIdx[shooter]];
    const tType = this.unitTypes[this.typeIdx[target]];

    let best: HitProjection = { kind: 'noSolution' };
    let bestP = -1;
    for (const w of type.weapons) {
      if (dSq > w.rangeSq || dSq < w.minRangeSq) continue;
      if ((INDIRECT_MASK & (1 << w.cls)) === 0) {
        if (this.losRay(px >> 16, py >> 16, tx >> 16, ty >> 16) < 0) continue;
      }
      const factors = this.hitFactors(shooter, w, target);
      if (factors.p <= bestP) continue;
      bestP = factors.p;
      best = {
        kind: 'shot',
        weaponId: w.id,
        pHit: factors.p,
        // bestTargetFor's own heuristic: a quarter of side armour, whatever
        // face is presented. Soft targets always qualify.
        hurts: tType.isSoft || w.penetration >= tType.armorSide >> 2,
        factors,
      };
    }
    return best;
  }

  /** Public read-only inspection for the debug overlay. */
  debugDetection(obs: number, tgt: number): DetectionDebug | null {
    if (this.alive[obs] === 0 || this.alive[tgt] === 0) return null;
    if (this.side[obs] === this.side[tgt]) return null;
    return this.detectionPair(obs, tgt);
  }

  private stepDetection(): void {
    const cap = this.capacity;
    this.seenThisTick.fill(0);
    for (let obs = 0; obs < this.count; obs++) {
      if (this.alive[obs] === 0) continue;
      const oSide = this.side[obs];
      if (oSide > 1) continue; // civilians (side 2) observe nothing
      for (let tgt = 0; tgt < this.count; tgt++) {
        if (this.alive[tgt] === 0 || this.side[tgt] === oSide) continue;
        const d = this.detectionPair(obs, tgt);
        if (!d.visible) continue;
        const k = oSide * cap + tgt;
        this.seenThisTick[k] = 1;
        this.lastSeenX[k] = this.posX[tgt];
        this.lastSeenY[k] = this.posY[tgt];
        this.lastSeenValid[k] = 1;
        const c = this.contact[k];
        this.contact[k] = fx.add(c, fx.mul(fx.sub(ONE, c), d.p));
      }
    }
    // Decay unobserved contacts; emit state transitions.
    for (let s = 0; s < 2; s++) {
      for (let tgt = 0; tgt < this.count; tgt++) {
        const k = s * cap + tgt;
        if (this.seenThisTick[k] === 0) {
          this.contact[k] = fx.mul(this.contact[k], CONTACT_DECAY);
        }
        const c = this.contact[k];
        const st = this.contactState[k];
        if (st < 2 && c >= IDENTIFIED_AT) {
          this.contactState[k] = 2;
          this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side: s, target: tgt, level: 'identified', confidence: c });
        } else if (st < 1 && c >= SUSPECTED_AT) {
          this.contactState[k] = 1;
          this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side: s, target: tgt, level: 'suspected', confidence: c });
        } else if (st > 0 && c < LOST_AT) {
          this.contactState[k] = 0;
          this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side: s, target: tgt, level: 'lost', confidence: c });
        }
      }
    }
  }

  // ------------------------------------------------------------------- combat

  private selectTarget(shooter: number, w: WeaponStats): number {
    const cap = this.capacity;
    const sSide = this.side[shooter];
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    let best = -1;
    let bestHurts = false;
    let bestDistSq = 0x7fffffff;
    for (let t = 0; t < this.count; t++) {
      // Civilians (side 2) are never targets — collateral comes from
      // ordnance, not aimpoints. That asymmetry is what ROE scores.
      if (this.alive[t] === 0 || this.side[t] === sSide || this.side[t] > 1) continue;
      // Men inside a building cannot be shot at: the building is in the way,
      // and taking it down is the only way to reach them.
      if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0) continue;
      if (this.contact[sSide * cap + t] < IDENTIFIED_AT) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
      if (dSq > w.rangeSq || dSq < w.minRangeSq) continue;
      if ((INDIRECT_MASK & (1 << w.cls)) === 0) {
        if (this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16) < 0) continue;
      }
      const tType = this.unitTypes[this.typeIdx[t]];
      // "Can this weapon plausibly hurt that?" — quarter of side armor is the
      // heuristic; soft targets always qualify. Suppressive fire at armor is
      // a fallback, not a preference.
      const hurts = tType.isSoft || w.penetration >= tType.armorSide >> 2;
      if (
        best === -1 ||
        (hurts && !bestHurts) ||
        (hurts === bestHurts && dSq < bestDistSq)
      ) {
        best = t;
        bestHurts = hurts;
        bestDistSq = dSq;
      }
    }
    return best;
  }

  /**
   * The nearest building holding identified enemies that this weapon can
   * reach and hurt. Buildings are only shot at when someone hostile is
   * inside — armies do not level a town for the sake of it, and ROE scores
   * the difference.
   */
  private selectStructureTarget(shooter: number, w: WeaponStats): number {
    const cap = this.capacity;
    const sSide = this.side[shooter];
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    let best = -1;
    let bestDistSq = 0x7fffffff;
    for (let s = 0; s < this.structureCount_; s++) {
      if (this.stAlive[s] === 0 || this.stOccupants[s] === 0) continue;
      // Protected sites are never engaged on a gunner's initiative.
      if (this.structureTypes[this.stTypeIdx[s]].roePenalty >= PROTECTED_ROE) continue;
      let hostileInside = false;
      for (let t = 0; t < this.count; t++) {
        if (this.alive[t] === 0 || this.garrisonedIn[t] !== s) continue;
        if (this.side[t] === sSide || this.side[t] > 1) continue;
        if (this.contact[sSide * cap + t] >= IDENTIFIED_AT) {
          hostileInside = true;
          break;
        }
      }
      if (!hostileInside) continue;
      const dSq = this.structDistSq(s, px, py);
      if (dSq > w.rangeSq || dSq < w.minRangeSq || dSq >= bestDistSq) continue;
      if ((INDIRECT_MASK & (1 << w.cls)) === 0) {
        const [tx, ty] = this.nearestStructTile(s, px, py);
        if (this.losRay(px >> 16, py >> 16, tx >> 16, ty >> 16) < 0) continue;
      }
      best = s;
      bestDistSq = dSq;
    }
    return best;
  }

  /** True when any living enemy is inside the ambush radius with LOS. */
  private checkAmbushSpring(i: number): boolean {
    const mySide = this.side[i];
    const px = this.posX[i];
    const py = this.posY[i];
    const rSq = this.ambushRadiusSq[i];
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === mySide || this.side[t] > 1) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
      if (dSq > rSq) continue;
      if (this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16) >= 0) return true;
    }
    return false;
  }

  /** Flee away from the nearest threat this unit's side knows about. */
  private startRout(i: number): void {
    const mySide = this.side[i];
    let nx = -ONE;
    let ny = 0;
    let bestSq = 0x7fffffff;
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === mySide || this.side[t] > 1) continue;
      if (this.contact[mySide * this.capacity + t] < SUSPECTED_AT) continue;
      const dx = fx.sub(this.posX[i], this.posX[t]);
      const dy = fx.sub(this.posY[i], this.posY[t]);
      const dSq = distSqFx(dx, dy);
      if (dSq < bestSq) {
        bestSq = dSq;
        const d = fx.sqrt(fx.max(dSq, 1));
        nx = fx.div(dx, d);
        ny = fx.div(dy, d);
      }
    }
    const gx = fx.clamp(fx.add(this.posX[i], fx.mul(nx, ROUT_DISTANCE)), ONE, (this.width - 2) * ONE);
    const gy = fx.clamp(fx.add(this.posY[i], fx.mul(ny, ROUT_DISTANCE)), ONE, (this.height - 2) * ONE);
    this.goalX[i] = gx;
    this.goalY[i] = gy;
    this.fieldRef[i] = -1; // straight-line flight; the wall guard slides them
    this.moving[i] = 1;
    this.attackMove[i] = 0;
    this.engaging[i] = 0;
    this.stance[i] = 0;
  }

  /** Rotate `id` toward `desired` at its turn rate. */
  private turnToward(id: number, desired: Fx): void {
    const type = this.unitTypes[this.typeIdx[id]];
    const da = fx.angleDiff(desired, this.facing[id]);
    const cap = type.turnPerTick;
    const step = fx.clamp(da, -cap, cap);
    this.facing[id] = (this.facing[id] + step) & 0xffff;
  }

  private stepCombat(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.firepowerKilled[i] === 1) continue;
      // Gone to ground (GDD 5.5): heads down, no aimed return fire. This is
      // the threshold that makes fire superiority — and the 3:1 rule — real:
      // enough volume silences a defense, not-enough leaves it lethal.
      if (this.pinned[i] === 1) {
        this.engaging[i] = 0;
        this.curTarget[i] = -1;
        this.curStructure[i] = -1;
        continue;
      }
      // Ambush: weapons cold until a target closes to the trap range with a
      // clear line of sight — then spring and fight normally this same tick.
      if (this.stance[i] === 1) {
        if (!this.checkAmbushSpring(i)) {
          this.engaging[i] = 0;
          this.curTarget[i] = -1;
          this.curStructure[i] = -1;
          continue;
        }
        this.stance[i] = 0;
        this.pendingEvents.push({ kind: 'ambushSprung', tick: this.tickCount, entity: i });
      }
      const type = this.unitTypes[this.typeIdx[i]];
      if (type.weapons.length === 0) continue;

      // `engaging` (which halts an attack-mover) only latches once the primary
      // target is inside EFFECTIVE range — advancing units keep closing under
      // marching fire instead of stalling at maximum range to plink.
      let engagedClose = false;
      this.curStructure[i] = -1;
      for (let slot = 0; slot < type.weapons.length && slot < 2; slot++) {
        const w = type.weapons[slot];
        const target = this.selectTarget(i, w);
        if (slot === 0) this.curTarget[i] = target;
        if (target < 0) continue;
        const dSq = distSqFx(
          fx.sub(this.posX[target], this.posX[i]),
          fx.sub(this.posY[target], this.posY[i])
        );
        if (dSq <= w.effectiveRangeSq) engagedClose = true;

        // Hull turns toward the primary threat while stationary.
        if (slot === 0 && this.moving[i] === 0) {
          this.turnToward(
            i,
            fx.atan2(fx.sub(this.posY[target], this.posY[i]), fx.sub(this.posX[target], this.posX[i]))
          );
        }

        if (this.cooldown[i * 2 + slot] > 0) continue;
        this.fireAt(i, slot, w, target);
      }

      // Nothing in the open to shoot? Then the enemy is inside a building,
      // and the building becomes the target — if this weapon can hurt it.
      if (this.curTarget[i] < 0) {
        for (let slot = 0; slot < type.weapons.length && slot < 2; slot++) {
          const w = type.weapons[slot];
          if (STRUCT_DAMAGE[w.cls] === 0) continue;
          const s = this.selectStructureTarget(i, w);
          if (s < 0) continue;
          engagedClose = true;
          if (slot === 0) this.curStructure[i] = s;
          const [tx, ty] = this.nearestStructTile(s, this.posX[i], this.posY[i]);
          if (slot === 0 && this.moving[i] === 0) {
            this.turnToward(i, fx.atan2(fx.sub(ty, this.posY[i]), fx.sub(tx, this.posX[i])));
          }
          if (this.cooldown[i * 2 + slot] > 0) continue;
          this.fireAtStructure(i, slot, w, s, tx, ty);
        }
      }
      this.engaging[i] = engagedClose ? 1 : 0;
    }
  }

  /**
   * The hit probability for one shot, and every factor behind it.
   *
   * Pure by construction: it reads state and returns numbers. In particular it
   * does NOT roll — the RNG is a seeded per-entity stream (invariant 3), and
   * advancing it from anywhere but an actual shot would desync replays. `fireAt`
   * rolls; `projectHit` does not.
   */
  private hitFactors(shooter: number, w: WeaponStats, target: number): HitFactors {
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const dist = fx.sqrt(dSq);

    // GDD 5.2 — every factor is on the event for the overlay. Veterans shoot
    // straighter: the ledger's carry-over must be worth protecting.
    const accuracy = fx.min(
      fx.mul(w.accuracy, fx.add(ONE, this.veterancy[shooter] * VET_ACC_BONUS)),
      ONE
    );
    const ratio = fx.div(dist, w.effectiveRange);
    const rangeFalloff = fx.expNeg(fx.mul(FALLOFF_SCALE[w.cls], fx.mul(ratio, ratio)));
    let coverMod = COVER_HIT[this.cover[(ty >> 16) * this.width + (tx >> 16)]];
    // Shooting through a screen: every tile of it degrades the shot, with a
    // floor because blind fire still occasionally connects.
    const smokeOnLine = this.raySmoke(px >> 16, py >> 16, tx >> 16, ty >> 16);
    if (smokeOnLine > 0) {
      const tiles = 1 + ((smokeOnLine / SMOKE_MAX) | 0);
      let mult = ONE;
      for (let k = 0; k < tiles && mult > SMOKE_HIT_FLOOR; k++) mult = fx.mul(mult, SMOKE_HIT_MULT);
      coverMod = fx.mul(coverMod, mult < SMOKE_HIT_FLOOR ? SMOKE_HIT_FLOOR : mult);
    }
    const motionMod = this.isEffectivelyMoving(target) ? TARGET_MOTION_MOD : ONE;
    const stanceMod = this.isEffectivelyMoving(shooter) ? MOVING_STANCE_MOD : ONE;
    const suppressionMod = fx.div(ONE, fx.add(ONE, fx.mul(SUPP_K, this.suppression[shooter])));
    let p = fx.mul(accuracy, rangeFalloff);
    p = fx.mul(p, coverMod);
    p = fx.mul(p, motionMod);
    p = fx.mul(p, stanceMod);
    p = fx.mul(p, suppressionMod);
    return { p, accuracy, rangeFalloff, coverMod, motionMod, stanceMod, suppressionMod };
  }

  private fireAt(shooter: number, slot: number, w: WeaponStats, target: number): void {
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const dist = fx.sqrt(dSq);
    const { p, accuracy, rangeFalloff, coverMod, motionMod, stanceMod, suppressionMod } =
      this.hitFactors(shooter, w, target);

    const roll = this.rng.nextU32(shooter) >>> 16;
    const willHit = roll < p;

    this.cooldown[shooter * 2 + slot] = w.ticksBetweenShots;
    this.lastFired[shooter] = this.tickCount;

    // Aim point: the target now, or a scatter point nearby on a miss.
    let aimX = tx;
    let aimY = ty;
    if (!willHit) {
      const ang = this.rng.nextU32(shooter) & 0xffff;
      const rad = fx.add(SCATTER_BASE, this.rng.nextU32(shooter) >>> 16);
      aimX = fx.add(tx, fx.mul(fx.cos(ang), rad));
      aimY = fx.add(ty, fx.mul(fx.sin(ang), rad));
    }

    // Flight time from class speed; hitscan classes land next tick.
    const speed = PROJ_SPEED[w.cls];
    let ticks = 1;
    if (speed > 0) {
      const perTick = fx.mul(speed, DT);
      ticks = fx.toInt(fx.ceil(fx.div(dist, perTick)));
      if (ticks < 1) ticks = 1;
    }

    // Find a free projectile slot (deterministic linear scan).
    let pr = -1;
    for (let k = 0; k < PROJ_CAP; k++) {
      if (this.prActive[k] === 0) {
        pr = k;
        break;
      }
    }
    if (pr >= 0) {
      this.prActive[pr] = 1;
      this.prShooter[pr] = shooter;
      this.prTarget[pr] = target;
      this.prStructure[pr] = -1;
      this.prCls[pr] = w.cls;
      this.prWillHit[pr] = willHit ? 1 : 0;
      this.prTicksLeft[pr] = ticks;
      this.prOriginX[pr] = px;
      this.prOriginY[pr] = py;
      this.prAimX[pr] = aimX;
      this.prAimY[pr] = aimY;
      this.prPen[pr] = w.penetration;
      this.prDamage[pr] = w.damage;
      this.prSupp[pr] = w.suppPerMiss;
      this.prSplash[pr] = w.splash;
      this.prWeaponIdx[pr] = ((this.typeIdx[shooter] << 1) | slot) & 0xffff;
    }

    this.pendingEvents.push({
      kind: 'fire',
      tick: this.tickCount,
      shooter,
      target,
      weaponId: w.id,
      pHit: p,
      roll,
      willHit,
      breakdown: { accuracy, rangeFalloff, coverMod, motionMod, stanceMod, suppressionMod },
    });
  }

  /**
   * Put a round into a building. A house does not dodge, so there is no
   * facing, no penetration curve and almost no miss — only the question of
   * whether the round is the sort that hurts masonry.
   */
  private fireAtStructure(shooter: number, slot: number, w: WeaponStats, s: number, tx: Fx, ty: Fx): void {
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const dist = fx.sqrt(distSqFx(fx.sub(tx, px), fx.sub(ty, py)));
    const ratio = fx.div(dist, w.effectiveRange);
    const rangeFalloff = fx.expNeg(fx.mul(FALLOFF_SCALE[w.cls], fx.mul(ratio, ratio)));
    const suppressionMod = fx.div(ONE, fx.add(ONE, fx.mul(SUPP_K, this.suppression[shooter])));
    let p = fx.mul(STRUCT_BASE_ACCURACY, rangeFalloff);
    p = fx.mul(p, suppressionMod);
    const roll = this.rng.nextU32(shooter) >>> 16;
    const willHit = roll < p;

    this.cooldown[shooter * 2 + slot] = w.ticksBetweenShots;
    this.lastFired[shooter] = this.tickCount;

    const speed = PROJ_SPEED[w.cls];
    let ticks = 1;
    if (speed > 0) {
      const perTick = fx.mul(speed, DT);
      ticks = fx.toInt(fx.ceil(fx.div(dist, perTick)));
      if (ticks < 1) ticks = 1;
    }
    let pr = -1;
    for (let k = 0; k < PROJ_CAP; k++) {
      if (this.prActive[k] === 0) {
        pr = k;
        break;
      }
    }
    if (pr >= 0) {
      this.prActive[pr] = 1;
      this.prShooter[pr] = shooter;
      this.prTarget[pr] = -1;
      this.prStructure[pr] = s;
      this.prCls[pr] = w.cls;
      this.prWillHit[pr] = willHit ? 1 : 0;
      this.prTicksLeft[pr] = ticks;
      this.prOriginX[pr] = px;
      this.prOriginY[pr] = py;
      this.prAimX[pr] = tx;
      this.prAimY[pr] = ty;
      this.prPen[pr] = w.penetration;
      this.prDamage[pr] = w.damage;
      this.prSupp[pr] = w.suppPerMiss;
      this.prSplash[pr] = w.splash;
      this.prWeaponIdx[pr] = ((this.typeIdx[shooter] << 1) | slot) & 0xffff;
    }

    this.pendingEvents.push({
      kind: 'fire',
      tick: this.tickCount,
      shooter,
      target: -1,
      structure: s,
      weaponId: w.id,
      pHit: p,
      roll,
      willHit,
      breakdown: {
        accuracy: STRUCT_BASE_ACCURACY,
        rangeFalloff,
        coverMod: ONE,
        motionMod: ONE,
        stanceMod: ONE,
        suppressionMod,
      },
    });
  }

  // -------------------------------------------------------------- projectiles

  private weaponOf(pr: number): WeaponStats {
    const packed = this.prWeaponIdx[pr];
    const type = this.unitTypes[packed >> 1];
    return type.weapons[packed & 1];
  }

  /** Ordnance called in from off the map. Damage falls off with distance,
   *  buildings take structural damage, and everyone nearby is shaken —
   *  including civilians, which is what ROE will charge for. */
  private stepStrikes(): void {
    if (this.pendingStrikes.length === 0) return;
    const still: { x: Fx; y: Fx; by: number; readyTick: number }[] = [];
    for (const s of this.pendingStrikes) {
      if (this.tickCount < s.readyTick) {
        still.push(s);
        continue;
      }
      this.pendingEvents.push({ kind: 'strike', tick: this.tickCount, by: s.by, x: s.x, y: s.y });
      const splashSq = fx.mul(STRIKE_SPLASH, STRIKE_SPLASH);
      for (let i = 0; i < this.count; i++) {
        if (this.alive[i] === 0) continue;
        const dSq = distSqFx(fx.sub(this.posX[i], s.x), fx.sub(this.posY[i], s.y));
        if (dSq > splashSq) continue;
        const falloff = fx.sub(ONE, fx.div(fx.sqrt(dSq), STRIKE_SPLASH));
        this.applyDamage(i, fx.mul(STRIKE_DAMAGE, falloff), s.by);
        this.applySuppression(i, fx.mul(STRIKE_SUPPRESSION, falloff), false);
      }
      for (let st = 0; st < this.structureCount_; st++) {
        if (this.stAlive[st] === 0) continue;
        if (this.structDistSq(st, s.x, s.y) > splashSq) continue;
        this.damageStructure(st, fx.mul(STRIKE_DAMAGE, ONE + ONE), s.by);
      }
    }
    this.pendingStrikes = still;
  }

  private stepProjectiles(): void {
    for (let pr = 0; pr < PROJ_CAP; pr++) {
      if (this.prActive[pr] === 0) continue;
      if (--this.prTicksLeft[pr] > 0) continue;
      this.prActive[pr] = 0;
      this.resolveProjectile(pr);
    }
  }

  private resolveProjectile(pr: number): void {
    const struct = this.prStructure[pr];
    if (struct >= 0) {
      this.prStructure[pr] = -1;
      if (this.stAlive[struct] === 1 && this.prWillHit[pr] === 1) {
        // Masonry has no facing and no penetration roll: how much a round
        // hurts a building is a property of the round (STRUCT_DAMAGE).
        const dmg = fx.mul(this.prDamage[pr], STRUCT_DAMAGE[this.prCls[pr]]);
        this.damageStructure(struct, dmg, this.prShooter[pr]);
      } else {
        this.groundImpact(pr, this.prAimX[pr], this.prAimY[pr]);
      }
      return;
    }
    const target = this.prTarget[pr];
    const cls = this.prCls[pr];
    const targetAlive = this.alive[target] === 1;

    // Trophy-class APS engages any inbound shaped charge, hit or miss —
    // the defender cannot know which is which (GDD 5.6).
    if (targetAlive && (APS_INTERCEPTABLE_MASK & (1 << cls)) !== 0) {
      const tType = this.unitTypes[this.typeIdx[target]];
      if (tType.hasAps && (tType.apsIneffectiveMask & (1 << cls)) === 0 && this.apsAmmo[target] > 0) {
        let pI = fx.mul(tType.apsPk, APS_VEL_F[cls]);
        if (this.tickCount - this.apsLastTick[target] < APS_SAT_WINDOW) {
          const pen = fx.min(this.apsRecent[target] * APS_SAT_PENALTY, APS_SAT_CAP);
          pI = fx.mul(pI, fx.sub(ONE, pen));
        } else {
          this.apsRecent[target] = 0;
        }
        const roll = this.rng.nextU32(target) >>> 16;
        const intercepted = roll < pI;
        this.apsAmmo[target]--;
        this.apsRecent[target]++;
        this.apsLastTick[target] = this.tickCount;
        if (this.apsAmmo[target] === 0) this.apsReloadLeft[target] = tType.apsReloadTicks;
        this.pendingEvents.push({
          kind: 'aps',
          tick: this.tickCount,
          target,
          shooter: this.prShooter[pr],
          pIntercept: pI,
          roll,
          intercepted,
        });
        if (intercepted) return;
      }
    }

    if (this.prWillHit[pr] === 1 && targetAlive) {
      this.resolveHit(pr, target);
    } else {
      // Miss (or the target died in flight): ordnance lands at the aim point.
      // No exclusions — a scattered round can still splash its intended target.
      this.groundImpact(pr, this.prAimX[pr], this.prAimY[pr]);
    }
  }

  private resolveHit(pr: number, target: number): void {
    const tType = this.unitTypes[this.typeIdx[target]];
    const shooter = this.prShooter[pr];
    const w = this.weaponOf(pr);

    if (tType.isSoft) {
      // Soft targets: no armor plate to defeat. Damage applies on the hit;
      // getting shot at is suppressive whether or not it kills.
      this.applySuppression(target, fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT));
      this.applyDamage(target, this.prDamage[pr], shooter);
      if (this.prSplash[pr] > 0) this.splashAt(pr, this.posX[target], this.posY[target], target);
      return;
    }

    // Facing (GDD 5.3): angle of the incoming round relative to hull facing.
    const inc = fx.atan2(
      fx.sub(this.prOriginY[pr], this.posY[target]),
      fx.sub(this.prOriginX[pr], this.posX[target])
    );
    const rel = fx.abs(fx.angleDiff(inc, this.facing[target]));
    let arc: FacingArc;
    let armor: Fx;
    if (rel <= ARC_60) {
      arc = 'front';
      armor = tType.armorFront;
      // Obliquity: rounds arriving off-axis inside the arc see thicker plate.
      armor = fx.mul(armor, fx.add(ONE, fx.mul(OBLIQ_MAX, fx.div(rel, ARC_60))));
    } else if (rel >= ARC_120) {
      arc = 'rear';
      armor = tType.armorRear;
    } else {
      arc = 'side';
      armor = tType.armorSide;
    }
    if (tType.era && (SHAPED_MASK & (1 << this.prCls[pr])) !== 0) {
      armor = fx.mul(armor, ERA_SHAPED_MULT);
    }

    const pen = this.prPen[pr];
    const sigma = fx.max(fx.mul(PEN_SIGMA_MULT, pen), SIGMA_MIN);
    const z = fx.div(fx.sub(pen, armor), sigma);
    const pPen = fx.normCdf(z);
    const roll = this.rng.nextU32(shooter) >>> 16;
    const penetrated = roll < pPen;

    this.pendingEvents.push({
      kind: 'impact',
      tick: this.tickCount,
      shooter,
      target,
      weaponId: w.id,
      arc,
      effectiveArmor: armor,
      penetration: pen,
      pPen,
      roll,
      penetrated,
    });

    if (!penetrated) {
      // A clang on the hull is loud inside.
      this.applySuppression(target, fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT));
      return;
    }

    this.applyDamage(target, this.prDamage[pr], shooter);
    if (this.alive[target] === 1) this.rollComponent(target, shooter, z);
  }

  private rollComponent(target: number, shooter: number, z: Fx): void {
    // Weights shift with overmatch: crew_shaken → catastrophic (GDD 5.4).
    let shift = fx.toInt(fx.mul(fx.max(fx.sub(z, ONE), 0), fx.fromInt(OVERMATCH_SHIFT_PER_Z)));
    if (shift > OVERMATCH_SHIFT_MAX) shift = OVERMATCH_SHIFT_MAX;
    const wCrew = COMP_CREW_SHAKEN - shift;
    const wCat = COMP_CATASTROPHIC + shift;
    const total = wCrew + COMP_MOBILITY + COMP_FIREPOWER + COMP_BOTH + wCat;
    const draw = ((this.rng.nextU32(shooter) >>> 16) * total) >>> 16;

    let result: ComponentResult;
    if (draw < wCrew) result = 'crew_shaken';
    else if (draw < wCrew + COMP_MOBILITY) result = 'mobility_kill';
    else if (draw < wCrew + COMP_MOBILITY + COMP_FIREPOWER) result = 'firepower_kill';
    else if (draw < wCrew + COMP_MOBILITY + COMP_FIREPOWER + COMP_BOTH) result = 'combat_ineffective';
    else result = 'catastrophic';

    this.pendingEvents.push({ kind: 'component', tick: this.tickCount, target, result, overmatch: z });

    switch (result) {
      case 'crew_shaken':
        this.applySuppression(target, CREW_SHAKEN_SUPP, false);
        break;
      case 'mobility_kill':
        this.mobilityKilled[target] = 1;
        this.moving[target] = 0;
        this.fieldRef[target] = -1;
        break;
      case 'firepower_kill':
        this.firepowerKilled[target] = 1;
        break;
      case 'combat_ineffective':
        this.mobilityKilled[target] = 1;
        this.moving[target] = 0;
        this.fieldRef[target] = -1;
        this.firepowerKilled[target] = 1;
        this.applySuppression(target, CREW_SHAKEN_SUPP, false);
        break;
      case 'catastrophic':
        this.destroy(target, shooter);
        break;
    }
  }

  private groundImpact(pr: number, x: Fx, y: Fx): void {
    this.pendingEvents.push({
      kind: 'nearMiss',
      tick: this.tickCount,
      shooter: this.prShooter[pr],
      weaponId: this.weaponOf(pr).id,
      x,
      y,
    });
    // Near misses suppress everyone close to the impact, both sides — but
    // only in proportion to the threat. Rifle rounds cracking off a hull do
    // not button up a tank crew; a shell landing beside it does.
    const supp = this.prSupp[pr];
    if (supp > 0) {
      const pen = this.prPen[pr];
      const splash = this.prSplash[pr];
      for (let i = 0; i < this.count; i++) {
        if (this.alive[i] === 0) continue;
        const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
        if (dSq > NEAR_MISS_RADIUS_SQ) continue;
        const iType = this.unitTypes[this.typeIdx[i]];
        // Soft targets, blast weapons, and anything that could actually
        // punch the armour suppress fully; harmless small arms barely.
        const threatens = iType.isSoft || splash > 0 || pen >= iType.armorSide;
        this.applySuppression(i, threatens ? supp : fx.mul(supp, HARMLESS_SUPP));
      }
    }
    if (this.prSplash[pr] > 0) this.splashAt(pr, x, y, -1);
  }

  private splashAt(pr: number, x: Fx, y: Fx, excludeId: number): void {
    const splash = this.prSplash[pr];
    const splashSq = fx.mul(splash, splash);
    const dmg = this.prDamage[pr];
    const shooter = this.prShooter[pr];
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || i === excludeId) continue;
      const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
      if (dSq > splashSq) continue;
      const falloff = fx.sub(ONE, fx.div(fx.sqrt(dSq), splash));
      const scaled = fx.mul(dmg, falloff);
      const iType = this.unitTypes[this.typeIdx[i]];
      if (iType.isSoft) {
        this.applyDamage(i, scaled, shooter);
      }
      this.applySuppression(i, fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT));
    }
  }

  /** Splash from something that detonated in place rather than in flight. */
  private splashDirect(x: Fx, y: Fx, splash: Fx, dmg: Fx, supp: Fx, by: number, exclude: number): void {
    const splashSq = fx.mul(splash, splash);
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || i === exclude || i === by) continue;
      const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
      if (dSq > splashSq) continue;
      const falloff = fx.sub(ONE, fx.div(fx.sqrt(dSq), splash));
      if (this.unitTypes[this.typeIdx[i]].isSoft) this.applyDamage(i, fx.mul(dmg, falloff), by);
      this.applySuppression(i, fx.mul(supp, BOUNCE_SUPP_MULT));
    }
  }

  private applyDamage(target: number, dmg: Fx, by: number): void {
    if (dmg <= 0 || this.alive[target] === 0) return;
    // Inside a building or a vehicle, the hull takes it. Kill that first.
    if (this.garrisonedIn[target] >= 0 || this.carriedBy[target] >= 0) return;
    this.hp[target] = fx.sub(this.hp[target], dmg);
    this.lastDamagedTick[target] = this.tickCount;
    if (this.hp[target] <= 0) this.destroy(target, by);
  }

  /** coverProtects: fire arriving from outside is muffled by entrenchment;
   *  a penetration's crew shock (crew_shaken) is not. */
  private applySuppression(target: number, amount: Fx, coverProtects = true): void {
    const type = this.unitTypes[this.typeIdx[target]];
    let a = fx.mul(amount, type.suppResFactor);
    const vet = this.veterancy[target];
    if (vet > 0) a = fx.mul(a, fx.sub(ONE, vet * VET_SUPP_BONUS));
    if (coverProtects) {
      const cov = this.cover[(this.posY[target] >> 16) * this.width + (this.posX[target] >> 16)];
      a = fx.mul(a, COVER_SUPP[cov]);
    }
    const s = fx.add(this.suppression[target], a);
    this.suppression[target] = fx.min(s, SUPP_CAP);
  }

  // ------------------------------------------------- structures: the systems

  /** Squared distance from a point to the nearest tile centre of a structure. */
  private structDistSq(s: number, px: Fx, py: Fx): number {
    let best = 0x7fffffff;
    const w = this.width;
    for (const t of this.stTiles[s]) {
      const tx = t % w;
      const ty = (t - tx) / w;
      const d = distSqFx(
        fx.sub(fx.add(fx.fromInt(tx), HALF), px),
        fx.sub(fx.add(fx.fromInt(ty), HALF), py)
      );
      if (d < best) best = d;
    }
    return best;
  }

  /** Tile of `s` nearest to a point, as Q16.16 centre coordinates. */
  private nearestStructTile(s: number, px: Fx, py: Fx): [Fx, Fx] {
    let best = 0x7fffffff;
    let bx = this.stCx[s];
    let by = this.stCy[s];
    const w = this.width;
    for (const t of this.stTiles[s]) {
      const tx = t % w;
      const ty = (t - tx) / w;
      const cx = fx.add(fx.fromInt(tx), HALF);
      const cy = fx.add(fx.fromInt(ty), HALF);
      const d = distSqFx(fx.sub(cx, px), fx.sub(cy, py));
      if (d < best) {
        best = d;
        bx = cx;
        by = cy;
      }
    }
    return [bx, by];
  }

  /** First open tile beside a structure — where a garrison spills out. */
  private exitTile(s: number): [Fx, Fx] {
    const w = this.width;
    for (let y = this.stMinY[s] - 1; y <= this.stMaxY[s] + 1; y++) {
      for (let x = this.stMinX[s] - 1; x <= this.stMaxX[s] + 1; x++) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        if (this.blocked[y * w + x] === 0) {
          return [fx.add(fx.fromInt(x), HALF), fx.add(fx.fromInt(y), HALF)];
        }
      }
    }
    return [this.stCx[s], this.stCy[s]];
  }

  private enterStructure(id: number, s: number): void {
    this.garrisonedIn[id] = s;
    this.garrisonGoal[id] = -1;
    this.stOccupants[s]++;
    this.moving[id] = 0;
    this.fieldRef[id] = -1;
    this.posX[id] = this.stCx[s];
    this.posY[id] = this.stCy[s];
    this.pendingEvents.push({
      kind: 'garrison',
      tick: this.tickCount,
      entity: id,
      structure: s,
      entered: true,
    });
  }

  private leaveStructure(id: number): void {
    const s = this.garrisonedIn[id];
    if (s < 0) return;
    this.garrisonedIn[id] = -1;
    if (this.stOccupants[s] > 0) this.stOccupants[s]--;
    if (this.stAlive[s] === 1) {
      const [ex, ey] = this.exitTile(s);
      this.posX[id] = ex;
      this.posY[id] = ey;
    }
    this.pendingEvents.push({
      kind: 'garrison',
      tick: this.tickCount,
      entity: id,
      structure: s,
      entered: false,
    });
  }

  /** Put a passenger down beside its vehicle. */
  private disembark(id: number, shaken: boolean): void {
    const car = this.carriedBy[id];
    if (car < 0) return;
    this.carriedBy[id] = -1;
    if (this.passengers[car] > 0) this.passengers[car]--;
    // Step clear of the hull so they do not stack on it.
    this.posX[id] = this.clampX(fx.add(this.posX[car], HALF));
    this.posY[id] = this.clampY(fx.add(this.posY[car], HALF));
    this.moving[id] = 0;
    this.fieldRef[id] = -1;
    if (shaken) {
      const type = this.unitTypes[this.typeIdx[id]];
      this.applyDamage(id, fx.mul(type.hp, BAILOUT_DAMAGE_FRAC), -1);
      this.applySuppression(id, BAILOUT_SHOCK, false);
    }
    this.pendingEvents.push({
      kind: 'transport',
      tick: this.tickCount,
      entity: id,
      carrier: car,
      loaded: false,
    });
  }

  /** Everyone out. */
  private unloadAll(car: number): void {
    if (this.passengers[car] === 0) return;
    for (let i = 0; i < this.count; i++) {
      if (this.carriedBy[i] === car) this.disembark(i, false);
    }
  }

  /**
   * Riding: infantry that reach their vehicle climb in, travel at its speed,
   * and are untouchable while aboard — the trade is that losing the vehicle
   * costs the squad too.
   */
  private stepTransport(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      // Passengers ride with the hull.
      const car = this.carriedBy[i];
      if (car >= 0) {
        if (this.alive[car] === 0) {
          this.disembark(i, true);
          continue;
        }
        this.posX[i] = this.posX[car];
        this.posY[i] = this.posY[car];
        this.facing[i] = this.facing[car];
        continue;
      }
      // Boarding: close enough, and there is a seat.
      const goal = this.boardGoal[i];
      if (goal < 0) continue;
      if (this.alive[goal] === 0) {
        this.boardGoal[i] = -1;
        continue;
      }
      const slots = this.unitTypes[this.typeIdx[goal]].transportSlots;
      if (this.passengers[goal] >= slots) continue; // wait for a seat
      const d = distSqFx(fx.sub(this.posX[goal], this.posX[i]), fx.sub(this.posY[goal], this.posY[i]));
      if (d > LOAD_RANGE_SQ) {
        // Keep chasing a vehicle that has moved on.
        this.goalX[i] = this.posX[goal];
        this.goalY[i] = this.posY[goal];
        this.moving[i] = 1;
        continue;
      }
      this.carriedBy[i] = goal;
      this.boardGoal[i] = -1;
      this.passengers[goal]++;
      this.moving[i] = 0;
      this.fieldRef[i] = -1;
      this.pendingEvents.push({
        kind: 'transport',
        tick: this.tickCount,
        entity: i,
        carrier: goal,
        loaded: true,
      });
    }
  }

  /**
   * A loitering munition has one shot and is the shot: it closes on whatever
   * it has identified and detonates on arrival. No hit roll — it is flying
   * into the target, not shooting at it.
   */
  private stepKamikaze(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (!type.isKamikaze || type.weapons.length === 0) continue;
      const w = type.weapons[0];
      // It picks its own target by sight: a warhead's "range" is the blast,
      // not how far it can look, so normal weapon-range selection finds
      // nothing until it is already on top of someone.
      // Anything its SIDE has identified is fair game, not just what the
      // munition can see itself: these are cued by recon, which is what makes
      // the drone-and-strike loop worth paying intel for.
      const cap = this.capacity;
      const side = this.side[i];
      let target = -1;
      let bestD = 0x7fffffff;
      for (let t = 0; t < this.count; t++) {
        if (this.alive[t] === 0 || this.side[t] === side || this.side[t] > 1) continue;
        if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0) continue;
        if (this.contact[side * cap + t] < IDENTIFIED_AT) continue;
        const d = distSqFx(fx.sub(this.posX[t], this.posX[i]), fx.sub(this.posY[t], this.posY[i]));
        if (d <= bestD) {
          bestD = d;
          target = t;
        }
      }
      this.curTarget[i] = target;
      if (target < 0) continue;

      const dSq = distSqFx(
        fx.sub(this.posX[target], this.posX[i]),
        fx.sub(this.posY[target], this.posY[i])
      );
      if (dSq > KAMIKAZE_STRIKE_SQ) {
        // Run in: it steers itself, no order needed.
        this.goalX[i] = this.posX[target];
        this.goalY[i] = this.posY[target];
        this.fieldRef[i] = this.fieldFor(fx.toInt(this.posX[target]), fx.toInt(this.posY[target]));
        this.moving[i] = 1;
        this.attackMove[i] = 1;
        continue;
      }

      // Terminal. Hit the target directly, splash the rest, and be gone.
      const tType = this.unitTypes[this.typeIdx[target]];
      if (tType.isSoft) {
        this.applyDamage(target, w.damage, i);
      } else {
        const sigma = fx.max(fx.mul(PEN_SIGMA_MULT, w.penetration), SIGMA_MIN);
        const z = fx.div(fx.sub(w.penetration, tType.armorSide), sigma);
        const pPen = fx.normCdf(z);
        const roll = this.rng.nextU32(i) >>> 16;
        const penetrated = roll < pPen;
        this.pendingEvents.push({
          kind: 'impact',
          tick: this.tickCount,
          shooter: i,
          target,
          weaponId: w.id,
          arc: 'side',
          effectiveArmor: tType.armorSide,
          penetration: w.penetration,
          pPen,
          roll,
          penetrated,
        });
        if (penetrated) {
          this.applyDamage(target, w.damage, i);
          if (this.alive[target] === 1) this.rollComponent(target, i, z);
        } else {
          this.applySuppression(target, fx.mul(w.suppPerMiss, BOUNCE_SUPP_MULT));
        }
      }
      if (w.splash > 0) {
        this.splashDirect(this.posX[target], this.posY[target], w.splash, w.damage, w.suppPerMiss, i, target);
      }
      this.destroy(i, target);
    }
  }

  private stepGarrison(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const s = this.garrisonGoal[i];
      if (s < 0 || this.garrisonedIn[i] >= 0) continue;
      if (this.stAlive[s] === 0) {
        this.garrisonGoal[i] = -1;
        continue;
      }
      const type = this.structureTypes[this.stTypeIdx[s]];
      if (this.stOccupants[s] >= type.garrisonSlots) continue; // wait outside
      if (this.structDistSq(s, this.posX[i], this.posY[i]) <= GARRISON_ENTER_RANGE_SQ) {
        this.enterStructure(i, s);
      }
    }
  }

  /**
   * Demolition: a sapper team that holds position beside a building sets
   * charges. Moving loses the work — the tension is that the safest place to
   * stand is exactly where the defenders are shooting.
   */
  private stepDemolition(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (!type.canDemolish) continue;
      // Charges go in while the team is stationary — being ordered *at* a
      // building counts, since they stop against its wall.
      if (this.displaced[i] === 1 || this.pinned[i] === 1 || this.garrisonedIn[i] >= 0) {
        this.demoTicks[i] = 0;
        this.demoTarget[i] = -1;
        continue;
      }
      let best = -1;
      let bestD = DEMO_RANGE_SQ;
      for (let s = 0; s < this.structureCount_; s++) {
        if (this.stAlive[s] === 0) continue;
        if (this.stOccupants[s] > 0 && this.friendlyInside(s, this.side[i])) continue;
        const d = this.structDistSq(s, this.posX[i], this.posY[i]);
        if (d <= bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best < 0) {
        this.demoTicks[i] = 0;
        this.demoTarget[i] = -1;
        continue;
      }
      if (this.demoTarget[i] !== best) {
        this.demoTarget[i] = best;
        this.demoTicks[i] = 0;
      }
      if (++this.demoTicks[i] >= DEMO_TICKS) {
        this.demoTicks[i] = 0;
        this.demoTarget[i] = -1;
        this.destroyStructure(best, i);
      }
    }
  }

  /** True when anyone from `side` is garrisoned in this building. */
  private friendlyInside(s: number, side: number): boolean {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 1 && this.garrisonedIn[i] === s && this.side[i] === side) return true;
    }
    return false;
  }

  private damageStructure(s: number, amount: Fx, by: number): void {
    if (this.stAlive[s] === 0 || amount <= 0) return;
    this.stHp[s] = fx.sub(this.stHp[s], amount);
    this.pendingEvents.push({
      kind: 'structureHit',
      tick: this.tickCount,
      structure: s,
      by,
      damage: amount,
      hpLeft: this.stHp[s] > 0 ? this.stHp[s] : 0,
    });
    if (this.stHp[s] <= 0) this.destroyStructure(s, by);
  }

  /**
   * Collapse. The garrison goes with it — which is the whole point of
   * garrisoning: the building is the health bar, and taking it down is how
   * you kill what is inside.
   */
  private destroyStructure(s: number, by: number): void {
    if (this.stAlive[s] === 0) return;
    this.stAlive[s] = 0;
    this.stHp[s] = 0;
    const rubble = this.structureTypes[this.stTypeIdx[s]].rubbleCover;
    for (const t of this.stTiles[s]) {
      this.blocked[t] = 0;
      this.cover[t] = rubble;
    }
    this.pendingEvents.push({ kind: 'structureDestroyed', tick: this.tickCount, structure: s, by });
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      if (this.garrisonedIn[i] === s) {
        this.garrisonedIn[i] = -1;
        this.destroy(i, by);
        continue;
      }
      if (this.garrisonGoal[i] === s) this.garrisonGoal[i] = -1;
      // Everyone nearby eats the shock of a building coming down.
      const d = distSqFx(fx.sub(this.posX[i], this.stCx[s]), fx.sub(this.posY[i], this.stCy[s]));
      if (d <= COLLAPSE_SHOCK_SQ) this.applySuppression(i, COLLAPSE_SHOCK, false);
    }
    this.stOccupants[s] = 0;
    this.recomputeFields();
  }

  private destroy(target: number, by: number): void {
    // Anyone riding in it comes out now, hurt and shaken.
    if (this.passengers[target] > 0) {
      for (let i = 0; i < this.count; i++) {
        if (this.carriedBy[i] === target && this.alive[i] === 1) this.disembark(i, true);
      }
    }
    this.alive[target] = 0;
    for (let s = 0; s < 2; s++) this.lastSeenValid[s * this.capacity + target] = 0;
    this.hp[target] = 0;
    this.moving[target] = 0;
    this.engaging[target] = 0;
    this.fieldRef[target] = -1;
    this.pendingEvents.push({ kind: 'destroyed', tick: this.tickCount, entity: target, by });
  }

  /**
   * Attack-move without a contact: advance on the last place an enemy was
   * seen rather than standing still. Without this a single hidden defender
   * ends the fight in a staring contest that runs out the mission clock —
   * both sides alive, neither able to find the other.
   *
   * A position that has been reached and searched is forgotten, so a unit
   * works through what it knows and then stops, instead of pacing between
   * stale memories forever.
   */
  private stepSweep(): void {
    const cap = this.capacity;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.attackMove[i] === 0) continue;
      if (this.moving[i] === 1) continue; // already going somewhere
      if (this.garrisonedIn[i] >= 0 || this.routed[i] === 1 || this.pinned[i] === 1) continue;
      if (this.curTarget[i] >= 0) continue; // busy shooting something
      const side = this.side[i];

      // Anything we are standing on has been searched.
      for (let t = 0; t < this.count; t++) {
        const k = side * cap + t;
        if (this.lastSeenValid[k] === 0) continue;
        const d = distSqFx(
          fx.sub(this.lastSeenX[k], this.posX[i]),
          fx.sub(this.lastSeenY[k], this.posY[i])
        );
        if (d <= SWEEP_ARRIVE_SQ) this.lastSeenValid[k] = 0;
      }

      // Then walk to the nearest position still worth checking.
      let best = -1;
      let bestD = 0x7fffffff;
      for (let t = 0; t < this.count; t++) {
        const k = side * cap + t;
        if (this.lastSeenValid[k] === 0) continue;
        if (this.alive[t] === 0 || this.side[t] === side || this.side[t] > 1) {
          this.lastSeenValid[k] = 0;
          continue;
        }
        // Currently identified enemies are the combat step's problem.
        if (this.contactState[k] === 2) continue;
        const d = distSqFx(
          fx.sub(this.lastSeenX[k], this.posX[i]),
          fx.sub(this.lastSeenY[k], this.posY[i])
        );
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best < 0) continue;

      const gx = this.lastSeenX[best];
      const gy = this.lastSeenY[best];
      this.goalX[i] = gx;
      this.goalY[i] = gy;
      this.fieldRef[i] = this.fieldFor(fx.toInt(gx), fx.toInt(gy));
      this.moving[i] = 1;
    }
  }

  // ----------------------------------------------------------------- movement

  private stepMovement(): void {
    const w = this.width;
    this.displaced.fill(0);
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.moving[i] === 0 || this.mobilityKilled[i] === 1) continue;
      // Attack-movers halt to fight while they hold a target (stationary
      // stance emerges from this — no scripted bonus needed).
      if (this.attackMove[i] === 1 && this.engaging[i] === 1) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      const px = this.posX[i];
      const py = this.posY[i];
      const tileX = px >> 16;
      const tileY = py >> 16;
      const goalTileX = this.goalX[i] >> 16;
      const goalTileY = this.goalY[i] >> 16;

      let step = type.stepPerTick;
      if (this.routed[i] === 1) {
        step = step >> ROUT_SPEED_SHIFT; // fleeing at a crouch-run
      } else if (this.pinned[i] === 1) {
        step = step >> PIN_SPEED_SHIFT; // gone to ground
      }

      let nx: Fx;
      let ny: Fx;
      let arrived = false;
      let onFinalLeg = true;
      if (tileX !== goalTileX || tileY !== goalTileY) {
        const fRef = this.fieldRef[i];
        if (fRef >= 0) {
          const d = this.fields[fRef].dirs[tileY * w + tileX];
          if (d !== DIR_NONE) onFinalLeg = false;
        }
      }

      if (onFinalLeg) {
        let dx = fx.sub(this.goalX[i], px);
        let dy = fx.sub(this.goalY[i], py);
        const LIM = 3 * ONE;
        dx = fx.clamp(dx, -LIM, LIM);
        dy = fx.clamp(dy, -LIM, LIM);
        const dist = fx.sqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
        if (dist <= step) {
          nx = this.goalX[i];
          ny = this.goalY[i];
          arrived = true;
        } else {
          nx = fx.add(px, fx.div(fx.mul(dx, step), dist));
          ny = fx.add(py, fx.div(fx.mul(dy, step), dist));
        }
      } else {
        const fRef = this.fieldRef[i];
        const d = this.fields[fRef].dirs[tileY * w + tileX];
        nx = fx.add(px, fx.mul(DIR_VX[d], step));
        ny = fx.add(py, fx.mul(DIR_VY[d], step));
      }

      nx = this.clampX(nx);
      ny = this.clampY(ny);
      const ntx = nx >> 16;
      const nty = ny >> 16;
      if (this.blocked[nty * w + ntx] !== 0) {
        if (this.blocked[tileY * w + ntx] === 0) {
          ny = py;
        } else if (this.blocked[nty * w + tileX] === 0) {
          nx = px;
        } else {
          nx = px;
          ny = py;
        }
      }

      const mvx = fx.sub(nx, px);
      const mvy = fx.sub(ny, py);
      if (mvx !== 0 || mvy !== 0) {
        this.displaced[i] = 1;
        this.turnToward(i, fx.atan2(mvy, mvx));
      }
      this.posX[i] = nx;
      this.posY[i] = ny;
      if (arrived && nx === this.goalX[i] && ny === this.goalY[i]) {
        const queued = this.wpCount[i];
        if (queued > 0) {
          // Next leg: shift the queue down and carry straight on.
          const base = i * MAX_WAYPOINTS;
          this.goalX[i] = this.wpX[base];
          this.goalY[i] = this.wpY[base];
          this.attackMove[i] = this.wpAttack[base];
          for (let k = 0; k < queued - 1; k++) {
            this.wpX[base + k] = this.wpX[base + k + 1];
            this.wpY[base + k] = this.wpY[base + k + 1];
            this.wpAttack[base + k] = this.wpAttack[base + k + 1];
          }
          this.wpCount[i] = queued - 1;
          this.fieldRef[i] = this.fieldFor(fx.toInt(this.goalX[i]), fx.toInt(this.goalY[i]));
          this.engaging[i] = 0;
        } else {
          this.moving[i] = 0;
          this.fieldRef[i] = -1;
        }
      }
    }
  }

  // ------------------------------------------------------------------- upkeep

  /** Screens thin out and lift. */
  private stepSmoke(): void {
    const smoke = this.smoke;
    for (let i = 0; i < smoke.length; i++) {
      const v = smoke[i];
      if (v !== 0) smoke[i] = v > SMOKE_DECAY ? v - SMOKE_DECAY : 0;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.smokeCooldown[i] > 0) this.smokeCooldown[i]--;
    }
  }

  private stepUpkeep(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      // Suppression decays exponentially (GDD 5.5).
      this.suppression[i] = fx.mul(this.suppression[i], SUPP_DECAY);
      if (this.pinned[i] === 0 && this.suppression[i] > PIN_AT) {
        this.pinned[i] = 1;
        this.pendingEvents.push({ kind: 'pinned', tick: this.tickCount, entity: i });
      } else if (this.pinned[i] === 1 && this.suppression[i] < UNPIN_AT) {
        this.pinned[i] = 0;
        this.pendingEvents.push({ kind: 'unpinned', tick: this.tickCount, entity: i });
        if (this.routed[i] === 1) {
          // The fire lifted: rally where they stand and await orders.
          this.routed[i] = 0;
          this.moving[i] = 0;
          this.fieldRef[i] = -1;
          this.pendingEvents.push({ kind: 'rallied', tick: this.tickCount, entity: i });
        }
      }
      // Breaking (GDD 5.5a): soft units pinned too long rout — abandon
      // orders and flee the kill zone instead of dying in place.
      if (this.pinned[i] === 1) {
        this.pinnedTicks[i]++;
        if (
          this.pinnedTicks[i] === ROUT_AFTER_TICKS &&
          this.routed[i] === 0 &&
          this.unitTypes[this.typeIdx[i]].isSoft &&
          this.mobilityKilled[i] === 0
        ) {
          this.routed[i] = 1;
          this.startRout(i);
          this.pendingEvents.push({ kind: 'routed', tick: this.tickCount, entity: i });
        }
      } else {
        this.pinnedTicks[i] = 0;
      }
      // Field recovery: left alone for a while, crews patch up and wounded
      // walk again — but only to a ceiling. Serious damage needs M2 repair.
      if (this.tickCount - this.lastDamagedTick[i] >= REGEN_DELAY_TICKS) {
        const type = this.unitTypes[this.typeIdx[i]];
        const cap = fx.mul(type.hp, REGEN_CAP);
        if (this.hp[i] < cap) {
          this.hp[i] = fx.min(fx.add(this.hp[i], fx.mul(type.hp, REGEN_FRAC)), cap);
        }
      }
      // Weapon cooldowns.
      if (this.cooldown[i * 2] > 0) this.cooldown[i * 2]--;
      if (this.cooldown[i * 2 + 1] > 0) this.cooldown[i * 2 + 1]--;
      // APS magazine reload.
      if (this.apsAmmo[i] === 0 && this.apsReloadLeft[i] > 0) {
        if (--this.apsReloadLeft[i] === 0) {
          this.apsAmmo[i] = this.unitTypes[this.typeIdx[i]].apsMagazine;
        }
      }
    }
  }

  // --------------------------------------------------------------------- hash

  /** Stable digest of all mutable state — the determinism canary. */
  hash(): number {
    let h = HASH_SEED;
    h = hashWord(h, this.seed);
    h = hashWord(h, this.tickCount);
    h = hashWord(h, this.count);
    h = hashArray(h, this.rng.state);
    h = hashArray(h, this.blocked);
    h = hashArray(h, this.cover);
    h = hashArray(h, this.smoke);
    h = hashArray(h, this.smokeCooldown);
    h = hashArray(h, this.wpX);
    h = hashArray(h, this.wpY);
    h = hashArray(h, this.wpAttack);
    h = hashArray(h, this.wpCount);
    h = hashArray(h, this.carriedBy);
    h = hashArray(h, this.boardGoal);
    h = hashArray(h, this.passengers);
    h = hashArray(h, this.alive);
    h = hashArray(h, this.side);
    h = hashArray(h, this.typeIdx);
    h = hashArray(h, this.posX);
    h = hashArray(h, this.posY);
    h = hashArray(h, this.facing);
    h = hashArray(h, this.hp);
    h = hashArray(h, this.suppression);
    h = hashArray(h, this.moving);
    h = hashArray(h, this.attackMove);
    h = hashArray(h, this.goalX);
    h = hashArray(h, this.goalY);
    h = hashArray(h, this.cooldown);
    h = hashArray(h, this.lastFired);
    h = hashArray(h, this.engaging);
    h = hashArray(h, this.curTarget);
    h = hashArray(h, this.curStructure);
    h = hashArray(h, this.mobilityKilled);
    h = hashArray(h, this.firepowerKilled);
    h = hashArray(h, this.pinned);
    h = hashArray(h, this.stance);
    h = hashArray(h, this.ambushRadiusSq);
    h = hashArray(h, this.pinnedTicks);
    h = hashArray(h, this.routed);
    h = hashArray(h, this.lastDamagedTick);
    h = hashArray(h, this.veterancy);
    h = hashArray(h, this.apsAmmo);
    h = hashArray(h, this.apsReloadLeft);
    h = hashArray(h, this.apsRecent);
    h = hashArray(h, this.apsLastTick);
    h = hashArray(h, this.contact);
    h = hashArray(h, this.contactState);
    h = hashArray(h, this.lastSeenX);
    h = hashArray(h, this.lastSeenY);
    h = hashArray(h, this.lastSeenValid);
    h = hashWord(h, this.pendingStrikes.length);
    for (const s of this.pendingStrikes) {
      h = hashWord(h, s.x);
      h = hashWord(h, s.y);
      h = hashWord(h, s.readyTick);
    }
    h = hashArray(h, this.prActive);
    h = hashArray(h, this.prShooter);
    h = hashArray(h, this.prTarget);
    h = hashArray(h, this.prCls);
    h = hashArray(h, this.prWillHit);
    h = hashArray(h, this.prTicksLeft);
    h = hashArray(h, this.prOriginX);
    h = hashArray(h, this.prOriginY);
    h = hashArray(h, this.prAimX);
    h = hashArray(h, this.prAimY);
    h = hashArray(h, this.prPen);
    h = hashArray(h, this.prDamage);
    h = hashArray(h, this.prSupp);
    h = hashArray(h, this.prSplash);
    h = hashArray(h, this.prWeaponIdx);
    h = hashArray(h, this.prStructure);
    h = hashArray(h, this.garrisonedIn);
    h = hashArray(h, this.garrisonGoal);
    h = hashArray(h, this.displaced);
    h = hashArray(h, this.demoTicks);
    h = hashArray(h, this.demoTarget);
    h = hashWord(h, this.structureCount_);
    h = hashArray(h, this.stAlive);
    h = hashArray(h, this.stHp);
    h = hashArray(h, this.stOccupants);
    return h >>> 0;
  }
}
