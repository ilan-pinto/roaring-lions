/**
 * The decor and prop batches' per-instance cull and sort, worked out once per
 * view instead of once per PASS.
 *
 * `THREE.BatchedMesh.onBeforeRender` frustum-culls and depth-sorts every
 * instance each time the batch is drawn -- and a frame draws it three times
 * (the shadow map, the main pass, the ambient-occlusion pre-pass), the last
 * two through the same camera, the first through a sun whose shadow box is
 * fitted once per map and never moves. On the low-end proxy that was
 * `BatchedMesh.onBeforeRender` at ~1.7 ms a frame at 4x CPU
 * (docs/PERFORMANCE.md, "Low-end"), for answers that were mostly the same
 * answer again.
 *
 * So the answer is kept, per view: the camera's projection and world
 * matrices, coordinate system and depth direction, the batch's own world
 * matrix, and the material's transparency and wireframe flag are the whole of what three reads besides the
 * instances themselves, and a draw whose view matches a kept one gets that
 * one's draw list back instead of a recomputation. Same list, same order,
 * same bytes in the indirect texture -- what is skipped is the arithmetic,
 * never the result. A draw whose view matches the list ALREADY in the batch
 * (the AO pass right after the main pass) touches nothing at all, not even
 * the indirect texture's upload.
 *
 * The instances are the one input that is not in the key, so every method
 * that can change them clears what was kept. Nothing in this renderer moves a
 * decor or prop instance after the batch is built today; the clearing is what
 * keeps that a performance assumption rather than a correctness one.
 */
import * as THREE from 'three';

/** Views kept per batch. A frame uses two (the sun, the camera); the third
 *  and fourth absorb a capture or a second shadow-casting light without
 *  thrashing. */
const KEPT_VIEWS = 4;

interface KeptView {
  readonly key: Float64Array;
  readonly count: number;
  readonly starts: Int32Array;
  readonly counts: Int32Array;
  readonly indirect: Uint32Array;
  readonly bytesPerElement: number;
}

/** The `BatchedMesh` internals `onBeforeRender` writes (three r186; r170
 *  wrote all but `_multiDrawBytesPerElement`). Re-read the method at every
 *  three upgrade: this list and `viewKey` below must match what it reads and
 *  writes, and nothing type-checks that. */
interface BatchInternals {
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _multiDrawBytesPerElement: number;
  _indirectTexture: THREE.DataTexture;
  _visibilityChanged: boolean;
}

/** Every `BatchedMesh` method that can change which instances draw, where, or
 *  with which geometry -- each one clears the kept views. */
const MUTATORS = [
  'addGeometry',
  'addInstance',
  'deleteGeometry',
  'deleteInstance',
  'setGeometryAt',
  'setGeometryIdAt',
  'setMatrixAt',
  'setVisibleAt',
  'setInstanceCount',
  'setGeometrySize',
  'optimize',
] as const;

const KEY_LENGTH = 16 * 3 + 7;

/** The indirect texture's backing array -- a `Uint32Array` in r170 and r186, typed
 *  more loosely by `@types/three`. */
function indirectData(internals: BatchInternals): Uint32Array {
  return internals._indirectTexture.image.data as unknown as Uint32Array;
}

function viewKey(
  out: Float64Array,
  mesh: THREE.BatchedMesh,
  camera: THREE.Camera,
  material: THREE.Material
): Float64Array {
  out.set(camera.projectionMatrix.elements, 0);
  out.set(camera.matrixWorld.elements, 16);
  out.set(mesh.matrixWorld.elements, 32);
  out[48] = material.transparent ? 1 : 0;
  // r186 builds the frustum from the CAMERA's coordinate system and depth
  // direction (r170 took the renderer's), and doubles every count for a
  // wireframe material.
  out[49] = camera.coordinateSystem;
  out[50] = mesh.perObjectFrustumCulled ? 1 : 0;
  out[51] = mesh.sortObjects ? 1 : 0;
  out[52] = mesh.customSort === null ? 0 : 1;
  out[53] = camera.reversedDepth ? 1 : 0;
  out[54] = (material as THREE.Material & { wireframe?: boolean }).wireframe === true ? 1 : 0;
  return out;
}

function sameKey(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i < KEY_LENGTH; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Makes `mesh` keep its per-view cull and sort -- see this module's top
 * comment. Call once, after building the batch. Returns `mesh`.
 */
export function memoizeBatchCulling(mesh: THREE.BatchedMesh): THREE.BatchedMesh {
  const internals = mesh as unknown as BatchInternals;
  const compute = THREE.BatchedMesh.prototype.onBeforeRender;
  let kept: KeptView[] = [];
  // The kept view whose list is in the batch's own arrays (and uploaded) now.
  let current: KeptView | null = null;
  const probe = new Float64Array(KEY_LENGTH);

  for (const name of MUTATORS) {
    const original = mesh[name] as unknown as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') continue;
    (mesh as unknown as Record<string, unknown>)[name] = function (this: THREE.BatchedMesh, ...args: unknown[]) {
      kept = [];
      current = null;
      return original.apply(this, args);
    };
  }

  mesh.onBeforeRender = function (
    this: THREE.BatchedMesh,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    group: THREE.Group
  ): void {
    viewKey(probe, this, camera, material);
    if (current !== null && sameKey(current.key, probe)) return;
    const hit = kept.find((v) => sameKey(v.key, probe));
    if (hit !== undefined) {
      internals._multiDrawStarts.set(hit.starts);
      internals._multiDrawCounts.set(hit.counts);
      indirectData(internals).set(hit.indirect);
      internals._indirectTexture.needsUpdate = true;
      internals._multiDrawCount = hit.count;
      internals._multiDrawBytesPerElement = hit.bytesPerElement;
      internals._visibilityChanged = false;
      current = hit;
      return;
    }
    compute.call(this, renderer, scene, camera, geometry, material, group);
    const count = internals._multiDrawCount;
    const view: KeptView = {
      key: probe.slice(),
      count,
      starts: internals._multiDrawStarts.slice(0, count),
      counts: internals._multiDrawCounts.slice(0, count),
      indirect: indirectData(internals).slice(0, count),
      bytesPerElement: internals._multiDrawBytesPerElement,
    };
    kept.push(view);
    if (kept.length > KEPT_VIEWS) kept.shift();
    current = view;
  };
  return mesh;
}
