"""How far a team's worn kit stands off the body it is worn on, and how its weapon devices seat: the READING behind
`tools/test_inf_kit_standoff.py` (GH-826, infantry upgrade unit 1; the Opus review of 13 Nov 2026).

    blender -b --factory-startup -P tools/inf_kit_standoff.py -- <team.glb> <out.json>

Reads a shipped team GLB (kit grafted in: the packed `kit_uniform` / `kit_weapon` nodes and their `_RL_KIT` attribute).
Per figure:
  * `belt`, `groin`: every vertex of the battle belt / the groin apron, its distance to the nearest point of the `uniform`
    mesh, at the first frame of `idle` (the stance the garage shows): median, 90th percentile and maximum, metres;
  * `foregrip`: the smallest distance from a foregrip vertex to that figure's own gun (the `weapon` mesh's triangles on its
    bones), in the rest pose: a grip that hangs under the handguard reads its air gap;
  * `carrier` (round 3): the same reading as the belt's for the carrier's wall, and the count of its vertices over 50 mm off;
  * `headset` (round 3): the ear cups' centroid against the middle of the man's own face (`below_face_mid`, metres: a cup
    at the neck reads its drop), and `gun_pairs`: the most gun triangles crossing headset triangles in any sampled frame
    of the aimed clips (the stock's comb through the firing-side cup at the cheek weld).
This tool only reads; the limits live in the test. It asks nothing of the fitter (no `inf_kit` import): a figure's parts
are found by the graft's own tags. No mathutils.noise.
"""
import json
import sys

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")


def posed(ob):
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = e.to_mesh()
    co = [ob.matrix_world @ v.co for v in me.vertices]
    e.to_mesh_clear()
    return co


