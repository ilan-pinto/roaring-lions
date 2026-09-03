// The visual regression gate: three.js against a STORED three.js baseline.
//
// Replaces `golden-diff-gate.ts`'s cross-backend pass/fail, which the project
// lead retired ("retire cross-backend and rebuild it as three-vs-three") after
// all four of its scenarios went red with no regression behind them -- the
// whole overage being the mesh path Pixi has no counterpart for, permanently
// and by design (`.superpowers/queue/golden-diff-red-report.md`). That file
// survives as a report-only diagnostic; this one is the gate.
//
// Read `../golden-diff/baseline.ts` first. It carries the two measured facts
// that shape every threshold here -- that run-to-run noise sits in tight
// clusters rather than spread over the frame, and that pixelmatch's
// differing-pixel count is BLIND to the one-palette-step regression this
// renderer actually suffers, so `meanAbsChannelDelta` is the primary metric.
//
// ============================================================================
// Usage
// ============================================================================
//
//   pnpm golden-baseline                       # compare against the stored baseline
//   pnpm golden-baseline -- --scenario=quiet   # one scenario
//   pnpm golden-baseline:bless -- --reason="mesh trees replace the canopy sprite"
//
// Flags: --port=5175 --out-dir=path --keep-server --scenario=<id>[,<id>...]
//        --baseline-dir=path --bless --reason="..."
//
// Exit codes (`baseline.ts` owns the constants):
//   0  every gated scenario matched its baseline
//   1  at least one gated scenario differs -- a real finding
//   2  usage error / capture failure
//   3  no baseline exists for THIS capture environment, and every scenario
//      that COULD be judged without one passed (actionable, and impossible
//      once one has been blessed here). The run still captures everything and
//      still runs every reference-free self-check; a self-check FAILURE is
//      exit 1 even with no baseline.
//
// ============================================================================
// What votes when there is no baseline
// ============================================================================
//
// The reference-free half of this gate is the VISIBLE-TOGGLE A/B: hide a named
// draw layer, repaint with zero elapsed presentation time, photograph, and
// require the two frames to differ by a calibrated floor
// (`BaselineSpec.layerChecks`; the seam is
// `packages/render/src/three/debug-layers.ts`). It is texture-proof by
// construction -- it never asks what the frame looks like, only whether
// removing one layer changes it -- and it needs no stored picture, so it is
// what votes on a runner nobody has blessed a baseline for.
//
// IT REPLACED A CHECK THAT HAD GONE STRUCTURALLY INERT, and the way that
// happened is the reason this section exists. `groundTextureCheck` cropped
// `open-ground`'s ground and failed if more than 95% of the crop was a single
// flat colour -- 0.9542 with the scatter defect, 0.9408 without. Then
// `c38f770` put a photographic sand tile on every open-ground pixel and the
// crop went to 0.2330 with 6,721 distinct colours. It could no longer reach
// its own budget from any direction, on any tree, and it went on printing
// PASS. A reference-free check that asks about APPEARANCE can be blinded by
// content; one that asks whether a layer CONTRIBUTES cannot.
//
// WHAT EXIT 3 DOES AND DOES NOT PROMISE, measured on this branch rather than
// argued. Both documented defects now exit 1 with an EMPTY baseline directory:
//
//   - erasing every decor object (`decor-place.ts`'s `familyFor` ->
//     `return null`) drives the `decor` toggle to 0 px / 0.0000 on all three
//     scenarios that declare it, against floors of 4700/0.4, 300/0.15 and
//     12800/0.92. This is the defect that used to reach exit 3 with the old
//     self-check reading the clean tree's own number;
//   - the stone-grain scatter no-op (`671acdb`) fails the `scatter` layer's
//     TONE check -- ratio 0.5927 / 0.6938 / 0.6359 against a 0.8 floor and a
//     clean-tree 0.9306 / 0.9544 / 0.9377.
//
// What exit 3 still means is "nothing was COMPARED". Two scenarios declare no
// reference-free check at all (`vehicle`, `combat`) and are captured and not
// judged; every check that does run is a statement about ONE layer in ONE
// framing. A regression in something no layer check names -- unit meshes, fog,
// overlays, a wrong colour that is still a colour -- passes here at any size.
// Bless a baseline for the environment. That is still the fix.
//
// ============================================================================
// Accepting an intended visual change
// ============================================================================
//
// Every renderer change that is meant to alter the picture will fail this gate.
// That is the point, and it is also how a gate becomes something people
// disable, so re-blessing is deliberately explicit, reviewable and awkward to
// do by accident:
//
//   - it is a DIFFERENT command (`golden-baseline:bless`), never a flag the
//     ordinary run might grow;
//   - it REFUSES to run without `--reason="..."`, which is written into
//     `manifest.json` and printed on every future mismatch, so the next person
//     to see a diff reads why the baseline is what it is;
//   - in CI it lives in its own `workflow_dispatch` job that opens a PULL
//     REQUEST with the new PNGs and manifest rather than pushing to a branch,
//     so a human looks at the picture before it becomes the truth;
//   - the compare run refuses a baseline whose scenario has since been
//     re-authored (`capturePreconditionMismatches`) rather than reporting the
//     re-authoring as a regression.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import {
  threeUrl,
  captureScript,
  layerToggleScript,
  REPAINT_SCRIPT,
  SCENARIOS,
  type Scenario,
} from '../golden-diff/capture-protocol';
import { computeDiff, formatSummary } from '../golden-diff/diff';
import {
  EXIT_DIFF,
  EXIT_NO_BASELINE,
  EXIT_OK,
  EXIT_USAGE,
  REPAINT_CONTROL_MAX_DIFF_PIXELS,
  REPAINT_CONTROL_MAX_MEAN_DELTA,
  capturePreconditionMismatches,
  envKey,
  evaluateBaseline,
  evaluateLayerCheck,
  evaluateToneCheck,
  isGated,
  specFor,
  type BaselineManifest,
  type BaselineScenarioRecord,
  type BaselineSpec,
} from '../golden-diff/baseline';
import {
  CAPTURE_VIEWPORT,
  capture,
  ensureDevServer,
  launchCaptureBrowser,
  readUnmaskedRenderer,
  rephotograph,
  stopDevServer,
  type CaptureResult,
} from '../golden-diff/browser';
import { guardCapture } from '../golden-diff/capture-guard';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_BASELINE_DIR = path.join(REPO_ROOT, 'tools', 'golden-baselines');
const TAG = 'three-baseline';
const PIXELMATCH_THRESHOLD = 0.1; // pixelmatch's own default, unchanged from diff.ts

