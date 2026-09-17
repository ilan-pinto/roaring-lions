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

**Coverage.** All thirteen of `teams.TEAMS`'s entries.

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
    (its own ground-clutter spoil heap, see `_digger_extras`). `demo_squad`
    and `at_team`/`mortar_team` stay kneeling and deployed through every
    clip; `mortar_crew`, `atgm_cell` and `digger_crew` instead walk standing
    on a THIRD root for `move` -- `move_posture="standing"`, the walker
    `_add_figure` builds beside a figure's kneeling `root` and prone
    `death_root` -- matching `teams.digger_crew`'s own sprite-side "stands
    to relocate" and hiding the deployed prop while the crew is in transit
    (design D6, `2026-09-17-infantry-animation-design.md`).
  * `sniper_team` -- a THIRD bone topology, because its canonical idle is
    PRONE, not standing or kneeling. `_sniper_rest`/`build_sniper_clips`
    give it its own bespoke rest/clip builders rather than forcing it
    through `_add_figure`'s one-living-posture-per-figure shape; see both
    docstrings for why.
  * `moto_rpg` -- a FOURTH topology, and the only one built from scratch
    rather than through `_add_figure`/`kit.figure()` at all:
    `teams._motorcycle`/`_rider` compose the machine and its two riders
    from bare primitives, and `_rider`'s own docstring says why -- "kit.figure
    offers standing, kneeling and prone -- no seated". `_moto_rpg_rest`/
    `build_moto_clips` give it a bespoke rest/clip pair the same way
    `sniper_team` gets one, for the same reason: no existing shape fits.
    See both docstrings for the bone topology this pass chose (one rigid
    `m_root` for the machine, two spinning wheel bones, a pitching launcher
    bone, and each rider bound as one rigid `{prefix}_seat` unit) and why.

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

`moto_rpg` varies this same pattern rather than reusing it verbatim -- see
`_moto_rpg_rest`'s own docstring. It has no `down` at all (`TEAM_CLIP_DROP`
already drops it from the sprite sheet -- "a motorcycle cannot go prone" --
and the mesh drops it for the same reason). Its `wreck` is not one
`{prefix}_death_root` per living figure but THREE independent bones sharing
the shape (`_death_root_bone`, the exact same helper): one for the
tipped-over machine (built from `teams._tip_over(teams._motorcycle("mw"))`,
not `kit.figure()` -- the bike has no posture to fold into), and one each for
the two thrown riders (`kit.figure(posture="prone", ...)`, copied verbatim
from `teams.moto_rpg`'s own wreck branch -- the part of this pass that really
was already free, exactly as billed). All three switch on together: scaling
`m_root` alone hides the whole living machine, both riders and the launcher,
since everything living is parented under it -- see `_key_moto_visibility`.

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
mounts, that makes the `fire` clip apply correctly, which **this pass takes
up**: `at_fire` and `rpg_fire` declare `weapon="launcher"` and get a brace
impulse of their own (`LAUNCH_SPINE`), not the rifle's raise-and-recoil. The
earlier decision not to author one rested on "neither launcher's position
varies with `clip` in `teams.py`", which is a fact about the SPRITE sheet and
was never a fact about this rig; the cost of it was that `at_team` -- whose
only other figure is a spotter with binoculars -- had no `fire` clip in its
GLB at all, so an anti-tank team stood still while a Spike launched.
"""
import glob
import json
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
from mesh_ownership import (  # noqa: E402
    MESH_KIT_OWNED,
    assert_kit_owns_path,
    require_owner,
)

OUT_DIR = os.path.join(REPO, "art", "meshes")

#: Every team this pipeline can export. Order is priority order from the
#: brief, not `teams.TEAMS`'s own order.
SUPPORTED_TEAMS = (
    "inf_squad", "militia_cell", "demo_squad", "charge_squad",
    "at_team", "rpg_team", "mortar_team", "mortar_crew", "atgm_cell",
    "sniper_team", "yahalom_squad", "digger_crew", "moto_rpg",
    "breach_team",
)
DEFAULT_TEAM = "inf_squad"

#: Who may regenerate `art/meshes/<team_id>.glb`, one entry per
#: `SUPPORTED_TEAMS` member, no default -- `tools/mesh_ownership.py` is where
#: the mechanism, the `MESH_KIT_OWNED` sentinel and the history live. The
#: buildings pipeline (`BuildingSpec.mesh_owner`) invented it first and this is
#: the same spelling, deliberately, rather than a third name for the same idea.
#:
#: `art/meshes/sniper_team.glb` has not been a `kit.py` build since
#: `tools/export_meshy_sniper.py` landed: that file writes the same path from
#: two supplied Meshy sculpts, deliberately keeping this module's bone names,
#: clip names and role vocabulary so the swap was one line. Measured on the
#: shipped bytes 2026-09-16 -- the shipped file carries three roles
#: (boot/uniform/weapon) and a 24-frame `move`, where this module builds seven
#: roles and sixteen frames, and its `idle` renders as two ghillie-suited prone
#: figures against this module's primitives.
#:
#: So `export_mesh_team.py -- all` would have QUIETLY overwritten
#: photogrammetry-grade art with boxes. It never did, only because nobody had
#: run `all` since that exporter landed -- every other team in
#: `SUPPORTED_TEAMS` round-trips byte-for-byte (checked, 13 of 14). This guard
#: is why it cannot. A caller that really wants the primitive build can still
#: have it by naming its own `out_path`.
#:
#: `tools/src/mesh_ownership.test.ts` pins every non-kit entry against the named
#: script's OWN output path, so retiring that script turns this into a red test
#: rather than a permanent unexplained block on a file nobody else claims.
TEAM_MESH_OWNER = {
    "inf_squad": MESH_KIT_OWNED,
    "militia_cell": MESH_KIT_OWNED,
    "demo_squad": MESH_KIT_OWNED,
    "charge_squad": MESH_KIT_OWNED,
    "at_team": MESH_KIT_OWNED,
    "rpg_team": MESH_KIT_OWNED,
    "mortar_team": MESH_KIT_OWNED,
    "mortar_crew": MESH_KIT_OWNED,
    "atgm_cell": MESH_KIT_OWNED,
    "sniper_team": "tools/export_meshy_sniper.py",
    "yahalom_squad": MESH_KIT_OWNED,
    "digger_crew": MESH_KIT_OWNED,
    "moto_rpg": MESH_KIT_OWNED,
    "breach_team": MESH_KIT_OWNED,
}
assert set(TEAM_MESH_OWNER) == set(SUPPORTED_TEAMS), (
    "TEAM_MESH_OWNER needs exactly one entry per SUPPORTED_TEAMS member -- "
    f"missing {sorted(set(SUPPORTED_TEAMS) - set(TEAM_MESH_OWNER))}, "
    f"extra {sorted(set(TEAM_MESH_OWNER) - set(SUPPORTED_TEAMS))}. A team with "
    "no entry would fall through to a default, which is the hole this table "
    "closes; see tools/mesh_ownership.py."
)

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
    # --- breach_team's own props (new this pass) ---
    # `kit.ballistic_shield` is held out in front by the same hand a rifle
    # would occupy on the OTHER arm, so it binds to the off-hand forearm
    # rather than through the forced-bone convention _weapon_parts uses for
    # the rifle itself -- it is worn kit from this rig's point of view, the
    # same class as a dropleg holster or a canteen, just larger. `pole`/
    # `pole_head` are `kit.breach_pole`'s two objects (the rod and its small
    # block tip), both worn slung across the back and so both bound to
    # `spine`, the same convention a carried pack (`yah_pack_a`/`_b`) uses in
    # `_yahalom_extras` -- except those go through an explicit `forced` dict
    # because their object names carry no "prefix_suffix" split at all
    # ("yah_pack_a"), where breach_team's props are named
    # "{prefix}_shield"/"{prefix}_pole"/"{prefix}_pole_head" and so resolve
    # through this table's normal fallback path instead.
    "shield": "forearm_L",
    "pole": "spine", "pole_head": "spine",
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
    hip-fix bones: kneeling never animates thighs in this pass -- a crew
    figure either stays deployed and static in every clip, or (design D6)
    walks on its own separate standing walker root for `move` while this
    kneeling body sits invisible -- so there is no swing to open a gap at."""
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

# --- a rifleman's `fire`, and the aim it must not lever the weapon off -------
#
# **The rifle is bound to `forearm_R`, whose world rotation is the SUM of
# `spine`, `upperarm_R` and `forearm_R`.** So the barrel's pitch is that sum,
# and any static pair whose sum is non-zero points the weapon somewhere the
# rest pose did not. `FIRE_SHOULDER + FIRE_ELBOW` was `-0.45 + 0.35 = -0.10`,
# ten times smaller than either term and easy to read as "about zero" -- and
# the recoil then piled another `-0.26` on top of it in the same direction.
#
# Measured on the shipped bytes with `measureWeaponAxis(...).elevationDeg`
# (`tools/src/mesh_gait.ts`), every kit rifleman's barrel:
#
#     idle  +2.47 deg  [+0.47, +4.46]      the level carry kit.rifle builds
#     fire  +17.0 deg  [+8.20, +25.64]     BEFORE this pass
#     fire   +4.2 deg  [ +2.47, +5.90]     after
#
# Found by putting `idle` and `fire` side by side as pictures, not by any
# gate: `measureWeaponAxis` projects onto the ground plane, so all three of
# those read a bearing of -0.0 with a spread of 0.0 and passed 291
# assertions. `WeaponAxis.elevationDeg` is the instrument that exists now.
#
# **`kit.rifle`'s own docstring is the authority on what `fire` means here,
# and it does not mean an arm raise:** *"`aim` ... deliberately changes
# nothing about the figure's height ... Pushing the weapon forward and LEVEL
# is free of that"*. The sprite pipeline's firing pose is a translation of
# +0.16 m forward and +0.06 m up with the barrel horizontal. So:
#
#  * `FIRE_ELBOW` is `-FIRE_SHOULDER`, exactly, which makes the static pair
#    pitch-NEUTRAL: the arm still swings the weapon forward and up out of the
#    carry (measured: +0.083 m forward, +0.047 m up at the hand, the closest
#    this two-bone arm gets to the sprite's own +0.16 / +0.06), and the
#    barrel comes out of it level. Written as a negation rather than as a
#    second literal so the two cannot drift apart.
#  * `RECOIL_ELBOW` is now POSITIVE and nearly cancels the shoulder and the
#    spine. That is what absorbing recoil looks like -- the shoulder and
#    torso take the impulse while the wrist holds the sight on the target --
#    and it keeps a fully visible jolt (the hand still moves 3.4 cm on the
#    shoulder's own kick) while the barrel climbs only `0.16 - 0.15 + 0.05`
#    = 0.06 rad / 3.4 deg and returns. It was `-0.10`, which ADDED to the
#    other two for a 17.8 deg muzzle flip per shot.
#
# `FIRE_SHOULDER`, `RECOIL_SHOULDER` and `RECOIL_SPINE` are R0's own values,
# untouched.
FIRE_SHOULDER = -0.45
FIRE_ELBOW = -FIRE_SHOULDER
RECOIL_SHOULDER = -0.16
RECOIL_ELBOW = 0.15
RECOIL_SPINE = -0.05
FIRE_RISE = 0.16
FIRE_FRAMES = 6

