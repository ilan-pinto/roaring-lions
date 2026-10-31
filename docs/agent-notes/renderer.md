# The three.js backend: rules, history and measurements

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 368-374, section "The three.js backend" -->

- **The render quality preset** (`packages/render/src/quality.ts`) is
  `high` / `medium` / `low`, applied at the next mission's BOOT, not live.
  `high` is pinned to the constants that existed before the preset and every
  parameter defaults to it, so the golden baselines did not move; `low` drops
  GTAO and SMAA and halves the shadow map. Since Defilade T4 `high`
  also builds a quarter-resolution bloom; `medium` and `low` build none (D8; `medium` off by
  the lead's ruling of 22 Oct pending a GPU-timer measurement).

<!-- CLAUDE.md lines 632-917, section "The three.js backend" -->

## The three.js backend

**The only renderer since WP-A3.3 (2026-10-04).** The default since Phase D;
the PixiJS backend (`renderer.ts`, `?renderer=pixi`), the `&nomesh` billboard
path, the sprite sheets and the cross-backend harnesses are deleted. The seam is
`packages/render/src/api.ts`, and `main.ts` holds a `Renderer`, never the
concrete class — so the compiler, not a grep, keeps `app` off backend-only
members. three.js arrives by dynamic import from its own entry point, so the
shell paints before it loads. Every VFX is three-only by construction now, and
many comments under `packages/render` still say "ported from `renderer.ts`" or
"Pixi ignores it": those are history. A unit whose GLB fails to load (or a
vehicle GLB with no `wreck` clip, which `loadVehicleMesh` refuses) draws as a
team-coloured proxy box at its footprint beside a `console.error` naming the
file (`units/proxy-box.ts`) -- never as nothing. A deferred buildable whose GLB
is still in flight draws nothing until it lands, and its dock tile says
"deploying" (the lead's ruling, A3.3).

**Design and outcomes** are in `docs/superpowers/specs/`: the migration design
(`2026-08-26-three-renderer-design.md`), the palette GO/NO-GO
(`2026-08-26-phase-0-verdict.md`), phase outcomes B1-B4, the rigged-infantry
design (`2026-08-28-rigged-infantry-design.md`), its verdict
(`2026-08-28-phase-r0-verdict.md`), and the pinned mesh contract
(`2026-08-28-mesh-unit-contract.md`). Read the outcome doc for the phase before
yours; each one records what the next phase inherits.

**Rules specific to this backend, each of which has already cost a bug:**

- **There is no kit mark in the world, on purpose.** A steel plate over the HP
  bar in `OverlayBatch` (plan 2, Tasks 1–3, measured at +0 draw calls) was
  built and shown to the lead at the picture gate, who rejected it on sight:
  *"The mark is ugly maybe it should only show on the icons."* It was reverted
  in a follow-up commit (`38fe0075`), and `packages/render` is `main`'s bytes
  again. Kit reads on the unit ICONS instead — selection chips, the HUD unit
  card, dock tiles, the garage rail — through `kitIconSignHtml`, fed by
  `upgradePrepass.unitKit`. The sign is DOM, not canvas (which is why it drew
  identically on both backends while there were two). Do not reintroduce a world overlay for kit without the lead.
  The glyph on those icons is not the garage bay's own plate-with-bars mark —
  the lead reopened it at G-P2 and settled on 1–3 steel Stars of David with a
  per-level chip border tint (G-P3, `docs/superpowers/plans/2026-09-27-garage-kit-on-icons.md`),
  drawn as SVG rather than a Meshy render so it stays crisp at 8–10 px.
- **`three` may only be imported under `packages/render/src/three/**`**, enforced
  by eslint in `packages/render/src` and `packages/app/src` (non-test), subpaths
  like `three/addons/loaders/GLTFLoader.js` included (a `three/*` pattern beside
  the `three` path, since #574 step 3; before it `packages/app` was not covered
  at all and subpaths were "discipline"). `tools/` is not covered and imports
  three for its harnesses.
- **The colour pipeline is the standard one since Phase 0 (2026-09-14).**
  `renderer.outputColorSpace = SRGBColorSpace`, ACES tone mapping at exposure
  1.0 applied in the composer's `OutputPass`, and every world material a
  `MeshStandardMaterial` (`units/world-materials.ts`, and `terrain/mesh.ts`'s
  `GroundMaterial`/`GroveMaterial`). One sun plus one hemisphere bounce in
  `lighting.ts`, with a 4096² orthographic shadow box that **follows the
  camera** (GH-705, `shadow-fit.ts`, `shadowFit: 'view'` on every preset): refit
  each frame to the view's receivers, its SIZE a function of zoom alone and its
  centre snapped to whole texels, so panning does not crawl; about one screen
  pixel a texel from zoom 0.5 up, where the old once-per-map box was 1.9-6.4.
  Its depth stays the map-wide box's, so off-screen casters still cast, and
  `photographGround` (the minimap) takes the map-wide box. Crater decals carry a
  procedural rim normal lit by the sun, sky and shadow map (`decal-pool.ts`
  `craterHeight`, the `crater-rims` debug layer). **The sun is a SIDE light — `SUN_DIRECTION` `(-0.406, 0.819, 0.406)`,
  the render rig's stated azimuth 135° at altitude 55°, which is the CAMERA'S
  LEFT** (the camera sits at 225° in `dimetric.py`, so its right-hand vector
  points at 315°). The X and Z signs DIFFER and that is the point: a box's
  screen-left face is lit, its screen-right face falls to hemisphere light
  alone, and shadows land on the ground beside a caster instead of straight
  up-screen inside its own silhouette. Do **not** re-derive it from
  `build_lights`' lamp — `rotation_euler = (90−55, 0, 135)` yaws a beam
  already tilted toward `+Y` and puts the light source at 45°, behind the
  subject; that rig convention bug is why every retired sprite sheet had a
  bright top over two equally dark sides (`BLD_WALL` is `limestone.0` on top and
  `limestone.7` on BOTH flanks, identical to the byte -- the sheets are gone
  since WP-A3.3, the rig is not). Settled by the project
  lead on 2026-09-15; `lighting.ts`'s header and the spec's Deviations entry 3
  carry both retired alternatives with their measurements.
  The frame goes through `post-chain.ts`: `RenderPass → FogOfWarPass →
  WorldGTAOPass (half resolution) → bloom (quarter resolution) → OutputPass →
  SMAAPass`; AO, bloom and SMAA are present or not by preset. The corner vignette is
  not a pass: it is the last statement of `OutputPass`'s shader (`vignette-pass.ts`, GH-829),
  pixel-identical to the pass it replaced only because it rounds through half float first. Fog of war is
  `shroud-texture.ts` + `fog-pass.ts` — a depth-reading post pass, not
  geometry. A muzzle flash is a pooled `PointLight` (`units/flash-light.ts`),
  not a ramp-index shift. `applyPalettePipeline`, `paletteColorNoConvert`, the
  toon ramp materials, the blob shadows and the black fog quads are all
  deleted. Ground decals (`decal-pool.ts`) are albedo RATIOS: each decal's
  colour is divided by the ground tone under THAT FRAGMENT and MULTIPLIED
  (`DstColor * SrcColor`) onto the lit ground, so a crater lip in a building's
  shadow stays in shadow. The divisor has two halves: the tile's own palette
  tone, stamped per decal (`terrain/decal-ground-tone.ts`, `decalBaseTone`),
  and the road and its shoulder, mixed in PER FRAGMENT from the ground's own
  control B through the ground material's shared uniform objects (fix wave
  I-3; `decalRoadMix` is the TypeScript mirror). Dividing by the map's one
  open tone was wrong on every green map (a salmon lip on a dust road, red
  tyre prints on grass); dividing by the road at a crater's CENTRE was wrong
  on every road crater, because the lip ring (0.34-0.60 tile out) lies on the
  road's edge and shoulder -- it drew blue-white, blue multiplied eightfold.
  A decal straddling two TILE tones still divides both by its centre tile's;
  that part is accepted. A pale mark is a ratio above 1, so decals need the composer's
  **HalfFloat** scene target; **the raw-renderer path without the composer is
  not supported** -- an 8-bit target clamps the source to 1 and every pale lip
  disappears.
  **Two rules survive and both still cost a bug if broken.** Vertex colours
  and shader-uniform colours must be LINEAR — `hexToLinear`, and `toGeometry`
  decodes on the way in — because nothing between them and the frame buffer
  will decode them for you. And **ground albedo textures stay `NoColorSpace`**
  while every base-colour map in the game is `SRGBColorSpace`: they are not
  colours, they are a ratio to their own measured mean
  (`terrain/surface.ts`'s `SURFACE_SHADING_EXEMPTION`), and decoding a ratio
  bends the mean it is taken against.
  **The per-pixel palette guarantee is retired, deliberately.** It was never
  protecting much: measured on `main`, a real frame was **24.5%** exact
  palette colours at the force close-up and **11.3%** in a town fight, across
  29,705 and 52,227 distinct colours against a 56-entry palette — so a rule
  that forbade antialiasing, blending, lights, shadows and tone mapping was
  costing the other 75–89% of the frame everything a lit renderer needs. The
  argument and the nine captures are in
  `docs/superpowers/specs/2026-09-14-lit-renderer-design.md`; the palette is
  still the source of every AUTHORED colour (`docs/ART_PIPELINE.md` §2), and
  `pnpm validate:ui` and `pnpm validate:meshes` hold it (`validate:assets`, the
  sprite gate, was retired with the sheets in WP-A3.3).
- **Unit surfaces take per-role roughness/metalness** (`units/unit-surface.ts`,
  GH-705 Task 6, ruled 23 Oct 2026). The GLB's one material is cloned once per
  surface class (cloth, gunmetal, rubber, ...): +0 draw calls and textures,
  +0 programs except one permutation where a metal class drops an MR map. The bakes' own MR maps are flat (roughness 0.797, metal ~0.004), so
  this is the only source of contrast. Metal is capped at 0.45: there is no
  environment map, so a metal surface keeps only the sun's lobe. The
  `unit-surface` debug layer restores today's values; its floors are in
  `golden-diff/baseline.ts`. A scar or running-gear clone keeps the values it was cut with.
- **`units/render-order.ts` is the single source of truth for every
  `renderOrder`.** Read it before setting one. Bands are: **-1 world (mesh
  buildings)**, 0 hull/structures, 0.5 selection ring, 1 turret, 1.5 badge numeral, 2 FX,
  2.5 FX additive, 3 FX-above, 3.5 FX-above additive, 4 overlays, 5 smoke,
  **6 occlusion silhouette**, 7-9 reserved. **Band 10 is retired** — fog of
  war was `FogMesh`, one black quad per unseen tile at the top band, and it is
  a post pass now, so nothing in the scene draws at 10 and "must sit below the
  fog band" no longer constrains anything. The overlay tier sits where it
  does as history: it matched the retired Pixi backend's paint order, and
  nothing has needed it to move. Band -1 is the only one whose value changes
  anything for an OPAQUE mesh, where the depth buffer normally makes
  submission order irrelevant. It was added for the occlusion silhouette's
  stencil mask, back when that silhouette was a solid FILL and a unit body
  stamped the mask only where its fragment WON the depth test -- true only
  once the world had already drawn, and three.js sorts the opaque queue by
  `material.id` BEFORE `z`, so at band 0 the draw order between a unit and a
  building was decided by which GLB finished loading first (measured on
  `beit_sahwan_outskirts`: unit materials 164-167, building materials
  246-250, so units drew first and a tank behind an apartment silhouetted as
  a few slivers). **The outline retired that dependency**: the mask now means
  "a unit's footprint covers this pixel" and is stamped on `stencilZFail`
  too, so no draw order can falsify it. The band stays -- still correct,
  still free, still where a future opaque occluder belongs -- but it is no
  longer load-bearing.
  **The ground decals have two named aliases, not bands of their own.**
  `DECAL_PERSISTENT_RENDER_ORDER` = `WORLD_RENDER_ORDER` (-1) carries
  craters, scorch, oil and rubble; `DECAL_FADING_RENDER_ORDER` =
  `TRAIL_RENDER_ORDER` (= `HULL_RENDER_ORDER`, 0) carries tread and tyre
  prints, so a fresh print lies over an old crater and never over a unit.
  Set them by those names: a "fix" that moves either into an FX band paints
  the mark over the unit standing in it.
- **The occlusion silhouette is an OUTLINE, not a fill** (`units/silhouette.ts`).
  An inverted hull -- the merged silhouette geometry pushed out along a welded
  per-vertex normal by a constant 2.5 SCREEN pixels at any zoom -- with the
  interior punched out by the footprint stencil above. Three things about it
  are counter-intuitive and were each measured, not reasoned. `side` must be
  `BackSide` on the mesh path: `FrontSide` only widens the silhouette where a
  face's normal is perpendicular to the view, which is a razor-thin set of
  grazing triangles half of which are culled, and it photographs as broken
  squiggles rather than an outline. The width must be constant in PIXELS, not
  world units, because `main.ts` clamps zoom to 0.35-2.5. And it is applied in
  the GLB's own object space, so it needs multiplying by `MESH_UNITS_PER_TILE`
  to undo `MESH_SCALE` -- forget that and the outline is a third as thick as
  asked for, which looks plausible and is wrong. (A billboard path dilated
  the atlas alpha instead, with a fixed 0.75 world-unit bias; it went with
  the billboards in WP-A3.3, and its recorded defect -- 75-432 false px along
  a billboard Lavi's hull base -- went with it, retired rather than fixed.)
  Costs no extra draw call over the fill: measured +24 on 310, both ways.
- **Own units in smoke keep their outline** (GH-705, the lead's ruling 23 Oct 2026;
  `units/smoke-outline.ts`, `ThreeRenderer.stepSmokeOutlines`). A living, visible unit of
  the VIEWER's side on a tile with `sim.smokeAt` >= 48/255 (`SMOKE_OUTLINE_MIN`) has its
  silhouette meshes swapped onto a `depthTest: false` copy of the team material, so the
  ring draws at band 6 over the smoke (band 5); enemies never get it, smoke is cover.
  +0 draw calls. **Infantry wear a thinner ring**: 2.5 px tapers to 1.5 px between zoom 1
  and 2 (`infantrySmokeOutlinePx`), because a 2.5 px ring measured 5.0 device px at DPR 2
  and was 32% of a kneeling figure's area; 1.5 px reads 3.0 device px and 23%. Vehicles
  keep 2.5; the behind-building silhouette is unchanged for everyone. Hiding `overlays`
  hides these materials too. The witness is `pnpm smoke-outline:capture` (no gated golden
  scenario lays smoke): the `smoke-outline` toggle A/B must clear a third of the smallest
  of three runs (dense and thin smoke at zoom 1 and 2.5, floors in its source), the quiet
  frame must read 0 px, and hidden `overlays` must read 0 px; it exits 1 otherwise.
- **The smoke screen is a lit, standing billboard** (GH-705 smoke uplift P1;
  `smoke-mesh.ts`). It was a flat feathered disc lying on the ground with
  `depthTest: false`; each puff is now a camera-facing quad that stands on the
  ground (`SMOKE_STAND` 0.9), samples the flipbook's smoke atlas and is lit by the
  same sun (`setLook`), `depthTest` on so terrain and buildings hide it. The quad's
  foot fades out (`smoothstep(-1.0, -0.55, vUv.y)`) so it never shows the depth test's
  hard cut on the ground; `smoke-mesh.test.ts` pins that from `VIEW_DIRECTION`.
  `RenderQuality.fxDetail` (low 0 / medium 1 / high 1; `high` also draws `smokeBillboardGain` 0.8) compiles its noise down.
  Debug layer `smoke-screen` is a flag on `SmokeMesh`; its witness is
  `blast:capture`'s `smoke_eitan` (an opt-in layer: only that subject runs it).
- **Every shot draws a travelling projectile; no line spans the gap any
  more** (PR #342, 2 Oct 2026, the lead: "no need for the straight lines").
  `units/shells.ts` is the whole model — `mortar`/`rocket` arc (GH-145),
  `bolt` (`apfsds`, `autocannon`) flies a short flat streak (GH-149), and
  since #342 `small_arms` and `hmg` fire bursts of short streaks too (rifle
  2 a burst, mg 3; numbers in the PR) instead of `TracerBatch`'s full-span
  ribbon. Who shoots whom is shown by a pulse ring contracting onto the
  selected unit's target, a red outline flash on each hit, and "Engaging:
  <enemy>" on the unit card; the old duel line is deleted. Three things about
  this are worth knowing before touching it. **The flat tracer was never
  absent from direct fire** — the complaint "direct fire has no visible
  projectile" is literally false and substantially true: photographed at
  `ad7ac3d`, a Lavi's `gun_120` drew two dead-straight lines that spanned the
  whole gap on frame 0, did not move for seven more frames, and faded. It was
  a laser that dimmed. **The brief's "~4 frames" was argued down with a
  frame-for-frame A/B and the shipped bolt lives ~13** (30 tiles/s over the
  6.7-tile engagement range measured on `beit_sahwan_outskirts`): at 4 frames
  the streak is longer than its own travel, so it reads as one shape that
  flashes — the identical failure, shorter. **There are two `ShellBatch`
  instances**, and they differ in exactly three things, none per-shell:
  `depthTest` (off for the arc, which flies 88 lift px up and was measured
  drawing behind a one-storey house; ON for a bolt at 9, where a building in
  front SHOULD hide it and cannot be in the way anyway, since direct fire
  needs LOS), the band (3 vs 2), and the colour pair. Which one a round goes
  to is `SHELL_PROFILES[kind].indirect`, read once through `isIndirectShell`.
  **Since GH-250 a `missile` (`atgm`, `rpg`, `heat`, `he` — the unguided rocket pods) is a `ShellBatch`
  round**: it flies `units/missile-fx.ts` — body, glow and smoke trail, three
  meshes over one flight list. Its flight time is the sim's own, to the tick:
  `PROJ_SPEED` is COPIED into `units/missiles.ts`, never exported, and a test
  pins the copy against `tuning.ts` as text. Top-attack is a named weapon set
  (`TOP_ATTACK_WEAPON_IDS`, today only `spike_atgm`), not a class. The trail
  has its own pool because `ParticleSystem` has no height, and a puff laid at
  apex or rotor height would drop to the ground. The HEAT impact is
  `data/vfx/missile_impact.json`, thrown on the FRAME clock where the round
  visibly lands (the `shellHasLanded` rule), with its light and shake × the
  landing's `scale` (1 for a hit, 0.5 for an APS intercept), not ×
  `impactPower`. `pnpm atgm:capture` is the instrument, with a `missiles`
  toggle floor and a flash reading, and the lead judges its `flip-<id>.html`
  pages, not the stills.
  **A Grad rocket (`rocket`, not `mortar`) lays smoke along its real arc too**
  (GH-85, `data/vfx/rocket_trail.json`): `MissileFx.layShellTrails` puts
  `emitAlongShell`'s puffs into the SAME lifted `TrailPool`, flagged `PUFF_ROCKET`
  so they wear the rocket look, and the same sprite mesh draws them -- no new
  mesh, material or GPU resource, and +1 draw call only while a puff lives (the
  missile sprite mesh was hidden at zero puffs; 0 more if a missile trail is
  already drawing). A mortar bomb is unpowered and leaves none.
- **Bloom and the flipbook (Defilade T4, GH-705, 2026-10-21).** Bloom
  (`three/bloom.ts`) is three's `UnrealBloomPass` slotted after AO and before
  `OutputPass`, on the HalfFloat SCENE-REFERRED buffer: threshold 1.0
  luminance, strength 0.5, radius 0.35 (D1), its targets at a quarter of the
  drawing buffer per axis on `high`/`medium`, absent on `low` (D8). Only an
  effect that is told to exceed 1.0 blooms: the HDR gains live in ONE table,
  `units/hdr-gains.ts` (D2, D9), applied to palette-key colours, never a raw
  hex. `pnpm perf:bloom-census` holds every map's quiet frame under 0.9 (quiet frames only); the
  `bloom` debug layer flips the pass's `enabled`. The flipbook
  (`units/flipbook-fx.ts`) is one GPU-aged instanced billboard pool drawn by
  two meshes: soot and dirt at band 5, depth-tested, and fire at 5.5 with
  `depthTest: false` (see `render-order.ts`). It samples two Blender-baked
  8x8 atlases, `assets/textures/vfx/flipbook_{fire,smoke}.png` (channels are
  DATA: R density, G/B gradient, A heat; `NoColorSpace`, no premultiply),
  made by `tools/vfx/bake_flipbook_atlases.py` with hand-rolled noise, two runs
  byte-identical (D7). Recipes are DATA: an emitter's `flipbook` array in
  `data/vfx/*.json` (five today), and while it spawns it REPLACES the
  emitter's `mesh_burst`, `mesh_plume` and `smoke_puff` layers (D6) on shell
  and missile impacts and vehicle kills. A vehicle kill drops its tan
  collapse shroud for the flipbook's soot column (D5); building and tunnel
  collapses keep theirs. Until both atlases load the old layers draw, so a
  kill never draws nothing. A kill's column is OIL (smoke layer `oil` 0..1,
  a negative tint in the shader, GH-705 P2): near-black soot, a flickering
  ember glow in a young puff's dense lower core, and a sun-side grey crown
  (`FLIPBOOK_OIL_CROWN`); its embers are a fourth layer type, `spark`, an HDR
  ballistic dot in the fire pass (x `HDR_GAINS.sparks`). At `RenderQuality.fxDetail`
  0 (`low`) spark layers are skipped and a layer with `low_fraction` spawns
  `ceil(count * low_fraction)`. Witnessed by `pnpm blast:capture`'s `bloom` and
  `flipbook` toggle floors; see `docs/PERFORMANCE.md`, "Defilade T4", for
  cost and the two open items (the `aftermath` frame's muzzle-light bloom,
  and the unwitnessed muzzle-mesh gains).
- **An arcing round is `vfx.fire`/`vfx.ember`, not `vfx.tracer`** — the new
  `RendererOptions.shellColors`. A landing
  mortar bomb or Grad rocket also throws `data/vfx/shell_impact.json` through
  the same `spawnCollapseFx`/`mesh_burst` path a building collapse uses, at
  `impactPower` 0.3/0.45. That fires off the FRAME clock (`shellHasLanded`),
  deliberately not off the sim's own `impact` event, which resolves on a
  different clock and would put the fireball where the bomb visibly is not.
  Note `screen_shake` in `vfx_emitter.schema.json` is still read by nothing —
  `emitters.ts` types it and no backend consumes it.
- **Overlays scale with zoom, and that is faithful.** HP bars look enormous
  zoomed in, as they did on the retired Pixi backend, which scaled its whole
  `world` container by `camera.zoom` (verified side by side before it went).
  Not a bug; changing it is a design decision.

<!-- CLAUDE.md lines 1209-1215, section "The three.js backend" -->

- **`preserveDrawingBuffer` must stay off** in shipping code. Canvas readback
  therefore returns black — that is correct, not a broken renderer. The
  sanctioned way to photograph the scene from inside the renderer is a RENDER
  TARGET readback (`ThreeRenderer.photographGround`, shell Phase 2 Task 15:
  render into a `WebGLRenderTarget`, resolve it through three's own
  `OutputPass`, and `readRenderTargetPixels` it) — a different buffer, always
  readable, and it needs no `preserveDrawingBuffer` at all.

<!-- CLAUDE.md lines 1554-1587, section "The three.js backend" -->

- **The cross-backend Pixi-vs-three diff is gone** (`golden-diff-gate.ts`,
  `expected-differences.ts`, `pnpm golden-diff:compare`, deleted in WP-A3.3).
  It was report-only from 2026-09-02, when the lead retired its pass/fail
  ("retire cross-backend and rebuild it as three-vs-three") after the mesh
  flip put every scenario 1.8x-2.3x over budget with no regression behind it.
  The one lesson worth keeping: cross-backend could not discriminate the
  scatter defect from its fix at all (1.945% buggy vs 1.937% fixed) while the
  same-renderer comparison separated them 34x -- which is why the gate is
  three against a committed three baseline. Full account:
  `.superpowers/queue/golden-diff-red-report.md`. Capture conditions must still
  be stated with any visual number -- screenshot downscaling and a font-load
  race once read 6.5x high, and the OS mouse cursor can leak into a capture.
- **Selection is a ground ring, and HP bars are conditional (A4, GH-186).**
  The ring is `units/selection-ring.ts`: one mesh at order 0.5, depth-tested but
  not depth-writing, drawn in team colour via `teamColors[side]` (so it follows
  colour-vision variants) with a `shadow.1` halo. Ground vehicles get a
  hull-aligned ellipse centred on the hull box (`ELLIPSE_BY_TYPE`); everything
  else gets a circle (`RADIUS_BY_TYPE`). **Both tables are GENERATED** by
  `tools/src/perf/unit-footprints.ts` -- never hand-edit them. `dozer_d9` is
  forced to `light` by `RING_CLASS_OVERRIDE`. Grid tiers are 4x4, then 6x6 above
  0.72 tile, then 7x7 above 1.28; those thresholds were LOWERED until a ring at
  either boundary buries under 0.02 wu (`ring_burial.test.ts`) -- do not widen
  the 0.02. Rings are cached per slot, keyed by entity id, and rebuilt after
  0.05 tile of movement or 2 degrees of turn; `refreshSurface` invalidates the
  cache. Moving rings on relief cost about 0.9 ms per 100 -- the lead accepted
  it ("Cache + accept", `docs/PERFORMANCE.md`). The fallback flat ring
  (garrisoned units, or overflow) wears the same team colour (VR-34; it took
  the group colour, or lime, until the chrome register). The `overlays` debug
  layer hides `selectionRingGroup`, never the mesh. HP bars draw only for a
  unit that is damaged, selected or hovered, with a 1 px `shadow.1` frame at
  alpha 1.0. **Captures ASSERT no selection and no hover**, so no gated
  scenario photographs a ring or a hover bar: the ring has no gate witness, by
  ruling.

## The rain and the wet light (GH-871 P4)

The wetland's air: `rainLight`, the falling rain, the ladder, reduced motion, the KDF rain rim and the instruments that measure them.
The ground, control C and the ripples are in `terrain-rendering.md` ("The wetland theme (GH-871 P4)"); the as-built record, pins and
cost tables are the spec's section 14. All of it keys on ONE switch, `RendererOptions.weather === 'rain'`; a renderer built without it
never calls into `three/weather.ts`, so a shipped map's light, haze, shadow map and draw list are today's.

- **`rainLight(lights, preset, resolve)` (`three/weather.ts`) is pure and three-free.** It takes the RESOLVED lights (`DAY_LIGHTS` itself for
  day, `presetLights(row)` for dawn and dusk, not a `LightPreset` row: `day` is not built from the table), keeps the sun's DIRECTION (rain
  at dawn is still dawn) and returns the sun x `RAIN_SUN_SCALE` 0.46 in `overcast.0`, the fill x `RAIN_FILL_SCALE` 1.5 (on every preset,
  ruling Q2), the sky key `overcast.1`, `sun.shadow.intensity` `RAIN_SHADOW` 0.45, `hazeFar` `RAIN_HAZE_FAR` 0.26 on every preset, the haze
  key `overcast.1` (it overrides dusk's own `dust.1`) and `hazeLow` `RAIN_HAZE_LOW` 0.10. Open-ground irradiance `(sunI x sun.y + hemiI) / pi`
  goes 0.964 -> 0.741 on `day`. **A mission's `lightOverride` is applied AFTER it: the mission wins.** The constructor builds the Vector3.
  The shadow map steps down once and floors at 1024 (`rainShadowMapSize`: 4096 -> 2048, 2048 -> 1024, 1024 -> 1024); it is the one saving
  the cost budget nets out. `hazeLow` is compiled into the fog pass's source (`createFogPass`, shared by the constructor and the
  `theme-identity` harness), so the shipped fog program is byte-identical. The haze, the rain colours and `uWetSky` all scale by
  `hazeRadiance` of the lights the scene is lit by.
- **The rain is ONE instanced draw** (`units/rain-batch.ts`, `units/rain-maths.ts`), built lazily by the first `frame()` after the terrain
  exists, only under rain and only when the preset's `drops > 0`. Each instance owns a static seed (`dropSeed`) and the vertex shader ages
  it from a time uniform; the base geometry holds a STREAK quad and a SPLASH quad, so a drop and its ring are one instance. The shader is a
  GLSL copy of `rain-maths.ts` built from the same exported constants, never retyped literals. Fall 4.0 wu/s through 6 wu, slanted 12
  degrees down-wind on the foliage sway's axis; a streak is 0.42 wu long, `RAIN_STREAK_CSS_PX` 1.5 CSS px wide at every zoom
  (`streakWidthWorld`, rewritten per frame from zoom and DPR), alpha 0.28; the splash ring grows 0.04 -> 0.10 wu over 150 ms, alpha 0.35
  -> 0, floating 0.04 above the ground. Colour is `overcast.0` (streak) and `overcast.1` (splash) linear x `hazeRadiance`: the largest
  channel is 0.4331 on day, under `RAIN_COLOUR_CEILING` 0.9, so it never blooms and `hdr-gains.ts` has no entry.
- **The time is the SIM clock.** `uFall = mod(4.0 x presentationSimMs/1000, 6)`; nothing in the rain or ripple path reads
  `performance.now()`, `Date.now()` or accumulated `dtMs`. A repaint at zero elapsed time reads the same uniforms and a pause freezes the
  rain mid-air. A drop lands on ONE fixed point and repeats it every 1.5 s (the spec's formula); a re-hash per cycle is a GLSL change if
  a pattern ever shows.
- **The lattice period is CONTINUOUS and the density is held by a keep fraction.** (R-7 said the period snapped to {8, 16, 32, 64} and "a P
  step reshuffles": both are SUPERSEDED by S-L2 ruling 2.) A drop's landing point is world-anchored modulo `P`:
  `x = lo + mod(seed.x P - lo, P)`, inside a `P` window centred on the box of landing points the screen can see. `P` is the side of the
  UNCLIPPED footprint box (`footprintExtent`: zoom, viewport and the map's highest ground only, grown toward the camera by
  `rainReach(maxGround)`, `(6 + g) / tan(elevation)`, and by the slant offset), clamped to `[RAIN_PERIOD_MIN 8, RAIN_PERIOD_MAX 64]`,
  `RAIN_PERIOD_PAD` 1. **It is never a function of the pan** (a pan slides the window and moves no drop; the clipped box only places the
  window); computing it from the clipped box once made every drop jump near a map edge. A zoom now SLIDES the pattern (`s x P` moves
  with `P`) where R-7 reshuffled it in one step; never seen in a browser. A pure per-instance keep seed (`dropKeepSeed`, tile-hash streams
  9973/16183) and `uKeep = min(1, F x P^2 / A)` (`rainKeep`; `A` = `footprintAreaOnMap`, the mean over 8 heights of the fall of the
  footprint on the map, memoised by `RainKeepCache`) hold the on-screen count at `RAIN_DENSITY_FRACTION` 0.22 of the preset total at every
  zoom: the shader collapses an instance whose `aKeep >= uKeep` FIRST, with every varying written before the exit. `uKeep` comes from the
  zoom, the viewport and the map alone, so the pan neither changes it nor the period. Measured at the map centre on flat ground: high
  1,273-1,373 over zoom 0.35-2.5 (it was 3,365 / 1,726 / 709 / 1,114 before), medium 741-800; low was retuned at 525 drops to the
  lead's 1,400 scaled by its total, 98-147. The count is the geometry's, not a pixel readback. Lowest-zoom limit: a map wider than 48 tiles
  thins at its far corners, and `RAIN_PERIOD_PAD` 1.02 failed the 2.3 wu band at zoom 2.5, so it stays 1.
- **The map edge is a LANDING-point cull.** The vertex shader removes a drop whose landing point is outside `[0, W] x [0, H]` and fades
  one within `RAIN_EDGE_FADE` (0.5 tile) inside it with a smoothstep; the splash follows its drop (`mapEdgeFade` is the pure mirror). **The
  cull tests the landing point, not the streak**, so up to `6 x tan(12 degrees)` = 1.28 tiles of rain can overhang the void on the west and
  south edges and lose its upper air on the east and north: S-L2 saw rain over the black void above the top-left edge at `kdf_start`
  (about 1.9% of void pixels). The lead approved it as is.
- **The draw (S-5).** `RAIN_RENDER_ORDER` is a named ALIAS of `FX_RENDER_ORDER_ABOVE` (band 3, the decal-band pattern): over units and decals,
  under overlays (4), smoke (5) and the silhouette (6). Transparent, `depthTest` ON (a roof in front of a drop hides it; the fog pass
  shrouds a streak by the ground behind it), `depthWrite` OFF, `castShadow` false, NO `normal` attribute. It is out of the AO pre-pass and
  the shadow pass **by omission** (no normal, no cast) **and by its material** (`isAoOccluder` also requires an opaque, depth-writing
  material; the attribute alone does not raise the AO count, an opaque depth-writing material would), and `rain-batch.test.ts` counts the
  draws through three's own render lists ({main 1, shadow 0, ao 0}; the harness proves it can see a shadow or AO draw first). It is
  +1 draw call and +24,000 triangles at high, 0 on a dry map. **It is hidden in `photographGround`**: the minimap's photograph shows
  the wet tones and the water but no streaks, and the mesh's visibility is restored to what it was.
- **The height texture.** An R16F texture, 4 texels a tile (74 KB on 48x48), baked from `groundWorldY` at the first build and after every
  terrain rebuild (`rainHeightStale`), round-to-nearest to half float, under 5 ms (best of five 2.2-2.9 ms on `ein_qasab`; the test
  flaked once in a full parallel run at load 45-76 and passes alone). A drop lands where the ground IS, sampled at the landing point.
- **The ladder.** `RenderQuality.rain = { drops, ripples }` (no `openPuddles`: the lead removed the open-ground puddle at S-L1). Shipped:
  `high` 6000, `medium` 3500, `low` 525 drops with `ripples: false`. `RAIN_LADDER = [1, 0.6, 0.35, 0]` is the order a preset's `drops`
  steps through when it is over its cost budget (`rainLadderDrops`); a step is a one-line edit to the preset's `drops`, committed with
  its measurement and `Was drops <n>`. `low` took two: 1500 -> 900 (S-C, loaded run) -> 525 (final tip, quiet machine, NOT re-measured).
  `medium` took none, because its rain row (-0.4 / -0.6 ms) could not close the gap: **the dominant cost is the wet GROUND program, not the
  rain** (below). A preset with 0 drops builds no batch; an absent `quality.rain` reads `high`'s (`rainQualityOf`).
- **Reduced motion.** `reducedNow = opts.reducedMotion?.() === true` is asked ONCE a frame, live, at the top of the wet writes; the rain
  mesh is visible only when `!rainDebugHidden && !reducedNow` and the ripple amplitude is 1 only when `ripplesAllowed() &&
  !ripplesDebugHidden && !reducedNow`, so **showing a debug layer never turns motion back on for a player who asked for none**. The
  wet ground, the light and the haze stay, and the foliage sway follows the shipped rule (neither added nor removed). The test uses
  literal oracles (fall 1.2, ripple time 1.8 s at 37 ticks, the wall clock mocked forward).
- **The KDF rain rim (PR 914 ruling 1; presentation only; it REPLACED the flat lift of S-L2 ruling 3).** `WET_SURFACE_PARAMS`
  (`units/unit-surface.ts`) is built from `SURFACE_PARAMS` and rain films every surface: cloth 0.92 -> 0.80, armour 0.78 -> 0.52, plate
  0.70 -> 0.48, gunmetal 0.42 -> 0.32, every other class and every metalness unchanged (the 0.45 cap holds). It also carries the switch
  `kdfRim: true` (ABSENT from the shipped table; a switch, not a parameter): `figureRimFor(table, faction)` is true for `'kdf'` on a table
  that has it, `mesh-unit.ts`'s two call sites pass it to `surfaceMaterialFor`, and the clone becomes a rim variant (`units/rain-rim.ts`):
  `totalEmissiveRadiance += uRimColor * uRimGain * pow(1 - saturate(dot(normalize(normal), normalize(vViewPosition))), uRimPower)`, injected
  after `#include <emissivemap_fragment>` (the declarations after `#include <common>`). Colour `overcast.1` linear, power 3
  (`RAIN_KDF_RIM_POWER`), gain `RAIN_KDF_RIM_GAIN` (`weather.ts`; PROVISIONAL 0.4 until the `--rim` capture sets it). The rim is a thin
  soft edge on the outline (a sphere's mean factor is 0.1, 4% of its area is at or over 0.5) and gives the middle of a figure nothing, so
  camouflage, faces, helmets and team colour read as they did at S-L2, the look the flat lift (emissive `overcast.1 x 0.4` on every texel,
  flat pale grey-blue ghosts) had washed out. **The uniforms are ONE shared set** (`rimUniforms()`), so one `.value` write moves every figure:
  the `unit-surface` debug layer sets the gain to 0 and back (the knob's value is stashed, idempotent both ways), and
  `ThreeRenderer.debugSetRainRim(gain)` / `debugRainRim() {gain, power, built}` (concrete class only, never `api.ts`; a non-finite or
  negative gain throws) is the capture knob. **Compile-time variant**: the clone has its own `customProgramCacheKey`
  (`rl-unit-rain-rim`) and the memo key gains `/rim`; a dry renderer never builds one (programs, materials and the three shipped digests are
  today's). The wounded copy (`wounded-read.ts`) CHAINS the source's `onBeforeCompile` (`Material.clone` does not copy it), so a wounded KDF
  copy under rain keeps the rim and the floor and carries both program keys. The silhouette outline is a separate `MeshBasicMaterial` and
  does not interact. Vehicles, enemy and civilian figures are not rimmed (`ugv_recon_dog` is catalogued `kdf` and is). The model for the
  provisional gain is `tools/src/wet-unit-rim.test.ts`; the flat lift's calibration test was removed with it.
- **The density instrument is `pnpm ground:capture`** (`tools/src/perf/ground-captures.ts`, pure half `ground-captures-plan.ts`). Every
  frame carries `preset`, `zoom`, `tick`, `drops=` (on screen), `P=` and `total=` on its printed line and in `cost.json`; `onScreenDropCount`
  mirrors the shader's keep and edge cull. Options: `--reflect`, `--wade`, `--quality=high,medium,low` (one boot per preset, read back
  and fail loud), `--ticks=<n>`, `--motion=reduce`, `--clip=<s>`, `--stops=road,water,grass` (a squad ordered by a sim `move` Command, never
  a state write), `--zooms=`, `--vehicle[=marker]` (the first living side-0 wheeled non-air, non-soft hull; a `technical` is soft and never
  sprays), `--rim=<g>[,<g>...]` (needs `--stops`: each stop frame is repainted at each rim gain, named `<map>-squad-<kind>-rim<g>`, the
  gain read back off the shared uniform and a renderer with no rim material fails loud). Each option reads back what it asked for and fails loud, and a frame is only comparable with one from the same GPU backend.
- **The cost instrument is `pnpm perf:fx -- --breakdown --maps=ein_qasab,wadi_halam_basin --presets=high,medium,low`**
  (`tools/src/perf/fx-cost.ts`, pure half `fx-cost-plan.ts`; rounds interleaved so the basin shares the machine's drift). Configs: `rain`,
  `wet`, `marsh`, `ripples`, `wet-all`, `wet-program`, `shadow-full`. `wet-all` only zeroes the wet UNIFORMS and hides the rain, so the compiled
  `THEME_WET` program still runs in both arms: **`NET (layers)` therefore understates the wet cost and carries no budget**.
  `wet-program` strips the define (and hides rain and ripples) and recompiles; **`NET (total wet)` = (baseline - wet-program frame) -
  (shadow-full frame - baseline)** is the figure the budgets +1.0 / +0.7 / +0.4 ms (high / medium / low) apply to. Its scope excludes the
  rain light, the wet sway program and vehicle mud (they stay in both arms). A config with nothing to act on (a layer on the dry basin)
  prints `n/a (<reason>)`, never 0.00. The tool compares unrounded floats, so a reading AT the budget at its 0.1 ms resolution prints
  OVER. `--burn=2` (two extra frames per rAF) is the cadence check's falsification: 50.0 ms median, 99% of frames over 20 ms, against 16.70
  vsync-bound. NOT measured by the tool: program count, texture count, the height-bake time.
- **The cost verdict, plainly: `medium` is OVER budget, and `low` is at or just over, on the final tip at a quiet load (3-5).** NET (total
  wet) high 0.20 / 0.50 / 0.20 (<= 1.0, within); medium 0.50 / 0.90 / 1.00 (<= 0.7, OVER at z1.6 and z2.5); low 0.50 / 0.50 / 0.40 at 900
  drops (<= 0.4), before the unmeasured 525 step. An earlier run at load 18-77 had read medium inside budget; the quiet machine did
  not reproduce it. Do not take a ladder step to fix it: the standing wet GROUND program is the dominant row (-0.6 / -0.7 / -1.0 ms on
  medium) and the rain row cannot close the gap. The options are the lead's (spec section 14.6).
