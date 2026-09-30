"""Build a two-man crew team GLB from ONE Meshy A-pose figure, through rig.py.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_crew_team.py -- manpad_team
    ... -- recoilless_team
    ... -- all

Writes `art/meshes/<team_id>.glb` -- WP-A3.1 (GH-179) batch B2
(`docs/art/meshy-prompts-units.md` §8-9). Owner of both files in
`rig.TEAM_MESH_OWNER`, so `export_mesh_team.py -- all` skips them.

SOURCES (`art/meshy/<team>-20260930-01a0f2af/model.glb`, Meshy text-to-3d
preview in `--pose a-pose`, then REMESH at 1,500 tris; no material, no rig):

  manpad_team      preview 01a0f2ac-f4e5-7632-8b48-d8813d50890c,
                   remesh  01a0f2af-b00a-715f-9b29-424e409d471a
  recoilless_team  preview 01a0f2ac-f5b1-7146-b3e3-73be95e86ff2,
                   remesh  01a0f2af-b122-75c8-bbe1-9c9da39e1aa2

AI-generated (Meshy), disclosed per CONTRIBUTING.md.

## Why this path and not `import_meshy_soldier.py`'s

The shipped Meshy infantry (`meshy_soldier`, `sarim_rifles`, `rpg_team`) were
SUPPLIED as rigged bipeds with clips, and their importers retarget those. B2's
figures come from `pnpm meshy`, which has no `rig` command, and a headless
session cannot drive the Meshy web UI; the bible's step 5 (a bought humanoid
rig) is therefore not taken. Instead the remeshed figure goes through
`tools/units/rig.py` exactly as a `kit.py` figure does: it is CUT into rigid
parts at rig.py's own joints, each part is named `{prefix}_{suffix}` with a
suffix from `PART_BONE`, `rig.rig_parts` binds one part to one bone, and every
clip is rig.py's own keyframe table (`build_idle_clip`, `build_move_clip`,
`build_fire_clip`, `build_death_clip`). No hand-posing, no weight painting;
where a rigid cut opens a seam, a `kit.blob` joint hides it -- kit's own
mechanism, in the same palette roles, so it is invisible on a palette-painted
figure.

## The cut, measured on each remesh rather than assumed

The A-pose figure faces -Y in the source (probed: the toes' centroid sits
forward of the shins' along -Y; confirmed by an ortho render with a marker
cube), so it takes one +90 degree Z rotation to face +X. Heights are
fractions of the figure's own height `H` (anthropometric, not `kit.py`'s
stylised 1.8 m proportions): ankle 0.045, boot top 0.09, knee 0.285, crotch
found by scanning for the band where the two legs merge (fallback 0.47),
belt = crotch + 0.08, neck base 0.83, chin 0.87. A crotch SCAN (the band
where the two legs' face centroids separate) was tried and swung between
0.44 and 0.52 H on a 1,500-tri shell, so the cut uses the fraction and the
scan is only logged beside it. The arm root is the torso half-width at the
armpit, 0.105 H -- both B2 figures measured 0.20 of 1.90 source units -- and
the shoulder is the centroid of the arm-root ring above the hip pouches; the
elbow sits 0.42 of the way from that ring to the fingertips.

The A-pose arms (30-47 degrees from vertical, measured) are hung at
`ARM_HANG_DEG` from vertical by one rigid rotation of each arm about its own
shoulder ring -- rest geometry, like kit's contrapposto, not a pose -- and a
deltoid blob covers the wedge. The kneeling figure is the same parts
re-arranged rigidly onto a kneel: torso, head and arms drop, the rear thigh
angles back to put its knee on the ground, the rear shin lies along the ground
with the boot plantar-flexed behind it, the front thigh rises to a knee the
front shin drops vertically from, so the front boot's sole lands on z = 0.
Every angle is solved from the figure's own segment lengths; see `_kneel`.

## Roles

`boot` below the boot top; `face` the forward strip of the head between 0.88
and 0.955 H; `keffiyeh` the rest of the head and the neck (both figures wrap a
scarf there -- the recoilless man is fully hooded, the MANPAD man's preview
ignored the head wrap and came bare-headed, so he ALSO gets `kit.keffiyeh`
geometry over the crown, the same fix the bible allows for a preview that
missed a slot); `uniform` everything else; `weapon`/`metal` the kit parts.
No `webbing`: a chest rig on a bakeless remesh cannot be told from the shirt
by geometry, and a wrong band reads as a wrong army.

## What each team carries, verbatim from `tools/units/teams.py`

  manpad_team      mpd_fire standing at (0.16, -0.22) with `kit.launcher` at
                   z 1.30, pitch 78 deg, length 0.94, radius 0.065, on his
                   forearm_R; mpd_spot kneeling at (-0.28, 0.30) with
                   `kit.binoculars` on his head.
  recoilless_team  rcl_fire kneeling at (0.20, -0.28), `kit.launcher` LOW at
                   z 0.72, pitch 0, length 0.86, radius 0.115, on forearm_R;
                   rcl_load kneeling at (-0.30, 0.30); two spare rounds
                   (`kit.tube` 0.52 x 0.075) on the ground on a `prop` bone.

Both kneeling figures walk on a standing walker for `move` (design D6,
`rig._walker_specs`), and every figure carries a prone corpse for
`down`/`wreck` -- the standing parts laid face-down and decimated to half,
rigidly on `{prefix}_death_root` (`rig._figure_death_parts`'s convention,
with the man's own body instead of kit primitives).

After this: `pnpm gait:meshes -- --id=<team>`, `pnpm validate:meshes`,
`pnpm encode:meshes`.
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

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes")

#: team -> (Meshy remesh folder glob, figure height in metres -- the numbers
#: table's 1.74 / 1.72, bible §5 worked examples 2 and 3).
SOURCES = {
    "manpad_team": (os.path.join(REPO, "art", "meshy", "manpad-team-*-01a0f2af", "model.glb"), 1.74),
    "recoilless_team": (os.path.join(REPO, "art", "meshy", "recoilless-team-*-01a0f2af", "model.glb"), 1.72),
}

#: Whether the figure needs kit's keffiyeh over the crown (see module docstring).
ADD_KEFFIYEH = {"manpad_team": True, "recoilless_team": False}

# --- height fractions of the figure's own H --------------------------------
ANKLE_F, BOOT_TOP_F, KNEE_F, CROTCH_FALLBACK_F = 0.045, 0.09, 0.285, 0.47
NECK_F, CHIN_F, FACE_LO_F, FACE_HI_F = 0.83, 0.87, 0.88, 0.955
FACE_HALF_W = 0.07
ARM_ROOT_FALLBACK_F = 0.105    # torso half-width at the armpit: both B2 figures measure 0.20/1.90 src
R_ARM_F = 0.05                 # an arm's reach from its own axis, incl. the hand (0.087 m at 1.74)
#: Joint-blob radii: kit.py's own limb radii (for its 1.8 m figure), scaled
#: by height -- measured cross-sections on a 1,500-tri shell are too noisy
#: (a first pass read the chest rig as the upper arm and drew 0.2 m spheres).
BLOB_R = {"deltoid": kit.R_UPPERARM * 1.35, "elbow": kit.R_FOREARM * 1.25,
          "knee": kit.R_KNEE * 1.2, "hip": kit.R_THIGH * 1.1}
ELBOW_FRAC = 0.42              # shoulder ring -> fingertips
WRIST_FRAC = 0.82
ARM_HANG_DEG = 10.0            # from vertical, outward, once hung
REAR_THIGH_DEG = 25.0          # kneel: rear thigh back from vertical
REAR_BOOT_FLEX_DEG = 80.0      # kneel: rear boot plantar-flexed behind the shin
DEATH_DECIMATE = 0.5


def log(msg):
    print(f"[crew] {msg}")


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------

def _src(team_id):
    pattern, _h = SOURCES[team_id]
    hits = sorted(glob.glob(pattern))
    if len(hits) != 1:
        raise SystemExit(f"{team_id}: expected exactly one source at {pattern}, found {hits}")
    return hits[0]


def _load_figure(team_id):
    """The remesh as one mesh object: world transform applied, materials
    stripped, rotated to face +X, scaled to its target height, feet on z=0,
    ankles centred on the origin."""
    _pattern, height = SOURCES[team_id]
    bpy.ops.import_scene.gltf(filepath=_src(team_id))
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "rig"]
    if len(meshes) != 1:
        raise SystemExit(f"{team_id}: expected one mesh object, found {[o.name for o in meshes]}")
    ob = meshes[0]
    ob.data.materials.clear()
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    co = _coords(ob)
    z = co[:, 2] - co[:, 2].min()
    h_src = z.max()
    zf = z / h_src
    feet, shin = zf < 0.04, (zf > 0.15) & (zf < 0.25)
    fwd_y = co[feet, 1].mean() - co[shin, 1].mean()
    if fwd_y >= 0:
        raise SystemExit(f"{team_id}: toes point +Y, not the -Y every B2 figure measured -- look before rotating")
    # -Y forward -> +X forward is +90 about Z; scale; feet to z=0; ankles to origin.
    k = height / h_src
    rot = Matrix.Rotation(math.radians(90.0), 4, "Z")
    me = ob.data
    for v in me.vertices:
        v.co = rot @ v.co
    for v in me.vertices:
        v.co = v.co * k
    co = _coords(ob)
    ankle = co[(co[:, 2] - co[:, 2].min()) < ANKLE_F * height]
    shift = Vector((-ankle[:, 0].mean(), -ankle[:, 1].mean(), -co[:, 2].min()))
    for v in me.vertices:
        v.co = v.co + shift
    co = _coords(ob)
    feet, shin = co[:, 2] < 0.04 * height, (co[:, 2] > 0.15 * height) & (co[:, 2] < 0.25 * height)
    if co[feet, 0].mean() <= co[shin, 0].mean():
        raise SystemExit(f"{team_id}: after the turn the toes do not point +X")
    log(f"{team_id}: source height {h_src:.4f} -> {height} m; {len(me.polygons)} tris; faces +X")
    ob.name = "figure_src"
    return ob, height


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def _face_centroids(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float64)
    bm.free()
    return cent


def _find_crotch(cent, height):
    """The top of the first band (scanning down from the belt) in which the
    left-of-midline and right-of-midline face centroids are separated by a
    real gap -- two legs rather than one body. Face centroids rather than
    vertices because a 1,500-tri remesh leaves 2 cm bands with no vertex at
    all on a belly. Clamped to the anthropometric window either way."""
    z = cent[:, 2]
    band_h = 0.02 * height
    for lo in np.arange(0.58, 0.36, -0.02):
        band = (z >= lo * height) & (z < lo * height + band_h)
        ys = cent[band, 1]
        pos, neg = ys[ys > 0], ys[ys < 0]
        if len(pos) == 0 or len(neg) == 0:
            continue
        if pos.min() - neg.max() > 0.04 * height:
            return float(min(max(lo * height + band_h, 0.44 * height), 0.52 * height))
    return CROTCH_FALLBACK_F * height


def _arm_axis(co, height, side):
    """The spread arm's own axis, fitted to the points that can only be arm
    (the outer 60% of its reach), so hip pouches at |y| ~ 0.14 H cannot
    pull it. Returns (shoulder, tip, unit axis shoulder->tip)."""
    sgn = -1.0 if side == 0 else 1.0
    y = co[:, 1] * sgn
    w_arm = ARM_ROOT_FALLBACK_F * height
    # Two direct centroids, no extrapolation: a PCA line through the outer
    # arm tilts toward +x because the hands point forward in an A-pose, and
    # extrapolating it back to the torso put the first shoulder 0.45 m
    # behind the man. The root ring sits above the hip pouches (z > 0.62 H);
    # the tip band is the outermost 5 cm.
    ring = co[(y > w_arm) & (y < w_arm + 0.05) & (co[:, 2] > 0.62 * height)]
    outer = co[(y > 0.22 * height) & (co[:, 2] > 0.5 * height)]
    if len(ring) < 8 or len(outer) < 20:
        raise SystemExit(f"arm{side}: ring {len(ring)} / outer {len(outer)} points -- not an A-pose figure?")
    tipband = outer[outer[:, 1] * sgn > (outer[:, 1] * sgn).max() - 0.05]
    shoulder = Vector(ring.mean(axis=0))
    tip = Vector(tipband.mean(axis=0))
    axis = (tip - shoulder).normalized()
    return shoulder, tip, axis, w_arm


def _keep_only(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _piece(src, name, role, faces):
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    bpy.context.view_layer.objects.active = src
    bpy.ops.object.duplicate()
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    _keep_only(ob, faces)
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob["rl_role"] = role
    return ob


def _transform(ob, mat):
    for v in ob.data.vertices:
        v.co = mat @ v.co


def _rot_about(point, axis, deg):
    p = Vector(point)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p)


def _radius_near(co, point, band=0.03):
    """Mean radial distance from `point` (in the horizontal plane) of the
    vertices within `band` of its height -- a limb's local radius."""
    z = co[:, 2]
    sel = np.abs(z - point[2]) < band
    if not sel.any():
        return 0.05
    d = np.hypot(co[sel, 0] - point[0], co[sel, 1] - point[1])
    return float(np.median(d))


