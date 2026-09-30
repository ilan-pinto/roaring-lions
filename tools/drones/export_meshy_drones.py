"""Export the two Meshy-generated KDF drones as palette-painted vehicle GLBs,
mesh contract v2 -- batch B0a of GH-286 (`docs/art/style-bible.md` section 6,
`docs/art/meshy-prompts-units.md` sections 1 and 2).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/drones/export_meshy_drones.py [-- --only recon_drone]

Writes `art/meshes/vehicles/recon_drone.glb` and
`art/meshes/vehicles/attack_drone.glb`.

SOURCES. One Meshy text-to-3D preview per drone (meshy-6, 30k-tri budget),
remeshed by Meshy at the bible's drone target of 800 triangles
(`style-bible.md` section 3: "remesh at the target in Meshy; Blender trims at
most ~10%"). The remesh source is looked up from `art/meshy/ledger.jsonl` by
the task's `name`, the same way `tools/terrain/export_meshy_props.py` does,
because each drone has TWO directories under `art/meshy/` (the preview and the
remesh) and only the ledger says which is the shipped one. Both AI-generated
(Meshy), disclosed per CONTRIBUTING.md; task ids in `docs/ASSET_PROVENANCE.md`.

  recon_drone   preview 01a0f268-0a89-7526-8e24-baaf0187f64b
                remesh  01a0f26b-176a-75a8-a73c-2b5cffb3a701  (797 tris)
  attack_drone  preview 01a0f26b-85b1-77c6-8b52-db4616992ff2
                remesh  01a0f26d-a93b-758f-87a0-631462cd6617  (734 tris)

SIZE -- the x1.5 is baked in, and it comes from `dimetric.SIZE_CLASS`. The
sprite sheets draw air units at `SIZE_CLASS["air"]` (1.5) so a 0.9 m drone is
as clickable as a soldier; a vehicle GLB is scaled by `MESH_SCALE` only, with
no class multiplier (`mesh-vehicle.ts`). The lead's ruling on PR #290 is to
bake the x1.5 into the drone GLBs rather than add an air multiplier to the
mesh path, so the shipped recon drone is 0.9 x 1.5 = 1.35 m across and the
attack drone 1.05 x 1.5 = 1.575 m long. The multiplier is READ from
`SIZE_CLASS["air"]`, never typed here, so the bible's "size is compressed only
through SIZE_CLASS" still holds in the one place that matters: change the
class and both drones follow. The real metres are the sprite manifests' own
`realMetres` (`DRONE_RECON`, `DRONE_ATTACK`), read at export time for the same
reason `export_mesh_vehicle.py` reads a manifest rather than a literal.

ORIENTATION, measured rather than assumed (2026-09-30, on the remesh):

  recon_drone   body's horizontal principal axis is Y (88 deg); the camera
                ball -- a ROUND blob in a top-down map of everything hanging
                below the body floor, against the flat battery box at the
                other end -- sits at y = -0.37, so the nose is -Y. Rz(+90).
  attack_drone  principal axis X; the radial extent tapers to 0.12 at -X (the
                nose pod) and opens to 0.55 at +X (the cross tail), so the
                nose is -X. Rz(180).

THE ATTACK DRONE'S WING IS CUT HERE, and the reason is recorded rather than
hidden. The prompt asked for "a blunt cylindrical fuselage with a tapered
sensor pod on the nose and a small cross-shaped tail of four fins"; the
preview delivered all of that AND a large swept delta wing at mid-body, which
is exactly the silhouette `meshy-prompts-units.md` section 2 says must not
happen (it is the Sarim `loiter_drone`'s plan, and the gate reads alpha only).
The batch rules put a re-roll in the lead's hands, and the bible's own rule is
"a wrong preview is fixed in Blender", so the wing is removed here: it is one
planar structure, measured on the 734-triangle remesh as the 35 faces that
touch any vertex with |y| > 0.2 inside x < 0.7 and z > -0.1 (the landing
skids sit below z = -0.17 and the tail fins beyond x = 0.75, so neither
qualifies), and the slit it leaves in the fuselage is closed with
`bmesh.ops.holes_fill`. If the lead prefers a re-rolled wingless preview, this
script's `CUT` entry simply goes away.

ROLES. One remeshed mesh per drone, split by face-centroid geometry into the
vehicle vocabulary (`tools/vehicles/kit.py` ROLES), the split named in the
numbers tables:

  recon_drone   metal  rotors, motor tops and prop guards: r > 0.50 from the
                       body centre AND z > 0.16 (the arms sit at z 0.00-0.15;
                       the body's own end panels reach r 0.45 and stay hull)
                glass  the camera ball: within 0.17 of its measured centre
                       (0.00, -0.37, -0.13) and below z = -0.09
                hull   everything else -- body, arms, landing legs
  attack_drone  glass  the nose sensor lens: the forward 8% of the length
                metal  the nose pod behind it (x < -0.55), the cross tail and
                       propeller (x > 0.72), and the skids (z < -0.16)
                hull   the fuselage

Each role is ONE object named `hull_<role>` -- `{part}_{role}` per contract v2,
all `hull_` because nothing on a drone traverses: no `turret_pivot`, and no
`rotor_pivot` either (a file carries exactly one and a quadcopter has four;
static rotors read fine at 26 px -- `meshy-prompts-units.md` section 1).

DETERMINISM. Nothing here calls `mathutils.noise`; every threshold is a
constant applied to the source's own vertex data.
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
sys.path.insert(0, os.path.join(TOOLS, "vehicles"))

from dimetric import SIZE_CLASS, metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

REPO = os.path.dirname(TOOLS)
MESHY_DIR = os.path.join(REPO, "art", "meshy")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set(_argv[_argv.index("--only") + 1].split(",")) if "--only" in _argv else None

#: The bible's shipped cap for a drone (section 3).
TRI_CAP = 1000


def _credit(unit_id):
    return (
        f"{unit_id} -- AI-generated (Meshy text-to-3D preview + remesh), disclosed per "
        "CONTRIBUTING.md; re-oriented, re-scaled and role-split for Roaring Lions"
    )


def _remesh_source(name):
    """`art/meshy/<slug>-<yyyymmdd>-<id8>/model.glb` for the ledger's
    `kind: remesh` entry named `name` -- the ledger, not a glob over the
    slug, decides which of a drone's two directories is current."""
    ledger = os.path.join(MESHY_DIR, "ledger.jsonl")
    with open(ledger) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if entry.get("kind") == "remesh" and entry.get("name") == name:
                task_id = entry["id"]
                # Slug AND id prefix: the CLI names a directory by the first
                # eight hex digits of the task id, and two tasks submitted in
                # the same minute can share them (recon's remesh and attack's
                # preview both start 01a0f26b -- observed 2026-09-30).
                slug = name.replace("_", "-")
                hits = glob.glob(os.path.join(MESHY_DIR, f"{slug}-*-{task_id.split('-')[0]}", "model.glb"))
                if len(hits) != 1:
                    raise SystemExit(f"[{name}] expected one download dir for remesh task {task_id}, found {hits}")
                return hits[0], task_id
    raise SystemExit(f"[{name}] no kind=remesh entry named {name!r} in {ledger}")


