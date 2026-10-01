"""Build the three officer teams (GH-298) as Meshy-textured KDF figure teams
through rig.py -- `import_meshy_kdf_team.py`'s cut, driven by its own clips.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_officers.py -- officer_infantry
    ... -- officer_fires
    ... -- officer_engineer
    ... -- all

Writes `art/meshes/officer_infantry.glb`, `officer_fires.glb`,
`officer_engineer.glb` -- HELD art (`HELD_MESH_FILES`, `mesh-catalogue.ts`)
until Stage 5 wires the units; numbers and prompts in
`docs/art/meshy-prompts-officers.md`. AI-generated (Meshy), disclosed per
CONTRIBUTING.md.

SOURCES (`art/meshy/<slug>-20260930-<task>/model.glb`, Meshy text-to-3d in
`--pose a-pose`, refined with a 2k bake, REMESHED at 2,000 tris):

  officer_infantry  Maya   preview 01a0f33e-aa5b-71e4-bd3c-ee5f17fbc82e
                           refine  01a0f33f-9c56-72af-a11d-009f1def0ced
                           remesh  01a0f342-783f-748a-a4ce-88fc2d808a21   (2,041 tris)
  officer_fires     Sagi   preview 01a0f341-6d50-72a9-b8e8-747cb13c7e5a
                           refine  01a0f342-41c0-719d-ab81-af6a4e515af0
                           remesh  01a0f344-2e47-74ac-bdd3-b050b4075658   (2,075 tris)
  officer_engineer  Dalia  preview 01a0f341-6e1f-7447-afce-b8e055b07548
                           refine  01a0f342-49ef-747e-b7b2-f3b33c0a0824
                           remesh  01a0f344-2e90-70f4-b19f-05fbb19e842f   (2,071 tris)

plus, at 0 credits, the B0b remeshes already in the tree as each team's
SECOND figure: `at-team-…-01a0f2fd` (the man with the box rucksack, which
reads as a manpack radio) for the two signallers, `demo-squad-…-01a0f302`
(goggles, knee pads, tool bag) for Dalia's sapper. Two different people per
team, rather than the officer cloned, is what "reads as a distinct person at
zoom 2.5" needs.

## Two things this file adds to the B0b method

**One atlas per team.** Two Meshy figures arrive with two bakes, and a role
joined from two materials would export as two primitives, which the mesh
contract ("one mesh per role") and `import_meshy_kdf_team.py`'s own join
check refuse. So both bakes are downscaled to 1024 and laid side by side in
one 2048 x 1024 image, every part's UVs are remapped into its half
(`u' = k/2 + u/2`), and every part takes the one atlas material. The shipped
texel density per figure is B0b's (1024 a figure).

**A rigid-arm cut.** Meshy honoured the A-pose for Maya and Dalia and NOT
for Sagi, who arrived with both hands on a rifle across his chest. The B0b
arm cut (`_arm_axis`) needs a spread arm to find, so his upper body is kept
as ONE rigid torso part -- arms and the rifle included -- with the arm bones
still declared and binding nothing. He kneels (the legs are the kneel's own
re-arrangement) behind a kit designator on a tripod; a kneeling observer
holding his weapon still is a pose, not a defect, and it costs no re-roll.

**Sleeve patches are scrubbed from the bake.** All three prompts said "no
insignia, flags, patches" and Meshy painted a small badge on a sleeve of
each figure anyway. Every texel under the figure's own arm faces (the hung
arm parts; for the rigid figure, the torso faces outboard of the armpit)
that is a chroma or brightness outlier against that region's median is
replaced by the median, before the atlas is built. Logged as a count; the
2.5-zoom capture is where it is judged.

## Everything else is B0b's

The cut, the blob joints with pinned UVs, the kneel solved from the figure's
own segments, the hung arms at `ARM_HANG_DEG`, the corpse per figure, the
rigid one-part-one-bone bind, `rig.py`'s idle/move/fire and the static
`down`/`wreck`. The gait is sized from `inf_squad.json`'s
`mobility.speed_tiles_s` because an officer team has no unit JSON yet
(`docs/art/meshy-prompts-officers.md`, "Held, not wired") -- re-run this
importer if the staged JSON declares another speed.

No `mathutils.noise` anywhere in this file.
"""
import glob
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402
import rig  # noqa: E402
import import_meshy_kdf_team as kdf  # noqa: E402

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes")
MESHY = os.path.join(REPO, "art", "meshy")

