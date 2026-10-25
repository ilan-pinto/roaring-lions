# Ground, decals, scatter, props, foliage, haze, relief, crowns, light presets

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 918-1208, section "The three.js backend" -->

- **The ground is SMOOTH since 2026-09-03, and the sim never noticed** (`terrain/ground.ts`,
  `terrain/surface.ts`). It was flat terraces by design -- corners never interpolated, vertices
  never shared -- for two reasons that are both retired: Pixi parity (report-only from
  2026-09-02, the backend deleted in WP-A3.3) and the palette guarantee, which the project lead had already overridden three
  times. Open ground is now **Catmull-Rom bicubic over tile CENTRES**, not corners: corner-bilinear
  is a low-pass, and a lone level-3 tile would draw at a quarter of the height the sim charges a
  climb for. Centres make the surface pass through every authored level exactly, so what the
  player sees and what `FlowField` prices agree. **A tile is a terrace iff `blocked[tile] !== 0`**
  -- the sim's own mask, so `^` ridges and building pads stay cliffs while `b`/`d` ramp, because
  infantry walks them. **The sim reads only the integer grid** (`flowfield.ts:149`, `sim.ts:2165`)
  and is untouched: determinism hash, `playtest` (byte-for-byte) and `balance` all unmoved -- this
  is the spatial twin of interpolating units to 60 fps while the sim ticks at 20. Units, decor,
  fog, smoke and trails all sample the drawn surface through `ground-height.ts`; three of those
  were found sampling a tile CORNER and fixed. Cost: +0 draw calls, +1.87% triangles, fixed per map.
  Open ground carries the supplied **sand** PNG (4 tiles per repeat), `^` walls the supplied
  **rock** PNG (2 tiles), both `NoColorSpace` and plain `RepeatWrapping` -- **never mirror-tile
  them**, it kaleidoscopes -- with roads (`r`) drawn by the control map's distance field (next
  bullet), not masked out as they were. Terrain is the fourth named palette
  exemption, and **since 2026-09-14 only its ALBEDO half survives**: the ground is lit and
  shadowed by the scene sun like everything else, so the *shade* is not an exemption from
  anything any more (`terrain/surface.ts`'s `SURFACE_SHADING_EXEMPTION`, and the paragraph
  `pnpm validate:meshes` prints -- `validate:assets` printed it until it was retired). The albedo is still exempt, on all open ground and on `^`,
  because it is a ratio to each image's own mean rather than a colour -- which is also why these
  six textures alone stay `NoColorSpace`. Two things worth knowing. **For a texture, the image fed to Meshy
  is the asset, not the model it produces** -- `art/blend/desert tile/`'s `.blend` bakes a
  scrambled UV atlas that tiles as noise, while the PNG beside it measured seamless (edge/adjacent
  ratio 0.95x). And **`groundTextureCheck` was structurally inert and is now
  deleted** (2026-09-03): textured ground is never one flat colour, so the `open-ground` crop read
  0.2330 / 6,721 distinct colours against a `<0.95` budget and the gate's only reference-free check
  could no longer fire on the defect class it was built for, or on anything, while printing PASS.
  What replaced it is the visible-toggle A/B — see the visual-gate bullet below.
