// A freeze/restore pair for shoot.ts's own two outcome-moment screenshots
// (25-outcome-defeat, 24-outcome-victory) ONLY -- see shoot.ts's call sites
// for the full account of the defect this closes.
//
// NOT `FREEZE_FRAME_LOOP_STATEMENTS` (`../golden-diff/capture-protocol.ts`),
// and deliberately a separate module rather than an extension of it, for two
// independent reasons found empirically against this exact page (harness:
// `/private/tmp/.../scratchpad/ep/outcomeshots/outcome-freeze-probe.ts` and
// `victory-probe.ts`).
//
// REASON 1 -- Playwright's own polling needs a real frame too. The golden
// gate's freeze is ONE-WAY: it never calls another Playwright locator wait on
// the same page afterwards (it evaluates its own capture script and
// screenshots directly), so it never needs `requestAnimationFrame` handed
// back. shoot.ts does -- `.rl-outcome__skip`'s click and the
// `.rl-endnav`/`.rl-debrief` waits that follow the outcome screenshot are
// exactly the Playwright convenience methods (`page.click`/
// `page.waitForSelector`) a one-way freeze would have to survive, and it does
// not: freezing right after `debugKill`+`step(40)` and then calling
// `waitForSelector` for `.rl-outcome` -- an element `.count()` on the very
// same page confirmed was already present -- hung for the FULL 15s timeout,
// every time, load-independent (reproduced at load 5.7-26.6 and at load 83+
// alike). Playwright's own actionability polling for
// `waitForSelector`/`click` samples an element across real animation frames
// to confirm it is not still moving, and a page-wide
// `window.requestAnimationFrame` stubbed to a no-op starves that polling
// exactly the way it starves the app's own `loop()`.
//
// So `FREEZE_FOR_SCREENSHOT_SCRIPT` is scoped tighter than the golden gate's:
// meant to run only AFTER `waitForSelector` has already confirmed the moment
// is present (so the wait itself runs on a real, working rAF), and its
// matching `RESTORE_AFTER_SCREENSHOT_SCRIPT` hands the exact same
// `requestAnimationFrame` back before anything else on the page asks
// Playwright to wait for or act on an element again. The original function
// is stashed on `window` under a name of its own -- not
// `capture-protocol.ts`'s `__lionsCaptureFrozen`, which never stores one and
// is not meant to be shared with this file -- and NOT `.bind(window)` (which
// returns a new wrapper on every call and would make the restore hand back a
// look-alike rather than the identical original -- caught by this file's own
// test, which is why the round-trip identity check exists rather than only a
// "does it stub" check).
//
// REASON 2 -- a plain synchronous stub does not, on its own, make the
// screenshot fast. `FREEZE_FRAME_LOOP_STATEMENTS` awaits two real animation
// frames as part of freezing, and that await is not just belt-and-braces:
// measured directly (`outcome-freeze-probe.ts`), a synchronous stub with NO
// wait left `page.screenshot()` costing 5.1-5.9s even with the loop frozen,
// barely better than the 5.0-7.8s it cost unfrozen. The reason is that
// stubbing `requestAnimationFrame` does not cancel a frame the browser has
// ALREADY scheduled via the real one (registered before the stub took
// effect) -- one more expensive frame, from a combat-heavy scene rendered
// through SwiftShader, still lands, and if nothing awaits it, it lands
// DURING the screenshot call instead of before it, so the screenshot pays
// for it directly. Awaiting two real frames here pays that one-time cost
// during the freeze -- which happens moments after the outcome moment
// appears, so the 2600ms hold has barely been touched -- so that by the time
// the screenshot runs, there is no pending GL work left to flush and the
// readback is fast (measured under real hardware GPU: ~100-200ms; the
// SwiftShader improvement from this alone still was not enough on its own,
// which is why shoot.ts's own comment records both this AND the freeze-
// before-settle fix for the victory plan below).
//
// Async by necessity (must run inside an async page.evaluate), unlike a
// plain synchronous stub would be -- see FREEZE_FRAME_LOOP_STATEMENTS's own
// header for why two frames specifically, not one: the loop's own pending
// callback fires on the first, and only on re-arming (attempting the now-
// stubbed `requestAnimationFrame`) does the loop actually stop, so the
// second await confirms it has.
const FROZEN_RAF_KEY = '__uiShotsFrozenRaf';

/** Idempotent: a second freeze before a restore is a no-op, so the ORIGINAL
 *  `requestAnimationFrame` is never overwritten by an already-stubbed one. */
export const FREEZE_FOR_SCREENSHOT_SCRIPT = `(async () => {
  if (window.${FROZEN_RAF_KEY}) return;
  const _raf = window.requestAnimationFrame;
  window.${FROZEN_RAF_KEY} = _raf;
  window.requestAnimationFrame = () => 0;
  await new Promise((resolve) => { _raf.call(window, () => { _raf.call(window, () => resolve(null)); }); });
})()`;

/** Idempotent the other way: restoring twice, or restoring when nothing was
 *  ever frozen, leaves `requestAnimationFrame` exactly as it already was
 *  rather than clobbering it with `undefined`. Synchronous -- nothing to
 *  wait for on the way back in. */
export const RESTORE_AFTER_SCREENSHOT_SCRIPT = `(() => {
  if (!window.${FROZEN_RAF_KEY}) return;
  window.requestAnimationFrame = window.${FROZEN_RAF_KEY};
  window.${FROZEN_RAF_KEY} = undefined;
})()`;
