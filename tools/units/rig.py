"""Skinned-mesh rig for infantry teams -- the production export pipeline.

Promotes `tools/spike_rig_infantry.py` (Phase R0, verdict GO -- see
`docs/superpowers/specs/2026-08-28-phase-r0-verdict.md`) into the file the
runtime actually consumes, per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`. That contract is
pinned; this module targets it exactly rather than reinterpreting it.

**Ownership boundary, restated because it is load-bearing:** this module owns
the bone table, the part -> bone binding, and clip authoring. It does NOT own
a figure's geometry (`kit.py`, a parallel stream's to change) or a team's
composition of figures (`teams.py`'s per-team offsets, leader flags and weapon
placement). Both are read, neither is re-derived a second way.

**Coverage.** Twelve of `teams.TEAMS`'s thirteen entries -- every one but
`moto_rpg`, a from-scratch vehicle-plus-rider composition
(`teams._motorcycle`/`_rider`, not `kit.figure()` at all), scoped out as its
own slice.

  * Standing riflemen, reusing `inf_squad`'s topology directly:
    `militia_cell`, `charge_squad` (its own sprint lean baked into rest
    geometry via `teams._lean_forward`, read not reimplemented),
    `rpg_team` (both figures stand -- neither uses `_crew_posture`),
    `yahalom_squad` (its own held mast and worn packs, see
    `_yahalom_extras`; its sixth clip, `work`, driving the mast into the
    ground, is NOT built here -- its own design problem, `TEAM_CLIP_ADD`
    scopes it to this one team alone).
  * Crew-served weapons -- a second bone topology for a KNEELING figure
    (`_kneel_bones`, derived below) plus a convention for a free-standing
    weapon prop that is not gripped by any bone-bound hand: `demo_squad`,
    `at_team`, `mortar_team`, `mortar_crew`, `atgm_cell`, and `digger_crew`
    (its own ground-clutter spoil heap, see `_digger_extras` -- kneeling
    through `idle`/`move`/`fire` rather than standing to relocate for
    `move` the way `teams.digger_crew` itself does; a deliberate
    simplification, not an oversight, see the report).
  * `sniper_team` -- a THIRD bone topology, because its canonical idle is
    PRONE, not standing or kneeling. `_sniper_rest`/`build_sniper_clips`
    give it its own bespoke rest/clip builders rather than forcing it
    through `_add_figure`'s one-living-posture-per-figure shape; see both
    docstrings for why.

**`down`/`wreck` -- every figure in every team above, this pass.** The prior
report tried FK-folding the standing rig into prone and got a
self-intersecting heap (see the same report section); the conclusion it drew
-- these clips want separate geometry -- is what this pass builds.
`_figure_death_parts` calls `kit.figure(posture="prone", ...)` fresh, exactly
as `teams.py`'s own `_crew_posture` already treats down/wreck as prone
regardless of a figure's LIVING posture (standing or kneeling). That geometry
binds rigidly, as ONE assembly, to a new figure-owned `{prefix}_death_root`
bone -- no per-part articulation, because nothing in this pass poses the
corpse relative to itself, only swaps whether it or the living rig is on
screen. Both rigs live in the SAME skin (the contract's "one armature per
file"): a figure's `root` and its `death_root` are siblings with no parent,
and every clip keys BOTH bones' scale explicitly -- 1/0 for `root`/`death_root`
in `idle`/`move`/`fire`, 0/1 in `down`/`wreck` -- which is what actually hides
whichever rig is not current. A team's shared `prop` bone (the free-standing
mortar tube / ATGM tripod / demo charge, see below) gets the same treatment,
matching `teams._weapon_visible`'s own "abandoned when the crew goes flat".
A held rifle or launcher needs no extra handling: it is already bound to its
firer's `forearm_R`, a descendant of that figure's `root`, so collapsing
`root` collapses the weapon with it, for free. `down` and `wreck` are
identical, geometrically -- see `build_death_clip`'s own docstring for why,
and for why this is a single static frame rather than an animated collapse.

**Rest-pose numbers are probed or derived, never guessed.** The standing
topology's numbers are R0's own, unchanged. The new kneeling topology's
numbers were derived two ways and cross-checked against each other: by hand
from `kit.py`'s own literal kneeling-branch source (every term is a plain
constant at rest -- kneeling never reads `stride`), and independently by a
throwaway Blender probe that built `kit.figure(posture="kneeling")` and read
back real vertex-ring centres. Both agree to three decimal places; see the
report for the actual probe output.

**No armature edits to kit.py, no weight painting, no `mathutils.noise`.**
Every bind below is rigid: one part, one vertex group, weight 1.0, no
falloff.

**A free-standing crew weapon (mortar, ATGM tripod) has no hand to bind to.**
It is bound to a dedicated, never-keyed `prop` bone instead -- a rigid,
world-fixed mount, which is exactly correct because the sprite pipeline never
repositions these either (`kit.mortar`/`kit.atgm_tripod`'s call site in
`teams.py` passes the identical arguments regardless of clip). A
shoulder-fired launcher (Spike, RPG) is different: `teams.py` describes it as
"held", so it binds to the firer's own `forearm_R` instead, the same
convention `_weapon_parts` already uses for a rifle -- and unlike the ground
mounts, this makes the `fire` clip's raise/recoil apply correctly should a
future pass want it (not authored here, since neither launcher's own
position varies with `clip` in `teams.py` either -- see the report's
"what fire clip means per team" table for the exact reasoning per team).
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

#: Every team this pipeline can export. Order is priority order from the
#: brief, not `teams.TEAMS`'s own order.
SUPPORTED_TEAMS = (
    "inf_squad", "militia_cell", "demo_squad", "charge_squad",
    "at_team", "rpg_team", "mortar_team", "mortar_crew", "atgm_cell",
    "sniper_team", "yahalom_squad", "digger_crew",
)
DEFAULT_TEAM = "inf_squad"

_H = kit.FIGURE_H


def _z(frac):
    return frac * _H  # drop == 0 at stride 0, matching kit.figure()'s own z() for STANDING


def _zk(frac):
    # kit.figure()'s kneeling branch fixes `drop = 0.30 * H` regardless of any
    # other argument (kneeling never reads stride) -- so the kneeling z() is
    # this same fraction, shifted down by a plain constant. Confirmed against
    # a live probe (see module docstring): 4 of 4 shared torso/head parts
    # (hips, torso, neck, cranium) landed within rounding of this formula.
    return frac * _H - 0.30 * _H


# --- shared part -> bone suffix table ---------------------------------------
#
# One dict for every team and every posture this module builds. A posture
# emits its own, disjoint set of suffixes (kneeling's leg parts are named
# "shin_r"/"thigh_f"/etc, never "thigh0"/"thigh1"), so there is no collision
# between the standing and kneeling entries below -- a team only ever emits
# one posture's leg vocabulary.
_COVER_BONE = {
    "cuff": "shin", "kneepad": "thigh",
    "elbowpad": "upperarm", "gauntlet": "forearm", "glove": "forearm",
}

PART_BONE = {
    # --- standing legs ---
    "sole0": "shin_L", "boot0": "shin_L", "toe0": "shin_L",
    "calf0": "shin_L", "blouse0": "shin_L",
    "knee0": "thigh_L", "kneefold0": "thigh_L", "thigh0": "thigh_L",
    "hip0": "hip_L",
    "sole1": "shin_R", "boot1": "shin_R", "toe1": "shin_R",
    "calf1": "shin_R", "blouse1": "shin_R",
    "knee1": "thigh_R", "kneefold1": "thigh_R", "thigh1": "thigh_R",
    "hip1": "hip_R",
    "dropleg": "thigh_R", "holster": "thigh_L",
    # --- kneeling legs (new this pass) ---
    # "down"/ground-contact leg (kit.py's own "_r" suffix -- not a body
    # side, the leg whose knee is on the ground) and "front"/planted leg
    # ("_f"). No hip-fix bone: kneeling never animates thighs (crew stay
    # deployed through every clip this pass authors -- see the report), so
    # there is no swing to open a gap at.
    "shin_r": "shin_r", "boot_r": "shin_r", "thigh_r": "thigh_r",
    "shin_f": "shin_f", "boot_f": "shin_f",
    "knee_f": "thigh_f", "kneepad_f": "thigh_f", "thigh_f": "thigh_f",
    # --- pelvis / belt line (either posture) ---
    "hips": "pelvis", "belt": "pelvis", "dump": "pelvis", "canteen": "pelvis", "hem": "pelvis",
    "shirt_hem": "pelvis",   # irregular loadout's long shirt hem
    # --- torso / chest rig (either posture) ---
    "torso": "spine", "carrier": "spine",
    "pouch0": "spine", "pouch1": "spine", "pouch2": "spine",
    "strap0": "spine", "strap1": "spine", "admin": "spine",
    "deltoid0": "spine", "deltoid1": "spine",
    "antenna": "spine",
    "cummerbund0": "spine", "cummerbund1": "spine",
    "bandolier": "spine",    # irregular loadout's single shoulder strap
    "vest_f": "spine", "vest_b": "spine",   # charge_squad's front/back vest slabs
    # --- arms (either posture) ---
    "upperarm0": "upperarm_L", "elbow0": "upperarm_L", "elbowfold0": "upperarm_L",
    "forearm0": "forearm_L", "wrist0": "forearm_L", "hand0": "forearm_L",
    "upperarm1": "upperarm_R", "elbow1": "upperarm_R", "elbowfold1": "upperarm_R",
    "forearm1": "forearm_R", "wrist1": "forearm_R", "hand1": "forearm_R",
    # --- neck / head (either posture) ---
    "neck": "neck",
    "cranium": "head", "face": "head",
    "helm_shell": "head", "helm_skirt": "head", "helm_nvg": "head",
    "helm_rail0": "head", "helm_rail1": "head", "chinstrap": "head",
    "hood": "head", "balaclava": "head", "gaiter": "neck",
    "helm_counterweight": "head",
    "kef_crown": "head", "kef_mantle": "head", "kef_tail": "head",
    # --- weapon assembly, bound rigidly via forced_bone below, not this
    # table -- see _weapon_parts and _add_figure. Retained here only so a
    # stray unmapped "_w"-suffixed object still raises loudly rather than
    # falling through silently, matching the original spike's guard.
}
for _cover, _base in _COVER_BONE.items():
    PART_BONE[f"{_cover}0"] = f"{_base}_L"
    PART_BONE[f"{_cover}1"] = f"{_base}_R"
del _cover, _base


# --- standing bone topology (R0's own numbers, unchanged) ------------------

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

# --- kneeling bone topology (new this pass) ---------------------------------
#
# Derived from kit.py's kneeling branch, which -- unlike standing -- reads no
# per-frame state at all (stride is never consulted; the branch's every
# waypoint is a bare literal). Two independent derivations agree: hand
# arithmetic from the literal source, and a live probe of the built mesh's
# own vertex-ring centres (see module docstring; the report carries the
# actual probe transcript). hand=1.0 throughout -- every kneeling figure this
# pass ships uses mirror=False.
#
# Shared torso/arm code (torso, webbing, deltoid, arms, neck, head) is
# IDENTICAL between postures; only `drop` differs (0 for standing at
# stride=0, 0.30*H for kneeling, always). `_zk` applies that shift to the
# same kit.py fractions `_BASE_BONES` already uses, and the arm numbers below
# are the standing arm formula's own inputs (ay, fwd, elbow_z, wrist_z)
# re-evaluated at kneeling's drop -- probe-confirmed, not assumed.
_KNEEL_BONES = [
    ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
    ("pelvis", "root", (0.0, 0.0, _zk(kit.BELT_Z) - 0.09), (0.0, 0.0, _zk(kit.BELT_Z) + 0.05)),
    ("spine", "pelvis", (0.0, 0.0, _zk(kit.BELT_Z) + 0.05), (0.0, 0.0, _zk(kit.SHOULDER_Z) - 0.03)),
    ("neck", "spine", (0.0, 0.0, _zk(kit.HEAD_Z) - 0.155), (0.0, 0.0, _zk(kit.HEAD_Z) - 0.085)),
    ("head", "neck", (0.0, 0.0, _zk(kit.HEAD_Z) - 0.085), (0.0, 0.0, _zk(kit.HEAD_Z) + 0.115)),
    ("upperarm_L", "spine", (0.0, -0.245, 0.845), (-0.022, -0.249, 0.630)),
    ("forearm_L", "upperarm_L", (-0.022, -0.249, 0.630), (-0.029, -0.245, 0.400)),
    ("upperarm_R", "spine", (0.0, 0.225, 0.845), (0.062, 0.229, 0.660)),
    ("forearm_R", "upperarm_R", (0.062, 0.229, 0.660), (0.127, 0.225, 0.460)),
    # down/ground-contact leg: hip (high) -> knee-on-ground (low)
    ("thigh_r", "pelvis", (-0.100, -0.125, 0.400), (-0.200, -0.115, 0.100)),
    ("shin_r", "thigh_r", (-0.330, -0.110, 0.058), (0.050, -0.110, 0.058)),
    # front/planted leg: hip (high) -> knee -> ankle (low)
    ("thigh_f", "pelvis", (0.000, 0.122, 0.520), (0.150, 0.127, 0.440)),
    ("shin_f", "thigh_f", (0.150, 0.128, 0.400), (0.150, 0.125, 0.055)),
]


def _translate(table, dx, dy, prefix):
    out = []
    for name, parent, head, tail in table:
        h = (head[0] + dx, head[1] + dy, head[2])
        t = (tail[0] + dx, tail[1] + dy, tail[2])
        out.append((f"{prefix}_{name}", f"{prefix}_{parent}" if parent else None, h, t))
    return out


def _standing_bones(prefix, dx, dy):
    """Standing figure's bone table, translated to its rest placement, plus
    the two hip-fix bones (R0's fix for the one real rigid-binding failure
    it found -- see the original report; unchanged here)."""
    out = _translate(_BASE_BONES, dx, dy, prefix)
    thigh_by_name = {n: (h, t) for n, _p, h, t in _BASE_BONES}
    for base, side in (("hip_L", "thigh_L"), ("hip_R", "thigh_R")):
        th_head, th_tail = thigh_by_name[side]
        hx, hy, hz = th_head[0] + dx, th_head[1] + dy, th_head[2]
        vx = (th_tail[0] - th_head[0]) * 0.15
        vy = (th_tail[1] - th_head[1]) * 0.15
        vz = (th_tail[2] - th_head[2]) * 0.15
        out.append((f"{prefix}_{base}", f"{prefix}_pelvis", (hx, hy, hz), (hx + vx, hy + vy, hz + vz)))
    return out


def _kneel_bones(prefix, dx, dy):
    """Kneeling figure's bone table, translated to its rest placement. No
    hip-fix bones: kneeling never animates thighs in this pass (crew stay
    deployed and static through every authored clip -- see module
    docstring), so there is no swing to open a gap at."""
    return _translate(_KNEEL_BONES, dx, dy, prefix)


AXIS_Y = Vector((0.0, 1.0, 0.0))
AXIS_X = Vector((1.0, 0.0, 0.0))
AXIS_Z = Vector((0.0, 0.0, 1.0))


def local_quat_for_world_axis(bone, axis, angle):
    """A pose-bone-local rotation quaternion for a world-space axis+angle.

    Exact only when the bone's parent carries no pose rotation of its own at
    the same frame -- true for every bone this module keys on its own.
    """
    rot3 = bone.matrix_local.to_3x3()
    local_axis = (rot3.inverted() @ axis).normalized()
    return Quaternion(local_axis, angle)


def local_quat_for_world_axes(bone, axis_angles):
    """Compose several small world-axis rotations into ONE pose-bone-local
    quaternion, for a bone keyed on more than one axis in the same frame. A
    second bare `key()` call on the same bone in the same frame would
    REPLACE `rotation_quaternion` rather than add to it."""
    q = Quaternion((1.0, 0.0, 0.0, 0.0))
    for axis, angle in axis_angles:
        if angle == 0.0:
            continue
        q = local_quat_for_world_axis(bone, axis, angle) @ q
    return q


def local_offset_for_world_axis(bone, axis):
    """A pose-bone-local translation direction for a world-space axis. Used
    only for `root`'s vertical bob in `move`."""
    rot3 = bone.matrix_local.to_3x3()
    return rot3.inverted() @ axis


