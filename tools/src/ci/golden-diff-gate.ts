// CI wiring for tools/src/golden-diff/ -- the same "manual script, not in CI" gap
// CLAUDE.md records for playtest.ts, and the one d-golden-diff-report.md's own
// Concerns section names explicitly: "capture cannot be scripted end-to-end without
// a browser-automation surface... doing so would need Playwright/Puppeteer driving a
// real Chromium with a real or software GL context."
//
// This file IS that automation. It does NOT touch tools/src/golden-diff/** (owned
// by a parallel stream extending the harness itself) -- it only imports the frozen
// capture protocol (capture-protocol.ts) and the pure diff function (diff.ts) the
// exact way a human running the manual protocol already does, and adds the
// browser-driving + pass/fail-gate layer around them. tools/src/perf/three-units.ts
// hit the identical "needs a real browser" wall for render cost and, per its own top
// comment, deliberately did NOT solve it -- this file is the solve, scoped to the
// one thing that can be gated headlessly: pixel comparison, not manual visual
// judgement.
//
// Cost of wiring this in: one new devDependency (`playwright`, tools/package.json)
// plus a one-time `playwright install chromium` (~270 MB, cached across CI runs by
// actions/cache the same way node_modules already is) plus the wall-clock cost of
// booting a real Vite dev server and two real (headless, software-rendered) WebGL
// contexts per run -- multiple seconds to tens of seconds, not playtest.ts's ~3s.
// That is why this is its own workflow (.github/workflows/golden-diff.yml), gated by
// schedule/label/manual dispatch rather than every push -- see that file's header.
//
// Scenario: reuses the ONLY scenario this harness has actually measured --
// capture-protocol.ts's SANDBOX_MAP/CAMERA_MARKER/CAPTURE_TICKS, matching
// .superpowers/d-golden-diff-report.md. It is a quiet (no-combat) scan: five of the
// eight entries in expected-differences.ts are documented but not exercised by it.
// A parallel stream is measuring a combat scenario separately; this gate's
// thresholds below are calibrated ONLY against the quiet-scenario baseline and
// should be revisited (or a second scenario added as its own job) once that lands.
//
// Usage: npx tsx tools/src/ci/golden-diff-gate.ts [--port=5174] [--out-dir=path] [--keep-server]

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { pixiUrl, threeUrl, CAPTURE_SCRIPT, CAPTURE_TICKS, SANDBOX_MAP, CAMERA_MARKER } from '../golden-diff/capture-protocol';
import { computeDiff, formatSummary } from '../golden-diff/diff';
import { EXPECTED_DIFFERENCES, formatExpectedDifferences } from '../golden-diff/expected-differences';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Measured once, by hand, via claude-in-chrome, on a GPU-accelerated real Chrome,
 *  against beit_sahwan_outskirts at tick 100 (.superpowers/d-golden-diff-report.md's
 *  "Run 2 (clean)"): 0.128% differing pixels, mean |channel delta| 1.03/255, entirely
 *  edge-shaped (antialiasing). Headless Chromium here renders via a SOFTWARE GL path
 *  (SwiftShader/ANGLE), not real hardware AA, so its numbers on the identical
 *  scenario are not guaranteed to match that hand-measured baseline exactly -- the
 *  same "not interchangeable" warning three-units.ts's own MAX_* comment gives for
 *  Node-vs-tab tick timing applies here to GPU-vs-software rasterisation. These
 *  thresholds carry roughly 10x headroom over the hand-measured numbers for that
 *  reason: enough to absorb a real software-vs-hardware rendering-path difference
 *  without being so wide that an actual regression (a broken texture, a
 *  colour-family mismatch, missing geometry -- all of which read as tens-of-percent
 *  diffPixelPct or tens-of-/255 mean delta, not fractions of one) could slip under
 *  it. Retune ONLY alongside a real re-measurement on the actual CI runner, the same
 *  rule tuning.ts and three-units.ts both already follow for their own constants --
 *  do not widen this just because a first CI run failed, without first reading what
 *  it printed. */
const MAX_DIFF_PIXEL_PCT = 1.3; // ~10x the hand-measured 0.128%
const MAX_MEAN_ABS_CHANNEL_DELTA = 10; // ~10x the hand-measured 1.03/255
const PIXELMATCH_THRESHOLD = 0.1; // pixelmatch's own default -- unchanged from diff.ts's CLI default

interface CaptureResult {
  tick: number;
  camera: { x: number; y: number; zoom: number };
  rect: { x: number; y: number; w: number; h: number };
  dpr: number;
}

interface Args {
  port: number;
  outDir: string;
  keepServer: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v ?? 'true'] as const;
      })
  );
  return {
    port: Number(flags.get('port') ?? 5174),
    outDir: flags.get('out-dir') ?? path.join(REPO_ROOT, '.superpowers', 'golden-diff-ci'),
    keepServer: flags.has('keep-server'),
  };
}

async function isServerUp(port: number): Promise<boolean> {
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
  throw new Error(`golden-diff-gate: dev server on port ${port} did not come up within ${timeoutMs}ms`);
}

/** Starts a dedicated dev server for this run UNLESS one is already answering on
 *  `port`, in which case it is reused, never managed: this repo's hard rule is to
 *  never kill a `pnpm dev` this process did not start, and "already up" is exactly
 *  the ambiguous case where the safe move is to leave it alone (the same call
 *  d-golden-diff-report.md's manual run made about the port-5173 server it found).
 *  Returns the child process to tear down at the end, or `null` if an existing
 *  server was reused (and therefore must not be touched). */
