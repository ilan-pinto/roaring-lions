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
// CAPTURE CONDITIONS, stated once and true of every figure in this file unless
// an entry says otherwise: macOS 15 / M3 Pro, headless Chromium (the version
// `pnpm-lock.yaml` pins), 1400x900, deviceScaleFactor 1, no GL launch
// arguments -- so software SwiftShader, read back from
// `WEBGL_debug_renderer_info` on every run rather than assumed. Sample sizes
// are given with every range, because the first two versions of `vehicle`'s
// entry recorded a best case as if it were the spread, twice.
// Measurements: `.superpowers/queue/golden-three-report.md`,
// `golden-three-fix-report.md`, `golden-three-residuals-report.md`.
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
//    every threshold below is calibrated against full-gate runs taken that way
//    -- 24 of them when they were set, and 94 pooled across three independent
//    samples since (`vehicle`; 73 for the other three). See each entry's own
//    comment for its before and after. The lesson generalises TWICE: measure
//    the spread over enough runs to see a second mode, treat a bimodal reading
//    as a bug to find rather than a band to widen -- and never record one
//    sample's extremes as "the noise", which this file did with `vehicle`
//    before the freeze and again after it. A range without a sample size
//    beside it is an anecdote.

import type { DiffSummary, Region } from './diff';

/**
 * One visible-toggle A/B: hide a named draw layer, repaint, photograph, and
 * require the two frames to DIFFER by at least this much.
 *
 * The floor is a MINIMUM, which is the whole inversion -- every other
 * threshold in this file is a maximum, "do not change too much". These are
 * "prove you are still there". A layer that stops contributing pixels drives
 * its own delta to zero and fails, whatever the rest of the frame looks like,
 * with no stored reference involved.
 *
 * `minMeanAbsChannelDelta` is the PRIMARY floor for the same measured reason
 * `maxMeanAbsChannelDelta` is the primary ceiling: a palette-quantised mark
 * can move a wide area by one step (19/255) and leave pixelmatch's count at
 * zero. `minDiffPixels` is the secondary one and is deliberately 0 for a
 * layer whose contribution is entirely sub-threshold -- stated in that
 * entry's own `rationale` rather than left to be inferred.
 */
export interface LayerCheckSpec {
  /** A `DEBUG_LAYERS` name (`packages/render/src/three/debug-layers.ts`). An
   *  unknown one THROWS in the page rather than reading as a dead layer. */
  layer: string;
  /** Fails when hiding the layer moves the mean absolute per-channel delta
   *  by LESS than this. */
  minMeanAbsChannelDelta: number;
  /** Fails when hiding the layer changes FEWER than this many pixels at
   *  pixelmatch's 0.1 threshold. */
  minDiffPixels: number;
  /** Sub-rectangle the toggle diff covers. Omitted means the scenario's own
   *  `region` -- which is the right default: a crop chosen to exclude
   *  real-time content is exactly as useful here as it is for the baseline
   *  comparison. `null` forces whole-frame even when the scenario crops. */
  region?: Region | null;
  /** An optional SECOND question about the same layer, asked from the same two
   *  photographs plus two more: not "is it there" but "is it a different TONE
   *  from the ground beneath it". See `ToneCollapseSpec`. */
  toneCheck?: ToneCollapseSpec;
  /** Measured signal, sample size, and what the floor is a fraction OF.
   *  Printed on every run. */
  rationale: string;
}

