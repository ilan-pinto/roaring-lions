# Performance — the renderer, and sim tick cost

> **Pixi and the billboard path are retired (WP-A3.3, 2026-10-04).** Every
> section below that measures Pixi, or three drawing billboards
> (`measurePixi`, `measureThree`, "What mesh units cost against billboards",
> the `three, billboards` rows), is **history**: kept because the
> measurements explain decisions that still stand, and no longer
> reproducible -- `backend-curve-gate.ts` runs `measureThreeMesh` and
> `measureSkinnedInfantry` only, and `measureThreeMesh` now loads every
> roster type's GLB rather than a quarter of them over billboards. The level
> load numbers for the retirement itself are in "Retiring the sprite sheets"
> at the end of this file.

**Last measured:** 2026-08-30, this branch's HEAD (`15bd819` + this session's
uncommitted `tools/src/perf/` changes). **Re-run before quoting these numbers
again if either backend, the mesh contract, or vehicle FX has changed since.**
A second pass the same day (this session) added the "Sim tick cost" section
below — the renderer sections above it are unchanged from the prior pass.

This is the doc `docs/superpowers/specs/2026-08-29-phase-d-todo.md`'s item #11
names: the corrected Phase B4 perf measurement used to live only in
`.superpowers/` (gitignored, unreachable outside the session that produced
it). As of Phase D, three.js is the **default** renderer — every player gets
it — so its performance characteristics are the game's performance
characteristics, and belong in the repository, not a session's scratch
directory.

**If you are about to cite a number from `.superpowers/f-scaling-report.md`,
`.superpowers/f-vehicle-cost-report.md`, or any other gitignored report:
don't.** Those predate vehicle/building meshes drawing, rigged infantry
meshes drawing, and continuous vehicle dust/exhaust FX. Re-run the harness
below and cite what it prints, or cite this file.

---

## How to reproduce

```bash
# Terminal 1: nothing to start manually -- the gate starts its own dev
# server on a port you choose (default 5190), and REUSES one already
# listening there rather than starting a second (never touches :5173).
npx tsx tools/src/perf/backend-curve-gate.ts --port=5190 --out=.superpowers/perf-evidence.json
```

This drives a real headless Chromium (Playwright, already a `tools`
devDependency) through the measurement functions exported by
`tools/src/perf/three-units.ts`. When this section was written there were
four -- `measurePixi`, `measureThree`, `measureThreeMesh` and
`measureSkinnedInfantry`; since WP-A3.3 only the last two exist. Each runs in its own fresh page
navigation to `/` (the campaign menu, not a sandbox/mission — see the
capture-conditions section for why). Progress lines and the final JSON path
print to stdout; the full per-checkpoint data (tick/render `SampleStats`,
texture budget, skinned-mesh draw-call counts) lands in the `--out` file.

For the pure-sim tick-cost cross-check (no renderer, no browser, no GPU at
all):

```bash
npx tsx tools/src/perf/three-units.ts
```

---

## Capture conditions (read this before trusting any number below)

- **Machine:** Apple M3 Pro (12 cores), macOS 26.6.2, Node v25.9.0.
- **Browser:** Playwright-managed Chromium (`playwright@1.62.1`,
  `chromium-1234`/`chromium_headless_shell-1234` locally cached), headless.
- **GPU backend was the single largest confound found while producing this
  doc, and is worth its own paragraph.** Playwright's default headless
  Chromium launch renders WebGL through **SwiftShader** (software), not real
  hardware — confirmed directly via `WEBGL_debug_renderer_info`:
  `unmaskedRenderer` read `"ANGLE (Google, Vulkan 1.3.0 (SwiftShader
  Device...))"` with no extra launch args. Under SwiftShader, the checkpoint
  curve measurements were dominated by single-frame stalls of **1,000–13,000
  ms** — reproducible in *position* (same checkpoint, run to run) but not
  explicable as organic per-frame cost (one frame among 180 samples routinely
  accounted for >90% of the whole timed phase's total). Launching with
  `args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle',
  '--enable-gpu-rasterization', '--disable-gpu-sandbox']` switches to the real
  backend — confirmed the same way, `unmaskedRenderer` reads `"ANGLE (Apple,
  ANGLE Metal Renderer: Apple M3 Pro...)"` — and the multi-second stalls
  disappear entirely (max readings drop to single-digit-to-low-double-digit
  ms, matching p95 within noise). **Every number below is the hardware-GPU
  run.** `backend-curve-gate.ts` hard-codes these args for exactly this
  reason; do not remove them without re-confirming the renderer string.
- **Every reported checkpoint-curve number below was reproduced across two
  independent runs** (fresh dev server reuse, fresh browser launch, fresh
  pages) on the hardware-GPU path; both runs are quoted where they differ
  meaningfully, otherwise one representative run is shown. The skinned-mesh
  ceiling numbers were reproduced the same way.
- **Why the harness navigates to `/`, not `?sandbox=...`:** `measurePixi`/
  `measureThree`/`measureThreeMesh` build their own independent `Sim` +
  `Renderer` entirely inside the imported module — they never touch
  `window.__lions`. Navigating to a sandbox/mission URL would boot `main.ts`'s
  *own* renderer in the same tab, running its own rAF loop concurrently with
  the harness's renderer for the whole measurement — exactly the
  tab-contamination `three-units.ts`'s own `measureThree` doc comment already
  warns about (a co-resident Pixi renderer previously inflated bare
  `sim.tick()` cost 5–8x in an earlier investigation). The bare `/` route
  renders the campaign menu only, confirmed live (`window.__lions` stays
  `undefined`), so the harness's own renderer is the *only* renderer running
  in the tab.
- **rAF/backgrounded-tab throttling was avoided by construction, not by
  care.** `measureCheckpoint`'s render-timing loop calls `renderer.frame(1,
  dtMs)` directly and synchronously — it never awaits `requestAnimationFrame`
  or a `setTimeout`, so Chrome's ~1s clamp on backgrounded-tab timers (the
  documented trap) cannot silently stretch a sample.
- **A real machine, not an idle one.** `uptime`/`top` during capture showed a
  load average of ~3.4–5.5 across 12 cores (moderate, not idle) — other
  local processes, including a separate Claude Code session driving a real
  browser against real missions, were active throughout. Under the
  hardware-GPU path this did not visibly perturb the numbers (see the two-run
  reproducibility above); it is the leading suspect for why the
  *SwiftShader* run's stalls appeared where they did, though that
  hypothesis was not chased further once the GPU-backend fix made the whole
  question moot.
- **Ticks vs frames are two different clocks, reported separately below**, per
  invariant 1: sim tick is fixed 20 Hz (50 ms hard budget); the renderer
  targets 60 fps (16.7 ms) but nothing in this game *requires* 60 fps — the
  renderer interpolates, and a slower frame is smoothness lost, not a
  correctness failure the way a slow tick would be.
- **Roster and map are fixed** across every backend/checkpoint:
  `beit_sahwan_outskirts`, seed `20260827`, two 10-type rosters
  (`FRIENDLY_ROSTER`/`HOSTILE_ROSTER` in `three-units.ts`) spawned in
  expanding rings around two anchors 16 tiles apart (close enough for a real,
  sustained firefight at spawn — tracers in flight, turrets tracking — not a
  static crowd). Checkpoints are **lifetime spawn count** (65/150/300/400);
  the **living** count at measurement time is lower at the higher checkpoints
  because real combat has been running (266–320 living at the 300/400
  checkpoints, not 300/400 — attrition, not a bug).
- **40 timed ticks, 180 timed render frames per checkpoint**, after 5 tick /
  10 frame warmup respectively — unchanged from the harness's existing
  constants, not tuned for this doc.

---

## Backend curve: tick and render cost, both backends, 65–400 units

`p95` is the metric to trust here, not `avg` — see the GPU-backend paragraph
above for why `avg`/`max` were unusable before the hardware fix; with it,
`avg` and `p95` agree closely (both quoted for completeness). All times in ms.

### Pixi (billboards only, as shipped) — history, backend retired in WP-A3.3

| target | living | tick avg | tick p95 | render avg | render p95 | render max |
|---|---|---|---|---|---|---|
| 65  | 65  | 0.15 | 0.40 | 1.22–1.34 | 4.10–4.70 | 5.5–7.2 |
| 150 | 143 | 0.55 | 1.00 | 1.69–1.93 | 3.70–4.00 | 5.4–8.0 |
| 300 | 266 | 1.61 | 1.90 | 2.26–2.58 | 4.40 | 6.7–7.4 |
| 400 | 320 | 2.38 | 3.70 | 2.33–2.66 | 4.40–5.00 | 6.7–8.9 |

### Three, billboards only (`measureThree` — same roster, no `&mesh`) — history, billboard path retired in WP-A3.3

| target | living | tick avg | tick p95 | render avg | render p95 | render max |
|---|---|---|---|---|---|---|
| 65  | 65  | 0.16 | 0.30 | 0.81–0.85 | 1.90–2.10 | 14.5–19.5 |
| 150 | 143 | 0.52 | 1.20 | 0.87–0.89 | 1.80–1.90 | 14.5 |
| 300 | 266 | 1.46 | 1.70 | 0.84–0.86 | 1.50 | 15.5–17.7 |
| 400 | 320 | 2.25 | 3.00 | 1.01–1.05 | 1.50 | 20.1–20.9 |

### Three, real shipped meshes (`measureThreeMesh` — see below for what loads)

| target | living | tick avg | tick p95 | render avg | render p95 | render max |
|---|---|---|---|---|---|---|
| 65  | 65  | 0.16 | 0.30 | 0.74–0.78 | 0.90–1.00 | 1.3–1.6 |
| 150 | 143 | 0.53 | 1.10 | 1.03–1.06 | 1.20 | 1.6–1.9 |
| 300 | 266 | 1.45 | 1.60 | 1.60–1.66 | 1.90–2.00 | 2.2–2.5 |
| 400 | 320 | 2.33 | 3.00 | 1.84–1.90 | 2.10–2.20 | 2.9–3.3 |

**Headline: three is 2.3–4.5x cheaper per frame than Pixi at every checkpoint
up to and including the GDD's 300-unit target (living 266) and beyond it
(living 320 at the 400 checkpoint), with or without real mesh units in the
scene.** Tick cost (pure `@lions/sim`, shared code, unaffected by which
renderer is attached) is identical between backends within measurement noise,
as expected, and matches the renderer-free Node CLI almost exactly at 400
units (2.38ms node vs 2.25–2.38ms in-tab) — unlike the earlier documented
Node-vs-tab divergence, because this harness never lets a *live app* renderer
share the tab (see the capture-conditions section).

---

## What mesh units cost against billboards (history: billboards retired in WP-A3.3)

`measureThreeMesh` runs the **identical** curve to `measureThree` — same
roster, same checkpoints, same map — with the real shipped mesh GLBs loaded
for every roster type that has one, exactly the way `main.ts`'s `&mesh` flag
does it: `inf_squad` → `art/meshes/meshy_soldier.glb` (faction `kdf`), and
`apc_eitan`/`dozer_d9`/`mbt_lavi`/`technical` → their own
`art/meshes/vehicles/<id>.glb`. That's 4 of 10 friendly types and 1 of 10
hostile types — roughly a quarter of the roster by type, more than a quarter
of living units in practice since `inf_squad` spawns as a multi-figure squad.
Every other roster type (`ifv_namer`, `at_team`, `mortar_team`,
`jeep_shoded`, `recon_drone`, `heli_peten`, `militia_cell`, `rpg_team`,
`atgm_cell`, `mortar_crew`, `gun_truck`, `charge_squad`, `loiter_drone`,
`moto_rpg`, `paramotor`) has no shipped GLB and keeps its billboard
regardless, matching `main.ts`'s own "a type absent from the list stays a
billboard" rule.

Reading the two three.js tables above side by side: at 400/320-living, mesh
render p95 (2.10–2.20ms) runs slightly *above* pure-billboard p95
(1.50ms) — the real, measurable cost of the extra draw calls and skinning —
but at 65 living, mesh is actually *cheaper* (0.90–1.00ms vs 1.90–2.10ms),
and at every checkpoint both stay far below Pixi's billboard-only numbers.
**Swapping a quarter of the roster from billboards to real shipped meshes,
at up to 320 living units, costs at most about 1ms of extra p95 frame time
and never approaches either the 16.7ms render budget or the 50ms tick
budget.** This is a real, mixed, realistic-composition scene — not a
synthetic all-mesh stress test (that's the next section).

---

## What continuous vehicle dust/exhaust FX cost

Not isolated by an on/off toggle — that would need editing
`ThreeRenderer.ts`, out of this task's scope (constraints forbid touching
`packages/render/src/renderer.ts`, and touching `ThreeRenderer.ts` to add a
throwaway kill-switch risked exactly the kind of drive-by renderer change
this task should not make). What *is* measured: **three's billboard curve
above already includes continuous dust/exhaust for every vehicle in the
roster** (`vehicle-fx.ts`'s dust/idle-exhaust hysteresis runs unconditionally
for every non-soft unit type, no flag) — most of both 10-type rosters are
vehicles (`mbt_lavi`, `ifv_namer`, `apc_eitan`, `jeep_shoded`, `dozer_d9`,
`heli_peten` on the friendly side; `technical`, `gun_truck` and others on the
hostile side). Despite that, three's billboard render p95 (1.50–2.10ms
across checkpoints) stays 2.3–2.9x *below* Pixi's, which has no such FX at
all. This is indirect evidence, not a measured delta: it shows continuous
vehicle FX is not large enough to erase three's structural advantage over
Pixi at these unit counts, not what the FX cost in isolation. A future
measurement wanting the isolated number would need a dev-only toggle wired
into `ThreeRenderer` deliberately, reviewed on its own terms.

---

## Unit ceiling: does item #15's ~420–460 figure still hold?

**Short answer: item #15's number cannot be directly re-confirmed or
corrected from a gitignored report that no longer exists on disk, but a
fresh run of the same stand-in harness on real hardware GPU is consistent
with 420–460 being a *conservative* number, not an inflated one — the
budget-crossing point measured here is materially higher.**

This section reuses `three-units.ts`'s existing `measureSkinnedInfantry` —
unchanged this session, still explicitly a **stand-in**: it loads R0's
throwaway rigged spike (`art/spike/inf_squad_rigged.glb`, one unarmed KDF
figure, not the shipped `meshy_soldier.glb`), role-merges its 56 mesh parts
into 6 per figure, and instances N independent clones with independent
`AnimationMixer`s and skeletons — the shape the mesh-unit contract commits
to, not the exact shipped geometry. Figures, not units: this scales
skinned-mesh *infantry* in isolation, not a mixed roster.

Real-hardware-GPU results, two independent runs (avg / p95, ms):

| figures | drawCalls | avg (run1/run2) | p95 (run1/run2) |
|---|---|---|---|
| 100  | 600  | 0.81 / 0.77  | 0.90 / 0.90 |
| 300  | 1800 | 2.60 / 2.54  | 2.80 / 2.60 |
| 600  | 3600 | 6.45 / 6.53  | 6.80 / 7.00 |
| 900  | 5400 | 10.96 / 11.21 | 11.60 / 12.60 |
| 1350 | 8100 | 19.58 / 19.29 | 20.40 / 19.80 |

Cost scales close to linearly with figure count (and therefore with draw
call count — 6 per figure, unchanged across the curve — consistent with the
existing "draw-call submission is the bottleneck" finding). Interpolating
between the 900 and 1350 checkpoints, **the 16.7ms/60fps render budget is
crossed around ~1,150–1,180 figures**, comfortably past the previously
recorded 420–460. The 50ms/20Hz sim-tick budget (the one invariant 1 actually
requires) is not reached anywhere in the tested range — at 1,350 figures the
full-render cost is still under half of it.

**A methodological note earns its place here rather than being buried**:
the first pass at this exact measurement, before the SwiftShader-vs-hardware
GPU backend was diagnosed (see capture conditions), reproducibly showed the
render budget blown by ~300 figures (53ms avg) — a *dramatic*, and wrong,
apparent contradiction of the 420–460 figure. That number was an artifact of
software rendering, not a real regression; it is recorded here as the
concrete illustration CLAUDE.md's own "state capture conditions" rule exists
to prevent, alongside the golden-diff harness's 6.5x screenshot-downscaling
story.

What this does **not** do: reconcile the exact number with whatever produced
"420–460" originally. That report is the gitignored file this whole task
exists to stop relying on, and its own capture conditions (real GPU? which
one? headless or a real user-facing tab?) are not recoverable from
CLAUDE.md's one-line summary. What can be said cleanly: **on this machine,
this browser, this GPU backend, reproduced twice, the same stand-in harness
does not show the ceiling any lower than 420–460 — if anything, materially
higher (~1,150 figures).** Treat 420–460 as continuing to hold, with margin,
until a real shipped-mesh-based ceiling test (using `meshy_soldier.glb`
itself, not R0's spike) replaces this stand-in.

---

## Texture / VRAM budget

Unchanged from the existing figure, re-confirmed by this run:
`computeTextureBudget` (sums every roster type's hull+turret
`DataArrayTexture` bytes at RGBA8, no mipmaps) reads **584.0 MB** for the
full 20-type roster on both backends' identical sprite set (the number is
backend-independent — Pixi and three both load the same sheets, this
function computes it directly from the manifest rather than reading a
backend's own GPU state). Against a modern discrete or Apple-Silicon
integrated GPU's typical several-GB budget, this is not tight.

---

## Sim tick cost: scaling curve and per-loop attribution (no renderer, no browser)

**Added 2026-08-30, same session as the rest of this doc.** Everything
above measures the RENDERER. This section measures the other half of
invariant 1's budget — the fixed 20 Hz, 50 ms `sim.tick()` — which nothing
above exercises: the renderer curve's own tick column tops out at 400 units
on a world with zero tunnels registered (`buildWorld` never calls
`addTunnel`), so it cannot speak to CLAUDE.md's "Known scaling debts"
entries at all — the trail-detection scan and `markerSeesRoute` cost
exactly zero when `tunnelCount_` is 0. This section closes that gap: a
curve that goes well past the GDD's 300-unit target, with per-loop
attribution, on a world where the tunnel debt actually has something to
scan.

### How to reproduce

```bash
npx tsx tools/src/perf/sim-scaling.ts \
  --checkpoints=150,300,600,1000,1500,1800,2100 --ticks=40 --warmup=5
