/**
 * The road network as a graph over `r` tiles, and the profile a ground
 * vertex samples from its distance to that graph -- Task 3 of
 * `docs/superpowers/sdd/2026-09-25-ground-plan-1`.
 *
 * G2: a diagonal chain of road tiles (`r..` / `.r.` / `..r`) used to draw as
 * disconnected diamonds, one per tile, because the old distance field only
 * ever measured to a tile CENTRE and never bridged the gap between two tiles
 * that touch only at a corner. `buildRoadGraph` makes that bridge an edge in
 * the graph -- one line through the diagonal instead of a string of beads --
 * while leaving an L-bend (which already has an orthogonal path through its
 * corner tile) alone, so a right-angle turn does not also grow a
 * triangle-filling diagonal.
 */
import { DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';

/** A road tile, by its map coordinates. Its centre -- the point every
 *  distance and segment calculation below actually measures to or from --
 *  is `(x + 0.5, y + 0.5)`. */
export interface RoadNode {
  readonly x: number;
  readonly y: number;
}

export interface RoadGraph {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly RoadNode[];
  /** `[a, b]` node-index pairs, one entry per edge, undirected. */
  readonly edges: readonly (readonly [number, number])[];
  /** Parallel to `nodes`: how many edges touch each node. */
  readonly degree: readonly number[];
  /** Parallel to `nodes`: the indices into `edges` that touch each node. */
  readonly incident: readonly (readonly number[])[];
  /** One entry per map tile (`y * width + x`): the node index standing on
   *  that tile, or `-1` if it carries no road node. */
  readonly nodeAt: Int32Array;
}

function isRoadNode(input: TerrainInput, x: number, y: number): boolean {
  if (x < 0 || x >= input.width || y < 0 || y >= input.height) return false;
  if (!input.decor) return false;
  const t = y * input.width + x;
  return input.decor[t] === DECOR_ROAD && input.blocked[t] === 0;
}

/**
 * One node per `r` tile that is not blocked, in scan order (row-major,
 * matching every other builder here). Orthogonal neighbours (east, south --
 * each unordered pair only needs one direction to avoid a duplicate edge)
 * are always linked. A diagonal to `(x+1, y+1)` is added only when NEITHER
 * `(x+1, y)` nor `(x, y+1)` is road -- an L-bend already has an orthogonal
 * route through whichever of those two tiles IS road, so a diagonal there
 * would draw a filled triangle rather than bridging a genuine gap. The
 * mirror diagonal to `(x-1, y+1)` follows the same rule.
 */
export function buildRoadGraph(input: TerrainInput): RoadGraph {
  const { width, height } = input;
  const nodeAt = new Int32Array(width * height).fill(-1);
  const nodes: RoadNode[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isRoadNode(input, x, y)) {
        nodeAt[y * width + x] = nodes.length;
        nodes.push({ x, y });
      }
    }
  }

  const edges: [number, number][] = [];
  const at = (x: number, y: number): number =>
    x < 0 || x >= width || y < 0 || y >= height ? -1 : nodeAt[y * width + x];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = nodeAt[y * width + x];
      if (here < 0) continue;

      const east = at(x + 1, y);
      if (east >= 0) edges.push([here, east]);
      const south = at(x, y + 1);
      if (south >= 0) edges.push([here, south]);

      const southEast = at(x + 1, y + 1);
      if (southEast >= 0 && east < 0 && south < 0) edges.push([here, southEast]);

      const southWest = at(x - 1, y + 1);
      const west = at(x - 1, y);
      if (southWest >= 0 && west < 0 && south < 0) edges.push([here, southWest]);
    }
  }

  const degree = new Array<number>(nodes.length).fill(0);
  const incident: number[][] = nodes.map(() => []);
  edges.forEach(([a, b], i) => {
    degree[a]++;
    degree[b]++;
    incident[a].push(i);
    incident[b].push(i);
  });

  return { width, height, nodes, edges, degree, incident, nodeAt };
}

/** A junction is any node where three or more road tiles meet -- the point
 *  a crossroads or a T needs its rut pattern to fade out around rather than
 *  draw two straight ruts through a filled intersection. */
export function isJunction(g: RoadGraph, n: number): boolean {
  return g.degree[n] >= 3;
}

function pointSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/**
 * Distance in tiles from `(px, pz)` to the road centreline: the point
 * distance to a degree-0 node (a lone road tile has no segment to measure
 * to) and the segment distance to every edge incident on a node in the
 * search window otherwise. `Infinity` when no road tile stands within two
 * tiles of the query point -- G2's diagonal bridging aside, this is still a
 * local search, not a full-graph one.
 */
export function roadDistanceAt(g: RoadGraph, px: number, pz: number): number {
  // A 5x5 tile window (two tiles each way), walked inline: this runs once per
  // control texel (147,456 of them on a 48x48 map), and the array, the
  // `Set` of seen edges and the two centre tuples it used to allocate per
  // query were a third of `buildControlMap`'s time. An edge reached from
  // both its ends is simply measured twice -- `min` of the same number is
  // the same number, so dropping the de-duplication changes no result.
  let best = Infinity;
  const cx = Math.floor(px);
  const cz = Math.floor(pz);
  for (let y = cz - 2; y <= cz + 2; y++) {
    if (y < 0 || y >= g.height) continue;
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || x >= g.width) continue;
      const n = g.nodeAt[y * g.width + x];
      if (n < 0) continue;
      if (g.degree[n] === 0) {
        best = Math.min(best, Math.hypot(px - (x + 0.5), pz - (y + 0.5)));
        continue;
      }
      for (const e of g.incident[n]) {
        const [a, b] = g.edges[e];
        const na = g.nodes[a];
        const nb = g.nodes[b];
        best = Math.min(best, pointSegmentDistance(px, pz, na.x + 0.5, na.y + 0.5, nb.x + 0.5, nb.y + 0.5));
      }
    }
  }
  return best;
}

