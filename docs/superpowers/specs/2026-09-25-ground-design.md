# The ground — design (WP-A2, art Phase 2, #182 with #226)

**Date:** 2026-09-25 · **Status:** plan 1 landed `64afcf3b` (on `feat/ground`; merge and bless 1 wait for the lead's word on the zoom-0.35 captures). §5 and D8 were approved by the lead on 25 Sep. Plan 2 has not started. What plan 1 did differently from this text is in §9, Deviations.
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
- **R-19: a terrace centre is not stamped, and a vertex on a terrace takes the centre's height.**
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
  tick 300.
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
