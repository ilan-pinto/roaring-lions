/**
 * The wind (GH-984 N1): one pure, three-free field that every swaying thing
 * reads -- crowns, trunks, reeds, grass, shrubs, the held-building banners and
 * the rain's slant -- and the GLSL that draws it. It absorbs `sway.ts`'s
 * constants (`sway.ts` re-exports them and keeps the legacy maths, which is
 * what reduced motion plays).
 *
 * THE CLOCK IS SIM TIME, exactly as `sway.ts` says: `tSec` is
 * `presentationSimMs(sim.tickCount, alpha) / 1000`. Nothing here, and no shader
 * built from it, reads a frame delta, `performance.now` or `Date.now`
 * (`wind-clock.test.ts` scans this file for them). A pinned tick repeats, a
 * zero-time repaint moves nothing, a paused sim is frozen.
 *
 * THE FIELD.
 * - `dir`: a unit vector on the ground plane. By default it is the screen-right
 *   axis `(+x, -z) / sqrt2` -- the lean that reads on this fixed camera -- and a
 *   map may turn it by at most `WIND_SKEW_MAX_DEG` either side of screen-right
 *   or screen-left (`windHeading`; `tools/validate_wind.mjs` enforces the same
 *   bound on the data). A lean along the view axis would read as nothing.
 * - the gust: hand-rolled 1-D value noise over `s = t - dot(p, dir) / SPEED`, so
 *   a gust FRONT travels across the map along the wind at
 *   `WIND_GUST_SPEED_TPS` tiles/s instead of the old periodic bump that lifted
 *   every crown at once every 11 s. The lattice hash is `tileHash` (the
 *   multipliers come from `tile-hash.ts`, never retyped), `Math.random` is not
 *   in the building, and the noise is not a library.
 * - the lean of one vertex: `amp[c] x weight x (sin(phase) x (1 + (gain - 1) g)
 *   + GUST_LEAN x g)` along `dir`, where `g` in [0, 1] is the gust under the
 *   instance's origin and `weight` is `basis ^ stiffness`. `basis` is the
 *   vertex's height inside its own FAMILY's box (`rlNature.x`) for grass, reeds
 *   and shrubs, so a blade bends from its tip, and the world height over
 *   `SWAY_TOP` for a tree, which is the rule crowns have always had.
 *
 * THE PER-VERTEX ATTRIBUTE. `rlNature` is a `vec2` on every foliage and trunk
 * vertex: `.x` the height normalised to the box of ALL the parts of the
 * vertex's family key (not of its own part: a bush's foliage starts half way
 * up its trunk, and normalising each part alone would put the two halves of
 * one bush on different bend curves and tear them apart), `.y` the class.
 *
 * REDUCED MOTION plays today's sway (`mode` 0): the legacy shader branch, the
 * old periodic gust, the old fixed axis, crowns only. It adds nothing.
 *
 * Nothing here reads or writes sim state. The map's `wind` block is app data
 * like the backdrop and `time_of_day`; the sim never sees it.
 */
import { TILE_HASH_MIX, TILE_HASH_MX, TILE_HASH_MY, TILE_HASH_SHIFT_A, TILE_HASH_SHIFT_B, tileHash } from '../../tile-hash';

// --- sway.ts's constants, absorbed (sway.ts re-exports every one) --------------------------

export const SWAY_AMPLITUDE = 0.035; // world units at weight 1
export const SWAY_PERIOD_S = 3.8;
export const SWAY_GUST_GAIN = 1.4;
export const SWAY_GUST_EVERY_S = 11;
export const SWAY_GUST_WIDTH_S = 2.5;
export const SWAY_TOP = 1.0; // world units above the instance origin
export const SWAY_DIR_X = Math.SQRT1_2;
export const SWAY_DIR_Z = -Math.SQRT1_2;
export const SWAY_PHASE_X = 1.7;
export const SWAY_PHASE_Z = 2.3;

