"""Fix round 1 follow-up: `compare.png` was framed too tight (zoom4 = ortho
scale divided by 4 against the SAME fit-the-tree bounds, so it cropped into
a quarter of the canopy, not "the whole tree at 4x detail"). This script
renders two corrected views per tree, in the game's own decor palette
(`decor-role.ts`: foliage = olive.0 `#8F9464`, trunk = dust.3 `#AC8248`),
not debug green/brown:

  (a) `_full.png`  -- the WHOLE tree, fully framed (never cropped), at 4x the
      pixel resolution of the original preview (2048 vs 512) -- "x4" is
      detail, not optical zoom-in.
  (b) `_gamezoom1.png` -- the whole tree on a sand-coloured ground plane
      (limestone.1 `#E6D8BE`), framed with ONE FIXED ortho scale shared by
      all four renders (not fit-per-tree), so relative size differences
      between before/after are visible rather than each image independently
      normalised to fill its own frame -- closer to "as it appears in play"
      at a single, constant zoom.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/terrain/preview_trees_full.py

Reads the same `art/meshes/decor/tree_{0,1}.glb` and
`.superpowers/ground2/trees-preview/_before/tree_{0,1}.glb` as
`preview_trees.py` (see that file's own docstring for exactly how `_before/`
was produced). Writes into the same `.superpowers/ground2/trees-preview/`.
"""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)

from dimetric import ELEVATION as DIM_ELEV  # noqa: E402
from render_rig import build_lights  # noqa: E402
from mathutils import Vector  # noqa: E402

REPO = os.path.dirname(TOOLS)
DECOR = os.path.join(REPO, "art", "meshes", "decor")
OUT = os.path.join(REPO, ".superpowers", "ground2", "trees-preview")
BEFORE_DIR = os.path.join(OUT, "_before")

SIZE_FULL = 2048   # "x4" pixel detail, whole tree, never cropped
SIZE_GAME = 512
MARGIN = 1.25       # a hair more headroom than preview_trees.py's 1.15, so
                    # nothing clips at the canopy's own outer leaf tips


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_rgba(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


# decor-role.ts's own runtime colours (olive.0, dust.3) -- NOT the earlier
# debug green/brown. Sand ground: limestone.1, the arid theme's own ground
# tone (`terrain-themes.ts`).
PALETTE_COLOUR = {
    "foliage": _linear_rgba("#8F9464"),
    "trunk": _linear_rgba("#AC8248"),
}
SAND_COLOUR = _linear_rgba("#E6D8BE")


def _material(name, rgba):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
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


def _point_camera(cam, center, ortho_scale):
    az = math.radians(225.0)
    dist = 50.0
    horiz = math.cos(DIM_ELEV) * dist
    cam.location = (
        center.x + horiz * math.cos(az),
        center.y + horiz * math.sin(az),
        center.z + math.sin(DIM_ELEV) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIM_ELEV, 0.0, az + math.pi / 2)
    cam.data.ortho_scale = ortho_scale


def _ground_plane(radius_m, z):
    bpy.ops.mesh.primitive_plane_add(size=radius_m * 2.0, location=(0.0, 0.0, z))
    ob = bpy.context.active_object
    ob.data.materials.clear()
    ob.data.materials.append(_material("sand_ground", SAND_COLOUR))
    return ob


def render_full(glb_path, label):
    """(a): whole tree, fully framed, 4x pixel detail, palette colours."""
    _wipe()
    objs = _import_glb(glb_path)
    if not objs:
        print(f"[{label}] SKIP: no mesh objects imported from {glb_path}")
        return
    for ob in objs:
        role = ob.get("rl_role")
        ob.data.materials.clear()
        ob.data.materials.append(_material(f"pal_{role}", PALETTE_COLOUR.get(role, (0.7, 0.7, 0.7, 1.0))))
    cam = _build_rig(SIZE_FULL)
    lo, hi = _world_bounds(objs)
    center = (lo + hi) * 0.5
    radius = max((hi - lo).length * 0.5, 1e-4)
    _point_camera(cam, center, radius * 2.0 * MARGIN)
    os.makedirs(OUT, exist_ok=True)
    out_path = os.path.join(OUT, f"{label}_full.png")
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"[{label}] wrote {out_path}")


def render_game_zoom1(glb_path, label, ortho_scale, ground_radius_m):
    """(b): whole tree on sand, ONE fixed ortho scale shared across every
    call -- so before/after and tree_0/tree_1 stay size-comparable, unlike a
    per-tree auto-fit which would normalise every tree to fill its own
    frame and hide a real size difference."""
    _wipe()
    objs = _import_glb(glb_path)
    if not objs:
        print(f"[{label}] SKIP: no mesh objects imported from {glb_path}")
        return
    for ob in objs:
        role = ob.get("rl_role")
        ob.data.materials.clear()
        ob.data.materials.append(_material(f"pal_{role}", PALETTE_COLOUR.get(role, (0.7, 0.7, 0.7, 1.0))))
    lo, hi = _world_bounds(objs)
    # Ground the tree at its own lowest vertex, same convention the export
    # pipeline itself uses (`_bake_scale_and_ground`), so "on sand" means the
    # trunk base actually touches the plane rather than floating or clipping
    # into it.
    _ground_plane(ground_radius_m, lo.z)
    cam = _build_rig(SIZE_GAME)
    center = Vector(((lo.x + hi.x) / 2.0, (lo.y + hi.y) / 2.0, lo.z))
    _point_camera(cam, center, ortho_scale)
    os.makedirs(OUT, exist_ok=True)
    out_path = os.path.join(OUT, f"{label}_gamezoom1.png")
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"[{label}] wrote {out_path}")


def main():
    pairs = [
        ("tree_0_before", os.path.join(BEFORE_DIR, "tree_0.glb")),
        ("tree_0_after", os.path.join(DECOR, "tree_0.glb")),
        ("tree_1_before", os.path.join(BEFORE_DIR, "tree_1.glb")),
        ("tree_1_after", os.path.join(DECOR, "tree_1.glb")),
    ]
    for label, path in pairs:
        if os.path.exists(path):
            render_full(path, label)

    # A FIXED ortho scale, derived once from the largest of the four (the
    # pre-task tree_0, biggest raw canopy) with headroom, shared by all four
    # game-zoom renders and by the ground plane's own radius.
    _wipe()
    ref_objs = _import_glb(os.path.join(BEFORE_DIR, "tree_0.glb"))
    lo, hi = _world_bounds(ref_objs)
    ref_radius = max((hi - lo).length * 0.5, 1e-4)
    shared_ortho_scale = ref_radius * 2.0 * MARGIN
    ground_radius_m = ref_radius * 1.6

    for label, path in pairs:
        if os.path.exists(path):
            render_game_zoom1(path, label, shared_ortho_scale, ground_radius_m)


if __name__ == "__main__":
    main()
