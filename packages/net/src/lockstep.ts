import type { Frame } from './frames';

/**
 * Buffers the room's frames and yields the ones a client may run now: every
 * frame up to `newest - bufferTicks`, in tick order, never skipping one.
 * A gap is REFUSED rather than bridged -- the transport asks the room for the
 * log (spec §3.2.6); a duplicate is ignored, which is what makes a replayed log
 * harmless to a client that already applied its head.
 */
export class LockstepClock {
  /** The tick the next `take` will yield first. */
  nextTick: number;
  /** The newest tick received, `start - 1` before the first frame. */
  newest: number;
  private readonly frames = new Map<number, Frame>();

  /** `start`: the first tick this clock will run, for a client whose world
   *  begins at a snapshot. A frame below it is a `duplicate`; a frame above it
   *  with nothing before it is a `gap`. 0 is the whole log. */
  constructor(readonly bufferTicks: number, start = 0) {
    this.nextTick = start;
    this.newest = start - 1;
  }

  push(frame: Frame): 'ok' | 'duplicate' | 'gap' {
    if (frame.tick < this.nextTick || this.frames.has(frame.tick)) return 'duplicate';
    if (frame.tick !== this.newest + 1) return 'gap';
    this.frames.set(frame.tick, frame);
    this.newest = frame.tick;
    return 'ok';
  }

  /** Frames runnable now, oldest first, at most `maxTicks` of them.
   *  `final`: a tick known to be final whatever arrives next (a paced room's
   *  closed round, N4a), released even inside the buffer; never past `newest`. */
  take(maxTicks: number, final = -1): Frame[] {
    const out: Frame[] = [];
    const upTo = Math.max(this.newest - this.bufferTicks, Math.min(final, this.newest));
    while (out.length < maxTicks && this.nextTick <= upTo) {
      const f = this.frames.get(this.nextTick);
      if (f === undefined) break;
      this.frames.delete(this.nextTick);
      out.push(f);
      this.nextTick++;
    }
    return out;
  }

  /** Every frame received and not yet run, oldest first, at most `maxTicks`,
   *  the buffered tail included: for a match whose room has ended, where no
   *  newer frame is coming to lift it out of the buffer. */
  drain(maxTicks: number): Frame[] {
    const out: Frame[] = [];
    while (out.length < maxTicks && this.nextTick <= this.newest) {
      const f = this.frames.get(this.nextTick);
      if (f === undefined) break;
      this.frames.delete(this.nextTick);
      out.push(f);
      this.nextTick++;
    }
    return out;
  }

  /** Frames received and not yet run. */
  behind(): number {
    return this.newest - this.nextTick + 1;
  }
}
