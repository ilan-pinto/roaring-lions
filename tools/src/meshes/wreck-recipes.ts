/**
 * Per-vehicle wreck recipes: what kind of hull a vehicle has, and which of its
 * nodes are the turret, the rotor and the wing.
 *
 * Authored in code the way `tools/units/rig.py`'s bone tables are, and for the
 * same reason -- a table a human reads beside the geometry it describes, rather
 * than a JSON file nothing else validates. `wreck-pass.ts` consumes it.
 *
 * The design (`docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md` §4.1)
 * is that a recipe carries FRACTIONS of a vehicle's own measured bounds, never
 * absolute distances, so one kind serves eleven models of wildly different
 * size -- the 3.4 MiB paramotor and the 14.5 KiB Shachaf take the same numbers.
 *
 * The node names come from the census of the eleven shipped GLBs. Every
 * vehicle's live top-level nodes are `hull_*` role meshes plus at most one
 * pivot empty, except `heli_peten`, whose `rotor_pivot` sits one level down
 * under a `rotor_tilt` empty -- which is why the pass classifies a part by
 * walking its ANCESTORS for the named pivot rather than checking its parent.
 */

/** How a vehicle's body comes to rest. `air` lies on its side. */
export type HullKind = 'wheeled' | 'tracked' | 'air';

export interface WreckRecipe {
  hull: HullKind;
  /** Node name of the turret pivot whose subtree is thrown, if any. */
  turretPivot?: string;
  /** Node name of the rotor pivot whose subtree is bent, if any. */
  rotorPivot?: string;
  /** Node name of the canopy (the paramotor's `hull_hull`), collapsed beside the frame. */
  canopy?: string;
}

/**
 * The eleven shipped vehicles.
 *
 * The spec's fifth kind, `masted`, has **no taker here**: `rocket_battery`'s
 * Grad launcher is fused into its `hull_*` meshes rather than sitting under a
 * pivot, so there is no subtree to fold flat. It takes the plain wheeled hull.
 * If a later re-export segments the launcher, add `mastPivot` here and a branch
 * in the pass; until then a kind with no member would be untested code.
 */
export const WRECK_RECIPES: Readonly<Record<string, WreckRecipe>> = {
  apc_eitan: { hull: 'wheeled', turretPivot: 'turret_pivot' },
  apc_kipod: { hull: 'wheeled' },
  dozer_d9: { hull: 'tracked' },
  heli_peten: { hull: 'air', rotorPivot: 'rotor_pivot' },
  ifv_namer: { hull: 'tracked', turretPivot: 'turret_pivot' },
  jeep_shoded: { hull: 'wheeled' },
  mbt_lavi: { hull: 'tracked', turretPivot: 'turret_pivot' },
  paramotor: { hull: 'air', canopy: 'hull_hull' },
  rocket_battery: { hull: 'wheeled' },
  scout_shachaf: { hull: 'wheeled' },
  technical: { hull: 'wheeled', turretPivot: 'turret_pivot' },
};

/**
 * Displacements, as fractions of the vehicle's own bounds (`_DROP`, `_SHIFT`)
 * or as absolute degrees (`_DEG`).
 *
 * **TUNED 2026-09-15 against the eleven-pair screenshot sheet** the spec's
 * §4.5 asks for -- `tools/src/perf/wreck-captures.ts`, every vehicle
 * photographed alive and wrecked at zoom 1.6 and 2.2 in the real renderer with
 * the real charring on it. The first set was reasoned rather than measured and
 * the spec said so; what follows each constant is what the picture actually
 * showed. Three findings ran through all of them and are worth reading before
 * changing a number:
 *
 *  1. **These vehicles have almost no ground clearance.** Measured, the gap
 *     under the body is 0.000-0.363 world units (`HullMetrics.clearance`)
 *     against bodies 1.3-3.6 tall, so a settle expressed as a fraction of the
 *     HEIGHT was 1.5-10x larger than the room available and buried every one
 *     of the eleven. The settle is a fraction of the clearance now, and it is
 *     a small effect by construction.
 *  2. **The read comes from the TILT and the THROWN TURRET, not the settle.**
 *     At gameplay zoom a 0.2-unit drop is about six screen pixels.
 *  3. **The lit renderer's charring is doing most of the work and none of
 *     these numbers control it.** Seven of the eleven photograph as a
 *     near-black mass in which no internal form survives; that is
 *     `CHARRED_TINT_HEX`'s business, not the recipe's, and it is the open
 *     question on the sheet.
 */
