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
SMALL_ISLAND_VERTS = 80       # a separate shell piece smaller than this near the bore is the gun's (a loop, a buckle)
ISLAND_NEAR_BORE_M = 0.14     # ...within this of the bore: the stock's rear loop sat 0.10 off it and stayed at the chest in fire
GUN_L, GUN_C_MAX = (9.0, 28.0), 7.0
KHAKI_L, KHAKI_C, KHAKI_HUE = (26.0, 48.0), (12.0, 26.0), (60.0, 100.0)
SKIN_C_MIN, SKIN_L_MIN, SKIN_A_MIN = 12.0, 20.0, 5.0
BOOT_C_MIN, BOOT_Z_MAX, BOOT_TOP_M = 25.0, 0.27, 0.20

KNEE_F, ANKLE_M, BELT_ABOVE_CROTCH = 0.285, 0.09, 0.13
SHOULDER_Z, SHOULDER_IN = 1.42, 0.055
WRIST_BACK_M = 0.06           # the wrist crease sits this far behind the closed fist's centre (ANSUR: hand 0.19, fist ~0.11)
CUFF_BLEND_M = 0.03           # hand -> forearm blend behind the wrist plane
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


def _scale_joints(J, sz, sxy):
    """The joints of a figure scaled (xy about the origin, z about the ground)."""
    def s(p):
        p = np.asarray(p, float)
        return p * np.array([sxy, sxy, sz]) if p.shape[-1] == 3 else p * sxy
    out = dict(J, sxy=sxy, sz=sz)
    for k in ("S", "crotch", "belt", "knee", "ankle", "chin", "neck"):
        out[k] = J[k] * sz
    out["head_xy"] = s(J["head_xy"])
    for k in ("leg", "ankle_xy", "fist", "shoulder", "elbow", "wrist"):
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
        k = 0.5 + 0.5 * np.clip((t[cuff] + CUFF_BLEND_M) / CUFF_BLEND_M, 0.0, 1.0)   # 0.5 at the sleeve end, 1 at the wrist: the glove stays the hand's
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
    roles = dict(gun=gun, hand={s: h[0] | h[1] for s, h in hands.items()})
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
                new_faces.append((a, b, twin[b]))
                new_faces.append((a, twin[b], twin[a]))
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
    sets = {
        "weapon": np.nonzero(any_gun)[0],
        "boot": np.nonzero(~all_gun & (body_major == 1))[0],
        "face": np.nonzero(~all_gun & (body_major == 2))[0],
        "uniform": np.nonzero(~all_gun & (body_major == 3))[0],
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
        part["rl_role"] = role
        parts.append(part)
        log(f"{prefix}: role {role}: {len(pme.polygons)} tris")
    bpy.data.objects.remove(ob, do_unlink=True)
    return parts


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


def _face_mask(me, uv, vmask, W_, H_):
    """Texels under the faces whose vertices are (by majority) in `vmask`, on a W_ x H_ atlas (Blender rows, v up)."""
    polys = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get("vertices", polys); polys = polys.reshape(-1, 3)
    faces = polys[vmask[polys].sum(1) >= 2]
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


#: The lead's colours (1 Nov): each class's texels are moved so their MEAN lands on the target, keeping `keep` of their
#: own variation (shading, seams, dirt). CIE L*a*b*. The glove's target is dE 21 from the olive, 35 from the vest, 28
#: from the carbine; L* 33 and C* 21 inside the glove gate's bands.
RETINT = {
    "uniform": dict(target=(36.0, -6.0, 14.0), keep=1.0, orange_only=False),   # olive drab, from Meshy's khaki (40, 1, 20)
    # dark brown, every glove texel (the baked-dark inside of the fist too: with those left out the hand read L* 19-26)
    # (the validator reads the hand's vertex texels ~5 L* under this mask mean: at 34 it read 28-31 and dE 12-15)
    # a brown, not a pink: hue toward yellow (b over a); dE 17.5 to the olive; reads L* 31-33 at the hand's own texels
    "glove": dict(target=(37.0, 11.0, 18.0), keep=0.35, orange_only=False),
    "boot": dict(target=(50.0, 12.0, 26.0), keep=0.7, orange_only=True),       # tan leather, from Meshy's orange
    # Meshy's bake bled the glove's orange onto the cuffs and the sleeves: whatever orange is left on the uniform's
    # faces goes to the olive
    "bleed": dict(target=(36.0, -6.0, 14.0), keep=0.5, orange_only=True),
}
ORANGE_C_MIN, ORANGE_HUE = 18.0, (15.0, 75.0)
GLOVE_L_CLAMP = (28.0, 46.0)


def _retint(image, src, uv, masks):
    """Shift the bake's texels per class (`RETINT`). Texture only: no vertex moves. Logs each class's mean before/after."""
    W_, H_ = image.size
    px = np.empty(W_ * H_ * 4, np.float32); image.pixels.foreach_get(px); px = px.reshape(H_, W_, 4)
    out = px.copy()
    me = src.data
    for name, vmask in masks.items():
        spec = RETINT[name]
        mask = _face_mask(me, uv, vmask, W_, H_)
        if spec["orange_only"]:
            lab_all = _lab(px[..., :3].astype(np.float64))
            C_ = np.hypot(lab_all[..., 1], lab_all[..., 2]); hue_ = np.degrees(np.arctan2(lab_all[..., 2], lab_all[..., 1]))
            mask &= (C_ > ORANGE_C_MIN) & (hue_ > ORANGE_HUE[0]) & (hue_ < ORANGE_HUE[1])
        if not mask.any():
            log(f"retint {name}: no texels")
            continue
        lab = _lab(px[mask][:, :3].astype(np.float64))
        mean = lab.mean(0)
        new = np.array(spec["target"]) + spec["keep"] * (lab - mean)
        if name == "glove":
            new[:, 0] = np.clip(new[:, 0], *GLOVE_L_CLAMP)
        rgb = _lab_to_rgb(new)
        out[mask, :3] = rgb.astype(np.float32)
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
        for k in ("fist", "wrist", "elbow", "shoulder"):
            Jt[k] = {s: v + shift for s, v in J[k].items()}
        Jt["leg"] = {s: v + shift[:2] for s, v in J["leg"].items()}
        _auto_weights(shell, arm_obj)
        names, W, roles = _fix_weights(shell, p, Jt, cls0, co)
        _census(shell, p, W, names)
        cap_idx, cap_cls = _cut_seams(shell, p, Jt, roles, co, uv, cls0)
        # the shell grew: extend the per-vertex arrays the split reads (caps take their side's class)
        co = np.empty(len(shell.data.vertices) * 3); shell.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        n_new = len(cap_idx)
        cls_sh = {k: np.concatenate([v, np.zeros(n_new, v.dtype)]) for k, v in cls0.items()}
        roles = dict(roles, gun=np.concatenate([roles["gun"], cap_cls == 0]),
                     hand={s_: np.concatenate([h, np.zeros(n_new, bool)]) for s_, h in roles["hand"].items()})
        for s_ in ("R", "L"):
            # a fist cap belongs to the fist it closes
            pass
        roles["hand_cap"] = cap_cls == 1
        cls0_fig = cls_sh
        if glove_texel is None:
            # the source's own uv (the caps are appended after it): the firing fist's vertices of the source shell
            glove_texel = _glove_texel(uv, roles["hand"]["R"][: len(uv)], TEXTURE_PX, TEXTURE_PX)
            hand_tris = roles["hand_tris"]
            hand_masks_f1 = {k: v.copy() for k, v in roles["hand"].items()}
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
        _retint(image, src_for_uv, uv, {
            "glove": glove,
            "boot": cls0["boot"][:n0] & ~glove,
            "uniform": cls0["khaki"][:n0] & ~glove & (co0[:, 2] > BOOT_Z_MAX),
            "bleed": ~glove & ~cls0["boot"][:n0] & (co0[:, 2] > BOOT_Z_MAX),
        })
    bpy.data.objects.remove(src_for_uv, do_unlink=True)
    rig.export_glb(arm_obj, path, materials=True, jpeg_quality=JPEG_QUALITY)
    _stamp_extras(path, team_id, {s["prefix"]: dict(Js[s["prefix"]], gun=dict(Js[s["prefix"]]["gun"],
                  centre=Js[s["prefix"]]["gun"]["centre"] + np.array([s["x"], s["y"], 0.0])), slot=(s["x"], s["y"], 0.0)) for s in figures}, gun_tris, hand_tris)
    blend_out = os.environ.get("SKINNED_BLEND_OUT")
    if blend_out:
        for im in bpy.data.images:
            if im.packed_file is None and im.size[0]:
                im.pack()
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
