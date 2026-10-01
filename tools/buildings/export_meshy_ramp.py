"""Export the A3.2 ramp buildings -- `concrete`, `shanty`, `wall`, `camp` --
from their Meshy text-to-3D remeshes as TEXTURED building pairs, mesh
contract v2's BUILDINGS section (GH-185, 2026-09-30; numbers and prompts in
`docs/art/meshy-prompts-ramp.md`).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_ramp.py -- concrete [--probe]

Writes `art/meshes/buildings/<type>.glb` and `<type>_wreck.glb`. One
spec-driven module for all four (the `export_meshy_apc.py` shape on
`art/b0a-meshy`), so the second building cannot fork the first's code.

THE METHOD, per building (`RampSpec`):
  1. Import the ledger's LAST `kind: remesh` task named `unit_id` -- the
     remesh of a REFINED task, which keeps its bake (measured on B0a's
     Eitan: one `BakedMaterial`, base colour / normal / metallic-roughness
     re-baked onto fresh UVs). Rename the image wired to Base Color to
     `base_color` so `textured.prepare_textured_images` finds it.
  2. Sample the bake's luminance at every face's UV centroid. Dark VERTICAL
     faces are the openings (`export_meshy_warehouse.py`'s own signal); the
     building's FRONT is whichever of the four Blender yaws puts the most
     dark-face area on the camera half -- Blender `+X` and `-Y`, which the
     y-up glTF export turns into `+X`/`+Z`, the two elevations
     `camera.ts`'s `VIEW_DIRECTION` can see (`building_facing.py`). The
     four candidates are printed; nothing is guessed by eye.
  3. Scale ONE declared axis to the numbers table's metres
     (`dimetric.metres_per_unit`, read from the spec, never a hand-typed
     scale), ground the lowest vertex at z = 0, centre the plan on the
     origin -- the footprint anchor (`mesh-building.ts`).
  4. Split by role: `glass` = the dark-opening components on the camera half
     (so the facing gate can JUDGE the front rather than name the type
     unchecked); `roof` = the upward-facing faces in the top band; `wall` =
     the rest. Every piece keeps its UVs and therefore its material
     (`textured.split_textured_roles`).
  5. The wreck is `render_building.collapse()` on a duplicate of the same
     pieces -- the dice/punch/crush/spill maths every kit wreck already
     uses, seed-free, UV-preserving, so the rubble carries the photograph.
     No second generation.
  6. Textures at `textured.TEXTURE_PX`; export through
     `textured.gltf_kwargs`, both states, then the tri cap.

`--probe` stops after step 2 and prints the per-yaw numbers, for tuning
`GLASS_LUM_FRACTION` against a new remesh without writing anything.

DETERMINISM: no `mathutils.noise`; every threshold is a constant over the
source's own vertex and texel data, and `collapse()` hashes integers.
"""
import glob
import json
import math
import os
import sys
from dataclasses import dataclass

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as building_kit  # noqa: E402
import textured  # noqa: E402
from render_building import collapse  # noqa: E402  (main() is guarded there)

REPO = os.path.dirname(TOOLS)
MESHY_DIR = os.path.join(REPO, "art", "meshy")
OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
# Spelled out per type so `tools/src/mesh_ownership.test.ts` can read, from
# the source alone, which files this script writes.
OUT_CONCRETE = os.path.join(OUT_DIR, "concrete.glb")
OUT_CONCRETE_WRECK = os.path.join(OUT_DIR, "concrete_wreck.glb")
OUT_SHANTY = os.path.join(OUT_DIR, "shanty.glb")
OUT_SHANTY_WRECK = os.path.join(OUT_DIR, "shanty_wreck.glb")
OUT_WALL = os.path.join(OUT_DIR, "wall.glb")
OUT_WALL_WRECK = os.path.join(OUT_DIR, "wall_wreck.glb")
OUT_CAMP = os.path.join(OUT_DIR, "camp.glb")
OUT_CAMP_WRECK = os.path.join(OUT_DIR, "camp_wreck.glb")
OUTPUTS = {
    "concrete": (OUT_CONCRETE, OUT_CONCRETE_WRECK),
    "shanty": (OUT_SHANTY, OUT_SHANTY_WRECK),
    "wall": (OUT_WALL, OUT_WALL_WRECK),
    "camp": (OUT_CAMP, OUT_CAMP_WRECK),
}

