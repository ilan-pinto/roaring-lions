/**
 * The muzzle-flash mesh's own closed role vocabulary -- `core`/`mid`/`outer`,
 * the three concentric zones `art/blend/Muzzle flush/...blend`'s single
 * 839-vert/1673-tri blob was cut into by 3D distance from its own muzzle-
 * attachment origin (see `muzzle-flash.ts`'s own top comment for the
 * re-origin/split account).
 *
 * A thin, asset-scoped re-export of `./vfx-mesh-role.ts` as of the
 * `explosion_burst` task -- see that module's own top comment for why the
 * shared table moved there (a second asset class, `explosion-burst.ts`,
 * needed the IDENTICAL `core`/`mid`/`outer` -> `white_hot`/`fire`/`ember`
 * mapping, not merely a similar one). Every name this file exports is
 * unchanged from before that extraction (`MUZZLE_FLASH_ROLES`,
 * `MuzzleFlashRole`, `isMuzzleFlashRole`, `muzzleFlashPaletteKey`) -- both
 * this file's own callers (`muzzle-flash.ts`) and its own tests
 * (`muzzle-flash-role.test.ts`) needed no edit.
 */
export {
  VFX_MESH_ROLES as MUZZLE_FLASH_ROLES,
  isVfxMeshRole as isMuzzleFlashRole,
  vfxMeshPaletteKey as muzzleFlashPaletteKey,
} from './vfx-mesh-role';
export type { VfxMeshRole as MuzzleFlashRole } from './vfx-mesh-role';
