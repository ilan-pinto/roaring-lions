/**
 * Which building a screen point is ON, as the player sees it (WP-P4, PA-14).
 *
 * `screenToWorldThree` answers "where does this pixel's ray meet the
 * GROUND", and for every pixel that shows a building's upper wall that is the
 * wrong question: the ray passes through the wall and lands on the ground
 * BEHIND it, which the building hides. Measured before this existed
 * (polish audit play-40, tutorial beat 7): a right-click on a house's upper
 * facade read `move`, and the squad set off for ground the player could not
 * see. Garrison registered only on the lower footprint.
 *
 * This casts the same camera ray against each standing structure's drawn
 * volume -- a box over its footprint, as tall as what is drawn there -- and
 * reports the nearest one the ray ENTERS before it reaches the ground. A
 * building behind the ground point (the ray meets the ground first) is not
 * hit, so this can only ever replace a ground point the building covers.
 *
 * Boxes, not triangles: a roof's pitch leaves a sliver of sky inside the box
 * corners, and a click there resolves to the building rather than to the
 * ground behind the roof. Both are a guess about a pixel the player can
 * barely see; the building is the one whose outline they were aiming at.
 * The box is the DRAWN size, not the footprint, because the drawn wall is
 * what the player clicks (see `structureBoxes`).
 *
 * No `ThreeRenderer` here, so it runs in `environment: 'node'` against the
 * real dimetric camera (`camera.ts`), which is how its test drives it.
 */
import * as THREE from 'three';
import type { Sim } from '@lions/sim';
import { WORLD_Y_PER_LIFT_PIXEL, type Camera, type Viewport } from '../project';
import { dimetricCamera } from './camera';
import { groundWorldY, type ElevationSource } from './ground-height';
import { footprintCentre } from './units/footprint';

/** One structure's drawn volume, in world units: x is the tile x axis, z the
 *  tile y axis, y up. `minX`/`maxX` and `minZ`/`maxZ` are the box's own
 *  faces (a footprint covering tiles 3..4 spans 3 to 5). */
export interface StructureBox {
  /** The structure index this box stands for. */
  readonly structure: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Ground under the structure. */
  readonly baseY: number;
  /** Top of what is drawn: the measured mesh height, or the extruded wall. */
  readonly topY: number;
}

/** How big a structure is DRAWN, in world units (a tile is 1). */
export interface DrawnSize {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/**
 * One box per STANDING structure of `sim`, centred on its footprint and
 * standing on the ground at that centre -- the point `ThreeRenderer` stands a
 * building mesh on -- and `drawn(s)` big. A structure drawn zero-high has no
 * wall to click and gets no box.
 *
 * The default `drawn` is what the terrain builder extrudes for a structure
 * with no mesh: the footprint, `heightPx` through `WORLD_Y_PER_LIFT_PIXEL`
 * tall. `ThreeRenderer` passes the standing mesh's measured size where a mesh
 * stands, and that matters: a shipped house mesh is 4.26 x 4.24 x 3.71 world
 * units on a 2 x 2 footprint (`units/collapse-shroud.ts`'s table), so the
 * wall the player clicks can stand a tile outside the footprint, and ten
 * times taller than the 16 lift-px the extrusion would say.
 */
export function structureBoxes(
  sim: Sim,
  elevation: ElevationSource = null,
  drawn: (s: number) => DrawnSize = (s) => ({
    width: sim.structures.maxX[s] - sim.structures.minX[s] + 1,
    height: sim.structureTypes[sim.structures.typeIdx[s]].heightPx * WORLD_Y_PER_LIFT_PIXEL,
    depth: sim.structures.maxY[s] - sim.structures.minY[s] + 1,
  })
): StructureBox[] {
  const st = sim.structures;
  const boxes: StructureBox[] = [];
  for (let s = 0; s < sim.structureCount; s++) {
    if (st.alive[s] !== 1) continue;
    const size = drawn(s);
    if (!(size.height > 0)) continue;
    const { fx: cx, fy: cy } = footprintCentre(sim, s);
    const baseY = groundWorldY(elevation, sim.width, sim.height, cx, cy);
    boxes.push({
      structure: s,
      minX: cx - size.width / 2,
      maxX: cx + size.width / 2,
      minZ: cy - size.depth / 2,
      maxZ: cy + size.depth / 2,
      baseY,
      topY: baseY + size.height,
    });
  }
  return boxes;
}

/**
 * The structure whose box the ray enters first, provided it enters before
 * `groundT` (the distance along the ray at which it meets the ground), or -1.
 * `dir` need not be normalised; distances are in its units.
 *
 * Slab test, written out rather than through `THREE.Ray.intersectBox` so the
 * entry distance is the one this compares, with no Box3 allocation per
 * structure per frame (the hover reads this every frame).
 */
export function firstStructureOnRay(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  boxes: readonly StructureBox[],
  groundT: number
): number {
  let best = -1;
  let bestT = groundT;
  for (const b of boxes) {
    const t = slabEntry(origin, dir, b);
    if (t !== null && t < bestT) {
      bestT = t;
      best = b.structure;
    }
  }
  return best;
}

/** Entry distance into `b`, or null when the ray misses it. */
function slabEntry(
  o: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  b: StructureBox
): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, b.baseY, b.topY],
    [o.z, d.z, b.minZ, b.maxZ],
  ];
  for (const [p, v, lo, hi] of axes) {
    if (v === 0) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let t0 = (lo - p) / v;
    let t1 = (hi - p) / v;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return tMin;
}

/**
 * The structure a screen pixel shows, or -1 -- see this file's top comment.
 *
 * The ground distance is found the way `screenToWorldThree` finds the ground
 * point: the flat plane first, then the plane at that point's own ground
 * height. So "in front of the ground" here means in front of the very point
 * `screenToWorld` would have returned for the same pixel.
 */
export function structureAtScreenThree(
  px: number,
  py: number,
  cam: Camera,
  vp: Viewport,
  boxes: readonly StructureBox[],
  elevation: ElevationSource = null,
  mapWidth = 0,
  mapHeight = 0
): number {
  if (boxes.length === 0) return -1;
  const camera = dimetricCamera(cam, vp);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2((px / vp.width) * 2 - 1, 1 - (py / vp.height) * 2), camera);
  const ray = raycaster.ray;
  if (ray.direction.y >= 0) return -1;
  const flatT = (0 - ray.origin.y) / ray.direction.y;
  const fx = ray.origin.x + ray.direction.x * flatT;
  const fz = ray.origin.z + ray.direction.z * flatT;
  const liftY = groundWorldY(elevation, mapWidth, mapHeight, fx, fz);
  const groundT = (liftY - ray.origin.y) / ray.direction.y;
  return firstStructureOnRay(ray.origin, ray.direction, boxes, groundT);
}
