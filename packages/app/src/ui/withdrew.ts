// How many hostiles a victory left standing -- the after-action report's
// "N enemy killed · M withdrew" (`after-action.ts`), the honest account of a
// victory that did not mean "nobody is left". No shipped primary is
// `destroy_all`, so most wins leave hostiles standing; the sim ends the mission
// and this line says so rather than letting the player wonder. READ-ONLY over
// sim state (invariant 4): it counts, it never writes.
import { isHostileSide } from '@lions/render';

/** Units hostile to the viewer (the side the player commands, 0 in
 *  single-player) still alive. Civilians are side 2 and never count. */
export function livingHostiles(state: { side: ArrayLike<number>; alive: ArrayLike<number> }, count: number, viewer = 0): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (isHostileSide(state.side[i], viewer) && state.alive[i] === 1) n++;
  return n;
}
