// The capture half of the golden-image diff harness. Unlike diff.ts, this
// half CANNOT run as a plain Node script -- exactly the constraint
// `2026-08-26-three-renderer-design.md`'s Testing section amendment states
// for anything touching a real `ThreeRenderer`: it constructs a real
// `WebGLRenderer` in its constructor and needs real WebGL2, which neither
// `node` nor `jsdom` provide. `tools/src/perf/three-units.ts` hit the same
// wall and answers it the same way this file does: run inside a real
// browser tab pointed at the app's own Vite dev server, not a synthetic DOM.
//
// This file is NOT a script you execute -- `pixiUrl`/`threeUrl`/`captureScript`
// build what a browser-driving caller needs, so the browser-driving half (a
// human in devtools, or an agent with browser automation tools, or
// `tools/src/ci/golden-diff-gate.ts` driving Playwright) has one source of
// truth for "what counts as an identical scenario" rather than several
// copies that can drift. Read this file top to bottom before capturing; the
// protocol below is what was actually run to produce
// `.superpowers/d-golden-diff-report.md`'s numbers, generalised afterward
// (Phase D item #20/#8) to more than the one scenario it started with.
//
// ============================================================================
// Scenarios
// ============================================================================
//
// A `Scenario` is everything needed to put both backends into an identical,
// comparable state: which map, where the camera looks, how far to
// fast-forward the sim, and (optionally) a camera zoom. Each scenario is its
// own gate in `golden-diff-gate.ts`, with its own budget -- see that file's
// top comment for why a single global threshold across scenes with
// genuinely different content is the wrong instrument.
//
// `QUIET_SCENARIO` is the original, and the only one measured by a real
// GPU-accelerated Chrome by hand (`.superpowers/d-golden-diff-report.md`):
// a static, order-free sandbox scan with no vehicle, no combat, no open
// ground at zoom. It stayed the CI default while it was the only scenario
// that existed; it is NOT representative of the whole game -- see
// `.superpowers/d-readiness-audit.md` item "The 0.143% scene has exactly one
// unit in frame."
//
// `OPEN_GROUND_SCENARIO` closes the gap the quiet scenario cannot see by
// construction: it never frames open ground at zoom, which is exactly where
// `.superpowers/d-scatter-report.md` found three's dominant stone-grain mark
// silently invisible on 4 of 5 shipped maps. Parameters below (map, marker,
// ticks, zoom) match that report's own manual walk exactly, since that walk
// already proved out where the defect is visible and confirmed a real
// `pnpm dev` capture at those settings shows it -- re-deriving different
// parameters from scratch would only risk missing the framing that is known
// to work.
//
// ============================================================================
// Protocol
// ============================================================================
//
// 1. Have a Vite dev server for THIS worktree running (check with `lsof` or
//    similar that its cwd is this checkout -- CLAUDE.md's hard constraint:
//    never kill someone else's `pnpm dev`, never assume port 5173 is yours).
//    If none is running, start your own on a different port
//    (`pnpm --filter @lions/app dev` with `PORT=<port>` set -- vite.config.ts
//    reads `PORT`, defaulting to 5173).
//
// 2. Open ONE browser tab (real Chrome, via any automation surface that can
//    navigate, eval JS, and screenshot a CSS-pixel region -- e.g.
//    claude-in-chrome's `navigate` / `javascript_tool` / `computer{zoom}`, or
//    Playwright as `golden-diff-gate.ts` does). Resize its window ONCE to a
//    fixed size and reuse the SAME tab/window for both captures of a given
//    scenario, so window chrome and any DPR quirks cancel out identically.
//    Record whatever canvas rect you actually get; do not assume a number.
//
// 3. For EACH backend (pixi first, then three), in the SAME tab:
//    a. navigate to that backend's URL for the scenario (see
//       `pixiUrl`/`threeUrl` below)
//    b. wait for boot (~2-3s is enough on a warm dev-server cache; poll
//       `typeof window.__lions !== 'undefined'` if you want a real gate
//       rather than a fixed sleep)
//    c. run `captureScript(scenario)` and keep its returned
//       `{camera, rect}` -- diff it against the OTHER backend's returned
//       value before trusting the screenshots. They must match exactly (a
//       mismatch means the two captures are not comparable at all --
//       different framing, not a rendering difference).
//    d. screenshot exactly `rect` (not the whole viewport -- HUD chrome
//       outside the canvas is identical DOM/CSS on both backends and only
//       adds noise) and save it to disk.
//
// 4. Run `diff.ts` on the two saved PNGs.
//
// Why a real compositor screenshot, not `canvas.toDataURL()`/`readPixels`:
// CLAUDE.md is explicit that `preserveDrawingBuffer` stays OFF in shipping
// ThreeRenderer code and this harness must not touch the renderer to make
// itself easier to measure (task's hard constraint). A JS-side canvas
// readback taken any time after the triggering `frame()` call returns is
// therefore unreliable by design -- CLAUDE.md calls the black readback
// "correct, not a broken renderer". A real screenshot (OS/CDP-level
// compositor capture) sidesteps this entirely: it captures what the
// browser actually painted, the same bytes a player sees, regardless of
// `preserveDrawingBuffer`. This is also why `three-units.ts`'s browser mode
// never attempts a screenshot at all -- it only times, never captures --
// and why this harness had to add its own capture step rather than reuse
// one.
//
// A note on rAF and backgrounded tabs (a documented trap, paid for once):
// `captureScript` never relies on `requestAnimationFrame` firing -- `step(n)`
// calls `renderer.frame(...)` directly, synchronously, so the frame it draws
// is current even if the tab is backgrounded and rAF is throttled. Do not
// add a "wait a frame" step that depends on rAF between `step()` and the
// screenshot; it is unnecessary and, in a backgrounded tab, can silently
// read stale state instead.
//
// ============================================================================

