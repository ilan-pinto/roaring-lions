# 3D grass for the Wadi Halam maps, on the WebGPU node path (GH-1167): design and art numbers

Status: DESIGN and ART NUMBERS only. This PR has no renderer code, no render pass and no Meshy call. The lead approves the numbers in
§2 and the close-up mock (`2026-11-11-wadi-halam-3d-grass-mock.svg`, hand-drawn, not a render) before any of §6 starts.

Refs: GH-1167; GH-943 (WebGPU P2 and P3); GH-984 (N1 wind, N2 vehicle bend, N3 rotor wash).

**The lead's ruling (9 Nov, GH-1167).** The grass is built for the **WebGPU node path only**. The legacy WebGL path keeps today's
grass, and its goldens do not move. Its cost is measured against the node path's own frame cost. It sits on the node foliage, after
the P2 wind and the disturbance. The ruling replaces the issue body's "both render paths" line.

**The short version.**
- The field is real 3D blades in clumps: 16 blades a clump, 0.05 to 0.12 tile tall, about 8.4 clumps per open tile after
  `SCATTER_DENSITY`, so about 15,000 clumps on each map. It is drawn as instanced clumps in 8x8-tile cells, with three LODs chosen by
  camera zoom.
- At most 0.51 M triangles a frame (worst zoom), at most 108 draws, nothing in the shadow pass and nothing in the AO pre-pass.
- It is built only in the node branch of `ThreeRenderer`, from a module only the node chunk imports. It keys on a new
  `TerrainTones.grassField` field that only the `green` theme sets, never on a map id.
- On a node boot it replaces the flat sward strokes and the Meshy grass tufts on those maps. Legacy builds exactly what it builds today.
  Four pins prove that, and each one is falsified.
- The wind and the bend reuse the shipped maths (`foliageLeanOps`, `disturbSlotPushOps`, `disturbBendOps`) and the same records, so
  the grass runs on the sim clock.
- The budget is at most +1.0 ms median on G, grass on against grass off, at every measured zoom, read in one Metal hold through the
  coordinator.

---

## 1. What exists today (read on origin/main e8da5117c, 11 Nov 2026)

### 1.1 The maps

| map | size | open `.` tiles | cover tiles | today's grass tufts | today's sand litter |
|---|---|---|---|---|---|
| `wadi_halam_basin` | 48x48 | 1,813 | 67 | 650 | 511 |
| `wadi_halam_2` | 48x48 | 1,907 | 154 | 660 | 539 |
| `wadi_halam_3` | 48x48 | 1,815 | 36 | 692 | 488 |
| `wadi_halam_4` | 48x48 | 1,717 | 26 | 633 | 471 |
| `wadi_halam_5` | 48x48 | 1,735 | 0 | 605 | 453 |

Counts are from `decorPlacements` at the shipped `SCATTER_DENSITY` 0.75, using the same bring-up as `packages/app/src/scatter-density.test.ts`
(a throwaway spec, run and deleted).

- All five maps use `terrain: green`, and they are the only shipped maps that do; `tile_green` is a fixture. So a field keyed on the
  theme reaches exactly GH-1167's five maps.
- All five are 48x48, so none of them is chunked (`CHUNKED_ABOVE_TILES`). The grass makes its own cells (§3.2) rather than using the
  chunk layer.
- **No gated golden scenario frames a green map.** The scenarios use `beit_sahwan_outskirts`, `tutorial_ground`, `tel_marum`,
  `qarn_hadid` and `beit_sahwan_3_clearance` (`tools/src/golden-diff/capture-protocol.ts`). The issue body expected Wadi Halam goldens
  to move, but none exists to move, and under the ruling legacy does not change anyway.

### 1.2 The "2D grass" on a green map

A green map draws three kinds of grass:
1. **The flat sward.** `buildScatter` draws 8 to 14 strokes on every open tile (mean 11), in `terrain/scatter.ts`'s `tones.scatter === 'sward'`
   branch. Each stroke is a flat quad lying on the ground, coloured as a composite of `grass.2` with `bladeLit` (`grass.0`) or
   `bladeShade` (`grass.4`). This is the 2D grass the lead means.