def dominant(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    return [names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "" for v in ob.data.vertices]


def tagged(ob):
    """(parts, per-vertex part index) of a packed kit node."""
    parts = [dict(p) for p in ob["rl_kit"]["parts"]]
    att = ob.data.attributes["_RL_KIT"]
    if att.domain != "POINT":
        raise SystemExit(f"{ob.name}: _RL_KIT is on {att.domain}, not POINT")
    return parts, [d.value for d in att.data]


res = {}
U, W = bpy.data.objects["uniform"], bpy.data.objects["weapon"]
KU, KW = bpy.data.objects["kit_uniform"], bpy.data.objects["kit_weapon"]
pu, vu = tagged(KU)
pw, vw = tagged(KW)
figures = sorted({p["figure"] for p in pu})

act = bpy.data.actions["idle"]
rig.animation_data_create()
rig.animation_data.action = act
try:
    rig.animation_data.action_slot = act.slots[0]
except Exception:
    pass
bpy.context.scene.frame_set(int(act.frame_range[0]))
bpy.context.view_layer.update()
uco = posed(U)
body = BVHTree.FromPolygons(uco, [tuple(p.vertices) for p in U.data.polygons])
kco = posed(KU)
for f in figures:
    res[f] = {}
    for key in ("battle_belt", "groin"):
        ids = [i for i, p in enumerate(pu) if p["figure"] == f and p["part"] == key]
        if len(ids) != 1:
            raise SystemExit(f"{f}: {len(ids)} `{key}` parts in kit_uniform")
        d = np.array(sorted(body.find_nearest(kco[v])[3] for v, pv in enumerate(vu) if pv == ids[0]))
        if len(d) < 20:
            raise SystemExit(f"{f}: `{key}` has {len(d)} vertices: not read")
        res[f]["belt" if key == "battle_belt" else key] = dict(n=int(len(d)), median=round(float(np.median(d)), 4),
                                                              p90=round(float(d[int(0.9 * len(d))]), 4), max=round(float(d[-1]), 4))
    # round 3 (GH-826): the carrier's wall off the body, the same reading
    ids = [i for i, p in enumerate(pu) if p["figure"] == f and p["part"] == "carrier"]
    if len(ids) != 1:
        raise SystemExit(f"{f}: {len(ids)} `carrier` parts in kit_uniform")
    d = np.array(sorted(body.find_nearest(kco[v])[3] for v, pv in enumerate(vu) if pv == ids[0]))
    if len(d) < 200:
        raise SystemExit(f"{f}: the carrier has {len(d)} vertices: not read")
    res[f]["carrier"] = dict(n=int(len(d)), median=round(float(np.median(d)), 4), p90=round(float(d[int(0.9 * len(d))]), 4),
                             max=round(float(d[-1]), 4), over_50mm=int((d > 0.05).sum()))

# round 3: the ear cups. Where they hang (their centroid against the middle of the man's own face, first frame of idle),
# and whether his gun runs through one at the cheek weld (gun triangles crossing headset triangles, the worst sampled
# frame of the aimed clips: every second frame, and the last).
kwco = posed(KW)          # the headset rides in the packed `kit_weapon` node (the graft's own split)
F = bpy.data.objects["face"]
fd = dominant(F)
fco = posed(F)
wd0 = dominant(W)
kpolys = [tuple(p.vertices) for p in KW.data.polygons]
AIMED = [c for c in ("fire", "moveFire", "kneel", "kneelOut", "pinned") if c in bpy.data.actions]
for f in figures:
    hs = {i for i, p in enumerate(pw) if p["figure"] == f and p["part"] == "headset"}
    if not hs:
        continue
    hv = [v for v, pv in enumerate(vw) if pv in hs]
    fz = [fco[i].z for i, d_ in enumerate(fd) if d_.startswith(f + "_")]
    if len(hv) < 50 or len(fz) < 50:
        raise SystemExit(f"{f}: {len(hv)} headset vertices, {len(fz)} face vertices: not read")
    cz = float(np.mean([kwco[v].z for v in hv]))
    res[f]["headset"] = dict(n=len(hv), centre_z=round(cz, 4), face_mid_z=round(0.5 * (min(fz) + max(fz)), 4),
                             below_face_mid=round(0.5 * (min(fz) + max(fz)) - cz, 4), gun_pairs=0, frames=0)
hs_tris = {}
for f in figures:
    if "headset" in res[f]:
        ids_ = {j for j, p in enumerate(pw) if p["figure"] == f and p["part"] == "headset"}
        hs_tris[f] = [t for t in kpolys if all(vw[i] in ids_ for i in t)]
gun_tris = {f: [tuple(p.vertices) for p in W.data.polygons if all(wd0[i].startswith(f + "_") for i in p.vertices)] for f in hs_tris}
for clip in AIMED:
    a_ = bpy.data.actions[clip]
    rig.animation_data.action = a_
    try:
        rig.animation_data.action_slot = a_.slots[0]
    except Exception:
        pass
    lo, hi = int(a_.frame_range[0]), int(a_.frame_range[1])
    for fr in sorted(set(range(lo, hi + 1, 2)) | {hi}):
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()
        wc, kc = posed(W), posed(KW)
        for f in hs_tris:
            n_ = len(BVHTree.FromPolygons(kc, hs_tris[f]).overlap(BVHTree.FromPolygons(wc, gun_tris[f])))
            res[f]["headset"]["gun_pairs"] = max(res[f]["headset"]["gun_pairs"], n_)
            res[f]["headset"]["frames"] += 1

rig.data.pose_position = "REST"
bpy.context.view_layer.update()
wco = posed(W)
wd = dominant(W)
kwco = posed(KW)
for f in figures:
    tris = [tuple(p.vertices) for p in W.data.polygons if all(wd[i].startswith(f + "_") for i in p.vertices)]
    gun = BVHTree.FromPolygons(wco, tris)
    ids = [i for i, p in enumerate(pw) if p["figure"] == f and p["part"] == "foregrip"]
    if len(ids) != 1 or len(tris) < 100:
        raise SystemExit(f"{f}: {len(ids)} foregrip parts in kit_weapon, {len(tris)} gun triangles")
    vs = [kwco[v] for v, pv in enumerate(vw) if pv == ids[0]]
    res[f]["foregrip"] = dict(n=len(vs), min=round(float(min(gun.find_nearest(v)[3] for v in vs)), 4))

with open(OUT, "w") as fh:
    json.dump(res, fh, indent=1, sort_keys=True)
print(json.dumps(res))