/** Distance in tiles from `(px, pz)` to the nearest junction node
 *  (`isJunction`) in the same two-tile search window as `roadDistanceAt`.
 *  `Infinity` when none is that close. Allocation-free for the same reason. */
export function junctionDistanceAt(g: RoadGraph, px: number, pz: number): number {
  let best = Infinity;
  const cx = Math.floor(px);
  const cz = Math.floor(pz);
  for (let y = cz - 2; y <= cz + 2; y++) {
    if (y < 0 || y >= g.height) continue;
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || x >= g.width) continue;
      const n = g.nodeAt[y * g.width + x];
      if (n < 0 || !isJunction(g, n)) continue;
      best = Math.min(best, Math.hypot(px - (x + 0.5), pz - (y + 0.5)));
    }
  }
  return best;
}

// -- Road profile (spec §5) --------------------------------------------

/** Half the packed-surface width, in tiles either side of the centreline. */
export const ROAD_HALF_WIDTH = 0.36;
/** Width, in tiles, the surface edge softens across -- centred on
 *  `ROAD_HALF_WIDTH`, so it runs from `H - F/2` to `H + F/2`. */
export const ROAD_EDGE_FALLOFF = 0.18;
/** How far, in tiles, a wander signal (`bend`, typically an `fbm2` sample at
 *  `ROAD_EDGE_BEND_CYCLES`) can push the edge in or out. Keeps a long road's
 *  edge from reading as a perfectly straight ruler line. */
export const ROAD_EDGE_BEND = 0.08;
/** `fbm2` cycles-per-tile a caller samples `bend` at -- exported so the edge
 *  wander and whatever else reads it agree on the same frequency. */
export const ROAD_EDGE_BEND_CYCLES = 2;

/** Width, in tiles, of the bleached shoulder band just past the surface
 *  edge. */
export const SHOULDER_TILES = 0.12;
/** The shoulder's peak strength, at the surface edge itself. */
export const SHOULDER_ALPHA = 0.4;

/** Distance, in tiles either side of the centreline, of each wheel rut. */
export const RUT_OFFSET = 0.17;
/** Width, in tiles, of one rut. */
export const RUT_WIDTH = 0.06;
/** A rut's peak strength, away from any junction. */
export const RUT_ALPHA = 0.35;
/** Distance, in tiles, over which the ruts fade in as a query point moves
 *  away from a junction -- what keeps a crossroads from drawing four
 *  ruts as concentric rings through its own centre. */
export const RUT_JUNCTION_FADE = 0.4;

/** Cycle length, in tiles, of the road's own surface grain (a caller's
 *  `fbm2` sample), and the gain that grain is mixed in at. Exported for the
 *  same reason as `ROAD_EDGE_BEND_CYCLES`: the ground builder and this
 *  module must agree on the frequency without duplicating the constant. */
export const ROAD_GRAIN_TILES = 2;
export const ROAD_GRAIN_GAIN = 0.6;

export interface RoadProfile {
  /** 1 on packed road surface, fading to 0 past the edge. */
  readonly surface: number;
  /** 0..`SHOULDER_ALPHA`, a bleached band just past the surface edge. */
  readonly shoulder: number;
  /** 0..`RUT_ALPHA`, the two wheel-track darkenings, faded near a
   *  junction. */
  readonly rut: number;
}

/** The GLSL `smoothstep` exactly: a clamped cubic Hermite ease between
 *  `edge0` and `edge1`. Kept local (rather than reused from elsewhere in
 *  this backend) because it must be the CPU-side twin of whatever shader
 *  samples this same curve, bit-for-bit in behaviour if not in bits. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The road's cross-section at perpendicular distance `d` (tiles, always
 * `>= 0` -- both physical ruts read the same unsigned distance, since each
 * is equidistant from the centreline on its own side) from the centreline,
 * bent by `bend` (a signed wander sample, typically `fbm2` at
 * `ROAD_EDGE_BEND_CYCLES`) and faded near a junction by `junctionDist`
 * (tiles, from `junctionDistanceAt`).
 *
 * Ruts read the UNBENT `d` rather than the bent edge `e` -- they are worn
 * into the surface by traffic following the centreline, not by whatever
 * noise wobbles the surface's outer edge, so bending the edge must not also
 * shift the ruts out of parallel with it.
 */
export function roadProfile(d: number, bend: number, junctionDist: number): RoadProfile {
  const e = d + ROAD_EDGE_BEND * bend;
  const edgeLo = ROAD_HALF_WIDTH - ROAD_EDGE_FALLOFF / 2;
  const edgeHi = ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF / 2;
  const edgeT = smoothstep(edgeLo, edgeHi, e);
  const surface = 1 - edgeT;

  const shoulderT = 1 - smoothstep(edgeHi, edgeHi + SHOULDER_TILES, e);
  const shoulder = SHOULDER_ALPHA * edgeT * shoulderT;

  const rutLo = RUT_WIDTH / 2 - 0.01;
  const rutHi = RUT_WIDTH / 2 + 0.01;
  const rutBand = 1 - smoothstep(rutLo, rutHi, Math.abs(d - RUT_OFFSET));
  const junctionFade = smoothstep(0, RUT_JUNCTION_FADE, junctionDist);
  const rut = RUT_ALPHA * rutBand * junctionFade * surface;

  return { surface, shoulder, rut };
}
