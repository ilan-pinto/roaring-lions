// CI wiring for tools/src/golden-diff/ -- the same "manual script, not in CI" gap
// CLAUDE.md records for playtest.ts, and the one d-golden-diff-report.md's own
// Concerns section names explicitly: "capture cannot be scripted end-to-end without
// a browser-automation surface... doing so would need Playwright/Puppeteer driving a
// real Chromium with a real or software GL context."
//
// This file IS that automation. It imports the frozen capture protocol
// (capture-protocol.ts) and the pure diff function (diff.ts) the exact way a human
// running the manual protocol already does, and adds the browser-driving +
// pass/fail-gate layer around them. tools/src/perf/three-units.ts hit the identical
// "needs a real browser" wall for render cost and, per its own top comment,
// deliberately did NOT solve it -- this file is the solve, scoped to the one thing
// that can be gated headlessly: pixel comparison, not manual visual judgement.
//
// Cost of wiring this in: one new devDependency (`playwright`, tools/package.json)
// plus a one-time `playwright install chromium` (~270 MB, cached across CI runs by
// actions/cache the same way node_modules already is) plus the wall-clock cost of
// booting a real Vite dev server and two real (headless, software-rendered) WebGL
// contexts per SCENARIO -- multiple seconds to tens of seconds, not playtest.ts's
// ~3s. That is why this is its own workflow (.github/workflows/golden-diff.yml),
// gated by schedule/label/manual dispatch rather than every push -- see that file's
// header.
//
// ============================================================================
// Why per-scenario budgets, not one global threshold
// ============================================================================
//
// This file used to run exactly one scenario (the quiet sandbox scan) against one
// global budget, calibrated ~10x over that scenario's own hand-measured clean
// baseline. That was honest about its own scope (its top comment said so), but it
// meant the gate could only ever be run against the one scene it was built for --
// pointing it at anything else (a fight, a frame with a vehicle, open ground at
// zoom) produced a number several times the budget, not because the renderers had
// regressed, but because a scene with more silhouette perimeter, more moving parts,
// or content the quiet scenario never contained has a structurally different amount
// of expected antialiasing-fringe and expected-difference-catalogue pixels in it.
// Measured (`.superpowers/d-readiness-audit.md`, `.superpowers/d-combat-diff-report.md`,
// `.superpowers/d-ground-clip-report.md`):
//
//   quiet sandbox, tick 100:              0.128% (hand, GPU) / 0.143% (headless)
//   combat, beit_sahwan_3_clearance t150: 2.133%
//   combat, same mission t3410 (collapse): 3.395%
//   vehicle-dense, after 2 fixes:         1.557%
//
// A single global number that has to sit above 3.395% to avoid crying wolf on
// combat would also pass a quiet-scenario regression outright invisible under it --
// the two scenes simply do not share a meaningful budget. The fix is structural:
// `SCENARIOS` (capture-protocol.ts) is a list, each scenario gets its own entry in
// `SCENARIO_BUDGETS` below, calibrated against THAT scenario's own measured clean
// baseline (never against another scenario's number), and a run reports PASS/FAIL
// per scenario as well as overall. Adding a scenario this file does not yet run
// (e.g. the "vehicle-dense" or combat scenarios named above, still ad-hoc per their
// own reports) means adding both a `Scenario` entry in capture-protocol.ts AND a
// `SCENARIO_BUDGETS` entry here, each independently justified -- never inferred by
// scaling another scenario's budget, and never widened just to make a failing run
// go green (see the task's own hard constraint).
//
// Usage: npx tsx tools/src/ci/golden-diff-gate.ts [--port=5174] [--out-dir=path]
//        [--keep-server] [--scenario=<id>[,<id>...]]
//   --scenario filters SCENARIOS by id (comma-separated); default: all of them.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { pixiUrl, threeUrl, captureScript, SCENARIOS, type Scenario } from '../golden-diff/capture-protocol';
import { computeDiff, formatSummary, computeDominantColorFraction, type DiffSummary } from '../golden-diff/diff';
import { EXPECTED_DIFFERENCES, formatExpectedDifferences } from '../golden-diff/expected-differences';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

