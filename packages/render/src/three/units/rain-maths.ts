/**
 * The falling rain's maths (GH-871 P4, Task 8; R-7): the lattice the drops live
 * on, where one is at a time, the splash it leaves, the width of its streak and
 * the ground-height bake -- all pure functions of numbers.
 *
 * Pure and three-free, the `decal-maths.ts` / `wet-shading.ts` pattern. The
 * import list is pinned by `rain-maths.test.ts`: the weather constants, the
 * projection constants, the tile hash and the sway wind. `rain-batch.ts`
 * carries a GLSL copy of every term below, built from these exported constants
 * (never retyped literals), and a test proves the compiled string carries them.
 *
 * ## The lattice (R-7)
 *
 * Each drop owns a seed `s` in `[0,1)^3`. Its LANDING point is world-anchored
 * modulo a period `P`: `x = lo + mod(s.x * P - lo, P)` (z likewise), the one
 * representative of `s.x * P` (mod `P`) inside the window `[lo, lo + P)`. The
 * window is a `P` square centred on the box of landing points the screen can see
 * (`windowLow`; R-7 centres it on the focus, and the box centre is the focus
 * moved toward the camera by the reach, which is what keeps a drop's wrap outside
 * the screen). A pan therefore moves no drop: it slides the window, and a drop
 * only changes (by exactly one `P`) when it crosses the window's edge. A `P`
 * step (a zoom across a threshold) reshuffles every drop once; that is the only
 * reshuffle, and accepted.
 *
 * ## The fall
 *
 * `h = H - mod(s.y * H + V * t, H)`: the drop's height above the ground at its
 * landing point, `t` the SIM clock in seconds. It lands when the mod wraps; the
 * splash then lives 150 ms, and the same drop starts again at the top. The path
 * is slanted `RAIN_SLANT_DEG` from the vertical, down-wind (the foliage sway's
 * axis), so at height `h` the drop sits `h * tan(slant)` UPWIND of its landing.
 */
import { ELEVATION, TILE_H, TILE_W } from '../../project';
import { tileHash } from '../../tile-hash';
import { SWAY_DIR_X, SWAY_DIR_Z } from '../terrain/sway';
import {
  RAIN_COLOUR_CEILING,
  RAIN_FALL_HEIGHT,
  RAIN_FALL_SPEED,
  RAIN_HEIGHT_TEXELS_PER_TILE,
  RAIN_PERIODS,
  RAIN_PERIOD_PAD,
  RAIN_SLANT_DEG,
  RAIN_SPLASH_ALPHA,
  RAIN_SPLASH_MS,
  RAIN_SPLASH_R0,
  RAIN_SPLASH_R1,
  RAIN_STREAK_CSS_PX,
} from '../weather';

/** `tan` / `sin` / `cos` of the slant. */
export const RAIN_SLANT_TAN = Math.tan((RAIN_SLANT_DEG * Math.PI) / 180);
export const RAIN_SLANT_SIN = Math.sin((RAIN_SLANT_DEG * Math.PI) / 180);
export const RAIN_SLANT_COS = Math.cos((RAIN_SLANT_DEG * Math.PI) / 180);

/** CSS pixels per world unit at zoom 1: the dimetric camera frames `vp.width /
 *  (TILE_W * zoom * sqrt 2)` view units across `vp.width` pixels (`silhouette.ts`'s
 *  `SILHOUETTE_PX_PER_WORLD_UNIT` and `beam-look.ts`'s `BEAM_PX_PER_WORLD_UNIT`,
 *  the same derivation; `rain-maths.test.ts` pins all three equal). */
export const RAIN_PX_PER_WORLD_UNIT = (TILE_W * Math.SQRT2) / 2;

/** The map's margin the rain still covers beyond its edge, tiles: the skirt and the
 *  fade the ground ends in. A box is clipped to the map plus this. */
export const RAIN_MAP_MARGIN = 8;

/** The soft fade over which rain thins to nothing at the map's edge, tiles: a drop landing this
 *  far INSIDE the edge or more is whole, one landing on the edge or beyond it is gone. */
export const RAIN_EDGE_FADE = 0.5;

