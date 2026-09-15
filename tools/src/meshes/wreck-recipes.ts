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
 * **These are FIRST VALUES, reasoned rather than measured**, and the spec says
 * so in as many words: "the exact fractions are set by looking at the eleven
 * results at gameplay zoom, not reasoned in advance". Task 5 of the plan
 * captures the eleven-pair screenshot sheet, the lead judges it, and the tuned
 * numbers are recorded HERE, beside each constant, with the date. Nothing
 * downstream should read a number out of this table as though it were settled.
 */
export const WRECK_FRACTIONS = {
  /** Fraction of the vehicle's height the body settles by. Wheels and tracks stay. */
  HULL_DROP: 0.15,
  /** Nose-down pitch of the whole vehicle, about its bounds centre. */
  HULL_PITCH_DEG: 4,
  /** Roll of a ground vehicle, about its bounds centre. */
  HULL_ROLL_DEG: 6,
  /** Fraction of the vehicle's length the turret is thrown along its long axis. */
  TURRET_SHIFT: 0.25,
  /** Roll of the thrown turret, about the pivot's own origin. */
  TURRET_ROLL_DEG: 12,
  /** Yaw of the thrown turret, about the pivot's own origin. */
  TURRET_YAW_DEG: 20,
  /** Roll of an `air` hull: the fuselage lies on its side rather than tilting. */
  BODY_ROLL_DEG: 25,
  /** Pitch of the rotor subtree about the rotor pivot: the blades bend. */
  ROTOR_BEND_DEG: 30,
  /** Roll of the canopy about the hull's long axis: the wing tips onto its edge. */
  CANOPY_ROLL_DEG: 80,
  /** Fraction of the vehicle's length the collapsed canopy lies from the motor. */
  CANOPY_SHIFT: 0.6,
} as const;