#: Tautological as written -- `FIRE_ELBOW = -FIRE_SHOULDER` two lines above
#: makes this `x * 1.0 == x` under another name, the shape CLAUDE.md's "every
#: check gets an input that makes it fail" now calls out. Kept anyway: it
#: guards the EDIT, not the value -- it can only fire if a future change
#: re-types one of the two literals instead of negating the other, which is
#: exactly the mistake two edits six months apart make.
assert FIRE_SHOULDER + FIRE_ELBOW == 0.0, (FIRE_SHOULDER, FIRE_ELBOW)

# --- a shoulder-fired launcher's own `fire` ---------------------------------
#
# `at_team` shipped no `fire` clip at all until this pass: no figure on it
# carried a rifle, so `build_fire_clip` had no shooter and never ran, and
# `meshClipOrFallback` degraded the runtime's request to `idle` -- an
# anti-tank team standing motionless while a Spike left the tube. The reason
# recorded for it (this function's own docstring, and the module docstring's
# closing paragraph) was that raising a gunner's arms without a
# correspondingly-moving weapon reads as wrong. That is right for a GROUND
# MOUNT and wrong here: `_at_extras`/`_rpg_extras` bind both launchers to
# their firer's `forearm_R`, exactly as `_weapon_parts` binds a rifle, so the
# tube moves with the arm by construction. Nothing had to change for it to.
#
# Three differences from the rifle's `fire`, all deliberate, so this does not
# read as a rifleman's recoil transplanted onto a kneeling missile gunner:
#
#  * **No static raise.** `FIRE_SHOULDER`/`FIRE_ELBOW` bring a rifle UP to
#    the aim and hold it there for the whole clip; a launcher is already on
#    the shoulder and already on the axis (measured: `at_team`'s tube reads
#    -0.02 deg through `measureWeaponAxis` on `idle`). Every term here is an
#    impulse on `_recoil_curve`, zero at both ends, so the aim the rest pose
#    establishes is the aim the clip keeps.
#  * **An order of magnitude smaller.** The largest is 3.2 deg against the
#    rifle's 26 deg raise.
#  * **Pitch only, never yaw.** All three are keyed about `AXIS_Y`, which
#    tips the tube in elevation and leaves its GROUND BEARING alone -- the
#    quantity `mesh_gait.test.ts` gates at 20 deg of mean and 15 of spread.
#
# Signs follow the rifle's own: negative about `AXIS_Y` rocks a spine BACK
# and lifts an arm, so the gunner is rocked back while the muzzle climbs and
# settles -- a brace, not a kick. Split between the two arm joints because
# the tube rides forward of the elbow: the shoulder swings the whole assembly
# and the elbow tips it, and using either alone either slides the tube
# bodily or hinges it around a point it does not pivot on.
#
# **The three ADD UP on the tube, and that is not obvious from the values.**
# `spine` is `upperarm_R`'s parent and `upperarm_R` is `forearm_R`'s, so the
# launcher -- bound to `forearm_R` -- tips by the SUM, 0.115 rad / 6.6 deg at
# the peak, not by any one of them. Measured on the exported bytes rather
# than predicted: `measureRoleTravel(at_team.glb, 'weapon', 'fire')` reads a
# 10.18 cm peak-to-peak muzzle excursion, against 21.66 cm for a rifle's
# `fire` on the same instrument, and against 10.11 cm that the same tube
# already travels in `idle` from breathing alone. Anyone raising one of these
# is raising the tube by more than they typed.
LAUNCH_SPINE = -0.045
LAUNCH_SHOULDER = -0.025
LAUNCH_ELBOW = -0.045

MOVE_FRAMES = 16
IDLE_FRAMES = 32

#: charge_squad's own rest lean, in degrees, baked into REST GEOMETRY by
#: `_charge_squad_rest` through `teams._lean_forward`. Hoisted out of that
#: call site so `gait_for_team` can subtract it from the gait's own spine
#: lean budget rather than piling a second lean on top of it -- one number,
#: two readers. `teams.py`'s own `lean = 24.0 if clip == "fire" else 20.0`
#: is still the source; this is the non-fire half of it, and FIRE_ROOT_LEAN
#: above carries the remaining 4 degrees.
CHARGE_REST_LEAN_DEG = 20.0

#: Radians of forward lean already baked into a team's REST geometry, by team.
#: Only `charge_squad` has any; every other team stands upright at rest.
#:
#: **Declared here AND observed at build time, because a hand-maintained table
#: of "which teams lean" is the second copy of a number that lives elsewhere --
#: exactly what hoisting `CHARGE_REST_LEAN_DEG` one paragraph above was meant
#: to avoid.** `build_team_rest` wraps `teams._lean_forward` for the duration of
#: the build and records the largest lean it actually applies per team
#: (`_OBSERVED_REST_LEAN`); `rest_lean_for` prefers that observation, and
#: `_check_observed_rest_lean` raises when the two disagree. So a team that
#: gains a rest lean through `teams._lean_forward` without an entry here fails
#: the build rather than silently getting the full gait lean on top of it.
REST_LEAN_RAD = {"charge_squad": math.radians(CHARGE_REST_LEAN_DEG)}

#: Filled by `build_team_rest`. Keyed by team id, radians, largest lean applied.
_OBSERVED_REST_LEAN = {}


def rest_lean_for(team_id):
    """The rest lean the gait must budget around. The build-time observation
    when there is one -- which is every real export, since `build_team_rest`
    always runs first -- and the declared table otherwise, so
    `gait_amplitudes` stays callable from a probe with no scene."""
    if team_id in _OBSERVED_REST_LEAN:
        return _OBSERVED_REST_LEAN[team_id]
    return REST_LEAN_RAD.get(team_id, 0.0)


def _check_observed_rest_lean(team_id, observed_deg):
    """What `teams._lean_forward` actually did, against what this file says."""
    observed = math.radians(observed_deg)
    declared = REST_LEAN_RAD.get(team_id, 0.0)
    if abs(observed - declared) < 1e-9:
        _OBSERVED_REST_LEAN[team_id] = observed
        return
    raise RuntimeError(
        f"{team_id}: rest geometry was leaned {observed_deg:.3f} deg by "
        f"teams._lean_forward, but REST_LEAN_RAD declares "
        f"{math.degrees(declared):.3f} deg. The gait's own spine lean is "
        f"budgeted against that number (MOVE_LEAN_TOTAL_MAX), so a silent "
        f"disagreement here stacks two leans on one figure. Update "
        f"REST_LEAN_RAD -- and say which call site put it there."
    )


# --- the stride is sized from the team's own speed --------------------------
#
# Every constant ABOVE is R0's, and stays exactly R0's value at the reference
# speed this block derives. Nothing here re-authors the gait; it scales it,
# and at scale 1.0 every number below reduces to the one above it (asserted
# by `_check_gait_identity_at_reference`, which runs on import).
#
# Why a scale at all. `build_move_clip` authored ONE gait for all fourteen
# teams, so `sniper_team` at 0.45 tiles/s and `charge_squad` at 1.90 took the
# same 16-frame stride. Measured on the exported bytes, boot travel over one
# cycle against the ground the sim moves the unit across in that same cycle:
# 0.545 for the sniper and 0.321 for the charge squad, where 1.0 means the
# feet keep up. The design's D3 (`docs/superpowers/specs/
# 2026-09-15-infantry-gait-design.md` sec 3.3) is this block.

#: Metres of ground one tile is. The mesh contract's own number, the same one
#: `tools/src/mesh_gait.ts` measures against (`MESH_UNITS_PER_TILE`).
TILE_M = 3.0

#: `boot` peak-to-peak travel over one `move` cycle with every R0 constant
#: above unscaled, MEASURED on the exported bytes rather than predicted from
#: the bone lengths -- `measureRoleTravel(<team>.glb, 'boot', 'move')
#: .maxTravelM`, which read 1.154 m to the millimetre on eight of the ten kit
#: walkers (`charge_squad` 1.219 and `inf_squad` 1.159 differ only through
#: their own rest geometry and figure count, not through this gait).
#:
#: This is the ONE calibration constant in the block and it is what makes
#: "the reference speed" a measurement instead of a choice: the gait as R0
#: authored it keeps up with 1.154 m / (MOVE_SECONDS * TILE_M) = 0.577
#: tiles/s, and every team's scale is its own speed over that. Re-measure it
#: if any of `A_THIGH`/`B_SHIN`/`SETTLE_AMP`/`SHIN_SWING_SHIFT` moves.
BASE_BOOT_TRAVEL_M = 1.154

