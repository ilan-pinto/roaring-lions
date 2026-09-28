// The frame driver behind an animated cursor's `data-cursor-frame`.
//
// Extracted from main.ts's `animFrame`/`animTimer`/`stopCursorAnim`/
// `ensureCursorAnim` (Task 4's cursor plugin comment records why a plain JS
// timer, not a CSS `@keyframes` animation, drives the frame index: only the
// timer holds it in the DOM where `cursorKey()` and a test can read it back;
// whether the pointer image itself repaints without a mouse move is unproven
// for either mechanism, and switching buys nothing measured). This module
// keeps that mechanism and adds the two behaviours Task 5 exists for: pause
// under `prefers-reduced-motion`, and pause while the tab is hidden.
//
// No DOM here -- everything the driver touches is behind `CursorAnimDeps`, so
// this module is pure and importable the way `cursor.ts` and `order-sight.ts`
// already are (`vite-plugin-cursors.ts` reads app source this way).
import type { ANIMATED_CURSORS, CursorName } from './cursor';

export interface CursorAnimDeps {
  writeFrame(frame: number): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  reducedMotion(): boolean;
  hidden(): boolean;
}

export interface CursorAnimDriver {
  /** Called every hover tick (~60 Hz). Idempotent; restarts on a name change,
   *  or after a pause when conditions allow. */
  show(name: CursorName): void;
  /** visibilitychange and settings changes: stop now (writing frame 0) or
   *  allow the next show() to resume. */
  refresh(): void;
  dispose(): void;
}

/**
 * `table[name]` gives the frame count and rate; a name absent from it (the
 * large majority of cursor names) is never animated and stops whatever was
 * running.
 *
 * Two conditions gate whether an animated name actually ticks: reduced
 * motion and tab visibility. Both are read once when a name starts (or
 * changes), and reduced motion is then CACHED against that name until
 * `refresh()` invalidates it -- `show()` runs at ~60 Hz and a media-query
 * read has no business happening at that rate. `hidden()` is a plain
 * property read and is cheap enough to re-check on every `show()` while
 * paused, which is what lets the driver resume "on the next show()" once the
 * tab comes back (rather than needing `refresh()` to do the resuming too).
 *
 * The running interval itself does NOT re-check either condition on every
 * tick. That is deliberate, not an oversight: a background tab throttles
 * `setInterval` (to roughly once a second) rather than suspending it the way
 * `requestAnimationFrame` is suspended, so if the tick self-paused on
 * `hidden()` the very first throttled fire while backgrounded would already
 * zero the frame -- indistinguishable from the visibilitychange listener
 * having done its job. The falsification that matters is the other way:
 * pull the `visibilitychange` listener in `main.ts` and the frame is left to
 * advance by whatever the throttled interval manages while hidden, instead
 * of resuming from 0 -- which is exactly the failure `refresh()` exists to
 * prevent.
 */
export function cursorAnimDriver(table: typeof ANIMATED_CURSORS, deps: CursorAnimDeps): CursorAnimDriver {
  let currentName: CursorName | null = null;
  let frame = 0;
  let timer: unknown = null;
  let lastWritten: number | null = null;
  /** `reducedMotion()`'s answer for `currentName`, taken once and held until
   *  `refresh()` clears it or the name changes. */
  let reducedCache: { name: CursorName; value: boolean } | null = null;

  const write = (f: number): void => {
    if (f === lastWritten) return;
    lastWritten = f;
    deps.writeFrame(f);
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      deps.clearInterval(timer);
      timer = null;
    }
  };

  /** Stop the timer, if any, and reset the frame index to the rest pose. */
  const pause = (): void => {
    stopTimer();
    frame = 0;
    write(0);
  };

  const isReduced = (name: CursorName): boolean => {
    if (reducedCache && reducedCache.name === name) return reducedCache.value;
    const value = deps.reducedMotion();
    reducedCache = { name, value };
    return value;
  };

  const pausedFor = (name: CursorName): boolean => isReduced(name) || deps.hidden();

  const startTimer = (anim: { frames: number; intervalMs: number }): void => {
    timer = deps.setInterval(() => {
      frame = (frame + 1) % anim.frames;
      write(frame);
    }, anim.intervalMs);
  };

  return {
    show(name) {
      const anim = table[name];
      if (!anim) {
        if (currentName !== null) {
          currentName = null;
          reducedCache = null;
          pause();
        }
        return;
      }
      if (currentName === name) {
        // Idempotent while running. While paused, re-checking hidden() every
        // tick (isReduced() stays cached) is what lets a returning tab
        // resume here rather than needing refresh() to do it.
        if (timer === null && !pausedFor(name)) startTimer(anim);
        return;
      }
      currentName = name;
      reducedCache = null;
      pause();
      if (!pausedFor(name)) startTimer(anim);
    },
    refresh() {
      if (currentName === null) return;
      reducedCache = null; // force a fresh read below
      if (pausedFor(currentName)) pause();
      // Conditions clearing is left for the next show() to notice -- this
      // only ever stops, never resumes (the interface comment's contract).
    },
    dispose() {
      stopTimer();
    },
  };
}
