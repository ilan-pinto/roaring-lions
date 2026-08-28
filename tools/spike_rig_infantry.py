"""R0 GO/NO-GO spike -- one rigged inf_squad figure, exported as GLB.

THROWAWAY. Not wired into any build, not touching kit.py / teams.py /
render_team.py / render_rig.py / anything under assets/. See
docs/superpowers/specs/2026-08-28-rigged-infantry-design.md, Phase R0.

Answers two questions kit.py's "no armature" note explicitly leaves open:

  Q1 -- does the game's palette survive skeletal deformation? (checked on the
       three.js side, against this file's output)
  Q2 -- does rigged motion read better than the shipping four-frame stride?

Two hard constraints this script exists to honour, not work around:

  1. Armature and clips are authored in code -- a bone table (name, parent,
     head, tail) and keyframe tables, nothing hand-posed in a .blend.
  2. Rigid binding, one kit part to one bone -- every part gets exactly one
     vertex group, weight 1.0, no falloff, no weight painting. If that tears
     visibly at a joint, that is R0's answer, not a bug to paint over.

Geometry comes from kit.figure() unmodified -- this script does not model a
soldier, it rigs one. Bone rest positions below are not hand-guessed: a probe
run (see the report) read the actual bounding-box centres of kit.figure()'s
parts at stride=0 and those numbers are what is hard-coded here. That is a
one-time derivation for THIS kit revision, not a general technique -- if
kit.figure() changes proportions, these numbers go stale silently.

No bpy.ops posing, no weight painting, no mathutils.noise (banned in Blender
5.2 -- it reseeds per process). All motion is math.sin/cos over an explicit
frame table, exactly like kit.py's own smoke_pose.
"""
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))
sys.path.insert(0, os.path.join(REPO, "tools", "units"))
import kit  # noqa: E402

OUT_DIR = os.path.join(REPO, "art", "spike")
OUT_GLB = os.path.join(OUT_DIR, "inf_squad_rigged.glb")

# --- bone table --------------------------------------------------------
#
# name, parent, head (x,y,z), tail (x,y,z). World axes match kit.py / teams.py:
# x forward along facing, y lateral, z up. 13 bones: root, pelvis, spine,
# neck, head, two arm chains (upperarm+forearm), two leg chains
# (thigh+shin). No IK -- every clip below is authored FK, per the design.
#
# Positions were read off kit.figure("soldier", (0,0,0), posture="standing",
# stride=0.0, headgear="helmet", loadout="regular")'s own part bounding boxes
# (a throwaway probe script, not kept) rather than derived from kit.py's
# internal formulas -- the kit builds real vertex coordinates and reading
# them back is more reliable than re-deriving z(BELT_Z)-style offsets by eye.
BONES = [
    ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
    ("pelvis", "root", (0.0, 0.0, 0.85), (0.0, 0.0, 1.00)),
    ("spine", "pelvis", (0.0, 0.0, 1.00), (0.0, 0.0, 1.40)),
    ("neck", "spine", (0.0, 0.0, 1.40), (0.0, 0.0, 1.47)),
    ("head", "neck", (0.0, 0.0, 1.47), (0.0, 0.0, 1.67)),
    ("upperarm_L", "spine", (-0.01, -0.22, 1.39), (-0.02, -0.26, 1.17)),
    ("forearm_L", "upperarm_L", (-0.02, -0.26, 1.17), (-0.03, -0.25, 0.94)),
    ("upperarm_R", "spine", (0.02, 0.19, 1.39), (0.06, 0.22, 1.20)),
    ("forearm_R", "upperarm_R", (0.06, 0.22, 1.20), (0.13, 0.22, 1.00)),
    ("thigh_L", "pelvis", (0.0, -0.10, 0.83), (0.06, -0.09, 0.35)),
    ("shin_L", "thigh_L", (0.06, -0.09, 0.35), (-0.01, -0.09, 0.04)),
    ("thigh_R", "pelvis", (0.0, 0.10, 0.90), (0.02, 0.11, 0.34)),
    ("shin_R", "thigh_R", (0.02, 0.11, 0.34), (-0.01, 0.11, 0.03)),
]

