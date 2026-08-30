/**
 * `rl_role` -> the RAMP SLICE a VEHICLE mesh's role shades through, for the
 * same toon material infantry roles shade through (`mesh-material.ts`'s
 * `toonRampSkinnedMaterial` for infantry; the RIGID, non-skinned counterpart
 * `../palette-material.ts`'s `toonRampMaterial` for a vehicle -- a vehicle
 * hull/turret is never skinned, so it needs no skinning vertex chunks, and
 * `mesh-vehicle.ts` builds its material through the latter, not the former).
 *
 * Deliberately NOT `mesh-role.ts`'s `MESH_ROLES`/`rampForRole`, per the mesh
 * unit contract v2 ("Roles are a closed set per ASSET CLASS, not one
 * universal ten"): vehicles carry `tools/vehicles/kit.py`'s own six-role
 * vocabulary -- `hull, plate, rubber, metal, glass, recess` -- of which only
 * `metal` overlaps infantry's ten, and infantry's table would reject every
 * other vehicle role as unmapped.
 *
 * And unlike infantry (one `MeshFaction` parameter, because ONE
 * `inf_squad.glb` is reused for both sides), a vehicle GLB is
 * faction-specific BY CONSTRUCTION -- `apc_eitan` is KDF-only, `technical` is
 * irregular-only -- so the ramp choice belongs to the unit TYPE, not an
 * instance parameter. `rampForVehicleRole` is keyed by `vehicleId` for
 * exactly this reason: there is no faction to pass, because the vehicle id
 * already says which side's paint job this is.
 *
 * ## Where these numbers come from, and what is NOT verified
 *
 * Every `ROLE_PALETTE` entry below is copied verbatim from the vehicle's own
 * sprite-rig script (`tools/render_eitan.py`, `render_d9.py`,
 * `render_technical.py`) -- the exact base colour that pipeline bakes for
 * that role, never invented. `mbt_lavi` has no such script of its own (it is
 * a supplied Meshy replacement, `tools/vehicles/export_meshy_tank.py`, which
 * writes zero materials and defines no `ROLE_PALETTE`): its `hull` entry
 * below reuses `render_eitan.py`'s own `olive.0`, on the reasoning that both
 * are native KDF armour and the only other real KDF vehicle table in the
 * tree agrees. That is a judgement call, not a sourced fact, and is flagged
 * as such in this task's own report.
 *
 * Turning ONE base colour into a multi-step SLICE follows `mesh-role.ts`'s
 * own reasoning (see that file's top comment) but the exact WIDTH of each
 * slice below is this task's own derivation, not read from anywhere: capped
 * at three steps (`sliceFrom`), matching the typical width `mesh-role.ts`
 * already uses for infantry's own non-uniform roles (`boot`, `metal`,
 * `weapon`, `wood`, `charge`, `keffiyeh` all run two or three steps). This
 * has NOT had a visual approval pass (CLAUDE.md: "Approve art numbers before
 * rendering") -- it is an engineering placeholder that reuses only
 * already-authored palette entries, never a computed or hand-picked hex, and
 * it is named as an open item in this task's report.
 */
import { readRamp } from './mesh-role';

/**
 * `tools/vehicles/kit.py`'s own closed role vocabulary -- see this file's
 * top comment for why this is a SEPARATE table from infantry's `MESH_ROLES`.
 */
export const VEHICLE_MESH_ROLES = ['hull', 'plate', 'rubber', 'metal', 'glass', 'recess'] as const;

export type VehicleMeshRole = (typeof VEHICLE_MESH_ROLES)[number];

export function isVehicleMeshRole(role: string): role is VehicleMeshRole {
  return (VEHICLE_MESH_ROLES as readonly string[]).includes(role);
}

/** `readRamp(band).slice(index, index + width)`, capped to the ramp's own
 *  length -- the one place this module turns a "band.index" base colour into
 *  a shading slice, so every entry in `VEHICLE_ROLE_PALETTE` below states its
 *  base colour exactly once, in the same "band.index" shorthand the sprite
 *  pipeline's own comments use, rather than a pre-sliced array a future
 *  reader cannot check against that source. */
function sliceFrom(band: string, index: number, width = 3): readonly string[] {
  const ramp = readRamp(band);
  return ramp.slice(index, Math.min(ramp.length, index + width));
}

