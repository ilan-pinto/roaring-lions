/**
 * What "the lost tyre" is, for the wheel-off corner drop -- one definition,
 * read by BOTH the wreck pass (whose ground seat must ignore it) and the
 * damage pass (whose `dropTyre` cuts it), so the two cannot disagree about
 * which vertices are gone.
 *
 * It is a VOLUME about the axle, not the `_RL_WHEEL` tag alone, and that was
 * measured: #550 tags a face only when its centroid is inside 0.99 of the
 * declared radius (so fenders and arches stay static), which leaves the
 * outermost tread UNTAGGED on the jeep and the technical. Cutting by tag left
 * those tread bottoms standing, and they held the corner up -- the jeep's
 * dropped 0.05 m and the technical's 0.01 against the Eitan's 0.33.
 *
 * The volume: farther from the axle (side view) than the rim
 * (`WRECK_FRACTIONS.LOST_WHEEL_RIM_FRAC` of the radius), no farther than
 * `LOST_TYRE_OUTER_FRAC` of it, and across the hull inside the slab the
 * wheel's own tagged RUBBER vertices span, padded by `LOST_TYRE_SLAB_PAD`.
 */
import type { Primitive } from '@gltf-transform/core';
import { WRECK_FRACTIONS } from './wreck-recipes';

/** Past the declared radius, for the tread the tag missed; short of a fender flare. */
export const LOST_TYRE_OUTER_FRAC = 1.04;
/** Metres either side of the tagged rubber's own width. */
export const LOST_TYRE_SLAB_PAD = 0.02;

export interface GearWheelLike {
  readonly centre: readonly number[];
  readonly radius: number;
}

export interface LostTyre {
  readonly cx: number;
  readonly cy: number;
  readonly rim: number;
  readonly outer: number;
  readonly zMin: number;
  readonly zMax: number;
}

/** The volume for wheel `index` (0-based), its slab measured off the LIVE `hull_rubber` primitive. */
export function lostTyre(rubber: Primitive, wheel: GearWheelLike, index: number): LostTyre {
  const tag = rubber.getAttribute('_RL_WHEEL');
  const pos = rubber.getAttribute('POSITION');
  if (!tag || !pos) throw new Error('lostTyre: the rubber primitive carries no _RL_WHEEL (run running-gear:meshes first)');
  let zMin = Infinity;
  let zMax = -Infinity;
  const el = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    if (tag.getScalar(i) !== index + 1) continue;
    pos.getElement(i, el);
    zMin = Math.min(zMin, el[2]!);
    zMax = Math.max(zMax, el[2]!);
  }
  if (!Number.isFinite(zMin)) throw new Error(`lostTyre: no rubber vertex tagged for wheel ${index}`);
  return {
    cx: wheel.centre[0]!,
    cy: wheel.centre[1]!,
    rim: WRECK_FRACTIONS.LOST_WHEEL_RIM_FRAC * wheel.radius,
    outer: LOST_TYRE_OUTER_FRAC * wheel.radius,
    zMin: zMin - LOST_TYRE_SLAB_PAD,
    zMax: zMax + LOST_TYRE_SLAB_PAD,
  };
}

/** Is this point (the SOURCE mesh's own space) part of the lost tyre? */
export function inLostTyre(t: LostTyre, x: number, y: number, z: number): boolean {
  if (z < t.zMin || z > t.zMax) return false;
  const r = Math.hypot(x - t.cx, y - t.cy);
  return r > t.rim && r <= t.outer;
}
