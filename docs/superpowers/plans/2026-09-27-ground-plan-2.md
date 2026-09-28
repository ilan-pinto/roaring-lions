# The Ground, Plan 2: Scatter, Props, Trees, Haze and Time of Day (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ground read as a place. Grass and sand gather in clumps at about 0.9 objects an open tile instead of 0.27 spread evenly; the flat grain loses its discs and half its flecks; seven Blender-built props (ART_PIPELINE §6) stand in yards and along roads in one batch; the desert tree gets a real crown and the olive drops to a quarter of its triangles at export (D8); every crown sways on the sim clock; dust hazes the far side of the frame; and a mission's `time_of_day` finally lights the map as dawn, day or dusk. Every new draw layer gets a toggle check that can fail, and the costs are measured against the 300-unit harness and the acceptance views before anything is blessed.

**Architecture:** Most of the work is pure, three-free maths in `packages/render/src/three/terrain/` and `packages/render/src/three/`:
- `terrain/decor-place.ts` gains the cluster rule and the density dial.
- `terrain/prop-place.ts` (new) decides where props go; `terrain/prop-role.ts` (new) is their closed role vocabulary and ramps.
- `terrain/sway.ts` (new) is the sway maths and its GLSL, on the sim clock.
- `haze.ts` and `time-of-day.ts` (new) are the haze curve and the preset table.

The GPU halves are small: `terrain/prop-mesh.ts` builds one `BatchedMesh` with a baked vertex colour; `decor-mesh.ts` gives the foliage batch a swaying material; `fog-pass.ts` gains the haze term (the pass already rebuilds world position from depth); `lighting.ts` takes a preset. `ThreeRenderer` wires them. The Blender side is `tools/terrain/props.py` (new) and `tools/terrain/export_meshy_decor.py` (crowns and the olive LOD).

