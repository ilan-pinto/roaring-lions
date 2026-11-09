/**
 * Per-tile structures drawn INSTANCED (GH-974, design decision 7): one
 * `InstancedMesh` per (structure type, template mesh, damage state) instead of
 * one cloned mesh group per tile.
 *
 * Why. A `per_tile` run (wall, fence, HESCO, T-wall, sandbag wall and post) is
 * one structure PER TILE. Each tile was a `template.root.clone(true)`: every
 * primitive of the GLB a mesh of its own, so a wall tile cost two draw calls in
 * the colour pass and again in the shadow pass and the AO pre-pass. The staged
 * Milh Flats (large) redo has 172 of them: 744 calls and about 2.9 ms in the
 * town view, against a +0.5 ms bar (PR 996). A run draws the same geometry with
 * the same materials, differing only in a matrix, which is exactly what an
 * instanced draw is for.
 *
 * What stays the same, deliberately:
 *   - The MATERIALS are the template's own (and the memoised scar clones of
 *     `building-damage.ts`), so colour, roughness, the environment class and the
 *     cold-texture decode all reach the instanced draw untouched.
 *   - `renderOrder` is `WORLD_RENDER_ORDER` and shadows are cast and received,
 *     as `buildBuildingMeshTemplate` sets on the originals.
 *   - A destroyed tile leaves the idle instance set and joins the WRECK set (the
 *     `_wreck` template's own instanced meshes) with its yaw and fit; a tile at a
 *     scarred damage band moves to that band's set. Sets are packed densely
 *     (`count` is the number drawn), so a hidden tile costs nothing and there is
 *     no zero-scale matrix to render.
 *   - The instance matrix is the root matrix, the clone's own world matrix (its
 *     meshes sit at the root's frame, `instanceableTemplate`), so a tile lands
 *     where it did.
 *
 * Culling is the WHOLE set's bounding sphere, not per instance. A run's tiles
 * are a few thousand triangles each; per-instance culling was measured to cost
 * more than it saves on ANGLE/Metal (`terrain-rendering.md`, the decor
 * BatchedMeshes), so this does not add it.
 *
 * A template can be instanced only if every one of its meshes sits at the
 * root's own frame (identity part matrix). That is true of every shipped
 * per-tile GLB and is checked (`partsOf`), because three.js derives an
 * instance's normal matrix per axis and a rotated part under a non-uniform fit
 * would shear its lighting. A template that fails the check keeps the clone
 * path; the caller asks `instanceableTemplate`.
 *
 * LOD1 (GH-974). A type may also register a lower-detail TWIN of its standing
 * template (`setIdleLod1`: the compound wall's 310-triangle `wall_lod1`, against
 * 3,087). Below `STRUCTURE_LOD1_BELOW_ZOOM` the twin is what is drawn, because
 * none of the full art's relief is visible at that distance. The swap is made at
 * FRAME level, never per tile: a clean standing tile is a member of both its
 * full set and its twin set, and `setZoom` decides which of the two sets is
 * visible, so the draw count stays one per set. Only clean (state 0) standing
 * tiles have a twin set: a scarred tile and a wreck keep the full geometry (they
 * are few, and their materials are clones the twin has no part of). The twin
 * ships no material: it is drawn with the FULL template's own material for the
 * same role, and its UV0 samples that bake (`tools/buildings/author_wall_lod1.py`).
 *
 * Presentation only: nothing here reads or writes sim state.
 */
import * as THREE from 'three';
import type { BuildingMeshTemplate } from './mesh-building';
import { WORLD_RENDER_ORDER } from './render-order';
import { CHUNKED_ABOVE_TILES } from '../terrain/chunks';

/** One mesh of a template: what an instanced set draws. */
export interface InstancePart {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  /** The template mesh's matrix in the root's frame: identity for every
   *  shipped per-tile GLB, and required to be (`instanceableTemplate`), since an
   *  instance is the root's matrix alone. */
  readonly rel: THREE.Matrix4;
}

const IDENTITY_EPSILON = 1e-6;

/** Below this camera zoom a type's LOD1 twin is drawn instead of its full art
 *  (same pattern as `terrain/backdrop-kit.ts`'s `LOD1_BELOW_ZOOM`: by zoom band,
 *  never by distance). */
export const STRUCTURE_LOD1_BELOW_ZOOM = 2.0;

