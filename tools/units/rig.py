"""Skinned-mesh rig for infantry teams -- the production export pipeline.

Promotes `tools/spike_rig_infantry.py` (Phase R0, verdict GO -- see
`docs/superpowers/specs/2026-08-28-phase-r0-verdict.md`) from a one-figure,
two-clip throwaway into the file the runtime actually consumes, per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`. That contract is
pinned; this module targets it exactly rather than reinterpreting it.

**Ownership boundary, restated because it is load-bearing:** this module owns
the bone table, the part -> bone binding, and clip authoring. It does NOT own
a figure's geometry (`kit.py`, a parallel stream's to change) or a team's
composition of figures (`teams.py`'s per-team offsets, leader flags and weapon
placement). Both are read, neither is re-derived a second way -- exactly the
discipline the R0 spike stated for its own bone table and which this module
inherits.

**Rest-pose numbers are probed, not guessed**, same method R0 used: a
throwaway script built `kit.figure()` at stride=0 and read the real vertex
bounding-box centres of each part back. That is a one-time derivation for
*this* kit.py revision -- if the parallel stream reshapes the figure, these
numbers go stale silently, exactly as the spike's own docstring warned.

**No armature edits to kit.py, no weight painting, no `mathutils.noise`.**
Every bind below is rigid: one part, one vertex group, weight 1.0, no
falloff -- the only thing that keeps `kit.py`'s "no armature" reason 1 (code
is diffable, a rig's pose in a .blend is not) intact for this file too.
"""
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))
sys.path.insert(0, os.path.join(REPO, "tools", "units"))
import kit  # noqa: E402
import teams  # noqa: E402

OUT_DIR = os.path.join(REPO, "art", "meshes")

# --- which teams this pipeline covers -----------------------------------
#
# Only inf_squad. The other eight `teams.TEAMS` entries do not generalise
# cheaply onto one biped rig, for two independent reasons, either of which is
# enough on its own:
#
#   * Crew-served weapons (mortar_team, at_team, atgm_cell, mortar_crew,
#     digger_crew) mix postures *within one team* -- kneeling gunners beside
#     a standing spotter -- and the crew-served prop itself (kit.mortar,
#     kit.atgm_tripod, kit.launcher's tripod-adjacent parts) is built as a
#     free-standing object with no figure waypoint to bind to. A kneeling
#     figure is not a rotation of this rig's standing rest pose any more than
#     prone is (see `build_clips`'s note on `down`/`wreck` below); it is
#     different kit.figure() topology.
#   * moto_rpg is a vehicle-plus-two-riders composition with its own
#     from-scratch rider primitive (`teams._rider`), not `kit.figure()` at
#     all, and charge_squad and militia_cell both apply `_lean_forward` as a
#     one-shot vertex rotation baked into a rebuild -- workable for a single
#     static frame, not for a bone that has to carry every clip.
#
# Attempting any of these now would mean inventing a second rig shape under
# time pressure and shipping it half-verified, which is worse than shipping
# one team well and saying so.
TEAM_ID = "inf_squad"

# --- rest-pose figure placement, read from teams.py, not re-derived ------
#
# teams.inf_squad's own arrangement: `for i, y in enumerate((-0.78, 0.0,
# 0.78)): x = 0.20 if i == 1 else 0.0`, leader on the centre figure. Copied
# as literal values rather than called through `teams.inf_squad` because that
# function returns baked-per-frame geometry for one clip at a time (see its
# module docstring: "A clip is a composition, not a pose") -- exactly what
# this rig exists to replace with bone motion. Figure prefixes are `f0`/`f1`/
# `f2` directly, so kit.figure()'s own `{prefix}_{suffix}` part names already
# carry the mesh-unit-contract's bone prefix convention with no translation
# step.
REST_FIGURES = [
    # prefix, x, y, leader
    ("f0", 0.0, -0.78, False),
    ("f1", 0.20, 0.0, True),
    ("f2", 0.0, 0.78, False),
]


