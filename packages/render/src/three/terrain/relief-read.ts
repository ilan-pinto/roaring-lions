/**
 * Relief read: making height legible from the game camera. Two
 * presentation-only terms on the drawn ground, nothing the sim reads.
 *
 * Why (the Lane B mock, `_coord/relief-read`, 2026-10-15): open ground is
 * Catmull-Rom smooth, so a 3-4 level bluff spread over 3-4 tiles turns its
 * normal by only a few degrees and the sun barely tells its faces apart.
 * Relief read almost entirely through the terraced `^` walls; Wadi Tarfan's
 * bluffs and Milh Flats' tells looked flat at zoom 1. Of four options mocked,
 * these two read and were chosen by the coordinator under the lead's
 * delegation; a GTAO valley boost had no visible effect, and a crown summit
 * is held for an art pass.
 *
 * **A. Slope light** (`slope-light` debug layer). For LIGHTING only, the
 * ground's world normal is tilted further from vertical: its tilt angle
 * becomes `atan(gain * tan(tilt))`, so a gentle slope takes the light and
 * shade a steeper one would. Two limits keep it from going blotchy (the mock's
 * x3 did, on Wadi Tarfan, where the bicubic surface wobbles at tile scale):
 * the gain itself (2), and a CEILING on the exaggerated tilt
 * (`RELIEF_SLOPE_MAX_TILT_DEG`), so a shade face never falls all the way to
 * sky light alone. A slope already steeper than the ceiling keeps its own
 * tilt -- the term only ever steepens. Flat ground (no horizontal part) and
 * walls (no vertical part) are untouched, which is why a flat map's pixels do
 * not move. Shadows still come from the real geometry.
 *
 * **B. Height contours and tint** (`height-contours` debug layer). On ground
 * tops only (never on a wall face):
 *  - a thin darkening where the surface crosses a HALF level. Flat ground
 *    stands on whole levels and never meets one, so a flat map draws none;
 *  - a tint by height RELATIVE TO THE MAP'S OWN MEDIAN open-ground level
 *    (the same median the haze's low-lying term reads, `hazeReferenceLevel`):
 *    lower is cooler and darker, higher warmer and lighter, and the median
 *    itself is exactly 1. So a flat map, which is all median, is unchanged.
 *
 * Everything here is three-free and pure; the GLSL below is generated from
 * the same constants, and `relief-read.test.ts` pins the maths.
 */

/** The slope light's horizontal-normal gain. The mock read x3 as blotchy and x2 as clean. */
export const RELIEF_SLOPE_GAIN = 2;
/** The ceiling on the EXAGGERATED tilt, degrees. A shade face past it would read as a hole. */
export const RELIEF_SLOPE_MAX_TILT_DEG = 38;
/** How much a contour darkens at its centre (0..1). */
export const RELIEF_CONTOUR_STRENGTH = 0.18;
/** A contour's half-width, screen pixels (via `fwidth`, so it stays a line at every zoom). */
export const RELIEF_CONTOUR_WIDTH_PX = 1.4;
/** Levels above or below the median at which the tint is at full strength. */
export const RELIEF_TINT_SPAN_LEVELS = 4;
/** Linear multipliers at full strength below / above the median. */
export const RELIEF_TINT_LOW: readonly [number, number, number] = [0.88, 0.9, 0.94];
export const RELIEF_TINT_HIGH: readonly [number, number, number] = [1.07, 1.05, 1.02];

export type Vec3 = readonly [number, number, number];

/**
 * The lighting normal for a ground normal `n` (world space, unit length):
 * tilt -> max(tilt, min(atan(gain * tan(tilt)), maxTilt)), azimuth kept.
 * `n.y <= 0` (a wall, or a back face) and `n` with no horizontal part come
 * back unchanged.
 */
export function exaggerateNormal(
  n: Vec3,
  gain: number = RELIEF_SLOPE_GAIN,
  maxTiltDeg: number = RELIEF_SLOPE_MAX_TILT_DEG
): [number, number, number] {
  const [x, y, z] = n;
  const h = Math.hypot(x, z);
  if (y <= 0 || h < 1e-6) return [x, y, z];
  const tilt = Math.atan2(h, y);
  const target = Math.max(tilt, Math.min(Math.atan2(gain * h, y), (maxTiltDeg * Math.PI) / 180));
  const s = Math.sin(target) / h;
  return [x * s, Math.cos(target), z * s];
}

