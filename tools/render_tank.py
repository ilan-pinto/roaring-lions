"""
Render Tiger Tank as separate hull and turret sprite sheets.

Two passes per facing:
  - Hull pass:   hide turret + barrel meshes, render hull + wheels + stowage
  - Turret pass: hide hull + wheel meshes, render turret + barrel

Output:
  assets/sprites/TNK_HULL/f{facing}_000.png   (16 facings)
  assets/sprites/TNK_TURR/f{facing}_000.png   (16 facings)

Uses the same OBJ-export pipeline as render_tiger.py to dodge the vintage
sequencer/render-settings in the 2013 BlendSwap file.
"""

import bpy
import math
import os
import json
import sys
import tempfile
from mathutils import Vector, Matrix

BLEND = os.path.abspath("art/src/tiger_tank_rigged.blend")
OUT_HULL = os.path.abspath("assets/sprites/TNK_HULL")
OUT_TURR = os.path.abspath("assets/sprites/TNK_TURR")
SIZE = 256
FACINGS = 16
# Sheet conventions, reported to the renderer through the manifest.
FACING_OFFSET = 5  # sprite index that looks along world +x
FACING_REVERSE = True  # this loop rotates opposite to world bearing
DRAW_SCALE = 1.8  # sprite width in tile widths
DIMETRIC_ELEVATION = math.atan(0.5)

SKIP_MESHES = {"Track_1", "Track_1.001"}
MAX_DIM = 15.0

# Meshes bone-parented to these bones (or their descendants) are turret parts.
TURRET_BONES = {"Bone.001", "Bone.002", "Bone.003"}

# Explicitly named turret meshes (fallback if parenting detection misses them).
TURRET_MESH_NAMES = {"Tiger_Tank_Main.001", "Tiger_Tank_Main.002"}


def reencode_png(path):
    """Re-encode a PNG through Pillow to strip Blender metadata chunks."""
    try:
        from PIL import Image
        img = Image.open(path)
        img.save(path, "PNG", optimize=True)
    except ImportError:
        sys.stderr.write("WARNING: Pillow not available, skipping re-encode\n")


def classify_meshes():
    """Return (hull_names, turret_names) by inspecting bone parenting."""
    hull = set()
    turret = set()

    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if obj.name in SKIP_MESHES:
            continue

        is_turret = False

        # Check explicit name list.
        if obj.name in TURRET_MESH_NAMES:
            is_turret = True

        # Check bone parenting chain.
        if not is_turret and obj.parent_type == "BONE" and obj.parent_bone in TURRET_BONES:
            is_turret = True

        # Check if any ancestor is a known turret mesh.
        if not is_turret:
            p = obj.parent
            while p is not None:
                if p.name in TURRET_MESH_NAMES:
                    is_turret = True
                    break
                if p.parent_type == "BONE" and p.parent_bone in TURRET_BONES:
                    is_turret = True
                    break
                p = p.parent

        if is_turret:
            turret.add(obj.name)
        else:
            hull.add(obj.name)

    return hull, turret


def bake_and_export():
    """Open the rigged blend, classify meshes, export to OBJ."""
    bpy.ops.wm.open_mainfile(filepath=BLEND)

    hull_names, turret_names = classify_meshes()
    print(f"Hull meshes ({len(hull_names)}): {sorted(hull_names)}")
    print(f"Turret meshes ({len(turret_names)}): {sorted(turret_names)}")

    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if obj.name in SKIP_MESHES:
            continue

        obj.parent = None
        obj.location = (0, 0, 0)
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)

        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for v in obj.data.vertices:
            lo = Vector(map(min, lo, v.co))
            hi = Vector(map(max, hi, v.co))
        local_dims = hi - lo
        if max(local_dims.x, local_dims.y, local_dims.z) > MAX_DIM:
            sys.stderr.write(f"Skipping oversized mesh '{obj.name}'\n")
            obj.select_set(False)
            continue
        z_ratio = local_dims.z / max(local_dims.x, local_dims.y, 0.001)
        if z_ratio > 3.0:
            sys.stderr.write(f"Skipping tall rig pole '{obj.name}'\n")
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
    return obj_path, hull_names, turret_names


