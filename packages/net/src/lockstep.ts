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
  nextTick = 0;
  /** The newest tick received, -1 before the first frame. */
  newest = -1;
  private readonly frames = new Map<number, Frame>();

  constructor(readonly bufferTicks: number) {}

  push(frame: Frame): 'ok' | 'duplicate' | 'gap' {
    if (frame.tick < this.nextTick || this.frames.has(frame.tick)) return 'duplicate';
    if (frame.tick !== this.newest + 1) return 'gap';
    this.frames.set(frame.tick, frame);
    this.newest = frame.tick;
    return 'ok';
  }

  /** Frames runnable now, oldest first, at most `maxTicks` of them. */
  take(maxTicks: number): Frame[] {
    const out: Frame[] = [];
    while (out.length < maxTicks && this.nextTick <= this.newest - this.bufferTicks) {
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
