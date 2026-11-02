# Look uplift: environment light, grade, unit materials, crowds

Status: **L1 SHIPPED 2 Nov 2026 (GH-943); L2-L5 design, not started.** L1's numbers were judged on a mock
sheet and the lead shipped its middle column (the census-solved hemisphere 0.70 / 0.82 / 0.65, not the
starting 0.5 / 0.6 / 0.47; glass 0.6, props 0.3). The rest of §7 still waits on the lead
(approve art numbers before any render). Written 2026-11-01 after the lead
asked whether three.js can reach the visual level of a Unity title. Revised the
same day after the review in `_coord/look-uplift-review.md` (three factual
corrections, the 1 Nov GH-746 rulings, and the GH-705 rulings folded in).

## 0. Why this exists

The answer to the lead's question is yes, and the gap is not the engine. What
ships today (`packages/render/src/three/`) is already a modern pipeline:
`MeshStandardMaterial` everywhere, ACES at exposure 1.0, a side sun with a
camera-fitted 4096² shadow map, GTAO, quarter-resolution HDR bloom, SMAA,
ground decals, haze and three time-of-day presets.

**Relation to the Defilade look (GH-705).** GH-705 T1-T5 cover sun, shadow, AO,
bloom, decals and VFX, and are not repeated here. Two items of GH-705 bind this
spec:

- **Task 6 (unit materials and readability) SHIPPED in PR 773 (2b8a00ec6, 23 Oct).**
  It gave each node role its own roughness and metalness through the role ramps in
  `units/unit-surface.ts` (no Fresnel rim; metal capped at 0.45; a `unit-surface`
  toggle floor). L1 edits the same file and the same quantity (how metal reads), so
  it rebases the table T6 settled, not one it is about to replace (§8). This line
  read "still OPEN" until 2 Nov and was stale: the sequencing constraint it states
  was already met.
- **The S4 ruling of 23 Oct was "keep today's lighting"** (mocks in
  `_coord/defilade-25/lighting-mock*`). L1 changes the lighting model (it lowers
  the hemisphere and adds an environment term), even though its intent is the same
  frame brightness. It is therefore introduced as a lighting change: a before and
  after mock sheet against that ruling, and the lead's explicit approval, before
  any code lands (§2).

Four things a commercial engine gives by default are still missing. This spec
orders them by visual return per unit of work:

| Phase | What | Visible change | Cost |
|---|---|---|---|
| L1 | Image-based (environment) lighting | metal, glass and wet surfaces read as materials; shade gets sky colour | days |
| L2 | Colour grading LUT | a filmic, per-map, per-time-of-day mood | days |
| L3 | Normal/ORM maps and a team mask on unit textures | unit detail at close zoom: panel lines, wear, normals | weeks, Blender time |
| L4 | Vertex animation textures for infantry | lifts the draw-call ceiling, if the triangle bound allows | weeks |
| L5 | WebGPU renderer spike | decides whether compute VFX and better shadows are worth a migration | a spike |

Nothing here touches `@lions/sim`. Every phase is presentation only.

## 1. What does not change

- The four invariants. No sim code, no tuning, no determinism pin moves.
- The palette stays the source of every AUTHORED colour. An environment and a
  grade are built FROM palette keys, never from a raw hex.
