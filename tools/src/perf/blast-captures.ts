/**
 * The blast contact sheet: ten seconds of motion after a vehicle dies and
 * after a mortar bomb lands, before and after the WP-A1.2 art change
 * (`docs/superpowers/specs/2026-09-19-art-blast-design.md`, Decisions R-E,
 * R-L, R-M).
 *
 *   pnpm blast:capture -- --label=before
 *   pnpm blast:capture -- --label=after --only=mbt_lavi
 *
 * R-L is why this file exists at all: the golden visual gate is structurally
 * blind to this package. `VEHICLE_SCENARIO` parks the sandbox force at tick
 * 140 with nothing dying and no indirect round in the air, and `combat` --
 * the one capture with real kills -- is `gated: false` with no layer checks
 * because its scene does not hold still. So a blast appears in no gated
 * frame, and this sheet is the only visual evidence the project can produce
 * for the work. R-E makes the BEFORE set come first, at the branch base:
 * an instrument built after the change is an instrument nobody can trust to
 * have seen the change.
 *
 * ## This is a retarget of `death-captures.ts`, not a new instrument
 *
 * Three behaviours are INHERITED from that file rather than re-derived here,
 * and each one was paid for once already:
 *
 * 1. **The frame loop is frozen with `FREEZE_FRAME_LOOP_SCRIPT`**, never a
 *    `sleep()`. `step()`'s own paint must be the last paint, or the picture
 *    is whichever frame the compositor happened to hold -- the failure that
 *    cost the golden gate a 28% false-red rate
 *    (`capture-protocol.ts`'s own note).
 * 2. **Every frame after that is pumped EXPLICITLY** (`renderer.frame(1,
 *    FRAME_MS)`), because rAF is throttled in a hidden tab and a
 *    frame-driven read comes back stale with no error.
 * 3. **The subjects are spawned, never found.** The sandbox force's own
 *    vehicles are placed by the map, several of the interesting ones are
 *    hostile, and a hostile draws nothing until a friendly sees its tile.
 *    A side-0 parade on the open northern band (rows 0-7 of
 *    `beit_sahwan_outskirts` are open ground end to end) is visible by
 *    construction and at a tile the camera can be centred on exactly --
 *    `wreck-captures.ts`'s reasoning, unchanged.
 *
 * ## What differs from the infantry sheet
 *
 * **The window is ten seconds, not 1.5.** G0 #14: the lead judges this on
 * motion, and the thing being judged is a smoke column that is supposed to
 * outlive the fireball by twenty times. 200 ms is the coarsest step at which
 * a 450 ms fireball (`EXPLOSION_BURST_DEFAULT_DURATION_MS`) still lands on
 * more than one frame; a ladder that could miss it entirely would photograph
 * the smoke and call it a blast.
 *
 * **One subject is not a unit at all.** `mode: 'impact'` drives a real
 * `mortar_team` to fire a real round and starts its ladder on the frame
 * `shellHasLanded` fires (`ThreeRenderer.updateFx`), which is the frame
 * `spawnShellImpactFx` spawns the burst on. There is no attack-ground
 * command in this sim, so the tube has to ACQUIRE something: a `digger_crew`
 * stands at the impact tile as bait (the one hostile in the roster with no
 * weapons at all, so it cannot shoot the tube off its feet while the round
 * is in the air) and is taken off the field with `removeFromPlay` -- an
 * abduction, not a death, so no wreck and no death clip -- the moment the
 * bomb is up. The bomb therefore lands on genuinely empty ground.
 *
 * **It runs the R-M toggle A/B**, and on the before-set that reports two
 * zeroes with a reason attached, because neither layer exists yet. That is
 * the correct before-reading, not a failure.
 *
 * ## The one uncertainty, measured rather than assumed
 *
 * `__lions.step(n)` ends with `renderer.frame(1, lastFrameMs)`, and
 * `lastFrameMs` is a closure variable in `main.ts` this harness cannot read
 * or set. A kill has to go through one `step(1)` (the `destroyed` event is
 * drained inside `runTick`), so the burst is already `lastFrameMs` old on
 * the frame it first draws. The FX managers are handed the RAW `dtMs`
 * (`updateFx`: `explosionBursts.step(dtMs)`), and `smokeClockMs` accumulates
 * exactly that same raw total -- so the offset is READ, once, from a dry
 * `step(1)` at boot, printed, written into the sheet, and compensated for:
 * every ladder rung from the second onwards lands on its nominal age
 * exactly, and rung zero records the age it actually has.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// The pure half. Imported by `blast-captures.test.ts`, which must not pull
// playwright into `pnpm test` -- so everything browser-shaped below is behind
// a dynamic import inside `main()`, the way `baseline.test.ts` keeps
// `capture-protocol.ts` importable without `browser.ts`.
// ---------------------------------------------------------------------------

/** The window the lead judges on (G0 #14), in milliseconds. */
export const SAMPLE_WINDOW_MS = 10_000;
/** The rung spacing. See `SAMPLE_MS`. */
export const SAMPLE_EVERY_MS = 200;

/**
 * The sample times, inclusive of both ends.
 *
 * Starts at 0 deliberately: frame zero is the only frame that shows the
 * flash, and a ladder that began at `everyMs` would photograph a blast whose
 * first act had already happened.
 *
 * Refuses a step that does not divide the window rather than silently
 * truncating -- a ladder that stops at 9.9 s of a 10 s window is a sheet
 * whose last rung is not the rung anyone quoted.
 */
export function sampleLadder(windowMs: number, everyMs: number): number[] {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`sampleLadder: windowMs must be a positive finite number, got ${windowMs}`);
  }
  if (!Number.isFinite(everyMs) || everyMs <= 0) {
    throw new Error(`sampleLadder: everyMs must be a positive finite number, got ${everyMs}`);
  }
  if (windowMs % everyMs !== 0) {
    throw new Error(
      `sampleLadder: a step of ${everyMs} ms does not divide a ${windowMs} ms window evenly ` +
        `(${windowMs} % ${everyMs} = ${windowMs % everyMs}). Pick a step that divides it, rather ` +
        'than accepting a ladder whose last rung is not the end of the window.'
    );
  }
  const out: number[] = [];
  for (let ms = 0; ms <= windowMs; ms += everyMs) out.push(ms);
  return out;
}

/** The ten-second ladder every subject is photographed on. 51 rungs. */
export const SAMPLE_MS: readonly number[] = sampleLadder(SAMPLE_WINDOW_MS, SAMPLE_EVERY_MS);

export type BlastMode = 'kill' | 'impact';

export interface BlastSubject {
  /** This subject's own name: the file prefix, the sheet row, and what
   *  `--only=<id>` selects on. Distinct across the set. It is the unit type id
   *  too wherever `typeId` is absent, which is every subject the before-set
   *  was taken with. */
  readonly id: string;
  /** The unit type to spawn, when it is not `id` -- the same vehicle
   *  photographed on different ground needs different names and the same
   *  body. */
  readonly typeId?: string;
  readonly mode: BlastMode;
  /** The tile the blast happens on, and the tile the camera is centred on.
   *  For `kill` that is where the vehicle stands; for `impact` it is where
   *  the bomb lands. */
  readonly x: number;
  readonly y: number;
  /** One line for the sheet: why this subject is in the set. */
  readonly why: string;
  /** `impact` only: how far west of the impact tile the tube stands. It has
   *  to clear the weapon's own `min_range_tiles` (`mortar_60`: 4) and sit
   *  inside its `sight_tiles` (7), because nothing else on this field can
   *  spot for it -- `selectTarget` (`sim.ts`) gates every shot on per-side
   *  identification, indirect weapons included. */
  readonly standoffTiles?: number;
  /** `impact` only: the hostile the tube must acquire. `digger_crew` is the
   *  one enemy type in the roster with an empty `weapons` array, so it can
   *  be a legal target (civilians, side 2, never are) without shooting back
   *  at a 350 hp crew during the seconds the round is in the air. */
  readonly baitId?: string;
  /** The map this subject is photographed on. Absent means the parade map
   *  (`beit_sahwan_outskirts`), which is every subject the before-set carries,
   *  so the comparison half of this sheet is untouched by the relief half. */
  readonly map?: string;
  /** Sandbox flags appended to this subject's own page URL (`nomesh`, ...).
   *  Absent means none. Subjects are grouped by (map, flags, isolation) and
   *  one page is booted per group, so a flag costs one page load and never
   *  leaks into another subject's frame. */
  readonly flags?: readonly string[];
  /** This subject's own ladder, when the ten-second one would be waste. The
   *  comparison subjects keep `SAMPLE_MS` because the before-set was taken on
   *  it; a subject that exists to answer ONE question about the first half
   *  second does not need fifty photographs of settled ground. */
  readonly ladderMs?: readonly number[];
  /** Give this subject a page of its own. For a subject that changes the
   *  world around it -- a firefight -- rather than only its own tile. */
  readonly isolate?: boolean;
  /** Stage a firefight beside the subject before killing it, so the blast's
   *  own light lands in a pool already contending with muzzle flashes
   *  (`FLASH_CAPACITY` is 8). Implies `isolate`. */
  readonly firefight?: boolean;
  /**
   * Deliver the kill by hand -- `sim.tick()` + `renderer.snapshot()` +
   * `renderer.onEvents()`, which is `main.ts`'s own `runTick` minus the audio
   * and mission calls -- instead of through `__lions.step(1)`.
   *
   * **This is the only way the hit-stop is photographable at all, and the
   * reason is arithmetic.** `step(1)` ends with `renderer.frame(1,
   * lastFrameMs)`, and the latched `lastFrameMs` on this machine is ~93 ms
   * (see the header). `requestHitStop` asks for 70, `stepHitStop` then drains
   * `max(0, 70 - 93) = 0` and reports `frozen: false` -- so the ENTIRE freeze
   * is consumed by the one frame that delivers the kill, without a single
   * frame ever being held, and the shake is already 93 ms old on the frame it
   * first draws. Driving the tick by hand and pumping 16 ms frames afterwards
   * leaves the freeze intact and rung zero at a true age of zero.
   *
   * The three comparison subjects deliberately do NOT carry this: the
   * before-set was taken through `step(1)` and a trigger change would make
   * every early rung incomparable.
   */
  readonly handTick?: boolean;
  /** Record the per-frame probe through the first `PROBE_WINDOW_MS`: the
   *  hit-stop's own remaining time, the shake's screen-pixel offset at BOTH
   *  ends of `main.ts`'s zoom clamp, and whether the blast's light is still in
   *  the pool. Expensive (two extra zero-time repaints per pumped frame), so
   *  one subject carries it: the full-power reference. */
  readonly probe?: boolean;
  /**
   * Layers this subject RECORDS but does not vote on, each a named exemption
   * with its own measured numbers in `why`.
   *
   * The same shape `baseline.ts` gives a scenario: a scenario declares
   * `layerChecks` for the layers its framing is a good witness for and judges
   * nothing else, because a framing that cannot see a layer would vote zero on
   * a healthy tree. An exemption here is SELF-CLEANING -- a subject that
   * abstains and then clears the floor anyway FAILS the run and says to delete
   * the exemption, the demotion rule `mesh_gait.test.ts` already uses for its
   * named outliers.
   */
  readonly abstains?: readonly string[];
}

/**
 * The relief and `&nomesh` subjects' ladder: the fireball, the wreck swap, and
 * the settled mark. Seven rungs, not fifty -- these subjects answer a question
 * about a mark on the ground and a shroud that is or is not there, both of
 * which have stopped moving inside two seconds.
 */
export const SHORT_LADDER_MS: readonly number[] = [0, 200, 400, 600, 1000, 2000, 4000];

