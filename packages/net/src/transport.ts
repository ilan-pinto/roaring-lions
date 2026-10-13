import type { Command } from '@lions/sim';
import type { Seat } from './config';
import type { Frame, Stamped } from './frames';
import type { StallReason } from './protocol';

export type TransportStatus =
  | { kind: 'local' }
  | { kind: 'waiting' }
  | { kind: 'live'; behind: number }
  | { kind: 'stalled'; reason: StallReason | 'connecting'; seat: Seat | null }
  | { kind: 'desync'; tick: number }
  | { kind: 'paused'; seat: Seat; untilMs: number }
  | { kind: 'closed'; reason: string };

/**
 * The one seam between the battlefield and wherever its frames come from
 * (spec §3.3). The battlefield asks for runnable ticks and hands over the
 * player's commands; it never knows whether a room exists.
 */
export interface MatchTransport {
  readonly local: boolean;
  /** `CommandSink`: what `applyIntent` writes to. */
  queueCommand(cmd: Command): void;
  /** Frames the battlefield may run now, oldest first. One sim tick per frame. */
  take(maxTicks: number): Frame[];
  /** After each tick: the tick number, and the match digest on hash ticks (else null). */
  reportTick(tick: number, digest: number | null): void;
  status(): TransportStatus;
  close(): void;
}

/** Single-player: a frame per requested tick, with zero delay, so today's
 *  behaviour ("a command queued between ticks runs on the next tick") is
 *  preserved exactly and the battlefield has one code path. */
export class LocalTransport implements MatchTransport {
  readonly local = true;
  private nextTick = 0;
  private seq = 0;
  private pending: Stamped[] = [];

  queueCommand(cmd: Command): void {
    this.pending.push({ seat: 0, seq: this.seq++, cmd });
  }
  take(maxTicks: number): Frame[] {
    const out: Frame[] = [];
    for (let i = 0; i < maxTicks; i++) {
      out.push({ tick: this.nextTick++, cmds: i === 0 ? this.pending : [] });
      if (i === 0) this.pending = [];
    }
    return out;
  }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'local' }; }
  close(): void {}
}