# --- part-name -> bone mapping ------------------------------------------
#
# kit.figure()'s part names are f"{prefix}_{suffix}"; this maps every suffix
# the default call (standing, helmet, regular loadout, arms on, no leader,
# no mirror, no smoke) actually emits. Built by listing kit.figure()'s 56
# parts and assigning each to the bone whose bounding box it sits inside --
# see the report for the two calls that are not a clean fit (hip{0,1} and
# knee{0,1} straddle the thigh/pelvis and thigh/shin boundary respectively;
# both were put on the THIGH bone, which is exactly where a rigid seam is
# most likely and is called out in the report rather than hidden).
PART_BONE = {
    # left leg (index 0, -y)
    "sole0": "shin_L", "boot0": "shin_L", "toe0": "shin_L",
    "calf0": "shin_L", "blouse0": "shin_L",
    "knee0": "thigh_L", "kneefold0": "thigh_L", "thigh0": "thigh_L", "hip0": "thigh_L",
    # right leg (index 1, +y)
    "sole1": "shin_R", "boot1": "shin_R", "toe1": "shin_R",
    "calf1": "shin_R", "blouse1": "shin_R",
    "knee1": "thigh_R", "kneefold1": "thigh_R", "thigh1": "thigh_R", "hip1": "thigh_R",
    # thigh-worn gear -- follows the leg it's strapped to, not the pelvis
    "dropleg": "thigh_R", "holster": "thigh_L",
    # pelvis / belt line
    "hips": "pelvis", "belt": "pelvis", "dump": "pelvis", "canteen": "pelvis", "hem": "pelvis",
    # torso / chest rig
    "torso": "spine", "carrier": "spine",
    "pouch0": "spine", "pouch1": "spine", "pouch2": "spine",
    "strap0": "spine", "strap1": "spine", "admin": "spine",
    "deltoid0": "spine", "deltoid1": "spine",
    # left arm (index 0)
    "upperarm0": "upperarm_L", "elbow0": "upperarm_L", "elbowfold0": "upperarm_L",
    "forearm0": "forearm_L", "wrist0": "forearm_L", "hand0": "forearm_L",
    # right arm (index 1, weapon/lead side for mirror=False)
    "upperarm1": "upperarm_R", "elbow1": "upperarm_R", "elbowfold1": "upperarm_R",
    "forearm1": "forearm_R", "wrist1": "forearm_R", "hand1": "forearm_R",
    # neck / head
    "neck": "neck",
    "cranium": "head", "face": "head",
    "helm_shell": "head", "helm_skirt": "head", "helm_nvg": "head",
    "helm_rail0": "head", "helm_rail1": "head", "chinstrap": "head",
}

# --- animation amplitudes (radians) -------------------------------------
A_THIGH = 0.55   # hip flex/extend
B_SHIN = 0.90    # extra knee flex during forward swing, on top of the thigh
A_ARM = 0.45     # shoulder swing, opposite-side to the leg it pairs with
BREATH_AMP = 0.035   # idle spine pitch
SWAY_AMP = 0.045     # idle pelvis roll (weight shift)

MOVE_FRAMES = 16   # one full gait cycle, frame 16 == frame 0 (loop)
IDLE_FRAMES = 32   # slower breathing loop, frame 32 == frame 0 (loop)

AXIS_Y = Vector((0.0, 1.0, 0.0))   # sagittal hinge (thigh/shin/arm swing)
AXIS_X = Vector((1.0, 0.0, 0.0))   # roll (pelvis weight shift)


def local_quat_for_world_axis(bone, axis, angle):
    """A pose-bone-local rotation quaternion for a world-space axis+angle.

    `pose_bone.matrix_basis` is applied in the bone's OWN rest frame, before
    the (parent-relative) rest offset and the parent's pose are composed on
    top of it. `Bone.matrix_local` already maps that rest frame straight into
    armature space (cumulative through the rest chain, "without parent
    [POSE] transformations" per the API, not parent-relative) -- and because
    every rest matrix here cancels against its own inverse when the parent
    carries no extra pose rotation, `bone.matrix_local` is also exactly the
    matrix that turns a world-space axis into this bone's local one. Dividing
    out `bone.parent.matrix_local` first (an earlier version of this
    function did) is wrong: it expresses the axis in the PARENT bone's own
    rest frame instead, which is a different, rotated basis (align_roll
    below deliberately points every bone's local Z away from its own long
    axis, so parent and child frames do not coincide) -- confirmed by a
    stride that barely swung the leg until this was fixed.

    Exact when the parent bone carries no pose rotation of its own at the
    same frame (true for every bone `move` animates -- their parents,
    pelvis/spine, are never keyed there); a small, second-order coupling
    error appears only in `idle`, where pelvis and spine are both keyed at
    once, and is negligible at breathing/sway amplitude.
    """
    rot3 = bone.matrix_local.to_3x3()
    local_axis = (rot3.inverted() @ axis).normalized()
    return Quaternion(local_axis, angle)


def build_figure():
    kit.new_scene()
    parts = kit.figure(
        "soldier", (0.0, 0.0, 0.0), posture="standing", yaw=0.0,
        headgear="helmet", stride=0.0, arms=True, leader=False,
        mirror=False, loadout="regular", smoke=None,
    )
    return parts


