/**
 * Defilade Task 2 (GH-705): a camera-synced, tight shadow box.
 *
 * `lighting.ts` builds the sun's orthographic shadow camera wide enough to
 * cover the whole map at any sun azimuth (`shadowBoxRadius`): on a 48x48 map
 * a 71.9 world-unit box on a 4096 map, 0.0176 wu a texel. Measured through
 * the real cameras (1440x900, DPR 2), one texel spans 1.94 / 0.79 screen
 * pixels at zoom 1 and 4.85 / 1.99 at zoom 2.5 (64x64: 2.55 and 6.38), so a
 * hull shadow is a soft blob. Since GH-705 every preset (`quality.ts`
 * `shadowFit: 'view'`) refits the box every frame to what the CAMERA can
 * see: 0.78 / 0.54 at zoom 1, 0.94 / 0.69 at 2.5, on any map size.
 *
 * ## What the box must contain
 *
 * Every RECEIVER the view can draw: the view frustum's corner rays cut by the
 * slab `y in [yMin, yMax]` (ground to the highest roof on this map), eight
 * points, projected onto the shadow camera's own XY plane. A CASTER outside
 * the view that shadows a receiver inside it lies on the same light ray, so
 * it has the same light-space XY and is covered by the DEPTH range -- which
 * is left exactly as `createSceneLights` built it (the box stays anchored to
 * the map centre along the sun axis, near 1, far 4r), so every caster on the
 * map is still inside it and depth precision is unchanged.
 *
 * ## Why it does not shimmer
 *
 * Two quantisations, both standard (cascaded-shadow-map practice):
 *
 * 1. **The SIZE depends on zoom and viewport only, never on the pan.** A pan
 *    translates all eight points by the same vector, so their light-space
 *    AABB keeps its size; it is rounded UP to `SIZE_STEP_WU` so a resize or
 *    zoom by a hair does not change the texel size either. (A size clipped
 *    against the map box near the edge WOULD change with the pan, which is
 *    why the box is CLAMPED inside the map box rather than intersected with
 *    it.)
 * 2. **The CENTRE is snapped to whole texels** in light space, measured from
 *    the map centre. The texel grid is then fixed in the world and a pan
 *    moves it by whole texels, so a shadow edge samples the same texels at
 *    the same world point frame after frame.
 *
 * When the view's box is no smaller than the map box (zoomed far out), the
 * map box is used unchanged -- today's frame to the bit.
 *
 * Nothing here reads the sim. The sun's DIRECTION, colour and intensity are
 * not touched (the lead's taste calls).
 */
import * as THREE from 'three';

/** The fitted box's half-extents are rounded up to a multiple of this, in
 *  world units (= tiles), so the texel size changes only in steps. */
export const SIZE_STEP_WU = 0.5;

export type ShadowFitMode = 'map' | 'view';

export interface ShadowFitResult {
  readonly mode: ShadowFitMode;
  /** Light-space half extents of the box actually used. */
  readonly halfX: number;
  readonly halfY: number;
  /** Light-space centre offset from the map centre (snapped). */
  readonly cx: number;
  readonly cy: number;
  /** World units per shadow texel along each light-space axis. */
  readonly texelX: number;
  readonly texelY: number;
}

const tmpM = new THREE.Matrix4();
const ax = new THREE.Vector3();
const ay = new THREE.Vector3();
const az = new THREE.Vector3();
const ndc = new THREE.Vector3();
const nearP = new THREE.Vector3();
const farP = new THREE.Vector3();
const dir = new THREE.Vector3();
const p = new THREE.Vector3();

/** The shadow camera's right and up axes for a sun along `toSun` -- what
 *  three's own `lookAt` gives it (`DirectionalLightShadow.updateMatrices`). */
export function lightAxes(
  toSun: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  camUp: THREE.Vector3 = THREE.Object3D.DEFAULT_UP
): void {
  tmpM.lookAt(toSun, new THREE.Vector3(0, 0, 0), camUp);
  tmpM.extractBasis(right, up, az);
}