/**
 * The map-edge fade of a drop, `0..1`, from its LANDING point (so a splash and the streak that
 * made it agree): `smoothstep(0, RAIN_EDGE_FADE, d)` with `d` the signed distance, in tiles, from
 * the landing point to the nearest edge of the map rectangle `[0, W] x [0, H]` (positive inside).
 * Rain stops at the edge of the world the sim has, and does not pop. The GLSL in `rain-batch.ts`
 * is a copy; both read `RAIN_EDGE_FADE`.
 */
export function mapEdgeFade(landX: number, landZ: number, mapW: number, mapH: number): number {
  const d = Math.min(Math.min(landX, mapW - landX), Math.min(landZ, mapH - landZ));
  const t = clamp01(d / RAIN_EDGE_FADE);
  return t * t * (3 - 2 * t);
}

/** The camera, as the rain reads it: the focus in tiles, the zoom, and the CSS viewport. */
export interface RainView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

/** A box on the ground plane, world x and z. */
export interface GroundBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** How far toward the camera (down the screen) a landing point can lie while its
 *  drop is still seen in the air above the bottom edge: `H / tan(elevation)`. */
export const RAIN_REACH = RAIN_FALL_HEIGHT / Math.tan(ELEVATION);
/**
 * The reach over ground `maxGround` wu high: a landing point on higher ground puts
 * the drop's whole fall `maxGround` higher up the screen, so it shows from
 * `maxGround / tan(elevation)` tiles further toward the camera (about 4 tiles at the
 * highest drawn ground, 2.3 wu). `RainBatch` passes the map's baked maximum.
 */
export function rainReach(maxGround: number): number {
  return (RAIN_FALL_HEIGHT + Math.max(0, maxGround)) / Math.tan(ELEVATION);
}
/** How far a drop's head sits from its landing point horizontally, at most. */
export const RAIN_SLANT_OFFSET = RAIN_FALL_HEIGHT * RAIN_SLANT_TAN;

/**
 * The ground the rain must cover to fill the screen: every LANDING point whose
 * drop (anywhere on its 0..H fall) can be seen. That is the camera's ground
 * footprint -- a rectangle of half-extents `a` along `(1,-1)/sqrt2` and `b` along
 * `(-1,-1)/sqrt2`, whose axis-aligned box has half-side `(a + b)/sqrt2` -- grown
 * toward the camera by `RAIN_REACH` (a landing point just below the bottom edge
 * still shows its drop up the screen) and on every side by the slant offset, then
 * clipped to the map plus `RAIN_MAP_MARGIN` when `map` is given.
 */
