import type { MatchConfig, Seat } from '@lions/net';

/** The sim side this screen commands (network design §5.1): the seat's own
 *  side in a room, 0 everywhere else (single-player, every mission). */
export function viewerSideOf(config: MatchConfig | null, seat: Seat | null): 0 | 1 {
  if (config === null || seat === null) return 0;
  return config.seats[seat].side;
}