export interface Scenario {
  /** Short, stable id -- used as a directory/file-name fragment by callers, so
   *  keep it filesystem-safe (lowercase, hyphens). */
  id: string;
  /** One line: what this scenario frames and why it exists. */
  description: string;
  /** Exactly one of `sandboxMap`/`mission` must be set -- `captureScript`
   *  and `pixiUrl`/`threeUrl` throw if neither is, or both are. A `mission`
   *  scenario gates behind the loading screen's deploy click (see `orders`'
   *  own comment and `capture()` in `golden-diff-gate.ts`), which a
   *  `sandboxMap` scenario never does (`main.ts`'s `showLoading` only holds
   *  deployment for a mission's own briefing -- `briefingHoldsDeployment`,
   *  `ui/loading.ts` -- and the sandbox passes no briefing at all). */
  sandboxMap?: string;
  /** A mission id (`data/missions/<id>.json`), in place of `sandboxMap`. The
   *  only way to get a REAL hostile side and real combat in frame: the
   *  sandbox force is friendly-only (`SANDBOX_KDF`/`SANDBOX_ENEMY` place an
   *  opposition too, but it never receives orders and the sandbox force
   *  never receives an attack order either -- see `QUIET_SCENARIO`'s own
   *  comment, "has not left its assembly point"). Pair with `orders` to make
   *  anything actually happen. */
  mission?: string;
  /** A named marker on the map, OR omit this and set `cameraTile` instead --
   *  see that field for why a scenario would need the latter. */
  cameraMarker?: string;
  /** World tile coordinates, passed to `__lions.goto(x, y)` directly instead
   *  of a marker name. Exists because the sandbox force's own placement
   *  (`SANDBOX_KDF`, `main.ts`) is offsets from an anchor marker, not a
   *  marker itself -- there is no named marker sitting on `mbt_lavi`'s own
   *  tile to frame a vehicle-dense shot with `cameraMarker`. Exactly one of
   *  `cameraMarker`/`cameraTile` must be set; `captureScript` throws if
   *  neither is. */
  cameraTile?: [number, number];
  /** Sim ticks to fast-forward before capturing, via `__lions.step(n)`. Used
   *  as a RELATIVE advance unless `targetTick` is also set -- see that
   *  field's own comment for why a scenario with moving/animated content in
   *  frame wants the absolute form instead. */
  ticks: number;
  /** Absolute sim tick to align to before capturing, INSTEAD OF a relative
   *  `step(ticks)`. When set, the capture script reads
   *  `window.__lions.sim.tickCount` and steps exactly `targetTick - current`
   *  (clamped to >= 0) rather than blindly stepping `ticks` more.
   *
   *  Why this exists, and why `QUIET_SCENARIO`/`OPEN_GROUND_SCENARIO` do NOT
   *  use it: the app's own rAF accumulator (`main.ts`'s `loop`) starts
   *  ticking in real time the instant `window.__lions` is assigned, and
   *  `capture-protocol.ts`'s own documented settle (`document.fonts.ready`
   *  + a 1s wait, BEFORE `captureScript` runs) gives that accumulator up to
   *  ~1s of real wall-clock time to accrue ticks from, non-deterministically,
   *  before a relative `step(ticks)` even runs -- Playwright does not
   *  throttle a headless page's rAF the way a backgrounded real Chrome tab
   *  does (`.superpowers/d-combat-diff-report.md`'s own capture protocol
   *  needed that throttling trick specifically to hold `tickCount` at 0
   *  through an equivalent boot sequence). `QUIET_SCENARIO`/`OPEN_GROUND_SCENARIO`
   *  are unaffected because their content is drift-insensitive by
   *  construction (a static, order-free force; terrain built once at map
   *  load) -- extra background ticks move nothing either scenario's own crop
   *  can see. A scenario that puts a VEHICLE in frame is not
   *  drift-insensitive: idle turret sweep, ambient dust/exhaust and walk-
   *  cycle phase all read the absolute tick, so the same relative `ticks`
   *  value could land the two backends' captures (booted in two separate
   *  `page.goto` navigations, each accruing its own independent real-time
   *  drift) on two DIFFERENT absolute ticks -- a false diff with no
   *  rendering bug behind it. `targetTick` removes the non-determinism by
   *  aligning both captures to the same absolute tick regardless of how much
   *  (different) drift each one accrued getting there -- the same fix
   *  `.superpowers/d-ground-clip-report.md`'s own vehicle-dense measurement
   *  applied by hand ("both backends explicitly aligned to sim tick 140").
   */
  targetTick?: number;
  /** Real combat, injected deterministically. Only meaningful with `mission`
   *  set (a sandbox force never fights -- see `mission`'s own comment).
   *
   *  `atTick`: aligned to FIRST (via the exact `step(atTick - tickCount)`
   *  mechanism `targetTick` uses), so every queued command lands at the
   *  identical absolute sim tick regardless of how much boot/deploy-click
   *  wall-clock drift either backend's own `page.goto` navigation happened
   *  to accrue before `window.__lions` existed -- the thing that made
   *  `.superpowers/d-combat-diff-report.md`'s equivalent protocol expensive
   *  (a backgrounded-tab click trick, four figures for `sim.queueCommand`'s
   *  `fx.from` equivalent, cross-tab atomicity traps). Queuing at a
   *  guaranteed-identical tick sidesteps essentially all of that: a `Command`
   *  (`@lions/sim`) has no timestamp of its own, only an order of arrival in
   *  `commandQueue`, so "queued at the same tick" is sufficient for the two
   *  backends' sims to diverge by nothing thereafter, given `step()` calls
   *  `runTick()` synchronously rather than through rAF (this file's own top
   *  comment). Verified empirically before this scenario was written: two
   *  independent Playwright pages (pixi, three), orders queued at tick 20,
   *  stepped to tick 600, reported IDENTICAL living-unit counts on both
   *  sides (9 friendly / 8 hostile, from 11 and 12) -- real combat, real
   *  kills, zero divergence.
   *
   *  `commands`: raw JS statements (not JSON), each expected to call
   *  `window.__lions.sim.queueCommand(...)` -- a raw statement rather than a
   *  `Command[]` this file constructs, because `Command` (`@lions/sim`) is
   *  Q16.16 fixed-point (invariant 2) and this file may not import `@lions/sim`
   *  (`packages/render`'s own layering rule extends to tools built against
   *  it) to reach the real `fx.from` -- the injected script hand-rolls the
   *  encoding (`Math.round(n * 65536)`) the same way
   *  `.superpowers/d-combat-diff-report.md`'s console commands did. */
  orders?: { atTick: number; commands: string[] };
  /** Camera zoom to set after `goto()`, before stepping. `goto()` itself
   *  never touches zoom (only x/y), so omitting this leaves the camera at
   *  whatever zoom the app booted with (1, i.e. its default). */
  zoom?: number;
  /** OPTIONAL, and specific to a narrow defect class -- see
   *  `OPEN_GROUND_SCENARIO`'s own comment for why this exists at all before
   *  adding it to a new scenario. When set, `golden-diff-gate.ts` runs a
   *  SECOND, same-renderer self-check on top of the ordinary pixi-vs-three
   *  budget: it crops the three capture to `region` (px, in the captured
   *  image's own coordinates) and fails if more than `maxBackgroundFraction`
   *  of that crop is the single most common colour. This is deliberately NOT
   *  a pixi-vs-three comparison -- it exists because that comparison was
   *  measured, for this exact scenario, to NOT discriminate the defect it
   *  was built to catch (see this file's `OPEN_GROUND_SCENARIO` comment). */
  groundTextureCheck?: {
    /** A sub-rectangle of the captured image, in captured-pixel coordinates,
     *  known to contain only open ground -- no HUD chrome, no unit sprite, no
     *  vehicle. Picking a contaminated region defeats the check silently (a
     *  unit's own flat-coloured body would just become a second "background"
     *  colour among many, diluting rather than tripping the fraction) rather
     *  than loudly, so verify with a fresh capture before reusing this for a
     *  different scenario/camera/zoom. */
    region: { x: number; y: number; w: number; h: number };
    /** Budget for "fraction of the region that is the single most common
     *  colour". Real measured values for THIS region (`.superpowers/d-golden-scenarios-report.md`
     *  has the full derivation): 0.9588 with the scatter bug present (671acdb),
     *  0.9408 with it fixed (HEAD/d9fd1c7) -- both exactly reproducible across
     *  repeated headless captures (this region's content is generated
     *  deterministically from map data and a fixed tick count, so unlike the
     *  pixi-vs-three metrics elsewhere in this harness, there is no
     *  rasterisation-path noise to budget headroom for here). */
    maxBackgroundFraction: number;
  };
}

