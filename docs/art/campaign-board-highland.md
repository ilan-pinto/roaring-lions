# Campaign board: highland re-author. Numbers for approval (S3a, GH-180)

**Status: PROPOSED. Nothing is rendered or exported yet.** This document holds
the numbers and a mock for the lead to approve before any final render (see
the pre-render gate in the art agent brief). The images it names are
**MOCKS**: quick Blender Eevee renders of the CURRENT `sahar_basin.glb`, with
the proposed relief, recolour and scatter painted over it procedurally. They
are not the final asset and not the final pipeline.

- G1 item 4. Default taken 1 Oct: **Blender only, no Meshy credits.**
- The board has been on the lit pipeline since #332. That PR set the
  standard material, the sun and ACES (`world-material.ts`, `world-view.ts`).
- Look reference: the Sur highland biome, #326. Terra rossa earth between grey
  limestone, grey and dark-green garrigue, *Cedrus libani*, more rock.
- Standing rule: maximum detail, simplified only to a measured budget.

## 0. The board as it ships today (measured from the bytes, `b6238d94`)

| fact | value |
|---|---|
| plan extent | x -0.500..0.500, depth -0.453..0.453 (board units; the hex is 1.000 wide) |
| height range | 0.000 (underside) .. **0.203** (the tallest snow spike) |
| basin floors (mean surface z) | marj 0.076, sur 0.080, naharin 0.094 |
| mesh nodes | 5: `marj_region` 5,396 tris, `naharin_region` 19,668, `sur_region` 4,907, `outland_scenery` 5,944, `wall_scenery` 3,192. **Total 39,107** |
| texture | 1 x `base_color` 4096^2 JPEG, 2,633,813 B inside a 3.96 MB GLB. Draco mirror `assets/meshes/campaign/sahar_basin.glb` is 2.7 MB |
| town markers | **7** empties `<town>_town` (`rl_town` + `rl_region`) |
| frustum fit | half-height **0.36059**, re-derived here from the shipped hull. `world-camera.ts` records 0.36066 |

