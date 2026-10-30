/**
 * The TS mirror of the `THEME_WET` ground GLSL (GH-871 P4 Task 4; R-4 to R-6):
 * the water and puddle surface, the rim, the ripples and the per-surface
 * roughness, as pure functions that `wet-shading.test.ts` drives with literals.
 *
 * Pure and three-free, like `decal-maths.ts` and `haze.ts`: this file may read
 * the tile hash and the rim width `wet-masks.ts` already names, and nothing
 * else (the import list is pinned by its test). `terrain/mesh.ts` builds the
 * GLSL FROM these constants, never from retyped literals, and `mesh.test.ts`
 * pins that the compiled string carries each one -- so a drifted constant
 * moves the shader with it, and a mirror that stops matching the shader fails
 * a test instead of drawing a plausible wrong ground.
 *
 * ## What the shader does, term by term
 *
 * Control C (`wet-masks.ts`) carries two SOFT masks whose 0.5 crossing is the
 * rule's edge: R the marsh water, G the puddles. The shader takes
 * `m = max(R * marshAmp, G) * wetAmp` on ground TOPS and reads:
 *
 *  - COVERAGE: `waterCoverage(m)`, a smoothstep of `WATER_COVER_LO..HI`
 *    around 0.5. The texture's bilinear filter does the rest.
 *  - SURFACE: `waterAlbedo(floor, reflect, sky)` = the tone under it x
 *    `WATER_ALBEDO` (0.55), mixed toward the sky by the REFLECTANCE. The
 *    reflectance is authored (R-5), not Fresnel (physical Fresnel here is 0.05
 *    and reads as nothing, spec 4.3): `uPuddleReflect` for roads and open
 *    ground, `uMarshReflect` for the marsh, weighted by which mask is the
 *    stronger. `sky` is `uWetSky`, `overcast.0` x the rain `hazeRadiance`.
 *  - RIM: a `WATER_RIM_TILES` (0.06) band of `mud.3` on the land side of every
 *    water edge. The shader has a mask, not a distance field, so the distance
 *    to the 0.5 crossing is read off the mask's own gradient:
 *    `edgeDistanceTiles(m, |grad m|)`. `rimWeight` is 1 at the edge and 0 at
 *    the rim's outer line.
 *  - RIPPLES: on water fragments only (`m >= 0.5`), on the SIM clock. The
 *    plane is cut into `RIPPLE_CELL_TILES` (0.5-tile) cells; each cell owns
 *    `RIPPLES_PER_CELL` (2) rings from `tileHash` streams on the fresh
 *    offsets below. A ring is born at a centre kept `RIPPLE_CENTRE_MARGIN_TILES`
 *    (its full radius plus its band) from the cell edge, so no ring crosses a
 *    cell and the field is continuous across one; it grows to `RIPPLE_RING_TILES`
 *    (0.12) over `RIPPLE_LIFE_S` (0.9 s) and fades as it grows. Each ring
 *    tilts the normal outward on its far flank and inward on its near flank
 *    (by up to `RIPPLE_TILT_DEG` per ring) and swings the reflectance by
 *    `RIPPLE_REFLECT_SWING` (+-15%). The summed tilt is CAPPED at
 *    `RIPPLE_TILT_DEG` (8 degrees): two rings can land on one point.
 *  - ROUGHNESS: open 0.62, road mud 0.45, basalt top 0.55, water 0.08, each
 *    blended by its own weight, written into three's `roughnessFactor`.
 *
 * The one inexactness against the GLSL is `tileHash`'s last step: the shader
 * keeps the top 24 bits of the hash (`h >> 8u`, exact in a float, as
 * `decal-pool.ts`'s `rlHash` does), so it reads at most 2^-24 below the value
 * here. Nothing in this file branches on a hash within that of a threshold.
 */
import { tileHash } from '../../tile-hash';
import { WATER_RIM_TILES } from './wet-masks';

export type Vec3 = readonly [number, number, number];

/** The wet tone under water is darkened to this share (spec 4.3: albedo x 0.55). */
export const WATER_ALBEDO = 0.55;
/** The soft mask's coverage ramp, centred on the 0.5 crossing (wet-masks.ts:
 *  "the shader thresholds at 0.5 and the texture's bilinear filter does the rest"). */