**Tech Stack:** TypeScript strict, three.js r170 (under `packages/render/src/three/**` only), vitest (node), Vite, Playwright (tools only), Blender 5.2 headless for Tasks 3 and 6. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-ground-design.md`. It is binding. Its §5 table and D8 were approved by the lead on 25 Sep; D1–D7 and D9–D11 take the spec's recommended defaults. This plan covers §3.4 (scatter), §3.5 (trees), §3.6 (haze and time of day), the plan-2 column of §4, and §7's plan-2 tasks 1–11. Package: **WP-A2 (#182), plan 2 of 2.** One branch (`feat/ground-plan2`), one landing, one bless.

**Plan 1 is the format and the precedent.** `docs/superpowers/plans/2026-09-25-ground-plan-1.md`, its Deviations (spec §9) and `docs/PERFORMANCE.md` "The ground, plan 1 (WP-A2)" are read before Task 1. Plan 1's instruments are reused as they are: `pnpm ground:capture`, `render-frame-cost.ts`, `backend-curve-gate.ts`, the A/B script `.superpowers/ground/ab.ts`.

**Status at writing (2026-09-27).** The branch is `feat/ground-plan2` from `origin/main` `b6497c12`. Plan 1 landed as PR #249 (`2eadc0b0`); bless 1 is `165eb966` (`linux-x64-swiftshader`, all 22 layer checks PASS, `aftermath` blessed). S3g plan 2 has landed too (#255), so the spec's §7 order (A2 plan 1 → S3g plan 2 → A2 plan 2) is satisfied. Every `file:line` below was taken at `b6497c12`. **Re-grep before editing:** `ThreeRenderer.ts` is 8,918 lines and moves under every lane.

**Execution timing.**
- `ThreeRenderer.ts` admits one lane at a time. If another branch holds it when Task 5, 7, 8 or 9 is reached, stop and wait. Do not edit around it.
- **Nothing renders before the lead approves the numbers table below** (Task 0). Blender (Tasks 3 and 6) waits for the same word.

## Global Constraints

These are copied from the spec, plan 1 and CLAUDE.md, and bind every task.

**Sim, lane and imports**
- **The sim is untouched.** `/usr/bin/git diff --stat b6497c12..HEAD -- packages/sim` is **empty** at every commit.
  - `time_of_day` is NOT added to `packages/sim/src/mission.ts`'s `map` type (R-12): the app reads it off the mission JSON through a narrow validating reader.
  - The renderer reads `sim.tickCount` read-only for the sway clock, as the decals already do (invariant 4).
  - `pnpm test:determinism` runs in Tasks 0 and 12.
- **One lane on `ThreeRenderer.ts`.** Tasks 5, 7, 8 and 9 edit it, in that order. They are the **opus** tasks.
- **`three` only under `packages/render/src/three/**`.**
  - `decor-place.ts`, `prop-place.ts`, `prop-role.ts`, `sway.ts`, `haze.ts` and `time-of-day.ts` import nothing from `three`. The four under `terrain/` are exported through the pure `terrain/index.ts` barrel (`@lions/render/terrain`). `haze.ts` and `time-of-day.ts` sit beside `fog-pass.ts` and `lighting.ts`, outside the barrel; the app reaches `TimeOfDay` only as a type, through `api.ts`.
  - `prop-mesh.ts` imports `three` and is not barrel-exported.

**Colour, order and time**
- **The colour pipeline is not the default one** (`palette-material.ts`).
  - Every colour uniform is `hexToLinear` of a hex resolved through `this.overlayColor(key, fallback)`, never `hexToUnit` and never a bare literal outside those fallbacks. Light colours go through `new THREE.Color(hex)`, as `lighting.ts` already does.
  - A prop's baked vertex colour is `new THREE.Color(liftTone(ramp))` for its role, which is linear under three's colour management: exactly the albedo `rampMaterial` gives decor. It is computed at load, never stored as a hex in a GLB (R-6).
- **`units/render-order.ts` is untouched.** Props, crowns and haze are opaque geometry or a post pass; none needs a band.
- **Sim time for sway.** The sway clock is `presentationSimMs(sim.tickCount, alpha) / 1000` (`decal-maths.ts:209`). It is never accumulated `dtMs`, so a gate capture at a pinned tick repeats and `REPAINT_SCRIPT`'s `frame(1, 0)` moves nothing. The retired `windClockMs` was wall-clock and goes with the dead grove path (Task 7).
- **`day` is byte-identical to today's lights** (spec §3.6). Task 8 pins it with a test that compares bits, not a tolerance.

**The visual gate**
- **The visual gate is blessed, never widened.**
  - Every new check's floor is **one third of the smallest of three consecutive runs**, on both metrics, rounded down. The three readings go in its `rationale`.
  - An existing floor that a change drives below its value is **a finding: stop and report it.** It is never a number to lower. The one exception is pre-approved by name in the numbers table (row N-7, the scatter floors after D9), and even that one is re-derived by the same rule and shown to the lead.
- **Bless only from CI numbers, only after merge.**
  - The local `darwin-arm64-swiftshader` baseline is stale (since 2026-09-03). Locally, every scenario is judged by an **A/B against untouched main's captures** (Task 0) with `computeDiff`, and by the layer checks, which need no baseline.
  - The real bless happens **once**, after the lead merges, through `visual-baseline-bless` on `main`, from the `visual` job's `linux-x64-swiftshader` numbers (Task 12). Never `pnpm golden-baseline:bless` locally.
  - **Every gated scenario moves in this plan** (`quiet`, `open-ground`, `vehicle`, `relief`, `aftermath`), so bless 2 is planned from the start: Task 12 lists what moves each one and why.
- **Every check gets an input that makes it fail, constructed and run.** Each task's last step names the mutation. The commit body says it was seen red, then reverted.
- **A new world-space overlay is mocked before it is built.** Plan 2 adds no HUD-like world overlay. The haze is the one frame-wide tint laid over the world, so it is treated as one: Task 0 mocks it on main's own captures and the lead sees the mock before Task 9 builds it.

**Costs, ports and processes**
- **Costs are measured, not asserted, with sample size and capture conditions beside every number** (GPU string, DPR, viewport, n, interleaving). "A range with no sample size beside it is an anecdote" (CLAUDE.md).
- **Budgets** (spec §2 and §8, less what plan 1 spent):
  - **Draw calls: +3 planned (the props batch × shadow, AO, main), cap +6 across both plans.** Plan 1 spent +0.
  - **p95: ≤ +0.74 ms at any acceptance view** — spec §2's +1.5 ms cap less plan 1's +0.76 at `qarn_hadid` z1.6.
  - **`qarn_hadid` z1.6 already reads 14.86 ms gpu p95 against the 14.5 ms ceiling the lead accepted** (PERFORMANCE.md, fix wave, n = 5). Plan 2 must not make it worse without saying so: an after-mean above the before-mean + 0.20 ms (n = 5 interleaved per tree) is a **stop**, reported with the shed ladder already measured (row N-22).
  - `perf:units` at 300 figures **≤ 7.5 ms p95** (7.30–7.60 today), re-run **after the scatter** (Task 5 Step 7) and at the end (Task 12).
  - Every acceptance view ≤ 14.5 ms p95, with the two pre-existing `qarn_hadid` misses named, not hidden.
- **Ports 5193–5199 for every tool run**, as plan 1:

  | Port | Tool |
  |---|---|
  | 5195 | `golden-baseline` |
  | 5196 | `ground:capture` |
  | 5197 | the dev server `render-frame-cost` reads |
  | 5198 | `backend-curve-gate` (`perf:units` to 300) |
  | 5199 | `blast:capture` |
  | 5193, 5194 | spare |

  - A tool that says it is *reusing* a server on its port has found another session's tree: stop and pick the spare.
  - **Never kill a process you did not start.** No `pkill`, no `kill` by name. Stop a server you started by its own process group.
- **Meshy waits.** No Meshy call in this plan. The only Meshy swap it names (the wrecked car, D7) waits for the October credits, a failed Blender review, the lead's go, and `pnpm meshy -- estimate` first: **20 + 10 = 30 credits, about $0.60** at the unconfirmed $0.02 a credit.

**Blender**
- Headless Blender 5.2 (`/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup`). **Never `mathutils.noise`** (nondeterministic per process in 5.2); use a hand-rolled hash/value noise, as `render_campaign_world.py` does.
- Sources are read from the main checkout's `art/blend/terrain object/` by absolute path (`export_meshy_decor.py:318`), never from the worktree's partial copy. **No source `.blend` is written** (D8: "source untouched").
- `git status art/meshes/` before every `pnpm validate:meshes` run: the gate walks the directory with no filter, and another session's scratch GLB fails your run.

**Tests and git**
- **Pure maths goes in pure, tested functions. Rendering needs no unit tests**, and the toggle checks vote on it. Each GLSL block interpolates its constants from the TypeScript export its mirror is tested against, and a test pins that the shader source contains them.
- **No `any`. No non-null assertion in new code, tests included.** Tests are colocated as `*.test.ts`.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus the empty `packages/sim` diff, plus what each task names (`pnpm validate:meshes` for Tasks 3 and 6).
- **Git hygiene.** `/usr/bin/git` by absolute path, one command per call. `git add <paths>`, then `git commit -s -F <msgfile> -- <paths>`. Never `-A`, never `git checkout -- <file>`, never amend. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **The model tier is named per task.** Opus for `ThreeRenderer.ts` and shaders; sonnet for tools, tests, data, pure modules and Blender scripts; haiku for prose. The final whole-branch review is opus.

## Numbers for the lead to approve (before anything renders)

Rows marked **§5** were approved on 25 Sep and are restated so the table is complete; they are not re-opened. Rows marked **new** are this plan's, and nothing that depends on them is built until the lead's word on them.

| # | Item | Number | Status | Why |
|---|---|---|---|---|
| N-1 | Grass + sand, open ground | 0.9 / open tile: seeds 0.09 / tile × 6–10 members within 0.5–1.2 tile; singletons 0.15 / tile | §5 | 3.6×, clustered |
| N-2 | Cluster family | one family per cluster: grass if the seed tile's existing family roll `tileHash(x+977, y+311)` < 0.6, else sand | new | a clump is one plant; keeps today's 60/40 split |
| N-3 | Where a member may land | an open tile (no decor, cover 0, not blocked, not boulder) at ≥ 0.54 tile from the road centreline (`ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF`) and inside the map; otherwise dropped, never moved | new | clear of the worn road edge |
| N-4 | Grass height | ≤ 0.12 world units: grass scale 0.7–0.9 (the GLB is 0.40 m tall, so 0.133 wu at scale 1; today's 1.2 reaches 0.16) | §5 limit, new scale | never hides infantry |
| N-5 | Bush on cover | `min(1, 0.6 × (0.5 + 0.5·cover))`: 0.60 / 0.90 / 1.00 at cover 1 / 2 / 3 (today 0.30 / 0.45 / 0.60) | §5 ("double") | thicket reads denser |
| N-6 | D9 grain trims | the **discs** retire: the stone-grain earth diamonds (`b > 0.78`) and the sward bare-earth patch (`rnd > 0.9`). The **flecks** halve, rounded up per tile: `ceil((3 + floor(rnd·5)) / 2)`, 2–4 a tile (was 3–7). Sward blades, tussocks, dry bush marks, rubble, ridge and knoll grain stay | new reading of D9 | "discs" and "flecks" named in code, not left to the implementer |
| N-7 | Scatter check floors after D9 | the four `scatter` toggle floors (quiet, open-ground, relief, aftermath) are re-derived at a third of the new three-run minimum. They are expected to fall, and this row is the lead's approval of that fall. The `toneCheck` ratio floor 0.8 does **not** move; a tone ratio under 0.8 is a stop | new | the grain carries less on purpose |
| N-8 | Props: kinds, sizes, triangles | see the prop table under R-5 | new | ART_PIPELINE §6's list |
| N-9 | Props: where | **yard**: an eligible tile at Chebyshev distance 1–2 from a building tile, roll 0.10; **roadside**: a point at 0.54–0.96 tile from the road centreline, roll 0.07 a tile; at least 1.5 tiles between props; **≤ 150 a map**, the cap filled in hash order, not scan order | §5 limits, new rolls | texture, not clutter; no north-west bias |
| N-10 | Props: never on | a building, ridge, road surface (< 0.54), ditch, boulder, grove or cover > 0 tile | new | cover stays legible (spec §2 non-goal) |
| N-11 | Props on cover-0 ground | allowed. A prop gives no cover; the tallest (wrecked car, 1.3 m) is lower than a standing figure. **The lead judges this in Task 12's captures**; the lever is N-10's list | new, decision | a jersey barrier can read as cover |
| N-12 | Prop colours | roles `concrete` = `limestone` from 2, `metal` = `gunmetal` from 1, `rust` = `dust` from 5, `rubber` = `shadow` from 0, `cloth` = `water` from 0, each `liftTone` of the slice | new | palette identity without textures |
| N-13 | Desert crown | 5–8 clumps, 1,200–1,800 tris a tree, 1.4–1.8× today's width | §5 | a crown at zoom 1 |
| N-14 | Desert crown, "width" | the crown's footprint diameter in both axes, against the mean of today's two horizontal extents: v0 1.44 m → 2.0–2.6 m; v1 0.82 → 1.15–1.5; v2 0.72 → 1.0–1.3. v2 keeps its "thinned" identity at 5 clumps; v0 and v1 carry 7–8 | new | today's v0 is 2.56 × 0.32 m, a plank |
| N-15 | Olive LOD | ≤ 3,000 tris a GLB (13,383–14,239 today), decimated at export by face count, source untouched | §5, D8 | a quarter of today |
| N-16 | Sway | 0.035 wu at crown top, period 3.8 s, gust ×1.4 every ~11 s, weight (h/top)² | §5 | 2.2 px at zoom 1 (to be measured, Task 7) |
| N-17 | Sway, the open numbers | top = 1.0 wu above the instance origin, weight clamped at 1; direction world (1, 0, −1)/√2 (screen-horizontal); phase 1.7·x + 2.3·z of the instance origin (a travelling wave); gust = a half-sine 2.5 s wide at the start of every 11 s | new | grass (0.12 wu) moves 0.0007 wu: still |
| N-18 | Haze | arid `dust.0`, green `limestone.1`; 0 at the focus plane → 12% at +20 tiles; low-lying +6% below 2 levels | §5 | dust, not fog |
| N-19 | Haze, the open numbers | focus = the camera's look-at tile; "ahead" = distance along the horizontal view direction (−1, −1)/√2; "low-lying" is measured **below the map's median open-ground level**, so a flat map has no low-lying term at all | new | on absolute level 2, every flat map would wear a uniform 6% veil |
| N-20 | Presets | dawn 22° / −35° / `limestone.1` 2.0 / sky `water.0` / hemi 0.75 / haze 16%; day as today; dusk 18° / +35° / `dust.0` 1.8 / sky `gunmetal.1` / hemi 0.7 / haze `dust.1` 18%; exposure 1.0; `night` → `dusk` | §5 | |
| N-21 | Preset azimuth sign, and the bounce | today's sun XZ rotated by φ as `x' = x·cosφ + z·sinφ`, `z' = −x·sinφ + z·cosφ` (φ > 0 turns +X toward −Z), then re-pitched to the preset's elevation; the ground bounce stays `dust.4` on all three presets | new | the spec gives magnitudes, not a sign, and no dawn/dusk bounce |
| N-22 | The shed ladder, in order | 1. `SCATTER_DENSITY` 1.0 → 0.75 → 0.5; 2. the `sand` role stops casting shadows (a 0.06 m patch throws nothing visible); 3. `PROP_CAP` 150 → 75. Never the decal pool, never the crowns | new, from spec §8 | "a miss sheds scatter density first" |
| N-23 | `&tod=` | sandbox only; a mission's authored `time_of_day` wins and the flag is ignored there | new | a dev flag must never change how a mission looks |

## Rulings taken while planning

Where the spec and today's code disagree, or the spec is silent, this plan rules as follows. Each ruling becomes a Deviations entry in the spec at landing (Task 12).

**Plan shape**
- **R-1: twelve tasks and an entry, against the spec's eleven.** The spec's §7 plan-2 tasks map as follows; the extra task is the props split at the five-file cap, as plan 1's R-1 did.

  | Spec §7 task | Plan tasks |
  |---|---|
  | 1 Clustered placement | 1 |
  | 2 Grain trims | 2 |
  | 3 Props Blender kit | 3 |
  | 4 Props batch, placement, `props` check | 4, 5 |
  | 5 Desert crowns and olive LOD | 6 |
  | 6 Sway and `wind` check | 7 |
  | 7 Haze and `haze` check | 9 |
  | 8 Preset table and `timeOfDay` | 8, 10 |
  | 9 `&tod` and the dusk capture | 10, 11 |
  | 10 `perf:units` at 300 and the acceptance views | 5 (after the scatter), 12 |
  | 11 Docs, bless 2 | 12 |

**Scatter**
- **R-2: the "scatter" of spec §3.4 is decor, not the grain mesh.** The 0.20–0.27 "objects per open tile" (G8) are `decorPlacements`' `grass` and `sand` families (`DENSITY.grass 0.34 × 0.6 + DENSITY.sand 0.18 × 0.4 = 0.276`). The flat grain is `buildScatter`, and D9 trims that. So Task 1 edits `decor-place.ts` and Task 2 edits `scatter.ts`; the gate's `decor` layer witnesses the first and `scatter` the second.
- **R-3: members are dropped, never moved.** A member that lands on a road, a building or off the map is discarded. Moving it to the nearest legal point would pile objects against every road edge. The measured density on real maps (Task 1) is what N-1's "0.9" is checked against, in a band.
- **R-4: the density dial scales seeds and singletons together**, never member counts, so shedding keeps clumps clumpy. It lives in `decor-place.ts` as `SCATTER_DENSITY` and as a parameter, and it does not touch trees, boulders, ditches, rocks, slabs or bushes.

**Props**
- **R-5: the prop table.** GLB units are metres; `MESH_SCALE` is 1/3, so 3 m is one tile.

  | Kind | Size (m) | Tris | Roles | Band |
  |---|---|---|---|---|
  | `jersey_barrier` | 3.0 × 0.6 × 0.8 | ≤ 120 | concrete | roadside, yaw along the road |
  | `water_tank` | Ø 1.4 × 1.6 on a 0.6 stand | ≤ 300 | metal, rust | yard |
  | `satellite_dish` | Ø 0.9 dish on a 1.4 pole | ≤ 250 | metal | yard |
  | `laundry_line` | 2.4 span, 1.7 poles, three cloths | ≤ 200 | metal, cloth | yard |
  | `tyre_pile` | three Ø 0.7 tyres stacked, one leaning | ≤ 360 | rubber | yard or roadside |
  | `rebar` | 2.4 × 0.3 bundle, three bars bent to 1.0, one broken block | ≤ 200 | rust, concrete | yard |
  | `wrecked_car` | 4.2 × 1.8 × 1.3 | ≤ 400 | rust, metal, rubber | roadside |

  Mix: roadside {jersey 0.35, tyre 0.25, wrecked car 0.15, rebar 0.25}; yard {water tank 0.25, dish 0.20, laundry 0.25, tyre 0.15, rebar 0.15}. One variant each: seven GLBs.
- **R-6: the vertex colour is baked at load, not at export.** Spec §3.4 says "a baked vertex colour". A GLB carries `extras.rl_role` and zero materials, exactly the decor contract, and `bakePropColors` writes the `color` attribute from `prop-role.ts` when the loader clones the geometry. So palette values live in TypeScript beside every other ramp table, `validate:meshes` checks props with the decor contract's shape, and one material serves the whole batch.
- **R-7: props are contract-checked, not rendered, by `validate:meshes`**, like decor (`validate_mesh_assets.py`, "Decor is checked a THIRD way"): zero materials, images and textures; every mesh node's role inside `PROP_ROLES`; triangle caps from R-5. `render_mesh_gate.py` gets the same early return for the `props` asset class that `decor` has.
- **R-8: props load through the app's mesh manifest**, like decor (`mesh-catalogue.ts` `PROP_MESHES`, `propKindsFor`), and a map with no building and no road fetches none.

**Trees**
- **R-9: the olive is decimated by face count, not vertex count.** `TREE_TARGET_VERTS = 3500` (`export_meshy_decor.py:413`) shipped 13,383–14,239 triangles, because a vertex target says nothing about faces. `TREE_TARGET_TRIS = 3000` replaces it. `tree_1` and `tree_2` stay byte-identical (recorded at `export_meshy_decor.py`'s "CORRECTION, 2026-09-07"); that is out of scope.
- **R-10: the desert crown replaces the foliage objects on var1 and var3; the trunk objects are kept as they are.** The crown clumps are generated in Blender from a hand-rolled hash, so two exports are byte-identical (Task 6 proves it).

**Sway, haze and presets**
- **R-11: the dead grove wind path is deleted: `GroveMaterial`, `groveMesh`, `groveMat` and `windClockMs`.** `grove.ts` and `buildGroves` stay (they are still barrel-exported and tested); deleting them is a follow-up (Out of scope).
- **R-12: `time_of_day` is read off the mission JSON by the app** (`packages/app/src/time-of-day.ts`, `timeOfDayOf`), which validates the value against the four names. Adding it to `packages/sim/src/mission.ts`'s `map` type would touch the sim for a field the sim never reads.
- **R-13: haze is mixed toward a scene-referred tint.** The fog pass runs on the composer's HalfFloat, pre-tone-map target, where lit open ground sits near `albedo × (sunIntensity · sun.y + hemiIntensity) / π`. The haze colour is the tint's linear value times that same factor for the active preset (`hazeRadiance`), so haze neither darkens bright ground nor glows on it, and dusk's haze is dimmer by the same ratio as its light.
- **R-14: the haze runs before the fog-of-war mix, inside the same pass**, and only where depth < 1. The `fog` layer's `uRevealAll` does not touch it; the new `haze` layer drives `uHazeAmp` to 0.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/render/src/three/terrain/decor-place.ts` (+test) | Clusters, singletons, the density dial, grass scale, bush on cover | 1 |
| `packages/app/src/scatter-density.test.ts` (new) | Density, clustering and exclusions on all 26 maps; props on all 26 maps (5) | 1, 4 |
| `tools/src/decor-heights.test.ts` (new) | Grass height from the shipped GLBs (1); crown and olive triangle budgets (6) | 1, 6 |
| `packages/render/src/three/terrain/scatter.ts` (+test) | D9: discs retire, flecks halve | 2 |
| `tools/src/golden-diff/baseline.ts` | Scatter floors (2); `props` (5); `wind` (7); `haze` (9); decor re-measure and `dusk` (11) | 2, 5, 7, 9, 11 |
| `tools/terrain/props.py` (new), `art/meshes/props/*.glb` (7, new) | The props Blender kit | 3 |
| `tools/render_mesh_gate.py`, `tools/validate_mesh_assets.py` | The `props` asset class and `check_prop_meshes` | 3 |
| `packages/render/src/three/terrain/prop-role.ts` (+test), `tools/src/props-contract.test.ts` (new) | Prop role vocabulary and ramps; the GLB contract read in TypeScript | 3 |
| `packages/render/src/three/terrain/prop-place.ts` (+test), `terrain/index.ts` | Prop placement (pure) | 4 |
| `packages/render/src/three/terrain/prop-mesh.ts` (+test) | `bakePropColors`, `buildPropMesh` | 4 |
| `packages/app/src/mesh-catalogue.ts` (+test) | `PROP_MESHES`, `propKindsFor`, the manifest's `props` | 4 |
| `packages/render/src/three/ThreeRenderer.ts` | Props (5); sway and the grove retirement (7); presets (8); haze (9) | 5, 7, 8, 9 |
| `packages/render/src/three/debug-layers.ts` (+test) | `props` (5), `wind` (7), `haze` (9) | 5, 7, 9 |
| `packages/app/src/main.ts` | Props load (5); `timeOfDay` (10) | 5, 10 |
| `tools/terrain/export_meshy_decor.py` | Desert crowns; olive LOD by face count | 6 |
| `art/meshes/decor/desert_tree_{0,1,2}.glb`, `tree_{0,1,2}.glb` | Re-exported | 6 |
| `packages/render/src/three/terrain/sway.ts` (+test), `terrain/decor-mesh.ts` (+test) | Sway maths and GLSL; the foliage batch sways | 7 |
| `packages/render/src/three/terrain/mesh.ts` (+test), `terrain/types.ts` | `GroveMaterial` and `MeshData.sway` retire | 7 |
| `packages/render/src/three/time-of-day.ts` (+test), `lighting.ts` (+test), `packages/render/src/api.ts`, `packages/app/src/terrain-themes.ts` | Presets; lights take a preset; `RendererOptions.timeOfDay`; `TerrainTones.haze` | 8 |
| `packages/render/src/three/haze.ts` (+test), `fog-pass.ts` (+test) | The haze curve; the haze term in the fog pass | 9 |
| `packages/app/src/time-of-day.ts` (+test), `packages/app/src/sandbox-help.ts` (+test), `packages/app/src/shell/links.test.ts` | `timeOfDayOf`; `&tod=` | 10 |
| `tools/src/golden-diff/capture-protocol.ts`, `tools/src/golden-diff/dusk.test.ts` (new) | `DUSK_SCENARIO`, report-only | 11 |
| `docs/PERFORMANCE.md`, `CLAUDE.md`, the spec | The record | 12 |

---

### Task 0: Entry: the numbers, the haze mock, main's captures and main's costs

**Tier:** not a code task. Coordinator, no model spend.

- [ ] **Step 1: Check the branch point.** `/usr/bin/git log --oneline -1 origin/main` and `/usr/bin/git log --oneline -3` in `/Users/ilpinto/dev/roaring-lions-ep/ground2`.
  - If main has moved and touched `packages/render/src/three/terrain/**`, `ThreeRenderer.ts`, `fog-pass.ts`, `lighting.ts`, `debug-layers.ts`, `tools/terrain/**` or `tools/src/golden-diff/**`, merge it first (`/usr/bin/git merge origin/main`) and re-grep this plan's citations.
- [ ] **Step 2: Gates**, recorded in the ledger (`.superpowers/sdd/2026-09-27-ground-plan-2/progress.md`, git-ignored; mirror it to the scratchpad, since clean worktrees get removed): `pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:ui && pnpm validate:meshes`.
- [ ] **Step 3: Main's captures**, the local A/B reference for every later task: `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground2/t0`.
  - The comparison against the stale darwin baseline fails. That is expected and its numbers are not read.
  - Keep `.superpowers/ground2/t0/<scenario>/current.png` for all six scenarios and every layer-check reading the run prints (`gate.log`). Plan 1's `ab.ts` is reused: copy `.superpowers/ground/ab.ts` from the plan-1 worktree if this one lacks it (its text is in plan 1, Task 0 Step 4), and sanity-check `t0` against itself: every line `0 px / 0.0000`.
- [ ] **Step 4: Mock the haze** (Global Constraints: a frame-wide world tint is mocked before it is built). A git-ignored script, not product code:

```ts
// .superpowers/ground2/haze-mock.ts -- npx tsx .superpowers/ground2/haze-mock.ts
// Mocks spec §3.6's haze on main's own captures. For this camera (orthographic,
// fixed 30-degree pitch) a point on flat ground that is d tiles further along the
// horizontal view direction sits d * sqrt(2) * TILE_H / 2 px higher on screen at
// zoom 1, so screen y IS view depth on flat ground. Mixed in sRGB (the build mixes
// in linear, R-13); no low-lying term (no depth buffer here, and N-19 gives a flat
// map none). Relief's hills are therefore mocked as if flat: say so to the lead.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { TILE_H } from '../../packages/render/src/project';

const DUST0: [number, number, number] = [0xe0, 0xb8, 0x7a]; // palette dust.0
const cases: [string, number, number][] = [
  // scenario, zoom, haze at +20 tiles
  ['quiet', 1, 0.12],
  ['relief', 2, 0.12],
  ['quiet', 1, 0.18], // dusk's amount, with the day tint -- the upper bound
];
for (const [id, zoom, far] of cases) {
  const png = PNG.sync.read(readFileSync(`.superpowers/ground2/t0/${id}/current.png`));
  const pxPerTile = (Math.SQRT2 * TILE_H * zoom) / 2;
  const cy = png.height / 2;
  for (let y = 0; y < png.height; y++) {
    const ahead = (cy - y) / pxPerTile;
    const h = far * Math.min(1, Math.max(0, ahead / 20));
    for (let x = 0; x < png.width; x++) {
      const o = (y * png.width + x) * 4;
      for (let c = 0; c < 3; c++) png.data[o + c] = Math.round(png.data[o + c] * (1 - h) + DUST0[c] * h);
    }
  }
  writeFileSync(`.superpowers/ground2/mock/${id}-haze-${far}.png`, PNG.sync.write(png));
}
```

  - Hand the lead the three mock frames beside their `t0` originals.
- [ ] **Step 5: The lead approves the numbers table and the haze mock.** Record the word, and any number changed, in the ledger. **Tasks 1–12 do not start before it.** A changed number is edited into this plan's table before the task that uses it.
- [ ] **Step 6: Main's costs**, same instruments and conditions as plan 1 Task 0 Step 5, on `b6497c12` from a throwaway detached worktree under `.superpowers/ground2/t0-tree` (never `git checkout` a file in this tree):
  - `pnpm ground:capture -- --port=5196 --out=.superpowers/ground2/cost-t0`, and again with `--maps=wadi_halam_basin,qarn_hadid --decals`.
  - `render-frame-cost` on both acceptance rosters (`'?sandbox=beit_sahwan_outskirts&sur&civ'`, `'?sandbox=qarn_hadid&sur'`) against a dev server on 5197 started in its own process group, **n = 5 per view**, interleaved later with the branch (Tasks 5 and 12 re-run main in the same session as the after).
  - `npx tsx tools/src/perf/backend-curve-gate.ts --port=5198`.
  - Record every number with GPU string, DPR, viewport and n in `.superpowers/ground2/cost-t0/README.txt`.

---

### Task 1: Clustered grass and sand (pure)

**Tier:** sonnet. Spec §3.4 "Clusters", N-1 to N-5, R-2 to R-4.

**Files:**
- Modify: `packages/render/src/three/terrain/decor-place.ts`, `packages/render/src/three/terrain/decor-place.test.ts`
- Create: `packages/app/src/scatter-density.test.ts`, `tools/src/decor-heights.test.ts`
- Update pins only: `packages/app/src/terrain-parity.test.ts` if it pins grass/sand counts (grep `grass`, `sand`, `decorPlacements` there first)

**Interfaces** (all in `decor-place.ts`, all barrel-exported through `terrain/index.ts` already):

```ts
export const CLUSTER_SEED_P = 0.09;
export const CLUSTER_MIN = 6;
export const CLUSTER_MAX = 10;
export const CLUSTER_R_MIN = 0.5;
export const CLUSTER_R_MAX = 1.2;
export const SINGLETON_P = 0.15;
export const GRASS_SCALE_MIN = 0.7;
export const GRASS_SCALE_MAX = 0.9;
export const BUSH_COVER_BASE = 0.6;
/** `ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF` (road-graph.ts): 0.54 tile. */
export const SCATTER_ROAD_CLEAR: number;
/** The shed dial (spec §8, N-22): scales seed and singleton probability only. */
export const SCATTER_DENSITY = 1;
/** Whether a grass/sand object may stand at world (px, pz). */
export function isOpenScatterAt(input: TerrainInput, graph: RoadGraph, px: number, pz: number): boolean;
export function decorPlacements(input: TerrainInput, density?: number): DecorPlacement[];
```

- [ ] **Step 1: Write the failing tests** (added to `decor-place.test.ts`; its `input(w, h, edit)` helper exists).

```ts
import { buildRoadGraph, roadDistanceAt } from './road-graph';
import {
  BUSH_COVER_BASE,
  CLUSTER_R_MAX,
  GRASS_SCALE_MAX,
  GRASS_SCALE_MIN,
  SCATTER_ROAD_CLEAR,
  isOpenScatterAt,
} from './decor-place';

const openObjects = (ps: readonly DecorPlacement[]): DecorPlacement[] =>
  ps.filter((p) => p.family === 'grass' || p.family === 'sand');

/** Clark-Evans ratio: mean nearest-neighbour distance over the value a
 *  uniform (Poisson) scatter of the same density would give, 0.5 / sqrt(n / A).
 *  About 1 for an even spread, well under 1 for clumps. */
