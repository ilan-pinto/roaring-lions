/**
 * Task B3.1: one home for the helpers Phase B2's five separately-reviewed
 * builder tasks each ended up re-declaring.
 *
 * B2's tasks were written in sequence, each barred from editing the files an
 * earlier task's review was still open on -- so a helper needed by more than
 * one builder was copied rather than imported, every time. `docs/superpowers/
 * specs/2026-08-27-phase-b2-outcome.md` names the damage: `hexToUnit` x4,
 * `levelAt` x5, `pushQuad` x3 closures plus `grove.ts`'s own `pushPolygon`,
 * `rectCorners` x2, `MARK_EPSILON` x3, `DECOR_*` x4 -- plus `WORLD_PER_LEVEL`
 * (was `ground.ts`) and `screenOffsetToWorld` (was `scatter.ts`, the grain
 * module, despite `grove.ts` and `buildings.ts` both depending on it -- a
 * projection primitive does not belong there).
 *
 * Every symbol here was diffed copy-against-copy before moving (Task B3.1's
 * report has the full inventory): `hexToUnit`, `levelAt`, `MARK_EPSILON` and
 * the four `DECOR_*` values were byte-identical everywhere they appeared, so
 * moving them changes nothing. `pushQuad`/`pushPolygon` and `rectCorners`
 * were NOT byte-identical -- `pushQuad` took four explicit corners and a
 * `flip` bit, `grove.ts`'s `pushPolygon` took an arbitrary-length fan with no
 * `flip`, and the two `rectCorners` had different parameter conventions (a
 * symmetric half-width vs. explicit min/max on both axes) -- so those two are
 * generalisations proven equivalent on the callers' own existing inputs (see
 * `pushPolygon`'s and `rectCorners`' own doc comments below), not copies of
 * one one true version.
 */