All coordinates below are in the GLB's own frame as Blender imports it:
**+Y is north** (three's -Z), +X is east, Z is up. "North" is the snow-range
edge, as `export_meshy_world.py` names it.

## 1. Numbers table

### 1a. Ridgelines, relative to the regions

| id | what | polyline (x, y) | crest z per vertex | half-width | lies in |
|---|---|---|---|---|---|
| **R1** | main crest. Replaces the snow range: an arid limestone range across the north edge | (-0.22, 0.38) (-0.10, 0.42) (0.04, 0.41) (0.17, 0.36) (0.29, 0.27) | 0.200, 0.230, **0.250**, 0.235, 0.210 | 0.10 | `wall_scenery`, plus the north rim of `sur_region` and of `outland_scenery` |
| **R2** | eastern spur. Runs down the Sur/outland border: Sur's "mountain wall" | (0.29, 0.27) (0.33, 0.15) (0.34, 0.03) (0.31, -0.09) | 0.210, 0.190, 0.170, 0.140 | 0.065 | `outland_scenery`, east of `sur_region` |
| **R3** | Sur terrace. The Sur floor is lifted to make a highland basin under the range, with a low step down to the Marj | disc, centre (-0.03, 0.10), radius 0.19, edge ramp 0.05 | floor **0.098** (+0.018) | n/a | `sur_region` |

Cross-profile: a smoothstep from the 0.085 foot to the crest. The crest is
modulated x0.78..1.10 by ridged value-noise at a 9/unit frequency, and gullies
are cut up to 0.012 deep at 22/unit. Everything uses the hand-rolled
`vnoise`/`fbm`, never `mathutils.noise`. Displacement is a function of (x, y)
only, so a vertex shared by two regions moves identically in both, and no
crack can open. That is the exporter's "decimate then split" lesson,
restated.

### 1b. Relief heights, and what they cost the frustum fit

`footprintCandidates` fits `hull(x, z) x {minY, maxY}`. The plan hull does not
change, because the rim and underside are untouched. So the only fit input
that moves is the peak. The table below re-runs `fitHalfHeight` (the real
function) on the shipped 28-point hull at aspects 1140/641, 16/9 and
1440/900. All three agree to five decimals.

| peak z | half-height | board drawn at | note |
|---|---|---|---|
| 0.203 | 0.36059 | 100% | today |
| **0.250** | 0.38211 | **94.4%** | **proposed** |
| 0.280 | 0.39588 | 91.1% | |
| 0.300 | 0.40506 | 89.0% | |
| 0.350 | 0.42801 | 84.3% | |

**Each +0.01 of peak costs about 1.2% of the board's drawn size.** The
proposal takes a 5.6% shrink, so the range reads as a range and not as one
spike: the peak rises from 0.203 to 0.250, and the crest stays at 0.20 or more
for about 0.55 units of length, where today's snow is one cluster at the north tip. The
alternative at zero cost: hold the peak at 0.203 and get the "range" read from
length alone. **Lead's call.** The mock peaks at 0.242.

### 1c. Highland versus basin

| node | becomes | how |
|---|---|---|
| `sur_region` | **highland** | Terra rossa basin floor on the R3 terrace. Cedar groves on its north half, garrigue, rock on slopes over 22 deg. The grid town, plus a 0.03 radius around every Sur pin, keeps today's bake. The glacial lake at (-0.03, 0.22), r ~0.075, becomes a **karst lake**: the ice-white rim goes to a karst.0 shore. |
| `wall_scenery` | **the range (R1)** | All karst. No snow (it is an arid range). Crest scree karst.0 above z 0.225. |
| `outland_scenery` | **split** | The east plateau (x > 0.12) carries R2 and is de-oranged toward dust.4/dust.5 at a 0.55 mix. The south-east savanna stays. The underside and rim (z < 0.06) are **untouched**, in colour and in position. |
| `marj_region` | **basin, unchanged** | Its blurb says "No mountain, no river, no depth". The big lake on the Marj/outland border stays. |
| `naharin_region` | **basin, unchanged** | The green river corridor. Its north end now meets R1's foot. |

### 1d. Scatter density (final targets. The mock reached the counts in brackets)

| kind | count | size (board units) | placement rule | colour key |
|---|---|---|---|---|
| *Cedrus libani* | **220 +-20** (mock 125) | crown 0.016-0.026 across, 0.016-0.024 tall. 4 flat tiered plates on a short bole, not a fir cone | groves of 6-20 where `fbm(14/unit) > 0.5`. Band z 0.092-0.205, slope < 34 deg. R1's south flank, Sur's north half, R2's west flank | foliage **scrub.1**, bole dust.5 / dust.3 |
| garrigue bushes | **900** (mock 237) | radius 0.0035-0.007 | slope < 30 deg, highland only. Two tones, 55/45 | **olive.2** (grey-green) / olive.3 mixed toward karst.2 (dark grey-green) |
| boulders | **420** (mock 420) | radius 0.003-0.010 | anywhere in the highland, not on water, not within 0.03 of a pin | **karst.2** 60%, **karst.1** 40% |
| outcrops | **26 clusters x 3 stones** (mock 26) | 0.005-0.011 each | R1/R2 shoulders, slope > 18 deg | karst.1 / karst.2 |
| olives, Umm Zeitoun | **30-40** | as the current board's broadleaf props | ring at 0.03-0.06 around `umm_zeitoun_town` (#326: Umm Zeitoun keeps its olive groves) | scrub.0 / olive.1 |

Every scatter instance is **merged into the region mesh it stands on**, the
way today's props are. A prop left as its own node is a hole in that region's
tint, and a node with no `rl_map_role` makes `readWorldScene` throw.

### 1e. Palette keys (authoring targets for the bake)

The board is the named textured exemption (`TEXTURED_CAMPAIGN_MAPS`), so no
gate palette-checks it. These keys are what the bake is painted from, so that
the board and the Sur maps share a family. All ramps run descending: **index 0
is the lightest**, checked against `data/palette.json` (karst.0 `#CFCBBF` ..
karst.4 `#524E47`).

| surface | key |
|---|---|
| crest scree, z > 0.225 | karst.0 |
| rock faces, slope > 24 deg | karst.1-karst.3, by fbm |
| gully shadow | karst.4 |
| terra rossa earth | terracotta.2 <-> dust.5, mixed 45-85% by fbm(40/unit) |
| east plateau | dust.4 / dust.5 |
| cedar | scrub.1 (the lead's #326 pick) |
| garrigue | olive.2, and olive.3 x karst.2 |
| boulders | karst.2, karst.1 |

`karst` is `theme_only` for the TERRAIN quantiser. That flag does not apply
here, because the board is a bake and not a quantised composite.

### 1f. Tri and texture budget

| item | today | proposed cap |
|---|---|---|
| terrain | 39,107 | **<= 90,000** (re-decimate the Meshy source at 0.02 as today, then adaptively subdivide only the R1/R2/R3 zones to an edge of ~0.004. Marj and Naharin stay at today's density) |
| cedars | 0 (the forest is part of the bake) | <= 20,000 (220 x ~90) |
| bushes | 0 | <= 18,000 (900 x 20) |
| boulders + outcrops | 0 | <= 15,000 |
| **total** | **39,107** | **<= 145,000** (3.7x) |
| draw calls | 5 | **5** (scatter merged into the region meshes) |
| texture | 1 x 4096^2 base_color JPEG q85, 2.63 MB | **exactly 1 x 4096^2 base_color, JPEG q85, <= 3.0 MB**. No normal, no metallic_roughness (the contract requires exactly 1 material/image/texture) |
| GLB, art / Draco | 3.96 MB / 2.7 MB | **<= 8 MB / <= 3.5 MB**, estimated. Measured at export, and refused if exceeded |

UVs: the whole edited board is re-unwrapped into one fresh 4096 atlas.
Cycles bakes today's `base_color` onto it (selected-to-active, so the bake is
sampled, never interpolated across the old atlas seams). A **4096 x 256 strip
(6%)** is reserved for the scatter swatches: cedar, garrigue x2, karst x3.
Reusing Meshy's atlas is rejected: the new relief stretches its texels.

### 1g. What stays

- **Filename and id**: `art/meshes/campaign/sahar_basin.glb`, and
  `TEXTURED_CAMPAIGN_MAPS` / `TEXTURED_CAMPAIGN_EXEMPT` = `{sahar_basin}`.
- **The 5 mesh nodes**, by name and extras. `marj_region`, `sur_region` and
  `naharin_region` carry `rl_map_role: region` + `rl_region`;
  `outland_scenery` and `wall_scenery` carry `rl_map_role: scenery`. Every node
  carries `rl_textured: true`.
- **The 7 town markers**, `<town>_town` with `rl_town` + `rl_region`. **Plan
  positions are unchanged**: the exporter's `TOWN_SITES` (u, v) are reused
  verbatim, raycast onto the new surface, and still asserted to land in their
  own region. Heights follow the surface: the Sur pins rise about +0.018.
- **The rim and underside**: z < 0.06 is untouched, so the plan hull, the
  shadow box (`size.x`/`size.z`) and the pivot are unchanged.
- **`data/campaign/world.json`, `worldmap.ts`, the flat PNG board**: untouched.
- **`REGION_VISUALS`, `SCENERY_VISUAL`, `HOVER_BRIGHT`**: untouched. They are
  to be re-photographed, though (see 3.6).

## 2. Mocks (labelled MOCK, in the session scratchpad)

`/private/tmp/claude-501/-Users-ilpinto-dev-roaring-lions/5d1f74e7-c36f-4120-a675-5c63c714fcf1/scratchpad/board-hl/`

| file | what |
|---|---|
| `current_campaign_capture.png` | **real** `/campaign` today: 1440x900, three on ANGLE/Metal, music off, dev server on :5282. `data-board` read back as `diorama` |
| `mock_oblique_before_after.png` | the current board, beside the MOCK. The camera is the board's 30 deg / 45 deg ortho |
| `mock_oblique_r180_before_after.png` | the same, with the board turned 180 deg |
| `mock_plan_before_after.png` | plan view, north up, same scale on both sides |
| `mock_plan_numbers.png` | R1/R2/R3, crest heights, the lake and the unchanged basins, drawn over the MOCK plan |
| `work/after.py`, `work/before2.py` | the mock scripts (deterministic, hand-rolled noise) |

Mock caveats: Eevee with the Standard view transform, not the in-game ACES
lit pipeline; the colour is a vertex-attribute mix over the old bake, not a
bake; the terrain is a uniform 1-level subdivide (156k tris, over the cap
above); scatter is primitive cones and icospheres. Judge the layout, the
heights and the density, not the surface finish.

## 3. What must not break

1. **The campaign contract gate.** `validate_mesh_assets.py`
   `check_campaign_meshes` requires: exactly 1 material/image/texture; every
   mesh node `rl_textured`; roles in `{region, scenery}`; region ids equal to
   `world.json`'s `{marj, sur, naharin}`; markers equal to its 7 towns, no more
   and no fewer. `readWorldScene` additionally throws on an unroled mesh, a
   mesh with no map, or a region with no `rl_region`.
   `textured-world.test.ts` and `world-scene.test.ts` re-read the shipped
   bytes.
2. **`checkCampaignBoard`** (`tools/src/golden-diff/screens-check.ts`). It
   asks which path the screen took. Note: **the value is `data-board=diorama`,
   not `3d`.** `worldmap3d.ts` writes `'diorama' | 'flat'`, and `flat` on a
   WebGL2 browser is the failure. A heavier GLB has to stay inside the
   loader's patience. Re-time `?campaign` cold.
3. **Region hover and click.** **Found while doing this, and the taller range
   makes it reachable: `regionAt` (`world-view.ts:396`) raycasts
   `regionMeshes` only.** Its comment promises that a click on the wall reads
   as nothing, but scenery is never intersected, so the ray passes straight
   through it. A click on R1/R2 where a region lies behind it on screen picks
   that region. Today's 0.203 cluster hides little; a 0.25 range along the
   whole north and east edge would hide Sur at many yaws. **Precondition for
   the export:** intersect `[...regionMeshes, ...scenery]` and return null when
   the first hit is scenery. Pin it with a test that fails on today's code.
4. **The pins.** The brief said 25 pins; the tree has **7** (one per town, 26
   missions). Plan (u, v) is unchanged and heights are raycast. Each Sur pin
   needs a slope of 12 deg or less under it, and must sit at least 0.03 from
   any ridge falloff, or its DOM chip floats over a cliff edge as the board
   turns.
5. **The frustum fit.** The plan hull must stay byte-identical (the rim is
   untouched) and the peak must stay at or under the approved z. Update the
   0.36066 that `world-camera.ts` and CLAUDE.md cite to the new measured value
   in the same commit.
6. **Scenery loudness.** The new range is large and grey, and it draws through
   `SCENERY_VISUAL` (sat 0.72, bright 0.86). Re-photograph at 1440x900 and
   confirm the live Marj still wins the eye. That was the reason scenery was
   drained in the first place.
7. **Post-export passes**: `pnpm encode:meshes` (the Draco mirror), then
   `pnpm validate:meshes`.
