/**
 * A terrain mesh built TILE BY TILE, and the splice that rebuilds only some
 * of its tiles -- what lets a building collapse redraw the ground and scatter
 * around its own footprint instead of the whole map.
 *
 * `buildGround` and `buildScatter` were always tile loops in row-major order,
 * each tile appending its own vertices and triangles and reading nothing a
 * previous tile wrote. That is the whole precondition: if a tile's output is
 * a function of the map's inputs near it and of nothing else, then the full
 * mesh is the concatenation of every tile's output, with each tile's indices
 * offset by the vertices before it -- and a tile whose inputs did not change
 * produces the same output, so it can be COPIED from the last build, its
 * indices shifted by however many vertices the tiles in front of it gained or
 * lost.
 *
 * So the splice is exact, not approximate: a copied tile's floats are the
 * very float32 values the full build would round its numbers to, a
 * recomputed tile runs the same emitter the full build runs, and the two meet
 * at integer index offsets. `packages/app/src/terrain-splice.test.ts` holds the spliced mesh
 * byte-equal to a fresh full build after real collapses on shipped maps.
 *
 * What it rests on, and what breaks it: an emitter must push its indices as
 * `positions.length / 3 + k` -- relative to the vertices already in the sink
 * -- and must read no state carried from one tile to the next. Both builders
 * do today; a later change that, say, merged duplicate vertices ACROSS tiles
 * would break the first, and `packages/app/src/terrain-splice.test.ts` would go red.
 */
import type { MeshData } from './types';

/** Where one tile's triangles go. The optional arrays are present exactly
 *  when the builder emits that attribute (the ground does, scatter does not),
 *  and an emitter must push the same number of entries into each per vertex
 *  as `MESH_ATTRIBUTES` says. */
export interface TileSink {
  positions: number[];
  colors: number[];
  indices: number[];
  normals?: number[];
  wallAlbedo?: number[];
  groundUv?: number[];
}

/** One tile's geometry, appended to `sink`. */
export type TileEmitter = (sink: TileSink, x: number, y: number) => void;

/** A `MeshData` plus where each tile's vertices and indices start: tile `t`
 *  owns vertices `[vertexStart[t], vertexStart[t + 1])` and indices
 *  `[indexStart[t], indexStart[t + 1])`. Both arrays are `width * height + 1`
 *  long. */
export interface TiledMeshData {
  readonly mesh: MeshData;
  readonly width: number;
  readonly height: number;
  readonly vertexStart: Uint32Array;
  readonly indexStart: Uint32Array;
}

type AttributeName = 'positions' | 'colors' | 'normals' | 'wallAlbedo' | 'groundUv';

/** Every per-vertex array a terrain `MeshData` can carry, with its item
 *  size. */
const MESH_ATTRIBUTES: readonly (readonly [AttributeName, number])[] = [
  ['positions', 3],
  ['colors', 3],
  ['normals', 3],
  ['wallAlbedo', 1],
  ['groundUv', 2],
];

function emptySink(optional: readonly AttributeName[]): TileSink {
  const sink: TileSink = { positions: [], colors: [], indices: [] };
  for (const name of optional) {
    if (name === 'normals') sink.normals = [];
    else if (name === 'wallAlbedo') sink.wallAlbedo = [];
    else if (name === 'groundUv') sink.groundUv = [];
  }
  return sink;
}

/**
 * The full build: every tile through `emit`, in row-major order, into one
 * sink -- exactly the loop `buildGround`/`buildScatter` always ran -- with
 * each tile's start recorded on the way.
 *
 * `optional` names the attributes beyond positions/colors/indices this
 * builder emits; the returned mesh carries those and no others.
 */
export function buildTiledMesh(
  width: number,
  height: number,
  optional: readonly AttributeName[],
  emit: TileEmitter
): TiledMeshData {
  const n = width * height;
  const sink = emptySink(optional);
  const vertexStart = new Uint32Array(n + 1);
  const indexStart = new Uint32Array(n + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      vertexStart[t] = sink.positions.length / 3;
      indexStart[t] = sink.indices.length;
      emit(sink, x, y);
    }
  }
  vertexStart[n] = sink.positions.length / 3;
  indexStart[n] = sink.indices.length;
  const mesh: MeshData = {
    positions: Float32Array.from(sink.positions),
    colors: Float32Array.from(sink.colors),
    indices: Uint32Array.from(sink.indices),
  };
  for (const name of optional) {
    const values = sink[name];
    if (values) mesh[name] = Float32Array.from(values);
  }
  return { mesh, width, height, vertexStart, indexStart };
}

