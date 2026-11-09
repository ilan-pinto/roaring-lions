# WebGPU and three.js techniques, and the Blender side

Part 3 of the Roaring Lions RTS art research (2026-11-09). Section 4 lists techniques that raise RTS
art in three.js, each with its cost and browser caveats. Section 5 covers Blender: modelling,
baking, colour management, glTF export, headless scripting and a look-dev scene that mirrors the
game's light.

**Notation.** `[S#]` points to the Sources list. **(est.)** marks an estimate. Frame costs marked
(est.) are order-of-magnitude figures for a mid-range GPU at 1440p, not measurements. Measure every
one with the project's own instruments (`perf:fx`, GPU timers) before deciding. **(inference)**
marks my own reasoning.

## Contents

- [4. WebGPU and three.js techniques](#4-webgpu-and-threejs-techniques)
  - [4.0 Browser support and the WebGL2 fallback](#40-browser-support-and-the-webgl2-fallback)
  - [4.1 TSL node materials](#41-tsl-node-materials)
  - [4.2 GPU compute particles](#42-gpu-compute-particles)
  - [4.3 Screen-space AO, reflections and GI](#43-screen-space-ao-reflections-and-gi)
  - [4.4 Fog, haze and light shafts](#44-fog-haze-and-light-shafts)
  - [4.5 Contact shadows](#45-contact-shadows)
  - [4.6 Decals](#46-decals)
  - [4.7 Instancing and BatchedMesh at scale](#47-instancing-and-batchedmesh-at-scale)
  - [4.8 Height-based terrain blending](#48-height-based-terrain-blending)
  - [4.9 Vertex animation textures for crowds](#49-vertex-animation-textures-for-crowds)
  - [4.10 LOD and impostors](#410-lod-and-impostors)
  - [4.11 Anti-aliasing](#411-anti-aliasing)
  - [4.12 Summary table](#412-summary-table)
- [5. The Blender side](#5-the-blender-side)
  - [5.1 Modelling for RTS](#51-modelling-for-rts)
  - [5.2 Baking](#52-baking)
  - [5.3 Colour management](#53-colour-management)
  - [5.4 glTF export](#54-gltf-export)
  - [5.5 Headless Blender](#55-headless-blender)
  - [5.6 A look-dev scene that mirrors the game](#56-a-look-dev-scene-that-mirrors-the-game)
- [Sources](#sources)

---

## 4. WebGPU and three.js techniques

### 4.0 Browser support and the WebGL2 fallback

- **WebGPU is on by default** in Chrome and Edge 113, Firefox 141 and Safari 26 [S1]. Firefox's
  first release covered Windows. Other summaries put macOS ARM64 at Firefox 145 and Linux still
  behind a flag, and Android Firefox not yet stable [S2] (secondary sources, which disagree in
  places). Chrome on Android has had WebGPU since 121, on Android 12 and later [S2].
- **`WebGPURenderer` uses WebGPU and falls back to WebGL2.** `forceWebGL` forces the fallback for
  testing [S3].
- **TSL compiles to WGSL or GLSL**, so one node material serves both backends [S4], [S5].
  **Compute is the gap.** WebGL2 has no compute stage, so compute-driven effects must be treated
  as WebGPU-only unless the actual fallback is verified [S5], [S6]. Assume every compute feature
  needs a non-compute fallback.
- **The fallback can be slower than `WebGLRenderer`.** One forum benchmark measured 5,000 cubes at
  50 fps through `WebGPURenderer` with `forceWebGL` against 350 fps through `WebGLRenderer` [S6]
  (anecdotal, one test).
- **Roaring Lions today.** The legacy `WebGLRenderer` is the default and the node backend is at P3
  of its port, behind `&gpu=` (`webgpu-backend.md`). Every technique below that needs nodes or
  compute waits for that port.

### 4.1 TSL node materials

What it gives an RTS: one material function written once and applied to every unit, building or
prop.

- **Shared functions.** `Fn()` wraps logic that any material can call. `uniform()` values are
  shared and update without a recompile. `MeshStandardNodeMaterial` exposes `colorNode`,
  `normalNode`, `roughnessNode`, `metalnessNode` and `positionNode` [S4].
- **World-space triplanar.** `triplanarTexture()` projects along three axes from position and
  normal [S4]. It is right for rock, cliffs and ridge walls, and for dust masks on any unit
  without UVs.
- **Weather layers** (inference). Wetness, dust and snow can be one function each over
  `normalWorld.y` (gravity), a noise term and a per-instance or per-theme amount. It darkens
  albedo and lowers roughness for wet, pulls albedo to the theme's dust key and raises roughness for
  dust, and whitens upward faces for snow. Company of Heroes 2's snow is the precedent: upward
  normals, masked by a top-down depth map [S7].
- **Team masks.** A team mask as a TSL function would replace the `onBeforeCompile` hook and
  survive `clone()` (inference). That clone hazard is documented in `team-mask.ts`.
- **Cost.** Near zero per frame for a few ALU terms. The real cost is program count: each new
  feature combination is a new pipeline. Keep features as uniforms where possible, not as
  compile-time branches (inference).
- **Roaring Lions.** The port already writes material maths once against `Ops<T>`, runs it on
  numbers in tests and on nodes in the twin (`webgpu-backend.md`). That is the right base for
  shared dust, wetness and team-mask layers.

### 4.2 GPU compute particles

- **How it works.** `instancedArray(count, 'vec3')` creates storage buffers, `.compute(count)`
  dispatches work, and `renderer.compute()` runs it [S4].
- **What it buys an RTS** (inference). Tens of thousands of debris chunks, sparks, dust motes
  and smoke puffs per explosion with no CPU cost. Particles can collide with the terrain
  heightfield, react to wind, and stay coherent across a large fight. CPU pools cap this at a few
  thousand.
- **Cost** (est.). The compute update for 100k particles is about 0.1-0.3 ms. Drawing is the
  real cost, through overdraw of soft, alpha-blended sprites. Draw them at half resolution and
  composite, as Company of Heroes 2 did to cut the worst-case loss from about 30% to under 4%
  [S7].
- **Caveats.** WebGPU only (§4.0). Keep the flipbook path as the fallback and the visual-gate
  reference. Keep effects on the sim clock for determinism of presentation, but never let them
  feed the sim (invariant 4).

### 4.3 Screen-space AO, reflections and GI

| Node | What it does | RTS value | Cost (est.) |
|---|---|---|---|
| `GTAONode` (`ao`) | Horizon-based ground-truth AO [S8] | High: contact between units and ground, building corners. Roaring Lions already runs GTAO at half resolution on legacy and has an orthographic node variant | 0.5-1.5 ms at half resolution |
| `SSAONode` | Cheaper AO that trades away GTAO's horizon accuracy [S9] | A low-preset option | 0.3-0.8 ms |
| `SSRNode` (`ssr`) | Screen-space reflections [S10] | Low in a top-down desert. Medium on wet maps: puddles and wet roads reflecting fire. Off-screen reflections are missing by construction | 1-3 ms |
| `SSGINode` (`ssgi`) | Screen-space GI. Medium preset is 3 slices × 8 steps, high is 4 × 12 [S11] | Low to medium: sunlit sand bouncing warm light into shaded walls and hull sides. A hemisphere ground colour already fakes much of it | 2-6 ms; noisy, needs temporal filtering |
| `TRAANode` (`traa`) | Temporal reprojection AA [S12] | Pairs with SSGI and stops vegetation shimmer (§4.11) | 0.3-0.8 ms, plus ghosting on fast units |

Notes:

- The `PostProcessing` class became `RenderPipeline` in r183, and node `resolution` options became a
  scalar `resolutionScale` in r180 [S13] (third-party; verify against the release notes).
- Apply AO to indirect light only, not to the sun (`materials-and-lighting.md` §6). A
  post-process AO that multiplies the whole frame also darkens sunlit ground (inference).

### 4.4 Fog, haze and light shafts

- **Height and distance fog** is the RTS workhorse: cheap, and it sets depth and mood. Roaring
  Lions has a far term and a low-lying term inside its fog pass (`terrain-rendering.md`).
- **Volumetric fog** (froxels or ray-marched volumes) gives light shafts through smoke and dust at
  dawn and dusk (inference). At a 30° camera elevation shafts are mostly seen side-on, and they
  read best with a low sun. Cost (est.) is 1-4 ms for a coarse froxel grid with temporal
  reprojection, and it needs compute to be efficient, so WebGPU only.
- **A cheaper screen-space alternative** (inference). Radial blur of an occlusion mask from the
  sun's screen position, at quarter resolution, costs about 0.3-0.8 ms (est.). In a dimetric view
  the sun is often off-screen, which limits it.
- **Gameplay rule.** Haze must never hide a unit the sim says is visible. Cap haze opacity at
  combat range (inference; principle P3).

### 4.5 Contact shadows

- **Screen-space contact shadows** march a short ray toward the light in the depth buffer to
  restore small shadows the shadow map misses: under a soldier's feet, below a track skirt
  (inference).
- **RTS value.** Medium for infantry at 25 px, where a two-pixel contact shadow anchors the figure
  to the ground. A view-fitted 4096² map at about one texel per screen pixel already gets close
  (Roaring Lions: `shadow-fit.ts`).
- **Cost** (est.). About 0.3-1 ms at full resolution, less at half. A per-unit blob or decal under
  infantry is the zero-cost alternative. Roaring Lions deleted its blob shadows when it went lit,
  so restoring one would need the lead.

### 4.6 Decals

- **Deferred-style projected decals** (box projection into depth) let craters, scorch, tracks and
  blood follow any surface (inference).
- **Roaring Lions** uses a pooled ground decal stamped as an albedo RATIO and multiplied onto the
  lit ground, aged on the sim clock, with crater-rim normals (`renderer.md`). That is a good
  design. The cheapest next step is **vehicle tracks**: a strip of decals or a persistent
  top-down track texture, as Company of Heroes 2 does in snow [S7]. The cost is texel density and
  persistence (the slides list both as drawbacks [S7]).

### 4.7 Instancing and BatchedMesh at scale

- **`InstancedMesh`** draws one geometry many times. **`BatchedMesh`** draws many geometries
  that share one material in one batch. Limits: capacity is fixed up front, every geometry must
  match the first's attribute layout, negative scale is not supported, and per-object frustum
  culling and sorting are on by default [S14].
- **The multi-draw caveat.** On ANGLE/Metal, `multiDrawElementsWEBGL` behaves as one draw per entry.
  Roaring Lions measured chunking its decor BatchedMeshes as a 0.2-1.8 ms loss, and turning off
  their per-instance cull as 4.3 ms worse (`CLAUDE.md`, ground and terrain). Instancing pays for
  identical meshes; batching pays only where the driver gives real multi-draw. Measure per
  backend.
- **Skinned meshes do not instance.** That is the infantry draw-call ceiling of about 1,150
  figures (`CLAUDE.md`, scaling debts), and the reason for §4.9.

### 4.8 Height-based terrain blending

- Plain alpha splatting gives "rather unnatural" transitions [S15]. Height blending treats each
  layer's weight as a height, modulated by that texture's own height map, and draws the highest,
  blending only where heights are close [S16], [S17]. The result: sand settles into the cracks
  between stones, and grass grows in tufts at its edge.
- **Cost.** One extra texture channel per layer (often the albedo alpha) and a few ALU ops. Near
  zero.
- **Caveat.** It favours the high parts of each texture, so low-lying detail shows less often [S18].
- **Roaring Lions** already applies a height bias and rescale in its ground blend
  (`HEIGHT_BLEND`, `terrain/ground-maths.ts`). Tuning its contrast per pair of slots is the cheap
  win (inference). Ground textures are ratios (`NoColorSpace`), so a height channel must not
  change their mean.

### 4.9 Vertex animation textures for crowds

- **VAT** bakes each vertex's animated position (and normal) per frame into a texture. The
  vertex shader reads it, so animated figures can instance like static meshes (inference; the
  standard technique).
- **Blender tooling.** OpenVAT is a Blender extension that bakes VATs from any deforming motion
  (armatures, shape keys, simulations) and writes the texture plus a JSON sidecar of bounds [S19].
  Check its licence before use: listings disagree between GPL-3.0 and GPL-2.0-or-later [S19].
  Adopting it needs the lead.
- **Cost.** One texture fetch per vertex per frame. Memory is vertices × frames × 8 bytes for a
  half-float RGBA position. For a 2,500-triangle figure with about 1,500 vertices and 300 frames
  of clips, that is about 3.6 MB per team before normals (est.).
- **Caveats.** Blending between clips needs two fetches. Ragdolls and procedural aim no longer
  work. The pass must also feed the outline, shadow-depth and AO passes, or they show the rest
  pose. Roaring Lions' L4 spec already lists this as a gate.

### 4.10 LOD and impostors

- **Mesh LOD** swaps a decimated mesh by screen size. Roaring Lions swaps its backdrop kit to LOD1
  below zoom 0.6.
- **Octahedral impostors** bake a mesh from many directions into an atlas and draw it on a quad
  [S20]. There are three.js implementations, including one demo of 200k trees [S21]. A new
  library needs the lead.
- **RTS value** (inference). Low at Roaring Lions' bounded zoom: units are near full size at
  every zoom. High only for distant backdrop foliage and props, or if a strategic zoom is ever
  added (principle P7).

### 4.11 Anti-aliasing

- In Iron Harvest's benchmark, FXAA blurred, SMAA left vegetation shimmering, and TAA was best
  but soft [S22]. Roaring Lions ships SMAA on high and medium.
- **RTS value.** Medium: shimmer on swaying foliage and thin barrels shows at 25-125 px. TRAA on
  the node path (§4.3) is the candidate, with a check for ghosting behind fast units and
  projectiles (inference).

### 4.12 Summary table

| Technique | Visible gain for an RTS | Cost (est.) | Backend | Notes |
|---|---|---|---|---|
| TSL shared material layers (dust, wet, snow, team mask) | High | ~0 ms; program count | Both | Needs the node port |
| GPU compute particles | High (explosions, dust, debris) | 0.1-0.3 ms update, plus overdraw | WebGPU only | Keep flipbooks as the fallback |
| Vehicle tracks and ruts (decals or a track map) | Medium to high | Low | Both | Already has a decal pool |
| Height-blend tuning | Medium | ~0 | Both | Already has `HEIGHT_BLEND` |
| GTAO | Medium (already shipped) | 0.5-1.5 ms | Both | |
| TRAA | Medium (shimmer) | 0.3-0.8 ms | Node path | Ghosting risk |
| Volumetric dust shafts | Medium at dawn and dusk | 1-4 ms | WebGPU (compute) | Gameplay haze cap |
| Contact shadows | Low to medium | 0.3-1 ms | Both | |
| VAT crowds | Performance (more figures) | Memory | Both | L4 plan |
| SSGI | Low to medium | 2-6 ms | Node path | Noise, needs TRAA |
| SSR | Low (medium on wet maps) | 1-3 ms | Node path | |
| Impostors | Low at bounded zoom | Low | Both | New library |

---

## 5. The Blender side

### 5.1 Modelling for RTS

- **Bevels that catch light** (inference, standard practice). A hard 90° edge on a lit box draws
  no highlight. A bevel turns the edge toward the sun and gives a one-pixel bright line that
  defines the form at 25-125 px. Rules:
  - Bevel width should be about one screen pixel at default zoom. For a vehicle at about 15-20
    px per metre that is 3-6 cm. Use 1-2 cm for infantry kit (est.).
  - Two or three segments are enough. Use **weighted normals** (the Weighted Normal modifier, face
    area mode) so the large flat faces stay flat-shaded and the shading gradient sits in the
    bevel.
  - Bevel the edges the camera sees: the top and the camera-facing sides (`+X`/`+Z` in the style
    bible's convention). Skip the underside.
- **Polycount per class.** Use the style bible's caps (§3): infantry figure 2,500, team file 8,000
  including weapons, light vehicle 8,000, wheeled APC 10,000, prop 120-400, building 20,000.
  Rendering is draw-call bound, so the caps serve download size and clean shapes.
- **LODs** (est.). LOD1 at about 50% of the triangles for the strategic end of the zoom range,
  LOD2 at about 25% if a far zoom exists. Decimate with the **Planar** or **Collapse** method
  under silhouette protection. The style bible's lesson stands: plain decimation to 120-400
  collapsed thin shapes, and a remesh at the target in Meshy gave clean ones, so Blender trims at
  most about 10%.
- **Thin parts.** At 25 px an antenna or rifle is one pixel or less. Thicken it to about 1.5-2 px
  at default zoom or accept that it disappears (inference). Selective exaggeration, not uniform
  scale (`readability-and-direction.md` §4).

### 5.2 Baking

- Baking runs in Cycles. The types include Combined, Ambient Occlusion, Shadow, Position, Normal,
  UV, Roughness, Emit, Environment, Diffuse, Glossy and Transmission, with "Selected to Active",
  a cage, extrusion or a maximum ray distance, and margin [S23] (reference page; the fetched excerpt
  was truncated).
- **AO.** Bake a short-distance cavity AO, about 2-5 cm for vehicles (est.). It goes into the glTF
  occlusion channel (§5.4), never into the base colour. The runtime GTAO does large-scale
  occlusion (`materials-and-lighting.md` §6).
- **Curvature.** Blender has no curvature bake type. Bake one through the Combined or Emit pass
  of a material built from the Geometry node's **Pointiness** (Cycles) or from a Bevel-node normal
  difference. Use it to drive edge-wear masks, then bake the masks into the texture or keep them
  as data for a runtime wear term (inference).
- **Normal maps.** Bake tangent space in the OpenGL convention (+Y green), which is glTF's
  convention, and save as Non-Color (inference from the glTF spec convention). At RTS distance,
  see `materials-and-lighting.md` §7 before spending memory on them.
- **Determinism.** Fix the Cycles seed and the sample count. Never use `mathutils.noise`, which
  Blender 5.2 randomises per process (house rule).

### 5.3 Colour management

- **View transforms.** AgX replaced Filmic as Blender's default in 4.0, with "bright colors go
  towards white, similar to real cameras" [S24]. Khronos PBR Neutral is offered for product
  shots where HDR values are mostly limited to small highlights [S25] (manual snippet). Standard
  applies no tone mapping [S25].
- **The view transform affects only what is displayed and rendered, not texture data.** A base
  colour texture is authored data. Paint and bake it so the stored values are the intended
  albedo, judged in a view that does not distort them (inference).
- **Matching three.js's ACES output.** Blender does not ship three.js's ACES fit, so its AgX
  preview will not match the game. Two options (inference):
  1. Render the look-dev scene with **Standard** to a linear EXR, then apply three.js's
     `ACESFilmicToneMapping` function in a Python post step, with the same exposure, to get a
     PNG that matches the game's output transform.
  2. Judge albedo under **Standard** with a grey ball and chart in frame
     (`materials-and-lighting.md` §14). Judge the final look only in the game.
  Never approve an asset from an AgX or Filmic Blender render: both desaturate bright colours
  differently from the game's ACES.
- **Image colour spaces.** Base colour is sRGB. Roughness, metallic, AO, normal and every mask are
  Non-Color [S26].

### 5.4 glTF export

- **Packed ORM.** glTF expects metallic in blue and roughness in green of one image, and occlusion
  can go in red of the same image [S26].
- **Occlusion routing.** The exporter takes the image connected to the Occlusion input of a node
  group named **"glTF Material Output"**. Blender itself does not use the baked AO in shading; the
  group exists only so the exporter can write it [S26].
- **Non-Color** on every data image [S26].
- **Other settings** (inference, standard practice): apply modifiers (except the armature), +Y up
  (the exporter default), export only the selection or a named collection, write actions as
  separate glTF animations with stable names (Roaring Lions reserves `idle`/`wreck` for vehicles
  and `idle, move, fire, down, wreck` for teams), keep node names and `extras` (the project reads
  `rl_role` from them), and leave compression to the project's `encode:meshes` pass.
- **Zero materials** on non-exempt Roaring Lions GLBs. Colour comes from the runtime role ramp.
  Only the named textured exemptions ship a material (`CLAUDE.md`, mesh units).

### 5.5 Headless Blender

- Run `blender -b --factory-startup -P script.py -- --arg value` (inference; standard command-line
  form). `--factory-startup` ignores user preferences and add-ons, so runs are reproducible.
  Arguments after `--` reach the script through `sys.argv`.
- **Determinism.** Seed every random source, and hand-roll noise (house rule). Use CPU Cycles for
  reference renders that must be byte-stable across machines. EEVEE needs a GPU context, and
  headless EEVEE depends on the platform (inference).
- **Fail loudly.** Exit non-zero on any missing object, role or clip, and print what was written.
  Roaring Lions' harness rule is "scripts must exit".
- **Never write into the repo's `assets/sprites/`.** The sprite renderers refuse to
  (`tools/sprites_retired.py`).

### 5.6 A look-dev scene that mirrors the game

The goal is a Blender scene that lights an asset as the game will, so it can be judged before
export. All of this is inference from the project's constants and three.js's light conventions.

- **Units.** three.js (r155 and later, physical lights) treats a `DirectionalLight` intensity as
  irradiance and a Lambert surface as albedo/π. Blender's Sun strength is irradiance in W/m², and
  its diffuse is also albedo/π. So **Blender Sun strength = the game's sun intensity** (day 2.6,
  dawn 2.0, dusk 1.8; `time-of-day.ts`). The project's own haze note uses the same
  `(sunIntensity · sun.y + hemiIntensity) / π` factor (`terrain-rendering.md`).
- **Sun direction.** Point the sun along the game's `SUN_DIRECTION` `(-0.406, 0.819, 0.406)`
  (three.js Y-up), converted to Blender's Z-up. Do **not** reuse `build_lights`' rig rotation,
  which the project documents as wrong (`CLAUDE.md`). Dawn and dusk use their own elevation (22°
  and 18°) and azimuth offsets (−35° and +35°).
- **Sky.** A uniform world of radiance L gives an upward surface irradiance πL. To match a
  hemisphere intensity H with sky colour C, set the world to colour C and strength **H/π**:
  0.82/π ≈ 0.26 on day, with the census-solved values 0.70 / 0.82 / 0.65 for dawn / day / dusk
  (`environment-classes.ts`). A world shader that mixes zenith (the preset's sky key), horizon (its
  sun key) and ground (`dust.4`) by the incoming vector's Z mirrors the game's sky gradient
  (`environment.ts`).
- **Per-class environment.** The game scales the environment per material class (unit metal 0.6,
  dielectric 0.3, building 0.2, ground none). Blender cannot scale the world per material, so add a
  look-dev variant per class, or accept that Blender shows the full environment and judge
  reflections in the game (inference).
- **Camera.** Orthographic, 30° elevation, azimuth 225°, framed so the asset's pixel size matches
  the game's default zoom. Add a second camera at the closest zoom.
- **Output.** Render with Standard to linear EXR, then apply three.js's ACES fit at exposure 1.0
  (§5.3).
- **In frame.** The grey ball, chrome ball and colour chart (`materials-and-lighting.md` §14), the
  palette swatch board, a patch of ground in the theme's tone, and the class reference asset.
- **Approval.** These renders are for the art numbers the lead approves before any Meshy call
  or production render. They are not a substitute for the in-game check.

---

## Sources

- [S1] web.dev, "WebGPU is now supported in major browsers" — https://web.dev/blog/webgpu-supported-major-browsers
- [S2] Secondary summaries of browser support (Firefox platforms, Chrome on Android) — https://app.cinevva.com/guides/webgpu-vs-webgl-games and https://www.youngju.dev/blog/culture/2026-05-16-webgpu-wgsl-ecosystem-2026-chrome-safari-firefox-wgpu-naga-tint-three-js-babylon-webllm-transformers-deep-dive.en
- [S3] three.js manual, WebGPURenderer — https://threejs.org/manual/en/webgpurenderer.html
- [S4] three.js wiki, Three.js Shading Language — https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language
- [S5] Maxime Heckel, "Field Guide to TSL and WebGPU" — https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
- [S6] three.js forum, "WebGPURenderer(forceWebGL=true) vs WebGLRenderer" and "TSL and webgl2 vs webgpu" — https://discourse.threejs.org/t/webgpurenderer-forcewebgl-true-vs-webglrenderer/87805 and https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974
- [S7] Daniel Barrero, CoH2 rendering technology — https://www.slideshare.net/proyZ/daniel-barrero-coh2renderingtech
- [S8] three.js docs, GTAONode — https://threejs.org/docs/pages/GTAONode.html
- [S9] three.js docs, SSAONode — https://threejs.org/docs/pages/SSAONode.html
- [S10] three.js docs, SSRNode — https://threejs.org/docs/pages/SSRNode.html
- [S11] three.js docs, SSGINode — https://threejs.org/docs/pages/SSGINode.html
- [S12] three.js manual, post-processing with WebGPURenderer — https://threejs.org/manual/en/webgpu-postprocessing.html
- [S13] Third-party notes on r180 and r183 changes — https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/webgpu-threejs-tsl/docs/post-processing.md and https://app.cinevva.com/de/news/2026-03-18-threejs-r183-render-pipeline
- [S14] three.js docs, BatchedMesh — https://threejs.org/docs/pages/BatchedMesh.html
- [S15] Wikipedia, Texture splatting — https://en.wikipedia.org/wiki/Texture_splatting
- [S16] Andrey Mishkinis, "Advanced Terrain Texture Splatting" — https://www.gamedeveloper.com/programming/advanced-terrain-texture-splatting
- [S17] jMonkeyEngine forum, improved terrain splatting — https://hub.jmonkeyengine.org/t/improved-terrain-splatting-and-parallax-mapping/27844
- [S18] Jason Booth, "Stochastic Texturing" — https://medium.com/@jasonbooth_86226/stochastic-texturing-3c2e58d76a14
- [S19] OpenVAT on Blender Extensions — https://extensions.blender.org/add-ons/openvat/ (repository: https://github.com/sharpen3d/openvat)
- [S20] Octahedral impostor write-ups based on Ryan Brucks' method — https://smailikhappy.github.io/posts/Octahedral_imposters/
- [S21] three.js forum, "A forest of octahedral impostors" — https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735
- [S22] ComputerBase, Iron Harvest benchmark (AA comparison) — https://www.computerbase.de/2020-09/iron-harvest-benchmark-test/
- [S23] Blender manual, Cycles baking — https://docs.blender.org/manual/en/latest/render/cycles/baking.html
- [S24] Blender 4.0 release notes, colour management — https://developer.blender.org/docs/release_notes/4.0/color_management/
- [S25] Blender manual, colour management (4.5) — https://docs.blender.org/manual/en/4.5/render/color_management.html
- [S26] Blender manual, glTF 2.0 add-on — https://docs.blender.org/manual/en/4.1/addons/import_export/scene_gltf2.html
- Project facts (read-only, `origin/main` on 2026-11-09): `CLAUDE.md`, `docs/agent-notes/webgpu-backend.md`, `renderer.md`, `terrain-rendering.md`, `docs/art/style-bible.md`, `packages/render/src/three/time-of-day.ts`, `environment.ts`, `environment-classes.ts`.
