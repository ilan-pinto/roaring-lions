"""
Render infantry soldier sprites from the KolosStudios soldier FBX.

Credit: KolosStudios ("Soldier"). LICENCE UNVERIFIED — the source archive
shipped no licence or attribution file. CONTRIBUTING.md requires assets in
this repository to permit redistribution; confirm the terms and record them
here and in the manifest `credit` field before this is published.

Renders 16 facings x 5 clips:

    idle   1 frame   the model's authored Standing pose
    move   4 frames  leg swing layered over Standing, so the rifle stays up
    fire   1 frame   the model's authored Standing_Aim pose
    down   1 frame   deep crouch -- gone to ground under suppression
    wreck  1 frame   fallen, the persistent battlefield casualty

Output uses the clip layout the manifest parser expects:

    assets/sprites/INF/<clip>_f<facing>_<frame>.png

`down` is a crouch rather than full prone deliberately: from dimetric a prone
figure collapses into an unreadable blob, whereas the crouch keeps a
silhouette measuring IoU 0.59 against idle at gameplay zoom.

The rig carries no constraints — the FBX export baked its IK out — so pose
bones are set directly, with none of the constraint muting the previous
BlendSwap rig required.

Cycles output is not on-palette, so `pnpm validate:assets` will reject these
frames as rendered. Quantize before running the gate:

    python3 tools/quantize_sprites.py --sprites assets/sprites
"""

import bpy
import math
import os
import json
import sys
from mathutils import Vector, Quaternion, Matrix

FBX = os.path.abspath("art/src/soldier_kolos.fbx")
OUT = os.path.abspath("assets/sprites/INF")
SIZE = 256
FACINGS = 16
DIMETRIC_ELEVATION = math.atan(0.5)

# Sheet conventions, reported to the renderer through the manifest.
FACING_OFFSET = 5  # sprite index that looks along world +x
FACING_REVERSE = True  # this loop rotates opposite to world bearing
# Sprite width in tile widths. The art fills 0.73 of its frame, and the tank
# sheet puts a ~7m hull in 1.8 tiles (~3.9 m/tile), so a 1.8m soldier wants
# about 0.46 tiles drawn -- 0.46 / 0.73. The old 1.0 was tuned against a
# render whose framing was broken, which made the figure look right only
# because its head was cropped off.
DRAW_SCALE = 0.63

X = (1.0, 0.0, 0.0)
Z = (0.0, 0.0, 1.0)

# Walk cycle, layered on top of the authored Standing pose. Only the legs
# swing: a soldier on the move keeps the weapon shouldered rather than
# swinging both arms, and holding the rifle silhouette across the cycle is
# what keeps foot troops identifiable while they are moving.
WALK_POSES = [
    # Right leg forward contact
    {"upleg.R": (X, 26), "upleg.L": (X, -16), "leg.R": (X, -12), "leg.L": (X, -30)},
    # Passing
    {"upleg.R": (X, 6), "upleg.L": (X, 6), "leg.R": (X, -22), "leg.L": (X, -22)},
    # Left leg forward contact
    {"upleg.R": (X, -16), "upleg.L": (X, 26), "leg.R": (X, -30), "leg.L": (X, -12)},
    # Passing, mirrored
    {"upleg.R": (X, 6), "upleg.L": (X, 6), "leg.R": (X, -22), "leg.L": (X, -22)},
]

DOWN_POSE = {
    "upleg.R": (X, 62), "upleg.L": (X, 62),
    "leg.R": (X, -95), "leg.L": (X, -95),
    "spine": (X, 22), "chest": (X, 12), "head": (X, -14),
}

WRECK_POSE = {
    "hips": (X, -78),
    "upleg.R": (X, 34), "upleg.L": (X, 12),
    "leg.R": (X, -28), "leg.L": (X, -46),
    "spine": (X, 14), "arm.R": (Z, 32), "arm.L": (Z, -28),
}

# clip -> (which authored pose it builds on, one delta per frame)
CLIPS = {
    "idle": ("standing", [None]),
    "move": ("standing", WALK_POSES),
    "fire": ("aim", [None]),
    "down": ("standing", [DOWN_POSE]),
    "wreck": ("standing", [WRECK_POSE]),
}

# Playback metadata. `move` is paced by measured ground speed at runtime so
# its fps is advisory; `fire` runs on its own clock and its latch expires
# after frames / fps.
CLIP_FPS = {"idle": 0, "move": 10, "fire": 12, "down": 0, "wreck": 0}
CLIP_LOOP = {"move": True}


