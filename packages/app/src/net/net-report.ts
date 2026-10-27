/**
 * `__lions.net()`, defined in a room only (N0 final review I1): what this
 * seat has seen of the room, so the two-machine run reads positive evidence
 * -- hashes the room paired and found equal, stalls, reconnects -- instead of
 * "nothing appeared", which a check that never ran also shows. Read in EACH
 * console before leaving: the seat that leaves loses `__lions` with its
 * battlefield.
 */
import { WsTransport, type MatchConfig, type MatchTransport, type NetStats, type Seat, type TransportStatus } from '@lions/net';
import type { ProducerStats } from './snapshot-producer';
import type { RejoinOutcome } from './snapshot-rejoin';

export interface NetReport extends NetStats {
  seat: Seat;
  /** The room code, from the room's own config. */
  room: string | null;
  /** This machine's `sim.tickCount`: the two machines are never on the same
   *  tick at the same moment, so compare `hashOk` counts, not ticks. */
  tickCount: number;
  status: TransportStatus;
  /** Which way this tab's reload went (snapshot S4): `snapshot` with its `from` and `restoreMs`, or `full` with
   *  the reason it fell back. Absent when this tab did not reload. */
  rejoin?: RejoinOutcome;
  /** This seat's snapshot producer counters, `mismatch` included. Absent when it does not produce. */
  snapshot?: ProducerStats;
}

export interface NetReportExtra {
  rejoin?: RejoinOutcome | null;
  snapshot?: ProducerStats | null;
}

/** Null when the transport is not a room's (never, in a room). */
export function netReport(transport: MatchTransport, seat: Seat, config: MatchConfig | null, tickCount: number, extra: NetReportExtra = {}): NetReport | null {
  if (!(transport instanceof WsTransport)) return null;
  return {
    seat, room: config?.code ?? null, tickCount, status: transport.status(), ...transport.stats(),
    ...(extra.rejoin ? { rejoin: extra.rejoin } : {}),
    ...(extra.snapshot ? { snapshot: extra.snapshot } : {}),
  };
}

/**
 * What the battlefield prints about a rejoin (G-2). `info` is the `[net] rejoin:` line, for either path.
 * `warn` is set only on a fallback to the full log, and names the reason -- a label from `FALLBACK_REASONS`,
 * never the ticket or the bytes. A warning, never an error: `pnpm ui:routes` fails on any console error.
 */
export function rejoinLines(rejoin: RejoinOutcome): { info: string; warn: string | null } {
  if (rejoin.path === 'snapshot') {
    return { info: `[net] rejoin: snapshot from ${rejoin.from} in ${Math.round(rejoin.restoreMs)} ms`, warn: null };
  }
  return {
    info: `[net] rejoin: full log (${rejoin.reason})`,
    warn: `[net] snapshot rejoin fell back to the full log: ${rejoin.reason}`,
  };
}

/** Where `logRejoin` writes: the console in the battlefield, a fake with only these two in a test. Deliberately no
 *  `error`: a rejoin is never an error, and `pnpm ui:routes` fails on any console error. */
export type RejoinSink = Pick<Console, 'info' | 'warn'>;

/** Prints a rejoin (G-2): the `[net] rejoin:` line through `info`, and on a fallback one reason-named warning through
 *  `warn`. The choice of method lives here, under test, not in `main.ts`. */
export function logRejoin(rejoin: RejoinOutcome, sink: RejoinSink): void {
  const lines = rejoinLines(rejoin);
  sink.info(lines.info);
  if (lines.warn !== null) sink.warn(lines.warn);
}
