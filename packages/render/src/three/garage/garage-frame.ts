/**
 * The garage stage's numbers and its framing arithmetic (GH-316), kept apart
 * from the door (`garage-view.ts`) so every rule here is tested in
 * `environment: 'node'` with no `WebGLRenderer`. Three's MATHS classes need
 * no GPU, which is why this file may use `Vector3` and `PerspectiveCamera`
 * and still be pure.
 *
 * ## The stage, in the garage's own frame
 *
 * The camera never moves. It sits on world `+X`, looking back at the origin,
 * so screen-right is world `-Z` and screen-left is `+Z`. The MODEL turns
 * under it -- the campaign board's precedent, and the reason the key light
 * stays put in the room while the shadow swings with the turn.
 *
 * A mesh unit is built facing local `+X` (`mesh-unit-contract.md`, "Forward
 * is +X"), and `rotation.y = theta` sends local `+X` to world
 * `(cos theta, 0, -sin theta)` (`mesh-anim.ts`'s `meshYawFromFacing` has the
 * derivation). So at yaw 0 a figure faces the camera square on.
 *
 * ## The numbers were the approved mock's, and are restated here
 *
 * The mock that the lead ruled on (1 Oct, GH-316) measured FOV 30 for every
 * class, a camera 12 degrees above the horizon for figures and 18 for
 * vehicles, a key 40 degrees off the camera axis and 50 up, a cool fill 55
 * degrees the other way and 20 up, exposure 1.1, and NDC margins of 0.94
 * across and 0.86 down. Each is a named constant below so a reader can find
 * the one they want to argue with.
 */
import * as THREE from 'three';
import { VIEW_DIRECTION } from '../camera';
import { SUN_DIRECTION } from '../lighting';

/** What the stage is framing. `figures` is any rigged team (one GLB, one or
 *  more people); `vehicle` is everything on the rigid vehicle path, aircraft
 *  included. There is ONE stage for every class (the lead's default, Q5):
 *  the class changes the camera's height, never the platform. */
export type GarageClass = 'figures' | 'vehicle';

/** Vertical field of view, every class. */
export const GARAGE_FOV_DEG = 30;

/** Camera height above the horizon. 12 reads a soldier as a person rather
 *  than a hat; 18 shows a tank's turret roof and engine deck. */
export const GARAGE_ELEVATION_DEG: Readonly<Record<GarageClass, number>> = {
  figures: 12,
  vehicle: 18,
};

/** How much of the frame the swept model may fill, in NDC. Tighter across
 *  than down because the bay's hint line and kit mark sit in the corners. */
export const GARAGE_MARGIN_X = 0.94;
export const GARAGE_MARGIN_Y = 0.86;

/** The key: this far off the camera axis, on the SUN's screen side, and this
 *  high. */
export const KEY_AZIMUTH_DEG = 40;
export const KEY_ELEVATION_DEG = 50;
export const KEY_INTENSITY = 3.2;
/** The fill: the other side, low and cool, about a fifth of the key. */
export const FILL_AZIMUTH_DEG = 55;
export const FILL_ELEVATION_DEG = 20;
export const FILL_INTENSITY = 0.7;
export const HEMI_INTENSITY = 0.7;
export const GARAGE_EXPOSURE = 1.1;

/** The sand patch: this many times the model's swept radius, fading to
 *  nothing from `SAND_FADE_START` of its own radius outward. */
export const SAND_RADIUS_OF_SWEEP = 1.4;
export const SAND_FADE_START = 0.62;

/**
 * Which side of the screen the game's sun is on: `+1` left, `-1` right.
 *
 * DERIVED rather than written down, from the same two vectors the mission
 * uses -- `lighting.ts`'s `SUN_DIRECTION` (toward the sun) and `camera.ts`'s
 * `VIEW_DIRECTION` (from the target toward the camera). The camera's
 * screen-left in the ground plane is `VIEW_DIRECTION x up`; the sun is on
 * the left exactly when its own ground-plane direction has a positive share
 * of that. Today that is `+1` (`lighting.ts`: "135 is the camera's LEFT"),
 * and if the sun is ever moved the garage's key follows it.
 */
export function sunScreenSide(
  sun: THREE.Vector3 = SUN_DIRECTION,
  view: THREE.Vector3 = VIEW_DIRECTION
): 1 | -1 {
  const left = new THREE.Vector3().crossVectors(view, new THREE.Vector3(0, 1, 0));
  return sun.x * left.x + sun.z * left.z >= 0 ? 1 : -1;
}

/** A light's direction (toward the light) in the garage frame, from its
 *  angle off the camera axis toward screen-LEFT (`+Z`) and its height. */
