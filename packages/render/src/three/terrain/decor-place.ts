/**
 * Where scattered decor goes, as plain data.
 *
 * Headless on purpose -- no three.js -- so the placement rule is unit-tested
 * directly rather than inferred from a render, exactly like `buildScatter`
 * and `buildGroves` already are.
 *
 * Derived from what a builder can actually read. NOTE: the design doc's table
 * is keyed by map SYMBOL; `TerrainInput` carries no symbols, only the decoded
 * `decor`/`cover`/`blocked`/`elevation` layers, so the rule is keyed by those.
 *
 * Randomness is `tileHash(x, y)`, the same deterministic hash the Pixi
 * backend's ground grain uses -- two hashes that merely both looked random
 * would scatter differently per backend and make every comparison noise.
 * Several independent streams come from offsetting the coordinates, which is
 * cheaper than threading a seed and just as stable.
 */
import type { GroveFamily } from '../../api';
import { tileHash } from '../../tile-hash';
import { ROAD_EDGE_FALLOFF, ROAD_HALF_WIDTH, buildRoadGraph, roadDistanceAt, type RoadGraph } from './road-graph';
import {
  DECOR_DITCH,
  DECOR_GROVE,
  DECOR_KNOLL,
  DECOR_RIDGE,
  DECOR_ROAD,
} from './shared';
import { buildTerrainSurface, surfaceWorldY } from './surface';
import type { TerrainInput } from './types';

export type DecorFamily =
  | 'grass'
  | 'sand'
  | 'bush'
  | GroveFamily
  | 'rock'
  | 'slab'
  | 'boulder'
  | 'ditch';

export interface DecorPlacement {
  readonly family: DecorFamily;
  readonly variant: number;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly yawTurns: number;
  readonly scale: number;
}

export const VARIANTS_PER_FAMILY = 3;

/** How often a qualifying tile actually gets an object. Cover tiles scale
 *  with their level, so a cover-3 thicket reads denser than a cover-1 verge.
 *  `boulder` is 1.0 -- deliberately unconditional, not merely "denser than
 *  rock's 0.75": `b` is a mechanic (a wall to wheels and tracks), not an
 *  aesthetic scatter, and a roll that skipped even one boulder tile would
 *  draw a gap a vehicle could see straight through. */
const DENSITY: Record<Exclude<DecorFamily, 'grass' | 'sand' | 'bush'>, number> = {
  tree: 1.0,
  // Same 1.0 as the olive, and for the same reason: a grove tile is an
  // authored `o`, so every one of them draws its tree. The species differs
  // (`GroveFamily`), the placement rule does not.
  desert_tree: 1.0,
  rock: 0.75,
  slab: 0.6,
  boulder: 1.0,
  // 1.0 for the same reason `boulder` is, and harder: a `d` tile is a wall to
  // anything wheeled or tracked, and a roll that skipped one would draw a
  // visible hole in a continuous earthwork -- a gap the player can see and
  // reasonably read as a way through, on ground `blockedVehicle` says is
  // impassable. That is a gameplay lie, not a cosmetic one.
  ditch: 1.0,
};

/**
 * How far a ditch segment's apron is lifted above the terrain it replaces,
 * in world units.
 *
 * The GLB grounds its APRON's top surface at exactly Z=0
 * (`tools/terrain/export_meshy_ditch.py`, "GROUNDING"), which would make it
 * exactly coplanar with the terrain plane and z-fight across the whole
 * apron -- a fifth of the segment's width, speckling. This is the epsilon
 * that separates them.
 *
 * Deliberately here rather than baked into the GLB: it is a renderer fact,
 * retunable without a re-export, and a reader of the export script should not
 * have to know about the depth buffer.
 *
 * 0.004 is ~1.6% of `WORLD_PER_LEVEL`, so it cannot read as a step at any
 * zoom, and against this camera's ortho depth range it is several hundred
 * depth-buffer steps -- far above the noise floor.
 */
export const DITCH_LIFT = 0.004;

/** Ditch segments are baked to exactly one tile of length and get no random
 *  scale at all. Every other family jitters 0.8-1.2 to break up repetition;
 *  a ditch that did would leave gaps and overlaps along its own run. */
const DITCH_SCALE = 1;

