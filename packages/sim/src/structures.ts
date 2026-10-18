// Buildings as first-class sim objects (GDD §5 terrain, ART_PIPELINE §6).
//
// A structure is a set of tiles that blocks movement, absorbs fire, shelters
// a garrison, and leaves passable rubble when it comes down. Masonry is not
// armour: it does not roll on the penetration curve — it soaks damage scaled
// by what the round is actually good for. A rifle bullet does essentially
// nothing to a wall; a mortar shell does a great deal.

import { fx, type Fx } from './fixed';

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
  /** A linear run whose tiles are each their own structure -- walls, fences.
   *  See StructureTypeJson.per_tile. */
  perTile: boolean;
  /** Presentation only. See StructureTypeJson.wall_tone. */
  wallTone?: string;
  /** Presentation only. See StructureTypeJson.wall_self_lit. */
  wallSelfLit?: number;
}

export function structureTypeFromJson(json: StructureTypeJson): StructureType {
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
    perTile: json.per_tile ?? false,
    lowProfile: json.low_profile ?? false,
    standingCover: json.standing_cover ?? 2,
    garrisonCover: json.garrison_cover ?? 3,
    floors: json.floors ?? 1,
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