export function footprintBox(
  view: RainView,
  map?: { readonly width: number; readonly height: number },
  maxGround = 0
): GroundBox {
  const a = view.width / (TILE_W * view.zoom * Math.SQRT2);
  const b = view.height / (TILE_H * view.zoom * Math.SQRT2);
  const half = (a + b) / Math.SQRT2;
  const reach = rainReach(maxGround) / Math.SQRT2;
  let minX = view.x - half - RAIN_SLANT_OFFSET;
  let maxX = view.x + half + reach + RAIN_SLANT_OFFSET;
  let minZ = view.y - half - RAIN_SLANT_OFFSET;
  let maxZ = view.y + half + reach + RAIN_SLANT_OFFSET;
  if (map !== undefined) {
    const lx = Math.max(minX, -RAIN_MAP_MARGIN);
    const hx = Math.min(maxX, map.width + RAIN_MAP_MARGIN);
    const lz = Math.max(minZ, -RAIN_MAP_MARGIN);
    const hz = Math.min(maxZ, map.height + RAIN_MAP_MARGIN);
    // A focus far off the map leaves nothing to clip to on that axis: keep the box.
    if (lx <= hx) {
      minX = lx;
      maxX = hx;
    }
    if (lz <= hz) {
      minZ = lz;
      maxZ = hz;
    }
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * The lattice period: the smallest of `RAIN_PERIODS` that covers `box` (its larger
 * side times `RAIN_PERIOD_PAD`); the largest when none does.
 */
export function latticePeriod(box: GroundBox): number {
  const need = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) * RAIN_PERIOD_PAD;
  for (const p of RAIN_PERIODS) if (p >= need) return p;
  return RAIN_PERIODS[RAIN_PERIODS.length - 1];
}

/**
 * The window's low corner: a `period` square centred on `box`. Any window works
 * for pan invariance (a drop's position is `s * P` modulo `P` whatever the window
 * is); centring it on the box is what makes a drop wrap OUTSIDE it.
 */
export function windowLow(box: GroundBox, period: number): { x: number; z: number } {
  return { x: (box.minX + box.maxX) / 2 - period / 2, z: (box.minZ + box.maxZ) / 2 - period / 2 };
}

/**
 * The production choice, in one place: the lattice period and the window's low
 * corner for a view on a map whose highest drawn ground is `maxGround`.
 */
export function rainWindow(
  view: RainView,
  map: { readonly width: number; readonly height: number },
  maxGround = 0
): { period: number; low: { x: number; z: number } } {
  // The period from the UNCLIPPED box, so it is a property of the zoom, the viewport and the
  // ground and never of the pan: choosing it from the box clipped to the map made P drop a step
  // near a map edge with no zoom change (every drop jumping, density per tile 4x). The clipped
  // box only places the window, and it is never wider than the unclipped one, so it still fits.
  const period = latticePeriod(footprintBox(view, undefined, maxGround));
  return { period, low: windowLow(footprintBox(view, map, maxGround), period) };
}

/** A modulus that stays in `[0, m)` for a negative `a` (JS `%` does not). */
export function posMod(a: number, m: number): number {
  return a - m * Math.floor(a / m);
}

/** One axis of a drop's landing point: world-anchored modulo `period`, inside the window at `lo`. */
export function wrapAxis(seed: number, lo: number, period: number): number {
  return lo + posMod(seed * period - lo, period);
}

/** The seed of instance `i`: three values in `[0,1)`, from the tile hash on fixed streams. */
export const RAIN_SEED_STREAMS: readonly [number, number] = [15401, 15527];
export function dropSeed(i: number): [number, number, number] {
  const [a, b] = RAIN_SEED_STREAMS;
  return [tileHash(i, a), tileHash(i, b), tileHash(i + 7919, a + b)];
}

/** Where a drop lands: the lattice point, in world x and z. */
export function dropLanding(
  seed: readonly [number, number, number],
  lo: { readonly x: number; readonly z: number },
  period: number
): { x: number; z: number } {
  return { x: wrapAxis(seed[0], lo.x, period), z: wrapAxis(seed[2], lo.z, period) };
}

/** The fall phase in `[0, H)`: it wraps to 0 at the instant the drop lands. */
export function dropPhase(seedY: number, tSec: number): number {
  return posMod(seedY * RAIN_FALL_HEIGHT + RAIN_FALL_SPEED * tSec, RAIN_FALL_HEIGHT);
}

/**
 * A drop's head at sim time `tSec`: the lattice landing point, lifted by the
 * fall and pushed upwind by the slant. `groundY` is the ground height at the
 * LANDING point (the caller samples it there). Also returns the landing point,
 * the height above it and the phase.
 */
export function dropPosition(
  seed: readonly [number, number, number],
  lo: { readonly x: number; readonly z: number },
  period: number,
  tSec: number,
  groundY: number
): { x: number; y: number; z: number; landX: number; landZ: number; height: number; phase: number } {
  const land = dropLanding(seed, lo, period);
  const phase = dropPhase(seed[1], tSec);
  const height = RAIN_FALL_HEIGHT - phase;
  return {
    x: land.x - RAIN_SLANT_TAN * height * SWAY_DIR_X,
    y: groundY + height,
    z: land.z - RAIN_SLANT_TAN * height * SWAY_DIR_Z,
    landX: land.x,
    landZ: land.z,
    height,
    phase,
  };
}

/** Milliseconds since a drop landed: the fall phase over the speed. */
export function splashAgeMs(phase: number): number {
  return (phase / RAIN_FALL_SPEED) * 1000;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The splash ring's radius, world units: 0.04 -> 0.10 over its 150 ms. */
export function splashRadius(ageMs: number): number {
  return RAIN_SPLASH_R0 + (RAIN_SPLASH_R1 - RAIN_SPLASH_R0) * clamp01(ageMs / RAIN_SPLASH_MS);
}

/** The splash ring's alpha: 0.35 -> 0 over its 150 ms, and 0 outside it. */
export function splashAlpha(ageMs: number): number {
  if (ageMs < 0 || ageMs >= RAIN_SPLASH_MS) return 0;
  return RAIN_SPLASH_ALPHA * (1 - ageMs / RAIN_SPLASH_MS);
}

/**
 * A streak's width in WORLD units: `RAIN_STREAK_CSS_PX` CSS pixels on screen at
 * every zoom (the constant-pixel rule, `silhouette.ts`'s lesson), device
 * pixels included. The device width is the CSS width times `dpr`; a world unit
 * is `RAIN_PX_PER_WORLD_UNIT * zoom * dpr` device pixels; so `dpr` cancels and a
 * streak is 1.5 CSS px (3 device px at DPR 2) however the canvas is scaled.
 */
export function streakWidthWorld(zoom: number, dpr: number): number {
  const devicePx = RAIN_STREAK_CSS_PX * dpr;
  return devicePx / (RAIN_PX_PER_WORLD_UNIT * Math.max(zoom, 1e-3) * dpr);
}

/** The height texture's side in texels for a map side in tiles. */
export function heightTexels(tiles: number): number {
  return tiles * RAIN_HEIGHT_TEXELS_PER_TILE;
}

/**
 * The ground-height texture's texels (R-7): `RAIN_HEIGHT_TEXELS_PER_TILE` a tile,
 * row-major, each the `sampler` (the renderer passes `groundWorldY`) at the
 * texel's CENTRE in world x and z. Row `j` is world z `(j + 0.5) / 4`.
 */
export function bakeHeightTexels(
  sampler: (x: number, z: number) => number,
  width: number,
  height: number
): Float32Array {
  const w = heightTexels(width);
  const h = heightTexels(height);
  const out = new Float32Array(w * h);
  const step = 1 / RAIN_HEIGHT_TEXELS_PER_TILE;
  for (let j = 0; j < h; j++) {
    const z = (j + 0.5) * step;
    const row = j * w;
    for (let i = 0; i < w; i++) out[row + i] = sampler((i + 0.5) * step, z);
  }
  return out;
}

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/**
 * `v` as an IEEE half float (the R16F texel), ROUNDED TO NEAREST (ties to even).
 * three's own `DataUtils.toHalfFloat` truncates, which doubles the worst error:
 * 0.00098 against 0.00049 on ground heights in [1,2) and 0.002 against 0.001 in
 * [2,4), where the drawn ground tops out (9 levels, about 2.3 wu). Finite
 * values only; anything past half range saturates to infinity's bits.
 */
export function toHalfFloat(v: number): number {
  F32[0] = v;
  const x = U32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp32 = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp32 === 0xff) return sign | 0x7c00 | (mant !== 0 ? 0x200 : 0);
  const exp = exp32 - 127 + 15;
  if (exp >= 31) return sign | 0x7c00;
  if (exp <= 0) {
    // A subnormal half (or zero): the implicit leading 1 shifts into the mantissa.
    if (exp < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - exp;
    let h = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && (h & 1) === 1)) h++;
    return sign | h;
  }
  let h = (exp << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  // A carry out of the mantissa rolls into the exponent, which is exactly right.
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1) === 1)) h++;
  return sign | h;
}

/** A rain colour as the batch draws it: the palette colour in LINEAR times the
 *  `hazeRadiance` of the lights, so it sits at lit ground's scene-referred level. */
export function rainColour(linear: readonly [number, number, number], radiance: number): [number, number, number] {
  return [linear[0] * radiance, linear[1] * radiance, linear[2] * radiance];
}

/** Whether a rain colour stays under the bloom bar (`RAIN_COLOUR_CEILING`, 0.9). */
export function colourClearsBloom(rgb: readonly [number, number, number]): boolean {
  return Math.max(rgb[0], rgb[1], rgb[2]) < RAIN_COLOUR_CEILING;
}