/**
 * The hit-stop and shake ladder, for the one subject driven a frame at a time
 * (`handTick`).
 *
 * Sixteen milliseconds is one frame, and the rungs are dense through the first
 * `hit_stop_ms * power` = 70 ms because THAT is the interval the reviewer's
 * complaint lives in: the freeze runs first with the shake at exactly zero
 * (`shakeOffsetPx` is a sine, so it is 0 at age 0 AND the shake does not age
 * through the freeze), and a sheet that stopped at 100 ms would photograph a
 * held frame with no jolt in it and read as broken. It runs to 1000 ms because
 * the authored `duration_ms` is 420 and the whole claim is that the jolt
 * happens AFTER the hold and is over well inside a second. The last rung is
 * 2000 and is not about the jolt at all: `decals`' own toggle rung is there
 * (`LayerFloor.toggleAtMs`), because a mark photographed while a fireball sits
 * on it is not a measurement of the mark.
 */
export const JOLT_LADDER_MS: readonly number[] = [
  0, 16, 32, 48, 64, 80, 96, 112, 144, 192, 256, 320, 400, 480, 600, 1000, 2000,
];

/**
 * Both halves of the package, on one open row.
 *
 * A sheet that photographed only the vehicle would prove nothing about the
 * mortar sharing the same sequence at its own `impactPower` (0.3 against a
 * collapsing building's 1.0), which is half of what this package claims.
 *
 * Spacing: a tile step is `(32, 16)` px at zoom 1 (`project.ts`), so 12
 * tiles along x is 960 px at the ladder's 2.5 -- well outside the 600x400
 * crop's own +/-300 px, and no subject appears in another's frame. The
 * mortar's 6-tile standoff is 480 px, outside it too, so the tube itself
 * never crowds the impact.
 */
export const BLAST_SUBJECTS: readonly BlastSubject[] = [
  {
    id: 'mbt_lavi',
    mode: 'kill',
    x: 6,
    y: 3,
    why: 'the roster\'s largest vehicle -- the biggest silhouette a blast has to cover',
  },
  {
    id: 'apc_eitan',
    mode: 'kill',
    x: 18,
    y: 3,
    why:
      "wheeled, and a different wreck recipe from the Lavi's. The WEAKEST `decals` witness in " +
      'the set and deliberately still a voting one: hp 1600 gives power 0.533 and ' +
      '`scorchRadiusTiles` its square root, so the mark is 1.17 tiles of radius against the ' +
      "Lavi's 1.6, and its own wreck covers most of that -- which is what sets that layer's floor",
  },
  {
    id: 'mortar_team',
    mode: 'impact',
    x: 34,
    y: 3,
    standoffTiles: 6,
    baitId: 'digger_crew',
    why: 'an arcing round landing at impactPower 0.3, the indirect half of the package',
  },
  // ---------------------------------------------------------------------
  // The four the AFTER set adds. None of them has a before, and none of them
  // is a comparison: each answers one question the reviewer of Task 7 asked
  // and the three subjects above cannot reach, because all three stand on
  // flat, quiet, mesh-drawn ground.
  //
  // They carry SHORT ladders. The ten-second window exists to judge a smoke
  // column that outlives its fireball twentyfold; a mark on a slope and a
  // light in a contended pool are both settled inside a second, and fifty
  // photographs of ground that has stopped moving is not more evidence.
  // ---------------------------------------------------------------------
  {
    id: 'scorch_qarn_shoulder',
    typeId: 'mbt_lavi',
    mode: 'kill',
    map: 'qarn_hadid',
    x: 20,
    y: 20,
    ladderMs: SHORT_LADDER_MS,
    handTick: true,
    why:
      "qarn_hadid's shoulder gate: the scorch seats on ONE centre ground sample, and this tile " +
      'is crest 6 in a gap four tiles wide with the rock wall at x=17 and x=22 and the ground ' +
      'falling to 5 on both sides -- a full-power mark is 1.6 tiles of radius across all of it. ' +
      'HAND-TICKED, and it VOTES on both layers since 2026-09-25. It used to abstain from ' +
      "`blast-light`, because this map's latched `step(1)` frame measured 936.70 ms against the " +
      "emitter's 500 ms `decay_ms`, so the light was retired before rung zero. That was a " +
      'confound, not a reading. The steady-frame settle (`SETTLE_TIMEOUT_MS`) removed it: the ' +
      'light then cleared its floor at 32906 px / 10.0892, and the self-cleaning rule failed the ' +
      "run. This map's steady frame is 190-233 ms, though, which sits ON the 200 ms rung, so a " +
      "kill through `step(1)` would be skipped on roughly two runs in five. `handTick` takes the " +
      'latched frame out of the kill entirely, which is the remedy the skip message itself names',
  },
  {
    id: 'scorch_tel_ridge',
    typeId: 'mbt_lavi',
    mode: 'kill',
    map: 'tel_marum',
    x: 22,
    y: 20,
    ladderMs: SHORT_LADDER_MS,
    why:
      "tel_marum's basin outcrop: flat level-0 ground with a three-tile `^` ridge starting at " +
      'x=23, so the mark runs off interpolated ground onto a TERRACE (a tile is a terrace iff ' +
      '`blocked[tile] !== 0`) rather than up a slope -- the other half of the same question',
  },
  {
    id: 'blast_in_firefight',
    typeId: 'mbt_lavi',
    mode: 'kill',
    x: 6,
    y: 3,
    firefight: true,
    ladderMs: JOLT_LADDER_MS,
    handTick: true,
    probe: true,
    why:
      'the blast light shares the 8-slot `FlashLightManager` pool with every muzzle flash on ' +
      'screen, and nothing has ever photographed it landing in a pool that is already full',
  },
  {
    id: 'shake_probe',
    typeId: 'mortar_team',
    mode: 'impact',
    x: 34,
    y: 3,
    standoffTiles: 6,
    baitId: 'digger_crew',
    isolate: true,
    probe: true,
    ladderMs: JOLT_LADDER_MS,
    why:
      'the shake and the hit-stop, measured where they actually run. A vehicle kill pushes ' +
      "NEITHER on this tree (`catastrophic_kill` is not in `vfxEmitters`), so `blast_in_firefight`'s " +
      'probe reads 0.000 px and 0.0 ms at every frame and proves only the absence. A shell impact ' +
      'resolves through `shell_impact`, which IS in that list, and authors `amplitude_px` 5 and ' +
      '`hit_stop_ms` 40 at `impactPower` 0.3 -- so this subject is the one place the ' +
      'shake-to-camera-to-screen-pixel path can be read live, at both ends of the zoom clamp, ' +
      'and the one place the freeze can be seen holding a frame',
  },
  {
    id: 'blast_nomesh',
    typeId: 'mbt_lavi',
    mode: 'kill',
    x: 6,
    y: 3,
    flags: ['nomesh'],
    ladderMs: SHORT_LADDER_MS,
    why:
      "Task 7 removed the vehicle-kill branch's outer mesh-readiness guard, so a blast fires on " +
      'the billboard path now -- light, shake, hit-stop and scorch, and NO shroud, because a ' +
      'shroud is sized from measured mesh bounds there are none of here. Also the STRONGEST ' +
      '`decals` witness in the set, and the subject that proved the pixel count is the wrong ' +
      'metric for this layer: nothing covers the mark here (the fireball and the plume are both ' +
      'GLBs `&nomesh` never fetches), hiding it moves 65293 pixels by up to 30/255, and ' +
      "pixelmatch at its 0.1 perceptual threshold counts **0** of them. That is the gate's own " +
      'documented blind spot -- a wide area moving by one palette step -- met head on',
  },
];

/** One photograph, and every condition it was taken under. */
export interface SheetCell {
  subject: string;
  mode: string;
  /** The nominal rung, in ms after the trigger. */
  ms: number;
  zoom: number;
  tick: number;
  file: string;
  /** The FX age this frame ACTUALLY carries, where it differs from `ms` --
   *  see the header's "one uncertainty". Absent when the two agree. */
  ageMs?: number;
  /** The FX age READ BACK off `renderer.smokeClockMs` at this rung, rather
   *  than accumulated by this harness. The two differ by exactly whatever the
   *  hit-stop withheld, which is how a freeze is visible in the numbers and
   *  not only in a pair of identical photographs. */
  fxAgeMs?: number;
}

/**
 * The half of the evidence that survives R-E's git-ignored storage.
 *
 * The PNGs live under `.superpowers/` and are never committed, so the
 * NUMBERS -- rung times, zooms, ticks, subject ids, file names -- are what
 * gets quoted into the task report and the PR body. A sheet that named only
 * the files would leave nothing behind once the directory was gone.
 */