#: Thigh-swing amplitude, radians, past which stride growth stops.
#:
#: A step is `2 * L * sin(theta)`, so the return on more rotation collapses
#: as `theta` approaches a right angle -- but on THIS rig saturation does not
#: arrive as a shorter step, it arrives as a SQUAT, and that is what sets the
#: number. A straight leg swung `theta` off vertical reaches only
#: `L * cos(theta)` toward the ground, so `_stance_drop` has to sink the root
#: by `L * (cos(theta) - cos(A_THIGH))` to keep the feet on it, and that sink
#: grows far faster than the step does.
#:
#: Built at 0.55 / 0.70 / 0.85 / 1.00 on `charge_squad` (the only team whose
#: `want` is past every candidate, so the cap is what it gets), measured on
#: the exported bytes and rendered at frame 4, the split instant:
#:
#:   cap   boot travel   stance sink   float    reads as
#:   0.55      1.219 m       0.000 m   0.0865   the stroll this pass exists to fix
#:   0.70      1.456         0.068     0.0914   a run
#:   0.85      1.634         0.148     0.0812   a run, loaded
#:   1.00      1.766         0.240     0.0715   a crouch -- hips visibly down,
#:                                              thighs folded, and the step only
#:                                              8% longer than 0.85 for a 62%
#:                                              deeper sink
#:
#: So 0.85 is where the step stops being worth what it costs in posture, and
#: it is a 97-degree hip split -- past a runner's and at the top of a
#: sprinter's. Float is NOT what binds: it stays at or under the shipped
#: gait's own 0.0865 m at every cap above, because `_stance_drop` cancels it.
#: Renders in `.superpowers/sdd/2026-09-15-infantry-gait/`.
THIGH_CAP = 0.85

#: The stride scale `THIGH_CAP` corresponds to -- derived, never typed.
STRIDE_CAP = math.sin(THIGH_CAP) / math.sin(A_THIGH)

#: The gait's own spine lean is allowed to reach this, and a team's TOTAL
#: lean (its rest geometry's plus the gait's) this. The second bound is what
#: keeps `charge_squad` -- which already leans 20 degrees at rest -- from
#: ending up folded double once the gait's own lean scales with its 1.9
#: tiles/s.
MOVE_LEAN_MAX = 0.30
MOVE_LEAN_TOTAL_MAX = math.radians(30.0)

#: Hip joint to ankle joint, off `_BASE_BONES` itself rather than restated:
#: `thigh_L`'s head z minus `shin_L`'s tail z. `_stance_drop` needs a lever
#: and this is the rig's own.
LEG_REACH_M = (
    dict((n, (h, t)) for n, _p, h, t in _BASE_BONES)["thigh_L"][0][2]
    - dict((n, (h, t)) for n, _p, h, t in _BASE_BONES)["shin_L"][1][2]
)

DATA_UNITS_DIR = os.path.join(REPO, "data", "units")


def unit_speed_tiles_s(team_id):
    """`mobility.speed_tiles_s` from the team's OWN unit JSON.

    Read, never restated. A second copy of a speed in this file is how these
    tables go stale, and the failure would be silent -- a wrong stride looks
    like art, not like a bug. So a team with no unit JSON, two unit JSONs, or
    no `mobility.speed_tiles_s` raises here rather than taking a default.
    "team id == unit type id == file basename" holds for every `kit.py` team
    (`packages/app/src/mesh-catalogue.ts` says so in as many words, and names
    the five Meshy assets as the exceptions, none of which this file builds).
    """
    hits = sorted(glob.glob(os.path.join(DATA_UNITS_DIR, "**", f"{team_id}.json"),
                            recursive=True))
    if len(hits) != 1:
        raise RuntimeError(
            f"{team_id}: expected exactly one unit JSON under {DATA_UNITS_DIR}, "
            f"found {len(hits)}: {hits}. The gait is sized from "
            f"mobility.speed_tiles_s and this file will not guess one."
        )
    with open(hits[0], encoding="utf-8") as fh:
        doc = json.load(fh)
    speed = doc.get("mobility", {}).get("speed_tiles_s")
    if not isinstance(speed, (int, float)) or isinstance(speed, bool) or speed <= 0:
        raise RuntimeError(
            f"{hits[0]}: mobility.speed_tiles_s is {speed!r}; the gait is sized "
            f"from it and this file will not guess one."
        )
    return float(speed)


def move_seconds():
    """`move`'s own length in seconds -- `MOVE_FRAMES` at the SCENE's frame
    rate, read back rather than assumed, because the ratio this whole block
    targets is measured against the clip length the exporter writes."""
    return MOVE_FRAMES / float(bpy.context.scene.render.fps)


#: Every amplitude that is a PLAIN multiple of the stride scale, paired with
#: the R0 constant it scales. One table, walked by `gait_amplitudes` to build
#: the dict and by `_check_gait_identity_at_reference` to check it, so the two
#: cannot describe different gaits. `thigh` and `lean` are deliberately absent:
#: the thigh saturates through a sine and the lean has its own two ceilings,
#: and both are asserted separately below.
_LINEAR_TERMS = (
    ("shin", B_SHIN),
    ("settle", SETTLE_AMP),
    ("arm_free", A_ARM_FREE),
    ("arm_weapon", A_ARM_WEAPON),
    ("elbow", ELBOW_FREE_AMP),
    ("bob", BOB_AMP),
    ("hip_twist", HIP_TWIST_AMP),
    ("shoulder_twist", SHOULDER_TWIST_AMP),
)


def gait_amplitudes(want, rest_lean_rad=0.0):
    """Every per-frame amplitude `build_move_clip` reads, for a stride scale.

    Split out of `gait_for_team` so it touches NO `bpy` and reads NO file --
    which is what lets `_check_gait_identity_at_reference` call it for real.
    The first version of that guard asserted `x * 1.0 == x` against constants
    it had restated itself and never called this code at all, so changing
    `B_SHIN * scale` to `B_SHIN * scale * 1.2` left it perfectly green.

    `want` is the scale that would make the boots exactly keep up with the
    ground; `scale` is what the rig delivers after `THIGH_CAP`. Whatever the
    cap leaves unmet is the RENDERER's to take up as cadence (design D4) --
    the rig owns stride, the renderer owns cadence, which is also what a
    sprinter does: a longer stride AND a faster one. At `charge_squad`'s
    1.9 tiles/s no stride on a 1.67 m figure closes the gap: 3.80 m of ground
    per cycle needs a 3.80 m foot excursion, and a fully split leg cannot
    reach half of it.
    """
    scale = min(want, STRIDE_CAP)
    out = {key: base * scale for key, base in _LINEAR_TERMS}
    # The thigh is the one term whose own geometry saturates, so it is scaled
    # through the sine rather than multiplied: a step is 2*L*sin(theta).
    out["thigh"] = math.asin(min(1.0, math.sin(A_THIGH) * scale))
    lean_room = MOVE_LEAN_TOTAL_MAX - rest_lean_rad
    out["lean"] = min(MOVE_LEAN * want, MOVE_LEAN_MAX, max(MOVE_LEAN, lean_room))
    out["want"] = want
    out["scale"] = scale
    out["capped"] = want > STRIDE_CAP
    return out


def gait_for_team(team_id):
    """`gait_amplitudes` for this team, from its own data: its unit JSON's
    `mobility.speed_tiles_s` and the scene's own frame rate."""
    speed = unit_speed_tiles_s(team_id)
    ground_m = speed * move_seconds() * TILE_M
    gait = gait_amplitudes(ground_m / BASE_BOOT_TRAVEL_M, rest_lean_for(team_id))
    gait.update(team=team_id, speed=speed, ground_m=ground_m)
    return gait


def _stance_drop(thigh_angle, base_angle, leg_reach_m=None):
    """How far the root must sink so a longer swing does not lift both feet.

    A straight leg swung `theta` off vertical reaches `leg_reach_m *
    cos(theta)` toward the ground, so lengthening the swing raises the whole
    figure off it. This returns the DIFFERENCE against the unscaled gait's
    own reach at the same phase, so it is identically zero at scale 1.0 and
    R0's authored look survives untouched -- what it adds is only the squat a
    longer stride actually costs.

    Not folded into `BOB_AMP`, deliberately. R0's bob is
    `-BOB_AMP * cos(2 * phase)`, which puts the root at its HIGHEST at the
    split and its lowest with the legs together -- the inverse of a real
    gait, at 2.6 cm. That is R0's authored look and this pass does not
    relitigate it; this term is a separate, derived quantity that happens to
    share the same bone.

    `leg_reach_m` defaults to THIS rig's own hip-to-ankle (`LEG_REACH_M`, read
    off `_BASE_BONES`). It is a parameter because `gait_pose` is shared with
    `tools/export_meshy_sniper.py`, whose sculpted figures have their own leg
    length -- the correction is a property of the LEG, not of the gait, and
    applying this rig's lever to another rig's leg would under- or
    over-compensate by exactly their ratio.
    """
    reach = LEG_REACH_M if leg_reach_m is None else leg_reach_m
    return reach * (math.cos(thigh_angle) - math.cos(base_angle))


#: Every key `build_move_clip` reads out of a gait dict. `gait_amplitudes` must
#: produce exactly these and no others, so a term added there without being
#: asserted below cannot slip through the identity check.
GAIT_KEYS = frozenset(
    [key for key, _ in _LINEAR_TERMS] + ["thigh", "lean", "want", "scale", "capped"]
)

