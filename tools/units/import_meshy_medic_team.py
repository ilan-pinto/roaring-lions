"""Build the Nemala Medic Team (`inf_medic_squad`) GLB from ONE Meshy A-pose
figure WITH ITS BAKE, through rig.py.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_medic_team.py

Writes `art/meshes/inf_medic_squad.glb` and its source
`art/src/units/inf_medic_squad.blend` -- GH-707 P2 (22 Oct 2026), the rescue
team of the wounded-and-rescue loop. Owner of the file in
`rig.TEAM_MESH_OWNER`, so `export_mesh_team.py -- all` skips it. Then, in this
order: `pnpm motion:meshes -- --id=inf_medic_squad`, `pnpm gait:meshes --
--id=inf_medic_squad`, `pnpm encode:meshes`.

SOURCE (`art/meshy/inf-medic-squad-20261022-<task>/model.glb`; Meshy
text-to-3d preview in `--pose a-pose`, refined at 2k, REMESHED at 1,800 tris --
the remesh keeps the refine's bake, as it did for at_team and demo_squad):

  preview 01a16317  (the second of two: the first came back bare-headed)
  refine  01a16321
  remesh  01a16325   (1,849 tris)

AI-generated (Meshy), disclosed per CONTRIBUTING.md and in
docs/ASSET_PROVENANCE.md.

## What the source is, and what this file does about it

The figure has a helmet, a plate carrier, a white band on the right arm and a
hip holster. It does NOT have a trauma pack or a stretcher bundle (Meshy-6 left
the back load out of both previews), and it is not a symmetric A-pose: the
anatomical RIGHT arm (rig `_L`, side 0, -y here) is bent with the hand at the
chest, closed round a carbine-sized weapon, and the LEFT arm is held out, palm
up. So, on top of `import_meshy_kdf_team.py`'s cut (whose helpers this file
imports):

  * the held weapon is CUT OFF -- every face within `PISTOL_R` of the segment
    `PISTOL_A`-`PISTOL_B` that is not skin (the hand stays, empty, which is a
    curled fist at the chest at 25 px). Each medic carries a KIT carbine instead
    (`rig._weapon_parts`, on `{prefix}_forearm_R`, which the motion pass's hold
    moves onto its own `{prefix}_weapon` bone: low ready in idle and move,
    aimed in fire, SLUNG on the back in `carry` and `treat`, see
    `tools/src/meshes/motion/rescue.ts`);
  * both arms are cut as TWO-SEGMENT chains (shoulder, elbow, hand), measured
    off this remesh (`_measure_arms`), not as one straight A-pose axis -- the
    bent arm has no such axis. Each is then hung rigidly (upper arm about the
    shoulder, forearm about the elbow) like the A-pose arms of the siblings;
  * the trauma pack, the upright folded-stretcher bundle (its top
    `BUNDLE_ABOVE_HELMET` above the helmet, the silhouette lever against
    at_team / demo_squad / breach_team / inf_squad) and a white helmet band are
    PALETTE kit parts on the spine and the head (role webbing, wood+metal,
    keffiyeh = the palest role); no red anywhere, no mark of any kind;
  * the two men are DIFFERENT BODIES (the lead's standing infantry rule, 22
    Oct): `med_a` is `FIGURES['med_a']['height']` tall and slim, `med_b` is
    shorter, `girth` wider and deeper through trunk and limbs. The variation is
    a non-uniform scale of the source (`_variant`) before the cut, with the
    boots and the head held at their own width, so the bake is untouched;
  * the litter (poles with grips, canvas bed, two spreaders, four stirrups) and
    the casualty on it (`kit.casualty`, scaled to the litter) are rigid parts of
    a parentless bone `med_a_litter` at scale 0 in every clip but `carry`/
    `treat`'s, owned by the first man so a per-figure split of the clips leaves
    no track unowned (`units/squad-rig.ts`).

Every figure carries a prone corpse for `down`/`wreck`, decimated, on
`{prefix}_death_root` (the sibling importers' convention).
No `mathutils.noise` anywhere in this file.
"""
import glob
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402
import rig  # noqa: E402
import import_meshy_kdf_team as base  # noqa: E402

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes")
SRC_DIR = os.path.join(REPO, "art", "src", "units")
TEAM_ID = "inf_medic_squad"
SOURCE = os.path.join(REPO, "art", "meshy", "inf-medic-squad-*-01a16325", "model.glb")
H0 = 1.78
base.SOURCES[TEAM_ID] = (SOURCE, H0)

#: The held weapon, a segment in the loaded frame (face +X, 1.78 m, feet on the
#: ground): the rear end at the chest, the muzzle forward and low. Faces whose
#: centroid is within PISTOL_R of it and are not skin go.
PISTOL_A = (0.13, -0.10, 1.38)
PISTOL_B = (0.40, 0.08, 1.00)
PISTOL_R = 0.06