#: A face is an "opening" when its bake luminance is below this fraction of
#: the mesh's own median face luminance. Relative, not absolute: each bake
#: has its own exposure, and the openings are the darkest thing on any of
#: the four (a slit window, a doorway, a shutter in shadow).
GLASS_LUM_FRACTION = 0.55
#: Faces steeper than this (|normal.z| below it) count as vertical.
VERTICAL_NZ = 0.55
#: A glass component smaller than this many faces is texture grain, not a
#: window.
GLASS_MIN_FACES = 3
#: Openings are looked for BELOW this fraction of the height -- rooftop
#: clutter (a gunmetal water tank, pipes) is dark and vertical too, and it
#: says nothing about which way the building faces.
OPENING_Z_FRACTION = 0.8
#: Upward faces above this fraction of the height are the roof.
ROOF_NZ = 0.75
ROOF_Z_FRACTION = 0.55


@dataclass(frozen=True)
class RampSpec:
    unit_id: str
    credit: str
    size_axis: str      # "x" | "y" | "z" | "plan" -- the axis scaled to size_m
    size_m: float
    glass: bool         # split openings into `glass` (a building with a front)
    face: bool          # choose the yaw by openings; False keeps the source yaw
    tri_cap: int = 20000
    glass_lum_fraction: float = GLASS_LUM_FRACTION
    #: Squash the plan's Y extent to this many metres after the uniform
    #: scale, or None. The wall's preview came back 1.5 m thick for 3 m of
    #: length ("half a metre thick" did not land); thinning it in Y alone
    #: leaves every course on the two long faces untouched.
    thin_y_m: float = None


def _credit(what):
    return (f"{what} -- AI-generated (Meshy text-to-3D preview + 2k refine + remesh), "
            "disclosed per CONTRIBUTING.md; re-oriented, re-scaled, role-split and "
            "collapsed for its wreck in Blender for Roaring Lions")


SPECS = {
    "concrete": RampSpec("concrete", _credit("Concrete structure (standing + destroyed)"),
                         size_axis="z", size_m=9.0, glass=True, face=True),
    "shanty": RampSpec("shanty", _credit("Breeze-block shed (standing + destroyed)"),
                       size_axis="z", size_m=4.2, glass=True, face=True),
    "wall": RampSpec("wall", _credit("Compound wall segment (standing + destroyed)"),
                     size_axis="x", size_m=3.0, glass=False, face=False, thin_y_m=0.6),
    "camp": RampSpec("camp", _credit("Field camp (standing + destroyed)"),
                     size_axis="plan", size_m=7.5, glass=False, face=False),
}


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