- The sun stays the side light `SUN_DIRECTION`. L1 adds ambient, not a sun.
- No world status marks (the lead's rule) and no kit overlay.
- `high` is the reference preset, and the golden baselines move once per
  phase, blessed from CI numbers only.
- `three` (and `three/addons/*`, which the eslint rule does not catch) is
  imported only under `packages/render/src/three/**`. `PMREMGenerator` is core
  three; `LUTPass` and any other addon stay inside that tree by discipline.

## 2. L1: environment lighting

**Today.** `envMapIntensity = 0` is assigned in exactly two places:
`world-materials.ts` (`texturedMaterial`, for the baked assets) and
`terrain/backdrop.ts` (the kit and olive materials). `units/unit-surface.ts` only
MENTIONS it in a comment. The ground, decals, smoke and FX meshes, props, glass
and every untextured unit part never set it. Today it has no effect for one
reason only: **nothing in the scene has an environment**. So L1 is not "replace a
blanket zero". It is **introducing the scene's first environment and then deciding
which classes opt out**, and the opt-out surface is every `MeshStandardMaterial`
that can see it, not two files.

With no environment, a metal surface keeps only the sun's specular lobe and no
diffuse term, so metalness is capped at 0.45 (`gunmetal`) and a painted-metallic
patch once drew near-black (`docs/agent-notes/mesh-units.md`). Ambient comes from
one `HemisphereLight` (`lighting.ts`), whose intensity is per time-of-day preset:
**0.75 dawn, 0.9 day, 0.7 dusk** (`time-of-day.ts`; `HEMISPHERE_INTENSITY` is the
day value), and a mission's `map.light.fill` can replace it.

**Mechanism (decided, because of how three 0.186.1 works).** In
`WebGLRenderer`, a `MeshStandardMaterial` with `envMap === null` and a non-null
`scene.environment` takes its `envMapIntensity` uniform from
`scene.environmentIntensity`, one global value. `material.envMapIntensity` is read
only when the material carries its own `envMap`. So `scene.environment` plus a
per-class `envMapIntensity` would do nothing per class: the ground (whose value
must be 0), decals, smoke and the textured bakes would all get the same number.

L1 therefore **assigns the PMREM texture per material class through
`material.envMap`, and leaves `scene.environment` null.** Consequences:

- A class that must not see the environment (ground, decals, smoke and FX meshes,
  backdrop kit and olives) simply never gets an `envMap`. That is exact zero, not a
  small number, and it keeps the ground's `NoColorSpace` ratio albedo meaning.
- A class that does (unit metal, unit dielectric, glass, the textured building and
  vehicle bakes) gets the one shared PMREM texture and its own `envMapIntensity`,
  from ONE table beside `unit-surface.ts`'s roles. The table lists every class
  explicitly: ground, decals, smoke meshes, props, units (metal and dielectric),
  buildings, glass, backdrop. A class missing from the table is a test failure, so
  a new material cannot silently inherit anything.
- A registry (`three/environment.ts`, new) owns the texture. It is built once at
  boot and REBUILT only when the time-of-day preset changes. A rebuild swaps the
  texture on registered materials; going null to non-null changes the shader
  program (`needsUpdate`), swapping one PMREM texture for another does not. The old
  texture is disposed once. Materials a system clones later (running gear moves a
  vehicle onto its own material clone on its first moving frame) must come out of
  `clone()` with the `envMap` intact; a test pins that.
- The ground shader (`terrain/mesh.ts`, `onBeforeCompile`) is out of the table by
  construction, but L1 must still read it and confirm no environment chunk runs.
- Rejected alternative: keep `scene.environment` and take per-class control through
  a shader hook on every material. It touches every shader and breaks silently on a
  three upgrade; the per-material route uses only public API.

**Change.**
1. Build a small sky environment at BOOT, not from an HDRI file: a gradient
   sphere coloured from the time-of-day preset's palette keys (sky `water.0`,
   horizon, ground bounce `dust.4`), rendered once through `PMREMGenerator`.
   **No sun disc**: the directional sun already supplies the sun's specular, and a
   disc in the environment would count it twice. No downloaded asset, so no licence
   question, and a palette revision reaches it.
2. Introduce the class table and registry above.
3. Lower the hemisphere intensity PER PRESET to hold the frame's exposure,
   measured by the luminance census rather than set by eye (starting points in
   §7), with `map.light.fill` scaled by the same factor, then lift the metal cap
   from 0.45 to the value in §7.
4. Add an `environment` debug layer (`three/debug-layers.ts`) with a
   visible-toggle floor in `BaselineSpec.layerChecks` (a third of the smallest
   of three runs, as for every layer).

**Sequencing and approval.** GH-705 T6 has landed (§0). The mock sheet was shown against the 23 Oct
"keep today's lighting" ruling and the lead shipped its middle column on 2 Nov. It was built behind
`&envlight` while it was judged; it is now ON by default and `&envlight=0` is an A/B switch.

**Risks.** The textured buildings and vehicles (`TEXTURED_*_EXEMPT`) ship a bake
that already contains ambient, so they may brighten twice. Measure them
separately. The fog pass and haze read the lit frame, so a fogged tile is a named
scenario (below), not just a risk. The bloom census
(`tools/src/perf/bloom-census.ts`) must still hold every quiet frame under the 1.0
threshold, or bloom starts firing on sunlit metal.