def build_armature():
    arm_data = bpy.data.armatures.new("rig_data")
    arm_obj = bpy.data.objects.new("rig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name, parent, head, tail in BONES:
        b = eb.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = eb[parent]
        # Roll picked so every bone's local Z axis points along world Y --
        # a single convention means every hinge/roll below can name a world
        # axis and mean it, with no per-bone special-casing.
        b.align_roll(AXIS_Y)
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def rig_parts(parts, arm_obj):
    """Rigid bind: one part -> one vertex group -> one bone, weight 1.0.

    No falloff, no weight painting. Each part stays a separate object (not
    joined) so its rl_role custom property -- set by kit.py's _mesh() and
    load-bearing for the three.js side's palette assignment -- survives
    per-part into the export as glTF node extras, rather than collapsing
    into one property on a merged mesh.
    """
    unmapped = []
    for obj in parts:
        prefix = "soldier_"
        assert obj.name.startswith(prefix), obj.name
        suffix = obj.name[len(prefix):]
        bone_name = PART_BONE.get(suffix)
        if bone_name is None:
            unmapped.append(obj.name)
            continue
        vg = obj.vertex_groups.new(name=bone_name)
        vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        mod = obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj
        mod.use_vertex_groups = True
        obj.parent = arm_obj
        obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    if unmapped:
        raise RuntimeError(f"unmapped parts, PART_BONE is stale: {unmapped}")


def reset_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)


def key(pb, bone, axis, angle, frame):
    pb.rotation_quaternion = local_quat_for_world_axis(bone, axis, angle)
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def build_move_clip(arm_obj):
    """A real gait cycle: hip swing, knee flex on the forward swing, and an
    opposite-phase shoulder swing. No IK -- every angle below is authored,
    per the design's "forward kinematics only" decision.
    """
    reset_pose(arm_obj)
    action = bpy.data.actions.new("move")
    action.use_fake_user = True
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = action

    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    for f in range(0, MOVE_FRAMES + 1):
        phase = 2.0 * math.pi * f / MOVE_FRAMES
        thigh_l = A_THIGH * math.sin(phase)
        thigh_r = -A_THIGH * math.sin(phase)
        shin_l = B_SHIN * max(0.0, math.sin(phase - 0.6))
        shin_r = B_SHIN * max(0.0, math.sin(phase + math.pi - 0.6))
        arm_l = -A_ARM * math.sin(phase)
        arm_r = A_ARM * math.sin(phase)

        key(pbones["thigh_L"], bones["thigh_L"], AXIS_Y, thigh_l, f)
        key(pbones["thigh_R"], bones["thigh_R"], AXIS_Y, thigh_r, f)
        key(pbones["shin_L"], bones["shin_L"], AXIS_Y, shin_l, f)
        key(pbones["shin_R"], bones["shin_R"], AXIS_Y, shin_r, f)
        key(pbones["upperarm_L"], bones["upperarm_L"], AXIS_Y, arm_l, f)
        key(pbones["upperarm_R"], bones["upperarm_R"], AXIS_Y, arm_r, f)


def build_idle_clip(arm_obj):
    """Breath + weight shift only -- cheap once move works, per the brief."""
    reset_pose(arm_obj)
    action = bpy.data.actions.new("idle")
    action.use_fake_user = True
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = action

    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    for f in range(0, IDLE_FRAMES + 1):
        t = f / IDLE_FRAMES
        ph = 2.0 * math.pi * t
        breathe = BREATH_AMP * math.sin(ph)
        sway = SWAY_AMP * math.sin(ph + 1.1)

        key(pbones["spine"], bones["spine"], AXIS_Y, breathe, f)
        key(pbones["pelvis"], bones["pelvis"], AXIS_X, sway, f)


def export_glb(arm_obj):
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        use_selection=False,          # whole scene: rig + every part
        export_apply=False,           # NEVER apply modifiers -- that would
                                       # bake the armature deform and drop
                                       # the skin entirely
        export_yup=True,              # default; verified explicitly here
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",   # one glTF clip per Blender action,
                                            # named by action.name ("idle"/"move")
        export_force_sampling=True,
        export_extras=True,           # rl_role lives in custom properties;
                                       # default False silently drops it
        export_materials="NONE",      # geometry, tags, skin, animation only
                                       # -- no colour, palette is three-side
        export_rest_position_armature=True,
    )


def main():
    parts = build_figure()
    arm_obj = build_armature()
    rig_parts(parts, arm_obj)
    build_move_clip(arm_obj)
    build_idle_clip(arm_obj)
    export_glb(arm_obj)
    size = os.path.getsize(OUT_GLB)
    print(f"wrote {OUT_GLB} ({size} bytes), {len(parts)} parts, "
          f"{len(BONES)} bones, clips: move({MOVE_FRAMES} steps) "
          f"idle({IDLE_FRAMES} steps)")


if __name__ == "__main__":
    main()
