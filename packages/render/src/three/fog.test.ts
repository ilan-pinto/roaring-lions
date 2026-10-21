/**
 * Task B4.1. Runs under plain `environment: 'node'` (`vitest.config.ts`) --
 * no `Sim`, no three.js, no DOM, exactly the point of extracting
 * `computeFog`/`hasSight`/`isFogVisible` out of `PixiRenderer` in the first
 * place (see `fog.ts`'s own top comment).
 *
 * Per this project's own standard (`docs/superpowers/specs/2026-08-27-
 * phase-b3-outcome.md`, "twenty-three tests ... passed while checking
 * nothing"): every assertion below that matters was verified by breaking the
 * corresponding line in `fog.ts` by hand and confirming the SPECIFIC test
 * named in each `describe` block's comment actually goes red, then reverting.
 * Reported in `task-B4.1-report.md`.
 */
import { describe, it, expect } from 'vitest';
import { computeFog, hasSight, isFogVisible, type FogInput } from './fog';

const W = 20;
const H = 20;

/** Q16.16 for tile centre `(tx + 0.5, ty + 0.5)`. */
function centerPos(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx * 65536 + 32768) | 0, y: (ty * 65536 + 32768) | 0 };
}

/** One living side-0 entity of type 0 at a tile centre, sight `sight`, on an
 *  otherwise-empty W x H map with nothing blocked. */
function oneUnitInput(tx: number, ty: number, sight: number, overrides: Partial<FogInput> = {}): FogInput {
  const p = centerPos(tx, ty);
  return {
    width: W,
    height: H,
    entityCount: 1,
    alive: Uint8Array.from([1]),
    side: Uint8Array.from([0]),
    typeIdx: Uint16Array.from([0]),
    posX: Int32Array.from([p.x]),
    posY: Int32Array.from([p.y]),
    sightByType: Float64Array.from([sight]),
    blocked: new Uint8Array(W * H),
    isLowProfile: () => false,
    viewerSide: 0,
    ...overrides,
  };
}

function emptyFog(): Uint8Array {
  return new Uint8Array(W * H);
}

describe('computeFog: decay before reveal', () => {
  // Break 1 (brief item 1): comment out the decay loop in fog.ts (the `for
  // (t...) if (fog[t] === 2) fog[t] = 1` pass). Verified by hand: with that
  // loop removed, this test's `expect(...).toBe(1)` fails -- the far tile
  // stays 2 forever, because nothing else ever demotes it. This is the test
  // that catches break 1.
  it('a tile previously in sight (2) drops to explored (1) once nothing reveals it this tick', () => {
    const prev = emptyFog();
    const farTile = 0 * W + 0; // (0, 0) -- nowhere near the unit below.
    prev[farTile] = 2;

    // A unit far across the map, sight 2 -- cannot possibly reach (0, 0).
    const input = oneUnitInput(15, 15, 2);
    const fog = computeFog(prev, input);

    expect(fog[farTile]).toBe(1);
  });

  it('explored (>=1) is monotonic: a tile already at 1 stays 1, never resets to 0', () => {
    const prev = emptyFog();
    const tile = 5 * W + 5;
    prev[tile] = 1;

    const input = oneUnitInput(15, 15, 2); // nowhere near (5, 5) either.
    const fog = computeFog(prev, input);

    expect(fog[tile]).toBe(1);
  });

  it('a tile currently in a living unit\'s sight is (re-)revealed to 2 even if it decayed to 1 first', () => {
    const prev = emptyFog();
    const input = oneUnitInput(10, 10, 3);
    const tile = 10 * W + 10; // the unit's own tile.
    const fog = computeFog(prev, input);
    expect(fog[tile]).toBe(2);
  });

  it('does not mutate the prev array passed in (pure function)', () => {
    const prev = emptyFog();
    prev[10 * W + 10] = 2;
    const snapshot = prev.slice();
    computeFog(prev, oneUnitInput(0, 0, 1));
    expect(prev).toEqual(snapshot);
  });
});

