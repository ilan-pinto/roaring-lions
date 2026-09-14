# Mesh vehicle wrecks — design

**Date:** 2026-09-14 · **Status:** approved by the lead in conversation, section by section;
this document is the record. **Downstream:** `writing-plans`, then `render-vfx` (runtime),
`blender-art` or a tools implementer (the pass and the gate), `playtest` (the screenshot sheet).

## 1. The problem

A mesh vehicle has no death state. Every `art/meshes/vehicles/*.glb` declares zero animation
clips (censused 2026-09-14: eleven files, four to nine role-tagged mesh nodes each), and
`updateVehicleMeshes` (`packages/render/src/three/ThreeRenderer.ts`) skips `alive[i] === 0`
and prunes the clone in the same frame, so the 3D model vanishes at t=0. What stands in is a
billboard: `ThreeRenderer.addWreck` excludes `meshUnitTemplates` but not
`vehicleMeshTemplates`, so a dead vehicle gets the sheet's `wreck` sprite — three art
styles in half a second, as CLAUDE.md's "Known scaling debts" records. Infantry solved the
same problem on 2026-09-01: every team GLB carries `down` and `wreck` clips, and
`units/mesh-death.ts` fades the entity, plays the clip once, and keeps a bounded, fog-gated
`MeshWreck`. Vehicles never got their half because nothing shipped had wreck geometry, and the
one model that ever did (the kit-authored `d9.blend`, seven `WRECK_` parts) was retired when
`31c9799` replaced `dozer_d9.glb` with a Meshy export.

The lead's 2026-09-02 ask for a real vehicle death (fire, dust, the blast, then the wreck)
sits on top of this; it is not in this document. A wreck has to exist before anything can be
revealed.

## 2. Decisions taken by the lead (2026-09-14)

