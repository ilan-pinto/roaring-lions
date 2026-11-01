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
 * Size the node pool for a map of `cells` tiles (exactly what `compute` does first) and return its
 * capacity. Nothing in the sim calls it; it is exported so a test can read the capacity BEFORE any
 * `compute` runs. That matters: a pool that is too small does not throw. The typed-array writes past its end are
 * dropped, the chain they were meant to extend is lost, `pending` never returns to 0 and `compute`
 * spins forever, so a witness that only runs `compute` finds a too-small pool as a hang, not a failure.
 */
export function nodePoolFor(cells: number): number {
  scratchFor(cells);
  return nodeTile.length;
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

/**
 * Scratch for `repair` (GH-913 L2), shared by every field like the queue above. All of it is empty
 * between calls: `rMark` and `rDMark` are all zero, so a repair that touches a dozen tiles resets a
 * dozen bytes instead of filling a map.
 */
let rMark = new Uint8Array(0);
let rDMark = new Uint8Array(0);
let rList = new Int32Array(0);
let rStack = new Int32Array(0);
let rDList = new Int32Array(0);
let heapTile = new Int32Array(0);
let heapCost = new Int32Array(0);
let heapSize = 0;
/** How many tiles `rList` holds: those whose cost the repair re-derived. */
let rCount = 0;
function repairScratchFor(cells: number): void {
  if (rMark.length < cells) {
    rMark = new Uint8Array(cells);
    rDMark = new Uint8Array(cells);
    rList = new Int32Array(cells);
    rStack = new Int32Array(cells);
    rDList = new Int32Array(cells);
  }
  // The repair gives up (and recomputes in full) before the heap could pass this.
  if (heapTile.length < cells * 2 + 64) {
    heapTile = new Int32Array(cells * 2 + 64);
    heapCost = new Int32Array(cells * 2 + 64);
  }
}

/** Min-heap on cost alone. Ties pop in any order: only the costs are repaired here, and `dirs` is
 *  derived from the finished costs afterwards, so the order of equal costs cannot reach the output. */
function heapPush(c: number, tile: number): void {
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapCost[p] <= c) break;
    heapCost[i] = heapCost[p];
    heapTile[i] = heapTile[p];
    i = p;
  }
  heapCost[i] = c;
  heapTile[i] = tile;
}

/** Remove the cheapest entry and return its tile; its cost is `heapCost[0]` read BEFORE this call. */
function heapPop(): number {
  const top = heapTile[0];
  heapSize--;
  const c = heapCost[heapSize];
  const t = heapTile[heapSize];
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    if (l >= heapSize) break;
    let m = l;
    if (l + 1 < heapSize && heapCost[l + 1] < heapCost[l]) m = l + 1;
    if (heapCost[m] >= c) break;
    heapCost[i] = heapCost[m];
    heapTile[i] = heapTile[m];
    i = m;
  }
  heapCost[i] = c;
  heapTile[i] = t;
  return top;
}

/**
 * The cost a neighbour `m` would hand tile `v` (m -> v being one step of the field's expansion), or
 * INF when that step is not allowed: `m` unreached, or a diagonal whose companions are not both open.
 * Whether `v` itself is blocked is NOT tested here: each caller either skips a blocked `v` or (`rederive`)
 * has already returned for a tile whose cost is INF, which a blocked tile's is. The
 * same arithmetic `compute` runs, read from the receiving side.
 */
function stepCost(cost: Int32Array, blocked: Uint8Array, elevation: Uint8Array, w: number, vx: number, vy: number, mx: number, my: number, diag: boolean): number {
  const m = my * w + mx;
  const cm = cost[m];
  if (cm === INF) return INF;
  if (diag && (blocked[my * w + vx] !== 0 || blocked[vy * w + mx] !== 0)) return INF;
  const climb = elevation[m] - elevation[vy * w + vx];
  return cm + (diag ? COST_DIAG : COST_ORTH) + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0);
}

/** The cheapest cost any valid neighbour hands tile (vx, vy) at the costs now in `cost`. */
function bestInto(cost: Int32Array, blocked: Uint8Array, elevation: Uint8Array, w: number, h: number, vx: number, vy: number): number {
  let best = INF;
  for (let e = 0; e < 8; e++) {
    const mx = vx + DIR_DX[e];
    const my = vy + DIR_DY[e];
    if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
    const nc = stepCost(cost, blocked, elevation, w, vx, vy, mx, my, (e & 1) === 1);
    if (nc < best) best = nc;
  }
  return best;
}

/**
 * Settle the heap: relax outward from every queued tile, appending any tile whose cost it changes to
 * `rList` (once, via `rMark`). Returns false when the work passed `limit`, so the caller recomputes in
 * full instead.
 */
