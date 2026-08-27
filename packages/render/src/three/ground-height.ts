/**
 * Task B3.2: the ground-height query units need to stand on B2's terraced
 * mesh, plus the world-Y conversion that mesh's own height is derived
 * through. B2's outcome doc named this gap as hazard 5: `ThreeRenderer.
 * worldToScreen` deliberately omits `lift` -- correct for the render seam,
 * useless for standing a unit on a terrace.
 *
 * `levelAt` (`terrain/shared.ts`, landed one task ago by B3.1) already IS
 * "which level is this tile" -- the containing-tile lookup, off-map
 * clamped to 0, that B3.1 spent its whole task consolidating out of five
 * separate copies (`hexToUnit` x4, `levelAt` x5, etc. -- see `terrain/
 * shared.ts`'s own header). This task's brief sketches a raw-arrays
 * signature, `groundLevelAt(elevation, width, height, x, y)`, rather than
 * `levelAt`'s `TerrainInput` one. Per the orchestrator ruling overriding
 * that brief: rather than re-implementing the tile lookup a sixth time, or
 * widening `levelAt` itself (barred -- this task may not edit any file
 * under `terrain/`, where a review of B3.1's consolidation is still open,
 * and the unit path calling this module has no `TerrainInput` of its own
 * to hand either), `groundLevelAt` is a thin adapter: it builds the
 * minimal `TerrainInput` shape `levelAt` asks for and delegates to it.
 *
 * `decor`, `blocked` and `cover` are required fields of `TerrainInput` but
 * never read by `levelAt` -- it only touches `width`, `height` and
 * `elevation` (see its own body) -- so the adapter fills them from one
 * shared empty placeholder instead of allocating fresh arrays per call.
 *
 * The genuinely new thing here, per the ruling, is `groundWorldY`: level
 * to world Y, going through `WORLD_PER_LEVEL` -- the same constant B2's
 * `ground.ts` multiplies a tile's level by to place its own top quad --
 * rather than an independently-tuned conversion, so a unit standing on a
 * tile lands exactly on that tile's own top face, not merely close to it.
 */
import { levelAt, WORLD_PER_LEVEL } from './terrain/shared';
import type { TerrainInput } from './terrain/types';

/** Never mutated, never indexed past its own zero length -- `levelAt` only
 *  reads `blocked`/`cover` array identity, never their contents, so one
 *  shared empty array for both fields is safe to reuse across every call. */
const EMPTY_BYTES = new Uint8Array(0);

/**
 * Elevation level (0-9) of the tile containing world point `(x, y)`, or 0
 * off the map. Samples the containing tile rather than interpolating the
 * four corners -- matching Pixi's `groundOffset` (`renderer.ts:706`) and
 * B2's terraced ground mesh (`terrain/ground.ts`) exactly: both sample by
 * `Math.floor`, deliberately, so a unit crossing a terrace steps up rather
 * than ramping across a cliff face with no geometry there to stand on.
 */
export function groundLevelAt(
  elevation: Uint8Array | null,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const input: TerrainInput = {
    width,
    height,
    decor: null,
    elevation,
    blocked: EMPTY_BYTES,
    cover: EMPTY_BYTES,
  };
  return levelAt(input, Math.floor(x), Math.floor(y));
}

/**
 * World-space Y (three.js height) of the ground under world point `(x,
 * y)`. Derived through `WORLD_PER_LEVEL`, not an independent constant --
 * if the two ever disagreed, a unit would float above or sink into its own
 * tile.
 */
export function groundWorldY(
  elevation: Uint8Array | null,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  return groundLevelAt(elevation, width, height, x, y) * WORLD_PER_LEVEL;
}