#: The two bodies. `height` is the standing height in metres, `girth` the
#: trunk-and-limb width multiplier (x and y about the body axis), `slot` the
#: rest position (Blender x, y). Their mean height is 1.79 m, the 1.78 class.
FIGURES = {
    "med_a": dict(height=1.83, girth=0.97, slot=(0.30, -0.40)),
    "med_b": dict(height=1.75, girth=1.15, slot=(-0.30, 0.40)),
}
#: The girth ramps in over [ANKLE, KNEE] of the figure's height and out over
#: [NECK, CHIN]: boots and head keep their own width.
GIRTH_IN = (0.09, 0.30)
GIRTH_OUT = (0.80, 0.87)

#: The folded stretcher bundle stands this far above the helmet.
BUNDLE_ABOVE_HELMET = 0.30
BUNDLE_LEN = 0.92
BUNDLE_R = 0.062
PACK_SIZE = (0.20, 0.34, 0.27)

#: The litter, in the team frame: the carried height of the poles (the arms are
#: short -- 0.45 m shoulder ring to fingertips -- so the poles ride near the
#: hands' hanging reach), its length and width, and the bearers' x.
LITTER_Z = 0.98
LITTER_LEN = 2.20
LITTER_W = 0.55
BEARER_X = 1.35
CASUALTY_FIT = 0.90          # the casualty is scaled to the litter bed
DEATH_DECIMATE = 0.25
CASUALTY_RATIO = 0.60        # the casualty's collapse ratio, per role; kit.casualty is 1,646 tris

# LOG ---------------------------------------------------------------------


def log(msg):
    print(f"[medic] {msg}")


# ---------------------------------------------------------------------------
# the source: weapon off, arms measured
# ---------------------------------------------------------------------------

def _skin_mask(col):
    return (col[:, 0] > 0.5) & (col[:, 1] < 0.46) & (col[:, 2] < 0.42) & (col[:, 0] > col[:, 1] * 1.35)


def _face_colours(ob, mat):
    """The bake's colour under every face's UV centroid."""
    img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
    w, h = img.size
    px = np.array(img.pixels[:]).reshape(h, w, -1)
    me = ob.data
    uv = me.uv_layers.active.data
    out = []
    for p in me.polygons:
        u = np.mean([tuple(uv[li].uv) for li in p.loop_indices], axis=0)
        out.append(px[min(h - 1, int(u[1] * h)), min(w - 1, int(u[0] * w)), :3])
    return np.array(out)


def cut_weapon(src, mat):
    """Delete the held weapon's faces; return (faces before, faces after)."""
    cent = base._face_centroids(src)
    col = _face_colours(src, mat)
    a, b = np.array(PISTOL_A), np.array(PISTOL_B)
    ab = b - a
    t = np.clip(((cent - a) @ ab) / (ab @ ab), 0.0, 1.0)
    dist = np.linalg.norm(cent - (a + t[:, None] * ab), axis=1)
    gone = (dist < PISTOL_R) & ~_skin_mask(col)
    if not 30 <= gone.sum() <= 120:
        raise SystemExit(f"weapon cut took {int(gone.sum())} faces -- the source changed; look before cutting")
    base._keep_only(src, set(np.where(~gone)[0].tolist()))
    return len(cent), len(cent) - int(gone.sum())


def _measure_arms(src, mat, H):
    """Shoulder, elbow, hand, fingertip for each side, in the loaded frame.

    Side 0 (-y) is the bent arm, side 1 (+y) the held-out one. The shoulder is
    the centroid of the arm-root ring above the hip pouches (as the sibling
    importer). The elbow is the centroid of the faces furthest from the body
    along the arm; the hand and tip come from the skin-coloured faces."""
    cent = base._face_centroids(src)
    col = _face_colours(src, mat)
    skin = _skin_mask(col) & (cent[:, 2] > 0.9 * 1.0) & (cent[:, 2] < 1.45)
    co = base._coords(src)
    w_arm = base.ARM_ROOT_F * H
    out = {}
    for side in (0, 1):
        sgn = -1.0 if side == 0 else 1.0
        y = co[:, 1] * sgn
        ring = co[(y > w_arm) & (y < w_arm + 0.05) & (co[:, 2] > 0.62 * H)]
        if len(ring) < 8:
            raise SystemExit(f"arm{side}: ring of {len(ring)} points")
        shoulder = ring.mean(axis=0)
        ys = cent[:, 1] * sgn
        arm = (ys > w_arm + 0.02) & (cent[:, 2] > 0.55 * H) & (cent[:, 2] < 0.84 * H)
        hand = skin & (ys > -0.05) & ((ys > 0.45) if side == 1 else (cent[:, 0] > 0.05))
        if hand.sum() < 6:
            raise SystemExit(f"arm{side}: {int(hand.sum())} skin faces for the hand")
        hand_c = cent[hand].mean(axis=0)
        if side == 1:
            # the held-out arm: elbow where it turns, a third of the way out
            e = arm & (ys > 0.38) & (ys < 0.46)
        else:
            e = arm & (ys > 0.30)
        if e.sum() < 4:
            raise SystemExit(f"arm{side}: {int(e.sum())} faces at the elbow")
        elbow = cent[e].mean(axis=0)
        far = cent[hand]
        tip = far[np.argmax(np.linalg.norm(far - elbow, axis=1))]
        out[side] = dict(shoulder=shoulder, elbow=elbow, hand=hand_c, tip=np.array(tip))
        log(f"arm{side}: shoulder {np.round(shoulder, 3)} elbow {np.round(elbow, 3)} hand {np.round(hand_c, 3)} "
            f"tip {np.round(tip, 3)} (upper {np.linalg.norm(elbow - shoulder):.3f} fore {np.linalg.norm(tip - elbow):.3f})")
    return out


