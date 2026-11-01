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
 */
import * as THREE from 'three';
import { freezeStatic } from '../static-matrix';
import { chunkCount, chunkGridFor, chunksTouching, sliceChunk, type ChunkGrid } from './chunks';
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
    private readonly toGeo: (data: MeshData) => THREE.BufferGeometry,
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
      return 1;
    }
    if (dirty === null || !same || this.grid === null) {
      this.clear();
      this.grid = grid;
      this.built = { width: tiled.width, height: tiled.height };
      this.parent.add(this.container);
      this.meshes = new Array<THREE.Mesh | null>(chunkCount(grid)).fill(null);
      for (let c = 0; c < this.meshes.length; c++) this.meshes[c] = this.place(sliceChunk(tiled, grid, c), this.container);
      return this.meshes.length;
    }
    const touched = chunksTouching(grid, dirty);
    for (const c of touched) {
      const old = this.meshes[c];
      if (old !== null) {
        this.container.remove(old);
        old.geometry.dispose();
      }
      this.meshes[c] = this.place(sliceChunk(tiled, grid, c), this.container);
    }
    return touched.length;
  }

  dispose(): void {
    this.clear();
    this.meshes = [];
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

  private place(data: MeshData | null, into: THREE.Object3D): THREE.Mesh | null {
    if (data === null) return null;
    const mesh = freezeStatic(new THREE.Mesh(this.toGeo(data), this.material));
    mesh.receiveShadow = this.receiveShadow;
    into.add(mesh);
    return mesh;
  }
}