function clarkEvans(ps: readonly DecorPlacement[], area: number): number {
  let sum = 0;
  for (const p of ps) {
    let best = Infinity;
    for (const q of ps) {
      if (q === p) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / ps.length / (0.5 / Math.sqrt(ps.length / area));
}

describe('clustered grass and sand (spec §3.4, N-1)', () => {
  const open = input(48, 48);
  const placed = openObjects(decorPlacements(open));

  it('carries 0.8-0.95 objects an open tile on an all-open map (0.09 x 8 + 0.15 = 0.87)', () => {
    const perTile = placed.length / (48 * 48);
    expect(perTile).toBeGreaterThan(0.8);
    expect(perTile).toBeLessThan(0.95);
  });
  // The whole point of the change. Today's even 0.27 reads 0.95-1.05 here;
  // members within 0.5-1.2 tile of a seed read far under it.
  it('is clumped: Clark-Evans ratio under 0.7', () => {
    expect(clarkEvans(placed, 48 * 48)).toBeLessThan(0.7);
  });
  it('gives every member of a clump its seed tile family (N-2)', () => {
    // Each object's nearest neighbour is almost always in its own clump, so
    // nearest-neighbour pairs closer than CLUSTER_R_MAX agree on family.
    let agree = 0;
    let total = 0;
    for (const p of placed) {
      const q = placed
        .filter((o) => o !== p)
        .reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
      if (Math.hypot(q.x - p.x, q.z - p.z) > CLUSTER_R_MAX) continue;
      total++;
      if (q.family === p.family) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.85);
  });
  it('keeps grass inside N-4 scales, and sand at its old 0.8-1.2', () => {
    for (const p of placed) {
      if (p.family === 'grass') {
        expect(p.scale).toBeGreaterThanOrEqual(GRASS_SCALE_MIN);
        expect(p.scale).toBeLessThanOrEqual(GRASS_SCALE_MAX);
      } else {
        expect(p.scale).toBeGreaterThanOrEqual(0.8);
        expect(p.scale).toBeLessThanOrEqual(1.2);
      }
    }
  });
  it('is deterministic', () => {
    expect(decorPlacements(open)).toEqual(decorPlacements(open));
  });
});

describe('where a member may land (N-3, R-3)', () => {
  const roadRow = input(48, 48, (_i, decor) => {
    for (let x = 0; x < 48; x++) decor[20 * 48 + x] = DECOR_ROAD;
  });
  const graph = buildRoadGraph(roadRow);

  it('never within SCATTER_ROAD_CLEAR of a road centreline', () => {
    for (const p of openObjects(decorPlacements(roadRow))) {
      expect(roadDistanceAt(graph, p.x, p.z), `(${p.x}, ${p.z})`).toBeGreaterThanOrEqual(SCATTER_ROAD_CLEAR);
    }
  });
  it('never on a blocked, cover, grove, knoll, ridge, ditch or boulder tile', () => {
    // Seven tile classes in rotation; only class 6 is open ground.
    const n = 24 * 24;
    const decor = new Uint8Array(n);
    const blocked = new Uint8Array(n);
    const cover = new Uint8Array(n);
    const boulder = new Uint8Array(n);
    for (let t = 0; t < n; t++) {
      const k = t % 7;
      if (k === 0) blocked[t] = 1;
      else if (k === 1) cover[t] = 2;
      else if (k === 2) decor[t] = DECOR_GROVE;
      else if (k === 3) decor[t] = DECOR_KNOLL;
      else if (k === 4) decor[t] = DECOR_DITCH;
      else if (k === 5) boulder[t] = 1;
    }
    const mixed: TerrainInput = { width: 24, height: 24, decor, elevation: null, blocked, cover, boulder };
    const g = buildRoadGraph(mixed);
    for (const p of openObjects(decorPlacements(mixed))) {
      expect(isOpenScatterAt(mixed, g, p.x, p.z), `(${p.x}, ${p.z})`).toBe(true);
      const t = Math.floor(p.z) * 24 + Math.floor(p.x);
      expect(t % 7 === 6, `(${p.x}, ${p.z}) is on tile class ${t % 7}`).toBe(true);
    }
  });
  it('never off the map', () => {
    for (const p of openObjects(decorPlacements(input(12, 12)))) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(12);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThan(12);
    }
  });
});

describe('bush on cover doubles (N-5)', () => {
  it.each([
    [1, 0.6],
    [2, 0.9],
    [3, 1.0],
  ])('cover %i carries a bush on about %f of its tiles', (c, want) => {
    const m = input(48, 48, (_i, _d, _b, cover) => cover.fill(c));
    const bushes = decorPlacements(m).filter((p) => p.family === 'bush').length;
    expect(Math.abs(bushes / (48 * 48) - want)).toBeLessThan(0.05);
    expect(BUSH_COVER_BASE).toBe(0.6);
  });
});

describe('the density dial (R-4, N-22)', () => {
  it('halves open-ground objects at 0.5 and leaves every other family alone', () => {
    const m = input(48, 48, (_i, decor, _b, cover) => {
      for (let t = 0; t < 48 * 48; t += 5) decor[t] = DECOR_GROVE;
      for (let t = 2; t < 48 * 48; t += 11) cover[t] = 1;
    });
    const full = decorPlacements(m);
    const half = decorPlacements(m, 0.5);
    const ratio = openObjects(half).length / openObjects(full).length;
    expect(ratio).toBeGreaterThan(0.44);
    expect(ratio).toBeLessThan(0.56);
    const rest = (ps: readonly DecorPlacement[]) => ps.filter((p) => p.family !== 'grass' && p.family !== 'sand');
    expect(rest(half)).toEqual(rest(full));
  });
});
```

  - Update the existing tests that pinned `DENSITY.grass`/`DENSITY.sand` rolls or the old bush curve. Record in the commit body which ones and why each changed.
- [ ] **Step 2: Write the real-map test.**

```ts
// packages/app/src/scatter-density.test.ts
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, type MapId } from '@lions/data';
import {
  SCATTER_ROAD_CLEAR,
  buildRoadGraph,
  decorPlacements,
  roadDistanceAt,
  type TerrainInput,
} from '@lions/render/terrain';

const MAP_IDS = Object.keys(maps) as MapId[];

/** The same bring-up as `ground-texture-slots.test.ts`'s `loadInput`, kept
 *  local for the reason that file gives (two suites, no coupling). */
function loadInput(id: MapId): TerrainInput {
  const pm = parseMap(maps[id]);
  const sim = new Sim({ seed: 20260727, width: pm.width, height: pm.height, capacity: 256 });
  applyTerrain(pm, sim);
  const idx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of pm.structures) {
    const t = idx.get(b.type);
    if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  return {
    width: pm.width,
    height: pm.height,
    decor: pm.decor,
    elevation: pm.elevation,
    blocked: sim.blocked,
    cover: sim.cover,
    boulder: pm.boulder,
  };
}

function openTileCount(i: TerrainInput): number {
  let n = 0;
  for (let t = 0; t < i.width * i.height; t++) {
    const d = i.decor ? i.decor[t] : 0;
    const b = i.boulder ? i.boulder[t] : 0;
    if (i.blocked[t] === 0 && d === 0 && i.cover[t] === 0 && b === 0) n++;
  }
  return n;
}

describe.each(MAP_IDS)('scatter density on %s', (id) => {
  const input = loadInput(id);
  const open = decorPlacements(input).filter((p) => p.family === 'grass' || p.family === 'sand');

  // Measured, not derived: members that land on a road, a building or off the
  // map are dropped (R-3), so a map with more edges reads under the all-open
  // fixture's 0.87. The band is N-1's "0.9" with that loss allowed for.
  it('carries 0.65-1.0 grass and sand objects an open tile', () => {
    const n = openTileCount(input);
    if (n < 500) return; // the tile_* fixtures that are nearly all one surface
    const perTile = open.length / n;
    expect(perTile).toBeGreaterThan(0.65);
    expect(perTile).toBeLessThan(1.0);
  });
  it('keeps every grass and sand object off the road (N-3)', () => {
    const graph = buildRoadGraph(input);
    for (const p of open) expect(roadDistanceAt(graph, p.x, p.z)).toBeGreaterThanOrEqual(SCATTER_ROAD_CLEAR);
  });
});
```

  - Before committing, print the per-map density and total placements once (a temporary `console.log`, removed) and record the table in the commit body. If any shipped map with ≥ 500 open tiles reads outside 0.65–1.0, **stop and report** the table: the band is a claim about N-1 and the lead approved N-1, not the band.
- [ ] **Step 3: Write the grass-height test** (the shipped GLBs are the ground truth for N-4).

```ts
// tools/src/decor-heights.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRASS_SCALE_MAX } from '../../packages/render/src/three/terrain/decor-place';
import { MESH_SCALE } from '../../packages/render/src/three/units/mesh-anim';

const DECOR = join(__dirname, '../../art/meshes/decor');

interface GlbAccessor { count: number; min?: number[]; max?: number[] }
interface GlbJson {
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: GlbAccessor[];
}
/** The JSON chunk of a .glb: 12-byte header, then chunk 0 is JSON. */
export function glbJson(path: string): GlbJson {
  const b = readFileSync(path);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as GlbJson;
}
export function glbHeight(j: GlbJson): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of j.meshes) for (const p of m.primitives) {
    const a = j.accessors[p.attributes.POSITION];
    if (!a.min || !a.max) throw new Error('POSITION accessor without min/max');
    lo = Math.min(lo, a.min[1]);
    hi = Math.max(hi, a.max[1]);
  }
  return hi - lo;
}
export function glbTris(j: GlbJson): number {
  let n = 0;
  for (const m of j.meshes) for (const p of m.primitives) {
    n += (p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3;
  }
  return n;
}

describe('grass never hides infantry (N-4)', () => {
  it.each([0, 1, 2])('grass_%i at GRASS_SCALE_MAX stands at most 0.12 world units', (v) => {
    const h = glbHeight(glbJson(join(DECOR, `grass_${v}.glb`)));
    expect(h * MESH_SCALE * GRASS_SCALE_MAX).toBeLessThanOrEqual(0.12);
  });
});
```

- [ ] **Step 4: Implement.**
  - `familyFor` returns a sentinel `'open'` where it returned `grass`/`sand`; the main loop skips it (`continue`), and a second pass over the tiles places clusters and singletons.
  - **Seeds:** `tileHash(x + 2203, y + 1499) < CLUSTER_SEED_P * density` on an open tile. **Members:** count `CLUSTER_MIN + floor(tileHash(x + 3301, y + 709) * (CLUSTER_MAX - CLUSTER_MIN + 1))`; member k at angle `tileHash(x * 7 + k + 3001, y * 5 + k + 1709) * TAU`, radius `CLUSTER_R_MIN + tileHash(x * 5 + k + 1201, y * 3 + k + 4409) * (CLUSTER_R_MAX - CLUSTER_R_MIN)` from the tile centre. **Singletons:** `tileHash(x + 449, y + 823) < SINGLETON_P * density` (the old density stream, so a singleton lands where an object used to).
  - Family per cluster: the seed tile's `tileHash(x + 977, y + 311) < 0.6` → grass (N-2). Variant, yaw and scale per member from their own offset streams; state each offset pair in a comment, and check none collides with the file's existing pairs.
  - `isOpenScatterAt` answers N-3 with one `buildRoadGraph(input)` built once per call of `decorPlacements`, and `roadDistanceAt` per candidate.
  - `y` is `surfaceWorldY(surface, px, pz)` at the member's own point, as every other family.
  - Bush: `Math.min(1, BUSH_COVER_BASE * (0.5 + 0.5 * c))`.
  - Header comment: G8, the cluster rule, why members are dropped (R-3), and the dial (R-4).
- [ ] **Step 5: Time it.** `decorPlacements` runs on every terrain rebuild. Time it on `qarn_hadid` and `wadi_halam_basin` from a node script (not shipping code), warm and cold, and record both in the commit body. **Above 15 ms warm, stop and report**: the member road queries are the suspect.
- [ ] **Step 6: Gates, falsify, commit.**
  - **Falsify** (each seen red, then reverted):
    - (a) members spread uniformly over the map (angle and radius replaced by `tileHash`-uniform x, z): the Clark–Evans test goes red.
    - (b) drop the road clearance: the road tests (unit and real-map) go red.
    - (c) `GRASS_SCALE_MAX = 1.2`: the height test goes red.
  - Message: `feat(render): grass and sand gather in clumps at 0.9 an open tile (G8, spec §3.4)`.

---

### Task 2: The grain trims (D9)

**Tier:** sonnet. N-6, N-7.

**Files:**
- Modify: `packages/render/src/three/terrain/scatter.ts`, `packages/render/src/three/terrain/scatter.test.ts`, `tools/src/golden-diff/baseline.ts` (scatter floors, per N-7)

**Interfaces:** `export function stoneFleckCount(rnd: number): number` in `scatter.ts`, which is `Math.ceil((3 + Math.floor(rnd * 5)) / 2)`.

- [ ] **Step 1: Write the failing tests** (added to `scatter.test.ts`).

```ts
import { stoneFleckCount } from './scatter';
import { composite, quantise, PALETTE_HEXES } from './tones';

describe('D9: the flecks halve (N-6)', () => {
  // The historical count, written out so the halving is checked against it,
  // not against a restatement of the new formula.
  const oldCount = (rnd: number): number => 3 + Math.floor(rnd * 5);
  it('is the old per-tile count halved and rounded up, 2 to 4', () => {
    for (let i = 0; i < 1000; i++) {
      const r = i / 1000;
      expect(stoneFleckCount(r)).toBe(Math.ceil(oldCount(r) / 2));
      expect(stoneFleckCount(r)).toBeGreaterThanOrEqual(2);
      expect(stoneFleckCount(r)).toBeLessThanOrEqual(4);
    }
  });
});

describe('D9: the discs retire (N-6)', () => {
  /** Every vertex colour the grain mesh emits, as a quantised hex. */
  function hexesOf(data: MeshData): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i < data.colors.length; i += 3) {
      const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
      out.add(`#${h(data.colors[i])}${h(data.colors[i + 1])}${h(data.colors[i + 2])}`.toUpperCase());
    }
    return out;
  }
  it.each(['stone', 'sward'] as const)('no earth disc on %s ground', (grain) => {
    const tones: TerrainTones = { ...TONES, scatter: grain };
    const flat = openInput(48, 48); // the file's all-open, cover-0 fixture
    const data = buildScatter(flat, tones, BACKGROUND);
    const base = groundTone(tones, 0, 0); // the open tile's base, as buildScatter computes it
    const disc = quantise(composite(base, tones.earth, grain === 'stone' ? 0.24 : 0.22), PALETTE_HEXES);
    // Precondition: the disc tone is not also some surviving mark's tone,
    // or this test could not tell a disc from a fleck.
    const fleckLo = quantise(composite(base, tones.rock, 0.15), PALETTE_HEXES);
    const fleckHi = quantise(composite(base, tones.rock, 0.4), PALETTE_HEXES);
    const bush = quantise(composite(base, tones.low, grain === 'stone' ? 0.55 : 0.8), PALETTE_HEXES);
    expect([fleckLo, fleckHi, bush]).not.toContain(disc);
    expect(hexesOf(data).has(disc.toUpperCase())).toBe(false);
  });
});
```

  - The helpers `openInput`, `TONES`, `BACKGROUND` exist in `scatter.test.ts` under those or near names; use what is there and adjust the fixture call, not the assertions. If `groundTone`'s signature differs, take the base the way `buildScatter` does (`scatter.ts`, `baseHex`) and say so in a comment.
  - If the precondition fails for the shipped `arid` or `green` tones, pick the other theme for that grain and record why.
- [ ] **Step 2: Implement.** In `buildScatter`'s open-ground branch: delete the sward bare-earth patch block (`rnd > 0.9`) and the stone `b > 0.78` earth branch (its fleck becomes unconditional), and use `stoneFleckCount(rnd)` for `n`. Comments name D9 and G8 ("confetti and polka dots at zoom 2.5").
- [ ] **Step 3: Re-derive the scatter floors (N-7).** Run `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground2/t2-r<k>` for k = 1 to 3.
  - Read the `scatter` toggle and `toneCheck` on `quiet`, `open-ground`, `relief` and `aftermath`.
  - **Toggle floors:** a third of the smallest of the three runs, each metric, rounded down. Write the three readings and the pre-D9 floor into each `rationale`, and the words "re-derived under N-7, approved by the lead on <date>".
  - **Tone ratio:** if any reads under 0.8, **stop and report**. The ratio floor does not move under N-7.
  - If a new floor would be **higher** than today's, keep today's: N-7 approves a fall, not a tightening by accident; Task 11 re-measures everything once more.
- [ ] **Step 4: Gates, falsify, commit.**
  - **Falsify:** restore the stone earth branch: the disc test goes red. Restore `n = 3 + floor(rnd * 5)`: the fleck test goes red. Then, with the trims in, re-inject the 671acdb scatter no-op (plan 1's recipe in `baseline.ts`) and confirm the `quiet` and `open-ground` tone checks still go red.
  - Message: `feat(render): the flat grain loses its discs and half its flecks (D9)`.

---

### Task 3: The props Blender kit

**Tier:** sonnet, run as the `blender-art` agent type. Spec §3.4 "Props", R-5 to R-7, N-8, N-12. **Waits for the lead's word on N-8 and N-12 (Task 0).**

**Files:**
- Create: `tools/terrain/props.py`, `art/meshes/props/{jersey_barrier,water_tank,satellite_dish,laundry_line,tyre_pile,rebar,wrecked_car}.glb`, `packages/render/src/three/terrain/prop-role.ts`, `packages/render/src/three/terrain/prop-role.test.ts`, `tools/src/props-contract.test.ts`
- Modify: `tools/render_mesh_gate.py` (early return for the `props` asset class, beside `decor`'s), `tools/validate_mesh_assets.py` (`PROP_ROLES`, `PROP_TRI_CAPS`, `check_prop_meshes`, called from `main` beside `check_decor_meshes`), `packages/render/src/three/terrain/index.ts` (export `prop-role`)

**Interfaces:**

```ts
// prop-role.ts (three-free)
export const PROP_MESH_ROLES = ['concrete', 'metal', 'rust', 'rubber', 'cloth'] as const;
export type PropMeshRole = (typeof PROP_MESH_ROLES)[number];
export function isPropMeshRole(role: string): role is PropMeshRole;
export function rampForPropRole(role: string): readonly string[]; // throws on an unknown role
export const PROP_KINDS = ['jersey_barrier', 'water_tank', 'satellite_dish', 'laundry_line', 'tyre_pile', 'rebar', 'wrecked_car'] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export const PROP_TRI_CAPS: Readonly<Record<PropKind, number>>; // R-5
```

```python
# tools/terrain/props.py -- run inside Blender:
#   Blender --background --factory-startup --python tools/terrain/props.py [-- --only wrecked_car]
# One builder function per kind, each a table of primitives (box, cylinder,
# torus, bent polyline sweep) with sizes from R-5, each tagged rl_role.
# Exports art/meshes/props/<kind>.glb with _finalize_and_export's settings from
# export_meshy_decor.py (imported, not copied), zero materials.
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/terrain/prop-role.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liftTone } from '../world-materials';
import { readRamp } from '../units/mesh-role';
import { PROP_KINDS, PROP_MESH_ROLES, PROP_TRI_CAPS, rampForPropRole } from './prop-role';

