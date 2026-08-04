"""
Render infantry soldier sprites from the BlendSwap Human Male Soldier model.
Credit: contmike (CC-BY 3.0, BlendSwap #40767)

Renders 16 facings × 5 frames (1 idle + 4 walk cycle) = 80 PNGs.
Walk cycle is posed programmatically via the FK bone chain.
Output PNGs are re-encoded through Pillow to strip Blender metadata.
"""

import bpy
import math
import os
import json
import sys

BLEND = os.path.abspath("art/src/human_male_soldier.blend")
OUT = os.path.abspath("assets/sprites/INF")
SIZE = 256
FACINGS = 16
FRAMES = 5  # frame 0 = idle, frames 1-4 = walk cycle
# Sheet conventions, reported to the renderer through the manifest.
FACING_OFFSET = 5  # sprite index that looks along world +x
FACING_REVERSE = True  # this loop rotates opposite to world bearing
DRAW_SCALE = 1.0  # sprite width in tile widths
DIMETRIC_ELEVATION = math.atan(0.5)

KEEP_PARENTS = {"Man_rig", "Gun_armature"}
SKIP_MESHES = {"floor", "switch", "switch.panel", "Plane", "Plane.001", "Plane.002"}

# Walk cycle rotations (degrees) applied directly to deformation bones.
# The rig defaults to IK mode (FK influence=0), so we pose the deformation
# bones directly and mute all constraints for the walk frames.
WALK_POSES = [
    # Frame 1: right leg forward contact
    {"thigh.R": 25, "thigh.L": -15, "shin.R": -10, "shin.L": -30,
     "upper_arm.L": 20, "upper_arm.R": -15},
    # Frame 2: passing (both legs under body)
    {"thigh.R": 5, "thigh.L": 5, "shin.R": -20, "shin.L": -20,
     "upper_arm.L": 5, "upper_arm.R": 5},
    # Frame 3: left leg forward contact (mirror of 1)
    {"thigh.R": -15, "thigh.L": 25, "shin.R": -30, "shin.L": -10,
     "upper_arm.L": -15, "upper_arm.R": 20},
    # Frame 4: passing mirrored
    {"thigh.R": 5, "thigh.L": 5, "shin.R": -20, "shin.L": -20,
     "upper_arm.L": -5, "upper_arm.R": -5},
]


def reencode_png(path):
    """Re-encode a PNG through Pillow to strip Blender metadata chunks."""
    try:
        from PIL import Image
        img = Image.open(path)
        img.save(path, "PNG", optimize=True)
    except ImportError:
        sys.stderr.write("WARNING: Pillow not available, skipping re-encode\n")


def setup_scene_and_render(armature_obj):
    """Set up camera, lights, materials and render all facings × frames."""
    from mathutils import Vector, Euler

    # Gather all mesh objects parented under our kept parents.
    meshes = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if obj.name in SKIP_MESHES:
            continue
        parent_name = obj.parent.name if obj.parent else None
        if parent_name not in KEEP_PARENTS:
            continue
        meshes.append(obj)

    # Military olive-green material.
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
    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        eval_obj = obj.evaluated_get(depsgraph)
        eval_mesh = eval_obj.to_mesh()
        for v in eval_mesh.vertices:
            all_pts.append(eval_obj.matrix_world @ v.co)
        eval_obj.to_mesh_clear()

    if not all_pts:
        sys.stderr.write("ERROR: No vertices found\n")
        return

    xs = sorted(p.x for p in all_pts)
    ys = sorted(p.y for p in all_pts)
    zs = sorted(p.z for p in all_pts)
    mid = len(all_pts) // 2
    center = Vector((xs[mid], ys[mid], zs[mid]))
    dists = sorted((p - center).length for p in all_pts)
    radius = max(dists[int(len(dists) * 0.95)], 0.001)
    print(f"Bounds: center={center}, radius={radius:.1f} ({len(all_pts)} verts)")

    # Create a pivot empty for rotation (facings).
    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)

    # Parent the armature (and everything under it) to the pivot.
    armature_obj.parent = pivot
    armature_obj.matrix_parent_inverse = pivot.matrix_world.inverted()

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

    os.makedirs(OUT, exist_ok=True)
    step = 2.0 * math.pi / FACINGS
    base_z = pivot.rotation_euler.z

    manifest = {
        "unit": "infantry_soldier",
        "facings": FACINGS,
        "size": SIZE,
        "frames": FRAMES,
        # The renderer reads its facing convention and draw scale from here
        # rather than having them hand-measured off the images in app code.
        # This loop advances rotation_euler.z the opposite way to world
        # bearing, and starts with facing 5 looking east.
        "facingOffset": FACING_OFFSET,
        "facingReverse": FACING_REVERSE,
        "scale": DRAW_SCALE,
        "files": [],
    }

    for f in range(FACINGS):
        pivot.rotation_euler.z = base_z + f * step
        for n in range(FRAMES):
            # Pose the armature for this frame.
            if n == 0:
                reset_pose(armature_obj)
            else:
                apply_walk_pose(armature_obj, WALK_POSES[n - 1])

            bpy.context.view_layer.update()
            name = f"f{f:02d}_{n:03d}.png"
            filepath = os.path.join(OUT, name)
            sc.render.filepath = filepath
            bpy.ops.render.render(write_still=True)
            reencode_png(filepath)
            manifest["files"].append({"facing": f, "frame": n, "file": name})
            print(f"Rendered {name}")

    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"DONE {FACINGS * FRAMES} frames -> {OUT}")


def reset_pose(armature_obj):
    """Reset all pose bones to rest position and unmute constraints."""
    from mathutils import Quaternion
    for pb in armature_obj.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        for c in pb.constraints:
            c.mute = False


def apply_walk_pose(armature_obj, pose_dict):
    """Mute IK/FK copy-rotation constraints on target bones, then pose directly."""
    reset_pose(armature_obj)
    for bone_name, angle_deg in pose_dict.items():
        pb = armature_obj.pose.bones.get(bone_name)
        if pb is None:
            sys.stderr.write(f"WARNING: bone '{bone_name}' not found\n")
            continue
        for c in pb.constraints:
            c.mute = True
        pb.rotation_mode = "XYZ"
        pb.rotation_euler.x = math.radians(angle_deg)


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)

    # Find the Man_rig armature.
    armature_obj = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" and obj.name == "Man_rig":
            armature_obj = obj
            break

    if armature_obj is None:
        sys.stderr.write("ERROR: Man_rig armature not found\n")
        sys.exit(1)

    print(f"Found armature: {armature_obj.name} with {len(armature_obj.data.bones)} bones")

    # Switch armature to pose mode so we can manipulate bones.
    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.mode_set(mode="POSE")

    setup_scene_and_render(armature_obj)


if __name__ == "__main__":
    main()
