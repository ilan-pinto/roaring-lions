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
SKIN_RIGID_W, SKIN_MOVED_M = 0.999, 0.001   # a skinned body only: as `inf_kit_fit.py`'s


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


LIMB_BONES = ("forearm", "hand", "finger", "upperarm")
SHOULDER_SKIP_M = 0.12      # an upper-arm vertex this close to its shoulder joint belongs in the armhole


def limb_through_wall(arm, rows_, kit, body, names, pf):
    """The census column "limb through the wall" (GH-746 fix round): limb vertices (forearm, hand, finger and the upper arm more
    than SHOULDER_SKIP_M from its shoulder) that lie inside the carrier's HOLLOW, read as a solid hull: a point is in it when a
    ray from it hits the carrier in each of +x, -x, +y and -y (the shell is open at the top and bottom, so parity is not asked of
    it and its holes do not flip the answer). Depth = distance to the nearest carrier face. Returns (n vertices, max depth m)."""
    ob = next((o for o, part, f_, _ in rows_ if f_ == pf and part.name == "carrier"), None)
    if ob is None:
        return 0, 0.0
    co, tris = kit[ob.name]
    bvh = BVHTree.FromPolygons([Vector(c) for c in co], tris)
    lo, hi = co.min(0) - 0.01, co.max(0) + 0.01
    sh = {k: np.array(arm.matrix_world @ arm.data.bones[f"{pf}_upperarm_{k}"].head_local) for k in "LR"}
    n, worst = 0, 0.0
    dirs = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0))]
    for nm, (bco, _t) in body.items():
        for i, b in enumerate(names[nm]):
            if not isinstance(b, str) or not b.startswith(pf + "_"):
                continue
            part = b[len(pf) + 1:]
            if part.split("_")[0] not in LIMB_BONES:
                continue
            p = bco[i]
            if (p < lo).any() or (p > hi).any():
                continue
            if part.startswith("upperarm") and np.linalg.norm(p - sh[part[-1]]) < SHOULDER_SKIP_M:
                continue
            v = Vector(p)
            if all(bvh.ray_cast(v + d * 1e-5, d)[0] is not None for d in dirs):
                n += 1
                worst = max(worst, bvh.find_nearest(v)[3])
    return n, worst


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
    # A skinned body (`extras.rl_skinned`, the Meshy pilot): a vertex the part's bone DOMINATES can still move against it
    # (the vest's hem is spine 0.7 / pelvis 0.3). Those are tested too, in the keys where they leave the place they would
    # hold if they were rigid with the part's bone. A rigid team has none: its census is unchanged.
    skinned = bool(bpy.context.scene.get("rl_skinned"))
    rest_co, own_w = {}, {}
    if skinned:
        for n, o in base.items():
            vg = {g.index: g.name for g in o.vertex_groups}
            rest_co[n] = np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices])
            own_w[n] = [{vg[g.group]: g.weight for g in v.groups} for v in o.data.vertices]
    result = {}
    wall = {}
    for clip in clips:
        act = bpy.data.actions[clip]
        keys, lo = clip_keys(act, step, team.dense_keys)
        if a.get("keycap") and len(keys) > int(a["keycap"]):
            # a scoped run (`--keycap N`): N keys spread evenly over the clip, the first and the last among them. Off by default.
            n = int(a["keycap"])
            keys = [keys[round(i * (len(keys) - 1) / (n - 1))] for i in range(n)]
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
            # kit x the hands, the other way round (R2 review, 1 Nov 2026): a hand is a set of closed glove pieces, and the
            # kit part's own vertices and face centres are what sit INSIDE it. Counting only body vertices inside the part
            # (below) cannot see a knuckle sunk into a thin panel's corner: the EUD sat 6.1 mm into the firing hand for the
            # whole of `kneel` and `pinned` and this census read nothing.
            hands = {}
            for nm, (bco, btris) in body.items():
                bone = names[nm]
                for pf_ in figs:
                    held = {f"{pf_}_hand_L", f"{pf_}_hand_R", f"{pf_}_finger_L"}
                    hp = [t for t in btris if all(bone[i] in held for i in t)]
                    if hp:
                        hands[(nm, pf_)] = (BVHTree.FromPolygons([Vector(c) for c in bco], hp),
                                            (bco[sorted({i for t in hp for i in t})].min(0) - TOL,
                                             bco[sorted({i for t in hp for i in t})].max(0) + TOL))
            for pf_w in figs:
                n_w, d_w = limb_through_wall(arm, rows, kit, body, names, pf_w)
                if n_w and d_w > wall.get((clip, pf_w), (0, 0.0, 0))[1]:
                    wall[(clip, pf_w)] = (n_w, d_w, fr)
                elif (clip, pf_w) not in wall:
                    wall[(clip, pf_w)] = (0, 0.0, fr)
                else:
                    wall[(clip, pf_w)] = (max(n_w, wall[(clip, pf_w)][0]), wall[(clip, pf_w)][1], wall[(clip, pf_w)][2])
            for ob, part, pf, _ in rows:
                co, tris = kit[ob.name]
                bvh = BVHTree.FromPolygons([Vector(c) for c in co], tris)
                # Armour and the pelvis wraps (belt, pouches) are shells conformed to the torso: where a hand is itself pressed into the
                # torso, their vertices are inside the glove too, and that is the arm-in-body count's question (`launcher_arms.test.ts`),
                # not the kit's. The devices (sensors, optics, lights, grips) are the parts a hand can sink into by their own fault.
                if part.track != "armour" and part.bone != "pelvis" and kit_bone[ob.name] not in (f"{pf}_hand_L", f"{pf}_hand_R"):
                    cen = np.array([co[list(t)].mean(0) for t in tris])
                    pts_k = np.vstack([co, cen])
                    for (nm, pf_), (hb, hbox) in hands.items():
                        if pf_ != pf:
                            continue
                        near = pts_k[((pts_k >= hbox[0]) & (pts_k <= hbox[1])).all(1)]
                        if len(near) == 0:
                            continue
                        d = inside_depth(hb, near, hbox)
                        # a glove piece is closed except at the cuff's mouth, where ray parity votes wrongly for a point on the
                        # forearm's axis: a point is inside only if it also lies BEHIND the surface nearest it
                        for k_ in np.nonzero(d > 0)[0]:
                            loc_, nor_, _i, _d = hb.find_nearest(Vector(near[k_]))
                            if (Vector(near[k_]) - loc_).dot(nor_) >= 0:
                                d[k_] = 0.0
                        if d.max() > TOL:
                            key = (ob.name, f"hand:{pf}")
                            if d.max() > worst.get(key, (0, 0))[0]:
                                worst[key] = (float(d.max()), fr)
                bbox = (co.min(0) - TOL, co.max(0) + TOL)
                own = kit_bone[ob.name]
                # kit x body
                for nm, (bco, _) in body.items():
                    bone = np.array(names[nm])
                    sel = (bone != own) & np.array([b.startswith(pf + "_") or b == "prop" for b in bone])
                    if skinned:
                        bl = np.array([b == own and w_.get(own, 0.0) < SKIN_RIGID_W for b, w_ in zip(names[nm], own_w[nm])])
                        if bl.any():
                            pb = arm.pose.bones[own]
                            M = np.array(arm.matrix_world @ pb.matrix @ arm.data.bones[own].matrix_local.inverted() @ arm.matrix_world.inverted())
                            rigid = rest_co[nm][bl] @ M[:3, :3].T + M[:3, 3]
                            mv = np.zeros(len(sel), bool)
                            mv[np.nonzero(bl)[0]] = np.linalg.norm(bco[bl] - rigid, axis=1) > SKIN_MOVED_M
                            sel = sel | mv
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
        result[clip + "__wall"] = {pf_w: {"verts": wall[(clip, pf_w)][0], "depth_m": round(wall[(clip, pf_w)][1], 4), "frame": wall[(clip, pf_w)][2]} for pf_w in figs if (clip, pf_w) in wall}
        for pf_w in figs:
            if (clip, pf_w) in wall:
                print(f"   limb through the wall {pf_w}: {wall[(clip, pf_w)][0]} verts, {wall[(clip, pf_w)][1] * 1000:.1f} mm (frame {wall[(clip, pf_w)][2]})")
    with open(os.path.join(out, a.get("name", "clash.json")), "w") as fh:
        json.dump(result, fh, indent=1)


if __name__ == "__main__":
    main()
