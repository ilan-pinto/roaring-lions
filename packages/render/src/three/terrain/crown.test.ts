/**
 * `crown.ts`'s summit test on hand-built maps, and the control map's soft
 * edge for a crown (`surfaceWeightsAt`): a crown is rock the draw mask has
 * cleared, so it blends across its tile edge instead of stopping hard -- the
 * diamond edge the mock photographed on Milh Flats.
 */
import { describe, it, expect } from 'vitest';
import { crownMask, liftCrowns, unterraceCrowns, CROWN_LIFT_LEVELS } from './crown';
import { surfaceWeightsAt } from './control-map';
import { DECOR_RIDGE } from './shared';
import type { TerrainInput } from './types';

const W = 9;
const H = 9;

/** A 2x2 `^` crown at (3..4, 3..4) on a knoll: level 3 at the crown, 2 around it, 1 beyond. */
function tell(): { decor: Uint8Array; blocked: Uint8Array; levels: Uint8Array } {
  const decor = new Uint8Array(W * H);
  const blocked = new Uint8Array(W * H);
  const levels = new Uint8Array(W * H).fill(1);
  for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) levels[y * W + x] = 2;
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]]) {
    decor[y * W + x] = DECOR_RIDGE;
    blocked[y * W + x] = 1;
    levels[y * W + x] = 3;
  }
  return { decor, blocked, levels };
}
const at = (x: number, y: number) => y * W + x;

describe('crownMask: a summit, not just a small cluster', () => {
  it('a bare crown on a knoll is a crown', () => {
    const { decor, blocked, levels } = tell();
    const m = crownMask(decor, blocked, levels, W, H);
    expect([m[at(3, 3)], m[at(4, 4)], m[at(2, 2)]]).toEqual([1, 1, 0]);
  });
  it('touching another blocked tile (a building) it is not', () => {
    const { decor, blocked, levels } = tell();
    blocked[at(5, 5)] = 1; // a building on the diagonal
    expect(crownMask(decor, blocked, levels, W, H).some(Boolean)).toBe(false);
  });
  it('with ground around it standing higher it is not', () => {
    const { decor, blocked, levels } = tell();
    levels[at(2, 4)] = 4;
    expect(crownMask(decor, blocked, levels, W, H).some(Boolean)).toBe(false);
  });
  it('a cluster of 13 tiles is a wall, not a crown', () => {
    const decor = new Uint8Array(W * H);
    const blocked = new Uint8Array(W * H);
    const ridge = (x: number, y: number): void => {
      decor[at(x, y)] = DECOR_RIDGE;
      blocked[at(x, y)] = 1;
    };
    for (let x = 0; x < 9; x++) ridge(x, 4);
    for (let x = 0; x < 4; x++) ridge(x, 5);
    expect(crownMask(decor, blocked, null, W, H).some(Boolean)).toBe(false);
  });
  it('lifts by CROWN_LIFT_LEVELS, clamped at 9, and writes neither input', () => {
    const { decor, blocked, levels } = tell();
    const m = crownMask(decor, blocked, levels, W, H);
    const lifted = liftCrowns(levels, m);
    expect(lifted[at(3, 3)]).toBe(3 + CROWN_LIFT_LEVELS);
    expect(lifted[at(2, 2)]).toBe(2);
    expect(levels[at(3, 3)]).toBe(3);
    expect(unterraceCrowns(blocked, m)[at(3, 3)]).toBe(0);
    expect(blocked[at(3, 3)]).toBe(1);
    const high = new Uint8Array(levels).fill(8);
    expect(liftCrowns(high, m)[at(3, 3)]).toBe(9);
  });
});

describe('the control map blends a crown across its edge', () => {
  function input(terraced: boolean): TerrainInput {
    const { decor, blocked } = tell();
    return {
      width: W,
      height: H,
      decor,
      elevation: null,
      blocked: terraced ? blocked : new Uint8Array(W * H),
      cover: new Uint8Array(W * H),
    };
  }
  // A point on the crown, 0.06 tile inside its west edge (x = 3), mid-tile in z.
  const inside: [number, number] = [3.06, 3.5];
  // And 0.06 tile outside it.
  const outside: [number, number] = [2.94, 3.5];

  it('a terraced ridge stops hard: full rock just inside its edge', () => {
    expect(surfaceWeightsAt(input(true), ...inside).rock).toBe(1);
  });
  it('a crown is rock just inside its edge too, and rock just outside it', () => {
    expect(surfaceWeightsAt(input(false), ...inside).rock).toBeGreaterThan(0.9);
    expect(surfaceWeightsAt(input(false), ...outside).rock).toBeGreaterThan(0.7);
  });
  it('a crown fades over a tile instead of stopping at its edge', () => {
    const w = (x: number) => surfaceWeightsAt(input(false), x, 3.5).rock;
    const t = (x: number) => surfaceWeightsAt(input(true), x, 3.5).rock;
    // Half a tile out from the west edge: a terraced ridge's 0.5-tile apron
    // is spent (to within its bend), a crown's skirt is about half rock.
    expect(t(2.5)).toBeLessThan(0.45);
    expect(w(2.5)).toBeGreaterThan(0.3);
    expect(w(2.5)).toBeLessThan(0.8);
    // More than a tile out (plus the bend): none.
    expect(w(1.6)).toBe(0);
    // And monotone down the flank.
    expect(w(2.9)).toBeGreaterThan(w(2.5));
    expect(w(2.5)).toBeGreaterThan(w(2.1));
  });
  it('the middle of a crown tile is all rock', () => {
    expect(surfaceWeightsAt(input(false), 3.5, 3.5).rock).toBeCloseTo(1, 6);
  });
});