interface Args {
  port: number;
  outDir: string;
  baselineDir: string;
  keepServer: boolean;
  scenarioIds: string[] | null;
  bless: boolean;
  reason: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const i = a.indexOf('=');
        return i === -1 ? ([a.slice(2), 'true'] as const) : ([a.slice(2, i), a.slice(i + 1)] as const);
      })
  );
  const scenarioArg = flags.get('scenario');
  return {
    port: Number(flags.get('port') ?? 5175),
    // Resolved against the REPO ROOT, not the cwd, and that is a fix rather
    // than a preference. Both workflows pass `--out-dir=visual-baseline-output`
    // and then upload `visual-baseline-output` from the workspace root -- but
    // the npm script is `pnpm --filter @lions/tools`, so the cwd is `tools/`
    // and the captures landed in `tools/visual-baseline-output`. Measured on
    // run 33591712714: "No files were found with the provided path:
    // visual-baseline-output. No artifacts will be uploaded." Every artifact
    // upload either gate has ever done was empty, including the `combat` frame
    // this file's own comments call the thing a triager actually wants.
    // `path.resolve` leaves an absolute --out-dir untouched.
    outDir: path.resolve(REPO_ROOT, flags.get('out-dir') ?? path.join(REPO_ROOT, '.superpowers', 'three-baseline')),
    baselineDir: flags.get('baseline-dir') ?? DEFAULT_BASELINE_DIR,
    keepServer: flags.has('keep-server'),
    scenarioIds: scenarioArg ? scenarioArg.split(',').map((s) => s.trim()) : null,
    bless: flags.has('bless'),
    reason: flags.get('reason') ?? null,
  };
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function gitHead(): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

/** `path.relative` from the repo root, unless that walks out of the tree (an
 *  --out-dir under /tmp), in which case the absolute path is the readable one. */
function short(p: string): string {
  const r = path.relative(REPO_ROOT, p);
  return r.startsWith('..') ? p : r;
}

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((n, f) => n + statSync(path.join(dir, f)).size, 0);
}

interface ScenarioOutcome {
  id: string;
  gated: boolean;
  ok: boolean;
  /** Whether this scenario has a reference-free check of its own. On a run
   *  with no baseline it is the difference between "judged" and "captured",
   *  and the summary says which is which rather than leaving both looking
   *  like a pass. */
  selfChecked: boolean;
  detail: string;
}

async function captureScenario(
  page: Page,
  port: number,
  outDir: string,
  scenario: Scenario
): Promise<{ png: string; result: CaptureResult }> {
  const dir = path.join(outDir, scenario.id);
  mkdirSync(dir, { recursive: true });
  const png = path.join(dir, 'current.png');
  const result = await capture(
    page,
    threeUrl(port, scenario),
    captureScript(scenario),
    png,
    `${TAG}/${scenario.id}`,
    scenario.mission !== undefined
  );
  return { png, result };
}