interface ScenarioBudget {
  maxDiffPixelPct: number;
  maxMeanAbsChannelDelta: number;
  /** Why these two numbers, in one line -- printed on every run so the budget's
   *  provenance travels with the result, not just with this comment. */
  rationale: string;
}

/** Headless Chromium here renders via a SOFTWARE GL path (SwiftShader/ANGLE), not
 *  real hardware AA, so its numbers on an identical scenario are not guaranteed to
 *  match a hand-measured-on-real-GPU baseline exactly -- the same "not
 *  interchangeable" warning three-units.ts's own MAX_* comment gives for
 *  Node-vs-tab tick timing applies here to GPU-vs-software rasterisation. Every
 *  budget below therefore carries headroom over its OWN clean measurement, wide
 *  enough to absorb a real software-vs-hardware rendering-path difference without
 *  being so wide that an actual regression (a broken texture, a colour-family
 *  mismatch, missing geometry -- all of which read as tens-of-percent diffPixelPct
 *  or tens-of-/255 mean delta, not a small multiple of a fraction of one) could
 *  slip under it. Retune ONLY alongside a real re-measurement on the actual CI
 *  runner, the same rule tuning.ts and three-units.ts both already follow for their
 *  own constants -- do not widen a budget just because a run failed, without first
 *  reading what it printed and confirming the diff is a real, accepted divergence
 *  (cross-check `expected-differences.ts`) rather than a regression. */
const SCENARIO_BUDGETS: Readonly<Record<string, ScenarioBudget>> = {
  quiet: {
    maxDiffPixelPct: 1.3,
    maxMeanAbsChannelDelta: 10,
    rationale:
      '~10x the hand-measured clean baseline (0.128% GPU / 0.143% headless post-anchor-fix, ' +
      '.superpowers/d-golden-diff-report.md, d-readiness-audit.md) -- unchanged from this ' +
      "gate's original single-scenario calibration.",
  },
  'open-ground': {
    // Calibrated against a real headless post-fix (d9fd1c7) clean measurement on
    // this exact scenario (diffPixelPct 1.937%, meanAbsChannelDelta 8.733,
    // reproduced twice, bit-identical), with real but modest headroom -- NOT the
    // ~10x `quiet` carries, because this scenario's clean baseline already embeds
    // a large, accepted, Pixi-vs-three shape/softness gap (Pixi's per-tile colour
    // jitter and soft round blob marks vs three's flat hard-edged diamonds -- see
    // capture-protocol.ts's OPEN_GROUND_SCENARIO comment), and widening past that
    // gap for "safety" would mostly just hide real regressions inside it.
    //
    // Disclosed limitation, found by sanity-checking against 671acdb (one commit
    // before the scatter fix): THESE TWO NUMBERS DO NOT, BY THEMSELVES, DISCRIMINATE
    // that specific historical bug from its fix -- 671acdb measured 1.945% /
    // 8.547 on this identical scenario, statistically indistinguishable from (and
    // for meanAbsChannelDelta, actually LOWER than) the clean d9fd1c7 numbers
    // above. That is not a threshold-tuning problem: the bug's own marginal
    // contribution to a full-canvas pixi-vs-three percentage is small relative to
    // the pre-existing shape/softness gap that swamps it, and no placement of
    // maxDiffPixelPct/maxMeanAbsChannelDelta between those two real numbers would
    // be a real signal rather than noise (671acdb's diffPixelPct is *higher*,
    // its meanAbsChannelDelta *lower* -- not even a consistent direction). This
    // budget therefore exists to catch a MORE severe regression of the same class
    // (missing scatter geometry entirely, a wrong colour family, a broken theme
    // lookup -- all of which would read as tens of percent, not fractions of one,
    // per the same reasoning `quiet`'s own comment gives). The specific coincidental
    // bug this scenario was added for is caught by `groundTextureCheck` instead
    // (capture-protocol.ts, `OPEN_GROUND_SCENARIO`) -- a same-renderer self-check
    // that does not depend on Pixi's rendering style at all, and which DOES cleanly
    // separate the two commits (0.9588 vs 0.9408, budgeted at 0.95). Full derivation
    // in .superpowers/d-golden-scenarios-report.md.
    maxDiffPixelPct: 3,
    maxMeanAbsChannelDelta: 14,
    rationale:
      '~1.5x the real headless post-fix (d9fd1c7) clean baseline (1.937% / 8.733) -- tighter than ' +
      "`quiet`'s ~10x because this baseline already embeds an accepted shape/softness gap. Does " +
      'NOT by itself discriminate the historical scatter bug (671acdb measured 1.945% / 8.547 -- ' +
      'statistically the same); that defect is caught by groundTextureCheck instead. See this ' +
      "budget's own comment above for the full reasoning.",
  },
};

