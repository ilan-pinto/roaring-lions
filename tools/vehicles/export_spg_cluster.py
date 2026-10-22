"""Build the Te'o Cluster Howitzer -- `spg_cluster` (GH-709, special units P7) --
from the SHIPPED `spg_long_range.glb`, at 0 credits.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/vehicles/export_spg_cluster.py -- [--out <scratch.glb>]

Writes `art/meshes/vehicles/spg_cluster.glb` and `art/src/vehicles/spg_cluster.blend`
(the export session, bake packed). `--out` writes the GLB elsewhere and saves no
.blend (a falsification or estimate run). Then, in order:
`pnpm running-gear:meshes -- --id=spg_cluster` (the Te'o's own recipe, one shared
constant), `pnpm wreck:meshes -- --id=spg_cluster`, `pnpm damage:meshes --
--id=spg_cluster`, `pnpm encode:meshes`, `pnpm validate:meshes`. No rescale (the
Te'o has no `rescale-contract.ts` entry) and no kit (no upgrade tracks).

SOURCE: `art/meshes/vehicles/spg_long_range.glb` -- `export_meshy_spg_long_range.py`'s
cut of a Meshy text-to-3D SPG (AI-generated, disclosed per CONTRIBUTING.md;
`docs/ASSET_PROVENANCE.md`), exactly as `export_officer_armour.py` uses the Lavi:
the same bytes, the same bake, the same four live nodes and `turret_pivot`, so
the cluster gun cannot drift from the Te'o beside it. The imported wreck
(`death_root`, `WRECK_*`, the `rl_damage` copies), both clips and the running-gear
tags are deleted first: the passes rebuild them for the new geometry.

THE VARIANT (art spec unit 11, B3; numbers approved by the lead, 22 Oct 2026,
rack re-measured on the shipped Te'o and re-approved the same day):

  1. The GUN (`turret_metal`, the whole node: sleeve, tube, rails, mantlet slice
     and trunnion boss) is re-laid RIGIDLY about the trunnion to an absolute
     `ELEV_DEG` (50). The trunnion is read off the boss -- the faces the Te'o
     exporter pinned to its paint texel -- minus the boss's own 0.02 (source
     units) offset along the bore. The elevation is measured the Te'o's way
     (`bore_elevation`: the far quarter of the unique tube vertices forward of
     `barrel_probe_x` against the near quarter) and ASSERTED: 35 +- 2 before,
     50 +- 0.5 after, the after-reading taken on the same vertices once the
     rotation is baked in. The re-laid gun must still be embedded in the
     turret front (intersecting triangles, no gap over 1 cm): a re-lay about
     the wrong point, or a gun pulled off its mantlet, fails. The silhouette lever: at 35 the brake and rack alone
     read IoU 0.938 against the Te'o and fail the 0.88 gate.
  2. A double-baffle box MUZZLE BRAKE (0.62 x 0.40 x 0.30 m) replaces the tube's
     last `BRAKE_CUT` (0.25 m): a flange, a bore tube, two baffles with the side
     ports open between them, top and bottom plates. Joined into `turret_metal`,
     UV-pinned to the tube's own bake (the nearest tube face: `_pin_uv`).
  3. A rear-deck AMMUNITION RACK of carrier shells, joined into `hull_hull`:
     envelope x -2.62..-2.02, y +-1.00, z 2.39..2.79. Twelve 0.80 m cases
     (r 0.078, 12-sided, blunt fuze dome) laid ACROSS the deck in two banks
     (port and starboard), three a layer, two layers; a welded tube frame
     (r 0.025) and two tie-down straps. Frame and straps on the Te'o's gunmetal
     patch (the texel its spades use), the cases on its hull paint texel. No
     stencils, no text. ASSERTED: the deck under the whole footprint is flat
     (the approved spec's first envelope overhung the sloping rear plate by up
     to 0.9 m); the front edge clears the turret's sweep at deck height; the
     gun, traversed over the rack, clears its top.

Totals are asserted under `TRI_CAP` (46,000, the Te'o's). No new texture.
DETERMINISM: no noise of any kind; every number is a literal.
"""
import math
import os
import sys
from collections import Counter

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, TOOLS)