#: source key -> (remesh glob, figure height in metres). The three officers'
#: heights are the numbers table's; the two B0b men are the 1.78 m rifleman.
SOURCES = {
    "officer_infantry": (os.path.join(MESHY, "officer-infantry-*-01a0f342", "model.glb"), 1.68),
    "officer_fires": (os.path.join(MESHY, "officer-fires-*-01a0f344", "model.glb"), 1.80),
    "officer_engineer": (os.path.join(MESHY, "officer-engineer-*-01a0f344", "model.glb"), 1.70),
    "at_team": (os.path.join(MESHY, "at-team-*-01a0f2fd", "model.glb"), 1.78),
    "demo_squad": (os.path.join(MESHY, "demo-squad-*-01a0f302", "model.glb"), 1.78),
}

#: The unit whose speed sizes the officers' stride until their own JSON lands.
GAIT_FROM = "inf_squad"

FIG_PX = 1024              # one figure's square in the atlas
JPEG_QUALITY = kdf.JPEG_QUALITY

WHIP_PITCH_DEG = 96.0      # from +X: vertical leaning 6 degrees back
WHIP_RADIUS = 0.012
PROBE_LEN, PROBE_PITCH_DEG, PROBE_YAW_DEG, PROBE_R = 1.30, -35.0, -35.0, 0.022
SCRUB_CHROMA, SCRUB_LUM = 0.10, 0.30


def _spec(prefix, src, x, y, posture="standing", animates=True, weapon=None, arms="hung", **extra):
    d = dict(prefix=prefix, src=src, x=x, y=y, posture=posture, animates=animates,
             weapon=weapon, arms=arms, mirror=False, headgear="helmet", loadout="regular",
             leader=False, move_posture=None)
    d.update(extra)
    return d


#: Anchors from the numbers table (`docs/art/meshy-prompts-officers.md`).
TEAMS = {
    "officer_infantry": [
        _spec("maya", "officer_infantry", 0.16, -0.36, scrub=True),
        _spec("sig", "at_team", -0.24, 0.36, weapon="rifle", whip=0.85),
    ],
    "officer_fires": [
        # The kneeler on the CAMERA side (smaller x + y; the game camera looks
        # along +X+Y) and the standing radio operator behind him to his left:
        # the first layout had Sagi at (0.26, 0.30) behind the RTO and the
        # 64 px silhouette read as one man and a tripod.
        _spec("sagi", "officer_fires", -0.10, -0.40, posture="kneeling", animates=False,
              arms="rigid", scrub=True, tripod=True),
        _spec("rto", "at_team", -0.20, 0.45, weapon="rifle", whip=0.85),
    ],
    "officer_engineer": [
        _spec("dalia", "officer_engineer", 0.28, -0.14, scrub=True, probe=True),
        _spec("sap", "demo_squad", -0.50, 0.24, weapon="rifle", whip=0.85, satchel=True),
    ],
}


def log(msg):
    print(f"[officers] {msg}")


# ---------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------

