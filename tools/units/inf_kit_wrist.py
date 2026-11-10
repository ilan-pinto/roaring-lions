"""The EUD as a WRIST MOUNT on the support forearm: written, run, and NOT REGISTERED (GH-746, wave 8).

The controller's wave-8 ruling moves the phone case from the chest (which has no valid spot on this carrier, wave 7) to the SUPPORT forearm (rig
`forearm_R`, rigid to it), outer face, about 40% of the way from the wrist to the elbow, under these refusals at every pose-bank key of every clip:
0 triangle pairs with the weapon and the other kit parts, no firing hand / finger, head, neck or torso-skin vertex in it or within 3 mm, and the
back face on the sleeve within 5 mm. `tools/inf_kit_wrist_probe.py` runs it. Result (see that script's output in the commit): a RIGID 170 x 90 mm
case on a round forearm cannot sit within 5 mm of the sleeve at any spot (best median gap 7.5 mm, the clean spots 15 mm), and the upper-arm pocket
crosses the carrier and the head. So no spot is shipped; to enable it, add the `eud_wrist` part row (bone `forearm_R`, sensors 3, no slot), drop
`eud` for `inf_squad` and `eud_wrist` for `demo_squad`, add `eud_wrist` to `V7_PART_TRIS` / `INFANTRY_KIT_TEAM_PART_TRIS`, and register
`v7_eud_wrist` in `inf_kit_v7.V7_BUILDERS`. The module needs `PoseBank.pose_clip` (added with it).
"""
import math

import numpy as np
from mathutils import Vector

import inf_kit as ik
import inf_kit_geo as geo
import inf_kit_mesh as km
import inf_kit_parts as kp
import inf_kit_v7 as v7
from inf_kit_v7 import UP, _cache, overlap_pairs
from inf_kit_geo import Piece

_stats = v7._stats
add_mesh = v7.add_mesh


# The wrist mount.
#
# History: the chest has no valid spot for the 170 mm case on this carrier (wave 7 ran the strict rules, `git show 8513c2f51`: the upper
# plate is collar relief, the middle crosses the throat, the low plate is in the hands' and rifle's path), so the controller's wave-8
# ruling puts it where an ATAK end-user device is worn in practice: a wrist mount on the support forearm (rig `forearm_R`), the part
# unchanged. The part is a RIGID box; the forearm is a cylinder: see the gap readings in the commit.

EUD_T = 0.4                  # along the forearm, 0 at the wrist, 1 at the elbow
FIRING_KINDS = ("hand_L", "finger_L")          # rig hand_L is the FIRING fist (GH-746 round 5)
BODY_KINDS = ("head", "neck", "spine", "pelvis")
SLEEVE_GAP_LIMIT = 0.005     # the case's back face's median gap to the uniform's forearm surface
SLEEVE_GAP_MAX = 0.020       # and its worst vertex
NEAR_M = 0.003


def _bone_matrices(f, bone):
    """Per pose-bank key: the 4x4 that carries a point rigid with `bone` from its rest place to that key's."""
    bank = f.bank
    rest = np.linalg.inv(bank.rest[f"{f.prefix}_{bone}"])
    return [m[f"{f.prefix}_{bone}"] @ rest for m, _w in bank.poses]


def _apply(M, V):
    return V @ M[:3, :3].T + M[:3, 3]


def piece_arrays(pc):
    """(vertices, triangles) of a built Piece (before `finish`; faces fanned to triangles), then the Piece is freed."""
    pc.bm.verts.index_update()
    V = np.array([v.co[:] for v in pc.bm.verts])
    T = []
    for fc in pc.bm.faces:
        ids = [v.index for v in fc.verts]
        for k in range(1, len(ids) - 1):
            T.append((ids[0], ids[k], ids[k + 1]))
    pc.bm.free()
    return V, np.array(T)