# ---------------------------------------------------------------------------
# one figure: cut, hang the arms, measure the joints
# ---------------------------------------------------------------------------

def cut_figure(src, height, prefix):
    """Cut the standing source into rig.py parts at the origin. Returns
    (parts, joints) where joints is a dict of the measured points every later
    step (bones, kneel, corpse) reads."""
    co = _coords(src)
    cent = _face_centroids(src)
    H = height
    # Measured crotch heights on the two B2 remeshes swung between the clamps
    # (0.44 H and 0.52 H) on a 1,500-tri shell, so the cut uses the
    # anthropometric fraction and the scan is only reported beside it.
    zc = CROTCH_FALLBACK_F * H
    log(f"{prefix}: crotch scan read {_find_crotch(cent, H) / H:.3f} H; cutting at {CROTCH_FALLBACK_F} H")
    z_ankle, z_boot, z_knee = ANKLE_F * H, BOOT_TOP_F * H, KNEE_F * H
    z_belt, z_neck, z_chin = zc + 0.08, NECK_F * H, CHIN_F * H
    head = co[co[:, 2] > z_chin]
    x_head = head[:, 0].mean()
    axes = {side: _arm_axis(co, H, side) for side in (0, 1)}
    w_arm = axes[0][3]
    log(f"{prefix}: crotch {zc:.3f} ({zc / H:.3f} H) arm-root |y| {w_arm:.3f} knee {z_knee:.3f} "
        f"neck {z_neck:.3f} chin {z_chin:.3f}")

    def arm_side(p):
        """0/1 if `p` lies within R_ARM of that arm's axis, outboard of the
        torso; else None. The pouches at the waist are outboard too but far
        below the line."""
        for side in (0, 1):
            shoulder, _tip, axis, _w = axes[side]
            if abs(p[1]) <= w_arm or p[2] < 0.5 * H:
                continue
            d = Vector(p) - shoulder
            along = d.dot(axis)
            if along < -0.05:
                continue
            if (d - axis * along).length < R_ARM_F * H:
                return side
        return None

    classes = {}

    def put(i, name, role):
        classes.setdefault((name, role), set()).add(i)

    for i, (x, y, z) in enumerate(cent):
        side = arm_side((x, y, z))
        if side is not None:
            put(i, f"arm{side}", "uniform")
        elif z > z_chin:
            # A centred strip, |y| < FACE_HALF_W: the hooded figure's head
            # wraps to one side and an off-centre face strip read 30 degrees
            # off the way the man travels (mesh_gait.test.ts's facing sweep).
            if x > x_head + 0.02 and FACE_LO_F * H < z < FACE_HI_F * H and abs(y) < FACE_HALF_W:
                put(i, "face", "face")
            else:
                put(i, "cranium", "keffiyeh")
        elif z > z_neck:
            put(i, "neck", "keffiyeh")
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

    parts = {}
    for (name, role), faces in classes.items():
        parts[name] = _piece(src, f"{prefix}_{name}", role, faces)

    joints = {"H": H, "crotch": zc, "knee": z_knee, "ankle": z_ankle, "neck": z_neck, "chin": z_chin,
              "belt": z_belt, "leg": {}, "arm": {}}
    # Legs: the knee band's centroid per side is where the thigh and shin bones meet.
    for side in (0, 1):
        pc = _coords(parts[f"calf{side}"])
        top = pc[pc[:, 2] > z_knee - 0.05]
        joints["leg"][side] = (float(top[:, 0].mean()), float(top[:, 1].mean()))

    # Arms: split each into upper and fore about the elbow, then hang it.
    for side in (0, 1):
        arm = parts.pop(f"arm{side}")
        shoulder, tip, axis, _w = axes[side]
        length = (tip - shoulder).length
        elbow = shoulder + axis * (length * ELBOW_FRAC)
        wrist = shoulder + axis * (length * WRIST_FRAC)
        acent = _face_centroids(arm)
        along = (acent - np.array(shoulder)) @ np.array(axis)
        upper_faces = {i for i, t in enumerate(along) if t < length * ELBOW_FRAC}
        fore_faces = set(range(len(acent))) - upper_faces
        upper = _piece(arm, f"{prefix}_upperarm{side}", "uniform", upper_faces)
        fore = _piece(arm, f"{prefix}_forearm{side}", "uniform", fore_faces)
        bpy.data.objects.remove(arm, do_unlink=True)
        # Hang: rotate about the shoulder so the axis reads ARM_HANG_DEG from
        # vertical, outward, in the y-z plane.
        sgn = -1.0 if side == 0 else 1.0
        target = Vector((0.0, sgn * math.sin(math.radians(ARM_HANG_DEG)), -math.cos(math.radians(ARM_HANG_DEG))))
        q = axis.rotation_difference(target)
        mat = Matrix.Translation(shoulder) @ q.to_matrix().to_4x4() @ Matrix.Translation(-shoulder)
        _transform(upper, mat)
        _transform(fore, mat)
        elbow_h, wrist_h = mat @ elbow, mat @ wrist
        k = H / kit.FIGURE_H
        parts[f"upperarm{side}"] = upper
        parts[f"forearm{side}"] = fore
        parts[f"deltoid{side}"] = kit.blob(f"{prefix}_deltoid{side}", tuple(shoulder), BLOB_R["deltoid"] * k,
                                           squash=(1.0, 1.0, 0.9))
        parts[f"elbow{side}"] = kit.blob(f"{prefix}_elbow{side}", tuple(elbow_h), BLOB_R["elbow"] * k)
        joints["arm"][side] = {"shoulder": tuple(shoulder), "elbow": tuple(elbow_h), "wrist": tuple(wrist_h)}
        log(f"{prefix}: arm{side} A-pose {math.degrees(math.acos(abs(axis.z))):.1f} deg from vertical, "
            f"hung to {ARM_HANG_DEG}; shoulder z {shoulder.z:.3f} elbow z {elbow_h.z:.3f}")

    # Knee and hip blobs, kit's own radii scaled to this figure.
    k = H / kit.FIGURE_H
    for side in (0, 1):
        lx, ly = joints["leg"][side]
        parts[f"knee{side}"] = kit.blob(f"{prefix}_knee{side}", (lx, ly, z_knee), BLOB_R["knee"] * k)
        parts[f"hip{side}"] = kit.blob(f"{prefix}_hip{side}", (lx, ly, zc), BLOB_R["hip"] * k,
                                       squash=(1.05, 1.05, 1.05))
    return parts, joints


