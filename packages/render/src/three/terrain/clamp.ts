/**
 * The "reposition first, shrink only as a fallback" tile-containment clamp,
 * shared by every terrain builder that has to keep a shape's centre inside
 * its own tile: `scatter.ts`'s `pushMark` (one mark), and `grove.ts`'s
 * trunk shadow and tree placement (one mark, and a whole tree's worth of
 * quads sharing a single anchor, respectively). All three computed the exact
 * same thing from a slightly different call site until this file existed —
 * three copies of one algorithm, differing only in what corners they happen
 * to gather first. There is no genuine difference between the three uses:
 * each hands this function a raw centre offset and the list of corner
 * deltas whose reach has to fit, and gets back a clamped centre plus a
 * uniform `scale` (see below for why scale must stay uniform across every
 * corner of one shape).
 *
 * The centre is clamped not to `limit` itself but to `limit - <the caller's
 * own half-extent>`, which is exactly enough room for the caller's full,
 * unscaled shape to still fit once the centre lands at that tighter bound.
 * Reposition (not shrink) is deliberately the primary move: for every real
 * caller in this codebase the half-extent leaves enough headroom under
 * `CLAMP_LIMIT` that `scale` comes out at exactly 1 -- shrinking only
 * matters for a shape whose own half-extent exceeds `limit` outright, which
 * nothing here does, but the maths stays correct if one ever does.
 *
 * Scaling uniformly -- one `scale` factor applied to every corner, rather
 * than clamping each corner independently -- matters beyond cosmetics: an
 * earlier version of `scatter.ts`'s own clamp did the latter, and a mark
 * whose centre sat right at the boundary while its corners straddled it left
 * some corners clamped and others not, producing a near-degenerate quad.
 * Float32 rounding on that near-collinear triangle flipped its winding sign
 * under that module's own winding test. A uniform scale is an
 * orientation-preserving similarity transform -- it can only shrink a shape
 * toward its own (already-clamped) centre, cleanly to a single point in the
 * extreme case -- so winding can never flip.
 */

/** Half the unit tile, minus a small margin -- the shared `limit` every
 *  caller passes to `clampCenterToTile`. */
export const CLAMP_MARGIN = 0.02;
export const CLAMP_LIMIT = 0.5 - CLAMP_MARGIN;

export interface ClampedCenter {
  centerX: number;
  centerZ: number;
  scale: number;
}

/**
 * `rawCenterX`/`rawCenterZ`: the shape's unclamped centre offset, in the
 * same ground units its corners are already in (typically the output of
 * `screenOffsetToWorld`). `cornerDeltas`: every corner's own offset from
 * that centre, in the same units -- only their magnitude matters here, not
 * their order or which quad they belong to, which is what makes gathering
 * corners from more than one quad (as `grove.ts`'s `pushTree` does, so a
 * whole tree clamps and scales as one coherent shape) a correct use of the
 * same function rather than a special case of it.
 */
export function clampCenterToTile(
  rawCenterX: number,
  rawCenterZ: number,
  cornerDeltas: readonly { dx: number; dy: number }[],
  limit: number
): ClampedCenter {
  let maxAbsDX = 0;
  let maxAbsDZ = 0;
  for (const d of cornerDeltas) {
    maxAbsDX = Math.max(maxAbsDX, Math.abs(d.dx));
    maxAbsDZ = Math.max(maxAbsDZ, Math.abs(d.dy));
  }
  const limitX = Math.max(0, limit - maxAbsDX);
  const limitZ = Math.max(0, limit - maxAbsDZ);
  const centerX = Math.max(-limitX, Math.min(limitX, rawCenterX));
  const centerZ = Math.max(-limitZ, Math.min(limitZ, rawCenterZ));
  const roomX = limit - Math.abs(centerX);
  const roomZ = limit - Math.abs(centerZ);
  let scale = 1;
  if (maxAbsDX > 0) scale = Math.min(scale, roomX / maxAbsDX);
  if (maxAbsDZ > 0) scale = Math.min(scale, roomZ / maxAbsDZ);
  return { centerX, centerZ, scale };
}
