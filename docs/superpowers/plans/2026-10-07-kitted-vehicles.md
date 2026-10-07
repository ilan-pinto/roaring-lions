# The Garage Uplift, Plan 3: Kitted Vehicles (GH-238)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development. One
> implementer per task, then one reviewer per task, in order. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal.** An upgraded vehicle looks different, in the garage and in the game. Each of the eight
KDF vehicles carries its kit parts as `kit_*` nodes in its one GLB; at load the renderer keeps
the parts the type's bought tiers own, merges them into the host node's geometry (+0 draw
calls), and deletes the rest.

**Spec:** `docs/superpowers/specs/2026-10-06-kitted-vehicles.md` (approved by the lead on
6 Oct, PR #418). Every recommendation in its §10 was accepted:

| # | Ruling |
|---|---|
| K1 | the 69 parts of §3, one place per track (§2.1) |
| K2 | M2: one GLB per vehicle, every part its own node, merged at load into existing nodes, keyed by the three track tiers |
| K3 | T1 pin and join, tone **Shade** (the hull's 25th-percentile paint texel); metal parts on the bake's own metal texel; no texture changes |
| K4 | no decorative kit |
| K5/K6 | accepted: the Peten reads from zoom 2.5; small firepower on the four weapon stations |
| K7 | real slat bars at 120 mm pitch, posts and rails 1.6x the bar |
| K8 | a gated `kitted` golden scenario (`vehicle` + `&kit`), blessed ONCE, after merge, from CI numbers |
| K9 | `heli_peten_gunship` and `officer_armour` out of plan 3 |
| K10 | sound A, "Bolt-on", as `ui_kit_fitted` |
| K11 | the 49 track close-ups, rendered from the turntable's camera |
| K12 | 0 Meshy credits |

**Standing rules from the lead.** Every part at MAXIMUM detail inside its §3 triangle budget,
Blender-modelled, never a box. The mocks were approved, so parts are built to the mock's
numbers (positions and sizes in `tools/vehicles/kit_blockout.py`'s `PARTS`).

**Status and entry.** Branch `art/kitted-vehicles`, worktree
`/Users/ilpinto/dev/roaring-lions-ep/kitted-build`, cut from `origin/main` `9a88fa70`. The
shared checkout `/Users/ilpinto/dev/roaring-lions` is never touched.

---

## Architecture

```
tools/vehicles/kit_blockout.py        (exists) the measuring instrument; placements are its PARTS
tools/vehicles/kit_parts.py           NEW  detailed hard-surface primitives (bmesh, real metres)
tools/vehicles/kit_vehicles.py        NEW  the 8 per-vehicle part tables, at detail, same numbers as PARTS
tools/vehicles/export_vehicle_kit.py  NEW  Blender: shipped GLB -> parts -> pinned UVs -> art/parts/kit/<id>.glb
tools/src/meshes/kit-pass.ts          NEW  pnpm kit:meshes: grafts art/parts/kit/<id>.glb into art/meshes/vehicles/<id>.glb
tools/src/meshes/wreck-pass.ts        learns kit_*: never twinned, never measured, never keyed by a clip
packages/render/src/three/units/vehicle-kit.ts   NEW  applyVehicleKit(root, tiers): keep, merge into host, delete
packages/render/src/api.ts            RendererOptions.unitKitTiers
```

**Pipeline for a vehicle, in this order:** `export_vehicle_kit.py` (Blender) ->
`pnpm kit:meshes` -> `pnpm wreck:meshes` -> `pnpm encode:meshes` -> `pnpm validate:meshes`.

**Why a graft and not a Blender re-export of the whole vehicle.** `export_officer_armour.py`
re-exports the Lavi through Blender, which is fine for a NEW unit. Here the GLB is a shipped
unit in every gated golden scenario. A gltf-transform graft adds nodes, meshes and accessors
and touches nothing else, so every live node's accessors stay byte-identical (Task 2 asserts
it), the Draco encode quantises per mesh (`draco()`'s default `quantizationVolume: 'mesh'`), and
at tiers 0 the merged template is the shipped one, so no gated scenario can move.

**Why `art/parts/kit/` and not `art/meshes/`.** `encode:meshes` ships every `.glb` under
`art/meshes/`, and `validate:meshes` renders every one. The kit source is an intermediate,
like a `.blend`; it lives beside the meshes, not inside them, where `art/parts/rpg7.glb` already sets the precedent.

### The contract (Task 2 writes it into `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`)

- A kit part is a node named `kit_<track>_<tier>_<host>` (`kit_armour_3_turret_hull`), one per
  (track, tier, host), with `extras.rl_kit = { track, tier, host }` and `extras.rl_role` equal to
  its host's role.
- **It shares its host's parent and its host's local transform**, so its vertices are in the
  host's own space and the merge is a concatenation with no matrix. (`kit-pass.ts` does the
  world-to-host transform once, at graft time.)
- Its primitive carries exactly the host's attribute set (`POSITION`, `NORMAL`, and
  `TEXCOORD_0` iff the host has it) and the host's material (none on a palette host).
- Tiers are cumulative within a track: tier 3 draws tiers 1, 2 and 3.
- `buildVehicleMeshTemplate(gltf, id, textured, tiers?)` calls `applyVehicleKit` first. Kept
  parts merge into the host geometry, host first, kit after (so `setDrawRange(0, hostCount)`
  can hide the kit, which is the `kit` debug layer). The new geometry is swapped onto EVERY mesh
  that shared the old one, which is the live node and its `WRECK_` twin, so the wreck carries
  its kit with the host's own displacement. Every `kit_*` node is then removed, owned or not.
  `tiers` absent or all 0 leaves the shipped template exactly.
- `pnpm wreck:meshes` never twins a `kit_*` node, never measures one, and never keys one in a
  clip. A hull-hosted kit node is a scene child; the clips must not reach it, because the
  renderer deletes it before a mixer exists.
- Every OTHER reader of a vehicle GLB ignores `kit_*` (Task 2's census).

### Tone (K3), decided in the exporter

The kit lands inside a textured GLB, so its colour is the UV it is pinned to. Every sub-piece of
a part carries a TONE, and the exporter pins its loops to one texel of the vehicle's own bake.
**As shipped** (the approved colour study's "L3 shade" column, which replaced the first draft of
this table, where sensors and firepower hardware shared `paint` and a radar face was `dark`):

| Tone | Used for | The texel |
|---|---|---|
| `paint` | **every armour face** (plates, ERA, slat, chains, side cages and skirts), and the paint parts of the weapon stations | the 25th-percentile luminance texel of `hull_hull`'s paint (`kit_blockout.percentile_colour(tex, 0.25)`'s rule) |
| `metal` | **every sensors and firepower face** (sight bodies, masts, camera heads, radar arrays, shrouds, magazines, containers), plus bolts, clamps and struts | the bake's own metal, by three rules in order: the median of `metallic >= 0.5` texels where a metallic-roughness map has any; else the median of a textured `*_metal` node's face texels; else, **the third rule** for a bake whose metallic map is uniform (the Namer, Eitan, Kipod, Shachaf and D9), the "greyest paint": the median of the least-saturated tenth of `hull_hull`'s texels in their 25th-95th luminance band, printed as a DEVIATION line |
| `dark` | **only** lenses, windows and apertures (a radar face is `metal` now) | the 5th-percentile luminance texel among `metal` candidates; where none sits in a flat window (the Lavi), the search widens to every textured island of the bake, and on a third-rule bake it is the 5th luminance percentile of every textured island |

The chosen texel must sit in a FLAT neighbourhood (a 16x16 window whose luminance spread is
under 0.02 linear, so bilinear filtering and the first mips do not bleed a neighbour in) and,
where the bake carries a normal map, on a NEUTRAL normal (`|n - (0.5, 0.5, 1)| < 0.06`). On a
palette host (the Namer, Eitan, Kipod and Shachaf weapon stations carry no material) a part has
no UVs and draws the host's ramp, like the station itself. The exporter prints each vehicle's
three chosen texels (UV, linear RGB, window spread) and the commit message carries them. A
vehicle's track tone is also applied per sub-piece after the fact: on the Lavi the A3 chains went
to `paint` and the F3 container to `metal`.

### Budgets

From the spec's §3, per vehicle, at maximum kit; `validate:meshes` holds every vehicle at
**<= 5,000** kit triangles and Task 4/5 hold each PART to its own §3 budget (+10% at most).

| Vehicle | Budget at max kit | Per-part budgets (A1 A2 A3 S1 S2 S3 F1 F2 F3) |
|---|---|---|
| `mbt_lavi` | 4,880 | 300 900 1800 260 320 480 260 300 260 |
| `ifv_namer` | 3,580 | 280 980 800 260 320 320 160 220 240 |
| `apc_eitan` | 3,850 | 360 880 1100 250 320 360 140 240 200 |
| `apc_kipod` | 3,590 | 560 840 800 250 220 340 140 240 200 |
| `jeep_shoded` | 2,560 | 360 300 560 200 220 300 220 200 200 |
| `scout_shachaf` | 2,340 | 280 360 600 160 140 300 120 200 180 |
| `dozer_d9` | 3,360 | 400 700 1300 300 260 400 - - - |
| `heli_peten` | 1,680 | 120 160 240 200 240 220 180 160 160 |

Detail is modelled down to 1 cm (spec §2.3): chamfered plate edges, bolt heads, hinges, lifting
eyes, lens recesses, clamp bands, chain links, lids and latches. Slat (K7): bars 30 mm at 120 mm
pitch, posts and rails 48 mm. Nothing below 1 cm.

---

## Global constraints (bind every task)

- **Worktree only.** All work in `/Users/ilpinto/dev/roaring-lions-ep/kitted-build`. Never touch
  `/Users/ilpinto/dev/roaring-lions`. Git by absolute path, one plain command per call:
  `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/kitted-build ...`.
- **Commits.** `/usr/bin/git -C <wt> commit -s -F <msgfile> -- <paths>`, never `git add -A`,
  never `git checkout -- <file>` to undo an edit (undo the edit). Message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Servers and browsers.** Ports **5231-5239** only, always explicit. Never 5177. Never
  `pkill`; stop only what you started, by PID, and check nothing you started is left
  (`lsof -iTCP:5231-5239 -sTCP:LISTEN`). One browser at a time. Every page seeds music off
  through `tools/src/ui-review/music-off.ts`.
- **Not run locally:** `pnpm ui:routes`, `pnpm golden-baseline`, `golden-baseline:bless`. CI runs
  them. No bless from this branch.
- **The four invariants.** Nothing here touches `packages/sim`. `/usr/bin/git diff --stat
  origin/main -- packages/sim` prints nothing at every commit.
- **Pipeline order** for any vehicle GLB change: export -> `kit:meshes` -> `wreck:meshes` ->
  `encode:meshes`, and `pnpm encode:meshes -- --check` clean before the commit.
- **Every check has an input that makes it fail, and that input has been run.** Prefer a
  one-line mutation of the implementation; the commit body says what was seen red.
- **Gates before every commit that touches their area:** `pnpm typecheck`, `pnpm lint`,
  `pnpm test` (or the touched specs, with the full run at the task's end),
  `pnpm validate:meshes` (Tasks 2, 4, 5, 6), `pnpm validate:audio` (Task 7),
  `python3 tools/portrait_manifest.py --check`.
- **AI art.** The parts are Blender-built, not AI art. The bakes they pin to are the vehicles'
  existing, disclosed Meshy bakes. 0 Meshy credits (K12).

---

## Task 1: This plan

- [x] Write this file; commit it alone.

## Task 2: The contract and the tools (no art yet)

**Files:** `tools/src/meshes/kit-pass.ts` (+ test), `tools/package.json` and root
`package.json` (`kit:meshes`), `tools/src/meshes/wreck-pass.ts` (+ test),
`packages/render/src/three/units/mesh-vehicle-shipped.test.ts`, every reader in the census
below, `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`.

- [x] `kit-pass.ts`: `pnpm kit:meshes [-- --id=<vehicle>]`, argv parsed as strictly as
  `parseWreckArgs` (an unknown argument is an error). For each vehicle with a source
  `art/parts/kit/<id>.glb`: strip every `kit_*` node of the target (and the meshes and
  accessors only they used, the `stripWreck` accessor trap), then for each source node: find
  the host by `rl_kit.host`, transform positions by `inverse(hostWorld)` and normals by its
  inverse-transpose (renormalised), copy into new accessors, set the host's material (or none),
  drop `TEXCOORD_0` on a palette host, require it on a textured one, and add the node under the
  host's parent with the host's TRS. Refuse: an unknown host, a host-less node, a name that
  does not match its `rl_kit`, a track/tier outside 1-3, a duplicate (track, tier, host).
  Idempotent: a second run is byte-identical (test). **Live accessors byte-identical before
  and after** (test, over a fixture with a parented turret host).
- [x] `wreck-pass.ts`: `kit_*` nodes are excluded from `liveTop` (clips), from `parts`
  (twins) and from `measure` (bounds, clearance). A wreck pass over a grafted file produces the
  same `death_root` subtree as over the ungrafted one (test).
- [x] `mesh-vehicle-shipped.test.ts`: the clip and twin assertions skip `kit_*` nodes, and a
  new assertion: every `kit_*` node satisfies the contract (name = rl_kit, host exists, same
  parent, same TRS, same material, same attribute set).
- [x] **Census.** `grep -rlE "meshes/vehicles|'vehicles'|\"vehicles\"|VEHICLE_UNIT_MESHES" tools
  packages` and decide each reader. At least: `render_mesh_gate.py` (shipped render and wreck
  render hide `kit_*`; Task 6 adds the kit renders), `render_unit_portraits.py`,
  `render_vehicle_glb.py`, `render_baked_pose.py`, `tools/src/perf/unit-footprints.ts`,
  `export_officer_armour.py` and `export_meshy_apache_gunship.py` (they RE-OPEN `mbt_lavi.glb`
  and `heli_peten.glb`: they must drop `kit_*` or the command Lavi and the gunship inherit
  every kit part), `kit_blockout.py`'s `load_vehicle`, `vehicle-weight-params.ts`,
  `validate_mesh_assets.py`'s wreck census. Each one gets a one-line `kit_*` skip and the commit
  lists every reader with its verdict.
- [x] Contract doc: the section above, as contract v5 (vehicles).
- [x] Falsify: graft with the transform left out (kit lands in world space under a turret
  pivot) -> the fixture test goes red; let the wreck pass twin `kit_*` -> its test goes red; let
  the clip key a kit node -> the shipped test goes red once a grafted file exists (re-checked in
  Task 4).

## Task 3: The runtime merge

**Files:** `packages/render/src/three/units/vehicle-kit.ts` (+ test),
`packages/render/src/three/units/mesh-vehicle.ts`, `packages/render/src/api.ts`,
`packages/render/src/three/ThreeRenderer.ts` (template build only),
`packages/render/src/three/debug-layers.ts`, `packages/app/src/main.ts`,
`packages/app/src/upgrade-prepass.ts` (+ test).

- [x] `applyVehicleKit(root, tiers)`: collect `kit_*` meshes by `rl_kit`; keep `tier <=
  tiers[track]`; group kept parts by host; for each host, `mergeGeometries([host, ...kept])`
  (host FIRST) and swap the result onto every mesh in the tree whose geometry is the host's old
  one (the `WRECK_` twin included); record the host's own index count in
  `geometry.userData.rlKitBaseCount`; remove EVERY `kit_*` node. Return the geometries no mesh
  references any more, so a caller that owns them can dispose them.
- [x] `buildVehicleMeshTemplate(gltf, id, allowTextured, tiers?)` calls it first, and disposes
  what it returns. No tiers, or every tier 0: the template is the shipped one (same mesh count,
  same geometry objects) -- a test.
- [x] `RendererOptions.unitKitTiers?: Readonly<Record<string, Readonly<Record<string,
  number>>>>` (three-only, Pixi ignores it). `ThreeRenderer.loadVehicleMesh` passes
  `opts.unitKitTiers?.[id]`. `upgradePrepass` gains `unitKitTiers` (KDF types only, from the
  SAME tiers object as `registered` and `unitKit`; its test pins that), and `main.ts` hands it
  to `RendererOptions`.
- [x] `kit` debug layer (`DEBUG_LAYERS`): hidden sets `setDrawRange(0, rlKitBaseCount)` on
  every kitted geometry, shown restores `Infinity`. A geometry with no kit is untouched.
- [x] Tests over a hand-built fixture: tiers {armour:2} keeps tiers 1-2 of armour only; the
  wreck twin's geometry is the merged one; mesh count unchanged; vertex count = host + kept;
  a palette host merges without UVs; the draw range hides exactly the kit.
- [x] **Draw calls, measured.** `tools/src/perf/kit-drawcalls.ts` (adapted from the spec's
  `measure/kit-drawcalls.mts`, but through the SHIPPED `buildVehicleMeshTemplate`): resets
  `renderer.info` BY HAND around the shadow pass (three r170 resets after it), twenty clones,
  shadow + main + an AO override pass. Requires 12 submissions per vehicle (6 for the D9) at
  tiers 0 and at tiers 3 alike. Run in Task 5 on the real GLBs; here on the blockout export.
- [x] Falsify: merge host LAST (the draw range then hides the wrong triangles -> test red);
  swap onto the live mesh only (wreck twin test red); keep `tier < t` instead of `<=` (test red).

## Task 4: The parts module and the Lavi, at maximum detail

**Files:** `tools/vehicles/kit_parts.py`, `tools/vehicles/kit_vehicles.py`,
`tools/vehicles/export_vehicle_kit.py`, `art/parts/kit/mbt_lavi.glb`,
`art/meshes/vehicles/mbt_lavi.glb`, `assets/meshes/vehicles/mbt_lavi.glb`,
`assets/meshes/manifest.json`, `.superpowers/kit/` (evidence, git-ignored).

- [x] `kit_parts.py`: real-metre bmesh builders with an explicit tone per sub-piece:
  chamfered plate (1 cm chamfer, optional bolt row), ERA brick (chamfered body, face plate,
  4 bolt heads), slat panel (48 mm posts and rails, 30 mm bars at 120 mm, welded brackets),
  chain curtain (oval links, end balls), telescoping mast (stepped tubes, clamp collars, a base
  flange with bolts), sight head (body, hood, lens recess + `dark` lens), camera head, radar
  array, barrel shroud (clamp bands), ammunition box (lid, latches, carry handle), cowl (bolted
  plates), lifting eyes, hinges. Every builder returns its triangle count; nothing below 1 cm.
- [x] `kit_vehicles.py`: the Lavi's nine parts at the positions and sizes of
  `kit_blockout.parts_mbt_lavi` (import its `Hull`, `barrel` and ray casts rather than retyping
  numbers).
- [x] `export_vehicle_kit.py --only mbt_lavi`: import the shipped GLB (drop `death_root`,
  `WRECK_*`, `kit_*`), build parts, choose the three texels (Tone table above), pin, join each
  (track, tier, host) into one node, write `art/parts/kit/mbt_lavi.glb`. It ASSERTS, per
  part: triangles <= 1.10 x the §3 budget; bounding box within 3 cm or 10% of the blockout's
  part (the "built to the mock's numbers" check); per vehicle: <= 5,000 total.
- [x] Run `pnpm kit:meshes -- --id=mbt_lavi`, `pnpm wreck:meshes -- --id=mbt_lavi`,
  `pnpm encode:meshes`; `pnpm validate:meshes` passes (shipped render unchanged, kit hidden).
- [x] **Picture check, in game.** Boot a sandbox on port 5231 with the brigade account seeded
  (`tools/src/ui-review/garage-seed.ts`) at Lavi levels 0-3, zoom 1.0 and 2.5; and the garage
  bay at L3. Compare with `docs/art/sheets/kitted-vehicles/mbt_lavi.png`. Every part present,
  on the hull, no z-fighting, no floating part, tone reads as add-on panels in base paint.
- [x] Falsify: a part over its budget -> the exporter refuses; a part moved 20 cm -> the
  blockout comparison refuses.

## Task 5: The other seven

**Files:** `kit_vehicles.py`, `art/parts/kit/*.glb`, `art/meshes/vehicles/*.glb` (7),
`assets/meshes/vehicles/*.glb` (7), `assets/meshes/manifest.json`.

- [x] `ifv_namer`, `apc_eitan`, `apc_kipod`, `jeep_shoded`, `scout_shachaf`, `dozer_d9` (no
  firepower), `heli_peten` (model metres, §2.4), each from its blockout table. The Eitan's F1
  sight hangs OUTBOARD of the station below its top (§3, the 0.8804 near-miss).
- [x] Pipeline per vehicle, `validate:meshes` green.
- [x] Draw calls on all eight real GLBs (Task 3's harness): 12 per vehicle (D9 6) at tiers 0
  and at tiers 3; record triangles per vehicle at L0..L3.
- [x] Picture check of every vehicle at L3, zoom 1.0 and 2.5 (evidence in `.superpowers/kit/`).

## Task 6: `validate:meshes` learns kit

**Files:** `tools/render_mesh_gate.py`, `tools/validate_mesh_assets.py`.

- [x] Static checks (JSON chunk, no Blender): every `kit_*` node's host exists with the same
  parent, TRS, material and attribute set; `rl_kit.track` is a track the unit's own JSON
  declares (no firepower part on the D9); tiers 1-3, no duplicate; kit triangles <= 5,000 per
  vehicle.
- [x] Renders: the shipped render hides `kit_*` (Task 2); add the maximum-kit render and the
  twelve variants the spec measured (each track alone at tiers 1-3, and L1, L2, L3; nine for the
  D9), each framed to its OWN bounds and IoU-checked against every other unit, limit 0.88, its
  own base excluded (a variant is meant to look like its base).
- [x] Falsify each check with a constructed input: a kit node on a missing host; a firepower
  node on the D9; a 6,000-triangle kit; a kit part moved so a variant collides (e.g. the Eitan
  F1 sight back ON TOP of the station, which read 0.8804 in the spec). All four red, then
  reverted. Gate time measured before/after.

## Task 7: The garage and the sound

**Files:** `packages/render/src/three/garage/garage-view.ts` (+ test),
`packages/app/src/ui/garage-viewer.ts`, `packages/app/src/ui/brigade.ts` (purchase hook),
`packages/app/src/ui/garage-model.ts` (+ test), `packages/render/src/audio.ts`,
`tools/gen_audio.py`, the audio manifest and clip, `tools/validate_audio.py` if it lists sets.

- [x] Garage view: `GarageViewOptions.kitTiers`; a vehicle is built through the same
  `buildVehicleMeshTemplate(..., tiers)`. The camera FIT is swept over the MAXIMUM-kit model, so
  buying kit never resizes the frame. `GarageView.setKit(tiers)` re-merges from the cached GLB
  (a pristine clone, never re-fetched) and redraws; the old template is released.
- [x] App: the bay passes the account's tiers; a bought tier on one of the eight calls
  `setKit` at the moment the purchase lands, and the cue is `'kit'`.
- [x] `PurchaseCue` gains `'kit'` -> `ui_kit_fitted`; `cueFor` returns it for an upgrade of a
  type whose bought tier adds a part (all eight vehicles, every tier). `gen_audio.py`'s
  `ui_kit_fitted` is candidate A exactly (`docs/art/sheets/kitted-vehicles/audio/
  kit_fitted_candidates.py`): RNG-free, <= 250 ms, mono, peak -6 dBFS (`UI_PEAK`), CC0;
  manifest entry; a synth branch in `audio.ts`'s `playUi` so a missing clip never falls to the
  alert. `pnpm validate:audio` green.
- [x] Falsify: `cueFor` returning `'upgrade'` for the Lavi -> red; drop the synth branch -> its
  test red; a clip at 300 ms -> `validate:audio` red.

## Task 8: The `kitted` golden scenario and the in-game sheets

**Files:** `tools/src/golden-diff/capture-protocol.ts`, `tools/src/golden-diff/baseline.ts`,
`tools/src/perf/kit-captures.ts` (NEW, `pnpm kit:capture`),
`docs/art/sheets/kitted-vehicles/final/`.

- [x] `KITTED_SCENARIO`: `VEHICLE_SCENARIO` plus `sandboxFlags: ['kit']`, gated, same tick and
  camera; its `units` layer check at the `vehicle` floor, and a `kit` layer check whose floor is
  a third of the smallest of three measured readings (measured by `kit:capture`'s own toggle
  A/B through the gate's capture protocol, not by running `golden-baseline`). No baseline is
  committed; CI's `visual` job is expected red (exit 1, missing entry in an existing manifest)
  until the post-merge bless (K8). The PR says so.
- [x] `kit:capture`: boots its own dev server on 5232, seeds music off and the brigade account
  at each level 0..3 (all eight vehicles), spawns the eight on open ground at one tile each,
  and photographs each at zoom 1.0 and 2.5, at the gate's camera pitch. Writes
  `final/zoom1.png`, `final/zoom2.5.png` (rows: vehicles, columns: L0 L1 L2 L3) and one PNG per
  cell; plus `final/garage-<id>.png` turntable captures at L3 (and an L0/L3 pair of the Lavi).
  Also prints the `kit` toggle readings for the scenario floor.
- [x] Falsify the scenario's `kit` check: run the toggle with `applyVehicleKit` given empty
  tiers -> 0 px, under the floor.

## Task 9: Kitted plates and the 49 close-ups

**Files:** `tools/src/perf/unit-plates.ts`, `assets/ui/plates/units/kit/`,
`packages/app/src/ui/portrait.ts`, `packages/render/src/three/garage/garage-view.ts` (focus),
`tools/src/perf/garage-closeups.ts` (NEW, `pnpm closeups:garage`),
`assets/ui/garage/closeups/`, `packages/app/src/ui/garage-board.ts`.

- [ ] `plates:units --kit`: the eight vehicles at L3 (every track at 3), one JPEG each in
  `assets/ui/plates/units/kit/` with its own manifest; `unitPlate(id, level)` returns the kitted
  plate at L >= 2 where one exists (parent spec §3.1). The bay's no-WebGL2 fallback is its only
  reader.
- [ ] Close-ups (K11): `GarageViewOptions.focus?: { track }` frames the camera, at the
  turntable's own FOV and elevation, on that track: for the eight vehicles, the bounds of that
  track's kit at tier 3 (others at 0); for every other KDF type, the region the track concerns,
  by role (`armour`: the body; `sensors`: the head and optics; `firepower`: the weapon, the
  `metal` role). 480x320 JPEG, one per type and track: 15 types x 3 + 2 x 2 = **49**.
  `garage-board.ts` shows the close-up in the track header where the hatch is today, glyph
  kept; a missing file falls back to the hatch.
- [ ] `python3 tools/portrait_manifest.py --check` stays green; `pnpm validate:ui` green.

## Task 10: Docs, provenance, the PR

- [ ] `docs/ASSET_PROVENANCE.md`: rows for `art/parts/kit/*.glb`, the kit nodes in the
  eight vehicle GLBs, the kitted plates, the close-ups and `ui_kit_fitted`.
- [x] `CLAUDE.md` "Mesh units": kit nodes, the merge, the pipeline order, the `kit` debug layer,
  the `kitted` scenario awaiting its bless. `docs/PERFORMANCE.md`: draw calls and triangles.
  The spec's status line.
- [ ] Full gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:meshes`, mesh
  tests, `pnpm validate:audio`, `pnpm validate:data`, `pnpm validate:ui`,
  `python3 tools/portrait_manifest.py --check`, `pnpm encode:meshes -- --check`.
- [ ] PR "art: kitted vehicles, kit you can see (GH-238 plan 3)": the K-table, the numbers,
  the sheets, the falsifications, the AI-art statement (parts Blender-built; bakes are the
  existing disclosed Meshy bakes), and "the `visual` job is red until the post-merge `kitted`
  bless; do not bless from the branch". Footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  Not merged, not blessed.
