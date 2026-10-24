# The visual gate (golden baseline): full record

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 1216-1553, section "The three.js backend" -->

- **The visual gate is three-vs-three against a committed baseline**:
  `pnpm golden-baseline` (`tools/src/ci/three-baseline-gate.ts`). Playwright
  captures three.js at a fixed scenario/tick/camera and diffs it against a PNG
  in `tools/golden-baselines/<envKey>/`. It runs in **ci.yml's `visual` job on
  every PR and every push to main** — **39.2–40.0 s** wall clock for what were
  then **five** scenarios including booting its own dev server and running the ten
  reference-free toggle checks (34.1–35.4 s without them; 3 runs each, same
  machine, 2026-09-03 — the 32.0–32.9 s this line used to carry predates them;
  NOT re-timed since the sixth scenario, `aftermath`, and twelve more checks landed)
  — plus a nightly that files a GitHub issue on failure. **Six scenarios since
  WP-A2 plan 1 (2026-09-25)**: `quiet`, `open-ground`, `vehicle`, `relief` and
  `aftermath` vote; `combat` is report-only. Read
  `tools/src/golden-diff/baseline.ts` before touching a threshold; the things
  below are counter-intuitive and every one was measured.
  **`meanAbsChannelDelta` is the PRIMARY metric and pixelmatch's pixel count is
  the secondary one**, which is the reverse of how a golden-image gate is
  usually written. Colour here is quantised onto a palette, so a real
  regression moves a wide area by ONE palette step — 19/255 for the stone-grain
  scatter defect — which is under pixelmatch's 0.1 perceptual threshold.
  Re-injecting that defect into HEAD and capturing gives **`diffPixels` 0 and
  `meanAbsChannelDelta` 0.3519** on the open-ground crop. A gate written the
  usual way sees nothing.
  **Baselines are keyed to the capture environment and that is not tidiness.**
  Same machine, same commit, SwiftShader vs ANGLE/Metal: 230 px / 0.0320 on
  `quiet` alone, ~100x that scenario's run-to-run noise and enough to swallow
  the defect's own 0.0493 signal. A missing baseline for the current
  environment is **exit 3**, a distinct code, never a silent pass. A baseline
  still has to be blessed per environment, and CI's must be created by the
  `visual-baseline-bless` workflow, which **opens a review PR by default** since
  2026-10-04 (it committed to `main` directly from 2026-09-02 to then; `direct: true`
  restores that) — but the reason is no longer "we do not
  know whether a capture even works there". **Cross-OS CAPTURE is measured now
  and it works**, which retires the "unmeasured" this line used to carry: on
  `ubuntu-latest` (run 33591712714, 2026-09-02) all four gated scenarios
  captured cleanly on `linux-x64-swiftshader` in ~35 s wall clock, and
  `open-ground`'s then-reference-free `groundTextureCheck` read `fraction 0.9363
  (budget <0.95), distinctColors 9 → PASS` there against macOS's own 0.9363
  (that check is retired now — see the toggle bullet below).
  **Cross-OS EQUIVALENCE of the pixels is measured too, as of the lit
  renderer's Linux bless** (2026-09-15, run 34920932471, the first time a Linux
  capture was diffed against the macOS baseline at the same commit): quiet
  0.3146 / 42,781 px, open-ground 0.2899 / 41,569, vehicle 0.3056 / 16,602,
  relief 0.2965 / 58,301 — mean |channel delta| over 255 and non-identical
  pixels of a 1400x900 frame. The same picture, visibly and by number, and
  still an order of magnitude and more above every scenario's magnitude
  threshold (0.0039–0.02), which is exactly why the per-environment key stays.
  That workflow **could not create the first one**, which made the whole gate a
  green-ticking no-op on CI: its `git diff --quiet -- tools/golden-baselines`
  guard reports only TRACKED changes, and a first bless on a new runner writes
  an entirely UNTRACKED directory, so the step printed "Baseline unchanged" and
  opened no PR. Fixed with `git status --porcelain -uall`; if you touch that
  guard, remember `git diff` cannot see a new file.
  **What votes with no baseline is the VISIBLE-TOGGLE A/B, and it replaced a
  check that had gone structurally inert.** Hide a named draw layer, repaint
  with zero elapsed presentation time, capture, and require the frame to change
  by a calibrated floor — `BaselineSpec.layerChecks`, with the renderer seam in
  `packages/render/src/three/debug-layers.ts`. Since WP-A2 plan 1 there are
  **22 checks**: `quiet` 8 (`scatter`, `decor`, `ground-albedo`, `roads`, `macro`,
  `buildings`, `vignette`, `skirt`), `open-ground` 4, `vehicle` 1 (`units`),
  `relief` 5, and `aftermath` 4 (`decals`, `roads`, `macro`, `scatter`); relief read
  (2026-10-15) added `slope-light` and `height-contours` to both `relief` and
  `aftermath`, the only gated frames with relief (both read sub-threshold pixels there,
  so magnitude floors carry them). **`macro`,
  `roads` and `decals` are new, and `scorch` is gone** (removed, not aliased, R-17:
  `decals` hides both pools). Hiding `ground-albedo` zeroes only the slot
  strengths. The scatter TONE backdrop hides `ground-albedo` AND `macro`, because
  the macro field alone blinded the tone check to the scatter defect (0.93/0.97
  with the defect; 0.58/0.65 with the macro at 0). `macro` votes only where the
  pure field predicts a real signal over the crop (F-18): `quiet`, `open-ground`
  and `aftermath`, and not `relief` (0.181). Re-run F-18 if the field's period or
  seed changes. Every new floor is a third of the smallest of three runs. It is texture-proof by construction: it never asks what the frame
  looks like, only whether removing a layer changes it. That is exactly what
  `groundTextureCheck` could not survive — it asked how much of a ground crop
  was one flat colour, the sand tile landed, and the answer became a permanent
  0.2330 against a `<0.95` budget. **A reference-free check that asks about
  appearance can be blinded by content added later; one that asks whether a
  layer contributes cannot.**
  **`aftermath` is the gated scenario that sees the ground remember a battle**
  (`AFTERMATH_SCENARIO`, `capture-protocol.ts`): `qarn_hadid&decals` at the
  showcase centroid (34.5,32), zoom 2.2, tick 300, with NO drone order -- the
  force's own sight lifts the fog there. Every stamp is dated 0 ms, so the
  pinned tick fixes the fades. **Its frame has no unit and no live effect in
  it, and that is the whole point** (fix wave I-2): at Task 17's framing, on the
  sandbox force at zoom 1, two captures of one commit differed by 519-656 px /
  0.040-0.047 against a 40 px / 0.004 budget, because idle mesh units and the
  fight the drone started animate on the FRAME clock, which `step()` advances
  by a latched real frame time that differs per process. The showcase now sits
  clear of the force and 22 of 22 fresh-process captures read 0 px / 0.0000
  against a provisional baseline; every layer reading is bit-identical over 23
  runs. Zoom 2.0 still took in the force's west edge (390-500 px). Do not
  frame units back into it, and do not raise its thresholds. A missing
  `aftermath` entry in an EXISTING manifest is exit **1**, not 3, so CI's
  `visual` job stays red until the post-merge bless. That is intended.
  **`DEBUG_LAYERS` still carries one name no gated scenario can judge, because
  none contains a blast.** `blast-light` (WP-A1.2) names the pooled
  `FlashLightManager` that a vehicle kill and a shell impact throw. `vehicle`
  parks the sandbox force at tick 140 with nothing dying and no round in the
  air, and `combat` is `gated: false`, so a `layerChecks` entry would read 0 px
  on a perfectly healthy tree. (`decals` had the same problem as `scorch` until
  `aftermath` gave it a showcase.) What witnesses them instead is `pnpm blast:capture`
  (`tools/src/perf/blast-captures.ts`), which runs the SAME toggle A/B on a
  frame 200 ms after a detonation and holds it to floors derived the same way
  (a third of a measured signal, with the sample size beside it). It has
  already earned itself: `blast-light` read **0 px / 0.0000** on every kill
  subject and the cause was an emitter nobody had registered — see "Mesh
  units". The rung is PER LAYER there and that is measured too: a light lives
  500 ms and must be caught at 200, while a scorch mark spends its first second
  under the fireball and reads 0 px / 0.3423 at 200 against 7251 px / 1.4411 at
  2000. A gated `blast` scenario here is the thing that would let this gate see
  the package at all, and it does not exist yet.
  **The blast harness waits for a STEADY loop, not a fixed time** (2026-09-25).
  It waits for 5 consecutive frames of 150 ms or less, with a 30 s ceiling
  (`SETTLE_STEADY_FRAMES`, `SETTLE_STEADY_MAX_FRAME_MS`, `SETTLE_TIMEOUT_MS`;
  `--settle-ms` overrides the ceiling). The old fixed 2500 ms settle froze the
  loop inside the boot tail on BOTH main and the branch: a 511–942 ms `step(1)`
  latch, which the harness's own guard then skipped, so the subjects that set
  the floors went unmeasured. `qarn_hadid` steadies at 190–233 ms and runs to
  the ceiling, so `scorch_qarn_shoulder` is `handTick: true`, and its stale
  `blast-light` exemption is deleted. **A settle that hits its ceiling
  refuses the group** (`unsteadySettleRefusal`) unless every subject in it is
  `handTick`, and the run fails at the end, exactly as an overshooting
  `step(1)` does -- it used to be only logged, so a scene whose frames were all
  180 ms timed out and still passed.
  Both documented defects now exit **1** with an
  empty baseline directory: erasing every decor object (`decor-place.ts`'s
  `familyFor` → `return null`) drives the `decor` toggle to 0 px / 0.0000 on all
  three scenarios (floors 4700/0.4, 300/0.15, 12800/0.92), and the scatter
  no-op fails the `scatter` **tone** check.
  **The scatter no-op is a colour regression, not an erasure, and the plain
  toggle cannot see it** — measured, not assumed: hiding `scatter` on
  `open-ground` moves 4610 px / 1.6858 clean against 4067 / 1.5393 defective, a
  9% dip no honest floor separates. What separates them is a ratio of two
  footprints of the same layer: over textured ground every mark shows, including
  one whose colour has collapsed into the ground's own tone (a flat mark still
  flattens the texture); over the FLAT palette tone (`ground-albedo` hidden,
  which is the material's own 404 path) only a real tone difference shows.
  Clean 0.9306 / 0.9544 / 0.9377, defective 0.5927 / 0.6938 / 0.6359, floor 0.8
  in the gap.
  **Floors are one third of a measured signal, not a guess, and they are not
  per-environment.** All ten layer deltas are bit-identical across five
  consecutive full-gate runs (the scene is frozen; the two photographs differ
  only by the toggle), and ANGLE/Metal — a rasteriser difference worth 230 px
  against a stored baseline — moves them by under 2% bar one (`relief`
  `ground-albedo` pixel count 1015 → 906, still 2.7× its floor). The toggles
  cost **~4.9 s** on the gate's ~34.8 s (3 runs each, same machine).
  **The gate also checks one whole SCREEN the scenario harness cannot frame**
  (`tools/src/golden-diff/screens-check.ts`, added 2026-09-09). `?campaign` is
  loaded before the scenarios and must draw the 3D diorama: the check reads
  the screen's own `wrap.dataset.board` back off the DOM and fails when it
  says `flat`. It exists because Draco compression broke that board and CI
  stayed green -- every scenario here is a `sandbox=` or `mission=` URL, so
  nothing loaded the campaign screen at all. It is reference-free by
  construction and asks which PATH the screen took rather than what it looks
  like, because **the fallback is a legitimate picture**: dropping to the flat
  PNG board is correct for a browser with no WebGL2, so a pixel baseline
  cannot tell that outcome from the bug. Falsified by re-injecting the
  decoder defect: `data-board=flat, canvas=false -> FAIL`, with
  `No DRACOLoader instance provided` printed beneath it. One trap found while
  wiring it and worth knowing before adding a second screen check: the
  success path assigns `EXIT_OK` unconditionally once every gated scenario
  matches, so a failure recorded only in `process.exitCode` is silently
  clobbered -- carry it in a variable and consult it at the end.

  **Exit 3 still means "nothing was COMPARED", and ONE scenario is now
  captured and not judged**: `combat`, whose scene does not hold still between
  two photographs at all (two screenshots with NO repaint between them differ
  by 10989 px, then 22215).
  **`vehicle` joined the judged set on 2026-09-10 and how it did is the
  useful part.** It had no reference-free check because the obvious one does
  not work: `updateMeshUnits`/`updateVehicleMeshes` re-assert `root.visible`
  from fog EVERY frame, so the repaint meant to photograph the units missing
  is the call that puts them back — hiding "units" that way moved 76 px /
  0.0100, against 6922 / 0.5014 for scatter in the same frame. It was
  measuring the few billboard instancers and silhouettes that happen not to be
  re-asserted. `ThreeRenderer.unitsDebugHidden`, a flag those two writes
  consult, takes the same toggle to **23147–23152 px / 2.0232–2.0247** — 305×
  — with a floor at a third (7700 / 0.67). **A toggle that only holds until
  the next frame is not a measurement**, and any future layer whose objects
  are re-asserted per frame needs the same treatment rather than a bare
  `setObjectsVisible`.
  Two things that fell out of it. The `units` layer hides mesh units, mesh
  vehicles and the failed-GLB proxy boxes (the billboard instancers too,
  until WP-A3.3 retired them -- the reading did not move: 35368-35386 px
  across the retirement's runs), so it is the unit BODIES rather than
  overlays or silhouettes. And giving `vehicle` any check at all made it run
  the zero-time **repaint control for the first time** — `runSelfChecks`
  returns early on an empty `layerChecks` — where it failed the global hard
  zero at 0 px / 0.0002–0.0004, and was given `BaselineSpec.repaintControl`, a
  PER-SCENARIO budget that loosens one scenario and nothing else. The
  constants stay 0 and must: their own comment is right that widening them
  would silently loosen every layer floor at once.
  **What drifted is known now, and the override is deleted (2026-09-18).**
  It was `ThreeRenderer.updateVehicleAmbientFx` adding the RAW frame delta to
  its per-entity dust/exhaust accumulators, where every other elapsed-time
  reader in `frame()` clamps to 100 ms (`frameDtMs`/`frameDtSeconds`). A long
  frame therefore BANKED emission credit that later frames spent at one puff
  per CALL, elapsed time or not: boot plus the settle left the accumulator at
  5607.9 ms on all seven stationary vehicles in shot, `step(140)`'s single
  `frame(1, lastFrameMs)` took it to 11198.3, and the next **22** zero-time
  repaints each spawned 7 exhaust puffs. Each fresh puff landed on the last
  one's pixels, which is why the series decayed without reaching zero — and
  because the backlog's size is a LOAD TIME, it also explains this scenario's
  5–157 px baseline noise, all of it but a Linux residual of up to 9 px (see
  the noise line below). One call (`frameDtMs(dtMs)`) takes the control to a
  literal **0 px / 0.0000**, and two macOS full-gate runs bit-identical to each
  other on this frame. Two lessons worth more than the fix: **a control that cannot
  reach zero is a defect with a stopgap on top of it**, and the drift and the
  "renderer noise" were the same thing all along. A regression in anything no
  layer check names still passes on an unblessed runner at any size.
  **Run-to-run noise is not spread over the frame**; it sits in tight clusters
  around animating mesh units and real-time VFX, and every other pixel is
  bit-identical between captures. That is why a scenario can declare a
  `region`: scoping `open-ground` to its unit-free ground crop took its noise
  from 1762 px / 0.1544 to **0 / 0.0000**. Every scenario also has an ABSOLUTE
  `targetTick`, because a relative `step(n)` lands 18–22 ticks late and drifts
  run to run.
  **Pinning the tick the script STEPS TO is not the same as pinning the tick
  the SCREENSHOT sees, and the gap was worth a 28% false-red rate.** The app's
  rAF loop keeps ticking and repainting between `page.evaluate(captureScript)`
  and `page.screenshot()` — measured on `vehicle`, the script returned tick 140
  on all 20 runs while the sim read **167–171** right after the screenshot, so
  the picture was whichever frame in that window the compositor happened to
  hold. That read as bimodal renderer noise (45–204 px in one mode, 1164–1549
  in the other) and it was the harness. `capture()` now **kills the frame
  loop** before its settle (`FREEZE_FRAME_LOOP_STATEMENTS`,
  `capture-protocol.ts`), so `step()`'s own paint is the last paint. **And
  the tick it froze at must be 0** (`lateFreezeRefusal`, since 2026-10-11):
  squad figures read their stance off the last PRE-freeze frame, so a freeze
  one tick late moved `kitted` 8857 px (the flake on run 38092145339); a late
  freeze is refused and the page reloaded, never photographed. The
  thresholds were calibrated against 24 consecutive full-gate runs taken that
  way and the noise has since been **pooled across three independent samples on
  the same machine (24 + 21 + 49 runs)**: `quiet` 0–1 px / 0.0000–0.0001,
  `open-ground` 0 / 0.0000, `relief` 0 / 0.0000, and `vehicle` 5–157 px /
  0.0029–0.0069 — **a `vehicle` figure that is retired, because it was never
  renderer noise**: all 94 of those runs predate `c0044ff6` (2026-09-18), and
  what varied was the ambient-FX emission backlog described above, whose size
  is a LOAD TIME. **A range with no sample size beside it is an anecdote**, and
  **a bimodal noise reading is a bug to find, not a band to widen.** What
  `vehicle` reads NOW, re-measured 2026-09-23 from every `ci.yml` `visual` run
  since the fix, all on `linux-x64-swiftshader`: against a baseline captured
  AFTER it (the `a387a6a` bless) **1–9 px / 0.0004–0.0012 over 5 runs**, in two
  clusters (1 px ×2, 9 px ×3) with no established cause, while `quiet`,
  `open-ground` and `relief` read a literal 0 / 0.0000 on the same five and
  `vehicle`'s own repaint control reads 0 px on all 33 runs since the fix;
  against the pre-fix `03fad18` baseline it read 33–47 px / 0.0031–0.0054 over
  26 runs, the offset being that baseline's own banked puffs. So the fix's
  "bit-identical" (two macOS runs) does NOT hold on Linux, where up to 9 px of
  this frame still moves run to run. The thresholds are still 300 / 0.02 —
  33× and 17× that post-fix maximum — and re-deriving them is a decision
  nobody has taken.
  **WP-A1.3 (vehicle weight) is expected to need no bless, and that
  expectation is a measurement at the capture tick, not a gate result**: read
  back through `debugVehicleTransform` at each gated scenario's own capture
  tick (the gate's own URL, freeze, settle and capture script; two runs,
  identical), every mesh vehicle inside a gated frame reads exactly 0 offset,
  0 pitch and 0 roll — the eleven in each of `quiet`, `open-ground` and
  `vehicle`, whose maps have no `elevation` grid and whose sandbox force is
  parked, so both halves of the model are arithmetically zero there; the only
  two hulls in `relief` that read otherwise (Lavis still recoiling from
  firing, 0.38° / 0.018 tile) stand ~700 px below its frame. The golden gate
  was not run for it: **the confirmation is the PR's `ci.yml` `visual` job.**
  The wreck hand-off (see "Mesh units") writes a new pose only on the frame a
  mesh vehicle dies, and a hull that dies parked and not recoiling gets the
  pose it already held; whether any vehicle dies inside a gated frame before
  its capture tick was not measured, which is one more reason that job, not
  this paragraph, is the confirmation. `combat` (report-only) is expected to
  move, because its armour drives, turns and fires.
  **`tel_marum` is in the gate now, and it is the only map that can catch
  terrain.** The `relief` scenario frames the T1-C boulder corridor and the
  extruded rock-ridge walls either side of it. Before it, the gate sampled two
  of the five shipped maps — both FLAT and boulder-free — and deleting every
  boulder decor object (`decor-place.ts`) left every gated scenario green.
  It now reads **36001 px / 2.6292** there against a 0/0.0000 noise floor,
  while `quiet`, `open-ground` and `vehicle` stay inside their own noise. It
  costs **1136.4 KiB** per environment (the darwin set is 4161.2 KiB, measured
  2026-09-15 off the blessed files; the 74.4 KiB / 464.3 KiB this line used to
  carry was the PRE-LIT set, and the lit renderer's frames are ~9x less
  compressible because a palette-quantised image is mostly flat runs and a
  shaded one is not) and it needs an
  `orders` entry, because fog is computed from living side-0 units only and the
  sandbox force spawns thirty tiles away: the scenario sends the `recon_drone`
  to the corridor mouth, without which the frame is a black rectangle.
  **`combat` is captured, reported and does NOT vote.** Two captures of the
  same commit differ by 969–3847 px / 0.19–0.36 there; the defect reads 3231 px
  / 0.6006 — inside the noise on count and 1.7x it on magnitude. No honest
  threshold exists between them. Its frame still uploads as a CI artifact —
  **which it never actually did until 2026-09-02**: both workflows pass
  `--out-dir=visual-baseline-output` and upload that path from the workspace
  root, while the npm script runs under `pnpm --filter @lions/tools`, so every
  capture landed in `tools/visual-baseline-output` and every upload logged "No
  files were found with the provided path". `--out-dir` resolves against the
  repo root now.
  **A report-only scenario cannot abort the run, and that took a CI run to
  learn.** On the first Linux bless `combat` failed to CAPTURE — three
  `waitForFunction` timeouts — and threw, discarding four gated baselines
  already written to disk, the manifest that makes them usable, and the PR
  step. `guardCapture` (`tools/src/golden-diff/capture-guard.ts`) now decides
  that from `isGated`, so a gated capture failure is still fatal (proved: exit
  2, stopped at the first scenario) and a report-only one warns and continues.
  Why `combat` timed out is the deploy gate, which only a `mission=` scenario
  has: `main.ts` holds `await loading.done()` — and the `window.__lions`
  assignment behind it — until the deploy button is clicked, but the button's
  click LISTENER is attached inside `done()` itself, so a click before that is
  silently lost with no second chance. The old harness guessed the moment from
  the progress text going quiet, which is also true at "0 / 45 sheets" before
  anything has loaded. It now clicks every 250 ms until the loading screen is
  gone and REPORTS the count: on a warm macOS cache that reads `deploy gate
  cleared after 2544 ms and 8 click(s) -- 7 landed before the handler was
  attached and were lost`, so the single-click version was surviving on luck
  everywhere and ran out of it on a cold Linux runner.
  **And the script must EXIT.** That failure sat in its step for 40 minutes
  after printing its error, because `child.kill('SIGTERM')` signals only the
  `pnpm` wrapper while vite, esbuild and three intermediate shells keep the
  inherited stdio pipes open — an event loop with a live handle never drains.
  `stopDevServer` kills the process GROUP (`detached: true`) and destroys the
  pipes; `exitWith` flushes stdout and calls `process.exit` on both paths.
  macOS never showed it: there `pnpm` forwards the signal and the same code
  exits in 10.9 s.
  **Accepting an intended change** is `pnpm golden-baseline:bless -- --reason="..."`,
  which refuses to run without the reason and writes it into `manifest.json`;
  on CI it is the `visual-baseline-bless` `workflow_dispatch`.
  **Since 2026-10-04 (the lead's G2 call, #166) it pushes the new PNGs to
  `visual-bless/<run id>` and opens a PR to `main`**, its body naming the reason,
  the scenarios that changed and the captures artifact
  (`visual-baseline-bless-captures`), so the picture is seen before it becomes
  the reference — look at it, every time. That needs the repo setting
  "Allow GitHub Actions to create and approve pull requests" (Settings →
  Actions → General → Workflow permissions); with it off, PR creation fails, the
  job prints the `pull/new/<branch>` URL, names the setting and exits 0, and a
  human opens the PR by hand (as with PR #150, the first Linux baseline). The
  `direct` input (default false) keeps the old straight-to-`main` commit, with
  its three-try push retry, for when speed matters; nobody sees the picture on
  that path. Both paths keep the `git status --porcelain -uall` guard. A bot
  push or PR from `GITHUB_TOKEN` triggers NO `ci.yml` run, so the PR's `visual`
  check does not appear by itself (push an empty commit or close and reopen it),
  and after a direct bless `main`'s `visual` status stays whatever the last real
  push left it. Do not widen a threshold to clear a red run.