#: Every joint angle `gait_pose` returns. Same discipline as `GAIT_KEYS` and
#: for the same reason: a term added to the gait without being asserted at the
#: reference cannot slip through `_check_gait_identity_at_reference`.
def _settle_bump(phase, heel_phase, width, amp):
    """The heel-strike weight transfer, hoisted above `gait_pose` (it used to
    sit beside `build_move_clip`) so the import-time identity check can call
    the real `gait_pose` rather than a version with a hole in it."""
    d = (phase - heel_phase) % (2.0 * math.pi)
    if d > width:
        return 0.0
    return amp * 0.5 * (1.0 - math.cos(2.0 * math.pi * d / width))


GAIT_POSE_KEYS = frozenset([
    "thigh_l", "thigh_r", "shin_l", "shin_r", "hip_l", "hip_r",
    "arm_l", "arm_r", "elbow_l", "hip_twist", "shoulder_twist",
    "head_counter", "lean", "bob",
])


def gait_pose(gait, phase, leg_reach_m=None):
    """Every joint angle R0's gait asks for at one phase of the cycle, as a
    plain dict of radians (plus `bob`, which is metres along world `+Z`).

    Pure: no `bpy`, no bones, no keyframes. Split out of `build_move_clip` --
    which still keys exactly what this returns, one bone per entry -- so that
    a rig with a DIFFERENT bone set can drive the same gait instead of
    authoring a second one. `tools/export_meshy_sniper.py` is the second
    caller and reads six of the fourteen entries, because its two
    photogrammetry figures carry fourteen joints in total (root, pelvis,
    thigh and shin, per figure) and have no spine, arm or head bone to key.
    That file previously carried `swing = 0.40 * math.sin(a)` over a 24-frame
    cycle of its own: a stride that never read `mobility.speed_tiles_s`, and
    a knee that bent the wrong way (`mesh_gait.ts`'s `swingLiftFraction` read
    it at -0.180 against +0.113..+0.470 for every other rig in the tree).
    Both halves came from being a second copy; this is the shared one.

    `phase` is radians around one full cycle, `gait_phase`'s per-figure
    offset already added by the caller. `gait` is `gait_for_team`'s dict.
    """
    thigh_l = gait["thigh"] * math.sin(phase)
    thigh_r = -gait["thigh"] * math.sin(phase)
    shin_l = gait["shin"] * max(0.0, math.sin(phase - SHIN_SWING_SHIFT))
    shin_r = gait["shin"] * max(0.0, math.sin(phase + math.pi - SHIN_SWING_SHIFT))
    shin_l += _settle_bump(phase, HEEL_L, SETTLE_WIDTH, gait["settle"])
    shin_r += _settle_bump(phase, HEEL_R, SETTLE_WIDTH, gait["settle"])
    shoulder_twist = -gait["shoulder_twist"] * math.sin(phase)
    bob = -gait["bob"] * math.cos(2.0 * phase)
    # Both feet reach `leg_reach_m * cos(thigh)` toward the ground, so a
    # longer swing lifts the figure off it. Zero at scale 1.0.
    bob += _stance_drop(thigh_l, A_THIGH * math.sin(phase), leg_reach_m)
    return {
        "thigh_l": thigh_l,
        "thigh_r": thigh_r,
        "shin_l": shin_l,
        "shin_r": shin_r,
        "hip_l": thigh_l * 0.5,
        "hip_r": thigh_r * 0.5,
        "arm_l": -gait["arm_free"] * math.sin(phase),
        "arm_r": gait["arm_weapon"] * math.sin(phase),
        "elbow_l": gait["elbow"] * max(0.0, ELBOW_PHASE_SIGN * math.sin(phase)),
        "hip_twist": gait["hip_twist"] * math.sin(phase),
        "shoulder_twist": shoulder_twist,
        "head_counter": -HEAD_COUNTER_FRAC * shoulder_twist,
        "lean": gait["lean"],
        "bob": bob,
    }


def _check_gait_identity_at_reference():
    """Call `gait_amplitudes(1.0)` for real and require every amplitude it
    returns to BE its own R0 constant, term by term.

    This is the guard that keeps the block above a scaling of known-good
    numbers rather than a second gait, and it has to call the real function to
    be that. The version this replaced asserted `x * 1.0 == x` against
    constants it had restated itself: four of its five assertions were
    tautologies and the fifth recomputed its own right-hand side, so
    `"shin": B_SHIN * scale * 1.2` passed it. Falsified by hand after the
    rewrite -- that exact edit now raises `AssertionError: ('shin', 1.08, 0.9)`
    at import.
    """
    g = gait_amplitudes(1.0, 0.0)
    assert set(g) == GAIT_KEYS, (sorted(set(g) ^ GAIT_KEYS))
    for key, base in list(_LINEAR_TERMS) + [("thigh", A_THIGH), ("lean", MOVE_LEAN)]:
        assert abs(g[key] - base) < 1e-12, (key, g[key], base)
    assert g["scale"] == 1.0 and g["want"] == 1.0 and g["capped"] is False
    # A team that already leans at rest is never penalised below R0's own
    # value at the reference...
    rest = math.radians(CHARGE_REST_LEAN_DEG)
    assert gait_amplitudes(1.0, rest)["lean"] == MOVE_LEAN
    # ...and the budget BINDS where it has to, which is the only place it can:
    # a `want` big enough that the gait would otherwise stack a second lean on
    # a figure that already leans. 3.0 is charge_squad's own regime (3.29).
    # Checking this at the reference alone is vacuous -- `MOVE_LEAN * 1.0` is
    # the smallest term there whatever the budget says, so an inverted
    # `MOVE_LEAN_TOTAL_MAX + rest_lean_rad` passed a scale-1.0 assertion.
    # Falsified after the fix: that inversion now raises here.
    assert gait_amplitudes(3.0, 0.0)["lean"] == MOVE_LEAN_MAX
    leaned = gait_amplitudes(3.0, rest)["lean"]
    assert abs(leaned - (MOVE_LEAN_TOTAL_MAX - rest)) < 1e-12, leaned
    assert leaned + rest <= MOVE_LEAN_TOTAL_MAX + 1e-12, leaned + rest
    for a in (0.0, 0.3, A_THIGH):
        assert abs(_stance_drop(a, a)) < 1e-12, a
        assert abs(_stance_drop(a, a, 0.5)) < 1e-12, a
    assert abs(STRIDE_CAP - math.sin(THIGH_CAP) / math.sin(A_THIGH)) < 1e-12
    assert abs(LEG_REACH_M - 0.770) < 1e-9, LEG_REACH_M
    # `gait_pose` is now the single definition of the gait's per-phase shape
    # and it has a SECOND caller (`tools/export_meshy_sniper.py`), so the same
    # discipline the amplitudes get applies to the pose: call it for real, at
    # the reference, and require every entry to BE its own R0 formula. A term
    # added there without a line here fails the key-set assertion rather than
    # slipping out to the sniper unnoticed.
    for phase in (0.0, 0.7, math.pi / 2.0, 2.4, math.pi, 5.1):
        p = gait_pose(g, phase)
        assert set(p) == GAIT_POSE_KEYS, sorted(set(p) ^ GAIT_POSE_KEYS)
        s = math.sin(phase)
        assert abs(p["thigh_l"] - A_THIGH * s) < 1e-12, (phase, p["thigh_l"])
        assert abs(p["thigh_r"] + A_THIGH * s) < 1e-12, (phase, p["thigh_r"])
        assert abs(p["hip_l"] - p["thigh_l"] * 0.5) < 1e-12, phase
        assert abs(p["hip_r"] - p["thigh_r"] * 0.5) < 1e-12, phase
        assert abs(p["shin_l"] - (B_SHIN * max(0.0, math.sin(phase - SHIN_SWING_SHIFT))
                                  + _settle_bump(phase, HEEL_L, SETTLE_WIDTH, SETTLE_AMP))) < 1e-12, phase
        assert abs(p["shin_r"] - (B_SHIN * max(0.0, math.sin(phase + math.pi - SHIN_SWING_SHIFT))
                                  + _settle_bump(phase, HEEL_R, SETTLE_WIDTH, SETTLE_AMP))) < 1e-12, phase
        assert abs(p["arm_l"] + A_ARM_FREE * s) < 1e-12, phase
        assert abs(p["arm_r"] - A_ARM_WEAPON * s) < 1e-12, phase
        assert abs(p["elbow_l"] - ELBOW_FREE_AMP * max(0.0, ELBOW_PHASE_SIGN * s)) < 1e-12, phase
        assert abs(p["hip_twist"] - HIP_TWIST_AMP * s) < 1e-12, phase
        assert abs(p["shoulder_twist"] + SHOULDER_TWIST_AMP * s) < 1e-12, phase
        assert abs(p["head_counter"] + HEAD_COUNTER_FRAC * p["shoulder_twist"]) < 1e-12, phase
        assert p["lean"] == MOVE_LEAN, phase
        # At the reference the stance drop is identically zero, so the bob is
        # R0's own inverted cosine and nothing else -- which is the property
        # that makes this a shared gait rather than a second one.
        assert abs(p["bob"] + BOB_AMP * math.cos(2.0 * phase)) < 1e-12, (phase, p["bob"])
    # A shorter leg takes a proportionally smaller stance correction -- the one
    # thing `leg_reach_m` has to get right, and the one thing a
    # default-argument slip would silently break. Checked away from the
    # reference, where the term is non-zero and can therefore disagree.
    g14 = gait_amplitudes(1.4)
    full = gait_pose(g14, 1.0)
    short = gait_pose(g14, 1.0, LEG_REACH_M / 2.0)
    drop = _stance_drop(full["thigh_l"], A_THIGH * math.sin(1.0))
    assert abs(drop) > 1e-6, drop
    assert abs((full["bob"] - short["bob"]) - drop / 2.0) < 1e-12, (full["bob"], short["bob"])