/** The one ditch GLB. `VARIANTS_PER_FAMILY` still governs every other family;
 *  a ditch has a single source, and rolling a variant it does not have would
 *  drop two thirds of its tiles through `buildDecorMesh`'s missing-key path
 *  and punch exactly the holes `DENSITY.ditch = 1.0` exists to prevent. */
const DITCH_VARIANT = 0;

// -- Clustered grass and sand (spec §3.4, G8) --------------------------
//
// Grass and sand no longer roll independently per open tile. The old code
// placed at most one object a tile, at a flat per-tile density (grass 0.34,
// sand 0.18) -- and a flat per-tile roll is, by construction, an even
// (Poisson) scatter: its Clark-Evans ratio reads ~1 (uniform) no matter how
// high or low the density constant is tuned, because density and CLUMPING
// are independent properties of a point pattern. Instead an open tile
// occasionally seeds a CLUMP -- a handful of grass or sand objects gathered
// within a tile or so of each other -- plus, independently, on its OWN
// stream (449/823, the tile's old per-tile density roll -- unaffected by
// whether the same tile also seeds a clump), a sparser scatter of lone
// singletons: "a singleton lands where an object used to". `familyFor`
// below returns the sentinel `'open'` for exactly the tiles the old code
// rolled grass/sand on; the main loop skips those (nothing is placed for
// them there), and `decorPlacements` makes a second pass over the grid to
// roll seeds and singletons.
//
// A member's candidate position is checked against `isOpenScatterAt` --
// blocked/cover/decor/boulder at its own tile, AND road clearance (R-3) --
// because a cluster's radius (up to `CLUSTER_R_MAX`, over a tile) can carry a
// member onto a neighbouring tile the seed tile itself never touches.

/** Chance an open tile seeds a clump, before the density dial.
 *
 *  Raised from 0.09 (lead, 2026-09-27, "Raise seeds to hit 0.9"): the
 *  original 0.09/0.15 pair (see `SINGLETON_P`) measured 0.75 objects an open
 *  tile on the all-open synthetic fixture and 0.585-0.735 across all 26
 *  shipped maps with >=500 open tiles -- below the approved 0.8-0.95
 *  synthetic band and, on three maps, below the 0.65 real-map floor. R-3's
 *  road/terrain clearance (`isOpenScatterAt`) drops real terrain's density
 *  well below the raw seed x mean-count + singleton sum: measured at ~22%
 *  of raw on the real 26-map population (not the ~12% a single synthetic
 *  road+cover probe suggested -- real maps carry more terrain variety).
 *  0.114 (a 1.267x raise, same ratio as `SINGLETON_P`'s raise) was found by
 *  measuring `decorPlacements` against all 26 maps and the synthetic
 *  fixture together at several scale factors: it is the LARGEST raise that
 *  keeps every real map above the 0.65 floor (min 0.731) while keeping the
 *  synthetic fixture under its own 0.95 ceiling (0.947); 1.28x already
 *  pushes the fixture to 0.9501. Real maps land 0.731-0.920, mean 0.862 --
 *  the closest to the approved 0.9 the fixture's own ceiling allows. */
export const CLUSTER_SEED_P = 0.114;
/** A clump's member count is drawn uniformly from this inclusive range. */
export const CLUSTER_MIN = 6;
export const CLUSTER_MAX = 10;
/** A member's distance from its seed tile's centre, in tiles. */
export const CLUSTER_R_MIN = 0.5;
export const CLUSTER_R_MAX = 1.2;
/** Chance an open tile places a single, unclustered object, on the same
 *  stream (and at the same roll) the old unconditional per-tile object used
 *  -- "a singleton lands where an object used to". Raised from 0.15 to 0.19
 *  in the same 1.267x, ratio-preserving move as `CLUSTER_SEED_P` -- see its
 *  doc comment for the full derivation and the lead's approval. */
export const SINGLETON_P = 0.19;
/** N-4: grass must never stand taller than the units it hides behind. Sand
 *  keeps the old 0.8-1.2 scale jitter; only grass is capped down. */
export const GRASS_SCALE_MIN = 0.7;
export const GRASS_SCALE_MAX = 0.9;
/** N-5: a bush is a thicker read of cover, not a flat rate -- the multiplier
 *  cover-1/2/3 apply to below, replacing the old flat `DENSITY.bush`. */