# --- naturalism pass (R0's own constants, unchanged) ------------------------

A_THIGH = 0.55
B_SHIN = 0.90
BREATH_AMP = 0.035
SWAY_AMP = 0.045
MOVE_LEAN = 0.14
HIP_TWIST_AMP = 0.10
SHOULDER_TWIST_AMP = 0.17
HEAD_COUNTER_FRAC = 0.65
BOB_AMP = 0.026
SETTLE_AMP = 0.16
SETTLE_WIDTH = 1.15
SHIN_SWING_SHIFT = 0.6
HEEL_L = math.pi + SHIN_SWING_SHIFT
HEEL_R = SHIN_SWING_SHIFT
A_ARM_FREE = 0.52
A_ARM_WEAPON = 0.20
ELBOW_FREE_AMP = 0.30
ELBOW_PHASE_SIGN = 1.0

FIRE_SHOULDER = -0.45
FIRE_ELBOW = 0.35
RECOIL_SHOULDER = -0.16
RECOIL_ELBOW = -0.10
RECOIL_SPINE = -0.05
FIRE_RISE = 0.16
FIRE_FRAMES = 6

MOVE_FRAMES = 16
IDLE_FRAMES = 32

#: charge_squad's own extra lean: teams.py's `lean = 24.0 if clip == "fire"
#: else 20.0` -- 20 degrees is baked into REST geometry (see
#: `_charge_squad_rest`); this is the remaining 4 degrees, keyed as a
#: constant (not a rise/decay impulse -- teams.py's own value is a flat
#: constant for the whole clip, not a recoil) on the ROOT bone, which has no
#: skinned vertices of its own and so rotates the whole leaning figure
#: rigidly with no new seam -- the same property `move`'s vertical bob
#: already relies on `root` for.
FIRE_ROOT_LEAN = {
    "charge_squad": {"chg0": math.radians(4.0), "chg1": math.radians(4.0)},
}