import textured as vehicle_textured  # noqa: E402
import bake_fix  # noqa: E402
from export_meshy_spg_long_range import SPEC as TEO  # noqa: E402 -- the Te'o's own constants

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(REPO, "art", "meshes", "vehicles", "spg_long_range.glb")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
# Spelled out so `tools/src/mesh_ownership.test.ts` can read, from the source
# alone, which file this script writes.
OUT_PATH = os.path.join(OUT_DIR, "spg_cluster.glb")
BLEND_PATH = os.path.join(REPO, "art", "src", "vehicles", "spg_cluster.blend")

# ---------------------------------------------------------------- constants
ELEV_BEFORE, ELEV_BEFORE_TOL = TEO.barrel_elev_deg, 2.0   # the Te'o ships at 35
ELEV_DEG, ELEV_TOL = 50.0, 0.5
TRI_CAP = TEO.tri_cap                                    # 46,000
BOSS_OFFSET = 0.02                                       # source units along the bore (the Te'o's `_add_dome` call)

BRAKE_CUT = 0.25                                         # metres of tube replaced
BRAKE_LEN, BRAKE_W, BRAKE_H = 0.62, 0.40, 0.30
BRAKE_BORE_R = 0.085
BRAKE_FLANGE_R, BRAKE_FLANGE_L = 0.15, 0.05

RACK_X = (-2.62, -2.02)
RACK_Y = 1.00
RACK_Z = (2.39, 2.79)
RACK_TRIS_MAX = 1400
CASE_R, CASE_LEN, CASE_SIDES = 0.078, 0.80, 12
CASE_X = (-2.49, -2.32, -2.15)                           # three a layer, 0.17 m pitch
CASE_BANK_Y = 0.55                                       # bank centres at y +-0.55: each case y 0.15..0.95
FRAME_R = 0.025
DECK_FLAT = (2.36, 2.41)                                 # every deck sample under the rack must read in here
SWEEP_CLEAR = 0.05                                       # turret sweep (at deck height) to the rack's front edge
EMBED_GAP = 0.01                                         # the gun must still meet the turret front
GUN_CLEAR = 0.05                                         # gun traversed over the rack, to the rack's top


def log(msg):
    print(f"[spg_cluster] {msg}")


# ---------------------------------------------------------------- measuring
def world_co(ob):
    return np.array([tuple(ob.matrix_world @ v.co) for v in ob.data.vertices], dtype=np.float64)


def bore_elevation(pts):
    """The Te'o exporter's `bore_elevation`, on world points already chosen:
    unique positions sorted by x, far quarter's centroid against the near
    quarter's. Degrees above the horizontal."""
    uniq = np.unique(np.round(pts, 5), axis=0)
    arr = uniq[np.argsort(uniq[:, 0])]
    q = max(len(arr) // 4, 3)
    dv = arr[-q:].mean(axis=0) - arr[:q].mean(axis=0)
    return math.degrees(math.atan2(dv[2], math.hypot(dv[0], dv[1]))), len(arr)


def paint_uv():
    w = 2048
    x, y_top = TEO.paint_texel
    return ((x + 0.5) / w, (w - 1 - y_top + 0.5) / w)


def boss_vertices(ob):
    """Indices of `turret_metal`'s vertices on faces pinned to the Te'o's paint
    texel: the trunnion boss (`export_meshy_spg_long_range._add_dome`)."""
    me = ob.data
    uv = me.uv_layers.active.data
    pu = paint_uv()
    vs = set()
    for p in me.polygons:
        if all(abs(uv[li].uv[0] - pu[0]) < 2e-4 and abs(uv[li].uv[1] - pu[1]) < 2e-4 for li in p.loop_indices):
            vs.update(p.vertices)
    if len(vs) < 100:
        raise SystemExit(f"only {len(vs)} boss vertices on the paint texel {TEO.paint_texel} -- not the shipped Te'o gun")
    return sorted(vs)


def mantlet_embed(gun, turret):
    """How the gun sits in the turret front: (gun/turret triangle pairs that
    intersect, the gun vertex nearest the turret surface in metres). A gun
    re-laid about the wrong point, or pulled out of its mantlet, stops
    intersecting the turret and opens a gap."""
    def bvh_of(o):
        return BVHTree.FromPolygons([tuple(o.matrix_world @ v.co) for v in o.data.vertices],
                                    [tuple(p.vertices) for p in o.data.polygons])
    g, t = bvh_of(gun), bvh_of(turret)
    pairs = len(g.overlap(t))
    near = min(t.find_nearest(gun.matrix_world @ v.co)[3] for v in gun.data.vertices)
    return pairs, near


def deck_top(bvh, x, y):
    hit = bvh.ray_cast(Vector((x, y, 8.0)), Vector((0.0, 0.0, -1.0)))
    return hit[0].z if hit[0] is not None else None


# ---------------------------------------------------------------- geometry
def _uv_pin(bm, faces, uv):
    layer = bm.loops.layers.uv.verify()
    for f in faces:
        for lp in f.loops:
            lp[layer].uv = uv


def _box(bm, centre, size, frame=None, bevel=0.0):
    """A closed box (full extents `size`) at `centre`; `frame` a 3x3 whose columns
    are the box's local axes. Bevelled at `bevel` (one segment) when > 0."""
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = ret["verts"]
    m = Matrix.Translation(centre)
    if frame is not None:
        m = m @ frame.to_4x4()
    m = m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    for v in verts:
        v.co = m @ v.co
    faces = {f for v in verts for f in v.link_faces}
    if bevel > 0:
        edges = list({e for f in faces for e in f.edges})
        res = bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect="EDGES", profile=0.5)
        faces |= set(res.get("faces", []))
        faces = {f for f in faces if f.is_valid}
        faces |= {f for v in res.get("verts", []) for f in v.link_faces}
    return faces


