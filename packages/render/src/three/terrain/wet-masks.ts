/**
 * Control C's texels (GH-871 P4, Task 3; R-4): the marsh water weight and the
 * puddle mask a wet ground draws, as pure functions of one point.
 *
 * Pure and three-free, like `shared.ts` (`marshWaterAt`) and `surface.ts`. The
 * import list is pinned by `wet-masks.test.ts`: this file may read the tile
 * hash, the marsh function, the road graph, the surface and the input type,
 * and nothing else. In particular it does NOT import `control-map.ts` (which
 * imports it): the tile-kind decision arrives in a `WetField`, built by
 * `control-map.ts`'s `buildWetField`.
 *
 * **R (marsh water)** is `marshWaterAt` at the texel CENTRE, as is. The reed
 * placer rejects a clump centre where that same function reads `>= 0.5`
 * (`decor-place.ts`), so the POINT contract holds: `marshWaterAt` is under 0.5
 * at every reed's centre. The agreement is NOT strict on the texels: a texel is
 * wider than a point, so the C.R texel under a reed reads water at a few reeds
 * (56 of 897, 6.2%; `wet-control-map.test.ts` bounds it at 72, 8%).
 *
 * **G (puddles)** is ROADS only, zeroed by one predicate, `neverWater`: two
 * terms, the larger wins. The RUT puddle is a band of unsigned distance
 * `PUDDLE_RUT_HALF_BAND` either side of the wheel-rut offset (`road-graph.ts`'s
 * `RUT_OFFSET`), where a per-texel rut noise passes; the band is wider than
 * the 0.06-tile rut itself (a puddle fills a rut and spills past it). The FORD
 * (GH-940) is a stretch of road in LOW ground, at or under the water table,
 * flooded across its whole width where a coarse noise passes: a pool in the
 * road. **There is no puddle on open ground**: the lead ruled at S-L1 (30 Oct)
 * that open grass holds none, so the open-ground term and the low-ground boost
 * the plan carried are gone, and G is zero on every texel off a road.
 *
 * **R also carries the FLOOD MARGIN (GH-940)**: the marsh spills onto the low
 * ground around it, in irregular pools (`poolTerm`) that hug the marsh's edge
 * and thin out `POOL_REACH_TILES` away, only where the ground is at or under
 * the marsh's own level (the water table, `WetField.waterLevel`) and only on
 * open or scrub ground that is not itself marsh. That is the lead's "standing
 * pools in low tiles" (1 Nov): it is the marsh's own margin, not an isolated
 * puddle on the grass, and it is zero on a map with no marsh. Drawn through R
 * so a pool takes the marsh's reflectance, ripples, rim and the `marsh` debug
 * layer with no new shader term.
 *
 * Every value stored in G is a SOFT mask whose 0.5-crossing is the rule's edge
 * (a `smoothstep` centred on the threshold), so the shader thresholds at 0.5
 * and the texture's bilinear filter does the rest. A share is therefore the
 * fraction of texels with `G >= 0.5`.
 *
 * Noise is `tileHash` on a STREAM OFFSET, grepped unused across `terrain/`,
 * `decal-*.ts` and the render package (14,000 to 15,999: nothing else in the
 * render, app, sim or data sources adds a number in that range to a tile
 * coordinate). The stream is mapped through its own empirical CDF so a "share"
 * is a share.
 */
import { tileHash } from '../../tile-hash';
import { ROAD_HALF_WIDTH, RUT_OFFSET, roadDistanceAt, type RoadGraph } from './road-graph';
import { DECOR_MARSH, marshWaterAt } from './shared';
import { smoothLevel, smoothNormal, type TerrainSurface } from './surface';
import type { TerrainInput } from './types';

/** The tile kinds `tileSurface` can answer, restated so this file need not
 *  import `control-map.ts`. */
export type WetKind = 'open' | 'road' | 'rock' | 'scrub' | 'grove' | 'knoll' | 'pad';

/** Everything a puddle texel reads that is not the input or the surface. Built
 *  once per bake by `control-map.ts`'s `buildWetField`. */
export interface WetField {
  readonly graph: RoadGraph;
  /** `tileSurface(input, x, y).kind`. */
  readonly kindAt: (tx: number, tz: number) => WetKind;
  /**
   * The water table (GH-940), in LEVEL units: the mean level of the marsh's own tiles, or on a map with no marsh the
   * lowest level on it, or 0 on a flat map. Ground at or under it (plus `POOL_LEVEL_SLACK`) is "low".
   */
  readonly waterLevel: number;
  /** 1 on the tiles within `POOL_NEAR_TILES` Chebyshev tiles of a marsh tile (the only tiles a pool can lie on). */
  readonly nearMarsh: Uint8Array;
}

