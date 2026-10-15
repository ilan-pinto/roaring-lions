import type { MatchConfig } from './config';

/** Who holds each SIDE, as the sim is told it (N2 prerequisite P4). The sim
 *  takes this table as given and never reads a config: the rule it feeds -- a
 *  player's units never cut a wall by accident -- applies to a side a human
 *  commands. `humanHeld[side]`.
 *
 *  Single-player (no room) and a sandbox room (two humans, both on side 0) hold
 *  side 0 only. A versus room holds BOTH sides: a bot seat is a player too
 *  (controller ruling, 15 Oct 2026). */
export interface SeatRules {
  humanHeld: [boolean, boolean];
}

export function seatRules(config: MatchConfig | null): SeatRules {
  if (config !== null && config.mode === 'versus') return { humanHeld: [true, true] };
  return { humanHeld: [true, false] };
}
