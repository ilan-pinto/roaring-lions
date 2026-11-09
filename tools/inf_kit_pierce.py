"""Limb edges piercing the carrier: a REPORT for the lead's B2 ruling (GH-746), not a gate. No bar is set.

    blender -b --factory-startup -P tools/inf_kit_pierce.py -- <inf_squad.glb> <out.json> [--figs f1,f2]

Reads a shipped `inf_squad.glb` (kit grafted in), poses every frame of all eight living clips (every 0.25 frame on kneelIn and
kneelOut), and per figure and clip counts the limb MESH EDGES (upper arm more than 12 cm from its shoulder, forearm, hand,
fingers) that cross a TRIANGLE of that figure's carrier: the arm's surface piercing the vest's surface. It asks nothing of the
shell's hollow, so deleting wall (a cut) cannot make it read zero by construction, which the earlier "limb through the wall"
column could (its predicate, "a ray from the point hits the shell in all four directions", was the cut's own). Reports the
worst frame's edge count per clip, and per segment (upperarm, forearm, hand: each its own worst frame). The method is the v7b review's probe (`wall.py`, part B), kept here so the reading can be repeated.
"""
import json
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
FIGS = tuple(argv[argv.index("--figs") + 1].split(",")) if "--figs" in argv else ("f0", "f1", "f2")
LIMB = ("forearm", "hand", "finger", "upperarm")
SHOULDER_SKIP_M = 0.12
CLIPS = ["idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
uni = bpy.data.objects["uniform"]
ku = bpy.data.objects["kit_uniform"]
att = np.array([x.value for x in ku.data.attributes["_RL_KIT"].data])
kpolys = [tuple(p.vertices) for p in ku.data.polygons]
parts = [dict(p) for p in ku["rl_kit"]["parts"]]
cid = {f: next(i for i, p in enumerate(parts) if p["part"] == "carrier" and p["figure"] == f) for f in FIGS}
names = {g.index: g.name for g in uni.vertex_groups}
dom = [names[max(v.groups, key=lambda g: g.weight).group] if len(v.groups) else "" for v in uni.data.vertices]
edges = np.array([tuple(e.vertices) for e in uni.data.edges])
limb = {f: np.array([d.startswith(f + "_") and d[len(f) + 1:].split("_")[0] in LIMB for d in dom]) for f in FIGS}


def posed(ob):
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = e.to_mesh()
    co = np.array([(ob.matrix_world @ v.co)[:] for v in me.vertices])
    e.to_mesh_clear()
    return co


def carrier(co, f):
    sel = [p for p in kpolys if att[p[0]] == cid[f]]
    used = sorted({i for p in sel for i in p})
    rm = {i: j for j, i in enumerate(used)}
    return co[used], [tuple(rm[i] for i in p) for p in sel]


res = {}
for clip in CLIPS:
    act = bpy.data.actions[clip]
    arm.animation_data.action = act
    try:
        arm.animation_data.action_slot = act.slots[0]
    except Exception:
        pass
    lo, hi = act.frame_range
    frames = list(np.arange(lo, hi + 1e-6, 0.25 if hi - lo < 6 else 1.0))
    for f in FIGS:
        res[f"{clip}|{f}"] = {"edges": 0, "frames_with_a_piercing_edge": 0, "frames": len(frames), "worst_frame": None,
                              "segments": {"upperarm": 0, "forearm": 0, "hand": 0}}
    for fr in frames:
        bpy.context.scene.frame_set(int(np.floor(fr)), subframe=float(fr - np.floor(fr)))
        cu, cku = posed(uni), posed(ku)
        for f in FIGS:
            r = res[f"{clip}|{f}"]
            V, T = carrier(cku, f)
            bvh = BVHTree.FromPolygons([Vector(c) for c in V], T)
            lo_b, hi_b = V.min(0) - 0.01, V.max(0) + 0.01
            sh = {k: np.array(arm.matrix_world @ arm.pose.bones[f"{f}_upperarm_{k}"].head) for k in "LR"}
            ok = limb[f].copy()
            for i in np.where(limb[f])[0]:
                d = dom[i][len(f) + 1:]
                if d.startswith("upperarm") and np.linalg.norm(cu[i] - sh[d[-1]]) < SHOULDER_SKIP_M:
                    ok[i] = False
            n = 0
            seg_n = {"upperarm": 0, "forearm": 0, "hand": 0}
            for e0, e1 in edges[ok[edges[:, 0]] & ok[edges[:, 1]]]:
                p0, p1 = cu[e0], cu[e1]
                if (np.minimum(p0, p1) > hi_b).any() or (np.maximum(p0, p1) < lo_b).any():
                    continue
                dv = p1 - p0
                L = float(np.linalg.norm(dv))
                if L > 1e-7 and bvh.ray_cast(Vector(p0), Vector(dv / L), L)[0] is not None:
                    n += 1
                    seg = dom[e0][len(f) + 1:].split("_")[0]
                    seg_n["hand" if seg == "finger" else seg] += 1
            if n:
                r["frames_with_a_piercing_edge"] += 1
            for k_, v_ in seg_n.items():
                r["segments"][k_] = max(r["segments"][k_], v_)       # each segment's own worst frame
            if n > r["edges"]:
                r["edges"], r["worst_frame"] = n, float(fr)
    for f in FIGS:
        print("PIERCE", clip, f, json.dumps(res[f"{clip}|{f}"]), flush=True)
json.dump(res, open(OUT, "w"), indent=1)
