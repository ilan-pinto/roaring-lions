"""The KDF remote weapon station: the Meshy part that replaces `kit.rws`'s box
on apc_eitan, apc_kipod, ifv_namer and scout_shachaf (unit polish, item 3;
the lead's rulings of 2026-10-14).

    # 1. the part, in its own frame, plus its 512 texture slot
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/vehicles/rws_part.py -- part
    # 2. each vehicle's atlas: its own 2048 bake with the slot beside it
    python3 tools/vehicles/rws_atlas.py <out_dir> [vehicle ...]

Then `tools/src/meshes/rws-swap.ts` puts the station on each hull (no hull
re-export), and the kit pipeline re-fits the firepower track to it.

## The source

Ledger `rws_50`: preview `01a13a79` (the section-6 fallback prompt of
`_coord/unit-polish/rws-prompt.md`, the lead's accepted re-roll), refine
`01a13a7d` at 8k, remesh `01a13a83` at 1,200 triangles -- 60 credits in all.
The remesh directory is gitignored (86 MB); the copy of record is
`~/dev/roaring-lions-art-backup/rws-50-20261014-01a13a83`.

Measured on the remesh (Meshy's frame: muzzle toward -X, Z up), and checked
again on every run so a different source cannot pass silently: a domed base
disc 1.9 m across (z below -0.01), on it a small turntable hub, the heavy
machine gun along -X offset to -Y, and a box on the +Y side behind it.

## The two edits (the lead's ruling)

  1. The DOMED DISC is cut away and a thin turntable ring is built under the
     hub instead (`RING_H_M` thick, `RING_R_M` across the hub's centre), its
     uvs pinned to the bake's own darkest metal under the hub. Everything that
     stood on the disc and not on the hub went with it.
  2. The BOX stays as the cradle's motor housing, shrunk uniformly about its inner
     bottom edge until its largest side is `BOX_MAX_M` -- clearly smaller than the firepower kit's T1
     sight block (0.32 x 0.24 x 0.24 m) and T2 ammunition box (0.52 x 0.24 x
     0.36 m on the Eitan), so both still read as additions.

## Frame and scale

The part is written Z up, the barrel along +X, the hub's centre on the
origin and the ring's foot at z = 0, at the declared length of a .50 station
(`LENGTH_M`, 1.7 m muzzle to rear). Each host scales it by the proposal's
declared factor (`rws-swap.ts`). The 30 mm variant for the Namer has its
barrel lengthened to `BARREL_30_M` beyond the receiver and thickened
`BARREL_30_THICK`x about its own axis, in Blender, 0 credits.

Roles: the housing box is `plate`, everything else `metal` -- the two nodes
the hulls already carry (`turret_metal` hosts the firepower kit).

DETERMINISM: no `mathutils.noise`, no RNG; every threshold is a constant
against the source's own vertices.
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
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
SRC = os.path.join(REPO, "art", "meshy", "rws-50-20261014-01a13a83", "model.glb")
OUT = os.path.join(REPO, "art", "parts", "rws")

LENGTH_M = 1.7
DOME_TOP = -0.012            # source z: below this a face is the disc
BOX_Y = 0.10                 # source y: beyond this (and above the disc) the housing box
BOX_MAX_M = 0.22             # the shrunk box's largest side, metres at LENGTH_M (uniform scale)
RING_H_M = 0.035
RING_R_M = 0.32             # the turntable ring's radius, metres at LENGTH_M
HUB_Z = (0.10, 0.20)         # source z band of the hub (the pintle housing under the gun)
SHARD_R = 0.22               # source: a low station face further than this from the hub is a disc shard
RING_SIDES = 20
BARREL_30_M = 1.2
BARREL_30_THICK = 1.6
SLOT_PX = 512


def log(msg):
    print(f"[rws] {msg}", flush=True)


# --------------------------------------------------------------------- part

def _load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(obs) != 1:
        raise SystemExit(f"expected one mesh in {SRC}, found {len(obs)}")
    ob = obs[0]
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    return ob


def _classify(bm):
    cls = {}
    for f in bm.faces:
        c = f.calc_center_median()
        if c.z < DOME_TOP:
            cls[f.index] = "disc"
        elif c.y > BOX_Y:
            cls[f.index] = "box"
        else:
            cls[f.index] = "station"
    return cls


def _verts_of(bm, cls, name):
    out = set()
    for f in bm.faces:
        if cls[f.index] == name:
            out.update(f.verts)
    return out


def build_part():
    ob = _load()
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    co = np.array([v.co[:] for v in bm.verts])
    if not (1.8 < np.ptp(co[:, 0]) < 2.0 and co[:, 2].min() < -0.4):
        raise SystemExit("the source is not the measured RWS remesh (disc 1.9 m, below z -0.4) -- re-measure")
    cls = _classify(bm)
    counts = {k: sum(1 for v in cls.values() if v == k) for k in ("disc", "box", "station")}
    seams = [e for e in bm.edges if len({cls[f.index] for f in e.link_faces}) > 1]
    bmesh.ops.split_edges(bm, edges=seams)
    bm.faces.ensure_lookup_table()
    # the faces' classes survive the split (faces are not re-indexed by it)
    disc = [f for f in bm.faces if cls[f.index] == "disc"]
    bmesh.ops.delete(bm, geom=disc, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.faces.ensure_lookup_table()
    roles = {f.index: ("plate" if cls_after(f, bm) == "box" else "metal") for f in bm.faces}
    log(f"faces: disc {counts['disc']} (cut), box {counts['box']}, station {counts['station']}")

    # the hub: the pintle housing's own band, and the disc's shards that the
    # centre test left standing on the cut (low, and away from the hub)
    hubf = [f.calc_center_median() for f in bm.faces if roles[f.index] == "metal"
            and HUB_Z[0] <= f.calc_center_median().z <= HUB_Z[1] and f.calc_center_median().y < 0.05]
    hx = sum(c.x for c in hubf) / len(hubf)
    hy = sum(c.y for c in hubf) / len(hubf)
    shards = [f for f in bm.faces if roles[f.index] == "metal" and f.calc_center_median().z < 0.04
              and math.hypot(f.calc_center_median().x - hx, f.calc_center_median().y - hy) > SHARD_R]
    bmesh.ops.delete(bm, geom=shards, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.faces.ensure_lookup_table()
    roles = {f.index: ("plate" if cls_after(f, bm) == "box" else "metal") for f in bm.faces}
    log(f"hub ({hx:+.3f}, {hy:+.3f}) from {len(hubf)} faces; {len(shards)} disc shards removed")
    station_v = [v for f in bm.faces if roles[f.index] == "metal" for v in f.verts]
    sco = np.array([v.co[:] for v in station_v])
    muzzle_x = float(sco[:, 0].min())
    rear_x = float(max(sco[:, 0].max(), max(v.co.x for f in bm.faces if roles[f.index] == "plate" for v in f.verts)))
    length_src = rear_x - muzzle_x
    s = LENGTH_M / length_src
    r_hub = RING_R_M / s
    z0 = float(sco[:, 2].min())
    tip = sco[sco[:, 0] < muzzle_x + 0.3]
    gy, gz = float(tip[:, 1].mean()), float(tip[:, 2].mean())
    log(f"station: muzzle x {muzzle_x:+.3f}, rear x {rear_x:+.3f} ({length_src:.3f} source units -> {LENGTH_M} m, "
        f"scale {s:.4f}); hub ({hx:+.3f}, {hy:+.3f}) r {r_hub:.3f}; foot z {z0:+.3f}; barrel axis y {gy:+.3f} z {gz:+.3f}")

    # --- edit 2: the housing box shrunk about its inner bottom corner
    box_v = list({v for f in bm.faces if roles[f.index] == "plate" for v in f.verts})
    bco = np.array([v.co[:] for v in box_v])
    lo, hi = bco.min(axis=0), bco.max(axis=0)
    size_m = (hi - lo) * s
    k = np.full(3, min(1.0, BOX_MAX_M / float(size_m.max())))
    anchor = np.array([(lo[0] + hi[0]) / 2.0, lo[1], lo[2]])
    for v in box_v:
        p = np.array(v.co[:])
        v.co = Vector(anchor + (p - anchor) * k)
    log(f"box: {tuple(round(float(x), 3) for x in size_m)} m -> {tuple(round(float(x), 3) for x in size_m * k)} m "
        f"(scale {tuple(round(float(x), 3) for x in k)} about its inner bottom edge)")

    # --- edit 1: the thin ring under the hub, uvs on the darkest metal there
    uv = bm.loops.layers.uv.active
    under = [l for f in bm.faces if roles[f.index] == "metal" for l in f.loops
             if l.vert.co.z < z0 + 0.05 and math.hypot(l.vert.co.x - hx, l.vert.co.y - hy) < r_hub]
    pin = under[len(under) // 2][uv].uv.copy() if under else Vector((0.5, 0.5))
    r = r_hub
    h = RING_H_M / s
    ring = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=RING_SIDES,
                                 radius1=r, radius2=r, depth=h,
                                 matrix=Matrix.Translation((hx, hy, z0 - h / 2.0)))
    ring_faces = {f for v in ring["verts"] for f in v.link_faces}
    for f in ring_faces:
        for l in f.loops:
            l[uv].uv = pin
    bm.faces.ensure_lookup_table()
    roles = {f.index: ("metal" if f in ring_faces else roles.get(f.index, "metal")) for f in bm.faces}

    # --- frame: hub on the origin, ring foot at z 0, barrel +X, metres
    xf = (Matrix.Scale(s, 4) @ Matrix.Rotation(math.pi, 4, "Z")
          @ Matrix.Translation((-hx, -hy, -(z0 - h))))
    bmesh.ops.transform(bm, matrix=xf, verts=bm.verts)
    for f in bm.faces:
        f.smooth = False
    gun = xf @ Vector((muzzle_x, gy, gz))
    axis_y, axis_z = gun.y, gun.z
    bm.to_mesh(me)
    bm.free()
    me.update()
    if me.has_custom_normals:
        me.normals_split_custom_set([(0, 0, 0)] * len(me.loops))
    co2 = np.array([v.co[:] for v in me.vertices])
    log(f"part frame: x {co2[:, 0].min():+.3f}..{co2[:, 0].max():+.3f} y {co2[:, 1].min():+.3f}..{co2[:, 1].max():+.3f} "
        f"z {co2[:, 2].min():+.3f}..{co2[:, 2].max():+.3f} m; barrel axis y {axis_y:+.3f} z {axis_z:+.3f}; "
        f"{len(me.polygons)} faces")
    return ob, roles, {"muzzle_x": float(gun.x), "axis_y": float(axis_y), "axis_z": float(axis_z)}


def cls_after(f, bm):
    """A face's class after the split: re-derived from its centre (the split
    keeps every face whole, and the disc is gone, so this agrees with
    `_classify` on every surviving face)."""
    c = f.calc_center_median()
    return "box" if c.y > BOX_Y else "station"


def _barrel_30(ob, pts):
    """The Namer's 30 mm: every vertex forward of the receiver's front face
    stretched along +X to BARREL_30_M and thickened about the barrel axis."""
    co = np.array([v.co[:] for v in ob.data.vertices])
    ay, az = pts["axis_y"], pts["axis_z"]
    tip = pts["muzzle_x"]
    rad = np.hypot(co[:, 1] - ay, co[:, 2] - az)
    # the barrel: forward of the point, scanning back from the muzzle, where
    # the cross-section first widens past 2.5x the tip's
    tip_r = np.percentile(rad[co[:, 0] > tip - 0.1], 90)
    front = tip
    for x in np.arange(tip, co[:, 0].min(), -0.02):
        sl = rad[(co[:, 0] <= x) & (co[:, 0] > x - 0.02)]
        if len(sl) and sl.max() > 2.5 * tip_r:
            front = x
            break
    old = tip - front
    k = BARREL_30_M / old
    for v in ob.data.vertices:
        if v.co.x > front:
            v.co.x = front + (v.co.x - front) * k
            dy, dz = v.co.y - ay, v.co.z - az
            v.co.y, v.co.z = ay + dy * BARREL_30_THICK, az + dz * BARREL_30_THICK
    log(f"30 mm: barrel {old:.3f} m from x {front:+.3f} -> {BARREL_30_M} m, x{BARREL_30_THICK} thick (tip r {tip_r:.3f})")


def _remap_uv(ob):
    """Into the atlas slot: u [0.8, 1], v (Blender, bottom-up) [0.75, 1]."""
    for l in ob.data.uv_layers.active.data:
        u, v = l.uv
        l.uv = (0.8 + 0.2 * u, 0.75 + 0.25 * v)


def _split_roles(ob, roles):
    me = ob.data
    out = {}
    for role in ("metal", "plate"):
        bpy.ops.object.select_all(action="DESELECT")
        dup = ob.copy()
        dup.data = me.copy()
        bpy.context.collection.objects.link(dup)
        bm = bmesh.new()
        bm.from_mesh(dup.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if roles[f.index] != role], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(dup.data)
        bm.free()
        dup.name = dup.data.name = f"rws_{role}"
        dup["rl_role"] = role
        out[role] = dup
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def _slot_images():
    """The remesh's three maps scaled to SLOT_PX, as float arrays (H, W, 4)."""
    out = {}
    names = {"base_color": "texture_0", "normal": "normal", "metallic_roughness": "texture_0_metallic_roughness"}
    for key, name in names.items():
        img = bpy.data.images.get(name)
        if img is None:
            raise SystemExit(f"remesh has no image {name!r}: {[i.name for i in bpy.data.images]}")
        cp = img.copy()
        cp.scale(SLOT_PX, SLOT_PX)
        out[key] = np.array(cp.pixels[:], dtype=np.float32).reshape(SLOT_PX, SLOT_PX, 4)
        bpy.data.images.remove(cp)
    return out