def pose_world(f):
    """What the case is checked against, at every pose-bank key (cached per figure): this figure's weapon (a BVH), every other kit part of
    the figure (carrier, throat, groin, belt, pouches, optics, helmet devices, headsets, radio: one BVH per key, each part riding its own
    bone), and the body points of the firing hand and fingers, head, neck and torso skin."""
    c = _cache(f)
    if "pose_world" in c:
        return c["pose_world"]
    bank = f.bank
    pf = f.prefix
    oi_u = list(kp.TEAM.bank_prims).index("uniform")
    oi_w = list(kp.TEAM.bank_prims).index("weapon")
    wob = bank.objs[oi_w]
    dom_w = bank.dom[oi_w]
    wmask = np.array([isinstance(d, str) and d == f"{pf}_weapon" for d in dom_w])
    wpoly = [tuple(p.vertices) for p in wob.data.polygons if all(wmask[i] for i in p.vertices)]
    widx = np.nonzero(wmask)[0]
    wpos = {int(i): j for j, i in enumerate(widx)}
    wT = np.array([[wpos[i] for i in t] for t in wpoly])
    # the other kit parts, in the bind pose, with the bone each rides
    parts = []
    for part in kp.PARTS:
        if part.name in ("eud", "eud_wrist") or pf not in part.figs:
            continue
        builder = v7.V7_BUILDERS.get(part.name) or ik.BUILDERS.get(part.name)
        if builder is None:
            continue
        for suf, base in kp.object_suffixes(part):
            side = suf[-1] if suf[-2] == "_" and suf[-1] in "LR" else None
            V, T = piece_arrays(builder(f, side))
            parts.append((f"{pf}_{base}", V, T, part.name))
    kinds_body = {f"{pf}_{k}" for k in BODY_KINDS} | {f"{pf}_{k}" for k in FIRING_KINDS}
    ub = np.array([isinstance(d, str) and d in kinds_body for d in bank.dom[oi_u]])
    mats = {}
    keys = []
    for k, (m, W) in enumerate(bank.poses):
        wbvh = geo.bvh_from(W[oi_w][widx], wT)
        kv, kt, off = [], [], 0
        for bone, V, T, _n in parts:
            if bone not in mats:
                mats[bone] = np.linalg.inv(bank.rest[bone])
            Mk = m[bone] @ mats[bone]
            kv.append(_apply(Mk, V))
            kt.append(T + off)
            off += len(V)
        kbvh = geo.bvh_from(np.concatenate(kv), np.concatenate(kt))
        body = W[oi_u][ub]
        names = np.array(bank.dom[oi_u], dtype=object)[ub]
        keys.append({"weapon": wbvh, "kit": kbvh, "body": body, "who": names, "clip": bank.pose_clip[k]})
    c["pose_world"] = keys
    return keys


def eud_scan(f, bone, V, T):
    """The refusal, at every pose-bank key of every clip: the case (rigid with `bone`) against the weapon and the other kit parts
    (triangle pairs, both BVHs posed) and against the firing hand and fingers, head, neck and torso skin (vertices inside the case or
    within 3 mm). Returns {clip: {"weapon": pairs, "kit": pairs, "hand": n, "head": n, "torso": n}} of per-clip worst counts."""
    Ms = _bone_matrices(f, bone)
    pf = f.prefix
    out = {}
    for k, pw in enumerate(pose_world(f)):
        Vk = _apply(Ms[k], V)
        cb = geo.bvh_from(Vk, T)
        row = out.setdefault(pw["clip"], {"weapon": 0, "kit": 0, "hand": 0, "head": 0, "torso": 0})
        row["weapon"] = max(row["weapon"], len(cb.overlap(pw["weapon"])))
        row["kit"] = max(row["kit"], len(cb.overlap(pw["kit"])))
        lo, hi = Vk.min(0) - 0.02, Vk.max(0) + 0.02
        pts = pw["body"]
        near = ((pts >= lo) & (pts <= hi)).all(1)
        cnt = {"hand": 0, "head": 0, "torso": 0}
        for q, who in zip(pts[near], pw["who"][near]):
            v = Vector(q)
            d = cb.find_nearest(v)[3]
            if d < NEAR_M or (d < 0.02 and all(cb.ray_cast(v + e * 1e-5, e)[0] is not None for e in
                                               [Vector(x) for x in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))])):
                kind = who[len(pf) + 1:]
                cnt["hand" if kind in FIRING_KINDS else "head" if kind in ("head", "neck") else "torso"] += 1
        for k_, v_ in cnt.items():
            row[k_] = max(row[k_], v_)
    return out


def scan_total(scan):
    return sum(sum(r.values()) for r in scan.values())


