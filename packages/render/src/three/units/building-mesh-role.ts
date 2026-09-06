/**
 * `rl_role` -> the RAMP SLICE a BUILDING mesh's role shades through, for the
 * same rigid, non-skinned toon material vehicles shade through
 * (`../palette-material.ts`'s `toonRampMaterial` -- a building is rigid
 * geometry, per the contract: "no armature, no skin, no clips, no pivot").
 *
 * A THIRD closed role vocabulary, distinct from both infantry's ten and
 * vehicles' six -- the mesh unit contract's v2 text never enumerates one for
 * buildings (it only pins the file-split and the anchor convention), so this
 * table is this task's own derivation from the one place a building's
 * per-role colour is actually authored: `tools/render_building.py`'s own
 * `ROLE_PALETTE` (baked, flat colours for a static Cycles render) and
 * `data/structures.json`'s own `color` field (the wall's colour, which is
 * NOT in `ROLE_PALETTE` -- see below). Read directly against every shipped
 * `art/meshes/buildings/*.glb`, the union of `rl_role` values actually used
 * across all seven types is exactly the eight below; a role outside this set
 * is therefore either a new building type this table has not been extended
 * for, or a genuine authoring mistake, and either way must fail loudly
 * rather than draw a default colour, per the contract's own rule for every
 * asset class.
 *
 * ## `wall` is not in `ROLE_PALETTE`, on purpose, and is not here either
 *
 * `render_building.py`'s own comment: "`wall` is deliberately absent above:
 * it is brick or flat stone per the spec" -- each building type's wall takes
 * its OWN colour, `BuildingSpec.colour_key`, which is read directly off
 * `data/structures.json`'s `color` field for that type (verified: hall
 * `limestone.1`, house `limestone.3`, shanty `dust.1`, warehouse
 * `gunmetal.1`, apartment/concrete `limestone.4`, wall `limestone.5` --
 * `colour_key=` literals in `tools/render_building.py` match
 * `data/structures.json`'s `color` field for all seven types, byte for
 * byte). `rampForBuildingRole` therefore takes `wallColorKey` as a REQUIRED
 * parameter for the `wall` role specifically, sourced by the caller from
 * `Sim.structureTypes[...].color` (already loaded sim data -- no dependency
 * on `@lions/data`, which this package must not import) -- mirroring the
 * exact "no faction parameter, the ramp choice belongs to the TYPE"
 * relationship `vehicle-mesh-role.ts` already documents, just keyed by
 * structure id instead of vehicle id.
 *
 * ## Slice widths: the identical judgement call `vehicle-mesh-role.ts` makes
 *
 * Every OTHER role's base colour below is `ROLE_PALETTE`'s own literal, and
 * turning it into a multi-step slice uses the same `sliceFrom` helper and
 * the same capped-at-three-steps default `vehicle-mesh-role.ts` uses, for
 * the identical reason: a defensible, non-invented derivation from an
 * already-authored colour, not a visually-approved one. Flagged in this
 * task's report exactly like the vehicle table is.
 */
import { readRamp } from './mesh-role';
import type { CourseSurface } from '../palette-material';

export const BUILDING_MESH_ROLES = [
  'wall',
  'roof',
  'trim',
  'dome',
  'wood',
  'glass',
  'metal',
  'rust',
] as const;

export type BuildingMeshRole = (typeof BUILDING_MESH_ROLES)[number];

export function isBuildingMeshRole(role: string): role is BuildingMeshRole {
  return (BUILDING_MESH_ROLES as readonly string[]).includes(role);
}

/** See `vehicle-mesh-role.ts`'s identical helper -- duplicated rather than
 *  imported so this module's own "band.index" literals stay self-contained
 *  and each one is checkable against `render_building.py`'s own source
 *  without also having to trust that a shared helper was not itself changed
 *  for vehicles' sake. */
function sliceFrom(band: string, index: number, width = 3): readonly string[] {
  const ramp = readRamp(band);
  return ramp.slice(index, Math.min(ramp.length, index + width));
}

/** `tools/render_building.py`'s own `ROLE_PALETTE`, verbatim base colours --
 *  every role EXCEPT `wall`, which has no single shared colour (see this
 *  file's top comment). Shared across every building type, matching
 *  `ROLE_PALETTE`'s own "one fixed colour per role shared by every
 *  building" contract. */
const BUILDING_ROLE_PALETTE: Record<Exclude<BuildingMeshRole, 'wall'>, readonly string[]> = {
  roof: sliceFrom('dust', 4),
  trim: sliceFrom('terracotta', 1),
  dome: sliceFrom('limestone', 1),
  // `dust`'s lightest three steps -- bare/raw timber, deliberately the
  // OPPOSITE end of the ramp from `roof` (dust[4:7], the darkest three:
  // weathered roofing). The two slices do not touch (dust[3], `#AC8248`,
  // is the buffer step between them), so timber and roofing can never
  // collide the way they did before, on any building. Checked against
  // every shipped type's wall colour (`data/structures.json`): dust
  // (shanty, `dust.1` = indices 1-3) is the only wall band this shares --
  // partial overlap there (index 1-2) is unavoidable in a 7-step ramp once
  // both roof and that wall have already claimed three steps each, and is
  // outside this task's scope (wall is untouched, per-type, and correct).
  // Every other type's wall is a different band entirely (limestone,
  // gunmetal, olive), so wood reads as distinct from wall everywhere else.
  wood: sliceFrom('dust', 0),
  glass: sliceFrom('shadow', 0),
  metal: sliceFrom('gunmetal', 2),
  rust: sliceFrom('terracotta', 0),
};

