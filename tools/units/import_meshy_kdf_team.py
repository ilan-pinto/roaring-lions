"""Build a two-man KDF team GLB from ONE Meshy A-pose figure WITH ITS BAKE,
through rig.py.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_kdf_team.py -- at_team
    ... -- demo_squad
    ... -- all

Writes `art/meshes/at_team.glb` and `art/meshes/demo_squad.glb` -- GH-286
batch B0b (`docs/art/meshy-prompts-units.md` sections 3-4, style bible
sections 4-7). Owner of both files in `rig.TEAM_MESH_OWNER`, so
`export_mesh_team.py -- all` skips them.

SOURCES (`art/meshy/<team>-20260930-<task>/model.glb`: Meshy text-to-3d
preview in `--pose a-pose`, refined with a 2k bake, then REMESHED at 2,000
tris -- the remesh keeps the refine's bake, measured on both figures):

  at_team     preview 01a0f2fa-3d74-7553-8559-fc36a338cd92
              refine  01a0f2fb-2e11-70ac-8034-d21b9b58d534
              remesh  01a0f2fd-1f66-779a-9a23-370974ee442a   (2,051 tris)
  demo_squad  preview 01a0f2fb-6ba7-7245-9bd0-22edca38a2a6
              refine  01a0f2fc-8731-76a4-af00-4d4805d08fb1
              remesh  01a0f302-184a-701e-a5c6-daa76f54f83f   (2,061 tris)

AI-generated (Meshy), disclosed per CONTRIBUTING.md.

## The path: cut into rig.py's parts, rigid-bound, rig.py's own clips

The shipped Meshy infantry (`meshy_soldier`, `sarim_rifles`, `rpg_team`)
were SUPPLIED as rigged bipeds with clips and their importers retarget those.
These two figures come from `pnpm meshy`, which has no `rig` command, and a
headless session cannot drive the Meshy web UI; the bible's step 5 (a bought
humanoid rig, 5 credits) is therefore NOT taken and not needed: the remesh
goes through `tools/units/rig.py` exactly as a `kit.py` figure does. It is
CUT into rigid parts at rig.py's own joints, each part is named
`{prefix}_{suffix}` with a suffix from `PART_BONE`, `rig.rig_parts` binds one
part to one bone, and every clip is rig.py's own keyframe table
(`build_idle_clip`, `build_move_clip`, `build_fire_clip`, `build_death_clip`).
No hand-posing, no weight painting. Where a rigid cut opens a seam a
`kit.blob` joint hides it -- and on a TEXTURED figure the blob is given the
bake too: its UVs are pinned to the centroid UV of the nearest face of the
part it covers, so it takes that part's own baked colour and the whole role
exports as ONE primitive with ONE material (a blob left bare would either
split the role into two primitives or sample texel (0,0)).

This is the B2 method (`tools/units/import_meshy_crew_team.py`, the Sarim
crews, on branch art/a31-b2 at the time of writing) with the texture carried
through; the two files are siblings and should fold into one once both are
on main. B5 (GH-179, 2026-10-01) took the third KDF team, `breach_team`,
through the crew importer rather than this one: that file carries the B3/B4
measured elbow cut, the posed corpse and the per-side arms-on-torso rule the
breach preview needed, and a KDF head is one `HEAD_ROLE` entry there. This
file still owns `at_team` and `demo_squad`.

## What ships as texture

The remesh arrives with a 2048 base colour, a 2048 normal and a 4096
metallic-roughness map. Only the base colour ships, downscaled to 1024 and
re-encoded as JPEG q85 -- the infantry numbers table's "ask 2048, ship 1024"
(a 25 px figure resolves none of the rest, and the vehicle rule "dont drop
resolution" was given for hulls a player zooms into). The kit weapons
(`kit.launcher`, `kit.binoculars`, `kit.demo_charge`, `kit.cable_spool`,
`rig._weapon_parts`) stay untextured and take the faction ramp at runtime:
`buildMeshUnitTemplate` decides per MESH, so a textured `uniform` beside a
palette `weapon` in one GLB is the designed shape, and the team must be in
`TEXTURED_INFANTRY_TYPES` / `TEXTURED_INFANTRY_EXEMPT` or the loader throws.

## The cut, measured on each remesh rather than assumed

The A-pose figure faces -Y in the source (probed on both: the toes' centroid
sits forward of the shins' along -Y), so it takes one +90 degree Z rotation
to face +X. Heights are fractions of the figure's own height `H`
(anthropometric): ankle 0.045, boot top 0.09, knee 0.285, crotch 0.47 (the
scan is logged beside it), belt = crotch + 0.08, neck base 0.83, chin 0.87.
The arm root is the torso half-width at the armpit, 0.105 H; the shoulder is
the centroid of the arm-root ring above the hip pouches; the elbow sits 0.42
of the way from that ring to the fingertips. The A-pose arms are hung at
`ARM_HANG_DEG` from vertical by one rigid rotation about the shoulder ring --
rest geometry, like kit's contrapposto, not a pose -- and a deltoid blob
covers the wedge. The kneeling figure is the same parts re-arranged rigidly
onto a kneel (see `_kneel`), every angle solved from the figure's own segment
lengths.

## Roles

`boot` below the boot top; `face` the forward strip of the head between 0.88
and 0.955 H; `uniform` everything else -- helmet, neck, carrier, trousers:
on a textured figure the role only has to be in the closed set, the bake
says what colour it is. `weapon`/`metal`/`charge` are the kit parts.

## What each team carries, from `tools/units/teams.py` and `rig.py`

  at_team     at_fire STANDING at (0.24, -0.30) (spike-walk, 6 Oct; he
              knelt in every clip until then, `move` included), the Spike on
              his forearm_R, seated ON his +y shoulder beside the head at
              cheek height with a pistol grip and support handle and both
              arms re-seated on them (`_shoulder_launcher`, at a drop of 0),
              NOT at `rig._at_extras`' centre-line anchor, which on this
              figure ran through his head. That seat is the AIM; the motion
              pass carries the Spike low in `idle`/`move` and kneels him on
              the sim's brace (`tools/src/meshes/motion/hold.ts`, kind
              'spike'). at_spot standing at (-0.32, 0.34) with
              `kit.binoculars` on his head at this figure's measured eye
              height. Neither figure needs a D6 walker: both stand.
  demo_squad  demo_a kneeling at (0.34, -0.16) over `kit.demo_charge` at
              (0.76, -0.16) on the team's `prop` bone; demo_b standing at
              (-0.36, 0.28) with `rig._weapon_parts`'s rifle held LEVEL at
              his right hand (the kit anchors a rifle at chest height for a
              figure whose arms are built bent; a hung arm holds it at the
              hip) and `kit.cable_spool` worn on the BACK (the numbers
              table's "a disc on edge, on the upright man's back"; the kit
              draws it at shin height through the legs), on demo_b_spine.

Every figure carries a prone corpse for `down`/`wreck` -- the standing body
laid face-down and decimated to half, rigidly on `{prefix}_death_root`
(`rig._figure_death_parts`'s convention with the man's own body).

A3.1 stage 2 (GH-179, 2026-10-05): at_team's procedural tube and sight box
are replaced by the Meshy Spike (`spike_launcher`: preview
01a10c30-4ca3-74b9-befa-ba935597d8b7, refine 8k 01a10c5d-97ab-777d-98c9-1775e9c5348d,
remesh 01a10c61-808f-7626-9ebd-8abddc4e01b6; AI-generated, disclosed per
CONTRIBUTING.md), 1.2 m, through a 2048 x 1024 figure+part atlas (`_spike_part`,
`_seat_spike`). The preview came with its front bipod EXTENDED where the prompt
asked for it folded; at 25 px two splayed legs under the canister read as a
second barrel, so the bipod's faces are DELETED in Blender before it ships
(`import_meshy_crew_team._cut_spike_bipod`: 60 faces, 410 -> 350 tris).

After this: `pnpm motion:meshes -- --id=<team>`, `pnpm gait:meshes -- --id=<team>`,
`pnpm encode:meshes`, `pnpm validate:meshes`. No `mathutils.noise` anywhere in this file.
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
#: art/meshes/at_team.glb and art/meshes/demo_squad.glb
OUT_DIR = os.path.join(REPO, "art", "meshes")

#: team -> (Meshy remesh folder glob, figure height in metres -- the numbers
#: table's 1.78, the KDF rifleman reference).
SOURCES = {
    "at_team": (os.path.join(REPO, "art", "meshy", "at-team-*-01a0f2fd", "model.glb"), 1.78),
    "demo_squad": (os.path.join(REPO, "art", "meshy", "demo-squad-*-01a0f302", "model.glb"), 1.78),
}

#: The shipped base-colour bake: ask 2048, ship 1024 (numbers table).
TEXTURE_PX = 1024
JPEG_QUALITY = 85

# --- height fractions of the figure's own H --------------------------------
ANKLE_F, BOOT_TOP_F, KNEE_F, CROTCH_F = 0.045, 0.09, 0.285, 0.47
NECK_F, CHIN_F, FACE_LO_F, FACE_HI_F = 0.83, 0.87, 0.88, 0.955
FACE_HALF_W = 0.07
ARM_ROOT_F = 0.105             # torso half-width at the armpit
R_ARM_F = 0.05                 # an arm's reach from its own axis, incl. the hand
BLOB_R = {"deltoid": kit.R_UPPERARM * 1.35, "elbow": kit.R_FOREARM * 1.25,
          "knee": kit.R_KNEE * 1.2, "hip": kit.R_THIGH * 1.1}
ELBOW_FRAC = 0.42              # shoulder ring -> fingertips
WRIST_FRAC = 0.82
ARM_HANG_DEG = 10.0            # from vertical, outward, once hung
REAR_THIGH_DEG = 25.0          # kneel: rear thigh back from vertical
REAR_BOOT_FLEX_DEG = 80.0      # kneel: rear boot plantar-flexed behind the shin
DEATH_DECIMATE = 0.5


def log(msg):
    print(f"[kdf] {msg}")


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------

def _src(team_id):
    pattern, _h = SOURCES[team_id]
    hits = sorted(glob.glob(pattern))
    if len(hits) != 1:
        raise SystemExit(f"{team_id}: expected exactly one source at {pattern}, found {hits}")
    return hits[0]


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


def _load_figure(team_id):
    """The remesh as one mesh object: world transform applied, material
    KEPT, rotated to face +X, scaled to its target height, feet on z=0,
    ankles centred on the origin. Returns (object, height, material)."""
    _pattern, height = SOURCES[team_id]
    bpy.ops.import_scene.gltf(filepath=_src(team_id))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"{team_id}: expected one mesh object, found {[o.name for o in meshes]}")
    ob = meshes[0]
    if len(ob.data.materials) != 1 or not ob.data.uv_layers:
        raise SystemExit(f"{team_id}: expected one material and a UV map on the remesh")
    mat = ob.data.materials[0]
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
        raise SystemExit(f"{team_id}: toes point +Y, not the -Y both B0b figures measured -- look before rotating")
    k = height / h_src
    rot = Matrix.Rotation(math.radians(90.0), 4, "Z")
    me = ob.data
    for v in me.vertices:
        v.co = (rot @ v.co) * k
    co = _coords(ob)
    ankle = co[(co[:, 2] - co[:, 2].min()) < ANKLE_F * height]
    shift = Vector((-ankle[:, 0].mean(), -ankle[:, 1].mean(), -co[:, 2].min()))
    for v in me.vertices:
        v.co = v.co + shift
    co = _coords(ob)
    feet, shin = co[:, 2] < 0.04 * height, (co[:, 2] > 0.15 * height) & (co[:, 2] < 0.25 * height)
    if co[feet, 0].mean() <= co[shin, 0].mean():
        raise SystemExit(f"{team_id}: after the turn the toes do not point +X")
    log(f"{team_id}: source height {h_src:.4f} -> {height} m; {len(me.polygons)} tris; faces +X; material {mat.name}")
    ob.name = "figure_src"
    return ob, height, mat


def _find_crotch(cent, height):
    """The top of the first band (scanning down from the belt) in which the
    left-of-midline and right-of-midline face centroids are separated by a
    real gap -- two legs rather than one body. Logged beside the fixed
    fraction, not used for the cut (B2 measured it swinging 0.44-0.52 H)."""
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
    return CROTCH_F * height


def _arm_axis(co, height, side):
    """The spread arm's own axis from two direct centroids: the root ring
    just outboard of the torso above the hip pouches, and the outermost
    5 cm of the hand. Returns (shoulder, tip, unit axis, arm-root |y|)."""
    sgn = -1.0 if side == 0 else 1.0
    y = co[:, 1] * sgn
    w_arm = ARM_ROOT_F * height
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
    """A duplicate of `src` keeping only `faces` -- UV loops and the material
    slot come with the duplicate, which is what carries the bake through."""
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


def _face_uv_table(ob):
    """(face centroid, face UV centroid) per face -- the lookup a blob pins
    its UVs against."""
    me = ob.data
    uv = me.uv_layers.active.data
    cents, uvs = [], []
    for poly in me.polygons:
        cents.append(tuple(poly.center))
        u = np.mean([tuple(uv[li].uv) for li in poly.loop_indices], axis=0)
        uvs.append(tuple(u))
    return np.array(cents, dtype=np.float64), np.array(uvs, dtype=np.float64)


def _pin_uv(blob, ref, mat):
    """Give a bare kit blob the bake: one UV for every loop, the UV centroid
    of the `ref` part's face nearest the blob's own centre, and the figure's
    material. The blob then reads as the cloth it covers rather than as a
    palette sphere, and `join_by_role` yields one primitive per role."""
    cents, uvs = _face_uv_table(ref)
    c = _coords(blob).mean(axis=0)
    i = int(np.argmin(((cents - c) ** 2).sum(axis=1)))
    me = blob.data
    layer = me.uv_layers.new(name=ref.data.uv_layers.active.name)
    for loop in layer.data:
        loop.uv = (float(uvs[i][0]), float(uvs[i][1]))
    me.materials.append(mat)


# ---------------------------------------------------------------------------
# one figure: cut, hang the arms, measure the joints
# ---------------------------------------------------------------------------

def cut_figure(src, height, prefix, mat):
    """Cut the standing source into rig.py parts at the origin. Returns
    (parts, joints) where joints is a dict of the measured points every later
    step (bones, kneel, corpse, weapons) reads."""
    co = _coords(src)
    cent = _face_centroids(src)
    H = height
    zc = CROTCH_F * H
    log(f"{prefix}: crotch scan read {_find_crotch(cent, H) / H:.3f} H; cutting at {CROTCH_F} H")
    z_ankle, z_boot, z_knee = ANKLE_F * H, BOOT_TOP_F * H, KNEE_F * H
    z_belt, z_neck, z_chin = zc + 0.08, NECK_F * H, CHIN_F * H
    head = co[co[:, 2] > z_chin]
    x_head = head[:, 0].mean()
    axes = {side: _arm_axis(co, H, side) for side in (0, 1)}
    w_arm = axes[0][3]
    log(f"{prefix}: crotch {zc:.3f} arm-root |y| {w_arm:.3f} knee {z_knee:.3f} neck {z_neck:.3f} chin {z_chin:.3f}")

    def arm_side(p):
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
            if x > x_head + 0.02 and FACE_LO_F * H < z < FACE_HI_F * H and abs(y) < FACE_HALF_W:
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

    parts = {}
    for (name, role), faces in classes.items():
        parts[name] = _piece(src, f"{prefix}_{name}", role, faces)
    for need in ("face", "cranium", "neck", "torso", "hips", "thigh0", "thigh1", "calf0", "calf1",
                 "boot0", "boot1", "arm0", "arm1"):
        if need not in parts:
            raise SystemExit(f"{prefix}: the cut produced no {need!r} part")

    joints = {"H": H, "crotch": zc, "knee": z_knee, "ankle": z_ankle, "neck": z_neck, "chin": z_chin,
              "belt": z_belt, "leg": {}, "arm": {}}
    for side in (0, 1):
        pc = _coords(parts[f"calf{side}"])
        top = pc[pc[:, 2] > z_knee - 0.05]
        joints["leg"][side] = (float(top[:, 0].mean()), float(top[:, 1].mean()))

    k = H / kit.FIGURE_H
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
        sgn = -1.0 if side == 0 else 1.0
        target = Vector((0.0, sgn * math.sin(math.radians(ARM_HANG_DEG)), -math.cos(math.radians(ARM_HANG_DEG))))
        q = axis.rotation_difference(target)
        hang = Matrix.Translation(shoulder) @ q.to_matrix().to_4x4() @ Matrix.Translation(-shoulder)
        _transform(upper, hang)
        _transform(fore, hang)
        elbow_h, wrist_h = hang @ elbow, hang @ wrist
        parts[f"upperarm{side}"] = upper
        parts[f"forearm{side}"] = fore
        deltoid = kit.blob(f"{prefix}_deltoid{side}", tuple(shoulder), BLOB_R["deltoid"] * k, squash=(1.0, 1.0, 0.9))
        elbow_b = kit.blob(f"{prefix}_elbow{side}", tuple(elbow_h), BLOB_R["elbow"] * k)
        _pin_uv(deltoid, parts["torso"], mat)
        _pin_uv(elbow_b, upper, mat)
        parts[f"deltoid{side}"] = deltoid
        parts[f"elbow{side}"] = elbow_b
        joints["arm"][side] = {"shoulder": tuple(shoulder), "elbow": tuple(elbow_h), "wrist": tuple(wrist_h)}
        log(f"{prefix}: arm{side} A-pose {math.degrees(math.acos(abs(axis.z))):.1f} deg from vertical, "
            f"hung to {ARM_HANG_DEG}; shoulder z {shoulder.z:.3f} elbow z {elbow_h.z:.3f} wrist z {wrist_h.z:.3f}")

    for side in (0, 1):
        lx, ly = joints["leg"][side]
        knee = kit.blob(f"{prefix}_knee{side}", (lx, ly, z_knee), BLOB_R["knee"] * k)
        hip = kit.blob(f"{prefix}_hip{side}", (lx, ly, zc), BLOB_R["hip"] * k, squash=(1.05, 1.05, 1.05))
        _pin_uv(knee, parts[f"thigh{side}"], mat)
        _pin_uv(hip, parts[f"thigh{side}"], mat)
        parts[f"knee{side}"] = knee
        parts[f"hip{side}"] = hip
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


def standing_table(joints):
    """rig.py's `_BASE_BONES` shape with THIS figure's measured joints, at the
    origin and unprefixed -- the table `_shoulder_launcher` re-seats the arms
    in, as it does `_kneel`'s."""
    H, zc, zk, za, zn, zh = (joints[k] for k in ("H", "crotch", "knee", "ankle", "neck", "chin"))
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
    return table