export const WATER_COVER_LO = 0.4;
export const WATER_COVER_HI = 0.6;
/** A mask's gradient is never read below this (tiles^-1): a flat mask has no edge. */
export const RIM_GRAD_FLOOR = 0.001;

/** Per-surface roughness (spec 4.3). Open ground is the baseline. */
export const ROUGHNESS_OPEN = 0.62;
export const ROUGHNESS_ROAD = 0.45;
export const ROUGHNESS_WATER = 0.08;
export const ROUGHNESS_BASALT = 0.55;

/** Ripples (spec 4.3, R-6). */
export const RIPPLE_CELL_TILES = 0.5;
export const RIPPLES_PER_CELL = 2;
/** A ring's final radius. */
export const RIPPLE_RING_TILES = 0.12;
/** Half the ring band's width, in tiles. */
export const RIPPLE_BAND_HALF_TILES = 0.025;
/** How far a ring's centre keeps from its cell's edge: the ring's final radius
 *  plus half its band, so no ring (band included) crosses into the next cell. */
export const RIPPLE_CENTRE_MARGIN_TILES = RIPPLE_RING_TILES + RIPPLE_BAND_HALF_TILES;
export const RIPPLE_LIFE_S = 0.9;
/** The normal tilt cap, in degrees, for one ring AND for the sum. */
export const RIPPLE_TILT_DEG = 8;
/** `tan(RIPPLE_TILT_DEG)`: the longest horizontal offset of a unit up normal. */
export const RIPPLE_TILT_TAN = Math.tan((RIPPLE_TILT_DEG * Math.PI) / 180);
/** The reflectance swings by up to this share (+-15%). */
export const RIPPLE_REFLECT_SWING = 0.15;

/**
 * The ripple streams: `(a, b)` pairs added to the lattice coordinates of
 * `tileHash`. FRESH: grepped unused across `terrain/`, `decal-*.ts`, `units/`
 * and the render, app, sim and data sources (30 Oct 2026). Taken so far: the
 * reed and waterside placers' streams (`decor-place.ts`, below 13,300) and
 * control C's three puddle streams (`wet-masks.ts`, below 14,600). Ring `k`
 * adds `k * RIPPLE_RING_STRIDE` to `a`.
 */
export const RIPPLE_X_STREAM: readonly [number, number] = [14621, 14731];
export const RIPPLE_Z_STREAM: readonly [number, number] = [14843, 14957];
export const RIPPLE_PHASE_STREAM: readonly [number, number] = [15061, 15173];
export const RIPPLE_RING_STRIDE = 331;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(lo: number, hi: number, v: number): number {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

/** How much of a fragment the water covers, from the soft mask `m` (0..1). */
export function waterCoverage(m: number): number {
  return smoothstep(WATER_COVER_LO, WATER_COVER_HI, m);
}

/**
 * The water surface's albedo: `(1 - reflect) * WATER_ALBEDO * floor + reflect *
 * sky`, per channel, linear. `sky` is `uWetSky` in the shader.
 */
export function waterAlbedo(floor: Vec3, reflect: number, sky: Vec3): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = (1 - reflect) * WATER_ALBEDO * floor[i] + reflect * sky[i];
  return out;
}

/** Tiles from a fragment on the land side to the mask's 0.5 crossing, read off
 *  the mask's own gradient (`gradPerTile`, the length of its xz gradient). */
export function edgeDistanceTiles(m: number, gradPerTile: number): number {
  return Math.max(0.5 - m, 0) / Math.max(gradPerTile, RIM_GRAD_FLOOR);
}

/** The darker rim's weight at `distTiles` from the water's edge: 1 at the edge,
 *  0 at `WATER_RIM_TILES` and beyond. */
export function rimWeight(distTiles: number): number {
  return 1 - smoothstep(0, WATER_RIM_TILES, distTiles);
}

