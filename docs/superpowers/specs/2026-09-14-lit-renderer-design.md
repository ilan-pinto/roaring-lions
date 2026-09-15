# Lit renderer — art uplift Phase 0

**Status:** implemented on `worktree-art-uplift`. Approved in principle by the
project lead ("lets go with your recommendation", 2026-09-14). Read
"Deviations" below before this design's own text — **eight** things shipped
differently from what it specifies, each for a measured reason, and one of
its acceptance clauses was falsified rather than met.
**Date:** 2026-09-14 (sun ruling 2026-09-15 — deviation 3)
**Branch:** `worktree-art-uplift` (from `main` @ `8db0215`, v0.61.0)
**Report:** https://claude.ai/code/artifact/26a809d0-5d74-4fd4-abf6-7aa9d3e669ae
(the sweep this spec answers: nine captures, the diagnosis, the five-phase plan)

---

## Why

The lead's complaint: *"the game doesn't seem to be at a commercial level. The
color doesn't always match. The animation is lame."*

Measured on `main` today, on the three.js mesh path a player actually gets:

| | |
|---|---|
| scene lights, shadow maps, post passes, tone mapping | **0** of each |
| `antialias` | off (`ThreeRenderer.ts:1631`) |
| `setPixelRatio` | pinned to **1** (`ThreeRenderer.init`) — half resolution on a Retina display |
| pixels of a real frame that are exact `data/palette.json` colours | **24.5%** (force at rest, zoom 2.5) / **11.3%** (town fight, zoom 1.6) |
| distinct colours in those frames | 29,705 / 52,227 against a 56-entry palette |
| colour systems sharing one frame | **three**: a normal-indexed toon ramp (all 18 infantry teams, 4 vehicles, 4 building types, all 21 decor meshes), Meshy photo bakes under a 3-band 30% shade (7 vehicles, 6 building types), and ground albedo × palette tone with a smooth slope shade |
| cast shadows | none; units get an opaque one-colour blob (`unit-shadows.ts`), everything else nothing |

The three systems disagree on where the sun is (the ramp's `uLightDir` is
`(0.5, 1, 0.3)`, the bakes carry Meshy's own baked light, the sand tile carries
its own ripple shading), and nothing casts a shadow onto anything. That is the
colour mismatch. It is not an asset problem: the same assets, drawn by the
campaign board (`campaign/world-view.ts`: antialiased, pixel ratio 2, smooth
shade, no palette gate), already read at the level the lead wants.

