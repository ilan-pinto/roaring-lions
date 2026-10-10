// How many hostiles a victory left standing -- the after-action report's
// "N enemy killed · M withdrew" (`after-action.ts`), the honest account of a
// victory that did not mean "nobody is left". No shipped primary is
// `destroy_all`, so most wins leave hostiles standing; the sim ends the mission
// and this line says so rather than letting the player wonder. READ-ONLY over
// sim state (invariant 4): it counts, it never writes.
/** Hostile (side 1) units still alive. Civilians are side 2 and never count. */
export function livingHostiles(state: { side: ArrayLike<number>; alive: ArrayLike<number> }, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (state.side[i] === 1 && state.alive[i] === 1) n++;
  return n;
}
