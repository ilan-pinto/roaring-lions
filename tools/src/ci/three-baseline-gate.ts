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
//      still runs `groundTextureCheck`; a self-check FAILURE is exit 1 even
//      with no baseline.
//
// WHAT EXIT 3 DOES NOT PROMISE, because this comment used to promise it and a
// measurement said otherwise. It said "3 can never mask a real finding". It
// can, and here is the run that proves it. `groundTextureCheck` is declared by
// ONE scenario -- `open-ground` -- so on an unblessed runner that single 450x400
// ground crop is the only thing judged and the other four scenarios are
// captured and not compared to anything. Measured 2026-09-02 on this branch:
// erasing every decor object (`decor-place.ts`'s `familyFor` -> `return null`:
// no boulder, rock, tree, bush, slab, grass or sand anywhere on any map) fails
// all four gated scenarios WITH a baseline -- quiet 4306 px / 0.5064,
// open-ground 952 / 0.4753, vehicle 19313 / 2.0243, relief 37183 / 2.7229,
// exit 1 -- and exits 3 with none, which `ci.yml` turns into a green tick.
// `open-ground`'s own self-check read `fraction 0.9408 (budget <0.95) -> PASS`
// in that run, the SAME number a clean tree reads, while the same crop's
// baseline diff was 952 px: the crop moved and the structural check did not.
//
// So exit 3 means "one crop of one scenario was checked and nothing was
// COMPARED", not "a real defect would still be caught". The scatter defect
// happens to be the class `groundTextureCheck` was built for and does exit 1
// with no baseline; nothing generalises from that to a second defect. Bless a
// baseline for the environment -- that is the fix, and it is the only one.
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
import { threeUrl, captureScript, SCENARIOS, type Scenario } from '../golden-diff/capture-protocol';
import { computeDiff, formatSummary, computeDominantColorFraction } from '../golden-diff/diff';
import {
  EXIT_DIFF,
  EXIT_NO_BASELINE,
  EXIT_OK,
  EXIT_USAGE,
  capturePreconditionMismatches,
  envKey,
  evaluateBaseline,
  isGated,
  specFor,
  type BaselineManifest,
  type BaselineScenarioRecord,
} from '../golden-diff/baseline';
import {
  CAPTURE_VIEWPORT,
  capture,
  ensureDevServer,
  launchCaptureBrowser,
  readUnmaskedRenderer,
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

/** The same-renderer structural self-check `golden-diff-gate.ts` introduced
 *  alongside `Scenario.groundTextureCheck`. It never depended on Pixi, so it
 *  moves here intact -- and unlike the baseline comparison it needs no stored
 *  reference at all, which means it is the one check that still works in an
 *  environment with no blessed baseline.
 *
 *  Its REACH is one scenario and one property, and the difference matters on
 *  an unblessed runner where it is the whole verdict. Only `open-ground`
 *  declares a `groundTextureCheck`; it asks a single question about a single
 *  450x400 crop -- how much of it is the one most common colour -- and a
 *  regression that leaves that fraction alone is invisible to it however large
 *  it is elsewhere. See the exit-code block at the top of this file for the
 *  decor deletion that reads 4306-37183 differing pixels against a baseline
 *  and PASSES this check at the clean tree's own 0.9408. */
function runGroundTextureCheck(scenario: Scenario, png: string): { ok: boolean; line: string } | null {
  if (!scenario.groundTextureCheck) return null;
  const { region, maxBackgroundFraction } = scenario.groundTextureCheck;
  const dom = computeDominantColorFraction(png, region);
  const ok = dom.dominantFraction < maxBackgroundFraction;
  return {
    ok,
    line:
      `groundTextureCheck: dominantColor rgb(${dom.dominantColor.join(',')}) ` +
      `fraction ${dom.dominantFraction.toFixed(4)} (budget <${maxBackgroundFraction}), ` +
      `distinctColors ${dom.distinctColors} -> ${ok ? 'PASS' : 'FAIL'}`,
  };
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
    // made this file's own claim about `groundTextureCheck` -- "unlike the
    // baseline comparison it needs no stored reference at all, which means it
    // is the one check that still works in an environment with no blessed
    // baseline" -- false in exactly the environment it was written for:
    // nothing was captured, so nothing was checked. Combined with the bless
    // workflow being unable to create a first baseline at all
    // (`visual-baseline-bless.yml`, fixed in the same commit), CI ran a
    // green-ticking no-op. Now the run captures every scenario, runs whatever
    // self-check each one declares, and exits 1 if a self-check FAILS -- only
    // an otherwise-clean run reaches the softer exit 3.
    //
    // "Whatever each one declares" is one scenario: `open-ground`. That is the
    // honest size of what exit 3 still checks, and the exit-code block at the
    // top of this file carries the defect measured walking straight past it.
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
          `[${TAG}] Capturing anyway, so the reference-free groundTextureCheck still votes --\n` +
          `[${TAG}] but ONE scenario declares one (open-ground), so this run judges a single\n` +
          `[${TAG}] 450x400 ground crop and compares nothing else. A defect that leaves that\n` +
          `[${TAG}] crop's dominant-colour fraction alone passes here at any size.\n`
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

      // The self-check runs in both modes: it needs no baseline, so it is the
      // one thing that still gates a freshly-blessed environment.
      const texture = runGroundTextureCheck(scenario, png);
      if (texture) console.log(`[${TAG}] scenario "${scenario.id}" ${texture.line}`);

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
        outcomes.push({ id: scenario.id, gated, ok: true, selfChecked: texture !== null, detail: `captured, ${short(png)}` });
        continue;
      }

      // No stored picture to compare against, so the self-check is the whole
      // verdict for this scenario. `textureOk` is `true` for a scenario with no
      // `groundTextureCheck` -- that is honest rather than generous: this run
      // is explicitly not gating on appearance, and says so in its summary and
      // its exit code.
      if (noBaseline) {
        const textureOk = texture ? texture.ok : true;
        console.log(
          `[${TAG}] scenario "${scenario.id}": captured at tick ${record.tick}, NO BASELINE to ` +
            `compare against. Self-check ${texture ? (textureOk ? 'PASS' : 'FAIL') : 'not available for this scenario'}.`
        );
        outcomes.push({
          id: scenario.id,
          gated,
          ok: textureOk,
          selfChecked: texture !== null,
          detail: texture
            ? `no baseline; groundTextureCheck ${textureOk ? 'PASS' : 'FAIL'}`
            : 'no baseline; no self-check for this scenario',
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
        outcomes.push({ id: scenario.id, gated, ok: true, selfChecked: texture !== null, detail: 'blessed' });
        continue;
      }

      const baselinePng = path.join(envDir, `${scenario.id}.png`);
      const stored = manifest.scenarios[scenario.id];
      if (!existsSync(baselinePng) || !stored) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": the "${key}" baseline has no entry for it. Re-bless ` +
            'that environment (a scenario added since the last bless is a picture nobody has approved).'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, selfChecked: texture !== null, detail: 'no baseline entry' });
        continue;
      }
      if (sha256(baselinePng) !== stored.sha256) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": ${path.relative(REPO_ROOT, baselinePng)} does not match the ` +
            'sha256 in manifest.json -- the stored baseline was edited or corrupted outside a bless. ' +
            'Refusing to compare against it.'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, selfChecked: texture !== null, detail: 'baseline sha mismatch' });
        continue;
      }
      const drift = capturePreconditionMismatches(stored, result, spec.region);
      if (drift.length > 0) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": the capture no longer matches what the baseline was taken ` +
            `from -- ${drift.join('; ')}. That is a scenario re-authoring, not a rendering regression; ` +
            're-bless with a --reason saying so.'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, selfChecked: texture !== null, detail: `capture drift: ${drift.join('; ')}` });
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
      const textureOk = texture ? texture.ok : true;
      outcomes.push({
        id: scenario.id,
        gated,
        ok: (verdict.ok || !verdict.gated) && textureOk,
        selfChecked: texture !== null,
        detail: `diffPixels ${summary.diffPixels}, meanAbsChannelDelta ${summary.meanAbsChannelDelta.toFixed(4)}`,
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
      // passed", which reads as coverage and is one crop of one scenario. The
      // lists are derived, not typed here, so adding a `groundTextureCheck` to
      // a second scenario moves this message on its own.
      const judged = outcomes.filter((o) => o.selfChecked).map((o) => o.id);
      const unjudged = outcomes.filter((o) => !o.selfChecked).map((o) => o.id);
      console.error(
        `\n[${TAG}] NOTHING WAS COMPARED, and ${judged.length} of ${outcomes.length} scenario(s) were judged at all.\n` +
          `[${TAG}]   reference-free self-check: ${judged.length ? judged.join(', ') : '(none)'}\n` +
          `[${TAG}]   captured, NOT judged:      ${unjudged.length ? unjudged.join(', ') : '(none)'}\n` +
          `[${TAG}] There is no "${key}" baseline, so nothing outside that self-check could have\n` +
          `[${TAG}] been caught. This is not a theoretical gap: erasing every decor object fails\n` +
          `[${TAG}] all four gated scenarios against a baseline (relief 37183 px / 2.7229) and\n` +
          `[${TAG}] reaches this exit instead, with open-ground's self-check reading the clean\n` +
          `[${TAG}] tree's own number. Bless a baseline before trusting a green tick here.`
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