def _read_real_metres(sheet):
    with open(os.path.join(REPO, "assets", "sprites", sheet, "manifest.json")) as fh:
        return json.load(fh)["realMetres"]


# ---------------------------------------------------------------------------
# Per-drone classification, in the SOURCE frame (before the Z rotation), on
# face centroids. Each returns a role from `vehicle_kit.ROLES`.
# ---------------------------------------------------------------------------
RECON_BODY_CENTRE = (-0.017, -0.013)
RECON_BALL_CENTRE = (0.0, -0.372, -0.127)


def _classify_recon(c):
    r = math.hypot(c.x - RECON_BODY_CENTRE[0], c.y - RECON_BODY_CENTRE[1])
    if r > 0.50 and c.z > 0.16:
        return "metal"
    if c.z < -0.09 and (Vector(RECON_BALL_CENTRE) - c).length < 0.17:
        return "glass"
    return "hull"


ATTACK_NOSE_X = -0.892  # measured x-min of the remesh, the nose tip


def _classify_attack(c):
    if c.x < ATTACK_NOSE_X + 0.08 * 1.786:
        return "glass"
    if c.x < -0.55 or c.x > 0.72 or c.z < -0.16:
        return "metal"
    return "hull"


def _attack_wing_face(face):
    return any(abs(v.co.y) > 0.2 and v.co.x < 0.7 and v.co.z > -0.1 for v in face.verts)


SPECS = {
    "recon_drone": dict(
        sheet="DRONE_RECON", rot_z_deg=90.0, classify=_classify_recon, cut=None, axis="horizontal",
    ),
    "attack_drone": dict(
        sheet="DRONE_ATTACK", rot_z_deg=180.0, classify=_classify_attack, cut=_attack_wing_face, axis="x",
    ),
}


