"""Export a building as a rigid glTF, from `tools/render_building.py`'s own
authored `.blend` sources.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_building.py -- mosque

    # or every building this pipeline covers:
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/export_mesh_building.py -- all

Writes `art/meshes/buildings/<type>.glb` (standing) and
`art/meshes/buildings/<type>_wreck.glb` (destroyed), per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`, extended for a
building -- see this task's report for the extension proposed and NOT yet
pinned into that doc.

Why a building is simpler than either sibling exporter, and where it is not:

  - **No armature, no skin, no clips, no turret pivot.**
    `packages/render/src/sheet.ts` says a structure sheet is "one frame,
    because a building never turns" -- so this file has no equivalent of
    `export_mesh_team.py`'s bones or `export_mesh_vehicle.py`'s
    `turret_pivot`. Every merged mesh is a top-level node, at rest pose,
    forever.
  - **No `metres_per_unit` derivation.** A vehicle's source is in arbitrary
    model units and a `real_metres` declared elsewhere converts it
    (`export_mesh_vehicle.py`'s whole `_read_real_metres`/`_bake_scale`
    pair). `tools/buildings/kit.py` never needed that: every part is built
    with `from_pydata` at final size in `dimetric.UNITS_PER_TILE`-scaled
    world units, which its own docstring already calls "about a metre per
    unit" -- so a building's own world units ARE this pipeline's real
    metres, by construction, with no second number to declare or drift out
    of sync with. The one place this needed baking rather than trusting: six
    of the seven sources show object-level scale (1,1,1) on every mesh
    already (`kit.py`'s own "object scale always 1" rule, enforced by
    construction); `mosque.blend` predates the kit and has 25 objects
    carrying real scale factors (a scaled cube for a wall, a squashed sphere
    for a dome). `_bake_object_transforms` below folds those into vertex
    data via `bpy.ops.object.convert`, the identical technique
    `export_mesh_vehicle.py`'s `_apply_modifiers` already uses for a
    different reason (baking Bevel/Subsurf) -- applied here to every object
    unconditionally, which is a no-op on the six sources that need no
    baking and fixes the one that does.
  - **A wreck state, which neither sibling has.** `render_building.py`
    already derives one deterministically from the standing geometry
    (`collapse`/`_dice`/`_punch`, all imported from there rather than
    retyped -- see the module-level import below for why that is now safe).
    Reused verbatim: the wreck glb is diced, punched and collapsed by the
    exact same hand-rolled, seed-free maths the shipped wreck SPRITE is, so
    the two can never silently diverge in shape. What it does NOT reuse is
    `ash_materials()` -- that repaints Blender materials for a Cycles
    render, and this pipeline ships zero materials in either state (idle or
    wreck): a wrecked mesh keeps its living roles (a collapsed wall stays
    role `wall`), and recolouring a wreck grey is left to whatever the
    eventual runtime consumer decides, the same way it decides an idle
    building's colour today.
"""
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "buildings"))

# render_building.py's own `main()` is now guarded (`if __name__ ==
# "__main__"`) specifically so this import is safe: without that guard,
# importing the module would immediately re-render every building's sprite to
# `assets/sprites/` as a side effect of import, which is not this script's
# business to do and would silently corrupt shipped, palette-quantized PNGs
# with raw unquantized Cycles output (measured while developing this file --
# see the report). BUILDINGS/BuildingSpec supply the drop/offset/footprint
# tables; collapse/_dice/_punch/the COLLAPSE_* constants are the wreck
# geometry ops, reused rather than retyped for the reason stated above.
from render_building import (  # noqa: E402
    BUILDINGS,
    BuildingSpec,
    collapse,
)
import kit as building_kit  # noqa: E402 -- tools/buildings/kit.py, ROLES is the building role vocabulary

REPO = os.path.dirname(HERE)
OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")

# How far a building's own measured ground (min z, after dropping non-footprint
# objects) may sit from the origin before this export refuses to trust the
# footprint-anchor assumption below. Kept tiny: the seven sources measured
# 0.000 (five of seven exactly, `warehouse` -0.005, `mosque` a few thousandths
# after its Ground/Cube/forecourt drop) -- anything larger means a future
# eighth building was NOT authored to this convention and the anchor claim
# needs re-deriving, not silently trusting.
GROUND_TOLERANCE = 0.05


@dataclass
class BuildingMeshSpec:
    unit_id: str
    render_spec: BuildingSpec  # the matching entry in render_building.BUILDINGS


