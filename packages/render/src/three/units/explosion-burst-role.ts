/**
 * The explosion-burst mesh's own closed role vocabulary -- `core`/`mid`/
 * `outer`, the three concentric zones `art/blend/explosion burst /
 * Meshy_AI_explosion_fireball_lo_0830152530_texture.blend`'s single
 * 1154-vert/2304-tri blob was cut into by 3D distance from its own
 * bounding-box centre (see `explosion-burst.ts`'s own top comment for the
 * re-origin/split account, and this task's report for why the split
 * ORIGIN differs from the mesh's PLACEMENT origin here, unlike the muzzle
 * flash where the two coincide).
 *
 * A thin, asset-scoped re-export of `./vfx-mesh-role.ts` -- the identical
 * `core`/`mid`/`outer` -> `white_hot`/`fire`/`ember` vocabulary
 * `muzzle-flash-role.ts` also re-exports, under this asset's own names so
 * `explosion-burst.ts` and its tests read as unambiguously about THIS asset
 * class, matching the existing `<asset>.ts` + `<asset>-role.ts` file-pair
 * convention rather than importing `vfx-mesh-role.ts` (or, worse,
 * `muzzle-flash-role.ts`) directly under a misleading name.
 */
export {
  VFX_MESH_ROLES as EXPLOSION_BURST_ROLES,
  isVfxMeshRole as isExplosionBurstRole,
  vfxMeshPaletteKey as explosionBurstPaletteKey,
} from './vfx-mesh-role';
export type { VfxMeshRole as ExplosionBurstRole } from './vfx-mesh-role';
