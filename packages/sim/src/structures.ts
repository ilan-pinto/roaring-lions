// Buildings as first-class sim objects (GDD §5 terrain, ART_PIPELINE §6).
//
// A structure is a set of tiles that blocks movement, absorbs fire, shelters
// a garrison, and leaves passable rubble when it comes down. Masonry is not
// armour: it does not roll on the penetration curve — it soaks damage scaled
// by what the round is actually good for. A rifle bullet does essentially
// nothing to a wall; a mortar shell does a great deal.

import { fx, ONE, type Fx } from './fixed';
import { WOUND_MAX_RADIUS_TILES, WOUND_MAX_SECONDS } from './tuning';

export interface StructureTypeJson {
  id: string;
  name?: string;
  /** Structural integrity per tile of footprint. */
  hp_per_tile: number;
  /** How many units can fight from inside. 0 = not garrisonable. */
  garrison_slots?: number;
  /** Cover level left behind on the rubble. */
  rubble_cover?: number;
  /** Presentation only: drawn wall height in px. */
  height_px?: number;
  /** Presentation only: palette key for the walls. */
  color?: string;
  /** Presentation only: the palette step a mesh building's `wall` role draws,
   *  EXACTLY ("band.index"), instead of the lit step of the slice `color`
   *  starts. For a wall whose wanted tone is the lightest step of its band,
   *  which no `color` key can draw (the T-wall, #643). */
  wall_tone?: string;
  /** Presentation only: a self-lit term on the `wall` role, as a fraction of
   *  its albedo (0..0.25). Lifts a face the scene sun never reaches without
   *  touching the sun or the shared lights (the T-wall, #643). */
  wall_self_lit?: number;
  /** ROE cost when the player levels it (GDD §6). */
  roe_penalty?: number;
  /** Which side this structure builds units for, if any. See `producesFor`
   *  on `StructureType` below for the whole account. */
  produces_for?: number;
  /** Field works (#277): the default OWNER of a structure of this type, -1 neutral (the seven
   *  civilian types, and every shipped type today), 0 or 1 a side. Overridable per mission
   *  placement (`structures[].owner`). Distinct from `produces_for`: an owned structure is
   *  a TARGET to the other side once that side has seen it (`Sim.stKnown`), whatever it builds.
   *  A plain number, not a literal union: literal unions break JSON-module call sites. */
  owner?: number;
  /** Field works (#277): a type the player can raise in a mission (spec §4). Absent = not
   *  buildable. `cost` mirrors a unit's cost shape; `footprint` is [width, height] in tiles,
   *  default [2, 2]; `unlock` is the unit schema's gate shape, read by the runtime (Task 5),
   *  never by the sim. */
  buildable?: {
    cost: { logistics: number; intel?: number };
    build_time_s: number;
    footprint?: readonly number[];
    unlock?: unknown;
  };
  /** Field works (#277, spec §3): what a COMPLETE structure owned by side 0 or 1 does to its
   *  own side's units. Absent = nothing (every shipped type today). */
  aura?: StructureAuraJson;
  /** GH-707: an aid post. A carried wounded unloaded within `admit_radius` tiles is admitted
   *  and treated for `treat_s`; idle friendly medics within `dispatch_radius` tiles are sent
   *  to wounded within that radius of the post. Absent = not an aid post (every shipped type). */
  aid?: { admit_radius: number; treat_s: number; dispatch_radius: number };
  /** Chest-high: blocks movement and shields whoever is hugging it, but you
   *  shoot over it rather than at it. A compound built from sight-blocking
   *  masonry is a blind box -- its garrison cannot fire out, so the wall
   *  protects the besieger. Default false: everything else is a building. */
  low_profile?: boolean;
  /** Cover level 0-3 this gives to a unit fighting from immediately behind it,
   *  while it still stands. The companion to rubble_cover, which is what is
   *  left once it does not. Only consulted for a low_profile type. */
  standing_cover?: number;
  /** Cover level 0-3 a unit inside fights with, against suppression and
   *  detection. Default 3 (lead ruling 2026-10-14, GH-280). */
  garrison_cover?: number;
  /** Storeys; each above the ground lifts a garrison's eye one elevation
   *  level. Default 1. */
  floors?: number;
  /** A linear run of arbitrary length -- a wall, a fence -- whose tiles each
   *  stand alone: the map loader gives every tile its own structure and its own
   *  HP, and the renderer stamps a sprite per tile. Length is exactly what makes
   *  footprint-wide HP wrong here. Flood-filled, a perimeter would be one object
   *  whose entire ring unblocks the instant it dies, so breaching one panel
   *  would delete the whole compound. */
  per_tile?: boolean;
}

