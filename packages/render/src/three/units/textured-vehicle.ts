/**
 * The named exemption from the palette repaint, for VEHICLES -- the
 * `units/textured-building.ts` override extended by the project lead
 * (2026-09-07) to six supplied Meshy vehicle sources:
 *
 *     "revalidate tank and all other vehicles to ensure you are using
 *      blend file texture and not a self-painted one."
 *
 * Same rule, same words as the buildings' own: a supplied, photo-textured
 * Meshy source ships its own bake "as is unless ill provide other
 * instruction." `mbt_lavi`, `ifv_namer`, `technical`, `rocket_battery` and
 * `paramotor` are one welded mesh (or, for `technical`/`paramotor`, two)
 * cut into `{part}_{role}` pieces that all still reference the SAME source
 * material; `heli_peten`'s geometry was re-sourced from the sibling
 * `image-to-3d-texture` export specifically so it would have one to ship
 * (see `tools/vehicles/export_meshy_apache.py`'s own docstring, "GEOMETRY
 * SOURCE, 2026-09-07").
 *
 * Three vehicle sources ship no base_color bake at all and are
 * DELIBERATELY absent from this list: `jeep_shoded` and `dozer_d9`
 * (`KDF/Shodeed jeep`, `KDF/d9` -- part-segmentation only, no image in
 * either file) and the `KDF camp` prop (same). Those keep
 * `rampForVehicleRole`'s palette path unchanged, and `apc_eitan` is
 * kit-built and was never a candidate.
 *
 * Must stay in step with `TEXTURED_VEHICLE_EXEMPT` in
 * `tools/validate_mesh_assets.py` -- these types are skipped by the palette
 * and fill checks in `pnpm validate:meshes`, because a photograph of a tank
 * hull is not a palette ramp. The silhouette IoU check still runs on them,
 * and the geometry it compares is UNCHANGED from the previous, palette-only
 * export for four of the six (`mbt_lavi`, `ifv_namer`, `technical`,
 * `paramotor`) -- see this task's own report for the vertex-count/bbox
 * proof. `heli_peten`'s geometry changed source (see above) and
 * `rocket_battery`'s did too, for the identical reason `heli_peten`'s did.
 */
export const TEXTURED_VEHICLE_TYPES: ReadonlySet<string> = new Set([
  'mbt_lavi',
  'ifv_namer',
  'technical',
  'rocket_battery',
  'paramotor',
  'heli_peten',
]);
