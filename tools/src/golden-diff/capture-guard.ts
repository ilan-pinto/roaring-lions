// The two things a capture run has to survive, extracted here so a test can
// reach them WITHOUT booting a browser. Both cost a real CI run
// (`visual-baseline-bless` 33591712714, 2026-09-02), and neither lived
// anywhere a test could exercise -- which is the shape of that bug more than
// any individual line was.
//
// Nothing here imports `playwright` at runtime. `browser.ts` does (it
// constructs a real Chromium), and `pnpm test` must not pay for that just to
// check the two decisions below -- the same reason `capture-protocol.ts`
// holds `CAPTURE_VIEWPORT` rather than `browser.ts`.
//
// ============================================================================
// 1. A report-only scenario must not be able to abort the run
// ============================================================================
//
// `combat` is captured, reported, and DOES NOT VOTE: two captures of the same
// commit differ by 969-3847 px / 0.19-0.36 there while the defect this gate
// exists to catch reads 3231 px / 0.6006, so no honest threshold sits between
// them (`baseline.ts`'s `BASELINES.combat`). It cannot fail the gate on
// appearance -- and yet, on the first Linux bless, it failed to CAPTURE and
// took the whole run down with it: four gated baselines had already been
// written to disk, the manifest that makes them usable had not, and the step
// that opens the review PR never ran. A scenario with no vote threw away the
// work of four that have one.
//
// So a capture failure is fatal exactly when the scenario is GATED. That is
// deliberately the same predicate as `isGated` and is read from the scenario
// table rather than special-cased by id: a second report-only scenario, or
// `combat` being promoted to gated, moves this on its own. The inverse
// mistake -- swallowing a GATED capture failure -- would turn the gate back
// into the no-op the three-vs-three rebuild exists to end, so `guardCapture`
// rethrows there rather than recording a soft failure.
//
// ============================================================================
// 2. The deploy gate cannot be dismissed by guessing when the button is live
// ============================================================================
//
// Only a MISSION scenario has one (`briefingHoldsDeployment`, `ui/loading.ts`
// -- a sandbox has no briefing and never holds), which is why `combat` is the
// only scenario that hits this path at all.
//
// `main.ts` holds `await loading.done()`, and everything after it INCLUDING
// the `window.__lions` assignment, until the deploy button is clicked. The
// button is in the DOM from the instant `showLoading` runs, but its `click`
// LISTENER is attached inside `done()` itself -- i.e. only once the art gate
// has already settled. A click before that lands on a button with no handler
// and is silently lost, forever: `done()`'s promise has no other resolver
// that a synthetic `.click()` can reach (`window`'s `pointerdown` listener
// does not fire for `HTMLElement.click()`, and the `keydown` one needs a real
// Escape).
//
// The previous version guessed the moment by polling `.rl-loading__count`
// until its text stopped changing. That is a proxy for "loading finished",
// and it is FALSE at the start of loading too: `loading.total(n)` paints
// "0 / 45 sheets" and it stays exactly that until the first sheet resolves.
// On a warm macOS cache the first sheet lands inside the 250 ms poll interval
// and the guess happens to hold. On the ubuntu-latest runner it did not --
// measured, the whole dismissal took ~1.5 s of a 31.7 s attempt and the
// remaining 30 s was `waitForFunction` waiting for a `__lions` that could
// never be assigned, three times over.
//
// This version stops guessing. It clicks on every poll until the loading
// screen is actually GONE from the DOM, which is the only observable that
// means the handler ran (`dismiss()` calls `wrap.remove()` synchronously).
// Extra clicks before that are free -- they land on a button with no handler,
// which is precisely the failure being worked around -- and `dismiss()` is
// idempotent behind its own `gone` flag, so a click that races the removal is
// harmless too. The returned click COUNT is the diagnostic that was missing:
// 1 means the first click was live, N means N-1 were swallowed.

/** The slice of Playwright's `Page` the deploy gate actually uses. Structural
 *  on purpose -- it is what lets `capture-guard.test.ts` drive this with a
 *  stub page and no browser at all. */