describe('prop roles (N-12)', () => {
  it.each([
    ['concrete', 'limestone', 2],
    ['metal', 'gunmetal', 1],
    ['rust', 'dust', 5],
    ['rubber', 'shadow', 0],
    ['cloth', 'water', 0],
  ] as const)('%s is %s from %i', (role, band, from) => {
    expect(rampForPropRole(role)).toEqual(readRamp(band).slice(from));
    expect(liftTone(rampForPropRole(role))).toMatch(/^#[0-9A-F]{6}$/i);
  });
  it('throws on a role outside the vocabulary', () => {
    expect(() => rampForPropRole('foliage')).toThrow(/prop role/);
  });
  // The Python gate and this file must agree, or a GLB passes one and fails the other.
  it('matches validate_mesh_assets.py PROP_ROLES and PROP_TRI_CAPS', () => {
    const py = readFileSync(join(__dirname, '../../../../../tools/validate_mesh_assets.py'), 'utf8');
    const roles = /^PROP_ROLES = \{([^}]*)\}/m.exec(py);
    if (!roles) throw new Error('PROP_ROLES not found');
    expect(new Set(roles[1].match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)))).toEqual(new Set(PROP_MESH_ROLES));
    for (const k of PROP_KINDS) expect(py).toMatch(new RegExp(`"${k}": ${PROP_TRI_CAPS[k]}\\b`));
  });
});
```

```ts
// tools/src/props-contract.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROP_KINDS, PROP_TRI_CAPS, isPropMeshRole } from '../../packages/render/src/three/terrain/prop-role';
import { glbHeight, glbJson, glbTris } from './decor-heights.test';

const PROPS = join(__dirname, '../../art/meshes/props');
interface Nodes { nodes: { mesh?: number; extras?: { rl_role?: string } }[]; materials?: unknown[]; images?: unknown[]; textures?: unknown[] }

describe.each(PROP_KINDS)('props/%s.glb (R-5, R-7)', (kind) => {
  const path = join(PROPS, `${kind}.glb`);
  it('exists', () => expect(existsSync(path)).toBe(true));
  const j = glbJson(path) as ReturnType<typeof glbJson> & Nodes;
  it('carries no material, image or texture', () => {
    expect(j.materials ?? []).toHaveLength(0);
    expect(j.images ?? []).toHaveLength(0);
    expect(j.textures ?? []).toHaveLength(0);
  });
  it('tags every mesh node with a prop role', () => {
    const meshNodes = j.nodes.filter((n) => n.mesh !== undefined);
    expect(meshNodes.length).toBeGreaterThan(0);
    for (const n of meshNodes) expect(isPropMeshRole(n.extras?.rl_role ?? '')).toBe(true);
  });
  it('stays under its triangle cap', () => {
    expect(glbTris(j)).toBeLessThanOrEqual(PROP_TRI_CAPS[kind]);
  });
  it('stands on the ground and is no taller than 1.7 m', () => {
    expect(glbHeight(j)).toBeLessThanOrEqual(1.7);
  });
});
```

  - `decor-heights.test.ts` exports `glbJson`, `glbTris` and `glbHeight` for this reuse (Task 1). If vitest objects to importing from a test file, move the three into `tools/src/glb-json.ts` in this task and import from there in both.
- [ ] **Step 2: Build the kit.** `props.py`, one builder per kind from R-5's table. Each part is a Blender primitive with explicit segment counts (cylinders 8–12 sides; the tyre a torus at 10 × 6), joined per role, triangulated, origin at the ground centre, +X the long axis (so a jersey barrier's yaw is "along the road" at 0 turns when the road runs along X).
  - The wrecked car: a box body with a sunk roof, four flat-sided wheels (one missing), a rust hood and a metal door left ajar. Nothing about a brand.
  - Determinism: any irregularity (dents, the bent rebar) from a hand-rolled hash of the part index, **never `mathutils.noise`**. Export twice and compare `md5` of all seven files; they must match.
- [ ] **Step 3: Extend the gate.** `render_mesh_gate.py`: the `props` asset class returns early, as `decor` does. `validate_mesh_assets.py`: `PROP_ROLES = {"concrete", "metal", "rust", "rubber", "cloth"}`, `PROP_TRI_CAPS = {"jersey_barrier": 120, …}`, and `check_prop_meshes(props_root)` mirroring `check_decor_meshes` (zero materials/images/textures, roles inside `PROP_ROLES`, triangles under the cap). Its docstring joins the module header's "checked a THIRD way" list as "props, the same way".
- [ ] **Step 4: Look.** Render each prop orthographically at the dimetric angle in a scratch directory (`.superpowers/ground2/props-preview/`), at the game's own zoom-1 size and at 4×, with the role colours from N-12. Hand the seven previews to the lead. **Task 4 does not start before the lead's word on them.** A failed review is fixed in Blender; Meshy is not called (Global Constraints).
- [ ] **Step 5: Gates, falsify, commit.**
  - `git status art/meshes/`, then `pnpm validate:meshes`: the props line reads 7 checked.
  - **Falsify:** tag one wrecked-car part `rl_role = "foliage"`: both `check_prop_meshes` and `props-contract.test.ts` go red. Add a material to `tyre_pile`: both go red. Revert (re-export).
  - Message: `feat(art): seven Blender-built props for the ground -- jersey barrier to wrecked car (ART_PIPELINE §6)`. The body states: no AI-generated geometry.

---

### Task 4: Where props go, and the batch they draw in (pure and GPU halves)

**Tier:** sonnet. N-9 to N-12, R-5, R-6, R-8. **Waits for the lead's word on Task 3's previews.**

**Files:**
- Create: `packages/render/src/three/terrain/prop-place.ts` (+test), `packages/render/src/three/terrain/prop-mesh.ts` (+test)
- Modify: `packages/render/src/three/terrain/index.ts` (export `prop-place`; NOT `prop-mesh`, which imports `three`), `packages/app/src/mesh-catalogue.ts` (+test), `packages/app/src/scatter-density.test.ts`

**Interfaces:**

```ts
// prop-place.ts (three-free)
export const PROP_CAP = 150;
export const PROP_SPACING = 1.5;
export const YARD_BAND: readonly [number, number] = [1, 2];       // Chebyshev tiles from a building tile
export const ROADSIDE_BAND: readonly [number, number];            // [SCATTER_ROAD_CLEAR, 0.96] from the centreline
export const YARD_P = 0.1;
export const ROADSIDE_P = 0.07;
export const YARD_MIX: readonly (readonly [PropKind, number])[];     // R-5
export const ROADSIDE_MIX: readonly (readonly [PropKind, number])[]; // R-5
export interface PropPlacement {
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly yawTurns: number;
}
/** A blocked tile that is not a ridge: `buildings.ts`'s own definition. */
export function isBuildingTile(input: TerrainInput, x: number, y: number): boolean;
/** The road's direction at (px, pz), as yaw turns that put a prop's +X along it. */
export function roadYawTurns(graph: RoadGraph, px: number, pz: number): number;
/** In acceptance order, so `propPlacements(i, 75)` is a prefix of `propPlacements(i, 150)`. */
export function propPlacements(input: TerrainInput, cap?: number): PropPlacement[];

// prop-mesh.ts (three)
export interface PropGeometrySet {
  readonly parts: ReadonlyMap<PropKind, readonly { role: PropMeshRole; geometry: THREE.BufferGeometry }[]>;
}
/** Writes a `color` attribute: every vertex the role's lit tone, linear. In place. */
export function bakePropColors(geometry: THREE.BufferGeometry, role: PropMeshRole): THREE.BufferGeometry;
/** One BatchedMesh for every prop, or null when nothing is placed or loaded. */
export function buildPropMesh(placements: readonly PropPlacement[], set: PropGeometrySet): THREE.BatchedMesh | null;
export function disposePropMesh(mesh: THREE.BatchedMesh): void;
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/terrain/prop-place.test.ts
import { describe, expect, it } from 'vitest';
import { DECOR_GROVE, DECOR_RIDGE, DECOR_ROAD } from './shared';
import { buildRoadGraph, roadDistanceAt } from './road-graph';
import {
  PROP_CAP,
  PROP_SPACING,
  ROADSIDE_BAND,
  isBuildingTile,
  propPlacements,
  type PropPlacement,
} from './prop-place';
import type { TerrainInput } from './types';

/** A w x h town: a building tile every 6 tiles on a grid, a road along
 *  row `roadY` and column `roadX`, grove on every 13th tile, cover on every
 *  17th, a ridge on every 19th. */
function town(w: number, h: number, roadY = 10, roadX = 30): TerrainInput {
  const n = w * h;
  const decor = new Uint8Array(n);
  const blocked = new Uint8Array(n);
  const cover = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = y * w + x;
    if (y === roadY || x === roadX) decor[t] = DECOR_ROAD;
    else if (x % 6 === 3 && y % 6 === 3) blocked[t] = 1;
    else if (t % 13 === 0) decor[t] = DECOR_GROVE;
    else if (t % 17 === 0) cover[t] = 1;
    else if (t % 19 === 0) { decor[t] = DECOR_RIDGE; blocked[t] = 1; }
  }
  return { width: w, height: h, decor, elevation: null, blocked, cover };
}

const YARD_ONLY = new Set(['water_tank', 'satellite_dish', 'laundry_line']);
const ROAD_ONLY = new Set(['jersey_barrier', 'wrecked_car']);

function chebyshevToBuilding(i: TerrainInput, px: number, pz: number): number {
  const tx = Math.floor(px);
  const ty = Math.floor(pz);
  let best = Infinity;
  for (let y = 0; y < i.height; y++) for (let x = 0; x < i.width; x++) {
    if (isBuildingTile(i, x, y)) best = Math.min(best, Math.max(Math.abs(x - tx), Math.abs(y - ty)));
  }
  return best;
}

describe('propPlacements (N-9, N-10)', () => {
  const m = town(48, 48);
  const graph = buildRoadGraph(m);
  const ps = propPlacements(m);

  it('places some, and never more than PROP_CAP', () => {
    expect(ps.length).toBeGreaterThan(20);
    expect(ps.length).toBeLessThanOrEqual(PROP_CAP);
  });
  it('never stands on a building, ridge, road surface, grove or cover tile (N-10)', () => {
    for (const p of ps) {
      const t = Math.floor(p.z) * m.width + Math.floor(p.x);
      expect(m.blocked[t], `${p.kind} at (${p.x}, ${p.z})`).toBe(0);
      expect(m.decor?.[t] === DECOR_GROVE).toBe(false);
      expect(m.cover[t]).toBe(0);
      expect(roadDistanceAt(graph, p.x, p.z)).toBeGreaterThanOrEqual(ROADSIDE_BAND[0]);
    }
  });
  it('puts yard kinds in the yard band and road kinds in the roadside band', () => {
    for (const p of ps) {
      if (YARD_ONLY.has(p.kind)) {
        const d = chebyshevToBuilding(m, p.x, p.z);
        expect(d, `${p.kind} at (${p.x}, ${p.z})`).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(2);
      }
      if (ROAD_ONLY.has(p.kind)) {
        const d = roadDistanceAt(graph, p.x, p.z);
        expect(d, `${p.kind} at (${p.x}, ${p.z})`).toBeLessThanOrEqual(ROADSIDE_BAND[1]);
      }
    }
  });
  it('keeps PROP_SPACING between any two props', () => {
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      expect(Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z)).toBeGreaterThanOrEqual(PROP_SPACING);
    }
  });
  it('lays a jersey barrier along its road', () => {
    const along = (p: PropPlacement): number => (((p.yawTurns % 0.5) + 0.5) % 0.5); // 0 or 0.25, mod half a turn
    for (const p of ps.filter((q) => q.kind === 'jersey_barrier')) {
      const onRow = Math.abs(p.z - 10.5) < 1;
      const onCol = Math.abs(p.x - 30.5) < 1;
      if (onRow && !onCol) expect(Math.min(along(p), 0.5 - along(p))).toBeLessThan(0.02);
      if (onCol && !onRow) expect(Math.abs(along(p) - 0.25)).toBeLessThan(0.02);
    }
  });
  it('fills the cap in hash order, not scan order: no north-west bias when the cap binds', () => {
    const big = town(96, 96, 40, 60);
    const capped = propPlacements(big);
    expect(capped.length).toBe(PROP_CAP);
    const meanZ = capped.reduce((a, p) => a + p.z, 0) / capped.length;
    expect(meanZ).toBeGreaterThan(96 * 0.38);
    expect(meanZ).toBeLessThan(96 * 0.62);
  });
  it('sheds by prefix: the 75-cap is the first 75 of the 150-cap (N-22)', () => {
    const big = town(96, 96, 40, 60);
    expect(propPlacements(big, 75)).toEqual(propPlacements(big).slice(0, 75));
  });
  it('places nothing on a map with no road and no building', () => {
    const empty: TerrainInput = { width: 16, height: 16, decor: null, elevation: null, blocked: new Uint8Array(256), cover: new Uint8Array(256) };
    expect(propPlacements(empty)).toEqual([]);
  });
  it('is deterministic', () => expect(propPlacements(m)).toEqual(ps));
});
```

```ts
// packages/render/src/three/terrain/prop-mesh.test.ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { liftTone } from '../world-materials';
import { rampForPropRole } from './prop-role';
import { bakePropColors, buildPropMesh, disposePropMesh, type PropGeometrySet } from './prop-mesh';
import type { PropPlacement } from './prop-place';

const box = (): THREE.BufferGeometry => new THREE.BoxGeometry(1, 1, 1).deleteAttribute('uv');
const set: PropGeometrySet = {
  parts: new Map([
    ['tyre_pile', [{ role: 'rubber' as const, geometry: bakePropColors(box(), 'rubber') }]],
    ['wrecked_car', [
      { role: 'rust' as const, geometry: bakePropColors(box(), 'rust') },
      { role: 'metal' as const, geometry: bakePropColors(box(), 'metal') },
    ]],
  ]),
};
const at = (kind: PropPlacement['kind'], x: number): PropPlacement => ({ kind, x, z: 0, y: 0, yawTurns: 0 });

describe('bakePropColors (R-6, N-12)', () => {
  it.each(['concrete', 'metal', 'rust', 'rubber', 'cloth'] as const)('writes %s as its lit tone, linear', (role) => {
    const g = bakePropColors(box(), role);
    const c = g.getAttribute('color');
    const want = new THREE.Color(liftTone(rampForPropRole(role)));
    expect(c.itemSize).toBe(3);
    for (let i = 0; i < c.count; i++) {
      expect([c.getX(i), c.getY(i), c.getZ(i)]).toEqual([want.r, want.g, want.b]);
    }
  });
});

