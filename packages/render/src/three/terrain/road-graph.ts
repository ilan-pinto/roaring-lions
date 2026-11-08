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
 *
 * A street authored two tiles wide (`rr` over `rr`) is ONE street, not a
 * ladder -- ground plan Task 6's ruling. As a plain graph it is two rows
 * joined by a rung at every tile, which drew a hole at the centre of every
 * 2x2 cell (0.5 from every edge) and a junction at every node (degree 3), so
 * the ruts faded out around each tile into a lattice. So every 2x2 block of
 * road is SOLID to `roadDistanceAt` -- distance 0 anywhere inside the square
 * its four centres span -- and `isJunction` counts a node's BRANCHES, not its
 * edges: a rung that only crosses the width of a street is not a branch.
 */
import { DECOR_ROAD } from './shared';
import { NUMBER_OPS } from '../fog-ops';
import { roadBands, type RoadBands } from './ground-maths';
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
  /** One entry per map tile: 1 where that tile is the top-left of a 2x2
   *  block of road nodes -- a piece of a two-wide street, drawn as the solid
   *  square `[x + 0.5, x + 1.5] x [y + 0.5, y + 1.5]` its centres span. */
  readonly solid: Uint8Array;
  /** Parallel to `nodes`: how many ways the road actually goes from each
   *  node -- `degree` less every rung across a two-wide street. What
   *  `isJunction` reads. */
  readonly branches: readonly number[];
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

  const road = (x: number, y: number): boolean => at(x, y) >= 0;
  const solid = new Uint8Array(width * height);
  for (let y = 0; y + 1 < height; y++) {
    for (let x = 0; x + 1 < width; x++) {
      if (road(x, y) && road(x + 1, y) && road(x, y + 1) && road(x + 1, y + 1)) solid[y * width + x] = 1;
    }
  }
  const inBlock = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && solid[y * width + x] === 1;

  // A branch is an edge the road actually continues along. An orthogonal edge
  // from `(x, y)` one step `(dx, dy)` is a RUNG -- it only crosses the width
  // of a two-wide street -- when it lies in a solid 2x2 block and the road
  // does not go on a second step the same way. Diagonal edges only exist
  // where no orthogonal one does, so they are always branches, and on a map
  // with no 2x2 block `branches` equals `degree` exactly: every one-wide rule
  // (the crossroads, the L-bend, the diagonal chain) is unchanged.
  const branches = nodes.map((n, i) => {
    let count = 0;
    for (const e of incident[i]) {
      const [a, b] = edges[e];
      const other = nodes[a === i ? b : a];
      const dx = other.x - n.x;
      const dy = other.y - n.y;
      if (dx !== 0 && dy !== 0) {
        count++;
        continue;
      }
      // The two blocks that could hold this edge: either side of it.
      const lx = Math.min(n.x, other.x);
      const ly = Math.min(n.y, other.y);
      const edgeInBlock = dx !== 0 ? inBlock(lx, ly - 1) || inBlock(lx, ly) : inBlock(lx - 1, ly) || inBlock(lx, ly);
      const rung = edgeInBlock && !road(n.x + 2 * dx, n.y + 2 * dy);
      if (!rung) count++;
    }
    return count;
  });

  return { width, height, nodes, edges, degree, incident, nodeAt, solid, branches };
}

/** A junction is any node where the road goes three or more ways -- the
 *  point a crossroads or a T needs its rut pattern to fade out around rather
 *  than draw two straight ruts through a filled intersection. It counts
 *  `branches`, not `degree`: inside a two-wide street every node has a rung
 *  to its twin across the street, and a rung is not a way to go. */
export function isJunction(g: RoadGraph, n: number): boolean {
  return g.branches[n] >= 3;
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
 * to), the segment distance to every edge incident on a node in the search
 * window, and the distance to every SOLID 2x2 block (`RoadGraph.solid`) --
 * 0 anywhere inside the square its four centres span, so a two-wide street
 * is one surface `1 + 2 x ROAD_HALF_WIDTH` wide rather than two lanes with
 * a hole between every pair of rungs. `Infinity` when no road tile stands within two
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
      if (g.solid[y * g.width + x] === 1) {
        const dx = Math.max(x + 0.5 - px, 0, px - (x + 1.5));
        const dz = Math.max(y + 0.5 - pz, 0, pz - (y + 1.5));
        best = Math.min(best, Math.hypot(dx, dz));
      }
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

// The cross-section's constants live in `ground-maths.ts` (GH-943 P2 T3), where the one implementation of the profile is
// written against `Ops<T>` for this module and the node ground alike; they are re-exported here under their old names.
export {
  ROAD_HALF_WIDTH,
  ROAD_EDGE_FALLOFF,
  ROAD_EDGE_BEND,
  SHOULDER_TILES,
  SHOULDER_ALPHA,
  RUT_OFFSET,
  RUT_WIDTH,
  RUT_ALPHA,
  RUT_JUNCTION_FADE,
} from './ground-maths';
/** `fbm2` cycles-per-tile a caller samples `bend` at -- exported so the edge
 *  wander and whatever else reads it agree on the same frequency. */
export const ROAD_EDGE_BEND_CYCLES = 2;

/** Cycle length, in tiles, of the road's own surface grain (a caller's
 *  `fbm2` sample), and the gain that grain is mixed in at. Exported for the
 *  same reason as `ROAD_EDGE_BEND_CYCLES`: the ground builder and this
 *  module must agree on the frequency without duplicating the constant. */
export const ROAD_GRAIN_TILES = 2;
export const ROAD_GRAIN_GAIN = 0.6;

/** The road's three bands at one point (`ground-maths.ts`'s `RoadBands`, on numbers). */
export type RoadProfile = RoadBands<number>;

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
  return roadBands(NUMBER_OPS, d, bend, junctionDist);
}