function drainHeap(cost: Int32Array, blocked: Uint8Array, elevation: Uint8Array, w: number, h: number, limit: number): boolean {
  const cap = heapTile.length;
  while (heapSize > 0) {
    const c = heapCost[0];
    const tile = heapPop();
    if (cost[tile] !== c) continue; // queued, then reached more cheaply
    const tx = tile % w;
    const ty = (tile - tx) / w;
    for (let d = 0; d < 8; d++) {
      const nx = tx + DIR_DX[d];
      const ny = ty + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (cost[n] <= c) continue;
      if (blocked[n] !== 0) continue;
      const diag = (d & 1) === 1;
      if (diag && (blocked[ty * w + nx] !== 0 || blocked[ny * w + tx] !== 0)) continue;
      const climb = elevation[tile] - elevation[n];
      const nc = c + (diag ? COST_DIAG : COST_ORTH) + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0);
      if (nc < cost[n]) {
        cost[n] = nc;
        if (rMark[n] === 0) {
          rMark[n] = 1;
          rList[rCount++] = n;
          if (rCount > limit) return false;
        }
        if (heapSize >= cap) return false;
        heapPush(nc, n);
      }
    }
  }
  return true;
}

/**
 * `dirs` for tile `n`, derived from the finished costs: the neighbour that reaches it at exactly its
 * cost by a legal step, and among several the one `compute` expands first -- lowest cost, then lowest
 * tile index. That is the rule `compute` states at its tie, written from the receiving side, so a
 * repaired tile reads what a full recompute would have left there.
 */
