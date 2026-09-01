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

/** What `captureScript` returns, parsed. */
export interface CaptureResult {
  tick: number;
  camera: { x: number; y: number; zoom: number };
  rect: { x: number; y: number; w: number; h: number };
  dpr: number;
}

export const CAPTURE_VIEWPORT = { width: 1400, height: 900 } as const;

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
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  try {
    await waitForServer(port, 30_000);
  } catch (err) {
    console.error(`[${tag}] dev server output so far:\n${out}`);
    child.kill('SIGTERM');
    throw err;
  }
  return child;
}

/**
 * The mission-only half of boot: `main.ts`'s `showLoading` holds `await
 * loading.done()` (and therefore everything after it, INCLUDING the
 * `window.__lions` assignment) until the deploy button is clicked, but ONLY
 * when a briefing is present (`briefingHoldsDeployment`, `ui/loading.ts`) --
 * true for every mission, never true for a sandbox scenario.
 *
 * The button exists in the DOM the instant `showLoading` runs, but its `click`
 * LISTENER is attached only when `done()` itself executes -- i.e. once the
 * asset gate has already settled. A click before that point lands on a button
 * with no handler and is silently lost. Polling `.rl-loading__count`'s own text
 * until it stops changing is what `showLoading`'s progress bar is FOR, and is
 * exact where a fixed sleep would be a guess.
 */
export async function dismissDeployGate(page: Page): Promise<void> {
  await page.waitForSelector('.rl-loading__deploy', { timeout: 20_000 });
  let last = '';
  for (let i = 0; i < 80; i++) {
    const txt = await page.evaluate(() => document.querySelector('.rl-loading__count')?.textContent ?? '');
    if (txt === last && txt.includes('/')) break;
    last = txt;
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => (document.querySelector('.rl-loading__deploy') as HTMLElement | null)?.click());
}

/** Navigates, boots, steps to the scenario's tick, and screenshots the canvas
 *  rect. Up to 3 attempts: the dev server's module graph has been observed
 *  intermittently failing a dynamically-imported module, resolved only by a
 *  fresh tab -- a fresh `page.goto` here is this script's equivalent. */
export async function capture(
  page: Page,
  url: string,
  script: string,
  outFile: string,
  label: string,
  needsDeploy = false
): Promise<CaptureResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 40_000 });
      if (needsDeploy) await dismissDeployGate(page);
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', {
        timeout: 25_000,
      });
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
    }
  }
  throw new Error(`[${label}] capture failed 3 times: ${(lastErr as Error)?.message ?? String(lastErr)}`);
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
