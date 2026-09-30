"""Export the tunnel props (GH-227, folded into WP-A3.2 / GH-185) --
`tunnel_mouth`, `tunnel_vent`, their `_collapsed` variants and `spoil_heap`
-- to `art/meshes/props/`, under the closed prop contract (zero materials,
one `rl_role` per mesh node from `PROP_ROLES`, triangles under
`PROP_TRI_CAPS`).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/terrain/export_meshy_tunnel.py

The mouth and the vent are Meshy text-to-3D previews remeshed at 400 / 200
(`art/meshy/ledger.jsonl`, `kind: remesh`, named `tunnel_mouth` /
`tunnel_vent`); the other three are made here from them and from nothing:

  - `tunnel_mouth`   the remesh, its adit opening toward +X (measured: the
                     recessed back wall's faces point +X), scaled to
                     MOUTH_ACROSS_M, one role `rust` (turned earth; the
                     timber and sheet read as the same dark band at 25 px).
  - `tunnel_vent`    the remesh, scaled to VENT_TALL_M, split by height:
                     the pipe above VENT_PIPE_Z is `metal`, the earth ring
                     below it `rust`.
  - `*_collapsed`    the same two, slumped: every vertex above the ground
                     band is pulled down to COLLAPSE_KEEP of its height and
                     nudged sideways by a hash of its own index (no
                     `mathutils.noise` -- Blender 5.2 reseeds it per
                     process), so the pile reads as caved-in rather than
                     merely shorter.
  - `spoil_heap`     a from-nothing heap of turned earth: a hemisphere of
                     SPOIL_RINGS x SPOIL_SEGS with hash-jittered radii,
                     SPOIL_ACROSS_M across and SPOIL_TALL_M tall, `rust`.

Sized against the 1.8 m figure, like every prop. Deterministic end to end;
`_hash01` is the FNV-style integer hash `render_building.py` uses.
"""
import glob
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
from dimetric import metres_per_unit  # noqa: E402

REPO = os.path.dirname(TOOLS)
MESHY_DIR = os.path.join(REPO, "art", "meshy")
OUT_DIR = os.path.join(REPO, "art", "meshes", "props")
OUT_MOUTH = os.path.join(OUT_DIR, "tunnel_mouth.glb")
OUT_MOUTH_COLLAPSED = os.path.join(OUT_DIR, "tunnel_mouth_collapsed.glb")
OUT_VENT = os.path.join(OUT_DIR, "tunnel_vent.glb")
OUT_VENT_COLLAPSED = os.path.join(OUT_DIR, "tunnel_vent_collapsed.glb")
OUT_SPOIL = os.path.join(OUT_DIR, "spoil_heap.glb")

CREDIT = (
    "Tunnel props (mouth, vent, their collapsed variants, spoil heap) -- the mouth and "
    "vent AI-generated (Meshy text-to-3D preview + remesh), disclosed per CONTRIBUTING.md, "
    "re-oriented, re-scaled and role-tagged; the collapsed variants slumped from them and "
    "the spoil heap built from primitives, in Blender, for Roaring Lions"
)

MOUTH_ACROSS_M = 2.4
VENT_TALL_M = 0.8
VENT_PIPE_Z = 0.45          # fraction of the vent's height above which it is the pipe
SPOIL_ACROSS_M = 1.6
SPOIL_TALL_M = 0.5
SPOIL_RINGS = 5
SPOIL_SEGS = 12
COLLAPSE_KEEP = 0.45        # what survives of a collapsed piece's height
COLLAPSE_SHIFT = 0.12       # sideways slump, as a fraction of the piece's width
TRI_CAPS = {"tunnel_mouth": 420, "tunnel_mouth_collapsed": 420, "tunnel_vent": 220,
            "tunnel_vent_collapsed": 220, "spoil_heap": 150}


def _hash01(*ints):
    h = 2166136261
    for v in ints:
        h ^= (int(v) & 0xFFFFFFFF)
        h = (h * 16777619) & 0xFFFFFFFF
        h ^= h >> 13
    return (h & 0xFFFFFFFF) / 4294967295.0


