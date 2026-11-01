/**
 * The arena's cap (N4b, ruling N1): a match the outcome rule has not decided
 * by the cap tick is decided as if the room's own 25-minute cap had come --
 * `outcomeOf(sim, <the map's cap>)`, the higher surviving value winning and
 * equal values drawing, exactly as the versus probe settles its cap. ONE place
 * for that rule: the control tests (players.test.ts) and the arena (Task 13)
 * both import it, and neither re-implements outcome logic.
 *
 * Asked of the reading seat's sim (seat 0's, else seat 1's, else the observer's), stopped on the cap tick: both seats' sims hold the
 * same state there, so the answer is the one either seat would have reached.
 * A pure read: nothing here writes to the sim.
 */
import { matchCapTicks } from '@lions/net';
import { outcomeOf, type MatchResult, type OutcomeProduction, type OutcomeSim } from '../../../packages/app/src/net/outcome';

/** The result at the arena's cap. Never `ongoing`: at the MAP's cap (`matchCapTicks`: 25 minutes, 35 on Rujm
 *  Sawda, GH-913 L8) the rule always decides (annihilation, mutual, stalemate or time). `map` absent is the
 *  25-minute default. */
export function capOutcome(sim: OutcomeSim, production?: OutcomeProduction, map?: string): MatchResult {
  const cap = matchCapTicks(map);
  const o = outcomeOf(sim, cap, undefined, production, cap);
  if (o.kind === 'ongoing') throw new Error('capOutcome: the outcome rule left a game ongoing at the cap');
  return o;
}