export function sheetIndex(label: string, cells: readonly SheetCell[]): string {
  const subjects = [...new Set(cells.map((c) => c.subject))];
  const lines = [
    `# Blast capture sheet -- ${label}`,
    ``,
    `${cells.length} frame(s) over ${subjects.length} subject(s): ${subjects.join(', ') || '(none)'}.`,
    `Ladder: ${SAMPLE_MS.length} rungs, 0..${SAMPLE_WINDOW_MS} ms every ${SAMPLE_EVERY_MS} ms.`,
    ``,
    `| subject | mode | t (ms) | age (ms) | FX age (ms) | zoom | tick | file |`,
    `|---|---|---|---|---|---|---|---|`,
    ...cells.map(
      (c) =>
        `| \`${c.subject}\` | ${c.mode} | ${c.ms} | ${c.ageMs === undefined ? c.ms : c.ageMs} | ` +
        `${c.fxAgeMs === undefined ? '--' : c.fxAgeMs} | ${c.zoom} | ${c.tick} | \`${c.file}\` |`
    ),
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// The toggle floors (R-M). Still the pure half -- imported by the spec.
// ---------------------------------------------------------------------------

/** The smallest reading a layer produced across the calibration runs, and how
 *  many runs that is. A range with no sample size beside it is an anecdote
 *  (CLAUDE.md, the visual gate), so the sample size is a field rather than a
 *  sentence somebody may or may not have written. */
export interface LayerSignal {
  readonly minDiffPixels: number;
  readonly minMeanAbsChannelDelta: number;
  readonly runs: number;
}

/** One layer's floor pair, the signal it was derived from, and the provenance
 *  that travels with both. Same shape as `baseline.ts`'s `LayerCheckSpec`,
 *  deliberately: this is that gate's argument applied to a frame that gate
 *  cannot reach. */
export interface LayerFloor {
  readonly minDiffPixels: number;
  readonly minMeanAbsChannelDelta: number;
  readonly measured: LayerSignal;
  /**
   * The rung this layer's A/B is run at, in ms after the trigger.
   *
   * **Per layer, because one rung cannot witness both, and that is measured.**
   * A blast light lives 500 ms, so it has to be photographed early. A scorch
   * mark is permanent and, for the first second or so, almost entirely COVERED
   * by the fireball and the collapse shroud sitting on top of it -- at 200 ms
   * the `decals` toggle (then `scorch`) reads 0 px / 0.3423 on `mbt_lavi` and 37-89 px / 0.23
   * on `mortar_team`, against 42119 px / 11.18 for `blast-light` on the same
   * frame. (It read 12326 px there before the radial fade landed, and the
   * difference is the square's CORNERS: they reached 1.414x the radius, well
   * outside the shroud, and were most of the old signal. A rounder mark is a
   * worse witness at 200 ms and a better mark.)
   *
   * A ladder that does not carry this exact rung uses its first rung past it.
   */
  readonly toggleAtMs: number;
  readonly rationale: string;
}

/**
 * What hiding each blast layer has to move before this sheet will call the
 * layer present.
 *
 * **A zero must FAIL, and that is the whole argument `debug-layers.ts` makes.**
 * A layer that resolves to no objects -- deleted, renamed, never added to the
 * scene, or spawned by a dispatch that stopped running -- produces a zero
 * delta, and a check that passed on zero would read a deleted layer as a
 * healthy one. That is exactly how `groundTextureCheck` died: it asked what a
 * crop LOOKED like, content landed, and it printed PASS forever. This asks
 * only whether removing the layer changes the frame.
 *
 * **Each floor is a third of the smallest measured signal**, which is the
 * standard `baseline.ts`'s own `layerChecks` are held to, and the third is
 * asserted against `measured` in `blast-captures.test.ts` rather than left as
 * a claim in this comment -- lowering a floor below that third is a red spec,
 * not a quiet weakening.
 *
 * Not per-environment, for the same measured reason the gate's own floors are
 * not: the scene is frozen and the two photographs differ ONLY by the toggle,
 * so a rasteriser difference that is worth hundreds of pixels against a stored
 * baseline moves a toggle delta by almost nothing.
 */
export const LAYER_FLOORS = {
  decals: {
    // ZERO, and it is a decision with a precedent rather than a gap.
    // `baseline.ts`'s own `relief`/`ground-albedo` check does the same and
    // gives the reason: "a third of EIGHT pixels is not a floor". Measured
    // here over 3 runs at the 2000 ms rung, `mbt_lavi` reads 0 px / 0.5818 and
    // `apc_eitan` 0 px / 0.2092-0.2273 while both move a WIDE area by a modest
    // amount -- the mark sits under a wreck, and pixelmatch's 0.1 perceptual
    // threshold discards the whole of it. `blast_nomesh` is the proof by
    // extreme: the largest, least obstructed mark in the set moves 65293
    // pixels by up to 30/255 and pixelmatch counts 0. The magnitude IS the
    // check for this layer, exactly as it is there, and the falsification is
    // unaffected -- a stamp that stops writing reads 0.0000.
    minDiffPixels: 0,
    minMeanAbsChannelDelta: 0.07,
    measured: { minDiffPixels: 0, minMeanAbsChannelDelta: 0.2092, runs: 3 },
    toggleAtMs: 2000,
    rationale:
      'Calibrated 2026-09-20 over 3 runs on darwin-arm64, ANGLE/SwiftShader, 1400x900 at ' +
      'deviceScaleFactor 1, on the 600x400 ladder crop at zoom 2.5, at the 2000 ms rung. ' +
      '`mbt_lavi` 0 px / 0.5818 (bit-identical on all three), `apc_eitan` 0 / 0.2273, 0.2273, ' +
      '0.2092, `mortar_team` 7251 / 1.4411 (bit-identical). The floor is a third of the ' +
      'smallest MAGNITUDE; see `minDiffPixels` above for why the pixel count is not gated. ' +
      '`apc_eitan` sets it: hp 1600 gives power 0.533 and the radius its square root, so its ' +
      'mark is 1.17 tiles against the Lavi\'s 1.6 and its own wreck covers most of that. ' +
      '**The rung moved from 200 ms to 2000 ms in this round and the reason is measured.** At ' +
      '200 ms the fireball and the collapse shroud sit on top of the mark: it read 0 px / ' +
      '0.3423 there against 0.5818 here on `mbt_lavi`, and 37-89 px / 0.23 against 7251 / 1.4411 ' +
      'on `mortar_team` -- a 6x magnitude loss and a 100x pixel loss for photographing a ground ' +
      'mark while something is burning on top of it. The smallest SINGLE-run reading anywhere in ' +
      'the set is `scorch_qarn_shoulder`\'s 0.2020 (one run), and 0.07 is a third of that too ' +
      '(0.0673), so the floor holds against the weakest witness measured rather than only ' +
      'against the weakest one measured three times. (Before the radial fade landed the same ' +
      '200 ms rung read 12326 px on `mbt_lavi`. That was the SQUARE\'s corners, which reached ' +
      '1.414x the radius and stuck out well past the shroud. A rounder mark is a worse witness ' +
      'at 200 ms and a better mark.) ' +
      '**Re-recorded 2026-09-25 under the name `decals` (D5, R-17), floors unchanged.** The layer ' +
      'is both decal pools now -- crater, scorch, oil and rubble in the persistent one, tread and ' +
      'tyre in the fading one -- so it should read at or above the scorch-only figures, and it ' +
      'does. 3 runs on darwin-arm64, same crop, zoom and 2000 ms rung, `--toggles-only`, taken ' +
      'with a FIXED 6000 ms settle (at the old 2500 ms fixed settle the comparison group ' +
      'latched a 511-782 ms boot frame and was skipped on four attempts, so the three subjects ' +
      'that set this floor went unmeasured; see `SETTLE_TIMEOUT_MS`). Latched jumps 96.60 / 95.80 / 107.30 ms on that ' +
      'group. `mbt_lavi` 0 px / 0.6270, 0.6270, 0.6270 (scorch-only 0.5818); `apc_eitan` 0 / ' +
      '0.2588, 0.2363, 0.2363 (0.2092-0.2273); `mortar_team` 7507 / 1.7808 on all three (7251 / ' +
      '1.4411); `scorch_qarn_shoulder` 0 / 0.5057, 0.5647, 0.5619 (0.2020, one run); ' +
      '`scorch_tel_ridge` 0 / 0.4624, 0.4272, 0.4272; `blast_in_firefight` 0 / 0.5186 on all ' +
      'three; `shake_probe` 7507 / 1.7808 on all three; `blast_nomesh` 4021 / 2.9134 on all ' +
      'three. The smallest is `apc_eitan`\'s 0.2363, a third of which is 0.0788: the 0.07 floor ' +
      'still sits under a third of the weakest witness, and `measured` above is left as the ' +
      'scorch-only signal the floor was derived from. ' +
      '**`scorch_qarn_shoulder` re-recorded the same day, hand-ticked** (its kill no longer ' +
      'goes through `step(1)`; see that subject), under the steady-frame settle at its 30000 ms ' +
      'default ceiling. 3 runs: 0 px / 0.4741, 0.4390, 0.4741. It reads lower than the ' +
      '`step(1)` figures above because the mark is photographed at a true 2000 ms rather than ' +
      'at 2000 plus a ~1.6 s latched frame, so the shroud is younger. It is still 6x the floor.',
  },
  'blast-light': {
    minDiffPixels: 1750,
    minMeanAbsChannelDelta: 1.75,
    measured: { minDiffPixels: 5169, minMeanAbsChannelDelta: 5.2263, runs: 3 },
    toggleAtMs: 200,
    rationale:
      'Calibrated 2026-09-20 over the same 3 runs and conditions as `decals` (then `scorch`) above, at the ' +
      '200 ms rung -- inside the emitter\'s own `decay_ms` (500 for a kill, 380 for an impact), ' +
      'which is why this layer cannot share the decals\' rung. `mbt_lavi` 42119 px / 11.1762 ' +
      '(bit-identical on all three), `apc_eitan` 5169 / 6.0333, 5169 / 6.0333, 11540 / 6.6842, ' +
      '`mortar_team` 14174 / 5.3246, 14138 / 5.2582, 13816 / 5.2263. The floor is a third of ' +
      'the smallest of each column, which is `apc_eitan` on pixels and `mortar_team` on ' +
      'magnitude. `apc_eitan` swings 2.2x between runs on pixel count while its magnitude moves ' +
      '11%, which is the same `lastFrameMs` sensitivity every number here has -- it is why the ' +
      'floor is a third of the smallest rather than a band around a mean. **This layer read 0 ' +
      'px / 0.0000 on every kill subject until `catastrophic_kill` was registered in ' +
      '`vfxEmitters`**; these are the first readings of a working kill light. ' +
      '**`scorch_qarn_shoulder` votes here since 2026-09-25**, hand-ticked, under the ' +
      'steady-frame settle. 3 runs: 24496 px / 9.9325, 34749 / 10.5923, 24954 / 9.9812. The ' +
      'floor is unchanged, and all three clear it by 14x on pixels.',
  },
} satisfies Record<string, LayerFloor>;

/**
 * One line of the "Floors in force" listing printed at the end of every
 * sheet -- factored out so the phrasing can be asserted directly rather than
 * read back out of a whole rendered document.
 *
 * `minDiffPixels === 0` is a stated DECISION (see `LAYER_FLOORS.decals`' own
 * comment), not an unset floor, so printing the bare `0 px` beside it reads as
 * a check that gates on nothing at all -- three lines under a banner that
 * says "a zero is a FAILURE here". This spells out which column actually
 * carries the floor instead of leaving that zero to be misread.
 */
export function floorLine(layer: string, f: LayerFloor): string {
  const px =
    f.minDiffPixels === 0
      ? 'pixel count does not gate this layer -- the tone column votes'
      : `${f.minDiffPixels} px`;
  return (
    `- \`${layer}\`: ${px} / ${f.minMeanAbsChannelDelta} at the ` +
    `${f.toggleAtMs} ms rung (a third of ${f.measured.minDiffPixels} px / ` +
    `${f.measured.minMeanAbsChannelDelta} over ${f.measured.runs} runs)`
  );
}

/** The two numbers a toggle A/B produces, whatever produced them. */
export interface LayerReadingNumbers {
  readonly diffPixels: number;
  readonly meanAbsChannelDelta: number;
}

export interface LayerVerdict {
  readonly ok: boolean;
  readonly layer: string;
  /** Every reason it failed, never only the first -- a reading that misses on
   *  both metrics is a different finding from one that misses on one. */
  readonly reasons: readonly string[];
}

/**
 * Whether one toggle reading clears its layer's floor.
 *
 * Fails on EITHER metric, not on their conjunction. The two say different
 * things: `diffPixels` is how much of the frame the layer touches and
 * `meanAbsChannelDelta` is how far it moves what it touches, and a layer that
 * still covers its own area while contributing nothing to the colour (the
 * scatter no-op's whole shape) clears the first and not the second.
 * `meanAbsChannelDelta` is the PRIMARY of the two here for the same reason it
 * is in `baseline.ts`.
 *
 * An unrecognised layer is a FAILURE rather than a throw or a pass: the name
 * has to resolve in three places at once (this table, `DEBUG_LAYERS` in the
 * renderer, and the `switch` that hides something), and the failure mode worth
 * catching is a name that quietly stops resolving in one of them.
 */
export function layerVerdict(layer: string, reading: LayerReadingNumbers): LayerVerdict {
  const floor: LayerFloor | undefined = (LAYER_FLOORS as Record<string, LayerFloor>)[layer];
  if (floor === undefined) {
    return {
      ok: false,
      layer,
      reasons: [`no floor for layer "${layer}" (have: ${Object.keys(LAYER_FLOORS).join(', ')})`],
    };
  }
  const reasons: string[] = [];
  if (!(reading.diffPixels >= floor.minDiffPixels)) {
    reasons.push(`diffPixels ${reading.diffPixels} < floor ${floor.minDiffPixels}`);
  }
  if (!(reading.meanAbsChannelDelta >= floor.minMeanAbsChannelDelta)) {
    reasons.push(
      `meanAbsChannelDelta ${reading.meanAbsChannelDelta.toFixed(4)} < floor ${floor.minMeanAbsChannelDelta}`
    );
  }
  return { ok: reasons.length === 0, layer, reasons };
}

/** Whether this subject votes on this layer, or only records it. */
export function subjectVotesOn(subject: Pick<BlastSubject, 'abstains'>, layer: string): boolean {
  return !(subject.abstains ?? []).includes(layer);
}

/**
 * Whether a reading is acceptable, given whether the subject votes on it.
 *
 * A voting subject must clear its floor. An ABSTAINING one must NOT -- an
 * exemption that is no longer needed fails and says to delete itself, which is
 * the demotion rule `mesh_gait.test.ts` already applies to its named outliers.
 * Without that half, an abstention is a permanent hole: the day somebody fixes
 * whatever made the subject a poor witness, nothing would ever notice.
 */
export function readingAccepted(voted: boolean, clearsFloor: boolean): boolean {
  return voted === clearsFloor;
}

// ---------------------------------------------------------------------------
// The browser half. Nothing below is imported by the spec.
// ---------------------------------------------------------------------------

/** Ports in use by this repo's other harnesses: 5173 a human's own dev
 *  server, 5174 golden-diff, 5175 three-baseline, 5176 ui:shots, 5177
 *  ui:routes, 5178 wreck-captures, 5179 death-captures and unit-plates,
 *  5182 weight-captures, 5183 plate:host (`host-plate-capture.ts`). This
 *  one takes the next free number and never touches another. */
const PORT = 5181;
const VIEWPORT = { width: 1400, height: 900 } as const;
/** The establishing still, then the ladder. The lead's figure for the ladder
 *  is 2.5, which is the top of `main.ts`'s own 0.35-2.5 camera clamp. */
const ESTABLISH_ZOOM = 1.0;
const LADDER_ZOOM = 2.5;
/** The bottom of the same clamp. The probe reads the shake at both ends
 *  because `amplitude_px` is authored in SCREEN pixels and the conversion into
 *  camera tiles divides by zoom -- so a number that moves between these two is
 *  a defect, and one that does not is the property being claimed. */
const MIN_ZOOM = 0.35;
/** The crop the ladder rungs are taken at, centred on the blast. Same shape
 *  and lift as `death-captures.ts`: a 1400x900 frame of one detonation is
 *  mostly empty desert. */
const CLOSE_CROP = { width: 600, height: 400 } as const;
const CLOSE_CROP_LIFT_PX = 50;
/** One pumped frame. Below `FRAME_DT_CEILING_MS` (100) by a wide margin, so
 *  the raw and clamped frame clocks agree on every rung this harness drives
 *  itself. */
const FRAME_MS = 16;
/**
 * The rung each layer's A/B is run at, resolved against a subject's own
 * ladder: the first rung at or past that layer's `toggleAtMs`, and the last
 * rung if the ladder ends before it. Never simply "the last rung" -- on the
 * jolt ladder that would run `blast-light`'s A/B at 1000 ms, where a 500 ms
 * light has retired and a zero would mean nothing at all.
 */
function toggleRungFor(layer: string, ladder: readonly number[]): number {
  const want = (LAYER_FLOORS as Record<string, LayerFloor>)[layer]?.toggleAtMs ?? 0;
  return ladder.find((m) => m >= want) ?? ladder[ladder.length - 1];
}
/** R-M. Derived from `LAYER_FLOORS` rather than written twice, so a layer
 *  toggled but unfloored -- or floored but never toggled -- is not
 *  expressible. `setDebugLayerVisible` throws on an unknown name BY DESIGN
 *  (`unknownDebugLayerMessage`), so a typo can never read as a layer that
 *  draws nothing; and since Task 8 a zero is a FAILURE rather than a note. */
const LAYERS: readonly string[] = Object.keys(LAYER_FLOORS);
/** The map the three comparison subjects parade on. */
const DEFAULT_MAP = 'beit_sahwan_outskirts';
/** The window the per-frame probe records, for a subject that asks for one.
 *  Past the authored `screen_shake.duration_ms` (420) by a margin, so the
 *  probe covers the shake's whole life and its retirement. */
const PROBE_WINDOW_MS = 700;
/**
 * `light.radius_tiles` above which an entry in the flash pool is a KILL's
 * blast light. `catastrophic_kill.json` authors 7.
 *
 * A DIAGNOSTIC COLUMN, never a verdict, and it is honest about what it cannot
 * separate. `shell_impact.json` authors 4, so an IMPACT subject's own blast
 * light reads `false` here by design -- measured on `shake_probe`, which shows
 * `flashes live` 1 from 16 ms to 352 ms (the emitter's `decay_ms` is 380) and
 * `blast light` no throughout. And `fire_apfsds` authors 5.5, so a Lavi firing
 * beside a kill would read `true` on radius alone. The column answers "is a
 * seven-tile light still in the pool", which is the only question the flash
 * pool's 8-slot eviction raises, and nothing more.
 */
const BLAST_LIGHT_RADIUS_FLOOR = 5;
/** How many of each side the `firefight` staging puts beside the subject, and
 *  how far apart. Close enough that a rifle (8 tiles) reaches across, far
 *  enough that neither side stands on the vehicle being killed. */
const FIREFIGHT_PAIRS = 3;
const FIREFIGHT_GAP_TILES = 4;
const FIREFIGHT_WARMUP_TICKS = 60;

/** The repo root, derived from this module's own location rather than from
 *  `process.cwd()`. `pnpm blast:capture` delegates through
 *  `pnpm --filter @lions/tools`, so the cwd is `tools/` -- exactly the trap
 *  that made the golden gate write every capture to
 *  `tools/visual-baseline-output` while its workflow uploaded the repo-root
 *  path and logged "No files were found" on every run (CLAUDE.md, the visual
 *  gate). Both the default output directory and the dev server's own root
 *  resolve against this. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The settle: how the harness decides the app's frame loop has reached
 * steady state before freezing it. See its use site for why that matters:
 * the freeze latches the last live frame's cost into every `step()`.
 *
 * **It waits for frames, not for time.** Until 2026-09-25 this was a fixed
 * 2500 ms, and the fixed number stopped working. A rAF probe of
 * `beit_sahwan_outskirts` at the settle viewport found the first real loop
 * frame 3.6-3.9 s after `__lions` appears, as ONE ~6 s main-thread block,
 * then ~170 ms, then 92-109 ms steadily. That is the same shape on this
 * branch and on `8d525c81` (main before any ground code), 3 runs each. Each
 * tree's own harness, at the fixed 2500 ms, latched 753.6-818.9 ms on that
 * group and SKIPPED it, on both trees, so the three subjects that set both
 * floors went unmeasured. The boot got slower than the constant, and the
 * fix is to stop guessing a duration.
 *
 * `SETTLE_STEADY_MAX_FRAME_MS` is 150 because steady frames measure 82-109
 * ms here (the calibration's ~93) while the earliest toggle rung is 200 ms.
 * The run of `SETTLE_STEADY_FRAMES` consecutive frames is what tells a
 * settled loop from a single fast frame between two boot blocks.
 *
 * `SETTLE_TIMEOUT_MS` is a ceiling, not a guess. A scene whose steady frame
 * is slower than the band (`qarn_hadid` latched ~1.6 s under a fixed 6 s
 * settle) runs to it and freezes anyway. `step(1)`'s own jump guard is the
 * backstop: if the latched frame outruns a voting rung, it skips the group
 * loudly instead of mis-measuring it. `--settle-ms` overrides the ceiling.
 */
const SETTLE_STEADY_FRAMES = 5;
const SETTLE_STEADY_MAX_FRAME_MS = 150;
const SETTLE_TIMEOUT_MS = 30_000;

/** What the settle saw: every frame interval it waited through, in order,
 *  and whether it ended on a steady run or on the ceiling. */
export interface SettleResult {
  readonly steady: boolean;
  readonly waitedMs: number;
  readonly frames: readonly number[];
}

/**
 * Where a run of `n` consecutive frames at or under `maxMs` first
 * completes. Returns the index of that run's last frame, or -1 if none.
 * The in-page settle loop applies the same rule; this pure copy is what the
 * spec pins and what the printed summary re-checks, so a page-side slip
 * shows up as a disagreement on the sheet rather than as a quiet
 * mis-settle.
 */
export function steadyRunEnd(frames: readonly number[], n: number, maxMs: number): number {
  let run = 0;
  for (let i = 0; i < frames.length; i++) {
    run = frames[i] <= maxMs ? run + 1 : 0;
    if (run >= n) return i;
  }
  return -1;
}

/**
 * The in-page half of the settle, as a STRING rather than a function. tsx
 * runs this file through esbuild with `keepNames`, which wraps any named
 * inner function in a `__name(...)` call. Serialised into the page, that
 * helper does not exist and the evaluate throws `ReferenceError: __name is
 * not defined` (measured on the first run of this settle).
 * `FREEZE_FRAME_LOOP_SCRIPT` is a string for the same reason. It applies
 * `steadyRunEnd`'s rule frame by frame, and `settleLine` re-checks it.
 */
export function settleScript(timeoutMs: number): string {
  return `new Promise((resolve) => {
  const n = ${SETTLE_STEADY_FRAMES}, maxMs = ${SETTLE_STEADY_MAX_FRAME_MS}, timeoutMs = ${timeoutMs};
  const t0 = performance.now();
  const frames = [];
  let last = -1;
  let run = 0;
  function tick(t) {
    if (last >= 0) {
      const d = t - last;
      frames.push(Math.round(d * 10) / 10);
      run = d <= maxMs ? run + 1 : 0;
    }
    last = t;
    const waitedMs = performance.now() - t0;
    if (run >= n) resolve({ steady: true, waitedMs, frames });
    else if (waitedMs >= timeoutMs) resolve({ steady: false, waitedMs, frames });
    else requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})`;
}

/** Narrows what the page returned. A string evaluate is `unknown` on this
 *  side, and a malformed result must throw rather than read as "settled". */
export function parseSettleResult(v: unknown): SettleResult {
  if (typeof v !== 'object' || v === null) throw new Error('settle: page returned no result');
  const r = v as Record<string, unknown>;
  const frames = r.frames;
  if (
    typeof r.steady !== 'boolean' ||
    typeof r.waitedMs !== 'number' ||
    !Array.isArray(frames) ||
    !frames.every((f): f is number => typeof f === 'number')
  ) {
    throw new Error(`settle: malformed result ${JSON.stringify(v)}`);
  }
  return { steady: r.steady, waitedMs: r.waitedMs, frames };
}

/** One line for the console and the sheet's notes: how long the settle
 *  waited, how it ended, every frame over the band, and the run it ended on. */
export function settleLine(key: string, r: SettleResult): string {
  const over = r.frames
    .map((d, i) => [i, d] as const)
    .filter(([, d]) => d > SETTLE_STEADY_MAX_FRAME_MS)
    .map(([i, d]) => `#${i} ${d.toFixed(1)}`);
  const tail = r.frames.slice(-SETTLE_STEADY_FRAMES).map((d) => d.toFixed(1));
  const agrees = (steadyRunEnd(r.frames, SETTLE_STEADY_FRAMES, SETTLE_STEADY_MAX_FRAME_MS) >= 0) === r.steady;
  return (
    `${key}: settle ${r.steady ? 'reached' : 'DID NOT reach'} ${SETTLE_STEADY_FRAMES} frames <= ` +
    `${SETTLE_STEADY_MAX_FRAME_MS} ms after ${r.waitedMs.toFixed(0)} ms and ${r.frames.length} frame(s); ` +
    `over the band: ${over.length > 0 ? over.join(', ') : 'none'}; last ${tail.length}: ${tail.join(', ')} ms` +
    (agrees ? '' : ' -- PAGE AND NODE DISAGREE ON THE STEADY RULE')
  );
}
/** The viewport the settle runs at, before the capture viewport is put back.
 *  See `main()`: a SwiftShader frame of the real 1400x900 scene costs
 *  hundreds of milliseconds, and `step(1)` latches exactly one of those into
 *  the fireball's age. Small enough to be cheap, large enough that the app
 *  and the renderer are doing all of their real work. */
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;

const MESH_WAIT_MS = 300_000;
const STEP_TIMEOUT_MS = 120_000;
const FIRE_TICK_CAP = 1200;
const FLIGHT_FRAME_CAP = 900;
const FIXED = 65536;

interface LionsWindow {
  __lions: {
    step(n: number): number;
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      snapshot(): void;
      onEvents(events: unknown[]): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      smokeClockMs: number;
      shells: { kind: string; tx: number; ty: number; t: number; duration: number }[];
      meshUnitEntities: Map<number, { actions: Map<string, unknown> }>;
      vehicleMeshEntities: Map<number, unknown>;
      setDebugLayerVisible(name: string, visible: boolean): number;
      // Declared `private` in TypeScript and therefore perfectly readable from
      // a page: these are READ ONLY here, never written, and nothing the
      // harness does depends on their being public API. `viewCamera` is the
      // one the shake actually reaches (`threeCamera()` returns it), which is
      // why the probe reads it rather than `camera` -- `camera` is the shared
      // `packages/app` object the shake deliberately never touches.
      viewCamera: { position: { x: number; y: number; z: number } };
      hitStop: { remainingMs: number };
      flashLights: { liveCount: number; active: { radius: number; ageMs: number; peak: number }[] };
    };
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array; posX: Int32Array; posY: Int32Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      tick(): unknown[];
      debugKill(id: number): void;
      removeFromPlay(id: number): void;
    };
  };
}

