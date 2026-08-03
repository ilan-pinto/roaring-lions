"""
Render infantry soldier sprites from the BlendSwap Human Male Soldier model.
Credit: contmike (CC-BY 3.0, BlendSwap #40767)

Same two-phase pipeline as render_tiger.py:
  1. Open rigged blend, select first soldier, preserve armature pose, export OBJ
  2. Import OBJ into clean scene, render 16 dimetric facings
"""

import bpy
import math
import os
import json
import sys
import tempfile
from mathutils import Vector

BLEND = os.path.abspath("art/src/human_male_soldier.blend")
OUT = "packages/app/public/assets/sprites/INF"
SIZE = 256
FACINGS = 16
DIMETRIC_ELEVATION = math.atan(0.5)

KEEP_PARENTS = {"Man_rig", "Gun_armature"}
SKIP_MESHES = {"floor", "switch", "switch.panel", "Plane", "Plane.001", "Plane.002"}


def bake_and_export():
    """Open the rigged blend, keep only the first soldier, export OBJ."""
    bpy.ops.wm.open_mainfile(filepath=BLEND)

    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        if obj.name in SKIP_MESHES:
            continue
        parent_name = obj.parent.name if obj.parent else None
        if parent_name not in KEEP_PARENTS:
            continue

        # Apply armature modifiers to bake the rest-pose vertex positions.
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        for mod in list(obj.modifiers):
            if mod.type == "ARMATURE":
                try:
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                except Exception as exc:
                    sys.stderr.write(f"modifier_apply failed on '{obj.name}': {exc}\n")

        # Clear parent but preserve the world-space position the armature gave.
        mat = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mat

        obj.select_set(True)
        count += 1
        sys.stderr.write(f"Keeping '{obj.name}' ({len(obj.data.vertices)} verts)\n")

    # Deselect non-kept objects.
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            obj.select_set(False)

    obj_path = os.path.join(tempfile.gettempdir(), "soldier_baked.obj")
    bpy.ops.wm.obj_export(
        filepath=obj_path,
        export_selected_objects=True,
        apply_modifiers=False,
        export_materials=False,
        up_axis="Z",
        forward_axis="NEGATIVE_Y",
    )
    print(f"Exported {count} meshes to {obj_path}")
    return obj_path


def render_from_obj(obj_path):
    """Import OBJ into a clean scene and render with the locked rig."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=obj_path, up_axis="Z", forward_axis="NEGATIVE_Y")
    print(f"Imported OBJ: {len([o for o in bpy.data.objects if o.type == 'MESH'])} meshes")

    # Military olive-green material — slightly lighter and more matte than tanks.
    mat = bpy.data.materials.new("SoldierOlive")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.28, 0.30, 0.20, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.05
    out_node = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    all_pts = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for v in obj.data.vertices:
            all_pts.append(obj.matrix_world @ v.co)

    xs = sorted(p.x for p in all_pts)
    ys = sorted(p.y for p in all_pts)
    zs = sorted(p.z for p in all_pts)
    mid = len(all_pts) // 2
    center = Vector((xs[mid], ys[mid], zs[mid]))

    dists = sorted((p - center).length for p in all_pts)
    radius = max(dists[int(len(dists) * 0.95)], 0.001)
    print(f"Bounds: center={center}, radius={radius:.1f} (p95, {len(all_pts)} verts)")

    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)
    for obj in list(bpy.context.collection.objects):
        if obj.type == "MESH":
            obj.parent = pivot
            obj.matrix_parent_inverse = pivot.matrix_world.inverted()

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    world = bpy.data.worlds.new("rig_world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0, 0, 0, 0)
    bg.inputs[1].default_value = 0.0
    sc.world = world

    sun_data = bpy.data.lights.new("KEY", type="SUN")
    sun_data.energy = 4.0
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("KEY", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.pi / 2 - math.radians(55), 0.0, math.radians(135))

    fill_data = bpy.data.lights.new("FILL", type="SUN")
    fill_data.energy = 0.35
    fill_data.color = (0.66, 0.77, 0.82)
    fill_data.angle = math.radians(60)
    fill = bpy.data.objects.new("FILL", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(35), 0, math.radians(135) + math.pi)

    cam_data = bpy.data.cameras.new("CAM")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("CAM", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam

    az = math.radians(225)
    dist = radius * 6
    horiz = math.cos(DIMETRIC_ELEVATION) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIMETRIC_ELEVATION) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIMETRIC_ELEVATION, 0, az + math.pi / 2)
    cam.data.ortho_scale = radius * 2.0 * 1.15
    print(f"Camera ortho_scale={cam.data.ortho_scale:.1f}")

    os.makedirs(OUT, exist_ok=True)
    step = 2.0 * math.pi / FACINGS
    base_z = pivot.rotation_euler.z
    manifest = {
        "unit": "infantry_soldier",
        "facings": FACINGS,
        "size": SIZE,
        "frames": 1,
        "files": [],
    }

    for f in range(FACINGS):
        pivot.rotation_euler.z = base_z + f * step
        bpy.context.view_layer.update()
        name = f"f{f:02d}_000.png"
        sc.render.filepath = os.path.join(OUT, name)
        bpy.ops.render.render(write_still=True)
        manifest["files"].append({"facing": f, "frame": 0, "file": name})
        print(f"Rendered {name}")

    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"DONE {FACINGS} frames -> {OUT}")


if __name__ == "__main__":
    obj_path = bake_and_export()
    render_from_obj(obj_path)