def standing_bones(prefix, joints, dx, dy, table=None):
    """rig.py's `_BASE_BONES` shape (plus its two hip-fix bones) with THIS
    figure's measured joints -- `table` when the arms were re-seated on it."""
    zc, zk = joints["crotch"], joints["knee"]
    out = rig._translate(table if table is not None else standing_table(joints), dx, dy, prefix)
    for side, name in ((0, "L"), (1, "R")):
        lx, ly = joints["leg"][side]
        out.append((f"{prefix}_hip_{name}", f"{prefix}_pelvis",
                    (lx + dx, ly + dy, zc), (lx + dx, ly + dy, zc - 0.15 * (zc - zk))))
    return out


def _kneel(parts, joints, prefix):
    """Re-arrange standing parts (at the origin) into a kneel, rigidly, and
    return the kneel bone table (untranslated) and the kneeling eye height.
    Side 0 (-y) is the rear leg with its knee on the ground; side 1 (+y) the
    planted front leg. Every angle is solved from the figure's own segment
    lengths."""
    H, zc, zk, za = (joints[k] for k in ("H", "crotch", "knee", "ankle"))
    L_thigh = zc - zk
    rear = math.radians(REAR_THIGH_DEG)
    r_knee = 0.06
    z_hip = r_knee + L_thigh * math.cos(rear)
    drop = zc - z_hip
    s = (zk - z_hip) / L_thigh
    front = math.asin(max(-1.0, min(1.0, s)))
    log(f"{prefix}: kneel hip z {z_hip:.3f} (drop {drop:.3f}), rear thigh {REAR_THIGH_DEG} deg back, "
        f"front thigh {math.degrees(front):.1f} deg up")

    legs = {"thigh0", "thigh1", "calf0", "calf1", "boot0", "boot1", "knee0", "knee1", "hip0", "hip1"}
    _move_all(parts, [n for n in parts if n not in legs], Matrix.Translation((0.0, 0.0, -drop)))

    lx0, ly0 = joints["leg"][0]
    hip0 = Vector((lx0, ly0, zc))
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
    lx1, ly1 = joints["leg"][1]
    hip1 = Vector((lx1, ly1, zc))
    m_thigh1 = Matrix.Translation((0, 0, -drop)) @ _rot_about(hip1, "Y", -(90.0 + math.degrees(front)))
    knee1 = m_thigh1 @ Vector((lx1, ly1, zk))
    m_shin1 = Matrix.Translation(knee1 - Vector((lx1, ly1, zk)))
    _transform(parts["thigh1"], m_thigh1)
    _transform(parts["hip1"], m_thigh1)
    _transform(parts["knee1"], m_thigh1)
    _transform(parts["calf1"], m_shin1)
    _transform(parts["boot1"], m_shin1)
    ankle1 = m_shin1 @ Vector((lx1, ly1, za))
    _rename(parts, prefix, {"thigh0": "thigh_r", "calf0": "shin_r", "boot0": "boot_r",
                            "thigh1": "thigh_f", "calf1": "shin_f", "boot1": "boot_f",
                            "knee1": "knee_f", "knee0": "kneek_r", "hip0": "hipk_r", "hip1": "hipk_f"})
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
    return bones, eye_z, drop