def _cyl(bm, a, b, r, sides, caps=True):
    """A cylinder of radius `r` from point `a` to point `b`."""
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    m = Matrix.Translation((a + b) / 2.0) @ rot
    ret = bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=sides, radius1=r, radius2=r,
                                depth=d.length, matrix=m)
    return {f for v in ret["verts"] for f in v.link_faces}


def build_brake(origin, axis):
    """The brake as its own object, in world space. `origin` is where the cut
    tube now ends; `axis` the unit bore direction."""
    me = bpy.data.meshes.new("brake")
    bm = bmesh.new()
    side = Vector((0.0, 1.0, 0.0))
    up = axis.cross(side).normalized() * -1.0          # perpendicular to the bore, upward
    if up.z < 0:
        up = -up
    frame = Matrix((axis, side, up)).transposed()      # columns: local x -> bore, y -> side, z -> up
    at = lambda s: origin + axis * s                    # noqa: E731
    faces = set()
    # flange where the brake meets the tube (overlaps the cut 1 cm, so no gap)
    faces |= _cyl(bm, at(-0.01), at(BRAKE_FLANGE_L), BRAKE_FLANGE_R, 24)
    # bore tube straight through, and a lip ring at the muzzle face
    faces |= _cyl(bm, at(BRAKE_FLANGE_L), at(BRAKE_LEN + 0.02), BRAKE_BORE_R, 24)
    faces |= _cyl(bm, at(BRAKE_LEN), at(BRAKE_LEN + 0.03), BRAKE_BORE_R + 0.02, 24)
    # top and bottom plates, the whole length after the flange
    plate_t = 0.03
    plate_len = BRAKE_LEN - BRAKE_FLANGE_L
    for sz in (1.0, -1.0):
        c = at(BRAKE_FLANGE_L + plate_len / 2.0) + up * sz * (BRAKE_H / 2.0 - plate_t / 2.0)
        faces |= _box(bm, c, (plate_len, BRAKE_W, plate_t), frame, bevel=0.008)
    # two baffles (rear and front), the side ports open between them and the flange
    baffle_l = 0.12
    for s0 in (BRAKE_FLANGE_L + 0.16, BRAKE_LEN - baffle_l):
        c = at(s0 + baffle_l / 2.0)
        faces |= _box(bm, c, (baffle_l, BRAKE_W, BRAKE_H - 2 * plate_t), frame, bevel=0.012)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new("brake", me)
    bpy.context.collection.objects.link(ob)
    return ob


