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
import type { GroveFamily, OpenScatter } from '../../api';
import { tileHash } from '../../tile-hash';
import { ROAD_EDGE_FALLOFF, ROAD_HALF_WIDTH, buildRoadGraph, roadDistanceAt, type RoadGraph } from './road-graph';
import {
  DECOR_DITCH,
  DECOR_GROVE,
  DECOR_KNOLL,
  DECOR_RIDGE,
  DECOR_ROAD,
} from './shared';
import { buildTerrainSurface, surfaceWorldY, type TerrainSurface } from './surface';
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
  // The Sur highland's grove (GH-322): 0.6 a tile and NO twin (see the twin
  // rule below). A 5.4 m cedar is 1.6x an olive and spans up to 1.6 tiles;
  // at the olive's 1.0 plus its twin, the mock photographed Qarn Hadid's
  // grove as one closed canopy rather than as trees.
  cedar: 0.6,
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
 *  when it does draw.
 *
 *  0.75 SINCE 2026-09-28, the lead's pick of the ladder's first rung
 *  ("Density 0.75"): at 1, beit_sahwan_outskirts (22,24) z0.5 read +1.18 ms
 *  gpu p95 over main (n = 5 interleaved) against a +0.74 budget. N-1's
 *  0.9-an-open-tile band is still the rule at dial 1, and the tests measure
 *  it there; what ships is three quarters of it. */
export const SCATTER_DENSITY = 0.75;

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

/**
 * How far, in tiles, a changed tile reaches into the decor placed by its
 * neighbours -- the margin `spliceDecorPlacements` re-emits around a
 * collapse. Every placement belongs to one SOURCE tile (the tile whose loop
 * iteration pushed it), and what a source tile places is read from:
 *
 *  - its own `blocked`, `cover`, `boulder` and `decor` (the family, the gate);
 *  - for a clump member or a highland chip, the same four at the tile the
 *    member LANDS on, which is at most one tile away: a clump member sits
 *    `CLUSTER_R_MAX` (1.2) from its seed's centre, a chip at most 0.35 + 0.9
 *    = 1.25 from its own -- both inside `x + 0.5 +/- 1.25`, tiles `x - 1 ..
 *    x + 1`;
 *  - for the highland pass, `blocked` at the source's eight neighbours
 *    (`nearStructureOrRoad`), and `decor`/`elevation` two tiles out
 *    (`nearRelief`), which a collapse never changes;
 *  - the drawn ground under each placement, `surfaceWorldY`: the landing
 *    tile's terrace flag, and Catmull-Rom over tile centres with a 4-sample
 *    support, field columns `L - 2 .. L + 2` for a point in tile `L`.
 *
 * A member lands one tile out and reads the field two further: 3. The road
 * graph and the ditch neighbours read `decor` alone, and a changed `decor`
 * array is a full rebuild (`changedTerrainTiles` returns null).
 * `packages/app/src/terrain-splice.test.ts` holds a splice at this radius
 * equal to a full placement after real collapses, and one at radius 2 not.
 */
export const DECOR_SPLICE_RADIUS_TILES = 3;

/**
 * A full placement list plus where each source tile's placements start, per
 * pass: the terrain-decor pass, the grass-and-sand pass and the highland
 * open-ground pass, in that order, each in row-major tile order -- exactly
 * the order `decorPlacements` has always returned. Tile `t`'s placements in
 * pass `p` are `placements[starts[p * (n + 1) + t] .. starts[p * (n + 1) + t
 * + 1])`, `n = width * height`.
 *
 * It also records what it was placed FROM beyond the terrain diff's own
 * inputs (the density dial, the theme's grove species and open scatter, the
 * boulder mask), so a splice against a build made from something else is
 * refused rather than trusted.
 */
export interface TiledDecorPlacements {
  readonly placements: DecorPlacement[];
  readonly width: number;
  readonly height: number;
  readonly starts: Uint32Array;
  readonly density: number;
  readonly groveFamily: GroveFamily | undefined;
  readonly openScatter: OpenScatter | undefined;
  /** By CONTENT, a copy, for the same reason `TerrainBuildState` copies
   *  `cover`: the sim owns the array. */
  readonly boulder: Uint8Array | null;
}

