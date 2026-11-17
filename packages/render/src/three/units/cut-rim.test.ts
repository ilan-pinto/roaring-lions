import { describe, expect, it } from 'vitest';
import { CUT_RIM_JITTER_TILES, CUT_RIM_WALL_TILES } from './building-cutaway';
import { CUT_RIM_MARGIN_TILES, keptWallHeight, lowestSlabBottom } from './cut-rim';

/** A quad (two triangles) at height y over [0, w] x [0, d], facing down (ny < 0) or up. */
function slab(y: number, w: number, d: number, down: boolean): number[] {
  const a = [0, y, 0];
  const b = [w, y, 0];
  const c = [w, y, d];
  const e = [0, y, d];
  // (a, b, c) has normal -y (down); (a, c, b) +y.
  return down ? [...a, ...b, ...c, ...a, ...c, ...e] : [...a, ...c, ...b, ...a, ...e, ...c];
}

describe('lowestSlabBottom: the lowest horizontal deck that spans the footprint', () => {
  it('finds a house\'s ground-storey ceiling and ignores the floor, a window sill and the decks above it', () => {
    const p = [
      ...slab(0, 4, 3, true), // the floor's underside: under SLAB_MIN_HEIGHT_TILES
      ...slab(1.28, 3.6, 2.6, true), // the ceiling, ~80% of the footprint
      ...slab(1.37, 4, 3, false), // the slab's top, higher than its underside
      ...slab(0.9, 0.5, 0.3, true), // a window sill, a sliver
      ...slab(2.6, 4, 3, true), // the roof's underside, higher
    ];
    expect(lowestSlabBottom(p, null, 0)).toBeCloseTo(1.28, 1);
  });
  it('is measured above the ground the building stands on', () => {
    const p = slab(11.28, 4, 3, true).concat(slab(10, 4, 3, true));
    expect(lowestSlabBottom(p, null, 10)).toBeCloseTo(1.28, 1);
  });
  it('reads an indexed triangle list', () => {
    const verts = [0, 1.28, 0, 4, 1.28, 0, 4, 1.28, 3, 0, 1.28, 3];
    expect(lowestSlabBottom(verts, [0, 1, 2, 0, 2, 3], 0)).toBeCloseTo(1.28, 1);
  });
  it('a roof that is ONE up-facing plane is a slab too (the hall\'s deck): the cut must go below it', () => {
    expect(lowestSlabBottom(slab(0.87, 4, 3, false), null, 0)).toBeCloseTo(0.88, 1);
  });
  it('is Infinity with no slab at all (nothing horizontal over the floor)', () => {
    expect(lowestSlabBottom(slab(0.3, 4, 3, false).concat(slab(0.4, 0.5, 0.4, true)), null, 0)).toBe(Infinity);
    expect(lowestSlabBottom([], null, 0)).toBe(Infinity);
  });
});

describe('keptWallHeight: min(0.9 t, lowest slab - margin)', () => {
  it('the margin covers the ragged top and a hand', () => {
    // The numbers, as literals: the jitter is 0.12 t and the margin 0.16 t (the jitter plus a hand's 0.04), not read back from the constants.
    expect(CUT_RIM_JITTER_TILES).toBe(0.12);
    expect(CUT_RIM_MARGIN_TILES).toBeCloseTo(0.16, 12);
    expect(CUT_RIM_WALL_TILES).toBe(0.9);
  });
  it('never over 0.9 t, and a slab keeps the rim and its ragged top under it', () => {
    expect(keptWallHeight(Infinity)).toBe(0.9);
    expect(keptWallHeight(1.28)).toBe(0.9);
    expect(keptWallHeight(1.0)).toBeCloseTo(0.84, 12);
    for (const slabY of [0.7, 0.9, 1.0, 1.28]) expect(keptWallHeight(slabY) + CUT_RIM_JITTER_TILES).toBeLessThan(slabY);
  });
  it('never under 0.2 t', () => {
    expect(keptWallHeight(0.3)).toBe(0.2);
  });
});