/** The original scenario (`.superpowers/d-golden-diff-report.md`): a static,
 *  order-free sandbox scan. 100 ticks = 5 sim-seconds at the fixed 20 Hz tick
 *  (invariant 1) -- enough for units to have oriented/animated past their
 *  spawn pose and fog to have resolved around the camera's framing, on a map
 *  where the sandbox force has not been given a move order and so has not
 *  left its assembly point (see main.ts: sandbox mode sets no
 *  `player_start`/orders, only a mission does). No vehicle, no combat, no
 *  open ground at zoom -- see this file's own top comment for what that
 *  means for what this scenario can and cannot catch. */
export const QUIET_SCENARIO: Scenario = {
  id: 'quiet',
  description:
    'beit_sahwan_outskirts @ town_center, order-free sandbox -- the original, ' +
    'hand-measured baseline. No vehicle, no combat, no open ground at zoom.',
  sandboxMap: 'beit_sahwan_outskirts',
  cameraMarker: 'town_center',
  ticks: 100,
};

/** Added for Phase D item #20/#8 (`.superpowers/d-scatter-report.md`,
 *  `docs/superpowers/specs/2026-08-29-phase-d-todo.md`): open ground, at
 *  native in-game zoom, on an arid map -- the one framing the quiet scenario
 *  never exercises, which is exactly where three's stone-grain scatter
 *  quietly collapsed to a no-op on 4 of 5 shipped maps (fixed in `d9fd1c7`).
 *  Parameters match the scatter report's own manual walk exactly:
 *  `tutorial_ground`'s `field` marker sits in open ground with no
 *  knoll/ridge/road/cover nearby (confirmed against the map's own tile
 *  grid), `zoom: 3` is a real `renderer.camera.zoom` value -- a genuine
 *  camera state, not a screenshot crop -- close to but slightly past the
 *  in-game mouse-wheel zoom ceiling of 2.5 (`main.ts`'s wheel handler clamps
 *  `[0.35, 2.5]`; this harness sets the property directly, which the wheel
 *  handler never gates), chosen because it is what the scatter report proved
 *  actually shows the marks large enough to matter without cropping. 20
 *  ticks = 1 sim-second, enough for the terrain scatter (built once at map
 *  load, not animated) to be fully drawn and for units to have settled from
 *  their spawn pose, without walking them out of the tight open-ground
 *  framing the way the quiet scenario's fuller 100 ticks would risk on a
 *  smaller, more open map.
 *
 *  A real, measured limitation, found while sanity-checking this scenario
 *  against `671acdb` (the commit immediately before the scatter fix) and
 *  `d9fd1c7` (the fix itself) -- recorded here because it shapes both this
 *  scenario's own `groundTextureCheck` below and `golden-diff-gate.ts`'s
 *  `SCENARIO_BUDGETS` comment: the ordinary pixi-vs-three
 *  `diffPixelPct`/`meanAbsChannelDelta` pair, run against this exact
 *  scenario, does NOT discriminate the buggy commit from the fixed one
 *  (671acdb: 1.945% / 8.547; d9fd1c7: 1.937% / 8.733 -- indistinguishable
 *  from run-to-run noise, and not even consistently ordered the direction
 *  you'd expect). Root cause, confirmed by inspecting captured crops
 *  directly: Pixi's own open-ground rendering carries a per-tile colour
 *  jitter (`groundTone`'s checkerboard, visible by eye) plus soft,
 *  anti-aliased, larger-reading round blob marks, while three -- fixed or
 *  not -- draws flat-shaded, hard-edged diamonds (a deliberate Phase 0
 *  choice). That shape/softness gap is large, pervasive across nearly every
 *  open-ground pixel, and present in BOTH the buggy and fixed commit --
 *  `.superpowers/d-scatter-report.md` already named a version of this
 *  ("Pixi's blobs are larger-reading and softer-edged than Three's flat,
 *  hard-edged diamonds even now... architectural, not a further shading
 *  bug"). It swamps this specific bug's much smaller marginal contribution
 *  to a full-canvas pixi-vs-three percentage. A SAME-RENDERER, cross-commit
 *  comparison (three's own `671acdb` capture vs its own `d9fd1c7` capture,
 *  no Pixi involved) DOES discriminate clearly -- pixelmatch counts 485
 *  differing pixels here vs 14 for the same cross-commit comparison on
 *  `QUIET_SCENARIO` (34x), and `meanAbsChannelDelta` 0.401 vs 0.054 (7.4x) --
 *  but a CI gate only ever has ONE commit's captures to look at, not a
 *  before/after pair, so that technique cannot run automatically here.
 *  `groundTextureCheck` below is the same-renderer idea adapted to run from
 *  a single capture: instead of comparing three against a past version of
 *  itself, it checks a structural property of three's OWN output directly
 *  (how much of a known-pure-ground crop is literally the single flat
 *  background colour) -- exactly what the invisible-fleck bug broke, and
 *  exactly what Pixi's rendering style has no bearing on either way. */
