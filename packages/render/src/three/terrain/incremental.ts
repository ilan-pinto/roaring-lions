/**
 * Which ground and scatter tiles a terrain rebuild has to redo, and which it
 * can copy from the last build -- the dirty rectangle `ThreeRenderer`'s
 * `rebuildTerrain` uses so a building collapse stops rebuilding the map
 * (docs/PERFORMANCE.md, "Low-end": a collapse blocked the main thread for
 * 141-175 ms unthrottled and 499-643 ms at 4x CPU, all of it a full rebuild
 * for one footprint).
 *
 * The set is DERIVED from what changed, never assumed from the event: the new
 * build's per-tile inputs are diffed against the last build's, and the
 * changed tiles are grown by how far a tile's own geometry reads. So a
 * collapse that reopens one pad redoes the pad and its margin; one that also
 * re-flows the terrace fill under a neighbouring building (`surface.ts`'s
 * fill spreads through a whole connected terrace) redoes that too, because
 * that neighbour's field values changed and the diff sees them.
 *
 * Per tile, what the two builders read (`ground.ts`, `scatter.ts`):
 *
 *  - its own `blocked`, `cover` and `decor` (the tone, the marks);
 *  - `isTerrace` of itself and its east/south neighbours (`hasWall`), and of
 *    the tile under any mark it draws -- marks reach at most ~0.9 tile off
 *    their tile's centre (`scatter.ts`'s widest offset is a stone fleck at
 *    26 px across, 0.81 tile, plus its own corner), so that is tiles -1..+1;
 *  - the smooth field (`smoothLevel`/`smoothNormal`), which is Catmull-Rom
 *    over tile CENTRES with a 4-sample support: any point in tile `x` (or
 *    within 0.9 of it) reads field columns `x - 2 .. x + 2`.
 *
 * Hence `SPLICE_RADIUS_TILES = 2`, for both builders. `decor` and
 * `elevation` never change under a running mission; if either array is not
 * the one the last build used, or the map's size or flatness differs, there
 * is nothing to diff against and the caller does a full build.
 */
import type { TerrainSurface } from './surface';
import type { TiledMeshData } from './tiled-mesh';
import { dilateTileMask } from './tiled-mesh';
import type { TerrainInput } from './types';

/** How far, in tiles, a changed tile's influence reaches into its
 *  neighbours' ground and scatter geometry -- see this module's top comment
 *  for the derivation. `packages/app/src/terrain-splice.test.ts` holds a splice at this radius
 *  byte-equal to a full build, and shows one at radius 1 is not. */
export const SPLICE_RADIUS_TILES = 2;

/** What the last ground/scatter build was made from, and what it made. */
export interface TerrainBuildState {
  readonly width: number;
  readonly height: number;
  /** By reference: the renderer replaces these arrays, never writes them. */
  readonly decor: Uint8Array | null;
  readonly elevation: Uint8Array | null;
  /** By CONTENT, as copies: the draw mask is a fresh array every build, and
   *  `sim.cover` is the sim's own array, written in place when a building
   *  falls -- a reference would always compare equal. */
  readonly blocked: Uint8Array;
  readonly cover: Uint8Array;
  readonly surface: TerrainSurface;
  readonly ground: TiledMeshData;
  readonly scatter: TiledMeshData;
}

export function terrainBuildState(
  input: TerrainInput,
  surface: TerrainSurface,
  ground: TiledMeshData,
  scatter: TiledMeshData
): TerrainBuildState {
  return {
    width: input.width,
    height: input.height,
    decor: input.decor,
    elevation: input.elevation,
    blocked: input.blocked.slice(),
    cover: input.cover.slice(),
    surface,
    ground,
    scatter,
  };
}

/**
 * Every tile whose own inputs differ between the last build and `input` (with
 * its freshly built `surface`): `blocked`, `cover`, and on a map with relief
 * the terrace flag and the smooth field's source value. `null` when the two
 * cannot be compared at all -- a different map, a replaced decor or
 * elevation array, or a change in flatness -- which means a full build.
 */
export function changedTerrainTiles(
  prev: TerrainBuildState,
  input: TerrainInput,
  surface: TerrainSurface
): Uint8Array | null {
  if (prev.width !== input.width || prev.height !== input.height) return null;
  if (prev.decor !== input.decor || prev.elevation !== input.elevation) return null;
  if (prev.surface.flat !== surface.flat) return null;
  const n = input.width * input.height;
  const changed = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    if (prev.blocked[t] !== input.blocked[t] || prev.cover[t] !== input.cover[t]) changed[t] = 1;
  }
  if (!surface.flat) {
    for (let t = 0; t < n; t++) {
      if (prev.surface.terrace[t] !== surface.terrace[t] || prev.surface.field[t] !== surface.field[t]) changed[t] = 1;
    }
  }
  return changed;
}

/** `changed` grown by `radius` tiles: the tiles a splice must re-emit. */
export function spliceMask(changed: Uint8Array, width: number, height: number, radius = SPLICE_RADIUS_TILES): Uint8Array {
  return dilateTileMask(changed, width, height, radius);
}

/** True when no tile is marked. */
export function maskEmpty(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) return false;
  return true;
}
