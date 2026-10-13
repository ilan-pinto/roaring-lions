/**
 * The battlefield's one per-frame body (spec §3.3, R9): take runnable frames
 * from the transport, put each frame's commands through the ownership check
 * into the sim, run ONE tick, and report that tick back. The frame loop and
 * `__lions.step` both call this, in single-player and in a room alike, so an
 * order a tool dispatches through the UI and then steps runs by exactly the
 * path a player's does.
 *
 * Acks and hashes are keyed by the FRAME's tick (R32), never `sim.tickCount`:
 * the room numbers frames from 0 and knows nothing of how the sim counts.
 */
import { applyFrame, matchDigest, type MatchConfig, type MatchTransport, type Seat, type SeatWorld } from '@lions/net';
import type { Command } from '@lions/sim';

/** The slice of `Sim` the body touches. */
export interface FrameSim {
  queueCommand(cmd: Command): void;
  hash(): number;
}

export interface FrameStep {
  transport: MatchTransport;
  sim: FrameSim;
  seatWorld: SeatWorld;
  /** The battlefield's own tick: `sim.tick()` and everything presentation hangs off it. */
  runTick: () => void;
  /** The room's config; null in single-player, where nothing is hashed. */
  config: MatchConfig | null;
  /** Asked after each frame has run and been reported, with the frame's tick:
   *  true stops the batch there (N1b task 10, a versus match decided on that
   *  tick). The frames behind it in the batch are not run -- the match is
   *  over and the caller steps no more. Absent in single-player. */
  stopAfter?: (tick: number) => boolean;
}

/** A hash tick closes a window of `hashEveryTicks` frames: ticks 19, 39, ... at 20. */
export function isHashTick(tick: number, config: MatchConfig | null): boolean {
  return config !== null && (tick + 1) % config.hashEveryTicks === 0;
}

/** Runs up to `maxTicks` frames; returns how many ran and how many commands
 *  the ownership check dropped (a foreign id, or one that names nobody). */
export function runFrames(step: FrameStep, maxTicks: number): { ran: number; dropped: number } {
  const { transport, sim, seatWorld, runTick, config } = step;
  let ran = 0;
  let dropped = 0;
  for (const f of transport.take(maxTicks)) {
    dropped += applyFrame(f, sim, seatWorld).dropped;
    runTick();
    ran++;
    transport.reportTick(f.tick, config !== null && isHashTick(f.tick, config) ? matchDigest(sim.hash(), 0, config.dataDigest) : null);
    if (step.stopAfter?.(f.tick) === true) break;
  }
  return { ran, dropped };
}

/** What ownership asks of the live sim. Single-player is seat 0 on side 0
 *  (R10): the same check runs with no room, so there is one code path. */
export function seatWorldFor(
  config: MatchConfig | null,
  sim: {
    readonly entityCount: number;
    readonly width: number;
    readonly height: number;
    readonly structureCount: number;
    readonly tunnelCount: number;
    readonly state: { readonly side: ArrayLike<number> };
  },
): SeatWorld {
  return {
    width: sim.width,
    height: sim.height,
    // Read the counts LIVE: this world is built before structures and tunnels are added to the sim.
    structureExists: (id: number) => Number.isInteger(id) && id >= 0 && id < sim.structureCount,
    tunnelExists: (id: number) => Number.isInteger(id) && id >= 0 && id < sim.tunnelCount,
    sideOfSeat: (seat: Seat) => config?.seats[seat].side ?? 0,
    // Security review 559, F1: no mission runtime prices intel in a versus room.
    versus: config?.mode === 'versus',
    sideOfEntity: (id: number) => (Number.isInteger(id) && id >= 0 && id < sim.entityCount ? sim.state.side[id] : undefined),
  };
}
