/**
 * The dimetric camera, pinned against `project.ts`'s Pixi-side arithmetic.
 *
 * `project.ts` computes the projection as flat 2D formulas because Pixi has
 * no camera to ask. three.js does have one, so here the projection *is* the
 * camera: an `OrthographicCamera` positioned and framed so that
 * `camera.project()` reproduces `worldToScreen`'s numbers exactly. Nothing
 * in this file recomputes `isoX`/`isoY` -- if it did, this module would be a
 * second, independently-drifting source of truth for where things land on
 * screen, which is the exact problem `project.ts` was split out to remove.
 *
 * World-space convention (used by every later Phase B sub-plan): game tile
 * `(x, y)` is three.js `(x, elevation, y)`. Game Y is three.js Z; three.js Y
 * is up.
 */
import * as THREE from 'three';
import { TILE_W, TILE_H, type Camera, type Viewport } from '../project';

/**
 * Pitch (from horizontal) for a 45-degree-azimuth camera whose ground
 * diagonal projects at the game's 2:1 dimetric slope, `TILE_H / TILE_W`.
 *
 * Fixing the camera at 45-degree azimuth (equal `|x|`/`|z|` contribution --
 * the symmetry the last test below checks) fixes the local "right" axis at
 * `(1/sqrt2, 0, -1/sqrt2)` regardless of pitch, and the local up axis at
 * `(-sin(EL)/sqrt2, cos(EL), -sin(EL)/sqrt2)`.
 *
 * Matching Pixi's ground projection ALONE does not pin `EL`: `sin(EL)`
 * appears in both the up axis's ground-plane component and in
 * `halfHeight` below, and cancels between them for any `EL > 0` --
 * `halfHeight` is solved so the frustum reproduces `TILE_H/2` pixels per
 * ground tile whatever `EL` is. A wrong `EL` here still passes every
 * ground-projection test in `camera.test.ts`; only the frustum-aspect test
 * ("agrees with square pixels") constrains it, because it is the only
 * assertion that is not itself solved for by `halfHeight`.
 *
 * What actually pins `EL` is demanding *square pixels*: the same
 * screen-pixels-per-view-space-unit scale on both frustum axes, so a
 * three.js mesh (terrain in B2, units in B3) renders at the correct
 * proportions instead of being vertically stretched or squashed relative to
 * the ground plane. Px-per-view-X is fixed at `(TILE_W/2)/(1/sqrt2)`
 * regardless of `EL` (from the right axis above); requiring
 * px-per-view-Y -- `(TILE_H/2)/(sin(EL)/sqrt2)` -- to equal that same value
 * gives `sin(EL) = TILE_H / TILE_W`, i.e. `EL = 30 degrees` for this game's
 * 2:1 ratio. (`atan(TILE_H/TILE_W)` =~ 26.565 degrees is a different, wrong
 * angle that also happens to pass every ground-only test above -- it does
 * not produce square pixels, so the frustum aspect ends up ~1.12x the
 * viewport's.)
 */
const ELEVATION = Math.asin(TILE_H / TILE_W);
const SIN_EL = Math.sin(ELEVATION);

/** Both ground axes contribute equally at a 45-degree azimuth. */
const AZIMUTH = Math.SQRT1_2;

/** Arbitrary: orthographic projection depends only on view direction, not
 *  camera distance. Large enough that near/far comfortably bracket it. */
const CAMERA_DISTANCE = 10_000;

/** Unit view direction from the camera's target toward the camera, fixed by
 *  the 45-degree azimuth and the solved elevation angle. */
const VIEW_DIRECTION = new THREE.Vector3(
  Math.cos(ELEVATION) * AZIMUTH,
  SIN_EL,
  Math.cos(ELEVATION) * AZIMUTH
);

/**
 * A raw `lift` pixel (see `project.worldToScreen`'s doc comment) converts to
 * this many three.js world-Y units. A world-Y offset of `dh` contributes
 * `dh * cos(EL)` to view-space-Y, projecting (at the square-pixel scale
 * above) to `dh * cos(EL) * TILE_W/sqrt2` screen pixels at zoom 1. Setting
 * that equal to the desired `1` pixel per raw `lift` pixel and solving for
 * `dh` gives this constant -- independent of `cam`/`vp`/zoom, like `wx`/`wy`
 * themselves.
 */
const WORLD_Y_PER_LIFT_PIXEL = (Math.SQRT2 * Math.tan(ELEVATION)) / TILE_H;

/**
 * The three.js orthographic camera reproducing `project.worldToScreen`'s
 * projection for the given pan/zoom and viewport.
 */
export function dimetricCamera(cam: Camera, vp: Viewport): THREE.OrthographicCamera {
  const target = new THREE.Vector3(cam.x, 0, cam.y);

  // Frustum half-extents in view space. Scaled by vp so a tile's pixel size
  // stays fixed as the window resizes, and by 1/zoom so `cam.zoom` behaves
  // exactly like `worldToScreen`'s `* z` -- shrinking the frustum magnifies
  // the view, matching a bigger `z` multiplying every projected pixel.
  const halfWidth = vp.width / (TILE_W * cam.zoom * Math.SQRT2);
  const halfHeight = (vp.height * SIN_EL) / (TILE_H * cam.zoom * Math.SQRT2);

  const camera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.1,
    CAMERA_DISTANCE * 2
  );
  camera.position.copy(target).addScaledVector(VIEW_DIRECTION, CAMERA_DISTANCE);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * World point -> pixel in the viewport, via the three.js camera.
 *
 * `lift` matches `project.worldToScreen`'s: unscaled screen pixels, raising
 * the point up the screen, applied before the zoom multiply. Here that means
 * converting it to a three.js world-Y offset (`WORLD_Y_PER_LIFT_PIXEL`) and
 * letting the camera project it, rather than adjusting the 2D result by
 * hand.
 */
export function worldToScreenThree(
  wx: number,
  wy: number,
  cam: Camera,
  vp: Viewport,
  lift = 0
): { x: number; y: number } {
  const camera = dimetricCamera(cam, vp);
  const point = new THREE.Vector3(wx, lift * WORLD_Y_PER_LIFT_PIXEL, wy);
  const ndc = point.project(camera);
  return {
    x: ((ndc.x + 1) / 2) * vp.width,
    y: ((1 - ndc.y) / 2) * vp.height,
  };
}

/**
 * Pixel -> world point, assuming flat ground (elevation 0) -- the three.js
 * counterpart to `project.screenToWorldFlat`. Unprojects the pixel into a
 * ray and intersects it with the `y = 0` plane.
 */
export function screenToWorldThree(
  px: number,
  py: number,
  cam: Camera,
  vp: Viewport
): { x: number; y: number } {
  const camera = dimetricCamera(cam, vp);
  const ndcX = (px / vp.width) * 2 - 1;
  const ndcY = 1 - (py / vp.height) * 2;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  // Unreachable with this camera -- its ray is never parallel to y = 0 --
  // but `intersectPlane` returns null rather than lying, so this must too
  // rather than silently reporting tile (0, 0).
  if (!hit) {
    throw new Error('screenToWorldThree: camera ray does not intersect the ground plane');
  }

  return { x: hit.x, y: hit.z };
}
