import { describe, expect, it } from 'vitest';
import { COST_DIAG, COST_ORTH, DIR_DX, DIR_DY, DIR_NONE, FlowField } from './flowfield';
import { UPHILL_PER_LEVEL } from './tuning';

// Slope (T1-A): the flow field prices a climb and gives a descent away.
//
// THE SIGN IS PINNED HERE AND NOWHERE ELSE, and that is not where anyone
// expects to find it -- so read this before assuming the walk tests cover it.
//
// The field expands GOAL-OUTWARD: when the loop stands on `t` and relaxes `n`,
// the unit walks `n -> t`, the opposite of how the loop reads, so the climb is
// `elevation[t] - elevation[n]`. The T1 design says getting that backwards
// "produces a field that makes units PREFER to climb". Measured, it does not.
// Inverting the sign leaves every ROUTE exactly as good as it was:
//
//     cost_inverted(t) = cost_correct(t) + UPHILL_PER_LEVEL * (h(t) - h(goal))
//
// The correction depends only on the tile and the goal, never on the path
// between them, so it shifts every route from a tile by the same amount and
// cannot reorder them. Checked over 200 random relief maps (14x11, 8% walls,
// heights 0-6): the identity held on all 28,170 reachable tiles with zero
// violations, `dirs` differed on 1,705 of them, and every single one of those
// 1,705 was a DIFFERENT-BUT-EQUALLY-OPTIMAL step under the correct metric --
// a tie inside the argmin set, broken differently because the cost numbers
// (and so the heap order) moved. Zero were worse.
//
// The consequences are worth stating plainly, because they are counter-
// intuitive and they were measured, not reasoned:
//
//   * No pathing test can catch an inverted sign. Both walk tests in this repo
//     (`tools/src/slope.test.ts` and the 900-tick relief replay in
//     determinism.test.ts, hash included) pass byte-identically with the sign
//     flipped. They are still worth having -- they prove elevation REACHES the
//     field -- but they are not this.
//   * The only observable difference is the cost NUMBER, and `costAt` has
//     exactly one reader: `selectBreachTarget`'s detour test in sim.ts.
//
// So the absolute-cost assertions below are the guard. They are written as
// MIRRORED PAIRS on identical ground -- the same ramp walked up and walked down
// -- because a single number can be satisfied by a magnitude error, and a pair
// that has to be 140-and-100 rather than 100-and-140 cannot.

const W = 11;
const H = 5;

function flat(): Uint8Array {
  return new Uint8Array(W * H);
}

/** Walk the field from `start` to the goal, returning the tiles stood on. */
function descend(f: FlowField, sx: number, sy: number): number[] {
  const path: number[] = [];
  let x = sx;
  let y = sy;
  for (let step = 0; step < W * H; step++) {
    const t = y * W + x;
    path.push(t);
    const d = f.dirs[t];
    if (d === DIR_NONE) return path;
    x += DIR_DX[d];
    y += DIR_DY[d];
  }
  throw new Error('field has a cycle');
}

/** Cost of the straight run on flat ground, in COST_ORTH units. */
function chebyshev(dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const lo = ax < ay ? ax : ay;
  const hi = ax < ay ? ay : ax;
  return COST_DIAG * lo + COST_ORTH * (hi - lo);
}

describe('FlowField: flat ground is exactly what it was', () => {
  it('an open flat grid costs Chebyshev distance and nothing else', () => {
    // The absolute numbers, not a relative comparison: this is the guard that
    // the slope term did not quietly re-price ordinary ground. Every shipped
    // map but Tel Marum is flat, so this IS their pathing.
    const f = new FlowField(W, H);
    f.compute(flat(), flat(), 10, 2);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(f.costAt(y * W + x), `tile (${x},${y})`).toBe(chebyshev(10 - x, 2 - y));
      }
    }
  });

  it('a uniform plateau is flat ground: same dirs, same costs, however high', () => {
    // climb is elevation[t] - elevation[n] and every tile shares a height, so
    // the difference is 0 everywhere and the plateau must be free. If this
    // fails, the term is reading an absolute height instead of a difference.
    const level = flat();
    const raised = new Uint8Array(W * H).fill(7);
    const a = new FlowField(W, H);
    const b = new FlowField(W, H);
    a.compute(flat(), level, 10, 2);
    b.compute(flat(), raised, 10, 2);
    expect(Array.from(b.dirs)).toEqual(Array.from(a.dirs));
    for (let t = 0; t < W * H; t++) expect(b.costAt(t), `tile ${t}`).toBe(a.costAt(t));
  });
});