2. **The Meshy tufts** (`grass_0/1/2.glb`). These are 142 to 168 triangles each and 0.40 m tall at most, drawn at scale 0.7 to 0.9
   (`GRASS_SCALE_*`, the N-4 cap: 0.36 m, or 0.12 tile). There are about 0.36 a tile, clustered (`CLUSTER_*`). They draw in the shared
   `decor-foliage` BatchedMesh, so they already sway and bend.
3. **The ground image** `green_basin_tile`, recoloured to `grass.2`.

At play zoom a 0.12-tile tuft is 4.7 CSS px tall (z1), one every three tiles. The field reads as flat because nearly everything on it
is flat.

### 1.3 The node foliage the grass sits on: all of it is on main

| what | where | landed |
|---|---|---|
| The node foliage twin (wind) | `terrain/decor-mesh.node.ts`, `foliageLeanOps` in `wind.ts` | P2 T6, PR 1127 (`cbc897855`) |
| Vehicle bend and rotor wash on the node foliage | the disturber `FoliageTerm`, `disturb.ts` `Ops<T>` bodies | P2 T7, PR 1135 (`2aa39161f`) |
| Infantry push (strength 0.25) | the same disturber slots (`DISTURB_FOOT_STRENGTH`) | GH-984 N2, PR 993 |
| An instance-matrix read inside a `positionNode` | `units/garrison-banner.node.ts` | P3 T6, PR 1175 |

The ruling's "P3 disturbance" is the vehicle bend and the rotor wash. They landed as **P2 T7**. The P3 plan (`docs/superpowers/plans/2026-11-08-webgpu-p3.md`)
has no foliage task. So both prerequisites are on main and this work is unblocked.

### 1.4 What the node path costs today (the numbers this budget is set against)

From `docs/agent-notes/webgpu-backend.md`, on `wadi_halam_4`, Apple M3 Pro, G on apple / metal-3, 1280x720 DPR 2, z0.5, quality high:
- G frame at n300 is 10.95 ms and at n600 is 19.82 ms, after the T3-T12 twins (H6, `runArm`).
- Hiding every decor and prop BatchedMesh entry (H1, 2,729 per-entry draws) saved about 0.4 ms on G, inside the spread. Draw calls are
  cheap on G; the vertex and fragment work is what has to be watched.
- The shadow pass costs G 2.2x what it costs L (H3). That is why the grass casts no shadow (decision 6).
- At z0.5 the AO pre-pass does not run on either arm (`zoomFadeWeight(0.5)` is 0).

### 1.5 Scale

- 1 tile = 3 m (`MESH_UNITS_PER_TILE`). A standing figure is about 1.8 m, or 0.6 tile.
- The camera is orthographic, at a fixed 45° azimuth and a 30° elevation. At zoom z, a tile's horizontal unit is 45.25·z CSS px and
  a vertical unit is 39.2·z CSS px. Zoom runs from 0.35 to 2.5.
- Because the camera is orthographic, every clump on screen has the same screen scale. The LOD is a function of zoom alone, never of
  distance, and one LOD draws at a time.
- Because the camera never turns, back-to-front order is static. §3.3 relies on this.

---

## 2. The art numbers (for the lead)