# ---------------------------------------------------------------------------
# two bodies from one source
# ---------------------------------------------------------------------------

def _smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def _girth_at(z0, girth):
    """The width multiplier at source height z0 (of H0)."""
    f = z0 / H0
    up = _smooth((f - GIRTH_IN[0]) / (GIRTH_IN[1] - GIRTH_IN[0]))
    down = 1.0 - _smooth((f - GIRTH_OUT[0]) / (GIRTH_OUT[1] - GIRTH_OUT[0]))
    return 1.0 + (girth - 1.0) * up * down


def make_variant_map(spec, xc):
    """A point map T: loaded frame (H0) -> this body. Non-uniform: x and y
    scale about the body axis by the girth ramp, z by the height ratio."""
    hs = spec["height"] / H0

    def T(p):
        g = _girth_at(float(p[2]), spec["girth"])
        return np.array([xc + (p[0] - xc) * g, p[1] * g, p[2] * hs])
    return T


def _variant(src, name, T):
    """A full copy of `src` mapped through T."""
    ob = base._piece(src, name, "uniform", set(range(len(src.data.polygons))))
    for v in ob.data.vertices:
        v.co = Vector(T(np.array(v.co)))
    return ob


# ---------------------------------------------------------------------------
# one body: cut into rig.py parts
# ---------------------------------------------------------------------------

#: Joint blobs: the sibling importer's 9 x 3 cost ~90 triangles each; eight to a
#: man, two men, and the team cap is 8,000. 8 x 2 hides the same seams.
BLOB = dict(sides=8, rings=2)
R_UPPER = 0.125
CAP_WIDTH = 0.12             # ...and only this far out; past it a sleeve held outward is arm
CAP_ABOVE_PIVOT = 0.06       # faces higher than this over the pivot are shoulder cap, not sleeve
R_FORE = 0.105


def _seg_dist(p, a, b):
    ab = b - a
    t = min(1.0, max(0.0, float((p - a) @ ab) / float(ab @ ab)))
    return float(np.linalg.norm(p - (a + t * ab))), t


