/**
 * TEST SUPPORT -- nothing in the game imports this. A draw census of the chunked terrain through
 * three's own render lists, with no GPU (GH-913, GH-920).
 *
 * What a chunk buys is decided by how many chunk objects survive three's frustum test in each
 * pass, and how many instances a decor batch then walks and draws. None of that needs a
 * rasteriser, so this runs the REAL `WebGLRenderer` on `fake-gl.ts` (a context that accepts every
 * call and draws nothing), wraps `renderBufferDirect`, and counts what three submits:
 *
 *  - the MAIN pass is `renderer.render(scene, camera)`;
 *  - the SHADOW pass is the same call with the sun's fitted shadow box (a `null` scene tells it
 *    apart) -- fitted by the renderer's own `fitShadowBox`, as `ThreeRenderer.updateShadowFit` does;
 *  - the AO pre-pass is `WorldGTAOPass.render`'s recipe: hide whatever `isAoOccluder` rejects,
 *    override the material, render.
 *
 * Triangles are counted the way the GPU would draw them: an indexed `Mesh` draws its whole index
 * range, a `BatchedMesh` draws the multi-draw list `onBeforeRender` just wrote.
 *
 * Not measured: shader cost, fill, anything a pixel does. `pnpm perf:fx --breakdown` is the
 * instrument for time; this is the one for "how much is submitted", and the only one that runs in
 * CI.
 */
import * as THREE from 'three';
import { FakeWebGL2RenderingContext, fakeCanvas, makeFakeGl } from './fake-gl';
import { updateDimetricCamera } from './camera';
import { createSceneLights, shadowBoxRadius } from './lighting';
import { fitShadowBox } from './shadow-fit';
import { isAoOccluder } from './post-chain';
import { ChunkedMeshLayer } from './terrain/chunk-layer';
import { buildDecorMesh, stripToBatchAttributes, type DecorGeometrySet } from './terrain/decor-mesh';
import { chunkGridFor, type ChunkGrid, type ChunkLayer } from './terrain/chunks';
import { isDecorMeshRole, type DecorMeshRole } from './terrain/decor-role';
import type { DecorPlacement } from './terrain/decor-place';
import type { TiledMeshData } from './terrain/tiled-mesh';
import { MESH_SCALE } from './units/mesh-anim';
import { parseGlbHeadless } from './units/headless-gltf';
import { toGeometry } from './terrain/mesh';
import { buildTexturedDecorMesh, type TexturedDecorSet } from './terrain/decor-textured-mesh';
import { isTexturedDecorKey } from './terrain/textured-decor';

export type { DecorGeometrySet, TexturedDecorSet };

export type CensusPass = 'main' | 'shadow' | 'ao';

export interface CensusView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface CensusCount {
  calls: number;
  triangles: number;
}

/** What one view submitted: per layer ('ground', 'scatter', 'decor'), per pass. */
export interface CensusRow {
  readonly view: CensusView;
  readonly layers: Record<string, Record<CensusPass, CensusCount>>;
  /** Totals over every layer and pass. */
  readonly total: CensusCount;
  /** The instances the decor batches drew in the main pass, and how many exist on the map. */
  readonly decorInstancesDrawn: number;
  /** Instances the decor batches that three submitted had to walk (cull and sort): once for the
   *  camera, once for the sun. The CPU cost of a pan is this, not the draw. */
  readonly decorInstancesWalked: number;
  readonly decorInstances: number;
}

export interface CensusInput {
  readonly width: number;
  readonly height: number;
  readonly ground: TiledMeshData;
  readonly scatter: TiledMeshData;
  readonly placements: readonly DecorPlacement[];
  readonly decorSet: DecorGeometrySet;
  /** The textured families (the ditch). Absent means none are drawn. */
  readonly texturedSet?: TexturedDecorSet;
  /** The tallest elevation level, for the shadow fit's slab. */
  readonly maxLevel: number;
  /** A chunk edge in tiles per layer, or null to leave that layer whole. Unlike the game, a number
   *  chunks a map of ANY size. */
  readonly edges: Readonly<Record<ChunkLayer, number | null>>;
  /** Cut the ground and scatter chunks to the rows the camera reaches (`ChunkedMeshLayer.cullRows`), as the
   *  game does every frame. Default true; false is the whole-chunk draw it replaced. */
  readonly rowCull?: boolean;
}

