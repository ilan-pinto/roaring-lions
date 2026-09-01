// The pure, Node-only half of the three-vs-three baseline gate: where a
// baseline lives, what counts as a match, and what "the same capture
// environment" means. No browser, no GPU, no filesystem walk -- everything
// here is a function of its arguments so `baseline.test.ts` can exercise it in
// `pnpm test`, which is the only part of this gate that runs on every push.
//
// ============================================================================
// Why this exists at all: cross-backend could not see the bug it was built for
// ============================================================================
//
// `golden-diff-gate.ts` compared the Pixi capture against the three capture and
// failed the build on the difference. Since the mesh flip (`362bde7`) that
// comparison measures a divergence the project chose on purpose -- Pixi has no
// mesh units, no mesh buildings, no mesh decor and, since 2026-08-30, is not
// owed a matching VFX -- so all four of its scenarios sit 1.8x-2.3x over
// budget with no regression behind it (`.superpowers/queue/golden-diff-red-report.md`).
// The project lead's call was to retire that pass/fail and rebuild the gate as
// three-vs-three.
//
// The evidence that three-vs-three is the better INSTRUMENT, not merely the
// politically-available one, was already written in `capture-protocol.ts`'s
// `OPEN_GROUND_SCENARIO` comment: on the stone-grain scatter defect
// (`671acdb` -> `d9fd1c7`) the cross-backend diff read 1.945% buggy against
// 1.937% fixed -- indistinguishable, and not even ordered the right way --
// while a same-renderer, cross-commit diff separated them 485 pixels vs 14.
// The author's stated blocker was that "a CI gate only ever has ONE commit's
// captures to look at, not a before/after pair". Storing a baseline removes
// that blocker, which is what this file is.
//
// ============================================================================
// Three measured facts that shaped every number below
// ============================================================================
//
// Both from the noise measurement in `.superpowers/queue/golden-three-report.md`
// (macOS 15 / M3 Pro, headless Chromium, 1400x900, deviceScaleFactor 1):
//
// 1. RUN-TO-RUN NOISE IS NOT SPREAD OVER THE FRAME. It sits in tight clusters
//    around animating mesh units and real-time VFX; every other pixel is
//    bit-identical across repeated captures. A per-block stability map over 3
//    captures of the `vehicle` scenario showed the whole frame at zero except
//    six 100px blocks around the vehicles and their dust. That is why each
//    entry below carries a `region`: scoping `open-ground` to a declared
//    unit-free ground crop took its own run-to-run noise from 1762 differing
//    pixels / 0.1544 meanAbsChannelDelta to **0 / 0.0000**.
//
// 2. `pixelmatch`'s DIFFERING-PIXEL COUNT IS BLIND TO THE DEFECT CLASS THIS
//    RENDERER ACTUALLY SUFFERS. Colour here is quantised onto a palette, so a
//    real regression moves a large area by ONE palette step -- 19/255 for the
//    scatter defect, comfortably under pixelmatch's 0.1 perceptual threshold.
//    Re-injecting that exact defect into today's HEAD and capturing gave
//    `diffPixels = 0` on the open-ground crop while `meanAbsChannelDelta` read
//    **0.3519** against a measured noise floor of 0.0000. So
//    `maxMeanAbsChannelDelta` is the primary metric of this gate and
//    `maxDiffPixels` is the secondary one -- the reverse of how a golden-image
//    gate is usually written, and the reason is measured, not stylistic.
//
// 3. WHAT LOOKED LIKE RENDERER NOISE WAS THE HARNESS TAKING THE WRONG FRAME,
//    and it was worth 28% false reds on `vehicle` before it was found. Pinning
//    the tick the capture script STEPS TO does not pin the tick the SCREENSHOT
//    sees: `main.ts`'s rAF loop keeps ticking and repainting between
//    `page.evaluate(captureScript)` and `page.screenshot()`. Reading
//    `sim.tickCount` right after the screenshot on 20 runs gave 167-171 every
//    time against a capture script that returned 140. `capture()` now kills
//    the frame loop before its settle (`FREEZE_FRAME_LOOP_STATEMENTS`), and
//    every threshold below is calibrated against 24 consecutive full-gate runs
//    taken that way -- see each entry's own comment for its before and after.
//    The lesson generalises: measure the spread over enough runs to see a
//    second mode, and treat a bimodal noise reading as a bug to find rather
//    than a band to widen.

