#!/usr/bin/env python3
"""
Roaring Lions -- Phase G headless mesh render, for the CI mesh art gate.

Renders every mesh unit under `art/meshes/` at the locked dimetric angle so
`validate_mesh_assets.py` can run the same palette/silhouette checks
`validate_assets.py` already runs on sprites -- see that script's own
docstring for what it checks and why.

Usage (headless):
    blender -b -P tools/render_mesh_gate.py -- --out <dir> [glb paths...]

With no glb paths, every `art/meshes/**/*.glb` is discovered and rendered --
deliberately, since other streams are actively adding new team and vehicle
GLBs under `art/meshes/` and this gate must see them without an edit here.

## What is rendered, and why it needs materials at all

The mesh unit contract (`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`)
is explicit that a shipped GLB carries **zero materials** -- colour is applied
at runtime from `data/palette.json`, keyed by each part's `rl_role` (or
`rl_role`/`rl_part` for a vehicle). Importing the bare GLB and rendering it
would produce Blender's default grey material on every part, which is neither
on-palette nor informative. So this script re-derives the SAME role -> colour
mapping the runtime uses, and colours the parts before rendering -- not to
byte-reproduce three.js's real-time toon-ramp shader (that guarantee is
structural and tested elsewhere: `palette-material.ts`'s ramp lookup can only
ever emit a palette entry, and `mesh-material.test.ts` covers it under
skinning), but so the rendered silhouette and its on-palette-ness are
meaningful to check at all.

`art/meshes/` ships six different kinds of mesh, told apart by which
subdirectory they live in (`art/meshes/vehicles/`, `art/meshes/buildings/`,
`art/meshes/vfx/`, `art/meshes/decor/`, `art/meshes/campaign/`, everything
else is an infantry team) -- discovered from the path, not from a hardcoded
per-file list, because other streams are actively adding new GLBs under all
six and this script must see them without an edit here. Each of the first three kinds has its
own closed `rl_role` vocabulary and its own role->colour table:

  * **Infantry teams** reuse `tools/render_team.py`'s `ROLE_PALETTE` /
    `BODY_PALETTE` / `SHARED_PALETTE` directly, by importing that module and
    calling its own `apply_materials` -- not copied, so there is exactly one
    table to keep in sync with the sprite pipeline a mesh is compared
    against.
  * **Vehicles** (`hull`, `plate`, `rubber`, `metal`, `glass`, `recess`) get
    a PER-VEHICLE table, because the sprite pipeline itself tunes vehicle
    tones per unit (`render_eitan.py`'s olive.0 hull is not `render_d9.py`'s
    olive.1). `VEHICLE_ROLE_PALETTES` below is hand-copied from both of
    those modules' own `ROLE_PALETTE` dicts, keyed by unit id, with a generic
    fallback for a vehicle mesh neither one covers yet.
  * **Buildings** (`wall`, `roof`, `trim`, `dome`, `wood`, `glass`, `metal`,
    `rust`) get `tools/render_building.py`'s own `ROLE_PALETTE`, hand-copied
    for the same reason as the vehicle tables below -- except `wall`, which
    that module deliberately leaves out of its own table because it is
    per-building (brick or flat stone, from that building's own colour). This
    script resolves it the same way the sprite pipeline's data ultimately
    does: `data/structures.json`'s `types.<id>.color`, read directly (it is
    leaf data, not code) rather than duplicated as a fourth hand-kept table.
  * **VFX** (`art/meshes/vfx/`, e.g. `muzzle_flash.glb`) is SKIPPED by this
    gate entirely -- `render_one` returns before importing anything, once
    `mesh_kind` reads `vfx`. Not an oversight: a modelled VFX asset is not a
    UNIT, and this gate's whole apparatus (one representative POSE, a
    silhouette compared for collision against every OTHER unit's own
    silhouette) answers a question that has no meaning for it -- a muzzle
    flash reading similar in outline to a rifleman is not the "these read as
    the same unit in a fight" failure this gate exists to catch. Its own
    palette discipline is enforced a different, STRONGER way instead
    (`packages/render/src/three/units/muzzle-flash.ts`'s own top comment:
    each zone's fragment shader can only ever emit one already-resolved
    `reserved.vfx` entry, the identical structural guarantee
    `toonRampMaterial` gives lit geometry) -- there is no rendered PNG this
    gate could check that would tell you anything the shader does not
    already guarantee by construction.
  * **Decor** (`art/meshes/decor/`, e.g. `rock_0.glb`) is SKIPPED the same
    way and for the same reason: not a unit, no faction, no roster entry to
    read a "same as its own retired sprite" exclusion from, and no per-object
    palette table (`decor-role.ts`'s own top comment: "a rock is the same
    grey whichever family placed it"). `tools/validate_mesh_assets.py` checks
    its contract (zero materials, closed `{foliage, trunk, rock, sand}` role
    set) directly against the raw GLB bytes instead, in its own decor branch.
  * **Campaign maps** (`art/meshes/campaign/`, e.g. `sahar_basin.glb`) are
    SKIPPED for the same reason again, and one more that is specific to
    them. Not a unit: a campaign world is the BOARD the player picks a
    mission from, it has no faction, no roster entry and no retired sprite,
    and "does this read as a different unit" is meaningless for a landmass.
    The extra reason is that this gate's palette check could not be applied
    even in principle -- the whole subject of the asset is BIOME (forest,
    desert, snow, water, cultivation), which is colour at a constant normal,
    and `toonRampMaterial` indexes its ramp BY NORMAL. Repainting it from the
    palette the way `_repaint_buildings` does would render one flat colour
    per slope angle and the gate would be measuring a stand-in with none of
    the asset's content in it. `tools/validate_mesh_assets.py` checks the
    campaign contract (one material/image/texture, `extras.rl_map_role` in a
    closed set, `rl_region` ids joining `data/campaign/world.json`, one
    marker per declared town) against the raw GLB bytes in its own branch.

None of `render_eitan.py`, `render_d9.py`, or `render_building.py` is
imported for its table: each performs real work at module scope from a
plain import -- `render_eitan.py` and `render_d9.py` both build a `VehicleSpec`
that opens a `.blend` via `bpy.ops.wm.open_mainfile` to resolve turret mesh
names or similar, and `dimetric.py`'s own docstring already warns that
"importing render_building runs a full building render at import time". Any
one of those would silently wipe or hijack this script's own scene.

## Camera and lighting

Reuses `tools/render_rig.py`'s own `build_rig`, `world_bounds` and
`frame_camera` directly -- the exact rig the sprite pipeline renders through,
not a re-derived approximation of it. `world_bounds()`'s raw `obj.bound_box`
was checked against a depsgraph-evaluated (posed) bounds computation for a
skinned, posed figure and the two agreed to the metre; see the report this
task produced for the numbers. Infantry gets `tools/render_team.py`'s tuned
ambient world on top (`AMBIENT`/`AMBIENT_COLOR`) for the same reason that
module added it: a standing figure is mostly vertical surface and renders
near-black under the bare key+fill rig alone. Vehicles keep the bare rig,
matching `render_vehicle.py`.

## One representative pose, not a full facing turntable

Every unit is rendered at exactly one orientation -- however its root object
imported, with no extra rotation applied -- and, for a skinned mesh, at frame
0 of its `idle` clip if one exists (its bind/rest pose otherwise). This
mirrors `validate_assets.representative()`'s own canonical choice of "the
idle pose at facing 00, frame 000" for the silhouette/IoU comparison, and
keeps CI cost to one Cycles render per mesh rather than sixteen. Palette and
framing are therefore checked on this one pose only, not across every facing
a unit could turn to -- a documented scope limit, not an oversight; see the
report.
"""
import glob
import json
import os
import struct
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# Read-only reuse of tools/units/teams.py's team -> faction registry (TEAMS),
# and of tools/render_team.py's role -> palette tables via apply_materials.
# Neither is written to; the exclusion in this task's brief is about edits.
sys.path.insert(0, os.path.join(HERE, "units"))