def cut_medic(var, H, prefix, mat, arms, girth_k=1.0):
    """`import_meshy_kdf_team.cut_figure` with the arms as two-segment chains
    (`arms[side]` = shoulder, elbow, hand, tip in THIS body's frame)."""
    co = base._coords(var)
    cent = base._face_centroids(var)
    col = _face_colours(var, mat)
    skin = _skin_mask(col)
    zc = base.CROTCH_F * H
    z_ankle, z_boot, z_knee = base.ANKLE_F * H, base.BOOT_TOP_F * H, base.KNEE_F * H
    z_belt, z_neck, z_chin = zc + 0.08, base.NECK_F * H, base.CHIN_F * H
    head = co[co[:, 2] > z_chin]
    x_head = head[:, 0].mean()
    w_arm = base.ARM_ROOT_F * H
    chest = cent[(np.abs(cent[:, 1]) < 0.12) & (cent[:, 2] > 0.56 * H) & (cent[:, 2] < 0.74 * H)]
    front_x = float(np.median(chest[:, 0])) + 0.03     # the carrier's face; the bent forearm's fist stands proud of it
    log(f"{prefix}: H {H:.3f} crotch {zc:.3f} knee {z_knee:.3f} neck {z_neck:.3f} chin {z_chin:.3f}")

    def arm_of(i):
        p = cent[i]
        for side in (0, 1):
            a = arms[side]
            # The pivot sits at the armpit (the hold's constants are tuned for that), so
            # the shoulder cap above it stays on the torso and a deltoid blob covers the wedge.
            dU, tU = _seg_dist(p, a["shoulder"], a["elbow"])
            if p[2] > a["shoulder"][2] + CAP_ABOVE_PIVOT * H / H0 and abs(p[1]) < w_arm + CAP_WIDTH:
                dU = 9.0
            dF, tF = _seg_dist(p, a["elbow"], a["tip"])
            dU, dF = dU / girth_k, dF / girth_k
            outboard = abs(p[1]) > w_arm and p[2] > 0.5 * H
            if side == 1:
                if outboard and (dU < R_UPPER or dF < R_FORE):
                    return side, ("upper" if dU <= dF else "fore")
            else:
                # the bent forearm lies in front of the chest: its sleeve and its fist
                if outboard and dU < R_UPPER and dU <= dF:
                    return side, "upper"
                if dF < R_FORE and (outboard or skin[i] or p[0] > front_x) and p[2] > 0.55 * H:
                    return side, "fore"
        return None, None

    classes = {}

    def put(i, name, role):
        classes.setdefault((name, role), set()).add(i)

    for i, (x, y, z) in enumerate(cent):
        side, seg = arm_of(i)
        if side is not None:
            put(i, f"{seg}{side}", "uniform")
        elif z > z_chin:
            if x > x_head + 0.02 and base.FACE_LO_F * H < z < base.FACE_HI_F * H and abs(y) < base.FACE_HALF_W:
                put(i, "face", "face")
            else:
                put(i, "cranium", "uniform")
        elif z > z_neck:
            put(i, "neck", "uniform")
        elif z > z_belt:
            put(i, "torso", "uniform")
        elif z > zc - 0.02:
            put(i, "hips", "uniform")
        else:
            side = 0 if y < 0 else 1
            if z > z_knee:
                put(i, f"thigh{side}", "uniform")
            elif z > z_boot:
                put(i, f"calf{side}", "uniform")
            else:
                put(i, f"boot{side}", "boot")

    if os.environ.get("MEDIC_DEBUG"):
        for (name, role), faces in sorted(classes.items()):
            if name in ("torso", "hips", "neck", "cranium"):
                far = [i for i in faces if abs(cent[i][1]) > 0.27]
                log(f"  {name}: {len(faces)} faces, {len(far)} with |y| > 0.27: "
                    + " ".join(f"({cent[i][0]:.2f},{cent[i][1]:.2f},{cent[i][2]:.2f})" for i in far[:40]))
    parts = {}
    for (name, role), faces in classes.items():
        key = {"upper0": "upperarm0", "upper1": "upperarm1", "fore0": "forearm0", "fore1": "forearm1"}.get(name, name)
        parts[key] = base._piece(var, f"{prefix}_{key}", role, faces)
    for need in ("face", "cranium", "neck", "torso", "hips", "thigh0", "thigh1", "calf0", "calf1",
                 "boot0", "boot1", "upperarm0", "upperarm1", "forearm0", "forearm1"):
        if need not in parts:
            raise SystemExit(f"{prefix}: the cut produced no {need!r} part")

    joints = {"H": H, "crotch": zc, "knee": z_knee, "ankle": z_ankle, "neck": z_neck, "chin": z_chin,
              "belt": z_belt, "leg": {}, "arm": {}}
    for side in (0, 1):
        pc = base._coords(parts[f"calf{side}"])
        top = pc[pc[:, 2] > z_knee - 0.05]
        joints["leg"][side] = (float(top[:, 0].mean()), float(top[:, 1].mean()))

    k = H / kit.FIGURE_H
    for side in (0, 1):
        a = arms[side]
        S, E, W = Vector(a["shoulder"]), Vector(a["elbow"]), Vector(a["tip"])
        upper, fore = parts[f"upperarm{side}"], parts[f"forearm{side}"]
        sgn = -1.0 if side == 0 else 1.0
        target = Vector((0.0, sgn * math.sin(math.radians(base.ARM_HANG_DEG)), -math.cos(math.radians(base.ARM_HANG_DEG))))
        q = (E - S).rotation_difference(target)
        hang = Matrix.Translation(S) @ q.to_matrix().to_4x4() @ Matrix.Translation(-S)
        elbow_h = hang @ E
        # the forearm hangs too: about the (already moved) elbow, onto the same line
        tip_h = hang @ W
        q2 = (tip_h - elbow_h).rotation_difference(target)
        fhang = Matrix.Translation(elbow_h) @ q2.to_matrix().to_4x4() @ Matrix.Translation(-elbow_h)
        base._transform(upper, hang)
        base._transform(fore, fhang @ hang)
        wrist_h = elbow_h + target * ((W - E).length * base.WRIST_FRAC)
        deltoid = kit.blob(f"{prefix}_deltoid{side}", tuple(S), base.BLOB_R["deltoid"] * k, squash=(1.0, 1.0, 0.9), **BLOB)
        elbow_b = kit.blob(f"{prefix}_elbow{side}", tuple(elbow_h), base.BLOB_R["elbow"] * k, **BLOB)
        base._pin_uv(deltoid, parts["torso"], mat)
        base._pin_uv(elbow_b, upper, mat)
        parts[f"deltoid{side}"] = deltoid
        parts[f"elbow{side}"] = elbow_b
        joints["arm"][side] = {"shoulder": tuple(S), "elbow": tuple(elbow_h), "wrist": tuple(wrist_h)}
        log(f"{prefix}: arm{side} upper {(E - S).length:.3f} fore {(W - E).length:.3f} hung to {base.ARM_HANG_DEG} deg; "
            f"shoulder z {S.z:.3f} elbow z {elbow_h.z:.3f} wrist z {wrist_h.z:.3f}")

    for side in (0, 1):
        lx, ly = joints["leg"][side]
        knee = kit.blob(f"{prefix}_knee{side}", (lx, ly, z_knee), base.BLOB_R["knee"] * k, **BLOB)
        hip = kit.blob(f"{prefix}_hip{side}", (lx, ly, zc), base.BLOB_R["hip"] * k, squash=(1.05, 1.05, 1.05), **BLOB)
        base._pin_uv(knee, parts[f"thigh{side}"], mat)
        base._pin_uv(hip, parts[f"thigh{side}"], mat)
        parts[f"knee{side}"] = knee
        parts[f"hip{side}"] = hip
    return parts, joints


