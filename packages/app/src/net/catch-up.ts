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
 *  frame. It is the floor: while live and far behind (a rejoin's whole log),
 *  `roomTickCap` raises it to what fits a frame's budget (R-B7).
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
 *  while live, the floor or -- far behind -- what fits the frame's budget;
 *  in every other status the floor. A stall must keep the floor and not 0:
 *  a 'behind' stall's own seat has to go on running the frames it holds to
 *  ack them (R31), or the stall never clears. */
export function roomTickCap(status: TransportStatus, tickCostMs: number): number {
  return status.kind === 'live' ? Math.max(MAX_CATCHUP_TICKS, catchUpTicks(status.behind, tickCostMs)) : MAX_CATCHUP_TICKS;
}
