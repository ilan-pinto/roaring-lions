"""Export the Meshy-generated armed technical as a hull+turret glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_truck.py

Writes `art/meshes/vehicles/technical.glb`.

SOURCES (two separate files, unlike the tank -- see this task's report,
`.superpowers/f-meshy-truck-report.md`, for the full reasoning):

  art/blend/truck/Meshy_AI_Technical_Truck_Body_0829203857_image-to-3d-texture.blend
      single mesh object `mesh_node`, 983,143 verts, one material,
      three packed 4096/2048 textures -- the truck bed already carries
      modelled jerry cans, no gun.

  art/blend/truck/Meshy_AI_Pintle_Mount_Machine__0829203951_image-to-3d-texture.blend
      single mesh object `mesh_node`, 987,449 verts, one material, its own
      three packed textures -- a complete pedestal-mounted DShK: base
      plate, post, cradle, gun body, barrel.

Both AI-generated (Meshy), disclosed per CONTRIBUTING.md.

Why two files is a GOOD thing here, and simpler than the tank. The tank's
one welded mesh needed a geometric face-cut with hole-filling
(`export_meshy_tank.py`) to separate hull from turret. This source is
already split at the object level -- no cut, no boundary-loop fill, no
geometric ambiguity. What replaces that complexity is a different problem:
**the two files are independently Meshy-normalised and share no common
scale.** Measured: the pintle mount's own longest axis is 1.905 model
units, against the truck body's 1.896 -- nearly identical, despite one
being a full pickup and the other a machine gun on a pedestal. That is a
Meshy export-normalisation coincidence, not a real-world size relationship,
confirmed by rendering both (see the report) -- the pintle mount is
obviously a gun-sized object, not truck-sized, and applying the hull's
scale factor to it would produce a gun mount roughly 3 m tall. So this
script derives TWO independent metres-per-unit factors, one per source,
each declared against its own real-world reference (see REAL_METRES_HULL /
REAL_METRES_TURRET below), and manually places the resulting turret at an
authored position on the hull -- there is no geometric information in
either file that relates one to the other's coordinate frame.

DECIMATION. Both sources are Meshy's refined/textured output, not its
low-poly mode: ~985k verts each, roughly 100x this pipeline's other
vehicles (mbt_lavi's cut geometry ships at 9,349; apc_eitan at 61,887).
Blender's Decimate modifier (COLLAPSE, edge-collapse) is applied directly
to each whole object before any other processing -- ratios measured against
this specific pair of meshes (see the report for the vertex-count table and
before/after silhouette renders), landing hull at ~13.8k verts and turret
at ~9.7k verts, both inside this pipeline's 8-20k order of magnitude and
both silhouette-preserving at the render sizes checked.

ORIENTATION. Neither source points +X. Measured independently (not
assumed) by binning vertices along each model's own long axis: the truck's
cab/hood sits at negative X and its loaded cargo bed at positive X, so its
nose faces -X; the pintle mount's thin barrel-tip cross-section sits at
extreme negative X (elevated in Z) while its base-plate/post cluster sits
near positive X, so its muzzle also points -X. Both get the same baked
180-degree Z rotation, independently, in their own local frames, after
their own scale bake.

GROUND / PLACEMENT. The hull's own origin sits at its vertical midpoint
(z range roughly symmetric before ground-align), same defect as every
other Meshy source in this pipeline -- shifted up by its own lowest vertex
so the wheels touch z=0, the kit-vehicle convention. The turret has no
natural relationship to the hull's coordinate frame at all (two unrelated
files), so its placement on the truck bed is an authored decision, not a
derived one: see WORLD_PLACEMENT_M below for the measurement that produced
it (a histogram of the hull's own cargo-bed region, converted through the
hull's own mpu) and the sanity check against real truck-bed height.
"""
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper

REPO = os.path.dirname(TOOLS)
SRC_HULL = os.path.join(
    REPO, "art", "blend", "truck",
    "Meshy_AI_Technical_Truck_Body_0829203857_image-to-3d-texture.blend",
)
SRC_TURRET = os.path.join(
    REPO, "art", "blend", "truck",
    "Meshy_AI_Pintle_Mount_Machine__0829203951_image-to-3d-texture.blend",
)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "technical.glb")

#: technical's own declared real-world size -- read from the sprite sheet it
#: currently ships with (TECH_HULL/render_technical.py's own VehicleSpec),
#: same pattern as export_meshy_tank.py reading TNK_HULL's manifest. This is
#: the hull's longest axis (nose to tailgate).
TECH_HULL_MANIFEST = os.path.join(REPO, "assets", "sprites", "TECH_HULL", "manifest.json")