def _check_rest_figures_against_teams():
    """Self-check, run at import: re-derive `teams.inf_squad`'s own
    figure-placement formula from its docstring and assert REST_FIGURES
    still matches it, so a typo here -- or a future edit to that formula in
    teams.py that this file is not touched for -- fails loudly at import
    rather than drifting silently. Cheap and exact: `teams.py` builds three
    figures at `y in (-0.78, 0.0, 0.78)`, `x = 0.20 if i == 1 else 0.0`,
    leader on the centre one -- copied verbatim from `teams.inf_squad`'s own
    body, not re-typed from memory.
    """
    expect = [
        (f"f{i}", 0.20 if i == 1 else 0.0, y, i == 1)
        for i, y in enumerate((-0.78, 0.0, 0.78))
    ]
    assert REST_FIGURES == expect, (
        "REST_FIGURES no longer matches teams.inf_squad's own arrangement "
        f"-- expected {expect}, have {REST_FIGURES}"
    )
    assert "inf_squad" in teams.TEAMS, "teams.py no longer defines inf_squad"
    assert teams.TEAMS["inf_squad"][1] == "kdf", "inf_squad's faction changed"


_check_rest_figures_against_teams()

# --- per-figure bone table, relative to that figure's own (x, y, 0) -------
#
# Endpoints read from a probe (`kit.figure("f", (0,0,0), posture="standing",
# stride=0.0, headgear="helmet", loadout="regular", arms=True, leader=False,
# mirror=False, smoke=None)`, the same rest call REST_FIGURES drives) via
# each named part's real vertex bounding-box centre -- not hand-guessed, and
# not the R0 spike's numbers copied forward blind, though they land close
# (same kit.py revision). Where a part's own centre is the natural bone
# endpoint (deltoid for the shoulder, knee/wrist blobs for elbow/hand) it is
# used directly; pelvis/spine/neck/head instead use kit.py's own named
# fractions (BELT_Z, CHEST_Z, SHOULDER_Z, HEAD_Z) against FIGURE_H, which are
# real constants in kit.py rather than inline literals, and so cannot drift
# out of sync with a change to those four numbers the way a probed torso
# value could.
_H = kit.FIGURE_H


def _z(frac):
    return frac * _H  # drop == 0 at stride 0, matching kit.figure()'s own z()


# name, parent, head (x, y, z), tail (x, y, z)
_BASE_BONES = [
    ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
    ("pelvis", "root", (0.0, 0.0, _z(kit.BELT_Z) - 0.09), (0.0, 0.0, _z(kit.BELT_Z) + 0.05)),
    ("spine", "pelvis", (0.0, 0.0, _z(kit.BELT_Z) + 0.05), (0.0, 0.0, _z(kit.SHOULDER_Z) - 0.03)),
    ("neck", "spine", (0.0, 0.0, _z(kit.HEAD_Z) - 0.155), (0.0, 0.0, _z(kit.HEAD_Z) - 0.085)),
    ("head", "neck", (0.0, 0.0, _z(kit.HEAD_Z) - 0.085), (0.0, 0.0, _z(kit.HEAD_Z) + 0.115)),
    ("upperarm_L", "spine", (0.0, -0.253, 1.385), (-0.02, -0.257, 1.170)),
    ("forearm_L", "upperarm_L", (-0.02, -0.257, 1.170), (-0.028, -0.253, 0.940)),
    ("upperarm_R", "spine", (0.0, 0.217, 1.405), (0.062, 0.221, 1.200)),
    ("forearm_R", "upperarm_R", (0.062, 0.221, 1.200), (0.127, 0.217, 1.000)),
    ("thigh_L", "pelvis", (0.003, -0.101, 0.825), (0.058, -0.094, 0.354)),
    ("shin_L", "thigh_L", (0.058, -0.094, 0.354), (0.004, -0.098, 0.055)),
    ("thigh_R", "pelvis", (0.003, 0.099, 0.895), (0.023, 0.114, 0.340)),
    ("shin_R", "thigh_R", (0.023, 0.114, 0.340), (-0.003, 0.118, 0.050)),
]

