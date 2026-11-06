/**
 * A terrain layer (the ground, the scatter) as a group of chunk meshes, kept in step with the
 * whole-map tiled build it is cut from -- the scene-graph half of `chunks.ts`, whose top comment
 * says what a chunk is and why a seam cannot open.
 *
 * Two behaviours, chosen by `chunkGridFor`:
 *
 *  - a map that stays whole (every 48 x 48 map): ONE mesh from `toGeo(tiled.mesh)`, rebuilt on
 *    every update, exactly the mesh `rebuildTerrain` always built;
 *  - a chunked map: one mesh per non-empty chunk. A full update builds them all. An update that
 *    names the tiles a splice re-emitted (`dirty`, from `composeTerrainFrom`) rebuilds only the
 *    chunks holding one, and leaves every other chunk's mesh, geometry and GPU buffers alone -- so
 *    a building collapse re-uploads a few chunks where it used to re-upload the map. A tile a
 *    splice COPIED is byte-identical to what the last build held, and a chunk's mesh is a function
 *    of its tiles' bytes alone, so skipping it is exact, not approximate.
 *
 * Every mesh is frozen static (`static-matrix.ts`) and frustum-culled by three's default bounding
 * sphere, which is now measured over the chunk's own vertices.
 *
 * ROW BANDS (GH-913). A chunk survives three's test when its sphere reaches the screen, and is then
 * drawn WHOLE: at Rujm's centre a view that needs 1,481 tiles drew 6,144. A chunk's index buffer is its
 * tile rows in order (`sliceChunk`), so each row is one contiguous index range, and `cullRows` narrows
 * the geometry's draw range to the rows (first to last) whose own vertex box reaches the camera
 * frustum. No draw call is added and no vertex moves; a dropped row had no vertex inside the frustum, so
 * not one pixel changes. `resetRows` restores the full range for any camera that is not the frame's own
 * (the ground photograph).
 */
import * as THREE from 'three';
import { freezeStatic } from '../static-matrix';
import { chunkCount, chunkGridFor, chunksTouching, chunkTiles, sliceChunk, type ChunkGrid } from './chunks';
import { srgbToLinearByte, type GeometryOptions } from './mesh';
import type { TiledMeshData } from './tiled-mesh';
import type { MeshData } from './types';

export class ChunkedMeshLayer {
  /** Holds the chunk meshes of a chunked map; never in the scene on a map left whole. */
  private readonly container: THREE.Group;
  private grid: ChunkGrid | null = null;
  /** Indexed by chunk; a chunk that draws nothing holds null. One entry when the map is whole. */
  private meshes: (THREE.Mesh | null)[] = [];
  /** The map the current meshes were cut from, so a different one rebuilds everything. */
  private built: { width: number; height: number } | null = null;
  /** Per chunk (parallel to `meshes`): its row bands, or null for a chunk that draws nothing or a whole map. */
  private bands: (RowBands | null)[] = [];
  /** The view-projection the draw ranges were last cut for (NaN when none is). */
  private readonly cutFor = new Float32Array(16).fill(NaN);
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly box = new THREE.Box3();

  /**
   * `parent` is the scene. A map left whole puts its ONE mesh straight into `parent`, exactly where
   * `rebuildTerrain` always put it (the scene-graph census `theme-identity.test.ts` pins would see an
   * extra `Group` otherwise); a chunked map puts a group there and the chunk meshes in it.
   */
  constructor(
    private readonly parent: THREE.Object3D,
    name: string,
    private readonly material: THREE.Material,
    private readonly receiveShadow: boolean,
    private readonly toGeo: (data: MeshData, opts?: GeometryOptions) => THREE.BufferGeometry,
    /** Which grid a map gets; the game's rule unless a spec or the census says otherwise. */
    private readonly gridFor: (width: number, height: number) => ChunkGrid | null = (w, h) => chunkGridFor(w, h, 'ground')
  ) {
    this.container = freezeStatic(new THREE.Group());
    this.container.name = name;
  }

  /** What is in the scene for this layer: the mesh of a whole map, the group of a chunked one; null
   *  before the first update. Visibility, labels and the memory inventory hang off it. */
  get root(): THREE.Object3D | null {
    if (this.built === null) return null;
    return this.grid === null ? this.meshes[0] : this.container;
  }

  /** How many chunk meshes the layer holds. */
  get meshCount(): number {
    let n = 0;
    for (const m of this.meshes) if (m !== null) n++;
    return n;
  }

  /** The meshes themselves (specs and the census). */
  get chunkMeshes(): readonly THREE.Mesh[] {
    return this.meshes.filter((m): m is THREE.Mesh => m !== null);
  }

