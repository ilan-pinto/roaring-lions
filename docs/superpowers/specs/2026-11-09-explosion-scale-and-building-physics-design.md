# Explosion scale and building physics: design (GH-1197)

Status: DRAFT, revision 2 after the lead's rulings on PR 1198 (9 Nov). Design only: no code, no render,
no Meshy. Every number below is for approval before any render (the art-numbers rule). Written against
`origin/main` f89e99407.

**Revision 2 rulings (the lead, 9 Nov):**
1. The Te'o's drawn ring is BIGGER than its 2.4-tile damage radius. It has two parts: a bright inner
   shock to `S` and a faint outer pressure wave to 1.6 x `S`.
2. The final collapse keeps today's dense shroud and ADDS flying debris. Sink-and-lean is dropped.
3. Walls take REAL HOLES, not char marks (§3a). The vehicle-wreck no-holes ruling does not apply to
   buildings.
4. Rubble fades to its decal after 90 s.
5. The data file, hit-stop only on the strike, demolition and the collapse, Grad in the heavy class, and
   no 3D debris on low all stand as recommended.

**The first ruling (9 Nov), which anchors the design.** The Te'o howitzer (`spg_long_range`,
`howitzer_155`) is the anchor case and Phase 1. Its drawn blast must match its real 2.4-tile splash.
The change is VISUAL only, with the sim's damage and splash untouched. More generally, **a weapon's drawn
reach comes from its own `splash_tiles`** (and `submunitions.splash_tiles` for `spg_cluster`), so every
blast matches what it actually hits.

Binding throughout: presentation only. The sim reads nothing back, and `pnpm test:determinism`'s golden
hash must not move. There is no physics library. Colour comes from palette keys only. HDR gains live only
in `units/hdr-gains.ts`. Every band comes from `units/render-order.ts`. Versus seats keep the
`hostileEffectVisible` rule: no effect is drawn for a hostile event in fog. **No sim event is needed, so
nothing is handed to `sim-guard`.** `fire` carries `weaponId`, `structureHit` carries `by`, `damage` and
`hpLeft`, `strike` carries `profile`, and the renderer already knows where each round visibly lands.

## 1. Today

| Munition (weapon ids) | Sim reach | What the renderer draws today |
|---|---|---|
| 40 mm grenade (`gl_40`) | splash 1.2 | `shell_impact` at power 0.15: crater 0.30, scorch 0.62, light 0.63, no shake |
| 60/82 mm mortar (`mortar_60`, `mortar_82`) | 1.8 / 2.0 | `shell_impact` at 0.3: fireball billow 1.22 wu, 16 dirt, 9 smoke (4-6 s), crater 0.45, scorch 0.88, light 1.26 over 4 t, shake 1.5 px, hit-stop 12 ms |
| **155 mm (`howitzer_155`)** | **2.4** | **Identical to the 60 mm mortar.** Its class is `mortar`, and `SHELL_PROFILES` is keyed by class |
| Grad 122 (`grad_122`) | 3.0 | `shell_impact` at 0.45: crater 0.60, scorch 1.07, shake 2.25 px |
| DPICM (`dpicm_155`) | 12 x 0.8 | `cluster_airburst` at 0.25, plus a crater of 0.25 and a scorch of 0.4 for each bomblet |
| Tank round, ATGM, RPG on a building | 0-1.3 | Bolt `impactPower` 0: a flat dust puff at the building CENTROID (`spawnFlatFx`), whichever side was hit. A missile gets `missile_impact` (light 2.6, shake 2 px) |
| Barrage round / air strike | 1.0 / 2.0 | `barrage_impact` at 0.8 / `air_strike_impact` at 1.5 (GH-748 rulings: ring 2.2 t over 300 ms, crater 1.4, scorch 2.4 flat and 1.6 on relief, 60 ms freeze on the strike only) |
| Demolition (`charges`, `vest`, `demo_tzav` placed charge) | 1.2 / 1.6 / 2.5 | `demolition_blast` at 0.35 on a wall hit. **`chargeDetonated` has no renderer consumer**: a placed charge draws only the collapse it causes |
| D9 blade (`dozer_d9`) | none | A grinding dust puff every 4th tick |