/** Zoom headroom above the band before a twin hands back to the full art, so a
 *  zoom held at the boundary does not flicker between them. */
export const STRUCTURE_LOD1_HYSTERESIS = 0.05;

/**
 * Is the twin drawn at `zoom`, given whether it was drawn last frame? Entering
 * is strict (`zoom < 2.0`: at exactly 2.0 the full art is drawn); leaving waits
 * for `zoom >= 2.0 + hysteresis`, so the band between is held by `wasActive`.
 */
export function lod1Active(zoom: number, wasActive: boolean): boolean {
  return zoom < (wasActive ? STRUCTURE_LOD1_BELOW_ZOOM + STRUCTURE_LOD1_HYSTERESIS : STRUCTURE_LOD1_BELOW_ZOOM);
}

const roleOf = (mesh: THREE.Mesh): string => {
  const r = (mesh.userData as { rl_role?: unknown }).rl_role;
  return typeof r === 'string' && r.length > 0 ? r : mesh.name;
};
/** A chunk's sets start small: a chunk holds a handful of one run's tiles. */
const CHUNK_FIRST_CAPACITY = 8;

/** Every mesh of `template` with its matrix in the root's frame. */
export function partsOf(template: BuildingMeshTemplate): InstancePart[] {
  const root = template.root;
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const parts: InstancePart[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.push({ mesh, geometry: mesh.geometry, rel: new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld) });
  });
  return parts;
}

/** True when `template` has at least one mesh and every mesh is at the root's
 *  own frame, so an instance of it is the root matrix alone. */
export function instanceableTemplate(template: BuildingMeshTemplate): boolean {
  const parts = partsOf(template);
  if (parts.length === 0) return false;
  const identity = new THREE.Matrix4();
  return parts.every((p) => p.rel.elements.every((v, i) => Math.abs(v - identity.elements[i]) < IDENTITY_EPSILON));
}

/**
 * One instanced mesh, packed densely: slot `i` of `keys` owns instance `i`.
 * Removing swaps the last instance into the hole. Grows by replacing its mesh.
 */
export class InstanceSet {
  mesh: THREE.InstancedMesh;
  private keys: number[] = [];
  private readonly slotOf = new Map<number, number>();
  private capacity: number;
  private dirty = false;

  constructor(
    private readonly part: InstancePart,
    private readonly material: THREE.Material,
    private readonly scene: THREE.Object3D,
    capacity: number
  ) {
    this.capacity = Math.max(4, capacity);
    this.mesh = this.build(this.capacity);
    this.scene.add(this.mesh);
  }

  private build(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.part.geometry, this.material, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = WORLD_RENDER_ORDER;
    // A set never moves as a whole: its instances carry the transforms.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    return mesh;
  }

  get count(): number {
    return this.keys.length;
  }

  has(key: number): boolean {
    return this.slotOf.has(key);
  }

  /** Adds (or re-places) `key` at the root matrix `root`. */
  set(key: number, root: THREE.Matrix4): void {
    let slot = this.slotOf.get(key);
    if (slot === undefined) {
      if (this.keys.length >= this.capacity) this.grow();
      slot = this.keys.length;
      this.keys.push(key);
      this.slotOf.set(key, slot);
      this.mesh.count = this.keys.length;
    }
    // The part sits at the root's own frame (`instanceableTemplate`), so the instance IS the root matrix.
    this.mesh.setMatrixAt(slot, root);
    this.dirty = true;
  }

  remove(key: number): boolean {
    const slot = this.slotOf.get(key);
    if (slot === undefined) return false;
    const last = this.keys.length - 1;
    if (slot !== last) {
      const moved = this.keys[last];
      const arr = this.mesh.instanceMatrix.array as Float32Array;
      arr.copyWithin(slot * 16, last * 16, last * 16 + 16);
      this.keys[slot] = moved;
      this.slotOf.set(moved, slot);
    }
    this.keys.pop();
    this.slotOf.delete(key);
    this.mesh.count = this.keys.length;
    this.dirty = true;
    return true;
  }