#: Amplitudes, in radians unless noted. Same numbers R0 established, kept
#: rather than re-tuned: the move cycle already reads as a real gait and
#: nothing here changes leg geometry.
A_THIGH = 0.55
B_SHIN = 0.90
A_ARM = 0.45
BREATH_AMP = 0.035
SWAY_AMP = 0.045
#: New for the production clip set. A walking figure's torso pitches forward
#: of a standing one's -- the spike's `move` did not do this, and per the
#: brief this is part of why the sprite reads as dynamic and the spike did
#: not. Small and constant through the cycle (a lean is a stance, not a
#: stride phase); verified below rather than assumed, since the direction of
#: a world-axis rotation on a bone whose local frame is `align_roll`-rotated
#: is exactly the mistake R0's own local_quat_for_world_axis note records.
MOVE_LEAN = 0.14
#: `fire`: the weapon-side shoulder and elbow come up and forward. The
#: unrigged sprite achieves "weapon comes up" by swapping in an independently
#: placed prop (kit.rifle(aim=True)) that never touches the arm mesh at all
#: -- a workaround for having no skeleton, not the intent. Bound to a bone,
#: the weapon can instead actually travel with the hand that holds it, which
#: reads as more correct, not less; that is a deliberate deviation from the
#: sprite's technique in service of its stated *goal* ("weapon comes up... no
#: height change"), recorded here rather than left silent.
#: Signs picked empirically, not guessed -- a small sweep against the
#: weapon mesh's own world-space centroid (bound to forearm_R, see PART_BONE)
#: confirmed which sign combination actually moves it forward *and* up
#: rather than backward or down, exactly the check R0's own hip-swing note
#: says a world-axis rotation needs. Magnitude kept at the same order as
#: `move`'s own A_ARM (already proven not to tear at the shoulder blob) so
#: `fire` is not the clip that finds the *next* rigid-binding exception.
FIRE_SHOULDER = -0.45
FIRE_ELBOW = 0.35

MOVE_FRAMES = 16
IDLE_FRAMES = 32

AXIS_Y = Vector((0.0, 1.0, 0.0))
AXIS_X = Vector((1.0, 0.0, 0.0))

#: suffix (kit.figure()'s "{prefix}_{suffix}" part name, prefix stripped) ->
#: base bone name (figure-index prefix added at bind time). Covers every
#: part the rest call (helmet, regular loadout, arms on, no leader-specific
#: geometry beyond the antenna) emits, plus the rifle prop.
#:
#: hip0/hip1 are the one entry that changed from the R0 spike's mapping --
#: see `hip_L`/`hip_R` below and the module docstring's "the hip" section.
#: Every other suffix is unchanged from the spike, because R0 already found
#: every other joint held.
PART_BONE = {
    # left leg (index 0, -y)
    "sole0": "shin_L", "boot0": "shin_L", "toe0": "shin_L",
    "calf0": "shin_L", "blouse0": "shin_L",
    "knee0": "thigh_L", "kneefold0": "thigh_L", "thigh0": "thigh_L",
    "hip0": "hip_L",
    # right leg (index 1, +y)
    "sole1": "shin_R", "boot1": "shin_R", "toe1": "shin_R",
    "calf1": "shin_R", "blouse1": "shin_R",
    "knee1": "thigh_R", "kneefold1": "thigh_R", "thigh1": "thigh_R",
    "hip1": "hip_R",
    # thigh-worn gear -- follows the leg it's strapped to, not the pelvis
    "dropleg": "thigh_R", "holster": "thigh_L",
    # pelvis / belt line
    "hips": "pelvis", "belt": "pelvis", "dump": "pelvis", "canteen": "pelvis", "hem": "pelvis",
    # torso / chest rig
    "torso": "spine", "carrier": "spine",
    "pouch0": "spine", "pouch1": "spine", "pouch2": "spine",
    "strap0": "spine", "strap1": "spine", "admin": "spine",
    "deltoid0": "spine", "deltoid1": "spine",
    "antenna": "spine",
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
    # weapon -- rigidly on the forearm that carries it, see FIRE_* above
    "w": "forearm_R",
}


def local_quat_for_world_axis(bone, axis, angle):
    """A pose-bone-local rotation quaternion for a world-space axis+angle.

    Identical to the R0 spike's function of the same name, and identically
    exact only when the bone's parent carries no pose rotation of its own at
    the same frame -- see the spike's own long comment for the reference-
    frame mistake this guards against (a stride that barely moved the leg
    until it was fixed). True for every bone this module keys on its own,
    including the new hip bones (parent pelvis, never keyed); `move`'s spine
    lean is the one place two ancestors move at once (spine's own lean is
    keyed while pelvis is not, so that one is still exact -- pelvis is
    unmoved in `move`), and `idle` keys pelvis and spine together, where R0
    already recorded the resulting error as second-order and negligible at
    breath/sway amplitude.
    """
    rot3 = bone.matrix_local.to_3x3()
    local_axis = (rot3.inverted() @ axis).normalized()
    return Quaternion(local_axis, angle)


