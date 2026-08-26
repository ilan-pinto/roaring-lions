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
 * Derivation: fix the camera at 45-degree azimuth (equal `|x|`/`|z|`
 * contribution -- the symmetry the last test below checks). That azimuth
 * alone fixes the camera's local "right" axis at `(1/sqrt2, 0, -1/sqrt2)`
 * regardless of pitch, so a pure x-tile step always contributes `1/sqrt2` of
 * view-space-X per tile; sizing the frustum's horizontal half-extent turns
 * that into `TILE_W/2` screen pixels per tile at zoom 1.
 *
 * The same x-tile step also has a component along the camera's local up
 * axis, `(-sin(EL)/sqrt2, cos(EL), -sin(EL)/sqrt2)`. Sizing the frustum's
 * vertical half-extent to turn that up-axis contribution into `TILE_H/2`
 * pixels, then separately projecting a pure elevation step `(0, 1, 0)`
 * through that same up axis and vertical extent, gives an
 * elevation-pixel-coefficient that equals the horizontal one, `TILE_W /
 * sqrt2`, exactly when `tan(EL) = TILE_H / TILE_W` -- verified against the
 * test file's exact-pixel assertions, not assumed. `WORLD_Y_PER_LIFT_PIXEL`
 * below is the reciprocal of that coefficient.
 */
const ELEVATION = Math.atan(TILE_H / TILE_W);
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
 * this many three.js world-Y units. Chosen so that, after the frustum is
 * sized to put `TILE_W/2` pixels under one ground tile, one world-Y unit
 * projects to exactly one screen pixel at zoom 1 -- see `ELEVATION`'s
 * derivation for why that conversion is a plain constant, independent of
 * `cam`/`vp`/zoom.
 */
const WORLD_Y_PER_LIFT_PIXEL = Math.SQRT2 / TILE_W;

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
  const hit = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, hit);

  return { x: hit.x, y: hit.z };
}
