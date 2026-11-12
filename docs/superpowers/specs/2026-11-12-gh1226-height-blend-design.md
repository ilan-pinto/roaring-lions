# Height and slope ground blending on the WebGPU node path (GH-1226): design and art numbers

Status: DESIGN and ART NUMBERS only. This PR has no renderer code, no render and no Meshy call. The lead approves the numbers in
§2 and the close-up mock (`2026-11-12-gh1226-height-blend-mock.svg`, hand-drawn from palette values, not a render) before any of
§7 starts.

Refs: GH-1226; GH-1167 (3D grass, the model for this design's format and rules); GH-943 (WebGPU P2 T3/T4, the node ground twin; P3
T7, the node decal twin; P4, the wet terms; P6, `perf:memory`'s node arm; P7, the cutover); GH-322 (the highland biome); GH-871 (the
wetland).

**The rule (GH-1226 body, the lead, 10 Nov).** A TSL node material on the WebGPU path first. The legacy WebGL2 renderer keeps today's
look and its goldens do not move, the same rule as GH-1167. Palette keys only. Terrain is presentation only: the sim reads only the
integer grid. "Node path" here means the node backend on both of its devices, G (WebGPU) and F (its WebGL2 fallback), because the TSL
graph compiles for both. "Legacy" means the shipping `WebGLRenderer`. The `levant-terrain` and `rts-art-direction` skills set the
colours and the readability bar.

**The short version.**
- On a node boot, the ground blends three new things by height and slope. Limestone shows through on slopes and crests. In
  highland ground, terra rossa fills the rock's joints. Fine soil settles in the hollows: terra rossa colluvium on highland, loess
  on arid.
- The inputs are a small node-only field texture, baked in TypeScript from the Catmull-Rom surface. It holds slope, the height
  relative to the 1.5-tile neighbourhood (TPI), and a patch noise. It is RGBA8 at 4 texels a tile with no mips: 144 KiB on a 48x48
  map and 576 KiB on a 96x96 map. The rock and open slots the ground already taps carry the texture, so the design needs **no new
  albedo image and no Meshy credit**.
- The blend is one new stage in the shared `groundBlend` maths (`Ops<T>`), between the weight rescale and the road. It mixes three
  palette tones into the vertex tone and moves soil weight into the rock slot. With no stage, the node graph is byte-identical to
  main's. On flat ground the stage contributes exactly 0, so the 11 shipped maps with no elevation (of 41) get no blend at all.
- v1 covers `highland` (11 maps, the exact geological match) and the 10 `arid` maps with relief. Rujm Sawda, the eleventh, opts
  out until its basalt look lands. `wetland` is excluded: it is basalt, and it draws dry on node until P4. `green` waits for the GH-1167 grass,
  which covers the same open ground.
- Roads draw over the blend, the AO and shadows do not change, and the node decal twin reproduces the blended tone so a crater lip
  keeps its colour. Legacy is proven unchanged by pins that land before any drawing code, and by a gated `zero` layer check on the
  legacy `visual` job.
- Budget: at most +0.3 ms median on G, blend on against off, +0 draw calls, and a field bake of at most 20 ms at boot on a 96x96 map.

---

## 1. What exists today (read on origin/main 852eb8f4d, 12 Nov 2026)

### 1.1 The ground

- **Legacy.** `GroundMaterial` (`terrain/mesh.ts`) splices `GROUND_BLEND_GLSL` into a `MeshStandardMaterial` through
  `onBeforeCompile`. Its parts:
  - five unconditional slot taps (`sand`/open, `rock`, `scrub`, `grove`, `knoll`), each a RATIO to its image's mean;
  - controls A and B at 8 texels a tile;
  - the texture-driven height bias (`HEIGHT_BLEND` 0.15) and the rescale;
  - the road from control B's distance field;
  - the macro field, then the relief read (slope light, contours, height tint);
  - the wet terms inside `#ifdef THEME_WET`.

  The colour is the per-tile palette **vertex tone** times the ratio albedo.
- **Node.** `terrain/mesh.node.ts` is the `materials.ground` twin (P2 T3/T4). It is a `MeshStandardNodeMaterial` whose `colorNode`
  is the dry blend, written ONCE in `terrain/ground-maths.ts` (`groundBlend`, `Ops<T>`). The maths reach it as VALUES through
  `MATERIAL_MATHS.ground`, because a value import would load the ThreeRenderer chunk from the node chunk, and the bundle census
  fails on that. Its `normalNode` is the slope light.

  The twin re-binds every uniform and texture from the legacy record each render. A wet owner gets the DRY graph and names
  `rl-ground: wet terms` as unported (P4). Lit, it binds 9 samplers: 5 slots, controls A and B, the macro field and three's BRDF
  lookup.
- **The surface** (`terrain/surface.ts`) is Catmull-Rom over tile centres, with analytic `smoothLevel` and `smoothNormal`. A tile is
  a flat terrace iff `blocked[tile] !== 0` (a `^` ridge or a building pad). Terrace tiles are cut out of the smoothing source, so
  open ground stays level up to a cliff foot. The ground does not cast shadows; it receives them.
- **What the sim reads.** `elevation`, `blocked` and `cover`, all integers. Nothing in this design is read by the sim, and nothing
  here imports `@lions/sim` beyond the types the renderer already reads.

### 1.2 The maps

Census of `data/maps/*.json`:

| theme | maps | with elevation | flat |
|---|---|---|---|
| `arid` | 21 | 11: `beit_sahwan_2`, `_4`, `deir_amun`, `_2`, `_3`, `khan_rafid_2`, `milh_flats`, `milh_flats_l` (96x96), `rujm_sawda` (80x80), `wadi_tarfan`, `wadi_tarfan_l` (96x96) | 10, the tile studies and tutorial included |
| `highland` | 11 | 11: `tel_marum` x4, `qarn_hadid` x3, `umm_zeitoun` x4 | 0 |
| `green` | 6 | 5: `wadi_halam_basin`, `_2`-`_5` | `tile_green` |
| `wetland` | 3 | 3: `ein_qasab`, `ein_qasab_3`, `jebel_matar` | 0 |

The three maps above 48x48 are chunked (`CHUNKED_ABOVE_TILES`). The gated legacy golden scenarios on highland are `relief`
(`tel_marum`), `aftermath`, `rubble` and `ragdoll` (`qarn_hadid`). `quiet`, `vehicle`, `kitted`, `fogged`, `graded` and `dusk` frame
`beit_sahwan_outskirts`, which is flat; `open-ground` frames `tutorial_ground`, also flat.

### 1.3 Scale

