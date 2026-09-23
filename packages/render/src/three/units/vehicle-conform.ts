/**
 * WP-A1.3: the terrain conform's four ground samples -- which ground a
 * hull's corners stand on, and what a corner stands on when there is no open
 * ground under it at all.
 *
 * `units/vehicle-weight.ts` turns four heights into a pitch and a roll and
 * knows nothing about maps. This module decides the four heights, and it
 * exists because the obvious answer -- `groundWorldY` at each corner -- is
 * measurably wrong in exactly two places:
 *
 * - **A corner over a BLOCKED tile.** `groundWorldY` answers a blocked tile
 *   (the sim's `blocked` mask, which is what `terrain/surface.ts` draws as a
 *   flat terrace) with that tile's own TOP -- a `^` ridge's level, a
 *   building pad's. A vehicle cannot stand there, but its footprint reaches
 *   over the tile beside it: at `tel_marum` (6,18) facing 0.25, a Lavi's
 *   tail corner sat on the level-4 ridge while its nose stood on level-0
 *   valley floor, and the hull drew 25.8 degrees nose-down where the open
 *   ground it was actually crossing is level. Across the shipped relief maps
 *   this read over 10 degrees where the smooth ground reads under 5 on 130
 *   of `tel_marum`'s 1,534 vehicle-passable tiles and 86 of `deir_amun`'s
 *   1,916 (the reviewer's census -- a tile whose steepest heading of sixteen
 *   reads over 10 while its smooth ground reads under 5 at every heading --
 *   reproduced exactly by `tools/src/vehicle_conform_census.test.ts`).
 *   Every one of `tel_marum`'s is this case: a ridge top.
 * - **A corner OFF THE MAP.** `groundWorldY` answers 0 there, so a hull at a
 *   raised map edge tipped its nose down over the edge. Every one of
 *   `deir_amun`'s 86 is this case.
 *
 * Both now take the hull CENTRE's own ground height instead: the corner
 * contributes no slope, and the hull conforms to the open ground its other
 * corners are actually on. Every other corner keeps `groundWorldY`, which
 * for an in-map tile the surface does not draw as a terrace IS the smooth
 * Catmull-Rom surface every unit stands on (`surfaceLevel` falls through to
 * `smoothLevel`, the same function `terrain/ground.ts` builds the open
 * ground's vertices from) -- so after the substitution all four samples are
 * points on the ground the player sees under the vehicle.
 *
 * On a map with no relief every sample is 0 and so is the centre, so the
 * substitution changes no number there: flat ground still conforms to
 * EXACTLY zero, which is what keeps the three flat gated scenarios still.
 *
 * No `three` import and no `Sim` import -- plain numbers and typed arrays in,
 * numbers out, like the rest of the weight model -- which is also what lets
 * the census in `tools/` run this exact function against `parseMap`'s real
 * maps. Allocation-free: the caller owns the corner scratch and the output.
 */
import { groundWorldY, type ElevationSource } from '../ground-height';
import { hullCornerOffsets, terrainPitchRad, terrainRollRad, type HullCorners } from './vehicle-weight';

/** What one hull's footprint is conformed against. The renderer keeps ONE
 *  of these and refills it per vehicle. */
export interface HullConformInput {
  /** The drawn surface -- `ThreeRenderer.retained.elevation`. */
  elevation: ElevationSource;
  /** The sim's own `blocked` mask, `width * height`, row-major. */
  blocked: Uint8Array;
  mapWidth: number;
  mapHeight: number;
  /** The hull's drawn centre, tiles. */
  centreX: number;
  centreY: number;
  /** `groundWorldY` at the centre -- what a corner with no open ground
   *  under it stands on. */
  centreGroundY: number;
  /** The hull's facing, 0..1 turns. */
  facingNorm: number;
  /** The measured footprint, tiles: `vehicleMeshBounds`' `x` (along the
   *  hull) and `z` (across it). */
  lengthTiles: number;
  widthTiles: number;
}

/** The conform's answer, written in place. */
export interface HullConform {
  /** Positive nose-up. */
  pitchRad: number;
  /** Positive lowers the corner `hullCornerOffsets` names `right`. */
  rollRad: number;
}

/**
 * The world-Y ground height under one footprint corner at `(x, y)`: the drawn
 * surface there, unless the point lies off the map or over a blocked tile,
 * in which case `centreGroundY`. See this module's header.
 */
export function hullCornerGroundY(
  elevation: ElevationSource,
  blocked: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
  centreGroundY: number
): number {
  // `!(... && ...)` rather than the negated comparisons, so a NaN corner is
  // treated as off the map rather than indexing `blocked[NaN]`.
  if (!(x >= 0 && x < mapWidth && y >= 0 && y < mapHeight)) return centreGroundY;
  if (blocked[Math.floor(y) * mapWidth + Math.floor(x)] !== 0) return centreGroundY;
  return groundWorldY(elevation, mapWidth, mapHeight, x, y);
}

/**
 * Pitch and roll of a hull standing at `input`'s centre and facing, from the
 * ground under its four footprint corners. `corners` is scratch the caller
 * owns; `out` is written and returned. Nothing is allocated.
 */
export function conformHull(input: HullConformInput, corners: HullCorners, out: HullConform): HullConform {
  const { elevation, blocked, mapWidth: w, mapHeight: h, centreX: cx, centreY: cy, centreGroundY: c0 } = input;
  const c = hullCornerOffsets(input.facingNorm, input.lengthTiles / 2, input.widthTiles / 2, corners);
  const front = hullCornerGroundY(elevation, blocked, w, h, cx + c.frontX, cy + c.frontY, c0);
  const rear = hullCornerGroundY(elevation, blocked, w, h, cx + c.rearX, cy + c.rearY, c0);
  const left = hullCornerGroundY(elevation, blocked, w, h, cx + c.leftX, cy + c.leftY, c0);
  const right = hullCornerGroundY(elevation, blocked, w, h, cx + c.rightX, cy + c.rightY, c0);
  out.pitchRad = terrainPitchRad(front, rear, input.lengthTiles);
  out.rollRad = terrainRollRad(left, right, input.widthTiles);
  return out;
}