export const BUSH_COVER_BASE = 0.6;
/** `ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF` (road-graph.ts): 0.54 tile. Grass and
 *  sand keep this far from a road's packed surface and its soft edge --
 *  matching every other family's respect for the road, just asserted as one
 *  named constant since it now has two call sites (seed-tile placement and
 *  the density-dial real-map test). */
export const SCATTER_ROAD_CLEAR = ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF;
/** The shed dial (spec §8, N-22): scales seed and singleton probability
 *  only -- never cluster size, radius, family or scale, so thinning the
 *  scatter for a frame-cost emergency cannot also change how a clump looks
 *  when it does draw. */
export const SCATTER_DENSITY = 1;

const TAU = Math.PI * 2;

/** Which family a plain open tile (`familyFor` returned `'open'` for it)
 *  would draw, and the scale roll [0, 1) mapped into that family's own
 *  range: `GRASS_SCALE_MIN..MAX` for grass, the old 0.8-1.2 for sand. */
function openObjectFamily(seedTileHash: number): 'grass' | 'sand' {
  return seedTileHash < 0.6 ? 'grass' : 'sand';
}

function openObjectScale(family: 'grass' | 'sand', roll: number): number {
  return family === 'grass'
    ? GRASS_SCALE_MIN + roll * (GRASS_SCALE_MAX - GRASS_SCALE_MIN)
    : 0.8 + roll * 0.4;
}

/** What `buildRoadGraph` returns for an input with no `r` tile at all: no
 *  nodes, no edges, an all-`-1` `nodeAt`, an all-zero `solid`. Building the
 *  real thing for that answer is pure waste on a map or fixture that never
 *  calls `setDecor` -- most unit tests, and every sandbox screen before a
 *  road is authored -- so `decorPlacements` reaches for this instead of
 *  `buildRoadGraph` whenever its own scan already saw no `DECOR_ROAD` tile. */
function emptyRoadGraph(width: number, height: number): RoadGraph {
  return {
    width,
    height,
    nodes: [],
    edges: [],
    degree: [],
    incident: [],
    nodeAt: new Int32Array(width * height).fill(-1),
    solid: new Uint8Array(width * height),
    branches: [],
  };
}

/**
 * Memoises `buildRoadGraph` by the identity of `input.decor` -- NOT
 * `input.blocked`, which `ThreeRenderer.rebuildTerrain`'s `composeTerrain`
 * recomputes fresh every call via `drawBlockedMask(sim)` even when nothing
 * changed, so keying on it would never hit. `decor` is `ThreeRenderer`'s
 * `retained.decor`: the same array reference survives every rebuild until
 * `setDecor` installs a new one, which is exactly "the map's roads changed"
 * -- the one thing this cache must invalidate on, and the one thing a
 * reference compare (not a content compare, which would cost as much as
 * building the graph) can answer for free. A `WeakMap` rather than a plain
 * one so a discarded decor array (a mission unload, a new map) takes its
 * cached graph with it instead of leaking it for the life of the module.
 *
 * `sawRoad` (this file's own per-tile scan, already paid for) answers
 * "does this map have a road at all" before this is ever consulted: a
 * road-free map or fixture (most unit tests, every sandbox screen before a
 * road is authored, and any input with `decor` null) skips this cache
 * entirely and gets `emptyRoadGraph` -- see the call site.
 *
 * Exported (ground plan 2, Task 4) so `prop-place.ts` shares this exact
 * cache rather than keeping a second `WeakMap` keyed on the same `input.decor`
 * identity -- two caches would mean a road-bearing map pays to build the
 * graph twice on a render where both decor and props are placed, for a
 * result that is byte-identical either way.
 */
const roadGraphCache = new WeakMap<Uint8Array, RoadGraph>();

export function cachedRoadGraph(input: TerrainInput): RoadGraph {
  const { decor } = input;
  // Guaranteed non-null by the call site's `sawRoad` check, but TypeScript
  // cannot see that correlation across two separate bindings -- an explicit
  // guard (not a non-null assertion) is what lets it narrow `decor` below.
  if (!decor) return emptyRoadGraph(input.width, input.height);
  const cached = roadGraphCache.get(decor);
  if (cached) return cached;
  const built = buildRoadGraph(input);
  roadGraphCache.set(decor, built);
  return built;
}