/**
 * The wet sway (GH-871 P4 T5, R-3, raised by GH-940): under rain a lean is
 * `RAIN_SWAY_AMP` times as far and a gust peaks at `RAIN_SWAY_GUST` instead of
 * its class gain. A COMPILE-TIME variant (`windVertexChunk(true)`), never a
 * value written into `uSwayAmp`, which the `wind` debug layer owns.
 */
export const RAIN_SWAY_AMP = 2.2;
export const RAIN_SWAY_GUST = 3.0;

// --- the field ---------------------------------------------------------------------------

/** A gust front's speed along the wind, tiles per second (design §7: 3). */
export const WIND_GUST_SPEED_TPS = 3;
/** The noise lattice spacing in seconds. With the thresholds below a point sees a
 *  gust every 11.8 s at the median (5.9 s at the 10th percentile; measured over 20,000 s). */
export const WIND_GUST_CELL_S = 3;
/** `g = smoothstep(LO, HI, noise)`: below LO the air is calm, above HI a gust is at full strength. */
export const WIND_GUST_LO = 0.5;
export const WIND_GUST_HI = 0.85;
/** The second argument of `tileHash` for the gust lattice. */
export const WIND_GUST_SALT = 9157;
/** A gust lifts the flutter by this factor at its peak (design §7: x1.5). */
export const WIND_GUST_GAIN = 1.5;
/** And leans the whole stand downwind by this share of the class amplitude at its peak
 *  (so a front reads as the field bowing together, not only as more jitter). */
export const WIND_GUST_LEAN = 0.5;
/** The strength range a map may ask for, and the skew it may turn the heading by. */
export const WIND_STRENGTH_MIN = 0;
export const WIND_STRENGTH_MAX = 2;
export const WIND_SKEW_MAX_DEG = 30;

/** The class ids written to `rlNature.y`. */
export const WIND_CLASS_GRASS = 0;
export const WIND_CLASS_REED = 1;
export const WIND_CLASS_SHRUB = 2;
export const WIND_CLASS_TREE = 3;
export type WindClassId = 0 | 1 | 2 | 3;

export interface WindClass {
  readonly name: 'grass' | 'reed' | 'shrub' | 'tree';
  /** World units of tip lean at weight 1, strength 1, dry. */
  readonly amp: number;
  readonly periodS: number;
  /** How much a gust lifts the flutter at its peak. */
  readonly gustGain: number;
  /** `weight = basis ^ stiffness`: bigger bends later and harder at the tip. */
  readonly stiffness: number;
  /** True: `basis` is world height over `SWAY_TOP` (a crown); false: height in the family's box. */
  readonly worldBasis: boolean;
}

/** Design §7's start values, each approved on the mock clip sheet. */
export const WIND_CLASSES: readonly WindClass[] = [
  { name: 'grass', amp: 0.015, periodS: 1.9, gustGain: WIND_GUST_GAIN, stiffness: 2, worldBasis: false },
  { name: 'reed', amp: 0.03, periodS: 2.4, gustGain: WIND_GUST_GAIN, stiffness: 1.5, worldBasis: false },
  { name: 'shrub', amp: 0.02, periodS: 3.0, gustGain: WIND_GUST_GAIN, stiffness: 2, worldBasis: false },
  { name: 'tree', amp: SWAY_AMPLITUDE, periodS: SWAY_PERIOD_S, gustGain: WIND_GUST_GAIN, stiffness: 2, worldBasis: true },
];

/**
 * The class a decor key draws as, by the family in front of its `_<variant>`.
 * `null` for a family with no foliage or trunk part to move (rock, sand, slab, boulder, ditch).
 * A family not named here that does carry a foliage part reads as a shrub: gentle, never wrong-looking.
 */
export function windClassOfKey(key: string): WindClassId {
  const family = key.replace(/_\d+$/, '');
  switch (family) {
    case 'grass':
    case 'wet_grass':
      return WIND_CLASS_GRASS;
    case 'reed':
      return WIND_CLASS_REED;
    case 'tree':
    case 'desert_tree':
    case 'cedar':
    case 'oak':
    case 'willow':
      return WIND_CLASS_TREE;
    default:
      return WIND_CLASS_SHRUB;
  }
}