interface SelfCheckResult {
  /** Every reference-free check this scenario declares passed. */
  ok: boolean;
  /** How many voted. 0 means this scenario was CAPTURED, not judged. */
  checks: number;
  lines: string[];
  failures: string[];
}

/**
 * The reference-free half of the verdict: the visible-toggle A/B, run against
 * the live page the scenario was just captured from.
 *
 * For each layer the scenario declares, hide it, repaint, photograph, and
 * require the two frames to DIFFER by at least the calibrated floor. It needs
 * no stored baseline, so it is what votes on a runner nobody has blessed one
 * for -- the state the retired `groundTextureCheck` was supposed to cover and,
 * measured, did not (see this file's exit-code block).
 *
 * Two properties are load-bearing and neither is incidental.
 *
 * IT IS TEXTURE-PROOF BY CONSTRUCTION. It never asks what the frame looks
 * like, only whether removing one layer changes it, so no amount of detail
 * underneath can hide a layer that stopped drawing. That is exactly what
 * `groundTextureCheck` could not survive: it asked "is this crop mostly one
 * flat colour", the ground gained a photographic sand tile, and the answer
 * became a permanent 0.2330 against a <0.95 budget.
 *
 * THE CONTROL IS PART OF THE MEASUREMENT. Before any layer is touched, the
 * page is repainted with zero elapsed presentation time and photographed
 * again; that frame must be bit-identical to the capture. If it is not, the
 * scene is drifting between photographs and every toggle delta below is
 * measuring the drift as well as the layer. The control is a gated check of
 * its own rather than an assumption in a comment.
 */