# --- the shouldered Spike ----------------------------------------------------
#
# The first cut of this file put `kit.launcher` at the figure's own (x, y) --
# rig._at_extras' anchor, which is the KIT figure's centre line -- so on this
# figure the tube ran straight through the gunner's neck and head, rear cap
# out behind his back and muzzle out past his face (the lead's screenshot,
# 2026-10-01). It now rests ON the +y shoulder, the side whose forearm the
# tube is bound to (`forearm_R`, side 1), BESIDE the head:
#
#   * axis at cheek height, `CHEEK_F` of the standing figure, dropped by the
#     kneel; raised only if the shoulder under it would otherwise cut it;
#   * laterally, the widest point of the head, neck or torso inside the
#     tube's own height band, plus the tube's radius, plus `TUBE_GAP`;
#   * the sight / command-launch unit: a block on the tube's inboard side,
#     in front of the face, its eyepiece face at `EYE_F` height and
#     `SIGHT_STANDOFF` ahead of the face, so the eye sits behind it;
#   * a pistol grip under the tube `GRIP_FWD` ahead of the shoulder, and the
#     firing arm (side 1) re-seated on it; a handle hanging from the sight
#     unit's inboard edge, and the other arm (side 0) re-seated on that. The
#     handle is as long as it must be for that arm to reach its foot: this
#     remesh's arm is 0.45 m shoulder ring to fingertips, too short to reach
#     the tube itself across the chest.
#
# Both arms are moved RIGIDLY as rest geometry -- one rotation of the upper
# arm (and its elbow blob) about the shoulder, one of the forearm about the
# new elbow, solved by two-bone IK from the arm's own segment lengths -- the
# same kind of operation `_kneel` performs on the legs. No pose is keyed and
# nothing is weight-painted; the bone table is rebuilt from the moved joints.
# A target out of reach is approached along the same line and the shortfall
# logged, never stretched.
CHEEK_F = 0.905                # tube axis, fraction of standing H
EYE_F = 0.935                  # eye height, fraction of standing H
TUBE_RADIUS = 0.085            # kit.launcher's default, which this tube uses
TUBE_LENGTH = 1.16             # rig._at_extras / teams.at_team
TUBE_GAP = 0.02                # air between the tube and the head
GRIP_FWD = 0.20                # pistol grip, ahead of the shoulder along +x
TUBE_FWD = 0.20                # tube anchor ahead of the figure's centre, and
                               # a WINDOW, not a free number. Outboard on +y,
                               # the rear venturi meets at_spot's torso and
                               # hanging -y arm going back (samples inside him,
                               # worst clip: 6 at 0, 9 at 0.10, 3 at 0.18 -- a
                               # 0.4 mm graze in move -- 0 from 0.20); going
                               # forward its front ring enters the box behind
                               # at_fire's own head (60-69 samples in the head
                               # AABB at 0.22, still 2 cm off the head itself).
                               # 0.20 is 0 on both, every clip, measured on the
                               # exported GLB 2026-10-01.
