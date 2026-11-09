"""import_meshy_skinned_team.py -- a Meshy figure, generated POSED with its hands closed on its weapon, fitted to
this project's infantry skeleton by SMOOTH SKINNING (the lead's ruling, 1 Nov 2026: "skin it, keep our motion").

This is the one importer that does not bind rigidly. `rig.py`'s "one part to one bone, no weight painting" rule stands
for every kit figure and every cut Meshy body; a figure built here is a single welded shell (arms on the ribs, fingers
fused to the carbine), so it is weighted to the same bones instead -- Blender's bone-heat weights, then corrected in
code where they must be exact:

  * the weapon is RIGID: every vertex of it on one bone (`{p}_forearm_R` at export; the motion pass moves it to
    `{p}_weapon`), so the carbine never deforms;
  * the hands are RIGID on `{p}_hand_{L|R}`: every glove vertex past the wrist plane carries weight 1.0 there, so the
    sculpted closed fists keep their shape and the motion pass puts hand = weapon x H_rest in every clip (the
    stations in `extras.rl_hands`, measured here from the rest pose);
  * the cuff blends hand -> forearm over `CUFF_BLEND_M`;
  * the torso core carries no arm weight (bone heat leaks through the welded armpit).

Nothing here is hand-posed or weight-painted in a .blend: the weights are a function of the bytes and the literals
below, and the importer prints its census. The clips are `rig.build_clips`' own (the mocap retarget for inf_squad),
then `pnpm motion:meshes` (the hold, the kneel, the wedge, the stride) as for every other team.

usage: Blender -b --factory-startup -P tools/units/import_meshy_skinned_team.py -- inf_squad [--out path.glb]

The three figures of the pilot are ONE Meshy body (f1, task 01a197a3): f0 and f2 are its measured scalings
(stature 1.84 / 1.72, girth -2 % / +8 %), the design's 0-credit fallback, until their own bodies are bought.
No mathutils.noise anywhere (Blender 5.2 reseeds it per process).
"""
import glob
import json
import math
import os
import struct
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)
import rig  # noqa: E402
from mesh_ownership import require_owner  # noqa: E402

OUT_DIR = os.path.join(REPO, "art", "meshes")
TEXTURE_PX = 2048
JPEG_QUALITY = 85

#: Anatomical side -> rig.py bone side. rig.py's `_L` bones sit at -Y (glTF +Z), the figure's anatomical RIGHT:
#: the firing side. Every literal below is keyed by ANATOMICAL side.
RIG_SIDE = {"R": "L", "L": "R"}

#: The source per team, and what was measured on it. Positions are metres in the normalised frame (feet on z = 0,
#: stature S, the figure facing +X, the ankles' mean xy at the origin): the SEEDS the measurement refines on the
#: vertex data (`_measure`), read off `_coord/inf-meshy-pilot/tools/probe_render.py`'s views and checked with its
#: markers. Everything else (crotch, legs, head, shoulders, gun axis, fists, elbows) is measured from the bytes.
SOURCES = {
    "inf_squad": dict(
        glob=os.path.join(REPO, "art", "meshy", "inf-squad-f1-*-01a197a3", "model.glb"),
        task=dict(preview="01a19787-765a-76f3-bdd4-0d668a3d1f23", refine="01a1979f-ddee-74c0-bd28-518e149fff14",
                  remesh="01a197a3-c729-7075-a09d-0b4f0949c88b"),
        stature=1.78,
        #: yaw about Z that turns the remesh to face +X: the hip/knee line's normal (-117 deg), which the chest's
        #: minor axis (-122), the feet (-93 / -158, splayed) and the face (-105) agree with to within 12 deg.
        yaw_deg=117.0,
        seeds=dict(fist={"R": (0.15, -0.05, 1.15), "L": (0.18, 0.31, 1.03)},
                   gun=dict(butt=(0.04, -0.17, 1.30), muzzle=(0.29, 0.40, 0.81)),
                   elbow={"R": (-0.12, -0.31, 1.12), "L": (-0.04, 0.33, 1.17)}),
        #: f0 / f2 as scalings of the one bought body (design 6, the 0-credit fallback): (z scale, xy scale).
        bodies={"f0": (1.84 / 1.78, 0.98), "f1": (1.0, 1.0), "f2": (1.72 / 1.78, 1.08)},
    ),
}

#: Colour classes of the bake, CIE L*a*b* (the design's own instrument for the glove, spec 1.5).
GLOVE_C_MIN, GLOVE_HUE = 18.0, (20.0, 75.0)
BROWN_C_MIN, BROWN_HUE = 16.0, (15.0, 80.0)   # the glove in shadow is C* 34; the vest's brownish greys are under 12
FIST_CORE_M = 0.05            # within this of the fist's centre is the fist, whatever the bake says
WRIST_FREE_M = 0.07           # the sleeve within this of a wrist is a smooth blend to the hand, never a cut seam
CAP_INSET_M = 0.015           # a gun's or a fist's collar goes this deep into its own side
CAP_INSET_BODY_M = 0.025      # the body's collar goes this deep into the vest
SMALL_ISLAND_VERTS = 80
BODY_ISLAND_VERTS = 1500      # an island this big is the body (a figure's shell is ~5,000 welded vertices)
ISLAND_FOLLOW_VERTS = 150     # an island smaller than this (not the gun, not a fist) moves as one piece with the body under it
#: The fists and forearms to real size (the review of 9 Nov, the lead's ruling the same day). Meshy sculpted the closed
#: fists 0.157-0.183 m long and the firing forearm 0.32-0.35 m (elbow to wrist): about 1.4x a gloved fist (~0.115-0.12,
#: ANSUR II hand length 0.19 closed to ~0.6) and past the 99th percentile forearm (radiale-stylion ~0.153 S, 0.27 at 1.78).
FIST_SCALE = {"R": 0.80, "L": 0.86}   # by anatomical side: each fist shrinks about the part of the gun it holds, so it stays
                              # closed on it. The SUPPORT fist (L) 0.86: at 0.80 it showed in 3 of 8 game-camera facings
                              # in idle (the lead's real-size bar is 4) and measured 0.134-0.146 long; at 0.86 it is
                              # 0.144-0.157, inside the 0.115-0.16 band
FIST_GRIP_REACH_M = 0.05      # the gun vertices within this of the fist's centre are what it holds (the scale's centre)
FOREARM_F = 0.153             # elbow to wrist as a fraction of stature: the elbow joint is placed there along the forearm
FOREARM_MOVE_MAX_M = 0.06     # ...and moves at most this far from where the sleeve's bend was measured
FIRING_FIST_OUT_M = 0.0       # (round 3 stood the firing fist 10 mm off the gun sideways; a wrapped fist cannot come off a grip that
                              # way: 21 mm stayed inside. Round 4 opens the wrap instead, `_open_fist_wrap`)
WRAP_REACH_M, WRAP_CLEAR_M = 0.03, 0.001   # a glove vertex inside the gun within this goes to its surface plus this
#: OFF (round 4, 9 Nov): opening the wrap moved 46-55 glove vertices up to 30 mm and left the instrument's reading where it
#: was (21.4 / 20.9 / 19.9 mm): Meshy's fist is SOLID round the grip (fused), so the grip runs through the fist's closed
#: volume whatever the fingers do. The fix is a channel carved through the fist for the grip; not done this round.
OPEN_FIST_WRAP = False
DEBRIS_GAP_M = 0.03           # a small island this far from everything at rest is Meshy's loose debris: deleted       # a separate shell piece smaller than this near the bore is the gun's (a loop, a buckle)
ISLAND_NEAR_BORE_M = 0.14     # ...within this of the bore: the stock's rear loop sat 0.10 off it and stayed at the chest in fire
GUN_L, GUN_C_MAX = (9.0, 28.0), 7.0
KHAKI_L, KHAKI_C, KHAKI_HUE = (26.0, 48.0), (12.0, 26.0), (60.0, 100.0)
SKIN_C_MIN, SKIN_L_MIN, SKIN_A_MIN = 12.0, 20.0, 5.0
BOOT_C_MIN, BOOT_Z_MAX, BOOT_TOP_M = 25.0, 0.27, 0.20

KNEE_F, ANKLE_M, BELT_ABOVE_CROTCH = 0.285, 0.09, 0.13
SHOULDER_Z, SHOULDER_IN = 1.42, 0.055
WRIST_BACK_M = 0.06           # the wrist crease sits this far behind the closed fist's centre (ANSUR: hand 0.19, fist ~0.11)
CUFF_BLEND_M = 0.06           # hand -> forearm blend behind the wrist plane (0.03 tore at the cuff when the support fist rolled round the handguard: review, 9 Nov, N1)
CUFF_HAND_MAX = 0.45          # the hand's weight at the wrist plane: the cuff stays forearm-dominant
GUN_NEAR_M = 0.075            # a gun-coloured vertex this close to the bore is the gun
GUN_BODY_SIDE_M = 0.028       # across the bore toward the torso: past this a vertex is the vest the gun lies on
STOCK_POCKET_M = 0.12         # the rear of the stock whose vest pocket goes with it
GUN_LEN_BAND = (0.72, 0.98)   # a Meshy carbine must be within 15 % of 0.85 m, or the import refuses
TORSO_HALF_W = 0.25           # the chest, its side pouches and the shoulder caps: inside it, off the arms' own sleeves, is torso
HIP_HALF_W = 0.36             # the hips and what hangs from the belt (holster, pouches), which an elbow rested on
HIP_KIT_ABOVE_CROTCH = 0.18   # ...up to the belt: the holster beside it kept forearm 0.15-0.33 from bone heat and tore in fire
ARM_CAPSULE_R = {"upper": 0.075, "fore": 0.062}   # an arm's own radius about its bone, sleeve included
ARM_LATERAL_M = 0.19          # outboard of this from the spine, an upper arm's capsule is all arm
MAX_INFLUENCES = 4            # glTF's limit, pruned here (deterministically) rather than by the exporter


def log(msg):
    print(f"[skinned] {msg}", flush=True)


# ---------------------------------------------------------------------------
# the bake, as colour classes
# ---------------------------------------------------------------------------

def _lab(rgb):
    x = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    X = (0.4124 * x[..., 0] + 0.3576 * x[..., 1] + 0.1805 * x[..., 2]) / 0.95047
    Y = 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
    Z = (0.0193 * x[..., 0] + 0.1192 * x[..., 1] + 0.9505 * x[..., 2]) / 1.08883
    f = lambda t: np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16 / 116)  # noqa: E731
    return np.stack([116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))], -1)


def _vertex_lab(ob, img):
    me = ob.data
    uv = np.zeros((len(me.vertices), 2))
    lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get("vertex_index", lv)
    uvd = np.empty(len(me.loops) * 2); me.uv_layers.active.data.foreach_get("uv", uvd)
    uv[lv] = uvd.reshape(-1, 2)
    W, H = img.size
    px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
    ix = np.clip((uv[:, 0] * W).astype(int), 0, W - 1); iy = np.clip((uv[:, 1] * H).astype(int), 0, H - 1)
    return _lab(px[iy, ix, :3].astype(np.float64)), uv


def _classes(co, lab):
    L, a, b = lab[:, 0], lab[:, 1], lab[:, 2]
    C = np.hypot(a, b); hue = np.degrees(np.arctan2(b, a))
    z = co[:, 2]
    return dict(
        L=L, C=C,
        glove=(C > GLOVE_C_MIN) & (hue > GLOVE_HUE[0]) & (hue < GLOVE_HUE[1]) & (L > 12),
        # the glove with its shadows: any brown, however dark, against the vest's neutral black (C* under 5)
        brown=(C > BROWN_C_MIN) & (hue > BROWN_HUE[0]) & (hue < BROWN_HUE[1]) & (L > 6),
        gun=(L > GUN_L[0]) & (L < GUN_L[1]) & (C < GUN_C_MAX),
        khaki=(L > KHAKI_L[0]) & (L < KHAKI_L[1]) & (C > KHAKI_C[0]) & (C < KHAKI_C[1]) & (hue > KHAKI_HUE[0]) & (hue < KHAKI_HUE[1]),
        skin=(C > SKIN_C_MIN) & (L > SKIN_L_MIN) & (a > SKIN_A_MIN),
        # the boot: its tan leather by colour up to the trouser's blouse, and EVERYTHING under the boot's top whatever
        # the bake says (the dark rubber sole is not tan; left on the shin it dipped under the ground when the ankle flexed)
        boot=((C > BOOT_C_MIN) & (z < BOOT_Z_MAX)) | (z < BOOT_TOP_M),
    )


# ---------------------------------------------------------------------------
# the figure's joints, measured on the normalised shell
# ---------------------------------------------------------------------------