async function runSelfChecks(
  page: Page,
  scenario: Scenario,
  spec: BaselineSpec,
  capturedPng: string,
  captured: CaptureResult,
  outDir: string
): Promise<SelfCheckResult> {
  const checks = spec.layerChecks ?? [];
  if (checks.length === 0) return { ok: true, checks: 0, lines: [], failures: [] };

  const dir = path.join(outDir, scenario.id);
  const lines: string[] = [];
  const failures: string[] = [];

  // The control. `REPAINT_SCRIPT` advances no tick and hands `frame()` zero
  // milliseconds, so this is the same picture drawn twice.
  const shownPng = path.join(dir, 'layer-shown.png');
  await rephotograph(page, REPAINT_SCRIPT, shownPng, captured.rect);
  const control = computeDiff(capturedPng, shownPng, {
    outDir: dir,
    diffFileName: 'diff-repaint-control.png',
    threshold: PIXELMATCH_THRESHOLD,
    region: spec.region ?? undefined,
  });
  const controlOk =
    control.diffPixels <= REPAINT_CONTROL_MAX_DIFF_PIXELS &&
    control.meanAbsChannelDelta <= REPAINT_CONTROL_MAX_MEAN_DELTA;
  lines.push(
    `repaint-control: a zero-time repaint moved ${control.diffPixels} px / ` +
      `${control.meanAbsChannelDelta.toFixed(4)} (budget <=${REPAINT_CONTROL_MAX_DIFF_PIXELS} px / ` +
      `${REPAINT_CONTROL_MAX_MEAN_DELTA}) -> ${controlOk ? 'PASS' : 'FAIL'}`
  );
  if (!controlOk) {
    failures.push(
      `repaint-control: the frame changed on its own between two photographs (${control.diffPixels} px / ` +
        `${control.meanAbsChannelDelta.toFixed(4)}). Every layer delta below is measuring that drift too, ` +
        'so none of them can be trusted -- find what is still animating with the frame loop frozen ' +
        'before reading the toggles.'
    );
  }

  for (const check of checks) {
    const region = check.region !== undefined ? check.region : spec.region;
    const hiddenPng = path.join(dir, `layer-${check.layer}-hidden.png`);
    await rephotograph(page, layerToggleScript(check.layer, false), hiddenPng, captured.rect);
    const shownAgain = await page.evaluate(layerToggleScript(check.layer, true));
    const objects = (JSON.parse(shownAgain as string) as { objects: number }).objects;
    const summary = computeDiff(shownPng, hiddenPng, {
      outDir: dir,
      diffFileName: `diff-layer-${check.layer}.png`,
      threshold: PIXELMATCH_THRESHOLD,
      region: region ?? undefined,
    });
    const verdict = evaluateLayerCheck(summary, check);
    lines.push(
      `layer "${check.layer}": hiding it moved ${summary.diffPixels} px / ` +
        `${summary.meanAbsChannelDelta.toFixed(4)} (floor >=${check.minDiffPixels} px / ` +
        `${check.minMeanAbsChannelDelta}) -> ${verdict.ok ? 'PASS' : 'FAIL'} ` +
        `[${objects} scene object(s) toggled -- diagnostic only, the verdict is the pixels]`
    );
    lines.push(`layer "${check.layer}" floor: ${check.rationale}`);
    for (const f of verdict.failures) failures.push(f);

    // The tone-collapse ratio: the SAME layer's footprint measured a second
    // time against a flattened backdrop. Two more photographs, and the
    // `over` layer is put back before anything else runs -- a scenario's
    // later checks are all measured against the ordinary picture.
    if (check.toneCheck) {
      const { over } = check.toneCheck;
      const flatShown = path.join(dir, `layer-${check.layer}-over-flat-shown.png`);
      const flatHidden = path.join(dir, `layer-${check.layer}-over-flat-hidden.png`);
      await page.evaluate(layerToggleScript(over, false));
      await rephotograph(page, REPAINT_SCRIPT, flatShown, captured.rect);
      await rephotograph(page, layerToggleScript(check.layer, false), flatHidden, captured.rect);
      await page.evaluate(layerToggleScript(check.layer, true));
      await page.evaluate(layerToggleScript(over, true));
      const flat = computeDiff(flatShown, flatHidden, {
        outDir: dir,
        diffFileName: `diff-layer-${check.layer}-over-flat.png`,
        threshold: PIXELMATCH_THRESHOLD,
        region: region ?? undefined,
      });
      const tone = evaluateToneCheck(summary.changedPixels, flat.changedPixels, check.toneCheck, check.layer);
      lines.push(
        `layer "${check.layer}" tone: footprint ${summary.changedPixels} px over textured ground, ` +
          `${flat.changedPixels} px over the flat tone (ratio ${tone.ratio.toFixed(4)}, floor >=` +
          `${check.toneCheck.minFootprintRatio}) -> ${tone.ok ? 'PASS' : 'FAIL'}`
      );
      lines.push(`layer "${check.layer}" tone floor: ${check.toneCheck.rationale}`);
      for (const f of tone.failures) failures.push(f);
    }
  }

  // The repaint control plus every layer check plus every tone check -- a
  // count of things that actually VOTED, not of table rows. A tone check is a
  // second, independent verdict on the same layer (it is what fails on the
  // scatter no-op while the floor passes), so leaving it out would understate
  // exactly the check that is hardest to explain from the summary line.
  const toneChecks = checks.filter((c) => c.toneCheck).length;
  return { ok: failures.length === 0, checks: checks.length + toneChecks + 1, lines, failures };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.bless && !args.reason) {
    console.error(
      `[${TAG}] --bless requires --reason="what changed and why the new picture is correct". ` +
        'It is written into manifest.json and printed on every future mismatch, so the next ' +
        'person to see a diff can read why the baseline is what it is. Refusing to bless ' +
        'anonymously.'
    );
    process.exitCode = EXIT_USAGE;
    return;
  }

  const scenarios = args.scenarioIds ? SCENARIOS.filter((s) => args.scenarioIds?.includes(s.id)) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(
      `[${TAG}] no scenarios matched --scenario=${args.scenarioIds?.join(',')} ` +
        `(known: ${SCENARIOS.map((s) => s.id).join(', ')})`
    );
    process.exitCode = EXIT_USAGE;
    return;
  }
  // A scenario with no BASELINES entry throws here rather than being skipped:
  // the same rule `SCENARIO_BUDGETS` already had, for the same reason.
  for (const s of scenarios) specFor(s.id);

  mkdirSync(args.outDir, { recursive: true });
  const devServer = await ensureDevServer(args.port, REPO_ROOT, TAG);
  const browser = await launchCaptureBrowser();
  try {
    const unmaskedRenderer = await readUnmaskedRenderer(browser);
    const key = envKey(process.platform, process.arch, unmaskedRenderer);
    const envDir = path.join(args.baselineDir, key);
    const manifestPath = path.join(envDir, 'manifest.json');
    console.log(
      `[${TAG}] capture environment: ${key}\n` +
        `[${TAG}]   platform=${process.platform} arch=${process.arch} viewport=${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height}\n` +
        `[${TAG}]   unmaskedRenderer="${unmaskedRenderer}"\n` +
        `[${TAG}]   baselines: ${envDir}`
    );

    // NO BASELINE HERE YET. Never a silent pass: a baseline captured through a
    // different GL backend is measurably worse than none (see `envKey`'s
    // comment), and cross-OS portability was never measured, so this gets its
    // own distinct exit code and the workflow decides what it means.
    //
    // It no longer RETURNS here, though, and that matters. It used to, which
    // made the reference-free check's whole claim -- "it needs no stored
    // reference, so it is the one thing that still works in an environment
    // with no blessed baseline" -- false in exactly the environment it was
    // written for: nothing was captured, so nothing was checked. Combined with
    // the bless workflow being unable to create a first baseline at all
    // (`visual-baseline-bless.yml`, fixed in the same commit), CI ran a
    // green-ticking no-op. Now the run captures every scenario, runs whatever
    // self-checks each one declares, and exits 1 if one FAILS -- only an
    // otherwise-clean run reaches the softer exit 3.
    //
    // "Whatever each one declares" is three scenarios and ten layer checks,
    // and the exit-code block at the top of this file says what that does and
    // does not cover.
    const noBaseline = !args.bless && !existsSync(manifestPath);
    if (noBaseline) {
      const have = existsSync(args.baselineDir)
        ? readdirSync(args.baselineDir).filter((d) => statSync(path.join(args.baselineDir, d)).isDirectory())
        : [];
      console.error(
        `\n[${TAG}] NO BASELINE for capture environment "${key}".\n` +
          `[${TAG}] Baselines present: ${have.length ? have.join(', ') : '(none)'}\n` +
          `[${TAG}] A baseline captured in a different environment is NOT a substitute -- on one\n` +
          `[${TAG}] machine the same commit differs by 230 px / 0.0320 meanAbsChannelDelta between\n` +
          `[${TAG}] SwiftShader and ANGLE/Metal on the quiet scenario alone, which is 100x that\n` +
          `[${TAG}] scenario's run-to-run noise and enough to swallow the defect this gate exists\n` +
          `[${TAG}] to catch. Bless one HERE, after looking at the captures:\n` +
          `[${TAG}]   pnpm golden-baseline:bless -- --reason="first baseline for ${key}"\n` +
          `[${TAG}] Capturing anyway, so the reference-free toggle checks still vote -- each one\n` +
          `[${TAG}] hides a named draw layer and requires the frame to change. They catch a layer\n` +
          `[${TAG}] that has stopped drawing, and the scatter layer's tone collapsing into its own\n` +
          `[${TAG}] ground; they say NOTHING about anything no layer check names. See the summary\n` +
          `[${TAG}] at the end for which scenarios were judged and which were only captured.\n`
      );
    }

    const manifest: BaselineManifest = args.bless
      ? {
          version: 1,
          envKey: key,
          unmaskedRenderer,
          platform: process.platform,
          arch: process.arch,
          commit: gitHead(),
          blessedAt: new Date().toISOString(),
          reason: args.reason ?? '',
          scenarios: {},
        }
      : noBaseline
        ? {
            version: 1,
            envKey: key,
            unmaskedRenderer,
            platform: process.platform,
            arch: process.arch,
            commit: gitHead(),
            blessedAt: '',
            reason: '(no baseline blessed for this environment)',
            scenarios: {},
          }
        : (JSON.parse(readFileSync(manifestPath, 'utf8')) as BaselineManifest);

    if (!args.bless && !noBaseline) {
      if (manifest.version !== 1) {
        console.error(`[${TAG}] baseline manifest version ${manifest.version} is not 1 -- re-bless.`);
        process.exitCode = EXIT_USAGE;
        return;
      }
      console.log(
        `[${TAG}] baseline blessed ${manifest.blessedAt} at ${manifest.commit.slice(0, 7)}: "${manifest.reason}"`
      );
    }

    const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT } });
    const outcomes: ScenarioOutcome[] = [];

    for (const scenario of scenarios) {
      const spec = specFor(scenario.id);
      const gated = isGated(spec);
      console.log(
        `\n[${TAG}] scenario "${scenario.id}" (${gated ? 'GATED' : 'report-only'}): ` +
          `${scenario.mission !== undefined ? `mission=${scenario.mission}` : `sandbox=${scenario.sandboxMap}`}` +
          `${scenario.targetTick !== undefined ? ` targetTick=${scenario.targetTick}` : ` ticks=${scenario.ticks}`}` +
          `${scenario.zoom !== undefined ? ` zoom=${scenario.zoom}` : ''}`
      );
      // A capture failure is fatal exactly when the scenario is GATED --
      // `guardCapture` owns that rule and `capture-guard.ts`'s header owns the
      // reasoning. `combat` threw here on the first Linux bless and took four
      // already-captured gated baselines down with it, along with the manifest
      // that would have made them usable and the PR that would have shown them
      // to a human. A scenario that cannot vote must not be able to do that.
      const attempt = await guardCapture(gated, `${TAG}/${scenario.id}`, () =>
        captureScenario(page, args.port, args.outDir, scenario)
      );
      if (!attempt.ok) {
        outcomes.push({
          id: scenario.id,
          gated,
          ok: true, // report-only: it could not vote before and it cannot now
          selfChecked: false,
          detail: `CAPTURE FAILED (report-only, does not vote): ${attempt.error.message}`,
        });
        continue;
      }
      const { png, result } = attempt.value;
      const record: BaselineScenarioRecord = {
        tick: result.tick,
        camera: result.camera,
        rect: { w: result.rect.w, h: result.rect.h },
        region: spec.region,
        sha256: sha256(png),
      };

      // The self-checks run in EVERY mode -- compare, bless, and no-baseline.
      // They need no stored reference, so they are the only thing that gates a
      // freshly-blessed environment; and a bless whose toggles fail would
      // enshrine a frame with a dead layer in it as the picture every future
      // run is judged against, which is the one way this gate could make
      // things worse than having no gate at all.
      const self = await runSelfChecks(page, scenario, spec, png, result, args.outDir);
      for (const line of self.lines) console.log(`[${TAG}] scenario "${scenario.id}" ${line}`);
      for (const f of self.failures) console.error(`[${TAG}]   self-check FAILED: ${f}`);
      if (self.checks === 0) {
        console.log(
          `[${TAG}] scenario "${scenario.id}" declares NO reference-free check, so with no baseline ` +
            'it is captured and not judged.'
        );
      }

      // A report-only scenario is captured and self-checked but NOT baselined.
      // Storing one costs real repo weight for a number that cannot vote --
      // `combat`'s PNG alone is 362 KiB, half the whole baseline set, for a
      // scene whose own same-commit noise is wider than the defect this gate
      // catches. Its capture still uploads as a CI artifact, which is what a
      // human triaging a red run actually wants from it.
      if (!gated) {
        console.log(
          `[${TAG}] scenario "${scenario.id}": captured at tick ${record.tick}, NOT baselined ` +
            `(report-only). ${spec.rationale}`
        );
        outcomes.push({
          id: scenario.id,
          gated,
          ok: true,
          selfChecked: self.checks > 0,
          detail: `captured, ${short(png)}`,
        });
        continue;
      }

      // No stored picture to compare against, so the self-checks ARE the
      // verdict for this scenario. A scenario that declares none is `ok`
      // here -- honest rather than generous: this run is explicitly not
      // gating on its appearance, and the summary and exit code say so.
      if (noBaseline) {
        console.log(
          `[${TAG}] scenario "${scenario.id}": captured at tick ${record.tick}, NO BASELINE to ` +
            `compare against. Self-checks: ${
              self.checks === 0 ? 'none declared' : `${self.checks} run, ${self.ok ? 'all PASS' : 'FAILED'}`
            }.`
        );
        outcomes.push({
          id: scenario.id,
          gated,
          ok: self.ok,
          selfChecked: self.checks > 0,
          detail:
            self.checks === 0
              ? 'no baseline; no self-check for this scenario'
              : `no baseline; ${self.checks} self-check(s) ${self.ok ? 'PASS' : 'FAIL'}`,
        });
        continue;
      }

      if (args.bless) {
        mkdirSync(envDir, { recursive: true });
        copyFileSync(png, path.join(envDir, `${scenario.id}.png`));
        manifest.scenarios[scenario.id] = record;
        console.log(
          `[${TAG}] blessed "${scenario.id}" -> ${path.relative(REPO_ROOT, path.join(envDir, `${scenario.id}.png`))} ` +
            `(tick ${record.tick}, sha256 ${record.sha256.slice(0, 12)})`
        );
        outcomes.push({ id: scenario.id, gated, ok: self.ok, selfChecked: self.checks > 0, detail: 'blessed' });
        continue;
      }

      const baselinePng = path.join(envDir, `${scenario.id}.png`);
      const stored = manifest.scenarios[scenario.id];
      if (!existsSync(baselinePng) || !stored) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": the "${key}" baseline has no entry for it. Re-bless ` +
            'that environment (a scenario added since the last bless is a picture nobody has approved).'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, selfChecked: self.checks > 0, detail: 'no baseline entry' });
        continue;
      }
      if (sha256(baselinePng) !== stored.sha256) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": ${path.relative(REPO_ROOT, baselinePng)} does not match the ` +
            'sha256 in manifest.json -- the stored baseline was edited or corrupted outside a bless. ' +
            'Refusing to compare against it.'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, selfChecked: self.checks > 0, detail: 'baseline sha mismatch' });
        continue;
      }
      const drift = capturePreconditionMismatches(stored, result, spec.region);
      if (drift.length > 0) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": the capture no longer matches what the baseline was taken ` +
            `from -- ${drift.join('; ')}. That is a scenario re-authoring, not a rendering regression; ` +
            're-bless with a --reason saying so.'
        );
        outcomes.push({
          id: scenario.id,
          gated,
          ok: false,
          selfChecked: self.checks > 0,
          detail: `capture drift: ${drift.join('; ')}`,
        });
        continue;
      }

      const summary = computeDiff(baselinePng, png, {
        outDir: path.join(args.outDir, scenario.id),
        threshold: PIXELMATCH_THRESHOLD,
        region: spec.region ?? undefined,
      });
      writeFileSync(path.join(args.outDir, scenario.id, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(formatSummary(summary));
      const verdict = evaluateBaseline(summary, spec);
      console.log(
        `[${TAG}] scenario "${scenario.id}" -> ${
          !verdict.gated ? 'REPORT-ONLY (does not vote)' : verdict.ok ? 'PASS' : 'FAIL'
        }`
      );
      console.log(`[${TAG}] scenario "${scenario.id}" thresholds: ${spec.rationale}`);
      if (verdict.gated && !verdict.ok) {
        for (const f of verdict.failures) console.error(`[${TAG}]   over budget: ${f}`);
        console.error(
          `[${TAG}]   diff image: ${summary.diffImagePath}\n` +
            `[${TAG}]   baseline:   ${path.relative(REPO_ROOT, baselinePng)} (blessed ${manifest.blessedAt} ` +
            `at ${manifest.commit.slice(0, 7)} -- "${manifest.reason}")\n` +
            `[${TAG}]   If this change is INTENDED, look at the diff image first, then re-bless:\n` +
            `[${TAG}]     pnpm golden-baseline:bless -- --reason="<what changed>"`
        );
      }
      outcomes.push({
        id: scenario.id,
        gated,
        ok: (verdict.ok || !verdict.gated) && self.ok,
        selfChecked: self.checks > 0,
        detail:
          `diffPixels ${summary.diffPixels}, meanAbsChannelDelta ${summary.meanAbsChannelDelta.toFixed(4)}` +
          (self.checks > 0 ? `; ${self.checks} self-check(s) ${self.ok ? 'PASS' : 'FAIL'}` : ''),
      });
    }

    await page.close();

    if (args.bless) {
      mkdirSync(envDir, { recursive: true });
      // A partial bless is worse than none: a manifest listing three scenarios
      // while the directory holds four PNGs is a baseline nobody can reason
      // about. A full bless therefore drops PNGs no longer named by any
      // scenario. A --scenario-filtered bless MERGES into the existing manifest
      // instead, so re-blessing one scene does not orphan the others.
      if (!args.scenarioIds && existsSync(manifestPath)) {
        for (const f of readdirSync(envDir)) {
          if (f.endsWith('.png') && !manifest.scenarios[f.replace(/\.png$/, '')]) {
            rmSync(path.join(envDir, f));
            console.log(`[${TAG}] dropped stale baseline ${f} (no scenario claims it)`);
          }
        }
      }
      if (args.scenarioIds && existsSync(manifestPath)) {
        const prev = JSON.parse(readFileSync(manifestPath, 'utf8')) as BaselineManifest;
        manifest.scenarios = { ...prev.scenarios, ...manifest.scenarios };
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(
        `\n[${TAG}] blessed ${Object.keys(manifest.scenarios).length} scenario(s) into ` +
          `${path.relative(REPO_ROOT, envDir)} -- ${(dirBytes(envDir) / 1024).toFixed(1)} KiB total.\n` +
          `[${TAG}] reason: "${manifest.reason}"\n` +
          `[${TAG}] Review the PNGs before committing them: they become what every future run is judged against.`
      );
      // Named even though the bless still succeeded: a report-only scenario
      // that could not be captured is invisible in the blessed set (it is
      // never stored) and would otherwise leave no trace at all in the log a
      // reviewer reads.
      const uncaptured = outcomes.filter((o) => o.detail.startsWith('CAPTURE FAILED'));
      if (uncaptured.length > 0) {
        console.error(
          `[${TAG}] ${uncaptured.length} report-only scenario(s) could not be captured and were skipped: ` +
            `${uncaptured.map((o) => o.id).join(', ')}. The bless above is complete -- report-only scenarios ` +
            'are never baselined -- but their frames are missing from this run.'
        );
      }
      return;
    }

    console.log(`\n[${TAG}] ==== summary (env ${key}) ====`);
    for (const o of outcomes) {
      // "PASS" would be a lie on a run with nothing to compare against: the
      // scenario did not pass, it was not judged.
      const status = !o.gated ? 'report-only' : !o.ok ? 'FAIL' : noBaseline ? 'NOT COMPARED' : 'PASS';
      console.log(`  ${o.id}: ${status} -- ${o.detail}`);
    }
    const failed = outcomes.filter((o) => o.gated && !o.ok);
    if (failed.length > 0) {
      console.error(
        `\n[${TAG}] ${failed.length} gated scenario(s) ${noBaseline ? 'failed their self-check' : 'differ from the stored baseline'}: ` +
          `${failed.map((f) => f.id).join(', ')}`
      );
      // A self-check failure is a real finding whether or not a baseline
      // exists, so it takes EXIT_DIFF even here -- exit 3 must never be able
      // to mask one.
      process.exitCode = EXIT_DIFF;
    } else if (noBaseline) {
      // Name the scenarios rather than saying "every available self-check
      // passed", which reads as coverage when two of the five were only
      // captured. The lists are derived, not typed here, so declaring a layer
      // check on a third scenario moves this message on its own.
      const judged = outcomes.filter((o) => o.selfChecked).map((o) => o.id);
      const unjudged = outcomes.filter((o) => !o.selfChecked).map((o) => o.id);
      console.error(
        `\n[${TAG}] NOTHING WAS COMPARED, and ${judged.length} of ${outcomes.length} scenario(s) were judged at all.\n` +
          `[${TAG}]   reference-free self-check: ${judged.length ? judged.join(', ') : '(none)'}\n` +
          `[${TAG}]   captured, NOT judged:      ${unjudged.length ? unjudged.join(', ') : '(none)'}\n` +
          `[${TAG}] There is no "${key}" baseline, so nothing outside those self-checks could have\n` +
          `[${TAG}] been caught. What they DO catch is measured: erasing every decor object, and\n` +
          `[${TAG}] the stone-grain scatter no-op, both exit 1 from exactly this state. What they\n` +
          `[${TAG}] cannot catch is anything no layer check names -- unit meshes, fog, overlays, a\n` +
          `[${TAG}] wrong colour that is still a colour. Bless a baseline before trusting a green\n` +
          `[${TAG}] tick here.`
      );
      process.exitCode = EXIT_NO_BASELINE;
    } else {
      console.log(`\n[${TAG}] all gated scenarios match the "${key}" baseline.`);
      process.exitCode = EXIT_OK;
    }
  } finally {
    await browser.close();
    if (!args.keepServer) stopDevServer(devServer, TAG);
  }
}

