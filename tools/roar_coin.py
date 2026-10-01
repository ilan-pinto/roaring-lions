"""Build and render the Roar coin (GH-317), emblem B "Hex Seal", with the
Meshy-sculpted lion relief the lead chose on 1 Oct ("Option 2").

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/roar_coin.py

(or any Blender on PATH / in BLENDER_BIN).

A pointy-top hex coin, 40 mm across flats and 4 mm thick, with a 0.6 mm raised
rim, bearing a front-facing roaring lion's head in relief, full mane framing
the face. The relief is the Meshy text-to-3D preview in RELIEF_GLB (AI-generated,
disclosed in docs/ASSET_PROVENANCE.md): a round bas-relief plaque whose lion is
clipped off its plaque, turned face-up, scaled to LION_MM across and RELIEF_MM
deep, decimated to about RELIEF_TRIS triangles and seated on the coin face. The
coin body, rim and sizes are the ones the first build approved; only the lion
changed. The flat extruded profile it replaces read as a dinosaur.

Colour is palette keys only (data/palette.json via dimetric.palette_linear),
assigned per face of the relief from its own height and radius -- no texture:

    face terracotta.0 | mane terracotta.1 | rim terracotta.2
    lion's face limestone.1 (the high relief) | mouth and deep recesses shadow.1

Standard view transform, transparent film, BINARY alpha (every pixel is in or
out). The sun is fixed; the object rotates. No noise is used, so there is no
mathutils.noise (nondeterministic in Blender 5.2) anywhere in here, and the
decimation is Blender's own collapse modifier on fixed input, so re-running
gives the same bytes.

Writes assets/ui/roar_coin/:
    roar_coin_{16,24,48,96,512}.png        the shipped strike at each size
    roar_coin_{16,24}_flat.png             the flat cut, the losing candidate
    roar_coin_spin.png                     24 frames, 0.6 s, 6x4 contact sheet
    roar_coin_{16,24,48}.svg               the flat cut, TRACED from the relief:
                                           pixel-exact at 16 and 24, a
                                           simplified contour at 48
and saves the scene to art/src/ui/roar_coin.blend.

The flat cut is an "ID render" of the same scene: every material switched to
an unlit emission of its palette colour, the sun and the world off, so each
pixel is exactly one palette key and the SVGs are cut from the same lion the
PNGs show rather than from a second drawing.
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
RELIEF_GLB = os.path.join(ROOT, "art", "meshy", "roar-lion-relief-20261001-01a0f804",
                          "model.glb")

# --- the approved numbers ----------------------------------------------------
FLATS_MM = 40.0
THICK_MM = 4.0
RIM_MM = 0.6                       # how far the rim stands proud of the face
RIM_WIDTH_MM = 2.0                 # radial width of the rim band
MM = FLATS_MM / 39.0               # mm per SVG unit (hex flats span 4.5..43.5)
Z_TOP = THICK_MM / 2.0             # rim top
Z_FACE = Z_TOP - RIM_MM            # face plane
BEVEL_MM = 0.18

# --- the relief ---------------------------------------------------------------
LION_MM = 33.0                     # the lion's longest axis (it is taller than wide)
RELIEF_MM = 2.0                    # nose tip above the coin face; the rim is 0.6
SINK_MM = 0.12                     # the clipped base sits this far under the face
RELIEF_TRIS = 16000                # decimation target
# Measured on the preview (2026-10-01): the plaque face plane is y = 0.35, its
# edge ring tops out at y 0.33 and the lion's outermost mane lock reaches
# r 0.847 while the ring starts at 0.9, so a cut at 0.31 keeps every lock and
# nothing of the plaque.
PLAQUE_CUT = 0.31
PLAQUE_RING_R = 0.86
# Per-face classification, in normalised relief height (0 the base, 1 the nose)
# and radius over the lion's half-extent.
HEAD_H = 0.50                      # above this the relief is the lion's face
FACE_R = 0.40                      # inside this radius, so is anything not a recess
INK_H = 0.30                       # below this, inside INK_R, a deep recess
INK_R = 0.42
GROOVE_H = 0.12                    # below this anywhere: the mane's grooves and its base edge

KEYS = {"face": "terracotta.0", "mane": "terracotta.1", "rim": "terracotta.2",
        "head": "limestone.1", "ink": "shadow.1"}

HEX_OUTER = "24,1.5 43.5,12.75 43.5,35.25 24,46.5 4.5,35.25 4.5,12.75"
HEX_INNER = "24,4.5 41,14.3 41,33.7 24,43.5 7,33.7 7,14.3"

SIZES = (16, 24, 48, 96, 512)
SUPER = {16: 8, 24: 8, 48: 6, 96: 4, 512: 2}
FRAMES = 24
SPIN_TILE = 128
TRACE_SUPER = 4                    # the 48 px SVG is traced at 192 px
TRACE_TOL = 0.35                   # Douglas-Peucker tolerance, in 48 px units
TRACE_MIN_AREA = 0.75              # loops under this, in 48 px units squared, are dropped


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


# --- Blender build -----------------------------------------------------------
MATERIALS = []


def material(name, key):
    """Principled for the strike; an unlit emission of the same palette colour
    behind a Mix Shader whose factor `id_mode` sets, for the ID render."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    out = nodes["Material Output"]
    colour = palette_linear(key)
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.55
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = colour
    emit.inputs["Strength"].default_value = 1.0
    mix = nodes.new("ShaderNodeMixShader")
    mix.name = "id_mix"
    mix.inputs["Fac"].default_value = 0.0
    links.new(bsdf.outputs["BSDF"], mix.inputs[1])
    links.new(emit.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])
    MATERIALS.append(mat)
    return mat