export const OPEN_GROUND_SCENARIO: Scenario = {
  id: 'open-ground',
  description:
    'tutorial_ground @ field, zoom 3 -- open arid ground at native in-game zoom, ' +
    'the framing that caught the stone-grain scatter defect (d9fd1c7).',
  sandboxMap: 'tutorial_ground',
  cameraMarker: 'field',
  ticks: 20,
  zoom: 3,
  groundTextureCheck: {
    // Confirmed unit/HUD-free at this exact scenario's camera framing (1400x900
    // capture): only 4 distinct colours appear in this crop in either the buggy or
    // fixed commit (the flat background plus 2-3 mark tones), vs 244 in Pixi's own
    // capture of the identical region -- a jump in distinct-colour count here would
    // itself be a sign a unit had drifted into frame, before the fraction check even
    // runs.
    region: { x: 950, y: 500, w: 450, h: 400 },
    // Halfway between the two real measured values (671acdb 0.9588, d9fd1c7
    // 0.9408), which is safe specifically because both were bit-identical across
    // repeated headless captures -- this crop's content has no rasterisation-path
    // or timing noise to absorb, unlike the quiet scenario's ~10x-over-baseline
    // budgets.
    maxBackgroundFraction: 0.95,
  },
};

/** Promoted from `.superpowers/d-ground-clip-report.md` and
 *  `.superpowers/d-anchor-fix-report.md`'s own ad-hoc "vehicle-dense"
 *  scenario -- proven useful twice by hand, never committed. Same map,
 *  same tile, same aligned tick (140) as both reports; the crop and exact
 *  percentage will differ from either report's own numbers, because both
 *  measured a hand-picked sub-crop around the vehicle and this harness's
 *  `capture()` always screenshots the FULL canvas rect (`capture-protocol.ts`
 *  step 3d) for consistency with `QUIET_SCENARIO`/`OPEN_GROUND_SCENARIO` --
 *  re-measured fresh against the real committed harness rather than reusing
 *  either report's crop-scoped figure.
 *
 *  `beit_sahwan_outskirts`'s sandbox force (`SANDBOX_KDF`, `main.ts`) places
 *  two `mbt_lavi`, an `ifv_namer`, an `apc_eitan`, a `jeep_shoded` and more
 *  around the friendly anchor -- no named marker sits on any of their tiles,
 *  hence `cameraTile` rather than `cameraMarker`. `targetTick: 140` (not a
 *  relative `ticks`) for the reason that field's own comment gives: vehicles
 *  have idle turret sweep and ambient dust/exhaust, both tick-phase-sensitive,
 *  so this scenario is NOT drift-insensitive the way the other two are. */
