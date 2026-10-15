/**
 * The yaw a per-tile structure instance takes so a RUN reads along its
 * neighbours. `mesh-building.ts` draws every building unrotated -- right for
 * a house, and harmless for `wall`, which is square in plan -- but the fence
 * (2026-09-06) is the first per-tile type with a long axis: its segment spans
 * one tile along map x, and drawn unrotated along a map-y run it showed as a
 * row of panels edge-on with gaps between them. A tile with same-type
 * neighbours only north and/or south turns a quarter; anything else -- an
 * east-west run, a corner, an isolated post -- keeps the authored facing.
 * Corners keep x deliberately: the segment then reads as the run it closes
 * on the x side, and the y side's first tile turns to meet it.
 *
 * Pure so it can be tested without a scene: `sameTypeAt(dx, dy)` answers
 * whether the tile offset by (dx, dy) holds a structure of the same type.
 */
export function perTileRunYaw(sameTypeAt: (dx: number, dy: number) => boolean): number {
  const ew = sameTypeAt(-1, 0) || sameTypeAt(1, 0);
  const ns = sameTypeAt(0, -1) || sameTypeAt(0, 1);
  return ns && !ew ? Math.PI / 2 : 0;
}

/**
 * Which per-tile structure types follow their run (`perTileRunYaw`) and which
 * keep their AUTHORED facing whatever their neighbours. Exhaustive over every
 * `per_tile: true` type in `data/structures.json` -- `run-direction.test.ts`
 * reads that file and fails on a per-tile type with no entry, so a new one
 * must choose here rather than inherit a turn by default.
 *
 * `sandbag_post` (SW-5) is the one `authored` type: a one-tile horseshoe with
 * no long axis, whose closed front and firing aperture are turned toward the
 * camera corner at export (`tools/buildings/export_barriers.py`,
 * `build_sandbag_post`). Turned a quarter beside a north-south neighbour, two
 * stacked posts pointed their slots away from the camera.
 */
export const PER_TILE_FACING: Readonly<Record<string, 'run' | 'authored'>> = {
  wall: 'run',
  fence: 'run',
  hesco: 'run',
  t_wall: 'run',
  sandbag_wall: 'run',
  sandbag_post: 'authored',
};

/** The yaw for one per-tile instance of `typeId`: its run's yaw, or 0 for a
 *  type that keeps its authored facing. A type missing from
 *  `PER_TILE_FACING` follows its run, the behaviour before the table. */
export function perTileYawFor(typeId: string, sameTypeAt: (dx: number, dy: number) => boolean): number {
  return PER_TILE_FACING[typeId] === 'authored' ? 0 : perTileRunYaw(sameTypeAt);
}