def _rename(parts, prefix, mapping):
    for old, new in mapping.items():
        if old in parts:
            ob = parts.pop(old)
            ob.name = f"{prefix}_{new}"
            ob.data.name = ob.name
            parts[new] = ob


def _move_all(parts, names, mat):
    for n in names:
        if n in parts:
            _transform(parts[n], mat)


def standing_bones(prefix, joints, dx, dy):
    """rig.py's `_BASE_BONES` shape with THIS figure's measured joints."""
    H, zc, zk, za, zn, zh = (joints[k] for k in ("H", "crotch", "knee", "ankle", "neck", "chin"))
    sh0 = joints["arm"][0]["shoulder"]
    z_sh = max(joints["arm"][s]["shoulder"][2] for s in (0, 1))
    table = [
        ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        ("pelvis", "root", (0.0, 0.0, zc - 0.05), (0.0, 0.0, joints["belt"])),
        ("spine", "pelvis", (0.0, 0.0, joints["belt"]), (0.0, 0.0, z_sh - 0.02)),
        ("neck", "spine", (0.0, 0.0, zn), (0.0, 0.0, zh)),
        ("head", "neck", (0.0, 0.0, zh), (0.0, 0.0, H)),
    ]
    for side, name in ((0, "L"), (1, "R")):
        a = joints["arm"][side]
        table.append((f"upperarm_{name}", "spine", a["shoulder"], a["elbow"]))
        table.append((f"forearm_{name}", f"upperarm_{name}", a["elbow"], a["wrist"]))
    for side, name in ((0, "L"), (1, "R")):
        lx, ly = joints["leg"][side]
        table.append((f"thigh_{name}", "pelvis", (lx, ly, zc), (lx, ly, zk)))
        table.append((f"shin_{name}", f"thigh_{name}", (lx, ly, zk), (lx, ly, za)))
    out = rig._translate(table, dx, dy, prefix)
    for side, name in ((0, "L"), (1, "R")):
        lx, ly = joints["leg"][side]
        out.append((f"{prefix}_hip_{name}", f"{prefix}_pelvis",
                    (lx + dx, ly + dy, zc), (lx + dx, ly + dy, zc - 0.15 * (zc - zk))))
    return out


