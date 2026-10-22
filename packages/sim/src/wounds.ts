// GH-707 (wounded and rescue): pure helpers with no Sim state. Integer and Q16.16 only
// (invariant 2): no Math.*, no float literals.

import type { Fx } from './fixed';
import { WOUND_CRAWL_SCAN } from './tuning';

/**
 * Men of a `figures`-strong team still standing at `hp` of `typeHp`: one man per
 * `typeHp / figures` share, rounded UP, so a team loses a man only when its hp crosses a
 * share boundary -- `ceil(hp x figures / typeHp)`, clamped to `[0, figures]`.
 *
 * Integer arithmetic on the raw Q16.16 words: the scale cancels, and `hp x figures` stays
 * far inside a double's exact range (2^31 x 8 < 2^53), so the division is exact.
 */
export function figuresStanding(hp: Fx, typeHp: Fx, figures: number): number {
  if (hp <= 0 || typeHp <= 0) return 0;
  const n = hp * figures;
  const r = n % typeHp;
  let q = (n - r) / typeHp;
  if (r > 0) q++;
  return q > figures ? figures : q;
}

/** `a x num / den` truncated, for non-negative integers (the regen ceiling's share). */
export function scaleDown(a: number, num: number, den: number): number {
  const n = a * num;
  return (n - (n % den)) / den;
}

/**
 * Where a DOWN wounded crawls (GH-707 Task 3): the tile in the
 * `(2 x WOUND_CRAWL_SCAN + 1)`-square window around `(tx, ty)` with the HIGHEST `cover`,
 * strictly better than the tile he lies on -- so the start tile is returned when nothing
 * beats it. Ties go to the lowest tile index (the scan runs in index order and only a
 * strictly higher cover replaces the best). A blocked tile, or one off the map, is never a
 * candidate; a candidate two tiles out is refused when the tile between it and the start --
 * the integer midpoint, each offset halved toward zero -- is blocked: he does not crawl
 * through a wall. Pure: integers only, no Sim state.
 */
export function bestCoverTile(
  cover: Uint8Array,
  blocked: Uint8Array,
  width: number,
  height: number,
  tx: number,
  ty: number,
): number {
  const start = ty * width + tx;
  let best = start;
  let bestCover = cover[start];
  for (let dy = -WOUND_CRAWL_SCAN; dy <= WOUND_CRAWL_SCAN; dy++) {
    const y = ty + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -WOUND_CRAWL_SCAN; dx <= WOUND_CRAWL_SCAN; dx++) {
      const x = tx + dx;
      if (x < 0 || x >= width) continue;
      const t = y * width + x;
      if (t === start || blocked[t] !== 0 || cover[t] <= bestCover) continue;
      if (dx <= -2 || dx >= 2 || dy <= -2 || dy >= 2) {
        const mx = tx + (dx - (dx % 2)) / 2;
        const my = ty + (dy - (dy % 2)) / 2;
        if (blocked[my * width + mx] !== 0) continue;
      }
      best = t;
      bestCover = cover[t];
    }
  }
  return best;
}
