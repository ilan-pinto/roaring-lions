"""Orthographic previews for Task 6 (D8): the three desert crowns and the
olive LOD, before and after, at the dimetric angle.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/terrain/preview_trees.py

Writes PNGs to `.superpowers/ground2/trees-preview/`. Not shipped, not a
.blend save -- purely for the lead's review of Task 6's numbers. GLBs carry
zero materials (the mesh unit contract), so this assigns plain debug colours
(green foliage, brown trunk) for legibility only; nothing here is the actual
runtime colour path (that is `decor-role.ts`'s ramp-by-normal, not touched).
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)

from dimetric import ELEVATION as DIM_ELEV  # noqa: E402
from render_rig import build_lights  # noqa: E402
import math
from mathutils import Vector  # noqa: E402

REPO = os.path.dirname(TOOLS)
DECOR = os.path.join(REPO, "art", "meshes", "decor")
OUT = os.path.join(REPO, ".superpowers", "ground2", "trees-preview")

# "Before" copies -- committed HEAD versions of tree_0/1/2, exported once to a
# scratch path by the calling shell before this script runs (see task report
# for the exact commands). desert_tree has no "before": it did not exist.
BEFORE_DIR = os.path.join(REPO, ".superpowers", "ground2", "trees-preview", "_before")

DEBUG_COLOUR = {
    "foliage": (0.20, 0.55, 0.15, 1.0),
    "trunk": (0.35, 0.22, 0.10, 1.0),
    "rock": (0.55, 0.55, 0.52, 1.0),
    "sand": (0.80, 0.72, 0.55, 1.0),
}

SIZE = 512
MARGIN = 1.15


def _debug_material(role):
    name = f"debug_{role}"
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = DEBUG_COLOUR.get(role, (0.7, 0.7, 0.7, 1.0))
        bsdf.inputs["Roughness"].default_value = 0.85
    return mat


def _wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.selected_objects if o.type == "MESH"]


def _world_bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for corner in ob.bound_box:
            p = ob.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def _build_rig(size):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.0, 0.0, 0.0, 0.0)
    bg.inputs[1].default_value = 0.0
    scene.world = world

    build_lights(bpy.context.collection)

    cam_data = bpy.data.cameras.new("CAM")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("CAM", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    return cam


def _frame(cam, lo, hi, zoom=1.0):
    center = (lo + hi) * 0.5
    radius = max((hi - lo).length * 0.5, 1e-4)
    az = math.radians(225.0)
    dist = radius * 6.0
    horiz = math.cos(DIM_ELEV) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIM_ELEV) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIM_ELEV, 0.0, az + math.pi / 2)
    cam.data.ortho_scale = (radius * 2.0 * MARGIN) / zoom


def render_one(glb_path, label):
    _wipe()
    objs = _import_glb(glb_path)
    if not objs:
        print(f"[{label}] SKIP: no mesh objects imported from {glb_path}")
        return
    for ob in objs:
        role = ob.get("rl_role") or ob.name
        ob.data.materials.clear()
        ob.data.materials.append(_debug_material(role))
    cam = _build_rig(SIZE)
    lo, hi = _world_bounds(objs)
    os.makedirs(OUT, exist_ok=True)
    for zoom, suffix in ((1.0, "zoom1"), (4.0, "zoom4")):
        _frame(cam, lo, hi, zoom=zoom)
        out_path = os.path.join(OUT, f"{label}_{suffix}.png")
        bpy.context.scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        print(f"[{label}] wrote {out_path}")


def main():
    for v in (0, 1, 2):
        render_one(os.path.join(DECOR, f"desert_tree_{v}.glb"), f"desert_tree_{v}_after")
    render_one(os.path.join(DECOR, "tree_0.glb"), "tree_0_after")
    if os.path.isdir(BEFORE_DIR):
        for v in (0, 1):
            p = os.path.join(BEFORE_DIR, f"tree_{v}.glb")
            if os.path.exists(p):
                render_one(p, f"tree_{v}_before")


if __name__ == "__main__":
    main()