#: The pintle mount has no manifest of its own to read and no geometric
#: relationship to the hull's scale (see module docstring). Declared instead
#: from the unit's own weapon data: data/units/enemy/technical.json's single
#: weapon is `dshk` (a real DShK 12.7mm HMG, overall gun length 1.625 m).
#: 1.8 m adds the pedestal cradle's reach beyond the gun body itself, which
#: the model's own longest axis (barrel-to-rear-fitting) includes. This is a
#: declared editorial figure, not a derived one -- flagged here rather than
#: hidden, the same way mbt_lavi's inherited 6.32 m was flagged rather than
#: silently accepted.
REAL_METRES_TURRET = 1.8

#: The role every mesh in this export gets. Both sources are single-material
#: with no sub-region hints (no separate materials, no vertex colours, no
#: name hints) -- same situation as mbt_lavi, same resolution: everything is
#: `hull`, the "painted body" role.
ROLE = "hull"

#: Decimate ratios, measured against THESE two meshes (see report for the
#: vertex-count table and before/after silhouette renders) -- not a general
#: formula, because Decimate's COLLAPSE algorithm's actual output count
#: depends on mesh topology, not just target ratio.
DECIMATE_RATIO_HULL = 0.015
DECIMATE_RATIO_TURRET = 0.010

#: Where the turret_pivot lands in the FINAL (rotated, ground-aligned, +X
#: forward) hull frame, in metres. Derived from a histogram of the hull's
#: OWN cargo-bed region (x > 0.30 model units in the hull's pre-rotation
#: source frame, where the loaded jerry cans sit) -- centred left-right,
#: biased toward the rear (65% of the way from bed-front to tailgate), at
#: the bed-floor height read from the low-density valley in that region's
#: z-histogram (~0.02 model units, between the floor/wall cluster and the
#: jerry-can mass above it). After the hull's own 180-degree rotation and
#: ground shift this works out to (-1.635, 0.0, 0.819) m -- sanity-checked
#: against the hull's own 5.0 m declared length (65% into the rear half, not
#: at the very tailgate edge) and against a real pickup's bed-floor height
#: (~0.8-0.9 m), both plausible. See the report for the full derivation;
#: this is an authored placement, not something either source file encodes.
WORLD_PLACEMENT_M = (-1.635, 0.0, 0.819)


def _read_real_metres(manifest_path):
    import json
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _extent_of(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    m = eo.to_mesh()
    xs, ys, zs = [], [], []
    for v in m.vertices:
        wc = eo.matrix_world @ v.co
        xs.append(wc.x)
        ys.append(wc.y)
        zs.append(wc.z)
    eo.to_mesh_clear()
    return max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def _load_object(path, new_name):
    """Append `mesh_node` from `path` into the CURRENT scene, renamed so two
    files' identically-named root objects don't collide once both are
    loaded together."""
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "mesh_node"]
    if not dst.objects or dst.objects[0] is None:
        raise SystemExit(f"{path}: no 'mesh_node' object found")
    ob = dst.objects[0]
    bpy.context.collection.objects.link(ob)
    ob.name = new_name
    ob.data.name = new_name
    if ob.modifiers:
        raise SystemExit(f"{new_name}: carries {len(ob.modifiers)} modifier(s) on load -- unexpected")
    return ob


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(f"[{label}] decimate ratio={ratio}: {before_v} -> {after_v} verts, {before_p} -> {after_p} polys")


def _turret_pivot_local(ob, eps=0.05):
    """Horizontal centroid of the lowest-z vertex layer -- the base plate's
    underside, the same "lowest contact layer" convention
    `export_mesh_vehicle.py`'s `_turret_pivot` uses for a turret ring.
    Measured on the FULL (pre-decimate) mesh so it is not sensitive to which
    exact verts survive decimation; decimate preserves the overall silhouette
    (see the report) so the post's footprint centre does not move materially.
    """
    zmin = min(v.co.z for v in ob.data.vertices)
    layer = [v.co for v in ob.data.vertices if v.co.z <= zmin + eps]
    cx = sum(p.x for p in layer) / len(layer)
    cy = sum(p.y for p in layer) / len(layer)
    return (cx, cy, zmin)


