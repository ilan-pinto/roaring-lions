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
 * (`decor-place.ts`), so the reeds and the water agree by construction;
 * `control-map.test.ts` proves it on the texels.
 *
 * **G (puddles)** is one term, zeroed by one predicate, `neverWater`: ROADS, a
 * band of unsigned distance `PUDDLE_RUT_HALF_BAND` either side of the
 * wheel-rut offset (`road-graph.ts`'s `RUT_OFFSET`), where a per-texel rut
 * noise passes. The band is wider than the 0.06-tile rut itself: a puddle
 * fills a rut and spills past it. **There is no puddle on open ground**: the
 * lead ruled at S-L1 (30 Oct) that open grass holds none, so the open-ground
 * term and the low-ground boost the plan carried are gone, and G is zero on
 * every texel off a road.
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
import { marshWaterAt } from './shared';
import { smoothNormal, type TerrainSurface } from './surface';
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
}

// -- The constants ---------------------------------------------------------

/** Half-width, in tiles, of the band of road distance a rut puddle fills,
 *  centred on `RUT_OFFSET`. The ruts are 0.06 wide; the puddle spills past. */
export const PUDDLE_RUT_HALF_BAND = 0.12;
/** Rut-noise cycles a tile: a puddle break about every two thirds of a tile. */
export const PUDDLE_RUT_CYCLES = 2;
/** The fraction of the rut band the rut noise fills. Road puddles are then
 *  about this x the band's share of road area (0.14 / 0.36). */
export const PUDDLE_RUT_FILL = 0.56;

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

/** R: `marshWaterAt` at `(px, pz)` -- pass the texel CENTRE. */
export function marshTexel(input: TerrainInput, px: number, pz: number): number {
  return marshWaterAt(input.decor, input.width, input.height, px, pz);
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
  const g = roadPuddleTerm(roadDist, px, pz);
  if (g === 0) return 0;
  const kind = field.kindAt(tx, tz);
  const normalY = smoothNormal(surface, px, pz)[1];
  if (neverWater(input, surface, kind, tx, tz, normalY)) return 0;
  return g;
}
