/**
 * How many room frames one animation frame may run (N1b, R-B7). A seat that
 * rejoins mid-match receives the whole log and must run it down while the
 * room keeps adding 20 frames a second; at the normal cap of 4 a frame (240
 * ticks a second at 60 fps) a 12,000-tick log takes about a minute. Far
 * behind, it runs as many ticks as fit in a frame's budget at the measured
 * cost per tick. The battlefield only ever uses this to RAISE its cap.
 *
 * App code on the frame clock: the cost is wall time measured around the
 * battlefield's own `stepFrames`, never anything the sim reads.
 */

import type { TransportStatus } from '@lions/net';

/** In a room the room's clock is the only clock (R33): a render frame runs up
 *  to this many of the frames the transport holds, whatever the local pause
 *  or speed, so a client that fell behind catches up at 4x without one long
 *  frame. It is the floor: while far behind (a rejoin's whole log, live or
 *  stalled), `roomTickCap` raises it to what fits a frame's budget (R-B7, I-1).
 *  Single-player keeps its accumulator. */
export const MAX_CATCHUP_TICKS = 4;

/** How many ticks this animation frame may run: the normal cap when nearly
 *  caught up; while far behind, as many as fit in `budgetMs` at the measured
 *  cost per tick. */
export function catchUpTicks(behind: number, msPerTick: number, budgetMs = 12, normalCap = 4): number {
  if (behind <= 0) return 0;
  if (behind <= normalCap * 2) return Math.min(behind, normalCap);
  const fit = Math.floor(budgetMs / Math.max(msPerTick, 0.05));
  return Math.max(1, Math.min(behind, Math.max(normalCap, fit)));
}

/** The cost per tick to start from, before anything has been measured:
 *  pessimistic, so the first frame after a log is not a long one. */
export const INITIAL_TICK_COST_MS = 2;

/** One step of the exponential moving average of the cost per tick. A
 *  sample that is not a finite, non-negative number is ignored. */
export function tickCostEma(prev: number, sampleMs: number, alpha = 0.2): number {
  if (!Number.isFinite(sampleMs) || sampleMs < 0) return prev;
  return prev + alpha * (sampleMs - prev);
}

/** What one animation frame of a ROOM may run (the battlefield's loop):
 *  the floor, or -- far behind -- what fits the frame's budget, while live,
 *  stalled or paused; in every other status the floor. `held` is the clock's
 *  backlog (`WsTransport.behind()`); a `live` status carries its own, which
 *  stands in when none is given.
 *
 *  A stall raises the cap as live does (I-1): a reload rejoin keeps its old
 *  ack in the room, so the room behind-stalls on it 2 s into its replay and
 *  it spends most of the replay `stalled`, with the other seat frozen. R31
 *  needs only that a stalled seat go on running the frames it holds -- a cap
 *  of at least 1 -- and `max(floor, ...)` keeps the floor. A pause too: it
 *  mints no frames, so only a seat that rejoined into it (the room sends its
 *  log ahead of the pause in force) can be far behind, and that is the same
 *  replay with both seats held. Near caught up every case is the floor. */
export function roomTickCap(status: TransportStatus, tickCostMs: number, held?: number): number {
  switch (status.kind) {
    case 'live':
      return Math.max(MAX_CATCHUP_TICKS, catchUpTicks(held ?? status.behind, tickCostMs));
    case 'stalled':
    case 'paused':
      return Math.max(MAX_CATCHUP_TICKS, catchUpTicks(held ?? 0, tickCostMs));
    default:
      return MAX_CATCHUP_TICKS;
  }
}

/** How far behind the live edge a tick may be and still be presented as it
 *  happens: more than this many frames still waiting behind it (one second
 *  of play) and the tick is OLD -- a rejoin running the room's log, or a tab
 *  that was hidden for a while. A live seat holds `bufferTicks` (2) and a few
 *  more at most, so ordinary play never reaches it. */
export const QUIET_BEHIND_TICKS = 20;

/**
 * Whether each tick of a batch is old enough to be presented silently (the
 * quiet catch-up, N1b follow-up). A 12,000-tick replay would otherwise fire
 * minutes of shots, blasts, barks and alert chimes in a few seconds; while a
 * tick is more than `QUIET_BEHIND_TICKS` from the live edge the battlefield
 * mutes the audio cues and voice lines and has the renderer drop its one-shot
 * bursts, and the moment it is within reach everything resumes by itself.
 *
 * Presentation only: it reads the transport's backlog and the sim never sees
 * it. `begin` takes the frames held when a batch starts (`WsTransport.behind()`;
 * 0 in single-player, which is therefore never quiet), and `next` answers for
 * the tick about to run and counts it off.
 */
export class CatchUpQuiet {
  private held = 0;

  begin(heldFrames: number): void {
    this.held = Number.isFinite(heldFrames) ? Math.max(0, Math.floor(heldFrames)) : 0;
  }

  /** True when the tick about to run still has more than `QUIET_BEHIND_TICKS`
   *  frames waiting behind it. */
  next(): boolean {
    const quiet = this.held - 1 > QUIET_BEHIND_TICKS;
    if (this.held > 0) this.held--;
    return quiet;
  }
}
