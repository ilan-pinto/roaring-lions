// FROZEN COPY of `FlowField.compute` as it stood on origin/main 9978db695 (the binary-heap Dijkstra,
// before GH-913 L1). It is the ORACLE for `flowfield_exact.test.ts` and the "before" arm of
// `perf/flowfield-compute.ts`: the new `FlowField` must equal it byte for byte (`dirs` and every
// `costAt`) on every shipped map, a scaled 80x80, and random terrain.
//
// DO NOT EDIT, and do not "fix" it to track the sim. If the pathing rules change on purpose, this
// file changes in the same commit as the golden hash, and the reason goes in the message. It imports
// the constants from the sim only so a change to a step cost reaches both sides identically; the
// algorithm below is the thing being held still.
import { COST_DIAG, COST_ORTH, DIR_DX, DIR_DY, DIR_NONE } from '../../packages/sim/src/flowfield';
import { UPHILL_PER_LEVEL } from '../../packages/sim/src/tuning';

const INF = 0x7fffffff;

let scratchTile = new Int32Array(0);
let scratchCost = new Int32Array(0);
function scratchFor(cells: number): void {
  const need = cells * 8;
  if (scratchTile.length < need) {
    scratchTile = new Int32Array(need);
    scratchCost = new Int32Array(need);
  }
}

export class OracleFlowField {
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
    let heapSize = 0;
    const ht = scratchTile;
    const hc = scratchCost;

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
        // Slope. The field expands GOAL-OUTWARD, so the unit walks `n -> tile`,
        // against the direction this loop reads: the climb it pays is the
        // tile's height minus the neighbour's, not the other way round.
        // Inverted, the field makes units PREFER to climb, and that reads as a
        // plausible-but-odd pathing bug rather than as a sign error.
        //
        // Descending is free, deliberately (UPHILL_PER_LEVEL): high ground is
        // expensive to attack and cheap to withdraw from. All integer, on the
        // one code path every unit runs every tick.
        const climb = elevation[tile] - elevation[n];
        const nc =
          c + (diag ? COST_DIAG : COST_ORTH) + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0);
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