The rule behind it is `ART_PIPELINE.md` §0's per-pixel palette guarantee — right
for the August sprite game, and since granted a named exemption for every asset
class that now dominates the frame. It still forbids antialiasing ("a blended
edge pixel is by definition not a palette colour"), blending, real lights ("a
`PointLight` added anywhere would illuminate nothing"), shadow maps ("needs a
`MeshStandardMaterial`-family material") and tone mapping. A gate that protects
11–25% of the frame is costing the other 75–89% everything a lit renderer needs.

## The decision

**One lighting model for every world object, and the palette becomes a design
language instead of a runtime guarantee.** This is option A of the report
("lit, textured, stylised-real"); options B (committed toon, re-texture the
bakes) and C (keep the hybrid, patch it) were rejected there and are not
reopened here.

What is kept, exactly:

- `data/palette.json` as the source of every AUTHORED colour: UI tokens, team
  colours, VFX keys, the ramp albedos of kit-built assets, terrain tones.
- `pnpm validate:ui` unchanged. `pnpm validate:assets` (sprite sheets) unchanged.
  `pnpm validate:meshes` unchanged — it checks the Blender-rendered source
  asset, which is still palette-derived for kit-built geometry.
- The silhouette outline, facing gate, mesh contract, visual gate mechanism,
  Pixi backend (`renderer.ts` stays frozen; Pixi remains the escape hatch and
  is NOT lit — this is three-only, like every VFX since 2026-08-30).

What is dropped, exactly:

- The claim that every rendered pixel equals a palette entry, and the four
  things it forbade: antialiasing, blending, lights and shadows, tone mapping.
- `applyPalettePipeline`, `paletteColorNoConvert`, the `LinearSRGBColorSpace`
  pass-through, `NoColorSpace` on textures, the ramp-shift "flash light", the
  toon ramp materials, the blob shadows, the black fog quads.

## Scope

**In (Phase 0):** the three.js backend's colour pipeline, lights, shadows,
ambient occlusion, post chain, fog-of-war rendering, camera depth range, pixel
ratio, the materials of every world object, the flash-light mechanism, track
mark opacity, the exporters' map policy, tests, and a re-blessed visual gate.
No new art. No sim change (invariant 4: nothing here reads or writes `Sim`
beyond what the renderer already reads).

**Out (later phases, see the report):** animation (crossfades, real falls,
vehicle wheels/tracks/pitch, mesh wrecks, blast VFX, additive particles with
lights) — Phase 1; terrain splat blending, decal pool, scatter density,
atmosphere — Phase 2; Meshy for every unit, infantry bakes, retiring sprites
and Pixi — Phase 3; overlay rules and unit separation — Phase 4. Re-exporting
the seven textured vehicles and six textured buildings WITH their
metallic-roughness and normal maps is Phase 0b: unblocked by this spec, needs
Blender and the untracked sources in the main checkout, and the renderer must
work with or without those maps so it never blocks Phase 0.

## Design

### 1. Colour pipeline

- `renderer.outputColorSpace = THREE.SRGBColorSpace`,
  `renderer.toneMapping = THREE.ACESFilmicToneMapping`, `toneMappingExposure = 1.0`.
  Tone mapping and the sRGB transform happen in the composer's `OutputPass`
  (see §5), so the render target stays linear `HalfFloatType`.
- Base-colour textures are `SRGBColorSpace` — which is what `GLTFLoader` stamps
  and what `prepareTexturedMap` currently undoes. `prepareTexturedMap` is
  deleted; the loader's tagging stands. Ground albedo textures are tagged
  `SRGBColorSpace` on load too (they are photographs).
- Authored colours (`paletteColor(...)` in `app`, `rampForRole` outputs, VFX
  keys, overlay keys) are converted with three's default
  `Color.setStyle(hex)` → linear, i.e. `paletteColorNoConvert` is replaced by
  the ordinary constructor. ~~A palette hex therefore lands on screen as that
  hex under neutral light, which is the property the old pipeline was
  protecting and the new one gets from the standard transform.~~ **That is
  false and deviation 7 measured it false.** A palette hex is the INPUT to
  lighting: decoded to linear, lit, ACES-compressed, then sRGB-encoded. ACES
  at exposure 1.0 is not the identity — `#14150F` photographs as `#050503`,
  15/255 from what `main` drew — so the authored hex is what a surface *is*,
  never what the pixel reads. Nothing in the shipped pipeline preserves the
  old equality, and no part of this design needs it to.
- The clear colour is `opts.background` (`shadow.1`) through the same standard
  path.

### 2. Lights

Two lights in `ThreeRenderer`'s scene, created once in the constructor and
never per frame:

- **Sun**: `THREE.DirectionalLight`, intensity 2.6 (ACES needs headroom; tune
  by eye — the neutral-light property this originally said to tune against
  does not exist, see §1), positioned along
  `SUN_DIRECTION` from the scene origin with its target at the origin.
  `SUN_DIRECTION` is the render rig's own sun — `tools/dimetric.py`
  (`SUN_AZIMUTH` 135°, `SUN_ALTITUDE` 55°) — transformed into three's world
  frame (tile x → world X, tile y → world Z, `VIEW_DIRECTION` in `camera.ts`
  is the reference for which world diagonal the camera sits on). ~~The rule
  that fixes any ambiguity: a billboard sprite's baked shadow and a mesh's
  cast shadow, standing side by side, must fall the same way. The first task
  of the plan photographs exactly that pair and settles the vector.~~ **That
  tie-breaker cannot discriminate and was not what settled it** — see
  deviation 3. The shipped vector is `(−0.406, 0.819, 0.406)`, the rig's
  stated AZIMUTH rather than its lamp's actual beam, ruled by the project
  lead on 2026-09-15.
- **Sky/ground bounce**: `THREE.HemisphereLight(sky, ground, 0.9)` with
  `sky = water.0` and `ground = dust.4`, both from the palette — the ratio to the
  sun is the report's 1 : 0.35 figure expressed in ACES-scaled intensities.
- Both are exported constants in a new `three/lighting.ts` so the campaign
  board (§9) and any future screen share them.

### 3. Shadows

- `renderer.shadowMap.enabled = true`, `type = THREE.PCFSoftShadowMap`.
- The sun's shadow camera is an orthographic box fitted **once per map** to the
  whole map: X/Z from −2 to `width + 2` / `height + 2` world units (1 world unit
  = 1 tile on X/Z), Y from −1 to `+ELEVATION_MAX_WORLD + 4` (tallest building is
  under 4 world units; elevation 9 levels is `9 × WORLD_PER_LEVEL ≈ 2.3`).
  `mapSize` 4096² — on a 48×48 map that is ~85 texels per tile, stable (no
  per-frame refit, so no shadow swimming as the camera pans). `bias −0.0005`,
  `normalBias 0.02`; both are starting values the plan tunes against the
  acne/peter-panning pair on `open-ground`.
- Casters and receivers: terrain receives; mesh units, vehicles, buildings,
  decor (batched and instanced) cast and receive; billboard sprites neither cast nor receive (their shader is unchanged and their light is baked)
  — a camera-facing quad would cast a sliver at the sun's angle;
  FX, smoke, overlays, silhouettes, tracks, trails neither cast nor receive.
- `BatchedMesh` shadow casting: three r170 supports it (depth material with
  `USE_BATCHING`). If a caster path turns out unsupported for a batched or
  instanced type, that type receives only and the gap is recorded — never a
  custom depth material written blind.

### 4. Materials

Every world material becomes `THREE.MeshStandardMaterial` (roughness 0.85,
metalness 0 unless a map says otherwise), so the one sun and one shadow map
light everything the same way:

| Object | Today | Phase 0 |
|---|---|---|
| Mesh infantry / civilians (skinned) | `toonRampSkinnedMaterial(rampForRole)` | `MeshStandardMaterial({ color: liftTone(rampForRole(role, faction)) })` — skinning is automatic on a `SkinnedMesh` |
| Kit-built vehicles / buildings / decor (ramp) | `toonRampMaterial(ramp, {specular, coursing})` | same standard material with `color: liftTone(ramp)`; cel specular and brick coursing retired (the sun and normal maps do that job) |
| Textured vehicles / buildings / decor / ditch | `texturedBuildingMaterial(map)`, 3-band shade | **the material `GLTFLoader` built**, kept as-is: `map` sRGB, and `metalnessMap`/`roughnessMap`/`normalMap` whenever the GLB carries them (Phase 0b re-export). "Use as-is" becomes literal. |
| Ground | `groundSurfaceMaterial`: six albedo slots blended by vertex masks, `mix(1, texel/mean, gain)` × vertex tone × slope shade | `MeshStandardMaterial({ vertexColors: true })` with `onBeforeCompile` injecting the SAME six-slot blend into `diffuseColor` (attributes, uniforms and `GROUND_ALBEDOS` unchanged); `GROUND_RELIEF_STRENGTH`/floor/ceil retired — the sun shades slopes now, and shadows fall across them |
| Scatter, residual, building-decor boxes | `terrainMaterial` (vertex colour pass-through) | `MeshStandardMaterial({ vertexColors: true })` |
| Grove | `groveMaterial` (vertex colour + wind) | `MeshStandardMaterial({ vertexColors: true })` + `onBeforeCompile` vertex sway, same `uTime` |
| Billboard sprites (`instances.ts`) | atlas shader, alpha discard | unchanged shader — the sheets were rendered under the same sun by the Blender rig and are pre-lit; they receive the fog pass (§6) like everything else because it reads depth |
| Muzzle-flash "light" | ramp-index shift uniform in every material | a pool of `FLASH_CAPACITY` (8) `THREE.PointLight`s driven by `FlashLightManager` from the same emitter `light` block: `color`, `intensity` (× an ACES scale), `distance = radius_tiles`, `decay 2`, lifetime `decay_ms`; oldest dropped on overflow, exactly as today. The `FLASH_*_GLSL` chunks and `register()` go. |
| Unit blob shadows | `UnitShadowMesh` | deleted; the air-unit ellipse in `updateOverlays` stays (an aircraft's shadow is far from its body and the shadow map handles it too, so the ellipse is removed only if the map shadow is measured to land) |
| Vehicle tracks | opaque one-colour ground geometry | same geometry, `transparent: true`, `opacity 0.35`, `depthWrite: false` |
| FX, tracers, shells, smoke, shroud, overlays, silhouette, trail | unlit shaders | unchanged |

`liftTone(ramp)` is one rule in `mesh-role.ts`: the ramp's index-1 entry (the
lit face) or index 0 for a two-step ramp. A flat-coloured model under a real sun
reads as a painted model; the darker ramp steps that used to be the shade bands
are what the sun and AO now produce.

`specular`/`coursing` options and their tests are removed with
`toonRampMaterial`. `TEXTURED_BUILDING_TYPES` / `TEXTURED_VEHICLE_TYPES` and the
Python `TEXTURED_MESH_EXEMPT` lists stay, because the mesh gate still needs to
know which GLBs it must not palette-check; the runtime "throw if a GLB outside
the list ships a texture" check stays too, so an unreviewed bake still cannot
slip in.

### 5. Camera and post chain

- `dimetricCamera` currently returns a NEW `OrthographicCamera` every frame
  with near 0.1 and far 20,000 (`CAMERA_DISTANCE × 2`). Post passes hold a
  camera reference and AO reconstructs view position from depth, so both must
  change: one persistent camera updated in place (`updateDimetricCamera(cam,
  vp, camera)`; `dimetricCamera` stays for callers that want a fresh one), and
  `CAMERA_DISTANCE` becomes 120 with near 1 / far 300 — the whole map plus its
  tallest building fits in under 100 units of depth along `VIEW_DIRECTION`.
  `worldToScreenThree`/`screenToWorldThree` are pure arithmetic in `project.ts`
  and do not change; `pick.ts`'s ray and the silhouette's depth bias are
  re-verified by their existing tests.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`; `fitToHost` sizes
  the composer with the renderer.
- `EffectComposer` over a `WebGLRenderTarget` with `samples: 4` (MSAA) and
  `HalfFloatType`:
  1. `RenderPass(scene, camera)`
  2. `GTAOPass` (`three/addons/postprocessing/GTAOPass.js`), radius 0.6 world
     units, `scale 1.2`, `blendIntensity 1.0`, output `Default`. Orthographic
     projection is supported by its depth reconstruction. If it misbehaves under
     ortho on this camera, `SAOPass` is the fallback; either way the pass is
     ONE object created once and sized with the composer.
  3. `FogOfWarPass` (new, `three/fog-pass.ts`): a `ShaderPass` that reads the
     depth texture, reconstructs world XZ through the camera's inverse
     view-projection, samples the shroud texture (§6) with bilinear filtering,
     and applies `color = mix(color, luminance(color) × shroudTint, f)` where
     `f = 0.85` for never-seen and `0.40` for explored, from the texture's
     value. A pixel with no depth (the clear colour) is left alone.
  4. `OutputPass` — ACES tone mapping and the sRGB transform.
- `antialias: true` on the `WebGLRenderer` too, for the rare path that renders
  without the composer (tests and the spike scene).
- `stencil: true` stays; the silhouette's stencil mask must survive the move
  to a render target — the composer's target is created with `stencilBuffer:
  true`, and `silhouette.test.ts`'s measured "flat blue patches" failure is
  the check.

### 6. Fog of war

- `computeFog`/`isFogVisible`/unit visibility gating: unchanged (sim-facing,
  tested, and what `fogVisibleAt` reads).
- `FogMesh` (instanced black quads, alpha 1.0 / 0.55, `depthTest: false`, band
  10) is deleted. In its place a `ShroudTexture`: an `R8` `DataTexture` of
  `(2w) × (2h)` texels built from the `Uint8Array` fog levels whenever
  `fogMeshDirty` would have fired — each tile upsampled ×2 and passed through a
  3×3 box blur so the feather spans about 1.5 tiles at level boundaries; value
  0 = never seen, 128 = explored, 255 = in sight. `LinearFilter`, no mipmaps.
- Because the pass reads depth, a building standing in an explored tile is
  darkened as a building, never covered by a black slab, and a roof in sight
  next to a wall in fog feathers along the wall instead of the tile edge.
- The old `FOG_ALPHA_*` constants and `fog-mesh.test.ts` go; `fog-pass.test.ts`
  pins the texture build (level → value, feather monotone across a boundary,
  dimensions) and the shader constants.

### 7. Debug layers and the visual gate

- `DEBUG_LAYERS` unchanged (`scatter`, `decor`, `ground-albedo`, `buildings`,
  `units`); `setDebugLayerVisible('ground-albedo')` now zeroes the six
  `u*Strength` uniforms on the standard-material ground exactly as it does on
  the custom one, so the scatter tone check's "flat palette tone" reference
  still exists.
- Every gated baseline changes by construction. The plan's last renderer task
  runs `pnpm golden-baseline` (exit 1, expected), then
  `pnpm golden-baseline:bless -- --reason="Phase 0 lit renderer: sun, shadows, AO, sRGB output, MSAA, texture fog"`,
  and re-measures the ten layer-check floors and the `vehicle` repaint
  control from five consecutive runs before committing them — the floors are a
  third of a measured signal, and the signal moved. CI's Linux baseline is
  blessed by the `visual-baseline-bless` workflow after merge, as today.
- Noise: GTAO has no temporal component and the frame loop is frozen by the
  harness, so the noise model (0 px on the three still scenarios) is expected
  to hold; the plan re-measures rather than assumes.

### 8. Exporters (Phase 0b, non-blocking)

`tools/vehicles/textured.py` `DROPPED_PREFIXES` becomes empty and the building
exporters stop passing `export_materials="NONE"` for textured sources, so a
re-export ships `metallic_roughness` and `normal` beside `base_color`.
`TEXTURE_PX` stays 2048 (the lead: *"dont drop resolution"*). The renderer
takes whatever maps the GLB carries. Re-exporting the thirteen textured assets
is an art task with the blender-art agent, run after the renderer lands, and
its own visual re-bless.

### 9. The campaign board

`campaign/world-material.ts` keeps its own smooth-shade material this phase;
it already renders antialiased at pixel ratio 2. Moving it onto `lighting.ts`'s
sun so the diorama and the mission share one light is a one-file follow-up,
listed in the plan as optional.

### 10. Tests

Policy: a test that pinned "on-palette by construction" is deleted with the
module it pinned; every new mechanism gets a test that pins its own invariant.
Rendering does not require tests (CLAUDE.md), but this backend's existing
tests are how its measured facts survive, so the new ones are:

- `lighting.test.ts`: exactly one `DirectionalLight` and one `HemisphereLight`
  in the scene; `SUN_DIRECTION` is normalised and pinned component by component
  to `(−0.406, 0.819, 0.406)` at three decimals, with its X and Z signs asserted
  to DIFFER (deviation 3 — the earlier "the two signs must agree" assertion is
  gone, and the test says in its title and body why, so it cannot be restored
  by someone reading the diff backwards); the shadow camera
  box contains every tile corner of a 48×48 and a 64×64 map and the tallest
  building's roof.
- `materials.test.ts`: every material handed to a mesh unit, vehicle, building
  and decor template is a `MeshStandardMaterial`; `liftTone` picks index 1 of a
  three-step ramp and index 0 of a two-step one; a textured GLB keeps the
  loader's `map`, and keeps `normalMap` when present.
- `flash-light.test.ts` (rewritten): pool bounded at 8, oldest dropped, light
  distance and colour from the emitter block, intensity decays to 0 by
  `decay_ms`.
- `fog-pass.test.ts`: as §6.
- `post-chain.test.ts`: pass order, MSAA samples, `OutputPass` last, composer
  resizes with the renderer.
- `camera.test.ts` (extended): the persistent camera matches a fresh
  `dimetricCamera` for the same input; near/far bracket the map.
- `terrain-parity.test.ts`, `ground.test.ts`, `surface.test.ts`: geometry and
  albedo-blend tests unchanged; the shade-term tests go.

Removed: `palette-material.test.ts`, `palette-material.coursing.test.ts`,
`mesh-material.test.ts`, `textured-building.test.ts` (its `TEXTURED_*` list
parity check moves to `materials.test.ts`), `fog-mesh.test.ts`,
`unit-shadows.test.ts`, and the `outputColorSpace`/`NoColorSpace` assertions in
`ThreeRenderer.test.ts` and `atlas.test.ts`.

### 11. Performance

`pnpm perf:units` (with the hardware-GPU launch args recorded in
`docs/PERFORMANCE.md`) is run on `main` and on the branch at the same unit
counts. Acceptance: the render budget is still not crossed before 300 living
figures (the GDD target). The shadow pass re-submits every caster, so the
expected cost is one extra draw per caster mesh; if the ceiling falls below
300 the ladder is: shadow map 2048² → infantry receive-only → GTAO at half
resolution → shadow casters limited to vehicles, buildings and decor. Each step
is a measured decision recorded in `docs/PERFORMANCE.md`, not a guess.

## Acceptance

The nine captures from the report re-taken from the same URLs, cameras and
ticks (`tools/` gets the capture script as `tools/src/perf/art-captures.ts` so
the set is repeatable), and:

1. Force close-up (zoom 2.5): the Eitan, the Namer, the D9 and the sand show
   one light direction; every unit has a cast shadow on the sand that agrees
   with the billboard drone's baked shadow.
2. Wide shot (zoom 0.5): terrain is legible under the shroud; no tile-edge
   staircase in the fog; the clear colour outside the map is unchanged.
3. Town fight: building shadows fall across the road; no black slab on any
   roof; textured apartments read brighter than on `main` (sRGB, not
   pass-through).
4. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm validate:ui`,
   `pnpm test:determinism` green; `pnpm playtest` and `pnpm balance` byte-identical
   (renderer only).
5. Visual gate re-blessed with the reason string above; floors re-measured.
6. Perf acceptance in §11 recorded in `docs/PERFORMANCE.md`.
7. `CLAUDE.md`'s "colour pipeline" bullets and `ART_PIPELINE.md` §0–§2
   rewritten to describe the lit pipeline and the palette's new role, so the
   next session does not restore the guarantee from the documentation.

## Deviations

Everything below shipped differently from the design above. Each entry says
what the design asked for, what shipped, and the measurement behind the
change. Nothing here was decided by taste.

**1. SMAA in the composer, not hardware MSAA (§5).** The design asked for an
`EffectComposer` target with `samples: 4`. `FogOfWarPass` reads that target's
DEPTH texture, and a multisampled depth attachment has to be resolved before
it can be sampled — support for that in three r170 is the one thing in this
chain nobody here has measured, and the pass that needs it is the higher-value
one. So the target is single-sampled and `SMAAPass` runs last, after
`OutputPass`, which is also the textbook order (SMAA edge-detects on
display-referred colour). The raw `WebGLRenderer` keeps `antialias: true` for
the composer-less path the spikes and tests draw through; measured, turning it
off saves 0.3–0.7 ms of p95 at the zoom-0.5 view, which is under the 1 ms it
would take to be worth un-antialiasing a path with no SMAA to fall back on.
The bless reason string says "SMAA" where §7 wrote "MSAA".

**2. Ground albedo textures stay `NoColorSpace` (§1).** The design tags every
base-colour texture `SRGBColorSpace` and deletes `prepareTexturedMap`, and
that is what shipped for GLB bakes. The six ground albedos are the exception,
because they are not colours: each is multiplied in as a **ratio to that
image's own measured byte mean**, which is what keeps a stretch of any surface
averaging to its `palette.json` tone. Decoding the image would bend the mean
the ratio is taken against, and the exemption record would stop being true.
`terrain/surface.ts`'s `SURFACE_SHADING_EXEMPTION` carries the argument, and
the paragraph `pnpm validate:assets` prints carries it to the art gate's
output.

**3. `SUN_DIRECTION` is `(-0.406, 0.819, 0.406)` — a SIDE light, and the
design's own azimuth is what it implements.** Settled by the project lead on
2026-09-15 (Task 16) after two tasks had carried a different vector each and
neither had reconciled with the other. §2's stated number, **azimuth 135° at
altitude 55°**, is the ruling: in the rig's own frame the camera sits at
ground azimuth 225°, so its right-hand vector points at 315° and **135° is the
camera's LEFT**. A ground azimuth `a` at altitude `el` is the to-sun vector
`(cos a·cos el, sin a·cos el, sin el)` in Blender (X, Y, Z-up); at 135°/55°
that is `(−0.406, 0.406, 0.819)`, and with tile x → world X, tile y → world Z,
Blender Z-up → world Y, three's frame gets `(−0.406, 0.819, 0.406)`.

*What it produces, measured on the capture set rather than predicted:* `+x` is
screen-right and `+y` (world Z) screen-left on this camera, so a box's
screen-left face takes `N·L = +0.406`, its screen-right face `−0.406` and
falls to hemisphere light alone, and its top `0.819`. On
`05-town-fog-blocks` the warehouse's screen-right wall goes **42.6 → 10.0**
mean sRGB luminance while its roof stays **80.9 → 80.2** — the sun's Y did not
change, so lit ground and lit roofs did not either. Shadows run along `−L` in
XZ, toward `(+X, −Z)`, which is screen-right with the two vertical components
exactly cancelling: a caster of height `h` lays its shadow `0.99h` tiles
across the ground *beside* it, against the `1.225h` its own roof is drawn
up-screen. On `03-town-fight` the low warehouse's shadow crosses the road
(**137.4 → 115.7** on a road patch to its right) where before there was none;
on `02-force-closeup` every vehicle and infantry figure has a ground shadow.
The visual gate registered the same thing on its own terms: `quiet`/`buildings`
went **122262 px → 216469** (+77%) because hiding a building now clears a
patch of lit street as well as the building.

*Both earlier vectors are retired, and this is why.* **The rig's lamp does not
implement the rig's stated azimuth.** `build_lights` sets `rotation_euler =
(90−55, 0, 135)`, yawing a beam already tilted toward `+Y`, which puts the
light SOURCE at azimuth 45° — opposite the camera, back-lighting the subject.
That is a rig convention bug, and the sprite sheets are the witness:
`assets/sprites/BLD_WALL/idle_f00_000.png` is a plain single-material box
whose top is `limestone.0` (`#F2E8D5`, 43,264 px) and whose TWO visible sides
are both `limestone.7` (`#75624A`, 44,163 px), identical to the byte — a
bright top over two equally dark sides. Task 1 negated that beam and got the
front-lit `(+0.406, 0.819, +0.406)`; Task 9 kept it on a flank ÷ up-face
luminance ratio over one 69,759-px mask (**0.872** on the bake, **0.891**
front-lit, **0.760** flipped). Neither survives. The front-lit pair lies in
the camera's own azimuth plane, so both camera-facing faces take an identical
`N·L` — which is also why Task 1 could not run §2's own tie-breaker ("a
billboard sprite's baked shadow and a mesh's cast shadow, standing side by
side, must fall the same way"): there is no left/right asymmetry to compare,
and the drone-and-Eitan pair the plan named is a weak discriminator by
construction. Its shadow falls straight up-screen at 40% of the caster's own
screen height, inside any box-shaped silhouette, which is what made
acceptance 1 and half of acceptance 3 unreachable. And Task 9's 0.872 was
measured on a VEHICLE bake, whose shading is `render_team.py`'s
`ROLE_PALETTE`/`LIT_GAIN` mapping rather than a physical render (`CLAUDE.md`:
that table "compensates for a multiply-style light"), so the statistic was
probably reading albedo — no 55° key can produce 0.872 in either direction.
The back-lit `(−0.406, 0.819, −0.406)` the open question proposed is retired
too: it is the lamp's bug carried faithfully into three, and it would put
every camera-facing face on hemisphere light alone.

**4. Ambient occlusion ships at HALF resolution, through a subclass, with two
fixes the design did not anticipate (§5.2, §11).** `GTAOPass` could not be
handed this scene's graph unfiltered: it re-renders everything through
`scene.overrideMaterial = MeshNormalMaterial`, which knows nothing about
alpha, stencils or draw order, so every unit, vehicle and building came out
SOLID BLACK over correct ground — the silhouette outline hull carries
`position` and `aExpand` and no `normal`, and a normalised zero vector is NaN.
`WorldGTAOPass.isAoOccluder` filters the G-buffer to opaque world objects with
a normal attribute. The same subclass suppresses the shadow-map redraw inside
its nested pre-pass (`renderer.shadowMap.autoUpdate = false` around that one
render, restored after), which was drawing a second 4096² map per frame for a
pass that consumes no shadows: **0.7–0.9 ms a frame**, bought back for four
lines. And the ladder in §11 was needed: AO at FULL resolution lands the
acceptance view (zoom 0.5) at **15.40 ms** against a 16.7 ms budget and takes
the two closer views to 20.3–21.7 ms; at half it costs 2.8–3.7 ms of median
and every p95 stays under 13.2. Numbers in `docs/PERFORMANCE.md`, "Lit
renderer frame cost (2026-09-14)".

**5. Performance: the budget holds, and the cost is real.** The zoom-0.5
acceptance view went from **2.0 ms p95 unlit to ~12.2 ms lit** on an M3 Pro
through ANGLE/Metal at 1440×900, pixel ratio 2 — against a 16.7 ms frame
budget. That is a 6× frame cost for the whole feature and it clears the budget
with 27% to spare on this machine; it does not have the margin the unlit
renderer had, and a slower GPU is the case to measure before Phase 1 adds
anything to the frame.

~~§11's acceptance (the render budget is not crossed before 300 living
figures) holds.~~ **That was asserted, not measured — this entry claimed a
result from an instrument nobody had run. It has been run now (2026-09-15) and
the acceptance does hold: 6.50 / 6.70 ms render p95 at the 300-unit checkpoint
(266 living after attrition), two runs, against 16.7 ms — 2.5× of margin.**
The instrument is `measureThreeMesh` driven by
`tools/src/perf/backend-curve-gate.ts`: a real `ThreeRenderer` with
`init()` called, so the composer, the sun's shadow pass, GTAO's normal
pre-pass, fog and SMAA are all live, with the real shipped mesh GLBs loaded;
real hardware GPU, `ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)`, now
printed by the run rather than assumed from the launch args. The pre-lit figure
on the same instrument and the same checkpoints was 1.90–2.00 ms (2026-08-30,
before the harness scene gained smooth ground and the desert grove, so the
multiple is indicative rather than a controlled A/B), so the lit chain
costs **~3.4× per frame here** — one extra submission per caster for the shadow
map and another for the AO normal pass, exactly the tripling the review
predicted — and still clears the budget at 400/320-living (7.80 ms, both runs).
**No ladder rung was taken**: the shadow map stays 4096², infantry still cast,
AO stays at half resolution. Full table, and the linear extrapolation to a
crossing near ~1,150 living units, in `docs/PERFORMANCE.md`, "The 300-unit
acceptance, measured".

