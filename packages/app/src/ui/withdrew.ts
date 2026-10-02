// "Remaining enemy forces withdrew (N)" -- the end screen's honest account of a
// victory that did not mean "nobody is left". No shipped primary is
// `destroy_all`, so most wins leave hostiles standing; the sim ends the mission
// and this line says so rather than letting the player wonder. READ-ONLY over
// sim state (invariant 4): it counts, it never writes.
import { t } from '../i18n/t';

/** Hostile (side 1) units still alive. Civilians are side 2 and never count. */
export function livingHostiles(state: { side: ArrayLike<number>; alive: ArrayLike<number> }, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (state.side[i] === 1 && state.alive[i] === 1) n++;
  return n;
}

/** The line, or null: victory only, and only when someone is left. */
export function withdrewLine(result: 'victory' | 'defeat', hostiles: number | undefined): string | null {
  if (result !== 'victory' || hostiles === undefined || hostiles <= 0) return null;
  return t('end.withdrew', { n: hostiles });
}