| A building, from its first hit to its collapse | Today |
|---|---|
| Any hit | A dust puff at the centroid, and the HP band recomputed (`refreshBuildingDamage`) |
| Band 8-6 | Clean |
| Band 5-3 | A scar material clone: colour lerped toward the char tint by up to 0.375, and rougher. Shared for each (material x band) |
| Band 2-1 | Scarred, plus `structure_burning` every 650 ms |
| Band 0 | Shroud for 2.4 s (dense for about 0.84 s) and an instant mesh swap at 420 ms. The wreck settles for 0.35 s (a Y-scale ease from 0.4), the collapse flash fires, and `structure_collapse` adds light 7 x power, shake 12 px and a 90 ms hit-stop. Then a rubble decal at 1.2x the half-diagonal and a plume. Nothing falls, nothing is thrown away from the hit side, and the building does not fall in stages |

## 2. Magnitude: one rule from `splash_tiles`, flavour from a class

**The rule (data, never code).** For a weapon with splash `S` tiles (sim damage falls off linearly,
`1 - d/S`, so half damage is at `S/2`):

- inner shock ring = `1.0 x S`: bright, the real damage reach, exactly;
- outer pressure wave and dust skirt = `k x S`, faint, with `k` per class (1.6 for the heavy classes).
  **The outer part is not damage**: nothing past `S` is hurt, and the inner ring stays the readable
  danger line;
- fireball radius = `f x S`;
- crater radius = `c x S`;
- scorch radius = `s x S`;
- light radius = `2.5 x S`;
- debris count = `d x S^2` (it scales with area).

The class supplies `f`, `c`, `s` and `d`, plus the column height, the light intensity, the shake and the
hit-stop, and `k`. A weapon with no splash (tank round, most ATGMs, RPG-7, SPG-9) draws no ring, because it has no
reach to show, and takes its class's nominal size. Crater depth needs no new parameter: `craterHeight` is
already in units of the crater's own radius, so a 0.96-tile crater is twice as deep as a 0.48-tile one.

**Where it lives.** A new `data/vfx/munitions.json`, validated against a new
`vfx_munitions.schema.json`, holds the `classes` rows below plus `weapons`, a map from `weaponId` to
class. It also holds `support` (from `FIRE_SUPPORT` profile to class, with that profile's splash copied
and a pinned test against `tuning.ts` as text, the `PROJ_SPEED` precedent) and `charge` (`placed_charge`
to class, reach `blast_tiles`). `S` is read from the weapon JSON itself, so the two can never disagree.
Sim JSON gains no field. The renderer resolves the class once, in `onFire`, and carries it on the
`ShellModel`.

