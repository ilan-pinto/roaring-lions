/**
 * `groundLevelAt` / `groundWorldY` -- the query units, FX, wrecks, shadows
 * and the camera stand on.
 *
 * Read the two `describe` blocks below in order. The first pins the RAW-GRID
 * branch, which is the pre-2026-09-03 terraced answer and is still exactly
 * right for what it describes (a terrace, flat ground, and every fixture in
 * this backend that hands these functions a bare `Uint8Array`). The second
 * pins the SURFACE branch, which is what production always passes and what
 * the ground mesh actually draws.
 */
import { describe, it, expect } from 'vitest';
import { groundLevelAt, groundWorldY, tileGroundWorldY } from './ground-height';
import { WORLD_PER_LEVEL } from './terrain/shared';
import { terrainSurfaceFrom } from './terrain/surface';

const W = 4, H = 4;
const flat = null;
const stepped = new Uint8Array([
  0, 0, 3, 3,
  0, 0, 3, 3,
  0, 0, 3, 3,
  0, 0, 3, 3,
]);

describe('groundLevelAt: the raw-grid branch (terraced, unchanged)', () => {
  it('is zero everywhere with no elevation layer', () => {
    expect(groundLevelAt(flat, W, H, 1.5, 2.5)).toBe(0);
  });

  it('samples the containing tile, not the nearest corner', () => {
    // Terraces, not ramps -- matching Pixi's groundOffset and B2's mesh.
    // Anywhere inside tile (1, y) is level 0; anywhere inside (2, y) is 3.
    expect(groundLevelAt(stepped, W, H, 1.01, 0.5)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 1.99, 0.5)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 2.01, 0.5)).toBe(3);
  });

  it('does not interpolate across the terrace edge', () => {
    // The failure this exists to prevent: a unit sliding smoothly up a cliff
    // face instead of stepping onto it, its feet hanging in mid-air the whole
    // way. Sampling two points either side of x = 2 must give exactly 0 and 3.
    const lo = groundLevelAt(stepped, W, H, 1.999, 1.5);
    const hi = groundLevelAt(stepped, W, H, 2.001, 1.5);
    expect(hi - lo).toBe(3);
  });

  it('clamps off-map rather than reading out of bounds', () => {
    expect(groundLevelAt(stepped, W, H, -1, -1)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 99, 99)).toBe(0);
  });
});

describe('groundWorldY', () => {
  it('converts levels to the same world height the mesh uses', () => {
    // Derived, not chosen: if these ever disagree, units float or sink.
    expect(groundWorldY(stepped, W, H, 2.5, 2.5)).toBeCloseTo(3 * WORLD_PER_LEVEL, 10);
  });
});

describe('the surface branch -- what production actually passes', () => {
  const open = terrainSurfaceFrom(stepped, new Uint8Array(W * H), W, H);
  const walled = terrainSurfaceFrom(
    stepped,
    // Every tile of the raised half blocked: a `^` ridge, or a building.
    Uint8Array.from([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]),
    W,
    H
  );

  it('stands a unit on the DRAWN ground, not on the tile it happens to be inside', () => {
    // The whole point. `ground.ts` no longer draws a terrace between two open
    // tiles, so sampling the containing tile's integer would float a unit
    // above every valley and sink it into every hill -- by up to half a level
    // at a tile boundary, which is `WORLD_PER_LEVEL / 2` of visible gap under
    // its feet. Between two open tiles three levels apart the answer must be
    // strictly between them, and must MOVE as the unit walks.
    const at = (x: number): number => groundLevelAt(open, W, H, x, 1.5);
    expect(at(1.5)).toBe(0);
    expect(at(2.5)).toBe(3);
    for (const x of [1.75, 2.0, 2.25]) {
      expect(at(x), `x=${x}`).toBeGreaterThan(0);
      expect(at(x), `x=${x}`).toBeLessThan(3);
    }
    expect(at(1.75)).toBeLessThan(at(2.0));
    expect(at(2.0)).toBeLessThan(at(2.25));
  });

  it('still steps, not ramps, onto a BLOCKED tile -- a cliff face has no geometry to walk up', () => {
    // The half of the old behaviour that survives, and the reason
    // `terrainSurfaceFrom` needs `blocked` at all. The sentence the previous
    // version of this file used to apply to every elevation change now
    // applies to exactly the ones the sim calls walls.
    const lo = groundLevelAt(walled, W, H, 1.999, 1.5);
    const hi = groundLevelAt(walled, W, H, 2.001, 1.5);
    expect(lo).toBe(0);
    expect(hi).toBe(3);
  });

  it('agrees with the raw grid EXACTLY at every tile centre, so nothing moved where the sim looks', () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(groundLevelAt(open, W, H, x + 0.5, y + 0.5), `tile (${x},${y})`).toBe(
          groundLevelAt(stepped, W, H, x + 0.5, y + 0.5)
        );
      }
    }
  });

  it('tileGroundWorldY samples the tile CENTRE, not the corner an integer names', () => {
    // The distinction the smoothing created, and the defect it caused before
    // it existed. A fog quad, a smoke puff and a trail mark all cover a whole
    // tile and all used to pass integer tile indices to `groundWorldY`, which
    // floored into the tile and returned its flat height. Against an
    // interpolated surface the same integers name the tile's top-left CORNER.
    //
    // On this fixture, tile (2, 1)'s centre is level 3 (its own authored
    // value) while its corner sits mid-ramp between 0 and 3 -- so the two
    // answers differ by more than a level and a fog quad set from the corner
    // separates visibly from the ground under it.
    const corner = groundWorldY(open, W, H, 2, 1);
    const centre = tileGroundWorldY(open, W, H, 2, 1);
    expect(centre).not.toBeCloseTo(corner, 3);
    // And the centre is EXACTLY what the terraced code returned, which is why
    // fog/smoke/trails are unmoved by the smoothing rather than merely close.
    expect(centre).toBe(groundWorldY(stepped, W, H, 2, 1));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(tileGroundWorldY(open, W, H, x, y), `tile (${x},${y})`).toBe(
          groundWorldY(stepped, W, H, x, y)
        );
      }
    }
  });

  it('is zero off the map and on a map with no relief, exactly as the raw grid is', () => {
    const nothing = terrainSurfaceFrom(null, new Uint8Array(W * H), W, H);
    expect(groundLevelAt(nothing, W, H, 1.5, 2.5)).toBe(0);
    expect(groundWorldY(nothing, W, H, 1.5, 2.5)).toBe(0);
    expect(groundLevelAt(open, W, H, -1, -1)).toBe(0);
    expect(groundLevelAt(open, W, H, 99, 99)).toBe(0);
  });
});