SIGHT_SIZE = (0.14, 0.13, 0.10)  # x deep, y wide (tube to in front of the eye), z tall
SIGHT_STANDOFF = 0.04          # eyepiece face ahead of the face's front
GRIP_SIZE = (0.045, 0.035, 0.10)
HANDLE_W = (0.045, 0.035)      # support handle section; its length is solved
REACH_USE = 0.97               # of the arm's shoulder->wrist length
FIRE_POLE = (0.0, 0.5, -1.0)   # firing elbow: down and outboard
SUPPORT_POLE = (0.4, -0.6, -1.0)  # support elbow: down, outboard, forward


def _two_bone(S, E, W, T, pole):
    """Rigid transforms (upper, fore) taking the arm S-E-W so its wrist lands
    on T (or as near as the arm reaches), elbow bent toward `pole`."""
    a, b = (E - S).length, (W - E).length
    d_full = (T - S).length
    d = min(max(d_full, abs(a - b) + 1e-4), a + b - 1e-4)
    u = (T - S).normalized()
    p = Vector(pole)
    v = (p - u * p.dot(u)).normalized()
    cos_a = (a * a + d * d - b * b) / (2.0 * a * d)
    sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))
    E2 = S + (u * cos_a + v * sin_a) * a
    W2 = S + u * d
    q1 = (E - S).rotation_difference(E2 - S)
    m_upper = Matrix.Translation(S) @ q1.to_matrix().to_4x4() @ Matrix.Translation(-S)
    W1 = m_upper @ W
    q2 = (W1 - E2).rotation_difference(W2 - E2)
    m_fore = Matrix.Translation(E2) @ q2.to_matrix().to_4x4() @ Matrix.Translation(-E2) @ m_upper
    return m_upper, m_fore, E2, W2, d_full - d