/** What a map (or its theme) asks for. */
export interface WindSettings {
  /** 0..2, a multiplier on every lean. */
  readonly strength: number;
  /** A unit vector on the ground plane (world x, z). */
  readonly dirX: number;
  readonly dirZ: number;
}

export const DEFAULT_WIND: WindSettings = { strength: 1, dirX: SWAY_DIR_X, dirZ: SWAY_DIR_Z };

/** Screen-right and screen-down on the ground plane (`rain-maths.ts`: up the screen is `(-1,-1)/sqrt2`). */
const RIGHT_X = Math.SQRT1_2;
const RIGHT_Z = -Math.SQRT1_2;
const DOWN_X = Math.SQRT1_2;
const DOWN_Z = Math.SQRT1_2;

/**
 * The heading a map's `wind` block names: toward the screen's `east` (right) or `west`
 * (left) side, turned `skewDeg` clockwise as seen on screen (positive turns toward the
 * viewer from east, away from the viewer from west). The skew is clamped to
 * `+-WIND_SKEW_MAX_DEG` and the strength to `[WIND_STRENGTH_MIN, WIND_STRENGTH_MAX]`;
 * the validator refuses out-of-range data, this keeps a hand-built option safe.
 */
export function windHeading(side: 'east' | 'west', skewDeg: number, strength: number): WindSettings {
  const skew = Math.max(-WIND_SKEW_MAX_DEG, Math.min(WIND_SKEW_MAX_DEG, skewDeg));
  const theta = ((side === 'east' ? 0 : 180) + skew) * (Math.PI / 180);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    strength: Math.max(WIND_STRENGTH_MIN, Math.min(WIND_STRENGTH_MAX, strength)),
    dirX: RIGHT_X * c + DOWN_X * s,
    dirZ: RIGHT_Z * c + DOWN_Z * s,
  };
}