/** The three passes, in output order. */
const DECOR_PASSES = 3;

/** Everything a per-tile emitter reads, resolved once per build. */
interface DecorContext {
  readonly input: TerrainInput;
  readonly grove: GroveFamily;
  readonly surface: TerrainSurface;
  readonly graph: RoadGraph;
  readonly density: number;
  readonly sandKeep: number;
  readonly extra: OpenScatter | undefined;
  /** Tiles within `CROWN_SEAT_TILES` of a crown summit, or null for none. */
  readonly crownNear: Uint8Array | null;
}

/** How far from a crown summit (`crown.ts`) a rock, slab or boulder is SEATED
 *  on the slope: the tell the crown stands on. 4 tiles takes in Milh Flats'
 *  boulder rings (2-4 tiles out) and the dome's own reach onto the ground
 *  around it (Catmull-Rom's support, 2). Further out nothing moves. */
export const CROWN_SEAT_TILES = 4;
/** A seated object never sinks by more than this fraction of its own height.
 *  Measured, not chosen: the first cut sank to the lowest ground under the
 *  whole footprint with a half-height cap, and on Milh Flats the ring boulders
 *  read a size smaller and the knoll's small rocks vanished into the tell. */
export const CROWN_SEAT_MAX_SINK = 0.2;
/** CONTACT radius and height in tiles at scale 1, per seated family. The
 *  height is the family's GLB height (`art/meshes/decor/<family>_<n>.glb`,
 *  largest variant, POSITION bounds); the contact radius is half its
 *  horizontal half-extent, because these meshes are rounded and stand on the
 *  middle of their base -- a slab, a long thin plate, on a quarter of its
 *  1.5-tile length. */
export const CROWN_SEAT_FOOTPRINT: Readonly<Record<'boulder' | 'rock' | 'slab', { radius: number; height: number }>> = {
  boulder: { radius: 0.6, height: 2.3 },
  rock: { radius: 0.19, height: 0.32 },
  slab: { radius: 0.37, height: 0.27 },
};

function crownNearMask(input: TerrainInput): Uint8Array | null {
  const crown = input.crown;
  if (!crown) return null;
  const { width, height } = input;
  const near = new Uint8Array(width * height);
  let any = false;
  for (let t = 0; t < crown.length; t++) {
    if (!crown[t]) continue;
    any = true;
    const cx = t % width;
    const cy = (t - cx) / width;
    for (let dy = -CROWN_SEAT_TILES; dy <= CROWN_SEAT_TILES; dy++) {
      for (let dx = -CROWN_SEAT_TILES; dx <= CROWN_SEAT_TILES; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) near[y * width + x] = 1;
      }
    }
  }
  return any ? near : null;
}

/**
 * The height a rock, slab or boulder is placed at. Everywhere but the tell of
 * a crown summit, the drawn ground under its centre -- unchanged. On that
 * tell, seated on the slope: sunk to the LOWEST ground under its footprint
 * (centre plus eight points on its radius), so the downhill side does not
 * hang clear of the ground, but never by more than `CROWN_SEAT_MAX_SINK` of
 * its own height.
 */
function seatedY(c: DecorContext, family: DecorFamily, tx: number, ty: number, px: number, pz: number, scale: number): number {
  const centre = surfaceWorldY(c.surface, px, pz);
  if (!c.crownNear || !c.crownNear[ty * c.input.width + tx]) return centre;
  if (family !== 'boulder' && family !== 'rock' && family !== 'slab') return centre;
  const { radius, height } = CROWN_SEAT_FOOTPRINT[family];
  const r = radius * scale;
  let low = centre;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    low = Math.min(low, surfaceWorldY(c.surface, px + Math.cos(a) * r, pz + Math.sin(a) * r));
  }
  return Math.max(low, centre - CROWN_SEAT_MAX_SINK * height * scale);
}