import type { DiffSummary, Region } from './diff';

/** How a captured frame is compared against its stored baseline. */
export interface BaselineSpec {
  /** Sub-rectangle of the 1400x900 capture that the comparison covers, or
   *  `null` for the whole frame. Chosen so the region contains no content
   *  whose appearance depends on real (wall-clock) time -- see fact 1 above. */
  region: Region | null;
  /** Fails the scenario when the candidate differs from the baseline by more
   *  than this many pixels, at pixelmatch's 0.1 threshold, inside `region`. */
  maxDiffPixels: number;
  /** Fails the scenario when the mean absolute per-channel delta over every
   *  pixel of `region` exceeds this. THE primary metric -- see fact 2. */
  maxMeanAbsChannelDelta: number;
  /** `false` keeps the scenario captured and reported but out of the pass/fail
   *  decision, for a scene whose measured noise leaves no room for a
   *  threshold. Reported, never silently dropped. Omitted means gated -- a new
   *  entry has to opt OUT, which is the direction that fails loudly when
   *  someone forgets. */
  gated?: boolean;
  /** Provenance for both numbers, printed on every run so it travels with the
   *  result rather than only with this file. */
  rationale: string;
}

/** Per-scenario baseline configuration, keyed by `Scenario.id`.
 *
 *  Every threshold is calibrated against THIS scenario's own measured
 *  run-to-run noise on a fixed capture environment, never against another
 *  scenario's number and never widened to clear a failing run -- the same rule
 *  `golden-diff-gate.ts`'s `SCENARIO_BUDGETS` already stated and the same rule
 *  `tuning.ts` follows. The measurements are in
 *  `.superpowers/queue/golden-three-report.md`; the short form is in each
 *  `rationale`. */
