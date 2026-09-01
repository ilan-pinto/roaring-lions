// RETIRED AS A GATE -- this is now a REPORT-ONLY cross-backend diagnostic.
//
// It still captures Pixi and three at an identical scene/tick/camera and prints
// the per-pixel difference, which is a useful thing to look at by hand. It no
// longer decides anything and it always exits 0 unless a capture itself fails.
//
// Why, in one paragraph. Since the mesh flip (`362bde7`) the two backends draw
// deliberately different content: three has mesh units, mesh buildings and mesh
// decor, Pixi has none of them and never will, and since 2026-08-30 Pixi's VFX
// are not owed a matching effect either. Measured 2026-09-01, all four scenarios
// sat 1.8x-2.3x over budget with no regression behind it -- re-capturing three
// with `&nomesh` put every one back inside budget, so 100% of the overage was
// the mesh path (`.superpowers/queue/golden-diff-red-report.md`). Recalibrating
// would have blessed a ~12% baseline on `combat`, inside which a broken mesh
// material or a missing unit type would be invisible. The project lead's call
// was to "retire cross-backend and rebuild it as three-vs-three".
//
// THE GATE IS NOW `three-baseline-gate.ts` -- same renderer, same scenario,
// current commit against a committed baseline. Read `../golden-diff/baseline.ts`
// for why that discriminates a defect this file measured 1.945%-vs-1.937% on.
//
// `SCENARIO_BUDGETS` below is kept as HISTORICAL REFERENCE, not as a threshold:
// each number is a real clean measurement of that scenario from before the mesh
// flip, and a run prints how far today's reading sits from it. Do not restore it
// to a pass/fail without first re-reading the report above.
//
// Usage: pnpm golden-diff:compare -- [--port=5174] [--out-dir=path]
//        [--keep-server] [--scenario=<id>[,<id>...]]
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

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { pixiUrl, threeUrl, captureScript, SCENARIOS, type Scenario } from '../golden-diff/capture-protocol';
import {
  CAPTURE_VIEWPORT,
  capture,
  ensureDevServer,
  launchCaptureBrowser,
} from '../golden-diff/browser';
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
  vehicle: {
    // Calibrated against two real headless runs of THIS exact scenario, on this
    // worktree's HEAD (targetTick 140, so both runs land on the identical
    // absolute sim tick -- see Scenario.targetTick's own comment for why that
    // matters here specifically): 0.774% / 4.747 and 0.780% / 4.747 --
    // reproducible to within software-GL rasterisation noise (`quiet`'s own
    // comment names this same caveat), not tick drift. This scenario has no
    // `groundTextureCheck`-style embedded, accepted gap the way `open-ground`
    // does (its diff is dominated by antialiasing fringe around vehicle/terrain
    // edges, per `expected-differences.ts`'s `antialiasing` entry, not a
    // catalogued shape/softness divergence) -- headroom is set closer to
    // `quiet`'s own ~3x-of-clean-baseline spirit rather than `open-ground`'s
    // tighter ~1.5x.
    maxDiffPixelPct: 2.4,
    maxMeanAbsChannelDelta: 12,
    rationale:
      '~3x the real headless clean baseline (0.774-0.780% / 4.747, two runs, this HEAD) -- ' +
      "vehicles in frame at native zoom, the content neither `quiet` nor `open-ground` puts " +
      'on screen. No embedded accepted gap the way open-ground has, so headroom follows ' +
      "`quiet`'s wider style rather than open-ground's tighter one.",
  },
  combat: {
    // Calibrated against THREE real headless runs of this exact scenario, this
    // worktree's HEAD (both captures aligned to identical absolute ticks --
    // orders queued at tick 20, captured at tick 600 -- via Scenario.orders/
    // targetTick, so the spread below is genuine rendering-path/VFX-timing
    // noise, not order-queuing or tick drift): 4.110%/7.146, 3.700%/6.849,
    // 3.917%/7.062 -- mean ~3.91% / ~7.02, spread ~10% relative, wider than
    // `vehicle`'s two-run spread because this scene has real deaths (wrecks,
    // structure collapse) and real VFX (tracers, impacts, dust) in it, both
    // documented as either accepted-divergent (`unitWreckMissingInThree`,
    // `structureLastAlpha`) or fully exempt (`vfxThreeOnly`,
    // CLAUDE.md's 2026-08-30 VFX-exemption note) in `expected-differences.ts`
    // -- this budget does NOT subtract those pixels out, it just carries wider
    // headroom to avoid the gate crying wolf on content it already knows is
    // allowed to differ. A diff image was inspected by eye for this
    // calibration (not just the percentage): the large solid-fill regions
    // trace directly to dead units/wrecks and impact/dust VFX clusters, not to
    // a shape the catalogue doesn't already name.
    maxDiffPixelPct: 7,
    maxMeanAbsChannelDelta: 14,
    rationale:
      '~1.8x the real headless clean baseline (mean 3.91%/7.02 across 3 runs, this HEAD) -- real ' +
      'combat: units firing, dying, leaving wrecks, VFX playing. Wider than `vehicle` because this ' +
      'scene carries several already-accepted or VFX-exempt divergence classes at once, not because ' +
      'it is less trustworthy as a gate -- see this rationale comment above for what was checked.',
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

interface ScenarioResult {
  scenario: Scenario;
  ok: boolean;
  comparable: boolean;
  summary: DiffSummary | null;
}

async function runScenario(page: Page, port: number, outDir: string, scenario: Scenario): Promise<ScenarioResult> {
  const budget = budgetFor(scenario);
  const scene = scenario.mission !== undefined ? `mission=${scenario.mission}` : `sandbox=${scenario.sandboxMap}`;
  const cam = scenario.cameraTile !== undefined ? `tile=${JSON.stringify(scenario.cameraTile)}` : `marker=${scenario.cameraMarker}`;
  console.log(
    `\n[golden-diff-gate] scenario "${scenario.id}": ${scene} ${cam} ticks=${scenario.ticks}` +
      `${scenario.targetTick !== undefined ? ` targetTick=${scenario.targetTick}` : ''}` +
      `${scenario.zoom !== undefined ? ` zoom=${scenario.zoom}` : ''} port=${port}`
  );
  const scenarioOutDir = path.join(outDir, scenario.id);
  mkdirSync(scenarioOutDir, { recursive: true });
  const pixiPng = path.join(scenarioOutDir, 'pixi.png');
  const threePng = path.join(scenarioOutDir, 'three.png');
  const script = captureScript(scenario);
  const needsDeploy = scenario.mission !== undefined;
  const pixiResult = await capture(page, pixiUrl(port, scenario), script, pixiPng, `${scenario.id}/pixi`, needsDeploy);
  const threeResult = await capture(page, threeUrl(port, scenario), script, threePng, `${scenario.id}/three`, needsDeploy);

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

  // Reported against the pre-mesh-flip reference numbers, never enforced. A
  // reading over them is the EXPECTED state of this diagnostic today -- Pixi
  // does not draw the content three draws -- so calling it PASS/FAIL would be
  // lying about what was measured.
  const withinHistorical =
    summary.diffPixelPct < budget.maxDiffPixelPct && summary.meanAbsChannelDelta < budget.maxMeanAbsChannelDelta;
  console.log(
    `[golden-diff-gate] scenario "${scenario.id}": diffPixelPct ${summary.diffPixelPct.toFixed(3)}% ` +
      `(pre-mesh-flip reference <${budget.maxDiffPixelPct}%), meanAbsChannelDelta ` +
      `${summary.meanAbsChannelDelta.toFixed(3)} (reference <${budget.maxMeanAbsChannelDelta}) -> ` +
      `${withinHistorical ? 'within the old reference' : 'OVER the old reference (expected since the mesh flip)'}`
  );
  console.log(`[golden-diff-gate] scenario "${scenario.id}" reference provenance: ${budget.rationale}`);

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

  if (!textureOk || !withinHistorical) {
    console.log(
      `[golden-diff-gate] scenario "${scenario.id}": before reading any of the ${summary.diffPixels} ` +
        `differing pixels as a bug, check them against the ${EXPECTED_DIFFERENCES.length} known ` +
        `expected-difference entries:\n\n${formatExpectedDifferences()}`
    );
  }
  // `ok` is now "the two captures were comparable and the diff ran", not a
  // verdict on the picture. The verdict lives in `three-baseline-gate.ts`.
  return { scenario, ok: true, comparable: true, summary };
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

  const devServer = await ensureDevServer(port, REPO_ROOT, 'golden-diff-gate');
  const browser = await launchCaptureBrowser();
  try {
    const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT } });

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(page, port, outDir, scenario));
    }
    await page.close();

    console.log('\n[golden-diff-gate] ==== cross-backend report (NOT a gate) ====');
    for (const r of results) {
      const pct = r.summary ? `${r.summary.diffPixelPct.toFixed(3)}%` : 'n/a';
      console.log(`  ${r.scenario.id}: ${r.comparable ? `diffPixelPct ${pct}` : 'NOT COMPARABLE (camera/rect mismatch)'}`);
    }
    console.log(
      '\n[golden-diff-gate] This tool reports; it does not vote. The visual gate is\n' +
        '[golden-diff-gate]   pnpm golden-baseline   (tools/src/ci/three-baseline-gate.ts)\n' +
        '[golden-diff-gate] which compares three against a committed three baseline.'
    );
    // A camera/rect mismatch means the two captures were never comparable --
    // a broken protocol rather than a rendering difference, so it is still an
    // error even though the picture is no longer judged.
    if (results.some((r) => !r.comparable)) process.exitCode = 1;
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