function decorContext(input: TerrainInput, density: number, surface: TerrainSurface): DecorContext {
  const extra = input.openScatter;
  return {
    input,
    // Absent means arid means a desert tree -- see `TerrainInput.groveFamily`
    // for why that is the safe default rather than the olive.
    grove: input.groveFamily ?? 'desert_tree',
    surface,
    // The clustering pass and the highland pass are the only things in this
    // file that need a road distance at all. Resolved once here rather than
    // per candidate -- `buildRoadGraph` walks the whole grid -- and skipped
    // entirely when the map carries no road tile (`emptyRoadGraph`);
    // `cachedRoadGraph` memoises the REAL graph by `input.decor`'s identity,
    // so a `composeTerrain` rebuild that changes nothing
    // (`ThreeRenderer.ground-control.test.ts`'s I-1 case) never pays to
    // rebuild it a second time, road-bearing maps included.
    graph: cachedRoadGraphOrEmpty(input),
    density,
    // 1 when the theme declares no open scatter: `keepSand` then never drops a
    // tuft, so every theme before GH-322 places exactly what it placed.
    sandKeep: extra ? extra.sandKeep : 1,
    extra,
    crownNear: crownNearMask(input),
  };
}

function emitTile(c: DecorContext, pass: number, x: number, y: number, out: DecorPlacement[]): void {
  if (pass === 0) emitTerrainDecor(c, x, y, out);
  else if (pass === 1) emitOpenGround(c, x, y, out);
  else if (c.extra) emitOpenScatter(c, c.extra, x, y, out);
}

/** Every decor object on the map, in a stable order (see
 *  `TiledDecorPlacements`). `surface` is `buildTerrainSurface(input)`; a
 *  caller that already holds it passes it rather than paying for a second. */
export function decorPlacements(
  input: TerrainInput,
  density: number = SCATTER_DENSITY,
  surface?: TerrainSurface
): DecorPlacement[] {
  return buildDecorPlacements(input, density, surface).placements;
}

/** `decorPlacements`, with the per-tile starts a later splice needs. */
export function buildDecorPlacements(
  input: TerrainInput,
  density: number = SCATTER_DENSITY,
  surface?: TerrainSurface
): TiledDecorPlacements {
  // Every object below sits on the DRAWN ground, sampled at its own
  // jittered position -- not on `elevation[tile] * WORLD_PER_LEVEL`, which
  // was right when a tile top was a flat quad at its own integer height and
  // is wrong now that open ground ramps (`terrain/surface.ts`). A boulder
  // placed at the tile's integer level on a hillside floats on the downhill
  // side of its own tile and buries itself on the uphill side, by up to half
  // a level either way. `surfaceWorldY` still returns exactly that integer
  // on a terrace and on flat ground, so a ridge slab and every object on
  // every one of the four maps with no elevation grid are unmoved.
  const c = decorContext(input, density, surface ?? buildTerrainSurface(input));
  const { width, height } = input;
  const n = width * height;
  const out: DecorPlacement[] = [];
  const starts = new Uint32Array(DECOR_PASSES * (n + 1));
  for (let pass = 0; pass < DECOR_PASSES; pass++) {
    const base = pass * (n + 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        starts[base + y * width + x] = out.length;
        emitTile(c, pass, x, y, out);
      }
    }
    starts[base + n] = out.length;
  }
  return tiledResult(input, density, out, starts);
}

function tiledResult(
  input: TerrainInput,
  density: number,
  placements: DecorPlacement[],
  starts: Uint32Array
): TiledDecorPlacements {
  return {
    placements,
    width: input.width,
    height: input.height,
    starts,
    density,
    groveFamily: input.groveFamily,
    openScatter: input.openScatter,
    boulder: input.boulder ? input.boulder.slice() : null,
  };
}

/**
 * The tiles `prev` was placed from that differ from `input` in what a
 * splice cannot see through `changedTerrainTiles`: the boulder mask, which
 * only decor reads. `null` when `prev` cannot be spliced at all -- another
 * size, density, grove species or open-scatter theme -- which means a full
 * placement.
 */
