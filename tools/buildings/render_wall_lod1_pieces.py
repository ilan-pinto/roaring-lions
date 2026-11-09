"""Render the pieces of the wall-vs-wall_lod1 approval sheet (GH-974).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/render_wall_lod1_pieces.py -- <out dir>

Then `python3 -I tools/buildings/assemble_wall_lod1_sheet.py <out dir> <sheet.png>`.

Camera. The game's: orthographic, 30 degrees elevation (`tools/dimetric.py`
ELEVATION), a tile's diamond 64 px wide at zoom 1, so 64 / (3 * sqrt 2) =
15.085 px per metre per unit of zoom. Map x is Blender +x and map y is Blender
-y, which is what puts `isoX = (x - y) * 32` to the right. The OBJECT sits
still; only a placement's yaw (a quarter for a north-south tile) differs, as
`units/run-direction.ts` does it. Colour is FLAT role colour from
data/palette.json under Workbench studio light, the house style of the earlier
building sheets, not the in-game toon ramp. Silhouettes are pure black at the
same camera. No noise anywhere.
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

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.join(REPO, "art", "_sheet")
os.makedirs(OUT, exist_ok=True)
GLBS = {
    "full": os.path.join(REPO, "art", "meshes", "buildings", "wall.glb"),
    "lod1": os.path.join(REPO, "art", "meshes", "buildings", "wall_lod1.glb"),
}
PPU1 = 64.0 / (dimetric.UNITS_PER_TILE * math.sqrt(2.0))   # px per metre at zoom 1
AZ = math.radians(315.0)   # camera in the +x, -y quadrant: map +x right, map +y left-down
EL = dimetric.ELEVATION
COL = {"wall": "limestone.5", "roof": "limestone.3", "ground": "dust.3"}
TILE = dimetric.UNITS_PER_TILE

# Layouts in MAP tile coordinates (mx, my) and the yaw the renderer gives each:
# a tile with same-type neighbours only north and/or south turns a quarter,
# anything else (an east-west run, a corner, a T's stem top) keeps x.
LAYOUTS = {
    "run": [(0, 0, 0), (1, 0, 0), (2, 0, 0), (3, 0, 0)],
    # corner: the x side keeps x, the y side turns (its end tile touches the corner
    # tile, which has an east-west neighbour, so it also turns: only (2,0) keeps x)
    "corner": [(0, 0, 0), (1, 0, 0), (2, 0, 0), (2, 1, 1), (2, 2, 1)],
    "tee": [(0, 0, 0), (1, 0, 0), (2, 0, 0), (1, 1, 1), (1, 2, 1)],
    "tile": [(0, 0, 0)],
    "tile_ns": [(0, 0, 1)],
}


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
    sh.color_type = "MATERIAL"
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_shadows = False
    sh.show_specular_highlight = False
    sc.display.shading.light = "STUDIO"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.clip_start, cam.data.clip_end = 0.1, 400.0
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def mat(name, key):
    m = bpy.data.materials.new(name)
    m.diffuse_color = dimetric.palette_linear(key)
    return m


def import_models(sc):
    models = {}
    for name, path in GLBS.items():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        models[name] = {o["rl_role"]: o.data for o in new}
        for o in list(bpy.data.objects):
            if o not in before:
                bpy.data.objects.remove(o)
    return models


def view_basis():
    """(toward-camera, screen-right, screen-up) as world vectors."""
    d = Vector((math.cos(AZ) * math.cos(EL), math.sin(AZ) * math.cos(EL), math.sin(EL)))
    v = -d
    right = v.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(v).normalized()
    return d, right, up


def place(models, model, tiles, mats, ground):
    made = []
    for (mx, my, ny) in tiles:
        pos = Vector((mx * TILE, -my * TILE, 0.0))
        yaw = math.pi / 2.0 if ny else 0.0
        for role, me in models[model].items():
            ob = bpy.data.objects.new(f"{model}_{role}", me)
            me.materials.clear()
            me.materials.append(mats[role])
            ob.matrix_world = Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, "Z")
            bpy.context.scene.collection.objects.link(ob)
            made.append(ob)
        if ground:
            hx = TILE / 2.0
            verts = [(-hx, -hx, 0), (hx, -hx, 0), (hx, hx, 0), (-hx, hx, 0)]
            gm = bpy.data.meshes.new("g")
            gm.from_pydata(verts, [], [(0, 1, 2, 3)])
            gm.materials.append(mats["ground"])
            go = bpy.data.objects.new("g", gm)
            go.location = pos + Vector((0, 0, -0.02))
            bpy.context.scene.collection.objects.link(go)
            made.append(go)
    return made


def corners(tiles, zmax=1.45):
    pts = []
    for (mx, my, _) in tiles:
        for sx in (-1, 1):
            for sy in (-1, 1):
                for z in (0.0, zmax):
                    pts.append(Vector((mx * TILE + sx * TILE / 2, -my * TILE + sy * TILE / 2, z)))
    return pts


def render(sc, cam, models, model, layout, zoom, mag, path, sil, frame=None):
    tiles = LAYOUTS[layout]
    if sil:
        mats = {k: bpy.data.materials.new("b") for k in ("wall", "roof", "ground")}
        for m in mats.values():
            m.diffuse_color = (0.0, 0.0, 0.0, 1.0)
        sc.display.shading.light = "FLAT"
    else:
        mats = {k: mat(k, COL[k]) for k in COL}
        sc.display.shading.light = "STUDIO"
    made = place(models, model, tiles, mats, ground=not sil)
    d, right, up = view_basis()
    ppu = PPU1 * zoom * mag
    if frame is not None:   # a fixed square frame around the first tile's footprint centre
        w_px = h_px = frame
        c = Vector((tiles[0][0] * TILE, -tiles[0][1] * TILE, 0.7))
        cr, cu = c.dot(right), c.dot(up)
    else:
        pts = corners(tiles)
        rs = [p.dot(right) for p in pts]
        us = [p.dot(up) for p in pts]
        pad = 6.0 / ppu
        w = max(rs) - min(rs) + 2 * pad
        h = max(us) - min(us) + 2 * pad
        w_px, h_px = int(math.ceil(w * ppu)), int(math.ceil(h * ppu))
        cr, cu = (max(rs) + min(rs)) / 2.0, (max(us) + min(us)) / 2.0
    sc.render.resolution_x, sc.render.resolution_y = w_px, h_px
    sc.render.resolution_percentage = 100
    cam.data.ortho_scale = max(w_px, h_px) / ppu
    centre = right * cr + up * cu
    cam.location = centre + d * 100.0
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for ob in made:
        bpy.data.objects.remove(ob)
    return w_px, h_px


def main():
    sc, cam = setup_scene()
    models = import_models(sc)
    tri = {m: sum(len(p.vertices) - 2 for me in roles.values() for p in me.polygons) for m, roles in models.items()}
    json.dump(tri, open(os.path.join(OUT, "tris.json"), "w"))
    for model in ("full", "lod1"):
        for zoom in (1.0, 1.6, 2.5):
            for layout in ("run", "corner", "tee"):
                render(sc, cam, models, model, layout, zoom, 1.0, os.path.join(OUT, f"z{zoom}_{layout}_{model}.png"), False)
        # a 4x close-up at zoom 1's scale (about zoom 4)
        for layout in ("run", "corner", "tee"):
            render(sc, cam, models, model, layout, 1.0, 4.0, os.path.join(OUT, f"mag_{layout}_{model}.png"), False)
        # 64 px gameplay frames: one tile, colour and black, both facings
        for layout in ("tile", "tile_ns"):
            render(sc, cam, models, model, layout, 1.0, 1.0, os.path.join(OUT, f"f64_{layout}_{model}.png"), False, frame=64)
            render(sc, cam, models, model, layout, 1.0, 1.0, os.path.join(OUT, f"s64_{layout}_{model}.png"), True, frame=64)
        # silhouettes of whole runs at gameplay scale and at 4x, for the IoU table
        for zoom, mag, tag in ((1.0, 1.0, "z1"), (1.6, 1.0, "z1.6"), (1.0, 4.0, "mag")):
            for layout in ("run", "corner", "tee"):
                render(sc, cam, models, model, layout, zoom, mag, os.path.join(OUT, f"sil_{tag}_{layout}_{model}.png"), True)
    print("[pieces] done", tri)


main()
