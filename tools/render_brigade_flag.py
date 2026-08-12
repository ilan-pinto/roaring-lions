"""Render the 401st Ari'im Brigade's lion banner -- the shell's completed-country overlay.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_brigade_flag.py

Writes assets/campaign/flag_brigade.png (300x200, transparent outside the banner)
and saves the scene to art/src/campaign/brigade_flag.blend.

Same idiom as the world map's country flags: a flat banner of palette-coloured
plates, pixel-art heraldry from axis-aligned rectangles, quantized after render.
A roaring gold lion on the brigade's dark red, in a limestone frame. The open
jaw is the field showing through -- the red maw is free.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dimetric import palette_linear  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PNG = os.path.join(ROOT, "assets", "campaign", "flag_brigade.png")
OUT_BLEND = os.path.join(ROOT, "art", "src", "campaign", "brigade_flag.blend")

#: Banner space: 30x20 units, rendered at 10 px/unit.
W, H = 30.0, 20.0
RES_X, RES_Y = 300, 200

#: (colour key, z, [rects]) bottom-up; rects are (x, y, w, h) with y DOWN, like
#: every other authoring space in this repo.
LAYERS = [
    ("terracotta.2", 0.0, [(0.0, 0.0, W, H)]),                          # field
    # Frame sides stop short of the corners: coplanar overlaps z-fight and render
    # as black corner notches.
    ("limestone.1", 0.2, [(0.0, 0.0, W, 1.2), (0.0, H - 1.2, W, 1.2),
                          (0.0, 1.2, 1.2, H - 2.4), (W - 1.2, 1.2, 1.2, H - 2.4)]),
    ("dust.2", 0.35, [                                                   # the mane, darker
        (7.0, 4.0, 9.5, 12.0),
        (16.5, 3.0, 2.5, 2.2),       # ear
        (5.5, 5.5, 1.5, 2.0),        # windward spikes
        (5.5, 9.0, 1.5, 2.0),
        (5.5, 12.5, 1.5, 2.0),
    ]),
    ("dust.0", 0.5, [                                                    # face, gold
        (16.0, 5.5, 7.0, 9.0),       # head
        (23.0, 6.5, 4.5, 3.0),       # muzzle, upper
        (22.5, 12.5, 4.0, 2.5),      # jaw, lower -- 3 units of open maw between
    ]),
    ("terracotta.1", 0.6, [(23.0, 10.8, 2.2, 1.4)]),                     # tongue
    ("shadow.1", 0.7, [(19.5, 7.5, 1.4, 1.4),                            # eye
                       (26.5, 6.9, 1.2, 1.2)]),                          # nose
]


def flat(name, colour_key):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = palette_linear(colour_key)
    bsdf.inputs["Roughness"].default_value = 0.6
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.2
    return mat


def build():
    for i, (key, z, rects) in enumerate(LAYERS):
        verts, faces = [], []
        for (x, y, w, h) in rects:
            # y flips: authoring is y-down, Blender is y-up.
            y0, y1 = H - (y + h), H - y
            b = len(verts)
            verts += [(x, y0, z), (x + w, y0, z), (x + w, y1, z), (x, y1, z)]
            faces.append((b, b + 1, b + 2, b + 3))
        mesh = bpy.data.meshes.new(f"layer_{i}")
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        mesh.materials.append(flat(f"m_{i}_{key}", key))
        ob = bpy.data.objects.new(f"layer_{i}", mesh)
        bpy.context.collection.objects.link(ob)


def rig():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.render.resolution_x = RES_X
    sc.render.resolution_y = RES_Y
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = W
    cam_data.clip_start = 1.0
    cam_data.clip_end = 500.0
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    cam.location = (W / 2.0, H / 2.0, 100.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.0
    sun_data.color = (0.95, 0.98, 1.0)
    sun_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    se, sa = math.radians(52.0), math.radians(145.0)
    sun.location = (90 * math.cos(se) * math.cos(sa), 90 * math.cos(se) * math.sin(sa), 90 * math.sin(se))
    sun.rotation_euler = (Vector((0, 0, 0)) - Vector(sun.location)).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = palette_linear("limestone.1")
    bg.inputs["Strength"].default_value = 0.34
    sc.world = world


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig()
    build()
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    bpy.context.scene.render.filepath = OUT_PNG
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    print(f"wrote {OUT_PNG}")


main()