def _band_max(parts, names, axis, lo, hi, band_axis, pick):
    vals = []
    for n in names:
        co = _coords(parts[n])
        m = (co[:, band_axis] >= lo) & (co[:, band_axis] <= hi)
        if m.any():
            vals.append(pick(co[m, axis]))
    return pick(np.array(vals)) if vals else None


def _shoulder_launcher(parts, joints, kbones, eye_z_unused, drop, prefix):
    """Seat the Spike on the gunner's +y shoulder beside his head and re-seat
    both hands on it (kneeling parts at the origin). Edits `kbones`' two arm
    pairs in place; returns the launcher's own placement (origin frame)."""
    H = joints["H"]
    upper_body = ("cranium", "face", "neck", "torso", "deltoid0", "deltoid1")
    axis_z = CHEEK_F * H - drop
    eye_z = EYE_F * H - drop
    # Lateral: the widest +y of anything above the shoulders in the tube's band.
    y_wide = _band_max(parts, ("cranium", "face", "neck", "torso"), 1,
                       axis_z - TUBE_RADIUS - TUBE_GAP, axis_z + TUBE_RADIUS + TUBE_GAP, 2, np.max)
    tube_y = y_wide + TUBE_RADIUS + TUBE_GAP
    # Vertical: whatever is under the tube's own footprint must clear it.
    under = _band_max(parts, upper_body, 2, tube_y - TUBE_RADIUS, tube_y + TUBE_RADIUS, 1, np.max)
    lifted = 0.0
    if under is not None and under + TUBE_RADIUS + TUBE_GAP > axis_z:
        lifted = under + TUBE_RADIUS + TUBE_GAP - axis_z
        axis_z += lifted
    face_front = _band_max(parts, ("face", "cranium"), 0, eye_z - 0.06, eye_z + 0.06, 2, np.max)

    sh1 = Vector(joints["arm"][1]["shoulder"]) - Vector((0, 0, drop))
    sight_c = Vector((face_front + SIGHT_STANDOFF + SIGHT_SIZE[0] / 2.0,
                      tube_y - TUBE_RADIUS - SIGHT_SIZE[1] / 2.0 + 0.01,
                      eye_z))
    grip_c = Vector((sh1.x + GRIP_FWD, tube_y, axis_z - TUBE_RADIUS - GRIP_SIZE[2] / 2.0 + 0.01))
    # Support handle: under the sight unit's inboard edge, down to where the
    # support arm's wrist reaches at `REACH_USE` of its length.
    a0 = joints["arm"][0]
    S0 = Vector(a0["shoulder"]) - Vector((0, 0, drop))
    reach0 = (Vector(a0["elbow"]) - Vector(a0["shoulder"])).length + (Vector(a0["wrist"]) - Vector(a0["elbow"])).length
    hx = sight_c.x
    hy = sight_c.y - SIGHT_SIZE[1] / 2.0 + HANDLE_W[1] / 2.0
    top = sight_c.z - SIGHT_SIZE[2] / 2.0 + 0.01
    flat2 = (hx - S0.x) ** 2 + (hy - S0.y) ** 2
    foot = S0.z + math.sqrt(max(0.0, (REACH_USE * reach0) ** 2 - flat2)) + 0.02
    foot = min(foot, top - 0.08)
    handle_size = (HANDLE_W[0], HANDLE_W[1], top - foot)
    handle_c = Vector((hx, hy, (top + foot) / 2.0))

    names = {0: "L", 1: "R"}
    reseat = {}
    for side, target, pole in ((1, grip_c - Vector((0, 0, 0.02)), FIRE_POLE),
                               (0, Vector((hx, hy, foot + 0.02)), SUPPORT_POLE)):
        a = joints["arm"][side]
        S = Vector(a["shoulder"]) - Vector((0, 0, drop))
        E = Vector(a["elbow"]) - Vector((0, 0, drop))
        W = Vector(a["wrist"]) - Vector((0, 0, drop))
        m_up, m_fore, E2, W2, short = _two_bone(S, E, W, target, pole)
        _transform(parts[f"upperarm{side}"], m_up)
        _transform(parts[f"elbow{side}"], m_up)
        _transform(parts[f"forearm{side}"], m_fore)
        for i, (bn, parent, head, tail) in enumerate(kbones):
            if bn == f"upperarm_{names[side]}":
                kbones[i] = (bn, parent, tuple(S), tuple(E2))
            elif bn == f"forearm_{names[side]}":
                kbones[i] = (bn, parent, tuple(E2), tuple(W2))
        reseat[side] = short
    log(f"{prefix}: Spike axis z {axis_z:.3f} (cheek {CHEEK_F} H, lifted {lifted:.3f} for the shoulder), "
        f"y {tube_y:+.3f} = widest head/neck/torso in band {y_wide:+.3f} + r {TUBE_RADIUS} + gap {TUBE_GAP}; "
        f"sight eyepiece x {sight_c.x - SIGHT_SIZE[0] / 2.0:.3f} ahead of face {face_front:.3f} at eye z {eye_z:.3f}; "
        f"firing wrist short of grip by {reseat[1] * 100:.1f} cm, support wrist short of handle by {reseat[0] * 100:.1f} cm")
    return {"at": (TUBE_FWD, tube_y, axis_z),
            "boxes": (("sight", SIGHT_SIZE, tuple(sight_c)), ("grip", GRIP_SIZE, tuple(grip_c)),
                      ("handle", handle_size, tuple(handle_c)))}