export const BASELINES: Readonly<Record<string, BaselineSpec>> = {
  quiet: {
    // The camera sits on `town_center` while the sandbox force spawns at the
    // friendly anchor, so almost nothing in this framing is driven by
    // wall-clock time and the whole frame qualifies. What it covers is exactly
    // what the cross-backend gate could never judge: mesh buildings, mesh
    // decor trees and the mosque compound, none of which Pixi draws at all.
    //
    // RECALIBRATED after the frame-loop freeze. The bimodal 0-2 / 41 px noise
    // this entry used to describe was the rAF race, not a lazy asset load: the
    // screenshot was taken while `main.ts`'s `loop()` was still painting, so it
    // captured either the frame `step()` drew or a later one. With the loop
    // frozen (`FREEZE_FRAME_LOOP_STATEMENTS`) 24 consecutive full-gate runs
    // read 0 or 1 differing pixels and 0.0000-0.0001 -- unimodal, and 41x
    // tighter on magnitude. Thresholds are 40x that.
    region: null,
    maxDiffPixels: 40,
    maxMeanAbsChannelDelta: 0.004,
    rationale:
      'whole frame, no units in shot. Noise 0-1 px / 0.0000-0.0001 over 24 consecutive gate runs ' +
      '(macOS SwiftShader, frame loop frozen); thresholds are 40x that. The re-injected scatter ' +
      'defect reads 14 px / 0.0470 -- 12x over the magnitude threshold, and 470x the noise floor, ' +
      'while the pixel count moves by 13.',
  },
  'open-ground': {
    // The same crop `groundTextureCheck` already uses, and for the same
    // reason: it was confirmed unit-free and HUD-free at this scenario's exact
    // framing. Whole-frame here is NOT usable -- sandbox infantry stand in the
    // top-left of the shot and their rigged idle clip advances on wall-clock
    // time, giving 879-1762 differing pixels / 0.087-0.154 run to run even
    // with the tick pinned. Inside the crop the same six captures are
    // bit-identical: 0 px / 0.0000.
    region: { x: 950, y: 500, w: 450, h: 400 },
    // Tightened from 60 / 0.050 once 24 consecutive runs read a literal zero
    // inside the crop. Still above the 25 px / 0.0131 a different GL backend
    // costs on this crop -- that number is a deliberate cushion, not the
    // calibration basis, since baselines are env-keyed and a backend change
    // should be a re-bless rather than a red run.
    maxDiffPixels: 40,
    maxMeanAbsChannelDelta: 0.02,
    rationale:
      'unit-free ground crop (the groundTextureCheck region). Noise 0 px / 0.0000 over 24 ' +
      'consecutive gate runs; a different GL backend on the same machine moves it to 25 px / ' +
      '0.0131, which is the cushion these thresholds sit above rather than their calibration ' +
      'basis. The re-injected scatter defect reads 0 px / 0.3519 -- 17x over the threshold on ' +
      'meanAbsChannelDelta and literally invisible to the pixel count. This is the scenario that ' +
      'discriminates the defect cross-backend measured 1.945%-vs-1.937% on.',
  },
  vehicle: {
    // Whole frame: the vehicles' own dust and exhaust are the only real-time
    // content. Cropping them out would remove the only mesh VEHICLES the gate
    // ever looks at, so the noise is paid here rather than dodged.
    //
    // THIS ENTRY'S OLD NUMBERS WERE THE BEST CASE, NOT THE SPREAD, and it made
    // the scenario false-red 28% of the time on an unmodified tree: an
    // independent 18-run sample measured 45-1549 px / 0.0110-0.1299, strongly
    // bimodal (13 runs low, 5 runs 1164-1549), where this file had recorded
    // 78-133 px / 0.0136-0.0170. The cause was not a lazy load and not a
    // settling race in the renderer: the app's rAF loop kept ticking and
    // repainting between `page.evaluate(captureScript)` and
    // `page.screenshot()`, so the picture was whichever frame in the tick
    // 140-168 window the compositor held -- confirmed by reading
    // `sim.tickCount` after the screenshot on 20 runs and getting 167-171
    // every time against a script that returned 140.
    //
    // Freezing the frame loop (`FREEZE_FRAME_LOOP_STATEMENTS`) removed the
    // race, not merely narrowed it. Re-measured over 24 consecutive full-gate
    // runs: 5-101 px / 0.0029-0.0058, unimodal, no run outside it. Thresholds
    // are 3.0x and 3.4x the observed maximum, the same headroom convention the
    // other entries use -- NOT widened to absorb the flake.
    region: null,
    maxDiffPixels: 300,
    maxMeanAbsChannelDelta: 0.02,
    rationale:
      'whole frame, mesh vehicles plus continuous dust/exhaust FX. Noise 5-101 px / 0.0029-0.0058 ' +
      'over 24 consecutive gate runs (macOS SwiftShader, frame loop frozen), unimodal; thresholds ' +
      'are 3.0x and 3.4x the observed maximum. The re-injected scatter defect reads 63 px / 0.1953 ' +
      '-- 10x over on meanAbsChannelDelta, and INSIDE the noise band on pixel count, which is why ' +
      'magnitude is the primary metric here.',
  },
  relief: {
    // MAP COVERAGE. The other four scenarios look at two of the five shipped
    // maps, both of them flat and boulder-free, which is how deleting every
    // boulder decor object left the whole gate green (see
    // `RELIEF_SCENARIO`'s own comment). This one frames `tel_marum`'s narrow
    // corridor: the T1-C boulder field, the rock-ridge walls either side of
    // it, and the elevation band the corridor cuts.
    //
    // Whole frame, and the measurement earns it: 0 px / 0.0000 over 24
    // consecutive gate runs. That is despite one unit being in shot -- the
    // `recon_drone` the scenario orders forward so the fog lifts at all (see
    // `RELIEF_SCENARIO`). It is one small hovering mesh at a pinned tick, and
    // with the frame loop frozen its animation clock no longer advances by a
    // wall-clock amount either, so there is no unstable cluster to crop
    // around. If a future change puts real-time content here, crop it the way
    // `open-ground` does rather than widening these numbers.
    region: null,
    maxDiffPixels: 40,
    maxMeanAbsChannelDelta: 0.004,
    rationale:
      'whole frame, tel_marum boulder corridor @ tile (10,15) zoom 2, tick 500 -- the T1-C boulder ' +
      'field plus the extruded rock-ridge relief either side of it. Noise 0 px / 0.0000 over 24 ' +
      'consecutive gate runs (macOS SwiftShader). Deleting every boulder decor object reads 36001 ' +
      'px / 2.6292 here -- 900x and 657x the thresholds -- while quiet, open-ground and vehicle do ' +
      'not move outside their own noise at all. The scatter defect also fires here, at 86 px / ' +
      '0.1452, so this is map coverage rather than a single-feature tripwire.',
  },
  combat: {
    // NOT GATED, and this is a finding rather than a gap. Real deaths, wrecks,
    // collapse and VFX put 969-3847 differing pixels / 0.19-0.36
    // meanAbsChannelDelta between two captures of the same commit. The
    // re-injected scatter defect reads 3231 px / 0.6006 on this same scenario
    // -- INSIDE the noise band on pixel count and only 1.7x it on
    // meanAbsChannelDelta. No threshold placed between those is a signal. It
    // is still captured, still diffed and still reported (and its PNGs still
    // upload as CI artifacts) so a human can look; it just does not vote.
    region: null,
    maxDiffPixels: 0,
    maxMeanAbsChannelDelta: 0,
    gated: false,
    rationale:
      'REPORT-ONLY. Same-commit noise 969-3847 px / 0.19-0.36; the re-injected scatter defect reads ' +
      '3231 px / 0.6006 -- inside the noise on pixel count, 1.7x it on meanAbsChannelDelta. No ' +
      'honest threshold exists between them, so this scene is reported and not voted on.',
  },
} as const;