def reencode_png(path):
    """Re-encode a PNG through Pillow to strip Blender metadata chunks."""
    try:
        from PIL import Image
        img = Image.open(path)
        img.save(path, "PNG", optimize=True)
    except ImportError:
        sys.stderr.write("WARNING: Pillow not available, skipping re-encode\n")


def capture_pose(arm, action_suffix):
    """Read an authored action's frame-1 pose into a plain dict."""
    act = next(a for a in bpy.data.actions if a.name.endswith(action_suffix))
    arm.animation_data.action = act
    slots = getattr(act, "slots", None)
    if slots:
        arm.animation_data.action_slot = slots[0]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    return {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones}


def apply_pose(arm, base, deltas=None):
    """Restore a captured pose, then rotate named bones on top of it."""
    for pb in arm.pose.bones:
        q, loc = base[pb.name]
        pb.rotation_quaternion = q.copy()
        pb.location = loc.copy()
    for bone, (axis, deg) in (deltas or {}).items():
        pb = arm.pose.bones.get(bone)
        if pb is None:
            sys.stderr.write(f"WARNING: rig has no bone {bone!r}\n")
            continue
        pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion(axis, math.radians(deg))
    bpy.context.view_layer.update()


def build_material(meshes):
    """Flat olive, matching the rest of the roster."""
    mat = bpy.data.materials.new("SoldierOlive")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.28, 0.30, 0.20, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.05
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mat)


def setup_render():
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
    return sc


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # ignore_leaf_bones=False matters: with leaf bones stripped the importer
    # silently drops both authored actions and the poses come back empty.
    bpy.ops.import_scene.fbx(filepath=FBX, use_anim=True, ignore_leaf_bones=False)

    arm = bpy.data.objects["Armature"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    bases = {
        "standing": capture_pose(arm, "Standing"),
        "aim": capture_pose(arm, "Standing_Aim"),
    }
    arm.animation_data.action = None

    build_material(meshes)
    sc = setup_render()

    # Frame once, on the idle pose, so every clip shares identical framing —
    # a clip that reframes itself makes the unit jump when the clip changes.
    apply_pose(arm, bases["standing"])
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            pts.append(eo.matrix_world @ v.co)
        eo.to_mesh_clear()
    xs = sorted(p.x for p in pts)
    ys = sorted(p.y for p in pts)
    zs = sorted(p.z for p in pts)
    mid = len(pts) // 2
    center = Vector((xs[mid], ys[mid], zs[mid]))
    dists = sorted((p - center).length for p in pts)
    radius = max(dists[int(len(dists) * 0.95)], 0.001)
    print(f"Bounds: center={center}, radius={radius:.1f} ({len(pts)} verts)")

    pivot = bpy.data.objects.new("PIVOT", None)
    pivot.location = center
    bpy.context.collection.objects.link(pivot)
    arm.parent = pivot
    # pivot.matrix_world is still identity here -- Blender has not evaluated
    # the depsgraph since pivot.location was set, so inverting it would be a
    # no-op and parenting would shift the model by +center. The pivot is a
    # pure translation, so state its inverse directly instead of reading back
    # a transform that does not exist yet.
    arm.matrix_parent_inverse = Matrix.Translation(-center)

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
    cam_data.ortho_scale = radius * 2.0 * 1.15

    os.makedirs(OUT, exist_ok=True)
    step = 2.0 * math.pi / FACINGS
    base_z = pivot.rotation_euler.z

    manifest = {
        "unit": "infantry_soldier",
        "credit": "KolosStudios - Soldier. LICENCE UNVERIFIED, see tools/render_soldier.py",
        "facings": FACINGS,
        "size": SIZE,
        "facingOffset": FACING_OFFSET,
        "facingReverse": FACING_REVERSE,
        "scale": DRAW_SCALE,
        "clips": {
            name: {
                "frames": len(frames),
                "fps": CLIP_FPS[name],
                "loop": CLIP_LOOP.get(name, False),
            }
            for name, (_, frames) in CLIPS.items()
        },
        "files": [],
    }

    total = 0
    for f in range(FACINGS):
        pivot.rotation_euler.z = base_z + f * step
        for clip, (base_key, frames) in CLIPS.items():
            for n, delta in enumerate(frames):
                apply_pose(arm, bases[base_key], delta)
                name = f"{clip}_f{f:02d}_{n:03d}.png"
                filepath = os.path.join(OUT, name)
                sc.render.filepath = filepath
                bpy.ops.render.render(write_still=True)
                reencode_png(filepath)
                manifest["files"].append({"clip": clip, "facing": f, "frame": n, "file": name})
                total += 1
                print(f"Rendered {name}")

    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print(f"DONE {total} frames -> {OUT}")


main()