interface LayerReading {
  subject: string;
  layer: string;
  available: boolean;
  diffPixels: number;
  meanAbsChannelDelta: number;
  /** Whether the reading clears its layer's floor. */
  over: boolean;
  /** Whether this subject votes on this layer at all (`BlastSubject.abstains`). */
  voted: boolean;
  /** R-M's whole point since Task 8: the reading is judged, and a zero is a
   *  failure. A voting subject must clear its floor; an ABSTAINING one must
   *  NOT -- an exemption that is no longer needed fails and says to delete
   *  itself. */
  ok: boolean;
  note: string;
}

/** One pumped frame of a probed subject. Everything here is READ off the
 *  renderer after the frame it describes; nothing is recomputed. */
interface ProbeSample {
  /** Requested frame time since the trigger -- wall clock, not FX age. */
  requestedMs: number;
  /** What the FX clock actually took, which is the same number MINUS whatever
   *  the hit-stop withheld. The gap IS the freeze. */
  fxAgeMs: number;
  hitStopMs: number;
  /** The shake's screen-pixel offset, measured through the renderer's own
   *  projection at both ends of `main.ts`'s 0.35-2.5 zoom clamp. */
  px2p5: { dx: number; dy: number };
  px0p35: { dx: number; dy: number };
  flashLive: number;
  /** Whether an entry with the blast light's own radius is still in the pool. */
  blastLightAlive: boolean;
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function has(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

/** A subject's page URL key. One page is booted per distinct key, and a
 *  subject that changes the world around it (`firefight`) or the build itself
 *  (`flags`) gets one of its own rather than leaking into another's frame --
 *  `death-captures.ts`'s lesson about its killer, generalised. */
function groupKey(s: BlastSubject): string {
  const isolated = s.isolate === true || s.firefight === true;
  return [s.map ?? DEFAULT_MAP, (s.flags ?? []).join('&'), isolated ? s.id : ''].join('|');
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT, REPAINT_SCRIPT, layerToggleScript } = await import(
    '../golden-diff/capture-protocol'
  );
  const { computeDiff } = await import('../golden-diff/diff');

  const label = arg('label', '');
  if (label !== 'before' && label !== 'after') {
    throw new Error('--label=before|after is required: the sheet is a comparison or it is nothing');
  }
  const port = Number(arg('port', String(PORT)));
  if (port === 5173) throw new Error("refusing --port=5173: that is the convention for a human's own dev server");
  const outRoot = path.resolve(REPO_ROOT, arg('out', path.join('.superpowers', 'art-captures', 'blast')));
  const out = path.join(outRoot, label);
  const only = arg('only', '');
  // A COMMA LIST, not one name. The floors below are calibrated by running the
  // same three comparison subjects several times, and spelling that as three
  // separate runs would boot three dev servers to answer one question.
  const onlyIds = only ? only.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [];
  const wanted = onlyIds.length > 0 ? BLAST_SUBJECTS.filter((s) => onlyIds.includes(s.id)) : BLAST_SUBJECTS;
  for (const id of onlyIds) {
    if (!BLAST_SUBJECTS.some((s) => s.id === id)) {
      throw new Error(`--only=${id} names no subject (have: ${BLAST_SUBJECTS.map((s) => s.id).join(', ')})`);
    }
  }
  // Calibration and falsification mode. Drives each subject to the toggle rung
  // and runs the A/B there, photographing no ladder at all. It exists because a
  // floor is a third of a signal measured several times, and because falsifying
  // one means running the harness twice more against a deliberately broken
  // renderer -- fifty-one screenshots a subject to reach one measurement is a
  // poor trade made three times over.
  //
  // It measures the same thing the full run does, and the agreement was
  // MEASURED rather than argued: `mortar_team` reads 7287 px / 1.1295 for
  // `scorch` (now `decals`) and 14308 / 5.4267 for `blast-light` on a full run against 7329 /
  // 1.1312 and 14315 / 5.4340 here -- 0.6% and 0.05%. `mbt_lavi`'s `scorch`
  // spreads wider (12326 / 2.6119 full, 11964 / 2.4749 here, 3% and 5%), and
  // that is NOT the mode: it is `lastFrameMs`, which differs run to run (97.80
  // ms and 92.80 ms on those two), so the ladder reaches the same nominal age
  // over a different number of 16 ms frames and everything integrated per
  // frame lands slightly differently. Hence three runs and a floor at a third
  // of the smallest, rather than one run and a tight band.
  const togglesOnly = has('toggles-only');
  // The settle's CEILING (see `SETTLE_TIMEOUT_MS`). The settle itself waits
  // for steady frames, and this only bounds how long it may wait.
  const settleMs = Number(arg('settle-ms', String(SETTLE_TIMEOUT_MS)));
  if (!Number.isFinite(settleMs) || settleMs < 0) throw new Error(`--settle-ms must be a non-negative number`);
  fs.mkdirSync(out, { recursive: true });

  const cells: SheetCell[] = [];
  const notes: string[] = [];
  const layerReadings: LayerReading[] = [];
  const probes: Record<string, ProbeSample[]> = {};

  // One page per (map, flags, isolation) group, in the order the subject list
  // declares them, so the three comparison subjects still share exactly the
  // one page and the one settle the before-set was taken through.
  const skipped: string[] = [];
  const groups = new Map<string, BlastSubject[]>();
  for (const s of wanted) {
    const key = groupKey(s);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [s]);
    else bucket.push(s);
  }