def build_debug(path):
    """MEDIC_DEBUG=<png>: photograph the scene, one flat colour a part, from
    the front, a three-quarter and the side."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "OBJECT"
    sc.render.resolution_x, sc.render.resolution_y = 900, 900
    w = bpy.data.worlds.new("w")
    w.color = (0.85, 0.85, 0.85)
    sc.world = w
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = float(os.environ.get("MEDIC_SCALE", "2.3"))
    import colorsys
    obs = sorted([o for o in bpy.data.objects if o.type == "MESH" and o.name != "figure_src"], key=lambda o: o.name)
    hide = [h for h in os.environ.get("MEDIC_HIDE", "").split(",") if h]
    show = os.environ.get("MEDIC_SHOW")
    for ob in obs:
        if any(h in ob.name for h in hide) or (show and show not in ob.name):
            ob.hide_render = True
    for i, ob in enumerate(obs):
        r, g, b = colorsys.hsv_to_rgb((i * 0.381966) % 1.0, 0.85, 0.95 if i % 2 else 0.65)
        ob.color = (r, g, b, 1)
    ctr = Vector((0.0, 0.0, float(os.environ.get("MEDIC_Z", "0.9"))))
    for name, d in {"f": (1, 0, 0), "q": (1, -1, 0.35), "s": (0, -1, 0), "b": (-1, 0, 0)}.items():
        d = Vector(d).normalized()
        cam.location = ctr + d * 6
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = path.replace(".png", f"_{name}.png")
        bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------
# kit parts: pack, bundle, helmet band, litter, casualty
# ---------------------------------------------------------------------------

def _pin_texel(ob, ref, mat):
    """Give a bare kit part one texel of the bake: the UV centroid of the face
    of `ref` nearest `ref`'s own centre. A casualty's uniform, boots and face
    must join the textured roles (one primitive, one material per role), and
    this is what lets them; they read as the cloth they are made of."""
    cents, uvs = base._face_uv_table(ref)
    # the face whose bake colour is the part's own MEAN colour: a plate or a seam in
    # the middle of the torso reads near black, and a casualty in black reads as a hole
    cols = _face_colours(ref, mat)
    i = int(np.argmin(((cols - cols.mean(axis=0)) ** 2).sum(axis=1)))
    me = ob.data
    layer = me.uv_layers.new(name=ref.data.uv_layers.active.name)
    for loop in layer.data:
        loop.uv = (float(uvs[i][0]), float(uvs[i][1]))
    me.materials.append(mat)


def ring_band(name, centre, rx, ry, z0, z1, role, thick=0.005, sides=10):
    """A thin open band round an ellipse (a helmet band): an outer and an inner
    wall and the two rims, so it is solid from any side."""
    cx, cy = centre
    verts, faces = [], []
    for (ax, ay) in ((rx, ry), (rx - thick, ry - thick)):
        for z in (z0, z1):
            for j in range(sides):
                a = 2.0 * math.pi * j / sides
                verts.append((cx + ax * math.cos(a), cy + ay * math.sin(a), z))
    n = sides
    o0, o1, i0, i1 = 0, n, 2 * n, 3 * n
    for j in range(n):
        k = (j + 1) % n
        faces.append((o0 + j, o0 + k, o1 + k, o1 + j))        # outer wall
        faces.append((i0 + k, i0 + j, i1 + j, i1 + k))        # inner wall
        faces.append((o1 + j, o1 + k, i1 + k, i1 + j))        # top rim
        faces.append((o0 + k, o0 + j, i0 + j, i0 + k))        # bottom rim
    return kit._mesh(name, verts, faces, role)


def body_kit(prefix, parts, H, x, y):
    """The trauma pack, the folded-stretcher bundle with its two poles and
    straps, and the helmet band for one body (parts are at the origin, the
    figure is placed at (x, y) afterwards by `base._place`). Returns the list
    of new objects; all are palette parts bound by PART_BONE suffixes."""
    torso = base._coords(parts["torso"])
    back_hi = float(torso[(torso[:, 2] > 0.60 * H) & (torso[:, 2] < 0.84 * H), 0].min())
    back_lo = float(torso[(torso[:, 2] > 0.50 * H) & (torso[:, 2] < 0.62 * H), 0].min())
    out = []
    # --- trauma pack: low on the back, a boxy bag with a flap and two buckles
    pz = 0.54 * H
    px = back_lo - PACK_SIZE[0] / 2.0 + 0.03
    out.append(kit.rbox(f"{prefix}_pack", PACK_SIZE, (px, 0.0, pz), chamfer=0.22, role="webbing"))
    out.append(kit.rbox(f"{prefix}_packflap", (PACK_SIZE[0] + 0.012, PACK_SIZE[1] + 0.012, 0.035),
                        (px, 0.0, pz + PACK_SIZE[2] / 2.0 - 0.012), chamfer=0.22, role="webbing"))
    for i, by in enumerate((-0.07, 0.07)):
        out.append(kit.box(f"{prefix}_buckle{i}", (0.014, 0.036, 0.05),
                           (px - PACK_SIZE[0] / 2.0 - 0.005, by, pz + 0.06), role="metal"))
    # --- the upright folded stretcher: a canvas roll, two poles lashed to it
    top = H + BUNDLE_ABOVE_HELMET
    pole_len = BUNDLE_LEN + 0.16
    bx = back_hi - BUNDLE_R + 0.012
    roll_top = top - 0.08
    roll_z = roll_top - BUNDLE_LEN / 2.0
    out.append(kit.tube(f"{prefix}_bundle", BUNDLE_LEN, BUNDLE_R, (bx, 0.0, roll_z), pitch=math.pi / 2.0, sides=10, role="wood"))
    for i, sy in enumerate((-0.058, 0.058)):
        out.append(kit.tube(f"{prefix}_bpole{i}", pole_len, 0.0145,
                            (bx - BUNDLE_R * 0.92, sy, top - pole_len / 2.0), pitch=math.pi / 2.0, sides=6, role="metal"))
    for i, sz in enumerate((roll_top - 0.16, roll_top - BUNDLE_LEN * 0.52, roll_top - BUNDLE_LEN + 0.16)):
        out.append(kit.tube(f"{prefix}_bstrap{i}", 0.040, BUNDLE_R + 0.010, (bx, 0.0, sz), pitch=math.pi / 2.0, sides=10, role="webbing"))
    # --- the white helmet band: the one medical mark, palest role, no emblem
    cr = base._coords(parts["cranium"])
    x_head = float(base._coords(parts["face"])[:, 0].mean()) if "face" in parts else 0.0
    front = cr[cr[:, 0] > cr[:, 0].mean() + 0.04]
    brim = float(front[:, 2].min())
    zb = brim + 0.050
    band = cr[(cr[:, 2] > zb - 0.012) & (cr[:, 2] < zb + 0.012)]
    cxh, cyh = float((band[:, 0].min() + band[:, 0].max()) / 2.0), float((band[:, 1].min() + band[:, 1].max()) / 2.0)
    rxh, ryh = float((band[:, 0].max() - band[:, 0].min()) / 2.0) + 0.004, float((band[:, 1].max() - band[:, 1].min()) / 2.0) + 0.004
    out.append(ring_band(f"{prefix}_helmband", (cxh, cyh), rxh, ryh, zb - 0.017, zb + 0.017, "keffiyeh"))
    log(f"{prefix}: pack at x {px:+.3f} z {pz:.3f}; bundle at x {bx:+.3f} z {roll_z - BUNDLE_LEN / 2:.2f}..{top:.2f} "
        f"(helmet {H:.2f}, +{BUNDLE_ABOVE_HELMET}); band z {zb:.3f} ellipse {rxh:.3f} x {ryh:.3f}")
    return out


def litter_parts(prefix):
    """The litter, open, at its carried pose in the team frame: x along its
    length, y across, z up; 2.2 x 0.55 m. Poles with grips, a flat canvas bed
    and its hems, two spreaders, four stirrups. Palette `metal`/`wood`."""
    z = LITTER_Z
    hw = LITTER_W / 2.0
    out = []
    for i, sy in enumerate((-hw, hw)):
        out.append(kit.tube(f"{prefix}_litter_pole{i}", LITTER_LEN, 0.020, (0.0, sy, z), sides=8, role="metal"))
        for j, sx in enumerate((-1, 1)):
            out.append(kit.tube(f"{prefix}_litter_grip{i}{j}", 0.20, 0.031, (sx * (LITTER_LEN / 2.0 - 0.12), sy, z), sides=8, role="wood"))
            out.append(kit.blob(f"{prefix}_litter_cap{i}{j}", (sx * (LITTER_LEN / 2.0 - 0.01), sy, z), 0.026,
                                squash=(0.6, 1.0, 1.0), sides=6, rings=1, wobble=0.0, role="metal"))
    bed_len = 1.72
    out.append(kit.rbox(f"{prefix}_litter_bed", (bed_len, LITTER_W - 0.06, 0.014), (0.0, 0.0, z - 0.010), chamfer=0.06, role="wood"))
    for i, sy in enumerate((-(hw - 0.03), hw - 0.03)):
        out.append(kit.tube(f"{prefix}_litter_hem{i}", bed_len, 0.014, (0.0, sy, z - 0.004), sides=6, role="wood"))
    for i, sx in enumerate((-0.56, 0.56)):
        out.append(kit.tube(f"{prefix}_litter_spreader{i}", LITTER_W + 0.04, 0.013, (sx, 0.0, z - 0.034), sides=6, role="metal",
                            yaw=math.pi / 2.0))
        for j, sy in enumerate((-hw, hw)):
            out.append(kit.box(f"{prefix}_litter_hinge{i}{j}", (0.05, 0.04, 0.045), (sx, sy, z - 0.020), role="metal"))
    for i, sx in enumerate((-0.80, 0.80)):
        for j, sy in enumerate((-hw, hw)):
            out.append(kit.tube(f"{prefix}_litter_leg{i}{j}", 0.17, 0.012, (sx, sy, z - 0.105), pitch=math.pi / 2.0, sides=6, role="metal"))
            out.append(kit.box(f"{prefix}_litter_foot{i}{j}", (0.13, 0.04, 0.02), (sx, sy, z - 0.200), role="metal"))
    return out


def casualty_on_litter(prefix, mat, refs):
    """A KDF-kit casualty (`kit.casualty`: prone, head to +x, no weapon) on the
    bed, scaled to the litter; uniform, face and boot parts take a texel of the
    bake so they join the textured roles."""
    zb = LITTER_Z - 0.003
    cx = 0.06
    parts = kit.casualty(f"{prefix}_cas", at=(cx, 0.0, zb), headgear="helmet", loadout="regular")
    s = CASUALTY_FIT
    m = Matrix.Translation((cx, 0.0, zb)) @ Matrix.Scale(s, 4) @ Matrix.Translation((-cx, 0.0, -zb))
    for ob in parts:
        base._transform(ob, m)
        role = ob["rl_role"]
        if role in refs:
            _pin_texel(ob, refs[role], mat)
    # One object per role, collapsed: every part rides the same bone, and at the
    # size a stretcher case is drawn kit.casualty's 1,646 triangles are not seen.
    out = []
    by_role = {}
    for ob in parts:
        by_role.setdefault(ob["rl_role"], []).append(ob)
    for role in sorted(by_role):
        group = by_role[role]
        bpy.ops.object.select_all(action="DESELECT")
        for ob in group:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group) > 1:
            bpy.ops.object.join()
        one = bpy.context.view_layer.objects.active
        one.name = one.data.name = f"{prefix}_cas_{role}"
        one["rl_role"] = role
        mod = one.modifiers.new("dec", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = CASUALTY_RATIO
        bpy.ops.object.modifier_apply(modifier=mod.name)
        out.append(one)
    return out


# ---------------------------------------------------------------------------
# the team
# ---------------------------------------------------------------------------

#: A pixel of the shipped bake this red or redder is a red mark. The ruling is "no Red Cross, Red
#: Crescent, Red Crystal, Star of Life or MDA star, no red on any band": the white bands are the
#: only medical mark. Boots and skin are terracotta and a lip or a hand's shadow reaches
#: (0.47, 0.16, 0.22) -- 137 pixels of the 2048 bake are redder than (0.45, 0.22, 0.22) and every one is
#: skin; a printed mark is pure red, r above 0.55. The Meshy refine of 01a16321 reads 0 such pixels.
RED_PIXEL = dict(r_min=0.55, g_max=0.18, b_max=0.18)


def red_pixels(mat):
    """How many pixels of the figure's base-colour bake are saturated red."""
    img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
    px = np.array(img.pixels[:]).reshape(-1, img.channels)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    return int(((r > RED_PIXEL["r_min"]) & (g < RED_PIXEL["g_max"]) & (b < RED_PIXEL["b_max"])).sum())


