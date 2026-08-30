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
 * own reasoning (see that file's top comment): the DOMINANT body role
 * (`hull`, and `plate` alongside it -- kit.py's own "bolt-on armour...that
 * breaks it up" is still a large panel, not a detail) reaches all the way to
 * its own band's darkest step, exactly the way `mesh-role.ts`'s infantry
 * `uniform` takes the WHOLE `olive` ramp rather than a slice of it. Detail
 * roles (`metal`, `rubber`, `glass`, `recess` -- barrel, tyre, window, gap)
 * stay narrow, one or two steps, matching the width `mesh-role.ts` already
 * uses for infantry's own small parts (`boot`, `metal`, `weapon`, `charge`
 * all run one to three steps; `skin_shadow` runs exactly one).
 *
 * Every width below is EXPLICIT (`sliceFrom` no longer defaults one) and was
 * chosen by extending each role's already-`ROLE_PALETTE`-sourced starting
 * index to the *end* of its own band -- not a blanket bump. Before this, the
 * unstated `width=3` default silently fell short of a band's own end
 * whenever the band was longer than 3 steps past the start index: it never
 * mattered for `gunmetal` (4 steps) or `shadow` (3 steps), where a width-3
 * slice from any of this table's own start indices already reaches the
 * band's last entry, but it mattered a great deal for `olive` (4 steps,
 * short by exactly one step at index 0) and catastrophically for
 * `limestone` (9 steps, short by SIX steps at index 0) -- which is exactly
 * why `technical`, the one vehicle whose hull sources `limestone`, was the
 * visible failure: `sliceFrom('limestone', 0, 3)` covered only
 * `limestone.0`-`limestone.2`, the palest third of a nine-step ramp, and
 * never reached anywhere near `limestone.8`.
 *
 * Confirmed against the shipped sprites, not assumed: sampling
 * `TECH_HULL/idle_f00_000.png`'s own opaque pixels finds `limestone.0`
 * (`#F2E8D5`, 2353 px) AND `limestone.8` (`#5E4E3A`, 1928 px) both present
 * in real, comparable quantities -- the sprite's own hull genuinely spans
 * the ramp end to end, which the mesh's 3-step slice did not. This has NOT
 * had a further visual approval pass beyond "does it now span the range the
 * sprite does" (CLAUDE.md: "Approve art numbers before rendering") -- see
 * this task's report.
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
 *  reader cannot check against that source.
 *
 *  `width` is REQUIRED, not defaulted. A shared default is exactly what let
 *  every vehicle role silently fall short of its own band's darkest step --
 *  see this file's top comment. Every call site below states its own width,
 *  chosen to reach the end of the band it starts from for a body role, or to
 *  stay narrow for a detail role. */
