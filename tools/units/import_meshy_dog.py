"""Build `art/meshes/ugv_recon_dog.glb` from the Meshy remesh of the Chadaf
recon robot, on rig.py's own dog topology.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_dog.py

GH-709 unit 10, 2026-10-22. Spec `docs/superpowers/specs/2026-10-22-robot-dog-art.md`
(approved by the lead; build R1 with R3 as the fallback). Owner of the file in
`rig.TEAM_MESH_OWNER`, so `export_mesh_team.py -- all` skips it.

SOURCE

  preview 01a16330-1af3-7501-bdc1-d514585c2a00, refine (2k)
  01a16331-cfd0-764f-98ee-8dd90b5c0baa, REMESH 01a16333-952a-7477-99b8-47005fd32fbf
  at 4,000 (arrived 4,026 tris, 2k base colour), found through the ledger's last
  `kind: remesh` named `ugv_recon_dog`. 35 credits. AI-generated (Meshy),
  disclosed per CONTRIBUTING.md.

## What the remesh is, measured (`_classify`)

Z up, metres, un-scaled: 19 vertex-connected pieces (merged by position,
because Meshy splits vertices along its UV seams). The big one is the body with
two mast fittings on its top (a puck with a coil and a whip at the REAR, a
grey cylinder with a whip at the front); four legs, one piece each, splayed
diagonally out to the four corners; four separate foot pads; ten small
fittings in the body's waist. The long axis is X (0.903 against 0.790) and the
front is +X, the end the grey cylinder is on, so the rear whip is the one kept.

## What is wrong with it, and what this file does about it (0 credits)

  * legs too long and splayed: each leg is cut at its measured knee (the dense
    vertex block, `_joint`), and each half is rotated and scaled rigidly to the
    spec's 0.30 m and stood in the sagittal plane, knee rearward, at the pose
    `rig.dog_two_bone` solves for the hip (0.51 m x rig.DOG_SCALE) over the foot pads;
  * no distinct sensor head: a kit part (a 0.16 m box and a lens) is added at
    the front top, role `face`, and given the bake's own dark-gunmetal texel so
    it draws from the same material instead of a skin-tone ramp;
  * two antennas: the front one and its grey cylinder are deleted;
  * white stencil markings baked on the body: every near-white texel under the
    body's UV footprint is painted the body's own olive median (`_paint_out`).

## One set of numbers

Every design number lives in `rig.py` (`DOG_*`): geometry and bones read the
same ones, so a bone cannot sit off its joint. This file measures the REMESH
and prints every measurement it uses. Deterministic: no random, no
`mathutils.noise`.

After this: `pnpm motion:meshes -- --id=ugv_recon_dog`, `pnpm gait:meshes --
--id=ugv_recon_dog`, `pnpm encode:meshes`, `pnpm validate:meshes`.
"""
import glob
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import rig  # noqa: E402

REPO = os.path.dirname(TOOLS)
TEAM = "ugv_recon_dog"
OUT_PATH = os.path.join(REPO, "art", "meshes", "ugv_recon_dog.glb")   # literal: mesh_ownership.test.ts reads it
LEDGER_NAME = "ugv_recon_dog"
JPEG_QUALITY = 85
TRI_CAP = 5000                    # spec 3.1: 4,000 target, 5,000 cap, the file as a whole

#: Measured on remesh 01a16333 (see `_classify` and `_split_masts`, which print
#: the readings these are checked against).
MAST_MIN_Z = 0.28                 # below the mast clusters' lowest face and above the shell's highest
MAST_MIN_FACES = 50
KNEE_WINDOW = (0.34, 0.46)        # of the hip-to-end axis, metres: the dense knee block
HIP_MAX_Z = -0.12                 # raw z above which a leg's vertices are its hip block
END_MIN_Z = -0.85                 # raw z below which a leg's vertices are its stub bottom

#: What counts as a stencil marking: bright and nearly colourless.
WHITE_MIN_VALUE = 0.55
WHITE_MAX_SAT = 0.22
OLIVE_MIN_SAT = 0.35
MARK_DILATE_PX = 3
OLIVE_MIN_TEXELS = 1000

