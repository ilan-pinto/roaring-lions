/**
 * Pure camera-input maths shared by `main.ts`'s wheel listener (zoom to
 * cursor) and its rAF loop (key and edge pan), pulled out so all of it can be
 * tested without booting the shell.
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

/** One wheel notch in `WheelEvent.DOM_DELTA_PIXEL` units -- what Chromium,
 *  Safari and Firefox (since 88) all report for a mouse wheel click -- and the
 *  zoom factor that notch has always meant here (1.1 in, 1/1.1 out). */
const WHEEL_NOTCH_PX = 100;
const WHEEL_NOTCH_FACTOR = 1.1;
/** A line is ~33 px (Firefox's `DOM_DELTA_LINE`), a page ~10 notches. */
const WHEEL_LINE_PX = 100 / 3;
const WHEEL_PAGE_PX = 10 * WHEEL_NOTCH_PX;

/**
 * The zoom multiplier for one `wheel` event, PROPORTIONAL to how far the
 * wheel turned. The old handler stepped 10% per EVENT whatever its delta, so
 * a trackpad -- which reports a two-finger swipe as dozens of 1-10 px events
 * -- slammed from one end of the zoom range to the other in a flick, while a
 * notched mouse got the same 10% per click as before (it still does: deltaY
 * 100 is exactly 1.1x). One event is capped at two notches, so a single
 * high-resolution flick cannot jump the range either.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
  const notches = Math.max(-2, Math.min(2, px / WHEEL_NOTCH_PX));
  return Math.pow(WHEEL_NOTCH_FACTOR, -notches);
}

// --- pan: time-based, eased --------------------------------------------------

/**
 * Full pan speed, in tiles a second along EACH world axis the direction
 * moves (so screen-right is +18 x and -18 y a second), at zoom 1 and the
 * 1x camera-speed setting. Divided by zoom, so the speed on SCREEN is the
 * same at every zoom: 1152 px/s across and 576 px/s up and down (the ground
 * is foreshortened 2:1 by the dimetric view; the pan moves equal GROUND in
 * every direction, as it always has).
 *
 * It used to be 0.5 tiles a FRAME -- 30 tiles a second at 60 Hz, 72 at 144 Hz
 * -- which is how a 1.5 s hold of D crossed the whole 48-tile map in the
 * tutorial's first beat (PA-03). 18 is 60% of the old 60 Hz figure: about
 * 0.9 of a 1280 px screen a second across, still quicker than any unit moves.
 */
export const PAN_TILES_PER_SEC = 18;
/** From standstill to full speed. Long enough that a tap nudges rather than
 *  jumps, short enough that a hold never feels like it is catching up. */
export const PAN_ACCEL_MS = 120;
/** From full speed to standstill after release: a coast of
 *  `PAN_TILES_PER_SEC * PAN_DECEL_MS / 2000` = 0.81 tiles. Shorter than the
 *  ramp up on purpose -- a camera that keeps sliding after the key is up is
 *  the "floaty" the polish plan forbids. */
export const PAN_DECEL_MS = 90;
/** A frame longer than this pans as if it were this long, the same 100 ms
 *  the renderer's own `frameDtMs` clamps every presentation clock to: a tab
 *  returning from the background must not jump the camera across the map. */
export const PAN_MAX_DT_MS = 100;

/** Pan velocity as a FRACTION of full speed on each screen axis, -1..1. */
export interface PanVelocity {
  right: number;
  down: number;
}

/**
 * One axis of the ramp: move `v` toward `target` at the accelerate rate while
 * gaining speed in `target`'s direction and at the decelerate rate otherwise,
 * splitting the step where `v` crosses zero (a reversal brakes, then
 * accelerates). Returns the new velocity and the integral of velocity over
 * the step in fraction*ms -- exact, because velocity is piecewise linear in
 * time, which is what makes the distance the same at 60 Hz and 144 Hz.
 */
