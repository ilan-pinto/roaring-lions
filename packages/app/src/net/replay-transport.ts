/**
 * The transport a REPLAY of an arena game runs on (GH-954 W3): the recorded frames, handed to the battlefield at a
 * chosen speed, 0.5x to 8x. It is a `MatchTransport` like the room's, so the battlefield has one code path and
 * cannot tell a replay from a live game; it has no room, no ticket and no way to speak to one.
 *
 * Scheduling is in SIM TICKS. The frames are a fixed list; what changes with the speed is only how many of them are
 * released to the sim per call to `take`. A wall clock is read for ONE thing, to credit the budget of ticks owed
 * (`ticksOwed`: `dt * speed / 50 ms`), and the sim never sees it: it is stepped by the frames, one tick a frame, in
 * order, never skipped and never repeated. Speed therefore cannot change what a game comes to (`replay-transport
 * .test.ts` runs one file at 0.5x and 8x, with different frame durations, and requires one final state).
 *
 * No input-to-command path (invariant 4): `queueCommand` drops the command and keeps nothing, and the battlefield
 * is given `spectatorSink` for its orders in any case.
 *
 * DEV only: reached through `ui/arena-replay.ts`, itself behind a dynamic `import()` inside `import.meta.env.DEV`.
 */
import type { Command } from '@lions/sim';
import type { Frame, MatchTransport, TransportStatus } from '@lions/net';

/** The speeds offered. 1 is the game's own pace: 20 ticks a second. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
export const REPLAY_TICK_MS = 50;
/** The most wall time one call may credit: a tab that was hidden for a minute does not replay a minute at once. */
export const REPLAY_MAX_CREDIT_MS = 250;

export const isReplaySpeed = (v: unknown): v is ReplaySpeed => REPLAY_SPEEDS.includes(v as ReplaySpeed);

/** The ticks `dtMs` of wall time owes at `speed`: fractional, the transport carries the remainder. */
export function ticksOwed(dtMs: number, speed: number): number {
  return (Math.min(Math.max(dtMs, 0), REPLAY_MAX_CREDIT_MS) * speed) / REPLAY_TICK_MS;
}

export interface ReplayTransportOptions {
  /** Wall-clock ms. Used only to credit the tick budget. */
  now: () => number;
  speed?: ReplaySpeed;
}

export class ReplayTransport implements MatchTransport {
  readonly local = false;
  private next = 0;
  /** Ticks owed and not yet taken (fractional). */
  private owed = 0;
  private last: number;
  private rate: ReplaySpeed;
  private halted = false;
  private closed = false;

  constructor(private readonly frames: readonly Frame[], private readonly o: ReplayTransportOptions) {
    this.last = o.now();
    this.rate = o.speed ?? 1;
  }

  get speed(): ReplaySpeed { return this.rate; }
  get paused(): boolean { return this.halted; }
  /** Frames released so far: the tick the sim stands at. */
  get position(): number { return this.next; }
  get total(): number { return this.frames.length; }

  setSpeed(speed: ReplaySpeed): void {
    this.credit();
    this.rate = speed;
  }
  setPaused(paused: boolean): void {
    this.credit();
    this.halted = paused;
  }

  /** Credits the wall time since the last call, once. A paused replay owes nothing. */
  private credit(): void {
    const at = this.o.now();
    const dt = at - this.last;
    this.last = at;
    if (this.halted || this.closed || this.next >= this.frames.length) return;
    this.owed += ticksOwed(dt, this.rate);
  }

  /** A command has nowhere to go: a replay has no room. */
  queueCommand(cmd: Command): void { void cmd; /* dropped: kept nowhere, sent nowhere */ }

  take(maxTicks: number): Frame[] {
    this.credit();
    const n = Math.max(0, Math.min(Math.floor(this.owed), maxTicks, this.frames.length - this.next));
    const out = this.frames.slice(this.next, this.next + n);
    this.next += n;
    this.owed -= n;
    if (this.next >= this.frames.length) this.owed = 0;
    return out;
  }

  reportTick(): void { /* nobody to tell */ }

  /** Ticks owed and not yet taken: the battlefield's "behind", never the whole of what remains (a long
   *  backlog would read as a rejoin catching up and mute the picture). */
  behind(): number {
    this.credit();
    return Math.floor(this.owed);
  }

  status(): TransportStatus {
    if (this.closed) return { kind: 'closed', reason: 'left' };
    if (this.next >= this.frames.length) return { kind: 'closed', reason: 'over' };
    return { kind: 'live', behind: this.behind() };
  }

  close(): void {
    this.closed = true;
  }
}
