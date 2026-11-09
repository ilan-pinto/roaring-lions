"""The forward camp's close-up sheet for the lead (GH-277): front, gameplay
three-quarter and top of each of its three states, beside the authored camp
at the same scale, plus a 64 px strip (the size the silhouette gate measures)
and the pure-black silhouettes of the same frames.

Two halves in one file, chosen by the interpreter that runs it:

    # 1. under Blender: one PNG per cell
    /Applications/Blender.app/Contents/MacOS/Blender -b \
        -P tools/buildings/forward_camp_sheet.py -- --cells <dir>

    # 2. under python3 (Pillow): the cells composed into the two sheets
    python3 tools/buildings/forward_camp_sheet.py --compose <dir> \
        --out closeup.png --out64 closeup_64px.png

WHAT IT IS. Workbench shading with each `rl_role` flat-coloured from
`data/palette.json` by the same role table `render_mesh_gate.py` uses (wall =
olive.1, the type's proposed colour). It is NOT the game's toon LUT, which
indexes a ramp slice by surface normal, so on screen each surface takes
several steps of its ramp rather than one flat tone; it answers SHAPE and
rough colour balance, and it is the only honest way to put a 0-material GLB
beside the camp's own baked texture without a browser. The camp is drawn
through `building-fit.ts`'s `stretch` scale (0.8 uniform: its 7.5 m GLB onto
the 6 m plot), so both stand on the same 6 x 6 m plot at the same scale.

Orientation: the camera turns, the building does not -- the opposite of the
sprite rig, because the question is "what do the three views look like",
and each cell is photographed from the same fixed directions: front from -Y
(glTF +Z, the face the dimetric camera sees on its left), the gameplay
three-quarter from +X/-Y at 30 degrees (`tools/dimetric.py`'s elevation), top
straight down. Every full-size cell shares one orthographic scale, so the
camp and the forward camp are measured by the same ruler.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
MESHES = os.path.join(REPO, "art", "meshes", "buildings")

CELL = 520
SCALE_M = 10.0          # ortho window, metres, shared by every full-size cell
ELEVATION_DEG = 30.0    # tools/dimetric.py: asin(TILE_ASPECT = 0.5)
SIZE_64 = 64

# (row id, label, glb, fit scale or None)
ROWS = (
    ("fc_idle", "FORWARD CAMP  standing", "kdf_forward_camp.glb", None),
    ("fc_construction", "FORWARD CAMP  construction", "kdf_forward_camp_construction.glb", None),
    ("fc_wreck", "FORWARD CAMP  wreck", "kdf_forward_camp_wreck.glb", None),
    ("camp_idle", "CAMP (authored)  standing", "camp.glb", "camp"),
    ("camp_wreck", "CAMP (authored)  wreck", "camp_wreck.glb", "camp"),
)
VIEWS = (("front", 270.0, 0.0), ("game", 315.0, ELEVATION_DEG), ("top", 270.0, 90.0))

# rl_role -> palette key, as tools/render_mesh_gate.py BUILDING_ROLE_PALETTE
ROLE_KEY = {"wall": "olive.1", "roof": "dust.6", "trim": "terracotta.1", "dome": "limestone.1",
            "wood": "dust.4", "glass": "shadow.0", "metal": "gunmetal.2", "rust": "terracotta.2"}
GROUND_KEY = "limestone.4"
BACKGROUND = (0.62, 0.62, 0.60)


def _blender_main(argv):
    import bpy
    from mathutils import Vector

    out = argv[argv.index("--cells") + 1]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(REPO, "data", "palette.json")) as fh:
        ramps = json.load(fh)["ramps"]

    def colour(key):
        band, idx = key.split(".")
        h = ramps[band]["colors"][int(idx)].lstrip("#")
        lin = []
        for i in (0, 2, 4):
            c = int(h[i:i + 2], 16) / 255
            lin.append(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92)
        return (*lin, 1.0)

    def fit_scale(glb):
        """building-fit.ts `stretch` for a 6 x 6 m plot: (sx, sy, sz) in glTF axes."""
        with open(glb, "rb") as fh:
            d = fh.read()
        n = int.from_bytes(d[12:16], "little")
        js = json.loads(d[20:20 + n])
        lo = [1e9] * 3
        hi = [-1e9] * 3
        # the nodes' meshes' POSITION accessors, unioned
        for m in js["meshes"]:
            for p in m["primitives"]:
                acc = js["accessors"][p["attributes"]["POSITION"]]
                for i in range(3):
                    lo[i] = min(lo[i], acc["min"][i])
                    hi[i] = max(hi[i], acc["max"][i])
        w, h, dep = hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]
        ax, az = min(1.0, 6.0 / w), min(1.0, 6.0 / dep)
        low = min(ax, az)
        sy = max(low, min(1.0, 1.2 / h))
        cap = min(low, sy) * 2.0
        return min(ax, cap), sy, min(az, cap)

    def load(glb, fit):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb, import_scene_extras=True)
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        if fit == "camp":
            sx, sy, sz = fit_scale(glb)
            for o in meshes:
                o.scale = (sx, sz, sy)  # glTF (x, y, z) -> Blender (x, z, y)
                o.data.transform(o.matrix_basis)
                o.matrix_basis.identity()
        else:
            for o in meshes:
                mat = bpy.data.materials.new(o.name)
                mat.diffuse_color = colour(ROLE_KEY[o.get("rl_role") or o.name.split(".")[0]])
                o.data.materials.clear()
                o.data.materials.append(mat)
        return meshes

    def setup_scene(transparent):
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_WORKBENCH"
        sh = sc.display.shading
        sh.light = "STUDIO"
        sh.color_type = "TEXTURE"
        sh.show_shadows = True
        sh.shadow_intensity = 0.35
        sh.show_cavity = False
        sc.render.film_transparent = transparent
        sc.view_settings.view_transform = "Standard"
        sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
        sc.world = bpy.data.worlds.new("w")
        sc.world.color = BACKGROUND
        cd = bpy.data.cameras.new("c")
        cd.type = "ORTHO"
        cam = bpy.data.objects.new("c", cd)
        bpy.context.collection.objects.link(cam)
        sc.camera = cam
        return sc, cam

    def ground():
        verts = [(-3, -3, -0.01), (3, -3, -0.01), (3, 3, -0.01), (-3, 3, -0.01)]
        me = bpy.data.meshes.new("plot")
        me.from_pydata(verts, [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new("plot", me)
        bpy.context.collection.objects.link(ob)
        mat = bpy.data.materials.new("plot")
        mat.diffuse_color = colour(GROUND_KEY)
        me.materials.append(mat)
        return ob

    def point(cam, az, el, centre, d=40.0):
        a, e = math.radians(az), math.radians(el)
        cam.location = (centre.x + math.cos(e) * math.cos(a) * d, centre.y + math.cos(e) * math.sin(a) * d,
                        centre.z + math.sin(e) * d)
        cam.rotation_euler = (math.pi / 2 - e, 0.0, a + math.pi / 2)

    def world_bounds(objs):
        lo = Vector((1e9,) * 3)
        hi = Vector((-1e9,) * 3)
        for o in objs:
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                lo = Vector([min(lo[i], w[i]) for i in range(3)])
                hi = Vector([max(hi[i], w[i]) for i in range(3)])
        return lo, hi

    for rid, label, glb, fit in ROWS:
        path = os.path.join(MESHES, glb)
        meshes = load(path, fit)
        plot = ground()
        sc, cam = setup_scene(False)
        sc.render.resolution_x = sc.render.resolution_y = CELL
        cam.data.ortho_scale = SCALE_M
        centre = Vector((0.0, 0.0, 1.9))
        for view, az, el in VIEWS:
            point(cam, az, el, centre if view != "top" else Vector((0, 0, 0)))
            sc.render.filepath = os.path.join(out, f"{rid}_{view}.png")
            bpy.ops.render.render(write_still=True)
        # the 64 px frame: this building alone, transparent, framed to its own bounds like the gate's render
        bpy.data.objects.remove(plot, do_unlink=True)
        sc.render.film_transparent = True
        sc.render.image_settings.color_mode = "RGBA"
        sc.render.resolution_x = sc.render.resolution_y = SIZE_64 * 4
        lo, hi = world_bounds(meshes)
        c = (lo + hi) * 0.5
        radius = max((hi - lo).length * 0.5, 1e-4)
        cam.data.ortho_scale = radius * 2.0 * 1.15
        point(cam, 315.0, ELEVATION_DEG, c, d=radius * 6.0)
        sc.render.filepath = os.path.join(out, f"{rid}_g256.png")
        bpy.ops.render.render(write_still=True)
        print(f"SHEET_CELL: {rid}")


def _font(px):
    from PIL import ImageFont
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Avenir.ttc"):
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    return ImageFont.load_default()


def _compose(cells, out, out64):
    from PIL import Image, ImageDraw
    pad, head = 12, 64
    cols = [v[0] for v in VIEWS]
    titles = {"front": "front (from -Y, glTF +Z)", "game": "gameplay three-quarter (30 deg, +X/-Y)", "top": "top"}
    w = pad + len(cols) * (CELL + pad)
    row_h = CELL + 34 + pad
    sheet = Image.new("RGB", (w, head + len(ROWS) * row_h), (236, 236, 232))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 10), "kdf_forward_camp  -  GH-277 close-up sheet  |  Meshy-7 base (AI-generated), finished in Blender", fill=(20, 20, 20), font=_font(22))
    d.text((pad, 38), "same 10 m ortho window in every cell; the authored camp is drawn at its in-game 0.8 fit onto the same 6 x 6 m plot; "
           "flat palette-role colour, not the in-game toon ramp", fill=(70, 70, 70), font=_font(15))
    for r, (rid, label, glb, fit) in enumerate(ROWS):
        y0 = head + r * row_h
        d.text((pad, y0 + 6), label, fill=(20, 20, 20), font=_font(18))
        for c, view in enumerate(cols):
            im = Image.open(os.path.join(cells, f"{rid}_{view}.png")).convert("RGB")
            x = pad + c * (CELL + pad)
            sheet.paste(im, (x, y0 + 32))
            if r == 0:
                d.text((x + 6, y0 + 32 + CELL - 22), titles[view], fill=(40, 40, 40), font=_font(14))
    sheet.save(out)

    # 64 px strip: each building framed to its own bounds at 64 px (the silhouette gate's size and framing),
    # shown enlarged 4x nearest-neighbour, and as a pure-black silhouette (alpha > 127)
    big = 64 * 4
    w2 = pad + len(ROWS) * (big + pad)
    s2 = Image.new("RGB", (w2, 2 * (big + 34) + 90), (236, 236, 232))
    d2 = ImageDraw.Draw(s2)
    d2.text((pad, 10), "gameplay size: 64 px frame, each building framed to its own bounds (as the gate), shown 4x", fill=(20, 20, 20), font=_font(18))
    for c, (rid, label, glb, fit) in enumerate(ROWS):
        im = Image.open(os.path.join(cells, f"{rid}_g256.png")).convert("RGBA")
        small = im.resize((64, 64), Image.LANCZOS)
        a = small.getchannel("A").point(lambda v: 255 if v > 127 else 0)
        col = Image.new("RGBA", (64, 64), (236, 236, 232, 255))
        col.paste(small, (0, 0), a)
        blk = Image.new("RGBA", (64, 64), (236, 236, 232, 255))
        blk.paste(Image.new("RGBA", (64, 64), (0, 0, 0, 255)), (0, 0), a)
        x = pad + c * (big + pad)
        s2.paste(col.convert("RGB").resize((big, big), Image.NEAREST), (x, 44))
        s2.paste(blk.convert("RGB").resize((big, big), Image.NEAREST), (x, 44 + big + 34))
        d2.text((x, 44 + big + 4), label.title()[:30], fill=(40, 40, 40), font=_font(13))
        d2.text((x, 44 + 2 * big + 38), "silhouette (pure black)", fill=(40, 40, 40), font=_font(13))
    s2.save(out64)
    print(f"wrote {out} {sheet.size} and {out64} {s2.size}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--cells" in args and "--compose" not in args:
        _blender_main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else args)
    elif "--compose" in args:
        _compose(args[args.index("--compose") + 1], args[args.index("--out") + 1], args[args.index("--out64") + 1])
    else:
        raise SystemExit(__doc__)
