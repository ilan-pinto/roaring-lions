// Flow-field pathfinding — one field per destination group, shared by every
// unit in the group (never per-unit A*; it collapses above ~50 units).
// Integer Dijkstra from the goal outward over the tile grid; each tile stores
// the direction of descent toward the goal. Deterministic: of the neighbours
// that reach a tile at its final cost, the one the old binary heap popped first
// wins, i.e. lowest cost, then lowest tile index (see the tie in `compute`).
// Edge cost is a base step plus an uphill term — variable edge cost is
// something Dijkstra already handles, so slope is a cost term and not a new
// algorithm. The queue is a bucket ring (Dial's algorithm): costs are small
// integers, so a bucket per cost beats a heap, byte for byte the same output
// (GH-913 L1; `tools/src/flowfield_exact.test.ts` holds it to the old heap).

import { UPHILL_PER_LEVEL } from './tuning';

/** Direction encoding 0..7: E, NE, N, NW, W, SW, S, SE. 255 = none/goal. */
export const DIR_DX = new Int8Array([1, 1, 0, -1, -1, -1, 0, 1]);
export const DIR_DY = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);
export const DIR_NONE = 255;

/** Q16.16 unit vectors per direction (46341 = sqrt(2)/2). */
export const DIR_VX = new Int32Array([65536, 46341, 0, -46341, -65536, -46341, 0, 46341]);
export const DIR_VY = new Int32Array([0, 46341, 65536, 46341, 0, -46341, -65536, -46341]);

/** Step costs, in tenths of a tile: a diagonal is sqrt(2) rounded to 1.4. */
export const COST_ORTH = 10;
export const COST_DIAG = 14;
const INF = 0x7fffffff;

/**
 * Scratch for `compute`'s bucket queue, shared by every field. A field used to own
 * two Int32Arrays of 8 cells each — 147 KB of the 160 KB a 48×48 field cost —
 * for a queue that is empty between calls. `compute` is synchronous and the sim
 * is single-threaded, so one scratch serves every field in every Sim.
 */
let nodeTile = new Int32Array(0);
let nodeNext = new Int32Array(0);
function scratchFor(cells: number): void {
  // One node per successful relaxation, and a tile is relaxed at most once per
  // popped neighbour: 8 per tile, plus the goal.
  const need = cells * 8 + 1;
  if (nodeTile.length < need) {
    nodeTile = new Int32Array(need);
    nodeNext = new Int32Array(need);
  }
}

/**
 * The bucket ring (Dial's algorithm). Edge costs are small integers, so instead of
 * a heap keyed by cost the queue is an array of buckets indexed by cost, scanned
 * upward. An edge never costs more than a diagonal step plus the steepest climb a
 * byte of elevation can express, so every queued cost lies in a window that wide
 * above the one being drained and the ring wraps instead of growing with the map.
 * The ring is sized to a power of two above that window, so its index is a mask.
 */
const MAX_EDGE = COST_DIAG + 255 * UPHILL_PER_LEVEL;
let ringSize = 1;
while (ringSize <= MAX_EDGE) ringSize *= 2;
const RING_MASK = ringSize - 1;
/** Head node of each bucket, -1 when empty. A drained `compute` leaves every head -1, so it is never cleared. */
const ringHead = new Int32Array(ringSize).fill(-1);

export class FlowField {
  readonly width: number;
  readonly height: number;
  /** Direction of travel (toward goal) per tile, DIR_NONE if unreachable. */
  readonly dirs: Uint8Array;
  goalX = -1;
  goalY = -1;

