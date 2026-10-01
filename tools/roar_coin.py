"""Build and render the Roar coin (GH-317), emblem B "Hex Seal".

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/roar_coin.py

(or any Blender on PATH / in BLENDER_BIN).

A pointy-top hex coin, 40 mm across flats and 4 mm thick, with a 0.6 mm raised
rim, bearing a lion's head in profile, roaring left. The relief (mane, head,
mouth, teeth, eye) is extruded and bevelled from the emblem B paths in
docs/superpowers/specs/2026-10-01-roar-coin-shop-mock.html, which live in a
48 px space; one SVG unit is 40/39 mm so the hex is exactly 40 mm across flats.

Colour is palette keys only (data/palette.json via dimetric.palette_linear):

    face terracotta.0 | mane terracotta.1 | rim terracotta.2
    head + glint limestone.1 | mouth + eye shadow.1

Standard view transform, transparent film, BINARY alpha (every pixel is in or
out). The sun is fixed; the object rotates. No noise is used, so there is no
mathutils.noise (nondeterministic in Blender 5.2) anywhere in here.

Writes assets/ui/roar_coin/:
    roar_coin_{16,24,48,96,512}.png        the shipped strike at each size
    roar_coin_{16,24}_flat.png             the flat cut, the losing candidate
    roar_coin_spin.png                     24 frames, 0.6 s, 6x4 contact sheet
    roar_coin_{16,24,48}.svg               the flat cut, generated from the same
                                           polygons and the same palette
and saves the scene to art/src/ui/roar_coin.blend.
"""
import math
import os
import re
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dimetric import palette_linear  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "ui", "roar_coin")
OUT_BLEND = os.path.join(ROOT, "art", "src", "ui", "roar_coin.blend")

# --- the approved numbers ----------------------------------------------------
FLATS_MM = 40.0
THICK_MM = 4.0
RIM_MM = 0.6                       # how far the rim stands proud of the face
RIM_WIDTH_MM = 2.0                 # radial width of the rim band
MM = FLATS_MM / 39.0               # mm per SVG unit (hex flats span 4.5..43.5)
Z_TOP = THICK_MM / 2.0             # rim top
Z_FACE = Z_TOP - RIM_MM            # face plane
MANE_TOP = Z_TOP - 0.1             # relief stays inside the rim's height
HEAD_TOP = Z_TOP
INLAY = 0.03                       # mouth/eye sit this far over the head
BEVEL_MM = 0.18

KEYS = {"face": "terracotta.0", "mane": "terracotta.1", "rim": "terracotta.2",
        "head": "limestone.1", "ink": "shadow.1"}

# --- emblem B, 48 px master, copied from the mock (hex48) --------------------
HEX_OUTER = "24,1.5 43.5,12.75 43.5,35.25 24,46.5 4.5,35.25 4.5,12.75"
MANE_D = ("M27 10 L31 12.5 L35 11.5 L34.5 15.5 L38 18 L35 21 L38 24.5 L34.5 27 "
          "L36 31 L31.5 31 L29.5 35 L26.5 32 L22.5 34 L23 29 Z")
HEAD_D = ("M28 13 L21 13.5 L14.5 16.5 L11 20.5 L17 21.8 L12.5 27.5 L19.5 27 "
          "L15.5 31 L22.5 31.5 L28.5 28.5 L31 21 Z")
MOUTH_D = "M11 20.5 L22 24 L12.5 27.5 Z"
TEETH_D = "M13.3 21.3 L14.3 23 L15.2 21.7 Z M14.6 26.3 L15.5 24.8 L16.4 26 Z"
EYE = (21.5, 17.2, 1.1)            # cx, cy, r