/** `gated` defaults to true so a new entry has to opt OUT of the gate rather
 *  than opt in -- the direction that fails loudly when someone forgets. */
export function isGated(spec: BaselineSpec): boolean {
  return spec.gated !== false;
}

export function specFor(scenarioId: string): BaselineSpec {
  const s = BASELINES[scenarioId];
  if (!s) {
    throw new Error(
      `three-baseline-gate: no BASELINES entry for scenario "${scenarioId}" -- add one, calibrated ` +
        'against a real repeated-capture noise measurement of THAT scenario, before gating it.'
    );
  }
  return s;
}

// ============================================================================
// Capture environment
// ============================================================================

/** Reduces a WebGL `UNMASKED_RENDERER_WEBGL` string to a short, stable family
 *  name. The full string carries a driver version that churns without changing
 *  a pixel ("ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified
 *  Version)"), so keying a baseline directory on it verbatim would orphan the
 *  baseline on every Chromium bump. */
export function glFamily(unmaskedRenderer: string): string {
  const s = unmaskedRenderer.toLowerCase();
  if (s.includes('swiftshader')) return 'swiftshader';
  if (s.includes('llvmpipe') || s.includes('softpipe')) return 'llvmpipe';
  if (s.includes('metal')) return 'metal';
  if (s.includes('direct3d') || s.includes('d3d')) return 'd3d';
  if (s.includes('opengl') || s.includes('vulkan')) return 'gl';
  return 'unknown';
}

/** The directory name a baseline is stored under.
 *
 *  Baselines are keyed by capture environment because a shared one is
 *  measurably worse, not because it is tidier. On this machine, the SAME
 *  commit captured through SwiftShader and through ANGLE/Metal differs by 230
 *  px / 0.0320 on `quiet` and 1988 px / 0.1862 on `vehicle` -- 100x and 12x the
 *  run-to-run noise those scenarios carry within one backend, and enough to
 *  swallow the scatter defect's own 0.0493 signal on `quiet` whole. A single
 *  portable baseline would therefore have to run at thresholds wide enough to
 *  miss the one defect this gate exists to catch. `combat` is worse still at
 *  46357 px / 2.9350, though it is report-only for its own reasons.
 *
 *  Cross-OS portability (Linux SwiftShader vs macOS SwiftShader) is NOT
 *  measured -- there is no Linux runner in reach of the session that built
 *  this -- so it is not assumed either: an unrecognised key is a loud,
 *  actionable stop (`EXIT_NO_BASELINE`), never a silent pass. */
export function envKey(platform: string, arch: string, unmaskedRenderer: string): string {
  return `${platform}-${arch}-${glFamily(unmaskedRenderer)}`;
}

// ============================================================================
// Verdict
// ============================================================================

