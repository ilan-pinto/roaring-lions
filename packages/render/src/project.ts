/**
 * The dimetric projection, as arithmetic rather than as a renderer.
 *
 * Split out of `renderer.ts` for two reasons. It is pure — no Pixi, no DOM, no
 * sim — so it can be tested in `environment: 'node'` where the renderer itself
 * cannot be built at all. And `packages/app` used to import `isoX`/`isoY` and
 * redo the camera arithmetic itself, which made the app a second and
 * independently drifting source of truth for where things are on screen; that
 * call site now asks the renderer instead, and the renderer answers from here.
 *
 * A three.js backend will NOT use these functions — there the projection is the
 * camera. That is the point of the seam: `Renderer.worldToScreen` is the
 * contract, and this file is one backend's way of honouring it.
 */

/** Tile footprint in screen pixels at zoom 1. 2:1 dimetric. */
export const TILE_W = 64;
export const TILE_H = 32;

/** Screen pixels per elevation level.
 *
 * 10 px means a 4-level ridge stands 40 px against TILE_H's 32 and a building's
 * 18 -- clearly taller than a building without dwarfing the units on it. The
 * number is a judgement nobody had seen rendered when it was chosen, and it is
 * one line to change. */
export const ELEV_STEP = 10;

/**
 * Pitch (from horizontal), in radians, of `three/camera.ts`'s dimetric
 * camera -- Pixi has no camera to pitch. The VALUE is pure arithmetic over
 * `TILE_W`/`TILE_H`, so it lives here rather than there: this file imports
 * nothing at all, three.js included, and `terrain/ground.ts` and its
 * siblings need the constant below without paying for a three.js import
 * merely to reach a number. `camera.ts` imports this back for its own use
 * (`SIN_EL`, `VIEW_DIRECTION`) and re-exports it for importers that already
 * go through it; see its doc comment there for why 30 degrees is the pitch
 * that makes the three.js camera agree with Pixi's flat projection, rather
 * than the `atan(TILE_H/TILE_W)` ~= 26.565 degrees that also passes every
 * ground-only projection test.
 */
export const ELEVATION = Math.asin(TILE_H / TILE_W);

/**
 * A raw `lift` pixel (see `worldToScreen`'s doc comment above) converts to
 * this many `three/camera.ts` world-Y units. A world-Y offset of `dh`
 * contributes `dh * cos(EL)` to that camera's view-space-Y, projecting (at
 * its square-pixel scale) to `dh * cos(EL) * TILE_W/sqrt2` screen pixels at
 * zoom 1. Setting that equal to the desired `1` pixel per raw `lift` pixel
 * and solving for `dh` gives this constant -- independent of `cam`/`vp`/
 * zoom, like `wx`/`wy` themselves. Lives here for the same reason
 * `ELEVATION` does: pure arithmetic, needed by terrain builders that must
 * not import three.js to reach it.
 */
export const WORLD_Y_PER_LIFT_PIXEL = (Math.SQRT2 * Math.tan(ELEVATION)) / TILE_H;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** World (tile) coords → unscaled, uncentred dimetric screen offsets. */
export function isoX(x: number, y: number): number {
  return ((x - y) * TILE_W) / 2;
}

export function isoY(x: number, y: number): number {
  return ((x + y) * TILE_H) / 2;
}

/**
 * World point → pixel in the viewport.
 *
 * `lift` is how far terrain raises this tile up the screen, in unscaled pixels.
 * It is subtracted before the zoom multiply, matching the draw path, so a
 * raised tile and the sprite standing on it move together at every zoom.
 * Callers that deliberately want the flat projection pass 0 — the cursor
 * readout does exactly that, because `screenToWorld` only approximates the
 * inverse of the lift and reporting an unlifted answer is honest where
 * pretending would not be.
 */
export function worldToScreen(
  wx: number,
  wy: number,
  cam: Camera,
  vp: Viewport,
  lift = 0
): { x: number; y: number } {
  const z = cam.zoom;
  return {
    x: (isoX(wx, wy) - isoX(cam.x, cam.y)) * z + vp.width / 2,
    y: (isoY(wx, wy) - lift - isoY(cam.x, cam.y)) * z + vp.height / 2,
  };
}

/**
 * Pixel → world point, assuming flat ground.
 *
 * Named `Flat` because it is only half the inverse: terrain lift means one
 * screen point can correspond to several tiles at different heights, and
 * resolving that needs the height field. `PixiRenderer.screenToWorld` layers
 * that approximation on top of this.
 */
export function screenToWorldFlat(
  px: number,
  py: number,
  cam: Camera,
  vp: Viewport
): { x: number; y: number } {
  const z = cam.zoom;
  const sx = (px - vp.width / 2) / z + isoX(cam.x, cam.y);
  const sy = (py - vp.height / 2) / z + isoY(cam.x, cam.y);
  return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
}
