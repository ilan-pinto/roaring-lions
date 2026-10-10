/**
 * Who is standing NEXT TO an unheld objective zone, for the HUD clock.
 *
 * Umm Zeitoun II (3 Oct 2026): the lead parked an APC and three squads on the
 * crest line and the clock said "NOBODY HOLDING" and stopped. The sim was
 * right -- every unit stood one row in front of the two-row `crest_line` zone,
 * on y=42 -- but at gameplay zoom a vehicle body is taller than that two-tile
 * strip, so a hull whose tile is OUTSIDE the zone draws squarely inside the
 * yellow band, ring straddling its edge. "Nobody holding" then reads as a
 * broken game. The clock now says how many of your units are just outside,
 * which is what is actually happening.
 *
 * READ-ONLY over sim state, and the inside/outside rule is the sim's own
 * (`MissionRuntime.livingIn`): a unit's tile is `pos >> 16`, a buried unit
 * holds no ground. Mirroring it rather than approximating it is the point --
 * a count that disagreed with the sim about what "inside" means would be a
 * second wrong answer.
 */

/** The slice of `Sim['state']` this reads. */
export interface OutsideState {
  readonly alive: ArrayLike<number>;
  readonly side: ArrayLike<number>;
  readonly posX: ArrayLike<number>;
  readonly posY: ArrayLike<number>;
  readonly tunnelIn: ArrayLike<number>;
}

/** How far outside a zone a unit may stand and still be "just outside", in
 *  tiles. Two, not one: a group order lands in formation, and on Umm
 *  Zeitoun's crest a click on the band's near half put units two rows short. */
export const JUST_OUTSIDE_TILES = 2;

/**
 * Living, unburied player (side 0) units whose tile is within `margin` tiles
 * of `zone` (Chebyshev) but not inside it.
 */
export function unitsJustOutside(
  state: OutsideState,
  entityCount: number,
  zone: readonly number[],
  margin: number = JUST_OUTSIDE_TILES
): number {
  const [zx, zy, zw, zh] = zone;
  let n = 0;
  for (let i = 0; i < entityCount; i++) {
    if (state.alive[i] === 0 || state.side[i] !== 0) continue;
    if (state.tunnelIn[i] >= 0) continue;
    const tx = state.posX[i] >> 16;
    const ty = state.posY[i] >> 16;
    const inside = tx >= zx && tx < zx + zw && ty >= zy && ty < zy + zh;
    if (inside) continue;
    const near = tx >= zx - margin && tx < zx + zw + margin && ty >= zy - margin && ty < zy + zh + margin;
    if (near) n++;
  }
  return n;
}

interface Row {
  status: string;
  paused?: 'contested' | 'unheld';
  zone?: string;
}

/**
 * Stamps `outside` on every active, UNHELD zone objective: the count of your
 * units just outside its zone. Rows that are held, contested or zoneless pass
 * through untouched -- contested already means someone is inside.
 */
export function withOutsideCounts<R extends Row>(
  rows: readonly R[],
  zones: Readonly<Record<string, readonly number[]>>,
  count: (zone: readonly number[]) => number
): (R & { outside?: number })[] {
  return rows.map((r) => {
    if (r.status !== 'active' || r.paused !== 'unheld' || r.zone === undefined) return r;
    const rect = zones[r.zone];
    if (rect === undefined) return r;
    const outside = count(rect);
    return outside > 0 ? { ...r, outside } : r;
  });
}