- **The ground reads a CONTROL MAP, not per-vertex masks** (WP-A2 plan 1, 2026-09-25;
  `terrain/control-map.ts`, spec `docs/superpowers/specs/2026-09-25-ground-design.md`, whose
  Deviations R-1 to R-21 are the record). Two RGBA8 textures at `CONTROL_TEXELS_PER_TILE` = 8
  texels a tile: A holds open, rock, scrub and grove weights; B holds knoll, road distance,
  junction distance and the road-edge bend noise (R-6), all baked in TypeScript, so the GLSL is
  arithmetic and every number in it is unit-tested. Soft edges are a 0.5-tile band (D1: 1.5
  smeared a lone cover tile past recognition), bent ±0.2 tile by noise. A 256² R8 macro field
  (±7% luminance, ±0.04 hue) lies over it. Four things a later change will get wrong:
  **`wallAlbedo` is the ONE per-vertex surface fact left** (R-5): -1 on every top (sample the
  control map), 0 on a building wall, 1 on a ridge wall. A vertical face sits exactly on a texel
  boundary, so the map cannot tell the two walls apart. **Terraces stay hard**: a pad and a `^`
  top are never blended. But a ridge throws a 0.5-tile rock APRON onto the open ground beside it,
  never the reverse. Pads keep a hard edge on purpose (R-4, the rest of G3 is plan 2's).
  **Road tone lives in the shader** (R-3): a road tile's VERTEX colour is the open wash, and the
  road tone is mixed in by the distance field. Put the road tone back in the vertex and the SDF
  road steps at every tile edge again. A street authored two tiles wide is ONE street (2x2 road
  blocks are solid, and ladder rungs are not junctions); three-wide is unhandled, and no map has
  one. **Road grain shares `uKnoll`** (R-7) at its own 2-tile repeat and 0.6 gain. There is no
  road image any more; `road_track_tile.jpg` is still on disk and in `GROUND_ALBEDOS`, waiting
  for its own deletion task. Cost, measured on ANGLE/Metal M3 Pro at `64afcf3b`: **+0 draw calls
  on every view of four maps**, texture count +2 (A, B and macro in; the road image out), and
  **1.58 MiB** a 48x48 map with mips (A and B 768 KiB each, macro 85 KiB). `buildControlMap`
  costs ~50-68 ms a call, and **it runs only when what it reads changed** (fix wave I-1,
  `controlInputsMatch`): the decor array by reference, the draw mask and `cover` by CONTENT.
  Both halves of that are load-bearing -- `drawBlockedMask` returns a new array every call, so a
  reference compare never matches, and `sim.cover` is written IN PLACE when a structure dies, so
  a reference compare always does. A boot fires 3-5 terrain rebuilds (templates, decor sets,
  `setElevation`) and now builds the map once. See `docs/PERFORMANCE.md`, "The ground, plan 1".
  **A structure collapse SPLICES** (PR #509, `terrain/incremental.ts`, `terrain/tiled-mesh.ts`):
  the new draw mask, cover, terrace flag and field source are diffed against the last build,
  ground and scatter re-emit only changed tiles grown by `SPLICE_RADIUS_TILES` = 2 (Catmull-Rom's
  support) and copy the rest with shifted indices, and `updateControlMapRegion` rewrites in place
  the texels within `CONTROL_SPLICE_MARGIN_TEXELS` = 4 (0.2 bend + 0.25 band); a road or ridge
  tile changing still builds the map whole. Byte-identical to a full build: swept over all 1,724
  single collapses on every shipped map, 0 differences, and both margins are tight -- 1 tile
  differs on 13 relief maps, 3 texels on 25 maps (`packages/app/src/terrain-splice.test.ts` keeps
  chains and one witness per margin). The collapse frame at 4x CPU went 531-627 ms -> 95-103 ms.
  **Decor placements splice too** (`decor-place.ts`, `spliceDecorPlacements`): every placement
  belongs to the SOURCE tile that pushed it, a clump member lands at most a tile from its source
  and its height reads the field two further, so `DECOR_SPLICE_RADIUS_TILES` = 3; same sweep, 0
  differences, and 2 tiles differs on 10 collapses on 6 relief maps (a tuft at the wrong height).
  Profiled at 4x: 5.6-7.9 ms -> 1.7-3.2 ms. Left on it: the decor batches rebuilt whole, prop
  placements (a global sort and cap, not spliceable per tile) and the sim's own `recomputeFields`
  (9-19 ms at 4x). See `docs/PERFORMANCE.md`, "A collapse splices the terrain".
  **The road block in the ground shader is skipped where control B saturates**
  (`if (rlB.g < 1.0)`): there every road term is exactly 0, the golden A/B read 0 px, and its
  grain tap is a `textureGrad` whose derivatives are taken OUTSIDE the branch. Keep them there.
- **Ground decals are ONE pool class, two instances, on the SIM clock** (`decal-pool.ts`, the
  pure maths in `decal-maths.ts`). Persistent: 1024 stamps on a 4x4 grid (crater, scorch, oil,
  rubble). Fading: 4096 on 2x2 (tread, tyre). Both share one material and one program, and the
  oldest stamp is evicted (R-10). At full pools that is exactly **26,624 triangles and 2 draw
  calls**, measured. `ScorchDecalMesh` and `VehicleTrackMesh` are gone and their calls with them,
  so the net is +0 (R-11). Four rules. **`stampGroundDecal` is the one entry**: a shell landing
  (`shellHasLanded`), a vehicle kill (scorch plus oil) and a structure collapse (rubble, R-12)
  all go through it. It refuses a terrace centre (R-19) and routes by kind. **Age is sim time**
  (R-14): a stamp is dated `tickCount x 50` ms, and a frame presents `(tickCount - 1 + alpha) x
  50`. So a frozen gate frame never fades, and wall-clock fades would make `quiet` noisy.
  **`&decals` is the showcase** (R-16): `RendererOptions.decalShowcase` stamps every kind at
  three sizes on a flat, a road and a relief site, dated 0 ms, through the same entry. It is
  sandbox-only, and a mission never sees it. The option names the sandbox FORCE's anchor, and
  the showcase sits CLEAR of it (`showcaseAnchor`, fix wave I-2): every site at least
  `SHOWCASE_CLEAR_TILES` (10) from the force, as near as that allows, with the most kinds the
  map offers -- on `qarn_hadid` road (30,28), relief (34,31), flat (38,36). It used to sit on
  the force, under fourteen idle mesh units and the fight the drone started, and that frame
  moved 519-656 px between two captures of the same commit. The search costs ~50-60 ms, once.
  **`decal-maths.ts` is three-free** (F-27), and that is TIDINESS, not a requirement: `three`
  loads under node (`decal-pool.test.ts` builds meshes there, and tools resolves it through
  `packages/render/node_modules`), so nothing breaks if it slips. `decal-maths.test.ts` pins its
  direct imports.
  **Rubble is chips, not cells** (fix wave I-5): at most one soft, jittered disc per
  `RUBBLE_CELL_TILES` (0.1 tile) cell, the lattice turned by `2 pi seed`, thinned by the chip
  centre's radius from 0.55 r to the rim. The first cut filled whole 0.34-0.5-tile squares in a
  hard step, and on grass, where the ratio divides by the grass tone, it drew a checkerboard.
  The GLSL hash (`rlHash`) takes its multipliers AND its two shifts from `tile-hash.ts`'s own
  exports, which `tileHash` itself reads. **Tread is `dust.5` on every theme** (spec §5): the
  ground's road ruts are `limestone.6`, and the theme's `rut` tone is `dust.6` on green -- the
  old comment that called tread "the SAME rut tone" was wrong twice. **A stamp uploads its own
  slot** (`addUpdateRange`, M-1) rather than the pool's 0.64 MiB of dynamic attributes, and both
  pools index in 16 bits: 1.81 -> 1.65 MiB of buffers for the two.
  The AO pre-pass and the shadow pass never see a decal. This is by omission: the pool geometry
  has no `normal` attribute, so `isAoOccluder` drops it, and `castShadow` is false. **Proved on
  the real renderer**, by counting `renderBufferDirect` per object over one frame with the shadow
  map forced: each pool draws **1** time, the ground 2 (main + AO), and a shadow caster 3.
  **The sag lift is capped at 0.08 wu (`DECAL_LIFT_CAP`, F-23), and clipping remains.** Between
  vertices the grid is flat triangles, and over a bicubic crest the chord passes under the
  ground. Each vertex is lifted by the largest sag of its cells, up to the cap. Uncapped, it
  floated over units standing in the mark, and darkened a squad by p90 16 grey levels (8 capped).
  Measured on 2026-09-25 by `writeDecalGrid` over every non-terrace centre on a quarter-tile
  lattice, against the drawn surface, on `qarn_hadid` (level 0-7). Where every grid vertex is on
  open ground: craters 0; mortar scorch (r 0.876) 0.025 wu worst, 9 centres over 0.01; Grad
  scorch (r 1.07) 0.067; full-power scorch (r 1.6) **0.203 wu**, 3,749 of 22,464 centres over
  0.01, photographed as a straight cut edge at zoom 2.5 (`tel_marum`: 0.170). With no wreck
  over it, that cut reads as a pale, hull-shaped patch inside the scorch on tel_marum's steepest
  shoulder (review capture 16) -- the one clipping the approved cap leaves. **A grid vertex
  over a terrace or off the map samples the SMOOTH field** (`decalGroundY`, fix wave I-4): the
  drawn ground on open tiles, the field `buildTerrainSurface` fills in under a terrace, and the
  edge-clamped field past the rim; the decal shader discards what hangs past the edge. Holding
  the terrace vertex at the centre's height cut under a ridge-foot apron by 0.62 wu, and the old
  off-map 0 dived 0.38 wu on qarn's rim. Re-scanned on `qarn_hadid` at the fix: terrace class
  full-power 0.624 -> 0.202 wu (now the open-ground cap's own limit), Grad 0.520 -> 0.067,
  mortar scorch 0.433 -> 0.025, craters 0.21 -> 0; edge class 0.353 -> 0.043, craters 0.376 -> 0.
- **Grass and sand gather in clumps, on a density dial with a shed ladder** (WP-A2 plan 2,
  2026-09-27/28; `terrain/decor-place.ts`, spec Deviations R-2 to R-4). What §3.4 calls "scatter"
  is `decorPlacements`'s `grass`/`sand` families, not the flat grain mesh below (`buildScatter`,
  D9, next bullet) -- two different files, and the gate's `decor` layer witnesses the first while
  `scatter` witnesses the second. Members seed at `CLUSTER_SEED_P` = 0.114 and roll a radius
  `CLUSTER_R_MIN`-`CLUSTER_R_MAX` (0.5-1.2 tiles); `SINGLETON_P` = 0.19 places lone members outside
  any cluster. Both were raised 1.267x from the spec's 0.09/0.15 (same ratio, the lead's "raise
  seeds to hit 0.9") because R-3 (a member that lands on a road, building or off-map is DROPPED,
  never moved) costs real maps about 12% of density; all 26 shipped maps now read 0.731-0.920 of
  the spec's 0.9-an-open-tile target (mean 0.862). `GRASS_SCALE_MAX` = 0.9. **`SCATTER_DENSITY`
  (R-4) is the ship-time dial, currently 0.75** -- the approved shed ladder's first rung
  (1.0 -> 0.75 -> 0.5), scaling `CLUSTER_SEED_P`/`SINGLETON_P` together so a shed map stays
  clumpy rather than thinning into a uniform spread. It scales grass/sand only: trees, boulders,
  ditches, rocks, slabs and bushes are untouched by the dial. Every clump-shape test (Clark-Evans
  ≥ 0.7, family agreement ≥ 0.85, Ripley's K(1)/πr² > 1.4 at 1.71) is measured at dial 1, the
  unshed rule; a separate pin checks the shipped default clears 0.75 ± 0.08 of dial 1 on every
  real map. Road/building/ditch clearance is memoized per `composeTerrain` call
  (`WeakMap<Uint8Array, RoadGraph>` keyed on `input.decor`'s stable identity, since `blocked` is
  rebuilt fresh every call) so the unconditional `decorPlacements` call inside `composeTerrain`
  costs nothing extra on a road-free rebuild. **The 0.75 rung does not clear its own frame-cost
  budget, and the lead accepted the miss** ("Accept the miss", 2026-09-28): a clean,
  quiet-machine, n = 10 interleaved read (Task 12 part B, `docs/PERFORMANCE.md`) puts
  `beit_sahwan_outskirts` (22,24) z0.5 gpu p95 at 14.67 ms, +0.83 ms over main's 13.84 ms mean,
  over both the plan's +0.74 ms cap and the 14.5 ms ceiling, with no overlap between the two
  trees' sample distributions -- a real cost, not noise. A lower rung (1b, density 0.5, is the
  next one Task 5 measured clean) was available and not taken. Density 0.75 ships as the
  lead-accepted number; the "currently 0.75" line above is settled, not provisional.
- **The flat grain loses its discs and half its flecks (D9)** (`terrain/scatter.ts`). Limestone
  flecks halve to 2-4 a tile, rounded up so a tile never drops to one; ground discs retire
  outright. The `scatter` layer floor was re-derived by the one-third rule after the trim and is
  unchanged in shape, only in the reading it is a third of.
- **Props are one vertex-coloured batch, seven kinds, placed near structures and roads, capped at
  150 a map** (WP-A2 plan 2, Tasks 3-5; `terrain/prop-role.ts`, `terrain/prop-place.ts`,
  `terrain/prop-mesh.ts`, spec Deviations R-5 to R-8). The seven — `jersey_barrier`, `water_tank`,
  `satellite_dish`, `laundry_line`, `tyre_pile`, `rebar`, `wrecked_car` — are **Meshy-generated**
  (seven text-to-3D previews, approved "Use all 7"; four of the seven collapsed under the
  120-400-tri caps at first decimation and were re-submitted through the Meshy CLI's `remesh`
  command, 35 more credits, before Blender only strips materials, assigns a `PROP_ROLES` role and
  sets tri caps — this is an AI-art disclosure item, distinct from the desert/olive trees, which
  are re-exports of an EARLIER Meshy source). **The vertex colour is baked at LOAD, not export**
  (R-6): a GLB carries `extras.rl_role` and zero materials, exactly decor's contract, and
  `bakePropColors` writes the `color` attribute from `prop-role.ts`'s ramp table when the loader
  clones the geometry — so a palette repaint never needs a re-export, and `validate:meshes` checks
  props by the same "zero materials, every role known, tri cap from the table" contract decor gets
  (R-7), never by rendering them. Placement (R-3-shaped: dropped, never moved) draws from a
  roadside mix {jersey 0.35, tyre 0.25, wrecked car 0.15, rebar 0.25} near roads and a yard mix
  {water tank 0.25, dish 0.20, laundry 0.25, tyre 0.15, rebar 0.15} near buildings; a map with no
  building and no road loads none of them (R-8). **The whole batch costs +3 draw calls** — a
  plain `BatchedMesh` (`terrain/prop-mesh.ts`), drawn once each in the shadow, AO and main
  passes, with no `renderBufferDirect` wrap — and is invisible to `decor`'s own debug toggle —
  `props` is its own `DEBUG_LAYERS` entry and its own gate check (floors: `quiet` 767 px / 0.0465,
  `aftermath` 1783 px / 0.1505, both one-third-of-smallest-of-three, macOS/M3 Pro/SwiftShader).
  The tyre pile's `rubber` role was retuned twice on the lead's word after the first review capture
  (too dark to read): first one step up the `shadow` ramp, then to the `gunmetal` ramp's index 3 —
  through the role table both times, never a raw hex.
- **The olive is decimated by triangle count now, not vertex count** (R-9,
  `tools/terrain/export_meshy_decor.py`, `TREE_TARGET_TRIS` = 3000 replacing `TREE_TARGET_VERTS` = 3500,
  which had shipped 13,383-14,239 triangles because a vertex target says nothing about face count).
  The trunk and foliage are split and decimated SEPARATELY before rejoining — plain single-pass
  decimation collapsed the trunk/foliage colour boundary along with the canopy — and `tree_1`/
  `tree_2` stay byte-identical exports (an olive art judgement, out of scope to change). Shipped
  tri counts: 2,999 / 2,847 / 2,847. Measured where it costs the most: `wadi_halam_basin`'s decor
  triangle budget fell from 9.17M to 2.39M (-6.79M) at `centre-z1`. The desert tree's var1 and
  var3 trunks grow a **desert crown** (R-10) replacing their foliage objects, generated in Blender
  from a hand-rolled hash (never `mathutils.noise`, nondeterministic per process in Blender 5.2) so
  two exports of the same crown are byte-identical; the var1/var3 trunk objects themselves are
  untouched.
- **Foliage sways on the SIM clock, in the foliage material only; the shadow and AO passes keep
  the rest pose** (R-11, `terrain/sway.ts`). The clock is `presentationSimMs(sim.tickCount,
  alpha) / 1000` — the same sim-time source the ground decals already use (invariant 4) — never
  accumulated wall-clock `dtMs`, so a gate capture at a pinned tick repeats exactly and a
  `frame(1, 0)` repaint moves nothing. `SWAY_TOP` = 1.0 world unit above a foliage instance's
  origin (amplitude tapers to 0 at the base, full above it); `SWAY_AMPLITUDE` = 0.035 wu at weight
  1, period 3.8 s, with an 11 s gust cycle 1.4x the base amplitude for 2.5 s. The dead
  `GroveMaterial`/`groveMesh`/`groveMat`/`windClockMs` wind path (wired to an empty `groves` layer
  that has drawn nothing since the mesh trees shipped) is deleted; `grove.ts` and `buildGroves`
  themselves stay — still barrel-exported and tested — deleting THEM is a follow-up, not this
  plan's. Gate: `wind` is its own `DEBUG_LAYERS` entry and its own floor (406 px / 0.0284 on
  `quiet`, one-third-of-smallest-of-three; hiding it drives `uSwayAmp` to 0 and every foliage
  vertex snaps to rest at the frozen tick).