  const server = await ensureDevServer(port, REPO_ROOT, 'blast-captures');
  const browser = await chromium.launch({ headless: true });
  let gl = 'unknown';
  let firstStepJumpMs = 0;
  try {
    gl = await readUnmaskedRenderer(browser);
    let groupIndex = 0;
    for (const [key, subjects] of groups) {
      const map = subjects[0].map ?? DEFAULT_MAP;
      const flags = subjects[0].flags ?? [];
      console.log(`\n=== group ${++groupIndex}/${groups.size}: ${key} (${subjects.map((s) => s.id).join(', ')})`);
      const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      page.on('pageerror', (err) => console.log('  page error:', err.message));
      // `&renderer=three` explicitly, never by omission: `renderer-choice.ts`
      // falls back to `localStorage['lions.renderer']`, which is per-ORIGIN and
      // shared with every other capture ever run against this dev server.
      const flagQuery = flags.map((f) => `&${f}`).join('');
      await page.goto(`http://localhost:${port}/?sandbox=${map}&renderer=three${flagQuery}`, {
        waitUntil: 'load',
      });
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
      await page.evaluate(() => document.fonts.ready);
      // THE SETTLE RUNS BEFORE THE FREEZE, AND AT A SMALL VIEWPORT. Both
      // invert what `capture()` does (`browser.ts`), both deliberately, and
      // the reason is one measured number.
      //
      // `main.ts`'s `__lions.step(n)` ends with `renderer.frame(1,
      // lastFrameMs)`, and `lastFrameMs` is written ONLY by the app's own rAF
      // loop -- so freezing the loop LATCHES whatever the last live frame
      // cost, for every `step()` this harness will ever make. A kill has to go
      // through one `step(1)` (the `destroyed` event is drained inside
      // `runTick`), and the FX managers are handed the RAW `dtMs`
      // (`updateFx`: `explosionBursts.step(dtMs)`), so that latched number is
      // the age the fireball already has on the frame it first draws.
      //
      // Measured on this scene, three ways. Freezing immediately, the way
      // `capture()` does, latched 5181.70 ms -- a boot frame, which is a GLB
      // load. Settling first at the capture's own 1400x900 latched 427.70 ms,
      // because a SwiftShader frame of this scene really does cost that: the
      // 450 ms fireball would have been 95% over before rung zero. Settling at
      // 320x200 and putting the capture viewport back afterwards latches an
      // ordinary frame of a scene doing all the same work with a twentieth of
      // the pixels.
      //
      // `capture()`'s own reason for freezing first is a repeatable absolute
      // tick for a stored baseline. This harness pins no tick and stores no
      // baseline, so it pays none of that.
      // Waits for `SETTLE_STEADY_FRAMES` consecutive rAF intervals at or
      // under `SETTLE_STEADY_MAX_FRAME_MS`, or for the ceiling. A rAF
      // callback's own interval is the app loop's `frameMs`: both run in
      // the same frame, so this measures the number the freeze will latch.
      const settle = parseSettleResult(await page.evaluate(settleScript(settleMs)));
      const settleNote = settleLine(key, settle);
      console.log(`  ${settleNote}`);
      notes.push(settleNote);
      await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
      await page.setViewportSize({ ...VIEWPORT });
      // The renderer follows the host through a `ResizeObserver`
      // (`ThreeRenderer.init`), not through the frame loop, so this lands with
      // the loop frozen -- but it lands on the browser's own rendering
      // lifecycle rather than on anything this script awaits. Read the canvas
      // back off the DOM and refuse to continue if it did not take: every crop
      // rect below comes from `worldToScreen`, which would otherwise be
      // projecting into a 320x200 frame and cropping a 1400x900 screenshot
      // with it, off-centre and plausible-looking.
      await page.waitForFunction(
        ([w, h]) => {
          const c = document.querySelector('canvas');
          return c !== null && c.clientWidth === w && c.clientHeight === h;
        },
        [VIEWPORT.width, VIEWPORT.height] as const
      );
      await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

      // `VIEW_DIRECTION * CAMERA_DISTANCE` (`camera.ts`'s `updateDimetricCamera`),
      // read off a frame with nothing shaking rather than re-derived from the
      // two constants -- a harness that recomputed the renderer's arithmetic
      // would agree with itself about a shake that never reached the camera.
      const viewBase = await page.evaluate((): [number, number] => {
        const r = (window as unknown as LionsWindow).__lions.renderer;
        return [r.viewCamera.position.x - r.camera.x, r.viewCamera.position.z - r.camera.y];
      });

      // The dry read of `step()`'s own frame jump -- see the header. Done once,
      // before anything is spawned, because `lastFrameMs` never changes again
      // with the loop frozen.
      const stepJumpMs = await page.evaluate(() => {
        const L = (window as unknown as LionsWindow).__lions;
        const before = L.renderer.smokeClockMs;
        L.step(1);
        return L.renderer.smokeClockMs - before;
      });
      console.log(`step(1) advances the FX clock by ${stepJumpMs.toFixed(2)} ms (measured, not assumed)`);
      if (groupIndex === 1) firstStepJumpMs = stepJumpMs;
      // EVERY group's jump is recorded, not only the ones past the ladder step.
      // `conditions.stepJumpMs` can carry exactly one number and a multi-group
      // run has one per page -- measured 25.90 ms to 936.70 ms across four
      // pages of one run, a 36x spread that decides whether a 500 ms light is
      // even alive at rung zero. A number that large left out of the sheet
      // makes the capture unreadable a week later.
      notes.push(
        `${key}: step(1) advances the FX clock by ${stepJumpMs.toFixed(2)} ms` +
          (stepJumpMs > SAMPLE_EVERY_MS
            ? `, which is past the ${SAMPLE_EVERY_MS} ms ladder step: a kill subject's early rungs are ` +
              'late by that much and are recorded with their real age.'
            : '.')
      );

      // A RUN WHOSE TRIGGER OVERSHOOTS A TOGGLE RUNG IS NOT A MEASUREMENT.
      // `step(1)` latches whatever the last live frame cost, and it is not
      // under this harness's control: measured 25.90 ms, 90.70, 91.70, 936.70
      // and once **1876.70** on the same machine in one sitting. At 1876.70 a
      // kill's 500 ms `blast-light` is long retired before rung zero, and the
      // A/B reads 0 px / 0.0000 -- indistinguishable, in the sheet, from a
      // light that never spawned. That run happened, it read exactly that, and
      // the only thing that stopped it being recorded as a renderer failure
      // was somebody noticing the jump in the log.
      //
      // So it is refused BEFORE the captures are spent, naming the number.
      // `handTick` subjects are exempt because they never go through `step(1)`
      // at all, and an abstaining (subject, layer) pair is exempt because it is
      // not being measured either way. This is the gate's own exit-3 rule --
      // "nothing was COMPARED" must never read as a pass -- applied here.
      const overshot = subjects
        .filter((s) => s.mode === 'kill' && s.handTick !== true)
        .flatMap((s) =>
          LAYERS.filter(
            (l) => subjectVotesOn(s, l) && stepJumpMs > toggleRungFor(l, s.ladderMs ?? SAMPLE_MS)
          ).map((l) => `${s.id}/${l} (rung ${toggleRungFor(l, s.ladderMs ?? SAMPLE_MS)} ms)`)
        );
      if (overshot.length > 0) {
        // SKIPPED AND RECORDED, never thrown. `guardCapture`'s own lesson
        // (`capture-guard.ts`): the first Linux bless threw on one scenario's
        // capture and discarded four baselines already written to disk. This
        // group's pictures are unusable -- rung zero is already `stepJumpMs`
        // old -- but the other groups' are not, so the run continues and fails
        // at the end.
        const message =
          `${key}: SKIPPED. step(1) latched a ${stepJumpMs.toFixed(2)} ms frame, past the toggle rung ` +
          `of ${overshot.join(', ')} -- the trigger has already aged the effect past the frame the A/B ` +
          'photographs, so a zero there would measure this harness rather than the renderer. Re-run ' +
          '(the jump is a machine-load artefact: 25.90 to 1876.70 ms measured on one machine in one ' +
          'sitting), or give the subject `handTick`, which never goes through `step(1)` at all.';
        console.error(`  ${message}`);
        notes.push(message);
        skipped.push(key);
        await page.close();
        continue;
      }

      // Everything that needs a GLB is spawned up front so one wait covers it.
      // The bait is NOT: a hostile on the field from tick zero would be shot at
      // (and would walk into) every other subject's frame for the whole run --
      // `death-captures.ts` learned the same lesson about its killer.
      const placed = await spawnSubjects(page, subjects);
      await waitForMeshes(page, placed, notes);

      for (const p of placed) {
        console.log(`${label}: ${p.subject.id} (${p.subject.mode}) at [${p.subject.x}, ${p.subject.y}]`);
        if (p.subject.firefight === true) await stageFirefight(page, p, notes);
        const trigger =
          p.subject.mode === 'kill'
            ? await triggerKill(page, p, stepJumpMs)
            : await triggerImpact(page, p, notes);
        if (trigger === null) continue;

        // `ageMs` is the FX age this frame really carries. It starts at the
        // trigger's own offset (zero for an impact, `stepJumpMs` for a kill)
        // and is then driven to each rung EXACTLY, rather than by adding a
        // fixed step per rung -- so a non-zero offset shifts rung zero alone
        // and every later rung still lands on its nominal age.
        //
        // For a `handTick` subject `ageMs` is REQUESTED frame time rather than
        // FX age, because the hit-stop withholds the two from each other on
        // purpose; the real FX age is read back per rung from `smokeClockMs`
        // (`fxAgeMs`), and the gap between the two columns is the freeze.
        const ladder = p.subject.ladderMs ?? SAMPLE_MS;
        // One rung per LAYER, not one per subject -- see `LayerFloor.toggleAtMs`.
        const rungFor = new Map<string, number>(LAYERS.map((l) => [l, toggleRungFor(l, ladder)]));
        const lastRung = Math.max(...rungFor.values());
        const probeOut: ProbeSample[] = [];
        let ageMs = trigger.ageMs;
        for (const ms of ladder) {
          if (ms > ageMs) {
            const samples = await advanceFrames(page, ms - ageMs, {
              probe: p.subject.probe === true && ms <= PROBE_WINDOW_MS,
              sinceMs: ageMs,
              fxBaseMs: trigger.fxBaseMs,
              viewBase,
            });
            probeOut.push(...samples);
            ageMs = ms;
          }
          const due = LAYERS.filter((l) => rungFor.get(l) === ms);
          if (togglesOnly) {
            if (due.length > 0) {
              const rect = await frameCrop(page, p.subject);
              await runLayerToggles(page, p.subject, due, label, out, rect, layerReadings, {
                REPAINT_SCRIPT,
                layerToggleScript,
                computeDiff,
              });
            }
            if (ms >= lastRung) break;
            continue;
          }
          const fxAgeMs = await readFxAge(page, trigger.fxBaseMs);
          const rect = await shoot(page, p.subject, ms, ageMs, fxAgeMs, label, out, cells);
          if (due.length > 0) {
            await runLayerToggles(page, p.subject, due, label, out, rect, layerReadings, {
              REPAINT_SCRIPT,
              layerToggleScript,
              computeDiff,
            });
          }
        }
        if (probeOut.length > 0) probes[p.subject.id] = probeOut;
      }
      await page.close();
    }

    writeIndex(out, label, cells, notes, layerReadings, probes, {
      gl,
      stepJumpMs: firstStepJumpMs,
      port,
      togglesOnly,
      settleMs,
    });
  } finally {
    await browser.close();
    stopDevServer(server, 'blast-captures');
  }