def part():
    os.makedirs(OUT, exist_ok=True)
    ob, roles, pts = build_part()
    slots = _slot_images()
    for key, px in slots.items():
        img = bpy.data.images.new(f"slot_{key}", SLOT_PX, SLOT_PX, alpha=True)
        img.pixels = px.ravel().tolist()
        img.filepath_raw = os.path.join(OUT, f"slot_{key}.png")
        img.file_format = "PNG"
        img.save()
    variants = {}
    for name in ("rws_50", "rws_30"):
        dup = ob.copy()
        dup.data = ob.data.copy()
        bpy.context.collection.objects.link(dup)
        if name == "rws_30":
            _barrel_30(dup, pts)
        _remap_uv(dup)
        parts = _split_roles(dup, roles)
        variants[name] = parts
        bpy.ops.object.select_all(action="DESELECT")
        for o in parts.values():
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{name}.glb"), export_format="GLB",
                                  use_selection=True, export_extras=True, export_yup=True,
                                  export_apply=True, export_materials="NONE")
        tris = sum(len(p.vertices) - 2 for o in parts.values() for p in o.data.polygons)
        log(f"wrote {name}.glb: {tris} tris, roles {sorted(parts)}")
        for o in parts.values():
            o.hide_set(True)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "rws.blend"))
    with open(os.path.join(OUT, "points.json"), "w") as fh:
        json.dump({"frame": "Blender metres, Z up, barrel +X, hub on the origin, ring foot z 0, at LENGTH_M",
                   "length_m": LENGTH_M, **{k: round(v, 4) for k, v in pts.items()},
                   "slot": {"u": [0.8, 1.0], "v_blender": [0.75, 1.0], "px": SLOT_PX}}, fh, indent=2)
        fh.write("\n")


# -------------------------------------------------------------------- atlas

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv[:1] == ["part"]:
        part()
    else:
        raise SystemExit("usage: -- part   (the atlases are tools/vehicles/rws_atlas.py, under python3)")
