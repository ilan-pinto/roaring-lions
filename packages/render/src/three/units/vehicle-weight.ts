/**
 * The terrain conform: a hull's pitch and roll from the ground under its own
 * footprint, recomputed from nothing every frame. This half of WP-A1.3 has
 * NO STATE AT ALL -- Task 3's dynamic weight (smoothed speed, positional lag,
 * the settle spring) is deliberately a separate concern layered on top, not
 * folded in here, because conflating the two is how a purely geometric
 * answer acquires a filter it does not need and stops agreeing with the
 * ground the player can actually see under the hull.
 *
 * No `three` import, no `Sim` import, no `@lions/data` import -- every
 * function here takes plain numbers and returns plain numbers, the same
 * "pure decision math here, dispatch in `ThreeRenderer`" split
 * `units/vehicle-fx.ts` already uses for the ambient dust/exhaust effects.
 * That makes this module testable with no `WebGLRenderer` and presentation
 * -only by construction: there is no sim state in reach to mutate, so
 * invariant 4 holds trivially.
 *
 * Two properties a later reader will otherwise get wrong:
 *
 * **Positive pitch is nose-up and positive roll drops the right side.**
 * Chosen to match `MESH_HULL_PITCH_RAD`'s own recoil sign
 * (`ThreeRenderer.ts:440`, applied at `ThreeRenderer.ts:5342-5348` as
 * `entity.root.rotation.x`, XYZ Euler order, local pitch before yaw) -- the
 * recoil rocks a tank back onto its rear road wheels, which that constant
 * treats as positive. Ground rising ahead of the hull tilts it the same
 * direction a recoiling gun does, so it reads positive here too. Roll's
 * sign is otherwise a coin flip that looks fine on a screenshot of a
 * symmetric hull, which is exactly why it is stated rather than left to be
 * inferred: ground falling away to the right (the right corner sampling
 * LOWER than the left) reads positive, i.e. the right side drops.
 *
 * **The span is a parameter, not a constant, because a longer hull tilts
 * less on the same step in the ground** -- the angle is `atan(delta / span)`,
 * so doubling the span roughly halves the angle for a small delta. That is
 * why the half-extents this module's caller measures come from
 * `vehicleMeshBounds` (`ThreeRenderer.ts:4088`, backed by
 * `vehicleShroudBounds`, `mesh-vehicle.ts:477`) rather than one constant
 * shared by every vehicle: the shroud bounds are already the live body's
 * measured size in tile units, excluding `death_root`, with the template
 * root carrying only `MESH_SCALE` and no rotation -- so `bounds.x` is length
 * along the hull's forward axis and `bounds.z` is its width, and there is no
 * per-vehicle footprint table to author or let go stale on a re-export.
 *
 * **Zero on flat ground is the load-bearing property, not an edge case.**
 * `beit_sahwan_outskirts` and `tutorial_ground` declare no `elevation` grid
 * at all, so three of the four gated golden scenarios sample four equal
 * ground heights and both `terrainPitchRad` and `terrainRollRad` must
 * return EXACTLY `0` there -- not a value close to zero -- or the `vehicle`
 * baseline moves for every parked vehicle on those maps. `atan2(0, x)` for
 * `x > 0` already returns exact `0` in IEEE 754, so this falls out of the
 * formula rather than needing a special case, but it is the single fact
 * this module exists to protect (R-G).
 */

/**
 * The four corners of a hull's own footprint, as tile-unit offsets from its
 * centre, at the current facing. Recomputed from scratch on every call --
 * this module carries no history, exactly like the single `groundWorldY`
 * sample it joins (`ThreeRenderer.ts:5321`), which samples the SAME centre
 * position every frame with no memory of the last one either.
 */