/**
 * The tone-collapse ratio: proof that a layer's marks differ in COLOUR from
 * the surface they sit on, with no stored reference.
 *
 * WHY A SECOND SHAPE OF CHECK EXISTS AT ALL, measured rather than assumed. The
 * defect this whole gate was built for -- the stone-grain scatter no-op
 * (`671acdb`), where every fleck composites into its own tile's base tone --
 * is NOT an erasure, and the plain toggle floor above cannot see it. Before
 * `c38f770` the marks vanished; since the ground gained a photographic sand
 * tile they do not, because a flat base-toned mark still breaks a textured
 * surface. Re-injected into this tree and measured: hiding `scatter` on
 * `open-ground` moved 4610 px / 1.6858 clean against 4067 / 1.5393 defective
 * -- a 9% dip. Hiding it against the FLAT palette ground was barely better
 * (1.6239 vs 1.3923, 14%). No honest floor separates those, and a floor tight
 * enough to would be a golden number in disguise.
 *
 * What DOES separate them is a ratio of two footprints of the same layer:
 *
 *   over TEXTURED ground -- every mark shows, including one whose colour has
 *     collapsed into the ground's own tone, because a flat mark still flattens
 *     the texture under it;
 *   over FLAT ground (`over` hidden, which is the material's own 404 path) --
 *     only a mark that is genuinely a different tone shows at all.
 *
 * So the ratio flat/textured is "what fraction of this layer's marks are a
 * real tone difference rather than a hole in the texture", and it is 1.0 for a
 * healthy layer by construction. Measured: 0.9306 / 0.9544 / 0.9377 clean on
 * quiet / open-ground / relief, against 0.5927 / 0.6938 / 0.6359 with the
 * defect re-injected. Nothing falls between 0.70 and 0.93, so a threshold in
 * that gap sits in a gap rather than on a fitted line -- the same standard
 * `tools/building_facing.py`'s FRONT_MARGIN is held to.
 *
 * IT DEPENDS ON THE GROUND ACTUALLY BEING TEXTURED, and that is not a hidden
 * assumption: the same scenario's `ground-albedo` layer check proves the
 * texture contributes pixels, and if it ever stops the gate goes red there
 * first. Without a texture both footprints are the same set and the ratio is a
 * vacuous 1.0.
 */
