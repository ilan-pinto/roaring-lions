// The frame driver, tested with fake timers and injected dependencies --
// node environment, no DOM (cursor-anim.ts touches none).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cursorAnimDriver, type CursorAnimDeps } from './cursor-anim';
import type { ANIMATED_CURSORS, CursorName } from './cursor';

const TABLE: Partial<typeof ANIMATED_CURSORS> = {
  advance: { frames: 4, intervalMs: 200 },
  move: { frames: 4, intervalMs: 300 },
};

function deps(over: Partial<{ reduced: boolean; hidden: boolean }> = {}): CursorAnimDeps & {
  frames: number[];
  setReduced(v: boolean): void;
  setHidden(v: boolean): void;
  reducedCalls: number;
} {
  let reduced = over.reduced ?? false;
  let hidden = over.hidden ?? false;
  const frames: number[] = [];
  let reducedCalls = 0;
  return {
    writeFrame: (f) => frames.push(f),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    reducedMotion: () => {
      reducedCalls++;
      return reduced;
    },
    hidden: () => hidden,
    frames,
    setReduced: (v) => (reduced = v),
    setHidden: (v) => (hidden = v),
    get reducedCalls() {
      return reducedCalls;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cursorAnimDriver', () => {
  it('writes 0 then advances at intervalMs and wraps', () => {
    const d = deps();
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('advance' as CursorName);
    expect(d.frames).toEqual([0]);
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200); // wraps back to 0
    expect(d.frames).toEqual([0, 1, 2, 3, 0]);
  });

  it('does not restart the cycle on a repeated show() of the same name', () => {
    const d = deps();
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('advance' as CursorName);
    vi.advanceTimersByTime(200); // frame 1
    driver.show('advance' as CursorName);
    driver.show('advance' as CursorName);
    vi.advanceTimersByTime(200); // frame 2, not reset to 1 again
    expect(d.frames).toEqual([0, 1, 2]);
  });

  it('stops the timer for a name that is not animated', () => {
    const d = deps();
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('advance' as CursorName);
    vi.advanceTimersByTime(200); // frame 1
    driver.show('blocked' as CursorName);
    expect(d.frames).toEqual([0, 1, 0]);
    vi.advanceTimersByTime(1000);
    expect(d.frames).toEqual([0, 1, 0]); // nothing further fires
  });

  it('resets to 0 on a name change', () => {
    const d = deps();
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('advance' as CursorName);
    vi.advanceTimersByTime(200); // frame 1
    driver.show('move' as CursorName);
    expect(d.frames).toEqual([0, 1, 0]);
  });

  it('under reduced motion, writes 0 and never starts an interval', () => {
    const d = deps({ reduced: true });
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('move' as CursorName);
    expect(d.frames).toEqual([0]);
    vi.advanceTimersByTime(5000);
    expect(d.frames).toEqual([0]); // still just the one write -- no timer ever ran
  });

  it('hiding then refresh() stops the timer and writes 0; showing again resumes from 0', () => {
    const d = deps();
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('advance' as CursorName);
    vi.advanceTimersByTime(200); // frame 1
    vi.advanceTimersByTime(200); // frame 2
    d.setHidden(true);
    driver.refresh();
    expect(d.frames).toEqual([0, 1, 2, 0]);
    vi.advanceTimersByTime(1000); // the old timer is gone; nothing ticks
    expect(d.frames).toEqual([0, 1, 2, 0]);
    d.setHidden(false);
    driver.show('advance' as CursorName); // resumes from 0 on the next show()
    expect(d.frames).toEqual([0, 1, 2, 0]); // frame already 0 -- no redundant write
    vi.advanceTimersByTime(200);
    expect(d.frames).toEqual([0, 1, 2, 0, 1]);
  });

  it('dispose() clears the timer', () => {
    const d = deps();
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('advance' as CursorName);
    driver.dispose();
    vi.advanceTimersByTime(1000);
    expect(d.frames).toEqual([0]); // nothing further fires after dispose
  });

  it('writes nothing for a no-op show() beyond the single 0 written on stop', () => {
    const d = deps();
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    // Never animated anything -- show()ing a non-animated name repeatedly
    // must not write at all.
    driver.show('blocked' as CursorName);
    driver.show('blocked' as CursorName);
    expect(d.frames).toEqual([]);
    // Now stop a running animation: exactly one 0 is written for the stop,
    // not one for every subsequent show() of the same non-animated name.
    driver.show('advance' as CursorName);
    vi.advanceTimersByTime(200);
    driver.show('blocked' as CursorName);
    driver.show('blocked' as CursorName);
    driver.show('costly' as CursorName);
    expect(d.frames).toEqual([0, 1, 0]);
  });

  it('reads reducedMotion() at most once per name change while paused, not on every show()', () => {
    const d = deps({ reduced: true, hidden: false });
    const driver = cursorAnimDriver(TABLE as typeof ANIMATED_CURSORS, d);
    driver.show('move' as CursorName);
    driver.show('move' as CursorName);
    driver.show('move' as CursorName);
    expect(d.reducedCalls).toBe(1);
    driver.refresh();
    driver.show('move' as CursorName);
    expect(d.reducedCalls).toBe(2);
  });
});
