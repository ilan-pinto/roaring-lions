import type { Command } from '@lions/sim';
import type { Seat } from './config';
import { canonicalOrder, type Frame } from './frames';

/** What ownership needs to know, answered from the live sim by the app
 *  (`st.side[id]`, with `id >= sim.count` undefined) and by a table in tests. */
export interface SeatWorld {
  sideOfSeat(seat: Seat): number;
  sideOfEntity(id: number): number | undefined;
}

/**
 * The ownership check every client runs identically before `queueCommand`
 * (spec §3.3): a command naming any entity not on the issuing seat's side is
 * dropped. The sim itself checks nothing (`sim.ts:1784`), and a tampered
 * client's order must vanish the same way on both machines, which is why this
 * is deterministic and here rather than in the room.
 */
export function validateCommand(cmd: Command, seat: Seat, world: SeatWorld): boolean {
  const side = world.sideOfSeat(seat);
  const own = (id: number): boolean => world.sideOfEntity(id) === side;
  switch (cmd.kind) {
    case 'move': case 'attackMove': case 'halt': case 'unload': case 'garrison': case 'demolish': case 'chargeTunnel': case 'smoke':
      return cmd.ids.length > 0 && cmd.ids.every(own);
    case 'load':
      return cmd.ids.length > 0 && cmd.ids.every(own) && own(cmd.carrier);
    case 'callStrike':
      return own(cmd.caller);
    case 'reveal':
      return cmd.side === side;
  }
}

export function applyFrame(
  frame: Frame,
  sink: { queueCommand(cmd: Command): void },
  world: SeatWorld
): { queued: number; dropped: number } {
  let queued = 0;
  let dropped = 0;
  for (const s of canonicalOrder(frame.cmds)) {
    if (validateCommand(s.cmd, s.seat, world)) {
      sink.queueCommand(s.cmd);
      queued++;
    } else {
      dropped++;
    }
  }
  return { queued, dropped };
}
