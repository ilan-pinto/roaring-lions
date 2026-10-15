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

/** D3: a side holds a zone when at least one of its living, surface, ground units stands
 *  inside it and no such unit of the other side does. Both inside is contested and pays
 *  nobody; civilians (side 2) count for nobody. Membership is `MissionRuntime.livingIn`'s
 *  rule exactly: tile = pos >> 16, right and bottom edges exclusive. */
export function zoneHolder(view: HoldView, zone: readonly [number, number, number, number]): Holder {
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
    if (present0 && present1) return -1;
  }
  if (present0) return 0;
  if (present1) return 1;
  return -1;
}