/**
 * Whether a grass/sand object may stand at world `(px, pz)`: inside the map,
 * on a tile with no blocking, cover, decor (road/grove/knoll/ridge/ditch) or
 * boulder, and clear of the road's packed surface and soft edge (R-3).
 *
 * Takes an already-built `RoadGraph` rather than building one itself --
 * `decorPlacements` builds it exactly once per call and reuses it for every
 * candidate; a road graph per member would run `buildRoadGraph` thousands of
 * times per map rebuild for no reason.
 */
export function isOpenScatterAt(input: TerrainInput, graph: RoadGraph, px: number, pz: number): boolean {
  const { width, height, blocked, cover, decor, boulder } = input;
  const x = Math.floor(px);
  const y = Math.floor(pz);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const t = y * width + x;
  if (blocked[t] !== 0) return false;
  if (cover[t] !== 0) return false;
  if (boulder && boulder[t] !== 0) return false;
  if (decor && decor[t] !== 0) return false;
  return roadDistanceAt(graph, px, pz) >= SCATTER_ROAD_CLEAR;
}

/** Which family this tile offers, `'open'` for plain ground (a grass/sand
 *  candidate, resolved by the caller's own clustering pass rather than
 *  here), or null for "nothing grows here".
 *  `boulder` is checked first and unconditionally: `map.ts`'s own legend
 *  ties the `b` symbol to blocked=0/decor=none/cover=0 always, which is
 *  exactly the shape every branch below already reads as "open ground" --
 *  so a boulder tile that fell through to those branches would draw
 *  as bare, walkable ground with a tuft on it, the T1-C bug this exists to
 *  fix. */
function familyFor(
  decor: number,
  cover: number,
  boulder: boolean,
  grove: GroveFamily
): Exclude<DecorFamily, 'grass' | 'sand'> | 'open' | null {
  // BEFORE the boulder branch, and that order is load-bearing. A `d` tile
  // sets `boulder` too -- the two symbols share one vehicle-only mask by
  // design -- so a ditch that fell through to the branch below would draw a
  // field of rocks in its trench and no ditch anywhere.
  if (decor === DECOR_DITCH) return 'ditch';
  if (boulder) return 'boulder';
  if (decor === DECOR_ROAD) return null;
  // The theme's own species -- `TerrainTones.groveFamily`. An olive on a
  // green basin, a desert tree on arid ground.
  if (decor === DECOR_GROVE) return grove;
  if (decor === DECOR_KNOLL) return 'rock';
  if (decor === DECOR_RIDGE) return 'slab';
  if (cover > 0) return 'bush';
  return 'open';
}

/**
 * Whether (x, y) is a ditch tile. Out of bounds is not.
 *
 * Reads the DECOR layer, not `boulder`: `b` sets the same mask bit, so asking
 * `boulder` here would make a boulder field next door bend a ditch's run.
 */
function isDitch(decor: Uint8Array | null, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  return decor !== null && decor[y * width + x] === DECOR_DITCH;
}

/**
 * The yaw turns for a ditch segment's run axis, one entry per segment this
 * tile draws.
 *
 * The asset is a STRAIGHT PRISMATIC SEGMENT baked to exactly one tile of
 * length: laid end to end it is continuous (measured seam mismatch 0.0019 of
 * a 0.236 model height, and decimation does not worsen it), and it cannot
 * express a bend. So a run of arbitrary shape has three cases and this
 * function is where all three are decided:
 *
 *  * STRAIGHT (neighbours on one axis only) -- one segment on that axis.
 *    Because the segment is exactly a tile long and centred, consecutive
 *    tiles abut with no gap and no overlap.
 *
 *  * JUNCTION (neighbours on BOTH axes -- a corner, a T, a crossroads) --
 *    TWO segments, one per axis. This is the honest trade and it is made
 *    deliberately: the asset has no bend, so a corner is either a hole or a
 *    crossing, and a hole is the failure that matters. One segment alone
 *    would leave the other arm's last tile ending 0.29 tiles short of the
 *    trench it is supposed to join -- a visible break in an obstacle the
 *    player is reading to decide whether armour can pass. Two segments cross
 *    at the tile centre instead: no gap ever, at the cost of a visible
 *    X where two trenches meet rather than a smooth bend. **Author ditches
 *    as straight runs**; a corner will look like a crossing, because it is
 *    one. The two segments interpenetrate rather than sharing surfaces, so
 *    this is a modelling artefact, not z-fighting.
 *
 *  * ISOLATED (no ditch neighbour at all) -- one segment, along X. Arbitrary
 *    but fixed, never random: a lone `d` tile is a one-tile obstacle and
 *    there is no run for it to agree with, so the only thing that matters is
 *    that it is deterministic. Rolling `tileHash` here would make a run's
 *    first authored tile flip axis the moment a second tile was authored
 *    beside it.
 */
