// The deterministic core. Commands in → 20 Hz tick → state + events out
// (invariant 4). Struct-of-arrays over typed arrays: no per-entity object
// allocation inside the hot loops — GC pauses are visible at 400 units.
// Event payloads (a handful per tick) are the one sanctioned allocation.
//
// Tick order is part of the contract (replays depend on it):
//   commands → digging → detection → surfacing → combat (target/face/fire) →
//   projectiles → strikes → kamikaze → sweep → movement → transport →
//   fields → garrison → demolition → upkeep (suppression decay, pins,
//   cooldowns, APS reload) → tunnel charge (last, so the pin latched in
//   upkeep aborts a charge on the tick it lands).

import { fx, ONE, HALF, FX_MAX, type Fx } from './fixed';
import { Rng } from './rng';
import { HASH_SEED, hashArray, hashWord } from './hash';
import { FlowField, DIR_NONE, DIR_VX, DIR_VY, COST_ORTH, COST_DIAG } from './flowfield';
import {
  structureTypeFromJson,
  STRUCT_DAMAGE,
  DEMO_SECONDS,
  DEMO_RANGE_SQ,
  GARRISON_ENTER_RANGE_SQ,
  COLLAPSE_SHOCK_SQ,
  COLLAPSE_SHOCK,
  STRUCT_BASE_ACCURACY,
  PROTECTED_ROE,
  BREACH_RANGE_SQ,
  BREACH_TILES,
  BREACH_DETOUR_SLACK,
  type StructureType,
  type StructureTypeJson,
} from './structures';
import {
  pointAtDistance,
  routeLength,
  CHARGE_RANGE_SQ,
  CHARGE_SECONDS,
  SURFACE_SECONDS,
  SURFACE_VOLLEY,
  TRAIL_DECAY,
  TRAIL_DECAY_EVERY,
  TRAIL_MAX,
  TRAIL_SIGNATURE,
  TUNNEL_COLLAPSE_RADIUS,
  TUNNEL_COLLAPSE_SHOCK,
  type TunnelRouteJson,
} from './tunnels';
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
  AIM_OFF_HEADING_MAX,
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
  /** Seconds of held station to bring a building down. Absent = DEMO_SECONDS. */
  demolition_time_s?: number;
  /** How this unit takes a building apart. Absent means `charges`.
   *  Schema-constrained to charges|blade; typed loosely because JSON module
   *  imports widen string literals — same reason as `mobility.domain`. */
  demolition_method?: string;
  /** Seconds of held station to set a tunnel collapse charge. Absent = CHARGE_SECONDS. */
  tunnel_charge_time_s?: number;
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
  mobility: {
    speed_tiles_s: number;
    turn_rate_deg_s?: number;
    domain?: string;
    /** Rides on wheels or tracks, so a boulder field stops it. Absent means
     *  `!FOOT_ROLES.has(role)` — see UnitType.wheeled for why role alone is
     *  not enough and this field has to exist. */
    wheeled?: boolean;
  };
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

/**
 * Movement domains — which blocked mask a unit paths on.
 *
 * Passability is per-domain because of one terrain symbol: `b`, a boulder
 * field, is open ground on foot and a wall to anything wheeled or tracked.
 * `FlowField.compute` already takes the mask as a parameter, so this is a
 * second mask and a second cache key, not a second pathfinder.
 */
