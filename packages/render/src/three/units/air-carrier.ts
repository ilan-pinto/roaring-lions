/**
 * GH-1007 P2: how an AIR CARRIER (the Yanshuf, the medevac helicopter: a type with `isAirCarrier`, read from the
 * sim's public type, never from an id list) is drawn differently from other aircraft. Presentation only: frame
 * clock in, drawing out, nothing written back (invariant 4).
 *
 *  - It flies at `AIR_CARRIER_LIFT_PX` (28), twice the 14 every other aircraft keeps, so its descent onto an LZ
 *    reads as a descent. Shadow fade, pick (`pickLiftPx`), box-select and the drawn hull all read the one
 *    per-unit number, `airFlyingLiftPx`, so a hull and its click target cannot disagree.
 *  - Landed (`airLiftFrac` 0) its hull rests on its four gear contacts on the slope: the terrain conform of a
 *    ground vehicle, blended in by weight `1 - airLiftFrac`, so it is level in the air and fully fitted on the
 *    ground. The conform footprint is the GEAR (wheelbase x track), not the hull's bounds, which include the
 *    rotor disc.
 *
 * No three.js, no DOM: testable under `environment: 'node'`.
 */
import { AIR_LIFT_PX } from './frame-state';
import { conformHull, type HullConform, type HullConformInput } from './vehicle-conform';
import type { HullCorners } from './vehicle-weight';
import { MESH_UNITS_PER_TILE } from './mesh-anim';

/** Flying height of an air carrier, lift pixels (lead ruling 5 Nov, D6). Other aircraft keep `AIR_LIFT_PX`. */
export const AIR_CARRIER_LIFT_PX = 28;

/** The flying height, lift pixels, of an aircraft of this kind. The one place the rule lives. */
export function airFlyingLiftPx(isAirCarrier: boolean): number {
  return isAirCarrier ? AIR_CARRIER_LIFT_PX : AIR_LIFT_PX;
}

/**
 * The carrier's four gear contacts, metres in the GLB's own frame (x forward, z across; y = 0 is the contact
 * plane). MEASURED from `art/meshes/vehicles/heli_yanshuf.glb` (vertices lowest within 0.01 m, clustered), and
 * pinned against that file by `air-carrier.test.ts`: main wheels x = -0.07, forward x = +0.93, track 1.25.
 * `heli_yanshuf` and `air_medevac_heli` share the airframe.
 */
export const CARRIER_GEAR_MAIN_X_M = -0.07;
export const CARRIER_GEAR_FORWARD_X_M = 0.93;
export const CARRIER_GEAR_HALF_TRACK_M = 0.625;

/** The gear footprint the conform samples, tiles: wheelbase along the hull, track across it. */
export const CARRIER_GEAR_LENGTH_TILES = (CARRIER_GEAR_FORWARD_X_M - CARRIER_GEAR_MAIN_X_M) / MESH_UNITS_PER_TILE;
export const CARRIER_GEAR_WIDTH_TILES = (2 * CARRIER_GEAR_HALF_TRACK_M) / MESH_UNITS_PER_TILE;

/** The weight the ground conform has on a carrier: 1 on the ground, 0 at full flying height. */
export const carrierConformWeight = (liftFrac: number): number => 1 - liftFrac;

/**
 * Pitch and roll of a carrier standing at `input`'s centre: the ground conform over the GEAR footprint
 * (`input.lengthTiles` / `widthTiles` are overwritten), scaled by `1 - liftFrac`. `out` is written and returned.
 */
export function carrierGearConform(
  input: HullConformInput,
  corners: HullCorners,
  out: HullConform,
  liftFrac: number
): HullConform {
  input.lengthTiles = CARRIER_GEAR_LENGTH_TILES;
  input.widthTiles = CARRIER_GEAR_WIDTH_TILES;
  conformHull(input, corners, out);
  const w = carrierConformWeight(liftFrac);
  out.pitchRad *= w;
  out.rollRad *= w;
  return out;
}