def build_rack():
    """The rack's two parts as objects: (frame and straps, cases)."""
    x0, x1 = RACK_X
    z0, z1 = RACK_Z
    y = RACK_Y
    me_f, me_c = bpy.data.meshes.new("rack_frame"), bpy.data.meshes.new("rack_cases")
    bf, bc = bmesh.new(), bmesh.new()
    rail_z = z0 + FRAME_R
    top_z = z1 - FRAME_R
    # base and top rectangles, corner and mid posts, a centre divider between the banks
    for z in (rail_z, top_z):
        for (ax, ay), (bx, by) in (((x0 + FRAME_R, -y + FRAME_R), (x1 - FRAME_R, -y + FRAME_R)),
                                   ((x0 + FRAME_R, y - FRAME_R), (x1 - FRAME_R, y - FRAME_R)),
                                   ((x0 + FRAME_R, -y + FRAME_R), (x0 + FRAME_R, y - FRAME_R)),
                                   ((x1 - FRAME_R, -y + FRAME_R), (x1 - FRAME_R, y - FRAME_R))):
            _cyl(bf, (ax, ay, z), (bx, by, z), FRAME_R, 6, caps=False)
    for px in (x0 + FRAME_R, x1 - FRAME_R):
        for py in (-y + FRAME_R, 0.0, y - FRAME_R):
            _cyl(bf, (px, py, rail_z), (px, py, top_z), FRAME_R, 6, caps=False)
    _cyl(bf, (x0 + FRAME_R, 0.0, rail_z), (x1 - FRAME_R, 0.0, rail_z), FRAME_R, 6, caps=False)
    # two tie-down straps over the top layer, one per bank, across x
    top_case = rail_z + FRAME_R + 3 * CASE_R + CASE_R + 0.004
    for sy in (-CASE_BANK_Y, CASE_BANK_Y):
        _box(bf, Vector(((x0 + x1) / 2.0, sy, top_case + 0.004)), (x1 - x0 - 2 * FRAME_R, 0.05, 0.008))
        for sx in (x0 + FRAME_R + 0.006, x1 - FRAME_R - 0.006):
            _box(bf, Vector((sx, sy, (rail_z + top_case) / 2.0)), (0.008, 0.05, top_case - rail_z))
    # twelve cases across the deck, fuze outboard
    for layer in (0, 1):
        zc = rail_z + FRAME_R + CASE_R + layer * 2 * CASE_R
        for sy in (-1.0, 1.0):
            for xc in CASE_X:
                inner = Vector((xc, sy * (CASE_BANK_Y - CASE_LEN / 2.0), zc))
                body_end = Vector((xc, sy * (CASE_BANK_Y + CASE_LEN / 2.0 - 0.12), zc))
                _cyl(bc, inner, body_end, CASE_R, CASE_SIDES, caps=False)
                # base cap (inboard)
                ret = bmesh.ops.create_circle(bc, cap_ends=True, cap_tris=False, segments=CASE_SIDES, radius=CASE_R,
                                              matrix=Matrix.Translation(inner)
                                              @ Matrix.Rotation(math.radians(90), 4, "X"))
                # blunt fuze dome: two rings to a flat nose
                prev = None
                for k, (s, rr) in enumerate(((0.0, CASE_R), (0.07, CASE_R * 0.72), (0.12, CASE_R * 0.28))):
                    c = body_end + Vector((0.0, sy * s, 0.0))
                    ring = bmesh.ops.create_circle(bc, cap_ends=(k == 2), cap_tris=False, segments=CASE_SIDES,
                                                   radius=rr,
                                                   matrix=Matrix.Translation(c) @ Matrix.Rotation(math.radians(90), 4, "X"))
                    if prev is not None:
                        a, b = prev["verts"], ring["verts"]
                        for i in range(CASE_SIDES):
                            bc.faces.new((a[i], a[(i + 1) % CASE_SIDES], b[(i + 1) % CASE_SIDES], b[i]))
                    prev = ring
                del ret
    bmesh.ops.recalc_face_normals(bc, faces=bc.faces[:])
    bmesh.ops.recalc_face_normals(bf, faces=bf.faces[:])
    bf.to_mesh(me_f)
    bc.to_mesh(me_c)
    bf.free()
    bc.free()
    out = []
    for me in (me_f, me_c):
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.collection.objects.link(ob)
        out.append(ob)
    return out


