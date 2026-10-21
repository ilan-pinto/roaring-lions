/**
 * Crown summits: a tell's small `^` crown draws as a raised, smooth ROCK
 * summit instead of a flat terraced pad. Presentation only -- the sim's
 * elevation, `blocked` mask and sight are untouched. The lift lives in a
 * renderer-side copy of the levels, and the crown tiles leave the DRAW mask
 * only, so the ground builds them as a Catmull-Rom dome rather than a terrace.
 * That they still read as rock is `tileSurface`'s, `groundTone`'s and
 * `buildScatter`'s symbol keying (#635).
 *
 * **Why lift exactly 2.** The sim treats every `^` tile as `BLOCK_RISE` = 2
 * levels above its own ground for sight (`sim.ts`'s `losRay`). Mirrored over
 * every crown-crossing ray within 12 tiles on Milh Flats (3,930 rays) and Tel
 * Marum (5,876), and cross-checked ray for ray against the real `losRay`:
 * today's flat pad looks open on 73.9 % / 80.7 % of rays the sim blocks; a
 * lift of 1 on 1.6 % / 6.2 %; a lift of 2 on 0 / 0; a lift of 3 makes 10.6 %
 * of Tel Marum's rays look hidden while the sim sees straight through them.
 * At 2, at tile resolution, what the player sees is what blocks sight.
 * (`_coord/crown-summit/proposal.md`; `packages/app/src/crown-summit.test.ts`
 * pins the lift to `BLOCK_RISE`.)
 *
 * **What counts as a crown: a SUMMIT, not just a small cluster.** A
 * 4-connected `^` cluster of at most `CROWN_MAX_TILES` tiles whose every
 * 8-neighbour is open ground (blocked 0 in the sim) at or below the cluster's
 * LOWEST level. Size alone is not enough: of the 61 shipped clusters of 12
 * tiles or fewer, 41 are broken ridge segments (`qarn_hadid_3`), bits of
 * escarpment (`umm_zeitoun` 1-3), lone rocks in a wadi bed (`wadi_tarfan`)
 * or fortified hilltops -- a crown beside a shanty, a pump house or a
 * compound wall, whose building would sit at the dome's foot. Every one
 * touches another blocked tile or sits below a neighbour. The 20 that pass
 * are the bare crowns (`packages/app/src/crown-summit.test.ts`, against an
 * independent count).
 */
import { DECOR_RIDGE } from './shared';

/** Levels a crown's DRAWN height is raised by: the sim's `BLOCK_RISE`. */
export const CROWN_LIFT_LEVELS = 2;
/** A `^` cluster this small or smaller may be a crown; a longer run is a
 *  ridge WALL (Tel Marum, Qarn Hadid) and stays a cliff. */
export const CROWN_MAX_TILES = 12;

/**
 * 1 on every tile of every crown, 0 elsewhere. `blocked` is the SIM's mask
 * (a crown must touch no other blocked tile) and `levels` the RAW elevation
 * grid, `null` for a flat map.
 */
export function crownMask(
  decor: Uint8Array,
  blocked: Uint8Array,
  levels: Uint8Array | null,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(decor.length);
  const seen = new Uint8Array(decor.length);
  const level = (t: number): number => (levels ? (levels[t] as number) : 0);
  const stack: number[] = [];
  const cluster: number[] = [];
  for (let i = 0; i < decor.length; i++) {
    if (decor[i] !== DECOR_RIDGE || seen[i]) continue;
    stack.length = 0;
    cluster.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length > 0) {
      const j = stack.pop() as number;
      cluster.push(j);
      const x = j % width;
      const y = (j - x) / width;
      if (x > 0) visit(j - 1);
      if (x < width - 1) visit(j + 1);
      if (y > 0) visit(j - width);
      if (y < height - 1) visit(j + width);
    }
    if (cluster.length <= CROWN_MAX_TILES && isSummit(cluster)) for (const j of cluster) mask[j] = 1;
  }
  return mask;

  function visit(k: number): void {
    if (decor[k] === DECOR_RIDGE && !seen[k]) {
      seen[k] = 1;
      stack.push(k);
    }
  }

  function isSummit(tiles: readonly number[]): boolean {
    let top = Infinity;
    for (const t of tiles) top = Math.min(top, level(t));
    for (const t of tiles) {
      const x = t % width;
      const y = (t - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (decor[n] === DECOR_RIDGE && tiles.includes(n)) continue;
          if (blocked[n] !== 0) return false; // another ridge, a building, a hall
          if (level(n) > top) return false; // something around it stands higher
        }
      }
    }
    return true;
  }
}

/** Copy of `levels` (all 0 when `null`) with every crown tile raised by `lift`, clamped to 9. */
export function liftCrowns(levels: Uint8Array | null, crown: Uint8Array, lift: number = CROWN_LIFT_LEVELS): Uint8Array {
  const out = levels ? new Uint8Array(levels) : new Uint8Array(crown.length);
  for (let i = 0; i < out.length; i++) if (crown[i]) out[i] = Math.min(9, (out[i] as number) + lift);
  return out;
}

/** The mask the DRAWN surface terraces on, crown tiles cleared so a crown
 *  draws as a smooth summit. A copy: the sim's own mask is never written. */
export function unterraceCrowns(blocked: Uint8Array, crown: Uint8Array): Uint8Array {
  const out = new Uint8Array(blocked);
  for (let i = 0; i < out.length; i++) if (crown[i]) out[i] = 0;
  return out;
}

/** True when the mask marks no tile at all -- the renderer then leaves every
 *  input exactly as it was, so a map with no crown is untouched. */
export function crownIsEmpty(crown: Uint8Array): boolean {
  for (let i = 0; i < crown.length; i++) if (crown[i]) return false;
  return true;
}