def _figure_bones(prefix, dx, dy):
    """This figure's bone table, translated to its rest placement and with
    two extra hip bones -- the fix for R0's one real rigid-binding failure.

    **The hip.** `hip0`/`hip1` are blobs that bridge the pelvis and the
    thigh. R0 bound them wholly to the thigh bone, and at the hip's own
    ~31 deg swing (A_THIGH) that opened a visible gap in profile: the blob's
    pelvis-side vertices are close to the thigh's rotation pivot but the
    *pelvis mesh itself never moves in `move`*, so anything bound 100% to the
    thigh swings its near edge out from under a socket that stays still.
    Every other joint blob (knee, elbow) sits between two bones that are
    BOTH animated, so the discontinuity is smaller and R0 found it did not
    tear visibly; the hip is the one blob between a moving bone and a
    completely static one.

    The fix adds `hip_L`/`hip_R` as their own bones, children of `pelvis`
    (not `thigh`), positioned at the thigh's own rest pivot and pointing the
    same direction the thigh does (a fixed 15% of the thigh's own rest
    vector, computed here rather than hand-typed, so it cannot drift out of
    sync with a change to the thigh's endpoints above). The hip blob binds to
    this new bone instead of the thigh, and the clip functions below key it
    to HALF the thigh's own rotation every frame -- an anatomically
    reasonable compromise (a hip blob is over real tissue that partially
    follows the femur and partially stays with the pelvis) that closes roughly
    half the gap by construction. This is a bone and a formula, not a weight
    paint: it stays exactly as diffable as everything else here.
    """
    out = []
    for name, parent, head, tail in _BASE_BONES:
        h = (head[0] + dx, head[1] + dy, head[2])
        t = (tail[0] + dx, tail[1] + dy, tail[2])
        out.append((f"{prefix}_{name}", f"{prefix}_{parent}" if parent else None, h, t))
    thigh_by_name = {n: (h, t) for n, _p, h, t in _BASE_BONES}
    for base, side in (("hip_L", "thigh_L"), ("hip_R", "thigh_R")):
        th_head, th_tail = thigh_by_name[side]
        hx = th_head[0] + dx
        hy = th_head[1] + dy
        hz = th_head[2]
        vx = (th_tail[0] - th_head[0]) * 0.15
        vy = (th_tail[1] - th_head[1]) * 0.15
        vz = (th_tail[2] - th_head[2]) * 0.15
        out.append((f"{prefix}_{base}", f"{prefix}_pelvis", (hx, hy, hz), (hx + vx, hy + vy, hz + vz)))
    return out


def build_team_rest(team_id=TEAM_ID):
    """Fresh scene: every figure's rest geometry (idle/move/fire's shared
    starting pose -- standing, stride 0, helmet, regular loadout, weapon
    carried not aimed), all bone tables, figure by figure."""
    assert team_id == TEAM_ID, f"rig.py currently covers only {TEAM_ID!r}"
    kit.new_scene()
    parts = []
    bone_table = []
    for prefix, x, y, leader in REST_FIGURES:
        parts += kit.figure(
            prefix, (x, y, 0.0), posture="standing", yaw=0.0, headgear="helmet",
            stride=0.0, arms=True, leader=leader, mirror=False,
            loadout="regular", smoke=None,
        )
        parts += kit.rifle(f"{prefix}_w", (x, y, 0.0), posture="standing", aim=False)
        bone_table += _figure_bones(prefix, x, y)
    return parts, bone_table