```

`tools/src/perf/sim-scaling.ts` reuses `three-units.ts`'s own
`buildWorld`/`computeAnchors`/`createSpawner`/`spawnUpTo` unchanged — same
map (`beit_sahwan_outskirts`), same seed, same two 10-type rosters, same
ring-spawn pattern, same "checkpoint = lifetime spawn count, living count
is lower at high checkpoints from real attrition" convention as the
renderer curve above, so a unit count means the same thing in both tables.
It additionally registers the map's own 4 authored tunnel routes
(`bs_tn_west`, `bs_tn_north`, `bs_tn_souk`, `bs_tn_clinic` — the same
conversion `main.ts` performs from `map.tunnels`), which the renderer
curve's harness never does. The friendly roster's `recon_drone` already
carries `mark_tunnel`, so `markerSeesRoute` gets real load without
inventing a unit for the purpose. Per-loop attribution works by wrapping
the relevant PROTOTYPE methods (`stepDetection`, `stepCombat`, every other
named phase in `tick()`'s body, `trailStrengthFor`, `markerSeesRoute`,
`FlowField.prototype.compute`) with a timing accumulator before the timed
loop and restoring the originals after — TypeScript `private` is erased at
compile time, so this reaches the real methods without editing `sim.ts`.
"detection pairwise" in the table below is `stepDetection`'s own total
minus the two named sub-scans, i.e. just the O(N²) unit-vs-unit contact
loop.

### Capture conditions

Same machine as the renderer curve (Apple M3 Pro, 12 cores, macOS 26.6.2,
Node v25.9.0) — pure Node, no browser, no GPU, so the SwiftShader confound
above does not apply here at all. Load average ~8.7–9.6 across 12 cores
during capture (other local processes active, same as the renderer
capture). 40 timed ticks / 5 warmup per checkpoint. **Reproduced across two
independent runs** (fresh process each time); both agree closely (e.g. the
300 checkpoint read 2.54 ms / 2.08 ms avg tick across the two runs — noise
at that scale, not a real difference) and one representative run is quoted
below.

### The main curve (cumulative checkpoints — living < target from real attrition, same convention as the renderer curve)

All times in ms. "detection pairwise" / "trailStrengthFor" /
"markerSeesRoute" are the three components of `stepDetection`'s own total
(they sum to it, modulo the small state-transition/decay loop). `flowField
calls` is how many times `FlowField.compute` — the O(width×height) BFS a
fresh movement goal triggers — ran across the 40 timed ticks; it is not
called every tick and its cost is negligible throughout.

| target | living | tick avg | tick p95 | tick max | detection pairwise | trailStrengthFor | markerSeesRoute | stepCombat | flowField.compute (calls) |
|---|---|---|---|---|---|---|---|---|---|
| 150  | 150  | 1.05  | 2.66  | 5.50  | 0.43  | 0.21 | 0.03 | 0.20  | 0.11 (6) |
| 300  | 296  | 2.08  | 2.58  | 2.67  | 1.17  | 0.36 | 0.02 | 0.45  | 0.15 (1) |
| 600  | 563  | 6.42  | 7.58  | 10.07 | 3.89  | 0.67 | 0.04 | 1.49  | 0.31 (24) |
| 1000 | 899  | 13.53 | 16.22 | 19.27 | 7.94  | 1.12 | 0.06 | 3.80  | 0.50 (33) |
| 1500 | 1330 | 25.31 | 27.87 | 28.11 | 15.12 | 1.48 | 0.07 | 7.84  | 0.57 (4) |
| 1800 | 1526 | 33.00 | 37.93 | 56.66 | 19.77 | 1.63 | 0.07 | 10.52 | 0.64 (0) |
| 2100 | 1691 | 39.39 | 44.57 | 45.26 | 23.46 | 1.64 | 0.08 | 12.96 | 0.71 (4) |

**The 50 ms / 20 Hz tick budget (invariant 1) is not crossed anywhere in
this table.** Even at the highest checkpoint measured this way (2100
lifetime spawns, 1691 living after sustained combat), tick avg is 39.39 ms
(79% of budget) and p95 is 44.57 ms (89%) — close, but under. One thing
worth flagging rather than burying: the 1800 checkpoint's **max** reading
(56.66 ms) already exceeds the budget once, on an average tick of 33.00 ms
— a single-tick spike (GC pause is the leading suspect, not investigated
further), not a sustained overrun. Read as: comfortably-average-safe
stops being spike-safe somewhere around 1500–1800 living units, before the
average itself crosses.

### Why "living" alone does not determine cost — the crossing point depends on attrition state, not just unit count

Every per-tick scan in `sim.ts` (`stepDetection`'s pair loop,
`selectTarget`, `trailStrengthFor`, `markerSeesRoute`, and effectively
every other phase) bounds its loop on `this.count` — the **lifetime**
spawn count, which never decreases — and skips dead/irrelevant entries
with an early `continue`. That early exit is cheap but not free, so a
battle-worn world (many of `this.count` already dead) costs less than a
freshly-spawned world with the identical `this.count`, because more
iterations short-circuit immediately. Measured directly: spawning straight
to 2100 units with only 5 warmup ticks (so `living ≈ 2100`, essentially no
attrition yet) reads **58.11 ms avg / 74.49 ms p95 / 97.00 ms max** —
budget crossed decisively — for the *same* `this.count` (2100) that the
cumulative-checkpoint table above reads 39.39 ms avg for, at that point
carrying only 1691 living because five earlier checkpoints' worth of
sustained combat had already happened. Continuing the fresh run two more
checkpoints (2200, 2300 — each now battle-worn from the checkpoint before
it) reads 49.80 ms/58.26 ms p95 and 50.14 ms/58.14 ms p95 respectively —
both p95-crossed, the second average-crossed too.

**Net: the budget crossing point is not one number, it is a band —
roughly 1700–2100 living units depending on how much prior attrition the
world carries, with a freshly-spawned world at the pessimistic end.** Both
ends of that band sit **5.7×–7× the GDD's 300-unit target**, and far
beyond the largest authored mission (65 units, ~26–32× headroom). At the
actual GDD target (300, living 296) tick avg is 2.08 ms — **4.2% of
budget**. At 1000 living it is 13.53 ms — **27% of budget**, still not
"near" by any reasonable reading.

### What actually dominates — and it is not the debt CLAUDE.md names first

At every checkpoint measured, **`stepDetection`'s pairwise unit-vs-unit
scan and `stepCombat`'s per-shooter target selection (`selectTarget`)
together account for 85–95% of total tick cost**, and both are separately
O(N²) — `selectTarget` scans every entity for every weapon slot of every
living shooter, unconditionally, every tick (`sim.ts`'s `stepCombat`, not
gated on "no current target"). `stepCombat`'s **share of the tick is
growing with N**: 19% at 150 living → 30% at 1691 living, the same
super-linear shape `stepDetection`'s pair scan has. **This is a second
O(N²) scan CLAUDE.md's scaling-debt entry does not name** — only detection
is called out today. Anyone staggering detection without also staggering
`selectTarget` will move the cliff, not remove it, exactly as the
delegation brief's framing predicted for the four named debts — it is true
of a fifth, unnamed one too.

By contrast, **the trail-detection scan and `markerSeesRoute` — the two
debts CLAUDE.md's entry actually singles out — are real but proportionally
small everywhere tested**: `trailStrengthFor` never exceeds 1.64 ms (4% of
tick) and `markerSeesRoute` never exceeds 0.08 ms (0.2%) across the whole
table, against 4 authored routes. Pushed to `MAX_TUNNELS` (16 routes — the
sim-enforced ceiling, `--stress-routes`, cloning the map's 4 routes to fill
the cap) at 1500 fresh living units, `trailStrengthFor` rises to 7.61 ms —
still smaller than `stepCombat` (10.33 ms) and well under `stepDetection`'s
own pairwise cost (21.16 ms) at the same checkpoint. **The trail/marker
scans scale exactly as documented (linear in route count, confirmed
directly) but never become the dominant cost within the game's own
structural limits** — no authored mission has ever shipped more than 4
routes, and the sim caps it at 16 regardless.

### What was fixed: nothing, and that is the finding

**No staggering was implemented.** The task brief's own instruction — "if
nothing is near budget at 1,000 units, that is a genuinely valuable
finding — say so plainly and stop, rather than optimising to justify the
task" — is the case this measurement lands in: nothing is near budget at
either the GDD's actual 300-unit target (4.2%) or at 1,000 units (27%),
and the budget-crossing band (1700–2100 living) sits 5.7×–7× past the
target this milestone is scoped to. Implementing a stagger now would be
optimising to justify the task, not responding to a measured need, and
would spend the "staggering changes WHEN a detection resolves, which
changes outcomes" cost (this task brief's own words) for no present
benefit. The determinism hash (`packages/sim/src/determinism.test.ts`,
`1147898451`) and `pnpm balance`'s §5.7 targets are both unchanged by this
session — confirmed by running both after adding the harness — because
nothing under `packages/sim/` besides this measurement's own
prototype-wrapping (which is undone before the process exits, and lives in
`tools/`, not `sim.ts`) was touched.

If a future mission or the GDD's larger targets push sustained living
counts past roughly 1500, the two things actually indicated by this
measurement are `stepDetection`'s pairwise scan and `stepCombat`'s
`selectTarget` — staggered together, on the same tick-index-and-entity-id
schedule, for the reason the brief itself gives: they share the per-tick
budget, and fixing one alone just moves the cliff onto the other (measured
here: `stepCombat`'s share was still growing at the highest checkpoint
tested). The trail/marker scans do not need staggering on this evidence —
they are a rounding error next to either O(N²) scan at every count and
route total the game can currently produce.

---

## Infantry animation: crossfades and falls (2026-09-17)

`worktree-art-phase1-infantry` (design `2026-09-17-infantry-animation-design.md`)
made every clip change a 150 ms blend (two actions evaluated per figure for
the window), replaced the 0.04 s death swap with a supplied fall or a
0.5 s topple, and gave three crews a real walk. Same instrument and
conditions as "Backend curve" above (`backend-curve-gate.ts`, hardware GPU
confirmed — `ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified
Version)` on both runs), before at the branch base and after at its head:

| checkpoint | living | render p95 before | render p95 after |
|---|---|---|---|
| 300 | 266 | 7.40 | 7.60 |

The +0.5 ms budget held with margin: crossfading two actions per figure for
150 ms, playing a supplied fall or a per-figure 0.5 s topple instead of a
one-frame pose swap, and a real walk cycle on three crews together cost
**0.20 ms** of render p95 at the 300 checkpoint (266 living, mixed roster,
`beit_sahwan_outskirts` seed `20260827`) — measured under the same moderate,
non-idle load this document's capture-conditions section already describes
for the "before" pass (`uptime` read a 1-minute load average of ~5.5 across
12 cores at capture time).

### Level-load cost: the six re-exported GLBs, Draco-mirror bytes (Ruling 13)

Six team files were re-exported on this branch to carry the new `fall`/
`fallAlt` clips or the crew walk cycles: three Meshy importers gained a
supplied fall (`meshy_soldier`, `sarim_rifles`, `yahalom_engineer`) and three
kit crews gained a real `move` gait (`atgm_cell`, `mortar_crew`,
`digger_crew`). Measured off the committed bytes — `/usr/bin/git show
4884a9d8:assets/meshes/<file>.glb | wc -c` (the branch's merge-base) against
the current working tree, one file at a time, 2026-09-17:

| file | before (B) | after (B) | delta (B) | delta (%) |
|---|---|---|---|---|
| `sarim_rifles.glb` | 1,030,396 | 1,600,992 | +570,596 | +55.4% |
| `yahalom_engineer.glb` | 608,544 | 966,648 | +358,104 | +58.8% |
| `meshy_soldier.glb` | 820,504 | 1,060,980 | +240,476 | +29.3% |
| `atgm_cell.glb` | 96,644 | 178,760 | +82,116 | +85.0% |
| `mortar_crew.glb` | 97,032 | 178,364 | +81,332 | +83.8% |
| `digger_crew.glb` | 54,180 | 96,948 | +42,768 | +78.9% |
| **total** | 2,707,300 | 4,082,692 | **+1,375,392** | **+50.8%** |

**+1,375,392 B (+1.31 MiB) on a 2.58 MiB starting set.** Most of it is the
whole-length fall clips on the three Meshy files (2.3–4.6 s at 24 fps, one
keyframe per bone across 72 bones each — Ruling 6 kept them whole rather than
trimmed, since the real fall checks are standing→prone/zero drift/last-frame
==wreck, not a duration band): `sarim_rifles` and `yahalom_engineer` alone
account for +928,700 B, 67.5% of the total delta, and both carry TWO fall
variants (`fall`/`fallAlt`) rather than one. The three kit crews' deltas are
smaller in absolute bytes but the largest in percentage (+79–85%) because
their starting files were small (54–97 KB) and a `move` gait cycle is new
keyframe data across every walking bone, not a swap of an existing clip.
Whether to trim the fall clips (an importer-side change, reversible) is an
art call for the lead — this table is the number needed to make it, not a
recommendation either way.

---

## Known limitations of this evidence

- **Not wired into CI or `pnpm test`.** Same gap `playtest.ts` and
  `golden-diff-gate.ts` both had before someone wired them in by hand — this
  is a manual `npx tsx` command, matching the existing precedent for
  browser-dependent measurement in this repo.
- **The mesh-ceiling section (`measureSkinnedInfantry`) still measures R0's
  spike GLB, not the shipped `meshy_soldier.glb`.** The billboard-vs-mesh
  section above *does* use the real shipped asset, but only up to 320 living
  units in a mixed roster — it does not find where an all-mesh-infantry
  scene's own ceiling sits for the *real* geometry. A true replacement for
  item #15 would repoint `measureSkinnedInfantry` at the shipped GLB (which
  has no bare `move`-only clip loop coded for it the way the spike does) —
  scoped out of this task, which is measurement, not a harness rewrite.
- **Vehicle FX cost is inferred, not isolated** — see that section's own
  caveat.
- **`node --version` / OS / GPU here are one Apple-Silicon laptop.** No
  Linux/Windows, no discrete-GPU, no CI-runner numbers exist for the
  render-cost half of this claim — the same gap `three-units.ts`'s own
  Node-CLI comment already names for why *that* half (sim tick cost only)
  is the one wired into an automated gate and this half is not.
- **The sim-scaling section above (`sim-scaling.ts`) is Node-only, sim-tick
  cost in isolation** — no renderer runs concurrently, matching (not
  contradicting) the renderer curve's own finding that tick cost measured
  in-process matches an in-tab measurement almost exactly once no *other*
  renderer shares the tab. It measures one synthetic roster/map/spawn
  pattern (the same one the renderer curve uses, for comparability), not
  a real mission — the largest authored mission (65 units) is nowhere near
  either curve's tested range, so nothing here has been cross-checked
  against real mission content at scale. `drawTrail` — CLAUDE.md's fourth
  named debt, "O(width × height × routes) at 5 Hz" — is a render-side cost
  and out of this section's ownership (`packages/render/`, not
  `packages/sim/`); not measured here at all.
- **Not wired into CI or `pnpm test`** either, same as the harness above —
  a manual `npx tsx` command.

---

## Lit renderer frame cost (2026-09-14)

The before/after for the lit-renderer branch (`worktree-art-uplift`, tasks
9–13: sun and shadows, fog as a post pass, the linear colour pipeline, and
ambient occlusion), and the gate that decided how ambient occlusion ships.

**Instrument:** `tools/src/perf/render-frame-cost.ts`. It drives the REAL
renderer through `window.__lions` on a sandbox the dev server is serving —
`?sandbox=beit_sahwan_outskirts&sur&civ` — at three fixed camera positions,
and reports median and p95 of `renderer.frame(1, 16)` over 240 frames after a
30-frame warm-up. It is deliberately not a unit-count curve; `three-units.ts`
above is that.

**Two numbers per view, and only one of them can reject a post pass.**
`frame()` submits GL commands and returns; it does not wait for them. So
`cpu` is scene update plus draw-call submission, and a pass that costs the
GPU milliseconds of fill can move it by nothing at all. `gpu` brackets the
same call with `gl.finish()` — frame wall time on this canvas, a lower bound
on what the display sees. The two tracked each other within 0.4 ms through
every configuration below.

**That agreement is a property of the platform, not a finding about the
scene, and an earlier draft of this section got it wrong.** The obvious
reading — "the scene is submission-bound, so `cpu` already tells you
everything" — is disproved by the control below: a change that alters *only*
fill moves `cpu` almost exactly as much as `gpu`. On ANGLE/Metal here,
`frame()` does not return before the GPU work; the driver applies
back-pressure inside submission, so `cpu` is already most of a wall-clock
frame. Read `gpu` for the accept/reject, treat `cpu` as a slightly looser
measure of the same thing, and **do not use the pair to attribute cost
between submission and fill** — that needs a GPU timer query
(`EXT_disjoint_timer_query_webgl2`), which this instrument does not use and
which is still owed.

**The positive control for `gpu`.** A `gpu` figure that just tracks `cpu` has
a dull explanation too: ask a canvas with no context for `webgl2` and the
browser hands you a fresh empty one, whose `finish()` drains nothing,
forever. Two things rule that out here. The instrument takes
`Renderer.canvas` (public API) rather than guessing at the biggest canvas in
the document, and it then **asserts the context is one it did not create** —
`stencil: true`, which is in `ThreeRenderer`'s own context attributes and is
not a WebGL default, and a non-null `CURRENT_PROGRAM`, which only a context
that has actually drawn has. Either check failing throws. And the fill
control, same scene, same camera tile and zoom, run at 4× the pixels
(`2880x1800` CSS, so a 5760×3600 drawing buffer):

| view | cpu median @1× | cpu median @4× | gpu median @1× | gpu median @4× |
|---|---|---|---|---|
| (5,22) zoom 2.5 | 11.70 | 36.00 | 11.80 | 35.90 |
| (22,24) zoom 0.5 | 10.30 | 27.60 | 10.60 | 27.50 |
| (26,22) zoom 1.6 | 11.30 | 38.90 | 11.20 | 38.80 |

Fill is being measured — by both figures.

**This is not a pure fill control, and the sentence above used to say it was
("not one draw call different"). It is wrong.** This camera's orthographic
frustum is sized from the CSS viewport — `camera.ts`, `halfWidth = vp.width /
(TILE_W · zoom · √2)` — so doubling the CSS size shows **4× the world** as
well as drawing 4× the pixels: more tiles, more units, more draw calls. The
`cpu` column rising with the `gpu` one is therefore partly real submission
work, not only evidence that the two figures track. The **zoom-0.5 row is the
closest thing to a fill-only change** in the table, because at that zoom the
48-tile map already overflows a 1440×900 frame and widening it mostly adds
empty ground — and it is also the row with the smallest 4× multiple (2.7× on
both figures, against 3.1× and 3.4× for the two closer views), which is what
that explanation predicts. What the control still establishes is the thing it
was built for: `gpu` moves substantially when the GPU is given more to do, so
it is not a dead `finish()` on an empty context.

### Capture conditions

- **Machine:** Apple M3 Pro, macOS 26.6.2, Node v25.9.0.
- **GPU:** `ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified
  Version)` — the real hardware backend, via the same launch args
  `backend-curve-gate.ts` hard-codes. The script prints this string on every
  run and warns if it reads SwiftShader; a software run is not comparable to
  anything below.
- **Viewport** 1440×900 at `deviceScaleFactor: 2`, so the drawing buffer and
  every composer target are 2880×1800.
- **Dev servers were started by hand for this measurement** — `main` on 5179,
  the branch on 5178, never both at once, and each stopped afterwards.
- **Two samples of every configuration**, taken as separate browser launches
  against the same server. Both are quoted.

### BEFORE — `main` @ 8db0215 (the branch point; no lighting, no composer)

| view | cpu median | cpu p95 | gpu median | gpu p95 |
|---|---|---|---|---|
| (5,22) zoom 2.5 | 1.10 | 1.50 | 1.00 | 1.50 |
| (22,24) zoom 0.5 | 1.50 | 2.00 | 1.50 | 1.80 |
| (26,22) zoom 1.6 | 1.10 | 1.40 | 0.90 | 1.10 |

### AFTER — this branch, ambient occlusion as shipped (half resolution)

| view | cpu median | cpu p95 | gpu median | gpu p95 |
|---|---|---|---|---|
| (5,22) zoom 2.5 | 11.70 / 11.70 | 13.20 / 12.90 | 11.80 / 11.70 | 13.00 / 13.00 |
| (22,24) zoom 0.5 | 10.30 / 10.40 | 12.20 / 12.30 | 10.60 / 10.60 | 12.60 / 12.50 |
| (26,22) zoom 1.6 | 11.30 / 11.50 | 12.30 / 13.00 | 11.20 / 11.40 | 12.20 / 12.30 |

**The branch costs roughly 7.5 ms a frame more than `main` before AO is added
at all**, and that is the headline number here: the sun with its 4096 shadow
map, the composer's four passes at 2880×1800, and the fog post pass. AO is
the smaller half of the change — 2.8–3.7 ms of median across the three views,
against the AO-free baseline in the ladder below.

### One 4096 shadow map a frame was being drawn and thrown away

GTAO's G-buffer pre-pass is a full `renderer.render(scene, camera)` with an
override material, and `WebGLShadowMap.render` runs on every one of those
unless it is told otherwise — its only early returns are `enabled === false`
and `autoUpdate === false && needsUpdate === false`. So the sun's whole
shadow map was being redrawn inside the AO pass, each frame, for a pre-pass
that draws through `MeshNormalMaterial` and consumes no shadows at all.

`WorldGTAOPass.render` now saves `shadowMap.autoUpdate`, clears it around the
nested render, and restores it. **This is not the frame-level
`autoUpdate = false` that would freeze shadows under moving units** — that
was considered for this branch and ruled out, correctly. It is scoped to the
one nested render; the composer's `RenderPass` has already drawn this frame's
real shadows before the AO pass runs.

Measured, half-resolution AO, same two-sample protocol, before → after:

| view | cpu median | gpu median | saved |
|---|---|---|---|
| (5,22) zoom 2.5 | 12.40 / 12.30 → 11.70 / 11.70 | 12.50 / 12.30 → 11.80 / 11.70 | ~0.65 ms |
| (22,24) zoom 0.5 | 11.30 / 11.10 → 10.30 / 10.40 | 11.50 / 11.20 → 10.60 / 10.60 | ~0.85 ms |
| (26,22) zoom 1.6 | 12.20 / 12.10 → 11.30 / 11.50 | 12.10 / 12.10 → 11.20 / 11.40 | ~0.75 ms |

**0.7–0.9 ms a frame** — near a tenth of the lit renderer's whole frame cost,
and roughly a quarter of what ambient occlusion costs in total. Anyone adding
another pass that re-renders the scene should check the same thing.

### The ladder, and where it stopped

Every row is the acceptance view, (22,24) zoom 0.5, both samples, against the
16.7 ms frame budget.

All rows carry the shadow-map fix above, so they are comparable to each other
and to the AFTER table.

| configuration | cpu p95 | gpu p95 | verdict |
|---|---|---|---|
| branch, no AO pass | 9.00 | 9.00 | — (one sample; the AO-free baseline) |
| AO at full resolution | 15.40 | 15.40 | one sample; clears the stated gate, and takes the other two views to **20.3–21.7** |
| **AO at half resolution (shipped)** | **12.20 / 12.30** | **12.60 / 12.50** | **accepted** — 4.1 ms of margin, every view under 13.2 |
| `setAoPass(null)` | not reached | | |

Full-resolution AO clears the stated gate at the stated view and was still
rejected, because the gate names one view while the pass has to survive all
three: at zoom 2.5 and 1.6 the same build sits at 21.7 and 20.3 ms p95,
**3.6 to 5.0 ms over budget**. Half resolution costs 2.8–3.7 ms of median
across the three views instead of 6.5–12.3, and what it gives up is sharpness
in the occlusion TERM only, which a Poisson denoise has already blurred and
which the blend lays over a full-resolution frame. Ladder step (b), shipping
AO off, was never reached.

(The pre-shadow-fix readings, for the record: full resolution 16.20 / 16.40
cpu p95 at this view and 21.1–22.4 at the other two; half resolution 13.20 /
12.70. The decision was taken on those and is unchanged by the fix, which
moves both arms of it by the same ~0.8 ms.)

**Half resolution is not `createAoPass(scene, camera, w / 2, h / 2)`**, and
that was measured before it was designed around: `EffectComposer.addPass`
calls `pass.setSize(css × pixelRatio)` on every pass it takes, so the
constructor's size is overwritten before the first frame. It lives in an
overridden `setSize` (`WorldGTAOPass`).

### The G-buffer filter is free

GTAO as it first went in rendered every unit, vehicle and building **solid
black** over correct ground, because its normal pre-pass drew this scene's
outline hulls, billboards and decals too — see `isAoOccluder`, which also
says how to photograph the G-buffer again. Filtering them out both fixes the
picture and removes draw calls, while adding a scene traversal. Net, at half
resolution, zoom 0.5: cpu p95 13.20 / 12.80 unfiltered against 13.20 / 12.70
filtered. No measurable difference either way — so the correctness fix is
free, and neither the filtered nor the unfiltered figure above needs an
asterisk.

### `antialias: true` on the WebGLRenderer context: measured, and kept

With the composer in place the default framebuffer only ever receives SMAA's
quad, which makes the context-level MSAA buffer look like pure cost. It is
cost, and it is small. Acceptance view, half-resolution AO, two samples each:

| | cpu median | cpu p95 | gpu median | gpu p95 |
|---|---|---|---|---|
| `antialias: true` (shipped) | 11.30 / 11.30 | 13.20 / 12.80 | 11.50 / 11.40 | 13.00 / 12.70 |
| `antialias: false` | 10.80 / 10.80 | 12.60 / 12.10 | 10.90 / 10.80 | 12.50 / 12.70 |

**0.3–0.7 ms of p95, 0.5 ms of median.** Kept ON, because the threshold for
switching it off was 1 ms and because the renderer keeps a composer-less path
(`frame()` before `init()`, which the spikes and the nine `ThreeRenderer*`
test fakes take) where that context flag is the only antialiasing there is.

Both arms of that A/B were taken on the pre-shadow-fix build, so the rows
read ~0.8 ms high against the AFTER table — the *difference* between them,
which is the only thing the A/B is for, is unaffected.

### The 300-unit acceptance, measured (2026-09-15)

**Spec §11's acceptance holds, and the number is 6.50–6.70 ms p95 against a
16.7 ms budget.** It had never actually been run: everything above this
subsection measures one fixed sandbox roster, and the caveat below used to say
so and stop there. This is the unit-COUNT curve, on the real `ThreeRenderer`
with the whole lit chain in it.

**Instrument:** `tools/src/perf/backend-curve-gate.ts` — the Playwright driver
for `three-units.ts`'s `measureThreeMesh`, which builds its own `Sim` and its
own `ThreeRenderer`, calls `renderer.init(host)` (so the composer, the sun's
shadow pass, GTAO's normal pre-pass, fog and SMAA are all live), loads the real
shipped mesh GLBs for the five roster types that have one, and times
`renderer.frame()` over 180 frames with the sim held still at each checkpoint.
That `render` figure is the CPU-side bracket around `frame()` with no
`gl.finish()`; on this ANGLE/Metal platform it tracks the `gl.finish()` figure
within 0.4 ms ("Two numbers per view" under the capture conditions above), so
read it as a frame time here and re-check that agreement before trusting it on
another driver.
Two things were added to that driver for this measurement and are now
permanent: it prints the unmasked GL renderer string on every run (the
capture-conditions section calls the GPU backend the largest confound in this
whole document, and until now the launch args had to be taken on trust), and
`--only=` selects one measurement function so a ladder rung can be re-read
without re-running all four.

```bash
pnpm --filter @lions/app exec vite --port 5178 --strictPort --host 127.0.0.1   # terminal 1
npx tsx tools/src/perf/backend-curve-gate.ts --port=5178 --host=127.0.0.1 \
  --only=three-mesh --out=/tmp/perf.json                                       # terminal 2