SPECS = {name: BuildingMeshSpec(unit_id=name, render_spec=spec) for name, spec in BUILDINGS.items()}
DEFAULT_BUILDING = "wall"


def _open_and_prepare(spec: BuildingSpec):
    """Load the source, drop what the shipped sprite drops, apply the same
    offsets, and bake every object's transform to identity -- the shared
    first half of both the idle and the wreck export, kept as one function so
    the two passes can never see different geometry for a reason other than
    the wreck's own deterministic collapse.
    """
    bpy.ops.wm.open_mainfile(filepath=spec.src)

    for o in list(bpy.data.objects):
        if o.name in spec.drop:
            bpy.data.objects.remove(o, do_unlink=True)
        elif o.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(o, do_unlink=True)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"{spec.unit}: no meshes left after dropping {sorted(spec.drop)}")

    for name, (dx, dy, dz) in spec.offsets.items():
        o = bpy.data.objects.get(name)
        if o is None:
            raise SystemExit(f"{spec.unit}: offset names an object that is not here: {name!r}")
        o.location.x += dx
        o.location.y += dy
        o.location.z += dz

    # Bake every object's transform (location/rotation/scale) into its vertex
    # data via `transform_apply` -- the same operator
    # `export_mesh_vehicle.py`'s `_bake_scale` uses for its own mpu factor,
    # here applied to whatever each object already carries rather than to a
    # freshly-assigned uniform scale. Confirmed by probe
    # (`export_mesh_building.py`'s own report) that none of the seven sources
    # carry a modifier, so unlike the vehicle exporter's `_apply_modifiers`
    # this needs no `convert(target="MESH")` step at all. Harmless on six of
    # the seven sources, which already sit at location (0,0,0), identity
    # rotation and scale (1,1,1) -- `tools/buildings/kit.py`'s "object scale
    # always 1" rule, enforced by construction (`from_pydata` at absolute
    # coordinates, no `obj.scale` call anywhere in that module). The
    # exception is `mosque.blend`: predates the kit and places/sizes 25
    # objects the ordinary way (`primitive_..._add(location=..., scale=...)`,
    # some also rotated 90 degrees for an arch), which this bakes into real
    # vertex coordinates the identical way the kit's own parts already have
    # them.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for ob in meshes:
        sc = tuple(round(c, 4) for c in ob.scale)
        loc = tuple(round(c, 4) for c in ob.location)
        rot = tuple(round(c, 4) for c in ob.rotation_euler)
        if sc != (1.0, 1.0, 1.0) or loc != (0.0, 0.0, 0.0) or rot != (0.0, 0.0, 0.0):
            raise SystemExit(
                f"{spec.unit}: {ob.name} still carries scale={sc} loc={loc} rot={rot} "
                "after transform_apply()"
            )

    return meshes


def _validate_roles(unit_id, meshes):
    for o in meshes:
        role = o.get("rl_role")
        if role is None:
            raise SystemExit(f"{unit_id}: {o.name!r} carries no rl_role -- the kit/patch must set one")
        if role not in building_kit.ROLES:
            raise SystemExit(
                f"{unit_id}: {o.name!r} role {role!r} outside tools/buildings/kit.py's ROLES "
                f"{building_kit.ROLES}"
            )