# --- weapon assembly (R0's own numbers, unchanged) --------------------------

def _weapon_anchor(at, yaw, posture, aim):
    """`kit.rifle()`'s own anchor formula, copied rather than called."""
    z = kit.POSTURE_EYE[posture] * kit.FIGURE_H - (0.10 if aim else 0.16)
    reach = 0.32 if aim else 0.16
    x0, y0, z0 = at
    c, s = math.cos(yaw), math.sin(yaw)
    return x0 + reach * c, y0 + reach * s, z0 + z


def _weapon_parts(prefix, at, yaw=0.0, posture="standing", aim=False):
    """A rifle built from actual sub-parts, all role="weapon", all bound as
    one rigid assembly to the firing hand -- see `_add_figure`."""
    gx, gy, gz = _weapon_anchor(at, yaw, posture, aim)
    c, s = math.cos(yaw), math.sin(yaw)

    def place(dx, dy, dz):
        return (gx + dx * c - dy * s, gy + dx * s + dy * c, gz + dz)

    return [
        kit.box(f"{prefix}_w_receiver", (0.34, 0.046, 0.050), place(0.03, 0.0, 0.0), role="weapon"),
        kit.tube(f"{prefix}_w_barrel", 0.30, 0.013, place(0.34, 0.0, 0.010), yaw=yaw, sides=8, role="weapon"),
        kit.box(f"{prefix}_w_sight_f", (0.014, 0.014, 0.055), place(0.47, 0.0, 0.045), role="weapon"),
        kit.box(f"{prefix}_w_sight_r", (0.035, 0.022, 0.035), place(-0.05, 0.0, 0.043), role="weapon"),
        kit.box(f"{prefix}_w_stock", (0.28, 0.032, 0.044), place(-0.30, 0.0, -0.010), role="weapon"),
        kit.box(f"{prefix}_w_grip", (0.026, 0.032, 0.095), place(-0.03, 0.0, -0.065), role="weapon"),
        kit.tube(f"{prefix}_w_mag", 0.20, 0.020, place(0.09, 0.0, -0.075), yaw=yaw, pitch=-0.5, sides=6, role="weapon"),
    ]


# --- per-team figure specs ---------------------------------------------------
#
# One entry per figure this pass rigs: bone-prefix (kept identical to the
# name `teams.py`'s own builder gives that figure, so PART_BONE's
# "prefix_suffix" split just works), rest (x, y), posture, headgear/loadout,
# leader flag, mirror, whether it walks in `move` ("animates" -- False for a
# crew-served figure that stays kneeling and static through every clip, and
# for `rpg_fire`, which teams.py pins to `stride=0.0` even during move), and
# which handheld weapon (if any) `_add_figure` should attach via
# `_weapon_parts`.
#
# Every (x, y) below is copied verbatim from `teams.py`'s own source, not
# re-derived -- REST_FIGURES's own discipline, carried forward.

def _f(prefix, x, y, posture="standing", headgear="helmet", loadout="regular",
       leader=False, mirror=False, animates=True, weapon=None):
    return dict(prefix=prefix, x=x, y=y, posture=posture, headgear=headgear,
                loadout=loadout, leader=leader, mirror=mirror,
                animates=animates, weapon=weapon)


#: sniper_team's own rest spacing -- copied verbatim from `teams.sniper_team`
#: (`close = 0.12 if clip in ("down","wreck") else 0.24`). `_sniper_rest`/
#: `build_sniper_clips` use these directly rather than re-deriving them.
SNIPER_CLOSE_IDLE = 0.24
SNIPER_CLOSE_DOWN = 0.12

#: `x`, and the SIGN `y` carries (`y = sign * close`) -- `role` says which of
#: the two props (`kit.sniper_rifle`/`kit.binoculars`) this figure carries,
#: matching `teams.sniper_team`'s own fixed pairing (`snp_a` always the
#: rifle, `snp_b` always the spotter).
SNIPER_SPECS = (
    {"prefix": "snp_a", "x": 0.10, "sign": -1.0, "role": "rifle"},
    {"prefix": "snp_b", "x": -0.24, "sign": 1.0, "role": "binos"},
)