export const DOMAIN_FOOT = 0;
export const DOMAIN_VEHICLE = 1;
const DOMAIN_COUNT = 2;

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
  /**
   * What this weapon may engage, from `can_target`.
   *
   * **Absent means ground only.** Every weapon in the game predates the field,
   * so defaulting to "everything" would hand every rifle an anti-air
   * capability the moment flight landed. Defaulting to ground keeps the
   * roster's behaviour exactly as authored and makes reaching air an explicit
   * declaration.
   */
  canTargetGround: boolean;
  canTargetAir: boolean;
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
  /** Ticks of held station to bring a building down. Per unit since the D9. */
  demolitionTicks: number;
  /**
   * Grinds rather than setting charges: drains the building's structural HP
   * every tick it works, so the building crumbles as it goes and damage it has
   * already taken counts toward bringing it down. A satchel charge does not
   * work that way, which is why this is a property of the unit and not of the
   * ability.
   */
  bladeDemolition: boolean;
  /** Can sink a shaft and dig a tunnel route from it. */
  canDig: boolean;
  /** Can set a collapse charge over a revealed tunnel. */
  canTunnelCharge: boolean;
  /** Ticks of held station to set a tunnel collapse charge. */
  tunnelChargeTicks: number;
  /** Flies into its target and is spent doing it. */
  isKamikaze: boolean;
  /**
   * Airborne: ignores terrain blocking, and is only engageable by weapons
   * whose `can_target` includes "air".
   *
   * There is deliberately **no altitude value**. Height is presentation — the
   * renderer lifts the sprite and draws a shadow under it. A z axis in the sim
   * would add a third term to every distance check in the hot loop and change
   * no outcome, because the two rules above are the whole of what flight
   * means mechanically.
   */
  isAir: boolean;
  /**
   * Rides on wheels or tracks: a boulder field (`b`) is a wall to it, and
   * open ground to everything else.
   *
   * This is an authored field rather than a role test, and the reason is
   * `rocket_battery`. FOOT_ROLES already splits foot from vehicle for
   * `canEmbark`, and it contains `artillery` — but the Grad is a launcher on
   * a 6x6 truck and declares `role: "artillery"` exactly as `mortar_team`,
   * which is four men and a tube, does. Deriving this from the role would
   * drive a rocket truck through terrain that stops a jeep. The default is
   * `!FOOT_ROLES.has(role)`, so every unit keeps its existing classification
   * and only the one the default gets wrong says so in JSON.
   */
  wheeled: boolean;
  /**
   * Which blocked mask this type paths on: DOMAIN_FOOT or DOMAIN_VEHICLE.
   *
   * Air is DOMAIN_FOOT deliberately. It ignores terrain blocking outright, so
   * a vehicle field would be a second field computed for nothing.
   */
  moveDomain: number;
  /** Seats for infantry. */
  transportSlots: number;
  /** Dismounted element: can ride inside a transport. */
  canEmbark: boolean;
  /** Trained observer: earns intel while holding position (GDD §3). */
  canMarkTarget: boolean;
  /** Reads the ground for what runs under it: a clear sight line to any tile
   *  of a tunnel route identifies the route outright, and HOLDS it
   *  identified for as long as the look lasts (stepDetection) — a detector,
   *  not a cartographer. The only authorable identification that works on a
   *  `pre_dug` route, which never had spoil to find. */
  canMarkTunnel: boolean;
  /** Carries smoke: the counterplay to prepared fire. */
  canSmoke: boolean;
  hp: Fx;
  armorFront: Fx;
  armorSide: Fx;
  armorRear: Fx;
  isSoft: boolean;
  /** No turret: the body IS the aim, so the hull may swing onto its target
   *  while moving instead of pointing down the line of march.
   *
   *  Derived from the armour numbers, never from a roster of ids, so a new
   *  unit lands on the safe side by construction. Two conditions, both
   *  required, because `facing` is mechanical — `resolveHit` reads it to pick
   *  the armour arc (GDD §5.3):
   *   - isotropic: front, side and rear plate are equal, so no arc choice can
   *     change what a round has to defeat. Structurally this is also what
   *     "has no turret" looks like in data — everything with a distinct front
   *     is a vehicle whose gun traverses independently of its hull.
   *   - soft: `resolveHit` returns before the arc block entirely, so facing is
   *     never read. Isotropy ALONE is not enough, and that is not a belt-and-
   *     braces flourish: the obliquity bonus scales armour by up to OBLIQ_MAX
   *     *inside* the front arc, so an isotropic-but-armoured hull would still
   *     trade damage for where it points.
   *  Fail either and the unit keeps hull-follows-movement, unchanged. */
  bodyAimed: boolean;
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
    // Absent -> ground only. See the field comment on WeaponStats.
    canTargetGround: w.can_target === undefined || w.can_target.includes('ground'),
    canTargetAir: w.can_target?.includes('air') ?? false,
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
  const armorSide = fx.from(json.hull.armor.side);
  const armorRear = fx.from(json.hull.armor.rear);
  const isSoft = armorFront < SOFT_ARMOR_LIMIT;
  const suppRes = fx.from(json.hull.suppression_resistance ?? 1 / 2);
  const turnDeg = json.mobility.turn_rate_deg_s ?? DEFAULT_TURN_DEG_S;
  // deg/s → turns/tick: deg/360 * DT
  const turnPerTick = fx.mul(fx.div(fx.from(turnDeg), fx.fromInt(360)), DT);
  const abilities = json.abilities ?? [];
  const isAir = json.mobility.domain === 'air';
  const wheeled = json.mobility.wheeled ?? !FOOT_ROLES.has(json.role ?? '');
  return {
    id: json.id,
    name: json.name ?? json.id,
    role: json.role ?? '',
    canGarrison: abilities.includes('garrison'),
    canDemolish: abilities.includes('demolish'),
    demolitionTicks: fx.toInt(
      fx.mul(fx.from(json.demolition_time_s ?? DEMO_SECONDS), fx.fromInt(TICKS_PER_SECOND)),
    ),
    bladeDemolition: json.demolition_method === 'blade',
    canDig: abilities.includes('dig_tunnel'),
    canTunnelCharge: abilities.includes('tunnel_charge'),
    tunnelChargeTicks: fx.toInt(
      fx.mul(fx.from(json.tunnel_charge_time_s ?? CHARGE_SECONDS), fx.fromInt(TICKS_PER_SECOND)),
    ),
    isKamikaze: abilities.includes('kamikaze'),
    isAir,
    wheeled,
    // Air never pays for a vehicle field: it flies over the boulders the
    // vehicle mask exists to describe.
    moveDomain: !isAir && wheeled ? DOMAIN_VEHICLE : DOMAIN_FOOT,
    transportSlots: json.hull.transport_slots ?? 0,
    canEmbark: json.hull.can_embark ?? FOOT_ROLES.has(json.role ?? ''),
    canMarkTarget: abilities.includes('mark_target'),
    canMarkTunnel: abilities.includes('mark_tunnel'),
    canSmoke: abilities.includes('smoke'),
    hp: fx.from(json.hull.hp),
    armorFront,
    armorSide,
    armorRear,
    isSoft,
    // Computed once here rather than per-tick in stepCombat: it is a property
    // of the type, and the combat loop runs for every unit every tick.
    bodyAimed: isSoft && armorFront === armorSide && armorSide === armorRear,
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
  | { kind: 'smoke'; ids: number[]; x: Fx; y: Fx }
  /**
   * Bring a named building down. Charges otherwise go in automatically
   * wherever a demolisher happens to halt, which is fine for a shed and not
   * fine for a mosque: designating the structure is how the player takes
   * responsibility for a protected site, and the ROE bill that follows.
   */
  | { kind: 'demolish'; ids: number[]; structure: number }
  /**
   * Set a collapse charge on a tunnel route. The team walks to the nearest
   * spoil still showing on the surface and works there; the route must be
   * identified by the team's own side before the clock runs (suspected is a
   * blip, not a firing solution), and the collapse kills everyone below.
   */
  | { kind: 'chargeTunnel'; ids: number[]; tunnel: number };

/** The same command aimed at fewer units. A generic copy rather than an
 *  in-place splice, because the queued object belongs to the sender. */
function withIds<T extends { ids: number[] }>(cmd: T, ids: number[]): T {
  return { ...cmd, ids };
}

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
  | { kind: 'ventOpened'; tick: number; tunnel: number }
  | { kind: 'tunnelContact'; tick: number; side: number; tunnel: number; level: ContactLevel }
  | { kind: 'surfaced'; tick: number; entity: number; tunnel: number }
  | { kind: 'submerged'; tick: number; entity: number; tunnel: number }
  | { kind: 'tunnelCollapsed'; tick: number; tunnel: number; by: number }
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
  'transport', 'ventOpened', 'tunnelContact', 'surfaced', 'submerged', 'tunnelCollapsed', 'routed', 'rallied', 'pinned', 'unpinned', 'destroyed',
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
/** Routes per mission. Small on purpose: a mission with more than a handful of
 *  tunnels is a mission whose player cannot reason about any of them. */
const MAX_TUNNELS = 16;

/** How far a blocked tile — rock or building — stands above its own ground,
 *  in elevation levels.
 *
 *  2 is what the renderer already draws: a building at H = 18 px against E1's
 *  ELEV_STEP of 10, and rock scatter that sits proud of its own tile. Sight
 *  and drawing agreeing is the whole point of the elevation milestone.
 *
 *  It also has to be non-zero for a reason found while designing: with rock's
 *  sight height being its bare elevation, two units on a plateau at elevation
 *  3 would see through rock also at elevation 3, because `3 > 3` is false. A
 *  solid, impassable ridge would go transparent. */
export const BLOCK_RISE = 2;

/** How far above its own tile a unit's eyes sit, in elevation levels.
 *
 *  Without this a unit is a point on the dirt, and a one-level rise is an
 *  absolute sight wall even for someone standing at that same height -- the
 *  line descends from 1 to 0 and clips the rise's far shoulder. Measured on a
 *  terraced map, a unit saw nothing off its own terrace until adjacent to the
 *  drop.
 *
 *  MUST STAY STRICTLY BELOW BLOCK_RISE. At 2 a flat-ground building becomes
 *  `(0 + 2) * total > 2 * total` -- false -- and buildings stop blocking sight
 *  on every shipped map at once. The two constants are coupled and the coupling
 *  is invisible here, so elevation.test.ts asserts it. */
export const EYE_HEIGHT = 1;

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
  /** Boulder tiles: passable on foot, closed to wheels and tracks. Authored
   *  as `b` and set once at map load; the sim never changes it. Public like
   *  `blocked`/`cover` (not merely via `blockedVehicle`'s derived mask) so a
   *  renderer's decor layer can draw the field itself -- open ground on foot
   *  is exactly what read as a bare, walkable tile before T1-C drew one. */
  readonly boulder: Uint8Array;
  /** `blocked | boulder`. While a map has no boulders this is the SAME ARRAY
   *  as `blocked`, not a copy — which is what makes a boulder-free map cost
   *  nothing at all, in memory or in fields. It stops being an alias the
   *  first time `setBoulder` is called. */
  private blockedVehicleMask: Uint8Array;
  /** False until a boulder actually arrives. Decided once, at map load. */
  private hasBoulders = false;
  readonly cover: Uint8Array;
  /** Elevation level 0-9 per tile, row-major. Stored and hashed; line of sight
   *  reads it (E2) and, since T1-A, so does the flow field -- a climb costs
   *  UPHILL_PER_LEVEL a level and a descent is free. Sight RANGE still does not
   *  and deliberately never will: elevation changes what you can see over,
   *  never how far. */
  readonly elevation: Uint8Array;
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
  /** Set for the tick when stepCombat turned a body-aimed hull onto what it is
   *  shooting at, so stepMovement does not simply steer it back. Scratch,
   *  cleared at the top of every stepCombat.
   *
   *  This flag is the whole reason aiming on the move works at all.
   *  stepMovement runs AFTER stepCombat and turns every mover toward its
   *  heading at the same capped rate — so without it, the combat turn is
   *  undone within the same tick and a moving unit's facing never leaves the
   *  line of march no matter what stepCombat asks for. Not hashed: it carries
   *  nothing that `facing` (which is hashed) does not already show, and
   *  hashing it would give the golden hash a second reason to move. */
  private readonly aimTurned: Uint8Array;
  /** The heading stepCombat asked for, and the facing it started from, for a
   *  hull that aimed on the move this tick. Scratch, meaningful only while
   *  `aimTurned` is 1, and unhashed for the same reason it is.
   *
   *  stepCombat turns the hull immediately, because that is correct for every
   *  unit that is flagged `moving` but does not actually travel this tick — an
   *  attack-mover halted on a contact, a hull pressed into a wall. Only
   *  stepMovement knows both of those things: whether the unit really walked,
   *  and the heading it walked along. So the combat turn is PROVISIONAL, and
   *  stepMovement rewinds and redoes it against `AIM_OFF_HEADING_MAX` for the
   *  units that moved. Rewinding rather than turning a second time keeps the
   *  hull's turn rate honest — two capped turns in one tick would spin an
   *  aiming unit at double `turnPerTick`. */
  private readonly aimDesired: Int32Array;
  private readonly aimFrom: Int32Array;
  private readonly demoTicks: Int32Array;
  private readonly demoTarget: Int32Array;
  /**
   * Structure the player explicitly designated for demolition, -1 when none.
   *
   * Distinct from `demoTarget`, which is whatever the sapper drifted next to.
   * The difference is the whole point: charges go in automatically, so a
   * protected site can only be levelled on an order somebody actually gave.
   */
  private readonly demolishOrder: Int32Array;
  /** Route the player designated for a collapse charge, -1 when none. Same
   *  contract as demolishOrder: an explicit order, never a team's initiative
   *  — there is no automatic-search arm, because a collapse only happens on
   *  a designation somebody gave. */
  private readonly chargeOrder: Int32Array;
  /** Ticks of held station beside revealed spoil. Public like tnProgress:
   *  the HUD's charge bar reads it. */
  readonly chargeTicks: Int32Array;
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
  /** Route this unit is inside, or -1 on the surface. The third containment
   *  index, after garrisonedIn and carriedBy. */
  private readonly tunnelIn: Int32Array;
  /** Ticks of guaranteed exposure left after surfacing; 0 when not up. */
  private readonly surfaceTicks: Int32Array;
  /** Shots left in the burst a surfacing committed to; meaningful while
   *  `homeTunnel` is set. */
  private readonly volleyLeft: Int32Array;
  /** Route a surfaced unit goes back down into, -1 when it has none. Kept
   *  distinct from `tunnelIn` on purpose: `tunnelIn` is where I am,
   *  `homeTunnel` is where I go back to — a unit that is up has `tunnelIn`
   *  -1 and `homeTunnel` set, and is hit by the ordinary surface rules. */
  private readonly homeTunnel: Int32Array;
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

  // --- tunnel SoA ---
  readonly tnAlive = new Uint8Array(MAX_TUNNELS);
  /** Tiles dug along the route, Q16.16. */
  readonly tnProgress = new Int32Array(MAX_TUNNELS);
  readonly tnLength = new Int32Array(MAX_TUNNELS);
  readonly tnVentOpen = new Uint8Array(MAX_TUNNELS);
  readonly tnOccupants = new Int32Array(MAX_TUNNELS);
  /** Per-tick dig advance, Q16.16 tiles: dig_tiles_per_s * DT, precomputed so
   *  the step function does no conversion. */
  readonly tnDigRate = new Int32Array(MAX_TUNNELS);
  /** Unit currently digging this route, -1 when none. One digger per route. */
  readonly tnDigger = new Int32Array(MAX_TUNNELS).fill(-1);
  /** Route polylines, indexed by route. Read-only after addTunnel. */
  private readonly tnPoints: (readonly (readonly [number, number])[])[] = [];
  /** Tile centre of each route's vent, precomputed. */
  private readonly tnVentX = new Int32Array(MAX_TUNNELS);
  private readonly tnVentY = new Int32Array(MAX_TUNNELS);
  /** Tiles each route passes under. Built once in addTunnel — a Set here is a
   *  load-time allocation, not a per-tick one, so the hot-loop rule holds. */
  private readonly tnTiles: Set<number>[] = [];
  /** Contact confidence and state per (side, route): index side*MAX_TUNNELS+r.
   *  Same Q16.16 confidence and the same latched ladder as the unit pair. */
  private readonly tnContact = new Int32Array(2 * MAX_TUNNELS);
  private readonly tnContactState = new Uint8Array(2 * MAX_TUNNELS);
  private tunnelCount_ = 0;
  /** Surface spoil density per tile, 0-255. Presentation reads it; detection
   *  uses it to place the tunnel's signature. Same shape as the smoke grid. */
  readonly trail: Uint8Array;

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
    /** Structure the unit is currently demolishing, -1 when none. */
    readonly demoTarget: Int32Array;
    /** Vehicle this unit is riding in, -1 when on foot. */
    readonly carriedBy: Int32Array;
    /** Route this unit is inside, or -1 on the surface. */
    readonly tunnelIn: Int32Array;
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
  /**
   * Cached fields, keyed by (domain, goal tile) — one map per domain rather
   * than a bit stuffed into the tile index, so the key stays readable and the
   * tile index stays a tile index.
   *
   * This pool still never evicts (`fields.push` grows for the mission's
   * life), and per-domain passability is what could have doubled it. It does
   * not, on any map without boulders: `fieldFor` collapses the domain there,
   * because the two masks are the same array.
   */
  private readonly fieldByGoal: Map<number, number>[] = [new Map(), new Map()];

  constructor(config: SimConfig) {
    this.width = config.width;
    this.height = config.height;
    this.capacity = config.capacity;
    this.seed = config.seed | 0;
    this.rng = new Rng(config.seed, config.capacity);
    const n = config.capacity;
    const tiles = config.width * config.height;
    this.blocked = new Uint8Array(tiles);
    this.boulder = new Uint8Array(tiles);
    this.blockedVehicleMask = this.blocked;
    this.cover = new Uint8Array(tiles);
    this.elevation = new Uint8Array(tiles);
    this.smoke = new Uint8Array(tiles);
    this.trail = new Uint8Array(tiles);
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
    this.aimTurned = new Uint8Array(n);
    this.aimDesired = new Int32Array(n);
    this.aimFrom = new Int32Array(n);
    this.demoTicks = new Int32Array(n);
    this.demoTarget = new Int32Array(n).fill(-1);
    this.demolishOrder = new Int32Array(n).fill(-1);
    this.chargeOrder = new Int32Array(n).fill(-1);
    this.chargeTicks = new Int32Array(n);
    this.smokeCooldown = new Int32Array(n);
    this.wpX = new Int32Array(n * MAX_WAYPOINTS);
    this.wpY = new Int32Array(n * MAX_WAYPOINTS);
    this.wpAttack = new Uint8Array(n * MAX_WAYPOINTS);
    this.wpCount = new Uint8Array(n);
    this.carriedBy = new Int32Array(n).fill(-1);
    this.boardGoal = new Int32Array(n).fill(-1);
    this.passengers = new Uint8Array(n);
    this.tunnelIn = new Int32Array(n).fill(-1);
    this.surfaceTicks = new Int32Array(n);
    this.volleyLeft = new Int32Array(n);
    this.homeTunnel = new Int32Array(n).fill(-1);
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
      demoTarget: this.demoTarget,
      carriedBy: this.carriedBy,
      tunnelIn: this.tunnelIn,
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
    const t = y * this.width + x;
    this.blocked[t] = b ? 1 : 0;
    this.syncVehicleTile(t);
    this.recomputeFields();
  }

  /**
   * A tile wheels and tracks cannot cross but boots can — the `b` symbol.
   *
   * The first one on a map is where `blockedVehicleMask` stops being an alias
   * of `blocked` and becomes a real array. Everything downstream keys off
   * `hasBoulders`, so a map with none pays nothing: no array, no second field,
   * and the identical arithmetic it ran before this existed.
   */
  setBoulder(x: number, y: number, b: boolean): void {
    const t = y * this.width + x;
    if (b && !this.hasBoulders) {
      this.hasBoulders = true;
      this.blockedVehicleMask = new Uint8Array(this.blocked);
    }
    this.boulder[t] = b ? 1 : 0;
    this.syncVehicleTile(t);
    this.recomputeFields();
  }

  /** The vehicle mask a domain paths on. Identical to `blocked` — the same
   *  object — until a map declares its first boulder. */
  get blockedVehicle(): Uint8Array {
    return this.blockedVehicleMask;
  }

  /** How many flow fields have been allocated. Diagnostic: the pool never
   *  evicts, and per-domain passability is the thing that could double it. */
  get flowFieldCount(): number {
    return this.fields.length;
  }

  /** Re-derive one tile of the vehicle mask after `blocked` moved under it.
   *  A no-op while the mask is still an alias, which is the common case. */
  private syncVehicleTile(t: number): void {
    if (this.hasBoulders) this.blockedVehicleMask[t] = this.blocked[t] | this.boulder[t];
  }

  /** Terrain changed (building raised or levelled): every cached flow field
   *  is stale. Flow fields are shared per destination, so this is cheap
   *  compared to the per-unit repathing it replaces. */
  private recomputeFields(): void {
    for (let d = 0; d < DOMAIN_COUNT; d++) {
      const mask = this.maskFor(d);
      for (const [goal, idx] of this.fieldByGoal[d]) {
        const gx = goal % this.width;
        this.fields[idx].compute(mask, this.elevation, gx, (goal - gx) / this.width);
      }
    }
  }

  private maskFor(domain: number): Uint8Array {
    return domain === DOMAIN_VEHICLE ? this.blockedVehicleMask : this.blocked;
  }

  setCover(x: number, y: number, c: number): void {
    this.cover[y * this.width + x] = c;
  }

  /**
   * Raise or lower one tile.
   *
   * Recomputes the cached fields for the same reason `setBlocked` does: since
   * T1-A the flow field prices a climb, so terrain height is pathing input and
   * a field computed before the ground moved is stale. At map load that loop
   * is empty and costs nothing — `applyTerrain` runs before any unit has asked
   * for a field — but the invalidation belongs with the write, not with the
   * one caller that happens to be safe today.
   */
  setElevation(x: number, y: number, h: number): void {
    this.elevation[y * this.width + x] = h;
    this.recomputeFields();
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
      this.syncVehicleTile(t);
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

  get tunnelCount(): number {
    return this.tunnelCount_;
  }

  /** Register an authored route. Returns its index. */
  addTunnel(route: TunnelRouteJson): number {
    if (this.tunnelCount_ >= MAX_TUNNELS) throw new Error('too many tunnels');
    if (route.points.length < 2) {
      throw new Error(`tunnel ${route.id}: a route needs at least two points`);
    }
    const id = this.tunnelCount_++;
    this.tnPoints.push(route.points);
    this.tnAlive[id] = 1;
    this.tnLength[id] = routeLength(route.points);
    // pre_dug: the route was finished before the mission began, so it loads
    // complete with its vent open — stepDigging skips it and an in_tunnel
    // garrison can surface with no digger ever assigned. The trail is NOT
    // stamped: spoil is what digging leaves behind, and at TRAIL_DECAY's
    // rate anything dug before tick zero weathered away long ago. Revealing
    // a pre_dug route is the author's job (`mark_tunnel`, or the ledger).
    // No ventOpened event either — load-time state precedes any subscriber,
    // and an event claiming it happened "now" would be a lie in the log.
    this.tnProgress[id] = route.pre_dug === true ? this.tnLength[id] : 0;
    this.tnVentOpen[id] = route.pre_dug === true ? 1 : 0;
    this.tnOccupants[id] = 0;
    this.tnDigRate[id] = fx.mul(fx.from(route.dig_tiles_per_s), DT);
    this.tnDigger[id] = -1;
    const vent = route.points[route.points.length - 1];
    this.tnVentX[id] = fx.add(fx.from(vent[0]), HALF);
    this.tnVentY[id] = fx.add(fx.from(vent[1]), HALF);
    // Tile set for the route, walked at the same half-tile step stampTrail
    // uses. Allocated once at load, never in the tick loop.
    const tiles = new Set<number>();
    for (let d = 0; d <= this.tnLength[id]; d = fx.add(d, HALF)) {
      const [px, py] = pointAtDistance(route.points, d);
      const tx = px >> 16;
      const ty = py >> 16;
      if (tx >= 0 && ty >= 0 && tx < this.width && ty < this.height) {
        tiles.add(ty * this.width + tx);
      }
    }
    this.tnTiles.push(tiles);
    return id;
  }

  /** Place a unit inside a route. Used by mission placements that start a
   *  garrison underground, and by `submerge` when a fighter goes back down. */
  putInTunnel(unitId: number, routeIdx: number): void {
    if (routeIdx < 0 || routeIdx >= this.tunnelCount_) {
      throw new Error(`no tunnel ${routeIdx}`);
    }
    if (this.tunnelIn[unitId] === routeIdx) return;
    // A carrier goes below alone: the hull fits the shaft, the riders do
    // not. They are set down where it went under — at the vent, on the
    // runtime path, since submerge is the only way a loaded carrier reaches
    // here (a placement authored both buried and loaded is refused at
    // spawn). Without this, collapseTunnel's "everyone below dies" misses
    // them, `unload` teleports them out of the earth, and every containment
    // guard keyed on tunnelIn skips them while stepTransport pins them to a
    // buried hull.
    if (this.passengers[unitId] > 0) this.unloadAll(unitId);
    this.tunnelIn[unitId] = routeIdx;
    this.tnOccupants[routeIdx]++;
    // The earth cancels the WHOLE order bundle, not just kinematics.
    // applyCommands refuses new surface orders while buried; this covers
    // every order the unit already held when it went down — which a refusal
    // cannot, because stepSweep (attackMove), stepTransport (boardGoal),
    // stepGarrison (garrisonGoal), stepDemolition (demolishOrder) and
    // stepTunnelCharge (chargeOrder) all re-set `moving` from a latched
    // order with no command in sight. Clearing four of these and not the
    // fifth is the exact hole that reopened after Task 11.
    this.moving[unitId] = 0;
    this.wpCount[unitId] = 0;
    this.goalX[unitId] = this.posX[unitId];
    this.goalY[unitId] = this.posY[unitId];
    this.fieldRef[unitId] = -1;
    this.attackMove[unitId] = 0;
    this.engaging[unitId] = 0;
    this.boardGoal[unitId] = -1;
    this.garrisonGoal[unitId] = -1;
    this.demolishOrder[unitId] = -1;
    this.demoTicks[unitId] = 0;
    this.demoTarget[unitId] = -1;
    this.chargeOrder[unitId] = -1;
    this.chargeTicks[unitId] = 0;
  }

  /** Tile centre of a route's vent — where a surfacing unit stands up. */
  private ventPos(r: number): [Fx, Fx] {
    return [this.tnVentX[r], this.tnVentY[r]];
  }

  /** Tile centre of a route's vent, Q16.16 — the point `collapseTunnel`
   *  centres its surface splash on. A pure read (invariant 4). The collapse
   *  VFX used to be placed here alone; it now samples the whole line via
   *  tunnelPointAt below, whose final sample is this same spot, so this
   *  remains the canonical "where is the exit" read for tools and the
   *  sandbox. */
  tunnelVent(r: number): readonly [Fx, Fx] {
    return this.ventPos(r);
  }

  /** The surface point `d` Q16.16 tiles along route `r` from its mouth,
   *  clamped to both ends — raw polyline coordinates, not tile centres.
   *  Presentation read, tunnelVent's sibling: the collapse effect samples
   *  the route's full length with it, so the ground visibly goes down from
   *  mouth to vent rather than only at the exit. Pure read over load-time
   *  geometry (invariant 4). */
  tunnelPointAt(r: number, d: Fx): readonly [Fx, Fx] {
    return pointAtDistance(this.tnPoints[r], d);
  }

  /** Put a digger on a route. One digger per route; assigning replaces. */
  assignDigger(routeIdx: number, unitId: number): void {
    this.tnDigger[routeIdx] = unitId;
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

  /** Living, player-identified tunnel route under a tile, or -1.
   *
   *  The identification gate lives here on purpose. The app used to test
   *  alive + contact level + tile membership as three separate conditions at
   *  the call site, which is three chances to forget one. Contact level 2 is
   *  the same gate stepTunnelCharge enforces, so the player is never offered
   *  an order the sim would refuse.
   *
   *  Takes integer tile coordinates, same convention as structureAt: Math is
   *  banned in packages/sim/src (invariant 2, lint-enforced), so flooring a
   *  fractional world position happens at the call site, not in here.
   *
   *  Bounds-checked like structureAt, unlike tunnelUnderTile: tnTiles keys a
   *  Set by flat index `ty * width + tx`, so an out-of-range tx can alias a
   *  negative coordinate onto a real in-bounds tile (e.g. on a 24-wide map,
   *  tx=-19, ty=6 produces the same flat index as a legitimate tile). The
   *  caller here is screenToWorld off a mouse position, which goes off-map
   *  the instant the cursor passes the map edge — routine, not theoretical —
   *  so this guard must reject that before the route loop ever runs. */
  tunnelAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return -1;
    for (let r = 0; r < this.tunnelCount_; r++) {
      if (this.tnAlive[r] === 1 && this.tunnelContactLevel(0, r) === 2 && this.tunnelUnderTile(r, tx, ty)) {
        return r;
      }
    }
    return -1;
  }

  /** ROE cost of levelling this structure. Exposed as a number, not just a
   *  boolean, because the cursor needs three tiers: protected, costly, free. */
  structureRoePenalty(structIdx: number): number {
    return this.structureTypes[this.stTypeIdx[structIdx]].roePenalty;
  }

  /** A protected site — the mosque case. Kept as its own query so the app
   *  does not import PROTECTED_ROE to ask a sim question. */
  isProtected(structIdx: number): boolean {
    return this.structureRoePenalty(structIdx) >= PROTECTED_ROE;
  }

  /** Free garrison slots, 0 for anything that cannot be garrisoned. */
  garrisonFree(structIdx: number): number {
    const slots = this.structureTypes[this.stTypeIdx[structIdx]].garrisonSlots;
    const used = this.stOccupants[structIdx];
    return slots > used ? slots - used : 0;
  }

  /** Demolition progress 0..1 for the HUD — a charges unit's timer, a blade's
   *  damage to its target. */
  demolitionProgress(id: number): number {
    const type = this.unitTypes[this.typeIdx[id]];
    if (type.bladeDemolition) {
      // A blade's bar predicts collapse, and what causes collapse is the
      // building running out of HP — not this unit's timer, which knows
      // nothing about damage the building took before the dozer arrived.
      const s = this.demoTarget[id];
      if (s < 0 || this.stAlive[s] === 0) return 0;
      const max = this.stMaxHp[s];
      if (max <= 0) return 0;
      return 1 - this.stHp[s] / max;
    }
    return this.demoTicks[id] / type.demolitionTicks;
  }

  /** Fraction of a tunnel charge set, 0..1 — ticks worked over ticks needed,
   *  0 while no charge is being worked (walking to the route, pinned,
   *  displaced and interrupted all read 0, because chargeTicks itself
   *  resets). demolitionProgress's twin, and like it a presentation read:
   *  eight seconds standing still in the open is exactly when the player
   *  wants to know how long is LEFT, so the renderer draws progress, not
   *  presence. */
  tunnelChargeProgress(id: number): number {
    if (this.chargeOrder[id] < 0) return 0;
    const type = this.unitTypes[this.typeIdx[id]];
    if (!type.canTunnelCharge || type.tunnelChargeTicks <= 0) return 0;
    return this.chargeTicks[id] / type.tunnelChargeTicks;
  }

  /** Dev/test hook: level a building instantly. */
  debugDestroyStructure(id: number): void {
    if (this.stAlive[id] === 1) this.destroyStructure(id, -1);
  }

  /** Bring a route down without a charge. Tests and the sandbox only.
   *  destroy(i, -1) is the killed-by-nobody convention, and splashDirect
   *  takes -1 for an unattributed source. */
  debugCollapseTunnel(r: number): void {
    if (this.tnAlive[r] === 1) this.collapseTunnel(r, -1);
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

  /** Suppress a unit directly. Tests and the sandbox only. */
  debugSuppress(id: number, amount: Fx): void {
    this.applySuppression(id, amount, false);
  }

  /** Detonate a bare splash at a point. Tests and the sandbox only. */
  debugSplash(x: Fx, y: Fx, radius: Fx, dmg: Fx, supp: Fx, by: number, exclude: number): void {
    this.splashDirect(x, y, radius, dmg, supp, by, exclude);
  }

  /** Advance exactly one 20 Hz tick. Returns the events it produced. */
  tick(): SimEvent[] {
    this.applyCommands();
    this.stepDigging();
    this.stepDetection();
    this.stepSurfacing();
    this.stepCombat();
    this.stepProjectiles();
    this.stepStrikes();
    this.stepKamikaze();
    this.stepSweep();
    this.stepMovement();
    this.stepTransport();
    this.stepFields();
    this.stepGarrison();
    this.stepDemolition();
    this.stepUpkeep();
    // After upkeep rather than beside stepDemolition: the pin flag latches
    // in stepUpkeep, and a charge must abort on the very tick the team is
    // pinned — one slot earlier in the order and the interruption lands a
    // tick late, which is the difference the pinned test measures.
    this.stepTunnelCharge();
    this.tickCount++;
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  // ----------------------------------------------------------------- commands

  /**
   * The cached field toward (gx, gy) for one movement domain, computing it
   * on first ask.
   *
   * The domain collapses to DOMAIN_FOOT on a map with no boulders. That is
   * not an optimisation bolted on afterwards: the two masks are the same
   * array there, so a vehicle field would be a byte-identical duplicate of
   * one already in the pool — and this pool never evicts.
   */
  private fieldFor(gx: number, gy: number, domain: number): number {
    const d = this.hasBoulders ? domain : DOMAIN_FOOT;
    const byGoal = this.fieldByGoal[d];
    const key = gy * this.width + gx;
    const existing = byGoal.get(key);
    if (existing !== undefined) return existing;
    const field = new FlowField(this.width, this.height);
    field.compute(this.maskFor(d), this.elevation, gx, gy);
    const idx = this.fields.length;
    this.fields.push(field);
    byGoal.set(key, idx);
    return idx;
  }

  /** The movement domain a living unit paths in. */
  private domainOf(id: number): number {
    return this.unitTypes[this.typeIdx[id]].moveDomain;
  }

  /** Field toward a tile for one unit's domain, snapped to ground that domain
   *  can actually stand on. The snap is what `demolish` and `garrison` need:
   *  their goal is a structure centroid, always inside its own footprint. */
  private fieldToward(id: number, tx: number, ty: number): number {
    const d = this.domainOf(id);
    const [fgx, fgy] = this.nearestOpenTile(tx, ty, this.maskFor(d));
    return this.fieldFor(fgx, fgy, d);
  }

  /**
   * The nearest open tile to (gx, gy), or (gx, gy) itself if it is already
   * open. `FlowField.compute` bails to an all-`DIR_NONE` field the instant
   * its goal tile is blocked -- and a structure's centroid, which `demolish`
   * and `garrison` both aim at, always is. Left unfixed, `stepMovement`'s
   * final-leg fallback (used whenever the field has nothing to say) walks a
   * unit in a straight line at that unreachable point and the wall-slide
   * clamp pins it against whichever face it meets first, forever, if that
   * face is nowhere near the compound's one working entrance.
   *
   * Searched by expanding Chebyshev rings so the result is the *actual*
   * nearest tile, not merely a nearby one, and scanned in a fixed row-major
   * order within each ring so two runs from the same seed pick the same tile
   * -- required by invariant 3, and unrelated to any RNG stream.
   */
  private nearestOpenTile(
    gx: number,
    gy: number,
    mask: Uint8Array = this.blocked
  ): [number, number] {
    const w = this.width;
    const h = this.height;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) return [gx, gy];
    if (mask[gy * w + gx] === 0) return [gx, gy];
    const maxR = w > h ? w : h;
    for (let r = 1; r <= maxR; r++) {
      const x0 = gx - r < 0 ? 0 : gx - r;
      const x1 = gx + r >= w ? w - 1 : gx + r;
      const y0 = gy - r < 0 ? 0 : gy - r;
      const y1 = gy + r >= h ? h - 1 : gy + r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          // Only the boundary of this ring -- the interior was already
          // checked at a smaller r.
          const ddx = x - gx < 0 ? gx - x : x - gx;
          const ddy = y - gy < 0 ? gy - y : y - gy;
          const cheb = ddx > ddy ? ddx : ddy;
          if (cheb !== r) continue;
          if (mask[y * w + x] === 0) return [x, y];
        }
      }
    }
    // No open tile anywhere on the map -- cannot happen on any map that has
    // a player on it, but a caller still needs a value.
    return [gx, gy];
  }

  private applyCommands(): void {
    const q = this.commandQueue;
    for (let c = 0; c < q.length; c++) {
      let cmd = q[c];
      // Containment is a rule, not a list of places that remembered it: every
      // surface command refuses a buried unit HERE, at the single point where
      // its ids expand, before any branch sees them. The earth decides where
      // a buried unit goes, exactly as a vehicle does for its passenger — it
      // comes back up at the vent (stepSurfacing) or dies with the route
      // (collapseTunnel), never by taking an order below ground. Sitting
      // above the branches also covers move's append fast-path, which
      // `continue`d before the old per-branch guard could run. A SURFACED
      // unit (homeTunnel >= 0, tunnelIn === -1) is ordinary and passes.
      // One scan first: the common case — nobody buried — allocates nothing.
      if ('ids' in cmd) {
        let anyBuried = false;
        for (const id of cmd.ids) {
          if (this.tunnelIn[id] >= 0) {
            anyBuried = true;
            break;
          }
        }
        if (anyBuried) {
          const kept: number[] = [];
          for (const id of cmd.ids) {
            if (this.tunnelIn[id] < 0) kept.push(id);
          }
          if (kept.length === 0) continue;
          // A copy, not a splice: the queued object belongs to whoever sent
          // the command (invariant 4 — commands flow IN), and mutating it is
          // observable outside the sim.
          cmd = withIds(cmd, kept);
        }
      }
      if (cmd.kind === 'move' || cmd.kind === 'attackMove') {
        const gx = this.clampX(cmd.x);
        const gy = this.clampY(cmd.y);
        // A goal no GROUND unit can stand on has to become one that it can.
        // `demolish`, `garrison` and `chargeTunnel` all snap through
        // nearestOpenTile already; `move` was the one goal-setter that did
        // not, and it is the one that could least afford to skip it, because
        // move is the only order whose *completion* is a position test.
        // stepMovement clears `moving` and shifts the waypoint queue on
        // `nx === goalX && ny === goalY` alone, so a goal inside a wall is
        // never reached: the all-DIR_NONE field drops the unit onto the
        // straight-line fallback, the wall-slide clamp parks it flush against
        // the first face on that line, and it stands there with `moving === 1`
        // for the rest of the mission — taking every waypoint queued behind it
        // with it.
        //
        // The GOAL moves here, not just the field. Routing the field alone is
        // enough for demolish and garrison, whose arrival tests are range
        // checks against the true centroid; for move it would only relocate
        // the freeze to the open tile next door, since dirs[fieldGoal] is
        // DIR_NONE too and the last leg beelines into the wall regardless.
        const tx = fx.toInt(gx);
        const ty = fx.toInt(gy);
        const [fgx, fgy] = this.nearestOpenTile(tx, ty);
        const snapped = fgx !== tx || fgy !== ty;
        // Only when the tile really was blocked. An open goal keeps the exact
        // point it was given, fraction and all — snapping those to a tile
        // centre would be a different order from the one issued.
        const sgx = snapped ? fx.add(fx.fromInt(fgx), HALF) : gx;
        const sgy = snapped ? fx.add(fx.fromInt(fgy), HALF) : gy;
        const fieldIdx = this.fieldFor(fgx, fgy, DOMAIN_FOOT);
        // A vehicle snaps against its OWN mask, because a boulder is open
        // ground to a rifleman and a wall to a tank: the same right-click
        // resolves to different tiles for the two. `move` is the one order
        // whose completion is a position test, so a vehicle goal left on a
        // tile it can never stand on is the freeze described above, arriving
        // by a different door. Resolved lazily, once per order at most —
        // and deliberately with no `hasBoulders` shortcut of its own: on a
        // boulder-free map the two masks are the same array, so this arrives
        // at the same tile and `fieldFor` hands back the same field. One
        // collapse, in one place, is the only kind a test can pin.
        let vgx = sgx;
        let vgy = sgy;
        let vField = fieldIdx;
        let vResolved = false;
        // Air is exempt, and that is the whole reason this is resolved per id
        // rather than once for the order. A drone hovers over rock as happily
        // as over road, stepMovement skips the wall-slide for it entirely, and
        // "stop on the blocked tile" is a legitimate thing to ask of one — so
        // it keeps the raw point AND the raw field, which for a blocked goal
        // is the all-DIR_NONE one that flies it straight there. Resolved
        // lazily: an all-ground selection, which is nearly every selection,
        // computes exactly one field as it always did.
        let airField = -1;
        const attack = cmd.kind === 'attackMove' ? 1 : 0;
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue; // broken troops aren't listening
          let ux = sgx;
          let uy = sgy;
          let uf = fieldIdx;
          const utype = this.unitTypes[this.typeIdx[id]];
          if (snapped && utype.isAir) {
            if (airField < 0) airField = this.fieldFor(tx, ty, DOMAIN_FOOT);
            ux = gx;
            uy = gy;
            uf = airField;
          } else if (utype.moveDomain === DOMAIN_VEHICLE) {
            if (!vResolved) {
              vResolved = true;
              const [bx, by] = this.nearestOpenTile(tx, ty, this.blockedVehicleMask);
              const vSnapped = bx !== tx || by !== ty;
              vgx = vSnapped ? fx.add(fx.fromInt(bx), HALF) : gx;
              vgy = vSnapped ? fx.add(fx.fromInt(by), HALF) : gy;
              vField = this.fieldFor(bx, by, DOMAIN_VEHICLE);
            }
            ux = vgx;
            uy = vgy;
            uf = vField;
          }
          // Appending to a unit already under way queues the point instead of
          // overriding it: that is how a player draws a route round a block.
          if (cmd.append === true && this.moving[id] === 1) {
            const n = this.wpCount[id];
            if (n < MAX_WAYPOINTS) {
              const k = id * MAX_WAYPOINTS + n;
              this.wpX[k] = ux;
              this.wpY[k] = uy;
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
          // (Buried units were already dropped where the ids expanded, above
          // the append fast-path — the earth's refusal is not per-branch.)
          this.wpCount[id] = 0; // a fresh order replaces the whole path
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.boardGoal[id] = -1;
          this.garrisonGoal[id] = -1;
          // Sending the unit somewhere cancels a demolition it was told to do:
          // otherwise the designation survives the player changing their mind
          // and fires again the moment the unit next halts near that building.
          this.demolishOrder[id] = -1;
          // A charge designation dies with the same change of mind, or the
          // team quietly resumes the countdown the next time it halts within
          // reach of that route's spoil.
          this.chargeOrder[id] = -1;
          this.chargeTicks[id] = 0;
          this.goalX[id] = ux;
          this.goalY[id] = uy;
          this.fieldRef[id] = uf;
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
        let count = 0;
        for (let t = 0; t < this.count; t++) {
          if (this.alive[t] === 0 || this.side[t] === cmd.side || this.side[t] > 1) continue;
          // Purchased certainty does not see through earth: this is the
          // target-side twin of stepDetection's guard. The trail contact
          // ladder (tnContact) is the ONLY channel for knowing about a
          // tunnel, and a sweep reveals the trail's route, not its occupants.
          if (this.tunnelIn[t] >= 0) continue;
          const d = distSqFx(fx.sub(this.posX[t], cmd.x), fx.sub(this.posY[t], cmd.y));
          if (d > SWEEP_RADIUS_SQ) continue;
          this.identifyTo(cmd.side, t);
          count++;
        }
        this.pendingEvents.push({ kind: 'revealed', tick: this.tickCount, side: cmd.side, count });
      } else if (cmd.kind === 'callStrike') {
        // `caller` is not in an ids array, so the expansion filter above
        // cannot see it — the same rule is applied by hand: a unit that
        // cannot observe the surface does not direct fires onto it, and its
        // RNG stream is not consumed from below ground.
        if (this.alive[cmd.caller] === 1 && this.tunnelIn[cmd.caller] < 0) {
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
        // The ids filter above covers the riders; the carrier arrives by a
        // different field and gets the same rule — nobody walks to a hull
        // that is under three metres of earth. (canSeat refuses it too, but
        // the walk order must die here, not at the kerb.)
        if (this.tunnelIn[car] >= 0) continue;
        // Walk to the vehicle; stepTransport puts them aboard on arrival.
        const gx = this.posX[car];
        const gy = this.posY[car];
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
          this.fieldRef[id] = this.fieldFor(fx.toInt(gx), fx.toInt(gy), this.domainOf(id));
          this.moving[id] = 1;
          this.attackMove[id] = 0;
          this.stance[id] = 0;
        }
      } else if (cmd.kind === 'unload') {
        for (const id of cmd.ids) this.unloadAll(id);
      } else if (cmd.kind === 'demolish') {
        const s = cmd.structure;
        if (s < 0 || s >= this.structureCount_ || this.stAlive[s] === 0) continue;
        // Walk to the building; stepDemolition sets the charges on arrival.
        // Same shape as `garrison` — the player picks the structure, the unit
        // makes its own way there.
        const [gx, gy] = [this.stCx[s], this.stCy[s]];
        // The centroid is inside the structure's own footprint and so is
        // always blocked -- routing the field at it directly leaves every
        // tile DIR_NONE (see nearestOpenTile), which reads as "just walk
        // straight there" and pins the unit against whichever wall face it
        // meets first. The field routes to the nearest open tile instead;
        // `goalX`/`goalY` stay the true centroid so the final approach (and
        // demolition/garrison range checks, both comfortably inside one tile
        // of an adjacent-open-tile arrival) still aim at the real target.
        const dtx = fx.toInt(gx);
        const dty = fx.toInt(gy);
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue;
          if (!this.unitTypes[this.typeIdx[id]].canDemolish) continue;
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.demolishOrder[id] = s;
          // A fresh designation restarts the clock: charges laid against the
          // last building do not carry over to this one.
          this.demoTicks[id] = 0;
          this.demoTarget[id] = -1;
          this.wpCount[id] = 0;
          this.boardGoal[id] = -1;
          this.garrisonGoal[id] = -1;
          this.goalX[id] = gx;
          this.goalY[id] = gy;
          this.fieldRef[id] = this.fieldToward(id, dtx, dty);
          this.moving[id] = 1;
          this.attackMove[id] = 0;
          this.engaging[id] = 0;
          this.stance[id] = 0;
        }
      } else if (cmd.kind === 'garrison') {
        const s = cmd.structure;
        if (s < 0 || s >= this.structureCount_ || this.stAlive[s] === 0) continue;
        // Walk to the doorway; stepGarrison lets them in when they arrive
        // and there is room. Overflow simply waits outside.
        const [gx, gy] = [this.stCx[s], this.stCy[s]];
        // Same fix as `demolish` above, for the same reason: the centroid is
        // always blocked, so the field routes to the nearest open tile and
        // goalX/goalY keep the true centroid for the final approach.
        const gtx = fx.toInt(gx);
        const gty = fx.toInt(gy);
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue;
          if (!this.unitTypes[this.typeIdx[id]].canGarrison) continue;
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.garrisonGoal[id] = s;
          this.goalX[id] = gx;
          this.goalY[id] = gy;
          this.fieldRef[id] = this.fieldToward(id, gtx, gty);
          this.moving[id] = 1;
          this.attackMove[id] = 0;
          this.engaging[id] = 0;
          this.stance[id] = 0;
        }
      } else if (cmd.kind === 'chargeTunnel') {
        const r = cmd.tunnel;
        if (r < 0 || r >= this.tunnelCount_ || this.tnAlive[r] === 0) continue;
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue;
          // Only a charge-capable team takes the order. A rifle squad handed
          // it is authoring noise, filtered the way demolish filters on
          // canDemolish — the rest of the selection keeps its current orders.
          if (!this.unitTypes[this.typeIdx[id]].canTunnelCharge) continue;
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.chargeOrder[id] = r;
          // A fresh designation restarts the clock, demolish's rule.
          this.chargeTicks[id] = 0;
          this.demolishOrder[id] = -1;
          // Walk to the nearest tile of the route itself. A route has no
          // centroid to aim at the way a building does, so each team heads
          // for the closest tile of the line. Geometry, not spoil: an
          // identified route stays workable after its trail weathers, and a
          // pre_dug route — which never had spoil — is workable the moment
          // something identifies it. Finding the route is the gate
          // (stepTunnelCharge holds the clock at zero below contact level
          // 2); standing at it must not require the dirt to still show.
          const t = this.nearestRouteTile(r, this.posX[id], this.posY[id]);
          if (t < 0) continue;
          const tx = t % this.width;
          const ty = (t - tx) / this.width;
          // stampTrail marks tiles under buildings too, and a blocked goal
          // bails the flow field to all-DIR_NONE (see nearestOpenTile) — so
          // the GOAL moves to the open tile along with the field, on its own
          // merits: spoil is a surface sign, not a footprint, and any
          // reachable open ground beside it is a place to stand and work.
          // The retarget is not compensating for a missing stop: since the
          // hoist, stepTunnelCharge's in-range stop precedes its displaced
          // gate exactly as demolish's does, and rescues the one case this
          // retarget cannot — a goal that is open but sealed off (a route
          // venting inside a walled compound), where the beeline grinds the
          // team along the wall inside charge range.
          const cd = this.domainOf(id);
          const [fgx, fgy] = this.nearestOpenTile(tx, ty, this.maskFor(cd));
          this.wpCount[id] = 0;
          this.boardGoal[id] = -1;
          this.garrisonGoal[id] = -1;
          this.goalX[id] = fx.add(fx.fromInt(fgx), HALF);
          this.goalY[id] = fx.add(fx.fromInt(fgy), HALF);
          this.fieldRef[id] = this.fieldFor(fgx, fgy, cd);
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
    // Endpoint sight heights, and the ray's step count.
    //
    // `total` is the iteration count: this is classical two-branch Bresenham,
    // so the major axis advances exactly once per iteration. It is zero only
    // when both endpoints are the same tile, and such a ray returns from the
    // equality check at the top of the loop before reaching the comparison
    // below. The cross-multiply assumes `total > 0` and is protected by that
    // early return rather than by a guard of its own -- a refactor that moved
    // the early return would divide this assumption out from under it.
    // Both ends, symmetrically: you see a body, and a body has height.
    const h0 = this.elevation[y0 * w + x0] + EYE_HEIGHT;
    const h1 = this.elevation[y1 * w + x1] + EYE_HEIGHT;
    const total = dx > dy ? dx : dy;
    let k = 0;
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
      k++;
      // Terrain against the sight line, cross-multiplied so this stays in
      // plain integers -- no division, no fixed point. Elevations are 0-9,
      // BLOCK_RISE adds 2, and maps are at most 128 wide, so every term here
      // is under about 1,400.
      //
      // On flat ground h0 = h1 = EYE_HEIGHT, so the (h1 - h0) * k term below
      // vanishes and lineH = EYE_HEIGHT * total at every step -- the
      // comparison below reduces to `rise > EYE_HEIGHT`. Open ground and
      // transparent tiles have rise 0, so they can never block; a blocked
      // tile has rise BLOCK_RISE, and EYE_HEIGHT < BLOCK_RISE (asserted by
      // test) keeps it blocking exactly as it did before elevation existed.
      const lineH = h0 * total + (h1 - h0) * k;
      // `rise` is what the obstacle itself adds on top of bare ground -- zero
      // for open ground and for anything the ray sees straight through (a
      // fence, or the structure at either end of the ray), BLOCK_RISE for
      // everything else. The comparison below then runs once for every tile,
      // so a transparent obstacle can never make the ground it stands on
      // transparent too: a wall on a rise still has the rise beneath it.
      let rise = 0;
      if (this.blocked[t] !== 0) {
        const st = this.structureOfTile[t];
        // A fence costs you concealment on the way past, not the sight line:
        // you shoot over it. Everything taller than chest height still stops
        // the ray dead unless it is one of the two structures at its ends.
        if (st >= 0 && this.structureTypes[this.stTypeIdx[st]].lowProfile) {
          if (coverCount < 8) coverCount++;
        } else if (st < 0 || (st !== sFrom && st !== sTo)) {
          rise = BLOCK_RISE;
        }
      }
      if ((this.elevation[t] + rise) * total > lineH) return -1;
      if (this.cover[t] !== 0 && coverCount < 8) coverCount++;
    }
  }

  /** Signature × strength × p for one observer→target pair. Shared by the
   *  detection system and the debug overlay (which is why it exists). */
  /**
   * Does minimum range forbid this shot?
   *
   * Minimum range models arming distance and flight time against a target
   * that is manoeuvring and shooting back. A firepower-killed vehicle is
   * doing neither -- it is a stationary hulk -- and refusing the shot there
   * is what let one sit permanently unengageable at point-blank while the
   * only weapon present that could penetrate it stood 0.7 tiles away (#105).
   * Both sides then stood still until the tick budget ran out, with no error
   * and a mission objective hanging on a unit nothing could kill.
   *
   * Deliberately narrow: it changes nothing about engaging a HEALTHY target
   * inside minimum range, which stays forbidden. `firepowerKilled` is never
   * cleared anywhere in this file, so this is the one state that can make the
   * exclusion permanent rather than momentary.
   *
   * Structures never reach here -- they cannot be firepower-killed -- so the
   * two structure-targeting sites keep the bare comparison.
   */
  private minRangeBlocks(w: WeaponStats, dSq: Fx, target: number): boolean {
    return dSq < w.minRangeSq && this.firepowerKilled[target] === 0;
  }

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

  /**
   * Put `target` at full identified contact for `side`, as if it had been seen this
   * tick. Used by the `reveal` command and by mission start, where campaign intel
   * hands the player emplacements a previous mission's recon marked.
   *
   * Not exempt from decay: an unobserved contact fades from here like any other, so
   * intel tells you where they were, not where they are. That is the honest behaviour
   * and it needs no special case.
   */
  identifyTo(side: number, target: number): void {
    // An authority primitive: it writes whatever it is told, including
    // contact on a buried unit — which is legitimate state (a contact formed
    // before a submerge decays through the normal ladder). Containment is
    // the CALLER's job: the `reveal` handler and the mission's pre-marked
    // spawn both refuse buried targets before calling here.
    const k = side * this.capacity + target;
    this.contact[k] = ONE;
    this.lastSeenX[k] = this.posX[target];
    this.lastSeenY[k] = this.posY[target];
    this.lastSeenValid[k] = 1;
    if (this.contactState[k] === 2) return;
    this.contactState[k] = 2;
    this.pendingEvents.push({
      kind: 'contact',
      tick: this.tickCount,
      side,
      target,
      level: 'identified',
      confidence: ONE,
    });
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
    // Men inside a building, aboard a vehicle, or under the earth cannot be
    // shot at — the same containment skip selectTarget makes.
    if (this.garrisonedIn[target] >= 0 || this.carriedBy[target] >= 0 || this.tunnelIn[target] >= 0) {
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
      if (dSq > w.rangeSq || this.minRangeBlocks(w, dSq, target)) continue;
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

  private stepDigging(): void {
    for (let r = 0; r < this.tunnelCount_; r++) {
      if (this.tnAlive[r] === 0 || this.tnVentOpen[r] === 1) continue;
      const digger = this.tnDigger[r];
      if (digger < 0 || this.alive[digger] === 0) continue;
      const before = this.tnProgress[r];
      const after = fx.min(fx.add(before, this.tnDigRate[r]), this.tnLength[r]);
      this.tnProgress[r] = after;
      this.stampTrail(r, before, after);
      if (after >= this.tnLength[r]) {
        this.tnVentOpen[r] = 1;
        this.pendingEvents.push({ kind: 'ventOpened', tick: this.tickCount, tunnel: r });
      }
    }
  }

  /** Mark every tile the head passed under between two progress values.
   *  Sampled at half-tile steps: coarser skips tiles on a diagonal leg and
   *  leaves a dotted trail the player reads as two tunnels. */
  private stampTrail(r: number, from: Fx, to: Fx): void {
    const points = this.tnPoints[r];
    for (let d = fx.add(from, HALF); d < to; d = fx.add(d, HALF)) {
      const [x, y] = pointAtDistance(points, d);
      const tx = x >> 16;
      const ty = y >> 16;
      if (tx >= 0 && ty >= 0 && tx < this.width && ty < this.height) {
        this.trail[ty * this.width + tx] = TRAIL_MAX;
      }
    }
    const [ex, ey] = pointAtDistance(points, to);
    const etx = ex >> 16;
    const ety = ey >> 16;
    if (etx >= 0 && ety >= 0 && etx < this.width && ety < this.height) {
      this.trail[ety * this.width + etx] = TRAIL_MAX;
    }
  }

  private stepSurfacing(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;

      // Already up: run the exposure clock down, then go back under. The
      // volley AND the window both have to be spent — suppression does not
      // shorten it. A unit caught in the open is caught in the open, and that
      // guaranteed window is the player's whole answer to this mechanic.
      if (this.surfaceTicks[i] > 0) {
        this.surfaceTicks[i]--;
        if (this.surfaceTicks[i] === 0 && this.volleyLeft[i] <= 0) {
          this.submerge(i);
        }
        continue;
      }
      if (this.homeTunnel[i] >= 0) {
        // Window elapsed but the burst is unfinished: hold until it is, and
        // go back down the tick it finishes. Level-triggered on purpose — the
        // window-end check above fires on one tick only, and a burst that
        // outlives the window (a slow weapon, a pin across the window's end)
        // finishes later, in ordinary combat. An edge check alone strands the
        // unit on the surface forever, homeTunnel latched, silently.
        if (this.volleyLeft[i] > 0) continue;
        this.submerge(i);
        continue;
      }

      const r = this.tunnelIn[i];
      if (r < 0 || this.tnAlive[r] === 0 || this.tnVentOpen[r] === 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (type.weapons.length === 0) continue;
      const [vx, vy] = this.ventPos(r);
      if (!this.hasTargetFrom(i, vx, vy)) continue;

      this.tunnelIn[i] = -1;
      this.homeTunnel[i] = r;
      this.tnOccupants[r]--;
      this.posX[i] = vx;
      this.posY[i] = vy;
      this.surfaceTicks[i] = SURFACE_SECONDS * TICKS_PER_SECOND;
      this.volleyLeft[i] = SURFACE_VOLLEY;
      this.pendingEvents.push({ kind: 'surfaced', tick: this.tickCount, entity: i, tunnel: r });
    }
  }

  private submerge(i: number): void {
    const r = this.homeTunnel[i];
    if (r < 0 || this.tnAlive[r] === 0) {
      // The route died while they were up. They are simply on the surface now.
      this.homeTunnel[i] = -1;
      return;
    }
    // Through putInTunnel rather than writing tunnelIn/tnOccupants here: it
    // already owns that invariant, and two code paths mutating the same
    // occupant count is how counts drift.
    this.putInTunnel(i, r);
    this.homeTunnel[i] = -1;
    this.suppression[i] = 0; // out of the fire
    this.pendingEvents.push({ kind: 'submerged', tick: this.tickCount, entity: i, tunnel: r });
  }

  /** Is there a hostile this unit could engage FROM the vent tile? Evaluated
   *  from the vent rather than the unit's current position, because that is
   *  where it will be standing. Without the sight-line half, a unit surfaces
   *  facing a wall and burns its whole window achieving nothing. */
  private hasTargetFrom(i: number, vx: Fx, vy: Fx): boolean {
    const type = this.unitTypes[this.typeIdx[i]];
    const w = type.weapons[0];
    const sSide = this.side[i];
    const gx = vx >> 16;
    const gy = vy >> 16;
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === sSide || this.side[t] > 1) continue;
      if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], vx), fx.sub(this.posY[t], vy));
      if (dSq > w.effectiveRangeSq) continue;
      if (this.losRay(gx, gy, this.posX[t] >> 16, this.posY[t] >> 16) < 0) continue;
      return true;
    }
    return false;
  }

  private stepDetection(): void {
    const cap = this.capacity;
    this.seenThisTick.fill(0);
    for (let obs = 0; obs < this.count; obs++) {
      if (this.alive[obs] === 0) continue;
      const oSide = this.side[obs];
      if (oSide > 1) continue; // civilians (side 2) observe nothing
      // Underground observes nothing: the earth blocks sight outbound as well
      // as inbound, so a contained unit must not feed its side's contact
      // array. Surfacing is unaffected — hasTargetFrom deliberately reads
      // ground truth for the spring decision, not contacts, so the ambush
      // still springs; only the first aimed shot waits on a real observation.
      if (this.tunnelIn[obs] >= 0) continue;
      for (let tgt = 0; tgt < this.count; tgt++) {
        if (this.alive[tgt] === 0 || this.side[tgt] === oSide) continue;
        // Underground is unseen: not observed this tick, so an existing
        // contact decays through the normal ladder to `lost`. This
        // deliberately DIVERGES from the garrison precedent — a garrisoned
        // unit stays detectable, which is how selectStructureTarget finds an
        // occupied building — because earth blocks sight and the trail
        // contact ladder (tnContact) is meant to be the ONLY channel for
        // knowing about a tunnel. Do not "fix" the asymmetry.
        if (this.tunnelIn[tgt] >= 0) continue;
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
    // A route is found through the spoil it leaves, not by seeing the tunnel.
    // Confidence accrues against the ROUTE rather than per trail tile: a second
    // per-tile contact array would cost width*height*2 for a fact the player
    // reads as one binary ("do I know where this tunnel is").
    for (let r = 0; r < this.tunnelCount_; r++) {
      if (this.tnAlive[r] === 0) continue;
      for (let s = 0; s < 2; s++) {
        const k = s * MAX_TUNNELS + r;
        // `mark_tunnel` senses the ROUTE, not its spoil: a trained eye with a
        // clear sight line to any tile the route runs under hands its side
        // the route identified outright — no dwell, no spoil, no tuning
        // constant. This is the only authorable identification that reaches
        // a pre_dug route, which never stamps trail; without it, spoil is
        // the sole channel and no authored mission could ever identify
        // exactly the routes missions are most likely to author. Run every
        // tick, identified or not: the carrier standing in range is what
        // HOLDS the contact at identified. mark_tunnel is a detector, not a
        // cartographer — the moment nobody who can sense the route is near
        // it, the knowledge starts to fade (the decay branch below).
        if (this.markerSeesRoute(s, r)) {
          this.identifyTunnelTo(s, r);
          continue;
        }
        const strength = this.trailStrengthFor(s, r);
        if (strength > 0) {
          const p = fx.sub(ONE, fx.expNeg(fx.mul(K_DETECT, fx.mul(strength, DT))));
          const c = this.tnContact[k];
          this.tnContact[k] = fx.add(c, fx.mul(fx.sub(ONE, c), p));
        } else {
          // Unwatched contact decays — IDENTIFIED included. This deliberately
          // REVERSES an earlier rule that froze identified contact forever
          // ("a tunnel is fixed geography"): playtest overruled it. Tunnel
          // visibility is live, detector-shaped — a side knows a route is
          // there only while a living `mark_tunnel` carrier holds a sight
          // line to it (the branch above) or someone is watching its spoil
          // (the accrual branch) — so an identified route nobody senses any
          // more fades down the same ladder every unit contact uses: c drops
          // below LOST_AT (~322 ticks from full confidence), the ladder
          // emits `lost`, and the route is unknown again.
          //
          // The failure the frozen rule was added for — a mark_tunnel
          // handover expiring mid-CHARGE, watched killing a charge at 117 of
          // 160 ticks — cannot recur WHILE the charging team holds a clear
          // sight line to some route tile within its sight: the normal
          // case, since it stands within CHARGE_RANGE (2 tiles) in the open
          // and yahalom_squad carries mark_tunnel with sight 8
          // (stepDetection runs before stepTunnelCharge inside a tick, and
          // tunnels.test.ts's "live visibility" suite pins the lone-team
          // charge). A carrier with EVERY line to its route blocked is not
          // covered by a test and would stall — clock held below
          // identified — rather than complete, with no player cue yet. A
          // handover CAN also lapse mid-walk — accepted: the team re-finds
          // the route itself as it closes to within its own sight of it.
          this.tnContact[k] = fx.mul(this.tnContact[k], CONTACT_DECAY);
        }
        const c = this.tnContact[k];
        const st = this.tnContactState[k];
        if (st < 2 && c >= IDENTIFIED_AT) {
          this.tnContactState[k] = 2;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'identified' });
        } else if (st < 1 && c >= SUSPECTED_AT) {
          this.tnContactState[k] = 1;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'suspected' });
        } else if (st > 0 && c < LOST_AT) {
          this.tnContactState[k] = 0;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'lost' });
        }
      }
    }
  }

  /** Best observation any unit of `side` has on route `r` this tick: the
   *  strongest single trail tile it can see. Zero when nobody sees any spoil. */
  private trailStrengthFor(side: number, r: number): Fx {
    let best = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.side[i] !== side || this.tunnelIn[i] >= 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      const px = this.posX[i] >> 16;
      const py = this.posY[i] >> 16;
      // `sight` is Fx tiles on UnitType (there is no integer form); the scan
      // window wants whole tiles, so round up to avoid clipping the last ring.
      const reach = fx.toInt(fx.ceil(type.sight));
      for (let ty = py - reach; ty <= py + reach; ty++) {
        for (let tx = px - reach; tx <= px + reach; tx++) {
          if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
          const density = this.trail[ty * this.width + tx];
          if (density === 0) continue;
          if (this.tunnelOfTile(r, tx, ty) === 0) continue;
          const dSq = distSqFx(
            fx.sub(fx.add(fx.fromInt(tx), HALF), this.posX[i]),
            fx.sub(fx.add(fx.fromInt(ty), HALF), this.posY[i])
          );
          if (dSq < MIN_DETECT_DIST_SQ) continue;
          if (this.losRay(px, py, tx, ty) < 0) continue;
          const sig = fx.mul(TRAIL_SIGNATURE, fx.div(fx.fromInt(density), fx.fromInt(TRAIL_MAX)));
          const strength = fx.div(fx.mul(type.optics, sig), dSq);
          if (strength > best) best = strength;
        }
      }
    }
    return best;
  }

  /** Can any living `mark_tunnel` unit of `side` see route `r` ITSELF — a
   *  clear sight line to any tile the route passes under, inside the unit's
   *  own sight radius? Trail density plays no part: this is the channel that
   *  finds a pre_dug route, which never had any. First hit wins. Same scan
   *  shape as trailStrengthFor above, and like it allocates nothing. */
  private markerSeesRoute(side: number, r: number): boolean {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.side[i] !== side || this.tunnelIn[i] >= 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (!type.canMarkTunnel) continue;
      const px = this.posX[i] >> 16;
      const py = this.posY[i] >> 16;
      // Whole-tile scan window, rounded up so the last ring is not clipped —
      // trailStrengthFor's rule.
      const reach = fx.toInt(fx.ceil(type.sight));
      for (let ty = py - reach; ty <= py + reach; ty++) {
        for (let tx = px - reach; tx <= px + reach; tx++) {
          if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
          if (this.tunnelOfTile(r, tx, ty) === 0) continue;
          const dSq = distSqFx(
            fx.sub(fx.add(fx.fromInt(tx), HALF), this.posX[i]),
            fx.sub(fx.add(fx.fromInt(ty), HALF), this.posY[i])
          );
          // The window is square; sight is round. No MIN_DETECT floor here:
          // that guard exists to cap the 1/dSq division trailStrengthFor
          // performs, this predicate divides by nothing, and standing over
          // the route is the best look at it there is.
          if (dSq > type.sightSq) continue;
          if (this.losRay(px, py, tx, ty) < 0) continue;
          return true;
        }
      }
    }
    return false;
  }

  /** Does route `r` pass under this tile? */
  private tunnelOfTile(r: number, tx: number, ty: number): number {
    return this.tnTiles[r].has(ty * this.width + tx) ? 1 : 0;
  }

  /** Which of the three contact states `side` holds on route `r`. */
  tunnelContactLevel(side: number, r: number): 0 | 1 | 2 {
    return this.tnContactState[side * MAX_TUNNELS + r] as 0 | 1 | 2;
  }

  /** Does route `r` pass under tile (tx, ty)? Presentation read: the renderer
   *  uses it to decide which spoil tiles a suspected-route tint may claim.
   *  Read-only over load-time data — nothing here can influence an outcome. */
  tunnelUnderTile(r: number, tx: number, ty: number): boolean {
    if (r < 0 || r >= this.tunnelCount_) return false;
    return this.tnTiles[r].has(ty * this.width + tx);
  }

  /** Can any living surface unit of `side` currently see tile (tx, ty) —
   *  inside its own sight radius, with a clear line of sight? The observer
   *  set is trailStrengthFor's — alive, of the side, above ground, ANY
   *  unit type — because this is the read the renderer draws the SPOIL
   *  rung with, and the dirt is driven up the contact ladder by exactly
   *  these eyes: anyone can see disturbed earth. Presentation read,
   *  tunnelUnderTile's sibling; pure over current state (invariant 4). */
  sideSeesTile(side: number, tx: number, ty: number): boolean {
    return this.seesTile(side, tx, ty, false);
  }

  /** sideSeesTile restricted to `mark_tunnel` carriers — the eyes that
   *  read the ROUTE, not just its dirt (markerSeesRoute's per-unit
   *  filters). The renderer draws the identified line with it, so the line
   *  lights up around a sweeping drone or Yahalom and fades behind them —
   *  only a detector tells you what the dirt means. Pure read
   *  (invariant 4). */
  markerSeesTile(side: number, tx: number, ty: number): boolean {
    return this.seesTile(side, tx, ty, true);
  }

  /** Shared body of the two tile-sight reads above. Round sight rather
   *  than trailStrengthFor's square scan window, and no MIN_DETECT floor,
   *  both per markerSeesRoute's own reasoning: the floor exists to cap a
   *  1/dSq division no predicate here performs — a unit standing on the
   *  dirt sees the dirt, even though its accrual skips that tile. */
  private seesTile(side: number, tx: number, ty: number, carriersOnly: boolean): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.side[i] !== side || this.tunnelIn[i] >= 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (carriersOnly && !type.canMarkTunnel) continue;
      const dSq = distSqFx(
        fx.sub(fx.add(fx.fromInt(tx), HALF), this.posX[i]),
        fx.sub(fx.add(fx.fromInt(ty), HALF), this.posY[i])
      );
      if (dSq > type.sightSq) continue;
      if (this.losRay(this.posX[i] >> 16, this.posY[i] >> 16, tx, ty) < 0) continue;
      return true;
    }
    return false;
  }

  /** `mark_tunnel`: recon hands a route over identified, no dwell required.
   *  Held, not latched: stepDetection re-calls this every tick some carrier
   *  keeps the route in sight, and once nothing does, the contact decays
   *  back down the ladder like any other — visibility is live. */
  identifyTunnelTo(side: number, r: number): void {
    const k = side * MAX_TUNNELS + r;
    this.tnContact[k] = ONE;
    if (this.tnContactState[k] !== 2) {
      this.tnContactState[k] = 2;
      this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side, tunnel: r, level: 'identified' });
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
      // and taking it down is the only way to reach them. A tunnel is the same
      // idea a third time — the earth is in the way, and Yahalom is the way in.
      if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) continue;
      if (this.contact[sSide * cap + t] < IDENTIFIED_AT) continue;
      // A weapon that cannot elevate does not get to pick a target it could
      // never hit. Filtered here rather than at the hit roll so the shooter
      // keeps looking and engages something it *can* hurt, instead of locking
      // on to an aircraft and firing into the sky for the rest of the fight.
      if (this.unitTypes[this.typeIdx[t]].isAir ? !w.canTargetAir : !w.canTargetGround) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
      if (dSq > w.rangeSq || this.minRangeBlocks(w, dSq, t)) continue;
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

  /**
   * The wall in the way, or -1.
   *
   * A unit with somewhere to be, pressed against something it can neither
   * garrison nor walk around, cuts through it. Four conditions, and each one is
   * carrying weight:
   *
   * - it is going somewhere (`moving` with a live field). A defender holding
   *   his own compound has no goal and so never fires on his own fence — there
   *   is no notion of who owns a structure for him to appeal to, and this is
   *   what stands in for it.
   * - going through would actually help. The flow field already knows the true
   *   cost of walking to the goal around every wall on the map; compare it to
   *   the straight line and the surplus is the detour the terrain imposes.
   *   Under the slack there is an opening worth using, so use it.
   * - and the thing is within arm's reach, ungarrisonable, and not a protected
   *   site — the same carve-out selectStructureTarget makes for a mosque.
   *
   * Note what is deliberately NOT required: that the unit be stuck. Gating on
   * "tried to walk and did not move" sounds safer and quietly guts the feature,
   * because a man who can walk three-quarters of the way round a compound to
   * reach its gate is never stuck — he just takes ninety seconds and arrives
   * somewhere the defence is already looking. The detour test is the honest
   * form of the same question, and it is the one that makes a blind wall get
   * cut while a gate twenty feet away still gets used.
   */
  private selectBreachTarget(i: number): number {
    // The player never cuts a wall by accident. The conditions below already
    // spare a garrison holding its own compound, but a unit ordered out through
    // a gate on the far side satisfies every one of them against its own wire,
    // and there is no notion of who owns a structure to appeal to. Breaching on
    // our side is a decision, and there is a `demolish` order to make it with.
    if (this.side[i] === 0) return -1;
    const w = this.width;
    const ux = this.posX[i] >> 16;
    const uy = this.posY[i] >> 16;
    const gx = this.goalX[i] >> 16;
    const gy = this.goalY[i] >> 16;

    if (this.moving[i] === 1) {
      const fRef = this.fieldRef[i];
      if (fRef < 0) return -1; // routed: broken men do not demolish masonry
      const field = this.fields[fRef];
      const myTile = uy * w + ux;
      if (field.dirs[myTile] !== DIR_NONE) {
        let dx = gx - ux;
        if (dx < 0) dx = -dx;
        let dy = gy - uy;
        if (dy < 0) dy = -dy;
        const lo = dx < dy ? dx : dy;
        const hi = dx < dy ? dy : dx;
        const straight = COST_DIAG * lo + COST_ORTH * (hi - lo);
        if (field.costAt(myTile) <= straight + BREACH_DETOUR_SLACK) return -1;
      }
    }
    // Standing still is not a reason to stop. A unit that has arrived where it
    // was sent has no field left to consult, and an attacker sent to a blind
    // face is standing in front of it precisely because somebody wants it
    // opened. This is the half that makes the wall a battle rather than a
    // boundary: routed to a goal, the field always finds the long way round, so
    // an assault that only ever reacts to being stuck never cuts anything.

    let best = -1;
    let bestKey = 0x7fffffff;
    for (let y = uy - BREACH_TILES; y <= uy + BREACH_TILES; y++) {
      if (y < 0 || y >= this.height) continue;
      for (let x = ux - BREACH_TILES; x <= ux + BREACH_TILES; x++) {
        if (x < 0 || x >= w) continue;
        const t = y * w + x;
        if (this.blocked[t] === 0) continue;
        const s = this.structureOfTile[t];
        if (s < 0 || this.stAlive[s] === 0) continue;
        const type = this.structureTypes[this.stTypeIdx[s]];
        if (type.garrisonSlots !== 0 || type.roePenalty >= PROTECTED_ROE) continue;
        if (this.stOccupants[s] !== 0) continue;
        if (this.structDistSq(s, this.posX[i], this.posY[i]) > BREACH_RANGE_SQ) continue;
        // Cut the panel nearest the goal, ties by tile index so the choice does
        // not depend on scan order drifting.
        let ddx = gx - x;
        if (ddx < 0) ddx = -ddx;
        let ddy = gy - y;
        if (ddy < 0) ddy = -ddy;
        const key = (ddx < ddy ? ddy : ddx) * 4096 + (t & 4095);
        if (key < bestKey) {
          bestKey = key;
          best = s;
        }
      }
    }
    return best;
  }

  /**
   * True when a low wall stands between these two tiles.
   *
   * Needed because letting a garrison shoot over its own wall hands the
   * attackers a target through it, and a unit with a target does not breach —
   * so the siege would settle into a firefight across a fence that neither side
   * ever crosses, and the wall would make the compound stronger than before it
   * could be shot over at all. A man on the far side of the wire is not the
   * objective; the hole is.
   */
  private rayCrossesLowStructure(x0: number, y0: number, x1: number, y1: number): boolean {
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
    for (;;) {
      if (x === x1 && y === y1) return false;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return false;
      const t = y * w + x;
      if (this.blocked[t] !== 0) {
        const s = this.structureOfTile[t];
        if (s >= 0 && this.structureTypes[this.stTypeIdx[s]].lowProfile) return true;
      }
    }
  }

  /** True when any living enemy is inside the ambush radius with LOS. */
  private checkAmbushSpring(i: number): boolean {
    const mySide = this.side[i];
    const px = this.posX[i];
    const py = this.posY[i];
    const rSq = this.ambushRadiusSq[i];
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === mySide || this.side[t] > 1) continue;
      // The third sight test, and the one that reads ground truth rather
      // than the contact array — so no contact guard protects it. A buried
      // enemy's coordinates name a tile it is not standing on; springing on
      // one spends the trap on nothing, because selectTarget then correctly
      // refuses the shot. A SURFACED enemy (tunnelIn === -1) still springs it.
      if (this.tunnelIn[t] >= 0) continue;
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

  /**
   * Point `id` at what it is shooting at, if it is allowed to.
   *
   * Stationary, everything turns, all the way onto the target: a halted hull
   * has nothing better to point at and no walk cycle to contradict.
   *
   * Under a move order, only a body-aimed unit turns (see `UnitType.bodyAimed`)
   * — a turreted vehicle keeps its hull on the line of march and lets the gun
   * traverse, because its front plate is where its survival lives. And the turn
   * taken here is PROVISIONAL: `aimTurned` both stops stepMovement steering the
   * hull straight back down its heading, and tells it to redo this turn inside
   * `AIM_OFF_HEADING_MAX` of the direction actually travelled. The turn is
   * still taken here and now, because `moving` is 1 for plenty of units that do
   * not travel — an attack-mover halted on a contact, a hull against a wall —
   * and those want the full stationary turn, which is what they keep by
   * stepMovement never reaching them. stepCombat proposes; stepMovement, the
   * only place that knows whether a hull actually walked and where, disposes.
   *
   * The gate stays `moving`, deliberately NOT `isEffectivelyMoving`: that
   * would let a halted attack-moving TANK swing its hull onto its target, and
   * a tank's facing is read by `resolveHit` for the armour arc. Bounding an
   * animation must not move a penetration roll.
   */
  private aimHullAt(i: number, desired: Fx): void {
    if (this.moving[i] === 1) {
      if (!this.unitTypes[this.typeIdx[i]].bodyAimed) return;
      // First aim of the tick owns the rewind point. At most one of the three
      // call sites fires per tick today; this does not depend on that.
      if (this.aimTurned[i] === 0) this.aimFrom[i] = this.facing[i];
      this.aimTurned[i] = 1;
      this.aimDesired[i] = desired;
    }
    this.turnToward(i, desired);
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
    this.aimTurned.fill(0);
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.firepowerKilled[i] === 1) continue;
      // The outbound half of containment — the inbound half is Task 7's
      // selectTarget/splash/suppression guards. The earth stops fire in both
      // directions: without this, a unit below ground with a live contact
      // shoots untargetable rounds out of bare dirt. Surfacing (stepSurfacing)
      // is how a tunnel fighter gets to shoot at all.
      if (this.tunnelIn[i] >= 0) {
        this.engaging[i] = 0;
        this.curTarget[i] = -1;
        this.curStructure[i] = -1;
        continue;
      }
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

        // Hull turns toward the primary threat. Stationary, always; on the
        // move, only where facing cannot cost anything — see aimHullAt.
        if (slot === 0) {
          this.aimHullAt(
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
          // Same test the unit path makes above, for the same reason: selection
          // reaches to MAXIMUM range, and latching `engaging` on selection stalls
          // an attack-mover the moment a garrisoned building comes into range at
          // all, to shell it from outside its own effective range. Measured to
          // the nearest footprint tile, which is what selectStructureTarget
          // ranged against.
          if (this.structDistSq(s, this.posX[i], this.posY[i]) <= w.effectiveRangeSq) {
            engagedClose = true;
          }
          if (slot === 0) this.curStructure[i] = s;
          const [tx, ty] = this.nearestStructTile(s, this.posX[i], this.posY[i]);
          if (slot === 0) {
            this.aimHullAt(i, fx.atan2(fx.sub(ty, this.posY[i]), fx.sub(tx, this.posX[i])));
          }
          if (this.cooldown[i * 2 + slot] > 0) continue;
          this.fireAtStructure(i, slot, w, s, tx, ty);
        }
      }

      // Still nothing worth shooting, and stopped dead against a wall on the
      // way somewhere? Then the wall is the enemy. A target on the far side of
      // a fence does not count as something worth shooting — it is unreachable,
      // and stopping to trade fire with it is how a siege turns into two lines
      // staring at each other over the wire forever.
      if (this.curStructure[i] < 0) {
        const tgt = this.curTarget[i];
        const distracted =
          tgt >= 0 &&
          !this.rayCrossesLowStructure(
            this.posX[i] >> 16,
            this.posY[i] >> 16,
            this.posX[tgt] >> 16,
            this.posY[tgt] >> 16
          );
        if (!distracted) {
          const s = this.selectBreachTarget(i);
          if (s >= 0) {
            const [tx, ty] = this.nearestStructTile(s, this.posX[i], this.posY[i]);
            for (let slot = 0; slot < type.weapons.length && slot < 2; slot++) {
              const w = type.weapons[slot];
              if (STRUCT_DAMAGE[w.cls] === 0) continue;
              const dSq = this.structDistSq(s, this.posX[i], this.posY[i]);
              if (dSq > w.rangeSq || dSq < w.minRangeSq) continue;
              engagedClose = true;
              if (slot === 0) this.curStructure[i] = s;
              if (slot === 0) {
                this.aimHullAt(i, fx.atan2(fx.sub(ty, this.posY[i]), fx.sub(tx, this.posX[i])));
              }
              if (this.cooldown[i * 2 + slot] > 0) continue;
              this.fireAtStructure(i, slot, w, s, tx, ty);
            }
          }
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
    // Cover is the target's own tile, or the parapet he is fighting from
    // behind, whichever is better. Taking the max rather than stacking them
    // keeps the level inside 0-3, which is all three cover tables are indexed
    // for, and makes a wall irrelevant to a man already in heavy cover.
    const tileCover = this.cover[(ty >> 16) * this.width + (tx >> 16)];
    const parapet = this.parapetCover(tx, ty, px, py);
    let coverMod = COVER_HIT[parapet > tileCover ? parapet : tileCover];
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
    // A shot is definitely being taken. Meter the surfacing burst — only a
    // unit up from a route has one; an ordinary surface unit never carries
    // volley bookkeeping.
    if (this.homeTunnel[shooter] >= 0) this.volleyLeft[shooter]--;

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
    // the defender cannot know which is which (GDD 5.6). Unless the carrier
    // went below while the round was in flight: the earth is the interceptor
    // then, and the block must not run — it draws from the target's
    // per-entity RNG stream, so an intercept happening down there would tie
    // the replay hash to an action the rule says cannot happen at all.
    if (targetAlive && this.tunnelIn[target] < 0 && (APS_INTERCEPTABLE_MASK & (1 << cls)) !== 0) {
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
      // The target went below while the round was in flight: nothing is at
      // the aim point but dirt, so the round lands on it where the target
      // stood. The ground impact's splash and suppression are already
      // contained by the tunnelIn guards, so the earth stays honest all the
      // way down.
      if (this.tunnelIn[target] >= 0) {
        this.groundImpact(pr, this.posX[target], this.posY[target]);
        return;
      }
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
      if (this.tunnelIn[i] >= 0) continue; // three metres of earth
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
      if (this.tunnelIn[i] >= 0) continue; // three metres of earth
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
    // Underground there is no hull to kill: the earth itself is the armour,
    // and a tunnel collapse — which kills via destroy(), never through here —
    // is the only way ordnance gets to the occupants.
    if (this.garrisonedIn[target] >= 0 || this.carriedBy[target] >= 0 || this.tunnelIn[target] >= 0) return;
    this.hp[target] = fx.sub(this.hp[target], dmg);
    this.lastDamagedTick[target] = this.tickCount;
    if (this.hp[target] <= 0) this.destroy(target, by);
  }

  /** coverProtects: fire arriving from outside is muffled by entrenchment;
   *  a penetration's crew shock (crew_shaken) is not. */
  private applySuppression(target: number, amount: Fx, coverProtects = true): void {
    // You cannot pin someone who is underground. Without this, a mortar
    // barrage over a trail routs the occupants and the counter-unit is
    // decorative.
    if (this.tunnelIn[target] >= 0) return;
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
  /**
   * Cover from a low wall the target is fighting from behind, or 0.
   *
   * Anchored on the target and on the shooter's side of him, which is what
   * "behind a wall" means and what makes it symmetric: the defender hugging the
   * inside of his compound and the attacker hugging the outside both benefit,
   * and neither gets anything from a fence sitting halfway down a long shot.
   * Counting any low structure on the ray instead would protect both parties in
   * an exchange forty tiles apart across a fence in the middle of it.
   *
   * Three tile lookups at worst: the two orthogonal neighbours toward the
   * shooter, and the diagonal between them.
   */
  private parapetCover(tx: Fx, ty: Fx, px: Fx, py: Fx): number {
    const ux = tx >> 16;
    const uy = ty >> 16;
    const sx = px > tx ? 1 : px < tx ? -1 : 0;
    const sy = py > ty ? 1 : py < ty ? -1 : 0;
    let best = 0;
    for (let k = 0; k < 3; k++) {
      // (sx,0), (0,sy), (sx,sy) — skipping the degenerate ones when the shooter
      // is square on an axis, where sx or sy is 0 and the tile is the target's.
      const dx = k === 1 ? 0 : sx;
      const dy = k === 0 ? 0 : sy;
      if (dx === 0 && dy === 0) continue;
      const nx = ux + dx;
      const ny = uy + dy;
      if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
      const t = ny * this.width + nx;
      if (this.blocked[t] === 0) continue;
      const s = this.structureOfTile[t];
      if (s < 0 || this.stAlive[s] === 0) continue;
      const type = this.structureTypes[this.stTypeIdx[s]];
      if (!type.lowProfile) continue;
      if (type.standingCover > best) best = type.standingCover;
    }
    return best;
  }

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

  /**
   * Where a unit leaving a structure appears. Public because mission
   * production anchors to a camp and needs the same answer a garrison spill
   * gets — one spill rule, not a second one that drifts from it.
   */
  structureExit(s: number): [Fx, Fx] {
    return this.exitTile(s);
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
      if (!this.canSeat(goal, i)) continue; // no seat yet, or not eligible
      const d = distSqFx(fx.sub(this.posX[goal], this.posX[i]), fx.sub(this.posY[goal], this.posY[i]));
      if (d > LOAD_RANGE_SQ) {
        // Keep chasing a vehicle that has moved on.
        this.goalX[i] = this.posX[goal];
        this.goalY[i] = this.posY[goal];
        this.moving[i] = 1;
        continue;
      }
      this.seat(goal, i);
    }
  }

  /**
   * May `id` take a seat in `car` right now? Seats, types and states only —
   * distance is the caller's business, because boarding checks it and a mission
   * that authored a passenger aboard has no distance to check.
   */
  private canSeat(car: number, id: number): boolean {
    if (car < 0 || car >= this.count || this.alive[car] === 0) return false;
    const slots = this.unitTypes[this.typeIdx[car]].transportSlots;
    if (slots === 0 || this.passengers[car] >= slots) return false;
    if (id === car || id < 0 || id >= this.count || this.alive[id] === 0) return false;
    // Only dismounted elements ride. This also covers vehicle stacking, since no
    // carrier is a foot role.
    if (!this.unitTypes[this.typeIdx[id]].canEmbark) return false;
    // Neither party may be underground: a buried rider cannot reach a seat,
    // and a buried hull is not a place a surface unit can climb into. The
    // deepest gate — embarkAtSpawn and boarding both pass through here.
    if (this.tunnelIn[id] >= 0 || this.tunnelIn[car] >= 0) return false;
    return this.carriedBy[id] < 0;
  }

  /** Put `id` in a seat. Extracted so boarding and authored-aboard share it. */
  private seat(car: number, id: number): void {
    this.carriedBy[id] = car;
    this.boardGoal[id] = -1;
    this.passengers[car]++;
    this.moving[id] = 0;
    this.fieldRef[id] = -1;
    this.pendingEvents.push({
      kind: 'transport',
      tick: this.tickCount,
      entity: id,
      carrier: car,
      loaded: true,
    });
  }

  /**
   * Seat a passenger immediately, for a mission that authored them aboard.
   *
   * Returns false when refused, which is a mission authoring error rather than
   * something to route around: the caller reports it and the data gate is meant
   * to have caught it first. Deliberately goes through `canSeat`, the same
   * predicate boarding uses — a second, laxer path is how a tank ends up inside a
   * pickup, which `carriers.test.ts` already asserts cannot happen by command.
   */
  embarkAtSpawn(car: number, id: number): boolean {
    if (!this.canSeat(car, id)) return false;
    if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
    this.seat(car, id);
    // Snap onto the hull, so a passenger never renders beside a vehicle it is
    // inside for the tick before stepTransport runs.
    this.posX[id] = this.posX[car];
    this.posY[id] = this.posY[car];
    this.facing[id] = this.facing[car];
    return true;
  }

  /**
   * A loitering munition has one shot and is the shot: it closes on whatever
   * it has identified and detonates on arrival. No hit roll — it is flying
   * into the target, not shooting at it.
   */
  private stepKamikaze(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      // A munition steers itself off its side's contacts, with no order to
      // clear and no command to refuse — the outbound guard has to live in
      // the step system itself, the way stepCombat's does.
      if (this.tunnelIn[i] >= 0) continue;
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
        // Same containment skip as selectTarget: a one-shot munition must not
        // spend itself diving at three metres of dirt.
        if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) continue;
        if (this.contact[side * cap + t] < IDENTIFIED_AT) continue;
        // A munition picks its own target, so the can_target rule has to be
        // applied here too -- selectTarget is never consulted on this path. A
        // ground-attack warhead chasing an aircraft would fly at it forever.
        if (this.unitTypes[this.typeIdx[t]].isAir ? !w.canTargetAir : !w.canTargetGround) continue;
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
        this.fieldRef[i] = this.fieldFor(
          fx.toInt(this.posX[target]),
          fx.toInt(this.posY[target]),
          this.domainOf(i)
        );
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
      // The automatic branch below sets charges wherever a demolisher merely
      // holds station — no order, so neither the command filter nor
      // putInTunnel's bundle clear can reach it. A buried team is stationary
      // by definition and would quietly raze the shed above its route.
      if (this.tunnelIn[i] >= 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (!type.canDemolish) continue;
      // Arrival, for a unit under orders. A `demolish` order aims the unit at
      // the building's centre, which is inside its own footprint and so can
      // never be stood on: `moving` never clears on its own. The wall-slide
      // then freezes the blocked axis while still stepping the free one by a
      // share that decays toward zero without reaching it, so the unit counts
      // as displaced for hundreds of ticks and the charges below are thrown
      // away every one of them. Left alone it does start eventually — once the
      // residual step underflows the fixed-point grid — which read as a dozer
      // parked against a wall doing nothing for the better part of a minute.
      //
      // Being in range IS arrival for this purpose, so stop. Garrison has the
      // same unreachable goal and answers it the same way: stepGarrison acts on
      // distance, and entering halts the unit.
      if (
        this.moving[i] === 1 &&
        this.demolishOrder[i] >= 0 &&
        this.stAlive[this.demolishOrder[i]] === 1 &&
        this.structDistSq(this.demolishOrder[i], this.posX[i], this.posY[i]) <= DEMO_RANGE_SQ
      ) {
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
      }
      // Charges go in while the team is stationary — being ordered *at* a
      // building counts, since they stop against its wall.
      if (this.displaced[i] === 1 || this.pinned[i] === 1 || this.garrisonedIn[i] >= 0) {
        this.demoTicks[i] = 0;
        this.demoTarget[i] = -1;
        continue;
      }
      // A designation outlives arrival but not the building: once it is rubble
      // the order has been carried out and must not latch onto a neighbour.
      const ordered = this.demolishOrder[i];
      if (ordered >= 0 && this.stAlive[ordered] === 0) this.demolishOrder[i] = -1;

      let best = -1;
      if (this.demolishOrder[i] >= 0) {
        // Explicitly designated: the protected-site rule below does not apply,
        // because somebody gave the order and the ROE bill lands on them. Note
        // there is no fallback to the automatic search — a unit under orders
        // for one building must not quietly demolish another on the way past,
        // so if it is still walking, `best` simply stays -1.
        const s = this.demolishOrder[i];
        const blocked = this.stOccupants[s] > 0 && this.friendlyInside(s, this.side[i]);
        if (!blocked && this.structDistSq(s, this.posX[i], this.posY[i]) <= DEMO_RANGE_SQ) {
          best = s;
        }
      } else {
        let bestD = DEMO_RANGE_SQ;
        for (let s = 0; s < this.structureCount_; s++) {
          if (this.stAlive[s] === 0) continue;
          // Protected sites are never levelled on a sapper's initiative, for
          // the same reason selectStructureTarget will not fire on one: charges
          // go in whenever a demolisher merely holds station, so without this a
          // dozer halted beside a mosque to let its escort catch up brings the
          // mosque down two seconds later and costs the player 30 ROE they
          // never spent. A `demolish` order is how you level one on purpose.
          if (this.structureTypes[this.stTypeIdx[s]].roePenalty >= PROTECTED_ROE) continue;
          // Nor a fence, for a plainer reason: a sapper or a dozer halted inside
          // its own compound would quietly eat the perimeter it is defending,
          // one panel every few seconds, and the player would never see why the
          // wall was falling down. Cutting your own wire is an order.
          if (this.structureTypes[this.stTypeIdx[s]].lowProfile) continue;
          if (this.stOccupants[s] > 0 && this.friendlyInside(s, this.side[i])) continue;
          const d = this.structDistSq(s, this.posX[i], this.posY[i]);
          if (d <= bestD) {
            bestD = d;
            best = s;
          }
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
      if (++this.demoTicks[i] >= type.demolitionTicks) {
        this.demoTicks[i] = 0;
        this.demoTarget[i] = -1;
        this.destroyStructure(best, i);
      } else if (type.bladeDemolition) {
        // A blade takes a bite of the building every tick it works, so the
        // thing visibly comes apart and damage it has already taken counts.
        // Scaled to maxHp rather than remaining HP: a fresh building still
        // falls in exactly demolition_time_s, and one already shot to 40%
        // falls at tick 16 of 40 through damageStructure's own zero check.
        //
        // The bite deliberately does NOT run on the final tick. fx.div
        // truncates, so 39 bites always sum to less than maxHp and the
        // building always survives to the timer — which is what pins the
        // tick count exactly rather than letting rounding drift it.
        this.damageStructure(
          best,
          fx.div(this.stMaxHp[best], fx.fromInt(type.demolitionTicks)),
          i,
        );
      }
    }
  }

  /**
   * The tunnel counter: a charge team ordered onto an identified route holds
   * station beside its revealed spoil, and after tunnelChargeTicks of
   * uninterrupted work brings the whole route down. Modelled on
   * stepDemolition — same stationary/unshaken/ungarrisoned conditions, same
   * being-in-range-is-arrival stop — with two additions: the identified
   * gate, because you cannot dig a charge down to a void you have not found,
   * and a not-underground clause, because a team below ground cannot work a
   * charge on the surface.
   */
  private stepTunnelCharge(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (!type.canTunnelCharge) continue;
      const r = this.chargeOrder[i];
      if (r < 0 || this.tnAlive[r] === 0) {
        this.chargeOrder[i] = -1;
        this.chargeTicks[i] = 0;
        continue;
      }
      // A route nobody has found cannot be charged: they would be digging at
      // random ground. Suspected is a blip, not a firing solution.
      if (this.tunnelContactLevel(this.side[i], r) !== 2) {
        this.chargeTicks[i] = 0;
        continue;
      }
      // Arrival is being in range, for the reason stepDemolition documents: an
      // order aimed at a route has no single tile to stand on, so `moving`
      // would never clear on its own. Evaluated BEFORE the displaced gate, and
      // that ordering is load-bearing, not tidiness: a team beelining at an
      // unreachable goal — a route venting inside a sealed compound, where
      // nearestOpenTile hands the courtyard back verbatim — wall-slides with
      // `displaced` at 1 for hundreds of ticks while the slide's free-axis
      // share decays toward zero, and a stop sequenced after that gate can
      // never fire for it. stepDemolition runs its stop before its displaced
      // gate for exactly this pathology; the grinding-team test in
      // tunnels.test.ts fails if this is ever "tidied" back down.
      if (this.moving[i] === 1 && this.nearestRouteTileDistSq(r, i) <= CHARGE_RANGE_SQ) {
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
      }
      // Same conditions as a demolition charge — stationary, unshaken, not
      // garrisoned — plus one this system adds: not underground. The
      // garrison clause is load-bearing, not hygiene: yahalom_squad can
      // garrison, and a team working the charge from inside a building would
      // be immune to fire (applyDamage kills the hull first), deleting the
      // escort loop the unit exists for. Yahalom stands in the open, beside
      // a tunnel that can vent shooters at it. The tunnel clause is the
      // plainer one: a team below ground cannot work a charge on the surface.
      if (
        this.displaced[i] === 1 ||
        this.pinned[i] === 1 ||
        this.garrisonedIn[i] >= 0 ||
        this.tunnelIn[i] >= 0
      ) {
        this.chargeTicks[i] = 0;
        continue;
      }
      if (this.nearestRouteTileDistSq(r, i) > CHARGE_RANGE_SQ) {
        this.chargeTicks[i] = 0;
        continue;
      }
      if (++this.chargeTicks[i] >= type.tunnelChargeTicks) {
        this.collapseTunnel(r, i);
        this.chargeOrder[i] = -1;
        this.chargeTicks[i] = 0;
      }
    }
  }

  private collapseTunnel(r: number, by: number): void {
    this.tnAlive[r] = 0;
    this.tnVentOpen[r] = 0;
    // Everyone below dies. A bailing crew has somewhere to bail to; this does
    // not. Attributed to `by` so kill credit and ROE resolve the normal way.
    // Killed via destroy(), never applyDamage — the earth-is-the-armour guard
    // there would refuse the very ordnance that is the earth coming down.
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 1 && this.tunnelIn[i] === r) {
        this.tunnelIn[i] = -1;
        this.destroy(i, by);
      }
      // Anyone currently up from this route simply loses their hole.
      if (this.homeTunnel[i] === r) this.homeTunnel[i] = -1;
    }
    this.tnOccupants[r] = 0;
    const [cx, cy] = this.ventPos(r);
    this.splashDirect(cx, cy, TUNNEL_COLLAPSE_RADIUS, 0, TUNNEL_COLLAPSE_SHOCK, by, -1);
    this.pendingEvents.push({ kind: 'tunnelCollapsed', tick: this.tickCount, tunnel: r, by });
  }

  /** Squared distance from unit `i` to the closest tile of route `r`.
   *
   *  The route's own geometry, NOT current spoil density: this check used to
   *  skip tiles whose trail had weathered, which made an identified route
   *  unworkable once its spoil faded — and a pre_dug route, which never has
   *  spoil, indestructible outright. Identification is the "you found it"
   *  gate and stepTunnelCharge already enforces it; this is only "you are
   *  standing at it", and the earth does not move when the dirt blows away. */
  private nearestRouteTileDistSq(r: number, i: number): Fx {
    let best = FX_MAX;
    for (const t of this.tnTiles[r]) {
      const tx = t % this.width;
      const ty = (t - tx) / this.width;
      const d = distSqFx(
        fx.sub(fx.add(fx.from(tx), HALF), this.posX[i]),
        fx.sub(fx.add(fx.from(ty), HALF), this.posY[i])
      );
      if (d < best) best = d;
    }
    return best;
  }

  /** Tile index of route `r`'s tile closest to a point. Command-time only —
   *  the per-tick range check is nearestRouteTileDistSq, which needs the
   *  distance, not the tile. Route geometry, not spoil, for the same reason
   *  as the range check: the walk goal must not evaporate with the trail. */
  private nearestRouteTile(r: number, x: Fx, y: Fx): number {
    let best = -1;
    let bestD = FX_MAX;
    for (const t of this.tnTiles[r]) {
      const tx = t % this.width;
      const ty = (t - tx) / this.width;
      const d = distSqFx(
        fx.sub(fx.add(fx.fromInt(tx), HALF), x),
        fx.sub(fx.add(fx.fromInt(ty), HALF), y)
      );
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
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
      // A collapsed building leaves rubble a vehicle can cross; a boulder
      // under the same tile does not stop being a boulder.
      this.syncVehicleTile(t);
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
      // Raw, not snapped — as it has always been. A goal that is closed to
      // this domain gives an all-DIR_NONE field and the straight-line
      // fallback, which for a hunt is a unit walking at its contact until
      // something stops it. That is the existing behaviour for a target
      // inside a building, and a boulder is no different.
      this.fieldRef[i] = this.fieldFor(fx.toInt(gx), fx.toInt(gy), this.domainOf(i));
      this.moving[i] = 1;
    }
  }

  // ----------------------------------------------------------------- movement

  private stepMovement(): void {
    const w = this.width;
    this.displaced.fill(0);
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.moving[i] === 0 || this.mobilityKilled[i] === 1) continue;
      // The belt, not a duplicate. Every autonomous setter of `moving` is
      // individually guarded (stepSweep, stepTransport, stepKamikaze,
      // startRout via suppression refusal) and applyCommands refuses buried
      // ids — those are the braces. This line is what makes movement
      // containment structural rather than an enumeration of setters: the
      // next system that sets `moving = 1` gets it for free instead of by
      // remembering. Safe by construction — no system legitimately moves a
      // buried body: stepDigging never touches posX, and surfacing writes
      // the vent position directly rather than walking there.
      if (this.tunnelIn[i] >= 0) continue;
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
      // Air flies over everything: walls, buildings, rubble. The map edge
      // still holds, because clampX/clampY ran above -- an aircraft leaving
      // the play area is a bug, not a feature.
      // The mask a vehicle collides against includes boulders: without this
      // the FIELD would route round them and the straight-line final leg
      // would drive straight over one.
      const clip = type.moveDomain === DOMAIN_VEHICLE ? this.blockedVehicleMask : this.blocked;
      if (!type.isAir && clip[nty * w + ntx] !== 0) {
        if (clip[tileY * w + ntx] === 0) {
          ny = py;
        } else if (clip[nty * w + tileX] === 0) {
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
        const heading = fx.atan2(mvy, mvx);
        if (this.aimTurned[i] === 1) {
          // stepCombat put this hull on its target, provisionally. Redo that
          // turn from where it started, bounded to AIM_OFF_HEADING_MAX either
          // side of the direction actually travelled: the unit advances facing
          // its march and covers the threat, instead of walking sideways with
          // its feet sliding — there is one movement clip and it is a forward
          // walk. Merely skipping this branch (leaving the combat turn alone)
          // is what moonwalked; turning toward the heading again is what
          // cancels the aim to the bit, since both turns share `turnPerTick`.
          const off = fx.clamp(
            fx.angleDiff(this.aimDesired[i], heading),
            -AIM_OFF_HEADING_MAX,
            AIM_OFF_HEADING_MAX
          );
          this.facing[i] = this.aimFrom[i];
          this.turnToward(i, (heading + off) & 0xffff);
        } else {
          // The hull follows the line of march.
          this.turnToward(i, heading);
        }
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
          this.fieldRef[i] = this.fieldFor(
            fx.toInt(this.goalX[i]),
            fx.toInt(this.goalY[i]),
            this.domainOf(i)
          );
          this.engaging[i] = 0;
        } else {
          this.moving[i] = 0;
          this.fieldRef[i] = -1;
        }
      }
    }
  }

  // ------------------------------------------------------------------- upkeep

  /** Field grids weather: screens thin out and lift, surface spoil erodes. */
  private stepFields(): void {
    const smoke = this.smoke;
    for (let i = 0; i < smoke.length; i++) {
      const v = smoke[i];
      if (v !== 0) smoke[i] = v > SMOKE_DECAY ? v - SMOKE_DECAY : 0;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.smokeCooldown[i] > 0) this.smokeCooldown[i]--;
    }
    // Spoil weathers more slowly than smoke lifts, so it is only touched every
    // TRAIL_DECAY_EVERY ticks. Integer, like smoke — a fractional decay here
    // would be the "just this one calculation" the fixed-point invariant exists
    // to refuse.
    if (this.tickCount % TRAIL_DECAY_EVERY === 0) {
      const trail = this.trail;
      for (let i = 0; i < trail.length; i++) {
        const v = trail[i];
        if (v !== 0) trail[i] = v > TRAIL_DECAY ? v - TRAIL_DECAY : 0;
      }
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
    // `boulder` and the vehicle mask are deliberately absent. `boulder` is
    // authored map data the sim never writes after load, and the vehicle mask
    // is `blocked | boulder` — derived, not state. Hashing either would move
    // the golden hash for every existing map while adding nothing: a replay
    // that failed to apply a map's boulders would still diverge in the unit
    // positions this already covers.
    h = hashArray(h, this.cover);
    h = hashArray(h, this.elevation);
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
    h = hashArray(h, this.demolishOrder);
    h = hashWord(h, this.structureCount_);
    h = hashArray(h, this.stAlive);
    h = hashArray(h, this.stHp);
    h = hashArray(h, this.stOccupants);
    // Tunnel columns — every mutable one, matching how the demolition and
    // contact state above is folded in. The contact pair matters most: it
    // gates the charge clock, and under live-gated visibility it moves every
    // tick a route is being watched or forgotten — a sub-threshold
    // divergence there would otherwise sit dormant until an order happened
    // to be issued. NOT hashed, deliberately: the trail grid
    // (width*height bytes of derived state that tnProgress already
    // determines — hashing it would turn every trail-decay tuning change
    // into a hash change for no added coverage), tnLength/tnDigRate/
    // tnVentX/tnVentY/tnPoints/tnTiles (immutable after addTunnel), and
    // tnDigger (set once by assignDigger; stepDigging re-checks `alive`).
    h = hashArray(h, this.tunnelIn);
    h = hashArray(h, this.homeTunnel);
    h = hashArray(h, this.surfaceTicks);
    h = hashArray(h, this.volleyLeft);
    h = hashArray(h, this.chargeOrder);
    h = hashArray(h, this.chargeTicks);
    h = hashArray(h, this.tnAlive);
    h = hashArray(h, this.tnProgress);
    h = hashArray(h, this.tnVentOpen);
    h = hashArray(h, this.tnOccupants);
    h = hashArray(h, this.tnContact);
    h = hashArray(h, this.tnContactState);
    return h >>> 0;
  }
}
