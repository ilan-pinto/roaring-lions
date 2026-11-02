/**
 * The ground, scatter and ditch of a LARGE map, cut into square chunks so the camera's frustum can
 * skip the ones it cannot see (GH-913, GH-920).
 *
 * Until this existed the ground was ONE mesh for the whole map, and the ditch ONE `InstancedMesh`.
 * three culls each by a bounding sphere, and a sphere that holds an 80x80 map intersects every view,
 * so Rujm Sawda drew its 197k ground triangles (and the same again in the AO pre-pass) whatever the
 * camera looked at -- and, far worse, every one of its 192 ditch segments, ~38k triangles each, in
 * the shadow, AO and main passes: 22 of the frame's 23 million triangles. The cost grows with map
 * AREA while the view does not.
 *
 * The decor BatchedMeshes are not chunked: they cull per instance already, and chunking them was
 * measured to gain nothing and cost 0.2 to 1.8 ms (`docs/agent-notes/terrain-rendering.md`, "Chunks").
 *
 * ## A chunk is a RANGE OF TILES, not new geometry
 *
 * `buildGround` and `buildScatter` are tile loops (`tiled-mesh.ts`): tile `t` owns vertices
 * `[vertexStart[t], vertexStart[t + 1])` and indices `[indexStart[t], ...)`, and a tile's output
 * reads nothing a neighbour wrote. So a chunk's mesh is the concatenation of its tiles' ranges out
 * of the whole-map build (`sliceChunk`), with the indices shifted down to the chunk's own vertices.
 * Every float in it is the very float the whole-map mesh holds. That is why a seam cannot open:
 *
 *  - the ground's normals are ANALYTIC (Catmull-Rom over tile centres, `surface.ts`), a function of
 *    the position and nothing else, never an average over the faces that happen to share a vertex.
 *    A vertex on a chunk edge therefore has one position and one normal whichever side emits it;
 *  - nothing about a tile's geometry depends on which chunk it lands in, so the whole-map build
 *    and the chunked one cannot disagree (`terrain-chunks.test.ts` compares them byte for byte,
 *    and compares the two sides of every chunk edge with each other).
 *
 * ## Which maps are chunked
 *
 * Only those larger than `CHUNKED_ABOVE_TILES` (48 x 48). Every map shipped before Rujm Sawda is
 * 48 x 48, and for them `chunkGridFor` answers null: ONE mesh, built exactly as it was, so the
 * golden baselines cannot move. The gate is by area, not by a flag on the map, so GH-920's bigger
 * maps are chunked without anyone remembering to ask.
 *
 * ## Pure on purpose
 *
 * No `three` here: the barrel exports it, and `terrain-chunks.test.ts` builds real maps against
 * it. The scene-graph half is `chunk-layer.ts`.
 */
import type { MeshData } from './types';
import type { TiledMeshData } from './tiled-mesh';

/** A map this size or smaller is one mesh. 48 x 48 is every map before Rujm Sawda (80 x 80). */
export const CHUNKED_ABOVE_TILES = 48 * 48;

/** The two things that are chunked, each with its own edge (see `CHUNK_EDGE_TILES`). The decor
 *  BatchedMeshes are deliberately not one: see "Chunks" in `docs/agent-notes/terrain-rendering.md`. */
export type ChunkLayer = 'ground' | 'ditch';

/** The chunk edge, in tiles, per layer. They differ because what each layer costs differs by two
 *  orders of magnitude (the census is `packages/app/src/terrain-chunk-budget.test.ts`; the browser
 *  measurements and the reasoning are in `docs/agent-notes/terrain-rendering.md`, "Chunks"):
 *
 *  - `ground` (also the scatter, cut from the same tile loop): ~245k triangles a pass on Rujm in
 *    all, one draw each. Neutral at 80x80 (-0.5..+0.1 ms against one mesh, inside the noise), kept
 *    because the cost grows with area and a draw per chunk does not.
 *  - `ditch`: one draw a chunk a pass, ~38k triangles a SEGMENT. This is the layer chunking is for
 *    (96% of a Rujm frame's triangles), so it gets the finest cut: 8 measured -2.1 to -4.0 ms
 *    against one mesh, where 16 left a chunk straddling a ditch run and gained 0.8. */
export const CHUNK_EDGE_TILES: Readonly<Record<ChunkLayer, number>> = { ground: 32, ditch: 8 };

export interface ChunkGrid {
  readonly width: number;
  readonly height: number;
  readonly edge: number;
  readonly cols: number;
  readonly rows: number;
}

/** The chunk grid for a `width` x `height` map, or null when the map stays whole. `edge` and
 *  `wholeUpTo` are for the specs and the census; the game always takes the defaults. */
export function chunkGridFor(
  width: number,
  height: number,
  layer: ChunkLayer,
  edge: number = CHUNK_EDGE_TILES[layer],
  wholeUpTo: number = CHUNKED_ABOVE_TILES
): ChunkGrid | null {
  if (!(edge >= 1) || !Number.isInteger(edge)) throw new Error(`chunkGridFor: chunk edge ${edge} is not a whole number of tiles`);
  if (width * height <= wholeUpTo) return null;
  return { width, height, edge, cols: Math.ceil(width / edge), rows: Math.ceil(height / edge) };
}