def _load_source(src_key, label):
    """`kdf._load_figure` for a scene that already holds other meshes: the
    newly imported object is found by set difference rather than by "the one
    mesh in the scene". Same turn, scale, and centring."""
    pattern, height = SOURCES[src_key]
    hits = sorted(glob.glob(pattern))
    if len(hits) != 1:
        raise SystemExit(f"{src_key}: expected exactly one source at {pattern}, found {hits}")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=hits[0])
    new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if len(new) != 1:
        raise SystemExit(f"{src_key}: expected one imported mesh object, found {[o.name for o in new]}")
    ob = new[0]
    for o in [o for o in bpy.data.objects if o not in before and o.type != "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)
    if len(ob.data.materials) != 1 or not ob.data.uv_layers:
        raise SystemExit(f"{src_key}: expected one material and a UV map on the remesh")
    mat = ob.data.materials[0]
    mat.name = f"mat_{label}"
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    co = kdf._coords(ob)
    z = co[:, 2] - co[:, 2].min()
    h_src = z.max()
    zf = z / h_src
    feet, shin = zf < 0.04, (zf > 0.15) & (zf < 0.25)
    fwd_y = co[feet, 1].mean() - co[shin, 1].mean()
    if fwd_y >= 0:
        raise SystemExit(f"{src_key}: toes point +Y, not the -Y every figure so far measured -- look before rotating")
    k = height / h_src
    rot = Matrix.Rotation(math.radians(90.0), 4, "Z")
    me = ob.data
    for v in me.vertices:
        v.co = (rot @ v.co) * k
    co = kdf._coords(ob)
    ankle = co[(co[:, 2] - co[:, 2].min()) < kdf.ANKLE_F * height]
    shift = Vector((-ankle[:, 0].mean(), -ankle[:, 1].mean(), -co[:, 2].min()))
    for v in me.vertices:
        v.co = v.co + shift
    co = kdf._coords(ob)
    feet, shin = co[:, 2] < 0.04 * height, (co[:, 2] > 0.15 * height) & (co[:, 2] < 0.25 * height)
    if co[feet, 0].mean() <= co[shin, 0].mean():
        raise SystemExit(f"{src_key}: after the turn the toes do not point +X")
    log(f"{label} <- {os.path.relpath(hits[0], REPO)}: source height {h_src:.4f} -> {height} m; "
        f"{len(me.polygons)} tris; faces +X")
    ob.name = f"figure_src_{label}"
    return ob, height, mat


# ---------------------------------------------------------------------------
# the rigid-arm cut (Sagi)
# ---------------------------------------------------------------------------

def cut_figure_rigid_arms(src, height, prefix, mat):
    """`kdf.cut_figure` without the arm split: everything between the belt
    and the neck -- arms, hands and whatever they hold -- is one `torso`
    part. Arm joints are synthesised so `standing_bones`/`_kneel` can still
    declare the arm bones (they bind nothing). Returns (parts, joints, arm_faces)
    where `arm_faces` are the torso faces outboard of the armpit, for the
    sleeve scrub."""
    co = kdf._coords(src)
    cent = kdf._face_centroids(src)
    H = height
    zc = kdf.CROTCH_F * H
    z_boot, z_knee = kdf.BOOT_TOP_F * H, kdf.KNEE_F * H
    z_belt, z_neck, z_chin = zc + 0.08, kdf.NECK_F * H, kdf.CHIN_F * H
    w_arm = kdf.ARM_ROOT_F * H
    head = co[co[:, 2] > z_chin]
    x_head = head[:, 0].mean()
    log(f"{prefix}: RIGID arms -- crotch {zc:.3f} armpit |y| {w_arm:.3f} neck {z_neck:.3f} chin {z_chin:.3f}")

    classes, arm_faces = {}, set()

    def put(i, name, role):
        classes.setdefault((name, role), set()).add(i)

    for i, (x, y, z) in enumerate(cent):
        if z > z_chin:
            if x > x_head + 0.02 and kdf.FACE_LO_F * H < z < kdf.FACE_HI_F * H and abs(y) < kdf.FACE_HALF_W:
                put(i, "face", "face")
            else:
                put(i, "cranium", "uniform")
        elif z > z_neck:
            put(i, "neck", "uniform")
        elif z > z_belt:
            put(i, "torso", "uniform")
            if abs(y) > w_arm and z > 0.72 * H:
                arm_faces.add(i)
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

    parts = {}
    torso_faces = classes[("torso", "uniform")]
    for (name, role), faces in classes.items():
        parts[name] = kdf._piece(src, f"{prefix}_{name}", role, faces)
    for need in ("face", "cranium", "neck", "torso", "hips", "thigh0", "thigh1", "calf0", "calf1", "boot0", "boot1"):
        if need not in parts:
            raise SystemExit(f"{prefix}: the cut produced no {need!r} part")
    # Face indices survive `_keep_only` in ORDER, so remap the arm faces into
    # the torso piece's own numbering for the scrub.
    order = sorted(torso_faces)
    arm_local = {n for n, i in enumerate(order) if i in arm_faces}

    joints = {"H": H, "crotch": zc, "knee": z_knee, "ankle": kdf.ANKLE_F * H, "neck": z_neck,
              "chin": z_chin, "belt": z_belt, "leg": {}, "arm": {}}
    for side in (0, 1):
        pc = kdf._coords(parts[f"calf{side}"])
        top = pc[pc[:, 2] > z_knee - 0.05]
        joints["leg"][side] = (float(top[:, 0].mean()), float(top[:, 1].mean()))
    tor = kdf._coords(parts["torso"])
    x_t = float(tor[:, 0].mean())
    for side in (0, 1):
        sgn = -1.0 if side == 0 else 1.0
        sh = (x_t, sgn * (w_arm + 0.02), 0.82 * H)
        el = (x_t, sgn * (w_arm + 0.05), 0.82 * H - 0.28)
        wr = (x_t + 0.05, sgn * (w_arm + 0.05), 0.82 * H - 0.53)
        joints["arm"][side] = {"shoulder": sh, "elbow": el, "wrist": wr}
    k = H / kit.FIGURE_H
    for side in (0, 1):
        lx, ly = joints["leg"][side]
        knee = kit.blob(f"{prefix}_knee{side}", (lx, ly, z_knee), kdf.BLOB_R["knee"] * k)
        hip = kit.blob(f"{prefix}_hip{side}", (lx, ly, zc), kdf.BLOB_R["hip"] * k, squash=(1.05, 1.05, 1.05))
        kdf._pin_uv(knee, parts[f"thigh{side}"], mat)
        kdf._pin_uv(hip, parts[f"thigh{side}"], mat)
        parts[f"knee{side}"] = knee
        parts[f"hip{side}"] = hip
    return parts, joints, (parts["torso"], arm_local)


# ---------------------------------------------------------------------------
# the sleeve scrub
# ---------------------------------------------------------------------------

def _uv_mask(px, parts_faces):
    """A (px, px) bool mask of every texel under the given (part, faces)
    UV triangles -- faces `None` meaning all of the part's faces. Blender's
    pixel row 0 is the bottom, so v maps straight to the row."""
    mask = np.zeros((px, px), dtype=bool)
    for ob, faces in parts_faces:
        uv = ob.data.uv_layers.active.data
        for poly in ob.data.polygons:
            if faces is not None and poly.index not in faces:
                continue
            pts = [uv[li].uv for li in poly.loop_indices]
            tri = [(pts[0], pts[i], pts[i + 1]) for i in range(1, len(pts) - 1)]
            for a, b, c in tri:
                xs = np.array([a.x, b.x, c.x]) * px
                ys = np.array([a.y, b.y, c.y]) * px
                x0, x1 = int(max(0, np.floor(xs.min()))), int(min(px - 1, np.ceil(xs.max())))
                y0, y1 = int(max(0, np.floor(ys.min()))), int(min(px - 1, np.ceil(ys.max())))
                if x1 < x0 or y1 < y0:
                    continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
                d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
                if abs(d) < 1e-9:
                    continue
                l1 = ((xs[1] - gx) * (ys[2] - gy) - (xs[2] - gx) * (ys[1] - gy)) / d
                l2 = ((xs[2] - gx) * (ys[0] - gy) - (xs[0] - gx) * (ys[2] - gy)) / d
                l3 = 1.0 - l1 - l2
                inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
                mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def _scrub(pix, mask, label):
    """Replace chroma/brightness outliers under `mask` with the region's
    median colour. `pix` is (h, w, 4) float, edited in place."""
    region = pix[mask][:, :3]
    if len(region) < 50:
        log(f"{label}: sleeve region too small to scrub ({len(region)} texels)")
        return 0
    med = np.median(region, axis=0)
    s = region.sum(axis=1, keepdims=True) + 1e-6
    chroma = region / s
    c_med = med / (med.sum() + 1e-6)
    d_chroma = np.abs(chroma - c_med).max(axis=1)
    lum = region.mean(axis=1)
    out = (d_chroma > SCRUB_CHROMA) | (np.abs(lum - med.mean()) > SCRUB_LUM)
    idx = np.argwhere(mask)[out]
    pix[idx[:, 0], idx[:, 1], :3] = med
    log(f"{label}: sleeve scrub -- {len(region)} texels under the arm faces, "
        f"{int(out.sum())} outliers replaced with median {tuple(round(float(c), 3) for c in med)}")
    return int(out.sum())


# ---------------------------------------------------------------------------
# figures and kit
# ---------------------------------------------------------------------------

def _build_figure(src, height, mat, spec):
    """`kdf._figure` with the rigid-arm switch. Returns (parts_list, bones,
    forced, info); info carries joints, drop, eye_z, and the cut parts by
    name (for the whip/rifle placements and the scrub)."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    forced = {}
    scrub_faces = None
    if spec["arms"] == "rigid":
        parts, joints, scrub_faces = cut_figure_rigid_arms(src, height, prefix, mat)
    else:
        parts, joints = kdf.cut_figure(src, height, prefix, mat)
        # Upper arms only: the forearm parts carry the hands, and skin is
        # exactly the outlier a sleeve scrub must not touch (the first run
        # replaced 29% of the arm texels, which was the hands).
        scrub_faces = [(parts[n], None) for n in ("upperarm0", "upperarm1")]
    info = {"joints": joints, "drop": 0.0, "eye_z": kdf.FACE_LO_F * height + 0.03,
            "scrub": scrub_faces if isinstance(scrub_faces, list) else [scrub_faces]}
    if spec["posture"] == "kneeling":
        kbones, eye_z, drop = kdf._kneel(parts, joints, prefix)
        bones = rig._translate(kbones, x, y, prefix)
        info["eye_z"], info["drop"] = eye_z, drop
    else:
        bones = kdf.standing_bones(prefix, joints, x, y)
    kdf._place(parts, x, y)
    info["parts"] = dict(parts)
    out = list(parts.values())
    death = kdf._death_parts(src, height, prefix, x, y)
    death_bone = rig._death_root_bone(prefix, x, y)
    bones.append(death_bone)
    for ob in death:
        forced[ob] = death_bone[0]
    out += death
    return out, bones, forced, info


def _whip(spec, info):
    """A whip antenna rising from the top of the figure's pack (the back of
    the torso part), bound to the spine."""
    prefix, length = spec["prefix"], spec["whip"]
    tor = kdf._coords(info["parts"]["torso"])
    back = tor[tor[:, 0] < tor[:, 0].mean() - 0.12]
    if len(back) < 10:
        raise SystemExit(f"{prefix}: no pack found behind the torso for the whip")
    base = Vector((float(back[:, 0].mean()) - 0.02, float(back[:, 1].mean()), float(back[:, 2].max()) - 0.06))
    p = math.radians(WHIP_PITCH_DEG)
    centre = base + Vector((math.cos(p), 0.0, math.sin(p))) * (length / 2.0)
    tube = kit.tube(f"{prefix}_whip", length, WHIP_RADIUS, tuple(centre), pitch=p, sides=6, role="metal")
    foot = kit.box(f"{prefix}_whip_foot", (0.06, 0.06, 0.05), tuple(base), "metal")
    log(f"{prefix}: whip {length} m from pack top {tuple(round(c, 2) for c in base)} to z {centre.z + length / 2 * math.sin(p):.2f}")
    return [tube, foot], {tube: f"{prefix}_spine", foot: f"{prefix}_spine"}


def _rifle(spec, info):
    """`demo_b`'s rule: the kit rifle, level, at the hung right hand."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    wrist = Vector(info["joints"]["arm"][1]["wrist"]) + Vector((x, y, 0.0))
    anchor_kit = Vector(rig._weapon_anchor((x, y, 0.0), 0.0, "standing", False))
    anchor_want = wrist + Vector((0.03, 0.0, 0.065))
    parts = rig._weapon_parts(prefix, (x, y, 0.0), posture="standing", aim=False)
    for ob in parts:
        kdf._transform(ob, Matrix.Translation(anchor_want - anchor_kit))
    return parts, {ob: f"{prefix}_forearm_R" for ob in parts}


