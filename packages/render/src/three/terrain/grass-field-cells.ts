/**
 * GH-1167 S5: the 3D grass field's cells, instance matrices, LOD bands and splice, as plain data. Headless (no three.js), so the
 * `ThreeRenderer` (the legacy chunk) can compute them and hand them to the node chunk's builder (`grass-field.node.ts`'s
 * `createGrassFieldKit`), which is the only place a grass scene object is made. Names no `rl-grass-field` string: the bundle pin
 * P1 must find that marker in the node-backend chunk alone. Design: docs/superpowers/specs/2026-11-11-wadi-halam-3d-grass-design.md,
 * sections 3.2 and 3.5, decision 8.
 *
 *  - **Cells.** 8x8 tiles, one `InstancedMesh` per (cell, variant), so 36 cells and at most 108 meshes on a 48x48 map. A clump
 *    belongs to the cell of its SOURCE tile (`grassClumpsOfTile`). Inside a cell the clumps are in back-to-front order, the
 *    comparator `placeGrassClumps` sorts the whole map by, so a cell's list is exactly the map's list filtered to it. A (cell,
 *    variant) over the builder's per-mesh cap is split into parts, in that order.
 *  - **LOD.** A function of zoom alone (the camera is orthographic), with a +/-0.05 hysteresis so a zoom resting on a band edge
 *    never flickers. `'coarse'` (medium) multiplies both band edges by 1.2; `'off'` (low) builds no field.
 *  - **Splice.** A collapse re-places only the cells the terrain splice touched, grown by `GRASS_SPLICE_EXTRA_TILES`, and a
 *    re-placed cell is byte-identical to the same cell of a full build, because both run `grassCellMeshes`.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { RenderQuality } from '../../quality';
import { grassQualityOf } from '../../quality';
import { cachedRoadGraph, SCATTER_DENSITY } from './decor-place';
import { clampGrassScale, type GrassLod, type GrassVariant } from './grass-blade';
import { grassClumpsOfTile, grassDepthKey, GRASS_VARIANTS, type GrassClump } from './grass-field-place';
import { surfaceWorldY, type TerrainSurface } from './surface';
import type { TerrainInput } from './types';

/** A cell is `GRASS_CELL_TILES` x `GRASS_CELL_TILES` tiles (design 3.2). */
export const GRASS_CELL_TILES = 8;
/** The LOD band edges at `'full'` (design 2.1): LOD0 at zoom >= 1.5, LOD1 at 0.9 <= zoom < 1.5, LOD2 below. */
export const GRASS_LOD0_MIN_ZOOM = 1.5;
export const GRASS_LOD1_MIN_ZOOM = 0.9;
/**
 * The zoom rung (GH-1167, lead ruling 13 Nov): at a wide zoom only a stable `GRASS_RUNG_KEEP` share of the clumps draws (those whose
 * `thin` roll is under it), compacted into as few parts as it fits. ON below `GRASS_RUNG_ON_ZOOM`, OFF again at or above
 * `GRASS_RUNG_OFF_ZOOM` (the band scale applies, as it does to the LOD edges). The edges straddle 1.0 by more than the ABBA ladder's
 * z1 stop and the sheet's z1, so z1 is rung-on whichever way it is reached.
 */
export const GRASS_RUNG_KEEP = 0.5;
export const GRASS_RUNG_ON_ZOOM = 1.05;
export const GRASS_RUNG_OFF_ZOOM = 1.15;
/** The hysteresis either side of a band edge. */
export const GRASS_LOD_HYSTERESIS = 0.05;
/** `'coarse'` (medium) multiplies both band edges by this (decision 8). */
export const GRASS_COARSE_BAND_SCALE = 1.2;
/**
 * Tiles past the terrain splice's own dirty set (`dirtyTiles`, already `SPLICE_RADIUS_TILES` around every changed tile) whose
 * cells are re-placed too: a clump lands up to 0.1 tile outside its source tile and seats on the Catmull-Rom surface, whose
 * support reaches one tile further than the ground's own splice needs.
 */
export const GRASS_SPLICE_EXTRA_TILES = 1;

