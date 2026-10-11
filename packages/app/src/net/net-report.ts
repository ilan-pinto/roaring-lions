/**
 * `__lions.net()`, defined in a room only (N0 final review I1): what this
 * seat has seen of the room, so the two-machine run reads positive evidence
 * -- hashes the room paired and found equal, stalls, reconnects -- instead of
 * "nothing appeared", which a check that never ran also shows. Read in EACH
 * console before leaving: the seat that leaves loses `__lions` with its
 * battlefield.
 */
import { WsTransport, type MatchConfig, type MatchTransport, type NetStats, type Seat, type TransportStatus } from '@lions/net';

export interface NetReport extends NetStats {
  seat: Seat;
  /** The room code, from the room's own config. */
  room: string | null;
  /** This machine's `sim.tickCount`: the two machines are never on the same
   *  tick at the same moment, so compare `hashOk` counts, not ticks. */
  tickCount: number;
  status: TransportStatus;
}

/** Null when the transport is not a room's (never, in a room). */
export function netReport(transport: MatchTransport, seat: Seat, config: MatchConfig | null, tickCount: number): NetReport | null {
  if (!(transport instanceof WsTransport)) return null;
  return { seat, room: config?.code ?? null, tickCount, status: transport.status(), ...transport.stats() };
}