  private grow(): void {
    const old = this.mesh;
    this.capacity *= 2;
    const next = this.build(this.capacity);
    (next.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, this.keys.length * 16));
    next.count = this.keys.length;
    this.scene.remove(old);
    old.dispose();
    this.mesh = next;
    this.scene.add(next);
    this.dirty = true;
  }

  /** Uploads what changed and refreshes the culling sphere and visibility. */
  flush(hidden: boolean): void {
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      // The sphere is built from the matrices, lazily, once it is null.
      this.mesh.boundingSphere = null;
      this.dirty = false;
    }
    this.mesh.visible = !hidden && this.keys.length > 0;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.keys.length = 0;
    this.slotOf.clear();
  }
}

/** The key of a state's set: `0` is the clean template, `1..5` a scar band. */
type StateKey = number;

/** Tiles to a culling chunk (a side). A run's instances are split into square
 *  chunks of the map, one set each, so a view that cannot see a chunk does not
 *  pay for its triangles: the whole-map draw it replaces was culled tile by
 *  tile. 16 is the middle of the ground chunk (32) and the ditch chunk (8)
 *  (`terrain/chunks.ts`); a 48x48 map is nine chunks at most. */
export const STRUCTURE_CHUNK_TILES = 16;

/** The chunk edge on a map above `CHUNKED_ABOVE_TILES` (80x80 Rujm Sawda): the GROUND chunk's edge, so a
 *  wall set is one per ground chunk. Each chunk's sets are one draw per template mesh per pass (colour,
 *  shadow, AO), so at 16 a wall-heavy 80x80 centre view drew ~13 chunks = 56 calls for 0.75 ms, of which
 *  triangles were ~0.1 ms (GH-974, `_coord/rujm-open-redo/attribution.md`). */
export const STRUCTURE_CHUNK_TILES_LARGE = 32;

/** The chunk edge for a `width` x `height` map. A map at or under `CHUNKED_ABOVE_TILES` (every map before
 *  Rujm Sawda, 48x48) keeps 16, so its set keys, and with them the golden baselines, are byte-identical. */
export function structureChunkTilesFor(width: number, height: number): number {
  return width * height <= CHUNKED_ABOVE_TILES ? STRUCTURE_CHUNK_TILES : STRUCTURE_CHUNK_TILES_LARGE;
}

/** The set a tile belongs to: its scar state and its chunk of the map (`edge` tiles a side). */
function setKey(state: StateKey, root: THREE.Matrix4, edge: number): string {
  const cx = Math.floor(root.elements[12] / edge);
  const cz = Math.floor(root.elements[14] / edge);
  return `${state}|${cx}|${cz}`;
}

/** The scar state a `setKey` names (the key format lives here and in `setKey`, nowhere else). */
export function stateOfKey(key: string): StateKey {
  return Number(key.slice(0, key.indexOf('|')));
}

interface TypeSets {
  idleParts: InstancePart[] | null;
  wreckParts: InstancePart[] | null;
  /** Idle sets by scar state and chunk, each an array parallel to `idleParts`. */
  idle: Map<string, InstanceSet[]>;
  /** Wreck sets by chunk. */
  wreck: Map<string, InstanceSet[]>;
  /** The LOD1 twin's parts, each with the full part whose material it is drawn with. */
  lod: { readonly part: InstancePart; readonly full: InstancePart }[] | null;
  /** The twin's geometries, owned here (the template that carried them is not kept). */
  lodGeometries: THREE.BufferGeometry[];
  /** The twin's sets by chunk, clean (state 0) standing tiles only: each an array parallel to `lod`. */
  idleLod: Map<string, InstanceSet[]>;
}

interface Placed {
  typeId: string;
  root: THREE.Matrix4;
  yaw: number;
  /** The scar state an idle tile sits in; a wreck has none. */
  state: StateKey;
}

/** The per-tile structures of one renderer, instanced. */
export class StructureInstances {
  private readonly types = new Map<string, TypeSets>();
  private readonly idleOf = new Map<number, Placed>();
  private readonly wreckOf = new Map<number, Placed>();
  private hidden = false;
  private enabled = true;
  /** Is the LOD1 twin drawn this frame (`setZoom`)? */
  private lodOn = false;
  /** The A/B switch (`ThreeRenderer.debugStructureLod1`): off, the twin is never drawn. A flag `setZoom`
   *  consults every frame, so it holds. */
  private lodEnabled = true;

  constructor(
    private readonly scene: THREE.Object3D,
    /** Tiles to a chunk (a side): `structureChunkTilesFor(map)`. Fixed for the renderer's life, as a map is. */
    private readonly chunkTiles: number = STRUCTURE_CHUNK_TILES
  ) {}