/* Rolling the shadow camera so its up is the VIEW camera's up was tried and
 * measured WORSE (48x48, zoom 1, DPR 2: 1.43 / 0.58 screen px per texel
 * against 0.78 / 0.54 with three's default world-up roll): the sun is 55
 * degrees up and 90 degrees round from the view azimuth, so world-up already
 * lines the box up with the screen's ground footprint. Not kept. */

/**
 * The light-space AABB (relative to `centre`) of the view frustum cut by the
 * slab `y in [yMin, yMax]`. `view` must have current matrices.
 */
export function viewReceiverBox(
  view: THREE.OrthographicCamera,
  toSun: THREE.Vector3,
  centre: THREE.Vector3,
  yMin: number,
  yMax: number,
  camUp: THREE.Vector3 = THREE.Object3D.DEFAULT_UP
): { minX: number; maxX: number; minY: number; maxY: number } {
  lightAxes(toSun, ax, ay, camUp);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      nearP.copy(ndc.set(sx, sy, -1)).unproject(view);
      farP.copy(ndc.set(sx, sy, 1)).unproject(view);
      dir.subVectors(farP, nearP);
      for (const y of [yMin, yMax]) {
        // The ray is never horizontal on this camera (30 degree pitch).
        const t = (y - nearP.y) / dir.y;
        p.copy(nearP).addScaledVector(dir, t).sub(centre);
        const lx = p.dot(ax);
        const ly = p.dot(ay);
        minX = Math.min(minX, lx);
        maxX = Math.max(maxX, lx);
        minY = Math.min(minY, ly);
        maxY = Math.max(maxY, ly);
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Fits `sun`'s shadow box for this frame. `mapR` is `shadowBoxRadius` (the
 * map box's half extent), `mapCentre` the map centre, `toSun` the unit
 * direction to the sun. Writes the sun's position, its target and its
 * shadow camera's left/right/top/bottom; leaves near/far alone.
 */
export function fitShadowBox(
  sun: THREE.DirectionalLight,
  mode: ShadowFitMode,
  view: THREE.OrthographicCamera,
  toSun: THREE.Vector3,
  mapCentre: THREE.Vector3,
  mapR: number,
  yMin: number,
  yMax: number,
  snap = true
): ShadowFitResult {
  const camUp = THREE.Object3D.DEFAULT_UP;
  const size = sun.shadow.mapSize.x;
  let halfX = mapR;
  let halfY = mapR;
  let cx = 0;
  let cy = 0;
  if (mode === 'view') {
    const b = viewReceiverBox(view, toSun, mapCentre, yMin, yMax, camUp);
    const hx = Math.ceil((b.maxX - b.minX) / 2 / SIZE_STEP_WU) * SIZE_STEP_WU;
    const hy = Math.ceil((b.maxY - b.minY) / 2 / SIZE_STEP_WU) * SIZE_STEP_WU;
    if (hx < mapR || hy < mapR) {
      halfX = Math.min(hx, mapR);
      halfY = Math.min(hy, mapR);
      // Clamp, never intersect: the size must not depend on the pan.
      cx = THREE.MathUtils.clamp((b.minX + b.maxX) / 2, -mapR + halfX, mapR - halfX);
      cy = THREE.MathUtils.clamp((b.minY + b.maxY) / 2, -mapR + halfY, mapR - halfY);
      if (snap) {
        const tx = (2 * halfX) / size;
        const ty = (2 * halfY) / size;
        cx = Math.round(cx / tx) * tx;
        cy = Math.round(cy / ty) * ty;
      }
    }
  }
  lightAxes(toSun, ax, ay, camUp);
  const target = sun.target.position;
  target.copy(mapCentre).addScaledVector(ax, cx).addScaledVector(ay, cy);
  sun.position.copy(target).addScaledVector(toSun, mapR * 2);
  const cam = sun.shadow.camera;
  if (cam.left !== -halfX || cam.right !== halfX || cam.top !== halfY || cam.bottom !== -halfY) {
    cam.left = -halfX;
    cam.right = halfX;
    cam.top = halfY;
    cam.bottom = -halfY;
    cam.updateProjectionMatrix();
  }
  return { mode, halfX, halfY, cx, cy, texelX: (2 * halfX) / size, texelY: (2 * halfY) / size };
}