describe('buildPropMesh', () => {
  it('draws every prop in ONE batch with ONE vertex-coloured material that casts', () => {
    const mesh = buildPropMesh([at('tyre_pile', 0), at('wrecked_car', 3), at('tyre_pile', 6)], set);
    if (!mesh) throw new Error('no mesh');
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    // `batchId` is three's own bookkeeping on some r16x builds; it is not ours.
    expect(Object.keys(mesh.geometry.attributes).filter((k) => k !== 'batchId').sort()).toEqual(['color', 'normal', 'position']);
    // 2 tyre piles x 1 part + 1 car x 2 parts. `instanceCount` is r170's getter; re-check the name.
    expect(mesh.instanceCount).toBe(4);
    disposePropMesh(mesh);
  });
  it('drops a kind whose GLB never arrived, and does not throw', () => {
    const mesh = buildPropMesh([at('water_tank', 0), at('tyre_pile', 2)], set);
    expect(mesh?.instanceCount).toBe(1);
    if (mesh) disposePropMesh(mesh);
  });
  it('is null when nothing is placed', () => {
    expect(buildPropMesh([], set)).toBeNull();
  });
});
```

  - `mesh-catalogue.test.ts`: `PROP_MESHES` lists every `PROP_KINDS` entry and every file exists under `art/meshes/`; `propKindsFor` is empty for a map with no road and no building tile and full otherwise; `meshManifestFor(plan).props` maps `<kind>` to `meshUrl(PROP_MESHES[kind])`. Follow the file's existing decor tests' shape.
  - `scatter-density.test.ts` gains a `describe.each(MAP_IDS)` block: `propPlacements(loadInput(id))` has at most `PROP_CAP` entries; none on an N-10 tile; and its kinds are a subset of `propKindsFor(parseMap(maps[id]))`. Print the per-map count once and record it in the commit body (removed before commit).
- [ ] **Step 2: Implement `prop-place.ts`.**
  - Candidates: for each tile that is not N-10-forbidden, a **yard** candidate when its Chebyshev distance to a building tile is in `YARD_BAND` and `tileHash(x + 5101, y + 2903) < YARD_P`; a **roadside** candidate at the tile centre plus a ±0.3 jitter (`tileHash(x + 6007, y + 811)`, `tileHash(x + 811, y + 6007)`) when `roadDistanceAt` of that point is inside `ROADSIDE_BAND` and `tileHash(x + 7919, y + 3571) < ROADSIDE_P`. A tile that qualifies for both takes roadside.
  - Kind: a weighted pick from the band's mix by `tileHash(x + 4273, y + 1777)`. Yaw: `roadYawTurns` for `jersey_barrier` (plus half a turn on a hash, so barriers face both ways), a `tileHash` turn otherwise.
  - Acceptance: sort candidates by `tileHash(x + 9137, y + 2213)` ascending, accept each that keeps `PROP_SPACING` from every accepted prop, stop at `cap`.
  - `y`: `surfaceWorldY` at the prop's point.
  - `roadYawTurns`: the centreline's direction from a central difference of `roadDistanceAt` (ε = 0.05 tile): tangent ⟂ gradient, `θ = atan2(−tz, tx)` (a yaw of θ about +Y maps +X to (cos θ, 0, −sin θ)), returned as `θ / TAU` in [0, 1).
- [ ] **Step 3: Implement `prop-mesh.ts`**, `decor-mesh.ts`'s shape with one batch instead of one per role: `BatchedMesh(maxInstances, verts, indices, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: WORLD_ROUGHNESS, metalness: 0 }))`, one geometry id per part, `castShadow` and `receiveShadow` true. Colour: `new THREE.Color(liftTone(rampForPropRole(role)))`, written as a `Float32Array` attribute. Header comment: why one batch (R-6), why vertex colour, why +3 calls (shadow, AO, main).
- [ ] **Step 4: Implement the catalogue.** `PROP_MESHES: Readonly<Record<PropKind, string>>` = `props/<kind>.glb`; `propKindsFor(map)`: every kind when the map has any road tile or any building tile, else none (R-8, a superset, as `decorFamiliesFor` is); `MeshPlan.props`, `MeshManifest.props: ReadonlyMap<PropKind, string>`.
- [ ] **Step 5: Gates, falsify, commit.**
  - **Falsify:** (a) accept candidates in scan order: the north-west-bias test goes red. (b) drop the cover exclusion: the N-10 test goes red. (c) give the batch a second material: the one-batch test goes red.
  - Message: `feat(render): where props stand, and the one batch they draw in (spec §3.4)`.

---

### Task 5: Props on the map, the `props` layer, and the costs after the scatter

**Tier:** opus (`ThreeRenderer.ts`).

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/debug-layers.ts` (+test), `packages/app/src/main.ts`, `tools/src/golden-diff/baseline.ts`

**Interfaces:**
- `ThreeRenderer.loadPropMeshes(urls: ReadonlyMap<PropKind, string>): Promise<void>`, `loadDecorMeshes`' shape (`:5284`): `MESH_SCALE`, each mesh's geometry cloned into world space, stripped to `position` and `normal` (`stripToBatchAttributes`), then `bakePropColors` by its `rl_role`. A role outside `PROP_MESH_ROLES` **throws**, naming the kind: `validate:meshes` already refused it, so reaching here means an unchecked file.
- `composeTerrain` (`:8880`) also returns `propPlacements: propPlacements(input)`, from the same `input` as `decorPlacements`.
- `private propMesh: THREE.BatchedMesh | null`, built in `rebuildTerrain` (`:8018`) beside the decor groups, disposed there and in `dispose()`. A late prop load rebuilds it the way a late decor load rebuilds decor (re-grep what `loadDecorMeshes` sets after its `Promise.all`).
- `DEBUG_LAYERS` gains `'props'`: `setObjectsVisible(visible, this.propMesh)`. `decor` does **not** hide props, so each layer has its own witness.
- `main.ts`: `three.loadPropMeshes(meshManifest.props)` in the same `Promise.all` as `loadDecorMeshes` (`:1881`).

- [ ] **Step 1: Write the failing tests** (`debug-layers.test.ts`, following its existing per-layer pattern): `isDebugLayer('props')` is true; the doc block's list names `props` with one line saying what it hides and that `decor` does not.
- [ ] **Step 2: Implement** the interfaces above.
- [ ] **Step 3: Look.** `pnpm ground:capture -- --port=5196 --out=.superpowers/ground2/t5`. Look at each map's `centre-z1` and `road-z2.5`. Record the prop count per map from `__lions` (a one-off console read, not code).
- [ ] **Step 4: The `props` check.** `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground2/t5-r<k> --scenario=quiet,aftermath`, k = 1 to 3, with a provisional `layer: 'props'` entry at floors 0/0 to make the gate print its reading.
  - Floors: a third of the smallest of three runs, both metrics. Rationale: the readings, the prop count in frame, and what the defect below reads.
  - **If a scenario's signal is under 300 px, do not declare the check there**; report it. A floor at a third of noise is not a witness.
  - Every pre-existing check still clears its floor (the `decor` ones rise with Task 1's density; they are re-derived in Task 11, not here).
- [ ] **Step 5: A/B.** `ab.ts` of `t5-r1` against `t0`. Expected: every gated scenario moves (scatter and grain since Tasks 1–2; props on `quiet` and `aftermath`).
- [ ] **Step 6: Falsify.** `propPlacements` returns `[]` inside `composeTerrain` only (the pure tests stay green): the `props` check goes red on both scenarios at 0 px. Revert.
- [ ] **Step 7: The costs after the scatter** (spec §8: "`perf:units` re-run after the scatter"). Same conditions as Task 0 Step 6, main re-run in the same session, interleaved, n = 5 per view:
  - `ground:capture` calls and tris per view, before → after. **Expected: calls +3 on a map with props in frame, +0 on `tel_marum` (no road, six building tiles: check), tris +~240k a pass plus ≤ 60k of props.**
  - `render-frame-cost` on both rosters.
  - `backend-curve-gate --port=5198` at 300 figures.
  - **Stops:** `qarn_hadid` z1.6 gpu p95 after-mean above before-mean + 0.20 ms; any acceptance view up by more than 0.74 ms; 300-figure p95 above 7.5 ms; calls above +3. On a stop, walk the shed ladder (N-22) one rung at a time, re-measure each rung with the same n, and hand the lead the table (rung, calls, tris, p95 per view). Do not pick a rung for the lead.
  - Record everything in `.superpowers/ground2/cost-t5/README.txt` with conditions.
- [ ] **Step 8: Gates, commit.** Message: `feat(render): props stand in yards and along roads -- one batch, a props check that can fail`.

---

### Task 6: Desert crowns and the olive LOD (D8)

**Tier:** sonnet, run as the `blender-art` agent type. N-13 to N-15, R-9, R-10. Independent of Tasks 1–5; may run in parallel in its own worktree if the ledger tracks it. **Waits for the lead's word on N-13 to N-15.**

**Files:**
- Modify: `tools/terrain/export_meshy_decor.py`, `tools/src/decor-heights.test.ts`
- Re-export: `art/meshes/decor/desert_tree_{0,1,2}.glb`, `art/meshes/decor/tree_{0,1,2}.glb`

**Interfaces:** in `export_meshy_decor.py`, `TREE_TARGET_TRIS = 3000` replaces `TREE_TARGET_VERTS`; `DESERT_CROWN = {0: (7, 2.0, 2.6), 1: (8, 1.15, 1.5), 2: (5, 1.0, 1.3)}` (clumps, min and max footprint diameter in m, per N-14); `DESERT_CROWN_TRIS = (1200, 1800)`; `_build_crown(variant, trunk_objs, seed)`, from a hand-rolled hash.

- [ ] **Step 1: Write the failing tests** (added to `decor-heights.test.ts`).

```ts
/** Horizontal extents of every primitive on nodes tagged `role`. */
function roleExtent(j: GlbJson & { nodes: { mesh?: number; extras?: { rl_role?: string } }[] }, role: string): { w: number; d: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const n of j.nodes) {
    if (n.mesh === undefined || n.extras?.rl_role !== role) continue;
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      if (!a.min || !a.max) throw new Error('POSITION accessor without min/max');
      x0 = Math.min(x0, a.min[0]); x1 = Math.max(x1, a.max[0]);
      z0 = Math.min(z0, a.min[2]); z1 = Math.max(z1, a.max[2]);
    }
  }
  return { w: x1 - x0, d: z1 - z0 };
}

describe('the olive LOD (D8, N-15)', () => {
  it.each([0, 1, 2])('tree_%i is 2,000-3,000 triangles, still 3.40 m tall, trunk and foliage both', (v) => {
    const j = glbJson(join(DECOR, `tree_${v}.glb`)) as Parameters<typeof roleExtent>[0];
    expect(glbTris(j)).toBeLessThanOrEqual(3000);
    expect(glbTris(j)).toBeGreaterThanOrEqual(2000); // a quarter, not a stub
    expect(glbHeight(j)).toBeCloseTo(3.4, 2);
    const roles = new Set(j.nodes.map((n) => n.extras?.rl_role));
    expect(roles.has('trunk') && roles.has('foliage')).toBe(true);
  });
  // The silhouette must survive: today's footprints are 3.01 x 1.01 and 2.85 x 1.15.
  it.each([
    [0, 3.01, 1.01],
    [1, 2.85, 1.15],
  ])('tree_%i keeps its footprint within 10%%', (v, w, d) => {
    const e = roleExtent(glbJson(join(DECOR, `tree_${v}.glb`)) as Parameters<typeof roleExtent>[0], 'foliage');
    expect(Math.abs(e.w / w - 1)).toBeLessThan(0.1);
    expect(Math.abs(e.d / d - 1)).toBeLessThan(0.1);
  });
});

describe('the desert crown (N-13, N-14)', () => {
  it.each([
    [0, 2.0, 2.6],
    [1, 1.15, 1.5],
    [2, 1.0, 1.3],
  ])('desert_tree_%i: 1,200-1,800 tris, crown %f-%f m across in both axes, 2.90 m tall', (v, lo, hi) => {
    const j = glbJson(join(DECOR, `desert_tree_${v}.glb`)) as Parameters<typeof roleExtent>[0];
    expect(glbTris(j)).toBeGreaterThanOrEqual(1200);
    expect(glbTris(j)).toBeLessThanOrEqual(1800);
    expect(glbHeight(j)).toBeCloseTo(2.9, 2);
    const e = roleExtent(j, 'foliage');
    for (const span of [e.w, e.d]) {
      expect(span).toBeGreaterThanOrEqual(lo);
      expect(span).toBeLessThanOrEqual(hi);
    }
  });
});
```

- [ ] **Step 2: Implement the olive LOD.** `_decimate` takes a triangle target: triangulate, count faces, `ratio = TREE_TARGET_TRIS / faces`, COLLAPSE, then the existing Z split (order unchanged: decimate first). Rewrite the docstring's TREE section: why faces, not vertices (R-9), the D8 approval and date, "source untouched". The byte-identical `tree_1`/`tree_2` note stays.
- [ ] **Step 3: Implement the crown.** In `_export_desert_tree_variant`: delete the foliage objects (removed, not unselected: the exporter writes every object), keep the trunk objects, and add `DESERT_CROWN[v][0]` clumps.
  - Each clump: an icosphere at subdivision 2, decimated to 150–220 triangles, scaled to an ellipsoid (radius 0.28–0.45 m, flattened to 0.7 in Z), its vertices pushed out by a hand-rolled value noise (amplitude 0.06 m) for a leafy edge. **Never `mathutils.noise`.**
  - Placement: one clump on the trunk's top, the rest on a ring at 0.72–0.95 of the height, at angles from the hash, the ring's radius solved so the crown's footprint lands inside `DESERT_CROWN[v]`'s band on both axes.
  - Joined as one `foliage` object; the export asserts the triangle band and prints the clump count and footprint.
  - Height stays `DESERT_TREE_TARGET_HEIGHT` (2.90): the crown fits under it, it does not raise it.
- [ ] **Step 4: Determinism.** Export `--only tree,desert_tree` twice to a scratch directory; `md5` of all six files must match run to run. If they do not, find the unseeded call; do not ship.
- [ ] **Step 5: Look.** Orthographic previews of the three desert trees and one olive, before and after, at the dimetric angle, at zoom-1 size and at 4×, to `.superpowers/ground2/trees-preview/`. `pnpm ground:capture -- --port=5196 --out=.superpowers/ground2/t6 --maps=beit_sahwan_outskirts,wadi_halam_basin`: record `wadi_halam_basin`'s triangles (the spec expects about −3.4M a pass) and beit's. Hand the previews and the two maps' `centre-z1` to the lead.
- [ ] **Step 6: Gates, falsify, commit.**
  - `git status art/meshes/`, then `pnpm validate:meshes` (the decor contract: zero materials, roles in the vocabulary).
  - **Falsify:** set `TREE_TARGET_TRIS = 12000` and re-export `tree_0`: the LOD test goes red. Set variant 2's clump count to 3: the crown test goes red. Revert and re-export.
  - Message: `feat(art): desert trees grow crowns; the olive drops to a quarter of its triangles at export (D8)`. The body names the Meshy-generated sources (disclosed per CONTRIBUTING.md, as the originals were) and "source .blend untouched".

---

### Task 7: The crowns sway on the sim clock, and the dead grove path goes

**Tier:** opus (a shader and `ThreeRenderer.ts`). N-16, N-17, R-11.

**Files:**
- Create: `packages/render/src/three/terrain/sway.ts` (+test)
- Modify: `packages/render/src/three/terrain/decor-mesh.ts` (+test), `packages/render/src/three/terrain/mesh.ts` (+test; `GroveMaterial` and the `sway` attribute retire), `packages/render/src/three/terrain/types.ts` (`MeshData.sway` retires), `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/debug-layers.ts` (+test), `tools/src/golden-diff/baseline.ts`

**Interfaces:**

```ts
// sway.ts (three-free, barrel-exported)
export const SWAY_AMPLITUDE = 0.035;   // world units at weight 1
export const SWAY_PERIOD_S = 3.8;
export const SWAY_GUST_GAIN = 1.4;
export const SWAY_GUST_EVERY_S = 11;
export const SWAY_GUST_WIDTH_S = 2.5;
export const SWAY_TOP = 1.0;           // world units above the instance origin
export const SWAY_DIR_X = Math.SQRT1_2;
export const SWAY_DIR_Z = -Math.SQRT1_2;
export const SWAY_PHASE_X = 1.7;
export const SWAY_PHASE_Z = 2.3;
export function swayWeight(heightWu: number): number;
export function gustFactor(tSec: number): number;
export function swayOffset(heightWu: number, tSec: number, originX: number, originZ: number): { dx: number; dz: number };
/** The GLSL spliced after `#include <project_vertex>`, constants interpolated. */
export function swayVertexChunk(): string;

// decor-mesh.ts
export interface SwayUniforms { readonly time: { value: number }; readonly amp: { value: number } }
export function swayingFoliageMaterial(ramp: readonly string[], sway: SwayUniforms): THREE.MeshStandardMaterial;
export function buildDecorMesh(placements: readonly DecorPlacement[], set: DecorGeometrySet, sway?: SwayUniforms): THREE.Group;
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/terrain/sway.test.ts
import { describe, expect, it } from 'vitest';
import {
  SWAY_AMPLITUDE, SWAY_DIR_X, SWAY_DIR_Z, SWAY_GUST_EVERY_S, SWAY_GUST_GAIN, SWAY_GUST_WIDTH_S,
  SWAY_PERIOD_S, SWAY_PHASE_X, SWAY_PHASE_Z, SWAY_TOP,
  gustFactor, swayOffset, swayVertexChunk, swayWeight,
} from './sway';

describe('sway maths (N-16, N-17)', () => {
  it('weighs by (h / top)^2, clamped', () => {
    expect(swayWeight(0)).toBe(0);
    expect(swayWeight(-1)).toBe(0);
    expect(swayWeight(SWAY_TOP / 2)).toBeCloseTo(0.25, 12);
    expect(swayWeight(SWAY_TOP)).toBe(1);
    expect(swayWeight(3 * SWAY_TOP)).toBe(1);
  });
  it('leaves grass still: 0.12 wu tall moves under 0.001 wu at the strongest gust', () => {
    let worst = 0;
    for (let t = 0; t < 22; t += 0.01) {
      const o = swayOffset(0.12, t, 3, 7);
      worst = Math.max(worst, Math.hypot(o.dx, o.dz));
    }
    expect(worst).toBeLessThan(0.001);
  });
  it('gusts x1.4 at the peak, once every 11 s, and is calm between', () => {
    expect(gustFactor(SWAY_GUST_WIDTH_S / 2)).toBeCloseTo(SWAY_GUST_GAIN, 12);
    expect(gustFactor(SWAY_GUST_EVERY_S + SWAY_GUST_WIDTH_S / 2)).toBeCloseTo(SWAY_GUST_GAIN, 12);
    expect(gustFactor(5)).toBe(1);
    expect(gustFactor(0)).toBe(1);
  });
  it('never exceeds amplitude x gust at the crown top, and reaches 95% of it', () => {
    let worst = 0;
    for (let t = 0; t < 2 * SWAY_GUST_EVERY_S; t += 0.005) {
      const o = swayOffset(SWAY_TOP, t, 0, 0);
      worst = Math.max(worst, Math.hypot(o.dx, o.dz));
    }
    expect(worst).toBeLessThanOrEqual(SWAY_AMPLITUDE * SWAY_GUST_GAIN + 1e-12);
    expect(worst).toBeGreaterThan(0.95 * SWAY_AMPLITUDE * SWAY_GUST_GAIN);
  });
  it('is periodic in 3.8 s outside a gust, and moves along the screen-horizontal axis', () => {
    const a = swayOffset(SWAY_TOP, 3.0, 4, 9);
    const b = swayOffset(SWAY_TOP, 3.0 + SWAY_PERIOD_S, 4, 9);
    expect(b.dx).toBeCloseTo(a.dx, 12);
    expect(a.dz).toBeCloseTo((a.dx * SWAY_DIR_Z) / SWAY_DIR_X, 12);
  });
  it('travels: two trees a tile apart are out of phase', () => {
    expect(swayOffset(SWAY_TOP, 3, 0, 0).dx).not.toBeCloseTo(swayOffset(SWAY_TOP, 3, 1, 0).dx, 3);
  });
  it('the GLSL carries the tested constants, not a transcription of them', () => {
    const src = swayVertexChunk();
    for (const k of [SWAY_AMPLITUDE, SWAY_PERIOD_S, SWAY_GUST_GAIN, SWAY_GUST_EVERY_S, SWAY_GUST_WIDTH_S, SWAY_TOP, SWAY_PHASE_X, SWAY_PHASE_Z]) {
      expect(src).toContain(k.toFixed(4));
    }
    expect(src).toContain('uSwayTime');
    expect(src).toContain('uSwayAmp');
    expect(src).toContain('USE_BATCHING');
  });
});
```

```ts
// added to decor-mesh.test.ts; `compiled` is the meshphysical harness from mesh.test.ts, copied
import { swayingFoliageMaterial } from './decor-mesh';

describe('the foliage batch sways (Task 7)', () => {
  const sway = { time: { value: 0 }, amp: { value: 1 } };
  it('splices the sway chunk after project_vertex and shares the two uniforms', () => {
    const shader = compiled(swayingFoliageMaterial(['#6E7446', '#5A5F39', '#474B2D'], sway));
    const at = shader.vertexShader.indexOf('#include <project_vertex>');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(shader.vertexShader.indexOf('uSwayTime')).toBeGreaterThan(at);
    expect(shader.uniforms.uSwayTime).toBe(sway.time);
    expect(shader.uniforms.uSwayAmp).toBe(sway.amp);
  });
  it('throws when three no longer has the chunk it splices after', () => {
    const m = swayingFoliageMaterial(['#6E7446'], sway);
    const shader = { uniforms: {}, vertexShader: 'void main(){}', fragmentShader: '' };
    expect(() => m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)).toThrow(/project_vertex/);
  });
  it('is only the foliage role: trunks, rock and sand keep the plain ramp material', () => {
    const group = buildDecorMesh(placementsOfEveryRole(), geometrySetOfEveryRole(), sway);
    for (const child of group.children) {
      const mat = (child as THREE.BatchedMesh).material as THREE.Material;
      expect(mat.customProgramCacheKey() === 'rl-foliage-sway').toBe(child.name === 'decor-foliage');
    }
  });
});
```

  - `placementsOfEveryRole` and `geometrySetOfEveryRole` are small fixtures written in the test file (one bush and one rock family, box geometries). If `buildDecorMesh` does not name its batches today, name them `decor-<role>` in this task; the test depends on it.
  - `mesh.test.ts`'s `GroveMaterial` block is deleted with the class.
- [ ] **Step 2: Implement.**
  - `swayVertexChunk()` computes, per vertex, the instance origin and height through `modelMatrix * batchingMatrix` under `#ifdef USE_BATCHING` (else `modelMatrix`), the weight, gust and sine exactly as `swayOffset`, and adds `viewMatrix * vec4(DIR_X·s, 0, DIR_Z·s, 0)` to `mvPosition`, then rewrites `gl_Position`. Shadow and AO passes use their own materials and keep the rest pose: spec §3.5 accepts that (≤ 2.2 px). `vViewPosition` is assigned after `<project_vertex>` in r170's `meshphysical` vertex shader; confirm that order in `node_modules/three/src/renderers/shaders/ShaderLib/meshphysical.glsl.js` and say so in the comment.
  - `swayingFoliageMaterial`: `rampMaterial(ramp)` plus `onBeforeCompile` (throws when the chunk is missing) and `customProgramCacheKey() → 'rl-foliage-sway'`.
  - `buildDecorMesh`: the `foliage` role takes `swayingFoliageMaterial` when `sway` is given.
  - `ThreeRenderer`: `private readonly sway: SwayUniforms = { time: { value: 0 }, amp: { value: 1 } }`, passed to every `buildDecorMesh`; in `frame()`, `this.sway.time.value = presentationSimMs(this.sim.tickCount, alpha) / 1000`, beside the decals' clock (`:3038`). Delete `groveMesh` (`:896`, `:8067`, `:8169`), `groveMat` (`:1280`), `windClockMs` (`:2088`, `:3040`) and the `GroveMaterial` import; `composeTerrain` stops returning `groves`.
  - `mesh.ts`: `GroveMaterial` and `toGeometry`'s `sway` attribute go; `types.ts`: `MeshData.sway` goes. `grove.ts` stays (R-11); if it writes `sway`, that line goes too and its test is updated.
  - `DEBUG_LAYERS` gains `'wind'`: `this.sway.amp.value = visible ? 1 : 0`, returning 1 when it changed. Nothing in `frame()` writes `amp`.
