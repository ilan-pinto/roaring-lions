/**
 * The ground-height query units, FX, wrecks, shadows and the camera all
 * stand on, plus the world-Y conversion the ground mesh's own height is
 * derived through.
 *
 * ## It used to sample terraces; it samples the drawn surface now
 *
 * Task B3.2 wrote this to sample the CONTAINING TILE and return its integer
 * level, "matching Pixi's `groundOffset` and B2's terraced ground mesh
 * exactly: both sample by `Math.floor`, deliberately, so a unit crossing a
 * terrace steps up rather than ramping across a cliff face with no geometry
 * there to stand on."
 *
 * `terrain/ground.ts` no longer draws terraces on open ground, so that
 * reasoning now argues for the opposite answer: there IS geometry there to
 * stand on, and sampling the integer would float a unit above every valley
 * and sink it into every hill. The rule is unchanged in spirit -- **sample
 * what is drawn** -- and `terrain/surface.ts` is what is drawn.
 *
 * ## Two callers' worth of type, one function
 *
 * The first parameter accepts either shape:
 *
 *  - A `TerrainSurface`. What `ThreeRenderer` holds and what production
 *    always passes; `retained.elevation` is typed as one, so the compiler
 *    guarantees it.
 *  - A raw `Uint8Array` elevation grid, or null. The pre-existing shape,
 *    kept because a good deal of this backend's test suite constructs one by
 *    hand and because the answer it gives -- the containing tile's integer
 *    level -- is still exactly right for a TERRACE and for flat ground.
 *    A raw grid gets the pre-2026-09-03 terraced answer, deliberately and
 *    with no smoothing, because a bare grid does not carry the `blocked`
 *    mask the terrace rule needs and guessing one would be worse than
 *    answering the older question honestly.
 *
 * `groundLevelAt` therefore returns a FLOAT now where it used to return an
 * integer. Its one arithmetic consumer, `units/pick.ts`, multiplies it by
 * `ELEV_STEP` to get a lift in screen pixels, which is strictly better for a
 * fractional level: picking mid-slope now hits the ground the player can
 * see rather than the terrace that is no longer drawn.
 */
import { levelAt, WORLD_PER_LEVEL } from './terrain/shared';
import { surfaceLevel, type TerrainSurface } from './terrain/surface';
import type { TerrainInput } from './terrain/types';

/** Never mutated, never indexed past its own zero length -- `levelAt` only
 *  reads `blocked`/`cover` array identity, never their contents, so one
 *  shared empty array for both fields is safe to reuse across every call. */
const EMPTY_BYTES = new Uint8Array(0);

/**
 * What every ground-height consumer in this backend accepts.
 *
 * A union rather than a straight swap to `TerrainSurface` so the change
 * stays a widening: every existing call site and every existing fixture
 * keeps compiling and keeps meaning what it meant. `ThreeRenderer`'s own
 * `retained.elevation` is typed as the narrow `TerrainSurface | null`, which
 * is what makes "production always samples the drawn surface" a compiler
 * guarantee rather than a convention.
 */
export type ElevationSource = Uint8Array | TerrainSurface | null;

function isSurface(src: ElevationSource): src is TerrainSurface {
  return src !== null && !(src instanceof Uint8Array);
}

/**
 * Height of the drawn ground under world point `(x, y)`, in ELEVATION
 * LEVELS -- fractional over interpolated ground, exactly the tile's own
 * integer over a terrace or flat ground, and 0 off the map (the rule
 * `levelAt` has always used, and what makes a rim tile show its full face).
 */
export function groundLevelAt(
  elevation: ElevationSource,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  if (isSurface(elevation)) return surfaceLevel(elevation, x, y);
  const input: TerrainInput = {
    width,
    height,
    decor: null,
    elevation,
    blocked: EMPTY_BYTES,
    cover: EMPTY_BYTES,
  };
  return levelAt(input, Math.floor(x), Math.floor(y));
}

/**
 * World-space Y (three.js height) of the ground under world point `(x,
 * y)`. Derived through `WORLD_PER_LEVEL`, not an independent constant --
 * if the two ever disagreed, a unit would float above or sink into its own
 * tile.
 */
export function groundWorldY(
  elevation: ElevationSource,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  return groundLevelAt(elevation, width, height, x, y) * WORLD_PER_LEVEL;
}

/**
 * World-space Y of TILE `(tx, ty)` itself -- for a whole-tile decal (a fog
 * quad, a smoke puff, a trail mark) rather than for a point on the ground.
 *
 * Samples the tile's CENTRE, and the distinction only started existing on
 * 2026-09-03. While the ground was terraced, `groundWorldY(elevation, w, h,
 * tx, ty)` with integer arguments floored into tile `(tx, ty)` and returned
 * its own flat height, so the three tile-loop builders passed integers and
 * got exactly what they wanted. Against an interpolated surface those same
 * integers name the tile's top-left CORNER, which on a slope is up to HALF A
 * LEVEL from the tile's own height -- and a fog quad half a level out
 * separates from the ground it is supposed to be lying on.
 *
 * Photographed before it was fixed: on `qarn_hadid`'s massif the unexplored
 * half of the frame broke into a lattice of lit slivers where the ground
 * showed between mis-set fog quads.
 *
 * The tile centre is also exactly where the surface passes through the sim's
 * own integer (`terrain/surface.ts`), so on any given tile this returns the
 * identical number the pre-2026-09-03 code did -- which is why fog, smoke and
 * trails are unmoved by the smoothing rather than merely close to it.
 */
export function tileGroundWorldY(
  elevation: ElevationSource,
  width: number,
  height: number,
  tx: number,
  ty: number
): number {
  return groundWorldY(elevation, width, height, tx + 0.5, ty + 0.5);
}
