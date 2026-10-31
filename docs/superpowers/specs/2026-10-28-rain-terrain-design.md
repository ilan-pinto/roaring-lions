# Rain: a wet terrain theme, `wetland` (GH-871). Design, numbers for approval

**Date:** 2026-10-28, revision 3. **Status:** design only, for the lead. Nothing is rendered, built, exported or
sent to Meshy. **Lane:** B. **Written against:** `main` at `2080d550`. Every engine fact below was read from that
tree.

**Revision 2 applies the lead's rulings of 28 Oct (PR 873):**
1. A WHOLE NEW TERRAIN THEME: a wet world with its own ground set, plants and textures, on new maps. It is not a
   weather layer on the existing highland and green maps.
2. Free Play only at first. No campaign mission yet.
3. Every other detailed choice as recommended in revision 1, adapted to the new theme. These are: the `mud` and
   `overcast` ramps, the puddle stand-in, 6,000 / 3,500 / 1,500 drops, no lightning yet, a frame budget of
   +1.0 / +0.7 / +0.4 ms, rain on the sim clock, no rain in versus, and report-only visual scenarios.

**Revision 3 folds in the five mood-board adjustments the lead approved on 28 Oct (the P1 gate).** Each is applied
where its number lives, and section 2.8 lists them with the art-numbers summary:
1. **Marsh.** About 25-35% water, in meanders and pools, under a continuous reed mat; `reed:foliage` -> `dust.5`
   (4.3, 2.2).
2. **Season.** The late-winter / early-spring flush: leaf-on oak and willow at their yellowest green, and the sward
   at its greenest. The Meshy prompts say "early spring flush", not "winter" (2.2, 2.6).
3. **Mud.** The yellower, less saturated `mud` ramp (`#8E6F55 #725944 #584535 #413327 #2D241B`), and a P2 A/B of the
   puddle reflectance, 0.20-0.25 against 0.35 (4.1, 4.3).
4. **Rock and haze.** One rock-only dark warm step, `basalt.0` `#4B453D`, for the Golan-dark boulders; and a bluer
   haze key, `overcast.1` -> `#9FA9B5` (4.1, 2.3, 4.5).
5. **`fen` is kept.** It is nudged to `#7BA350` only if the P2 capture reads cold (4.1).

Presentation only stays the default. The one place the theme asks the map grid for something is the marsh symbol
(section 5.2). It is built from two mechanics the sim already has, so no sim code changes.

**The decisions are in section 11.** Each one leads with its recommendation. Sections 0-10 hold the numbers they
rest on.

**The short version:**

- **The theme.** A fourth `terrain` value, `wetland`, is a Levantine valley in the late-winter / early-spring
  flush: yellow-umber alluvial mud under spring sward, wet basalt, a reed mat with water in its meanders and pools,
  Tabor oak on the slopes and willow at the water.
- **Rain belongs to the theme.** It falls on every `wetland` map and on no other map.
- **Two new Free Play maps, 48x48.** Ein Qasab is a marsh valley that vehicles cross only by two causeways. Jebel
  Matar is wet downs with two hiding crests and a basalt dyke. Neither has a mission.
- **The art.**
  - Five ground tiles, procedural, 0 credits.
  - Five foliage families: oak, willow, shrub, reed and winter grass. The trees and the shrub come from Meshy
    bases; the reeds and grass are built in Blender.
  - The rocks are the shipped ones, retinted.
  - Three props.
  - **Meshy: 125 credits planned (about $2.50), with a cap of 200 (about $4.00).** No call is made before the mood
    board and the lead's approval.
- **The cost.**
  - The wet layers (rain, puddles, marsh water, ripples) are estimated at +0.50 to +1.00 ms gross at `high` on
    DPR 2, against the approved +1.0 ms.
  - The theme's foliage is estimated at 0.70 to 0.75 M placed triangles a map. That is below the Wadi Halam
    basin's estimated 1.09 M, the heaviest shipped map, so the wet maps should draw no worse than the basin.
- **Nothing shipped moves.** No shipped map changes theme, and the other three themes compile today's programs.
  The terrain pins are extended to all 35 shipped maps before the wiring lands.

---

## 0. What the engine already gives us (read, not assumed)

| Fact | Where | Why it matters here |
|---|---|---|
| A theme is a `terrain` enum value on the MAP, read by the renderer at boot: `arid`, `green`, `highland`. It is presentation only and never reaches the sim. "Adding a theme is a renderer change; adding a map that uses one is not." | `data/schemas/map.schema.json`, `packages/data/src/map.ts` `TerrainTheme` | A fourth value is the designed extension point |
| A theme's bundle is a `TerrainTones` record, typed `Record<TerrainTheme, TerrainTones>`, so a missing theme is a compile error | `packages/app/src/terrain-themes.ts`, `packages/render/src/api.ts` | The compiler lists every table that needs a `wetland` row |
| GH-322's highland added four OPTIONAL fields whose absence is the old behaviour: `paletteRamps`, `decorColors`, `openScatter`, `macroHue` | `api.ts` | The wet theme adds its fields the same way, so arid, green and highland stay byte-identical |
| Only the OPEN-ground image is per theme (`TERRAIN_GROUND_TEXTURE`). The rock, scrub, grove and knoll slots are four fixed URLs shared by every theme. | `renderer-options.ts` lines 99-108, `terrain/mesh.ts` `DEFAULT_ALBEDO_FOR_SLOT` | "Its own ground set" needs a per-theme table for the other four slots (section 1.2) |
| Ground images are ratios to their own mean (`GROUND_ALBEDOS`: mean, repeat in tiles, gain). They are `NoColorSpace`, plain `RepeatWrapping`, 1024², JPEG of about 0.5 to 0.7 MB each. They are never mirror-tiled. | `terrain/mesh.ts`, `tools/textures/encode_ground_tiles.py` | Each new tile needs a measured mean, and its seams must hold an edge-to-adjacent ratio of at least 0.9 |
| A `theme_only` ramp is invisible to every theme that does not name it. `karst` in the shared set would have moved 11 of 18 other maps. | `data/palette.json`, `terrain/tones.ts` `quantisePalette` | The new ramps cannot move a shipped map |
| Decor is one `BatchedMesh` per ROLE (`foliage`, `trunk`, `rock`, `sand`), not per family, so six families cost four draws a pass. It is drawn by the shadow, GTAO and main passes. | `terrain/decor-mesh.ts`, `decor-role.ts` | New families in the existing roles cost **+0 draw calls**. They do cost triangles. |
| The tree species is per theme (`groveFamily`), and so is the open-ground tree (`openScatter.tree`). Grass, sand, bush and rock are global families, recoloured per theme by `decorColors` (an instance tone, +0 draws). | `decor-place.ts`, `mesh-catalogue.ts` `decorFamiliesFor` | "Its own plants" needs a per-theme family remap (section 1.3) |
| Shipped decor triangles per variant: olive 2,847-2,998; cedar 1,523; desert tree 1,282-1,530; bush 430-456; grass 142-168; sand 98-121; rock 200-229; slab 233-280; boulder 326-347 | counted from `art/meshes/decor/*.glb` accessors, 28 Oct | The tri caps in section 3 sit on these |
| `SCATTER_DENSITY` 0.75 is settled and lead-accepted. It scales grass and sand only. | `decor-place.ts` | The wet theme keeps it |
| Props: one vertex-coloured batch, +3 draws, capped at 150 a map. There are seven kinds with per-kind tri caps (120-400). The roadside and yard mixes are global. | `prop-place.ts`, `prop-role.ts`, `tools/validate_mesh_assets.py` `PROP_TRI_CAPS` | New kinds need caps on both sides, and a per-theme mix |
| `time_of_day` is a MISSION field (`map.time_of_day`). The sandbox reads `&tod=`. A theme supplies only its haze tone, used when a preset names none. | `mission.schema.json`, `app/src/time-of-day.ts`, `three/time-of-day.ts` | Free Play has no mission, so the overcast light must come from the theme (section 4.5) |
| Ambience beds are keyed by theme (`highland` -> `ridge`), but **all beds are OFF** by the lead's ruling of 9 Oct | `app/src/ambience.ts` | No rain bed in this issue |
| Free Play lists every map in `@lions/data`'s `maps`. Each card is painted by `paintMapTerrain` with the theme's tones and described by `freePlay.map.<id>`, which a spec requires for every map. | `app/src/ui/menu.ts` | A new map needs no picker code |
| Every shipped map is 48x48 | `data/maps/*.json` | The camera, minimap, sandbox anchors and every frame measurement were taken at that size |
| GH-829, `high`, DPR 2, M3 Pro. A synced frame takes 16.4-21.0 ms on Wadi Halam, and the live rAF cadence holds 16.7 ms. Decor on the basin costs **2.2 ms at z1 (about 2.0 M of 3.9 M triangles)**. Shadow costs 1.3-1.9 ms and fog 0.2-0.8 ms. | `docs/PERFORMANCE.md` | The foliage estimate in section 6 is scaled from the basin's decor |
| `&tod=` is a value flag in `KNOWN_PARAMS`. `dusk` is a report-only golden scenario: a framing plus a flag. | `sandbox-help.ts`, `capture-protocol.ts` | The wet scenarios use the same shape |

**One finding still shapes the look.** The camera is orthographic and the sun directional, so on flat ground the
specular term is one constant across the screen. For the shipped sun and the 30-degree camera, GGX puts essentially
nothing on flat ground at any roughness (about 0.4% of the diffuse at roughness 0.6, about 0% at 0.1). **Lowering
roughness does not make ground look wet.** A puddle at roughness 0.05 photographs as a dark patch, because there is
no environment map to reflect. Wetness has to be AUTHORED:
- a darker, more saturated tone;
- a puddle and water stand-in that reflects the sky;
- ripples that move;
- specular only where normals vary: relief, ripple normals, and curved hulls.

## 1. How a fourth theme is wired

### 1.1 What the existing three are made of

| Surface | arid | green | highland | wetland (proposed) |
|---|---|---|---|---|
| Tone bundle | limestone / dust | grass / scrub | dust over karst | **fen / mud / overcast** (4.1) |
| Theme-only ramps | none | none | `karst` | **`fen`, `mud`, `overcast`, `basalt`** (`basalt` is a tint key only, 4.1) |
| Open-ground image | `desert_sand_tile` | `green_basin_tile` | `highland_v2_tile` | **`wetland_open_tile`** |
| Rock / scrub / grove / knoll images | shared four | shared four | shared four | **its own four** (2.1) |
| Grain (`scatter`) | `stone` | `sward` | `stone` | `sward` |
| Grove tree | `desert_tree` | `tree` (olive) | `cedar` | **`oak`** |
| Open-ground pass (`openScatter`) | none | none | cedar, boulder, bush, chip | **oak, willow at the water, boulder, shrub, chip** |
| Grass / bush families | shared | shared | shared, retinted | **`wet_grass` / `shrub`** (its own) |
| Marsh (`~`) | none | none | none | **`reed`** |
| Rocks | shared | shared | shared, `karst` tint | shared: `overcast` tint on wet faces, `basalt.0` on boulders |
| Props | the global mix | the global mix | the global mix | **its own mix**, with three new kinds |
| Haze | `dust.0` | `limestone.1` | `karst.0` | `overcast.1` (the bluer `#9FA9B5`, rev. 3) |
| Light | the mission's or `&tod=` | same | same | **the same, passed through `rainLight`** (4.5) |
| Weather | clear | clear | clear | **rain** |
| Ambience bed | `open` / `town` | `open` / `town` | `ridge` | `open` (beds are off) |

### 1.2 The per-theme ground set

Today `TERRAIN_GROUND_TEXTURE` is `Record<TerrainTheme, string>` (open ground only), and the other four URLs are
literals in `renderer-options.ts`. The change:
- A second table, `TERRAIN_SLOT_TEXTURES: Record<TerrainTheme, { rock, scrub, grove, knoll }>`, sits in
  `terrain-themes.ts`.
- The three existing rows name today's four files, so their URLs are unchanged. `renderer-options.test.ts`
  already pins the open-ground URL per theme; it gains the four slot URLs for each existing theme.
- `wetland` names its own four files.
- The road's grain samples the knoll slot (R-7), so the wet road gets basalt grit for free.

### 1.3 Per-theme families

The new optional `TerrainTones` fields, each absent on arid, green and highland:

| Field | Type | `wetland` value | Read by |
|---|---|---|---|
| `familyRemap?` | `{ grass?: DecorFamily; bush?: DecorFamily }` | `{ grass: 'wet_grass', bush: 'shrub' }` | `decor-place.ts` `familyFor` and its clump pass; mirrored in `decorFamiliesFor` |
| `waterside?` | `{ tree: GroveFamily; p: number; reach: number }` | `{ tree: 'willow', p: 0.12, reach: 1 }`: an open tile within one tile of a `~` tile rolls a willow at 0.12, on its own `tileHash` stream | `decor-place.ts`, a fourth pass after the open-ground pass |
| `marsh?` | hex | `mud.3`: the `~` tile's ground tone, under the water stand-in | `tones.ts` `groundTone`, `paintMapTerrain` |
| `propMix?` | `{ roadside: Record<PropKind, number>; yard: Record<PropKind, number> }` | section 3.4 | `prop-place.ts` |

The marsh water and the reeds must agree on where the water is. One pure function, `marshWater(x, z)` in
`terrain/shared.ts` (no `three` import), gives the meanders and pools. The control-C bake samples it for the water
mask, and the reed placer rejects a clump centre where it reads water.

`GroveFamily` gains `oak | willow`. The no-twin rule, `family !== 'cedar'` in `decor-place.ts` today, must include
`oak` (the oak grove is 0.6 a tile, no twin). `DecorFamily` gains `wet_grass | shrub | reed`. `DENSITY.reed` is 1.0,
for the reason `boulder` and `ditch` are 1.0: a `~` tile is a mechanic, a wall to vehicles, and a reed bed with a gap
in it would show a way through that is not there.

### 1.4 Rain belongs to the theme

- A third app table, `TERRAIN_WEATHER: Record<TerrainTheme, 'clear' | 'rain'>`, is `rain` for `wetland` only.
- `rendererOptionsFor` hands it to `RendererOptions.weather?`, read at boot like the quality preset.
- **No `&weather=` flag.** The lead ruled rain off the other maps, so the theme is the switch.
- A/B comparisons go through the debug layers (section 8), the `unitsDebugHidden` standard.

