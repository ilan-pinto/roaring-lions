/**
 * Control C's texels (GH-871 P4, Task 3; R-4): the marsh water weight and the
 * puddle mask a wet ground draws, as pure functions of one point.
 *
 * Pure and three-free, like `shared.ts` (`marshWaterAt`) and `surface.ts`. The
 * import list is pinned by `wet-masks.test.ts`: this file may read the tile
 * hash, the haze maths, the marsh function, the road graph, the surface and the
 * input type, and nothing else. In particular it does NOT import
 * `control-map.ts` (which imports it): the macro field and the tile-kind
 * decision arrive in a `WetField`, built by `control-map.ts`'s `buildWetField`.
 *
 * **R (marsh water)** is `marshWaterAt` at the texel CENTRE, as is. The reed
 * placer rejects a clump centre where that same function reads `>= 0.5`
 * (`decor-place.ts`), so the reeds and the water agree by construction;
 * `control-map.test.ts` proves it on the texels.
 *
 * **G (puddles)** is the max of three terms, then zeroed by one predicate,
 * `neverWater`:
 *
 *  - ROADS: a band of unsigned distance `PUDDLE_RUT_HALF_BAND` either side of
 *    the wheel-rut offset (`road-graph.ts`'s `RUT_OFFSET`), where a per-texel
 *    rut noise passes. The band is wider than the 0.06-tile rut itself: a
 *    puddle fills a rut and spills past it.
 *  - OPEN GROUND: the macro field blended with a fine noise, over
 *    `PUDDLE_OPEN_THRESHOLD`, on flat ground only (`PUDDLE_FLAT_NY`).
 *  - LOW GROUND: an extra term, `PUDDLE_LOW_BOOST` of open ground at
 *    `HAZE_LOW_LEVELS` levels below the map's median open level, linear from 0
 *    at the median (`hazeReferenceLevel`). A separate term over its own
 *    uniform noise, NOT a lowered threshold on the macro score: a threshold on
 *    a smooth 12-tile field raises the share by whatever that field happens to
 *    be where the low ground sits (0 on a trough, 0.3 on a peak), so "+6%" would
 *    be a fact about one map. Over a uniform noise it is +6% of what the open
 *    term has not already taken, on every map.
 *
 * Every value stored in G is a SOFT mask whose 0.5-crossing is the rule's edge
 * (a `smoothstep` centred on the threshold), so the shader thresholds at 0.5
 * and the texture's bilinear filter does the rest. A share is therefore the
 * fraction of texels with `G >= 0.5`.
 *
 * Noise is `tileHash` on STREAM OFFSETS, grepped unused across `terrain/`,
 * `decal-*.ts` and the render package (14,000 to 15,999: nothing else in the
 * render, app, sim or data sources adds a number in that range to a tile
 * coordinate), one pair per stream. Each stream is mapped through its own
 * empirical CDF so a "share" is a share.
 */
import { tileHash } from '../../tile-hash';
import { HAZE_LOW_LEVELS } from '../haze';
import { ROAD_HALF_WIDTH, RUT_OFFSET, roadDistanceAt, type RoadGraph } from './road-graph';
import { marshWaterAt } from './shared';
import { smoothLevel, smoothNormal, type TerrainSurface } from './surface';
import type { TerrainInput } from './types';

/** The tile kinds `tileSurface` can answer, restated so this file need not
 *  import `control-map.ts`. */
export type WetKind = 'open' | 'road' | 'rock' | 'scrub' | 'grove' | 'knoll' | 'pad';

/** The macro field's shape (`control-map.ts`'s `MacroField`), structurally. */
export interface WetMacro {
  readonly size: number;
  /** `size * size` bytes, row-major; 128 is neutral. */
  readonly data: Uint8Array;
}

/** Everything a puddle texel reads that is not the input or the surface. Built
 *  once per bake by `control-map.ts`'s `buildWetField`. */