TEAM_FIGURES = {
    "inf_squad": [
        _f("f0", 0.0, -0.78, weapon="rifle"),
        _f("f1", 0.20, 0.0, leader=True, weapon="rifle"),
        _f("f2", 0.0, 0.78, weapon="rifle"),
    ],
    "militia_cell": [
        _f("mil0", 0.0, -0.24, headgear="keffiyeh", loadout="irregular", leader=True, weapon="rifle"),
        _f("mil1", 0.12, 0.26, headgear="keffiyeh", loadout="irregular", weapon="rifle"),
    ],
    "charge_squad": [
        _f("chg0", 0.46, -0.06, headgear="keffiyeh", loadout="irregular"),
        _f("chg1", -0.46, 0.10, headgear="keffiyeh", loadout="irregular", mirror=True),
    ],
    "rpg_team": [
        _f("rpg_fire", 0.18, -0.26, headgear="keffiyeh", loadout="irregular", animates=False),
        _f("rpg_load", -0.30, 0.30, headgear="keffiyeh", loadout="irregular", leader=True, weapon="rifle"),
    ],
    "demo_squad": [
        _f("demo_a", 0.34, -0.16, posture="kneeling", animates=False),
        _f("demo_b", -0.36, 0.28, leader=True, weapon="rifle"),
    ],
    "at_team": [
        _f("at_fire", 0.24, -0.30, posture="kneeling", animates=False),
        _f("at_spot", -0.32, 0.34, leader=True),
    ],
    "mortar_team": [
        _f("mtr_crew0", -0.14, -0.54, posture="kneeling", animates=False),
        _f("mtr_crew1", -0.14, 0.54, posture="kneeling", animates=False),
        _f("mtr_no3", -0.62, 0.0, leader=True, weapon="rifle"),
    ],
    "mortar_crew": [
        _f("emtr_crew0", -0.16, -0.40, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False),
        _f("emtr_crew1", -0.16, 0.42, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False),
    ],
    "atgm_cell": [
        _f("atgm_crew0", -0.34, -0.40, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False),
        _f("atgm_crew1", -0.34, 0.44, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False),
    ],
    # sniper_team is NOT built through `_add_figure` (see `_sniper_rest`) --
    # its own `posture` varies BY CLIP (prone for idle/fire, standing for
    # move), which `_add_figure`'s one-living-posture-per-figure assumption
    # cannot express. These entries exist only so `figure_prefixes` (used by
    # `rig_parts` to bind the STANDING body's own parts, still built via
    # plain `kit.figure()`) and `_check_team_figures_against_teams` have
    # something to read; `x`/`y` are `SNIPER_SPECS`' own rest position at
    # `SNIPER_CLOSE_IDLE`, matching `teams.sniper_team`'s "move" spacing.
    "sniper_team": [
        _f(s["prefix"], s["x"], s["sign"] * SNIPER_CLOSE_IDLE, posture="standing")
        for s in SNIPER_SPECS
    ],
    "yahalom_squad": [
        _f("yah_a", 0.30, -0.20, leader=True),
        _f("yah_b", -0.34, 0.26, weapon="rifle"),
    ],
    # `dig` stays kneeling through idle/move/fire in this pass rather than
    # standing to relocate for `move` the way `teams.digger_crew` itself
    # does (`_crew_posture`'s own kneeling/prone split, plus a THIRD
    # standing-for-move posture no other crew figure needs) -- a deliberate
    # simplification, not an oversight; see this task's report.
    "digger_crew": [
        _f("dig", -0.34, 0.04, posture="kneeling", headgear="keffiyeh",
           loadout="irregular", animates=False),
    ],
}


def _check_team_figures_against_teams():
    """Cheap, always-on self-check: every prefix in TEAM_FIGURES must be a
    real figure this pass can bind (posture standing/kneeling only), and
    every team must exist in teams.TEAMS with the faction this file expects
    -- catches an obvious transcription slip loudly, at import time, rather
    than a silent stale export. Positions are additionally cross-checked
    against teams.py's own ACTUAL BUILT geometry by a separate, throwaway
    Blender probe (not run on every import -- see the report), which is the
    stronger check; this one is the cheap always-on floor.
    """
    expect_faction = {
        "inf_squad": "kdf", "militia_cell": "enemy", "demo_squad": "kdf",
        "charge_squad": "enemy", "at_team": "kdf", "rpg_team": "enemy",
        "mortar_team": "kdf", "mortar_crew": "enemy", "atgm_cell": "enemy",
        "sniper_team": "kdf", "yahalom_squad": "kdf", "digger_crew": "enemy",
    }
    for team_id, figures in TEAM_FIGURES.items():
        assert team_id in teams.TEAMS, f"{team_id} missing from teams.TEAMS"
        assert teams.TEAMS[team_id][1] == expect_faction[team_id], (
            f"{team_id}'s faction changed in teams.py -- expected "
            f"{expect_faction[team_id]!r}, teams.py now says "
            f"{teams.TEAMS[team_id][1]!r}"
        )
        for spec in figures:
            assert spec["posture"] in ("standing", "kneeling"), spec
    assert set(SUPPORTED_TEAMS) == set(TEAM_FIGURES), "SUPPORTED_TEAMS/TEAM_FIGURES drifted apart"


_check_team_figures_against_teams()


def _death_root_bone(prefix, x, y):
    """A single, never-rotated bone owning one figure's whole prone corpse --
    the same "no hand to bind to, so bind the whole assembly to one rigid
    mount" convention `_prop_bone` already established for a free-standing
    crew weapon, applied here to a free-standing body. No parent: it must
    scale independently of the figure's own `root`, which is exactly the
    point -- see `_key_death_visibility`."""
    return (f"{prefix}_death_root", None, (x, y, 0.0), (x, y, 0.30))


def _figure_death_parts(spec):
    """One figure's prone corpse -- fresh `kit.figure(posture="prone")`
    geometry, independent of the figure's own LIVING posture (a kneeling
    mortar gunner still goes flat, matching `teams._crew_posture`'s own
    "prone" answer for down/wreck). Named `{prefix}_death_*` rather than
    reusing the living figure's own part names -- collision-avoidance kept
    explicit rather than relying on Blender's automatic `.001` renaming,
    which would still bind correctly (binding is by object identity via
    `forced_bone`, never by name) but reads as an accident rather than a
    decision.

    No weapon, no antenna (`kit.figure`'s own prone branch returns before
    its `leader` block runs, so `leader` is not even passed here) -- a
    generic fallen-soldier body, not a per-team recreation of every prop a
    living figure carries. `moto_rpg`'s existing `wreck` clip already ships
    exactly this simplification for its own thrown riders (prone `kit.figure`
    calls with no weapon), so this is the established shape for a corpse in
    this project, not a new one.
    """
    return kit.figure(
        f"{spec['prefix']}_death", (spec["x"], spec["y"], 0.0), posture="prone",
        yaw=0.0, headgear=spec["headgear"], stride=0.0, mirror=spec["mirror"],
        loadout=spec["loadout"], smoke=None,
    )


def _add_figure(spec):
    """One figure -- geometry, bone table, and (if it carries one) its rigid
    weapon assembly, plus its prone death-state geometry and bone. Returns
    (parts, bone_table_entries, forced_bone)."""
    parts = kit.figure(
        spec["prefix"], (spec["x"], spec["y"], 0.0), posture=spec["posture"],
        yaw=0.0, headgear=spec["headgear"], stride=0.0, arms=True,
        leader=spec["leader"], mirror=spec["mirror"], loadout=spec["loadout"],
        smoke=None,
    )
    if spec["posture"] == "standing":
        bones = _standing_bones(spec["prefix"], spec["x"], spec["y"])
    else:
        bones = _kneel_bones(spec["prefix"], spec["x"], spec["y"])
    forced = {}
    if spec["weapon"] == "rifle":
        wp = _weapon_parts(spec["prefix"], (spec["x"], spec["y"], 0.0),
                            posture=spec["posture"], aim=False)
        parts += wp
        for ob in wp:
            forced[ob] = f"{spec['prefix']}_forearm_R"
    death_parts = _figure_death_parts(spec)
    death_bone = _death_root_bone(spec["prefix"], spec["x"], spec["y"])
    bones.append(death_bone)
    for ob in death_parts:
        forced[ob] = death_bone[0]
    parts += death_parts
    return parts, bones, forced