export interface DeployGatePage {
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<R>(pageFunction: () => R): Promise<R>;
  waitForTimeout(timeout: number): Promise<void>;
}

export interface DeployGateOptions {
  /** How long to wait for the button to exist at all. */
  selectorTimeoutMs?: number;
  /** How long to keep clicking before declaring the boot stuck. Generous
   *  because it covers the whole art gate on a cold module graph, and being
   *  wrong in this direction costs seconds while being wrong the other way
   *  costs the run. */
  timeoutMs?: number;
  /** Poll/click interval. */
  intervalMs?: number;
  log?: (line: string) => void;
}

export interface DeployGateResult {
  /** How many clicks it took. 1 = the first was live; N > 1 = N-1 were
   *  swallowed by a button whose handler was not attached yet. */
  clicks: number;
  elapsedMs: number;
}

/** What runs inside the page on every poll: click the deploy button if it is
 *  there, then report whether the loading screen has gone. Declared here
 *  rather than inline so the stub in the test and the browser run the same
 *  contract. */
export const DEPLOY_GATE_POLL = (): { present: boolean; gone: boolean } => {
  const btn = document.querySelector('.rl-loading__deploy') as HTMLElement | null;
  if (btn !== null) btn.click();
  return { present: btn !== null, gone: document.querySelector('.rl-loading') === null };
};

export async function dismissDeployGate(
  page: DeployGatePage,
  label = 'capture',
  opts: DeployGateOptions = {}
): Promise<DeployGateResult> {
  const selectorTimeoutMs = opts.selectorTimeoutMs ?? 20_000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 250;
  const log = opts.log ?? ((line: string) => console.log(line));

  const started = Date.now();
  await page.waitForSelector('.rl-loading__deploy', { timeout: selectorTimeoutMs });

  let clicks = 0;
  for (;;) {
    const state = await page.evaluate(DEPLOY_GATE_POLL);
    if (state.present) clicks += 1;
    if (state.gone) {
      const elapsedMs = Date.now() - started;
      log(
        `[${label}] deploy gate cleared after ${elapsedMs} ms and ${clicks} click(s)` +
          `${clicks > 1 ? ` -- ${clicks - 1} landed before the handler was attached and were lost` : ''}`
      );
      return { clicks, elapsedMs };
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `[${label}] the deploy gate was still up after ${Date.now() - started} ms and ${clicks} click(s). ` +
          'The loading screen never removed itself, so `main.ts` never got past `await loading.done()` ' +
          'and `window.__lions` was never assigned. Either the art gate is still waiting on a fetch ' +
          'that will not settle, or the button lost its handler.'
      );
    }
    await page.waitForTimeout(intervalMs);
  }
}

/** The outcome of one guarded capture. `ok: false` is only ever reachable for
 *  a scenario that cannot vote -- a gated failure throws instead. */
export type GuardedCapture<T> = { ok: true; value: T } | { ok: false; error: Error };

/**
 * Run one scenario's capture, and decide what its failure means.
 *
 * GATED: rethrow. A gated scenario that cannot be captured is a run that
 * cannot judge what it exists to judge, and continuing past it would be the
 * green-ticking no-op this gate replaced.
 *
 * REPORT-ONLY: warn as loudly as the medium allows and carry on, so the
 * scenarios that DO vote still finish and, in a bless, still get written.
 */
export async function guardCapture<T>(
  gated: boolean,
  label: string,
  run: () => Promise<T>,
  warn: (line: string) => void = (line) => console.error(line)
): Promise<GuardedCapture<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (gated) throw err;
    const error = err instanceof Error ? err : new Error(String(err));
    warn(
      `\n[${label}] CAPTURE FAILED, and this scenario is REPORT-ONLY, so the run continues:\n` +
        `[${label}]   ${error.message}\n` +
        `[${label}] Nothing was compared or blessed for it -- a report-only scenario never is. ` +
        'What is lost is its frame, which is the one a triager reads. Fix it.'
    );
    if (process.env.GITHUB_ACTIONS === 'true') {
      warn(`::warning title=Report-only capture failed::${label} could not be captured: ${error.message}`);
    }
    return { ok: false, error };
  }
}
