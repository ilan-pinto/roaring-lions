/**
 * `rl_role` -> the single reserved `vfx.*` palette key a MODELLED, palette-
 * shaded VFX mesh zone always resolves to. Shared by every asset class built
 * on the "one supplied mesh, re-origined, split by 3D radius into three
 * concentric incandescent zones" recipe -- today that is
 * `art/meshes/vfx/muzzle_flash.glb` (`./muzzle-flash-role.ts`) and
 * `art/meshes/vfx/explosion_burst.glb` (`./explosion-burst-role.ts`), each
 * re-exporting this module's own vocabulary under its own asset-scoped
 * names rather than duplicating the three-entry table a second (and now
 * third) time.
 *
 * Extracted here, out of `muzzle-flash-role.ts`, once a SECOND asset needed
 * the identical `core`/`mid`/`outer` -> `white_hot`/`fire`/`ember` mapping --
 * see this task's report ("explosion-burst-report.md") for why: the values
 * are not merely structurally similar, they are IDENTICAL, and a second
 * hand-copied table would drift from the first the moment either changed
 * without the other noticing. This does not contradict
 * `muzzle-flash-role.ts`'s own historical "roles are a closed set per ASSET
 * CLASS, not one universal ten" rule -- that rule is about vehicles' six
 * roles and infantry's ten meaning something different from each other
 * (`hull` is a vehicle body; `metal` is an infantry rifle barrel); it says
 * nothing against two DIFFERENT incandescent-mesh asset classes sharing one
 * vocabulary when the zones mean the same thing in both: `core` is always
 * the hottest, most ignition-adjacent zone, `outer` always the widest,
 * coolest edge, regardless of which asset draws them.
 *
 * Each zone maps to exactly ONE flat, unlit, already-resolved palette entry
 * -- a modelled incandescent effect reads as something EMITTING light, and a
 * quantized `N·L` band across its surface (`palette-material.ts`'s
 * `toonRampMaterial`) would put a dark side on a shape whose whole point is
 * to look uniformly hot. See `muzzle-flash.ts`'s own top comment
 * ("Why a mesh at all") for the full palette argument this vocabulary is
 * built on.
 */

/** The shared VFX-mesh closed role vocabulary. */
export const VFX_MESH_ROLES = ['core', 'mid', 'outer'] as const;

export type VfxMeshRole = (typeof VFX_MESH_ROLES)[number];

export function isVfxMeshRole(role: string): role is VfxMeshRole {
  return (VFX_MESH_ROLES as readonly string[]).includes(role);
}

/** role -> the one `data/palette.json` `reserved.vfx` key that zone always
 *  resolves to, unconditionally -- never a ramp slice, never blended with
 *  its neighbours. `core` is the ignition-adjacent zone (`vfx.white_hot`),
 *  `mid` the flare/body around it (`vfx.fire`), `outer` the widest, coolest
 *  edge (`vfx.ember`). */
const VFX_MESH_ROLE_KEY: Readonly<Record<VfxMeshRole, string>> = {
  core: 'vfx.white_hot',
  mid: 'vfx.fire',
  outer: 'vfx.ember',
};

export function vfxMeshPaletteKey(role: VfxMeshRole): string {
  return VFX_MESH_ROLE_KEY[role];
}
