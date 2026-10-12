/**
 * What Escape does to a room (N1b task 8, spec §3.2.5). There is no local
 * pause in a match: the room is the clock (R33), and a pause is a room
 * message, 3 x 90 s a seat. Escape still opens the pause menu every time --
 * its settings tab is wanted mid-match whatever the room is doing -- and this
 * decides, from what this seat can see, whether opening it also asks the room
 * to pause.
 *
 * R-B17: the room SILENTLY ignores a pause it refuses (none left, one already
 * in force), so the client keeps its own count of this seat's pauses left --
 * from the last `paused` message it saw, starting at `PAUSES_PER_SEAT` -- and
 * with none left it does not ask, and says so instead (`note`).
 */
import type { TransportStatus } from '@lions/net';

export interface RoomPauseCall {
  /** Send `pause` to the room. */
  send: boolean;
  /** Show "No pauses left: the match keeps running" in the menu. */
  note: boolean;
}

export function roomPauseCall(status: TransportStatus, pausesLeft: number): RoomPauseCall {
  // Already paused (by either seat), or not running at all (waiting, closed,
  // desync): the room would refuse, and the match is not running either, so
  // "keeps running" would be untrue. The menu opens on its own.
  if (status.kind !== 'live' && status.kind !== 'stalled') return { send: false, note: false };
  return pausesLeft > 0 ? { send: true, note: false } : { send: false, note: true };
}