def _kneel(parts, joints, prefix):
    """Re-arrange standing parts (at the origin) into a kneel, rigidly, and
    return the kneel bone table (untranslated). Side 0 (-y) is the rear leg
    with its knee on the ground; side 1 (+y) the planted front leg."""
    H, zc, zk, za = (joints[k] for k in ("H", "crotch", "knee", "ankle"))
    L_thigh, L_shin = zc - zk, zk - za
    rear = math.radians(REAR_THIGH_DEG)
    r_knee = 0.06
    z_hip = r_knee + L_thigh * math.cos(rear)
    drop = zc - z_hip
    # Front thigh angle that lands the front sole exactly on the ground.
    s = (zk - z_hip) / L_thigh
    front = math.asin(max(-1.0, min(1.0, s)))
    log(f"{prefix}: kneel hip z {z_hip:.3f} (drop {drop:.3f}), rear thigh {REAR_THIGH_DEG} deg back, "
        f"front thigh {math.degrees(front):.1f} deg up")

    legs = {"thigh0", "thigh1", "calf0", "calf1", "boot0", "boot1", "knee0", "knee1", "hip0", "hip1"}
    _move_all(parts, [n for n in parts if n not in legs], Matrix.Translation((0.0, 0.0, -drop)))

    # Rear leg (side 0): thigh back about the hip, shin flat behind the knee,
    # boot flexed behind the shin.
    lx0, ly0 = joints["leg"][0]
    hip0 = Vector((lx0, ly0, zc))
    # R_y(t) takes the thigh's own down vector (0, 0, -1) to (-sin t, 0, -cos t):
    # a POSITIVE angle about +Y tips it backward, toward -x.
    m_thigh0 = Matrix.Translation((0, 0, -drop)) @ _rot_about(hip0, "Y", REAR_THIGH_DEG)
    knee0 = m_thigh0 @ Vector((lx0, ly0, zk))
    m_shin0 = _rot_about(knee0, "Y", 90.0) @ m_thigh0
    ankle0 = m_shin0 @ Vector((lx0, ly0, za))
    m_boot0 = _rot_about(ankle0, "Y", REAR_BOOT_FLEX_DEG) @ m_shin0
    _transform(parts["thigh0"], m_thigh0)
    _transform(parts["hip0"], m_thigh0)
    _transform(parts["knee0"], m_thigh0)
    _transform(parts["calf0"], m_shin0)
    _transform(parts["boot0"], m_boot0)
    # Front leg (side 1): thigh up about the hip, shin vertical below the knee.
    lx1, ly1 = joints["leg"][1]
    hip1 = Vector((lx1, ly1, zc))
    # Forward and up by `front`: (0, 0, -1) -> (cos f, 0, sin f) is R_y(-(90 + f)).
    m_thigh1 = Matrix.Translation((0, 0, -drop)) @ _rot_about(hip1, "Y", -(90.0 + math.degrees(front)))
    knee1 = m_thigh1 @ Vector((lx1, ly1, zk))
    m_shin1 = Matrix.Translation(knee1 - Vector((lx1, ly1, zk)))
    _transform(parts["thigh1"], m_thigh1)
    _transform(parts["hip1"], m_thigh1)
    _transform(parts["knee1"], m_thigh1)
    _transform(parts["calf1"], m_shin1)
    _transform(parts["boot1"], m_shin1)
    ankle1 = m_shin1 @ Vector((lx1, ly1, za))
    # Blobs over the wedges the two thigh rotations opened at the hips.
    kneek = parts["knee1"]
    _rename(parts, prefix, {"thigh0": "thigh_r", "calf0": "shin_r", "boot0": "boot_r",
                            "thigh1": "thigh_f", "calf1": "shin_f", "boot1": "boot_f",
                            "knee1": "knee_f", "knee0": "kneek_r", "hip0": "hipk_r", "hip1": "hipk_f"})
    del kneek
    hip0k = m_thigh0 @ hip0
    hip1k = m_thigh1 @ hip1
    bones = [
        ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        ("pelvis", "root", (0.0, 0.0, zc - 0.05 - drop), (0.0, 0.0, joints["belt"] - drop)),
        ("spine", "pelvis", (0.0, 0.0, joints["belt"] - drop),
         (0.0, 0.0, max(joints["arm"][s]["shoulder"][2] for s in (0, 1)) - drop - 0.02)),
        ("neck", "spine", (0.0, 0.0, joints["neck"] - drop), (0.0, 0.0, joints["chin"] - drop)),
        ("head", "neck", (0.0, 0.0, joints["chin"] - drop), (0.0, 0.0, H - drop)),
    ]
    for side, name in ((0, "L"), (1, "R")):
        a = joints["arm"][side]
        sh = (a["shoulder"][0], a["shoulder"][1], a["shoulder"][2] - drop)
        el = (a["elbow"][0], a["elbow"][1], a["elbow"][2] - drop)
        wr = (a["wrist"][0], a["wrist"][1], a["wrist"][2] - drop)
        bones.append((f"upperarm_{name}", "spine", sh, el))
        bones.append((f"forearm_{name}", f"upperarm_{name}", el, wr))
    bones.append(("thigh_r", "pelvis", tuple(hip0k), tuple(knee0)))
    bones.append(("shin_r", "thigh_r", tuple(knee0), tuple(ankle0)))
    bones.append(("thigh_f", "pelvis", tuple(hip1k), tuple(knee1)))
    bones.append(("shin_f", "thigh_f", tuple(knee1), tuple(ankle1)))
    eye_z = FACE_LO_F * H + 0.03 - drop
    return bones, eye_z