# --- team-specific extras: props with no hand to bind to, and charge_squad's
# --- own vest/satchel/lean geometry -----------------------------------------

def _prop_bone(at, height=0.30):
    """A single static, never-keyed bone for a ground-mounted crew weapon --
    see the module docstring's "free-standing crew weapon" note. Parented to
    nothing: it never moves, so it needs no parent to move rigidly with."""
    x, y, z = at
    return ("prop", None, (x, y, z), (x, y, z + height))


def _demo_extras():
    """demo_squad's satchel charge (ground, static -- bound to the team's
    own `prop` bone) and cable spool (carried by demo_b -- bound to
    demo_b's own spine, so it leans/twists with the figure that carries it
    through `move`, the same "worn kit follows the torso" read every other
    webbing part in PART_BONE already gets)."""
    charge = kit.demo_charge("demo_charge", (0.76, -0.16, 0.0))
    spool = kit.cable_spool("demo_spool", (-0.36, 0.28, 0.0))
    forced = {ob: "prop" for ob in charge}
    forced.update({ob: "demo_b_spine" for ob in spool})
    return charge + spool, [_prop_bone((0.76, -0.16, 0.10))], forced


def _at_extras():
    """at_team's Spike tube -- "held", per teams.py's own description, so it
    rides at_fire's forearm_R exactly like a rifle -- and the spotter's
    binoculars, bound to at_spot's head (they're raised near eye level, and
    the small sway a breathing head keys in `idle` is the right amount of
    motion for them)."""
    tube = kit.launcher("at_tube", (0.24, -0.30, 1.02), pitch=0.0, length=1.16)
    binos = kit.binoculars("at_binos", (-0.32, 0.34, 0.0), posture="standing")
    forced = {ob: "at_fire_forearm_R" for ob in tube}
    forced.update({ob: "at_spot_head" for ob in binos})
    return tube + binos, [], forced


def _rpg_extras():
    """rpg_team's tube, held by rpg_fire the same way at_team's is."""
    tube = kit.launcher("rpg_tube", (0.18, -0.26, 1.46),
                         pitch=math.radians(38.0), length=1.24, radius=0.075)
    return tube, [], {ob: "rpg_fire_forearm_R" for ob in tube}


def _mortar_team_extras():
    tube = kit.mortar("mtr_tube", (0.26, 0.0, 0.0), length=1.02)
    return tube, [_prop_bone((0.26, 0.0, 0.10), 0.40)], {ob: "prop" for ob in tube}


def _mortar_crew_extras():
    tube = kit.mortar("emtr_tube", (0.22, 0.0, 0.0), length=0.76)
    return tube, [_prop_bone((0.22, 0.0, 0.10), 0.35)], {ob: "prop" for ob in tube}


def _atgm_extras():
    post = kit.atgm_tripod("atgm_post", (0.24, 0.0, 0.0))
    return post, [_prop_bone((0.24, 0.0, 0.20), 0.45)], {ob: "prop" for ob in post}


def _yahalom_extras():
    """yah_a's ground-penetrating mast -- "held", the same convention
    `_at_extras`/`_rpg_extras` already use for a launcher: bound to the
    carrier's own `forearm_R`, so it auto-hides with the rest of yah_a in
    `down`/`wreck` exactly as `teams.yahalom_squad`'s own
    `_weapon_visible(clip)` gate intends. Both figures' packs are worn kit,
    bound to `spine` -- the prone corpse's own pack needs no extra part at
    all, since `kit.figure`'s prone branch already builds one
    (`teams.yahalom_squad`'s own comment: "Prone figures mould their own
    pack"). `work`, this team's own sixth clip (mast driven into the
    ground), is not built here -- see the module docstring."""
    A, B = (0.30, -0.20, 0.0), (-0.34, 0.26, 0.0)
    # kit.tube/kit.box each return ONE Object, not a list -- unlike
    # kit.launcher/kit.mortar/etc, which build a multi-part assembly.
    # teams.py's own yahalom_squad wraps both in a list for exactly this
    # reason (`out += [kit.tube(...)]`, `out += [kit.box(...)]`).
    mast = [kit.tube("yah_mast", 1.45, 0.030, (0.62, -0.20, 0.74), yaw=0.0, pitch=0.0)]
    head = [kit.box("yah_head", (0.16, 0.10, 0.04), (1.30, -0.20, 0.74))]
    pack_a = [teams._yah_pack("yah_pack_a", A)]
    pack_b = [teams._yah_pack("yah_pack_b", B)]
    forced = {ob: "yah_a_forearm_R" for ob in (mast + head)}
    forced.update({ob: "yah_a_spine" for ob in pack_a})
    forced.update({ob: "yah_b_spine" for ob in pack_b})
    return mast + head + pack_a + pack_b, [], forced


def _digger_extras():
    """The spoil heap -- ground, not kit (`teams.digger_crew`'s own comment:
    "spoil does not go prone when the digger does"), so unlike every other
    extra in this module it must NOT be hidden by ANY clip's visibility
    keying. Bound to a dedicated `ground` bone that no clip builder ever
    touches -- see `_key_death_visibility`'s own reasoning for why a bone
    with no keyframe on a channel in ANY action is the one safe way to get a
    truly constant value, rather than a bone keyed 1 in some clips and left
    to chance in others."""
    heap = [
        kit.blob("dig_heap", (0.36, -0.06, 0.14), 0.45,
                 squash=(1.0, 0.85, 0.62), wobble=0.12, role="wood"),
        kit.blob("dig_heap_b", (0.52, 0.26, 0.08), 0.28,
                 squash=(1.0, 0.9, 0.62), wobble=0.10, role="wood"),
        kit.blob("dig_heap_c", (0.14, 0.30, 0.06), 0.20,
                 squash=(0.9, 1.0, 0.6), wobble=0.10, role="wood"),
    ]
    ground_bone = ("ground", None, (0.30, 0.10, 0.0), (0.30, 0.10, 0.30))
    return heap, [ground_bone], {ob: "ground" for ob in heap}


TEAM_EXTRAS = {
    "demo_squad": _demo_extras,
    "at_team": _at_extras,
    "rpg_team": _rpg_extras,
    "mortar_team": _mortar_team_extras,
    "mortar_crew": _mortar_crew_extras,
    "atgm_cell": _atgm_extras,
    "yahalom_squad": _yahalom_extras,
    "digger_crew": _digger_extras,
}


def _charge_squad_rest():
    """charge_squad's own geometry, built directly rather than through
    `_add_figure`: `teams.charge_squad`'s vest_f/vest_b and (figure 1 only)
    the satchel are appended to the figure's own part list BEFORE the sprint
    lean is applied, so all three rotate together -- copied in that order.
    `teams._lean_forward` is imported and called, not reimplemented: it is
    the exact function `teams.py`'s own charge_squad uses, operating on
    finished vertex data (never on the not-yet-existing bones), so baking it
    at REST time here and animating on top of it afterward is the same
    operation the sprite pipeline performs once per frame, done once here
    because kneeling/standing figures in this pass never change posture
    across clips. No weapon: "no weapon parts at all" is teams.py's own
    line, and the tell IS the absence.

    The death-state corpse (`_figure_death_parts`) is built AFTER the lean is
    applied to `fig`, and is not itself leaned -- a fallen body is prone, not
    sprinting, and it carries no vest/satchel either, the same generic-corpse
    simplification `_add_figure` uses for everyone else.
    """
    parts = []
    bone_table = []
    forced = {}
    for spec in TEAM_FIGURES["charge_squad"]:
        prefix, x, y = spec["prefix"], spec["x"], spec["y"]
        fig = kit.figure(prefix, (x, y, 0.0), posture="standing", yaw=0.0,
                          headgear=spec["headgear"], stride=0.0, arms=True,
                          leader=False, mirror=spec["mirror"],
                          loadout=spec["loadout"], smoke=None)
        fig.append(kit.rot_z(f"{prefix}_vest_f", (0.10, 0.26, 0.32),
                              (x + 0.16, y, 0.60), 0.0, "charge"))
        fig.append(kit.rot_z(f"{prefix}_vest_b", (0.09, 0.26, 0.28),
                              (x - 0.15, y, 0.62), 0.0, "charge"))
        if prefix == "chg1":
            sat = kit.box("chg_satchel", (0.26, 0.18, 0.20),
                           (x - 0.12, y + 0.19, 0.74), "charge")
            fig.append(sat)
            forced[sat] = f"{prefix}_spine"
        teams._lean_forward(fig, 20.0, at_x=x)
        parts += fig
        bone_table += _standing_bones(prefix, x, y)
        death_parts = _figure_death_parts(spec)
        death_bone = _death_root_bone(prefix, x, y)
        bone_table.append(death_bone)
        for ob in death_parts:
            forced[ob] = death_bone[0]
        parts += death_parts
    return parts, bone_table, forced