def id_mode(on):
    for mat in MATERIALS:
        mat.node_tree.nodes["id_mix"].inputs["Fac"].default_value = 1.0 if on else 0.0
    sc = bpy.context.scene
    bpy.data.objects["Sun"].hide_render = on
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0 if on else 0.45


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


def relief(parent):
    """The Meshy lion, clipped off its plaque, turned face-up, scaled to the
    coin, decimated, and coloured per face from height and radius."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=RELIEF_GLB)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"expected one mesh in {RELIEF_GLB}, got {len(meshes)}")
    src = meshes[0]
    src_mesh = src.data
    n = len(src_mesh.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    src_mesh.vertices.foreach_get("co", co)
    co = co.reshape(n, 3) @ np.array(src.matrix_world.to_3x3().transposed(), dtype=np.float32)
    co += np.array(src.matrix_world.translation, dtype=np.float32)
    # The plaque's flat back must be the +Y slab and the relief must face -Y;
    # the clip below assumes exactly that orientation and refuses any other.
    ext = co.max(0) - co.min(0)
    if int(np.argmin(ext)) != 1:
        raise RuntimeError(f"relief thin axis is not Y: extent {ext}")
    slab = 0.02 * ext[1]
    back = (co[:, 1] > co[:, 1].max() - slab).sum()
    front = (co[:, 1] < co[:, 1].min() + slab).sum()
    if back <= front:
        raise RuntimeError(f"plaque back not at +Y ({back} vs {front} slab verts)")

    tris = np.empty(len(src_mesh.loop_triangles) * 3, dtype=np.int32)
    src_mesh.loop_triangles.foreach_get("vertices", tris)
    tris = tris.reshape(-1, 3)
    for o in imported:
        bpy.data.objects.remove(o)
    bpy.data.meshes.remove(src_mesh)

    # Clip: keep triangles entirely on the lion's side of the cut and inside
    # the plaque ring; the cut edge is sunk under the coin face, so a sliver
    # of base is never seen.
    r = np.hypot(co[:, 0], co[:, 2])
    keep_v = (co[:, 1] < PLAQUE_CUT) & (r < PLAQUE_RING_R)
    keep_t = keep_v[tris].all(axis=1)
    tris = tris[keep_t]
    used = np.unique(tris)
    remap = np.full(n, -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    co = co[used]
    tris = remap[tris]

    # Turn face-up (-Y -> +Z, +Z -> +Y), centre on the plaque's axis (the
    # medallion is already centred on the origin), then scale: XY to LION_MM
    # on the longer axis, depth to RELIEF_MM, base at Z_FACE - SINK_MM.
    x, y, z = co[:, 0], co[:, 2], PLAQUE_CUT - co[:, 1]
    span = max(x.max() - x.min(), y.max() - y.min())
    s_xy = LION_MM / span
    s_z = RELIEF_MM / z.max()
    xm, ym, zm = x * s_xy, y * s_xy, z * s_z + (Z_FACE - SINK_MM)

    bm = bmesh.new()
    verts = [bm.verts.new((float(a), float(b), float(c))) for a, b, c in zip(xm, ym, zm)]
    for a, b, c in tris:
        try:
            bm.faces.new((verts[a], verts[b], verts[c]))
        except ValueError:
            pass                       # a duplicate face in the source
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new("lion_dense")
    bm.to_mesh(mesh)
    bm.free()
    dense = bpy.data.objects.new("lion_dense", mesh)
    bpy.context.collection.objects.link(dense)
    mod = dense.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, RELIEF_TRIS / max(1, len(mesh.polygons)))
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    lion_mesh = bpy.data.meshes.new_from_object(dense.evaluated_get(dg))
    bpy.data.objects.remove(dense)
    bpy.data.meshes.remove(mesh)

    for key in ("mane", "head", "ink"):
        lion_mesh.materials.append(material(f"m_lion_{key}", KEYS[key]))
    nv = len(lion_mesh.vertices)
    vco = np.empty(nv * 3, dtype=np.float32)
    lion_mesh.vertices.foreach_get("co", vco)
    vco = vco.reshape(nv, 3)
    v_h = (vco[:, 2] - (Z_FACE - SINK_MM)) / RELIEF_MM
    v_r = np.hypot(vco[:, 0], vco[:, 1]) / (LION_MM / 2.0)
    for poly in lion_mesh.polygons:
        idx = list(poly.vertices)
        h = float(v_h[idx].mean())
        rr = float(v_r[idx].mean())
        if (h < INK_H and rr < INK_R) or h < GROOVE_H:
            poly.material_index = 2
        elif h >= HEAD_H or rr < FACE_R:
            poly.material_index = 1
        else:
            poly.material_index = 0
    lion_mesh.shade_smooth()
    lion = bpy.data.objects.new("lion", lion_mesh)
    bpy.context.collection.objects.link(lion)
    lion.parent = parent
    print(f"relief: {len(lion_mesh.polygons)} tris, {nv} verts, "
          f"{LION_MM} mm across, {RELIEF_MM} mm deep")
    return lion


def build():
    pivot = bpy.data.objects.new("coin", None)
    bpy.context.collection.objects.link(pivot)
    outer = hex_mm(FLATS_MM)
    inner = hex_mm(FLATS_MM - 2 * RIM_WIDTH_MM)
    ring("rim", outer, inner, -Z_TOP, Z_TOP, KEYS["rim"], pivot)
    prism("face", [inner], -Z_TOP, Z_FACE, KEYS["face"], parent=pivot)
    relief(pivot)
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


# --- the flat cut: an ID render, classified onto the palette -----------------
def palette_hex(key):
    import json
    with open(os.path.join(ROOT, "data", "palette.json")) as fh:
        pal = json.load(fh)
    band, name = key.split(".", 1)
    return pal["ramps"][band]["colors"][int(name)]


def srgb_u8(key):
    hx = palette_hex(key)
    return np.array([int(hx[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)


LAYER_ORDER = ("rim", "face", "mane", "head", "ink")


def classify(arr):
    """Per pixel, the index into LAYER_ORDER of the nearest palette colour, or
    -1 outside the coin."""
    cols = np.stack([srgb_u8(KEYS[k]) for k in LAYER_ORDER])
    d = ((arr[..., None, :3] - cols[None, None]) ** 2).sum(-1)
    idx = d.argmin(-1)
    idx[arr[..., 3] < 0.5] = -1
    return idx


def flat_from_ids(idx):
    out = np.zeros(idx.shape + (4,), dtype=np.float32)
    for k, key in enumerate(LAYER_ORDER):
        m = idx == k
        out[m, :3] = srgb_u8(KEYS[key])
        out[m, 3] = 1.0
    return out


def id_render(res, tmp, f):
    """A supersampled unlit render, binary-downsampled by f, classified."""
    id_mode(True)
    try:
        arr = binary_downsample(render_rgba(res * f, tmp), f)
    finally:
        id_mode(False)
    return classify(arr)


def pixel_runs_path(mask):
    """A path of one rect per horizontal run: pixel-exact at the SVG's size."""
    parts = []
    for yy in range(mask.shape[0]):
        row = mask[yy]
        xx = 0
        while xx < len(row):
            if row[xx]:
                x0 = xx
                while xx < len(row) and row[xx]:
                    xx += 1
                parts.append(f"M{x0} {yy}h{xx - x0}v1h{x0 - xx}z")
            else:
                xx += 1
    return "".join(parts)


