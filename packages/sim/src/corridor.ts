// Held-ground income (F2, D5): the tiles a supply convoy drives between a zone and its
// rear. Along the road where a road-connected path joins the two ends' nearest road tiles,
// else along the wheeled flow field. Pure: it reads a narrow `RouteSource`, never a Sim, so
// the mission runtime (Task 7) can build one from `sim.blockedVehicle` and `sim.elevation`
// without going through the private, pooled `Sim.fieldFor` (calling that writes sim state).
// Integer only; no clock, no PRNG.

import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from './flowfield';
import type { HoldView } from './income';
import { CONTEST_RADIUS_SQ, CORRIDOR_INTERDICT_SQ, CORRIDOR_VENT_SQ } from './tuning';

export interface TileXY {
  readonly x: number;
  readonly y: number;
}

/** What a route is computed from. Narrow on purpose. */
export interface RouteSource {
  readonly width: number;
  readonly height: number;
  /** 1 = a wheeled or tracked unit cannot enter: `blocked | boulder`, which is `sim.blockedVehicle`. */
  readonly vehicleMask: Uint8Array;
  /** 1 where the map's decor is a road; null or all zero = the map has no roads. */
  readonly roadMask: Uint8Array | null;
  /** A vehicle-domain flow field whose goal is (gx, gy). The caller may cache by goal. */
  fieldFor(gx: number, gy: number): FlowField;
}

/** A `RouteSource` whose fields are fresh `FlowField`s over `vehicleMask` and `elevation`
 *  (so climbs are priced as a unit's are). Nothing is cached: the owner of the mask knows
 *  when it changed. */
export function makeRouteSource(
  width: number,
  height: number,
  vehicleMask: Uint8Array,
  elevation: Uint8Array,
  roadMask: Uint8Array | null,
): RouteSource {
  return {
    width,
    height,
    vehicleMask,
    roadMask,
    fieldFor(gx: number, gy: number): FlowField {
      const f = new FlowField(width, height);
      f.compute(vehicleMask, elevation, gx, gy);
      return f;
    },
  };
}

// Scratch shared by every call, flowfield.ts's idiom: the route is recomputed on a slow
// cadence, never per tick, and the sim is single-threaded.
let scratchRoute = new Int32Array(0);
let scratchParent = new Int32Array(0);
let scratchQueue = new Int32Array(0);
function scratchFor(cells: number): void {
  if (scratchParent.length < cells) {
    scratchParent = new Int32Array(cells);
    scratchQueue = new Int32Array(cells);
  }
  // Three legs, each at most one visit per tile.
  if (scratchRoute.length < cells * 3 + 3) scratchRoute = new Int32Array(cells * 3 + 3);
}

/** Append the field's walk from `a` to `b` (field goal = b) to scratchRoute at `n`,
 *  leaving out `a` itself when `skipFirst`. Returns the new length, or -1 if the field
 *  has no way from `a` to `b`. The step cap turns a cycle into a null, not a hang. */
function walkField(field: FlowField, cells: number, w: number, a: number, b: number, n: number, skipFirst: boolean): number {
  let cur = a;
  if (!skipFirst) scratchRoute[n++] = cur;
  for (let steps = 0; cur !== b; steps++) {
    if (steps >= cells) return -1;
    const d = field.dirs[cur];
    if (d === DIR_NONE) return -1;
    cur += DIR_DY[d] * w + DIR_DX[d];
    scratchRoute[n++] = cur;
  }
  return n;
}

/**
 * The tiles a convoy drives from `from` to `to`, inclusive, as indices `y * width + x`,
 * every consecutive pair 8-adjacent.
 *
 * 1. `from` or `to` off the map or blocked on the vehicle mask: null.
 * 2. No road tile open to vehicles: the flow route, walking `fieldFor(to)` from `from`.
 *    A break before `to` is null (D4 a: no wheeled route).
 * 3. Otherwise R_from / R_to are the open road tiles nearest `from` / `to` (smallest squared
 *    tile distance, ties to the lowest index). If a BFS over road tiles joins them, the route
 *    is the field walk `from` -> R_from, the BFS path, and the field walk R_to -> `to`, with
 *    no tile repeated at a junction; a leg with no way through makes the whole route null.
 *    If no road path joins them it is case 2.
 *
 * The BFS takes neighbours in direction order 0..7 and a diagonal only when both orthogonal
 * companions are open, the corner rule `FlowField.compute` applies.
 */