def _sniper_rest():
    """sniper_team's own geometry -- TWO bones per figure, neither of them
    the generic `root`/`death_root` corpse pair `_add_figure` gives every
    other team, because `teams.sniper_team` treats prone as the LIVING pose
    (idle/fire), not a death state: its own `down`/`wreck` is the SAME prone
    build, tightened (`close` 0.24 -> 0.12), never a different pose ("`down`
    cannot be 'go prone' here, since idle already is" -- `teams.py`'s own
    docstring for this team).

    So each figure gets:

      * a STANDING rig (`_standing_bones`, `root`), built and bound exactly
        like `_add_figure` would, used ONLY by `move` -- the one clip this
        team stands up for;
      * a PRONE rig -- one bone (`_death_root_bone`, reusing the name and
        shape `_add_figure`'s corpse already uses, though it is not a
        corpse here), the whole `kit.figure(posture="prone")` assembly plus
        this figure's own prop (`kit.sniper_rifle` for `snp_a`,
        `kit.binoculars` for `snp_b`) bound to it rigidly. Built ONCE, at
        `SNIPER_CLOSE_IDLE` rest spacing; `build_sniper_clips` reuses this
        SAME geometry for `down`/`wreck` via a bone-local translation
        rather than a third build, matching how the sprite pipeline itself
        never rebuilds geometry for the tighter spacing either.

    The standing rifle/binoculars (`move` only, since a relocating sniper
    still carries its gear) bind to `spine`/`head` respectively -- "worn
    kit follows the torso" (`spine`, matching `_demo_extras`' cable spool)
    for the slung rifle, and `head` (matching `_at_extras`' binoculars) for
    optics raised near eye level.
    """
    parts, bone_table, forced = [], [], {}
    for spec in SNIPER_SPECS:
        prefix, x, sign, role = spec["prefix"], spec["x"], spec["sign"], spec["role"]
        y = sign * SNIPER_CLOSE_IDLE

        fig = kit.figure(prefix, (x, y, 0.0), posture="standing", stride=0.0)
        bone_table += _standing_bones(prefix, x, y)
        if role == "rifle":
            prop = kit.sniper_rifle(f"{prefix}_rifle", (x, y, 0.0), posture="standing")
            prop_bone = f"{prefix}_spine"
        else:
            prop = kit.binoculars(f"{prefix}_binos", (x, y, 0.0), posture="standing")
            prop_bone = f"{prefix}_head"
        for ob in prop:
            forced[ob] = prop_bone
        parts += fig + prop

        death_bone = _death_root_bone(prefix, x, y)
        prone_fig = kit.figure(f"{prefix}_death", (x, y, 0.0), posture="prone", stride=0.0)
        if role == "rifle":
            prone_prop = kit.sniper_rifle(f"{prefix}_death_rifle", (x, y, 0.0), posture="prone")
        else:
            prone_prop = kit.binoculars(f"{prefix}_death_binos", (x, y, 0.0), posture="prone")
        bone_table.append(death_bone)
        for ob in prone_fig + prone_prop:
            forced[ob] = death_bone[0]
        parts += prone_fig + prone_prop
    return parts, bone_table, forced


def build_team_rest(team_id):
    """Fresh scene: every figure's rest geometry for `team_id`, all bone
    tables, and any team-specific extras (props, charge_squad's own
    vest/lean geometry)."""
    assert team_id in SUPPORTED_TEAMS, (
        f"rig.py does not cover {team_id!r} -- see SUPPORTED_TEAMS and this "
        "module's own docstring for what's out of scope and why"
    )
    kit.new_scene()
    parts, bone_table, forced_bone = [], [], {}
    if team_id == "charge_squad":
        p, b, f = _charge_squad_rest()
        parts += p
        bone_table += b
        forced_bone.update(f)
    elif team_id == "sniper_team":
        p, b, f = _sniper_rest()
        parts += p
        bone_table += b
        forced_bone.update(f)
    else:
        for spec in TEAM_FIGURES[team_id]:
            p, b, f = _add_figure(spec)
            parts += p
            bone_table += b
            forced_bone.update(f)
    extras_fn = TEAM_EXTRAS.get(team_id)
    if extras_fn:
        p, b, f = extras_fn()
        parts += p
        bone_table += b
        forced_bone.update(f)
    return parts, bone_table, forced_bone


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
        b.align_roll(AXIS_Y)
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def rig_parts(parts, arm_obj, forced_bone, figure_prefixes):
    """Rigid bind: one part -> one vertex group -> one bone, weight 1.0.

    `forced_bone` (object identity -> bone name) is checked first -- every
    free-standing prop and every weapon assembly is entered there explicitly
    by the code that built it, rather than matched by name pattern. Anything
    left over is bound by the standard "prefix_suffix" split against
    PART_BONE; anything that resolves to neither raises loudly.

    **The split is against `figure_prefixes`, not the first underscore.**
    `inf_squad`'s own prefixes ("f0", "f1", "f2") happen to contain no
    underscore, so `obj.name.partition("_")` used to work by accident -- and
    broke the instant a team with a real prefix (`demo_a`, `at_fire`,
    `mtr_crew0`, all copied verbatim from `teams.py`) was rigged: every part
    of `demo_a`/`demo_b` came back unmapped, because partitioning
    "demo_a_shin_r" on its first underscore gives prefix "demo", not
    "demo_a". Caught by actually running the export, not by reading the
    code -- exactly the standard this file's own docstring asks for.
    `figure_prefixes` is sorted longest-first so a prefix that is itself a
    prefix of another (none in this pass, but nothing prevents it later)
    cannot match short.
    """
    ordered_prefixes = sorted(figure_prefixes, key=len, reverse=True)
    unmapped = []
    for obj in parts:
        bone_name = forced_bone.get(obj)
        if bone_name is None:
            prefix = next((p for p in ordered_prefixes
                           if obj.name == p or obj.name.startswith(p + "_")), None)
            suffix = obj.name[len(prefix) + 1:] if prefix else obj.name
            base = PART_BONE.get(suffix)
            if prefix is None or base is None:
                unmapped.append(obj.name)
                continue
            bone_name = f"{prefix}_{base}"
        vg = obj.vertex_groups.new(name=bone_name)
        vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        mod = obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj
        mod.use_vertex_groups = True
        obj.parent = arm_obj
        obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    if unmapped:
        raise RuntimeError(f"unmapped parts, PART_BONE is stale: {unmapped}")


def join_by_role(parts):
    """One skinned mesh per `rl_role`."""
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
        pb.location = (0.0, 0.0, 0.0)