def setup_clean_scene(obj_path, hull_names, turret_names):
    """Import OBJ into a clean scene and set up camera/lights/material."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=obj_path, up_axis="Z", forward_axis="NEGATIVE_Y")

    imported = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"Imported {len(imported)} meshes")

    # Tag each imported mesh as hull or turret based on the classification
    # from the original blend (names survive OBJ round-trip).
    hull_objs = []
    turret_objs = []
    for obj in imported:
        if obj.name in turret_names:
            turret_objs.append(obj)
        else:
            hull_objs.append(obj)

    print(f"Classified: {len(hull_objs)} hull, {len(turret_objs)} turret")

    # Olive-green material.
    mat = bpy.data.materials.new("TankOlive")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.22, 0.24, 0.15, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Metallic"].default_value = 0.3
    out_node = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    all_pts = []
    for obj in imported:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for v in obj.data.vertices:
            all_pts.append(obj.matrix_world @ v.co)

    # Median center (robust to barrel/antenna outliers).
    xs = sorted(p.x for p in all_pts)
    ys = sorted(p.y for p in all_pts)
    zs = sorted(p.z for p in all_pts)
    mid = len(all_pts) // 2
    center = Vector((xs[mid], ys[mid], zs[mid]))

    dists = sorted((p - center).length for p in all_pts)
    # True maximum, not a percentile. A percentile discards outlying vertices,
    # and on a tank the outlier is the gun barrel -- so the barrel tip fell
    # outside the frame at the facings where it points along a screen axis.
    # Hull and turret share this radius and one camera, so widening it shrinks
    # both by the same factor and the composite stays aligned.
    radius = max(dists[-1], 0.001)
    print(f"Bounds: center={center}, radius={radius:.1f} ({len(all_pts)} verts)")

    # Rotation pivot.
    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)

    for obj in imported:
        obj.parent = pivot
        # pivot.matrix_world is still identity here -- Blender has not evaluated
        # the depsgraph since pivot.location was set, so inverting it would be a
        # no-op and parenting would shift the model by +center. The pivot is a
        # pure translation, so state its inverse directly instead of reading back
        # a transform that does not exist yet.
        obj.matrix_parent_inverse = Matrix.Translation(-center)

    # Render settings.
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

    # Key light.
    sun_data = bpy.data.lights.new("KEY", type="SUN")
    sun_data.energy = 4.0
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("KEY", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.pi / 2 - math.radians(55), 0.0, math.radians(135))

    # Fill light.
    fill_data = bpy.data.lights.new("FILL", type="SUN")
    fill_data.energy = 0.35
    fill_data.color = (0.66, 0.77, 0.82)
    fill_data.angle = math.radians(60)
    fill = bpy.data.objects.new("FILL", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(35), 0, math.radians(135) + math.pi)

    # Ortho camera.
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

    return pivot, hull_objs, turret_objs


def render_pass(pivot, show_objs, hide_objs, out_dir, label):
    """Render 16 facings with `show_objs` visible and `hide_objs` hidden."""
    for obj in hide_objs:
        obj.hide_render = True
        obj.hide_viewport = True
    for obj in show_objs:
        obj.hide_render = False
        obj.hide_viewport = False

    os.makedirs(out_dir, exist_ok=True)
    step = 2.0 * math.pi / FACINGS
    base_z = pivot.rotation_euler.z
    sc = bpy.context.scene

    manifest = {
        "unit": f"tiger_tank_{label}",
        "facings": FACINGS,
        "size": SIZE,
        "frames": 1,
        # The renderer reads its facing convention and draw scale from here
        # rather than having them hand-measured off the images in app code.
        # This loop advances rotation_euler.z the opposite way to world
        # bearing, and starts with facing 5 looking east.
        "facingOffset": FACING_OFFSET,
        "facingReverse": FACING_REVERSE,
        "scale": DRAW_SCALE,
        # A turret is a layer composited onto its hull, never a unit standing
        # on its own. The art gate reads this to skip the checks that only
        # make sense for a whole unit -- a turret legitimately fills little of
        # a frame sized for the whole tank, and comparing its outline against
        # other units' asks a question with no meaning.
        **({"layer": "turret"} if label == "turret" else {}),
        "files": [],
    }

    for f in range(FACINGS):
        pivot.rotation_euler.z = base_z + f * step
        bpy.context.view_layer.update()
        name = f"f{f:02d}_000.png"
        filepath = os.path.join(out_dir, name)
        sc.render.filepath = filepath
        bpy.ops.render.render(write_still=True)
        reencode_png(filepath)
        manifest["files"].append({"facing": f, "frame": 0, "file": name})
        print(f"[{label}] Rendered {name}")

    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"[{label}] DONE {FACINGS} facings -> {out_dir}")


if __name__ == "__main__":
    obj_path, hull_names, turret_names = bake_and_export()
    pivot, hull_objs, turret_objs = setup_clean_scene(obj_path, hull_names, turret_names)

    render_pass(pivot, hull_objs, turret_objs, OUT_HULL, "hull")
    render_pass(pivot, turret_objs, hull_objs, OUT_TURR, "turret")