Two caveats travel with that number. It is captured at 1280×720 at pixel ratio
1 — the curve harness's own fixed host size, **5.6× fewer pixels** than the
12.2 ms figure in the paragraph above — so the two are measurements of
different things and must not be read against each other. And
`measureSkinnedInfantry`, the source of the ~1,150-figure ceiling already in
`docs/PERFORMANCE.md`, was deliberately NOT re-run: it builds its own bare
`THREE.WebGLRenderer` with no sun, no shadow map, no composer and no AO pass,
so nothing on this branch can have moved it and a re-run would have reproduced
the pre-lit numbers while appearing to confirm something.

**6. Never-seen fog stays at 85% dim (§6).** Kept as the lead approved it,
with one thing worth recording because it is the argument someone will make
for lowering it: terrain, buildings and roads are now LEGIBLE under the
shroud rather than hidden by a black slab, which reads as an information leak
until you notice the minimap has always drawn the building layout of the whole
map. 85% is a mood setting, not a fog-of-war rule, and the rule is unchanged
(`computeFog`/`isFogVisible` are untouched, and unit visibility is still
gated in the sim's own terms).

**7. The clear colour needed `scene.background`, not `setClearColor` (§1).**
The design says the clear colour is `opts.background` (`shadow.1`) "through
the same standard path". It was not: three resolves `setClearColor` through
`getUnlitUniformColorSpace`, which returns `outputColorSpace` (sRGB) whenever
no render target is bound — and every frame ends with `SMAAPass` drawing to
the screen, so the GL clear colour was left holding the sRGB-ENCODED triple
and the next frame's `RenderPass` cleared a LINEAR target with it.
`OutputPass` then tone-mapped the raw hex as if it were already linear:
`#14150F` photographed as **#484B3B** off the map edge, 9.3× its authored
luminance, where `main` drew it exactly. Setting `Scene.background` as well
fixes it — that path is read inside `WebGLBackground.render`, with the target
bound, so it converts to linear, and it sets `forceClear` so the clear happens
despite `RenderPass` turning `autoClear` off. Measured after: **#050503**, the
authored tone through ACES's low-end compression — 15/255 from `main` instead
of 52.

**8. The AO pass had to be seeded before the visual gate could be re-blessed
(§7).** §7 predicted the noise model would hold because "GTAO has no temporal
component and the frame loop is frozen by the harness". It did not, and the
reason is not temporal: `GTAOPass.generateNoise` builds its Poisson-denoise
texture from `new SimplexNoise()`, and three's `SimplexNoise` defaults its
random source to `Math` — a fresh draw from `Math.random()` **per process**.
Within one process the frame is bit-identical (every scenario's zero-time
repaint control read 0 px / 0.0000), so nothing in `pnpm test` could see it;
across processes, `quiet` moved 20 px / **0.1021**, `relief` 2 px / **0.1418**
and `vehicle` 57 px / **0.1051** against a baseline blessed from the same
commit minutes earlier — 25–35× the ceilings, on scenarios whose pre-lit noise
was a literal zero. `post-chain.ts` seeds it (`AO_NOISE_SEED`), and the same
three scenarios went back to **0 px / 0.0000** over five runs. No threshold
was widened.

## Phase 4 note: the overlay tier is tone-mapped and the HUD is not

Not a deviation — nothing here shipped differently from the design. It is a
consequence of §1 that the design never states, found in review on 2026-09-15,
and it is a decision rather than a defect.

Everything drawn in the world goes through `OutputPass`: ACES, then the sRGB
encode. That includes the whole **overlay tier** — HP bars, selection rings,
badge numerals, chevrons, zone outlines, the occlusion silhouette, tracer and
smoke colour, and every billboard sprite — because they are scene geometry,
whatever band they sit in. The **DOM HUD** does not: a Vite plugin publishes
`data/palette.json` as `--rl-*` custom properties, `theme.css` maps them to
semantic tokens, and the browser paints those bytes. `pnpm validate:ui` polices
that side and cannot see this one.

So a HUD swatch and an in-world overlay authored from the same palette key no
longer agree. The size of the mismatch is the size of ACES's own compression at
that value — 15/255 at the low end (deviation 7's `#14150F` → `#050503`), less
in the midtones, and larger for a saturated key than a desaturated one, which
matters most for the two RESERVED bands (`vfx`, `team`), the only saturated
colour the game uses and the one the contrast rule rests on.

Two options, and this is a Phase 4 decision, not a Phase 0 one:

1. **Accept it.** An overlay is a lit object in a lit world and looks wrong if
   it is the one thing that does not respond to the scene; the HUD is a
   different surface at a different brightness and nobody compares them
   side by side. Costs nothing, and is what ships today.
2. **Draw the overlay tier after `OutputPass`.** A second render of bands 4–6
   into the already-encoded frame, with tone mapping off, so an overlay's
   authored hex reaches the screen exactly. Costs one more pass and a second
   depth story (an overlay that must still be occluded by terrain needs the
   depth buffer the composer has already resolved), and it re-opens the
   question for every effect that is deliberately *of* the world — a tracer,
   a muzzle flash — which would then have to be split out of the tier.

Whichever is chosen, the reason must be recorded here: the thing that must not
happen is someone "fixing" the mismatch by restoring a pass-through pipeline,
which is exactly what §7 of the acceptance exists to prevent.

## Acceptance: what was and was not met

Measured from the nine captures, re-taken through
`tools/src/perf/art-captures.ts` against this branch and against `main` at the
same URLs, cameras and ticks.

**Met.** §5 (visual gate re-blessed, all ten layer floors and the `vehicle`
repaint control re-derived from five runs), §6 (perf recorded), §7 (docs), §4
(`pnpm test`, `typecheck`, `lint`, `validate:ui`, `test:determinism` green;
`playtest` and `balance` byte-identical to `main`). Acceptance 2 in full: at
zoom 0.5 terrain, buildings and roads are legible under the shroud, the fog
boundary is a smooth feather with no tile-edge staircase anywhere, and the
clear colour outside the map is `shadow.1` again after deviation 7.
Acceptance 3's second clause, decisively: `main` drew hard black slabs with
sawtooth tile edges across the warehouse roof, the apartment's upper half and
the mosque — **no black slab survives anywhere in the set**.

**Not met, recorded rather than worked around.** (This was TWO items when it
was written; the cast-shadow half was closed by deviation 3's side light on
2026-09-15 and has moved up into the "met" list below.)

*Acceptance 3, "textured apartments read brighter than on `main` (sRGB, not
pass-through)" — FALSE, and the prediction's mechanism had the sign wrong.*
The decode does happen; what the prediction ignored is that the bake is now
multiplied by a light budget and compressed by ACES, and the net is DARKER.
Measured on the same frame at the same tick (`05-town-fog-blocks`): the
warehouse roof 145 → **92**, its near wall 104 → **45**, the whole warehouse
box 99.3 → **86.8**, the whole apartment box 60.8 → **42.5**. That is the
intended shift from a flat pass-through to a shaded surface — the near wall
falls furthest because it is the face the sun rakes rather than strikes — but
the acceptance clause as written is falsified, and whether the town is now too
dim is a look call for the lead, not a threshold anyone here should re-tune.
`SUN_INTENSITY`, the 1 : 0.35 sun-to-hemisphere ratio and exposure 1.0 are all
lead-approved numbers and were left alone.

The side light of 2026-09-15 did not reverse this and moved it very little:
against the front-lit set, on the same frame at the same tick, the whole
warehouse box goes **86.8 → 80.3** and the whole apartment box **42.5 →
36.2** (plain channel mean, the definition those two figures were taken
with). What it redistributed rather than dimmed is the CONTRAST between
faces — the warehouse's screen-right wall 42.6 → 10.0 and its screen-left
wall 29.0 → 42.4 in Rec.709 luminance, with the roof flat at 80.9 → 80.2. So
the town is marginally dimmer again and now reads as volume instead of
flat-shaded boxes; the look call is still the lead's, and still nothing here
should be re-tuned to answer it. Capture noise on these numbers is a measured
**0.00–0.02** (two full capture runs of the same build, same boxes), so every
figure above is signal.

*Acceptance 1, "every unit has a cast shadow on the sand", and acceptance 3,
"building shadows fall across the road" — WERE NOT REACHABLE at the front-lit
sun, and BOTH ARE MET at the side light that replaced it on 2026-09-15
(deviation 3).* The diagnosis was right and it was geometry rather than
tuning: with the XZ pair on the camera's own diagonal, a caster of height `h`
threw its shadow `0.406h / 0.819 = 0.496h` tiles along `(−X, −Z)`, which on
this dimetric screen is straight UP with zero horizontal offset — while the
caster's own roof is drawn `1.225h` up-screen, so **the shadow reached 40% of
the object's own screen height and lay entirely inside any box-shaped
caster's silhouette.** What showed was only what the front-lit captures show:
trees (a canopy offset from a thin trunk), masts, and contact darkening
around wheels and tracks. At `(−0.406, 0.819, 0.406)` the two horizontal
components ADD instead of cancelling and the two vertical ones cancel, so the
same shadow runs `0.99h` tiles horizontally, screen-right, across the ground
beside the caster. Photographed on the re-captured set: the low warehouse on
`03-town-fight` lays a shadow over the road (a road patch to its right reads
137.4 → 115.7), the Namer on `02-force-closeup` lays one on open sand (172.2
→ 163.6), and every infantry figure, vehicle and tree in that frame has one.
Both clauses now read MET.

## Open questions

**~~The sun's XZ sign is not settled~~ — SETTLED 2026-09-15 by the project
lead (Task 16). `SUN_DIRECTION` is `(−0.406, 0.819, 0.406)`, the side light
this spec's own azimuth 135° names; see deviation 3 for the derivation, the
measurements, and both retired alternatives.** The question is recorded rather
than deleted, because the evidence that raised it is still true and a future
session will meet it again in the rig:

- The rig's camera POSITION is at ground azimuth 225° (`render_rig.py`
  `frame_camera`: `center + horiz·(cos 225°, sin 225°)`), and its key light's
  to-sun vector is `(+0.406, +0.406, +0.819)` — **verified by running the rig's
  own Euler through Blender 5.2 headless**, not derived on paper. Those are
  180° apart: **the rig's LAMP back-lights its subject, and that is a rig
  convention bug rather than an authored intent** — `rotation_euler = (90−55,
  0, 135)` yaws a beam that is already tilted toward `+Y`, so the yaw that
  reads as "azimuth 135" lands the source at 45°. The stated constant is the
  intent; the lamp is the defect.
