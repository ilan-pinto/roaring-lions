"""Export the Meshy-generated Sarim swarm drone (one member) as a rigid glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/vehicles/export_meshy_swarm_drone.py

Writes `art/meshes/vehicles/drone_swarm.glb` and saves the Blender source to
`art/src/vehicles/drone_swarm.blend` -- WP-G-E6 (GH-274) chunk A1, design
`docs/superpowers/specs/2026-10-24-e6-art-design.md` §1 (the lead approved the numbers and the
Blender build, 24 Oct). Palette-painted: zero materials, roles from the vehicle six, colour
from `VEHICLE_ROLE_PALETTE['drone_swarm']`. This is ONE member's mesh: the swarm is twelve of
them, drawn by the instanced path (chunk B); until then an entity draws as one drone.

SOURCE: art/meshy/drone-swarm-20261024-01a16f7d/model.glb -- Meshy text-to-3d PREVIEW
01a16f7d-6a46-7561-ba91-482ca61d1ac3 (meshy-6, 30,000 requested, 699,224 delivered, no
material). AI-generated (Meshy), disclosed per CONTRIBUTING.md. The REMESH at 600
(01a16f80-7473-7028-ac14-f102d8baafb1) COLLAPSED -- its 48 KB model is thin booms turned to
shards, exactly the bible §3 prop failure -- and is NOT used; only its task.json and thumbnail
are tracked, for provenance. The preview is the source.

WHAT THE PREVIEW IS. After Blender's glTF import (Z up) one mesh in four loose parts:
  1. body: x +/-0.95, y +/-0.81, z -0.43..0.69 -- a stadium plate with a battery clamp and two
     knobs on top, four diagonal booms (an X frame, not the H the prompt asked for) with slots,
     four motors, FOUR leg cages hung under the motors, four three-lobed rotors, and a mast
     with a ball on top;
  2. the BOMB: a peanut slung lengthwise along X: x +/-0.70, y +/-0.19, z -0.65..-0.23;
  3., 4. two SKIDS: rods at y +/-0.43, z < -0.63.
It has no fins, and the rotors have three lobes. What the silhouette gate reads is shape, so
the levers kept are: bare rotors, no legs, no skids, a lengthwise bomb.

ORIENTATION. The bomb's long axis is X and the model is symmetric about the YZ plane (body
faces 310,724 at +X against 308,220 at -X; the bomb's two lobes read 0.207 and 0.214), so the
preview has no nose to find. +X is kept as imported: it is the bomb's axis, which is all the
brief asked for, and a swarm member is never aimed by its nose.

WHAT WAS DONE, and why it is not "decimate everything". The brief was: cut the skids, the leg
cages, the ball, the blades; decimate the rest (planar, then collapse) to 800. TWO decimation
routes were built and rendered (`_coord/e6-art/previews/drone-attempt-voxel-collapse-views.png`
is the second): collapse straight from 300k triangles tears the booms to slivers, and
voxel-remeshing first (a clean watertight solid) then cutting the plate, booms and motors
apart with exact booleans and collapsing each to its own budget (190 / 150 / 190) gave
cone-shaped motors, shard booms and a crumpled plate. At 16 px that would read as noise, and
the portrait shows it. So the body is REFIT, not decimated: every dimension below is read off
the preview's own faces (percentiles over the face centroids of each region), and the pieces
are clean primitives at those dimensions. Only the BOMB, the one smooth organic solid, is
decimated from the Meshy faces (planar, then collapse), and it survives as a peanut.
  - the skids are dropped (loose parts 3 and 4);
  - the plate: a rounded slab at the measured footprint and thickness, with the two knobs and
    the battery clamp on top and the claw bracket under the belly, each a measured box/prism;
  - the booms: a lofted box per boom, its width and its two z-lines linear-fitted along the
    boom's own axis over the preview's boom faces, running from the motor into the plate;
  - the motors: a bell and a mount at the measured radii, between the measured z-levels;
  - the leg cages are simply not rebuilt;
  - each rotor is a clean procedural two-blade rotor (`rotor_rubber`) at the measured hub with
    the measured radius (the 99.5th percentile of the preview's blade-face centroid distance).
    Thin blades collapse under decimation, which is the bible §3 lesson and how the remesh at
    600 failed;
  - the mast is a six-sided whip a third of its measured height, with no ball.
Max-detail rule: the cost is printed per part (source faces -> shipped triangles).

ROLES (node `{part}_{role}`): `hull_hull` the plate, knobs, battery and claw; `hull_metal` the
booms, motors, bomb and whip; `rotor_rubber` the four rotors. No `hull_plate`: nothing on this
preview separates cleanly as a patch plate, and the claw is one lump with the belly.

SIZE. Rotor tip to tip (the larger horizontal extent) is 0.75 m shipped: real 0.50 m x 1.5
(`SIZE_CLASS["air"]`, bible Q10, ruling A1), the real span in the provenance line. Origin on
the ground centre: the bomb's bottom at y=0, centred in x and z.

EXTRAS on the scene (GLB metres, glTF frame, y up): `rl_rotors` = [[x, y, z, r] x 4], the hub
centres and blade radius the runtime draws its blur discs from; `rl_bomb` = [x, y, z], the
bomb's centre, the release point of the dive.

No pivot; the wreck is procedural (`WRECK_RECIPES['drone_swarm'] = { hull: 'air' }`).
"""
import json
import math
import os
import struct
import sys

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit as vehicle_kit  # noqa: E402