def check_no_red(mat):
    n = red_pixels(mat)
    log(f"bake: {n} saturated-red pixels")
    if n > 0:
        raise SystemExit(f"{TEAM_ID}: the bake carries {n} saturated-red pixels -- scrub them (no red mark anywhere)")


def tri_count(ob):
    return sum(max(1, len(p.vertices) - 2) for p in ob.data.polygons)


def death_body(var, height, prefix, x, y):
    """The standing body laid face-down and collapsed, as ONE object for
    `{prefix}_death_root` -- `base._death_parts` with a weld first. The remesh
    arrives with a vertex per face corner (3,979 vertices on 1,849 triangles), so
    a collapse of the unwelded mesh has no edge to collapse across and tears the
    body into shards; welded, it simplifies. (UVs are per loop and survive.)"""
    ob = base._piece(var, f"{prefix}_death_body", "uniform", set(range(len(var.data.polygons))))
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    log(f"{prefix}: corpse welded {n0} -> {len(ob.data.vertices)} vertices")
    base._transform(ob, Matrix.Rotation(math.radians(90.0), 4, "Y"))
    co = base._coords(ob)
    base._transform(ob, Matrix.Translation(Vector((x - height / 2.0, y, -co[:, 2].min()))))
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = DEATH_DECIMATE
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return [ob]