/** `art/meshes/decor/*.glb` as the renderer's `loadDecorMeshes` bakes them (scaled, in world space,
 *  attributes stripped), read from disk. `files` maps `<family>_<variant>` to the GLB's bytes. */
export async function decorSetFromGlbs(files: ReadonlyMap<string, Uint8Array>): Promise<DecorGeometrySet> {
  const parts = new Map<string, { role: DecorMeshRole; geometry: THREE.BufferGeometry }[]>();
  for (const [id, bytes] of files) {
    const gltf = await parseGlbHeadless(bytes);
    gltf.scene.scale.setScalar(MESH_SCALE);
    const list: { role: DecorMeshRole; geometry: THREE.BufferGeometry }[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const role = (mesh.userData as { rl_role?: string }).rl_role;
      if (role === undefined || !isDecorMeshRole(role)) return;
      mesh.updateWorldMatrix(true, false);
      list.push({ role, geometry: stripToBatchAttributes(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)) });
    });
    if (list.length > 0) parts.set(id, list);
  }
  return { parts };
}

/** The textured decor GLBs (`rl_textured`), geometry baked into world space, each with a 1x1 stand-in
 *  for its map: the census counts submissions, and never samples a texel. */
export async function texturedSetFromGlbs(files: ReadonlyMap<string, Uint8Array>): Promise<TexturedDecorSet> {
  const parts = new Map<string, { geometry: THREE.BufferGeometry; map: THREE.Texture }>();
  for (const [id, bytes] of files) {
    if (!isTexturedDecorKey(id)) continue;
    const gltf = await parseGlbHeadless(bytes);
    gltf.scene.scale.setScalar(MESH_SCALE);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh.userData as { rl_textured?: boolean }).rl_textured !== true) return;
      mesh.updateWorldMatrix(true, false);
      const map = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
      parts.set(id, { geometry: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), map });
    });
  }
  return { parts };
}

function trianglesOf(object: THREE.Object3D): number {
  const batched = object as THREE.BatchedMesh;
  if (batched.isBatchedMesh) {
    const internals = batched as unknown as { _multiDrawCounts: Int32Array; _multiDrawCount: number };
    let n = 0;
    for (let i = 0; i < internals._multiDrawCount; i++) n += internals._multiDrawCounts[i];
    return n / 3;
  }
  const mesh = object as THREE.Mesh;
  const index = mesh.geometry?.getIndex();
  // The draw range, as three's own `renderBufferDirect` applies it (clamped to the index buffer).
  const range = mesh.geometry?.drawRange;
  const drawn = index ? Math.max(0, Math.min(index.count - (range?.start ?? 0), range?.count ?? Infinity)) : 0;
  const per = drawn / 3;
  return (object as THREE.InstancedMesh).isInstancedMesh ? per * (object as THREE.InstancedMesh).count : per;
}