REPO = os.path.dirname(TOOLS)
UNIT_ID = "drone_swarm"
SRC = os.path.join(REPO, "art", "meshy", "drone-swarm-20261024-01a16f7d", "model.glb")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, f"{UNIT_ID}.glb")
BLEND_PATH = os.path.join(REPO, "art", "src", "vehicles", f"{UNIT_ID}.blend")

REAL_SPAN_M = 0.50
AIR_CLASS_MULTIPLIER = 1.5          # dimetric.SIZE_CLASS["air"], baked -- bible §7 q10
SHIPPED_SPAN_M = REAL_SPAN_M * AIR_CLASS_MULTIPLIER
SHIPPED_CAP_TRIS = 800
TARGET_TRIS = (650, 780)

# --- source frame constants (Blender Z up, model units). Region cuts, measured on the preview ---
HUB_GUESS = 0.63                    # |x|, |y| of the motor axes, refined to the faces below
HUB_REFINE_R = 0.06
CAGE_R = 0.17                       # the cage's footprint about its hub
CAGE_Z = -0.215                     # below the motor mount ring
BLADE_Z = -0.035                    # the boom's top is below this; the blades are above it
MOTOR_R_CUT = 0.10                  # the motor bell: blades are outside it
BLADE_R_MAX = 0.45                  # past any blade tip, short of the plate's corners
BOOM_WINDOW_DEG = 28.0              # the boom's bearing toward the body, +/-
MAST_XY = 0.05                      # the mast and its collar, about the origin
MAST_Z0 = 0.20                      # above the plate
MAST_KEEP = 1.0 / 3.0               # of the mast's height, brief step 4
WHIP_R = 0.012
ARM_T_BINS = [0.11, 0.16, 0.21, 0.26, 0.31, 0.36, 0.41, 0.45]   # along the boom, from its hub
ARM_T_END = 0.45                    # the boom runs this far from the hub: well into the plate
BOMB_TRIS = 200
PLANAR_DEG = 8.0
# Drawn, not measured (the replacement rotor is ours): the blade's half-width and thickness
ROTOR_BLADE_THICK = 0.012
ROTOR_BLADE_HALF_W = 0.05
MOTOR_SIDES = 8
KNOB_SIDES = 8
NECK_HALF = (0.05, 0.06)             # drawn: the bracket from the claw to the bomb's waist
PRINT = print


def log(msg):
    PRINT(f"[{UNIT_ID}] {msg}")


# ----------------------------------------------------------------------------- loading


def _select(*obs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]


