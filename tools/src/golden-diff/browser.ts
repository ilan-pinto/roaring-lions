// The browser-driving half of the golden-image harness, shared by both gates:
// `ci/three-baseline-gate.ts` (the pass/fail gate) and `ci/golden-diff-gate.ts`
// (the cross-backend diagnostic). Extracted when the second gate arrived --
// every function here was already written once inside the first one, and a
// capture protocol that drifts between two callers is a way to compare two
// pictures that were never taken the same way.
//
// Nothing here decides anything. It boots a dev server if one is not already
// answering, drives a page through this app's own boot sequence, and hands back
// a PNG plus the camera/tick state the capture was taken at.

import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { FREEZE_FRAME_LOOP_SCRIPT } from './capture-protocol';
import { dismissDeployGate } from './capture-guard';

// Re-exported for every existing importer: the logic moved to `capture-guard.ts`
// so a test can drive it with a stub page, but this is still where a
// browser-driving caller expects to find it.
export { dismissDeployGate } from './capture-guard';

// Re-exported, not declared here any more: the viewport is part of "what counts
// as an identical scenario", so it belongs beside the rest of the protocol in a
// module with no dependencies -- `baseline.test.ts` reads it to check
// `RELIEF_SCENARIO`'s framing in `pnpm test`, and importing THIS file for it
// would pull playwright into the unit-test run. Every existing importer keeps
// working unchanged.
export { CAPTURE_VIEWPORT } from './capture-protocol';

/** What `captureScript` returns, parsed. */
export interface CaptureResult {
  tick: number;
  camera: { x: number; y: number; zoom: number };
  rect: { x: number; y: number; w: number; h: number };
  dpr: number;
}

export async function isServerUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`golden-diff: dev server on port ${port} did not come up within ${timeoutMs}ms`);
}

/** Starts a dedicated dev server for this run UNLESS one is already answering on
 *  `port`, in which case it is reused, never managed: this repo's hard rule is to
 *  never kill a `pnpm dev` this process did not start, and "already up" is exactly
 *  the ambiguous case where the safe move is to leave it alone. Returns the child
 *  process to tear down at the end, or `null` if an existing server was reused
 *  (and therefore must not be touched). */