export const VEHICLE_SCENARIO: Scenario = {
  id: 'vehicle',
  description:
    "beit_sahwan_outskirts sandbox force's own mbt_lavi tile, tick 140 (aligned, not relative) -- " +
    'several vehicles at native zoom, the framing neither other scenario puts in front of the diff.',
  sandboxMap: 'beit_sahwan_outskirts',
  cameraTile: [4.5, 20.5],
  ticks: 140, // unused when targetTick is set; kept as documentation of the intended advance
  targetTick: 140,
};

/** Real combat: `beit_sahwan_3_clearance`'s own opening roster, ordered to
 *  fight. Closes the gap named in `docs/superpowers/specs/2026-08-29-phase-d-todo.md`
 *  #8 -- `.superpowers/d-combat-diff-report.md` measured 2.133%-3.395% on
 *  this exact mission by hand and found a real, since-fixed defect
 *  (`d-anchor-fix-report.md`'s 60-90px sprite offset) that no committed gate
 *  could have caught, because none exercised combat at all.
 *
 *  Verified deterministic (see `orders`' own comment) at tick 20 (order) /
 *  600 (capture): two independent Playwright pages reported IDENTICAL
 *  living-unit counts on both sides. `attackMove` for the opening armour/
 *  infantry/AT push (ids 0-7 -- `mbt_lavi` x1, `ifv_namer` x2, `apc_eitan`,
 *  `inf_squad` x3, `at_team`) toward world tile (20, 20), which by tick 600
 *  has closed with the mission's own nearest militia/RPG/ATGM group and
 *  taken losses on both sides (9 of 11 friendly, 8 of 12 hostile survive) --
 *  real fire, real kills, not merely movement. `cameraTile` is the mission's
 *  own surviving cluster's centroid at that tick (queried live, not guessed),
 *  so the capture frames the fight rather than empty ground nearby. */