export interface BaselineVerdict {
  ok: boolean;
  gated: boolean;
  /** Every threshold that was crossed, in the words the gate prints. Empty
   *  when `ok`. */
  failures: string[];
}

export function evaluateBaseline(summary: DiffSummary, spec: BaselineSpec): BaselineVerdict {
  const gated = isGated(spec);
  if (!gated) return { ok: true, gated: false, failures: [] };
  const failures: string[] = [];
  if (summary.meanAbsChannelDelta > spec.maxMeanAbsChannelDelta) {
    failures.push(
      `meanAbsChannelDelta ${summary.meanAbsChannelDelta.toFixed(4)} > ${spec.maxMeanAbsChannelDelta} ` +
        '(the primary metric: a palette-step regression moves this and can leave diffPixels at 0)'
    );
  }
  if (summary.diffPixels > spec.maxDiffPixels) {
    failures.push(`diffPixels ${summary.diffPixels} > ${spec.maxDiffPixels}`);
  }
  return { ok: failures.length === 0, gated: true, failures };
}

// ============================================================================
// Manifest -- what a baseline was captured FROM
// ============================================================================

/** Recorded next to the baseline PNGs. Two jobs: it makes a bless reviewable
 *  as TEXT in a pull request (a PNG diff alone tells a reviewer that something
 *  changed, never what the capture was), and it lets the compare run refuse to
 *  trust a baseline whose scenario has since been re-authored. */
export interface BaselineManifest {
  /** Schema marker, so an old manifest fails loudly instead of half-matching. */
  version: 1;
  envKey: string;
  /** Full unmasked renderer string, kept for triage even though the directory
   *  key deliberately drops the driver version. */
  unmaskedRenderer: string;
  platform: string;
  arch: string;
  /** `git rev-parse HEAD` at bless time. */
  commit: string;
  blessedAt: string;
  /** Why this bless happened -- required, and printed on every mismatch. */
  reason: string;
  scenarios: Record<string, BaselineScenarioRecord>;
}

export interface BaselineScenarioRecord {
  /** Absolute sim tick the capture was taken at. */
  tick: number;
  camera: { x: number; y: number; zoom: number };
  rect: { w: number; h: number };
  region: Region | null;
  /** sha256 of the stored PNG, so a corrupted or hand-edited baseline is
   *  caught before it is compared against. */
  sha256: string;
}

/** The capture parameters a stored baseline is only valid for. A scenario
 *  re-authored to a different tick, camera, zoom or region produces a
 *  different picture for entirely legitimate reasons, and comparing the new
 *  capture against the old baseline would report a regression that is not one.
 *  Returns the human-readable mismatches, empty when the baseline still
 *  applies. */
export function capturePreconditionMismatches(
  stored: BaselineScenarioRecord,
  live: { tick: number; camera: { x: number; y: number; zoom: number }; rect: { w: number; h: number } },
  region: Region | null
): string[] {
  const out: string[] = [];
  if (stored.tick !== live.tick) out.push(`tick ${stored.tick} -> ${live.tick}`);
  if (stored.camera.x !== live.camera.x || stored.camera.y !== live.camera.y)
    out.push(
      `camera (${stored.camera.x},${stored.camera.y}) -> (${live.camera.x},${live.camera.y})`
    );
  if (stored.camera.zoom !== live.camera.zoom) out.push(`zoom ${stored.camera.zoom} -> ${live.camera.zoom}`);
  if (stored.rect.w !== live.rect.w || stored.rect.h !== live.rect.h)
    out.push(`canvas ${stored.rect.w}x${stored.rect.h} -> ${live.rect.w}x${live.rect.h}`);
  if (JSON.stringify(stored.region ?? null) !== JSON.stringify(region ?? null))
    out.push(`region ${JSON.stringify(stored.region)} -> ${JSON.stringify(region)}`);
  return out;
}

/** Distinct exit codes, so a workflow step can tell "this environment has no
 *  baseline yet" (actionable, and impossible once one exists) apart from "the
 *  picture changed" (a real finding). */
export const EXIT_OK = 0;
export const EXIT_DIFF = 1;
export const EXIT_USAGE = 2;
export const EXIT_NO_BASELINE = 3;