  /**
   * Brings the layer to `tiled`. `dirty` is the tiles a splice re-emitted since the last call, or
   * null when everything may have changed (a full build). Returns the chunks it rebuilt.
   */
  update(tiled: TiledMeshData, dirty: Uint8Array | null): number {
    const grid = this.gridFor(tiled.width, tiled.height);
    const same = this.built !== null && this.built.width === tiled.width && this.built.height === tiled.height;
    if (grid === null) {
      this.clear();
      this.grid = null;
      this.built = { width: tiled.width, height: tiled.height };
      this.meshes = [this.place(tiled.mesh, this.parent)];
      this.bands = [null];
      return 1;
    }
    if (dirty === null || !same || this.grid === null) {
      this.clear();
      this.grid = grid;
      this.built = { width: tiled.width, height: tiled.height };
      this.parent.add(this.container);
      this.meshes = new Array<THREE.Mesh | null>(chunkCount(grid)).fill(null);
      this.bands = new Array<RowBands | null>(chunkCount(grid)).fill(null);
      for (let c = 0; c < this.meshes.length; c++) {
        this.meshes[c] = this.place(sliceChunk(tiled, grid, c, srgbToLinearByte), this.container, true);
        this.bands[c] = this.meshes[c] === null ? null : rowBandsOf(tiled, grid, c);
      }
      this.cutFor.fill(NaN);
      return this.meshes.length;
    }
    const touched = chunksTouching(grid, dirty);
    for (const c of touched) {
      const old = this.meshes[c];
      if (old !== null) {
        this.container.remove(old);
        old.geometry.dispose();
      }
      this.meshes[c] = this.place(sliceChunk(tiled, grid, c, srgbToLinearByte), this.container, true);
      this.bands[c] = this.meshes[c] === null ? null : rowBandsOf(tiled, grid, c);
    }
    this.cutFor.fill(NaN);
    return touched.length;
  }

  /**
   * Narrows every chunk's draw range to the rows that reach `camera`'s frustum. Call once a frame, after
   * the camera's matrices are final and before anything renders with it. A no-op on a map left whole, and
   * when the camera has not moved since the last cut (`update` and `resetRows` forget the cut).
   */
  cullRows(camera: THREE.Camera): void {
    if (this.grid === null) return;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = this.projScreen.elements;
    let same = true;
    for (let i = 0; i < 16; i++) {
      if (this.cutFor[i] !== e[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
    for (let i = 0; i < 16; i++) this.cutFor[i] = e[i];
    this.frustum.setFromProjectionMatrix(this.projScreen, camera.coordinateSystem, camera.reversedDepth);
    for (let c = 0; c < this.meshes.length; c++) {
      const mesh = this.meshes[c];
      const b = this.bands[c];
      if (mesh === null || b === null) continue;
      let first = -1;
      let last = -1;
      for (let r = 0; r < b.rows; r++) {
        if (b.count[r] === 0) continue;
        this.box.min.set(b.box[r * 6] - PAD, b.box[r * 6 + 1] - PAD, b.box[r * 6 + 2] - PAD);
        this.box.max.set(b.box[r * 6 + 3] + PAD, b.box[r * 6 + 4] + PAD, b.box[r * 6 + 5] + PAD);
        if (!this.frustum.intersectsBox(this.box)) continue;
        if (first < 0) first = r;
        last = r;
      }
      if (first < 0) mesh.geometry.setDrawRange(0, 0);
      else mesh.geometry.setDrawRange(b.start[first], b.start[last] + b.count[last] - b.start[first]);
    }
  }

  /** Every chunk back to its full draw range (a camera that is not the frame's own is about to render). */
  resetRows(): void {
    for (const m of this.meshes) m?.geometry.setDrawRange(0, Infinity);
    this.cutFor.fill(NaN);
  }

  /** Indices the layer submits for one draw of every chunk, as the draw ranges stand (specs and the census). */
  get drawnIndexCount(): number {
    let n = 0;
    for (const m of this.meshes) {
      if (m === null) continue;
      const total = m.geometry.getIndex()?.count ?? 0;
      n += Math.min(total - m.geometry.drawRange.start, m.geometry.drawRange.count);
    }
    return n;
  }

  dispose(): void {
    this.clear();
    this.meshes = [];
    this.bands = [];
    this.built = null;
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      if (mesh === null) continue;
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes = [];
    this.parent.remove(this.container);
  }

  /** `linear`: `data.colors` was sliced straight into linear (`sliceChunk`'s `mapColor`), so the geometry wraps it. */
  private place(data: MeshData | null, into: THREE.Object3D, linear = false): THREE.Mesh | null {
    if (data === null) return null;
    const mesh = freezeStatic(new THREE.Mesh(this.toGeo(data, linear ? { colorsLinear: true } : undefined), this.material));
    mesh.receiveShadow = this.receiveShadow;
    into.add(mesh);
    return mesh;
  }
}

/** World units a row's box is grown by before the frustum test: float slack, nothing the eye can use. */
const PAD = 0.05;

/** One chunk's rows: `start`/`count` are index ranges in the chunk's own index buffer, `box` six floats a row
 *  (min xyz, max xyz) over the vertices the row's tiles own. */
interface RowBands {
  readonly rows: number;
  readonly start: Uint32Array;
  readonly count: Uint32Array;
  readonly box: Float32Array;
}

function rowBandsOf(tiled: TiledMeshData, grid: ChunkGrid, chunk: number): RowBands {
  const { x0, y0, x1, y1 } = chunkTiles(grid, chunk);
  const rows = y1 - y0;
  const start = new Uint32Array(rows);
  const count = new Uint32Array(rows);
  const box = new Float32Array(rows * 6);
  const pos = tiled.mesh.positions;
  let at = 0;
  for (let r = 0; r < rows; r++) {
    const first = (y0 + r) * grid.width + x0;
    const end = (y0 + r) * grid.width + x1;
    start[r] = at;
    count[r] = tiled.indexStart[end] - tiled.indexStart[first];
    at += count[r];
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let k = tiled.vertexStart[first] * 3, e = tiled.vertexStart[end] * 3; k < e; k += 3) {
      const x = pos[k];
      const y = pos[k + 1];
      const z = pos[k + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    box.set([minX, minY, minZ, maxX, maxY, maxZ], r * 6);
  }
  return { rows, start, count, box };
}