async function ensureDevServer(port: number): Promise<ChildProcess | null> {
  if (await isServerUp(port)) {
    console.log(`[golden-diff-gate] reusing dev server already listening on :${port} (not managed, will not be killed)`);
    return null;
  }
  console.log(`[golden-diff-gate] starting a dev server on :${port}...`);
  const child = spawn('pnpm', ['--filter', '@lions/app', 'dev'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  try {
    await waitForServer(port, 30_000);
  } catch (err) {
    console.error(`[golden-diff-gate] dev server output so far:\n${out}`);
    child.kill('SIGTERM');
    throw err;
  }
  return child;
}

async function capture(page: Page, url: string, outFile: string, label: string): Promise<CaptureResult> {
  // Up to 3 attempts: d-golden-diff-report.md's own Concerns section recorded the
  // dev server's module graph intermittently failing a dynamically-imported module
  // right after a `pnpm install`, reproducibly across five retries in one tab and
  // resolved only by a fresh tab -- a fresh `page.goto` here is this script's
  // equivalent of "a brand-new tab". This is not hypothetical: wiring this file up
  // reproduced the identical shape live, once, against a dev server another
  // concurrent session was actively hot-reloading ("Execution context was destroyed,
  // most likely because of a navigation", then a full page.goto timeout) -- 2
  // attempts were not enough to ride it out that time, so this budgets 3.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', {
        timeout: 15_000,
      });
      // capture-protocol.ts's own documented settle: await font load + a 1s
      // settle before stepping -- run 1 in the report read 6.5x noisier without it.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1000);
      const raw = await page.evaluate(CAPTURE_SCRIPT);
      const result = JSON.parse(raw as string) as CaptureResult;
      await page.screenshot({
        path: outFile,
        clip: { x: result.rect.x, y: result.rect.y, width: result.rect.w, height: result.rect.h },
      });
      return result;
    } catch (err) {
      lastErr = err;
      console.warn(`[golden-diff-gate] ${label} capture attempt ${attempt + 1} failed: ${(err as Error).message}`);
    }
  }
  throw new Error(
    `[golden-diff-gate] ${label} capture failed 3 times: ${(lastErr as Error)?.message ?? String(lastErr)}`
  );
}

async function main(): Promise<void> {
  const { port, outDir, keepServer } = parseArgs(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  const devServer = await ensureDevServer(port);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    console.log(
      `[golden-diff-gate] scenario: sandbox=${SANDBOX_MAP} marker=${CAMERA_MARKER} ticks=${CAPTURE_TICKS} port=${port}`
    );
    const pixiPng = path.join(outDir, 'pixi.png');
    const threePng = path.join(outDir, 'three.png');
    const pixiResult = await capture(page, pixiUrl(port), pixiPng, 'pixi');
    const threeResult = await capture(page, threeUrl(port), threePng, 'three');
    await page.close();

    // Sanity check from capture-protocol.ts step 3c: the app should compute
    // identical camera/rect state regardless of which Renderer is behind the
    // interface. A mismatch here means the two captures are not comparable at all
    // (different framing, not a rendering difference), so this fails loudly before
    // running a pixel diff that would be meaningless.
    const comparable =
      pixiResult.camera.x === threeResult.camera.x &&
      pixiResult.camera.y === threeResult.camera.y &&
      pixiResult.camera.zoom === threeResult.camera.zoom &&
      pixiResult.rect.w === threeResult.rect.w &&
      pixiResult.rect.h === threeResult.rect.h;
    if (!comparable) {
      console.error(
        '[golden-diff-gate] pixi/three camera or rect mismatch -- captures are not comparable:\n' +
          `  pixi:  ${JSON.stringify(pixiResult)}\n` +
          `  three: ${JSON.stringify(threeResult)}`
      );
      process.exitCode = 1;
      return;
    }

    const summary = computeDiff(pixiPng, threePng, { outDir, threshold: PIXELMATCH_THRESHOLD });
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(formatSummary(summary));
    console.log('');
    console.log(
      `[golden-diff-gate] Before treating a failure below as a real regression, check the ` +
        `${summary.diffPixels} differing pixels against the ${EXPECTED_DIFFERENCES.length} known ` +
        'expected-difference entries:'
    );
    console.log('');
    console.log(formatExpectedDifferences());

    const ok = summary.diffPixelPct < MAX_DIFF_PIXEL_PCT && summary.meanAbsChannelDelta < MAX_MEAN_ABS_CHANNEL_DELTA;
    console.log(
      `[golden-diff-gate] gate: diffPixelPct ${summary.diffPixelPct.toFixed(3)}% ` +
        `(budget <${MAX_DIFF_PIXEL_PCT}%), meanAbsChannelDelta ${summary.meanAbsChannelDelta.toFixed(3)} ` +
        `(budget <${MAX_MEAN_ABS_CHANNEL_DELTA}) -> ${ok ? 'PASS' : 'FAIL'}`
    );
    if (!ok) {
      console.error(
        "[golden-diff-gate] Pixi/three diverged past this gate's budget on the " +
          `${SANDBOX_MAP}@${CAMERA_MARKER} quiet scenario. This scenario has never exercised combat ` +
          "(see this file's own top comment) -- if the diff traces to a combat-only expected-difference " +
          'entry, that means combat leaked into a scenario meant to be quiet, which is itself worth ' +
          'investigating, not just re-thresholding.'
      );
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (devServer && !keepServer) {
      devServer.kill('SIGTERM');
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