def _measure(co, cls, S, seeds):
    z = co[:, 2]
    J = {"S": S, "sxy": 1.0, "sz": 1.0}
    near = lambda p, r, m: (np.linalg.norm(co - np.asarray(p), axis=1) < r) & m  # noqa: E731
    # crotch: the first 2 cm band, scanning down from 0.58 S, in which the legs are two bodies
    crotch = 0.47 * S
    for lo in np.arange(0.58, 0.36, -0.01):
        m = (z > lo * S) & (z < lo * S + 0.02); ys = co[m, 1]; pos, neg = ys[ys > 0], ys[ys < 0]
        if len(pos) and len(neg) and pos.min() - neg.max() > 0.04 * S:
            crotch = float(lo * S + 0.02); break
    J["crotch"], J["belt"], J["knee"], J["ankle"] = crotch, crotch + BELT_ABOVE_CROTCH, KNEE_F * S, ANKLE_M
    m = (z > J["knee"] - 0.05) & (z < J["knee"] + 0.05); P = co[m]
    J["leg"] = {"R": P[P[:, 1] < 0, :2].mean(0), "L": P[P[:, 1] > 0, :2].mean(0)}
    m = (z > 0.06) & (z < 0.12); P = co[m]
    J["ankle_xy"] = {"R": P[P[:, 1] < 0, :2].mean(0), "L": P[P[:, 1] > 0, :2].mean(0)}
    hm = (z > 1.50 / 1.78 * S) & (z < 1.70 / 1.78 * S); J["head_xy"] = co[hm, :2].mean(0)
    skin = cls["skin"] & (z > 1.40 / 1.78 * S) & (z < 1.70 / 1.78 * S) & (co[:, 0] > J["head_xy"][0]) & ~cls["glove"]
    J["chin"] = float(np.percentile(z[skin], 4)); J["neck"] = J["chin"] - 0.06
    # fists: the glove-coloured blob about each seed
    J["fist"] = {}
    for side, seed in seeds["fist"].items():
        p = np.asarray(seed, float)
        for _ in range(4):
            m = near(p, 0.09, cls["glove"]); p = co[m].mean(0)
        J["fist"][side] = p
    # the gun: gun-coloured vertices along the seeded bore, PCA, iterated
    b = np.asarray(seeds["gun"]["butt"], float); mz = np.asarray(seeds["gun"]["muzzle"], float)
    for _ in range(6):
        ax = (mz - b) / np.linalg.norm(mz - b); e = (co - b) @ ax
        rr = np.linalg.norm(co - b - np.outer(e, ax), axis=1)
        m = cls["gun"] & (rr < 0.06) & (e > -0.08) & (e < np.linalg.norm(mz - b) + 0.08)
        P = co[m]; c = P.mean(0); w, v = np.linalg.eigh(np.cov((P - c).T)); a2 = v[:, 2]
        a2 = a2 if a2 @ ax > 0 else -a2
        e2 = (P - c) @ a2; b = c + a2 * e2.min(); mz = c + a2 * e2.max()
    length = float(np.linalg.norm(mz - b))
    if not (GUN_LEN_BAND[0] <= length <= GUN_LEN_BAND[1]):
        raise SystemExit(f"the Meshy gun measures {length:.3f} m, outside {GUN_LEN_BAND} (0.85 m +-15 %): refused")
    up = np.array([0.0, 0.0, 1.0]); up = up - a2 * (up @ a2); up /= np.linalg.norm(up)
    J["gun"] = dict(butt=b, muzzle=mz, axis=a2, up=up, length=length, centre=(b + mz) / 2, n=int(m.sum()))
    # shoulders: the shoulder band's outer surface, SHOULDER_IN inside it, at the deltoid's own x
    J["shoulder"] = {}
    for side, sgn in (("R", -1), ("L", 1)):
        m = (z > SHOULDER_Z - 0.02) & (z < SHOULDER_Z + 0.02) & (sgn * co[:, 1] > 0); P = co[m]; w = (sgn * P[:, 1]).max()
        outer = P[sgn * P[:, 1] > w - 0.10]
        J["shoulder"][side] = np.array((outer[:, 0].mean(), sgn * (w - SHOULDER_IN), SHOULDER_Z))
    # elbows: the sleeve's farthest point from the shoulder-to-fist chord near the seed, pulled 4.5 cm in
    J["elbow"] = {}
    for side, seed in seeds["elbow"].items():
        sD, fD = J["shoulder"][side], J["fist"][side]
        m = near(seed, 0.10, cls["khaki"]); P = co[m]
        d = fD - sD; d /= np.linalg.norm(d); t = (P - sD) @ d; dist = np.linalg.norm(P - sD - np.outer(t, d), axis=1)
        tip = P[dist >= np.percentile(dist, 85)].mean(0)
        chord = sD + d * ((tip - sD) @ d); inward = (chord - tip) / np.linalg.norm(chord - tip)
        J["elbow"][side] = tip + inward * 0.045
    J["wrist"] = {}
    for side in ("R", "L"):
        d = J["fist"][side] - J["elbow"][side]; d /= np.linalg.norm(d)
        J["wrist"][side] = J["fist"][side] - d * WRIST_BACK_M
    return J


def _real_size_hands(co, cls, J):
    """The fists to real size, the JOINTS half: each fist's new centre and wrist (FIST_SCALE about the part of the gun it
    holds), each elbow placed FOREARM_F x S from its wrist, and the scale's pivot kept as J["fist_pivot"]. The geometry is
    scaled later, per figure, by each vertex's own HAND-bone weight (`_shrink_fists`): a colour mask left glove vertices
    outside it at full size, and the faces between them tore into slivers once the fist rolled (review, 9 Nov, N1)."""
    J["fist_pivot"] = {}
    for side in ("R", "L"):
        fist, wr = J["fist"][side], J["wrist"][side]
        d = (fist - wr) / np.linalg.norm(fist - wr)
        dist = np.linalg.norm(co - fist, axis=1)
        gm = cls["gun"] & (dist < FIST_GRIP_REACH_M)
        G = co[gm].mean(0) if gm.sum() >= 8 else fist.copy()
        J["fist_pivot"][side] = G
        J["fist"][side] = G + (fist - G) * FIST_SCALE[side]
        J["wrist"][side] = J["fist"][side] - d * WRIST_BACK_M * FIST_SCALE[side]
        e0 = J["elbow"][side]; u = (e0 - J["wrist"][side]) / np.linalg.norm(e0 - J["wrist"][side])
        e1 = J["wrist"][side] + u * FOREARM_F * J["S"]
        mv = e1 - e0
        if np.linalg.norm(mv) > FOREARM_MOVE_MAX_M:
            e1 = e0 + mv / np.linalg.norm(mv) * FOREARM_MOVE_MAX_M
        J["elbow"][side] = e1
        log(f"  real-size hands {side}: pivot {np.round(G, 3)}; elbow moved {np.linalg.norm(e1 - e0) * 100:.1f} cm, "
            f"forearm {np.linalg.norm(e0 - wr):.3f} -> {np.linalg.norm(e1 - J['wrist'][side]):.3f} m")


def _open_fist_wrap(ob, prefix, out, w, gun):
    """The firing fist's wrap, opened where the gun is inside it (review, 9 Nov: the gun 20.3-21.3 mm inside the fist, the
    grip faces Meshy fused to it): every glove vertex the hand owns (weight >= 0.5) that lies INSIDE the gun's surface,
    within WRAP_REACH_M of it, moves out to that surface plus WRAP_CLEAR_M along its normal. The gun is not moved."""
    from mathutils.bvhtree import BVHTree
    polys = np.array([p.vertices[:] for p in ob.data.polygons if len(p.vertices) == 3 or True], dtype=object)
    gf = [tuple(p) for p in polys if all(gun[i] for i in p)]
    if not gf:
        return out
    bvh = BVHTree.FromPolygons([Vector(v) for v in out], gf)
    moved, deepest = 0, 0.0
    for i in np.nonzero((w >= 0.5) & ~gun)[0]:
        v = Vector(out[i])
        loc, nor, _idx, dist = bvh.find_nearest(v, WRAP_REACH_M)
        if loc is None or (v - loc).dot(nor) >= 0.0:
            continue
        out[i] = np.array(loc + nor * WRAP_CLEAR_M)
        moved += 1; deepest = max(deepest, dist)
    log(f"{prefix}: firing fist's wrap opened: {moved} glove vertices out of the gun (deepest {deepest * 1000:.1f} mm)")
    return out


def _shrink_fists(ob, prefix, J, W, names, roles, co):
    """The fists to real size, the GEOMETRY half: every vertex moves toward its side's pivot by (1 - FIST_SCALE) x its
    weight on that hand bone, so the rigid fist scales by FIST_SCALE and the cuff's blend scales in proportion: no
    vertex of a glove is left at full size beside a scaled neighbour. The firing fist then stands FIRING_FIST_OUT_M off the
    gun's rigid surface it holds (along the gun-to-fist direction): the sculpted grip faces kept on the hand had the
    gun 16.7-21.4 mm inside the fist (review, 9 Nov). Returns the new coordinates (written to the mesh)."""
    gi = {n: i for i, n in enumerate(names)}
    out = co.copy()
    gun = roles["gun"]
    for side in ("R", "L"):
        col = gi.get(f"{prefix}_hand_{RIG_SIDE[side]}")
        if col is None:
            continue
        w = W[:, col]
        G = J["fist_pivot"][side]
        k = 1.0 - (1.0 - FIST_SCALE[side]) * w
        out = out + 0.0
        out[w > 0] = G + (out[w > 0] - G) * k[w > 0, None]
        if side == "R" and OPEN_FIST_WRAP:
            out = _open_fist_wrap(ob, prefix, out, w, gun)
        if side == "R" and FIRING_FIST_OUT_M > 0:
            fist = J["fist"][side]
            near = gun & (np.linalg.norm(co - fist, axis=1) < 0.08)
            if near.sum() >= 8:
                n_ = fist - co[near].mean(0); n_ /= np.linalg.norm(n_)
                out[w > 0] += np.outer(w[w > 0], n_ * FIRING_FIST_OUT_M)
                log(f"{prefix}: firing fist stood {FIRING_FIST_OUT_M * 1000:.0f} mm off the gun ({int(near.sum())} gun vertices it holds)")
        log(f"{prefix}: fist {side} scaled x{FIST_SCALE[side]} by hand weight ({int((w > 0.999).sum())} rigid + {int(((w > 0) & (w < 0.999)).sum())} blended vertices)")
    ob.data.vertices.foreach_set("co", out.reshape(-1)); ob.data.update()
    return out


def _scale_joints(J, sz, sxy):
    """The joints of a figure scaled (xy about the origin, z about the ground)."""
    def s(p):
        p = np.asarray(p, float)
        return p * np.array([sxy, sxy, sz]) if p.shape[-1] == 3 else p * sxy
    out = dict(J, sxy=sxy, sz=sz)
    for k in ("S", "crotch", "belt", "knee", "ankle", "chin", "neck"):
        out[k] = J[k] * sz
    out["head_xy"] = s(J["head_xy"])
    for k in ("leg", "ankle_xy", "fist", "shoulder", "elbow", "wrist") + (("fist_pivot",) if "fist_pivot" in J else ()):
        out[k] = {side: s(v) for side, v in J[k].items()}
    g = J["gun"]
    out["gun"] = dict(butt=s(g["butt"]), muzzle=s(g["muzzle"]))
    ax = out["gun"]["muzzle"] - out["gun"]["butt"]; L = float(np.linalg.norm(ax)); ax /= L
    up = np.array([0.0, 0.0, 1.0]); up = up - ax * (up @ ax); up /= np.linalg.norm(up)
    out["gun"].update(axis=ax, up=up, length=L, centre=(out["gun"]["butt"] + out["gun"]["muzzle"]) / 2)
    return out


# ---------------------------------------------------------------------------
# the bone table (rig.py's names and parents, this figure's joints)
# ---------------------------------------------------------------------------

def _bone_table(prefix, J, dx, dy):
    hx, hy = J["head_xy"]
    px, py = (J["leg"]["R"] + J["leg"]["L"]) / 2
    z_sh = max(J["shoulder"][s][2] for s in ("R", "L"))
    table = [
        ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        ("pelvis", "root", (px, py, J["crotch"] - 0.05), (px, py, J["belt"])),
        # vertical, as rig.py's: the mocap retarget adds the capture's lean to the rest, and a spine resting 10 deg
        # forward (pelvis to head) put `fire` at 55 deg where the shipped rig leans 44, with the eye under the bore
        ("spine", "pelvis", (px, py, J["belt"]), (px, py, z_sh - 0.02)),
        ("neck", "spine", (hx, hy, J["neck"]), (hx, hy, J["chin"])),
        ("head", "neck", (hx, hy, J["chin"]), (hx, hy, J["S"])),
    ]
    for side in ("R", "L"):
        r = RIG_SIDE[side]
        table.append((f"upperarm_{r}", "spine", tuple(J["shoulder"][side]), tuple(J["elbow"][side])))
        table.append((f"forearm_{r}", f"upperarm_{r}", tuple(J["elbow"][side]), tuple(J["wrist"][side])))
        # the hand bone: wrist -> toward the fist's centre, 0.08 long (hands-pass convention: y distal)
        d = J["fist"][side] - J["wrist"][side]; d = d / np.linalg.norm(d)
        table.append((f"hand_{r}", f"forearm_{r}", tuple(J["wrist"][side]), tuple(J["wrist"][side] + d * 0.08)))
        lx, ly = J["leg"][side]; ax_, ay_ = J["ankle_xy"][side]
        table.append((f"thigh_{r}", "pelvis", (lx, ly, J["crotch"]), (lx, ly, J["knee"])))
        table.append((f"shin_{r}", f"thigh_{r}", (lx, ly, J["knee"]), (ax_, ay_, J["ankle"])))
    out = rig._translate(table, dx, dy, prefix)
    for side in ("R", "L"):
        r = RIG_SIDE[side]; lx, ly = J["leg"][side]
        out.append((f"{prefix}_hip_{r}", f"{prefix}_pelvis", (lx + dx, ly + dy, J["crotch"]),
                    (lx + dx, ly + dy, J["crotch"] - 0.15 * (J["crotch"] - J["knee"]))))
    out.append(rig._death_root_bone(prefix, dx, dy))
    return out


# ---------------------------------------------------------------------------
# the shell: load, normalise, weight, split by role
# ---------------------------------------------------------------------------