function sliceFrom(band: string, index: number, width: number): readonly string[] {
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
  // `tools/render_eitan.py`'s `ROLE_PALETTE` base colours (`hull`/`plate`
  // olive.0, `metal` gunmetal.2, `rubber` shadow.0, `glass` gunmetal.3),
  // each extended to the END of its own band -- see this file's top comment.
  // `olive` has 4 steps, so `hull`/`plate` from index 0 reach all 4;
  // `gunmetal` (4 steps) and `shadow` (3 steps) already topped out under the
  // old width-3 default, so their widths are unchanged in effect, only now
  // explicit.
  apc_eitan: {
    hull: sliceFrom('olive', 0, 4),
    plate: sliceFrom('olive', 0, 4),
    metal: sliceFrom('gunmetal', 2, 2),
    rubber: sliceFrom('shadow', 0, 3),
    glass: sliceFrom('gunmetal', 3, 1),
  },
  // `tools/render_d9.py`'s `ROLE_PALETTE` base colours (`hull` olive.1,
  // `plate` olive.2, `metal` gunmetal.1, `rubber` shadow.0, `glass`
  // gunmetal.3, `recess` shadow.1), each extended to the end of its own band.
  dozer_d9: {
    hull: sliceFrom('olive', 1, 3),
    plate: sliceFrom('olive', 2, 2),
    metal: sliceFrom('gunmetal', 1, 3),
    rubber: sliceFrom('shadow', 0, 3),
    glass: sliceFrom('gunmetal', 3, 1),
    recess: sliceFrom('shadow', 1, 2),
  },
  // `tools/render_technical.py`'s `ROLE_PALETTE` base colours (`hull`
  // limestone.0, `plate` limestone.2, `metal` gunmetal.2, `rubber`
  // shadow.0, `glass` gunmetal.3, `recess` shadow.1), each extended to the
  // end of its own band -- even though `art/meshes/vehicles/technical.glb`
  // only actually uses the `hull` role today (both its parts are
  // `rl_role: "hull"`), the full table is kept so a future re-export that
  // splits it into plate/metal/rubber/glass parts, matching the sprite
  // rig's own shape, needs no new mapping.
  //
  // `hull` is the one that mattered: `limestone` runs 9 steps, and the old
  // width-3 slice from index 0 covered only limestone.0-limestone.2, the
  // palest third of the ramp -- read in game as a bleached-white truck with
  // almost no shading. Sampling the shipped `TECH_HULL/idle_f00_000.png`'s
  // own opaque pixels confirms the sprite itself spans the full ramp:
  // limestone.0 (`#F2E8D5`, 2353 px) and limestone.8 (`#5E4E3A`, 1928 px)
  // both present in comparable quantity. `hull: sliceFrom('limestone', 0, 9)`
  // now reaches limestone.8, the ramp's own darkest step.
  technical: {
    hull: sliceFrom('limestone', 0, 9),
    plate: sliceFrom('limestone', 2, 7),
    metal: sliceFrom('gunmetal', 2, 2),
    rubber: sliceFrom('shadow', 0, 3),
    glass: sliceFrom('gunmetal', 3, 1),
    recess: sliceFrom('shadow', 1, 2),
  },
  // No sprite-rig script of its own -- see this file's top comment for why
  // `hull` reuses Eitan's own KDF-olive base rather than inventing one. The
  // remaining five follow `render_eitan.py` for the same reason and by the
  // same judgement: both are native KDF armour, and it is the only real KDF
  // vehicle table in the tree. `plate` steps one deeper than the Eitan's
  // (which shares `olive.0` with its hull) so a tank's applique reads as
  // distinct from its hull rather than vanishing into it. Each width below
  // reaches the end of its own band, same as every other entry in this
  // table -- `olive` (4 steps) from index 0 or 1 reaches its own end either
  // way.
  //
  // Held as a COMPLETE table rather than only the roles the GLB uses today,
  // exactly as `technical` above is and for the same reason: the supplied
  // Meshy asset shipped with every part on `hull`, and splitting it into
  // tracks/barrel/optics is in progress. A partial table turns each new role
  // into a BOOT FAILURE (`rampForVehicleRole` throws by design), which is
  // correct behaviour but makes the art and renderer sides of one change
  // land in two packages that different agents own.
  mbt_lavi: {
    hull: sliceFrom('olive', 0, 4),
    plate: sliceFrom('olive', 1, 3),
    metal: sliceFrom('gunmetal', 2, 2),
    rubber: sliceFrom('shadow', 0, 3),
    glass: sliceFrom('gunmetal', 3, 1),
    recess: sliceFrom('shadow', 1, 2),
  },
  // No sprite-rig script of its own -- the CC BY 3.0 `ifv_dmm08.blend` sheets
  // this Meshy export replaces (`NAMER_HULL`/`NAMER_TURR`,
  // `tools/render_namer.py`) never declared a `ROLE_PALETTE` of their own
  // (that pipeline paints from the source model's own baked material, not a
  // per-role table), so there is nothing to copy verbatim. Same judgement
  // call as `mbt_lavi` above, for the same reason (native KDF armour, the
  // only real KDF vehicle table in the tree) and the same values --
  // `tools/vehicles/export_meshy_namer.py`'s own exported GLB uses only
  // `hull`, `rubber`, `metal` and `glass` today (no `hull`-role turret
  // geometry and no hull `plate` split was found -- see that script's own
  // docstring and this task's report), but the table is held complete for
  // the same "boot failure, not a load-time gap" reason `technical` and
  // `mbt_lavi` already are.
  ifv_namer: {
    hull: sliceFrom('olive', 0, 4),
    plate: sliceFrom('olive', 1, 3),
    metal: sliceFrom('gunmetal', 2, 2),
    rubber: sliceFrom('shadow', 0, 3),
    glass: sliceFrom('gunmetal', 3, 1),
    recess: sliceFrom('shadow', 1, 2),
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