function rederive(cost: Int32Array, dirs: Uint8Array, blocked: Uint8Array, elevation: Uint8Array, w: number, h: number, goal: number, n: number): void {
  const cn = cost[n];
  if (n === goal || cn === INF) {
    dirs[n] = DIR_NONE;
    return;
  }
  const nx = n % w;
  const ny = (n - nx) / w;
  let best = -1;
  let bestCost = INF;
  let bestDir = DIR_NONE;
  for (let e = 0; e < 8; e++) {
    const mx = nx + DIR_DX[e];
    const my = ny + DIR_DY[e];
    if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
    const m = my * w + mx;
    const cm = cost[m];
    if (cm >= cn) continue;
    if (stepCost(cost, blocked, elevation, w, nx, ny, mx, my, (e & 1) === 1) !== cn) continue;
    if (cm < bestCost || (cm === bestCost && m < best)) {
      best = m;
      bestCost = cm;
      bestDir = e;
    }
  }
  dirs[n] = bestDir;
}

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

  /**
   * Bring this field up to date after tiles of `blocked` flipped, WITHOUT recomputing it, to exactly the
   * bytes `compute(blocked, elevation, goal)` would leave (GH-913 L2). `blocked` is the mask AFTER the
   * change; `changed[0..count)` are the tiles whose value flipped; `opening` says which way (all of
   * them became open, or all of them became blocked). Elevation is unchanged.
   *
   * Costs first. A tile that closed takes with it the tiles whose every shortest route ran through it
   * (the "affected" set, found by asking each candidate whether any unaffected neighbour still reaches
   * it at its old cost); those are re-seeded from their unaffected neighbours and settled. A tile that
   * opened can only make costs fall: re-seed the tiles whose incoming steps changed (the tile and its
   * eight neighbours: a diagonal's companions are the only other way a tile's legality changes) and
   * relax outward while anything improves. Then `dirs`: every tile whose cost changed, every neighbour
   * of one, and every neighbour of a flipped tile is re-derived from the finished costs.
   *
   * Falls back to `compute` -- exact by definition -- when the goal itself is involved or the repair
   * would touch more than a quarter of the map. Returns the number of tiles whose cost it re-derived,
   * or -1 when it fell back.
   */
  repair(blocked: Uint8Array, elevation: Uint8Array, changed: ArrayLike<number>, count: number, opening: boolean): number {
    const w = this.width;
    const h = this.height;
    const cost = this.cost;
    const dirs = this.dirs;
    if (count <= 0) return 0;
    const gx = this.goalX;
    const gy = this.goalY;
    const goal = gy * w + gx;
    // A field that never had a goal (off the map, or blocked when it was computed) has nothing to repair.
    if (gx < 0 || gy < 0 || gx >= w || gy >= h || cost[goal] !== 0 || blocked[goal] !== 0) {
      this.compute(blocked, elevation, gx, gy);
      return -1;
    }
    const cells = w * h;
    repairScratchFor(cells);
    const limit = cells >> 2;
    const mark = rMark;
    const list = rList;
    rCount = 0;
    heapSize = 0;
    let ok = true;

    if (!opening) {
      // ---- Closing. Phase A: who loses every route?
      const stack = rStack;
      let sp = 0;
      for (let i = 0; i < count; i++) {
        const o = changed[i];
        if (cost[o] !== INF && mark[o] === 0) {
          mark[o] = 1;
          list[rCount++] = o;
          stack[sp++] = o;
        }
      }
      // A tile that lost a diagonal step (a companion closed) loses support with no affected parent.
      for (let i = 0; i < count && ok; i++) {
        const o = changed[i];
        const ox = o % w;
        const oy = (o - ox) / w;
        for (let e = 0; e < 8; e++) {
          const vx = ox + DIR_DX[e];
          const vy = oy + DIR_DY[e];
          if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
          const v = vy * w + vx;
          if (mark[v] !== 0 || cost[v] === INF || v === goal || blocked[v] !== 0) continue;
          if (!this.supported(blocked, elevation, vx, vy)) {
            mark[v] = 1;
            list[rCount++] = v;
            stack[sp++] = v;
          }
        }
        if (rCount > limit) ok = false;
      }
      // Each newly affected tile may be the last support of its dependants.
      while (sp > 0 && ok) {
        const u = stack[--sp];
        const ux = u % w;
        const uy = (u - ux) / w;
        for (let e = 0; e < 8; e++) {
          const vx = ux + DIR_DX[e];
          const vy = uy + DIR_DY[e];
          if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
          const v = vy * w + vx;
          if (mark[v] !== 0 || cost[v] === INF || v === goal || blocked[v] !== 0) continue;
          // A dependant is a tile whose old cost is exactly `u`'s plus a step. The step's legality is
          // not asked here (a superset is harmless: `supported` decides on the NEW mask).
          const climb = elevation[u] - elevation[v];
          if (cost[v] !== cost[u] + ((e & 1) === 1 ? COST_DIAG : COST_ORTH) + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0)) continue;
          if (!this.supported(blocked, elevation, vx, vy)) {
            mark[v] = 1;
            list[rCount++] = v;
            stack[sp++] = v;
            if (rCount > limit) {
              ok = false;
              break;
            }
          }
        }
      }
      if (ok) {
        // Phase B: re-seed the affected tiles from the unaffected ones, then settle them.
        const affected = rCount;
        for (let i = 0; i < affected; i++) cost[list[i]] = INF;
        for (let i = 0; i < affected && ok; i++) {
          const v = list[i];
          if (blocked[v] !== 0) continue;
          const vx = v % w;
          const best = bestInto(cost, blocked, elevation, w, h, vx, (v - vx) / w);
          if (best < INF) {
            cost[v] = best;
            if (heapSize >= heapTile.length) ok = false;
            else heapPush(best, v);
          }
        }
        if (ok) ok = drainHeap(cost, blocked, elevation, w, h, limit);
      }
    } else {
      // ---- Opening: costs can only fall. Re-seed every tile whose incoming steps changed.
      for (let i = 0; i < count && ok; i++) {
        const o = changed[i];
        const ox = o % w;
        const oy = (o - ox) / w;
        for (let e = -1; e < 8; e++) {
          const vx = e < 0 ? ox : ox + DIR_DX[e];
          const vy = e < 0 ? oy : oy + DIR_DY[e];
          if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
          const v = vy * w + vx;
          if (blocked[v] !== 0) continue;
          const best = bestInto(cost, blocked, elevation, w, h, vx, vy);
          if (best < cost[v]) {
            cost[v] = best;
            if (mark[v] === 0) {
              mark[v] = 1;
              list[rCount++] = v;
            }
            if (heapSize >= heapTile.length) ok = false;
            else heapPush(best, v);
          }
        }
        if (rCount > limit) ok = false;
      }
      if (ok) ok = drainHeap(cost, blocked, elevation, w, h, limit);
    }

    const touched = rCount;
    if (ok) {
      // Phase D: re-derive `dirs` wherever a cost or a legal step may have changed.
      const dMark = rDMark;
      const dList = rDList;
      let nd = 0;
      for (let i = 0; i < touched + count; i++) {
        const t = i < touched ? list[i] : changed[i - touched];
        const tx = t % w;
        const ty = (t - tx) / w;
        for (let e = -1; e < 8; e++) {
          const nx = e < 0 ? tx : tx + DIR_DX[e];
          const ny = e < 0 ? ty : ty + DIR_DY[e];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (dMark[n] === 0) {
            dMark[n] = 1;
            dList[nd++] = n;
          }
        }
      }
      for (let i = 0; i < nd; i++) {
        rederive(cost, dirs, blocked, elevation, w, h, goal, dList[i]);
        dMark[dList[i]] = 0;
      }
    }
    for (let i = 0; i < touched; i++) mark[list[i]] = 0;
    heapSize = 0;
    if (!ok) {
      this.compute(blocked, elevation, gx, gy);
      return -1;
    }
    return touched;
  }

  /** Does some unaffected neighbour still reach (vx, vy) at its OLD cost by a legal step on the NEW
   *  mask? `repair`'s closing pass, where `rMark` flags the tiles already known to lose their cost. */
  private supported(blocked: Uint8Array, elevation: Uint8Array, vx: number, vy: number): boolean {
    const w = this.width;
    const h = this.height;
    const target = this.cost[vy * w + vx];
    for (let e = 0; e < 8; e++) {
      const mx = vx + DIR_DX[e];
      const my = vy + DIR_DY[e];
      if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
      if (rMark[my * w + mx] !== 0) continue;
      if (stepCost(this.cost, blocked, elevation, w, vx, vy, mx, my, (e & 1) === 1) === target) return true;
    }
    return false;
  }
}