// -- The constants ---------------------------------------------------------

/** Half-width, in tiles, of the band of road distance a rut puddle fills,
 *  centred on `RUT_OFFSET`. The ruts are 0.06 wide; the puddle spills past. 0.12 until GH-940 (0.14: any wider and the band reaches the verge at 0.33). */
export const PUDDLE_RUT_HALF_BAND = 0.14;
/** Rut-noise cycles a tile: a puddle break about every two thirds of a tile. */
export const PUDDLE_RUT_CYCLES = 2;
/** The fraction of the rut band the rut noise fills. Road puddles are then
 *  about this x the band's share of road area. 0.56 until GH-940 (the lead wanted puddles he could see:
 *  more of every rut is full, and wider; 0.7 flooded the whole road in a capture, 0.62 left it a road). */
export const PUDDLE_RUT_FILL = 0.62;

/** Never water on a slope over this many degrees, any term. */
export const PUDDLE_MAX_SLOPE_DEG = 10;
/** `cos(PUDDLE_MAX_SLOPE_DEG)`: a texel whose surface normal Y is under this is
 *  a slope. */
export const PUDDLE_MAX_SLOPE_NY = Math.cos((PUDDLE_MAX_SLOPE_DEG * Math.PI) / 180);

/** The darker rim every water mask edges with, in tiles (spec 4.3; the shader
 *  reads it in Task 4). */
export const WATER_RIM_TILES = 0.06;

/** The stream: an `(a, b)` pair added to the lattice coordinates of
 *  `tileHash`. Fresh: grepped unused (header). */
export const PUDDLE_RUT_STREAM: readonly [number, number] = [14011, 14153];

// -- Pools and fords (GH-940) ------------------------------------------------

/** How far from a marsh tile's edge, in tiles, a flood-margin pool can reach. Two tiles is `WET_SPLICE_MARGIN_TEXELS`
 *  (16 texels at 8 a tile): a rebake of a region is exact to it. */
export const POOL_REACH_TILES = 2;
/** A tile within this Chebyshev distance of a marsh tile can hold a pool (`POOL_REACH_TILES` rounded up, plus the tile). */
export const POOL_NEAR_TILES = 3;
/** The share of the noise a pool passes at the marsh's own edge, falling linearly to 0 at `POOL_REACH_TILES`. */
export const POOL_FILL_NEAR = 0.85;
/** Noise cycles a tile: a pool is a blob about 1.4 tiles across. */
export const POOL_CYCLES = 0.7;
/** How far above the water table, in levels, ground still floods (and the soft ramp over which it stops). */
export const POOL_LEVEL_SLACK = 0.6;
export const POOL_LEVEL_RAMP = 0.5;
/** The share of the noise a FORD passes: a road in low ground floods across its width in stretches about 2 tiles long. */
export const FORD_FILL = 0.3;
export const FORD_CYCLES = 0.45;
/** Fresh streams (grepped unused across `packages/` and `tools/`; the 14,000 to 15,999 band, clear of the ripples' and the rain's). */
export const POOL_STREAM: readonly [number, number] = [15601, 15733];
export const FORD_STREAM: readonly [number, number] = [15811, 15907];

// -- Noise -----------------------------------------------------------------

const ROT_COS = 0.8775825618903728; // cos(0.5)
const ROT_SIN = 0.479425538604203; // sin(0.5)

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear, quintic-faded value noise over `tileHash(i + a, j + b)`, in
 *  `[0, 1)`. */
function streamNoise(px: number, pz: number, cycles: number, stream: readonly [number, number]): number {
  // Rotated half a radian off the tile axes. A road runs along a lattice line
  // and its rut rows sit at fixed fractions of a lattice cell, where the noise
  // is a one-dimensional blend and its distribution is not the two-dimensional
  // one the CDF table measures (the first bake read 0.16 of road for a 0.26
  // design): off-axis, any line crosses cells at every fraction.
  const sx = (px * ROT_COS + pz * ROT_SIN) * cycles;
  const sz = (pz * ROT_COS - px * ROT_SIN) * cycles;
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  const tx = fade(sx - ix);
  const tz = fade(sz - iz);
  const [a, b] = stream;
  const v00 = tileHash(ix + a, iz + b);
  const v10 = tileHash(ix + 1 + a, iz + b);
  const v01 = tileHash(ix + a, iz + 1 + b);
  const v11 = tileHash(ix + 1 + a, iz + 1 + b);
  const x0 = v00 + (v10 - v00) * tx;
  const x1 = v01 + (v11 - v01) * tx;
  return x0 + (x1 - x0) * tz;
}

