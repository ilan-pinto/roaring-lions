/**
 * Buildings drawn to their footprints (polish lane, lead ruling 7 Oct: "fit
 * buildings to their plots"). MOCK: behind `RendererOptions.buildingFit`, off
 * by default.
 *
 * What it fixes. A building mesh draws at ONE size whatever its footprint
 * says: `ThreeRenderer.updateBuildingMeshes` stands the clone at the
 * footprint centre at `MESH_SCALE` and nothing else, so a house is 4.26 x
 * 3.71 tiles in plan and 4.24 world units tall on a 1x1 plot, and an
 * apartment 4.92 x 4.89 and 7.74 tall on a 2x2. Each one overhangs its
 * street and hides the ground up-screen of it (`tools/src/map_visibility.ts`,
 * GH-416). This module is the rule that scales a mesh to its plot.
 *
 * The rule, in three clauses -- each one a decision, with the reason beside it:
 *
 * 1. SHRINK ONLY. No axis ever grows past the shipped size (scale <= 1). A
 *    mesh smaller than its plot (`concrete`: 1.20 x 1.77 on a 2x2 or 3x3)
 *    stays as it ships; growing it would ADD occlusion, which is the
 *    opposite of the ruling's purpose, and is a separate question.
 *
 * 2. PLAN FITS THE PLOT, WITH ANISOTROPY CAPPED AT `FIT_MAX_ANISOTROPY`.
 *    Each axis is scaled to its own footprint side, but the larger of the
 *    two plan scales may exceed the smaller by at most 1.25x. The two ends
 *    of that dial, measured over the 512 non-run structures on the 26
 *    campaign maps (mean share of the footprint the drawn plan covers):
 *    uniform scale (cap 1.0) never stretches a window but covers 66.9%,
 *    and leaves a strip of half a tile or more of blocked, bare plot on
 *    317 of them (a house on a 3x2 draws 2.30 x 2.00); an uncapped fit
 *    covers 84.8% (the shipped figure, minus the overhang) but draws a 1x2
 *    house's long wall 2.3x wider than its windows were made. 1.25 covers 75.5% (houses 90%,
 *    against 75% uniform) and moves no window's aspect by more than a
 *    quarter. Visibility barely depends on this clause -- Beit Sahwan III
 *    reads 80.3% uniform, 79.8% capped, 79.5% uncapped -- because height,
 *    clause 3, is what hides the fight.
 *
 * 3. HEIGHT FOLLOWS THE SMALLER PLAN SCALE. `sy = min(sx, sz)`, so the
 *    vertical proportions match the LESS-scaled facade exactly and the other
 *    facade is widened by at most the cap. Height is the term that hides
 *    the fight (a house's 4.24 is what throws ~5 tiles of dead ground), so
 *    any rule that kept the shipped height would keep most of the defect.
 *
 * A per-tile RUN (wall, fence) is never fitted: it turns a quarter to follow
 * its neighbours, is one tile by construction, and already fits it.
 *
 * Presentation only. Nothing here reads or writes sim state; the sim's
 * footprint and `blocked` tiles are exactly what they were. Pure and
 * three-free, so `tools/src/map_visibility.ts` measures the SAME rule the
 * renderer draws rather than a copy of it.
 */

/** The larger plan scale may exceed the smaller by at most this factor. */
export const FIT_MAX_ANISOTROPY = 1.25;

/** How a building mesh is scaled to its plot. `off` is the shipped size. */
export type BuildingFit = 'off' | 'uniform' | 'clamped' | 'stretch';

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
 * (world units = tiles, at `MESH_SCALE`) standing on a `footW` x `footD`
 * footprint bounding box.
 *
 * - `uniform`: one scale on every axis, the largest that fits the plot.
 * - `clamped`: the recommended rule (see the module comment).
 * - `stretch`: plan fits the plot exactly, height follows the smaller scale
 *   (anisotropy uncapped) -- measured for comparison, not recommended.
 */
export function buildingFitScale(
  meshW: number,
  meshD: number,
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
  if (fit === 'uniform') return { sx: lo, sy: lo, sz: lo };
  const cap = fit === 'clamped' ? lo * FIT_MAX_ANISOTROPY : Infinity;
  return { sx: Math.min(ax, cap), sy: lo, sz: Math.min(az, cap) };
}
