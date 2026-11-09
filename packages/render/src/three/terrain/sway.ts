/**
 * Crown sway (ground plan 2, Task 7; N-16, N-17): the LEGACY maths of how far
 * a foliage vertex leans. GH-984 N1 moved the constants and the GLSL to
 * `wind.ts`; what is left here is what reduced motion plays -- today's sway,
 * the periodic 11 s gust on one fixed axis -- as a pure oracle for the legacy
 * branch of `windVertexChunk`, plus the weight and gust the rain maths and the
 * tests still read.
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

import {
  RAIN_SWAY_AMP,
  RAIN_SWAY_GUST,
  SWAY_AMPLITUDE,
  SWAY_DIR_X,
  SWAY_DIR_Z,
  SWAY_GUST_EVERY_S,
  SWAY_GUST_GAIN,
  SWAY_GUST_WIDTH_S,
  SWAY_PERIOD_S,
  SWAY_PHASE_X,
  SWAY_PHASE_Z,
  SWAY_TOP,
} from './wind';

// The constants live in `wind.ts` (GH-984 N1) and are re-exported here, so every importer is unchanged.
export {
  RAIN_SWAY_AMP,
  RAIN_SWAY_GUST,
  SWAY_AMPLITUDE,
  SWAY_DIR_X,
  SWAY_DIR_Z,
  SWAY_GUST_EVERY_S,
  SWAY_GUST_GAIN,
  SWAY_GUST_WIDTH_S,
  SWAY_PERIOD_S,
  SWAY_PHASE_X,
  SWAY_PHASE_Z,
  SWAY_TOP,
};

/** `(h / TOP)^2`, clamped to [0, 1]. */
export function swayWeight(heightWu: number): number {
  const r = Math.min(1, Math.max(0, heightWu / SWAY_TOP));
  return r * r;
}

/** 1 outside a gust; a `sin^2` bump to `GUST_GAIN` inside one. A gust starts
 *  at every multiple of `GUST_EVERY_S` and lasts `GUST_WIDTH_S`. */
export function gustFactor(tSec: number, wet = false): number {
  const phase = ((tSec % SWAY_GUST_EVERY_S) + SWAY_GUST_EVERY_S) % SWAY_GUST_EVERY_S;
  if (phase >= SWAY_GUST_WIDTH_S) return 1;
  const s = Math.sin((Math.PI * phase) / SWAY_GUST_WIDTH_S);
  return 1 + ((wet ? RAIN_SWAY_GUST : SWAY_GUST_GAIN) - 1) * s * s;
}

/** The world-space lean of a vertex `heightWu` above an instance whose origin
 *  is at `(originX, originZ)`, at sim time `tSec`. The shader's own maths at
 *  `uSwayAmp = 1`. */
export function swayOffset(
  heightWu: number,
  tSec: number,
  originX: number,
  originZ: number,
  wet = false
): { dx: number; dz: number } {
  const s =
    SWAY_AMPLITUDE *
    (wet ? RAIN_SWAY_AMP : 1) *
    swayWeight(heightWu) *
    gustFactor(tSec, wet) *
    Math.sin((2 * Math.PI * tSec) / SWAY_PERIOD_S + SWAY_PHASE_X * originX + SWAY_PHASE_Z * originZ);
  return { dx: SWAY_DIR_X * s, dz: SWAY_DIR_Z * s };
}