**Done when.** The lead approves the mock sheet, the CI bless lands, the
`environment` layer check is red with the layer hidden, each class's intensity is
shown to take effect (gate 1 below), and `pnpm perf:load` plus the frame-time
readings show no regression past the preset budgets. Gates are in §8.

## 3. L2: colour grading

**Change.** A grade is DATA: `data/grades/<id>.json`, a schema in
`data/schemas/`, holding lift/gamma/gain, saturation, warmth and a split tone,
each built from palette keys. The renderer bakes it into a 32³ 3D LUT at boot
and applies it in one pass after `OutputPass` (display-referred), before the
vignette and SMAA. A 32³ LUT on 8-bit output can band in dark skies, so the pass
dithers, or the grade runs on a 16-bit target; the choice is measured on a dark
dusk frame. `&grade=` joins the sandbox flags in `sandbox-help.ts` and never
changes how a real mission scores.

**Identity rule, and the defaults it fixes.** An identity grade builds NO pass.
**Day is the identity grade**: a day map, or a map with no grade, draws the frame
it draws today, bit for bit, and moves no baseline. **Dawn and dusk** each ship
one graded preset. There is no "default for day", so the contradiction between
"neutral builds no pass" and "a default per preset" is gone: the table in §7 lists
two shipped grades, not three.

**Where the field lives.** A mission or map names its grade through the APP's
mission reading (a `gradeOf` beside `timeOfDayOf`), never in the sim's mission
type, exactly as `time_of_day` is kept out of it. A mission's own grade wins over
`&grade=`. `data/grades/` is registered in `packages/data/src/index.ts` (an
unregistered file is silently inert, as for `vfxEmitters`), with an `index.test.ts`
pin that holds the array equal to the directory.

**Quality.** The pass is cheap, so it runs on all three presets, gated by a
GPU-timer reading before `low` gets it.

**Risks.** A grade can undo the readability work (team colours, CVD variants).
This is a tool gate, not an approval step (§8): team colours must stay inside a
colour-difference floor under each grade; one that collapses is a refusal, not a
tune. `dusk` and `combat` captures are report-only in the visual gate, so a dusk
grade is NOT covered by the baseline; §8 names what covers it.

## 4. L3: normal and ORM maps, and a team-colour mask

**Today.** The "a GLB carries zero materials" rule is stale prose, not the code.
`tools/validate_mesh_assets.py` already waives it by class, in three pinned sets:
`TEXTURED_BUILDING_EXEMPT`, `TEXTURED_VEHICLE_EXEMPT` (about 15 ids, `mbt_lavi`,
`ifv_namer`, `technical`, `gun_truck`, `apc_eitan`, `apc_kipod`, `dozer_d9`, ...)
and `TEXTURED_INFANTRY_EXEMPT` (`at_team`, `demo_squad`, `militia_cell`,
`rpg_team`, `atgm_cell`, `mortar_crew`, `charge_squad`, `digger_crew`,
`breach_team`, `moto_rpg`, officers, `ugv_recon_dog`, `inf_squad`, ...).
`TEXTURED_MESH_EXEMPT` is their union, pinned against the TypeScript side by
`textured-infantry.test.ts`, `textured-vehicle.ts` and `textured-building.ts`. The
pipeline also stopped dropping metallic-roughness and normal maps at export on
2026-09-14 (`docs/agent-notes/mesh-units.md`), and the renderer binds whatever a
GLB carries. What is in use is base colour only.

**CLAUDE.md is stale and is not edited here.** Its "A GLB carries zero materials"
bullet (and its "Binding is rigid" bullet, which the 1 Nov GH-746 skinning ruling
already overturns for Meshy figures) describe a pipeline the code has left behind.
Flagged for the lead: amend both in the PR that lands L3's first pilot.

**What L3 genuinely adds** (the standing rule is not reversed, because the code
already left it):
1. Normal and occlusion-roughness-metal (ORM) maps as a deliberate, budgeted
   deliverable per unit.
