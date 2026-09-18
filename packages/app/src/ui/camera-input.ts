/**
 * Pure camera-input maths shared by `main.ts`'s wheel listener (zoom to
 * cursor) and its rAF loop (edge pan), pulled out so both can be tested
 * without booting the shell.
 *
 * `clampZoom` is the single source of the 0.35..2.5 range: the wheel
 * listener used to inline two magic numbers on the plain-zoom path, and this
 * is now the only place that range is written. `packages/render/src/three/
 * units/silhouette.ts` mentions the same range in a comment only and is left
 * alone -- it does not read this constant and nothing asked it to.
 */

/** Pixels of margin inside each edge of the play surface across which edge
 *  pan ramps from zero to full strength. */
export const EDGE_MARGIN_PX = 16;
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2.5;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function axisPull(pos: number, size: number, marginPx: number): number {
  if (pos < marginPx) return -(marginPx - pos) / marginPx;
  if (pos > size - marginPx) return (pos - (size - marginPx)) / marginPx;
  return 0;
}

/**
 * How hard edge pan should push for a pointer at `(px, py)` over a surface
 * `w` x `h`, ramping linearly across `marginPx` at each edge. Zero when the
 * pointer sits outside the surface entirely -- deliberately, not merely
 * clamped -- because a `pointerleave` that never fires (the window loses
 * focus mid-drag, or the OS eats the event) would otherwise leave the last
 * in-bounds reading in effect and pan the camera off the map forever. The
 * caller's own `pointerInside` flag covers the ordinary case; this covers
 * the one it cannot.
 */
export function edgeVector(
  px: number,
  py: number,
  w: number,
  h: number,
  marginPx: number
): { right: number; down: number } {
  if (px < 0 || px > w || py < 0 || py > h) return { right: 0, down: 0 };
  return { right: axisPull(px, w, marginPx), down: axisPull(py, h, marginPx) };
}

/**
 * Turns an edge-pull vector into a camera delta, reproducing the WASD pan in
 * `main.ts`'s rAF loop exactly: this is a dimetric view, not a top-down one,
 * so screen-up is world (-x, -y), screen-down is (+x, +y), screen-left is
 * (-x, +y) and screen-right is (+x, -y). Edge pan and the pan keys share this
 * function's caller-side speed term (`panSpeed`) so the two never disagree
 * about how fast the camera moves, only about what starts it moving.
 */
export function panDelta(right: number, down: number, speed: number): { dx: number; dy: number } {
  return { dx: (right + down) * speed, dy: (down - right) * speed };
}

/**
 * The camera shift that keeps the world point under the cursor fixed on
 * screen across a zoom change: `before` and `after` are that point read via
 * `screenToWorld` immediately before and after the zoom is applied.
 */
export function zoomAnchor(
  cam: { x: number; y: number },
  before: { x: number; y: number },
  after: { x: number; y: number }
): { x: number; y: number } {
  return { x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y) };
}