export interface SurfaceWeights {
  /** The road surface weight (0..1), `rlRoadSurf` in the shader. */
  readonly road: number;
  /** The rock weight on a top (0..1). */
  readonly rock: number;
  /** The water coverage (0..1), `waterCoverage(m)`. */
  readonly water: number;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The roughness three's `roughnessFactor` is set to: open, then road mud, then
 *  basalt, then water, each mixed by its own weight in that order. */
export function wetRoughness(w: SurfaceWeights): number {
  let r = ROUGHNESS_OPEN;
  r = mix(r, ROUGHNESS_ROAD, w.road);
  r = mix(r, ROUGHNESS_BASALT, w.rock);
  r = mix(r, ROUGHNESS_WATER, w.water);
  return r;
}

/** The reflectance after a ripple's swing, kept in 0..1. */
export function rippleReflect(reflect: number, swing: number): number {
  return clamp01(reflect * (1 + RIPPLE_REFLECT_SWING * swing));
}

/** Scales a horizontal normal offset down to the tilt cap, if it is over it. */
export function capOffset(ox: number, oz: number): [number, number] {
  const len = Math.hypot(ox, oz);
  if (len > RIPPLE_TILT_TAN) {
    const k = RIPPLE_TILT_TAN / len;
    return [ox * k, oz * k];
  }
  return [ox, oz];
}

/** The tilt, in degrees, of an up normal given a horizontal offset. */
export function tiltDegrees(ox: number, oz: number): number {
  return (Math.atan(Math.hypot(ox, oz)) * 180) / Math.PI;
}

export interface Ripple {
  /** The horizontal offset added to an up normal (world x, z), over the cap or not. */
  readonly offsetX: number;
  readonly offsetZ: number;
  /** The summed ring signal, clamped to -1..1: the reflectance swing's input. */
  readonly swing: number;
}

/** One ring's contribution at `(px, pz)`: its centre, age and signed strength. */
function ringAt(
  px: number,
  pz: number,
  tSec: number,
  cx: number,
  cz: number,
  k: number
): { s: number; dx: number; dz: number; d: number } {
  const ka = k * RIPPLE_RING_STRIDE;
  const hx = tileHash(cx + RIPPLE_X_STREAM[0] + ka, cz + RIPPLE_X_STREAM[1]);
  const hz = tileHash(cx + RIPPLE_Z_STREAM[0] + ka, cz + RIPPLE_Z_STREAM[1]);
  const hp = tileHash(cx + RIPPLE_PHASE_STREAM[0] + ka, cz + RIPPLE_PHASE_STREAM[1]);
  const span = RIPPLE_CELL_TILES - 2 * RIPPLE_CENTRE_MARGIN_TILES;
  const centreX = cx * RIPPLE_CELL_TILES + RIPPLE_CENTRE_MARGIN_TILES + span * hx;
  const centreZ = cz * RIPPLE_CELL_TILES + RIPPLE_CENTRE_MARGIN_TILES + span * hz;
  const x = tSec / RIPPLE_LIFE_S + hp;
  const u = x - Math.floor(x);
  const radius = RIPPLE_RING_TILES * u;
  const dx = px - centreX;
  const dz = pz - centreZ;
  const d = Math.hypot(dx, dz);
  const band = clamp01(1 - Math.abs(d - radius) / RIPPLE_BAND_HALF_TILES);
  return { s: (1 - u) * band * Math.sign(d - radius), dx, dz, d };
}

/**
 * The ripples at a point on the ground, at sim time `tSec`: the summed,
 * UNCAPPED horizontal normal offset and the swing. `rippleAt` is the capped
 * one the shader uses; this exists so a test can see the cap bind.
 */
export function rippleRaw(px: number, pz: number, tSec: number): Ripple {
  const cx = Math.floor(px / RIPPLE_CELL_TILES);
  const cz = Math.floor(pz / RIPPLE_CELL_TILES);
  let ox = 0;
  let oz = 0;
  let swing = 0;
  for (let k = 0; k < RIPPLES_PER_CELL; k++) {
    const r = ringAt(px, pz, tSec, cx, cz, k);
    if (r.d > 1e-5) {
      ox += (r.dx / r.d) * r.s * RIPPLE_TILT_TAN;
      oz += (r.dz / r.d) * r.s * RIPPLE_TILT_TAN;
    }
    swing += r.s;
  }
  return { offsetX: ox, offsetZ: oz, swing: Math.max(-1, Math.min(1, swing)) };
}

/** `rippleRaw`, with the summed offset capped at `RIPPLE_TILT_DEG`. */
export function rippleAt(px: number, pz: number, tSec: number): Ripple {
  const raw = rippleRaw(px, pz, tSec);
  const [ox, oz] = capOffset(raw.offsetX, raw.offsetZ);
  return { offsetX: ox, offsetZ: oz, swing: raw.swing };
}