def _death_parts(src, height, prefix, x, y):
    """The whole standing source laid face-down, decimated (UVs survive the
    collapse), as ONE assembly named for `{prefix}_death_root`."""
    ob = _piece(src, f"{prefix}_death_body", "uniform", set(range(len(src.data.polygons))))
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

def _figure(src, height, mat, spec):
    """Parts + bones + forced binds for one TEAM_FIGURES spec, placed at its
    anchor, plus its corpse. Returns (parts, bones, forced, info) where info
    carries the standing eye height, the kneel drop and the hung wrists."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    if spec.get("move_posture") == "standing":
        raise SystemExit(f"{prefix}: a D6 walker is not built here (neither B0b team has one)")
    forced = {}
    parts, joints = cut_figure(src, height, prefix, mat)
    info = {"joints": joints, "drop": 0.0, "eye_z": FACE_LO_F * height + 0.03}
    if spec["posture"] == "kneeling":
        kbones, eye_z, drop = _kneel(parts, joints, prefix)
        if spec["weapon"] == "launcher":
            info["launcher"] = _shoulder_launcher(parts, joints, kbones, eye_z, drop, prefix)
        bones = rig._translate(kbones, x, y, prefix)
        info["eye_z"], info["drop"] = eye_z, drop
    elif spec["weapon"] == "launcher":
        # spike-walk (6 Oct): the gunner STANDS, so the Spike is seated on the
        # standing figure -- the same measured seat as the kneeling one, at a
        # drop of 0. This is the AIM (the rest pose, both hands on the grip
        # and the handle); the carry in `idle`/`move` and the aim in the
        # motion pass's kneel are the hold's (`motion/hold.ts`, kind 'spike').
        table = standing_table(joints)
        info["launcher"] = _shoulder_launcher(parts, joints, table, info["eye_z"], 0.0, prefix)
        bones = standing_bones(prefix, joints, x, y, table)
    else:
        bones = standing_bones(prefix, joints, x, y)
    _place(parts, x, y)
    out = list(parts.values())
    death = _death_parts(src, height, prefix, x, y)
    death_bone = rig._death_root_bone(prefix, x, y)
    bones.append(death_bone)
    for ob in death:
        forced[ob] = death_bone[0]
    out += death
    return out, bones, forced, info


def _prepare_texture(mat, cap=(TEXTURE_PX, TEXTURE_PX)):
    """Keep the base-colour bake only, at `TEXTURE_PX` (or `cap`, an atlas's
    own size). The remesh's normal and metallic-roughness maps are unlinked
    and their images removed, so the exporter writes exactly one image."""
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    base_link = next((l for l in tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if base_link is None or base_link.from_node.type != "TEX_IMAGE" or base_link.from_node.image is None:
        raise SystemExit(f"{mat.name}: Base Color is not fed by an image texture")
    base = base_link.from_node.image
    for node in list(tree.nodes):
        if node.type in ("NORMAL_MAP", "SEPARATE_COLOR") or (node.type == "TEX_IMAGE" and node.image is not base):
            tree.nodes.remove(node)
    for img in list(bpy.data.images):
        if img is not base:
            bpy.data.images.remove(img)
    before = tuple(base.size)
    if base.size[0] > cap[0] or base.size[1] > cap[1]:
        base.scale(min(base.size[0], cap[0]), min(base.size[1], cap[1]))
    log(f"texture: {base.name} {before} -> {tuple(base.size)}, JPEG q{JPEG_QUALITY}; other maps dropped")


def export_glb_textured(arm_obj, path):
    """`rig.export_glb`'s own call with the material carried through -- the
    same four arguments `tools/vehicles/textured.py::gltf_kwargs` changes."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_extras=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=JPEG_QUALITY,
        export_rest_position_armature=True,
    )