def _tripod(spec, info):
    """The laser designator on a squat tripod in front of the kneeling
    observer, its head at his eye, on the team's static `prop` bone."""
    prefix = spec["prefix"]
    tx, ty = spec["x"] + 0.42, spec["y"]
    head_z = info["eye_z"] - 0.10
    parts = []
    for k in range(3):
        a = 2.0 * math.pi * k / 3.0 + math.pi / 6.0
        leg_len = head_z / math.sin(math.radians(68.0))
        cx, cy = tx + 0.5 * leg_len * math.cos(math.radians(68.0)) * math.cos(a), ty + 0.5 * leg_len * math.cos(math.radians(68.0)) * math.sin(a)
        parts.append(kit.tube(f"{prefix}_tripod_leg{k}", leg_len, 0.018, (cx, cy, head_z * 0.5),
                              yaw=a + math.pi, pitch=math.radians(68.0), sides=6, role="metal"))
    parts.append(kit.box(f"{prefix}_designator", (0.30, 0.16, 0.16), (tx, ty, head_z + 0.04), "metal"))
    parts.append(kit.tube(f"{prefix}_designator_lens", 0.20, 0.05, (tx + 0.22, ty, head_z + 0.06), sides=8, role="metal"))
    log(f"{prefix}: designator tripod at ({tx:.2f}, {ty:.2f}), head z {head_z + 0.04:.2f} (eye {info['eye_z']:.2f})")
    return parts, {ob: "prop" for ob in parts}, rig._prop_bone((tx, ty, 0.10))


