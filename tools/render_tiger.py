"""
Render Tiger Tank sprites by exporting evaluated meshes into a clean scene.

The BlendSwap Tiger Tank (2013) has a sequencer strip and old-format render
settings that fight with modern Cycles. Instead of fighting those settings,
this script:
  1. Opens the rigged blend
  2. Evaluates the depsgraph to bake armature deformations
  3. Exports each mesh to a new-mesh data block with baked verts
  4. Saves those meshes to a temp file
  5. Starts a fresh factory scene
  6. Imports the baked meshes
  7. Renders with the locked dimetric rig
"""

import bpy
import math
import os
import json
import sys
import tempfile
from mathutils import Vector

BLEND = os.path.abspath("art/src/tiger_tank_rigged.blend")
OUT = "packages/app/public/assets/sprites/TNK"
SIZE = 256
FACINGS = 16
DIMETRIC_ELEVATION = math.atan(0.5)


SKIP_MESHES = {"Track_1", "Track_1.001"}
MAX_DIM = 15.0


def bake_and_export():
    """Open the rigged blend, strip armature transforms, export local-space meshes."""
    bpy.ops.wm.open_mainfile(filepath=BLEND)

    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if obj.name in SKIP_MESHES:
            print(f"Skipping track animation mesh '{obj.name}'")
            continue
        # Strip parent and object transforms so the OBJ exporter writes
        # local-space vertex data. In local space, all parts (hull, turret,
        # barrel, wheels) are correctly assembled — the armature is what
        # scatters them to wrong world positions.
        obj.parent = None
        obj.location = (0, 0, 0)
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)
        # Skip rig control geometry (ground planes, antenna handles) that
        # dwarfs the actual tank body (~10 units long).
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for v in obj.data.vertices:
            lo = Vector(map(min, lo, v.co))
            hi = Vector(map(max, hi, v.co))
        local_dims = hi - lo
        if max(local_dims.x, local_dims.y, local_dims.z) > MAX_DIM:
            sys.stderr.write(f"Skipping oversized mesh '{obj.name}' (dims={local_dims.x:.1f}x{local_dims.y:.1f}x{local_dims.z:.1f})\n")
            obj.select_set(False)
            continue
        z_ratio = local_dims.z / max(local_dims.x, local_dims.y, 0.001)
        if z_ratio > 3.0:
            sys.stderr.write(f"Skipping tall rig pole '{obj.name}' (z_ratio={z_ratio:.1f})\n")
            obj.select_set(False)
            continue
        obj.select_set(True)
        count += 1

    obj_path = os.path.join(tempfile.gettempdir(), "tiger_tank_baked.obj")
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

    # Import the baked OBJ
    bpy.ops.wm.obj_import(filepath=obj_path, up_axis="Z", forward_axis="NEGATIVE_Y")
    print(f"Imported OBJ: {len([o for o in bpy.data.objects if o.type == 'MESH'])} meshes")

    # Olive-green material
    mat = bpy.data.materials.new("TankOlive")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.22, 0.24, 0.15, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Metallic"].default_value = 0.3
    out_node = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    # Collect all vertex positions and apply material
    all_pts = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for v in obj.data.vertices:
            all_pts.append(obj.matrix_world @ v.co)

    # Median center (robust to barrel/antenna outliers)
    xs = sorted(p.x for p in all_pts)
    ys = sorted(p.y for p in all_pts)
    zs = sorted(p.z for p in all_pts)
    mid = len(all_pts) // 2
    center = Vector((xs[mid], ys[mid], zs[mid]))

    # 95th-percentile radius — hull fills the frame, barrel pokes out slightly
    dists = sorted((p - center).length for p in all_pts)
    radius = max(dists[int(len(dists) * 0.95)], 0.001)
    print(f"Bounds: center={center}, radius={radius:.1f} (p95, {len(all_pts)} verts)")

    # Create rotation pivot
    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)

    for obj in list(bpy.context.collection.objects):
        if obj.type == "MESH":
            obj.parent = pivot
            obj.matrix_parent_inverse = pivot.matrix_world.inverted()

    # Render setup
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

    # Transparent world
    world = bpy.data.worlds.new("rig_world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0, 0, 0, 0)
    bg.inputs[1].default_value = 0.0
    sc.world = world

    # Key light
    sun_data = bpy.data.lights.new("KEY", type="SUN")
    sun_data.energy = 4.0
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("KEY", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (
        math.pi / 2 - math.radians(55),
        0.0,
        math.radians(135),
    )

    # Fill light
    fill_data = bpy.data.lights.new("FILL", type="SUN")
    fill_data.energy = 0.35
    fill_data.color = (0.66, 0.77, 0.82)
    fill_data.angle = math.radians(60)
    fill = bpy.data.objects.new("FILL", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(35), 0, math.radians(135) + math.pi)

    # Ortho camera on locked dimetric vector
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
    cam.rotation_euler = (
        math.pi / 2 - DIMETRIC_ELEVATION,
        0,
        az + math.pi / 2,
    )
    cam.data.ortho_scale = radius * 2.0 * 1.15
    print(f"Camera ortho_scale={cam.data.ortho_scale:.1f}")

    # Render 16 facings
    os.makedirs(OUT, exist_ok=True)
    step = 2.0 * math.pi / FACINGS
    base_z = pivot.rotation_euler.z
    manifest = {
        "unit": "tiger_tank",
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