/** One `aura.area` effect (spec §3): who it touches and what it gives them. `affects` is
 *  'foot' | 'vehicle' | 'any', typed as a plain string because literal unions break
 *  JSON-module call sites. */
export interface AreaEffectJson {
  radius: number;
  affects: string;
  heal_per_s?: number;
  heal_cap?: number;
  repair_per_s?: number;
  repair_components_s?: number;
  accuracy_mult?: number;
}

/** The `aura` block. No `supp_cover`: #606 shipped `garrison_cover` instead (pre-flight). */
export interface StructureAuraJson {
  area?: AreaEffectJson[];
  /** Bonuses for whoever is garrisoned inside. `range_bonus` (tiles, direct fire only) is ON
   *  TOP of the global GARRISON_RANGE_BONUS; `sight_bonus` (tiles) adds to sight from the window. */
  garrison?: { range_bonus?: number; sight_bonus?: number };
  /** The structure itself as an eye of its owner's side (Task 7): `sight` and `optics` as a
   *  unit's, and `tunnel_radius` (tiles, 0/absent = none) inside which any tile of a route
   *  identifies it to the owner, with NO line-of-sight test. */
  sensor?: { sight: number; optics: number; tunnel_radius?: number };
}

/** `affects` codes. Air is excluded from every scope (nothing lands). */
export const AFFECTS_FOOT = 0;
export const AFFECTS_VEHICLE = 1;
export const AFFECTS_ANY = 2;

/** A parsed area effect, every value Q16.16 or ticks, fixed at load. Zero (or ONE for
 *  `accMult`) means the field is absent. */
export interface AreaEffect {
  radiusSq: Fx;
  affects: number;
  /** Fraction of max HP restored a tick: (heal_per_s ?? repair_per_s) / ticks per second. */
  healRate: Fx;
  /** HP fraction healing stops at: heal_cap, default ONE when a rate is authored, else 0. */
  healCap: Fx;
  /** Covered, undamaged ticks that clear component kills; 0 = none. */
  compTicks: number;
  accMult: Fx;
}

/** A parsed `aura.sensor`, Q16.16, fixed at load. */
export interface StructureSensor {
  sight: Fx;
  sightSq: Fx;
  optics: Fx;
  /** Squared tunnel radius; 0 = the sensor reads no routes. */
  tunnelRadiusSq: Fx;
}

export interface StructureAura {
  area: AreaEffect[];
  rangeBonus: Fx;
  sightBonus: Fx;
  sensor: StructureSensor | null;
}