export interface WetField {
  readonly macro: WetMacro;
  readonly graph: RoadGraph;
  /** `hazeReferenceLevel` of the input: the median open-ground level. */
  readonly refLevel: number;
  /** `tileSurface(input, x, y).kind`. */
  readonly kindAt: (tx: number, tz: number) => WetKind;
  /** False drops the open-ground and low-ground terms (`RenderQuality.rain`,
   *  R-8): roads and marsh stay. */
  readonly openPuddles: boolean;
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

/** A texel is "flat" for the open-ground term above this surface normal Y. */
export const PUDDLE_FLAT_NY = 0.985;
/** Never water on a slope over this many degrees, any term. */
export const PUDDLE_MAX_SLOPE_DEG = 10;
/** `cos(PUDDLE_MAX_SLOPE_DEG)`: a texel whose surface normal Y is under this is
 *  a slope. */
export const PUDDLE_MAX_SLOPE_NY = Math.cos((PUDDLE_MAX_SLOPE_DEG * Math.PI) / 180);

/** The open-ground score is `OPEN_MACRO_WEIGHT * macro + (1 - w) * fine`, both
 *  in `[-1, 1]`: the macro field places the pools, the fine noise breaks their
 *  edges. */
export const PUDDLE_OPEN_MACRO_WEIGHT = 0.7;
/** Noise cycles a tile of the open-ground fine term. */
export const PUDDLE_OPEN_FINE_CYCLES = 1.5;
/** The open-ground score a texel must reach to hold a puddle. */
export const PUDDLE_OPEN_THRESHOLD = 0.385;
/** Half-width of the soft edge around that threshold, in score units. */
const PUDDLE_OPEN_SOFT = 0.04;

/** The share of open ground the low-ground term adds at `HAZE_LOW_LEVELS`
 *  levels below the median (R-4: +6%), linear from 0 at the median. */
export const PUDDLE_LOW_BOOST = 0.06;
/** Noise cycles a tile of the low-ground term. */
export const PUDDLE_LOW_CYCLES = 2;

/** The darker rim every water mask edges with, in tiles (spec 4.3; the shader
 *  reads it in Task 4). */
export const WATER_RIM_TILES = 0.06;

/** The three streams: each an `(a, b)` pair added to the lattice coordinates of
 *  `tileHash`. Fresh: grepped unused (header). */
export const PUDDLE_RUT_STREAM: readonly [number, number] = [14011, 14153];
export const PUDDLE_OPEN_STREAM: readonly [number, number] = [14243, 14369];
export const PUDDLE_LOW_STREAM: readonly [number, number] = [14411, 14519];

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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The macro field at world point `(px, pz)`, bilinear, in `[-1, 1]`. */
function macroAt(macro: WetMacro, width: number, height: number, px: number, pz: number): number {
  const { size, data } = macro;
  const u = Math.min(size - 1, Math.max(0, (px / width) * size - 0.5));
  const v = Math.min(size - 1, Math.max(0, (pz / height) * size - 0.5));
  const i = Math.min(size - 2, Math.floor(u));
  const j = Math.min(size - 2, Math.floor(v));
  const fu = u - i;
  const fv = v - j;
  const a = data[j * size + i] * (1 - fu) + data[j * size + i + 1] * fu;
  const b = data[(j + 1) * size + i] * (1 - fu) + data[(j + 1) * size + i + 1] * fu;
  return ((a * (1 - fv) + b * fv) - 128) / 127;
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

/** The open-ground score at a point, in `[-1, 1]`: the macro field places the
 *  pools, a fine noise breaks their edges. */
export function openPuddleScore(input: TerrainInput, macro: WetMacro, px: number, pz: number): number {
  const m = macroAt(macro, input.width, input.height, px, pz);
  const fine = 2 * uniformNoise(px, pz, PUDDLE_OPEN_FINE_CYCLES, PUDDLE_OPEN_STREAM) - 1;
  return PUDDLE_OPEN_MACRO_WEIGHT * m + (1 - PUDDLE_OPEN_MACRO_WEIGHT) * fine;
}

/** The open-ground term: the score over `PUDDLE_OPEN_THRESHOLD`. */
export function openPuddleTerm(input: TerrainInput, macro: WetMacro, px: number, pz: number): number {
  const score = openPuddleScore(input, macro, px, pz);
  return smoothstep(PUDDLE_OPEN_THRESHOLD - PUDDLE_OPEN_SOFT, PUDDLE_OPEN_THRESHOLD + PUDDLE_OPEN_SOFT, score);
}

/** The low-ground term: `PUDDLE_LOW_BOOST` x (levels below the median / 2). */
export function lowPuddleTerm(refLevel: number, level: number, px: number, pz: number): number {
  const frac = clamp01((refLevel - level) / HAZE_LOW_LEVELS);
  if (frac === 0) return 0;
  const u = uniformNoise(px, pz, PUDDLE_LOW_CYCLES, PUDDLE_LOW_STREAM);
  const edge = 1 - PUDDLE_LOW_BOOST * frac;
  return smoothstep(edge - 0.005, edge + 0.005, u);
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
  const kind = field.kindAt(tx, tz);
  const normalY = smoothNormal(surface, px, pz)[1];
  if (neverWater(input, surface, kind, tx, tz, normalY)) return 0;

  let g = roadPuddleTerm(roadDist, px, pz);
  if (kind === 'open' && field.openPuddles && normalY > PUDDLE_FLAT_NY) {
    g = Math.max(g, openPuddleTerm(input, field.macro, px, pz));
    g = Math.max(g, lowPuddleTerm(field.refLevel, smoothLevel(surface, px, pz), px, pz));
  }
  return g;
}