2. A team-colour MASK, so team colour survives a full-colour texture and the four
   team-colour sets and `variantAwareResolver` keep working. How today's textured
   vehicle and infantry bakes take team colour is read in the pilot's first step, and
   the mask is designed against that.
3. A texture budget per class in `validate:meshes`.

**Needs a lead ruling on scope and budget**, not on a rule: which classes, what
texture memory.

**Recipe conflict with the approved Meshy pilot.** The f1 design
(`_coord/inf-meshy-pilot/design.md`, recipe) says "no `--texture-prompt`, no
`--pbr`": base colour only. So normal and ORM maps for Meshy infantry cannot come
from the current Meshy call. They are **baked in Blender** (normals from the 8k
refined mesh onto the ~10k remesh) and **authored** (ORM). That is Blender time,
not Meshy credits, and it is priced in the pilot's proposal before it starts; any
Meshy call is announced in the ledger first as always.

**Pilot.** The infantry pilot **is `inf_squad` f1 (GH-746)**; there is no second
infantry pilot. Normals and ORM are evaluated on it after the lead has seen the f1
close-ups. The vehicle pilot is one vehicle the lead picks. Neither starts until L1
has landed, because normal and ORM maps are judged under the new ambient, not the
old one. Max detail (the lead's standing art rule), with a garage close-up
approval render. Measure the texture memory with `pnpm perf:load` against the
memory gate before a second unit is started.

**Lineage.** This continues GH-286 and GH-179 (the bakes) and
GH-746 (textured, skinned Meshy infantry). GH-155 is CLOSED (14 Oct, superseded by
WP-A3.1: all 35 unit ids have a Meshy-based GLB) and is not a direction. The earlier
"art uplift Phase 3" is not a document in the repository and is dropped as a
reference.

**Pipeline impact.** `validate:meshes` gains a texture-budget check per class. The
`TEXTURED_*_EXEMPT` sets stay as they are; any class-level rule added must keep the
existing pin tests red when the Python and TypeScript sides disagree. The vehicle
pipeline order (export, rescale, running gear, kit, wreck, damage, encode) is
unchanged; the wreck char needs `extras.rl_bake_luma` on every textured unit.

## 5. L4: vertex animation textures

**Sequencing.** L4 waits on two things, in this order:
1. **The `inf_squad` f1 figure ships and is measured.** GH-746 (1 Nov) rules: a
   skinned, textured Meshy figure of about 10,000 triangles (cap 10,800; per figure
   at most 15,580; file at most 46,700), smooth weights to the existing skeleton, at
   most 4 influences, the rifle rigid on the hand.
2. **`tools/src/perf/three-units.ts` is repointed at the shipped GLB.** It, and
   `docs/PERFORMANCE.md`, still measure R0's STAND-IN spike GLB, not the shipped
   `meshy_soldier.glb`. That repointing is L4's first step, before any VAT work.

**Today, and what is measured.** Rigged infantry is draw-call bound because
`SkinnedMesh` does not instance; the render budget is crossed at about 1,150
figures (`docs/agent-notes/scaling-debts.md`). **That ceiling was measured on the
stand-in, not on a shipped figure**, and the same PERFORMANCE.md reads a render p95
of 30.0 ms at 266 living with real all-mesh rosters. It is cited as "unverified for
shipped figures", never as the baseline.

**The BEFORE number** is f1's `pnpm perf:load` plus the one 300-figure Metal
frame-cost run, taken on the shipped, repointed figure. The AFTER is the same two
measurements after L4, on the same GPU and backend, conditions recorded.

**Why the old promise is unsafe.** The ceiling is draw-call bound because triangles
were not the bottleneck at 1.5-2k per figure. VAT removes exactly the draw-call
bound, so afterwards triangles and vertex fetch ARE the bound: 1,150 figures at
15.6k is about 18 M triangles for infantry alone. At full detail the ceiling lift
will not materialise.

**Change.**
1. **A decimated battle-zoom LOD is what gets baked.** At game zoom a figure is
   about 50 px tall, so the 10k-triangle mesh is not drawn there. A decimated LOD
   (its target set from the AFTER measurement, not guessed) is baked into a
   position and normal texture at export time (a new pass after `gait:meshes`,
   before `encode:meshes`), and each team is drawn as an `InstancedMesh` with
   per-instance clip, phase and time scale.
2. **The full skinned figure stays** for the garage and close-ups, and the switch
   between the two is by zoom.
3. **VAT memory is an ESTIMATE, not a measurement.** The older "22-130 MB" in
   `scaling-debts.md` was for roughly 600-vertex kit figures. For the 10k team the
   rough arithmetic is about 8k vertices x 16 B (RGBA16F position plus normal) x
   about 100 baked frames, about 13 MB per figure variant and about 38 MB per team
   of three; a team at today's 1.5-2k triangles is about 7 MB. The decimated LOD
   cuts this. It is gated by `pnpm perf:load` and the memory gate BEFORE a second
   team is baked.
4. **Machinery VAT bypasses, each of which needs the same vertex displacement or
   the VAT figure disagrees with itself:**
   - the occlusion outline (`silhouette.ts`, `BackSide`), or it outlines the rest pose;
   - the shadow depth pass, or the figure casts a T-pose shadow;
   - the GTAO normal pass, or AO reads the rest pose;
   - the per-entity `AnimationMixer` crossfades and layering in `mesh-unit.ts`.
     A two-sample blend in the vertex shader covers a simple crossfade only.
     Layered playback (for instance a `moveFire` over a gait) is either baked as its
     own clip or left on the skinned path; L4's first design note decides which, per
     clip.
5. Crossfades become a two-sample blend in the vertex shader.

**Note on the old open question.** `scaling-debts.md` says the "no band crawl"
result needs re-verifying because the toon ramp was indexed by normal. The toon
ramp was retired at the lit renderer (2026-09-15), so the question is now
whether baked, lerped normals shade the same as live skinning under PBR. The
gate is a side-by-side capture at zoom 1 and 2.5, plus the pixel parity gate in §8
and `mesh_gait.test.ts` passing on the baked output. A bake of the skinned,
evaluated mesh is skin-agnostic, so the GH-746 skinning ruling does not block VAT.

**Done when.** The BEFORE and AFTER numbers above are recorded, the gait and
facing gates pass per figure, the outline, shadow-depth and GTAO passes each show
the animated pose (parity gate), and the memory estimate has been replaced by a
measurement.

## 6. L5: WebGPU spike

three.js ships `WebGPURenderer` with a node shader language (TSL). It would
enable GPU compute particles, better shadow filtering and more lights. This
phase is a time-boxed spike only: port the post chain on one map in a
`dist-*/` build, measure frame time against WebGL2 on the same machine, list
which custom shaders (fog pass, ground, decals, GTAO filter) need rewriting in
TSL, and check browser support at that time. The output is a decision sheet
for the lead, not a migration. WebGL2 stays the shipping path regardless.

**What decides it.** Frame time in ms at equal visual quality on the same GPU and
the same backend, conditions recorded (GPU backend, resolution, tick), against
WebGL2 on the identical scenario. There is no gate; the number is the sheet.

## 7. Numbers for the lead

Proposals to measure, not to ship. Each is approved on a mock sheet first.

| Knob | Today | Proposed start | How it is checked |
|---|---|---|---|
| Unit metal `envMapIntensity` | none (no environment) | 0.6 | gunmetal stops reading black at zoom 1 |
| Unit dielectric `envMapIntensity` | none | 0.3 | shade side picks up sky colour |
| Building bake `envMapIntensity` | 0 (set, inert) | 0.2 | textured bakes measured on their own |
| Ground, decals, smoke, FX, backdrop | no `envMap` | no `envMap` (exact zero) | gate 1: a pixel on the class stays unchanged |
| Hemisphere intensity, dawn | 0.75 | about 0.5, solved by census | quiet-frame mean luminance held within 2% |
| Hemisphere intensity, day | 0.9 | about 0.6, solved by census | same |
| Hemisphere intensity, dusk | 0.7 | about 0.47, solved by census | same |
| Metal cap (`gunmetal`) | 0.45 | 0.7 | no surface under 5% luminance in the sun |
| LUT size | none | 32³ | GPU timer on `low` |
| Shipped grades | none | dawn and dusk (day is identity) | team-colour and CVD tool gate |

The hemisphere starts keep the 2:3 ratio to today's value; they are the census's
first guess, not a derivation. A mission's `map.light.fill` is scaled by the same
factor. Metal 0.7 and environment 0.6 interact strongly; they are tuned together.
Nothing here changes the sun, the shadow or the exposure.

**As shipped (2 Nov 2026).** The hemisphere census did not reproduce "about 0.5 / 0.6 / 0.47": with the
ground, decals and smoke given exact-zero environment the ground-dominated frame loses its ambient and
nothing hands it back, so those starting values darken the frame 9 / 3 / 10%. The solved values are
**0.70 / 0.82 / 0.65**. Glass 0.6 and props 0.3 were unnumbered in the approval and shipped as picked.

## 8. Order and gates

**Order.** GH-705 T6 (landed, PR 773), then L1; then L2; then L3's pilots (after L1)
and L4 (after f1 ships and `three-units.ts` is repointed) in parallel lanes
(different files); then L5. Each phase lands on its own branch and PR, with its
own CI bless and its falsification in the commit message: the new layer check
hidden, watched red. No local `ui:routes`, `golden-baseline` or `ui:shots`; CI runs
them. At most one Metal browser check, on a port other than 5177, with music off.
Baselines are blessed from CI numbers only (`visual-baseline-bless`), never from the
branch.

**Per-phase gates.** A gate arrives with its falsifier or it does not arrive. Test
names below are proposals; the name is fixed in the phase's PR.

| Phase | Gate (pin) | Falsifier, to be run and watched red |
|---|---|---|
| L1 | `environment` layer check (`BaselineSpec.layerChecks`) | hide the layer; the check must fall under its floor |
| L1 | Per-class effect (`environment-classes.test.ts` plus one rendered-pixel read in the capture): a class set to intensity X changes a probe pixel, a class with no `envMap` does not; every material class is in the table | set unit metal to 0, or give the ground an `envMap`; the test must go red |
| L1 | Luminance census within 2% per preset, and `bloom-census.ts` quiet frames under 1.0 | raise the metal intensity until a sunlit surface exceeds 1.0 |
| L1 | A fogged-tile scenario (a tile under fog and haze, with a metal unit) | a deliberately double-counted environment must move it past its threshold |
| L2 | `grade-identity.test.ts`: an identity grade builds no pass and the frame equals the ungraded frame exactly | feed it a non-identity grade (saturation 1.01); the test must go red |
| L2 | `grade` layer check by the same pattern as L1 | hide the pass; red |
| L2 | `data/grades` registration pin in `packages/data/src/index.test.ts` | add a file to the directory without registering it; red |
| L2 | `grade-team-colours` tool gate: each team-colour set stays above a colour-difference (delta E) floor from the others, and under the CVD modes, with each shipped grade | ship a grade with a heavy single-hue split tone; red |
| L2 | A LUT texel pin (literal expected texels for a known grade) plus a gated scenario carrying the dusk grade, because `dusk` and `combat` captures are report-only and cover nothing | mutate one gain coefficient; red |
| L3 | Texture budget in `validate:meshes` (`tools/validate_mesh_assets.py`) | ship a 4096² map in a class budgeted at 2048²; the gate must fail |
| L3 | The existing exemption pins (`textured-infantry.test.ts`, `textured-vehicle.ts`, `textured-building.ts` against `TEXTURED_MESH_EXEMPT`) | add an id to the Python set only; red |
| L3 | A garage close-up comparison, before and after, lead-approved | (approval step, not a test) |
| L4 | `three-units.ts` BEFORE and AFTER on the shipped GLB, conditions recorded | (a measurement; the number is the gate) |
| L4 | Pixel parity: baked versus live skin at the same clip time, N frames, a per-pixel delta ceiling | bake one frame out of order; the ceiling must be exceeded |
| L4 | Outline, shadow-depth and GTAO each show the animated pose | leave one pass on the rest pose; red |
| L4 | `mesh_gait.test.ts` on the baked output, per figure | (existing) |
| L5 | none; the decision sheet states the ms number | (n/a) |

`dusk` and `combat` are captured but REPORT-ONLY in the visual gate, so a dusk look
is not covered by the baseline: L2's gated dusk scenario in the table is what
covers it. A report-only capture failure must not abort a run; a gated one is
fatal.