- **Dust haze lives inside the fog-of-war pass, spliced BEFORE the shroud mix, and only where
  depth < 1** (R-13, R-14; `three/haze.ts`, `three/fog-pass.ts`, `three/time-of-day.ts`). It
  mixes toward a SCENE-REFERRED tint — the fog pass runs on the composer's HalfFloat, pre-tone-map
  target, so the haze colour is the tint's linear value times the same
  `(sunIntensity · sun.y + hemiIntensity) / π` factor lit open ground sits near, which is why haze
  neither darkens bright ground nor glows on it, and why dusk's haze reads dimmer by the same
  ratio as its light. Two terms, added: a FAR term ramping to the active preset's `hazeFar` at
  `HAZE_RAMP_TILES` = 20 tiles ahead of the camera's focus plane (`HAZE_FORWARD`, the camera's own
  view direction); and a LOW-LYING term reaching `HAZE_LOW` = 0.06 at `HAZE_LOW_LEVELS` = 2 levels
  below the map's own MEDIAN open-ground level, computed once per terrain rebuild
  (`hazeReferenceLevel`). **A flat map has no low-lying term at all** — every open tile sits at the
  median, so `levelsBelowRef` is 0 everywhere (`quiet`, on `beit_sahwan_outskirts`, moves only from
  the far term; Tel Marum's basin IS its own median, so `relief`'s haze floor is the far term alone
  too — the low-lying term has no gated witness, only `deir_amun`/`umm_zeitoun`/`qarn_hadid` carry
  open ground below their own median). `haze` is its own `DEBUG_LAYERS` entry driving `uHazeAmp`;
  floors (one-third-of-smallest-of-three, macOS/M3 Pro/SwiftShader): `quiet` 986 px / 0.2515,
  `relief` 0 px / 0.1291 (under pixelmatch's threshold everywhere, so the magnitude floor is the
  whole check). The haze reads noticeably weaker over fog-shrouded ground than the approved mock
  (+3.7 vs the mock's +16) — the lead's ruling, 2026-09-28, is "keep as built": R-14's ordering
  (haze before the shroud, inside one pass) stands.
- **Relief reads through two ground-shader terms, both presentation-only** (2026-10-15,
  `terrain/relief-read.ts`; mock and decision in `docs/superpowers/specs/2026-10-15-relief-read-design.md`).
  Smooth open ground turns its normal only a few degrees over a 3-4 level bluff, so before this
  relief read almost entirely through the terraced `^` walls. **A, slope light**: for LIGHTING
  only, the world normal's tilt becomes `atan(RELIEF_SLOPE_GAIN x tan(tilt))` (gain 2), capped at
  `RELIEF_SLOPE_MAX_TILT_DEG` (38) so a shade face never falls to sky light alone, and never
  flattened; flat ground and walls are untouched, shadows still come from the geometry. **B, height
  contours and tint**: on ground TOPS only, a thin line where the surface crosses a HALF level
  (constant pixel width via `fwidth`) and a tint by height relative to the map's MEDIAN open level
  -- the same median the haze's low-lying term reads (`hazeReferenceLevel`) -- so a flat map, all
  whole levels and all median, does not move. Debug layers `slope-light` (gain to 1) and
  `height-contours` (both amplitudes to 0) are uniform writes nothing per-frame re-asserts, the
  `macro` standard. Floors are a third of `tools/src/perf/relief-read-signal.ts`'s reading (the
  gate's own capture, 3 runs, bit-identical); with the shader terms removed both read 0 px /
  0.0000. **The frame cost**: +0 draw calls, +0 programs, +0
  textures, ALU per ground fragment only. It was timed and closed under GH-804: about +0.15 ms median at every
  preset (high, medium, low; M3 Pro, ANGLE/Metal, DPR 2), under the 0.3 ms line, taken at load average 3-10 on a
  shared machine, not a quiet one; `low` on `qarn_hadid` is the one cell near +0.3 ms. The earlier timings were swamped by load. A valley
  AO boost (no visible effect) was rejected; the tell-crown summit landed after it (next bullet).
- **A tell's `^` crown draws as a smooth ROCK summit, lifted 2 levels, presentation-only**
  (`terrain/crown.ts`). A crown is a 4-connected `^` cluster of at most 12 tiles that is a SUMMIT:
  every 8-neighbour open in the SIM's mask (another ridge, any building, a low-profile wall all
  disqualify) and at or below the cluster's lowest level -- 20 of the 61 small clusters on the
  shipped maps (`packages/app/src/crown-summit.test.ts`, against an independent count); the rest
  are ridge fragments, escarpment bits, wadi rocks and fortified hilltops, and stay terraces. The
  lift goes to a renderer-side copy of the levels and the crown leaves the DRAW mask only; the sim's
  elevation, `blocked` and sight never change. **2 is the sim's `BLOCK_RISE`, and that is the
  point**: mirrored over every crown-crossing ray (and checked ray for ray against the real
  `losRay`), today's flat pad looks open on 74-81 % of rays the sim blocks, lift 2 on none, and
  lift 3 makes 10.6 % of Tel Marum's rays look hidden while the sim sees through them. The pin is
  `CROWN_LIFT_LEVELS === BLOCK_RISE`. It reads as rock because `tileSurface`/`groundTone`/
  `buildScatter` key rock on the `^` symbol rather than the mask (#635); in the control map a crown
  is rock that BLENDS (a 1-tile `CROWN_SKIRT_TILES` fade) where a terraced ridge stops hard with a
  0.5-tile apron. Rocks, slabs and boulders within 4 tiles of a crown are SEATED on the slope
  (`decor-place.ts` `seatedY`: sunk to the lowest ground under a contact radius, at most a fifth
  of their own height -- the first cut buried slabs whole). **Gate witness: the minimap.** Neither
  gated crown (`relief`'s at (24,20.5), `aftermath`'s at (11,8)) is in its 3D frame, so the `crown`
  debug layer is checked in the crown's MINIMAP box, LAST in each scenario's list, through
  `__lions.redrawMinimap` (`Minimap.redrawGround`: a fresh ground photograph with every dot,
  marker and flash replayed from the last draw -- a plain redraw also walks the units to the
  capture tick, and the ground photograph itself carries transient glows a stale one does not).
- **`day` is the light preset, not a table lookup, and it is byte-identical to what shipped before
  this plan** (spec §3.6, R-12; `time-of-day.ts`). `LightPreset` (`dawn`/`day`/`dusk`, each with
  its own sun direction, intensities, `hazeFar` and an optional sky-tint `hazeKey`) reproduces
  today's constants exactly for `day`: `hazeFar` 0.12, `hazeKey` null; dawn is 0.16 with no sky key,
  dusk is 0.18 with `hazeKey: 'dust.1'`. `day`'s LIGHTS are bit-identical to what shipped before
  this plan, enforced by a test that compares bits, not a tolerance — but `day` is not a 0-px A/B
  any more: since Task 9 spliced haze into the fog pass, `day` is hazed at 0.12 like every other
  preset, and four of the five gated scenarios move against their pre-haze captures (`open-ground`
  is the one that does not, per the haze bullet above). `night` resolves to `dusk` (D10 — it is not
  its own light yet). `RendererOptions.timeOfDay` is read off `map.time_of_day` by the APP's
  `timeOfDayOf` (`packages/app/src/time-of-day.ts`), which validates only `&tod=` against the four
  names — a mission's own authored value is trusted to `validate:data`'s schema enum and is never
  re-checked by `isTimeOfDay` — **not** added to `packages/sim/src/mission.ts`'s `map` type, because
  the sim never reads it (R-12, the four invariants stay clean). Two missions author it today:
  `beit_sahwan_breach` (dawn) and `beit_sahwan_0_tutorial` (day, i.e. unchanged).
  **`&tod=` is sandbox-only** (`sandbox-help.ts`'s flag table) and applies only when there is no
  mission; a mission's own `time_of_day` always wins over `&tod=`, so it is not a real
  player-facing control. The visual gate's `dusk` scenario is REPORT-ONLY — captured, printed, no baseline,
  no vote — because a new preset with no prior baseline has nothing to diff against yet; it exists
  so a human reviewer (not the gate) can look at it.
