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
  /** ROE cost when the player levels it (GDD §6). */
  roe_penalty?: number;
  /** Chest-high: blocks movement and shields whoever is hugging it, but you
   *  shoot over it rather than at it. A compound built from sight-blocking
   *  masonry is a blind box -- its garrison cannot fire out, so the wall
   *  protects the besieger. Default false: everything else is a building. */
  low_profile?: boolean;
  /** Cover level 0-3 this gives to a unit fighting from immediately behind it,
   *  while it still stands. The companion to rubble_cover, which is what is
   *  left once it does not. Only consulted for a low_profile type. */
  standing_cover?: number;
  /** A linear run of arbitrary length -- a wall, a fence -- whose tiles each
   *  stand alone: the map loader gives every tile its own structure and its own
   *  HP, and the renderer stamps a sprite per tile. Length is exactly what makes
   *  footprint-wide HP wrong here. Flood-filled, a perimeter would be one object
   *  whose entire ring unblocks the instant it dies, so breaching one panel
   *  would delete the whole compound. */
  per_tile?: boolean;
}

export interface StructureType {
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
  /** A linear run whose tiles are each their own structure -- walls, fences.
   *  See StructureTypeJson.per_tile. */
  perTile: boolean;
}

export function structureTypeFromJson(json: StructureTypeJson): StructureType {
  return {
    id: json.id,
    name: json.name ?? json.id,
    hpPerTile: fx.from(json.hp_per_tile),
    garrisonSlots: json.garrison_slots ?? 0,
    rubbleCover: json.rubble_cover ?? 2,
    heightPx: json.height_px ?? 18,
    color: json.color ?? 'limestone.4',
    roePenalty: json.roe_penalty ?? 0,
    perTile: json.per_tile ?? false,
    lowProfile: json.low_profile ?? false,
    standingCover: json.standing_cover ?? 2,
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