def _load(team_id):
    cfg = SOURCES[team_id]
    paths = sorted(glob.glob(cfg["glob"]))
    if not paths:
        raise SystemExit(f"{team_id}: no remesh at {cfg['glob']} (gitignored; restore it from the art backup)")
    bpy.ops.import_scene.gltf(filepath=paths[0])
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"{team_id}: expected one mesh, found {[o.name for o in meshes]}")
    ob = meshes[0]
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for other in list(bpy.data.objects):
        if other is not ob:
            bpy.data.objects.remove(other, do_unlink=True)
    # the bake: one material, its base colour image kept and named `base_color`; the other maps dropped
    mats = [m for m in ob.data.materials if m is not None]
    mat = mats[0]; tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next(l for l in tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color")
    base = link.from_node.image
    for node in list(tree.nodes):
        if node.type == "TEX_IMAGE" and node.image is not base:
            tree.nodes.remove(node)
    for img in list(bpy.data.images):
        if img is not base and img.users == 0:
            bpy.data.images.remove(img)
    base.name = "base_color"
    bsdf.inputs["Roughness"].default_value = 0.85; bsdf.inputs["Metallic"].default_value = 0.0
    me = ob.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    zmin = co[:, 2].min(); k = cfg["stature"] / (co[:, 2].max() - zmin)
    M = Matrix.Rotation(math.radians(cfg["yaw_deg"]), 4, "Z") @ Matrix.Scale(k, 4) @ Matrix.Translation((0, 0, -zmin))
    co = np.array([(M @ Vector(v))[:] for v in co])
    sh = co[co[:, 2] < 0.12][:, :2].mean(0)
    co[:, :2] -= sh
    me.vertices.foreach_set("co", co.reshape(-1))
    me.update()
    log(f"{team_id}: {os.path.relpath(paths[0], REPO)} -> stature {cfg['stature']} (scale {k:.4f}, yaw {cfg['yaw_deg']}), "
        f"{len(me.polygons)} tris, {len(me.vertices)} verts, bake {base.size[0]}x{base.size[1]}")
    return ob, base, co


def _figure_shell(src, prefix, sz, sxy, dx, dy):
    ob = src.copy(); ob.data = src.data.copy(); ob.name = f"{prefix}_shell"
    bpy.context.collection.objects.link(ob)
    me = ob.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    co = co * np.array([sxy, sxy, sz]) + np.array([dx, dy, 0.0])
    me.vertices.foreach_set("co", co.reshape(-1)); me.update()
    return ob, co


def _auto_weights(ob, arm_obj):
    """Blender's bone-heat weights, solved on a WELDED copy of the shell and copied back by position.

    The Meshy GLB stores the remesh split at every UV seam (17,182 vertices for 10,405 triangles, every edge a
    boundary), and bone heat fails outright on it ("failed to find solution for one or more bones", every weight 0).
    Welded at 10 um it is one closed shell of 5,153 vertices and the solve succeeds; each split vertex then takes
    the weight of the welded vertex at its position, so the UVs ship untouched."""
    w = ob.copy(); w.data = ob.data.copy(); w.name = f"{ob.name}_welded"
    bpy.context.collection.objects.link(w)
    bm = bmesh.new(); bm.from_mesh(w.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(w.data); bm.free()
    bpy.ops.object.select_all(action="DESELECT")
    w.select_set(True); arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.ops.object.select_all(action="DESELECT")
    names, Ww = _weights(w)
    if (Ww.sum(1) < 1e-6).any():
        raise SystemExit(f"{ob.name}: bone heat left {int((Ww.sum(1) < 1e-6).sum())} welded vertices unweighted")
    pw = np.empty(len(w.data.vertices) * 3); w.data.vertices.foreach_get("co", pw); pw = pw.reshape(-1, 3)
    po = np.empty(len(ob.data.vertices) * 3); ob.data.vertices.foreach_get("co", po); po = po.reshape(-1, 3)
    key = {tuple(np.round(v, 5)): i for i, v in enumerate(pw)}
    idx = np.array([key[tuple(np.round(v, 5))] for v in po])
    W = Ww[idx]
    for name in names:
        ob.vertex_groups.new(name=name)
    _set_weights(ob, names, W)
    mod = ob.modifiers.new(name="Armature", type="ARMATURE"); mod.object = arm_obj; mod.use_vertex_groups = True
    ob.parent = arm_obj; ob.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    bpy.data.objects.remove(w, do_unlink=True)
    log(f"{ob.name}: bone heat on the welded shell ({len(pw)} verts) copied to {len(po)} split verts")


def _weights(ob):
    names = [g.name for g in ob.vertex_groups]
    W = np.zeros((len(ob.data.vertices), len(names)))
    for v in ob.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    return names, W


def _set_weights(ob, names, W):
    for gi, name in enumerate(names):
        vg = ob.vertex_groups[name]
        vg.remove(list(range(len(ob.data.vertices))))
        idx = np.nonzero(W[:, gi] > 1e-4)[0]
        for i in idx:
            vg.add([int(i)], float(W[i, gi]), "REPLACE")


def _fix_weights(ob, prefix, J, cls, co):
    """The corrections bone heat cannot know: a rigid gun, rigid fists, a cuff blend, and no arm on the torso core."""
    names, W = _weights(ob)
    # Bone heat was solved against the whole team's armature: a figure's shell took weight from its NEIGHBOUR's bones
    # (f1's back pouch carried f2_upperarm_L 0.10 + f2_forearm_L 0.10 and flew off behind him in fire: the "floating
    # black piece" of the 1 Nov renders). Nothing of a figure rides another figure's bone.
    foreign = [i for i, n in enumerate(names) if not n.startswith(prefix + "_")]
    if foreign:
        took = int((W[:, foreign].sum(1) > 1e-4).sum())
        W[:, foreign] = 0.0
        log(f"{prefix}: {took} vertices had weight on another figure's bones ({len(foreign)} groups): removed")
    gi = {n: i for i, n in enumerate(names)}
    def col(bone):
        key = f"{prefix}_{bone}"
        if key not in gi:
            names.append(key); gi[key] = len(names) - 1
            ob.vertex_groups.new(name=key)
            return np.zeros(len(co)), gi[key]
        return W[:, gi[key]], gi[key]
    g = J["gun"]; ax = g["axis"]; e = (co - g["butt"]) @ ax
    radial = co - g["butt"] - np.outer(e, ax)
    rr = np.linalg.norm(radial, axis=1)
    along = (e > -0.03) & (e < g["length"] + 0.03)
    # The gun lies ON the vest, and the bake paints both near-black, so colour cannot part them (measured: 1,540 black
    # vertices within 7.5 cm of the bore against 383 grey-blue ones). Geometry does: the torso is on ONE side of the bore.
    # From each bore station, the direction to the torso's centre (across the bore); a vertex further than
    # GUN_BODY_SIDE_M toward the torso is the vest, whatever its colour.
    spine_xy = (J["leg"]["R"] + J["leg"]["L"]) / 2
    toward = np.zeros_like(co)
    toward[:, 0] = spine_xy[0] - (g["butt"][0] + e * ax[0]); toward[:, 1] = spine_xy[1] - (g["butt"][1] + e * ax[1])
    toward -= np.outer(toward @ ax, ax)
    tn = np.linalg.norm(toward, axis=1); tn[tn < 1e-9] = 1.0
    depth_to_body = (radial * toward).sum(1) / tn          # + toward the torso, - away from it
    on_body_side = depth_to_body > GUN_BODY_SIDE_M
    on_body_side_deep = depth_to_body > 0.10          # the chest plate proper, behind the pocket
    gun = along & (rr < GUN_NEAR_M) & ~cls["brown"] & ~cls["khaki"] & ~cls["skin"] & ~on_body_side
    # the stock's pocket: Meshy shaped the vest around the butt, and parted from it that black cup stood 10 cm proud of
    # the chest in fire and pinned, reading as a piece floating by the shoulder (40 vertices, L* 2, 0.05-0.125 off the
    # bore, 1-8 cm ahead of the butt). It is the fusion's remnant and goes with the stock.
    black = (cls["L"][: len(co)] <= 9.0) & (cls["C"][: len(co)] < 5.0)
    pocket = (e > -0.03) & (e < STOCK_POCKET_M) & (rr < 0.125) & black & ~on_body_side_deep
    gun |= pocket
    # ...and the gun's own black parts that the bake did not paint grey-blue (the magazine's underside between the
    # fists, L* 2): bone heat gave them the two hands' weights and they tore 40 cm in pinned
    gun |= along & (rr < 0.09) & black & ~on_body_side
    if pocket.any():
        log(f"{prefix}: {int(pocket.sum())} vertices of the vest's stock pocket go with the stock")
    # the magazine: below the bore, ahead of the grip, away from the body
    gun |= along & cls["gun"] & (rr < 0.20) & ((co - g["butt"]) @ g["up"] < -0.03) & (e > 0.30 * g["length"]) & (e < 0.60 * g["length"]) & (depth_to_body < 0.0)
    # a small island of the shell (a sling loop, a buckle) inside the gun's corridor is the gun's, whatever its
    # colour: left on the spine, the stock's rear loop stayed at the chest when the carbine came up to the shoulder
    # (a 45-vertex piece floating beside the figure in `fire`, 1 Nov)
    me_ = ob.data
    polys_ = np.empty(len(me_.polygons) * 3, np.int64); me_.polygons.foreach_get("vertices", polys_); polys_ = polys_.reshape(-1, 3)
    parent = np.arange(len(co))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    weld = {}
    for i, pos in enumerate(np.round(co, 5)):
        k = tuple(pos)
        if k in weld:
            parent[find(i)] = find(weld[k])
        else:
            weld[k] = i
    for t in polys_:
        parent[find(t[0])] = find(t[1]); parent[find(t[1])] = find(t[2])
    comp = np.array([find(i) for i in range(len(co))])
    sizes = np.bincount(comp)
    small = sizes[comp] < SMALL_ISLAND_VERTS
    island_gun = small & along & (rr < ISLAND_NEAR_BORE_M) & ~cls["brown"] & ~cls["skin"]
    if island_gun.any():
        log(f"{prefix}: {int(island_gun.sum())} vertices of small islands in the gun's corridor taken as the gun")
    gun |= island_gun
    hands = {}
    for side in ("R", "L"):
        wr, fist = J["wrist"][side], J["fist"][side]
        d = (fist - wr) / np.linalg.norm(fist - wr)
        t = (co - wr) @ d
        # the glove, by its brown (shadowed texels included) within a hand's reach of the fist's centre, plus the fist's
        # own core whatever the bake says; the vest behind the fist is black (C* under 5) and stays with the torso
        dist = np.linalg.norm(co - fist, axis=1)
        blob = (((dist < 0.12) & cls["brown"]) | ((dist < FIST_CORE_M) & ~small)) & ~(cls["gun"] & (rr < GUN_NEAR_M))
        hand = blob & (t > 0.0)
        cuff = blob & (t <= 0.0) & (t > -CUFF_BLEND_M)
        hands[side] = (hand, cuff, t)
        gun &= ~hand & ~cuff
    # Meshy's loose debris: a small island that touches nothing at rest (a strap's end, a scrap of the stock's pocket),
    # 3.5-6 cm off the body in the bind pose and swinging with the spine in fire (12-69 vertices each, the census of
    # 1 Nov: three in idle, twelve in fire). Not the gun's, not a fist's: the role split deletes it.
    hand_any = np.zeros(len(co), bool)
    for h_, c_, _t in hands.values():
        hand_any |= h_ | c_
    debris = np.zeros(len(co), bool)
    body_co = co[~small & ~gun & ~hand_any]
    for c_id in np.unique(comp[small & ~gun & ~hand_any]):
        idx = np.nonzero(comp == c_id)[0]
        if gun[idx].any() or hand_any[idx].any():
            continue
        gap = min(np.sqrt(((body_co[None] - co[idx[i:i + 32], None]) ** 2).sum(-1)).min() for i in range(0, len(idx), 32))
        if gap > DEBRIS_GAP_M:
            debris[idx] = True
    if debris.any():
        log(f"{prefix}: {int(debris.sum())} vertices of {len(np.unique(comp[debris]))} loose islands (over {DEBRIS_GAP_M * 100:.0f} cm from the body at rest) marked as debris")
    if W.shape[1] < len(names):
        W = np.pad(W, ((0, 0), (0, len(names) - W.shape[1])))
    # the gun: everything on forearm_R (the motion pass rebinds it to the weapon bone)
    W[gun, :] = 0.0
    W[gun, gi[f"{prefix}_forearm_R"]] = 1.0
    # the hands
    for side, (hand, cuff, t) in hands.items():
        r = RIG_SIDE[side]
        hb, fb = gi[f"{prefix}_hand_{r}"], gi[f"{prefix}_forearm_{r}"]
        W[hand, :] = 0.0; W[hand, hb] = 1.0
        # 0 at the sleeve end, just under a half at the wrist plane: the cuff is the SLEEVE's (olive, round 3), and the
        # hand-dominant surface -- what the glove gate samples as the glove -- is the glove alone
        k = CUFF_HAND_MAX * np.clip((t[cuff] + CUFF_BLEND_M) / CUFF_BLEND_M, 0.0, 1.0)
        W[cuff, :] = 0.0; W[cuff, hb] = k; W[cuff, fb] = 1.0 - k
    # the torso: no arm or hand weight on the vest and the chest. Bone heat leaks through the welded armpit and
    # under the forearm that lies on the vest; posed, that tore the plate carrier into shards (pose probe, 1 Nov).
    # A vertex in the torso band, inside the shoulders' width, that lies in neither arm's capsule is the torso.
    spine_xy = (J["leg"]["R"] + J["leg"]["L"]) / 2
    z = co[:, 2]
    arm_cols = [gi[f"{prefix}_{b}"] for b in ("upperarm_L", "forearm_L", "hand_L", "upperarm_R", "forearm_R", "hand_R") if f"{prefix}_{b}" in gi]
    def capsule(a, b, r):
        a = np.asarray(a); b = np.asarray(b); d = b - a; L2 = d @ d
        t = np.clip(((co - a) @ d) / L2, 0.0, 1.0)
        return np.linalg.norm(co - a - np.outer(t, d), axis=1) < r
    # an arm's capsule protects its SLEEVE and glove (khaki, brown) and its own core; the black vest a forearm lies on
    # is torso however close it is to the bone
    # ...and, where a forearm lies ON the belly (the firing forearm does, at rest), only the OUTER half of its capsule
    # is the sleeve: the inner half is the trousers and the vest under it, khaki too. Measured in fire: 209 triangles
    # stretched 10-28 cm between the belly (forearm_L 0.5-0.98 from bone heat) and the arm that had left it.
    def outer_half(a, b, r):
        a = np.asarray(a); b = np.asarray(b); d = b - a; L2 = d @ d
        t = np.clip(((co - a) @ d) / L2, 0.0, 1.0); q = a + np.outer(t, d)
        radial = co - q
        outward = q - np.array([spine_xy[0], spine_xy[1], 0.0]); outward[:, 2] = 0.0
        outward /= np.maximum(np.linalg.norm(outward, axis=1), 1e-9)[:, None]
        return (np.linalg.norm(radial, axis=1) < r) & ((radial * outward).sum(1) > -0.01)
    near_arm = np.zeros(len(co), bool); arm_core = np.zeros(len(co), bool)
    for side in ("R", "L"):
        near_arm |= capsule(J["shoulder"][side], J["elbow"][side], ARM_CAPSULE_R["upper"])
        near_arm |= outer_half(J["elbow"][side], J["wrist"][side], ARM_CAPSULE_R["fore"])
        arm_core |= capsule(J["shoulder"][side], J["elbow"][side], ARM_CAPSULE_R["upper"] * 0.5)
        arm_core |= capsule(J["elbow"][side], J["wrist"][side], ARM_CAPSULE_R["fore"] * 0.45)
    # ...and out at the arm's own lateral position, whatever the bake says (the black elbow pad, the strap over the
    # upper arm): cleared, they tore 12-17 cm off the sleeve in pinned and moveFire
    lateral = np.abs(co[:, 1] - spine_xy[1]) > ARM_LATERAL_M * J["sxy"]
    upper_any = np.zeros(len(co), bool)
    for side in ("R", "L"):
        upper_any |= capsule(J["shoulder"][side], J["elbow"][side], ARM_CAPSULE_R["upper"])
    near_arm = (near_arm & (cls["khaki"] | cls["brown"])) | arm_core | (upper_any & lateral)
    # an arm's capsule carries no weight of the OTHER arm: bone heat put the firing hand's weight (0.26) on the support
    # arm's sleeve across the chest, which stretched 25 cm in pinned
    for side in ("R", "L"):
        r_, o_ = RIG_SIDE[side], RIG_SIDE["L" if side == "R" else "R"]
        mine = capsule(J["shoulder"][side], J["elbow"][side], ARM_CAPSULE_R["upper"]) | capsule(J["elbow"][side], J["wrist"][side], ARM_CAPSULE_R["fore"] + 0.03)
        other_cols = [gi[f"{prefix}_{b}_{o_}"] for b in ("upperarm", "forearm", "hand") if f"{prefix}_{b}_{o_}" in gi]
        for h in hands.values():
            mine &= ~h[0] & ~h[1]
        W[np.ix_(mine & ~gun, other_cols)] = 0.0
    # the trunk from the crotch to the shoulder cap, hung kit included (the hip holster the firing elbow rested on took
    # arm weights from bone heat and flew up with the arm in `fire`, trailing slivers from the belt), as wide as the
    # elbows: whatever in it is neither an arm's own sleeve or glove nor the gun is the body
    chest = (z > J["belt"] - 0.06) & (z < J["shoulder"]["R"][2] + 0.10) & (np.abs(co[:, 1] - spine_xy[1]) < TORSO_HALF_W * J["sxy"])
    hips = (z > J["crotch"] - 0.12) & (z < J["crotch"] + HIP_KIT_ABOVE_CROTCH) & (np.abs(co[:, 1] - spine_xy[1]) < HIP_HALF_W * J["sxy"])
    core = (chest | hips) & ~near_arm & ~gun
    for h in hands.values():
        core &= ~h[0] & ~h[1]
    W[np.ix_(core, arm_cols)] = 0.0
    # the legs do not own the belly: above the belt, bone heat's thigh weight (up to 0.4 at the belt line) made the
    # vest's lower edge follow the squat
    leg_cols = [gi[f"{prefix}_{b}"] for b in ("thigh_L", "shin_L", "thigh_R", "shin_R") if f"{prefix}_{b}" in gi]
    # ...faded out over the 8 cm under the belt rather than cut at it (a hard cut left the belt's pouches half on the
    # thigh and half not, 10 cm apart in fire)
    trunk_wide = (z > J["belt"] - 0.08) & (z < J["shoulder"]["R"][2] + 0.10) & (np.abs(co[:, 1] - spine_xy[1]) < HIP_HALF_W * J["sxy"]) & ~gun & ~near_arm
    fade = np.clip((z - (J["belt"] - 0.08)) / 0.08, 0.0, 1.0)
    for c_ in leg_cols:
        W[trunk_wide, c_] *= (1.0 - fade[trunk_wide])
    # where a forearm meets the trunk, the boundary is HARD: a vertex that is mostly forearm is all forearm, one that
    # is mostly trunk has none of it (bone heat's soft falloff across the belly tore 11 cm in fire, forearm 0.46 against
    # a neighbour at 0.81). The hand and the elbow blends are untouched: only the trunk's share moves.
    trunk_cols = [gi[f"{prefix}_{b}"] for b in ("spine", "pelvis", "thigh_L", "thigh_R") if f"{prefix}_{b}" in gi]
    for side in ("R", "L"):
        fcol = gi[f"{prefix}_forearm_{RIG_SIDE[side]}"]
        zone = capsule(J["elbow"][side], J["wrist"][side], ARM_CAPSULE_R["fore"] + 0.03)
        fw = W[:, fcol]
        mostly = zone & (fw >= 0.5)
        W[np.ix_(mostly, trunk_cols)] = 0.0
        barely = zone & (fw > 0.0) & (fw < 0.5)
        W[barely, fcol] = 0.0
    below_neck = (z < J["neck"] - 0.02) & ~cls["skin"]
    for b in ("neck", "head"):
        if f"{prefix}_{b}" in gi:
            W[below_neck, gi[f"{prefix}_{b}"]] = 0.0
    # at most MAX_INFLUENCES per vertex (the smallest dropped), then normalise; a vertex left with nothing falls to the spine
    if W.shape[1] > MAX_INFLUENCES:
        order = np.argsort(W, axis=1)[:, :-MAX_INFLUENCES]
        np.put_along_axis(W, order, 0.0, axis=1)
    tot = W.sum(1)
    orphan = tot < 1e-6
    W[orphan, gi[f"{prefix}_spine"]] = 1.0
    tot = W.sum(1)
    W /= tot[:, None]
    _set_weights(ob, names, W)
    for g in [g for g in ob.vertex_groups if not g.name.startswith(prefix + "_")]:
        ob.vertex_groups.remove(g)
    log(f"{prefix}: weights fixed -- gun {int(gun.sum())} verts rigid on forearm_R, hands "
        f"{' / '.join(f'{s}:{int(h[0].sum())}+{int(h[1].sum())} cuff' for s, h in hands.items())}, torso core cleared of arm weight on "
        f"{int(core.sum())} verts, {int(orphan.sum())} orphans to the spine")
    # `glove` is the hand proper (ahead of the wrist plane): the texels that go dark brown. The cuff behind it is the
    # sleeve's, olive (the lead's ruling, round 3), so the hand-dominant surface the glove gate samples is all glove and
    # the forearm-dominant surface behind the wrist is all sleeve.
    roles = dict(gun=gun, hand={s: h[0] | h[1] for s, h in hands.items()}, glove={s: h[0].copy() for s, h in hands.items()}, debris=debris)
    me = ob.data
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    roles["hand_tris"] = {s: int((h[0][polys].sum(1) >= 2).sum()) for s, h in hands.items()}
    log(f"{prefix}: hand triangles R {roles['hand_tris']['R']} L {roles['hand_tris']['L']} (design band 200 to 450)")
    return names, W, roles


def _census(ob, prefix, W, names):
    gi = {n: i for i, n in enumerate(names)}
    nz = (W > 1e-4).sum(1)
    lines = [f"{prefix}: influences per vertex: 1:{int((nz == 1).sum())} 2:{int((nz == 2).sum())} 3:{int((nz == 3).sum())} 4+:{int((nz >= 4).sum())}"]
    dom = W.argmax(1)
    per = {}
    for i, n in enumerate(names):
        c = int((dom == i).sum())
        if c:
            per[n[len(prefix) + 1:]] = c
    lines.append(f"{prefix}: dominant bone census {per}")
    for l in lines:
        log(l)


def _cut_seams(ob, prefix, J, roles, co, uv_src, cls):
    """Part the gun and the fists from the body they were sculpted against, and cap both sides.

    Meshy fuses whatever touches: the stock lies in the vest, the firing fist rests on it. The faces that straddle such a
    line (one vertex on the gun or a fist, one on the body) stretch into slivers the moment the weapon leaves the
    chest: 0.3 m long in `fire`, as rendered 1 Nov. The design's answer (section 2, steps 2 and 3) was a capped fist
    and a patched shoulder; this is that, in code, on the skinned shell:

      * S = the gun and the two fists; the cuff and the sleeve within WRIST_FREE_M of a wrist are NOT body (the
        wrist is a smooth blend, never cut);
      * every face with a vertex in S and a vertex in the body is a seam face: deleted;
      * each side's open boundary is capped by a fan to its own centroid, pushed CAP_INSET_M inward (into the vest for
        the body, toward the bore for the gun, toward the palm for a fist), carrying the boundary's mean weights and
        mean UV. At rest the caps sit inside the fused volume, unseen; moved apart, each side is closed.

    Returns the sets the role split needs (the caps' vertices classed with their side)."""
    me = ob.data
    nV = len(me.vertices)
    gun = roles["gun"]
    hand_all = np.zeros(nV, bool)
    for s_, h in roles["hand"].items():
        hand_all |= h
    # the forearms too (the firing forearm lies along the belly at rest: 163 triangles stretched 10-28 cm between it and
    # the belly in fire): by dominant weight, so the sleeve the arm's capsule kept is the arm's and the trunk (spine,
    # pelvis, legs, neck, head) is the trunk's
    names_ = [g.name for g in ob.vertex_groups]
    Wd = np.zeros((nV, len(names_)))
    for v in me.vertices:
        for g in v.groups:
            Wd[v.index, g.group] = g.weight
    dom = np.array([names_[i][len(prefix) + 1:] if Wd[i_].max() > 0 else "" for i_, i in enumerate(Wd.argmax(1))])
    fore = np.isin(dom, ("forearm_L", "forearm_R"))
    trunk = np.isin(dom, ("spine", "pelvis", "thigh_L", "thigh_R", "shin_L", "shin_R", "neck", "head"))
    S = gun | hand_all | fore
    free = np.zeros(nV, bool)
    for side in ("R", "L"):
        a, b = J["elbow"][side], J["wrist"][side]
        d = b - a; t = np.clip(((co - a) @ d) / (d @ d), 0.0, 1.0)
        in_fore = np.linalg.norm(co - a - np.outer(t, d), axis=1) < ARM_CAPSULE_R["fore"]
        free |= in_fore & (np.linalg.norm(co - b, axis=1) < WRIST_FREE_M)
    free &= (cls["khaki"] | cls["brown"]) & ~trunk   # the sleeve and the glove blend; the trousers beside a wrist are cut
    body = trunk & ~S & ~free                     # the upper arm is neither: its weld to the ribs stays a smooth blend
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    inS = S[polys]; inB = body[polys]
    seam = inS.any(1) & inB.any(1)
    if not seam.any():
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    # boundary edges per side: edges of seam faces whose two ends lie on the same side
    # the shell is split at every UV seam (17,182 vertices for 5,153 positions): chains are joined by POSITION
    weld = {}
    wid = np.empty(nV, np.int64)
    for i, pos in enumerate(np.round(co, 5)):
        k = tuple(pos)
        wid[i] = weld.setdefault(k, i)
    def chains(side_mask):
        edges = set()
        for f in polys[seam]:
            for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
                if side_mask[a] and side_mask[b]:
                    edges.add((min(a, b), max(a, b)))
        # connected components of the edge graph, welded
        adj = {}
        for a, b in edges:
            wa, wb = wid[a], wid[b]
            adj.setdefault(wa, set()).add(wb); adj.setdefault(wb, set()).add(wa)
            adj.setdefault(wa, set()).add(a); adj.setdefault(a, set()).add(wa)
            adj.setdefault(wb, set()).add(b); adj.setdefault(b, set()).add(wb)
        seen, comps = set(), []
        for v in adj:
            if v in seen:
                continue
            stack, comp = [v], []
            seen.add(v)
            while stack:
                x = stack.pop(); comp.append(x)
                for y in adj[x]:
                    if y not in seen:
                        seen.add(y); stack.append(y)
            comps.append(comp)
        return edges, comps
    # weights per vertex (for the caps' means)
    names = [g.name for g in ob.vertex_groups]
    W = np.zeros((nV, len(names)))
    for v in me.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    uvl = me.uv_layers.active.data
    lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get("vertex_index", lv)
    uvd = np.empty(len(me.loops) * 2); uvl.foreach_get("uv", uvd); uvd = uvd.reshape(-1, 2)
    vuv = np.zeros((nV, 2)); vuv[lv] = uvd
    spine_xy = (J["leg"]["R"] + J["leg"]["L"]) / 2
    g = J["gun"]
    new_verts, new_faces, new_class = [], [], []   # class: 0 gun cap, 1 hand cap (side), 3 body cap
    new_w, new_uv = [], []
    # B3 (round 5): a collar quad's loops took its two rim vertices' own uvs -- a ZERO-AREA strip in the atlas along the
    # island's edge, so its texels were the bake's padding (23% of the support glove read the gun's black, L* 0-12). Each
    # collar quad now takes one uv, the centroid of the kept face across its rim edge: that face's own colour.
    loop_start = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get("loop_start", loop_start)
    kept_edge_uv = {}
    for pi in np.nonzero(~seam)[0]:
        f = polys[pi]
        cuv = uvd[loop_start[pi]:loop_start[pi] + 3].mean(0)
        for a_, b_ in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            kept_edge_uv.setdefault((min(a_, b_), max(a_, b_)), cuv)
    new_face_uv = []
    def inward(c, side_tag):
        if side_tag == "body":
            d = np.array([spine_xy[0] - c[0], spine_xy[1] - c[1], 0.0])
        elif side_tag == "gun":
            e = (c - g["butt"]) @ g["axis"]; d = (g["butt"] + g["axis"] * e) - c
        elif side_tag in ("fore_R", "fore_L"):
            a_, b_ = J["elbow"][side_tag[-1]], J["wrist"][side_tag[-1]]; dd = b_ - a_
            t_ = np.clip(((c - a_) @ dd) / (dd @ dd), 0.0, 1.0); d = (a_ + dd * t_) - c
        else:
            d = J["fist"][side_tag] - c
        n = np.linalg.norm(d)
        return d / n if n > 1e-9 else np.zeros(3)
    def cap(comp, edges, side_tag, cls_id):
        """Close an open boundary with an inward COLLAR, not a fan: every boundary vertex gets a twin pushed into its
        own side (into the vest, toward the bore, toward the palm) and each boundary edge a quad to the twins. The
        collar starts ON the surface and goes in, so it cannot poke through a curved chest the way a flat fan did
        (the olive and orange polygons on the vest, 1 Nov); parted, it reads as the pocket the gun or the fist sat in.
        Each twin keeps its vertex's own weights and uv, so the collar continues the surface's own texel inward."""
        if len(comp) < 3:
            return
        cset = set(comp)
        depth = CAP_INSET_BODY_M if side_tag == "body" else CAP_INSET_M
        twin = {}
        for v in comp:
            c = co[v]
            twin[v] = nV + len(new_verts)
            new_verts.append(c + inward(c, side_tag) * depth); new_class.append(cls_id)
            new_w.append(W[v]); new_uv.append(vuv[v])
        for a, b in edges:
            if a in cset and b in cset:
                fuv = kept_edge_uv.get((min(a, b), max(a, b)))
                if fuv is None:
                    fuv = (vuv[a] + vuv[b]) / 2
                new_faces.append((a, b, twin[b]))
                new_faces.append((a, twin[b], twin[a]))
                new_face_uv.extend([fuv, fuv])
    edgesS, compsS = chains(S)
    for comp in compsS:
        # a component is a gun chain, a fist chain or a forearm chain by its majority
        if gun[comp].mean() >= 0.5:
            cap(comp, edgesS, "gun", 0)
        elif hand_all[comp].mean() >= 0.5:
            side = max(("R", "L"), key=lambda s_: roles["hand"][s_][comp].sum())
            cap(comp, edgesS, side, 1)
        else:
            # the anatomical side of a forearm chain: rig _L is the figure's right
            side = "R" if (dom[comp] == "forearm_L").sum() >= (dom[comp] == "forearm_R").sum() else "L"
            cap(comp, edgesS, f"fore_{side}", 3)
    edgesB, compsB = chains(body)
    for comp in compsB:
        cap(comp, edgesB, "body", 3)
    # rebuild the mesh: drop the seam faces, append the caps
    keep_faces = polys[~seam]
    all_faces = np.concatenate([keep_faces, np.array(new_faces, np.int64).reshape(-1, 3)]) if new_faces else keep_faces
    V = np.concatenate([co, np.array(new_verts).reshape(-1, 3)]) if new_verts else co
    old_uv_per_face = vuv  # per vertex; the caps' loops take their vertex's mean uv
    bm = bmesh.new()
    # layers FIRST: adding one after the vertices exist invalidates every BMVert reference held in Python
    uv_layer = bm.loops.layers.uv.new("UVMap")
    dl = bm.verts.layers.deform.new()
    verts = [bm.verts.new(tuple(v)) for v in V]
    bm.verts.ensure_lookup_table(); bm.verts.index_update()
    # per-vertex weights: old ones as they were, caps as means
    for i, v in enumerate(verts):
        row = W[i] if i < nV else new_w[i - nV]
        for gi_, wv in enumerate(row):
            if wv > 1e-5:
                v[dl][gi_] = float(wv)
    # faces: old faces keep their per-loop uvs; caps take the per-vertex uv
    loop_uv = {}
    for pi, f in enumerate(polys):
        if seam[pi]:
            continue
        li = me.polygons[pi].loop_start
        for k in range(3):
            loop_uv[(pi, int(f[k]))] = uvd[li + k]
    made = 0
    for fi, f in enumerate(all_faces):
        try:
            face = bm.faces.new([verts[int(i)] for i in f])
        except ValueError:
            continue   # a duplicate cap face (a boundary edge shared by two caps): one is enough
        made += 1
        src_pi = int(np.nonzero(~seam)[0][fi]) if fi < len(keep_faces) else None
        for loop in face.loops:
            vi = loop.vert.index
            if src_pi is not None and (src_pi, vi) in loop_uv:
                loop[uv_layer].uv = tuple(loop_uv[(src_pi, vi)])
            elif src_pi is None:
                loop[uv_layer].uv = tuple(new_face_uv[fi - len(keep_faces)])
            else:
                loop[uv_layer].uv = tuple(vuv[vi] if vi < nV else new_uv[vi - nV])
    bm.to_mesh(me); bm.free()
    me.update()
    cap_idx = np.arange(nV, nV + len(new_verts))
    log(f"{prefix}: seams cut -- {int(seam.sum())} seam faces removed ({len(compsS)} gun/fist chains, {len(compsB)} body chains), "
        f"{len(new_verts)} collar twins, {len(new_faces)} collar faces ({made - len(keep_faces)} kept)")
    return cap_idx, np.array(new_class, np.int8)


def _split_roles(ob, prefix, cls, roles, co):
    """One object per role: `weapon` (the gun), `boot`, `face`, `uniform` (everything else, the hands included).

    The gun is fused to the vest and the fists, so the faces along that line (one gun vertex, one not) belong to both
    surfaces. They go to the WEAPON mesh whole, where every vertex rides the gun's bone (the carbine is rigid, skirt
    included: no sliver stretches when it leaves the vest), and to the UNIFORM mesh as well, with each gun-side vertex
    collapsed onto its face's nearest body vertex: the vest stays closed where the gun was, and at rest the two copies
    coincide exactly, same bytes, same texels, so nothing shows. Measured need: with the skirt left in `uniform`, the
    first motion-pass run tore it 0.75 m; with the skirt rigid on the gun and no copy, `fire` opened a one-ring hole."""
    me = ob.data
    nV = len(me.vertices)
    vclass = np.full(nV, 3, np.int8)   # 0 weapon 1 boot 2 face 3 uniform
    vclass[cls["boot"]] = 1
    face = cls["skin"] & (co[:, 2] > 1.40 / 1.78 * co[:, 2].max())
    vclass[face] = 2
    gun = roles["gun"]
    vclass[gun] = 0
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    fc = vclass[polys]
    any_gun = (fc == 0).any(1); all_gun = (fc == 0).all(1)
    # the body roles: the majority of a face's NON-gun vertices
    body_major = np.array([np.bincount(f[f != 0], minlength=4).argmax() if (f != 0).any() else 0 for f in fc])
    # The cut's leavings: a small island on the BODY side that the seam cut set loose (a scrap of the stock's pocket, a
    # strap's end on the fist) sits on the gun or the fist at rest, 3.5-6 cm from the body it is skinned to, and swings
    # with the spine when the rifle leaves (the census of 1 Nov: 12-69 vertices each, three in idle, twelve in fire).
    loose = roles["debris"].copy()
    parent = list(range(nV))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    weld = {}
    for i, pos in enumerate(np.round(co, 5)):
        k = tuple(pos)
        if k in weld:
            parent[find(i)] = find(weld[k])
        else:
            weld[k] = i
    for t in polys:
        parent[find(t[0])] = find(t[1]); parent[find(t[1])] = find(t[2])
    comp = np.array([find(i) for i in range(nV)]); sizes = np.bincount(comp)
    hand_any_ = np.zeros(nV, bool)
    for h_ in roles["hand"].values():
        hand_any_ |= h_
    big_co = co[(sizes[comp] >= BODY_ISLAND_VERTS) & (vclass != 0) & ~hand_any_]   # the body: not the gun the scrap lies on
    for c_id in np.unique(comp[(sizes[comp] < SMALL_ISLAND_VERTS) & (vclass != 0) & ~hand_any_]):
        idx = np.nonzero(comp == c_id)[0]
        if gun[idx].any() or hand_any_[idx].any():
            continue
        gap = min(np.sqrt(((big_co[None] - co[idx[i:i + 32], None]) ** 2).sum(-1)).min() for i in range(0, len(idx), 32))
        if gap > DEBRIS_GAP_M:
            loose[idx] = True
    if loose.any():
        log(f"{prefix}: {int(loose.sum())} vertices of {len(np.unique(comp[loose]))} loose islands (over {DEBRIS_GAP_M * 100:.0f} cm from the body at rest) deleted")
    live = ~loose[polys].any(1)          # loose debris goes to no role: deleted
    sets = {
        "weapon": np.nonzero(any_gun & live)[0],
        "boot": np.nonzero(~all_gun & live & (body_major == 1))[0],
        "face": np.nonzero(~all_gun & live & (body_major == 2))[0],
        "uniform": np.nonzero(~all_gun & live & (body_major == 3))[0],
    }
    gun_bone = f"{prefix}_forearm_R"
    parts = []
    for role in ("weapon", "boot", "face", "uniform"):
        keep = sets[role]
        if len(keep) == 0:
            continue
        part = ob.copy(); part.data = ob.data.copy(); part.name = f"{prefix}_{role}"
        bpy.context.collection.objects.link(part)
        pme = part.data
        if role == "weapon":
            # every vertex of the weapon mesh rides the gun's bone: rigid, the skirt and the fused finger faces included
            for vg in part.vertex_groups:
                vg.remove(list(range(nV)))
            part.vertex_groups[gun_bone].add(list(range(nV)), 1.0, "REPLACE")
        else:
            # a gun-side vertex of a skirt face takes its face's nearest body vertex: position and weights
            skirt = keep[any_gun[keep]]
            moved = kept = 0
            hand_any = np.zeros(nV, bool)
            for h in roles["hand"].values():
                hand_any |= h
            for fi in skirt:
                f = polys[fi]
                body = [v for v in f if vclass[v] != 0]
                on_hand = any(hand_any[v] for v in body)
                for v in f:
                    if vclass[v] != 0:
                        continue
                    tgt = min(body, key=lambda b: np.linalg.norm(co[v] - co[b]))
                    if on_hand:
                        # the fist's grip face: the gun-side vertex stays where it is, on the hand's bone, which the hold
                        # keeps exactly on the weapon; the face is the palm's contact and keeps the hand one piece
                        kept += 1
                    else:
                        pme.vertices[v].co = pme.vertices[tgt].co
                        moved += 1
                    for vg in part.vertex_groups:
                        vg.remove([int(v)])
                    for g in pme.vertices[tgt].groups:
                        part.vertex_groups[g.group].add([int(v)], g.weight, "REPLACE")
            if moved or kept:
                log(f"{prefix}: {role}: {moved} gun-side skirt vertices collapsed onto the body, {kept} kept in place on the fists")
        bm = bmesh.new(); bm.from_mesh(pme); bm.faces.ensure_lookup_table()
        keep_set = set(int(i) for i in keep)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_set], context="FACES")
        bm.to_mesh(pme); bm.free()
        if role == "uniform":
            _islands_follow_body(part, prefix)
            _clean_fist_slivers(part, prefix)
        part["rl_role"] = role
        parts.append(part)
        log(f"{prefix}: role {role}: {len(pme.polygons)} tris")
    bpy.data.objects.remove(ob, do_unlink=True)
    return parts