/**
 * What a building TYPE's `wall` role is made of, and therefore which
 * generated surface (if any) its wall material draws --
 * `palette-material.ts`'s `CourseSurface`, plus `'flat'` for a wall that is
 * not masonry at all.
 *
 * A ninth thing keyed by structure id, and the closed-set rule applies here
 * exactly as it does to the role vocabulary above: an id outside this table
 * throws rather than defaulting, so a new structure type is a loud failure
 * at load rather than a wall that is silently the wrong material.
 *
 * The split is the project lead's, not derived from `render_building.py`
 * (which only knows brick/not-brick), though `brick` matches its three
 * `brick=True` specs plus `wall`:
 *
 *  - `brick`  house, apartment, hall, wall -- masonry.
 *  - `panel`  concrete -- poured, so board-formed banding at a much larger
 *             scale and in a STACK bond, never courses.
 *             `render_building.py` leaves this one flat. It first shipped
 *             here "one tier quieter" than masonry and the lead's verdict
 *             on seeing it was that concrete did not read at gameplay zoom
 *             at all; it is now as loud as brick, and stays concrete rather
 *             than becoming big brick because of the bond, not the
 *             contrast. See `palette-material.ts`'s `COURSE_SPECS` for the
 *             measurement that settled which of the two candidate causes
 *             was real (it was not the geometry).
 *  - `flat`   shanty (corrugated sheet), warehouse (metal), camp (canvas
 *             over HESCO). None of the three is a laid material and coursing
 *             any of them would be a lie about what it is.
 */
export type WallSurface = CourseSurface | 'flat';

const WALL_SURFACE: Record<string, WallSurface> = {
  house: 'brick',
  apartment: 'brick',
  hall: 'brick',
  wall: 'brick',
  // Textured (photographed) like house/apartment -- see textured-building.ts.
  // `wallSurfaceForBuilding` is still called unconditionally by
  // `ThreeRenderer.loadBuildingMesh` before the textured branch is decided,
  // so this entry is required even though the coursing it names is never
  // actually drawn: every clinic/hall wall mesh keeps its own UV +
  // base_color map and takes the textured branch in
  // `buildBuildingMeshTemplate`, which is checked BEFORE
  // `isBuildingMeshRole`/coursing. 'brick' is the honest answer regardless
  // -- rendered masonry, per the Meshy prompt.
  clinic: 'brick',
  concrete: 'panel',
  shanty: 'flat',
  warehouse: 'flat',
  camp: 'flat',
};

/** The `WallSurface` for a `data/structures.json` type id. Throws for an
 *  unknown id -- see the table's own comment for why there is no default. */
export function wallSurfaceForBuilding(structureId: string): WallSurface {
  const surface = WALL_SURFACE[structureId];
  if (!surface) {
    throw new Error(
      `building-mesh-role: no wall surface for structure type "${structureId}" -- ` +
        `extend WALL_SURFACE (known: ${Object.keys(WALL_SURFACE).sort().join(', ')})`
    );
  }
  return surface;
}

/**
 * The ramp slice a building's `rl_role` shades through. `wallColorKey` is a
 * "band.index" string (`data/structures.json`'s own `color` field, e.g.
 * `"limestone.4"`) -- REQUIRED, not defaulted, mirroring
 * `vehicle-mesh-role.ts`'s `faction` parameter: a default would make "this
 * building's own wall colour" silently mean "whatever the caller forgot to
 * look up", exactly the failure mode that parameter exists to rule out.
 * Throws loudly for any role outside the closed set, or a malformed
 * `wallColorKey` (no `.`, or a band `readRamp` does not recognise) --
 * never a default colour, per the contract's rule for every class.
 */
export function rampForBuildingRole(role: string, wallColorKey: string): readonly string[] {
  if (!isBuildingMeshRole(role)) {
    throw new Error(`building-mesh-role: unknown rl_role "${role}" -- not in the closed building role vocabulary`);
  }
  if (role !== 'wall') {
    return BUILDING_ROLE_PALETTE[role];
  }
  const dot = wallColorKey.indexOf('.');
  if (dot < 0) {
    throw new Error(`building-mesh-role: malformed wall colour key "${wallColorKey}" -- expected "band.index"`);
  }
  const band = wallColorKey.slice(0, dot);
  const index = Number(wallColorKey.slice(dot + 1));
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`building-mesh-role: malformed wall colour key "${wallColorKey}" -- expected "band.index"`);
  }
  return sliceFrom(band, index);
}