/** One grass mesh's instances: a (cell, variant, part), its clumps' matrices in back-to-front order. */
export interface GrassCellMesh {
  readonly cell: number;
  readonly variant: GrassVariant;
  readonly part: number;
  readonly count: number;
  /** 16 floats per clump, column-major (three's `Matrix4.elements`): translate, turn about +y by `yaw` turns, uniform scale. */
  readonly matrices: Float32Array;
  /**
   * The rung's content for THIS part index: the (cell, variant)'s clumps under `GRASS_RUNG_KEEP`, in the same back-to-front order,
   * chunked by `maxPerMesh` (so part p holds the p-th chunk; `count` 0 when the thinned list needs fewer parts). Never more than
   * `count`, so it fits the part's own instance buffer.
   */
  readonly thin: { readonly count: number; readonly matrices: Float32Array };
}

/** The whole field as data: every mesh of every cell. */
export interface GrassFieldPlan {
  readonly width: number;
  readonly height: number;
  readonly cellsX: number;
  readonly cellsY: number;
  readonly meshes: readonly GrassCellMesh[];
}

/** The band scale a preset draws at, or null for no field (`'off'`). */
export function grassLodScaleOf(q: RenderQuality | undefined): number | null {
  const g = grassQualityOf(q);
  return g === 'off' ? null : g === 'coarse' ? GRASS_COARSE_BAND_SCALE : 1;
}

/** The lowest zoom LOD `lod` (0 or 1) draws at, without hysteresis. */
function bandFloor(lod: 0 | 1, scale: number): number {
  return (lod === 0 ? GRASS_LOD0_MIN_ZOOM : GRASS_LOD1_MIN_ZOOM) * scale;
}

/**
 * The LOD at `zoom`. `prev` is the LOD drawn last frame (null on the first): it is kept until the zoom leaves its band by more
 * than `GRASS_LOD_HYSTERESIS`. A jump across two bands lands in one call.
 */
export function grassLodFor(zoom: number, prev: GrassLod | null, scale: number): GrassLod {
  if (prev === null) return zoom >= bandFloor(0, scale) ? 0 : zoom >= bandFloor(1, scale) ? 1 : 2;
  let lod: GrassLod = prev;
  while (lod < 2 && zoom < bandFloor(lod as 0 | 1, scale) - GRASS_LOD_HYSTERESIS) lod = (lod + 1) as GrassLod;
  while (lod > 0 && zoom >= bandFloor((lod - 1) as 0 | 1, scale) + GRASS_LOD_HYSTERESIS) lod = (lod - 1) as GrassLod;
  return lod;
}

/** Whether the rung is on at `zoom`. `prev` is last frame's state (null on the first frame). */
export function grassRungFor(zoom: number, prev: boolean | null, scale: number): boolean {
  if (prev === null) return zoom < GRASS_RUNG_ON_ZOOM * scale;
  return prev ? zoom < GRASS_RUNG_OFF_ZOOM * scale : zoom < GRASS_RUNG_ON_ZOOM * scale;
}

