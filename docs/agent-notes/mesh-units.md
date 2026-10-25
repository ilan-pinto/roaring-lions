# Mesh units: pipeline, motion, gait, vehicles, kit, wrecks

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 1588-2078, section "Mesh units / Known scaling debts" -->

### Mesh units

Every unit type draws as a 3D mesh -- rigged teams, rigid vehicles, and
`civilians` as four variant figures -- and since WP-A3.3 (2026-10-04) there is
no other path. It was an opt-in `&mesh` until the mesh flip (no player reached
through `ui/menu.ts` ever saw a mesh: that file builds `?mission=<id>` and
never appended the flag), then the default with a `&nomesh` billboard escape
hatch; both flags are now accepted and do nothing, so old bookmarks and doc
lines do not trip the unknown-parameter warning. `tools/src/mesh_roster.test.ts`
holds the precondition from the files on disk: every unit id has a GLB (and
civilians their four), every vehicle GLB carries `idle` and `wreck`, every team
`down` or `wreck`, every structure type a building and a `_wreck` GLB. A GLB
that fails to load at runtime draws a team-coloured proxy box with a
`console.error` naming it (`units/proxy-box.ts`) and a HUD note; a deferred KDF
buildable draws nothing until its GLB lands, and its dock tile says
"deploying" (the lead's ruling at A3.3, rather than loading every buildable
before deploy).