def fore_zone(f, bone):
    c = _cache(f)
    key = ("zone", bone)
    if key not in c:
        ok = (f.dom == f"{f.prefix}_{bone}") & f.mine
        t = f.tris[ok[f.tris].all(1)]
        c[key] = geo.bvh_from(f.co, t)
    return c[key]


def wrist_try(f, bone, t_frac, theta_deg, V0, T):
    """The case lying on `bone`'s outer surface at `t_frac` of the way from its tail (the wrist end) to its head (the elbow end), rolled
    `theta_deg` round the bone from straight up: back face on the sleeve along the radial normal, the long axis along the bone. Out in 1 mm steps
    until no triangle of it crosses the uniform's surface on that bone. Returns (V, readings) or (None, why)."""
    bn = f.bones[f"{f.prefix}_{bone}"]
    tail, head = np.array(bn.tail_local), np.array(bn.head_local)
    ax = head - tail
    ax /= np.linalg.norm(ax)
    up = np.array(UP)
    u = up - ax * float(up @ ax)
    u /= np.linalg.norm(u)
    w = np.cross(ax, u)
    th = math.radians(theta_deg)
    d = u * math.cos(th) + w * math.sin(th)
    a0 = tail + (head - tail) * t_frac
    zone = fore_zone(f, bone)
    hit = zone.ray_cast(Vector(a0 + d * 0.25), Vector(-d), 0.5)[0]
    if hit is None:
        return None, "no sleeve there"
    base = km.place(V0, np.array(hit) - d * 0.0005, d, ax)
    shift = 0.0
    while overlap_pairs(base + d * shift, T, [zone]) and shift < 0.04:
        shift += 0.001
    V = base + d * shift
    if overlap_pairs(V, T, [zone]):
        return None, "crosses the sleeve"
    g = km.outer_gap([zone], V, d)
    back = (V0[:, 0] < 0.004) & ~np.isnan(g)
    med = float(np.median(g[back])) if back.any() else 9.0
    worst = float(g[back].max()) if back.any() else 9.0
    if med > SLEEVE_GAP_LIMIT or worst > SLEEVE_GAP_MAX:
        return None, f"back face {1000 * med:.1f} mm (worst {1000 * worst:.1f}) off the sleeve"
    return V, {"t": round(t_frac, 2), "roll_deg": round(theta_deg), "sleeve_gap_mm": round(1000 * med, 1), "sleeve_gap_worst_mm": round(1000 * worst, 1)}


def v7_eud_wrist(f, side=None):
    """The phone case on the SUPPORT forearm (rig forearm_R, rigid to it), outer face, 40% of the way from the wrist to the elbow, screen up and out.
    Searched along the forearm and round it, nearest first, refused at every pose-bank key of every clip with any triangle pair with the weapon or
    another kit part, or any firing hand / finger, head, neck or torso-skin vertex in it or within 3 mm. If the forearm has no spot, the support
    upper arm's outer face (a shoulder-pocket mount) under the same rules. If neither does, the export is refused with the best candidates."""
    V0, T = km.source("phone_case")
    best = []
    for bone, ts in (("forearm_R", [EUD_T + 0.04 * k for k in range(-5, 8)]), ("upperarm_R", [0.5 + 0.05 * k for k in range(-4, 5)])):
        rolls = [15 * k for k in range(-12, 12)]
        cands = sorted(((t, r) for t in ts for r in rolls), key=lambda c: (abs(c[0] - ts[len(ts) // 2]) / 0.3 + abs(c[1]) / 180.0))
        for t, r in cands:
            V, info = wrist_try(f, bone, t, r, V0, T)
            if V is None:
                continue
            scan = eud_scan(f, bone, V, T)
            tot = scan_total(scan)
            if tot == 0:
                _stats(f, name="eud_wrist", bone=bone, **info, per_clip_worst={c: r_ for c, r_ in scan.items()})
                pc = Piece(f.world())
                add_mesh(pc, V, T, "olive_dark")
                return pc
            best.append((tot, bone, info, scan))
    best.sort(key=lambda b_: b_[0])
    raise ValueError(f"{f.prefix}: the EUD found no wrist or shoulder-pocket spot clear of the weapon, the kit and the body; best: "
                     + "; ".join(f"{b_[1]} {b_[2]}: {b_[3]}" for b_ in best[:2]))