export function changedDecorTiles(prev: TiledDecorPlacements, input: TerrainInput, density: number): Uint8Array | null {
  if (prev.width !== input.width || prev.height !== input.height) return null;
  if (prev.density !== density) return null;
  if (prev.groveFamily !== input.groveFamily || prev.openScatter !== input.openScatter) return null;
  if ((prev.boulder === null) !== (input.boulder === null)) return null;
  const changed = new Uint8Array(input.width * input.height);
  if (prev.boulder && input.boulder) {
    for (let t = 0; t < changed.length; t++) if (prev.boulder[t] !== input.boulder[t]) changed[t] = 1;
  }
  return changed;
}

/**
 * `buildDecorPlacements(input, density, surface)`, re-emitting only the
 * source tiles `dirty` marks and copying every other tile's placements from
 * `prev` -- the same objects, in the same order. `dirty` must cover every
 * tile within `DECOR_SPLICE_RADIUS_TILES` of anything that changed; the
 * caller derives it, as it does for the ground (`spliceMask`). Exact, not
 * approximate: a copied tile is what the same emitter made from the same
 * inputs, and a re-emitted one runs that emitter again.
 */
export function spliceDecorPlacements(
  prev: TiledDecorPlacements,
  dirty: Uint8Array,
  input: TerrainInput,
  surface: TerrainSurface,
  density: number = SCATTER_DENSITY
): TiledDecorPlacements {
  const c = decorContext(input, density, surface);
  const { width } = input;
  const n = width * input.height;
  const from = prev.placements;
  const out: DecorPlacement[] = [];
  const starts = new Uint32Array(DECOR_PASSES * (n + 1));
  for (let pass = 0; pass < DECOR_PASSES; pass++) {
    const base = pass * (n + 1);
    for (let t = 0; t < n; t++) {
      starts[base + t] = out.length;
      if (dirty[t] !== 0) {
        emitTile(c, pass, t % width, Math.floor(t / width), out);
      } else {
        const end = prev.starts[base + t + 1];
        for (let i = prev.starts[base + t]; i < end; i++) out.push(from[i]);
      }
    }
    starts[base + n] = out.length;
  }
  return tiledResult(input, density, out, starts);
}

/** Pass 1, one tile: everything but plain open ground -- trees, bushes,
 *  rocks, slabs, boulders and ditch segments. */