_check_gait_identity_at_reference()

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
# which handheld weapon (if any) this figure carries.
#
# `weapon` is one of three values and they are NOT parallel, which is worth
# reading once:
#
#   None         carries nothing a clip animates -- a spotter's binoculars, a
#                demolition charge, a mast. No `fire` pose.
#   "rifle"      `_add_figure` BUILDS the weapon here, via `_weapon_parts`,
#                and force-binds it to this figure's `forearm_R`.
#   "launcher"   the weapon is built by `TEAM_EXTRAS` instead (a launcher is
#                one assembly per team, not one per figure) and force-bound to
#                the SAME `forearm_R`. `_add_figure` builds nothing for it.
#
# So `weapon` declares what a figure holds, and the two armed values differ
# only in WHO builds it. `build_fire_clip` reads both and gives each its own
# impulse; `_check_team_figures_against_teams` checks that a figure declaring
# `"launcher"` really has launcher geometry on its `forearm_R`, so the
# declaration cannot drift away from `TEAM_EXTRAS`.
#
# Every (x, y) below is copied verbatim from `teams.py`'s own source, not
# re-derived -- REST_FIGURES's own discipline, carried forward.

def _f(prefix, x, y, posture="standing", headgear="helmet", loadout="regular",
       leader=False, mirror=False, animates=True, weapon=None, move_posture=None):
    return dict(prefix=prefix, x=x, y=y, posture=posture, headgear=headgear,
                loadout=loadout, leader=leader, mirror=mirror,
                animates=animates, weapon=weapon, move_posture=move_posture)


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
        _f("rpg_fire", 0.18, -0.26, headgear="keffiyeh", loadout="irregular",
           animates=False, weapon="launcher"),
        _f("rpg_load", -0.30, 0.30, headgear="keffiyeh", loadout="irregular", leader=True, weapon="rifle"),
    ],
    "demo_squad": [
        _f("demo_a", 0.34, -0.16, posture="kneeling", animates=False),
        _f("demo_b", -0.36, 0.28, leader=True, weapon="rifle"),
    ],
    "at_team": [
        _f("at_fire", 0.24, -0.30, posture="kneeling", animates=False, weapon="launcher"),
        # `at_spot` carries binoculars and deliberately gets NO `fire` pose.
        # He is not shooting anything: the Spike is `at_fire`'s, and a spotter
        # with glasses at his eyes who jerks every time his gunner launches is
        # motion invented for a man who is not firing. `weapon=None` is the
        # declaration of that, and it is the same answer `demo_a`'s charge and
        # `yah_a`'s mast already get.
        _f("at_spot", -0.32, 0.34, leader=True),
    ],
    "mortar_team": [
        _f("mtr_crew0", -0.14, -0.54, posture="kneeling", animates=False),
        _f("mtr_crew1", -0.14, 0.54, posture="kneeling", animates=False),
        _f("mtr_no3", -0.62, 0.0, leader=True, weapon="rifle"),
    ],
    "mortar_crew": [
        _f("emtr_crew0", -0.16, -0.40, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False, move_posture="standing"),
        _f("emtr_crew1", -0.16, 0.42, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False, move_posture="standing"),
    ],
    "atgm_cell": [
        _f("atgm_crew0", -0.34, -0.40, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False, move_posture="standing"),
        _f("atgm_crew1", -0.34, 0.44, posture="kneeling", headgear="keffiyeh", loadout="irregular", animates=False, move_posture="standing"),
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
    "breach_team": [
        _f("brc_point", 0.32, -0.18, leader=True, weapon="rifle"),
        _f("brc_cover", -0.30, 0.24, weapon="rifle"),
    ],
    # Stands to relocate for `move`, as `teams.digger_crew` itself does --
    # design D6 (`2026-09-17-infantry-animation-design.md`); the walker is
    # the third root `_add_figure` builds.
    "digger_crew": [
        _f("dig", -0.34, 0.04, posture="kneeling", headgear="keffiyeh",
           loadout="irregular", animates=False, move_posture="standing"),
    ],
    # moto_rpg is NOT built through `_add_figure`/PART_BONE at all -- see
    # `_moto_rpg_rest`, which force-binds every single part it creates to an
    # explicit bone name. These six entries exist only so `figure_prefixes`
    # (rig_parts's PART_BONE fallback, never actually reached for this team,
    # since forced_bone always answers first) and
    # `_check_team_figures_against_teams` have something to read.
    # `posture="standing"` is filler to satisfy that check's assert and is
    # not used to build anything; `x`/`y` are likewise unread here (only
    # `.prefix` is).
    "moto_rpg": [
        _f("m", 0.0, 0.0, animates=False),
        _f("rid", 0.0, 0.0, animates=False),
        _f("pas", 0.0, 0.0, animates=False),
        _f("mw", 0.0, 0.0, animates=False),
        _f("mw_a", 0.0, 0.0, animates=False),
        _f("mw_b", 0.0, 0.0, animates=False),
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
        "moto_rpg": "enemy", "breach_team": "kdf",
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
            assert spec["weapon"] in (None, "rifle", "launcher"), spec
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


def _walker_prefix(spec):
    return f"{spec['prefix']}w"


def _walker_specs(figures):
    """A synthetic standing spec per figure that walks standing (design D6):
    same placement, prefix `{prefix}w`, `animates=True`, no weapon, no
    death parts of its own (the kneeling half already owns the corpse)."""
    return [
        dict(s, prefix=_walker_prefix(s), posture="standing", animates=True, weapon=None, move_posture=None)
        for s in figures if s.get("move_posture") == "standing"
    ]


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
    if spec.get("move_posture") == "standing":
        assert spec["posture"] == "kneeling", spec
        wp = _walker_prefix(spec)
        walker = kit.figure(
            wp, (spec["x"], spec["y"], 0.0), posture="standing", yaw=0.0,
            headgear=spec["headgear"], stride=0.0, arms=True, leader=spec["leader"],
            mirror=spec["mirror"], loadout=spec["loadout"], smoke=None,
        )
        parts += walker
        bones += _standing_bones(wp, spec["x"], spec["y"])
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


def _breach_extras():
    """breach_team's own props: `brc_point`'s ballistic shield and
    `brc_cover`'s breach pole. Unlike every other entry in this table, both
    resolve through the plain PART_BONE fallback rather than an explicit
    `forced` dict -- see PART_BONE's own "breach_team's own props" comment
    for why: both objects are named `f"{prefix}_{suffix}"` against a real
    figure prefix, the same convention `kit.figure()`'s own worn-kit parts
    (pouches, dropleg, canteen) already use, so `rig_parts` binds them for
    free. Returning `{}` for `forced` here is the tell that these are worn
    kit, not a free-standing crew-served weapon with no hand to grip."""
    shield = kit.ballistic_shield("brc_point_shield", (0.32, -0.18, 0.0))
    pole = kit.breach_pole("brc_cover_pole", (-0.30, 0.24, 0.0))
    return shield + pole, [], {}


TEAM_EXTRAS = {
    "demo_squad": _demo_extras,
    "at_team": _at_extras,
    "rpg_team": _rpg_extras,
    "mortar_team": _mortar_team_extras,
    "mortar_crew": _mortar_crew_extras,
    "atgm_cell": _atgm_extras,
    "yahalom_squad": _yahalom_extras,
    "digger_crew": _digger_extras,
    "breach_team": _breach_extras,
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
        teams._lean_forward(fig, CHARGE_REST_LEAN_DEG, at_x=x)
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


# --- moto_rpg: vehicle + seated riders, built from scratch ------------------
#
# `teams._motorcycle`/`teams._rider` never call `kit.figure()` -- `_rider`'s
# own docstring says why ("kit.figure offers standing, kneeling and prone --
# no seated"), so there is no standing/kneeling/prone rig to bind against and
# `PART_BONE`'s suffix table has nothing to say about a wheel or a fuel tank.
# This section decides a topology from scratch rather than stretching either
# existing convention to fit, and every part it creates is bound by an
# EXPLICIT `forced_bone` entry -- none of it goes through PART_BONE's
# prefix/suffix matching, because `_rider`'s own part names ("leg0", "arm1",
# "head") collide in spirit but not in bone shape with the standing/kneeling
# vocabulary (a rider's arm is ONE two-waypoint limb, not an upperarm/forearm
# pair), and binding by coincidence rather than by decision is exactly the
# failure `rig_parts`'s own docstring already logs once (the "demo_a" prefix
# bug). `moto_rpg`'s six `TEAM_FIGURES` entries exist only for
# `figure_prefixes`/the self-check; they are never read by the code below.
#
# The topology, decided and reasoned about part by part:
#
#   * `m_root` -- the machine is RIGID. It does not need a skeleton so much
#     as one root that can carry the whole bike (frame, tank, seat, forks,
#     bars, lamp, exhaust, panniers, bedroll, both wheel guards) and be
#     leant and bobbed as one piece for `move` -- the bone-space equivalent
#     of `teams._motorcycle`'s own `z`/`dip` parameters, which the sprite
#     pipeline bakes into fresh geometry per frame and this pipeline instead
#     applies as a pose on one bone. `MOTO_BOB`/`MOTO_DIP` are copied
#     verbatim from `teams.moto_rpg`'s own `bob`/`dip` amplitudes
#     (0.02 m / 1.6 deg), generalised from that function's 4-frame discrete
#     cycle (`(0, +a, 0, -a)`, which IS one period of `a * sin(2*pi*f/4)`)
#     into a smooth `MOVE_FRAMES`-frame sine, so the mesh gait matches the
#     sprite gait's own amplitude and phase exactly rather than a guessed
#     substitute.
#   * Two wheel bones, spinning. Worth a bone at 25 px: it is two bones and
#     one rotation channel each -- no new geometry, no seam risk (a wheel is
#     already one whole tube-shaped part, so "spin the bone" and "spin the
#     mesh" are the same operation) -- and CLAUDE.md already records the
#     project lead judging rigged motion better on screen than a static
#     silhouette at this size, which is the same judgement call applied to a
#     wheel rather than a leg. `MOTO_TURNS = 2.0` full rotations across the
#     move clip is chosen so the final angle (720 deg) is an exact multiple
#     of 360 -- the wheel returns to its start orientation and the
#     LoopRepeat seam every cyclic clip in this file already has to consider
#     is invisible on this one too.
#   * `m_launcher` -- the RPG tube is not "held" the way `_at_extras`/
#     `_rpg_extras` treat a Spike/RPG bound to a firer's `forearm_R`:
#     `teams.moto_rpg` positions it independent of either rider's own reach
#     (`(-0.50, -0.17, 1.44 + bob)`, tracking the BIKE's bob, not a rider's
#     grip), so it gets its OWN bone, parented to `m_root` so it rides the
#     bike's lean for free, with one extra rotation of its own: level for
#     `fire`, angled up otherwise, exactly `teams.moto_rpg`'s own
#     `pitch = 0 if clip == "fire" else 30` deg. Rest bakes the MORE common
#     state (30 deg, shared by idle and move) directly into the geometry via
#     `kit.launcher`'s own `pitch` argument, so only the exceptional clip
#     (`fire`) needs a keyed delta -- the same "key only the exception"
#     shape `FIRE_ROOT_LEAN` already uses for charge_squad's own fire-only
#     lean.
#   * `rid_seat`/`pas_seat` -- the riders are SEATED, a fourth posture after
#     standing/kneeling/prone, and `_rider`'s own geometry already bakes
#     that whole pose into its waypoints (the torso limb's own forward lean,
#     the bent-knee legs, the arms reaching a fixed grip) exactly the way
#     `kit.figure(posture="kneeling")`'s legs are baked rather than
#     articulated -- "kneeling never reads stride". Nothing in `teams.py`
#     ever moves a rider's own limb independent of the machine (no clip
#     changes a rider's own pose; only the launcher's pitch and the whole
#     bike's bob/dip vary), so there is no motion this pass would be
#     dropping by binding each rider as ONE rigid unit to ONE bone -- the
#     same "no per-part articulation" call `_figure_death_parts` already
#     makes for a corpse, made here for a live but fixed pose instead. Each
#     seat bone still gets its own idle breathing sway (matching every other
#     figure's "a kneeling gunner still breathes" -- `build_idle_clip`'s own
#     docstring), which is free precisely because the whole rider is one
#     rigid unit: swaying it sways torso, arms, legs and head together with
#     no seam to open anywhere.
#   * `wreck` -- reuses `_death_root_bone` directly, the same helper (not a
#     new one) every other team's corpse already uses, three times over: one
#     bone for the tipped machine (`teams._tip_over(teams._motorcycle("mw"))`
#     -- the bike has no posture to fold into, so there is no `kit.figure()`
#     call here at all) and one each for the two thrown riders
#     (`kit.figure(posture="prone", ...)`, copied verbatim from
#     `teams.moto_rpg`'s own wreck branch). This is the part of the pass
#     that is genuinely closer to free: the brief's own hint. Visibility is
#     ONE scale key on `m_root` (collapsing the whole living machine, both
#     riders and the launcher, since every one of those bones descends from
#     it) plus one each on the three wreck bones -- see
#     `_key_moto_visibility`.

MOTO_BOB = 0.02                       # metres -- teams.moto_rpg's own `bob` amplitude
MOTO_DIP = math.radians(1.6)          # teams.moto_rpg's own `dip` amplitude
MOTO_LAUNCH_PITCH = math.radians(30.0)   # teams.moto_rpg's own "angled up" pitch
MOTO_TURNS = 2.0                      # full wheel rotations across one `move` loop


def _moto_bone_table():
    return [
        ("m_root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.30)),
        ("m_wheel0", "m_root", (0.78, 0.0, 0.30), (0.78, 0.15, 0.30)),
        ("m_wheel1", "m_root", (-0.72, 0.0, 0.30), (-0.72, 0.15, 0.30)),
        ("m_launcher", "m_root", (-0.50, -0.17, 1.44), (-0.50, -0.17, 1.59)),
        ("rid_seat", "m_root", (0.18, 0.0, 0.77), (0.23, 0.0, 1.29)),
        ("pas_seat", "m_root", (-0.42, 0.0, 0.77), (-0.37, 0.0, 1.29)),
        _death_root_bone("mw", 0.0, 0.0),
        _death_root_bone("mw_a", 0.30, -0.42),
        _death_root_bone("mw_b", -0.32, 0.46),
    ]


def _moto_rpg_rest():
    """`moto_rpg`'s whole rest scene -- machine, both riders, the launcher,
    and the wrecked/thrown death-state geometry, all built by calling
    `teams`/`kit` functions directly (never re-deriving their geometry) and
    force-bound to the topology `_moto_bone_table` declares. See this
    section's own header comment for why each binding choice was made.
    """
    parts = []
    forced = {}

    bike = teams._motorcycle("m")
    for ob in bike:
        forced[ob] = ob.name if ob.name in ("m_wheel0", "m_wheel1") else "m_root"
    parts += bike

    rider = teams._rider("rid", 0.18, hands_fwd=0.34)
    forced.update({ob: "rid_seat" for ob in rider})
    parts += rider

    passenger = teams._rider("pas", -0.42, mirror=True, hands_fwd=0.18)
    forced.update({ob: "pas_seat" for ob in passenger})
    parts += passenger

    launcher = kit.launcher("pas_rpg", (-0.50, -0.17, 1.44), yaw=math.pi,
                             pitch=MOTO_LAUNCH_PITCH, length=1.18, radius=0.075)
    forced.update({ob: "m_launcher" for ob in launcher})
    parts += launcher

    wreck_bike = teams._tip_over(teams._motorcycle("mw"))
    forced.update({ob: "mw_death_root" for ob in wreck_bike})
    parts += wreck_bike

    mw_a = kit.figure("mw_a", (0.30, -0.42, 0.0), posture="prone",
                       headgear="keffiyeh", loadout="irregular")
    forced.update({ob: "mw_a_death_root" for ob in mw_a})
    parts += mw_a

    mw_b = kit.figure("mw_b", (-0.32, 0.46, 0.0), posture="prone", mirror=True,
                       headgear="keffiyeh", loadout="irregular")
    forced.update({ob: "mw_b_death_root" for ob in mw_b})
    parts += mw_b

    return parts, _moto_bone_table(), forced


def build_team_rest(team_id):
    """Fresh scene: every figure's rest geometry for `team_id`, all bone
    tables, and any team-specific extras (props, charge_squad's own
    vest/lean geometry)."""
    assert team_id in SUPPORTED_TEAMS, (
        f"rig.py does not cover {team_id!r} -- see SUPPORTED_TEAMS and this "
        "module's own docstring for what's out of scope and why"
    )
    kit.new_scene()
    # Observe what `teams._lean_forward` actually does to this team's rest
    # geometry, rather than trusting REST_LEAN_RAD to still be right. The
    # wrapper is removed in `finally`, so a raise inside the build cannot
    # leave `teams` permanently patched for the next team in an `all` run.
    real_lean_forward = teams._lean_forward
    observed_deg = 0.0

    def _watched_lean_forward(parts, deg, at_x=0.0):
        nonlocal observed_deg
        observed_deg = max(observed_deg, abs(deg))
        return real_lean_forward(parts, deg, at_x)

    teams._lean_forward = _watched_lean_forward
    try:
        parts, bone_table, forced_bone = _build_team_rest_inner(team_id)
    finally:
        teams._lean_forward = real_lean_forward
    _check_observed_rest_lean(team_id, observed_deg)
    _check_launchers_are_bound(team_id, forced_bone)
    return parts, bone_table, forced_bone


def _check_launchers_are_bound(team_id, forced_bone):
    """A figure declaring `weapon="launcher"` must really have geometry
    force-bound to its own `forearm_R`.

    `TEAM_FIGURES` declares who holds a launcher and `TEAM_EXTRAS` builds it;
    those are two files' worth of apart, and `build_fire_clip` now keys an
    impulse off the declaration alone. Without this, a launcher moved to a
    `prop` bone (or an extras function that stopped running) would leave a
    gunner miming a launch beside a tube that stayed put -- the exact failure
    the retired docstring was worried about, arriving through the other door.

    Checked here rather than asserted in a comment, in the same spirit as
    `_check_observed_rest_lean`: this reads what `TEAM_EXTRAS` actually did.
    """
    want = {f"{spec['prefix']}_forearm_R"
            for spec in TEAM_FIGURES[team_id] if spec["weapon"] == "launcher"}
    if not want:
        return
    bound = set(forced_bone.values())
    missing = sorted(want - bound)
    if missing:
        raise RuntimeError(
            f"{team_id}: TEAM_FIGURES declares weapon='launcher' for "
            f"{missing}, but TEAM_EXTRAS force-bound nothing to those bones "
            f"(it bound {sorted(bound)}). `build_fire_clip` would key an arm "
            f"impulse with no weapon riding it. Fix the declaration or the "
            f"extras -- do not delete this check."
        )


def _build_team_rest_inner(team_id):
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
    elif team_id == "moto_rpg":
        p, b, f = _moto_rpg_rest()
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


def _key_death_visibility(pbones, figures, has_prop, alive, frame=0, moving=False):
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

    `moving` (design D6) is True only for `build_move_clip`. A figure with a
    walker (`spec["move_posture"] == "standing"`) hides its deployed
    kneeling body while moving and shows its standing walker instead; a
    figure with no walker is unaffected either way. The team's shared `prop`
    (deployed launcher/mortar) hides too, but only for a team that HAS a
    walker -- `demo_squad`/`at_team`/`mortar_team`'s crews stay deployed
    through `move` and keep their prop visible, unchanged.
    """
    alive_scale = 1.0 if alive else 0.0
    dead_scale = 0.0 if alive else 1.0
    walkers = False
    for spec in figures:
        prefix = spec["prefix"]
        has_walker = spec.get("move_posture") == "standing"
        walkers = walkers or has_walker
        # A figure with a walker shows its deployed body in every living
        # clip but `move`, where the walker shows instead (design D6).
        deployed = alive_scale if not (has_walker and moving) else 0.0
        _key_scale(pbones[f"{prefix}_root"], deployed, _VIS_FRAMES)
        _key_scale(pbones[f"{prefix}_death_root"], dead_scale, _VIS_FRAMES)
        if has_walker:
            _key_scale(pbones[f"{_walker_prefix(spec)}_root"], 1.0 if (alive and moving) else 0.0, _VIS_FRAMES)
    if has_prop:
        # The deployed launcher/mortar is carried, not modelled, while a crew
        # walks -- a tripod gliding beside a walking crew is the bug D6 fixes.
        _key_scale(pbones["prop"], 0.0 if (moving and walkers) else alive_scale, _VIS_FRAMES)


#: Per-figure gait-phase offset, as a FRACTION of one cycle (0..1), keyed by
#: a figure's 0-based position among the figures a clip is animating over --
#: not by name, since prefixes are not numbered consistently across teams
#: (`f0`/`f1`/`f2`, but also `yah_a`/`yah_b`, `mil0`/`mil1`).
#:
#: Every clip this pipeline built kept `f0`/`f1`/`f2` (and every other
#: team's figures) at byte-identical keyframes -- confirmed on
#: `inf_squad.glb`: `f0_thigh_L` and `f1_thigh_L` both 26 frames, same first
#: quaternion. The result was every squad in the game marching and
#: breathing in perfect unison, which real infantry never do -- "three
#: clones in a chorus line".
#:
#: Three fractions is enough to cover every team this pipeline builds (no
#: team has more than three walkers in `move`, or breathes with more than
#: three figures in `idle`): index 0 stays unshifted, index 1 leads by a
#: third of the cycle, index 2 by two thirds, and the mod-3 wrap in
#: `gait_phase` below covers any team that ever grows a fourth. Applied to
#: `idle` (breathing) and `move` (the gait) -- both are cycles a constant
#: phase shift is well-defined for. Deliberately NOT applied to `fire` (a
#: single recoil impulse, not a cycle) or `down`/`wreck` (a held static
#: pose, no motion at all) -- see those functions' own docstrings.
GAIT_PHASE_FRACTIONS = (0.0, 1.0 / 3.0, 2.0 / 3.0)


def gait_phase(index):
    """The phase offset, in radians, for the figure at this 0-based index
    within whichever figure list a cyclic clip (`idle`, `move`) is
    animating over."""
    return 2.0 * math.pi * GAIT_PHASE_FRACTIONS[index % len(GAIT_PHASE_FRACTIONS)]


def build_idle_clip(arm_obj, figures):
    """Breath + weight shift, every figure regardless of posture -- a
    kneeling gunner still breathes. Formula from R0, unchanged; the one
    addition is `gait_phase` below, so a multi-figure team no longer
    breathes in lockstep -- see that constant's own docstring for why."""
    _new_action(arm_obj, "idle")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=True)
    for f in range(0, IDLE_FRAMES + 1):
        t = f / IDLE_FRAMES
        base_ph = 2.0 * math.pi * t
        for i, spec in enumerate(figures):
            prefix = spec["prefix"]
            ph = base_ph + gait_phase(i)
            breathe = BREATH_AMP * math.sin(ph)
            sway = SWAY_AMP * math.sin(ph + 1.1)
            key(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"], AXIS_Y, breathe, f)
            key(pbones[f"{prefix}_pelvis"], bones[f"{prefix}_pelvis"], AXIS_X, sway, f)


def build_move_clip(arm_obj, figures, gait):
    """Full gait -- thigh/shin/arm swing, weight transfer, settle, head
    stabilisation, vertical bob -- for every figure that walks
    (`spec["animates"]`). A crew-served figure (kneeling, or `rpg_fire`,
    whose own `stride` teams.py pins to 0.0 even in `move`) gets NO keys
    here at all and so stays at `move`'s own frame-0 identity pose for the
    whole clip -- correctly: "crew-served weapons stay deployed through
    move" (teams.py's own module docstring) means the whole figure stays
    put, not just its weapon.

    Each walker's gait is offset by `gait_phase`, keyed by its index among
    `walkers` (not among `figures` -- a figure that never animates does not
    take a slot in the marching order), so a multi-walker team no longer
    steps in lockstep. `MOVE_FRAMES` still closes the same loop it always
    did: `phase` sweeps a full 2*pi across `f` regardless of figure, and
    adding a per-walker CONSTANT to it does not change that periodicity, so
    frame 0 and frame `MOVE_FRAMES` still agree for every walker. This
    changes which pose lands on which frame, never the frame count or the
    loop seam.

    `gait` is `gait_for_team`'s dict -- every amplitude comes from it rather
    than from the module constant it is named after, so a team's stride is
    sized from its own `mobility.speed_tiles_s`. At scale 1.0 the two are the
    same number (see `_check_gait_identity_at_reference`), which is what
    makes this a scaling of R0's gait rather than a second one. The printed
    line is a PREDICTION, not a verdict: what the ratio actually comes out at
    is `measureRoleTravel` on the exported bytes.

    The per-phase arithmetic itself is `gait_pose`, which this function no
    longer owns: `tools/export_meshy_sniper.py` drives its own 14-joint rig
    from the same dict rather than from a second copy. What is left here is
    the RIGGING -- one bone per entry -- which is the half that really is
    specific to `_BASE_BONES`.
    """
    _new_action(arm_obj, "move")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=True, moving=True)
    walkers = [s for s in figures if s["animates"]] + _walker_specs(figures)
    if not walkers:
        # A crew-served team keys no leg at all, so there is no stride to
        # report. The print used to sit above this return and announced a
        # predicted boot travel for three teams whose `move` is a 0.04 s clip
        # with nothing in it -- a number that read as a claim about art that
        # does not exist.
        return
    print(
        f"  gait[{gait['team']}] speed={gait['speed']} tiles/s "
        f"ground={gait['ground_m']:.3f} m/cycle want={gait['want']:.3f} "
        f"scale={gait['scale']:.3f}{' (CAPPED)' if gait['capped'] else ''} "
        f"thigh={gait['thigh']:.3f} rad lean={gait['lean']:.3f} rad "
        f"predicted boot travel={BASE_BOOT_TRAVEL_M * gait['scale']:.3f} m"
    )
    root_bob_dir = local_offset_for_world_axis(bones[f"{walkers[0]['prefix']}_root"], AXIS_Z)
    for f in range(0, MOVE_FRAMES + 1):
        base_phase = 2.0 * math.pi * f / MOVE_FRAMES
        for i, spec in enumerate(walkers):
            prefix = spec["prefix"]
            phase = base_phase + gait_phase(i)
            p = gait_pose(gait, phase)
            key(pbones[f"{prefix}_thigh_L"], bones[f"{prefix}_thigh_L"], AXIS_Y, p["thigh_l"], f)
            key(pbones[f"{prefix}_thigh_R"], bones[f"{prefix}_thigh_R"], AXIS_Y, p["thigh_r"], f)
            key(pbones[f"{prefix}_shin_L"], bones[f"{prefix}_shin_L"], AXIS_Y, p["shin_l"], f)
            key(pbones[f"{prefix}_shin_R"], bones[f"{prefix}_shin_R"], AXIS_Y, p["shin_r"], f)
            key(pbones[f"{prefix}_upperarm_L"], bones[f"{prefix}_upperarm_L"], AXIS_Y, p["arm_l"], f)
            key(pbones[f"{prefix}_upperarm_R"], bones[f"{prefix}_upperarm_R"], AXIS_Y, p["arm_r"], f)
            key(pbones[f"{prefix}_forearm_L"], bones[f"{prefix}_forearm_L"], AXIS_Y, p["elbow_l"], f)
            key(pbones[f"{prefix}_hip_L"], bones[f"{prefix}_hip_L"], AXIS_Y, p["hip_l"], f)
            key(pbones[f"{prefix}_hip_R"], bones[f"{prefix}_hip_R"], AXIS_Y, p["hip_r"], f)
            key_axes(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"],
                     [(AXIS_Y, p["lean"]), (AXIS_Z, p["shoulder_twist"])], f)
            key(pbones[f"{prefix}_pelvis"], bones[f"{prefix}_pelvis"], AXIS_Z, p["hip_twist"], f)
            key(pbones[f"{prefix}_head"], bones[f"{prefix}_head"], AXIS_Z, p["head_counter"], f)
            pb_root = pbones[f"{prefix}_root"]
            pb_root.location = root_bob_dir * p["bob"]
            pb_root.keyframe_insert(data_path="location", frame=f)


def _recoil_curve(p):
    if p <= FIRE_RISE:
        t = p / FIRE_RISE
    else:
        t = 1.0 - (p - FIRE_RISE) / (1.0 - FIRE_RISE)
    return max(0.0, t)


def build_fire_clip(arm_obj, figures, extra_root_lean=None):
    """One shot, for every figure carrying a hand-bound weapon -- raise and
    recoil for a rifle, a brace and a settle for a launcher. Plus, if
    `extra_root_lean` names any prefixes (charge_squad only), a flat extra
    forward lean on `root` for those prefixes -- see FIRE_ROOT_LEAN's own
    comment for why this is a constant, not an impulse.

    Still deliberately NOT applied to a figure whose weapon is a FREE-STANDING
    GROUND MOUNT (mortar, ATGM tripod, demolition charge): those bind to the
    team's static `prop` bone, so an arm that moved would leave the weapon
    behind. That half of the original reasoning stands.

    The other half did not. Until this pass this function also skipped
    `at_fire` and `rpg_fire`, on the stated grounds that "teams.py never
    varies their launcher's position by clip" -- but `_at_extras`/
    `_rpg_extras` bind both tubes to their firer's own `forearm_R`, exactly
    as `_weapon_parts` binds a rifle, so a launcher DOES move with the arm
    and the objection was about the sprite pipeline rather than about this
    one. `at_team` was the visible cost: no rifle on the team meant no
    shooter, no `fire` clip in the GLB at all, and an anti-tank team standing
    motionless while a Spike left the tube. See `LAUNCH_SPINE`'s own comment
    for what a launcher's impulse is and why it is not the rifle's.

    Not phase-offset the way `build_idle_clip`/`build_move_clip` are:
    `_recoil_curve` is one rise-and-settle impulse per shot, not a cycle, so
    there is no phase for `gait_phase` to mean here -- every shooter fires
    on the same beat, which is correct (nothing about muzzle timing should
    be desynchronised the way a gait or a breath is).
    """
    _new_action(arm_obj, "fire")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=True)
    shooters = [s for s in figures if s["weapon"] == "rifle"]
    launchers = [s for s in figures if s["weapon"] == "launcher"]
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
        for spec in launchers:
            prefix = spec["prefix"]
            key(pbones[f"{prefix}_upperarm_R"], bones[f"{prefix}_upperarm_R"], AXIS_Y,
                LAUNCH_SHOULDER * kick, f)
            key(pbones[f"{prefix}_forearm_R"], bones[f"{prefix}_forearm_R"], AXIS_Y,
                LAUNCH_ELBOW * kick, f)
            key(pbones[f"{prefix}_spine"], bones[f"{prefix}_spine"], AXIS_Y,
                LAUNCH_SPINE * kick, f)
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

    Not phase-offset either, for the simplest possible reason: nothing here
    moves at all, so there is no cycle for `gait_phase` to shift.
    """
    _new_action(arm_obj, clip_name)
    pbones = arm_obj.pose.bones
    figures = TEAM_FIGURES[team_id]
    _key_death_visibility(pbones, figures, "prop" in pbones, alive=False)


def build_sniper_clips(arm_obj, gait):
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

    build_move_clip(arm_obj, figures, gait)

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


def _key_moto_visibility(pbones, alive):
    """`m_root` (the whole living machine -- wheels, launcher, both riders,
    all of which are its children, see `_moto_bone_table`) versus the three
    wreck bones (`mw_death_root`, `mw_a_death_root`, `mw_b_death_root`) --
    the same living/dead scale toggle `_key_death_visibility` gives every
    other team's figure, keyed by hand here because `moto_rpg` never goes
    through `_add_figure`/`TEAM_FIGURES`'s per-figure shape (see
    `_moto_rpg_rest`). Every clip calls this, not just `wreck`, for the same
    leftover-value reason `_key_death_visibility`'s own docstring gives.
    """
    alive_scale = 1.0 if alive else 0.0
    dead_scale = 0.0 if alive else 1.0
    _key_scale(pbones["m_root"], alive_scale, _VIS_FRAMES)
    _key_scale(pbones["mw_death_root"], dead_scale, _VIS_FRAMES)
    _key_scale(pbones["mw_a_death_root"], dead_scale, _VIS_FRAMES)
    _key_scale(pbones["mw_b_death_root"], dead_scale, _VIS_FRAMES)


def build_moto_idle_clip(arm_obj):
    """Breath only -- the machine and its riders are otherwise static at a
    stop, matching every other team's idle (no clip changes a rider's own
    pose; see this section's header comment). Each rider's whole rigid
    `{prefix}_seat` sways together, the same amplitude/phase
    `build_idle_clip` gives every other figure's spine."""
    _new_action(arm_obj, "idle")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_moto_visibility(pbones, alive=True)
    for f in range(0, IDLE_FRAMES + 1):
        t = f / IDLE_FRAMES
        breathe = BREATH_AMP * math.sin(2.0 * math.pi * t)
        key(pbones["rid_seat"], bones["rid_seat"], AXIS_Y, breathe, f)
        key(pbones["pas_seat"], bones["pas_seat"], AXIS_Y, breathe, f)


def build_moto_move_clip(arm_obj):
    """`m_root`'s bob (translation) and dip (pitch) -- `MOTO_BOB`/`MOTO_DIP`
    generalise `teams.moto_rpg`'s own 4-frame `(0, +a, 0, -a)` cycle into a
    smooth sine at the same amplitude, over this file's own `MOVE_FRAMES` so
    the clip is the same length as every other team's gait. Both riders ride
    along for free, being `m_root`'s children -- neither is keyed here.
    Both wheels spin `MOTO_TURNS` full turns across the same span, ending on
    an exact multiple of 360 deg so the `LoopRepeat` seam is invisible (see
    the header comment)."""
    _new_action(arm_obj, "move")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_moto_visibility(pbones, alive=True)
    root_bob_dir = local_offset_for_world_axis(bones["m_root"], AXIS_Z)
    pb_root = pbones["m_root"]
    for f in range(0, MOVE_FRAMES + 1):
        phase = 2.0 * math.pi * f / MOVE_FRAMES
        bob = MOTO_BOB * math.sin(phase)
        dip = MOTO_DIP * math.sin(phase)
        key(pb_root, bones["m_root"], AXIS_Y, dip, f)
        pb_root.location = root_bob_dir * bob
        pb_root.keyframe_insert(data_path="location", frame=f)
        wheel_angle = MOTO_TURNS * 2.0 * math.pi * f / MOVE_FRAMES
        key(pbones["m_wheel0"], bones["m_wheel0"], AXIS_Y, wheel_angle, f)
        key(pbones["m_wheel1"], bones["m_wheel1"], AXIS_Y, wheel_angle, f)


def build_moto_fire_clip(arm_obj):
    """The one pose change `teams.moto_rpg` actually authors for `fire`:
    the launcher levels out. Rest already bakes the OTHER, more common
    pitch (30 deg, shared by idle and move) into the geometry, so this is a
    single keyed delta on `m_launcher` alone -- a static two-frame clip
    (`_VIS_FRAMES`), the same shape `build_death_clip` uses for a pose with
    no internal motion of its own."""
    _new_action(arm_obj, "fire")
    bones = arm_obj.data.bones
    pbones = arm_obj.pose.bones
    _key_moto_visibility(pbones, alive=True)
    for f in _VIS_FRAMES:
        key(pbones["m_launcher"], bones["m_launcher"], AXIS_Y, -MOTO_LAUNCH_PITCH, f)


def build_moto_wreck_clip(arm_obj):
    """Visibility only -- see `_key_moto_visibility` and this section's
    header comment for why three bones, not one, switch on together."""
    _new_action(arm_obj, "wreck")
    pbones = arm_obj.pose.bones
    _key_moto_visibility(pbones, alive=False)


def build_moto_clips(arm_obj):
    build_moto_idle_clip(arm_obj)
    build_moto_move_clip(arm_obj)
    build_moto_fire_clip(arm_obj)
    build_moto_wreck_clip(arm_obj)
    # No `down` -- TEAM_CLIP_DROP already drops it from the sprite sheet for
    # the same reason ("a motorcycle cannot go prone"); the mesh drops it too.


def build_clips(arm_obj, team_id):
    if team_id == "sniper_team":
        build_sniper_clips(arm_obj, gait_for_team(team_id))
        return
    if team_id == "moto_rpg":
        # No `build_move_clip`, so no stride to size: `moto_rpg` is a machine
        # whose riders' boots never move, and `build_moto_move_clip` spins
        # wheels instead. Rate-matching that spin to the bike's own 3.4
        # tiles/s is the design's own named follow-up, not this pass.
        build_moto_clips(arm_obj)
        return
    figures = TEAM_FIGURES[team_id]
    build_idle_clip(arm_obj, figures)
    build_move_clip(arm_obj, figures, gait_for_team(team_id))
    # Any hand-bound weapon, rifle or launcher -- see `build_fire_clip`. This
    # condition read `== "rifle"` until this pass, which is why `at_team`
    # shipped four clips where every other team ships five.
    armed = [s for s in figures if s["weapon"]]
    leaners = FIRE_ROOT_LEAN.get(team_id)
    if armed or leaners:
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
    owned_path = os.path.join(OUT_DIR, f"{team_id}.glb")
    path = out_path or owned_path
    # Keyed on the resolved PATH, never on `out_path is None`. The first
    # version of this guard fired only on the absent argument, so
    # `build_and_export(team, out_path=owned_path)` -- the shape any loop
    # script naturally takes, including this task's own probes -- walked
    # straight through it.
    assert_kit_owns_path(
        team_id, require_owner(TEAM_MESH_OWNER, team_id, "TEAM_MESH_OWNER"),
        path, owned_path,
    )
    parts, bone_table, forced_bone = build_team_rest(team_id)
    arm_obj = build_armature(bone_table)
    figure_prefixes = {spec["prefix"] for spec in TEAM_FIGURES[team_id]}
    figure_prefixes |= {s["prefix"] for s in _walker_specs(TEAM_FIGURES[team_id])}
    rig_parts(parts, arm_obj, forced_bone, figure_prefixes)
    merged = join_by_role(parts)
    build_clips(arm_obj, team_id)
    export_glb(arm_obj, path)
    return arm_obj, merged, path


def print_crew_gait_table(team_ids):
    """The numbers the project lead approves BEFORE Blender renders a crew
    walker (memory: approve art numbers before rendering): standing height,
    the stride `gait_amplitudes` sizes from the unit's own speed, whether
    the thigh cap clipped it, and the cycle length."""
    print("team          speed  ground/cycle  stride scale  capped  cycle s  standing m")
    for team_id in team_ids:
        g = gait_for_team(team_id)
        print(
            f"{team_id:12s}  {g['speed']:5.2f}  {g['ground_m']:12.3f}  {g['scale']:12.3f}  "
            f"{'yes' if g['capped'] else 'no ':6s}  {move_seconds():7.3f}  {kit.FIGURE_H:10.3f}"
        )