export function chunkCount(grid: ChunkGrid): number {
  return grid.cols * grid.rows;
}

/** Which chunk tile `(x, y)` is in. */
export function chunkOfTile(grid: ChunkGrid, x: number, y: number): number {
  return Math.floor(y / grid.edge) * grid.cols + Math.floor(x / grid.edge);
}

/** Which chunk a point in TILE units falls in, clamped to the map (a tree on the last tile's far
 *  edge, or a clump member a hair off the map, belongs to the nearest chunk). Only an assignment:
 *  a chunk's bounding sphere is measured from what it holds, so a misfiled instance costs
 *  culling efficiency and never correctness. */
export function chunkOfPoint(grid: ChunkGrid, x: number, z: number): number {
  const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.edge)));
  const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor(z / grid.edge)));
  return cy * grid.cols + cx;
}

/** A chunk's tile rectangle, `[x0, x1) x [y0, y1)`, clipped to the map. */
export function chunkTiles(grid: ChunkGrid, chunk: number): { x0: number; y0: number; x1: number; y1: number } {
  const cx = chunk % grid.cols;
  const cy = (chunk - cx) / grid.cols;
  return {
    x0: cx * grid.edge,
    y0: cy * grid.edge,
    x1: Math.min(grid.width, (cx + 1) * grid.edge),
    y1: Math.min(grid.height, (cy + 1) * grid.edge),
  };
}

/** The chunks holding at least one marked tile, ascending. */
export function chunksTouching(grid: ChunkGrid, tiles: Uint8Array): number[] {
  if (tiles.length !== grid.width * grid.height) {
    throw new Error(`chunksTouching: mask is ${tiles.length} tiles, map is ${grid.width * grid.height}`);
  }
  const out: number[] = [];
  for (let c = 0; c < chunkCount(grid); c++) {
    const { x0, y0, x1, y1 } = chunkTiles(grid, c);
    let hit = false;
    for (let y = y0; y < y1 && !hit; y++) {
      for (let x = x0; x < x1; x++) {
        if (tiles[y * grid.width + x] !== 0) {
          hit = true;
          break;
        }
      }
    }
    if (hit) out.push(c);
  }
  return out;
}

const ATTRIBUTES = [
  ['positions', 3],
  ['colors', 3],
  ['normals', 3],
  ['wallAlbedo', 1],
  ['groundUv', 2],
] as const;

/**
 * Chunk `chunk` of `tiled`: its tiles' vertices and triangles, in the whole-map build's own order
 * (row-major within the chunk), copied float for float, with each index shifted to the chunk's own
 * vertices. Null when the chunk draws nothing at all.
 *
 * A chunk row is a contiguous run of tiles in the row-major build, so each row moves with one
 * `set` per attribute.
 */
export function sliceChunk(
  tiled: TiledMeshData,
  grid: ChunkGrid,
  chunk: number,
  /** Applied to every colour component as it is copied (GH-920 B5: the linear conversion, so the chunk is
   *  sliced straight into the array the GPU reads and the transient sRGB copy never exists). Absent: copied as is. */
  mapColor?: (c: number) => number
): MeshData | null {
  if (tiled.width !== grid.width || tiled.height !== grid.height) {
    throw new Error(`sliceChunk: mesh is ${tiled.width}x${tiled.height}, grid is ${grid.width}x${grid.height}`);
  }
  const { x0, y0, x1, y1 } = chunkTiles(grid, chunk);
  let vertexCount = 0;
  let indexCount = 0;
  for (let y = y0; y < y1; y++) {
    const first = y * grid.width + x0;
    const end = y * grid.width + x1;
    vertexCount += tiled.vertexStart[end] - tiled.vertexStart[first];
    indexCount += tiled.indexStart[end] - tiled.indexStart[first];
  }
  if (indexCount === 0) return null;

  const names = ATTRIBUTES.filter(([name]) => tiled.mesh[name] !== undefined);
  const out: MeshData = {
    positions: new Float32Array(vertexCount * 3),
    colors: new Float32Array(vertexCount * 3),
    indices: new Uint32Array(indexCount),
  };
  for (const [name, size] of names) if (name !== 'positions' && name !== 'colors') out[name] = new Float32Array(vertexCount * size);

  let outV = 0;
  let outI = 0;
  for (let y = y0; y < y1; y++) {
    const first = y * grid.width + x0;
    const end = y * grid.width + x1;
    const v0 = tiled.vertexStart[first];
    const v1 = tiled.vertexStart[end];
    const i0 = tiled.indexStart[first];
    const i1 = tiled.indexStart[end];
    for (const [name, size] of names) {
      const src = tiled.mesh[name] as Float32Array;
      if (name === 'colors' && mapColor !== undefined) {
        const dst = out.colors;
        for (let k = v0 * size, o = outV * size; k < v1 * size; k++, o++) dst[o] = mapColor(src[k]);
        continue;
      }
      (out[name] as Float32Array).set(src.subarray(v0 * size, v1 * size), outV * size);
    }
    const shift = outV - v0;
    for (let k = i0; k < i1; k++) out.indices[outI + (k - i0)] = tiled.mesh.indices[k] + shift;
    outV += v1 - v0;
    outI += i1 - i0;
  }
  return out;
}