  // R-M, and the whole reason this task exists: a zero is a FAILURE. Reported
  // after the sheet is written, never instead of it -- a run that measured
  // something and then exited without recording it would be worse than one
  // that measured nothing.
  if (skipped.length > 0) {
    console.error(`\n${skipped.length} group(s) skipped as unmeasurable: ${skipped.join(', ')}`);
    process.exitCode = 1;
  }
  const failed = layerReadings.filter((r) => r.ok === false);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} layer reading(s) below their floor:\n` +
        failed.map((r) => `  ${r.subject} / ${r.layer}: ${r.note}`).join('\n')
    );
    process.exitCode = 1;
  }
}

interface Placed {
  subject: BlastSubject;
  /** The subject's own entity, for a `kill`. -1 for an `impact`, whose
   *  subject is a tile rather than a body. */
  entity: number;
  /** `impact` only: the tube. */
  shooter: number;
}

async function spawnSubjects(
  page: import('playwright').Page,
  wanted: readonly BlastSubject[]
): Promise<Placed[]> {
  return page.evaluate(
    // NOTHING in this body may be a NAMED function expression -- not even a
    // `const f = () => ...` helper. `tsx`/esbuild wraps those in its own
    // `__name()` keep-names helper, which exists in the tsx runtime and not
    // in the page, and the whole evaluate dies with a bare
    // `ReferenceError: __name is not defined` that names nothing this file
    // wrote. Measured here once, on exactly such a helper.
    ([rows, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const out: { subject: (typeof rows)[number]; entity: number; shooter: number }[] = [];
      for (const row of rows) {
        const typeId = row.typeId ?? row.id;
        const idx = L.sim.unitTypes.findIndex((t) => t.id === typeId);
        if (idx < 0) throw new Error(`no unit type "${typeId}" in this build`);
        if (row.mode === 'kill') {
          out.push({ subject: row, entity: L.sim.spawn(idx, 0, row.x * fixed, row.y * fixed), shooter: -1 });
        } else {
          const standoff = row.standoffTiles ?? 6;
          out.push({
            subject: row,
            entity: -1,
            shooter: L.sim.spawn(idx, 0, (row.x - standoff) * fixed, row.y * fixed),
          });
        }
      }
      return out;
    },
    [wanted, FIXED] as const
  );
}

/** Waits for every spawned body to hold a real mesh. A vehicle lands in
 *  `vehicleMeshEntities`; the mortar team is a rigged infantry rig and lands
 *  in `meshUnitEntities` with its clips bound. Steps ticks while it waits,
 *  which is safe precisely because no hostile is on the field yet. */
async function waitForMeshes(page: import('playwright').Page, placed: readonly Placed[], notes: string[]): Promise<void> {
  // `&nomesh` skips the GLB downloads entirely (CLAUDE.md, "Mesh units"), so
  // there is nothing to wait FOR -- waiting would spend the whole 300 s
  // deadline proving the flag works and then note a mesh that was never meant
  // to arrive.
  const meshy = placed.filter((p) => !(p.subject.flags ?? []).includes('nomesh'));
  if (meshy.length === 0) return;
  const want = meshy.map((p) => ({ id: p.entity >= 0 ? p.entity : p.shooter, vehicle: p.entity >= 0 }));
  const deadline = Date.now() + MESH_WAIT_MS;
  let first = true;
  for (;;) {
    const missing = await page.evaluate(
      ([rows, tick]) => {
        const L = (window as unknown as LionsWindow).__lions;
        if (tick) L.step(20);
        return rows
          .filter((r) => {
            if (r.vehicle) return !L.renderer.vehicleMeshEntities.has(r.id);
            const e = L.renderer.meshUnitEntities.get(r.id);
            return !e || e.actions.size === 0;
          })
          .map((r) => r.id);
      },
      [want, !first] as const
    );
    first = false;
    if (missing.length === 0) return;
    if (Date.now() > deadline) {
      notes.push(`entities ${missing.join(', ')} never got a mesh -- captured anyway`);
      return;
    }
    await page.waitForTimeout(400);
  }
}

interface Trigger {
  /** The FX age the ladder's rung zero actually carries. */
  ageMs: number;
  /** `smokeClockMs` at the instant of the trigger, so every rung's REAL FX age
   *  can be read back rather than accumulated -- see `handTick`. */
  fxBaseMs: number;
}

/**
 * Kills the vehicle.
 *
 * Two deliveries, and which one a subject takes is declared on the subject
 * (`handTick`), never inferred. Through `__lions.step(1)` the burst is already
 * `lastFrameMs` old on the frame it first draws AND the hit-stop has been
 * fully drained by that same frame (see `handTick`'s own doc comment for the
 * arithmetic). By hand -- `sim.tick()` + `renderer.snapshot()` +
 * `renderer.onEvents()`, which is `main.ts`'s `runTick` minus its audio and
 * mission calls -- no frame is presented at all, so rung zero is a true zero
 * and the freeze is still on the clock.
 */
async function triggerKill(page: import('playwright').Page, p: Placed, stepJumpMs: number): Promise<Trigger> {
  const hand = p.subject.handTick === true;
  const fxBaseMs = await page.evaluate(
    ([e, byHand]) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.sim.debugKill(e);
      if (byHand) {
        const events = L.sim.tick();
        L.renderer.snapshot();
        L.renderer.onEvents(events);
        return L.renderer.smokeClockMs;
      }
      const before = L.renderer.smokeClockMs;
      L.step(1);
      return before;
    },
    [p.entity, hand] as const
  );
  return { ageMs: hand ? 0 : stepJumpMs, fxBaseMs };
}

/**
 * Puts a real exchange of fire beside the subject before it is killed, so the
 * blast's own light lands in a `FlashLightManager` pool that is already
 * contending.
 *
 * **Vehicles, not infantry, and that is a measurement rather than a
 * preference.** `data/vfx/fire_small_arms.json` declares no `light` block at
 * all, so a rifle contributes NOTHING to the pool -- a first staging of three
 * `inf_squad` against three `militia_cell` produced a measured `liveCount` of
 * **0** at the instant of the kill. `ifv_namer`'s autocannon
 * (`fire_autocannon`, 90 ms) and `technical`'s HMG (`fire_hmg`, 70 ms) both
 * do. Every type here is in `SANDBOX_KDF`/`SANDBOX_ENEMY`, so their templates
 * are already resolved by the sandbox's own roster-driven mesh plan.
 *
 * **The warm-up is hand-ticked, with no frame presented at all**, for the same
 * arithmetic that makes the hit-stop unphotographable through `step(1)`: each
 * `step(1)` presents a frame worth ~92 ms of FX time, and every flash in
 * `data/vfx/` decays in 70-170 ms, so a warm-up driven that way retires each
 * flash on the very frame after it spawns and can never fill an 8-slot pool.
 * Ticking without presenting lets the flashes accumulate exactly as they do in
 * a real 60 fps fight, where ten ticks span 500 ms of frames rather than nine
 * seconds of them.
 */
async function stageFirefight(page: import('playwright').Page, p: Placed, notes: string[]): Promise<void> {
  const result = await page.evaluate(
    ([x, y, pairs, gap, ticks, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const friend = L.sim.unitTypes.findIndex((t) => t.id === 'ifv_namer');
      const foe = L.sim.unitTypes.findIndex((t) => t.id === 'technical');
      if (friend < 0 || foe < 0) throw new Error('ifv_namer/technical missing from this build');
      for (let i = 0; i < pairs; i++) {
        L.sim.spawn(friend, 0, (x - 1) * fixed, (y + 2 + i) * fixed);
        L.sim.spawn(foe, 1, (x - 1 + gap) * fixed, (y + 2 + i) * fixed);
      }
      let peak = 0;
      for (let i = 0; i < ticks; i++) {
        const events = L.sim.tick();
        L.renderer.snapshot();
        L.renderer.onEvents(events);
        if (L.renderer.flashLights.liveCount > peak) peak = L.renderer.flashLights.liveCount;
      }
      // One zero-time frame so the new bodies attach their meshes before the
      // ladder photographs them. Presents nothing and ages nothing.
      L.renderer.frame(1, 0);
      return { flashLive: L.renderer.flashLights.liveCount, peak };
    },
    [p.subject.x, p.subject.y, FIREFIGHT_PAIRS, FIREFIGHT_GAP_TILES, FIREFIGHT_WARMUP_TICKS, FIXED] as const
  );
  console.log(
    `  firefight staged: ${result.flashLive} live flash(es) in the pool at the kill (peak ${result.peak})`
  );
  notes.push(
    `${p.subject.id}: ${result.flashLive} of the 8 flash-pool slots were live at the instant of the kill, ` +
      `peak ${result.peak} during the warm-up (${FIREFIGHT_PAIRS} ifv_namer vs ${FIREFIGHT_PAIRS} technical, ` +
      `${FIREFIGHT_WARMUP_TICKS} hand ticks with no frame presented)`
  );
}

/**
 * Drives the tube to fire for real and returns on the frame the bomb lands.
 *
 * Three stages, and the split matters. Ticking is what gets the round into
 * the air (a `fire` event is a sim event), but each `__lions.step(1)` also
 * paints one frame, so ticking through the whole flight would burn the arc
 * at `lastFrameMs` a tick. So: tick until the shell exists, take the bait
 * off the field, then pump FRAME_MS frames only -- no further ticks -- until
 * `updateFx`'s own `shellHasLanded` drops it, which is the frame
 * `spawnShellImpactFx` runs on. The burst is spawned AFTER the managers step
 * in that same call, so rung zero is a true zero here.
 */
async function triggerImpact(
  page: import('playwright').Page,
  p: Placed,
  notes: string[]
): Promise<Trigger | null> {
  const fired = await page.evaluate(
    ([shooter, baitId, bx, by, fixed, cap]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const idx = L.sim.unitTypes.findIndex((t) => t.id === baitId);
      if (idx < 0) throw new Error(`no unit type "${baitId}" in this build`);
      const bait = L.sim.spawn(idx, 1, bx * fixed, by * fixed);
      let ticks = 0;
      while (L.renderer.shells.length === 0 && ticks < cap) {
        L.step(1);
        ticks++;
      }
      const shell = L.renderer.shells[0];
      // Off the field, not killed: `removeFromPlay` emits `removed`, which
      // the renderer draws as neither a death clip nor a wreck -- so the
      // bomb lands on empty ground, which is what the sheet is about.
      L.sim.removeFromPlay(bait);
      return {
        ticks,
        shooterAlive: L.sim.state.alive[shooter] === 1,
        shell: shell === undefined ? null : { kind: shell.kind, tx: shell.tx, ty: shell.ty, duration: shell.duration },
      };
    },
    [p.shooter, p.subject.baitId ?? 'digger_crew', p.subject.x, p.subject.y, FIXED, FIRE_TICK_CAP] as const
  );
  if (fired.shell === null) {
    notes.push(
      `${p.subject.id} (impact): no round left the tube in ${FIRE_TICK_CAP} ticks ` +
        `(tube alive: ${fired.shooterAlive}) -- subject skipped`
    );
    return null;
  }
  console.log(
    `  ${p.subject.id}: a ${fired.shell.kind} is up after ${fired.ticks} ticks, ` +
      `impacting [${fired.shell.tx.toFixed(2)}, ${fired.shell.ty.toFixed(2)}] in ${fired.shell.duration.toFixed(2)} s`
  );
  const landed = await page.evaluate(
    ([step, cap]) => {
      const L = (window as unknown as LionsWindow).__lions;
      let frames = 0;
      while (L.renderer.shells.length > 0 && frames < cap) {
        L.renderer.frame(1, step);
        frames++;
      }
      return { frames, stillUp: L.renderer.shells.length, fx: L.renderer.smokeClockMs };
    },
    [FRAME_MS, FLIGHT_FRAME_CAP] as const
  );
  if (landed.stillUp > 0) {
    notes.push(`${p.subject.id} (impact): the round was still in the air after ${FLIGHT_FRAME_CAP} frames -- subject skipped`);
    return null;
  }
  console.log(`  ${p.subject.id}: landed after ${landed.frames} pumped frames (${landed.frames * FRAME_MS} ms of flight)`);
  return { ageMs: 0, fxBaseMs: landed.fx };
}

/**
 * Advances the renderer's own frame clock by `ms`, in FRAME_MS steps with an
 * exact remainder, so the accumulated age lands on the rung and not near it.
 *
 * With `probe`, every pumped frame is then READ rather than recomputed: the
 * hit-stop's own remaining time, the FX clock it may or may not have let
 * through, the flash pool, and the shake's screen-pixel offset at both ends of
 * `main.ts`'s 0.35-2.5 zoom clamp.
 *
 * The zoom sweep is two extra `frame(1, 0)` calls per probed frame. Zero
 * elapsed time, so no clock moves and the sweep cannot contaminate what the
 * next rung photographs -- the same property the toggle A/B's own repaint
 * relies on. It costs two full SwiftShader renders a frame, which is why the
 * probe is declared per subject rather than run on all of them.
 *
 * The offset is measured through the renderer's OWN projection, never
 * re-derived: `threeCamera()` writes the shaken camera into `viewCamera`, and
 * `updateDimetricCamera` sets `position = (cam.x, 0, cam.y) + VIEW_DIRECTION *
 * CAMERA_DISTANCE` -- both terms constant -- so the difference between that
 * position and the same expression for the UNSHAKEN camera is exactly the
 * world-space shake. Projecting that world delta back through `worldToScreen`
 * (which reads the unshaken `this.camera` and so never shakes) turns it into
 * the screen pixels `amplitude_px` is authored in.
 */
async function advanceFrames(
  page: import('playwright').Page,
  ms: number,
  opts: { probe: boolean; sinceMs: number; fxBaseMs: number; viewBase: readonly [number, number] }
): Promise<ProbeSample[]> {
  return page.evaluate(
    ([total, step, probe, sinceMs, fxBaseMs, radiusFloor, zoomHi, zoomLo, baseX, baseZ]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const r = L.renderer;
      const out: {
        requestedMs: number;
        fxAgeMs: number;
        hitStopMs: number;
        px2p5: { dx: number; dy: number };
        px0p35: { dx: number; dy: number };
        flashLive: number;
        blastLightAlive: boolean;
      }[] = [];
      for (let done = 0; done < total; done += step) {
        const dt = Math.min(step, total - done);
        r.frame(1, dt);
        if (!probe) continue;
        const cam = r.camera;
        const held = cam.zoom;
        const shot: { dx: number; dy: number }[] = [];
        // NO NAMED FUNCTION EXPRESSIONS IN A page.evaluate BODY -- see
        // `spawnSubjects`. Hence the loop rather than a `readAt(zoom)` helper.
        for (const z of [zoomHi, zoomLo]) {
          cam.zoom = z;
          r.frame(1, 0);
          const p = r.viewCamera.position;
          // `baseX`/`baseZ` are `VIEW_DIRECTION * CAMERA_DISTANCE`, read once
          // at boot off a frame with no shake live. Whatever is left after
          // subtracting them and the tile-space camera IS the shake.
          const wdx = p.x - cam.x - baseX;
          const wdy = p.z - cam.y - baseZ;
          const s0 = r.worldToScreen(cam.x, cam.y);
          const s1 = r.worldToScreen(cam.x + wdx, cam.y + wdy);
          shot.push({ dx: s1.x - s0.x, dy: s1.y - s0.y });
        }
        cam.zoom = held;
        r.frame(1, 0);
        let blastAlive = false;
        for (const a of r.flashLights.active) if (a.radius >= radiusFloor) blastAlive = true;
        out.push({
          requestedMs: sinceMs + done + dt,
          fxAgeMs: r.smokeClockMs - fxBaseMs,
          hitStopMs: r.hitStop.remainingMs,
          px2p5: shot[0],
          px0p35: shot[1],
          flashLive: r.flashLights.liveCount,
          blastLightAlive: blastAlive,
        });
      }
      return out;
    },
    [
      ms,
      FRAME_MS,
      opts.probe,
      opts.sinceMs,
      opts.fxBaseMs,
      BLAST_LIGHT_RADIUS_FLOOR,
      LADDER_ZOOM,
      MIN_ZOOM,
      opts.viewBase[0],
      opts.viewBase[1],
    ] as const
  );
}

/** The FX age a rung really carries: `smokeClockMs` accumulates exactly the
 *  RAW `dtMs` the burst managers are handed, and a hit-stop withholds that
 *  delta from both at once -- so this is the one honest answer to "how old is
 *  this fireball", and the gap between it and the requested time IS the
 *  freeze. */
async function readFxAge(page: import('playwright').Page, fxBaseMs: number): Promise<number> {
  const now = await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.smokeClockMs);
  return Math.round((now - fxBaseMs) * 100) / 100;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frames the camera on a world tile at `zoom`, repaints at ZERO elapsed time
 *  so no clock moves, and reports where the tile landed on screen. */
async function frameAt(
  page: import('playwright').Page,
  wx: number,
  wy: number,
  zoom: number
): Promise<{ screenX: number; screenY: number; tick: number }> {
  return page.evaluate(
    ([x, y, z]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const c = L.renderer.camera;
      c.x = x;
      c.y = y;
      c.zoom = z;
      L.renderer.frame(1, 0);
      const screen = L.renderer.worldToScreen(x, y);
      return { screenX: screen.x, screenY: screen.y, tick: L.sim.tickCount };
    },
    [wx, wy, zoom] as const
  );
}

/** One rung: the establishing still at rung zero, then the cropped ladder
 *  frame. Returns the ladder crop's rect, which the toggle A/B re-photographs
 *  through. */
async function shoot(
  page: import('playwright').Page,
  subject: BlastSubject,
  ms: number,
  ageMs: number,
  fxAgeMs: number,
  label: string,
  out: string,
  cells: SheetCell[]
): Promise<Rect> {
  const push = (zoom: number, file: string, tick: number): void => {
    const cell: SheetCell = { subject: subject.id, mode: subject.mode, ms, zoom, tick, file, fxAgeMs };
    if (Math.abs(ageMs - ms) > 0.5) cell.ageMs = Math.round(ageMs * 100) / 100;
    cells.push(cell);
  };
  if (ms === 0) {
    const est = await frameAt(page, subject.x, subject.y, ESTABLISH_ZOOM);
    const file = `${subject.id}-${subject.mode}-establish-${label}-z${ESTABLISH_ZOOM}.png`;
    await page.screenshot({ path: path.join(out, file) });
    push(ESTABLISH_ZOOM, file, est.tick);
    console.log(`  saved ${file}`);
  }
  const state = await frameAt(page, subject.x, subject.y, LADDER_ZOOM);
  const rect: Rect = {
    x: Math.min(Math.max(0, state.screenX - CLOSE_CROP.width / 2), VIEWPORT.width - CLOSE_CROP.width),
    y: Math.min(
      Math.max(0, state.screenY - CLOSE_CROP.height / 2 - CLOSE_CROP_LIFT_PX),
      VIEWPORT.height - CLOSE_CROP.height
    ),
    w: CLOSE_CROP.width,
    h: CLOSE_CROP.height,
  };
  const file = `${subject.id}-${subject.mode}-${String(ms).padStart(5, '0')}ms-${label}-z${LADDER_ZOOM}.png`;
  await page.screenshot({
    path: path.join(out, file),
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  });
  push(LADDER_ZOOM, file, state.tick);
  return rect;
}

/** `shoot`'s framing half, with no photograph: what `--toggles-only` needs to
 *  put the camera exactly where the ladder would have had it before the toggle
 *  A/B runs. Zero elapsed time, so it moves no clock -- the frame the toggles
 *  are taken on is the same frame either way. */
async function frameCrop(page: import('playwright').Page, subject: BlastSubject): Promise<Rect> {
  const state = await frameAt(page, subject.x, subject.y, LADDER_ZOOM);
  return {
    x: Math.min(Math.max(0, state.screenX - CLOSE_CROP.width / 2), VIEWPORT.width - CLOSE_CROP.width),
    y: Math.min(
      Math.max(0, state.screenY - CLOSE_CROP.height / 2 - CLOSE_CROP_LIFT_PX),
      VIEWPORT.height - CLOSE_CROP.height
    ),
    w: CLOSE_CROP.width,
    h: CLOSE_CROP.height,
  };
}

/**
 * R-M: the reference-free half. Hide the layer, repaint at ZERO elapsed
 * presentation time so every clock reads the same, capture, compare. It
 * never asks what the frame looks like -- only whether removing the layer
 * changes it -- which is why it can vote on a runner with no blessed
 * baseline.
 *
 * The control comes first, for the reason `three-baseline-gate.ts` makes it
 * a gated check of its own: if a zero-time repaint moves pixels, the scene
 * is drifting between photographs and every delta below is measuring the
 * drift too.
 */
async function runLayerToggles(
  page: import('playwright').Page,
  subject: BlastSubject,
  layers: readonly string[],
  label: string,
  out: string,
  rect: Rect,
  readings: LayerReading[],
  api: {
    REPAINT_SCRIPT: string;
    layerToggleScript: (layer: string, visible: boolean) => string;
    computeDiff: (
      a: string,
      b: string,
      opts?: { outDir?: string; threshold?: number; diffFileName?: string }
    ) => { diffPixels: number; meanAbsChannelDelta: number };
  }
): Promise<void> {
  const dir = path.join(out, 'toggles');
  fs.mkdirSync(dir, { recursive: true });
  const clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
  // Named per LAYER GROUP, because the two layers are now photographed at
  // different rungs and one `-shown-` file would be overwritten by the second.
  const tag = layers.join('+');
  const shown = path.join(dir, `${subject.id}-${tag}-shown-${label}.png`);
  await page.evaluate(api.REPAINT_SCRIPT);
  await page.screenshot({ path: shown, clip });
  for (const layer of layers) {
    const hidden = path.join(dir, `${subject.id}-${layer}-hidden-${label}.png`);
    try {
      await page.evaluate(api.layerToggleScript(layer, false));
      await page.screenshot({ path: hidden, clip });
      await page.evaluate(api.layerToggleScript(layer, true));
      const d = api.computeDiff(shown, hidden, { outDir: dir, diffFileName: `${subject.id}-${layer}-diff.png` });
      const verdict = layerVerdict(layer, d);
      const voted = subjectVotesOn(subject, layer);
      const ok = readingAccepted(voted, verdict.ok);
      readings.push({
        subject: subject.id,
        layer,
        available: true,
        diffPixels: d.diffPixels,
        meanAbsChannelDelta: d.meanAbsChannelDelta,
        over: verdict.ok,
        voted,
        ok,
        note: !voted
          ? verdict.ok
            ? 'ABSTAINS but clears its floor -- delete the exemption on this subject'
            : `abstains (recorded, not voting): ${verdict.reasons.join('; ')}`
          : verdict.ok
            ? 'hidden, repainted at zero elapsed time, compared -- over floor'
            : `BELOW FLOOR: ${verdict.reasons.join('; ')}`,
      });
      console.log(
        `  toggle "${layer}" on ${subject.id}: ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)}` +
          ` -- ${voted ? '' : 'abstain, '}${ok ? 'PASS' : `FAIL (${verdict.reasons.join('; ') || 'clears its floor'})`}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      readings.push({
        subject: subject.id,
        layer,
        available: false,
        diffPixels: 0,
        meanAbsChannelDelta: 0,
        over: false,
        voted: subjectVotesOn(subject, layer),
        // A FAILURE, not a note. This is exactly what the before-set reported
        // six times over, and it was the right reading THEN because neither
        // layer existed yet; a name in `LAYER_FLOORS` that the renderer can no
        // longer resolve is now the most serious thing this harness can find,
        // and reporting it as an absence the way the before-set did would
        // reintroduce the silence the floors exist to break.
        ok: false,
        note: `layer absent: ${message.split('\n')[0]}`,
      });
      console.log(`  toggle "${layer}" on ${subject.id}: not available -- ${message.split('\n')[0]}`);
    }
  }
}

