#!/usr/bin/env python3
"""
Roaring Lions -- locked sprite render rig.

Contributors submit a .blend containing a single object (or collection) named
"UNIT". This script builds the rig from scratch in code -- camera, sun, fill,
world -- so that no part of the lighting setup can drift between contributions.
That is the whole point: consistency is mechanical, not a matter of talent.

Usage (headless):
    blender -b -P tools/render_rig.py -- \
        --input art/src/mbt_lavi.blend \
        --out  assets/sprites/mbt_lavi \
        --facings 16 \
        --size 256

Key invariants -- do not "improve" these without a palette/CI version bump:

  * ORTHOGRAPHIC camera at elevation atan(0.5) = 26.565 deg. This is the exact
    angle that produces true 2:1 dimetric projection. 30 deg is the common
    eyeballed value and it is wrong -- it yields a 1.73:1 tile and your art
    will not seat correctly on the tile grid.

  * The OBJECT rotates, the camera and sun DO NOT. This is what keeps cast
    shadows pointing the same screen-space direction across all 16 facings.
    Rotating the camera instead is the single most common mistake in sprite
    pipelines and it makes a roster look subtly broken in a way that is hard
    to diagnose.

  * Sun angle is locked at 135 deg azimuth / 55 deg altitude -- high, hard,
    near-noon light. Long enough shadows to read volume, short enough not to
    collide with neighbouring units on the grid.
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

# --- locked rig constants -------------------------------------------------

# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# The sun and fill used to be declared here, and copied into render_vehicle.py,
# render_tank.py and render_soldier.py. All four agreed, which is exactly how
# DIMETRIC_ELEVATION looked before it turned out to be wrong in six files.
from dimetric import (  # noqa: E402
    ELEVATION as DIMETRIC_ELEVATION,
    build_lights,
)

WORLD_COLOR        = (0.0, 0.0, 0.0, 0.0)
SAMPLES            = 128
MARGIN             = 1.12                # framing padding around bounds


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="source .blend")
    p.add_argument("--out", required=True, help="output directory")
    p.add_argument("--facings", type=int, default=16)
    p.add_argument("--size", type=int, default=256, help="px per frame")
    p.add_argument("--object", default="UNIT")
    p.add_argument("--anim", default="", help="optional action name to bake")
    p.add_argument("--frames", type=int, default=0, help="frames of anim")
    return p.parse_args(argv)


def wipe_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link_source(path, obj_name):
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects]
    root = None
    for obj in dst.objects:
        if obj is None:
            continue
        bpy.context.collection.objects.link(obj)
        if obj.name == obj_name or obj.name.startswith(obj_name):
            root = obj
    if root is None:
        meshes = [o for o in bpy.context.collection.objects if o.type == "MESH"]
        if not meshes:
            sys.exit(f"ERROR: no mesh found in {path}")
        root = meshes[0]
        print(f"WARN: no object named '{obj_name}', falling back to {root.name}")
    return root


def world_bounds():
    """Axis-aligned bounds of every mesh in the scene."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def build_rig(size):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # No filmic curve. Quantization to a 32-colour palette needs a linear,
    # predictable response or the ramps smear across bands.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("rig_world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = WORLD_COLOR
    bg.inputs[1].default_value = 0.0
    scene.world = world

    build_lights(bpy.context.collection)

    cam_data = bpy.data.cameras.new("CAM")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("CAM", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    return cam


def frame_camera(cam, lo, hi):
    """Place the ortho camera on the locked dimetric vector and fit bounds."""
    center = (lo + hi) * 0.5
    radius = max((hi - lo).length * 0.5, 1e-4)

    # Camera sits south-west, looking up-right along the dimetric axis.
    az = math.radians(225.0)
    dist = radius * 6.0
    horiz = math.cos(DIMETRIC_ELEVATION) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIMETRIC_ELEVATION) * dist,
    )
    cam.rotation_euler = (
        math.pi / 2 - DIMETRIC_ELEVATION,
        0.0,
        az + math.pi / 2,
    )
    cam.data.ortho_scale = radius * 2.0 * MARGIN
    return center


def render_facings(root, cam, args, center):
    os.makedirs(args.out, exist_ok=True)
    step = 2.0 * math.pi / args.facings
    base_z = root.rotation_euler.z
    manifest = {
        "unit": os.path.splitext(os.path.basename(args.input))[0],
        "facings": args.facings,
        "size": args.size,
        "frames": max(args.frames, 1),
        "elevation_deg": round(math.degrees(DIMETRIC_ELEVATION), 3),
        "projection": "2:1 dimetric",
        "files": [],
    }

    frame_count = max(args.frames, 1)
    for f in range(args.facings):
        root.rotation_euler.z = base_z + f * step
        for n in range(frame_count):
            if args.frames:
                bpy.context.scene.frame_set(
                    bpy.context.scene.frame_start + n
                )
            name = f"f{f:02d}_{n:03d}.png"
            bpy.context.scene.render.filepath = os.path.join(args.out, name)
            bpy.ops.render.render(write_still=True)
            manifest["files"].append({"facing": f, "frame": n, "file": name})

    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"OK: {len(manifest['files'])} frames -> {args.out}")


def main():
    args = parse_args()
    wipe_scene()
    root = link_source(args.input, args.object)
    cam = build_rig(args.size)
    lo, hi = world_bounds()
    center = frame_camera(cam, lo, hi)
    if args.anim:
        act = bpy.data.actions.get(args.anim)
        if act and root.animation_data:
            root.animation_data.action = act
    render_facings(root, cam, args, center)


if __name__ == "__main__":
    main()