# --- the flat cuts: the mock's hex24 and hex16, own viewBoxes ----------------
FLAT_24 = {
    "view": 24,
    "layers": [
        ("rim", "12,1 22,6.75 22,17.25 12,23 2,17.25 2,6.75"),
        ("face", "12,2.8 20.4,7.7 20.4,16.3 12,21.2 3.6,16.3 3.6,7.7"),
        ("mane", "M13.5 5 L16 6 L17.5 8 L19 10 L17.5 11.5 L19 13.5 L17 15 L15.5 17.5 "
                 "L13 16.5 L11.5 17.5 L11.5 14 Z"),
        ("head", "M14 6.5 L10.5 6.8 L7 8.5 L5.5 10.5 L8.5 11 L6.5 14 L10 13.6 L8 15.5 "
                 "L11.5 15.8 L14.5 14 L15.5 10.5 Z"),
        ("ink", "M5.5 10.5 L11 12 L6.5 14 Z"),
        ("ink", "M10.2 8.2 L11.4 8.2 L11.4 9.4 L10.2 9.4 Z"),
    ],
}
FLAT_16 = {
    "view": 16,
    "layers": [
        ("rim", "8,0.5 15,4.5 15,11.5 8,15.5 1,11.5 1,4.5"),
        ("face", "M10 3 L12.5 4.5 L13 7 L12 8.5 L13 10.5 L11 12 L9 12.5 L6.5 11.5 L4 11.5 "
                 "L5.5 9.5 L3.5 9.5 L3 7.5 L5 5.5 L7.5 4 Z"),
        ("rim", "M3 7.5 L7.5 8.5 L3.5 9.5 Z"),
    ],
}
# 16 px in the mock is hex in --roar-deep, silhouette in --roar, mouth cut in
# --roar-deep: the "face" key is the silhouette there and "rim" the hex and cut.

SIZES = (16, 24, 48, 96, 512)
SUPER = {16: 8, 24: 8, 48: 6, 96: 4, 512: 2}
FRAMES = 24
SPIN_TILE = 128


# --- geometry parsing --------------------------------------------------------
def parse_polys(d):
    """Polygons from a path or a points string. M/L/Z only; that is all the
    emblem uses, and anything else raises rather than silently dropping."""
    if not re.search(r"[A-Za-z]", d):
        nums = [float(n) for n in re.findall(r"-?\d*\.?\d+", d)]
        return [list(zip(nums[0::2], nums[1::2]))]
    polys, cur = [], []
    for cmd, args in re.findall(r"([A-Za-z])([^A-Za-z]*)", d):
        if cmd in "ML":
            n = [float(v) for v in re.findall(r"-?\d*\.?\d+", args)]
            if cmd == "M" and cur:
                polys.append(cur)
                cur = []
            cur.append((n[0], n[1]))
        elif cmd in "Zz":
            polys.append(cur)
            cur = []
        else:
            raise ValueError(f"unsupported path command {cmd}")
    if cur:
        polys.append(cur)
    return polys


def to_mm(pt):
    """SVG 48-space (y down) to coin millimetres (y up, centred)."""
    return ((pt[0] - 24.0) * MM, -(pt[1] - 24.0) * MM)


# --- Blender build -----------------------------------------------------------
def material(name, key):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = palette_linear(key)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.55
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    return mat


def prism(name, polys_mm, z0, z1, key, bevel=0.0, parent=None):
    """Extrude one or more simple polygons from z0 to z1 into one object."""
    bm = bmesh.new()
    for poly in polys_mm:
        verts = [bm.verts.new((x, y, z0)) for x, y in poly]
        face = bm.faces.new(verts)
        if face.normal.z < 0:
            face.normal_flip()
    bm.normal_update()
    ret = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    moved = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material(f"m_{name}_{key}", key))
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    if bevel > 0.0:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return ob


def ring(name, outer, inner, z0, z1, key, parent):
    """A hollow prism between two same-count polygons (the rim band)."""
    n = len(outer)
    verts, faces = [], []
    for z in (z0, z1):
        verts += [(x, y, z) for x, y in outer] + [(x, y, z) for x, y in inner]
    o0, i0, o1, i1 = 0, n, 2 * n, 3 * n
    for k in range(n):
        j = (k + 1) % n
        faces.append((o1 + k, o1 + j, i1 + j, i1 + k))      # top band
        faces.append((o0 + j, o0 + k, i0 + k, i0 + j))      # bottom band
        faces.append((o0 + k, o0 + j, o1 + j, o1 + k))      # outer wall
        faces.append((i0 + j, i0 + k, i1 + k, i1 + j))      # inner wall
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material(f"m_{name}_{key}", key))
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = BEVEL_MM
    mod.segments = 2
    mod.limit_method = "ANGLE"
    return ob