describe('FlowField: the sign of the climb', () => {
  // One 11-wide corridor: a ramp from height 0 at x=0 up to height 4 at x=4,
  // flat at 4 from there east. The two cases below are the SAME ground walked
  // in opposite directions, which is what makes them a sign test rather than a
  // magnitude test -- and, per the note at the top of this file, the only sign
  // test there can be.
  function ramp(): Uint8Array {
    const e = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) e[y * W + x] = x < 4 ? x : 4;
    }
    return e;
  }

  it('climbing to a goal on the high end costs the height it gained', () => {
    const f = new FlowField(W, H);
    f.compute(flat(), ramp(), 10, 2); // goal at x=10, height 4
    // From the foot of the ramp: ten orthogonal steps, plus four levels of
    // climb. The climb telescopes -- 0->1->2->3->4 -- so the total is the net
    // height difference, whatever route it takes.
    expect(f.costAt(2 * W + 0)).toBe(10 * COST_ORTH + 4 * UPHILL_PER_LEVEL);
  });

  it('and withdrawing down the same ramp is free', () => {
    const f = new FlowField(W, H);
    f.compute(flat(), ramp(), 0, 2); // goal at x=0, height 0
    // The mirror of the case above, on identical ground. Ten steps down the
    // ramp cost ten steps. Invert the sign and these two numbers swap (this one
    // reads 140, the one above 100), which is the failure this pair exists to
    // catch -- and it is ALSO the only assertion in the repo that fails if
    // descent is ever charged symmetrically, which would price a withdrawal
    // like the assault that took the hill and delete the option outright.
    expect(f.costAt(2 * W + 10)).toBe(10 * COST_ORTH);
  });

  it('one level of climb costs UPHILL_PER_LEVEL, and the constant is an integer', () => {
    // Pins the unit the constant is expressed in: the same tenths-of-a-tile
    // the cost array already uses, not a Q16.16 fraction. A float here is
    // invariant 2 broken, and it would show up as a non-integer cost.
    const step = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 5; x < W; x++) step[y * W + x] = 1;
    }
    const f = new FlowField(W, H);
    f.compute(flat(), step, 10, 2);
    expect(f.costAt(2 * W + 0)).toBe(10 * COST_ORTH + UPHILL_PER_LEVEL);
    expect(Number.isInteger(UPHILL_PER_LEVEL)).toBe(true);
  });
});

describe('FlowField: an approach goes around a spur rather than over it', () => {
  // The case the design names as the one that must be tested.
  //
  //   x:  0 1 2 3 4 | 5 | 6 7 | 8 9 10
  //   rows 1-3      | 5 |     | the hilltop, height 2, with the goal on it
  //   rows 0,4      | 0 |     |
  //
  // The goal sits on a hill at (9,2). Directly between it and a unit at (1,2)
  // stands a spur of height 5 -- higher than the hilltop itself, so crossing it
  // is five levels bought and five levels thrown away. North and south of the
  // spur the valley floor runs through at height 0.
  //
  // Total climb telescopes on a monotone ascent, so a route that only ever goes
  // up pays the same wherever it starts: the spur is expensive precisely
  // BECAUSE it must be given back. That is also why the paired control matters.
  const SPUR_TILES = [1, 2, 3].map((y) => y * W + 5);

  function hill(): Uint8Array {
    const e = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 8; x < W; x++) e[y * W + x] = 2; // the hilltop
    }
    for (const t of SPUR_TILES) e[t] = 5; // the spur
    return e;
  }

  it('goes around the spur', () => {
    const f = new FlowField(W, H);
    f.compute(flat(), hill(), 9, 2);
    const path = descend(f, 1, 2);
    expect(path.at(-1)).toBe(2 * W + 9); // it arrives
    for (const t of SPUR_TILES) expect(path, `spur tile ${t}`).not.toContain(t);
  });

  it('and on the identical ground flat, walks straight through where the spur was', () => {
    // The control. Without it "went round" is also what a stuck unit, a
    // blocked tile or a mis-set goal produce.
    const f = new FlowField(W, H);
    f.compute(flat(), flat(), 9, 2);
    const path = descend(f, 1, 2);
    expect(path.at(-1)).toBe(2 * W + 9);
    expect(path).toContain(2 * W + 5);
  });

  it('the detour is what the arithmetic says it is', () => {
    // Not a vibe: the spur route is 8 steps and 5 levels of climb it does not
    // keep (80 + 50 + the 20 to remount the hilltop = 150); the flank route
    // trades four orthogonal steps for four diagonals and buys only the
    // hilltop's own 2 levels (4*14 + 4*10 + 20 = 116).
    const f = new FlowField(W, H);
    f.compute(flat(), hill(), 9, 2);
    expect(f.costAt(2 * W + 1)).toBe(4 * COST_DIAG + 4 * COST_ORTH + 2 * UPHILL_PER_LEVEL);
  });
});
