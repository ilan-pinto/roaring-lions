# The ground — design (WP-A2, art Phase 2, #182 with #226)

**Date:** 2026-09-25 · **Status:** plan 1 landed `64afcf3b`, with the post-review fix wave on top (on `feat/ground`; merge and bless 1 wait for the lead's word on the zoom-0.35 captures). §5 and D8 were approved by the lead on 25 Sep. **Plan 2's Tasks 0–11 landed `17480db0`** on `feat/ground-plan2`, all reviewed and Approved. **Task 12 part B (this measurement) found a STOP: `beit_sahwan_outskirts` (22,24) z0.5 misses its frame-cost budget** — gpu p95 rises +0.83 ms mean / +0.80 ms median over the +0.74 ms cap, n = 10, interleaved, quiet machine, distributions non-overlapping (docs/PERFORMANCE.md, "The ground, plan 2"). Per the plan's own stop-condition rule, no code was changed to chase it and the shed ladder Task 5 already measured is reported alongside it for the lead's choice of rung. **Merge, push and bless 2 wait on the lead's ruling on this stop, in addition to the lead's word on the review captures** (same precondition plan 1 carried). Every other Step 1 budget passes, including the `qarn_hadid` z1.6 stop condition the plan names explicitly (branch reads 0.86–1.07 ms faster than main, resolving the straddle Task 0/Task 5 left open) and every `blast:capture` floor (all 8 subjects now settle and pass, including the 2 part A could not measure). What plan 2 did differently from this text is in §10, Deviations (plan 2, as landed).
**Lands as:** two plans, two blesses, `perf:units` re-run after the scatter. **Constraint:** Meshy credits
arrive in early October, so everything here is procedural or Blender. Meshy appears only as a later, optional
swap with a credit estimate.

## 1. Problem: today's ground, audited

**Conditions.** Playwright, own dev server (:5195), ANGLE/Metal (M3 Pro), 1400×900 DPR 1, frame loop
frozen, HUD hidden. Four maps via `?sandbox=`, at zoom 0.5, 1 and 2.5 plus a road close-up each; fog hidden
unless a name says `-fog`. **Aftermath:** `&sur`, eight attack-moves into the hostile centroid 250 ticks
apart, then 600 ticks and 30 s of presentation (`-settled-`). **Cost:** `renderer.info` over one
`frame(1, 0)`, all passes. Everything is in `.superpowers/ground-spec/audit/` (git-ignored).

| # | Finding | Capture |
|---|---|---|
| G1 | **Roads read as painted zones**: saturation 0.58–0.64, luminance 124, against sand's 0.26 / 172. Edges step tile by tile, two rut dashes repeat every tile, and junctions draw a lattice. | `beit_sahwan_outskirts-road-z2.5-nofog` |
| G2 | **Diagonal roads fall apart into beads.** Tiles touching only at a corner each draw an isolated diamond (`roadAxisAt` sees no neighbour). | `qarn_hadid-centre-z1-nofog` |
| G3 | **Every surface change is a hard tile edge** (pads, grove floor, scrub, knoll), because the six masks are per-vertex and no vertex is shared. | `qarn_hadid-road-z2.5-nofog`, `wadi_halam_basin-centre-z1-nofog` |
| G4 | **No macro variation.** The std of 16 px block means is 0.6% of the mean on `beit` open ground at zoom 0.5 (1.7% on green): a felt table. | `*-centre-z0.5-nofog` |
| G5 | **Defect: the skirt shows through relief** as blue-grey bands, in sight and under fog. Hiding `skirt` turns a band pixel (175,170,157) into (184,169,136). Cause: the skirt spans the footprint at −0.01; Catmull-Rom undershoots to −0.077. | `probe-tm-base` vs `probe-tm-no-skirt`, `tel_marum-centre-z1-fog` |
| G6 | **The ground forgets a battle.** 130 s of combat wrote 18 scorch marks, two of them readable at zoom 1. There are no craters, rubble or oil; wrecks sit on clean sand. | `beit_sahwan_outskirts-settled-z1-nofog`, `-z2.5-` |
| G7 | **Tracks are planks**: one colour at 35%, overlapping stamp rectangles, no tread, no fade (they vanish at 180 s), and a lattice where vehicles turn. | `qarn_hadid-settled-z2.5-nofog` |
| G8 | **Scatter is sparse and even**: 0.20–0.27 grass or sand objects per open tile (566–973 a map). The flat grain reads as confetti and polka dots at zoom 2.5. | `tel_marum-centre-z2.5-nofog` |
| G9 | **Trees.** The desert tree (344–456 tris) is a twig at zoom 1. 322 olives at 13.4–14.2k tris are 9.17M of `wadi_halam_basin`'s 11.19M. Nothing sways: the wind drives the empty `groveMesh`. | `beit_sahwan_outskirts-centre-z1-nofog`, `wadi_halam_basin-centre-z1-nofog` |
| G10 | **Ridges read as cardboard**: flat plates, slab marks, vertical walls, no apron. | `qarn_hadid-centre-z1-nofog` |
| G11 | **One light, no air.** Nothing reads `map.time_of_day` (dawn/day/dusk/night) and 2 of 27 missions set it. The far edge of the frame is as crisp as the near. | all |

**Cost today** (zoom 1, map centre, all passes; decor and scatter as calls / tris):

| Map | Calls | Tris | Decor | Scatter | Units (calls) |
|---|---|---|---|---|---|
| beit_sahwan_outskirts | 346 | 2.23M | 12 / 354k | 2 / 54k | 205 |
| tel_marum | 260 | 1.95M | 9 / 342k | 2 / 43k | 209 |
| qarn_hadid | 378 | 5.44M | 15 / 2.74M | 2 / 56k | 235 |
| wadi_halam_basin | 667 | 11.19M | 12 / 9.17M | 2 / 88k | 173 |
| beit, mid-battle | 660–682 | 3.8–3.9M | 12 | 2 | 173–191 |

A shadow-casting mesh draws three times (shadow, AO, main); units are ~60% of calls. The binding budget is
the lit renderer's acceptance frame, **12.2–13.2 ms p95 at DPR 2 against 16.7** (PERFORMANCE.md), which
leaves about 3.5 ms.

## 2. Goals and non-goals

**Goals.** One continuous surface; a road that is a track; a battle that marks the ground for the mission;
clustered, town-aware scatter; trees with moving crowns; air and a time of day; a toggle check that can fail
for every new draw layer. Budget: +4 calls planned (cap +6), cap +1.5 ms p95.

**Non-goals.** Weaker cover legibility (§3.1); any sim change; Pixi parity; night; 3D rubble; decor
overrides (#138); Meshy before October; the ditch's 38k tris (recorded in §8).

## 3. The elements

### 3.1 Splat terrain (plan 1)

- **Control map.** A pure builder samples the grid at 8 texels a tile into two RGBA8 textures (384² per map).
  A holds open, rock, scrub strength and grove; B holds knoll and road SDF. `GroundMaterial` samples these
  instead of the six vertex masks. The ratio-to-mean albedo stays, so each surface still averages to its
  palette tone.
- **Edges.** Weight falls across a 0.5-tile band centred on the tile edge. The band is noise-bent, and each
  weight is height-biased by its own texel luminance. "Blurred 1.5 tiles" applies to the **macro colour only**
  (D1): blurring identity would smear a lone cover-1 tile, and the ground is how the player reads cover.
- **Macro field.** A map-sized R8 field that never repeats, from a `tileHash`-seeded fbm, applied as a
  luminance ratio around 1 plus a small hue pull. No asset.
- **Ridges (G10).** The rock weight bleeds a scree apron onto the foot tile.
- **Skirt (G5).** It becomes a ring with the footprint cut out.
- **Cost.** +0 calls, +0 tris, 7 → 10 texture taps per ground fragment, 1.2 MiB per map, estimated ≤ 0.3 ms.
- **Gate.** `ground-albedo` is unchanged. New `macro` check (amplitude 0) on `open-ground` and `relief`.
  `skirt` is re-measured on `relief`, whose baseline carries G5.

### 3.2 The road (#226, plan 1)

- **A distance field, not a tile flag.** A pure road graph links `r` tile centres: four neighbours, plus a
  diagonal when neither orthogonal cell between is road. That fixes G2 without making triangles at L-bends. The
  distance to the graph is baked into control B.
- **Shader** (inside `GroundMaterial`, no new mesh), from the centreline out:
  - a packed surface;
  - a worn, noise-bent edge;
  - a lighter gravel shoulder;
  - two ruts as |d| bands, broken by world noise and faded near junctions, so a crossroads reads as trampled
    rather than as rings.
- **Surface grain** reuses `knoll_scree_tile` as a world-space ratio, so no asset is needed.
  `road_track_tile` and the scatter rut dashes retire from road tiles.
- **Later Meshy swap (optional).** A tileable packed-dirt image replaces that one grain sample; the edges and
  ruts stay procedural. Estimate: ≤ 3 tries × ≤ 15 credits = **≤ 45 credits, ~$0.90** at the unconfirmed
  $0.02 a credit, through `pnpm meshy -- estimate`, after the lead's go (D3).
- **Cost.** +0 calls, one shared tap, about 20 ALU per road fragment.
- **Gate.** New `roads` check (road channel to 0) on `quiet`, where the town crossroads is in frame, and on
  `aftermath`.

### 3.3 The decal pool (plan 1)

- **One pool class, two instances.** Each decal is a 4×4-vertex grid (18 tris) that samples `surfaceWorldY`
  per vertex, so decals conform to relief. That closes the lead's open item on scorch over slopes; terrace tiles
  are skipped.
  - **Persistent** (1024): craters, scorch, rubble, oil.
  - **Fading** (4096): tread and tyre.

  `scorch-decals.ts` and `vehicle-tracks.ts` fold in (D5).
- **Kinds are procedural SDFs in one shader**, with no texture, so neither asset gate applies. Track stamps are
  exactly one spacing long with feathered ends, so abutting stamps never double their alpha (G7).
- **Seeding at existing call sites.** A1.2's scorch stays (vehicle kill, mortar and Grad landings). Added: a
  crater at `shellHasLanded`, oil under a vehicle kill, and rubble at `spawnCollapseFx`.
- **Sim-time clock.** Fades run on tick × 50 ms + alpha, never accumulated `dtMs`, so a capture at a pinned
  tick repeats. The renderer only reads the tick (invariant 4).
- **Cost.** +1 call, main pass only; plan 1 proves via `renderer.info` that the pool stays out of the shadow
  and AO passes. ≤ 27k tris, about 0.9 MiB of buffers.
- **Gate.** New `decals` check (replaces `scorch`). No gated scenario has combat, so `&decals` stamps a fixed
  showcase (every kind, three powers, flat, relief and road) through **the entry the event path calls**, pinned
  by a unit test. A new gated `aftermath` (`qarn_hadid&decals`) carries the `decals`, `roads`, `macro` and
  `scatter` checks (D4): about 7 s and 75 KiB a baseline set.

### 3.4 Scatter (plan 2)

- **Clusters.** `tileHash` seeds with 6–10 members, plus singletons, excluded from the road SDF, pads and
  ditches. Open ground goes from 0.25 to **0.9 objects a tile (3.6×)**, about 2,300–2,600 placements a map.
  Cover tiles double their bush roll.
- **Flat-grain trims (D9).** The open-ground discs retire and the flecks halve; splat and macro carry the
  texture now.
- **Props (ART_PIPELINE §6).** Jersey barrier, water tank, satellite dish, laundry line, tyre pile, rebar and
  wrecked car, built as a **Blender kit** (`tools/terrain/props.py`) in palette roles and passed through
  `validate:meshes`. They sit near structures and along roads and draw in **one `props` BatchedMesh** with a
  baked vertex colour. Meshy only on a failed review after October (wrecked car: 20 + 10 = **30 credits,
  ~$0.60**) (D7).
- **Cost.** +3 calls (one batch × three passes), about +240k tris a pass.
- **Gate.** The `decor` floors are re-measured, never widened. New `props` check on `quiet` and `aftermath`.

### 3.5 Trees (plan 2)

- **Desert crown.** In Blender, a clump crown on the shipped shrub var1 and var3 trunks, exported as three
  variants; the sources stay untouched.
- **Olive LOD.** Export-time decimation, source untouched (D8). It saves about 3.4M tris a pass on
  `wadi_halam_basin`, which more than pays for §3.4.
- **Sway.** Moves into the foliage `rampMaterial` (`onBeforeCompile`) on the sim-time clock. The shadow and AO
  passes keep the rest pose, ≤ 2.2 px off at zoom 1. The dead `groveMesh` wind path is deleted.
- **Cost.** +0 calls.
- **Gate.** New `wind` check (amplitude 0) on `quiet`, which is repeatable only because the clock is sim time.

### 3.6 Haze and time of day (plan 2)

- **Haze inside the fog pass**, which already rebuilds world position from depth: a dust tint by view depth
  past the focus plane, plus a low-lying term. +0 passes, about 10 ALU a pixel. The sky colour goes on the
  hemisphere light.
- **Presets.** `RendererOptions.timeOfDay` comes from the mission's `map.time_of_day` (default `day`) and a
  sandbox `&tod=` flag in the flag table. `day` is **byte-identical to today's lights**, so bless 2 moves by
  haze and scatter only. `night` falls back to `dusk` (D10). Sun elevation stays ≥ 18°, inside the fitted
  shadow box.
- **Gate.** New `haze` check on `quiet` and `relief`. Presets are pinned by unit tests; `dusk` is a report-only
  capture.

## 4. Scenarios and blesses

| Scenario | Plan 1 moves by | Plan 2 moves by |
|---|---|---|
| quiet | splat edges, macro, roads | scatter, props, crowns, haze |
| open-ground | splat, macro, grain | density, grain trims, haze |
| vehicle | roads, tread tracks | scatter, haze |
| relief | skirt fix, ridge apron, macro | scatter, haze |
| aftermath (new) | created and blessed | scatter, props, haze |
| combat | report only | report only |

New checks: `macro`, `roads` and `decals` in plan 1; `props`, `wind` and `haze` in plan 2. Floors are a third
of the measured signal, and each check is proven by falsification before it lands. The gate grows from 10 to
about 19 checks plus one scenario, roughly +10 s. Both blesses come from CI numbers, one in flight at a time.

## 5. Numbers to approve

| Item | Number | Reason |
|---|---|---|
| Control map | 8 texels / tile | 0.125-tile detail |
| Surface edge band | 0.5 tile, centred on the edge; noise ±0.2 tile at 1.5 cycles / tile; height-blend 0.15 | cover readable to ±0.25 tile |
| Macro field | 256², fbm 3 octaves, period 12 tiles, luminance ×(1 ± 0.07), blur 1.5 tiles | 0.6% → about 6% block variation |
| Macro hue | ±0.04 toward `dust.1` / `limestone.2` | stays in the sand family |
| Road half-width | 0.36 tile | one track, sand at the tile edge |
| Road edge | falloff 0.18 tile, bent ±0.08 at 2 cycles / tile | worn, not ruled |
| Shoulder | 0.12 tile beyond, `limestone.2` at 40% | bleached verge |
| Road tone | arid `limestone.4` #B8A182 (was `dust.3`); green `dust.3` (was `dust.4`) | saturation 0.6 → about 0.3, still darker than sand |
| Road grain | `knoll_scree_tile`, 2 tiles / repeat, gain 0.6 | no asset; Meshy swap point |
| Ruts | ±0.17 tile off centre, 0.06 wide, `limestone.6` at 35%, fade within 0.4 tile of a junction | two wheel lines, no rings |
| Crater | radius mortar 0.45, Grad 0.6 tile; bowl `shadow.0` 40%, lip `limestone.1` 25% at 0.8–1.0 r | radius 29 / 38 px at zoom 1 |
| Scorch | unchanged (1.6 × √power tile, `shadow.0` 45%) | A1.2 as shipped |
| Oil | 0.5 tile, `shadow.1` 55% | the wreck's footprint |
| Rubble | footprint half-diagonal × 1.2; chips `limestone.5` / `.7` at 60% | collapse spill |
| Pools | persistent 1024, fading 4096, oldest evicted | 4× A1.2; tracks as today |
| Tread / tyre | 35% → 0 linear over 180 s; stamp 0.5 tile, feather 0.08; `dust.5` / `limestone.6` | the plan's figures, no seams |
| Grass + sand | 0.9 / open tile: seeds 0.09 / tile × 6–10 within 0.5–1.2 tile, singletons 0.15 / tile | 3.6×, clustered |
| Bush on cover | 0.6 base (was 0.3) × cover level | thicket reads denser |
| Grass height | ≤ 0.12 world units | never hides infantry |
| Props | ≤ 150 a map, within 1–2 tiles of structures or 0.6 tile of road, ≤ 400 tris each | texture, not clutter |
| Desert crown | 5–8 clumps, 1,200–1,800 tris, 1.4–1.8× today's width | a crown at zoom 1 |
| Olive LOD | ≤ 3,000 tris | a quarter of today |
| Sway | 0.035 world units at crown top, period 3.8 s, gust ×1.4 every ~11 s, weight (h/top)² | 2.2 px at zoom 1 |
| Haze | arid `dust.0`, green `limestone.1`; 0 at the focus plane → 12% at +20 tiles; low-lying +6% below 2 levels | dust, not fog |
| Dawn | sun 22° elevation, azimuth −35° from today, `limestone.1` 2.0; sky `water.0`, hemi 0.75; haze 16% | cool, long shadows |
| Day | today: 55°, `limestone.0` 2.6, sky `water.0`, bounce `dust.4`, hemi 0.9; haze 12% | only haze moves |
| Dusk | sun 18°, azimuth +35°, `dust.0` 1.8; sky `gunmetal.1`, hemi 0.7; haze `dust.1` 18% | warm, low |
| Exposure | 1.0 for all | light moves, not the camera |

## 6. Decisions for the lead

| # | Question | Recommended default |
|---|---|---|
| D1 | Blur 1.5 tiles everywhere (the plan's text), or split | split: 0.5-tile noisy edge for identity, 1.5 for macro colour |
| D2 | Road tone | arid `limestone.4`, green `dust.3` |
| D3 | Road texture | procedural now; Meshy swap (≤ 45 credits) only if you ask after seeing it |
| D4 | Seeded gated scenario `aftermath` via `&decals` | yes |
| D5 | Scorch and tracks fold into one pool; the `scorch` layer becomes `decals` (`blast:capture` follows) | yes |
| D6 | Track fade: linear, or hold then fade | linear, 35% → 0 over 180 s |
| D7 | Props: Blender now, Meshy only on a failed review | yes |
| D8 | Olive decimated at export, despite "use supplied files as is" | yes, source untouched; your word needed |
| D9 | Retire the discs, halve the flecks | yes |
| D10 | `night` → `dusk` | yes |
| D11 | Which missions get dawn or dusk | ship the mechanism and today's two values; the campaign-designer assigns the rest |

## 7. Phasing

`ThreeRenderer.ts` admits one lane at a time; S3g plan 2 (garage tier mark, 8 tasks) needs it too. **Order:
A2 plan 1 → S3g plan 2 → A2 plan 2**: S3g waits on its spec and lane A's plan 1 anyway, and its bless falls
between A2's two.

**Plan 1: terrain, roads, decals (11 tasks).**
1. Skirt ring.
2. Control-map builder (pure; all 26 maps).
3. `GroundMaterial` reads it; the masks retire.
4. Macro field and `macro` check.
5. Road graph and SDF (pure).
6. Road shader; the dashes retire; `roads` check.
7. Pool core: ring, conforming grid, sim-time clock.
8. Kind shader; scorch and tracks fold in.
9. Crater, oil and rubble seeding.
10. `&decals`, `aftermath` and `decals` check.
11. Captures at 0.35/1/2.5, `render-frame-cost`, `perf:units`, docs, bless 1.

**Plan 2: scatter, trees, haze, presets (11 tasks).**
1. Clustered placement (pure).
2. Grain trims.
3. Props Blender kit and `validate:meshes`.
4. Props batch, placement, `props` check.
5. Desert crowns and olive LOD.
6. Sway and `wind` check.
7. Haze and `haze` check.
8. Preset table and `timeOfDay` wiring.
9. `&tod` and the dusk capture.
10. `perf:units` at 300 and the acceptance views.
11. Docs, bless 2.

## 8. Risks

- **Perf.** Submission is the bottleneck, with about 3.5 ms left at DPR 2. Every shadow-casting addition is
  paid three times. Acceptance: `perf:units` at 300 figures ≤ 7.5 ms p95 (6.5–6.7 today) and every acceptance
  view ≤ 14.5 ms p95. A miss sheds scatter density first, never the decal pool.
- **Gate noise.** Sway and fades on wall-clock time would make `quiet` and `vehicle` noisy; sim time is required.
- **Legibility.** Softer edges and a quieter road could lose cover or roads at zoom 0.35. D1 and D2 are the
  levers, and 0.35 captures go to the lead before bless 1.
- **AO pre-pass.** A decal leaking into it stamps false occlusion; plan 1 proves the exclusion.
- **Blesses.** All four gated scenarios move in each plan, and `relief`'s baseline currently contains G5.
- **Recorded, out of scope.** The ditch (38k tris × 19 on `qarn_hadid`, 727k a pass) is the next ground cost
  after the olive.

## 9. Deviations (plan 1, as landed)

Plan 1 is `docs/superpowers/plans/2026-09-25-ground-plan-1.md`. Its ledger is
`.superpowers/sdd/2026-09-25-ground-plan-1/progress.md`, which is git-ignored.

Every number in this section was taken on ANGLE Metal on an M3 Pro unless it says otherwise. The
costs and their conditions are in `docs/PERFORMANCE.md`, "The ground, plan 1 (WP-A2)".

### The plan's own deviations, R-1 to R-21

- **R-1: eighteen tasks, not eleven.** The 5-file cap held, so the fold ran as Tasks 0–18.
  - Task 4 split again, into 4a (the control map) and 4b (the macro field).
  - So did Task 6: the distance-field road first, then the two-wide street fix.
- **R-2: the road graph came before the material.** That let one shader task retire the road
  slot's two taps and `roadAxis` together.
- **R-3: a road tile's vertex colour is the open wash.** The road tone is mixed in the shader. A
  red test proves it: with the road tone left in the vertex, the SDF road steps at every tile edge.
- **R-4: pads keep a hard edge.** G3's pad item stays open for plan 2. The band is one-sided at a
  terrace. A ridge throws a 0.5-tile rock apron onto open ground only, and a pad is excluded from
  the box average.
- **R-5: `wallAlbedo` is the one per-vertex surface fact left.** It is −1 on tops, 0 on building
  walls and 1 on ridge walls.
- **R-6: control B's other two channels.** B.b is junction distance and B.a is the road-edge bend
  noise. Both are baked in TypeScript and unit-tested.
- **R-7: road grain shares `uKnoll`**, at a 2-tile repeat and 0.6 gain.
  - The road slot, `roadAxis` and `roadTextureUrl` are retired.
  - `road_track_tile.jpg` and its `GROUND_ALBEDOS` entry remain. Deleting them is a follow-up.
- **R-8: road tones are arid `limestone.4` and green `dust.3`** (D2), in `TERRAIN_THEMES`.
  - Pixi's roads change colour as well. That diff is report-only, and `renderer.ts` is untouched.
  - The A/B against Task 7, in px: `quiet` 9346, `open-ground` 311, `vehicle` 3892, `relief` 0.
- **R-9: macro hue pulls toward `limestone.2` and `dust.1` on both themes.** The measurement, and
  the calls it left:
  - With the F-13 edge fade, the texel range reaches lo 17 and hi 224. The F-2 test asks for a
    range of at least 100, and one extreme reached.
  - On `open-ground`, the luminance spread moved from 0.82–2.55% to 1.10–2.62%. The spec's "~6%"
    compared screenshot bytes with linear values.
  - ±7% was not retuned (F-16).
  - On green it barely shows at 0.35 (review capture 09). The lead judges it there.
- **R-10: the persistent pool is 1024 decals on a 4×4 grid, and the fading pool 4096 on 2×2.**
  Measured at full pools on the real renderer: **2 calls, 26,624 triangles**.
- **R-11: decal calls are net +0.** Measured on every view of four maps: total calls are identical
  to main. `decals` is worth 2 calls, against main's `scorch` at 1 call plus the retired
  `VehicleTrackMesh`.
- **R-12: rubble seeds in the `structureDestroyed` branch.** The draw mask and surface are
  refreshed first (F-10), and a relief test covers it.
- **R-13: crater radius is `0.15 + power`** tiles: 0.45 for a mortar and 0.6 for a Grad.
- **R-14: the clock is sim time.** A stamp is dated `tickCount × 50` ms. A frame presents
  `(tickCount − 1 + alpha) × 50` ms, clamped at 0. The showcase is dated 0 ms. F-11 places stamps
  back along the motion by the leftover distance, and prints exactly 0.5 tiles apart.
- **R-15: tread stamps are 0.58 tiles long**, one spacing plus a 0.08 feather. A red test with a
  short feather proves it.
- **R-16: the showcase is `RendererOptions.decalShowcase`**, which the app sets only for sandbox
  `&decals`. On `qarn_hadid` it finds all three sites: flat, road and relief.
- **R-17: the `scorch` debug layer is removed, not aliased.** `blast:capture`'s floor was renamed
  `decals` with its numbers kept. The re-recorded readings are at or above scorch-only on every
  subject; the weakest is 0.2363 against a floor of 0.07.
- **R-18: decals sample through `groundWorldY`**, which dispatches to `surfaceWorldY`.
- **R-19: a terrace centre is not stamped, and a vertex on a terrace takes the centre's height**
  (the vertex half is superseded by the fix wave's I-4, below).
  Measured cost (see "The lift cap" below): at a ridge foot, the chord cuts under the rising apron
  by up to 0.62 wu on `qarn_hadid`.
- **R-20: the relief `skirt` floor would have fallen, so Task 2 stopped.** The ring removes the G5
  interior leak the old floor was calibrated on.
  - Whole-frame, the fixed signal read 2705 px / 0.0880, against a floor of 0.095.
  - Ruling: scope the check to the corner region {0,0,260,140}. It reads 2705 px / 3.0455, the same
    on three runs.
  - The new floors are 900 px / 1.01, which is 10.6× stricter in magnitude.
  - `quiet`'s whole-frame `skirt` check still covers the rest of the frame.
- **R-21: the control textures carry mips.** Measured: A and B are 786,424 B each and the macro
  field 87,381 B, so **1.58 MiB** a 48×48 map (1.19 MiB without mips). `renderer.info` reads +2
  textures.

### Rulings made during execution

- **The macro TOGGLE moved from Task 9 to Task 5; the macro CHECK stayed in Task 9.**
  - The first ruling had hiding `ground-albedo` also zero the macro amplitude. It restored the
    scatter tone check, but masked `ground-albedo`'s "texture never arrives" check on `quiet`
    (0.4626 against a floor of 0.34).
  - Revised ruling: `ground-albedo` hides the slot strengths only, and the tone backdrop hides
    `ground-albedo` and `macro` together.
  - Result: the scatter defect fails its tone check again (0.58 / 0.65), and the texture-404 check
    fails on all three scenarios.
- **A street authored two tiles wide is one street.** 2×2 road blocks are solid, at distance 0,
  and ladder rungs are not junctions. The graph had read a two-wide street as a ladder, with 12 of
  16 points counted as junctions and a hole at each 2×2 centre, on the four Beit Sahwan maps and
  `marj_perimeter`. Three-wide is unhandled, and no shipped map has one.
- **Decals are ratio decals** (F-22, then Task 12 fix round 2).
  - The first cut glowed in shade: a lip read 107 against the ground's 65.
  - Decals now multiply albedo ratios onto the lit ground. That needs the HalfFloat scene target,
    and the no-composer path is unsupported.
  - Each decal divides by its OWN ground tone, sampled at stamp time (`decalGroundTone`). Dividing
    by the map's open tone gave green maps wrong hues on 10 of 21 cases: a salmon lip on road, red
    tyres on grass.
  - Measured lip-to-scorch ratio: 1.048 in sun and 1.069 in shade.
- **The sag lift is capped at 0.08 wu** (F-23, then fix round 2). Uncapped, the lift darkened a
  squad standing in a full-power scorch by p90 16 grey levels; capped, 8.
  - 0.08 is the smallest round cap that clears craters and the mortar scorch at tel_marum's three
    steepest shoulder sites.
  - Re-measured over the whole of `qarn_hadid` (level 0–7) at Task 18: every centre on a
    quarter-tile lattice, and every drawn triangle at 8×8. Where all grid vertices are on open
    ground:

    | Mark | Worst below ground | Centres over 0.01 wu |
    |---|---|---|
    | Craters | 0 | — |
    | Mortar scorch | 0.025 wu | 9 |
    | Grad scorch | 0.067 wu | — |
    | Full-power scorch | **0.203 wu** | 3,749 of 22,464 |

    The full-power case is photographed as a straight cut edge at zoom 2.5. On `tel_marum` the same
    scan reads 0.170 wu.
  - Two other mechanisms clip harder, and no cap reaches them:
    - at a ridge foot, the R-19 hold: 0.62 wu;
    - within a radius of the map edge, where off-map vertices sample height 0: 0.38 wu on qarn's
      level-2 rim.
  - The chord also floats up to 0.26 wu over hollows at any cap.
- **The blast harness waits for 5 steady frames of 150 ms or less, with a 30 s cap**, instead of
  a fixed 2500 ms settle.
  - The fixed settle latched a 511–942 ms boot frame on main and on the branch alike, and skipped
    the comparison subjects.
  - A main-versus-branch probe put the branch's boot +5% longer. Task 18 attributes that to
    `buildControlMap` running once per terrain rebuild, 3–5 times a boot: see `PERFORMANCE.md`.
- **`handTick: true` on `scorch_qarn_shoulder`, and its `blast-light` exemption deleted.**
  `qarn_hadid` steadies at 190–233 ms and runs to the 30 s ceiling. With the boot confound gone,
  the abstained light cleared its floor, and the harness's self-cleaning rule failed the run.
  Hand-ticked readings over 3 runs:

  | Layer | Readings | Floor |
  |---|---|---|
  | `blast-light` | 24–35k px / 9.9–10.6 | 1750 / 1.75 |
  | `decals` | 0.44–0.47 | 0.07 |

- **`buildControlMap` above 60 ms (Task 5's stop condition).**
  - The per-query allocations in `roadDistanceAt` were removed.
  - Warm builds now run at 58.8 ms or less on every map; the first call is 67–82 ms.
  - Not stopped on, because the first build sits behind the loading screen. Its boot cost is
    measured in `PERFORMANCE.md`.
- **`aftermath` is a gated scenario** (D4): `qarn_hadid&decals` at the showcase centroid, zoom 1,
  tick 300. The fix wave moved it to (34.5, 32), zoom 2.2, clear of the force (below).
  - Checks and floors, each a third of the smallest of three runs:

    | Check | Floor |
    |---|---|
    | `decals` | 9900 / 0.5 |
    | `roads` | 300 / 0.08 |
    | `macro` | 0 / 0.26 |
    | `scatter` | 1700 / 0.21 |

  - Its readings vary by under 1% run to run.
  - Until the bless, CI's `visual` job reports "no baseline entry" (exit 1).
- **Budgets at Task 18.**
  - Calls: +0, inside the +4 budget.
  - Decal triangles: 26,624, inside 27k.
  - Frame p95 delta: at most +0.76 ms (`qarn_hadid` z1.6), inside +1.5.
  - `perf:units` at 300: 7.50 and 7.30 ms, inside 7.5 (main read 7.60 in the same session).
  - **The absolute 14.5 ms ceiling is missed on `qarn_hadid`, on main and branch alike.** At z2.5
    the tail is the `decor` layer's. At z1.6 the branch's cpu p95 crosses the line: 13.90 → 14.62.

### The fix wave after the final review (2026-09-25)

The final whole-branch review (`.superpowers/sdd/2026-09-25-ground-plan-1/final-review.md`) found five
Important items. All five, the lead's perf item 2, the minors and the parked items were fixed in one
wave; its report is `.superpowers/sdd/2026-09-25-ground-plan-1/fix-wave-report.md`. No approved number
in §5 moved.

- **I-1: the control map is built only when its inputs change.** `controlInputsMatch` compares the
  decor array by reference and the draw mask and `cover` by content: `drawBlockedMask` returns a new
  array every call, and `sim.cover` is written in place when a structure dies. A boot now builds it
  once. Profiled per boot: beit 180 -> 65 ms (3 builds -> 1) and qarn 209-305 -> 111-114 ms (2 builds). beit's longest post-boot frame fell from 162-182 to 96-115 ms, which is main's own figure.
- **I-2: `aftermath` moved off the sandbox force.** Its frame was never quiet: two captures of the same
  commit differed by 519-656 px / 0.040-0.047, against the 40 px / 0.004 budget copied from `quiet`.
  The cause was fourteen idle mesh units and a live fight on the frame clock, which `step()` advances
  by a latched real frame time -- not float rounding. The showcase now anchors clear of the force
  (`showcaseAnchor`, every site at least 10 tiles out), and the scenario frames it at (34.5, 32),
  zoom 2.2, with no drone order. Measured: 0 px / 0.0000 on 22 of 22 fresh-process captures against a provisional local baseline, and every layer reading was bit-identical over 23 runs. Its floors were re-derived as a third of those readings. Three rose. `macro`'s fell from 0.26 to 0.23, because its reading dropped from 0.7833 to 0.7082. The thresholds were not raised.
- **I-3: the exact fix.** The decal shader mixes the road and shoulder into its divisor per fragment,
  from the ground's own control B and road uniforms (shared objects); only the tile tone is stamped
  per decal. A lip over a green road's shoulder is now the approved lip to 1 sRGB level; the
  centre-only divisor missed it by 55 levels at alpha 0.25 and 132 at alpha 1.
- **I-4: terrace and off-map vertices sample the smooth field** (`decalGroundY`), and the shader
  discards off-map fragments. On `qarn_hadid` the ridge-foot class fell from 0.624 to 0.202 wu (the
  open-ground cap's own limit) and the rim class from 0.353 to 0.043; craters clip nowhere.
- **I-5: rubble is chips.** 0.1-tile world cells, one soft jittered disc each, the lattice turned by
  the seed, thinned by the chip centre's radius from 0.55 r. The GLSL hash shifts now come from
  `tile-hash.ts`.
- **Perf item 2: the road block is skipped where control B saturates.** Pixel-identical (golden A/B
  0 px on `quiet`, `open-ground` and `relief`; `vehicle` and `aftermath` inside their own
  HEAD-vs-HEAD noise). `qarn_hadid` z1.6 gpu p95 15.36 -> 14.86 ms, cpu p95 14.56 -> 14.50 (n = 5
  interleaved per tree). The albedo-skip rework was not attempted.
- **Minors.** A stamp uploads only its slot, and both pools index in 16 bits (1.81 -> 1.65 MiB).
  Tread is `dust.5` on every theme, as §5 says. `decalGroundTone` resolves its hex tones once.
- **Parked items closed.** The blast harness refuses a group whose settle hit its ceiling unless
  every subject is `handTick`; the `TRACK_ALPHA` check asserts its own use; `validate_assets.py`
  no longer names `road_track_tile` as the road's albedo.

## 10. Deviations (plan 2, as landed)

Plan 2 is `docs/superpowers/plans/2026-09-27-ground-plan-2.md`. Its ledger is
`.superpowers/sdd/2026-09-27-ground-plan-2/progress.md`, which is git-ignored. Landed at `17480db0`
on `feat/ground-plan2`, base `49c85667` on `b6497c12` = `origin/main` at the time the plan was
approved.

Every number in this section was taken on ANGLE Metal on an M3 Pro unless stated otherwise. Cost
numbers are in `docs/PERFORMANCE.md`, "The ground, plan 2 (WP-A2)" — Step 1's timing tables are now
filled in (part B, this session), and they carry a STOP: see "Rulings taken during execution"
below.

### The plan's own deviations, R-1 to R-14

**Plan shape**
- **R-1: twelve tasks, not the spec's eleven.** The 5-file cap held for the props line, so it split
  into its own task, as plan 1's R-1 split by the same rule.

**Scatter**
- **R-2: the spec's "scatter" (§3.4) is decor, not the flat grain mesh.** `decorPlacements`'s
  `grass`/`sand` families are the 0.20–0.27-objects-per-open-tile scatter G8 named
  (`DENSITY.grass 0.34 × 0.6 + DENSITY.sand 0.18 × 0.4 = 0.276`); the flat grain (limestone flecks,
  D9) is `buildScatter`, a different file. Task 1 edited `decor-place.ts`; Task 2 edited
  `scatter.ts`; the gate's `decor` layer witnesses the first, `scatter` the second.
- **R-3: members are dropped, never moved**, when they land on a road, a building or off the map.
  Moving one to the nearest legal point would pile objects against every road edge. Measured
  consequence: at the spec's original 0.09/0.15 seed/singleton rates, real maps read 0.585–0.735 of
  the 0.9-an-open-tile target (three below the approved 0.65 floor: `khan_rafid` 0.585, `qarn_hadid`
  0.618, `umm_zeitoun_3` 0.649). The lead's ruling (2026-09-27, "Raise seeds to hit 0.9") raised
  `CLUSTER_SEED_P` 0.09 → 0.114 and `SINGLETON_P` 0.15 → 0.19 (same ratio, ×1.2667 — the largest
  raise that keeps every real map above 0.65 while keeping the synthetic fixture under its own 0.95
  ceiling). All 26 shipped maps now read 0.731–0.920 (mean 0.862); synthetic fixture 0.947.
- **R-4: the density dial (`SCATTER_DENSITY`, currently 0.75, the shed ladder's first rung of
  1.0 → 0.75 → 0.5) scales seeds and singletons together, never member counts**, so a shed map
  stays clumpy rather than thinning uniformly. It touches grass and sand only — never trees,
  boulders, ditches, rocks, slabs or bushes.
  - **Review finding, fix round 1:** the clump-shape thresholds (Clark–Evans, family agreement)
    were first measured at dial 1 (the raised rates), where the denser clustering pushed both past
    the spec's original 0.7/0.85 thresholds even at the plan's ORIGINAL 0.09/0.15 rates (0.798/0.842
    — a measurement-point artefact, not an effect of the raise). Review ruling: revert the
    thresholds to 0.7/0.85, measure density-invariantly at `decorPlacements(open, 0.3)` (Clark-Evans
    0.659, agreement 0.909), and add a Ripley's K check at dial 1 (K(1)/πr² > 1.4, measured 1.71).
    All three falsified red (uniform spread) then reverted clean.
  - **Review finding, fix round 1 (road graph):** `sawRoad` alone masked an I-1 cache-count
    regression on every road-BEARING shipped map (`composeTerrain` calls `decorPlacements`
    unconditionally on every rebuild, outside this task's own file). Fixed with a
    `WeakMap<Uint8Array, RoadGraph>` keyed on `input.decor`'s stable identity (`blocked` is rebuilt
    fresh every call, `decor` is not); a road-bearing case was added to
    `ThreeRenderer.ground-control.test.ts`; falsified by reverting to a bare `buildRoadGraph` call
    (5→7 builds, red), reverted clean.

**Props**
- **R-5: the prop table** (sizes, tri caps, roles, roadside/yard mix) is in §3.4 of this spec, seven
  kinds: `jersey_barrier`, `water_tank`, `satellite_dish`, `laundry_line`, `tyre_pile`, `rebar`,
  `wrecked_car`. GLB units are metres; `MESH_SCALE` is 1/3, so 3 m is one tile.
  - **Provenance deviates from the spec's assumed Blender-only build.** The spec text (§6, D7) named
    Meshy only for a LATER, optional swap (the wrecked car) pending October credits. In execution,
    the lead redirected the whole prop line to Meshy early: a Blender-procedural set shipped first
    (`fcde4da0`, superseded), then the lead asked for Meshy previews ("Go, 7 previews", 140 credits,
    ~$2.80 at the assumed $0.02/credit), approved all seven ("Use all 7"), four of the seven then
    collapsed under the 120–400-tri caps at first decimation (dish, laundry line, rebar, car) and
    were re-submitted through the Meshy CLI's new `remesh` command (35 more credits, "Use these"),
    and Blender's job shrank to stripping materials, assigning `PROP_ROLES` roles and provenance.
    **All seven shipped props are Meshy-generated, previewed and then Meshy-remeshed, never
    Blender-procedural** — the AI-art disclosure line for this plan names the props explicitly,
    distinct from the desert/olive trees (R-9, R-10), which are re-exports of an earlier Meshy
    source unchanged by this plan except for decimation/crown geometry.
- **R-6: the vertex colour is baked at load, not at export.** A GLB carries `extras.rl_role` and
  zero materials — decor's own contract — and `bakePropColors` writes the `color` attribute from
  `prop-role.ts` when the loader clones the geometry, so palette values live in TypeScript beside
  every other ramp table and one material serves the whole batch.
- **R-7: props are contract-checked, not rendered, by `validate:meshes`**, exactly as decor is: zero
  materials/images/textures, every mesh node's role inside `PROP_ROLES`, triangle caps from R-5.
  `render_mesh_gate.py` gets the same early return for the `props` asset class decor already has.
- **R-8: props load through the app's mesh manifest** (`mesh-catalogue.ts`'s `PROP_MESHES`,
  `propKindsFor`), like decor; a map with no building and no road fetches none.
  - **Review finding (Task 5, cost stop):** the first landing (`cc38da8f`) measured `beit_sahwan
    _outskirts` z0.5 at +1.18 ms, over the +0.74 ms budget, and the tyre pile read visually
    near-black on screen. The lead's two answers (2026-09-28): "Density 0.75" (`SCATTER_DENSITY`
    1 → 0.75, R-4's shed ladder's first rung) and "Lighten one palette step" for the tyre's `rubber`
    role. Fix round `ae859986`: beit z0.5 fell to +0.30 ms (inside budget); qarn z1.6 read
    +0.78…+1.00 ms under measured concurrent machine load (load average 5–50, another agent's
    browser running) against −0.28 ms on the identical config on a quiet machine the day before —
    ruled NOT a stop, judged instead in Task 12's final interleaved pass on a quiet machine (part
    B), since a measurement taken under concurrent agent load is not evidence either way. The tyre
    still read near-black after this fix; a second lead answer ("gunmetal ramp") landed in Task 7
    (`82daebe9`): `rubber` is `gunmetal[3]` alone.

**Trees**
- **R-9: the olive is decimated by face count, not vertex count.** `TREE_TARGET_VERTS = 3500` had
  shipped 13,383–14,239 triangles, because a vertex target says nothing about face count.
  `TREE_TARGET_TRIS = 3000` replaces it. `tree_1`/`tree_2` stay byte-identical (an olive art
  judgement, out of scope). Shipped: 2,999/2,847/2,847 triangles.
  - **Review finding, fix round 1:** the footprint test measured bounding-box extents, which a
    single outlier vertex sets; ruling: measure p1–p99 percentile extents of the whole tree (and of
    foliage alone) at base vs. head, within 10%. The exporter gained a hard `SystemExit` on an
    off-target result or exhausted merge iterations, plus an undershoot floor. First fix-round
    reading (before the trunk/foliage split): tree_1/tree_2 whole-tree p1–p99 depth read +15.7%
    (over the 10% band); `wadi_halam_basin` decor triangles fell 9,174,535 → 2,455,336 (-6.72M),
    proving the earlier unchanged reading (Task 6's first landing) had been a stale
    `assets/meshes/decor` cache, not an inert exporter.
  - **Review finding, fix round 2, and LEAD SIGN-OFF item:** plain single-pass decimation collapsed
    the trunk/foliage colour boundary into the canopy. Lead's ruling ("Split trunk and leaves"):
    trunk and foliage decimated SEPARATELY, trunk lighter, then rejoined; boundary restored (picture
    checked). p1–p99 now within the 10% band (test un-skipped). Final: 2,999/2,847/2,847 triangles;
    `wadi_halam_basin` decor 9.17M → 2.39M (-6.79M).
- **R-10: the desert crown replaces the foliage objects on `var1` and `var3`; the trunk objects are
  unchanged.** Crown clumps are generated in Blender from a hand-rolled hash (never
  `mathutils.noise`, nondeterministic per process in Blender 5.2), so two exports of the same crown
  are byte-identical (proven in Task 6).

**Sway, haze and presets**
- **R-11: the dead grove wind path is deleted** — `GroveMaterial`, `groveMesh`, `groveMat`,
  `windClockMs` — wired, before this plan, to an empty `groves` layer that had drawn nothing since
  the mesh trees shipped (a stale `(Task 7)` comment already in the code named a DIFFERENT, earlier,
  already-landed plan's task 7 — this plan's Task 7 commit body says so explicitly to avoid
  confusing the two). `grove.ts` and `buildGroves` themselves stay, still barrel-exported and
  tested; deleting them is a follow-up, out of scope. Gate: `wind` floor 406 px / 0.0284 on `quiet`
  (one-third-of-smallest-of-three); RE-DERIVED once (unchanged in shape) after Task 9's haze landed
  on the same scenario and plausibly softened the diff's contrast — 933 px / 0.0712 measured, 23%
  below the reading the floor was set from, still 2.3–2.5x the floor, so left unchanged (a fall
  inside tolerance is not a re-derivation under N-7's own rule).
- **R-12: `time_of_day` is read off the mission JSON by the app** (`packages/app/src/time-of-day.ts`,
  `timeOfDayOf`), validated against the four names — **not** added to
  `packages/sim/src/mission.ts`'s `map` type, since the sim never reads it (keeps the four
  invariants clean; `git diff --stat b6497c12..HEAD -- packages/sim` is empty at every commit).
  Exactly two authored missions carry it: `beit_sahwan_breach` (dawn), `beit_sahwan_0_tutorial`
  (day, i.e. unchanged from today).
- **R-13: haze is mixed toward a scene-referred tint.** The fog pass runs on the composer's
  HalfFloat, pre-tone-map target, where lit open ground sits near
  `albedo × (sunIntensity · sun.y + hemiIntensity) / π`; the haze colour is the tint's linear value
  times that same factor for the active preset (`hazeRadiance`), so haze neither darkens bright
  ground nor glows on it, and dusk's haze is dimmer by the same ratio as its light.
  - **Open item, closed by the lead:** the haze on fog-shrouded ground read noticeably weaker than
    the approved Task 0 mock (+3.7 measured vs. the mock's +16). Lead's ruling (2026-09-28): "Keep
    as built" — R-14's ordering (haze inside the fog pass, before the shroud) stands as designed;
    not a bug.
- **R-14: haze runs before the fog-of-war mix, inside the same pass, only where depth < 1.** The
  `fog` layer's `uRevealAll` does not touch it; the new `haze` layer drives `uHazeAmp` to 0. Two
  terms: a far term ramping to the active preset's `hazeFar` at `HAZE_RAMP_TILES` = 20 tiles ahead
  of the camera's focus plane, and a low-lying term reaching `HAZE_LOW` = 0.06 at
  `HAZE_LOW_LEVELS` = 2 levels below the map's own median open-ground level (computed once per
  terrain rebuild, `hazeReferenceLevel`). A flat map (every open tile at the median) has no
  low-lying term at all — `quiet` (`beit_sahwan_outskirts`) and `relief` (`tel_marum`, whose basin
  IS its own median) both gate only the far term; the low-lying term has no gated witness (only
  `deir_amun`, `umm_zeitoun` and `qarn_hadid` carry open ground below their own median). Gate floors
  (one-third-of-smallest-of-three): `quiet` 986 px / 0.2515, `relief` 0 px / 0.1291.

### Presets and the day bit-identity (spec §3.6, no R-number of its own)

`LightPreset` (`dawn`/`day`/`dusk`) reproduces today's lights exactly for `day`: `hazeFar` 0.12,
`hazeKey` null. Dawn: `hazeFar` 0.16, no sky key. Dusk: `hazeFar` 0.18, `hazeKey: 'dust.1'`. `night`
resolves to `dusk` (D10 in the plan — not its own light yet). `day`'s bit-identity is enforced by a
test comparing bits, not a tolerance, and by a 0-px A/B on all five gated scenarios (`TerrainTones
.haze` became a required field, touching all 26 map-theme fixtures — a type-level, not behavioural,
change). `&tod=` is sandbox-only (`sandbox-help.ts`'s flag table); the visual gate's `dusk`
scenario is captured, printed and voteless (no baseline exists yet for a preset this young).

### Rulings taken during execution, not named by an R-number

- **Task 7/8 ran in parallel, under a "maximise parallel work" ruling (lead, 2026-09-28):** Task 8
  started while Task 7 was under read-only review, on the understanding that any Task 7 fix would
  land before Task 8's commits touched the same hunks. Cost if wrong would have been a Task 8
  rebase; it was not needed — both reviews returned Approved with no fix round.
  - Same ruling repeated for Task 8/9.
- **Task 11's decor floors rose materially** (`quiet` 3,500 → 7,274 px; `open-ground` 340 → 384 px)
  and the `roads` check's signal on `quiet`/`aftermath` fell 56–59% (margin still 1.2–1.3x its
  floor) after the full stack (clusters, D9, props, crowns, sway, haze) landed together. Review
  ruling: the roads margin is a finding to CARRY forward, not a stop — it still clears its floor by
  a comfortable margin, and the cause (haze/props/clusters all adding contrast the roads check has
  to be measured against) is named rather than hidden.
- **Task 12 was split into part A and part B** (this ruling, 2026-09-28): part A does Steps 2–5
  (review captures, `blast:capture`, the record with Step 1's cost numbers left `TBD`, and the
  gates); part B does Step 1's interleaved timing re-measure and Step 6 (push/PR/bless). Reason: the
  machine was running other agents' work during part A's session, and Task 5's own stop-condition
  investigation had already shown that a cost reading taken under concurrent agent load (+0.78 to
  +1.00 ms at `qarn_hadid` z1.6) cannot be distinguished from a real regression without an
  interleaved, quiet-machine control — CLAUDE.md's own rule ("a range with no sample size beside it
  is an anecdote") extends to "a range measured under unlogged concurrent load is not a range at
  all." Cost if this ruling is wrong: one extra dispatch to re-run part B, which is cheaper than
  shipping a false stop or a false pass on the `qarn_hadid` z1.6 budget.
- **`pnpm blast:capture -- --label=after --port=5199`** was re-run under this plan (haze and sway
  now draw into its ten-second ladders) to confirm every `LAYER_FLOORS` entry still clears. Every
  floor the run WAS able to read (`blast-light`, `decals` on `mbt_lavi`, `apc_eitan`, `mortar_team`,
  `scorch_qarn_shoulder`, `blast_in_firefight`, `blast_nomesh`) cleared, several by a wide margin.
  **Not a clean pass, though: 2 of the tool's 8 subjects (`tel_marum||scorch_tel_ridge`,
  `beit_sahwan_outskirts||shake_probe`) could not be measured at all** — their settle wait hit its
  own 30-second ceiling without reaching 5 steady frames, so the tool skipped them rather than risk
  latching an unsteady frame into the effect. This reads as the same machine-load confound already
  named above for `qarn_hadid` z1.6 (this session's machine was running other agents' work
  throughout), not a real regression — no floor read BELOW its value, two subjects simply could not
  be read at all. Full numbers, the skip reasoning and the recommendation to re-run on a quiet
  machine: `.superpowers/sdd/2026-09-27-ground-plan-2/task-12a-report.md`. This is carried to the
  lead as an open item for part B, alongside the Step 1 timing re-measure — both need the same quiet
  machine this session did not have.
- **Task 12 part B (2026-09-28): the interleaved re-measure found a real STOP, not the load
  confound part A left open.** Machine: quiet (load average 4–8 on 12 cores, monitored via `uptime`
  before and during; no other agent running). Method: main (`b6497c12`) and branch (`17480db0`) as
  two persistent dev servers on `:5195`/`:5196`, `render-frame-cost` interleaved run-by-run, n = 10
  per view per tree (one warm-up discarded, then two rounds of 5 — the first round's readings sat
  close enough to the repeat line that a second round was run before reporting, per
  global-constraints' own convention). One methodological note for whoever reruns this: a first
  attempt at this measurement launched the `qarn_hadid` roster's runs and a second `beit_sahwan`
  repeat round CONCURRENTLY as two separate background processes, and the resulting numbers
  (30–40 ms readings on views that read 13–16 ms everywhere else) were exactly the
  self-inflicted version of the same concurrent-load confound this whole task exists to avoid. That
  run was discarded in full and never reported as data; every number below is from the
  re-run, done strictly one measurement script at a time.
  - **`beit_sahwan_outskirts` (22,24) z0.5 is a STOP.** gpu p95 mean rises 13.84 → 14.67 ms
    (+0.83 ms, over the +0.74 ms cap); median delta +0.80 ms; cpu p95 shows the same shape
    (+0.84 ms mean). The two trees' 10-sample distributions do not overlap at all (main's ceiling
    is branch's floor, 14.1–14.3 ms), so this reads as a real, reproducible cost, not noise a
    repeat would resolve — unlike the `qarn` views below, which sat within 0.3 ms of their own
    lines. This view was not named a pre-existing miss: main itself reads a clean 13.7–14.2 ms
    here, so branch's 14.3–15.2 ms (6 of 10 runs over 14.5 ms) is also a new miss on the absolute
    per-view ceiling, not only on the delta budget. Per the plan's own stop-condition rule
    ("not traded away, no code changed"), no code was touched to chase this. Task 5's shed ladder
    (density 1 → 0.75 → 0.5 → +sand-no-cast → +PROP_CAP 75) already measured this same view at
    every rung and is reproduced in `docs/PERFORMANCE.md`; rung 1b (density 0.5) is the next one
    that read clean on every one of Task 5's own samples (+0.38 ms). Choosing a rung, or accepting
    the miss, is the lead's call — Task 12 part B does not choose one.
  - **`qarn_hadid` (26,22) z1.6 — the view the plan's stop condition names explicitly — is
    resolved clean.** Branch reads 0.86–1.07 ms **faster** than main across the two rounds
    (n = 5 and n = 10), settling the straddle Task 0 (main-only, different session) and Task 5
    (branch under concurrent load) left open: on a controlled, quiet, interleaved read, this view
    is not a regression.
  - **`qarn_hadid` z2.5 and z0.5** read +0.55–0.60 ms (median), inside the +0.74 ms cap; both
    remain pre-existing misses on the absolute 14.5 ms ceiling, named rather than hidden, unchanged
    from before this plan.
  - **`perf:units`/`backend-curve-gate` at 300** (`--only=three-mesh`, target=300, settles at
    living=266 on both trees): branch mean render p95 6.90 ms (3 runs: 6.60/7.30/6.80) against
    main's 7.60 ms (3 runs: 7.60/7.20/8.00) — **PASS**, and this harness loads no decor or prop
    meshes at all (Task 5's own finding), so the two trees agreeing within ordinary noise is the
    expected result.
  - **`wadi_halam_basin`'s decor triangle count, folded to exact digits**: 9,174,535 (main) →
    2,283,358 (branch), **−6,891,177 (−75.1%)**. This does not match the spec's original
    "about −3.4M a pass" estimate for this line (§3.5/§8); it is roughly double, same sign, same
    order of magnitude, and consistent with Task 6's own mid-plan reading of −6.78M at this view
    before Tasks 7–11 landed. Task 6's report already recorded that its own `ground:capture`
    reading that session was stale (byte-identical triangle counts before and after a GLB swap that
    could not physically cost the same triangles) and that the spec's estimate "could not be
    confirmed this way" — this session's fresh dev servers are not subject to that staleness, so
    −6.89M supersedes the "about −3.4M" estimate as this line's measured value.
  - **`pnpm blast:capture -- --label=after --port=5199 --only=scorch_tel_ridge,shake_probe`,
    re-run on the same quiet machine: both subjects part A could not settle now settle cleanly and
    pass every floor** (`scorch_tel_ridge`: settled after 3,093 ms/9 frames, `blast-light`
    49,017 px/11.5026 PASS, `decals` 0 px/0.4611 PASS; `shake_probe`: settled after 7,893 ms/14
    frames, `blast-light` 10,716 px/4.4540 PASS, `decals` 7,599 px/1.7880 PASS). All 8
    `blast:capture` subjects now measured and passing; this confirms part A's own diagnosis (a
    settle-timeout confound, not a floor failure) rather than surfacing a new one.
  - **Net effect on Task 12's split**: Step 1 (costs) is measured and carries one real STOP; Step 2
    (the two `blast:capture` subjects) is now a clean pass; Step 3 (the record) is this edit. Step
    6 (push/PR/bless 2) is out of this session's scope and, per the STOP above, should not proceed
    without the lead's ruling on the `beit_sahwan_outskirts` z0.5 miss in addition to the review
    captures the lead was already going to judge.