function rampAxis(v: number, target: number, dtMs: number): { v: number; area: number } {
  let area = 0;
  let left = dtMs;
  for (let phase = 0; phase < 3 && left > 0; phase++) {
    if (v === target) {
      area += v * left;
      left = 0;
      break;
    }
    const speeding = (target > v && v >= 0) || (target < v && v <= 0);
    const rate = 1 / (speeding ? PAN_ACCEL_MS : PAN_DECEL_MS);
    const dir = target > v ? 1 : -1;
    // Stop at the target, or at zero when braking through it.
    const stop = !speeding && Math.sign(target) !== Math.sign(v) && target !== 0 ? 0 : target;
    const need = Math.abs(stop - v) / rate;
    const t = Math.min(need, left);
    const nv = t === need ? stop : v + dir * rate * t;
    area += ((v + nv) / 2) * t;
    v = nv;
    left -= t;
  }
  return { v, area };
}

/**
 * Advance the pan velocity `vel` (mutated) toward `intent` -- the direction
 * the player is asking for, each axis -1..1, keys and edge pan summed -- over
 * a frame of `dtMs`, and return the world-tile camera delta that frame
 * covers. A diagonal intent is normalised to unit length, so holding W and D
 * together pans no faster than either alone (it used to be 1.41x).
 *
 * `speed` is the camera-speed setting (0.5..2); `zoom` the camera's.
 */
export function stepPan(
  vel: PanVelocity,
  intent: PanVelocity,
  dtMs: number,
  speed: number,
  zoom: number
): { dx: number; dy: number } {
  const dt = Math.max(0, Math.min(PAN_MAX_DT_MS, dtMs));
  let { right, down } = intent;
  right = Math.max(-1, Math.min(1, right));
  down = Math.max(-1, Math.min(1, down));
  const len = Math.hypot(right, down);
  if (len > 1) {
    right /= len;
    down /= len;
  }
  const r = rampAxis(vel.right, right, dt);
  const d = rampAxis(vel.down, down, dt);
  vel.right = r.v;
  vel.down = d.v;
  // `area` is fraction*ms; tiles = fraction * PAN_TILES_PER_SEC * s.
  const scale = (PAN_TILES_PER_SEC * speed) / (1000 * zoom);
  return panDelta(r.area, d.area, scale);
}

/** True while the camera is still moving under its own momentum or input. */
export function panning(vel: PanVelocity): boolean {
  return vel.right !== 0 || vel.down !== 0;
}

// --- bounds ------------------------------------------------------------------

/** How far past the map's outermost corner the view may show, in SCREEN
 *  pixels at any zoom: enough that the last row of tiles can be lifted clear
 *  of the HUD's bottom strip, small enough that the view is never mostly
 *  empty ground. */
export const BOUNDS_VOID_PX = 96;

/** `project.ts`'s tile size, restated: the bounds are pure arithmetic on
 *  the projection and this module imports nothing. Pinned against
 *  `@lions/render`'s `TILE_W`/`TILE_H` in the test. */
const HALF_TILE_W = 32;
const HALF_TILE_H = 16;

/**
 * Where the camera may look, for a map `map.width` x `map.height` tiles (tile
 * (x, y) covering [x, x+1] x [y, y+1]) seen through a viewport `vp` CSS px at
 * `cam.zoom`. Two rules, in this order:
 *
 *  1. The VIEW stays inside the map's on-screen bounding box -- the dimetric
 *     diamond's box -- plus `BOUNDS_VOID_PX`, on each screen axis separately.
 *     Where the view is wider (or taller) than that box, it is centred on it
 *     instead: fully zoomed out, the whole map sits in the middle of the
 *     screen rather than in a corner of it.
 *  2. The point the camera looks AT stays on the map. Rule 1 alone would let
 *     a zoomed-in view sit in a corner of the box, which on a diamond is
 *     empty ground; this rule wins where they disagree.
 *
 * Pan does not bounce or resist: the clamp is applied after each player move,
 * so pushing into an edge just stops there.
 */