- [ ] **Step 3: Measure the sway on screen.** On port 5196, `?sandbox=beit_sahwan_outskirts`, zoom 1, fog hidden: step to a gust peak (tick 25, t = 1.20 s) and to a calm zero crossing, capture both, and read the largest crown-top displacement in px from the diff. Record it against N-16's "2.2 px". Report, do not retune.
- [ ] **Step 4: The `wind` check** on `quiet`. `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground2/t7-r<k> --scenario=quiet`, k = 1 to 3, provisional floors 0/0. Floors a third of the smallest reading.
  - **If the signal is under 150 px or under 0.02, stop and report**: `quiet`'s tick 200 may sit near a calm crossing for many trees. The lead chooses between moving the check to another scenario and leaving `wind` report-only. Do not change `quiet`'s tick: every other check is calibrated on it.
  - `quiet` itself must still repeat: two consecutive gate runs read 0–1 px against each other, as before. Sim time is what makes that true.
- [ ] **Step 5: Gates, falsify, commit.**
  - **Falsify:** (a) drive `this.sway.time` from accumulated `dtMs` instead: two `quiet` captures of the same commit now differ (a wall-clock leak). Photograph the pair. (b) `amp` initialised to 0: the `wind` check goes red. (c) `SWAY_PHASE_X` changed in the TS only: the GLSL constant test goes red. Revert each.
  - Message: `feat(render): crowns sway on the sim clock; the dead grove wind path is deleted (G9)`.

---

### Task 8: The time-of-day presets, with `day` byte-identical

**Tier:** opus (lights and `ThreeRenderer.ts`). N-20, N-21, spec §3.6 "Presets".

**Files:**
- Create: `packages/render/src/three/time-of-day.ts` (+test)
- Modify: `packages/render/src/three/lighting.ts` (+test), `packages/render/src/api.ts`, `packages/render/src/three/ThreeRenderer.ts`, `packages/app/src/terrain-themes.ts`

**Interfaces:**

```ts
// time-of-day.ts (three-free)
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type LitTimeOfDay = 'dawn' | 'day' | 'dusk';
export interface LightPreset {
  /** null = today's SUN_DIRECTION exactly (day); else the elevation in degrees. */
  readonly elevationDeg: number | null;
  readonly azimuthOffsetDeg: number;
  readonly sunKey: string;
  readonly sunFallback: string;
  readonly sunIntensity: number;
  readonly skyKey: string;
  readonly skyFallback: string;
  readonly hemiIntensity: number;
  /** Haze at +20 tiles (N-18, N-20). */
  readonly hazeFar: number;
  /** null = the theme's own haze tone (`TerrainTones.haze`); else a palette key. */
  readonly hazeKey: string | null;
}
export const TIME_OF_DAY_PRESETS: Readonly<Record<LitTimeOfDay, LightPreset>>;
export const DAY_SUN_DIRECTION: readonly [number, number, number]; // (-0.406, 0.819, 0.406), unnormalised, lighting.ts's literal
export function resolveTimeOfDay(t: TimeOfDay | undefined): LitTimeOfDay; // undefined -> day, night -> dusk (D10)
export function rotateAzimuth(x: number, z: number, deg: number): [number, number]; // N-21
export function sunDirectionFor(p: LightPreset): readonly [number, number, number]; // unit length for dawn/dusk

// lighting.ts
export interface ResolvedLights {
  readonly direction: THREE.Vector3;
  readonly sunHex: string;
  readonly sunIntensity: number;
  readonly skyHex: string;
  readonly bounceHex: string;
  readonly hemiIntensity: number;
}
/** Today's constants, exactly: SUN_DIRECTION, SUN_COLOR_HEX, SUN_INTENSITY, SKY_COLOR_HEX, GROUND_BOUNCE_COLOR_HEX, HEMISPHERE_INTENSITY. */
export const DAY_LIGHTS: ResolvedLights;
export function createSceneLights(width: number, height: number, shadowMapSize?: number, lights?: ResolvedLights): SceneLights;

// api.ts
// RendererOptions.timeOfDay?: TimeOfDay   -- three-only, ignored by Pixi
// TerrainTones.haze: string               -- the theme's haze tone (N-18); Pixi ignores it
export type { TimeOfDay } from './three/time-of-day';
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/time-of-day.test.ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { paletteColor } from '@lions/data';
import {
  DAY_SUN_DIRECTION, TIME_OF_DAY_PRESETS, resolveTimeOfDay, rotateAzimuth, sunDirectionFor,
} from './time-of-day';
import { GROUND_BOUNCE_COLOR_HEX, SKY_COLOR_HEX, SUN_COLOR_HEX, SUN_DIRECTION } from './lighting';

const deg = (r: number): number => (r * 180) / Math.PI;
const elevation = (v: readonly number[]): number => deg(Math.asin(v[1] / Math.hypot(v[0], v[1], v[2])));
const azimuth = (v: readonly number[]): number => deg(Math.atan2(-v[2], v[0]));

describe('time of day (N-20, N-21, D10)', () => {
  it('resolves night to dusk and nothing to day', () => {
    expect(resolveTimeOfDay('night')).toBe('dusk');
    expect(resolveTimeOfDay(undefined)).toBe('day');
    expect(resolveTimeOfDay('dawn')).toBe('dawn');
  });
  it('rotates +X toward -Z for a positive angle (N-21)', () => {
    const [x, z] = rotateAzimuth(1, 0, 90);
    expect(x).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(-1, 12);
  });
  // toEqual compares with Object.is, so this is a bit comparison, not a tolerance.
  it('gives day today\'s sun, to the bit', () => {
    const d = sunDirectionFor(TIME_OF_DAY_PRESETS.day);
    const today = new THREE.Vector3(-0.406, 0.819, 0.406).normalize(); // lighting.ts's original literal
    expect([d[0], d[1], d[2]]).toEqual([today.x, today.y, today.z]);
    expect([SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z]).toEqual([today.x, today.y, today.z]);
  });
  it.each([
    ['dawn', 22, -35],
    ['dusk', 18, 35],
  ] as const)('%s: %i degrees up, %i degrees round from today', (t, el, az) => {
    const v = sunDirectionFor(TIME_OF_DAY_PRESETS[t]);
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
    expect(elevation(v)).toBeCloseTo(el, 9);
    expect(azimuth(v) - azimuth(DAY_SUN_DIRECTION)).toBeCloseTo(az, 9);
  });
  it('keeps every sun at 18 degrees or more (the fitted shadow box)', () => {
    for (const p of Object.values(TIME_OF_DAY_PRESETS)) expect(elevation(sunDirectionFor(p))).toBeGreaterThanOrEqual(18 - 1e-9);
  });
  // `day` byte-identical rests on the palette still holding today's hexes.
  it('names palette keys whose hexes are today\'s day constants', () => {
    const day = TIME_OF_DAY_PRESETS.day;
    expect(paletteColor(day.sunKey).toUpperCase()).toBe(SUN_COLOR_HEX);
    expect(paletteColor(day.skyKey).toUpperCase()).toBe(SKY_COLOR_HEX);
    expect(paletteColor('dust.4').toUpperCase()).toBe(GROUND_BOUNCE_COLOR_HEX);
    expect(day.sunIntensity).toBe(2.6);
    expect(day.hemiIntensity).toBe(0.9);
    expect(day.hazeFar).toBe(0.12);
  });
  it('carries the approved dawn and dusk rows', () => {
    expect(TIME_OF_DAY_PRESETS.dawn).toMatchObject({ sunKey: 'limestone.1', sunIntensity: 2.0, skyKey: 'water.0', hemiIntensity: 0.75, hazeFar: 0.16, hazeKey: null });
    expect(TIME_OF_DAY_PRESETS.dusk).toMatchObject({ sunKey: 'dust.0', sunIntensity: 1.8, skyKey: 'gunmetal.1', hemiIntensity: 0.7, hazeFar: 0.18, hazeKey: 'dust.1' });
  });
});
```

  - If `@lions/data`'s `paletteColor` is not importable from a render test (eslint's package rule), read `data/palette.json` by path instead, as other render tests do; say which in a comment.

```ts
// added to lighting.test.ts (THREE, createSceneLights, SHADOW_MAP_SIZE, SHADOW_BOX_TOP and
// SHADOW_BOX_BOTTOM are imported there already, or added with this block)
import { DAY_LIGHTS } from './lighting';
import { TIME_OF_DAY_PRESETS, sunDirectionFor } from './time-of-day';

describe('createSceneLights takes a preset, and day is today', () => {
  it('builds identical lights with no preset and with DAY_LIGHTS', () => {
    const a = createSceneLights(48, 48);
    const b = createSceneLights(48, 48, SHADOW_MAP_SIZE, DAY_LIGHTS);
    for (const k of ['x', 'y', 'z'] as const) expect(Object.is(a.sun.position[k], b.sun.position[k])).toBe(true);
    expect(b.sun.color.getHex()).toBe(a.sun.color.getHex());
    expect(b.sun.intensity).toBe(a.sun.intensity);
    expect(b.hemisphere.color.getHex()).toBe(a.hemisphere.color.getHex());
    expect(b.hemisphere.groundColor.getHex()).toBe(a.hemisphere.groundColor.getHex());
    expect(b.hemisphere.intensity).toBe(a.hemisphere.intensity);
  });
  // A low sun lengthens shadows; the box must still hold every caster.
  it.each(['dawn', 'day', 'dusk'] as const)('%s: every corner of the map box sits inside the shadow frustum', (t) => {
    const [x, y, z] = sunDirectionFor(TIME_OF_DAY_PRESETS[t]);
    const lights = createSceneLights(48, 40, SHADOW_MAP_SIZE, { ...DAY_LIGHTS, direction: new THREE.Vector3(x, y, z) });
    const cam = lights.sun.shadow.camera;
    lights.sun.updateMatrixWorld();
    lights.sun.target.updateMatrixWorld();
    cam.position.copy(lights.sun.position);
    cam.lookAt(lights.sun.target.position);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    for (const cx of [0, 48]) for (const cz of [0, 40]) for (const cy of [SHADOW_BOX_BOTTOM, SHADOW_BOX_TOP]) {
      const p = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
      expect(p.x).toBeGreaterThanOrEqual(cam.left);
      expect(p.x).toBeLessThanOrEqual(cam.right);
      expect(p.y).toBeGreaterThanOrEqual(cam.bottom);
      expect(p.y).toBeLessThanOrEqual(cam.top);
      expect(-p.z).toBeGreaterThanOrEqual(cam.near);
      expect(-p.z).toBeLessThanOrEqual(cam.far);
    }
  });
});
```

