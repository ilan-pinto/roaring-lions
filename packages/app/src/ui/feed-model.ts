/**
 * WP-P5 (PA-06): the feed says a repeated thing once, with a count.
 *
 * The audit's capture (play-22) is four identical "under fire" lines
 * stacked over the battlefield: four slots of a four-line feed spent on one
 * fact. Here an identical line arriving while its twin is still recent
 * MERGES into it -- the count goes up, the line goes back to the top and its
 * dwell starts again -- instead of taking a slot of its own.
 *
 * "Identical" is the caller's key: `Hud.note` keys on the rendered markup,
 * the tone and the tier, so two lines that would read the same and look the
 * same are one line. A line that names a different unit or a different
 * place is a different fact, and keeps its own slot.
 *
 * Pure bookkeeping, no DOM and no clock of its own: the time is handed in,
 * which is what lets the merge be tested at exact gaps rather than with
 * timers.
 */

/**
 * How long after its last repeat a line still absorbs an identical one.
 *
 * Longer than `alerts.ts`'s under-fire cooldown (5 s) on purpose: one unit
 * pinned for a minute re-reports every five seconds, and each report must
 * land on the line already saying so rather than stack under it. Shorter
 * than the shortest feed dwell would not matter -- a line that has left the
 * feed is dropped from this model (`drop`) and cannot be merged into.
 */
export const FEED_MERGE_WINDOW_MS = 8000;

export interface FeedLine {
  /** Stable for the line's whole life, so the caller can map it to its DOM
   *  row across merges. */
  readonly id: number;
  readonly key: string;
  /** How many arrivals this one line stands for. */
  count: number;
  /** When the most recent of them arrived. */
  lastMs: number;
}

export type FeedPush = { kind: 'new'; line: FeedLine } | { kind: 'merged'; line: FeedLine };

export class FeedModel {
  private readonly byKey = new Map<string, FeedLine>();
  private nextId = 1;

  /** One line arrives. Merges into a live line with the same key whose last
   *  repeat is within the window; otherwise opens a new line. */
  push(key: string, nowMs: number): FeedPush {
    const live = this.byKey.get(key);
    if (live && nowMs - live.lastMs <= FEED_MERGE_WINDOW_MS) {
      live.count += 1;
      live.lastMs = nowMs;
      return { kind: 'merged', line: live };
    }
    const line: FeedLine = { id: this.nextId++, key, count: 1, lastMs: nowMs };
    this.byKey.set(key, line);
    return { kind: 'new', line };
  }

  /** The line left the feed -- its dwell ran out, or newer lines pushed it
   *  off the end -- so nothing can merge into it any more. A no-op for an id
   *  already gone, or one a newer line with the same key has replaced. */
  drop(id: number): void {
    for (const [key, line] of this.byKey) {
      if (line.id === id) {
        this.byKey.delete(key);
        return;
      }
    }
  }
}