def key(pb, bone, axis, angle, frame):
    pb.rotation_quaternion = local_quat_for_world_axis(bone, axis, angle)
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def key_axes(pb, bone, axis_angles, frame):
    pb.rotation_quaternion = local_quat_for_world_axes(bone, axis_angles)
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def _new_action(arm_obj, name):
    """A fresh, self-contained action. Every pose bone gets an explicit
    identity keyframe at frame 0 -- see the original report for the bug this
    fixes: a bone an action never touches otherwise keeps whatever value the
    last-built action left in memory."""
    reset_pose(arm_obj)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    arm_obj.animation_data.action = action
    for pb in arm_obj.pose.bones:
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.keyframe_insert(data_path="rotation_quaternion", frame=0)
        pb.location = (0.0, 0.0, 0.0)
        pb.keyframe_insert(data_path="location", frame=0)
    return action


def _key_scale(pb, value, frames):
    """A uniform-scale keyframe on `pb`, at every frame in `frames` -- always
    more than one so the resulting fcurve has a real (if tiny) time range
    rather than a single sample. See `_key_death_visibility` for why this
    matters."""
    pb.scale = (value, value, value)
    for frame in frames:
        pb.keyframe_insert(data_path="scale", frame=frame)


#: Frames every death-visibility scale key is set at. Two, not one: a
#: single-keyframe fcurve gives the WHOLE action a (0, 0) frame_range unless
#: something else in it spans more frames, which `down`/`wreck` -- entirely
#: static, nothing else keyed -- never do. Both idle/move/fire (which already
#: span many frames from their own gait/breath/recoil keys) and down/wreck
#: use the same two frames for the same reason `_new_action`'s own frame-0
#: identity keys exist: every action must be self-contained, never relying on
#: a channel a DIFFERENT, previously-played action happened to leave behind.
_VIS_FRAMES = (0, 1)


def _key_death_visibility(pbones, figures, has_prop, alive, frame=0):
    """Explicit scale keys for every figure's `root`/`death_root` (and the
    team's shared `prop` bone, if it has one) -- the switch that actually
    hides whichever rig, living or dead, is not this clip's.

    Every clip calls this, not just `down`/`wreck` -- the runtime
    (`applyMeshClip`, `packages/render/src/three/units/mesh-unit.ts`, not
    this task's to touch) stops every OTHER action on a clip switch but does
    not reset the bone transforms it leaves behind, so a bone this clip's own
    action never keys keeps whatever a PREVIOUSLY PLAYED clip last set it to
    -- the exact leftover-value bug `_new_action`'s own docstring names for
    rotation, applied here to scale. `frame` is accepted (default 0) so a
    future clip could vary it over time; every caller today passes only the
    default, and `_key_scale` still keys `_VIS_FRAMES` around it so the
    action's own time range stays well-formed regardless.
    """
    alive_scale = 1.0 if alive else 0.0
    dead_scale = 0.0 if alive else 1.0
    for spec in figures:
        prefix = spec["prefix"]
        _key_scale(pbones[f"{prefix}_root"], alive_scale, _VIS_FRAMES)
        _key_scale(pbones[f"{prefix}_death_root"], dead_scale, _VIS_FRAMES)
    if has_prop:
        _key_scale(pbones["prop"], alive_scale, _VIS_FRAMES)


def build_idle_clip(arm_obj, figures):
    """Breath + weight shift, every figure regardless of posture -- a
    kneeling gunner still breathes. Unchanged formula from R0, applied
    generically to whichever team's figures are passed in."""
    _new_action(arm_obj, "idle")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=True)
    for f in range(0, IDLE_FRAMES + 1):
        t = f / IDLE_FRAMES
        ph = 2.0 * math.pi * t
        breathe = BREATH_AMP * math.sin(ph)
        sway = SWAY_AMP * math.sin(ph + 1.1)
        for spec in figures:
            prefix = spec["prefix"]
            key(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"], AXIS_Y, breathe, f)
            key(pbones[f"{prefix}_pelvis"], bones[f"{prefix}_pelvis"], AXIS_X, sway, f)


def _settle_bump(phase, heel_phase, width, amp):
    d = (phase - heel_phase) % (2.0 * math.pi)
    if d > width:
        return 0.0
    return amp * 0.5 * (1.0 - math.cos(2.0 * math.pi * d / width))


def build_move_clip(arm_obj, figures):
    """Full gait -- thigh/shin/arm swing, weight transfer, settle, head
    stabilisation, vertical bob -- for every figure that walks
    (`spec["animates"]`). A crew-served figure (kneeling, or `rpg_fire`,
    whose own `stride` teams.py pins to 0.0 even in `move`) gets NO keys
    here at all and so stays at `move`'s own frame-0 identity pose for the
    whole clip -- correctly: "crew-served weapons stay deployed through
    move" (teams.py's own module docstring) means the whole figure stays
    put, not just its weapon.
    """
    _new_action(arm_obj, "move")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=True)
    walkers = [s for s in figures if s["animates"]]
    if not walkers:
        return
    root_bob_dir = local_offset_for_world_axis(bones[f"{walkers[0]['prefix']}_root"], AXIS_Z)
    for f in range(0, MOVE_FRAMES + 1):
        phase = 2.0 * math.pi * f / MOVE_FRAMES
        thigh_l = A_THIGH * math.sin(phase)
        thigh_r = -A_THIGH * math.sin(phase)
        shin_l = B_SHIN * max(0.0, math.sin(phase - SHIN_SWING_SHIFT))
        shin_r = B_SHIN * max(0.0, math.sin(phase + math.pi - SHIN_SWING_SHIFT))
        shin_l += _settle_bump(phase, HEEL_L, SETTLE_WIDTH, SETTLE_AMP)
        shin_r += _settle_bump(phase, HEEL_R, SETTLE_WIDTH, SETTLE_AMP)
        arm_l = -A_ARM_FREE * math.sin(phase)
        arm_r = A_ARM_WEAPON * math.sin(phase)
        elbow_l = ELBOW_FREE_AMP * max(0.0, ELBOW_PHASE_SIGN * math.sin(phase))
        hip_twist = HIP_TWIST_AMP * math.sin(phase)
        shoulder_twist = -SHOULDER_TWIST_AMP * math.sin(phase)
        head_counter = -HEAD_COUNTER_FRAC * shoulder_twist
        bob = -BOB_AMP * math.cos(2.0 * phase)
        for spec in walkers:
            prefix = spec["prefix"]
            key(pbones[f"{prefix}_thigh_L"], bones[f"{prefix}_thigh_L"], AXIS_Y, thigh_l, f)
            key(pbones[f"{prefix}_thigh_R"], bones[f"{prefix}_thigh_R"], AXIS_Y, thigh_r, f)
            key(pbones[f"{prefix}_shin_L"], bones[f"{prefix}_shin_L"], AXIS_Y, shin_l, f)
            key(pbones[f"{prefix}_shin_R"], bones[f"{prefix}_shin_R"], AXIS_Y, shin_r, f)
            key(pbones[f"{prefix}_upperarm_L"], bones[f"{prefix}_upperarm_L"], AXIS_Y, arm_l, f)
            key(pbones[f"{prefix}_upperarm_R"], bones[f"{prefix}_upperarm_R"], AXIS_Y, arm_r, f)
            key(pbones[f"{prefix}_forearm_L"], bones[f"{prefix}_forearm_L"], AXIS_Y, elbow_l, f)
            key(pbones[f"{prefix}_hip_L"], bones[f"{prefix}_hip_L"], AXIS_Y, thigh_l * 0.5, f)
            key(pbones[f"{prefix}_hip_R"], bones[f"{prefix}_hip_R"], AXIS_Y, thigh_r * 0.5, f)
            key_axes(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"],
                     [(AXIS_Y, MOVE_LEAN), (AXIS_Z, shoulder_twist)], f)
            key(pbones[f"{prefix}_pelvis"], bones[f"{prefix}_pelvis"], AXIS_Z, hip_twist, f)
            key(pbones[f"{prefix}_head"], bones[f"{prefix}_head"], AXIS_Z, head_counter, f)
            pb_root = pbones[f"{prefix}_root"]
            pb_root.location = root_bob_dir * bob
            pb_root.keyframe_insert(data_path="location", frame=f)