- 1 tile = 1 world unit = 3 m. One level = `WORLD_PER_LEVEL` = 0.2552 world units, about 0.77 m.
- A one-level rise across one tile is about 14°, and the Catmull-Rom steepens it a little.
- The camera is orthographic at 30° elevation, and a tile is 45.25·z CSS px wide (z from 0.35 to 2.5).

### 1.4 The relief census (the numbers §2 is set against)

Read with a throwaway vitest spec in `packages/app` (the `scatter-density.test.ts` bring-up; run and deleted, not committed). It
sampled the real `buildTerrainSurface` at 4 texels a tile, over ground texels only (off road, no terrace, soil weight > 0.5 in the
real control map). It used the §3.2 formulas with their proposed numbers, with no patch noise and no texture edge, so these are the
SMOOTH weights.

| map | slope p90 | slope p99 | exposed rock | hollow fill |
|---|---|---|---|---|
| `tel_marum` | 1.1° | 31.6° | 4.2% | 2.8% |
| `tel_marum_1` | 22.5° | 41.3° | 24.9% | 8.2% |
| `tel_marum_2` | 4.0° | 31.2° | 5.4% | 4.1% |
| `tel_marum_3` | 1.1° | 22.9° | 2.4% | 2.4% |
| `qarn_hadid` | 17.0° | 19.3° | 18.4% | 8.2% |
| `qarn_hadid_2` | 17.4° | 32.9° | 16.2% | 7.7% |
| `qarn_hadid_3` | 11.9° | 20.4° | 7.0% | 4.6% |
| `umm_zeitoun` | 18.1° | 30.7° | 25.8% | 10.2% |
| `umm_zeitoun_2` | 14.0° | 30.8° | 9.9% | 4.3% |
| `umm_zeitoun_3` | 16.9° | 31.1° | 20.6% | 8.2% |
| `umm_zeitoun_4` | 9.0° | 21.0° | 6.7% | 3.9% |
| `beit_sahwan_2` | 5.9° | 17.1° | 4.2% | 3.9% |
| `beit_sahwan_4` | 22.7° | 42.6° | 18.0% | 8.8% |
| `deir_amun` | 17.1° | 31.6° | 15.6% | 7.8% |
| `deir_amun_2` | 18.7° | 50.8° | 19.0% | 10.6% |
| `deir_amun_3` | 13.4° | 41.4° | 11.0% | 6.3% |
| `khan_rafid_2` | 9.4° | 17.1° | 4.8% | 1.2% |
| `milh_flats` | 16.3° | 19.0° | 15.0% | 6.2% |
| `milh_flats_l` | 12.6° | 18.2° | 8.6% | 4.5% |
| `rujm_sawda` | 13.6° | 33.5° | 11.3% | 5.8% |
| `wadi_tarfan` | 16.0° | 34.0° | 12.2% | 5.6% |
| `wadi_tarfan_l` | 8.0° | 24.8° | 6.9% | 3.6% |
| `wadi_halam_2` (green, deferred) | 27.2° | 36.8° | 17.9% | 11.9% |
| `wadi_halam_4` (green, deferred) | 12.5° | 18.3° | 9.6% | 6.6% |

- Every map without elevation reads 0.0 / 0.0, exactly.
- **Inside the golden frames** (a 6-tile diamond around the camera tile):
  - `aftermath` and `rubble` (`qarn_hadid` at (34.5, 32)): 31.5% rock and 7.2% hollow;
  - `relief` (`tel_marum` at (10, 15)): 23.4% rock and 18.6% hollow.

  Both frames are large enough to carry a node layer check (§6).
- **Why the TPI reads the SMOOTH field.** The first run took it from `surfaceLevel`, which has the terraces in it. Open ground at a
  cliff foot then read as a hollow: 22.8% on `tel_marum_2`, against 4.1% from `smoothLevel`. So the field takes `smoothLevel`
  (pinned in S2).
- **The bake's cost** (level sampling and the separable box mean, vitest on this workstation, not a quiet machine): 2-4 ms on a
  48x48 map, 10 ms on 80x80, and 14 ms on 96x96. The slope sampling is extra; S2 measures it against the 20 ms budget.

---

## 2. The art numbers (for the lead)

### 2.1 The real ground, per theme (`levant-terrain`)