from dimetric import palette_linear  # noqa: E402
from render_rig import build_rig, frame_camera, wipe_scene, world_bounds  # noqa: E402
import render_team  # noqa: E402 -- side-effect-free at import; see module docstring.

REPO = os.path.dirname(HERE)
MESHES_DIR = os.path.join(REPO, "art", "meshes")
STRUCTURES_PATH = os.path.join(REPO, "data", "structures.json")

SIZE = 256
SAMPLES = 64

# unit id -> rl_role -> palette key, for the vehicle kit's closed role
# vocabulary (tools/vehicles/kit.py's ROLES). Hand-copied from each vehicle's
# own render_*.py ROLE_PALETTE rather than imported -- see this file's module
# docstring for why importing those modules is unsafe to do here. A vehicle
# mesh with no entry here falls back to VEHICLE_ROLE_PALETTE_FALLBACK, a
# generic KDF-toned guess, with a loud warning rather than a silent one --
# extend this table when a new vehicle mesh ships.
VEHICLE_ROLE_PALETTES = {
    "apc_eitan": {
        "hull": "olive.0", "plate": "olive.0", "metal": "gunmetal.2",
        "rubber": "shadow.0", "glass": "gunmetal.3",
    },
    "dozer_d9": {
        "hull": "olive.1", "plate": "olive.2", "metal": "gunmetal.1",
        "rubber": "shadow.0", "glass": "gunmetal.3", "recess": "shadow.1",
    },
    # tools/render_paramotor.py's own ROLE_PALETTE, hand-copied like the rest.
    # An enemy vehicle mesh, so the generic KDF fallback is wrong for it
    # rather than merely approximate -- and wrong in an unusually visible way
    # here: this unit's `hull` is the FABRIC CANOPY (that script's own comment
    # on the entry is "# canopy"), a sun-bleached dust tone, not olive armour,
    # and the canopy is ~90% of what this unit's silhouette is.
    # tools/render_technical.py's own ROLE_PALETTE, hand-copied like the rest.
    # Added 2026-09-01 with the repaint: `technical` was the one shipped vehicle
    # mesh absent from this table, so the drift guard in
    # vehicle-mesh-role.test.ts -- which only checks vehicles the gate knows --
    # could not have caught a one-sided colour change to it. Repainting it was
    # exactly such a change, so the hole is closed in the same commit.
    "technical": {
        "hull": "limestone.4", "plate": "limestone.6", "metal": "gunmetal.2",
        "rubber": "shadow.0", "glass": "gunmetal.3", "recess": "shadow.1",
    },
    "paramotor": {
        "hull": "dust.0", "plate": "dust.1", "metal": "gunmetal.2",
        "rubber": "shadow.0", "glass": "gunmetal.3", "recess": "shadow.1",
    },
    # tools/render_rocket_battery.py's own ROLE_PALETTE, hand-copied like the
    # two above. The one enemy vehicle mesh in the tree, and the reason the
    # generic KDF fallback is wrong for it rather than merely approximate:
    # that script's own comment is "dust hull for a truck the Grad drives --
    # sun-rotted ochre, not the KDF's olive".
    "rocket_battery": {
        "hull": "dust.1", "plate": "dust.2", "metal": "gunmetal.2",
        "rubber": "shadow.0", "glass": "gunmetal.3", "recess": "shadow.1",
    },
}
VEHICLE_ROLE_PALETTE_FALLBACK = {
    "hull": "olive.0", "plate": "olive.0", "metal": "gunmetal.2",
    "rubber": "shadow.0", "glass": "gunmetal.3", "recess": "shadow.1",
}