  /** Does this type draw instanced (an idle template is registered for it)? */
  handles(typeId: string): boolean {
    return this.enabled && this.types.get(typeId)?.idleParts != null;
  }

  /** Does this type's wreck draw instanced? */
  handlesWreck(typeId: string): boolean {
    return this.enabled && this.types.get(typeId)?.wreckParts != null;
  }

  /** Registers `typeId`'s standing template. */
  setIdleTemplate(typeId: string, template: BuildingMeshTemplate): void {
    this.dropIdle(typeId);
    const sets = this.setsFor(typeId);
    sets.idleParts = partsOf(template);
  }

  setWreckTemplate(typeId: string, template: BuildingMeshTemplate): void {
    this.dropWreck(typeId);
    const sets = this.setsFor(typeId);
    sets.wreckParts = partsOf(template);
  }

  /**
   * Registers `typeId`'s LOD1 twin. Each of its meshes is paired, by `rl_role`,
   * with the standing template's mesh whose material it is drawn with (a one-mesh twin
   * pairs to the full art when all its parts share one material). Returns
   * false (and registers nothing) if a twin mesh has no such partner or the twin
   * is not instanceable, so the caller can say so; the type then draws full art
   * at every zoom. Call after `setIdleTemplate`, which clears any earlier twin.
   */
  setIdleLod1(typeId: string, template: BuildingMeshTemplate): boolean {
    const sets = this.types.get(typeId);
    if (!sets?.idleParts || !instanceableTemplate(template)) return false;
    const full = sets.idleParts;
    const pairs: { part: InstancePart; full: InstancePart }[] = [];
    // A ONE-mesh twin (the wall's roof and body joined, so a chunk-set costs one draw) has
    // no role of its own to pair on: it takes the full art's material when EVERY full part
    // carries the same one. A twin of several parts, or full parts of different materials,
    // still pairs strictly by role.
    const single = partsOf(template).length === 1;
    const sharedMaterial = full.length > 0 && full.every((f) => f.mesh.material === full[0].mesh.material);
    for (const part of partsOf(template)) {
      const partner =
        full.find((f) => roleOf(f.mesh) === roleOf(part.mesh)) ?? (single && sharedMaterial ? full[0] : undefined);
      if (!partner) return false;
      pairs.push({ part, full: partner });
    }
    if (pairs.length === 0) return false;
    this.dropLod(sets);
    sets.lod = pairs;
    sets.lodGeometries = pairs.map((p) => p.part.geometry);
    return true;
  }

  /** The twin's sets and geometries of one type, torn down. */
  private dropLod(sets: TypeSets): void {
    for (const list of sets.idleLod.values()) for (const set of list) set.dispose();
    sets.idleLod.clear();
    for (const g of sets.lodGeometries) g.dispose();
    sets.lodGeometries = [];
    sets.lod = null;
  }

  /** The standing set keys of `typeId` (`state|cx|cz`), sorted. A test instrument: it pins the chunking. */
  idleSetKeys(typeId: string): string[] {
    return [...(this.types.get(typeId)?.idle.keys() ?? [])].sort();
  }

  /** Does `typeId` have a LOD1 twin registered? */
  hasLod1(typeId: string): boolean {
    return this.types.get(typeId)?.lod != null;
  }

  /** Is the LOD1 twin the one drawn this frame? */
  get lod1Drawn(): boolean {
    return this.lodOn;
  }

  /** Sets this frame's zoom: decides, with hysteresis, whether the twin is the
   *  drawn art. Takes effect at the next `flush`. */
  setZoom(zoom: number): void {
    this.lodOn = this.lodEnabled && lod1Active(zoom, this.lodOn);
  }

  /** The A/B switch: false draws full art at every zoom (the pre-twin path). */
  setLod1Enabled(on: boolean): void {
    this.lodEnabled = on;
  }

  private lodSets(
    sets: TypeSets,
    root: THREE.Matrix4,
    materialFor: (mesh: THREE.Mesh, state: StateKey) => THREE.Material
  ): InstanceSet[] {
    const lod = sets.lod;
    if (!lod) return [];
    const key = setKey(0, root, this.chunkTiles);
    let list = sets.idleLod.get(key);
    if (!list) {
      list = lod.map((p) => new InstanceSet(p.part, materialFor(p.full.mesh, 0), this.scene, CHUNK_FIRST_CAPACITY));
      sets.idleLod.set(key, list);
    }
    return list;
  }

