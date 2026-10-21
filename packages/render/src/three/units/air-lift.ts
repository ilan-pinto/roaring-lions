/**
 * GH-698: how much of its flying height an AIR CARRIER (the Yanshuf) is drawn
 * at, as a fraction of `AIR_LIFT_PX`. The sim lands a carrier to load and to
 * unload: AIRBORNE -> LANDING (`AIR_LAND_TICKS`, the timer counting down) ->
 * LANDED -> LIFTING (`AIR_LIFT_TICKS`) -> AIRBORNE. The body follows: 1 in the
 * air, easing to 0 over the landing, 0 on the ground, easing back to 1 over the
 * lift. Presentation only -- a read of `airState`/`airTimer`, nothing written
 * back (invariant 4).
 *
 * `alpha` is the frame's interpolation between the previous tick and the
 * current one, as everywhere else in the renderer: the timer stood one higher
 * a tick ago, so the descent moves every frame rather than every tick. An
 * unknown state reads as airborne (1), the spawn default; the renderer asks
 * only for air carriers, so a gunship or a drone never comes here and keeps
 * its height bit-for-bit.
 *
 * No three.js, no DOM: testable under `environment: 'node'`.
 */
import { AIR_LAND_TICKS, AIR_LANDED, AIR_LANDING, AIR_LIFT_TICKS, AIR_LIFTING } from '@lions/sim';

const smooth = (u: number): number => u * u * (3 - 2 * u);
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);

export function airLiftFrac(airState: number, airTimer: number, alpha = 1): number {
  if (airState === AIR_LANDED) return 0;
  if (airState === AIR_LANDING) return smooth(clamp01((airTimer + 1 - alpha) / AIR_LAND_TICKS));
  if (airState === AIR_LIFTING) return 1 - smooth(clamp01((airTimer + 1 - alpha) / AIR_LIFT_TICKS));
  return 1;
}