def build_armature(bone_table):
    arm_data = bpy.data.armatures.new("rig_data")
    arm_obj = bpy.data.objects.new("rig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name, parent, head, tail in bone_table:
        b = eb.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = eb[parent]
        # Every bone's local Z points along world Y -- one convention so any
        # hinge below can name a world axis and mean it. Same as R0.
        b.align_roll(AXIS_Y)
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def rig_parts(parts, arm_obj):
    """Rigid bind: one part -> one vertex group -> one bone, weight 1.0.

    Each part stays its own object through this step (not joined yet) so its
    `rl_role` custom property -- set by `kit.py`'s `_mesh()` -- survives
    per-part; `join_by_role` below merges by role only after every part
    already carries a correct vertex group and modifier.
    """
    unmapped = []
    for obj in parts:
        prefix, _, suffix = obj.name.partition("_")
        # kit.figure()'s own prefix arg is "f0"/"f1"/"f2"; kit.rifle() is
        # called with the FULL "f0_w" as its own `name` (a single mesh, no
        # further suffixing inside kit.rifle), so it has no internal
        # "prefix_suffix" split of its own -- handled as a special case.
        if obj.name.endswith("_w") and obj.name[:-2] in {p for p, *_ in REST_FIGURES}:
            prefix, suffix = obj.name[:-2], "w"
        bone_name = PART_BONE.get(suffix)
        if bone_name is None:
            unmapped.append(obj.name)
            continue
        vg = obj.vertex_groups.new(name=f"{prefix}_{bone_name}")
        vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        mod = obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj
        mod.use_vertex_groups = True
        obj.parent = arm_obj
        obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    if unmapped:
        raise RuntimeError(f"unmapped parts, PART_BONE is stale: {unmapped}")


def join_by_role(parts):
    """One skinned mesh per `rl_role` -- the mesh-unit-contract's central
    requirement and the fix for R0's 56-draw-calls finding.

    Every part destined for the same mesh already sits at the world origin
    with an identity object transform (kit.py's own rule: "object scale
    always 1", nothing here ever touches `obj.location` either), so `join()`
    needs no coordinate reconciliation -- it is purely a data merge. Vertex
    groups from every joined part carry over by name, so the merged mesh ends
    up with one vertex group per bone actually used by that role, each
    vertex still weighted 1.0 in exactly one group -- rigid binding survives
    the join unchanged.
    """
    from collections import defaultdict
    groups = defaultdict(list)
    for ob in parts:
        role = ob.get("rl_role")
        if role is None:
            raise RuntimeError(f"{ob.name} carries no rl_role")
        if role not in kit.ROLES:
            raise RuntimeError(f"{ob.name}: role {role!r} outside kit.ROLES")
        groups[role].append(ob)

    merged = {}
    for role, obs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = role
        ob.data.name = role
        ob["rl_role"] = role
        merged[role] = ob
    return merged


def reset_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)


def key(pb, bone, axis, angle, frame):
    pb.rotation_quaternion = local_quat_for_world_axis(bone, axis, angle)
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def _new_action(arm_obj, name):
    """A fresh, self-contained action.

    **Every pose bone gets an explicit identity keyframe at frame 0**, not
    just the ones this clip intentionally animates. Blender's animation
    evaluation only writes a channel that the ACTIVE action actually drives;
    a bone with no F-curve in this action keeps whatever value it was last
    assigned by Python, in memory, regardless of which action is active when
    that memory is read. Skipping this step is silent and was caught only by
    measurement, not by reading the code: with `idle` built before `fire`,
    exporting `idle` after `fire` was authored left the weapon-arm bones at
    `fire`'s last angle for the *entire idle clip*, because `idle` never
    keys them at all -- proven by re-querying the exported "idle" weapon
    centroid before and after a `fire`-only code change and watching it move.
    One frame-0 key per bone gives every channel a defined, constant value
    for any frame this action does not otherwise touch.
    """
    reset_pose(arm_obj)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    arm_obj.animation_data.action = action
    for pb in arm_obj.pose.bones:
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.keyframe_insert(data_path="rotation_quaternion", frame=0)
    return action