def _probe(spec, info):
    """A mine probe held a third of the way down, swept ahead and down."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    wrist = Vector(info["joints"]["arm"][1]["wrist"]) + Vector((x, y, 0.0))
    p, yw = math.radians(PROBE_PITCH_DEG), math.radians(PROBE_YAW_DEG)
    # Yawed toward -Y (screen right under the game camera) as well as pitched
    # down, so the rod crosses the figure's outline as a diagonal rather than
    # hiding along the view axis; 0.015 radius read as nothing at 5x.
    d = Vector((math.cos(p) * math.cos(yw), math.cos(p) * math.sin(yw), math.sin(p)))
    hold = wrist + Vector((0.04, 0.0, -0.02))
    centre = hold + d * (PROBE_LEN * 0.15)
    tube = kit.tube(f"{prefix}_probe", PROBE_LEN, PROBE_R, tuple(centre), yaw=yw, pitch=p, sides=6, role="metal")
    tip = centre + d * (PROBE_LEN / 2.0)
    log(f"{prefix}: probe tip at ({tip.x:.2f}, {tip.y:.2f}, {tip.z:.2f})")
    return [tube], {tube: f"{prefix}_forearm_R"}


def _satchel(spec, info):
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    box = kit.box(f"{prefix}_satchel", (0.34, 0.14, 0.24), (x + 0.02, y - 0.30, 0.98), "charge")
    return [box], {box: f"{prefix}_pelvis"}


# ---------------------------------------------------------------------------
# atlas
# ---------------------------------------------------------------------------

def _base_image(mat):
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next((l for l in tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE" or link.from_node.image is None:
        raise SystemExit(f"{mat.name}: Base Color is not fed by an image texture")
    return link.from_node


def _pixels(img):
    buf = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(img.size[1], img.size[0], 4)


def build_atlas(team_id, mats, scrubs, all_parts):
    """`mats` in figure order; `scrubs` a per-material list of (part, faces)
    lists or None. Downscales each bake to FIG_PX, scrubs, lays them side by
    side, remaps every part's UVs into its own half and gives every textured
    part the ONE atlas material."""
    n = len(mats)
    atlas = np.zeros((FIG_PX, FIG_PX * n, 4), dtype=np.float32)
    nodes = []
    for k, mat in enumerate(mats):
        node = _base_image(mat)
        img = node.image
        if img.size[0] > FIG_PX or img.size[1] > FIG_PX:
            img.scale(FIG_PX, FIG_PX)
        pix = _pixels(img)
        if scrubs[k]:
            mask = _uv_mask(FIG_PX, scrubs[k])
            _scrub(pix, mask, f"{team_id} figure {k} ({mat.name})")
        atlas[:, k * FIG_PX:(k + 1) * FIG_PX] = pix
        nodes.append(node)
    scratch = bpy.data.images.new(f"{team_id}_atlas_scratch", FIG_PX * n, FIG_PX, alpha=False)
    scratch.pixels.foreach_set(atlas.ravel())
    # A GENERATED image is silently skipped by the glTF exporter (measured:
    # the first export of all three teams shipped `images: None` and every
    # capture was the palette repaint). Write it to a scratch PNG, load THAT
    # as a fresh file-backed image and pack it; the exporter then re-encodes
    # it as JPEG q85 like any other bake.
    tmp = os.path.join(tempfile.gettempdir(), f"rl_{team_id}_atlas.png")
    scratch.filepath_raw = tmp
    scratch.file_format = "PNG"
    scratch.save()
    bpy.data.images.remove(scratch)
    log(f"{team_id}: atlas scratch {tmp} exists={os.path.exists(tmp)} "
        f"bytes={os.path.getsize(tmp) if os.path.exists(tmp) else None}")
    image = bpy.data.images.load(tmp)
    image.name = f"{team_id}_atlas"
    image.pack()
    log(f"{team_id}: atlas loaded source={image.source} size={tuple(image.size)} "
        f"has_data={image.has_data} packed={image.packed_file is not None}")
    if image.packed_file is None:
        raise SystemExit(f"{team_id}: atlas image did not pack ({tmp})")

    remapped = 0
    for ob in all_parts:
        slots = [m for m in ob.data.materials if m is not None]
        if not slots:
            continue
        if len(slots) != 1 or slots[0] not in mats:
            raise SystemExit(f"{ob.name}: unexpected materials {[m.name for m in slots]}")
        k = mats.index(slots[0])
        for layer in ob.data.uv_layers:
            for loop in layer.data:
                loop.uv = (k / n + loop.uv.x / n, loop.uv.y)
        remapped += 1
    # One material for everything textured: the first figure's, its base
    # image swapped for the atlas and every other map removed.
    atlas_mat = mats[0]
    tree = atlas_mat.node_tree
    base_node = nodes[0]
    base_node.image = image
    # Compared by NAME, never by `is`: two bpy wrappers for one node are not
    # the same Python object, and an identity test here removed the base
    # node itself -- the first three exports shipped a material with no
    # texture node and `images: None`.
    for node in list(tree.nodes):
        if node.type in ("NORMAL_MAP", "SEPARATE_COLOR") or (node.type == "TEX_IMAGE" and node.name != base_node.name):
            tree.nodes.remove(node)
    if not any(nd.type == "TEX_IMAGE" and nd.image == image for nd in tree.nodes):
        raise SystemExit(f"{team_id}: the atlas material lost its texture node")
    for ob in all_parts:
        if any(m is not None for m in ob.data.materials):
            ob.data.materials.clear()
            ob.data.materials.append(atlas_mat)
    for mat in mats[1:]:
        bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        if img is not image:
            bpy.data.images.remove(img)
    log(f"{team_id}: atlas {image.size[0]}x{image.size[1]} from {n} bake(s), {remapped} parts remapped, "
        f"JPEG q{JPEG_QUALITY} on export")
    return atlas_mat


# ---------------------------------------------------------------------------
# team
# ---------------------------------------------------------------------------

def _gait(team_id):
    speed = rig.unit_speed_tiles_s(GAIT_FROM)
    ground_m = speed * rig.move_seconds() * rig.TILE_M
    gait = rig.gait_amplitudes(ground_m / rig.BASE_BOOT_TRAVEL_M, 0.0)
    gait.update(team=team_id, speed=speed, ground_m=ground_m)
    log(f"{team_id}: gait sized from {GAIT_FROM}.json's {speed} tiles/s (no officer JSON yet)")
    return gait


def build_team(team_id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    figures = TEAMS[team_id]
    parts, bones, forced = [], [], {}
    mats, scrubs, infos, srcs = [], [], {}, []
    for spec in figures:
        src, height, mat = _load_source(spec["src"], spec["prefix"])
        srcs.append(src)
        p, b, f, info = _build_figure(src, height, mat, spec)
        parts += p
        bones += b
        forced.update(f)
        infos[spec["prefix"]] = info
        mats.append(mat)
        scrubs.append(info["scrub"] if spec.get("scrub") else None)
    for src in srcs:
        bpy.data.objects.remove(src, do_unlink=True)

    has_prop = False
    for spec in figures:
        info = infos[spec["prefix"]]
        if spec.get("whip"):
            p, f = _whip(spec, info)
            parts += p
            forced.update(f)
        if spec["weapon"] == "rifle":
            p, f = _rifle(spec, info)
            parts += p
            forced.update(f)
        if spec.get("tripod"):
            p, f, bone = _tripod(spec, info)
            parts += p
            forced.update(f)
            bones.append(bone)
            has_prop = True
        if spec.get("probe"):
            p, f = _probe(spec, info)
            parts += p
            forced.update(f)
        if spec.get("satchel"):
            p, f = _satchel(spec, info)
            parts += p
            forced.update(f)

    build_atlas(team_id, mats, scrubs, parts)

    if os.environ.get("KDF_DEBUG"):
        for ob in sorted(parts, key=lambda o: o.name):
            c = kdf._coords(ob)
            log(f"  part {ob.name:24s} role {ob.get('rl_role'):8s} "
                f"x {c[:, 0].min():+.2f}..{c[:, 0].max():+.2f} y {c[:, 1].min():+.2f}..{c[:, 1].max():+.2f} "
                f"z {c[:, 2].min():+.2f}..{c[:, 2].max():+.2f} -> {forced.get(ob, '(table)')}")

    arm_obj = rig.build_armature(bones)
    prefixes = {s["prefix"] for s in figures}
    rig.rig_parts(parts, arm_obj, forced, prefixes)
    merged = rig.join_by_role(parts)
    for role, ob in merged.items():
        n_mat = len([m for m in ob.data.materials if m is not None])
        if n_mat > 1:
            raise SystemExit(f"{team_id}: role {role} joined with {n_mat} materials -- the atlas missed a part")

    rig.build_idle_clip(arm_obj, figures)
    rig.build_move_clip(arm_obj, figures, _gait(team_id))
    if any(s["weapon"] for s in figures):
        rig.build_fire_clip(arm_obj, figures)
    for clip in ("down", "wreck"):
        rig._new_action(arm_obj, clip)
        rig._key_death_visibility(arm_obj.pose.bones, figures, has_prop, alive=False)

    stray = [o.name for o in bpy.data.objects if o is not arm_obj and o not in merged.values()]
    if stray:
        raise SystemExit(f"{team_id}: objects in the scene that are neither the rig nor a role mesh: {stray}")
    path = os.path.join(OUT_DIR, f"{team_id}.glb")
    kdf.export_glb_textured(arm_obj, path)
    tris = {role: len(ob.data.polygons) for role, ob in merged.items()}
    log(f"{team_id}: wrote {path} ({os.path.getsize(path)} bytes), roles {sorted(merged)}, "
        f"{sum(tris.values())} tris {tris}, clips {[a.name for a in bpy.data.actions]}")
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = list(TEAMS) if argv in ([], ["all"]) else argv
    for name in names:
        if name not in TEAMS:
            raise SystemExit(f"unknown team {name!r}; have {sorted(TEAMS)}")
        build_team(name)


if __name__ == "__main__":
    main()