export function corridorRoute(src: RouteSource, from: TileXY, to: TileXY): Int32Array | null {
  const w = src.width;
  const h = src.height;
  const mask = src.vehicleMask;
  if (from.x < 0 || from.y < 0 || from.x >= w || from.y >= h) return null;
  if (to.x < 0 || to.y < 0 || to.x >= w || to.y >= h) return null;
  const a = from.y * w + from.x;
  const b = to.y * w + to.x;
  if (mask[a] !== 0 || mask[b] !== 0) return null;
  const cells = w * h;
  scratchFor(cells);

  const roads = src.roadMask;
  let rFrom = -1;
  let rTo = -1;
  if (roads !== null) {
    let bestFrom = 0x7fffffff;
    let bestTo = 0x7fffffff;
    for (let t = 0; t < cells; t++) {
      if (roads[t] === 0 || mask[t] !== 0) continue;
      const x = t % w;
      const y = (t - x) / w;
      const df = (x - from.x) * (x - from.x) + (y - from.y) * (y - from.y);
      if (df < bestFrom) {
        bestFrom = df;
        rFrom = t;
      }
      const dt = (x - to.x) * (x - to.x) + (y - to.y) * (y - to.y);
      if (dt < bestTo) {
        bestTo = dt;
        rTo = t;
      }
    }
  }

  if (roads !== null && rFrom >= 0 && roadPath(src, rFrom, rTo)) {
    // scratchParent now holds the BFS tree rooted at rFrom; read the path out of it.
    let len = 1;
    for (let t = rTo; t !== rFrom; t = scratchParent[t]) len++;
    const rx = rFrom % w;
    const ry = (rFrom - rx) / w;
    const first = walkField(src.fieldFor(rx, ry), cells, w, a, rFrom, 0, false);
    if (first < 0) return null;
    // The BFS path, forward: it is read backwards from R_to, so fill from the end.
    const roadStart = first - 1; // R_from is already the last tile of the first leg
    let n = roadStart + len;
    for (let t = rTo; ; t = scratchParent[t]) {
      scratchRoute[--n] = t;
      if (t === rFrom) break;
    }
    const end = roadStart + len;
    const tx = b % w;
    const last = walkField(src.fieldFor(tx, (b - tx) / w), cells, w, rTo, b, end, true);
    if (last < 0) return null;
    return scratchRoute.slice(0, last);
  }

  const tx = b % w;
  const n = walkField(src.fieldFor(tx, (b - tx) / w), cells, w, a, b, 0, false);
  return n < 0 ? null : scratchRoute.slice(0, n);
}

/** BFS over open road tiles from `start`, filling scratchParent (start's parent is itself).
 *  True when `goal` was reached. */
function roadPath(src: RouteSource, start: number, goal: number): boolean {
  const w = src.width;
  const h = src.height;
  const mask = src.vehicleMask;
  const roads = src.roadMask;
  if (roads === null) return false;
  const parent = scratchParent;
  const queue = scratchQueue;
  parent.fill(-1, 0, w * h);
  parent[start] = start;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const t = queue[head++];
    if (t === goal) return true;
    const tx = t % w;
    const ty = (t - tx) / w;
    for (let d = 0; d < 8; d++) {
      const nx = tx + DIR_DX[d];
      const ny = ty + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (parent[n] !== -1 || roads[n] === 0 || mask[n] !== 0) continue;
      if ((d & 1) === 1 && (mask[ty * w + nx] !== 0 || mask[ny * w + tx] !== 0)) continue;
      parent[n] = t;
      queue[tail++] = n;
    }
  }
  return false;
}

/** Why a convoy route is cut (D4): no wheeled route at all, an open vent of a hostile-stocked
 *  tunnel beside it, or an uncontested enemy on it. null = the line is open. */
export type CutCause = 'unreachable' | 'interdicted' | 'vent' | null;