export const COMBAT_SCENARIO: Scenario = {
  id: 'combat',
  description:
    'beit_sahwan_3_clearance, tick 600 -- an attackMove queued at tick 20 for the opening armour/' +
    'infantry push, closed with the enemy by capture time. Real combat: fire, kills, wrecks.',
  mission: 'beit_sahwan_3_clearance',
  cameraTile: [21, 21],
  ticks: 600, // unused when targetTick is set; kept as documentation of the intended advance
  targetTick: 600,
  zoom: 1.5,
  orders: {
    atTick: 20,
    commands: [
      "window.__lions.sim.queueCommand({ kind: 'attackMove', ids: [0,1,2,3,4,5,6,7], " +
        'x: Math.round(20 * 65536), y: Math.round(20 * 65536) });',
    ],
  },
};

/** Every scenario this harness knows about. `golden-diff-gate.ts` runs all of
 *  them, each against its own budget. Add a new one here rather than
 *  building another ad-hoc scenario by hand. */
export const SCENARIOS: readonly Scenario[] = [QUIET_SCENARIO, OPEN_GROUND_SCENARIO, VEHICLE_SCENARIO, COMBAT_SCENARIO];

/** Back-compat named export for the quiet scenario's fields -- kept because
 *  the manual protocol above (and any existing external notes) may still
 *  refer to these names directly. Prefer `QUIET_SCENARIO`/`SCENARIOS` in new
 *  code. */
export const SANDBOX_MAP = QUIET_SCENARIO.sandboxMap;
export const CAMERA_MARKER = QUIET_SCENARIO.cameraMarker;
export const CAPTURE_TICKS = QUIET_SCENARIO.ticks;

function baseUrl(port = 5173): string {
  return `http://localhost:${port}`;
}