def _remesh_source(name):
    ledger = os.path.join(MESHY_DIR, "ledger.jsonl")
    task_id = None
    with open(ledger) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if entry.get("kind") == "remesh" and entry.get("name") == name:
                task_id = entry["id"]
    if task_id is None:
        raise SystemExit(f"[{name}] no kind=remesh entry named {name!r} in {ledger}")
    hits = glob.glob(os.path.join(MESHY_DIR, f"{name.replace('_', '-')}-*-{task_id.split('-')[0]}", "model.glb"))
    if len(hits) != 1:
        raise SystemExit(f"[{name}] expected one download dir for remesh task {task_id}, found {hits}")
    return hits[0], task_id


def _import_one(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"expected one mesh in {path}, found {[o.name for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    mw = ob.matrix_world.copy()
    for v in ob.data.vertices:
        v.co = mw @ v.co
    ob.matrix_world = Matrix.Identity(4)
    ob.data.materials.clear()
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    ob.data.update()
    return ob


def _bounds(objs):
    pts = [v.co for ob in objs for v in ob.data.vertices]
    return (Vector([min(p[i] for p in pts) for i in range(3)]),
            Vector([max(p[i] for p in pts) for i in range(3)]))


def _bake(objs, matrix):
    for ob in objs:
        for v in ob.data.vertices:
            v.co = matrix @ v.co
        ob.data.update()


def _fit(objs, axis, size_m, label):
    mn, mx = _bounds(objs)
    ext = {"x": mx.x - mn.x, "y": mx.y - mn.y, "z": mx.z - mn.z}
    mpu = metres_per_unit(ext[axis], size_m)
    _bake(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    _bake(objs, Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds(objs)
    print(f"[{label}] {axis} -> {size_m} m (mpu {mpu:.4f}); "
          f"{mx.x - mn.x:.2f} x {mx.y - mn.y:.2f} x {mx.z - mn.z:.2f} m")


def _split_by_z(ob, z_cut, low_role, high_role, label):
    out = {}
    for role, keep_high in ((low_role, False), (high_role, True)):
        copy = ob.copy()
        copy.data = ob.data.copy()
        copy.name = copy.data.name = f"{label}_{role}"
        bpy.context.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        doomed = [f for f in bm.faces if (f.calc_center_median().z > z_cut) != keep_high]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(copy.data)
        bm.free()
        copy.data.update()
        if len(copy.data.polygons) > 0:
            out[role] = copy
        else:
            bpy.data.objects.remove(copy, do_unlink=True)
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def _collapse(objs, label):
    """Slump in place: keep the ground band, pull the rest down, nudge
    sideways by a per-vertex hash."""
    mn, mx = _bounds(objs)
    h = mx.z - mn.z
    w = max(mx.x - mn.x, mx.y - mn.y)
    for oi, ob in enumerate(objs):
        for v in ob.data.vertices:
            t = (v.co.z - mn.z) / max(h, 1e-6)
            r1 = _hash01(oi * 131 + v.index, 7)
            r2 = _hash01(v.index * 31, oi + 3)
            v.co.z = mn.z + (v.co.z - mn.z) * (COLLAPSE_KEEP + 0.15 * (r1 - 0.5))
            v.co.x += COLLAPSE_SHIFT * w * t * (r1 - 0.5) * 2.0
            v.co.y += COLLAPSE_SHIFT * w * t * (r2 - 0.5) * 2.0
        ob.data.update()
    mn2, mx2 = _bounds(objs)
    if mn2.z != 0.0:
        _bake(objs, Matrix.Translation(Vector((0.0, 0.0, -mn2.z))))
    print(f"[{label}] collapsed: height {h:.2f} -> {mx2.z - mn2.z:.2f} m")


def _spoil_heap():
    """A hemisphere with hash-jittered ring radii, apex up, `rust`."""
    verts, faces = [], []
    rx = SPOIL_ACROSS_M / 2.0
    for ring in range(SPOIL_RINGS + 1):
        t = ring / SPOIL_RINGS                      # 0 apex .. 1 rim
        z = SPOIL_TALL_M * math.cos(t * math.pi / 2.0)
        r = rx * math.sin(t * math.pi / 2.0)
        if ring == 0:
            verts.append(Vector((0.0, 0.0, z)))
            continue
        for s in range(SPOIL_SEGS):
            a = 2.0 * math.pi * s / SPOIL_SEGS
            jitter = 1.0 + 0.18 * (_hash01(ring * 17, s * 23) - 0.5)
            rr = r * jitter if ring < SPOIL_RINGS else r * (1.0 + 0.08 * (_hash01(s, ring) - 0.5))
            verts.append(Vector((rr * math.cos(a), rr * math.sin(a), z if ring < SPOIL_RINGS else 0.0)))
    def idx(ring, s):
        return 1 + (ring - 1) * SPOIL_SEGS + (s % SPOIL_SEGS)
    for s in range(SPOIL_SEGS):
        faces.append((0, idx(1, s), idx(1, s + 1)))
    for ring in range(1, SPOIL_RINGS):
        for s in range(SPOIL_SEGS):
            a, b = idx(ring, s), idx(ring, s + 1)
            c, d = idx(ring + 1, s), idx(ring + 1, s + 1)
            faces.append((a, c, d))
            faces.append((a, d, b))
    me = bpy.data.meshes.new("spoil_heap")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new("spoil_heap", me)
    bpy.context.collection.objects.link(ob)
    return ob


def _export(role_objs, out_path, label):
    tris = sum(len(p.vertices) - 2 for o in role_objs.values() for p in o.data.polygons)
    if tris > TRI_CAPS[label]:
        raise SystemExit(f"[{label}] {tris} triangles over the cap {TRI_CAPS[label]}")
    for role, ob in role_objs.items():
        ob.name = ob.data.name = role
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in role_objs.values():
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_skins=False, export_animations=False, export_extras=True,
        export_materials="NONE", export_copyright=CREDIT,
    )
    mn, mx = _bounds(list(role_objs.values()))
    print(f"[{label}] wrote {out_path} ({os.path.getsize(out_path)} bytes, {tris} tris, "
          f"{mx.x - mn.x:.2f} x {mx.y - mn.y:.2f} x {mx.z - mn.z:.2f} m, roles {sorted(role_objs)})")


def export_mouth():
    src, task = _remesh_source("tunnel_mouth")
    ob = _import_one(src)
    print(f"[tunnel_mouth] source {os.path.relpath(src, REPO)} (remesh {task}): {len(ob.data.polygons)} faces")
    _fit([ob], "x", MOUTH_ACROSS_M, "tunnel_mouth")
    ob["rl_role"] = "rust"
    _export({"rust": ob}, OUT_MOUTH, "tunnel_mouth")
    # Collapsed twin from the same import, slumped.
    ob2 = _import_one(src)
    _fit([ob2], "x", MOUTH_ACROSS_M, "tunnel_mouth_collapsed")
    _collapse([ob2], "tunnel_mouth_collapsed")
    _export({"rust": ob2}, OUT_MOUTH_COLLAPSED, "tunnel_mouth_collapsed")


def export_vent():
    src, task = _remesh_source("tunnel_vent")
    for label, out, collapsed in (("tunnel_vent", OUT_VENT, False),
                                  ("tunnel_vent_collapsed", OUT_VENT_COLLAPSED, True)):
        ob = _import_one(src)
        if not collapsed:
            print(f"[tunnel_vent] source {os.path.relpath(src, REPO)} (remesh {task}): {len(ob.data.polygons)} faces")
        _fit([ob], "z", VENT_TALL_M, label)
        mn, mx = _bounds([ob])
        parts = _split_by_z(ob, mn.z + (mx.z - mn.z) * VENT_PIPE_Z, "rust", "metal", label)
        if collapsed:
            _collapse(list(parts.values()), label)
        _export(parts, out, label)


def export_spoil():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ob = _spoil_heap()
    _export({"rust": ob}, OUT_SPOIL, "spoil_heap")


if __name__ == "__main__":
    export_mouth()
    export_vent()
    export_spoil()
