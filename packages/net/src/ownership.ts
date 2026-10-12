import type { Command } from '@lions/sim';
import type { Seat } from './config';
import { canonicalOrder, type Frame } from './frames';

/** What ownership needs to know, answered from the live sim by the app
 *  (`st.side[id]`, with `id >= sim.count` undefined) and by a table in tests. */
export interface SeatWorld {
  sideOfSeat(seat: Seat): number;
  sideOfEntity(id: number): number | undefined;
  /** Map size in tiles; a point is Q16.16, so the edge is `width * 65536`. */
  readonly width: number;
  readonly height: number;
  /** Structure and tunnel ids are `0..count-1` in the sim; anything else names nothing. */
  structureExists(id: number): boolean;
  tunnelExists(id: number): boolean;
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
  // Q16.16 compared as integers; NaN fails every comparison, so it is off the map.
  const onMap = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < world.width * 65536 && y < world.height * 65536;
  switch (cmd.kind) {
    case 'move': case 'attackMove': case 'smoke':
      return cmd.ids.length > 0 && cmd.ids.every(own) && onMap(cmd.x, cmd.y);
    case 'halt': case 'unload':
      return cmd.ids.length > 0 && cmd.ids.every(own);
    case 'garrison': case 'demolish':
      return cmd.ids.length > 0 && cmd.ids.every(own) && world.structureExists(cmd.structure);
    case 'chargeTunnel':
      return cmd.ids.length > 0 && cmd.ids.every(own) && world.tunnelExists(cmd.tunnel);
    case 'load':
      return cmd.ids.length > 0 && cmd.ids.every(own) && own(cmd.carrier);
    case 'callStrike':
      return own(cmd.caller) && onMap(cmd.x, cmd.y);
    case 'reveal':
      return cmd.side === side && onMap(cmd.x, cmd.y);
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
