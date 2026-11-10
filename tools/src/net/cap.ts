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
import { matchCapTicks, matchCapTicksOf, type CapConfig } from '@lions/net';
import { effectiveCapTicks, outcomeOf, type MatchResult, type OutcomeGoals, type OutcomeProduction, type OutcomeSimAt } from '../../../packages/app/src/net/outcome';

/** The result at the arena's cap. Never `ongoing`: at the MAP's cap (`matchCapTicks`: 25 minutes, 35 on Rujm
 *  Sawda, GH-913 L8) the rule always decides (annihilation, mutual, stalemate or time). `room` is the room's config (a flag
 *  set-up room's cap is 30 minutes) or just a map; absent is the 25-minute default. `goals` (GH-976 P2) is a win-mode room's goal: a side that completed it by the cap wins by
 *  the objective, as it would have in the room (`outcomeOf` asks the goal first); with no goal done, or none, the
 *  cap is decided on surviving value, exactly as before. GH-1208: a set-up room is decided 12 minutes after the bell, so the
 *  cap is `effectiveCapTicks` -- the ONE rule `hashTickOutcome` reads too -- and a harness that settles the room on the cap
 *  tick sees the same backstop as the room itself. */
export function capOutcome(sim: OutcomeSimAt, production?: OutcomeProduction, room?: string | CapConfig, goals?: OutcomeGoals): MatchResult {
  // GH-976 R0.8: a ROOM's cap (30 minutes in a flag set-up room) when the config is in hand; a bare map is the map form.
  const cap = typeof room === 'object' ? matchCapTicksOf(room) : matchCapTicks(room);
  // A bare map has no config, hence no backstop; a config's cap folds in the bell + FLAG_BACKSTOP_MINUTES (GH-1208).
  const decided = typeof room === 'object' ? effectiveCapTicks(room, sim, cap) : cap;
  const o = outcomeOf(sim, decided, undefined, production, decided, goals);
  if (o.kind === 'ongoing') throw new Error('capOutcome: the outcome rule left a game ongoing at the cap');
  return o;
}