/** One vehicle type's role -> ramp-slice table -- only the roles that
 *  vehicle's own sprite-rig script (or, for `mbt_lavi`, the closest real
 *  analogue) actually declares. A role missing here is a genuine "no
 *  answer" for `rampForVehicleRole`, not a gap to fall back from -- the
 *  contract's own rule applies here exactly like infantry's: a role outside
 *  a vehicle's own closed set must fail loudly, never draw a default colour. */
const VEHICLE_ROLE_PALETTE: Record<string, Partial<Record<VehicleMeshRole, readonly string[]>>> = {
  // `tools/render_eitan.py`'s `ROLE_PALETTE`, verbatim base colours.
  apc_eitan: {
    hull: sliceFrom('olive', 0),
    plate: sliceFrom('olive', 0),
    metal: sliceFrom('gunmetal', 2),
    rubber: sliceFrom('shadow', 0),
    glass: sliceFrom('gunmetal', 3),
  },
  // `tools/render_d9.py`'s `ROLE_PALETTE`, verbatim base colours.
  dozer_d9: {
    hull: sliceFrom('olive', 1),
    plate: sliceFrom('olive', 2),
    metal: sliceFrom('gunmetal', 1),
    rubber: sliceFrom('shadow', 0),
    glass: sliceFrom('gunmetal', 3),
    recess: sliceFrom('shadow', 1),
  },
  // `tools/render_technical.py`'s `ROLE_PALETTE`, verbatim base colours --
  // even though `art/meshes/vehicles/technical.glb` only actually uses the
  // `hull` role today (both its parts are `rl_role: "hull"`), the full table
  // is kept so a future re-export that splits it into plate/metal/rubber/
  // glass parts, matching the sprite rig's own shape, needs no new mapping.
  technical: {
    hull: sliceFrom('limestone', 0),
    plate: sliceFrom('limestone', 2),
    metal: sliceFrom('gunmetal', 2),
    rubber: sliceFrom('shadow', 0),
    glass: sliceFrom('gunmetal', 3),
    recess: sliceFrom('shadow', 1),
  },
  // No sprite-rig script of its own -- see this file's top comment for why
  // `hull` reuses Eitan's own KDF-olive base rather than inventing one. The
  // remaining five follow `render_eitan.py` for the same reason and by the
  // same judgement: both are native KDF armour, and it is the only real KDF
  // vehicle table in the tree. `plate` steps one deeper than the Eitan's
  // (which shares `olive.0` with its hull) so a tank's applique reads as
  // distinct from its hull rather than vanishing into it.
  //
  // Held as a COMPLETE table rather than only the roles the GLB uses today,
  // exactly as `technical` above is and for the same reason: the supplied
  // Meshy asset shipped with every part on `hull`, and splitting it into
  // tracks/barrel/optics is in progress. A partial table turns each new role
  // into a BOOT FAILURE (`rampForVehicleRole` throws by design), which is
  // correct behaviour but makes the art and renderer sides of one change
  // land in two packages that different agents own.
  mbt_lavi: {
    hull: sliceFrom('olive', 0),
    plate: sliceFrom('olive', 1),
    metal: sliceFrom('gunmetal', 2),
    rubber: sliceFrom('shadow', 0),
    glass: sliceFrom('gunmetal', 3),
    recess: sliceFrom('shadow', 1),
  },
};

/**
 * The ramp slice a vehicle's `rl_role` shades through -- throws loudly for
 * an unrecognised vehicle id (`rampForVehicleRole`'s caller has no template
 * to build without one) or a role that vehicle's own table does not declare,
 * matching the contract's "a role outside the set must be a loud failure on
 * both sides, never a default colour" for infantry, applied identically here.
 */
export function rampForVehicleRole(vehicleId: string, role: string): readonly string[] {
  if (!isVehicleMeshRole(role)) {
    throw new Error(`vehicle-mesh-role: unknown rl_role "${role}" -- not in the closed vehicle role vocabulary`);
  }
  const table = VEHICLE_ROLE_PALETTE[vehicleId];
  if (!table) {
    throw new Error(`vehicle-mesh-role: no ramp table for vehicle "${vehicleId}"`);
  }
  const slice = table[role];
  if (!slice) {
    throw new Error(`vehicle-mesh-role: vehicle "${vehicleId}" declares no ramp for rl_role "${role}"`);
  }
  return slice;
}
