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
import { fbm2 } from './noise';
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
/** An anti-tank ditch tile (`d`). Unlike every value above it, this one is
 *  paired with a MECHANIC -- the tile also sets `TerrainInput.boulder`, the
 *  vehicle-only block. `boulder` alone says a vehicle is stopped; this says by
 *  what, which is the only thing separating a `d` tile from a `b` one. */
export const DECOR_DITCH = 5;
/** A marsh tile (`~`). Paired with a MECHANIC, like `DECOR_DITCH`: the tile
 *  also sets `TerrainInput.boulder` (the vehicle-only block) and carries cover 1. */
export const DECOR_MARSH = 6;

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

/** The sRGB electro-optical transfer function, one channel. Vertex colours
 *  and shader uniforms must be LINEAR now that the output pass encodes to
 *  sRGB (spec §1): a palette hex fed in raw would be encoded twice and land
 *  brighter than authored. `hexToUnit` stays sRGB for the pure builders,
 *  whose `MeshData.colors` are still asserted against palette bytes. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string): [number, number, number] {
  const [r, g, b] = hexToUnit(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
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

// -- The marsh's open water (GH-871 P2, R-6) ----------------------------
//
// A `~` tile is mud with reeds on it; the water is the wetter patches in it,
// meanders and pools. It is a PRESENTATION field: the sim sees `~` as one
// tile type (cover 1, a wall to wheels), and nothing here reaches it. Reeds
// are kept off it (decor-place.ts), and P4's control-C bake will sample the
// same function so the ripple lands where the reeds are not.
//
// Everything is in TILE units and anchored to world coordinates, not to the
// marsh's own bounding box, so a marsh of any shape or size reads the same
// field -- only its inset from the bank is local.

/** Water is kept this far, in tiles, from any non-marsh tile: a causeway, a
 *  bank or a road tile is never lapped. A hard zero at and inside this. */
export const MARSH_WATER_INSET = 0.25;
/** The weight rises from 0 to the field's value over this many tiles past the
 *  inset, so the mask is continuous: no step at the bank. */
export const MARSH_WATER_RAMP = 0.1;
/** Meanders: a thin band around the isoline `MARSH_MEANDER_LEVEL` of a
 *  low-frequency fBm. Period and octaves are `fbm2`'s own. */
export const MARSH_MEANDER_PERIOD = 1.2;
export const MARSH_MEANDER_LEVEL = 0;
/** Half-width of the meander band, in the fBm's own units (not tiles). */
export const MARSH_MEANDER_HALF = 0.12;
/** Pools: where a second fBm exceeds this threshold. */
export const MARSH_POOL_PERIOD = 1;
export const MARSH_POOL_THRESHOLD = 0.4;
const MARSH_MEANDER_SEED = 6101;
const MARSH_POOL_SEED = 6203;
/** Half-width of the pool edge's softening, in the pool fBm's own units. */
const MARSH_POOL_SOFT = 0.04;

function smoothstep01(lo: number, hi: number, v: number): number {
  const t = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/** Distance in tiles from `(x, z)` to the nearest tile that is NOT a marsh
 *  tile (out of bounds counts as not), capped at 1; 0 if the point is itself
 *  off the marsh. Only the eight neighbours matter below the cap. */
function marshInnerDistance(decor: Uint8Array, width: number, height: number, x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= width || tz >= height) return 0;
  if (decor[tz * width + tx] !== DECOR_MARSH) return 0;
  const fx = x - tx;
  const fz = z - tz;
  let best = 1;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = tx + dx;
      const nz = tz + dz;
      const marsh = nx >= 0 && nz >= 0 && nx < width && nz < height && decor[nz * width + nx] === DECOR_MARSH;
      if (marsh) continue;
      const gx = dx < 0 ? fx : dx > 0 ? 1 - fx : 0;
      const gz = dz < 0 ? fz : dz > 0 ? 1 - fz : 0;
      const d = Math.hypot(gx, gz);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * How wet the marsh is at world point `(x, z)` in tile units, a weight in
 * `[0, 1]`: open water where it is `>= 0.5`. Zero off the marsh, and zero
 * within `MARSH_WATER_INSET` of any non-marsh tile.
 *
 * Deterministic and three-free: `fbm2` over `tileHash`, no `Math.random`.
 * Two fields, the larger wins: a THIN BAND around an isoline of one fBm (a
 * meander, a channel through the reeds) and a THRESHOLD of another (a pool).
 */
export function marshWaterAt(
  decor: Uint8Array | null,
  width: number,
  height: number,
  x: number,
  z: number
): number {
  if (!decor) return 0;
  const inner = marshInnerDistance(decor, width, height, x, z);
  const edge = smoothstep01(MARSH_WATER_INSET, MARSH_WATER_INSET + MARSH_WATER_RAMP, inner);
  if (edge === 0) return 0;
  const m = fbm2(x, z, MARSH_MEANDER_PERIOD, 3, MARSH_MEANDER_SEED);
  const band =
    1 - smoothstep01(MARSH_MEANDER_HALF * 0.7, MARSH_MEANDER_HALF * 1.3, Math.abs(m - MARSH_MEANDER_LEVEL));
  const p = fbm2(x, z, MARSH_POOL_PERIOD, 3, MARSH_POOL_SEED);
  const pool = smoothstep01(MARSH_POOL_THRESHOLD - MARSH_POOL_SOFT, MARSH_POOL_THRESHOLD + MARSH_POOL_SOFT, p);
  return Math.max(band, pool) * edge;
}