def _death_parts(src, height, prefix, x, y):
    """The whole standing source laid face-down, decimated, as ONE assembly
    named for `{prefix}_death_root`."""
    ob = _piece(src, f"{prefix}_death_body", "uniform", set(range(len(src.data.polygons))))
    # +90 about Y: height -> +x (head forward), forward -> -z (face down).
    _transform(ob, Matrix.Rotation(math.radians(90.0), 4, "Y"))
    co = _coords(ob)
    shift = Vector((x - height / 2.0, y, -co[:, 2].min()))
    _transform(ob, Matrix.Translation(shift))
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = DEATH_DECIMATE
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return [ob]


def _place(parts, dx, dy):
    for ob in parts.values():
        _transform(ob, Matrix.Translation((dx, dy, 0.0)))


# ---------------------------------------------------------------------------
# teams
# ---------------------------------------------------------------------------

def _figure(src, height, spec, kneel):
    """Parts + bones + forced binds for one TEAM_FIGURES spec, placed at its
    anchor. `kneel` builds the deployed kneel AND (per design D6) a standing
    walker with the `{prefix}w` prefix."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    forced = {}
    if not kneel:
        parts, joints = cut_figure(src, height, prefix)
        bones = standing_bones(prefix, joints, x, y)
        _place(parts, x, y)
        eye_z = FACE_LO_F * height + 0.03
    else:
        parts, joints = cut_figure(src, height, prefix)
        kbones, eye_z = _kneel(parts, joints, prefix)
        bones = rig._translate(kbones, x, y, prefix)
        _place(parts, x, y)
        wp = rig._walker_prefix(spec)
        wparts, wjoints = cut_figure(src, height, wp)
        bones += standing_bones(wp, wjoints, x, y)
        _place(wparts, x, y)
        parts.update({f"w_{k}": v for k, v in wparts.items()})
    out = list(parts.values())
    death = _death_parts(src, height, prefix, x, y)
    death_bone = rig._death_root_bone(prefix, x, y)
    bones.append(death_bone)
    for ob in death:
        forced[ob] = death_bone[0]
    out += death
    return out, bones, forced, eye_z, joints


def build_team(team_id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src, height = _load_figure(team_id)
    figures = rig.TEAM_FIGURES[team_id]
    parts, bones, forced = [], [], {}
    eyes = {}
    for spec in figures:
        p, b, f, eye_z, _j = _figure(src, height, spec, kneel=(spec["posture"] == "kneeling"))
        parts += p
        bones += b
        forced.update(f)
        eyes[spec["prefix"]] = eye_z
    if ADD_KEFFIYEH[team_id]:
        # Crown over every head this team draws (deployed, walker): the head
        # part's own bounding centre says where; kit sizes the drape.
        for ob in list(parts):
            if ob.name.endswith("_cranium"):
                pfx = ob.name[: -len("_cranium")]
                co = _coords(ob)
                centre = ((co[:, 0].min() + co[:, 0].max()) / 2.0, (co[:, 1].min() + co[:, 1].max()) / 2.0,
                          co[:, 2].min() + 0.55 * (co[:, 2].max() - co[:, 2].min()))
                radius = max(co[:, 0].max() - co[:, 0].min(), co[:, 1].max() - co[:, 1].min()) / 2.0 * 1.04
                parts += kit.keffiyeh(f"{pfx}_kef", centre, radius=radius)
    bpy.data.objects.remove(src, do_unlink=True)

    # Crew weapons -- kit geometry, verbatim positions from teams.py.
    if team_id == "manpad_team":
        tube = kit.launcher("mpd_tube", (0.16, -0.22, 1.30), pitch=math.radians(78.0), length=0.94, radius=0.065)
        binos = kit.binoculars("mpd_binos", (-0.28, 0.30, eyes["mpd_spot"] - kit.POSTURE_EYE["standing"] * kit.FIGURE_H - 0.04),
                               posture="standing")
        forced.update({ob: "mpd_fire_forearm_R" for ob in tube})
        forced.update({ob: "mpd_spot_head" for ob in binos})
        parts += tube + binos
    elif team_id == "recoilless_team":
        tube = kit.launcher("rcl_tube", (0.20, -0.28, 0.72), pitch=0.0, length=0.86, radius=0.115)
        rounds = [
            kit.tube("rcl_round0", 0.52, 0.075, (-0.10, 0.46, 0.075), yaw=math.radians(90.0)),
            kit.tube("rcl_round1", 0.52, 0.075, (-0.10, 0.60, 0.075), yaw=math.radians(90.0)),
        ]
        bones.append(rig._prop_bone((-0.10, 0.53, 0.0), 0.30))
        forced.update({ob: "rcl_fire_forearm_R" for ob in tube})
        forced.update({ob: "prop" for ob in rounds})
        parts += tube + rounds
    else:
        raise SystemExit(f"no crew weapon rule for {team_id}")

    want = {f"{s['prefix']}_forearm_R" for s in figures if s["weapon"] == "launcher"}
    if want - set(forced.values()):
        raise SystemExit(f"{team_id}: launcher declared but not bound: {want - set(forced.values())}")

    if os.environ.get("CREW_DEBUG"):
        for ob in sorted(parts, key=lambda o: o.name):
            c = _coords(ob)
            log(f"  part {ob.name:28s} role {ob.get('rl_role'):9s} x {c[:, 0].min():+.2f}..{c[:, 0].max():+.2f} "
                f"y {c[:, 1].min():+.2f}..{c[:, 1].max():+.2f} z {c[:, 2].min():+.2f}..{c[:, 2].max():+.2f} "
                f"-> {forced.get(ob, '(table)')}")
    arm_obj = rig.build_armature(bones)
    prefixes = {s["prefix"] for s in figures} | {s["prefix"] for s in rig._walker_specs(figures)}
    rig.rig_parts(parts, arm_obj, forced, prefixes)
    merged = rig.join_by_role(parts)
    rig.build_clips(arm_obj, team_id)
    path = os.path.join(OUT_DIR, f"{team_id}.glb")
    rig.export_glb(arm_obj, path)
    tris = sum(len(ob.data.polygons) for ob in merged.values())
    log(f"{team_id}: wrote {path} ({os.path.getsize(path)} bytes), roles {sorted(merged)}, {tris} tris, "
        f"clips {[a.name for a in bpy.data.actions]}")
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = list(SOURCES) if argv in ([], ["all"]) else argv
    for name in names:
        if name not in SOURCES:
            raise SystemExit(f"unknown team {name!r}; have {sorted(SOURCES)}")
        build_team(name)


if __name__ == "__main__":
    main()