### 1.5 Every file and data surface, end to end

| # | Surface | File | Change | Guard, and its falsification |
|---|---|---|---|---|
| 1 | Schema | `data/schemas/map.schema.json` | `terrain` enum + `wetland`; the `rows` description gains `~` | `validate:data`; author `"wetland"` before the enum has it and watch it go red |
| 2 | Map types and legend | `packages/data/src/map.ts` | `TerrainTheme` + `TERRAIN_THEMES` set; `DECOR.marsh = 6`; `TERRAIN_LEGEND['~'] = { blocked: 0, boulder: 1, cover: 1, decor: DECOR.marsh }` | `tools/src/boulders.test.ts` gains `~` (vehicle-walled, open on foot, cover 1); drop `boulder: 1` and watch it go red |
| 3 | Grid lint | `tools/validate_data.mjs` | `TERRAIN_SYMBOLS` + `~`; refuses `~` on a map whose `terrain` is not `wetland` | author one `~` on `tile_green` |
| 4 | Palette | `data/palette.json` | `fen`, `mud`, `overcast`, `basalt`, all `theme_only`; `total_colors` 76 -> 89 (ramp colours 41 -> 54, and the `notes` line with it) | `terrain/tones.test.ts` and `terrain-defaults.test.ts`; drop `theme_only` from `mud`. `validate:data` refuses a stale `total_colors`. |
| 5 | Tone bundle | `packages/app/src/terrain-themes.ts` | `TERRAIN_THEMES.wetland`, `TERRAIN_GROUND_TEXTURE.wetland`, `TERRAIN_SLOT_TEXTURES`, `TERRAIN_WEATHER` | compile (total `Record`s); a new `wetland-readability.test.ts` with LITERAL oracles |
| 6 | Renderer options | `packages/app/src/renderer-options.ts` | slot URLs and `weather` from the tables | `renderer-options.test.ts` gains the slot URLs of the three existing themes; point `highland`'s rock slot at the wet tile and watch it go red |
| 7 | Render API | `packages/render/src/api.ts` | `GroveFamily`, the four optional fields, `RendererOptions.weather?` | compile |
| 8 | Decor placement | `three/terrain/decor-place.ts`, `terrain/shared.ts` (`DECOR_MARSH = 6` mirror) | families, `DENSITY`, `familyFor` for `~`, the remap, the waterside pass | `decor-place.test.ts`; `mesh-catalogue.test.ts` runs the REAL placer on every map |
| 9 | Decor catalogue | `packages/app/src/mesh-catalogue.ts` | `DecorFamilyName`, `DECOR_MESHES` (3 variants each), `decorFamiliesFor` mirror | the same test: a placed family missing from the plan is bare ground |
| 10 | Ground albedos | `three/terrain/mesh.ts` `GROUND_ALBEDOS` | five entries, each mean measured off its own image | `mesh.test.ts`; `tools/validate_assets.py` prints the slot line |
| 11 | Control map | `three/terrain/control-map.ts` | control C (RGBA8, 8 texels a tile): R the marsh weight, G a baked puddle mask, B and A spare. Built only on a wetland map. | `control-map.test.ts`; a non-wetland map allocates no C texture |
| 12 | Ground shader | `three/terrain/surface.ts`, `ground.ts` | a `THEME_WET` define: marsh water, puddles, ripples, roughness (section 4.3) | the byte-identity test (9.1) |
| 13 | Props | `three/terrain/prop-place.ts`, `prop-role.ts`, `tools/validate_mesh_assets.py` | three kinds, `PROP_TRI_CAPS` on both sides, `propMix` | `prop-role.test.ts` pins the two cap tables against each other |
| 14 | Light | `three/weather.ts` (new, no `three` import) `rainLight(preset)`; `three/haze.ts` `HAZE_LOW` under rain | section 4.5 | `weather.test.ts`; `time-of-day.test.ts` keeps `day` bit-identical |
| 15 | Rain | `three/units/rain-batch.ts` (new), `units/render-order.ts` `RAIN_RENDER_ORDER`, `quality.ts` `weatherDetail?` | section 4.4 | section 9.2 |
| 16 | Wet surfaces | `units/unit-surface.ts`, `terrain/sway.ts`, `decal-pool.ts` (colour indices 6 and 7, tread and tyre), the crater bowl | section 4.6 | values tests |
| 17 | VFX | `data/vfx/vehicle_mud.json` + `packages/data/src/index.ts` `vfxEmitters` | the wet theme's vehicle spray in place of `vehicle_dust` | `index.test.ts` pins the array to the directory |
| 18 | Debug layers | `three/debug-layers.ts` | `rain`, `wet`, `marsh`, `ripples`, `cloud-shade` | each is a flag no per-frame write re-asserts |
| 19 | Maps | `data/maps/ein_qasab.json`, `data/maps/jebel_matar.json`; `packages/data/src/index.ts` `maps`; `en.json` `freePlay.map.<id>` | section 5 | `map_grid.test.ts`, `high_ground_maps.test.ts` (`RISES`), `ambience.test.ts`, `sandbox-anchors.test.ts`, the menu spec that requires a key per map |
| 20 | Textures | `tools/textures/author_wetland_tiles.py` (new), `encode_ground_tiles.py`, `art/textures/*.png`, `assets/textures/*.jpg` | section 2.1 | seam ratio and mean printed by the author tool |
| 21 | Meshes | `tools/terrain/fit_meshy_wet_decor.py`, `tools/terrain/build_reeds.py`, `build_wet_grass.py`, `tools/terrain/props.py`; GLBs and `.blend` under `art/` | section 3 | `pnpm validate:meshes` (decor contract: zero materials, `rl_role` in {foliage, trunk}), `decor-heights.test.ts` (reed and grass heights) |
| 22 | Provenance | `art/meshy/ledger.jsonl`, `docs/ASSET_PROVENANCE.md`, the PR's AI disclosure | every Meshy base | `pnpm meshy -- spent` |
| 23 | Figure-ground | `tools/src/foliage-figure-ground.test.ts` | `THEMES` + `wetland` | it refuses a foliage tint inside the VR-05 floor; set `oak:foliage` to `fen.1` (ΔE2000 9.3) |
| 24 | Pins for everything else | `packages/app/src/terrain-defaults.test.ts` | extend the fixture from the non-highland maps to **all 35 shipped maps**, regenerated at the commit BEFORE the wiring and committed alone | a later diff that moves any shipped map goes red |
| 25 | Visual gate | `tools/src/golden-diff/capture-protocol.ts` | two report-only scenarios (section 8) | three fresh-process runs read 0 px before any floor |

Not touched: the sim, `mission.schema.json`, `validate_biome.mjs` (`REGION_BIOME`, since no region uses the theme),
`render_campaign_world.py`, `data/versus/`, and the textured buildings.

## 2. Art list, with numbers for approval

**Every model is made at maximum detail** (the lead, 2 Oct). The master keeps full geometry. The shipped GLB is cut
only to the measured cap in section 3, and each fit report states what the cap cost. Nothing below is rendered or
generated before the lead approves these numbers.

### 2.1 Ground tiles (procedural, 0 credits)

Each tile is authored by `tools/textures/author_wetland_tiles.py`:
- numpy, with PERIODIC hand-rolled value noise and fBm, so it is seamless by construction. Never `mathutils.noise`.
- Deterministic, from a 4096² master box-filtered to the shipped 1024².
- JPEG q90, `NoColorSpace`.
- Gate: an edge-to-adjacent ratio of at least 0.9 (the sand measured 0.95), and the mean measured into
  `GROUND_ALBEDOS`.
- The image carries hue variation only. The theme tone sets the average (the ratio form).
- Figure-ground (new, rev. 3): at the zoom-1 mip, at most 5% of the open and scrub tiles' composed texels (ratio x
  theme tone) may lie within ΔE2000 12 of KDF `olive.1`. The author tool prints the share and refuses above it.

