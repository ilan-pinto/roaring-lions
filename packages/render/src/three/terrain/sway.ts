/**
 * Crown sway (ground plan 2, Task 7; N-16, N-17): the maths of how far a
 * foliage vertex leans, and the GLSL that does it on the GPU.
 *
 * Pure and three-free, so it is barrel-exported and tested under node. The
 * shader in `swayVertexChunk()` is NOT a transcription of `swayOffset`: every
 * number in it is interpolated from the constants below, and `sway.test.ts`
 * pins that the source contains them. A constant changed here changes the
 * GPU in the same edit, or the test goes red.
 *
 * THE CLOCK IS SIM TIME. `tSec` is `presentationSimMs(sim.tickCount, alpha) /
 * 1000` (`../decal-maths.ts`), the clock the decals already age on -- read,
 * never written, so invariant 4 holds, and interpolated by `alpha`, so the
 * crowns move smoothly at 60 fps while the sim ticks at 20. It is never an
 * accumulated `dtMs`: a gate capture at a pinned tick must repeat, and the
 * gate's zero-time repaint (`frame(1, 0)`) must move nothing. The retired
 * grove wind (`windClockMs`) was wall-clock and failed both.
 *
 * THE SHAPE. A vertex leans by `AMPLITUDE x weight(h) x gust(t) x sin(...)`
 * along one fixed axis:
 * - weight: `(h / TOP)^2`, clamped to [0, 1], where `h` is the vertex's height
 *   above its own instance origin in world units. Squared so a trunk base and
 *   a grass blade stay put (0.12 wu of grass moves under a thousandth of a
 *   world unit) and a crown top moves the full amplitude.
 * - gust: 1 almost always; once every `GUST_EVERY_S` a `sin^2` bump of width
 *   `GUST_WIDTH_S` lifts it to `GUST_GAIN` at its middle.
 * - the sine: period `PERIOD_S`, phase offset by the instance origin's x and
 *   z, so the wind travels across a grove instead of every tree nodding in
 *   lockstep.
 * - the axis: `(SQRT1_2, 0, -SQRT1_2)` in world x/z, the screen-horizontal
 *   axis of this fixed camera -- the same `(+x, -z)` the retired grove wind
 *   and `screenOffsetToWorld(dx, 0)` use -- so a crown leans sideways on
 *   screen rather than toward or away from the viewer, where the lean would
 *   read as nothing.
 */

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

/** `(h / TOP)^2`, clamped to [0, 1]. */
export function swayWeight(heightWu: number): number {
  const r = Math.min(1, Math.max(0, heightWu / SWAY_TOP));
  return r * r;
}

/** 1 outside a gust; a `sin^2` bump to `GUST_GAIN` inside one. A gust starts
 *  at every multiple of `GUST_EVERY_S` and lasts `GUST_WIDTH_S`. */
export function gustFactor(tSec: number): number {
  const phase = ((tSec % SWAY_GUST_EVERY_S) + SWAY_GUST_EVERY_S) % SWAY_GUST_EVERY_S;
  if (phase >= SWAY_GUST_WIDTH_S) return 1;
  const s = Math.sin((Math.PI * phase) / SWAY_GUST_WIDTH_S);
  return 1 + (SWAY_GUST_GAIN - 1) * s * s;
}

/** The world-space lean of a vertex `heightWu` above an instance whose origin
 *  is at `(originX, originZ)`, at sim time `tSec`. The shader's own maths at
 *  `uSwayAmp = 1`. */
export function swayOffset(
  heightWu: number,
  tSec: number,
  originX: number,
  originZ: number
): { dx: number; dz: number } {
  const s =
    SWAY_AMPLITUDE *
    swayWeight(heightWu) *
    gustFactor(tSec) *
    Math.sin((2 * Math.PI * tSec) / SWAY_PERIOD_S + SWAY_PHASE_X * originX + SWAY_PHASE_Z * originZ);
  return { dx: SWAY_DIR_X * s, dz: SWAY_DIR_Z * s };
}

/** A GLSL float literal carrying enough digits that `toFixed(4)` of the same
 *  constant is a prefix of it. */
function glsl(k: number): string {
  return k.toFixed(8);
}

/**
 * The GLSL spliced after `#include <project_vertex>`, constants interpolated.
 *
 * AFTER `project_vertex`, not in `begin_vertex`, because the lean needs the
 * instance's WORLD origin and the vertex's WORLD height -- scale and yaw come
 * from the batch's per-instance matrix, so a big olive and a small one weigh
 * their own heights -- and `batchingMatrix` is what carries that. It is in
 * scope here: `batching_vertex` declares it before `project_vertex` in r170's
 * `meshphysical` vertex shader. The lean is added to `mvPosition` in VIEW
 * space (`viewMatrix * vec4(dir, 0)`), then `gl_Position` is rewritten.
 *
 * `vViewPosition` (what the lights read) is assigned from `mvPosition` AFTER
 * `#include <project_vertex>` in r170's
 * `ShaderLib/meshphysical.glsl.js` (line 44 includes it, line 48 assigns
 * `vViewPosition = - mvPosition.xyz`), so a moved vertex is lit where it is
 * drawn. The shadow and AO passes draw with their own materials, which carry
 * none of this, so a crown's shadow keeps the rest pose -- spec §3.5 accepts
 * that (at most 2.2 px).
 *
 * `uSwayAmp` is 1 in shipping code; the `wind` debug layer sets it to 0.
 */
export function swayVertexChunk(): string {
  return `
{
#ifdef USE_BATCHING
  mat4 rlSwayModel = modelMatrix * batchingMatrix;
#else
  mat4 rlSwayModel = modelMatrix;
#endif
  vec3 rlSwayOrigin = rlSwayModel[3].xyz;
  float rlSwayH = (rlSwayModel * vec4(transformed, 1.0)).y - rlSwayOrigin.y;
  float rlSwayR = clamp(rlSwayH / ${glsl(SWAY_TOP)}, 0.0, 1.0);
  float rlSwayPh = mod(uSwayTime, ${glsl(SWAY_GUST_EVERY_S)});
  float rlSwayBump = 0.0;
  if (rlSwayPh < ${glsl(SWAY_GUST_WIDTH_S)}) {
    float rlSwayB = sin(PI * rlSwayPh / ${glsl(SWAY_GUST_WIDTH_S)});
    rlSwayBump = rlSwayB * rlSwayB;
  }
  float rlSwayGust = 1.0 + (${glsl(SWAY_GUST_GAIN)} - 1.0) * rlSwayBump;
  float rlSway = uSwayAmp * ${glsl(SWAY_AMPLITUDE)} * rlSwayR * rlSwayR * rlSwayGust
    * sin(PI2 * uSwayTime / ${glsl(SWAY_PERIOD_S)}
      + ${glsl(SWAY_PHASE_X)} * rlSwayOrigin.x + ${glsl(SWAY_PHASE_Z)} * rlSwayOrigin.z);
  mvPosition += viewMatrix * vec4(${glsl(SWAY_DIR_X)} * rlSway, 0.0, ${glsl(SWAY_DIR_Z)} * rlSway, 0.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;
}