def _clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _weld(ob, label):
    """Merge the vertices Meshy's remesh splits along its UV seams (the attack
    source has 1,424 vertices for 734 faces). A palette-path GLB carries no
    UVs, so nothing is lost, and without it the surface is not closed: every
    seam is a boundary edge, and `holes_fill` cannot tell a wing-root slit
    from a seam (measured: 1,333 boundary edges and 4 fill faces before this
    step, the slit left open)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{label}] welded {before} -> {len(ob.data.vertices)} vertices")


def _cut_faces(ob, predicate, label):
    """Delete every face `predicate` accepts and close the holes it leaves.
    Runs after `_weld`, so the only boundary loops left are real holes."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    doomed = [f for f in bm.faces if predicate(f)]
    before = len(bm.faces)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    open_edges = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.holes_fill(bm, edges=open_edges, sides=0)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{label}] cut {len(doomed)} faces of {before}, closed {len(open_edges)} boundary edges, "
          f"now {len(ob.data.polygons)} faces")


def _split_by_role(ob, classify, label):
    """One new object per role, each holding the faces whose centroid
    `classify` sends there. Built from scratch (`from_pydata`) so the result
    carries nothing but positions and faces -- no UVs, no custom normals, no
    material, which is what a palette-path GLB wants."""
    me = ob.data
    buckets = {}
    for p in me.polygons:
        c = Vector((0.0, 0.0, 0.0))
        for i in p.vertices:
            c += me.vertices[i].co
        c /= len(p.vertices)
        role = classify(c)
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"[{label}] classify returned {role!r}, outside {vehicle_kit.ROLES}")
        buckets.setdefault(role, []).append(tuple(p.vertices))
    out = {}
    for role, faces in buckets.items():
        used = sorted({i for f in faces for i in f})
        remap = {old: new for new, old in enumerate(used)}
        verts = [tuple(me.vertices[i].co) for i in used]
        new_faces = [tuple(remap[i] for i in f) for f in faces]
        new_me = bpy.data.meshes.new(f"hull_{role}")
        new_me.from_pydata(verts, [], new_faces)
        new_me.validate()
        new_me.update()
        new_ob = bpy.data.objects.new(f"hull_{role}", new_me)
        new_ob["rl_role"] = role
        bpy.context.collection.objects.link(new_ob)
        out[role] = new_ob
        print(f"[{label}] hull_{role}: {len(new_faces)} faces")
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def _bake_transform(objs, matrix):
    for ob in objs:
        for v in ob.data.vertices:
            v.co = matrix @ v.co
        ob.data.update()


def _bounds(objs):
    pts = [v.co for ob in objs for v in ob.data.vertices]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    return mn, mx


def export_one(unit_id):
    spec = SPECS[unit_id]
    src, task_id = _remesh_source(unit_id)
    _clear_scene()
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"[{unit_id}] expected one mesh in {src}, found {[o.name for o in meshes]}")
    ob = meshes[0]
    if ob.data.materials:
        raise SystemExit(f"[{unit_id}] remesh source unexpectedly carries a material")
    print(f"[{unit_id}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): "
          f"{len(ob.data.polygons)} faces")

    _weld(ob, unit_id)
    if spec["cut"] is not None:
        _cut_faces(ob, spec["cut"], unit_id)

    parts = _split_by_role(ob, spec["classify"], unit_id)
    objs = list(parts.values())

    # Rotation first (the classification above was written in the source
    # frame), then scale, then ground and centre -- all baked into the verts,
    # object transforms stay identity (contract: "object scale always 1").
    _bake_transform(objs, Matrix.Rotation(math.radians(spec["rot_z_deg"]), 4, "Z"))

    mn, mx = _bounds(objs)
    size = mx - mn
    extent = size.x if spec["axis"] == "x" else max(size.x, size.y)
    real = _read_real_metres(spec["sheet"])
    drawn = real * SIZE_CLASS["air"]
    mpu = metres_per_unit(extent, drawn)
    _bake_transform(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    centre = Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))
    _bake_transform(objs, Matrix.Translation(-centre))
    mn, mx = _bounds(objs)
    print(f"[{unit_id}] real {real:.3f} m x SIZE_CLASS[air] {SIZE_CLASS['air']} = {drawn:.3f} m drawn; "
          f"mpu {mpu:.5f}; final bounds x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] "
          f"z[{mn.z:+.3f},{mx.z:+.3f}]")

    tris = sum(len(p.vertices) - 2 for ob in objs for p in ob.data.polygons)
    if tris > TRI_CAP:
        raise SystemExit(f"[{unit_id}] {tris} triangles over the drone cap {TRI_CAP}")

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{unit_id}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=_credit(unit_id),
    )
    print(f"[{unit_id}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, roles {sorted(parts)})")


if __name__ == "__main__":
    for unit_id in SPECS:
        if ONLY is None or unit_id in ONLY:
            export_one(unit_id)
