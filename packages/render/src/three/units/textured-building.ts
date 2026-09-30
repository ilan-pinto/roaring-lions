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
  // GH-277 field works (militia, textured by Q11): the OP and weapons
  // workshop ship their Meshy bake; the field clinic carries a textured crop
  // of `clinic.glb` beside palette sandbags (per-MESH rule). Held in
  // `HELD_MESH_FILES` until Stage 5 adds the structure types.
  'militia_observation_post',
  'militia_weapons_workshop',
  'militia_field_clinic',
  // The A3.2 ramp set (GH-185, 2026-09-30): `concrete`, `shanty`, `wall` and
  // `camp` were palette-painted (three kit-built, the camp a part-segmented
  // Meshy source) and are now Meshy text-to-3D remeshes shipping their own
  // 2k bakes through `tools/buildings/export_meshy_ramp.py`.
  'concrete',
  'shanty',
  'wall',
  'camp',
]);
