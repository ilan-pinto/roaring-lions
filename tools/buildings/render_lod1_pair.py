"""Render the pieces of a full-vs-LOD1 approval sheet for the house or the ditch (GH-974).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/render_lod1_pair.py -- house|ditch <out dir>

Then `python3 -I tools/buildings/assemble_lod1_pair_sheet.py house|ditch <out dir> <sheet.png> [<iou.json>]`.

Camera: the game's, orthographic at 30 degrees elevation (`tools/dimetric.py` ELEVATION), a 3 m tile diamond 64 px wide
at zoom 1, so 64 / (3 * sqrt 2) = 15.085 px per metre per unit of zoom. Map x is Blender +x and map y is Blender -y.
The OBJECT sits still. Colour is the full mesh's OWN bake for BOTH models (the twin's UV0 samples it: this is what the
runtime will draw, since the twin takes the full template's material), under Workbench studio light, not the in-game
toon ramp. Silhouettes are pure black at the same camera, same frame, alpha >= 128. No noise anywhere.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "tools"))
import dimetric  # noqa: E402

KIND, OUT = sys.argv[sys.argv.index("--") + 1: sys.argv.index("--") + 3]
os.makedirs(OUT, exist_ok=True)
GLBS = {
    "house": {"full": "art/meshes/buildings/house.glb", "lod1": "art/meshes/buildings/house_lod1.glb"},
    "ditch": {"full": "art/meshes/decor/ditch_0.glb", "lod1": "art/meshes/decor/ditch_lod1.glb"},
}[KIND]
PPU1 = 64.0 / (dimetric.UNITS_PER_TILE * math.sqrt(2.0))
AZ = math.radians(315.0)
EL = dimetric.ELEVATION
TILE = dimetric.UNITS_PER_TILE
# placements: (x m, y m, yaw quarter turns). One object, or a run.
LAYOUTS = {
    "house": {"one": [(0, 0, 0)], "pair": [(0, 0, 0), (20, 0, 0)]},
    "ditch": {"seg": [(0, 0, 0)], "seg_ns": [(0, 0, 1)], "run": [(-3, 0, 0), (0, 0, 0), (3, 0, 0)],
              "bend": [(0, 0, 0), (3, 0, 0), (6, 0, 0), (7.5, -2.1, 1)]},
}[KIND]
FRAME_Z = {"house": 12.8, "ditch": 0.3}[KIND]
VIEWS = (("z1", 1.0, 1.0), ("z1.6", 1.6, 1.0), ("mag", 1.0, 4.0))


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.display.render_aa = "8"
    sh = sc.display.shading
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_shadows = False
    sh.show_specular_highlight = False
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.clip_start, cam.data.clip_end = 0.1, 600.0
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def import_models():
    models, tex = {}, None
    for name in ("full", "lod1"):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, GLBS[name]))
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        for o in new:
            o.parent = None
        if name == "full":
            tex = new[0].data.materials[0]
        models[name] = [(o.name, o.data) for o in new]
        for o in new:
            bpy.data.objects.remove(o)
    return models, tex


def view_basis():
    d = Vector((math.cos(AZ) * math.cos(EL), math.sin(AZ) * math.cos(EL), math.sin(EL)))
    v = -d
    right = v.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(v).normalized()
    return d, right, up


def place(models, model, tiles, mat):
    made = []
    for (mx, my, q) in tiles:
        for nm, me in models[model]:
            ob = bpy.data.objects.new(f"{model}_{nm}", me)
            me.materials.clear()
            me.materials.append(mat)
            ob.matrix_world = Matrix.Translation(Vector((mx, -my, 0.0))) @ Matrix.Rotation(q * math.pi / 2.0, 4, "Z")
            bpy.context.scene.collection.objects.link(ob)
            made.append(ob)
    return made


def frame_corners(tiles, ext):
    pts = []
    for (mx, my, q) in tiles:
        r = Matrix.Rotation(q * math.pi / 2.0, 3, "Z")
        for sx in (-1, 1):
            for sy in (-1, 1):
                for z in (0.0, FRAME_Z):
                    pts.append(Vector((mx, -my, 0)) + r @ Vector((sx * ext[0], sy * ext[1], z)))
    return pts


def render(sc, cam, models, model, layout, zoom, mag, path, sil, tex, ext, frame=None):
    tiles = LAYOUTS[layout]
    if sil:
        mat = bpy.data.materials.new("black")
        mat.diffuse_color = (0.0, 0.0, 0.0, 1.0)
        sc.display.shading.light = "FLAT"
        sc.display.shading.color_type = "MATERIAL"
    else:
        mat = tex
        sc.display.shading.light = "STUDIO"
        sc.display.shading.color_type = "TEXTURE"
    made = place(models, model, tiles, mat)
    d, right, up = view_basis()
    ppu = PPU1 * zoom * mag
    pts = frame_corners(tiles, ext)
    rs = [p.dot(right) for p in pts]
    us = [p.dot(up) for p in pts]
    if frame is not None:       # fit the whole subject into a square frame of `frame` px (the gate's 64 px)
        span = max(max(rs) - min(rs), max(us) - min(us))
        ppu = (frame - 4) / span
        w_px = h_px = frame
    else:
        pad = 6.0 / ppu
        w_px = int(math.ceil((max(rs) - min(rs) + 2 * pad) * ppu))
        h_px = int(math.ceil((max(us) - min(us) + 2 * pad) * ppu))
    cr, cu = (max(rs) + min(rs)) / 2.0, (max(us) + min(us)) / 2.0
    sc.render.resolution_x, sc.render.resolution_y = w_px, h_px
    sc.render.resolution_percentage = 100
    cam.data.ortho_scale = max(w_px, h_px) / ppu
    cam.location = right * cr + up * cu + d * 200.0
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for ob in made:
        bpy.data.objects.remove(ob)
    return w_px, h_px


def main():
    sc, cam = setup_scene()
    models, tex = import_models()
    tri = {m: sum(len(p.vertices) - 2 for _, me in models[m] for p in me.polygons) for m in models}
    xs = [v.co.x for _, me in models["full"] for v in me.vertices]
    ys = [v.co.y for _, me in models["full"] for v in me.vertices]
    ext = (max(abs(min(xs)), abs(max(xs))), max(abs(min(ys)), abs(max(ys))))
    json.dump(tri, open(os.path.join(OUT, "tris.json"), "w"))
    for model in ("full", "lod1"):
        for lay in LAYOUTS:
            for tag, zoom, mag in VIEWS:
                render(sc, cam, models, model, lay, zoom, mag, os.path.join(OUT, f"col_{tag}_{lay}_{model}.png"), False, tex, ext)
                render(sc, cam, models, model, lay, zoom, mag, os.path.join(OUT, f"sil_{tag}_{lay}_{model}.png"), True, tex, ext)
            # the gate's 64 px frame: the whole subject fitted, colour and black
            render(sc, cam, models, model, lay, 1.0, 1.0, os.path.join(OUT, f"col_f64_{lay}_{model}.png"), False, tex, ext, frame=64)
            render(sc, cam, models, model, lay, 1.0, 1.0, os.path.join(OUT, f"sil_f64_{lay}_{model}.png"), True, tex, ext, frame=64)
    print("[pieces] done", tri)


main()