  private setsFor(typeId: string): TypeSets {
    let sets = this.types.get(typeId);
    if (!sets) {
      sets = { idleParts: null, wreckParts: null, idle: new Map(), wreck: new Map(), lod: null, lodGeometries: [], idleLod: new Map() };
      this.types.set(typeId, sets);
    }
    return sets;
  }

  hasIdle(s: number): boolean {
    return this.idleOf.has(s);
  }

  hasWreck(s: number): boolean {
    return this.wreckOf.has(s);
  }

  /** The yaw a standing tile or its wreck was placed at (undefined if none). */
  yawOf(s: number): number | undefined {
    return (this.idleOf.get(s) ?? this.wreckOf.get(s))?.yaw;
  }

  /** The scar state a standing tile sits in (0 clean). */
  stateOf(s: number): number | undefined {
    return this.idleOf.get(s)?.state;
  }

  private idleSets(
    typeId: string,
    state: StateKey,
    root: THREE.Matrix4,
    materialFor: (mesh: THREE.Mesh, state: StateKey) => THREE.Material
  ): InstanceSet[] {
    const sets = this.setsFor(typeId);
    const key = setKey(state, root, this.chunkTiles);
    let list = sets.idle.get(key);
    if (!list) {
      const parts = sets.idleParts;
      if (!parts) throw new Error(`StructureInstances: no standing template for ${typeId}`);
      list = parts.map((p) => new InstanceSet(p, materialFor(p.mesh, state), this.scene, CHUNK_FIRST_CAPACITY));
      sets.idle.set(key, list);
    }
    return list;
  }

  /** Stands a tile up at `root` (the matrix its clone's root would have). */
  addIdle(
    s: number,
    typeId: string,
    root: THREE.Matrix4,
    yaw: number,
    materialFor: (mesh: THREE.Mesh, state: StateKey) => THREE.Material
  ): void {
    for (const set of this.idleSets(typeId, 0, root, materialFor)) set.set(s, root);
    for (const set of this.lodSets(this.setsFor(typeId), root, materialFor)) set.set(s, root);
    this.idleOf.set(s, { typeId, root: root.clone(), yaw, state: 0 });
  }

  /** Moves a standing tile to `state`'s set (a scar band). No-op if there. */
  setIdleState(s: number, state: StateKey, materialFor: (mesh: THREE.Mesh, state: StateKey) => THREE.Material): void {
    const placed = this.idleOf.get(s);
    if (!placed || placed.state === state) return;
    const sets = this.types.get(placed.typeId);
    if (!sets) return;
    for (const set of sets.idle.get(setKey(placed.state, placed.root, this.chunkTiles)) ?? []) set.remove(s);
    // The twin holds clean tiles only: a scarred tile draws full art in its scar material.
    if (placed.state === 0) for (const set of sets.idleLod.get(setKey(0, placed.root, this.chunkTiles)) ?? []) set.remove(s);
    for (const set of this.idleSets(placed.typeId, state, placed.root, materialFor)) set.set(s, placed.root);
    if (state === 0) for (const set of this.lodSets(sets, placed.root, materialFor)) set.set(s, placed.root);
    placed.state = state;
  }

  removeIdle(s: number): boolean {
    const placed = this.idleOf.get(s);
    if (!placed) return false;
    const sets = this.types.get(placed.typeId);
    for (const set of sets?.idle.get(setKey(placed.state, placed.root, this.chunkTiles)) ?? []) set.remove(s);
    if (placed.state === 0) for (const set of sets?.idleLod.get(setKey(0, placed.root, this.chunkTiles)) ?? []) set.remove(s);
    this.idleOf.delete(s);
    return true;
  }

  addWreck(s: number, typeId: string, root: THREE.Matrix4, yaw: number): void {
    const sets = this.setsFor(typeId);
    if (!sets.wreckParts) throw new Error(`StructureInstances: no wreck template for ${typeId}`);
    const key = setKey(0, root, this.chunkTiles);
    let list = sets.wreck.get(key);
    if (!list) {
      list = sets.wreckParts.map((p) => new InstanceSet(p, p.mesh.material as THREE.Material, this.scene, CHUNK_FIRST_CAPACITY));
      sets.wreck.set(key, list);
    }
    for (const set of list) set.set(s, root);
    this.wreckOf.set(s, { typeId, root: root.clone(), yaw, state: 0 });
  }