describe('computeFog: only side 0 reveals, and only living units', () => {
  // Break 2 (brief item 2): change `side[i] !== 0` to always pass (let side 1
  // reveal too). Verified by hand: with that guard removed, this test's
  // `expect(...).toBe(0)` fails -- the tile under the hostile unit becomes 2.
  // This is the test that catches break 2.
  it('a living side-1 unit does not reveal anything', () => {
    const prev = emptyFog();
    const input = oneUnitInput(10, 10, 3, { side: Uint8Array.from([1]) });
    const fog = computeFog(prev, input);
    expect(fog[10 * W + 10]).toBe(0);
  });

  it('a dead side-0 unit does not reveal anything', () => {
    const prev = emptyFog();
    const input = oneUnitInput(10, 10, 3, { alive: Uint8Array.from([0]) });
    const fog = computeFog(prev, input);
    expect(fog[10 * W + 10]).toBe(0);
  });

  it('a living side-0 unit does reveal its own tile (control: the guard is not simply always-false)', () => {
    const prev = emptyFog();
    const input = oneUnitInput(10, 10, 3);
    const fog = computeFog(prev, input);
    expect(fog[10 * W + 10]).toBe(2);
  });
});

describe('computeFog: radius boundary (square scan box vs. circular sight)', () => {
  // updateFog scans a (2*ceil(sight)+1)^2 square around the unit's tile, then
  // rejects anything outside the true circular radius on squared distance.
  // Fractional sight (2.4) makes ceil(sight) = 3 strictly larger than the
  // radius itself, so the scan box's own corner sits well outside the
  // circle -- exactly the case the squared-distance check exists for, and
  // exactly the case no screenshot would catch (the corner tile differs from
  // its neighbours by one pixel of coverage, at a diamond's actual corner).
  it('a tile at the corner of the ceil(sight) scan box is NOT revealed', () => {
    const prev = emptyFog();
    const input = oneUnitInput(10, 10, 2.4); // r = ceil(2.4) = 3.
    const fog = computeFog(prev, input);

    // Corner of the scan box: tile (13, 13), offset (3, 3) from the unit's
    // tile. Distance from the unit's own centre (10.5, 10.5) to this tile's
    // centre (13.5, 13.5) is sqrt(18) ~= 4.24, well outside sight 2.4.
    const corner = 13 * W + 13;
    expect(fog[corner]).toBe(0);

    // All four corners, for good measure -- a bug that only mishandles one
    // quadrant (e.g. a sign error in dx or dy) would slip past a single-
    // corner assertion.
    expect(fog[13 * W + 13]).toBe(0); // SE
    expect(fog[13 * W + 7]).toBe(0); // SW
    expect(fog[7 * W + 13]).toBe(0); // NE
    expect(fog[7 * W + 7]).toBe(0); // NW
  });

  it('a tile just inside the circle (near the scan box edge, not its corner) IS revealed', () => {
    const prev = emptyFog();
    const input = oneUnitInput(10, 10, 2.4);
    const fog = computeFog(prev, input);

    // Due east, offset (2, 0): distance 2.0 < 2.4 -- inside the circle, and
    // still inside a 3-tile-radius scan box, so this asserts the check
    // isn't so strict it also rejects tiles that legitimately belong.
    expect(fog[10 * W + 12]).toBe(2);
  });

  it('a tile at exactly the sight radius (integer sight) is revealed -- the boundary is inclusive', () => {
    const prev = emptyFog();
    const input = oneUnitInput(10, 10, 3); // r = ceil(3) = 3, exact.
    const fog = computeFog(prev, input);

    // Due east, offset (3, 0): distance exactly 3.0 == sight. The source
    // check is `dx*dx + dy*dy > sight*sight` (strict greater-than rejects),
    // so a tile at exactly the radius is NOT rejected.
    expect(fog[10 * W + 13]).toBe(2);
  });
});

