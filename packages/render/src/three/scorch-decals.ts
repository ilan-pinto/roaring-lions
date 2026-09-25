/**
 * The scorch mark a vehicle kill or a mortar/rocket impact leaves on the
 * ground is drawn by the shared decal pool now (`decal-pool.ts`, D5) -- its
 * `DecalPool` class generalises the ring-buffer/conforming-grid shape this
 * module's own retired mesh once drew, to every decal kind, and its fade
 * constants (`SCORCH_ALPHA`, `SCORCH_EDGE_INNER`) live there, not here. What
 * is left in this module is the one piece of maths the pool still calls out
 * to: the radius a scorch mark gets for a given impact power.
 *
 * ## Radius scales by the square root of power
 *
 * A scorch mark is an AREA, not a length: a 0.3-power round that left 30% of
 * the full-power RADIUS would leave 9% of the full-power area and read as
 * nothing at all. `scorchRadiusTiles` therefore scales
 * `SCORCH_RADIUS_TILES_AT_FULL_POWER` by `sqrt(power)`, not `power` --
 * sublinear, so a weak round still leaves a mark a player can see, and zero
 * at zero power so a stamp with no power leaves no mark at all.
 */

/** `scorchRadiusTiles(1)`'s result -- the mark a full-power detonation (a
 *  burning hull, not a weak mortar round) leaves. */
export const SCORCH_RADIUS_TILES_AT_FULL_POWER = 1.6;

/**
 * Radius in tiles for a stamp at the given `power` (0..1, the same scaling
 * term `blastLightSpec`/`blastShake` use). Sublinear -- see this file's top
 * comment, "Radius scales by the square root of power" -- and zero at zero
 * or negative power, so a powerless stamp leaves no mark rather than a
 * full-size one.
 */
export function scorchRadiusTiles(power: number): number {
  return power <= 0 ? 0 : SCORCH_RADIUS_TILES_AT_FULL_POWER * Math.sqrt(power);
}