# --- A3.1 stage 2: the Meshy Spike --------------------------------------------
#
# `docs/art/meshy-prompts-a31-parts.md` #3: the procedural tube and its sight
# box give way to the refined+remeshed Meshy Spike (1.2 m, real metres),
# loaded, turned, measured and cut (its extended bipod) by
# `import_meshy_crew_team`'s part path (`PART_SPECS["spike_launcher"]`), and
# composed into this figure's atlas as B8 composes a part: the figure's bake
# in the left half, the part's in the right, ONE material. It sits where
# `_shoulder_launcher` seats the tube -- the bore on the measured axis beside
# the head, level, muzzle +X -- with its REAR face where the procedural sight's
# eyepiece face was (SIGHT_STANDOFF ahead of the face): the Spike's own
# command-launch unit and thermal sight ARE its rear, so the eye sits behind
# them as it sat behind the sight box. The pistol grip and the support handle
# stay `_shoulder_launcher`'s measured boxes (the hands are solved onto them),
# and borrow the part's own dark texel so `weapon` stays one material.
SPIKE_PART = {"at_team": "spike_launcher"}


def _spike_part(team_id, src, mat):
    import import_meshy_crew_team as crew
    name = SPIKE_PART[team_id]
    part, img = crew._load_hand_part(team_id, name)
    crew._normalise_part(team_id, name, part)
    fig_img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"
                   and any(l.to_socket.name == "Base Color" for l in n.outputs[0].links))
    W, H = 2 * TEXTURE_PX, TEXTURE_PX
    left = crew._scaled_pixels(fig_img, TEXTURE_PX, TEXTURE_PX)
    right = crew._scaled_pixels(img, TEXTURE_PX, TEXTURE_PX)
    if right.shape[2] != left.shape[2]:
        pad = np.ones((TEXTURE_PX, TEXTURE_PX, left.shape[2]), dtype=np.float32)
        k = min(left.shape[2], right.shape[2])
        pad[..., :k] = right[..., :k]
        right = pad
    atlas = bpy.data.images.new("atlas_color", W, H, alpha=(left.shape[2] == 4))
    atlas.pixels = np.concatenate([left, right], axis=1).ravel().tolist()
    atlas.update()
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image is fig_img:
            node.image = atlas
    old = fig_img.name
    fig_img.name = "figure_color"
    atlas.name = old
    crew._remap_u(src, 0.0, 0.5)
    crew._remap_u(part, 0.5, 1.0)
    part.data.materials.clear()
    part.data.materials.append(mat)
    for stale in (fig_img, img):
        if stale.users == 0:
            bpy.data.images.remove(stale)
    log(f"{team_id}: atlas {W}x{H} -- figure bake left, {name} right")
    return part


def _seat_spike(part, seat, fx, fy, mat):
    import import_meshy_crew_team as crew
    boxes = {n: (size, c) for n, size, c in seat["boxes"]}
    sight_size, sight_c = boxes["sight"]
    ax, ay, az = seat["at"]
    rear_x = fx + sight_c[0] - sight_size[0] / 2.0
    _transform(part, Matrix.Translation((rear_x, fy + ay, az)))
    part.name = part.data.name = "at_tube"
    part["rl_role"] = "weapon"
    co = _coords(part)
    out = [part]
    for n in ("grip", "handle"):
        size, c = boxes[n]
        ob = kit.box(f"at_tube_{n}", size, (fx + c[0], fy + c[1], c[2]), "weapon")
        crew._TEX["material"] = mat
        crew._borrow_uv(ob, part, near=(fx + c[0], fy + c[1], c[2] + size[2] / 2.0))
        out.append(ob)
    log(f"at_team: Meshy Spike rear face x {rear_x:.3f} (the procedural sight's eyepiece face), bore "
        f"y {fy + ay:+.3f} z {az:.3f}; x {co[:, 0].min():+.3f}..{co[:, 0].max():+.3f} "
        f"y {co[:, 1].min():+.3f}..{co[:, 1].max():+.3f} z {co[:, 2].min():+.3f}..{co[:, 2].max():+.3f}, "
        f"{len(part.data.polygons)} tris")
    return out