SLIVER_LONG_M, SLIVER_THIN_M = 0.025, 0.0025   # a sliver: longest edge over 25 mm, height under 2.5 mm
SLIVER_NEAR_FIST_M = 0.12     # ...with a vertex this close to a fist's centre
SLIVER_COLLAPSE_M = 0.008     # a sliver's shortest edge under this is collapsed (a needle)
SLIVER_MAX_PER_FIST, SLIVER_MAX_LONG_M = 3, 0.040   # what is allowed to remain (the review of 9 Nov, N1): build refused
RIM_NEAR_FIST_M, RIM_MAX_OPEN = 0.06, 4   # B2 (round 5): welded EXPOSED open edges within this of a fist, at most this many
RIM_SEALED_M = 0.004          # ...an open edge inside the gun or this close to its surface is the parting line the gun closes


def _fist_slivers(bm, centres):
    """Faces of `bm` (triangles) within SLIVER_NEAR_FIST_M of any of `centres` that are slivers."""
    out = []
    for f in bm.faces:
        if len(f.verts) != 3:
            continue
        p = [v.co for v in f.verts]
        if min(min((q - c).length for q in p) for c in centres) > SLIVER_NEAR_FIST_M:
            continue
        L = [(p[1] - p[0]).length, (p[2] - p[1]).length, (p[0] - p[2]).length]
        area = (p[1] - p[0]).cross(p[2] - p[0]).length / 2
        if max(L) > SLIVER_LONG_M and 2 * area / max(L) < SLIVER_THIN_M:
            out.append(f)
    return out