Real region: Wadi Halam is the Naharin green basin, whose closest real match is Yarmouk and south Golan pasture, or the Beit She'an
and Harod side valleys, in the winter-spring flush, February to April (`.claude/skills/levant-terrain`, `game-mapping.md` §3). The
sward is annual grasses and herbs over stony ground: tufted and patchy, with straw left from the year before, and never a lawn
(mistake 3 on the skill's list).

### 2.1 The table

| item | number | why |
|---|---|---|
| **Blade shape** | Tapered strip to a point, base 0.012 tile (3.6 cm). Curved forward in a quadratic arc (tip 0.25-0.40 × height ahead of the root), twisted ±20° root to tip. Normals bent 70% toward the clump's up-and-out, so a clump shades round, not stripy. | A real leaf is 0.5-1 cm wide, which is sub-pixel here (0.14 CSS px at z1). It is widened 4x, and the width floor below does the rest. |
| **Width floor** | Never narrower than 1 device px on screen, applied in the vertex stage from the zoom and the DPR. | There is no MSAA on the node path (SMAA only, `post-chain.node.ts`), so a sub-pixel blade would shimmer. |
| **Blades per clump** | Three clump variants of 12, 16 and 20 blades (mean 16). Tall at the heart, shorter at the rim, leaning 10-35° outward, more at the rim. Footprint 0.17 tile (0.5 m) across. | The same tuft grammar as `build_wet_grass.py`'s, with lusher blade counts. |
| **Height** | Per blade 0.05-0.12 tile (0.15-0.36 m). A clump's scale is 0.85-1.15, clamped so that no tip passes **0.12 tile**. | N-4: grass is never taller than the units it hides. 0.12 tile is 20% of a standing figure (4.7 px of 23.5 px at z1). Lusher means more blades, never taller ones. |
| **Placement** | Open tiles only: the same test as `isOpenScatterAt` (no road clearance, cover, grove, boulder, building or water), applied per clump. Candidates on a jittered 4x4 grid per tile (±0.4 cell). A low-frequency patch field (value noise, 5-tile wavelength, hand-rolled from `tileHash` streams) keeps a candidate when hash < 0.4 + 0.6·patch. | Meadow patches and bare stony gaps, not an even lawn. |
| **Clumps per tile** | 16 candidates; the patch field keeps a mean of 0.7, giving 11.2 at dial 1. **× `SCATTER_DENSITY` 0.75 = 8.4 clumps (about 134 blades) per open tile, as shipped.** | `SCATTER_DENSITY` is settled. It scales the seed probability, never the clump's look (spec §8, N-22). |
| **Clumps per map** | 1,717-1,907 open tiles × 8.4 = **14,400-16,000** (about 15,200). | |
| **Triangles per clump** | LOD0: 7 per blade (4 segments) = **84 / 112 / 140** (mean 112). LOD1: 60% of the blades at 5 triangles (3 segments) = **40 / 50 / 60** (mean 50). LOD2: 6 blades of 1 wide triangle (base 0.018 tile) = **5 / 6 / 7** (mean 6). | This is the maximum detail, simplified only to the budget in §5. LOD1 and LOD2 keep a stable subset of LOD0's blades, chosen by a per-blade priority, so nothing jumps at a switch. |
| **LOD bands** | LOD0 at z ≥ 1.5; LOD1 at 0.9 ≤ z < 1.5; LOD2 at z < 0.9. Hysteresis of ±0.05. | |
| **Colour keys** (`data/palette.json`) | Root and lower blade `grass.4`. Tips per blade: `grass.3` 45%, `grass.2` 35%, `grass.1` 12%. **Straw** (last year's dead blades), 8% of blades: root `dust.3`, tip `limestone.3`. Root occlusion is a shading term of 0.65 at the root rising to 1.0 at 40% height. It is a light value, not a colour key. | `grass.4` is ΔE2000 17.6 from the KDF uniform `olive.1`, which clears the 15.6 floor the wetland used. `scrub.0`, the theme's `low`, is only 9.8 away, so it is not used for blades. `grass.2` is the ground wash the clumps stand on. |
| **Material** | `MeshStandardNodeMaterial`: roughness 0.85, metalness 0, no environment map (the ground's class). Vertex colours are LINEAR (`hexToLinear`). Receives shadows; casts none. | The colour-pipeline rule. |
| **Wind** | The shipped grass class, unchanged: amplitude 0.015 tile at weight 1, period 1.9 s, stiffness 2, `green` strength 0.8. Plus a per-blade flutter (new): amplitude 0.004 tile, period 0.9-1.3 s, with the phase drawn per blade. | Decision 13. The flutter stops 16 blades moving as one card. |
| **Disturbance** | The shipped grass class, unchanged: flatten cap 0.8, stiffness 1.2, no thrash. Vehicles push at 1, infantry at 0.25, the rotor wash at × 1.7. | The same `DisturbUniformSet` the foliage twin reads, by reference. |

### 2.2 What it is on screen

| zoom | blade height | clump width | figure (0.6 tile) | LOD |
|---|---|---|---|---|
| 2.5 (closest) | 11.8 px | 19.2 px | 59 px | 0 |
| 1.5 | 7.1 px | 11.5 px | 35 px | 0 |
| 1.0 (boot) | 4.7 px | 7.7 px | 23.5 px | 1 |
| 0.5 | 2.4 px | 3.8 px | 11.8 px | 2 |
| 0.35 (widest) | 1.6 px | 2.7 px | 8.2 px | 2 |

All sizes are in CSS px at the tallest blade. At z0.5 the grass is texture with relief, not blades, and LOD2 is drawn for exactly that.

### 2.3 Triangles and draws per frame (1400x900 CSS, about 77% of on-screen tiles open)

| zoom | tiles on screen | clumps drawn | LOD | triangles | vertices | draws (cells × 3 variants) |
|---|---|---|---|---|---|---|
| 2.5 | 197 | 1,270 | 0 | 143 k | 183 k | ≤ 18 |
| 1.5 | 547 | 3,540 | 0 | 396 k | 509 k | ≤ 36 |
| 1.0 | 1,230 | 7,960 | 1 | 398 k | 557 k | ≤ 75 |
| 0.9 | 1,519 | 9,830 | 1 | **491 k (the peak)** | 688 k | ≤ 90 |
| 0.89 | 1,519 | 9,830 | 2 | 59 k | 177 k | ≤ 90 |
| 0.5 | whole map | 15,200 | 2 | 91 k | 274 k | 108 |
| 0.35 | whole map | 15,200 | 2 | 91 k | 274 k | 108 |

These are estimates from the formulas above. Slice S1 replaces them with counts from the real placements, and S8 with readings from the
renderer (`stats().perPass`, `renderer.info`). Shadow pass: 0 calls. AO pre-pass: 0 calls. For comparison, today's tufts are about 650
× ~154 = 100 k triangles across the whole map, on both paths.

### 2.4 Memory and boot

- Geometry: 9 small buffers (3 variants × 3 LODs), under 64 KiB in total.
- Instances: about 15,200 × 64 B of instance matrix = about 0.97 MiB on GPU.
- No asset bytes: the blades are generated in code (decision 7), so `perf:load` should read +0 B and only the placement time. Target
  for that: ≤ 20 ms at boot.

---

## 3. How it draws (node path only)

### 3.1 Where it lives

- **`terrain/grass-field-place.ts`** (headless; no three.js). Clump placements from the `TerrainInput` and the tones. It uses `tileHash`
  streams that no other family uses, and the same open test as `isOpenScatterAt`. Output is a struct of arrays (x, y from
  `surfaceWorldY`, z, yaw, scale, variant), sorted back to front for the fixed view.
- **`terrain/grass-blade.ts`** (headless). Builds the blade, the clump and the LODs: positions, bent normals, `rlNature` (height in
  the clump's box, class `WIND_CLASS_GRASS`, a per-blade phase in `.z`) and linear vertex colours from the keys.
- **`terrain/grass-field.node.ts`** (the node chunk only). The material and the cells. Its `name` starts `rl-node-material-grass-field`
  so the census places it as a node-native material, with no legacy twin and no "unadopted" entry.
- **The `ThreeRenderer` node branch.** In `rebuildTerrain`, after the decor build and `adoptNodeMaterials`: when the boot is a node boot
  and `tones.grassField` is set, it loads the module by dynamic import and builds the field. It disposes the field in the same
  teardown that disposes the decor.
- **`TerrainTones.grassField`** (`packages/app/src/terrain-themes.ts`). Only `green` sets it. It holds the colour keys resolved to hex
  through `paletteColor`, as `decorColors` does. The legacy path never reads it (pin P4).

### 3.2 Instancing, cells and LOD

- One `InstancedMesh` per (cell, variant). Cells are 8x8 tiles, so 36 on a 48x48 map, each with its own bounding sphere, so three's
  frustum test skips what is off screen. At most 108 objects. Per H1, 108 draws cost nothing measurable on G.
- **Not** a BatchedMesh: WebGPU draws a BatchedMesh with one `drawIndexed` per entry, so 15,000 clumps would be 15,000 draws.
- **Not** the chunk layer: these maps are not chunked, and the chunk layer copies ranges out of a whole-map build, which is a different
  job.
- **Not** compute or indirect draws yet. Compute is P9+ in the WebGPU programme, and its CPU culling buys nothing at 108 objects.
- LOD: each mesh's `geometry` swaps to the band's LOD geometry when the zoom crosses a band. All three LODs share one attribute layout,
  so the pipeline does not change. The instance matrices never re-upload.
- A building collapse rebuilds only the cells it touched, byte-identical to a full build, the way `terrain/incremental.ts` splices.

### 3.3 Depth and order: the grass writes no depth

- The grass goes in the transparent queue at opacity 1, with `depthTest` on and `depthWrite` off. It gets a new band,
  `GRASS_RENDER_ORDER = -0.5`, in `units/render-order.ts`: after the persistent decals (-1) and before the fading decals, trail and
  zone band (0), the supply route (0.2), the tunnel x-ray (0.25) and the selection ring (0.5).
- The order inside a cell is back to front, fixed at build time. That is correct because the camera never turns. Between cells, three
  sorts transparent objects back to front.
- **What this buys:**
  - a unit, a building or a tree in front of a blade still hides it, because those are opaque and wrote depth;
  - a blade in front of a unit's feet still covers the feet;
  - the selection ring, the zone band, the route and the tunnel x-ray draw over the grass. They are depth-tested, and grass is not in
    the depth buffer;
  - the occlusion outline (band 6) never fires on a unit standing in grass;
  - the AO normal pre-pass and the soft-particle depth snapshot never see grass.
- **What it costs:** no early-z rejection inside the grass, so grass over grass is shaded twice. S8 reads it against a depth-writing
  arm on the same page (decision 5).

### 3.4 Wind, disturbance and the clock

- The `positionNode` reads the instance origin from the instance matrix, using the garrison banner's pattern:
  `buffer(instanceMatrix.array, 'mat4', count).element(instanceIndex)`, column 3. Then it adds:
  1. `foliageLeanOps` (`wind.ts`) with class grass: the one body the number tests already run;
  2. the disturber `FoliageTerm`, made of `disturbSlotPushOps` per slot and `disturbBendOps` after the loop, with the same early-outs
     (count × layer, bounding box) and the same slot budget (`DisturbUniformSet.slots`: 24, 16 or 8 by quality preset);
  3. the per-blade flutter: a new body written once against `Ops<T>` and tested on `NUMBER_OPS` against literals;
  4. the width floor: a sideways push along the blade's own width axis, from a zoom and DPR uniform. It is camera state, not time.
- **The clock.** The material binds the record the foliage twin binds (`SwayRecord`: `time`, `amp`, the wind set and the disturber set)
  by reference. `uSwayTime` is SIM seconds (`presentationSimMs`). No frame clock and no accumulated `dtMs`.
- **Reduced motion.** `uWindMode` 0 plays the reduced sway, as the foliage twin does. The flutter is multiplied by the mode, so it is
  off in reduced motion.
- **Debug layers.** The existing `wind`, `disturb` and `wash` layers reach the grass through the shared uniforms, with no new code.
  A new layer, `grass-field`, hides the field through a flag the frame consults, the `unitsDebugHidden` pattern, because the LOD swap
  rewrites the meshes. It is the A/B for the cost reading and for the probes (§5).
- **Shadow and AO.** Nothing to guard: the grass does not cast, and it never enters the AO pre-pass (no depth write, plus
  `userData.rlAoExempt`, which is belt and braces).

### 3.5 What the node boot stops drawing on these maps

The field **replaces** the flat sward strokes and the Meshy grass tufts (decision 1):
- `buildScatter` gains an option, `swardMarks` (default `true`). The node branch passes `false` when it builds a field. The default
  path stays byte-identical (pin P2).
- The node branch filters the `grass` family out of the placement list before `buildDecorMesh`. Every roll, family and position of
  every other placement is unchanged, because the filter runs after placement (pin P2).
- Sand litter, bushes, trees, rocks and the ground image all stay.
- On the `low` quality preset there is no field, and the node boot draws today's sward and tufts (decision 8).

### 3.6 How legacy is proven unchanged (the pins)

Each pin is falsified before it lands: run the mutation listed, watch the pin go red, then put the code back. The run goes in the
commit message (CLAUDE.md, "Every check gets an input that makes it fail").

| pin | what it holds | falsified by |
|---|---|---|
| **P1. The bundle** | `webgpu:bundle` (in CI) gains a `GRASS_FIELD_MARKER`. It must appear only in the node chunk, never in the main or `ThreeRenderer` chunk. | A static import of `grass-field.node.ts` from `ThreeRenderer.ts`: red. |
| **P2. The builders** | For the five maps and `tile_green`: `decorPlacements` hashes and `buildScatter` default-option hashes, pinned to the values read on main before S1. | Flipping the `swardMarks` default to `false`, or filtering `grass` inside `decorPlacements`: red. |
| **P3. The legacy scene** | A legacy `ThreeRenderer` booted on `wadi_halam_basin`'s input has no object whose name starts `rl-grass-field`, and its `decor-foliage` instance count equals today's (tufts included). | Dropping the node check in `rebuildTerrain`: red. |
| **P4. The tones** | The legacy path reads no `grassField`: a spec that boots legacy with a `grassField` whose getter throws. | Reading `tones.grassField` outside the node branch: red. |

The legacy goldens are the backstop, not the proof: no gated scenario frames a green map (§1.1), so a green-only legacy regression
would get past them. That is why P2 and P3 exist.

The same-PR rule (`tools/webgpu_ratchet.mjs`, TWINS) does not apply. The field has no legacy file to twin. `PORTED_FILES` gains
`grass-field.node.ts` as a node-native file.

---

## 4. The node path's visibility (a fact to state, not a design choice)

Until WebGPU becomes the default at P7, a node boot happens only with `&gpu=webgpu` in the sandbox (`packages/app/src/gpu-flag.ts`).
So the lead sees the grass at `?sandbox=wadi_halam_4&gpu=webgpu`, and players see it from P7. Nothing is blessed for a node key before
P7, so the grass gets no golden baseline either. Its gates are the vitest pins and wiring tests, and its witnesses are a report-only
probe row and the sheets.

---

## 5. Frame budget and how it is measured

### 5.1 The budget (decision 11)

On `wadi_halam_4`: Apple M3 Pro, G on apple / metal-3, 1280x720 DPR 2, quality high, music off, n0 and n300. The A/B is G with grass
on against G with grass off (the `grass-field` layer), at z0.5, z1, z1.5 and z2.5:

| reading | budget |
|---|---|
| G frame, median of the ABBA round medians | ≤ +1.0 ms at every zoom |
| G frame p95 | ≤ +1.5 ms at every zoom |
| triangles a frame | ≤ 0.6 M |
| draws | ≤ 108 scene, 0 shadow, 0 AO |
| boot (`perf:load`) | +0 B, ≤ +20 ms to first-frame |

Precedent: the scatter's own budget was +0.74 ms GPU p95 when the lead chose `SCATTER_DENSITY` 0.75 (2026-09-28). The grass replaces
the sward strokes and the tufts, so +1.0 ms is the replacement's whole cost, not an addition on top of theirs.

**If a reading is over budget, shed in this order:**
1. LOD bands one step coarser (LOD0 at z ≥ 1.8, LOD1 at z ≥ 1.1);
2. LOD1 at 50% of the blades;
3. 12 blades a clump at LOD0.

Never by height and never by `SCATTER_DENSITY`. Each rung is re-read, and the lead picks the rung, as with the scatter's ladder.

### 5.2 The instruments

- **Counts on CI, free (SwiftShader).** `webgpu-noise.yml` gains `probe=grass`. It reads `stats().perPass` calls and triangles per zoom,
  with grass on and off, on `wadi_halam_4`. Report-only. It refuses if the grass-on arm draws 0 grass calls, so it cannot pass
  vacuously.
- **Load.** `pnpm perf:load -- --sandbox=wadi_halam_4` on a node boot: bytes and the four boot milestones. S8 checks that the tool
  passes `&gpu=webgpu` through, and adds it if it does not.
- **Frame cost: one Metal hold, run by the coordinator** (`_coord/BROWSER.lock`, its own port and never 5177, load ≤ 4,
  `--wait-quiet=90`). `webgpu:abba` gains a `--grass=on|off` switch on the G arm and a zoom list, and reads G on against G off in ABBA
  order on fresh pages, ≥ 3 rounds of 80 frames. The same hold reads the depth-writing arm (decision 5) and the shadow-casting arm
  (decision 6), so the lead decides from numbers.
- **The look.** `nature-captures.ts` and `wind-captures.ts` gain a `--gpu=webgpu` grass sheet on `wadi_halam_basin`, in the same hold:
  - the close-up at z2.5;
  - play zoom at z1 and z0.5;
  - 8 wind frames;
  - a Lavi driving through;
  - a hovering helicopter;
  - a squad standing, kneeling and pinned in grass, as the figure-ground check, which includes the 15.6 ΔE floor against `olive.1`.

### 5.3 The WebGPU instruments that frame `wadi_halam_4` (decision 12)

The ABBA runner, the submit probe, the banding probe and sheet, the P1 and P2 sheets and the units probe's `valley` subject all
compare L with G on `wadi_halam_4`. Grass on G only would break that like-for-like comparison, and it would land on the GH-1152 ratio.
**They hide the `grass-field` layer and print `grass: hidden` in their conditions line.** The grass cost is a separate column,
G on against G off. This changes no gated threshold.

---

## 6. Slices after approval (1-2 h each)

| slice | what | proof | size |
|---|---|---|---|
| **S1** | `grass-field-place.ts`: placements, patch field, the open test, `SCATTER_DENSITY`, static back-to-front order. Plus the census of the five maps (in `packages/app`). | Clumps per open tile in 8.4 ± 0.8 on every map; none on a road, cover, grove, boulder or building; determinism; the order. Each falsified. | 1.5 h |
| **S2** | `grass-blade.ts`: blade, clump and LODs, `rlNature`, linear colours. | Triangles per LOD exactly as in §2.1; tips ≤ 0.12 tile after scale; nothing below y 0; LOD subsets stable; straw share 8%. | 1.5 h |
| **S3** | The legacy pins P1-P4, landed BEFORE any drawing code, against main's values. | Each pin's mutation in §3.6, run red, in the commit message. | 1-1.5 h |
| **S4** | `grass-field.node.ts`: the material, the instance-origin read, wind, disturbers, flutter, width floor, no depth write, `GRASS_RENDER_ORDER`. | Wiring gates as in P2 T6 and T7: each uniform bound by reference and read at the twin after two frame cadences; flutter on `NUMBER_OPS`; r186 instance-read pin. | 2 h |
| **S5** | The node-branch build: cells, LOD with hysteresis, quality presets, `swardMarks: false`, the `grass` filter, the `grass-field` layer, collapse splice, dispose. | P1-P4 still green; a node-boot spec builds ≤ 108 meshes and 0 shadow casters; splice byte-identical to a full build. | 2 h |
| **S6** | The instruments: `probe=grass` on CI; the `wadi_halam_4` L-vs-G tools hide grass and print it; `webgpu:abba --grass`. | The probe refuses a grass-on arm that drew 0 grass calls (falsified by building no field). | 1.5 h |
| **S7** | The close-up and clip sheets (§5.2), in one Metal hold through the coordinator. The lead looks at them. | The sheet itself. | 1.5 h |
| **S8** | The frame-cost Metal hold (§5.1), `perf:load`, the ladder if needed; notes in `webgpu-backend.md` and `terrain-rendering.md`, and a CLAUDE.md line. | Numbers with their conditions. | 1-2 h |

S1 and S2 can run in parallel. S3 must merge before S4. S7 and S8 can share one hold if the coordinator prefers.

---

## 7. Risks

1. **Shimmer.** Without MSAA, a blade 1-2 px wide crawls under SMAA as it sways. Mitigation: the width floor, the wider LOD2 triangle,
   and LOD2 below z0.9. The clip sheet is where it is judged. If it still crawls, the fallback is a blade that fades in from the root
   by zoom, at LOD2 only.
2. **Readability.** Grass at 20% of a figure's height hides a pinned or prone figure's lower body. N-4 holds the height, the infantry
   push flattens a little (0.25), and the ring and outline stay on top (§3.3). The sheet's figure-ground frames decide. If they fail,
   the fallback is a stronger foot push on grass only, not lower grass everywhere.
3. **Overdraw with no depth write.** Grass over grass at z2.5 is shaded more than once. S8 reads it against the depth-writing arm.
   If that arm wins on cost and the ring loses on look, the lead chooses.
4. **The L-vs-G instruments and GH-1152.** If any of the tools in §5.3 is missed, G looks slower for a reason that is not the submit
   path. S6 covers every tool that names `wadi_halam_4` (grep `tools/src/perf`), and the conditions line shows it.
5. **three r186 internals.** The instance-matrix read inside `positionNode`, and r186 applying the instance step before
   `positionNode`, are pinned in S4, as the banner's are. A three upgrade breaks them loudly (the P2 BatchNode precedent).
6. **Scorch and craters.** Grass stands over a crater decal until a follow-up masks it (decision 10). It shows in the `aftermath`-style
   frames on Wadi Halam, but no gated scenario frames that.
7. **Colour.** The green theme is "lawn-green" by the levant skill's G7 (`grass.2` is ΔE 12.3 from a winter sward). Blades built on
   the same ramp will look like the ground they stand on, which is the point, but they will also inherit G7. Moving the theme
   olive-ward (`fen`) is a both-path ground decision, outside this issue (decision 4).
8. **Bit-rot before P7.** Only sandbox node boots draw it until P7. The vitest pins and the CI probe row are what keep it alive.
9. **Season.** If an act is ever set in summer, this field is wrong (straw `limestone.3` ground, dry grass). The colour keys are data
   in `grassField`, so a summer variant is a tones change, not a code change.

---

## 8. Decisions for the lead

Each decision has a recommended default. A reply of "defaults" accepts them all.

1. **Replace or add.** On a node boot of a green map, the field replaces the flat sward strokes and the Meshy grass tufts. Sand
   litter, bushes, trees and the ground image stay. **Recommended: replace.**
2. **Height cap.** Keep N-4: no blade tip above 0.12 tile (0.36 m), and no taller seed-head stems. **Recommended: keep N-4.**
3. **Density.** 16 candidates a tile and the patch field, giving 8.4 clumps (about 134 blades) per open tile after `SCATTER_DENSITY`
   0.75, about 15,200 clumps a map. Shed through the ladder in §5.1, never by height or `SCATTER_DENSITY`. **Recommended: as stated.**
4. **Colour keys.** The green theme's own ramp: root `grass.4`; tips `grass.3`/`grass.2`/`grass.1` at 45/35/12%; 8% straw (`dust.3` to
   `limestone.3`). Never `scrub.0`, which is ΔE 9.8 from the KDF `olive.1`. The levant skill's G7 move to `fen` stays a separate
   both-path decision. **Recommended: as stated.**
5. **Depth.** The grass writes no depth: band `GRASS_RENDER_ORDER` -0.5 and a static back-to-front order, so rings, the zone band, the
   route, the x-ray and the occlusion outline stay readable. The depth-writing arm is measured in the same hold. **Recommended: no depth
   write.**
6. **Shadows.** Receives shadows but casts none; a baked root occlusion gives the depth. The casting arm is read in the same hold, at
   z ≥ 1.5 only. **Recommended: no cast.**
7. **Geometry source.** Procedural, in TypeScript: no GLB, no Blender, no Meshy. All three LODs come from one blade function and are
   number-tested. The alternative is a Blender-built GLB with its `.blend` (the `build_wet_grass.py` pattern). **Recommended:
   procedural.**
8. **Quality presets.** On `high`, as specified. On `medium`, the LOD bands are one step coarser (×1.2). On `low`, no field, and the node
   boot draws today's sward and tufts. **Recommended: as stated.**
9. **Where it grows.** v1 grows on open `.` tiles only. Cover-1 hedgerow tiles and the olive-grove floor keep today's look.
   **Recommended: open tiles only, and revisit after the sheet.**
10. **Craters and scorch.** In v1 the grass stands over decals. A follow-up masks grass under crater decals. **Recommended: defer.**
11. **Budget.** ≤ +1.0 ms median and ≤ +1.5 ms p95 on G, grass on against off, at z0.5, z1, z1.5 and z2.5, n0 and n300. ≤ 0.6 M
    triangles, ≤ 108 draws, 0 shadow and 0 AO draws. +0 B and ≤ +20 ms at boot. **Recommended: as stated.**
12. **The `wadi_halam_4` instruments.** The L-vs-G tools hide the grass and print it in their conditions. The grass cost is its own G
    on/off column. **Recommended: yes.**
13. **Per-blade flutter.** A new, small term (0.004 tile, 0.9-1.3 s) on top of the shared grass-class wind, for the clip sheet to
    judge. **Recommended: include it, with the sheet showing it on and off.**
14. **Visibility before P7.** Accept that the grass shows only with `&gpu=webgpu` until WebGPU is the default at P7, with no legacy
    port. That follows from the 9 Nov ruling. **Recommended: accept.**

---

## 9. The mock

`2026-11-11-wadi-halam-3d-grass-mock.svg` is drawn by hand from the numbers in §2. It is not a render. Its panels:
- one clump in close-up, with the heights and colour keys marked;
- the blade at each LOD;
- a three-tile patch at play zoom (z1), drawn to scale beside a 0.6-tile figure and a selection ring that draws over the grass.

Its fills are the palette values of the keys named on it, and each one is labelled with its key.