  private readonly cost: Int32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.dirs = new Uint8Array(width * height);
    this.cost = new Int32Array(width * height);
  }

  /**
   * What it actually costs to walk from `tile` to the goal, in COST_ORTH units,
   * given every wall on the map. Compare it against the straight-line distance
   * and the difference is the detour the terrain imposes — which is how a unit
   * can tell "there is a gate just there" from "this wall is in my way".
   */
  costAt(tile: number): number {
    return this.cost[tile];
  }

  /**
   * Recompute the field toward (gx, gy). Diagonal steps require both adjacent
   * orthogonal tiles open — no corner cutting, so a unit following the field
   * never clips a wall corner.
   *
   * `elevation` prices the climb, per level, and gives the descent away for
   * free. It is a required parameter rather than an optional one on purpose:
   * a caller that forgets it is a map whose relief silently stops mattering,
   * and there is no symptom to notice. Flat ground is unchanged to the byte —
   * every climb is 0 there, so the arithmetic collapses to what it was.
   */
  compute(blocked: Uint8Array, elevation: Uint8Array, gx: number, gy: number): void {
    const w = this.width;
    const h = this.height;
    const cost = this.cost;
    const dirs = this.dirs;
    cost.fill(INF);
    dirs.fill(DIR_NONE);
    this.goalX = gx;
    this.goalY = gy;

    const goal = gy * w + gx;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h || blocked[goal] !== 0) return;

    scratchFor(w * h);
    const nt = nodeTile;
    const nn = nodeNext;
    const head = ringHead;

    cost[goal] = 0;
    nt[0] = goal;
    nn[0] = -1;
    head[0] = 0;
    let nodes = 1;
    let pending = 1;

    // Drain the buckets in rising cost. A bucket holds only tiles of exactly cost `c`
    // (the ring is wider than any edge), and every edge costs at least COST_ORTH, so
    // relaxing a tile of cost `c` never queues anything into bucket `c`: the chain read
    // here is complete and final before its first tile is expanded.
    for (let c = 0; pending > 0; c++) {
      const slot = c & RING_MASK;
      let node = head[slot];
      if (node < 0) continue;
      head[slot] = -1;
      while (node >= 0) {
        const tile = nt[node];
        node = nn[node];
        pending--;
        // A tile queued, then reached more cheaply, is queued twice; the dearer entry is stale.
        if (cost[tile] !== c) continue;
        const tx = tile % w;
        const ty = (tile - tx) / w;
        const et = elevation[tile];
        // Away from the border no neighbour can fall off the grid, so the bounds test is skipped.
        const inner = tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1;
        for (let d = 0; d < 8; d++) {
          const dx = DIR_DX[d];
          const dy = DIR_DY[d];
          if (!inner) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          }
          const n = tile + dx + dy * w;
          const cn = cost[n];
          // Settled already (a neighbour of lower or equal cost): every route through `tile` is dearer.
          if (cn <= c) continue;
          if (blocked[n] !== 0) continue;
          const diag = (d & 1) === 1;
          if (diag) {
            // Both orthogonal companions must be open from the *neighbor's*
            // perspective too; expanding goal-outward, that is these two tiles.
            if (blocked[tile + dx] !== 0 || blocked[tile + dy * w] !== 0) continue;
          }
          // Slope. The field expands GOAL-OUTWARD, so the unit walks `n -> tile`,
          // against the direction this loop reads: the climb it pays is the
          // tile's height minus the neighbour's, not the other way round.
          // Inverted, the field makes units PREFER to climb, and that reads as a
          // plausible-but-odd pathing bug rather than as a sign error.
          //
          // Descending is free, deliberately (UPHILL_PER_LEVEL): high ground is
          // expensive to attack and cheap to withdraw from. All integer, on the
          // one code path every unit runs every tick.
          const climb = et - elevation[n];
          const nc = c + (diag ? COST_DIAG : COST_ORTH) + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0);
          if (nc < cn) {
            cost[n] = nc;
            // The neighbor travels opposite to the expansion direction.
            dirs[n] = (d + 4) & 7;
            const s2 = nc & RING_MASK;
            nt[nodes] = n;
            nn[nodes] = head[s2];
            head[s2] = nodes++;
            pending++;
          } else if (nc === cn) {
            // A tie. The heap this replaced popped tiles in (cost, tile index) order and
            // `dirs[n]` kept the FIRST parent to reach the final cost, so among equal-cost
            // parents the earliest popped one — lowest cost, then lowest tile — wins. A
            // bucket pops in no particular order within one cost, so say that rule here.
            // `dirs[n]` points at the parent that holds it; a parent of lower cost was
            // popped earlier and keeps it.
            const parent = n + DIR_DX[dirs[n]] + DIR_DY[dirs[n]] * w;
            if (cost[parent] === c && parent > tile) dirs[n] = (d + 4) & 7;
          }
        }
      }
    }
    dirs[goal] = DIR_NONE;
  }
}
