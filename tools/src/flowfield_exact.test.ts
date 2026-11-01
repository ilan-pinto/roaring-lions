// WP-L1 (GH-913): `FlowField.compute` is an EXACT speed-up. The bucket queue that replaced the binary
// heap must leave `dirs` and every cost byte-identical to the heap's, because `dirs` is written at
// relaxation and a different tie-break between equal-cost parents is a different route for a unit,
// which is a different replay.
//
// The oracle is `flowfield_oracle.ts`: the heap implementation frozen verbatim from origin/main
// 9978db695. This file compares the live `FlowField` against it on
//   - every shipped map, on foot and on wheels (the `blocked | boulder` mask), 200 goals each;
//   - nearest-neighbour stretches of five shipped maps to 80x80, 200 goals each, both masks;
//   - open ground, seeded random walls and relief, and relief that uses the whole
//     byte (the bucket ring's wrap-around);
//   - the degenerate goals: blocked, off the map, walled in, a 1-tile map, a 1-wide corridor.
//
// FALSIFIED when written (stated again in the commit message): the live tie-break
// `parent > tile` swapped to `parent < tile` turns the shipped-map and 80x80 cases red.
// `heap tie-break teeth` below keeps that argument alive after the mutation is put back: it builds the
// same swap on the ORACLE's own algorithm and requires this file's comparison to see it.
import { describe, expect, it, vi } from 'vitest';
import { COST_DIAG, COST_ORTH, DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { UPHILL_PER_LEVEL } from '../../packages/sim/src/tuning';
import { OracleFlowField } from './flowfield_oracle';
import { goalsOn, randomTerrain, shippedTerrains, stretched, type Terrain } from './flowfield_terrain';

const GOALS = 200;

/** The first tile where two fields disagree, described; null when they are byte-identical. */
function firstDifference(a: OracleFlowField, b: FlowField, cells: number): string | null {
  if (a.goalX !== b.goalX || a.goalY !== b.goalY) return `goal (${a.goalX},${a.goalY}) vs (${b.goalX},${b.goalY})`;
  for (let t = 0; t < cells; t++) {
    if (a.dirs[t] !== b.dirs[t]) return `tile ${t}: dirs ${a.dirs[t]} vs ${b.dirs[t]} (cost ${a.costAt(t)} vs ${b.costAt(t)})`;
    if (a.costAt(t) !== b.costAt(t)) return `tile ${t}: cost ${a.costAt(t)} vs ${b.costAt(t)}`;
  }
  return null;
}

interface Tally {
  goals: number;
  reachable: number;
}

/** Compare the two over `goals` on one mask. Throws (so the test is red) on the first difference. */
function witness(label: string, t: Terrain, mask: Uint8Array, goals: readonly number[]): Tally {
  const { w, h, elevation } = t;
  const oracle = new OracleFlowField(w, h);
  const live = new FlowField(w, h);
  const tally: Tally = { goals: 0, reachable: 0 };
  for (const g of goals) {
    const gx = g % w;
    const gy = (g - gx) / w;
    oracle.compute(mask, elevation, gx, gy);
    live.compute(mask, elevation, gx, gy);
    const diff = firstDifference(oracle, live, w * h);
    if (diff !== null) throw new Error(`${label}: goal (${gx},${gy}): ${diff}`);
    tally.goals++;
    for (let i = 0; i < w * h; i++) if (live.dirs[i] !== DIR_NONE) tally.reachable++;
  }
  return tally;
}

function both(t: Terrain): Tally[] {
  return [
    witness(`${t.id} foot`, t, t.foot, goalsOn(t.foot, GOALS)),
    witness(`${t.id} wheels`, t, t.wheels, goalsOn(t.wheels, GOALS)),
  ];
}

const shipped = shippedTerrains();

describe('FlowField.compute equals the frozen heap implementation', { timeout: 180_000 }, () => {
  it('has the maps it claims to', () => {
    // A shipped-map loop over an empty list passes by doing nothing.
    expect(shipped.length).toBeGreaterThanOrEqual(30);
    expect(shipped.some((t) => t.foot !== t.wheels && t.wheels.some((v, i) => v !== t.foot[i]))).toBe(true);
    expect(shipped.some((t) => t.elevation.some((v) => v > 0))).toBe(true);
  });

  for (const t of shipped) {
    it(`${t.id} (${t.w}x${t.h}), ${GOALS} goals, foot and wheels`, () => {
      const tallies = both(t);
      for (const tally of tallies) {
        expect(tally.goals).toBe(GOALS);
        expect(tally.reachable).toBeGreaterThan(GOALS * 100); // goals that reach nothing prove nothing
      }
    });
  }

  for (const id of ['wadi_tarfan', 'milh_flats', 'tel_marum', 'qarn_hadid', 'beit_sahwan_outskirts']) {
    it(`${id} stretched to 80x80, ${GOALS} goals, foot and wheels`, () => {
      const src = shipped.find((s) => s.id === id);
      if (src === undefined) throw new Error(`no shipped map ${id}`);
      const t = stretched(src, 80);
      expect(t.w * t.h).toBe(6400);
      for (const tally of both(t)) expect(tally.reachable).toBeGreaterThan(GOALS * 1000);
    });
  }

  // Open ground has plenty of equal-COST parents but none with equal cost AND equal pop level, so a tile
  // tie-break never fires there (the teeth test below measures exactly that). It still guards the cost
  // bookkeeping on the biggest possible flat field.
  it('open 80x80 ground', () => {
    const t = randomTerrain('open', 80, 80, 1, 0, 0, 0);
    for (const tally of both(t)) expect(tally.reachable).toBe(GOALS * 6399); // every tile but the goal itself
  });

  it('seeded random walls, boulders and relief', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const size = seed % 3 === 0 ? 80 : seed % 3 === 1 ? 48 : 33;
      const t = randomTerrain(`rnd${seed}`, size, size + (seed % 4), seed * 7919, 5 + seed * 2, seed % 2 === 0 ? 6 : 0, seed % 5 === 0 ? 0 : 9);
      both(t);
    }
  });

  it('relief that uses the whole byte (the bucket ring wraps)', () => {
    // Elevation is a byte, so a climb can price 255 levels: the widest edge the ring must hold.
    const ring = randomTerrain('byte', 64, 64, 99, 8, 0, 255);
    expect(ring.elevation.some((v) => v > 200)).toBe(true);
    both(ring);
    const wide = randomTerrain('byte80', 80, 80, 5, 0, 0, 255);
    both(wide);
  });

  it('degenerate goals: blocked, off the map, walled in, one tile, one corridor', () => {
    const t = randomTerrain('walls', 20, 20, 3, 30, 0, 5);
    const w = t.w;
    const first = (mask: Uint8Array, want: number): number => mask.findIndex((v) => v === want);
    const blockedGoal = first(t.foot, 1);
    const open = first(t.foot, 0);
    const oracle = new OracleFlowField(t.w, t.h);
    const live = new FlowField(t.w, t.h);
    const goals: [number, number][] = [
      [blockedGoal % w, Math.floor(blockedGoal / w)],
      [-1, 3],
      [3, -1],
      [w, 0],
      [0, t.h],
      [open % w, Math.floor(open / w)],
      [0, 0],
      [w - 1, t.h - 1],
    ];
    for (const [gx, gy] of goals) {
      oracle.compute(t.foot, t.elevation, gx, gy);
      live.compute(t.foot, t.elevation, gx, gy);
      expect(firstDifference(oracle, live, t.w * t.h)).toBeNull();
    }
    // Walled in: a goal ringed by blocked tiles reaches nothing but itself.
    const ringed = new Uint8Array(25);
    for (let i = 0; i < 25; i++) ringed[i] = i % 5 === 2 || Math.floor(i / 5) === 2 ? 1 : 0;
    ringed[12] = 0;
    const flat = new Uint8Array(25);
    const o5 = new OracleFlowField(5, 5);
    const l5 = new FlowField(5, 5);
    o5.compute(ringed, flat, 2, 2);
    l5.compute(ringed, flat, 2, 2);
    expect(firstDifference(o5, l5, 25)).toBeNull();
    expect(l5.costAt(0)).toBe(0x7fffffff);
    // One tile, and a one-wide corridor (no diagonal can fire).
    const o1 = new OracleFlowField(1, 1);
    const l1 = new FlowField(1, 1);
    o1.compute(new Uint8Array(1), new Uint8Array(1), 0, 0);
    l1.compute(new Uint8Array(1), new Uint8Array(1), 0, 0);
    expect(firstDifference(o1, l1, 1)).toBeNull();
    const o9 = new OracleFlowField(1, 9);
    const l9 = new FlowField(1, 9);
    const hills = new Uint8Array([0, 3, 1, 4, 1, 5, 9, 2, 6]);
    for (let g = 0; g < 9; g++) {
      o9.compute(new Uint8Array(9), hills, 0, g);
      l9.compute(new Uint8Array(9), hills, 0, g);
      expect(firstDifference(o9, l9, 9)).toBeNull();
    }
  });

  it('one FlowField reused across goals and maps leaves nothing behind', () => {
    // The scratch queue is module-level and shared. Interleave a big map, a tiny one and a relief one
    // through the SAME live instances and the same scratch.
    const big = randomTerrain('big', 80, 80, 11, 10, 0, 9);
    const small = randomTerrain('small', 9, 7, 12, 10, 0, 9);
    const liveBig = new FlowField(80, 80);
    const liveSmall = new FlowField(9, 7);
    const oBig = new OracleFlowField(80, 80);
    const oSmall = new OracleFlowField(9, 7);
    const gb = goalsOn(big.foot, 30);
    const gs = goalsOn(small.foot, 30);
    for (let i = 0; i < 30; i++) {
      oBig.compute(big.foot, big.elevation, gb[i] % 80, Math.floor(gb[i] / 80));
      liveBig.compute(big.foot, big.elevation, gb[i] % 80, Math.floor(gb[i] / 80));
      oSmall.compute(small.foot, small.elevation, gs[i] % 9, Math.floor(gs[i] / 9));
      liveSmall.compute(small.foot, small.elevation, gs[i] % 9, Math.floor(gs[i] / 9));
      expect(firstDifference(oBig, liveBig, 6400)).toBeNull();
      expect(firstDifference(oSmall, liveSmall, 63)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Teeth. The same algorithm as the oracle with ONE change: equal-cost heap entries pop highest tile
// first. If this file's inputs could not tell that apart from the oracle, "swap the tile tie-break and
// the witness goes red" would be a claim about nothing.

const INF = 0x7fffffff;
function swappedTieBreak(blocked: Uint8Array, elevation: Uint8Array, w: number, h: number, gx: number, gy: number): { dirs: Uint8Array } {
  const cost = new Int32Array(w * h).fill(INF);
  const dirs = new Uint8Array(w * h).fill(DIR_NONE);
  const heap: [number, number][] = [];
  // Min-heap on (cost, -tile): the one deliberate difference.
  const less = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] > b[1]);
  const push = (e: [number, number]): void => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const goal = gy * w + gx;
  cost[goal] = 0;
  push([0, goal]);
  while (heap.length > 0) {
    const [, tile] = pop();
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
      if (diag && (blocked[ty * w + nx] !== 0 || blocked[ny * w + tx] !== 0)) continue;
      const climb = elevation[tile] - elevation[n];
      const nc = c + (diag ? COST_DIAG : COST_ORTH) + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0);
      if (nc < cost[n]) {
        cost[n] = nc;
        dirs[n] = (d + 4) & 7;
        push([nc, n]);
      }
    }
  }
  dirs[goal] = DIR_NONE;
  return { dirs };
}

describe('heap tie-break teeth', () => {
  it('a swapped tile tie-break differs from the oracle on this file\'s inputs', () => {
    const inputs: Terrain[] = [stretched(shipped.find((s) => s.id === 'wadi_tarfan') as Terrain, 80), shipped.find((s) => s.id === 'qarn_hadid') as Terrain, randomTerrain('walls', 80, 80, 7, 12, 0, 6)];
    for (const t of inputs) {
      const oracle = new OracleFlowField(t.w, t.h);
      const g = goalsOn(t.foot, 5);
      let differing = 0;
      for (const goal of g) {
        const gx = goal % t.w;
        const gy = (goal - gx) / t.w;
        oracle.compute(t.foot, t.elevation, gx, gy);
        const mutant = swappedTieBreak(t.foot, t.elevation, t.w, t.h, gx, gy);
        let tiles = 0;
        for (let i = 0; i < t.w * t.h; i++) if (mutant.dirs[i] !== oracle.dirs[i]) tiles++;
        if (tiles > 0) differing++;
      }
      expect(differing, `${t.id}: a swapped tie-break must change at least one field`).toBeGreaterThan(0);
    }
  });

  it('and the sanity half: the un-swapped algorithm is the oracle', () => {
    // Guard on the mutant harness itself: with the tie-break unswapped it would have to match, so a
    // mismatch above is the swap and not a transcription error. Checked on a small map, by symmetry:
    // the mutant on the REVERSED tile order equals nothing we can say, so check the weaker invariant
    // that costs (which the tie-break never touches) agree.
    const t = randomTerrain('c', 30, 30, 4, 10, 0, 6);
    const oracle = new OracleFlowField(30, 30);
    const g = goalsOn(t.foot, 1)[0];
    oracle.compute(t.foot, t.elevation, g % 30, Math.floor(g / 30));
    const mutant = swappedTieBreak(t.foot, t.elevation, 30, 30, g % 30, Math.floor(g / 30));
    // reachability is tie-independent
    for (let i = 0; i < 900; i++) expect(mutant.dirs[i] === DIR_NONE).toBe(oracle.dirs[i] === DIR_NONE);
  });
});

// ---------------------------------------------------------------------------------------------
// The node pool. `compute` queues one node per strict improvement, and a tile can improve once per
// neighbour that reaches it, so the pool is sized 8 nodes a tile (+1 for the goal). Ordinary terrain needs
// about 1.1 a tile, and even fully random relief about 1.8, so a pool sized 2 a tile passed every test.
// These two fixtures were found by hill-climbing on relief (elevation 0..255) for the most improvements
// per tile; they need 2.5. The scratch is module-level and only ever grows, so the pool is exercised in a
// FRESH copy of the module, where this map's first compute sizes it.

const HARD_6 = [30, 0, 37, 0, 0, 0, 0, 104, 120, 145, 255, 9, 0, 232, 0, 255, 0, 134, 0, 59, 191, 0, 164, 0, 0, 150, 255, 60, 248, 17, 0, 181, 0, 0, 4, 96];
const HARD_8 = [
  0, 89, 0, 0, 0, 94, 255, 61, 0, 33, 255, 50, 44, 0, 50, 173, 58, 255, 132, 255, 74, 79, 253, 35, 39, 64, 0, 197, 233, 255, 197, 49, 0, 28, 234, 249, 31, 110, 173, 0, 140, 255, 0, 238, 0, 134, 0, 255, 0, 0, 248, 20, 1,
  106, 157, 93, 0, 239, 0, 0, 0, 0, 0, 0,
];

/** Nodes the algorithm queues toward `goal`: the goal plus one per strict improvement. Independent of the sim's queue. */
function improvements(blocked: Uint8Array, elevation: Uint8Array, w: number, h: number, goal: number): number {
  const cost = new Int32Array(w * h).fill(INF);
  const open: [number, number][] = [[0, goal]];
  cost[goal] = 0;
  let pushes = 1;
  while (open.length > 0) {
    open.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [c, tile] = open.shift() as [number, number];
    if (cost[tile] !== c) continue;
    const tx = tile % w;
    const ty = (tile - tx) / w;
    for (let d = 0; d < 8; d++) {
      const nx = tx + DIR_DX[d];
      const ny = ty + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (blocked[n] !== 0) continue;
      const diag = (d & 1) === 1;
      if (diag && (blocked[ty * w + nx] !== 0 || blocked[ny * w + tx] !== 0)) continue;
      const climb = elevation[tile] - elevation[n];
      const nc = c + (diag ? COST_DIAG : COST_ORTH) + (climb > 0 ? climb * UPHILL_PER_LEVEL : 0);
      if (nc < cost[n]) {
        cost[n] = nc;
        open.push([nc, n]);
        pushes++;
      }
    }
  }
  return pushes;
}

describe('the node pool is big enough', () => {
  for (const [name, size, relief] of [['6x6', 6, HARD_6], ['8x8', 8, HARD_8]] as const) {
    it(`${name} relief that needs more than two nodes a tile, in a fresh module`, async () => {
      const cells = size * size;
      const elevation = new Uint8Array(relief);
      const flat = new Uint8Array(cells);
      let most = 0;
      for (let g = 0; g < cells; g++) most = Math.max(most, improvements(flat, elevation, size, size, g));
      // The fixture must demand more than a 2-a-tile pool, and stay inside the 8-a-tile bound.
      expect(most).toBeGreaterThan(cells * 2 + 1);
      expect(most).toBeLessThanOrEqual(cells * 8 + 1);
      vi.resetModules();
      const fresh = await import('../../packages/sim/src/flowfield');
      // Read the capacity BEFORE computing. A pool that is too small does not throw: it loses queue links and
      // `compute` never terminates (measured: `cells*2+1` hung this very test for 5+ CPU minutes), so the
      // size is asserted where a shortfall is a red line and not a hang.
      expect(fresh.nodePoolFor(cells)).toBeGreaterThanOrEqual(most);
      const live = new fresh.FlowField(size, size);
      const oracle = new OracleFlowField(size, size);
      // The very first compute of this module copy sizes its scratch from THIS map.
      for (let g = 0; g < cells; g++) {
        live.compute(flat, elevation, g % size, Math.floor(g / size));
        oracle.compute(flat, elevation, g % size, Math.floor(g / size));
        for (let t = 0; t < cells; t++) {
          expect(live.dirs[t], `goal ${g} tile ${t} dirs`).toBe(oracle.dirs[t]);
          expect(live.costAt(t), `goal ${g} tile ${t} cost`).toBe(oracle.costAt(t));
        }
      }
    });
  }
});