function writeIndex(
  out: string,
  label: string,
  cells: readonly SheetCell[],
  notes: readonly string[],
  layers: readonly LayerReading[],
  probes: Readonly<Record<string, readonly ProbeSample[]>>,
  conditions: { gl: string; stepJumpMs: number; port: number; togglesOnly: boolean; settleMs: number }
): void {
  const machine = `${process.platform}-${process.arch}, node ${process.version}`;
  const condLines = [
    ``,
    `## Capture conditions`,
    ``,
    `Every number in this sheet was taken under exactly these, and none of them is a default`,
    `left unexamined -- a first golden-diff run once read 6.5x high purely from screenshot`,
    `downscaling and a font-load race.`,
    ``,
    `- machine: ${machine}`,
    `- GL backend: ${mdSafe(conditions.gl)}`,
    `- viewport: ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 1, headless chromium`,
    `- map: \`beit_sahwan_outskirts\` sandbox, \`&renderer=three\`, dev server on :${conditions.port}`,
    `- zooms: ${ESTABLISH_ZOOM} establishing still (full frame), ${LADDER_ZOOM} ladder`,
    `  (${CLOSE_CROP.width}x${CLOSE_CROP.height} crop, lifted ${CLOSE_CROP_LIFT_PX} px)`,
    `- frame loop: frozen (FREEZE_FRAME_LOOP_SCRIPT); every ladder frame pumped by hand at ${FRAME_MS} ms`,
    `- \`step(1)\` frame jump: ${conditions.stepJumpMs.toFixed(2)} ms, measured at boot (see the module header)`,
    `- settle before the freeze: until ${SETTLE_STEADY_FRAMES} consecutive frames <= ` +
      `${SETTLE_STEADY_MAX_FRAME_MS} ms at ${SETTLE_VIEWPORT.width}x${SETTLE_VIEWPORT.height}, ceiling ` +
      `${conditions.settleMs} ms` +
      (conditions.settleMs === SETTLE_TIMEOUT_MS ? ' (the default)' : ` (\`--settle-ms\`; the default is ${SETTLE_TIMEOUT_MS})`) +
      ' -- per-group frames in the notes',
    `- mode: ${conditions.togglesOnly ? '`--toggles-only` (calibration: no ladder photographed)' : 'full ladder'}`,
  ];
  const layerLines = [
    ``,
    `## Layer toggles (R-M)`,
    ``,
    `A zero is a FAILURE here, not a note: a layer that resolves to no objects`,
    `produces a zero delta, and a check that passed on zero would read a deleted`,
    `layer as a healthy one. Floors are a third of the measured signal.`,
    ``,
    `| subject | layer | available | votes | verdict | diff px | mean abs channel delta | note |`,
    `|---|---|---|---|---|---|---|---|`,
    ...layers.map(
      (l) =>
        `| \`${l.subject}\` | \`${l.layer}\` | ${l.available ? 'yes' : 'no'} | ` +
        `${l.voted ? 'yes' : 'abstains'} | ${l.ok ? 'PASS' : 'FAIL'} | ` +
        `${l.diffPixels} | ${l.meanAbsChannelDelta.toFixed(4)} | ${l.note} |`
    ),
    ``,
    `Floors in force:`,
    ``,
    ...Object.entries(LAYER_FLOORS).map(([layer, f]) => floorLine(layer, f)),
  ];
  const probeLines =
    Object.keys(probes).length === 0
      ? []
      : [
          ``,
          `## Per-frame probe`,
          ``,
          `Read off the renderer after each pumped frame, never recomputed. \`requested\` is`,
          `wall-clock frame time since the trigger and \`FX age\` is what the clock actually`,
          `took: the gap between them IS the hit-stop. The two pixel columns are the shake's`,
          `own screen offset at both ends of the 0.35-2.5 zoom clamp, measured through the`,
          `renderer's own projection -- they are supposed to AGREE.`,
          ...Object.entries(probes).flatMap(([subject, samples]) => [
            ``,
            `### \`${subject}\``,
            ``,
            `| requested (ms) | FX age (ms) | hit-stop left (ms) | shake px @2.5 | shake px @0.35 | flashes live | blast light |`,
            `|---|---|---|---|---|---|---|`,
            ...samples.map(
              (s) =>
                `| ${s.requestedMs} | ${s.fxAgeMs.toFixed(1)} | ${s.hitStopMs.toFixed(1)} | ` +
                `${Math.hypot(s.px2p5.dx, s.px2p5.dy).toFixed(3)} | ` +
                `${Math.hypot(s.px0p35.dx, s.px0p35.dy).toFixed(3)} | ${s.flashLive} | ` +
                `${s.blastLightAlive ? 'yes' : 'no'} |`
            ),
          ]),
        ];
  const noteLines = notes.length > 0 ? [``, `## Notes`, ``, ...notes.map((n) => `- ${n}`)] : [];
  const md =
    sheetIndex(label, cells) + [...condLines, ...layerLines, ...probeLines, ...noteLines].join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'sheet.md'), md);
  fs.writeFileSync(
    path.join(out, 'sheet.json'),
    JSON.stringify(
      {
        label,
        conditions: {
          machine,
          gl: conditions.gl,
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          map: DEFAULT_MAP,
          maps: [...new Set(BLAST_SUBJECTS.map((s) => s.map ?? DEFAULT_MAP))],
          renderer: 'three',
          port: conditions.port,
          establishZoom: ESTABLISH_ZOOM,
          ladderZoom: LADDER_ZOOM,
          minZoom: MIN_ZOOM,
          crop: CLOSE_CROP,
          frameMs: FRAME_MS,
          stepJumpMs: conditions.stepJumpMs,
          togglesOnly: conditions.togglesOnly,
          settleTimeoutMs: conditions.settleMs,
          settleSteadyFrames: SETTLE_STEADY_FRAMES,
          settleSteadyMaxFrameMs: SETTLE_STEADY_MAX_FRAME_MS,
          sampleMs: SAMPLE_MS,
        },
        subjects: BLAST_SUBJECTS,
        floors: LAYER_FLOORS,
        cells,
        layers,
        probes,
        notes,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`index at ${path.join(out, 'sheet.md')} (${cells.length} frames)`);
}

/** Keeps a driver string that may contain a pipe out of a markdown table.
 *  `readUnmaskedRenderer` really does return one: "ANGLE (Google, Vulkan
 *  1.3.0 (SwiftShader Device ...))". */
function mdSafe(s: string): string {
  return s.replace(/\|/g, '/');
}

// Only when run as a script. The spec imports this module for its pure half,
// and a module that boots a browser on import would make `pnpm test` start a
// dev server.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    // `process.exitCode`, not a hard 0. A run whose toggle readings fell below
    // their floors has already set it, and forcing 0 here would have made the
    // whole R-M half of this harness a green-ticking no-op -- the exact shape
    // `visual-baseline-bless`'s `git diff --quiet` guard had.
    () => process.exit(process.exitCode ?? 0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    }
  );
}