export interface ToneCollapseSpec {
  /** The layer to hide to flatten the backdrop -- `ground-albedo` in every
   *  case today, because driving the five texture strengths to 0 is the
   *  renderer's own fail-soft path rather than a synthetic state. */
  over: string;
  /** Fails when the flat-ground footprint is smaller than this fraction of
   *  the textured-ground one. */
  minFootprintRatio: number;
  /** Measured clean and defective readings, with sample size. */
  rationale: string;
}

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
  /** The reference-free half of this scenario's verdict: one entry per draw
   *  layer this framing is a good witness for. Empty (or absent) means this
   *  scenario judges nothing at all on a runner with no baseline, which is a
   *  choice to state rather than a default to fall into. */
  layerChecks?: readonly LayerCheckSpec[];
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
/** Every floor below is ONE THIRD of this machine's measured signal, on both
 *  metrics, rounded down to a readable number.
 *
 *  Why a third, when the measurement carries no noise at all to leave room
 *  for -- all ten layer deltas below are BIT-IDENTICAL across five
 *  consecutive full-gate runs, to four decimal places, because the scene is
 *  frozen and the two photographs differ only by the toggle. The floor's job
 *  is therefore not headroom; it is a statement about how much of a layer may
 *  disappear before the gate calls it gone. A third says "two thirds of this
 *  layer's contribution can vanish before this fails", which is loose enough
 *  that an ordinary art change does not turn every floor into a second
 *  baseline needing its own bless, and tight enough that both documented
 *  erasure defects (which drive their delta to zero, or near it) fail by a
 *  wide margin. Tightening it toward the signal would make this a golden
 *  number in disguise, which is the one thing a reference-free check must not
 *  become. */
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
    // frozen (`FREEZE_FRAME_LOOP_STATEMENTS`) 73 full-gate runs across two
    // independent samples (24 + 49) read 0 or 1 differing pixels and
    // 0.0000-0.0001 -- unimodal, and 41x tighter on magnitude than before the
    // freeze. Thresholds are 40x the pixel maximum and 39x the magnitude one
    // (0.004 against a raw 0.000103).
    region: null,
    maxDiffPixels: 40,
    maxMeanAbsChannelDelta: 0.004,
    layerChecks: [
      {
        layer: 'scatter',
        minDiffPixels: 550,
        minMeanAbsChannelDelta: 0.04,
        toneCheck: {
          over: 'ground-albedo',
          minFootprintRatio: 0.8,
          rationale:
            'the grain mesh covers 8938 px of this frame over textured ground and 8318 px over the ' +
            'flat palette tone -- ratio 0.9306, identical on 4 consecutive full-gate runs. With the ' +
            'scatter no-op re-injected (671acdb) the same reading is 8794 / 5212 = 0.5927. Nothing ' +
            'measured falls between 0.70 and 0.93, so the 0.8 floor sits in a gap.',
        },
        rationale:
          'hiding the grain mesh moves 1730 px / 0.1318 here, identical on 5 consecutive full-gate ' +
          'runs (macOS SwiftShader, frame loop frozen). Floors are a third of that. The weakest of ' +
          "the three scatter witnesses -- this camera looks at a town, not at open ground -- which " +
          'is why open-ground carries the same check at 4x the signal.',
      },
      {
        layer: 'decor',
        minDiffPixels: 4700,
        minMeanAbsChannelDelta: 0.4,
        rationale:
          'hiding both decor batches moves 14180 px / 1.2038 here, identical on 5 runs. Floors are a ' +
          'third. Erasing every decor object (decor-place.ts `familyFor` -> null) takes it to 0 / ' +
          '0.0000 -- the defect that used to reach exit 3 with a green self-check.',
      },
      {
        layer: 'ground-albedo',
        minDiffPixels: 750,
        minMeanAbsChannelDelta: 0.28,
        rationale:
          'driving the five ground texture strengths to 0 -- the material\'s own 404 path -- moves ' +
          '2266 px / 0.8628 here, identical on 5 runs. Floors are a third. This is the check that ' +
          'replaces what `groundTextureCheck` was meant to do and stopped doing: a sand tile that ' +
          'never arrives now fails, where the dominant-colour fraction could not see it at all.',
      },
      {
        layer: 'buildings',
        minDiffPixels: 9300,
        minMeanAbsChannelDelta: 0.48,
        rationale:
          'hiding structure boxes, mesh building clones and billboard structure instancers moves ' +
          '28026 px / 1.4580 here, identical on 5 runs. Floors are a third. Only this scenario and ' +
          'vehicle frame a building at all; open-ground and relief read a literal 0 and therefore do ' +
          'not declare it.',
      },
    ],
    rationale:
      'whole frame, no units in shot. Noise 0-1 px / 0.0000-0.0001 pooled over 73 gate runs in two ' +
      'samples (24 + 49; macOS SwiftShader, frame loop frozen); thresholds are 40x the pixel maximum ' +
      'and 39x the magnitude one. The re-injected scatter defect reads 14 px / 0.0470 -- 12x over the ' +
      'magnitude threshold, and 457x the noise floor, while the pixel count moves by 13.',
  },
  'open-ground': {
    // The crop the retired `groundTextureCheck` used, kept for its own reason:
    // it was confirmed unit-free and HUD-free at this scenario's exact
    // framing. Whole-frame here is NOT usable -- sandbox infantry stand in the
    // top-left of the shot and their rigged idle clip advances on wall-clock
    // time, giving 879-1762 differing pixels / 0.087-0.154 run to run even
    // with the tick pinned. Inside the crop the same six captures are
    // bit-identical: 0 px / 0.0000.
    region: { x: 950, y: 500, w: 450, h: 400 },
    // Tightened from 60 / 0.050 once 24 consecutive runs read a literal zero
    // inside the crop, and re-measured since at a literal zero over 49 more
    // (73 runs in total, two samples). Still above the 25 px / 0.0131 a
    // different GL backend costs on this crop -- that number is a deliberate
    // cushion, not the calibration basis, since baselines are env-keyed and a
    // backend change should be a re-bless rather than a red run.
    maxDiffPixels: 40,
    maxMeanAbsChannelDelta: 0.02,
    layerChecks: [
      {
        layer: 'scatter',
        minDiffPixels: 1500,
        minMeanAbsChannelDelta: 0.56,
        toneCheck: {
          over: 'ground-albedo',
          minFootprintRatio: 0.8,
          rationale:
            'the grain mesh covers 8967 px of this crop over textured ground and 8558 px over the ' +
            'flat palette tone -- ratio 0.9544, identical on 4 consecutive full-gate runs. With the ' +
            'scatter no-op re-injected (671acdb) the same reading is 8912 / 6183 = 0.6938. The ' +
            'closest any measurement comes to the 0.8 floor, from either side.',
        },
        rationale:
          'hiding the grain mesh moves 4610 px / 1.6858 inside this crop, identical on 5 consecutive ' +
          'full-gate runs. Floors are a third. This is the strongest scatter witness in the gate -- ' +
          'the crop is nothing but open ground at zoom 3, which is what it was chosen for.',
      },
      {
        layer: 'decor',
        minDiffPixels: 300,
        minMeanAbsChannelDelta: 0.15,
        rationale:
          'hiding both decor batches moves 915 px / 0.4583 inside this crop, identical on 5 runs. ' +
          'Floors are a third. The smallest decor signal of the three, and kept anyway: it is the ' +
          'only decor check on `tutorial_ground`, and a decor fault that spared the other two maps ' +
          'would otherwise be invisible.',
      },
      {
        layer: 'ground-albedo',
        minDiffPixels: 170,
        minMeanAbsChannelDelta: 1.84,
        rationale:
          "driving the five ground texture strengths to 0 moves 511 px / 5.5363 inside this crop, " +
          'identical on 5 runs -- the largest magnitude anywhere in the gate, because this crop is ' +
          'entirely textured open ground. Floors are a third. Note the shape: 511 px against a ' +
          '180000 px crop, so the pixel count is the weak half and the magnitude is the real signal.',
      },
    ],
    rationale:
      'unit-free ground crop (the region the retired groundTextureCheck used). Noise 0 px / 0.0000 over 73 gate ' +
      'runs in two samples (24 + 49) -- a literal zero, so no headroom multiple exists; a different ' +
      'GL backend on the same machine moves it to 25 px / ' +
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
    // race, not merely narrowed it. The shape of what is left is unimodal and
    // that is the substantive claim; the RANGE below is a pooled figure, and
    // the first version of this comment got that wrong the same way the
    // pre-freeze one did.
    //
    // THE 5-101 px / 0.0029-0.0058 THIS ENTRY USED TO RECORD WAS ONE SAMPLE'S
    // BEST CASE. It came from 24 runs. An independent 21-run sample on the same
    // machine, same rasteriser, same clean tree measured 15-157 px /
    // 0.0033-0.0069 -- two runs above that pixel maximum and three above that
    // magnitude maximum. A third sample taken while writing this, 49 runs in
    // two batches (35 + 14), each run its own Node and Chromium process, read
    // 8-92 px / 0.0031-0.0060, mean 48 px, largest internal pixel gap 9 --
    // still one continuous mode, still no second cluster.
    //
    // So the recorded range is the UNION of all three samples on this machine,
    // 94 runs: 5-157 px / 0.0029-0.0069. That is what the headroom multiples
    // below are computed against, and they are smaller than the ones this entry
    // used to claim (3.0x/3.4x, which were against the narrowest sample). The
    // thresholds themselves are unchanged and still clear the pooled maximum:
    // 300 px is 1.9x 157, and 0.02 is 2.9x 0.0069. If a future sample exceeds
    // them, say so and find the cause -- widening is the rejected fix, and the
    // reason a bimodal reading is a bug rather than a band is that it was one.
    region: null,
    maxDiffPixels: 300,
    maxMeanAbsChannelDelta: 0.02,
    // NO reference-free check, and that is a measurement rather than an
    // omission. What this scenario uniquely frames is mesh VEHICLES, and mesh
    // units are the one thing the toggle seam cannot hide: `updateVehicleMeshes`
    // re-asserts `root.visible` from fog on every frame, so the repaint that
    // should photograph them missing is the call that puts them back (measured:
    // 76 px / 0.0100 for hiding "units" here, against 6922 px / 0.5014 for
    // hiding scatter in the same frame -- see `debug-layers.ts`). Every OTHER
    // layer in shot is already gated on `quiet`, which is the same map. So this
    // scenario is judged by its baseline and, on an unblessed runner, captured
    // and not judged -- which the summary says in those words.
    //
    // It is also the one scenario whose zero-time repaint is not bit-identical:
    // 0 px / 0.0001-0.0004 over ~65-99 scattered pixels around the vehicles,
    // decaying run to run (0.00035, 0.00021, 0.00021, 0.00012 ... over ten
    // successive repaints). Three orders of magnitude below any floor here, and
    // recorded rather than swept up: `quiet`, `open-ground` and `relief` all
    // read a literal 0 / 0.0000, so whatever it is, it lives with the mesh
    // vehicles and their continuous FX -- the same place this entry's own
    // run-to-run noise already sits.
    layerChecks: [],
    rationale:
      'whole frame, mesh vehicles plus continuous dust/exhaust FX. Noise 5-157 px / 0.0029-0.0069, ' +
      'pooled over 94 gate runs in three independent samples on one machine (24 + 21 + 49; macOS 15 ' +
      '/ M3 Pro, headless Chromium, software SwiftShader, 1400x900, frame loop frozen), unimodal in ' +
      'every sample. Thresholds are 1.9x and 2.9x the POOLED maximum -- the 3.0x/3.4x this line used ' +
      'to claim was measured against the narrowest of the three. The re-injected scatter defect ' +
      'reads 63 px / 0.1953 -- 10x over the threshold on meanAbsChannelDelta (28x the pooled noise ' +
      'maximum), and INSIDE the noise band on pixel count, which is why magnitude is the primary ' +
      'metric here.',
  },
  relief: {
    // MAP COVERAGE. The other four scenarios look at two of the five shipped
    // maps, both of them flat and boulder-free, which is how deleting every
    // boulder decor object left the whole gate green (see
    // `RELIEF_SCENARIO`'s own comment). This one frames `tel_marum`'s narrow
    // corridor: the T1-C boulder field, the rock-ridge walls either side of
    // it, and the elevation band the corridor cuts.
    //
    // Whole frame, and the measurement earns it: 0 px / 0.0000 over 73 gate
    // runs in two samples (24 + 49). One further run of the second sample is
    // excluded rather than counted as 0: it reported `capture drift: zoom 2 ->
    // 0.5` because this scenario's zoom was being deliberately falsified at
    // that moment, which is `capturePreconditionMismatches` doing its job by
    // accident. That is despite one unit being in shot -- the
    // `recon_drone` the scenario orders forward so the fog lifts at all (see
    // `RELIEF_SCENARIO`). It is one small hovering mesh at a pinned tick, and
    // with the frame loop frozen its animation clock no longer advances by a
    // wall-clock amount either, so there is no unstable cluster to crop
    // around. If a future change puts real-time content here, crop it the way
    // `open-ground` does rather than widening these numbers.
    region: null,
    maxDiffPixels: 40,
    maxMeanAbsChannelDelta: 0.004,
    layerChecks: [
      {
        layer: 'scatter',
        minDiffPixels: 2300,
        minMeanAbsChannelDelta: 0.13,
        toneCheck: {
          over: 'ground-albedo',
          minFootprintRatio: 0.8,
          rationale:
            'the grain mesh covers 23915 px of this frame over textured ground and 22426 px over ' +
            'the flat palette tone -- ratio 0.9377, identical on 4 consecutive full-gate runs. With ' +
            'the scatter no-op re-injected (671acdb) the same reading is 23731 / 15090 = 0.6359, ' +
            'and this is the framing where the defect moves the most pixels in absolute terms.',
        },
        rationale:
          'hiding the grain mesh moves 7146 px / 0.4093 here, identical on 5 consecutive full-gate ' +
          'runs. Floors are a third. The only scatter witness on a map with relief, where the marks ' +
          'also dress slope faces.',
      },
      {
        layer: 'decor',
        minDiffPixels: 12800,
        minMeanAbsChannelDelta: 0.92,
        rationale:
          'hiding both decor batches moves 38513 px / 2.7695 here, identical on 5 runs -- the ' +
          'largest pixel signal in the gate, because this framing is the T1-C boulder field. Floors ' +
          'are a third. This is the check that closes the exit-3 hole by name: the decor erase that ' +
          'read 37183 px against a baseline and passed the old self-check.',
      },
      {
        layer: 'ground-albedo',
        minDiffPixels: 330,
        minMeanAbsChannelDelta: 1.02,
        rationale:
          'driving the five ground texture strengths to 0 moves 1015 px / 3.0769 here, identical on ' +
          '5 runs. Floors are a third. Covers the rock slot as well as sand -- tel_marum is the only ' +
          'gated map with `^` ridge walls.',
      },
    ],
    rationale:
      'whole frame, tel_marum boulder corridor @ tile (10,15) zoom 2, tick 500 -- the T1-C boulder ' +
      'field plus the extruded rock-ridge relief either side of it. Noise 0 px / 0.0000 over 73 gate ' +
      'runs in two samples (24 + 49; macOS SwiftShader). Deleting every boulder decor object reads 36001 ' +
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
    // No reference-free check: this scene cannot even hold still between two
    // photographs. Two screenshots taken with NO repaint at all between them
    // differ by 10989 px / 0.4962 and then 22215 px / 2.0043 -- something in
    // the mission path is still painting after the frame loop is frozen (the
    // sandbox scenarios are bit-identical under the same test). Until that is
    // found, a toggle A/B here would be measuring it. Report-only twice over.
    layerChecks: [],
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

/** A layer check FAILS when the delta is too SMALL -- the inverse comparison
 *  to `evaluateBaseline`, and the reason both live here rather than being
 *  inlined at the one call site each: the direction of the comparison is the
 *  whole semantic difference between the two halves of this gate, and getting
 *  it backwards would produce a check that passes precisely when the layer is
 *  gone. `baseline.test.ts` pins both directions. */
export function evaluateLayerCheck(summary: DiffSummary, check: LayerCheckSpec): BaselineVerdict {
  const failures: string[] = [];
  if (summary.meanAbsChannelDelta < check.minMeanAbsChannelDelta) {
    failures.push(
      `hiding "${check.layer}" moved meanAbsChannelDelta ${summary.meanAbsChannelDelta.toFixed(4)} < ` +
        `${check.minMeanAbsChannelDelta} (the primary floor: this layer is contributing nothing, or ` +
        'almost nothing, to the frame)'
    );
  }
  if (summary.diffPixels < check.minDiffPixels) {
    failures.push(`hiding "${check.layer}" changed diffPixels ${summary.diffPixels} < ${check.minDiffPixels}`);
  }
  return { ok: failures.length === 0, gated: true, failures };
}

/** The tone-collapse verdict. Takes the two footprints as counts of pixels
 *  that are not BIT-IDENTICAL (`DiffSummary.changedPixels`), never pixelmatch's
 *  perceptual `diffPixels`: the marks this separates differ from their ground
 *  by around one palette step, which the perceptual count discards -- measured,
 *  8558 exact against 3498 perceptual on the same footprint. */
export function evaluateToneCheck(
  footprintOverTexture: number,
  footprintOverFlat: number,
  check: ToneCollapseSpec,
  layer: string
): BaselineVerdict & { ratio: number } {
  // A layer with no footprint at all is the plain floor's finding, not this
  // one; reporting 0/0 as a ratio of 0 would double-fail it and bury the real
  // message. Say so instead.
  if (footprintOverTexture === 0) {
    return {
      ok: false,
      gated: true,
      ratio: 0,
      failures: [
        `"${layer}" has no footprint over textured ground at all, so its tone-collapse ratio is ` +
          'undefined -- read the floor check above, which is the finding.',
      ],
    };
  }
  const ratio = footprintOverFlat / footprintOverTexture;
  const failures =
    ratio < check.minFootprintRatio
      ? [
          `"${layer}" covers ${footprintOverTexture} px over textured ground but only ` +
            `${footprintOverFlat} px over the flat palette tone (ratio ${ratio.toFixed(4)} < ` +
            `${check.minFootprintRatio}). That means ${(100 - ratio * 100).toFixed(0)}% of this layer ` +
            'is drawing in its own ground\'s colour: the marks exist, and they are not a tone. This ' +
            'is the shape of the stone-grain scatter no-op (671acdb) -- check the tone composites in ' +
            '`scatter.ts` against the shipped theme before assuming it is unrelated.',
        ]
      : [];
  return { ok: failures.length === 0, gated: true, ratio, failures };
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

// ============================================================================
// The repaint control
// ============================================================================

/** The toggle checks photograph the same scene twice and attribute the whole
 *  difference to the layer they switched off. That attribution is only sound
 *  while a repaint with nothing changed produces the same picture, so the gate
 *  measures exactly that first and votes on it.
 *
 *  MEASURED, on the three scenarios that declare layer checks: with the frame
 *  loop frozen and `frame(1, 0)` handing every clock zero elapsed
 *  milliseconds, the control reads a literal 0 px / 0.0000 on `quiet`,
 *  `open-ground` and `relief`, on 5 consecutive full-gate runs each. That is
 *  not luck -- every clock `ThreeRenderer.frame` advances is fed the `dtMs` it
 *  is handed, so zero makes the second paint a re-execution of the first.
 *
 *  So these are ZERO, not a band, and a control that starts drifting is a bug
 *  to find rather than a number to widen -- widening it would silently loosen
 *  every layer floor below at the same time. The two scenarios that do NOT
 *  read zero (`vehicle` at 0 px / 0.0001-0.0004, `combat` at four figures)
 *  declare no layer checks and never run this; their own entries carry the
 *  measurement and what is known about it. */
export const REPAINT_CONTROL_MAX_DIFF_PIXELS = 0;
export const REPAINT_CONTROL_MAX_MEAN_DELTA = 0;

/** Distinct exit codes, so a workflow step can tell "this environment has no
 *  baseline yet" (actionable, and impossible once one exists) apart from "the
 *  picture changed" (a real finding). */
export const EXIT_OK = 0;
export const EXIT_DIFF = 1;
export const EXIT_USAGE = 2;
export const EXIT_NO_BASELINE = 3;