/**
 * The contour factor (multiplied into the albedo) for a surface at
 * `heightLevels` (world Y / WORLD_PER_LEVEL) whose screen-space rate of change
 * is `fwidthLevels` levels per pixel: 1 - strength at a half level, 1 more than
 * `widthPx` pixels away from one.
 */
export function contourFactor(
  heightLevels: number,
  fwidthLevels: number,
  strength: number = RELIEF_CONTOUR_STRENGTH,
  widthPx: number = RELIEF_CONTOUR_WIDTH_PX
): number {
  const d = Math.abs(heightLevels - Math.floor(heightLevels) - 0.5);
  const px = d / Math.max(fwidthLevels, 1e-4);
  return 1 - strength * (1 - smoothstep(0, widthPx, px));
}

/** The tint multiplier at `heightLevels` on a map whose median open level is `medianLevel`; `amp` 0 is off. */
export function reliefTint(heightLevels: number, medianLevel: number, amp = 1): [number, number, number] {
  const t = Math.max(-1, Math.min(1, (heightLevels - medianLevel) / RELIEF_TINT_SPAN_LEVELS));
  const end = t < 0 ? RELIEF_TINT_LOW : RELIEF_TINT_HIGH;
  const k = Math.abs(t) * amp;
  return [1 + (end[0] - 1) * k, 1 + (end[1] - 1) * k, 1 + (end[2] - 1) * k];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const f = (v: number): string => v.toFixed(5);
const v3 = (v: Vec3): string => `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;

/** The fragment uniforms and helpers, generated from the constants above. */
export const RELIEF_FRAGMENT_GLSL = /* glsl */ `
uniform float uReliefSlopeGain;
uniform float uReliefContour;
uniform float uReliefTint;
uniform float uReliefMedianY;
uniform float uReliefLevelY;
varying float vRlWorldY;
varying vec3 vRlWorldN;
vec3 rlExaggerate(vec3 n, float gain) {
  float h = length(n.xz);
  if (n.y <= 0.0 || h < 1e-6) return n;
  float tilt = atan(h, n.y);
  float target = max(tilt, min(atan(gain * h, n.y), ${f((RELIEF_SLOPE_MAX_TILT_DEG * Math.PI) / 180)}));
  return vec3(n.x * sin(target) / h, cos(target), n.z * sin(target) / h);
}
`;

/** Replaces the lighting normal (after three's `normal_fragment_maps`). */
export const RELIEF_NORMAL_GLSL = /* glsl */ `
{ vec3 rlN = normalize(vRlWorldN);
  if (!gl_FrontFacing) rlN = -rlN;
  rlN = rlExaggerate(rlN, uReliefSlopeGain);
  normal = normalize((viewMatrix * vec4(rlN, 0.0)).xyz); }
`;

/** Multiplies the albedo on ground TOPS (`rlTop`, set by the blend above it). */
export const RELIEF_ALBEDO_GLSL = /* glsl */ `
{ float rlH = vRlWorldY / uReliefLevelY;
  float rlMed = uReliefMedianY / uReliefLevelY;
  float rlD = abs(fract(rlH) - 0.5) / max(fwidth(rlH), 1e-4);
  float rlLine = 1.0 - ${f(RELIEF_CONTOUR_STRENGTH)} * uReliefContour * (1.0 - smoothstep(0.0, ${f(RELIEF_CONTOUR_WIDTH_PX)}, rlD));
  float rlT = clamp((rlH - rlMed) / ${f(RELIEF_TINT_SPAN_LEVELS)}, -1.0, 1.0);
  vec3 rlEnd = rlT < 0.0 ? ${v3(RELIEF_TINT_LOW)} : ${v3(RELIEF_TINT_HIGH)};
  vec3 rlTint = mix(vec3(1.0), rlEnd, abs(rlT) * uReliefTint);
  diffuseColor.rgb *= mix(vec3(1.0), rlTint * rlLine, rlTop); }
`;
