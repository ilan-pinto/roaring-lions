// Flow-field pathfinding — one field per destination group, shared by every
// unit in the group (never per-unit A*; it collapses above ~50 units).
// Integer Dijkstra from the goal outward over the tile grid; each tile stores
// the direction of descent toward the goal. Deterministic: the heap breaks
// cost ties by tile index.

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

export class FlowField {
  readonly width: number;
  readonly height: number;
  /** Direction of travel (toward goal) per tile, DIR_NONE if unreachable. */
  readonly dirs: Uint8Array;
  goalX = -1;
  goalY = -1;

  private readonly cost: Int32Array;
  private readonly heapTile: Int32Array;
  private readonly heapCost: Int32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.dirs = new Uint8Array(width * height);
    this.cost = new Int32Array(width * height);
    // Worst-case heap occupancy: every tile pushed a handful of times.
    this.heapTile = new Int32Array(width * height * 8);
    this.heapCost = new Int32Array(width * height * 8);
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
   */
  compute(blocked: Uint8Array, gx: number, gy: number): void {
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

    let heapSize = 0;
    const ht = this.heapTile;
    const hc = this.heapCost;

    const push = (tile: number, c: number): void => {
      let i = heapSize++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hc[p] < c || (hc[p] === c && ht[p] <= tile)) break;
        hc[i] = hc[p];
        ht[i] = ht[p];
        i = p;
      }
      hc[i] = c;
      ht[i] = tile;
    };

    const pop = (): number => {
      const top = ht[0];
      heapSize--;
      const c = hc[heapSize];
      const t = ht[heapSize];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= heapSize) break;
        let m = l;
        const r = l + 1;
        if (r < heapSize && (hc[r] < hc[l] || (hc[r] === hc[l] && ht[r] < ht[l]))) m = r;
        if (hc[m] > c || (hc[m] === c && ht[m] >= t)) break;
        hc[i] = hc[m];
        ht[i] = ht[m];
        i = m;
      }
      hc[i] = c;
      ht[i] = t;
      return top;
    };

    cost[goal] = 0;
    push(goal, 0);

    while (heapSize > 0) {
      const tile = pop();
      const c = cost[tile];
      const tx = tile % w;
      const ty = (tile - tx) / w;
      for (let d = 0; d < 8; d++) {
        const nx = tx + DIR_DX[d];
        const ny = ty + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (blocked[n] !== 0) continue;
        const diag = (d & 1) === 1;
        if (diag) {
          // Both orthogonal companions must be open from the *neighbor's*
          // perspective too; expanding goal-outward, that is these two tiles.
          if (blocked[ty * w + nx] !== 0 || blocked[ny * w + tx] !== 0) continue;
        }
        const nc = c + (diag ? COST_DIAG : COST_ORTH);
        if (nc < cost[n]) {
          cost[n] = nc;
          // The neighbor travels opposite to the expansion direction.
          dirs[n] = (d + 4) & 7;
          push(n, nc);
        }
      }
    }
    dirs[goal] = DIR_NONE;
  }
}
