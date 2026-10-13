/**
 * N1b task 13 (R-N14): four things a versus seat could still read through
 * fog after N1a -- a hostile building's integrity bar, the pop of hostile
 * smoke being laid, a structure or tunnel collapsing, and an indirect round's
 * arc pointing back at a shooter the seat cannot see.
 *
 * Pure, and free of `Sim`, `THREE` and `ThreeRenderer`, like `fire-visible.ts`:
 * the renderer resolves "is it ours" and "is it in sight" and asks here.
 * Every predicate takes the BOOLEAN answers, never a side, so nothing here
 * can compare against a literal side (the render side-literal guard).
 *
 * Single-player (versus false) answers true everywhere -- and the arc is
 * never hidden -- so nothing here may change a campaign frame: there is no
 * second seat for any of it to leak to, and the one player has always seen
 * these through fog.
 */

/** The integrity bar over a damaged building: drawn for the seat's own
 *  building, or one in sight. Single-player (versus false) answers true
 *  everywhere: nothing here may change a campaign frame. */
export function structureBarVisible(versus: boolean, ownBuilding: boolean, inSight: boolean): boolean {
  return !versus || ownBuilding || inSight;
}

/** A one-shot effect at a place (the smoke launcher's pop, a collapse's
 *  fireball and shroud; since the N1b follow-up also a shot's muzzle flash,
 *  light, backblast and the direct-fire round that leaves the muzzle, asked
 *  with the SHOOTER's fog): drawn when it is the seat's own, or in sight.
 *  Single-player (versus false) answers true everywhere. */
export function hostileEffectVisible(versus: boolean, own: boolean, inSight: boolean): boolean {
  return !versus || own || inSight;
}

/** The flight fraction at which an arcing round's apex sits: `shellPointAt`'s
 *  parabola `4u(1-u)` peaks at exactly u = 0.5. */
export const ARC_APEX_FRACTION = 0.5;

/** The flight fraction before which a hostile arc stays hidden: 0 when the
 *  shooter is seen (or is the seat's own, or there is no room), else the apex
 *  (0.5), so the round appears at the top of its arc and falls -- the half
 *  that would point back at the hidden tube is never drawn. */
export function arcHiddenUntil(versus: boolean, own: boolean, shooterSeen: boolean): number {
  return !versus || own || shooterSeen ? 0 : ARC_APEX_FRACTION;
}