function emitTerrainDecor(c: DecorContext, x: number, y: number, out: DecorPlacement[]): void {
  const { input, grove, surface } = c;
  const { width, height, blocked, cover, decor, boulder } = input;
  const t = y * width + x;
  const d = decor ? decor[t] : 0;
  // A ridge is the one blocked tile that is not a building --
  // `buildings.ts`'s own doc comment says so explicitly, and skips
  // exactly it before ever asking whether a structure stands there.
  // Every OTHER blocked tile is a building or fence: `buildBuildings`'s
  // box already owns that ground entirely, so it gets no decor at all.
  // Mirrors `scatter.ts`'s own `if (blocked) { if (decorHere ===
  // DECOR_RIDGE) { ... } }` shape for its ridge grain.
  if (blocked[t] !== 0 && d !== DECOR_RIDGE) return;
  const cv = cover[t];
  const isBoulder = boulder ? boulder[t] !== 0 : false;
  const family = familyFor(d, cv, isBoulder, grove);
  if (family === null) return;
  // Grass and sand ('open') are handled entirely by the clustering pass
  // below -- nothing is placed for them here.
  if (family === 'open') return;

  // Cover level thickens a bush tile; every other family keeps its base
  // density. Clamped so a cover-3 tile cannot exceed 1.
  const tileDensity =
    family === 'bush' ? Math.min(1, BUSH_COVER_BASE * (0.5 + 0.5 * cv)) : DENSITY[family];
  // Own offset stream, like every other roll in this file -- NOT the
  // bare `tileHash(x, y)` scatter.ts's ground grain uses for its own
  // pebble/fleck gate (`rnd > 0.9`, `rnd > 0.84`). A dedicated stream
  // keeps this module's placement gate independent of the ground's own
  // grain roll -- two different rolls reading the same tile, so
  // whether a tile is "pebbled" tells nothing about whether it also
  // gets a rock, a bush or a tree, whatever that family's density is.
  if (tileHash(x + 449, y + 823) >= tileDensity) return;

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
    return;
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
    // its tile's integer level -- see the `surface` note in
    // `buildDecorPlacements`. Elevation is authored independently of the `^`
    // symbol (`map.ts`: "orthogonal to the terrain symbol on purpose"),
    // and a real ridge's elevation IS already raised above its
    // surroundings -- Tel Marum's authored grid reads elevation 3 at its
    // ridge tiles against 1 on the open ground beside them, the
    // two-level rise CLAUDE.md's map section describes for every
    // blocking tile. A ridge is a TERRACE (`surface.ts`), so a slab
    // still lands on the ridge's own flat drawn top, to the bit.
    y: seatedY(c, family, x, y, x + 0.5 + jx * 0.6, y + 0.5 + jy * 0.6, scale),
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
  // A cedar grove never twins (GH-322, see `DENSITY.cedar`).
  if (family === grove && family !== 'cedar' && tileHash(x * 3, y * 7) > 0.62) {
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

/** Pass 2, one tile: clustered grass and sand (G8, spec §3.4) seeded by an
 *  open tile, then its singleton. A member may land on a neighbouring tile,
 *  which is why a splice's margin is wider than the tile that changed. */
function emitOpenGround(c: DecorContext, x: number, y: number, out: DecorPlacement[]): void {
  const { input, grove, surface, graph, density, sandKeep } = c;
  const { width, blocked, cover, decor, boulder } = input;
  const t = y * width + x;
  if (blocked[t] !== 0) return;
  const d = decor ? decor[t] : 0;
  const cv = cover[t];
  const isBoulder = boulder ? boulder[t] !== 0 : false;
  if (familyFor(d, cv, isBoulder, grove) !== 'open') return;

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
      if (clusterFamily === 'sand' && !keepSand(sandKeep, mx, mz)) continue;
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
    if (isOpenScatterAt(input, graph, sx, sz) && (singletonFamily !== 'sand' || keepSand(sandKeep, sx, sz))) {
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

/** Whether a sand tuft at `(px, pz)` survives a theme's `sandKeep`. Keyed on
 *  the tuft's own tile through a dedicated stream (5551/7717), so the kept
 *  fraction is spatially even rather than all-or-nothing per clump. `keep`
 *  of 1 keeps every tuft (`tileHash` is strictly below 1). */
function keepSand(keep: number, px: number, pz: number): boolean {
  return keep >= 1 || tileHash(Math.floor(px) + 5551, Math.floor(pz) + 7717) < keep;
}

/**
 * GH-322's open-ground pass, one tile: trees, outcrop boulders, bushes and
 * stone chips over plain open ground, denser on the "foothill" (within two
 * tiles of a ridge, a knoll or higher ground). One roll a tile on its own
 * stream (4441/6673) -- tree, boulder, bush and chip take consecutive bands
 * of it, so the four probabilities add. A foothill chip also gathers a
 * cluster of 2-4 more stones on `chipCluster` of its tiles: scree collects
 * below slopes.
 *
 * Never within a tile of a road or a building: a cedar in a doorway or on a
 * verge reads as authored content nobody authored. Every stream offset here
 * is unused by the passes above, so turning this on moves none of their
 * placements -- what a highland map loses relative to arid is only what
 * `sandKeep` drops.
 *
 * Decor never reaches the sim (`applyTerrain` passes blocked/cover/elevation/
 * boulder only): a cedar here is no cover, blocks no sight line and stops
 * no vehicle. The band-6 occlusion outline keeps a unit behind one legible.
 */
function emitOpenScatter(c: DecorContext, s: OpenScatter, x: number, y: number, out: DecorPlacement[]): void {
  const { input, grove, surface, graph } = c;
  const { width, blocked, cover, decor, boulder } = input;
  const t = y * width + x;
  if (blocked[t] !== 0) return;
  const isBoulder = boulder ? boulder[t] !== 0 : false;
  if (familyFor(decor ? decor[t] : 0, cover[t], isBoulder, grove) !== 'open') return;
  if (nearStructureOrRoad(input, x, y)) return;
  const foot = nearRelief(input, x, y);
  const treeP = foot ? s.treeFoothill : s.treePlain;
  const boulderP = foot ? s.boulderFoothill : s.boulderPlain;
  const chipP = foot ? s.chipFoothill : s.chipPlain;
  const roll = tileHash(x + 4441, y + 6673);
  const scaleRoll = tileHash(x + 303, y + 7001);
  const px = x + 0.5 + (tileHash(x + 8101, y + 2207) - 0.5) * 0.7;
  const pz = y + 0.5 + (tileHash(x + 2207, y + 8101) - 0.5) * 0.7;
  let family: DecorFamily;
  let scale: number;
  if (roll < treeP) {
    family = s.tree;
    scale = 0.85 + scaleRoll * 0.3;
  } else if (roll < treeP + boulderP) {
    // An outcrop: the `b` field's own 2.1-2.5 m boulders at half to full size.
    family = 'boulder';
    scale = 0.45 + scaleRoll * 0.6;
  } else if (roll < treeP + boulderP + s.bush) {
    family = 'bush';
    scale = 0.9 + scaleRoll * 0.5;
  } else if (roll < treeP + boulderP + s.bush + chipP) {
    family = 'rock';
    scale = 0.6 + scaleRoll * 0.7;
    // Cluster members are re-checked against the same rule the grass and
    // sand members are -- a radius of up to 0.9 tile can carry one off its
    // tile.
    if (foot && tileHash(x + 1777, y + 919) < s.chipCluster) {
      const n = 2 + Math.floor(tileHash(x + 8887, y + 227) * 3);
      for (let k = 0; k < n; k++) {
        const a = tileHash(x * 7 + k + 5003, y * 5 + k + 2707) * TAU;
        const r = 0.35 + tileHash(x * 5 + k + 1301, y * 3 + k + 4409) * 0.55;
        const cx = px + Math.cos(a) * r;
        const cz = pz + Math.sin(a) * r;
        if (!isOpenScatterAt(input, graph, cx, cz)) continue;
        out.push({
          family: 'rock',
          variant: Math.floor(tileHash(x * 19 + k + 8101, y * 23 + k + 5407) * VARIANTS_PER_FAMILY),
          x: cx,
          z: cz,
          y: surfaceWorldY(surface, cx, cz),
          yawTurns: tileHash(x * 29 + k + 9203, y * 31 + k + 6301),
          scale: 0.5 + tileHash(x * 37 + k + 4801, y * 41 + k + 2003) * 0.6,
        });
      }
    }
  } else {
    return;
  }
  out.push({
    family,
    variant: Math.floor(tileHash(x + 9901, y + 1301) * VARIANTS_PER_FAMILY),
    x: px,
    z: pz,
    y: surfaceWorldY(surface, px, pz),
    yawTurns: tileHash(x + 7001, y + 303),
    scale,
  });
}

/** Within two tiles of a ridge, a knoll or higher ground: the highland
 *  pass's "foothill". Reads `decor` and `elevation` alone, which a collapse
 *  never changes. */
function nearRelief(input: TerrainInput, x: number, y: number): boolean {
  const { width, height, decor, elevation } = input;
  const h0 = elevation ? elevation[y * width + x] : 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nt = ny * width + nx;
      const nd = decor ? decor[nt] : 0;
      if (nd === DECOR_RIDGE || nd === DECOR_KNOLL) return true;
      if (elevation && elevation[nt] > h0) return true;
    }
  }
  return false;
}

/** A building (any blocked tile but a ridge) or a road among the eight
 *  neighbours or the tile itself. */
function nearStructureOrRoad(input: TerrainInput, x: number, y: number): boolean {
  const { width, height, blocked, decor } = input;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nt = ny * width + nx;
      const nd = decor ? decor[nt] : 0;
      if (blocked[nt] !== 0 && nd !== DECOR_RIDGE) return true;
      if (nd === DECOR_ROAD) return true;
    }
  }
  return false;
}

/** `cachedRoadGraph` when the map has a road tile at all, the empty graph
 *  otherwise. */
function cachedRoadGraphOrEmpty(input: TerrainInput): RoadGraph {
  const { decor, width, height } = input;
  if (decor && decor.includes(DECOR_ROAD)) return cachedRoadGraph(input);
  return emptyRoadGraph(width, height);
}