/** Draws `views` of the chunked terrain and returns what three submitted for each. */
export function censusTerrain(input: CensusInput, views: readonly CensusView[]): CensusRow[] {
  (globalThis as unknown as Record<string, unknown>).WebGL2RenderingContext = FakeWebGL2RenderingContext;
  const { gl } = makeFakeGl();
  const renderer = new THREE.WebGLRenderer({ canvas: fakeCanvas(1440, 900), context: gl });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = true;
  const scene = new THREE.Scene();
  const lights = createSceneLights(input.width, input.height);
  lights.addTo(scene);

  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const scatterMat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const gridFor = (layer: ChunkLayer) => (w: number, h: number): ChunkGrid | null => {
    const edge = input.edges[layer];
    return edge === null ? null : chunkGridFor(w, h, layer, edge, 0);
  };
  const ground = new ChunkedMeshLayer(scene, 'ground', groundMat, true, (d, opts) => toGeometry(d, opts), gridFor('ground'));
  const scatter = new ChunkedMeshLayer(scene, 'scatter', scatterMat, true, (d, opts) => toGeometry(d, opts), gridFor('ground'));
  ground.update(input.ground, null);
  scatter.update(input.scatter, null);
  const decor = buildDecorMesh(input.placements, input.decorSet);
  const textured = buildTexturedDecorMesh(input.placements, input.texturedSet ?? { parts: new Map() }, gridFor('ditch')(input.width, input.height));
  scene.add(decor, textured);
  let decorInstances = 0;
  for (const child of decor.children) decorInstances += (child as THREE.BatchedMesh).instanceCount ?? 0;
  for (const child of textured.children) decorInstances += (child as THREE.InstancedMesh).count;

  const layerOf = (object: THREE.Object3D): string | null => {
    for (let o: THREE.Object3D | null = object; o !== null; o = o.parent) {
      if (o === ground.root) return 'ground';
      if (o === scatter.root) return 'scatter';
      if (o === decor) return 'decor';
      if (o === textured) return 'ditch';
    }
    return null;
  };

  let pass: CensusPass = 'main';
  let layers: CensusRow['layers'] = {};
  let decorDrawn = 0;
  let walked = 0;
  const walkedBy = new Set<string>();
  const real = renderer.renderBufferDirect.bind(renderer);
  (renderer as unknown as { renderBufferDirect: unknown }).renderBufferDirect = (
    cam: THREE.Camera,
    sc: THREE.Scene | null,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    object: THREE.Object3D,
    group: unknown
  ): unknown => {
    const p: CensusPass = sc === null ? 'shadow' : pass;
    const name = layerOf(object);
    // The AO pre-pass reuses the main camera's kept answer (`batch-cull.ts`); count each batch once per camera.
    const walkKey = `${object.id}:${p === 'shadow' ? 'sun' : 'camera'}`;
    const batch = object as THREE.BatchedMesh;
    if (batch.isBatchedMesh && (batch.perObjectFrustumCulled || batch.sortObjects) && !walkedBy.has(walkKey)) {
      walkedBy.add(walkKey);
      walked += batch.instanceCount;
    }
    if (name !== null) {
      const row = (layers[name] ??= { main: { calls: 0, triangles: 0 }, shadow: { calls: 0, triangles: 0 }, ao: { calls: 0, triangles: 0 } });
      row[p].calls++;
      const tris = trianglesOf(object);
      row[p].triangles += tris;
      if (p === 'main') {
        if ((object as THREE.BatchedMesh).isBatchedMesh) decorDrawn += (object as unknown as { _multiDrawCount: number })._multiDrawCount;
        else if ((object as THREE.InstancedMesh).isInstancedMesh) decorDrawn += (object as THREE.InstancedMesh).count;
      }
    }
    return (real as (...a: unknown[]) => unknown)(cam, sc, geometry, material, object, group);
  };

  const camera = new THREE.OrthographicCamera();
  const rows: CensusRow[] = [];
  const centre = new THREE.Vector3(input.width / 2, 0, input.height / 2);
  const toSun = new THREE.Vector3().copy(lights.sun.position).sub(lights.sun.target.position).normalize();
  try {
    for (const view of views) {
      updateDimetricCamera({ x: view.x, y: view.y, zoom: view.zoom }, { width: 1440, height: 900 }, camera);
      fitShadowBox(lights.sun, 'view', camera, toSun, centre, shadowBoxRadius(input.width, input.height), -1, input.maxLevel * 0.2 + 4, true);
      layers = {};
      decorDrawn = 0;
      walked = 0;
      walkedBy.clear();
      scene.updateMatrixWorld(true);
      if (input.rowCull !== false) {
        camera.updateMatrixWorld();
        ground.cullRows(camera);
        scatter.cullRows(camera);
      }
      pass = 'main';
      renderer.render(scene, camera);
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.visible && !isAoOccluder(o)) {
          o.visible = false;
          hidden.push(o);
        }
      });
      const autoUpdate: boolean = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      scene.overrideMaterial = new THREE.MeshNormalMaterial();
      pass = 'ao';
      try {
        renderer.render(scene, camera);
      } finally {
        scene.overrideMaterial = null;
        renderer.shadowMap.autoUpdate = autoUpdate;
        for (const o of hidden) o.visible = true;
        pass = 'main';
      }
      const total: CensusCount = { calls: 0, triangles: 0 };
      for (const byPass of Object.values(layers)) {
        for (const c of Object.values(byPass)) {
          total.calls += c.calls;
          total.triangles += c.triangles;
        }
      }
      rows.push({ view, layers, total, decorInstancesDrawn: decorDrawn, decorInstancesWalked: walked, decorInstances });
    }
  } finally {
    renderer.dispose();
    ground.dispose();
    scatter.dispose();
    lights.dispose();
    delete (globalThis as unknown as Record<string, unknown>).WebGL2RenderingContext;
  }
  return rows;
}