/** Writes one clump's matrix at `out[o..o+16)`, column-major: `T(x, y, z) * Ry(yaw turns) * S(s)`. */
export function grassClumpMatrix(x: number, y: number, z: number, yawTurns: number, s: number, out: Float32Array, o: number): void {
  const a = yawTurns * Math.PI * 2;
  const c = Math.cos(a);
  const n = Math.sin(a);
  out[o] = c * s;
  out[o + 1] = 0;
  out[o + 2] = -n * s;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = s;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = n * s;
  out[o + 9] = 0;
  out[o + 10] = c * s;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** A placed clump with its seat height, before it is sorted. */
interface Seated extends GrassClump {
  readonly y: number;
  readonly key: number;
}

/** The cell grid of a map. */
export function grassCellGrid(width: number, height: number): { cellsX: number; cellsY: number } {
  return { cellsX: Math.ceil(width / GRASS_CELL_TILES), cellsY: Math.ceil(height / GRASS_CELL_TILES) };
}

/**
 * The clumps whose source tile is in `cell`, in back-to-front order: `placeGrassClumps`'s own tile test, seat and comparator, so a
 * cell's list is the map's list filtered to the cell.
 */
export function grassCellClumps(input: TerrainInput, surface: TerrainSurface, cell: number, density: number = SCATTER_DENSITY): Seated[] {
  const { cellsX } = grassCellGrid(input.width, input.height);
  const cx = cell % cellsX;
  const cy = Math.floor(cell / cellsX);
  const graph = cachedRoadGraph(input);
  const list: GrassClump[] = [];
  const x1 = Math.min(input.width, (cx + 1) * GRASS_CELL_TILES);
  const y1 = Math.min(input.height, (cy + 1) * GRASS_CELL_TILES);
  for (let ty = cy * GRASS_CELL_TILES; ty < y1; ty++) {
    for (let tx = cx * GRASS_CELL_TILES; tx < x1; tx++) {
      const t = ty * input.width + tx;
      if (input.blocked[t] !== 0 || input.cover[t] !== 0) continue;
      grassClumpsOfTile(input, graph, tx, ty, density, list);
    }
  }
  const seated: Seated[] = list.map((c) => {
    const y = surfaceWorldY(surface, c.x, c.z);
    return { ...c, y, key: grassDepthKey(c.x, y, c.z) };
  });
  // `placeGrassClumps`'s comparator, on the same float64 values.
  seated.sort((a, b) => a.key - b.key || a.z - b.z || a.x - b.x);
  return seated;
}

/** One cell's meshes: per variant, its clumps in order, split into parts of at most `maxPerMesh`. Empty variants make no mesh. */
export function grassCellMeshes(
  input: TerrainInput,
  surface: TerrainSurface,
  cell: number,
  maxPerMesh: number,
  density: number = SCATTER_DENSITY
): GrassCellMesh[] {
  if (!Number.isInteger(maxPerMesh) || maxPerMesh < 1) throw new Error(`grassCellMeshes: maxPerMesh ${maxPerMesh}`);
  const clumps = grassCellClumps(input, surface, cell, density);
  const out: GrassCellMesh[] = [];
  for (let v = 0; v < GRASS_VARIANTS; v++) {
    const variant = v as GrassVariant;
    const mine = clumps.filter((c) => c.variant === v);
    const kept = mine.filter((c) => c.thin < GRASS_RUNG_KEEP);
    const write = (list: Seated[], start: number): { count: number; matrices: Float32Array } => {
      const slice = list.slice(start, start + maxPerMesh);
      const matrices = new Float32Array(slice.length * 16);
      slice.forEach((c, i) => grassClumpMatrix(c.x, c.y, c.z, c.yaw, clampGrassScale(variant, c.scale), matrices, i * 16));
      return { count: slice.length, matrices };
    };
    for (let part = 0, start = 0; start < mine.length; part++, start += maxPerMesh) {
      const full = write(mine, start);
      out.push({ cell, variant, part, count: full.count, matrices: full.matrices, thin: write(kept, start) });
    }
  }
  return out;
}

/** Every cell's meshes: the full build. */
export function planGrassField(input: TerrainInput, surface: TerrainSurface, maxPerMesh: number, density: number = SCATTER_DENSITY): GrassFieldPlan {
  const { cellsX, cellsY } = grassCellGrid(input.width, input.height);
  const meshes: GrassCellMesh[] = [];
  for (let cell = 0; cell < cellsX * cellsY; cell++) meshes.push(...grassCellMeshes(input, surface, cell, maxPerMesh, density));
  return { width: input.width, height: input.height, cellsX, cellsY, meshes };
}

/**
 * The cells a terrain splice touched: every cell holding a tile of `dirty` (the terrain's own `dirtyTiles`) grown by
 * `extra` tiles. Ascending cell order.
 */
export function grassSpliceCells(dirty: Uint8Array, width: number, height: number, extra: number = GRASS_SPLICE_EXTRA_TILES): number[] {
  const { cellsX, cellsY } = grassCellGrid(width, height);
  const hit = new Uint8Array(cellsX * cellsY);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      if (dirty[ty * width + tx] === 0) continue;
      const c0 = Math.max(0, Math.floor((tx - extra) / GRASS_CELL_TILES));
      const c1 = Math.min(cellsX - 1, Math.floor((tx + extra) / GRASS_CELL_TILES));
      const r0 = Math.max(0, Math.floor((ty - extra) / GRASS_CELL_TILES));
      const r1 = Math.min(cellsY - 1, Math.floor((ty + extra) / GRASS_CELL_TILES));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) hit[r * cellsX + c] = 1;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < hit.length; i++) if (hit[i] !== 0) out.push(i);
  return out;
}