def _recoil_curve(p):
    if p <= FIRE_RISE:
        t = p / FIRE_RISE
    else:
        t = 1.0 - (p - FIRE_RISE) / (1.0 - FIRE_RISE)
    return max(0.0, t)


def build_fire_clip(arm_obj, figures, extra_root_lean=None):
    """Raise + recoil, for every figure carrying a hand-bound rifle. Plus,
    if `extra_root_lean` names any prefixes (charge_squad only), a flat
    extra forward lean on `root` for those prefixes -- see FIRE_ROOT_LEAN's
    own comment for why this is a constant, not an impulse.

    Deliberately NOT applied to a figure whose weapon is a free-standing
    ground mount (mortar, ATGM tripod) or whose held launcher's own position
    teams.py never varies by clip (at_fire, rpg_fire) -- raising their arms
    without a correspondingly-moving weapon would read as wrong, and the
    source of truth (teams.py's own call sites) says nothing moves there
    either. See the module docstring's closing paragraph.
    """
    _new_action(arm_obj, "fire")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=True)
    shooters = [s for s in figures if s["weapon"] == "rifle"]
    leaners = extra_root_lean or {}
    for f in range(0, FIRE_FRAMES + 1):
        p = f / FIRE_FRAMES
        kick = _recoil_curve(p)
        for spec in shooters:
            prefix = spec["prefix"]
            key(pbones[f"{prefix}_upperarm_R"], bones[f"{prefix}_upperarm_R"], AXIS_Y,
                FIRE_SHOULDER + RECOIL_SHOULDER * kick, f)
            key(pbones[f"{prefix}_forearm_R"], bones[f"{prefix}_forearm_R"], AXIS_Y,
                FIRE_ELBOW + RECOIL_ELBOW * kick, f)
            key(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"], AXIS_Y,
                RECOIL_SPINE * kick, f)
        for prefix, extra in leaners.items():
            key(pbones[f"{prefix}_root"], bones[f"{prefix}_root"], AXIS_Y, extra, f)


def build_death_clip(arm_obj, team_id, clip_name):
    """`down`/`wreck`: every figure's living `root` collapses to invisible
    and its separate prone `death_root` geometry (see `_figure_death_parts`)
    takes over instead. `down` and `wreck` call this with different
    `clip_name`s but are otherwise IDENTICAL -- matching `teams.py`'s own
    sprite-side convention, where `_standing_posture` already answers
    "prone" for both clips alike, with no further distinction.

    A single STATIC frame, deliberately not an animated collapse, for a
    concrete reason rather than by default: the runtime
    (`applyMeshClip`/`THREE.AnimationAction`, `packages/render/src/three/
    units/mesh-unit.ts`, outside this task's remit) plays every clip on
    three.js's default infinite `LoopRepeat` and never resets a stopped
    action's bones on its own. A one-way standing-to-prone transition does
    not end where it began, so looping it would flip the figure back and
    forth between the two poses forever rather than settling -- the exact
    failure a loop-safe clip (every OTHER clip this module builds already
    returns to its own frame-0 value at its final frame) avoids by
    construction. This task's own brief: "a correct static pose beats a bad
    animation" -- this is that trade-off, made for a verified reason.
    """
    _new_action(arm_obj, clip_name)
    pbones = arm_obj.pose.bones
    figures = TEAM_FIGURES[team_id]
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=False)


def build_sniper_clips(arm_obj):
    """sniper_team's own five clips -- bespoke, not `build_idle_clip`/
    `build_move_clip`/`build_fire_clip`/`build_death_clip`'s
    living-root/dead-root shape, because for THIS team the "dead" bone
    (`death_root`, see `_sniper_rest`) is the primary LIVING pose, and which
    bone is visible flips per clip in a way no other team's does.

    `idle` and `fire` are IDENTICAL in `teams.py` (same `close`, same
    `posture`, and `kit.sniper_rifle` takes no `aim` parameter at all --
    unlike `kit.rifle`, this team's weapon has no distinct firing pose), so
    one loop builds both. `move` reuses `build_move_clip` UNCHANGED: the
    standing rig it walks is the exact same `_standing_bones` topology
    every other team's `move` already animates, and that function's own
    `_key_death_visibility` call correctly makes `root` the visible side
    for `move`, `death_root` the visible side otherwise, on THIS team as on
    every other -- the inversion is only in what those two bones each
    contain, not in the visibility mechanism itself.

    `down`/`wreck` reuse the SAME prone geometry `idle`/`fire` already show,
    translated inward via each figure's own `death_root` LOCATION -- the
    bone-local equivalent of `teams.py`'s `close` 0.24 -> 0.12, expressed as
    a pose rather than a rebuild, exactly as `_sniper_rest`'s docstring
    describes.
    """
    figures = [dict(prefix=s["prefix"], animates=True) for s in SNIPER_SPECS]

    build_move_clip(arm_obj, figures)

    bones = arm_obj.data.bones
    delta = SNIPER_CLOSE_DOWN - SNIPER_CLOSE_IDLE
    for clip_name in ("idle", "fire", "down", "wreck"):
        _new_action(arm_obj, clip_name)
        pbones = arm_obj.pose.bones
        _key_death_visibility(pbones, figures, False, alive=False)
        if clip_name not in ("down", "wreck"):
            continue
        for spec in SNIPER_SPECS:
            prefix = spec["prefix"]
            pb = pbones[f"{prefix}_death_root"]
            offset_dir = local_offset_for_world_axis(bones[f"{prefix}_death_root"], AXIS_Y)
            pb.location = offset_dir * (spec["sign"] * delta)
            pb.keyframe_insert(data_path="location", frame=0)
            pb.keyframe_insert(data_path="location", frame=1)


def build_clips(arm_obj, team_id):
    if team_id == "sniper_team":
        build_sniper_clips(arm_obj)
        return
    figures = TEAM_FIGURES[team_id]
    build_idle_clip(arm_obj, figures)
    build_move_clip(arm_obj, figures)
    shooters = [s for s in figures if s["weapon"] == "rifle"]
    leaners = FIRE_ROOT_LEAN.get(team_id)
    if shooters or leaners:
        build_fire_clip(arm_obj, figures, leaners)
    build_death_clip(arm_obj, team_id, "down")
    build_death_clip(arm_obj, team_id, "wreck")
    # `work`: only `teams.TEAM_CLIP_ADD` scopes it to yahalom_squad, which
    # this pass does not build (see the module docstring).


def export_glb(arm_obj, path):
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
        export_materials="NONE",
        export_rest_position_armature=True,
    )


def build_and_export(team_id=DEFAULT_TEAM, out_path=None):
    parts, bone_table, forced_bone = build_team_rest(team_id)
    arm_obj = build_armature(bone_table)
    figure_prefixes = {spec["prefix"] for spec in TEAM_FIGURES[team_id]}
    rig_parts(parts, arm_obj, forced_bone, figure_prefixes)
    merged = join_by_role(parts)
    build_clips(arm_obj, team_id)
    path = out_path or os.path.join(OUT_DIR, f"{team_id}.glb")
    export_glb(arm_obj, path)
    return arm_obj, merged, path