export const WRECK_FRACTIONS = {
  /**
   * Fraction of the vehicle's own CLEARANCE the body settles by -- the gap
   * between the lowest body part and the lowest point of the whole vehicle,
   * which is what the wheels and tracks are standing on.
   *
   * 1.0: the body comes all the way down onto the axle line. Tuned to the
   * ceiling because the measured clearances (0.000-0.363, half of them under
   * 0.15) make anything less invisible at 1.6 and 2.2, and because at 1.0 it
   * still cannot reach the ground -- which is the property that replaced
   * "0.15 of the height", under which all eleven wrecks stood 0.20-0.69 world
   * units BELOW the ground plane.
   */
  HULL_DROP: 1.0,
  /**
   * Nose-down pitch: about the TRANSVERSE axis, through the bounds centre.
   *
   * 4 -> 7. At 4 the hull photographed level and the wreck read as a vehicle
   * someone had painted black. Kept well under the roll so the body reads as
   * canted rather than nose-diving, and so `BODY_ROLL_DEG > HULL_PITCH_DEG`
   * stays true -- `wreck-pass.test.ts` asserts that, because it is what makes
   * the roll-axis test able to fail.
   */
  HULL_PITCH_DEG: 7,
  /**
   * Roll of a ground vehicle: about its LONGITUDINAL axis, through the bounds
   * centre.
   *
   * 6 -> 12. The one number that makes a turretless hull read as dead:
   * `apc_kipod`, `jeep_shoded` and `scout_shachaf` have nothing thrown off
   * them and nothing else in this table touches their silhouette. Not pushed
   * higher because a rigid roll necessarily raises the far side -- the wreck's
   * top stands `width * sin(roll)` higher than the live model's, 0.4-0.7 units
   * at 12 degrees, and past about 15 it starts reading as a vehicle parked on
   * a slope rather than a wrecked one.
   */
  HULL_ROLL_DEG: 12,
  /**
   * Fraction of the vehicle's length the turret is thrown -- ACROSS the hull,
   * at right angles to the axis it runs along (`acrossLongAxis`).
   *
   * 0.25 along -> 0.45 across, and the direction is the bigger half of the
   * change. Thrown ALONG the hull the turret lands beyond the nose and stays
   * inside the vehicle's own silhouette: photographed at 2.2 the Lavi read as
   * an intact tank with the gun sticking out. Thrown across at 0.45 it clears
   * the flank by about half a tile and reads as a separate object lying in
   * the sand, which is what the four turreted vehicles (`mbt_lavi`,
   * `ifv_namer`, `apc_eitan`, `technical`) now show.
   */
  TURRET_SHIFT: 0.45,
  /**
   * Roll of the thrown turret: about the hull's longitudinal axis, through the
   * pivot's origin.
   *
   * 12 -> 40. At 12 the turret landed square, which reads as "placed", not
   * "blown off". It cannot go much further before the gun barrel points at
   * the sky.
   */
  TURRET_ROLL_DEG: 40,
  /**
   * Yaw of the thrown turret, about world +Y through the pivot's origin. Up
   * needs no axis choice.
   *
   * 20 -> 55. 20 degrees off the hull's own heading is inside the slop a
   * living turret takes while tracking, so it read as aiming rather than as
   * detached.
   */
  TURRET_YAW_DEG: 55,
  /**
   * Roll of an `air` hull, about its longitudinal axis.
   *
   * 25 -> 10, and this is the constant the sheet argued DOWN rather than up.
   * `heli_peten`'s rotor disc is 4.1 units across and rigid, so rolling the
   * fuselage tips the disc with it and the wreck's height goes as the disc's
   * half-span times the sine: at 25 the downed helicopter stood 2.6 units
   * tall against a live 1.29, which reads as a machine standing on its side
   * rather than one that has come down. At 10 it is 1.79, against a live
   * silhouette that already floats at 1.65 (`AIR_LIFT_PX` 14, 0.357 world
   * units) -- so on screen the wreck is no taller than the thing that was
   * flying. There is no setting that both bends the rotor visibly and keeps
   * the wreck low; the geometry is in `ROTOR_BEND_DEG` below.
   */
  BODY_ROLL_DEG: 10,
  /**
   * Pitch of the rotor subtree, about the transverse axis through the rotor
   * pivot: the blades bend.
   *
   * 30 -> 10, for exactly the reason above and measured the same way. The
   * rotor is ONE rigid mesh, so "bent" can only mean "tilted", and tilting a
   * disc about its centre raises one side by as much as it drops the other.
   * A drooping rotor needs geometry, not a recipe.
   */
  ROTOR_BEND_DEG: 10,
  /** Roll of the canopy about the hull's long axis: the wing tips onto its
   *  edge. 80, unchanged -- the collapsed wing was the one pose on the first
   *  sheet that read correctly, and the defect in it was the AABB-corner
   *  ground estimate (now exact vertices, `seatOnGround`), not the angle. */
  CANOPY_ROLL_DEG: 80,
  /** Fraction of the vehicle's length the collapsed canopy lies from the
   *  motor. 0.6, unchanged, and for the same reason: the wing photographed
   *  clear of the frame with the rigging stretched between them. */
  CANOPY_SHIFT: 0.6,
} as const;