def _clean_fist_slivers(part, prefix):
    """N1 (the review of 9 Nov): the fused grip, parted from the gun, left an OPEN rim of long thin triangles at each fist
    that tore into needles in close-up. Near each fist: the open rims are capped (holes filled, then beautified), then each
    remaining sliver goes -- a needle has its short edge collapsed, an interior one has its long edge flipped, and one on
    the rim has its apex welded onto its long edge; no face is ever deleted (round 5). The build is refused if a fist keeps more than SLIVER_MAX_PER_FIST slivers or one over SLIVER_MAX_LONG_M."""
    me = part.data
    names, W = _weights(part)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    # the fists by ROLE (round 5): the firing fist holds the grip (anatomical R, so rig hand_L on this rig), the support
    # fist the handguard (anatomical L, rig hand_R) -- the order every reading below is logged and gated in
    centres, roles_ = [], []
    for role_, anat in (("firing", "R"), ("support", "L")):
        bone_ = f"{prefix}_hand_{RIG_SIDE[anat]}"
        if bone_ in names:
            dom_ = W[:, names.index(bone_)] >= 0.5
            if dom_.any():
                centres.append(Vector(co[dom_].mean(0))); roles_.append(f"{role_} (rig {bone_[-6:]})")
    if not centres:
        return
    bm = bmesh.new(); bm.from_mesh(me)
    near = lambda v: min((v.co - c).length for c in centres) <= SLIVER_NEAR_FIST_M  # noqa: E731
    before = len(_fist_slivers(bm, centres))
    # WELD first (round 5, the review of 9 Nov): the remesh is split at every UV seam, so a seam reads as two open edges.
    # UVs live on the loops in Blender, so the weld keeps them. Only coincident vertices whose SKIN WEIGHTS match are
    # merged (B4, the round-5 review): a blind weld re-bound 11-13 firing-hand vertices to the support forearm, and a
    # 75-86 mm spike stood off every support fist in the aimed clips. Twins with different weights stay apart (and count
    # as rim, which they are: they part when the pose moves the two bones).
    dl = bm.verts.layers.deform.active
    wkey = lambda v: tuple(sorted((g, round(w, 4)) for g, w in v[dl].items() if w > 1e-4)) if dl else ()  # noqa: E731
    pairs = bmesh.ops.find_doubles(bm, verts=list(bm.verts), dist=1e-5)["targetmap"]
    same = {v: t for v, t in pairs.items() if wkey(v) == wkey(t)}
    log(f"{prefix}: weld -- {len(same)} of {len(pairs)} coincident vertices merged ({len(pairs) - len(same)} kept apart: "
        f"their skin weights differ)")
    bmesh.ops.weld_verts(bm, targetmap=same)
    rim = [e for e in bm.edges if e.is_boundary and near(e.verts[0]) and near(e.verts[1])]
    if rim:
        filled = bmesh.ops.holes_fill(bm, edges=rim, sides=0)["faces"]
        if filled:
            tri = bmesh.ops.triangulate(bm, faces=filled)["faces"]
            inner = list({e for f in tri for e in f.edges if not e.is_boundary})
            bmesh.ops.beautify_fill(bm, faces=tri, edges=inner)
    for _ in range(6):
        sl = _fist_slivers(bm, centres)
        if not sl:
            break
        for f in sl:
            if not f.is_valid:
                continue
            edges = sorted(f.edges, key=lambda e: e.calc_length())
            # a rim face is never deleted (round 4 deleted them and widened the hole the lead saw): it is collapsed or left
            if edges[0].calc_length() < SLIVER_COLLAPSE_M:
                bmesh.ops.collapse(bm, edges=[edges[0]], uvs=True)
            elif edges[-1].is_manifold:
                bmesh.ops.rotate_edges(bm, edges=[edges[-1]], use_ccw=False)
            else:
                # a needle ON the rim, both short sides too long to collapse: its apex is under SLIVER_THIN_M off the
                # long edge, so the long edge is split under the apex and the apex welded there (moved by under 2.5 mm).
                # The face goes, and the rim runs through the apex instead: no hole opens.
                e = edges[-1]
                apex = next(v for v in f.verts if v not in e.verts)
                a_, b_ = e.verts
                ab = b_.co - a_.co
                t = max(0.05, min(0.95, (apex.co - a_.co).dot(ab) / ab.length_squared))
                _e2, mid = bmesh.utils.edge_split(e, a_, t)
                bmesh.ops.pointmerge(bm, verts=[apex, mid], merge_co=mid.co.copy())
                bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=list(bm.edges))
        bm.faces.ensure_lookup_table()
    left = _fist_slivers(bm, centres)
    per = [sum(1 for f in left if min((v.co - c).length for v in f.verts) <= SLIVER_NEAR_FIST_M) for c in centres]
    # an open edge that lies on the gun (inside it, or within RIM_SEALED_M of its surface) is the parting line the gun
    # closes; the rest are EXPOSED, what the lead saw torn
    from mathutils.bvhtree import BVHTree
    wob = bpy.data.objects.get(f"{prefix}_weapon")
    wbvh = BVHTree.FromPolygons([v.co.copy() for v in wob.data.vertices], [tuple(p_.vertices) for p_ in wob.data.polygons]) if wob else None

    def sealed(e):
        if wbvh is None:
            return False
        m_ = (e.verts[0].co + e.verts[1].co) / 2
        loc, nor, _i, d = wbvh.find_nearest(m_)
        return loc is not None and (d <= RIM_SEALED_M or (m_ - loc).dot(nor) < 0)
    open_ = [sum(1 for e in bm.edges if e.is_boundary and max((v.co - c).length for v in e.verts) <= RIM_NEAR_FIST_M and not sealed(e))
             for c in centres]
    if os.environ.get("RIM_DEBUG"):
        from mathutils.bvhtree import BVHTree
        wob = bpy.data.objects.get(f"{prefix}_weapon")
        if wob is not None:
            wbvh = BVHTree.FromPolygons([v.co.copy() for v in wob.data.vertices], [tuple(p_.vertices) for p_ in wob.data.polygons])
            for ci, c in enumerate(centres):
                es = [e for e in bm.edges if e.is_boundary and max((v.co - c).length for v in e.verts) <= RIM_NEAR_FIST_M]
                inside = near_g = 0
                for e in es:
                    m_ = (e.verts[0].co + e.verts[1].co) / 2
                    loc, nor, _i, d = wbvh.find_nearest(m_)
                    if loc is not None and (m_ - loc).dot(nor) < 0:
                        inside += 1
                    if loc is not None and d < 0.004:
                        near_g += 1
                log(f"  fist {ci}: {len(es)} open edges near it, {inside} inside the gun, {near_g} within 4 mm of its surface")
        bnd = [e for e in bm.edges if e.is_boundary and min(max((v.co - c).length for v in e.verts) for c in centres) <= RIM_NEAR_FIST_M]
        seen = set()
        for e0 in bnd:
            if e0 in seen:
                continue
            comp, stack = [], [e0]
            while stack:
                e = stack.pop()
                if e in seen:
                    continue
                seen.add(e); comp.append(e)
                for v in e.verts:
                    for e2 in v.link_edges:
                        if e2.is_boundary and e2 not in seen:
                            stack.append(e2)
            deg = {}
            for e in comp:
                for v in e.verts:
                    deg[v] = deg.get(v, 0) + 1
            far = max(min((v.co - c).length for c in centres) for v in deg)
            log(f"  rim component: {len(comp)} edges, closed {all(d == 2 for d in deg.values())}, farthest vertex {far * 100:.1f} cm, "
                f"length {sum(e.calc_length() for e in comp) * 100:.1f} cm")
    total_ = [sum(1 for e in bm.edges if e.is_boundary and max((v.co - c).length for v in e.verts) <= RIM_NEAR_FIST_M)
              for c in centres]
    log(f"{prefix}: open edges within {RIM_NEAR_FIST_M * 100:.0f} cm of each fist after the weld and the fill, EXPOSED of all: "
        + ", ".join(f"{r_} {x_} of {t_}" for r_, x_, t_ in zip(roles_, open_, total_)))
    for r_, x_ in zip(roles_, open_):
        if x_ > RIM_MAX_OPEN:
            raise SystemExit(f"{prefix}: the {r_} fist keeps {x_} exposed open edges within {RIM_NEAR_FIST_M} m "
                             f"(allowed {RIM_MAX_OPEN})")
    longest = max((max(e.calc_length() for e in f.edges) for f in left), default=0.0)
    _repair_bridged_uvs(bm, centres, prefix)
    bm.to_mesh(me); bm.free(); me.update()
    log(f"{prefix}: fist slivers {before} -> {len(left)} (per fist {per}, longest {longest * 1000:.0f} mm), {len(rim)} rim edges capped")
    if max(per) > SLIVER_MAX_PER_FIST or longest > SLIVER_MAX_LONG_M:
        raise SystemExit(f"{prefix}: a fist keeps {max(per)} slivers, the longest {longest * 1000:.0f} mm "
                         f"(allowed {SLIVER_MAX_PER_FIST}, {SLIVER_MAX_LONG_M * 1000:.0f} mm)")


