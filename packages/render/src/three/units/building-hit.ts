/**
 * GH-1197 P3: a direct-fire explosive round hitting a building -- where on the
 * building it hit, which way the ejecta leave, and what colour the masonry is.
 *
 * The hit FACE lies on the line from the footprint toward the shooter (the
 * design §3), never at the centroid: the point is the footprint's nearest point
 * to the shooter, and the face normal is the side of the footprint that point
 * lies on (a corner takes the diagonal). Chunks leave along that normal +-35
 * degrees, back toward the shooter: a hit on the near face throws its crater
 * ejecta back out (the coordinator's ruling Q3; the "60/40 away" bias belongs
 * to the P5 collapse, where walls fail away from the blast).
 *
 * The masonry is the building type's own `structures.json` colour key and the
 * two darker keys on its ramp (ramps descend in brightness), with a quarter of
 * the pieces charred `gunmetal.2` (the design's "debris art").
 *
 * Pure: no three, no sim state. Presentation only.
 */
import { rampStep, DEBRIS_CHARRED_KEY } from './debris-tone';

/** The cone the hit-face ejecta leave in, either side of the face normal (the design: +-35 degrees). */
export const HIT_EJECTA_SPREAD_RAD = (35 * Math.PI) / 180;
/** The hit's height on the wall, as a fraction of the building's height (the design's 0.3-0.8 for a wall hit). */
export const HIT_HEIGHT_FRACTION: readonly [number, number] = [0.3, 0.8];
/** How far outside the wall a piece starts, tiles, so it never leaves from inside the mesh. */
export const HIT_STANDOFF_TILES = 0.05;
/** At most one hit-face burst per building in this many ticks (an autocannon lands ten rounds a second). */
export const HIT_BURST_MIN_TICKS = 4;

/** Where a round from (sx, sy) hits a footprint `[minX, maxX + 1) x [minY, maxY + 1)`, tiles, and the face's
 *  outward normal (unit). A shooter inside the footprint hits nothing in particular: the normal points from the
 *  centre toward it, or +x when it stands on the centre. */
export function hitFace(
  minX: number, minY: number, maxX: number, maxY: number, sx: number, sy: number
): { x: number; y: number; nx: number; ny: number } {
  const x0 = minX;
  const x1 = maxX + 1;
  const y0 = minY;
  const y1 = maxY + 1;
  const x = Math.min(Math.max(sx, x0), x1);
  const y = Math.min(Math.max(sy, y0), y1);
  let nx = sx < x0 ? -1 : sx > x1 ? 1 : 0;
  let ny = sy < y0 ? -1 : sy > y1 ? 1 : 0;
  if (nx === 0 && ny === 0) {
    const dx = sx - (x0 + x1) / 2;
    const dy = sy - (y0 + y1) / 2;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { x: x1, y: (y0 + y1) / 2, nx: 1, ny: 0 };
    nx = dx / len;
    ny = dy / len;
  } else {
    const len = Math.hypot(nx, ny);
    nx /= len;
    ny /= len;
  }
  return { x, y, nx, ny };
}

/** The masonry palette of a building whose type colour is `colorKey`: the key and its two darker ramp steps,
 *  and the charred key. Piece `k` takes `masonryKeyFor(keys, k)`. */
export interface MasonryKeys {
  readonly ramp: readonly [string, string, string];
  readonly charred: string;
}

export function masonryKeysFor(colorKey: string): MasonryKeys {
  return { ramp: [colorKey, rampStep(colorKey, 1), rampStep(colorKey, 2)], charred: DEBRIS_CHARRED_KEY };
}

/** Piece `k`'s key: every fourth charred, the rest cycling the ramp. */
export function masonryKeyFor(keys: MasonryKeys, k: number): string {
  return k % 4 === 3 ? keys.charred : keys.ramp[k % 3];
}

/** The masonry dust a hit throws at the face (`data/vfx/building_hit_dust.json`), spawned by name. */
export const BUILDING_HIT_DUST_EMITTER_ID = 'building_hit_dust';
