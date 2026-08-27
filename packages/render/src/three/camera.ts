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
import { TILE_W, TILE_H, ELEVATION, WORLD_Y_PER_LIFT_PIXEL, type Camera, type Viewport } from '../project';
import { groundWorldY } from './ground-height';

// ELEVATION and WORLD_Y_PER_LIFT_PIXEL live in project.ts now -- both are
// pure arithmetic over TILE_W/TILE_H, and project.ts, unlike this file,
// imports nothing at all, three.js included; terrain/ground.ts and its
// siblings need WORLD_Y_PER_LIFT_PIXEL without paying for a three.js import
// merely to reach a number. Re-exported here so every existing importer of
// this module is unaffected; imported (above) so SIN_EL, VIEW_DIRECTION and
// worldToScreenThree below still have both in scope.
export { WORLD_Y_PER_LIFT_PIXEL } from '../project';

/**
 * Why `ELEVATION` (imported above) is `asin(TILE_H / TILE_W)` -- the pitch,
 * from horizontal, of a 45-degree-azimuth camera whose ground diagonal
 * projects at the game's 2:1 dimetric slope, `TILE_H / TILE_W`.
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
const SIN_EL = Math.sin(ELEVATION);

/** Both ground axes contribute equally at a 45-degree azimuth. */
const AZIMUTH = Math.SQRT1_2;

/** Arbitrary: orthographic projection depends only on view direction, not
 *  camera distance. Large enough that near/far comfortably bracket it. */
const CAMERA_DISTANCE = 10_000;

/** Unit view direction from the camera's target toward the camera, fixed by
 *  the 45-degree azimuth and the solved elevation angle. */
export const VIEW_DIRECTION = new THREE.Vector3(
  Math.cos(ELEVATION) * AZIMUTH,
  SIN_EL,
  Math.cos(ELEVATION) * AZIMUTH
);

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
 * Ray/plane intersection at world-Y `y`, from an already-configured
 * raycaster -- the shared tail both the flat guess and the elevation-
 * corrected re-intersection below go through.
 *
 * Unreachable with this camera returning `null` -- its ray is never
 * parallel to a horizontal plane -- but `intersectPlane` returns `null`
 * rather than lying, so this must too rather than silently reporting tile
 * (0, 0).
 */
function intersectHorizontalPlane(raycaster: THREE.Raycaster, y: number): THREE.Vector3 {
  // Plane equation is `normal . X + constant = 0`; for the horizontal plane
  // `Y = y` with normal (0, 1, 0), that is `constant = -y`.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!hit) {
    throw new Error('screenToWorldThree: camera ray does not intersect the ground plane');
  }
  return hit;
}

/**
 * Pixel -> world point -- the three.js counterpart to
 * `PixiRenderer.screenToWorld` (`renderer.ts:951-971`), not merely to
 * `project.screenToWorldFlat`. `elevation`/`mapWidth`/`mapHeight` are
 * optional and default to "no relief" (`groundWorldY` returns 0 for a
 * `null` grid regardless of `mapWidth`/`mapHeight`, `ground-height.ts`'s own
 * `levelAt` delegate), so every existing flat-ground call site -- and every
 * `camera.test.ts` assertion against `screenToWorldFlat` -- is unaffected by
 * this signature growing.
 *
 * `Renderer.screenToWorld(px, py)` itself deliberately has no `lift`
 * parameter (Phase B2's outcome doc) -- this is NOT that seam. It is the
 * layer below it: `ThreeRenderer.screenToWorld` calls this with its own
 * `this.retained.elevation`/`sim.width`/`sim.height` already in hand, the
 * same way `units/pick.ts`'s `unitsInScreenRect` already threads elevation
 * through `worldToScreenThree`'s `lift` for the opposite direction. Kept
 * here rather than folded only into `ThreeRenderer` so it stays a pure
 * function, testable in `environment: 'node'` with no `WebGLRenderer` --
 * `ThreeRenderer` itself has none of its own tests to carry this instead
 * (see `units/instances.ts`'s own top comment for why).
 *
 * Ported one-iteration approximation, not a full height-field raycast: cast
 * the ray against the FLAT (`y = 0`) plane first, read the elevation of the
 * tile that lands on, then re-cast the SAME ray against the plane at that
 * tile's own `groundWorldY` and return where THAT lands. Exactly Pixi's own
 * "read the height where the flat projection lands, undo that much lift,
 * and project again" (`renderer.ts`'s own comment on `groundOffset`) --
 * ported as a genuine 3D plane re-intersection rather than reproducing its
 * 2D pixel-shift arithmetic, because for an orthographic camera the two are
 * the same correction: shifting a world point by `dh` along +Y changes only
 * the projected screen-Y (by `dh` converted through `WORLD_Y_PER_LIFT_PIXEL`
 * and the frustum scale), never screen-X, which is exactly what licenses
 * Pixi's own single-axis `sy`-only correction and is proven directly by
 * `worldToScreenThree`'s own `lift` parameter (this file's "puts higher
 * ground higher on screen" test).
 *
 * Correct on flat ground and on a single terrace (matches Pixi exactly
 * there -- both are ONE iteration of the same correction). Approximate near
 * a terrace EDGE, for the identical reason Pixi's own comment gives: one
 * screen point can correspond to several tiles at different heights, and
 * only a full height-field raycast resolves that exactly -- worth building
 * if it proves needed, not before. See `camera.test.ts`'s per-tile sweep
 * over `tel_marum`'s real relief (the only shipped map with any) for the
 * measured pick-rate this approximation buys back.
 */
export function screenToWorldThree(
  px: number,
  py: number,
  cam: Camera,
  vp: Viewport,
  elevation: Uint8Array | null = null,
  mapWidth = 0,
  mapHeight = 0
): { x: number; y: number } {
  const camera = dimetricCamera(cam, vp);
  const ndcX = (px / vp.width) * 2 - 1;
  const ndcY = 1 - (py / vp.height) * 2;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const flat = intersectHorizontalPlane(raycaster, 0);
  const liftY = groundWorldY(elevation, mapWidth, mapHeight, flat.x, flat.z);
  if (liftY === 0) return { x: flat.x, y: flat.z };

  const corrected = intersectHorizontalPlane(raycaster, liftY);
  return { x: corrected.x, y: corrected.z };
}
