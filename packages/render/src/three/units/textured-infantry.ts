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
]);