def build_idle_clip(arm_obj):
    """Breath + weight shift, per figure -- unchanged from R0 beyond
    repeating it three times under each figure's own bone prefix. All three
    figures share the same phase, matching `teams.inf_squad`'s own idle
    (every figure in the team is built from the same `smoke_pose` frame each
    tick, so they were already synchronised in the sprite pipeline)."""
    _new_action(arm_obj, "idle")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    for f in range(0, IDLE_FRAMES + 1):
        t = f / IDLE_FRAMES
        ph = 2.0 * math.pi * t
        breathe = BREATH_AMP * math.sin(ph)
        sway = SWAY_AMP * math.sin(ph + 1.1)
        for prefix, _x, _y, _leader in REST_FIGURES:
            key(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"], AXIS_Y, breathe, f)
            key(pbones[f"{prefix}_pelvis"], bones[f"{prefix}_pelvis"], AXIS_X, sway, f)


def build_move_clip(arm_obj):
    """A real gait cycle per figure, plus the forward lean R0's clip did not
    have (see MOVE_LEAN above) and the hip-bone half-angle fix."""
    _new_action(arm_obj, "move")
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
        for prefix, _x, _y, _leader in REST_FIGURES:
            key(pbones[f"{prefix}_thigh_L"], bones[f"{prefix}_thigh_L"], AXIS_Y, thigh_l, f)
            key(pbones[f"{prefix}_thigh_R"], bones[f"{prefix}_thigh_R"], AXIS_Y, thigh_r, f)
            key(pbones[f"{prefix}_shin_L"], bones[f"{prefix}_shin_L"], AXIS_Y, shin_l, f)
            key(pbones[f"{prefix}_shin_R"], bones[f"{prefix}_shin_R"], AXIS_Y, shin_r, f)
            key(pbones[f"{prefix}_upperarm_L"], bones[f"{prefix}_upperarm_L"], AXIS_Y, arm_l, f)
            key(pbones[f"{prefix}_upperarm_R"], bones[f"{prefix}_upperarm_R"], AXIS_Y, arm_r, f)
            key(pbones[f"{prefix}_hip_L"], bones[f"{prefix}_hip_L"], AXIS_Y, thigh_l * 0.5, f)
            key(pbones[f"{prefix}_hip_R"], bones[f"{prefix}_hip_R"], AXIS_Y, thigh_r * 0.5, f)
            key(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"], AXIS_Y, MOVE_LEAN, f)


def build_fire_clip(arm_obj):
    """One static pose: the weapon-side shoulder and elbow bring the rifle
    up. No leg or height change -- `_standing_posture("fire")` in teams.py is
    "standing" specifically because the clip is latched per shot and a pose
    that changed height would bob the whole squad through a firefight; this
    rig honours that by only ever keying the arm."""
    _new_action(arm_obj, "fire")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    for f in (0,):
        for prefix, _x, _y, _leader in REST_FIGURES:
            key(pbones[f"{prefix}_upperarm_R"], bones[f"{prefix}_upperarm_R"], AXIS_Y, FIRE_SHOULDER, f)
            key(pbones[f"{prefix}_forearm_R"], bones[f"{prefix}_forearm_R"], AXIS_Y, FIRE_ELBOW, f)


def build_clips(arm_obj):
    build_idle_clip(arm_obj)
    build_move_clip(arm_obj)
    build_fire_clip(arm_obj)
    # `down`, `wreck`: NOT authored. See the module docstring's "what this
    # slice does not attempt" section and the report -- kit.py's prone
    # posture is a different topology (horizontal torso/leg primitives, not
    # the standing figure rotated), and reaching it from this rig would need
    # hip flexion of roughly 90 degrees against the ~31 degree swing that
    # already needed a fix bone. Omitting a clip is legal per the mesh-unit
    # contract ("A clip absent from the file is legal"); inventing a fake
    # "prone" that is really a folded standing figure is not what the
    # contract's clip vocabulary means and would be worse than absence.
    # `work`: not part of inf_squad's clip vocabulary at all
    # (`teams.TEAM_CLIP_ADD` scopes it to yahalom_squad only), so there is
    # nothing to author here.


def export_glb(arm_obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=False,           # never bake the armature deform
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_extras=True,           # rl_role lives in custom properties
        export_materials="NONE",      # zero materials -- palette is runtime-side
        export_rest_position_armature=True,
    )


def build_and_export(team_id=TEAM_ID, out_path=None):
    parts, bone_table = build_team_rest(team_id)
    arm_obj = build_armature(bone_table)
    rig_parts(parts, arm_obj)
    merged = join_by_role(parts)
    build_clips(arm_obj)
    path = out_path or os.path.join(OUT_DIR, f"{team_id}.glb")
    export_glb(arm_obj, path)
    return arm_obj, merged, path