def hex_mm(flats_mm):
    """Pointy-top regular hexagon, given the distance across flats."""
    r = flats_mm / 2.0 / math.cos(math.radians(30))
    return [(r * math.cos(math.radians(90 + 60 * k)), r * math.sin(math.radians(90 + 60 * k)))
            for k in range(6)]


def build():
    pivot = bpy.data.objects.new("coin", None)
    bpy.context.collection.objects.link(pivot)

    outer = hex_mm(FLATS_MM)
    inner = hex_mm(FLATS_MM - 2 * RIM_WIDTH_MM)
    ring("rim", outer, inner, -Z_TOP, Z_TOP, KEYS["rim"], pivot)
    prism("face", [inner], -Z_TOP, Z_FACE, KEYS["face"], parent=pivot)

    def poly_mm(d):
        return [[to_mm(p) for p in poly] for poly in parse_polys(d)]

    prism("mane", poly_mm(MANE_D), Z_FACE, MANE_TOP, KEYS["mane"], BEVEL_MM, pivot)
    prism("head", poly_mm(HEAD_D), Z_FACE, HEAD_TOP, KEYS["head"], BEVEL_MM, pivot)
    prism("mouth", poly_mm(MOUTH_D), HEAD_TOP, HEAD_TOP + INLAY, KEYS["ink"], 0.0, pivot)
    prism("teeth", poly_mm(TEETH_D), HEAD_TOP, HEAD_TOP + INLAY * 2, KEYS["head"], 0.0, pivot)
    cx, cy, r = EYE
    eye = [to_mm((cx + r * math.cos(math.tau * k / 10), cy + r * math.sin(math.tau * k / 10)))
           for k in range(10)]
    prism("eye", [eye], HEAD_TOP, HEAD_TOP + INLAY, KEYS["ink"], 0.0, pivot)
    return pivot


