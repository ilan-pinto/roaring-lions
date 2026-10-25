// The deterministic core. Commands in → 20 Hz tick → state + events out
// (invariant 4). Struct-of-arrays over typed arrays: no per-entity object
// allocation inside the hot loops — GC pauses are visible at 400 units.
// Event payloads (a handful per tick) are the one sanctioned allocation.
//
// Tick order is part of the contract (replays depend on it):
//   commands → digging → detection → surfacing → combat (target/face/fire) →
//   projectiles → strikes → kamikaze → sweep → movement → transport →
//   fields → garrison → placed-charge fuses → demolition → upkeep (suppression decay, pins,
//   cooldowns, APS reload) → tunnel charge (last, so the pin latched in
//   upkeep aborts a charge on the tick it lands).

import { fx, ONE, HALF, FX_MAX, type Fx } from './fixed';
import { Rng } from './rng';
import { HASH_SEED, hashArray, hashWord } from './hash';
import { FlowField, DIR_NONE, DIR_VX, DIR_VY, COST_ORTH, COST_DIAG } from './flowfield';
import { assignFormation, type FormationUnit } from './formation';
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
  AFFECTS_FOOT,
  AFFECTS_VEHICLE,
  AFFECTS_PASSENGERS,
  areaEffectsFromJson,
  type AreaEffect,
  type AreaEffectJson,
  type StructureAid,
  type StructureAura,
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
  TUNNEL_CAPACITY_DEFAULT,
  TUNNEL_ENTER_RANGE_SQ,
  type TunnelRouteJson,
} from './tunnels';
import {
  K_DETECT,
  CONTACT_DECAY,
  SUSPECTED_AT,
  IDENTIFIED_AT,
  LOST_AT,
  FOCUS_LOST_TICKS,
  FOCUS_REACH_SLACK,
  GARRISON_RANGE_BONUS,
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
  PEN_HURTS_MIN,
  ANTI_ARMOR_SOFT_RANK_SQ,
  COMP_CREW_SHAKEN,
  COMP_MOBILITY,
  COMP_FIREPOWER,
  COMP_BOTH,
  COMP_CATASTROPHIC,
  MOB_DAMAGED_PCT,
  FIELD_FIX_TICKS,
  FIELD_FIX_ASSIST_RADIUS,
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
  KNEEL_DROP_TICKS,
  KNEEL_RISE_TICKS,
  BOUND_FIRE_TICKS,
  BOUND_MOVE_TICKS,
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
  FIRE_SUPPORT,
  FS_AIR_STRIKE,
  SWEEP_RADIUS_SQ,
  REGEN_DELAY_TICKS,
  REGEN_FRAC,
  REGEN_CAP,
  AURA_CADENCE_TICKS,
  AMBUSH_RADIUS_DEFAULT,
  MAX_PATROL_WAYPOINTS,
  MAX_SITES,
  BUILD_RANGE_SQ,
  MAX_BUILDERS,
  STAKE_HP_FRAC,
  BUILD_HP_FRAC,
  AIR_AIRBORNE,
  AIR_LANDING,
  AIR_LANDED,
  AIR_LIFTING,
  AIR_LAND_TICKS,
  AIR_LIFT_TICKS,
  AIR_WANT_NONE,
  AIR_WANT_LOAD,
  AIR_WANT_UNLOAD,
  AIR_WANT_DEPART,
  MAX_EVAC_POINTS,
  WOUND_MAX_RADIUS_TILES,
  WOUND_MAX_SECONDS,
  WOUND_NONE,
  WOUND_DOWN,
  WOUND_STABILISED,
  WOUND_ADMITTED,
  WOUND_GONE,
  MAX_WOUNDED_PER_SIDE,
  WOUND_CRAWL_PERIOD_TICKS,
  WOUND_COVER_STOP,
  MEDIC_TREAT_REACH_SQ,
  MED_IDLE,
  MED_TO_WOUNDED,
  MED_TREATING,
  MED_CARRYING,
  MED_DELIVERING,
  WOUND_DEFAULT_BLEED_TICKS,
  TUNNEL_TILES_PER_S,
  type SupportKind,
} from './tuning';
import { bestCoverTile, figuresStanding, rescuePriority, scaleDown, scarredShare } from './wounds';

/** GH-698: unloadAir's spread, the LZ and its 8 neighbours in (distance, tile
 *  index) order: the centre, the four edge neighbours, the four corners. */
const AIR_SPREAD_DX = [0, 0, -1, 1, 0, -1, 1, -1, 1] as const;
const AIR_SPREAD_DY = [0, -1, 0, 0, 1, -1, -1, 1, 1] as const;

/** #706: FIELD_FIX_ASSIST_RADIUS squared, Q16.16 square tiles (distSqFx's unit). */
const FIELD_FIX_ASSIST_RADIUS_SQ = fx.fromInt(FIELD_FIX_ASSIST_RADIUS * FIELD_FIX_ASSIST_RADIUS);

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
  /** Fires while its unit is garrisoned; default true. False for indirect fire (G4). */
  fires_from_building?: boolean;
  /** E2 (GH-709): fires on a side-identified target with no sight line of its
   *  own, whatever its class. Absent is false; mortar and rocket are indirect
   *  by class either way. */
  indirect?: boolean;
  /** E3 (GH-709): the round bursts into `count` bomblets where it lands. */
  submunitions?: SubmunitionJson;
  /** GH-709 unit 9: the fraction of the tile-cover bonus (hit chance and
   *  suppression) this weapon ignores, 0-1. Absent is 0, every weapon's old rule. */
  cover_ignore?: number;
  /** E6 (GH-274 item 3): the timing of a `directed_energy` weapon. Required by the schema
   *  on that type and refused on any other. */
  beam?: BeamJson;
}

/** A `directed_energy` weapon's `beam` block, as authored (unit.schema.json `beam`). */
export interface BeamJson {
  dwell_s: number;
  heat_s: number;
  cooldown_s: number;
}

/** A beam's timing in whole ticks (E6 GH-274 item 3). Integers: no Fx needed. */
export interface BeamStats {
  dwellTicks: number;
  heatTicks: number;
  coolTicks: number;
}

/** E3's bomblet block, as authored (unit.schema.json `submunitions`). */
export interface SubmunitionJson {
  count: number;
  scatter_tiles: number;
  damage: number;
  splash_tiles: number;
  suppression?: number;
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
  /** E6 (GH-274, item 2): a swarm is ONE entity standing for `count` members of `member_hp`
   *  each. The schema requires `hull.hp === count * member_hp`; the sim throws at registration
   *  if it is not. Absent for every other unit. */
  swarm?: { count: number; member_hp: number; spread_tiles: number };
  /** E6 (GH-274, G1): the numbers of a `demolition_method: "placed"` charge. Required by the
   *  schema when the method is `placed`; the sim throws at registration if it is missing. */
  placed_charge?: {
    fuse_s: number;
    blast_tiles: number;
    damage: number;
    suppression: number;
    withdraw_tiles: number;
  };
  /** Seconds of held station to set a tunnel collapse charge. Absent = CHARGE_SECONDS. */
  tunnel_charge_time_s?: number;
  /** Field works (#277): construction speed for a `construct` unit, a multiple of the
   *  type's build time. Absent = 1 (the D9 authors 1.5). */
  construct_rate?: number;
  /** Authored cost, mirroring data/schemas/unit.schema.json. Only `population` is
   *  read by the sim (UnitType.population); the rest are the app's and the balance
   *  tool's. The other keys are declared, not just `population`, because TypeScript's
   *  weak-type rule rejects a JSON module import whose `cost` (civilians.json:
   *  `{ logistics: 0 }`) shares no property with a type whose keys are all optional. */
  cost?: { logistics?: number; intel?: number; build_time_s?: number; population?: number };
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
    /** GH-707: men in the team, mirroring the GLB's figure count. Absent = 1. */
    figures?: number;
    /** GH-707: a lost man may fall wounded instead of dead. Absent = never. */
    wounds?: { wound_chance: number; bleed_s: number; type: string; in_place?: boolean };
    /** GH-707: when present, this carrier seats ONLY these roles. */
    can_carry?: readonly string[];
    /** GH-707: tiles around this unit inside which a friendly wounded does not bleed. */
    stabilise_radius?: number;
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
    /** Fires only from a halt: gets down before its first shot and up again
     *  before it moves on. Absent means derived -- every armed foot unit that
     *  is not a kamikaze. See UnitType.haltsToFire. */
    halts_to_fire?: boolean;
    /** #706: running gear, `tracks` (absent) or `wheels`. Schema-constrained;
     *  typed loosely for the same JSON-widening reason as `domain`. */
    gear?: string;
  };
  sensors: {
    optics: number;
    sight_tiles: number;
    signature?: number;
    thermal?: boolean;
    firing_signature_mult?: number;
  };
  weapons?: WeaponJson[];
  /** GH-707: a medic (ability `rescue`): how far it looks, how long it treats, how fast it
   *  moves dragging (one man) or carrying (a stretcher team). */
  rescue?: { radius_tiles: number; treat_s: number; drag_speed_mult: number; carry_speed_mult: number };
  /** E1 (GH-709): the field-works `aura.area` shape carried by a unit, plus the unit-only
   *  `affects: "passengers"` and `stationary`. Absent = none (every shipped unit). */
  aura?: { area: AreaEffectJson[] };
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
/**
 * The domain an aircraft PATHS in (fix/air-pathing, lead ruling 21 Oct 2026):
 * an all-open mask over flat ground, so a flow field toward any tile runs
 * straight over ridges, buildings, boulders and ditches. It is a path domain
 * only. Where an aircraft STANDS -- a formation slot, a snapped goal, an LZ --
 * is still decided on the foot mask (`maskFor(DOMAIN_AIR)` is `blocked`), and
 * `UnitType.moveDomain` stays DOMAIN_FOOT for air, so every reader of "what
 * ground can this unit be put down on" is unchanged.
 */
export const DOMAIN_AIR = 2;
const DOMAIN_COUNT = 3;

/**
 * Brace states for a unit that halts to fire (`UnitType.haltsToFire`), as
 * stored in `Sim.state.brace` -- the renderer's contract, spec
 * `2026-10-05-infantry-halt-to-fire.md` §5. Set only by the sim.
 *
 *  - NONE: standing or moving. A bracer does not fire in this state.
 *  - DROPPING: getting down, KNEEL_DROP_TICKS. Neither moves nor fires.
 *  - KNEELING: down. Fires; does not move.
 *  - RISING: getting up, KNEEL_RISE_TICKS. Neither moves nor fires.
 *
 * Always NONE for a unit that does not halt to fire, and for a bracer that is
 * garrisoned, carried or buried. Frozen at death, so a body can be drawn
 * falling from the pose it held.
 */
export const BRACE_NONE = 0;
export const BRACE_DROPPING = 1;
export const BRACE_KNEELING = 2;
export const BRACE_RISING = 3;

/** `braceWant` bits, written by stepCombat and read by stepBrace. */
const BRACE_WANT_TARGET = 1;
const BRACE_WANT_CLOSE = 2;
const BRACE_WANT_BREACH = 4;
const BRACE_WANT_EXPOSED = 8;

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
  directed_energy: 12,
};

/** Classes that fire indirect — no line of sight needed, only a side contact. */
const INDIRECT_MASK = (1 << WEAPON_CLASS.mortar) | (1 << WEAPON_CLASS.rocket);
/** Shaped-charge family for ERA purposes. */
const SHAPED_MASK = (1 << WEAPON_CLASS.heat) | (1 << WEAPON_CLASS.atgm) | (1 << WEAPON_CLASS.rpg);

/** The arc names `presentedArmor` resolves to, by `presentedArc` index. */
const FACING_ARCS: readonly FacingArc[] = ['front', 'side', 'rear'];

/** Weapons built to kill armour: the kinetic gun plus the shaped-charge
 *  family. They spend their shots on a hurtable armed vehicle before a soft
 *  or unarmed target at similar range (ANTI_ARMOR_SOFT_RANK_SQ). */
const ANTI_ARMOR_MASK = (1 << WEAPON_CLASS.apfsds) | SHAPED_MASK;

/**
 * The penetration curve's argument (GDD 5.3): how many sigmas `pen` stands
 * over `armor`. P(penetration) is `fx.normCdf` of it. The ONE place the
 * curve is written: resolveHit rolls against it, the kamikaze strike rolls
 * against it, and target selection asks it whether a shot is worth taking.
 */
function penZ(pen: Fx, armor: Fx): Fx {
  const sigma = fx.max(fx.mul(PEN_SIGMA_MULT, pen), SIGMA_MIN);
  return fx.div(fx.sub(pen, armor), sigma);
}

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
  /** Fires while its unit is garrisoned. From `fires_from_building`, default
   *  true; false for indirect fire (G4, ruling 2026-10-14). */
  firesFromBuilding: boolean;
  /** Range, effective range and its square from inside a building:
   *  GARRISON_RANGE_BONUS longer (ruling 4, 2026-10-14). */
  garrisonRangeSq: Fx;
  garrisonEffRange: Fx;
  garrisonEffRangeSq: Fx;
  /**
   * E2 (GH-709): needs no line of sight of its own, only its side's
   * identification. `INDIRECT_MASK` membership OR the authored `indirect`
   * flag, so it is the class rule exactly for every weapon that does not
   * carry the flag. Only the sight rule moves with it: structure damage,
   * anti-armour ranking, projectile speed and falloff stay with the class.
   */
  isIndirect: boolean;
  /** E3 (GH-709): the bomblets this round bursts into, or null for a plain round. */
  submunitions: SubmunitionStats | null;
  /**
   * GH-709 unit 9 (the grenadier, lead ruling 22 Oct): the fraction of the
   * tile-cover bonus this weapon ignores, from `cover_ignore`. 0 (absent) is
   * the old rule exactly; 1 makes a man behind cover as easy to hit and to pin
   * as one in the open. It reads the hit chance (COVER_HIT, parapet included)
   * and the suppression of this weapon's hits, near misses and splash on a
   * TILE (COVER_SUPP). Not garrison cover (Q7), not detection, not the clang
   * of a round bouncing off armour, and not bomblets (refused at load).
   */
  coverIgnore: Fx;
  /** E6 (GH-274 item 3): the dwell/heat/cooldown of a `directed_energy` weapon, or null for
   *  every other weapon (all of them today). */
  beam: BeamStats | null;
}

/** E3's bomblet block, loaded. `supp` is already per-stat-divided, like
 *  `WeaponStats.suppPerMiss`, so it goes straight into `splashDirect`. */
export interface SubmunitionStats {
  count: number;
  scatter: Fx;
  damage: Fx;
  splash: Fx;
  supp: Fx;
}

/** Bomblets a round may carry. The schema says the same; the loader holds it
 *  because a count is a loop bound per landing. */
export const MAX_SUBMUNITIONS = 32;

function submunitionsFromJson(weaponId: string, j: SubmunitionJson | undefined): SubmunitionStats | null {
  if (j === undefined) return null;
  if (!Number.isInteger(j.count) || j.count < 1 || j.count > MAX_SUBMUNITIONS) {
    throw new Error(`weapon ${weaponId}: submunitions.count must be an integer 1..${MAX_SUBMUNITIONS}, got ${j.count}`);
  }
  if (!(j.splash_tiles > 0)) {
    throw new Error(`weapon ${weaponId}: submunitions.splash_tiles must be above 0, got ${j.splash_tiles}`);
  }
  return {
    count: j.count,
    scatter: fx.from(j.scatter_tiles),
    damage: fx.from(j.damage),
    splash: fx.from(j.splash_tiles),
    supp: fx.div(fx.from(j.suppression ?? 0), fx.fromInt(SUPP_STAT_DIVISOR)),
  };
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

/** A swarm's numbers (E6, GH-274 item 2). Live members are DERIVED from hp, never stored:
 *  `ceil(hp / memberHp)`. Type data, not hashed. */
export interface SwarmStats {
  count: number;
  /** Q16.16 hp of one member. */
  memberHp: Fx;
  /** Q16.16 tiles: the cloud's spread, the denominator of a splash's reach. */
  spread: Fx;
}

/** A placed charge's numbers, fixed-point (E6 G1). Ticks are integers; the rest are Q16.16. */
export interface PlacedCharge {
  fuseTicks: number;
  /** Blast radius, tiles. */
  blast: Fx;
  damage: Fx;
  suppression: Fx;
  /** How far the carrier backs off after setting, tiles. */
  withdraw: Fx;
}

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
  /** E6 (GH-274): one entity standing for a cloud of members; null for every other unit. */
  swarm: SwarmStats | null;
  /**
   * E6 (GH-274, G1): a `placed` demolisher sets a fused charge on an explicit `demolish` order
   * (never on halting), withdraws, and the building falls with a blast when the fuse runs out,
   * whether or not the carrier is still alive. Null for every other unit.
   */
  placed: PlacedCharge | null;
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
   * `!FOOT_ROLES.has(role)`, and only a unit the default gets wrong says so
   * in JSON. Three do: `rocket_battery` (`wheeled: true`); `dozer_d9`
   * (`wheeled: true`, GH-598) -- a tracked bulldozer whose role `engineer` is
   * shared with three foot teams; and `manpad_team` (`wheeled: false`,
   * GH-247) -- two men and a launcher, whose role `aa` cannot join FOOT_ROLES
   * because `gun_truck` declares it too.
   */
  wheeled: boolean;
  /**
   * Fires only from a halt, kneeling (spec 2026-10-05-infantry-halt-to-fire).
   *
   * A unit with this set never fires while its feet move: it stops, spends
   * KNEEL_DROP_TICKS getting down, fires while `BRACE_KNEELING`, and spends
   * KNEEL_RISE_TICKS getting up before it moves on. Vehicles, aircraft and the
   * charge squad keep firing on the move.
   *
   * Authored as `mobility.halts_to_fire`, defaulting to "armed, on foot, not
   * a kamikaze" -- foot meaning `!wheeled` and not air, the same derivation
   * that already decides who a boulder field stops, so `rocket_battery` (a
   * Grad on a truck, role `artillery`) lands on the vehicle side by the same
   * authored `wheeled: true` that put it there for boulders.
   */
  haltsToFire: boolean;
  /**
   * Which blocked mask this type paths on: DOMAIN_FOOT or DOMAIN_VEHICLE.
   *
   * Air is DOMAIN_FOOT deliberately. It ignores terrain blocking outright, so
   * a vehicle field would be a second field computed for nothing.
   */
  moveDomain: number;
  /**
   * The domain this type's flow fields are computed in: DOMAIN_AIR for an
   * aircraft, `moveDomain` for everything else. `fieldFor` reads it, through
   * `domainOf`; nothing that snaps a goal or a slot does.
   */
  pathDomain: number;
  /**
   * What this unit takes of its side's population while it lives: a non-negative
   * integer, `cost.population` in the unit JSON, absent = 1 (the schema default).
   *
   * Parsed and carried, and read by no sim system yet (F3 plan, Task 1). Not in
   * `hash()`: it is a property of the unit TYPE, and type tables are not hashed.
   */
  population: number;
  /** Seats for infantry. */
  transportSlots: number;
  /** GH-698: an air type with seats (`isAir && transportSlots > 0`). The first one
   *  registered turns on the air block's hash fold (`airLive`, see hash()). */
  isAirCarrier: boolean;
  /** Dismounted element: can ride inside a transport. */
  canEmbark: boolean;
  /** Trained observer (the `mark_target` ability). Since F1 nothing in the sim
   *  pays intel for holding position, and nothing here reads this flag: intel is
   *  earned by doing (identifications, high ground, objectives; MissionRuntime).
   *  The HUD unit card lists it as a capability. */
  canMarkTarget: boolean;
  /** Reads the ground for what runs under it: a clear sight line to any tile
   *  of a tunnel route identifies the route outright, and HOLDS it
   *  identified for as long as the look lasts (stepDetection) — a detector,
   *  not a cartographer. The only authorable identification that works on a
   *  `pre_dug` route, which never had spoil to find. */
  canMarkTunnel: boolean;
  /** Carries smoke: the counterplay to prepared fire. */
  canSmoke: boolean;
  /** Field works (#277): can raise a field work (`abilities` 'construct'). */
  canConstruct: boolean;
  /** #706: the `repair` ability (demo_squad, dozer_d9). Standing still within
   *  FIELD_FIX_ASSIST_RADIUS of a stuck friendly ground hull, it doubles that
   *  hull's crew field-fix rate. A passive: no command, no button. */
  canRepair: boolean;
  /** #706: `mobility.gear === 'wheels'`. A wheeled hull's first mobility hit
   *  only slows it (`mobilityDamaged`); tracks (the default) go stuck at once.
   *  Not `wheeled` (vehicle-vs-foot). Read only for a ground hull. */
  partialMobility: boolean;
  /** Field works: progress multiplier, Q16.16 (`construct_rate`, default ONE). */
  constructRate: Fx;
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
  /** GH-707: men in the team (`hull.figures`, default 1). */
  figures: number;
  /** GH-707: `hull.wounds`, parsed; null when a lost man always dies. */
  wounds: { chance: Fx; bleedTicks: number; typeId: string; inPlace: boolean } | null;
  /** GH-707: unit-type index of `wounds.typeId`, -1 until resolved (lazily, at the first fall). */
  woundedTypeIdx: number;
  /** GH-707: role `wounded` -- a shed man. */
  isWounded: boolean;
  /** GH-707: `hull.can_carry`; null = the ordinary `canEmbark` seating rule. */
  canCarry: readonly string[] | null;
  /** GH-707: squared `hull.stabilise_radius`, Q16.16; 0 = no aura. */
  stabiliseRadiusSq: Fx;
  /** GH-707: the medic block, null for every non-medic. */
  rescue: { radiusSq: Fx; treatTicks: number; dragMult: Fx; carryMult: Fx } | null;
  /** E1 (GH-709): the unit's own `aura.area`, parsed; null for every type without one. */
  aura: AreaEffect[] | null;
}

/** E1 (GH-709): a unit's `aura`, parsed through the structures' own area parser. An aircraft
 *  may carry only `passengers` effects: an area scope from a carrier in the air would heal
 *  the ground beneath it, which nothing in the design asks for (the medevac heals its riders). */
function unitAuraFromJson(json: UnitTypeJson): AreaEffect[] | null {
  if (json.aura === undefined) return null;
  const area = areaEffectsFromJson(`unit ${json.id}`, json.aura.area, TICKS_PER_SECOND, true);
  if (area.length === 0) throw new Error(`unit ${json.id}: aura.area is empty`);
  if (json.mobility.domain === 'air') {
    for (const e of area) {
      if (e.affects !== AFFECTS_PASSENGERS) throw new Error(`unit ${json.id}: an aircraft's aura may only affect passengers`);
    }
  }
  return area;
}

/** Seconds of authored data to whole ticks, crossing into fixed point once (invariant 2). */
function secondsToTicks(s: number): number {
  return fx.toInt(fx.mul(fx.from(s), fx.fromInt(TICKS_PER_SECOND)));
}

/** GH-707: `hull.wounds`, validated: the schema's bounds, re-checked so a test type or a
 *  hand-built JSON cannot slip a chance above one or a bleed under a tick past the loader. */
/** GH-707: an authored duration, refused above WOUND_MAX_SECONDS rather than wrapped in Fx. */
function woundSeconds(id: string, field: string, s: number): number {
  if (!(s <= WOUND_MAX_SECONDS)) throw new Error(`unit ${id}: ${field} must be <= ${WOUND_MAX_SECONDS} s, got ${s}`);
  return secondsToTicks(s);
}

/** GH-707: an authored radius in tiles, squared in Q16.16; refused outside 0..WOUND_MAX_RADIUS_TILES. */
function woundRadiusSq(id: string, field: string, r: number): Fx {
  if (!(r >= 0 && r <= WOUND_MAX_RADIUS_TILES)) {
    throw new Error(`unit ${id}: ${field} must be 0..${WOUND_MAX_RADIUS_TILES} tiles, got ${r}`);
  }
  const f = fx.from(r);
  return fx.mul(f, f);
}

function woundsFromJson(json: UnitTypeJson): UnitType['wounds'] {
  const w = json.hull.wounds;
  if (w === undefined) return null;
  const chance = fx.from(w.wound_chance);
  if (chance < 0 || chance > ONE) throw new Error(`unit ${json.id}: hull.wounds.wound_chance must be 0..1`);
  const bleedTicks = woundSeconds(json.id, 'hull.wounds.bleed_s', w.bleed_s);
  if (bleedTicks < 1) throw new Error(`unit ${json.id}: hull.wounds.bleed_s is under one tick`);
  const inPlace = w.in_place ?? false;
  // In place means the unit ITSELF goes down (GH-707 Task 2): one man, nothing to shed.
  if (inPlace && (json.hull.figures ?? 1) !== 1) throw new Error(`unit ${json.id}: hull.wounds.in_place needs hull.figures 1`);
  return { chance, bleedTicks, typeId: w.type, inPlace };
}

function weaponFromJson(w: WeaponJson): WeaponStats {
  const rof = w.rof_per_min ?? 0;
  const tbs = rof > 0 ? fx.toInt(fx.div(fx.fromInt(60 * TICKS_PER_SECOND), fx.from(rof))) : 0;
  const cls = WEAPON_CLASS[w.type];
  if (cls === undefined) throw new Error(`unknown weapon type ${w.type}`);
  const range = fx.from(w.range_tiles);
  const minRange = fx.from(w.min_range_tiles ?? 0);
  const effRange = fx.from(w.effective_range_tiles ?? w.range_tiles);
  const gRange = fx.add(range, GARRISON_RANGE_BONUS);
  const gEff = fx.add(effRange, GARRISON_RANGE_BONUS);
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
    firesFromBuilding: w.fires_from_building ?? true,
    garrisonRangeSq: fx.mul(gRange, gRange),
    garrisonEffRange: gEff,
    garrisonEffRangeSq: fx.mul(gEff, gEff),
    isIndirect: (INDIRECT_MASK & (1 << cls)) !== 0 || w.indirect === true,
    submunitions: submunitionsFromJson(w.id, w.submunitions),
    coverIgnore: coverIgnoreFromJson(w.id, w.cover_ignore, w.submunitions),
    beam: beamFromJson(w, cls),
  };
}

/** E6 (GH-274 item 3): `beam`, loaded. A directed-energy weapon must carry one, no other may,
 *  and it is refused beside `indirect` or submunitions (the sight rule and the burst both
 *  assume a round). Seconds cross to ticks once; a value under one tick, or a heat budget
 *  shorter than one dwell (the beam could never deliver), throws naming the weapon. */
function beamFromJson(w: WeaponJson, cls: number): BeamStats | null {
  if (cls !== WEAPON_CLASS.directed_energy) {
    if (w.beam !== undefined) throw new Error(`weapon ${w.id}: beam is only for directed_energy`);
    return null;
  }
  if (w.beam === undefined) throw new Error(`weapon ${w.id}: directed_energy needs a beam block`);
  if (w.indirect === true) throw new Error(`weapon ${w.id}: a beam needs its own line of sight, so it cannot be indirect`);
  if (w.submunitions !== undefined) throw new Error(`weapon ${w.id}: a beam has no submunitions`);
  const b = w.beam;
  if (!(b.dwell_s <= 30 && b.heat_s <= 120 && b.cooldown_s <= 120)) {
    throw new Error(`weapon ${w.id}: beam times are capped at dwell 30 s, heat 120 s, cooldown 120 s`);
  }
  const dwellTicks = secondsToTicks(b.dwell_s);
  const heatTicks = secondsToTicks(b.heat_s);
  const coolTicks = secondsToTicks(b.cooldown_s);
  if (dwellTicks < 1 || coolTicks < 1) throw new Error(`weapon ${w.id}: beam dwell_s and cooldown_s are under one tick`);
  if (heatTicks < dwellTicks) throw new Error(`weapon ${w.id}: beam heat_s is shorter than dwell_s`);
  return { dwellTicks, heatTicks, coolTicks };
}

/** `cover_ignore`, loaded: 0-1, absent 0. A bad value throws naming the
 *  weapon, because out of range it would push a hit chance past the open-ground
 *  one or below the covered one, and nothing downstream would say why. */
function coverIgnoreFromJson(weaponId: string, raw: number | undefined, sub: SubmunitionJson | undefined): Fx {
  if (raw === undefined) return 0;
  // Bomblets detonate through splashDirect, which reads no weapon: the field
  // would silently do nothing there, so the pair is refused rather than ignored.
  if (sub !== undefined) throw new Error(`weapon ${weaponId}: cover_ignore is not applied to submunitions`);
  if (!(raw >= 0 && raw <= 1)) throw new Error(`weapon ${weaponId}: cover_ignore must be in 0-1, got ${raw}`);
  return fx.from(raw);
}

/**
 * `cost.population`, validated: an integer, zero or more. Absent is 1, the
 * schema default. A bad value throws naming the unit and the field, because a
 * fractional or negative population would make every later sum over the side
 * non-integer or wrong, and nothing downstream would say why.
 */
function populationFromJson(id: string, raw: number | undefined): number {
  if (raw === undefined) return 1;
  if (!Number.isInteger(raw) || raw < 0) {
    throw new Error(`unit ${id}: cost.population must be a non-negative integer, got ${raw}`);
  }
  return raw;
}

/** `swarm` -> fixed point. A swarm whose hp is not `count x member_hp` would make the live
 *  count disagree with its own pool at full health, so it is a data error. */
function swarmFromJson(json: UnitTypeJson): SwarmStats | null {
  const sw = json.swarm;
  if (sw === undefined) return null;
  if (!Number.isInteger(sw.count) || sw.count < 1) throw new Error(`unit ${json.id}: swarm.count must be a whole number >= 1`);
  const memberHp = fx.from(sw.member_hp);
  const spread = fx.from(sw.spread_tiles);
  if (memberHp <= 0) throw new Error(`unit ${json.id}: swarm.member_hp must be > 0`);
  if (spread <= 0) throw new Error(`unit ${json.id}: swarm.spread_tiles must be > 0`);
  if (fx.from(json.hull.armor.front) >= SOFT_ARMOR_LIMIT) {
    throw new Error(`unit ${json.id}: a swarm must be soft (a component roll would take the whole cloud)`);
  }
  if ((json.abilities ?? []).includes('kamikaze')) throw new Error(`unit ${json.id}: a swarm dives member by member, not as a kamikaze`);
  if (fx.from(json.hull.hp) !== fx.from(sw.count * sw.member_hp)) {
    throw new Error(`unit ${json.id}: swarm needs hull.hp === count x member_hp`);
  }
  return { count: sw.count, memberHp, spread };
}

/** `placed_charge` -> fixed point. A `placed` method without its block is a data error, and so
 *  is a block on a method that never reads it: either way the numbers would silently not apply. */
function placedChargeFromJson(json: UnitTypeJson): PlacedCharge | null {
  const placed = json.demolition_method === 'placed';
  const pc = json.placed_charge;
  if (placed && pc === undefined) throw new Error(`unit ${json.id}: demolition_method "placed" needs placed_charge`);
  if (!placed && pc !== undefined) throw new Error(`unit ${json.id}: placed_charge needs demolition_method "placed"`);
  if (pc === undefined) return null;
  const fuseTicks = fx.toInt(fx.mul(fx.from(pc.fuse_s), fx.fromInt(TICKS_PER_SECOND)));
  if (fuseTicks < 1) throw new Error(`unit ${json.id}: placed_charge.fuse_s is under one tick`);
  return {
    fuseTicks,
    blast: fx.from(pc.blast_tiles),
    damage: fx.from(pc.damage),
    suppression: fx.from(pc.suppression),
    withdraw: fx.from(pc.withdraw_tiles),
  };
}

export function unitTypeFromJson(json: UnitTypeJson): UnitType {
  const aps = json.hull.aps;
  const population = populationFromJson(json.id, json.cost?.population);
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
  const isKamikaze = abilities.includes('kamikaze');
  const armed = (json.weapons ?? []).length > 0;
  const stabiliseSq = woundRadiusSq(json.id, 'hull.stabilise_radius', json.hull.stabilise_radius ?? 0);
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
    swarm: swarmFromJson(json),
    placed: placedChargeFromJson(json),
    canDig: abilities.includes('dig_tunnel'),
    canTunnelCharge: abilities.includes('tunnel_charge'),
    tunnelChargeTicks: fx.toInt(
      fx.mul(fx.from(json.tunnel_charge_time_s ?? CHARGE_SECONDS), fx.fromInt(TICKS_PER_SECOND)),
    ),
    isKamikaze,
    isAir,
    wheeled,
    // A kamikaze is excluded because its sprint IS the attack (charge_squad,
    // the drones): there is no aimed shot to kneel for. Unarmed is excluded
    // because there is nothing to fire.
    haltsToFire: json.mobility.halts_to_fire ?? (!wheeled && !isAir && !isKamikaze && armed),
    // Air never pays for a vehicle field: it flies over the boulders the
    // vehicle mask exists to describe.
    moveDomain: !isAir && wheeled ? DOMAIN_VEHICLE : DOMAIN_FOOT,
    pathDomain: isAir ? DOMAIN_AIR : wheeled ? DOMAIN_VEHICLE : DOMAIN_FOOT,
    population,
    transportSlots: json.hull.transport_slots ?? 0,
    isAirCarrier: isAir && (json.hull.transport_slots ?? 0) > 0,
    // GH-581: on foot AND a foot role. A vehicle never embarks, so the default is decided by the
    // same `wheeled` answer that picks the movement domain -- a launcher on a 6x6 (role
    // `artillery`) or a bulldozer (role `engineer`) that omits `can_embark` is still refused.
    canEmbark: json.hull.can_embark ?? (FOOT_ROLES.has(json.role ?? '') && !wheeled),
    canMarkTarget: abilities.includes('mark_target'),
    canMarkTunnel: abilities.includes('mark_tunnel'),
    canSmoke: abilities.includes('smoke'),
    canConstruct: abilities.includes('construct'),
    canRepair: abilities.includes('repair'),
    partialMobility: json.mobility.gear === 'wheels',
    constructRate: fx.from(json.construct_rate ?? 1),
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
    figures: figuresFromJson(json),
    wounds: woundsFromJson(json),
    woundedTypeIdx: -1,
    isWounded: json.role === 'wounded',
    canCarry: json.hull.can_carry ?? null,
    stabiliseRadiusSq: stabiliseSq,
    rescue:
      json.rescue === undefined
        ? null
        : {
            radiusSq: woundRadiusSq(json.id, 'rescue.radius_tiles', json.rescue.radius_tiles),
            treatTicks: woundSeconds(json.id, 'rescue.treat_s', json.rescue.treat_s),
            dragMult: fx.from(json.rescue.drag_speed_mult),
            carryMult: fx.from(json.rescue.carry_speed_mult),
          },
    aura: unitAuraFromJson(json),
  };
}

/** GH-707: `hull.figures`, an integer 1-8, absent 1. */
function figuresFromJson(json: UnitTypeJson): number {
  const f = json.hull.figures ?? 1;
  if (!Number.isInteger(f) || f < 1 || f > 8) throw new Error(`unit ${json.id}: hull.figures must be an integer 1..8, got ${f}`);
  return f;
}

// ---------------------------------------------------------------------------
// Commands and events
// ---------------------------------------------------------------------------

export type Command =
  /** `exact`: keep the point as given and assign no slot — for orders the sim
   *  issues ITSELF to shepherd a unit to a point a rule has already chosen (a
   *  civilian's refuge), never for a player order. A group formation exists to
   *  answer "where should these units stand"; an exact order already has the
   *  answer, and spreading it around would move a unit off ground a rule
   *  picked. Such an order still RESERVES its goal tile against everyone
   *  else's slots — it opts out of being placed, not out of being avoided.
   *  `CivilianFlight` (`./civilians`) is the sole intended caller. A patrol
   *  leg (`mission.ts`'s `stepPatrols`) is deliberately NOT exact: it is an
   *  ordinary order, because a patroller whose waypoint tile is held by an
   *  idle friend should stop beside it rather than displace it — spec
   *  `2026-09-15-group-formation-design.md` §4.3. */
  | { kind: 'move'; ids: number[]; x: Fx; y: Fx; append?: boolean; exact?: boolean }
  /** `sweep`: having arrived, go on to hunt what the side remembers
   *  (`stepSweep`). Without it an attack-move STOPS WHERE IT WAS SENT and
   *  fights whatever comes inside its own engagement range from there — the
   *  lead's ruling of 2026-10-11, because a player who clicks a tile means
   *  that tile. The sweep exists so an AI wave or a scripted `commit` does
   *  not park in a staring contest with a hidden defender, so those callers
   *  ask for it (`mission.ts`). It is data on the order, never a guess at
   *  who sent it: the sim does not know which side is "the player". */
  | { kind: 'attackMove'; ids: number[]; x: Fx; y: Fx; append?: boolean; exact?: boolean; sweep?: boolean }
  | { kind: 'halt'; ids: number[] }
  /** N2 (L3, D2). `hold`: halt's own writes on a free unit -- the walk ends, an
   *  ambush is dropped, the unit stands and fires on what comes; a garrisoned or
   *  carried unit is left as it is (the building or the vehicle is its hold).
   *  `ambush`: the same halt, then `setAmbush(id, radius ?? AMBUSH_RADIUS_DEFAULT)`.
   *  Both skip a dead, routed, garrisoned or carried id; a buried one never gets
   *  here (the containment filter).
   *  `patrol` (N3 Task 9, Q6): the same halt, then walk `waypoints` (2 to
   *  `MAX_PATROL_WAYPOINTS`, Q16.16 points) in order and round again, halting to
   *  fight on contact as the mission runtime's `stepPatrols` does (`stepPatrolStance`).
   *  Any later order naming the unit drops it (`dropPatrol`); a refused `attack` or
   *  `rescue` changes nothing, as ever (GH-420). A count out of bounds refuses the
   *  whole command. */
  | { kind: 'setStance'; ids: number[]; stance: 'hold' | 'ambush'; radius?: Fx }
  | { kind: 'setStance'; ids: number[]; stance: 'patrol'; waypoints: [Fx, Fx][] }
  | { kind: 'garrison'; ids: number[]; structure: number }
  /** Climb aboard a vehicle with seats. */
  | { kind: 'load'; ids: number[]; carrier: number }
  /** Put the passengers down beside the vehicle. */
  | { kind: 'unload'; ids: number[] }
  /** Bought with intel: reveal everything hostile around a point. */
  | { kind: 'reveal'; side: number; x: Fx; y: Fx }
  /** Bought with intel: a precision strike, attributed to the caller so
   *  ROE charges it to the player who ordered it. */
  | { kind: 'callStrike'; caller: number; x: Fx; y: Fx; profile?: number } // absent = FS_AIR_STRIKE
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
  | { kind: 'chargeTunnel'; ids: number[]; tunnel: number }
  /**
   * Versus tunnels (GH-681): walk to the nearer end of route `tunnel` -- the
   * mouth or the vent -- and go below there. Only foot units of the route's
   * owning side (`TunnelRouteJson.side`) take it; a route with no owner admits
   * nobody. Entered at the mouth, the unit crawls to the vent at
   * `TUNNEL_TILES_PER_S`; entered at the vent, it is there at once. Any later
   * order naming the unit cancels the walk.
   */
  | { kind: 'enterTunnel'; ids: number[]; tunnel: number }
  /**
   * Versus tunnels (GH-681): bring buried units that have reached the vent up,
   * target or not. `raid` is the scripted pop-up (the exposure window and the
   * volley, then back down); `exit` comes up for good. The one command the
   * containment rule lets reach a buried unit.
   */
  | { kind: 'vent'; ids: number[]; mode: 'raid' | 'exit' }
  /**
   * Fire on THIS enemy (Stage 4 targeted fire, GH-420). Sets the unit's
   * `focusTarget`; any other order that names the unit releases it. The sim
   * accepts the order on geometry-free grounds only (`canFocus`): whether a
   * given weapon can hurt the target from where it stands flips with the
   * target's facing, so that judgement is the app's to show and the combat
   * step's to apply. A refused id is a no-op.
   */
  | { kind: 'attack'; ids: number[]; target: number }
  /**
   * GH-707 Task 5: treat and carry THIS wounded. Taken by medics only (a type with a `rescue`
   * block), for a target that is DOWN or STABILISED, not aboard anything, and of the medic's
   * own side or identified by it -- an enemy or civilian the side cannot see is refused. The
   * one way to rescue an enemy wounded (D2). A refused id changes nothing.
   */
  | { kind: 'rescue'; ids: number[]; target: number }
  /** N2: buy a unit. The MissionRuntime prices and queues it; the sim never
   *  executes it (R-3). Any human-held side (N3 Task 4; `MissionRuntime.applyQueued`). */
  | { kind: 'build'; side: number; unit: string; line?: number }
  /** F4: cancel `index` on production line `line` (-1 = the item in progress). Runtime-priced. */
  | { kind: 'cancelBuild'; side: number; line: number; index: number }
  /** F4: set a line's rally point. Runtime-resolved (blocked tiles are the runtime's refusal). */
  | { kind: 'setRally'; side: number; line: number; x: Fx; y: Fx }
  /** F4: clear a line's rally point. */
  | { kind: 'clearRally'; side: number; line: number }
  /** N2: one call from F1's fire-support menu, priced as `build` is. */
  | { kind: 'support'; side: number; support: SupportKind; x: Fx; y: Fx }
  /**
   * Field works (#277): raise a `buildable` structure type with its footprint's top-left tile at
   * integer tile (x, y). The site belongs to the builders' side (the first qualifying id's; ids
   * of another side are ignored). The sim re-checks `placementReason` here and answers with
   * `constructQueued` or `constructRefused`. Naming the type and origin of a live site of the
   * same side JOINS it instead (a second engineer resuming a staked site), with no new row.
   */
  | { kind: 'construct'; ids: number[]; structType: number; x: number; y: number }
  /** Field works: take a site down. Unstaked, the row is freed; staked, the structure is
   *  removed (`removeStructure`); a completed site is no longer a site, so it is ignored. */
  | { kind: 'cancelConstruct'; site: number }
  /**
   * Field works through the order sink (GH-277 follow-up): the player's request to raise listed
   * works type `works` (its JSON id) with its footprint's top-left tile at integer tile (x, y),
   * with `ids` as the builders (empty: the runtime's nearest idle carrier). Runtime-priced, like
   * `build`: the sim sets it aside and `MissionRuntime.applyQueued` runs it through
   * `requestConstruct`, which takes the price and queues the sim's own `construct`.
   */
  | { kind: 'raiseWorks'; side: number; works: string; x: number; y: number; ids: number[] }
  /** The player's request to take down one of his own field-works sites (`site` is the works
   *  row). Runtime-run (`requestCancelWorks`), which queues the sim's `cancelConstruct`. */
  | { kind: 'cancelWorks'; side: number; site: number };

/** Why a field-works footprint is refused (`Sim.placementReason`), the first failing rule. */
export type PlacementRefusal = 'off_map' | 'blocked' | 'no_footing' | 'not_level' | 'overlap' | 'seals_passage';

/** The seven commands the sim sets aside for the MissionRuntime to price and run (N2, F4, and
 *  field works' `raiseWorks`/`cancelWorks`): `queueCommand` never hands them to `applyCommands`. */
export type RuntimeCommand = Extract<Command, { kind: 'build' | 'support' | 'cancelBuild' | 'setRally' | 'clearRally' | 'raiseWorks' | 'cancelWorks' }>;
/** `takeRuntimeCommands`' answer when nothing is set aside: shared, frozen, no allocation. */
const NO_RUNTIME_COMMANDS: readonly RuntimeCommand[] = Object.freeze([]);

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
  /** #706: a mobility hit on a `gear: wheels` hull that was sound -- it is now
   *  SLOWED (`mobilityDamaged`), not stuck, and keeps driving. */
  | 'mobility_damaged'
  | 'firepower_kill'
  | 'combat_ineffective'
  | 'catastrophic';

/** Every roll the model makes is on an event, in full, for the debug overlay.
 *  All numeric payloads are raw Q16.16 — the render side converts. */
export type SimEvent =
  | { kind: 'spawn'; tick: number; entity: number; typeId: string; side: number }
  | {
      kind: 'contact';
      tick: number;
      side: number;
      target: number;
      level: ContactLevel;
      confidence: Fx;
      observer: number;
      /** Field works (#277 Task 7): the sensor structure that saw it, present only when the
       *  observation was structure-sourced, in which case `observer` is -1. */
      observerStructure?: number;
    }
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
  /** E3 (GH-709): one bomblet of a submunition round landed at (x, y). A round's
   *  bomblets are pushed consecutively, `index` 0 to `count - 1`, in the tick the
   *  parent lands; `weaponId` is the parent's. The ROE judge groups a round by
   *  them. A submunition round raises no `nearMiss` and no `impact` of its own. */
  | { kind: 'submunition'; tick: number; by: number; weaponId: string; x: Fx; y: Fx; index: number; count: number }
  | { kind: 'ambushSprung'; tick: number; entity: number }
  | { kind: 'strike'; tick: number; by: number; x: Fx; y: Fx; profile: number }
  | { kind: 'smokeLaid'; tick: number; by: number; x: Fx; y: Fx }
  | { kind: 'revealed'; tick: number; side: number; count: number }
  | { kind: 'structureHit'; tick: number; structure: number; by: number; damage: Fx; hpLeft: Fx }
  | { kind: 'structureDestroyed'; tick: number; structure: number; by: number }
  | { kind: 'garrison'; tick: number; entity: number; structure: number; entered: boolean }
  | { kind: 'transport'; tick: number; entity: number; carrier: number; loaded: boolean }
  | { kind: 'ventOpened'; tick: number; tunnel: number }
  | {
      kind: 'tunnelContact';
      tick: number;
      side: number;
      tunnel: number;
      level: ContactLevel;
      observer: number;
      /** Field works (#277 Task 7): the sensor structure, when structure-sourced (`observer` -1). */
      observerStructure?: number;
    }
  | { kind: 'surfaced'; tick: number; entity: number; tunnel: number }
  | { kind: 'submerged'; tick: number; entity: number; tunnel: number }
  | { kind: 'tunnelCollapsed'; tick: number; tunnel: number; by: number }
  /** E6 (GH-274, G1): a `placed` demolisher armed a fused charge on `structure`. `by` is the
   *  carrier; it stays the attribution when the fuse runs out, alive or not. */
  | { kind: 'chargeSet'; tick: number; structure: number; by: number; fuseTicks: number }
  /** E6 (GH-274, G1): the fuse ran out. The structure fell and the blast has been dealt. */
  | { kind: 'chargeDetonated'; tick: number; structure: number; by: number }
  | { kind: 'routed'; tick: number; entity: number }
  /** #706: a stuck ground hull's crew fixed it in the field (FIELD_FIX_TICKS of
   *  quiet, halved by a `repair` unit standing by). It is SLOWED now, not sound. */
  | { kind: 'fieldFixed'; tick: number; entity: number }
  | { kind: 'rallied'; tick: number; entity: number }
  | { kind: 'pinned'; tick: number; entity: number }
  | { kind: 'unpinned'; tick: number; entity: number }
  | { kind: 'destroyed'; tick: number; entity: number; by: number }
  /** GH-707: a man fell wounded. `entity` is the wounded (a new `wounded`-role unit, or the
   *  unit itself when it went down in place); `parent` the squad he fell from, -1 in place or
   *  for the squad's last man (ruling 5); `by` who downed him, -1 for nobody. */
  | { kind: 'woundedDown'; tick: number; entity: number; parent: number; by: number }
  /** GH-707: a man of squad `entity` was killed outright at a share crossing (the roll failed,
   *  the side's wounded cap or the sim's capacity was reached, or no wounded type resolves).
   *  The squad's LAST man is its `destroyed`, never this. */
  | { kind: 'manKilled'; tick: number; entity: number; by: number }
  /** GH-707: a DOWN wounded's bleed ran out. Followed in the same tick by his `destroyed`,
   *  whose `by` is the man who downed him (`woundBy`), so kill credit and Conduct stay
   *  with the shooter. */
  | { kind: 'bledOut'; tick: number; entity: number }
  /** GH-707 Task 4: a wounded aboard `carrier` left the fight alive -- a ground carrier on its
   *  side's evac point, or an air carrier lifting off. `side` is the RESCUING side (the
   *  carrier's), which Conduct reads. He is `alive` 0 with no `destroyed`. */
  | { kind: 'woundEvacuated'; tick: number; entity: number; carrier: number; side: number }
  /** GH-707 Task 5: `medic` finished treating DOWN wounded `entity`: he is STABILISED and
   *  bleeds no more. */
  | { kind: 'woundStabilised'; tick: number; entity: number; medic: number }
  /** GH-707 Task 6: wounded `entity` was carried within `admit_radius` of aid structure
   *  `structure` owned by the carrier's side `side` (the ADMITTING side, which Conduct reads)
   *  and is under treatment there: `alive` 0, `removed` 1, no `destroyed`. */
  | { kind: 'woundAdmitted'; tick: number; entity: number; structure: number; side: number }
  /** GH-707 Task 6: admitted wounded `entity` walked back into squad `squad` (his own, or the
   *  nearest same-type squad below full when his own is gone): one man more, a scarred share
   *  of hp. A treatment that ends any other way is a `woundEvacuated` with `carrier` -1. */
  | { kind: 'woundRejoined'; tick: number; entity: number; squad: number }
  /** GH-707 Task 6: aid structure `structure` fell while admitted wounded `entity` was under
   *  treatment there: he is lost (woundState GONE). */
  | { kind: 'woundLost'; tick: number; entity: number; structure: number }
  /** Field works (#277): a `construct` was accepted. `builder` is the lowest qualifying id the
   *  command named. `joined`: it named a live site's type and origin and joined that site rather
   *  than opening one (nothing new to pay for). */
  | { kind: 'constructQueued'; tick: number; site: number; structType: number; x: number; y: number; builder: number; joined: boolean }
  /** Field works: a `construct` the sim would not take. `no_builder`: no id named was a living,
   *  surface `construct` unit that could take the order. The runtime refunds on this. */
  | { kind: 'constructRefused'; tick: number; structType: number; x: number; y: number; reason: PlacementRefusal | 'no_site_slot' | 'no_builder' }
  /** Field works: the first builder arrived and the footprint is now a structure, at progress 0. */
  | { kind: 'constructStaked'; tick: number; site: number; structure: number }
  /** Field works: progress reached ONE; the site row is free again. */
  | { kind: 'structureComplete'; tick: number; site: number; structure: number }
  /** Field works: a site was cancelled. `structure` -1 when it was never staked; `progress` is
   *  what had been built (0 unstaked), for the runtime's refund. */
  | { kind: 'constructCancelled'; tick: number; site: number; structure: number; progress: Fx }
  /**
   * A mission `remove` trigger took this entity off the board — the enemy's
   * act, never the player's, and never a death. Emitted by `removeFromPlay`,
   * which does not call `destroy()`: no `by`, because nothing did this to
   * it in combat terms, and `stepRoe` (which only reads `destroyed`) is
   * built to see nothing here on purpose.
   */
  | { kind: 'removed'; tick: number; entity: number; side: number }
  /** E6 (GH-274 item 3): a beam delivered its damage (`struck`, the dwell completed) or its heat
   *  reached the limit (`lockout`, silent until `until`). `target` is -1 on a lockout. No
   *  projectile exists; a presentation draws the line from this. */
  | { kind: 'beam'; tick: number; shooter: number; target: number; weaponId: string; phase: 'struck' | 'lockout'; until: number };

/** Every `SimEvent` kind, as a value.
 *
 *  A `type` cannot be iterated at runtime, and the tutorial validates step JSON
 *  against this list. `satisfies` ties it to the union: adding an event kind
 *  without adding it here fails typecheck.
 */
export const SIM_EVENT_KINDS = [
  'spawn', 'contact', 'fire', 'aps', 'impact', 'component', 'nearMiss', 'submunition', 'ambushSprung',
  'strike', 'smokeLaid', 'revealed', 'structureHit', 'structureDestroyed', 'garrison',
  'transport', 'ventOpened', 'tunnelContact', 'surfaced', 'submerged', 'tunnelCollapsed', 'chargeSet', 'chargeDetonated', 'routed', 'rallied', 'pinned', 'unpinned', 'destroyed',
  'fieldFixed', 'beam',
  'removed', 'woundedDown', 'manKilled', 'bledOut', 'woundEvacuated', 'woundStabilised',
  'woundAdmitted', 'woundRejoined', 'woundLost',
  'constructQueued', 'constructRefused', 'constructStaked', 'structureComplete', 'constructCancelled',
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

/** A called-for strike still in the air (`Sim.pendingStrikes`). */
export type PendingStrike = { x: Fx; y: Fx; by: number; readyTick: number; profile: number };

/** Every key of a `PendingStrike`, as a value, for the snapshot decoder. `satisfies` catches a name that is
 *  not a key; the pair of aliases below catches a key missing from the list, so a new field on the strike
 *  fails typecheck here instead of making every in-flight strike refuse at restore. */
export const STRIKE_SNAPSHOT_KEYS = ['x', 'y', 'by', 'readyTick', 'profile'] as const satisfies readonly (keyof PendingStrike)[];
type MissingStrikeKey = Exclude<keyof PendingStrike, (typeof STRIKE_SNAPSHOT_KEYS)[number]>;
type AssertNoMissingStrikeKey<T extends never> = T;
export type StrikeKeysAreExhaustive = AssertNoMissingStrikeKey<MissingStrikeKey>;

/** The flow-field pool's keys (`Sim.fieldPoolKeys`): enough to rebuild every keyed field and to
 *  reproduce `fieldFor`'s later choices, without the field bytes. `slots[i].goal` is -1 for a slot
 *  the pool no longer keys; `order[d]` is domain d's slot list in `fieldByGoal[d]` insertion order. */
export interface FieldPoolKeys {
  watermark: number;
  slots: { goal: number; domain: number; lastIssued: number }[];
  order: number[][];
}

export interface SimConfig {
  seed: number;
  width: number;
  height: number;
  capacity: number;
  /** N2 (L1): which combatant side a person holds, by side index 0 and 1.
   *  From `seatRules(config).humanHeld` (`@lions/net`); the sim never reads a
   *  config. Absent: `[true, false]`, single-player's rule. Side 2 (civilians)
   *  is never human-held. Not hashed (R-2). */
  humanHeld?: readonly [boolean, boolean];
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
/** `stance` values: 0 none, 1 ambush, 2 a `setStance{patrol}` beat (N3 Task 9). */
const STANCE_PATROL = 2;
/** Flow fields kept alive at once. Slots give every unit in an order its own
 *  goal tile (formation.ts), so a twelve-unit order can want twelve fields
 *  where it used to want one. Beyond this many, `fieldFor` reuses the
 *  least-recently-issued field that no living unit still follows; it only
 *  grows past this when every field is live, which takes more distinct
 *  goals than there are units, or when the only unreferenced fields were
 *  issued this tick. 128 × ~11.5 KB on a 48×48 map is 1.5 MB. */
export const MAX_FLOW_FIELDS = 128;
/** What `restoreFieldPool` will allocate for a pool, in bytes (snapshot codec). The pool's real size is NOT
 *  bounded by `capacity + MAX_FLOW_FIELDS`: every group order issues one field per unit, `evictableField`
 *  never reuses a field issued this tick, and `fields` never shrinks, so several orders to the same units
 *  within ONE tick grow it by about one field per unit per extra order (five orders to 60 units: 293 on a
 *  capacity-128 world). Its growth is bounded by command volume. This bound therefore only has to stop a
 *  hostile watermark from allocating without limit: `watermark * cells * 5` (a u8 dir plus an i32 cost per
 *  cell) must fit, which is 5,825 fields on a 48x48 map. */
export const POOL_RESTORE_BUDGET_BYTES = 64 * 1024 * 1024;
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

/** How far a laid smoke screen rises above the ground it sits on, in elevation
 *  levels. A plume is a column `elevation + SMOKE_RISE` tall on each tile it
 *  covers, and a sight line passing above that column is not obscured by it.
 *
 *  MUST STAY STRICTLY ABOVE EYE_HEIGHT, and that is the load-bearing half. On
 *  flat ground the sight line sits at exactly EYE_HEIGHT above every tile it
 *  crosses, so a plume of height EYE_HEIGHT or less never reaches it and smoke
 *  stops working on every shipped map at once -- the mirror of the
 *  EYE_HEIGHT < BLOCK_RISE coupling above, and asserted by the same test file.
 *
 *  2 is BLOCK_RISE, deliberately. A screen laid to mask a street crossing has
 *  to mask what the buildings either side of that street mask, or it is not a
 *  screen; and making it TALLER than a building would make smoke a better wall
 *  than a wall -- a plume dropped in a valley would blind an observer on ground
 *  that already sees over the ridges around it, which is half of the bug this
 *  constant exists to remove, reintroduced one level smaller. So the authoring
 *  rule is the same sentence as the terrain one: smoke obscures what a building
 *  obscures, from the same places. High ground that sees over the rooftops sees
 *  over the smoke too. */
export const SMOKE_RISE = 2;

// ---------------------------------------------------------------------------

/** distance² in Q16.16 tile² without overflow: (d>>8)² == d²>>16 exactly
 *  enough for ranges; safe out to ±176 tiles. */
/** GH-707 Task 5: `deliveryTarget`'s answer; Task 6 added the aid post. */
const DELIVER_NONE = 0;
const DELIVER_CARRIER = 1;
const DELIVER_EVAC = 2;
const DELIVER_AID = 3;

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
  /**
   * A mission trigger's `remove` took this body off the board — an
   * abduction, not a kill. `alive` still flips to 0 (see `removeFromPlay`),
   * so every existing alive-gated loop already treats it as gone; this flag
   * exists only for the two callers that must tell the difference:
   * `casualties_pct` (a removed enemy is not a casualty) and the renderer
   * (no death clip, no wreck). Deliberately absent from `hash()` — nothing
   * in the golden replay ever calls `removeFromPlay`, and appending even an
   * all-zero array to a multiplicative hash still moves the final value, so
   * hashing it would move the pinned number for no behavioural reason.
   */
  private readonly removed: Uint8Array;
  private readonly side: Uint8Array;
  private readonly typeIdx: Uint16Array;
  private readonly posX: Int32Array;
  private readonly posY: Int32Array;
  private readonly facing: Int32Array;
  private readonly hp: Int32Array;
  private readonly suppression: Int32Array;
  /** Where the last HOSTILE suppression on this unit came from (Q16.16), and
   *  1 in `suppFromSet` once any has landed. Same-side and sourceless shocks
   *  (a crew shaken, a bail-out) leave it alone. `startRout` reads it to run
   *  away from fire the unit's side cannot see (GH-291). Never cleared but
   *  by spawn: a stale source still points away from the last fire there was. */
  private readonly suppFromX: Int32Array;
  private readonly suppFromY: Int32Array;
  private readonly suppFromSet: Uint8Array;
  private readonly moving: Uint8Array;
  private readonly attackMove: Uint8Array;
  /** 1 while the current attack-move leg was ordered with `sweep` — the
   *  only kind `stepSweep` will walk on from its goal. Meaningless unless
   *  `attackMove` is 1. */
  private readonly sweepOrder: Uint8Array;
  private readonly goalX: Int32Array;
  private readonly goalY: Int32Array;
  private readonly fieldRef: Int32Array;
  // combat state
  private readonly cooldown: Int32Array; // 2 slots per entity
  // E6 (GH-274 item 3): beam state, 2 slots per entity like `cooldown`. Hashed only once
  // `beamLive` is set (the deferred fold), so a world with no beam moves no pin.
  /** The target the beam is dwelling on, or -1. */
  private readonly beamTgt: Int32Array;
  /** Ticks of uninterrupted dwell so far. */
  private readonly beamDwell: Int32Array;
  /** Heat in ticks of time on target, as of `beamAt`; drains one per idle tick (lazily). */
  private readonly beamHeat: Int32Array;
  /** The last tick the beam was on a target, or -1. A dwell continues only from the tick before. */
  private readonly beamAt: Int32Array;
  /** The tick the lockout ends (exclusive), 0 when none has run. */
  private readonly beamLock: Int32Array;
  /** True once any beam weapon has been on a target; hash() folds the beam block only while set. */
  private beamLive = false;
  private readonly lastFired: Int32Array;
  private readonly engaging: Uint8Array;
  private readonly curTarget: Int32Array;
  /** The entity this unit was ORDERED to fire on (`attack`), -1 when none.
   *  Hashed: it will decide whom the unit shoots and where it walks. Set by
   *  the `attack` command, cleared by any other order that names the unit and
   *  by a rout; ids are never recycled, so a stale value cannot alias a new
   *  unit. */
  private readonly focusTarget: Int32Array;
  /** Ticks the issuer's side has gone without a firing solution on
   *  `focusTarget` (the T-D3 lost counter). Zero whenever there is no focus or
   *  the focus is held. Hashed, and added with the column above so the focus
   *  behaviour that follows is hash-neutral. */
  private readonly focusLost: Uint16Array;
  /** GH-698: air flight state, AIR_AIRBORNE..AIR_LIFTING (tuning.ts). 0 (AIRBORNE)
   *  for every ground unit, and for every non-carrier aircraft until a mobility kill
   *  brings it down (#706 §3.5, the forced landing). Folded into hash() only once
   *  `airLive` is set. */
  private readonly airState: Uint8Array;
  /** GH-698: ticks left in AIR_LANDING / AIR_LIFTING. Hashed with `airState`. */
  private readonly airTimer: Uint16Array;
  /** GH-698: what an air carrier lands for, AIR_WANT_* (tuning.ts). Hashed with `airState`. */
  private readonly airWant: Uint8Array;
  /** GH-698, Q-A (deferred fold, lead 21 Oct): true once `addUnitType` registers an air
   *  carrier type, or (#706 §3.5) once any aircraft is mobility-killed -- the one way a
   *  non-carrier aircraft leaves AIRBORNE. hash() folds the air block only while set,
   *  so no world without either moves any pin. Same shape as field works' `fwLive` (D1). */
  private airLive = false;
  // GH-707 (wounded and rescue, P1 engine). Every column below is folded into hash() only
  // once `woundLive` is set -- the `airLive`/`fwLive` deferred fold -- so a world with no
  // wound-related type moves no pin. Defaults are written in `spawn`.
  /** Men still standing in the team, `type.figures` at spawn. */
  private readonly figuresUp: Uint8Array;
  /** Times this team has taken a man back from an aid post (`scarredShare`). */
  private readonly scars: Uint8Array;
  /** The squad a wounded man fell from, -1 when none (in place, or the last man). */
  private readonly woundParent: Int32Array;
  /** Who downed him, -1 for nobody: the `by` of his bleed-out `destroyed`. */
  private readonly woundBy: Int32Array;
  /** WOUND_NONE..WOUND_GONE (tuning.ts). */
  private readonly woundState: Uint8Array;
  /** Ticks a DOWN man has left before he bleeds out. */
  private readonly bleedTicks: Int32Array;
  /** Ticks of treatment left at an aid post (ADMITTED). */
  private readonly woundTimer: Int32Array;
  /** MED_IDLE..MED_DELIVERING (tuning.ts), a medic's automatic behaviour. */
  private readonly medState: Uint8Array;
  /** The wounded a medic is working on, -1 when none. */
  private readonly medTarget: Int32Array;
  /** Ticks of treatment a medic has left on `medTarget`. */
  private readonly medTimer: Int32Array;
  /** Movement multiplier, Q16.16, ONE unless the unit drags or carries a wounded. */
  private readonly speedMul: Int32Array;
  /** The aid structure treating an ADMITTED man, -1 otherwise. */
  private readonly admittedAt: Int32Array;
  /** Wounded alive per side (0, 1, 2): the MAX_WOUNDED_PER_SIDE count. */
  private readonly woundedAlive = new Int32Array(3);
  /** Evacuation points (D4), MAX_EVAC_POINTS rows; `evacCount` are in use. */
  private readonly evacX = new Int32Array(MAX_EVAC_POINTS);
  private readonly evacY = new Int32Array(MAX_EVAC_POINTS);
  private readonly evacSide = new Int32Array(MAX_EVAC_POINTS);
  private evacCount = 0;
  /** GH-707 Task 6: structures with an `aid` block ever added (never decremented): the
   *  aid-post steps' early-out. Derived from the structure table, so not hashed. */
  private aidPosts = 0;
  /** GH-707 Task 5: `deliveryTarget`'s answer -- a carrier id or an evac point index, and the
   *  point to walk to. Scratch, read straight after the call that wrote it; never hashed. */
  private deliverId = -1;
  private deliverX: Fx = 0;
  private deliverY: Fx = 0;
  /** GH-707: true once `addUnitType` registers a type with `wounds`, `rescue`, `can_carry` or
   *  role `wounded`, or `addStructure` places (or stakes) a structure with `aid`. hash() folds the wound block only
   *  while set, so no world without wound content moves any pin. */
  private woundLive = false;
  /** Structure this unit is currently engaging, -1 when none. */
  private readonly curStructure: Int32Array;
  private readonly mobilityKilled: Uint8Array;
  /** #706: SLOWED -- moves at MOB_DAMAGED_PCT of its step. Set by a first
   *  mobility hit on a `gear: wheels` hull, or by a crew field fix; cleared by
   *  the workshop aura. Hashed behind `mobLive`. */
  private readonly mobilityDamaged: Uint8Array;
  /** #706: a stuck ground hull's crew repair clock, ticks of quiet so far (2 a
   *  tick with a `repair` unit by). Hashed behind `mobLive`. */
  private readonly fieldFixTicks: Int32Array;
  /** #706: true once any mobility result (stuck or slowed) has been applied.
   *  hash() folds `mobilityDamaged` and `fieldFixTicks` only while it is set,
   *  so a world that never sees one keeps its digest. Never cleared. Same shape
   *  as `fwLive` (D1). */
  private mobLive = false;
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
  /** BRACE_* per entity: whether a unit that halts to fire is standing,
   *  getting down, down, or getting up. Hashed -- it gates both firing and
   *  movement. See the BRACE_ constants and `stepBrace`. */
  private readonly brace: Uint8Array;
  /** Ticks left in a DROPPING or RISING transition; 0 otherwise. Hashed. An
   *  interrupted transition starts shorter than the full constant (stepBrace),
   *  so this, not "ticks since the state changed", is what a clip follows. */
  private readonly braceTicks: Int32Array;
  /** Scratch, written by stepCombat and read by stepBrace in the same tick:
   *  1 when this unit wants to be down this tick. Cleared at the top of every
   *  stepCombat and never hashed -- it is derived from target selection, which
   *  the hash already covers through curTarget/engaging and the outcome
   *  through `brace`. */
  private readonly braceWant: Uint8Array;
  /** Ticks spent in the current brace state, reset on every transition.
   *  Read for the attack-move bound (stepBrace): how long a man has been up
   *  and moving, or down and firing, in the band between effective and
   *  maximum range. Hashed: it decides when he next halts. */
  private readonly braceClock: Int32Array;
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
  /** Per queued leg, `sweepOrder`'s value once that leg becomes current. */
  private readonly wpSweep: Uint8Array;
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
  /** GH-681: the route end an `enterTunnel` order is walking this unit to, -1
   *  for none: `r` for route r's mouth, `-(r + 2)` for its vent. Hashed only
   *  behind `tnOrderLive`. */
  private readonly tunnelGoal: Int32Array;
  /** GH-681: ticks until a unit that went below at a mouth reaches the vent;
   *  0 at the vent (or never ordered). Hashed only behind `tnOrderLive`. */
  private readonly tunnelEta: Int32Array;
  /** GH-681: true once any `enterTunnel` or `vent` order has been accepted.
   *  hash() folds `tunnelGoal` and `tunnelEta` only while it is set, so a world
   *  that never sees one keeps its digest (the `mobLive` / `fwLive` shape).
   *  Never cleared. */
  private tnOrderLive = false;
  /** N3 Task 9 (Q6): a `setStance{patrol}` unit's beat, `MAX_PATROL_WAYPOINTS` slots
   *  per unit (Q16.16), read only while `stance` is 2. Hashed only behind `patrolLive`. */
  private readonly patrolX: Int32Array;
  private readonly patrolY: Int32Array;
  /** How many of the unit's slots its beat uses (2..MAX_PATROL_WAYPOINTS). */
  private readonly patrolCount: Uint8Array;
  /** The waypoint the unit's next leg goes to: the runtime `stepPatrols`' `idx`. */
  private readonly patrolIdx: Uint8Array;
  /** True once any `setStance{patrol}` has been accepted for a unit. hash() folds
   *  the four patrol columns only while it is set, so a world that never patrols
   *  keeps its digest (the `mobLive` / `tnOrderLive` shape); it also gates
   *  `stepPatrolStance` and `dropPatrol`. Never cleared. */
  private patrolLive = false;
  /** One-element scratch `ids` for a patrol leg, reused rather than allocated per leg. */
  private readonly patrolLegIds: number[] = [0];
  /** Called-for strikes still in the air. */
  private pendingStrikes: PendingStrike[] = [];

  // --- structure SoA ---
  private structureCount_ = 0;
  readonly structureTypes: StructureType[] = [];
  private readonly stAlive: Uint8Array;
  private readonly stHp: Int32Array;
  private readonly stMaxHp: Int32Array;
  private readonly stTypeIdx: Uint16Array;
  /** Per-placement `produces_for` (F4 Task 7). Setup-only; NOT in hash(), but
   *  snapshot STATE all the same (snapshot-schema.ts): the runtime's income-zone
   *  route and rear caches read it, and poisoning it kept every hash equal for
   *  1,200 ticks while those caches diverged. */
  private readonly stProducesFor: Int8Array;
  private readonly stOccupants: Uint8Array;
  /** E6 (GH-274, G1): ticks left on a placed charge against this structure, 0 when none.
   *  Hashed behind `placedLive`. */
  private readonly stChargeTicks: Int32Array;
  /** E6 G1: the carrier that set the charge, -1 when none. Kept as an id because ids are never
   *  reused: the attribution (blast source, ROE side) outlives the carrier. Hashed behind
   *  `placedLive`. */
  private readonly stChargeBy: Int32Array;
  /** E6 G1: true once the first placed charge is SET (not when a type is registered, so a world
   *  that registers the whole roster but never fires one moves no pin). hash() folds the charge
   *  columns only while set (the deferred fold, field works' D1 shape), so no world without a
   *  placed-charge type moves any pin. */
  private placedLive = false;
  // --- field works (#277) state block. Every array is declared and hashed
  // here (Task 2) even where a later task is its only writer; see hash() for
  // why the block folds only once `fwLive` is set (D1).
  /** Owner of each structure, -1 neutral. The placement's `owner`, else the
   *  type's. Hashed (FW block). */
  private readonly stOwner: Int8Array;
  /** Per-side identification latch, `[side * MAX_STRUCTURES + s]`: set the
   *  first tick a unit of `side` has a sight line to a footprint tile of an
   *  OWNED structure of the other side, inside its sight, and never cleared --
   *  buildings do not move, so a latch, not a ladder. Hashed (FW block). */
  private readonly stKnown: Uint8Array;
  /** Construction progress, Q16.16: ONE for every raised (complete) structure,
   *  below ONE only for a field-works site under construction (Task 4).
   *  Hashed (FW block). */
  private readonly stProgress: Int32Array;
  /** The construction-site table (Task 4 writes it). Hashed (FW block). */
  private readonly siteAlive: Uint8Array;
  private readonly siteType: Int16Array;
  private readonly siteX: Int32Array;
  private readonly siteY: Int32Array;
  private readonly siteSide: Int8Array;
  private readonly siteStructure: Int32Array;
  /** Per unit: the site this unit is building, -1 none (Task 4). Hashed. */
  private readonly buildSite: Int8Array;
  /** Per unit aura modifiers, refreshed every AURA_CADENCE_TICKS (Task 6).
   *  Hashed. `auraAccMult` is a Q16.16 multiplier, ONE = no effect. */
  private readonly auraHealRate: Int32Array;
  private readonly auraHealCap: Int32Array;
  private readonly auraCompAt: Int32Array;
  private readonly auraRepairTicks: Int32Array;
  private readonly auraAccMult: Int32Array;
  /** D1: true once anything field works has state (an owned structure, a
   *  structure below full progress, a site). hash() folds the FW block only
   *  while it is set. Never cleared: once live, always folded. Not itself
   *  hashed -- it is a function of what the block holds. */
  private fwLive = false;
  /** E1 (GH-709): set when a unit whose type carries an `aura` is spawned (which also sets
   *  `fwLive`, so the aura columns it writes are hashed). Gates stepAuras' unit pass, so a
   *  world with no aura unit pays nothing for it. Never cleared. Not hashed: it is a
   *  function of the spawned types, and the hp it moves is hashed anyway. */
  private unitAuraLive = false;
  /** Field works (#277 Task 7): per sensor structure, bit `r` set when any tile of route `r`
   *  lies within the type's `tunnel_radius` of the centroid. Geometry only (footprints and
   *  route tiles never change), so it is filled when the structure is raised and when a route
   *  is registered, and the route loop checks completion and owner each tick. Derived from
   *  immutable state; NOT hashed. */
  private readonly stRouteMask: Uint16Array;
  /** Field works: the tick each unit last added construction progress, -1 never. Scratch for
   *  `isConstructing` (the render's `work` clip); never read by the sim, never hashed. */
  private readonly constructedAt: Int32Array;
  /** Field works: `placementReason`'s seal flood. A BFS queue and a per-cell visit stamp
   *  (a cell is visited when it equals `sealGen`), preallocated so the flood allocates
   *  nothing. Scratch, never hashed. */
  private readonly sealQueue: Int32Array;
  private readonly sealStamp: Int32Array;
  private sealGen = 0;
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
  /** Per (side, target) this tick: the observer whose detection probability was highest,
   *  so an `identified` transition can say who saw it. Scratch, rebuilt every tick,
   *  never hashed -- it is a label on an event, not state. -1 = nobody this tick. */
  private readonly bestObserver: Int32Array;
  private readonly bestObserverP: Int32Array;
  /** Field works (#277 Task 7): per (side, target) this tick, the sensor structure that won
   *  `bestObserver` (which is then -1), else -1. Scratch, reset only while `fwLive`, never
   *  hashed -- an event label like `bestObserver`. */
  private readonly bestObserverStructure: Int16Array;
  /** `detectionFrom`'s outputs, so the sensor loop allocates nothing. Scratch, read straight
   *  after the call that wrote them; never hashed, never read across ticks. */
  private detP: Fx = 0;
  private detStrength: Fx = 0;
  private detSig: Fx = 0;
  private detOccl: Fx = ONE;
  private detDistSq: Fx = 0;
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
  /** GH-681: the side that may `enterTunnel` each route, -1 for none (every
   *  map-file route). Load-time, immutable after addTunnel: NOT in hash(). */
  private readonly tnOwner = new Int8Array(MAX_TUNNELS).fill(-1);
  /** GH-681: how many units an `enterTunnel` may put below. Load-time: NOT in hash(). */
  private readonly tnCapacity = new Int32Array(MAX_TUNNELS);
  /** GH-681: ticks from mouth to vent at `TUNNEL_TILES_PER_S`. Load-time: NOT in hash(). */
  private readonly tnTravelTicks = new Int32Array(MAX_TUNNELS);
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
   *  uses it to place the tunnel's signature. Same shape as the smoke grid.
   *  Snapshot STATE, not derived (snapshot-schema.ts): see the note in hash(). */
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
    /** See the private field's own comment: set by `removeFromPlay`, never
     *  by `destroy()`. */
    readonly removed: Uint8Array;
    readonly side: Uint8Array;
    readonly typeIdx: Uint16Array;
    readonly posX: Int32Array;
    readonly posY: Int32Array;
    readonly facing: Int32Array;
    readonly hp: Int32Array;
    readonly suppression: Int32Array;
    readonly suppFromX: Int32Array;
    readonly suppFromY: Int32Array;
    readonly suppFromSet: Uint8Array;
    readonly moving: Uint8Array;
    readonly pinned: Uint8Array;
    readonly mobilityKilled: Uint8Array;
    /** #706: slowed (half step). */
    readonly mobilityDamaged: Uint8Array;
    /** #706: a stuck ground hull's field-fix clock, 0..FIELD_FIX_TICKS. */
    readonly fieldFixTicks: Int32Array;
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
    /** GH-681: ticks until a buried unit reaches its route's vent; 0 there. */
    readonly tunnelEta: Int32Array;
    /** BRACE_* per entity (spec 2026-10-05-infantry-halt-to-fire §5): a unit
     *  that halts to fire is standing (NONE), getting down (DROPPING), down
     *  and firing (KNEELING), or getting up (RISING). Always NONE for every
     *  other unit. */
    readonly brace: Uint8Array;
    /** Ticks left in a DROPPING or RISING transition, 0 otherwise. */
    readonly braceTicks: Int32Array;
    /** The entity this unit was ordered to fire on, -1 when none. */
    readonly focusTarget: Int32Array;
    /** Ticks without a firing solution on the focus. */
    readonly focusLost: Uint16Array;
    /** GH-698: air carrier flight state, AIR_* (tuning.ts). Render and app read this. */
    readonly airState: Uint8Array;
    /** GH-698: ticks left in a land or lift. */
    readonly airTimer: Uint16Array;
    /** GH-698: AIR_WANT_* intent. */
    readonly airWant: Uint8Array;
    /** GH-707: the wound columns (see their declarations). Render, app and tests read them. */
    readonly figuresUp: Uint8Array;
    readonly scars: Uint8Array;
    readonly woundParent: Int32Array;
    readonly woundBy: Int32Array;
    readonly woundState: Uint8Array;
    readonly bleedTicks: Int32Array;
    readonly woundTimer: Int32Array;
    readonly medState: Uint8Array;
    readonly medTarget: Int32Array;
    readonly medTimer: Int32Array;
    readonly speedMul: Int32Array;
    readonly admittedAt: Int32Array;
    /** GH-707: wounded alive per side (0, 1, 2) -- not per unit; indexed by side. */
    readonly woundedAlive: Int32Array;
    /** Field works (#277): the site this unit builds, -1 none. */
    readonly buildSite: Int8Array;
    /** Field works: aura modifiers (Task 6). `auraAccMult` ONE = none. */
    readonly auraHealRate: Int32Array;
    readonly auraHealCap: Int32Array;
    readonly auraCompAt: Int32Array;
    readonly auraRepairTicks: Int32Array;
    readonly auraAccMult: Int32Array;
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
    /** Field works (#277): owner, -1 neutral. */
    readonly owner: Int8Array;
    /** Field works: the per-side identification latch, `[side * 256 + s]`. */
    readonly known: Uint8Array;
    /** Field works: construction progress, ONE when complete. */
    readonly progress: Int32Array;
  };

  /** Read-only view of the field-works construction-site table (#277). */
  readonly works: {
    readonly alive: Uint8Array;
    readonly type: Int16Array;
    readonly x: Int32Array;
    readonly y: Int32Array;
    readonly side: Int8Array;
    readonly structure: Int32Array;
  };

  private readonly seed: number;
  /** What `applyCommands` executes. Typed without the two runtime kinds, so its
   *  branch chain's exhaustive `never` end stays sound without a branch for
   *  them: they cannot reach it (`queueCommand` sets them aside). */
  private commandQueue: Exclude<Command, RuntimeCommand>[] = [];
  /** `build`/`support`, set aside for the MissionRuntime (`takeRuntimeCommands`).
   *  Never executed by the sim, never hashed, and emptied at the start of every
   *  `applyCommands` (R-3). */
  private runtimeQueue: RuntimeCommand[] = [];
  private pendingEvents: SimEvent[] = [];
  private readonly fields: FlowField[] = [];
  /**
   * Cached fields, keyed by (domain, goal tile) — one map per domain rather
   * than a bit stuffed into the tile index, so the key stays readable and the
   * tile index stays a tile index.
   *
   * The pool grows up to MAX_FLOW_FIELDS, then `fieldFor` reuses the
   * least-recently-issued field no living unit still follows rather than
   * growing further; it only exceeds the cap when every field is live, which
   * takes more distinct goals than there are units, or when the only
   * unreferenced fields were issued this tick. Per-domain passability is
   * what could have doubled it. It does not, on any map without boulders:
   * `fieldFor` collapses the domain there, because the two masks are the
   * same array.
   */
  private readonly fieldByGoal: Map<number, number>[] = [new Map(), new Map(), new Map()];
  /** DOMAIN_AIR's field inputs: an all-zero grid, used as both the blocked
   *  mask (nothing blocks flight) and the elevation (a rotor pays no climb).
   *  Allocated once with the map and never written. */
  private readonly openGrid: Uint8Array;
  /** Tick each field was last handed out by `fieldFor`; the eviction key. */
  private readonly fieldLastIssued: number[] = [];
  /** Goal key of each field, so eviction can drop it from `fieldByGoal`. */
  private readonly fieldGoalKey: number[] = [];
  private readonly fieldDomain: number[] = [];
  /** recomputeFields scratch: which fields a living unit follows. Unhashed. */
  private fieldLive = new Uint8Array(0);

  /** 1 = a person holds that side; index 2 (civilians) stays 0. */
  private readonly humanHeldBySide = new Uint8Array(3);

  constructor(config: SimConfig) {
    const held = config.humanHeld ?? [true, false];
    if (held.length !== 2 || typeof held[0] !== 'boolean' || typeof held[1] !== 'boolean') {
      throw new Error('Sim: humanHeld must be two booleans, one per combatant side');
    }
    this.humanHeldBySide[0] = held[0] ? 1 : 0;
    this.humanHeldBySide[1] = held[1] ? 1 : 0;
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
    this.openGrid = new Uint8Array(tiles);
    this.smoke = new Uint8Array(tiles);
    this.trail = new Uint8Array(tiles);
    this.alive = new Uint8Array(n);
    this.removed = new Uint8Array(n);
    this.side = new Uint8Array(n);
    this.typeIdx = new Uint16Array(n);
    this.posX = new Int32Array(n);
    this.posY = new Int32Array(n);
    this.facing = new Int32Array(n);
    this.hp = new Int32Array(n);
    this.suppression = new Int32Array(n);
    this.suppFromX = new Int32Array(n);
    this.suppFromY = new Int32Array(n);
    this.suppFromSet = new Uint8Array(n);
    this.moving = new Uint8Array(n);
    this.attackMove = new Uint8Array(n);
    this.sweepOrder = new Uint8Array(n);
    this.goalX = new Int32Array(n);
    this.goalY = new Int32Array(n);
    this.fieldRef = new Int32Array(n).fill(-1);
    this.cooldown = new Int32Array(n * 2);
    this.beamTgt = new Int32Array(n * 2).fill(-1);
    this.beamDwell = new Int32Array(n * 2);
    this.beamHeat = new Int32Array(n * 2);
    this.beamAt = new Int32Array(n * 2).fill(-1);
    this.beamLock = new Int32Array(n * 2);
    this.lastFired = new Int32Array(n).fill(-100000);
    this.engaging = new Uint8Array(n);
    this.curTarget = new Int32Array(n).fill(-1);
    this.focusTarget = new Int32Array(n).fill(-1);
    this.focusLost = new Uint16Array(n);
    this.airState = new Uint8Array(n);
    this.airTimer = new Uint16Array(n);
    this.airWant = new Uint8Array(n);
    this.figuresUp = new Uint8Array(n);
    this.scars = new Uint8Array(n);
    this.woundParent = new Int32Array(n).fill(-1);
    this.woundBy = new Int32Array(n).fill(-1);
    this.woundState = new Uint8Array(n);
    this.bleedTicks = new Int32Array(n);
    this.woundTimer = new Int32Array(n);
    this.medState = new Uint8Array(n);
    this.medTarget = new Int32Array(n).fill(-1);
    this.medTimer = new Int32Array(n);
    this.speedMul = new Int32Array(n).fill(ONE);
    this.admittedAt = new Int32Array(n).fill(-1);
    this.curStructure = new Int32Array(n).fill(-1);
    this.mobilityKilled = new Uint8Array(n);
    this.mobilityDamaged = new Uint8Array(n);
    this.fieldFixTicks = new Int32Array(n);
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
    this.brace = new Uint8Array(n);
    this.braceTicks = new Int32Array(n);
    this.braceWant = new Uint8Array(n);
    this.braceClock = new Int32Array(n);
    this.demoTicks = new Int32Array(n);
    this.demoTarget = new Int32Array(n).fill(-1);
    this.demolishOrder = new Int32Array(n).fill(-1);
    this.chargeOrder = new Int32Array(n).fill(-1);
    this.chargeTicks = new Int32Array(n);
    this.smokeCooldown = new Int32Array(n);
    this.wpX = new Int32Array(n * MAX_WAYPOINTS);
    this.wpY = new Int32Array(n * MAX_WAYPOINTS);
    this.wpAttack = new Uint8Array(n * MAX_WAYPOINTS);
    this.wpSweep = new Uint8Array(n * MAX_WAYPOINTS);
    this.wpCount = new Uint8Array(n);
    this.carriedBy = new Int32Array(n).fill(-1);
    this.boardGoal = new Int32Array(n).fill(-1);
    this.passengers = new Uint8Array(n);
    this.tunnelIn = new Int32Array(n).fill(-1);
    this.surfaceTicks = new Int32Array(n);
    this.volleyLeft = new Int32Array(n);
    this.homeTunnel = new Int32Array(n).fill(-1);
    this.tunnelGoal = new Int32Array(n).fill(-1);
    this.tunnelEta = new Int32Array(n);
    this.patrolX = new Int32Array(n * MAX_PATROL_WAYPOINTS);
    this.patrolY = new Int32Array(n * MAX_PATROL_WAYPOINTS);
    this.patrolCount = new Uint8Array(n);
    this.patrolIdx = new Uint8Array(n);
    const sc = MAX_STRUCTURES;
    this.stAlive = new Uint8Array(sc);
    this.stHp = new Int32Array(sc);
    this.stMaxHp = new Int32Array(sc);
    this.stTypeIdx = new Uint16Array(sc);
    this.stProducesFor = new Int8Array(sc).fill(-1);
    this.stOccupants = new Uint8Array(sc);
    this.stChargeTicks = new Int32Array(sc);
    this.stChargeBy = new Int32Array(sc).fill(-1);
    this.stOwner = new Int8Array(sc).fill(-1);
    this.stKnown = new Uint8Array(2 * sc);
    this.stProgress = new Int32Array(sc);
    this.stRouteMask = new Uint16Array(sc);
    this.siteAlive = new Uint8Array(MAX_SITES);
    this.siteType = new Int16Array(MAX_SITES);
    this.siteX = new Int32Array(MAX_SITES);
    this.siteY = new Int32Array(MAX_SITES);
    this.siteSide = new Int8Array(MAX_SITES);
    this.siteStructure = new Int32Array(MAX_SITES).fill(-1);
    this.buildSite = new Int8Array(n).fill(-1);
    this.auraHealRate = new Int32Array(n);
    this.auraHealCap = new Int32Array(n);
    this.auraCompAt = new Int32Array(n);
    this.auraRepairTicks = new Int32Array(n);
    this.auraAccMult = new Int32Array(n).fill(ONE);
    this.constructedAt = new Int32Array(n).fill(-1);
    this.sealQueue = new Int32Array(tiles);
    this.sealStamp = new Int32Array(tiles);
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
    this.bestObserver = new Int32Array(2 * n);
    this.bestObserverP = new Int32Array(2 * n);
    this.bestObserverStructure = new Int16Array(2 * n).fill(-1);
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
      removed: this.removed,
      side: this.side,
      typeIdx: this.typeIdx,
      posX: this.posX,
      posY: this.posY,
      facing: this.facing,
      hp: this.hp,
      suppression: this.suppression,
      suppFromX: this.suppFromX,
      suppFromY: this.suppFromY,
      suppFromSet: this.suppFromSet,
      moving: this.moving,
      pinned: this.pinned,
      mobilityKilled: this.mobilityKilled,
      mobilityDamaged: this.mobilityDamaged,
      fieldFixTicks: this.fieldFixTicks,
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
      tunnelEta: this.tunnelEta,
      brace: this.brace,
      braceTicks: this.braceTicks,
      focusTarget: this.focusTarget,
      focusLost: this.focusLost,
      airState: this.airState,
      airTimer: this.airTimer,
      airWant: this.airWant,
      figuresUp: this.figuresUp,
      scars: this.scars,
      woundParent: this.woundParent,
      woundBy: this.woundBy,
      woundState: this.woundState,
      bleedTicks: this.bleedTicks,
      woundTimer: this.woundTimer,
      medState: this.medState,
      medTarget: this.medTarget,
      medTimer: this.medTimer,
      speedMul: this.speedMul,
      admittedAt: this.admittedAt,
      woundedAlive: this.woundedAlive,
      buildSite: this.buildSite,
      auraHealRate: this.auraHealRate,
      auraHealCap: this.auraHealCap,
      auraCompAt: this.auraCompAt,
      auraRepairTicks: this.auraRepairTicks,
      auraAccMult: this.auraAccMult,
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
      owner: this.stOwner,
      known: this.stKnown,
      progress: this.stProgress,
    };
    this.works = {
      alive: this.siteAlive,
      type: this.siteType,
      x: this.siteX,
      y: this.siteY,
      side: this.siteSide,
      structure: this.siteStructure,
    };
  }

  get entityCount(): number {
    return this.count;
  }

  addUnitType(json: UnitTypeJson): number {
    const type = unitTypeFromJson(json);
    // GH-698, Q-A: the first air carrier type turns the air block's hash fold on.
    if (type.isAirCarrier) this.airLive = true;
    // GH-707: the first wound-related type turns the wound block's hash fold on.
    if (type.wounds !== null || type.rescue !== null || type.canCarry !== null || type.isWounded) {
      this.woundLive = true;
    }
    this.unitTypes.push(type);
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

  /** How many flow fields have been allocated. Diagnostic: the pool grows up
   *  to MAX_FLOW_FIELDS and then reuses the least-recently-issued field no
   *  living unit follows, so this stays at or below the cap unless every
   *  field in the pool is currently live, or the only unreferenced fields
   *  were issued this tick. Per-domain passability is the other thing that
   *  could double it. */
  get flowFieldCount(): number {
    return this.fields.length;
  }

  /** Re-derive one tile of the vehicle mask after `blocked` moved under it.
   *  A no-op while the mask is still an alias, which is the common case. */
  private syncVehicleTile(t: number): void {
    if (this.hasBoulders) this.blockedVehicleMask[t] = this.blocked[t] | this.boulder[t];
  }

  /** Terrain changed (building raised, removed or levelled): every cached flow
   *  field is stale. Flow fields are shared per destination, so this is cheap
   *  compared to the per-unit repathing it replaces.
   *
   *  LAZY (#277 Task 3). With the pool full on a 48x48 map this loop was
   *  measured at 24 ms a call (`pnpm perf:recompute`, docs/PERFORMANCE.md),
   *  against a 50 ms tick, and a stake or a cancel pays it. So only the fields
   *  a LIVING unit still follows are recomputed now. The rest are dropped from
   *  `fieldByGoal`, so the next `fieldFor` for that goal computes a fresh one,
   *  and their slots stay in the pool, unreferenced, for eviction to reuse. Nothing reads a
   *  field through any path but `fieldRef` or `fieldFor`, so a dropped field is
   *  unobservable: the same bytes a full recompute would have left, computed
   *  later or never. */
  private recomputeFields(): void {
    const n = this.fields.length;
    if (n === 0) return;
    if (this.fieldLive.length < n) this.fieldLive = new Uint8Array(n);
    const live = this.fieldLive;
    live.fill(0, 0, n);
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const f = this.fieldRef[i];
      if (f >= 0) live[f] = 1;
    }
    for (let d = 0; d < DOMAIN_COUNT; d++) {
      const mask = this.pathMaskFor(d);
      const elev = d === DOMAIN_AIR ? this.openGrid : this.elevation;
      const byGoal = this.fieldByGoal[d];
      for (const [goal, idx] of byGoal) {
        if (live[idx] === 1) {
          // An air field reads nothing terrain can change; it stays as it is.
          if (d === DOMAIN_AIR) continue;
          const gx = goal % this.width;
          this.fields[idx].compute(mask, elev, gx, (goal - gx) / this.width);
        } else {
          // Deleting the entry being visited is defined for a Map.
          byGoal.delete(goal);
          this.fieldGoalKey[idx] = -1;
        }
      }
    }
  }

  /** The mask a unit of this domain STANDS on: what goals, slots and spreads
   *  are snapped against. DOMAIN_AIR stands on the foot mask -- an aircraft
   *  hovers over, and lands on, ground a rifleman could walk to. */
  private maskFor(domain: number): Uint8Array {
    return domain === DOMAIN_VEHICLE ? this.blockedVehicleMask : this.blocked;
  }

  /** The mask a domain's flow fields are computed on: `maskFor`, except that
   *  DOMAIN_AIR flies over everything. */
  private pathMaskFor(domain: number): Uint8Array {
    return domain === DOMAIN_AIR ? this.openGrid : this.maskFor(domain);
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
    const type = structureTypeFromJson(json, TICKS_PER_SECOND);
    // GH-707: an aid post turns the wound block's hash fold on when one is placed or staked
    // (`addStructure`), not here: every world registers the whole structure catalogue (`standMapStructures`), so
    // a registration trigger would fold the block into every versus world (a mission registers the
    // wounded types and folds from tick 0 anyway).
    this.structureTypes.push(type);
    return this.structureTypes.length - 1;
  }

  /** Raise a building over `tiles` (tile indices). Blocks until it falls.
   *  `opts.owner` overrides the type's owner (-1 neutral, 0, 1); `opts.progress`
   *  is construction progress, ONE (complete) by default. Either one that
   *  makes the structure field-works state (an owner, or progress below ONE)
   *  sets `fwLive` (D1, see hash()). */
  addStructure(typeIdx: number, tiles: readonly number[], opts?: { owner?: number; progress?: Fx }): number {
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
    this.stProducesFor[id] = type.producesFor;
    const owner = opts?.owner ?? type.owner;
    if (owner !== -1 && owner !== 0 && owner !== 1) throw new Error(`structure owner ${owner}, expected -1, 0 or 1`);
    const progress = opts?.progress ?? ONE;
    this.stOwner[id] = owner;
    this.stProgress[id] = progress;
    if (owner !== -1 || progress !== ONE) this.fwLive = true;
    if (type.aid !== null) {
      this.aidPosts++;
      this.woundLive = true;
    }
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
    const sensor = type.aura === null ? null : type.aura.sensor;
    if (sensor !== null && sensor.tunnelRadiusSq > 0) {
      let mask = 0;
      for (let r = 0; r < this.tunnelCount_; r++) {
        if (this.routeWithin(id, r, sensor.tunnelRadiusSq)) mask |= 1 << r;
      }
      this.stRouteMask[id] = mask;
    }
    this.recomputeFields();
    return id;
  }

  /** Field works: does any tile of route `r` lie within `radiusSq` of structure `s`'s
   *  centroid (tile centres, as route spotting measures)? No LOS: a sensor, not an eye.
   *  Load-time only (addStructure, addTunnel). */
  private routeWithin(s: number, r: number, radiusSq: Fx): boolean {
    const w = this.width;
    for (const t of this.tnTiles[r]) {
      const tx = t % w;
      const ty = (t - tx) / w;
      const dSq = distSqFx(fx.sub(fx.add(fx.fromInt(tx), HALF), this.stCx[s]), fx.sub(fx.add(fx.fromInt(ty), HALF), this.stCy[s]));
      if (dSq <= radiusSq) return true;
    }
    return false;
  }

  /**
   * Take a structure away as if it had never been raised (a cancelled stake,
   * #277 Task 3). Unlike `destroyStructure` it leaves no rubble (`cover` is
   * untouched), throws no collapse shock, pushes no `structureDestroyed`
   * event and kills no garrison: nobody can be inside an unfinished building,
   * so it throws if `stOccupants[s] > 0` rather than killing anyone.
   *
   * Writes only what hash() already folds (`stAlive`, `stHp`, `blocked`), so it
   * adds no unhashed state. `stProgress` and `stOwner` are left as written: a
   * dead row is skipped by every reader, and the hash keeps the row's history.
   * A unit still heading for it as a garrison goal is released, as in collapse.
   * One `recomputeFields`, after every tile is open.
   */
  removeStructure(s: number): void {
    if (s < 0 || s >= this.structureCount_) throw new Error(`no structure ${s}`);
    if (this.stAlive[s] === 0) return;
    if (this.stOccupants[s] > 0) throw new Error(`structure ${s} has occupants`);
    this.stAlive[s] = 0;
    this.stHp[s] = 0;
    this.stChargeTicks[s] = 0; // a cancelled site takes any charge on it along (E6 G1)
    this.stChargeBy[s] = -1;
    for (const t of this.stTiles[s]) {
      this.blocked[t] = 0;
      // A boulder under the same tile does not stop being a boulder.
      this.syncVehicleTile(t);
      this.structureOfTile[t] = -1;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.garrisonGoal[i] === s) this.garrisonGoal[i] = -1;
    }
    this.recomputeFields();
  }

  /**
   * Override which side structure `s` produces for (a mission placement's `side`, F4 Task 7).
   * Setup-only: written when the mission raises its structures, before the first tick, and
   * left out of hash(); Task 6's economyHash folds every line's side, so a client built with
   * a different override diverges there.
   */
  setStructureProducesFor(s: number, side: 0 | 1): void {
    if (s < 0 || s >= this.structureCount_) throw new Error(`no structure ${s}`);
    if (this.tickCount > 0) throw new Error('setStructureProducesFor is setup-only (before the first tick)');
    this.stProducesFor[s] = side;
  }

  /** The side structure `s` produces for: the placement's override, else its type's `producesFor` (-1 = none). */
  structureProducesFor(s: number): number {
    return this.stProducesFor[s];
  }

  /**
   * Field works (#277): set who owns structure `s` (-1 neutral, 0, 1). Setup-only, like
   * `setStructureProducesFor`. Unlike that column, the owner IS hashed (FW block): it decides
   * what the other side may shoot. An owner other than -1 sets `fwLive` (D1).
   */
  setStructureOwner(s: number, owner: number): void {
    if (s < 0 || s >= this.structureCount_) throw new Error(`no structure ${s}`);
    if (this.tickCount > 0) throw new Error('setStructureOwner is setup-only (before the first tick)');
    if (owner !== -1 && owner !== 0 && owner !== 1) throw new Error(`structure owner ${owner}, expected -1, 0 or 1`);
    this.stOwner[s] = owner;
    if (owner !== -1) this.fwLive = true;
  }

  /** Field works: true once `side` has seen owned structure `s` (the latch). */
  structureKnownTo(side: number, s: number): boolean {
    return this.stKnown[side * MAX_STRUCTURES + s] === 1;
  }

  /** GH-698: true once an air carrier type is registered, or (#706) an aircraft has
   *  been mobility-killed, and the air block is folded into hash() (Q-A). Read-only. */
  get airCarrierLive(): boolean {
    return this.airLive;
  }

  /**
   * GH-698, Q-C (lead 21 Oct): is unit `t` an AIR target right now? An air type is,
   * except while LANDING or LANDED -- a carrier settling onto an LZ is a ground target.
   * LIFTING stays air. A ground type never is, whatever its (unused) air column holds.
   * The one place the rule lives; the five targeting readers (engageable, stepKamikaze, focusInReach, focusHurts, couldEngage) ask it.
   */
  isAirborne(t: number): boolean {
    if (!this.unitTypes[this.typeIdx[t]].isAir) return false;
    const s = this.airState[t];
    return s !== AIR_LANDING && s !== AIR_LANDED;
  }

  /** GH-707: true once a wound-related unit or structure type is registered and the wound
   *  block is folded into hash(). Read-only. */
  get woundsLive(): boolean {
    return this.woundLive;
  }

  /** GH-707: is `id` a man down -- a `wounded`-role body, or a unit downed in place (the
   *  civilians)? Always false in a world with no wound content (`woundLive`), so a caller's
   *  skip costs that world nothing. The lead's rules of 22 Oct read it: a man down holds and
   *  contests no ground, and spotting him is not a new identification. Read-only. */
  isDown(id: number): boolean {
    return this.woundLive && this.horsDeCombat(id);
  }

  /** Field works: true once the FW state block is folded into hash() (D1). Read-only. */
  get fieldWorksLive(): boolean {
    return this.fwLive;
  }

  // ------------------------------------------------------------- field works
  // Construction (#277 Task 4, spec §1). A `construct` command writes a site
  // row; the first builder to arrive STAKES it (Q4: the footprint blocks only
  // then, as a structure at progress 0); up to MAX_BUILDERS builders, lowest id
  // first, add progress each tick; at ONE it is complete and the row is free.
  // No random numbers anywhere in it: every choice goes by lowest id or by a
  // fixed scan order (invariant 3).

  /**
   * Why a `structType` footprint with its top-left tile at (tx, ty) cannot be
   * raised, or null when it can. Pure: it writes nothing but its own scratch.
   * The first failing rule, in the spec's order:
   * 1. inside the map ('off_map'); no tile blocked -- building, ridge, wall
   *    ('blocked'); no tile a boulder field or ditch ('no_footing');
   * 2. every tile on one elevation level ('not_level', Q6);
   * 3. no tile under a live structure or a PENDING site ('overlap');
   * 4. no seal: the footprint must not split the open ground ('seals_passage', Q5).
   * Roads, groves and knolls are open ground and allowed; a tunnel is not a
   * rule (refusing over an unidentified route would leak it). `side` is in the
   * signature for the runtime and the app; no rule reads it, because a site
   * blocks the ground for everyone whoever owns it.
   */
  placementReason(structType: number, tx: number, ty: number, side: number): PlacementRefusal | null {
    void side;
    const type = this.structureTypes[structType];
    if (type === undefined || type.buildable === null) throw new Error(`structure type ${structType} is not buildable`);
    const b = type.buildable;
    const w = this.width;
    if (tx < 0 || ty < 0 || tx + b.fw > w || ty + b.fh > this.height) return 'off_map';
    for (let y = ty; y < ty + b.fh; y++) {
      for (let x = tx; x < tx + b.fw; x++) if (this.blocked[y * w + x] !== 0) return 'blocked';
    }
    for (let y = ty; y < ty + b.fh; y++) {
      for (let x = tx; x < tx + b.fw; x++) if (this.boulder[y * w + x] !== 0) return 'no_footing';
    }
    const level = this.elevation[ty * w + tx];
    for (let y = ty; y < ty + b.fh; y++) {
      for (let x = tx; x < tx + b.fw; x++) if (this.elevation[y * w + x] !== level) return 'not_level';
    }
    for (let y = ty; y < ty + b.fh; y++) {
      for (let x = tx; x < tx + b.fw; x++) {
        const s = this.structureOfTile[y * w + x];
        if (s >= 0 && this.stAlive[s] === 1) return 'overlap';
        if (this.pendingSiteAt(x, y) >= 0) return 'overlap';
      }
    }
    if (this.footprintSeals(tx, ty, b.fw, b.fh)) return 'seals_passage';
    return null;
  }

  /** True when `id` added construction progress on the last tick: the
   *  render's `work` clip. A read of unhashed scratch (invariant 4). */
  isConstructing(id: number): boolean {
    const t = this.constructedAt[id];
    return t >= 0 && t === this.tickCount - 1;
  }

  /** The live, NOT yet staked site whose footprint holds tile (x, y), or -1.
   *  A staked site is a structure, already in `blocked` and `structureOfTile`. */
  private pendingSiteAt(x: number, y: number): number {
    for (let k = 0; k < MAX_SITES; k++) {
      if (this.siteAlive[k] === 0 || this.siteStructure[k] >= 0) continue;
      const b = this.structureTypes[this.siteType[k]].buildable;
      if (b === null) continue;
      const sx = this.siteX[k];
      const sy = this.siteY[k];
      if (x >= sx && x < sx + b.fw && y >= sy && y < sy + b.fh) return k;
    }
    return -1;
  }

  /**
   * Rule 4, the seal (Q5). The foot mask's open ground, with every pending
   * site counted as blocked, and the candidate footprint added: flood from one
   * open 4-neighbour of the footprint and refuse if any other open 4-neighbour
   * goes unreached. That is the plan's two-labelling test in one flood: the
   * footprint is open ground and 4-connected in itself, so before it is added
   * every open 4-neighbour of it is in ONE component, and the footprint splits
   * that component exactly when the flood cannot reach them all around it.
   * Allocates nothing: `sealQueue` and the generation-stamped `sealStamp` are
   * preallocated scratch, never hashed.
   */
  private footprintSeals(tx: number, ty: number, fw: number, fh: number): boolean {
    const w = this.width;
    const h = this.height;
    if (this.sealGen >= 0x7fffffff) {
      this.sealStamp.fill(0);
      this.sealGen = 0;
    }
    const gen = ++this.sealGen;
    const stamp = this.sealStamp;
    const queue = this.sealQueue;
    // Count the open 4-neighbours (no corners: a footprint cannot be passed
    // diagonally through its corner on a 4-connected flood).
    let need = 0;
    let start = -1;
    for (let y = ty - 1; y <= ty + fh; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = tx - 1; x <= tx + fw; x++) {
        if (x < 0 || x >= w) continue;
        if (!this.isFootprintNeighbour(x, y, tx, ty, fw, fh)) continue;
        if (!this.sealOpen(x, y, tx, ty, fw, fh)) continue;
        need++;
        if (start < 0) start = y * w + x;
      }
    }
    if (need <= 1) return false;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    stamp[start] = gen;
    let reached = 0;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % w;
      const cy = (c - cx) / w;
      if (this.isFootprintNeighbour(cx, cy, tx, ty, fw, fh)) {
        reached++;
        if (reached === need) return false;
      }
      for (let dir = 0; dir < 4; dir++) {
        const nx = dir === 0 ? cx + 1 : dir === 1 ? cx - 1 : cx;
        const ny = dir === 2 ? cy + 1 : dir === 3 ? cy - 1 : cy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nc = ny * w + nx;
        if (stamp[nc] === gen) continue;
        if (!this.sealOpen(nx, ny, tx, ty, fw, fh)) continue;
        stamp[nc] = gen;
        queue[tail++] = nc;
      }
    }
    return true;
  }

  /** Tile (x, y) shares an edge with the footprint and is not in it. */
  private isFootprintNeighbour(x: number, y: number, tx: number, ty: number, fw: number, fh: number): boolean {
    const inX = x >= tx && x < tx + fw;
    const inY = y >= ty && y < ty + fh;
    return (inX && (y === ty - 1 || y === ty + fh)) || (inY && (x === tx - 1 || x === tx + fw));
  }

  /** Open for the seal flood: foot-passable, not in the candidate footprint,
   *  not under a pending site. */
  private sealOpen(x: number, y: number, tx: number, ty: number, fw: number, fh: number): boolean {
    if (this.blocked[y * this.width + x] !== 0) return false;
    if (x >= tx && x < tx + fw && y >= ty && y < ty + fh) return false;
    return this.pendingSiteAt(x, y) < 0;
  }

  /** A `construct` command (see the Command doc). */
  private applyConstruct(ids: readonly number[], structType: number, x: number, y: number): void {
    const type = this.structureTypes[structType];
    // A malformed command (no such type, or one that cannot be built) is not
    // a placement refusal and has nothing to refund: the runtime never sends it.
    if (type === undefined || type.buildable === null) return;
    // The site is the side of the LOWEST qualifying id; ids of another side
    // are ignored (an order is single-side by construction anyway).
    let lead = -1;
    for (const id of ids) {
      if (!this.canTakeConstruct(id)) continue;
      if (lead < 0 || id < lead) lead = id;
    }
    if (lead < 0) {
      this.pendingEvents.push({ kind: 'constructRefused', tick: this.tickCount, structType, x, y, reason: 'no_builder' });
      return;
    }
    const side = this.side[lead];
    // The same type at the same origin for the same side is that site: join it.
    let site = -1;
    let joined = true;
    for (let k = 0; k < MAX_SITES; k++) {
      if (this.siteAlive[k] === 1 && this.siteType[k] === structType && this.siteX[k] === x && this.siteY[k] === y && this.siteSide[k] === side) {
        site = k;
        break;
      }
    }
    if (site < 0) {
      joined = false;
      const reason = this.placementReason(structType, x, y, side);
      if (reason !== null) {
        this.pendingEvents.push({ kind: 'constructRefused', tick: this.tickCount, structType, x, y, reason });
        return;
      }
      for (let k = 0; k < MAX_SITES; k++) {
        if (this.siteAlive[k] === 0) {
          site = k;
          break;
        }
      }
      if (site < 0) {
        this.pendingEvents.push({ kind: 'constructRefused', tick: this.tickCount, structType, x, y, reason: 'no_site_slot' });
        return;
      }
      this.siteAlive[site] = 1;
      this.siteType[site] = structType;
      this.siteX[site] = x;
      this.siteY[site] = y;
      this.siteSide[site] = side;
      this.siteStructure[site] = -1;
      // D1: the site table holds state now, so the FW block folds from here on.
      this.fwLive = true;
    }
    this.pendingEvents.push({ kind: 'constructQueued', tick: this.tickCount, site, structType, x, y, builder: lead, joined });
    for (const id of ids) {
      if (this.side[id] === side && this.canTakeConstruct(id)) this.assignBuilder(id, site);
    }
  }

  /** A unit that can be handed a `construct` order: alive, listening, a
   *  `construct` unit of a combatant side, not riding (buried ids never get
   *  here: applyCommands' containment filter). */
  private canTakeConstruct(id: number): boolean {
    if (id < 0 || id >= this.count) return false;
    if (this.alive[id] === 0 || this.routed[id] === 1 || this.carriedBy[id] >= 0) return false;
    if (this.side[id] > 1) return false;
    return this.unitTypes[this.typeIdx[id]].canConstruct;
  }

  /** Put `id` on `site` and walk it to the nearest open tile 4-adjacent to the
   *  footprint. What every order clears, as `demolish` does. */
  private assignBuilder(id: number, site: number): void {
    if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
    this.buildSite[id] = site;
    this.wpCount[id] = 0;
    this.boardGoal[id] = -1;
    this.garrisonGoal[id] = -1;
    this.demolishOrder[id] = -1;
    this.chargeOrder[id] = -1;
    this.chargeTicks[id] = 0;
    const d = this.domainOf(id);
    this.siteApproachTile(site, id, this.maskFor(d));
    const ax = this.snapX;
    const ay = this.snapY;
    this.goalX[id] = fx.add(fx.fromInt(ax), HALF);
    this.goalY[id] = fx.add(fx.fromInt(ay), HALF);
    this.fieldRef[id] = this.fieldFor(ax, ay, d);
    this.moving[id] = 1;
    this.attackMove[id] = 0;
    this.sweepOrder[id] = 0;
    this.engaging[id] = 0;
    this.stance[id] = 0;
  }

  /** Into `snapX`/`snapY`: the open (in `mask`) tile sharing an edge with the
   *  site's footprint nearest to `id`, ties by row-major scan order; failing
   *  that, the nearest open tile to the footprint's origin. */
  private siteApproachTile(site: number, id: number, mask: Uint8Array): void {
    const b = this.structureTypes[this.siteType[site]].buildable;
    const tx = this.siteX[site];
    const ty = this.siteY[site];
    if (b === null) {
      this.snapOpenTile(tx, ty, mask);
      return;
    }
    const w = this.width;
    let best = -1;
    let bestD = 0;
    for (let y = ty - 1; y <= ty + b.fh; y++) {
      if (y < 0 || y >= this.height) continue;
      for (let x = tx - 1; x <= tx + b.fw; x++) {
        if (x < 0 || x >= w) continue;
        if (!this.isFootprintNeighbour(x, y, tx, ty, b.fw, b.fh)) continue;
        if (mask[y * w + x] !== 0) continue;
        const d = distSqFx(fx.sub(fx.add(fx.fromInt(x), HALF), this.posX[id]), fx.sub(fx.add(fx.fromInt(y), HALF), this.posY[id]));
        if (best < 0 || d < bestD) {
          best = y * w + x;
          bestD = d;
        }
      }
    }
    if (best < 0) {
      this.snapOpenTile(tx, ty, mask);
      return;
    }
    this.snapX = best % w;
    this.snapY = (best - this.snapX) / w;
  }

  /** A `cancelConstruct` command. */
  private applyCancelConstruct(site: number): void {
    if (site < 0 || site >= MAX_SITES || this.siteAlive[site] === 0) return;
    const s = this.siteStructure[site];
    if (s < 0) {
      this.freeSite(site);
      this.pendingEvents.push({ kind: 'constructCancelled', tick: this.tickCount, site, structure: -1, progress: 0 });
      return;
    }
    // Fell this tick before stepConstruction freed it: a wreck, not a cancel.
    if (this.stAlive[s] === 0) {
      this.freeSite(site);
      return;
    }
    // Complete: no longer a site (completion frees the row, so this is a guard).
    if (this.stProgress[s] >= ONE) return;
    const progress = this.stProgress[s];
    this.removeStructure(s);
    this.freeSite(site);
    this.pendingEvents.push({ kind: 'constructCancelled', tick: this.tickCount, site, structure: s, progress });
  }

  /** Free a site row and take every builder off it, so a later site in the
   *  same row inherits nobody. */
  private freeSite(site: number): void {
    this.siteAlive[site] = 0;
    this.siteStructure[site] = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.buildSite[i] === site) this.buildSite[i] = -1;
    }
  }

  /** Squared distance, Q16.16 tiles, from a point to the nearest footprint
   *  tile centre of a site (staked or not). */
  private siteDistSq(site: number, fw: number, fh: number, px: Fx, py: Fx): Fx {
    let best = 0x7fffffff;
    const tx = this.siteX[site];
    const ty = this.siteY[site];
    for (let y = ty; y < ty + fh; y++) {
      for (let x = tx; x < tx + fw; x++) {
        const d = distSqFx(fx.sub(fx.add(fx.fromInt(x), HALF), px), fx.sub(fx.add(fx.fromInt(y), HALF), py));
        if (d < best) best = d;
      }
    }
    return best;
  }

  /** On the surface: not inside a building, a vehicle or the ground. */
  private onSurface(i: number): boolean {
    return this.garrisonedIn[i] < 0 && this.carriedBy[i] < 0 && this.tunnelIn[i] < 0;
  }

  /** A living surface ground unit standing on the site's footprint. */
  private onPad(i: number, site: number, fw: number, fh: number): boolean {
    if (this.alive[i] === 0 || !this.onSurface(i)) return false;
    if (this.unitTypes[this.typeIdx[i]].isAir) return false; // flies over it
    const x = this.posX[i] >> 16;
    const y = this.posY[i] >> 16;
    const sx = this.siteX[site];
    const sy = this.siteY[site];
    return x >= sx && x < sx + fw && y >= sy && y < sy + fh;
  }

  /**
   * Stake `site` if its first builder has arrived: a builder on it, alive, on
   * the surface and within BUILD_RANGE_SQ of a footprint tile centre (moving
   * or not). It waits while any enemy or civilian stands on the footprint;
   * every friendly there, builders included, is put out beside it, on ground
   * its own domain can stand on, once it stands. Returns the structure, or -1 not staked yet.
   */
  private tryStake(site: number, fw: number, fh: number): number {
    let arrived = false;
    for (let i = 0; i < this.count && !arrived; i++) {
      if (this.buildSite[i] !== site || this.alive[i] === 0 || !this.onSurface(i)) continue;
      if (this.siteDistSq(site, fw, fh, this.posX[i], this.posY[i]) <= BUILD_RANGE_SQ) arrived = true;
    }
    if (!arrived) return -1;
    const side = this.siteSide[site];
    for (let i = 0; i < this.count; i++) {
      if (this.onPad(i, site, fw, fh) && this.side[i] !== side) return -1;
    }
    // An event, not a tick: the footprint list is allocated once per stake.
    const tiles: number[] = [];
    const w = this.width;
    for (let y = this.siteY[site]; y < this.siteY[site] + fh; y++) {
      for (let x = this.siteX[site]; x < this.siteX[site] + fw; x++) tiles.push(y * w + x);
    }
    // Friendlies on the pad are put out AFTER addStructure, so the footprint
    // is already blocked in the masks they are placed against.
    const s = this.addStructure(this.siteType[site], tiles, { owner: side, progress: 0 });
    this.stHp[s] = fx.mul(this.stMaxHp[s], STAKE_HP_FRAC);
    this.siteStructure[site] = s;
    // Each in ITS OWN domain's mask: exitTile reads the foot mask alone, and
    // would put a vehicle down on a boulder or ditch tile it can never leave.
    // The approach rule (nearest open edge tile, else the nearest open tile)
    // and never back inside the footprint: an enclosed pocket passes the seal
    // check, and a unit there must still come out.
    for (let i = 0; i < this.count; i++) {
      if (!this.onPad(i, site, fw, fh)) continue;
      const mask = this.maskFor(this.domainOf(i));
      this.siteApproachTile(site, i, mask);
      if (mask[this.snapY * w + this.snapX] !== 0) continue; // no open tile on the whole map
      this.posX[i] = fx.add(fx.fromInt(this.snapX), HALF);
      this.posY[i] = fx.add(fx.fromInt(this.snapY), HALF);
    }
    this.pendingEvents.push({ kind: 'constructStaked', tick: this.tickCount, site, structure: s });
    return s;
  }

  /**
   * Field works, once per tick, last (after stepTunnelCharge). For each live
   * site: free it if its structure fell (a wreck: destroyStructure has already
   * done the rubble, the shock and the event); stake it if unstaked; then up to
   * MAX_BUILDERS of its builders, lowest id first -- alive, on the surface, in
   * range, not moving, not pinned -- each add `buildStep x constructRate`. HP
   * rises by `maxHp x BUILD_HP_FRAC x` the progress added, capped at max. At
   * ONE: clamp, `structureComplete`, free the row. A world with no field works
   * returns at once (and allocates nothing either way).
   */
  private stepConstruction(): void {
    if (!this.fwLive) return;
    for (let k = 0; k < MAX_SITES; k++) {
      if (this.siteAlive[k] === 0) continue;
      let s = this.siteStructure[k];
      if (s >= 0 && this.stAlive[s] === 0) {
        this.freeSite(k);
        continue;
      }
      const b = this.structureTypes[this.siteType[k]].buildable;
      if (b === null) continue;
      if (s < 0) {
        s = this.tryStake(k, b.fw, b.fh);
        if (s < 0) continue;
      }
      let delta = 0;
      let builders = 0;
      for (let i = 0; i < this.count && builders < MAX_BUILDERS; i++) {
        if (this.buildSite[i] !== k || this.alive[i] === 0) continue;
        if (this.moving[i] === 1 || this.pinned[i] === 1 || !this.onSurface(i)) continue;
        if (this.siteDistSq(k, b.fw, b.fh, this.posX[i], this.posY[i]) > BUILD_RANGE_SQ) continue;
        delta += fx.mul(b.buildStep, this.unitTypes[this.typeIdx[i]].constructRate);
        this.constructedAt[i] = this.tickCount;
        builders++;
      }
      if (delta === 0) continue;
      const before = this.stProgress[s];
      const after = before + delta >= ONE ? ONE : before + delta;
      this.stProgress[s] = after;
      const maxHp = this.stMaxHp[s];
      const hp = this.stHp[s] + fx.mul(fx.mul(maxHp, BUILD_HP_FRAC), after - before);
      this.stHp[s] = hp > maxHp ? maxHp : hp;
      if (after === ONE) {
        this.pendingEvents.push({ kind: 'structureComplete', tick: this.tickCount, site: k, structure: s });
        this.freeSite(k);
      }
    }
  }

  get tunnelCount(): number {
    return this.tunnelCount_;
  }

  /** GH-681: the side that may `enterTunnel` route `r`, or -1 (none, or no
   *  such route). Load-time data, so both seats of a room agree on it. */
  tunnelOwner(r: number): number {
    return r >= 0 && r < this.tunnelCount_ ? this.tnOwner[r] : -1;
  }

  /** GH-681: how many units an `enterTunnel` may put below on route `r`. */
  tunnelCapacity(r: number): number {
    return r >= 0 && r < this.tunnelCount_ ? this.tnCapacity[r] : 0;
  }

  /** GH-681: ticks a crawl from route `r`'s mouth to its vent takes. */
  tunnelTravelTicks(r: number): number {
    return r >= 0 && r < this.tunnelCount_ ? this.tnTravelTicks[r] : 0;
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
    // GH-681. An owner is a combatant side or none; a capacity is a positive
    // whole number. Both are load-time data and refused loudly when malformed,
    // because a wrong owner would hand a route to the wrong seat silently.
    const owner = route.side ?? -1;
    if (owner !== -1 && owner !== 0 && owner !== 1) throw new Error(`tunnel ${route.id}: side must be 0 or 1`);
    this.tnOwner[id] = owner;
    const cap = route.capacity ?? TUNNEL_CAPACITY_DEFAULT;
    if (!Number.isInteger(cap) || cap < 1) throw new Error(`tunnel ${route.id}: capacity must be a positive integer`);
    this.tnCapacity[id] = cap;
    // Ticks from mouth to vent: seconds at the crawl speed, times the tick
    // rate, rounded up so a nonzero route never takes 0. Through seconds, not
    // a per-tick step: 0.5 * DT is not exact in Q16.16 and would add a tick.
    const crawlS = fx.div(this.tnLength[id], TUNNEL_TILES_PER_S);
    this.tnTravelTicks[id] = (fx.mul(crawlS, fx.fromInt(TICKS_PER_SECOND)) + 65535) >> 16;
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
    // A sensor structure raised before this route: add the route's bit to its mask.
    for (let st = 0; st < this.structureCount_; st++) {
      const a = this.structureTypes[this.stTypeIdx[st]].aura;
      if (a === null || a.sensor === null || a.sensor.tunnelRadiusSq <= 0) continue;
      if (this.routeWithin(st, id, a.sensor.tunnelRadiusSq)) this.stRouteMask[st] |= 1 << id;
    }
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
    this.braceClear(unitId);
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
    this.sweepOrder[unitId] = 0;
    this.engaging[unitId] = 0;
    this.boardGoal[unitId] = -1;
    this.garrisonGoal[unitId] = -1;
    this.demolishOrder[unitId] = -1;
    this.demoTicks[unitId] = 0;
    this.demoTarget[unitId] = -1;
    this.chargeOrder[unitId] = -1;
    this.chargeTicks[unitId] = 0;
    this.tunnelGoal[unitId] = -1;
  }

  /** Tile centre of a route's mouth (its first point), Q16.16. */
  private mouthPos(r: number): [Fx, Fx] {
    const m = this.tnPoints[r][0];
    return [fx.add(fx.from(m[0]), HALF), fx.add(fx.from(m[1]), HALF)];
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

  /** The carrier a unit is walking to board, or -1. Read-only (GH-698 Task 5). */
  boardGoalOf(id: number): number {
    return this.boardGoal[id];
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

  /** Dev/test hook: grind a living building DOWN to `eighths`/8 of its max
   *  HP (0..8, integer -- the renderer's own `structureHpBand`) through the
   *  same path a hit takes, so a `structureHit` event reaches the renderer
   *  and `damageStructure`'s own zero check levels it at 0. Never heals: a
   *  building already below the band is left alone. Exists for the
   *  damage-state capture sheet (GH-31, A3.2 remainder); nothing in a
   *  mission calls it, so no replay can see it. */
  debugDamageStructure(id: number, eighths: number): void {
    if (this.stAlive[id] !== 1) return;
    const band = eighths < 0 ? 0 : eighths > 8 ? 8 : eighths | 0;
    const target = fx.mul(this.stMaxHp[id], fx.div(fx.fromInt(band), fx.fromInt(8)));
    const damage = fx.sub(this.stHp[id], target);
    if (damage > 0) this.damageStructure(id, damage, -1);
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
    this.suppFromX[id] = 0;
    this.suppFromY[id] = 0;
    this.suppFromSet[id] = 0;
    this.moving[id] = 0;
    this.attackMove[id] = 0;
    this.sweepOrder[id] = 0;
    this.fieldRef[id] = -1;
    this.brace[id] = BRACE_NONE;
    this.braceTicks[id] = 0;
    this.braceClock[id] = 0;
    this.buildSite[id] = -1;
    this.constructedAt[id] = -1;
    this.auraHealRate[id] = 0;
    this.auraHealCap[id] = 0;
    this.auraCompAt[id] = 0;
    this.auraRepairTicks[id] = 0;
    this.auraAccMult[id] = ONE;
    this.mobilityDamaged[id] = 0;
    this.fieldFixTicks[id] = 0;
    this.airState[id] = 0; // AIR_AIRBORNE
    this.airTimer[id] = 0;
    this.airWant[id] = 0; // AIR_WANT_NONE
    this.figuresUp[id] = type.figures;
    this.scars[id] = 0;
    this.woundParent[id] = -1;
    this.woundBy[id] = -1;
    this.woundState[id] = WOUND_NONE;
    this.bleedTicks[id] = 0;
    this.woundTimer[id] = 0;
    this.medState[id] = MED_IDLE;
    this.medTarget[id] = -1;
    this.medTimer[id] = 0;
    this.speedMul[id] = ONE;
    this.admittedAt[id] = -1;
    // GH-707 Task 5 (c): a `wounded`-role body is DOWN from the moment it exists, whoever
    // spawned it -- a fall (`fallMan` then sets the parent's own bleed over this default) or a
    // mission placing one directly, which has no parent `hull.wounds` to read and bleeds
    // WOUND_DEFAULT_BLEED_TICKS. Counted on his side here, the one place every body passes.
    // Registering such a type sets `woundLive`, so no shipped world takes this branch.
    if (this.woundLive && type.isWounded) {
      this.woundState[id] = WOUND_DOWN;
      this.bleedTicks[id] = WOUND_DEFAULT_BLEED_TICKS;
      this.woundedAlive[side]++;
    }
    this.apsAmmo[id] = type.apsMagazine;
    // E1 (GH-709): the first aura-carrying unit turns the field-works fold on, so the aura
    // columns its heal writes are hashed (spec §2 E1). At SPAWN, not at type registration:
    // only a mission that fields one pays for it, and no shipped unit carries an aura.
    if (type.aura !== null) {
      this.fwLive = true;
      this.unitAuraLive = true;
    }
    this.pendingEvents.push({ kind: 'spawn', tick: this.tickCount, entity: id, typeId: type.id, side });
    return id;
  }

  /**
   * Take a unit off the board on a mission's own say-so — an abduction, not
   * a kill (invariant 4: this is the sim executing a command, not the app
   * reaching into state). `alive` flips to 0, same as `destroy()`, so every
   * existing alive-gated system already treats it as gone; `removed` is set
   * alongside it so `casualties_pct` and the renderer can tell the
   * difference. Deliberately does not call `destroy()`: no passenger
   * eject, no hp/moving reset, no `destroyed` event — none of combat's
   * bookkeeping applies, because nothing here was combat. A no-op if the
   * unit is not currently alive (already dead, or already removed). A unit
   * taken out of a building frees its garrison slot (`releaseSlot`), so an
   * overflow unit waiting at the door can take it.
   */
  removeFromPlay(id: number): void {
    if (this.alive[id] !== 1) return;
    const side = this.side[id];
    if (this.woundLive) this.forgetWounded(id);
    this.alive[id] = 0;
    this.removed[id] = 1;
    this.releaseSlot(id);
    this.pendingEvents.push({ kind: 'removed', tick: this.tickCount, entity: id, side });
  }

  /** GH-707: a living wounded (DOWN or STABILISED) is leaving play -- dead or removed -- so
   *  his side's MAX_WOUNDED_PER_SIDE count drops. Only for a unit still alive, so a second
   *  call on the same death cannot count him twice. */
  private forgetWounded(id: number): void {
    if (this.alive[id] !== 1) return;
    const st = this.woundState[id];
    if (st === WOUND_DOWN || st === WOUND_STABILISED) this.woundedAlive[this.side[id]]--;
  }

  /**
   * GH-707 Task 4 (D4): an evacuation point for `side` at (x, y). A ground carrier with
   * wounded aboard that comes within 1 tile of one of its own side's points evacuates them
   * (`stepEvacuation`). At most MAX_EVAC_POINTS; one more throws -- the mission runtime is
   * the only caller, at start, and a ninth point is an authoring error, not a fight event.
   */
  addEvacPoint(side: number, x: Fx, y: Fx): void {
    if (this.evacCount >= MAX_EVAC_POINTS) throw new Error(`addEvacPoint: at most ${MAX_EVAC_POINTS} evacuation points`);
    if (side !== 0 && side !== 1 && side !== 2) throw new Error(`addEvacPoint: side must be 0, 1 or 2, got ${side}`);
    const k = this.evacCount;
    this.evacSide[k] = side;
    this.evacX[k] = x;
    this.evacY[k] = y;
    this.evacCount = k + 1;
  }

  queueCommand(cmd: Command): void {
    // N2/F4: the seven runtime-run kinds (build, support, cancelBuild, setRally, clearRally,
    // raiseWorks, cancelWorks) go to their own list; the sim never runs them.
    switch (cmd.kind) {
      case 'build': case 'support': case 'cancelBuild': case 'setRally': case 'clearRally':
      case 'raiseWorks': case 'cancelWorks':
        this.runtimeQueue.push(cmd);
        return;
      default:
        this.commandQueue.push(cmd);
    }
  }

  /** The runtime-priced commands queued since the last take, in queue order;
   *  empties the list. Shared empty array when none (no allocation). */
  takeRuntimeCommands(): readonly RuntimeCommand[] {
    if (this.runtimeQueue.length === 0) return NO_RUNTIME_COMMANDS;
    const out = this.runtimeQueue;
    this.runtimeQueue = [];
    return out;
  }

  /** The ambush radius squared when the unit is in ambush, else 0. Read-only
   *  and unhashed (N2). */
  ambushRadiusSqOf(id: number): Fx {
    return this.stance[id] === 1 ? this.ambushRadiusSq[id] : 0;
  }

  /** Put a unit in ambush: hold fire and minimum signature until a target
   *  closes to `tiles` (Q16.16). Cleared when sprung or when re-ordered. */
  setAmbush(id: number, tiles: Fx): void {
    this.stance[id] = 1;
    this.ambushRadiusSq[id] = fx.mul(tiles, tiles);
    // An ambusher is already in its firing position: when the trap springs it
    // shoots that tick, as GDD 5.7's Ashwar target requires, rather than
    // spending KNEEL_DROP_TICKS getting down in front of the column.
    this.braceDown(id);
  }

  /** N3 Task 9 (Q6): put a unit on a patrol of `wps` (2..MAX_PATROL_WAYPOINTS,
   *  checked by the caller), its next leg to the first. `stance` 2; the beat is
   *  walked by `stepPatrolStance`. Sets `patrolLive`. */
  private setPatrol(id: number, wps: readonly (readonly [Fx, Fx])[]): void {
    this.patrolLive = true;
    this.stance[id] = STANCE_PATROL;
    const base = id * MAX_PATROL_WAYPOINTS;
    for (let k = 0; k < MAX_PATROL_WAYPOINTS; k++) {
      this.patrolX[base + k] = k < wps.length ? wps[k][0] : 0;
      this.patrolY[base + k] = k < wps.length ? wps[k][1] : 0;
    }
    this.patrolCount[id] = wps.length;
    this.patrolIdx[id] = 0;
  }

  /** N3 Task 9: end a unit's patrol, if it has one, for an order branch that
   *  does not reset `stance` itself (smoke, unload, an appended move). Touches
   *  nothing else: the unit finishes whatever leg it is on. A hold or an ambush
   *  is left alone, exactly as before. Nothing without `patrolLive`. */
  private dropPatrol(id: number): void {
    if (this.patrolLive && id >= 0 && id < this.count && this.stance[id] === STANCE_PATROL) this.stance[id] = 0;
  }

  /** Is this unit on a `setStance{patrol}` beat? Read-only, for tests and the app. */
  isPatrolling(id: number): boolean {
    return this.stance[id] === STANCE_PATROL;
  }

  /** The waypoint a patroller's next leg goes to (0-based), -1 when it is not patrolling. */
  patrolIndexOf(id: number): number {
    return this.stance[id] === STANCE_PATROL ? this.patrolIdx[id] : -1;
  }

  /** How many points a patroller's beat has (2..MAX_PATROL_WAYPOINTS), 0 when it is not
   *  patrolling. Read-only, for the unit card's "on patrol -- N points" (Lane A mock, Q13). */
  patrolCountOf(id: number): number {
    return this.stance[id] === STANCE_PATROL ? this.patrolCount[id] : 0;
  }

  /**
   * N3 Task 9 (Q6): walk every `setStance{patrol}` beat -- the mission runtime's
   * `stepPatrols` rule, sim-native. A dead, routed, garrisoned, carried or buried
   * patroller holds its index. Contact: a patroller that halts to fire walks on a
   * plain move, which never stops to shoot, so one with a target (unit or
   * structure) that is still moving is halted here, keeping its patrol and its
   * interrupted leg (the index steps back one), and resumes the beat once the
   * target is gone; a vehicle fires on the move and is left as it is. Otherwise an
   * arrived patroller is sent on to its next waypoint by `applyMove(.., true)`,
   * the one move that keeps `stance`. After combat and stepSweep and before
   * movement, so a halt here is what stepBrace kneels on next tick and a new leg
   * walks this tick. A wounded (down) patroller and a LANDING aircraft hold their
   * index too. A patrolling medic stays PARKED (`setStance` parks him, GH-707): these
   * legs never pass through applyCommands, so they do not un-park him, and he walks
   * his beat without rescuing on his own. Nothing at all before `patrolLive`.
   */
  private stepPatrolStance(): void {
    if (!this.patrolLive) return;
    for (let i = 0; i < this.count; i++) {
      if (this.stance[i] !== STANCE_PATROL || this.alive[i] === 0) continue;
      if (this.routed[i] === 1 || this.garrisonedIn[i] >= 0 || this.carriedBy[i] >= 0 || this.tunnelIn[i] >= 0) continue;
      // A downed man takes no order (applyCommands' wounded filter), and a leg issued here
      // never passes that filter, so the patrol holds for him as it does for a buried one.
      if (this.woundState[i] !== WOUND_NONE) continue;
      // A LANDING aircraft ignores a move (applyMove), so a leg would leave `moving` 0 and
      // advance the index -- with a formation pass -- every tick of the descent. Hold instead.
      if (this.airState[i] === AIR_LANDING && this.unitTypes[this.typeIdx[i]].isAir) continue;
      const n = this.patrolCount[i];
      if ((this.curTarget[i] >= 0 || this.curStructure[i] >= 0) && this.unitTypes[this.typeIdx[i]].haltsToFire) {
        if (this.moving[i] === 1) {
          this.haltUnit(i);
          this.haltAir(i);
          this.stance[i] = STANCE_PATROL; // haltUnit clears it; this halt is the patrol's own
          this.patrolIdx[i] = (this.patrolIdx[i] + n - 1) % n;
        }
        continue;
      }
      if (this.moving[i] === 1) continue;
      const k = i * MAX_PATROL_WAYPOINTS + this.patrolIdx[i];
      this.patrolIdx[i] = (this.patrolIdx[i] + 1) % n;
      this.patrolLegIds[0] = i;
      this.applyMove({ kind: 'move', ids: this.patrolLegIds, x: this.patrolX[k], y: this.patrolY[k] }, true);
    }
  }

  /** Put a unit that halts to fire straight into BRACE_KNEELING, no drop.
   *  For the two cases that start a fight already low: an ambusher, and a
   *  fighter coming up out of a tunnel shaft. A no-op for any other unit,
   *  which keeps "brace is NONE for a non-bracer" true by construction. */
  private braceDown(id: number): void {
    if (!this.unitTypes[this.typeIdx[id]].haltsToFire) return;
    this.brace[id] = BRACE_KNEELING;
    this.braceTicks[id] = 0;
    this.braceClock[id] = 0;
  }

  /** Back to BRACE_NONE, no rise: containment (a building, a vehicle, a
   *  tunnel) takes the man out of the open, and his pose with him. */
  private braceClear(id: number): void {
    this.brace[id] = BRACE_NONE;
    this.braceTicks[id] = 0;
    this.braceClock[id] = 0;
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
    this.stepBrace();
    this.stepProjectiles();
    this.stepStrikes();
    this.stepKamikaze();
    // After combat and brace, like stepSweep: a `moving = 0` written here is
    // what stepBrace kneels on next tick. Before stepSweep, so an order that
    // ends here hands the unit back before the sweep looks at it.
    this.stepFocus();
    this.stepSweep();
    // N3 Task 9: after combat (its contact read) and the sweep, before movement.
    this.stepPatrolStance();
    // GH-698: immediately before movement, so a `moving = 0` written for a
    // landing, landed or lifting carrier holds against every setter above
    // (orders, stepFocus, stepSweep) for this tick's step.
    this.stepAirCarriers();
    // GH-707: bleed and crawl, before movement (a wounded takes no movement step of its
    // own: stepMovement skips him, and his crawl is a direct position write here).
    this.stepWounded();
    // GH-707 Task 5: medics after the bleed (a man who bled out this tick is not walked to)
    // and before movement, so the leg a medic is given walks this same tick.
    this.stepMedics();
    this.stepMovement();
    this.stepTransport();
    // GH-707 Task 6: aid posts count their patients down, then admit what carriers brought
    // within reach this tick -- after movement, like evacuation, and before it, so a carrier
    // standing on both a post and an evac point delivers to the post.
    this.stepAidPosts();
    // GH-707 Task 4: a ground carrier on its side's evac point, after it moved and its riders
    // with it. Nothing without wound content.
    this.stepEvacuation();
    this.stepFields();
    this.stepGarrison();
    this.stepTunnelEntry();
    // Field works: before upkeep, which reads the aura arrays every tick.
    this.stepAuras();
    // E6 G1: fuses burn BEFORE stepDemolition, so a charge set on tick T first loses a tick on
    // T+1 and falls on T + fuse_s * 20 exactly (8 s = 160 ticks).
    this.stepCharges();
    this.stepDemolition();
    this.stepUpkeep();
    // After upkeep rather than beside stepDemolition: the pin flag latches
    // in stepUpkeep, and a charge must abort on the very tick the team is
    // pinned — one slot earlier in the order and the interruption lands a
    // tick late, which is the difference the pinned test measures.
    this.stepTunnelCharge();
    // Last, so a site's builder reads this tick's `moving` and `pinned`, and a
    // site whose structure fell anywhere in this tick is freed before the next
    // tick's commands can name it.
    this.stepConstruction();
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
   * one already in the pool.
   */
  private fieldFor(gx: number, gy: number, domain: number): number {
    const d = domain === DOMAIN_VEHICLE && !this.hasBoulders ? DOMAIN_FOOT : domain;
    const byGoal = this.fieldByGoal[d];
    const key = gy * this.width + gx;
    const existing = byGoal.get(key);
    if (existing !== undefined) {
      this.fieldLastIssued[existing] = this.tickCount;
      return existing;
    }
    let idx = this.fields.length >= MAX_FLOW_FIELDS ? this.evictableField() : -1;
    if (idx < 0) {
      idx = this.fields.length;
      this.fields.push(new FlowField(this.width, this.height));
    } else {
      // A slot dropped by recomputeFields holds key -1: nothing in the map to remove.
      this.fieldByGoal[this.fieldDomain[idx]].delete(this.fieldGoalKey[idx]);
    }
    this.fields[idx].compute(this.pathMaskFor(d), d === DOMAIN_AIR ? this.openGrid : this.elevation, gx, gy);
    this.fieldLastIssued[idx] = this.tickCount;
    this.fieldGoalKey[idx] = key;
    this.fieldDomain[idx] = d;
    byGoal.set(key, idx);
    return idx;
  }

  /**
   * The flow-field pool's KEYS, for the snapshot codec (net sim snapshot S1).
   * @internal Snapshot codec only; nothing else may call it.
   * The field bytes are not here: a keyed field is `compute(path mask, elevation,
   * goal)` of the current terrain, so `restoreFieldPool` rebuilds it.
   *
   * `slots` has one entry per pool slot, `watermark` of them. `goal` is the goal
   * tile index, or -1 for a slot `recomputeFields` unkeyed (its bytes are
   * unobservable). `lastIssued` is carried for EVERY slot, keyed or not:
   * `evictableField` picks the least-recently-issued slot and an unkeyed one
   * competes on its stale value, so which slot a later order lands in (and so
   * `fieldRef`) depends on it. `order[d]` lists domain d's slots in
   * `fieldByGoal[d]` insertion order, which is the Map's iteration order.
   */
  fieldPoolKeys(): FieldPoolKeys {
    const slots: FieldPoolKeys['slots'] = [];
    for (let i = 0; i < this.fields.length; i++) {
      slots.push({ goal: this.fieldGoalKey[i], domain: this.fieldDomain[i], lastIssued: this.fieldLastIssued[i] });
    }
    const order: number[][] = [];
    for (let d = 0; d < DOMAIN_COUNT; d++) order.push(Array.from(this.fieldByGoal[d].values()));
    return { watermark: this.fields.length, slots, order };
  }

  /**
   * @internal Snapshot codec only; nothing else may call it.
   *
   * Replaces the whole pool with the one `keys` describes, recomputing every
   * keyed field against the CURRENT masks (so call it after the terrain columns
   * are restored). Validates everything before the first write and throws on a
   * bad input; the pool is the encoding's, whatever the target already held.
   */
  restoreFieldPool(keys: FieldPoolKeys): void {
    const cells = this.width * this.height;
    const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
    const { watermark, slots, order } = keys;
    // Bounded by restore memory, not by capacity: see POOL_RESTORE_BUDGET_BYTES.
    if (!isInt(watermark) || watermark < 0 || watermark * cells * 5 > POOL_RESTORE_BUDGET_BYTES) {
      throw new Error(`field pool: watermark ${String(watermark)} is past the ${POOL_RESTORE_BUDGET_BYTES}-byte restore budget`);
    }
    if (!Array.isArray(slots) || slots.length !== watermark) throw new Error('field pool: slots do not match the watermark');
    if (!Array.isArray(order) || order.length !== DOMAIN_COUNT) throw new Error('field pool: need one order list per domain');
    let keyed = 0;
    for (let i = 0; i < watermark; i++) {
      const s = slots[i];
      if (s === null || typeof s !== 'object') throw new Error(`field pool: slot ${i} is not an object`);
      if (!isInt(s.domain) || s.domain < 0 || s.domain >= DOMAIN_COUNT) throw new Error(`field pool: slot ${i} domain ${String(s.domain)}`);
      if (!isInt(s.lastIssued) || s.lastIssued < 0 || s.lastIssued > this.tickCount) throw new Error(`field pool: slot ${i} lastIssued ${String(s.lastIssued)}`);
      if (s.goal === -1) continue;
      if (!isInt(s.goal) || s.goal < 0 || s.goal >= cells) throw new Error(`field pool: slot ${i} goal ${String(s.goal)} is off the map`);
      // `fieldFor` collapses vehicle onto foot on a map with no boulders, so no keyed slot can hold it.
      if (s.domain === DOMAIN_VEHICLE && !this.hasBoulders) throw new Error(`field pool: slot ${i} is a vehicle field on a map with no boulders`);
      keyed++;
    }
    const listed = new Uint8Array(watermark);
    let listedCount = 0;
    for (let d = 0; d < DOMAIN_COUNT; d++) {
      const list = order[d];
      if (!Array.isArray(list)) throw new Error(`field pool: order ${d} is not a list`);
      const goals = new Set<number>();
      for (const idx of list) {
        if (!isInt(idx) || idx < 0 || idx >= watermark) throw new Error(`field pool: order ${d} names slot ${String(idx)}`);
        const s = slots[idx];
        if (listed[idx] === 1) throw new Error(`field pool: slot ${idx} is listed twice`);
        if (s.goal === -1 || s.domain !== d) throw new Error(`field pool: slot ${idx} is listed in domain ${d} but is not keyed there`);
        if (goals.has(s.goal)) throw new Error(`field pool: domain ${d} has two slots for goal ${s.goal}`);
        goals.add(s.goal);
        listed[idx] = 1;
        listedCount++;
      }
    }
    if (listedCount !== keyed) throw new Error('field pool: a keyed slot is missing from the order lists');
    for (let i = 0; i < this.capacity; i++) {
      if (this.fieldRef[i] < -1 || this.fieldRef[i] >= watermark) throw new Error(`field pool: unit ${i} follows slot ${this.fieldRef[i]}, outside the pool`);
    }

    // ---- validated. Replace the pool.
    if (this.fields.length > watermark) this.fields.length = watermark;
    while (this.fields.length < watermark) this.fields.push(new FlowField(this.width, this.height));
    this.fieldGoalKey.length = watermark;
    this.fieldDomain.length = watermark;
    this.fieldLastIssued.length = watermark;
    for (const m of this.fieldByGoal) m.clear();
    for (let i = 0; i < watermark; i++) {
      this.fieldGoalKey[i] = slots[i].goal;
      this.fieldDomain[i] = slots[i].domain;
      this.fieldLastIssued[i] = slots[i].lastIssued;
    }
    for (let d = 0; d < DOMAIN_COUNT; d++) {
      const mask = this.pathMaskFor(d);
      const elev = d === DOMAIN_AIR ? this.openGrid : this.elevation;
      for (const idx of order[d]) {
        const goal = slots[idx].goal;
        const gx = goal % this.width;
        this.fields[idx].compute(mask, elev, gx, (goal - gx) / this.width);
        this.fieldByGoal[d].set(goal, idx);
      }
    }
  }

  /** The least-recently-issued field no living unit follows and that was not
   *  itself issued THIS tick, or -1 when no such field exists.
   *
   *  The same-tick exclusion is load-bearing, not a tie-break nicety. In the
   *  move/attackMove handler, a ground field is resolved once before the
   *  per-id loop and only lands in a unit's `fieldRef` when the loop reaches
   *  a plain ground id; a mixed-type order can call `fieldFor` again for
   *  `airField`/`vField` on an EARLIER id first. At that moment the ground
   *  field is not yet referenced by anyone, so without this guard it reads
   *  as free and can be evicted out from under the order that just created
   *  it -- every field issued this tick shares `this.tickCount`, so a plain
   *  `<` comparison only protects it while an older unreferenced field still
   *  exists in the pool. Excluding same-tick fields outright means the pool
   *  can grow past MAX_FLOW_FIELDS within a single tick, on the rare occasion
   *  every idle field was issued that same tick. `fields` never shrinks --
   *  that growth is a permanent watermark, not a spike -- so what a later
   *  miss buys back is only room for eviction to work again, not a smaller
   *  array.
   *
   *  O(units + fields) per call, called once per cache miss, which is at
   *  most a few times per order. */
  private evictableField(): number {
    const live = new Uint8Array(this.fields.length);
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const f = this.fieldRef[i];
      if (f >= 0) live[f] = 1;
    }
    let best = -1;
    for (let f = 0; f < this.fields.length; f++) {
      if (live[f] === 1) continue;
      if (this.fieldLastIssued[f] === this.tickCount) continue;
      if (best < 0 || this.fieldLastIssued[f] < this.fieldLastIssued[best]) best = f;
    }
    return best;
  }

  /** The movement domain a living unit paths in: DOMAIN_AIR for an aircraft.
   *  `maskFor` of it is still the ground the unit stands on. */
  private domainOf(id: number): number {
    return this.unitTypes[this.typeIdx[id]].pathDomain;
  }

  /** Field toward a tile for one unit's domain, snapped to ground that domain
   *  can actually stand on. The snap is what `demolish` and `garrison` need:
   *  their goal is a structure centroid, always inside its own footprint. */
  private fieldToward(id: number, tx: number, ty: number): number {
    const d = this.domainOf(id);
    const mask = this.maskFor(d);
    if (!this.snapReachableTile(id, tx, ty, mask)) this.snapOpenTile(tx, ty, mask);
    return this.fieldFor(this.snapX, this.snapY, d);
  }

  /** Scratch field for `snapReachableTile`: cost from every tile to ONE unit.
   *  Never a pooled field, never hashed, recomputed per call. */
  private approachField: FlowField | null = null;

  /**
   * `snapOpenTile`, but the open tile is picked by what it costs THIS unit to
   * walk there, not by scan order. The nearest ring that holds any tile the
   * unit can reach wins, and within it the cheapest; ties keep row-major
   * order. Without it a structure that plugs a cutting (Qarn Hadid II's
   * revetment) is approached from whichever face the scan meets first -- the
   * far one -- and the engineers walk the whole map round to reach it.
   * Returns false when the unit can reach no open tile at all (or either end
   * is off the map); the caller then falls back to the plain snap.
   */
  private snapReachableTile(id: number, gx: number, gy: number, mask: Uint8Array): boolean {
    const w = this.width;
    const h = this.height;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) return false;
    this.snapOpenTile(fx.toInt(this.posX[id]), fx.toInt(this.posY[id]), mask);
    const ux = this.snapX;
    const uy = this.snapY;
    if (ux < 0 || uy < 0 || ux >= w || uy >= h || mask[uy * w + ux] !== 0) return false;
    if (this.approachField === null) this.approachField = new FlowField(w, h);
    const field = this.approachField;
    field.compute(mask, this.elevation, ux, uy);
    const maxR = w > h ? w : h;
    for (let r = 0; r <= maxR; r++) {
      let best = -1;
      let bestCost = 0x7fffffff;
      const x0 = gx - r < 0 ? 0 : gx - r;
      const x1 = gx + r >= w ? w - 1 : gx + r;
      const y0 = gy - r < 0 ? 0 : gy - r;
      const y1 = gy + r >= h ? h - 1 : gy + r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const ddx = x - gx < 0 ? gx - x : x - gx;
          const ddy = y - gy < 0 ? gy - y : y - gy;
          if ((ddx > ddy ? ddx : ddy) !== r) continue;
          const tile = y * w + x;
          if (mask[tile] !== 0) continue;
          const c = field.costAt(tile);
          if (c < bestCost) {
            bestCost = c;
            best = tile;
          }
        }
      }
      if (best >= 0) {
        this.snapX = best % w;
        this.snapY = (best - this.snapX) / w;
        return true;
      }
    }
    return false;
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
    this.snapOpenTile(gx, gy, mask);
    return [this.snapX, this.snapY];
  }

  /** nearestOpenTile's answer, from the last `snapOpenTile` call. Scratch,
   *  read straight after the call that wrote it, so a per-tick caller
   *  (stepFocus) allocates nothing. Never hashed. */
  private snapX = 0;
  private snapY = 0;

  /** nearestOpenTile without the tuple: writes `snapX`/`snapY`. The one
   *  search; nearestOpenTile is a wrapper over it. */
  private snapOpenTile(gx: number, gy: number, mask: Uint8Array): void {
    this.snapX = gx;
    this.snapY = gy;
    const w = this.width;
    const h = this.height;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) return;
    if (mask[gy * w + gx] === 0) return;
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
          if (mask[y * w + x] === 0) {
            this.snapX = x;
            this.snapY = y;
            return;
          }
        }
      }
    }
    // No open tile anywhere on the map -- cannot happen on any map that has
    // a player on it, but a caller still needs a value: (gx, gy), as set.
  }

  /**
   * Tiles a new order may not put a slot on: every living same-side unit
   * outside the order that is on the surface, at its goal tile while moving
   * and at its own tile otherwise (spawn never sets a goal, so "otherwise"
   * is where it stands). Derived per order rather than kept as state: a scan
   * is O(units), orders are rare, and it needs no bookkeeping at any of the
   * sites that set `goalX` — spec §4.3's "reservation map", Deviation 1.
   */
  private reservedTilesFor(side: number, ids: readonly number[]): Uint8Array {
    const reserved = new Uint8Array(this.width * this.height);
    const inOrder = new Set(ids);
    for (let j = 0; j < this.count; j++) {
      if (this.alive[j] === 0 || this.side[j] !== side || inOrder.has(j)) continue;
      if (this.garrisonedIn[j] >= 0 || this.carriedBy[j] >= 0 || this.tunnelIn[j] >= 0) continue;
      const x = fx.toInt(this.moving[j] === 1 ? this.goalX[j] : this.posX[j]);
      const y = fx.toInt(this.moving[j] === 1 ? this.goalY[j] : this.posY[j]);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      reserved[y * this.width + x] = 1;
    }
    return reserved;
  }

  /** What `halt` writes for one unit, after it has left any building. */
  private haltUnit(id: number): void {
    this.garrisonGoal[id] = -1;
    // And a boarding order: stepTransport re-sets `moving` every tick
    // to chase the carrier while `boardGoal` is latched, so a rider
    // halted on its way to a vehicle walked on to it -- measured 15.9
    // tiles in 10 s (orders-obeyed.test.ts). `demolishOrder` and
    // `chargeOrder` are left alone on purpose: their steps only ever
    // STOP a unit in range, never start one, so a halt already holds
    // them (pinned beside the boarding test).
    this.boardGoal[id] = -1;
    this.wpCount[id] = 0;
    this.moving[id] = 0;
    this.fieldRef[id] = -1;
    // A halted unit stays halted (the lead's ruling, 2026-10-11). The
    // attack-move latch has to go with `moving`: left set, stepSweep
    // read an idle attack-mover with a remembered contact and walked it
    // off again on the very next tick -- measured 9 / 11 / 28 tiles
    // away 10 s after a halt for inf_squad / mbt_lavi / jeep_shoded.
    this.attackMove[id] = 0;
    this.sweepOrder[id] = 0;
    this.engaging[id] = 0;
    this.stance[id] = 0;
  }

  /** The `move` / `attackMove` order (moved here whole from `applyCommands` for
   *  N3 Task 9). `patrolLeg` is true only for a leg `stepPatrolStance` issues
   *  itself, the one move that does not reset `stance`: every other caller is a
   *  command off the queue, and "any order overrides a held stance". */
  private applyMove(cmd: Extract<Command, { kind: 'move' | 'attackMove' }>, patrolLeg: boolean): void {
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
    // A vehicle snaps against its OWN mask, because a boulder is open
    // ground to a rifleman and a wall to a tank: the same right-click
    // resolves to different tiles for the two, and each domain's tile is
    // where that domain's rank of the formation is anchored. `move` is
    // the one order whose completion is a position test, so a vehicle
    // goal left on a tile it can never stand on is the freeze described
    // above, arriving by a different door. Resolved once per order, and
    // deliberately with no `hasBoulders` shortcut of its own: on a
    // boulder-free map the two masks are the same array, so this arrives
    // at the same tile the foot snap did. One collapse, in one place, is
    // the only kind a test can pin.
    const [vgx, vgy] = this.nearestOpenTile(tx, ty, this.blockedVehicleMask);
    // An EXACT order opts out of the formation: it keeps the point it was
    // given and every unit in it gets that same goal. It is how the sim
    // shepherds a unit to a point one of its own rules has already chosen
    // — `CivilianFlight` sending a family to the refuge — where spreading
    // the order would move a unit off ground the rule picked, and off the
    // evacuation zone drawn around it. Never set on a player order. Note
    // it opts out of being PLACED, not out of being avoided:
    // `reservedTilesFor` is untouched, so an exact goal still holds its
    // tile against everybody else's slots.
    //
    // The three lines below are the goal resolution this branch had
    // before formations (75461bc), kept whole rather than re-derived: the
    // exact point when the click tile is open for that domain, the
    // centre of that domain's snapped tile when it is not, and the raw
    // point for air, which hovers over rock as happily as over road.
    const exact = cmd.exact === true;
    const snapped = fgx !== tx || fgy !== ty;
    const vSnapped = vgx !== tx || vgy !== ty;
    const sgx = snapped ? fx.add(fx.fromInt(fgx), HALF) : gx;
    const sgy = snapped ? fx.add(fx.fromInt(fgy), HALF) : gy;
    const xgx = vSnapped ? fx.add(fx.fromInt(vgx), HALF) : gx;
    const xgy = vSnapped ? fx.add(fx.fromInt(vgy), HALF) : gy;
    // One slot per unit (formation.ts): a group order lands as a
    // formation around the click — vehicles and aircraft on the clicked
    // row, infantry in the ranks behind — instead of every unit
    // converging on the one point.
    //
    // AIR is not exempt on this path, deliberately. A drone ordered onto a
    // blocked tile used to keep the raw point and the raw (all-DIR_NONE)
    // field, which flew it to the rock it was told to hover over; that is
    // a coherent order and it is simply not expressible as a slot. It now
    // takes the foot-snapped click tile and the foot mask like everything
    // else, with `front` set so it leads the ranks rather than queueing up
    // behind the infantry. (The exemption survives on the exact path
    // above, which is not placing anything.)
    const members: FormationUnit[] = [];
    let sumX = 0;
    let sumY = 0;
    for (const id of exact ? [] : cmd.ids) {
      // A passenger is inside a vehicle and does not walk anywhere: the
      // carrier decides where it goes, and `unload` is how it gets out.
      // This used to disembark instead, which made the ordinary workflow
      // fail — a box-select still holds the infantry after they board, so
      // the next right-click dumped them in the road while the APC drove
      // off. They are already untargetable while aboard; being immune to
      // movement orders is the same idea. Refused HERE, where the members
      // are gathered, so a passenger is not handed a slot on the ground
      // either — the loop below then skips it for having none.
      if (this.alive[id] === 0 || this.routed[id] === 1 || this.carriedBy[id] >= 0) continue;
      const utype = this.unitTypes[this.typeIdx[id]];
      // GH-698: a LANDING aircraft ignores a move outright -- no slot here,
      // nothing written below. #706: any air type, since a forced landing
      // brings a gunship down too.
      if (utype.isAir && this.airState[id] === AIR_LANDING) continue;
      const front = utype.isAir || utype.moveDomain === DOMAIN_VEHICLE;
      members.push({ id, domain: utype.isAir ? DOMAIN_FOOT : utype.moveDomain, front });
      // Where this unit will be coming FROM: its last queued point when
      // the order appends to a route, otherwise where it stands. Their
      // centroid is the only thing that fixes which way the ranks face,
      // so an appended leg has to be measured from the end of the leg
      // before it and not from a unit still standing on the start line.
      const queued = cmd.append === true && this.moving[id] === 1;
      const n = this.wpCount[id];
      const fromX = queued
        ? n > 0
          ? this.wpX[id * MAX_WAYPOINTS + n - 1]
          : this.goalX[id]
        : this.posX[id];
      const fromY = queued
        ? n > 0
          ? this.wpY[id * MAX_WAYPOINTS + n - 1]
          : this.goalY[id]
        : this.posY[id];
      sumX += fx.toInt(fromX);
      sumY += fx.toInt(fromY);
    }
    const slots = new Map<number, [number, number]>();
    if (members.length > 0) {
      const n = members.length;
      const assigned = assignFormation({
        width: this.width,
        height: this.height,
        masks: [this.blocked, this.blockedVehicleMask],
        origins: [
          [fgx, fgy],
          [vgx, vgy],
        ],
        clickX: fgx,
        clickY: fgy,
        // The tree's integer-divide idiom (`fixed.ts:119`), not a float
        // divide truncated: subtracting the remainder first leaves a
        // dividend exactly divisible by `n`, so no float is ever produced
        // to be rounded on the way past. `Math.trunc` is banned in this
        // package (invariant 2), and `| 0` would have been bit-identical
        // here — this says what it means instead of relying on the
        // dividend staying non-negative and inside 2^31.
        fromX: (sumX - (sumX % n)) / n,
        fromY: (sumY - (sumY % n)) / n,
        units: members,
        // An order's ids are single-side by construction (a player or a
        // script never mixes sides in one command), so the first member
        // stands in for all of them here.
        reserved: this.reservedTilesFor(this.side[members[0].id], cmd.ids),
      });
      for (const s of assigned) slots.set(s.id, [s.x, s.y]);
    }
    const attack = cmd.kind === 'attackMove' ? 1 : 0;
    const sweep = cmd.kind === 'attackMove' && cmd.sweep === true ? 1 : 0;
    for (const id of cmd.ids) {
      if (this.alive[id] === 0 || this.routed[id] === 1) continue; // broken troops aren't listening
      const utype = this.unitTypes[this.typeIdx[id]];
      // GH-698: a move cancels an air carrier's land plan -- except while
      // LANDING, which ignores it before any write (a goal, field or
      // attack-move latch left behind would let stepSweep/stepFocus lift
      // it once landed). Before the append fast-path: an appended leg
      // behind a land order would otherwise land the carrier on the
      // waypoint, wherever that is. #706: any air type (a non-carrier's want
      // is always NONE, so only the LANDING rule bites).
      if (utype.isAir) {
        if (this.airState[id] === AIR_LANDING) continue;
        const want = this.airWant[id];
        if (want === AIR_WANT_LOAD || want === AIR_WANT_UNLOAD) this.airWant[id] = AIR_WANT_NONE;
      }
      const slot = exact ? undefined : slots.get(id);
      // A passenger is not going anywhere on its own feet either way: on
      // the formation path it claimed no slot, and on the exact path it
      // is refused here.
      if (exact ? this.carriedBy[id] >= 0 : slot === undefined) continue;
      let ux: Fx;
      let uy: Fx;
      // The point is resolved here; the FIELD toward it is not. Only the
      // goal tile and the domain to path it on are carried down, because
      // an appended order stores `ux/uy` as a waypoint and returns — the
      // field is recomputed when that waypoint activates on arrival. A
      // `fieldFor` call up here would therefore sweep 2304 cells per
      // appended unit for a result nothing ever reads, and leave it in
      // the pool for eviction to clear.
      //
      // `slot === undefined` here means the EXACT path: on the formation
      // path a member always has a slot by construction (it would not be
      // in `members` otherwise), and the guard above already `continue`d
      // away anyone the formation path left without one.
      let ufx: number;
      let ufy: number;
      let ufd: number;
      if (slot === undefined) {
        if (snapped && utype.isAir) {
          ux = gx;
          uy = gy;
          ufx = tx;
          ufy = ty;
          ufd = DOMAIN_AIR;
        } else if (utype.moveDomain === DOMAIN_VEHICLE) {
          ux = xgx;
          uy = xgy;
          ufx = vgx;
          ufy = vgy;
          ufd = DOMAIN_VEHICLE;
        } else {
          ux = sgx;
          uy = sgy;
          ufx = fgx;
          ufy = fgy;
          ufd = utype.pathDomain; // DOMAIN_FOOT, or DOMAIN_AIR for an aircraft
        }
      } else {
        // A unit whose slot IS the tile under the cursor keeps the exact
        // point clicked, fraction and all — snapping that to a tile centre
        // would be a different order from the one issued, and it is the one
        // case where nothing is bought by moving it: the tile is this
        // unit's alone either way. Everyone the formation displaced takes
        // its slot's centre, because a displaced unit has no clicked point
        // of its own to keep.
        const onClick = slot[0] === tx && slot[1] === ty;
        ux = onClick ? gx : fx.add(fx.fromInt(slot[0]), HALF);
        uy = onClick ? gy : fx.add(fx.fromInt(slot[1]), HALF);
        ufx = slot[0];
        ufy = slot[1];
        ufd = utype.pathDomain;
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
          this.wpSweep[k] = sweep;
          this.wpCount[id] = n + 1;
        }
        // N3 Task 9: an appended leg is a new order too -- the patrol ends, and the
        // unit walks its current leg and then the appended route. (This fast-path
        // never reached the stance reset below, so a hold or ambush, which never
        // has `moving` 1, could not notice; a patroller nearly always does.)
        this.dropPatrol(id);
        continue;
      }
      // (A passenger never reached here: the guard above turned it away —
      // no slot on the formation path, refused outright on the exact one.)
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
      // Asked for and stamped into `fieldRef` in one statement, so no
      // other `fieldFor` can run between the two: the pool reuses any
      // field no living unit references, and a field issued but not yet
      // stamped is exactly that. (`evictableField`'s same-tick exclusion
      // is the other half of that guarantee.)
      this.fieldRef[id] = this.fieldFor(ufx, ufy, ufd);
      this.moving[id] = 1;
      this.attackMove[id] = attack;
      this.sweepOrder[id] = sweep;
      this.engaging[id] = 0;
      // Any order overrides a held stance -- a patrol included. A leg the patrol
      // issues itself (`stepPatrolStance`, `patrolLeg`) is the one move that keeps it.
      if (!patrolLeg) this.stance[id] = 0;
    }
  }

  private applyCommands(): void {
    if (this.runtimeQueue.length !== 0) this.runtimeQueue = []; // R-3: no runtime took them
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
      // GH-681: `vent` is the one command addressed TO buried units -- it is how
      // a human seat brings them up -- so it is the named exception to the
      // containment rule below. Every other kind stays contained.
      if ('ids' in cmd && cmd.kind !== 'vent') {
        // GH-707: a wounded (DOWN, STABILISED -- any woundState but NONE) takes no order
        // either, by the same filter: he is hors de combat and goes where a medic takes him.
        // Without wound content every woundState is NONE, so this adds nothing.
        let anyBuried = false;
        for (const id of cmd.ids) {
          if (this.tunnelIn[id] >= 0 || this.woundState[id] !== WOUND_NONE) {
            anyBuried = true;
            break;
          }
        }
        if (anyBuried) {
          const kept: number[] = [];
          for (const id of cmd.ids) {
            if (this.tunnelIn[id] < 0 && this.woundState[id] === WOUND_NONE) kept.push(id);
          }
          if (kept.length === 0) continue;
          // A copy, not a splice: the queued object belongs to whoever sent
          // the command (invariant 4 — commands flow IN), and mutating it is
          // observable outside the sim.
          cmd = withIds(cmd, kept);
        }
        // Any order that names a unit takes its fire order away: a focus is
        // what the unit was last told to shoot, and "go there" or "stop" is
        // a newer word. `attack` itself is the one that sets it (below). Done
        // for every id the order names, refused or not, so a routed or
        // carried unit cannot keep an old focus past a command that reached
        // it. (`reveal` and `callStrike` carry no ids and name no unit.)
        //
        // The leg goes with it. While a focus stands, `moving` can only be
        // stepFocus's chase (`attack` stopped the unit, and every other order
        // releases the focus here), so a released focus must not leave that
        // leg running: an order that does not move the unit itself (smoke,
        // unload, any refusal) would otherwise walk it onto the enemy with its
        // fire held, and an APPENDED move would queue behind the chase.
        // Field works: any order that names a builder takes it off its site --
        // `construct` included: its branch below puts back on a site only the
        // ids it accepts, so a refused construct leaves its ids on no site.
        // Same rule as the focus: every id named, refused or not. The flag
        // guard keeps a world with no field works from touching the column at
        // all (D1).
        if (this.fwLive) {
          for (const id of cmd.ids) this.buildSite[id] = -1;
        }
        // GH-707 Task 5: any order but `rescue` takes a medic off his automatic job (he keeps
        // whoever he carries), and `halt`, `setStance` and `unload` PARK him -- `medTimer` -1
        // in MED_IDLE, no automatic rescue until his next order -- because a halted unit stays
        // halted (the lead's ruling of 2026-10-11) and a man put down on an order must not be
        // picked straight back up. `rescue` and `attack` touch only the ids they accept (their
        // branches): a refused order changes nothing (GH-420). Nothing here without wound
        // content.
        if (this.woundLive && cmd.kind !== 'rescue' && cmd.kind !== 'attack') {
          const park = cmd.kind === 'halt' || cmd.kind === 'setStance' || cmd.kind === 'unload';
          for (const id of cmd.ids) {
            if (id < 0 || id >= this.count || this.unitTypes[this.typeIdx[id]].rescue === null) continue;
            this.medState[id] = MED_IDLE;
            this.medTarget[id] = -1;
            this.medTimer[id] = park ? -1 : 0;
          }
        }
        // GH-681: any surface order naming a unit cancels its walk to a route
        // end (`enterTunnel` sets a fresh one below), and on a human-held side
        // it ends a raid: the unit stays up for good rather than being taken
        // back below from wherever the order walked it. Behind `tnOrderLive`,
        // so a world that never saw a tunnel order touches neither column.
        if (this.tnOrderLive) {
          for (const id of cmd.ids) {
            this.tunnelGoal[id] = -1;
            if (this.homeTunnel[id] >= 0 && this.isHumanHeld(this.side[id])) this.endRaid(id);
          }
        }
        if (cmd.kind !== 'attack' && cmd.kind !== 'rescue') {
          for (const id of cmd.ids) {
            if (this.focusTarget[id] >= 0) {
              this.moving[id] = 0;
              this.fieldRef[id] = -1;
            }
            this.focusTarget[id] = -1;
            this.focusLost[id] = 0;
          }
        }
      }
      if (cmd.kind === 'move' || cmd.kind === 'attackMove') {
        this.applyMove(cmd, false);
      } else if (cmd.kind === 'smoke') {
        for (const id of cmd.ids) {
          // N3 Task 9: this branch never touched `stance` (a smoke order left a
          // hold or an ambush standing, and still does); a patrol is dropped by it.
          this.dropPatrol(id);
          if (this.alive[id] === 0 || !this.unitTypes[this.typeIdx[id]].canSmoke) continue;
          if (this.smokeCooldown[id] > 0) continue;
          if (distSqFx(fx.sub(cmd.x, this.posX[id]), fx.sub(cmd.y, this.posY[id])) > SMOKE_RANGE_SQ) continue;
          this.smokeCooldown[id] = SMOKE_COOLDOWN;
          this.layScreen(cmd.x, cmd.y, id);
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
          // stream so replays stay identical (invariant 3). Two draws a round,
          // whatever the profile; the rounds are all queued now, so a caller
          // who dies afterwards still has every one land.
          const profile = cmd.profile ?? FS_AIR_STRIKE;
          const p = FIRE_SUPPORT[profile];
          if (p !== undefined) {
            for (let r = 0; r < p.rounds; r++) {
              const ang = this.rng.nextU32(cmd.caller) & 0xffff;
              const draw = this.rng.nextU32(cmd.caller);
              const rad = (p.wideScatter ? draw : draw >>> 16) % (p.scatter + 1);
              this.pendingStrikes.push({
                x: fx.add(cmd.x, fx.mul(fx.cos(ang), rad)),
                y: fx.add(cmd.y, fx.mul(fx.sin(ang), rad)),
                by: cmd.caller,
                readyTick: this.tickCount + p.delayTicks + r * p.spacingTicks,
                profile,
              });
            }
          }
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
        let gx = this.posX[car];
        let gy = this.posY[car];
        // GH-698 R3: an air carrier lands to load. Riders walk to the LZ, not
        // to the hull, and board once it is LANDED (canSeat).
        // Refused (no rider, or no vehicle-open tile anywhere): the whole
        // `load` is dropped and nobody walks. In flight the LZ is the goal
        // orderLand just wrote; LANDING or LANDED, the hull is on its LZ.
        if (this.unitTypes[this.typeIdx[car]].isAirCarrier) {
          if (!this.airLoadOrder(car, cmd.ids)) continue;
          const st = this.airState[car];
          if (st === AIR_AIRBORNE || st === AIR_LIFTING) {
            gx = this.goalX[car];
            gy = this.goalY[car];
          }
        }
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1 || id === car) continue;
          // Only dismounted elements ride. This also covers vehicle stacking,
          // since no carrier is a foot role.
          if (!this.unitTypes[this.typeIdx[id]].canEmbark) continue;
          if (this.carriedBy[id] >= 0) continue;
          // GH-707 D3: a carrying medic boards nothing (canSeat refuses him too); refused here
          // so he is not walked to a hull that will never take him.
          if (this.unitTypes[this.typeIdx[id]].rescue !== null && this.passengers[id] > 0) continue;
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.boardGoal[id] = car;
          this.wpCount[id] = 0;
          this.goalX[id] = gx;
          this.goalY[id] = gy;
          this.fieldRef[id] = this.fieldFor(fx.toInt(gx), fx.toInt(gy), this.domainOf(id));
          this.moving[id] = 1;
          this.attackMove[id] = 0;
          this.sweepOrder[id] = 0;
          this.stance[id] = 0;
        }
      } else if (cmd.kind === 'unload') {
        for (const id of cmd.ids) {
          this.dropPatrol(id); // N3 Task 9: as `smoke`, the one other branch that never resets `stance`
          // GH-698 R4: an air carrier lands, then unloads. A ground carrier
          // keeps unloadAll, the immediate everyone-out.
          if (id >= 0 && id < this.count && this.unitTypes[this.typeIdx[id]].isAirCarrier) this.airUnloadOrder(id);
          else this.unloadAll(id);
        }
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
          this.sweepOrder[id] = 0;
          this.engaging[id] = 0;
          this.stance[id] = 0;
        }
      } else if (cmd.kind === 'garrison') {
        const s = cmd.structure;
        if (s < 0 || s >= this.structureCount_ || this.stAlive[s] === 0) continue;
        // Field works: nobody moves into a building that is still going up
        // (and `removeStructure` relies on it: an unfinished one is empty).
        if (this.stProgress[s] < ONE) continue;
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
          this.sweepOrder[id] = 0;
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
          this.sweepOrder[id] = 0;
          this.engaging[id] = 0;
          this.stance[id] = 0;
        }
      } else if (cmd.kind === 'attack') {
        // BEFORE the bare `else` below, which is the halt branch: it touches
        // only `cmd.ids`, so an `attack` placed after it compiles and halts.
        for (const id of cmd.ids) {
          if (!this.canFocus(id, cmd.target)) continue; // a refused id changes nothing
          // GH-698: the move order's air prelude. A LANDING carrier ignores the
          // order before any write; otherwise it cancels a land plan, so
          // stepFocus's chase goal (the target's last-seen tile, never checked
          // as an LZ) can never become a landing, and stepTransport releases the
          // riders. LANDED, the chase lifts it as a move would. #706: any air type.
          if (this.unitTypes[this.typeIdx[id]].isAir) {
            if (this.airState[id] === AIR_LANDING) continue;
            const want = this.airWant[id];
            if (want === AIR_WANT_LOAD || want === AIR_WANT_UNLOAD) this.airWant[id] = AIR_WANT_NONE;
          }
          this.focusTarget[id] = cmd.target;
          this.focusLost[id] = 0;
          // GH-707: an accepted fire order takes a medic off his automatic job (the generic
          // reset above skips `attack`, so a refused id keeps his).
          if (this.woundLive && this.unitTypes[this.typeIdx[id]].rescue !== null) {
            this.medState[id] = MED_IDLE;
            this.medTarget[id] = -1;
            this.medTimer[id] = 0;
          }
          // What every order clears. NOT `leaveStructure`: a garrisoned
          // shooter fires on its focus from the window and is never walked
          // out by it (#577's direction -- an order must not empty a building
          // by accident).
          this.wpCount[id] = 0;
          this.boardGoal[id] = -1;
          this.garrisonGoal[id] = -1;
          this.demolishOrder[id] = -1;
          this.chargeOrder[id] = -1;
          this.chargeTicks[id] = 0;
          // The unit stops being an attack-mover and stops walking the leg it
          // was on, as `halt` does: nothing reads the focus yet, so leaving
          // `moving` set would keep an old leg running under an order that
          // supersedes it. Whatever movement the focus needs is stepFocus's.
          this.moving[id] = 0;
          this.fieldRef[id] = -1;
          this.attackMove[id] = 0;
          this.sweepOrder[id] = 0;
          this.engaging[id] = 0;
          this.stance[id] = 0; // any order overrides a held stance
        }
      } else if (cmd.kind === 'rescue') {
        // GH-707 Task 5. Like `attack`: BEFORE the bare halt `else`, and a refused id changes
        // nothing (the generic focus release above skips this kind).
        for (const id of cmd.ids) {
          if (!this.rescueGate(id, cmd.target)) continue;
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.focusTarget[id] = -1;
          this.focusLost[id] = 0;
          this.wpCount[id] = 0;
          this.boardGoal[id] = -1;
          this.garrisonGoal[id] = -1;
          this.demolishOrder[id] = -1;
          this.chargeOrder[id] = -1;
          this.chargeTicks[id] = 0;
          // stepMedics, later this tick, walks him there (it owns his movement from now on).
          this.moving[id] = 0;
          this.fieldRef[id] = -1;
          this.attackMove[id] = 0;
          this.sweepOrder[id] = 0;
          this.engaging[id] = 0;
          this.stance[id] = 0;
          this.medState[id] = MED_TO_WOUNDED;
          this.medTarget[id] = cmd.target;
          this.medTimer[id] = 0;
        }
      } else if (cmd.kind === 'enterTunnel') {
        this.applyEnterTunnel(cmd.ids, cmd.tunnel);
      } else if (cmd.kind === 'vent') {
        this.applyVent(cmd.ids, cmd.mode);
      } else if (cmd.kind === 'construct') {
        this.applyConstruct(cmd.ids, cmd.structType, cmd.x, cmd.y);
      } else if (cmd.kind === 'cancelConstruct') {
        this.applyCancelConstruct(cmd.site);
      } else if (cmd.kind === 'setStance') {
        // N3 Task 9: a patrol of the wrong length is no order at all -- refused
        // whole, before any id is halted, so it changes nothing.
        if (cmd.stance === 'patrol' && (cmd.waypoints.length < 2 || cmd.waypoints.length > MAX_PATROL_WAYPOINTS)) continue;
        // Not a plain halt: it must skip garrisoned and carried ids, which halt would pull out of their post.
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue;
          if (this.garrisonedIn[id] >= 0 || this.carriedBy[id] >= 0) continue; // the building or the vehicle is the hold (D2)
          this.haltUnit(id);
          this.haltAir(id);
          if (cmd.stance === 'ambush') this.setAmbush(id, cmd.radius ?? AMBUSH_RADIUS_DEFAULT);
          else if (cmd.stance === 'patrol') this.setPatrol(id, cmd.waypoints);
        }
      } else if (cmd.kind === 'halt') {
        for (const id of cmd.ids) {
          if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
          this.haltUnit(id);
          this.haltAir(id);
        }
      } else {
        // Exhaustive over what `commandQueue` can hold: the seven RuntimeCommand kinds
        // are excluded from its type (`queueCommand` sets them aside for the
        // runtime, N2/F4), so they need no branch here and a new sim kind still
        // fails to compile until it gets one.
        const unhandled: never = cmd;
        void unhandled;
      }
    }
    this.commandQueue = [];
  }

  // ---------------------------------------------------------------- detection

  /** Actually displacing this tick — not merely under a move order. An
   *  attack-mover halted to fight counts as stationary for stance, target
   *  motion, and signature purposes. */
  private isEffectivelyMoving(i: number): boolean {
    // Deliberately NOT changed by halt to fire, and that was measured rather
    // than assumed. A man on one knee at a SHORT halt -- an attack-move bound,
    // nothing yet inside effective range -- keeps the values of a unit on the
    // move: GDD 5.2 names three shooter stances (stationary / short-halt /
    // moving) and the sim has always priced short-halt with the moving ones.
    // A man halted for good -- idle, or an attack-mover with a target inside
    // effective range (`engaging`) -- is stationary, as he always was. Making
    // every kneeling man stationary instead took the urban 2:1+smoke assault
    // from 67% to 18% (spec 2026-10-05-infantry-halt-to-fire §6): a bound
    // would then cost the attacker his moving-target protection and buy him
    // nothing, so halt to fire changes WHEN a man shoots and moves, never
    // how hard he is to hit.
    return this.moving[i] === 1 && !(this.attackMove[i] === 1 && this.engaging[i] === 1);
  }

  /** Smoke density crossed by a sight line (endpoints included).
   *  `lift0`/`lift1` raise an end's eye by whole elevation levels, as in
   *  `losRay`: a garrison's floors above the ground (`eyeLift`); 0 for
   *  everyone else, which is every existing caller, so this is bit-identical
   *  where nobody is garrisoned.
   *
   *  Elevation-aware, and it has to be: a screen is a column SMOKE_RISE levels
   *  tall standing on its OWN tile's ground, not an infinitely high curtain.
   *  Height-blind, this counted a plume pooled on a valley floor against a line
   *  passing six levels above it -- one of the three things the elevation
   *  milestone left inert while every shipped map was flat, and reachable the
   *  day Tel Marum authored relief.
   *
   *  The geometry is `losRay`'s, deliberately: same endpoints, same eye height
   *  at both ends, same cross-multiplied comparison so it stays in plain
   *  integers with no division and no fixed point (elevations are 0-9, maps are
   *  at most 128 across, so every term stays under about 1,400). The line's
   *  height at step k is `lineH / total`; the plume's top is
   *  `elevation + SMOKE_RISE`; smoke counts only where the second is above the
   *  first.
   *
   *  There is no lower bound to test. A line that passes BELOW a tile's ground
   *  has already been stopped by that tile in `losRay`, so anything that
   *  reaches this comparison is at or above the plume's base by construction.
   *
   *  On flat ground every elevation is 0 and the comparison reduces to
   *  `SMOKE_RISE > EYE_HEIGHT` at every step -- always true -- so this is
   *  bit-identical to the height-blind version on every map without relief.
   *  That equivalence is what SMOKE_RISE > EYE_HEIGHT buys, and why the
   *  constant carries the warning it does. */
  private raySmoke(x0: number, y0: number, x1: number, y1: number, lift0 = 0, lift1 = 0): number {
    const w = this.width;
    let dx = x1 - x0;
    let dy = y1 - y0;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;
    const total = dx > dy ? dx : dy;
    // Both endpoints on one tile: there is no line to pass over anything, and
    // the cross-multiply below would degenerate to `0 > 0`. A man standing in
    // his own screen is in it.
    if (total === 0) return this.smoke[y0 * w + x0];
    const h0 = this.elevation[y0 * w + x0] + EYE_HEIGHT + lift0;
    const h1 = this.elevation[y1 * w + x1] + EYE_HEIGHT + lift1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    let k = 0;
    let acc = 0;
    for (;;) {
      const t = y * w + x;
      const s = this.smoke[t];
      if (s !== 0 && (this.elevation[t] + SMOKE_RISE) * total > h0 * total + (h1 - h0) * k) {
        acc += s;
      }
      if (x === x1 && y === y1) return acc;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      k++;
    }
  }

  /** Elevation levels a unit's eye stands above its window tile's ground:
   *  its building's floors above the ground, 0 in the open (G3). */
  private eyeLift(i: number): number {
    const s = this.garrisonedIn[i];
    return s < 0 ? 0 : this.structureTypes[this.stTypeIdx[s]].floors - 1;
  }

  /** Field works: the live `aura` of the structure unit `i` is garrisoned in, or null. Live
   *  means complete (`stProgress === ONE`; a garrisoned unit's structure is alive) and owned
   *  by the occupant's own side, the area scope's owner rule: an enemy who walks into a
   *  captured outpost gets the building's window, not its owner's fittings. */
  private garrisonAura(i: number): StructureAura | null {
    const s = this.garrisonedIn[i];
    if (s < 0) return null;
    const a = this.structureTypes[this.stTypeIdx[s]].aura;
    if (a === null || this.stProgress[s] !== ONE) return null;
    const owner = this.stOwner[s];
    if ((owner !== 0 && owner !== 1) || owner !== this.side[i]) return null;
    return a;
  }

  /** Field works: the `aura.garrison.range_bonus` unit `i`'s weapon `w` adds ON TOP of
   *  GARRISON_RANGE_BONUS. Direct fire only: an indirect weapon (`isIndirect`) gets none (spec §3). */
  private auraRangeBonus(i: number, w: WeaponStats): Fx {
    if (w.isIndirect) return 0;
    const a = this.garrisonAura(i);
    return a === null ? 0 : a.rangeBonus;
  }

  /** `w`'s maximum range squared for unit `i`: longer from inside (ruling 4),
   *  longer again by a field work's range bonus. */
  private reachSq(i: number, w: WeaponStats): Fx {
    if (this.garrisonedIn[i] < 0) return w.rangeSq;
    const b = this.auraRangeBonus(i, w);
    if (b === 0) return w.garrisonRangeSq;
    const r = fx.add(fx.add(w.range, GARRISON_RANGE_BONUS), b);
    return fx.mul(r, r);
  }

  /** `w`'s effective range squared for unit `i`. */
  private effSq(i: number, w: WeaponStats): Fx {
    if (this.garrisonedIn[i] < 0) return w.effectiveRangeSq;
    const b = this.auraRangeBonus(i, w);
    if (b === 0) return w.garrisonEffRangeSq;
    const r = fx.add(w.garrisonEffRange, b);
    return fx.mul(r, r);
  }

  /** `w`'s effective range for unit `i`, the hit-falloff scale. */
  private effRange(i: number, w: WeaponStats): Fx {
    if (this.garrisonedIn[i] < 0) return w.effectiveRange;
    return fx.add(w.garrisonEffRange, this.auraRangeBonus(i, w));
  }

  /** Unit `i`'s sight squared: its type's, plus a field work's `sight_bonus` from inside. */
  private sightSqOf(i: number): Fx {
    const t = this.unitTypes[this.typeIdx[i]];
    const a = this.garrisonAura(i);
    if (a === null || a.sightBonus === 0) return t.sightSq;
    const r = fx.add(t.sight, a.sightBonus);
    return fx.mul(r, r);
  }

  /** A beam slot's state as the NEXT tick will see it, for tests and presentation. The tick
   *  keeps a dwell lazily (it continues only from the tick before), so a beam that was off
   *  target last tick reads target -1, dwell 0 here, and its heat net of the drain. `locked` is
   *  true while the next tick falls inside the lockout. Allocates; never called from the tick. */
  beamState(entity: number, slot = 0): { target: number; dwell: number; heat: number; locked: boolean; lockUntil: number } {
    const k = entity * 2 + slot;
    const at = this.beamAt[k];
    const on = at >= 0 && at === this.tickCount - 1;
    const drained = at >= 0 ? this.beamHeat[k] - (this.tickCount - 1 - at) : 0;
    return {
      target: on ? this.beamTgt[k] : -1,
      dwell: on ? this.beamDwell[k] : 0,
      heat: drained > 0 ? drained : 0,
      locked: this.tickCount < this.beamLock[k],
      lockUntil: this.beamLock[k],
    };
  }

  /** Smoke density on a tile, for tests and presentation. */
  smokeAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.smoke[y * this.width + x];
  }

  /** Bresenham over tiles: -1 if a blocked tile interrupts the ray, else the
   *  number of cover tiles crossed (endpoints excluded, capped at 8).
   *  `lift0`/`lift1` raise an end's eye by whole elevation levels: a garrison's
   *  floors above the ground (`eyeLift`); 0 for everyone else, which is every
   *  existing caller, so this is bit-identical where nobody is garrisoned. */
  private losRay(x0: number, y0: number, x1: number, y1: number, lift0 = 0, lift1 = 0): number {
    const w = this.width;
    // A building never blocks sight into or out of itself: men at the windows
    // can see and be seen. Only the structures at the ends of the ray are
    // transparent to it — everything between still blocks.
    const sFrom = this.structureOfTile[y0 * w + x0];
    const sTo = this.structureOfTile[y1 * w + x1];
    // A screen thick enough simply stops the sight line; thinner smoke
    // counts as obscuration below.
    const smoke = this.raySmoke(x0, y0, x1, y1, lift0, lift1);
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
    const h0 = this.elevation[y0 * w + x0] + EYE_HEIGHT + lift0;
    const h1 = this.elevation[y1 * w + x1] + EYE_HEIGHT + lift1;
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
    const oType = this.unitTypes[this.typeIdx[obs]];
    const oSide = this.side[obs];
    // The observer at its window (G1, B6): a garrisoned observer looks out of
    // the tile nearest the target. detectionFrom puts the target at ITS window.
    this.eyePoint(obs, this.posX[tgt], this.posY[tgt]);
    const visible = this.detectionFrom(this.eyeX, this.eyeY, this.sightSqOf(obs), oType.optics, this.eyeLift(obs), tgt);
    const confidence = this.contact[oSide * this.capacity + tgt];
    if (!visible) {
      return { visible: false, p: 0, strength: 0, signature: 0, occlusion: ONE, distSq: this.detDistSq, confidence };
    }
    return {
      visible: true,
      p: this.detP,
      strength: this.detStrength,
      signature: this.detSig,
      occlusion: this.detOccl,
      distSq: this.detDistSq,
      confidence,
    };
  }

  /**
   * One observation from an eye at (ox, oy) -- a unit's window, or a sensor structure's
   * centroid (field works, Task 7) -- of `tgt`. Returns whether the target
   * is visible; the roll's numbers land in the `det*` scratch fields (`detDistSq` always), so
   * the call allocates nothing. `lift` raises the observer's eye by whole elevation levels
   * (`eyeLift` for a unit; 0 for a structure, whose eye stands at ground level as route
   * spotting's does). Signature x strength x p, shared by unit detection, sensor structures
   * and the debug overlay.
   */
  private detectionFrom(ox: Fx, oy: Fx, sightSq: Fx, optics: Fx, lift: number, tgt: number): boolean {
    const tType = this.unitTypes[this.typeIdx[tgt]];
    // A garrisoned target is seen at the tile nearest the observer's own eye.
    this.eyePoint(tgt, ox, oy);
    const tx = this.eyeX;
    const ty = this.eyeY;
    const dSq = distSqFx(fx.sub(tx, ox), fx.sub(ty, oy));
    this.detDistSq = dSq;
    if (dSq > sightSq) return false;
    const cov = this.losRay(ox >> 16, oy >> 16, tx >> 16, ty >> 16, lift, this.eyeLift(tgt));
    if (cov < 0) return false;

    let sig = tType.signature;
    if (this.stance[tgt] === 1) sig = fx.mul(sig, AMBUSH_SIG);
    if (this.isEffectivelyMoving(tgt)) sig = fx.mul(sig, MOTION_SIG);
    if (this.tickCount - this.lastFired[tgt] < FIRING_SIG_TICKS) {
      sig = fx.mul(sig, tType.firingSigMult);
    }
    // A man at a window is as hard to pick out as a man in heavy cover: the
    // building's garrison cover, as for suppression (G2, ruling 2026-10-14).
    const gIn = this.garrisonedIn[tgt];
    const tCover =
      gIn >= 0
        ? this.structureTypes[this.stTypeIdx[gIn]].garrisonCover
        : this.cover[(this.posY[tgt] >> 16) * this.width + (this.posX[tgt] >> 16)];
    sig = fx.mul(sig, COVER_SIG[tCover]);

    const occl = fx.add(ONE, cov * OCCL_PER_COVER);
    const denom = fx.mul(fx.max(dSq, MIN_DETECT_DIST_SQ), occl);
    const strength = fx.div(fx.mul(optics, sig), denom);
    this.detP = fx.sub(ONE, fx.expNeg(fx.mul(K_DETECT, fx.mul(strength, DT))));
    this.detStrength = strength;
    this.detSig = sig;
    this.detOccl = occl;
    return true;
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
      observer: -1,
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

    const tx = this.posX[target];
    const ty = this.posY[target];
    this.eyePoint(shooter, tx, ty);
    const px = this.eyeX;
    const py = this.eyeY;
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const type = this.unitTypes[this.typeIdx[shooter]];

    let best: HitProjection = { kind: 'noSolution' };
    let bestP = -1;
    for (const w of type.weapons) {
      if (this.garrisonedIn[shooter] >= 0 && !w.firesFromBuilding) continue;
      if (dSq > this.reachSq(shooter, w) || this.minRangeBlocks(w, dSq, target)) continue;
      if (!w.isIndirect) {
        if (this.losRay(px >> 16, py >> 16, tx >> 16, ty >> 16, this.eyeLift(shooter), 0) < 0) continue;
      }
      const factors = this.hitFactors(shooter, w, target);
      if (factors.p <= bestP) continue;
      bestP = factors.p;
      best = {
        kind: 'shot',
        weaponId: w.id,
        pHit: factors.p,
        // selectTarget's own rule, through the same function: the real
        // penetration chance against the face the target shows this shooter.
        hurts: this.weaponHurts(w, target, px, py),
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
        } else if (this.surfaceTicks[i] === 0 && this.raidHasNoTarget(i)) {
          // GH-681: a seat's raid with nothing to shoot ends with its window.
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
        if (this.volleyLeft[i] > 0 && !this.raidHasNoTarget(i)) continue;
        this.submerge(i);
        continue;
      }

      const r = this.tunnelIn[i];
      if (r < 0) continue;
      // GH-681: a unit crawling from the mouth is not at the vent yet. It
      // neither surfaces by itself nor can be vented until it arrives.
      if (this.tunnelEta[i] > 0) {
        this.tunnelEta[i]--;
        continue;
      }
      if (this.tnAlive[r] === 0 || this.tnVentOpen[r] === 0) continue;
      // GH-681 (T-R2): nothing on a human-held side comes up by itself; its
      // seat brings it up with `vent`. The authored enemy of a single-player
      // mission is not human-held and surfaces exactly as it always has.
      if (this.isHumanHeld(this.side[i])) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      if (type.weapons.length === 0) continue;
      const [vx, vy] = this.surfacePoint(r);
      if (!this.hasTargetFrom(i, vx, vy)) continue;
      this.surfaceAt(i, r, vx, vy, true);
    }
  }

  /** Where a unit coming up route `r` stands: the vent's tile centre, or --
   *  Field works (Q7) -- beside a standing structure raised over the vent (a
   *  work raised over an unidentified route; refusing that footprint would
   *  leak the route), at its exitTile, never inside it. */
  private surfacePoint(r: number): [Fx, Fx] {
    const [vx, vy] = this.ventPos(r);
    const vs = this.structureOfTile[(vy >> 16) * this.width + (vx >> 16)];
    if (vs >= 0 && this.stAlive[vs] === 1) return this.exitTile(vs);
    return [vx, vy];
  }

  /** Bring buried unit `i` up route `r` at (vx, vy). `raid` arms the exposure
   *  window and the volley and keeps `homeTunnel`, so `stepSurfacing` takes it
   *  back down; otherwise (GH-681's `exit`) it is an ordinary surface unit. */
  private surfaceAt(i: number, r: number, vx: Fx, vy: Fx, raid: boolean): void {
    this.tunnelIn[i] = -1;
    this.tnOccupants[r]--;
    this.posX[i] = vx;
    this.posY[i] = vy;
    if (raid) {
      this.homeTunnel[i] = r;
      this.surfaceTicks[i] = SURFACE_SECONDS * TICKS_PER_SECOND;
      this.volleyLeft[i] = SURFACE_VOLLEY;
    }
    // Out of the shaft low and ready: the guaranteed window is the
    // player's answer to this mechanic, and a drop would spend it.
    this.braceDown(i);
    this.pendingEvents.push({ kind: 'surfaced', tick: this.tickCount, entity: i, tunnel: r });
  }

  /** GH-681: true for a raid on a HUMAN-HELD side that has nothing left to
   *  shoot at from where it stands (`hasTargetFrom`'s geometry: effective
   *  range and a sight line, no detection). A seat vents on order, target or
   *  not, so its raid can come up to an empty field, or see its target leave;
   *  the scripted hold (window AND volley) would then keep it up for good. A
   *  target still there keeps the hold: detection takes time, and the volley
   *  is the exposure the KDF is owed. Always false for a scripted side, whose
   *  surfacing is exactly what it was. */
  private raidHasNoTarget(i: number): boolean {
    if (!this.isHumanHeld(this.side[i])) return false;
    if (this.unitTypes[this.typeIdx[i]].weapons.length === 0) return true;
    return !this.hasTargetFrom(i, this.posX[i], this.posY[i]);
  }

  /** GH-681: a raiding unit stays up for good -- the `exit` state. */
  private endRaid(i: number): void {
    this.homeTunnel[i] = -1;
    this.surfaceTicks[i] = 0;
    this.volleyLeft[i] = 0;
  }

  /** GH-681: `enterTunnel`. Each id that qualifies walks to the nearer end of
   *  route `r`; `stepTunnelEntry` takes it below on arrival. */
  private applyEnterTunnel(ids: readonly number[], r: number): void {
    if (r < 0 || r >= this.tunnelCount_ || this.tnAlive[r] === 0 || this.tnVentOpen[r] === 0) return;
    const owner = this.tnOwner[r];
    if (owner < 0) return;
    const [mx, my] = this.mouthPos(r);
    const [vx, vy] = this.ventPos(r);
    for (const id of ids) {
      if (this.alive[id] === 0 || this.routed[id] === 1) continue;
      if (this.side[id] !== owner) continue;
      if (this.carriedBy[id] >= 0) continue;
      const type = this.unitTypes[this.typeIdx[id]];
      // Foot only: the vehicle predicate the boulder rule already uses.
      if (type.isAir || type.wheeled) continue;
      this.tnOrderLive = true;
      if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
      const mdx = fx.sub(mx, this.posX[id]);
      const mdy = fx.sub(my, this.posY[id]);
      const vdx = fx.sub(vx, this.posX[id]);
      const vdy = fx.sub(vy, this.posY[id]);
      const toMouth = fx.add(fx.mul(mdx, mdx), fx.mul(mdy, mdy));
      const toVent = fx.add(fx.mul(vdx, vdx), fx.mul(vdy, vdy));
      // Ties go to the mouth: the end a route is entered by.
      const atVent = toVent < toMouth;
      this.tunnelGoal[id] = atVent ? -(r + 2) : r;
      const ex = atVent ? vx : mx;
      const ey = atVent ? vy : my;
      const d = this.domainOf(id);
      const [gtx, gty] = this.nearestOpenTile(fx.toInt(ex), fx.toInt(ey), this.maskFor(d));
      this.wpCount[id] = 0;
      this.boardGoal[id] = -1;
      this.garrisonGoal[id] = -1;
      this.demolishOrder[id] = -1;
      this.demoTicks[id] = 0;
      this.demoTarget[id] = -1;
      this.chargeOrder[id] = -1;
      this.chargeTicks[id] = 0;
      this.goalX[id] = fx.add(fx.fromInt(gtx), HALF);
      this.goalY[id] = fx.add(fx.fromInt(gty), HALF);
      this.fieldRef[id] = this.fieldFor(gtx, gty, d);
      this.moving[id] = 1;
      this.attackMove[id] = 0;
      this.sweepOrder[id] = 0;
      this.engaging[id] = 0;
      this.stance[id] = 0;
    }
  }

  /** GH-681: `vent`. Each buried id that has reached an open vent comes up,
   *  target or not; one still crawling is refused (Q6). */
  private applyVent(ids: readonly number[], mode: 'raid' | 'exit'): void {
    for (const id of ids) {
      if (this.alive[id] === 0) continue;
      // A seat's order: a side nobody holds (the scripted enemy) surfaces by
      // its own rule only, whatever reaches the queue.
      if (!this.isHumanHeld(this.side[id])) continue;
      // GH-707: `vent` skips the containment filter, so it must also refuse a
      // wounded man itself -- he takes no order (a raider shot down stays down).
      if (this.woundState[id] !== WOUND_NONE) continue;
      const r = this.tunnelIn[id];
      // `exit` to a raider already up keeps it up for good, as any other order does.
      if (r < 0 && mode === 'exit' && this.homeTunnel[id] >= 0) {
        this.endRaid(id);
        continue;
      }
      if (r < 0 || this.tunnelEta[id] > 0) continue;
      if (this.tnAlive[r] === 0 || this.tnVentOpen[r] === 0) continue;
      this.tnOrderLive = true;
      const [px, py] = this.surfacePoint(r);
      this.surfaceAt(id, r, px, py, mode === 'raid');
    }
  }

  /** GH-681: take a unit walking under `enterTunnel` below once it reaches its
   *  route end. Skipped outright until the first tunnel order. */
  private stepTunnelEntry(): void {
    if (!this.tnOrderLive) return;
    for (let i = 0; i < this.count; i++) {
      const g = this.tunnelGoal[i];
      if (g === -1) continue;
      const atVent = g < -1;
      const r = atVent ? -g - 2 : g;
      if (
        this.alive[i] === 0 ||
        this.routed[i] === 1 ||
        this.tunnelIn[i] >= 0 ||
        this.carriedBy[i] >= 0 ||
        this.garrisonedIn[i] >= 0 ||
        this.tnAlive[r] === 0 ||
        this.tnVentOpen[r] === 0
      ) {
        this.tunnelGoal[i] = -1;
        continue;
      }
      const [ex, ey] = atVent ? this.ventPos(r) : this.mouthPos(r);
      const dx = fx.sub(ex, this.posX[i]);
      const dy = fx.sub(ey, this.posY[i]);
      const nearEnd = fx.add(fx.mul(dx, dx), fx.mul(dy, dy)) <= TUNNEL_ENTER_RANGE_SQ;
      // An end on blocked ground was snapped to the nearest open tile: having
      // stopped there counts as arrival, the way a door does for garrison.
      const gx = fx.sub(this.goalX[i], this.posX[i]);
      const gy = fx.sub(this.goalY[i], this.posY[i]);
      const atGoal = this.moving[i] === 0 && fx.add(fx.mul(gx, gx), fx.mul(gy, gy)) <= TUNNEL_ENTER_RANGE_SQ;
      if (!nearEnd && !atGoal) continue;
      this.tunnelGoal[i] = -1;
      if (this.tnOccupants[r] >= this.tnCapacity[r]) {
        // Full (Q4): the order is refused at the end; the unit stops there.
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      this.putInTunnel(i, r);
      this.tunnelEta[i] = atVent ? 0 : this.tnTravelTicks[r];
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
    this.bestObserver.fill(-1);
    this.bestObserverP.fill(0);
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
        if (d.p > this.bestObserverP[k]) {
          this.bestObserverP[k] = d.p;
          this.bestObserver[k] = obs;
        }
        this.lastSeenX[k] = this.posX[tgt];
        this.lastSeenY[k] = this.posY[tgt];
        this.lastSeenValid[k] = 1;
        const c = this.contact[k];
        this.contact[k] = fx.add(c, fx.mul(fx.sub(ONE, c), d.p));
      }
    }
    if (this.fwLive) this.sensorObservations();
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
          this.pushContact(s, tgt, 'identified', c, k);
        } else if (st < 1 && c >= SUSPECTED_AT) {
          this.contactState[k] = 1;
          this.pushContact(s, tgt, 'suspected', c, k);
        } else if (st > 0 && c < LOST_AT) {
          this.contactState[k] = 0;
          this.pushContact(s, tgt, 'lost', c, k);
        }
      }
    }
    // Field works: the routes each side's complete sensor structures hold this
    // tick, one OR per structure (stRouteMask is cached geometry). 0 unless fwLive.
    let sensed0 = 0;
    let sensed1 = 0;
    if (this.fwLive && this.tunnelCount_ > 0) {
      for (let st = 0; st < this.structureCount_; st++) {
        const owner = this.sensorOwner(st);
        if (owner === 0) sensed0 |= this.stRouteMask[st];
        else if (owner === 1) sensed1 |= this.stRouteMask[st];
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
        // A sensor structure holds the route identified while it stands --
        // held, not latched: once it falls the bit is gone and the contact
        // decays down the ladder below, as a departed mark_tunnel carrier's does.
        if ((((s === 0 ? sensed0 : sensed1) >> r) & 1) !== 0) {
          this.identifyTunnelTo(s, r, -1, this.tnContactState[k] !== 2 ? this.sensorHoldingRoute(s, r) : -1);
          continue;
        }
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
        const marker = this.markerSeeingRoute(s, r);
        if (marker >= 0) {
          this.identifyTunnelTo(s, r, marker);
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
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'identified', observer: -1 });
        } else if (st < 1 && c >= SUSPECTED_AT) {
          this.tnContactState[k] = 1;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'suspected', observer: -1 });
        } else if (st > 0 && c < LOST_AT) {
          this.tnContactState[k] = 0;
          this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side: s, tunnel: r, level: 'lost', observer: -1 });
        }
      }
    }
    if (this.fwLive) this.latchOwnedStructures();
  }

  /**
   * Field works (#277): the owned-structure identification latch. For every
   * living OWNED structure (owner 0 or 1) the other side has not yet seen, set
   * `stKnown[other * MAX_STRUCTURES + s]` the first tick a living unit of that
   * side has a sight line to one of its footprint tiles inside its own sight.
   * Neutral structures (-1) never latch, and a set latch is never cleared.
   *
   * The sight test is detectionPair's: the observer at its window (`eyePoint`,
   * lifted by its floors, `eyeLift`), squared distance to the tile centre
   * against `sightSq`, and `losRay` with the structure at the ray's END, which
   * losRay treats as transparent, so the building's own tiles never hide it.
   * No probability roll: a building is not a man in cover -- seen is seen.
   * Observers are filtered as stepDetection's are (alive, side 0/1, not
   * underground). Runs only while `fwLive` (an owned structure implies it), so
   * a world with no owned structure pays nothing; allocates nothing.
   */
  private latchOwnedStructures(): void {
    const w = this.width;
    for (let s = 0; s < this.structureCount_; s++) {
      if (this.stAlive[s] === 0) continue;
      const owner = this.stOwner[s];
      if (owner !== 0 && owner !== 1) continue;
      const other = 1 - owner;
      const k = other * MAX_STRUCTURES + s;
      if (this.stKnown[k] !== 0) continue;
      const tiles = this.stTiles[s];
      let seen = false;
      for (let obs = 0; obs < this.count && !seen; obs++) {
        if (this.alive[obs] === 0 || this.side[obs] !== other) continue;
        if (this.tunnelIn[obs] >= 0) continue;
        const sightSq = this.sightSqOf(obs);
        this.eyePoint(obs, this.stCx[s], this.stCy[s]);
        const ox = this.eyeX;
        const oy = this.eyeY;
        const lift = this.eyeLift(obs);
        for (let j = 0; j < tiles.length; j++) {
          const t = tiles[j];
          const tx = t % w;
          const ty = (t - tx) / w;
          const dSq = distSqFx(fx.sub(fx.add(fx.fromInt(tx), HALF), ox), fx.sub(fx.add(fx.fromInt(ty), HALF), oy));
          if (dSq > sightSq) continue;
          if (this.losRay(ox >> 16, oy >> 16, tx, ty, lift, 0) < 0) continue;
          seen = true;
          break;
        }
      }
      if (seen) this.stKnown[k] = 1;
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
   *  shape as trailStrengthFor above, and like it allocates nothing. Returns
   *  the carrier's entity id, or -1 when none sees it — callers that only
   *  need the boolean fact use `>= 0`. */
  private markerSeeingRoute(side: number, r: number): number {
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
          return i;
        }
      }
    }
    return -1;
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
   *  read the ROUTE, not just its dirt (markerSeeingRoute's per-unit
   *  filters). The renderer draws the identified line with it, so the line
   *  lights up around a sweeping drone or Yahalom and fades behind them —
   *  only a detector tells you what the dirt means. Pure read
   *  (invariant 4). */
  markerSeesTile(side: number, tx: number, ty: number): boolean {
    return this.seesTile(side, tx, ty, true);
  }

  /** Shared body of the two tile-sight reads above. Round sight rather
   *  than trailStrengthFor's square scan window, and no MIN_DETECT floor,
   *  both per markerSeeingRoute's own reasoning: the floor exists to cap a
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
  identifyTunnelTo(side: number, r: number, observer = -1, observerStructure = -1): void {
    const k = side * MAX_TUNNELS + r;
    this.tnContact[k] = ONE;
    if (this.tnContactState[k] !== 2) {
      this.tnContactState[k] = 2;
      if (observerStructure >= 0) {
        this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side, tunnel: r, level: 'identified', observer, observerStructure });
      } else {
        this.pendingEvents.push({ kind: 'tunnelContact', tick: this.tickCount, side, tunnel: r, level: 'identified', observer });
      }
    }
  }

  /** Field works: the side a structure observes for as a sensor this tick -- its owner (0/1)
   *  when it is alive, complete and has an `aura.sensor` -- else -1. */
  private sensorOwner(st: number): number {
    if (this.stAlive[st] === 0 || this.stProgress[st] !== ONE) return -1;
    const owner = this.stOwner[st];
    if (owner !== 0 && owner !== 1) return -1;
    const a = this.structureTypes[this.stTypeIdx[st]].aura;
    return a === null || a.sensor === null ? -1 : owner;
  }

  /** The lowest-id live sensor structure of `side` holding route `r`, -1 none. Only asked on
   *  the tick a route turns identified, for the event's label. */
  private sensorHoldingRoute(side: number, r: number): number {
    for (let st = 0; st < this.structureCount_; st++) {
      if (this.sensorOwner(st) === side && ((this.stRouteMask[st] >> r) & 1) !== 0) return st;
    }
    return -1;
  }

  /** Push a unit-contact transition. The structure label rides only on a structure-sourced
   *  observation (`bestObserver` -1 with a winning sensor), so every unit-sourced event keeps
   *  its exact shape. */
  private pushContact(side: number, target: number, level: ContactLevel, c: Fx, k: number): void {
    const observer = this.bestObserver[k];
    const st = observer === -1 && this.fwLive ? this.bestObserverStructure[k] : -1;
    if (st >= 0) {
      this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side, target, level, confidence: c, observer, observerStructure: st });
    } else {
      this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side, target, level, confidence: c, observer });
    }
  }

  /**
   * Field works (#277 Task 7): every complete, owned sensor structure observes as an eye of
   * its owner's side, feeding the same contact arrays the unit loop does (spec §3, "Intel
   * centre"). The eye is the centroid at ground level -- route spotting's rule -- with the
   * type's sight and optics, through `detectionFrom`, the unit path's own roll. A structure
   * that wins a (side, target) pair sets `bestObserver` to -1 and labels the pair in
   * `bestObserverStructure`. Targets are filtered exactly as the unit loop's (alive, other
   * side, not underground). Called only while `fwLive`; allocates nothing.
   */
  private sensorObservations(): void {
    const cap = this.capacity;
    this.bestObserverStructure.fill(-1);
    for (let st = 0; st < this.structureCount_; st++) {
      const owner = this.sensorOwner(st);
      if (owner < 0) continue;
      const a = this.structureTypes[this.stTypeIdx[st]].aura;
      const sensor = a === null ? null : a.sensor;
      if (sensor === null) continue;
      const ox = this.stCx[st];
      const oy = this.stCy[st];
      for (let tgt = 0; tgt < this.count; tgt++) {
        if (this.alive[tgt] === 0 || this.side[tgt] === owner) continue;
        if (this.tunnelIn[tgt] >= 0) continue;
        if (!this.detectionFrom(ox, oy, sensor.sightSq, sensor.optics, 0, tgt)) continue;
        const k = owner * cap + tgt;
        this.seenThisTick[k] = 1;
        const p = this.detP;
        if (p > this.bestObserverP[k]) {
          this.bestObserverP[k] = p;
          this.bestObserver[k] = -1;
          this.bestObserverStructure[k] = st;
        }
        this.lastSeenX[k] = this.posX[tgt];
        this.lastSeenY[k] = this.posY[tgt];
        this.lastSeenValid[k] = 1;
        const c = this.contact[k];
        this.contact[k] = fx.add(c, fx.mul(fx.sub(ONE, c), p));
      }
    }
  }

  // ------------------------------------------------------------------- combat

  /** Which arc the last `presentedArmor` call resolved: an index into
   *  FACING_ARCS (0 front, 1 side, 2 rear). Scratch, read straight after the
   *  call that wrote it — a number rather than a returned pair, so the hot
   *  path allocates nothing. Never hashed, never read across ticks. */
  private presentedArc = 0;

  /**
   * The plate `target` presents to a round arriving from (ox, oy) — GDD 5.3:
   * the facing arc the incoming bearing falls in relative to the hull, the
   * obliquity bonus inside the front arc, and ERA against the shaped-charge
   * family. resolveHit reads it with the round's ORIGIN; target selection
   * and projectHit read it with the shooter's position now, so what a gunner
   * picks and what the round then meets are the same arithmetic.
   */
  private presentedArmor(target: number, ox: Fx, oy: Fx, cls: number): Fx {
    const tType = this.unitTypes[this.typeIdx[target]];
    const inc = fx.atan2(fx.sub(oy, this.posY[target]), fx.sub(ox, this.posX[target]));
    const rel = fx.abs(fx.angleDiff(inc, this.facing[target]));
    let armor: Fx;
    if (rel <= ARC_60) {
      this.presentedArc = 0;
      // Obliquity: rounds arriving off-axis inside the arc see thicker plate.
      armor = fx.mul(tType.armorFront, fx.add(ONE, fx.mul(OBLIQ_MAX, fx.div(rel, ARC_60))));
    } else if (rel >= ARC_120) {
      this.presentedArc = 2;
      armor = tType.armorRear;
    } else {
      this.presentedArc = 1;
      armor = tType.armorSide;
    }
    if (tType.era && (SHAPED_MASK & (1 << cls)) !== 0) {
      armor = fx.mul(armor, ERA_SHAPED_MULT);
    }
    return armor;
  }

  /**
   * Can weapon `w`, fired from (px, py), hurt entity `t`? The ONE rule both
   * selectTarget and projectHit use. A soft target: always. An armoured one:
   * only when the real P(penetration) — penZ over the plate presentedArmor
   * says it shows that bearing, the curve resolveHit rolls — reaches
   * PEN_HURTS_MIN. It used to be "pen >= a quarter of side armour, whatever
   * the facing", which let a 30 mm (pen 120) count a Lavi (side 300) as
   * hurtable at a real chance of 0 front and side, 0.02 rear.
   */
  private weaponHurts(w: WeaponStats, t: number, px: Fx, py: Fx): boolean {
    if (this.unitTypes[this.typeIdx[t]].isSoft) return true;
    return fx.normCdf(penZ(w.penetration, this.presentedArmor(t, px, py, w.cls))) >= PEN_HURTS_MIN;
  }

  /** The squared distance the last `engageable` call measured, valid only
   *  when it returned true. Scratch, read straight after the call that wrote
   *  it -- a field rather than a returned pair, so the hot scan allocates
   *  nothing (the `presentedArc` idiom). Never hashed, never read across
   *  ticks. */
  private engageDSq = 0;
  /** Where the last `engageable` call measured from (the shooter, or its
   *  window), valid only when it returned true. Scratch like engageDSq. */
  private engageOX: Fx = 0;
  private engageOY: Fx = 0;

  /**
   * May weapon `w` of `shooter` take `t` as its target THIS tick, measured
   * from `eyePoint`? selectTarget's whole per-candidate filter,
   * in its own order, and the ONE copy of it: the scan, the ordered-focus
   * preference (GH-420, R-2) and stepFocus's reach test (R-3) all ask here,
   * so what a slot may shoot and what an order may prefer cannot drift.
   * Writes `engageDSq`, `engageOX` and `engageOY` when it returns true.
   * Penetration is NOT part of it:
   * the scan ranks an unhurtable target as a last resort rather than
   * excluding it, and the focus paths add `weaponHurts` themselves.
   */
  private engageable(shooter: number, w: WeaponStats, t: number): boolean {
    const sSide = this.side[shooter];
    // Civilians (side 2) are never targets — collateral comes from
    // ordnance, not aimpoints. That asymmetry is what ROE scores.
    if (this.alive[t] === 0 || this.side[t] === sSide || this.side[t] > 1) return false;
    // GH-707: a wounded man is hors de combat -- nobody picks him (splash still finds him).
    if (this.woundLive && this.horsDeCombat(t)) return false;
    // Men inside a building cannot be shot at: the building is in the way,
    // and taking it down is the only way to reach them. A tunnel is the same
    // idea a third time — the earth is in the way, and Yahalom is the way in.
    if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) return false;
    if (this.contact[sSide * this.capacity + t] < IDENTIFIED_AT) return false;
    // A weapon that cannot elevate does not get to pick a target it could
    // never hit. Filtered here rather than at the hit roll so the shooter
    // keeps looking and engages something it *can* hurt, instead of locking
    // on to an aircraft and firing into the sky for the rest of the fight.
    if (this.isAirborne(t) ? !w.canTargetAir : !w.canTargetGround) return false;
    // From the window, for a man inside (G1).
    this.eyePoint(shooter, this.posX[t], this.posY[t]);
    const px = this.eyeX;
    const py = this.eyeY;
    const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
    if (dSq > this.reachSq(shooter, w) || this.minRangeBlocks(w, dSq, t)) return false;
    if (!w.isIndirect) {
      if (this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16, this.eyeLift(shooter), 0) < 0) return false;
    }
    // A beam needs its OWN clear line (E6 GH-274 item 3): any smoke on it blocks, thin or
    // thick, however well another unit's identification has the target. losRay only refuses a
    // screen thick enough to stop sight; this refuses the thinnest wisp. Here, in the one copy
    // of the filter, so the scan, an ordered focus and stepFocus's reach all agree.
    if (
      w.beam !== null &&
      this.raySmoke(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16, this.eyeLift(shooter), 0) > 0
    ) {
      return false;
    }
    this.engageDSq = dSq;
    this.engageOX = px;
    this.engageOY = py;
    return true;
  }

  private selectTarget(shooter: number, w: WeaponStats): number {
    // An ORDERED target first (GH-420, ruling R-2): the focus wins this slot
    // only if the slot could have picked it anyway AND can hurt it from here.
    // A slot that cannot -- a rifle at a tank's front, a gun that cannot
    // elevate at a helicopter, a target out of this slot's reach -- scans as
    // it always has, so the order never turns a weapon into a waste of
    // ammunition; the focus stays set and wins again the moment it can.
    const focus = this.focusTarget[shooter];
    if (focus >= 0 && this.engageable(shooter, w, focus) && this.weaponHurts(w, focus, this.engageOX, this.engageOY)) {
      return focus;
    }
    const antiArmor = (ANTI_ARMOR_MASK & (1 << w.cls)) !== 0;
    let best = -1;
    let bestHurts = false;
    // Ranked squared distance (see `rank` below), not always the raw one.
    let bestDistSq = 0x7fffffff;
    for (let t = 0; t < this.count; t++) {
      if (!this.engageable(shooter, w, t)) continue;
      const dSq = this.engageDSq;
      // "Can this weapon hurt that?" — the real penetration chance against the
      // face the target shows this shooter (weaponHurts). Suppressive fire at
      // armour it cannot defeat is a fallback, not a preference.
      const hurts = this.weaponHurts(w, t, this.engageOX, this.engageOY);
      // Nearest first — except that an anti-armour weapon counts a soft or
      // unarmed target as further off than it is, so a Spike spends its
      // missile on the tank and not the rifle squad beside it.
      let rank = dSq;
      if (antiArmor && hurts) {
        const tType = this.unitTypes[this.typeIdx[t]];
        if (tType.isSoft || tType.weapons.length === 0 || this.firepowerKilled[t] === 1) {
          rank = dSq * ANTI_ARMOR_SOFT_RANK_SQ;
        }
      }
      if (
        best === -1 ||
        (hurts && !bestHurts) ||
        (hurts === bestHurts && rank < bestDistSq)
      ) {
        best = t;
        bestHurts = hurts;
        bestDistSq = rank;
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
    let best = -1;
    let bestDistSq = 0x7fffffff;
    for (let s = 0; s < this.structureCount_; s++) {
      if (this.stAlive[s] === 0) continue;
      // Field works (#277): a structure the ENEMY owns is a target in its own
      // right, empty or not -- but only once this side has seen it (the
      // `stKnown` latch), so an unseen outpost stays hidden through recon.
      // Neutral (-1) structures never qualify: an empty house is still never
      // shot. An unowned or unlatched building falls through to the old rule.
      const owner = this.stOwner[s];
      const ownedHostile =
        (owner === 0 || owner === 1) && owner !== sSide && sSide <= 1 &&
        this.stKnown[sSide * MAX_STRUCTURES + s] !== 0;
      if (!ownedHostile && this.stOccupants[s] === 0) continue;
      // Protected sites are never engaged on a gunner's initiative.
      if (this.structureTypes[this.stTypeIdx[s]].roePenalty >= PROTECTED_ROE) continue;
      let hostileInside = ownedHostile;
      for (let t = 0; t < this.count && !hostileInside; t++) {
        if (this.alive[t] === 0 || this.garrisonedIn[t] !== s) continue;
        if (this.side[t] === sSide || this.side[t] > 1) continue;
        if (this.contact[sSide * cap + t] >= IDENTIFIED_AT) {
          hostileInside = true;
          break;
        }
      }
      if (!hostileInside) continue;
      // From the window toward that building, for a man inside (G1).
      this.eyePoint(shooter, this.stCx[s], this.stCy[s]);
      const px = this.eyeX;
      const py = this.eyeY;
      const dSq = this.structDistSq(s, px, py);
      if (dSq > this.reachSq(shooter, w) || dSq < w.minRangeSq || dSq >= bestDistSq) continue;
      if (!w.isIndirect) {
        const [tx, ty] = this.nearestStructTile(s, px, py);
        if (this.losRay(px >> 16, py >> 16, tx >> 16, ty >> 16, this.eyeLift(shooter), 0) < 0) continue;
      }
      best = s;
      bestDistSq = dSq;
    }
    return best;
  }

  /** True when a person holds `side` (the seat table). Side 2, and any number
   *  outside 0..2, is false. */
  isHumanHeld(side: number): boolean {
    return side >= 0 && side <= 2 && this.humanHeldBySide[side] === 1;
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
    // A side a person holds never cuts a wall by accident (single-player holds
    // side 0 only, today's rule; a versus room holds both, N2 spec §2.2). The
    // conditions below already spare a garrison holding its own compound, but a
    // unit ordered out through a gate on the far side satisfies every one of
    // them against its own wire, and there is no notion of who owns a structure
    // to appeal to. Breaching on our side is a decision, and there is a
    // `demolish` order to make it with.
    if (this.humanHeldBySide[this.side[i]] === 1) return -1;
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

  /**
   * Break and run (GDD 5.5a, "away from fire"). The direction, in order:
   *
   *  1. A side-0/1 unit: away from the nearest enemy its side holds at
   *     SUSPECTED_AT or better.
   *  2. A civilian (side 2): away from the nearest living side-0/1 unit, by
   *     ground truth. Civilians have no contact row; before GH-291 this same
   *     result came from reading `contact[2 * capacity + t]`, past the end of
   *     the array (`undefined < SUSPECTED_AT` is false), and it is kept byte
   *     for byte -- bar a map with no combatant alive, which now holds.
   *  3. A side-0/1 unit with no known threat: away from where the last
   *     HOSTILE suppression came from (`suppFrom*`).
   *  4. Otherwise, hold. The unit stays routed, standing, until it rallies.
   *
   * There is no default direction. Until GH-291 there was one, -x, and every
   * backtest puts side 1 in the east: a unit pinned by fire it could not see
   * ran west into the shooter's sight.
   */
  private startRout(i: number): void {
    // Broken troops drop their fire order, on either exit below (flee or
    // hold). Rally restores no order, so the focus is not coming back.
    this.focusTarget[i] = -1;
    this.focusLost[i] = 0;
    const mySide = this.side[i];
    let nx = 0;
    let ny = 0;
    let found = false;
    let bestSq = 0x7fffffff;
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === mySide || this.side[t] > 1) continue;
      if (mySide <= 1 && this.contact[mySide * this.capacity + t] < SUSPECTED_AT) continue;
      const dx = fx.sub(this.posX[i], this.posX[t]);
      const dy = fx.sub(this.posY[i], this.posY[t]);
      const dSq = distSqFx(dx, dy);
      if (dSq < bestSq) {
        bestSq = dSq;
        const d = fx.sqrt(fx.max(dSq, 1));
        nx = fx.div(dx, d);
        ny = fx.div(dy, d);
        found = true;
      }
    }
    if (!found && mySide <= 1 && this.suppFromSet[i] === 1) {
      const dx = fx.sub(this.posX[i], this.suppFromX[i]);
      const dy = fx.sub(this.posY[i], this.suppFromY[i]);
      const d = fx.sqrt(fx.max(distSqFx(dx, dy), 1));
      nx = fx.div(dx, d);
      ny = fx.div(dy, d);
      found = true;
    }
    if (!found) {
      // Nowhere to run from: hold. No goal is written; `moving` 0 is what
      // keeps it still. sweepOrder goes with attackMove, as in the flight
      // branch, so a wave unit that rallies here does not resume a sweep.
      this.moving[i] = 0;
      this.fieldRef[i] = -1;
      this.attackMove[i] = 0;
      this.sweepOrder[i] = 0;
      this.engaging[i] = 0;
      // N3 Task 9: a broken patroller keeps its beat and resumes it when it rallies.
      if (this.stance[i] !== STANCE_PATROL) this.stance[i] = 0;
      return;
    }
    const gx = fx.clamp(fx.add(this.posX[i], fx.mul(nx, ROUT_DISTANCE)), ONE, (this.width - 2) * ONE);
    const gy = fx.clamp(fx.add(this.posY[i], fx.mul(ny, ROUT_DISTANCE)), ONE, (this.height - 2) * ONE);
    this.goalX[i] = gx;
    this.goalY[i] = gy;
    this.fieldRef[i] = -1; // straight-line flight; the wall guard slides them
    this.moving[i] = 1;
    this.attackMove[i] = 0;
    this.sweepOrder[i] = 0;
    this.engaging[i] = 0;
    if (this.stance[i] !== STANCE_PATROL) this.stance[i] = 0; // N3 Task 9: as above
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
    this.braceWant.fill(0);
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

      // Halt to fire (spec 2026-10-05-infantry-halt-to-fire): a unit that
      // fires only from a halt does not fire at all unless it is down. Targets
      // are still SELECTED below exactly as before -- that is what decides
      // whether it wants to get down (`braceWant`, read by stepBrace) -- only
      // the trigger is withheld. Garrisoned and carried units are exempt: they
      // fight from a window or a firing port, not from the open.
      const holdFire =
        type.haltsToFire &&
        this.brace[i] !== BRACE_KNEELING &&
        this.garrisonedIn[i] < 0 &&
        this.carriedBy[i] < 0;
      let anyTarget = false;
      let breaching = false;

      // `engaging` (which halts an attack-mover) only latches once the primary
      // target is inside EFFECTIVE range — advancing units keep closing instead
      // of stalling at maximum range to plink. (Vehicles close under marching
      // fire; a unit that halts to fire closes with its weapon held.)
      let engagedClose = false;
      this.curStructure[i] = -1;
      const inside = this.garrisonedIn[i] >= 0;
      for (let slot = 0; slot < type.weapons.length && slot < 2; slot++) {
        const w = type.weapons[slot];
        // Indirect fire does not go out of a window (G4).
        if (inside && !w.firesFromBuilding) {
          if (slot === 0) this.curTarget[i] = -1;
          continue;
        }
        const target = this.selectTarget(i, w);
        if (slot === 0) this.curTarget[i] = target;
        if (target < 0) continue;
        anyTarget = true;
        // From the window, for a man inside (G1).
        this.eyePoint(i, this.posX[target], this.posY[target]);
        const ox = this.eyeX;
        const oy = this.eyeY;
        const dSq = distSqFx(fx.sub(this.posX[target], ox), fx.sub(this.posY[target], oy));
        if (dSq <= this.effSq(i, w)) engagedClose = true;

        // Hull turns toward the primary threat. Stationary, always; on the
        // move, only where facing cannot cost anything — see aimHullAt.
        if (slot === 0) {
          this.aimHullAt(i, fx.atan2(fx.sub(this.posY[target], oy), fx.sub(this.posX[target], ox)));
        }

        if (w.beam !== null) {
          // A beam keeps no rate of fire: dwell, heat and lockout are its clock.
          if (!holdFire) this.stepBeam(i, slot, w, w.beam, target);
          continue;
        }
        if (this.cooldown[i * 2 + slot] > 0 || holdFire) continue;
        this.fireAt(i, slot, w, target);
        if (this.alive[i] === 0) break; // E6: a swarm's last dive ends it; nothing further fires or is written
      }
      if (this.alive[i] === 0) continue;

      // Nothing in the open to shoot? Then the enemy is inside a building,
      // and the building becomes the target — if this weapon can hurt it.
      if (this.curTarget[i] < 0) {
        for (let slot = 0; slot < type.weapons.length && slot < 2; slot++) {
          const w = type.weapons[slot];
          if (STRUCT_DAMAGE[w.cls] === 0) continue;
          if (inside && !w.firesFromBuilding) continue;
          const s = this.selectStructureTarget(i, w);
          if (s < 0) continue;
          anyTarget = true;
          // Same test the unit path makes above, for the same reason: selection
          // reaches to MAXIMUM range, and latching `engaging` on selection stalls
          // an attack-mover the moment a garrisoned building comes into range at
          // all, to shell it from outside its own effective range. Measured to
          // the nearest footprint tile, which is what selectStructureTarget
          // ranged against.
          this.eyePoint(i, this.stCx[s], this.stCy[s]);
          const sox = this.eyeX;
          const soy = this.eyeY;
          if (this.structDistSq(s, sox, soy) <= this.effSq(i, w)) {
            engagedClose = true;
          }
          if (slot === 0) this.curStructure[i] = s;
          const [tx, ty] = this.nearestStructTile(s, sox, soy);
          if (slot === 0) {
            this.aimHullAt(i, fx.atan2(fx.sub(ty, soy), fx.sub(tx, sox)));
          }
          if (this.cooldown[i * 2 + slot] > 0 || holdFire) continue;
          this.fireAtStructure(i, slot, w, s, tx, ty);
          if (this.alive[i] === 0) break;
        }
      }
      if (this.alive[i] === 0) continue;

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
              if (inside && !w.firesFromBuilding) continue;
              const dSq = this.structDistSq(s, this.posX[i], this.posY[i]);
              if (dSq > this.reachSq(i, w) || dSq < w.minRangeSq) continue;
              engagedClose = true;
              breaching = true;
              if (slot === 0) this.curStructure[i] = s;
              if (slot === 0) {
                this.aimHullAt(i, fx.atan2(fx.sub(ty, this.posY[i]), fx.sub(tx, this.posX[i])));
              }
              if (this.cooldown[i * 2 + slot] > 0 || holdFire) continue;
              this.fireAtStructure(i, slot, w, s, tx, ty);
              if (this.alive[i] === 0) break;
            }
          }
        }
      }
      if (this.alive[i] === 0) continue;
      this.engaging[i] = engagedClose ? 1 : 0;

      // What stepBrace needs from this tick's target selection (spec §2):
      // bit 0 any target at all, bit 1 one inside effective range (the latch
      // that already halted attack-movers), bit 2 a wall in the way that this
      // unit is about to shoot (selectBreachTarget). Written for every unit
      // that halts to fire; stepBrace decides what it means for the order the
      // unit is under.
      if (type.haltsToFire) {
        this.braceWant[i] =
          (anyTarget ? BRACE_WANT_TARGET : 0) |
          (engagedClose ? BRACE_WANT_CLOSE : 0) |
          (breaching ? BRACE_WANT_BREACH : 0) |
          (this.curTarget[i] >= 0 && this.coverLevelOf(this.curTarget[i], i) === 0 ? BRACE_WANT_EXPOSED : 0);
      }
    }
  }

  /**
   * Halt to fire: move every unit that halts to fire one step through
   * NONE -> DROPPING -> KNEELING -> RISING -> NONE (spec
   * 2026-10-05-infantry-halt-to-fire §2). Runs right after stepCombat, which
   * wrote `braceWant` from this tick's target selection, and before
   * stepMovement, which refuses to move any unit not at BRACE_NONE.
   *
   * The two counters are asymmetric in code so that they are symmetric in
   * time. Firing happens in stepCombat, BEFORE this, so a drop that is to
   * allow its first shot KNEEL_DROP_TICKS ticks after the acquisition tick
   * must reach KNEELING at the end of tick T + KNEEL_DROP_TICKS - 1: it counts
   * the acquisition tick itself. Movement happens AFTER this, so a rise that
   * starts at T' must reach NONE in this step on tick T' + KNEEL_RISE_TICKS:
   * it does not count its first tick. Both are pinned by brace.test.ts.
   *
   * No RNG, no allocation, integers only.
   */
  private stepBrace(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue; // frozen at death
      const type = this.unitTypes[this.typeIdx[i]];
      if (!type.haltsToFire) continue;
      // Contained: no pose in the open. Held at NONE (braceClear already ran
      // at the moment of containment; this keeps it there).
      if (this.garrisonedIn[i] >= 0 || this.carriedBy[i] >= 0 || this.tunnelIn[i] >= 0) {
        if (this.brace[i] !== BRACE_NONE) this.braceClear(i);
        continue;
      }
      // Gone to ground (GDD 5.5) is flatter than kneeling: the machine
      // freezes, clock and all, neither dropping nor rising. A routed unit is
      // the exception, because routing is running: it gets up and goes.
      if (this.pinned[i] === 1 && this.routed[i] === 0) continue;

      const b = this.brace[i];
      const flags = this.braceWant[i];
      const close = (flags & (BRACE_WANT_CLOSE | BRACE_WANT_BREACH)) !== 0;
      // Should this man be down (or getting down) this tick?
      let down: boolean;
      if (this.routed[i] === 1) {
        down = false; // running for it
      } else if (this.moving[i] === 0) {
        // Not going anywhere -- halted, holding, arrived, working, watching:
        // a man who has stopped takes a knee, target or no target. This is
        // also what keeps a defender "set": he is already down when the
        // attacker comes into sight, and the attacker is the one who pays
        // the drop (measured, spec §6 -- without it a smoke screen lets a 1:1
        // assault carry, because the defender loses his first-shot edge).
        down = true;
      } else if ((flags & BRACE_WANT_BREACH) !== 0) {
        down = true; // stuck against a wall that is in the way: shoot it
      } else if (this.attackMove[i] === 0) {
        down = false; // a plain move runs through, holding its fire
      } else if ((flags & BRACE_WANT_CLOSE) !== 0) {
        down = true; // attack-move, a target inside effective range: stop and fight
      } else if ((flags & BRACE_WANT_TARGET) !== 0 && (flags & BRACE_WANT_EXPOSED) !== 0) {
        // Attack-move with a target only in the band between effective and
        // maximum range: advance by bounds. Halt and fire for
        // BOUND_FIRE_TICKS, then get up and move for BOUND_MOVE_TICKS, so the
        // approach still carries suppressive fire -- every round of it from a
        // knee -- without stalling at maximum range to plink.
        down =
          b === BRACE_NONE
            ? this.braceClock[i] >= BOUND_MOVE_TICKS
            : b === BRACE_DROPPING
              ? true
              : b === BRACE_KNEELING
                ? this.braceClock[i] < BOUND_FIRE_TICKS
                : false;
      } else {
        down = false; // nothing to shoot and somewhere to be
      }

      if (b === BRACE_NONE) {
        if (!down) {
          this.braceClock[i]++;
          continue;
        }
        this.brace[i] = BRACE_DROPPING;
        this.braceTicks[i] = KNEEL_DROP_TICKS;
        this.braceClock[i] = 0;
        this.countDownDrop(i);
      } else if (b === BRACE_DROPPING) {
        if (down) {
          this.countDownDrop(i);
        } else {
          // Half-way down and no longer wanted there: getting up takes as
          // long as getting down had, never more than a full rise.
          const done = KNEEL_DROP_TICKS - this.braceTicks[i];
          this.brace[i] = BRACE_RISING;
          this.braceTicks[i] = done < KNEEL_RISE_TICKS ? done : KNEEL_RISE_TICKS;
          this.braceClock[i] = 0;
          if (this.braceTicks[i] <= 0) this.braceClear(i);
        }
      } else if (b === BRACE_KNEELING) {
        // A man who fired this tick is still on his knee at the end of it:
        // the rise starts on the next. That keeps the renderer's contract
        // exact -- a bracer's `fire` event always comes with BRACE_KNEELING --
        // and costs the rise one tick only when it follows a shot.
        if (down || this.lastFired[i] === this.tickCount) {
          this.braceClock[i]++;
          continue;
        }
        this.brace[i] = BRACE_RISING;
        this.braceTicks[i] = KNEEL_RISE_TICKS;
        this.braceClock[i] = 0;
      } else {
        // RISING. Only a reason that does not depend on the bound pulls a
        // man back down mid-rise: a close target, a wall, or a halt.
        if (down && (close || this.moving[i] === 0)) {
          // Back down for as long as he had been rising, never more than a
          // full drop.
          const done = KNEEL_RISE_TICKS - this.braceTicks[i];
          this.brace[i] = BRACE_DROPPING;
          this.braceTicks[i] = done < 1 ? 1 : done < KNEEL_DROP_TICKS ? done : KNEEL_DROP_TICKS;
          this.braceClock[i] = 0;
          this.countDownDrop(i);
        } else if (--this.braceTicks[i] <= 0) {
          this.braceClear(i);
          // Up: he moves on this very tick (stepMovement runs next), so this
          // tick is the first of his bound.
          this.braceClock[i] = 1;
        }
      }
    }
  }

  /** One tick of a drop, counting the tick it is called on; KNEELING when it
   *  runs out. See stepBrace for why the drop counts its first tick. */
  private countDownDrop(i: number): void {
    if (--this.braceTicks[i] <= 0) {
      this.brace[i] = BRACE_KNEELING;
      this.braceTicks[i] = 0;
      this.braceClock[i] = 0;
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
    const tx = this.posX[target];
    const ty = this.posY[target];
    this.eyePoint(shooter, tx, ty);
    const px = this.eyeX;
    const py = this.eyeY;
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const dist = fx.sqrt(dSq);

    // GDD 5.2 — every factor is on the event for the overlay. Veterans shoot
    // straighter: the ledger's carry-over must be worth protecting.
    // A field work's accuracy_mult (spec §3) joins veterancy: 1.06 is one level up.
    let acc = fx.mul(w.accuracy, fx.add(ONE, this.veterancy[shooter] * VET_ACC_BONUS));
    const auraAcc = this.auraAccMult[shooter];
    if (auraAcc !== ONE) acc = fx.mul(acc, auraAcc);
    const accuracy = fx.min(acc, ONE);
    const ratio = fx.div(dist, this.effRange(shooter, w));
    const rangeFalloff = fx.expNeg(fx.mul(FALLOFF_SCALE[w.cls], fx.mul(ratio, ratio)));
    // Cover is the target's own tile, or the parapet he is fighting from
    // behind, whichever is better. Taking the max rather than stacking them
    // keeps the level inside 0-3, which is all three cover tables are indexed
    // for, and makes a wall irrelevant to a man already in heavy cover.
    const tileCover = this.cover[(ty >> 16) * this.width + (tx >> 16)];
    const parapet = this.parapetCover(tx, ty, px, py);
    let coverMod = COVER_HIT[parapet > tileCover ? parapet : tileCover];
    // A weapon that ignores part of the cover bonus (the grenadier's lobbed
    // round over a wall) closes that fraction of the gap to the open-ground 1.
    // Zero for every weapon that does not author it, so the line is exact.
    if (w.coverIgnore > 0) coverMod = fx.add(coverMod, fx.mul(fx.sub(ONE, coverMod), w.coverIgnore));
    // Shooting through a screen: every tile of it degrades the shot, with a
    // floor because blind fire still occasionally connects.
    const smokeOnLine = this.raySmoke(px >> 16, py >> 16, tx >> 16, ty >> 16, this.eyeLift(shooter), 0);
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
    const tx = this.posX[target];
    const ty = this.posY[target];
    this.eyePoint(shooter, tx, ty);
    const px = this.eyeX;
    const py = this.eyeY;
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
    this.swarmDive(shooter, slot, w); // E6: the diver is spent (no-op for every other unit)
  }

  /**
   * One tick of a beam on `target` (E6, GH-274 item 3). Called only while the slot has a
   * target its own sight line can reach, smoke-free (`engageable`); a tick on which it is not
   * called (no target, a switch, a lockout, pinned, down a tunnel) breaks the dwell, because the
   * dwell continues only from `beamAt === tickCount - 1` onto the same target.
   *
   * Heat is ticks of time on target, drained one per tick the beam was off, applied lazily from
   * the gap since `beamAt` so an idle unit costs nothing. `dwellTicks` of dwell deliver one hit
   * and the dwell starts over; `heatTicks` of heat lock the weapon out for `coolTicks`, then it
   * starts cool. All integers: no float, no division, no RNG except an armoured target's
   * penetration roll (the shooter's own stream, as any round).
   */
  private stepBeam(shooter: number, slot: number, w: WeaponStats, b: BeamStats, target: number): void {
    const k = shooter * 2 + slot;
    const now = this.tickCount;
    if (now < this.beamLock[k]) return; // locked out; the dwell is already zero
    this.beamLive = true;
    const last = this.beamAt[k];
    if (last >= 0 && now - 1 > last) {
      const heat = this.beamHeat[k] - (now - 1 - last);
      this.beamHeat[k] = heat > 0 ? heat : 0;
    }
    if (last !== now - 1 || this.beamTgt[k] !== target) this.beamDwell[k] = 0;
    this.beamTgt[k] = target;
    this.beamAt[k] = now;
    this.lastFired[shooter] = now; // a beam is a firing signature like any shot
    this.beamHeat[k]++;
    if (++this.beamDwell[k] >= b.dwellTicks) {
      this.beamDwell[k] = 0;
      this.beamStrike(shooter, w, target);
    }
    if (this.beamHeat[k] >= b.heatTicks) {
      this.beamHeat[k] = 0;
      this.beamDwell[k] = 0;
      this.beamTgt[k] = -1;
      this.beamLock[k] = now + 1 + b.coolTicks;
      this.pendingEvents.push({
        kind: 'beam', tick: now, shooter, target: -1, weaponId: w.id, phase: 'lockout', until: this.beamLock[k],
      });
    }
  }

  /** The beam's damage landing: at once, no projectile, accuracy ignored (it cannot miss a
   *  target it has dwelt on). A soft target takes the damage; an armoured one is rolled against
   *  its plate like any round, so pen 5 does nothing. */
  private beamStrike(shooter: number, w: WeaponStats, target: number): void {
    this.eyePoint(shooter, this.posX[target], this.posY[target]);
    const ox = this.eyeX;
    const oy = this.eyeY;
    this.pendingEvents.push({
      kind: 'beam', tick: this.tickCount, shooter, target, weaponId: w.id, phase: 'struck', until: 0,
    });
    if (this.unitTypes[this.typeIdx[target]].isSoft) {
      this.applyDamage(target, w.damage, shooter);
      return;
    }
    const armor = this.presentedArmor(target, ox, oy, w.cls);
    const z = penZ(w.penetration, armor);
    const roll = this.rng.nextU32(shooter) >>> 16;
    if (roll >= fx.normCdf(z)) return;
    this.applyDamage(target, w.damage, shooter);
    if (this.alive[target] === 1) this.rollComponent(target, shooter, z);
  }

  /**
   * Put a round into a building. A house does not dodge, so there is no
   * facing, no penetration curve and almost no miss — only the question of
   * whether the round is the sort that hurts masonry.
   */
  private fireAtStructure(shooter: number, slot: number, w: WeaponStats, s: number, tx: Fx, ty: Fx): void {
    this.eyePoint(shooter, tx, ty);
    const px = this.eyeX;
    const py = this.eyeY;
    const dist = fx.sqrt(distSqFx(fx.sub(tx, px), fx.sub(ty, py)));
    const ratio = fx.div(dist, this.effRange(shooter, w));
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
    this.swarmDive(shooter, slot, w); // E6: the diver is spent (no-op for every other unit)
  }

  // -------------------------------------------------------------- projectiles

  private weaponOf(pr: number): WeaponStats {
    const packed = this.prWeaponIdx[pr];
    const type = this.unitTypes[packed >> 1];
    return type.weapons[packed & 1];
  }

  /** The one smoke stamp: a SMOKE_RADIUS disc of SMOKE_MAX centred on the tile
   *  containing (`px`, `py`), and the `smokeLaid` event for it. The carrier's
   *  `smoke` command and a smoke-screen support round both land here, so a laid
   *  screen and a called one are the same grid by construction. Gating (the
   *  carrier's cooldown and range) stays with the caller. */
  private layScreen(px: Fx, py: Fx, by: number): void {
    const cx = px >> 16;
    const cy = py >> 16;
    for (let y = cy - SMOKE_RADIUS; y <= cy + SMOKE_RADIUS; y++) {
      for (let x = cx - SMOKE_RADIUS; x <= cx + SMOKE_RADIUS; x++) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        const ddx = x - cx;
        const ddy = y - cy;
        if (ddx * ddx + ddy * ddy > SMOKE_RADIUS * SMOKE_RADIUS) continue;
        this.smoke[y * this.width + x] = SMOKE_MAX;
      }
    }
    this.pendingEvents.push({ kind: 'smokeLaid', tick: this.tickCount, by, x: px, y: py });
  }

  /** Ordnance called in from off the map. Damage falls off with distance,
   *  buildings take structural damage, and everyone nearby is shaken —
   *  including civilians, which is what ROE will charge for. */
  private stepStrikes(): void {
    if (this.pendingStrikes.length === 0) return;
    const still: { x: Fx; y: Fx; by: number; readyTick: number; profile: number }[] = [];
    for (const s of this.pendingStrikes) {
      if (this.tickCount < s.readyTick) {
        still.push(s);
        continue;
      }
      const p = FIRE_SUPPORT[s.profile];
      // A profile outside the table cannot be queued (callStrike refuses it),
      // so this is a type-narrowing guard, not a path.
      if (p === undefined) continue;
      // A smoke round is not a strike: no `strike` event (the renderer draws an
      // air-strike burst for every one and the overlay logs PRECISION STRIKE),
      // no damage, no suppression. It lays the same disc a carrier's `smoke`
      // command does, and raises that command's `smokeLaid` (`by` the caller).
      if (p.payload === 'smoke') {
        this.layScreen(s.x, s.y, s.by);
        continue;
      }
      this.pendingEvents.push({ kind: 'strike', tick: this.tickCount, by: s.by, x: s.x, y: s.y, profile: s.profile });
      const splashSq = fx.mul(p.splash, p.splash);
      // `count` read once: a man this blast wounds (GH-707) is not hit by it again.
      const n = this.count;
      for (let i = 0; i < n; i++) {
        if (this.alive[i] === 0) continue;
        const dSq = distSqFx(fx.sub(this.posX[i], s.x), fx.sub(this.posY[i], s.y));
        if (dSq > splashSq) continue;
        const falloff = fx.sub(ONE, fx.div(fx.sqrt(dSq), p.splash));
        const stSwarm = this.unitTypes[this.typeIdx[i]].swarm;
        if (stSwarm !== null) this.swarmSplash(i, stSwarm, p.splash, p.damage, s.by); // E6: a called strike is a splash
        else this.applyDamage(i, fx.mul(p.damage, falloff), s.by);
        this.applySuppression(
          i,
          fx.mul(p.suppression, falloff),
          p.coverProtects,
          s.by >= 0 ? this.side[s.by] : -1,
          s.x,
          s.y,
        );
      }
      for (let st = 0; st < this.structureCount_; st++) {
        if (this.stAlive[st] === 0) continue;
        if (this.structDistSq(st, s.x, s.y) > splashSq) continue;
        this.damageStructure(st, fx.mul(p.damage, ONE + ONE), s.by);
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
    // E3: a submunition round does not strike; it bursts where it lands. Before
    // the APS block on purpose -- a carrier shell opens above the hull, and no
    // shipped interceptor class carries one -- and before the structure branch,
    // because bomblets do not bring a building down (they reach soft units only).
    const sub = this.weaponOf(pr).submunitions;
    if (sub !== null) {
      this.burstSubmunitions(pr, sub);
      return;
    }
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
      this.applySuppression(
        target,
        fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT),
        true,
        this.side[shooter],
        this.prOriginX[pr],
        this.prOriginY[pr],
        w.coverIgnore,
      );
      this.applyDamage(target, this.prDamage[pr], shooter);
      if (this.prSplash[pr] > 0) this.splashAt(pr, this.posX[target], this.posY[target], target);
      return;
    }

    // Facing (GDD 5.3): the plate the round meets, from where it was fired.
    const armor = this.presentedArmor(target, this.prOriginX[pr], this.prOriginY[pr], this.prCls[pr]);
    const arc = FACING_ARCS[this.presentedArc];

    const pen = this.prPen[pr];
    const z = penZ(pen, armor);
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
      // A clang on the hull is loud inside -- if it could have come through.
      // A round that never could (a rifle on an MBT) is noise, and takes the
      // HARMLESS_SUPP discount its near misses take in groundImpact, by the
      // same test: blast, or penetration up to the side armour (lead ruling,
      // 2026-10-13). Otherwise a rifle squad pins a tank by ringing its hull.
      const threatens = this.prSplash[pr] > 0 || pen >= tType.armorSide;
      // No cover_ignore here, deliberately: a bounce is armour shock, not a hit
      // on a man in cover.
      const bounce = fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT);
      this.applySuppression(
        target,
        threatens ? bounce : fx.mul(bounce, HARMLESS_SUPP),
        true,
        this.side[shooter],
        this.prOriginX[pr],
        this.prOriginY[pr],
      );
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

    // #706 §3.3: a sound GROUND hull on wheels only loses a wheel to its first
    // mobility hit -- slowed, still driving. A second one (or tracks, or a
    // combat_ineffective) leaves it stuck. Air keeps the stuck rule (Task 2).
    const tType = this.unitTypes[this.typeIdx[target]];
    if (
      result === 'mobility_kill' &&
      tType.partialMobility &&
      !tType.isAir &&
      this.mobilityDamaged[target] === 0 &&
      this.mobilityKilled[target] === 0
    ) {
      result = 'mobility_damaged';
    }

    this.pendingEvents.push({ kind: 'component', tick: this.tickCount, target, result, overmatch: z });

    switch (result) {
      case 'crew_shaken':
        this.applySuppression(target, CREW_SHAKEN_SUPP, false);
        break;
      case 'mobility_damaged':
        this.mobLive = true;
        this.mobilityDamaged[target] = 1;
        break;
      case 'mobility_kill':
        this.mobLive = true;
        // #706 §3.5: an aircraft brought down turns the air machine (and its
        // hash fold) on, so a world that never mobility-kills one is untouched.
        if (tType.isAir) this.airLive = true;
        this.mobilityKilled[target] = 1;
        this.fieldFixTicks[target] = 0;
        this.moving[target] = 0;
        this.fieldRef[target] = -1;
        break;
      case 'firepower_kill':
        this.firepowerKilled[target] = 1;
        break;
      case 'combat_ineffective':
        this.mobLive = true;
        if (tType.isAir) this.airLive = true; // #706 §3.5, as mobility_kill
        this.mobilityKilled[target] = 1;
        this.fieldFixTicks[target] = 0;
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
      const srcSide = this.side[this.prShooter[pr]];
      const pen = this.prPen[pr];
      const splash = this.prSplash[pr];
      const coverIgnore = this.weaponOf(pr).coverIgnore;
      for (let i = 0; i < this.count; i++) {
        if (this.alive[i] === 0) continue;
        const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
        if (dSq > NEAR_MISS_RADIUS_SQ) continue;
        const iType = this.unitTypes[this.typeIdx[i]];
        // Soft targets, blast weapons, and anything that could actually
        // punch the armour suppress fully; harmless small arms barely.
        const threatens = iType.isSoft || splash > 0 || pen >= iType.armorSide;
        this.applySuppression(
          i,
          threatens ? supp : fx.mul(supp, HARMLESS_SUPP),
          true,
          srcSide,
          this.prOriginX[pr],
          this.prOriginY[pr],
          coverIgnore,
        );
      }
    }
    if (this.prSplash[pr] > 0) this.splashAt(pr, x, y, -1);
  }

  /**
   * E3 (GH-709): the parent round opens over where it lands -- the target, if
   * it was a hit on a unit still alive, otherwise the aim point (a miss's
   * scatter point, or the building it was fired at) -- into `sub.count`
   * bomblets. Each is placed by two draws from the SHOOTER's own stream
   * (invariant 3), as a called strike places its rounds, and resolved in this
   * tick through `splashDirect`: soft units only, nobody underground, nobody
   * garrisoned or carried (applyDamage), no structure. Not the fire-support
   * resolver: that one damages armour and buildings alike.
   *
   * The parent round itself does nothing else: no hit or penetration roll, no
   * splash, no `nearMiss`. Its weapon's `damage` and `splash_tiles` are unread.
   */
  private burstSubmunitions(pr: number, sub: SubmunitionStats): void {
    this.prStructure[pr] = -1;
    const shooter = this.prShooter[pr];
    const target = this.prTarget[pr];
    let cx = this.prAimX[pr];
    let cy = this.prAimY[pr];
    if (target >= 0 && this.prWillHit[pr] === 1 && this.alive[target] === 1) {
      cx = this.posX[target];
      cy = this.posY[target];
    }
    const weaponId = this.weaponOf(pr).id;
    for (let k = 0; k < sub.count; k++) {
      const ang = this.rng.nextU32(shooter) & 0xffff;
      const rad = fx.mul(this.rng.nextU32(shooter) >>> 16, sub.scatter);
      const x = fx.add(cx, fx.mul(fx.cos(ang), rad));
      const y = fx.add(cy, fx.mul(fx.sin(ang), rad));
      this.pendingEvents.push({ kind: 'submunition', tick: this.tickCount, by: shooter, weaponId, x, y, index: k, count: sub.count });
      this.splashDirect(x, y, sub.splash, sub.damage, sub.supp, shooter, -1);
    }
  }

  private splashAt(pr: number, x: Fx, y: Fx, excludeId: number): void {
    const splash = this.prSplash[pr];
    const splashSq = fx.mul(splash, splash);
    const dmg = this.prDamage[pr];
    const shooter = this.prShooter[pr];
    const coverIgnore = this.weaponOf(pr).coverIgnore;
    // `count` read once: a man this blast wounds (GH-707) is not hit by it again.
    const n = this.count;
    for (let i = 0; i < n; i++) {
      if (this.alive[i] === 0 || i === excludeId) continue;
      if (this.tunnelIn[i] >= 0) continue; // three metres of earth
      const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
      if (dSq > splashSq) continue;
      const falloff = fx.sub(ONE, fx.div(fx.sqrt(dSq), splash));
      const scaled = fx.mul(dmg, falloff);
      const iType = this.unitTypes[this.typeIdx[i]];
      if (iType.swarm !== null) {
        // E6: a diver is not hurt by its own bomblet (it has already paid with the member).
        if (i !== shooter) this.swarmSplash(i, iType.swarm, splash, dmg, shooter);
      } else if (iType.isSoft) {
        this.applyDamage(i, scaled, shooter);
      }
      this.applySuppression(
        i,
        fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT),
        true,
        this.side[shooter],
        this.prOriginX[pr],
        this.prOriginY[pr],
        coverIgnore,
      );
    }
  }

  /** Splash from something that detonated in place rather than in flight. */
  private splashDirect(x: Fx, y: Fx, splash: Fx, dmg: Fx, supp: Fx, by: number, exclude: number): void {
    const splashSq = fx.mul(splash, splash);
    // The source: whoever set it off, where they stand -- or, with nobody to
    // credit, the blast point itself.
    const srcSide = by >= 0 ? this.side[by] : -1;
    const srcX = by >= 0 ? this.posX[by] : x;
    const srcY = by >= 0 ? this.posY[by] : y;
    // `count` read once: a man this blast wounds (GH-707) is not hit by it again.
    const n = this.count;
    for (let i = 0; i < n; i++) {
      if (this.alive[i] === 0 || i === exclude || i === by) continue;
      if (this.tunnelIn[i] >= 0) continue; // three metres of earth
      const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
      if (dSq > splashSq) continue;
      const falloff = fx.sub(ONE, fx.div(fx.sqrt(dSq), splash));
      const iType = this.unitTypes[this.typeIdx[i]];
      if (iType.swarm !== null) this.swarmSplash(i, iType.swarm, splash, dmg, by);
      else if (iType.isSoft) this.applyDamage(i, fx.mul(dmg, falloff), by);
      this.applySuppression(i, fx.mul(supp, BOUNCE_SUPP_MULT), true, srcSide, srcX, srcY);
    }
  }

  /** E6 (GH-274): live members of a swarm, `ceil(hp / member_hp)`; -1 for a unit that is not one.
   *  A read for tests and the later instanced drawing: nothing in the sim reads it back. */
  swarmMembers(id: number): number {
    const sw = this.unitTypes[this.typeIdx[id]].swarm;
    return sw === null ? -1 : this.swarmLive(id, sw);
  }

  /** E6: live members of a swarm, `ceil(hp / memberHp)` in raw Q16.16 integers (both are
   *  multiples of 1/65536, so the ratio is exact). 0 when hp <= 0. */
  private swarmLive(i: number, sw: SwarmStats): number {
    const hp = this.hp[i];
    return hp <= 0 ? 0 : ((hp + sw.memberHp - 1) / sw.memberHp) | 0;
  }

  /**
   * E6: a splash that reaches a swarm removes up to `ceil(live x min(1, splash / spread))`
   * members, wherever in the radius it lands (falloff scales damage, not a cloud's headcount).
   * A blast that deals no damage removes none. Hp drops to the new member boundary; none left
   * and the swarm is gone.
   */
  private swarmSplash(target: number, sw: SwarmStats, splash: Fx, dmg: Fx, by: number): void {
    if (dmg <= 0 || this.alive[target] === 0) return;
    if (this.garrisonedIn[target] >= 0 || this.carriedBy[target] >= 0 || this.tunnelIn[target] >= 0) return;
    const live = this.swarmLive(target, sw);
    const reach = fx.div(splash, sw.spread);
    const frac = reach > ONE ? ONE : reach;
    const gone = (live * frac + 65535) >> 16; // ceil, raw Q16.16
    const left = live - gone;
    this.lastDamagedTick[target] = this.tickCount;
    if (left <= 0) {
      this.hp[target] = 0;
      this.destroy(target, by);
      return;
    }
    const cap = left * sw.memberHp;
    if (this.hp[target] > cap) this.hp[target] = cap;
  }

  /**
   * E6: a swarm's shot is a dive, and the diver is spent. Called from the end of `fireAt` and
   * `fireAtStructure`, so the round is already in the air. The cooldown is the weapon's, scaled
   * by count / live members as the dive began (integer ceil), so full strength is the authored rate: a thinned cloud dives more slowly. The last
   * member's dive ends the swarm, credited to nobody.
   */
  private swarmDive(shooter: number, slot: number, w: WeaponStats): void {
    const sw = this.unitTypes[this.typeIdx[shooter]].swarm;
    if (sw === null) return;
    const live = this.swarmLive(shooter, sw);
    const left = live - 1;
    if (left <= 0) {
      this.hp[shooter] = 0;
      this.destroy(shooter, -1);
      return;
    }
    const cap = left * sw.memberHp;
    if (this.hp[shooter] > cap) this.hp[shooter] = cap;
    this.cooldown[shooter * 2 + slot] = ((w.ticksBetweenShots * sw.count + live - 1) / live) | 0; // x count / live: 1 at full strength
  }

  private applyDamage(target: number, dmg: Fx, by: number): void {
    if (dmg <= 0 || this.alive[target] === 0) return;
    // Inside a building or a vehicle, the hull takes it. Kill that first.
    // Underground there is no hull to kill: the earth itself is the armour,
    // and a tunnel collapse — which kills via destroy(), never through here —
    // is the only way ordnance gets to the occupants.
    if (this.garrisonedIn[target] >= 0 || this.carriedBy[target] >= 0 || this.tunnelIn[target] >= 0) return;
    const swarm = this.unitTypes[this.typeIdx[target]].swarm;
    if (swarm !== null) {
      // E6 swarm: a single-target hit removes AT MOST one member. Damage still wears down the
      // member it lands on (hp falls by dmg), but never past the next member down.
      const floor = (this.swarmLive(target, swarm) - 1) * swarm.memberHp;
      const left = fx.sub(this.hp[target], dmg);
      this.hp[target] = left < floor ? floor : left;
      this.lastDamagedTick[target] = this.tickCount;
      if (this.hp[target] <= 0) this.destroy(target, by);
      return;
    }
    this.hp[target] = fx.sub(this.hp[target], dmg);
    this.lastDamagedTick[target] = this.tickCount;
    // GH-707: a team that can lose men wounded sheds one at each share crossing. Only while
    // `woundLive` and only for a type with `hull.wounds` that is not already down itself, so
    // a world without wound content takes none of this (no rng draw, no state written).
    if (this.woundLive) {
      const w = this.unitTypes[this.typeIdx[target]].wounds;
      if (w !== null && this.woundState[target] === WOUND_NONE) {
        this.woundCrossings(target, by, w.inPlace);
        return;
      }
    }
    if (this.hp[target] <= 0) this.destroy(target, by);
  }

  /**
   * GH-707 Task 2, falling. `target` (a type with `hull.wounds`, not down) has just lost hp.
   * Every man above `figuresStanding` falls, one roll each (`fallMan`), down to ONE man: a
   * single hit from full to nothing (an ATGM on a 4-man squad) crosses every share in this one
   * call and rolls for each intermediate man. If the hit was fatal, the last man is the
   * squad's own death as today (`destroy`, the memorial) and may still leave a body whose
   * parent is -1 (ruling 5) -- unless the type goes down IN PLACE (`in_place`, figures 1: the
   * civilians), where the fatal hit instead downs the unit itself, same id, on a won roll.
   *
   * A spawned wounded takes the id `count` had. Every loop that can reach `applyDamage`
   * while iterating ids is harmless to that: the splash loops (`stepStrikes`, `splashAt`,
   * `splashDirect`) bound on `count` read BEFORE the loop, so the blast that downed him does
   * not also hit the man it just made; the per-tick system loops that still read `count` live
   * meet a fresh `wounded` (no weapon, nothing queued, default columns) and do nothing with
   * it; `destroy`'s passenger loop matches `carriedBy`, which a fresh id never has. Ids are
   * never reused, so every per-id table (`contact`, rng streams) is already at its default.
   *
   * Only a hit through `applyDamage` rolls: a kill that bypasses it -- `debugKill`, or an
   * airborne carrier taking its passengers with it (`destroy`'s `takesAll`) -- rolls no falls
   * by design, and every man in that team dies with it.
   */
  private woundCrossings(target: number, by: number, inPlace: boolean): void {
    const type = this.unitTypes[this.typeIdx[target]];
    const standing = figuresStanding(this.hp[target], type.hp, type.figures);
    const floor = standing > 1 ? standing : 1;
    while (this.figuresUp[target] > floor) this.fallMan(target, by, false);
    if (this.hp[target] > 0) return;
    if (inPlace && this.downInPlace(target, by)) return;
    this.destroy(target, by);
    if (!inPlace) this.fallMan(target, by, true);
  }

  /**
   * One man of `squad` falls. ONE roll on the squad's own stream (invariant 3; chance 0 or
   * ONE draws nothing), then he lives as a new `wounded` entity at the squad's position, or
   * dies. He dies regardless of the roll when his side already has MAX_WOUNDED_PER_SIDE
   * wounded alive, when the sim is at capacity, or when `wounds.type` names no registered
   * `wounded`-role type -- killed, never thrown, so content can never crash a fight.
   * `figuresUp` drops either way. `last`: the squad's final man, already `destroy`ed -- his
   * body (if any) has parent -1, and a failed roll emits nothing beyond that `destroyed`.
   */
  private fallMan(squad: number, by: number, last: boolean): void {
    const type = this.unitTypes[this.typeIdx[squad]];
    const w = type.wounds;
    if (w === null) return;
    if (this.figuresUp[squad] > 0) this.figuresUp[squad]--;
    const side = this.side[squad];
    const lives = this.rng.chance(squad, w.chance);
    const wt = lives ? this.woundedTypeOf(type) : -1;
    if (wt < 0 || this.woundedAlive[side] >= MAX_WOUNDED_PER_SIDE || this.count >= this.capacity) {
      if (!last) this.pendingEvents.push({ kind: 'manKilled', tick: this.tickCount, entity: squad, by });
      return;
    }
    const id = this.spawn(wt, side, this.posX[squad], this.posY[squad], this.facing[squad]);
    // `spawn` already made him DOWN and counted him on his side (a `wounded`-role body).
    this.woundParent[id] = last ? -1 : squad;
    this.woundBy[id] = by;
    this.bleedTicks[id] = w.bleedTicks;
    this.scars[id] = this.scars[squad];
    this.pendingEvents.push({ kind: 'woundedDown', tick: this.tickCount, entity: id, parent: last ? -1 : squad, by });
  }

  /** The fatal hit on an `in_place` type: on a won roll (and under the side's cap) the unit
   *  itself goes DOWN at 1 hp -- same id, so `civIds` and refuge latches keep it -- and its one
   *  man is no longer standing (`figuresUp` 0, which also zeroes its regen ceiling). False
   *  when it dies instead, and the caller destroys it as today. */
  private downInPlace(id: number, by: number): boolean {
    const type = this.unitTypes[this.typeIdx[id]];
    const w = type.wounds;
    if (w === null) return false;
    const side = this.side[id];
    if (!this.rng.chance(id, w.chance) || this.woundedAlive[side] >= MAX_WOUNDED_PER_SIDE) return false;
    this.hp[id] = ONE;
    this.figuresUp[id] = 0;
    this.moving[id] = 0;
    this.woundParent[id] = -1;
    this.woundBy[id] = by;
    this.woundState[id] = WOUND_DOWN;
    this.bleedTicks[id] = w.bleedTicks;
    this.woundedAlive[side]++;
    this.pendingEvents.push({ kind: 'woundedDown', tick: this.tickCount, entity: id, parent: -1, by });
    return true;
  }

  /** GH-707: out of the fight -- a unit that is down (any woundState but NONE) or is a
   *  `wounded`-role body. Read only while `woundLive`. */
  private horsDeCombat(t: number): boolean {
    return this.woundState[t] !== WOUND_NONE || this.unitTypes[this.typeIdx[t]].isWounded;
  }

  /**
   * GH-707 Task 4 (D4): every living ground carrier within 1 tile (Euclidean, 1 tile^2) of an
   * evac point of its own side evacuates the wounded it carries. Once a tick, after
   * stepTransport. Nothing without wound content, with no point declared, or with no wounded
   * alive on any side. An air carrier evacuates on lifting instead (stepAirCarriers).
   */
  private stepEvacuation(): void {
    if (!this.woundLive || this.evacCount === 0) return;
    const wa = this.woundedAlive;
    if (wa[0] === 0 && wa[1] === 0 && wa[2] === 0) return;
    for (let c = 0; c < this.count; c++) {
      if (this.alive[c] === 0 || this.passengers[c] === 0) continue;
      if (this.unitTypes[this.typeIdx[c]].isAirCarrier) continue;
      const side = this.side[c];
      for (let k = 0; k < this.evacCount; k++) {
        if (this.evacSide[k] !== side) continue;
        const dSq = distSqFx(fx.sub(this.posX[c], this.evacX[k]), fx.sub(this.posY[c], this.evacY[k]));
        if (dSq > ONE) continue;
        this.evacuateAboard(c);
        break;
      }
    }
  }

  /** GH-707 Task 4: every wounded aboard `car` leaves the fight alive -- `woundEvacuated`
   *  (`side` the rescuing side, `car`'s), `alive` 0 with no `destroyed`, woundState GONE, his
   *  side's wounded count down once. Healthy riders stay aboard. */
  private evacuateAboard(car: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.carriedBy[i] !== car || this.alive[i] === 0 || !this.horsDeCombat(i)) continue;
      this.forgetWounded(i);
      this.carriedBy[i] = -1;
      if (this.passengers[car] > 0) this.passengers[car]--;
      this.alive[i] = 0;
      // Out of the fight ALIVE: `removed` is the flag `alive` alone cannot carry, the one
      // `casualties_pct` and the renderer already read to tell a body taken off the board from
      // a death (removeFromPlay's). Not hashed (see the field), so this moves no pin.
      this.removed[i] = 1;
      this.moving[i] = 0;
      this.fieldRef[i] = -1;
      this.woundState[i] = WOUND_GONE;
      this.pendingEvents.push({ kind: 'woundEvacuated', tick: this.tickCount, entity: i, carrier: car, side: this.side[car] });
    }
    this.refreshSpeedMul(car);
  }

  /** GH-707 Task 6: structure `s`'s parsed `aid` block. Only called on a structure
   *  `aidPostOf` (or the admission that wrote `admittedAt`) already found to have one. */
  private aidOf(s: number): StructureAid {
    const a = this.structureTypes[this.stTypeIdx[s]].aid;
    if (a === null) throw new Error(`structure ${s} is not an aid post`);
    return a;
  }

  /** GH-707 Task 6: is structure `s` an aid post working for `side` -- standing, finished
   *  (field works: a site under construction admits nobody), with an `aid` block, and owned
   *  (`stOwner`) by `side`? A neutral (-1) structure is nobody's post. */
  private aidPostOf(s: number, side: number): boolean {
    if (this.stAlive[s] === 0 || this.stProgress[s] !== ONE || this.stOwner[s] !== side) return false;
    return this.structureTypes[this.stTypeIdx[s]].aid !== null;
  }

  /** GH-707 Task 6, dispatch: the friendly aid post whose `dispatch_radius` holds medic `m`
   *  (measured to its nearest footprint tile centre), the nearest when several do, ties to the
   *  lowest index; -1 when none. */
  private dispatchPostOf(m: number): number {
    const side = this.side[m];
    let best = -1;
    let bestD = 0;
    for (let s = 0; s < this.structureCount_; s++) {
      if (!this.aidPostOf(s, side)) continue;
      const d = this.structDistSq(s, this.posX[m], this.posY[m]);
      if (d > this.aidOf(s).dispatchRadiusSq) continue;
      if (best >= 0 && d >= bestD) continue;
      best = s;
      bestD = d;
    }
    return best;
  }

  /** `nearestStructTile` into `deliverX`/`deliverY` (scratch) rather than a fresh tuple:
   *  called every tick a medic carries toward a post, so it must not allocate. */
  private nearestStructTileScratch(s: number, px: Fx, py: Fx): void {
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
    this.deliverX = bx;
    this.deliverY = by;
  }

  /**
   * GH-707 Task 6, the aid post: once a tick, after stepTransport. Nothing without wound
   * content, and nothing while no structure with an `aid` block was ever added.
   *
   * Treatment first: every ADMITTED patient's `woundTimer` counts down (the crawl's period
   * counter while he was DOWN: he is off the board now, so nothing crawls him, and admission
   * overwrote it). His post fallen, he is lost (`woundLost`, GONE). At 0 he is discharged
   * (`dischargePatient`).
   *
   * Then admission: every living carrier that can carry a wounded (`can_carry` -- an APC never
   * seats one), on the ground (an air carrier only while LANDED), with riders aboard, within
   * `admit_radius` of a friendly aid post (`aidPostOf`; distance to the nearest footprint tile
   * centre), hands every wounded it carries to the nearest such post (`admitAboard`).
   */
  private stepAidPosts(): void {
    if (!this.woundLive || this.aidPosts === 0) return;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      if (this.woundState[i] !== WOUND_ADMITTED) continue;
      const s = this.admittedAt[i];
      if (this.stAlive[s] === 0) {
        this.woundState[i] = WOUND_GONE;
        this.admittedAt[i] = -1;
        this.woundTimer[i] = 0;
        // Lost, not taken out alive: a casualty again for casualties_pct.
        this.removed[i] = 0;
        this.pendingEvents.push({ kind: 'woundLost', tick: this.tickCount, entity: i, structure: s });
        continue;
      }
      const t = this.woundTimer[i] - 1;
      this.woundTimer[i] = t;
      if (t <= 0) this.dischargePatient(i, s);
    }
    const wa = this.woundedAlive;
    if (wa[0] === 0 && wa[1] === 0 && wa[2] === 0) return;
    for (let c = 0; c < n; c++) {
      if (this.alive[c] === 0 || this.passengers[c] === 0) continue;
      const ct = this.unitTypes[this.typeIdx[c]];
      if (ct.canCarry === null) continue;
      if (ct.isAirCarrier && this.airState[c] !== AIR_LANDED) continue;
      if (this.carriedBy[c] >= 0 || this.tunnelIn[c] >= 0) continue;
      const side = this.side[c];
      let post = -1;
      let postD = 0;
      for (let s = 0; s < this.structureCount_; s++) {
        if (!this.aidPostOf(s, side)) continue;
        const d = this.structDistSq(s, this.posX[c], this.posY[c]);
        if (d > this.aidOf(s).admitRadiusSq) continue;
        if (post >= 0 && d >= postD) continue;
        post = s;
        postD = d;
      }
      if (post >= 0) this.admitAboard(c, post);
    }
  }

  /** GH-707 Task 6: every wounded aboard `car` is admitted at post `s` -- off the board alive
   *  (`alive` 0, `removed` 1, no `destroyed`; his side's wounded count down once, here),
   *  ADMITTED, `admittedAt` s, `woundTimer` the post's `treat_s` (halved, at least one tick,
   *  when a medic had STABILISED him), `woundAdmitted` with the carrier's side. His seat frees.
   *  Healthy riders stay aboard. */
  private admitAboard(car: number, s: number): void {
    const aid = this.aidOf(s);
    const side = this.side[car];
    for (let i = 0; i < this.count; i++) {
      if (this.carriedBy[i] !== car || this.alive[i] === 0 || !this.horsDeCombat(i)) continue;
      let t = aid.treatTicks;
      if (this.woundState[i] === WOUND_STABILISED) {
        t >>= 1;
        if (t < 1) t = 1;
      }
      this.forgetWounded(i);
      this.carriedBy[i] = -1;
      if (this.passengers[car] > 0) this.passengers[car]--;
      this.alive[i] = 0;
      this.removed[i] = 1;
      this.moving[i] = 0;
      this.fieldRef[i] = -1;
      this.woundState[i] = WOUND_ADMITTED;
      this.admittedAt[i] = s;
      this.woundTimer[i] = t;
      this.pendingEvents.push({ kind: 'woundAdmitted', tick: this.tickCount, entity: i, structure: s, side });
    }
    this.refreshSpeedMul(car);
  }

  /**
   * GH-707 Task 6: patient `i`'s treatment at post `s` is over. A man of the post's own side
   * who fell from a squad (`woundParent` >= 0) rejoins it while it stands below full, else the
   * nearest same-type squad of his side below full (measured from the post; ties to the lowest
   * id), and nobody else's: `rejoinSquad`. Otherwise -- an enemy's or a civilian's man (D5), a
   * squad's last man or a man downed in place (parent -1, ruling 5), or no squad to take him
   * -- he leaves the fight alive: `woundEvacuated`, `carrier` -1, `side` the post's owner.
   * GONE either way; he never comes back on the board as an entity.
   */
  private dischargePatient(i: number, s: number): void {
    const owner = this.stOwner[s];
    const side = this.side[i];
    this.woundState[i] = WOUND_GONE;
    this.admittedAt[i] = -1;
    this.woundTimer[i] = 0;
    let squad = -1;
    const p = this.woundParent[i];
    if (side === owner && side !== 2 && p >= 0) {
      const ti = this.typeIdx[p];
      if (this.canRejoin(p, side, ti)) squad = p;
      else {
        let bestD = 0;
        for (let q = 0; q < this.count; q++) {
          if (!this.canRejoin(q, side, ti)) continue;
          const d = distSqFx(fx.sub(this.posX[q], this.stCx[s]), fx.sub(this.posY[q], this.stCy[s]));
          if (squad >= 0 && d >= bestD) continue;
          squad = q;
          bestD = d;
        }
      }
    }
    if (squad < 0) {
      this.pendingEvents.push({ kind: 'woundEvacuated', tick: this.tickCount, entity: i, carrier: -1, side: owner });
      return;
    }
    this.rejoinSquad(squad);
    this.pendingEvents.push({ kind: 'woundRejoined', tick: this.tickCount, entity: i, squad });
  }

  /** GH-707 Task 6: can squad `q` take a man back -- alive, of `side` and type `ti`, not itself
   *  down, and short of men. */
  private canRejoin(q: number, side: number, ti: number): boolean {
    if (this.alive[q] === 0 || this.side[q] !== side || this.typeIdx[q] !== ti) return false;
    if (this.woundState[q] !== WOUND_NONE) return false;
    return this.figuresUp[q] < this.unitTypes[ti].figures;
  }

  /** GH-707 Task 6, "weaker each time": squad `q` stands one man more and gains his
   *  `scarredShare` of hp for the team's `scars` so far, then `scars` + 1. The hp is capped at
   *  the standing men's full shares (`type.hp x figuresUp / figures`), the ceiling a team of
   *  that many men can hold. */
  private rejoinSquad(q: number): void {
    const type = this.unitTypes[this.typeIdx[q]];
    const up = this.figuresUp[q] + 1;
    this.figuresUp[q] = up;
    const gain = scarredShare(scaleDown(type.hp, 1, type.figures), this.scars[q]);
    const cap = scaleDown(type.hp, up, type.figures);
    const hp = fx.add(this.hp[q], gain);
    this.hp[q] = hp > cap ? cap : hp;
    if (this.scars[q] < 255) this.scars[q]++;
  }

  /**
   * GH-707 Task 3, the wounded man: once a tick, before movement. Nothing at all without
   * wound content (`woundLive`), and nothing while no side has a wounded alive.
   *
   * Bleed: a DOWN wounded loses one tick of `bleedTicks` a tick, two while pinned; none while
   * carried or tended (`woundTended`: a friendly medic within MEDIC_TREAT_REACH_SQ, or a
   * friendly carrier inside its own `stabiliseRadiusSq`). STABILISED never bleeds. At zero he
   * dies: `bledOut`, then `destroy` with `by` = the man who downed him (`woundBy`).
   *
   * Crawl: a DOWN wounded, not carried, not tended, lying on cover under WOUND_COVER_STOP,
   * crawls toward `bestCoverTile` -- re-picked every WOUND_CRAWL_PERIOD_TICKS (the first time
   * on his first tick down) into `goalX`/`goalY`, which no order of his can use -- one
   * `stepPerTick` of his OWN type a tick, a straight position step: no flow field, no
   * `moving`. A unit downed in place keeps its own type (a civilian), so it crawls at that
   * type's speed -- acceptable for P1; P2 tunes the content.
   */
  private stepWounded(): void {
    if (!this.woundLive) return;
    const wa = this.woundedAlive;
    if (wa[0] === 0 && wa[1] === 0 && wa[2] === 0) return;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      if (this.alive[i] === 0 || this.woundState[i] !== WOUND_DOWN) continue;
      if (this.carriedBy[i] >= 0 || this.woundTended(i)) continue;
      this.bleedTicks[i] -= this.pinned[i] === 1 ? 2 : 1;
      if (this.bleedTicks[i] <= 0) {
        this.bleedTicks[i] = 0;
        this.pendingEvents.push({ kind: 'bledOut', tick: this.tickCount, entity: i });
        this.destroy(i, this.woundBy[i]);
        continue;
      }
      this.crawlWounded(i);
    }
  }

  /** GH-707: is DOWN wounded `i` being tended -- a living, free (not carried, not buried, not
   *  down) unit that would rescue him of its own accord (`rescuePriority` >= 0: his own side,
   *  or anyone's when he is a civilian) and is a medic within MEDIC_TREAT_REACH_SQ, or a
   *  carrier within its own `stabiliseRadiusSq`? An enemy medic beside him stops his bleed only
   *  while actually treating him (on a `rescue` order); merely standing there, he does not. */
  private woundTended(i: number): boolean {
    const side = this.side[i];
    const px = this.posX[i];
    const py = this.posY[i];
    for (let t = 0; t < this.count; t++) {
      if (t === i || this.alive[t] === 0) continue;
      const type = this.unitTypes[this.typeIdx[t]];
      if (type.rescue === null && type.stabiliseRadiusSq === 0) continue;
      if (this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0 || this.woundState[t] !== WOUND_NONE) continue;
      // A medic treating him on an order (an enemy's medic, Task 5) is tending him too.
      if (rescuePriority(this.side[t], side) < 0 && !(this.medState[t] === MED_TREATING && this.medTarget[t] === i)) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
      if (type.rescue !== null && dSq <= MEDIC_TREAT_REACH_SQ) return true;
      if (type.stabiliseRadiusSq > 0 && dSq <= type.stabiliseRadiusSq) return true;
    }
    return false;
  }

  /**
   * GH-707 Task 5, the medic: once a tick, after stepWounded and before movement, for every
   * living free unit with a `rescue` block. Nothing at all without wound content.
   *
   * MED_IDLE: a medic standing still with no fire order, no boarding walk and not parked (a
   * halt, stance or unload parks him: `medTimer` -1) goes to work by himself. Carrying someone
   * (a player order took him off a delivery), he delivers (MED_CARRYING). Otherwise he picks
   * the best wounded within `rescue.radiusSq` (`pickWounded`, D2: friendly, then civilian,
   * never an enemy; nearest, then lowest id) and walks to him (MED_TO_WOUNDED).
   * MED_TO_WOUNDED / MED_TREATING (`medicTend`): within MEDIC_TREAT_REACH_SQ he stops and
   * treats a DOWN man for `rescue.treatTicks` ticks, the last of them stabilising him
   * (`woundStabilised`); a STABILISED man he takes into his own seat when he has one free
   * (MED_CARRYING), else his job is done (MED_IDLE).
   * MED_CARRYING / MED_DELIVERING (`medicDeliver`): to the nearest place that takes a wounded
   * (`deliveryTarget`); none, he holds where he is, still carrying.
   *
   * He moves only by the ordinary move machinery (`medicGoTo`: a goal and a pooled flow
   * field), never by a position write; the wounded is never given a goal (his crawl reads his
   * own goalX/goalY). A routed medic drops his job (keeping his passenger) and runs.
   */
  private stepMedics(): void {
    if (!this.woundLive) return;
    for (let m = 0; m < this.count; m++) {
      if (this.alive[m] === 0) continue;
      const r = this.unitTypes[this.typeIdx[m]].rescue;
      if (r === null) continue;
      if (this.carriedBy[m] >= 0 || this.tunnelIn[m] >= 0 || this.garrisonedIn[m] >= 0) continue;
      if (this.woundState[m] !== WOUND_NONE) continue;
      let st = this.medState[m];
      if (this.routed[m] === 1) {
        if (st !== MED_IDLE) this.medicIdle(m);
        continue;
      }
      if (st === MED_IDLE) {
        if (this.medTimer[m] < 0) continue; // parked by an order
        if (this.moving[m] !== 0 || this.focusTarget[m] >= 0 || this.boardGoal[m] >= 0) continue;
        if (this.passengers[m] > 0) {
          st = MED_CARRYING;
        } else {
          const w = this.pickWounded(m, r.radiusSq);
          if (w < 0) continue;
          this.medTarget[m] = w;
          this.medTimer[m] = 0;
          st = MED_TO_WOUNDED;
        }
        this.medState[m] = st;
      }
      if (st === MED_TO_WOUNDED || st === MED_TREATING) this.medicTend(m, r.treatTicks);
      else this.medicDeliver(m);
    }
  }

  /** GH-707 Task 5: medic `m` back to MED_IDLE with no target, his walk stopped. Whoever he
   *  carries stays aboard. */
  private medicIdle(m: number): void {
    this.medState[m] = MED_IDLE;
    this.medTarget[m] = -1;
    this.medTimer[m] = 0;
    this.moving[m] = 0;
    this.fieldRef[m] = -1;
  }

  /** GH-707 Task 5: may `w` be treated or picked up now -- alive, DOWN or STABILISED, not
   *  aboard anything, on the surface. */
  private rescuable(w: number): boolean {
    if (w < 0 || w >= this.count || this.alive[w] === 0) return false;
    const st = this.woundState[w];
    if (st !== WOUND_DOWN && st !== WOUND_STABILISED) return false;
    return this.carriedBy[w] < 0 && this.tunnelIn[w] < 0;
  }

  /** GH-707 Task 5: does medic `m`'s side know wounded `w` -- its own man always; anyone
   *  else only at IDENTIFIED_AT or better (a civilian side, holding no contacts, knows only
   *  its own). */
  private medicKnows(m: number, w: number): boolean {
    const side = this.side[m];
    if (this.side[w] === side) return true;
    return side <= 1 && this.contact[side * this.capacity + w] >= IDENTIFIED_AT;
  }

  /** GH-707 Task 5: the `rescue` order's gate for one id. */
  private rescueGate(id: number, w: number): boolean {
    if (id < 0 || id >= this.count || this.alive[id] === 0) return false;
    if (this.unitTypes[this.typeIdx[id]].rescue === null) return false;
    if (this.routed[id] === 1 || this.carriedBy[id] >= 0 || this.tunnelIn[id] >= 0) return false;
    return this.rescuable(w) && this.medicKnows(id, w);
  }

  /**
   * GH-707 Task 5 (D2): the wounded idle medic `m` goes to of his own accord, or -1. Within
   * `radiusSq` of him, rescuable, known to his side, `rescuePriority` >= 0 (friendly 0, then
   * civilian 1; never an enemy), not already some other medic's job; a STABILISED man only
   * when `m` has a free seat (he has nothing left to do for him otherwise). Best priority,
   * then nearest, then lowest id (the scan order and a strict `<`).
   */
  private pickWounded(m: number, radiusSq: Fx): number {
    const side = this.side[m];
    // Cost guard: nobody he would go to of his own accord is down -- his own side's wounded
    // and civilians (D2: never an enemy's without an order). For a civilian medic both are
    // `woundedAlive[2]`.
    const wa = this.woundedAlive;
    if (wa[side] === 0 && wa[2] === 0) return -1;
    const type = this.unitTypes[this.typeIdx[m]];
    const seat = this.passengers[m] < type.transportSlots;
    const mx = this.posX[m];
    const my = this.posY[m];
    // GH-707 Task 6, dispatch: standing within a friendly aid post's `dispatch_radius`, he also
    // answers for every wounded within that radius of the POST.
    const post = this.aidPosts > 0 ? this.dispatchPostOf(m) : -1;
    const postRSq = post >= 0 ? this.aidOf(post).dispatchRadiusSq : 0;
    let best = -1;
    let bestP = 0;
    let bestD = 0;
    for (let w = 0; w < this.count; w++) {
      if (w === m || !this.rescuable(w)) continue;
      const p = rescuePriority(side, this.side[w]);
      if (p < 0) continue;
      if (this.woundState[w] === WOUND_STABILISED && !seat) continue;
      const d = distSqFx(fx.sub(this.posX[w], mx), fx.sub(this.posY[w], my));
      if (d > radiusSq && (post < 0 || this.structDistSq(post, this.posX[w], this.posY[w]) > postRSq)) continue;
      if (best >= 0 && (p > bestP || (p === bestP && d >= bestD))) continue;
      if (!this.medicKnows(m, w) || this.claimedByOther(w, m)) continue;
      best = w;
      bestP = p;
      bestD = d;
    }
    return best;
  }

  /** GH-707 Task 5: is wounded `w` some living medic's job other than `m`'s? */
  private claimedByOther(w: number, m: number): boolean {
    for (let o = 0; o < this.count; o++) {
      if (o === m || this.alive[o] === 0 || this.medTarget[o] !== w) continue;
      const st = this.medState[o];
      if (st === MED_TO_WOUNDED || st === MED_TREATING) return true;
    }
    return false;
  }

  /** GH-707 Task 5: one tick of medic `m` going to, then treating, his `medTarget`. */
  private medicTend(m: number, treatTicks: number): void {
    const w = this.medTarget[m];
    // Every tick, not only when the job was taken: a man not his own side's whom his side has
    // lost sight of (below IDENTIFIED_AT) is no longer walked to -- the medic does not track
    // a position nobody can see. His own side's men are always known.
    if (!this.rescuable(w) || !this.medicKnows(m, w)) {
      this.medicIdle(m);
      return;
    }
    const d = distSqFx(fx.sub(this.posX[w], this.posX[m]), fx.sub(this.posY[w], this.posY[m]));
    if (d > MEDIC_TREAT_REACH_SQ) {
      this.medState[m] = MED_TO_WOUNDED;
      this.medTimer[m] = 0;
      this.medicGoTo(m, this.posX[w], this.posY[w]);
      return;
    }
    // In reach: he stops where he is and works.
    this.moving[m] = 0;
    this.fieldRef[m] = -1;
    this.wpCount[m] = 0;
    if (this.woundState[w] === WOUND_DOWN) {
      if (this.medState[m] !== MED_TREATING) {
        this.medState[m] = MED_TREATING;
        this.medTimer[m] = treatTicks;
      }
      const t = this.medTimer[m] - 1;
      this.medTimer[m] = t;
      if (t > 0) return;
      this.woundState[w] = WOUND_STABILISED;
      this.pendingEvents.push({ kind: 'woundStabilised', tick: this.tickCount, entity: w, medic: m });
    }
    this.medTimer[m] = 0;
    if (this.canSeat(m, w)) {
      this.seat(m, w);
      this.posX[w] = this.posX[m];
      this.posY[w] = this.posY[m];
      this.facing[w] = this.facing[m];
      this.medState[m] = MED_CARRYING;
      return;
    }
    this.medicIdle(m); // treat-only (no seat), or his seats are full: done with him
  }

  /** GH-707 Task 5: one tick of medic `m` carrying -- to `deliveryTarget`, or holding. */
  private medicDeliver(m: number): void {
    if (this.passengers[m] === 0) {
      // Delivered (handed over, evacuated) or put down: the job is over.
      this.medicIdle(m);
      return;
    }
    const kind = this.deliveryTarget(m);
    if (kind === DELIVER_NONE) {
      if (this.medState[m] === MED_DELIVERING) {
        this.moving[m] = 0;
        this.fieldRef[m] = -1;
      }
      this.medState[m] = MED_CARRYING;
      return;
    }
    this.medState[m] = MED_DELIVERING;
    if (kind === DELIVER_CARRIER) {
      const c = this.deliverId;
      const d = distSqFx(fx.sub(this.posX[c], this.posX[m]), fx.sub(this.posY[c], this.posY[m]));
      if (d <= LOAD_RANGE_SQ) {
        for (let i = 0; i < this.count; i++) {
          if (this.carriedBy[i] === m && this.alive[i] === 1) this.transferSeat(m, c, i);
        }
        if (this.passengers[m] === 0) {
          this.medicIdle(m);
          return;
        }
      }
    }
    // DELIVER_EVAC: stepEvacuation takes his wounded once he stands within a tile of the point;
    // DELIVER_AID: stepAidPosts admits them once he stands within the post's admit_radius.
    this.medicGoTo(m, this.deliverX, this.deliverY);
  }

  /**
   * GH-707 Task 5: where carrying medic `m` takes his wounded -- the nearest (strict `<`, so
   * ties go to the earlier candidate in scan order) of: a living friendly carrier, not itself a
   * medic, that would seat a wounded now (`canSeat`'s own rule: `can_carry` listing
   * `wounded`, a free seat, and an air carrier only while LANDED), handed over within
   * LOAD_RANGE_SQ; or one of his side's evac points. Writes `deliverId`/`deliverX`/`deliverY`
   * (scratch, never hashed) and returns the kind, DELIVER_NONE when there is nowhere.
   *
   * Task 6: a friendly, complete aid structure (`aidPostOf`) is one more candidate kind,
   * scanned FIRST, so a tie goes to the post; stepAidPosts admits on arrival.
   */
  private deliveryTarget(m: number): number {
    const side = this.side[m];
    const mx = this.posX[m];
    const my = this.posY[m];
    let rider = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.carriedBy[i] === m && this.alive[i] === 1) {
        rider = i;
        break;
      }
    }
    let kind = DELIVER_NONE;
    let bestD = 0;
    // GH-707 Task 6: a friendly aid post, first in scan order (a tie goes to it), measured to
    // its nearest footprint tile centre (structDistSq, as every structure distance is); he
    // walks to that tile and medicGoTo snaps the goal onto open ground beside it.
    if (rider >= 0 && this.aidPosts > 0) {
      for (let s = 0; s < this.structureCount_; s++) {
        if (!this.aidPostOf(s, side)) continue;
        const d = this.structDistSq(s, mx, my);
        if (kind !== DELIVER_NONE && d >= bestD) continue;
        kind = DELIVER_AID;
        bestD = d;
        this.deliverId = s;
        this.nearestStructTileScratch(s, mx, my);
      }
    }
    if (rider >= 0) {
      for (let c = 0; c < this.count; c++) {
        if (c === m || this.alive[c] === 0 || this.side[c] !== side) continue;
        const ct = this.unitTypes[this.typeIdx[c]];
        if (ct.canCarry === null || ct.rescue !== null || ct.transportSlots === 0) continue;
        const d = distSqFx(fx.sub(this.posX[c], mx), fx.sub(this.posY[c], my));
        if (kind !== DELIVER_NONE && d >= bestD) continue;
        // canSeat refuses a rider already aboard something; ask as transferSeat does.
        this.carriedBy[rider] = -1;
        const ok = this.canSeat(c, rider);
        this.carriedBy[rider] = m;
        if (!ok) continue;
        kind = DELIVER_CARRIER;
        bestD = d;
        this.deliverId = c;
        this.deliverX = this.posX[c];
        this.deliverY = this.posY[c];
      }
    }
    for (let k = 0; k < this.evacCount; k++) {
      if (this.evacSide[k] !== side) continue;
      const d = distSqFx(fx.sub(this.evacX[k], mx), fx.sub(this.evacY[k], my));
      if (kind !== DELIVER_NONE && d >= bestD) continue;
      kind = DELIVER_EVAC;
      bestD = d;
      this.deliverId = k;
      this.deliverX = this.evacX[k];
      this.deliverY = this.evacY[k];
    }
    return kind;
  }

  /**
   * GH-707 Task 5: walk medic `m` toward (x, y) by the ordinary machinery -- a goal and a
   * pooled flow field on his own domain, the goal snapped to ground he can stand on (the
   * exact point when its tile is open, the open tile's centre otherwise: stepFocus's rule).
   * A no-op while he is already walking to that tile, so a chase costs one field per tile the
   * goal crosses, not one per tick. Allocation-free.
   */
  private medicGoTo(m: number, x: Fx, y: Fx): void {
    const domain = this.domainOf(m);
    let gx = x;
    let gy = y;
    let gtx = x >> 16;
    let gty = y >> 16;
    if (!this.unitTypes[this.typeIdx[m]].isAir) {
      this.snapOpenTile(gtx, gty, this.maskFor(domain));
      if (this.snapX !== gtx || this.snapY !== gty) {
        gtx = this.snapX;
        gty = this.snapY;
        gx = fx.add(fx.fromInt(gtx), HALF);
        gy = fx.add(fx.fromInt(gty), HALF);
      }
    }
    if (this.moving[m] === 1 && this.fieldRef[m] >= 0 && this.goalX[m] >> 16 === gtx && this.goalY[m] >> 16 === gty) return;
    this.wpCount[m] = 0;
    this.goalX[m] = gx;
    this.goalY[m] = gy;
    this.fieldRef[m] = this.fieldFor(gtx, gty, domain);
    this.moving[m] = 1;
    this.attackMove[m] = 0;
    this.sweepOrder[m] = 0;
    this.engaging[m] = 0;
  }

  /** GH-707: one tick of DOWN wounded `i`'s crawl to cover (see stepWounded). */
  private crawlWounded(i: number): void {
    const w = this.width;
    const px = this.posX[i];
    const py = this.posY[i];
    const tx = px >> 16;
    const ty = py >> 16;
    if (this.cover[ty * w + tx] >= WOUND_COVER_STOP) return;
    if (this.woundTimer[i] > 0) {
      this.woundTimer[i]--;
    } else {
      this.woundTimer[i] = WOUND_CRAWL_PERIOD_TICKS - 1;
      const best = bestCoverTile(this.cover, this.blocked, w, this.height, tx, ty);
      if (best === ty * w + tx) {
        this.goalX[i] = px;
        this.goalY[i] = py;
      } else {
        this.goalX[i] = fx.add(fx.fromInt(best % w), HALF);
        this.goalY[i] = fx.add(fx.fromInt((best - (best % w)) / w), HALF);
      }
    }
    const dx = fx.sub(this.goalX[i], px);
    const dy = fx.sub(this.goalY[i], py);
    if (dx === 0 && dy === 0) return;
    const step = this.unitTypes[this.typeIdx[i]].stepPerTick;
    if (step <= 0) return;
    // The goal is at most WOUND_CRAWL_SCAN tiles off, so dx^2 + dy^2 stays far inside Fx.
    const dist = fx.sqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
    let nx: Fx;
    let ny: Fx;
    if (dist <= step) {
      nx = this.goalX[i];
      ny = this.goalY[i];
    } else {
      nx = fx.add(px, fx.div(fx.mul(dx, step), dist));
      ny = fx.add(py, fx.div(fx.mul(dy, step), dist));
    }
    // bestCoverTile never picks a blocked tile, nor one whose straight line from the START
    // tile's centre crosses a blocked tile. But he is rarely on that centre (he lies where his
    // squad stood, and he re-picks mid-crawl), and from off-centre a line to a diagonal
    // neighbour can cut the corner tile beside it: that step is refused here rather than slid
    // along, and he lies still (wounded.test.ts, "an off-centre diagonal crawl").
    if (this.blocked[(ny >> 16) * w + (nx >> 16)] !== 0) return;
    this.posX[i] = nx;
    this.posY[i] = ny;
  }

  /** `type.wounds.type` as a unit-type index, resolved at the first fall and cached on the
   *  type (each Sim builds its own UnitType objects). -1, uncached, while no registered type
   *  of role `wounded` carries that id -- the man then dies (`fallMan`). */
  private woundedTypeOf(type: UnitType): number {
    if (type.woundedTypeIdx >= 0) return type.woundedTypeIdx;
    const w = type.wounds;
    if (w === null) return -1;
    for (let t = 0; t < this.unitTypes.length; t++) {
      const u = this.unitTypes[t];
      if (u.id === w.typeId && u.isWounded) {
        type.woundedTypeIdx = t;
        return t;
      }
    }
    return -1;
  }

  /** coverProtects: fire arriving from outside is muffled by entrenchment;
   *  a penetration's crew shock (crew_shaken) is not.
   *  srcSide/srcX/srcY: who it came from and where, for `startRout`. -1 means
   *  no source (a shock from inside: crew shaken, a bail-out, a test hook),
   *  and leaves the last recorded source in place. */
  private applySuppression(
    target: number,
    amount: Fx,
    coverProtects = true,
    srcSide = -1,
    srcX: Fx = 0,
    srcY: Fx = 0,
    coverIgnore: Fx = 0,
  ): void {
    // You cannot pin someone who is underground. Without this, a mortar
    // barrage over a trail routs the occupants and the counter-unit is
    // decorative.
    if (this.tunnelIn[target] >= 0) return;
    // E6 (GH-274, spec 3.2): a swarm cannot be pinned or routed. Nothing accumulates, so the
    // pin test in stepUpkeep never fires and the rout clause behind it never runs; a dive is
    // an ordinary fire and stays open to it however hard it is shot at. (`suppression_resistance`
    // alone only halves the amount.) Early, before the source is recorded: nothing to run from.
    const type = this.unitTypes[this.typeIdx[target]];
    if (type.swarm !== null) return;
    // Only HOSTILE fire is a direction to run from. A unit shaken by its own
    // side's splash would otherwise flee toward the enemy: the GH-291
    // emulation found a playtest gun_truck whose "source" was its own flank.
    if (srcSide >= 0 && srcSide !== this.side[target]) {
      this.suppFromX[target] = srcX;
      this.suppFromY[target] = srcY;
      this.suppFromSet[target] = 1;
    }
    let a = fx.mul(amount, type.suppResFactor);
    const vet = this.veterancy[target];
    if (vet > 0) a = fx.mul(a, fx.sub(ONE, vet * VET_SUPP_BONUS));
    if (coverProtects) {
      // A man inside a building fights with the building's cover, not the
      // cover of the tile under its centroid -- which is a building tile, 0
      // (B1, GH-280: every near miss on a 2x2 house pinned its garrison).
      const gIn = this.garrisonedIn[target];
      const cov =
        gIn >= 0
          ? this.structureTypes[this.stTypeIdx[gIn]].garrisonCover
          : this.cover[(this.posY[target] >> 16) * this.width + (this.posX[target] >> 16)];
      let mod = COVER_SUPP[cov];
      // A round that ignores part of the cover bonus (GH-709 unit 9) closes
      // that fraction of the gap to the open ground -- on a TILE only: a
      // building's own cover is the building, and the grenadier does not
      // reach into a house (lead ruling Q7).
      if (coverIgnore > 0 && gIn < 0) mod = fx.add(mod, fx.mul(fx.sub(ONE, mod), coverIgnore));
      a = fx.mul(a, mod);
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

  /** Scratch written by `eyePoint` and read straight after it: the hot loops
   *  allocate nothing (the `presentedArc` idiom). Never hashed. */
  private eyeX: Fx = 0;
  private eyeY: Fx = 0;

  /**
   * Where unit `i` looks and shoots from toward (tx, ty) (G1, B6; lead
   * ruling 2026-10-14). In the open: where it stands. Garrisoned: the centre
   * of its building's footprint tile nearest (tx, ty) -- the window on that
   * side. Its POSITION stays the centroid (where it is drawn, and where a
   * near miss is measured to); only range, sight and the line of fire start
   * at the window. Ties go to the first tile in footprint order. A footprint
   * tile is always inside the building, so a centroid that falls on open
   * ground (two khan_rafid_3 shanties) no longer blinds the men inside.
   */
  private eyePoint(i: number, tx: Fx, ty: Fx): void {
    const s = this.garrisonedIn[i];
    if (s < 0) {
      this.eyeX = this.posX[i];
      this.eyeY = this.posY[i];
      return;
    }
    let best = 0x7fffffff;
    let bx = this.stCx[s];
    let by = this.stCy[s];
    const w = this.width;
    for (const t of this.stTiles[s]) {
      const x = t % w;
      const y = (t - x) / w;
      const cx = fx.add(fx.fromInt(x), HALF);
      const cy = fx.add(fx.fromInt(y), HALF);
      const d = distSqFx(fx.sub(cx, tx), fx.sub(cy, ty));
      if (d < best) {
        best = d;
        bx = cx;
        by = cy;
      }
    }
    this.eyeX = bx;
    this.eyeY = by;
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
    this.braceClear(id);
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

  /**
   * Free the slot of a unit that dies or is removed inside a building (B5,
   * ruling 2026-10-14). `stOccupants` is the count of LIVING units with
   * `garrisonedIn === s`; before this a body kept its slot until the
   * building fell, so the man waiting at the door never got in. No exit move
   * and no `garrison` event: nobody walked out. Clearing `garrisonedIn` is
   * what destroyStructure already does for the men it kills.
   */
  private releaseSlot(id: number): void {
    const s = this.garrisonedIn[id];
    if (s < 0) return;
    this.garrisonedIn[id] = -1;
    if (this.stOccupants[s] > 0) this.stOccupants[s]--;
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
    if (this.woundLive) this.refreshSpeedMul(car);
    // Step clear of the hull so they do not stack on it.
    let px = this.clampX(fx.add(this.posX[car], HALF));
    let py = this.clampY(fx.add(this.posY[car], HALF));
    // GH-698 item 7: that spot can be a wall. Only then stand on the nearest
    // open tile centre of the RIDER's own domain (foot: a boulder is fine;
    // a wheeled rider needs a vehicle-passable tile); an open landing is
    // bit-identical to before.
    const mask = this.maskFor(this.domainOf(id));
    const tx = fx.toInt(px);
    const ty = fx.toInt(py);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height || mask[ty * this.width + tx] !== 0) {
      this.snapOpenTile(tx, ty, mask);
      px = fx.add(fx.fromInt(this.snapX), HALF);
      py = fx.add(fx.fromInt(this.snapY), HALF);
    }
    this.posX[id] = px;
    this.posY[id] = py;
    this.moving[id] = 0;
    this.fieldRef[id] = -1;
    // GH-707 Task 4: a wounded rider is put down where the hull died, alive and in the state
    // he was carried in -- not hurt and shaken. The bail-out's 40% would be lethal to a man
    // downed in place (he lies at 1 hp) and is meaningless to one already out of the fight;
    // the stretcher, not the man, came off the hull.
    if (shaken && !(this.woundLive && this.horsDeCombat(id))) {
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
      // GH-698: a rider bound for an air carrier whose load plan is gone (a
      // move lifted it, an unload or halt replaced the want) is released, so it
      // neither waits at a stale LZ nor boards uninvited at the next landing.
      // A carrier still landing or landed to load keeps its riders.
      if (this.unitTypes[this.typeIdx[goal]].isAirCarrier && this.airWant[goal] !== AIR_WANT_LOAD) {
        this.boardGoal[i] = -1;
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      if (!this.canSeat(goal, i)) continue; // no seat yet, or not eligible
      const d = distSqFx(fx.sub(this.posX[goal], this.posX[i]), fx.sub(this.posY[goal], this.posY[i]));
      if (d > LOAD_RANGE_SQ) {
        // Keep chasing a vehicle that has moved on. GH-581: the flow field follows the goal, so
        // when the hull crosses into a new tile the rider is re-pointed at it. Left on the tile
        // the order was given for, he walked there, arrived, and halted short of a moving hull.
        // `fieldFor` is cached by (tile, domain), so riders of one carrier share the field, and
        // it recomputes only on a tile change. An air carrier keeps its LZ field (GH-698).
        const gtx = fx.toInt(this.posX[goal]);
        const gty = fx.toInt(this.posY[goal]);
        const moved = this.fieldRef[i] < 0 || gtx !== fx.toInt(this.goalX[i]) || gty !== fx.toInt(this.goalY[i]);
        this.goalX[i] = this.posX[goal];
        this.goalY[i] = this.posY[goal];
        if (moved && !this.unitTypes[this.typeIdx[goal]].isAirCarrier) {
          this.fieldRef[i] = this.fieldFor(gtx, gty, this.domainOf(i));
        }
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
  private canSeat(car: number, id: number, atSpawn = false): boolean {
    if (car < 0 || car >= this.count || this.alive[car] === 0) return false;
    const slots = this.unitTypes[this.typeIdx[car]].transportSlots;
    if (slots === 0 || this.passengers[car] >= slots) return false;
    if (id === car || id < 0 || id >= this.count || this.alive[id] === 0) return false;
    // Only dismounted elements ride. This also covers vehicle stacking, since no
    // carrier is a foot role.
    // GH-707 Task 4, the role filter. A carrier with `can_carry` seats ONLY the roles it
    // lists; a wounded rider (down, or a `wounded`-role body) is seated by one listing
    // `wounded` whatever his `canEmbark`, and by NO carrier without `can_carry` (an APC is not
    // an ambulance). No shipped type has `can_carry` and every woundState is NONE without
    // wound content, so the shipped answer is exactly the `canEmbark` line, as before.
    const carType = this.unitTypes[this.typeIdx[car]];
    const riderType = this.unitTypes[this.typeIdx[id]];
    const woundedRider = this.woundState[id] !== WOUND_NONE || riderType.isWounded;
    if (carType.canCarry !== null) {
      if (woundedRider) {
        if (!carType.canCarry.includes('wounded')) return false;
      } else if (!riderType.canEmbark || !carType.canCarry.includes(riderType.role)) {
        return false;
      }
    } else if (woundedRider || !riderType.canEmbark) {
      return false;
    }
    // GH-707 D3: a medic carrying a wounded does not board anything himself -- no nested
    // carrying; he hands the man over instead (`transferSeat`). Only a `rescue` type can be
    // refused here, and only content gives a type one.
    if (riderType.rescue !== null && this.passengers[id] > 0) return false;
    // Neither party may be underground: a buried rider cannot reach a seat,
    // and a buried hull is not a place a surface unit can climb into. The
    // deepest gate — embarkAtSpawn and boarding both pass through here.
    if (this.tunnelIn[id] >= 0 || this.tunnelIn[car] >= 0) return false;
    if (this.carriedBy[id] >= 0) return false;
    // GH-698 R3: an air carrier seats nobody until it is LANDED. Tested last,
    // so a ground carrier answers exactly as before. A mission's authored
    // passengers (embarkAtSpawn) are the one exception: R8, the carrier
    // spawns airborne and loaded.
    if (atSpawn || !this.unitTypes[this.typeIdx[car]].isAirCarrier) return true;
    return this.airState[car] === AIR_LANDED;
  }

  /** Put `id` in a seat. Extracted so boarding and authored-aboard share it. */
  private seat(car: number, id: number): void {
    this.carriedBy[id] = car;
    this.braceClear(id);
    this.boardGoal[id] = -1;
    this.passengers[car]++;
    if (this.woundLive) this.refreshSpeedMul(car);
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
   * GH-707 Task 4: `car`'s movement multiplier from what it carries. A medic (`rescue`)
   * carrying anyone moves at `dragMult`, or `carryMult` when the team has two men or more
   * (a stretcher); empty, or not a medic, ONE. Called from `seat` and `disembark` only while
   * `woundLive`, so a world without wound content never writes the column.
   */
  private refreshSpeedMul(car: number): void {
    const r = this.unitTypes[this.typeIdx[car]].rescue;
    if (r === null) return;
    if (this.passengers[car] === 0) this.speedMul[car] = ONE;
    else this.speedMul[car] = this.unitTypes[this.typeIdx[car]].figures >= 2 ? r.carryMult : r.dragMult;
  }

  /**
   * GH-707 Task 4: hand rider `id` from `fromCar` to `toCar` in one step -- a medic passing a
   * wounded into an ambulance (D3: no nested carrying). Seats, types and states only, by
   * `canSeat`'s own rule as if he were already down; distance is the caller's business, as
   * for `canSeat`. False, and nothing written, when he is not aboard `fromCar` or `toCar`
   * cannot take him. Otherwise one `transport` unload then one load, and he is on `toCar`'s
   * hull the same tick: no frame beside either vehicle.
   */
  private transferSeat(fromCar: number, toCar: number, id: number): boolean {
    if (fromCar === toCar || id < 0 || id >= this.count || this.carriedBy[id] !== fromCar) return false;
    this.carriedBy[id] = -1; // canSeat refuses a rider already aboard something
    const ok = this.canSeat(toCar, id);
    this.carriedBy[id] = fromCar;
    if (!ok) return false;
    this.disembark(id, false);
    this.seat(toCar, id);
    this.posX[id] = this.posX[toCar];
    this.posY[id] = this.posY[toCar];
    this.facing[id] = this.facing[toCar];
    return true;
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
    if (!this.canSeat(car, id, true)) return false;
    if (this.garrisonedIn[id] >= 0) this.leaveStructure(id);
    this.seat(car, id);
    // Snap onto the hull, so a passenger never renders beside a vehicle it is
    // inside for the tick before stepTransport runs.
    this.posX[id] = this.posX[car];
    this.posY[id] = this.posY[car];
    this.facing[id] = this.facing[car];
    return true;
  }

  // ------------------------------------------------------------ air carriers
  // GH-698 R1-R4. An air carrier (isAir with seats) lands to load and lands to
  // unload: AIRBORNE -> LANDING (AIR_LAND_TICKS) -> LANDED -> LIFTING
  // (AIR_LIFT_TICKS) -> AIRBORNE, and it does not move outside AIRBORNE.
  // `airWant` is what it was last asked to land for. No rng anywhere: every
  // choice is a fixed scan order (invariant 3). Nothing here runs, and nothing
  // here is reachable, in a world with no air carrier type and no
  // mobility-killed aircraft (`airLive`).
  //
  // #706 §3.5: the machine runs for EVERY air type. A non-carrier's `airWant`
  // is always NONE (only load/unload, carrier-only, set it), so for a gunship
  // or a drone only the forced landing and the LANDED hold ever apply; a
  // healthy one stays AIRBORNE and is skipped on the `want` check.

  /**
   * One tick of the machine, for every aircraft. Called immediately before
   * stepMovement, so the `moving = 0` it writes outside AIRBORNE wins over every
   * setter earlier in the tick (orders, stepFocus, stepSweep).
   */
  private stepAirCarriers(): void {
    if (!this.airLive) return;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || !this.unitTypes[this.typeIdx[i]].isAir) continue;
      let st = this.airState[i];
      if (st === AIR_AIRBORNE) {
        // A hull that cannot move never reaches an LZ, so it would hover for
        // good with its riders shut in (4 of 160 probe runs): it comes down.
        if (this.mobilityKilled[i] === 1) {
          this.forcedLanding(i);
          continue;
        }
        const want = this.airWant[i];
        if (want !== AIR_WANT_LOAD && want !== AIR_WANT_UNLOAD) continue;
        if (this.moving[i] !== 0) continue; // still flying to the LZ
        const dx = fx.sub(this.posX[i], this.goalX[i]);
        const dy = fx.sub(this.posY[i], this.goalY[i]);
        if (dx > HALF || dx < -HALF || dy > HALF || dy < -HALF) continue; // stopped short: hovers
        this.airState[i] = AIR_LANDING;
        this.airTimer[i] = AIR_LAND_TICKS;
        // Onto the LZ tile centre exactly (it is within HALF already), so the
        // pin and unloadAir's spread are about the LZ itself.
        this.posX[i] = this.goalX[i];
        this.posY[i] = this.goalY[i];
        this.wpCount[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      if (st === AIR_LANDING) {
        this.moving[i] = 0; // a move while landing is ignored
        const t = this.airTimer[i] - 1;
        this.airTimer[i] = t;
        if (t > 0) continue;
        this.airState[i] = AIR_LANDED;
        st = AIR_LANDED; // and the LANDED rules, this same tick
      }
      if (st === AIR_LANDED) {
        if (this.airWant[i] === AIR_WANT_UNLOAD) {
          this.unloadAir(i);
          this.airWant[i] = AIR_WANT_NONE; // it stays landed
        }
        if (this.moving[i] === 1) {
          if (this.airWant[i] === AIR_WANT_LOAD || this.mobilityKilled[i] === 1) {
            // A mobility-killed hull stays down until the kill is repaired.
            // Landed to load: only an order (which clears the want) lifts it,
            // never an autonomous chase.
            this.moving[i] = 0;
          } else {
            this.airState[i] = AIR_LIFTING;
            this.airTimer[i] = AIR_LIFT_TICKS;
            this.airWant[i] = AIR_WANT_DEPART;
            // GH-707 Task 4 (D4): a medevac lifting off takes its wounded out of the fight.
            if (this.woundLive && this.passengers[i] > 0) this.evacuateAboard(i);
            this.moving[i] = 0; // goal and waypoints are kept for the lift's end
          }
        }
        continue;
      }
      // AIR_LIFTING
      this.moving[i] = 0;
      const t = this.airTimer[i] - 1;
      this.airTimer[i] = t;
      if (t > 0) continue;
      this.airState[i] = AIR_AIRBORNE;
      const want = this.airWant[i];
      if (want === AIR_WANT_UNLOAD) {
        // An `unload` while lifting: taken up now, at the LZ nearest where it is.
        if (this.passengers[i] > 0 && this.orderLand(i, AIR_WANT_UNLOAD, this.posX[i], this.posY[i])) continue;
        this.airWant[i] = AIR_WANT_NONE;
      } else if (want !== AIR_WANT_LOAD) {
        this.airWant[i] = AIR_WANT_NONE;
      }
      // A `load` while lifting keeps its plan: orderLand already set the LZ goal.
      this.moving[i] = 1;
    }
  }

  /**
   * Forced landing (fix/air-pathing, lead ruling 21 Oct 2026; every air type
   * since #706 §3.5): an AIRBORNE aircraft whose mobility is knocked out (`mobilityKilled`, from the
   * component roll's `mobility_kill` or `combat_ineffective`) starts LANDING
   * at once -- where it is when its tile is foot-open, else on the centre of
   * the nearest foot-open tile (a rifleman's ground, not the vehicle LZ rule:
   * it is coming down, not choosing where; a boulder field will do). Its want
   * is kept (an AIRBORNE carrier never holds DEPART), so a queued
   * `unload` empties it on landing like any other; otherwise the riders stay
   * aboard and an `unload` order lets them out (LANDED unloads at once). On a
   * map with no foot-open tile at all it keeps hovering. No rng, no allocation.
   */
  private forcedLanding(car: number): void {
    const w = this.width;
    const h = this.height;
    let tx = fx.toInt(this.posX[car]);
    let ty = fx.toInt(this.posY[car]);
    tx = tx < 0 ? 0 : tx >= w ? w - 1 : tx;
    ty = ty < 0 ? 0 : ty >= h ? h - 1 : ty;
    const mask = this.blocked;
    if (mask[ty * w + tx] !== 0) {
      this.snapOpenTile(tx, ty, mask);
      if (mask[this.snapY * w + this.snapX] !== 0) return; // nowhere to come down
      this.posX[car] = fx.add(fx.fromInt(this.snapX), HALF);
      this.posY[car] = fx.add(fx.fromInt(this.snapY), HALF);
    }
    this.airState[car] = AIR_LANDING;
    this.airTimer[car] = AIR_LAND_TICKS;
    this.goalX[car] = this.posX[car];
    this.goalY[car] = this.posY[car];
    this.moving[car] = 0;
    this.wpCount[car] = 0;
    this.fieldRef[car] = -1;
  }

  /**
   * R2: into `snapX`/`snapY`, the open tile nearest (x, y) on the VEHICLE mask --
   * a rotor does not set down on a building, a ridge, a boulder field or a
   * ditch, though a rifleman can stand on a boulder. False when the map has no
   * such tile at all; snapX/snapY are then meaningless.
   */
  private lzFor(x: Fx, y: Fx): boolean {
    const w = this.width;
    const h = this.height;
    let tx = fx.toInt(x);
    let ty = fx.toInt(y);
    tx = tx < 0 ? 0 : tx >= w ? w - 1 : tx;
    ty = ty < 0 ? 0 : ty >= h ? h - 1 : ty;
    const mask = this.maskFor(DOMAIN_VEHICLE);
    this.snapOpenTile(tx, ty, mask);
    return mask[this.snapY * w + this.snapX] === 0;
  }

  /**
   * Send air carrier `car` to land at the LZ nearest (x, y), for `want`. The
   * flight is the move order's own air leg: goal, air-domain field, `moving`.
   * False, with no state touched, when there is no LZ.
   */
  private orderLand(car: number, want: number, x: Fx, y: Fx): boolean {
    if (!this.lzFor(x, y)) return false;
    const lx = this.snapX;
    const ly = this.snapY;
    this.goalX[car] = fx.add(fx.fromInt(lx), HALF);
    this.goalY[car] = fx.add(fx.fromInt(ly), HALF);
    this.wpCount[car] = 0;
    this.fieldRef[car] = this.fieldFor(lx, ly, DOMAIN_AIR);
    this.moving[car] = 1;
    this.attackMove[car] = 0;
    this.sweepOrder[car] = 0;
    this.engaging[car] = 0;
    this.stance[car] = 0;
    this.focusTarget[car] = -1;
    this.focusLost[car] = 0;
    this.airWant[car] = want;
    return true;
  }

  /**
   * R3, the carrier's half of a `load`. In flight (or lifting) it is ordered to
   * the LZ nearest the eligible riders' centroid (tile ints, id order, the
   * formation's integer mean). LANDING or LANDED it stays on the LZ it has and
   * waits to load there. False -- the whole `load` refused -- with no eligible
   * rider, no LZ, or a landing to unload under way.
   */
  private airLoadOrder(car: number, ids: readonly number[]): boolean {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (this.alive[id] === 0 || this.routed[id] === 1 || id === car) continue;
      if (!this.unitTypes[this.typeIdx[id]].canEmbark || this.carriedBy[id] >= 0) continue;
      sx += fx.toInt(this.posX[id]);
      sy += fx.toInt(this.posY[id]);
      n++;
    }
    if (n === 0) return false;
    const st = this.airState[car];
    if (st === AIR_LANDING || st === AIR_LANDED) {
      // Landing to unload: the load is refused (its riders would be released
      // the moment the unload clears the want).
      if (this.airWant[car] === AIR_WANT_UNLOAD) return false;
      this.airWant[car] = AIR_WANT_LOAD;
      return true;
    }
    const cx = (sx - (sx % n)) / n;
    const cy = (sy - (sy % n)) / n;
    return this.orderLand(car, AIR_WANT_LOAD, fx.add(fx.fromInt(cx), HALF), fx.add(fx.fromInt(cy), HALF));
  }

  /** R4, `unload` on an air carrier: land, then everyone out. Empty: a no-op. */
  private airUnloadOrder(car: number): void {
    if (this.alive[car] === 0 || this.passengers[car] === 0) return;
    const st = this.airState[car];
    if (st === AIR_LANDED) this.unloadAir(car);
    else if (st === AIR_AIRBORNE) this.orderLand(car, AIR_WANT_UNLOAD, this.posX[car], this.posY[car]);
    else this.airWant[car] = AIR_WANT_UNLOAD; // LANDING: on landing; LIFTING: after the lift
  }

  /** `halt` (and a stance, which halts) on an air carrier, after haltUnit.
   *  Airborne, the land plan is cancelled and it hovers. Lifting, it hovers
   *  where it lifted. Landing completes; landed stays. */
  private haltAir(id: number): void {
    // #706: any air type -- a non-carrier lifting after a workshop cleared its
    // forced landing hovers on a halt like a carrier does.
    if (!this.unitTypes[this.typeIdx[id]].isAir) return;
    const st = this.airState[id];
    if (st === AIR_AIRBORNE) {
      this.airWant[id] = AIR_WANT_NONE;
    } else if (st === AIR_LIFTING) {
      this.goalX[id] = this.posX[id];
      this.goalY[id] = this.posY[id];
      this.airWant[id] = AIR_WANT_DEPART;
    }
  }

  /**
   * Landed unload: everyone out at once. Passenger k (id order) stands on the
   * k-th foot-open tile of the LZ and its 8 neighbours, taken by (distance,
   * tile index) -- AIR_SPREAD_DX/DY's order -- wrapping when there are more
   * passengers than tiles. Scratch `spreadTiles`, no allocation.
   */
  private unloadAir(car: number): void {
    if (this.passengers[car] === 0) return;
    const w = this.width;
    const h = this.height;
    const lx = fx.toInt(this.posX[car]);
    const ly = fx.toInt(this.posY[car]);
    let n = 0;
    let spreadMask: Uint8Array | null = null;
    let k = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.carriedBy[i] !== car) continue;
      // The spread is per rider domain: a wheeled rider skips boulder tiles.
      const mask = this.maskFor(this.domainOf(i));
      if (mask !== spreadMask) {
        spreadMask = mask;
        n = 0;
        for (let j = 0; j < 9; j++) {
          const x = lx + AIR_SPREAD_DX[j];
          const y = ly + AIR_SPREAD_DY[j];
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const t = y * w + x;
          if (mask[t] !== 0) continue;
          this.spreadTiles[n++] = t;
        }
      }
      this.disembark(i, false);
      if (n > 0) {
        const t = this.spreadTiles[k % n];
        const tx = t % w;
        this.posX[i] = fx.add(fx.fromInt(tx), HALF);
        this.posY[i] = fx.add(fx.fromInt((t - tx) / w), HALF);
      }
      k++;
    }
  }

  /** unloadAir's scratch: the open spread tiles. Never hashed. */
  private readonly spreadTiles = new Int32Array(9);

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
        if (this.woundLive && this.horsDeCombat(t)) continue; // GH-707: nor at a wounded man
        if (this.contact[side * cap + t] < IDENTIFIED_AT) continue;
        // A munition picks its own target, so the can_target rule has to be
        // applied here too -- selectTarget is never consulted on this path. A
        // ground-attack warhead chasing an aircraft would fly at it forever.
        if (this.isAirborne(t) ? !w.canTargetAir : !w.canTargetGround) continue;
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
        const z = penZ(w.penetration, tType.armorSide);
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
          this.applySuppression(
            target,
            fx.mul(w.suppPerMiss, BOUNCE_SUPP_MULT),
            true,
            this.side[i],
            this.posX[i],
            this.posY[i],
          );
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
      const atDoor = this.structDistSq(s, this.posX[i], this.posY[i]) <= GARRISON_ENTER_RANGE_SQ;
      if (this.stOccupants[s] >= type.garrisonSlots) {
        // Full: wait at the door, stopped, with the order kept (B3, ruling
        // 2026-10-14). A unit left `moving` pressed on the wall for good --
        // a halt-to-fire man never knelt, so never fired. Stopped, stepBrace
        // kneels him and stepCombat lets him shoot; this loop still runs
        // every tick, so he walks in the tick a slot frees.
        if (atDoor && this.moving[i] === 1) {
          this.moving[i] = 0;
          this.fieldRef[i] = -1;
        }
        continue;
      }
      if (atDoor) this.enterStructure(i, s);
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
      } else if (type.placed === null) {
        // A `placed` demolisher has no initiative (E6 G1): it sets a charge only on an explicit
        // `demolish` order, never because it halted beside a house. `best` stays -1.
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
          // Nor the side's own field camp. Production deploys there and is
          // lost with it, and a demolisher that merely spawns or halts within
          // two tiles of it would level it on its own initiative before the
          // first order: Umm Zeitoun II's demo_squad, placed one tile off the
          // camp's footprint, brought the camp down at tick 100 and every
          // build card read 'field camp destroyed' for the rest of the mission
          // (2026-09-06). The scripted plan never saw it because it orders
          // the squad away at tick 20. Levelling your own camp is an order,
          // like cutting your own wire.
          if (this.stProducesFor[s] === this.side[i]) continue;
          // Nor a field work the side owns (#277): a `demo_squad` is both the engineer who
          // raises one and a demolisher, and standing beside its own site to build it would
          // otherwise bring the site down 100 ticks after staking. Razing your own works is an
          // order. An enemy's works (owner 1 against side 0) is fair game, as any building is.
          if (this.stOwner[s] === this.side[i]) continue;
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
        if (type.placed !== null) {
          // The charge is SET, not the building taken: it falls when the fuse runs out
          // (stepCharges). The order is done, and the carrier backs away on its own.
          this.setPlacedCharge(best, i, type.placed);
          this.demolishOrder[i] = -1;
          this.withdrawFromStructure(i, best, type.placed.withdraw);
        } else {
          this.destroyStructure(best, i);
        }
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
   * E6 G1: arm a placed charge on `s`, credited to `by`. A structure carries one charge: a
   * second carrier finishing its three seconds against an already-armed wall changes nothing
   * (the first fuse keeps burning, with the first carrier's name on it).
   */
  private setPlacedCharge(s: number, by: number, pc: PlacedCharge): void {
    if (this.stChargeTicks[s] > 0) return;
    this.placedLive = true;
    this.stChargeTicks[s] = pc.fuseTicks;
    this.stChargeBy[s] = by;
    this.pendingEvents.push({ kind: 'chargeSet', tick: this.tickCount, structure: s, by, fuseTicks: pc.fuseTicks });
  }

  /**
   * E6 G1: walk unit `i` `tiles` away from structure `s`'s centre, along the line from the
   * centre through the unit (due +x when it stands exactly on the centre), to the nearest open
   * tile of its own domain. Integer maths and the one open-tile search, so the retreat is the
   * same on every machine. Allocation-free (snapOpenTile).
   */
  private withdrawFromStructure(i: number, s: number, tiles: Fx): void {
    const dx = fx.sub(this.posX[i], this.stCx[s]);
    const dy = fx.sub(this.posY[i], this.stCy[s]);
    const len = fx.sqrt(distSqFx(dx, dy));
    let ux: Fx = ONE;
    let uy: Fx = 0;
    if (len > 0) {
      ux = fx.div(dx, len);
      uy = fx.div(dy, len);
    }
    const wx = this.clampX(fx.add(this.posX[i], fx.mul(ux, tiles)));
    const wy = this.clampY(fx.add(this.posY[i], fx.mul(uy, tiles)));
    const domain = this.domainOf(i);
    const tx = fx.toInt(wx);
    const ty = fx.toInt(wy);
    let gx = wx;
    let gy = wy;
    let gtx = tx;
    let gty = ty;
    if (!this.unitTypes[this.typeIdx[i]].isAir) {
      this.snapOpenTile(tx, ty, this.maskFor(domain));
      if (this.snapX !== tx || this.snapY !== ty) {
        gtx = this.snapX;
        gty = this.snapY;
        gx = fx.add(fx.fromInt(gtx), HALF);
        gy = fx.add(fx.fromInt(gty), HALF);
      }
    }
    this.wpCount[i] = 0;
    this.boardGoal[i] = -1;
    this.garrisonGoal[i] = -1;
    this.goalX[i] = gx;
    this.goalY[i] = gy;
    this.fieldRef[i] = this.fieldFor(gtx, gty, domain);
    this.moving[i] = 1;
    this.attackMove[i] = 0;
    this.sweepOrder[i] = 0;
    this.engaging[i] = 0;
    this.stance[i] = 0;
  }

  /**
   * E6 G1: burn every armed fuse one tick. At zero the structure falls (`destroyStructure`,
   * which also kills the garrison and shakes the neighbours) and THEN the blast goes off at its
   * centre (`splashDirect`): every soft unit within the radius takes damage and suppression, own
   * troops and civilians included. The carrier is the attribution whether or not it is still
   * alive, so ROE and veterancy read it the way they read any demolition: ids are never reused
   * and `side`/`typeIdx` outlive death. A structure that fell some other way first takes its
   * charge with it (`destroyStructure` clears it), with no blast and no event.
   */
  private stepCharges(): void {
    if (!this.placedLive) return;
    for (let s = 0; s < this.structureCount_; s++) {
      if (this.stChargeTicks[s] <= 0) continue;
      if (this.stAlive[s] === 0) {
        this.stChargeTicks[s] = 0;
        this.stChargeBy[s] = -1;
        continue;
      }
      if (--this.stChargeTicks[s] > 0) continue;
      const by = this.stChargeBy[s];
      this.stChargeBy[s] = -1;
      const pc = by >= 0 ? this.unitTypes[this.typeIdx[by]].placed : null;
      if (pc === null) continue;
      const cx = this.stCx[s];
      const cy = this.stCy[s];
      this.destroyStructure(s, by);
      this.pendingEvents.push({ kind: 'chargeDetonated', tick: this.tickCount, structure: s, by });
      this.splashDirect(cx, cy, pc.blast, pc.damage, pc.suppression, by, -1);
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
    // A charge against a wall that fell some other way goes with it (E6 G1).
    this.stChargeTicks[s] = 0;
    this.stChargeBy[s] = -1;
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
      if (d <= COLLAPSE_SHOCK_SQ) {
        this.applySuppression(i, COLLAPSE_SHOCK, false, by >= 0 ? this.side[by] : -1, this.stCx[s], this.stCy[s]);
      }
    }
    this.stOccupants[s] = 0;
    this.recomputeFields();
  }

  private destroy(target: number, by: number): void {
    // Anyone riding in it comes out now, hurt and shaken -- unless it is an
    // air carrier shot down in the air (GH-698 R5): AIRBORNE or LIFTING, which
    // is exactly `isAirborne` for an air type (Q-C). Then everyone aboard dies
    // with it, each through this same path, so the kill, ROE and veterancy
    // credit go to `by` as for any other death. LANDING and LANDED (a ground
    // target) and every ground carrier bail out as before.
    if (this.passengers[target] > 0) {
      const takesAll = this.unitTypes[this.typeIdx[target]].isAirCarrier && this.isAirborne(target);
      for (let i = 0; i < this.count; i++) {
        if (this.carriedBy[i] !== target || this.alive[i] !== 1) continue;
        if (takesAll) {
          this.carriedBy[i] = -1;
          this.passengers[target]--;
          this.destroy(i, by);
        } else {
          this.disembark(i, true);
        }
      }
    }
    if (this.woundLive) this.forgetWounded(target);
    this.alive[target] = 0;
    this.releaseSlot(target);
    for (let s = 0; s < 2; s++) this.lastSeenValid[s * this.capacity + target] = 0;
    this.hp[target] = 0;
    this.moving[target] = 0;
    this.engaging[target] = 0;
    this.fieldRef[target] = -1;
    this.pendingEvents.push({ kind: 'destroyed', tick: this.tickCount, entity: target, by });
  }

  /**
   * Targeted fire (GH-420, Task 2): what a unit under an `attack` order does
   * between shots. selectTarget is what makes it SHOOT the focus; this is
   * whether the order still stands and where the unit stands.
   *
   * The order ENDS (T-D3, T-D4) when the target dies, boards, garrisons,
   * goes under or stops being an enemy (`focusStillTargetable`, canFocus's
   * own rule), or when it is lost (R-4): `focusLost` counts consecutive
   * ticks with the side's confidence below IDENTIFIED_AT and resets on
   * re-identification; the order ends when it reaches FOCUS_LOST_TICKS, or at
   * once if the side holds no last-seen position to walk to. An ended order
   * hands the unit back as an ARRIVED attack-mover where it stands: it holds
   * and fights what comes inside its reach, and it does not sweep (#537), so
   * a far contact does not pull it off its ground.
   *
   * A standing order MOVES the unit only if it can move: never a garrisoned
   * (R-5), carried, buried, pinned, routed, mobility-killed or immobile unit.
   * Those keep the order and are not touched -- a garrisoned one still fires
   * on its focus from the window once it is in reach; a pinned one finishes
   * crawling whatever leg it was on, as under any order. A firepower-killed
   * one keeps the order too, and is STOPPED: there is nothing to walk into
   * range with.
   *
   * Otherwise: in reach (`focusInReach`, R-3/R-3b; a stopped unit stays in
   * reach half a tile past the plain edge, R-22), it stops (`moving = 0`;
   * stepBrace kneels it next tick). Out of reach, or lost, it walks to the
   * side's last-seen position (R-14) -- the target itself while someone sees
   * it, the memory when nobody does -- and waits on that tile. The field is
   * asked for only when that goal TILE changes or the unit has none (T-D6):
   * a chase costs one field per tile the target crosses, not one per tick.
   *
   * A chaser runs with `attackMove = 0`, which is the plain-move posture
   * everywhere else: stepBrace keeps it on its feet (a halt-to-fire unit
   * holds its fire until stopped), stepMovement's attack-move halt does not
   * apply (this step is what stops it), and isEffectivelyMoving counts it as
   * moving until it stops.
   */
  private stepFocus(): void {
    const cap = this.capacity;
    for (let i = 0; i < this.count; i++) {
      const t = this.focusTarget[i];
      if (t < 0) continue;
      if (this.alive[i] === 0) {
        // A dead unit's order dies with it. Nothing else in the tick reads
        // it, but the state view would still show it.
        this.focusTarget[i] = -1;
        this.focusLost[i] = 0;
        continue;
      }
      const sSide = this.side[i];
      const k = sSide * cap + t;
      let lost = false;
      let ended = !this.focusStillTargetable(sSide, t);
      if (!ended) {
        if (this.contact[k] < IDENTIFIED_AT) {
          lost = true;
          const n = this.focusLost[i] + 1;
          if (this.lastSeenValid[k] === 0 || n >= FOCUS_LOST_TICKS) ended = true;
          else this.focusLost[i] = n;
        } else {
          this.focusLost[i] = 0;
        }
      }
      if (ended) {
        this.focusTarget[i] = -1;
        this.focusLost[i] = 0;
        this.attackMove[i] = 1;
        this.sweepOrder[i] = 0;
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      if (
        this.garrisonedIn[i] >= 0 ||
        this.carriedBy[i] >= 0 ||
        this.tunnelIn[i] >= 0 ||
        this.pinned[i] === 1 ||
        this.routed[i] === 1 ||
        this.mobilityKilled[i] === 1 ||
        this.unitTypes[this.typeIdx[i]].stepPerTick === 0
      ) {
        continue;
      }
      if (this.firepowerKilled[i] === 1) {
        // Its guns are gone: the order stands (the target may still die, or
        // be lost, and hand it back), but it is not walked a step closer to
        // an enemy it can no longer shoot. A chase this step started stops
        // here -- left alone, the leg would carry it onto the target's last
        // tile.
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      // Not lost and in reach: stop, and stepBrace kneels it next tick.
      if (!lost && this.focusInReach(i, t)) {
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      // Otherwise walk to where the side last saw it (R-14). While the target
      // is observed that IS its position, updated every tick in
      // stepDetection; in the ~3.6 s an identified contact takes to decay
      // unobserved, and while lost, it is the memory -- the chase never
      // follows a position nobody on the side can see. Identified with no
      // valid memory (a sweeper searched the spot): nothing to walk to this
      // tick; the unit waits, and still shoots if combat can.
      if (this.lastSeenValid[k] === 0) {
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      const rawX = this.lastSeenX[k];
      const rawY = this.lastSeenY[k];
      const rtx = rawX >> 16;
      const rty = rawY >> 16;
      // The goal snapped to ground this unit's domain can stand on: a vehicle
      // chasing a man into a boulder field drives to the edge of it, where a
      // raw goal gives it a straight-line final leg into the wall. Kept to
      // the exact point when its own tile is open, as `move` keeps the point
      // clicked; the tile centre otherwise. Air flies over everything and is
      // never snapped. Allocation-free (snapOpenTile), since it runs per tick.
      const domain = this.domainOf(i);
      let gx = rawX;
      let gy = rawY;
      let gtx = rtx;
      let gty = rty;
      if (!this.unitTypes[this.typeIdx[i]].isAir) {
        this.snapOpenTile(rtx, rty, this.maskFor(domain));
        if (this.snapX !== rtx || this.snapY !== rty) {
          gtx = this.snapX;
          gty = this.snapY;
          gx = fx.add(fx.fromInt(gtx), HALF);
          gy = fx.add(fx.fromInt(gty), HALF);
        }
      }
      // Already standing on the goal tile: wait there (for the lost counter,
      // or for the side to see the target again). Walking "to" the tile it
      // is on would re-issue the leg every tick and stepMovement would end it
      // every tick -- a halt-to-fire man dropping and rising on the spot.
      if (this.posX[i] >> 16 === gtx && this.posY[i] >> 16 === gty) {
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
        continue;
      }
      const newTile = this.goalX[i] >> 16 !== gtx || this.goalY[i] >> 16 !== gty;
      this.goalX[i] = gx;
      this.goalY[i] = gy;
      // T-D6: a field per goal TILE, not per tick.
      if (newTile || this.fieldRef[i] < 0) this.fieldRef[i] = this.fieldFor(gtx, gty, domain);
      this.moving[i] = 1;
    }
  }

  /**
   * Is focus `t` inside the reach `i` should stop at? Ruling R-3, as amended
   * by R-3b. Inside the EFFECTIVE range of any slot that can fire on it now
   * -- engageable (domain, maximum and minimum range, sight or an indirect
   * class) and weaponHurts -- the same OR over slots the `engaging` latch
   * takes: a gunship whose Hellfire already hurts a tank stops at Hellfire
   * range, not chain-gun range. Selection still reaches to `rangeSq`; this is
   * only where the unit stops walking.
   *
   * When NO slot can fire on it, the unit holds only if closing could not
   * fix that: some slot able to aim at the target's domain is inside its
   * effective (and maximum) range with a sight line, or is indirect, and so
   * fails on penetration or minimum range alone -- a rifle at a tank's front,
   * a mortar with the enemy on top of it. Any other blocker (out of every
   * slot's range, no sight line, a domain only an out-of-range slot can
   * reach) is fixed by walking, so it keeps closing. Nothing parks an
   * ordered unit for good behind a wall.
   *
   * Hysteresis (R-22): a unit that has already stopped (`moving` 0) is judged
   * against `effectiveRange + FOCUS_REACH_SLACK` in both places above, a unit
   * still walking against the plain effective range. A target on the edge
   * therefore cannot make a halted man kneel and rise by turns: he stops at
   * the plain edge, and it takes the target a clear half tile further to
   * stand him up. Stateless -- it reads `moving`, which stepFocus itself
   * writes. Only this decision moves: maximum range (`rangeSq`), and with it
   * what a slot may fire at, is untouched.
   *
   * A garrisoned unit never reaches this: stepFocus `continue`s on
   * `garrisonedIn >= 0` before calling it. So the centroid `dSq` and the
   * lift-0 `losRay` below are not a garrison path (the window and the floor
   * lift live in `eyePoint` / `eyeLift`). The garrison-aware `effSq` /
   * `effRange` / `reachSq` reads are kept so the range rule is written once.
   */
  private focusInReach(i: number, t: number): boolean {
    const weapons = this.unitTypes[this.typeIdx[i]].weapons;
    if (weapons.length === 0) return true; // nothing to close with (canFocus refuses these)
    const px = this.posX[i];
    const py = this.posY[i];
    const air = this.isAirborne(t);
    const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
    const stopped = this.moving[i] === 0;
    let anyCan = false;
    let hold = false;
    let los = 0; // 0 not yet traced, 1 clear, -1 blocked
    for (let s = 0; s < weapons.length && s < 2; s++) {
      const w = weapons[s];
      if (air ? !w.canTargetAir : !w.canTargetGround) continue;
      // The squared range this unit stops at, from where it stands (R-22).
      let reachSq = this.effSq(i, w);
      if (stopped) {
        const r = fx.add(this.effRange(i, w), FOCUS_REACH_SLACK);
        reachSq = fx.mul(r, r);
      }
      if (this.engageable(i, w, t) && this.weaponHurts(w, t, this.engageOX, this.engageOY)) {
        anyCan = true;
        if (dSq <= reachSq) return true;
        continue;
      }
      if (hold || dSq > reachSq || dSq > this.reachSq(i, w)) continue;
      if (!w.isIndirect) {
        if (los === 0) los = this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16) < 0 ? -1 : 1;
        if (los < 0) continue;
      }
      // Domain, range, sight (or indirect) all pass, and the target is
      // identified and in the open (stepFocus got here): what refused it is
      // weaponHurts or the minimum range. Walking will not change either.
      hold = true;
    }
    return !anyCan && hold;
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
      // Only an order that ASKED to sweep goes on from where it was sent. A
      // plain attack-move has arrived: it holds there and fights what comes
      // inside its own reach, as a halted unit does. Before 2026-10-11 every
      // attack-move swept, and since every player right-click is one, 18 of
      // 19 KDF types stood 8-28 tiles from the clicked tile ten seconds after
      // reaching it, walking at whatever contact the side remembered.
      if (this.sweepOrder[i] === 0) continue;
      if (this.garrisonedIn[i] >= 0 || this.routed[i] === 1 || this.pinned[i] === 1) continue;
      // Busy shooting something -- but only inside EFFECTIVE range counts.
      // An attack-mover that has arrived with its target out in the band
      // between effective and maximum range closes on it, exactly as a moving
      // one does (stepCombat's `engaging` latch), instead of kneeling where it
      // stopped and plinking at long range for the rest of the mission. With
      // more sight than reach -- `inf_squad`'s sensor upgrade puts 13 tiles of
      // sight on an 8-tile rifle -- that was the common case, and it is one
      // half of the sight-range stall; the identified-but-out-of-reach skip
      // below is the other half. Spec 2026-10-05-infantry-halt-to-fire §3.
      if (this.engaging[i] === 1) continue;
      const tgt = this.curTarget[i];
      // A target in the band and in the OPEN is worth firing on from here --
      // the same rule that bounds a moving attack-mover against it (stepBrace)
      // -- so it stays where it was sent and shoots. Only one in cover is
      // walked on toward.
      if (tgt >= 0 && this.coverLevelOf(tgt, i) === 0) continue;
      if (tgt >= 0) {
        this.goalX[i] = this.posX[tgt];
        this.goalY[i] = this.posY[tgt];
        this.fieldRef[i] = this.fieldFor(fx.toInt(this.goalX[i]), fx.toInt(this.goalY[i]), this.domainOf(i));
        this.moving[i] = 1;
        continue;
      }
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
        // Currently identified enemies are the combat step's problem -- but
        // only while combat can shoot them. This loop runs only for a unit
        // with no target at all (the curTarget guard above), so an enemy it
        // has identified and is not shooting is out of its range or out of
        // its sight line. Skipping that one too was a stall: an attack-mover
        // with more sight than reach (the `inf_squad` sensor upgrade buys 13
        // tiles of sight for an 8-tile rifle) knelt and watched it for the
        // rest of the mission. Walk to it instead -- unless no weapon this
        // unit carries could engage it (a rifle squad does not chase a
        // helicopter), or it is inside something selectTarget refuses.
        if (this.contactState[k] === 2 && !this.couldEngage(i, t)) continue;
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

  /** The cover level, 0-3, that `t` has against fire from `shooter`: its own
   *  tile or the parapet it fights behind, whichever is better -- hitFactors'
   *  own rule, read without rolling anything. */
  private coverLevelOf(t: number, shooter: number): number {
    const tx = this.posX[t];
    const ty = this.posY[t];
    const tileCover = this.cover[(ty >> 16) * this.width + (tx >> 16)];
    const parapet = this.parapetCover(tx, ty, this.posX[shooter], this.posY[shooter]);
    return parapet > tileCover ? parapet : tileCover;
  }

  /**
   * GH-707 P2: would a `rescue` order naming this medic and this wounded be accepted now?
   * The command's own gate, read-only (no state, no rng) -- the app's cursor and click ask it
   * so they cannot disagree with the sim.
   */
  canRescue(medic: number, wounded: number): boolean {
    return this.rescueGate(medic, wounded);
  }

  /**
   * GH-707 P2: how fast `id` is bleeding now, in ticks of bleed per tick: 0 when he is not a DOWN
   * wounded (a STABILISED man included), is carried or is tended, 2 while pinned, else 1.
   * Read-only; `stepWounded` applies the same rule, but on next tick's positions, so a medic
   * stepping into reach can make this read one tick early. For display, not for arithmetic.
   */
  woundBleedRate(id: number): number {
    if (id < 0 || id >= this.count || this.alive[id] === 0 || this.woundState[id] !== WOUND_DOWN) return 0;
    if (this.carriedBy[id] >= 0 || this.woundTended(id)) return 0;
    return this.pinned[id] === 1 ? 2 : 1;
  }

  /**
   * May `shooter` be ordered to fire on `target`? The single filter the
   * `attack` command uses, public so the app can ask the same question before
   * it sends one (no second copy to drift). Geometry-free on purpose: no
   * range, no sight, no penetration -- `weaponHurts` flips with the target's
   * facing, so the sim does not refuse on it.
   *
   * False when the shooter is dead, routed, carried, unarmed or a kamikaze
   * (R-25: `stepKamikaze` steers a loitering munition itself, rewriting its
   * goal and `attackMove` every tick, so a focus could only fight it; the app
   * sends it the attack-move it had before); when the
   * target is dead, on the shooter's side, a civilian, or inside a building,
   * a vehicle or the earth; when the shooter's side holds less than
   * IDENTIFIED_AT confidence on it (the test `selectTarget` applies -- the
   * latched contact STATE is a wider band and is not what refuses a shot);
   * or when no weapon of the shooter's could ever be aimed at it.
   */
  canFocus(shooter: number, target: number): boolean {
    if (shooter < 0 || shooter >= this.count || target < 0 || target >= this.count) return false;
    if (this.alive[shooter] === 0 || this.routed[shooter] === 1 || this.carriedBy[shooter] >= 0) return false;
    const sType = this.unitTypes[this.typeIdx[shooter]];
    if (sType.weapons.length === 0 || sType.isKamikaze) return false;
    const sSide = this.side[shooter];
    if (sSide > 1) return false; // contact is kept for sides 0 and 1 only
    if (!this.focusStillTargetable(sSide, target)) return false;
    if (this.contact[sSide * this.capacity + target] < IDENTIFIED_AT) return false;
    return this.couldEngage(shooter, target);
  }

  /**
   * The target half of canFocus, without the identification clause: is
   * `target` still something side `sSide` may hold a fire order on? False
   * once it is dead, on that side or a civilian, or inside a building, a
   * vehicle or the earth. canFocus asks it at order time and stepFocus every
   * tick after (T-D3, T-D4), so the rule is written once; identification is
   * left out because losing sight of a focus is not the end of it -- R-4's
   * lost counter decides that. `target` must be a spawned id.
   */
  private focusStillTargetable(sSide: number, target: number): boolean {
    if (this.alive[target] === 0 || this.side[target] === sSide || this.side[target] > 1) return false;
    if (this.woundLive && this.horsDeCombat(target)) return false; // GH-707
    return this.garrisonedIn[target] < 0 && this.carriedBy[target] < 0 && this.tunnelIn[target] < 0;
  }

  /**
   * Could any of `shooter`'s weapon slots (0..1) that can aim at `target`'s
   * domain hurt it from where both stand now? Public and read-only (ruling
   * R-8): the app asks it before sending `attack`, to refuse an order that
   * nothing selected can penetrate. Range, sight and identification aside --
   * it is `weaponHurts`, the rule selectTarget ranks by and the focus
   * preference gates on, over the slots, and nothing else. False for an id
   * out of range or an unarmed shooter. It changes as facings change. It
   * does NOT check `alive` on either side: a dead id answers from where its
   * body lies; ask canFocus for whether the order may be given at all.
   *
   * Safe to call between ticks: the only things it writes are the scratch
   * `presentedArc` and, through `eyePoint`, `eyeX`/`eyeY`. `presentedArc` has
   * one reader (resolveHit), which reads it on the line straight after its
   * own `presentedArmor` call; every presentedArmor call assigns it on every
   * path, so no value written here can reach that read. Every `eyePoint`
   * reader copies `eyeX`/`eyeY` into locals on the line straight after its
   * call, before the next `eyePoint` call, so a value left here is
   * overwritten before anything reads it.
   */
  focusHurts(shooter: number, target: number): boolean {
    if (shooter < 0 || shooter >= this.count || target < 0 || target >= this.count) return false;
    const air = this.isAirborne(target);
    const weapons = this.unitTypes[this.typeIdx[shooter]].weapons;
    this.eyePoint(shooter, this.posX[target], this.posY[target]);
    const px = this.eyeX;
    const py = this.eyeY;
    for (let s = 0; s < weapons.length && s < 2; s++) {
      const w = weapons[s];
      if (this.garrisonedIn[shooter] >= 0 && !w.firesFromBuilding) continue;
      if (air ? !w.canTargetAir : !w.canTargetGround) continue;
      if (this.weaponHurts(w, target, px, py)) return true;
    }
    return false;
  }

  /** Could any of `i`'s weapons ever be aimed at `t`, range and sight aside?
   *  The domain and containment half of selectTarget's filter, for stepSweep:
   *  worth walking toward only if, once there, combat could take the shot.
   *  A weapon that does not fire from a building does not count for a
   *  garrisoned unit. */
  private couldEngage(i: number, t: number): boolean {
    if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) return false;
    const air = this.isAirborne(t);
    const weapons = this.unitTypes[this.typeIdx[i]].weapons;
    for (let s = 0; s < weapons.length && s < 2; s++) {
      if (this.garrisonedIn[i] >= 0 && !weapons[s].firesFromBuilding) continue;
      if (air ? weapons[s].canTargetAir : weapons[s].canTargetGround) return true;
    }
    return false;
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
      // GH-707, the same belt for a wounded: no order reaches him (applyCommands), but an
      // autonomous setter could -- a rout from long pinning is one -- and he crawls only by
      // stepWounded's own step.
      if (this.woundLive && this.woundState[i] !== WOUND_NONE) continue;
      // Attack-movers halt to fight while they hold a target (stationary
      // stance emerges from this — no scripted bonus needed).
      if (this.attackMove[i] === 1 && this.engaging[i] === 1) continue;
      // Getting down, down, or getting up: a man on one knee does not walk.
      // Only a unit that halts to fire ever leaves BRACE_NONE.
      if (this.brace[i] !== BRACE_NONE) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      const px = this.posX[i];
      const py = this.posY[i];
      const tileX = px >> 16;
      const tileY = py >> 16;
      const goalTileX = this.goalX[i] >> 16;
      const goalTileY = this.goalY[i] >> 16;

      // GH-707 Task 4: a medic carrying a wounded drags or stretchers him (`speedMul`). The
      // column is ONE for every unit without wound content, and fx.mul(x, ONE) === x exactly
      // (bh 1, bl 0: (ah << 16) + al), so this is the identity there.
      let step = fx.mul(type.stepPerTick, this.speedMul[i]);
      // #706: slowed running gear, an integer percent of the Q16.16 step, by the
      // tree's integer-divide idiom (`fixed.ts:119`): no float is produced. The
      // product stays far inside int32 (a step is under 0.2 tile, ~13000 raw).
      if (this.mobilityDamaged[i] === 1) {
        const p = step * MOB_DAMAGED_PCT;
        step = (p - (p % 100)) / 100;
      }
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
          this.sweepOrder[i] = this.wpSweep[base];
          for (let k = 0; k < queued - 1; k++) {
            this.wpX[base + k] = this.wpX[base + k + 1];
            this.wpY[base + k] = this.wpY[base + k + 1];
            this.wpAttack[base + k] = this.wpAttack[base + k + 1];
            this.wpSweep[base + k] = this.wpSweep[base + k + 1];
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

  /**
   * Field works (#277, spec §3): refresh every unit's aura modifiers every
   * AURA_CADENCE_TICKS. Clears rate, cap, component threshold and accuracy, then for each
   * COMPLETE structure owned by side 0 or 1 with area effects, gives every unit of the
   * OWNER's side within an effect's radius of the centroid -- alive, on the surface, not
   * garrisoned, not carried, not air, in the effect's domain -- the MAX of rate, cap and
   * accuracy over covering effects and the MIN non-zero component threshold: overlapping
   * stations do not stack, and the answer is order-free. `auraRepairTicks` is stepUpkeep's
   * counter and is not touched here. Returns at once unless `fwLive` (D1); allocates nothing.
   */
  private stepAuras(): void {
    if (!this.fwLive) return;
    if (this.tickCount % AURA_CADENCE_TICKS !== 0) return;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      this.auraHealRate[i] = 0;
      this.auraHealCap[i] = 0;
      this.auraCompAt[i] = 0;
      this.auraAccMult[i] = ONE;
    }
    for (let s = 0; s < this.structureCount_; s++) {
      if (this.stAlive[s] === 0 || this.stProgress[s] !== ONE) continue;
      const owner = this.stOwner[s];
      if (owner !== 0 && owner !== 1) continue;
      const aura = this.structureTypes[this.stTypeIdx[s]].aura;
      if (aura === null) continue;
      const area = aura.area;
      const cx = this.stCx[s];
      const cy = this.stCy[s];
      for (let k = 0; k < area.length; k++) {
        const e = area[k];
        for (let i = 0; i < n; i++) {
          if (this.alive[i] === 0 || this.side[i] !== owner) continue;
          if (this.garrisonedIn[i] >= 0 || this.carriedBy[i] >= 0 || this.tunnelIn[i] >= 0) continue;
          const t = this.unitTypes[this.typeIdx[i]];
          if (t.isAir) continue;
          if (e.affects === AFFECTS_FOOT && t.moveDomain !== DOMAIN_FOOT) continue;
          if (e.affects === AFFECTS_VEHICLE && t.moveDomain !== DOMAIN_VEHICLE) continue;
          if (distSqFx(fx.sub(this.posX[i], cx), fx.sub(this.posY[i], cy)) > e.radiusSq) continue;
          if (e.healRate > this.auraHealRate[i]) this.auraHealRate[i] = e.healRate;
          if (e.healCap > this.auraHealCap[i]) this.auraHealCap[i] = e.healCap;
          if (e.accMult > this.auraAccMult[i]) this.auraAccMult[i] = e.accMult;
          const c = e.compTicks;
          if (c > 0 && (this.auraCompAt[i] === 0 || c < this.auraCompAt[i])) this.auraCompAt[i] = c;
        }
      }
    }
    if (this.unitAuraLive) this.stepUnitAuras();
  }

  /**
   * E1 (GH-709): the unit half of stepAuras, the same max-over-effects rule into the same
   * columns, so a unit aura and a station never stack with each other or themselves. A
   * carrier counts while alive, not down, not garrisoned, not carried and not underground
   * (and, for a `stationary` effect, with no movement order: `moving[c] === 0`, the field-fix
   * assist's own "stands still"). An area effect covers what a station's does -- same
   * side, alive, surface, not garrisoned, not carried, not air, in the effect's domain --
   * within `radius` of the carrier, never the carrier itself. `passengers` covers the
   * carrier's own living riders (`carriedBy === c`) wherever it is, in the air included.
   * GH-707 wounded (`horsDeCombat`) are never covered by a UNIT aura (a station's coverage
   * is GH-707's and unchanged here), at cadence granularity: a unit aura heals pooled squad hp and
   * leaves bleeding to the medic's treat and the carrier's `stabilise_radius` (the E1 x
   * GH-707 ruling, in the PR). Called only while `unitAuraLive`; allocates nothing.
   */
  private stepUnitAuras(): void {
    const n = this.count;
    for (let c = 0; c < n; c++) {
      if (this.alive[c] === 0) continue;
      const area = this.unitTypes[this.typeIdx[c]].aura;
      if (area === null) continue;
      if (this.garrisonedIn[c] >= 0 || this.carriedBy[c] >= 0 || this.tunnelIn[c] >= 0) continue;
      // A carrier that is itself down (GH-707) projects nothing.
      if (this.woundLive && this.horsDeCombat(c)) continue;
      const side = this.side[c];
      const cx = this.posX[c];
      const cy = this.posY[c];
      const still = this.moving[c] === 0;
      for (let k = 0; k < area.length; k++) {
        const e = area[k];
        if (e.stationary && !still) continue;
        const passengers = e.affects === AFFECTS_PASSENGERS;
        for (let i = 0; i < n; i++) {
          if (i === c || this.alive[i] === 0 || this.side[i] !== side) continue;
          if (passengers) {
            if (this.carriedBy[i] !== c) continue;
          } else {
            if (this.garrisonedIn[i] >= 0 || this.carriedBy[i] >= 0 || this.tunnelIn[i] >= 0) continue;
            const t = this.unitTypes[this.typeIdx[i]];
            if (t.isAir) continue;
            if (e.affects === AFFECTS_FOOT && t.moveDomain !== DOMAIN_FOOT) continue;
            if (e.affects === AFFECTS_VEHICLE && t.moveDomain !== DOMAIN_VEHICLE) continue;
            if (distSqFx(fx.sub(this.posX[i], cx), fx.sub(this.posY[i], cy)) > e.radiusSq) continue;
          }
          if (this.woundLive && this.horsDeCombat(i)) continue;
          if (e.healRate > this.auraHealRate[i]) this.auraHealRate[i] = e.healRate;
          if (e.healCap > this.auraHealCap[i]) this.auraHealCap[i] = e.healCap;
          if (e.accMult > this.auraAccMult[i]) this.auraAccMult[i] = e.accMult;
        }
      }
    }
  }

  /**
   * #706 §3.4 items 2-3: one tick of a stuck hull's crew field fix. Called from
   * stepUpkeep for a living unit with `mobilityKilled === 1`. Only a ground hull
   * on the surface and not carried or garrisoned counts; an aircraft never does
   * (a crew cannot re-rig a rotor in a field). A hit this tick (`lastDamagedTick
   * === tickCount`) restarts the clock. Otherwise it counts 1, or 2 while any
   * living same-side `repair` unit stands still on the surface within
   * FIELD_FIX_ASSIST_RADIUS (assists do not stack). At FIELD_FIX_TICKS the hull
   * is SLOWED, not stuck, and a `fieldFixed` event is pushed. No rng, no
   * allocation.
   */
  private stepFieldFix(i: number): void {
    const rate = this.fieldFixRate(i);
    if (rate === 0) return;
    if (this.lastDamagedTick[i] === this.tickCount) {
      this.fieldFixTicks[i] = 0;
      return;
    }
    this.fieldFixTicks[i] += rate;
    if (this.fieldFixTicks[i] >= FIELD_FIX_TICKS) {
      this.mobilityKilled[i] = 0;
      this.mobilityDamaged[i] = 1;
      this.fieldFixTicks[i] = 0;
      this.pendingEvents.push({ kind: 'fieldFixed', tick: this.tickCount, entity: i });
    }
  }

  /**
   * #706: how fast unit `i`'s crew field fix counts -- 0 when it cannot count
   * at all (dead, not stuck, an aircraft, carried, garrisoned or underground),
   * 2 while a living same-side `repair` unit stands still on the surface
   * within FIELD_FIX_ASSIST_RADIUS, else 1. It does NOT read this tick's hit
   * (that reset is `stepFieldFix`'s). The one source of the rule: the sim's
   * own field fix and the HUD's repair countdown both call it. A pure read,
   * no allocation.
   */
  fieldFixRate(i: number): number {
    if (
      i < 0 ||
      i >= this.count ||
      this.alive[i] === 0 ||
      this.mobilityKilled[i] !== 1 ||
      this.unitTypes[this.typeIdx[i]].isAir ||
      this.carriedBy[i] >= 0 ||
      this.garrisonedIn[i] >= 0 ||
      this.tunnelIn[i] >= 0
    ) {
      return 0;
    }
    const side = this.side[i];
    const px = this.posX[i];
    const py = this.posY[i];
    for (let j = 0; j < this.count; j++) {
      if (
        j === i ||
        this.alive[j] === 0 ||
        this.side[j] !== side ||
        this.moving[j] !== 0 ||
        this.carriedBy[j] >= 0 ||
        this.garrisonedIn[j] >= 0 ||
        this.tunnelIn[j] >= 0 ||
        !this.unitTypes[this.typeIdx[j]].canRepair
      ) {
        continue;
      }
      if (distSqFx(fx.sub(this.posX[j], px), fx.sub(this.posY[j], py)) <= FIELD_FIX_ASSIST_RADIUS_SQ) return 2;
    }
    return 1;
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
      // A field work's heal or repair (stepAuras) raises the rate and the ceiling, each the
      // larger of the two, after the same delay: one rule for "under fire".
      // E6: a lost swarm member does not grow back (and no aura or workshop mends one): the
      // cloud only ever shrinks, so the regen below skips it.
      if (this.tickCount - this.lastDamagedTick[i] >= REGEN_DELAY_TICKS && this.unitTypes[this.typeIdx[i]].swarm === null) {
        const type = this.unitTypes[this.typeIdx[i]];
        const auraCap = this.auraHealCap[i];
        const auraRate = this.auraHealRate[i];
        let cap = fx.mul(type.hp, auraCap > REGEN_CAP ? auraCap : REGEN_CAP);
        // GH-707: a team that has lost men heals only its standing men's shares.
        const up = this.figuresUp[i];
        if (this.woundLive && up < type.figures) cap = scaleDown(cap, up, type.figures);
        if (this.hp[i] < cap) {
          this.hp[i] = fx.min(fx.add(this.hp[i], fx.mul(type.hp, auraRate > REGEN_FRAC ? auraRate : REGEN_FRAC)), cap);
        }
      }
      // Component repair: continuous covered, undamaged ticks; a hit or leaving cover restarts it.
      const compAt = this.auraCompAt[i];
      if (compAt > 0 && this.lastDamagedTick[i] !== this.tickCount) {
        if (++this.auraRepairTicks[i] >= compAt) {
          this.mobilityKilled[i] = 0;
          this.firepowerKilled[i] = 0;
          // #706: a workshop puts the running gear right too, slowed included.
          this.mobilityDamaged[i] = 0;
          this.fieldFixTicks[i] = 0;
        }
      } else if (this.auraRepairTicks[i] !== 0) {
        this.auraRepairTicks[i] = 0;
      }
      // #706 §3.4: the crew field fix. A stuck, living, surface ground hull
      // counts quiet ticks (2 with a `repair` unit standing by); a hit this
      // tick restarts it, the aura's own "under fire" rule. At FIELD_FIX_TICKS
      // it steps down to SLOWED, never to sound; a lost gun stays lost.
      if (this.mobilityKilled[i] === 1) this.stepFieldFix(i);
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
    h = hashArray(h, this.wpSweep);
    h = hashArray(h, this.wpCount);
    h = hashArray(h, this.carriedBy);
    h = hashArray(h, this.boardGoal);
    h = hashArray(h, this.passengers);
    h = hashArray(h, this.alive);
    // `removed` is deliberately absent too, for now. Nothing that ships
    // reaches `removeFromPlay` yet (no mission authors a `remove` trigger),
    // so the array is all zero on every replay this hash guards -- but
    // hashArray folds by XOR-then-multiply, not by sum, so even an all-zero
    // array is not a no-op to fold in: it would still move the pinned
    // number. Add it here in the same commit that gives it real content to
    // protect.
    h = hashArray(h, this.side);
    h = hashArray(h, this.typeIdx);
    h = hashArray(h, this.posX);
    h = hashArray(h, this.posY);
    h = hashArray(h, this.facing);
    h = hashArray(h, this.hp);
    h = hashArray(h, this.suppression);
    h = hashArray(h, this.suppFromX);
    h = hashArray(h, this.suppFromY);
    h = hashArray(h, this.suppFromSet);
    h = hashArray(h, this.moving);
    h = hashArray(h, this.attackMove);
    h = hashArray(h, this.sweepOrder);
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
      // The fire-support profile picks the round pattern a queued entry lands
      // with (F1 Task 6), so two worlds differing only in it diverge. No pin
      // moved: pendingStrikes is empty at every hash in the golden replays and in
      // the versus runs (no replay calls fire support), so this word is never
      // folded in there.
      h = hashWord(h, s.profile);
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
    // Field works (#277), D1: the FW state block is folded only once `fwLive`
    // is set, and NOTHING at all is folded before that -- no marker, no length
    // word. hashArray folds by XOR-then-multiply, so even an all-default array
    // moves the digest; folding the block unconditionally would move every
    // golden, versus and net pin for worlds that use no field works. House
    // precedent: `economyHash`'s rise loop, a loop with no length word so a
    // flat map adds nothing. Every FW writer sets `fwLive` (an owned or
    // under-construction `addStructure`, `setStructureOwner`, and site creation
    // from Task 4), so a world whose block holds anything other than its
    // defaults always folds it: the canary still sees every FW divergence.
    // The marker word keeps "block folded" distinct from any accident of the
    // arrays' contents lining up with what follows.
    if (this.fwLive) {
      h = hashWord(h, 0x46570277); // 'FW' #277
      h = hashArray(h, this.stOwner);
      h = hashArray(h, this.stKnown);
      h = hashArray(h, this.stProgress);
      h = hashArray(h, this.siteAlive);
      h = hashArray(h, this.siteType);
      h = hashArray(h, this.siteX);
      h = hashArray(h, this.siteY);
      h = hashArray(h, this.siteSide);
      h = hashArray(h, this.siteStructure);
      h = hashArray(h, this.buildSite);
      h = hashArray(h, this.auraHealRate);
      h = hashArray(h, this.auraHealCap);
      h = hashArray(h, this.auraCompAt);
      h = hashArray(h, this.auraRepairTicks);
      h = hashArray(h, this.auraAccMult);
    }
    // Placed charges (E6, GH-274 G1): the deferred fold. Nothing (no marker, no length word) is
    // folded before a `placed` demolisher type is registered, so no golden, versus, net or
    // economy pin moved. Both columns can leave their defaults only through such a type, so
    // the canary still sees every charge divergence once the block is on.
    if (this.placedLive) {
      h = hashWord(h, 0x43480274); // 'CH' GH-274
      h = hashArray(h, this.stChargeTicks);
      h = hashArray(h, this.stChargeBy);
    }
    // Mobility kills (#706): the deferred fold, field works' D1 shape. The two
    // columns are folded only once a mobility result (stuck or slowed) has been
    // applied, and nothing at all before that, so a world that never sees one
    // keeps its digest. Both stay at their spawn defaults until then.
    if (this.mobLive) {
      h = hashWord(h, 0x4d4b0706); // 'MK' #706
      h = hashArray(h, this.mobilityDamaged);
      h = hashArray(h, this.fieldFixTicks);
    }
    // Air carriers (GH-698), Q-A (lead 21 Oct): the deferred fold, field works' D1
    // shape. The block is folded only once `addUnitType` has registered an air
    // carrier type, and nothing at all (no marker, no length word) before that, so
    // no golden, versus, net, economy or runtime-digest pin moved. Only an air
    // carrier, or (#706 §3.5) a mobility-killed aircraft, ever leaves these
    // columns at their spawn defaults; the first needs its type and the second
    // sets the latch in rollComponent, so the canary still sees every air
    // divergence.
    if (this.airLive) {
      h = hashWord(h, 0x41490698); // 'AI' GH-698
      h = hashArray(h, this.airState);
      h = hashArray(h, this.airTimer);
      h = hashArray(h, this.airWant);
    }
    // Beams (E6, GH-274 item 3): the deferred fold. Nothing (no marker, no length word) until a
    // beam weapon has first been on a target, so registering the type moves no pin. Every
    // column leaves its default only through such a weapon, so the canary still sees every
    // beam divergence once the block is on.
    if (this.beamLive) {
      h = hashWord(h, 0x42450274); // 'BE' GH-274
      h = hashArray(h, this.beamTgt);
      h = hashArray(h, this.beamDwell);
      h = hashArray(h, this.beamHeat);
      h = hashArray(h, this.beamAt);
      h = hashArray(h, this.beamLock);
    }
    // Wounded and rescue (GH-707): the same deferred fold. Nothing (no marker, no length word)
    // before a wound-related type is registered, so P1 and P2 move no pin; every column here
    // can leave its spawn default only through a wound-related type, so the canary still sees
    // every wound divergence once the block is on.
    if (this.woundLive) {
      h = hashWord(h, 0x57440707); // 'WD' #707
      h = hashArray(h, this.figuresUp);
      h = hashArray(h, this.scars);
      h = hashArray(h, this.woundParent);
      h = hashArray(h, this.woundBy);
      h = hashArray(h, this.woundState);
      h = hashArray(h, this.bleedTicks);
      h = hashArray(h, this.woundTimer);
      h = hashArray(h, this.medState);
      h = hashArray(h, this.medTarget);
      h = hashArray(h, this.medTimer);
      h = hashArray(h, this.speedMul);
      h = hashArray(h, this.admittedAt);
      h = hashArray(h, this.woundedAlive);
      h = hashArray(h, this.evacX);
      h = hashArray(h, this.evacY);
      h = hashArray(h, this.evacSide);
      h = hashWord(h, this.evacCount);
      // `removed` is written by evacuation and admission once wounds are live (a rescued man
      // leaves the board alive), so it is state the replay must see -- folded HERE, never
      // unconditionally: outside this block only a `remove` trigger writes it, and no pinned
      // replay calls one (see the field's own comment).
      h = hashArray(h, this.removed);
    }
    // Tunnel columns — every mutable one, matching how the demolition and
    // contact state above is folded in. The contact pair matters most: it
    // gates the charge clock, and under live-gated visibility it moves every
    // tick a route is being watched or forgotten — a sub-threshold
    // divergence there would otherwise sit dormant until an order happened
    // to be issued. NOT hashed, deliberately: the trail grid
    // (width*height bytes -- hashing it would turn every trail-decay tuning
    // change into a hash change for no added coverage). It is NOT derived
    // state, though: it follows the HISTORY of tnProgress, not its value at a
    // tick, and trailStrengthFor reads it, so a snapshot must carry it
    // (snapshot-schema.ts classes it `state`; poisoning it diverged the hash
    // within 20 ticks). Also unhashed: tnLength/tnDigRate/
    // tnVentX/tnVentY/tnPoints/tnTiles (immutable after addTunnel), and
    // tnDigger (set once by assignDigger; stepDigging re-checks `alive`).
    h = hashArray(h, this.tunnelIn);
    h = hashArray(h, this.homeTunnel);
    h = hashArray(h, this.surfaceTicks);
    h = hashArray(h, this.volleyLeft);
    // GH-681: folded only once a tunnel order has been accepted, so every
    // world that never sees one keeps its digest.
    if (this.tnOrderLive) {
      h = hashArray(h, this.tunnelGoal);
      h = hashArray(h, this.tunnelEta);
    }
    // N3 Task 9 (Q6): the patrol beat, folded only once a patrol has been accepted,
    // so every world that never patrols keeps its digest. (`stance` itself is
    // folded above, unconditionally, and reads 2 on a patroller.)
    if (this.patrolLive) {
      h = hashWord(h, 0x50540009); // 'PT' N3 Task 9
      h = hashArray(h, this.patrolX);
      h = hashArray(h, this.patrolY);
      h = hashArray(h, this.patrolCount);
      h = hashArray(h, this.patrolIdx);
    }
    h = hashArray(h, this.chargeOrder);
    h = hashArray(h, this.chargeTicks);
    h = hashArray(h, this.tnAlive);
    h = hashArray(h, this.tnProgress);
    h = hashArray(h, this.tnVentOpen);
    h = hashArray(h, this.tnOccupants);
    h = hashArray(h, this.tnContact);
    h = hashArray(h, this.tnContactState);
    h = hashArray(h, this.brace);
    h = hashArray(h, this.braceTicks);
    h = hashArray(h, this.braceClock);
    h = hashArray(h, this.focusTarget);
    h = hashArray(h, this.focusLost);
    return h >>> 0;
  }
}