| # | decision | consequence |
|---|---|---|
| D1 | A wreck reads as **slumped and charred**: the same parts dropped, tilted, turret thrown, mast or rotor snapped, recoloured dark. Structural damage (torn hull, missing wheels) is a later per-vehicle art pass. | No new geometry now. One procedural pass covers all eleven vehicles; the supplied Meshy `.blend` files stay untouched (the "used as-is" rule). |
| D2 | **Wreck only.** The blast effect stays a separate task on the queue. | This design ends at a persistent mesh wreck after the existing 0.4 s fade. |
| D3 | **Approach A**: post-process the exported GLB with a glTF library, no Blender, sharing geometry between the live and wreck nodes. | Rejected: B (the same inside each of the nine Blender exporters — slow, bespoke Meshy segmentation in each) and C (runtime-only recipe — invisible to the mesh gate, no per-vehicle slot for the later structural pass, a unit's visual state in render code). |
| D4 | The D9 gets the procedural wreck like the rest. | Its seven kit-authored `WRECK_` parts belong to a retired model and cannot dress the shipped Meshy D9. Recorded, not used. |

## 3. Scope

In: the asset contract, the wreck pass and its recipes, the Draco mirror, the runtime death
path and charred materials, the mesh gate and the bytes-level contract check, tests, a
screenshot sheet for the lead, and the docs that describe the old behaviour.

Out: the blast VFX; structural damage per vehicle; Pixi and `&nomesh`, which keep the sprite
wrecks the sheets already carry (`SHACHAF_HULL` and `KIPOD_HULL` gained theirs on
2026-09-14; `TNK_HULL` still has none — that is the sprite path's own gap, unchanged here);
any change to the sim.

## 4. Design

### 4.1 The asset contract

Every `art/meshes/vehicles/<id>.glb` carries one extra top-level node, **`death_root`**, a
sibling of the live geometry — the infantry convention (`rig.py`'s `{prefix}_death_root`)
applied to a rigid model. Under it, **one child per live mesh node**, named `WRECK_<name>`,
referencing the **same mesh** (a glTF node may share a mesh with another node), so no
geometry is duplicated and the file grows by a few hundred bytes. The eight Meshy-sourced
vehicles are 1.6–3.4 MB each; duplicating their buffers was ruled out on that number.

Each wreck child carries its live twin's extras — `rl_role` on the four palette vehicles
(`apc_eitan`, `dozer_d9`, `scout_shachaf`, `apc_kipod`) or `rl_textured: true` on the seven
that ship a Meshy bake (`mbt_lavi`, `ifv_namer`, `technical`, `rocket_battery`, `paramotor`,
`heli_peten`, `jeep_shoded`; `TEXTURED_VEHICLE_EXEMPT` in `tools/validate_mesh_assets.py`,
pinned against `textured-vehicle.ts`) — **plus `rl_wreck: true`**. The role vocabulary stays
closed and every `VEHICLE_ROLE_PALETTE` table is unchanged: charring is a runtime treatment of
anything under the death root (§4.3), never a new role.

Two clips, **`idle`** and **`wreck`**, each keying the scale of every top-level live node and
of `death_root` as constant channels — 1/0 for `idle`, 0/1 for `wreck` — exactly what the
team rigs ship and what `applyMeshClip` / `pickDeathClip` already play (`pickDeathClip`
returns `wreck`; no `wreckAlt`). A turret pivot or rotor pivot that sits beside the hull root
is a top-level live node and vanishes with it; the wreck's own copies of those parts are
static children of the death root, so the live aiming and rotor-spin code never touches them.

Wreck transforms come from a **recipe**, never a hand pose. A recipe is a kind whose numbers
are fractions of the vehicle's own measured bounds, so one kind serves many vehicles:

| kind | what moves |
|---|---|
| `wheeled_hull` / `tracked_hull` | the hull drops toward the axle line and pitches and rolls a few degrees; wheels and tracks stay |
| `turreted` | as the hull, and the turret is displaced along the hull by a fraction of its length and rolled |
| `masted` | as the hull, and the mast or weapon station folds flat about its base |
| `rotorcraft` | the body lies rolled on the ground with the rotor bent |
| `paramotor` | the wing collapses onto the ground beside the motor |

Per vehicle, the table names only its kind and which nodes are the turret, mast, rotor or
wing. The exact fractions are set by looking at the eleven results at gameplay zoom, not
reasoned in advance; the plan's first task ends with them measured and recorded in the
table's own comments.

A later structural pass replaces a vehicle's `WRECK_` children with real damaged geometry
and changes nothing else in this contract.

### 4.2 The wreck pass

`tools/src/meshes/wreck-pass.ts`, beside `encode-meshes.ts`, using the same
`@gltf-transform` library (already a `tools` dependency: core, extensions, functions). It
reads a vehicle GLB from `art/meshes/vehicles/`, measures its bounds, applies the recipe,
writes the death root, the children and the two clips, and saves the GLB in place.
**Idempotent**: it strips any existing `death_root` and any `idle`/`wreck` clip first, so
re-running after a re-export is safe and running twice is a no-op on the bytes.

It runs for every vehicle by default or for one id, behind a **`pnpm wreck:meshes`** script,
and the Draco mirror (`pnpm encode:meshes`) re-encodes afterwards as today, so
`assets/meshes/manifest.json` hashes move for all eleven files in one commit. The recipe
table lives in TypeScript beside the pass, authored in code the way `rig.py`'s tables are.
The source `.blend` files are not opened.

### 4.3 The runtime

`buildVehicleMeshTemplate` (`units/mesh-vehicle.ts`) already reads `gltf.animations` into
the template's clip map and instantiates a `ClipPlayer`, so a wreck-bearing file loads with
no new parsing and `idle` plays through the existing mixer. Two additions:

- **Charring.** When the template walks the meshes, a node marked `rl_wreck` takes the
  charred treatment on top of the material path its live twin takes: a single shared dark
  ramp slice for a palette mesh (one named constant beside the ramp tables in
  `vehicle-mesh-role.ts`) and a tinted clone of the baked material for a textured mesh (one
  named constant beside `texturedVehicleMaterial`). Both go through the template's existing
  material bookkeeping so disposal stays exactly once.
- **The death.** On the `destroyed` event for a vehicle-mesh type the renderer hands the
  entity to the mesh death path instead of pruning it: fade over `MESH_DEATH_SECONDS`
  (0.4 s), play `wreck` once, keep a `MeshWreck` bounded by `MAX_MESH_WRECKS`, fog-gated on
  "ever seen", evicted oldest first — everything infantry get. The planner decides whether
  `mesh-death.ts` generalises over the shared clip-player-plus-root interface or gets a
  vehicle sibling; the skinned-specific fade swap is the part that may not generalise.
  **`addWreck` steps aside only for a type whose template carries the `wreck` clip.** This
  is the trap CLAUDE.md records: excluding `vehicleMeshTemplates` unconditionally deletes the
  sprite wreck and leaves nothing. A vehicle without the clip keeps its billboard wreck.

The sim is untouched. Data flow stays commands in, events out; nothing here reads sim state
it did not already read.

### 4.4 Gates and tests

- **`tools/render_mesh_gate.py`** hides `death_root` and everything under it for the live
  render — the vehicle analogue of `apply_idle_pose`, which is a no-op for a model with no
  armature — so the palette, framing and silhouette checks keep judging the live vehicle.
  It then renders the wreck alone (live roots hidden) and applies two checks: the wreck must
  differ from its own live silhouette by more than a floor, so a recipe that changes nothing
  fails, and it must not collide with any other unit above the existing 0.88. The floor is
  set from a measurement of the eleven results, not guessed, and its derivation is written
  where the constant lives. The gate paints from the palette tables and cannot see the
  runtime charring; it prints that on the passing path, as it prints `NOT palette-checked`
  for textured buildings.
- **`tools/validate_mesh_assets.py`** reads the raw GLB and requires, on every vehicle: a
  `death_root`, children each referencing a mesh a live node also references, `rl_wreck`
  on each, and exactly the two clips with constant scale channels over every top-level live
  node and the death root. A re-export that skips the pass cannot ship.
- **`units/mesh-vehicle-shipped.test.ts`** flips from "zero animations" to "exactly `idle`
  and `wreck`, constant scale channels, a death root", parsed from the shipped bytes the way
  `mesh-team-death-shipped.test.ts` does for infantry.
- **Renderer tests**: the charred ramp slice is in the palette and the tint constant is
  applied to a textured clone; on a hand-authored vehicle fixture with the two clips
  (`mesh-fixture.ts` has the infantry precedent) the sequence fade → `wreck` → persistent
  wreck → eviction; the `addWreck` guard in both directions (a template with the clip gets
  no billboard wreck, one without still does).
- **What cannot move**: the golden determinism hash (render-only change, asset bytes only),
  `pnpm playtest` and `pnpm balance`. The visual gate's scenarios kill nothing, so no
  baseline moves; the CI numbers are read after the push rather than a local darwin
  capture, per the memory rule.

### 4.5 Verification

A scripted browser run (Playwright through the golden harness's own helpers, as the
2026-09-14 sheet captures were done) boots a scene that fields each vehicle, kills each in
turn through `__lions.sim.debugKill`, steps past the fade, and captures the wreck beside its
live pose at zoom 1.6 and 2.2. The eleven pairs go to the lead as one sheet, judged zoomed
in. The recipe fractions in §4.1 are tuned against that sheet and recorded.

## 5. Sequencing for the plan

1. The pass, the recipe table and `pnpm wreck:meshes`; run on all eleven; the Draco mirror
   re-encoded; the bytes-level contract check and the shipped-vehicle test updated in the
   same step, so the tree never holds a wreck-less vehicle.
2. The gate: hide the death root in the live render; the wreck render and its two checks,
   with the floor measured.
3. The runtime: charred materials, the vehicle death path, the `addWreck` guard, tests.
4. The screenshot sheet; recipe tuning against it; the docs — the mesh contract's "Open,
   owned by the export side" section closes for vehicles, CLAUDE.md's mesh-vehicle death
   bullet is rewritten, and the queue's blast entry is updated to "the wreck exists; the
   blast is next".

## 6. Testing summary

Unit: `wreck-pass` (idempotence, shared mesh references, clip channels, every top-level live
node keyed), `validate_mesh_assets` (each contract clause falsified once), renderer death
path and materials. Bytes: the shipped-vehicle test. Gate: `pnpm validate:meshes` green with
the wreck checks, each falsified once (a no-op recipe, a wreck colliding with a live unit).
Whole: the full gate line, then the screenshot sheet.
