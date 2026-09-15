# Mesh unit contract v1 — the file the art pipeline produces and the renderer consumes

**Date:** 2026-08-28 · **Status:** pinned for Phase F slice 1

This exists so the export side and the runtime side can be built in parallel
without either waiting on the other. It is the ONLY thing they share. Anything
not written here is that side's own business; anything written here changes only
by changing this file and telling both sides.

---

## Location and granularity

`art/meshes/<team_id>.glb` — one file per `tools/units/teams.py` `TEAMS` key
(`inf_squad`, `at_team`, …), not per soldier. A team's figures ship together
because they animate together and are drawn together.

## Contents

**Geometry — joined by role, not by part.** R0 exported one mesh per
`kit.figure()` part: 56 draw calls per soldier, fatal at 300 units. Join every
part sharing an `rl_role` into ONE skinned mesh, giving at most one mesh per
role present. No custom vertex attribute is needed for this and none may be
added: each role already wants its own material, so the role IS the draw-call
boundary.

Each such mesh must carry its role in BOTH places, deliberately redundantly:

- the glTF node/mesh **name** equal to the role string exactly (`uniform`,
  `webbing`, `boot`, `face`, `skin_shadow`, `metal`, `weapon`, `wood`,
  `charge`, `keffiyeh`)
- the node **`extras.rl_role`**, same string (requires `export_extras=True`;
  it is off by default and drops silently)

The runtime reads `extras` and falls back to the name. Either alone has failed
once already in this project.

**Roles are a closed set.** The ten above, from `tools/render_team.py`'s
`ROLE_PALETTE` / `BODY_PALETTE` / `SHARED_PALETTE`. A role outside the set must
be a loud failure on both sides, never a default colour.

**Skin.** One armature per file, covering every figure in the team. Bone names
prefixed by figure index — `f0_pelvis`, `f1_pelvis` — so a three-man team is
one skin and one set of draw calls rather than three.

**Clips**, named EXACTLY as `packages/render/src/sheet.ts`'s `ClipName` union:
`idle`, `move`, `fire`, `down`, `wreck`, `work`. A clip absent from the file is
legal (the runtime falls back the way `resolveClip` already does for sheets);
a clip present under any other name is a failure.

**Zero materials.** The exporter writes no material of any kind. Every colour
is applied on the runtime side from `data/palette.json`, so the palette
guarantee lives in exactly one place. This is not a convenience — R0's whole
Q1 result depends on colour never being decided in Blender.

**Units and orientation.** Built at real metres, `kit.py`'s convention (object
scale always 1, a standing figure 1.8 tall). Forward is **+X**. The runtime
scales by `1 / UNITS_PER_TILE` (3.0) because three draws one unit per tile.

## What the runtime guarantees in return

- It applies one material per role from a ramp SLICE, never from
  `ROLE_PALETTE`'s single base colour. (That table is calibrated for a
  multiply-style light — hence `LIT_GAIN` and "a figure renders at roughly half
  its base value". A toon LUT indexes rather than multiplies.)
- It drives clip choice from sim state through the existing `resolveClip`, so
  the sim contract is unchanged and no new sim coupling appears.
- It never writes to the file, never depends on part-level names, and never
  depends on bone names beyond the `f<N>_` prefix convention.

## Open, and owned by the export side to decide and report

