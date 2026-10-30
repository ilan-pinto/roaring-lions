"""Kit clash census for the infantry upgrade kit (GH-826).

    blender -b -P tools/inf_kit_clash.py -- --out <dir> [--clips kneel,pinned,...] [--step 2]

A kit part rides ONE bone, so it never moves against geometry on that bone. It
can move against everything else: a side plate on the spine against the upper
arm, a foregrip on the weapon against the support hand. This tool poses the
armature at every sampled key of each living clip, with the whole kit shown
(superseded slot parts included, they are never drawn together but any of them
can be bought alone), and for every kit object measures how far body vertices
that belong to ANOTHER bone sit inside it:

  * kit x body: vertices of the four base meshes whose dominant bone differs
    from the part's bone, tested for being inside the part's closed volume by
    ray parity, depth = distance to its nearest surface;
  * kit x kit: vertices of every other kit object of the same figure (a
    different bone, a different slot), the same test.

Idle is the bind-adjacent baseline: a pair that clashes in `kneel` or `pinned`
by clearly more than in `idle` is the finding. The result is written as
`clash.json` (worst depth per clip x part x other) and printed as a table.
Depths are metres. Needs Blender; deterministic, no noise.
"""
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import inf_kit  # noqa: E402
import inf_kit_parts as kp  # noqa: E402
import inf_kit_scene as scn  # noqa: E402

CLIPS = ("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "down")   # the Rifle Squad's; `--team` reads the team's own
TOL = 0.004      # a vertex within 4 mm of the surface is touching, not inside


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {}
    for i in range(0, len(argv) - 1, 2):
        a[argv[i].lstrip("-")] = argv[i + 1]
    return a


def clip_keys(act, step, dense=False):
    """See `inf_kit_scene.clip_keys` (kept here under its old name for `render_inf_kit.py`)."""
    return scn.clip_keys(act, step, dense)


def world_mesh(ob, dg):
    e = ob.evaluated_get(dg)
    me = e.to_mesh()
    mw = ob.matrix_world
    co = np.array([(mw @ v.co)[:] for v in me.vertices])
    tris = [tuple(p.vertices) for p in me.polygons]          # parts are triangulated
    e.to_mesh_clear()
    return co, tris


def inside_depth(bvh, pts, bbox):
    """Depth of each point inside the closed surface (0 when outside)."""
    lo, hi = bbox
    out = np.zeros(len(pts))
    for i, p in enumerate(pts):
        if (p < lo).any() or (p > hi).any():
            continue
        v = Vector(p)
        # parity of ray hits along +z, and along +x to break a grazing tie
        votes = 0
        for d in (Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0))):
            n, o = 0, v + d * 1e-5
            for _ in range(32):
                loc, nor, idx, dist = bvh.ray_cast(o, d)
                if loc is None:
                    break
                n += 1
                o = loc + d * 1e-5
            votes += n & 1
        if votes >= 2:
            _, _, _, dist = bvh.find_nearest(v)
            out[i] = dist
    return out


