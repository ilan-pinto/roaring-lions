import type { Command } from '@lions/sim';
import type { Faction, Seat } from './config';
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
  /** GH-681: the faction a seat plays, from the shared match config (single-
   *  player: KDF). Only the Sarim seat sends tunnel orders (T-R4). */
  factionOfSeat(seat: Seat): Faction;
  /** GH-681: the side that may enter route `id` (`Sim.tunnelOwner`), -1 for
   *  none or no such route. Load-time sim data, so both machines agree. */
  tunnelOwner(id: number): number;
  /** A versus room (`config.mode === 'versus'`). Intel -- `callStrike` and
   *  `reveal` -- is priced, cooled down and ranged only by the mission
   *  runtime, and a room runs none, so in versus both kinds are dropped
   *  (#559 F1): the same answer on both machines, from the shared config.
   *  `build` and `support` (N2) are priced only by the runtime too, and drop
   *  in versus for the same reason, as do field works' `raiseWorks` and
   *  `cancelWorks` (GH-277). */
  readonly versus: boolean;
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
    case 'halt': case 'unload': case 'setStance':
      return cmd.ids.length > 0 && cmd.ids.every(own);
    case 'garrison': case 'demolish':
      return cmd.ids.length > 0 && cmd.ids.every(own) && world.structureExists(cmd.structure);
    case 'chargeTunnel':
      return cmd.ids.length > 0 && cmd.ids.every(own) && world.tunnelExists(cmd.tunnel);
    case 'load':
      return cmd.ids.length > 0 && cmd.ids.every(own) && own(cmd.carrier);
    case 'enterTunnel':
      // GH-681 (T-R4): the Sarim seat's verb, on a route its own side owns. The
      // KDF seat's tunnel verb is `chargeTunnel`. The sim refuses the same
      // order on its own terms too (owner, foot, capacity); this check makes a
      // tampered one vanish identically on both machines before the queue.
      return (
        cmd.ids.length > 0 && cmd.ids.every(own) && world.factionOfSeat(seat) === 'sarim' &&
        world.tunnelExists(cmd.tunnel) && world.tunnelOwner(cmd.tunnel) === side
      );
    case 'vent':
      // A KDF seat can never have a buried unit; the faction check keeps the
      // rule symmetrical with `enterTunnel` rather than resting on that proof.
      return cmd.ids.length > 0 && cmd.ids.every(own) && world.factionOfSeat(seat) === 'sarim';
    case 'attack': {
      // The target must exist and be the OTHER side's: an order to fire on
      // your own unit, or on an id that is nothing, vanishes on both machines.
      const theirs = world.sideOfEntity(cmd.target);
      return cmd.ids.length > 0 && cmd.ids.every(own) && theirs !== undefined && theirs !== side;
    }
    case 'rescue':
      // GH-707: own medics only, and a target that exists -- of ANY side: rescuing your own,
      // a civilian or an enemy wounded are all orders. Whether he is down and known is the sim's.
      return cmd.ids.length > 0 && cmd.ids.every(own) && world.sideOfEntity(cmd.target) !== undefined;
    case 'callStrike':
      return !world.versus && own(cmd.caller) && onMap(cmd.x, cmd.y);
    case 'reveal':
      return !world.versus && cmd.side === side && onMap(cmd.x, cmd.y);
    case 'build': case 'cancelBuild': case 'clearRally':
      return !world.versus && cmd.side === side;
    case 'setRally':
      return !world.versus && cmd.side === side && onMap(cmd.x, cmd.y);
    case 'support':
      return !world.versus && cmd.side === side && onMap(cmd.x, cmd.y);
    case 'construct': case 'cancelConstruct':
      // The sim's own field-works orders never come from a client (`cleanCommand`
      // refuses them): a client asks with `raiseWorks`/`cancelWorks`, below.
      return false;
    case 'raiseWorks':
      // Field works (GH-277) are priced only by the mission runtime, like `build`,
      // so they drop in versus. Builders, when named, must be the seat's own.
      return !world.versus && cmd.side === side && cmd.ids.every(own);
    case 'cancelWorks':
      return !world.versus && cmd.side === side;
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
