import { unitIsObserved } from '@lions/render';

/** What a seat can see of one unit, for `pruneHiddenHostiles`. */
export interface SeatSight {
  /** This seat's side (`me` in `main.ts`). */
  readonly viewer: number;
  readonly sideOf: (i: number) => number;
  /** The unit's world position this tick (`sim.state.posX`/`posY`). */
  readonly posOf: (i: number) => { x: number; y: number };
  /** The renderer's own fog test (`renderer.isVisible`). */
  readonly fogVisible: (wx: number, wy: number) => boolean;
}

/**
 * The selection minus every unit that is not this seat's own and that the
 * fog now hides (N1a final review, network design §5.1). Without it, a
 * hostile selected while in sight kept its live HUD card -- health, orders,
 * ammunition -- after it walked into fog. "Hidden" is the renderer's own
 * rule (`unitIsObserved`), so a unit drops from the selection on the frame
 * its body stops drawing, never sooner and never later.
 *
 * `main.ts` calls this only in a versus room. Single-player keeps a fogged
 * hostile selected, exactly as main does.
 *
 * Returns `selection` itself when nothing is dropped, so the caller can
 * compare by reference and write nothing back on the common frame.
 */
export function pruneHiddenHostiles(selection: number[], sight: SeatSight): number[] {
  const visible = (i: number): boolean => {
    const p = sight.posOf(i);
    return unitIsObserved(sight.sideOf(i), sight.viewer, p.x, p.y, sight.fogVisible);
  };
  return selection.every(visible) ? selection : selection.filter(visible);
}