UV_BRIDGE_RATIO = 4.0         # a face whose uv edge runs this many times the mesh's median uv-per-metre spans two islands


def _repair_bridged_uvs(bm, centres, prefix):
    """B3 (round 5): the weld before the rim fill joins the remesh's UV-seam twins, so a flipped edge, a collapsed needle
    or a filled hole near a fist can make a triangle whose three loops sit in DIFFERENT uv islands: its uv triangle spans
    the atlas, and its texels are whatever lies between (23% of the support glove read the gun's black, L* 0-12). Each
    such face (any uv edge over UV_BRIDGE_RATIO x the mesh's median uv length per metre) takes, on all three loops, the
    uv centroid of a neighbour that is not bridged: that neighbour's own colour."""
    uvl = bm.loops.layers.uv.active
    if uvl is None:
        return
    ratios = []
    for f in bm.faces:
        for lp in f.loops:
            l3 = (lp.vert.co - lp.link_loop_next.vert.co).length
            if l3 > 1e-5:
                ratios.append((lp[uvl].uv - lp.link_loop_next[uvl].uv).length / l3)
    med = float(np.median(ratios)) if ratios else 0.0
    near = lambda f: min(min((v.co - c).length for c in centres) for v in f.verts) <= SLIVER_NEAR_FIST_M * 1.5  # noqa: E731

    def bridged(f):
        for lp in f.loops:
            l3 = max((lp.vert.co - lp.link_loop_next.vert.co).length, 1e-4)
            if (lp[uvl].uv - lp.link_loop_next[uvl].uv).length / l3 > UV_BRIDGE_RATIO * med:
                return True
        return False
    bad = [f for f in bm.faces if near(f) and bridged(f)]
    badset = set(bad)
    fixed = 0
    for f in bad:
        nb = [g for e in f.edges for g in e.link_faces if g is not f and g not in badset]
        if not nb:
            continue
        g = max(nb, key=lambda g_: g_.calc_area())
        c = sum((lp[uvl].uv for lp in g.loops), Vector((0.0, 0.0))) / len(g.loops)
        for lp in f.loops:
            lp[uvl].uv = c
        fixed += 1
    log(f"{prefix}: {len(bad)} faces near the fists bridged two uv islands, {fixed} given a neighbour's uv")


def _islands_follow_body(part, prefix):
    """Every small island of the finished `uniform` mesh (welded by position) moves as ONE piece with the body vertex
    nearest it: one weight row, copied. The seam cuts set scraps loose that sit 1.2-2.0 cm off the body at rest with
    weights of their own (a belt pouch on the spine alone against a belt that follows the pelvis), and in fire and kneel
    they parted 7.9-8.4 cm: the floating olive specks beside the torso (the review of 9 Nov, B1; `probe_islands.py`).
    A fist (hand-dominant) keeps its own rigid weights."""
    me = part.data
    n = len(me.vertices)
    if n == 0:
        return
    co = np.empty(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    names, W = _weights(part)
    hand_cols = [i for i, nm in enumerate(names) if nm in (f"{prefix}_hand_L", f"{prefix}_hand_R")]
    dom_hand = np.isin(W.argmax(1), hand_cols) & (W.max(1) > 0)
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    key = {}
    for i, k in enumerate(map(tuple, np.round(co, 5))):
        if k in key:
            parent[find(i)] = find(key[k])
        else:
            key[k] = i
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    for t in polys:
        parent[find(t[0])] = find(t[1]); parent[find(t[1])] = find(t[2])
    comp = np.array([find(i) for i in range(n)]); sizes = np.bincount(comp)
    # the body an island may follow includes the fists: a scrap on a glove that followed the nearest SLEEVE vertex stayed
    # with the forearm when the fist rolled round the handguard, a sliver between them (review, 9 Nov, N1)
    body = np.nonzero(sizes[comp] >= BODY_ISLAND_VERTS)[0]
    if len(body) == 0:
        return
    moved = pieces = 0
    for c_id in np.unique(comp[sizes[comp] < ISLAND_FOLLOW_VERTS]):
        idx = np.nonzero(comp == c_id)[0]
        if dom_hand[idx].any():
            continue
        dmin, j = np.inf, -1
        for i in idx:
            d = np.linalg.norm(co[body] - co[i], axis=1); k = int(np.argmin(d))
            if d[k] < dmin:
                dmin, j = float(d[k]), int(body[k])
        W[idx, :] = W[j, :]
        moved += len(idx); pieces += 1
    if moved:
        _set_weights(part, names, W)
        log(f"{prefix}: uniform: {moved} vertices of {pieces} small islands follow the body vertex nearest them (one weight row each)")


# ---------------------------------------------------------------------------
# the hands' stations, written after the export from the file's own nodes
# ---------------------------------------------------------------------------

def _bl_to_gl(v):
    return np.array([v[0], v[2], -v[1]], float)


def _q_from_cols(x, y, z):
    M = Matrix(((x[0], y[0], z[0]), (x[1], y[1], z[1]), (x[2], y[2], z[2])))
    q = M.to_quaternion()
    return [q.x, q.y, q.z, q.w]


def _read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + jlen])
    blen, btype = struct.unpack_from("<II", data, 20 + jlen)
    bin_ = data[28 + jlen:28 + jlen + blen]
    return js, bin_


def _write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b"\0" * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(jb), 0x4E4F534A)); fh.write(jb)
        fh.write(struct.pack("<II", len(bb), 0x004E4942)); fh.write(bb)


def _node_world(js, idx, cache):
    if idx in cache:
        return cache[idx]
    n = js["nodes"][idx]
    t = n.get("translation", [0, 0, 0]); r = n.get("rotation", [0, 0, 0, 1]); s = n.get("scale", [1, 1, 1])
    q = Quaternion((r[3], r[0], r[1], r[2]))
    local = Matrix.Translation(t) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1.0))
    parent = next((i for i, m in enumerate(js["nodes"]) if idx in m.get("children", [])), None)
    world = (_node_world(js, parent, cache) @ local) if parent is not None else local
    cache[idx] = world
    return world


def _stamp_extras(path, team_id, figures, gun_tris, hand_tris):
    """`extras.rl_hands` (the hold's contract, hands.ts) and `extras.rl_skinned`, from the exported file's own nodes."""
    js, bin_ = _read_glb(path)
    names = {n.get("name"): i for i, n in enumerate(js["nodes"])}
    cache = {}
    weapons, stations = {}, None
    for prefix, J in figures.items():
        g = J["gun"]
        origin = _bl_to_gl(g["centre"]); ax = _bl_to_gl(g["axis"]); up = _bl_to_gl(g["up"]); side = np.cross(ax, up)
        q = _q_from_cols(ax, up, side)
        Wf = Matrix.Translation(origin.tolist()) @ Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
        root = _node_world(js, names[f"{prefix}_root"], cache)
        rt = root.to_translation(); rq = root.to_quaternion()
        weapons[prefix] = dict(origin=[round(float(x), 6) for x in origin], q=[round(float(x), 8) for x in q],
                               root=dict(t=[round(float(x), 6) for x in rt], r=[round(float(x), 8) for x in (rq.x, rq.y, rq.z, rq.w)]))
        if stations is None:
            stations = {}
            for key, side_ in (("grip", "R"), ("support", "L")):
                hw = _node_world(js, names[f"{prefix}_hand_{RIG_SIDE[side_]}"], cache)
                want = _bl_to_gl(J["wrist"][side_] + np.array(J["slot"]))
                miss = float(np.linalg.norm(np.array(hw.to_translation()[:]) - want))
                log(f"{prefix} hand {side_}: exported node at {np.round(hw.to_translation()[:], 4)}, measured wrist {np.round(want, 4)}, miss {miss * 1000:.2f} mm")
                if miss > 0.002:
                    raise SystemExit("the exported hand bone is not where the wrist was measured: the axis conversion is wrong")
                st = Wf.inverted() @ hw
                R = st.to_3x3(); t = st.to_translation()
                stations[key] = dict(R=[[round(float(R[i][j]), 8) for j in range(3)] for i in range(3)],
                                     t=[round(float(x), 6) for x in t], ref=[0.0, 0.0, 0.0], x_ref=0.0, bone_side=RIG_SIDE[side_])
    scene = js["scenes"][0]
    ex = scene.setdefault("extras", {})
    ex["rl_hands"] = dict(
        version=2, source="meshy", base="skinned-import", triangles={"living": hand_tris, "fist": None},
        glove=list(GLOVE_TEXEL[team_id]), stations=stations, weapons=weapons,
        part=dict(triangles=int(gun_tris), butt_x=round(-float(next(iter(figures.values()))["gun"]["length"]) / 2, 6)),
    )
    ex["rl_skinned"] = dict(version=1, figures=sorted(figures), task=SOURCES[team_id]["task"], binding="smooth")
    _write_glb(path, js, bin_)
    log(f"{team_id}: rl_hands (source meshy) and rl_skinned stamped; grip station t {stations['grip']['t']}, support t {stations['support']['t']}")




# --- the glove's tone (spec 1.5, the validator's rule: dE76 >= 15 to the sleeve, the vest and the weapon; L* 30-48;
# C* <= 30). Meshy baked "dark brown gloves" as a saturated orange-brown (lit L* 35 C* 53, shadow L* 18 C* 34; the
# fist's inside is baked dark, mean L* 14), and its uniform as khaki (L* 40, C* 20, hue 85) rather than the bible's
# olive. The approved coyote limestone.7 (L* 42, C* 16) sits dE 7 from that khaki, so it cannot pass here; a dark
# brown does: GLOVE_TARGET_LAB is dE 17 from the sleeve, 36 from the vest, 26 from the carbine. The glove texels keep
# GLOVE_KEEP of their own variation about that mean. Texture only: no vertex moves.
GLOVE_RETINT = True           # the lead's colours (1 Nov round 2): RETINT below. The stripes of the first try were the cap fans.