def _rotate_180z(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def export():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    hull_obj = _load_object(SRC_HULL, "hull_src")
    turret_obj = _load_object(SRC_TURRET, "turret_src")

    # Real-world scale, independently per source (see module docstring).
    real_metres_hull = _read_real_metres(TECH_HULL_MANIFEST)
    extent_hull = _extent_of(hull_obj)
    mpu_hull = metres_per_unit(extent_hull, real_metres_hull)
    print(
        f"[technical] hull extent {extent_hull:.4f} model units -> {real_metres_hull:.3f} m declared "
        f"({mpu_hull:.5f} m/unit, real_metres from {TECH_HULL_MANIFEST})"
    )

    extent_turret = _extent_of(turret_obj)
    mpu_turret = metres_per_unit(extent_turret, REAL_METRES_TURRET)
    print(
        f"[technical] turret extent {extent_turret:.4f} model units -> {REAL_METRES_TURRET:.3f} m declared "
        f"({mpu_turret:.5f} m/unit, dshk-derived, see module docstring)"
    )

    # Turret pivot, measured in the turret's OWN pre-scale, pre-rotate,
    # pre-decimate frame (see _turret_pivot_local docstring).
    pivot_local = _turret_pivot_local(turret_obj)
    print(f"[technical] turret pivot (source frame, model units): {tuple(round(c, 4) for c in pivot_local)}")

    # Decimate. Order: after measuring extent/pivot on the full mesh, before
    # everything else -- so every later step (rotate, bake scale, ground
    # align) operates on the cheap mesh.
    _decimate(hull_obj, DECIMATE_RATIO_HULL, "hull")
    _decimate(turret_obj, DECIMATE_RATIO_TURRET, "turret")

    # Contract naming and role, before bake/rotate so nothing downstream
    # needs to remember which object is which.
    if ROLE not in vehicle_kit.ROLES:
        raise SystemExit(f"role {ROLE!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")
    for ob, part in ((hull_obj, "hull"), (turret_obj, "turret")):
        name = f"{part}_{ROLE}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = ROLE
        ob["rl_part"] = part

    # Bake scale into vertex data, independently per part (object scale
    # stays 1, the mesh contract's convention).
    _bake_scale([hull_obj], mpu_hull)
    _bake_scale([turret_obj], mpu_turret)
    pivot_scaled = tuple(c * mpu_turret for c in pivot_local)

    # Reorient. Both sources point -X (verified independently, see module
    # docstring); bake 180 degrees about Z into each, AFTER its own scale
    # bake, in its own local frame.
    _rotate_180z([hull_obj])
    _rotate_180z([turret_obj])
    pivot_rotated = (-pivot_scaled[0], -pivot_scaled[1], pivot_scaled[2])

    # Ground-align the hull: its own origin sits at the vertical midpoint
    # (same defect as every other Meshy source in this pipeline), not at
    # ground level. Shift up by its own lowest vertex.
    hull_zmin = min(v.co.z for v in hull_obj.data.vertices)
    shift_hull = -hull_zmin
    bpy.ops.object.select_all(action="DESELECT")
    hull_obj.location.z = shift_hull
    hull_obj.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[technical] hull ground shift +{shift_hull:.4f} m (lowest vertex -> z=0)")

    # Place the turret on the truck bed. No geometric relationship between
    # the two source frames exists (see module docstring) -- translate the
    # turret so its own pivot point lands exactly at the authored
    # WORLD_PLACEMENT_M, in the hull's now-final (rotated, ground-aligned)
    # frame.
    delta = tuple(WORLD_PLACEMENT_M[i] - pivot_rotated[i] for i in range(3))
    bpy.ops.object.select_all(action="DESELECT")
    turret_obj.location = delta
    turret_obj.select_set(True)
    bpy.context.view_layer.objects.active = turret_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    pivot_world = WORLD_PLACEMENT_M
    print(f"[technical] turret translated by {tuple(round(c, 4) for c in delta)} m -> pivot at {pivot_world}")

    pivot_obj = bpy.data.objects.new("turret_pivot", None)
    pivot_obj.empty_display_size = 0.15
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot_world
    inv = Matrix.Translation(Vector(pivot_world) * -1.0)
    turret_obj.parent = pivot_obj
    turret_obj.matrix_parent_inverse = inv

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=(
            "Armed technical hull+turret -- AI-generated (Meshy), disclosed per "
            "CONTRIBUTING.md; truck body and pintle-mounted DShK from two separate "
            "Meshy exports, combined for this repository"
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(f"[technical] wrote {OUT_PATH} ({size} bytes)")
    return OUT_PATH


if __name__ == "__main__":
    export()