def trace_loops(mask):
    """Boundary loops of a binary mask on the pixel lattice, inside on the
    left. Returns lists of (x, y) corner points in pixel units."""
    h, w = mask.shape
    pad = np.zeros((h + 2, w + 2), dtype=bool)
    pad[1:-1, 1:-1] = mask
    edges = {}
    ys, xs = np.nonzero(pad)
    for yy, xx in zip(ys.tolist(), xs.tolist()):
        x0, y0 = xx - 1, yy - 1
        if not pad[yy - 1, xx]:
            edges.setdefault((x0, y0), []).append((x0 + 1, y0))          # top, going right
        if not pad[yy, xx + 1]:
            edges.setdefault((x0 + 1, y0), []).append((x0 + 1, y0 + 1))  # right, going down
        if not pad[yy + 1, xx]:
            edges.setdefault((x0 + 1, y0 + 1), []).append((x0, y0 + 1))  # bottom, going left
        if not pad[yy, xx - 1]:
            edges.setdefault((x0, y0 + 1), []).append((x0, y0))          # left, going up
    loops = []
    while edges:
        start = next(iter(edges))
        loop, cur = [start], start
        while True:
            nxt = edges[cur].pop()
            if not edges[cur]:
                del edges[cur]
            if nxt == start:
                break
            loop.append(nxt)
            cur = nxt
        loops.append(loop)
    return loops


