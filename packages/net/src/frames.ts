import type { Command } from '@lions/sim';
import type { Seat } from './config';

/** One command, stamped by the room with the seat that sent it and the
 *  seat's own sequence number. */
export interface Stamped { seat: Seat; seq: number; cmd: Command }

/** One tick's worth of input, for every seat. An empty frame is still a
 *  frame: it is how a client learns tick N happened with no orders. */
export interface Frame { tick: number; cmds: Stamped[] }

/** The total order every client applies: (seat, seq). Arrival order is not
 *  an order (spec §3.2.2). Stable, and a copy: the input belongs to the caller. */
export function canonicalOrder(cmds: readonly Stamped[]): Stamped[] {
  return [...cmds].sort((a, b) => a.seat - b.seat || a.seq - b.seq);
}
