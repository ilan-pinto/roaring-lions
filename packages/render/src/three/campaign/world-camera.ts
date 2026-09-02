/**
 * The campaign board's camera, and the one property that makes turning the
 * board a deliberate act rather than a free orbit: **no rotation can lose
 * the map.**
 *
 * ## One axis, and the game's own view direction
 *
 * The camera does not move. It sits on `../camera.ts`'s `VIEW_DIRECTION` --
 * the same 45-degree azimuth, 30-degree pitch the battlefield is drawn
 * from -- and the BOARD turns underneath it. Two things fall out of that
 * and both were the reason for choosing it:
 *
 *   1. The campaign screen and the mission it launches share a camera, so
 *      the board reads as the same world seen from further away rather than
 *      as a different game's menu.
 *   2. The sun is fixed in world space (`world-material.ts`'s `uLightDir`),
 *      so turning the board changes which slopes are lit. An orbiting
 *      camera with a view-space light would turn the model and leave the
 *      shading nailed to the screen, which reads as a texture sliding over
 *      a stationary shape -- the thing that makes a turntable feel fake.
 *
 * Pitch is not adjustable and there is no pan or zoom. That is the whole
 * interaction budget: one axis, always framed, always reversible.
 *
 * ## Fit once for the WORST yaw, not per frame
 *
 * `fitHalfHeight` sweeps the full turn, projects the board's eight bounding
 * -box corners at every sampled yaw, and returns the half-height that
 * contains all of them. The frustum is then CONSTANT for the whole
 * rotation.
 *
 * Fitting per-frame instead would waste no screen, and would be wrong: the
 * board would swell and shrink as it turned, because a hex slab's projected
 * width genuinely changes with yaw. A constant frustum means the only thing
 * that moves when you drag is the board's orientation, which is the thing
 * you asked to change.
 *
 * The sweep is numeric rather than analytic on purpose. The extremum of
 * `max|x|` over yaw for the convex hull of eight points is a piecewise
 * maximum of sinusoids, and solving it exactly buys nothing a half-degree
 * sample and a 6% margin do not already cover -- while a closed form would
 * have to be re-derived the first time the board stopped being a box.
 * `world-camera.test.ts` checks the guarantee the way a viewer would: it
 * samples yaws the fit never looked at and asserts every corner is still
 * inside the frustum.
 */
import * as THREE from 'three';

import { VIEW_DIRECTION } from '../camera';

/**
 * Empty margin around the fitted board, as a fraction of the half-extent.
 *
 * Not decoration: the fit samples yaw at `FIT_SAMPLES`, so a corner can peak
 * between two samples, and the town pins are DOM chips centred on their
 * marker that overhang the geometry by their own half-width. 6% covers both
 * at every viewport this screen is used at.
 */
export const WORLD_VIEW_MARGIN = 0.06;

/** Yaw samples across the full turn. 720 is every half degree — the fit runs
 *  once per resize, so the cost is 5,760 point transforms on a screen that
 *  otherwise does nothing. */
export const FIT_SAMPLES = 720;

/** Arbitrary, matching `../camera.ts`: an orthographic projection depends on
 *  the view DIRECTION and not on how far away the camera is. */
const CAMERA_DISTANCE = 100;

/**
 * The board camera: orthographic, looking down `VIEW_DIRECTION` at `target`,
 * framed to `halfHeight` world units vertically.
 *
 * `aspect` is the viewport's width/height, so a pixel is square — the same
 * property `../camera.ts` solves its own elevation angle to get.
 */
export function worldViewCamera(
  target: THREE.Vector3,
  halfHeight: number,
  aspect: number
): THREE.OrthographicCamera {
  const halfWidth = halfHeight * aspect;
  const camera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.01,
    CAMERA_DISTANCE * 4
  );
  camera.position.copy(target).addScaledVector(VIEW_DIRECTION, CAMERA_DISTANCE);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/** The eight corners of a box, in the order `Box3` itself would give. */
