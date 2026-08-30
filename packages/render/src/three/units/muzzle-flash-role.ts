/**
 * `rl_role` -> the single reserved `vfx.*` palette key a muzzle-flash mesh
 * zone always resolves to. The muzzle-flash mesh's own closed role
 * vocabulary -- a NEW asset class (`art/meshes/vfx/muzzle_flash.glb`), not
 * vehicles' six-role table (`vehicle-mesh-role.ts`) or infantry's ten
 * (`mesh-role.ts`). Per the mesh unit contract's own rule, restated in this
 * task's brief: "roles are a closed set per ASSET CLASS, not one universal
 * ten" -- a modelled flash has no hull, no turret, no skin, so neither
 * existing table applies, and borrowing one would either reject every mesh
 * in this GLB (vehicles' `hull`/`plate`/`metal`/...) or accept a name that
 * means something unrelated for infantry (`mesh-role.ts`'s `metal` is a
 * weapon barrel, not a flash zone).
 *
 * The vocabulary itself: `core`, `mid`, `outer` -- the three concentric
 * zones `art/blend/Muzzle flush/...blend`'s single 839-vert/1673-tri blob
 * was cut into by 3D distance from its own muzzle-attachment origin (see
 * `muzzle-flash.ts`'s own top comment for the re-origin/split account).
 * Unlike a vehicle's `hull`/`plate` (a lit, toon-shaded ramp SLICE,
 * `vehicle-mesh-role.ts`'s own `sliceFrom`), each flash zone maps to
 * exactly ONE flat, unlit, already-resolved palette entry -- a flash reads
 * as something EMITTING light, and a quantized `N·L` band across its
 * surface (`palette-material.ts`'s `toonRampMaterial`) would put a dark
 * side on a shape whose whole point is to look uniformly incandescent.
 * `core` is the muzzle-adjacent ignition point (`vfx.white_hot`), `mid` the
 * flare around it (`vfx.fire`), `outer` the widest, coolest edge
 * (`vfx.ember`) -- the same white -> orange -> red-orange grade
 * `fire_apfsds.json`'s own hotCore particle redesign already builds by
 * SPATIAL layering of separate particle layers (`units/fx.ts`'s "hotCore"
 * doc comment, "leans on SPATIAL layering... rather than on summation"),
 * expressed here as geometry instead of stacked particles.
 */

/** The muzzle-flash mesh's own closed role vocabulary. */
export const MUZZLE_FLASH_ROLES = ['core', 'mid', 'outer'] as const;

export type MuzzleFlashRole = (typeof MUZZLE_FLASH_ROLES)[number];

export function isMuzzleFlashRole(role: string): role is MuzzleFlashRole {
  return (MUZZLE_FLASH_ROLES as readonly string[]).includes(role);
}

/** role -> the one `data/palette.json` `reserved.vfx` key that zone always
 *  resolves to, unconditionally -- never a ramp slice, never blended with
 *  its neighbours. Resolved once, at `MuzzleFlashManager.setColors`, through
 *  the SAME `resolve` callback `ThreeRenderer.useEmitters` already threads
 *  to `ParticleSystem` -- these are literal palette KEYS, not hex, exactly
 *  like `fire_apfsds.json`'s own `color_over_life: ["vfx.white_hot", ...]`. */
const MUZZLE_FLASH_ROLE_KEY: Readonly<Record<MuzzleFlashRole, string>> = {
  core: 'vfx.white_hot',
  mid: 'vfx.fire',
  outer: 'vfx.ember',
};

export function muzzleFlashPaletteKey(role: MuzzleFlashRole): string {
  return MUZZLE_FLASH_ROLE_KEY[role];
}