def build_team(team_id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src, height, mat = _load_figure(team_id)
    spike = _spike_part(team_id, src, mat) if team_id in SPIKE_PART else None
    figures = rig.TEAM_FIGURES[team_id]
    parts, bones, forced = [], [], {}
    infos = {}
    for spec in figures:
        p, b, f, info = _figure(src, height, mat, spec)
        parts += p
        bones += b
        forced.update(f)
        infos[spec["prefix"]] = info
    bpy.data.objects.remove(src, do_unlink=True)

    # Crew weapons -- kit geometry, positions from teams.py / rig.py.
    if team_id == "at_team":
        # The Spike rests on at_fire's +y shoulder beside his head, placed by
        # `_shoulder_launcher` from this figure's own measured head, neck and
        # shoulders (see the comment above it) -- not on his centre line,
        # where rig._at_extras' kit anchor ran it through his head. Level,
        # length 1.16, as teams.at_team. Sight, pistol grip and the support
        # handle are part of the launcher and ride the same forearm.
        fire_spec = next(s for s in figures if s["prefix"] == "at_fire")
        fx, fy = fire_spec["x"], fire_spec["y"]
        seat = infos["at_fire"]["launcher"]
        ax, ay, az = seat["at"]
        if spike is None:
            tube = kit.launcher("at_tube", (fx + ax, fy + ay, az), pitch=0.0, length=TUBE_LENGTH, radius=TUBE_RADIUS)
            for name, size, c in seat["boxes"]:
                tube += [kit.box(f"at_tube_{name}", size, (fx + c[0], fy + c[1], c[2]), "weapon")]
        else:
            tube = _seat_spike(spike, seat, fx, fy, mat)
        spot = infos["at_spot"]
        binos = kit.binoculars("at_binos", (-0.32, 0.34, spot["eye_z"] - kit.POSTURE_EYE["standing"] * kit.FIGURE_H - 0.04),
                               posture="standing")
        forced.update({ob: "at_fire_forearm_R" for ob in tube})
        forced.update({ob: "at_spot_head" for ob in binos})
        parts += tube + binos
        log(f"at_team: tube axis ({fx + ax:.3f}, {fy + ay:.3f}, {az:.3f}) beside the standing gunner's head")
    elif team_id == "demo_squad":
        charge = kit.demo_charge("demo_charge", (0.76, -0.16, 0.0))
        # The reel worn on the back, not through the shins: kit.cable_spool
        # draws its disc 0.30 above `at`, so `at` is set 0.50 below the
        # mid-back and 0.16 behind the spine line.
        spool = kit.cable_spool("demo_spool", (-0.36 - 0.16, 0.28, 0.50))
        bones.append(rig._prop_bone((0.76, -0.16, 0.10)))
        forced.update({ob: "prop" for ob in charge})
        forced.update({ob: "demo_b_spine" for ob in spool})
        # The rifle at the hung right hand, level: build kit's own assembly
        # and slide it from kit's chest anchor to this figure's wrist.
        wrist = Vector(infos["demo_b"]["joints"]["arm"][1]["wrist"]) + Vector((-0.36, 0.28, 0.0))
        anchor_kit = Vector(rig._weapon_anchor((-0.36, 0.28, 0.0), 0.0, "standing", False))
        anchor_want = wrist + Vector((0.03, 0.0, 0.065))
        rifle = rig._weapon_parts("demo_b", (-0.36, 0.28, 0.0), posture="standing", aim=False)
        for ob in rifle:
            _transform(ob, Matrix.Translation(anchor_want - anchor_kit))
            forced[ob] = "demo_b_forearm_R"
        parts += charge + spool + rifle
        log(f"demo_squad: rifle anchor moved {tuple(round(c, 3) for c in (anchor_want - anchor_kit))} to the wrist "
            f"(z {wrist.z:.3f}); spool disc centre z 0.80 on the back")
    else:
        raise SystemExit(f"no crew weapon rule for {team_id}")

    want = {f"{s['prefix']}_forearm_R" for s in figures if s["weapon"] == "launcher"}
    if want - set(forced.values()):
        raise SystemExit(f"{team_id}: launcher declared but not bound: {want - set(forced.values())}")

    if os.environ.get("KDF_DEBUG"):
        for ob in sorted(parts, key=lambda o: o.name):
            c = _coords(ob)
            log(f"  part {ob.name:24s} role {ob.get('rl_role'):8s} mat {[m.name for m in ob.data.materials]} "
                f"x {c[:, 0].min():+.2f}..{c[:, 0].max():+.2f} y {c[:, 1].min():+.2f}..{c[:, 1].max():+.2f} "
                f"z {c[:, 2].min():+.2f}..{c[:, 2].max():+.2f} -> {forced.get(ob, '(table)')}")
    arm_obj = rig.build_armature(bones)
    prefixes = {s["prefix"] for s in figures}
    rig.rig_parts(parts, arm_obj, forced, prefixes)
    merged = rig.join_by_role(parts)
    for role, ob in merged.items():
        mats = [m.name for m in ob.data.materials if m is not None]
        if len(mats) > 1:
            raise SystemExit(f"{team_id}: role {role} joined with {len(mats)} materials -- a blob missed _pin_uv")
    rig.build_clips(arm_obj, team_id)
    stray = [o.name for o in bpy.data.objects if o is not arm_obj and o not in merged.values()]
    if stray:
        raise SystemExit(f"{team_id}: objects in the scene that are neither the rig nor a role mesh: {stray}")
    _prepare_texture(mat, cap=(2 * TEXTURE_PX, TEXTURE_PX) if spike is not None else (TEXTURE_PX, TEXTURE_PX))
    path = os.path.join(OUT_DIR, f"{team_id}.glb")
    export_glb_textured(arm_obj, path)
    tris = {role: len(ob.data.polygons) for role, ob in merged.items()}
    log(f"{team_id}: wrote {path} ({os.path.getsize(path)} bytes), roles {sorted(merged)}, "
        f"{sum(tris.values())} tris {tris}, clips {[a.name for a in bpy.data.actions]}")
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