export interface StructureType {
  /**
   * Which side this structure builds units for, or -1 for none.
   *
   * ONLY production structures carry a production side (field works' `owner`,
   * below, is the separate question of whose building it is). The seven civilian types are
   * neutral terrain -- HP, garrison slots and an ROE penalty, but no faction --
   * because nothing needed one until the camp did, and giving all of them a
   * side would have been a much larger change for no present gain.
   *
   * While a living structure whose type matches a side stands, that side's
   * `requestBuild` deploys beside it (`MissionRuntime.productionAnchor`), and
   * destroying the last one stops that side's production outright. A mission
   * with no such structure falls back to its own `player_start`, which is what
   * keeps every mission authored before this feature working untouched.
   */
  producesFor: number;
  /** Field works (#277): the default owner, -1 neutral. See StructureTypeJson.owner. */
  owner: number;
  /** Field works (#277): how this type is raised, or null when it cannot be. `buildStep` is the
   *  Q16.16 progress one builder at rate ONE adds per tick: ONE / (build_time_s x ticks per
   *  second), integer division, so a 20 s type is 65536 / 400 = 163 (truncated from 163.84).
   *  `fw` x `fh` is the footprint, origin at the site's (x, y), the top-left tile. */
  buildable: StructureBuildable | null;
  id: string;
  /** Display name for the HUD. */
  name: string;
  hpPerTile: Fx;
  garrisonSlots: number;
  rubbleCover: number;
  heightPx: number;
  color: string;
  /** ROE cost when the player levels it. */
  roePenalty: number;
  /** Shoot over it, not through it. See StructureTypeJson.low_profile. */
  lowProfile: boolean;
  /** Cover for whoever fights from behind it while it stands. */
  standingCover: number;
  /** See StructureTypeJson.garrison_cover. */
  garrisonCover: number;
  /** See StructureTypeJson.floors. */
  floors: number;
  /** Field works: the parsed `aura`, null when the type has none. */
  aura: StructureAura | null;
  /** GH-707: the parsed `aid` block, null when the type is not an aid post. */
  aid: StructureAid | null;
  /** A linear run whose tiles are each their own structure -- walls, fences.
   *  See StructureTypeJson.per_tile. */
  perTile: boolean;
  /** Presentation only. See StructureTypeJson.wall_tone. */
  wallTone?: string;
  /** Presentation only. See StructureTypeJson.wall_self_lit. */
  wallSelfLit?: number;
}

/** GH-707: a parsed `aid` block, Q16.16 squared radii and whole ticks, fixed at load. */
export interface StructureAid {
  admitRadiusSq: Fx;
  treatTicks: number;
  dispatchRadiusSq: Fx;
}

/** Parse an `aid` block (GH-707). Authored floats cross into fixed point once, here. */
function aidFromJson(json: StructureTypeJson, ticksPerSecond: number): StructureAid | null {
  const a = json.aid;
  if (a === undefined) return null;
  for (const r of [a.admit_radius, a.dispatch_radius]) {
    if (!(r >= 0 && r <= WOUND_MAX_RADIUS_TILES)) {
      throw new Error(`structure type ${json.id}: aid radii must be 0..${WOUND_MAX_RADIUS_TILES} tiles, got ${r}`);
    }
  }
  if (!(a.treat_s <= WOUND_MAX_SECONDS)) {
    throw new Error(`structure type ${json.id}: aid treat_s must be <= ${WOUND_MAX_SECONDS} s, got ${a.treat_s}`);
  }
  const admit = fx.from(a.admit_radius);
  const dispatch = fx.from(a.dispatch_radius);
  const treatTicks = fx.toInt(fx.mul(fx.from(a.treat_s), fx.fromInt(ticksPerSecond)));
  if (treatTicks < 1) throw new Error(`structure type ${json.id}: aid treat_s ${a.treat_s} is under one tick`);
  return { admitRadiusSq: fx.mul(admit, admit), treatTicks, dispatchRadiusSq: fx.mul(dispatch, dispatch) };
}

/** See StructureType.buildable. */
export interface StructureBuildable {
  costLogistics: number;
  costIntel: number;
  buildStep: Fx;
  /** The authored `unlock` gate, opaque: only the runtime reads it (Task 5). */
  unlock: unknown;
  fw: number;
  fh: number;
}

/** Parse a `buildable` block. `ticksPerSecond` is passed in by the Sim (its
 *  TICKS_PER_SECOND) so the clock has one source and this module imports nothing. */