# All sizes below follow rig.DOG_SCALE (1.2, the lead's ruling of 22 Oct).
DOG_PAD_DIAMETER = 0.07 * rig.DOG_SCALE           # spec 3.1 x scale
HEAD_SIZE = 0.16 * rig.DOG_SCALE
HEAD_CENTRE_X = rig.DOG_HEAD_PIVOT[0]
HEAD_SINK = 0.02 * rig.DOG_SCALE                  # the head sits this far into the body top
LENS_RADIUS = 0.045 * rig.DOG_SCALE
LENS_PROUD = 0.03 * rig.DOG_SCALE
ANTENNA_RADIAL_GAIN = 0.8         # the whip is scaled thicker than its length so it reads

ROLE = {"body": "uniform", "antenna": "metal", "head": "face",
        "thigh": "metal", "lower": "metal", "foot": "boot"}


def log(msg):
    print(f"[dog] {msg}")


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def _face_centroids(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float64)
    bm.free()
    return cent


def _tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def _transform(ob, mat):
    """Apply `mat` to `ob` through Blender's own transform_apply, which carries
    the custom split normals the Meshy import has (writing `v.co` would leave
    them pointing where they did)."""
    ob.matrix_world = mat @ ob.matrix_world
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def _islands(ob):
    """Connected pieces as lists of polygon indices, largest first; vertices
    merged by position (1e-4) because Meshy splits them along UV seams."""
    me = ob.data
    co = _coords(ob)
    key = {}
    vid = np.empty(len(co), dtype=np.int64)
    for i, p in enumerate(np.round(co / 1e-4).astype(np.int64)):
        vid[i] = key.setdefault(tuple(p), len(key))
    return _components(me, vid, range(len(me.polygons)))


def _components(me, vid, face_ids):
    parent = {}

    def find(a):
        parent.setdefault(a, a)
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for fi in face_ids:
        vs = [int(vid[v]) for v in me.polygons[fi].vertices]
        r0 = find(vs[0])
        for v in vs[1:]:
            rv = find(v)
            if rv != r0:
                parent[rv] = r0
    groups = {}
    for fi in face_ids:
        groups.setdefault(find(int(vid[me.polygons[fi].vertices[0]])), []).append(fi)
    return sorted(groups.values(), key=lambda g: -len(g))


def _position_ids(ob):
    co = _coords(ob)
    key = {}
    vid = np.empty(len(co), dtype=np.int64)
    for i, p in enumerate(np.round(co / 1e-4).astype(np.int64)):
        vid[i] = key.setdefault(tuple(p), len(key))
    return vid


def _verts_of(ob, faces):
    return sorted({v for f in faces for v in ob.data.polygons[f].vertices})


def _subset(src, faces, name, role):
    """A new object holding exactly `faces` of `src`, material and UVs intact."""
    keep = set(faces)
    me = src.data.copy()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    bm.to_mesh(me)
    bm.free()
    ob["rl_role"] = role
    return ob


def _source():
    """`art/meshy/ugv-recon-dog-<yyyymmdd>-<id8>/model.glb` of the ledger's last
    `kind: remesh` task named `ugv_recon_dog`."""
    ledger = os.path.join(REPO, "art", "meshy", "ledger.jsonl")
    task_id = None
    with open(ledger) as fh:
        for line in fh:
            line = line.strip()
            if line:
                entry = json.loads(line)
                if entry.get("kind") == "remesh" and entry.get("name") == LEDGER_NAME:
                    task_id = entry["id"]
    if task_id is None:
        raise SystemExit(f"no kind=remesh entry named {LEDGER_NAME!r} in {ledger}")
    hits = glob.glob(os.path.join(REPO, "art", "meshy", f"{LEDGER_NAME.replace('_', '-')}-*-{task_id.split('-')[0]}",
                                  "model.glb"))
    if len(hits) != 1:
        raise SystemExit(f"expected one download dir for remesh task {task_id}, found {hits}")
    return hits[0], task_id