export function stageLightDirection(azimuthLeftDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthLeftDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

/** The key and the fill, both on the sides `sunScreenSide` picks. */
export function stageLights(side: 1 | -1 = sunScreenSide()): { key: THREE.Vector3; fill: THREE.Vector3 } {
  return {
    key: stageLightDirection(side * KEY_AZIMUTH_DEG, KEY_ELEVATION_DEG),
    fill: stageLightDirection(-side * FILL_AZIMUTH_DEG, FILL_ELEVATION_DEG),
  };
}

/**
 * The turn (degrees, for the model's `rotation.y`) that puts this class's
 * BROAD face toward the key -- the lead's default for "where does 0 sit".
 *
 * A figure's broad face is its front (shoulders square to the key, `+X`). A
 * vehicle's is its flank (`+Z` or `-Z`, whichever lands its nose on the side
 * AWAY from the key, so the light rakes from behind the camera along the
 * hull rather than into its face). Solved, not tabled: with the key at angle
 * `a` toward `+Z`, a face normal `(nx, nz)` turned by `theta` lands at
 * `(nx cos + nz sin, -nx sin + nz cos)`, which must equal `(cos a, sin a)`.
 */
export function defaultYawDeg(cls: GarageClass, side: 1 | -1 = sunScreenSide()): number {
  const a = side * KEY_AZIMUTH_DEG;
  // Front (+X): theta = -a. Flank (+Z * side): theta = side * 90 - a.
  const deg = cls === 'figures' ? -a : side * 90 - a;
  return wrapDegrees(deg);
}

/** Any angle into `[0, 360)`. `-0` comes out as `0`. */
export function wrapDegrees(deg: number): number {
  const r = deg % 360;
  const w = r < 0 ? r + 360 : r;
  return w === 0 ? 0 : w;
}

export interface CameraFit {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly distance: number;
}

/**
 * Place a fixed perspective camera on `+X`, `elevationDeg` above the
 * horizon, at the SMALLEST distance at which every point of `points` lands
 * inside the NDC margins -- then re-centre on what it sees, and repeat.
 *
 * `points` must already be the model SWEPT through the whole 360-degree turn
 * (the door samples it at every 15 degrees), so the model never changes size
 * as it turns: the fit is made once per unit, never per frame. And they are
 * the model's real visible vertices, not its bounding box -- the campaign
 * board measured fitting a box over a footprint as a 1.25x loss of drawn
 * size.
 *
 * Fitting and centring alternate (five rounds) because each moves the
 * other: a single fit made before centring leaves the slack on the
 * off-centre side unused. The distance is a 40-step bisection, so it is
 * exact to far below a pixel.
 */
export function fitCamera(
  points: readonly THREE.Vector3[],
  fovDeg: number,
  elevationDeg: number,
  aspect: number,
  marginX = GARAGE_MARGIN_X,
  marginY = GARAGE_MARGIN_Y
): CameraFit {
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.01, 1000);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  let maxY = 0;
  for (const p of points) maxY = Math.max(maxY, p.y);
  const target = new THREE.Vector3(0, maxY / 2, 0);
  const q = new THREE.Vector3();
  const place = (d: number): void => {
    cam.position.set(target.x + Math.cos(el) * d, target.y + Math.sin(el) * d, target.z);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
  };
  const fits = (d: number): boolean => {
    place(d);
    for (const p of points) {
      q.copy(p).project(cam);
      // Behind the camera projects to a mirrored point that can read as
      // inside the frame, so it must fail outright.
      if (q.z > 1 || Math.abs(q.x) > marginX || Math.abs(q.y) > marginY) return false;
    }
    return true;
  };
  let distance = 200;
  for (let round = 0; round < 5; round++) {
    let lo = 0.05;
    let hi = 200;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    distance = hi;
    place(distance);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      q.copy(p).project(cam);
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    const halfH = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * distance;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    target.addScaledVector(up, ((y0 + y1) / 2) * halfH);
    target.addScaledVector(right, ((x0 + x1) / 2) * halfH * aspect);
  }
  place(distance);
  return { position: cam.position.clone(), target: target.clone(), distance };
}

/**
 * How far apart two neighbouring figures must stand so that they NEVER
 * touch, at any angle of the free turn.
 *
 * Each figure turns on its own spot (the lead's ruling), and they all turn
 * together, so at some angle every rifle points straight along the line at
 * the next man. `a` and `b` are each figure's visible points as offsets from
 * its OWN turn axis (`x` toward the camera, `z` along the line, `b` standing
 * at `+z` of `a`). At turn `t` a point's `z` becomes `-x sin t + z cos t`; the
 * spacing must beat `a`'s furthest reach toward `b` plus `b`'s furthest reach
 * back toward `a`, at the worst of every `stepDeg`, plus `LINE_GAP`.
 *
 * The approved mock hand-set 0.30 world units for the Rifle Squad and 0.36
 * for the Spike team; both can be turned into each other (a rifle at 90
 * degrees passes through the neighbour's back). This derives the spacing
 * instead, so no turn the player can make puts one figure inside another.
 */
export const LINE_GAP = 0.02;

export function clearSpacing(
  a: readonly { readonly x: number; readonly z: number }[],
  b: readonly { readonly x: number; readonly z: number }[],
  stepDeg = 5
): number {
  if (a.length === 0 || b.length === 0) return 0;
  let worst = 0;
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const t = THREE.MathUtils.degToRad(deg);
    const sn = Math.sin(t);
    const cs = Math.cos(t);
    let reachA = -Infinity;
    for (const p of a) reachA = Math.max(reachA, -p.x * sn + p.z * cs);
    let reachB = Infinity;
    for (const p of b) reachB = Math.min(reachB, -p.x * sn + p.z * cs);
    worst = Math.max(worst, reachA - reachB);
  }
  return worst + LINE_GAP;
}