```

**Capture conditions.** Apple M3 Pro, macOS 26.6.2, Node v25.9.0. GPU string
printed by the run: `ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro,
Unspecified Version)` — the real hardware backend. Playwright viewport
1280×720 at `deviceScaleFactor` 1, which is the harness's own fixed host size
and **5.6× fewer pixels than the frame-cost sections above** (1440×900 at dSF
2); the two are not comparable to each other and neither is quoted against the
other. Dev server started by hand on this worktree and stopped afterwards. Two
runs of every configuration, both quoted, as this document's own standard asks.

**AFTER — this branch (`3dd6151`), the whole lit chain, real shipped meshes**

| target | living | tick p95 | render avg | render p95 (run1 / run2) | render max |
|---|---|---|---|---|---|
| 65  | 65  | 0.30–0.40 | 3.36–3.45 | 3.20 / 3.10 | 126–131 |
| 150 | 143 | 1.00 | 3.55–3.65 | 5.90 / 5.40 | 8.1–9.0 |
| **300** | **266** | 1.80–2.00 | 4.92–4.95 | **6.70 / 6.50** | 8.7–9.0 |
| 400 | 320 | 2.70–2.90 | 5.98–6.00 | **7.80 / 7.80** | 9.2–20.3 |

**BEFORE** is the pre-lit `measureThreeMesh` table in "Backend curve" above
(2026-08-30, same machine, same instrument, same checkpoints): 1.90–2.00 p95 at
the 300 checkpoint and 2.10–2.20 at 400. So the lit renderer costs **3.4× at
300 living-266 and 3.6× at 400 living-320** on this curve — the shadow map's
re-submission of every caster plus GTAO's normal pre-pass plus four composer
passes, which is exactly the tripling the review predicted — and it still
clears the budget by **2.5×** at the GDD target. **That multiple is indicative,
not a controlled A/B**: the harness scene itself changed between the two arms
(smooth ground on 2026-09-03, the desert grove via `groveFamily: 'desert_tree'`
on 2026-09-07), and the pre-lit arm was not re-taken on this branch's scene
with the lighting off. The acceptance verdict does not rest on the multiple;
only the attribution does. **No ladder rung was taken.**
Shadow map stays 4096², infantry still cast, AO stays at half resolution.

Two readings of the table worth stating rather than leaving to be inferred.
The `render max` of 126–131 ms at the FIRST checkpoint is shader compilation,
not frame cost: it is one frame in 180, it appears at the first checkpoint
only, and it is gone by the second — the same first-draw stall the billboard
curve shows at 87–105 ms. And the curve is close to linear from 143 units up
(0.0107 ms per living unit between the 150 and 400 checkpoints), which puts the
budget crossing near **~1,150 living units** if it stays linear — worth
recording as an extrapolation and nothing more, since nothing was measured
above 320.

**One instrument was NOT re-run, deliberately.** `measureSkinnedInfantry` —
the source of the ~1,150-figure ceiling in "Unit ceiling" above — builds its
own bare `THREE.WebGLRenderer`, its own scene and its own inline skinned
material. It never constructs a `ThreeRenderer`, so it has no sun, no shadow
map, no composer and no AO pass, and this branch cannot have moved it. Re-running
it would have produced the pre-lit numbers again and proved nothing. The
instrument that answers "what does the lit chain cost per unit" is the one
above, and it is the one that was run.

### What this section does not measure

- **One machine, one GPU, one OS.** Same gap the sections above name. No
  Linux, no Windows, no discrete GPU, no CI runner.
- **Not wired into CI or `pnpm test`** — a manual `npx tsx` command against a
  dev server you start yourself, matching the precedent above.
- **`gpu` is a lower bound, not the frame time a player sees.** It excludes
  compositing and presentation, and `gl.finish()` drains a pipeline the
  browser would otherwise overlap with the next frame's CPU work.
- **Nothing here attributes cost between submission and fill**, and the one
  attempt to (the retracted "submission-bound" reading) was wrong. The
  control above shows `cpu` and `gpu` both respond to a pure fill change, so
  neither figure isolates either half. **A GPU timer query
  (`EXT_disjoint_timer_query_webgl2`) is still owed** if anyone wants to say
  where a pass's cost actually goes — which means the claim that GTAO's price
  here is its second scene render rather than its fill is also unproven. What
  *is* measured is that removing a whole shadow pass from it saved 0.7–0.9 ms
  and quartering its fill saved ~4 ms, so both halves are real.
- **The sandbox roster is not a mission roster.** `&sur&civ` on
  `beit_sahwan_outskirts` is a fixed, modest force, so the frame-cost tables
  above say nothing about unit count on their own. That gap is closed by "The
  300-unit acceptance, measured" — but note the two halves were captured at
  different viewports (1440×900 dSF 2 versus the curve harness's 1280×720 dSF
  1, 5.6× the pixels) and cannot be read against each other. Neither has been
  taken on a real mission's roster at scale; the largest authored mission is
  65 units.
- **Frame-level `shadowMap.autoUpdate = false` was not tried**, deliberately:
  units move every frame and their shadows have to follow. The fix recorded
  above is the opposite scope — the flag is cleared and restored around
  GTAO's own nested render only, and never spans a `RenderPass`.

## The ground, plan 1 (WP-A2) — 2026-09-25

What the splat control map, the macro field, the road SDF, the skirt ring and the shared decal
pool cost. Spec: `docs/superpowers/specs/2026-09-25-ground-design.md`, plan
`docs/superpowers/plans/2026-09-25-ground-plan-1.md` (Task 18).

### Capture conditions

- **One machine**: Apple M3 Pro, macOS, ANGLE Metal. Every tool printed `ANGLE (Apple, ANGLE Metal
  Renderer: Apple M3 Pro, Unspecified Version)`, so this is real hardware and not SwiftShader.
  Node v25.9.0, pnpm 11.17.0.
- **Before** is `8d525c81`: main plus the spec, and no ground code. Its first numbers were taken
  earlier the same day (`.superpowers/ground/cost-t0/README.txt`). The frame, unit-curve and boot
  numbers below were **re-taken in the same session as the after**, from a throwaway detached
  worktree, because p95 moves by more than the effect between sessions.
- **After** is `feat/ground` at `64afcf3b`.
- Each tree had its own dev server, in its own process group. Runs were **sequential and
  interleaved** (branch, main, branch, main), never concurrent.

### Draw calls and triangles: `pnpm ground:capture`

Viewport 1400x900, DPR 1, frame loop frozen, `frame(1, 0)` read through `renderer.info`. Centre of
each map, zoom 1, no fog:

| Map | Calls, before → after | Triangles, before → after | Textures |
|---|---|---|---|
| `beit_sahwan_outskirts` | 346 → 346 | 2,229,870 → 2,229,226 (−644) | 90 → 92 |
| `tel_marum` | 260 → 260 | 1,948,524 → 1,948,536 (+12) | 84 → 86 |
| `qarn_hadid` | 378 → 378 | 5,436,294 → 5,435,866 (−428) | 90 → 92 |
| `wadi_halam_basin` | 667 → 667 | 11,186,149 → 11,185,817 (−332) | 89 → 91 |

**Calls are +0 on every view of every map**: zoom 0.35, 0.5, 1, 2.5, fogged and the road
close-up. That is inside the budget (≤ +4 planned, capped at +6). Each triangle delta is the same
at every zoom of a map, and splits exactly into two parts:
- **+12** is the skirt ring (G5), per map;
- **−656 / −440 / −344** is the retired rut-dash scatter on the three maps with roads. `tel_marum`
  has no road, so its delta is 0.

The terrain itself adds no triangles.

**Decal calls are net +0 (R-11).** Hiding `decals` on an empty map moves 2 calls and 0 triangles,
against main's `scorch` at 1 call and 0 triangles. Totals are identical, so the other call is
main's retired `VehicleTrackMesh`, which drew under no named layer. With `--decals`, hiding the
layer at the centre moves 2 calls and 240–720 triangles, depending on how much of the showcase is
in frame.

**Textures +2**: control A, control B and the macro field came in, and the road image went out.

### Decals at the aftermath view, and at full pools

Measured with `.superpowers/ground/t18/probe.ts` at 1400x900, DPR 1, on `qarn_hadid&decals`
at (25,38), zoom 1:

| Condition | Calls | Triangles | Hiding `decals` moves |
|---|---|---|---|
| Showcase, fog on or off | 348 | 5,181,999 | 2 calls, 738 triangles |
| Full pools: 1024 persistent + 4096 fading, through `stampGroundDecal` | 349 | 5,214,873 | **2 calls, 26,624 triangles** |

The full-pool figure is R-10's number exactly, and inside the ≤ 27k budget. The index draw ranges
read 55,296 and 24,576, which is (1024×18 + 4096×2) × 3.

A full pool costs no measurable frame time at that view. Over 240 frames with `gl.finish()`, p95
reads:
- showcase only: 5.4 ms;
- full pools: 5.7 ms;
- full pools with decals hidden: 5.4–5.8 ms.

**The AO and shadow exclusion, proven on the real renderer.** `renderBufferDirect` was wrapped for
one frame, and the shadow map was forced to update:

| Object | Draws per frame | Passes |
|---|---|---|
| Each decal pool | **1** | main pass only |
| Ground mesh | 2 | main + GTAO; it does not cast shadows |
| Visible shadow caster (78 of them) | 3 | main + GTAO + shadow |

Both pools have `castShadow` false and no `normal` attribute, which is what `isAoOccluder` drops.

### Control and macro memory (R-21)

Read off the bound `DataTexture`s on a 48x48 map, counting the full mip chain:

| Texture | Size | Bytes with mips |
|---|---|---|
| Control A, RGBA8 | 384² | 786,424 |
| Control B, RGBA8 | 384² | 786,424 |
| Macro, R8 | 256² | 87,381 |
| **Total** | | **1,660,229 (1.58 MiB)** |

That matches R-21's "about 1.6 MiB". Without mips it would be 1.19 MiB, the spec's 1.2.
`renderer.info.memory` gives counts only, and reads +2 textures, as above.

### Frame cost at the acceptance views: `render-frame-cost.ts`

Viewport 1440x900, DPR 2, so the drawing buffer is 2880x1800. Each figure is p95 over the tool's
240 (cpu) or 120 (gpu, `gl.finish`-bracketed) frames, and is the mean of n runs per tree, with the
range in brackets.

| View | n | cpu p95, before → after | gpu p95, before → after | Δ gpu |
|---|---|---|---|---|
| beit (5,22) z2.5 | 2 | 13.35 [13.3–13.4] → 13.55 [13.5–13.6] | 13.50 [13.3–13.7] → 13.85 [13.6–14.1] | +0.35 |
| beit (22,24) z0.5 | 2 | 12.90 → 12.90 | 12.90 [12.7–13.1] → 12.80 | −0.10 |
| beit (26,22) z1.6 | 2 | 13.15 → 13.50 | 13.05 [12.9–13.2] → 13.15 [12.6–13.7] | +0.10 |
| qarn (5,22) z2.5 | 5 | 17.62 [17.3–18.0] → 17.82 [17.4–18.4] | 19.28 [19.1–19.4] → 19.28 [19.0–19.4] | +0.00 |
| qarn (22,24) z0.5 | 5 | 14.14 [13.7–14.4] → 14.32 [13.9–14.5] | 14.74 [14.5–15.3] → 14.72 [14.4–15.0] | −0.02 |
| qarn (26,22) z1.6 | 5 | 13.90 [13.5–14.2] → 14.62 [14.3–15.2] | 14.64 [14.2–15.2] → 15.40 [14.8–16.1] | **+0.76** |

**The delta budget (≤ +1.5 ms) is met on every view.** The largest move is qarn z1.6, at +0.76
gpu and +0.72 cpu. There the gpu median moved +0.30 (11.64 → 11.94), consistent with the ground
shader's extra taps. That cannot be isolated with the debug toggles: hiding `macro` or `roads`
zeroes a uniform, and the taps still run.

**The absolute ceiling (every view ≤ 14.5 ms p95) is MISSED on `qarn_hadid`, and main misses it
too:**
- **z2.5 (19.3 gpu, 17.8 cpu) is pre-existing and owned by the `decor` layer.** Hiding `decor`
  takes that view's gpu p95 from 17.2 to 13.0 on the branch, and from 16.6 to 12.7 on main
  (`.superpowers/ground/t18/layer-frame-cost.ts`, 120 frames, a noisy instrument). This is the
  ditch and boulder geometry the spec already records as the next ground cost.
- **z0.5** is just over on gpu on both trees (14.74 → 14.72) and under on cpu (14.14 → 14.32).
- **z1.6** is over on gpu on both trees (14.64 before, 15.40 after), and the branch's +0.76 takes
  its cpu p95 over the line (13.90 → 14.62).

`beit_sahwan_outskirts` is inside 14.5 on every view.

### 300-figure curve: `backend-curve-gate.ts`

Viewport 1280x720, DPR 1, `--port=5198`. Rows are "target 300, living 266":

| Backend | Render p95, before | Render p95, after | Render avg, before → after |
|---|---|---|---|
| three, real shipped meshes | 7.20 (earlier today), 7.60 (same session) | **7.50, 7.30** | 5.64 / 5.49 → 5.54 / 5.58 |
| three, billboards | 2.40, 2.60 | 2.70, 2.90 | 3.09 / 3.07 → 2.96 / 3.22 |

**`perf:units` at 300 is ≤ 7.5 ms p95 on both after runs**, so the budget is met. Main itself read
7.60 in the same session, so this line sits inside run-to-run noise on both trees. The ground adds
nothing distinguishable here.

### Boot time

Measured with `.superpowers/ground/t18/boot-probe.ts`. Conditions:
- viewport 320x200, which is Task 13's probe;
- one warm-up load, then 3 runs on beit and 2 on qarn;
- a CDP sampling profile at 100 µs. The profiler inflates JS time, so read the profiled
  milliseconds as proportions.

"Boot" is navigation start to the first animation frame with `__lions` present:

| Map | Before | After | Δ |
|---|---|---|---|
| `beit_sahwan_outskirts` | 1107 / 1113 / 1136 ms | 1206 / 1191 / 1208 ms | **+~80 ms (+7%)** |
| `qarn_hadid` | 1186 / 1176 ms | 1271 / 1232 ms | +~70 ms |

**Where it comes from: `buildControlMap`, paid once per terrain rebuild, and a boot rebuilds the
terrain 3–5 times.** `terrainDirty` fires as structure templates finish loading. That already
happened on main; plan 1 makes each rebuild heavier.

| Map | Rebuilds | `rebuildTerrain` bursts, before → after | `buildControlMap` inside each |
|---|---|---|---|
| beit | 3 | 79–94 ms → 136–159 ms | 60–68 ms |
| qarn | 5 | 87–126 ms → 131–179 ms | 49–60 ms |

Total per boot is +~180 ms on beit and +~255 ms on qarn, in profiled time.

The `ThreeRenderer` constructor grows from 11.9 to 24.5 ms. `buildMacroField` is 10.6 ms of that,
and both `DecalPool`s together are ~0.9 ms.

The rebuilds that land AFTER `__lions` show up as a hitch: the longest post-boot frame reads
- beit: 98–108 ms before, 173–178 ms after;
- qarn: 145–151 ms before, 196–202 ms after.

Task 13 read this as a ~6.05 s → ~6.35 s "first frame" (+5%) with a different probe. The +5–7% and
its cause agree. **Fixed in the fix wave (I-1), below.**

### The fix wave after the final review (2026-09-25)

Same machine (ANGLE Metal, M3 Pro), same session for every before/after pair. BEFORE is
`f5ecf82f` (the branch at the final review), served from a throwaway detached worktree on :5197;
AFTER is the fix wave's working tree on :5195. Runs were interleaved, never concurrent.

**Boot (I-1: the control map is built only when its inputs change).** `t18/boot-probe.ts`, 320x200,
one warm-up then 2 runs per server, done twice interleaved (4 runs each). Profiled milliseconds are
inclusive and inflated by the 100 µs sampler; read them as proportions.

| Map | `buildControlMap` per boot | `rebuildTerrain` per boot | Longest frame after `__lions` | `__lions` at |
|---|---|---|---|---|
| beit, before | 180–182 ms (3 builds) | 418–425 ms | 162–182 ms | 1187–1221 ms |
| beit, after | **65–66 ms (1 build)** | 304–377 ms | **96–115 ms** | 1175–1196 ms |
| qarn, before | 209–305 ms | 583–837 ms | 193–206 ms | 1237–1263 ms |
| qarn, after | **111–114 ms (2 builds)** | 486–643 ms | 188–190 ms | 1237–1247 ms |

- beit's post-boot hitch is back to main's own 98–108 ms (Task 18).
- qarn still builds twice: its second rebuild genuinely changes the draw mask. Its longest frame is
  owned by something else (main read 145–151 ms there).
- Time to `__lions` barely moves, because the first build always ran before it. What the fix
  removes is main-thread time after it: about 115 ms a boot on beit and 100–190 ms on qarn, in
  profiled time.
- A structure collapse still pays one full build. A dirty-rect rebuild (the footprint plus about
  2 tiles) is the follow-up.

**The road block skip (lead item 2).** `render-frame-cost.ts` on `?sandbox=qarn_hadid&sur`,
1440x900 at DPR 2, n = 5 interleaved per tree:

| View | cpu p95, before → after | gpu p95, before → after | gpu median |
|---|---|---|---|
| qarn (26,22) z1.6 | 14.56 [14.2–14.8] → 14.50 [14.1–14.9] | 15.36 [14.9–15.7] → **14.86** [14.4–15.3] | 12.06 → 12.06 |
| qarn (22,24) z0.5 | 14.32 → 14.06 | 14.78 → 14.46 | 12.92 → 12.84 |
| qarn (5,22) z2.5 | 18.06 → 17.80 | 19.74 → 19.88 | 11.56 → 11.50 |

The skip is pixel-identical: a golden A/B against a scratch baseline blessed from `f5ecf82f` reads
0 px / 0.0000 on `quiet`, `open-ground` and `relief`. `vehicle` reads 2 px and `aftermath` 656 px;
a HEAD-vs-HEAD control run of the same two read 0 and 519 px, which is their own unit and effect
noise. The z1.6 gpu p95 falls 0.5 ms, with the medians unchanged. That is within this instrument's
run-to-run spread, and it still sits over the 14.5 ms line. The albedo-skip rework (`textureGrad`
on the five slot taps) was not attempted.

**Decal buffers (M-1).** 16-bit indices for both pools (each holds exactly 16,384 vertices): 1.805 →
**1.652 MiB** (persistent 0.961 → 0.855, fading 0.844 → 0.797). A stamp now uploads its own slot:
640 B for a persistent decal and 160 B for a fading one. Before, it uploaded the pool's three
dynamic attributes whole, 0.625 MiB, almost every frame while vehicles moved.

**The showcase search (I-2).** `showcaseAnchor` scans every tile once, on the first terrain build,
under the sandbox `&decals` flag only: 46–63 ms in node on five maps.

## The ground, plan 2 (WP-A2) — 2026-09-28

**Status: complete. One budget miss found and accepted by the lead ("Accept the miss",
2026-09-28); density 0.75 ships.** Task 12 was split: part A produced the review captures, ran
`blast:capture`, and wrote the record with the numbers below left as placeholders; part B (this
session) re-ran `render-frame-cost` interleaved with main on a quiet machine (load average 4–8 on
12 cores, no other agent running — confirmed before starting and monitored throughout; one
self-inflicted contamination from running two measurement scripts concurrently was caught,
discarded, and re-run strictly sequentially), `perf:units`/`backend-curve-gate` at 300, folded
`ground:capture`'s `wadi_halam_basin` triangle count to exact digits, and re-ran the two
`blast:capture` subjects part A could not settle.

**Every budget passes except one: `beit_sahwan_outskirts` (22,24) z0.5, which the lead accepted.**
At n = 10, interleaved, gpu p95 rises from a 13.84 ms mean (main) to a 14.67 ms mean (branch) —
**+0.83 ms mean / +0.80 ms median, over the +0.74 ms cap**, with the two trees' distributions not
overlapping at all (main 13.5–14.1 ms across all 10 runs, branch 14.3–15.2 ms across all 10). cpu
p95 shows the same shape (+0.84 ms mean). This view was not named a pre-existing miss — main itself
sits cleanly under the 14.5 ms line here (13.7–14.2 ms) — so the branch's own 14.5–15.2 ms readings
on 6 of 10 runs are also a new miss on the absolute ceiling, not only on the delta budget.
`qarn_hadid` z1.6, the view the plan's own stop condition names explicitly, is clean: branch reads
0.86–1.07 ms **faster** than main (n = 10), resolving the straddle Task 5 and Task 0 left open. Per
the brief ("a missed budget is a stop... not traded away, no code changed"), no code was changed to
chase the miss; the shed ladder Task 5 already measured (density 1 → 0.75 → 0.5) was reported to
the lead alongside the fresh numbers this miss was measured against, and the lead's ruling was to
ship density 0.75 as measured rather than take a lower rung.

Spec: `docs/superpowers/specs/2026-09-25-ground-design.md`. Plan:
`docs/superpowers/plans/2026-09-27-ground-plan-2.md` (Task 12). Budgets it is measured against
(spec §2, §8, less what plan 1 spent): draw calls +3 planned (props × shadow/AO/main), cap +6
across both plans; p95 ≤ +0.74 ms at any acceptance view; `qarn_hadid` z1.6 (already at 14.86 ms
gpu p95, fix wave, n = 5, against the 14.5 ms ceiling) must not rise by more than +0.20 ms
(n = 5, interleaved) without a reported stop; every acceptance view ≤ 14.5 ms p95 with the two
pre-existing `qarn_hadid` misses (z2.5, z0.5) named, not hidden; `perf:units` at 300 figures
≤ 7.5 ms p95 (7.30–7.60 ms today), re-run after the scatter (Task 5) and again here.

### Draw calls and triangles: `pnpm ground:capture` (part A, real numbers — this table is not a
placeholder)

Machine: macOS 15, Apple M3 Pro, ANGLE Metal (`ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro,
Unspecified Version)`), not interleaved with a fresh main run (that comparison is part B's job;
these are HEAD's own absolute readings). Viewport 1400×900, DPR 1, frame loop frozen, `frame(1,
0)` read through `renderer.info`. Centre of each map, zoom 1, no fog, `--port=5196`:

| Map | Calls | Triangles | `props` layer (calls / triangles) |
|---|---|---|---|
| `beit_sahwan_outskirts` | 349 | 2,744,480 | −3 / −9,201 |
| `tel_marum` | 263 | 2,121,055 | −3 / −1,622 |
| `qarn_hadid` | 381 | 5,913,608 | −3 / −4,857 |
| `wadi_halam_basin` | 670 | 4,304,407 | −3 / −10,543 |

**The props batch draws exactly 3 calls on every map that has any props**, confirming the
shadow/AO/main triple the plan's budget names — hiding `props` moves calls by exactly 3 on every
one of the four maps above, none of them props-free. This is the one line of Step 1 this
implementer could measure without an interleaved main run: draw-call counts are a property of a
single capture, not a timing comparison, so no quiet-machine requirement applies to them.

`wadi_halam_basin`'s decor triangle budget (the olive, D8/D9), exact digits, this session, fresh
dev servers (no caching involved — see Task 6's own note that `ground:capture` read stale numbers
in its session): **main (b6497c12) 9,174,535 decor triangles at centre-z1 → branch (17480db0)
2,283,358 → −6,891,177 (−75.1%)**. This is Task 6's D8/D9 olive-LOD-plus-crown effect net of Task
1's density-0.75 clusters (both land in the `decor` layer). It does not match the spec's original
"about −3.4M a pass" estimate for this line — Task 6's own report already flagged that its
`ground:capture` readings that session were stale (byte-identical before/after a GLB swap that
could not physically cost the same triangles) and that the estimate "could not be confirmed this
way." This session's dev servers were started fresh for the timing work above and are not subject
to that staleness; −6.89M is this plan's first trustworthy reading of this line, roughly double the
spec's estimate but the same sign and the same order of magnitude, and consistent with Task 5's own
mid-plan reading of −6.78M at the same view (before Tasks 7–11 added sway/haze/floor changes that
do not touch triangle counts).

### `render-frame-cost` (part B — measured)

Machine: macOS 15, Apple M3 Pro, ANGLE Metal (`ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro,
Unspecified Version)`). Viewport 1440×900 CSS, DPR 2 (drawing buffer 2880×1800). Main
(`b6497c12`) on `:5195`, branch (`17480db0`) on `:5196`, both persistent dev servers started this
session and interleaved run-by-run (never two measurement scripts running concurrently — one
self-inflicted concurrent-load contamination was caught mid-session via `uptime`/`ps`, discarded,
and every number below is from the clean, strictly-sequential re-run). n = 10 per view per tree
(one discarded warm-up run per tree, then 2×5 interleaved rounds; the first 5 already sat close
enough to the ±0.3 ms repeat line — see global-constraints' own convention — to justify a second
round rather than reporting on 5). Acceptance views: `?sandbox=beit_sahwan_outskirts&sur&civ` and
`?sandbox=qarn_hadid&sur`, the same rosters Task 0 and Task 5 used. Raw logs:
`.superpowers/ground2/cost-t12/*.log`.

| View | cpu p95 mean, main → branch (range) | gpu p95 mean, main → branch (range) | Δ gpu (mean/median) | Budget | Verdict |
|---|---|---|---|---|---|
| beit (5,22) z2.5 | 14.01 → 14.39 (13.8–14.6 → 14.1–14.6) | 14.04 → 14.33 (13.8–14.4 → 14.0–14.7) | +0.29 / +0.30 | ≤ +0.74 ms, ≤ 14.5 ms | PASS (branch mean under 14.5; 1 of 10 runs touches 14.7) |
| **beit (22,24) z0.5** | **13.88 → 14.72** (13.7–14.2 → 14.3–15.1) | **13.84 → 14.67** (13.5–14.1 → 14.3–15.2) | **+0.83 / +0.80** | ≤ +0.74 ms, ≤ 14.5 ms | **MISS, ACCEPTED by the lead — both the delta cap and the absolute ceiling miss; distributions do not overlap; density 0.75 ships** |
| beit (26,22) z1.6 | 13.23 → 13.44 (13.0–13.4 → 13.3–13.6) | 13.05 → 13.27 (12.8–13.3 → 13.1–13.6) | +0.22 / +0.20 | ≤ +0.74 ms, ≤ 14.5 ms | PASS |
| qarn (5,22) z2.5 | 18.10 → 15.74 (17.7–19.1 → 15.5–16.0) | 20.29 → 20.86 (19.6–22.0 → 19.6–22.0) | +0.57 / +0.55 | pre-existing miss, named | PASS on delta; pre-existing miss unchanged |
| qarn (22,24) z0.5 | 15.24 → 15.97 (14.6–16.1 → 15.4–16.8) | 15.44 → 16.06 (14.9–16.1 → 15.7–16.5) | +0.62 / +0.60 | pre-existing miss, named | PASS on delta; pre-existing miss unchanged |
| qarn (26,22) z1.6 | 14.09 → 14.11 (13.8–15.5 → 13.8–14.5) | 15.38 → 14.31 (14.4–16.3 → 14.1–15.0) | **−1.07 / −0.90** | ≤ before-mean + 0.20 ms | **PASS — branch is faster than main.** Resolves the Task 0/Task 5 straddle: on a clean, quiet, interleaved n = 10 read, this view is not a regression. |

**One budget misses: `beit_sahwan_outskirts` (22,24) z0.5 — accepted by the lead.** cpu p95 shows
the identical shape (+0.84 ms mean), so this is not a gpu-only artefact. The 10-sample main and
branch distributions do not overlap at all (main max 14.1/14.2, branch min 14.3), so this is not
run-to-run noise at this sample size — a repeat is not expected to change the verdict, unlike the
`qarn` views that sat within 0.3 ms of a line. Per the brief, no code was changed to chase it; Task
5's shed ladder (reproduced below) was reported to the lead as the available lower rungs, and the
lead's ruling ("Accept the miss", 2026-09-28) is to ship density 0.75 as measured.

**Task 5's shed ladder** (`.superpowers/sdd/2026-09-27-ground-plan-2/task-5-report.md`, gpu p95
delta over main, n = 5 each, cumulative rungs — the density=0.75 rung is what HEAD ships today and
is the row this session's own n=10 re-measure updates):

| Rung | beit z2.5 | beit z0.5 | beit z1.6 | qarn z2.5 | qarn z0.5 | qarn z1.6 | calls at beit z1 | tris at beit z1 |
|---|---|---|---|---|---|---|---|---|
| HEAD-equivalent, density 1 | +0.26 | +1.18 | +0.00 | −0.26 | +0.18 | −1.30 | 349 | 2,875,588 |
| **1a density 0.75 (shipped)** | +0.22 | +0.72 (Task 5, n=5) / **+0.83 (this session, n=10)** | +0.36 | +0.58 | +0.76 | −0.28 | 349 | 2,744,480 |
| 1b density 0.5 | +0.16 | +0.38 | −0.02 | −0.14 | +0.38 | +0.32 | 349 | 2,647,428 |
| 2 + sand no-cast | +0.08 | +0.28 | −0.04 | +0.66 | +0.24 | −0.30 | 348 | 2,609,115 |
| 3 + PROP_CAP 75 | −0.14 | +0.36 | +0.16 | +0.00 | +0.46 | −0.20 | 348 | 2,609,115 |

Rung 1b (density 0.5) is the next rung that reads clean on every one of Task 5's own n=5 samples
(+0.38 at beit z0.5); this session did not re-measure it, per "do not trade anything away." The
lead's ruling ("Accept the miss") means it is not taken: density 0.75 ships as measured.

### `perf:units` / `backend-curve-gate` at 300 figures (part B — measured)

Same machine as above. `--only=three-mesh`, target=300 (settles at living=266 on both trees, same
as every prior session — this harness's roster count does not depend on the branch). n = 3 per
tree, sequential (this harness boots its own page navigation per run and is not meant to be
interleaved mid-run the way `render-frame-cost` is). Raw logs: `.superpowers/ground2/cost-t12/units-{main,branch}-{1,2,3}.log`.

| Tree | render p95 (3 runs) | mean |
|---|---|---|
| main (`b6497c12`) | 7.60, 7.20, 8.00 | 7.60 |
| branch (`17480db0`) | 6.60, 7.30, 6.80 | **6.90** |

**PASS, branch mean 6.90 ms ≤ 7.5 ms budget**, and reads slightly better than main's own mean
(7.60 ms, itself already brushing the 7.5 ms line — a pre-existing condition, not this plan's). As
Task 5 already noted, this harness loads no decor or prop meshes, so it cannot see this plan's
density or props changes at all; the two trees' numbers differing only by ordinary run-to-run noise
is the expected result, not a null test.

### Review captures (part A)

Full list and method in `.superpowers/sdd/2026-09-27-ground-plan-2/task-12a-report.md`. Summary:
`ground:capture` before (`.superpowers/ground2/cost-t0/`) vs after
(`.superpowers/ground2/t12-review/`) at zoom 0.35/0.5/1/2.5 plus fogged and road close-ups, for
`beit_sahwan_outskirts`, `qarn_hadid`, `tel_marum`, `wadi_halam_basin`; one before|after composite
per map at zoom 1 (`.superpowers/ground2/t12-review/composites/`); a close-up of each of the seven
prop kinds in place, at the exact tile the real placer put one on a shipped map
(`.superpowers/ground2/t12-review/props-closeup/`); Task 10's dawn/day/dusk set
(`.superpowers/ground2/tod/`, unchanged, produced earlier).

### `blast:capture` (part A + part B — now a clean pass)

Part A (`--port=5199 --label=after`): every floor the run was able to measure passed
(`blast-light`/`decals` on `mbt_lavi`, `apc_eitan`, `mortar_team`, `scorch_qarn_shoulder`,
`blast_in_firefight`, `blast_nomesh` — several by a wide margin, e.g. `blast_nomesh`'s
`blast-light` at 76,514 px). Two of the tool's eight subjects (`tel_marum||scorch_tel_ridge`,
`beit_sahwan_outskirts||shake_probe`) hit the settle harness's own 30-second ceiling without
reaching 5 steady frames and were skipped rather than measured, the concurrent-machine-load
confound named throughout this section.

**Part B (this session, quiet machine): `--port=5199 --label=after --only=scorch_tel_ridge,shake_probe`.
Both settle cleanly and both pass every floor:**

| Subject | Settle | `blast-light` | `decals` |
|---|---|---|---|
| `scorch_tel_ridge` (`tel_marum\|\|`) | 5 frames ≤ 150 ms after 3,093 ms / 9 frames | 49,017 px / 11.5026 — PASS | 0 px / 0.4611 — PASS |
| `shake_probe` (`beit_sahwan_outskirts\|\|shake_probe`) | 5 frames ≤ 150 ms after 7,893 ms / 14 frames | 10,716 px / 4.4540 — PASS | 7,599 px / 1.7880 — PASS |

All 8 subjects now measured, all floors clear. `.superpowers/art-captures/blast/after/` carries
219 frames (the original 6-subject run's 190 plus this retry's 29); index at
`.superpowers/art-captures/blast/after/sheet.md`. Full part-A numbers:
`.superpowers/sdd/2026-09-27-ground-plan-2/task-12a-report.md`; this retry's raw log:
`.superpowers/ground2/cost-t12/blast-retry.log`.

---

## Selection ring (A4, GH-186, 2026-09-29)

The selection ring is a conformed ground mesh (`units/selection-ring.ts`), rewritten every frame in `updateOverlays`.

**What it costs.** Nearly all of the cost is the ground height samples behind each ring's grid (`writeDecalGrid` plus its sag lattice). The grid comes in three tiers, all in one draw call, with the numbers in `readability.ts`:

| Tier | Grid | Rings | Why |
|---|---|---|---|
| Small | 4×4 | up to 0.72 tile | never buried |
| Large | 6×6 | 0.72–1.28 tile | Lavi, Grad, jeep, the Peten's circle |
| XL | 7×7 | over 1.28 tile | the four ellipses grown to hold their hull corners: Namer, Kipod, Eitan and D9; on 6×6 the Namer was buried by up to 0.027 wu |

On relief the height samples are bicubic, which makes them several times dearer than on flat ground.

**The cache.** A per-slot position cache (`RING_CACHE`) skips the samples for any ring whose unit has not moved more than 0.05 tile, or turned more than 2°, since its last build. So a STATIONARY selection costs almost nothing, and a MOVING one pays in full.

**The lead accepted the moving cost on relief on 29 Sep ("Cache + accept").**

### Capture conditions

- **Machine and browser:** Apple M3 Pro, macOS; Playwright headless Chromium with `--use-angle=metal` (hardware GPU: "ANGLE Metal Renderer: Apple M3 Pro"); 1440×900 CSS at device scale 2, which gives a 2880×1800 buffer.
- **Dev server:** the worktree's own vite on :5226.
- **Load:** checked with `uptime` before the runs, and runs started once the 1-minute load was under 5. It read 4.95 at the start (7:13) and 6.47 at the end (7:19). The machine was NOT idle: a VM service ran at about 40% CPU and a stuck System Settings process at 100%. The runs were sequential, never in parallel.
- **Scenes:** `?sandbox=beit_sahwan_outskirts&sur&civ` (flat) and `?sandbox=tel_marum` (relief).
- **The isolated batch.** The renderer's own `SelectionRingBatch` and ground sampler, with 100 rings: 70 circles at 0.56 tile and 30 Namer ellipses at 1.61 × 1.03 (7×7), over 2000 frames. "Moving" shifts every ring 0.085 tile and turns it about 3° per frame, over both cache limits. "Stationary" holds every ring still.
- **The overlay pass.** Each sandbox fields 14 side-0 units, all selected through `__lions.sel`, and a page-side wrapper on `SelectionRingBatch.push` pushes each unit's ring 7 times at offsets. That gives 98 real rings, drawn in the real frame. "Moving" shifts them 0.07 tile per frame.
- **Harness:** `.superpowers/sdd/2026-09-28-a4-readability/t5-visual/bench.mjs` and `perf100.mjs` (git-ignored scratch). The committed `tools/src/perf/render-frame-cost.ts --select-all` gives the 14-unit selection and the draw-call count.
- **Resolution:** `performance.now` resolution is 0.1 ms.

### Results

**The ring batch in isolation**, 100 rings, 2 runs, ms per frame.

| Map | Stationary | Moving |
|---|---|---|
| outskirts (flat) | 0.013 | 0.194 |
| tel_marum (relief) | 0.013 | 0.91 |

**The grid-size split**: the same 100 placements all written at one grid size, ms per frame.

| Map | 4×4 | 6×6 | 7×7 |
|---|---|---|---|
| outskirts | 0.11 | 0.27 | 0.38 |
| tel_marum | 0.50 | 1.30 | 1.85 |

A 7×7 ring costs about 1.4× a 6×6 one. Only the four XL types pay it.

**`updateOverlays` alone, 98 rings, 2 runs per arm, three views, ms (median / p95).** It contains everything a selection draws, including 14 HP bars and range envelopes.

| Map | No selection | Stationary | Moving |
|---|---|---|---|
| outskirts | 0.0 / 0.1 | 0.2 / 0.3 | 0.4 / 0.5 |
| tel_marum | 0.0 / 0.1 | 0.2 / 0.3 | 1.3 / 1.4 |

The stationary figure matches what was measured in fix round 1 for 14 selected units with UNCACHED rings (0.2 / 0.3 ms: 14 HP bars, range envelopes and 14 rings rebuilt every frame). So 98 cached rings cost no more at this 0.1 ms resolution than 14 uncached ones. The pre-A4 cost of the same selection (no ground ring) was not measured.

**Draw calls.** A selection adds exactly **+1** in every view on both maps: 340→341, 381→382 and 534→535 on the outskirts; 117→118, 133→134 and 296→297 on tel_marum.

**Whole-frame p95 (`frame()` wall time with `gl.finish`)** did not separate the arms from noise in fix round 1. Deltas ran from −0.4 to +0.6 ms run to run, and tel_marum's zoom-2.5 view has 19 ms p95 spikes in every arm. Read the rows above instead.

### Reading

- **Budget (spec §5):** ≤ 0.25 ms added at 100 rings.
  - It is met on flat ground, moving or not (0.19 ms).
  - It is met on relief while the selection is stationary.
- **Moving on relief** costs about 0.9 ms at 100 rings, up from 0.8 before the 7×7 tier. The lead accepted the moving relief cost on 29 Sep, and fix round 2's tier was ruled with it.
- **Next step, should it matter later:** the lift lattice is already coarse (2, not 4). What would help next is caching `decalGroundY` per tile corner, or sampling the ground mesh's own vertices instead of the bicubic.

---

## Retiring the sprite sheets (WP-A3.3, 2026-10-04)

The Pixi backend, the `&nomesh` billboard path and the 43 sheets under
`assets/sprites/` were deleted on `feat/retire-pixi` (GH-189). On the default
path the sheets were no longer drawn by anything a player could see -- every
unit already drew a mesh -- but a mission still FETCHED some after its first
frame: each fielded mesh vehicle's sheet (for a sprite wreck no shipped vehicle
reached any more, since all 18 vehicle GLBs carry a `wreck` clip) and, on a
`resources` mission, every deferred KDF buildable's sheet (a billboard
placeholder until its GLB landed). This measures what that cost.

**Conditions.** `pnpm perf:load -- --mission=<id> --serve=preview --runs=3
--tail=5000`, a production build served by `vite preview` from `dist/`,
headless Chromium with the HTTP cache and the service worker bypassed (a cold
first visit), unthrottled localhost, ANGLE/Metal on an M3 Pro (the harness
prints the renderer). `--tail=5000` keeps counting five seconds past
first-frame -- without it the harness stops at first-frame and every one of
these sheet requests is invisible, which is why it was added. Before: base
`f818eb7b`. After: the branch head. The harness itself had to be fixed first:
it waited for "N / N sheets" and a mesh-only boot reads "meshes only", so on
`main` every run timed out at 180 s without clicking Deploy.

| mission | requests before | requests after | MiB before | MiB after | sheet requests / MiB before | first-frame ms before | after |
|---|---|---|---|---|---|---|---|
| `beit_sahwan_1_recon` | 465 ×3 | 116 ×3 | 29.91 ×3 | 24.08-24.09 | 346 / 5.82 | 2166 / 1397 / 1214 | 1781 / 1472 / 1305 |
| `tel_marum_2_foothold` | 1163 ×3 | 151 ×3 | 42.64 ×3 | 27.29 ×3 | 1009 / 15.33 | 1542 / 1177 / 1198 | 1455 / 1181 / 1316 |
| `wadi_halam_2_laager` | 1300 / 732 / 884 | 172 ×3 | 52.10 / 43.34 / 45.83 | 34.68 ×3 | 1125 / 557 / 709 -- 17.41 / 8.65 / 11.14 | 2002 / 1394 / 1694 | 1619 / 1406 / 1486 |

Reading it:

- **Sheet requests go to zero on every run**, and nothing else moved: meshes are
  57 / 61 / 68 requests and 20.27 / 20.26 / 30.78 MiB before and after.
- **The saving is 5.8 / 15.4 / 11.2-17.4 MiB and 349 / 1,012 / 560-1,128
  requests per mission load.** `wadi_halam_2_laager`'s before-numbers vary
  because its sheets were still loading when the five-second tail closed; the
  run with the longest tail-end read 17.41 MiB of sheets, so the real figure is
  at least that.
- **Time to first frame did not change**, and should not have: every sheet in
  question loaded AFTER the first frame. What the player got back is bandwidth
  and request count in the first seconds of play, not a faster deploy.
- `dist/` went from **195,364 KiB to 120,896 KiB** (-74,468 KiB, -38%): the
  sheets (72 MiB) plus the ten Pixi chunks (592.1 kB raw). The tracked
  `assets/` tree went from 154.2 MiB to 90.4 MiB. Clone size does not shrink
  -- history keeps the PNGs, and rewriting it is not a goal (the plan's risk
  12).

The deferred-buildable option the plan left to the lead (load every buildable
GLB before deploy) was NOT taken: the lead's ruling was to keep them invisible
until their GLB lands, with a "deploying" chip on the dock tile. So
time-to-deploy is unchanged by this work, and the cost of the alternative was
not measured.

**The all-mesh backend curve** (`backend-curve-gate.ts --only=three-mesh`, same
machine, ANGLE/Metal): with every one of the 20 roster types drawing its real
GLB -- where the old "three, meshes" curve swapped a quarter of the roster over
a billboard majority -- render p95 is 10.8 / 17.8 / 30.0 / 39.7 ms at 65 / 143
/ 266 / 320 living units (tick p95 0.30 / 1.20 / 2.20 / 3.40 ms). That is a new
number, not a regression: it is the shipped default since the mesh flip, now
measured for the first time.

## Kitted vehicles (GH-238 plan 3, 2026-10-07)

What bolting a bought kit onto the eight KDF vehicles costs. Spec
`docs/superpowers/specs/2026-10-06-kitted-vehicles.md`, plan
`docs/superpowers/plans/2026-10-07-kitted-vehicles.md` (Task 10). The design
claim is **+0 draw calls**: `applyVehicleKit` merges the bought parts into their
host node's geometry at load, so a kitted hull submits exactly as often as a bare
one.

### Capture conditions

- **One machine**: Apple M3 Pro, macOS, ANGLE Metal (`ANGLE (Apple, ANGLE Metal
  Renderer: Apple M3 Pro, Unspecified Version)`, printed by the tool), real
  hardware and not SwiftShader.
- **Draw calls and triangles**: `tools/src/perf/kit-drawcalls.ts`, run on the
  final art at the tip of the branch (all eight GLBs, as shipped in
  `assets/meshes/vehicles/`, Draco). Twenty clones of one vehicle through the
  SHIPPED `buildVehicleMeshTemplate`, three passes (shadow, main, and the GTAO
  pre-pass's override material), `renderer.info` reset **by hand** around each:
  three r170 resets it after the shadow pass, so the default reading is short
  (with `autoReset` left on, the harness read Lavi 8 and D9 4 and exited 1, which
  is how it was falsified).
- **Sizes** are `wc -c` of the tracked files at the branch tip against
  `origin/main`.

### Draw calls: +0 at every tier

| Vehicle | Submissions/vehicle, tiers 0 | tiers 3 | Live meshes carrying kit at tiers 3 |
|---|---|---|---|
| `mbt_lavi` | 12 | 12 | 3 (`hull_hull`, `turret_hull`, `turret_metal`) |
| `ifv_namer` | 12 | 12 | 2 |
| `apc_eitan` | 12 | 12 | 2 |
| `apc_kipod` | 12 | 12 | 2 |
| `jeep_shoded` | 12 | 12 | 2 |
| `scout_shachaf` | 12 | 12 | 2 |
| `dozer_d9` | 6 | 6 | 1 |
| `heli_peten` | 12 | 12 | 3 |

12 is 4 live meshes x 3 passes; the D9 has 2 meshes, so 6. The harness exits 1 on
any other reading, and on a tiers > 0 reading in which no mesh carries kit (which
would be the bare hull read twice and prove nothing about the merge): run on the
kit-less art of the time it failed, "tiers=3 but no mesh carries kit", where it
had printed PASS.

### Triangles: what the kit adds

Kit triangles at maximum kit (every track at tier 3), and the triangles one
vehicle submits across the shadow and main passes (the kit is in both, so it
counts twice; the AO pre-pass is not in these totals):

| Vehicle | Kit triangles (budget) | shadow + main, tiers 0 | tiers 3 |
|---|---|---|---|
| `mbt_lavi` | 4,740 (4,880; cap 5,000) | 16,692 | 26,172 |
| `ifv_namer` | 3,282 (3,580) | 15,620 | 22,184 |
| `apc_eitan` | 3,266 (3,850) | 15,922 | 22,454 |
| `apc_kipod` | 3,222 (3,590) | 16,104 | 22,548 |
| `jeep_shoded` | 2,264 (2,560) | 87,870 | 92,398 |
| `dozer_d9` | 2,758 (3,360) | 15,802 | 21,318 |
| `scout_shachaf` | 1,906 (2,340) | 10,152 | 13,964 |
| `heli_peten` | 1,434 (1,680) | 82,062 | 84,930 |

Each tiers-3 figure is the tiers-0 figure plus twice the kit triangles. The kit
is a share of what the vehicle already costs, not a new order of magnitude: the
Lavi's grows by 57% (it was a 16,692-triangle model), the jeep's by 5% and the
Peten's by 3.5% (both ship an 80,000-triangle Meshy hull). A mission fields the
tier the player bought, so a bare brigade pays nothing per frame: tiers 0 is the
shipped template, the same geometry objects.

### Encoded size

| Vehicle | `art/meshes/vehicles` | `assets/meshes/vehicles` (Draco) |
|---|---|---|
| `mbt_lavi` | +223,036 B (2,831,440 -> 3,054,476) | +29,584 B, 28.9 KiB (2,487,272 -> 2,516,856) |
| `ifv_namer` | +162,852 B | +21,172 B, 20.7 KiB |
| `apc_eitan` | +170,984 B | +21,548 B, 21.0 KiB |
| `apc_kipod` | +166,524 B | +20,252 B, 19.8 KiB |
| `jeep_shoded` | +105,904 B | +18,268 B, 17.8 KiB |
| `scout_shachaf` | +98,408 B | +16,600 B, 16.2 KiB |
| `dozer_d9` | +142,440 B | +14,408 B, 14.1 KiB |
| `heli_peten` | +67,884 B | +15,612 B, 15.2 KiB |
| **All eight** | **+1,138,032 B (1,111.4 KiB)** | **+157,444 B (153.8 KiB)** |

What a player downloads is the second column: the Draco twin, **+153.8 KiB for all
eight**. The kit is loaded with its vehicle whether or not any of it is bought,
because the merge happens in the browser and the player's tiers can change
between missions. The `art/parts/kit/*.glb` sources (66-217 KiB each, 1.1 MiB for
eight) are build intermediates and are not shipped to the player.

### What was NOT measured

- **The merge itself.** `applyVehicleKit` runs once per vehicle type at template
  build, `mergeGeometries` over the host and its kept parts, and the old
  geometries are disposed. No wall-clock number was taken for it, and no
  frame-cost or boot-time reading was taken with kit bought. The triangle table
  above is the only per-frame evidence.
- **A kitted force at scale.** `backend-curve-gate.ts` was not re-run for this
  work.

### `validate:meshes` gate time

The gate now renders, per kitted vehicle, a maximum-kit render and the twelve
(nine for the D9) variant masks, 101 kit renders in all, and reads the kit
nodes from the bytes. Same machine, wall clock, `pnpm validate:meshes`:

| Reading | Time | Conditions |
|---|---|---|
| before the kit renders | 62.2 s | back to back with the next row, quiet |
| after Task 6 (variants through Workbench) | 69.0 s | back to back, quiet |
| the same, noisy | 112.9 s | load average 21-25 from other work |
| after the review round (masks through the shipped render's own Cycles, 64 samples, so they compare like with like) | 154.9-174.5 s | load average 8-29 |

The eight kitted vehicles alone, at load 15: Workbench 17.1 s, Cycles at 1 sample
17.2 s, **Cycles at 64 samples 64.5 s**. So the Cycles switch is worth about 47 s
of the gate on that machine, bought so the variant masks use the rasteriser every
other mask in the gate was made by (the largest change on any variant against
another unit was 0.0153 IoU with Workbench, 0.0070 at one sample). **There is no
quiet-machine reading of the final gate**: the 154.9-174.5 s range was taken
under load, and the 62-69 s before it is the figure to compare against only
loosely. CI's `gates` job runs it headless on ubuntu with no GPU; its time was
not measured. `export_vehicle_kit.py` over all eight takes about 64-70 s
(63.8 s before the stricter clash check, 69.5 s after).

## Memory (GH-469, 2026-10-08)

The lead: *"I think the game uses a lot of memory on users' computers."* It
does. On the heaviest missions a tab holds **about 3.0-3.2 GB** across
Chromium's processes on a Mac (2.76-2.93 GB under CI's SwiftShader), of which
the game's own JavaScript is **only 119-129 MiB**. The rest is pictures:
**~1 GB of decoded GLB textures in the renderer process, ~0.9 GB of GPU
allocations**, and the GPU process's own overhead on top. Leaving a mission
gives every JS and GL byte back -- after two fixes this work found -- but not
every process byte. Nothing has been optimised yet; the ranked list at the end
is for the lead to pick from.

### The instrument: `pnpm perf:memory`

`tools/src/perf/memory.ts`. ONE browser, ONE page, ONE JS realm: the menu, the
campaign board, the menu again, then each mission booted SOFTLY (an anchor
click the shell's `interceptLinks` turns into a router navigation), played for
120 s of sim time through `__lions.step` in 30 s slices, left through the HUD's
leave button and confirm, and followed back to the menu softly. A hard
`page.goto` between missions would hand every reading a fresh heap and make
the leak check unable to fail.

At every checkpoint, after `Runtime.discardConsoleEntries` and two
`HeapProfiler.collectGarbage`s:

| reading | source | what it is |
|---|---|---|
| **JS** | CDP `Runtime.getHeapUsage` | V8's used heap **plus `backingStorageSize`** -- the ArrayBuffer backing stores, which `JSHeapUsedSize` / `performance.memory` do NOT include. Every geometry array, Draco-decoded buffer and sim component lives there; at a mission it is two thirds of the JS total. |
| **GPU** | a GL-call ledger (`memory-ledger.ts`, an `addInitScript`) | every byte the page ASKS WebGL for -- `texImage2D`/`texStorage2D`/`texImage3D`/compressed textures with their mip chains, `bufferData`, renderbuffer storage x samples -- per context, live contexts only, plus an ESTIMATE of each default framebuffer. Logical bytes, not driver bytes, so it reads the same on every machine (Metal and SwiftShader agree to 0.1 MiB). `renderer.info.memory` is two counts and sees one renderer; the ledger sees the menu's scene host and the board too. |
| **process** | CDP `SystemInfo.getProcessInfo` pids | every Chromium process: `phys_footprint` on macOS (`footprint`, Activity Monitor's Memory column, which counts Metal allocations in the GPU process), PSS on Linux (`/proc/<pid>/smaps_rollup`). |
| **bitmaps** | the ledger wraps `createImageBitmap` | every decoded ImageBitmap still reachable, uploaded or not, at 4 B/px |
| DOM | `Memory.getDOMCounters` | nodes, JS event listeners -- the leak tell |
| attribution | `ThreeRenderer.debugMemoryInventory()` (new, debug-only, not on `api.ts`) | scene and mesh-template bytes by owner, each geometry and texture `Source` counted once |

`performance.measureUserAgentSpecificMemory()` is **not available**: it needs
a cross-origin-isolated page (COOP + COEP), which neither the dev server nor
the Worker sends. The reading says so rather than going missing.

Flags: `--missions=a,b`, `--play-s`, `--slice-s`, `--viewport=WxH`, `--dpr`,
`--serve=dev|preview`, `--gpu=metal|swiftshader`, `--port`, `--out`, `--gate`.
Exit codes: **0** report or every budget met, **1 over budget** (or a leak
check failed), **2 the instrument failed** (bad argument, a boot that never
finished, a readback that came back empty), **3** `--gate` with no budget for
this capture environment.

**Which missions.** All 27 missions are played on 48x48 maps, so map size separates nothing. The
default three are the top three of 27 by the GLB payload their roster,
structures and decor plan (`meshPlanFor`): `qarn_hadid_3_clearance` 26.0 MiB on
disk / 58 GLBs / 33 placed units, `umm_zeitoun_4_clearance` 24.5 / 59 / 39,
`khan_rafid_3_clearance` 24.4 / 52 / 41 (the most unit types, 19).
`beit_sahwan_3_clearance` ties the second on bytes (24.5) with fewer units;
`beit_sahwan_breach` fields the most units (53) on a light payload (17.0) --
GPU memory follows textures, not unit count, below.

### Readings

**Conditions, local:** M3 Pro, ANGLE/Metal (hardware, read back from
`WEBGL_debug_renderer_info`), headless Chromium, 1400x900 @1x, dev server,
machine shared with other sessions, **n=4** walks (three with 10 s play slices,
one with 30 s; every checkpoint of the fourth within 1% of the first three's range).
MiB throughout.

| checkpoint | JS heap | + ArrayBuffers | = JS | GPU ledger | process total | renderer proc | GPU proc | DOM nodes |
|---|---|---|---|---|---|---|---|---|
| menu | 20.9-21.3 | 33.7 | 54.6-55.1 | 522.1 | 1,434-1,474 | 424-440 | 929-953 | 230 |
| board | 17.7 | 14.2 | 31.8 | 138.2 | 611-649 | 268-283 | 259-283 | 326 |
| menu (again, after the board) | 21.6-22.1 | 33.8 | 55.5-55.9 | 522.1 | 1,522-1,569 | 467-487 | 968-1,000 | 230 |
| mission qarn_hadid_3_clearance | 42.6-43.3 | 84.9 | 127.5-128.2 | 882.2 | 2,986-3,050 | 1,467-1,488 | 1,419-1,461 | 1,068-1,093 |
| menu after qarn_hadid_3_clearance | 25.7-26.2 | 34.5 | 60.1-60.6 | 522.1 | 1,748-1,797 | 620-637 | 1,027-1,059 | 230 |
| mission umm_zeitoun_4_clearance | 42.3-43.2 | 85.6 | 127.9-128.9 | 880.5 | 3,157-3,207 | 1,594-1,614 | 1,460-1,497 | 937-951 |
| menu after umm_zeitoun_4_clearance | 26.6-27.4 | 34.5 | 61.1-61.8 | 522.1 | 1,833-1,878 | 669-686 | 1,054-1,087 | 230 |
| mission khan_rafid_3_clearance | 42.4-43.6 | 81.7 | 124.1-125.3 | 847.3 | 3,049-3,118 | 1,483-1,506 | 1,457-1,514 | 935-962 |
| menu after khan_rafid_3_clearance | 27.5-28.1 | 34.5 | 61.9-62.6 | 522.1 | 1,893-1,935 | 675-691 | 1,112-1,139 | 230 |

**Conditions, CI:** `ubuntu-latest`, SwiftShader (software; the GPU ledger is
the same bytes, the process total is not), 1400x900 @1x, dev server, **n=4** walks on four runners (run 37826952688: the `memory` job and three temporary `memory-calibrate` runners), 30 s play slices. A fifth walk with 10 s slices (run 37820472000) read inside these ranges but for one mission process total of 2,947. **Walk time on CI: 428 / 676 / 753 / 768 s** -- one runner much faster than the other three, cause not established; with 10 s slices it was 917 s.

| checkpoint | JS | GPU ledger | process total | DOM nodes |
|---|---|---|---|---|
| menu | 54.3-54.8 | 522.1 | 1,297-1,330 | 230 |
| board | 31.9 | 138.3 | 709-751 | 326 |
| menu (again, after the board) | 54.9-55.4 | 522.1 | 1,360-1,404 | 230 |
| mission qarn_hadid_3_clearance | 122.3-122.5 | 882.2 | 2,756-2,800 | 943 |
| menu after qarn_hadid_3_clearance | 58.1-58.5 | 522.1 | 1,506-1,521 | 230 |
| mission umm_zeitoun_4_clearance | 124.4-125.2 | 880.5 | 2,901-2,927 | 937-978 |
| menu after umm_zeitoun_4_clearance | 59.0-59.2 | 522.1 | 1,549-1,576 | 230 |
| mission khan_rafid_3_clearance | 118.9-119.9 | 847.3 | 2,769-2,788 | 933-974 |
| menu after khan_rafid_3_clearance | 59.3-59.7 | 522.1 | 1,579-1,636 | 230 |

Two more conditions, n=1 each, Metal:

- **Retina** (`--viewport=1440x900 --dpr=2`, `qarn_hadid_3_clearance`): the
  menu's GPU ledger goes 522 -> **870 MiB**, the mission's 882 -> **1,215 MiB**,
  process 3.0 -> **3.5 GB**. Every full-screen target scales with
  width x height x dpr^2 (`PIXEL_RATIO_CAP` is 2); the default framebuffer
  estimate alone goes 48 -> 198 MiB. A Mac laptop is this case, not the 1x one.
- **The production build** (`pnpm build`, `--serve=preview`): JS is 18-20 MiB
  LOWER than dev at every checkpoint (menu 35.4, missions 103.9-108.3, after
  leave 41.0-42.5), the GPU ledger is identical to the byte, and the process
  total is 0.2-0.3 GB HIGHER (missions 3.33-3.51 GB; renderer +220, browser
  +60). The higher process figure was not chased; the service worker and the
  HTTP cache are the obvious suspects.

### What leaving gives back

**JS and GL, all of it -- after two fixes.** The first walk read every left
mission STILL IN THE HEAP after a forced GC: +15-25 MiB of JS, ~750 DOM nodes
and one lost-but-reachable WebGL context per mission, accumulating. A heap
snapshot after the leave traced two retainer chains, neither visible to
`pnpm ui:routes` (which checks body children, `__lions` and the frozen tick --
all of which passed):

1. **The harness.** `dismissDeployGate` (`golden-diff/capture-guard.ts`) kept
   the ElementHandle `waitForSelector` returned. An undisposed Playwright
   handle is a DevTools global handle: it kept the deploy button, its click
   listener, and through that closure the sim, renderer and runtime alive for
   the life of the realm. Disposed now. Every harness that uses it was
   measuring a heap with a battlefield in it.
2. **The game.** `Hud.destroy()` cleared neither the feed rows' 7-12 s dwell
   timers nor the commander bar's beat-fold timer. Each closes over the HUD,
   which holds the sim, the renderer and the runtime, so the last-left
   battlefield stayed reachable until its last timer fired -- a whole mission's
   JS held through the next mission's boot. Cleared in `destroy()` now, under
   the disposer contract; `hud.test.ts` pins it.

After both, over **eight** consecutive mission visits in one realm (Metal,
30 s of play each): DOM nodes return to the menu's 230 every time, listeners
to 58 (the menu's 45 + 13 registered once by the first mission's modules, flat
after), no released context stays reachable, the GPU ledger returns to 522.1
exactly, and JS plateaus at **+8 MiB** over the first menu (60-63 vs 55: the
mission chunks' code, flat from the third visit).

**The process total does NOT come back, and it is not a leak.** After one
mission it sits +0.3 GB over the first menu, after three +0.45 GB, and over
eight visits it plateaus at **1.83-1.93 GB against 1.47** -- with JS and GL
flat underneath it. The growth is in the renderer and GPU processes' own
allocators and caches (Chromium's allocator does not return freed pages
promptly; ANGLE and the shader cache keep what they built). That is why the
leak checks below read JS and GL, never the process total.

### Where it goes (attribution)

`qarn_hadid_3_clearance` at 120 s, Metal, 1400x900 @1x, n=1 (the other two
missions are within 9% on every row):

| consumer | MiB | where | notes |
|---|---|---|---|
| **Decoded GLB textures (ImageBitmaps)** | **972** (70 bitmaps) | renderer process, CPU | GLTFLoader decodes every texture of every loaded GLB. **440 MiB** (30) are the CPU copies of textures also on the GPU; **532 MiB** (40) belong to templates never drawn -- building wrecks, buildables not yet fielded -- and were never uploaded at all. Menu: 184 MiB (12). |
| **GLB textures on the GPU** | **587** (30) | GPU | almost all 2048x2048 RGBA8 at 21.3 MiB each with mips: building facades, vehicle and infantry bakes (base colour, normal, metal/rough). Menu: 245 (12). |
| **Shadow map** | **128** | GPU | 4096x4096: a 64 MiB colour target AND a 64 MiB DEPTH24 renderbuffer. Same on the menu. |
| Screen-sized targets | ~41 + 48 est. | GPU | four 1400x900 composer/AO/SMAA targets (38.5) and two half-size depth renderbuffers (2.4), plus the ESTIMATED default framebuffer (`antialias: true`, 4x MSAA) at 48. About x4 at dpr 2. |
| JS heap | 43 | JS | |
| ArrayBuffers | 85 | JS | scene geometry 43, mesh templates 19 (the same arrays are also on the GPU: buffers 31.5 MiB) |
| Ground | ~28 tex + 4.6 geo | GPU | five 1024x1024 tile JPGs at 5.3 each with mips, control maps A/B at 0.75 each, the macro field |
| Decals | 1.7 geo + 0.8 tex | GPU + JS | both pools at full size, preallocated |
| Decoded audio | 0-16 | renderer | 0 at the first mission's reading, 16.1 (53 buffers) at the second and third; 8.8 stays decoded after a leave |
| Flow-field pool | < 0.1 | JS | 0-4 fields x 11.5 KB at this point in these missions |
| **The menu's scene host** | GPU **522**, bitmaps 184, process **1.43-1.46 GB** | all | the live diorama behind the menu costs 2.3x the campaign board (GPU 138, process 0.61-0.65 GB) |

### Ranked optimisation candidates (the lead picked 1, 2 and 4 -- shipped, see "The three savings" below)

Savings are at the heaviest mission unless stated, Metal 1x; "process" is
what a player's Activity Monitor would show.

| # | candidate | saves (estimate) | risk | effort |
|---|---|---|---|---|
| 1 | **Close each texture's ImageBitmap once it is on the GPU** (`texture.image.close()` after the first upload; three keeps `texture.image` forever) | ~440 MiB process at a mission, ~185 at the menu | medium: anything that re-uploads (a `needsUpdate`, a context restore, a template cloned into a second renderer such as the garage viewer) would upload a closed bitmap | S |
| 2 | **Do not decode textures nobody draws**: load building wrecks and unfielded buildables' GLBs on first use, or close their bitmaps and re-decode on demand | ~530 MiB process | medium: a first-wreck or first-build hitch; the wreck swap is under a shroud today | M |
| 3 | **Halve GLB texture resolution in `encode:meshes`** (2048 -> 1024; the `art/` sources untouched) | GPU ~440 MiB, bitmaps ~730 MiB, menu ~185 + ~140 (not additive with 1 and 2: it shrinks what they free) | visual: a unit is 25-60 px on screen, but the garage viewer and the 600 px unit plates read the same GLBs; "models at max detail" means this is the lead's call. KTX2/Basis (GPU-compressed, keeps 2048) is the higher-effort variant with no CPU copy at all | M (L for KTX2) |
| 4 | **A lighter menu scene host** (its own quality preset: 2048 shadow, no AO/SMAA, smaller textures -- or the plate by default) | up to ~0.8 GB process at the menu (the plate; the menu reads 1.43-1.47 GB, the board 0.61-0.65) | design: the live diorama was the lead's choice | S-M |
| 5 | **Shadow map 4096 -> 2048 at `high`** | 96 MiB GPU, menu and mission alike | visual: softer shadow edges (`medium` already does this) | XS |
| 6 | `antialias: false` on the context (the composer's SMAA already antialiases) | ~34 MiB at 1x, ~140 at dpr 2 (the ledger's framebuffer estimate) | low; costs 0.5 ms p95 to keep (see above) | XS |
| 7 | Drop geometry arrays from the JS heap after upload (`onUploadCallback`) | ~40-60 MiB JS | high: picking, bounds and cloning read those arrays | M |

Candidates 1 and 2 are invisible on screen and together are about **a third
of the process total**. 3 is the largest single lever and the only one that
needs an art decision.

### The CI gate

A `memory` job in `ci.yml` runs `pnpm perf:memory -- --gate` on every PR and
push to main, on its own dev server (:5179), and uploads the walk's JSON as
the `memory-output` artifact. Budgets live in `tools/src/perf/memory-budgets.ts`,
keyed by capture environment like the visual gate's baselines -- a missing
environment is exit 3, never a pass -- and are the largest CI reading of each
kind x a margin: **JS x1.25, GPU ledger x1.15, process x1.25**, rounded up.
The ledger gets the smallest margin because it does not move run to run.

| environment | kind | JS (MiB) | GPU ledger | process | leak: JS over first menu | GPU over first menu | DOM nodes over | released contexts reachable |
|---|---|---|---|---|---|---|---|---|
| `linux-x64-swiftshader` (CI, n=4) | menu (and every menu after a leave) | 75 | 601 | 2,046 | +20% (measured <= +9.8%) | +2% (measured +0.0%) | 50 (measured 0) | 0 (measured 0) |
| | board | 40 | 159 | 939 | | | | |
| | mission | 157 | 1,015 | 3,659 | | | | |
| `darwin-arm64-metal` (local only, n=4) | menu | 79 | 601 | 2,419 | +30% (measured <= +14.6%) | +2% | 50 | 0 |
| | board | 40 | 159 | 812 | | | | |
| | mission | 162 | 1,015 | 4,010 | | | | |

The leak percentages are about twice the largest measured, rounded up to 5.
**What they can resolve:** at +20% of a 54 MiB menu, a leak smaller than
~11 MiB of JS passes the JS check -- a retained `Sim` alone (a few MiB) would.
The DOM-node and released-context checks are exact, so anything that holds a
left screen's DOM or its renderer fails regardless of size.

It runs as its OWN job, `memory`, beside `visual` rather than as a step in
it, which is where it started: as a step it measured 917 s on top of a job
already 35-40 minutes long. Beside it, it adds nothing to a PR's wall clock.

**Falsified, red first.** Two one-line mutations of `packages/app/src/main.ts`
(`bootBattlefield`, beside the `__lions` registration), each run and reverted:

| mutation | CI (`linux-x64-swiftshader`, run 37829076706, the temporary `memory-falsify` jobs) | local (`darwin-arm64-metal`) |
|---|---|---|
| none -- the `memory` job, same run | **exit 0**, every budget met (walk 451 s) | exit 0 |
| `window.__rlProbe = new Uint8Array(200 * 1048576).fill(1)` -- a retained 200 MiB allocation | **exit 1**, 9 checks over: every mission JS 318.9-324.6 MiB against 157, every after-leave menu 258.3-259.5 against 75 and +375-377% against +20% | exit 1, 9 over |
| `window.addEventListener('rl-probe', () => void renderer)` -- a listener holding a mission object | **exit 1**, 13 checks over: after each leave 1 / 2 / 3 released contexts still reachable, 989 / 1,742 / 2,491 DOM nodes against 230, JS +44 / +81 / +111%, and the third mission's JS 158.7 against 157 | exit 1, 10 over (before the DOM check existed) |

Both mutations are reverted (they were applied inside the CI job only, never
committed). Neither moved the process total past its ceiling: +200 MiB is
inside a 25% margin on 2.9 GB, which is why the process check is a backstop
and the JS, ledger, DOM and context checks are the ones that resolve.
A mission that never boots exits **2**, not 1 (`--missions=no_such_mission`,
locally: the deploy gate's 240 s guard).

`memory-budgets.test.ts` falsifies the judge itself (each leak check and each
ceiling forced to pass, a walk with no baseline passed: all red);
`memory-ledger.test.ts` runs the shipped init-script string in a `vm` against a
fake WebGL2 prototype (five mutations, all red); `memory-inventory.test.ts`
(three, all red).

### The three savings (2026-10-09)

The lead picked candidates 1, 2 and 4. They shipped as three PRs, each
re-measured and each locking its saving into the budgets:

- **#478, free each GLB texture's CPU copy after upload.** A loader plugin
  closes the `ImageBitmap` from three's own after-upload callback.
  Invisible: every gated scenario 0 px.
- **#479, don't decode what nobody draws.** Building wrecks and unordered
  KDF buildables load through `coldGltfLoader`, with their images kept
  encoded. A wreck decodes on the first hit to its type; a buildable decodes
  on the order, at least 12 s before the unit exists. A template that is
  still cold is never drawn: a wreck keeps its standing clone under the
  collapse cloud until it decodes, and a unit is not instantiated until
  then. An outright kill swapped to a textured wreck at 465 ms against
  main's 460. Invisible: 0 px.
- **#480, a lighter live menu backdrop.** Quality is capped at `medium`,
  `maxPixelRatio` is 1 and `maxTextureSize` is 1024. It is softer at dpr 2
  and loses ambient occlusion. The lead approved it from before/after
  captures ("Ship it").

**Combined before/after.** MiB. Metal is M3 Pro, 1400x900 @1x, dev
server, n=3 each: main is `6cdfb8d9`, after is #480's branch with
#478 and #479 merged in. CI is ubuntu-latest SwiftShader: main from #474
(n=4), after n=1 (run 37880172368; the 40-minute bound on this round left no room for reruns; the commit that sets these budgets is the second CI walk of this tree).

| reading | Metal main | Metal after | CI main | CI after |
|---|---|---|---|---|
| menu, all Chromium processes | 1,431-1,440 | 921-929 | 1,297-1,330 | 861-889 |
| menu, GPU ledger | 522 | 231 | 522 | 231 |
| heaviest missions, all processes | 2,997-3,141 | 2,102-2,303 | 2,756-2,927 | 1,859-2,011 |
| heaviest missions, decoded bitmaps | 888-1,004 | 48-140 | 888-1,004 | 48-140 |
| menu after a leave, all processes | 1,734-1,905 | 1,240-1,394 | 1,506-1,636 | 1,043-1,125 |
| board, all processes | 607-612 | 528-530 | 709-751 | 661 |
| JS (heap + ArrayBuffers), any checkpoint | unchanged | unchanged | unchanged | unchanged |

A retina screen (1440x900 @2, menu only, n=1) goes 1,858-1,882 ->
979-990. The plate fallback (0.24 GB) was measured and not taken. The plate
image itself is stale and needs `pnpm plate:host` before it is ever made
the default.

**Why the bitmap ceiling exists.** A 1.25 margin on the process total is
wider than any one saving: main's mission total fit under #478's own
re-derived ceiling. The ledger's decoded-bitmap reading is logical bytes,
identical on CI and Metal, so it got a x1.15 ceiling of its own
(`bitmapsMiB`). Reverting #478 reads 488-552 at the missions and
reverting #479 reads 500-564, against a ceiling of 161; both fail. #480 is
locked by the menu's GPU ledger, 231 x 1.15 = 266 against main's 522
(reverted on Metal: exit 1, every menu reading 522.1 > 266). The visual
gate's menu-scene-host votes still pass with the lighter backdrop: path
`live` in 1809 ms, contribution 105.2485 over the flanks (floor 30.4426,
main 104.5415), register dY 2.2% / dS 0.2% against the mission frame
(tolerance 10%; main 1.5% / 0.7%).

**Two things found on the way.**

- **#479's first cut leaked memory.** It read +30 MiB of ArrayBuffers: a
  closure created inside the loader plugin captured the GLTF parser, and
  with it every cold GLB's whole body. `coldTexture` is module-scope for
  that reason.
- **The GPU ledger is not perfectly deterministic.** `khan_rafid_3`
  read 806 instead of 848 in a few walks, on main and on the branches
  alike: two 2048 textures not yet uploaded at the read, depending on
  what fog had let draw. The 1.15 margin covers it. "Same bytes every run"
  above holds for the menu and board, and for missions only to within
  that.

### What this does not measure

- **A real player's process total.** Headless Chromium, one tab, no
  extensions; a real browser adds its own processes, and a retina screen
  multiplies every full-screen target (above). The gate's process ceiling is
  a regression fence, not a player number.
- **Driver bytes.** The ledger counts what the game asked for. Metal's GPU
  process reads 0.41-0.43 GB above the ledger at the menu and 0.55-0.65 GB
  above it at a mission.
- **Peak during load.** Every reading is after a settle and a forced GC; the
  transient peak while GLBs decode and upload was not sampled.
- **Missions longer than 2 minutes, or the other 24.** `--missions=` reaches
  any of them.

## A collapse splices the terrain; static upkeep once per view (2026-10-10)

The fixes ranked 1-3 in the low-end assessment (PR #507, "Low-end": a
building collapse was the only stutter, 141-175 ms unthrottled and 499-643 ms
at 4x CPU, all of it a full `rebuildTerrain`).

**What changed.**

- **The collapse is a splice** (`terrain/tiled-mesh.ts`, `terrain/incremental.ts`).
  `buildGround`/`buildScatter` are tile emitters that record where each tile's
  vertices and indices start; a rebuild diffs the new draw mask, cover, terrace
  flag and smooth-field source against the last build, re-emits the changed
  tiles grown by `SPLICE_RADIUS_TILES` = 2 (Catmull-Rom's support), and copies
  the rest with their indices shifted. The control map rewrites in place only
  the texels within `CONTROL_SPLICE_MARGIN_TEXELS` = 4 of a changed tile
  (0.2 tile of edge bend + 0.25 of band = 0.45 tile); a road or ridge tile
  changing builds it whole. **Byte-identical to a full build**: swept once over
  every structure of every shipped map, 1,724 single collapses, 0 differences;
  one tile narrower differs on 13 relief maps and one texel narrower on 25 maps,
  so both margins are tight. `packages/app/src/terrain-splice.test.ts` keeps
  chains of real collapses equal to full builds and one witness per margin.
- Two costs that only showed once the splice removed the bulk: `toGeometry`'s
  `Math.pow` sRGB decode (a byte table now, same bits, ~12 ms at 4x off a
  collapse), and a **shader compile**: disposing the replaced decor and prop
  batches' materials before the new ones drew released their program, and the
  new batch recompiled it (38 ms in `getProgramInfoLog` at 4x). They are
  disposed after the next draw now.
- **Decor and prop batches cull and sort once per view** (`terrain/batch-cull.ts`):
  the draw list is kept per camera matrices, so the AO pre-pass reuses the main
  pass's and the fixed shadow box reuses its own, frame to frame.
- **Static objects stop recomposing matrices** (`static-matrix.ts`): the scene no
  longer forces a multiply onto every child, and terrain, structure boxes, decor,
  props, standing buildings and settled wrecks are frozen where they are built.

**Measured** with PR #507's `low-end.ts` harness (copied in, unchanged but for
its imports), production build, Apple M3 Pro, Metal, headless Chromium,
1366x768 @1x, `high`, `umm_zeitoun_4_clearance`, music off. Base is `origin/main`
97e8e5f5 from its own worktree, interleaved run by run with this branch. **The
machine was shared and loaded** (1-minute load 6-20, against 2-3 for PR #507's
matrix) and the display ran at 120 Hz in some runs, so frame-interval
percentiles are noisier than #507's; the collapse task and render submit are
the robust readings.

| | base | this branch |
|---|---|---|
| collapse long task, 4x CPU | 531-583 ms (n=3, load ~3); 602-726 ms (n=5, load 8-17) | 95-178 ms (n=5, load 6-17; 95-103 at load <= 12) |
| collapse long task, 1x | 163-172 ms (n=3, load ~3); 167-228 (n=3, load 9-15) | none over 50 ms (n=2, load 6-11); 104 ms (n=1, load 20) |
| render submit p50, 4x, fight | 25.3-28.8 ms, mean 26.5 (n=4) | 22.4-26.9, mean 24.5 (n=4) |
| render submit p50, 4x, pan | 21.2-24.8, mean 22.9 (n=4) | 19.4-23.7, mean 21.2 (n=4) |
| render submit p50, 4x, opening | 21.0-24.0, mean 22.4 (n=4) | 18.1-21.9, mean 19.9 (n=4) |
| draw calls at the fight | 769-783 | 769-771 |

What is left in the 4x collapse frame (profiled, dev server): ~25 ms in
`rebuildTerrain` (decor and prop placements recomputed whole, ~6 ms; the
splices ~5; `toGeometry` ~5; the decor batches rebuilt ~5), the next draw's
uploads, and the sim's own `recomputeFields` (~9-19 ms at 4x, sim side, out of
scope). The decor placements are not spliced: the clump rule drops members by
the tile they land on, so a splice would need `decor-place.ts` restructured for
~1 ms unthrottled.