def _lab_to_rgb(lab):
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    fy = (L + 16) / 116; fx = fy + a / 500; fz = fy - b / 200
    finv = lambda t: np.where(t ** 3 > 0.008856, t ** 3, (t - 16 / 116) / 7.787)  # noqa: E731
    X = finv(fx) * 0.95047; Y = finv(fy); Z = finv(fz) * 1.08883
    r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z; g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z; bb = 0.0557 * X - 0.2040 * Y + 1.0570 * Z
    lin = np.clip(np.stack([r, g, bb], -1), 0, 1)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def _face_mask(me, uv, vmask, W_, H_, min_verts=2):
    """Texels under the faces with at least `min_verts` vertices (a majority by default) in `vmask`, on a W_ x H_ atlas
    (Blender rows, v up)."""
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    faces = polys[vmask[polys].sum(1) >= min_verts]
    mask = np.zeros((H_, W_), bool)
    for f in faces:
        t = uv[f] * np.array([W_, H_])
        x0, y0 = np.floor(t.min(0)).astype(int); x1, y1 = np.ceil(t.max(0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 1, W_ - 1), min(y1 + 1, H_ - 1)
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = t
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        l3 = 1 - l1 - l2
        mask[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
    return mask


def _face_fields(me, uv, fields, W_, H_):
    """Every face of `me` rasterised on a W_ x H_ atlas (Blender rows, v up), each per-vertex array in `fields`
    interpolated across it by barycentric weight (B3, the review of 9 Nov): returns (covered (H_, W_) bool, [field (H_, W_)
    float32 per input]). A texel inside two faces takes the LARGER value of each field."""
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    return _raster(uv[polys], [fv[polys] for fv in fields], W_, H_)


def _raster(face_uv, face_vals, W_, H_):
    """`_face_fields` on explicit per-face corners: face_uv (F, 3, 2) in [0, 1], each of face_vals (F, 3). Overlaps take
    the larger value: Meshy's atlas maps some fist faces and the gun faces they were sculpted on to the same texels."""
    covered = np.zeros((H_, W_), bool)
    out = [np.full((H_, W_), -np.inf, np.float32) for _ in face_vals]
    for fi in range(len(face_uv)):
        t = face_uv[fi] * np.array([W_, H_])
        x0, y0 = np.floor(t.min(0)).astype(int); x1, y1 = np.ceil(t.max(0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 1, W_ - 1), min(y1 + 1, H_ - 1)
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = t
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        l3 = 1 - l1 - l2
        ins = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not ins.any():
            continue
        win = covered[y0:y1 + 1, x0:x1 + 1]
        win |= ins
        for k, fv in enumerate(face_vals):
            val = l1 * fv[fi][0] + l2 * fv[fi][1] + l3 * fv[fi][2]
            o = out[k][y0:y1 + 1, x0:x1 + 1]
            o[ins] = np.maximum(o[ins], val[ins])
    return covered, out


def _final_glove_texels(ob, Jw, W_, H_):
    """B3 (round 5): the glove's texels by the hand weight across the FINISHED `uniform` faces of every figure (per-loop
    uv): the fist cleaning collapses needles and flips edges, and a face it changed covers atlas texels no source face
    did -- 14% of the support glove's faces read the gun's black there. `Jw` maps a figure prefix to its two wrists and
    elbows at its slot. Same rule as `_glove_texels`: hand weight >= 0.5, no more than GLOVE_CUT_M proximal of the wrist."""
    me = ob.data
    names = [g.name for g in ob.vertex_groups]
    nV = len(me.vertices)
    co = np.empty(nV * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    hw = np.zeros(nV); tw = np.full(nV, -1.0)
    for v in me.vertices:
        pref = None
        for g in v.groups:
            nm = names[g.group]
            if pref is None and g.weight > 0:
                pref = nm.split("_")[0]
            if "_hand_" in nm:
                hw[v.index] = max(hw[v.index], g.weight)
        if pref in Jw and hw[v.index] > 0:
            best = None
            for wr, el in Jw[pref]:
                ax_ = (wr - el) / np.linalg.norm(wr - el)
                d_ = np.linalg.norm(co[v.index] - wr)
                if best is None or d_ < best[0]:
                    best = (d_, float((co[v.index] - wr) @ ax_))
            tw[v.index] = best[1]
    lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get("vertex_index", lv)
    luv = np.empty(len(me.loops) * 2); me.uv_layers.active.data.foreach_get("uv", luv); luv = luv.reshape(-1, 2)
    ls = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get("loop_total", lt)
    tri = ls[lt == 3]
    li = tri[:, None] + np.arange(3)[None, :]
    vi = lv[li]
    # a face whose uv runs far past the mesh's uv-per-metre spans two islands (`_repair_bridged_uvs`): its raster would
    # paint whatever lies between, so it is left out
    e3 = np.linalg.norm(co[vi] - co[np.roll(vi, -1, 1)], axis=2)
    eu = np.linalg.norm(luv[li] - luv[np.roll(li, -1, 1)], axis=2)
    ok3 = e3 > 1e-4
    med = float(np.median(eu[ok3] / e3[ok3]))
    bridged = ((eu / np.maximum(e3, 1e-4)) > UV_BRIDGE_RATIO * med).any(1)
    keep = (hw[vi] > 0).any(1) & ~bridged
    fu = luv[li[keep]]
    span = (fu.max(1) - fu.min(1)).max(1)
    log(f"final glove raster: {int(keep.sum())} hand faces ({int(((hw[vi] > 0).any(1) & bridged).sum())} bridging two uv "
        f"islands left out), uv span max {span.max():.4f}")
    covered, (h, t_) = _raster(fu, [hw[vi[keep]], tw[vi[keep]]], W_, H_)
    return covered & (h >= 0.5) & (t_ >= -GLOVE_CUT_M)


def _face_mask_any(me, uv, vmask, W_, H_):
    """Texels under every face with at least one vertex in `vmask` (`_face_mask` takes a majority)."""
    return _face_mask(me, uv, vmask, W_, H_, min_verts=1)


def _glove_texels(me, uv, hand_w, t_wrist, W_, H_):
    """B3 (the review of 9 Nov): the glove's TEXELS, by the hand weight interpolated across each face -- glove where it
    is at least 0.5 and the texel lies no more than GLOVE_CUT_M proximal of its wrist -- so a triangle spanning the cuff is
    split at the weight's iso-line instead of painted whole by its majority (round 4's wedges up the support sleeve).
    Returns (glove (H_, W_) bool, covered (H_, W_) bool, padding owned by the glove). The bake's padding (texels no face
    covers) goes to the nearer side, a tie to the sleeve: a 1-texel ring per step, RETINT_PAD_PX steps."""
    covered, (h, tw) = _face_fields(me, uv, [hand_w.astype(np.float32), t_wrist.astype(np.float32)], W_, H_)
    G = covered & (h >= 0.5) & (tw >= -GLOVE_CUT_M)
    N = covered & ~G
    U = ~covered
    pad = np.zeros_like(G)
    for _ in range(RETINT_PAD_PX):
        g_new = _dilate(G | pad, 1) & U
        n_new = _dilate(N, 1) & U
        pad |= g_new & ~n_new
        N |= n_new
        U &= ~(g_new | n_new)
    return G | pad, covered


GLOVE_CUT_M = 0.01            # B3: no glove texel more than this proximal of the wrist (the gate's line is 2 cm)


#: The lead's colours (1 Nov): each class's texels are moved so their MEAN lands on the target, keeping `keep` of their
#: own variation (shading, seams, dirt). CIE L*a*b*. The glove's target is dE 21 from the olive, 35 from the vest, 28
#: from the carbine; L* 33 and C* 21 inside the glove gate's bands.
RETINT = {
    "uniform": dict(target=(36.0, -6.0, 14.0), keep=1.0, orange_only=False),   # olive drab, from Meshy's khaki (40, 1, 20)
    # dark brown, every glove texel (the baked-dark inside of the fist too: with those left out the hand read L* 19-26)
    # (the validator reads the hand's vertex texels ~5 L* under this mask mean: at 34 it read 28-31 and dE 12-15)
    # a brown, not a pink: hue toward yellow (b over a); dE 17.5 to the olive; reads L* 31-33 at the hand's own texels
    # 9 Nov (round 3): the vest is now the carrier's coyote (Lab ~43, 7, 31), 9-13 dE from a (37, 11, 18) glove; a darker,
    # less yellow dark brown keeps 15+ from the coyote AND from the olive sleeve, inside the L* 30-48 band and the C* cap
    # round 4 (9 Nov): the lead asked for DARK BROWN; (34, 14, 6) rendered dusky rose, 11.4 dE from the face. Brown, dark
    # and low in chroma, the one region 15+ dE from the olive sleeve (36, -6, 14), the skin (40, 16, 20) and the coyote
    # vest (43, 7, 31) inside the L* 30-48 band
    # round 5, the lead's ruling (9 Nov, GH-746, B1): DARK BROWN sRGB (70, 48, 32), Lab (22.0, 7.8, 14.2), hue 61 deg; the
    # glove gate's L* floor for this one baked figure is 20 and its hue band 40-75 (round 4's (34, 12, 3) read hue 5: pink)
    "glove": dict(target=None, rgb=(70, 48, 32), keep=0.25, orange_only=False),
    "boot": dict(target=(50.0, 12.0, 26.0), keep=0.7, orange_only=True),       # tan leather, from Meshy's orange
    # the CUFFS (the lead's ruling, round 3): the sleeve within CUFF_RETINT_M of a wrist, where Meshy bled the glove's
    # orange, goes to the sleeve's olive, every texel -- so the dark-brown glove reads against an olive sleeve
    "cuff": dict(target=(38.0, -6.0, 14.0), keep=0.3, orange_only=False),
    # ...and the glove's orange Meshy bled further up the sleeves, ORANGE texels only, to the olive: the salmon streaks
    # along the forearms (review, 9 Nov), 6-8 cm bands once the fists were real size
    "sleeve_bleed": dict(target=(36.0, -6.0, 14.0), keep=0.5, orange_only=True),
    # The baked black plate carrier, toward the kit carrier's coyote (dust.5, #806032) (the lead, 9 Nov): a 2-3 cm kit
    # carrier over it can never show black through a gap. Texture only, as the glove's; the vest's own pouches and straps
    # keep part of their variation.
    "vest": dict(target=None, rgb=(0x80, 0x60, 0x32), keep=0.35, orange_only=False),
}
SLEEVE_BLEED_M = 0.30         # the forearm's sleeve: uniform within this of a wrist
VEST_L_MAX, VEST_C_MAX = 14.0, 8.0   # a vest texel: near-black and neutral (the bake's carrier, its pouches and straps)
VEST_ISLAND_SHARE = 0.5       # a UV island is the carrier's when at least this share of its faces are vest faces
VEST_FLOOR_L = 25.0           # after the retint no carrier texel may stay darker than this (the coyote's mean is ~43)
CUFF_RETINT_M = 0.10
ORANGE_C_MIN, ORANGE_HUE = 18.0, (15.0, 75.0)
GLOVE_L_CLAMP = (21.0, 30.0)   # about the dark brown's L* 22 (the gate's floor for this figure is 20)


RETINT_PAD_PX = 4             # the bake's island padding is re-tinted with its island: a vertex's texel sits on it


def _dilate(mask, r):
    """`mask` grown by `r` texels (a square), clipped at the atlas edge."""
    out = mask.copy()
    H_, W_ = mask.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx == 0 and dy == 0:
                continue
            sl = out[max(dy, 0):H_ + min(dy, 0), max(dx, 0):W_ + min(dx, 0)]
            sl |= mask[max(-dy, 0):H_ + min(-dy, 0), max(-dx, 0):W_ + min(-dx, 0)]
    return out


def _uv_islands(me):
    """Connected components of the shell's faces by shared VERTEX: the remesh is split at every UV seam, so these are its
    UV islands."""
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    parent = np.arange(len(me.vertices))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for t in polys:
        a_, b_, c_ = find(t[0]), find(t[1]), find(t[2])
        parent[b_] = a_; parent[c_] = a_
    return np.array([find(i) for i in range(len(me.vertices))]), polys


def _carrier_texels(me, uv, vest_v, W_, H_):
    """The texels of the plate carrier's own UV ISLANDS (the lead's V1, 9 Nov): an island is the carrier's when most of its
    faces are vest faces (near-black, neutral, the trunk band); its whole raster is taken, and its padding grows into
    texels no other island's faces cover only. A per-face mask left black islands where a vest face straddled the class
    edge, and its padding painted coyote lines onto the helmet, the beard and the collar beside it in the atlas."""
    comp, polys = _uv_islands(me)
    fcomp = comp[polys[:, 0]]
    fvest = vest_v[polys].sum(1) >= 2
    carrier = np.zeros(len(me.vertices), bool)
    picked = []
    for c_ in np.unique(fcomp):
        sel = fcomp == c_
        if fvest[sel].mean() >= VEST_ISLAND_SHARE:
            carrier |= comp == c_
            picked.append(int(sel.sum()))
    own = _face_mask(me, uv, carrier, W_, H_)
    others = _face_mask(me, uv, ~carrier, W_, H_) & ~own
    mask = own | (_dilate(own, RETINT_PAD_PX) & ~others)
    log(f"vest: {len(picked)} carrier islands ({sum(picked)} faces) by majority, {int(own.sum())} texels + "
        f"{int((mask & ~own).sum())} padding")
    return mask


def _retint(image, src, uv, masks):
    """Shift the bake's texels per class (`RETINT`). Texture only: no vertex moves. Logs each class's mean before/after.

    Each class's face mask is grown by RETINT_PAD_PX: Meshy unwraps the bake per face with padding that repeats the
    face's edge colour, and a vertex's own UV (a face's corner) lands on that padding as often as inside the face. The
    glove gate samples the atlas at vertex UVs; with the padding left in the bake's colour, an olive cuff read 23-53%
    orange at its vertices (round 3). Later classes overwrite earlier ones where the grown masks overlap."""
    W_, H_ = image.size
    px = np.empty(W_ * H_ * 4, np.float32); image.pixels.foreach_get(px); px = px.reshape(H_, W_, 4)
    out = px.copy()
    me = src.data
    for name, vmask in masks.items():
        spec = RETINT[name]
        # a class given as a TEXEL mask (2-D: the vest's carrier islands, `_carrier_texels`) is used as it is
        mask = vmask.copy() if vmask.ndim == 2 else _dilate(_face_mask(me, uv, vmask, W_, H_), RETINT_PAD_PX)
        before = out.copy() if name == "vest" else None
        if spec["orange_only"]:
            lab_all = _lab(px[..., :3].astype(np.float64))
            C_ = np.hypot(lab_all[..., 1], lab_all[..., 2]); hue_ = np.degrees(np.arctan2(lab_all[..., 2], lab_all[..., 1]))
            mask &= (C_ > ORANGE_C_MIN) & (hue_ > ORANGE_HUE[0]) & (hue_ < ORANGE_HUE[1])
        if not mask.any():
            log(f"retint {name}: no texels")
            continue
        lab = _lab(px[mask][:, :3].astype(np.float64))
        mean = lab.mean(0)
        target = spec["target"] if spec.get("target") is not None else _lab(np.array([spec["rgb"]], np.float64) / 255.0)[0]
        new = np.array(target) + spec["keep"] * (lab - mean)
        if name == "glove":
            new[:, 0] = np.clip(new[:, 0], *GLOVE_L_CLAMP)
        rgb = _lab_to_rgb(new)
        out[mask, :3] = rgb.astype(np.float32)
        if name == "vest":
            # the two-sided check (the lead's V1, 9 Nov): nothing inside the carrier's islands stays black, nothing outside
            # them changed
            lab_in = _lab(out[mask][:, :3].astype(np.float64))
            dark = int((lab_in[:, 0] < VEST_FLOOR_L).sum())
            outside = int((np.abs(out[~mask] - before[~mask]).max(1) > 1e-6).sum())
            if dark or outside:
                raise SystemExit(f"retint vest: {dark} texels inside the carrier's islands under L* {VEST_FLOOR_L}, "
                                 f"{outside} texels outside them changed")
        after = _lab(rgb).mean(0)
        log(f"retint {name}: {int(mask.sum())} texels, mean Lab {np.round(mean, 1)} -> {np.round(after, 1)} (C* {np.hypot(after[1], after[2]):.1f})")
    image.pixels.foreach_set(out.reshape(-1)); image.update()


#: A texel inside each team's glove on its atlas (u, v in pixels of the shipped 2048 bake), the hand gates' `rl_hands.glove`.
#: Found at export (`_glove_texel`): the UV centroid of the firing hand's vertices, snapped to the nearest glove-class
#: vertex UV. Filled per run.
GLOVE_TEXEL = {}


def _glove_texel(uv, hand_mask, W_px, H_px):
    u = uv[hand_mask]
    c = u.mean(0)
    i = int(np.argmin(((u - c) ** 2).sum(1)))
    # glTF's v runs down the image: Blender's uv v is flipped at export
    return int(round(u[i, 0] * W_px)), int(round((1.0 - u[i, 1]) * H_px))


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def build_team(team_id, out_path=None):
    cfg = SOURCES[team_id]
    owned = os.path.join(OUT_DIR, f"{team_id}.glb")
    path = out_path or owned
    if require_owner(rig.TEAM_MESH_OWNER, team_id, "TEAM_MESH_OWNER") != os.path.relpath(os.path.abspath(__file__), REPO):
        raise SystemExit(f"{team_id}: TEAM_MESH_OWNER names another script; this importer does not own its file")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src, image, co0 = _load(team_id)
    lab, uv = _vertex_lab(src, image)
    cls0 = _classes(co0, lab)
    J0 = _measure(co0, cls0, cfg["stature"], cfg["seeds"])
    _real_size_hands(co0, cls0, J0)
    g = J0["gun"]
    log(f"{team_id}: joints -- crotch {J0['crotch']:.3f} knee {J0['knee']:.3f} chin {J0['chin']:.3f} head_xy {np.round(J0['head_xy'], 3)}")
    for side in ("R", "L"):
        log(f"  arm {side} (rig _{RIG_SIDE[side]}): shoulder {np.round(J0['shoulder'][side], 3)} elbow {np.round(J0['elbow'][side], 3)} "
            f"wrist {np.round(J0['wrist'][side], 3)} fist {np.round(J0['fist'][side], 3)}; upper {np.linalg.norm(J0['elbow'][side] - J0['shoulder'][side]):.3f} "
            f"fore {np.linalg.norm(J0['wrist'][side] - J0['elbow'][side]):.3f}")
    log(f"  gun: butt {np.round(g['butt'], 3)} muzzle {np.round(g['muzzle'], 3)} length {g['length']:.3f} ({g['n']} bore verts); "
        f"grip at s {((J0['fist']['R'] - g['butt']) @ g['axis']) / g['length']:.3f}, support at s {((J0['fist']['L'] - g['butt']) @ g['axis']) / g['length']:.3f} from the butt")

    figures = rig.TEAM_FIGURES[team_id]
    bones, parts, Js = [], [], {}
    for spec in figures:
        p = spec["prefix"]; sz, sxy = cfg["bodies"][p]
        Js[p] = _scale_joints(J0, sz, sxy)
        bones += _bone_table(p, Js[p], spec["x"], spec["y"])
    arm_obj = rig.build_armature(bones)
    # hand bones: +Z (the back of the hand) away from the bore; the rest keep rig.py's roll
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    for spec in figures:
        p = spec["prefix"]; J = Js[p]; gaxis = J["gun"]["axis"]; gb = J["gun"]["butt"] + np.array([spec["x"], spec["y"], 0.0])
        for side in ("R", "L"):
            eb = arm_obj.data.edit_bones[f"{p}_hand_{RIG_SIDE[side]}"]
            fist = J["fist"][side] + np.array([spec["x"], spec["y"], 0.0])
            e = (fist - gb) @ gaxis; off = fist - gb - gaxis * e
            eb.align_roll(Vector(off.tolist()).normalized())
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm_obj.data.bones:
        suffix = b.name.split("_", 1)[1]
        if suffix in ("root", "death_root", "hip_L", "hip_R"):
            b.use_deform = False

    gun_tris = 0
    glove_texel = None
    hand_tris = {}
    for spec in figures:
        p = spec["prefix"]; sz, sxy = cfg["bodies"][p]
        shell, co = _figure_shell(src, p, sz, sxy, spec["x"], spec["y"])
        J = Js[p]
        Jt = dict(J)   # joints at the figure's slot
        shift = np.array([spec["x"], spec["y"], 0.0])
        Jt["gun"] = dict(J["gun"], butt=J["gun"]["butt"] + shift, muzzle=J["gun"]["muzzle"] + shift, centre=J["gun"]["centre"] + shift)
        for k in ("fist", "wrist", "elbow", "shoulder", "fist_pivot"):
            Jt[k] = {s: v + shift for s, v in J[k].items()}
        Jt["leg"] = {s: v + shift[:2] for s, v in J["leg"].items()}
        _auto_weights(shell, arm_obj)
        names, W, roles = _fix_weights(shell, p, Jt, cls0, co)
        co = _shrink_fists(shell, p, Jt, W, names, roles, co)
        _census(shell, p, W, names)
        cap_idx, cap_cls = _cut_seams(shell, p, Jt, roles, co, uv, cls0)
        # the shell grew: extend the per-vertex arrays the split reads (caps take their side's class)
        co = np.empty(len(shell.data.vertices) * 3); shell.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        n_new = len(cap_idx)
        cls_sh = {k: np.concatenate([v, np.zeros(n_new, v.dtype)]) for k, v in cls0.items()}
        roles = dict(roles, gun=np.concatenate([roles["gun"], cap_cls == 0]), debris=np.concatenate([roles["debris"], np.zeros(n_new, bool)]),
                     hand={s_: np.concatenate([h, np.zeros(n_new, bool)]) for s_, h in roles["hand"].items()},
                     glove={s_: np.concatenate([h, np.zeros(n_new, bool)]) for s_, h in roles["glove"].items()})
        for s_ in ("R", "L"):
            # a fist cap belongs to the fist it closes
            pass
        roles["hand_cap"] = cap_cls == 1
        cls0_fig = cls_sh
        if glove_texel is None:
            # the source's own uv (the caps are appended after it): the firing fist's vertices of the source shell
            glove_texel = _glove_texel(uv, roles["glove"]["R"][: len(uv)], TEXTURE_PX, TEXTURE_PX)
            hand_tris = roles["hand_tris"]
            # the glove is every vertex the HAND bone owns (weight >= 0.5) as well as the glove blob ahead of the wrist: the
            # fist faces Meshy sculpted against the vest carried vest texels, and with the vest retinted coyote 26% of the
            # firing fist's own texels read yellow (b* +5 on the glove, 9 Nov round 4)
            gi_ = {n_: i_ for i_, n_ in enumerate(names)}
            hand_masks_f1 = {k: v.copy() for k, v in roles["glove"].items()}
            for k in hand_masks_f1:
                own_ = W[:, gi_[f"{p}_hand_{RIG_SIDE[k]}"]] >= 0.5
                hand_masks_f1[k][: len(own_)] |= own_
            gun_mask_f1 = roles["gun"].copy()
            # B3: the hand weight itself, per vertex, for the glove's texels (`_glove_texels`)
            hand_w_f1 = np.maximum(W[:, gi_[f"{p}_hand_L"]], W[:, gi_[f"{p}_hand_R"]])
            glove_blob_f1 = roles["glove"]["R"] | roles["glove"]["L"]
        ps = _split_roles(shell, p, cls0_fig, roles, co)
        gun_tris = max(gun_tris, next(len(o.data.polygons) for o in ps if o["rl_role"] == "weapon"))
        parts += ps
    GLOVE_TEXEL[team_id] = glove_texel
    src_for_uv = src.copy(); src_for_uv.data = src.data.copy()   # the source's faces and uv, for the glove re-tint
    bpy.data.objects.remove(src, do_unlink=True)

    merged = rig.join_by_role(parts)
    for role, ob in merged.items():
        mod = next((m for m in ob.modifiers if m.type == "ARMATURE"), None)
        if mod is None or mod.object is not arm_obj:
            raise SystemExit(f"{role}: lost its armature modifier in the join")
    rig.build_clips(arm_obj, team_id)
    before = tuple(image.size)
    if image.size[0] > TEXTURE_PX:
        image.scale(TEXTURE_PX, TEXTURE_PX)
    log(f"{team_id}: base_color {before[0]}x{before[1]} -> {image.size[0]}x{image.size[1]}")
    if GLOVE_RETINT:
        n0 = len(uv)
        glove = np.zeros(n0, bool)
        for h in hand_masks_f1.values():
            glove |= h[:n0]
        # cloth only: the skin (face, neck, any bare hand) keeps the bake's own tones (round 2's bleed pass had tinted
        # the face olive)
        # The skin is where skin is: the face and the neck, above the shoulders. The colour class alone also matches the
        # glove's orange bled onto the cuffs (L* 22, a* 14), which is cloth -- a gloved figure has no skin at the wrist.
        hx, hy = J0["head_xy"]
        skin = cls0["skin"][:n0] & ~glove & (co0[:, 2] > SHOULDER_Z - 0.12) & (np.hypot(co0[:, 0] - hx, co0[:, 1] - hy) < 0.25)
        # by GEOMETRY, every colour: a class mask leaves the faces that straddle a class edge untouched, and the gate's
        # sleeve sample (forearm-dominant, 6 cm behind the wrist) read 19-37% orange texels through those gaps
        cuff = np.zeros(n0, bool)
        for side_ in ("R", "L"):
            cuff |= np.linalg.norm(co0 - J0["wrist"][side_], axis=1) < CUFF_RETINT_M
        cuff &= ~glove & ~skin & ~gun_mask_f1[:n0]
        sleeve = np.zeros(n0, bool)
        for side_ in ("R", "L"):
            sleeve |= np.linalg.norm(co0 - J0["wrist"][side_], axis=1) < SLEEVE_BLEED_M
        sleeve &= ~glove & ~skin & ~gun_mask_f1[:n0] & ~cls0["boot"][:n0]
        # the vest: near-black neutral texels of the trunk between the belt and the shoulders, inside the chest's width,
        # not the gun, the fists, the skin or the boots
        sxy0 = (J0["leg"]["R"] + J0["leg"]["L"]) / 2
        vest = ((cls0["L"][:n0] <= VEST_L_MAX) & (cls0["C"][:n0] < VEST_C_MAX) & (co0[:, 2] > J0["belt"] - 0.06)
                & (co0[:, 2] < SHOULDER_Z + 0.06) & (np.abs(co0[:, 1] - sxy0[1]) < TORSO_HALF_W)
                & ~glove & ~skin & ~gun_mask_f1[:n0] & ~cls0["boot"][:n0])
        # B3: the glove by TEXEL (the hand weight across each face, cut 1 cm proximal of the wrist); the glove blob ahead
        # of the wrist (Meshy's glove colour) counts as hand
        hw = np.maximum(hand_w_f1[:n0], glove_blob_f1[:n0].astype(float))
        tws = []
        for side_ in ("R", "L"):
            ax_ = J0["wrist"][side_] - J0["elbow"][side_]; ax_ = ax_ / np.linalg.norm(ax_)
            tws.append(((co0 - J0["wrist"][side_]) @ ax_, np.linalg.norm(co0 - J0["wrist"][side_], axis=1)))
        t_wrist = np.where(tws[0][1] <= tws[1][1], tws[0][0], tws[1][0])
        glove_tex, covered_ = _glove_texels(src_for_uv.data, uv, hw, t_wrist, image.size[0], image.size[1])
        Jw = {s_["prefix"]: [(Js[s_["prefix"]]["wrist"][sd] + np.array([s_["x"], s_["y"], 0.0]),
                              Js[s_["prefix"]]["elbow"][sd] + np.array([s_["x"], s_["y"], 0.0])) for sd in ("R", "L")]
              for s_ in figures}
        fin_ = _final_glove_texels(merged["uniform"], Jw, image.size[0], image.size[1])
        log(f"glove: {int((fin_ & ~glove_tex).sum())} more texels from the finished fist faces")
        glove_tex |= fin_
        # the cuff by texel: every texel of a face with a cuff vertex that is not the glove's, and its own padding
        cuff_raster = _face_mask_any(src_for_uv.data, uv, cuff, image.size[0], image.size[1])
        cuff_tex = (cuff_raster | (_dilate(cuff_raster, RETINT_PAD_PX) & ~covered_)) & ~glove_tex
        log(f"glove: {int(glove_tex.sum())} texels by interpolated hand weight (cut {GLOVE_CUT_M * 100:.0f} cm proximal), "
            f"cuff {int(cuff_tex.sum())} texels")
        _retint(image, src_for_uv, uv, {
            "boot": cls0["boot"][:n0] & ~glove & ~skin,
            "uniform": cls0["khaki"][:n0] & ~glove & ~skin & (co0[:, 2] > BOOT_Z_MAX),
            # the carrier's islands, less the glove's own faces (a fist sculpted against the vest can share its island)
            "vest": _carrier_texels(src_for_uv.data, uv, vest & ~glove, image.size[0], image.size[1]) & ~glove_tex,
            "cuff": cuff_tex,
            "sleeve_bleed": sleeve,
            # last, so nothing paints over the glove
            "glove": glove_tex,
        })
    bpy.data.objects.remove(src_for_uv, do_unlink=True)
    rig.export_glb(arm_obj, path, materials=True, jpeg_quality=JPEG_QUALITY)
    _stamp_extras(path, team_id, {s["prefix"]: dict(Js[s["prefix"]], gun=dict(Js[s["prefix"]]["gun"],
                  centre=Js[s["prefix"]]["gun"]["centre"] + np.array([s["x"], s["y"], 0.0])), slot=(s["x"], s["y"], 0.0)) for s in figures}, gun_tris, hand_tris)
    blend_out = os.environ.get("SKINNED_BLEND_OUT")
    if blend_out:
        # The source beside the GLB carries the atlas the GLB carries: the retinted 2048 buffer, not the 8k bake the
        # importer read (the packed file is still the 8k PNG after `scale`, 70 MB, and without the retint). Each image
        # is re-made as a generated one from its own pixels and packed (a generated image packs as PNG).
        for im in list(bpy.data.images):
            if not im.size[0]:
                continue
            w_, h_ = im.size
            px_ = np.empty(w_ * h_ * 4, np.float32); im.pixels.foreach_get(px_)
            new = bpy.data.images.new(im.name + "_atlas", w_, h_, alpha=True)
            new.pixels.foreach_set(px_)
            new.pack()
            im.user_remap(new)
            name_ = im.name
            bpy.data.images.remove(im)
            new.name = name_
        os.makedirs(os.path.dirname(blend_out), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=blend_out, copy=True)
        log(f"{team_id}: scene saved to {blend_out}")
    log(f"{team_id}: wrote {os.path.relpath(path, REPO)}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]; argv = [a for a in argv if a not in ("--out", out)]
    for name in argv or ["inf_squad"]:
        build_team(name, out)


if __name__ == "__main__":
    main()