/** The tunnel slice `corridorCut` reads, narrow so a test builds it from literals and Task 7
 *  adapts a `Sim` to it (`tunnelCount`, `tnAlive`, `tnVentOpen`, `tnDigger` are the sim's own;
 *  `ventAt` is `Sim.tunnelVent`). */
export interface VentView {
  /** The map width in tiles: a route holds tile indices `y * width + x`. */
  readonly width: number;
  /** Routes to scan: 0..tunnelCount-1. */
  readonly tunnelCount: number;
  readonly tnAlive: ArrayLike<number>;
  readonly tnVentOpen: ArrayLike<number>;
  /** The unit digging the route, -1 when none. */
  readonly tnDigger: ArrayLike<number>;
  /** The vent's tile centre, Q16.16. */
  ventAt(r: number): readonly [number, number];
}

/** Is the Q16.16 point (px, py) within `sq` of any route tile's centre? Units are the
 *  mission.ts convention: per axis `(a - b) >> 8`, then dx*dx + dy*dy <= sq. */
function nearRoute(route: Int32Array, w: number, px: number, py: number, sq: number): boolean {
  for (let k = 0; k < route.length; k++) {
    const t = route[k];
    const tx = t % w;
    const ty = (t - tx) / w;
    const dx = ((px - ((tx << 16) + 32768)) >> 8) | 0;
    const dy = ((py - ((ty << 16) + 32768)) >> 8) | 0;
    if (dx * dx + dy * dy <= sq) return true;
  }
  return false;
}

/** A living surface ground unit: the only kind that interdicts or contests. */
function onGround(view: HoldView, i: number): boolean {
  return view.alive[i] !== 0 && view.tunnelIn[i] < 0 && !view.isAir(i);
}

/** Is route `r` stocked by the enemy: a living enemy buried in it, or an enemy digger? */
function hostileStocked(view: HoldView & VentView, r: number, enemy: number): boolean {
  const d = view.tnDigger[r];
  if (d >= 0 && view.alive[d] !== 0 && view.side[d] === enemy) return true;
  for (let i = 0; i < view.entityCount; i++) {
    if (view.alive[i] !== 0 && view.tunnelIn[i] === r && view.side[i] === enemy) return true;
  }
  return false;
}

/**
 * D4: what cuts the supply route that serves `holder` (the enemy is the other of 0 and 1;
 * side 2 is nobody). Precedence unreachable > vent > interdicted, for the HUD's one reason.
 *
 * - `route === null`: 'unreachable'.
 * - 'vent': a live route with its vent open and stocked by the enemy (a living enemy buried
 *   in it, or its digger) whose vent centre is within CORRIDOR_VENT_SQ of a route tile.
 * - 'interdicted': a living surface ground enemy within CORRIDOR_INTERDICT_SQ of a route tile
 *   and no living surface ground unit of the holder within CONTEST_RADIUS_SQ of that enemy
 *   (contested, not cut). Aircraft neither interdict nor contest; civilians never do.
 */
export function corridorCut(view: HoldView & VentView, route: Int32Array | null, holder: 0 | 1): CutCause {
  if (route === null) return 'unreachable';
  const w = view.width;
  const enemy = holder === 0 ? 1 : 0;

  for (let r = 0; r < view.tunnelCount; r++) {
    if (view.tnAlive[r] !== 1 || view.tnVentOpen[r] !== 1) continue;
    if (!hostileStocked(view, r, enemy)) continue;
    const v = view.ventAt(r);
    if (nearRoute(route, w, v[0], v[1], CORRIDOR_VENT_SQ)) return 'vent';
  }

  for (let i = 0; i < view.entityCount; i++) {
    if (view.side[i] !== enemy || !onGround(view, i)) continue;
    if (!nearRoute(route, w, view.posX[i], view.posY[i], CORRIDOR_INTERDICT_SQ)) continue;
    let contested = false;
    for (let j = 0; j < view.entityCount && !contested; j++) {
      if (view.side[j] !== holder || !onGround(view, j)) continue;
      const dx = ((view.posX[j] - view.posX[i]) >> 8) | 0;
      const dy = ((view.posY[j] - view.posY[i]) >> 8) | 0;
      contested = dx * dx + dy * dy <= CONTEST_RADIUS_SQ;
    }
    if (!contested) return 'interdicted';
  }
  return null;
}