export interface HullCorners {
  frontX: number;
  frontY: number;
  rearX: number;
  rearY: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

/**
 * `facingNorm` is a sim `facing` in 0..1 turns, the same unit
 * `meshYawFromFacing` (`mesh-anim.ts`) takes, but this function does NOT
 * reuse that one's `-2*PI*facing` mesh-yaw convention -- it works in GAME
 * space, not mesh-local space, because `frontGroundY`/`rearGroundY` etc. are
 * sampled at world positions this module's caller derives from game
 * coordinates (`EntityFrame`'s own convention: game x -> world X, game y ->
 * world Z), and the hull's rest pose facing local +X only matters once
 * `meshYawFromFacing` places the mesh into the scene -- a step downstream of
 * this module entirely. Facing `0` therefore turns is world/game `+X`
 * directly here, matching `vehicle-fx.ts`'s own `vehicleFxAnchor`
 * (`facingRad = facingNorm * Math.PI * 2`, forward at `(cos, sin)`), so
 * "front" at facing `0` is `+X` and the flanks sit on `+/-Y` --
 * `hullCornerOffsets(0, ...)`'s own test pins exactly that.
 *
 * `halfLengthTiles`/`halfWidthTiles` are HALF the measured hull size along
 * its forward and flank axes respectively (half of `vehicleMeshBounds.x` and
 * `.z` -- see this module's header), so the four corners this returns sit at
 * the hull's own edge, not its centre or its full extent.
 *
 * The flank axis (`left`/`right`) is the forward axis rotated a quarter turn
 * -- `(leftX, leftY) = (-sin(theta), cos(theta)) * halfWidthTiles` -- which
 * keeps `front . left == 0` at every heading by construction (a rotated pair
 * of perpendicular unit vectors stays perpendicular), not merely at the two
 * axis-aligned headings a less thorough test would check.
 */
export function hullCornerOffsets(
  facingNorm: number,
  halfLengthTiles: number,
  halfWidthTiles: number
): HullCorners {
  const facingRad = facingNorm * Math.PI * 2;
  const cos = Math.cos(facingRad);
  const sin = Math.sin(facingRad);
  const frontX = cos * halfLengthTiles;
  const frontY = sin * halfLengthTiles;
  const leftX = -sin * halfWidthTiles;
  const leftY = cos * halfWidthTiles;
  return {
    frontX,
    frontY,
    rearX: -frontX,
    rearY: -frontY,
    leftX,
    leftY,
    rightX: -leftX,
    rightY: -leftY,
  };
}

/**
 * Pitch from the ground height under the front and rear corners
 * (`hullCornerOffsets`' `frontX/frontY` and `rearX/rearY`, each fed through
 * the caller's own `groundWorldY` sample), positive nose-up -- see this
 * module's header for why that sign matches `MESH_HULL_PITCH_RAD`'s recoil.
 *
 * `lengthWorld` is the full fore-aft span the two samples are taken across
 * (front-to-rear, i.e. `2 * halfLengthTiles`, in the same world/tile units
 * as the two ground heights) -- a parameter rather than a constant because a
 * longer hull tilts LESS on the same step in the ground, which is the
 * physical answer: `atan(delta / span)` shrinks as `span` grows for a fixed
 * `delta`.
 *
 * `atan2(frontGroundY - rearGroundY, lengthWorld)` rather than a plain
 * `Math.atan` of the ratio: `lengthWorld` is always strictly positive (it is
 * twice a measured half-extent), so this is equivalent to `atan` of the
 * ratio here, but stays inside `(-PI/2, PI/2)` by construction with no
 * separate clamp needed, and returns EXACTLY `0` when the two samples agree
 * (`atan2(0, x)` for `x > 0` is exact IEEE-754 `+0`) -- the one property
 * `beit_sahwan_outskirts` and `tutorial_ground`'s flat elevation grids
 * depend on (R-G).
 */
export function terrainPitchRad(frontGroundY: number, rearGroundY: number, lengthWorld: number): number {
  return Math.atan2(frontGroundY - rearGroundY, lengthWorld);
}

/**
 * Roll from the ground height under the left and right corners
 * (`hullCornerOffsets`' `leftX/leftY` and `rightX/rightY`), positive when
 * the ground falls away to the RIGHT (the right corner samples lower than
 * the left) -- see this module's header for why that sign is stated rather
 * than left as a coin flip.
 *
 * `widthWorld` is the full beam the two samples are taken across
 * (left-to-right, `2 * halfWidthTiles`), for the identical "a wider hull
 * tilts less" reason `terrainPitchRad`'s `lengthWorld` exists, and the same
 * `atan2` shape gives the same exact-zero-on-flat-ground guarantee.
 */
export function terrainRollRad(leftGroundY: number, rightGroundY: number, widthWorld: number): number {
  return Math.atan2(leftGroundY - rightGroundY, widthWorld);
}
