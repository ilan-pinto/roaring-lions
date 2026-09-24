// frame-freeze.ts ships two strings meant for `page.evaluate`, not two
// functions -- but they only ever reference the bare identifier `window`, so
// `new Function('window', 'return ' + script)` runs the exact production
// text against a plain mock object with no browser at all. That is the whole
// point: this test exercises the SAME bytes shoot.ts sends into the page.
//
// Two defects this guards against (see frame-freeze.ts's header for the full
// account, measured against a real page in
// outcome-freeze-probe.ts/victory-probe.ts):
//
// 1. A ONE-WAY freeze -- stub `requestAnimationFrame`, never hand the real
//    one back -- left Playwright's own `waitForSelector`/`click` polling
//    starved for a real animation frame on the very next call, hanging for a
//    full 15s timeout even though the element it was waiting for already
//    existed. A test that only checked "the stub returns 0" would have
//    passed on that broken one-way version too, so the case that matters is
//    the ROUND TRIP: freeze, then restore, must hand back the IDENTICAL
//    original function, not a second stub and not `undefined`.
// 2. A SYNCHRONOUS stub (no await) left `page.screenshot()` almost as slow
//    frozen as unfrozen (5.1-5.9s vs 5.0-7.8s) -- stubbing
//    `requestAnimationFrame` does not cancel a frame the browser already
//    scheduled via the real one, so that one frame's cost still lands, just
//    later. The freeze must therefore actually CALL the real
//    `requestAnimationFrame` (twice -- see frame-freeze.ts's header for why
//    two) and wait for it before returning, which is why this suite awaits
//    the freeze rather than treating it as instant.
import { describe, expect, it, vi } from 'vitest';
import { FREEZE_FOR_SCREENSHOT_SCRIPT, RESTORE_AFTER_SCREENSHOT_SCRIPT } from './frame-freeze';

function mockWindow(raf: (cb: FrameRequestCallback) => number): { requestAnimationFrame: unknown } {
  return { requestAnimationFrame: raf };
}

/** Runs a frame-freeze.ts script against a mock `window`, returning whatever
 *  it completes with (a Promise for the async freeze, `undefined` for the
 *  synchronous restore) so a caller can `await` either uniformly. */
function run(script: string, w: unknown): Promise<unknown> {
  return Promise.resolve(new Function('window', `return ${script}`)(w));
}

/** A `requestAnimationFrame` stand-in that invokes its callback on the spot,
 *  the same shape jsdom/real browsers use for a callback scheduled with
 *  nothing else pending -- lets the freeze's own two-frame await resolve
 *  without a real event loop tick. */
function immediateRaf(): ReturnType<typeof vi.fn> {
  return vi.fn((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
}

describe('FREEZE_FOR_SCREENSHOT_SCRIPT / RESTORE_AFTER_SCREENSHOT_SCRIPT', () => {
  it('stubs requestAnimationFrame to a no-op once frozen, after riding out two real frames', async () => {
    const realRaf = immediateRaf();
    const w = mockWindow(realRaf);
    await run(FREEZE_FOR_SCREENSHOT_SCRIPT, w);
    // The freeze must actually USE the real raf (twice) rather than just
    // discard it -- a version that stubs without waiting passes every other
    // check in this file but reproduces the slow-screenshot regression.
    expect(realRaf).toHaveBeenCalledTimes(2);
    const cb = vi.fn();
    const ret = (w.requestAnimationFrame as (cb: FrameRequestCallback) => number)(cb);
    expect(ret).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it('restore hands back the IDENTICAL original function, not a second stub', async () => {
    const realRaf = immediateRaf();
    const w = mockWindow(realRaf);
    await run(FREEZE_FOR_SCREENSHOT_SCRIPT, w);
    expect(w.requestAnimationFrame).not.toBe(realRaf);
    await run(RESTORE_AFTER_SCREENSHOT_SCRIPT, w);
    // The round trip a naive one-way freeze (the bug this file exists to fix)
    // cannot pass: that version has no restore at all, so this identity check
    // is the recorded red -- deleting the stash line in frame-freeze.ts (or
    // reverting to golden-diff's one-way FREEZE_FRAME_LOOP_SCRIPT) fails
    // exactly here, not at the stub check above.
    expect(w.requestAnimationFrame).toBe(realRaf);
  });

  it('restore actually re-enables real animation frames (the Playwright-hang regression)', async () => {
    const realRaf = immediateRaf();
    const w = mockWindow(realRaf);
    await run(FREEZE_FOR_SCREENSHOT_SCRIPT, w);
    await run(RESTORE_AFTER_SCREENSHOT_SCRIPT, w);
    const cb = vi.fn();
    (w.requestAnimationFrame as (cb: FrameRequestCallback) => number)(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('freeze is idempotent: a second freeze before a restore keeps the FIRST original', async () => {
    const realRaf = immediateRaf();
    const w = mockWindow(realRaf);
    await run(FREEZE_FOR_SCREENSHOT_SCRIPT, w);
    await run(FREEZE_FOR_SCREENSHOT_SCRIPT, w); // must not stash the already-stubbed function
    await run(RESTORE_AFTER_SCREENSHOT_SCRIPT, w);
    expect(w.requestAnimationFrame).toBe(realRaf);
    // Only the FIRST freeze should have ridden out two real frames -- the
    // second, idempotent call returns immediately without touching the
    // (already-stubbed) requestAnimationFrame at all.
    expect(realRaf).toHaveBeenCalledTimes(2);
  });

  it('restore without a prior freeze is a harmless no-op', async () => {
    const realRaf = immediateRaf();
    const w = mockWindow(realRaf);
    await run(RESTORE_AFTER_SCREENSHOT_SCRIPT, w);
    expect(w.requestAnimationFrame).toBe(realRaf);
  });
});
