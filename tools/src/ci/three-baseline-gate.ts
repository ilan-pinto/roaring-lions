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
//   3  no baseline exists for THIS capture environment (actionable, and
//      impossible once one has been blessed here)
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
  type CaptureResult,
} from '../golden-diff/browser';

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
    outDir: flags.get('out-dir') ?? path.join(REPO_ROOT, '.superpowers', 'three-baseline'),
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
 *  environment with no blessed baseline. */
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

    if (!args.bless && !existsSync(manifestPath)) {
      // Never a silent pass. A baseline captured through a different GL backend
      // is measurably worse than none (see `envKey`'s comment), and cross-OS
      // portability was never measured, so the gate stops with its own distinct
      // exit code and the workflow decides what that means.
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
          `[${TAG}]   pnpm golden-baseline:bless -- --reason="first baseline for ${key}"\n`
      );
      process.exitCode = EXIT_NO_BASELINE;
      return;
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
      : (JSON.parse(readFileSync(manifestPath, 'utf8')) as BaselineManifest);

    if (!args.bless) {
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
      const { png, result } = await captureScenario(page, args.port, args.outDir, scenario);
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
        outcomes.push({ id: scenario.id, gated, ok: true, detail: `captured, ${short(png)}` });
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
        outcomes.push({ id: scenario.id, gated, ok: true, detail: 'blessed' });
        continue;
      }

      const baselinePng = path.join(envDir, `${scenario.id}.png`);
      const stored = manifest.scenarios[scenario.id];
      if (!existsSync(baselinePng) || !stored) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": the "${key}" baseline has no entry for it. Re-bless ` +
            'that environment (a scenario added since the last bless is a picture nobody has approved).'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, detail: 'no baseline entry' });
        continue;
      }
      if (sha256(baselinePng) !== stored.sha256) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": ${path.relative(REPO_ROOT, baselinePng)} does not match the ` +
            'sha256 in manifest.json -- the stored baseline was edited or corrupted outside a bless. ' +
            'Refusing to compare against it.'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, detail: 'baseline sha mismatch' });
        continue;
      }
      const drift = capturePreconditionMismatches(stored, result, spec.region);
      if (drift.length > 0) {
        console.error(
          `[${TAG}] scenario "${scenario.id}": the capture no longer matches what the baseline was taken ` +
            `from -- ${drift.join('; ')}. That is a scenario re-authoring, not a rendering regression; ` +
            're-bless with a --reason saying so.'
        );
        outcomes.push({ id: scenario.id, gated, ok: false, detail: `capture drift: ${drift.join('; ')}` });
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
      return;
    }

    console.log(`\n[${TAG}] ==== summary (env ${key}) ====`);
    for (const o of outcomes) {
      const status = !o.gated ? 'report-only' : o.ok ? 'PASS' : 'FAIL';
      console.log(`  ${o.id}: ${status} -- ${o.detail}`);
    }
    const failed = outcomes.filter((o) => o.gated && !o.ok);
    if (failed.length > 0) {
      console.error(
        `\n[${TAG}] ${failed.length} gated scenario(s) differ from the stored baseline: ` +
          `${failed.map((f) => f.id).join(', ')}`
      );
      process.exitCode = EXIT_DIFF;
    } else {
      console.log(`\n[${TAG}] all gated scenarios match the "${key}" baseline.`);
      process.exitCode = EXIT_OK;
    }
  } finally {
    await browser.close();
    if (devServer && !args.keepServer) devServer.kill('SIGTERM');
  }
}

// Guard against the one shared-tree accident this script can cause: the repo's
// own dev server convention is :5173 and `ensureDevServer` would REUSE it
// rather than kill it, but a run pointed there would also drive somebody's
// live tab's origin. Refuse rather than explain it afterwards.
if (process.argv.includes('--port=5173')) {
  console.error(`[${TAG}] refusing --port=5173: that is the convention for a human's own dev server.`);
  process.exitCode = EXIT_USAGE;
} else {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = EXIT_USAGE;
  });
}
