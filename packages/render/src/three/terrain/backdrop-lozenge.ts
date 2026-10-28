/**
 * The check that the backdrop never covers the playable lozenge (GH-161,
 * `backdrop.ts` rule 1), run on the PLACED vertices: what a map's piece list
 * and the floor actually produce, not what the pieces were authored to.
 *
 * Pure and three-free. It is a geometric statement, so it holds at every zoom
 * (the camera is orthographic: zoom only changes how much of the world a frame
 * shows, never which points hide which); `backdrop_lozenge.test.ts` says so for
 * zoom 0.35, 1 and 2.5 and shows it red on a piece pushed 2 tiles inward.
 *
 * Two ways a point can hide map ground:
 *
 *  1. **It stands inside the playable rectangle, above the ground.** The kit's
 *     pieces overlap the map by a tile or two so no gap shows at the rim; that
 *     overlap must lie under the ground. `inside`.
 *  2. **It stands beyond a NEAR edge (x > w or z > h), on the camera's side of
 *     the map.** The ray from it away from the camera, along (-1, -tan30 * sqrt2,
 *     -1), enters the rectangle at `E = (x - t0, z - t0)` with `t0 = max(x - w,
 *     z - h)`, `0.8165 * t0` lower. If it is still above the ground at `E` it
 *     hides map ground. `hard` is that exact limit; `design` is the 55% line the
 *     near slopes are authored under (`NEAR_CAP_SLOPE`), with a tolerance for
 *     the floor's own slope. Points beyond a FAR edge cannot be between the
 *     camera and the map and are not constrained.
 */
import { NEAR_CAP_SLOPE, NEAR_HARD_SLOPE, type RimHeight } from './backdrop';
import type { PlacedKit } from './backdrop-kit';

export type IntrusionKind = 'inside' | 'hard' | 'design';

export interface Intrusion {
  readonly kind: IntrusionKind;
  readonly what: 'kit' | 'olive' | 'house';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How far over the line, in tiles. */
  readonly over: number;
}

/** A kit vertex inside the rectangle must sit this far under the ground (tiles; 4.5 cm). */
export const BURY_MIN = 0.015;
/** Slack on the design line (tiles): the line is a design margin, not a physical limit. */
export const DESIGN_SLACK = 0.1;
/** An olive's crown above its foot, at scale 1 (3.25 m), and a house's roof above its body, in body heights. */
export const OLIVE_TOP = 3.25 / 3;
export const HOUSE_TOP = 1.45;

export function lozengeIntrusions(placed: PlacedKit, rim: RimHeight, w: number, h: number): Intrusion[] {
  const out: Intrusion[] = [];
  const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
  const test = (what: Intrusion['what'], x: number, y: number, z: number): void => {
    if (x > 1e-3 && x < w - 1e-3 && z > 1e-3 && z < h - 1e-3) {
      const over = y - (rim(x, z) - BURY_MIN);
      if (over > 0) out.push({ kind: 'inside', what, x, y, z, over });
      return;
    }
    const t0 = Math.max(x - w, z - h);
    if (t0 <= 0) return; // beyond a far edge only
    const ex = x - t0;
    const ez = z - t0;
    if (ex < 0 || ex > w || ez < 0 || ez > h) return; // the ray passes beside the map
    const ground = rim(clamp(ex, 0, w), clamp(ez, 0, h));
    const hard = y - (ground + NEAR_HARD_SLOPE * t0);
    if (hard > 0) out.push({ kind: 'hard', what, x, y, z, over: hard });
    const design = y - (ground + NEAR_CAP_SLOPE * t0 + DESIGN_SLACK);
    if (design > 0) out.push({ kind: 'design', what, x, y, z, over: design });
  };
  const p = placed.positions;
  for (let k = 0; k < p.length; k += 3) test('kit', p[k], p[k + 1], p[k + 2]);
  for (const o of placed.olives) test('olive', o.x, o.y + OLIVE_TOP * o.scaleY, o.z);
  for (const hs of placed.houses) test('house', hs.x, hs.y + HOUSE_TOP * hs.tall, hs.z);
  return out;
}