/**
 * `prev` with every tile `dirty` marks re-emitted through `emit`, and every
 * other tile copied. Byte-identical to `buildTiledMesh(..., emit)` over the
 * inputs `emit` now reads, PROVIDED every tile whose output those inputs
 * changed is marked -- choosing that set is the caller's job
 * (`incremental.ts`), and the margin it dilates by is what the tests probe.
 */
export function spliceTiledMesh(prev: TiledMeshData, dirty: Uint8Array, emit: TileEmitter): TiledMeshData {
  const { width, height } = prev;
  const n = width * height;
  if (dirty.length !== n) throw new Error(`spliceTiledMesh: dirty mask is ${dirty.length} tiles, mesh is ${n}`);
  const optional = MESH_ATTRIBUTES.map(([name]) => name).filter(
    (name) => name !== 'positions' && name !== 'colors' && prev.mesh[name] !== undefined
  );

  // Pass 1: emit every dirty tile into its own sink (local indices from 0),
  // and size the output.
  const fresh = new Map<number, TileSink>();
  let vertexCount = 0;
  let indexCount = 0;
  const vertexStart = new Uint32Array(n + 1);
  const indexStart = new Uint32Array(n + 1);
  for (let t = 0; t < n; t++) {
    vertexStart[t] = vertexCount;
    indexStart[t] = indexCount;
    if (dirty[t] !== 0) {
      const sink = emptySink(optional);
      emit(sink, t % width, (t - (t % width)) / width);
      fresh.set(t, sink);
      vertexCount += sink.positions.length / 3;
      indexCount += sink.indices.length;
    } else {
      vertexCount += prev.vertexStart[t + 1] - prev.vertexStart[t];
      indexCount += prev.indexStart[t + 1] - prev.indexStart[t];
    }
  }
  vertexStart[n] = vertexCount;
  indexStart[n] = indexCount;

  // Pass 2: fill. A run of clean tiles is one contiguous block in both
  // meshes, so it moves with one `set` per attribute; only its indices need
  // touching, shifted by how far the run moved.
  const mesh: MeshData = {
    positions: new Float32Array(vertexCount * 3),
    colors: new Float32Array(vertexCount * 3),
    indices: new Uint32Array(indexCount),
  };
  for (const name of optional) mesh[name] = new Float32Array(vertexCount * itemSize(name));
  const names: AttributeName[] = ['positions', 'colors', ...optional];

  let t = 0;
  while (t < n) {
    if (dirty[t] === 0) {
      let end = t;
      while (end < n && dirty[end] === 0) end++;
      const v0 = prev.vertexStart[t];
      const v1 = prev.vertexStart[end];
      const i0 = prev.indexStart[t];
      const i1 = prev.indexStart[end];
      const outV = vertexStart[t];
      const outI = indexStart[t];
      for (const name of names) {
        const size = itemSize(name);
        const src = prev.mesh[name] as Float32Array;
        (mesh[name] as Float32Array).set(src.subarray(v0 * size, v1 * size), outV * size);
      }
      const shift = outV - v0;
      if (shift === 0) {
        mesh.indices.set(prev.mesh.indices.subarray(i0, i1), outI);
      } else {
        for (let k = i0; k < i1; k++) mesh.indices[outI + (k - i0)] = prev.mesh.indices[k] + shift;
      }
      t = end;
      continue;
    }
    const sink = fresh.get(t) as TileSink;
    const outV = vertexStart[t];
    for (const name of names) {
      const size = itemSize(name);
      const values = sink[name] as number[];
      const dst = mesh[name] as Float32Array;
      const at = outV * size;
      for (let k = 0; k < values.length; k++) dst[at + k] = values[k];
    }
    const outI = indexStart[t];
    for (let k = 0; k < sink.indices.length; k++) mesh.indices[outI + k] = sink.indices[k] + outV;
    t++;
  }
  return { mesh, width, height, vertexStart, indexStart };
}

function itemSize(name: AttributeName): number {
  for (const [n, size] of MESH_ATTRIBUTES) if (n === name) return size;
  throw new Error(`unknown terrain attribute ${name}`);
}

/** `mask` grown by `radius` tiles in every direction (a Chebyshev square),
 *  clipped to the map. */
export function dilateTileMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let yy = y0; yy <= y1; yy++) out.fill(1, yy * width + x0, yy * width + x1 + 1);
    }
  }
  return out;
}