def _load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"expected one mesh object, found {[o.name for o in meshes]}")
    ob = meshes[0]
    _select(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.clear()
    ob.name = "src"
    return ob


def _face_arrays(ob):
    """Face centroids and the loose-part label (0 = the largest) of every face."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float64)
    area = np.array([f.calc_area() for f in bm.faces], dtype=np.float64)
    parent = list(range(len(bm.verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b:
            parent[a] = b
    lab = np.array([find(f.verts[0].index) for f in bm.faces])
    bm.free()
    roots, counts = np.unique(lab, return_counts=True)
    order = roots[np.argsort(-counts)]
    part = np.zeros(len(lab), dtype=np.int32)
    for k, r in enumerate(order):
        part[lab == r] = k
    return cent, area, part


def _keep_faces(ob, keep_mask, name):
    """A new object holding exactly the faces `keep_mask` selects."""
    _select(ob)
    bpy.ops.object.duplicate()
    piece = bpy.context.object
    piece.name = name
    piece.data.name = name
    bm = bmesh.new()
    bm.from_mesh(piece.data)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if not keep_mask[f.index]]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(piece.data)
    bm.free()
    return piece


def _tris(ob):
    return len(ob.data.polygons)


# ----------------------------------------------------------------------------- measuring


def measure_hubs(cent, part):
    hubs = []
    for sx in (1, -1):
        for sy in (1, -1):
            g = (HUB_GUESS * sx, HUB_GUESS * sy)
            m = (part == 0) & (np.hypot(cent[:, 0] - g[0], cent[:, 1] - g[1]) < HUB_REFINE_R) & (cent[:, 2] > -0.1)
            if m.sum() < 100:
                raise SystemExit(f"hub ({sx},{sy}): only {m.sum()} faces near the guess -- re-measure")
            hubs.append((float(cent[m, 0].mean()), float(cent[m, 1].mean())))
    return hubs


def _off_boom(cent, hub, deg):
    phi = np.degrees(np.arctan2(cent[:, 1] - hub[1], cent[:, 0] - hub[0]))
    toward_body = math.degrees(math.atan2(-hub[1], -hub[0]))
    return np.abs((phi - toward_body + 180.0) % 360.0 - 180.0) > deg


def blade_mask(cent, part, hub):
    d = np.hypot(cent[:, 0] - hub[0], cent[:, 1] - hub[1])
    return ((part == 0) & (cent[:, 2] > BLADE_Z) & (d > MOTOR_R_CUT) & (d < BLADE_R_MAX)
            & _off_boom(cent, hub, BOOM_WINDOW_DEG))


def cage_mask(cent, part, hub):
    d = np.hypot(cent[:, 0] - hub[0], cent[:, 1] - hub[1])
    return (part == 0) & (d < CAGE_R) & (cent[:, 2] < CAGE_Z)


def _pk(v, lo=1.0, hi=99.0):
    return float(np.percentile(v, lo)), float(np.percentile(v, hi))


def _peak_z(cent, area, mask, lo, hi):
    """The z of the area-weighted histogram's tallest 5 mm bin in [lo, hi]: a flat face's level."""
    sel = mask & (cent[:, 2] >= lo) & (cent[:, 2] < hi)
    h, e = np.histogram(cent[sel, 2], bins=np.arange(lo, hi + 0.005, 0.005), weights=area[sel])
    k = int(np.argmax(h))
    return float(0.5 * (e[k] + e[k + 1]))


def measure_arms(cent, part, hubs):
    """The boom's lofted box, linear-fitted along its own axis over the preview's boom faces.

    Returns the lateral centre/half-width and the z-lines at the hub (t=0) and at ARM_T_END,
    averaged over the four booms (they are the same boom four times; their spread is printed).
    """
    rows = []
    for h in hubs:
        hv = np.array(h)
        u = -hv / np.linalg.norm(hv)
        v = np.array([-u[1], u[0]])
        d = cent[:, :2] - hv
        t, l = d @ u, d @ v
        m = (part == 0) & (cent[:, 2] < -0.03) & (cent[:, 2] > -0.19) & (np.abs(l) < 0.12) & (t > 0.11) & (t < 0.55)
        ts, l0, l1, z0, z1 = [], [], [], [], []
        for a, b in zip(ARM_T_BINS[:-1], ARM_T_BINS[1:]):
            mm = m & (t >= a) & (t < b)
            ts.append(0.5 * (a + b))
            lo_, hi_ = _pk(l[mm], 2, 98)
            zl, zh = _pk(cent[mm, 2], 2, 98)
            l0.append(lo_), l1.append(hi_), z0.append(zl), z1.append(zh)
        fit = lambda y, at: float(np.polyval(np.polyfit(ts, y, 1), at))  # noqa: E731
        rows.append([fit(l0, 0.0), fit(l1, 0.0), fit(z0, 0.0), fit(z1, 0.0),
                     fit(l0, ARM_T_END), fit(l1, ARM_T_END), fit(z0, ARM_T_END), fit(z1, ARM_T_END)])
    rows = np.array(rows)
    mean = rows.mean(axis=0)
    spread = rows.max(axis=0) - rows.min(axis=0)
    names = ["l_lo@0", "l_hi@0", "z_lo@0", "z_hi@0", "l_lo@T", "l_hi@T", "z_lo@T", "z_hi@T"]
    log("boom fit (mean over 4, spread): " + ", ".join(f"{n} {a:+.3f}({b:.3f})" for n, a, b in zip(names, mean, spread)))
    return dict(l_lo0=mean[0], l_hi0=mean[1], z_lo0=mean[2], z_hi0=mean[3],
                l_lo1=mean[4], l_hi1=mean[5], z_lo1=mean[6], z_hi1=mean[7])


def measure_plate(cent, area, part, mast):
    """Footprint, thickness, corner radius, knobs, battery clamp and claw of the body."""
    body = (part == 0) & ~mast
    centre_x = body & (np.abs(cent[:, 1]) < 0.10) & (np.abs(cent[:, 0]) < 0.6)
    centre_y = body & (np.abs(cent[:, 0]) < 0.20)
    slab = body & (cent[:, 2] > -0.12) & (cent[:, 2] < 0.04)
    hx = _pk(np.abs(cent[slab & centre_x, 0]), 0, 99.5)[1]
    hy = _pk(np.abs(cent[slab & centre_y, 1]), 0, 99.5)[1]
    z0 = _peak_z(cent, area, body & (np.abs(cent[:, 0]) < 0.45) & (np.abs(cent[:, 1]) < 0.30), -0.16, -0.08)
    z1 = _peak_z(cent, area, body & (np.abs(cent[:, 0]) < 0.45) & (np.abs(cent[:, 1]) < 0.30), 0.0, 0.08)
    # corner radius: the plate's outline x_max(y) against a rounded rectangle
    ys = np.arange(0.10, hy - 0.01, 0.02)
    xm = []
    for y in ys:
        band = slab & (np.abs(np.abs(cent[:, 1]) - y) < 0.01) & (np.abs(cent[:, 0]) < 0.6)
        xm.append(np.percentile(np.abs(cent[band, 0]), 99) if band.sum() > 20 else np.nan)
    xm = np.array(xm)
    best = (1e9, None)
    for R in np.arange(0.04, 0.32, 0.01):
        pred = np.where(ys > hy - R, (hx - R) + np.sqrt(np.maximum(R * R - (ys - (hy - R)) ** 2, 0.0)), hx)
        err = float(np.nanmean((pred - xm) ** 2))
        if err < best[0]:
            best = (err, float(R))
    R = best[1]
    # knobs: the two round caps on the deck, either side of the clamp
    deck = body & (cent[:, 2] > z1 + 0.012) & (cent[:, 2] < 0.11) & (np.abs(cent[:, 1]) < 0.12)
    kx = _pk(np.abs(cent[deck & (np.abs(cent[:, 0]) > 0.2) & (np.abs(cent[:, 0]) < 0.45), 0]), 1, 99)
    knob_c = 0.5 * (kx[0] + kx[1])
    knob_r = 0.5 * (kx[1] - kx[0])
    knob_top = _pk(cent[deck & (np.abs(cent[:, 0]) > 0.2) & (np.abs(cent[:, 0]) < 0.45), 2], 0, 99)[1]
    # battery clamp: the block above the deck, about the mast
    bat = body & (np.abs(cent[:, 0]) < 0.16) & (np.abs(cent[:, 1]) < 0.09) & (cent[:, 2] > 0.045) & (cent[:, 2] < 0.20)
    bx = _pk(np.abs(cent[bat, 0]), 0, 99)[1]
    by = _pk(np.abs(cent[bat, 1]), 0, 99)[1]
    btop = _pk(cent[bat, 2], 0, 98)[1]
    # claw: the bracket hung under the belly
    claw = body & (cent[:, 2] < -0.17) & (np.abs(cent[:, 1]) < 0.12) & (np.abs(cent[:, 0]) < 0.25)
    cx_ = _pk(np.abs(cent[claw, 0]), 0, 99)[1]
    cy_ = _pk(np.abs(cent[claw, 1]), 0, 99)[1]
    cz0 = float(cent[claw, 2].min())
    out = dict(hx=hx, hy=hy, z0=z0, z1=z1, R=R, knob_c=knob_c, knob_r=knob_r, knob_top=knob_top,
               bx=bx, by=by, btop=btop, cx=cx_, cy=cy_, cz0=cz0)
    log("plate: " + ", ".join(f"{k} {v:.3f}" for k, v in out.items()))
    return out


def measure_motors(cent, part, hubs):
    """The motor as two stacked prisms: a mount flange (where the cage's ring was) and a column.

    Radii are percentiles of the radial distance of the preview's faces about each hub, in
    horizontal slabs, boom bearing +/-40 degrees excluded (the blades are above z=-0.07, so the
    column is read below it, where only the motor is).
    """
    flange, column = [], []
    for h in hubs:
        d = np.hypot(cent[:, 0] - h[0], cent[:, 1] - h[1])
        off = _off_boom(cent, h, 40.0) & (part == 0) & (d < 0.25)
        fl = off & (cent[:, 2] > CAGE_Z) & (cent[:, 2] < -0.13)
        co = off & (cent[:, 2] > -0.10) & (cent[:, 2] < -0.07)
        flange.append(float(np.percentile(d[fl], 75)))
        column.append(float(np.percentile(d[co], 90)))
    log(f"motors: flange radius {np.mean(flange):.3f} ({[round(x, 3) for x in flange]}), "
        f"column radius {np.mean(column):.3f} ({[round(x, 3) for x in column]})")
    return float(np.mean(flange)), float(np.mean(column))


# ----------------------------------------------------------------------------- the bomb


def _decimate(ob, modifier_type, **kw):
    _select(ob)
    mod = ob.modifiers.new(name="d", type="DECIMATE")
    mod.decimate_type = modifier_type
    for k, v in kw.items():
        setattr(mod, k, v)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _triangulate(ob):
    _select(ob)
    mod = ob.modifiers.new(name="t", type="TRIANGULATE")
    mod.quad_method = "BEAUTY"
    bpy.ops.object.modifier_apply(modifier=mod.name)


def decimate_to(ob, target, label):
    """Planar dissolve first, then collapse to `target` triangles. Prints before -> after."""
    before = _tris(ob)
    _decimate(ob, "DISSOLVE", angle_limit=math.radians(PLANAR_DEG), delimit={"NORMAL"})
    _triangulate(ob)
    mid = _tris(ob)
    ratio = min(1.0, target / max(mid, 1))
    _decimate(ob, "COLLAPSE", ratio=ratio, use_collapse_triangulate=True)
    after = _tris(ob)
    log(f"{label}: {before} -> planar {mid} -> collapse {after} tris (target {target})")
    return after


# ----------------------------------------------------------------------------- procedural parts


def _mesh_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def prism(name, pts, z0, z1):
    """A convex polygon extruded from z0 to z1 (fan caps)."""
    n = len(pts)
    verts = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    faces.append(tuple(reversed(range(n))))
    faces.append(tuple(range(n, 2 * n)))
    return _mesh_object(name, verts, faces)


def circle_pts(cx, cy, r, sides, phase=0.0):
    return [(cx + r * math.cos(phase + 2 * math.pi * i / sides), cy + r * math.sin(phase + 2 * math.pi * i / sides))
            for i in range(sides)]


def rounded_rect_pts(hx, hy, radius, segs=2):
    """A rounded rectangle, counter-clockwise, `segs` arcs per corner (segs+1 points each)."""
    pts = []
    for (sx, sy, a0) in ((1, 1, 0.0), (-1, 1, 90.0), (-1, -1, 180.0), (1, -1, 270.0)):
        cx, cy = sx * (hx - radius), sy * (hy - radius)
        for k in range(segs + 1):
            a = math.radians(a0 + 90.0 * k / segs)
            pts.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    return pts


def box(name, x0, x1, y0, y1, z0, z1):
    return prism(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1)


def boom_object(name, hub, fit):
    """A lofted box from the motor (t=0) to ARM_T_END along the bearing toward the body."""
    hv = np.array(hub)
    u = -hv / np.linalg.norm(hv)
    v = np.array([-u[1], u[0]])
    verts = []
    for t, (l0, l1, z0, z1) in ((0.0, (fit["l_lo0"], fit["l_hi0"], fit["z_lo0"], fit["z_hi0"])),
                                (ARM_T_END, (fit["l_lo1"], fit["l_hi1"], fit["z_lo1"], fit["z_hi1"]))):
        for l in (l0, l1):
            for z in (z0, z1):
                p = hv + u * t + v * l
                verts.append((p[0], p[1], z))
    # index = station*4 + il*2 + iz
    def vi(st, il, iz):
        return st * 4 + il * 2 + iz
    q = [(vi(0, 0, 1), vi(0, 1, 1), vi(1, 1, 1), vi(1, 0, 1)),
         (vi(0, 0, 0), vi(1, 0, 0), vi(1, 1, 0), vi(0, 1, 0)),
         (vi(0, 0, 0), vi(0, 0, 1), vi(1, 0, 1), vi(1, 0, 0)),
         (vi(0, 1, 0), vi(1, 1, 0), vi(1, 1, 1), vi(0, 1, 1)),
         (vi(0, 0, 0), vi(0, 1, 0), vi(0, 1, 1), vi(0, 0, 1)),
         (vi(1, 0, 0), vi(1, 0, 1), vi(1, 1, 1), vi(1, 1, 0))]
    return _mesh_object(name, verts, q)


def rotor_object(name, hub, z, radius, angle):
    """A two-blade rotor: two tapered, thin slabs along one axis through the hub."""
    verts, faces = [], []
    ca, sa = math.cos(angle), math.sin(angle)
    for sign in (1.0, -1.0):
        base = len(verts)
        for (u, hw) in ((0.0, ROTOR_BLADE_HALF_W), (radius, ROTOR_BLADE_HALF_W * 0.7)):
            for v in (-hw, hw):
                for w in (0.0, ROTOR_BLADE_THICK):
                    uu = sign * u
                    verts.append((hub[0] + uu * ca - v * sa, hub[1] + uu * sa + v * ca, z + w))

        def vi(st, iv, iw):
            return base + st * 4 + iv * 2 + iw
        quads = [(vi(0, 0, 1), vi(0, 1, 1), vi(1, 1, 1), vi(1, 0, 1)),
                 (vi(0, 0, 0), vi(1, 0, 0), vi(1, 1, 0), vi(0, 1, 0)),
                 (vi(0, 0, 0), vi(0, 0, 1), vi(1, 0, 1), vi(1, 0, 0)),
                 (vi(0, 1, 0), vi(1, 1, 0), vi(1, 1, 1), vi(0, 1, 1)),
                 (vi(1, 0, 0), vi(1, 0, 1), vi(1, 1, 1), vi(1, 1, 0)),
                 (vi(0, 0, 0), vi(0, 1, 0), vi(0, 1, 1), vi(0, 0, 1))]
        faces += quads
    return _mesh_object(name, verts, faces)


# ----------------------------------------------------------------------------- build


def _scene_extras_to_glb(path, extras):
    """Write `extras` onto scenes[0] of a finished GLB (Blender cannot hold list-of-list props)."""
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, _length = struct.unpack("<III", data[:12])
    jlen, jtype = struct.unpack("<II", data[12:20])
    assert jtype == 0x4E4F534A
    gj = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    scene = gj["scenes"][gj.get("scene", 0)]
    scene.setdefault("extras", {}).update(extras)
    blob = json.dumps(gj, separators=(",", ":")).encode()
    blob += b" " * ((4 - len(blob) % 4) % 4)
    out = struct.pack("<III", magic, version, 12 + 8 + len(blob) + len(rest))
    out += struct.pack("<II", len(blob), 0x4E4F534A) + blob + rest
    with open(path, "wb") as fh:
        fh.write(out)


def _join(objs, name):
    _select(*objs)
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    return ob


def build():
    """Returns `info` holding the three role objects (model units, source frame)."""
    src = _load()
    cent, area, part = _face_arrays(src)
    sizes = np.bincount(part)
    log(f"source {len(cent)} tris; loose parts {sizes.tolist()[:6]}")
    if len(sizes) != 4:
        raise SystemExit(f"expected four loose parts, found {len(sizes)}")

    hubs = measure_hubs(cent, part)
    # the four are one motor four times: their spread (<= 3 mm) is the preview's, not the drone's
    hx = float(np.mean([abs(h[0]) for h in hubs]))
    hy = float(np.mean([abs(h[1]) for h in hubs]))
    hubs = [(math.copysign(hx, h[0]), math.copysign(hy, h[1])) for h in hubs]
    log("hubs (model units): " + ", ".join(f"({x:.3f},{y:.3f})" for x, y in hubs))

    # rotor radius per hub: the farthest blade face centroid; motor top; whip height
    radii, bl_all, cg_all = [], np.zeros(len(cent), dtype=bool), np.zeros(len(cent), dtype=bool)
    for h in hubs:
        bm_ = blade_mask(cent, part, h)
        d = np.hypot(cent[bm_, 0] - h[0], cent[bm_, 1] - h[1])
        radii.append(float(np.percentile(d, 99.5)))
        bl_all |= bm_
        cg_all |= cage_mask(cent, part, h)
    rotor_r = float(np.mean(radii))
    motor_top = float(np.mean([cent[(part == 0) & (np.hypot(cent[:, 0] - h[0], cent[:, 1] - h[1]) < 0.05), 2].max()
                               for h in hubs]))
    rotor_z = motor_top - 0.5 * ROTOR_BLADE_THICK    # the blade sits on the bell's top
    log(f"blade faces {int(bl_all.sum())}, cage faces {int(cg_all.sum())}; blade radius {rotor_r:.3f} "
        f"(per hub {[round(r, 3) for r in radii]}); motor top z {motor_top:.3f}")

    mast = (part == 0) & (np.hypot(cent[:, 0], cent[:, 1]) < MAST_XY) & (cent[:, 2] > MAST_Z0)
    mast_top = float(cent[mast, 2].max())
    whip_top = MAST_Z0 + (mast_top - MAST_Z0) * MAST_KEEP
    log(f"mast faces {int(mast.sum())}, z {MAST_Z0}..{mast_top:.3f}; whip to z {whip_top:.3f}")
    log(f"cut: skids {int((part >= 2).sum())}, cages {int(cg_all.sum())}, blades {int(bl_all.sum())}, "
        f"mast {int(mast.sum())}; the body is refit from the other {int(((part == 0) & ~bl_all & ~cg_all & ~mast).sum())} faces")

    arms = measure_arms(cent, part, hubs)
    plate = measure_plate(cent, area, part, mast)
    flange_r, column_r = measure_motors(cent, part, hubs)

    # ---- the bomb: the one part decimated from Meshy's own faces
    bomb = _keep_faces(src, part == 1, "bomb")
    bco = np.array([tuple(v.co) for v in bomb.data.vertices])
    blo, bhi = bco.min(axis=0), bco.max(axis=0)
    left, right = bco[bco[:, 0] < 0], bco[bco[:, 0] > 0]
    bc = 0.5 * (blo + bhi)
    log(f"bomb x {blo[0]:.3f}..{bhi[0]:.3f}, z {blo[2]:.3f}..{bhi[2]:.3f}; lobe radii "
        f"-X {np.hypot(left[:, 1], left[:, 2] - bc[2]).max():.3f} / +X {np.hypot(right[:, 1], right[:, 2] - bc[2]).max():.3f}")
    bpy.data.objects.remove(src, do_unlink=True)
    decimate_to(bomb, BOMB_TRIS, "bomb")

    # ---- hull: plate, knobs, battery clamp, claw
    hull = [prism("plate", rounded_rect_pts(plate["hx"], plate["hy"], plate["R"]), plate["z0"], plate["z1"])]
    for sx in (1, -1):
        hull.append(prism(f"knob{sx}", circle_pts(sx * plate["knob_c"], 0.0, plate["knob_r"], KNOB_SIDES),
                          plate["z1"] - 0.005, plate["knob_top"]))
    hull.append(box("battery", -plate["bx"], plate["bx"], -plate["by"], plate["by"], plate["z1"] - 0.005, plate["btop"]))
    hull.append(box("claw", -plate["cx"], plate["cx"], -plate["cy"], plate["cy"], plate["cz0"], plate["z0"] + 0.005))
    # the preview leaves the bomb hanging 0.09 below the claw's bottom at its waist: a neck joins them
    waist_top = float(bco[np.abs(bco[:, 0]) < 0.08, 2].max())
    log(f"bomb waist top z {waist_top:.3f}; claw bottom {plate['cz0']:.3f}: neck bracket {plate['cz0'] - waist_top:.3f} long")
    hull.append(box("neck", -NECK_HALF[0], NECK_HALF[0], -NECK_HALF[1], NECK_HALF[1], waist_top - 0.012, plate["cz0"] + 0.005))
    # ---- metal: booms, motors, whip (the bomb joins in finish)
    metal = []
    for k, h in enumerate(hubs):
        metal.append(boom_object(f"boom{k}", h, arms))
        metal.append(prism(f"flange{k}", circle_pts(h[0], h[1], flange_r, MOTOR_SIDES, math.pi / MOTOR_SIDES),
                           CAGE_Z + 0.015, -0.13))
        metal.append(prism(f"column{k}", circle_pts(h[0], h[1], column_r, MOTOR_SIDES, math.pi / MOTOR_SIDES),
                           -0.13, motor_top))
    metal.append(prism("whip", circle_pts(0.0, 0.0, WHIP_R, 6), plate["btop"] - 0.02, whip_top))
    metal.append(bomb)
    # ---- rubber: the four rotors, blades a quarter turn off the boom so the tips read as the span
    rubber = []
    for k, h in enumerate(hubs):
        toward = math.atan2(-h[1], -h[0])
        rubber.append(rotor_object(f"rotor{k}", h, rotor_z, rotor_r, toward + math.pi / 2))
    bpy.context.view_layer.update()
    return dict(hull=hull, metal=metal, rubber=rubber, hubs=hubs, rotor_r=rotor_r, rotor_z=rotor_z,
                bomb_centre=tuple(bc))


def finish(info):
    pieces = {
        "hull": _join(info["hull"], "hull_hull"),
        "metal": _join(info["metal"], "hull_metal"),
        "rubber": _join(info["rubber"], "rotor_rubber"),
    }
    allv = np.array([tuple(v.co) for ob in pieces.values() for v in ob.data.vertices])
    ext = allv.max(axis=0) - allv.min(axis=0)
    span = max(ext[0], ext[1])
    mpu = SHIPPED_SPAN_M / span
    log(f"extent x {ext[0]:.3f} y {ext[1]:.3f} z {ext[2]:.3f} model units; span {span:.3f} -> "
        f"{SHIPPED_SPAN_M:.3f} m shipped ({REAL_SPAN_M} m real x {AIR_CLASS_MULTIPLIER}); {mpu:.5f} m/unit")
    for ob in pieces.values():
        ob.scale = (mpu, mpu, mpu)
    _select(*pieces.values())
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    allv = np.array([tuple(v.co) for ob in pieces.values() for v in ob.data.vertices])
    # origin: the bomb's bottom on the ground, centred in x and y (glTF z)
    zmin = allv[:, 2].min()
    cx = 0.5 * (allv[:, 0].max() + allv[:, 0].min())
    cy = 0.5 * (allv[:, 1].max() + allv[:, 1].min())
    for ob in pieces.values():
        ob.location = (-cx, -cy, -zmin)
    _select(*pieces.values())
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    for role, ob in pieces.items():
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES")
        ob["rl_role"] = role
        ob["rl_part"] = "rotor" if role == "rubber" else "hull"
        ob.name = "rotor_rubber" if role == "rubber" else f"hull_{role}"
        ob.data.name = ob.name
        _triangulate(ob)
        for p in ob.data.polygons:
            p.use_smooth = False

    s = mpu
    rotors = []
    for (hx, hy) in info["hubs"]:
        rotors.append([round(float(hx * s - cx), 5), round(float((info["rotor_z"] + 0.5 * ROTOR_BLADE_THICK) * s - zmin), 5),
                       round(float(-(hy * s - cy)), 5), round(float(info["rotor_r"] * s), 5)])         # glTF frame
    bc = info["bomb_centre"]
    bomb = [round(float(bc[0] * s - cx), 5), round(float(bc[2] * s - zmin), 5), round(float(-(bc[1] * s - cy)), 5)]
    info.update(rotors_glb=rotors, bomb_glb=bomb, mpu=mpu)
    return pieces


def report(pieces):
    total = 0
    for ob in pieces.values():
        n = _tris(ob)
        total += n
        log(f"node {ob.name}: {n} tris")
    lo = [min(v.co[i] for ob in pieces.values() for v in ob.data.vertices) for i in range(3)]
    hi = [max(v.co[i] for ob in pieces.values() for v in ob.data.vertices) for i in range(3)]
    log(f"final bounds (m, Blender Z up): x {lo[0]:.3f}..{hi[0]:.3f}  y {lo[1]:.3f}..{hi[1]:.3f}  "
        f"z {lo[2]:.3f}..{hi[2]:.3f}; {total} tris (cap {SHIPPED_CAP_TRIS}, aim {TARGET_TRIS[0]}-{TARGET_TRIS[1]})")
    return total


def export():
    info = build()
    pieces = finish(info)
    total = report(pieces)
    if total > SHIPPED_CAP_TRIS:
        raise SystemExit(f"[{UNIT_ID}] {total} tris over the {SHIPPED_CAP_TRIS} cap -- trim before shipping")
    if not (TARGET_TRIS[0] <= total <= TARGET_TRIS[1]):
        log(f"WARNING: {total} tris outside the aim {TARGET_TRIS}")

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, copy=True)
    log(f"saved {BLEND_PATH}")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=(
            "Sarim swarm drone -- AI-generated base (Meshy text-to-3d preview, refit in Blender; "
            "task 01a16f7d-6a46-7561-ba91-482ca61d1ac3), disclosed per CONTRIBUTING.md; "
            "palette-painted at runtime, real span 0.50 m shipped at x1.5"
        ),
    )
    _scene_extras_to_glb(OUT_PATH, {"rl_rotors": info["rotors_glb"], "rl_bomb": info["bomb_glb"]})
    log(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes); rl_rotors {info['rotors_glb']}; rl_bomb {info['bomb_glb']}")
    return OUT_PATH


if __name__ == "__main__":
    export()
