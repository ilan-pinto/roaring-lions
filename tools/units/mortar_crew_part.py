"""mortar_crew's mortar: the B8 Meshy mortar, raised to firing elevation and
weathered for an irregular crew -- two Blender edits, 0 credits (the lead's
ruling of 2026-10-14, unit polish).

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/units/mortar_crew_part.py -- --crew-image <figure base_color.jpg>

Writes, under `art/parts/mortar_crew/`:

  mortar.glb     the part in the TEAM frame (+X forward, Z up in Blender,
                 baseplate socket on the origin, lowest vertex on the ground),
                 its uvs already in the atlas's right half [0.5, 1); the
                 measured points (`muzzle`, `socket`, `handwheel`, `plate`)
                 on the scene's extras as `rl_points`, metres, glTF frame.
  mortar.blend   the same scene, the `.blend` source the GLB is exported from.
  atlas.jpg      the team's 2 x 1024 base colour: the crew's own bake (passed
                 in, untouched) on the left, the weathered mortar on the right.

`tools/src/meshes/mortar-graft.ts` grafts the GLB into `mortar_crew.glb`
WITHOUT re-exporting the crew (a re-export of this team changes its boots,
uniform and every bone's rest: `move-fire-splice.ts`).

## The source

`art/meshy/mortar-team-mortar-20261002-01a0fae4/` -- the B8 remesh of an 8k
refine (`mortar_team`'s mortar, `import_meshy_crew_team._meshy_mortar`). It
is gitignored and 40 MB; the copy of record is in
`~/dev/roaring-lions-art-backup/` (sha256 67feca20...).

Measured in the SOURCE frame (Meshy's: muzzle toward -X, Z up), and printed
again on every run so a different source cannot pass silently:

  tube      a 1.167 m-long box (pca of everything above z 0.05), axis
            elevation 13.2 deg -- it reads as a machine gun on a bipod, the
            lead's complaint;
  socket    a ball on the baseplate at (0.54, 0, -0.28);
  struts    two bars from the tube's underside down to the socket, which
            held the low tube up;
  legs      the bipod, from the collar under the tube (x < -0.45) out to two
            feet on the ground at x -0.70.

## Edit 1: the raise

The tube (and its collar, sight and handwheels -- every vertex within 0.20 m
of the axis) turns rigidly about its rear end by `ELEVATION_DEG - 13.2` and
its rear end is seated on the socket, `BREECH_ABOVE_SOCKET` above the ball's
centre: the breech sits in the ball as a real mortar's does. The two struts
are deleted -- with the breech in the socket they hold nothing up, and left
in they would hang in the air. Each bipod leg vertex moves by the collar's
own displacement times its height fraction between the feet (z -0.38) and
the collar (z 0.0): the feet stay planted, the top follows the collar. The
baseplate and socket do not move.

## Edit 2: the weathering

The 8k bake is scaled to the 1024 slot first (the slot it ships at), then:
saturation x `FADE_SATURATION`, and a dust layer -- the palette's `dust.3`
-- laid over it by a hand-rolled fbm mask (NOT `mathutils.noise`, which
Blender 5.2 reseeds per process), at most `DUST_MAX`.

## Scale

Declared, not tuned: the tube is scaled to `TUBE_M`, the 82 mm 2B14
pattern's 1.22 m barrel, from its own measured length.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(REPO, "art", "meshy", "mortar-team-mortar-20261002-01a0fae4")
OUT = os.path.join(REPO, "art", "parts", "mortar_crew")

ELEVATION_DEG = 60.0
TUBE_M = 1.22
BREECH_ABOVE_SOCKET = 0.05      # source units, before scaling
TUBE_RADIUS = 0.20              # source units: tube + collar + sight + handwheels
SOCKET = Vector((0.54, 0.0, -0.28))
SOCKET_RADIUS = 0.08
PLATE_TOP = -0.33
LEG_X = -0.45                   # bipod legs live forward of this (source x)
FOOT_Z, COLLAR_Z = -0.38, 0.0
TEXTURE_PX = 1024
FADE_SATURATION = 0.55
DUST_MAX = 0.45
DUST_KEY = ("dust", 3)


def log(msg):
    print(f"[mortar_crew_part] {msg}", flush=True)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    for i in range(0, len(argv) - 1, 2):
        out[argv[i].lstrip("-")] = argv[i + 1]
    if "crew-image" not in out:
        raise SystemExit("usage: ... -- --crew-image <figure base_color.jpg>")
    return out


# ---------------------------------------------------------------- noise
# Hand-rolled, as `tools/render_campaign_world.py`'s: deterministic.

def _hash01(ix, iy, salt):
    h = (ix * 374761393 + iy * 668265263 + salt * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / float(0xFFFFFFFF)


def _vnoise_grid(n, cells, salt):
    """Value noise over an n x n grid with `cells` lattice cells, 0..1."""
    lat = np.array([[_hash01(i, j, salt) for i in range(cells + 1)] for j in range(cells + 1)])
    u = np.linspace(0, cells, n, endpoint=False)
    i0 = np.floor(u).astype(int)
    f = u - i0
    s = f * f * (3 - 2 * f)
    a = lat[np.ix_(i0, i0)]
    b = lat[np.ix_(i0, i0 + 1)]
    c = lat[np.ix_(i0 + 1, i0)]
    d = lat[np.ix_(i0 + 1, i0 + 1)]
    sx, sy = s[None, :], s[:, None]
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def fbm_grid(n, salt=7, octaves=5):
    total, norm, amp, cells = np.zeros((n, n)), 0.0, 1.0, 6
    for o in range(octaves):
        total += amp * _vnoise_grid(n, cells, salt + 101 * o)
        norm += amp
        amp *= 0.5
        cells *= 2
    return total / norm


# ---------------------------------------------------------------- geometry

def load_source():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, "model.glb"))
    ob = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    ob.name = ob.data.name = "mortar"
    return ob


def tube_axis(co):
    top = co[co[:, 2] > 0.05]
    c = top.mean(axis=0)
    _u, _s, vt = np.linalg.svd(top - c)
    ax = vt[0] if vt[0][0] < 0 else -vt[0]      # toward the muzzle (-X)
    t = (top - c) @ ax
    return c, ax, float(t.min()), float(t.max())


def raise_tube(ob):
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    c, ax, tmin, tmax = tube_axis(co)
    elev0 = math.degrees(math.asin(ax[2]))
    rear = c + tmin * ax
    log(f"source tube: length {tmax - tmin:.3f}, elevation {elev0:.1f} deg, rear {np.round(rear, 3)}, "
        f"muzzle {np.round(c + tmax * ax, 3)}")
    if not (1.0 < tmax - tmin < 1.35 and 8.0 < elev0 < 20.0):
        raise SystemExit("the source is not the B8 mortar this script was measured on -- re-measure")
    delta = math.radians(ELEVATION_DEG - elev0)
    rot = Matrix.Rotation(delta, 4, "Y")          # +Y raises a vector pointing -X
    seat = SOCKET + Vector((0, 0, BREECH_ABOVE_SOCKET))
    tube_xf = Matrix.Translation(seat) @ rot @ Matrix.Translation(-Vector(rear))

    # Every FACE is classified by its centroid, and the mesh is split along the
    # boundaries between classes, so each class moves on its own without
    # tearing a neighbour. The remesh is one welded piece (no loose parts to
    # select), which is why this is geometric rather than by island.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()

    def klass(p):
        p = np.array(p)
        tt = float((p - c) @ ax)
        rad = float(np.linalg.norm((p - c) - tt * ax))
        if np.linalg.norm(p - np.array(SOCKET)) <= SOCKET_RADIUS + 0.02:
            return "socket"
        if p[2] < PLATE_TOP + 0.03 and p[0] > -0.05:
            return "plate"
        if rad <= TUBE_RADIUS and tmin - 0.05 <= tt <= tmax + 0.05 and p[2] > 0.0:
            return "tube"
        if p[0] < LEG_X + 0.05:
            return "leg"
        return "strut"

    cls = {f.index: klass(f.calc_center_median()) for f in bm.faces}
    seams = [e for e in bm.edges if len({cls[f.index] for f in e.link_faces}) > 1]
    bmesh.ops.split_edges(bm, edges=seams)
    counts = {}
    for f in bm.faces:
        counts[cls[f.index]] = counts.get(cls[f.index], 0) + 1
    collar = Vector((LEG_X - 0.10, 0.0, COLLAR_Z))
    dcollar = (tube_xf @ collar) - collar
    moved = set()
    for f in bm.faces:
        k = cls[f.index]
        for v in f.verts:
            if v.index in moved:
                continue
            moved.add(v.index)
            if k == "tube":
                v.co = tube_xf @ v.co
            elif k == "leg":
                w = min(1.0, max(0.0, (v.co.z - FOOT_Z) / (COLLAR_Z - FOOT_Z)))
                v.co = v.co + w * dcollar
    doomed = [f for f in bm.faces if cls[f.index] == "strut"]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    if me.has_custom_normals:
        me.normals_split_custom_set([(0, 0, 0)] * len(me.loops))
    # Faceted: the welded remesh shaded smooth smears light across the
    # tube's box edges; the remesh's own look is flat facets.
    for poly in me.polygons:
        poly.use_smooth = False
    me.update()
    log(f"faces by class: {counts} (struts deleted)")

    muzzle = tube_xf @ Vector(c + tmax * ax)
    # The elevating handwheel: under the collar (54 % of the way up the tube, where
    # the bipod meets it, measured on the source), on the gunner's side -- source
    # +Y, which the 180-degree turn below makes the team's anatomical right.
    handwheel = tube_xf @ Vector(c + (tmin + 0.54 * (tmax - tmin)) * ax + np.array([0.0, 0.10, -0.12]))
    return {"muzzle": muzzle, "socket": SOCKET.copy(), "handwheel": handwheel,
            "scale": TUBE_M / (tmax - tmin), "faces_deleted": counts.get("strut", 0)}


def to_team_frame(ob, pts):
    """Muzzle leads +X (turn 180 about Z), scale to TUBE_M, socket on the
    origin in xy, lowest vertex on the ground."""
    s = pts["scale"]
    xf = Matrix.Scale(s, 4) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Translation(-Vector((pts["socket"].x, pts["socket"].y, 0)))
    ob.data.transform(xf)
    zmin = min(v.co.z for v in ob.data.vertices)
    ob.data.transform(Matrix.Translation((0, 0, -zmin)))
    lift = Matrix.Translation((0, 0, -zmin))
    out = {}
    for k in ("muzzle", "socket", "handwheel"):
        out[k] = lift @ (xf @ pts[k])
    co = np.array([v.co[:] for v in ob.data.vertices])
    plate = co[co[:, 2] < 0.06]
    out["plate"] = Vector((float(plate[:, 0].mean()), float(plate[:, 1].mean()), 0.0))
    log(f"team frame: scale {s:.4f}; extent x {co[:, 0].min():+.3f}..{co[:, 0].max():+.3f} "
        f"y {co[:, 1].min():+.3f}..{co[:, 1].max():+.3f} z 0..{co[:, 2].max():.3f}; "
        + ", ".join(f"{k} {tuple(round(x, 3) for x in v)}" for k, v in out.items()))
    return out


# ---------------------------------------------------------------- texture

def palette_rgb(ramp, idx):
    with open(os.path.join(REPO, "data", "palette.json")) as fh:
        hexv = json.load(fh)["ramps"][ramp]["colors"][idx].lstrip("#")
    srgb = np.array([int(hexv[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return srgb


def weathered_slot():
    img = bpy.data.images.load(os.path.join(SRC, "texture_0_base_color.png"))
    img.scale(TEXTURE_PX, TEXTURE_PX)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(TEXTURE_PX, TEXTURE_PX, 4)
    rgb = px[..., :3]
    grey = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    rgb = grey[..., None] + (rgb - grey[..., None]) * FADE_SATURATION
    mask = fbm_grid(TEXTURE_PX)
    lo, hi = 0.42, 0.72
    m = np.clip((mask - lo) / (hi - lo), 0, 1)
    m = (m * m * (3 - 2 * m) * DUST_MAX).astype(np.float32)
    dust = palette_rgb(*DUST_KEY).astype(np.float32)
    rgb = rgb * (1 - m[..., None]) + dust * m[..., None]
    px[..., :3] = np.clip(rgb, 0, 1)
    bpy.data.images.remove(img)
    log(f"weathered slot: saturation x{FADE_SATURATION}, dust {DUST_KEY} up to {DUST_MAX}, "
        f"mean dust {float(m.mean()):.3f}")
    return px


def compose_atlas(crew_path, part_px):
    crew = bpy.data.images.load(crew_path)
    if tuple(crew.size) != (TEXTURE_PX, TEXTURE_PX):
        raise SystemExit(f"crew image is {tuple(crew.size)}, expected a {TEXTURE_PX} slot")
    cpx = np.array(crew.pixels[:], dtype=np.float32).reshape(TEXTURE_PX, TEXTURE_PX, crew.channels)
    if cpx.shape[2] == 3:
        cpx = np.concatenate([cpx, np.ones((TEXTURE_PX, TEXTURE_PX, 1), np.float32)], axis=2)
    atlas = bpy.data.images.new("base_color", 2 * TEXTURE_PX, TEXTURE_PX, alpha=False)
    atlas.pixels = np.concatenate([cpx, part_px], axis=1).ravel().tolist()
    atlas.filepath_raw = os.path.join(OUT, "atlas.jpg")
    atlas.file_format = "JPEG"
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 85
    atlas.save_render(os.path.join(OUT, "atlas.jpg"), scene=sc)
    bpy.data.images.remove(crew)
    return atlas


def remap_uv_right_half(ob):
    uv = ob.data.uv_layers.active.data
    for l in uv:
        u, v = l.uv
        l.uv = (0.5 + 0.5 * u, v)


def main():
    a = args()
    os.makedirs(OUT, exist_ok=True)
    ob = load_source()
    pts = raise_tube(ob)
    team = to_team_frame(ob, pts)
    part_px = weathered_slot()
    atlas = compose_atlas(os.path.abspath(a["crew-image"]), part_px)
    remap_uv_right_half(ob)
    mat = ob.active_material
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE":
            n.image = atlas
    ob["rl_role"] = "weapon"
    # glTF frame: (x, y, z)_blender -> (x, z, -y)
    gl = {k: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)] for k, v in team.items()}
    bpy.context.scene["rl_points"] = json.dumps(gl)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "mortar.blend"))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "mortar.glb"), export_format="GLB", use_selection=False,
        export_extras=True, export_yup=True, export_apply=True, export_image_format="JPEG",
    )
    with open(os.path.join(OUT, "points.json"), "w") as fh:
        json.dump({"frame": "glTF metres, +X forward, +Y up, +Z anatomical right; socket on the origin",
                   "elevation_deg": ELEVATION_DEG, "tube_m": TUBE_M, "points": gl}, fh, indent=2)
        fh.write("\n")
    log(f"wrote {OUT}/mortar.glb, mortar.blend, atlas.jpg, points.json: {gl}")


if __name__ == "__main__":
    main()