function ditchYawTurns(
  decor: Uint8Array | null,
  width: number,
  height: number,
  x: number,
  y: number
): readonly number[] {
  const horizontal =
    isDitch(decor, width, height, x - 1, y) || isDitch(decor, width, height, x + 1, y);
  const vertical =
    isDitch(decor, width, height, x, y - 1) || isDitch(decor, width, height, x, y + 1);
  if (horizontal && vertical) return DITCH_YAW_BOTH;
  if (vertical) return DITCH_YAW_VERTICAL;
  return DITCH_YAW_HORIZONTAL;
}

/** The GLB's long axis is +X, so 0 turns runs the trench along the map's x
 *  axis and a quarter turn runs it along y. Module constants rather than
 *  fresh arrays per tile: `decorPlacements` runs over every tile of every
 *  map on every terrain rebuild. */
const DITCH_YAW_HORIZONTAL: readonly number[] = [0];
const DITCH_YAW_VERTICAL: readonly number[] = [0.25];
const DITCH_YAW_BOTH: readonly number[] = [0, 0.25];

export function decorPlacements(input: TerrainInput, density: number = SCATTER_DENSITY): DecorPlacement[] {
  const { width, height, blocked, cover, decor, boulder } = input;
  // Absent means arid means a desert tree -- see `TerrainInput.groveFamily`
  // for why that is the safe default rather than the olive.
  const grove: GroveFamily = input.groveFamily ?? 'desert_tree';
  // Every object below sits on the DRAWN ground, sampled at its own
  // jittered position -- not on `elevation[tile] * WORLD_PER_LEVEL`, which
  // was right when a tile top was a flat quad at its own integer height and
  // is wrong now that open ground ramps (`terrain/surface.ts`). A boulder
  // placed at the tile's integer level on a hillside floats on the downhill
  // side of its own tile and buries itself on the uphill side, by up to half
  // a level either way. `surfaceWorldY` still returns exactly that integer
  // on a terrace and on flat ground, so a ridge slab and every object on
  // every one of the four maps with no elevation grid are unmoved.
  const surface = buildTerrainSurface(input);
  const out: DecorPlacement[] = [];
  // Piggybacked on the main loop below, which already reads `d` for every
  // tile before deciding whether to skip it -- free to track here, and it
  // lets the clustering pass skip `buildRoadGraph` entirely on a map with no
  // `r` tile at all (every sandbox/unit-test fixture that never calls
  // `setDecor`), rather than paying for a graph whose answer is always
  // "no road anywhere" (`ThreeRenderer.ground-control.test.ts`'s I-1 fix
  // pins that a redundant rebuild must not grow the road-graph build count;
  // a decor-free map is exactly its fixture).
  let sawRoad = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      const d = decor ? decor[t] : 0;
      if (d === DECOR_ROAD) sawRoad = true;
      // A ridge is the one blocked tile that is not a building --
      // `buildings.ts`'s own doc comment says so explicitly, and skips
      // exactly it before ever asking whether a structure stands there.
      // Every OTHER blocked tile is a building or fence: `buildBuildings`'s
      // box already owns that ground entirely, so it gets no decor at all.
      // Mirrors `scatter.ts`'s own `if (blocked) { if (decorHere ===
      // DECOR_RIDGE) { ... } }` shape for its ridge grain.
      if (blocked[t] !== 0 && d !== DECOR_RIDGE) continue;
      const c = cover[t];
      const isBoulder = boulder ? boulder[t] !== 0 : false;
      const family = familyFor(d, c, isBoulder, grove);
      if (family === null) continue;
      // Grass and sand ('open') are handled entirely by the clustering pass
      // below -- nothing is placed for them here.
      if (family === 'open') continue;

      // Cover level thickens a bush tile; every other family keeps its base
      // density. Clamped so a cover-3 tile cannot exceed 1.
      const tileDensity =
        family === 'bush' ? Math.min(1, BUSH_COVER_BASE * (0.5 + 0.5 * c)) : DENSITY[family];
      // Own offset stream, like every other roll in this file -- NOT the
      // bare `tileHash(x, y)` scatter.ts's ground grain uses for its own
      // pebble/fleck gate (`rnd > 0.9`, `rnd > 0.84`). A dedicated stream
      // keeps this module's placement gate independent of the ground's own
      // grain roll -- two different rolls reading the same tile, so
      // whether a tile is "pebbled" tells nothing about whether it also
      // gets a rock, a bush or a tree, whatever that family's density is.
      if (tileHash(x + 449, y + 823) >= tileDensity) continue;

      // A ditch is placed, not scattered. Every other family below jitters
      // its position, rolls a variant, rolls a yaw and rolls a scale, which
      // is exactly right for a bush and exactly wrong for a segment of a
      // continuous earthwork: any one of those four would open a gap or an
      // overlap along the run. So this branch shares nothing with the code
      // after it but the tile loop itself.
      //
      // It sits BELOW the density gate rather than above it, and that is not
      // cosmetic: above it, `DENSITY.ditch` would be a constant with a
      // comment and no reader, and a later edit to 0.5 would punch holes in
      // every ditch on every map with nothing to catch it. Below it, 1.0 is
      // load-bearing -- `tileHash` returns strictly under 1, so the roll can
      // never skip a ditch tile, and lowering it fails a test.
      if (family === 'ditch') {
        for (const yawTurns of ditchYawTurns(decor, width, height, x, y)) {
          out.push({
            family: 'ditch',
            variant: DITCH_VARIANT,
            // The tile's exact centre. The segment is one tile long, so this
            // makes it span [x, x+1] precisely and abut its neighbours.
            x: x + 0.5,
            z: y + 0.5,
            y: surfaceWorldY(surface, x + 0.5, y + 0.5) + DITCH_LIFT,
            yawTurns,
            scale: DITCH_SCALE,
          });
        }
        continue;
      }

      const jx = tileHash(x + 101, y + 7) - 0.5;
      const jy = tileHash(x + 13, y + 401) - 0.5;
      const scale = 0.8 + tileHash(x + 71, y + 137) * 0.4;
      out.push({
        family,
        variant: Math.floor(tileHash(x + 53, y + 991) * VARIANTS_PER_FAMILY),
        // WORLD space, not screen. `MeshData`'s own doc: "game tile (x, y) ->
        // (x, height, y)". `isoX`/`isoY` are the projection the CAMERA
        // applies -- baking them in here would project twice. Jitter is
        // therefore in tile units (+/-0.3 of a tile).
        x: x + 0.5 + jx * 0.6,
        z: y + 0.5 + jy * 0.6,
        // The drawn ground under this object's OWN jittered position, not
        // its tile's integer level -- see the `surface` note at the top of
        // this function. Elevation is authored independently of the `^`
        // symbol (`map.ts`: "orthogonal to the terrain symbol on purpose"),
        // and a real ridge's elevation IS already raised above its
        // surroundings -- Tel Marum's authored grid reads elevation 3 at its
        // ridge tiles against 1 on the open ground beside them, the
        // two-level rise CLAUDE.md's map section describes for every
        // blocking tile. A ridge is a TERRACE (`surface.ts`), so a slab
        // still lands on the ridge's own flat drawn top, to the bit.
        y: surfaceWorldY(surface, x + 0.5 + jx * 0.6, y + 0.5 + jy * 0.6),
        yawTurns: tileHash(x + 617, y + 29),
        scale,
      });

      // A second, smaller tree on the same grove tile -- retiring the
      // procedural canopy (`grove.ts`, Task 7) means this is now the ONLY
      // place a grove tile's tree count is decided, so it reproduces
      // grove.ts's own twin rule exactly (`tileHash(x * 3, y * 7) > 0.62`,
      // second tree at 0.68 scale) rather than silently thinning every
      // grove to one tree per tile. Own hash stream (601/491, an offset
      // pair unused by any other roll in this file) so the second tree's
      // position/variant/yaw are independent draws, not a duplicate
      // stacked exactly on the first.
      // `family === grove`, not `=== 'tree'`: the twin rule is about a GROVE
      // TILE carrying two canopies, and since 2026-09-07 the species on that
      // tile is the theme's (`GroveFamily`). Keyed on the literal olive it
      // stopped firing on every arid map at once and thinned every desert
      // grove to one tree -- caught by this file's own twin tests.
      if (family === grove && tileHash(x * 3, y * 7) > 0.62) {
        const jx2 = tileHash(x + 601, y + 491) - 0.5;
        const jy2 = tileHash(x + 491, y + 601) - 0.5;
        out.push({
          family: grove,
          variant: Math.floor(tileHash(x + 601, y + 991) * VARIANTS_PER_FAMILY),
          x: x + 0.5 + jx2 * 0.6,
          z: y + 0.5 + jy2 * 0.6,
          y: surfaceWorldY(surface, x + 0.5 + jx2 * 0.6, y + 0.5 + jy2 * 0.6),
          yawTurns: tileHash(x + 601, y + 29),
          scale: scale * 0.68,
        });
      }
    }
  }

  // Second pass: clustered grass and sand (G8, spec §3.4). The graph is
  // resolved once here rather than per candidate -- `buildRoadGraph` walks
  // the whole grid, and a cluster's own members are the only thing in this
  // file that needs a road distance at all. Skipped entirely when the map
  // carries no road tile at all (`sawRoad` above already paid for that
  // answer); otherwise `cachedRoadGraph` memoises the REAL graph by
  // `input.decor`'s identity, so a `composeTerrain` rebuild that changes
  // nothing (`ThreeRenderer.ground-control.test.ts`'s I-1 case) never pays
  // to rebuild it a second time, road-bearing maps included.
  const graph = sawRoad ? cachedRoadGraph(input) : emptyRoadGraph(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      if (blocked[t] !== 0) continue;
      const d = decor ? decor[t] : 0;
      const c = cover[t];
      const isBoulder = boulder ? boulder[t] !== 0 : false;
      if (familyFor(d, c, isBoulder, grove) !== 'open') continue;

      if (tileHash(x + 2203, y + 1499) < CLUSTER_SEED_P * density) {
        const clusterFamily = openObjectFamily(tileHash(x + 977, y + 311));
        const count =
          CLUSTER_MIN + Math.floor(tileHash(x + 3301, y + 709) * (CLUSTER_MAX - CLUSTER_MIN + 1));
        for (let k = 0; k < count; k++) {
          const angle = tileHash(x * 7 + k + 3001, y * 5 + k + 1709) * TAU;
          const radius =
            CLUSTER_R_MIN + tileHash(x * 5 + k + 1201, y * 3 + k + 4409) * (CLUSTER_R_MAX - CLUSTER_R_MIN);
          const mx = x + 0.5 + Math.cos(angle) * radius;
          const mz = y + 0.5 + Math.sin(angle) * radius;
          if (!isOpenScatterAt(input, graph, mx, mz)) continue;
          out.push({
            family: clusterFamily,
            variant: Math.floor(tileHash(x * 19 + k + 8101, y * 23 + k + 5407) * VARIANTS_PER_FAMILY),
            x: mx,
            z: mz,
            y: surfaceWorldY(surface, mx, mz),
            yawTurns: tileHash(x * 29 + k + 9203, y * 31 + k + 6301),
            scale: openObjectScale(clusterFamily, tileHash(x * 37 + k + 4801, y * 41 + k + 2003)),
          });
        }
      }

      // The old unconditional per-tile object, still gated on its own old
      // stream (449/823) -- reused here as the singleton roll rather than a
      // fresh offset, and every other roll below (position, variant, yaw,
      // scale) is the exact formula that tile's one object used to get.
      if (tileHash(x + 449, y + 823) < SINGLETON_P * density) {
        const singletonFamily = openObjectFamily(tileHash(x + 977, y + 311));
        const jx = tileHash(x + 101, y + 7) - 0.5;
        const jy = tileHash(x + 13, y + 401) - 0.5;
        const sx = x + 0.5 + jx * 0.6;
        const sz = y + 0.5 + jy * 0.6;
        if (isOpenScatterAt(input, graph, sx, sz)) {
          out.push({
            family: singletonFamily,
            variant: Math.floor(tileHash(x + 53, y + 991) * VARIANTS_PER_FAMILY),
            x: sx,
            z: sz,
            y: surfaceWorldY(surface, sx, sz),
            yawTurns: tileHash(x + 617, y + 29),
            scale: openObjectScale(singletonFamily, tileHash(x + 71, y + 137)),
          });
        }
      }
    }
  }

  return out;
}
