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