function sceneParam(scenario: Scenario): string {
  if (scenario.sandboxMap !== undefined && scenario.mission !== undefined) {
    throw new Error(`scenario "${scenario.id}" sets both sandboxMap and mission -- exactly one is allowed`);
  }
  if (scenario.mission !== undefined) return `mission=${scenario.mission}`;
  if (scenario.sandboxMap !== undefined) return `sandbox=${scenario.sandboxMap}`;
  throw new Error(`scenario "${scenario.id}" sets neither sandboxMap nor mission`);
}

export function pixiUrl(port = 5173, scenario: Scenario = QUIET_SCENARIO): string {
  // Explicit `&renderer=pixi`, not just the absence of `&renderer=three`.
  // `renderer-choice.ts` falls back to whatever `localStorage['lions.renderer']`
  // last held when the query param is absent, and that storage is per-ORIGIN
  // (CLAUDE.md, "The three.js backend"'s last bullet) -- shared across every tab
  // and every capture ever run against this dev server, this harness's own three
  // capture included. Without this, a "pixi" capture taken on an origin whose
  // storage was last set to 'three' silently boots three too, and the two
  // screenshots come back byte-identical: a real trap this file hit once,
  // caught only by both PNGs being suspiciously the same size and MD5.
  return `${baseUrl(port)}/?${sceneParam(scenario)}&renderer=pixi`;
}

export function threeUrl(port = 5173, scenario: Scenario = QUIET_SCENARIO): string {
  return `${baseUrl(port)}/?${sceneParam(scenario)}&renderer=three`;
}

/** Evaluated in-page (browser console / javascript_tool). Returns JSON so
 *  the two backends' results can be diffed textually before trusting the
 *  screenshots -- see protocol step 3c. Zoom (if the scenario sets one) is
 *  applied AFTER `goto()`, matching the scatter report's own sequence --
 *  `goto()` never touches `camera.zoom` (only x/y), so the order does not
 *  change the result, but keeping it explicit keeps this script legible as
 *  "frame, then zoom, then advance" rather than relying on that fact. */
export function captureScript(scenario: Scenario = QUIET_SCENARIO): string {
  if (scenario.cameraMarker === undefined && scenario.cameraTile === undefined) {
    throw new Error(`captureScript: scenario "${scenario.id}" sets neither cameraMarker nor cameraTile`);
  }
  const gotoLine =
    scenario.cameraTile !== undefined
      ? `window.__lions.goto(${scenario.cameraTile[0]}, ${scenario.cameraTile[1]});`
      : `window.__lions.goto(${JSON.stringify(scenario.cameraMarker)});`;
  const zoomLine = scenario.zoom !== undefined ? `window.__lions.renderer.camera.zoom = ${scenario.zoom};\n` : '';
  // targetTick: align to an ABSOLUTE tick regardless of real-time rAF drift
  // accrued since __lions was assigned (see Scenario.targetTick's own
  // comment for why relative step(ticks) is not safe for a scenario with
  // tick-phase-sensitive content). Falls back to the plain relative step for
  // every scenario that omits it.
  const stepLine =
    scenario.targetTick !== undefined
      ? `const _cur = window.__lions.sim.tickCount; const tick = window.__lions.step(Math.max(0, ${scenario.targetTick} - _cur));`
      : `const tick = window.__lions.step(${scenario.ticks});`;
  // orders: align to atTick FIRST (same absolute-tick mechanism as
  // targetTick, independently, so the order-queuing moment is exactly as
  // drift-proof as the final capture moment -- see Scenario.orders' own
  // comment), queue every command, then fall through to stepLine's own
  // (also absolute, when targetTick is set) advance to the capture tick.
  const ordersLine =
    scenario.orders !== undefined
      ? `{ const _o = window.__lions.sim.tickCount; window.__lions.step(Math.max(0, ${scenario.orders.atTick} - _o)); }\n` +
        scenario.orders.commands.join('\n') +
        '\n'
      : '';
  return `
${gotoLine}
${zoomLine}${ordersLine}${stepLine}
const c = window.__lions.renderer.camera;
const canvas = window.__lions.renderer.canvas;
const r = canvas.getBoundingClientRect();
JSON.stringify({
  tick,
  camera: { x: c.x, y: c.y, zoom: c.zoom },
  rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  dpr: window.devicePixelRatio,
});
`.trim();
}

/** Back-compat named export: the quiet scenario's capture script, exactly as
 *  it was before scenarios existed. Prefer `captureScript(scenario)`. */
export const CAPTURE_SCRIPT = captureScript(QUIET_SCENARIO);