def main():
    a = parse()
    out = os.path.abspath(a["out"])
    os.makedirs(out, exist_ok=True)
    team_id = a.get("team", "inf_squad")
    team = kp.use_team(team_id)
    # a team's census walks every living clip its file has (work, kneelIn and kneelOut included) and `down`, informational
    clips = a.get("clips", ",".join(team.clips + ("down",) if team_id != "inf_squad" else CLIPS)).split(",")
    step = int(a.get("step", 2))
    arm, meshes, mat = scn.load_squad(REPO, team_id)
    figs = a.get("figs", ",".join(team.figs)).split(",")
    only = set(a["only"].split(",")) if a.get("only") else None
    rows = inf_kit.build(REPO, arm, meshes, mat, figs=figs, only=only)
    # an open soft-goods shell is closed for the parity test by giving it its real depth
    for ob, _, _, _ in rows:
        if ob.get("rl_open"):
            # depth per vertex = the part's own physical thickness there (attribute rl_thick)
            att = ob.data.attributes["rl_thick"]
            tv = np.array([d.value for d in att.data])
            tmax = float(max(tv.max(), 1e-3))
            vg = ob.vertex_groups.new(name="clash_t")
            for i, t in enumerate(tv):
                vg.add([i], max(0.02, float(t) / tmax), "REPLACE")
            m = ob.modifiers.new("clash_solid", "SOLIDIFY")
            m.thickness = tmax
            m.offset = -1.0
            m.use_even_offset = False
            m.use_rim = True
            m.vertex_group = "clash_t"
    base = {n: o for n, o in meshes.items() if n in team.prims}
    names = {}
    for n, o in base.items():
        vg = {g.index: g.name for g in o.vertex_groups}
        names[n] = [vg[max(v.groups, key=lambda g: g.weight).group] for v in o.data.vertices]
    kit_bone = {ob.name: arm.data.bones[ob.vertex_groups[0].name].name for ob, _, _, _ in rows}
    result = {}
    for clip in clips:
        act = bpy.data.actions[clip]
        keys, lo = clip_keys(act, step, team.dense_keys)
        worst = {}
        for kf_ in keys:
            fr = kf_ - lo
            scn.pose(arm, clip, 0)
            arm.animation_data_create()
            arm.animation_data.action = act
            arm.animation_data.action_slot = act.slots[0] if act.slots else None
            scn.set_frame(kf_)
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            body = {nm: world_mesh(o, dg) for nm, o in base.items()}
            kit = {ob.name: world_mesh(ob, dg) for ob, _, _, _ in rows}
            for ob, part, pf, _ in rows:
                co, tris = kit[ob.name]
                bvh = BVHTree.FromPolygons([Vector(c) for c in co], tris)
                bbox = (co.min(0) - TOL, co.max(0) + TOL)
                own = kit_bone[ob.name]
                # kit x body
                for nm, (bco, _) in body.items():
                    bone = np.array(names[nm])
                    sel = (bone != own) & np.array([b.startswith(pf + "_") or b == "prop" for b in bone])
                    pts = bco[sel]
                    near = pts[((pts >= bbox[0]) & (pts <= bbox[1])).all(1)]
                    if len(near) == 0:
                        continue
                    d = inside_depth(bvh, near, bbox)
                    if d.max() > TOL:
                        j = int(np.argmax(d))
                        who = np.array(names[nm])[sel][((pts >= bbox[0]) & (pts <= bbox[1])).all(1)][j]
                        key = (ob.name, f"body:{who}")
                        if d.max() > worst.get(key, (0, 0))[0]:
                            worst[key] = (float(d.max()), fr)
                # kit x kit (same figure, other bone)
                for ob2, part2, pf2, _ in rows:
                    if ob2.name == ob.name or pf2 != pf or kit_bone[ob2.name] == own:
                        continue
                    if part.slot and part.slot == part2.slot:
                        continue
                    co2, _t = kit[ob2.name]
                    d = inside_depth(bvh, co2, bbox)
                    if d.max() > TOL:
                        key = (ob.name, f"kit:{ob2.name}")
                        if d.max() > worst.get(key, (0, 0))[0]:
                            worst[key] = (float(d.max()), fr)
        print(f"   {clip}: {len(keys)} keys sampled")
        result[clip] = {f"{k[0]} x {k[1]}": {"depth_m": round(v[0], 4), "frame": v[1]} for k, v in sorted(worst.items())}
        print(f"== {clip}: {len(result[clip])} pairs")
        for k, v in sorted(result[clip].items(), key=lambda kv: -kv[1]["depth_m"])[:14]:
            print(f"   {v['depth_m']*1000:6.1f} mm  {k}  (frame {v['frame']})")
        result[clip + "__keys"] = len(keys)
    with open(os.path.join(out, a.get("name", "clash.json")), "w") as fh:
        json.dump(result, fh, indent=1)


if __name__ == "__main__":
    main()