const CDF_SAMPLES = 4096;
const cdfTables = new Map<string, Float64Array>();

/** The sorted values of a stream's noise at `CDF_SAMPLES` points of a low
 *  discrepancy (R2) sequence over a 64-tile square at one cycle a tile. */
function cdfTable(stream: readonly [number, number]): Float64Array {
  const key = `${stream[0]},${stream[1]}`;
  const have = cdfTables.get(key);
  if (have !== undefined) return have;
  const t = new Float64Array(CDF_SAMPLES);
  for (let n = 0; n < CDF_SAMPLES; n++) {
    const x = ((n * 0.7548776662466927) % 1) * 64;
    const z = ((n * 0.5698402909980532) % 1) * 64;
    t[n] = streamNoise(x, z, 1, stream);
  }
  t.sort();
  cdfTables.set(key, t);
  return t;
}

/** The stream's noise at `(px, pz)` mapped through its empirical CDF: a value
 *  that is uniform on `[0, 1)` over the map, whatever shape value noise has. */
function uniformNoise(px: number, pz: number, cycles: number, stream: readonly [number, number]): number {
  const v = streamNoise(px, pz, cycles, stream);
  const t = cdfTable(stream);
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return (lo + 0.5) / t.length;
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

// -- The rules -------------------------------------------------------------

/**
 * The one never-water predicate: a terrace top, a `^` top, a building pad, a
 * crown, or a slope over `PUDDLE_MAX_SLOPE_DEG`. `normalY` is the drawn
 * surface's normal Y at the point.
 */
export function neverWater(
  input: TerrainInput,
  surface: TerrainSurface,
  kind: WetKind,
  tx: number,
  tz: number,
  normalY: number
): boolean {
  if (kind === 'pad' || kind === 'rock') return true;
  const t = tz * input.width + tx;
  if (input.crown && input.crown[t] !== 0) return true;
  if (!surface.flat && surface.terrace[t] !== 0) return true;
  return normalY < PUDDLE_MAX_SLOPE_NY;
}

/** R's marsh half: `marshWaterAt` at `(px, pz)` -- pass the texel CENTRE. The flood margin is `poolTexel`. */
export function marshTexel(input: TerrainInput, px: number, pz: number): number {
  return marshWaterAt(input.decor, input.width, input.height, px, pz);
}

/**
 * R's flood-margin half (GH-940), for the texel at `(px, pz)`: 0 off ground a pool may lie on. `kind` must be
 * `open` or `scrub`, never `neverWater`, and the point must not be inside a marsh tile. The bake writes
 * `max(marshTexel, poolTexel)`.
 */
export function poolTexel(input: TerrainInput, surface: TerrainSurface, field: WetField, px: number, pz: number): number {
  const tx = Math.floor(px);
  const tz = Math.floor(pz);
  if (tx < 0 || tz < 0 || tx >= input.width || tz >= input.height) return 0;
  // Off the near-marsh tiles the answer is 0 whatever the ground does: the dearer reads wait for a tile that could hold one.
  if (field.nearMarsh[tz * input.width + tx] === 0) return 0;
  const edge = marshEdgeDistance(input, px, pz);
  const level = smoothLevel(surface, px, pz);
  const g = poolTerm(edge, level, field.waterLevel, px, pz);
  if (g === 0) return 0;
  const kind = field.kindAt(tx, tz);
  if (kind !== 'open' && kind !== 'scrub') return 0;
  const normalY = smoothNormal(surface, px, pz)[1];
  if (neverWater(input, surface, kind, tx, tz, normalY)) return 0;
  return g;
}

/** The road term: inside the rut band, where the rut noise passes. */
export function roadPuddleTerm(roadDist: number, px: number, pz: number): number {
  if (!(roadDist < ROAD_HALF_WIDTH)) return 0;
  const band = 1 - smoothstep(PUDDLE_RUT_HALF_BAND - 0.02, PUDDLE_RUT_HALF_BAND + 0.02, Math.abs(roadDist - RUT_OFFSET));
  if (band === 0) return 0;
  const u = uniformNoise(px, pz, PUDDLE_RUT_CYCLES, PUDDLE_RUT_STREAM);
  const pass = 1 - smoothstep(PUDDLE_RUT_FILL - 0.05, PUDDLE_RUT_FILL + 0.05, u);
  return Math.min(band, pass);
}

/** Whether a level is LOW: at or under the water table plus `POOL_LEVEL_SLACK`, a soft `1 .. 0` ramp over
 *  `POOL_LEVEL_RAMP` levels above it. */
export function lowness(level: number, waterLevel: number): number {
  return 1 - smoothstep(POOL_LEVEL_SLACK, POOL_LEVEL_SLACK + POOL_LEVEL_RAMP, level - waterLevel);
}

/** Distance in tiles from `(px, pz)` to the nearest marsh TILE (0 inside one), searched `POOL_NEAR_TILES` around;
 *  `Infinity` when none is that close. */
export function marshEdgeDistance(input: TerrainInput, px: number, pz: number): number {
  const decor = input.decor;
  if (!decor) return Infinity;
  const tx = Math.floor(px);
  const tz = Math.floor(pz);
  let best = Infinity;
  for (let dz = -POOL_NEAR_TILES; dz <= POOL_NEAR_TILES; dz++) {
    for (let dx = -POOL_NEAR_TILES; dx <= POOL_NEAR_TILES; dx++) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= input.width || nz >= input.height) continue;
      if (decor[nz * input.width + nx] !== DECOR_MARSH) continue;
      const gx = Math.max(nx - px, 0, px - (nx + 1));
      const gz = Math.max(nz - pz, 0, pz - (nz + 1));
      const d = Math.hypot(gx, gz);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * The flood margin (GH-940): `[0, 1]`, the marsh spilling onto low ground around it. Zero inside a marsh tile (the
 * marsh's own water is `marshTexel`), beyond `POOL_REACH_TILES` of one, on ground above the water table, and where
 * the noise does not pass; otherwise a blob whose share of the noise is `POOL_FILL_NEAR` at the marsh's edge falling
 * linearly to 0 at the reach, with the 0.5 crossing at the fill.
 */
export function poolTerm(edgeDist: number, level: number, waterLevel: number, px: number, pz: number): number {
  if (!(edgeDist > 0) || !(edgeDist < POOL_REACH_TILES)) return 0;
  const low = lowness(level, waterLevel);
  if (low === 0) return 0;
  const fill = POOL_FILL_NEAR * (1 - edgeDist / POOL_REACH_TILES);
  const u = uniformNoise(px, pz, POOL_CYCLES, POOL_STREAM);
  const pass = 1 - smoothstep(fill - 0.05, fill + 0.05, u);
  return Math.min(pass, low);
}

/** The road in low ground (GH-940): flooded across its whole width, in stretches, where the coarse noise passes. */
export function fordTerm(roadDist: number, level: number, waterLevel: number, px: number, pz: number): number {
  if (!(roadDist < ROAD_HALF_WIDTH)) return 0;
  const low = lowness(level, waterLevel);
  if (low === 0) return 0;
  const u = uniformNoise(px, pz, FORD_CYCLES, FORD_STREAM);
  const pass = 1 - smoothstep(FORD_FILL - 0.05, FORD_FILL + 0.05, u);
  return Math.min(pass, low);
}

/**
 * G: the puddle mask at world point `(px, pz)`, in `[0, 1]` with its 0.5
 * crossing at each rule's edge. `roadDist` is `roadDistanceAt` at the point,
 * passed in when the caller already has it (the bake does, for control B).
 */
export function puddleTexel(
  input: TerrainInput,
  surface: TerrainSurface,
  field: WetField,
  px: number,
  pz: number,
  roadDist: number = roadDistanceAt(field.graph, px, pz)
): number {
  const tx = Math.floor(px);
  const tz = Math.floor(pz);
  if (tx < 0 || tz < 0 || tx >= input.width || tz >= input.height) return 0;
  // Off a rut band the answer is 0 whatever the ground does, so the dearer
  // reads (the tile kind, the drawn normal) wait for a texel that could hold one.
  const rut = roadPuddleTerm(roadDist, px, pz);
  const ford = roadDist < ROAD_HALF_WIDTH ? fordTerm(roadDist, smoothLevel(surface, px, pz), field.waterLevel, px, pz) : 0;
  const g = Math.max(rut, ford);
  if (g === 0) return 0;
  const kind = field.kindAt(tx, tz);
  const normalY = smoothNormal(surface, px, pz)[1];
  if (neverWater(input, surface, kind, tx, tz, normalY)) return 0;
  return g;
}