- [ ] **Step 2: Implement.**
  - `time-of-day.ts`: the table from N-20; `day` has `elevationDeg: null` and `sunDirectionFor` returns the literal normalised with exactly `Vector3.normalize`'s arithmetic in r170 (`divideScalar(this.length() || 1)`, i.e. `multiplyScalar(1 / Math.sqrt(x * x + y * y + z * z))`; read `node_modules/three/src/math/Vector3.js` and copy the order of operations, or the bit test fails). Dawn and dusk: rotate today's XZ by N-21, then set the elevation.
  - `lighting.ts`: `SUN_DIRECTION` is now built from `DAY_SUN_DIRECTION`; `createSceneLights` reads `lights.direction` and the five colours and intensities from `lights`, defaulting to `DAY_LIGHTS`. The header gains a paragraph: presets, why day is the constants (not the table), and the shadow-box proof.
  - `api.ts`: `RendererOptions.timeOfDay?: TimeOfDay` (three-only; the Pixi backend ignores it, as it does `shellColors`); `TerrainTones.haze: string`.
  - `terrain-themes.ts`: `haze: paletteColor('dust.0')` arid, `paletteColor('limestone.1')` green (N-18).
  - `ThreeRenderer`: resolve `resolveTimeOfDay(opts.timeOfDay)`. For `day`, pass `DAY_LIGHTS` (byte-identical by construction). For dawn and dusk, build `ResolvedLights` from `this.overlayColor(key, fallback)` and `sunDirectionFor`, bounce `dust.4` (N-21). Keep the resolved preset on the renderer for Task 9's haze.
- [ ] **Step 3: Prove day moved nothing.** Before editing, capture the full gate on Task 7's commit: `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground2/t7-full`. After, the same to `t8`, then `ab.ts .superpowers/ground2/t7-full .superpowers/ground2/t8`: **every scenario reads 0 px / 0.0000** (`combat` excepted: it does not hold still between two captures of one commit, so read it against a second `t7-full` run instead). Any pixel is a stop: day is not byte-identical.
- [ ] **Step 4: Dawn and dusk are not judged here.** Nothing can ask for them until Task 10 wires `&tod=`; their captures are Task 10 Step 4. The unit tests above are this task's whole claim about them.
- [ ] **Step 5: Gates, falsify, commit.**
  - **Falsify:** (a) build day from the table's 55° instead of the literal: the bit test goes red, and Step 3's A/B moves on every scenario. (b) dusk at 12°: the 18-degree test goes red. (c) shrink `SHADOW_MARGIN_TILES` to −10: the frustum test goes red. Revert each.
  - Message: `feat(render): dawn, day and dusk presets for the one sun; day is today to the bit (G11)`.

---

### Task 9: The dust haze, inside the fog pass

**Tier:** opus (a shader and `ThreeRenderer.ts`). N-18, N-19, R-13, R-14. **The lead has seen Task 0's mock.**

**Files:**
- Create: `packages/render/src/three/haze.ts` (+test)
- Modify: `packages/render/src/three/fog-pass.ts` (+test), `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/debug-layers.ts` (+test), `tools/src/golden-diff/baseline.ts`

**Interfaces:**

```ts
// haze.ts (three-free)
export const HAZE_RAMP_TILES = 20;
export const HAZE_LOW = 0.06;
export const HAZE_LOW_LEVELS = 2;
/** Away from the camera, horizontally: -(VIEW_DIRECTION.x, VIEW_DIRECTION.z), normalised. */
export const HAZE_FORWARD: readonly [number, number];
export function aheadOf(px: number, pz: number, focusX: number, focusZ: number): number;
export function hazeAmount(aheadTiles: number, levelsBelowRef: number, far: number): number;
/** Median elevation level over unblocked tiles; 0 with no elevation grid (N-19). */
export function hazeReferenceLevel(input: { width: number; height: number; elevation: Uint8Array | null; blocked: Uint8Array }): number;
/** (sunIntensity * sunY + hemiIntensity) / PI: lit open ground's scene-referred scale (R-13). */
export function hazeRadiance(sunIntensity: number, sunY: number, hemiIntensity: number): number;

// fog-pass.ts
export interface HazeSettings { readonly tint: readonly [number, number, number]; readonly far: number; readonly refLevel: number }
// FogOfWarPass gains setHaze(h: HazeSettings), setFocus(x: number, z: number), and uniforms
// uFocus, uHazeTint, uHazeFar, uHazeRef, uHazeAmp. Default uHazeFar 0: an unconfigured pass hazes nothing.
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/render/src/three/haze.test.ts
import { describe, expect, it } from 'vitest';
import { isoY } from '../project';
import { VIEW_DIRECTION } from './camera';
import { HAZE_FORWARD, HAZE_LOW, aheadOf, hazeAmount, hazeRadiance, hazeReferenceLevel } from './haze';

describe('haze (N-18, N-19)', () => {
  it('points away from the camera along the ground', () => {
    const n = Math.hypot(VIEW_DIRECTION.x, VIEW_DIRECTION.z);
    expect(HAZE_FORWARD[0]).toBeCloseTo(-VIEW_DIRECTION.x / n, 12);
    expect(HAZE_FORWARD[1]).toBeCloseTo(-VIEW_DIRECTION.z / n, 12);
  });
  // The claim the mock rested on: on flat ground, further ahead IS higher on screen.
  it('orders flat ground exactly as the screen does', () => {
    for (let i = 0; i < 200; i++) {
      const [ax, az, bx, bz] = [i % 17, (i * 7) % 23, (i * 5) % 19, (i * 3) % 29];
      const da = aheadOf(ax, az, 24, 24);
      const db = aheadOf(bx, bz, 24, 24);
      if (Math.abs(da - db) < 1e-9) continue;
      expect(da > db).toBe(isoY(ax, az) < isoY(bx, bz));
    }
  });
  it('is 0 at and before the focus plane and the full amount at +20 tiles', () => {
    expect(hazeAmount(-5, 0, 0.12)).toBe(0);
    expect(hazeAmount(0, 0, 0.12)).toBe(0);
    expect(hazeAmount(10, 0, 0.12)).toBeCloseTo(0.06, 12);
    expect(hazeAmount(20, 0, 0.12)).toBeCloseTo(0.12, 12);
    expect(hazeAmount(80, 0, 0.12)).toBeCloseTo(0.12, 12);
  });
  it('adds up to 6% on ground 2 levels below the reference, never more', () => {
    expect(hazeAmount(0, 1, 0.12)).toBeCloseTo(HAZE_LOW / 2, 12);
    expect(hazeAmount(0, 2, 0.12)).toBeCloseTo(HAZE_LOW, 12);
    expect(hazeAmount(0, 7, 0.12)).toBeCloseTo(HAZE_LOW, 12);
    expect(hazeAmount(0, -3, 0.12)).toBe(0);
  });
  it('gives a flat map no low-lying term at all (N-19)', () => {
    const flat = { width: 4, height: 4, elevation: null, blocked: new Uint8Array(16) };
    expect(hazeReferenceLevel(flat)).toBe(0);
  });
  it('takes the median over unblocked tiles', () => {
    const elevation = Uint8Array.from([0, 0, 1, 1, 2, 2, 3, 9, 9]);
    const blocked = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(hazeReferenceLevel({ width: 3, height: 3, elevation, blocked })).toBe(1);
  });
  it('scales the tint to lit ground under the day sun', () => {
    expect(hazeRadiance(2.6, 0.8188, 0.9)).toBeCloseTo((2.6 * 0.8188 + 0.9) / Math.PI, 12);
  });
});
```

```ts
// added to fog-pass.test.ts
import { HAZE_LOW, HAZE_LOW_LEVELS, HAZE_RAMP_TILES } from './haze';
import { WORLD_PER_LEVEL } from './terrain/shared';

describe('the haze term (R-13, R-14)', () => {
  const pass = new FogOfWarPass(new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat), 48, 48);
  const src = pass.material.fragmentShader;
  it('carries the tested constants', () => {
    for (const k of [HAZE_RAMP_TILES, HAZE_LOW, HAZE_LOW_LEVELS, WORLD_PER_LEVEL]) expect(src).toContain(k.toFixed(4));
  });
  it('hazes before the fog-of-war mix, and only where something was drawn', () => {
    const early = src.indexOf('if (depth >= 1.0)');
    const haze = src.indexOf('uHazeTint');
    const fog = src.indexOf('mix(color.rgb, shrouded, dim)');
    expect(early).toBeGreaterThanOrEqual(0);
    expect(haze).toBeGreaterThan(early);
    expect(fog).toBeGreaterThan(haze);
  });
  it('hazes nothing until configured', () => {
    expect(pass.uniforms.uHazeFar.value).toBe(0);
    expect(pass.uniforms.uHazeAmp.value).toBe(1);
  });
  it('setHaze and setFocus write the uniforms', () => {
    pass.setHaze({ tint: [0.5, 0.4, 0.3], far: 0.12, refLevel: 2 });
    pass.setFocus(10, 20);
    expect(pass.uniforms.uHazeFar.value).toBe(0.12);
    expect(pass.uniforms.uHazeRef.value).toBe(2);
    expect(pass.uniforms.uHazeTint.value.toArray()).toEqual([0.5, 0.4, 0.3]);
    expect(pass.uniforms.uFocus.value.toArray()).toEqual([10, 20]);
  });
});
```

- [ ] **Step 2: Implement.**
  - GLSL, after `world` is reconstructed and before the shroud sample (R-14); the capitalised names are the `haze.ts` and `shared.ts` constants interpolated with `toFixed(4)`, `HAZE_FORWARD` as a `vec2(...)` literal:

```glsl
float rlAhead = dot(world.xz - uFocus, vec2(HAZE_FORWARD));
float rlBelow = uHazeRef - world.y / WORLD_PER_LEVEL;
float rlHaze = uHazeAmp * (uHazeFar * clamp(rlAhead / HAZE_RAMP_TILES, 0.0, 1.0)
                         + HAZE_LOW * clamp(rlBelow / HAZE_LOW_LEVELS, 0.0, 1.0));
color.rgb = mix(color.rgb, uHazeTint, rlHaze);
```

    with every constant interpolated with `toFixed(4)` from `haze.ts` and `shared.ts`. `hazeAmount` is the same expression; the two are the mirror pair.
  - `ThreeRenderer`: after the fog pass is built (`:2469`), `setHaze` with tint = `hexToLinear(preset.hazeKey ? this.overlayColor(preset.hazeKey, '#D1A668') : opts.terrainTones.haze)` × `hazeRadiance(preset sun intensity, sun direction y, preset hemi intensity)`, `far = preset.hazeFar`, `refLevel = hazeReferenceLevel(retained terrain input)` (recomputed when the terrain rebuilds; elevation never changes, so once is enough, but a rebuild is where the input is in hand). In `frame()`, beside `fogPass.updateCamera`, `setFocus(camera.x, camera.y)` in world units: confirm that `renderer.worldToScreen(camera.x, camera.y, 0)` is the screen centre, and add 0.5 if the camera's x, y name a tile's corner rather than its centre.
  - `DEBUG_LAYERS` gains `'haze'`: `uHazeAmp` to 0 or 1, returning 1 when it changed. The `fog` layer does not touch it, and hiding `haze` does not touch `uRevealAll`.
- [ ] **Step 3: Compare with the mock.** `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground2/t9-r1`. Put `quiet` and `relief` beside Task 0's mocks for the lead. They will not match to the pixel (linear mixing, the low-lying term on `relief`'s hills), and the differences are named when handed over.
- [ ] **Step 4: The `haze` checks** on `quiet` and `relief`, three runs (`t9-r1` to `t9-r3`), provisional floors 0/0 first. Floors a third of the smallest. Every pre-existing check still clears its floor: haze is in both photographs of every toggle pair, so a toggle's delta moves by at most the haze's 12% attenuation of it. **An existing check under its floor is a stop** (Global Constraints).
- [ ] **Step 5: Gates, falsify, commit.**
  - **Falsify:** (a) the `if (depth >= 1.0)` early-out moved after the haze: photograph the letterbox around `tutorial_ground` at zoom 0.35 turning dust-coloured. (b) `uHazeFar` left at its default 0 (the `setHaze` call removed): the `haze` checks go red at 0 px. (c) `HAZE_RAMP_TILES` changed in TS only: the constants test goes red. Revert each.
  - Message: `feat(render): dust hazes the far side of the frame and the low ground (G11)`.

---

### Task 10: The app picks the light: `time_of_day`, and `&tod=` in the sandbox

**Tier:** sonnet. R-12, N-23, D10, D11.

