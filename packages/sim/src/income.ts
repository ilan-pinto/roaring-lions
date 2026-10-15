// Held-ground income (F2, D3): who holds a zone, as a pure function of a narrow view.
//
// The view is plain arrays plus one predicate, so a test builds it from literals and the
// mission runtime (Task 7) builds it from `sim.state` and `sim.unitTypes`. Nothing here
// reads a Sim, a clock or a PRNG. Integer only.

/** Who holds a zone: side 0, side 1, or -1 for nobody (empty or contested). */
export type Holder = 0 | 1 | -1;

/** The read-only slice of unit state that holding ground depends on. Task 6 extends it
 *  (`HoldView & VentView`), so it stays a plain exported interface. */
export interface HoldView {
  /** Entities to scan: indices 0..entityCount-1. */
  readonly entityCount: number;
  readonly alive: ArrayLike<number>;
  readonly side: ArrayLike<number>;
  /** Q16.16 position; the tile is `pos >> 16`. */
  readonly posX: ArrayLike<number>;
  readonly posY: ArrayLike<number>;
  /** >= 0 means buried in a tunnel route (holds and contests nothing). */
  readonly tunnelIn: ArrayLike<number>;
  /** An aircraft holds and contests nothing. */
  isAir(i: number): boolean;
}

/** Who stands in a zone (A1, C-R13): side 0, side 1, ZONE_EMPTY (-1) or ZONE_CONTESTED (-2).
 *  Empty and contested both pay nobody; the HUD tells them apart. */
export type ZoneState = 0 | 1 | -1 | -2;
/** Nobody of side 0 or 1 holds ground in the zone. */
export const ZONE_EMPTY = -1;
/** Both sides hold ground in the zone. */
export const ZONE_CONTESTED = -2;

/** D3: a side holds a zone when at least one of its living, surface, ground units stands
 *  inside it and no such unit of the other side does. Both inside is contested
 *  (ZONE_CONTESTED) and pays nobody; civilians (side 2) count for nobody. Membership is
 *  `MissionRuntime.livingIn`'s rule exactly: tile = pos >> 16, right and bottom edges
 *  exclusive. A garrisoned unit stands at its building's centroid and a carried one at its
 *  carrier's tile, as `livingIn` reads them (C-R12: D3 as written, the hold objective's rule). */
export function zoneState(view: HoldView, zone: readonly [number, number, number, number]): ZoneState {
  let present0 = false;
  let present1 = false;
  for (let i = 0; i < view.entityCount; i++) {
    if (view.alive[i] === 0) continue;
    const s = view.side[i];
    if (s !== 0 && s !== 1) continue;
    if (view.tunnelIn[i] >= 0) continue;
    const tx = view.posX[i] >> 16;
    const ty = view.posY[i] >> 16;
    if (tx < zone[0] || tx >= zone[0] + zone[2] || ty < zone[1] || ty >= zone[1] + zone[3]) continue;
    if (view.isAir(i)) continue;
    if (s === 0) present0 = true;
    else present1 = true;
    if (present0 && present1) return ZONE_CONTESTED;
  }
  if (present0) return 0;
  if (present1) return 1;
  return ZONE_EMPTY;
}

/** Who holds a zone (D3): `zoneState` with contested folded into nobody. */
export function zoneHolder(view: HoldView, zone: readonly [number, number, number, number]): Holder {
  const s = zoneState(view, zone);
  return s === ZONE_CONTESTED ? -1 : s;
}