def _extent_and_ground(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for o in meshes:
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            wc = eo.matrix_world @ v.co
            xs.append(wc.x)
            ys.append(wc.y)
            zs.append(wc.z)
        eo.to_mesh_clear()
    return xs, ys, zs


def _check_footprint_anchor(unit_id, footprint_centre, xs, ys, zs):
    """Verify, not assume: the model's own world origin at grade is the
    footprint anchor a future placement translates to -- see the report's
    proposed contract extension. `footprint_centre` is `render_building.py`'s
    own field, and every one of the seven shipped specs leaves it at its
    default `(0.0, 0.0)`; this only checks that the geometry actually agrees,
    the way `render_building.py`'s own camera-aim logic already implicitly
    trusts it to.
    """
    gx, gy = footprint_centre
    gz = min(zs)
    if abs(gz) > GROUND_TOLERANCE:
        raise SystemExit(
            f"{unit_id}: measured ground z={gz:.4f} is more than {GROUND_TOLERANCE} from 0 -- "
            "the footprint-anchor-at-origin assumption this exporter relies on does not hold "
            "for this source; see export_mesh_building.py's module docstring."
        )
    bbox_cx = (min(xs) + max(xs)) / 2.0
    bbox_cy = (min(ys) + max(ys)) / 2.0
    print(
        f"[{unit_id}] footprint anchor ({gx}, {gy}, z={gz:.4f}); "
        f"bbox centre ({bbox_cx:.3f}, {bbox_cy:.3f}) -- deliberately NOT the same point "
        "when an overhang drags the bbox off-centre"
    )


def _join_by_role(meshes, unit_id):
    """One merged mesh per `rl_role` present, named exactly the role --
    `export_mesh_vehicle.py`'s `_join_by_part_role` without the `part`
    dimension, since a building has no second rigid body to keep separate."""
    groups = defaultdict(list)
    for ob in meshes:
        groups[ob["rl_role"]].append(ob)

    merged = {}
    for role, obs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = role
        ob.data.name = role
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        merged[role] = ob
    print(f"[{unit_id}] roles: " + ", ".join(f"{r}={len(o)}" for r, o in sorted(groups.items())))
    return merged


def _vert_face_counts(merged):
    v = sum(len(o.data.vertices) for o in merged.values())
    f = sum(len(o.data.polygons) for o in merged.values())
    return v, f


def _export_glb(path, credit):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=credit,
    )
    return os.path.getsize(path)


def export_building(mesh_spec: BuildingMeshSpec):
    spec = mesh_spec.render_spec
    unit_id = mesh_spec.unit_id

    # --- idle -----------------------------------------------------------
    meshes = _open_and_prepare(spec)
    _validate_roles(unit_id, meshes)
    xs, ys, zs = _extent_and_ground(meshes)
    _check_footprint_anchor(unit_id, spec.footprint_centre, xs, ys, zs)
    merged_idle = _join_by_role(meshes, unit_id)
    idle_path = os.path.join(OUT_DIR, f"{unit_id}.glb")
    idle_size = _export_glb(idle_path, spec.credit)
    idle_v, idle_f = _vert_face_counts(merged_idle)
    print(f"[{unit_id}] wrote {idle_path} ({idle_size} bytes, {idle_v} verts, {idle_f} faces)")

    # --- wreck ------------------------------------------------------------
    # Fresh reload rather than continuing to mutate the idle pass's (already
    # joined, already exported) objects: `collapse()` dices every mesh to a
    # much finer resolution, and running that on top of an already-merged
    # per-role mesh would collapse ALL of a role's parts as one blob instead
    # of each original part getting its own break line the way
    # `render_building.py`'s own wreck sprite does (collapse runs there
    # BEFORE any join/material step exists in that pipeline at all).
    wreck_meshes = _open_and_prepare(spec)
    _validate_roles(unit_id, wreck_meshes)
    _, _, zs_all = _extent_and_ground(wreck_meshes)
    base_z, top_z = min(zs_all), max(zs_all)
    collapse(wreck_meshes, base_z, top_z)
    # collapse() only moves vertices and deletes faces (_punch); it never
    # touches custom properties, so every object's rl_role survives -- but
    # confirmed here rather than assumed, since a silently-dropped role on
    # the wreck side would be a much quieter failure than on the idle side.
    _validate_roles(unit_id, wreck_meshes)
    merged_wreck = _join_by_role(wreck_meshes, unit_id)
    wreck_path = os.path.join(OUT_DIR, f"{unit_id}_wreck.glb")
    wreck_size = _export_glb(wreck_path, spec.credit)
    wreck_v, wreck_f = _vert_face_counts(merged_wreck)
    print(f"[{unit_id}] wrote {wreck_path} ({wreck_size} bytes, {wreck_v} verts, {wreck_f} faces)")

    return {
        "unit_id": unit_id,
        "idle": {"path": idle_path, "bytes": idle_size, "verts": idle_v, "faces": idle_f,
                 "roles": sorted(merged_idle)},
        "wreck": {"path": wreck_path, "bytes": wreck_size, "verts": wreck_v, "faces": wreck_f,
                  "roles": sorted(merged_wreck)},
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv == ["all"]:
        names = list(SPECS)
    else:
        names = argv or [DEFAULT_BUILDING]
    results = []
    for name in names:
        if name not in SPECS:
            raise SystemExit(f"no BuildingMeshSpec for {name!r}; have {sorted(SPECS)}")
        print(f"=== {name} ===")
        results.append(export_building(SPECS[name]))
    print("SUMMARY_JSON " + json.dumps(results))


if __name__ == "__main__":
    main()