export async function ensureDevServer(port: number, repoRoot: string, tag: string): Promise<ChildProcess | null> {
  if (await isServerUp(port)) {
    console.log(`[${tag}] reusing dev server already listening on :${port} (not managed, will not be killed)`);
    return null;
  }
  console.log(`[${tag}] starting a dev server on :${port}...`);
  const child = spawn('pnpm', ['--filter', '@lions/app', 'dev'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process GROUP, which is the whole point -- see `stopDevServer`.
    // `pnpm` is a wrapper: it forks a shell, which forks another node, which
    // forks vite, which forks esbuild. Signalling the pid we hold reaches the
    // first of those and none of the rest.
    detached: true,
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  try {
    await waitForServer(port, 30_000);
  } catch (err) {
    console.error(`[${tag}] dev server output so far:\n${out}`);
    stopDevServer(child, tag);
    throw err;
  }
  return child;
}

/**
 * Tear down a dev server THIS process started, and release its handles.
 *
 * The 40-minute half of `visual-baseline-bless` run 33591712714. The script
 * threw at 04:43:50, logged the error, ran its `finally`, and then sat there
 * until it was cancelled at 05:23 -- a 3-minute failure billed as 43 minutes
 * of runner time, which is why it read as a hang rather than an error.
 *
 * `child.kill('SIGTERM')` signals only the `pnpm` wrapper. The runner's own
 * epilogue names what survived it, and it is a whole tree:
 *
 *   Terminate orphan process: pid (3174) (node)   <- pnpm
 *   Terminate orphan process: pid (3191) (sh)
 *   Terminate orphan process: pid (3192) (node)
 *   Terminate orphan process: pid (3209) (sh)
 *   Terminate orphan process: pid (3210) (node)
 *   Terminate orphan process: pid (3226) (node)   <- vite
 *   Terminate orphan process: pid (3234) (esbuild)
 *   Terminate orphan process: pid (3265) (node)
 *   Terminate orphan process: pid (3278) (esbuild)
 *
 * Those grandchildren inherited the stdout/stderr PIPES this function's caller
 * created, so their write ends stayed open, so the `data` listeners above
 * stayed subscribed to a socket that could never emit `end` -- an active libuv
 * handle, an event loop that can never drain, and a node process that never
 * exits. On macOS `pnpm` happens to forward the signal and the same code exits
 * in 10.9 s; the behaviour is the platform's, not the script's, which is
 * exactly why it was never seen locally.
 *
 * Negative pid = the process GROUP (`detached: true` above is what creates
 * one). Destroying the pipes afterwards is belt and braces: it drops this
 * side's handle even if something in the group outlives the signal.
 */
export function stopDevServer(child: ChildProcess | null, tag: string): void {
  if (child === null) return; // reused someone else's server -- never ours to kill
  const pid = child.pid;
  if (pid !== undefined) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Already gone, or no group (a platform without one). Fall back to the
      // single pid rather than leaving it running.
      try {
        child.kill('SIGTERM');
      } catch {
        /* already dead */
      }
    }
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
  console.log(`[${tag}] dev server process group stopped.`);
}

/** Navigates, boots, steps to the scenario's tick, and screenshots the canvas
 *  rect. Up to 3 attempts: the dev server's module graph has been observed
 *  intermittently failing a dynamically-imported module, resolved only by a
 *  fresh tab -- a fresh `page.goto` here is this script's equivalent.
 *
 *  Page errors are collected and printed with a failed attempt. Without them
 *  the only thing a failure can say is "something timed out", which is what
 *  the first Linux bless said three times over while the real answer was a
 *  click landing on a button whose handler did not exist yet. A timeout is
 *  never a diagnosis. */
export async function capture(
  page: Page,
  url: string,
  script: string,
  outFile: string,
  label: string,
  needsDeploy = false
): Promise<CaptureResult> {
  const pageErrors: string[] = [];
  const onPageError = (err: Error): void => void pageErrors.push(`pageerror: ${err.message}`);
  const onConsole = (msg: { type: () => string; text: () => string }): void => {
    if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  try {
    return await captureAttempts(page, url, script, outFile, label, needsDeploy, pageErrors);
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

async function captureAttempts(
  page: Page,
  url: string,
  script: string,
  outFile: string,
  label: string,
  needsDeploy: boolean,
  pageErrors: string[]
): Promise<CaptureResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    pageErrors.length = 0;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 40_000 });
      if (needsDeploy) await dismissDeployGate(page, label);
      // The options bag is the THIRD argument -- the second is `arg`, the
      // value handed to the page function. Passed as the second, `{ timeout:
      // 25_000 }` was serialised into the page as an unused argument and the
      // wait silently ran on Playwright's 30 s default, which is why the first
      // Linux bless reported "Timeout 30000ms exceeded" from a call site that
      // reads 25000.
      await page.waitForFunction(
        () => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined',
        undefined,
        { timeout: 25_000 }
      );
      // Stop the app's rAF loop FIRST, before the settle rather than after it.
      // Two things follow, and both were measured (see
      // `FREEZE_FRAME_LOOP_STATEMENTS`): the settle below no longer accrues
      // sim ticks, so `targetTick`'s `step(target - current)` starts from a
      // repeatable place instead of from wherever ~1s of real time landed;
      // and the continuous VFX that `vehicle` exists to look at stop
      // accumulating wall-clock time during it. The settle itself still does
      // its job -- fonts, module graph, lazily-arriving GLBs are all promise
      // and network work, none of it driven by rAF, and `main.ts` paints one
      // real frame (GH-141) before the loop is ever armed.
      await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
      // capture-protocol.ts's documented settle: await font load + a 1s settle
      // before stepping -- a first run read 6.5x noisier without it.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1000);
      const raw = await page.evaluate(script);
      const result = JSON.parse(raw as string) as CaptureResult;
      await page.screenshot({
        path: outFile,
        clip: { x: result.rect.x, y: result.rect.y, width: result.rect.w, height: result.rect.h },
      });
      return result;
    } catch (err) {
      lastErr = err;
      console.warn(`[${label}] capture attempt ${attempt + 1} failed: ${(err as Error).message}`);
      for (const line of pageErrors.slice(0, 10)) console.warn(`[${label}]   page said: ${line}`);
      if (pageErrors.length === 0) console.warn(`[${label}]   the page reported no errors of its own.`);
    }
  }
  throw new Error(
    `[${label}] capture failed 3 times: ${(lastErr as Error)?.message ?? String(lastErr)}` +
      (pageErrors.length > 0 ? ` (last attempt's page errors: ${pageErrors.slice(0, 3).join(' | ')})` : '')
  );
}

/** Reads `WEBGL_debug_renderer_info`'s unmasked renderer string from a throwaway
 *  page. This is the whole reason `baseline.ts` can key a stored baseline on the
 *  capture environment rather than hoping one is portable: without it, a run on
 *  hardware ANGLE/Metal and a run on software SwiftShader are indistinguishable
 *  to the gate and differ by up to 100x the run-to-run noise on screen.
 *  `docs/PERFORMANCE.md` records the same read costing one full mismeasurement
 *  when it was NOT done. */
export async function readUnmaskedRenderer(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto('about:blank');
    return await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
      if (!gl) return 'no-webgl';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no-debug-renderer-info';
    });
  } finally {
    await page.close();
  }
}

/** Headless Chromium with no GL arguments, which is a DELIBERATE choice rather
 *  than a default left unexamined: with none, Chromium renders WebGL through
 *  SwiftShader, and SwiftShader is a pure-CPU rasteriser that reproduces itself
 *  exactly. Passing `--use-angle=metal` (what `perf/backend-curve-gate.ts` does,
 *  correctly, because it measures SPEED and a player never runs on SwiftShader)
 *  would put this gate on a path whose output depends on the host GPU. Measured
 *  on one machine, the same commit read 230 differing pixels / 0.0320
 *  meanAbsChannelDelta between the two backends on `quiet` alone -- 100x that
 *  scenario's run-to-run noise. Speed wants the GPU; reproducibility wants the
 *  CPU. This gate wants reproducibility. */
export async function launchCaptureBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}
