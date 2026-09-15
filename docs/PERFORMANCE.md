# Performance — both renderer backends, and sim tick cost

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
devDependency — the same one `tools/src/ci/golden-diff-gate.ts` uses) through
four measurement functions exported by `tools/src/perf/three-units.ts`:
`measurePixi`, `measureThree`, `measureThreeMesh` (added this session — see
below), and `measureSkinnedInfantry`. Each runs in its own fresh page
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

### Pixi (billboards only, as shipped)

| target | living | tick avg | tick p95 | render avg | render p95 | render max |
|---|---|---|---|---|---|---|
| 65  | 65  | 0.15 | 0.40 | 1.22–1.34 | 4.10–4.70 | 5.5–7.2 |
| 150 | 143 | 0.55 | 1.00 | 1.69–1.93 | 3.70–4.00 | 5.4–8.0 |
| 300 | 266 | 1.61 | 1.90 | 2.26–2.58 | 4.40 | 6.7–7.4 |
| 400 | 320 | 2.38 | 3.70 | 2.33–2.66 | 4.40–5.00 | 6.7–8.9 |

### Three, billboards only (`measureThree` — same roster, no `&mesh`)

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

## What mesh units cost against billboards

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
(2026-08-30, same machine, same harness, same checkpoints): 1.90–2.00 p95 at
the 300 checkpoint and 2.10–2.20 at 400. So the lit renderer costs **3.4× at
300 living-266 and 3.6× at 400 living-320** on this curve — the shadow map's
re-submission of every caster plus GTAO's normal pre-pass plus four composer
passes, which is exactly the tripling the review predicted — and it still
clears the budget by **2.5×** at the GDD target. **No ladder rung was taken.**
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
