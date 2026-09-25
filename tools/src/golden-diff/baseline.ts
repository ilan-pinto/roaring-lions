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
 *   over FLAT ground (the `over` layers hidden: `ground-albedo`, the
 *     material's own 404 path, AND `macro`, since ground Task 5 -- a 404
 *     leaves the macro on, and scatter marks carry none) --
 *     only a mark that is genuinely a different tone shows at all.
 *
 * So the ratio flat/textured is "what fraction of this layer's marks are a
 * real tone difference rather than a hole in the texture", and it is 1.0 for a
 * healthy layer by construction. Measured PRE-LIT: 0.9306 / 0.9544 / 0.9377
 * clean on quiet / open-ground / relief, against 0.5927 / 0.6938 / 0.6359 with
 * the defect re-injected -- nothing between 0.70 and 0.93, so 0.8 sat in a gap
 * rather than on a fitted line, the same standard `tools/building_facing.py`'s
 * FRONT_MARGIN is held to.
 *
 * RE-MEASURED ON THE LIT RENDERER, 2026-09-15, and the answer is not uniform.
 * Clean 0.9301 / 0.9260 / 0.9935, defective 0.6692 / 0.7109 / **0.9186**. The
 * sun pushes the DEFECTIVE ratio up everywhere, because a lit mark differs
 * from lit ground by its own micro-relief shading even when its colour has
 * collapsed into the ground's -- and on `relief`, where every mark sits on a
 * shaded hillside, it pushes it clean past the floor. So two of the three
 * scenarios still discriminate this defect and `relief` does not; its floor is
 * deliberately NOT lowered into the 0.075 that would separate them, and its
 * own entry carries the account. Read each scenario's `toneCheck.rationale`
 * for its own pair rather than treating the three as one number.
 *
 * IT DEPENDS ON THE GROUND ACTUALLY BEING TEXTURED, and that is not a hidden
 * assumption: the same scenario's `ground-albedo` layer check proves the
 * texture contributes pixels, and if it ever stops the gate goes red there
 * first. Without a texture both footprints are the same set and the ratio is a
 * vacuous 1.0.
 */