- Whether the hip needs geometry change, a third bone, or an accepted seam.
- Bone count per figure beyond the 13 R0 used.
- ~~Whether `wreck` is a clip at all or stays separate geometry.~~ **Closed, for
  both asset classes, and the answer is the same shape twice: a clip that keys
  SCALE, switching between two sets of geometry that both live in the file.**
  Infantry closed it on 2026-09-01 (`rig.py`'s `_figure_death_parts` builds
  separate prone geometry under a per-figure `{prefix}_death_root`; every clip
  keys both roots' scale 1/0 living, 0/1 dead). Vehicles closed it on
  2026-09-15, procedurally rather than by hand — see "Vehicles: the wreck"
  below. Nothing needs a separate wreck FILE the way a building does, because
  a unit is one model with two poses in it and a building's two states are two
  models.

---

# v2 — vehicles and buildings

**Pinned 2026-08-29.** v1 above was written for rigged infantry and holds
unchanged for them. Two exporters have since shipped for asset classes it never
anticipated, each proposed an extension rather than improvising one, and both
are accepted. Where v2 differs from v1, the difference is stated as a
difference.

## Buildings: two sibling files, not one

`art/meshes/buildings/<type>.glb` (standing) **and**
`art/meshes/buildings/<type>_wreck.glb` (destroyed), keyed by
`render_building.py`'s own `BUILDINGS` key.

Two files rather than one, because v1's "node name equals its role exactly"
rule cannot host a live `wall` mesh and a wrecked `wall` mesh in the same file
without inventing a second axis it does not define — an `rl_state` wrapper, or
a `_wreck` suffix that breaks the naming rule itself. Splitting sidesteps the
ambiguity and **mirrors what already ships**: `render_building.py` writes
`idle_f00_000.png` and `wreck_f00_000.png` as separate files with separate
manifest entries, never one image.

A building is rigid and never turns (`sheet.ts`: "one frame, because a building
never turns"), so: no armature, no skin, no clips, no pivot. The footprint
anchor is the model's own world origin at z≈0 — **not** the bounding-box
centre, which sits 0.14–0.65 units off-origin on five of seven types from
asymmetric overhangs.

## Vehicles: `{part}_{role}`, a pivot node, and their own role vocabulary

**Mesh naming is `{part}_{role}`** — `hull_plate`, `turret_metal` — not the
bare role v1 requires. A bare-role join would merge hull and turret parts that
share a role into one mesh, and that mesh could not then rotate.

**The turret pivot** is a node named `turret_pivot` carrying
`extras.rl_pivot = "turret"` on that node and not its children. The runtime
looks it up by name and falls back to scanning `rl_pivot`, so a future crane or
dozer blade needs no new convention.

**Roles are a closed set per ASSET CLASS, not one universal ten.** Vehicles
carry `tools/vehicles/kit.py`'s `hull, plate, rubber, metal, glass, recess`;
only `metal` overlaps infantry's ten. The runtime's `MESH_ROLES`/`rampForRole`
are infantry-specific and would reject every vehicle role as unmapped, so
vehicles get a parallel `VEHICLE_MESH_ROLES` and `rampForVehicleRole`, read by
a separate `buildVehicleMeshTemplate` — a skinned single-armature figure and a
rigid hull-plus-pivot-turret share nothing beyond "walk the meshes, assign a
material".

**No faction parameter for vehicles**, and this is the one worth reading twice.
Infantry needs `MeshFaction` because ONE `inf_squad.glb` is reused for both
sides. **A vehicle GLB is faction-specific by construction** — `apc_eitan` is
KDF-only, `technical` and `gun_truck` are irregular-only — so the ramp choice
belongs to the unit type, not to the instance. The evidence is already in the
tree: `render_eitan.py` and `render_d9.py` map `hull → olive.*`, while
`render_gun_truck.py` maps `hull → dust.*` and `render_technical.py` maps
`hull → limestone.*`. That decision has always lived at "which vehicle", never
"which side".

**Render order is per-mesh, not blanket**: hull parts at `HULL_RENDER_ORDER`,
turret parts at `TURRET_RENDER_ORDER`, keyed off the `{part}_` prefix — the
same relationship the billboard path already encodes, for the same reason
(a turret must outrank its own hull at a co-located, identical-depth instance).

## Vehicles: the wreck, and the one place a mesh is deliberately shared

**Every `art/meshes/vehicles/<id>.glb` carries a `death_root`** — a top-level
sibling of the live geometry, the infantry `{prefix}_death_root` convention
applied to a rigid model — holding one `WRECK_<live node name>` child per live
MESH node. Design:
`docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md` §4.1.

**Each wreck child references the SAME `Mesh` object its live twin does.** This
is the one deliberate exception to "a node owns its geometry" in this document,
and it is a size decision with a measurement behind it: the eight Meshy-sourced
vehicles are 1.6–3.4 MiB each, and duplicating a buffer to pose it differently
would have cost that again per file. Sharing costs **+1,892…+3,220 bytes** for
the whole feature — the node graph, the clips and three accessors — which is
+0.1 % on the Meshy files and +12.3 % / +14.7 % on the two small palette ones
(`apc_kipod` 23,324 B, `scout_shachaf` 14,848 B). Measured on the shipped bytes
against `30d1867`, the last commit before any vehicle carried a wreck. A downstream byte ceiling on
this pass therefore wants to be about 4 KB and must not be a percentage.
`validate_mesh_assets.py` fails a wreck child whose mesh no live node
references, because a half-applied pass that copies geometry looks identical on
screen and costs the megabytes the contract exists to avoid.

**Two clips, `idle` and `wreck`**, each keying the SCALE of every top-level live
node and of `death_root` as constants — 1/0 and 0/1 — with `STEP`
interpolation over two keyframes 0.1 s apart. Exactly what the team rigs ship
and what `applyMeshClip` / `pickDeathClip` already play. These two names are
now reserved on a vehicle: the pass strips and rewrites any animation called
`idle` or `wreck`, so an exporter that authors a real idling shake under that
name would have it silently eaten.

**Each wreck child carries its live twin's `extras` plus `rl_wreck: true`.** The
role vocabulary above is unchanged and charring is NOT a role: it is a runtime
material treatment of anything carrying that flag (one shared dark ramp slice
for a palette vehicle, one tinted clone per distinct baked material for a
textured one). The mesh gate repaints every vehicle from the palette tables
before rendering, so it cannot see charring at all and says so out loud on its
passing path.

**The poses are PROCEDURAL, not authored**, written by `pnpm wreck:meshes` from
a recipe of fractions of each vehicle's own measured bounds
(`tools/src/meshes/wreck-recipes.ts`). The export side owns none of it and the
supplied `.blend`/Meshy sources are never opened. A later per-vehicle art pass
that ships real damaged geometry replaces a vehicle's `WRECK_` children and
changes nothing else here.

## Unchanged from v1, for every class

Zero materials. Real metres, scale derived via `dimetric`, never hand-typed.
Forward +X. `extras` requires `export_extras=True`, which is off by default and
drops silently. A role outside its class's closed set is a loud failure on both
sides, never a default colour.