def pin_all(ob, uv, mat, uv_name):
    layer = ob.data.uv_layers.new(name=uv_name)
    for loop in layer.data:
        loop.uv = uv
    ob.data.materials.append(mat)


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def join_into(host, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    host.select_set(True)
    bpy.context.view_layer.objects.active = host
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


# ---------------------------------------------------------------- export
def strip_passes():
    for scene in bpy.data.scenes:
        if "rl_running_gear" in scene:
            del scene["rl_running_gear"]
    for o in bpy.data.objects:
        if o.type == "MESH":
            for name in ("_RL_WHEEL", "_RL_TRACK"):
                if name in o.data.attributes:
                    o.data.attributes.remove(o.data.attributes[name])
    dead = [o for o in bpy.data.objects if o.name == "death_root" or o.name.startswith("WRECK_")]
    for o in dead:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    log(f"dropped {len(dead)} imported wreck object(s) (with the rl_damage copies), the idle/wreck clips "
        f"and the running-gear tags")


def export(out_path=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, import_scene_extras=True)
    strip_passes()
    objs = {o.name: o for o in bpy.data.objects}
    for need in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal", "turret_pivot"):
        if need not in objs:
            raise SystemExit(f"{SRC}: no object {need!r} -- not the Te'o this script was written against")
    if objs["turret_metal"].parent is not objs["turret_pivot"]:
        raise SystemExit("turret_metal is not under turret_pivot -- not the shipped Te'o")
    bpy.context.view_layer.update()
    gun, hull, turret = objs["turret_metal"], objs["hull_hull"], objs["turret_hull"]
    mat = gun.data.materials[0]
    for o in (hull, turret, objs["hull_rubber"]):
        if o.data.materials[0] is not mat:
            raise SystemExit(f"{o.name} does not share the gun's one material -- not the shipped Te'o")
    uv_name = gun.data.uv_layers.active.name
    before = {n: tri_count(objs[n]) for n in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal")}
    log(f"source {os.path.relpath(SRC, REPO)}: {sum(before.values())} tris {before}")

    # ---- the gun: measure, find the trunnion, cut the tube's end, re-lay, re-measure
    W = world_co(gun)
    probe_idx = np.where(W[:, 0] > TEO.barrel_probe_x)[0]
    e0, n0 = bore_elevation(W[probe_idx])
    log(f"bore elevation as shipped {e0:.2f} deg ({n0} unique tube vertices forward of x {TEO.barrel_probe_x})")
    if abs(e0 - ELEV_BEFORE) > ELEV_BEFORE_TOL:
        raise SystemExit(f"shipped bore reads {e0:.2f} deg, expected {ELEV_BEFORE} +- {ELEV_BEFORE_TOL}: "
                         f"not the Te'o gun this variant re-lays")
    boss = W[boss_vertices(gun)]
    centre = boss.mean(axis=0)
    mpu = (boss[:, 1].max() - boss[:, 1].min()) / 2.0 / TEO.boss_r
    axis0 = np.array([math.cos(math.radians(e0)), 0.0, math.sin(math.radians(e0))])
    trunnion = centre - axis0 * BOSS_OFFSET * mpu
    log(f"boss {len(boss)} verts, centre ({centre[0]:+.3f}, {centre[1]:+.3f}, {centre[2]:+.3f}), "
        f"{mpu:.4f} m per source unit -> trunnion ({trunnion[0]:+.3f}, {trunnion[1]:+.3f}, {trunnion[2]:+.3f})")

    # mantlet, before: the gun's rear sits embedded in the turret front (art spec B3.1)
    embed0 = mantlet_embed(gun, turret)

    # cut the last BRAKE_CUT of tube (axial, from the trunnion)
    ax = (W - trunnion) @ axis0
    a_end = float(ax.max())
    bm = bmesh.new()
    bm.from_mesh(gun.data)
    bm.verts.ensure_lookup_table()
    mw = gun.matrix_world
    inv = mw.inverted()
    cut_at = a_end - BRAKE_CUT
    doomed = [f for f in bm.faces
              if np.dot(np.array(tuple(mw @ f.calc_center_median())) - trunnion, axis0) > cut_at]
    n_cut = len(doomed)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(gun.data)
    bm.free()
    gun.data.update()
    log(f"tube cut at {cut_at:.3f} m from the trunnion (its last {BRAKE_CUT} m, {n_cut} faces)")

    # the probe set, re-chosen on the cut gun (same rule as the Te'o's probe)
    W = world_co(gun)
    probe_idx = np.where(W[:, 0] > TEO.barrel_probe_x)[0]
    e_cut, _ = bore_elevation(W[probe_idx])

    # re-lay: a pitch about the hull's lateral axis through the trunnion, baked into the mesh
    def relay(deg):
        t = Vector(trunnion.tolist())
        rot_w = Matrix.Translation(t) @ Matrix.Rotation(-math.radians(deg), 4, "Y") @ Matrix.Translation(-t)
        gun.data.transform(inv @ rot_w @ mw)
        gun.data.update()

    relay(ELEV_DEG - e_cut)
    # the tube is not perfectly straight: finish on the finished geometry, as the Te'o does
    for _ in range(4):
        e1, _n = bore_elevation(world_co(gun)[probe_idx])
        if abs(e1 - ELEV_DEG) < 0.01:
            break
        relay(ELEV_DEG - e1)
    W = world_co(gun)
    e1, n1 = bore_elevation(W[probe_idx])
    log(f"bore elevation after the re-lay {e1:.2f} deg (target {ELEV_DEG}; same {n1} vertices)")
    if abs(e1 - ELEV_DEG) > ELEV_TOL:
        raise SystemExit(f"bore reads {e1:.2f} deg after the re-lay, expected {ELEV_DEG} +- {ELEV_TOL}")
    embed1 = mantlet_embed(gun, turret)
    log(f"mantlet embed: gun x turret intersecting triangle pairs {embed0[0]} -> {embed1[0]}, "
        f"nearest gun vertex to the turret {embed0[1]:.4f} -> {embed1[1]:.4f} m")
    if embed1[0] == 0 or embed1[1] > EMBED_GAP:
        raise SystemExit(f"the re-laid gun no longer sits in the turret front: {embed1[0]} intersecting pairs, "
                         f"nearest vertex {embed1[1]:.4f} m (gap allowed {EMBED_GAP})")

    axis1 = Vector((math.cos(math.radians(e1)), 0.0, math.sin(math.radians(e1))))
    t_v = Vector(trunnion.tolist())
    origin = t_v + axis1 * cut_at
    # pin the brake to the bake of the tube face nearest the cut
    me = gun.data
    uvl = me.uv_layers.active.data
    best, bestd = None, 1e9
    for p in me.polygons:
        d = ((mw @ p.center) - origin).length
        if d < bestd:
            best, bestd = p, d
    tube_uv = tuple(np.mean([tuple(uvl[li].uv) for li in best.loop_indices], axis=0))
    brake = build_brake(origin, axis1)
    pin_all(brake, tube_uv, mat, uv_name)
    brake_tris = tri_count(brake)
    brake.matrix_world = Matrix.Identity(4)
    # the brake is built in world space; parent-correct it before the join
    brake.data.transform(mw.inverted())
    brake.matrix_world = mw
    gun = join_into(gun, [brake])
    muzzle = t_v + axis1 * (cut_at + BRAKE_LEN + 0.02)
    log(f"brake: {brake_tris} tris, UV pinned to the tube face {bestd:.3f} m from the cut "
        f"(uv {tube_uv[0]:.5f}, {tube_uv[1]:.5f}); muzzle ({muzzle.x:+.3f}, {muzzle.y:+.3f}, {muzzle.z:+.3f})")

    # ---- the rack: deck, sweep and gun clearance, then build
    hbvh = BVHTree.FromPolygons([tuple(hull.matrix_world @ v.co) for v in hull.data.vertices],
                                [tuple(p.vertices) for p in hull.data.polygons])
    samples = [deck_top(hbvh, x, yy)
               for x in np.linspace(RACK_X[0], RACK_X[1], 7) for yy in np.linspace(-RACK_Y, RACK_Y, 9)]
    lo_d = min(s if s is not None else -1.0 for s in samples)
    hi_d = max(s if s is not None else 99.0 for s in samples)
    log(f"deck under the rack ({len(samples)} samples): z {lo_d:.3f}..{hi_d:.3f}")
    if lo_d < DECK_FLAT[0] or hi_d > DECK_FLAT[1]:
        raise SystemExit(f"the rack does not sit on a flat deck: z {lo_d:.3f}..{hi_d:.3f} outside {DECK_FLAT}")
    piv = objs["turret_pivot"].matrix_world.translation
    T = world_co(turret)
    rT = np.hypot(T[:, 0] - piv.x, T[:, 1] - piv.y)
    sweep = float(rT[T[:, 2] >= RACK_Z[0] - 0.3].max())
    front_r = piv.x - RACK_X[1]      # the rack's nearest point to the pivot, on the centreline
    log(f"turret sweep at deck height {sweep:.3f} m; rack front {front_r:.3f} m from the pivot")
    if front_r < sweep + SWEEP_CLEAR:
        raise SystemExit(f"rack front {front_r:.3f} m inside the turret sweep {sweep:.3f} + {SWEEP_CLEAR}")
    G = world_co(gun)
    rG = np.hypot(G[:, 0] - piv.x, G[:, 1] - piv.y)
    gun_low = float(G[rG >= front_r, 2].min())
    log(f"gun traversed over the rack: lowest at {gun_low:.3f} m against the rack top {RACK_Z[1]}")
    if gun_low < RACK_Z[1] + GUN_CLEAR:
        raise SystemExit(f"the gun, traversed over the rack, comes down to {gun_low:.3f} m: under the rack top "
                         f"{RACK_Z[1]} + {GUN_CLEAR}")

    # texels: the hull paint (the boss's) and the gunmetal patch (the spades')
    hme = hull.data
    huv = hme.uv_layers.active.data
    spade = Counter()
    for p in hme.polygons:
        if (hull.matrix_world @ p.center).x < -3.3:
            for li in p.loop_indices:
                spade[(round(huv[li].uv[0], 5), round(huv[li].uv[1], 5))] += 1
    metal_uv, metal_n = spade.most_common(1)[0]
    img = next(i for i in bpy.data.images if i.name.startswith("base_color"))
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, img.channels)
    tx, ty = int(metal_uv[0] * w), int(metal_uv[1] * h)
    got = px[ty, tx, :3]
    want = np.array(bake_fix._hex_bytes(bake_fix.METAL_HEX), dtype=np.float32)
    log(f"gunmetal patch uv ({metal_uv[0]:.5f}, {metal_uv[1]:.5f}) from {metal_n} spade loops: texel {got.round(3)} "
        f"vs the patch {want.round(3)}")
    if np.abs(got - want).max() > 0.04:   # the bake ships as JPEG
        raise SystemExit("the spades' texel is not the painted gunmetal patch -- not the shipped Te'o bake")

    frame, cases = build_rack()
    pin_all(frame, metal_uv, mat, uv_name)
    pin_all(cases, paint_uv(), mat, uv_name)
    for p in cases.data.polygons:
        p.use_smooth = True
    rack_tris = tri_count(frame) + tri_count(cases)
    log(f"rack: frame + straps {tri_count(frame)} tris, 12 cases {tri_count(cases)} tris = {rack_tris} "
        f"(cap {RACK_TRIS_MAX}); envelope x {RACK_X} y +-{RACK_Y} z {RACK_Z}")
    if rack_tris > RACK_TRIS_MAX:
        raise SystemExit(f"rack {rack_tris} tris over its {RACK_TRIS_MAX}")
    co = np.vstack([world_co(frame), world_co(cases)])
    lo, hi = co.min(axis=0), co.max(axis=0)
    if lo[0] < RACK_X[0] - 1e-3 or hi[0] > RACK_X[1] + 1e-3 or abs(lo[1]) > RACK_Y + 1e-3 or hi[1] > RACK_Y + 1e-3 \
            or lo[2] < RACK_Z[0] - 1e-3 or hi[2] > RACK_Z[1] + 1e-3:
        raise SystemExit(f"rack geometry {lo.round(3)}..{hi.round(3)} outside its approved envelope")
    hull = join_into(hull, [frame, cases])

    objs = {o.name: o for o in bpy.data.objects}
    every = [objs[n] for n in ("hull_hull", "hull_rubber", "turret_hull", "turret_metal")]
    for ob in every:
        if len([m for m in ob.data.materials if m is not None]) != 1:
            raise SystemExit(f"{ob.name}: expected one material after the joins")
    tris = sum(tri_count(o) for o in every)
    log(f"total {tris} tris (cap {TRI_CAP}): " + ", ".join(f"{o.name} {before[o.name]} -> {tri_count(o)}" for o in every))
    if tris > TRI_CAP:
        raise SystemExit(f"{tris} triangles over the cap {TRI_CAP}")
    allco = np.vstack([world_co(o) for o in every])
    lo, hi = allco.min(axis=0), allco.max(axis=0)
    log(f"overall x[{lo[0]:+.3f},{hi[0]:+.3f}] y[{lo[1]:+.3f},{hi[1]:+.3f}] z[{lo[2]:+.3f},{hi[2]:+.3f}]")

    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, b, a in kept:
        log(f"shipping {name!r} at {a[0]}x{a[1]} (was {b[0]}x{b[1]})")
    out = out_path or OUT_PATH
    if out_path is None:
        os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
        log(f"wrote {BLEND_PATH} ({os.path.getsize(BLEND_PATH)} bytes)")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    kwargs = vehicle_textured.gltf_kwargs(
        out,
        "Te'o Cluster Howitzer (spg_cluster) -- the shipped spg_long_range.glb (AI-generated, Meshy "
        "text-to-3D, disclosed per CONTRIBUTING.md) with its gun re-laid to 50 degrees, a Blender-authored "
        "double-baffle muzzle brake and a rear-deck rack of carrier shells joined into its own nodes; "
        "ships the Te'o's own base_color bake",
    )
    kwargs["export_image_format"] = "AUTO"
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"wrote {out} ({os.path.getsize(out)} bytes)")
    verify(out, W[probe_idx])
    return out