export function boxCorners(box: THREE.Box3): THREE.Vector3[] {
  const { min, max } = box;
  const out: THREE.Vector3[] = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/**
 * The points the fit actually has to contain: the convex hull of the board's
 * horizontal FOOTPRINT, taken at both its lowest and its highest point.
 *
 * ## Why not the bounding box, which is what this started as
 *
 * The Sahar Basin is a hexagonal slab, and a hexagon's bounding box has four
 * corners with no board under them. Fitting the box therefore reserves screen
 * for ground that does not exist. **Measured on the shipped asset: fitting the
 * 28-point footprint hull instead of the 8 box corners gives a half-height of
 * 0.36066 where the box gives 0.45070 — the board draws 1.25x larger in the
 * same frame, at both 1140/641 and 16/9.** That is the difference between a
 * campaign board and a postage stamp on a 1440-wide window.
 *
 * ## Why this is still an upper bound, and why that is fine
 *
 * The candidates are `hull(x, z) x {minY, maxY}` -- a prism containing the
 * board, not the board's own 3D hull. That over-covers wherever the terrain
 * is lower than its highest peak, which is nearly everywhere. Tightening
 * further would mean a real 3D hull and would buy back a few percent of a
 * frame; the prism is exact in the axis that was actually costing 25% (plan
 * shape) and needs no hull library.
 *
 * Orthographic projection is affine, so the extreme of `|x|` or `|y|` over a
 * point set is always attained at a vertex of that set's convex hull -- which
 * is what licenses reducing 33,678 vertices to 28 hull points before the yaw
 * sweep. `world-camera.test.ts` checks the reduction against every one of
 * those vertices rather than trusting the argument.
 *
 * Reads `mesh.matrixWorld`, so the caller must have updated it (the view does,
 * once, after parenting the board to its pivot at yaw 0).
 */
export function footprintCandidates(meshes: readonly THREE.Mesh[]): THREE.Vector3[] {
  const plan: [number, number][] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      plan.push([v.x, v.z]);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  if (plan.length === 0) return [];
  const out: THREE.Vector3[] = [];
  for (const [x, z] of convexHull2d(plan)) {
    out.push(new THREE.Vector3(x, minY, z));
    out.push(new THREE.Vector3(x, maxY, z));
  }
  return out;
}

/** Monotone chain. Counter-clockwise, no collinear points, first point not
 *  repeated at the end -- none of which the caller cares about, since the
 *  result is only ever fed to a max. */
function convexHull2d(pts: readonly [number, number][]): [number, number][] {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (arr: readonly [number, number][]): [number, number][] => {
    const h: [number, number][] = [];
    for (const p of arr) {
      while (h.length >= 2 && cross(h[h.length - 2] as [number, number], h[h.length - 1] as [number, number], p) <= 0) {
        h.pop();
      }
      h.push(p);
    }
    return h;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The half-height that frames `candidates` at EVERY yaw about the vertical
 * axis through `pivot`, at this aspect.
 *
 * `pivot` is the point the board turns about, which the view sets to the
 * board's own horizontal centre — not the origin, and not the box centre,
 * because the box centre includes the board's height and a board that turned
 * about a point half way up its own thickness would wobble.
 */
export function fitHalfHeight(
  candidates: readonly THREE.Vector3[],
  pivot: THREE.Vector3,
  aspect: number,
  target: THREE.Vector3
): number {
  // Any half-height gives the same view basis; the frustum is what this
  // function is solving for, and `matrixWorldInverse` does not depend on it.
  const view = worldViewCamera(target, 1, aspect).matrixWorldInverse;
  const pts = candidates;
  const p = new THREE.Vector3();
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < FIT_SAMPLES; i++) {
    const yaw = (i / FIT_SAMPLES) * Math.PI * 2;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const c of pts) {
      // Rotation about +Y through `pivot`, written out rather than built as a
      // matrix per sample: the same arithmetic `Object3D.rotation.y` applies.
      const dx = c.x - pivot.x;
      const dz = c.z - pivot.z;
      p.set(pivot.x + dx * cos + dz * sin, c.y, pivot.z - dx * sin + dz * cos);
      p.applyMatrix4(view);
      maxX = Math.max(maxX, Math.abs(p.x));
      maxY = Math.max(maxY, Math.abs(p.y));
    }
  }
  return Math.max(maxY, maxX / aspect) * (1 + WORLD_VIEW_MARGIN);
}

/**
 * Where a world point lands on the canvas, in CSS pixels.
 *
 * The town pins are DOM chips rather than sprites — an HTML label stays
 * crisp and selectable at any board orientation, and it is a real anchor, so
 * middle-click and keyboard focus behave the way they do everywhere else in
 * this menu. That means the projection has to come back out to the app as
 * pixels, which is this function.
 */
export function projectToCanvas(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number
): { x: number; y: number } {
  const ndc = point.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}