def _rename_textures(spec, ob):
    mat = ob.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next((l for l in mat.node_tree.links
                 if l.to_node.name == bsdf.name and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE":
        raise SystemExit(f"[{spec.unit_id}] Base Color is not fed by an image texture")
    base = link.from_node.image
    base.name = textured.BASE_COLOR
    for img in bpy.data.images:
        if img.name != base.name and img.name.endswith("metallic_roughness"):
            img.name = "metallic_roughness"
        elif img.name != base.name and img.name.endswith("normal"):
            img.name = "normal"
    print(f"[{spec.unit_id}] images: {[(i.name, tuple(i.size)) for i in bpy.data.images]}")
    return base


def _normals(ob):
    """Per-face unit normals from the vertex data itself (Newell), keyed by
    face index. `MeshPolygon.normal` is a cache the importer filled BEFORE the
    transform bakes below and `Mesh.update()` did not refresh it -- measured
    on the first concrete export, whose `glass` node carried faces pointing
    +Y (the hidden half) after being filtered on `normal.y < -0.5`."""
    out = {}
    vs = ob.data.vertices
    for p in ob.data.polygons:
        n = Vector((0.0, 0.0, 0.0))
        idx = p.vertices
        for i in range(len(idx)):
            a = vs[idx[i]].co
            b = vs[idx[(i + 1) % len(idx)]].co
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        out[p.index] = n.normalized() if n.length > 1e-12 else n
    return out


def _face_luminance(ob, img):
    """Per-face bake luminance at the UV centroid, keyed by face index."""
    w, h = img.size
    px = img.pixels[:]
    ch = img.channels
    uv = ob.data.uv_layers.active.data
    lum = {}
    for poly in ob.data.polygons:
        us = vs = 0.0
        for li in poly.loop_indices:
            us += uv[li].uv.x
            vs += uv[li].uv.y
        u = us / len(poly.loop_indices)
        v = vs / len(poly.loop_indices)
        x = int(min(max(u, 0.0), 0.999999) * w)
        y = int(min(max(v, 0.0), 0.999999) * h)
        i = (y * w + x) * ch
        lum[poly.index] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    return lum


def _openings(ob, lum, fraction, nrm):
    med = sorted(lum.values())[len(lum) // 2]
    cut = med * fraction
    zs = [v.co.z for v in ob.data.vertices]
    z_top = min(zs) + (max(zs) - min(zs)) * OPENING_Z_FRACTION
    dark = {p.index for p in ob.data.polygons
            if abs(nrm[p.index].z) < VERTICAL_NZ and lum[p.index] < cut and p.center.z < z_top}
    return dark, med, cut


def _yaw_scores(ob, dark, nrm):
    """Dark-face area on the camera half (Blender +X and -Y) for each of the
    four yaws about Z."""
    sides = {"+X": 0.0, "-X": 0.0, "+Y": 0.0, "-Y": 0.0}
    for p in ob.data.polygons:
        if p.index in dark:
            n = nrm[p.index]
            if n.x > 0.5:
                sides["+X"] += p.area
            elif n.x < -0.5:
                sides["-X"] += p.area
            elif n.y > 0.5:
                sides["+Y"] += p.area
            elif n.y < -0.5:
                sides["-Y"] += p.area
    print(f"[yaw] dark area per source side: { {k: round(v, 4) for k, v in sides.items()} }")
    scores = []
    for k in range(4):
        rot = Matrix.Rotation(math.radians(90.0 * k), 3, "Z")
        cam = hid = 0.0
        for p in ob.data.polygons:
            if p.index not in dark:
                continue
            n = rot @ nrm[p.index]
            if n.x > 0.5 or n.y < -0.5:
                cam += p.area
            elif n.x < -0.5 or n.y > 0.5:
                hid += p.area
        scores.append((k, cam, hid))
    return scores


def _bake(objs, matrix):
    for ob in objs:
        for v in ob.data.vertices:
            v.co = matrix @ v.co
        ob.data.update()


def _bounds(objs):
    pts = [v.co for ob in objs for v in ob.data.vertices]
    return (Vector([min(p[i] for p in pts) for i in range(3)]),
            Vector([max(p[i] for p in pts) for i in range(3)]))


def _components(ob, idx):
    """Connected components (by shared edge) among the polygons in `idx`."""
    edge_faces = {}
    for p in ob.data.polygons:
        if p.index in idx:
            for e in p.edge_keys:
                edge_faces.setdefault(e, []).append(p.index)
    seen, comps = set(), []
    polys = ob.data.polygons
    for start in idx:
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            f = stack.pop()
            comp.append(f)
            for e in polys[f].edge_keys:
                for g in edge_faces.get(e, ()):
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        comps.append(comp)
    return comps


def _split(ob, role_faces, label):
    """Duplicate `ob` once per non-empty role, keep only that role's faces."""
    out = {}
    for role, idx in role_faces.items():
        if not idx:
            continue
        if role not in building_kit.ROLES:
            raise SystemExit(f"[{label}] role {role!r} outside kit ROLES")
        copy = ob.copy()
        copy.data = ob.data.copy()
        copy.name = copy.data.name = f"{label}_{role}"
        bpy.context.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        bm.faces.ensure_lookup_table()
        doomed = [f for f in bm.faces if f.index not in idx]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(copy.data)
        bm.free()
        copy.data.update()
        out[role] = copy
        print(f"[{label}] {role}: {len(copy.data.polygons)} faces")
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def _finalize(role_objs, label):
    for role, ob in role_objs.items():
        ob.name = ob.data.name = role
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
    textured.split_textured_roles(role_objs, label)


def _tris(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


def export(unit_id, probe=False):
    spec = SPECS[unit_id]
    src, task_id = _remesh_source(unit_id)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise SystemExit(f"[{unit_id}] expected one textured mesh in {src}, found "
                         f"{[(o.name, len(o.data.materials)) for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    # Bake the importer's own transform (glTF y-up -> Blender z-up lands as a
    # rotation on the object) into the vertices, so every measure below is
    # on plain coordinates.
    _bake([ob], ob.matrix_world.copy())
    ob.matrix_world = Matrix.Identity(4)
    print(f"[{unit_id}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): "
          f"{len(ob.data.polygons)} faces")
    base = _rename_textures(spec, ob)

    lum = _face_luminance(ob, base)
    nrm = _normals(ob)
    dark, med, cut = _openings(ob, lum, spec.glass_lum_fraction, nrm)
    print(f"[{unit_id}] median face luminance {med:.3f}, opening cut {cut:.3f}: "
          f"{len(dark)} dark vertical faces of {len(lum)}")
    yaw = 0
    if spec.face:
        scores = _yaw_scores(ob, dark, nrm)
        for k, cam, hid in scores:
            print(f"[{unit_id}]   yaw {90 * k:3d}: camera-half dark area {cam:.4f}, hidden {hid:.4f}")
        # Best camera-minus-hidden margin; a tie inside 3% keeps the smaller
        # rotation, so a re-run cannot flip a symmetric building by noise.
        best = max(s[1] - s[2] for s in scores)
        yaw = min(k for k, cam, hid in scores if cam - hid >= best - 0.03 * abs(best))
        print(f"[{unit_id}] chosen yaw {90 * yaw} deg (openings toward Blender +X / -Y)")
    if probe:
        return None

    _bake([ob], Matrix.Rotation(math.radians(90.0 * yaw), 4, "Z"))
    mn, mx = _bounds([ob])
    ext = {"x": mx.x - mn.x, "y": mx.y - mn.y, "z": mx.z - mn.z}
    ext["plan"] = max(ext["x"], ext["y"])
    mpu = metres_per_unit(ext[spec.size_axis], spec.size_m)
    _bake([ob], Matrix.Scale(mpu, 4))
    mn, mx = _bounds([ob])
    if spec.thin_y_m is not None and (mx.y - mn.y) > spec.thin_y_m:
        sy = spec.thin_y_m / (mx.y - mn.y)
        _bake([ob], Matrix.Diagonal((1.0, sy, 1.0, 1.0)))
        print(f"[{unit_id}] thinned in Y by {sy:.3f} to {spec.thin_y_m} m")
        mn, mx = _bounds([ob])
    _bake([ob], Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds([ob])
    height = mx.z - mn.z
    print(f"[{unit_id}] {spec.size_axis} -> {spec.size_m} m (mpu {mpu:.5f}); "
          f"x[{mn.x:+.2f},{mx.x:+.2f}] y[{mn.y:+.2f},{mx.y:+.2f}] z[{mn.z:+.2f},{mx.z:+.2f}]")

    # Roles on the final frame (normals recomputed after the bakes).
    nrm = _normals(ob)
    glass = set()
    if spec.glass:
        # Dominant axis, not a threshold: a face angled across the +X/+Y
        # corner passes `n.x > 0.5` and is still drawn from the hidden -Z
        # view, which is what put 96 hidden pixels on the first concrete
        # export and read it `symmetric`.
        front = {i for i in dark
                 if (abs(nrm[i].x) >= abs(nrm[i].y) and nrm[i].x > 0.0)
                 or (abs(nrm[i].y) > abs(nrm[i].x) and nrm[i].y < 0.0)}
        comps = [c for c in _components(ob, front) if len(c) >= GLASS_MIN_FACES]
        glass = {i for c in comps for i in c}
        print(f"[{unit_id}] glass: {len(comps)} opening(s), {len(glass)} faces on the camera half")
    roof = {p.index for p in ob.data.polygons
            if p.index not in glass and nrm[p.index].z > ROOF_NZ and p.center.z > mn.z + height * ROOF_Z_FRACTION}
    wall = {p.index for p in ob.data.polygons if p.index not in glass and p.index not in roof}
    roles = _split(ob, {"wall": wall, "roof": roof, "glass": glass}, unit_id)

    # Wreck: duplicates of the same pieces, collapsed in place.
    wreck = {}
    for role, o in roles.items():
        c = o.copy()
        c.data = o.data.copy()
        c.name = c.data.name = f"wreck_{role}"
        bpy.context.collection.objects.link(c)
        wreck[role] = c
    bpy.context.view_layer.update()
    collapse(list(wreck.values()), 0.0, height)
    # collapse() clamps spill to the plan; re-ground in case a stub sank.
    wmn, wmx = _bounds(list(wreck.values()))
    if wmn.z != 0.0:
        _bake(list(wreck.values()), Matrix.Translation(Vector((0.0, 0.0, -wmn.z))))
    wmn, wmx = _bounds(list(wreck.values()))
    print(f"[{unit_id}] wreck bounds x[{wmn.x:+.2f},{wmx.x:+.2f}] y[{wmn.y:+.2f},{wmx.y:+.2f}] "
          f"z[{wmn.z:+.2f},{wmx.z:+.2f}], {_tris(list(wreck.values()))} tris")

    tex_px = textured.prepare_textured_images()
    print(f"[{unit_id}] shipping base_color at {tex_px[0]}x{tex_px[1]}, JPEG q{textured.JPEG_QUALITY}")
    os.makedirs(OUT_DIR, exist_ok=True)

    for state, objs, out in (("", roles, OUTPUTS[unit_id][0]), ("_wreck", wreck, OUTPUTS[unit_id][1])):
        _finalize(objs, f"{unit_id}{state}")
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs.values():
            o.select_set(True)
        kwargs = textured.gltf_kwargs(out, spec.credit)
        kwargs["use_selection"] = True
        bpy.ops.export_scene.gltf(**kwargs)
        tris = _tris(list(objs.values()))
        if tris > spec.tri_cap:
            raise SystemExit(f"[{unit_id}{state}] {tris} triangles over the cap {spec.tri_cap}")
        print(f"[{unit_id}{state}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, "
              f"roles {sorted(objs)})")
    return roles


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv or argv[0] not in SPECS:
        raise SystemExit(f"usage: -- <type> [--probe]; types: {sorted(SPECS)}")
    export(argv[0], probe="--probe" in argv)