def _load():
    path, task_id = _source()
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before and o.type == "MESH"]
    if len(new) != 1:
        raise SystemExit(f"dog: expected one mesh object, found {[o.name for o in new]}")
    ob = new[0]
    for o in list(bpy.data.objects):
        if o.name not in before and o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    mats = [m for m in ob.data.materials if m is not None]
    if len(mats) != 1 or not mats[0].use_nodes:
        raise SystemExit(f"dog: expected one node material, found {[m.name for m in mats]}")
    tree = mats[0].node_tree
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    link = next((l for l in tree.links if bsdf is not None and l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE" or link.from_node.image is None:
        raise SystemExit("dog: Base Color is not an image -- no bake to ship")
    base = link.from_node.image
    for node in list(tree.nodes):
        if node.type == "TEX_IMAGE" and node.image is not base:
            img = node.image
            tree.nodes.remove(node)
            if img is not None and img.users == 0:
                bpy.data.images.remove(img)
    for other in list(bpy.data.images):
        if other is not base and other.users == 0:
            bpy.data.images.remove(other)
    base.name = "base_color"
    mats[0].name = "dog_material"
    if not ob.data.uv_layers:
        raise SystemExit("dog: the remesh carries no UV layer")
    log(f"source {os.path.relpath(path, REPO)} (remesh {task_id}); {len(ob.data.polygons)} tris, "
        f"base_color {base.size[0]}x{base.size[1]}")
    ob.name = "dog_src"
    return ob, mats[0], base


def _classify(src):
    """Body, legs, pads and fittings, found by measurement and each checked
    against the count it must have."""
    isl = _islands(src)
    co = _coords(src)
    info = []
    for faces in isl:
        c = co[_verts_of(src, faces)]
        info.append({"faces": faces, "min": c.min(0), "max": c.max(0), "cen": c.mean(0)})
    legs = [i for i in info if i["min"][2] < -0.7 and i["max"][2] > -0.2 and abs(i["cen"][0]) > 0.3 and abs(i["cen"][1]) > 0.15]
    pads = [i for i in info if i["max"][2] < -0.8]
    body = info[0]
    other = [i for i in info[1:] if i not in legs and i not in pads]
    if len(legs) != 4 or len(pads) != 4:
        raise SystemExit(f"dog: expected 4 legs and 4 pads, found {len(legs)} and {len(pads)}")
    size = body["max"] - body["min"]
    if size[0] < size[1]:
        raise SystemExit(f"dog: the long axis is Y {tuple(size)}, this file measured X -- look before building")
    log(f"{len(info)} pieces: body {len(body['faces'])} faces ({size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f} incl. masts), "
        f"{len(legs)} legs {[len(l['faces']) for l in legs]}, {len(pads)} pads {[len(p['faces']) for p in pads]}, "
        f"{len(other)} fittings {sum(len(o['faces']) for o in other)} faces; long axis X, front +X")

    def slot(i):
        return ("fore" if i["cen"][0] > 0 else "hind", "L" if i["cen"][1] > 0 else "R")

    leg_of = {slot(i): i for i in legs}
    pad_of = {slot(i): i for i in pads}
    if len(leg_of) != 4 or len(pad_of) != 4:
        raise SystemExit("dog: the four legs (or pads) do not fall one to a corner")
    return body, other, leg_of, pad_of


def _split_masts(src, body, cent):
    """The body island's faces above the shell, in two clusters: the REAR one
    (smaller x) is the antenna that stays, the front one is deleted."""
    vid = _position_ids(src)
    faces = body["faces"]
    top = [f for f in faces if cent[f][2] > MAST_MIN_Z]
    clusters = [c for c in _components(src.data, vid, top) if len(c) >= MAST_MIN_FACES]
    if len(clusters) != 2:
        raise SystemExit(f"dog: expected two mast clusters above z {MAST_MIN_Z}, found {[len(c) for c in clusters]}")
    clusters.sort(key=lambda c: cent[c][:, 0].mean())
    rear, front = clusters
    mast = set(rear) | set(front)
    shell = [f for f in faces if f not in mast]
    shell_top = max(cent[f][2] for f in shell)
    if shell_top >= MAST_MIN_Z:
        raise SystemExit(f"dog: a shell face reads z {shell_top:.3f}, over MAST_MIN_Z {MAST_MIN_Z}")
    log(f"masts above z {MAST_MIN_Z}: rear {len(rear)} faces at x {cent[rear][:, 0].mean():+.3f} (kept), "
        f"front {len(front)} faces at x {cent[front][:, 0].mean():+.3f} (deleted); shell top z {shell_top:.3f}")
    return shell, rear


def _joint(src, faces, lo, hi, axis, origin):
    """The centroid of the vertices of `faces` whose projection on `axis` from
    `origin` lies in [lo, hi]: Meshy packs its vertices into the joint blocks,
    so the dense band IS the joint."""
    co = _coords(src)[_verts_of(src, faces)]
    t = (co - origin) @ axis
    m = (t >= lo) & (t <= hi)
    if int(m.sum()) < 20:
        raise SystemExit(f"dog: only {int(m.sum())} vertices in the joint window [{lo}, {hi}]")
    return co[m].mean(axis=0)


# ---------------------------------------------------------------------------
# the texture: paint the stencil markings out
# ---------------------------------------------------------------------------

def _footprint(src, faces, size):
    """Boolean (h, w) mask of the texels under `faces`' UV triangles. Row 0 is
    the bottom of the image, as Blender's `pixels` has it."""
    w, h = size
    uv = src.data.uv_layers.active.data
    mask = np.zeros((h, w), dtype=bool)
    for fi in faces:
        loops = list(src.data.polygons[fi].loop_indices)
        pts = np.array([[uv[l].uv[0] * w - 0.5, uv[l].uv[1] * h - 0.5] for l in loops])
        for k in range(1, len(pts) - 1):
            a, b, c = pts[0], pts[k], pts[k + 1]
            x0, x1 = int(math.floor(min(a[0], b[0], c[0]))) - 1, int(math.ceil(max(a[0], b[0], c[0]))) + 1
            y0, y1 = int(math.floor(min(a[1], b[1], c[1]))) - 1, int(math.ceil(max(a[1], b[1], c[1]))) + 1
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
            l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
            l3 = 1.0 - l1 - l2
            eps = -0.02
            inside = (l1 >= eps) & (l2 >= eps) & (l3 >= eps)
            mask[ys[inside], xs[inside]] = True
    return mask


def _hsv_sv(rgb):
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    sat = np.where(mx > 1e-6, (mx - mn) / np.where(mx > 1e-6, mx, 1.0), 0.0)
    return sat, mx


def _paint_out(img, mask, label, fallback=None, required=False, dark=False):
    """Near-white texels under `mask` become the olive median of the olive
    texels under it (or `fallback`, the body's, when this mask has too few of
    its own). `required` refuses when there is no marking to remove -- the body
    has stencils and a bake that lost them has changed. Returns that median."""
    w, h, ch = img.size[0], img.size[1], img.channels
    px = np.empty(w * h * ch, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, ch)
    sat, val = _hsv_sv(px[:, :, :3])
    white = mask & (val >= WHITE_MIN_VALUE) & (sat <= WHITE_MAX_SAT)
    olive = mask & (sat >= OLIVE_MIN_SAT) & (val >= 0.12) & (val <= 0.6)
    if required and not int(white.sum()):
        raise SystemExit(f"dog: no near-white texel under {label} -- the bake changed; look at it")
    if dark:
        # a rubber pad: its own dark median, never the paint's olive
        keep = mask & ~white & (val <= 0.35)
        if int(keep.sum()) < 200:
            raise SystemExit(f"dog: only {int(keep.sum())} dark texels under {label}")
        median = np.median(px[keep][:, :3], axis=0)
    elif int(olive.sum()) >= OLIVE_MIN_TEXELS:
        median = np.median(px[olive][:, :3], axis=0)
    elif fallback is not None:
        median = fallback
    else:
        raise SystemExit(f"dog: only {int(olive.sum())} olive texels under {label} and no fallback")
    if int(white.sum()):
        grow = white.copy()
        for _ in range(MARK_DILATE_PX):
            g = grow.copy()
            g[1:, :] |= grow[:-1, :]
            g[:-1, :] |= grow[1:, :]
            g[:, 1:] |= grow[:, :-1]
            g[:, :-1] |= grow[:, 1:]
            grow = g
        grow &= mask
        px[grow, :3] = median
        img.pixels.foreach_set(px.ravel())
        img.update()
        painted = int(grow.sum())
    else:
        painted = 0
    log(f"{label}: {int(white.sum())} near-white texels (grown to {painted}, {100.0 * painted / max(int(mask.sum()), 1):.2f} % of "
        f"{int(mask.sum())} under it) painted the {'dark' if dark else 'olive'} median {tuple(round(float(c), 3) for c in median)} "
        f"of {int(olive.sum())} olive texels")
    return median


def _dark_texel(img):
    """(u, v) of the bake's dark gunmetal: the texel nearest the median of the
    dark, colourless texels. Deterministic."""
    w, h, ch = img.size[0], img.size[1], img.channels
    px = np.empty(w * h * ch, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, ch)[:, :, :3]
    sat, val = _hsv_sv(px)
    m = (val >= 0.10) & (val <= 0.22) & (sat <= 0.25)
    if int(m.sum()) < 1000:
        raise SystemExit(f"dog: only {int(m.sum())} dark gunmetal texels")
    med = np.median(px[m], axis=0)
    ys, xs = np.nonzero(m)
    d = np.linalg.norm(px[ys, xs] - med, axis=1)
    i = int(np.argmin(d))
    log(f"dark gunmetal texel {tuple(round(float(c), 3) for c in px[ys[i], xs[i]])} (median of {int(m.sum())})")
    return ((xs[i] + 0.5) / w, (ys[i] + 0.5) / h)


# ---------------------------------------------------------------------------
# placing the parts
# ---------------------------------------------------------------------------

def _rot_between(a, b):
    return a.normalized().rotation_difference(b.normalized()).to_matrix().to_4x4()


def _place_body(src, shell, others, rear_mast, cent):
    """The body, its waist fittings and the rear mast. The shell is squeezed to
    the spec's 0.95 x 0.36 x 0.22; the antenna keeps its length, thickened."""
    shell_obj = _subset(src, shell + [f for o in others for f in o["faces"]], "body", ROLE["body"])
    bb = _coords(shell_obj)
    mn, mx = bb.min(0), bb.max(0)
    sx = rig.DOG_BODY_LEN / (mx[0] - mn[0])
    sy = rig.DOG_BODY_WID / (mx[1] - mn[1])
    sz = rig.DOG_BODY_DEEP / (mx[2] - mn[2])
    cx, cy = (mn[0] + mx[0]) / 2.0, (mn[1] + mx[1]) / 2.0
    log(f"body: raw {mx[0] - mn[0]:.3f} x {mx[1] - mn[1]:.3f} x {mx[2] - mn[2]:.3f} -> scale ({sx:.3f}, {sy:.3f}, {sz:.3f}) "
        f"to {rig.DOG_BODY_LEN} x {rig.DOG_BODY_WID} x {rig.DOG_BODY_DEEP}, top z {rig.DOG_BODY_TOP}")
    body_m = (Matrix.Translation((0.0, 0.0, rig.DOG_BODY_TOP)) @ Matrix.Diagonal((sx, sy, sz, 1.0))
              @ Matrix.Translation((-cx, -cy, -mx[2])))
    _transform(shell_obj, body_m)

    ant = _subset(src, rear_mast, "antenna", ROLE["antenna"])
    ac = _coords(ant)
    amin, amax = ac.min(0), ac.max(0)
    height = rig.DOG_ANTENNA_TIP_Z - rig.DOG_BODY_TOP + 0.005
    s_ax = height / (amax[2] - amin[2])
    base_c = Vector(((amin[0] + amax[0]) / 2.0, (amin[1] + amax[1]) / 2.0, amin[2]))
    target = body_m @ Vector((base_c.x, base_c.y, mx[2]))
    log(f"antenna: raw {amax[2] - amin[2]:.3f} m tall at ({base_c.x:+.3f}, {base_c.y:+.3f}) -> {height:.3f} m "
        f"(axial x{s_ax:.3f}, radial x{ANTENNA_RADIAL_GAIN}), base at ({target.x:+.3f}, {target.y:+.3f}), tip z {rig.DOG_ANTENNA_TIP_Z}")
    ant_m = (Matrix.Translation((target.x, target.y, rig.DOG_BODY_TOP - 0.005))
             @ Matrix.Diagonal((ANTENNA_RADIAL_GAIN, ANTENNA_RADIAL_GAIN, s_ax, 1.0))
             @ Matrix.Translation((-base_c.x, -base_c.y, -amin[2])))
    _transform(ant, ant_m)
    return shell_obj, ant


def _place_leg(src, leg, pad, end, side, cent):
    """Cut one leg at its measured knee and stand the halves, and its pad, on
    the rig's numbers. Returns the three objects and a measurement dict."""
    faces = leg["faces"]
    co_all = _coords(src)
    verts = co_all[_verts_of(src, faces)]
    hip = verts[verts[:, 2] > HIP_MAX_Z].mean(axis=0)
    end_pt = verts[verts[:, 2] < END_MIN_Z].mean(axis=0)
    axis = (end_pt - hip)
    length = float(np.linalg.norm(axis))
    axis = axis / length
    knee = _joint(src, faces, KNEE_WINDOW[0], KNEE_WINDOW[1], axis, hip)
    t_knee = float((knee - hip) @ axis)
    fc = cent[faces]
    ft = (fc - hip) @ axis
    thigh_faces = [f for f, t in zip(faces, ft) if t < t_knee]
    lower_faces = [f for f, t in zip(faces, ft) if t >= t_knee]
    hip_v, knee_v, end_v = Vector(hip), Vector(knee), Vector(end_pt)
    raw_thigh, raw_lower = (knee_v - hip_v).length, (end_v - knee_v).length

    h = Vector(rig.dog_hip(end, side))
    _pt0, _pl0, (kx, kz) = rig._dog_rest_psi()
    k = h + Vector((kx, 0.0, kz))
    a = Vector((h.x, h.y, rig.DOG_ANKLE_Z))
    s_t = rig.DOG_THIGH / raw_thigh
    s_l = rig.DOG_LOWER / raw_lower
    m_t = (Matrix.Translation(h) @ Matrix.Scale(s_t, 4) @ _rot_between(knee_v - hip_v, k - h)
           @ Matrix.Translation(-hip_v))
    m_l = (Matrix.Translation(k) @ Matrix.Scale(s_l, 4) @ _rot_between(end_v - knee_v, a - k)
           @ Matrix.Translation(-knee_v))
    thigh = _subset(src, thigh_faces, f"{end}_thigh_{side}", ROLE["thigh"])
    lower = _subset(src, lower_faces, f"{end}_lower_{side}", ROLE["lower"])
    _transform(thigh, m_t)
    _transform(lower, m_l)

    pc = _coords(src)[_verts_of(src, pad["faces"])]
    pmn, pmx = pc.min(0), pc.max(0)
    thick = pmx[2] - pmn[2]
    s_z = rig.DOG_ANKLE_Z / thick
    s_p = DOG_PAD_DIAMETER / ((pmx[0] - pmn[0] + pmx[1] - pmn[1]) / 2.0)
    dia = DOG_PAD_DIAMETER
    foot = _subset(src, pad["faces"], f"{end}_foot_{side}", ROLE["foot"])
    m_p = (Matrix.Translation(a) @ Matrix.Diagonal((s_p, s_p, s_z, 1.0))
           @ Matrix.Translation(-Vector(((pmn[0] + pmx[0]) / 2.0, (pmn[1] + pmx[1]) / 2.0, pmx[2]))))
    _transform(foot, m_p)
    bottom = float(_coords(foot)[:, 2].min())
    # the stub bottom ends at the pad top by construction; the lower link's end vs the pad's centre:
    gap = Vector(((pmn[0] + pmx[0]) / 2.0, (pmn[1] + pmx[1]) / 2.0, pmx[2])) - end_v
    log(f"{end} {side}: raw hip->knee {raw_thigh:.3f} knee->end {raw_lower:.3f} (cut at t={t_knee:.3f} of {length:.3f}; "
        f"{len(thigh_faces)}+{len(lower_faces)} faces) -> {rig.DOG_THIGH}/{rig.DOG_LOWER} (x{s_t:.3f}/x{s_l:.3f}); "
        f"pad {thick:.3f} thick -> x{s_p:.3f} across, x{s_z:.3f} up, dia {dia:.3f}, bottom z {bottom:+.4f}, stub-to-pad offset "
        f"({gap.x:+.3f}, {gap.y:+.3f}, {gap.z:+.3f}) raw")
    return thigh, lower, foot, {"thick": thick, "dia": dia, "bottom": bottom}


def _head(mat, uv):
    """The sensor head: a box and a lens, role `face`, one uv (the bake's dark
    gunmetal) on every loop so it takes the same material as everything else."""
    bm = bmesh.new()
    s = HEAD_SIZE
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (v.co.x * s + HEAD_CENTRE_X, v.co.y * s, v.co.z * s + rig.DOG_BODY_TOP - HEAD_SINK + s / 2.0)
    lens = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=LENS_RADIUS, radius2=LENS_RADIUS, depth=LENS_PROUD * 2.0)
    rot = Matrix.Rotation(math.radians(90.0), 4, "Y")
    bmesh.ops.transform(bm, matrix=Matrix.Translation((HEAD_CENTRE_X + s / 2.0, 0.0, rig.DOG_BODY_TOP - HEAD_SINK + s / 2.0)) @ rot,
                        verts=lens["verts"])
    me = bpy.data.meshes.new("head")
    bm.to_mesh(me)
    bm.free()
    layer = me.uv_layers.new(name="UVMap")
    for d in layer.data:
        d.uv = uv
    me.materials.append(mat)
    ob = bpy.data.objects.new("head", me)
    bpy.context.collection.objects.link(ob)
    ob["rl_role"] = ROLE["head"]
    log(f"head: {HEAD_SIZE} m box at x {HEAD_CENTRE_X}, z {rig.DOG_BODY_TOP - HEAD_SINK:.2f}..{rig.DOG_BODY_TOP - HEAD_SINK + s:.2f}, "
        f"lens r {LENS_RADIUS} proud {LENS_PROUD}; {_tris(ob)} tris")
    return ob


# ---------------------------------------------------------------------------
# the collapsed copy
# ---------------------------------------------------------------------------

def _decimate(ob, ratio):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.data.validate(verbose=False)


def _copy(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    bpy.context.collection.objects.link(c)
    return c


def _ry(angle):
    return Matrix.Rotation(angle, 4, "Y")


def _about(point, rot):
    p = Vector(point)
    return Matrix.Translation(p) @ rot @ Matrix.Translation(-p)


def _collapsed(living, budget):
    """A second copy of every part, posed collapsed: legs folded (the thrown leg
    flung out), the whole thing rolled about its long axis and dropped onto the
    ground. Decimated to `budget` triangles. Returns the copies and the thrown
    leg's hip, knee and ankle in the copy's frame."""
    total = sum(_tris(ob) for ob in living.values())
    ratio = min(1.0, budget / total)
    log(f"collapsed copy: budget {budget} of {total} living tris -> decimate ratio {ratio:.3f}")
    dead = {name: _copy(ob, "d_" + name) for name, ob in living.items()}
    for ob in dead.values():
        if ratio < 1.0:
            _decimate(ob, ratio)
    pt0_unused, pl0_unused, (kx, kz) = rig._dog_rest_psi()
    thrown = {}
    for end in rig.DOG_END:
        for side in rig.DOG_SIDE:
            kind = "out" if (end, side) == rig.DOG_THROWN_LEG else "fold"
            a_t, a_l = rig.dog_pose_angles(kind)
            h = Vector(rig.dog_hip(end, side))
            k = h + Vector((kx, 0.0, kz))
            a = Vector((h.x, h.y, rig.DOG_ANKLE_Z))
            m_t = _about(h, _ry(a_t))
            k2 = m_t @ k
            m_l = _about(k2, _ry(a_l - a_t)) @ m_t
            _transform(dead[f"{end}_thigh_{side}"], m_t)
            _transform(dead[f"{end}_lower_{side}"], m_l)
            _transform(dead[f"{end}_foot_{side}"], m_l)
            if kind == "out":
                thrown = {"hip": m_t @ h, "knee": k2, "ankle": m_l @ a}
    allco = np.concatenate([_coords(ob) for ob in dead.values()])
    zc = rig.DOG_BODY_TOP - rig.DOG_BODY_DEEP / 2.0
    roll = _about((0.0, 0.0, zc), Matrix.Rotation(math.radians(rig.DOG_DEATH_ROLL_DEG), 4, "X"))
    rolled_min = min((roll @ Vector(p)).z for p in allco)
    seat = Matrix.Translation((0.0, 0.0, -rolled_min)) @ roll
    for ob in dead.values():
        _transform(ob, seat)
    final = np.concatenate([_coords(ob) for ob in dead.values()])
    log(f"collapsed copy: rolled {rig.DOG_DEATH_ROLL_DEG} deg about the long axis, seated (z {final[:, 2].min():+.4f}.."
        f"{final[:, 2].max():.3f}); {sum(_tris(ob) for ob in dead.values())} tris")
    leg = {k: tuple(seat @ v) for k, v in thrown.items()}
    return dead, leg


# ---------------------------------------------------------------------------
# the file
# ---------------------------------------------------------------------------

def _one_material_per_role(merged):
    for role, ob in merged.items():
        mats = ob.data.materials
        used = {mats[p.material_index].name if p.material_index < len(mats) and mats[p.material_index] is not None
                else None for p in ob.data.polygons}
        if len(used) != 1 or None in used:
            raise SystemExit(f"role {role!r} sits on {sorted(map(str, used))} -- every role must be on the one dog material")
    log("every role mesh sits on exactly the one dog material")


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src, mat, img = _load()
    body, others, leg_of, pad_of = _classify(src)
    cent = _face_centroids(src)
    shell, rear_mast = _split_masts(src, body, cent)

    # the texture first, before any piece is cut: the stencils are on the body's
    # UV footprint AND on the upper legs' (the "X" and the glyphs on every thigh),
    # so every island the dog is drawn from is cleaned, each to its own median
    size = tuple(img.size)
    body_faces = shell + [f for o in others for f in o["faces"]] + rear_mast
    olive = _paint_out(img, _footprint(src, body_faces, size), "body", required=True)
    for (end, side), leg in sorted(leg_of.items()):
        _paint_out(img, _footprint(src, leg["faces"], size), f"{end} {side} leg", fallback=olive)
        _paint_out(img, _footprint(src, pad_of[(end, side)]["faces"], size), f"{end} {side} pad", dark=True)
    dark_uv = _dark_texel(img)

    living = {}
    living["body"], living["antenna"] = _place_body(src, shell, others, rear_mast, cent)
    pads = {}
    for (end, side), leg in sorted(leg_of.items()):
        t, l, f, m = _place_leg(src, leg, pad_of[(end, side)], end, side, cent)
        living[f"{end}_thigh_{side}"], living[f"{end}_lower_{side}"], living[f"{end}_foot_{side}"] = t, l, f
        pads[(end, side)] = m
    living["head"] = _head(mat, dark_uv)
    bpy.data.objects.remove(src, do_unlink=True)
    living_tris = sum(_tris(ob) for ob in living.values())
    log(f"living: {len(living)} parts, {living_tris} tris")

    dead, death_leg = _collapsed(living, int((TRI_CAP - living_tris) * 0.97))
    parts = list(living.values()) + list(dead.values())
    parts, bones, forced = rig._dog_rest(parts, death_leg)

    arm_obj = rig.build_armature(bones)
    rig.rig_parts(parts, arm_obj, forced, set())
    merged = rig.join_by_role(parts)
    _one_material_per_role(merged)
    rig.build_clips(arm_obj, TEAM)
    stray = [o.name for o in bpy.data.objects if o is not arm_obj and o not in merged.values()]
    if stray:
        raise SystemExit(f"{TEAM}: objects in the scene that are neither the rig nor a role mesh: {stray}")
    for role, ob in sorted(merged.items()):
        log(f"  role {role:8s} {len(ob.data.polygons)} polys uv {'yes' if ob.data.uv_layers else 'no '}")
    tris = sum(_tris(ob) for ob in merged.values())
    if tris > TRI_CAP:
        raise SystemExit(f"{TEAM}: {tris} triangles is over the spec's cap of {TRI_CAP}")
    rig.export_glb(arm_obj, OUT_PATH, materials=True, jpeg_quality=JPEG_QUALITY)
    log(f"{TEAM}: wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), roles {sorted(merged)}, {tris} tris, "
        f"bones {len(arm_obj.data.bones)}, clips {sorted(a.name for a in bpy.data.actions)}")


if __name__ == "__main__":
    build()