function buildableFromJson(json: StructureTypeJson, ticksPerSecond: number): StructureBuildable | null {
  const b = json.buildable;
  if (b === undefined) return null;
  // Seconds cross into fixed point once, here (invariant 2), exactly as a
  // unit's demolition_time_s does; everything after is integer.
  const ticks = fx.toInt(fx.mul(fx.from(b.build_time_s), fx.fromInt(ticksPerSecond)));
  if (ticks < 1) throw new Error(`structure type ${json.id}: build_time_s ${b.build_time_s} is under one tick`);
  const fp = b.footprint ?? [2, 2];
  const fw = fp[0] ?? 2;
  const fh = fp[1] ?? 2;
  if (fp.length !== 2 || fw < 1 || fh < 1) throw new Error(`structure type ${json.id}: footprint must be [w, h], each >= 1`);
  return {
    costLogistics: b.cost.logistics,
    costIntel: b.cost.intel ?? 0,
    unlock: b.unlock,
    // The tree's integer-divide idiom: the dividend is made exactly divisible
    // first, so no fraction is ever produced (`fixed.ts`).
    buildStep: (ONE - (ONE % ticks)) / ticks,
    fw,
    fh,
  };
}

/**
 * Parse an `aura` block. Every authored float crosses into fixed point once, here, through
 * `fx.from` (invariant 2). A per-second rate becomes a per-tick one by ROUNDED integer
 * division of the fixed value, so no float arithmetic is done on the data: 0.010/s is
 * fx.from 655, (655 + 10) / 20 = 33 raw; 0.0075/s is 492, (492 + 10) / 20 = 25 raw.
 * (Truncating, `fx.div`, would give 32 for the medic.)
 */
function auraFromJson(json: StructureTypeJson, ticksPerSecond: number): StructureAura | null {
  const a = json.aura;
  if (a === undefined) return null;
  const area: AreaEffect[] = [];
  for (const e of a.area ?? []) {
    const affects =
      e.affects === 'foot' ? AFFECTS_FOOT : e.affects === 'vehicle' ? AFFECTS_VEHICLE : e.affects === 'any' ? AFFECTS_ANY : -1;
    if (affects < 0) throw new Error(`structure type ${json.id}: aura affects "${e.affects}", expected foot, vehicle or any`);
    const r = fx.from(e.radius);
    if (r <= 0) throw new Error(`structure type ${json.id}: aura radius must be > 0`);
    const perS = e.heal_per_s ?? e.repair_per_s;
    const healRate = perS === undefined ? 0 : ((fx.from(perS) + (ticksPerSecond >> 1)) / ticksPerSecond) | 0;
    const healCap = perS === undefined ? 0 : e.heal_cap === undefined ? ONE : fx.from(e.heal_cap);
    const compTicks =
      e.repair_components_s === undefined
        ? 0
        : fx.toInt(fx.mul(fx.from(e.repair_components_s), fx.fromInt(ticksPerSecond)));
    area.push({
      radiusSq: fx.mul(r, r),
      affects,
      healRate,
      healCap,
      compTicks,
      accMult: e.accuracy_mult === undefined ? ONE : fx.from(e.accuracy_mult),
    });
  }
  let sensor: StructureSensor | null = null;
  if (a.sensor !== undefined) {
    const sight = fx.from(a.sensor.sight);
    if (sight <= 0) throw new Error(`structure type ${json.id}: aura sensor sight must be > 0`);
    const optics = fx.from(a.sensor.optics);
    if (optics <= 0) throw new Error(`structure type ${json.id}: aura sensor optics must be > 0`);
    const tr = fx.from(a.sensor.tunnel_radius ?? 0);
    if (tr < 0) throw new Error(`structure type ${json.id}: aura sensor tunnel_radius must be >= 0`);
    sensor = { sight, sightSq: fx.mul(sight, sight), optics, tunnelRadiusSq: fx.mul(tr, tr) };
  }
  return {
    area,
    rangeBonus: fx.from(a.garrison?.range_bonus ?? 0),
    sightBonus: fx.from(a.garrison?.sight_bonus ?? 0),
    sensor,
  };
}

