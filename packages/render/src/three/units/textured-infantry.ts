/**
 * The named exemption from the palette repaint, for rigged INFANTRY teams --
 * the third sibling of `units/textured-building.ts` and
 * `units/textured-vehicle.ts`.
 *
 * GH-160 was answered "ship the bakes", but until GH-286 (batch B0b) no
 * infantry GLB carried one, so there was nothing to name. The first
 * Meshy-textured figures (`at_team`, `demo_squad`) need somewhere to be
 * exempt before they can land; this is that place (style bible section 7,
 * question 1).
 *
 * EMPTY BY DESIGN. The rule is that a team is added here one at a time, in
 * the same change that ships its GLB, and never ahead of the asset: an entry
 * with no bake behind it would quietly turn off the one check that refuses a
 * smuggled texture. A listed team keeps the `base_color` bake its GLB ships
 * (`texturedMaterial`, `../world-materials.ts`, the same call buildings and
 * vehicles make); an UNLISTED team that ships a texture throws at load.
 *
 * Keyed by UNIT TYPE id, because that is what `ThreeRenderer.loadMeshUnit`
 * is given and a bundled build hashes GLB file names. That equals the GLB
 * basename only where the "team id == unit type id == file basename"
 * convention holds (`at_team`, `demo_squad`); a Meshy asset filed under a
 * different name (`meshy_soldier.glb` draws `inf_squad`) needs the two
 * reconciled when it is listed.
 *
 * Must stay in step with `TEXTURED_INFANTRY_EXEMPT` in
 * `tools/validate_mesh_assets.py`, pinned by `textured-infantry.test.ts`.
 * Members are skipped by the palette, framing and fill checks in
 * `pnpm validate:meshes` and named on a `NOT palette-checked` line; the
 * silhouette IoU check still runs.
 */
export const TEXTURED_INFANTRY_TYPES: ReadonlySet<string> = new Set<string>([
  // GH-286 batch B0b (2026-09-30): the first two Meshy-textured figure
  // teams, built by tools/units/import_meshy_kdf_team.py. Each ships its
  // remesh's 1024 base-colour bake on the figure roles (uniform, boot,
  // face); the kit weapon roles in the same GLB carry no map and still take
  // the faction ramp.
  'at_team',
  'demo_squad',
  // B3 (GH-179, 2026-09-30): Meshy figures remeshed from a refined task, so
  // each ships its own base-colour bake -- tools/units/import_meshy_crew_team.py.
  'militia_cell',
  'rpg_team',
  'atgm_cell',
  // B4 (GH-179, 2026-10-01): the three remaining enemy teams, same path.
  'mortar_crew',
  'charge_squad',
  'digger_crew',
  // B5 (GH-179, 2026-10-01): the last KDF team, same path (the crew
  // importer, with the helmet cut as `uniform`).
  'breach_team',
  // B6 (GH-179, 2026-10-01): the riders are rpg_team's textured figure
  // re-posed seated (tools/units/import_meshy_moto_rpg.py); the Meshy bike
  // beside them carries no UV and takes the ramp -- per mesh, as B0b.
  'moto_rpg',
  // GH-298 (2026-09-30): the three officer teams, tools/units/
  // import_meshy_officers.py -- each a new Meshy figure plus a B0b remesh as
  // its second figure, both bakes in one 2048x1024 atlas. HELD art
  // (HELD_MESH_FILES) until Stage 5 wires the unit types; listed now so the
  // file that ships the bake is the file that names the exemption.
  'officer_engineer',
  'officer_fires',
  'officer_infantry',
  // E5 part 2 (GH-181, 2026-09-30): the Shmamit deep recon team, built by
  // tools/units/import_meshy_zikit_team.py from one Meshy figure with its
  // 1024 base-colour bake on uniform/boot/face; its kit whip, tripod scope
  // and rifle carry no map and take the faction ramp. HELD in
  // mesh-catalogue.ts until Task 9 lands its unit JSON.
  'recon_zikit',
]);