def verify(path, probe_pts):
    """Re-read the EXPORTED file and measure it again: the node set, the triangle
    total, and the gun's elevation on the exported bytes -- the tube vertices the
    re-lay was measured on, found again by position in the written file (every
    one must be there), then `bore_elevation`. An export that wrote something
    other than what was measured fails here."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path, import_scene_extras=True)
    bpy.context.view_layer.update()
    names = sorted(o.name for o in bpy.data.objects)
    want = ["hull_hull", "hull_rubber", "turret_hull", "turret_metal", "turret_pivot"]
    if names != want:
        raise SystemExit(f"exported nodes {names}, expected {want}")
    gun = bpy.data.objects["turret_metal"]
    if gun.parent is None or gun.parent.name != "turret_pivot" or gun.get("rl_role") != "metal":
        raise SystemExit("exported turret_metal is not the metal gun under turret_pivot")
    W = world_co(gun)
    tree = BVHTree.FromPolygons([tuple(p) for p in W], [(i, i, i) for i in range(len(W))])
    found = []
    for p in probe_pts:
        loc, _n, _i, d = tree.find_nearest(Vector(tuple(p)))
        if loc is None or d > 1e-3:
            raise SystemExit(f"exported gun lacks the measured tube vertex {tuple(np.round(p, 4))}")
        found.append(tuple(loc))
    e, n = bore_elevation(np.array(found))
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    log(f"VERIFY {os.path.basename(path)}: nodes {names}; gun elevation {e:.2f} deg on the exported bytes "
        f"({n} unique tube vertices found again); {tris} tris")
    if abs(e - ELEV_DEG) > ELEV_TOL:
        raise SystemExit(f"exported gun reads {e:.2f} deg, expected {ELEV_DEG} +- {ELEV_TOL}")
    if tris > TRI_CAP:
        raise SystemExit(f"exported {tris} tris over the cap {TRI_CAP}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    export(out_path=argv[argv.index("--out") + 1] if "--out" in argv else None)