- `assets/sprites/BLD_WALL/idle_f00_000.png` is the cleanest witness in the
  tree — a plain single-material box. Its top face is `#F2E8D5` (limestone.0,
  the palette's brightest) and **both** visible side faces are `#75624A`
  (limestone.7), identical to the byte. Side ÷ top linear luminance = **0.160**.
  A front-lit 55° key predicts ≈0.46 on the same geometry; a back-lit one with
  only the fill predicts ≈0.03–0.04, and the ramp's darkest step is 0.10. So
  the sheets confirm the lamp, not the constant.
- Task 9's own statistic reads 0.872 on a vehicle bake, which no 55° key can
  produce in either direction — a vehicle sheet's shading is
  `render_team.py`'s `ROLE_PALETTE`/`LIT_GAIN` mapping rather than a physical
  render (`CLAUDE.md` says that table "compensates for a multiply-style
  light"), so the flank/up ratio there is probably measuring albedo.

The back-lit `(−0.406, 0.819, −0.406)` this section used to propose was
rejected with the front-lit pair: it is the lamp's bug carried faithfully into
three, and it puts every camera-facing face on hemisphere light alone.

**What that leaves genuinely open** is the rig, not the renderer. `dimetric.py`
still builds a lamp whose source is at 45° while its own constant says 135°, so
a sprite sheet re-rendered today would still come out back-lit and would still
disagree with the meshes beside it. Fixing it means either negating the beam in
`build_lights` or re-authoring the Euler, and then re-rendering every sheet in
`assets/sprites` — which is a Phase-G-sized job with its own four gates, not a
one-line change, and it would move `pnpm validate:assets`. Until then a bake
and a mesh disagree in a specific, stateable way: the bake has a bright top and
two EQUALLY dark flanks, because it was lit from behind, while a mesh beside it
has a bright top, a lit screen-left flank and a shaded screen-right one. Every
unit type without a GLB still draws from the bake, so that pair is on screen in
the default renderer — `02-force-closeup`'s `recon_drone` is one. This was
equally true of the front-lit sun the ruling replaces (the bake had no lit
flank to agree with either vector), so nothing was made worse; it is simply no
longer hidden behind an argument about which way three should point.
The before/after/side-light capture sets are in
`.superpowers/art-captures/{before,after,sun-after}/` (gitignored — regenerate
with `tools/src/perf/art-captures.ts`).

**The `relief` scatter tone check stopped discriminating the defect it was
built for, and the floor was deliberately not moved.** §7's reference-free
half asks a ratio: what fraction of a layer's footprint over textured ground
also shows over the flat palette tone. Re-injecting the stone-grain no-op on
this branch (2026-09-15, `d9fd1c7` reverted by hand) measured **0.6692 on
`quiet` and 0.7109 on `open-ground`**, both still failing the 0.8 floor — but
**0.9186 on `relief`**, which PASSES. The clean reading there is 0.9935, so
the whole gap is 0.075 and any floor inside it would be a fitted number rather
than a measured one. The cause is the same relief that makes `relief` the only
scatter witness with slopes: a mark on a lit hillside differs from the ground
under it by its own micro-relief shading whatever colour it is, so the flat-tone
footprint stays nearly as large as the textured one with the defect present.
The defect is still caught on that map twice over — the baseline comparison
reads 28 px / 0.1536 against a 0.004 budget, and the other two scenarios' tone
checks fail — so what is lost is reference-free coverage of THIS defect on THIS
map, which bites only on a runner with no blessed baseline (exit 3). Closing it
needs a witness that is not a footprint ratio; nobody has designed one. Recorded
in `tools/src/golden-diff/baseline.ts`'s `relief` entry so the number travels
with the check.

## Numbers the lead approved with the recommendation

| Knob | Value |
|---|---|
| Sun azimuth / altitude | 135° / 55° — the render rig's own STATED constant, which is the camera's left. Shipped as `(−0.406, 0.819, 0.406)`; see deviation 3 |
| Sun : hemisphere | 1.0 : 0.35 |
| Shadow map | 4096², PCF soft, one map-wide ortho box |
| AO radius / intensity | 0.6 tile / 1.2 |
| Tone mapping / exposure | ACES / 1.0 |
| Antialiasing / pixel ratio cap | MSAA 4× / 2 |
| Fog never-seen / explored / feather | 85% / 40% / 1.5 tiles |
| Track decal alpha / life | 0.35 / 180 s |

## Risks

- **Draw-call ceiling.** Known bottleneck is submission (74–84% of
  `renderer.render()`); shadows add a caster pass. §11 is the guard.
- **GTAO under an orthographic camera.** Supported in r170's implementation;
  `SAOPass` is the named fallback, and the tightened near/far (§5) is what
  makes either work.
- **BatchedMesh shadow casting.** Believed supported in r170; §3 names the
  fallback (receive-only) so an unsupported path cannot stall the phase.
- **Skinned-mesh draw count unchanged**, so Phase 1's vertex-animation-texture
  question is untouched by this spec.
- **The look changes for everyone at once.** There is no `&unlit` flag: the old
  pipeline is deleted rather than kept as a second code path, and `main`'s
  history is the A/B. The nine captures are the review surface.
