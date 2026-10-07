/**
 * Buildings drawn to their footprints (polish lane; lead ruling 7 Oct, "fit
 * buildings to their plots"). The DEFAULT since that ruling:
 * `RendererOptions.buildingFit` absent is `DEFAULT_BUILDING_FIT`, and
 * `&fitbuildings=off` still draws the shipped size for comparison.
 *
 * What it fixes. A building mesh used to draw at ONE size whatever its
 * footprint said: `ThreeRenderer.updateBuildingMeshes` stood the clone at the
 * footprint centre at `MESH_SCALE` and nothing else, so a house was 4.26 x
 * 3.71 tiles in plan and 4.24 world units tall on a 1x1 plot, and an
 * apartment 4.92 x 4.89 and 7.74 tall on a 2x2. Each one overhung its
 * street and hid the ground up-screen of it (`tools/src/map_visibility.ts`,
 * GH-416). This module is the rule that scales a mesh to its plot.
 *
 * The shipped rule, `stretch`, in four clauses:
 *
 * 1. SHRINK ONLY. No axis grows past the shipped size (scale <= 1). A mesh
 *    smaller than its plot (`concrete`: 1.20 x 1.77 on a 2x2 or 3x3) stays
 *    as it ships; growing it would ADD occlusion.
 *
 * 2. THE PLAN FILLS THE PLOT. Each plan axis is scaled to its own footprint
 *    side, independently. The lead chose this over a capped anisotropy
 *    (`clamped`, at most 1.25x between the two plan scales) knowing it
 *    widens some textured facades: measured over the 512 non-run structures
 *    on the 26 campaign maps, `stretch` covers 84.8% of the plot on average
 *    against 75.5% clamped and 66.9% uniform. With the height floor below,
 *    258 of those 512 distort past 1.25x (`fitDistortion`); the worst sit on
 *    one-tile-deep plots -- a warehouse on a 4x1 at 4.0x, houses on a 7x1 and
 *    a 4x1 at 3.7x and 3.5x (PR #444's close-ups).
 *
 * 3. HEIGHT FOLLOWS THE SMALLER PLAN SCALE, so the vertical proportions
 *    match the less-stretched facade. Height is what hides the fight.
 *
 * 4. ...BUT NOTHING DRAWS SHORTER THAN `MIN_BUILDING_HEIGHT` (lead ruling 7
 *    Oct: "about 2x a rifleman"), unless it already ships shorter. Without
 *    it, a warehouse on a 2x1 plot drew 0.35 world units tall -- shorter
 *    than the 0.56 rifleman standing beside it -- and 129 of 251 sheds drew
 *    at or under 1.0. The floor stretches those vertically instead.
 *
 * A per-tile RUN (wall, fence) is never fitted: it turns a quarter to follow
 * its neighbours, is one tile by construction, and already fits it.
 *
 * `uniform` and `clamped` survive as comparison rules (`&fitbuildings=<rule>`)
 * and take the same height floor.
 *
 * Presentation only. Nothing here reads or writes sim state; the sim's
 * footprint and `blocked` tiles are exactly what they were. Pure and
 * three-free, so `tools/src/map_visibility.ts` measures the SAME rule the
 * renderer draws rather than a copy of it.
 */

/** `clamped` only: the larger plan scale may exceed the smaller by at most this. */
export const FIT_MAX_ANISOTROPY = 1.25;

/**
 * The lowest a fitted building draws, world units (one tile = 3 m). The
 * lead's "about 2x a rifleman": the rifleman is 1.67 m on a 3 m tile, 0.557
 * world units (`map_visibility.ts`'s body model), so 1.2 is 2.15 of him.
 */
export const MIN_BUILDING_HEIGHT = 1.2;

/** How a building mesh is scaled to its plot. `off` is the shipped size. */
export type BuildingFit = 'off' | 'uniform' | 'clamped' | 'stretch';

/** What the renderer draws when `RendererOptions.buildingFit` is absent. */
export const DEFAULT_BUILDING_FIT: BuildingFit = 'stretch';

export interface FitScale {
  /** Along game x. */
  readonly sx: number;
  /** Height. */
  readonly sy: number;
  /** Along game y (world z). */
  readonly sz: number;
}

const UNIT: FitScale = { sx: 1, sy: 1, sz: 1 };

/**
 * The scale (multiplying `MESH_SCALE`) for a mesh `meshW` x `meshD` in plan
 * and `meshH` tall (world units = tiles, at `MESH_SCALE`) standing on a
 * `footW` x `footD` footprint bounding box.
 *
 * - `stretch` (the default): plan fills the plot, height follows the smaller
 *   plan scale.
 * - `clamped`: as `stretch`, the plan anisotropy capped at 1.25x.
 * - `uniform`: one plan scale on both axes, the largest that fits.
 *
 * Every rule but `off` then raises the height to `MIN_BUILDING_HEIGHT`
 * (never past the shipped height).
 */
export function buildingFitScale(
  meshW: number,
  meshD: number,
  meshH: number,
  footW: number,
  footD: number,
  fit: BuildingFit,
  perTile = false
): FitScale {
  if (fit === 'off' || perTile) return UNIT;
  if (!(meshW > 0) || !(meshD > 0) || !(footW > 0) || !(footD > 0)) return UNIT;
  const ax = Math.min(1, footW / meshW);
  const az = Math.min(1, footD / meshD);
  const lo = Math.min(ax, az);
  const floor = meshH > 0 ? Math.min(1, MIN_BUILDING_HEIGHT / meshH) : 0;
  const sy = Math.max(lo, floor);
  if (fit === 'uniform') return { sx: lo, sy, sz: lo };
  const cap = fit === 'clamped' ? lo * FIT_MAX_ANISOTROPY : Infinity;
  return { sx: Math.min(ax, cap), sy, sz: Math.min(az, cap) };
}

/**
 * How far a fit distorts the mesh's own proportions: the largest of the
 * three axis scales over the smallest. 1 is undistorted; a facade's windows
 * are stretched by at most this.
 */
export function fitDistortion(s: FitScale): number {
  return Math.max(s.sx, s.sy, s.sz) / Math.min(s.sx, s.sy, s.sz);
}
