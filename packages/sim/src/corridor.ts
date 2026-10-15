// Held-ground income (F2, D5): the tiles a supply convoy drives between a zone and its
// rear. Along the road where a road-connected path joins the two ends' nearest road tiles,
// else along the wheeled flow field. Pure: it reads a narrow `RouteSource`, never a Sim, so
// the mission runtime (Task 7) can build one from `sim.blockedVehicle` and `sim.elevation`
// without going through the private, pooled `Sim.fieldFor` (calling that writes sim state).
// Integer only; no clock, no PRNG.

import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from './flowfield';

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
