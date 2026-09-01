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
// Two measured facts that shaped every number below
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
    // Measured over TWELVE captures spanning five browser processes and two
    // checkouts of one commit, the noise here is BIMODAL rather than a spread:
    // a run reads either 0-2 differing pixels / <=0.0001, or 41 / 0.0024, with
    // nothing in between. The 41 are scattered high-delta (mean 105/255) pixels
    // inside one bbox in the top-left quarter -- the shape of a small asset
    // that has or has not finished arriving, which is what a per-mission lazy
    // mesh load (`c9b8ff4`) makes possible even behind `capture()`'s
    // font-ready + 1s settle. So the calibration basis is 41 / 0.0024, not the
    // quiet half of the pair, and the thresholds are 3.7x and 4.2x THAT.
    //
    // Note what this makes of the pixel count on this scenario: the defect
    // signal is ALSO 41 pixels. The two are indistinguishable by count and
    // separated 20x by magnitude (0.0493 against 0.0024). Fact 2 again, and
    // sharper -- here `maxDiffPixels` is not merely secondary, it is incapable.
    region: null,
    maxDiffPixels: 150,
    maxMeanAbsChannelDelta: 0.01,
    rationale:
      'whole frame, no units in shot. Noise is bimodal at 0-2 px / <=0.0001 or 41 px / 0.0024 over ' +
      '12 captures / 5 processes / 2 checkouts (macOS SwiftShader); thresholds are 3.7x and 4.2x the ' +
      'worse mode. The re-injected scatter defect reads 41 px / 0.0493 -- the SAME pixel count as the ' +
      'noise and 20x its magnitude, so only meanAbsChannelDelta can see it here.',
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
    maxDiffPixels: 60,
    maxMeanAbsChannelDelta: 0.05,
    rationale:
      'unit-free ground crop (the groundTextureCheck region). Noise 0 px / 0.0000 across the same ' +
      '6 captures; a different GL backend on the same machine moves it to 25 px / 0.0131, which is ' +
      'the cushion these thresholds sit above rather than their calibration basis. The re-injected ' +
      'scatter defect reads 0 px / 0.3519 -- 7x over the threshold on meanAbsChannelDelta and ' +
      'literally invisible to the pixel count. This is the scenario that discriminates the defect ' +
      'cross-backend measured 1.945%-vs-1.937% on.',
  },
  vehicle: {
    // Whole frame: the vehicles' own dust and exhaust are the only real-time
    // content, and unlike `open-ground`'s infantry they are cheap -- 78-133
    // differing pixels / 0.0136-0.0170 across twelve captures. Cropping them
    // out would remove the only mesh VEHICLES the gate ever looks at, so the
    // noise is paid here rather than dodged.
    region: null,
    maxDiffPixels: 600,
    maxMeanAbsChannelDelta: 0.06,
    rationale:
      'whole frame, mesh vehicles plus continuous dust/exhaust FX. Noise 78-133 px / 0.0136-0.0170 ' +
      'over 12 captures / 5 processes / 2 checkouts (macOS SwiftShader); thresholds are 4.5x and ' +
      '3.5x that. The re-injected scatter defect reads 100 px / 0.2068 -- caught on ' +
      'meanAbsChannelDelta (3.4x over), invisible to the pixel count, which does not move at all.',
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