| Class (weapons) | f / c / s | Fireball r | Ring: inner `S` / outer `k x S` | Debris (count, throw, apex) | Dust column, life | Light (I, r, decay) | Shake, hit-stop |
|---|---|---|---|---|---|---|---|
| `grenade` (`gl_40` 1.2; bomblets 0.5-0.8) | 0.20 / 0.25 / 0.45 | 0.24 t | 1.2 t, 160 ms / none (k 1.0) | 8 clods, 1.2 t, 0.6 t | 0.8 t, 2.5 s | 0.8, 3 t, 150 ms | 0, 0 |
| `mortar` (`mortar_60` 1.8, `mortar_82` 2.0) | 0.28 / 0.25 / 0.45 | 0.56 t (82) | 2.0 t, 220 ms / 2.5 t, 400 ms (k 1.25) | 16 + 6 chunks, 2.0 t, 1.4 t | 1.6 t, 5 s | 1.6, 5 t, 380 ms | 2 px 300 ms, 0 |
| `direct_he` (`gun_120`, ATGMs, RPGs, `warhead` 1.3, `hellfire` 0.8) | nominal 0.5 t | 0.5 t | none (warhead 1.3 t / 1.6 t, k 1.25) | 12 + 8 chunks, 1.6 t, 1.2 t | 1.2 t, 4 s | 2.6, 3.5 t, 200 ms | 2 px 140 ms, 0 |
| **`heavy_artillery` (`howitzer_155` 2.4, `grad_122` 3.0)** | 0.50 / 0.40 / 0.60 | **1.2 t** | **2.4 t, 260 ms / 3.84 t, 520 ms (k 1.6)** | 36 + 18, 2.4 t, 3.0 t | **4.0 t**, 6-9 s | 3.2, 6 t, 450 ms | 4 px 360 ms, 0 |
| `air_strike` (profile 0, S 2.0; today's approved values) | 0.80 / 0.70 / 1.20 | 1.6 t | 2.0 t, 300 ms / 3.2 t, 560 ms (k 1.6) | 48 + 24, 3.5 t, 3.5 t | 5.5 t, 9-12 s | 6.3, 7 t, 520 ms | 7.5 px 520 ms, 60 ms |
| `demolition` (`charges` 1.2, `vest` 1.6, placed charge 2.5) | 0.30 / 0.20 / 0.40 | 0.75 t (2.5) | 2.5 t, 240 ms / 3.5 t, 480 ms (k 1.4), dust-toned, hugging the ground | 30 masonry, 2.5 t, 2.5 t, thrown AWAY from the wall | 3.0 t, 8 s | 3.0, 5 t, 300 ms | 5 px 400 ms, 40 ms |
| `blade` (`dozer_d9`) | none | none | none | 4 chunks per puff, 0.5 t | today's puff | none | 0, 0 |

Inner ring: ease-out growth over its time, alpha HELD at 0.6 to 70% of that time and then linear to 0 (mock
v2: a linear fade from the start left it near 0.05 at its own reach), with a 120 ms `vfx.white_hot`
leading edge, at `FX_RENDER_ORDER_ADDITIVE`. Outer wave: a non-additive `dust.2` annulus at alpha 0.3 to 0. It starts when the inner ring peaks and
is drawn at `FX_RENDER_ORDER` under the inner ring. Its dust skirt is flipbook dust at alpha ≤ 0.35.

Where the general rule collides with an approved GH-748 number, the approved number wins as an explicit
override. The strike keeps a scorch of 2.4 (1.6 on relief), larger than its 2.0 splash, and a light radius
of 7. The barrage round keeps `barrage_impact` at strength 0.8. Both gain only the reach rule: the inner ring is
`S` (1.0 for the barrage, and 2.0 for the strike against today's 2.2), and the outer wave is `k x S`.

The ladder `fx-ladder.test.ts` holds (collapse > vehicle kill > shell landing) is kept. Heavy artillery's
light of 3.2 sits under a kill's 3.5. The test learns to read the new classes: a ladder that skips them
would guard nothing.

**The anchor, `howitzer_155`, today against proposed:**

| | Today | Proposed (revision 2) |
|---|---|---|
| Fireball | 1.22 wu billow (the mortar's) | radius 1.2 t (the half-damage disc), plus 5 lobes thrown 2.0 t |
| Inner shock (the damage) | none | 0 to 2.4 t in 260 ms (ease-out), alpha 0.6 held to 182 ms then to 0 at 260 ms, a 120 ms `vfx.white_hot` leading edge. At 213 ms it stands at 2.32 t (97%) at alpha 0.36 |
| Outer pressure wave (not damage) | none | 2.4 to 3.84 t from 260 to 520 ms, `dust.2` at alpha 0.3 to 0 |
| Dust | 9 billows, 4-6 s | a column of 14 billows to 4.0 t high, 6-9 s, plus a skirt of 20 smaller overlapping billows (r 0.4-0.52 t) out to 3.84 t, 3-4 s, alpha ≤ 0.35 |
| Debris | 16 dirt | 36 clods + 18 chunks, thrown 2.4 t, apex 3.0 t |
| Crater / scorch | 0.45 / 0.88 | 0.96 / 1.44 |
| Light | 1.26 over 4 t, 380 ms | 3.2 over 6 t, 450 ms |
| Shake / hit-stop | 1.5 px / 12 ms | 4 px, 360 ms, falloff 12 t / 0 |
| On a building | a centroid puff | a hole of r 0.5 t on the hit face (§3a), plus chunks |

The fireball radius is a MEASURED claim (§4), not a billow scale trusted from the code. One caveat for the
lead: the sim gives the 155 only 1.2x the 82 mm's reach (2.4 against 2.0). The inner ring tells that truth, and the outer wave
reads the size the lead asked for without lying about damage. The rest of the "much bigger" look is energy: a 2.1x fireball, a 2.5x column, a 1.9x crater and 2x the light.

## 3. The building reaction

The data is the same table. A building hit takes the class's debris and dust, centred on the HIT FACE.
That face lies along the line from the footprint centre toward the shooter (direct fire) or the landing
point (indirect fire, strike or charge). It is never the centroid. Stages key on `structureHpBand`, the
eighths the scars already use:

1. **Every hit (bands 8-1).** The building takes a **real hole** at the hit point (§3a). Chunks come off
   the hole. Their spawn points are area-weighted over the template's own triangles within the hole's
   radius (64 samples per octant, precomputed once per template at load, hash-seeded), and they are
   thrown along the face normal ±35°. Today's band scars stay as they are.
2. **Partial collapse (on first entering band 2).** The upper hit-side quadrant sags. It is a
   vertex-shader drop of 0.25 of a storey on vertices above 0.6 of the height and on the hit side, with a
   smoothstep edge. That gives a one-off burst of 16 chunks and 8 dust billows. No art is involved.
3. **Final collapse (band 0).** **Today's shroud is unchanged**: 2.4 s, hold fraction 0.35, cover 1.25,
   the swap at 420 ms, the 0.35 s settle. **Flying debris is added**: 40 chunks for a 3x3, scaled by
   footprint area and **capped at 48 a building** (an uncapped house threw 70, mostly hidden), launched from the roof line between 0 and 300 ms. They are biased 60/40 away from the
   last hit side, thrown 1.5-3.0 t with apex 2-4 t. They fly over and through the shroud, which is
   `depthTest: false` at band 5, so a chunk inside the cloud is hidden by it, as real masonry would be.
   They land after it thins. Per-tile walls take the same debris, 6 chunks a tile.
4. **Rubble settles, then fades.** Each chunk flies a CLOSED-FORM parabola: one bounce at restitution
   0.3, then a slide to rest. Its rest pose is computed once at spawn from a presentation hash
   (`tileHash(structure, k)`) and from `ground-height.ts`, so it is independent of frame timing and
   reproducible in a capture. Under `setQuiet`, chunks are placed at rest with no flight. A settled
   chunk stays inside the rubble decal's radius. **After 90 s it fades into the decal** over 1.5 s on
   the SIM clock.
5. **Dust.** Flipbook `smoke` billows in dust tones (`dust.2` to `dust.4`), from the existing atlas and
   pool. A hit: 6 billows, 3 s. The collapse keeps its shroud and plume, plus 12 billows from the
   landing debris.

### 3a. Real holes, with no authored art per building

**Mechanism: a shader cut-out, depth-correct, with a dark interior.** Each holed building keeps up to 6
holes in uniforms on its own material clone. A hole is two `vec4`s in the template's object space:
`(centre, radius)` and `(axis, depth)`. The axis is the facade normal for a direct or flanking hit, and
UP for a round that lands on the roof, so mortar and artillery punch roofs.

The fragment hook (the `team-mask.ts` precedent: an object-space test in `onBeforeCompile`) works like
this:

- **Discard.** A face is discarded inside a cylinder: radial distance < `r x (0.85 + 0.30 x e(θ))` and
  axial distance < `depth`. `e(θ)` is hand-rolled value-noise fbm, 4 octaves, sampled ON A CIRCLE in θ so
  it wraps, seeded by the hole: ±15% of the radius, broken masonry rather than a shape. (Revision 2's
  `sin(5θ)` at ±25% drew cartoon stars in the mock.) `depth` is 0.6 t, so a hole cuts the near wall and
  never the far one. It is ALU in the fragment shader (the same lattice hash as the flipbook bake), so
  +0 textures.
- **Cracks.** Six thin dark wedges a hole, at hashed angles, run 0.05-0.1 t out from the edge, ±2.6° at
  the root and tapering to a point, in `shadow.1` at 0.9. They are surface marks, not cuts.
- **Interior.** The material becomes `DoubleSide` once it has a hole, so through the hole the player
  sees the BACK faces of the far walls, floor and roof. These are real geometry with correct depth, and
  they are shaded as interior: the darkest key of the type's own ramp, mixed 0.6 toward `gunmetal.2`
  (the charred key), with flipped normals and no environment map. **What shows through is a dark,
  correctly occluded room**, not the sky, and not the ground behind the building.
- **Lip.** A 0.03 t band just outside the cut, one ramp key DARKER than the wall (`limestone.4` on a
  `limestone.3` house), stands in for the broken wall's thickness. In mock v2, without it a wall hole
  reads as a soot stain; the 0.06 t `limestone.2` lip of revision 2 read as a cookie-cutter outline. A
  0.15 t char halo (`gunmetal.3` at 0.7) lies beyond it.
- **Optional detail (cheap, in the mock):** 3 bent rebar stubs a hole (`gunmetal.2`, 0.08-0.15 t, rooted
  on the edge) as 3 instances of one 10-triangle stub in the debris pool, +0 draws. And a dust streak
  below a wall hole (`dust.1` at 0.45, 0.25-0.65 r wide, fading over 1 t) in the same hook.
- **Shadows.** The same hook goes on the clone's `customDepthMaterial`, so the hole cuts the sun's
  shadow too: light falls through it onto the floor.
- **AO.** AO is the exception. It draws through `scene.overrideMaterial` (`MeshNormalMaterial`), so it
  sees the wall as solid. The cost is a little extra darkening at the hole, which is dark anyway;
  measured in P4, and accepted unless the lead's eye says otherwise.

**Size and count by class.** The radius sits on the wall, in tiles:

| Class | Hole r | Axis |
|---|---|---|
| `grenade` | 0.12 (only from splash; `gl_40` cannot target a structure) | wall |
| `mortar` | 0.25 | roof |
| `direct_he` (tank HE, ATGM, RPG) | 0.30 | wall, at the hit height clamped to 0.3-0.8 of the building |
| `heavy_artillery` | 0.50 | roof, or wall on a flanking landing |
| `air_strike` | 0.80 | roof |
| `demolition` | 0.60 | wall, at door height |
| `blade` | no hole | — |

At most 6 holes per building. A new hit within 1.2 r of an existing hole grows that hole by 25%, capped
at 1.6x its class radius, instead of taking a slot. A seventh distinct hole grows the nearest hole. So a
battered building reads as more and bigger breaches, never as a sieve. Holes survive band changes: the
hole clone is rebuilt from that band's scar clone, and the hook is re-applied after every
`Material.clone()`, which drops `onBeforeCompile`.

**Why not pre-cut panels.** The shipped buildings are Meshy remeshes with baked textures. They have no
facade or panel topology to swap, so pre-cut panels would mean authoring and baking every type again.
The shader route needs no art, works on every textured and palette GLB, and holds for buildings added
later.

**Scope.** Clone-drawn buildings only, in P4. A per-tile wall is instanced, and its single hole per tile
would be an instance attribute; that is P4b, a lead decision. A holed house keeps its full art below zoom
2.0, as a scarred house already does (the LOD1 twin is clean-band only). The WebGPU node backend owes a
twin: until it has one, the material census lists the hook as `partial` (`webgpu-backend.md`).

**Cost of the holes** (estimates; `perf:fx --breakdown` measures them in P4):

| | high | medium | low |
|---|---|---|---|
| Draw calls | +0 (same mesh) | +0 | +0 |
| Triangles submitted | +0. Back faces of HOLED buildings are now rasterised, but mostly fail the depth test behind their own front faces | same | same |
| Programs | +1 colour (`RL_HOLES`, `DoubleSide`) and +1 shadow depth, both prewarmed at boot | same | +1 colour only: 1024 shadow map, holes not cut into the shadow |
| Textures | +0 (palette tones and hash noise) | +0 | +0 |
| Materials | +1 clone per holed building per material: about 30 in a town fight, 1 KiB of uniforms each | same | same |
| Fragment | discard turns off early-z on holed buildings only: ≤ 0.15 ms for 30 on screen | ≤ 0.15 ms | ≤ 0.1 ms, no rim band at `fxDetail` 0 |

**Why an unhit map stays bit-identical.** The hole clone is minted on a building's FIRST hole and never
before. A building with no hole draws its band material, untouched, and the prewarm compiles the program
without drawing anything. So a map where nothing is hit binds no new program, material or side. No gated
scenario damages a building before its capture tick (`building-damage.ts`'s own claim, held by the
`visual` job).

**Debris art, no new per-building art.** There are three shared procedural chunk shapes (slab 12 tris,
block 20, shard 8), built in code, one `InstancedMesh` each. A chunk's colour comes from its type's
`structures.json` `color` key and the two darker keys on that ramp (higher index, because **ramps descend
in brightness**). A charred chunk takes `gunmetal.2`.

**Pool and clocks.** The chunks are GPU-aged, like the flipbook: per-instance spawn attributes, and the
vertex shader evaluates the flight. The CPU writes only at spawn. The flight runs on the FX frame clock,
so hit-stop freezes it mid-air. The fade runs on the sim clock. The chunks draw at `WORLD_RENDER_ORDER`
(opaque world geometry, as for buildings), are kept out of AO (`userData.rlAoExempt`), and cast shadows
on `high` only. Any new gain (for example `shockRing: 1.6`) goes in `HDR_GAINS`. A unit behind a flying
chunk shows its occlusion outline for a few frames. That is correct.

**Keeping the fight visible (all checked in §4).**
- No chunk is bigger than 0.35 t (16 px at zoom 1).
- Settled rubble stands no higher than 0.12 t, below an infantryman's knee.
- Hit dust peaks at alpha 0.55. The outer pressure wave (0.3) and its skirt stay ≤ 0.35. After 0.6 s every
  presentation dust stays ≤ 0.45, under the smoke screen's 0.72. Dust is not cover in the sim, so it
  must never read as concealment.
- The collapse shroud is today's, by ruling.
- Dust coverage over alpha 0.3, per event, at zoom 1 (1440x900): an air strike ≤ 6% of the screen at
  1 s and ≤ 2% at 4 s; a 155 round ≤ 3% at 1 s.
- Holes only ever REVEAL.

**Debris cost:**

| Preset | Chunk pool | Draw calls | Worst-case triangles | Frame |
|---|---|---|---|---|
| high | 1024 | +3 colour, +3 shadow | ≤ 49k | ≤ +0.1 ms (measured ~1 ns per triangle) |
| medium | 512 | +3 | ≤ 12k | ≤ +0.05 ms |
| low | 0 (dirt flipbook only, `low_fraction` 0.5) | +0 | 0 | ~0 |

Every preset adds +2 draws for the two-part ring while it is live, and at most 76 extra flipbook billows
for each heavy round, inside the existing 2048. When the pool is full, a lower `budget_priority` event
spawns `ceil(count x free/needed)` and never steals a live chunk. A Grad salvo (20 x 84 chunks asked of
1024) therefore thins out rather than stutters.

## 4. Phases (each one ships alone)

Capture conditions for every witness: Metal (ANGLE), 1440x900 @2x, music off, own port (never 5177), the
tick stated, one browser.

| Phase | Ships | Witness | Each new check, and the input that turns it red |
|---|---|---|---|
| **P1, the anchor: splash-derived blasts and the two-part ring** | `munitions.json` + schema, class routing in `onFire`, the class carried on `ShellModel`. Existing flipbook, light, shake, crater and scorch, rescaled. Inner and outer rings for every class with a reach. The 155 ships with the numbers in §2 | `blast:capture` gains `howitzer_155`, `mortar_82`, `grad_122`, `gl_40` and `dpicm_155`. Each reports both ring radii in px and the fireball's radius at 200 ms | (a) Coverage: every weapon with `splash_tiles` or `submunitions` resolves a class. Red: delete `howitzer_155` from the map. (b) Inner ring = `S` ± 10% in px. Red: inner multiplier 0.5. (c) Outer ring = `k x S` ± 10%, and outer > inner. Red: `k` 0.9. (d) Fireball order grenade < mortar < heavy < strike. Red: swap two rows. (e) Ladder covers the classes. Red: heavy light 4.0 against a kill's 3.5. (f) Raw hex in `munitions.json`. Red: `validate:data` |
| P2, the debris pool | GPU-aged chunks and terrain clods | `blast:capture` `debris` toggle floor (a third of the smallest of 3 runs). `perf:fx` on all three presets | Floor. Red: no-op `spawnDebris`. Rest poses bit-identical over two captures. Red: integrate per frame with `dt`. Low has 0 debris draws. Red: ignore `fxDetail` |
| P3, the building hit | Hit-face chunks and dust at the face | New `building-hit:capture`: hand-ticked series of 1, 3 and 6 hits on a house, from E and from S | Hit side: mean chunk velocity · (shooter - centre) > 0. Red: flip the sign. Versus: nothing for a hostile hit in fog. Red: drop `hostileEffectVisible` (`versus-leaks.test.ts` style) |
| **P4, real holes** | §3a for clone-drawn buildings. P4b: per-tile walls, if the lead says so | `building-hit:capture` adds a `holes` toggle floor, and flip pages from three angles at zoom 1 and 2 for the lead's eye | (a) `holes` floor. Red: make the discard a no-op. (b) Interior is dark: mean luminance inside the hole mask < 0.5x the wall around it. Red: shade back faces with the front material. (c) Never cuts the far wall: a unit test over the cylinder. Red: `depth` = infinity. (d) An unhit sim mints 0 hole clones. Red: mint one at load. (e) Six-hole cap and the growth rule. Red: cap 7. (f) Shadow is cut too: a toggle on the shadow-map photograph. Red: drop `customDepthMaterial` |
| P5, staged collapse | Band-2 sag, flying debris under today's shroud, settling and fading, a gated `rubble` scenario (a dated collapse showcase with chunks at rest at sim time 0, the `aftermath` pattern) | Collapse flip pages (the lead judges motion). `rubble` gated | `debris` and `rubble-settle` floors. Red: no-op placement. Nothing below ground. Red: rest y - 0.05. Fade at 90 s on the sim clock: two ticks pinned either side. Red: fade on the frame clock (bimodal) |
| P6 (optional), demolition | `chargeDetonated` drawn, directional. The D9 throws chunks along its blade | `blast:capture` `demo_tzav` | Direction: mean velocity · wall normal > 0. Red: flip it |

**The visual gate.** `quiet`, `open-ground`, `vehicle`, `relief`, `kitted`, `fogged` and `aftermath`
frame no live blast and no damaged building. They must read **0 px** in every phase, and any move there
is a defect, never a bless. For P4 that is the "unhit map" argument in §3a. Its falsifier: put one hole
on every building at boot, and the gated `quiet` and `relief` frames (both of which show buildings) must
go red. `aftermath` stamps its craters through `craterRadiusTiles`, which is unchanged; the classes only
choose its inputs. `combat` and `dusk` (report-only) move from P1 on, and P4 moves them most. That is
stated in the report, not blessed. P5 adds `rubble`: exit 1 until its post-merge bless from CI numbers.
A bless is judged on the picture, frame pairs looked at:
- holes dark and ragged, never through to the sky;
- chunks inside the rubble decal, none floating and none under the ground;
- dust under its ceilings.

## 5. Decisions

**Ruled (9 Nov):** the data file; hit-stop only on the strike, demolition and the collapse; Grad in
`heavy_artillery`; no 3D debris on low; rubble fades to its decal at 90 s; today's shroud plus flying
debris; real holes; a two-part ring.

**Still open (recommendation first):**
1. **Approve the revised §2 table, the 155 anchor and the §3a hole sizes**, so a mock can be rendered.
2. **Six holes per building**, with growth rather than new slots past that, rather than an unlimited
   count.
3. **Indirect fire punches ROOF holes** (recommended), rather than every hole going on a facade.
4. **Per-tile walls get holes later (P4b)**: one per tile as an instance attribute. Or walls keep debris
   only.
5. **Accept that AO does not see holes** (recommended unless the mock shows a halo), rather than routing
   AO through the hole hook.

**Word pictures at game zoom 1.** Scale: a ground distance of one tile spans 45 px along the screen
(the tile's diamond is 64 x 32 px), and one tile of height spans 39 px. The pixel figures in revision 1
were computed at 64 px a tile, which is the diamond's width rather than a distance, so every one of them
was √2 too large. They are corrected here.

A. 82 mm and 155 mm landing 6 tiles apart, at 300 ms:
```
   82 mm                                   155 mm
     .  *  .                                 ,(@@@@),       column climbs to ~157 px by 2 s
   ( ##### )   fireball r 25 px            (@@@@@@@@@@)     fireball r 54 px
 -----O-----   inner ring 90 x 45 px   ::::------O------::::  inner 109 x 54 px (the 2.4 t that hurts)
  ::     ::    outer 113 x 57, faint   outer pressure wave 174 x 87 px from alpha 0.3 (3.84 t, no damage)
                                         crater r 43 px, scorch r 65 px; 4 px shake for 360 ms
```
B. A Lavi's HE round on a house from the east, hit 3 of 6. Three ragged holes on the EAST face, r 14 px,
the first grown to 17 px. Through them is a dark interior. About 20 chunks, each ≤ 16 px, land within
72 px of the face, and 6 dust billows (alpha ≤ 0.55) are gone by 3 s. The west face is clean.

C. An apartment hit on the roof by a 155 round: a 23 px roof hole. At its collapse, today's shroud
swallows the block for 0.84 s while chunks arc out 68-136 px. By 3 s the chunks lie on the rubble decal,
≤ 5 px tall. At 90 s they fade into it.

## 6. The mock (9 Nov; v2 after the coordinator's fixes)

**Files.** Kept outside the repo, in `/Users/ilpinto/dev/roaring-lions-ep/_coord/gh1197-mock/`, with the
script `gh1197_mock.py` (v1 kept as `gh1197_mock_v1.py`). The renders are Blender 5.2 Eevee at 960x640.

- **Framing** is the game's: orthographic, elevation 30°, azimuth 45°, a tile at 45 px along the screen
  at zoom 1. The sun is `SUN_DIRECTION` and the house is `art/meshes/buildings/house.glb` at
  `MESH_SCALE`.
- **Colour.** Every authored colour is a `data/palette.json` key; the house keeps its Meshy bake.
- **Noise** is the hand-rolled lattice hash from `bake_flipbook_atlases.py`, never `mathutils.noise`.
- **Light.** v2 corrects the sun strength for Blender's 1/π (2.9), so no relight step is needed. Lit
  bare ground reads (207, 182, 141) against `limestone.2` (217, 199, 167). v1's `_lit` frames are
  superseded.
- **Sessions.** v2 took two short headless sessions, not one. The first rendered the three blast frames
  and failed on the house frames: a float seed reached the integer hash. After the fix, the second
  rendered only the house frames, about 7 s of rendering.

| Frame (v2) | What it shows |
|---|---|
| `a_155_blast_early_v2.png` | A true frame at 213 ms: fireball r 1.2 t; inner shock at 2.32 t (97% of 2.4) at alpha 0.36 on the held curve; 36 clods + 18 chunks in flight (most still inside the fireball at this age); scorch r 1.44 t. Dashed reference marks at 2.4 t and 3.84 t |
| `a2_155_outer_wave_v2.png` | 330 ms: the inner ring is spent; the outer pressure wave at r 3.07 t, alpha 0.22 on its way from 0.3 to 0 |
| `b_155_blast_3s_v2.png` | 3 s: a column of 14 billows to 4.0 t at alpha 0.42; a skirt of 20 smaller overlapping billows out to 3.84 t; crater r 0.96 t; scorch r 1.44 t; 54 pieces at rest within 2.4 t |
| `c1_house_holes_v2.png`, `c1_house_holes_z2_v2.png` | `house.glb` at zoom 1 and 2: a roof hole of 0.5 t (roof axis), a +X wall hole of 0.3 t, a -Y wall hole of 0.375 t (0.3 grown 25%). fbm edge at ±15%, 6 cracks of 0.05-0.1 t each, lip 0.03 t `limestone.4`, char halo 0.15 t, rebar stubs, a dust streak under each wall hole, a dark interior through every hole |
| `c1_house_holes_z2_v2_nolip.png` | The same with no lip, for the lip decision: the wall holes read as soot stains, so the lip stays |
| `c2_house_collapse_v2.png` | Mid-collapse at the 420 ms swap: today's dense shroud, unchanged, with 48 chunks (the cap) of ≤ 0.35 t, thrown 1.5-3.0 t, apex 2-4 t |

**What changed from v1, and what is still open:**
- The star edge is gone: the fbm edge with cracks reads as broken masonry at zoom 2. At zoom 1 a 0.3 t
  hole is about 14 px, and the cracks are near a pixel wide.
- The rebar stubs barely register at zoom 2 and not at all at zoom 1. They are optional; I recommend
  dropping them unless the lead wants them for close zoom.
- The dust streak reads as a warm tint below the wall hole.
- The fireball is flat spheres in the mock; the game draws it with the flipbook, so judge its SIZE here,
  not its look.
- At 213 ms most debris is still inside the fireball, which is the ballistics (2.4 t over about 1.5 s),
  not a defect.
- The skirt still reads as a ring of puffs in a still; the flipbook's soft billows should merge it in
  motion.
- AO is not modelled, so the halo question stays open until the P4 capture.
