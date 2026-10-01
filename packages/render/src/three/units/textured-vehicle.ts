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
 * `jeep_shoded` joined the list on 2026-09-07 (evening) when the lead
 * supplied its `image-to-3d-texture` pass -- the same mesh as its
 * part-segmentation file, so `export_meshy_jeep.py` transfers Meshy's own
 * split onto the textured geometry (see `tools/vehicles/segmentation.py`).
 * Two vehicle sources still ship no base_color bake and are DELIBERATELY
 * absent: `dozer_d9` (`KDF/d9`, part-segmentation only) and the `KDF camp`
 * prop (same). Those keep `rampForVehicleRole`'s palette path unchanged,
 * and the `KDF camp` prop is kit-built. `apc_eitan` WAS kit-built and joined
 * the list on 2026-09-30 (GH-286, batch B0a): its hull is now a Meshy
 * text-to-3D remesh shipping its own 2k base_color bake
 * (`tools/vehicles/export_meshy_eitan.py`), at the 35 credits the lead
 * approved on PR #290. Its `kit.rws` weapon station carries no material and
 * draws through `rampForVehicleRole` -- the textured branch is per MESH.
 * `apc_kipod` followed the same day on the lead's ruling after seeing the
 * two side by side (`tools/vehicles/export_meshy_kipod.py`), same shape:
 * textured hull and tyres, palette kit RWS on its roof ring.
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
  'jeep_shoded',
  // B2 (GH-179, 2026-09-30): the first vehicle generated through `pnpm meshy`
  // end to end; ships its remesh's own bake (bible section 7 q2).
  'gun_truck',
  'apc_eitan',
  'apc_kipod',
  // The A3.2 ramp set (GH-185, 2026-09-30): `dozer_d9` (a palette-painted
  // part-segmentation source until now) and `scout_shachaf` (kit-built) are
  // Meshy text-to-3D remeshes shipping their own 2k bakes through
  // `tools/vehicles/export_meshy_ramp.py`; the Shachaf's kit RWS carries no
  // material and draws through `rampForVehicleRole`, per mesh.
  'dozer_d9',
  'scout_shachaf',
  // E5 part 2 (GH-181, 2026-09-30): the Peten Gunship is heli_peten.glb
  // re-opened with stores added, every added part UV-pinned to the Peten's
  // own bake (tools/vehicles/export_meshy_apache_gunship.py), so it ships
  // the same photograph. HELD in mesh-catalogue.ts until Task 9.
  'heli_peten_gunship',
]);