# rl_role -> palette key for the building kit's closed role vocabulary
# (tools/buildings/kit.py's ROLES), hand-copied from render_building.py's own
# ROLE_PALETTE. `wall` is deliberately absent, exactly as it is in that
# module's own table -- see WALL_FALLBACK_KEY and building_wall_key() below.
BUILDING_ROLE_PALETTE = {
    "roof": "dust.6",
    "trim": "terracotta.1",
    "dome": "limestone.1",
    "wood": "dust.4",
    "glass": "shadow.0",
    "metal": "gunmetal.2",
    "rust": "terracotta.2",
}
WALL_FALLBACK_KEY = "limestone.4"


def discover_glbs():
    return sorted(glob.glob(os.path.join(MESHES_DIR, "**", "*.glb"), recursive=True))


def read_glb_json(path):
    """The glTF JSON chunk, parsed without touching bpy or Blender's own
    scene state -- used only to classify a file (skinned team vs rigid
    vehicle) before deciding how to colour it."""
    with open(path, "rb") as fh:
        data = fh.read()
    _magic, _version, length = struct.unpack("<III", data[0:12])
    offset = 12
    while offset < length:
        chunk_len, chunk_type = struct.unpack("<II", data[offset:offset + 8])
        chunk_data = data[offset + 8:offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:  # 'JSON'
            return json.loads(chunk_data)
        offset += 8 + chunk_len
    raise ValueError(f"{path}: no JSON chunk found -- not a valid glb")


def is_skinned(glb_json):
    return bool(glb_json.get("skins"))


def mesh_kind(glb_path):
    """'vehicle' / 'building' / 'vfx' / 'decor' / 'campaign' / 'infantry',
    from which subdirectory of art/meshes/ the file lives in -- see this
    file's module docstring for why path, not content, is the discovery
    signal."""
    rel = os.path.relpath(os.path.abspath(glb_path), MESHES_DIR)
    top = rel.split(os.sep)[0]
    if top == "vehicles":
        return "vehicle"
    if top == "buildings":
        return "building"
    if top == "vfx":
        return "vfx"
    if top == "decor":
        return "decor"
    if top == "campaign":
        return "campaign"
    return "infantry"


_STRUCTURES = None


def structures_registry():
    global _STRUCTURES
    if _STRUCTURES is None:
        with open(STRUCTURES_PATH) as fh:
            _STRUCTURES = json.load(fh)["types"]
    return _STRUCTURES


def building_wall_key(unit_id):
    """The palette entry `data/structures.json` assigns this building's own
    colour -- the same source `render_building.py`'s per-building
    `colour_key` ultimately traces to. `_wreck` variants share their living
    building's id and colour."""
    base_id = unit_id[:-len("_wreck")] if unit_id.endswith("_wreck") else unit_id
    entry = structures_registry().get(base_id)
    if entry is None:
        print(f"MESH_GATE_WARN: {unit_id}: no data/structures.json entry for "
              f"{base_id!r} -- 'wall' role defaulted to {WALL_FALLBACK_KEY}")
        return WALL_FALLBACK_KEY
    return entry["color"]


def team_registry_entry(team_id):
    """(faction, sheet) for an infantry team id, from tools/units/teams.py's
    own TEAMS registry -- read, never reimplemented, so a correction there is
    picked up here for free. Returns (None, None) if the id is unknown to
    that registry (a new team a parallel stream added ahead of it).

    `teams.py` imports `tools/units/kit.py`, which imports `bpy` at module
    scope -- so this lookup only works INSIDE Blender, which is exactly where
    this function runs. `validate_mesh_assets.py` (the plain-Python wrapper
    that needs the same `sheet` value, to know a mesh's own retired sprite
    directory for the IoU exclusion) cannot import `teams` itself for that
    reason; `render_one` below prints it out as `MESH_GATE_SHEET` for that
    script to read back instead.
    """
    try:
        import teams  # tools/units/teams.py
    except ImportError:
        return None, None
    entry = teams.TEAMS.get(team_id)
    return (entry[1], entry[2]) if entry else (None, None)


def cull_unroled_meshes():
    """Remove any MESH object the importer produced with no `rl_role`.

    Observed once, on this machine, for every file: a stray 42-vertex
    "Icosphere" mesh appears after `bpy.ops.import_scene.gltf`, parented to
    nothing, absent from the glTF's own JSON node list entirely (checked by
    hand -- see the report). It is not team or vehicle content; nothing in
    the mesh unit contract produces an unroled mesh, and the contract itself
    says a part with no role is a bug to raise on, not guess at (that rule
    covers a part carrying an UNRECOGNISED role, which still raises below --
    this only strips parts carrying NO role marker at all, which is import
    noise rather than authored content). Left in, it would render as
    Blender's default grey material and corrupt every check downstream:
    off-palette by construction, and inflating the framed bounds and the
    silhouette mask with geometry no player ever sees.
    """
    stray = []
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.get("rl_role") is None:
            stray.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    return stray


def apply_idle_pose():
    """Set every armature in the scene to frame 0 of its `idle` action, if
    one exists. A no-op for a vehicle (no armature) or a team file that
    happens to ship no `idle` clip (renders its bind pose instead)."""
    action = bpy.data.actions.get("idle")
    found_armature = False
    for obj in bpy.context.scene.objects:
        if obj.type != "ARMATURE":
            continue
        found_armature = True
        if action is None:
            continue
        if obj.animation_data is None:
            obj.animation_data_create()
        obj.animation_data.action = action
        bpy.context.scene.frame_set(int(action.frame_range[0]))
    if found_armature:
        bpy.context.view_layer.update()


def _material_cache_shader(cache, key):
    if key not in cache:
        cache[key] = render_team._shader(  # noqa: SLF001 -- intentional reuse, see module docstring.
            f"Mesh_{key.replace('.', '_')}", palette_linear(key)
        )
    return cache[key]


def apply_vehicle_materials(mesh_objs, unit_id):
    table = VEHICLE_ROLE_PALETTES.get(unit_id)
    if table is None:
        table = VEHICLE_ROLE_PALETTE_FALLBACK
        print(f"MESH_GATE_WARN: {unit_id}: not in VEHICLE_ROLE_PALETTES -- "
              f"coloured from the generic fallback table instead of its own tones")
    cache = {}
    for ob in mesh_objs:
        role = ob.get("rl_role")
        key = table.get(role)
        if key is None:
            raise SystemExit(
                f"{ob.name}: no vehicle palette key for rl_role {role!r} (unit "
                f"{unit_id!r}) -- VEHICLE_ROLE_PALETTES in tools/render_mesh_gate.py "
                f"must cover every role tools/vehicles/kit.py's ROLES can produce"
            )
        ob.data.materials.clear()
        ob.data.materials.append(_material_cache_shader(cache, key))


def apply_building_materials(mesh_objs, unit_id):
    wall_key = building_wall_key(unit_id)
    cache = {}
    for ob in mesh_objs:
        role = ob.get("rl_role")
        key = wall_key if role == "wall" else BUILDING_ROLE_PALETTE.get(role)
        if key is None:
            raise SystemExit(
                f"{ob.name}: no building palette key for rl_role {role!r} (unit "
                f"{unit_id!r}) -- BUILDING_ROLE_PALETTE in tools/render_mesh_gate.py "
                f"must cover every role tools/buildings/kit.py's ROLES can produce"
            )
        ob.data.materials.clear()
        ob.data.materials.append(_material_cache_shader(cache, key))


def render_one(glb_path, out_root):
    unit_id = os.path.splitext(os.path.basename(glb_path))[0]
    kind = mesh_kind(glb_path)
    if kind == "vfx":
        # Not a unit -- see this module's own docstring, "VFX is SKIPPED by
        # this gate entirely", for why no representative pose or silhouette
        # comparison applies. Prints through the existing MESH_GATE_WARN
        # channel (validate_mesh_assets.py already parses and surfaces it as
        # `[warn]`) rather than a new prefix that script would not read --
        # and, deliberately, neither MESH_GATE_OK nor MESH_GATE_FAIL: no PNG
        # is produced, so this id never enters the palette/framing/
        # silhouette checks either, which is the whole point of the skip.
        print(f"MESH_GATE_WARN: {unit_id}: vfx-class mesh -- skipped by this "
              f"gate (not a unit; see tools/render_mesh_gate.py's own docstring)")
        return
    if kind == "decor":
        # Also not a unit, same reasoning as vfx above: `decor-place.ts`
        # scatters these across open ground with no faction, no per-object
        # palette table, and nothing for this gate's "does this read as a
        # DIFFERENT unit" silhouette-collision check to mean anything against
        # -- a rock is not on anyone's roster. Rendering one through this
        # gate's infantry/vehicle/building path would also be actively wrong,
        # not merely pointless: `mesh_kind` used to fall through decor to
        # 'infantry' (the function's own default for an unrecognised
        # subdirectory) before this branch existed, which sent every decor
        # GLB into `apply_materials(mesh_objs, faction, casualty=False)` --
        # a table keyed by the INFANTRY role vocabulary (helmet/vest/skin/...)
        # that has no entry for `foliage`/`trunk`/`rock`/`sand` and raises.
        # `tools/validate_mesh_assets.py` runs the decor contract check
        # (zero materials, closed role set) directly against the raw GLB
        # bytes instead -- see that script's own decor branch.
        print(f"MESH_GATE_WARN: {unit_id}: decor-class mesh -- skipped by this "
              f"gate (not a unit; see tools/render_mesh_gate.py's own docstring)")
        return
    if kind == "campaign":
        # Also not a unit, and additionally the one kind whose palette check
        # could not be applied even in principle: the asset's subject is
        # biome, which is colour at a constant normal, and the ramp this gate
        # would repaint it with is indexed BY normal. See the module
        # docstring's "Campaign maps" bullet. Contract-checked from the raw
        # GLB bytes by tools/validate_mesh_assets.py instead.
        print(f"MESH_GATE_WARN: {unit_id}: campaign-class mesh -- skipped by this "
              f"gate (not a unit; see tools/render_mesh_gate.py's own docstring)")
        return
    glb_json = read_glb_json(glb_path)
    skinned = is_skinned(glb_json)
    if skinned != (kind == "infantry"):
        print(f"MESH_GATE_WARN: {unit_id}: kind={kind!r} (from its path) but "
              f"skins={skinned!r} (from its content) -- these normally agree")

    wipe_scene()
    bpy.ops.import_scene.gltf(filepath=glb_path, import_scene_extras=True)

    stray = cull_unroled_meshes()
    if stray:
        print(f"MESH_GATE_WARN: {unit_id}: dropped {len(stray)} unroled mesh "
              f"object(s) before rendering: {stray}")

    mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not mesh_objs:
        raise SystemExit(f"{unit_id}: no mesh geometry after import -- nothing to render")

    if kind == "infantry":
        faction, sheet = team_registry_entry(unit_id)
        if faction is None:
            faction = "kdf"
            print(f"MESH_GATE_WARN: {unit_id}: not found in tools/units/teams.py "
                  f"TEAMS -- faction defaulted to 'kdf' rather than guessed correctly")
        if sheet:
            print(f"MESH_GATE_SHEET: {unit_id} {sheet}")
        render_team.apply_materials(mesh_objs, faction, casualty=False)
        apply_idle_pose()
    elif kind == "vehicle":
        apply_vehicle_materials(mesh_objs, unit_id)
    else:
        apply_building_materials(mesh_objs, unit_id)

    cam = build_rig(SIZE)
    bpy.context.scene.cycles.samples = SAMPLES
    if kind == "infantry":
        # Standing/kneeling figures are mostly vertical surface and render
        # near-black under the bare key+fill rig alone -- the same finding
        # tools/render_team.py's own AMBIENT comment records. Reuse its
        # tuned values rather than re-deriving them.
        bg = bpy.context.scene.world.node_tree.nodes["Background"]
        bg.inputs[0].default_value = render_team.AMBIENT_COLOR
        bg.inputs[1].default_value = render_team.AMBIENT

    lo, hi = world_bounds()
    frame_camera(cam, lo, hi)

    out_dir = os.path.join(out_root, unit_id)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "idle_f00_000.png")
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"MESH_GATE_OK: {unit_id} ({kind}) -> {out_path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--out" not in argv:
        raise SystemExit("usage: blender -b -P tools/render_mesh_gate.py -- --out <dir> [glb ...]")
    out_idx = argv.index("--out")
    out_root = argv[out_idx + 1]
    paths = argv[:out_idx] + argv[out_idx + 2:]
    paths = [p for p in paths if p]
    if not paths:
        paths = discover_glbs()
    if not paths:
        print("no glb files found under art/meshes -- nothing to render")
        return

    failures = []
    for path in paths:
        try:
            render_one(path, out_root)
        except (Exception, SystemExit) as exc:  # noqa: BLE001 -- one bad mesh must not sink the batch.
            unit_id = os.path.splitext(os.path.basename(path))[0]
            print(f"MESH_GATE_FAIL: {unit_id}: {exc}")
            failures.append(unit_id)

    if failures:
        print(f"MESH_GATE_SUMMARY: {len(paths) - len(failures)}/{len(paths)} rendered, "
              f"failed: {failures}")
    else:
        print(f"MESH_GATE_SUMMARY: {len(paths)}/{len(paths)} rendered")


if __name__ == "__main__":
    main()