function budgetFor(scenario: Scenario): ScenarioBudget {
  const b = SCENARIO_BUDGETS[scenario.id];
  if (!b) {
    throw new Error(
      `golden-diff-gate: no SCENARIO_BUDGETS entry for scenario "${scenario.id}" -- add one, ` +
        'calibrated against a real measurement of THIS scenario, before running it in the gate.'
    );
  }
  return b;
}

interface CaptureResult {
  tick: number;
  camera: { x: number; y: number; zoom: number };
  rect: { x: number; y: number; w: number; h: number };
  dpr: number;
}

const PIXELMATCH_THRESHOLD = 0.1; // pixelmatch's own default -- unchanged from diff.ts's CLI default

interface Args {
  port: number;
  outDir: string;
  keepServer: boolean;
  scenarioIds: string[] | null; // null = all of SCENARIOS
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
  const scenarioArg = flags.get('scenario');
  return {
    port: Number(flags.get('port') ?? 5174),
    outDir: flags.get('out-dir') ?? path.join(REPO_ROOT, '.superpowers', 'golden-diff-ci'),
    keepServer: flags.has('keep-server'),
    scenarioIds: scenarioArg ? scenarioArg.split(',').map((s) => s.trim()) : null,
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

async function capture(page: Page, url: string, script: string, outFile: string, label: string): Promise<CaptureResult> {
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
      const raw = await page.evaluate(script);
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

interface ScenarioResult {
  scenario: Scenario;
  ok: boolean;
  comparable: boolean;
  summary: DiffSummary | null;
}

async function runScenario(page: Page, port: number, outDir: string, scenario: Scenario): Promise<ScenarioResult> {
  const budget = budgetFor(scenario);
  console.log(
    `\n[golden-diff-gate] scenario "${scenario.id}": sandbox=${scenario.sandboxMap} ` +
      `marker=${scenario.cameraMarker} ticks=${scenario.ticks}${scenario.zoom !== undefined ? ` zoom=${scenario.zoom}` : ''} port=${port}`
  );
  const scenarioOutDir = path.join(outDir, scenario.id);
  mkdirSync(scenarioOutDir, { recursive: true });
  const pixiPng = path.join(scenarioOutDir, 'pixi.png');
  const threePng = path.join(scenarioOutDir, 'three.png');
  const script = captureScript(scenario);
  const pixiResult = await capture(page, pixiUrl(port, scenario), script, pixiPng, `${scenario.id}/pixi`);
  const threeResult = await capture(page, threeUrl(port, scenario), script, threePng, `${scenario.id}/three`);

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
      `[golden-diff-gate] scenario "${scenario.id}": pixi/three camera or rect mismatch -- captures are ` +
        `not comparable:\n  pixi:  ${JSON.stringify(pixiResult)}\n  three: ${JSON.stringify(threeResult)}`
    );
    return { scenario, ok: false, comparable: false, summary: null };
  }

  const summary = computeDiff(pixiPng, threePng, { outDir: scenarioOutDir, threshold: PIXELMATCH_THRESHOLD });
  writeFileSync(path.join(scenarioOutDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(formatSummary(summary));

  const diffOk = summary.diffPixelPct < budget.maxDiffPixelPct && summary.meanAbsChannelDelta < budget.maxMeanAbsChannelDelta;
  console.log(
    `[golden-diff-gate] scenario "${scenario.id}" gate: diffPixelPct ${summary.diffPixelPct.toFixed(3)}% ` +
      `(budget <${budget.maxDiffPixelPct}%), meanAbsChannelDelta ${summary.meanAbsChannelDelta.toFixed(3)} ` +
      `(budget <${budget.maxMeanAbsChannelDelta}) -> ${diffOk ? 'PASS' : 'FAIL'}`
  );
  console.log(`[golden-diff-gate] scenario "${scenario.id}" budget rationale: ${budget.rationale}`);

  // groundTextureCheck (capture-protocol.ts): a same-renderer self-check, run ONLY
  // for scenarios that declare one. Exists because the ordinary pixi-vs-three
  // diffOk check above was measured, for the open-ground scenario specifically, to
  // NOT discriminate the scatter defect it exists to catch (see that scenario's own
  // doc comment) -- this checks a structural property of three's OWN capture
  // directly instead of comparing it to Pixi.
  let textureOk = true;
  if (scenario.groundTextureCheck) {
    const { region, maxBackgroundFraction } = scenario.groundTextureCheck;
    const dom = computeDominantColorFraction(threePng, region);
    textureOk = dom.dominantFraction < maxBackgroundFraction;
    console.log(
      `[golden-diff-gate] scenario "${scenario.id}" groundTextureCheck: region ` +
        `${JSON.stringify(region)}, dominantColor rgb(${dom.dominantColor.join(',')}), ` +
        `dominantFraction ${dom.dominantFraction.toFixed(4)} (budget <${maxBackgroundFraction}), ` +
        `distinctColors ${dom.distinctColors} -> ${textureOk ? 'PASS' : 'FAIL'}`
    );
    if (!textureOk) {
      console.error(
        `[golden-diff-gate] scenario "${scenario.id}": three's own captured ground is ` +
          `${(dom.dominantFraction * 100).toFixed(1)}% a single flat colour in the checked region -- ` +
          'this is the shape of the stone-grain scatter defect (d9fd1c7): a mark composited onto its ' +
          "own tile's background tone collapsing to a no-op. Check `scatter.ts`'s tone composites " +
          'against the shipped theme (`terrain-themes.ts`) before assuming this is unrelated.'
      );
    }
  }

  const ok = diffOk && textureOk;
  if (!ok) {
    console.error(
      `[golden-diff-gate] scenario "${scenario.id}" FAILED (diffOk=${diffOk}, textureOk=${textureOk}). ` +
        `Before treating this as a real regression, check the ${summary.diffPixels} differing pixels ` +
        `against the ${EXPECTED_DIFFERENCES.length} known expected-difference entries:\n\n` +
        formatExpectedDifferences()
    );
  }
  return { scenario, ok, comparable: true, summary };
}

async function main(): Promise<void> {
  const { port, outDir, keepServer, scenarioIds } = parseArgs(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  const scenarios = scenarioIds ? SCENARIOS.filter((s) => scenarioIds.includes(s.id)) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(
      `[golden-diff-gate] no scenarios matched --scenario=${scenarioIds?.join(',')} ` +
        `(known: ${SCENARIOS.map((s) => s.id).join(', ')})`
    );
    process.exitCode = 2;
    return;
  }

  const devServer = await ensureDevServer(port);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(page, port, outDir, scenario));
    }
    await page.close();

    console.log('\n[golden-diff-gate] ==== summary ====');
    for (const r of results) {
      const status = !r.comparable ? 'FAIL (not comparable)' : r.ok ? 'PASS' : 'FAIL';
      const pct = r.summary ? `${r.summary.diffPixelPct.toFixed(3)}%` : 'n/a';
      console.log(`  ${r.scenario.id}: ${status} (diffPixelPct ${pct})`);
    }

    const allOk = results.every((r) => r.ok);
    if (!allOk) {
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