describe('hasSight: Bresenham over blocked, with a lowProfile exemption', () => {
  // Break 3 (brief item 3): change `blocked[t] !== 0 && !isLowProfile(x, y)`
  // to just `blocked[t] !== 0` (drop the exemption). Verified by hand: with
  // the exemption dropped, this test's `expect(...).toBe(true)` fails -- the
  // low-profile wall blocks sight it should not. This is the test that
  // catches break 3.
  it('a low-profile blocked tile on the line does NOT block sight', () => {
    const w = 5;
    const blocked = new Uint8Array(w * 1);
    blocked[2] = 1; // tile (2, 0) is blocked...
    const isLowProfile = (x: number, y: number): boolean => x === 2 && y === 0; // ...but low-profile.
    expect(hasSight(blocked, w, isLowProfile, 0, 0, 4, 0)).toBe(true);
  });

  it('a non-low-profile blocked tile on the line DOES block sight', () => {
    const w = 5;
    const blocked = new Uint8Array(w * 1);
    blocked[2] = 1; // tile (2, 0), not low-profile.
    expect(hasSight(blocked, w, () => false, 0, 0, 4, 0)).toBe(false);
  });

  it('an unobstructed line returns true', () => {
    const w = 5;
    const blocked = new Uint8Array(w * 1);
    expect(hasSight(blocked, w, () => false, 0, 0, 4, 0)).toBe(true);
  });

  it('the destination tile itself may be blocked and still be visible ("you can see the building you stand next to")', () => {
    const w = 5;
    const blocked = new Uint8Array(w * 1);
    blocked[4] = 1; // the target tile (4, 0) itself.
    expect(hasSight(blocked, w, () => false, 0, 0, 4, 0)).toBe(true);
  });

  it('a diagonal line is blocked by a wall it actually crosses', () => {
    const w = 5;
    const h = 5;
    const blocked = new Uint8Array(w * h);
    blocked[2 * w + 2] = 1; // (2, 2), on the (0,0)->(4,4) diagonal.
    expect(hasSight(blocked, w, () => false, 0, 0, 4, 4)).toBe(false);
  });
});

describe('isFogVisible', () => {
  it('true only when the fog value is exactly 2 (in sight now)', () => {
    const fog = new Uint8Array(W * H);
    fog[5 * W + 5] = 2;
    fog[6 * W + 6] = 1;
    expect(isFogVisible(fog, W, H, 5, 5)).toBe(true);
    expect(isFogVisible(fog, W, H, 6, 6)).toBe(false); // explored, not in sight.
    expect(isFogVisible(fog, W, H, 7, 7)).toBe(false); // never seen.
  });

  it('false off the map in every direction', () => {
    const fog = new Uint8Array(W * H).fill(2);
    expect(isFogVisible(fog, W, H, -1, 5)).toBe(false);
    expect(isFogVisible(fog, W, H, 5, -1)).toBe(false);
    expect(isFogVisible(fog, W, H, W, 5)).toBe(false);
    expect(isFogVisible(fog, W, H, 5, H)).toBe(false);
  });
});

/** A 20x1 strip: a side-0 unit at x=2 and a side-1 unit at x=17, sight 2. */
function oneUnitEach(viewerSide: number): FogInput {
  return {
    width: 20,
    height: 1,
    entityCount: 2,
    alive: new Uint8Array([1, 1]),
    side: new Uint8Array([0, 1]),
    typeIdx: new Uint16Array([0, 0]),
    posX: new Int32Array([Math.round(2.5 * 65536), Math.round(17.5 * 65536)]),
    posY: new Int32Array([32768, 32768]),
    sightByType: new Float64Array([2]),
    blocked: new Uint8Array(20),
    isLowProfile: () => false,
    viewerSide,
  };
}

describe('computeFog viewerSide', () => {
  // Falsified (N1a task 2): `side[i] !== viewerSide` back to `side[i] !== 0`
  // in fog.ts turns the viewer-1 half of this test red.
  it("reveals around the viewer's units only", () => {
    const f0 = computeFog(new Uint8Array(20), oneUnitEach(0));
    expect(f0[2]).toBe(2);
    expect(f0[17]).toBe(0);
    const f1 = computeFog(new Uint8Array(20), oneUnitEach(1));
    expect(f1[2]).toBe(0);
    expect(f1[17]).toBe(2);
  });
});

describe('computeFog: extraObservers (Field Works, #277)', () => {
  // Mutation: ignore `extraObservers` in computeFog and the first test goes red.
  it('an extra observer at sight 10 reveals a tile centre 9.9 away and not one 10.1 away', () => {
    const at = (x: number): Uint8Array =>
      computeFog(emptyFog(), oneUnitInput(0, 0, 0.1, { entityCount: 0, extraObservers: [{ x, y: 10.5, sight: 10 }] }));
    // Tile 19's centre is x = 19.5.
    expect(at(9.6)[10 * W + 19]).toBe(2); // 9.9 away
    expect(at(9.4)[10 * W + 19]).toBe(0); // 10.1 away
  });

  it('without observers the result is byte-equal to the same input with an empty list', () => {
    const base = oneUnitInput(5, 5, 4);
    const a = computeFog(emptyFog(), base);
    const b = computeFog(emptyFog(), { ...base, extraObservers: [] });
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});