/** `gustHash` as the shader reads it: the top 24 bits of `tileHash(i, SALT)`. */
export function gustHash(i: number): number {
  return Math.floor(tileHash(i, WIND_GUST_SALT) * 16777216) / 16777216;
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** 1-D value noise in [0, 1], smooth between hashed integers. */
export function windNoise(u: number): number {
  const i0 = Math.floor(u);
  const f = u - i0;
  const a = gustHash(i0);
  const b = gustHash(i0 + 1);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

/**
 * The gust in [0, 1] at ground point `(x, z)` and sim time `tSec`, along `(dirX, dirZ)`. The front
 * arrives at a point `dot(p, dir) / WIND_GUST_SPEED_TPS` seconds after it passes the origin.
 */
export function windGust(tSec: number, x: number, z: number, dirX: number, dirZ: number): number {
  const s = tSec - (x * dirX + z * dirZ) / WIND_GUST_SPEED_TPS;
  return smoothstep(WIND_GUST_LO, WIND_GUST_HI, windNoise(s / WIND_GUST_CELL_S));
}

/**
 * The world-space lean of a vertex, the shader's own maths at `uSwayAmp = 1`.
 * `hN` is `rlNature.x`, `worldH` the vertex's height above its instance origin in world units.
 */
export function windLean(
  cls: WindClassId,
  hN: number,
  worldH: number,
  tSec: number,
  originX: number,
  originZ: number,
  wind: WindSettings = DEFAULT_WIND,
  wet = false
): { dx: number; dz: number } {
  const c = WIND_CLASSES[cls];
  const basis = c.worldBasis ? worldH / SWAY_TOP : hN;
  const weight = Math.pow(Math.min(1, Math.max(0, basis)), c.stiffness);
  const g = windGust(tSec, originX, originZ, wind.dirX, wind.dirZ);
  const gain = wet ? RAIN_SWAY_GUST : c.gustGain;
  const flutter = Math.sin((2 * Math.PI * tSec) / c.periodS + SWAY_PHASE_X * originX + SWAY_PHASE_Z * originZ);
  const s =
    c.amp * (wet ? RAIN_SWAY_AMP : 1) * wind.strength * weight * (flutter * (1 + (gain - 1) * g) + WIND_GUST_LEAN * g);
  return { dx: wind.dirX * s, dz: wind.dirZ * s };
}

// --- the GLSL ----------------------------------------------------------------------------

/** A GLSL float literal carrying enough digits that `toFixed(8)` of the same constant is the literal. */
export function windFloat(k: number): string {
  return k.toFixed(8);
}

/**
 * The gust, in GLSL: `rlWindHash` is `tileHash` in `uint` (the top 24 bits, as `decal-pool.ts`'s
 * `rlHash`), `rlWindGust` is `windGust`. Shared by the foliage chunk and the banner.
 */
export function windGustGlsl(): string {
  return `
float rlWindHash(int i) {
  uint h = uint(i) * ${TILE_HASH_MX}u + uint(${WIND_GUST_SALT}) * ${TILE_HASH_MY}u;
  h = (h ^ (h >> ${TILE_HASH_SHIFT_A}u)) * ${TILE_HASH_MIX}u;
  h = h ^ (h >> ${TILE_HASH_SHIFT_B}u);
  return float(h >> 8u) / 16777216.0;
}
float rlWindNoise(float u) {
  float i0 = floor(u);
  float f = u - i0;
  float a = rlWindHash(int(i0));
  float b = rlWindHash(int(i0) + 1);
  float s = f * f * (3.0 - 2.0 * f);
  return a + (b - a) * s;
}
float rlWindGust(float t, float ox, float oz, float dx, float dz) {
  float s = t - (ox * dx + oz * dz) / ${windFloat(WIND_GUST_SPEED_TPS)};
  return smoothstep(${windFloat(WIND_GUST_LO)}, ${windFloat(WIND_GUST_HI)}, rlWindNoise(s / ${windFloat(WIND_GUST_CELL_S)}));
}
`;
}

function table(pick: (c: WindClass) => number): string {
  return `float[4](${WIND_CLASSES.map((c) => windFloat(pick(c))).join(', ')})`;
}

/**
 * The per-class lean as one scalar GLSL function (`rlWindLean`, `windLean`'s twin) and the tables it
 * reads. Written in the subset `wind.test.ts` can transpile and run, so the displacement the GPU
 * computes is compared with `windLean` on real numbers and not only by searching the source for its
 * constants. `wet` bakes the two wet constants, the only thing that differs.
 */
export function windLeanGlsl(wet = false): string {
  return `
const float RL_WIND_AMP[4] = ${table((c) => c.amp)};
const float RL_WIND_PERIOD[4] = ${table((c) => c.periodS)};
const float RL_WIND_GAIN[4] = ${table((c) => c.gustGain)};
const float RL_WIND_STIFF[4] = ${table((c) => c.stiffness)};
const float RL_WIND_WORLD[4] = ${table((c) => (c.worldBasis ? 1 : 0))};
${windGustGlsl()}
float rlWindLean(int cls, float hN, float worldH, float t, float ox, float oz, float dx, float dz, float strength) {
  float basis = mix(hN, worldH / ${windFloat(SWAY_TOP)}, RL_WIND_WORLD[cls]);
  float weight = pow(clamp(basis, 0.0, 1.0), RL_WIND_STIFF[cls]);
  float g = rlWindGust(t, ox, oz, dx, dz);
  float gain = ${wet ? windFloat(RAIN_SWAY_GUST) : 'RL_WIND_GAIN[cls]'};
  float flutter = sin(PI2 * t / RL_WIND_PERIOD[cls] + ${windFloat(SWAY_PHASE_X)} * ox + ${windFloat(SWAY_PHASE_Z)} * oz);
  return RL_WIND_AMP[cls] * ${windFloat(wet ? RAIN_SWAY_AMP : 1)} * strength * weight
    * (flutter * (1.0 + (gain - 1.0) * g) + ${windFloat(WIND_GUST_LEAN)} * g);
}
`;
}

/** The uniforms the vertex chunk reads, declared once. */
export const WIND_UNIFORM_DECLS = `uniform float uSwayTime;
uniform float uSwayAmp;
uniform float uWindMode;
uniform float uWindStrength;
uniform vec2 uWindDir;
attribute vec2 rlNature;`;

/**
 * The GLSL spliced after `#include <project_vertex>`.
 *
 * AFTER `project_vertex`, not in `begin_vertex`, for the reason `sway.ts` always gave: the lean needs
 * the instance's WORLD origin and the vertex's WORLD height, and `batchingMatrix` carries both. The
 * lean is added to `mvPosition` in VIEW space and `gl_Position` rewritten; `vViewPosition` is assigned
 * from `mvPosition` after it, so a moved vertex is lit where it is drawn. The shadow and AO passes draw
 * with their own materials and keep the rest pose (spec §3.5: at most 2.2 px; GH-984 N1 measures it).
 *
 * `uWindMode` 0 is reduced motion: today's sway, byte for byte in its maths -- crowns and anything else
 * in the foliage batch by the world-height rule, the periodic gust, the fixed axis -- and a trunk, which
 * has never moved, stays put. Mode 1 is the wind. `uSwayAmp` is 1 in shipping code; the `wind` debug
 * layer sets it to 0 and both modes honour it.
 */
export function windVertexChunk(wet = false, trunk = false): string {
  // The legacy branch's two wet constants, exactly as `swayVertexChunk(wet)` printed them. A trunk
  // never moved in reduced motion, so its legacy amplitude is 0.
  const legacyAmp = trunk ? 0 : wet ? SWAY_AMPLITUDE * RAIN_SWAY_AMP : SWAY_AMPLITUDE;
  const legacyGust = wet ? RAIN_SWAY_GUST : SWAY_GUST_GAIN;
  return `
{
#ifdef USE_BATCHING
  mat4 rlSwayModel = modelMatrix * batchingMatrix;
#else
  mat4 rlSwayModel = modelMatrix;
#endif
  vec3 rlSwayOrigin = rlSwayModel[3].xyz;
  float rlSwayH = (rlSwayModel * vec4(transformed, 1.0)).y - rlSwayOrigin.y;
  vec2 rlSwayDir = vec2(${windFloat(SWAY_DIR_X)}, ${windFloat(SWAY_DIR_Z)});
  float rlSway;
  if (uWindMode > 0.5) {
    rlSwayDir = uWindDir;
    rlSway = uSwayAmp * rlWindLean(int(rlNature.y + 0.5), rlNature.x, rlSwayH, uSwayTime,
      rlSwayOrigin.x, rlSwayOrigin.z, uWindDir.x, uWindDir.y, uWindStrength);
  } else {
    float rlSwayR = clamp(rlSwayH / ${windFloat(SWAY_TOP)}, 0.0, 1.0);
    float rlSwayPh = mod(uSwayTime, ${windFloat(SWAY_GUST_EVERY_S)});
    float rlSwayBump = 0.0;
    if (rlSwayPh < ${windFloat(SWAY_GUST_WIDTH_S)}) {
      float rlSwayB = sin(PI * rlSwayPh / ${windFloat(SWAY_GUST_WIDTH_S)});
      rlSwayBump = rlSwayB * rlSwayB;
    }
    float rlSwayGust = 1.0 + (${windFloat(legacyGust)} - 1.0) * rlSwayBump;
    rlSway = uSwayAmp * ${windFloat(legacyAmp)} * rlSwayR * rlSwayR * rlSwayGust
      * sin(PI2 * uSwayTime / ${windFloat(SWAY_PERIOD_S)}
        + ${windFloat(SWAY_PHASE_X)} * rlSwayOrigin.x + ${windFloat(SWAY_PHASE_Z)} * rlSwayOrigin.z);
  }
  mvPosition += viewMatrix * vec4(rlSwayDir.x * rlSway, 0.0, rlSwayDir.y * rlSway, 0.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;
}