export function clampCamera(
  cam: { x: number; y: number; zoom: number },
  map: { width: number; height: number },
  vp: { width: number; height: number }
): { x: number; y: number } {
  const z = cam.zoom;
  // Screen-space (unzoomed px) position of the focus, as `isoX`/`isoY`.
  let u = (cam.x - cam.y) * HALF_TILE_W;
  let v = (cam.x + cam.y) * HALF_TILE_H;
  const uMin = -map.height * HALF_TILE_W;
  const uMax = map.width * HALF_TILE_W;
  const vMin = 0;
  const vMax = (map.width + map.height) * HALF_TILE_H;
  const m = BOUNDS_VOID_PX / z;
  const axis = (p: number, lo: number, hi: number, half: number): number => {
    const a = lo - m + half;
    const b = hi + m - half;
    return a > b ? (lo + hi) / 2 : Math.min(b, Math.max(a, p));
  };
  if (vp.width > 0 && vp.height > 0) {
    u = axis(u, uMin, uMax, vp.width / (2 * z));
    v = axis(v, vMin, vMax, vp.height / (2 * z));
  }
  const x = (u / HALF_TILE_W + v / HALF_TILE_H) / 2;
  const y = (v / HALF_TILE_H - u / HALF_TILE_W) / 2;
  return { x: Math.min(map.width, Math.max(0, x)), y: Math.min(map.height, Math.max(0, y)) };
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

// --- middle-mouse drag pan ---------------------------------------------------

/** The middle button grabs the ground. Not the left (select) or right
 *  (order): both already mean something on the map. */
export function isPanDragButton(button: number): boolean {
  return button === 1;
}

export interface PanDrag {
  readonly active: boolean;
  start(x: number, y: number): void;
  /** The world-tile camera delta for a pointer now at `(x, y)` canvas px, from
   *  the LAST point seen, at the camera's `zoom`; null while no drag is on. */
  move(x: number, y: number, zoom: number): { dx: number; dy: number } | null;
  end(): void;
}

/**
 * A grab-drag: the ground follows the cursor, so the world point under it
 * stays under it. Position-based -- each move is the pointer's travel since
 * the last one -- so it is frame-rate independent by construction and has no
 * momentum to coast (the eased `stepPan` is for keys and edges, which have no
 * pointer to follow). The pixel travel is inverted through the dimetric
 * projection (screen u = (x - y) * 32 z, v = (x + y) * 16 z) and negated:
 * dragging right pulls the world right, so the camera moves left.
 */
export function createPanDrag(): PanDrag {
  let last: { x: number; y: number } | null = null;
  return {
    get active() {
      return last !== null;
    },
    start(x, y) {
      last = { x, y };
    },
    move(x, y, zoom) {
      if (last === null) return null;
      const du = x - last.x;
      const dv = y - last.y;
      last = { x, y };
      const gx = du / (HALF_TILE_W * zoom);
      const gy = dv / (HALF_TILE_H * zoom);
      // Inverse of u = (dx - dy) W z, v = (dx + dy) H z, then negated.
      // `0 -` and not a unary minus: a still pointer is +0, not -0.
      return { dx: 0 - (gx + gy) / 2, dy: 0 - (gy - gx) / 2 };
    },
    end() {
      last = null;
    },
  };
}

// --- zoom glide ----------------------------------------------------------------

/** A zoom step eases over this long (the polish plan's "~150 ms"). */
export const ZOOM_GLIDE_MS = 150;

export interface ZoomGlide {
  from: number;
  to: number;
  elapsedMs: number;
}

/**
 * What one wheel notch of `factor` does. Under reduced motion the zoom is the
 * target now and there is no glide. Otherwise it starts (or retargets) a glide
 * from where the zoom is NOW: the target accumulates from the glide's own
 * target, not from its current value, so several notches in quick succession
 * add up to what the same notches did when zoom was a step.
 */
export function planZoom(
  prev: ZoomGlide | null,
  current: number,
  factor: number,
  reducedMotion: boolean
): { zoom: number; glide: ZoomGlide | null } {
  const to = clampZoom((prev !== null ? prev.to : current) * factor);
  if (reducedMotion) return { zoom: to, glide: null };
  return { zoom: current, glide: { from: current, to, elapsedMs: 0 } };
}

/** Advance a glide by a frame (`g` mutated): the eased zoom, and whether it
 *  has arrived. Ease-out cubic on elapsed TIME, so the curve is the same at
 *  60 and 144 Hz, and the last step lands exactly on `to`. */
export function stepZoomGlide(g: ZoomGlide, dtMs: number): { zoom: number; done: boolean } {
  g.elapsedMs += Math.max(0, Math.min(PAN_MAX_DT_MS, dtMs));
  if (g.elapsedMs >= ZOOM_GLIDE_MS) return { zoom: g.to, done: true };
  const k = 1 - Math.pow(1 - g.elapsedMs / ZOOM_GLIDE_MS, 3);
  return { zoom: g.from + (g.to - g.from) * k, done: false };
}