**Files:**
- Create: `packages/app/src/time-of-day.ts` (+test)
- Modify: `packages/app/src/main.ts`, `packages/app/src/sandbox-help.ts` (+test), `packages/app/src/shell/links.test.ts` (only if it pins `KNOWN_PARAMS`' size)

**Interfaces:**

```ts
// packages/app/src/time-of-day.ts
import type { TimeOfDay } from '@lions/render';
export const TIMES_OF_DAY: readonly TimeOfDay[]; // ['dawn', 'day', 'dusk', 'night']
export function isTimeOfDay(v: unknown): v is TimeOfDay;
/** A mission's authored value wins; the sandbox reads `&tod=`; anything else is day.
 *  An unrecognised value falls back to day and returns a warning naming it. */
export function timeOfDayOf(
  mission: { readonly map: object } | null,
  params: URLSearchParams
): { readonly value: TimeOfDay; readonly warning: string | null };
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/app/src/time-of-day.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timeOfDayOf } from './time-of-day';

const P = (q: string): URLSearchParams => new URLSearchParams(q);
const MISSIONS = join(__dirname, '../../../data/missions');

describe('timeOfDayOf (R-12, N-23)', () => {
  it('takes a mission\'s authored value', () => {
    expect(timeOfDayOf({ map: { file: 'x', time_of_day: 'dawn' } }, P('')).value).toBe('dawn');
  });
  it('ignores &tod= on a mission (N-23)', () => {
    expect(timeOfDayOf({ map: { file: 'x', time_of_day: 'day' } }, P('tod=dusk')).value).toBe('day');
    expect(timeOfDayOf({ map: { file: 'x' } }, P('tod=dusk')).value).toBe('day');
  });
  it('reads &tod= in the sandbox, and passes night through (the renderer maps it, D10)', () => {
    expect(timeOfDayOf(null, P('sandbox=qarn_hadid&tod=dusk')).value).toBe('dusk');
    expect(timeOfDayOf(null, P('tod=night')).value).toBe('night');
  });
  it('falls back to day with a warning that names a bad value', () => {
    const r = timeOfDayOf(null, P('tod=noon'));
    expect(r.value).toBe('day');
    expect(r.warning).toMatch(/noon/);
    expect(timeOfDayOf(null, P('')).warning).toBeNull();
  });
  // D11: the mechanism ships with today's two authored values; nothing else changes.
  it('reads every shipped mission without a warning, and finds exactly the two authored values', () => {
    const found: Record<string, string> = {};
    for (const f of readdirSync(MISSIONS).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(MISSIONS, f), 'utf8')) as { map: { time_of_day?: string } };
      const r = timeOfDayOf(m, P(''));
      expect(r.warning, f).toBeNull();
      if (m.map.time_of_day !== undefined) found[f] = r.value;
    }
    expect(found).toEqual({ 'beit_sahwan_breach.json': 'dawn', 'beit_sahwan_0_tutorial.json': 'day' });
  });
});
```

  - `sandbox-help.test.ts`: `tod` is a known parameter (so `unknownParams(P('sandbox=x&tod=dusk'))` is `[]`), and `sandboxHelp` prints its blurb.
- [ ] **Step 2: Implement.** `KNOWN_PARAMS` gains `{ name: 'tod', blurb: 'dawn | day | dusk | night — the sandbox’s light; a mission uses its own' }`. In `main.ts`, beside `decalShowcase` (`:1655`): `const tod = timeOfDayOf(mission ?? null, params)`; warn with `tod.warning` when set; `timeOfDay: tod.value` in `opts`. Re-grep how `main.ts` names its `URLSearchParams` and its mission object.
- [ ] **Step 3: Drive it in the UI** (memory: console shortcuts skip the code that breaks). On port 5196, open `?sandbox=beit_sahwan_outskirts&tod=dusk` from the `?sandboxes` picker's own launch link with `&tod=dusk` appended in the address bar, and check the console prints no unknown-parameter warning; then `?sandbox=beit_sahwan_outskirts&tod=noon` warns by name. Launch `beit_sahwan_breach` from the campaign shell and confirm the dawn sun (long shadows toward screen-right-down) with a screenshot.
- [ ] **Step 4: The captures for the lead.** `?sandbox=beit_sahwan_outskirts` and `?sandbox=wadi_halam_basin` at `&tod=dawn`, `day`, `dusk`, zoom 0.5 and 1, fog hidden, to `.superpowers/ground2/tod/`.
- [ ] **Step 5: Gates, falsify, commit.**
  - **Falsify:** let `&tod=` win on a mission: the N-23 test goes red. Drop `tod` from `KNOWN_PARAMS`: the sandbox-help test goes red. Revert.
  - Message: `feat(app): a mission's time_of_day lights the map; &tod= does it in the sandbox (D10, D11)`.

---

### Task 11: The gate: the dusk capture, and every floor re-measured once

**Tier:** sonnet.

**Files:**
- Modify: `tools/src/golden-diff/capture-protocol.ts`, `tools/src/golden-diff/baseline.ts`
- Create: `tools/src/golden-diff/dusk.test.ts`

**Interfaces:** `export const DUSK_SCENARIO: Scenario`, added to `SCENARIOS` after `AFTERMATH_SCENARIO`: `QUIET_SCENARIO`'s map, camera, zoom and tick, with `sandboxFlags: ['tod=dusk']`. `BASELINES.dusk`: `gated: false`, no `layerChecks`, a comment in `combat`'s style saying why (spec §3.6: "`dusk` is a report-only capture"; a preset is pinned by unit tests, and one lit frame is judged by the lead's eye, not a threshold).

- [ ] **Step 1: Write the failing test.**

```ts
// tools/src/golden-diff/dusk.test.ts
import { describe, expect, it } from 'vitest';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { DUSK_SCENARIO, QUIET_SCENARIO, SCENARIOS, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';

describe('the dusk capture (spec §3.6)', () => {
  it('is quiet\'s frame under the dusk preset', () => {
    expect(DUSK_SCENARIO).toMatchObject({
      sandboxMap: QUIET_SCENARIO.sandboxMap,
      cameraMarker: QUIET_SCENARIO.cameraMarker,
      targetTick: QUIET_SCENARIO.targetTick,
    });
    const url = new URL(threeUrl(5195, DUSK_SCENARIO));
    expect(url.searchParams.get('tod')).toBe('dusk');
    expect(unknownParams(url.searchParams)).toEqual([]);
  });
  it('is captured and reported, and does not vote', () => {
    expect(SCENARIOS).toContain(DUSK_SCENARIO);
    expect(isGated(BASELINES.dusk)).toBe(false);
    expect(BASELINES.dusk.layerChecks ?? []).toEqual([]);
  });
});
```

  - `sceneParam` appends `&<flag>` verbatim, so `'tod=dusk'` becomes `&tod=dusk`. If it encodes the `=`, extend it to pass `name=value` through and add a case to its own test.
- [ ] **Step 2: Implement** the scenario and its entry.
- [ ] **Step 3: Three full-gate runs** on the branch: `pnpm golden-baseline -- --port=5195 --out-dir=.superpowers/ground2/t11-r<k>`, k = 1 to 3. Record the gate's wall-clock time against Task 0's.
- [ ] **Step 4: Re-measure every layer check once.** For every check on every gated scenario:
  - **Signal fell below the floor:** a stop (Global Constraints), except the N-7 scatter floors already re-derived in Task 2.
  - **A third of the new minimum is above today's floor** (the `decor` checks after the density, crowns and props; the scatter checks if the decor re-measure raised them): raise the floor to it, and put the three readings in the rationale. Floors are minimums; raising one to a third of a larger measured signal is not a widening.
  - Unchanged within 5%: leave the floor, add the readings.
  - Record every check's before and after floor in the commit body as a table.
- [ ] **Step 5: The A/B against main.** `ab.ts .superpowers/ground2/t0 .superpowers/ground2/t11-r1`. Expected: `quiet`, `open-ground`, `vehicle`, `relief` and `aftermath` all move; `combat` moves (report-only); `dusk` is new. Write the figures into the ledger for Task 12's PR body.
- [ ] **Step 6: Gates, falsify, commit.**
  - **Falsify:** drop `'tod=dusk'` from the scenario: the URL test goes red. Mark `dusk` gated: the report-only test goes red. Revert.
  - Message: `feat(tools): the dusk capture, and every ground floor re-measured once for plan 2`.

---

### Task 12: Costs, the review captures, the record, and bless 2

**Tier:** sonnet for measurement, haiku for the prose; opus reviews the whole branch before the push.

**Files:**
- Modify: `docs/PERFORMANCE.md` (a new section, "The ground, plan 2 (WP-A2)"), `CLAUDE.md` (under "The three.js backend"), `docs/superpowers/specs/2026-09-25-ground-design.md` (status line; §9 gains "Deviations (plan 2, as landed)")

- [ ] **Step 1: Costs, after.** Task 0 Step 6's commands on HEAD, same ports, same machine, with main re-run in the same session, interleaved, **n = 5 per view** for `render-frame-cost`.

  | Check | Budget | Expected |
  |---|---|---|
  | Calls | +3 (props × three passes), cap +6 across both plans | +3 where props are in frame, +0 elsewhere |
  | Acceptance p95 | ≤ +0.74 ms on every view | |
  | `qarn_hadid` z1.6 | after-mean ≤ before-mean + 0.20 ms, gpu and cpu | from 14.86 gpu (fix wave, n = 5) |
  | Every acceptance view | ≤ 14.5 ms p95, `qarn_hadid` z2.5 and z0.5 named as pre-existing | |
  | `perf:units` at 300 | ≤ 7.5 ms p95 | 7.30–7.60 today |
  | `wadi_halam_basin` tris | about −3.4M a pass (D8) | not an acceptance view: reported |
  | Props | ≤ 150 a map, ≤ 60k tris a pass | per-map counts |

  - Prove the props batch draws three times (shadow, AO, main) with plan 1's `renderBufferDirect` wrap, and that hiding `props` moves calls by exactly 3 on a view with props.
  - **A missed budget is reported to the lead with the shed ladder already measured (Task 5 Step 7's table, re-taken if Tasks 6–9 moved it). It is not traded silently.**
- [ ] **Step 2: Review captures for the lead.** `ground:capture` at zoom 0.35, 1 and 2.5 for `beit_sahwan_outskirts`, `qarn_hadid`, `tel_marum` and `wadi_halam_basin`, before (`cost-t0`) and after, plus Task 10's dawn/dusk set and a close-up of each prop kind in place. The lead judges N-11 (props on cover-0 ground) and the crowns here. **The merge and the bless wait for the lead's word on these.**
- [ ] **Step 3: Other harnesses.** `pnpm blast:capture -- --port=5199`: every floor still passes (the haze and the sway are in its frames now). A floor under its value is a stop, as in the golden gate.
- [ ] **Step 4: The record.**
  - **CLAUDE.md**, "The three.js backend", only what a later agent would get wrong: grass and sand are clusters with a density dial and the shed ladder; props are one vertex-coloured batch whose colour is baked at load from `prop-role.ts`, not in the GLB; the olive is decimated by face count (R-9); sway runs on sim time in the foliage batch only and the shadow keeps the rest pose; haze lives in the fog pass, before the shroud, and a flat map has no low-lying term; `day` is the constants, not the table; `&tod=` is sandbox-only; the gate's new `props`, `wind` and `haze` checks and the report-only `dusk`. Numbers with their conditions. Edit as a section, never wholesale.
  - **PERFORMANCE.md:** Step 1's tables with capture conditions and n.
  - **The spec:** status line `plan 2 landed <sha>`; Deviations R-1 to R-14 with what was measured, and every stop that fired with the lead's ruling.
- [ ] **Step 5: Final gates.** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data && pnpm validate:ui && pnpm validate:assets && pnpm validate:meshes && pnpm playtest`. `git diff --stat b6497c12..HEAD -- packages/sim` is empty.
- [ ] **Step 6: Push, read CI, and bless once after merge.**
  1. Before pushing, `gh run list --limit 5`: if runs show red with no logs, read the annotation first (memory: an Actions billing block looks like a failure). No bless is attempted while CI cannot run.
  2. Push `feat/ground-plan2`; open the PR. Its body lists what moves each scenario:

     | Scenario | Moves by |
     |---|---|
     | `quiet` | clusters, grain trims, props, desert crowns, sway at tick 200, haze |
     | `open-ground` | cluster density, grain trims, haze (a crop low in the frame: small) |
     | `vehicle` | clusters, grain trims, haze |
     | `relief` | clusters, grain trims, haze, including the low-lying term on Tel Marum's basin |
     | `aftermath` | clusters, grain trims, props, haze |
     | `combat` | report-only |
     | `dusk` | new, report-only, no baseline |

     The body names the AI-art disclosure: the olive and desert trees are re-exports of Meshy-generated sources (as before, now decimated or re-crowned); the seven props are Blender-procedural with no AI geometry.
  3. Read the PR's `visual` job (`gh run view <id> --log`, the `[golden-diff]` block, and the `visual-baseline-output` artifact). For each moving scenario, confirm the diff sits on the ground, trees and props, not on the HUD strip or units, and that every layer check passes on `linux-x64-swiftshader`. Write the numbers into the PR.
  4. **The lead merges.** Then, once, from main: `gh workflow run visual-baseline-bless.yml --ref main -f reason="WP-A2 plan 2 (<sha>): clustered grass and sand (0.9 an open tile), D9 grain trims, seven props in one batch, desert crowns and the olive LOD (D8), sway on sim time, haze, dawn/day/dusk presets. Moves quiet, open-ground, vehicle, relief, aftermath; adds report-only dusk. Layer checks props/wind/haze added; scatter floors re-derived under N-7; decor floors re-measured."`
  5. When the bless lands, push an empty commit so CI runs on the Actions-authored baseline, and `gh run list` until `visual` is green. One bless in flight at a time.

---

## Self-review

**Spec coverage.**

| Spec item | Task |
|---|---|
| §3.4 clusters: seeds 0.09 × 6–10 within 0.5–1.2, singletons 0.15, 0.9 / open tile | 1 (N-1 to N-3) |
| §3.4 excluded from the road SDF, pads and ditches | 1 (N-3, tested on synthetic and all 26 maps) |
| §3.4 cover tiles double their bush roll | 1 (N-5) |
| §5 grass height ≤ 0.12 wu | 1 (N-4, against the shipped GLBs) |
| §3.4 D9: discs retire, flecks halve | 2 (N-6); floors N-7 |
| §3.4 props: seven kinds, Blender kit, palette roles, `validate:meshes` | 3 (R-5 to R-7) |
| §3.4 props near structures and roads, ≤ 150, ≤ 400 tris, one batch, baked vertex colour | 4, 5 (N-9 to N-12, R-6) |
| §3.4 cost +3 calls, +240k tris a pass; `props` check on `quiet` and `aftermath`; `decor` floors re-measured, never widened | 5, 11, 12 |
| §3.5 desert crown on var1/var3 trunks, three variants, sources untouched | 6 (N-13, N-14, R-10) |
| §3.5 olive LOD at export, D8, ≤ 3,000 tris | 6 (N-15, R-9) |
| §3.5 sway in the foliage material on the sim clock; shadow and AO keep rest pose; `groveMesh` wind path deleted; `wind` check on `quiet` | 7 (N-16, N-17, R-11) |
| §3.6 haze inside the fog pass, by view depth past the focus plane, low-lying term, +0 passes | 9 (N-18, N-19, R-13, R-14) |
| §3.6 sky colour on the hemisphere light | 8 (`skyKey` per preset) |
| §3.6 `RendererOptions.timeOfDay` from `map.time_of_day`, default day; `&tod=` in the flag table | 8, 10 (R-12, N-23) |
| §3.6 day byte-identical; night → dusk; sun ≥ 18° inside the shadow box | 8 (bit test, A/B at 0 px, frustum test) |
| §3.6 `haze` check on `quiet` and `relief`; presets pinned by unit tests; `dusk` report-only | 9, 8, 11 |
| §4 plan-2 column: every scenario and what moves it | 12 Step 6 |
| §5 numbers | constants in Tasks 1, 2, 4, 6, 7, 8, 9, each pinned by a test |
| §6 D7 (Meshy only on a failed review, after October), D8, D9, D10, D11 | 3, 6, 2, 8, 10 |
| §8 perf acceptance; a miss sheds scatter first; `perf:units` after the scatter | 0, 5 Step 7, 12 (N-22) |
| G8, G9, G11 | 1–5, 6–7, 8–9 |

**Every check has an input that makes it fail**, named in its task:

| Task | Mutations |
|---|---|
| 1 | uniform members (Clark–Evans), no road clearance, grass scale 1.2 |
| 2 | earth branch restored, old fleck count, the 671acdb no-op after the trims |
| 3 | a foliage-tagged part, a material on a prop |
| 4 | scan-order acceptance, cover not excluded, a second material |
| 5 | no placements in `composeTerrain` → `props` red |
| 6 | 12,000-tri olive, three-clump crown |
| 7 | wall-clock sway (photographed), amplitude 0 → `wind` red, TS-only phase change |
| 8 | 55° day (bit test and A/B), 12° dusk, a shrunken shadow margin |
| 9 | early-out after the haze (photographed), no `setHaze` → `haze` red, TS-only ramp change |
| 10 | `&tod=` winning on a mission, `tod` not a known parameter |
| 11 | no `tod=dusk` flag, `dusk` gated |

**Placeholder scan.**
- Numbers left to measurement, and how each is set: every new floor (a third of the smallest of three runs: Tasks 5, 7, 9); the N-7 scatter floors (Task 2); the re-measured floors (Task 11); the real-map density (Task 1, inside a band the test states); the sway in pixels (Task 7, reported, not tuned).
- Bodies specified by steps rather than written out: the Blender builders (Tasks 3 and 6, each constrained by a TS contract test on the shipped bytes); the GLSL in Tasks 7 and 9, each the transcription of a tested mirror whose constants it interpolates; the `ThreeRenderer` wiring in Tasks 5, 7, 8 and 9, voted on by the layer checks and, for `day`, by a 0 px A/B.
- No "TBD", no "similar to Task N", no unnamed file.

**Type consistency.**
- `DecorPlacement` is unchanged; `decorPlacements` gains an optional `density`.
- `PropKind`, `PROP_KINDS`, `PropMeshRole`, `PROP_TRI_CAPS` (Task 3) are consumed by `prop-place.ts`, `prop-mesh.ts`, `mesh-catalogue.ts` (Task 4) and `loadPropMeshes` (Task 5). `PROP_ROLES` in Python is pinned to `PROP_MESH_ROLES` by a test.
- `PropPlacement` (Task 4) is produced by `composeTerrain` and consumed by `buildPropMesh` (Task 5).
- `SwayUniforms` (Task 7) is owned by `ThreeRenderer` and passed to `buildDecorMesh`.
- `TimeOfDay` is declared once in `render/src/three/time-of-day.ts`, re-exported by `api.ts`, and imported as a type by the app (Task 10). `LitTimeOfDay` never leaves the renderer.
- `TerrainTones.haze` (Task 8) is set in `terrain-themes.ts` in the same task, so the compiler catches a theme without one.
- `DEBUG_LAYERS` gains `props` (5), `wind` (7) and `haze` (9).
- `MeshData.sway` and `GroveMaterial` go in Task 7 with every reader.

**Model tiering.**
- **Opus:** Tasks 5, 7, 8 and 9 (shaders, lights and `ThreeRenderer.ts`), plus the final review.
- **Sonnet:** Tasks 1, 2, 3, 4, 6, 10, 11 and 12's measurement (3 and 6 run as the `blender-art` agent type).
- **Haiku:** Task 12's prose.

Nothing inherits opus by default.

**R-n → Deviations at landing.** R-1 to R-14, in order, in the spec (Task 12).

## Out of scope

- **Meshy**, before October's credits and without the lead's go: the wrecked car (D7, 30 credits, about $0.60) and the road grain (D3, ≤ 45 credits), each with `pnpm meshy -- estimate` first.
- **`grove.ts` and `buildGroves`** (R-11): dead since the mesh trees, still barrel-exported and tested. Deleting them touches `terrain-parity.test.ts` and the barrel; a follow-up.
- **`tree_1` = `tree_2` byte-identical** (R-9): an olive art judgement, recorded in the export script.
- **Pads' soft edge** (plan 1 R-4) and **deleting `road_track_tile.jpg`** (plan 1 R-7): unchanged follow-ups.
- **The ditch's 38k tris a segment**: still the next ground cost, and still the owner of `qarn_hadid` z2.5's miss.
- **Which missions get dawn or dusk** (D11): the campaign-designer assigns them; this plan ships the mechanism and today's two values.
- **`night` as its own light** (D10), **Pixi parity**, **`packages/sim/**`**.

## Execution order

0 → (lead: numbers table and haze mock) → 1 → 2 → 3 → (lead: prop previews) → 4 → 5 (costs after the scatter) → 6 → 7 → 8 → 9 → 10 → 11 → 12.

- Task 6 (Blender) is independent of Tasks 1–5 and may run in its own worktree in parallel once the lead has approved N-13 to N-15, if the ledger tracks it; its GLBs land before Task 7's `wind` floors are measured, since the crowns are most of what sways. Task 3 is independent of Tasks 1–2. Everything that edits `ThreeRenderer.ts` (5, 7, 8, 9) runs strictly in that order, one at a time.
- **Stop conditions, each reported to the lead with numbers rather than worked around:**
  - a scatter tone ratio under 0.8 after D9 (Task 2);
  - a real map outside the 0.65–1.0 density band, or `decorPlacements` above 15 ms warm (Task 1);
  - a new check's signal under its minimum-signal line (`props` 300 px, `wind` 150 px / 0.02);
  - any existing layer check under its floor (Tasks 5, 9, 11), other than N-7;
  - `day` not 0 px against the previous capture (Task 8);
  - any budget missed: `qarn_hadid` z1.6 up by more than 0.20 ms, any view up by more than 0.74 ms, 300 figures over 7.5 ms, calls over +3 (Tasks 5 and 12);
  - a `blast:capture` floor under its value (Task 12);
  - a Blender export that is not byte-identical run to run (Tasks 3 and 6).
- The lead's word gates four points: the numbers table and the haze mock (Task 0), the prop previews (Task 3), the tree previews (Task 6), and the review captures (Task 12).
- The bless is last, once, after the lead merges, from CI numbers.