def simplify(points, tol):
    """Douglas-Peucker on a closed loop, split at its two farthest points."""
    pts = np.array(points, dtype=np.float64)
    if len(pts) < 4:
        return pts.tolist()

    def dp(idx):
        a, b = pts[idx[0]], pts[idx[-1]]
        if len(idx) <= 2:
            return [idx[0]]
        ab = b - a
        nrm = np.hypot(*ab)
        seg = pts[idx[1:-1]]
        if nrm == 0:
            dist = np.hypot(*(seg - a).T)
        else:
            dist = np.abs(ab[0] * (seg[:, 1] - a[1]) - ab[1] * (seg[:, 0] - a[0])) / nrm
        k = int(dist.argmax())
        if dist[k] > tol:
            return dp(idx[:k + 2]) + dp(idx[k + 1:])
        return [idx[0]]

    far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    idx = list(range(len(pts)))
    out = dp(idx[:far + 1]) + dp(idx[far:] + [0])
    return [pts[i].tolist() for i in out]


def loop_area(points):
    pts = np.array(points, dtype=np.float64)
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def traced_path(mask, scale, tol):
    rows = []
    for loop in trace_loops(mask):
        if loop_area(loop) < TRACE_MIN_AREA * scale * scale:
            continue                   # a fleck under a pixel at 48
        pts = simplify(loop, tol * scale)
        if len(pts) < 3:
            continue
        rows.append("M" + " L".join(f"{x / scale:.2f} {y / scale:.2f}" for x, y in pts) + " Z")
    return " ".join(rows)


def write_svg(path, view, layers):
    rows = [f'  <path d="{d}" fill="{palette_hex(KEYS[key])}" fill-rule="evenodd"/>'
            for key, d in layers if d]
    with open(path, "w") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{view}" height="{view}" '
                 f'viewBox="0 0 {view} {view}">\n' + "\n".join(rows) + "\n</svg>\n")


def svg_pixel_exact(path, idx):
    """16 and 24: every layer as pixel runs of the classified render, so the
    DOM draws the PNG's own pixels."""
    view = idx.shape[0]
    write_svg(path, view, [(key, pixel_runs_path(idx == k)) for k, key in enumerate(LAYER_ORDER)])


def hex_path(points):
    return "M" + " L".join(p.replace(",", " ") for p in points.split(" ")) + " Z"


def svg_traced(path, idx, scale):
    """48: the hexes as polygons, the lion's three layers as simplified contours
    of the ID render, each layer filled over the ones under it."""
    mane, head, ink = (LAYER_ORDER.index(k) for k in ("mane", "head", "ink"))
    layers = [("rim", hex_path(HEX_OUTER)), ("face", hex_path(HEX_INNER)),
              ("mane", traced_path(idx >= mane, scale, TRACE_TOL)),
              ("head", traced_path(idx >= head, scale, TRACE_TOL)),
              ("ink", traced_path(idx == ink, scale, TRACE_TOL))]
    write_svg(path, idx.shape[0] // scale, layers)


# --- main --------------------------------------------------------------------
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig()
    pivot = build()
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    tmp = os.path.join(OUT_DIR, "_tmp.png")
    only = os.environ.get("ROAR_COIN_ONLY")        # a diagnostic subset, dev only

    pivot.rotation_euler = (0.0, 0.0, 0.0)
    for res in SIZES:
        if only and str(res) not in only.split(","):
            continue
        save_rgba(os.path.join(OUT_DIR, f"roar_coin_{res}.png"), render_coin(res, tmp))
        print("relief", res)
    if only:
        os.remove(tmp)
        return
    # The flat cut at 16 and 24, kept beside the relief render as the losing
    # candidate: judged 2026-10-01, the lit relief ships at both (the limestone
    # face and the dark mouth hold up; the flat cut is tone-on-tone at 16).
    for res in (16, 24):
        idx = id_render(res, tmp, SUPER[res])
        save_rgba(os.path.join(OUT_DIR, f"roar_coin_{res}_flat.png"), flat_from_ids(idx))
        svg_pixel_exact(os.path.join(OUT_DIR, f"roar_coin_{res}.svg"), idx)
    idx48 = id_render(48 * TRACE_SUPER, tmp, 2)
    svg_traced(os.path.join(OUT_DIR, "roar_coin_48.svg"), idx48, TRACE_SUPER)

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
