/**
 * The building types whose GLBs may ship their own baked material instead of
 * being repainted from the palette. Every other type takes
 * `rampForBuildingRole` exactly as before.
 *
 * Must stay in step with `TEXTURED_MESH_EXEMPT` in
 * `tools/validate_mesh_assets.py` -- these types are skipped by the palette
 * and fill checks in `pnpm validate:meshes`, because a photograph of a
 * limestone wall is not a palette ramp and never will be. The silhouette IoU
 * check still runs on them.
 */
export const TEXTURED_BUILDING_TYPES: ReadonlySet<string> = new Set([
  'house',
  'apartment',
  'warehouse',
  'clinic',
  'hall',
  'fence',
]);