/**
 * Exit, for real, with `code`.
 *
 * Not decoration. The first Linux bless threw at 04:43:50, ran its `finally`,
 * printed its error -- and then sat in that step until it was cancelled at
 * 05:23, because the dev server's grandchildren held the inherited stdio pipes
 * open and an event loop with a live handle never drains (`stopDevServer`
 * carries the runner's own list of the nine processes that survived). Setting
 * `process.exitCode` describes an intention; only `process.exit` is a promise.
 *
 * `stopDevServer` is the fix for that particular leak and this is the backstop
 * for the next one, which is the right shape for a script whose whole job is
 * to run unattended on someone else's machine: a wrong exit code is a bug you
 * can see, and a process that never exits is 40 minutes of runner time and a
 * cancelled job that looks like a hang.
 *
 * The empty write is a flush. `process.exit` truncates whatever is still
 * queued on an async stdout -- and stdout IS async when it is a pipe, which is
 * exactly what CI gives it -- so the summary that explains the exit code would
 * be the thing lost. The timer is the second backstop: if even the flush
 * callback cannot land, 2 s later this exits anyway. It is `unref`ed so it
 * cannot itself be the reason a healthy run lingers.
 */
function exitWith(code: number): void {
  const timer = setTimeout(() => process.exit(code), 2_000);
  timer.unref();
  process.stdout.write('', () => process.exit(code));
}

// Guard against the one shared-tree accident this script can cause: the repo's
// own dev server convention is :5173 and `ensureDevServer` would REUSE it
// rather than kill it, but a run pointed there would also drive somebody's
// live tab's origin. Refuse rather than explain it afterwards.
if (process.argv.includes('--port=5173')) {
  console.error(`[${TAG}] refusing --port=5173: that is the convention for a human's own dev server.`);
  process.exitCode = EXIT_USAGE;
  exitWith(EXIT_USAGE);
} else {
  main()
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = EXIT_USAGE;
    })
    // Both paths, deliberately: the success path could hang on a stray handle
    // exactly as the failure path did, and nobody would be watching a green
    // run to notice.
    // `process.exitCode` is typed `number | string | undefined`; only a number
    // is meaningful here, and anything else means nobody set one.
    .finally(() => exitWith(typeof process.exitCode === 'number' ? process.exitCode : EXIT_OK));
}