export interface ToneCollapseSpec {
  /** The layers hidden TOGETHER to flatten the backdrop, in order (and put
   *  back in reverse) -- `['ground-albedo', 'macro']` in every case today.
   *  `ground-albedo` drives the six texture strengths to 0, the renderer's own
   *  fail-soft path rather than a synthetic state; `macro` (ground Task 5)
   *  takes the macro field's amplitude to 0 as well. Both are needed: scatter
   *  marks carry no macro, so over macro-shaded ground a mark whose colour has
   *  collapsed into its tile's tone still differs by the macro factor, and the
   *  671acdb no-op then PASSED this check (quiet 0.9328, open-ground 0.9675,
   *  measured with only `ground-albedo` hidden). `ground-albedo` alone is kept
   *  macro-free on purpose -- its own check means "the texture never arrived",
   *  and a 404 leaves the macro on. */
  over: readonly string[];
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
  /**
   * Per-scenario budget for the zero-time repaint CONTROL, when this scenario
   * cannot meet the global hard zero. Absent means
   * `REPAINT_CONTROL_MAX_DIFF_PIXELS` / `REPAINT_CONTROL_MAX_MEAN_DELTA`,
   * which are 0 and stay 0.
   *
   * **This is deliberately NOT a widening of those constants**, and the
   * distinction is the whole reason it exists as a field. Their own comment
   * says a drifting control is "a bug to find rather than a number to widen --
   * widening it would silently loosen every layer floor below at the same
   * time". That is true of the constants and false of this: a value here
   * loosens ONE scenario's control and nothing else, and every other scenario
   * still has to be bit-identical.
   *
   * **NOTHING USES IT TODAY, and that is the outcome the field was for.**
   * `vehicle` was the only user, at 0 px / 0.00036, from 2026-09-10 until
   * 2026-09-18, when the drift behind it was found and fixed at the source
   * (`ThreeRenderer.updateVehicleAmbientFx` added the RAW frame delta to its
   * emission accumulators instead of the clamped one, so a long frame banked
   * seconds of exhaust that later frames spent one puff at a time, elapsed
   * time or not -- see that method's own "the ceiling is load-bearing"
   * section, and this file's `vehicle` entry for the numbers). All five
   * scenarios now meet the global hard zero.
   *
   * The field stays because the shape is still right for a scenario that
   * genuinely cannot be bit-identical, and because deleting it would lose the
   * argument above. A NEW user is a claim that needs the same treatment the
   * last one eventually got: the stopgap bought eight days and one red CI
   * run, not a resolution.
   */
  repaintControl?: { readonly maxDiffPixels: number; readonly maxMeanAbsChannelDelta: number };
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
/** A STATED PRECONDITION of every gated scenario below, alongside the frozen
 *  frame loop and the absolute `targetTick`: **the capture is taken with
 *  `renderer.selection.length === 0` and `renderer.rangeRingPreview === -1`**,
 *  so no range envelope is drawn in any baseline (shell Phase 2 Task 16). It
 *  holds today because no scenario selects anything and none parks the cursor
 *  over a friendly unit -- but the second half is not inert the way the first
 *  is: `main.ts`'s `updateHover` writes `rangeRingPreview` from `lastCursor`
 *  EVERY frame, and `lastCursor` starts at screen (0, 0), so a re-authored
 *  scenario that moves the pointer, or whose camera puts a living side-0 unit
 *  within half a tile of where the pointer happens to sit, silently adds a
 *  desaturated annulus to the frame. Re-check both when you add or re-frame a
 *  scenario; a preview ring is a legitimate picture, so a baseline blessed
 *  with one in it looks entirely correct. */
/** Every floor below is ONE THIRD of this machine's measured signal, on both
 *  metrics, rounded down to a readable number.
 *
 *  Why a third, when the measurement carries almost no noise to leave room
 *  for -- ten of the eleven layer deltas below are BIT-IDENTICAL across five
 *  consecutive full-gate runs, to four decimal places, because the scene is
 *  frozen and the two photographs differ only by the toggle. (The eleventh is
 *  `vehicle`'s `units`, whose frame carries continuous dust and exhaust FX:
 *  27531-27536 px / 2.6776-2.6797, and the floor is a third of the
 *  smallest.) The floor's job
 *  is therefore not headroom; it is a statement about how much of a layer may
 *  disappear before the gate calls it gone. A third says "two thirds of this
 *  layer's contribution can vanish before this fails", which is loose enough
 *  that an ordinary art change does not turn every floor into a second
 *  baseline needing its own bless, and tight enough that both documented
 *  erasure defects (which drive their delta to zero, or near it) fail by a
 *  wide margin. Tightening it toward the signal would make this a golden
 *  number in disguise, which is the one thing a reference-free check must not
 *  become. */
/** The capture conditions every floor below was re-measured under, written
 *  once because all eleven share them, and written at all because a range
 *  with no conditions beside it is an anecdote (see fact 3 above).
 *
 *  The lit renderer moved every one of these signals, so every floor here is
 *  a fresh third of a fresh measurement rather than a carried-forward number
 *  -- the pre-lit reading is quoted in each entry so the size and DIRECTION
 *  of the move is on the record.
 *
 *  ONE FINDING MADE THE RE-MEASUREMENT POSSIBLE AT ALL, and it is the fourth
 *  instance of this file's own rule that a drifting number is a bug to find
 *  rather than a band to widen. With AO in the chain, the first post-bless
 *  run read `quiet` 20 px / 0.1021, `relief` 2 px / 0.1418 and `vehicle`
 *  57 px / 0.1051 against a baseline blessed from the SAME commit minutes
 *  earlier -- 25x to 35x the ceilings, on scenarios whose pre-lit noise was a
 *  literal zero -- while each scenario's own zero-time repaint control still
 *  read 0 px / 0.0000. Deterministic inside a process, random across
 *  processes: `GTAOPass.generateNoise` builds its Poisson-denoise texture
 *  from `new SimplexNoise()`, which defaults its random source to `Math`.
 *  `post-chain.ts` seeds it now (`AO_NOISE_SEED`), and the same three
 *  scenarios went back to 0 px / 0.0000 over five runs. Nothing in this file
 *  was widened for it. */
/**
 * Every figure in a `vignette` or `skirt` rationale below, and the conditions
 * it was taken under.
 */
const SHELL_P0 =
  'measured 2026-09-17 on the shell upgrade\'s Phase 0 Task 9 (a radial vignette after ' +
  'OutputPass, `packages/render/src/three/vignette-pass.ts`, and a ground skirt three map ' +
  'widths across beyond the boundary, `terrain/skirt.ts`), 3 consecutive full-gate runs on ' +
  'macOS 15 / M3 Pro, headless Chromium, software SwiftShader, frame loop frozen. Every figure ' +
  'below was bit-identical across the three, and the repaint control read 0 px / 0.0000 on both ' +
  'scenarios, so the whole delta is the layer. Floors are a third, rounded down. EVERY ONE OF ' +
  'THE FOUR WAS WATCHED GOING RED: with the vignette never handed to the post chain and the ' +
  'skirt never added to the scene -- the erasure defect, not a toggle a later restore can undo ' +
  '-- all four read 0 px / 0.0000 and FAIL. ';

const PRE_LIT =
  're-measured 2026-09-15 on the LIT renderer with the sun as a SIDE light (Phase 0: one sun at ' +
  'SUN_DIRECTION (-0.406, 0.819, 0.406) -- the rig azimuth 135 = the camera\'s LEFT, Task 16 -- ' +
  'a map-wide shadow box, half-resolution GTAO, sRGB/ACES output through OutputPass, SMAA, and ' +
  'fog as a depth-reading pass), 5 consecutive full-gate runs on macOS 15 / M3 Pro, headless ' +
  'Chromium, software SwiftShader, frame loop frozen. Bit-identical across the five for every ' +
  'layer check EXCEPT vehicle/units, whose own entry states its spread. Floors are a third of ' +
  'the SMALLEST of the five. ';

/**
 * Every figure in a `roads` or `macro` rationale below, and the conditions it
 * was taken under.
 */
const GROUND_T9 =
  'measured 2026-09-25 on ground Task 9 (the `roads` and `macro` debug layers, #226), 3 ' +
  'consecutive full-gate runs (`--scenario=quiet,open-ground,relief`) on macOS 15 / M3 Pro, ' +
  'headless Chromium, software SwiftShader, frame loop frozen. Every figure below was ' +
  'bit-identical across the three, and the repaint control read 0 px / 0.0000 on all three ' +
  'scenarios, so the whole delta is the layer. Floors are a third, rounded down. ';

/**
 * Every figure in an `aftermath` rationale below, and the conditions it was
 * taken under.
 */
const GROUND_T17 =
  'measured 2026-09-25 on the ground fix wave (I-2), after `aftermath` moved OFF the sandbox force: ' +
  'the showcase now anchors clear of it (`showcaseAnchor`, every site >= 10 tiles out) and the ' +
  'camera frames it at (34.5, 32), zoom 2.2, with no drone order. 23 consecutive full-gate runs ' +
  '(`--scenario=aftermath`, each its own fresh dev-server and browser process) on macOS 15 / M3 Pro, ' +
  'headless Chromium, software SwiftShader, frame loop frozen: every layer reading below was ' +
  'BIT-IDENTICAL across all 23, and the repaint control read 0 px / 0.0000 on every run. Task 17 ' +
  'measured these at the OLD framing (on the force, zoom 1) with a spread under 1% and blamed it on ' +
  '"process to process" -- the cause was animating mesh units and a live fight (a fireball and a ' +
  'missile streak over the marks) on the FRAME clock, which `step()` advances by a latched real ' +
  'frame time that differs per process (`smokeClockMs` 20715-20933 at the same tick). With nothing ' +
  'in frame on that clock the spread is gone. Floors are a third of the reading, rounded down. ';

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
        minDiffPixels: 700,
        minMeanAbsChannelDelta: 0.13,
        toneCheck: {
          over: ['ground-albedo', 'macro'],
          minFootprintRatio: 0.8,
          rationale:
            'the grain mesh covers 52767-52768 px of this frame over textured ground and 49082 px ' +
            'over the flat palette tone -- ratio 0.9301-0.9302 over the 5 side-light runs, the ' +
            'one-pixel spread being the only tone footprint in the gate that is not bit-identical ' +
            '(it was 53427 / 49830 = 0.9326 under the front-lit sun, and 8938 / 8318 = 0.9306 ' +
            'before the lights at all; the footprints grew when the scene gained a sun, because a ' +
            'lit mark differs from lit ground over its whole area, not only where the tone ' +
            'stepped). THE DEFECT WAS RE-MEASURED ON THIS RENDERER on 2026-09-15 and the 0.8 ' +
            'floor still separates: with the scatter no-op re-injected (the 671acdb composite, ' +
            'd9fd1c7 reverted by hand) this reads 50651 / 33898 = 0.6692, against a pre-lit ' +
            '8794 / 5212 = 0.5927. The sun moved the defective ratio UP by 0.077 -- exactly the ' +
            'direction predicted (a lit mark differs from lit ground by its own micro-relief ' +
            'shading even when its colour has collapsed into the ground tone) -- and the gap is ' +
            'now 0.67 to 0.93 rather than 0.59 to 0.93. Still a gap, not a fitted line. ' +
            'GROUND TASK 5 (2026-09-25: the control-map splat under the macro field; bit-identical over 3 full-gate runs for ground-albedo, 2 for the tone pairs): the backdrop is now `ground-albedo` + `macro` hidden ' +
            'together, and the footprints read 52200 / 48994 = 0.9386 clean and 49619 / 28646 = ' +
            '0.5773 with the no-op re-injected -- a wider gap than before the splat. With ' +
            '`ground-albedo` ALONE hidden the macro survived the flattening and the no-op read ' +
            '0.9328 and PASSED: scatter marks carry no macro, so a colour-collapsed mark still ' +
            'differed from macro-shaded ground. That is why `over` names both layers.',
        },
        rationale:
          PRE_LIT +
          'hiding the grain mesh moves 2105 px / 0.4032 here (2151 / 0.4168 under the front-lit ' +
          'sun, 1730 / 0.1318 before the lights at all). The side light cost this check 2% of its ' +
          'pixels and 3% of its magnitude, which is the smallest move of any check in the gate: ' +
          'the sun\'s Y stayed at 0.819, so the ground the marks sit on is lit exactly as it was ' +
          'and only the shading of the marks\' own micro-relief changed. The weakest of the three ' +
          'scatter witnesses -- this camera looks at a town, not at open ground -- which is why ' +
          'open-ground carries the same check at 1.7x the signal.',
      },
      {
        layer: 'decor',
        minDiffPixels: 3500,
        minMeanAbsChannelDelta: 0.25,
        rationale:
          PRE_LIT +
          'hiding both decor batches moves 10505 px / 0.7573 here -- 2.9x the pre-lit 3576 / ' +
          '0.2919, because a tree now casts a shadow on the ground beside it and hiding the tree ' +
          'takes the shadow with it. The side light added 10% to the magnitude over the front-lit ' +
          '10424 / 0.6869 for the same reason the captures show: a tree\'s shadow now lands on ' +
          'open ground beside it instead of up-screen underneath its own canopy. The RE-CUT of ' +
          '2026-09-07 (from 4700 / 0.4 down to 1190 / ' +
          '0.097, when the project lead retired the olive from every arid map and the desert tree ' +
          'that replaced it drew a fifth of the canopy) is therefore superseded by a measurement ' +
          'rather than reversed: the art is the same, the light is new. Quiet is no longer the ' +
          'weakest decor witness -- open-ground is, at 1025 px. Erasing every decor object ' +
          '(decor-place.ts `familyFor` -> null) still takes this to 0 / 0.0000, and 3500 px now ' +
          'stands between that and a pass.',
      },
      {
        layer: 'ground-albedo',
        minDiffPixels: 0,
        minMeanAbsChannelDelta: 0.34,
        rationale:
          PRE_LIT +
          'driving the six ground texture strengths to 0 -- the material\'s own 404 path -- moves ' +
          '51 px / 1.0316 here, against 29 px / 1.0883 under the front-lit sun and a pre-lit 2861 ' +
          'px / 0.9137. THE PIXEL COUNT COLLAPSED AND ' +
          'THE MAGNITUDE DID NOT, and that is the shape of the whole gate rather than a fault: ' +
          'under one sun the albedo ratio field shifts a wide area by a fraction of a level, ' +
          'which is under pixelmatch\'s 0.1 perceptual threshold everywhere and over it almost ' +
          'nowhere. A third of 51 px is not a floor, it is a coin toss, so `minDiffPixels` is 0 ' +
          'here for exactly the reason `LayerCheckSpec` gives for allowing it -- the contribution ' +
          'is sub-threshold and the magnitude is the whole check. A texture that never arrives ' +
          'still reads 0.0000 and still fails. If a future environment reads a big pixel count ' +
          'here, that is a rasteriser difference worth understanding, not a floor worth raising. ' +
          'GROUND TASK 5 (2026-09-25: the control-map splat under the macro field; bit-identical over 3 full-gate runs for ground-albedo, 2 for the tone pairs): 26 px / 0.9531. The hide drives the six strengths ONLY -- ' +
          'the macro field stays on, as it does on a real 404 -- so this delta is still the ' +
          'tiles\' own contribution. Falsified by making every tile top ignore the control map ' +
          '(the splat\'s `rlTop` step moved past -1): 0 px / 0.0537, FAIL; the residue is the ' +
          'road\'s per-vertex slot, which that mutation does not reach.',
      },
      {
        layer: 'roads',
        minDiffPixels: 62,
        minMeanAbsChannelDelta: 0.156,
        rationale:
          GROUND_T9 +
          'driving `uRoadOn` to 0 -- the procedural road (#226) gone whole: its packed surface ' +
          'tone, the bleached shoulder, both wheel ruts and the knoll-image grain, with the ' +
          'ground it was painted over showing through -- moves 187 px / 0.4680 here, identical on ' +
          'all three runs. Floor a third, rounded down: 62 px / 0.156. This framing is the ' +
          'outskirts crossroads, and an exact (unthresholded) compare of the two photographs ' +
          'changes 66343 px inside x[275,1043] y[245,623] -- the crossroads and nothing else. ' +
          'The pixelmatch count is small against that because the road tone and the ground ' +
          'beside it are one or two palette steps apart, which is why the magnitude is the ' +
          'primary floor. It measures the ROAD, not its texture: the ruts\' breakup reads the ' +
          'knoll image\'s luminance even at grain gain 0 (Task 6 review, advisory C), so ' +
          '`ground-albedo` hidden still leaves the road and broken ruts on screen, but every ' +
          'road band -- ruts included -- is multiplied by `uRoadOn`. Falsified by baking control ' +
          'B\'s road distance (B.g) to 255 in `buildControlMap`, so no tile is within range of a ' +
          'road: 0 px / 0.0000, FAIL on both floors.',
      },
      {
        layer: 'macro',
        minDiffPixels: 0,
        minMeanAbsChannelDelta: 0.1599,
        rationale:
          GROUND_T9 +
          'driving the macro field\'s amplitude to 0 moves 6 px / 0.4798 here, identical on all ' +
          'three runs. Floor a third of the magnitude, rounded down: 0.1599. SIX pixels is not ' +
          'a count a third can be taken of, so `minDiffPixels` is 0 for the reason ' +
          '`LayerCheckSpec` allows it, exactly as `ground-albedo` here: the field is a +/-7% ' +
          'luminance ratio over a 12-tile period, so removing it shifts a wide area smoothly ' +
          'and stays under pixelmatch\'s 0.1 threshold almost everywhere. F-18: the pure ' +
          '`buildMacroField(48, 48)` predicts mean |m| 0.253 over this frame\'s 1198-tile ' +
          'footprint (0.251 per pixel), above the 0.2 the ruling asks for. Not in the plan\'s ' +
          'list (open-ground and relief); declared here because relief FAILED the F-18 test ' +
          'and this is the second witness that passed it, on a second map. Falsified by ' +
          'initialising `uMacroAmp` to 0 in `groundUniforms()`: 0 px / 0.0000, FAIL.',
      },
      {
        layer: 'buildings',
        minDiffPixels: 72000,
        minMeanAbsChannelDelta: 3.5,
        rationale:
          PRE_LIT +
          'hiding structure boxes, mesh building clones and billboard structure instancers moves ' +
          '216469 px / 10.6308 here, against 122262 / 7.4369 under the front-lit sun and a pre-lit ' +
          '28026 / 1.4580 -- 7.7x and 7.3x the pre-lit figures. THE SIDE LIGHT NEARLY DOUBLED THIS ' +
          'CHECK (+77% pixels, +43% magnitude) and the captures say why: a box-shaped caster\'s ' +
          'shadow used to fall straight up-screen, inside its own silhouette, so hiding a building ' +
          'removed almost nothing but the building; it now lands on the ground BESIDE it, so ' +
          'hiding a building clears a large patch of lit street as well. The largest signal in the ' +
          'gate by a wide margin. Only this scenario and vehicle frame a ' +
          'building at all; open-ground and relief read a literal 0 and therefore do not declare ' +
          'it.',
      },
      {
        layer: 'vignette',
        minDiffPixels: 6800,
        minMeanAbsChannelDelta: 0.73,
        rationale:
          SHELL_P0 +
          'switching the corner vignette off moves 20583 px / 2.1920 here. It is the weaker of ' +
          'the two vignette witnesses because this camera looks at a town from close in, so most ' +
          'of the frame sits inside the untouched radius; relief carries the same check at 2.9x ' +
          'the pixels. Turning the pass off at construction -- the falsification -- takes it to ' +
          '0 px / 0.0000 and fails both floors.',
      },
      {
        layer: 'skirt',
        minDiffPixels: 7100,
        minMeanAbsChannelDelta: 0.28,
        rationale:
          SHELL_P0 +
          'hiding the ground beyond the map moves 21455 px / 0.8442 here. The magnitude is small ' +
          'against the pixel count and that is the shape of the layer rather than a weak signal: ' +
          'the skirt is uniformly shrouded ground, so every pixel it owns moves by the same ' +
          'modest step from the background tone, where a building moves a few pixels a long way. ' +
          'Hiding the mesh takes it to 0 px / 0.0000. Only a framing whose viewport reaches past ' +
          'the map edge can see it at all: open-ground\'s crop reads a literal 0 px / 0.0000 and ' +
          'therefore does not declare it.',
      },
    ],
    rationale:
      'whole frame, no units in shot. Noise 0-1 px / 0.0000-0.0001 pooled over 73 gate runs in two ' +
      'samples (24 + 49; macOS SwiftShader, frame loop frozen) BEFORE the lit renderer, and ' +
      're-measured at a literal 0 px / 0.0000 over 5 runs against the 2026-09-14 baseline once the ' +
      'AO noise texture was seeded (see PRE_LIT), and again at 0 px / 0.0000 over 5 runs against ' +
      'the 2026-09-15 side-light baseline. The thresholds are therefore UNCHANGED: the noise ' +
      'model held, which is why nothing here was widened for the relight. The re-injected scatter ' +
      'defect read 14 px / 0.0470 pre-lit -- 12x over the magnitude threshold -- and has not been ' +
      're-taken since.',
  },
  'open-ground': {
    // The crop the retired `groundTextureCheck` used, kept for its own reason:
    // it was confirmed unit-free and HUD-free at this scenario's exact
    // framing. Whole-frame here is NOT usable -- sandbox infantry stand in the
    // top-left of the shot and their rigged idle clip advances on wall-clock
    // time, giving 879-1762 differing pixels / 0.087-0.154 run to run even
    // with the tick pinned. Inside the crop the same six captures are
    // bit-identical: 0 px / 0.0000.
    //
    // THIS CROP SITS INSIDE THE VIGNETTE'S FALL-OFF SINCE 2026-09-17, AND IT
    // STAYS WHERE IT IS. The crop's far corner IS the frame's bottom-right
    // corner, so `vignette-pass.ts` darkens it by up to 48.6%; toggling that
    // pass moves 8309 px / 4.0929 inside this crop. Task 9's brief asked for
    // the crop to be moved toward the centre (x:700, y:350, same size) if
    // that number cleared this scenario's own 0.02 magnitude threshold, and
    // it clears it by 200x -- so the move was MEASURED rather than made, and
    // the measurement says do not make it. At the candidate crop, hiding
    // `units` moves 229 px / 0.1943, where at this one it moves a literal
    // 0 px / 0.0000: the candidate contains animating rigged infantry, and
    // being unit-free is the entire reason this crop exists. The 0.02 is a
    // ceiling on RUN-TO-RUN NOISE in a like-for-like baseline diff, not a
    // budget for a deterministic change -- the vignette is a pure function of
    // uv, contributes no noise at all, and is inside the baseline once it is
    // blessed, after which the diff is 0 again. What it does cost is a little
    // of the other checks' signal, and that was measured too: scatter
    // 1.6088 -> 1.5825, ground-albedo 2.6616 -> 2.5622, decor 0.646 ->
    // 0.6444, all 1-4% and all still far above their own floors.
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
        minDiffPixels: 1200,
        minMeanAbsChannelDelta: 0.53,
        toneCheck: {
          over: ['ground-albedo', 'macro'],
          minFootprintRatio: 0.8,
          rationale:
            'the grain mesh covers 10170 px of this crop over textured ground and 9417 px over ' +
            'the flat palette tone -- ratio 0.9260, identical on the 5 side-light runs (10254 / ' +
            '9487 = 0.9252 under the front-lit sun; 8967 / 8558 = 0.9544 before the lights). THE ' +
            'DEFECT WAS RE-MEASURED ON THIS RENDERER on 2026-09-15 and the 0.8 floor still ' +
            'separates, but this is the TIGHTEST pair in the gate from BOTH sides: re-injected ' +
            '(the 671acdb composite) it reads 9948 / 7072 = 0.7109, against a pre-lit 8912 / ' +
            '6183 = 0.6938. The clean ratio fell 0.03 toward the floor when the lights landed ' +
            'and the defective one rose 0.02 toward it, leaving 0.71 to 0.93 -- 0.09 of headroom ' +
            'below and 0.13 above. Re-measure this entry first if anything about the ground ' +
            'texture, the sun or the scatter composites changes again. ' +
            'GROUND TASK 5 (2026-09-25: the control-map splat under the macro field; bit-identical over 3 full-gate runs for ground-albedo, 2 for the tone pairs): with `ground-albedo` + `macro` hidden together it reads ' +
            '10057 / 9422 = 0.9369 clean and 9922 / 6474 = 0.6525 with the no-op -- 0.15 of ' +
            'headroom below and 0.14 above, no longer the tightest pair. With `ground-albedo` ' +
            'alone hidden the no-op read 0.9675 and PASSED (the macro survived the flattening).',
        },
        rationale:
          PRE_LIT +
          'hiding the grain mesh moves 3615 px / 1.6088 inside this crop, against a pre-lit 4610 ' +
          'px / 1.6858 -- the one signal in the gate that went DOWN, and only on the pixel count: ' +
          'this crop is bare ground at zoom 3, so the marks had nothing but ground to differ from ' +
          'already and the sun shades mark and ground together. The side light moved it by one ' +
          'part in a thousand (3615 / 1.6071 front-lit, the same 3615 pixels), because this ' +
          'crop holds no vertical face for an azimuth to change. Still the strongest scatter ' +
          'witness on magnitude, which is what the crop was chosen for.',
      },
      {
        layer: 'macro',
        minDiffPixels: 0,
        minMeanAbsChannelDelta: 0.2924,
        rationale:
          GROUND_T9 +
          'driving the macro field\'s amplitude to 0 moves 0 px / 0.8773 inside this crop, ' +
          'identical on all three runs. Floor a third of the magnitude, rounded down: 0.2924. ' +
          'ZERO pixels: the whole contribution is under pixelmatch\'s 0.1 threshold, so ' +
          '`minDiffPixels` is 0 and the magnitude is the check, as on quiet. The strongest ' +
          'macro witness in the gate. F-18: the pure `buildMacroField(48, 48)` predicts mean ' +
          '|m| 0.381 over this crop\'s 35-tile footprint (0.344 per pixel), above 0.2 -- a ' +
          '450x400 crop at zoom 3 spans about six tiles of a 12-tile-period field, and here it ' +
          'sits on a lobe rather than a zero crossing. Falsified by initialising `uMacroAmp` to ' +
          '0 in `groundUniforms()`: 0 px / 0.0000, FAIL.',
      },
      {
        layer: 'decor',
        minDiffPixels: 340,
        minMeanAbsChannelDelta: 0.21,
        rationale:
          PRE_LIT +
          'hiding both decor batches moves 1025 px / 0.6460 inside this crop, against 958 px / ' +
          '0.5393 under the front-lit sun and a pre-lit 915 ' +
          'px / 0.4583 -- the side light bought 7% more pixels and 20% more magnitude, because a ' +
          'shrub\'s shadow now falls on ground the crop can see. The smallest decor signal of the ' +
          'three, and kept anyway: it is the only ' +
          'decor check on `tutorial_ground`, and a decor fault that spared the other two maps ' +
          'would otherwise be invisible.',
      },
      {
        layer: 'ground-albedo',
        minDiffPixels: 150,
        minMeanAbsChannelDelta: 0.88,
        rationale:
          PRE_LIT +
          'driving the six ground texture strengths to 0 moves 470 px / 2.6616 inside this crop ' +
          '(472 / 2.6658 under the front-lit sun -- this crop holds no vertical face, so the ' +
          'azimuth barely reaches it), against a pre-lit 6840 px / 6.9094. Both halves fell, and ' +
          'the reason is the same one ' +
          'that collapsed quiet\'s pixel count to 51: the albedo is a RATIO field, and under one ' +
          'sun removing it shifts a wide area smoothly instead of stepping it between palette ' +
          'tones. This is still the largest ground-albedo signal in the gate and the only one ' +
          'whose pixel count is worth a floor at all. ' +
          'THE FLOOR IS A THIRD OF THIS MEASUREMENT, which was a change of policy when the lights ' +
          'landed: the entry before that deliberately kept a third of the OLDER five-slot signal, ' +
          'because the extra headroom came from 35 `n` knoll tiles that someone might edit away. ' +
          'That argument did not survive the relight -- the 2.66 here is the sand and road over ' +
          'the whole crop, not the knolls, and holding a 1.84 floor against a 2.66 signal would ' +
          'leave only 31% of headroom on the metric this check actually rests on. ' +
          'GROUND TASK 5 (2026-09-25: the control-map splat under the macro field; bit-identical over 3 full-gate runs for ground-albedo, 2 for the tone pairs): 196 px / 2.4182. The hide drives the six strengths ONLY -- ' +
          'the macro stays on, as on a real 404 -- so that is the tiles\' contribution with the ' +
          'macro\'s own removed, and the PIXEL margin is now about 1.3x the 150 px floor ' +
          '(magnitude 2.7x). Recorded, not re-floored. Falsified by making every tile top ' +
          'ignore the control map: 0 px / 0.0000, FAIL.',
      },
    ],
    rationale:
      'unit-free ground crop (the region the retired groundTextureCheck used). Noise 0 px / 0.0000 over 73 gate ' +
      'runs in two samples (24 + 49) before the lit renderer, a literal 0 px / 0.0000 again ' +
      'over 5 runs against the 2026-09-14 baseline, and 0 px / 0.0000 over 5 more against the ' +
      '2026-09-15 side-light baseline -- so no headroom multiple exists, and these ' +
      'thresholds are unchanged. A different GL backend on the same machine moved it to 25 px / ' +
      '0.0131, which is the cushion these thresholds sit above rather than their calibration ' +
      'basis. The re-injected scatter defect read 0 px / 0.3519 pre-lit -- 17x over the threshold ' +
      'on meanAbsChannelDelta and literally invisible to the pixel count. This is the scenario ' +
      'that discriminates the defect cross-backend measured 1.945%-vs-1.937% on. ' +
      'Shell Phase 2 Task 10 (the minimap becomes a control) put the minimap box and its ' +
      'hostile/neutral side dots inside this crop -- it sits at the frame\'s bottom-right corner, ' +
      'same as the minimap. A red here after that landing is the expected bless, not new noise: ' +
      'check the diff picture before touching a threshold.',
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
    // WHAT DRIFTED IS KNOWN NOW, AND IT IS FIXED (2026-09-18). This entry
    // carried a `repaintControl` of 0 px / 0.00036 from 2026-09-10 -- the one
    // scenario in the gate whose zero-time repaint was not bit-identical
    // (0 px / 0.0001-0.0004, ~65-99 scattered pixels around the vehicles,
    // decaying over successive repaints) and the one whose whole-frame
    // baseline comparison carried 5-157 px / 0.0029-0.0069 of run-to-run
    // noise. BOTH were the same defect, and it was not in the harness or the
    // GPU: `ThreeRenderer.updateVehicleAmbientFx` added the RAW `dtMs` to its
    // per-entity dust/exhaust accumulators while every other elapsed-time
    // reader in `frame()` clamped to 100 ms, so one long frame banked seconds
    // of emission credit that later frames spent at ONE puff per call,
    // whatever the elapsed time -- including zero.
    //
    // Measured on this scenario's own protocol: boot plus the 1 s settle left
    // `vehicleExhaustAccumMs` at 5607.9 ms for all SEVEN stationary vehicles
    // in shot, and `__lions.step(140)`'s single `frame(1, lastFrameMs)` took
    // it to 11198.3 -- so the next 22 consecutive zero-time repaints each
    // spawned 7 exhaust puffs (7, 14, 21 ... 161) before the backlog fell
    // under one 500 ms interval and the scene finally stood still. Each fresh
    // puff landed on the last one's pixels, which is why the series decayed
    // (0.00025, 0.00020, 0.00013 ...) without ever reaching zero. And because
    // the size of the backlog is set by `lastFrameMs` -- a load time -- it
    // differed run to run, which is where this entry's baseline noise came
    // from too.
    //
    // After the fix (`frameDtMs(dtMs)`, one call) the control reads a literal
    // 0 px / 0.0000 over 8 successive repaints on the standalone instrument
    // and on 2 full-gate runs, so NO `repaintControl` override is declared and
    // the global hard zero applies. Falsified by re-injecting the one-line
    // defect: 0 px / 0.0004 -> FAIL, the same coin flip CI saw (PASS at
    // 0.0003, FAIL at 0.0004, same commit). Two whole-gate runs with the fix
    // are now bit-identical to each other on this frame (0 px / 0.0000), so
    // the noise figures above are HISTORY -- they are left in the rationale
    // below because the thresholds were calibrated against them and have not
    // been re-derived.
    layerChecks: [
      {
        layer: 'units',
        minDiffPixels: 9800,
        minMeanAbsChannelDelta: 0.98,
        rationale:
          PRE_LIT +
          'hiding every unit body moves 29622-29624 px / 2.9600-2.9620 here -- a spread of 2 px ' +
          'and 0.0020, measured BEFORE c0044ff6 -- then the one layer delta in the gate that was ' +
          'not bit-identical run to run, for the same reason this scenario\'s baseline was not: ' +
          'the vehicle ambient FX spending a banked emission backlog one puff per frame() call. ' +
          'That defect is fixed and the repaint-control reads a literal 0 here now; this ' +
          'delta has NOT been re-measured since, so the spread above may simply be gone. ' +
          'Floors are a third of the SMALLEST of the five. Against 27531-27536 px / 2.6776-2.6797 ' +
          'under the front-lit sun and a pre-lit 23147-23152 px / ' +
          '2.0232-2.0247: the pixel count is up 28% on the pre-lit figure and the magnitude 46%, ' +
          'because each vehicle now takes an AO seam AND a cast shadow that lands on open sand ' +
          'beside it rather than up-screen inside its own silhouette (+8% pixels from the side ' +
          'light alone, on top of the +19% the lights themselves bought). ' +
          'THIS SCENARIO HAD NO REFERENCE-FREE CHECK AT ALL until 2026-09-10, so on a runner with no ' +
          'baseline it was captured and never judged -- and it is the only gated scenario whose subject ' +
          'is mesh vehicles, which is exactly what a fresh environment could not see. ' +
          'The reason it had none is measured and is why this entry is worth reading: the obvious ' +
          'implementation moved 76 px / 0.0100, because `updateMeshUnits`/`updateVehicleMeshes` ' +
          're-assert `root.visible` from fog every frame and the repaint meant to photograph the units ' +
          'missing is the call that puts them back. It was measuring the few billboard instancers and ' +
          'silhouettes that happen not to be re-asserted. `ThreeRenderer.unitsDebugHidden` -- a flag ' +
          'that per-frame path consults -- takes the same toggle from 76 px to 23149, 305x. ' +
          'Falsified by reverting the flag on the VEHICLE write alone, leaving the mesh-unit write ' +
          'respecting it -- so the infantry hide and the vehicles do not: 1472 px / 0.1384, under both ' +
          'floors on both metrics, red. That is also the honest shape of what this check now guards: ' +
          'most of the signal in this frame is the vehicles, which is the point of the scenario.',
      },
    ],
    rationale:
      'whole frame, mesh vehicles plus continuous dust/exhaust FX. The 5-157 px / 0.0029-0.0069 this ' +
      'line used to carry as noise (94 gate runs, 24 + 21 + 49, one macOS machine) is RETIRED: every one ' +
      'of those runs predates c0044ff6 (2026-09-18), and what varied was the ambient-FX emission ' +
      'backlog, whose size is a load time -- never renderer noise. Re-measured 2026-09-23 from every ' +
      'ci.yml `visual` run since that fix, all on linux-x64-swiftshader: against a baseline captured ' +
      'after it (the a387a6a bless) 1-9 px / 0.0004-0.0012 over 5 runs, in two clusters (1 px x2, ' +
      '9 px x3) with no established cause; against the pre-fix 03fad18 baseline 33-47 px / ' +
      "0.0031-0.0054 over 26 runs, the offset being that baseline's own banked puffs. The thresholds " +
      'are still 300 px / 0.02 -- 33x and 17x that post-fix maximum -- and re-deriving them is a ' +
      'decision nobody has taken. The re-injected scatter defect reads 63 px / 0.1953 -- 10x over the ' +
      'threshold on meanAbsChannelDelta and under it on pixel count, which is why magnitude is the ' +
      'primary metric here.',
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
        minDiffPixels: 1400,
        minMeanAbsChannelDelta: 0.15,
        toneCheck: {
          over: ['ground-albedo', 'macro'],
          minFootprintRatio: 0.8,
          rationale:
            'the grain mesh covers 91990 px of this frame over textured ground and 91394 px over ' +
            'the flat palette tone -- ratio 0.9935, identical on the 5 side-light runs (93062 / ' +
            '92076 = 0.9894 under the front-lit sun; 23915 / 22426 = 0.9377 before the lights, the ' +
            'footprint quadrupling because a shaded ' +
            'mark differs from shaded ground over its whole area). **THIS TONE CHECK NO LONGER ' +
            'DISCRIMINATES THE DEFECT AND THE FLOOR IS DELIBERATELY NOT LOWERED TO MAKE IT.** ' +
            'Re-injected on the lit side-light renderer (2026-09-15, the 671acdb composite) it ' +
            'reads 91272 / 83839 = 0.9186 and PASSES 0.8, where pre-lit it read 23731 / 15090 = ' +
            '0.6359 and failed. The cause is the same relief that makes this the only scatter ' +
            'witness with slopes: a mark on a lit hillside differs from the ground under it by ' +
            'its own micro-relief SHADING whatever colour it is, so hiding it moves nearly as ' +
            'many pixels over the flat palette tone as over the texture, defect or no defect. A ' +
            'floor inside 0.9186-0.9935 would be a golden number in disguise -- 0.075 of gap, ' +
            'against 0.26 on quiet and 0.22 on open-ground -- so 0.8 stays and this entry is the ' +
            'record that the check is a TEXTURE witness here, not a defect witness. The defect ' +
            'is still caught on this map, twice: the baseline comparison reads 28 px / 0.1536 ' +
            'against a 0.004 budget, and the two other scenarios\' tone checks both fail. What ' +
            'is lost is reference-free coverage of THIS defect on THIS map -- which matters only ' +
            'on a runner with no blessed baseline. Closing it properly needs a witness that is ' +
            'not a footprint ratio; see docs/superpowers/specs/2026-09-14-lit-renderer-design.md. ' +
            'GROUND TASK 5 (2026-09-25: the control-map splat under the macro field; bit-identical over 3 full-gate runs for ground-albedo, 2 for the tone pairs): with `ground-albedo` + `macro` hidden together it reads ' +
            '91988 / 91165 = 0.9911 clean and 91063 / 80907 = 0.8885 with the no-op -- still a ' +
            'PASS, still a texture witness rather than a defect witness, the gap now 0.10; and ' +
            'the two other scenarios\' tone checks fail on the no-op again (0.5773, 0.6525).',
        },
        rationale:
          PRE_LIT +
          'hiding the grain mesh moves 4344 px / 0.4536 here (4300 / 0.4535 under the front-lit ' +
          'sun -- 1% apart, since a scatter mark has no vertical face for an azimuth to reach), ' +
          'against a pre-lit 7146 px / 0.4093 ' +
          '-- the magnitude held and the pixel count fell 39%, because tel_marum\'s relief now ' +
          'carries its own slope shading and a mark on a lit slope separates from it by less than ' +
          'it did from a flat palette tone. The only scatter witness on a map with relief.',
      },
      // NO `macro` check, by F-18 and not by measurement. The pure
      // `buildMacroField(48, 48)` predicts mean |m| 0.181 over this frame's
      // 324-tile footprint (0.175 per pixel), under the 0.2 the ruling asks
      // a witness to clear: the corridor sits near one of the field's zero
      // crossings. The toggle does move this frame -- 1 px / 0.4284 on all
      // three ground Task 9 runs -- but on ground where the field is this
      // weak a small change to the field (its period, its seed, the border
      // fade) could move the crop onto the crossing, and a floor set there
      // would flicker on content rather than on a fault. quiet and
      // open-ground carry the check instead.
      {
        layer: 'decor',
        minDiffPixels: 17500,
        minMeanAbsChannelDelta: 1.59,
        rationale:
          PRE_LIT +
          'hiding both decor batches moves 52587 px / 4.7771 here, against 45442 / 3.8029 under ' +
          'the front-lit sun and a pre-lit 38513 / ' +
          '2.7695 -- the second largest pixel signal in the gate after quiet/buildings, because ' +
          'this framing is the T1-C ' +
          'boulder field, and larger under each change because each boulder takes its cast shadow ' +
          'with it and that shadow now lands on ground the camera can see. This ' +
          'is the check that closes the exit-3 hole by name: the decor erase that read 37183 px ' +
          'against a baseline and passed the old self-check.',
      },
      {
        layer: 'ground-albedo',
        minDiffPixels: 0,
        minMeanAbsChannelDelta: 0.63,
        rationale:
          PRE_LIT +
          'driving the six ground texture strengths to 0 moves 8 px / 1.9043 here (4 px / 1.9069 ' +
          'under the front-lit sun), against a ' +
          'pre-lit 1015 px / 3.0769. EIGHT pixels: a third of that is not a floor, so ' +
          '`minDiffPixels` is 0 for the reason `LayerCheckSpec` gives for allowing it, exactly as ' +
          'on quiet -- the albedo is a ratio field and one sun spreads its removal below ' +
          'pixelmatch\'s threshold almost everywhere. The magnitude is the whole check here and ' +
          'it is a strong one: a texture that never arrives reads 0.0000 against a 0.63 floor. ' +
          'Still covers the rock slot as well as sand -- tel_marum is the only gated map with `^` ' +
          'ridge walls -- and the base map authors no `n`, which keeps this the control that says ' +
          'the knoll scree reached knoll tiles and nowhere else. ' +
          'GROUND TASK 5 (2026-09-25: the control-map splat under the macro field; bit-identical over 3 full-gate runs for ground-albedo, 2 for the tone pairs): 7 px / 1.8280, the six strengths only (the macro stays on, ' +
          'as on a real 404). Falsified by making every tile top ignore the control map: ' +
          '2 px / 0.1652, FAIL on magnitude; the residue is the road\'s per-vertex slot.',
      },
      {
        layer: 'vignette',
        minDiffPixels: 19800,
        minMeanAbsChannelDelta: 1.13,
        rationale:
          SHELL_P0 +
          'switching the corner vignette off moves 59402 px / 3.4137 here -- the strongest of the ' +
          'four gated framings, because tel_marum at zoom 2 fills the corners with lit rock ' +
          'rather than with background. A pass that stops running reads 0 px / 0.0000.',
      },
      {
        layer: 'skirt',
        // CONTROLLER RULING (G5 follow-up, 2026-09-25): region-scoped rather
        // than a whole-frame floor lowered. Before `skirtRing` the skirt was
        // one quad spanning the map's own footprint, hidden under real
        // terrain by `SKIRT_Y` alone -- so hiding it moved pixels wherever
        // the smoothed ground's Catmull-Rom undershoot let it show through
        // (the G5 defect this task fixes), scattered well outside any one
        // corner, which is what the OLD floor (1100 px / 0.095, `SHELL_P0`)
        // was calibrated against. After the fix the ring draws ONLY past the
        // map edge, and on this corridor-zoomed framing that is a single
        // frame corner: the exact-diff bounding box between the shown and
        // skirt-hidden captures is x[0,212] y[0,99] (`layer-shown.png` vs
        // `layer-skirt-hidden.png`, pixel-exact RGB compare, not pixelmatch's
        // thresholded count). `{x:0,y:0,w:260,h:140}` adds a ~50/40px margin
        // around that box. Scoping is not a threshold widening -- the check
        // keeps its sensitivity exactly where the layer draws; a whole-frame
        // floor recalibrated on the fixed geometry would have to shrink
        // instead, diluted by the ~1.26M pixels the ring no longer touches.
        region: { x: 0, y: 0, w: 260, h: 140 },
        minDiffPixels: 900,
        minMeanAbsChannelDelta: 1.01,
        rationale:
          'measured 2026-09-25 on this fix, 3 consecutive full-gate runs on macOS 15 / M3 Pro, ' +
          'headless Chromium, software SwiftShader, frame loop frozen: bit-identical across all ' +
          'three at 2705 px / 3.0455. Floor is a third, rounded down: 900 px / 1.01 -- 9.5x and ' +
          '10.6x the OLD whole-frame floor (1100 px / 0.095) on the same two metrics, because the ' +
          'region excludes the ~1.26M pixels the ring never touches rather than averaging over ' +
          'them. The whole-frame reading of the identical fix is 2705 px / 0.0880 (see the task-2 ' +
          'report for the R-20 stop this replaces) -- BELOW the old floor on magnitude alone, which ' +
          'is why this check is scoped rather than recalibrated in place. Falsified: with the skirt ' +
          'mesh never added to the scene (the erasure case, not merely toggled) this reads a literal ' +
          '0 px / 0.0000 in-region too and fails both floors, exactly like every other layer check in ' +
          'this file.',
      },
    ],
    rationale:
      'whole frame, tel_marum boulder corridor @ tile (10,15) zoom 2, tick 500 -- the T1-C boulder ' +
      'field plus the extruded rock-ridge relief either side of it. Noise 0 px / 0.0000 over 73 gate ' +
      'runs in two samples (24 + 49; macOS SwiftShader) before the lit renderer, a literal ' +
      '0 px / 0.0000 again over 5 runs against the 2026-09-14 baseline, and 0 px / 0.0000 over 5 ' +
      'more against the 2026-09-15 side-light baseline; thresholds unchanged. ' +
      'Deleting every boulder decor object read 36001 px / 2.6292 here pre-lit -- 900x and 657x ' +
      'the thresholds -- while quiet, open-ground and vehicle did not move outside their own noise ' +
      'at all. The scatter defect also fired here, at 86 px / 0.1452, so this is map coverage ' +
      'rather than a single-feature tripwire.',
  },
  aftermath: {
    // No darwin baseline exists for this scenario -- it ships in the same
    // commit that adds it, so there is nothing to compare a capture against
    // yet (`golden-baseline` exits 3 here, never a silent pass). What votes
    // in that state is the reference-free layer checks below, exactly the
    // regime `three-baseline-gate.ts`'s own top comment describes.
    region: null,
    // Copied from `quiet`, and now MEASURED (fix wave I-2): 22 fresh-process
    // captures against a provisional local baseline (a scratch directory,
    // never committed) read 0 px / 0.0000 on all 22. At the old framing, on
    // the sandbox force, two captures of one commit differed by 519-656 px /
    // 0.040-0.047 -- 13-16x this budget -- from idle mesh units and a live
    // fight on the frame clock. The thresholds were not raised; the camera
    // and the showcase moved (see `AFTERMATH_SCENARIO`).
    maxDiffPixels: 40,
    maxMeanAbsChannelDelta: 0.004,
    layerChecks: [
      {
        layer: 'decals',
        minDiffPixels: 41000,
        minMeanAbsChannelDelta: 2.07,
        rationale:
          GROUND_T17 +
          'hiding both decal pools erases the whole showcase -- every crater, scorch, oil and ' +
          'rubble mark plus both tread and tyre runs, at all three sites -- moving 124019 px / ' +
          '6.2238 (29979 / 1.5346 at the old zoom-1 framing, floor 9900 / 0.5). This is the scenario the showcase exists to be judged on: the two decal pools ' +
          '(`decal-pool.ts`) draw nothing anywhere else in the gate (no other scenario stamps a ' +
          'mark), so this is the only witness for whether the showcase drew at all. Falsified by ' +
          'commenting out `stampDecalShowcase`\'s call in `ThreeRenderer` (R-16\'s D4 entry point): ' +
          '0 px / 0.0000, FAIL.',
      },
      {
        layer: 'roads',
        minDiffPixels: 480,
        minMeanAbsChannelDelta: 0.16,
        rationale:
          GROUND_T17 +
          'driving `uRoadOn` to 0 removes the diagonal road this map\'s own `road` showcase site sits ' +
          'on, packed surface tone, shoulder, ruts and knoll grain together, moving 1453 px / 0.4848 ' +
          '(982 / 0.2565 at the old framing, floor 300 / 0.08). ' +
          'A second witness for `roads` on a second map (`quiet`\'s outskirts crossroads is the ' +
          'first) -- this one on a diagonal road rather than a cardinal one, which the shipped ' +
          'road-graph code does not special-case, so agreement here is real coverage rather than a ' +
          'restatement. Smaller than quiet\'s 187/0.468 in absolute pixel count but larger in ' +
          'magnitude, because this crop is closer to the road than the outskirts crossroads shot is. ' +
          'Falsified by baking control B\'s road distance (B.g) to 255 in `buildControlMap`: ' +
          '0 px / 0.0000, FAIL on both floors.',
      },
      {
        layer: 'macro',
        minDiffPixels: 0,
        // The one floor the reframe LOWERED (0.26 -> 0.23): the reading fell
        // from 0.7833 to 0.7082, and a third of it is 0.236.
        minMeanAbsChannelDelta: 0.23,
        rationale:
          GROUND_T17 +
          'driving the macro field\'s amplitude to 0 moves 3 px / 0.7082 (21 px / 0.7833 at the old ' +
          'framing, floor 0.26 -- the one floor the reframe lowered). THREE pixels is under ' +
          'SUB_THRESHOLD_PX (100), so `minDiffPixels` is 0 for the reason `LayerCheckSpec` allows it, ' +
          'exactly as on `quiet` and `open-ground`: the field is a ratio shift over a wide area, mostly ' +
          'under pixelmatch\'s 0.1 threshold, and the magnitude is the whole check. The STRONGEST macro ' +
          'magnitude witness in the gate (0.7082 against quiet\'s 0.4798 and open-ground\'s 0.8773\'s ' +
          'own crop -- this one is a whole 1400x900 frame, not a crop, yet still reads high because ' +
          'the centroid camera sits over sloped ground the field shades unevenly). F-18: the pure ' +
          '`buildMacroField(48, 48)` predicts mean |m| 0.2130 over this frame\'s 253-tile footprint ' +
          '(0.2645 over 961 tiles at the old zoom-1 framing) ' +
          '(elevation-aware projection, the same `tileToCapture` `baseline.test.ts` already trusts ' +
          'for `RELIEF_SCENARIO framing`, at this scenario\'s own camera/zoom) -- above the 0.2 the ' +
          'ruling asks a witness to clear, and the third map (after `quiet` and `open-ground`) to do ' +
          'so; `relief` does not and does not declare the check (see that entry). Falsified by ' +
          'initialising `uMacroAmp` to 0 in `groundUniforms()`: 0 px / 0.0000, FAIL.',
      },
      {
        layer: 'scatter',
        minDiffPixels: 2000,
        minMeanAbsChannelDelta: 0.26,
        rationale:
          GROUND_T17 +
          'hiding the grain mesh moves 6193 px / 0.7816 here (5195 / 0.6546 at the old framing, ' +
          'floor 1700 / 0.21). A fourth scatter witness (after ' +
          '`quiet`, `open-ground` and `relief`), on ground that carries BOTH a diagonal road and ' +
          'freshly-stamped decals under the same scatter mesh -- the composite order between scatter ' +
          'and a ground mark was never exercised by an existing scenario. No `toneCheck` declared: ' +
          'the tone-collapse ratio depends on the SAME `ground-albedo` + `macro` backdrop every other ' +
          'scatter witness uses, and this scenario adds nothing that ratio needs a fresh floor for -- ' +
          'declaring one here without a distinct measured population would only restate `open-ground`\'s ' +
          '0.9260/0.7109 gap on different ground. Falsified by making `buildScatter` return an empty ' +
          'array: 0 px / 0.0000, FAIL.',
      },
    ],
    rationale:
      'whole frame, qarn_hadid decal showcase centroid @ (34.5,32), zoom 2.2, tick 300 -- the ' +
      'fixed D4 crater/scorch/oil/rubble/tread/tyre showcase on its road, relief and flat sites, ' +
      'anchored clear of the sandbox force so no unit and no live effect is in frame. The only ' +
      'shipped map with a relief showcase site, and the only gated scenario that stamps any ground ' +
      'decal at all. Noise measured 2026-09-25 (fix wave I-2): 0 px / 0.0000 on 22 of 22 ' +
      'fresh-process captures against a provisional local baseline; at the old framing on the ' +
      'force, 519-656 px / 0.040-0.047 between two captures of the same commit. No committed ' +
      'baseline yet in any environment -- see `GROUND_T17`.',
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
 *  every layer floor below at the same time. That is not a slogan: `vehicle`
 *  read 0 px / 0.0001-0.0004 here for eight days behind a per-scenario
 *  stopgap, and finding the cause (see its own entry -- vehicle ambient FX
 *  banked emission credit from the raw frame delta) took it to a literal
 *  0 px / 0.0000 like the rest. Every scenario that runs this control now
 *  meets these constants; `combat`, at four figures, declares no layer checks
 *  and never runs it. */
export const REPAINT_CONTROL_MAX_DIFF_PIXELS = 0;
export const REPAINT_CONTROL_MAX_MEAN_DELTA = 0;

/** Distinct exit codes, so a workflow step can tell "this environment has no
 *  baseline yet" (actionable, and impossible once one exists) apart from "the
 *  picture changed" (a real finding). */
export const EXIT_OK = 0;
export const EXIT_DIFF = 1;
export const EXIT_USAGE = 2;
export const EXIT_NO_BASELINE = 3;
