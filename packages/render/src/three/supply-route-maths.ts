/**
 * S-F F2 C3: the world supply route's geometry, three-free so every number in
 * it is unit-tested (`supply-route-maths.test.ts`). `supply-route.ts` uploads
 * what this builds.
 *
 * The polyline is the TILE CENTRES of the route, in order. F2 exposes no road
 * centreline (the runtime hands over tile indices and nothing finer), so the
 * line is not smoothed onto the drawn road's curves: on a road it can sit up
 * to half a tile off the road's own centre where the road bends. Recorded,
 * not hidden; if the runtime ever exposes a centreline, this is the one
 * function that reads it.
 *
 * Each segment between two tile centres is its own strip, cut into
 * `SUPPLY_ROUTE_SAMPLES_PER_TILE` steps per tile of length so the ribbon
 * follows the bicubic ground rather than chording under a crest. Every
 * vertex is sampled on the drawn ground (`groundY`) and lifted by the decal
 * pool's own cap, `DECAL_LIFT_CAP`. Segments meet on a mitred join, so a
 * turn keeps the line's width instead of pinching it. A segment's
 * vertices are its own, never shared with its neighbour, which is what lets
 * `cut` be FLAT per segment: a shared vertex would interpolate the dash
 * flag across the boundary and fray the cut stretch's ends.
 *
 * `dist` is the distance along the route in tiles, continuous across every
 * join, so the cut stretch's dash phase does not jump at a turn. Nothing in
 * it depends on time: the dash is fixed to the ground and nothing animates
 * (Review Focus 5).
 */
import type { SupplyRouteView } from '../api';
import { DECAL_LIFT_CAP } from './decal-maths';

/** Half the ribbon's width, in tiles: a thin line, 0.14 tile across. */
export const SUPPLY_ROUTE_HALF_WIDTH_TILES = 0.07;
/** Ground samples per tile of segment length. */
export const SUPPLY_ROUTE_SAMPLES_PER_TILE = 4;
/** The lift off the drawn ground: the decal pool's own cap (F-23), the
 *  largest lift that measured clear of a unit standing in the mark. */
export const SUPPLY_ROUTE_LIFT = DECAL_LIFT_CAP;
/** The cut stretch's dash: period along the route, in tiles, and the share
 *  of each period drawn. */
export const SUPPLY_ROUTE_DASH_TILES = 0.5;
export const SUPPLY_ROUTE_DASH_DUTY = 0.55;
/** A mitre never reaches past this many half-widths (a hairpin would spike). */
const MITRE_LIMIT = 2;

export interface SupplyRibbon {
  /** xyz per vertex, world space. */
  readonly positions: Float32Array;
  /** Distance along its route, in tiles, per vertex. */
  readonly dist: Float32Array;
  /** 1 on the cut stretch (dashed `--warn`), 0 on the open line, per vertex. */
  readonly cut: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
}

/** Whether segment `j` (tile `j` to tile `j + 1`) lies on the cut stretch,
 *  an inclusive `[first, last]` span of tile indices. A one-tile span cuts no
 *  segment, exactly as the minimap's `routeLines` draws it. */
export function segmentIsCut(j: number, cutSpan: readonly [number, number] | null): boolean {
  return cutSpan !== null && j >= cutSpan[0] && j < cutSpan[1];
}

interface Pt {
  x: number;
  z: number;
}

function centres(tiles: ArrayLike<number>, width: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const p = { x: (t % width) + 0.5, z: Math.floor(t / width) + 0.5 };
    const last = out[out.length - 1];
    // A repeated tile is a zero-length segment with no direction: skip it.
    if (last === undefined || last.x !== p.x || last.z !== p.z) out.push(p);
  }
  return out;
}

/** The unit normal (left of travel, in xz) of the segment `a` -> `b`. */
function normalOf(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  return { x: -dz / len, z: dx / len };
}

/** The offset at a join: the bisector of the two normals, scaled so the
 *  strip keeps its width measured square to EACH segment. */
function mitre(n0: Pt, n1: Pt): Pt {
  const bx = n0.x + n1.x;
  const bz = n0.z + n1.z;
  const bl = Math.hypot(bx, bz);
  if (bl < 1e-9) return n1; // a full reversal: no bisector, fall back square
  const ux = bx / bl;
  const uz = bz / bl;
  const scale = Math.min(MITRE_LIMIT, 1 / (ux * n1.x + uz * n1.z));
  return { x: ux * scale, z: uz * scale };
}

/**
 * Every route as one ribbon geometry, merged so the whole set is one draw
 * call. `groundY(x, y)` is the drawn ground's world height at tile point
 * `(x, y)`.
 */
export function buildSupplyRibbon(
  routes: readonly SupplyRouteView[],
  width: number,
  groundY: (x: number, y: number) => number
): SupplyRibbon {
  // Pass 1: the polylines and the vertex count, so the arrays are sized once.
  const lines = routes.map((r) => ({ pts: width > 0 ? centres(r.tiles, width) : [], cutSpan: r.cutSpan }));
  let vertexCount = 0;
  let indexCount = 0;
  for (const { pts } of lines) {
    for (let j = 0; j + 1 < pts.length; j++) {
      const steps = stepsOf(pts[j], pts[j + 1]);
      vertexCount += (steps + 1) * 2;
      indexCount += steps * 6;
    }
  }
  const positions = new Float32Array(vertexCount * 3);
  const dist = new Float32Array(vertexCount);
  const cut = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);

  let v = 0;
  let k = 0;
  const w = SUPPLY_ROUTE_HALF_WIDTH_TILES;
  for (const { pts, cutSpan } of lines) {
    if (pts.length < 2) continue;
    // The repeated-tile skip in `centres` shifts indices only when a route
    // repeats a tile, which a runtime route never does; the span is read
    // against the polyline as given.
    let along = 0;
    for (let j = 0; j + 1 < pts.length; j++) {
      const a = pts[j];
      const b = pts[j + 1];
      const n = normalOf(a, b);
      const startOff = j > 0 ? mitre(normalOf(pts[j - 1], a), n) : n;
      const endOff = j + 2 < pts.length ? mitre(n, normalOf(b, pts[j + 2])) : n;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = stepsOf(a, b);
      const flag = segmentIsCut(j, cutSpan) ? 1 : 0;
      const first = v;
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const cx = a.x + (b.x - a.x) * f;
        const cz = a.z + (b.z - a.z) * f;
        // The offset eases from the start join to the end join; on a straight
        // run both are the segment's own normal and this is a plain strip.
        const ox = (startOff.x + (endOff.x - startOff.x) * f) * w;
        const oz = (startOff.z + (endOff.z - startOff.z) * f) * w;
        for (const side of [1, -1]) {
          const x = cx + ox * side;
          const z = cz + oz * side;
          positions[v * 3] = x;
          positions[v * 3 + 1] = groundY(x, z) + SUPPLY_ROUTE_LIFT;
          positions[v * 3 + 2] = z;
          dist[v] = along + len * f;
          cut[v] = flag;
          v++;
        }
      }
      for (let s = 0; s < steps; s++) {
        const l0 = first + s * 2;
        const r0 = l0 + 1;
        const l1 = l0 + 2;
        const r1 = l0 + 3;
        indices[k++] = l0;
        indices[k++] = r0;
        indices[k++] = l1;
        indices[k++] = r0;
        indices[k++] = r1;
        indices[k++] = l1;
      }
      along += len;
    }
  }
  return { positions, dist, cut, indices, vertexCount };
}

function stepsOf(a: Pt, b: Pt): number {
  return Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * SUPPLY_ROUTE_SAMPLES_PER_TILE - 1e-9));
}
