/**
 * When each unit went to ground, read off the sim's own `pinned` events
 * (pass C2/C4, D3). The sim's `pinnedTicks` -- what its break rule counts --
 * is private; its `pinned` event carries the same clock, so the card's
 * "may break in ~N s" is derived here rather than asked of the sim (this lane
 * does not change it). Pure bookkeeping over events: nothing reaches back.
 */
import type { SimEvent } from '@lions/sim';

export class PinnedSince {
  private readonly since = new Map<number, number>();

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.kind === 'pinned') this.since.set(e.entity, e.tick);
      else if (e.kind === 'unpinned' || e.kind === 'routed') this.since.delete(e.entity);
      else if (e.kind === 'destroyed') this.since.delete(e.entity);
    }
  }

  /** Ticks this unit has been pinned without breaking, or null when the
   *  tracker never saw it go to ground (pinned before it was watching). */
  ticksPinned(entity: number, nowTick: number): number | null {
    const t = this.since.get(entity);
    return t === undefined ? null : Math.max(0, nowTick - t);
  }

  clear(): void {
    this.since.clear();
  }
}