def rig():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 48.0 * MM          # the SVG's own 48 px frame
    cam_data.clip_start = 1.0
    cam_data.clip_end = 500.0
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    cam.location = (0.0, 0.0, 100.0)

    # Fixed sun, from the camera's upper left (the sun's side in the spec).
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.4
    sun_data.angle = math.radians(3.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    el, az = math.radians(48.0), math.radians(135.0)
    sun.location = (90 * math.cos(el) * math.cos(az), 90 * math.cos(el) * math.sin(az),
                    90 * math.sin(el))
    sun.rotation_euler = (Vector((0, 0, 0)) - Vector(sun.location)).to_track_quat(
        "-Z", "Y").to_euler()

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = palette_linear("limestone.1")
    bg.inputs["Strength"].default_value = 0.45
    sc.world = world


# --- image helpers -----------------------------------------------------------
def render_rgba(res, tmp):
    """Render at res x res; straight RGBA float array, row 0 at the TOP."""
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    return load_rgba(tmp)


def load_rgba(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    img.alpha_mode = "CHANNEL_PACKED"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1].copy()


def save_rgba(path, arr):
    h, w, _ = arr.shape
    img = bpy.data.images.new("out", w, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.alpha_mode = "CHANNEL_PACKED"
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def binary_downsample(arr, f):
    """Box-filter colour, binary alpha: a pixel is in if at least half of its
    f x f samples are, and its colour is the mean of the samples that are."""
    h, w, _ = arr.shape
    a = (arr[..., 3] >= 0.5).astype(np.float32)
    rgb = arr[..., :3] * a[..., None]
    a_s = a.reshape(h // f, f, w // f, f).sum(axis=(1, 3))
    rgb_s = rgb.reshape(h // f, f, w // f, f, 3).sum(axis=(1, 3))
    out = np.zeros((h // f, w // f, 4), dtype=np.float32)
    inside = a_s >= (f * f) / 2.0
    out[..., :3] = np.where(inside[..., None], rgb_s / np.maximum(a_s, 1)[..., None], 0.0)
    out[..., 3] = inside.astype(np.float32)
    return out


def render_coin(res, tmp):
    f = SUPER.get(res, 4)
    return binary_downsample(render_rgba(res * f, tmp), f)


# --- the flat cut ------------------------------------------------------------
def palette_hex(key):
    import json
    with open(os.path.join(ROOT, "data", "palette.json")) as fh:
        pal = json.load(fh)
    band, name = key.split(".", 1)
    return pal["ramps"][band]["colors"][int(name)]


def srgb_u8(key):
    hx = palette_hex(key)
    return [int(hx[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]


def point_in_polys(px, py, polys):
    """Even-odd fill over all of a layer's subpaths, vectorised."""
    inside = np.zeros(px.shape, dtype=bool)
    for poly in polys:
        n = len(poly)
        for k in range(n):
            x0, y0 = poly[k]
            x1, y1 = poly[(k + 1) % n]
            if y0 == y1:
                continue
            cond = ((y0 > py) != (y1 > py))
            xi = x0 + (py - y0) * (x1 - x0) / (y1 - y0)
            inside ^= cond & (px < xi)
    return inside


def flat_cut(spec, res, f=16):
    view = spec["view"]
    n = res * f
    c = (np.arange(n) + 0.5) * view / n
    px, py = np.meshgrid(c, c)
    out = np.zeros((n, n, 4), dtype=np.float32)
    for key, d in spec["layers"]:
        m = point_in_polys(px, py, parse_polys(d))
        out[m, :3] = srgb_u8(KEYS[key])
        out[m, 3] = 1.0
    return binary_downsample(out, f)


def write_svg(path, spec):
    view = spec["view"]
    rows = []
    for key, d in spec["layers"]:
        d = d if re.search(r"[A-Za-z]", d) else "M" + d.replace(" ", " L") + " Z"
        rows.append(f'  <path d="{d}" fill="{palette_hex(KEYS[key])}" fill-rule="evenodd"/>')
    with open(path, "w") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{view}" height="{view}" '
                 f'viewBox="0 0 {view} {view}">\n' + "\n".join(rows) + "\n</svg>\n")


def write_svg48(path):
    outer = HEX_OUTER
    spec = {"view": 48, "layers": [
        ("rim", outer),
        ("face", "24,4.5 41,14.3 41,33.7 24,43.5 7,33.7 7,14.3"),
        ("mane", MANE_D), ("head", HEAD_D), ("ink", MOUTH_D),
        ("head", TEETH_D),
        ("ink", " ".join(f"{EYE[0] + EYE[2] * math.cos(math.tau * k / 10):.2f},"
                         f"{EYE[1] + EYE[2] * math.sin(math.tau * k / 10):.2f}"
                         for k in range(10))),
    ]}
    write_svg(path, spec)


# --- main --------------------------------------------------------------------
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig()
    pivot = build()
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    tmp = os.path.join(OUT_DIR, "_tmp.png")

    pivot.rotation_euler = (0.0, 0.0, 0.0)
    for res in SIZES:
        save_rgba(os.path.join(OUT_DIR, f"roar_coin_{res}.png"), render_coin(res, tmp))
        print("relief", res)
    # The flat cut of the SVG, kept beside the relief render at 16 and 24 px. The
    # relief render ships as roar_coin_{16,24}.png: it won on contrast (the
    # limestone head against terracotta); the flat 16 is tone-on-tone.
    for res, spec in ((16, FLAT_16), (24, FLAT_24)):
        save_rgba(os.path.join(OUT_DIR, f"roar_coin_{res}_flat.png"), flat_cut(spec, res))
    write_svg(os.path.join(OUT_DIR, "roar_coin_16.svg"), FLAT_16)
    write_svg(os.path.join(OUT_DIR, "roar_coin_24.svg"), FLAT_24)
    write_svg48(os.path.join(OUT_DIR, "roar_coin_48.svg"))

    # 24-frame spin about the vertical screen axis: 0.6 s, so 40 fps.
    cols, rows = 6, 4
    sheet = np.zeros((rows * SPIN_TILE, cols * SPIN_TILE, 4), dtype=np.float32)
    for k in range(FRAMES):
        pivot.rotation_euler = (0.0, math.tau * k / FRAMES, 0.0)
        bpy.context.view_layer.update()
        tile = binary_downsample(render_rgba(SPIN_TILE * 2, tmp), 2)
        r, c = divmod(k, cols)
        sheet[r * SPIN_TILE:(r + 1) * SPIN_TILE, c * SPIN_TILE:(c + 1) * SPIN_TILE] = tile
    save_rgba(os.path.join(OUT_DIR, "roar_coin_spin.png"), sheet)
    os.remove(tmp)
    print("done")


main()