| theme | real region | rock on slopes and crests | in the joints | in the hollows |
|---|---|---|---|---|
| `highland` | Upper Galilee and the south Lebanon massif | weathered grey limestone, "the usual hill colour", karst.1 (ΔE 3.0) | **terra rossa**, terracotta.1 (ΔE 3.6): "grey rock slabs with red-brown seams, never a red field" | deeper terra rossa colluvium, fewer chips |
| `arid` (with relief) | Milh: loess plain; Wadi Tarfan: Negev wadi; Deir Amun and Beit Sahwan: Wadi Gaza banks and kurkar bluffs | pale limestone ledges and nari crust, karst.0 (ΔE 3.2); kurkar is buff | **not terra rossa** (the Marj is hamra, a palette gap; the Negev is loess) | **loess**, limestone.4 (ΔE 1.8); coastal sand, limestone.2 (ΔE 2.8), on the Marj |
| `rujm_sawda` (arid) | Harrat al-Sham, the "Black Desert" | basalt, not limestone (gap G1) | none | qa' mudflats |
| `green` | Lower Galilee and the Yarmouk pasture in the winter flush | limestone outcrops in pasture | a little terra rossa | lusher sward, not sand |
| `wetland` | the Hula in winter | basalt | none | water (P4's puddles) |

The issue's wording ("terra rossa in the joints, sand and loess in the hollows") is two different landscapes. This design gives each
theme its own keys. Terra rossa goes where it is real, and arid gets loess.

### 2.2 The table

Every colour is a `data/palette.json` key, resolved through `paletteColor` in `packages/app/src/terrain-themes.ts`. The renderer
converts it to LINEAR (`hexToLinear`) and mixes in linear light. Composites are listed as sRGB for reading.

| item | `highland` | `arid` (relief maps, not `rujm_sawda`) | why |
|---|---|---|---|
| **Exposed-rock tone** | karst.1, amplitude 0.75: dust.5 to **#A29887** | karst.0, amplitude 0.7: limestone.3 to **#CDC4B3** | Grey limestone, not cream or orange (mistake 4 on the skill's list). karst is `theme_only`, but a TINT key may be used without naming the ramp in `paletteRamps`, as `basalt` is. The quantiser never sees these mixes, so no composed tile on any map moves. |
| **Joint tone** | terracotta.1, amplitude 0.6 over the rock: **#A37B6A** | off (amplitude 0) | Terra rossa only where it is real. 0.6, not 0.8: at 0.8 the joint's luminance is 1.11x the KDF uniform's (§2.3). |
| **Hollow tone** | terracotta.1, amplitude 0.45: dust.5 to **#8F5931** | limestone.4 (loess), amplitude 0.6: limestone.3 to **#BFA98A** | Fine soil settles. On arid this is loess, not dune sand (mistake 1, "sand everywhere"). |
| **Hollow texture** | the open slot's chips softened 40% | the sand ripples softened 50% | Deep soil and silt have less clast. |
| **Rock texture** | the rock slot (`rock_ground_tile`, 2 tiles a repeat, its crack network) | the same | It is already tapped on every ground fragment, so it costs nothing. |
| **Joint share** | joints where the rock image's luminance ratio is below 0.85-1.00 (smoothstep): **20-32%** of exposed rock across the zoom range (table below) | n/a | A threshold that holds at the mip the game actually samples. The thin cracks are what a box filter removes first, so a tighter band vanishes at play zoom. It reads as seams close up and as a red-brown mottle at play zoom, never a red field. |
| **Slope ramp** | exposure 0 at 10°, 1 at 22° (smoothstep) | the same | A one-level step is about 14°, so a single terrace-height bank shows patchy rock and a two-level bank is bare. |
| **Crest** | +0.6 x smoothstep(0.15, 0.45) level above the 1.5-tile mean | the same | Soil erodes off convex crowns. |
| **Hollow** | smoothstep(0.12, 0.40) level below the 1.5-tile mean, cut to 0 on slopes from 8° to 16°, and never under exposed rock | the same | Sediment rests on flats in concave ground, not on banks. |
| **Patch noise** | x(1 ± 0.5), `fbm2` of 2 octaves at a 3-tile period, seed 1226, hand-rolled (`terrain/noise.ts`, `tileHash`), baked into the field | the same | Outcrops come in patches, not contour bands. Deterministic on every run and backend. |
| **Texture edge** | the exposure biased by the rock texel, at gain 0.6, in `heightBiased`'s form (0 change at exposure 0 and 1) | the same | The boundary follows the rock image's bright clasts, as the ground's own `HEIGHT_BLEND` does at slot edges. This is the "height-based" blend in the texture-art sense. |
| **Where it applies** | ground tops only; soil weight = open + knoll + half of scrub; never on a `^` top, a pad, a wall, the grove floor or a road surface | the same | The control map already says what is soil. |
| **Roughness and metal** | unchanged (1, 0); no environment map | the same | The ground's class takes no environment, and a per-material roughness reads nothing under a side sun at RTS zoom. |

**The joint share and the texture edge at the mip the game samples.** `rock_ground_tile.jpg` is 1024 px over 2 tiles, so 512 texels
a tile. At DPR 2 a tile is 90.5·z device px across and half that in depth (the 30° pitch), so the ground samples about mip 2 at z2.5
and mip 3-4 at z1. Read by box-downsampling the image with PIL; the image's mean is the `GROUND_ALBEDOS` row:

| image px (mip) | about where | ratio p5 / p50 / p95 | joints at 0.70-0.90 | joints at 0.85-1.00 | texture-edge swing at gain 0.6 |
|---|---|---|---|---|---|
| 1024 (0) | closer than the camera goes | 0.56 / 1.03 / 1.31 | 17.8% | 32.0% | −0.26 to +0.19 |
| 512 (1) | | 0.64 / 1.03 / 1.26 | 14.1% | 29.2% | −0.21 to +0.16 |
| 256 (2) | z2.5 | 0.74 / 1.02 / 1.21 | 9.6% | 26.7% | −0.16 to +0.13 |
| 128 (3) | z1.3 | 0.80 / 1.01 / 1.17 | 5.8% | 23.7% | −0.12 to +0.10 |
| 64 (4) | z0.7 | 0.86 / 1.00 / 1.14 | 2.2% | 20.6% | −0.09 to +0.08 |

At 0.70-0.90, the band first drafted, the joints fall to 2-6% at play zoom and the terra rossa would vanish where the player looks.
0.85-1.00 holds 20-32% at every zoom, so it is the number proposed. The texture edge weakens with the mip, as it should: the boundary
follows the clasts close up and stays smooth from afar. If the S8 sheet shows the joints as a mottle rather than seams, the fallback is
decision 8's joint mask.

`green` (deferred, decision 1), for the record: rock karst.1 at 0.6 (grass.2 to #A9AF87, ΔE2000 20.4 from olive.1), hollow grass.3
at 0.5 (#99B65B, the lusher sward where water collects, ΔE2000 22.5), and joints terracotta.1 at 0.4. It ships when GH-1167's grass field (S5) can skip
exposed rock.

### 2.3 Readability (`rts-art-direction` principle 1; KDF uniform `olive.1` #6E7449, linear luminance Y 0.163)

| composite | sRGB | Y | Y / Y(olive.1) | ΔE2000 to olive.1 |
|---|---|---|---|---|
| highland open today (dust.5) | #806032 | 0.132 | **0.81** | 15.6 |
| highland exposed rock | #A29887 | 0.319 | 1.96 | 19.3 |
| highland joint (0.6) | #A37B6A | 0.230 | 1.41 | 24.9 |
| highland joint at 0.8 (rejected) | #A16853 | 0.181 | 1.11 | 26.5 |
| highland hollow | #8F5931 | 0.132 | 0.81 | 23.0 |
| arid open today (limestone.3) | #C8B494 | 0.471 | 2.89 | 26.0 |
| arid exposed rock | #CDC4B3 | 0.557 | 3.42 | 29.5 |
| arid loess hollow | #BFA98A | 0.413 | 2.54 | 24.1 |

**The rule (pinned by S1's readability spec, with literal hexes):**
- every composite is at least ΔE2000 15.6 from olive.1, the wetland's floor;
- every composite's luminance is at least 1.3x olive.1's, unless it replaces a ground that is already below 1.3x, in which case it
  must not be darker than that ground.

Highland open ground is darker than the uniform today (0.81x). The blend raises it on every slope (1.96x) and holds it in the
hollows, so on highland it is a readability gain. The joint at 0.8 fails the rule, and that run is S1's falsification.

### 2.4 Texture and memory

- **No new albedo image.** The exposed rock is the rock slot, the hollow is the open slot softened, and the joints are the rock
  image's own dark texels. That is +0 bytes on disk, +0 for `perf:load`, and 0 Meshy credits.
- **The field.** RGBA8, `NoColorSpace`, Linear filtering, clamp to edge, NO mips. It is only ever magnified: at z0.35 a 48x48 map is
  760 CSS px across, against its 192 texels.

  | map | field | GPU |
  |---|---|---|
  | 48x48 | 192² | **144 KiB** |
  | 80x80 (`rujm_sawda`) | 320² | 400 KiB |
  | 96x96 (`milh_flats_l`, `wadi_tarfan_l`) | 384² | **576 KiB** |

  The JS heap holds the same bytes again, plus about 12 B a texel while baking (1.7 MiB transient at 96x96).
- **Which ratchet applies.**
  - `validate:meshes`' texture budgets are per mesh class (vehicle, building, infantry). There is no ground class, and nothing here
    adds a GLB or a mesh texture, so they are untouched.
  - `perf:memory` reads a GL-only ledger and has no node arm until P6. On legacy the field does not exist (pin L3), so the legacy
    `perf:memory` reading cannot move.
  - On node, the bytes are the computed figures above, read back in S8 as `renderer.info.memory.textures` +1.
- **Samplers.** The node ground goes from 9 to 10 lit (8 to 9 unlit), under WebGPU's 16 per stage. The node decal twin gains 1.
  `mesh.node.test.ts`'s sampler-count gates are updated in S4, with the count as a literal.
- **If the lead wants a dedicated limestone-pavement tile instead** (decision 8): author it procedurally, like the wetland's five
  (`tools/textures/author_*.py`, numpy, hand-rolled periodic noise): 0 credits. It would be a 1024² JPEG, about 0.6 MB on disk and
  5.3 MiB on the GPU with mips.

  The `pnpm meshy` CLI makes models, not tiling images. A Meshy route would be a textured image-to-3D bake, at 15 credits a try on
  `meshy-6-lite` at 2K or 30 on `meshy-6`. With three rerolls that is 45-90 credits (about $0.90-$1.80 at $20 per 1,000), and the
  bake would still need de-lighting and a seam pass. It is not recommended.

---

## 3. How it draws (node path only)

### 3.1 Inputs

- **The field** (`terrain/height-blend-field.ts`, headless, three-free), baked from the whole-map `TerrainSurface` at
  `HEIGHT_FIELD_TEXELS_PER_TILE` = 4, at each texel's centre:
  - **R, the slope.** θ of `smoothNormal`, in degrees: byte = round(θ / 64 · 255), a quarter degree a step. It is 0 on a terrace tile.
  - **G, the TPI.** `smoothLevel` minus its mean over a 13x13-texel box (1.5 tiles), separable, edge-clamped. Encoded as
    128 + 127 · clamp(tpi, −1, 1), the macro field's code, so the shared `macroDecode` reads 128 as 0 exactly.
  - **B, the patch noise.** `fbm2` at a 3-tile period, 2 octaves, seed `HEIGHT_BLEND_PATCH_SEED` 1226, mapped to 0..255.
  - **A** is 255, reserved.

  The field is built whole-map and never per chunk. It is indexed by `worldXZ / uMapSize`, the controls' own coordinate, so every
  chunk samples the same texel at a shared edge (CLAUDE.md, "A chunk's bytes are the whole build's bytes").
- **What the fragment already has:**
  - the five slot texels and their strength-mixed ratios `f_i`;
  - controls A and B, `wallAlbedo` (`top`), the rescaled weights `w_i` and the vertex tone.
- **Why a field and not the fragment's own normal and height.** The node decal twin must reproduce the blended tone (§3.4), and a
  decal quad has no ground normal and no neighbourhood. One field read by both is the one way the two agree. Slope from the field is
  the same analytic Catmull-Rom derivative, sampled every quarter tile and bilinear; the geometry's own normals are interpolated
  between vertices only 4 to a tile.
- **The sim never reads any of it.** The field is built in `@lions/render` from the renderer's own surface. The tones come from the
  app's theme bundle. Nothing is a `Command`, nothing is hashed, and `pnpm test:determinism` cannot see it. The integer grid stays the
  only thing the sim reads.

### 3.2 The maths (`terrain/height-blend.ts`, written ONCE against `Ops<T>`, three-free, a leaf)

Per ground fragment, with `s` = R·64/255 (degrees), `t` = `macroDecode(G)` (levels), `n` = B/255, `amp` the debug and preset
amplitude (1 shipped, 0 for the `height-blend` layer), and `ss` = smoothstep:

```
eRaw  = clamp01( ss(10, 22, s) + 0.6 · ss(0.15, 0.45, t) )
eP    = clamp01( eRaw · (1 + 0.5 · (2n − 1)) )                    patch: mean factor 1
Lr    = luma(f_rock)                                              the rock slot's strength-mixed ratio (1 before its image lands)
e     = clamp01( eP + 0.6 · (Lr − 1) · 4 · eP · (1 − eP) )        texture edge; 0 at eP = 0, 1 at eP = 1
j     = e · (1 − ss(0.85, 1.00, Lr))                              joints; 0 while Lr = 1
h     = ss(0.12, 0.40, −t) · (1 − ss(8, 16, s)) · (1 − e)         hollow, never under rock
soil  = w_open + w_knoll + 0.5 · w_scrub                          (after the rescale, before the road)
mE    = amp · e · soil       mH = amp · h · soil      mJ = amp · j · soil
weights: w_open, w_knoll, 0.5·w_scrub each give up the fraction amp·e of themselves to w_rock (the sum is unchanged)
f_open ← mix(1, f_open, 1 − kH · mH)                              hollow texture softening (kH: highland 0.4, arid 0.5)
tone  ← mix(mix(mix(vertexTone, T_hollow, aH · mH), T_rock, aR · mE), mix(T_rock, T_joint, aJ), mJ)   the joint is over PURE rock tone: a full joint is #A37B6A
```

Then the existing road block runs on the new tone and weights, followed by `albedo x macro` and the relief read, unchanged.

**The stage contributes exactly 0 on flat ground.** On flat ground `s` = 0 and `t` = 0 (byte 128), so `eRaw`, `e`, `j` and `h` are
exactly 0. Every mix is `mix(x, y, 0)` = x, and every weight gives up `w · 0`. The same holds wherever `amp` = 0, and with the 1x1
placeholder field (R 0, G 128, B 128).
- S1 pins this on `NUMBER_OPS` by bit equality, in JS doubles.
- S7 pins it on the GPU, within one program, with the `zero` check on `quiet` (`amp` 1 against 0).

What neither proves is that the program WITH the stage draws a flat map bit-identical to the program WITHOUT it: the extra ops can
change how the compiler contracts the rest of the shader (FMA). So the claim is "the stage adds 0", not "the frame is today's". The
CI probe row in §5 reads record-on against record-off on `quiet` and reports the pixel count. A non-zero count there is a compiler
reading to report, not a defect in the stage.

**One function, three readers.**
- `groundBlend` gains an optional `stage`. Absent, it builds today's graph node for node (pin N1).
- The node ground passes `heightBlendStage(o, ...)`.
- The node decal twin calls `heightBlendTone`, the tone half with `Lr` = 1: no texture edge and no joints (§3.4).
- The CPU tests run all of them on `NUMBER_OPS` against literals.

The constants live in `height-blend.ts` and are re-exported to nobody. The oracles in its spec take LITERALS, never these imports
(the falsification casebook's "independent oracle" shape).

### 3.3 Where it lives

- **`terrain/height-blend.ts`.** The constants and `heightBlendStage` / `heightBlendTone` against `Ops<T>`. It goes to the twins as
  values: `MATERIAL_MATHS.ground.heightBlend` and `MATERIAL_MATHS.decal.heightBlend`.
- **`terrain/height-blend-field.ts`.** The bake, the region splice (§3.4) and the `DataTexture`. It is loaded by DYNAMIC import from
  `ThreeRenderer`'s node branch, as the grass field is. It carries `HEIGHT_BLEND_FIELD_MARKER`, pinned by `webgpu:bundle` to never
  appear in the main or ThreeRenderer chunk (pin L1).
- **The record.** `HeightBlendRecord`:
  - the field texture;
  - the three tones, LINEAR;
  - `aR`, `aJ`, `aH`, `kH`;
  - `amp`.

  It is held on the legacy `GroundMaterial` under a NON-enumerable key (`HEIGHT_BLEND_KEY`, the `DECAL_LIGHTS_KEY` pattern), and
  written only on a node boot, before the first adoption. The legacy `uniforms` table is not touched, so the legacy program and its
  cache key cannot move (pin L2). The twin reads the record each render (`onRenderUpdate`). The field texture rides on `uMapSize`, as
  the controls do. The placeholder is a 1x1 LINEAR-filtered texture, never Nearest: the P2 T3 lesson is that WGSL bakes filterability
  at the first build.
- **The graph choice.**
  - With no record at twin build (a theme with no `heightBlend`, the opted-out map, a legacy boot), the node ground compiles
    today's graph.
  - With a record, it compiles the stage. On `low` it compiles the stage without the texture edge and the joints (§3.5).
- **The twin cache cannot hide that choice.** The adoption cache (`node-material-adoption.ts`) is an identity cache, one twin per
  legacy object, held by each `ThreeRenderer` (`nodeTwins`). A renderer serves one mission, one theme and one preset (the preset
  applies at boot), and is disposed with the mission. So a twin built without the stage is never reused on a highland map. The
  legacy program key only selects the SLOT, and pin L2 holds it fixed whether or not a record exists.

  Two things must be pinned, because the twin is built once:
  - the record is installed before the first `adoptNodeMaterials` (S5);
  - a record installed after the ground twin exists THROWS rather than being silently ignored (S4).

  S4 also boots twice, once with a record and once without, and requires two different twins and two different node programs.
- **`TerrainTones.heightBlend?`** (`packages/render/src/api.ts`, optional, absent by default): `{ rock, joint, hollow }` as resolved
  hexes, plus `aR`, `aJ`, `aH` and `kH`.
  - Only `highland` and `arid` set it in `packages/app/src/terrain-themes.ts`.
  - The legacy path never reads it (pin L3).
  - Absence is exactly today's behaviour, the convention every optional `TerrainTones` field follows.
- **The map opt-out.** An optional `ground_blend: false` in `map.schema.json`, presentation only. `terrainTonesFor(pm)` drops
  `heightBlend` when it is set. Only `rujm_sawda` sets it (decision 2). The sim and `parseMap`'s mechanical layer never see it.
- **The debug layer.** `height-blend` in `debug-layers.ts`, a uniform write (`amp` 0/1) that nothing per frame re-asserts, the
  relief-read precedent. It exists on legacy as a no-op, so a legacy layer check can name it (an unknown layer throws).

### 3.4 How it composes

| with | what happens | why it is right |
|---|---|---|
| **Roads** | The stage runs BEFORE the road block, and the road surface, shoulder and ruts mix over the blended tone. The surface's `(1 − surf)` takes the moved weights down with every other weight. | A road on a hillside is packed dirt, not rock. The road tone still lives in the shader (R-3), and no tile edge appears. |
| **Terraces, walls, pads** | A `^` top is already rock weight 1, so its soil weight is 0. A pad has no channel. A wall has `top` = 0. All three are unchanged. | "Terraces stay hard" holds: the field cannot soften a terrace edge, because the stage never reads it there. The apron is control A's rock weight, unchanged. Joints on `^` tops and cliff faces are decision 13. |
| **The macro field, the relief read** | The macro multiplies after, as today. The slope light (`normalNode`), the contours and the height tint are unchanged and apply on top. | The relief read makes height legible by light, and the blend does it by material. They reinforce each other and share no uniform. |
| **Decals** (P3 T7 node twin) | The twin's divisor becomes `heightBlendTone(aGround, field(worldXZ), record)`, the same function over the same field and record, by reference. S6. | The decal ratio `1 + a(decal/ground − 1)` is right only when `ground` is the tone the ground drew: the "salmon lip" history in `decal-ground-tone.ts`. The texel-driven parts (texture edge, joints) are left out, as the albedo images and the macro are today: a mark inherits the ground's ratio detail. |
| **`THEME_WET`** | Legacy wet GLSL: untouched. Node: the wetland sets no `heightBlend`, so its dry node graph is today's. | When P4 ports the wet terms, they apply AFTER the stage (darkening a blended albedo). Control C's puddle mask already reads the drawn level, so puddles land in the same hollows. P4 may key wet darkening on `mH`, since loess darkens most when wet. Rain keys on `weather === 'rain'`, never on a theme, and the stage has no wet term. |
| **The backdrop and skirt** | Untouched. The kit floor is its own textured material, and the skirt is a dark ratio quad outside the map. | No v1 theme has a backdrop kit (Wadi Halam IV, Ein Qasab III and Jebel Matar are green and wetland). The TPI is edge-clamped, so the map edge reads neither crest nor hollow. |
| **AO** | Unchanged. The stage writes colour only: no position, no normal, no depth. | The node AO pre-pass sees exactly today's ground. |
| **Shadows** | Unchanged. The ground casts none and receives as today. | |
| **Haze, fog, shroud** | Unchanged; they run after, in the fog pass. | |
| **Chunks, collapse** | The field is whole-map. A collapse changes the terrace set inside the splice footprint (`SPLICE_RADIUS_TILES` 2), and the field re-bakes that region grown by the box radius (2 tiles), byte-identical to a full bake (S2's pin). | The `terrain/incremental.ts` contract. A full re-bake at 14 ms would also fit, but the splice keeps a collapse frame cheap on a 96x96 map. |
| **Scatter, decor, props** | Placement unchanged: `decorPlacements` is shared with legacy. Grass and sand tufts may stand on exposed rock. | Any placement change would move legacy. A node-only filter is decision 14. |
| **The GH-1167 grass** | Not in v1: the grass is green-only and green is deferred. | S9 couples them: the grass field's patch keep-probability multiplied by `1 − e`. |

### 3.5 Quality presets (applied at the next mission's boot, like every preset)

| preset | stage | cost |
|---|---|---|
| `high` | full: exposure, patch, texture edge, joints, hollow, texture softening | one field tap and about 45 ALU a ground fragment |
| `medium` | full | the same: the ALU is the whole cost, and `medium` keeps AO off, so it has the headroom |
| `low` | tone-only: exposure with patch, hollow, the weight move and softening; NO texture edge and NO joints (a graph choice, like the wet tiers) | one tap and about 25 ALU. If S8 reads it above +0.15 ms (half the budget), `low` builds no stage |

### 3.6 How legacy is proven unchanged (the pins), landed in S3 BEFORE any drawing code

Each pin is falsified before it lands: run the mutation, watch it go red, put the code back, and record the run in the commit
message.

| pin | what it holds | falsified by |
|---|---|---|
| **L1. The bundle** | `HEIGHT_BLEND_FIELD_MARKER` appears only in the node chunk; `MATERIAL_MATHS_MARKER` rules unchanged. | A static import of `height-blend-field.ts` from `ThreeRenderer.ts`: red. |
| **L2. The legacy program** | The compiled legacy ground fragment for `arid`, `green`, `highland` and `wetland` (dry and wet, every wet tier) and its `customProgramCacheKey` equal digests captured on main before S4, as LITERALS. `theme-identity.test.ts` still holds. | Adding a `uHeightBlendAmp` uniform to `GROUND_VARYINGS_GLSL`: red. |
| **L3. The legacy boot** | A legacy `ThreeRenderer` booted on `qarn_hadid`'s input has no `HEIGHT_BLEND_KEY` record, never calls the field bake (spy), and never reads `tones.heightBlend` (a getter that throws). | Building the field outside the node branch, or reading `tones.heightBlend` in `rebuildTerrain`'s shared part: red. |
| **L4. The legacy decal** | The legacy decal program digest equals main's. | Reading the field in `decal-pool.ts`: red. |
| **N1. The node graph without a record** | The node ground's WGSL and GLSL (F) with no record equal main's, as literal digests. This guards every theme without `heightBlend`, the wet owner included. | Building the stage with `amp` 0 instead of not building it: red. |

The legacy goldens are the backstop, not the proof. L2 proves it on the program text, and the gated `zero` layer check (G7) proves it
on the pixels.

The same-PR rule (`tools/webgpu_ratchet.mjs`, TWINS) does not fire, because no legacy GLSL file changes. `height-blend.ts` and
`height-blend-field.ts` join `PORTED_FILES` as node-native files with no twin row.

---

## 4. The node path's visibility (a fact, not a choice)

Until WebGPU becomes the default at P7, a node boot happens only with `&gpu=webgpu` (or `&gpu=webgl2` for F) in the sandbox. The lead
sees the blend at `?sandbox=qarn_hadid&gpu=webgpu`, and players see it from P7. No node key is blessed before P7, so the blend gets no
golden baseline of its own. Its gates are the vitest pins and the reference-free layer checks (§6).

---

## 5. Frame budget and how it is measured

| reading | budget |
|---|---|
| G frame, median of the ABBA round medians, blend on against no record | ≤ +0.3 ms at every zoom and preset |
| G frame p95 | ≤ +0.5 ms |
| draw calls, programs, passes | +0, +0, +0 (the stage is inside the one ground program) |
| boot: the field bake | ≤ 20 ms on `milh_flats_l` (96x96), ≤ 5 ms on a 48x48 map; `perf:load` +0 asset bytes |
| a collapse splice of the field | ≤ 2 ms |
| GPU memory | +144 KiB (48x48) to +576 KiB (96x96), as computed in §2.4 |

The precedent is the relief read: +0 draws, +0 textures, ALU only, about +0.15 ms median at every preset (GH-804), against the same
0.3 ms line. The blend adds one texture tap, which the relief read did not.

**The instrument: one Metal hold, run by the coordinator.**
- `_coord/BROWSER.lock`, its own port and never 5177, load ≤ 4, `--wait-quiet=90`, music off, one browser.
- `webgpu:abba` gains `--height-blend=on|off` on the G arm (off = no record = today's node graph). It reads on against off in ABBA
  order on fresh pages, ≥ 3 rounds of 80 frames.
- Conditions: `qarn_hadid` and `umm_zeitoun` (48x48), `milh_flats_l` (96x96, chunked), 1280x720 DPR 2, z0.5, z1 and z2.5, n0 and
  n300, at `high`, `medium` and `low`.
- The adapter is confirmed through `backendInfo()`, and every number goes out with its conditions line.
- The same hold takes the look sheets (S8).

**Counts on CI, free.** `webgpu-noise.yml` gains `probe=height-blend` (SwiftShader). It is report-only, with two rows:
- `qarn_hadid`: `stats().perPass` and the bound texture count, with the blend on and off;
- `quiet` (`beit_sahwan_outskirts`, flat): the changed pixels between a record-on boot and a record-off boot. The stage adds 0 there,
  so this row reads only what the compiler did to the rest of the program (§3.2).

It refuses an "on" arm whose ground twin has no record or whose field is still the placeholder, so it cannot pass vacuously.

**If a reading is over budget, shed in this order:**
1. `medium` goes tone-only;
2. joints on `high` only;
3. `low` builds no stage.

Never by the thresholds or the tones. Each rung is re-read, and the lead picks the rung.

**The instruments that compare legacy with node** (decision 12):
- The parity report reads layer-toggle deltas, L against F and G, on `relief`, `aftermath`, `rubble` and `ragdoll`, which are all
  highland. A G-only albedo change shifts those deltas for a reason that is not parity.
- Their node arms hide `height-blend` and print `height-blend: hidden` in the conditions line, as GH-1167 decision 12 does for the
  grass.
- The `wadi_halam_4` instruments (ABBA, submit, banding) are untouched in v1, because green is deferred. S9 adds them to the hide
  list.

---

## 6. The gates, each with its falsification

| gate | what it holds | where it runs | falsified by |
|---|---|---|---|
| **G1. The maths** | `heightBlendStage` and `heightBlendTone` on `NUMBER_OPS` against LITERAL oracles, e.g. s = 16°, t = 0 gives eRaw = 0.5; s = 0, t = 0.30 gives eRaw = 0.3; Lr = 1 gives j = 0. The weight sum is conserved. The flat identity holds by bit equality with the stage-absent `groundBlend`. | vitest (CI `pnpm test`) | Swapping the slope ramp's ends; flipping the sign of `t` in the hollow; dropping the `eRaw` factor from the texture edge (the flat identity goes red). |
| **G2. Readability** | Every composite of every theme in `heightBlend` against the §2.3 rule (ΔE2000 ≥ 15.6 from olive.1; luminance ratio ≥ 1.3, or not darker than the ground it replaces), from literal hexes. | vitest (`tools/src`) | The highland joint at amplitude 0.8 (ratio 1.11): red. |
| **G3. The field** | Flat maps bake exactly R 0, G 128 everywhere. Coverage per relief map stays within ±3 points of the §1.4 table. The TPI reads `smoothLevel`. The region splice is byte-identical to a full bake. Determinism holds: two bakes are equal. | vitest (`packages/app`, the real maps) | The TPI from `surfaceLevel` (`tel_marum_2` hollow 4.1% to 22.8%): red. A splice margin one tile short: byte mismatch. No edge clamp: red. |
| **G4. Legacy pins L1-L4** | §3.6 | `webgpu:bundle` and vitest | §3.6's mutations |
| **G5. Node graph pins N1, wiring** | N1. Every record value bound by reference and re-read after two render cadences (the P2 T6/T7 wiring pattern). The field tap is filterable (not Nearest). No implicit-gradient sample in a conditional (`sample-uniformity.ts`). Sampler counts as literals. `low` compiles without the texture edge and the joints. | vitest (`mesh.node.test.ts`, `decal-pool.node.test.ts`) | Copying a tone instead of binding it: red. A Nearest placeholder: red. |
| **G6. The decal match** | The node decal twin's divisor equals the ground's `heightBlendTone` at the same field texel and `aGround`, on literals; legacy decal unchanged (L4). | vitest | The twin dividing by `aGround` alone: red on a slope texel. |
| **G7. Layer checks in the browser** | **Legacy, `zero`:** hiding `height-blend` moves 0 px on `relief` and `aftermath` (the gated `visual` job, existing baselines, no bless). **Node, `floor`:** hiding it moves the frame on `relief` and `aftermath` (floors are a third of the smallest of three CI readings, set in S7; the census predicts a large signal at 23-31% rock in frame). **Node, `zero`:** hiding it moves 0 px on `quiet` (flat). Needs a per-arm `arms` field on `LayerCheckSpec` (S7). | `visual` (legacy, gating); `visual-backends` (node: see below) | Legacy zero: reading `amp` in legacy GLSL. Node floor: tones equal to the base (amplitudes 0). Node zero: the texture edge without the `eRaw` factor. |

**Why `relief`, `aftermath` and `quiet` can carry a `zero` check.** A `zero` check is sound only where the scenario's zero-time
repaint control reads exactly 0. None of the three declares a `repaintControl` override in `baseline.ts`, so each is held to the
global 0. `ragdoll` (frame-clock physics) is kept off the list.

**The node layer checks cannot fail CI today, and that must be said plainly.**
- The `visual-backends` "Gate arm" step ends in `exit 0`.
- The job votes only through `ci/content-vote.ts` (a black frame or a GPU validation error), per the lead's 7 Nov ruling.
- So a node `floor` or `zero` check that reads FAIL prints FAIL and ships green.

Two ways to give it a real failure path (decision 11):
- **(a)** `content-vote.ts` also fails on a named layer-check FAIL for `height-blend` on the node arm: a narrow change to what the
  7 Nov ruling gates on, for a reference-free check that needs no blessed baseline;
- **(b)** report-only until P7, leaving G1-G6 (vitest, which fails CI now) and the legacy `zero` check as the only gates that can
  turn a PR red.

The recommendation is (a).

---

## 7. Slices after approval (1-2 h each, one PR each, each with its own tests)

| slice | what | proof | size |
|---|---|---|---|
| **S1** | `height-blend.ts`: constants, `heightBlendStage`, `heightBlendTone`, the optional `stage` on `groundBlend`; the readability spec; the rock image's joint share re-read at the zoom-1 mip. | G1, G2, each falsified in the commit message. | 1.5 h |
| **S2** | `height-blend-field.ts`: the bake, the encoding, the region splice, the `DataTexture` (no mips, Linear, clamp, `NoColorSpace`); the real-map census in `packages/app`; bake timing. | G3; ≤ 20 ms on `milh_flats_l`, reported. | 2 h |
| **S3** | The pins L1-L4 and N1, landed BEFORE any drawing code, against main's values as literals. | Each mutation in §3.6, run red. | 1.5 h |
| **S4** | The node ground: the record (`HEIGHT_BLEND_KEY`), the field tap, the stage in `mesh.node.ts`, `MATERIAL_MATHS.ground.heightBlend`, the `low` graph choice, the `height-blend` debug layer (a no-op on legacy). | G5; N1 still green; sampler gates updated. | 2 h |
| **S5** | The renderer's node branch: the dynamic import, the bake on every full rebuild and the splice on a collapse, the record installed before the first adoption, dispose. `TerrainTones.heightBlend` on `highland` and `arid`, the presets, and the `ground_blend` map field with `rujm_sawda` opted out. | A node-boot spec: the record holds the right linear tones and the bound field; L1-L4 still green; `validate:data` accepts the schema. | 2 h |
| **S6** | The node decal twin: the field tap and `heightBlendTone` as its divisor, `MATERIAL_MATHS.decal.heightBlend`. | G6; L4 still green. | 1.5 h |
| **S7** | The gates and instruments: `LayerCheckSpec.arms`; the legacy `zero` checks; the node `floor` and `zero` checks and their first CI floors; decision 11's wiring; `probe=height-blend`; `webgpu:abba --height-blend`; the parity hide. | G7 falsified per arm; the probe refuses a placeholder field (falsified by never binding the baked one). | 2 h |
| **S8** | One Metal hold through the coordinator: the look sheets for the lead (`qarn_hadid`, `umm_zeitoun`, `tel_marum_1`, `milh_flats`, `wadi_tarfan`, `deir_amun_2`, each at z2.5 close-up, z1 and z0.5, at dawn, day and dusk, with a squad on a slope and in a hollow, and a crater on rock); the §5 cost readings; notes in `terrain-rendering.md` and `webgpu-backend.md`, and a CLAUDE.md line. | The sheet; the numbers with their conditions. | 2 h |
| **S9** (follow-up) | `green`: its `heightBlend` keys, the GH-1167 grass skipping exposed rock, the `wadi_halam_4` instruments' hide list. Only after decision 1 and GH-1167 S5. | As S5-S8, on the five Wadi Halam maps. | 2 h |

S1 and S2 can run in parallel. S3 merges before S4. S5 needs S2 and S4, S6 needs S4, S7 needs S5, and S8 needs S7. S8 is the first
render of any kind, and it comes after the lead approves this document.

---

## 8. Risks

1. **Contour bands.** A slope ramp on a smooth surface draws rings around every hill. The patch noise and the texture edge break
   them. If the sheet still shows rings, the fallback is a wider ramp (8-26°), not more noise.
2. **Readability on highland hollows.** They stay at today's 0.81x the uniform's luminance. The rule allows that (not worse than
   today), but a KDF squad in a highland hollow is no easier to see than today. The sheet's figure frames judge it.
3. **The decal twin's left-out detail.** On high, a crater stamped across an exposure edge divides by the smooth tone, so its lip
   shows the rock's texel edge at its own ratio. That is the same accepted trade as the albedo images today. If the sheet shows a
   halo, the decal twin takes the texture edge too (one more tap of the rock slot).
4. **Bilinear slope at a terrace foot.** The field reads 0 on terrace texels, so a texel straddling a cliff foot interpolates
   towards 0. That under-reads slope in the last quarter tile, which is open ground right at a cliff and is under the apron anyway.
5. **Joints at play zoom.** The rock image's thin cracks mip away, which is why the joint band was widened (§2.2). At z1 the
   joints are the image's larger dark patches, not its crack lines. The S8 sheet judges whether that reads as terra rossa seams. If
   it does not, decision 8's joint mask follows.
6. **The issue's wording against the levant mapping.** Arid gets loess, not terra rossa, and the Marj's hamra is a palette gap
   (`skin.1` is the nearest key, ΔE 6.9). A new key is a palette change and needs the lead; v1 does not ask for one.
7. **Bit-rot before P7.** Only sandbox node boots draw the blend until P7. The vitest gates, the legacy `zero` check and the CI probe
   row keep it alive.
8. **three r186 internals.** The record re-bind and the texture riding on `uMapSize` follow the shipped twin's patterns, and S4
   pins them. A three upgrade breaks them loudly, as it would the twin.

---

## 9. Decisions for the lead

Each decision has a recommended default. A reply of "defaults" accepts them all.

1. **Which themes in v1.** `highland` (11 maps) and `arid` maps with relief (10, without Rujm Sawda). `wetland` stays out: it is
   basalt and draws dry until P4. `green` follows in S9 with the GH-1167 grass. Flat maps are unaffected by construction.
   **Recommended: as stated.**
2. **Rujm Sawda.** Opt it out with a presentation-only `ground_blend: false` map field until G1's basalt look lands, rather than
   drawing limestone on the Black Desert. **Recommended: opt out.**
3. **Highland keys.**
   - rock: karst.1 at 0.75;
   - joints: terracotta.1 at 0.6 over the rock;
   - hollows: terracotta.1 at 0.45, with the chips softened 40%.

   **Recommended: as stated.**
4. **Arid keys.**
   - rock: karst.0 at 0.7;
   - joints: off;
   - hollows: loess limestone.4 at 0.6, with the sand ripples softened 50%.

   The alternatives are limestone.2 for a buff kurkar rock on the Marj maps, and limestone.2 sand in the Marj hollows. Both are
   theme-wide, so they would also reach Milh and Tarfan. **Recommended: karst.0 and loess.**
5. **The thresholds.**
   - slope 10-22°;
   - crest +0.6 x (0.15-0.45 level);
   - hollows 0.12-0.40 level below the 1.5-tile mean, cut on slopes from 8° to 16°;
   - patch noise ±50% at a 3-tile period;
   - texture-edge gain 0.6;
   - joints below a rock luminance ratio of 0.85-1.00: 20-32% of the exposed rock at every zoom. The first draft's 0.70-0.90
     collapses to 2-6% at play zoom (§2.2).

   On relief maps this exposes 2-26% of open ground and fills 2-11% (§1.4). **Recommended: as stated, re-judged on the S8 sheet.**
6. **Tone mix or texture only.** Mixing palette tones (this design) lets limestone read as grey on highland's khaki ground, and it
   needs the decal slice (S6). Moving weight between the existing ratio slots alone costs no decal work, but on highland the rock
   would stay khaki. **Recommended: tone mix, with S6.**
7. **Decals in v1.** The node decal twin reproduces the blended tone (S6). **Recommended: yes.**
8. **New albedo images.** None: the rock and open slots carry the texture, and the joints are the rock image's own dark texels. Two
   fallbacks, both at 0 credits:
   - if the S8 sheet shows the joints as a mottle rather than seams, a procedural R8 joint mask (a karren network at 1-3 m with
     joints wide enough to survive to mip 4): 512², 341 KiB on the GPU with mips, +1 sampler;
   - if the rock image is wrong for a pavement, a procedural albedo tile (§2.4).

   A Meshy route would cost 45-90 credits and is not recommended. **Recommended: no new image in v1.**
9. **Quality presets.** `high` and `medium` full; `low` tone-only (no texture edge, no joints), or no stage at all if S8 reads `low`
   above +0.15 ms. **Recommended: as stated.**
10. **Budget.**
    - ≤ +0.3 ms median and ≤ +0.5 ms p95 on G, on against off, at z0.5, z1 and z2.5, n0 and n300, on every preset;
    - +0 draws;
    - a field bake ≤ 20 ms on 96x96;
    - +144 to +576 KiB of GPU memory.

    **Recommended: as stated.**
11. **Can a node layer check fail CI before P7?**
    - (a) `content-vote.ts` also fails on a named `height-blend` layer-check FAIL on the node arm;
    - (b) report-only until P7, with vitest and the legacy `zero` check as the only red paths.

    **Recommended: (a), narrowly, for this layer only.**
12. **The legacy-against-node instruments.** The parity report's node arms hide `height-blend` and print it in their conditions. The
    blend's own cost and look are separate columns. **Recommended: yes.**
13. **Joints on `^` tops and cliff faces.** Terra rossa in the ridges' own cracks would be real on highland, but it moves the ridge
    tops on node and is outside the issue. **Recommended: defer.**
14. **Scatter on exposed rock.** Grass and sand tufts still stand on bare rock in v1, because their placement is shared with legacy.
    A node-only filter would follow the GH-1167 pattern. **Recommended: defer, and revisit after the S8 sheet.**
15. **Visibility before P7.** The blend shows only with `&gpu=webgpu` until WebGPU is the default at P7, with no legacy port. That
    follows from the issue's rule. **Recommended: accept.**

---

## 10. The mock

`2026-11-12-gh1226-height-blend-mock.svg` is drawn by hand from the numbers in §2. It is not a render. Its panels:
- **A.** A highland slope at about zoom 2.5, about 3 tiles across:
  - the profile with the hollow, slope and crest thresholds;
  - a plan strip from the terra rossa hollow, through the chip-strewn open ground, to the exposed karst limestone with terra rossa
    joints;
  - two KDF figures in `olive.1` at 0.6 tile for figure-ground.
- **B.** An arid relief slope: the loess hollow, the rippled open ground and the exposed limestone with no terra rossa.
- **C.** The exposure and hollow weight curves.

Every fill is the sRGB value of the key or two-key composite named beside it.