import { TILE_W, TILE_H, ELEV_STEP, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import type { TerrainInput } from './types';

/**
 * DECOR values every terrain builder reads. Mirrors `TERRAIN_DECOR` in
 * `renderer.ts` and `DECOR` in `@lions/data`'s `map.ts` -- redeclared rather
 * than imported, same reason `tones.ts` gives: `renderer.ts` pulls in
 * pixi.js at module scope, and `@lions/render` must not depend on
 * `@lions/data` (ESLint-enforced). Previously redeclared independently in
 * `tones.ts` (road, ridge), `scatter.ts` (all four), `grove.ts` (grove) and
 * `buildings.ts` (ridge) -- one set, here, for all of them.
 */
export const DECOR_ROAD = 1;
export const DECOR_GROVE = 2;
export const DECOR_KNOLL = 3;
export const DECOR_RIDGE = 4;

/**
 * World units of height per elevation level.
 *
 * Derived, not chosen. Pixi raises a tile by `ELEV_STEP` screen pixels per
 * level; three.js works in world units, and `WORLD_Y_PER_LIFT_PIXEL` is the
 * bridge `project.ts` solved for. Going through it means a four-level ridge
 * stands exactly as tall on screen in both backends, and it keeps
 * `ELEV_STEP` the single place that number is decided.
 *
 * Was `ground.ts`'s export; `buildings.ts`, `grove.ts` and `scatter.ts` all
 * imported it from there despite none of them being the ground builder --
 * moved here (Task B3.1, orchestrator ruling 1) so every terrain builder
 * imports it from the same place `ground.ts` now does too.
 */
export const WORLD_PER_LEVEL = ELEV_STEP * WORLD_Y_PER_LIFT_PIXEL;

/**
 * Marks sit this far above their own tile's top (or a clutter mark above its
 * roof, or a tree's flat trunk shadow above its ground plane), in world
 * units, so they do not z-fight the quad directly beneath them. Was declared
 * identically (value 0.01) in `scatter.ts`, `grove.ts` and `buildings.ts`;
 * `scatter.ts`'s own doc comment for it has the full derivation (`WORLD_PER_LEVEL`
 * is about 0.255 world units, so 0.01 is under 4% of the smallest terrace
 * step, comfortably below what reads as "floating", and clears one
 * orthographic depth-buffer step with room to spare at this camera's fixed
 * pitch) -- reasoning that does not change by being read from one place
 * instead of three.
 */
export const MARK_EPSILON = 0.01;

/** RGB triple in 0..1, the vertex-colour format every terrain builder's
 *  `MeshData.colors` uses. */
export type UnitColor = readonly [number, number, number];

/** `#RRGGBB` (leading `#` optional) -> RGB triple in 0..1 -- the last step
 *  before a quantised tone becomes a vertex colour. Was declared identically
 *  in `ground.ts`, `scatter.ts`, `grove.ts` and `buildings.ts`. */
export function hexToUnit(hex: string): [number, number, number] {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Elevation level (0-9) at `(x, y)`, or 0 off the map -- the rule that makes
 *  a rim tile show its full face rather than nothing at all. Was declared
 *  identically in `ground.ts`, `scatter.ts`, `grove.ts`, `buildings.ts` and
 *  (necessarily, since app-level code cannot import a builder's private
 *  function) `packages/app/src/terrain-parity.test.ts`. */
export function levelAt(input: TerrainInput, x: number, y: number): number {
  if (x < 0 || x >= input.width || y < 0 || y >= input.height) return 0;
  if (!input.elevation) return 0;
  return input.elevation[y * input.width + x];
}

/**
 * World-space (x, y) offset from a tile centre that projects, via
 * `isoX`/`isoY`, to the given screen-pixel offset from that same tile's
 * screen centre. The exact inverse of the dimetric projection:
 *
 *   isoX(ddx, ddy) = (ddx - ddy) * TILE_W / 2
 *   isoY(ddx, ddy) = (ddx + ddy) * TILE_H / 2
 *
 * Solving that 2x2 system for (ddx, ddy) given (dx, dy) gives the two lines
 * below. This is what lets every Pixi scatter offset -- tuned by eye against
 * the screen-space tile diamond -- be fed straight through and land in the
 * same relative spot in three.js, at whatever height the tile itself stands
 * at.
 *
 * Was `scatter.ts`'s export (the grain module) even though `grove.ts` and
 * `buildings.ts` both depend on it for their own tree/clutter placement --
 * a projection primitive, not grain-specific, so it belongs with the other
 * shared terrain primitives instead.
 */
export function screenOffsetToWorld(dx: number, dy: number): { dx: number; dy: number } {
  return {
    dx: dx / TILE_W + dy / TILE_H,
    dy: dy / TILE_H - dx / TILE_W,
  };
}

/**
 * A rectangle's four corners, top-left/top-right/bottom-right/bottom-left,
 * spanning `[rMin, rMax]` on one axis and `[uMin, uMax]` on the other --
 * `grove.ts`'s original signature and implementation verbatim (it is the
 * more general of the two callers' own versions).
 *
 * `scatter.ts`'s pre-consolidation `rectCorners(halfW, topDy, botDy)` built a
 * screen-pixel rectangle symmetric about its own centre column, y-down
 * (Pixi's screen convention: `topDy` is negative, `botDy` positive-or-zero).
 * `grove.ts`'s built a billboard-local rectangle on its `[right, up]` axes,
 * asymmetric on `right` (the trunk highlight's own corners are not centred)
 * and y-up (`uMax` is physically higher than `uMin`). The two are the same
 * generator underneath -- same winding, same corner count, same rotational
 * order -- parameterised differently only because their callers' own
 * coordinate conventions differ, so unifying them into `grove.ts`'s
 * strictly-more-general four-bound form and having `scatter.ts` call it as
 * `rectCorners(-halfW, halfW, botDy, topDy)` reproduces
 * `scatter.ts`'s original four corners exactly -- worked out algebraically
 * and confirmed by `shared.test.ts`'s own equivalence test, not merely by
 * inspection.
 */
export function rectCorners(
  rMin: number,
  rMax: number,
  uMin: number,
  uMax: number
): readonly (readonly [number, number])[] {
  return [
    [rMin, uMax],
    [rMax, uMax],
    [rMax, uMin],
    [rMin, uMin],
  ];
}

/**
 * One flat-shaded convex polygon, appended to the caller's own accumulating
 * `positions`/`colors`/`indices` arrays and fan-triangulated from its own
 * first vertex.
 *
 * Generalises both pre-consolidation shapes at once:
 *
 *  - `ground.ts`/`scatter.ts`/`buildings.ts`'s `pushQuad(p0, p1, p2, p3,
 *    color, flip)`, always exactly 4 points, `flip` choosing between the two
 *    possible windings a quad needs (a tile top vs. an east-facing wall, for
 *    instance -- see `ground.ts`'s own doc comment on why the caller, not
 *    this function, has to know which).
 *  - `grove.ts`'s `pushPolygon(points, color)`, an arbitrary-length fan
 *    (4 points for a rect, 8 for a crown lobe's ellipse approximation) but a
 *    single fixed winding -- every polygon `grove.ts` builds lies in one of
 *    exactly two planes, both authored so their own corner order already
 *    traces the correct front-facing perimeter, so it never needed a `flip`.
 *
 * For `flip: false` and any point count, this is `grove.ts`'s original fan
 * verbatim: triangle `i` is `(0, i+1, i)` for `i` in `[1, points.length -
 * 2]`. `flip: true` mirrors that same fan the other way -- `(0, i, i+1)` --
 * rather than reversing the point list, which would also work but would
 * scramble which point is `p0` for a caller reasoning about the shape by
 * corner name.
 *
 * At exactly 4 points this reproduces `pushQuad`'s two index sequences
 * bit-for-bit: worked out by hand and confirmed by `shared.test.ts`'s own
 * equivalence test against the original literal `indices.push(...)` calls,
 * not assumed from the fan formula agreeing "in spirit".
 */
export function pushPolygon(
  positions: number[],
  colors: number[],
  indices: number[],
  points: readonly (readonly [number, number, number])[],
  color: UnitColor,
  flip = false
): void {
  const base = positions.length / 3;
  for (const p of points) positions.push(p[0], p[1], p[2]);
  for (let i = 0; i < points.length; i++) colors.push(color[0], color[1], color[2]);
  for (let i = 1; i < points.length - 1; i++) {
    if (flip) {
      indices.push(base, base + i, base + i + 1);
    } else {
      indices.push(base, base + i + 1, base + i);
    }
  }
}