export function structureTypeFromJson(json: StructureTypeJson, ticksPerSecond: number): StructureType {
  if (json.owner !== undefined && json.owner !== -1 && json.owner !== 0 && json.owner !== 1) {
    throw new Error(`structure type ${json.id}: owner ${json.owner}, expected -1, 0 or 1`);
  }
  return {
    id: json.id,
    name: json.name ?? json.id,
    hpPerTile: fx.from(json.hp_per_tile),
    garrisonSlots: json.garrison_slots ?? 0,
    rubbleCover: json.rubble_cover ?? 2,
    heightPx: json.height_px ?? 18,
    color: json.color ?? 'limestone.4',
    roePenalty: json.roe_penalty ?? 0,
    producesFor: json.produces_for ?? -1,
    owner: json.owner ?? -1,
    buildable: buildableFromJson(json, ticksPerSecond),
    perTile: json.per_tile ?? false,
    lowProfile: json.low_profile ?? false,
    standingCover: json.standing_cover ?? 2,
    garrisonCover: json.garrison_cover ?? 3,
    floors: json.floors ?? 1,
    aura: auraFromJson(json, ticksPerSecond),
    aid: aidFromJson(json, ticksPerSecond),
    ...(json.wall_tone !== undefined ? { wallTone: json.wall_tone } : {}),
    ...(json.wall_self_lit !== undefined ? { wallSelfLit: json.wall_self_lit } : {}),
  };
}

/**
 * Damage multiplier against masonry by weapon class, Q16.16. Indexed by the
 * WEAPON_CLASS table. Zero means the weapon cannot meaningfully hurt a
 * building, which is why clearing a town needs the right tools rather than
 * more rifles.
 */
export const STRUCT_DAMAGE = new Int32Array([
  16384, // apfsds 0.25 — a dart punches through and out again
  32768, // heat 0.5
  98304, // he 1.5
  39322, // atgm 0.6
  45875, // rpg 0.7
  655, // small_arms 0.01
  1966, // hmg 0.03
  7864, // autocannon 0.12
  91750, // mortar 1.4
  98304, // rocket 1.5
  0, // interceptor
  524288, // demolition 8.0
]);

/** Default seconds a demolition team holds station beside a building before
 *  it collapses, used when a unit's data omits `demolition_time_s`. Data is
 *  authored in real units and must not know the tick rate. */
export const DEMO_SECONDS = 5;
/** How close the team must be to a structure tile: squared tiles, Q16.16. */
export const DEMO_RANGE_SQ = 262144; // 4.0 tile^2 = 2 tiles
/** How close a unit must be to walk in the door: squared tiles, Q16.16. */
export const GARRISON_ENTER_RANGE_SQ = 147456; // 2.25 tile^2 = 1.5 tiles
/** Suppression radius squared when a building comes down, Q16.16 tile². */
export const COLLAPSE_SHOCK_SQ = 589824; // 3 tiles
/** Suppression dealt to everyone near a collapse. */
export const COLLAPSE_SHOCK = 45875; // 0.7
/** Buildings at or above this ROE weight are protected sites: units will not
 *  autonomously fire on them, because levelling a mosque to kill two men in
 *  it is a decision a commander makes, not one a gunner drifts into. */
export const PROTECTED_ROE = 20;
/** Aimed fire at a building barely misses — it is a house, not a man. */
export const STRUCT_BASE_ACCURACY = 62259; // 0.95

/** How close a unit must be pressed against an obstacle before it starts
 *  cutting: squared tiles, Q16.16. Deliberately short — the decision can only
 *  be reached after walking right up to the thing. */
export const BREACH_RANGE_SQ = 409600; // 6.25 tile² = 2.5 tiles
/** Tile-window radius for the local obstacle scan, matching BREACH_RANGE_SQ. */
export const BREACH_TILES = 3;
/** How much extra walking a standing gate is worth, in COST_ORTH units — ten
 *  tiles. Under this, going round is cheap and the unit goes round; over it,
 *  the wall is genuinely in the way and gets cut. This is the knob that keeps
 *  gates the main event and breaches the pressure valve. */
export const BREACH_DETOUR_SLACK = 100;