def build_figure(src, mat, xc, arms0, prefix, spec):
    """One body: variant of the source, cut, kit parts, rifle, corpse, placed at
    its slot. Returns (parts, bones, forced, info)."""
    x, y = spec["slot"]
    H = spec["height"]
    T = make_variant_map(spec, xc)
    var = _variant(src, f"var_{prefix}", T)
    arms = {s: {k: T(v) for k, v in a.items()} for s, a in arms0.items()}
    parts, joints = cut_medic(var, H, prefix, mat, arms, max(1.0, spec["girth"]))
    kit_parts = body_kit(prefix, parts, H, x, y)
    bones = base.standing_bones(prefix, joints, x, y)
    forced = {}
    # the corpse, whole, from the uncut variant
    death = death_body(var, H, prefix, x, y)
    bones.append(rig._death_root_bone(prefix, x, y))
    for ob in death:
        forced[ob] = f"{prefix}_death_root"
    bpy.data.objects.remove(var, do_unlink=True)
    # the carbine at the hung hand, level, as demo_b's (kit geometry, role weapon)
    wrist = Vector(joints["arm"][1]["wrist"]) + Vector((x, y, 0.0))
    anchor_kit = Vector(rig._weapon_anchor((x, y, 0.0), 0.0, "standing", False))
    rifle = rig._weapon_parts(prefix, (x, y, 0.0), posture="standing", aim=False)
    for ob in rifle:
        base._transform(ob, Matrix.Translation(wrist + Vector((0.03, 0.0, 0.065)) - anchor_kit))
        forced[ob] = f"{prefix}_forearm_R"
    base._place(parts, x, y)
    for ob in kit_parts:
        base._transform(ob, Matrix.Translation((x, y, 0.0)))
    return list(parts.values()) + kit_parts + death + rifle, bones, forced, dict(joints=joints, parts=parts)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src, height, mat = base._load_figure(TEAM_ID)
    before, after = cut_weapon(src, mat)
    log(f"weapon cut: {before} -> {after} faces")
    arms0 = _measure_arms(src, mat, H0)
    co = base._coords(src)
    torso = co[(co[:, 2] > 0.55 * H0) & (co[:, 2] < 0.8 * H0) & (np.abs(co[:, 1]) < 0.19)]
    xc = float(torso[:, 0].mean())
    base.DEATH_DECIMATE = DEATH_DECIMATE

    parts, bones, forced = [], [], {}
    infos = {}
    for prefix, spec in FIGURES.items():
        p, b, f, info = build_figure(src, mat, xc, arms0, prefix, spec)
        parts += p
        bones += b
        forced.update(f)
        infos[prefix] = info
    bpy.data.objects.remove(src, do_unlink=True)

    # the litter and the casualty on it: one parentless bone, owned by the first man
    lit = f"med_a_litter"
    bones.append((lit, None, (0.0, 0.0, LITTER_Z), (0.0, 0.0, LITTER_Z + 0.30)))
    first = infos["med_a"]["parts"]
    refs = {"uniform": first["thigh0"], "face": first["face"], "boot": first["boot0"]}
    carried = litter_parts("med_a") + casualty_on_litter("med_a", mat, refs)
    for ob in carried:
        forced[ob] = lit
    parts += carried
    groups = {
        "living bodies": [o for o in parts if o not in forced and o not in carried and not o.name.endswith(("pack", "packflap", "bundle", "helmband"))],
        "corpses": [o for o, b in forced.items() if b.endswith("death_root")],
        "carbines": [o for o, b in forced.items() if b.endswith("forearm_R")],
        "litter": [o for o in carried if "_litter_" in o.name],
        "casualty": [o for o in carried if "_cas_" in o.name],
    }
    log("tris by group: " + ", ".join(f"{k} {sum(tri_count(o) for o in v)}" for k, v in groups.items()))

    if os.environ.get("MEDIC_DEBUG"):
        build_debug(os.environ["MEDIC_DEBUG"])
        return

    arm_obj = rig.build_armature(bones)
    prefixes = set(FIGURES)
    rig.rig_parts(parts, arm_obj, forced, prefixes)
    merged = rig.join_by_role(parts)
    for role, ob in merged.items():
        mats = [m.name for m in ob.data.materials if m is not None]
        if len(mats) > 1:
            raise SystemExit(f"{TEAM_ID}: role {role} joined with {len(mats)} materials -- a part missed its texel")
    rig.build_clips(arm_obj, TEAM_ID)
    # The litter is scale 0 in every clip this file authors; `motion/rescue.ts`
    # keys it 1 in `carry`. (rig.py's own visibility keys know no such bone.)
    pb = arm_obj.pose.bones[lit]
    arm_obj.animation_data_create()
    for action in bpy.data.actions:
        arm_obj.animation_data.action = action
        rig._key_scale(pb, 0.0, rig._VIS_FRAMES)
    stray = [o.name for o in bpy.data.objects if o is not arm_obj and o not in merged.values()]
    if stray:
        raise SystemExit(f"{TEAM_ID}: objects in the scene that are neither the rig nor a role mesh: {stray}")
    base._prepare_texture(mat)
    check_no_red(mat)
    path = os.path.join(OUT_DIR, f"{TEAM_ID}.glb")
    base.export_glb_textured(arm_obj, path)
    tris = {role: tri_count(ob) for role, ob in merged.items()}
    log(f"{TEAM_ID}: wrote {path} ({os.path.getsize(path)} bytes), roles {sorted(merged)}, "
        f"{sum(tris.values())} tris {tris}, clips {sorted(a.name for a in bpy.data.actions)}")
    os.makedirs(SRC_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SRC_DIR, f"{TEAM_ID}.blend"), compress=True)
    return path


if __name__ == "__main__":
    main()