  /** Re-places a wreck (its settle grows it in). */
  setWreckRoot(s: number, root: THREE.Matrix4): void {
    const placed = this.wreckOf.get(s);
    if (!placed) return;
    placed.root.copy(root);
    // A settle only scales the pile's height: x and z, and so its chunk, do not move.
    for (const set of this.types.get(placed.typeId)?.wreck.get(setKey(0, root, this.chunkTiles)) ?? []) set.set(s, root);
  }

  removeWreck(s: number): boolean {
    const placed = this.wreckOf.get(s);
    if (!placed) return false;
    for (const set of this.types.get(placed.typeId)?.wreck.get(setKey(0, placed.root, this.chunkTiles)) ?? []) set.remove(s);
    this.wreckOf.delete(s);
    return true;
  }

  /**
   * The A/B switch (`ThreeRenderer.debugPerTileInstancing`). Off tears every
   * set down and makes `handles` answer false, so the next update stands the
   * tiles up as clones, the pre-GH-974 path; on lets it stand them up
   * instanced again. A flag the answers consult, not a one-shot, so it holds
   * across frames.
   */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) return;
    for (const sets of this.types.values()) {
      for (const list of sets.idle.values()) for (const set of list) set.dispose();
      sets.idle.clear();
      for (const list of sets.idleLod.values()) for (const set of list) set.dispose();
      sets.idleLod.clear();
      for (const list of sets.wreck.values()) for (const set of list) set.dispose();
      sets.wreck.clear();
    }
    this.idleOf.clear();
    this.wreckOf.clear();
  }

  /** Tears down every standing tile and set of `typeId` (a template reload). */
  dropIdle(typeId: string): void {
    const sets = this.types.get(typeId);
    if (!sets) return;
    for (const list of sets.idle.values()) for (const set of list) set.dispose();
    sets.idle.clear();
    this.dropLod(sets);
    for (const [s, p] of this.idleOf) if (p.typeId === typeId) this.idleOf.delete(s);
    sets.idleParts = null;
  }

  dropWreck(typeId: string): void {
    const sets = this.types.get(typeId);
    if (!sets) return;
    for (const list of sets.wreck.values()) for (const set of list) set.dispose();
    sets.wreck.clear();
    for (const [s, p] of this.wreckOf) if (p.typeId === typeId) this.wreckOf.delete(s);
    sets.wreckParts = null;
  }

  /** Every instanced mesh currently built (the debug layers and census). */
  meshes(): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const sets of this.types.values()) {
      for (const list of sets.idle.values()) for (const set of list) out.push(set.mesh);
      for (const list of sets.idleLod.values()) for (const set of list) out.push(set.mesh);
      for (const list of sets.wreck.values()) for (const set of list) out.push(set.mesh);
    }
    return out;
  }

  /** Hides or shows every set (the `buildings` debug layer). Returns how many
   *  meshes it covers; takes effect at the next `flush`, and is held by it. */
  setHidden(hidden: boolean): number {
    this.hidden = hidden;
    this.flush();
    return this.meshes().length;
  }

  /** Uploads every changed matrix. Call once per frame, after the updates. */
  flush(): void {
    for (const sets of this.types.values()) {
      // A type with a twin draws it INSTEAD of its clean (state 0) full sets while the twin is on.
      const swapped = this.lodOn && sets.lod !== null;
      for (const [key, list] of sets.idle) {
        const full = swapped && stateOfKey(key) === 0;
        for (const set of list) set.flush(this.hidden || full);
      }
      for (const list of sets.idleLod.values()) for (const set of list) set.flush(this.hidden || !swapped);
      for (const list of sets.wreck.values()) for (const set of list) set.flush(this.hidden);
    }
  }

  dispose(): void {
    for (const sets of this.types.values()) {
      for (const list of sets.idle.values()) for (const set of list) set.dispose();
      for (const list of sets.wreck.values()) for (const set of list) set.dispose();
      this.dropLod(sets);
    }
    this.types.clear();
    this.idleOf.clear();
    this.wreckOf.clear();
  }
}
