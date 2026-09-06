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