Meshes are roster-driven (`mesh-catalogue.ts`, `missionUnitTypes`: the types a
mission can field, the buildings its map stands, the decor families its tiles
use; KDF buildables deferred past deploy on a `resources` mission).
**Measure, don't recite:** `pnpm perf:load -- --mission=<id> --serve=preview
--tail=5000` prints what one level fetches and when (`--tail` keeps counting
after first-frame, where the late loads land; the harness stalled on every
mesh-only boot until A3.3 fixed its 'meshes only' match). The first reading
(beit_sahwan_1_recon, production build, cold, localhost) was 3,736 requests /
114.8 MiB, 3,665 / 61 MiB of it sprite sheets for types the mesh path draws as
models; steps 1-2 of `docs/superpowers/specs/2026-09-07-level-load-time-design.md`
cut it to ~170. The sheets that still loaded after the first frame (mesh
vehicles' wreck sprites) went with the retirement: see `docs/PERFORMANCE.md`,
"Retiring the sprite sheets", for before and after on three missions. That
spec ranks what is left (wreck meshes after the first frame, Draco, a service
worker for Pages' `max-age=600`, the first-frame gap). Pipeline: `tools/units/kit.py` (geometry)
→ `tools/units/rig.py` (armature + clips, authored as Python tables) →
`tools/export_mesh_team.py` → `art/meshes/<team_id>.glb` → **`pnpm motion:meshes`**
→ **`pnpm gait:meshes`** → **`pnpm encode:meshes`** → `assets/meshes/` →
`three/units/mesh-*.ts`.
**All three post-export passes are mandatory and their order is load-bearing** — the
motion pass re-times the legs the gait pass then measures, the gait pass writes
into `art/meshes/`, the encoder mirrors it into `assets/meshes/`, and any other
order ships a stale stride. Same shape, and the same rule, as `pnpm wreck:meshes`
for vehicles.

- **The motion pass (5 Oct) owns how infantry hold, kneel, stand and step**
  (`tools/src/meshes/motion/`, contract v5). Four things a later change will get
  wrong. **It refuses a file it has already been through** (`extras.rl_motion`):
  it rebinds vertices and warps tracks, so a re-run starts from the pre-pass
  bytes -- `--from=<rev>`, the rev recorded in `rl_motion.base`. The 8k Meshy
  sources most teams were cut from are not in the repo, which is why this is a
  GLB pass and not Blender work. **`rl_gait.strideM` is the PLANTED ground per
  cycle now, not a boot's peak-to-peak travel** -- the old reading played every
  walker's legs 1.8-2.9x too fast for their stride (feet treadmilling backwards
  at 0.8-1.95x body speed, 3.2-5.0 steps/s; charge_squad 7.9). The gate is the
  foot-skate oracle (`measureFootSkate`, a planted foot under 0.25 of body
  speed) plus a human-cadence band, not the multiplier. **A shooter's weapon
  rides `{prefix}_weapon`, not `forearm_R`**, and both arms are IK'd onto it;
  the shooting side is the anatomical RIGHT (rig.py's `_L` bones -- the B7
  retarget had mirrored every shooter onto his left shoulder). **The tubes keep
  the importer's carry in `idle`/`move`**; the hold only aims them. The runtime
  half: a team marked `squad` draws each figure on its own clip player walking
  its own path to its slot (`units/squad-rig.ts`), the kneel is read through
  `stanceOf(i)` (`units/stance.ts`, #402's `brace`/`braceTicks`,
  feature-detected), and recoil is a spine kick after the mixer, one figure
  per shot. Gates: `mesh_hold.test.ts` (hands on the weapon, eye on the bore)
  and `mesh_gait.test.ts`.
- **Nothing a living team draws is under the ground** (ground-fix and
  ground-debt, 6 Oct; `motion/ground.ts`, `motion/carry.ts`). Every rigged
  team is marked `ground` in `MOTION_TEAMS` (22; `sniper_team` and `moto_rpg`
  are in the pass for this alone), and in idle, fire, move and moveFire: a
  standing figure buried at REST is seated first, rigidly (charge_squad, whose
  baked sprint lean put its toes 26 mm in); a foot under 1 mm is planted at it
  by leg IK and the leg re-keyed at 120 fps PLUS every key the clip already had
  (a coarser root bends at its own keys), and any midpoint between two keys
  that still reads under is keyed too (a sprinter's foot sags 1.2 mm between
  120 fps keys); a figure with no ankle (every crew kneeling at its weapon) is
  raised frame by frame; a `prop` is seated, vertices, rest, keys and bind
  together; a turning wheel keeps its axle a radius plus 1 mm up while the
  bike bobs on it. Every grounded walker gets `feet.ts`'s ankle. The civilians
  are the one SMOOTH-skinned rig here, and are read through every weight
  (`restSkinnedVertices`) -- by the dominant joint alone they read 1.4-8.4 mm
  under after planting. Two carries: yah_a's sensor mast 20 degrees tip-up,
  and brc_point's shield (worn on his spine, 148 mm into the ground in the
  run) on a bone of its own, lifted 183 mm up the torso in move and moveFire.
  Two things to know. **Removing the walk's between-key dips moved the gait
  pass's reading**: `rl_gait.strideM` dropped 1.2-3.0% on the teams and 1.5-4.2%
  on the civilians (foot skate 0.026-0.070 after, ceiling 0.25; the sniper's
  crawl declares its boot travel and did not move), because the planted-speed
  weight is relative to the clip's own lowest sole; 1 mm and not the kneel's 3
  is what kept that smallest. And
  **the census is tree-wide**: `mesh_gait.test.ts` reads every rigged file's
  living clips, and what is under is recorded by number -- `BELOW_GROUND_DEBT`
  (empty since ground-debt) or `BELOW_GROUND_BY_DESIGN` (digger_crew's spoil
  heap, three spheres banked 60-139 mm into the ground so a mound shows).

- **`kit.py`'s "No armature." rule is now partly overturned.** Of its three
  reasons, only "blocky is enough at 25 px" fell — beaten by the project lead
  judging rigged motion better on screen. The other two stand, and reason 1 is
  why bones and clips are **authored in code and never hand-posed**, and why
  binding is rigid one-part-to-one-bone with **no weight painting**.
- Adding a part to `kit.py` makes `rig.py`'s `PART_BONE` stale. It **raises
  loudly** rather than leaving gear in bind pose. Extend it; never silence it.
- **A rigged GLB declares the stride its own legs describe, and the renderer
  matches playback to the ground** (2026-09-16, design
  `docs/superpowers/specs/2026-09-15-infantry-gait-design.md`, contract v3 in
  `2026-08-28-mesh-unit-contract.md`). `pnpm gait:meshes`
  (`tools/src/meshes/gait-pass.ts`) measures each locomotion clip and writes
  `rl_gait: { move: { strideM, cycleS }, moveFire?: … }` onto the SCENE's
  `extras`; `gaitTimeScale` (`three/units/mesh-anim.ts`) divides the unit's
  MEASURED ground speed by what the clip's legs cover and hands the result to
  the mixer as a `timeScale`. **A mesh with no `rl_gait` gets exactly 1**,
  which is precisely the old behaviour, so the motorcycle (the three crews
  walk since 2026-09-17, on a third root per figure) and any un-passed
  re-export are never made worse.
  Six things about it are worth knowing and every one was measured.
  **The old behaviour was a third to two-thirds of a stride.** Before this,
  fourteen rigs played a 0.67 s march whatever they were doing: boot travel
  against ground covered read **0.315** for `inf_squad`, **0.321** for
  `charge_squad` (which sprints at 1.9 tiles/s) and 0.295 for a civilian
  child. That is the whole of "they walk nonchalantly" — the legs describe a
  fraction of the ground the body crosses, so the figure glides.
  **Nothing needed to move faster.** One tile is 3 m, so 0.9 tiles/s is
  2.7 m/s: every rifleman in this game was already running and the animation
  simply would not admit it. That is also the answer to GH-152, which was
  blocked on a "fleeing signal" the sim does not have — `move` IS the run, and
  six rigs were shipping an unbound `Running` clip beside the walk they
  played. Closed 2026-09-16 with no sim change at all.
  **The mesh side MULTIPLIES by `cadenceScale` rather than replacing it.**
  The retired billboard path composed `walkFps(anim.speed, n) *
  cadenceScale(anim)` (`anim.ts`, `clip.ts`), so a routed mesh rifleman and a
  routed billboard beside him agreed about how fast a broken man's legs move.
  The billboards are gone (WP-A3.3); the multiplier stays, because it is what
  a routed or pinned figure's legs should do, and `walkFps`/`cadenceScale`
  still live in `anim.ts`/`clip.ts`, not in the trimmed `frame-state.ts`.
  **The clamp is a backstop and a clamp doing real work is a defect to
  report.** Reachable range on shipped art is **0.914x–2.645x**
  (`sniper_team` lowest, `yahalom_squad` highest), bounded from the sim rather
  than from observation: `stepMovement` never moves a unit past
  `type.stepPerTick` and the direction vectors are unit vectors, so a diagonal
  is not faster. `GAIT_TIME_SCALE_MAX` is 4. **The design's own example of 2.5
  was wrong** and would have clipped the unit with the largest correction to
  make, putting its slide back with every test green.
  **A passenger's `entitySpeed` is its CARRIER's**, because `stepTransport`
  overwrites a carried unit's position every tick — measured live, a
  `sniper_team` in a `jeep_shoded` computes **13.53x** and clamps. Carried
  units are excluded outright rather than clamped, which restores exactly
  their pre-change behaviour and is what makes "a clamp means that mesh's gait
  is wrong" true.
  **The stride is the FORWARD component, not the 3-D travel.** Declaring the
  hypotenuse folds foot lift and lateral swing into a number the renderer
  divides by time and treats as a ground speed; the forward fraction ranges
  0.823–0.985 across the seventeen declarations and is rig-dependent, so no
  constant downstream could have corrected it. Fixing it moved every
  declaration down by 1.47%–17.70%.
- **Every armed walker ships a `moveFire`, and three teams play captured
  motion again** (2026-10-05, the B7 regression). B7 replaced the three
  motion-captured Meshy bipeds with rig.py figures and the only two `moveFire`
  clips went with them, so every unit that fired on the move played `fire` and
  slid. `rig.build_move_fire_clip` is `move`'s legs from the same gait dict
  under `fire`'s arms (held against the lean), and `tools/units/mocap.py`
  retargets the captured clips -- extracted once by `extract_mocap.py` from
  `e31ebdf3` into `art/mocap/*.json` -- onto `inf_squad`, `sarim_rifles` and
  `yahalom_squad`'s rig.py bones: world-rotation deltas, mirrored (the capture
  is a right-handed shooter, every target holds its weapon on `forearm_R` at
  +Y), feet planted on the capture's own contact frames, falls ending in their
  own wreck. `mesh_gait.test.ts` gates both: a moving shot must resolve
  (through the renderer's own chain) to a locomotion clip, and the captured
  teams' torsos must move. `charge_squad` and `mortar_crew` got theirs from
  `tools/src/meshes/move-fire-splice.ts`, not a re-export: their importer has
  moved on since B4 and a re-export changes their geometry.
- **`tools/src/mesh_gait.test.ts` is the gait and facing gate, and it is
  tree-wide.** It measured `mortar_team` ALONE until 2026-09-16 — the one file
  GH-145 was raised against — which is how fourteen sliding rigs shipped
  green beside it. It now sweeps `RIGGED_UNIT_MESHES` and gates, per file and
  per FIGURE: the playback multiplier (not the residual — see "Every check
  gets an input that makes it fail"), step cadence, per-figure ground
  coverage, head-to-face bearing, a marker instrument for rigs with no `face`
  role, a weapon-axis PCA with its own elevation and two-instrument agreement
  checks, and the declared `rl_gait` against a FRESH measurement of the same
  bytes, so a re-export that skipped `pnpm gait:meshes` fails loudly instead
  of rate-matching to a stale stride. Named outliers carry their own numbers
  and a DEMOTION assertion: an exemption that is no longer needed fails and
  tells you to delete it, which it has already done once by itself.
- **A GLB carries zero materials — except three buildings, by the lead's
  explicit override.** Colour is applied at runtime from the role ramp. Since
  Phase 0 (2026-09-14) that is ONE flat albedo per part — `liftTone(ramp)`,
  the ramp's lit face, on a `MeshStandardMaterial` — and the sun, the shadow
  map and AO make the shading, where it used to be a ramp SLICE indexed by
  normal. Do not port `render_team.py`'s `ROLE_PALETTE` or `LIT_GAIN` into
  a mesh export — that table compensates for a multiply-style light, and a
  real light does the job now.
  The exception is `house`, `apartment` and `warehouse` (and their wrecks),
  which ship their supplied Meshy `base_color` bake: *"i have provided a very
  detailed blender files and i want them to be used as is unless ill provide
  other instruction."* The opt-out is a NAMED LIST on both sides —
  `TEXTURED_BUILDING_TYPES` (`three/units/textured-building.ts`) and
  `TEXTURED_MESH_EXEMPT` (`tools/validate_mesh_assets.py`) — pinned against
  each other by `textured-building.test.ts`, which parses the Python set. A
  GLB outside the list that ships a texture **throws** rather than being
  silently upgraded. Three things a reader will otherwise get wrong:
  **the decision is per MESH, not per file** — the warehouse's roof cap is
  synthesised by `export_meshy_warehouse.py` (its source is an open-topped
  scan), has no UVs, and stays on the palette inside a textured GLB;
  **`pnpm validate:meshes` does NOT palette-check these six**, and never
  could have — `render_mesh_gate.py` repaints every building from the palette
  before rendering, so the check was measuring a stand-in, and the gate now
  prints a `NOT palette-checked` line naming them (silhouette IoU still runs);
  and ~~**the map's `colorSpace` must be `NoColorSpace`**~~ — **the opposite
  since Phase 0 (2026-09-14): leave the `SRGBColorSpace` `GLTFLoader` stamps
  on a baseColorTexture alone.** `prepareTexturedMap`, which used to undo it,
  is deleted. The old rule was right for a pass-through output and wrong the
  moment the renderer started decoding to linear and encoding in `OutputPass`.
  The one texture class that still takes `NoColorSpace` is ground albedo,
  because a ratio field is not a colour — see the colour-pipeline bullet
  above. `metallic_roughness`/`normal` are no longer dropped at export either
  (the exporters keep them since 2026-09-14) and the renderer binds whatever
  maps a GLB carries: there is a sun in this scene to consume them now.
  **Zero materials is not zero ANIMATIONS any more, for vehicles.** Every
  `art/meshes/vehicles/*.glb` declared no clips at all until 2026-09-15; all
  eleven now carry exactly `idle` and `wreck`, written by `pnpm wreck:meshes`
  and keying only node SCALE, so every living mesh vehicle runs a mixer update
  each frame where it used to skip one on a null check. Nothing in the export
  scripts authors them and nothing else may use those two names — `stripWreck`
  matches by name and would silently eat an authored `idle`.
- **A mesh VEHICLE leans, lags and settles since WP-A1.3 (GH-177,
  2026-09-23); its wheels turn and its tracks scroll since 2026-10-12 (the
  next bullet).** Design
  `docs/superpowers/specs/2026-09-20-art-vehicle-weight-design.md`. What ships,
  all of it presentation on the frame clock with nothing read back by the sim:
  a **four-sample terrain conform** (`units/vehicle-conform.ts` — the hull's
  measured footprint corners on the drawn ground, a corner over a blocked tile
  or off the map standing at the hull centre's height; that fallback is what
  keeps a plain four-corner sample, found in review and never shipped, from
  drawing a >10° false tilt on 130 of `tel_marum`'s 1,534 passable tiles and
  86 of `deir_amun`'s 1,916, and `tools/src/vehicle_conform_census.test.ts`
  holds every shipped map at 0); an **acceleration pitch**
  (`units/vehicle-weight.ts` — a constant-rate speed ramp, because the sim
  has no acceleration, feeding a damped settle spring scaled so a standing
  start draws exactly the authored maximum); a
  **turn roll to the OUTSIDE** of the turn, from the sim's own rate-limited
  yaw rate times the speed share, so a hull pivoting in place does not lean;
  the **settle** on a stop; a **lag** that trails the sim by `lag_tiles` and is
  exactly zero on a stationary unit (R-C: lag plus recoil clamped once at
  0.25 tile); and **dust whose cadence follows speed** (`vehicleDustIntervalMs`
  — 4.40/s for a cruising Lavi, 6.67/s for the Eitan and the technical, which
  both sit on its 150 ms floor, against a fixed 4.00/s before). Per-vehicle
  numbers are an optional `mobility.weight` block in the unit JSON with role
  defaults (`units/vehicle-weight-params.ts`, imported by relative path and
  pinned to `art/meshes/vehicles/*.glb` both ways); air units are excluded and
  the state freezes at death, while the WRECK is handed over at the sim
  position with the terrain conform alone (`poseVehicleWreck`) — no dive,
  lean, lag or recoil frozen into it, so it sits on its own scorch mark and
  shroud. On the running game (`pnpm weight:capture`, whose ladder now VOTES
  through `motionVerdict`): a Lavi's launch reads 1.79°
  at the 200 ms rung of its authored 2°, its turn 1.49° of 1.5°, its lag
  0.06 tile, and climbing onto `tel_marum`'s bench it stands on 16.8° of ground
  where it used to sit level with its nose in the hill. That harness's
  `mbt_lavi_tel_marum` subject is killed by the sandbox's Sarim force at tick
  ~281 in every run, so its `stop` lane is ten seconds of a wreck, before and
  after alike: the one named `KNOWN_DEAD_LANES` entry, reported and labelled
  in `sheet.md`, excluded from the exit code, and red again the moment it
  gains a living rung.
  Two things a later reader will otherwise get wrong. **`rotation.x` under a
  yaw on `rotation.y` is a WORLD-axis tilt**, not a pitch: three composes
  `Rx·Ry·Rz`, so the shipped recoil's 0.06 rad measured a nose lift of
  0.000 / −0.060 (nose DOWN) / 0.000 / +0.060 at facings 0 / 0.25 / 0.5 /
  0.75, with a constant 0.060 sideways bank at every one of them, while its own
  comment claimed a local pitch. The hull now takes ONE write,
  `rotation.set(-roll, yaw, pitch, 'YZX')` — yaw, then pitch about the hull's
  lateral axis, then roll about its length — and reads 0.05996 of nose lift at
  every facing; the recoil pitch is one term of that sum. (The minus is real:
  the corner `hullCornerOffsets` names `right` is the hull's PHYSICAL LEFT.)
  WP-A1.3 left the other half of GH-177 -- wheel spin and track scroll --
  open (R-J). Part of R-J's reasoning went stale before it was built: R-J said
  four vehicles carried no UVs on `hull_rubber`, but since the Meshy
  re-exports (2026-09-30 to 10-02) **all twelve ground vehicles carry
  `TEXCOORD_0` there**. Every one still points it at the hull's own baked
  material, and those UVs are an atlas, not a strip, so scrolling them is the
  wrong tool. No GLB has a `wheel_*` or `track_*` node, and none needs one.
  See the next bullet.
- **Wheels spin and tracks scroll since 2026-10-12 (GH-177's second half)**:
  design `docs/superpowers/specs/2026-10-12-wheels-and-tracks-design.md`,
  approved as written (A1-A12); contract v7 (vehicles).
  - **What turns.** Wheels spin on the jeep, Shachaf, Kipod, Eitan, technical,
    gun truck, Grad and the Namer (its road wheels). Tracks scroll on the
    Namer, the Lavi (and the held command Lavi) and the D9. The Lavi's and the
    D9's road wheels stay static (A3/A4), and the Tzav waits for E6.
  - **How it is cut.** `pnpm running-gear:meshes` tags faces in place, with
    the `_RL_WHEEL`/`_RL_TRACK` vertex pair plus scene
    `extras.rl_running_gear`, from the literal recipes in
    `running-gear-recipes.ts`. It runs before `kit:meshes`, and it appends
    split vertices rather than moving any, so nothing the wreck pass measures
    changes. **+0 draw calls**, measured with `kit-drawcalls.ts
    --running-gear`.
  - **How it draws.** The runtime (`units/running-gear*.ts`) drives the
    wheels from the weight model's own smoothed speed and yaw rate, SIGNED by
    the travel-vs-hull cosine, so a hull turning round while it slides
    backwards runs its tracks backwards. A right turn (increasing facing) runs
    the left side faster. Both sides counter-rotate on the spot. Spin is capped
    at 15 rad/s, and the front axle steers by the bicycle model, clamped to its
    measured clearance (the technical's is 3 degrees).
  - **Two things a later change will get wrong.** First, a vehicle is swapped
    onto its own CLONE of the bake only the first frame it moves, which is what
    keeps parked frames, and so the golden gate, unchanged. Second, the clone
    is per vehicle because three (r170, and still r186) re-uploads a standard
    material's `onBeforeCompile` uniforms only on a material change:
    `uniformsNeedUpdate` is honoured for `ShaderMaterial` alone.
  - **Witnessed by `pnpm weight:capture -- --running-gear`**, the
    `running-gear` debug layer's A/B on moving vehicles. No gated golden
    scenario moves a vehicle. The Lavi's track barely shows from the game
    camera (0-4 px of A/B at zoom 1): its rubber is a slice under the hull
    skirt.
- **The Lavi (and `officer_armour`) is rescaled x1.18 AFTER its Blender export**
  (the lead, 2026-10-15; `tools/src/meshes/rescale-contract.ts`): it was cut to
  the retired Tiger sprite's 6.32 m, the fleet is ~7.1-7.3 m, and it ships at
  7.46 m overall. Every Lavi literal (kit builders, the command Lavi's mast,
  the running-gear and damage recipes) stays in the 6.32 m frame it was
  measured in: the Blender scripts divide an imported rescaled GLB back
  (`tools/vehicles/rescale.py`), and the TS recipes multiply by `rescaleOf`.
  Pipeline: export -> `pnpm rescale:meshes -- --id=<id>` (and `--kit=mbt_lavi`
  for a kit export) -> running-gear -> kit -> wreck -> damage -> encode. The
  pass marks `extras.rl_rescale` and refuses a marked file; the kit pass
  refuses a source whose mark differs from its vehicle's.
- **A mesh VEHICLE wears its bought kit since plan 3 (GH-238, 2026-10-07), in
  the garage and on the field.** Spec `2026-10-06-kitted-vehicles.md`, contract
  v5 (vehicles) in `2026-08-28-mesh-unit-contract.md`. Each of the eight KDF
  vehicles carries every part of its three tracks as `kit_<track>_<tier>_<host>`
  nodes in its ONE GLB (`rl_kit` extras, the host's parent, local TRS, material
  and attribute set). The source is `art/parts/kit/<id>.glb`, Blender-built by
  `tools/vehicles/export_vehicle_kit.py` (0 Meshy credits, UV-pinned to the
  vehicle's existing bake). **Pipeline, order load-bearing:** export ->
  `pnpm kit:meshes` (a gltf-transform graft: every live accessor stays
  byte-identical) -> `pnpm wreck:meshes` (never twins, measures or clips a
  `kit_*`) -> `pnpm damage:meshes` -> `pnpm encode:meshes`. `applyVehicleKit` (`units/vehicle-kit.ts`)
  runs first in `buildVehicleMeshTemplate`: it keeps the parts whose tier is at
  most the type's bought tier, merges them into the host geometry HOST FIRST,
  swaps that onto every LIVE mesh over the old one, and deletes every `kit_*`
  node. **The `WRECK_` twin keeps the unkitted geometry: a kitted vehicle's
  wreck has its kit blown off** (the lead's ruling, 2026-10-14, with the
  damage pass), so the old host geometry stays drawn and is not handed back
  for disposal. The tiers are `RendererOptions.unitKitTiers`,
  from `upgradePrepass`'s own per-type tiers object; tiers absent or 0 is the
  shipped template, so the existing golden scenarios cannot move. The `kit`
  debug layer is `setDrawRange(0, rlKitBaseCount)`, which is why host-first is
  not a taste.
  **+0 draw calls**: `tools/src/perf/kit-drawcalls.ts` reads 12 submissions per
  vehicle (6 for the D9) at tiers 0 and at tiers 3, through the shipped builder
  with `renderer.info` reset BY HAND. three r170 auto-reset it AFTER the
  shadow pass, so a plain read looked half as expensive; r186 resets it BEFORE
  the shadow pass, but every nested `render()` in a composer frame (the AO
  pre-pass, each full-screen quad) resets it again, so a plain read after a
  frame still sees only the last of them.
  **The exporter refuses** a part over 1.10x its budget, a part off its mock by
  more than 3 cm or 10% (a named, printed DEVIATION is the only excuse), more
  than 5,000 kit triangles, and any clash or containment (`kit_clash.py`: kit
  x kit at rest, turret kit x hull kit and x the shipped nodes over 72
  headings, kit x its own host). An exemption is named, scoped to headings and
  given a reason, and one that excuses nothing is itself refused.
  **`validate:meshes` judges kit two ways**: from the bytes (name, host, TRS,
  material, one primitive, declared track and tier, <= 5,000 triangles) with
  `check_kit_owed` requiring a node for EVERY (track, tier) a vehicle's JSON
  declares (`KIT_VEHICLES` is parsed out of `kit-contract.ts`, so the kit pass,
  the draw-call harness and the gate share one list); and from renders, the
  maximum kit plus each track alone at 1-3 and L1-L3 (nine for the D9) through
  the shipped render's own Cycles, every one held under IoU 0.88 against every
  other unit and not against its own base. **Tone** (K3): armour takes the
  shade paint texel (25th-percentile luminance of `hull_hull`), sensors and
  firepower the bake's metal texel, `dark` only lenses, windows and apertures.
  Five bakes (Namer, Eitan, Kipod, Shachaf, D9) carry no steel (a uniform
  metallic map, no textured `*_metal` node), so "the third metal rule" takes
  the greyest paint instead and prints a DEVIATION line. Shipped kit triangles at maximum kit: Lavi 4,740,
  Namer 3,282, Eitan 3,266, Kipod 3,222, jeep 2,264, D9 2,758, Shachaf 1,906,
  Peten 1,434. The `kitted` golden scenario (`vehicle` + `&kit`, gated, `units`
  and `kit` toggles) has NO baseline: **CI's `visual` job is red (exit 1, a
  missing entry in an existing manifest) until the post-merge bless, from CI
  numbers; do not bless from the branch.** `pnpm kit:capture` photographs the
  eight at L0-L3 through the real prepass and measures the toggle.
  The garage's `GarageView.setKit` re-merges from a pristine clone (no fetch),
  draws the new hull and only THEN releases the old, fitted on the maximum kit
  so a purchase never resizes the frame; `cueFor` returns `'kit'`
  (`ui_kit_fitted`) for the eight, in the same task.
  **The slat is a two-level LOD since the leftovers pass (2026-10-12).** Every
  `kit_parts.slat_panel` writes its real bars (30 mm at 120 mm) to a
  `kit_<t>_<n>_<host>_near` node and coarse ones (every other position, 2.58x
  as tall, the same mean coverage from the game camera) to `..._far`, beside
  the part's main node (posts, rails); `rl_kit.lod`, both or neither, checked
  by `kit:meshes`, `validate:meshes` and the shipped-GLB test. At zoom 1, DPR 1
  the real rows are a 1.57 px period of 0.62 px bars: above Nyquist on a
  single-sampled target, so they aliased into a cross-hatch SMAA cannot undo.
  `applyVehicleKit` merges host, main, near, far into ONE geometry with TWO
  index buffers (`rlKitLod`), near by default (the garage only ever draws
  near), and `ThreeRenderer.updateKitLod` swaps every template when
  `camera.zoom x pixelRatio` crosses `KIT_LOD_SWITCH` (1.75): +0 draw calls,
  host still first, so `rlKitBaseCount` and the `kit` layer are unchanged.
  Measured (`pnpm kit:capture -- --measure`, cage pixels, 1 px sub-pixel pan):
  the cross-hatch is gone and cage shimmer at zoom 1 drops 17-27%; the far
  bars still stair-step like any 1 px diagonal. The mesh gate renders the near
  view only. **The five A3.2 metal patches are dielectric** (`bake_fix.
  METAL_METALLIC` 0, `patch_metal_glb.py --metallic-only`): painted metallic
  1.0, they drew near-black, because a vehicle material has no environment
  (`envMapIntensity = 0`) and a metal keeps no diffuse term. The exporter finds
  the patch by its colour off every island now. **Resolved by PR #661 (15 Oct):** the Peten's kit
  read weakly at zoom 1 (kit-toggle 255 -> 307 px of a ~800 px airframe after
  its camera-facing parts grew ~40% and its metal took a gunmetal texel, the
  "fourth rule"); options A+B (larger camera-facing parts inside the airframe's 0.28 scale,
  and a light metal tone) took the kit pixels at zoom 1 from 287 to 343. Option C, the
  gunship's stores, was not taken (K5).
- **A building's FACING is gated now** (GH-142, `tools/building_facing.py`,
  inside `pnpm validate:meshes`). A building never turns — `mesh-building.ts`
  leaves rotation at identity — so whichever elevation an export bakes toward
  `+X`/`+Z` is the one the player gets forever, and until this that was a
  coincidence held up by two comments in two export scripts. It stopped being
  harmless at `d63cd36`: a palette-painted box has no front, a photographed
  facade does. The gate rasterises each GLB orthographically from all four
  cardinal directions and counts pixels whose nearest FRONT face is
  `glass`-role geometry — the one role that marks an OPENING rather than a
  surface material — then requires the camera-facing half (`+X`+`+Z`, derived
  from `camera.ts`'s `VIEW_DIRECTION`, pinned by `building-facing.test.ts`) to
  beat the hidden half by `FRONT_MARGIN`. Three things about it are worth
  knowing. **Texture statistics do not work and several were measured failing**
  — mean, contrast, dark-fraction and edge energy all pick house's fire-stair
  side over its entrance side, because they score clutter rather than frontage.
  **A third verdict, `symmetric`, is load-bearing**: `warehouse` has a roller
  door on BOTH gable ends and `concrete` reads 1080 px on each half, so
  demanding a front from them would be a false-positive factory; nothing
  shipped falls between 1.32 and 4.67, so 2.0 sits in a gap rather than on a
  fitted line. And **`apartment` is the one shipped textured building the gate
  cannot judge** — its windows are painted into the bake with no pane modelled,
  so it has no `glass` role and no readable front. That is named on the PASSING
  path, like `NOT palette-checked` is.
- **`apartment` deliberately does NOT get a `glass` role**, and the reason is
  not "nobody got round to it". On a textured building the role is inert for
  colour: `buildBuildingMeshTemplate` takes the texture branch BEFORE
  `isBuildingMeshRole`, so `house`'s own `glass` mesh is drawn through the
  photograph and contributes no palette entry — verified from house.glb's bytes
  (its `glass` primitive carries `TEXCOORD_0` and references the one textured
  material). Adding one to `apartment` would therefore buy zero colour and
  would mean re-exporting a supplied Meshy asset purely so a gate can read it,
  against the lead's "used as is". The gap is recorded instead.
- **Mesh units ARE gated now** -- `pnpm validate:meshes` (`tools/render_mesh_gate
  .py` + `validate_mesh_assets.py`) renders every `art/meshes/**/*.glb`
  headlessly through `render_rig.py`'s own rig and runs
  `validate_assets.py`'s IMPORTED palette/silhouette/fill checks. Silhouette IoU
  compares each mesh against every other mesh -- and only that since WP-A3.3: the
  mesh-vs-sprite half and its "own retired sprite" exclusion went with the
  sheets. It is the ONLY art gate now: `validate:assets` walked `assets/sprites/`
  alone and was retired rather than left printing PASS over nothing, and its
  terrain-exemption paragraph prints here. **It is in CI** (`8304f6b`, ci.yml's `gates` job), and CI really can
  run headless Blender: the workflow downloads Blender 5.2.0 linux-x64 from
  download.blender.org and that URL is live (HTTP 200, verified 2026-09-01) --
  this is a real gate, not a green-looking no-op. Current state measured
  2026-09-15, after the wreck pass added eleven extra Cycles wreck renders:
  **passes in roughly 45-70s on this machine, not 31.69s** (Task 3's own
  report read 70.0s, its reviewer 45.7s, the final branch reviewer ~70s —
  Cycles render time varies run to run; the gate logic did not slow down),
  "87 mesh unit(s) rendered and checked against each other; 28 decor, 12 prop
  and 1 campaign world checked against the mesh contract directly" at WP-A3.3
  -- measure rather than recite. Locally it
  needs Blender on PATH or `--blender`/`BLENDER_BIN` (a macOS `Blender.app` is
  found by the default candidate list); with none it fails loudly rather than
  skipping. Two traps when running it in a **shared worktree**: it walks
  `art/meshes/` with no filter and no ignore of untracked files, so another
  session's scratch `.glb` will fail YOUR run (observed -- a stray
  `zz_throwaway.glb`, a copy of `digger_crew`, produced
  `silhouette collision: digger_crew (mesh) vs zz_throwaway (mesh) IoU=1.000
  (limit 0.88)`); and there is no `--meshes` flag to point it elsewhere, so
  `git status art/meshes/` is the first thing to check when it goes red.
- **The sprite renderers stay, and refuse to write sheets.** `render_team.py`,
  `render_vehicle.py`, `render_building.py`, `render_vehicle_glb.py` and the
  `render_<unit>.py` specs on top of them are imported by the mesh gate and
  several exporters (palette tables, rig helpers), so they were kept when the
  sheets went (WP-A3.3) -- but every place they wrote into `assets/sprites/`
  calls `tools/sprites_retired.py`'s `refuse_sprite_output` first. `--probe`
  output (`.superpowers/probe/`) is still allowed. A UI picture of a unit is its
  Blender portrait (`tools/render_unit_portraits.py`); the cropped sheet icons
  (`pnpm icons:units`) and the `SPRITE_MAP` table that queued sheets -- whose
  "art exists but draws nothing" failure shipped three times -- are gone.
- **The elevation debts were walked on `tel_marum` (2026-08-29)** and none
  survives on three: extruded terrain occludes units through the depth
  buffer, mid-slope picking works, the wreck/fx sorting gap produced no
  artifact even at the steepest 4-level drop, `raySmoke` is shared sim code,
  and three's `TracerBatch` lifts by the higher endpoint's ground height. (The
  divergences recorded then were all Pixi's, and went with it in WP-A3.3.)
- **A unit spawned mid-mission is seeded in `snapshot()`** (`prev = cur`,
  speed 0, `4d6d2ede`): every mid-mission spawn happens inside `runtime.step`,
  after that tick's snapshot, so until the next one its id is inside
  `sim.entityCount` with both position copies at zero. Every per-frame loop --
  the proxy boxes included -- is bounded by the count last snapshotted, so the
  unit appears up to one tick late and never slides in from world (0,0).
  Measured before the fix: on `wadi_halam_2_laager` a bought jeep drew at
  (0,0), then halfway across the map at 483.7 tiles/s.
  (`ThreeRenderer.midspawn.test.ts`.)


<!-- CLAUDE.md lines 2340-2475, section "Mesh units / Known scaling debts" -->

- ~~Mesh units have no `down`/`wreck`/`work` clips~~ — **stale for INFANTRY since
  `233f683`, and the debt has moved to vehicles.** The prediction in the old text
  was right and was acted on: FK-folding the standing rig into prone did produce a
  self-intersecting heap, so `rig.py`'s `_figure_death_parts` calls
  `kit.figure(posture="prone")` for SEPARATE geometry, binds it rigidly to a
  per-figure `{prefix}_death_root`, and every clip keys both roots' scale (1/0
  living, 0/1 dead). All sixteen infantry team GLBs now carry `down` and `wreck`
  (`moto_rpg` carries `wreck` only — a motorcycle cannot go prone;
  `yahalom_squad` also carries `work`, built by rig.py since B7), civilians carry `down`, and
  `units/mesh-death.ts` plays them: 0.4 s fade, then a persistent `MeshWreck`.
  **Since 2026-09-17 that is the exception, not the rule** (design
  `2026-09-17-infantry-animation-design.md`): the three Meshy bipeds carry
  `fall`/`fallAlt` (contract v4) and play them once, every other rig topples
  per figure about its own feet away from its killer over 0.5 s, and neither
  path fades — the fade survives only for evacuation and for a body with no
  wreck (civilians). Clip changes crossfade over 150 ms unless the two clips
  key different bone scales, which is decided from the bytes at load
  (`mesh-clip.ts`'s `scaleSignature`).
  Verified 2026-09-01 both from the shipped bytes and on screen — a killed
  `inf_squad` on `?sandbox=beit_sahwan_outskirts` leaves three prone figures beside
  a standing squad.
  **A mesh VEHICLE has one too, since 2026-09-15** (before it, a dying mesh
  vehicle mixed a 2D sprite fade and a sprite wreck with its mesh -- both
  retired with the billboards in WP-A3.3). What closes it is a PROCEDURAL wreck rather than authored geometry
  (`docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md`): `pnpm
  wreck:meshes` (`tools/src/meshes/wreck-pass.ts`) post-processes each GLB with
  `@gltf-transform`, adding one `death_root` node whose `WRECK_<name>` children
  reference **the same `Mesh` objects** their live twins do, displaced by a recipe
  (`wreck-recipes.ts`), plus the two constant-scale clips `idle` and `wreck`
  (1/0 and 0/1) the infantry rigs already ship. Sharing the meshes is why all
  eleven files grew by **+1892…+3220 bytes** rather than by a copy of a 1.6–3.4
  MiB buffer. The pass is idempotent and re-runnable after a re-export; the Draco
  mirror is re-encoded in the same commit.
  **And since WP-A1.2 the swap is not the whole event any more.** A vehicle kill
  now dispatches a BLAST beside the wreck (`docs/superpowers/specs/2026-09-19-art-blast-design.md`):
  a pooled point light, a screen shake applied to a COPY of the camera in
  `threeCamera()`, a hit-stop inside `frame()`, a `CollapseShroudManager` cloud
  sized from the vehicle's own measured mesh bounds that covers the living-body →
  wreck swap, and a scorch mark that is permanent for the mission (a scorch and
  an oil stamp in the persistent decal pool since WP-A2 plan 1; it was
  `ScorchDecalMesh`). A mortar or Grad landing gets the same four minus the
  shroud (and a crater under its scorch), at
  `SHELL_PROFILES[kind].impactPower`. The vehicle-kill branch's outer
  mesh-readiness guard was removed to do it, so the blast fires for a vehicle
  with no mesh loaded too -- with no shroud there, because there are no bounds
  to size one from.
  **Three of those five shipped INERT on this branch, and the way that happened
  is the (now retired) `SPRITE_MAP` failure in a second place.**
  `blastLightSpec`/`blastShake`/`blastHitStopMs` all resolve through
  `emitterLibrary.byName('catastrophic_kill')`, and
  `data/vfx/catastrophic_kill.json` was **never imported into
  `packages/data/src/index.ts`'s `vfxEmitters`** — so `byName` answered `null`,
  each of the three took its own documented "nothing to scale" path, and only the
  scorch and the shroud (the two unconditional calls) ever ran. The file shipped,
  validated against the schema, and was read by name from `ThreeRenderer`.
  Nothing could catch it: `validate:data` walks the FILES,
  `ThreeRenderer.blast.test.ts` calls `useEmitters` with the JSON directly (which
  is better than mocking, and is exactly why that suite could not see this), and
  `vfxEmitters` was a hand-kept list. Measured rather than reasoned, by
  `pnpm blast:capture`: a hand-ticked kill read `hitStop.remainingMs` 0.0 and a
  shake offset of 0.000 px at every frame from 0 to 600 ms, and the `blast-light`
  toggle moved **0 px / 0.0000** — against the mortar's 14224 px / 5.4091 through
  the same code on the same frame, because `shell_impact` WAS in the list.
  **Fixed, and the array is pinned to the directory now**: `index.test.ts` reads
  `data/vfx/*.json` at test time and requires the registered ids to equal them
  exactly, so a file that ships without being registered is a red spec rather
  than an effect nobody can see. Registered, the same kill reads **42119 px /
  11.1762**, holds four frames of hit-stop with the FX clock at 0.0, and peaks at
  **7.971 px of shake** against an authored 9 (the 16 ms sampling grid never
  lands on the continuous 8.79 px peak). Read at test time rather than made an
  import glob on purpose: a glob would derive the array from the directory and
  make the check vacuous.
  Four things about the wreck itself are worth knowing before touching any of it.
  **The recipe is fractions of each vehicle's OWN measured bounds**, tuned
  2026-09-15 against an eleven-pair screenshot sheet
  (`tools/src/perf/wreck-captures.ts`) and recorded beside each constant. Two of
  them are counter-intuitive and were measured: the settle is a fraction of the
  vehicle's **clearance**, not its height, because the measured gap under these
  bodies is 0.000–0.363 world units and a fraction of the height buried every one
  of the eleven; and the turret is thrown **across** the hull, not along it,
  because thrown along it the turret stays inside the vehicle's own silhouette and
  the Lavi photographed as an intact tank with the gun sticking out. Every group
  is then seated on the ground plane off real vertices, so nothing sinks and
  nothing floats.
  **A vehicle GLB without the `wreck` clip is refused at load** (WP-A3.3):
  `loadVehicleMesh` throws naming the GLB and `pnpm wreck:meshes`, the type
  draws a proxy box, and `mesh_roster.test.ts` keeps one from shipping. This
  replaced the sprite-wreck fallback (`addWreck`) and the trap that came with
  it -- there is no sprite wreck left to delete.
  **The runtime half is `units/mesh-vehicle-death.ts`**, a rigid sibling of
  `mesh-death.ts` rather than a generalisation of it, importing that module's fade
  curve, window, `MeshWreck` cap and fog rule unchanged. A vehicle wreck therefore
  shares `MAX_MESH_WRECKS` (256) with infantry corpses. Charring is a runtime
  material treatment of anything marked `rl_wreck` — one shared charred ramp
  slice for a palette vehicle, one memoised SOOT-RECOLOURED clone per distinct
  loaded material for a textured one (since 2026-10-15, `charredTexturedMaterial`:
  the bake's LUMINANCE onto `CHARRED_WRECK_KEY` `gunmetal.2`, normalised by the
  bake's own mean, `extras.rl_bake_luma`, which `pnpm wreck:meshes` stamps on every
  textured material and the runtime refuses to char without, and capped by
  `CHARRED_WRECK_CAP` so a wreck never reads lighter than its living vehicle;
  the old multiply by `limestone.7` drew every textured wreck near-black, and
  that tint now belongs to the SCARS alone) — so **`pnpm validate:meshes` cannot see it**: that
  gate repaints every vehicle from the palette tables before rendering and says so
  on its passing path. It judges the SHAPE, two ways, against a measured floor.
  **Real damaged GEOMETRY ships for thirteen, since 2026-10-14** (`pnpm
  damage:meshes`, `tools/src/meshes/damage-pass.ts`; design and record
  `docs/superpowers/specs/2026-10-14-wreck-damage-design.md`, which closes the
  wreck spec's D1). **The rule is OUTLINE damage only** -- a thrown track on the
  sand, a peeled plate, a broken barrel or rotor, a wheel-off corner drop --
  because the charred wreck draws near-black and a hole or cavity in it has
  nothing to stand out against (a mock measured it; the lead ruled no roof
  holes and no missing wheels on skirted tanks). The pass gives a `WRECK_`
  twin its OWN mesh only where a recipe cuts it, marked `extras.rl_damage =
  { source }` on node and mesh; `validate_mesh_assets.py`'s wreck clause 3
  accepts exactly that in place of a shared mesh, and clause 3c caps the
  copies at **64 KiB Draco / 512 KiB raw per file** (numbers read from
  `damage-recipes.ts`; every file's spend is printed on the passing path).
  Debris is built in `death_root` space and carried into the twin by its
  inverse matrix, so it is +0 nodes and +0 draw calls. Order: ... -> `wreck`
  -> `damage` -> `encode`; the wreck pass disposes every damaged copy, so a
  re-wreck must be followed by a re-damage, and `damage -> damage` is a no-op
  on the bytes. Shipped: `mbt_lavi` and `officer_armour` (thrown track,
  door-swung skirt plate, drooped barrel), `ifv_namer` and `dozer_d9` (thrown
  track only: their rubber copies are most of the cap). **Wheeled hulls lose
  their rear +Z tyre** (`apc_eitan`, `apc_kipod`, `scout_shachaf`, `jeep_shoded`,
  `technical`, `gun_truck`): `WreckRecipe.lostWheel` tips the body onto that
  corner in the WRECK pass and its seat ignores the tyre, which is a VOLUME
  about the axle (`lost-tyre.ts`, read by both passes), not the `_RL_WHEEL`
  tag -- #550's 0.99 r cut leaves outer tread untagged, and that tread held
  the corner up. The gun truck's glass is blown out, and the Petens' rotor is
  split into five blades that droop, one snapped onto the sand. The rocket
  battery's rubber copy is SIMPLIFIED to fit the cap (`simplify`,
  meshoptimizer 1.1.1, an exact tools devDependency; ratio 0.74, the largest
  that fits, raw binding; run first so its collapses see the shipped bytes).
  The corner-drop pivot runs to the FARTHEST same-side wheel: the nearest
  threw a 6x6's cab a metre into the air. Record: the design spec's §7.