| Slot | File | Content | Repeat (tiles) | Gain | Why that repeat |
|---|---|---|---|---|---|
| open | `wetland_open_tile` | Spring-flush sward in clumps over yellow-umber alluvial mud: 60% blades, 40% mud. **Mud and sward are segregated at clump scale with hard edges, and the understorey inside a clump is dark green, not mud** (4.2's mixture note). About 15% straw thatch. Sparse basalt grit. | 3 | 1.25 | The highland's 3. Clumps land at about one per half tile at zoom 1. |
| rock (`^` tops and faces) | `basalt_rock_tile` | Vesicular wet basalt, columnar cracks, a few lichen flecks | 2 | 1 | `rock_ground_tile`'s 2 |
| scrub (cover 1-3) | `wet_scrub_tile` | Rush and bramble litter, dead stems over mud | 2 | 2 | `rough_scrub_tile`'s numbers |
| grove (`o`) | `oak_litter_tile` | Oak leaf litter, acorn cups, moss patches | 2 | 1.5 | `orchard_floor_tile`'s numbers |
| knoll (`n`) and road grain | `basalt_scree_tile` | Basalt cobbles set in mud | 3 | 1 | `knoll_scree_tile`'s 3. The road reads it at 2 (R-7). |

The marsh `~` gets no image. It is the scrub image under the water stand-in (4.3).

**Load.** Five JPEGs replace five, at about 0.6 to 0.7 MB each, so a wet map loads about what any map loads.
`pnpm perf:load` measures it in P3; this is not a recited number.

### 2.2 Foliage (the wet-climate set)

**Season (rev. 3): the late-winter / early-spring flush.** Both trees are deciduous (the Tabor oak tardily), so a
January rain theme would have a bare willow and a half-bare oak. The theme is set at the flush instead: leaf-on, at
the earliest and yellowest green. The Meshy prompts ask for "leaf-on, early spring flush", never "winter". A truly
bare willow would be a separate asset, and it is not recommended.

| Family | Species | Where | Heights (3 variants) | Roles | Source | Credits |
|---|---|---|---|---|---|---|
| `oak` | Tabor oak (*Quercus ithaburensis*): broad, rounded, open crown | grove `o` (0.6 a tile, no twin, the cedar rule); slopes through `openScatter` | 5.0 / 4.2 / 3.4 m | trunk + foliage | **Meshy, 2 bases** (text preview 20 + remesh 5 each). Variant 2 is a Blender crown cut of base 0, not a byte copy (the olive's `tree_1 == tree_2` defect). | 50 |
| `willow` | White willow (*Salix alba*), upright with a loose crown | within one tile of `~`, at 0.12 | 4.6 / 3.8 / 3.0 m | trunk + foliage | **Meshy, 1 base**; variants 1 and 2 by Blender lean and crown cut | 25 |
| `shrub` | Lentisk (*Pistacia lentiscus*), dense evergreen mound | cover 1-3 (the `bush` rule: 0.6 x (0.5 + 0.5 x cover)); open ground at 0.04 | 1.3 / 1.1 / 0.9 m | trunk + foliage | **Meshy, 1 base**; variants by Blender | 25 |
| `reed` | Common reed (*Phragmites*) x2 and bulrush (*Typha*) x1: last year's straw culms with new green shoots at the base, laid as a continuous MAT | every `~` tile, 1.5 clumps a tile, each about 0.8 tile across, never on a water fragment (1.3) | **at most 1.5 m DRAWN**, after the 0.8-1.2 scale roll (models 1.25 / 1.10 / 1.00 m), so a standing man's head and shoulders read | foliage | **Blender, procedural**: modelled blades and seed heads, hand-rolled noise | 0 |
| `wet_grass` | Spring-flush sward tuft, lusher than `grass` (more and wider blades). It cannot be taller: the shipped grass already sits at N-4's 0.40 m model (2.8). | open ground (the clump pass, `SCATTER_DENSITY` 0.75 unchanged) | within `GRASS_SCALE_MAX` 0.9 (N-4: grass never hides a unit) | foliage | **Blender, procedural** | 0 |

Foliage tints are instance tones (+0 draws). Each was measured against the KDF uniform's `olive.1` on the VR-05
floor (CIE76 at least 15 and ΔE2000 at least 12, `foliage-figure-ground.test.ts`):

| Key | Tone | ΔE76 / ΔE2000 from `olive.1` | Verdict |
|---|---|---|---|
| `oak:foliage`, `shrub:foliage` | `scrub.1` | 15.9 / 12.6 | passes (VR-05's own pick) |
| `willow:foliage` | `fen.0` | 28.6 / 18.4 | passes; the silver-green of a willow against the oak |
| `wet_grass:foliage` | `grass.3` | 35.4 / 21.3 | passes |
| `reed:foliage` | **`dust.5`** (rev. 3; was `dust.3`) | 19.4 / 15.6 | passes. It is 7.3 ΔE2000 from the photographed winter reed, against 15.5 for `dust.3`. Against the enemy's darkest uniform step, `dust.4`, it reads 7.9 / 6.9 (`dust.3` read 6.3-7.1 against `dust.2`/`dust.4`); no floor covers the enemy. |
| (refused) | `fen.1` | 17.0 / 9.3 | fails ΔE2000. It is why `fen.1` is a ground tone only. |

### 2.3 Rocks

**Recommended: reuse.** Through `decorColors`, the way highland tinted them `karst`, at 0 credits:
- `slab` takes `overcast.4` and `rock` takes `overcast.3`: the wet faces, which ref 08 confirms (3 from `overcast.4`).
- `boulder` takes **`basalt.0` `#4B453D`** (rev. 3). These are the warm, dark Golan boulders of the `b` fields
  (ref 06, L51-54), which no `overcast` step reaches.

The alternative is a Meshy basalt boulder base (25 credits, Blender variants), only if the P3 capture still reads
as limestone. That is decision 8.

### 2.4 Props

| Kind | Tri cap | Mix (roadside / yard) | Source | Credits |
|---|---|---|---|---|
| `round_bale` (wrapped silage bale) | 160 | 0 / 0.30 | Blender | 0 |
| `culvert_pipe` (concrete drain under a track) | 140 | 0.30 / 0 | Blender | 0 |
| `tractor_wreck` | 400 | 0.15 / 0.10 | Meshy, 1 preview (20 + a remesh 5 if the first decimation collapses, the props precedent) | 25 |
| the shipped seven | as shipped | jersey 0.20, tyre 0.20, wrecked car 0.05, rebar 0.10 / water tank 0.20, dish 0.10, laundry 0.20, tyre 0.10 | — | 0 |

Roles come from the closed `PROP_ROLES` set: the bale is `cloth`, the pipe `concrete`, the tractor `rust` and
`rubber`. A new role is not needed.

### 2.5 Buildings, audio

- **Buildings stay as shipped.** Houses, the hall and the warehouse keep their textured stone bakes. A basalt-stone
  village is a later call, and it would go through `TEXTURED_BUILDING_TYPES` like any baked building.
- **No rain audio.** The ambience beds are off by the lead's ruling. A rain bed later belongs to the audio lane,
  with redistributable sources only and silent tests.

### 2.6 Meshy budget

| Item | Calls | Credits |
|---|---|---|
| Oak, 2 bases | 2 previews + 2 remeshes | 50 |
| Willow | 1 + 1 | 25 |
| Lentisk shrub | 1 + 1 | 25 |
| Tractor wreck | 1 + 1 | 25 |
| **Planned** | | **125 (about $2.50 at the CLI's $0.02 estimate)** |
| Re-roll allowance, at most one per concept, announced first | up to 3 | +75 |
| **Cap** | | **200 (about $4.00)** |

How the calls are run:
- **Prompts.** An Opus 5.5 agent at high effort writes every prompt, picks the preview and decides any re-roll (the
  lead's 21 Oct rule). It works from the approved mood board and the numbers above, and puts no personal data in
  any prompt. Trees are asked for "leaf-on, early spring flush", never "winter"; the lentisk for "fine small leaves,
  dense dome". No reference image is ever an input.
- **Detail.** Previews are made at full detail, not in the low-poly mode, and the preview is kept as the master. The
  remesh cuts to the section 3 cap.
- **Before each call.** `pnpm meshy -- estimate` runs first, and each call is announced in the ledger with its
  credits.
- **Texture.** No texture is requested. Decor and props carry zero materials, so `text-refine` is not bought.
- **Downloads.** Files go to `art/meshy/<task>/` the same day, because Meshy keeps them for three days only.
- **Records.** Each base gets a ledger line, a provenance entry and an AI disclosure in the PR.
- **Optional.** A Meshy basalt boulder (decision 8) would be 25 more, inside the cap.

### 2.7 Mood board (P1, reference study only)

**Done 28 Oct.** There are 22 references (19 Wikimedia Commons, 3 RTS store screenshots, all study only), logged in
`_coord/wet-theme/sources.md`. The sheet is `mood-board.png`, with the measurements in `notes.md`; it replaces the
planned `board.html`. The five adjustments it argued for were approved (the revision 3 list above). Still wanted
before P4: a Levantine rain photograph, and a game frame with falling rain to check the streak numbers in 4.4.

- **Where.** About 20 references in `roaring-lions-ep/_coord/wet-theme/refs/`, outside the repo.
- **Use.** They are never committed, never fed to Meshy, never traced and never shipped.
- **Records.** Each reference is logged with its source URL and licence. No personal data goes into any search.
- **The sheet.** As planned: one page annotating each reference with the number in this spec it argues for. It
  shipped as `mood-board.png` with `notes.md`.

| Category | Count | What to take from it |
|---|---|---|
| Winter reed marsh with standing water, at about a 30-degree view | 3 | water share between clumps, reed colour, the 0.35 reflectance |
| Wet basalt outcrops and dykes | 3 | rock value and coolness; whether `overcast` is dark enough |
| Tabor oak woodland in winter rain | 2 | crown shape and density; leaf tone |
| Willow at a stream edge | 2 | silhouette against the oak |
| Lentisk and bramble cover | 2 | shrub mass and tint |
| Alluvial mud under winter sward; churned farm tracks | 3 | the open tile, puddle coverage on tracks |
| Overcast valley, low cloud on a ridge | 2 | haze depth, sky value, cloud-shade scale |
| Rain in top-down and isometric strategy games, mechanics only | 3 | streak density and alpha, unit readability under rain |

### 2.8 Art numbers, summary (for approval)

The full sheet is `_coord/wet-theme/art-numbers.md`, outside the repo next to the board. It has one row per model,
with the part lists, the checks and their falsifications, and the per-call Meshy plan. Heights are the model; the
drawn height multiplies the placement pass's scale roll. Pixel figures are at zoom 1 (12.2 px/m). Decor and props
add **+0 draw calls**.

| Model | Real size | In game (model, then drawn at most) | Roles / tint | Cap | Source | Credits |
|---|---|---|---|---|---|---|
| Tabor oak, base A (`oak_0`, `oak_2`) and base B (`oak_1`) | 10-20 m | 5.0 / 4.2 / 3.4 m, crowns 1.5 / 1.3 / 1.1 tiles; at most 6.0 m (73 px) | trunk (`mud.2`, proposed) + foliage `scrub.1` | 2,500 | Meshy, 2 bases | 50 |
| White willow | 10-25 m | 4.6 / 3.8 / 3.0 m, crown about 0.55 of height; at most 5.3 m | trunk + foliage `fen.0` | 2,500 | Meshy, 1 base | 25 |
| Lentisk | 1-3 m | **1.0 / 0.9 / 0.8 m** (spec had 1.3 / 1.1 / 0.9); at most 1.4 m in the open pass | trunk + foliage `scrub.1` | 600 | Meshy, 1 base | 25 |
| Reeds: common reed x2, bulrush x1 | 1.5-4 m | 1.25 / 1.10 / 1.00 m; **at most 1.5 m drawn** (18 px) | foliage `dust.5`; proposed trunk (new shoots) `scrub.1` | 400 a clump | Blender, procedural | 0 |
| Winter grass | 0.15-0.5 m | at most 0.40 m (N-4: 0.36 m drawn) | foliage `grass.3` | 200 | Blender, procedural | 0 |
| Round bale | 1.2-1.5 m | 1.1 m diameter x 1.0 m | `rubber` recommended (black wrap) over `cloth` | 160 | Blender | 0 |
| Culvert mouth | 0.6-1.2 m bore | headwall 1.6 x 1.0 m, 0.8 m stub | `concrete` | 140 | Blender | 0 |
| Tractor wreck | 3.0-3.4 m long | 2.8 x 1.5 m, at most 1.6 m tall | `rust` + `rubber` | 400 | Meshy, 1 preview | 20-25 |
| Five ground tiles | 6-9 m per image | 1024², 114-171 texels/m | ratio images, `NoColorSpace` | — | numpy, procedural | 0 |
| **Meshy** | | 10 calls, each announced in the ledger first | | | | **125 planned (about $2.50), 200 cap (about $4.00)** |

**Where the sheet departs from sections 2-3** (each for the lead):
- The lentisk drops to 1.0 m. The open-ground pass rolls a bush at 0.9-1.4, so 1.3 m would draw at 1.82 m, taller
  than a standing figure on ground that grants no cover.
- The reed's 1.5 m becomes a DRAWN limit.
- Wet grass is lusher, not taller: the shipped grass already sits at N-4's limit.
- The bale is black `rubber` rather than pale `cloth`.
- Trunk tints are proposed.
- Oak and willow crown widths are added.

**One readability risk carried into P2/P3:** the continuous reed mat at 1.0-1.5 m covers a KNEELING figure (about
1.2 m), and infantry kneel to fire. The `~` tile is real cover, so some concealment is honest. It is measured in the
P3 plate and the P5 capture. If a kneeling squad vanishes, the reed variants drop to 1.1 / 1.0 / 0.9 m first.

## 3. Triangle caps and the foliage budget

The binding cost of a lusher set is TRIANGLES, not draw calls (section 0).

Per-variant caps for the shipped GLB:
- oak 2,500 and willow 2,500 (the olive ships 2,850-3,000, the cedar 1,523);
- shrub 600 (the bush 430-456);
- reed 400 a clump;
- wet grass 200 (grass 142-168);
- props as in 2.4.

**Whole-map placed decor.** Estimated from the grid census times density times tris, by the placement rules above:

| Map | Placed decor triangles (estimate) | Note |
|---|---|---|
| `wadi_halam_basin` (shipped, green) | about 1.09 M | 228 olive tiles x 1.38 trees; this load is GH-829's 2.2 ms at z1 |
| `qarn_hadid` / `umm_zeitoun` (shipped, highland) | about 0.55 M | |
| `tel_marum` (shipped, highland) | about 0.43 M | |
| **Ein Qasab (proposed)** | **about 0.75 M** | reeds 0.18 M, grass 0.18 M, oak grove 0.14 M, open trees 0.09 M |
| **Jebel Matar (proposed)** | **about 0.70 M** | grass 0.20 M, oak grove 0.18 M, shrubs 0.09 M |

**Ceiling proposed (decision 11): at most 0.9 M placed decor triangles a wet map**, measured by running
`decorPlacements` over the shipped map. That keeps each wet map below the heaviest shipped map. If a map goes
over, the oak cap drops first (2,500 -> 2,000), then the reed clumps a tile (1.5 -> 1.2). `SCATTER_DENSITY` stays
0.75.

## 4. The look

### 4.1 Palette

All four ramps are `theme_only`. Revision 3 applies the mood-board rulings: the yellower `mud`, the bluer
`overcast.1`, and one `basalt` step. Luminance is Rec.709 on the sRGB bytes, as in revision 1. Every ramp descends in
brightness (index 0 is the lightest); the L columns are the check.

| Ramp | 0 | 1 | 2 | 3 | 4 | Role |
|---|---|---|---|---|---|---|
| `mud` (rev. 3) | `#8E6F55` L116 | `#725944` L93 | `#584535` L72 | `#413327` L53 | `#2D241B` L37 | wet earth, tracks, ruts, prints, the marsh floor, proposed tree trunks |
| `overcast` (rev. 3: `.1` bluer) | `#C4C8C9` L199 | **`#9FA9B5`** L168 | `#83898D` L136 | `#656B70` L106 | `#4A4F54` L78 | sky, haze, the water's sky reflection, streaks, wet basalt |
| `fen` | `#75A659` L150 | `#4B7135` L101 | | | | spring sward, the open-ground average, and the cover-1 ground |
| **`basalt` (new, rev. 3)** | `#4B453D` L70 | | | | | the decor boulder tint only |

What changed, and why:
- **`mud`.** The revision-1 ramp (`#A06C48 #85543A #6A402D #502F22 #382019`) had saturation 0.55-0.58 and hue
  14-25, a brick red. Every soil and mud sample on the board measured saturation 0.22-0.37 and hue 29-39, a yellow
  umber. The new ramp keeps the same lightness steps, at hue 27-30 and saturation 0.40. It is seen in the P2
  capture, and the revision-1 ramp is the recorded fallback if it reads dead.
- **`overcast.1`.** Far haze in the references reads blue (hue 206-215, saturation 0.18). The new `.1` keeps L168
  and moves from hue 200 / saturation 0.05 to hue 213 / 0.12, 4.3 ΔE2000 from the old value. It also moves the sky
  key and the splash, which share the key; the references support both.
- **`basalt`.** Wet faces stay `overcast.3` / `.4` (ref 08 sits 3 from `overcast.4`). The Golan boulders (ref 06)
  are darker and warm (L51-54, hue 30-42), and no ramp holds that tone. It is a separate one-step ramp because
  appending it to `overcast` would put a warm step in the cool ramp. **It is a tint key only:** `wetland` does not
  list it in `paletteRamps`, so the terrain quantiser never snaps ground to it. The darker candidate `#35322C` was
  dropped, because it sits 12.7 RGB from `olive.3`, the KDF uniform's shadow step.
- **`fen` is kept.** If the P2 capture reads cold, `fen.0` -> `#7BA350` (hue 89). It reads 17.5 against KDF
  `olive.1`, which passes the 15.6 pin. Darkening `fen` toward the photographs fails that pin (`#689350` reads 13.1,
  `#6D9648` 14.1), which is why it is not done.

Why `fen` earns its place:
- No shipped green is a deep, saturated winter sward. `grass` runs yellow-green from L214 down to L131, and
  `scrub` has two steps.
- `fen.0` sits 26 RGB from `grass.3`, and `fen.1` 26 from `scrub.1`.
- Steps darker than `fen.1` were drafted and dropped: they landed 8-11 RGB from `scrub.1` and `olive.3`, which
  already serve.

Two honest notes on near-duplicates. Both are harmless, because the ramps are `theme_only` and move nothing
outside the theme:
- `overcast.0` sits 5 RGB from the shared `gunmetal.0`.
- The new `mud.0` / `.1` / `.2` sit 8.3 / 11.2 / 11.9 RGB from the shared `limestone.6` / `.7` / `.8`, and `mud.4`
  sits 10.8 from `shadow.0`.
Inside the wet theme the quantiser can land on either member of each pair, and the two look nearly the same.

### 4.2 The `wetland` tone bundle

| Field | Tone | Note |
|---|---|---|
| `open` | `fen.0` | over `wetland_open_tile` |
| `cover` 1/2/3 | `fen.1`, `scrub.1`, `olive.3` | under shrubs |
| `blocked` / `underBuilding` | `overcast.3` / `shadow.0` | |
| `road` / `rut` | `mud.1` / `mud.3` | a mud track with basalt grit |
| `rock` / `rockLit` | `overcast.4` / `overcast.3` | wet basalt |
| `earth` / `spoil` | `mud.2` / `mud.3` | |
| `marsh` | `mud.3` | under the water stand-in |
| `low` | `fen.1` | |
| `trunk` / `trunkLit` | `mud.3` / `mud.2` | |
| `leafDark` / `leafMid` / `leafLit` | `olive.3` / `scrub.1` / `fen.0` | |
| `bladeLit` / `bladeShade` | `grass.3` / `fen.1` | the `sward` grain |
| `scatter` / `groveFamily` / `crownRatio` | `sward` / `oak` / 0.8 | |
| `haze` | `overcast.1` | the bluer `#9FA9B5` (rev. 3) |
| `paletteRamps` | `['fen', 'mud', 'overcast']` | |
| `macroHue` | `[fen.0, mud.2]` | |
| `decorColors` | section 2.2, plus `boulder:rock` **`basalt.0`**, `rock:rock` `overcast.3`, `slab:rock` `overcast.4`; proposed `oak:trunk`, `willow:trunk` and `shrub:trunk` `mud.2`, and `reed:trunk` `scrub.1` (2.8) | rev. 3 |
| `openScatter` | tree `oak`, treePlain 0.006, treeFoothill 0.03, boulderPlain 0.01, boulderFoothill 0.03, bush 0.04, chipPlain 0.04, chipFoothill 0.08, chipCluster 0.3, sandKeep 0 | about three quarters of the highland's, because the wet maps carry groves and reeds as well |

**Readability floor (decision 5).** ΔE2000 of the uniforms against the open-ground tone:

| Uniform tone | on wetland `fen.0` | on green `grass.2` | on highland `dust.5` |
|---|---|---|---|
| KDF `olive.1` | **18.4** | 23.9 | 15.6 |
| KDF `olive.0` (lit) | 11.0 | 13.1 | 22.3 |
| Enemy `dust.0` / `dust.2` / `dust.4` | 26.5 / 27.1 / 29.0 | 19.0 / 22.5 / 28.8 | 30.0 / 20.9 / 6.9 |
| Civilian `water.0` / `water.1` | 31.9 / 38.5 | 31.5 / 43.8 | 41.7 / 32.7 |

The wet open ground sits between the two shipped green-ish themes for KDF and is better than both for the enemy.

The pin is KDF `olive.1` on `open` at **at least 15.6** (the lowest shipped theme's figure), against LITERAL
oracles, not values imported from the bundle. The falsification is to set `open` to `scrub.0`, which reads 9.8,
and watch the test go red.

**The revision-3 colours against the floors.** Pairs are CIE76 / ΔE2000 against KDF `olive.1`. The calculator
reproduces every figure above.

| Colour | Use | vs `olive.1` | Verdict |
|---|---|---|---|
| `dust.5` | `reed:foliage` | 19.4 / 15.6 | passes VR-05 (15 / 12) |
| `mud.1` / `.2` / `.3` (new) | road / earth / rut and the marsh floor | 19.7 / 19.1, 24.8 / 22.5, 31.4 / 26.5 | pass (the revision-1 road read 28.1 / 24.6) |
| `basalt.0` | boulders | 27.0 / 21.0 | passes |
| `overcast.1` (new) | haze, sky | 38.2 / 30.8 | passes |
| `#7BA350` (the conditional `fen.0` nudge) | open ground; `willow:foliage` | 28.3 / 17.5 | passes the 15.6 pin and VR-05 |
| water and puddles, an albedo proxy (`(1-R) x 0.55 x mud.3 + R x overcast.0`, linear) | the water surface | lowest **15.8 at R 0.26** (the revision-1 mud: 17.8) | passes by 0.2. KDF-on-water is read in the P2 A/B. |

**A mixture note: green over brown is olive drab.** A texel that mixes `fen.0` with `mud.1` reads within 15.6 of
`olive.1` at ANY mud share from 20% to 95%, and at 70% it is 1.5 ΔE2000 from the uniform (the revision-1 mud: 5.6
at 60%). The mean tone passes, but a mixed patch is the KDF uniform. That is why:
- the open tile keeps mud and sward apart at clump scale, with a green understorey (2.1);
- the tile carries a figure-ground histogram (2.1);
- road edges (the 0.5-tile fen-to-mud blend) are read in the P2 capture with a KDF vehicle on the verge.

### 4.3 Wet ground, the marsh and puddles

These terms go into the ground shader under a `THEME_WET` define, so the other three themes compile today's program
byte for byte (9.1). The masks are baked into control C at boot, not computed per fragment.

| Term | Rule | Numbers (for approval) |
|---|---|---|
| Marsh `~` | the C.R weight, with a 0.5-tile soft edge like every surface. The water lies in meanders and pools from `marshWater(x, z)` (1.3), under a continuous reed mat; the reeds keep off it. | **25-35% water by area inside a marsh tile** (rev. 3; was 55%); a `mud.3` floor x 0.55; reflectance by the P2 A/B below |
| Puddles, roads | in the ruts: B's road distance inside the rut band, times the rut noise | 25-35% of road area |
| Puddles, open ground | the macro field thresholded on FLAT ground (normal y above 0.985) | 4-8% of open ground |
| Puddles, low ground | boosted below the map's median open level (`hazeReferenceLevel`) | +6% at 2 levels below |
| Never water | a terrace top, a `^` top, a building pad, a slope over 10 degrees, a crown | — |
| Puddle surface | the wet tone mixed toward `overcast.0` scene-referred by an AUTHORED reflectance | albedo x 0.55; **reflectance A/B in P2: 0.20-0.25 against 0.35** (rev. 3), keeping whichever reads 1.5-2x the mud beside it (refs 16, 17). On the new `mud.1` the albedo proxy gives 1.47x / 1.70x / 2.16x at 0.20 / 0.25 / 0.35. Physical Fresnel here would be 0.05, which reads as nothing. |
| Edge | a soft rim of darker mud | 0.06 tile, `mud.3` |
| Ripples | rings on water fragments only, on the sim clock, each ring cell a `tileHash` stream | 0.12-tile rings, 0.9 s life, 2 a cell, 0.5-tile cells; ±15% on the reflection; at most an 8-degree normal tilt |
| Roughness | open 0.62, road mud 0.45, water 0.08, basalt top 0.55 | Honest note: flat ground shows almost nothing (section 0). It is there for relief faces and ripples. |

Not recommended:
- screen-space reflections: +0.6 to +1.2 ms on a frame that already misses;
- an environment map: it would reopen the 0.45 metal cap game-wide;
- planar mirrors: impossible on a bicubic ground.

### 4.4 Falling rain (approved shape)

One world-space instanced batch, `units/rain-batch.ts`, built the way the flipbook pool is: GPU-aged and drawn in
the main pass only. It has no `normal` attribute and `castShadow` is false, so the AO and shadow passes never see
it.

| Number | Value |
|---|---|
| Count | `high` 6,000 / `medium` 3,500 / `low` 1,500 (approved) |
| Placement | each instance is a hashed seed, at `hash(i) + fall(presentationSimMs)`, wrapped in a box that follows the camera focus. Drops stay fixed in the world on a pan. |
| Fall speed | 4.0 wu/s (12 m/s), slanted 12 degrees down-wind |
| Streak | 0.42 wu long, 1.5 CSS px wide at every zoom (the constant-pixel rule), alpha 0.28 |
| Splash | in the same instance and draw: a ring of 0.04 -> 0.10 wu over 150 ms, alpha 0.35 -> 0, `overcast.1` |
| Ground height | from an R16F texture, 4 texels a tile (37 KB on 48x48), baked at boot from `ground-height.ts`'s own sampler |
| Colour | `overcast.0` x the haze's scene-referred light factor. It stays under 1.0, so it never blooms, and `hdr-gains.ts` gets no entry. |
| Occlusion | buildings hide drops through the depth test. Drops write no depth, so the fog pass shrouds a streak by the ground behind it. Rain is uniform, so it leaks nothing about unexplored ground. |
| Render order | a new `RAIN_RENDER_ORDER` in `render-order.ts`, in the FX-above band (3): over units, under overlays (4), smoke (5) and the occlusion outline (6) |
| Reduced motion (`data-motion`) | no falling rain and no ripples. The wet ground and the light stay. |
| Pause | the rain freezes mid-air: the sim-clock rule, as with sway (approved) |
| Minimap | `photographGround` hides the batch. The water and the wet tones draw. |

### 4.5 Light and haze

**`rainLight(preset)`** is a pure function in `three/weather.ts`. It is applied when `RendererOptions.weather` is
`rain`, which means on every wetland map, over whatever preset the boot chose: `day` by default, or `&tod=` in
Free Play. It keeps the preset's sun DIRECTION (rain at dawn is still dawn) and changes the rest:

| Quantity | `day` today | `wetland` over `day` | Rule |
|---|---|---|---|
| Sun intensity | 2.6 | 1.2 | x0.46 on any preset |
| Sun colour | `limestone.0` | `overcast.0` | |
| Fill (hemisphere) | 0.9 | 1.35 | as a `LightOverride.fill` |
| Sky key | `water.0` | `overcast.1` (`#9FA9B5`) | |
| Shadow strength | 1 | 0.45 | as a `LightOverride.shadow` |
| Shadow map | 4096 / 2048 / 1024 | 2048 / 1024 / 1024 | one step down; overcast shadows are soft (approved) |
| `hazeFar` / `hazeKey` | 0.12 / theme | 0.26 / `overcast.1` (`#9FA9B5`, bluer, rev. 3) | max(preset, 0.26); never above 0.26 |
| `HAZE_LOW` | 0.06 | 0.10 | valleys fill with murk |
| Exposure | ACES 1.0 | **ACES 1.0, unchanged** | the colour-pipeline rule; the dimming comes from the lights |

Open-ground irradiance falls 23% (0.964 -> 0.742): moody without a black frame. Rain must not visually hide what
the sim lets the player see. A report reads unit-on-ground contrast at the far haze point, on the `wet` capture.

**Low cloud shade:** optional, in P6.
- a ±6% luminance multiply in the fog pass, before the shroud;
- 14-tile cells drifting at 0.4 tiles/s on the sim clock, from `terrain/noise.ts`.

**Lightning: none** (approved).

### 4.6 Units, decals, VFX

| Subject | On a wetland map | Cost |
|---|---|---|
| Foliage | sway amplitude x1.5 and gust gain 1.4 -> 1.8, on the sim clock; the reeds share the foliage batch and its sway | 0: uniforms |
| Units | roughness only: cloth 0.92 -> 0.80, armour 0.78 -> 0.52, plate 0.70 -> 0.48, gunmetal 0.42 -> 0.32. Metalness unchanged (cap 0.45). No albedo darkening. | 0 |
| Decals | tread and tyre prints (colour indices 6 and 7) take `mud.3`. A crater bowl below its `craterHeight` threshold takes the water surface. | about 0 |
| Vehicle spray | `vehicle_mud.json` in place of `vehicle_dust.json`: low, short, `mud.2`, life x0.5, no rising column | 0 net: a swap |
| Smoke | unchanged; smoke is a sim fact | 0 |

**No status marks in the world.** The theme adds no badge, icon or "muddy" mark to any unit.

## 5. The maps (Free Play only)

### 5.1 How many and how big

**Recommend two maps at 48x48** (decision 12). Every shipped map is that size, and the camera, minimap, sandbox
anchors, flow-field pool and every frame measurement were taken at it. One map would show the theme but only one of
its two ideas. A third, a wet village, is the dense-town shape the lead has warned about (6 Oct), so it waits.

Both follow these rules:
- **Keep the fight visible.** Built share stays at 3% or less, and no building stands on a main route.
- **Relief.** A hiding crest stands 2 levels above its ground, and every open step is at most 1 level per tile.
- **Slope.** Slope only reorders a route over ground that rises above its destination and comes back down. A
  16-tile bowl reorders nothing.
- **Buildings.** Each building stands on one level.

The ids are working names, fictional in the existing style. Before authoring, `narrative-designer` checks them for
a collision with a real place.

### 5.2 The marsh symbol `~`

`~` is cover 1 plus the vehicle wall: `{ blocked: 0, boulder: 1, cover: 1, decor: marsh }`. It is legal only on a
`wetland` map.

**It adds no sim code.** It composes two mechanics the sim already has:
- the second blocked mask that `b` and `d` use, so vehicles bog and infantry wade;
- cover 1 (`COVER_SIG` 0.75, `COVER_HIT` 0.375), the same as an `o` grove.

What follows from that:
- `pnpm test:determinism` and the §5.7 targets cannot move, and `pnpm balance` is blind to terrain in any case.
- The look matches the rule: a reed bed you can hide in is cover, and a marsh a tank drives through would be a lie.

The rejected options are in decision 3.

The ten symbols used: `.` open, `1`-`3` cover, `r` track, `o` oak grove, `n` knoll, `^` basalt crag or dyke, `b`
boulder field, `~` marsh, plus structures (`h` house, `w` barn as the warehouse type, `=` wall). `d` (a ditch) is
not used.

### 5.3 Ein Qasab ("Reed Spring"): the marsh valley

| Band | x | Elevation | Content |
|---|---|---|---|
| West ridge | 0-11 | rising 1 -> 4, crest at x 6-8 | Three broken runs of `^` basalt crags along the crest (about 60 tiles, sight walls). Four oak copses `o` on the east-facing slope (about 90 tiles). A boulder skirt `b` at the foot (about 50). |
| Valley floor | 12-33 | 0 | A reed marsh `~` meandering north to south, 6-9 tiles wide (about 300 tiles, 13%). **Two causeways**: `r` raised to level 1, at y 12 and y 34, 22 tiles apart. Willows along both banks (the waterside pass). Puddled tracks to both causeways. |
| East downs | 34-47 | 1-2, with a 2-level crest at x 38-40 from y 6 to 40 | A hamlet of four `h` houses and a walled yard (built share about 2%) on a knoll `n` at (42, 22). Cover hedges `1`/`2` along field bunds (about 170). |

- **Markers:** `kdf_start` (4, 44), `causeway_n` (22, 12), `causeway_s` (22, 34), `hamlet` (42, 22),
  `east_crest` (39, 10). The sandbox anchors take `kdf_start` as the player and the hamlet and crest as the
  opposition.
- **What it plays as:**
  - Vehicles have two crossings 22 tiles apart. Infantry wade anywhere, in cover.
  - The west ridge overwatches the whole floor.
  - The east crest hides the hamlet's approach until you are on it.
- **The pin:** a vehicle FlowField from `kdf_start` to `hamlet` passes a causeway tile, and a foot field may not.
  This is a doctrine test in the shape of `tel_marum_doctrine.test.ts`. Its falsification is to delete one
  causeway and watch the vehicle route move to the other, then delete both and watch it fail.

### 5.4 Jebel Matar ("Rain Hill"): the wet downs

| Band | y | Elevation | Content |
|---|---|---|---|
| North crest | 12-16 | 3, a high shoulder at level 4 near the axis and a saddle at level 1 eight tiles east | Boulder fields `b` on its north flank (about 60). The summit is at (8, 6), level 4. |
| Hollow | 17-30 | 0 | A farmstead (house, barn `w`, walled yard `=`, built share about 1.5%). Three marsh pockets `~` (about 80 tiles). A muddy track loop `r` through both saddles. |
| South crest | 31-34 | 2-3, with a saddle at level 1 | Oak copses `o` on its south face (about 120). |
| Throughout | | | A basalt dyke `^` running diagonally to the NE (about 90 tiles), a wall with one vehicle gap. Hedges `1`/`2` along bunds (about 180). |

- **Markers:** `kdf_start` (24, 46), `farm` (24, 23), `north_summit` (8, 6), `saddle_w`, `saddle_e`.
- **What it plays as:**
  - Two crests that each hide what is behind them.
  - The Qarn Hadid "two ways through" shape, softer: a high shoulder or a low saddle, and the relief has to
    reorder the route, not just price it.
  - The dyke gap is a vehicle choke, and the marsh pockets close the hollow to vehicles off the track.
- **The pin:** a relief test against a control with the same rows flattened, in the shape of
  `qarn_hadid_relief.test.ts`.

### 5.5 The Free Play entry

- Each map is a JSON file in `data/maps/` and an entry in `packages/data/src/index.ts` `maps`.
- Each needs one `freePlay.map.<id>` line in `en.json`:
  - "A reed marsh in the rain, crossed by two causeways under a basalt ridge."
  - "Wet downs: two crests, a basalt dyke and a farm in the hollow."
- The card paints itself from the theme's tones, and the `~` tiles use `tones.marsh`. The route is
  `/free-play/<id>`, and the existing sandbox flags apply.
- **No mission, no campaign entry, no `data/versus/` file.** Both seats would see the same theme, so the screen
  is fair by construction. The approved "no rain in versus" holds simply because no wet map is a versus map. If one
  is ever wanted, it is the network lane's call and costs a probe run.
- **Map gates:**
  - `map_grid.test.ts` and `high_ground_maps.test.ts` (new `RISES` entries, read on first run).
  - `map_distinctness` against every shipped map, as a report: feature identity under 35%, and elevation within one
    level on under 80% of raised tiles.
  - `map_visibility` measures campaign maps from their objectives. For these two it is run from the sandbox
    anchors' routes (`kdf_start` to each opposition anchor), report-only, and the visible share is shown to the
    lead with the first capture.

## 6. Frame cost, per element and per preset

These are **estimates**, scaled from measured neighbours: the basin's decor (2.2 ms for about 1.09 M placed
triangles at z1, so about 2.0 ms per M at `high` with three passes, and about 1.4 ms per M at `medium` and `low`
with no GTAO pass), the relief-read ALU (+0.15 ms), the fog pass (0.2-0.8 ms) and the shadow pass (1.3-1.9 ms).

They are MEASURED in P4 under GH-829's conditions:
- `tools/src/perf/fx-cost.ts` with the wet layers as an A/B, and the basin as the reference in the same run;
- M3 Pro, ANGLE/Metal confirmed, 1440x900 at DPR 2;
- zoom 1 / 1.6 / 2.5;
- 12 interleaved rounds of 20 synced frames, median and p95;
- the agent's own port, music off, one browser.

**The theme's absolute foliage cost, against the basin:**

| | `high` | `medium` | `low` | Draw calls |
|---|---|---|---|---|
| Decor on a wet map (0.70-0.75 M) | about 1.4-1.5 ms | about 1.0-1.1 ms | about 1.0-1.1 ms | **+0** (the four role batches) |
| The basin's decor (1.09 M) | 2.2 ms (measured) | about 1.5 ms | about 1.5 ms | |
| **Difference** | **about -0.7** | **about -0.4** | **about -0.4** | |

**The wet layers, as a delta on a wet map (the approved budget applies here):**

| Element | `high` | `medium` | `low` | Draw calls | Fallback, in order |
|---|---|---|---|---|---|
| Per-theme ground images (the same five slots) | 0 | 0 | 0 | 0 | — |
| Control C, marsh water, puddles (`THEME_WET`) | +0.10 to +0.25 | +0.10 to +0.25 | +0.10 to +0.25 | 0 | drop the open-ground and low-ground puddle masks (roads and marsh stay) |
| Ripples | +0.05 to +0.10 | +0.05 to +0.10 | off | 0 | off |
| Falling rain and splash | +0.30 to +0.60 | +0.20 to +0.35 | +0.10 to +0.15 | +1 | count ladder x1.0 -> x0.6 -> x0.35, then no falling rain (the wet ground stays) |
| Decals and crater water | about +0.05 | about +0.05 | about +0.05 | 0 | — |
| **Gross** | **+0.50 to +1.00** | **+0.40 to +0.75** | **+0.25 to +0.45** | **+1** | |
| Shadow map one step down (a saving) | -0.10 to -0.50 | -0.05 to -0.30 | 0 | 0 | — |
| **Net** | **0 to +0.90** | **+0.10 to +0.70** | **+0.25 to +0.45** | | |
| **Budget (approved)** | **<= +1.0** | **<= +0.7** | **<= +0.4** | | |

Two honest notes on the table:
- **`low`'s top end is over budget.** The estimate reaches +0.45 ms against +0.40. If the measurement agrees, `low`
  drops the open-ground and low-ground puddle masks from the start, which saves about 0.05-0.10 ms.
- **`medium`'s gross top end reaches +0.75.** Only the shadow step brings it inside +0.70, so the count ladder is
  the next step if it misses.

**The theme's frame target (decision 13).** At every preset and view, a wet map's frame with everything on must
come in at or below the basin's frame plus the wet-layer budget, measured in the same run. Because the wet maps'
decor is about 0.4-0.7 ms cheaper, this should hold with room. A wet map at `high` on DPR 2 will still miss
16.7 ms SYNCED, as the basin does today. That miss is GH-829's own ticket. The live rAF cadence (16.7 ms, with 0%
of frames over 20 ms) is read as well. A fight frame (smoke plus rain overdraw) is read once with
`blast:capture`'s method and reported, not gated.

| Other resource | Amount |
|---|---|
| Programs | +1 (rain), plus one ground permutation, compiled only on a wet map |
| Textures | +2 on a wet map: control C (about 0.6 MB on 48x48) and the 37 KB height texture. The five ground images replace five. |
| GPU memory | about +0.7 MB |
| Load | the new GLBs, measured by `pnpm perf:load` in P3, and under 5 ms for the height bake |
| Tick time | 0 |

## 7. Presentation or rules

**Recommend presentation only** (decision 2). The `~` symbol (5.2) is data built from existing sim mechanics, not a
new rule.

Any rule would come in a later issue, under these conditions:
- deterministic and in data, Q16.16 or integers;
- folded into `hash()` only when live, the `woundLive` precedent;
- the §5.7 targets and the versus bar held.

What revision 1 measured still stands:
- **Sight x0.85** would break the measured recon missions.
- **A mud speed penalty** is blind to `pnpm balance` and slows every tank.
- **Rain halving smoke's life** (`SMOKE_DECAY` 1 -> 2) is the one rule worth trying, on a mission designed for
  it, after the look lands.

With no wet mission, none of these has anywhere to be measured yet.

The look must not imply concealment the sim does not grant. This is why haze is capped at 0.26, reeds stay at
1.5 m or less, and the reed bed is real cover.

## 8. The visual gate

| Scenario | Framing | Status | Layer checks recorded (report) |
|---|---|---|---|
| `wet` | `ein_qasab`, the south causeway with marsh on both sides and a willow bank, zoom 2, an absolute `targetTick`, the sandbox force parked off the causeway | **report-only** (`gated: false`), like `dusk` | `rain`, `wet`, `marsh`, `ripples`, `decor` |
| `wet-downs` | `jebel_matar`, the farm hollow and a marsh pocket, zoom 1.6 | **report-only** | `rain`, `wet`, `decor` |

- **New debug layers** in `three/debug-layers.ts`:
  - `rain`: the batch's visibility flag;
  - `wet`: the puddle and water amplitude uniform to 0 (the wet tones stay, by design);
  - `marsh`: the C.R weight to 0;
  - `ripples`;
  - `cloud-shade`.
  None of them is re-asserted by a per-frame write.
- **Repeatability first.** Rain runs on the sim clock, so a frame frozen at tick 0 elapsed is deterministic. Three
  fresh-process captures of one commit must read 0 px / 0.0000 before any floor is written. A bimodal reading is a
  bug. `lateFreezeRefusal` and `guardCapture` apply unchanged.
- **No existing baseline moves.** No shipped map changes theme, and the other themes compile today's programs.
  Adding the two scenarios turns the existing manifest red until the post-merge bless from CI numbers, as for any
  new scenario. Look at the picture.
- **Promotion to gated** is a later lead call. The floors are one third of the smallest of three runs, per layer.
- The bloom census (`pnpm perf:bloom-census`) adds both framings. A quiet wet frame stays under 0.9.

## 9. Checks, and the input that makes each one fail

### 9.1 The other themes are byte-identical

- `terrain-defaults.test.ts` is extended to every shipped map, highland included.
  - The fixture is regenerated at the commit BEFORE the wiring and committed alone.
  - The wiring commit then must not touch the fixture.
- A shader test compares the compiled ground program and the light values for an arid, a green and a highland map,
  bit for bit, with `weather` absent and with `'clear'`.
- Falsification: compile `THEME_WET` unconditionally once, and watch both tests and the `quiet` golden go red.

### 9.2 Every new check

| Check | Falsifying input (run, then put back) |
|---|---|
| The wet tones against literal ΔE oracles | `open` -> `scrub.0` (ΔE2000 9.8 < 15.6) |
| Foliage figure-ground on `wetland` | `oak:foliage` -> `fen.1` (9.3 < 12) |
| `theme_only` isolation | drop `theme_only` from `fen` |
| `~` is vehicle-walled, foot-open and cover 1 | `boulder: 0` in the legend entry |
| `validate:data` refuses `~` off a wetland map | one `~` on `tile_green` |
| `decorFamiliesFor` covers what is placed | drop `reed` from the mirror |
| Reeds never stand above 1.5 m DRAWN (model x 1.2) | scale one reed variant x1.3 |
| No reed clump centre on a `marshWater` fragment; marsh water 25-35% by area | drop the reject in the placer |
| The lentisk draws at most 1.4 m in the open pass | the spec's former 1.3 m model (1.82 m drawn) |
| `basalt` is a tint key only, absent from `paletteRamps` | list it in `wetland`'s `paletteRamps` |
| The open tile's figure-ground histogram: at most 5% of texels within ΔE2000 12 of `olive.1` | author the tile at a 60% mud share with soft edges |
| Placed decor is at most 0.9 M a wet map | double the reed clumps a tile |
| Rain runs on the sim clock | drive the batch from `performance.now()`: the frozen repaint must differ |
| The `rain` layer contributes | hide the batch alone: the reading must be non-zero |
| Constant-pixel streak width | drop the per-zoom rescale |
| The streak never blooms | give it an `hdr-gains` entry: the census goes over 0.9 |
| Causeway doctrine (5.3) | delete the north causeway: the vehicle route must move; delete both: it must fail |

## 10. Build phases

| Phase | What | Output | Gate before the next |
|---|---|---|---|
| P0 | this spec | the decisions in section 11 | the lead's answers |
| P1 | mood board, reference study only: no render, no Meshy, no browser. **Done 28 Oct**: the five adjustments approved and folded in (revision 3) | `_coord/wet-theme/mood-board.png`, `notes.md`; `art-numbers.md` (summary in 2.8) | **the lead approves the art-numbers sheet (2.8)** |
| P2 | wiring with STAND-INS (no new art): the 9.1 pins first, then schema, legend `~`, ramps, the bundle, the per-theme tables, the remap and waterside passes, and an Ein Qasab greybox. The shipped GLBs and textures stand in, retinted. | first captures, own port, one Metal browser, music off, zoom 1 and 2.5 | the lead's look at tones and palette |
| P3 | art: the Meshy batch inside the approved credits (Opus, high effort, each call announced), Blender fits and variants, procedural reeds, grass and props, the five ground tiles | `validate:meshes` green; fit reports with the cost of each cap; `perf:load` | the lead's look, zoomed in |
| P4 | wet ground and air: control C, marsh water, puddles, ripples, roughness, `rainLight`, haze, decals, mud spray; then the rain batch, the ladder, reduced motion; **the cost run** (section 6) | the cost tables measured; the ladder stepped if over | inside budget, or the lead's call |
| P5 | maps: Ein Qasab final and Jebel Matar; the doctrine and relief pins; the distinctness and visibility reports; the Free Play strings; the two report-only scenarios | captures of both maps; gate reports | the lead's look |
| P6 | optional: cloud shade, only if P4 left room | captures and cost | the lead's look |

Not covered: a wet campaign mission, snow or a dust storm, rain that starts and stops mid-mission, rain audio, a
basalt village, real-player readability, and any GPU but the M3 Pro.

## 11. Decisions for the lead (recommendation first)

1. **The theme's character and id.** Recommend `wetland`: a Levantine winter valley of alluvial mud and sward, wet
   basalt, reed marsh, Tabor oak and willow, set at the early-spring flush (rev. 3). It is distinct from all three shipped themes and sits in the
   game's world. Alternatives: the id `wet`, or a temperate European wet forest (a look the setting does not have).
2. **Presentation only.** Recommend it. Rain is part of the theme: it falls on every wetland map and on no other,
   with no `&weather=` flag. A/B comparisons go through the debug layers.
3. **The marsh symbol `~`.** Recommend cover 1 plus the vehicle wall, legal on wetland maps only. That is two
   mechanics the sim already has, with no sim code. The alternatives:
   - `~` exactly as `b`, with no cover: a reed bed you cannot hide in;
   - decor only, open to vehicles: a marsh tanks drive through, which is a lie the player acts on.
4. **Palette.** Recommend adding `fen` (`#75A659`, `#4B7135`, `theme_only`) to the approved `mud` and `overcast`.
   The rocks take `overcast.3` / `overcast.4`, with no basalt ramp unless the board argues for one.
   **Ruled 28 Oct (revision 3):**
   - `mud` becomes the yellower ramp;
   - `overcast.1` becomes `#9FA9B5`;
   - one tint-only step, `basalt.0` `#4B453D`, goes on the boulders;
   - `fen` is kept, with `#7BA350` held for a cold P2 capture.
5. **Readability.** Recommend the bundle in 4.2. Pin KDF `olive.1` on open ground at ΔE2000 15.6 or more (this
   bundle reads 18.4), and hold every foliage tint to the VR-05 floor.
6. **Ground set.** Recommend five procedural tiles (2.1) at 0 credits, with a per-theme slot table so that each
   theme can own its rock, scrub, grove and knoll images. The other three themes keep theirs.
7. **The foliage species list.** Recommend Tabor oak (2 Meshy bases), white willow (1), lentisk (1), and Phragmites
   with bulrush reeds and winter sward, both made in Blender. Alternatives for the waterside tree: oriental plane,
   or eucalyptus (taller, and so a worse fit for units).
8. **Rocks.** Recommend the shipped rock, slab and boulder families, retinted, at 0 credits. A Meshy basalt boulder
   (25 credits) only if the P3 capture still reads as limestone.
9. **Props.** Recommend three new kinds (a round bale and a culvert pipe in Blender, a tractor wreck from Meshy)
   and a wet-theme mix that keeps the shipped seven at lower weights.
10. **Meshy budget.** Recommend 125 credits planned (about $2.50), capped at 200 (about $4.00). The prompts are
    written by an Opus agent at high effort after the board, and each call is announced with its credits first.
    Nothing is spent before P3.
11. **Triangle caps.** Recommend oak and willow 2,500, shrub 600, reed 400 and grass 200 a variant, and at most
    0.9 M placed decor triangles a wet map (the basin is about 1.09 M). The masters are kept at full detail, and
    each fit reports what its cap cost.
12. **Maps.** Recommend two Free Play maps at 48x48: Ein Qasab (the marsh valley with two causeways) and Jebel
    Matar (the wet downs, crests and dyke). They have no mission and no versus file. Their names are checked for a
    real-place collision first. The alternative is one map, which would show only one of the theme's two ideas.
13. **Frame budget.** Recommend the approved +1.0 / +0.7 / +0.4 ms for the wet layers, as an A/B on the wet maps.
    In addition, a wet map's whole frame must come in at or below the basin's frame plus that budget, in the same
    run. `low` starts with the open-ground and low-ground puddle masks off if its measurement is over. GH-829 stays
    its own ticket.
14. **The visual gate.** Recommend two report-only scenarios, `wet` and `wet-downs`, and the terrain pins extended
    to all 35 shipped maps before any wiring.
15. **Go for P1.** Recommend approving the mood board as reference study only: no render, no Meshy, no browser.
    **Done 28 Oct.**
16. **The art-numbers sheet (2.8, `_coord/wet-theme/art-numbers.md`).** Recommend approving it as written. That
    includes its four departures:
    - the lentisk at 1.0 m;
    - the reed's 1.5 m as a drawn limit, with the kneeling-figure check;
    - the black bale;
    - the trunk tints.
    Then P2 (wiring with stand-ins) and the P3 Meshy batch go ahead, inside 125 credits planned and 200 at most.

---

## 12. P2 as built (wiring with stand-ins; GH-871, 29 Oct 2026)

P2 landed on `feat/wetland-p2` (plan: `docs/superpowers/plans/2026-10-29-wetland-p2.md`). It wires the theme, the `~`
symbol and a greybox map with stand-in art, and nothing else: no packages/sim edit, no shipped map changed theme, no
shipped map has a `~`. `pnpm test:determinism` read 107 tests on every commit, and the visual baselines, `pnpm balance`,
`pnpm playtest`, `LADDER_CREDITS` and the 35 terrain pins did not move. The sections above stay as the design; this
section records where the build differs from them and what it measured. Renderer notes live in
`docs/agent-notes/terrain-rendering.md` ("The wetland theme (GH-871 P2)") and the map facts in
`docs/agent-notes/maps-and-terrain-design.md`.

### 12.1 The rulings R-1 to R-13, and how each came out

| Ruling | Outcome |
|---|---|
| R-1 stand-ins | Built as ruled: `oak` is the cedar GLBs, `willow` the desert tree, `shrub` and `reed` the bush (two keys on one URL set, about 130 kB, P2 only), `wet_grass` the grass tuft. Each takes its own tint by key. Silhouettes are wrong by design. **P3 changes rows, never names.** |
| R-2 ground images | `TERRAIN_GROUND_TEXTURE.wetland = 'green_basin_tile'`; `TERRAIN_SLOT_TEXTURES` is a new total per-theme table and every theme names today's shared four. P3 replaces all five names and adds their `GROUND_ALBEDOS`. |
| R-3 `weather` | A seam: `TERRAIN_WEATHER` is total, `rain` for `wetland`, and `rendererOptionsFor` spreads it only when `rain`. Nothing reads it. P4's `rainLight` is the first reader; `theme-identity`'s `'clear'` arm is the tripwire. |
| R-4 `propMix`, prop kinds | Not built (no honest stand-in for a bale). A wet map uses the global mixes. P3. |
| R-5 remap is a rename | Built at the three push sites; every roll uses the original family. A rename-only test (placements equal the un-remapped input, family name aside) is falsified by remapping before `openObjectScale` (`expected 0.9374944579787553 to be less than or equal to 0.9`). `NO_TWIN` is `{cedar, oak}`. |
| R-6 `marshWaterAt` | Built in `terrain/shared.ts` as `marshWaterAt(decor, width, height, x, z)`; `noise.ts` stayed three-free. World-anchored fBm (meander period 1.2, half-width 0.12; pool period 1, threshold 0.4; 3 octaves; seeds 6101/6203), 0.25-tile inset with a 0.1 ramp. Water share target 0.25-0.35 (S-4): 36 placements of a 6x6 marsh read mean 0.298, min 0.199, max 0.387, 29 of 36 in band; the greybox reads 0.3119. |
| R-7 reed clumps | Built as ruled (1 clump, +1 at stream 10211/10331 under 0.5, up to 4 jittered centres, first dry one wins). On the 6x6 test marsh 50 of 54 clumps placed (7.4% dropped). On `ein_qasab`: 447 reeds, none on water. |
| R-8 waterside pass | Built as pass 3 (`DECOR_PASSES` 4), `waterside.p` 0.12, `reach` 1, a shared `openTreeBand`/`openScatterRollsTree` so pass 2 and pass 3 never put two trunks on a tile. Fresh streams 12301/12413, 12541/12653, 12739/12823, 12911/13007, 13121/13229. 13 willows on `ein_qasab` (a `>= 5` assertion was added after review: red at `waterside.p -> 0`, `expected 0 to be greater than or equal to 5`). |
| R-9 puddle A/B | Moved to P4, as ruled; the lead confirmed at S-6. |
| R-10 `~` restriction | Built as a data-gate rule: `THEME_SYMBOLS` (`map.ts`), a twin literal in `validate_data.mjs`, held equal by `terrain_symbols.test.ts`. `parseMap` stays theme-agnostic. `THEME_SYMBOLS` is also exported from `@lions/data` (tools tests import it there). |
| R-11 surface and tone | Built: `tileSurface` gives `~` the scrub albedo at 0.4; `groundTone` gives it `tones.marsh` when set. The marsh tone moved from `mud.3` to `mud.2` at S-6. |
| R-12 greybox | Built as `ein_qasab`, with disclosed departures: boulder skirt 40 (spec about 50), hedges 156 (about 170), marsh width 5-8 (6-9), 311 `~` (about 300). Built share 1.7%. Two causeways x 13-37, continuous `r`. The west track runs past `kdf_start`. See `maps-and-terrain-design.md`. |
| R-13 light | `day`, as ruled. The captures state it. Haze (`overcast.1` key, `hazeFar` 0.12) is not visible at zoom 1 or 0.35, so haze could not be judged; that goes to P4. |

Two further facts from the build:
- The plan's S-0 name check found no in-repo clash; a real-world collision for `ein_qasab` "cannot be ruled out" ("Ein" is
  a common Levantine spring prefix, "Qasab" is reed). The lead approved the name at S-6. A rename would touch about eight
  files (the map JSON, `index.ts`, `en.json`, `map-ids`, the tests).
- The plan's splice test ("a house beside the marsh") cannot detect a pass-3-skipping splice, because a collapsed building
  leaves rubble of cover 1-2 and never plain open ground. It was committed as an honest splice-equals-full-build test,
  and a direct `spliceDecorPlacements` case is the real witness (red at `138 vs 139`).

### 12.2 The pins that moved

| Pin | Was | Now |
|---|---|---|
| `total_colors` (`data/palette.json`, `validate:data`) | 76 | 89 (fen 2, mud 5, overcast 5, basalt 1; all `theme_only`) |
| ramp colours in the palette notes line | 46 | 59 |
| `SHARED_PALETTE_HEXES.length` (`tones.test.ts`) | counted minus `karst` | minus every `theme_only` ramp; no wetland hex in the set |
| terrain-digest pin (`terrain-defaults.test.ts`) | the 24 non-highland maps | first all 35 (the 11 highland keys added, 0 changed), then the 35 non-wetland maps after `ein_qasab` (fixture untouched since) |
| exactly-N terrain symbols (`map.test.ts`) | ten | eleven (own describe, "the marsh symbol") |
| `qarn_hadid_relief.test.ts` | authors every symbol | every symbol legal on its theme; legend 11, one theme-restricted |
| `TERRAIN_SYMBOLS` (`validate_data.mjs`, `terrain_symbols.test.ts`) | without `~` | with `~`, plus the `THEME_SYMBOLS` twin |
| relief map count (`high_ground_maps.test.ts`) | 24 | 25 (`RISES.ein_qasab = 1`); flat stays 11 |
| `SHIPPED_MAP_IDS` (`worker/src/match/map-ids.ts`) | 35 | 36, + `ein_qasab` |
| sandbox anchors (`sandbox-anchors.pinned.json`) | 35 keys | 36; `ein_qasab` friendly (4, 44), hostile (22, 12) |
| `ambience.test.ts` | no `ein_qasab` | `ein_qasab: 'open'` |
| Free Play picker (`sandbox-menu.test.ts`) | every shipped map has a card | 35 of 36; `UNLISTED_MAP_IDS` pinned to exactly `['ein_qasab']`, each entry a shipped map |
| `theme-identity.fixture.json` | (created in Task 1 with three entries) | + one `wetland` entry (4 added lines); the three shipped entries byte-unchanged |
| `shippedContentDigest()` | n/a | changes value (any map added does; nothing pins a literal). Old and new builds cannot share a room. |

S-6 literals (each its own commit, with `Was`):
- `fen`: `#75A659`, `#4B7135` -> `#7F9F57`, `#4F6732` (`tones.test.ts` `FEN`).
- Wetland `marsh` tone: `mud.3` `#413327` -> `mud.2` `#584535` (`renderer-options.test.ts`, `tones.test.ts`).
- `basalt.0`: `#4B453D` -> `#625A4D` (`tones.test.ts` `BASALT`, `wetland-readability.test.ts` boulder pin).
- `wetland-readability.test.ts` open ground vs the KDF uniform: 18.37 -> 15.82 (floor 15.6 kept); `foliage-figure-ground.test.ts`:
  willow 18.37 -> 15.82, `fen.1` as foliage 9.34 -> 8.44, and a NEW pin of `low` at 8.44 ("known debt: below the 12 foliage
  floor; delete when retinted"). Reed 15.65, `wet_grass` 21.30 and oak/shrub 12.60 did not move.

Unmoved, by name: determinism golden, relief, order-done, economy and wounded hashes and the snapshot format pin; `pnpm balance`;
`pnpm playtest`; `LADDER_CREDITS`; the visual baselines (proven on CI, not locally); the 35 terrain digests.

### 12.3 The census (stand-ins; not gated)

`ein_qasab`, the real placer with the wetland tones: **1,416 placements, about 0.533 M triangles**. Reed 447, `wet_grass` 473,
oak 68, shrub 176, willow 13, rock 135, boulder 64, slab 40. Triangle counts are read from the raw GLBs in `art/meshes/decor`.
The 0.9 M ceiling (section 3) is P3's measurement with the real meshes.

### 12.4 The two capture runs

Both ran `pnpm ground:capture` once, one Chromium, port 5196, music off, nothing killed, with
`--maps=ein_qasab,wadi_halam_basin,tel_marum` and `--markers=ein_qasab:causeway_s,ein_qasab:kdf_start,ein_qasab:hamlet`
(the `--markers` flag is Task 8's tool commit). Conditions: ANGLE Metal on Apple M3 Pro, viewport 1400x900 at device scale 1,
quality preset `high`, light `day` (no `&tod`), frame loop frozen at boot. The tick is not recorded: the tool discards the number
its freeze script returns. 23 frames each.
- **P2 (first look):** `/Users/ilpinto/dev/roaring-lions-ep/_coord/wet-theme/p2` (`sheet.png`, `sheet-2.png`, `sheet-3.png`,
  `look.md`, `captures/`).
- **P2b (after S-6):** `/Users/ilpinto/dev/roaring-lions-ep/_coord/wet-theme/p2b` (`sheet.png` with before and after side by side,
  `sheet-1b.png` 2x crops, `sheet-2.png`, `sheet-3.png`, `look2.md`, `captures/`). The shipped-map frames (`wadi_halam_basin`,
  `tel_marum`, 11 frames) are pixel-identical to the first run, which is the inertness witness for the shoreline. `ein_qasab`
  call and triangle counts are identical (its elevation grid made its fringe tiles 4x4 patches already); its frames moved, mean
  absolute delta 1.4 to 10.3. The marsh floor's lit luma rose 45 -> 58 and is still the darkest mass.

### 12.5 The lead's rulings at the two looks

- **First look (S-6):** fen olive-ward (less saturated, slightly darker); lift the marsh floor one step; lift `basalt.0` one
  step; soften the stair-stepped tile edge into a ragged shoreline across tile edges (presentation only, the sim grid
  unchanged, a new check with a constructed failing input); re-run the readability floors and report the `low` dE. Approved:
  the overcast faces, the name `ein_qasab`, the reed tone, and moving the puddle A/B to P4. P5 items recorded.
- **Second look:** keep `fen.0` `#7F9F57` (its final green is judged under rain light in P4), keep marsh `mud.2`, basalt and
  the shoreline. **Hold Ein Qasab out of the Free Play list until P3's art lands**, and merge the theme work. The mechanism is
  `UNLISTED_MAP_IDS` (smallest honest option); `/free-play/ein_qasab` and `?sandbox=ein_qasab` still boot it (dev paths), a
  hand-built non-versus room can name it, and it is not a versus map.
- The hue-54 target was not taken: it is unreachable under the 15.6 floor (the geometry is in the renderer notes). To go
  further the lever is the KDF uniform's tone or the floor, which is the lead's call.

### 12.6 Open items

**P4 (wet ground, rain, cost):**
- The final fen green is judged under rain light, with the marsh floor (still the darkest mass at lit luma 58) and the `low`
  debt (8.44 against a floor of 12; retint, then delete the pin's "known debt" note).
- The puddle-reflectance A/B (0.20-0.25 against 0.35) and KDF-on-water, as P4's first capture.
- Haze is judged (it was invisible at zoom 1 and 0.35 in both captures).
- Control C reads `marshWaterAt` for the water mask; its bake could replace the shoreline's vertex mixes (`marshWeightAt` is
  written as the bake's source function).
- The dry `THEME_WET` program assertion in `theme-identity.test.ts` ("wetland compiles the arid program") flips deliberately
  when the wet term enters the ground shader, and the wetland digest entry is re-blessed with it.
- `rainLight` is `RendererOptions.weather`'s first reader.
- Known looseness in the shoreline: a marsh|fen|road T-junction corner has a one-vertex colour step, and decals on a fringe tile
  read the tile's base tone.

**P5 (maps):**
- A named hostile seat for `ein_qasab`: the sandbox hostile anchor resolves to `causeway_n` (22, 12), not the hamlet and crest,
  because of the contact-range heuristic.
- The causeway doctrine pin must key on marsh wading (foot baseline wades 6 tiles, vehicle 0), not on foot avoiding an `r` tile:
  the causeways run continuous across x 13-37, so every foot route crosses one.
- Ein Qasab final, the distinctness and visibility reports, Jebel Matar, the `wet` and `wet-downs` scenarios, and the Free Play
  line (delete the `UNLISTED_MAP_IDS` entry when P3's art lands).

---

## 13. P3 as built (the procedural art; GH-871, 30 Oct 2026)

P3's Blender-only half landed on `art/wetland-p3` after four approval rounds (R1, R1b, R1c, R1d; the sets are under
`_coord/wet-theme/p3-r1*`). The Meshy half (oak, willow, lentisk, tractor) waits on the key limit: those four families
still draw their P2 stand-ins, and **Ein Qasab stays out of the Free Play list** until they land.

**What shipped**

| Piece | Where | Numbers |
|---|---|---|
| `reed_0/1/2` | `art/meshes/decor/`, `art/src/terrain/wetland/` | 388 / 390 / 382 triangles (cap 400), 1.25 / 1.10 / 1.00 m, foliage + trunk (new shoots); 2.5 m clump |
| `wet_grass_0/1/2` | same | 198 triangles (cap 200), 0.40 / 0.38 / 0.40 m, foliage + straw in `trunk` |
| `round_bale`, `culvert_pipe` | `art/meshes/props/` | 140 / 138 triangles (caps 160 / 140), one role each (`rubber`, `concrete`) |
| five tiles | `art/textures/`, `assets/textures/` | `wetland_open_tile` (18 m, `tiles: 6`, `gain: 1`), `basalt_rock_tile`, `wet_scrub_tile`, `oak_litter_tile`, `basalt_scree_tile` |

**Where the build differs from sections 2-3**
- A blade is a closed or double-sided shape (3-triangle cone, 2-triangle ribbon) because the decor material is `FrontSide`; the
  sheet's 2-triangle culms would vanish from behind. That is why a clump holds fewer elements than the sheet's counts.
- **Three reed clumps a tile** (`REED_CLUMPS`, was 1 plus a 50% second). At 1.5 clumps the reed share at zoom 1 was 29% of the marsh;
  at 3 it is **49% of the marsh, 72% of the dry part** (the sheet's 65-75%), the real water field reading 31.8%. A kneeling KDF
  figure keeps its head and shoulders: median 99%, minimum 70% over 36 dry points (the falsifier, reeds x1.5, drops the minimum to 20%).
- Ein Qasab's placed decor at the Meshy caps (oak 2,500, willow 2,500, shrub 600) is **809,940 triangles, 90% of the 0.9 M ceiling**
  (`tools/terrain/wetland_census.py`; 635,872 at 1.5 clumps).
- **The open tile has no mud.** R1 had 40% mud patches on a 9 m tile; the lead asked for calmer three times and then for no brown at all.
  The shipped tile is sward only: lighter yellow-green and darker blue-green regions at 0.3-1.2 m, blade grain and a hint of yellow-green
  straw. Contrast 0.057 (floor 0.05), figure-ground 0.3% (limit 5%). The 5% rule is what stops the dark regions going darker.
- `TerrainTones.propMix` (new, optional): a theme's own yard and roadside prop weights. Only the wetland names it (bale 6 of 18 in the
  yard, culvert 6 of 17 at the road); the tractor's share is left out until its model lands.
- Scrub on cover 1 and 2 still fails the figure-ground rule (54.9% on `fen.1`, 33.2% on `scrub.1`): the tones themselves sit 8.4 and
  12.6 from `olive.1`. That is a P4 retint, not an image fix.

Load, measured statically (no browser): a wetland map's five ground JPEGs are 2.02 MiB, was 3.12 MiB with the shared set; the eight new
GLBs are 36.7 KB Draco.

---

## 14. P4 as built (wet ground and air; GH-871, 30-31 Oct 2026)

This is section 13 of the plan that built it ("append `## 13. P4 as built`"); it is numbered 14 here because P3's "as built" took 13
while P4 was in flight. Plan: `docs/superpowers/plans/2026-10-30-wetland-p4.md`. Branch `feat/wetland-p4`. The ledger of record is
`_coord/wetland-p4-progress.md`; every number below is from it, from the commit messages or from `docs/PERFORMANCE.md`
("Wetland P4: the wet layers"). The code notes are `docs/agent-notes/terrain-rendering.md` ("The wetland theme (GH-871 P4)") and
`docs/agent-notes/renderer.md` ("The rain and the wet light (GH-871 P4)").

**What shipped.** Under `RendererOptions.weather === 'rain'` and nowhere else: `rainLight` (the overcast sun, fill, haze and a stepped
shadow map); control C (the marsh water and road-rut puddle masks) and the `THEME_WET` ground program (water surface, rim, ripples, wet
roughness); the wet sway, mud prints and crater water; the wet unit surface table and the KDF rain rim (PR 914 ruling 1; the S-L2 flat lift it replaced is superseded); `vehicle_mud`; and the falling rain
(one instanced draw). No sim edit, no GLB, no PNG. Nothing a shipped map draws changed: the 35 terrain digests, the three shipped
`theme-identity` entries, the determinism hashes (151 tests at the final tip: the merge added witness files) and the visual baselines did not move.

### 14.1 The rulings, and how each came out

| Ruling | Outcome |
|---|---|
| **R-1** one switch, `opts.weather === 'rain'` | **Stood.** Every wet term keys on it; the theme id never reaches the renderer. |
| **R-2** `rainLight(lights, preset)` | **Stood**, numbers as planned (sun x0.46 in `overcast.0`, fill x1.5 on every preset, sky and haze `overcast.1`, shadow 0.45, `hazeFar` 0.26, `hazeLow` 0.10, shadow map one step down floored at 1024). Open-ground irradiance 0.964 -> 0.741. A mission's `lightOverride` wins (correct by inspection; no test builds it). Wetland `light` digest moved. |
| **R-3** four compile-time variants | **Stood**, plus the rain program: the ground (`THEME_WET`), the fog pass (`hazeLow` in its source), the foliage sway (`rl-foliage-sway-wet`) and the decal (`DECAL_WET`). No shipped program source changed (ruling Q7). |
| **R-4** control C | **Stood for R and the bake; SUPERSEDED for G.** G was the max of three terms (roads 25-35%, open ground 4-8%, low ground +6%). The lead's S-L1 ruling 1 removed the open-ground term and the low-ground boost: **G is the road ruts alone**, `G == 0` off a road. Road rut fill was re-tuned once at S-3 (`PUDDLE_RUT_FILL` 0.75 -> 0.56, road share 0.4005 -> 0.2948 against a 0.25-0.35 band); marsh share 0.3119. The splice got a second margin, `WET_SPLICE_MARGIN_TEXELS` 16. The P2 per-vertex shoreline stays (ruling Q4). |
| **R-5** two reflectances | **Stood; values chosen at S-L1**: `PUDDLE_REFLECT` 0.35 (road puddles and, by sharing the uniform, the crater water), `MARSH_REFLECT` 0.25; both on the DRAWN scale (the sky term is lit twice by design: effective sky share about reflect x 0.74, 26% weaker than the T3 readability proxy models). The 0.06-tile `mud.3` rim stood. |
| **R-6** ripples | **Stood** as written (0.5-tile cells, 2 rings, 0.12 tile, 0.9 s, 8 degree cap, +-15%, fresh hash streams). Off on `low`, under reduced motion and with the layer hidden. |
| **R-7** rain batch geometry | **Stood for the fall, streak, splash, colour, draw and order; SUPERSEDED for the lattice.** (a) The period is no longer snapped to {8, 16, 32, 64}: it is the unclipped footprint box side clamped to [8, 64], continuous, never a function of the pan, with `RAIN_PERIOD_PAD` 1 (R-7's "padded 10%" is already inside the box's reach and slant margins). "A `P` step reshuffles" is gone; a zoom slides the pattern. (b) A static per-instance keep seed and `uKeep` hold the on-screen count steady across zoom at `RAIN_DENSITY_FRACTION` 0.22 of the preset total (S-L2 ruling 2; R-7's "the count is the same at every zoom" was false of its own lattice: 3,365 / 1,726 / 709 / 1,114 at zoom 0.35 / 1 / 1.6 / 2.5). (c) A landing-point map-edge cull with a half-tile fade (not in R-7). `RAIN_RENDER_ORDER` is the alias of `FX_RENDER_ORDER_ABOVE` as planned. |
| **R-8** preset fields and ladder | **Stood, minus `openPuddles`** (void after S-L1 ruling 1; Q8 moot). Shipped: `high` 6000, `medium` 3500, `low` 525 drops (two ladder steps, 1500 -> 900 -> 525); `RenderQuality.rain` is `{ drops, ripples }`. `RAIN_LADDER` [1, 0.6, 0.35, 0] as planned. |
| **R-9** reduced motion | **Stood**: asked once a frame, ANDed with the debug flags, the wet ground, light and haze stay. |
| **R-10** debug layers | **Stood**: `wet`, `marsh`, `ripples`, `rain`. |
| **R-11** no golden scenario | **Stood**: none lands; CI's `visual` job is the witness. P5 owns `wet` and `wet-downs`. |
| **R-12** no A/B reaches a player | **Stood**: `debugSetWetTuning` on the concrete class only, grep-tested out of `api.ts`. |
| **R-13** `vehicle_mud.json` | **Stood as written**; every field existed in the schema (sprite `soft_dot`, `budget_priority` 2 were left open by the plan). Not verified by a frame (14.5). |

Other plan rulings: **Q2** rain fill x1.5 on every preset (stood); **Q3** two reflectances (picked, above); **Q5** the streaks were judged at
S-L2 (approved); **Q6** three CLAUDE.md lines (written); **Q9** the whole-frame figure is reported, not gated (14.4). Gates: S-3 tripped
once (road share) and cleared on the second round; S-5 did not trip; **S-C is a real miss on `medium` and probably `low`** (14.4).

### 14.2 The lead's rulings

**S-L1 (30 Oct, the first look).** (1) Road puddles reflectance 0.35, marsh water 0.25, **no puddles on open grass**: the open-ground term
and the low-ground boost are dropped entirely (each pin its own commit with `Was`). (2) KDF infantry near-black on wet road and water:
decided after the rain; S-L2 shows infantry on road, in water and on grass with readability figures. (3) Approved: `fen.0` hex 7F9F57,
`mud.2`, haze 0.26, the `low` known-debt pin; the Tel Marum frame differences are accepted with CI's `quiet` golden as the witness.
(4) The double-lit sky term is the coordinator's call, and he kept it (dropping it would brighten the approved look).

**S-L2 (31 Oct, the rain).** (1) **The rain is approved**: streak (6000 / 3500 / 900 drops then, 0.42 wu, 1.5 px, alpha 0.28), splash,
reduced motion and the map edge as they were. (2) Hold the density steady across zoom: about the zoom-1 density (about 1,400 on screen
at high), within +-20% from zoom 0.35 to 2.5, with a test that fails on the old behaviour. (3) A small lift for KDF infantry under rain on
wet maps only, presentation only, so they clear the 15.6 floor on the wet road and in marsh water, grass kept readable, shipped themes
byte-identical. (4) One recapture (allowed once), then T13, the cost re-run on a quieter machine, the review and the PR.

**PR 914 (31 Oct, the lead, ruling 1).** The flat KDF lift of ruling 3 is **superseded**: "Replace the flat KDF lift with a thin rim light under
rain only. It is a soft, light edge on the figure's outline (a view-angle Fresnel rim on the unit surface, wet maps only). Camouflage, faces and
team colour stay as in look 2. Remove `RAIN_KDF_FIGURE_LIFT` as a flat albedo lift. Re-measure with the figure-mask method: the mean and the
darkest 15%, on road, water and grass." As built: a Fresnel rim (`units/rain-rim.ts`, colour `overcast.1`, power 3, one shared gain uniform,
`RAIN_KDF_RIM_GAIN` in `weather.ts`, shipped at 0.6 from look4), the flat lift and its calibration test removed, and the `ground:capture
--rim=<g>,...` option so ONE browser run photographs several gains (look4, beside look 2 and look 3). The model is
`tools/src/wet-unit-rim.test.ts`: at the shipped 0.6 the outermost pixel of a figure reads 2.84 x the wet road's luminance, 6.26 x marsh water, 0.67 x grass (the first pick, 0.4, was 1.63 / 3.67 / 0.39; look4 showed it nearly invisible).

### 14.3 Pins moved (old -> new)

Only the WETLAND `theme-identity` entry moved; the three shipped entries (`program`, `scene`, `light`) and the 35 terrain digests are
untouched on every commit after Task 1. Task 1 only ADDED the `scene` line (all four entries read `e1e5a131...`: one shared scene).

| Pin | Was -> Now | Commit / task |
|---|---|---|
| wetland `scene` | e1e5a131 (added) -> 2c3719c6 | `rainLight`, shadow step, haze (T2) |
| wetland `light` | a3f30328 -> a62c229f | T2 |
| wetland `program` | 770e1d73 -> 0ce466f4 | the `THEME_WET` ground (T4) |
| wetland `scene` | 2c3719c6 -> a14c830a | T4 |
| wetland `scene` | a14c830a -> a338d507 | wet units, sway, decals, mud (T5) |
| wetland `scene` | a338d507 -> 9290f13d | the rain batch (T8) |
| wetland `scene` | 9290f13d -> 545bb7af | the rain stops at the map edge |
| wetland `scene` | 545bb7af -> a2f892fc -> 312aff90 | continuous period + keep fraction; density 0.2 -> 0.22 and the shader fixes |
| wetland `scene` | 312aff90 -> 074bc8c9 | the KDF rain lift (final; SUPERSEDED, see the next row) |
| wetland `scene` | 074bc8c9 -> e650fd4c -> be5f0d52 | the KDF rain rim replaces the flat lift (PR 914 ruling 1; fix round 1: the view vector is `isOrthographic ? (0, 0, 1) : normalize(vViewPosition)`; the harness appends the rim's compiled fragment + cache key); the three shipped entries and the 35 terrain digests did not move |
| `PUDDLE_REFLECT` | 0.25 -> 0.35 (`MARSH_REFLECT` stays 0.25) | T7 (S-L1) |
| open-ground puddle share | 0.0598 -> 0; low-ground boost removed | T7 (S-L1); the S-3 bands for them are void |
| `PUDDLE_RUT_FILL` / road share | 0.75 -> 0.56 / 0.4005 -> 0.2948 | T3 round 2 |
| `QUALITY_PRESETS` | + `rain: { drops, ripples }` (high {6000, true}, medium {3500, true}, low {1500, false}); low drops 1500 -> 900 -> 525 | T8; `Was drops 1500` (4ed3421b1); `Was drops 900` (a00d616b4) |
| `DEBUG_LAYERS` | + `wet`, `marsh`, `ripples` (T4), `rain` (T8) | |
| render-order table | + the `RAIN_RENDER_ORDER` row (alias of band 3) | T8 |
| `vfxEmitters` directory pin | + `vehicle_mud` | T5 |
| `theme-identity` assertions | "wetland draws arid's program" flipped to the strip property; `shadowMapSize` scoped to the shipped keys (wetland 2048); `hazeLow` read from the fog pass | T1, T2, T4 |
| reed agreement bound | 30 water-texel reeds of 447 (27 measured, 6.0%) -> 72 of 897 (56 measured, 6.2%; bound 8%), dry 3x3 neighbour relaxed to <= 2 reeds | P3 merge (three clumps a tile) |

Unmoved: the sim hashes (151 determinism tests at the final tip), `pnpm balance`, `playtest`, `LADDER_CREDITS`, `shippedContentDigest()`, the Free Play picker, the
visual baselines (CI is the witness; no shipped map rains).

### 14.4 The cost, and the S-C miss

Instrument: `pnpm perf:fx -- --breakdown --maps=ein_qasab,wadi_halam_basin` (`NET (total wet)` = (baseline - the frame with the wet ground
program stripped) - the shadow saving; budgets high <= 1.0, medium <= 0.7, low <= 0.4 ms). Apple M3 Pro, ANGLE Metal, 1440x900 at DPR 2,
12 rounds x 20 frames, median, port 5211, music off. Full tables: `docs/PERFORMANCE.md`.

| Run | Load (1 min) | high z1 / z1.6 / z2.5 | medium | low |
|---|---|---|---|---|
| First (P3 art), loaded | 18-77, never under 4 | 0.60 / 0.50 / 0.20 (within) | 0.00 / 0.60 / 0.20 (within) | 1500 drops: 0.40 / -0.20 / 0.70 OVER; re-run 0.10 / 0.30 / 0.90 OVER; 900 drops: 0.40 / 0.20 / 0.20 |
| **Final tip, quiet** | **about 3-5** (`uptime` 4.57 -> 3.15) | **0.20 / 0.50 / 0.20 (within 1.0)** | **0.50 / 0.90 OVER / 1.00 OVER (0.7)** | **900 drops: 0.50 OVER / 0.50 OVER / 0.40 at budget (0.4)** |

**This is a MISS on `medium`, and probably on `low`.** The first run's `medium` verdict (inside budget) did not reproduce when the machine was
quiet: the standing wet program grew to -0.7 / -1.0 ms and the medium shadow-step saving disappeared (-0.20 / 0.00). The dominant cost is
**the wet ground program**, not the rain: the rain batch is 0.4-0.5 ms at `high` and its row on `medium` (-0.4 / -0.6 ms) could not close a
0.2-0.3 ms gap by a ladder step, so none was taken on `medium`. `low` took the second step (900 -> 525) on the quiet reading and it was
**not re-measured** (the re-run budget was spent); the rain row recovers at most about 0.1-0.2 ms, so `low` z1 and z1.6 may still read about
0.1 ms over. Whole frame (`ein_qasab` minus the basin, crude: different places on different maps): high -0.9 / +0.7 / +0.9, medium -0.8 /
+0.8 / +1.4, low -0.8 / +0.8 / +1.1 ms. Draw calls: +1 on a wet map (exactly -1 when the rain hides), 0 elsewhere. rAF cadence 16.70 ms,
vsync-bound, 0% over 20 ms; `--burn=2` reads 50.0 ms as it must. Bloom census (`ein_qasab`, medium and high): quiet-frame max 0.318 /
0.333 / 0.263 against the 0.9 ceiling (the command's separate `aftermath` block exits 1 on pooled muzzle lights: not the wet map).
**Not measured:** the program count (+1 rain, +4 permutations expected), the texture count (+2 expected), the height-bake time under the tool
(`rain-height-bake.test.ts` pins it under 5 ms: 2.2-2.9 ms), tick time (no sim edit), any other GPU, a live fight on the wet map.

### 14.5 The looks: conditions and verdicts

All captures: ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro), 1400x900 DPR 1, preset `high` unless named, day under `rainLight`, music off,
port 5196, the machine loaded by other sessions during the first two. Sheets live outside the repo under `_coord/wet-theme/p4/`.

**S-L1 (`look1`, run 1; load 34.6 / 72.3 / 81.0).** Frames at tick 0 (Tel Marum tick 1; wade frames tick 400). The wet ground and decal GLSL
compiled on a real GPU with no error. `wadi_halam_basin` 6 of 6 frames pixel-identical to P2b; `tel_marum` differed on tree crowns and
vehicle dust only (a different tick and main moved in between; accepted by the lead, CI's `quiet` golden the witness). On the drawn scale road
puddles read 1.04x / 1.27x / 1.77x over the road and marsh water 1.57x / 1.88x / 2.57x over the marsh floor at reflectance 0.20 / 0.25 / 0.35;
open-ground puddles read darker than grass (gone by ruling). KDF vs the wading squad: dE2000 12.5 on road, 12.9 on water, below the 15.6 floor.
Unconfirmed: tan 25 px discs trailing the squad look like the game's own move-order markers. **Verdict: rulings S-L1 (1)-(4) above.**

**S-L2 (`look2`, run 3; load 29.95 / 73.97 / 59.81 at start).** Every preset, a six-tick strip, a reduced-motion frame, a 5 s clip (choppy under
load; dark outside vision, so not a brightness judge). Density at high on screen: causeway z1 1,417, z1.6 645, z2.5 1,200 (map centre 3,365 at
z0.35, 1,707 at z1, 1,134 at z2.5). Streaks cover 3.0 / 2.3 / 6.8% of the frame at z1 / 1.6 / 2.5; the splash is a thin pale ring (about 5 px at z1.6);
`low` at z1.6 is a faint drizzle; no rim or hard cut at the map edge, and rain over the black void at `kdf_start` z2.5 (about 1.9% of void pixels,
the landing-point overhang). Readability dE2000 at z2.5 under rain (floor 15.6): road 8.2 / 9.0, water 4.0 / 6.4, grass 30.7 / 31.1.
**Verdict: the rain is approved; density, the infantry lift and one recapture ordered** (14.2).

**The recapture (`look3`, run 4, tip d4be46098; load 3.4-4.6).** Stops all ARRIVED on the wanted glyph (road tick 420, water 485, grass 630).
The S-L2 helper cannot score a lifted figure (it discards pixels brighter than 1.5x the ground as streaks), so a figure-mask measure was added
(cool pixels brighter than 1.3x the ground, components of at least 40 px). Readability A / B: **road 25.7 / 21.5, water 21.4 / 13.6, grass
24.6 / 23.0** (S-L2 8.2 / 9.0, 4.0 / 6.4, 30.7 / 31.1; model 24.0 / 23.4, 28.9 / 26.9, 23.1 / 23.1). Road and grass clear 15.6 on both; water
clears on the mean and **misses on the darkest 15%** (13.6; the squad is still in reeds, reed-cut edge pixels pull it down). Density at high
(band 1,120-1,680): causeway z0.35 1,356, z1 1,093 (27 under: a marker view with void on the south edge), z1.6 1,249, z2.5 1,263; the
`kdf_start` and `hamlet` markers sit under the band by geometry (much void). Thin-streak pixel share on causeway grows 0.83% -> 6.13% from
z0.35 to z2.5 because streaks are screen-pixel width (taste). No lattice rows, bands or cuts at the map edge.

### 14.6 Open items (for the lead)

1. **The cost miss (S-C).** `medium` is over (0.90 / 1.00 vs 0.7) and `low` at or just over (0.50 / 0.50 / 0.40 vs 0.4) at a quiet load. The
   dominant cost is the wet ground program. Options: (a) **accept** the miss on `medium`/`low`; (b) a cheaper wet ground program for `medium`/`low` (a THEME_WET variant dropping the rim derivative maths and
   the roughness and normal blocks: a code change plus a measured re-run, and a new permutation); (c) cut the wet layer on `medium`/`low`.
   No more ladder steps will close it; the ledger records the options, not a choice. The PR body puts this first.
2. **SUPERSEDED by the lead's PR 914 ruling 1 (the flat lift is replaced by a rim light; see 14.2): the KDF lift looked wrong though it passed the numbers.** At `RAIN_KDF_FIGURE_LIFT` 0.4 (now removed) the figures are flat, pale, cool grey-blue ghosts,
   brighter than the road and the grass (luminance ground/figure road 0.14, grass 0.59); camouflage, face, helmet detail and team colour are
   gone; internal contrast p95/p5 is 2.2:1 on road and 1.8:1 on grass against 17:1 / 68:1 at S-L2. Silhouette and rifle read, and the water squad
   is findable among the reeds, but "they do not look like soldiers in rain". The wash is intrinsic to a constant add and cannot be fixed by gain
   alone. **Option: `RAIN_KDF_FIGURE_LIFT` 0.3** (model: road 18.3 / 17.8, water 23.3 / 21.2, grass 22.1 / 22.2; NOT captured, and no recapture
   is left); do not go to 0.5 or 0.8. A one-constant change plus the lead's call on a second capture.
3. **The mud spray was NOT SEEN.** The Lavi moved at all six shots (emitter `vehicle_mud`) but drove over grass (the road target was 19.3 tiles
   away and it covered 6.6 in 120 ticks); at 4-5x no dark puffs behind it. Whether the spray is below visibility (3-5 px, alpha <= 0.5) or does
   not fire on grass cannot be told from stills; road spray is untested. Unverified by frame; a capture with a hull on a road would settle it.
4. **The reed agreement is the point contract, not strict** (`marshWaterAt` at a reed's point is under 0.5 at every reed; the control-C texel
   under it reads water at 56 of 897 reeds, 6.2%, bound 8%). A strict version needs a placer change, which moves P2's and P3's reed sets.
5. **Not measured, found at the final review.** (a) Enemy and civilian readability under rain: the lift (now the rim) is KDF-only (G-5), so Sarim and
   civilian figures on the wet road and in marsh water were never scored. (b) The control-C bake costs about 205 ms on `ein_qasab` under rain,
   probably paid twice at boot, and again on a mid-mission road or ridge tile change (which forces a full bake); none of it is in the cost
   tables (they time a parked frame). (c) The mud spray: `updateVehicleAmbientFx` has no ground gate, so the spray fires on grass as well as
   road; what is open is whether `vehicle_mud`'s authored values (3-5 px, alpha <= 0.5, `mud.2`) are visible against dark wet ground, a data
   question (item 3). (d) Reach: `ein_qasab` is the only wetland map and sits in `UNLISTED_MAP_IDS` (`packages/app/src/ui/menu.ts`), so merging
   this reaches a player only through `?sandbox=ein_qasab`; that is the framing for the cost miss in item 1.
6. Smaller: the sky term is lit twice (reflect x 0.74 effective; an honest-model refactor needs a recapture); an orange glow at a
   helicopter rotor head in one vehicle frame (unrelated to rain, not investigated); streak weight grows with zoom (taste); a zoom now slides
   the drop pattern (never seen in a browser); `low` density has 12-30 drops per screen of per-focus noise; the rain's overhang over the void;
   road puddles are hard-edged rectangles (taste). The deferred minors of every task are in the ledger (GLSL terms covered by string-contains
   tests only, the tool's at-budget OVER print, the shared cost-tool block copied three times, `ugv_recon_dog` lifted, now rimmed, with the infantry).
7. **The rim does not clear the floor (look4, the lead's one extra run).** The rim does not clear dE 15.6 on road or water at any gain 0..0.9 (it lights grazing edges only; the mean figure gains 1-3 dE, the darkest 15% does not move). Camouflage, faces, helmets and team colour are kept at every gain; 0.2 and 0.4 are nearly invisible even at 4x, 0.6 is a dotted pale outline at 3-4x that separates boots and legs on grass (the best effect, shipped), and 0.9 is frost and sparkle bordering on an artefact. Options for the lead: a much wider rim (`RAIN_KDF_RIM_POWER` 3 -> 1..1.5, needs a source edit and a run); a rim plus a small flat lift of 0.15-0.2 (look 3's model for a 0.3 flat lift: road 18.3 / 17.8, water 23.3 / 21.2, grass 22.1 / 22.2, uncaptured); or accept dark KDF figures on wet ground.
