"""Retarget the supplied Meshy irregular-fighter rig (seven single-clip
`*_withSkin.glb` exports, one mesh, one 24-joint Mixamo-style skeleton --
IDENTICAL joint names/hierarchy to `import_meshy_soldier.py`'s own KDF
source) into ONE contract-compliant team file: `art/meshes/sarim_rifles.glb`,
per `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` (v1, infantry).

This is a SIBLING of `import_meshy_soldier.py`, not a rewrite: it inherits
that script's five hard-won mechanisms unchanged --

  1. Forward is fixed POST-export, on the glTF node graph (`apply_forward_fix`),
     never by baking a rotation into the Blender armature (`fix_forward` stays
     a documented no-op, same reasoning). FORWARD_FIX_DEG here is a working
     hypothesis (this rig shares the old one's exact bone names, hierarchy,
     and `headfront`/`Head` marker relationship, strongly suggesting the same
     exported-facing convention) and MUST be confirmed by the same live
     in-game measurement the KDF asset needed, not assumed from the marker
     alone -- see the task report for the actual number measured.
  2. `CLIP_SEMANTICS` + `check_clip_semantics` gate every clip's Hips travel
     at build time. Measured travel (x100, this rig, `.superpowers/
     sarim-irregular-report.md` has the full table): idle 0.955, move 6.371,
     Side_Shot 14.14 (a hit reaction, NOT `fire` -- the exact same trap
     `import_meshy_soldier.py`'s own docstring warns about, on a clip of the
     SAME name), Walk_Forward_While_Shooting 5.53 (real gait travel, also
     disqualified from `fire`'s near-zero ceiling). Neither supplied clip
     means "stand and shoot" or "gone to ground"; `fire` and `down` are
     synthesized exactly the way the KDF script already solved this.
  3. `down` is a held pose, not a fall -- synthesized from `idle`'s own last
     frame plus authored bends, LoopRepeat, never retargeted from a fall clip.
  4. Armature-join ordering: meshes-per-role FIRST, then armatures.
  5. Where a hand-rolled BVH nearest-point weight transfer would be needed
     (`bpy.ops.object.data_transfer` returns FINISHED and does nothing, in
     this same headless Blender 5.2) -- NOT needed here. Unlike the KDF
     source, THIS mesh's own base-colour texture carries genuine, separable
     material zones (chest rig / harness / hip pouch, boots, a keffiyeh
     headwrap, and a small visible-skin sliver at the wrap's eye gap) --
     confirmed by direct visual highlight renders during this task, not
     assumed from colour statistics alone (raw per-vertex k-means at k up to
     10 did NOT cleanly separate them; a combined colour+position feature at
     k=14, visually confirmed by re-colouring the actual mesh and rendering
     it, did). `webbing` here is real source geometry, so `kit.py`'s
     irregular-loadout graft (available, per the task brief, if this source
     had none) was not needed. See `_ROLE_CENTROIDS_14` and
     `classify_vertex_roles` below for exactly what that confirmation found
     and how it is applied.

## Source clips, and why each canonical clip maps where it does

    Running_withSkin.glb                       -> move     (real gait, 5.534 --
                                                             bound 2026-09-16,
                                                             see below)
    Idle_02_withSkin.glb                       -> idle     (near-zero, 0.955)
    Walk_Forward_While_Shooting_withSkin.glb   -> moveFire, ONE FRAME ONLY
                                                            (the firing upper
                                                             body; its legs are
                                                             discarded. Bound
                                                             WHOLE from
                                                             2026-09-06 until
                                                             2026-09-16 -- see
                                                             below for the 13.27x
                                                             that retired that,
                                                             and for why this
                                                             needed a new
                                                             `ClipName`, not a
                                                             `fire` slot)
    Shot_and_Slow_Fall_Backward_withSkin.glb   -> wreck    (last frame only)
    Shot_and_Fall_Forward_withSkin.glb         -> wreckAlt (last frame only --
                                                             bound 2026-09-06,
                                                             free variation,
                                                             see FALL_SOURCE_ALT)
    Walking_withSkin.glb                        UNUSED    (was `move` until
                                                          2026-09-16; measured
                                                          6.371 x100 Hips
                                                          travel and a gait
                                                          ratio of 0.332 --
                                                          see below)
    Side_Shot_withSkin.glb                      UNUSED  (measured 14.14 x100
                                                          Hips travel, ~15x
                                                          idle -- a hit
                                                          reaction, same trap
                                                          as the KDF source's
                                                          identically-named
                                                          clip. Read by
                                                          nothing here.)

## `move` is the RUN, and the note that used to forbid it was wrong

This table said, until 2026-09-16, that `Running_withSkin.glb` was UNUSED and
"needs a 'fleeing' signal that does not reach the renderer -- GH-152's
blocker. Do not bind this until that signal exists." **The premise is false as
measured, so the note is overridden rather than worked around.** A
`sarim_rifles` has exactly ONE speed -- `data/units/enemy/sarim_rifles.json`'s
`mobility.speed_tiles_s` is 0.9, and `MESH_UNITS_PER_TILE` is 3.0, so it
crosses the ground at **2.7 m/s**. That is a run. There is no walk speed for a
walk clip to be the honest picture of, so no runtime signal is needed to
distinguish the two states: `move` IS the run, and playing a stroll over 2.7
m/s of travel is the "walking nonchalantly" half of the project lead's
complaint (`docs/superpowers/specs/2026-09-15-infantry-gait-design.md` sections
2.2 and 3.2).

Measured on the shipped bytes with `tools/src/mesh_gait.ts` -- boot travel over
one `move` cycle against the ground the sim covers in that same time, where 1.0
means the feet exactly keep up:

    Walking (before)   cycle 1.0417 s   ground 2.812 m   boot 0.934 m   0.332
    Running (after)    cycle 0.6250 s   ground 1.688 m   boot 1.357 m   0.804

A 2.4x improvement, out of a clip that was already on disk. The residual under
1.0 is what the design's D4 rate-match is for; no gait threshold is asserted
anywhere for this asset, deliberately, because the playback rate is about to
change and an assertion written now would have to be rewritten immediately.

`Running` is also the BASE import now (it supplies the scratch mesh and
armature every other clip is replayed onto), which is only sound because the
supplied mesh is the same one in both files. That is measured, not assumed:
`POSITION`/`NORMAL`/`TEXCOORD_0`/`JOINTS_0`/`WEIGHTS_0` of the 16 557-vertex
`char1` mesh, and the 24 649 532-byte base-colour image beside it, hash
IDENTICAL between `Walking_withSkin.glb` and `Running_withSkin.glb`. So
`_ROLE_CENTROIDS_14` -- fit against `Walking`'s own scratch mesh -- classifies
bit-identically either way.

## `moveFire` is a RUN-and-shoot now, and it had to be SYNTHESIZED

Binding `move` to `Running` above left `moveFire` bound whole to
`Walk_Forward_While_Shooting`, which was consistent while `move` was also a
walk and stopped being so the moment it was not. **That inconsistency was a
regression and this is its fix**, not a second improvement: measured on the
shipped bytes, that clip declares a stride of **0.6614 m over a 3.25 s cycle**
-- and that is one REAL gait cycle of a 0.2 m/s creeping advance, traced boot
vertex by boot vertex, not a mis-identified multi-cycle clip. The design's D4
rate-match reads a clip's own declaration and sets playback from it, so it
would have to play this one at **13.27x**, finishing 3.25 s of animation in
245 ms. The next worst multiplier in the whole tree is 2.60. A Sarim fighter
advancing under fire would either creep or flicker, and widening the runtime
clamp far enough to swallow 13.27 would disable rate-matching for every other
unit in the game.

**The Meshy pack for this rig ships no run-and-shoot source.** The KDF rig has
`Run_and_Shoot_withSkin.glb` and `import_meshy_soldier.py` binds it; there is
no counterpart here, and that asymmetry is the whole reason `moveFire` is now
built rather than bound. `build_move_fire_src` puts the supplied firing upper
body on `Running`'s own legs -- read that function for the construction, for
the two numbers that force each half of it, and for the arm-chain aim solve
that was measured here and rejected. What comes out, against both references:

                              face    weapon   face-to-weapon gap   stride/cycle
    old moveFire (the walk)  +24.86   -1.92         -26.78          0.6614 / 3.25
    KDF rig's Run_and_Shoot  +10.82   +0.31         -10.51             (its own)
    this, synthesized         -0.10   -1.92          -1.82          1.357 / 0.625

Same legs as `move`, so the same stride and the same 1.24x multiplier, and the
smallest face-to-weapon gap of any firing clip in the tree.

Why a firing GAIT needs a `ClipName` of its own at all, which is unchanged by
the above: it measured 5.53 x100 Hips travel -- real gait travel, disqualified
from `fire`'s near-zero-Hips ceiling by the same logic `move` itself would be
-- and a glTF animation can only be bound under ONE `ClipName` per file
(`buildMeshUnitTemplate`'s `clips` is a `Map` keyed by name, so a second
`move`-named or `fire`-named clip would silently overwrite whichever import ran
first, never coexist). Hence a new `ClipName` member, `moveFire`, added to
`packages/render/src/sheet.ts` the same way `work` was added for
`yahalom_squad` -- an extension proposed and documented against the pinned
contract, not an improvisation outside it. The
renderer plays it only when a unit is both moving and has fired recently
(`resolveMeshMotionClip`, `packages/render/src/three/units/mesh-anim.ts`),
falling back to plain `move` for the fifteen other infantry teams whose GLBs
never authored it.

`wreckAlt` is free variation on the SAME reasoning: two falls existed, one
was already spoken for (see the visual-judgement call above), and the second
reads as a perfectly good, merely DIFFERENT corpse. Picked per living entity
by a deterministic hash in the renderer (`pickDeathClip`, same module) rather
than assigned at export time, so a replay shows the same fall for the same
entity every time.

`fire` and `down` are synthesized by the exact same functions
`import_meshy_soldier.py` already built and proved (`build_fire_src`,
`build_down_src`, `_FIRE_RECOIL_BONES`, `_FIRE_CYCLE`, `_CROUCH_BENDS`,
`_CROUCH_HIPS_DROP_M`) -- copied verbatim, not re-derived, because this rig
shares the donor rig's exact bone names AND (confirmed by rendering the
result, not assumed) produces a comparable, non-self-intersecting pose. See
the task report for the render check.

The texture question (this GLB ships palette-painted, zero materials, while
the source carries a Meshy bake) is left exactly as it was -- that call
belongs to the project lead, per the same "used as is unless I provide other
instruction" rule CLAUDE.md records for the three textured buildings, and
this task does not extend that exemption to infantry on its own authority.

No `mathutils.noise` anywhere in this file.
"""
import json
import math
import os
import struct
import sys
import tempfile

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

#: Three pure helpers only -- `_wrap_deg`, `_circular_mean_deg` and
#: `_clip_frame_positions` -- shared rather than copied because none of them
#: depends on any constant either file owns, and two implementations of a
#: circular mean is exactly how two files come to disagree about what "the
#: bearing" is. The three bearing functions BELOW are deliberately NOT shared:
#: each closes over `FORWARD_FIX_DEG`, and this file owns its own, so importing
#: the donor's would silently measure this asset through the donor's constant.
#: (`import_meshy_civilians.py` already imports this module the same way; it
#: has no module-level side effects, only constants and definitions.)
import import_meshy_soldier as soldier  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
#: Corrected 2026-09-06: the supplied asset actually lives one level deeper,
#: under an "enemy" grouping folder alongside the other Meshy character
#: sources (`art/blend/enemy/Sarim irregular/...`) -- this constant's own
#: original value omitted "enemy" and would fail FileNotFoundError from a
#: fresh checkout that actually has `art/blend` populated. Verified against
#: the real directory, not assumed.
SRC_DIR = os.path.join(
    REPO, "art", "blend", "enemy", "Sarim irregular", "Meshy_AI_irregular_fighter_rig_biped"
)
OUT_PATH = os.path.join(REPO, "art", "meshes", "sarim_rifles.glb")

#: Clip build order -- also the order clips appear in the merged file.
#: `moveFire`/`wreckAlt` added 2026-09-06 (queue item: "improve smoke
#: animation" backlog's sibling task, the Sarim irregular clip census) --
#: see the module docstring's "Source clips" table for what each binds and
#: `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`'s v1 "Clips"
#: section, extended the same way `work` was: a new `ClipName` member,
#: proposed and documented rather than improvised outside the contract.
CLIP_ORDER = ("idle", "move", "fire", "moveFire", "down", "wreck", "wreckAlt", "fall", "fallAlt")

#: The clips that actually loop at runtime. Identical shape to
#: `import_meshy_soldier.py`'s own `CYCLIC_CLIPS` -- see that file's
#: `write_combined_clip` for why this is what makes a per-figure phase
#: shift well-defined, and why `fire`/`down`/`wreck`/`wreckAlt` are excluded.
#: `moveFire` is a real gait cycle (same shape as `move`, just with the rifle
#: raised) so it gets the same per-figure phase offset `move` does.
CYCLIC_CLIPS = frozenset({"idle", "move", "moveFire"})

CLIP_SOURCES = {
    # `Running`, not `Walking`, since 2026-09-16 -- see the module docstring's
    # "`move` is the RUN" section for the speed that settles it and for the
    # hashes proving the two files carry the same mesh, which is what makes
    # this file's role classification indifferent to the swap.
    "move": "Meshy_AI_irregular_fighter_rig_biped_Animation_Running_withSkin.glb",
    "idle": "Meshy_AI_irregular_fighter_rig_biped_Animation_Idle_02_withSkin.glb",
}

#: `Walk_Forward_While_Shooting.glb`, imported under a name that does not claim
#: `moveFire`. Read by exactly one caller: `build_move_fire_src`, which takes
#: ONE frame of it -- the firing upper body -- and discards its legs. Not
#: folded into `CLIP_SOURCES` above, for the same reason `FALL_SOURCE` is not:
#: that dict's keys are canonical `ClipName`s (`mesh-anim.ts`'s
#: `isMeshClipName`) whose source file is bound WHOLE, and this one no longer
#: is. It WAS, from 2026-09-06 until 2026-09-16 -- see the module docstring's
#: "`moveFire` is a RUN-and-shoot now" section for the 13.27x playback
#: multiplier that retired that binding.
FIRING_POSE_SOURCE = (
    "Meshy_AI_irregular_fighter_rig_biped_Animation_Walk_Forward_While_Shooting_withSkin.glb"
)

#: Read by `build_wreck_src`, for `wreck`'s own last-frame corpse pose. See
#: the module docstring for why this file (not `Shot_and_Fall_Forward`) was
#: chosen as the PRIMARY fall -- a rendered, visually-judged call, not the
#: lower-Hips-Z number alone.
FALL_SOURCE = "Meshy_AI_irregular_fighter_rig_biped_Animation_Shot_and_Slow_Fall_Backward_withSkin.glb"

#: The second fall, bound 2026-09-06 as `wreckAlt` -- free variation, not a
#: replacement for `FALL_SOURCE`. Its own last frame was rendered and
#: rejected for the PRIMARY `wreck` slot (see the module docstring: "reads
#: as a body still curled mid-tumble, knees drawn up, not a settled corpse"),
#: but "not the best single corpse pose" and "not worth shipping as visual
#: variety" are different questions -- a squad of three that always collapses
#: identically is the same "three clones in a chorus line" `rig.py`'s own
#: `GAIT_PHASE_FRACTIONS` was written to fix, applied here to death instead
#: of gait. Picked per living ENTITY, not per figure within a squad -- see
#: `packages/render/src/three/units/mesh-anim.ts`'s `pickDeathClip`.
FALL_SOURCE_ALT = "Meshy_AI_irregular_fighter_rig_biped_Animation_Shot_and_Fall_Forward_withSkin.glb"

#: Design D3 (`2026-09-17-infantry-animation-design.md`): the supplied fall is
#: bound WHOLE as `fall`, one-shot, with its horizontal root motion held
#: (`hold_hips_horizontal`), and `wreck` is that held clip's own last frame
#: -- so the runtime's switch from the finished fall to the persistent wreck
#: moves nothing. `FALL_SOURCE`/`FALL_SOURCE_ALT` are therefore read by two
#: builders now.
FALL_STAGGER_S = 0.1
#: Clips whose figures start `FALL_STAGGER_S` apart (holding their first
#: frame) so a squad does not drop as three clones. Non-cyclic by nature.
STAGGERED_CLIPS = frozenset({"fall", "fallAlt"})
#: Metres the Hips may drift horizontally across a fall after the hold --
#: the runtime gate (`tools/src/mesh_gait.test.ts`) uses the same 0.05.
FALL_HORIZONTAL_CEILING_M = 0.05

#: Same semantics table `import_meshy_soldier.py` already built and proved.
#: See that file's own `CLIP_SEMANTICS` docstring for the two prior
#: instances this exists to catch a third of; this task found and avoided a
#: THIRD-AND-FOURTH instance on ITS OWN source before ever touching this
#: table (`Side_Shot` -> hit reaction again, `Walk_Forward_While_Shooting`
#: -> real gait, neither mapped to `fire`).
#:
#: `heading` and `weapon` are the SECOND and THIRD halves, added 2026-09-16 to
#: match the shape `import_meshy_soldier.py` established -- one gate, two
#: files, not two gates. Each is `{mean_deg, spread_deg}` in the exported
#: file's own convention (`_exported_bearing_deg`: forward is `+X` is 0,
#: positive is the figure's left), or `None` for exempt, and BOTH halves of
#: each are checked because they catch different things:
#:
#:   * `mean_deg` catches a clip bound facing the wrong way -- the KDF
#:     rifleman's `fire` at -156, which a Hips-travel ceiling cannot see at
#:     all (a man standing still while shooting backwards travels zero).
#:   * `spread_deg` catches a clip that TURNS. A mean is exactly the wrong
#:     summary for a sweep: `Gun_Hold_Left_Turn` on the donor rig averages
#:     -57 while sweeping 182 deg.
#:
#: Why BOTH bearings, and why this file's face half is not the fig leaf it is
#: on the donor. There, `build_idle_src` yaws the hold by the circular mean of
#: exactly the face bearings the gate then tests, so the face half is zero by
#: construction on three clips and only the weapon half can fail. **Nothing in
#: this file yaws anything** -- every clip is the supplied mocap, sampled -- so
#: both halves are independent readings here and either can go red.
#:
#: Every ceiling below is set from a measurement of THIS asset's own sources
#: (Blender probe, 2026-09-16), stated beside the value it bounds, and taken
#: with `_face_bearing_deg`/`_weapon_bearing_deg` -- NOT with `measureFacing`,
#: which reads this rig 12-17 deg differently for the reason
#: `_face_bearing_deg` records.
CLIP_SEMANTICS = {
    "idle": {
        "means": "standing hold, minimal motion -- the baseline every other clip is measured against.",
        "ceiling": lambda idle_travel: None,
        # `Idle_02` measures face -1.07, spread 0.64 -- this rig's supplied
        # hold already faces forward, which is why the donor's whole
        # trim-and-yaw mechanism has no counterpart here and must not be
        # ported in. 20/20 matches the donor's own idle ceiling.
        "heading": {"mean_deg": 20.0, "spread_deg": 20.0},
        # Measures +10.32, spread 2.67. The supplied hold is a near-axis
        # carry, unlike the donor's, whose rifle sits 37 deg across the body
        # and forced that file's ceiling out to 50. 25 is 2.4x the
        # measurement and nowhere near a carry- or backwards-sized defect.
        "weapon": {"mean_deg": 25.0, "spread_deg": 15.0},
    },
    "move": {
        "means": "a real gait cycle -- Hips travel is EXPECTED here, unlike every other clip in this table.",
        "ceiling": lambda idle_travel: None,
        # `Running` measures face -0.10, spread 4.87 -- BETTER than the
        # retired `Walking`, which read -2.72. A head bobs and counter-rotates
        # through a stride, so the spread bound is looser than idle's.
        "heading": {"mean_deg": 20.0, "spread_deg": 30.0},
        # EXEMPT, and measured rather than waved through. The rifle is
        # present -- it is sculpted into the one skinned mesh, in every clip
        # -- but `Running` carries it one-handed at the side and swings that
        # arm through the stride, so the weapon bearing spreads **203.38 deg**
        # over the cycle. There is no single heading for a ceiling to mean
        # anything against. (`Walking` was 148.43: also unbindable.)
        "weapon": None,
    },
    "fire": {
        "means": "stand and shoot; recoil is upper-body only, so Hips travel must not exceed idle's own.",
        "ceiling": lambda idle_travel: idle_travel + 0.5,
        # Synthesized from `idle`'s own last frame, so it inherits that clip's
        # face: measures -1.39, spread 0.04 (`_FIRE_RECOIL_BONES` touches
        # `Spine02` and the weapon-side arm, which is pitch and not yaw).
        "heading": {"mean_deg": 20.0, "spread_deg": 15.0},
        # Measures +7.82, spread 5.82, the spread being `_FIRE_CYCLE`'s own
        # recoil. **This rig needs no aim solve** -- the donor's
        # `_FIRE_AIM_BONES` exists because its carry held the weapon 36.65 deg
        # off the face; this one's supplied hold is already within 10 deg of
        # the axis, so there is nothing to correct and nothing was ported. 20
        # is 2.6x the measurement, clear of the donor's -36.65 carry class and
        # far from the +143 backwards class.
        "weapon": {"mean_deg": 20.0, "spread_deg": 15.0},
    },
    "moveFire": {
        "means": (
            "a real gait cycle WHILE firing -- the RUN's own legs under the supplied "
            "walk-and-shoot's firing upper body (`build_move_fire_src`). Hips travel is "
            "EXPECTED here, exactly like `move` and equal to it -- this is NOT `fire`'s "
            "near-zero-Hips shape."
        ),
        "ceiling": lambda idle_travel: None,
        # The head comes from `Running` and is re-seated to the orientation it
        # holds there, so this measures **-0.10 with a spread of 4.87** -- the
        # `move` clip's own numbers, to the hundredth, which is the check that
        # the head really did come from the run. Same ceiling as `move` for
        # that reason. It used to be 40/20, for a clip that read +24.86: the
        # supplied walk-and-shoot is genuinely bladed, and the design records
        # that for this asset as "bladed but not broken". The synthesized
        # replacement is squarer, so the looser ceiling is no longer earned and
        # is not kept.
        "heading": {"mean_deg": 20.0, "spread_deg": 30.0},
        # Measures **-1.92 with a spread of 0.00**, and the two halves of that
        # have different standing. The MEAN is the supplied walk-and-shoot's
        # own, inherited whole from the frame `build_move_fire_src` borrows --
        # a real reading of real authored firing geometry, and it moves if that
        # source is re-supplied or a different frame is chosen, so this ceiling
        # can genuinely fail. The SPREAD is 0 BY CONSTRUCTION, because that
        # function re-seats the torso to a fixed armature-space orientation and
        # the weapon is therefore rigid through the cycle; 15 is inherited from
        # the entry this replaces rather than fitted to a zero, and it is not
        # evidence of anything. Compare `move`, whose weapon is exempt at a
        # spread of 203.
        "weapon": {"mean_deg": 10.0, "spread_deg": 15.0},
    },
    "down": {
        "means": (
            "a HELD pose -- suppression, looped indefinitely, AND the first phase of death "
            "(mesh-death.ts plays this before wreck) -- near-zero Hips travel, well under idle's."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
        # Two identical keyframes, so the spread is 0 by construction. The
        # mean measures +1.41 -- `idle`'s own, moved 2.5 deg by
        # `_CROUCH_BENDS`' spine and neck flexion, which is pitch not yaw.
        "heading": {"mean_deg": 25.0, "spread_deg": 5.0},
        # Measures +8.69, spread 0.00 -- `idle`'s carry with the torso folded
        # on top of it.
        "weapon": {"mean_deg": 25.0, "spread_deg": 10.0},
    },
    "wreck": {
        "means": "a HELD corpse pose -- same requirement as down: static, near-zero Hips travel.",
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
        # EXEMPT from BOTH bearing checks, for two independent reasons, and
        # this is not an oversight to tidy up later.
        #
        #   1. A body thrown round by the round that killed it lies where the
        #      blast put it. Facing is not a property a corpse owes anyone.
        #   2. NEITHER BEARING IS MEASURABLE on a figure lying down. Both
        #      forward vectors are then nearly vertical, and the ground-plane
        #      projection of a nearly-vertical vector is noise. The two
        #      instruments bear that out on this asset the same way the donor
        #      recorded it: `wreck` reads +80.72 here and +117.4 through
        #      `measureFacing`, and `wreckAlt` reads -165.29 here and +140.3
        #      there -- 37 and 54 deg apart, against 12-17 on every standing
        #      clip. A "wider ceiling" would be gating noise.
        "heading": None,
        "weapon": None,
    },
    "wreckAlt": {
        "means": (
            "a SECOND held corpse pose (the forward fall, free variation) -- "
            "same requirement as wreck: static, near-zero Hips travel."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
        # Exempt for exactly `wreck`'s two reasons; see that entry.
        "heading": None,
        "weapon": None,
    },
    "fall": {
        "means": (
            "the supplied death fall, played ONCE by mesh-death.ts from standing to prone; "
            "Hips DROP by design (no vertical ceiling) but may not travel horizontally."
        ),
        "ceiling": lambda idle_travel: None,
        "horizontal_m": FALL_HORIZONTAL_CEILING_M,
        # A falling body turns; neither bearing is a thing to gate.
        "heading": None,
        "weapon": None,
    },
    "fallAlt": {
        "means": (
            "the SECOND supplied fall, the forward one, paired with wreckAlt; played ONCE by "
            "mesh-death.ts from standing to prone; Hips DROP by design (no vertical ceiling) "
            "but may not travel horizontally."
        ),
        "ceiling": lambda idle_travel: None,
        "horizontal_m": FALL_HORIZONTAL_CEILING_M,
        # A falling body turns; neither bearing is a thing to gate.
        "heading": None,
        "weapon": None,
    },
}

#: `teams.inf_squad`'s own spread, copied verbatim from `import_meshy_soldier.py`.
FIGURE_SPREAD = (
    ("f0", 0.0, -0.78),
    ("f1", 0.20, 0.0),
    ("f2", 0.0, 0.78),
)

# --- role classification -----------------------------------------------
#
# Unlike the KDF source (whose texture carried no separable webbing/metal
# signal at all -- pure per-vertex colour, k up to 10, found nothing but
# directional-shading luminance bands), THIS texture's raw per-vertex colour
# is ALSO dominated by a baked tan/brown shading ramp (k-means at k=6/8/10 on
# colour alone found the same "scattered, luminance-only" shape) but a small
# number of genuinely distinct material zones exist underneath it: a chest
# rig / harness / hip pouch (dark, torso-height), boots (dark, ankle-height),
# a checkered keffiyeh headwrap (the whole head), and a small visible-skin
# sliver at the wrap's own eye gap.
#
# Found by adding TWO spatial features (height fraction, radial distance from
# the figure's own torso centerline) to the 3 colour channels and re-running
# k-means at k=14 on that 5-dim feature -- separating "dark chest gear" from
# "dark shadowed cloth fold" the same way the donor script's own boot/face
# split used a position tiebreak on top of a colour centroid, generalised
# from one tiebreak axis to two. CONFIRMED, not merely computed: every
# candidate cluster was re-coloured directly onto the actual mesh (a vertex-
# colour + emission material, no lighting to second-guess) and rendered from
# multiple angles. The dark clusters landed exactly on the harness straps,
# the hip-slung magazine pouch, and the boots; nothing leaked onto plain
# sleeve/leg cloth. See `.superpowers/sarim-irregular-report.md` for the
# fraction breakdown and the render description.
#
# `weapon` is NOT separated: the figure's own carried rifle is sculpted as
# part of this one mesh (no separate rifle object in any of the seven source
# files), its gunmetal tone falls inside the same "dark torso-height" cluster
# family as the harness, and only a small fraction of its vertices are far
# enough from the body's own radial envelope to flag as off-body outliers.
# Disclosed rather than chased further: the rifle currently shades through
# `webbing`'s olive ramp slice rather than `weapon`'s gunmetal one -- a
# colour nuance (both slices are close in value), not a wrong-army error.
#
# k=14 centroids fit ONCE, externally (plain numpy k-means -- k-means++ init,
# `RandomState(seed=0)`, Lloyd iteration to convergence -- no scikit-learn
# dependency, matching the donor script's own "fit once, hardcode, never
# re-cluster inside Blender" convention) against every vertex of this rig's
# own `Walking` scratch mesh, feature = (r, g, b, zfrac*0.5, radial_n*0.3) in
# that order. `zfrac`/`radial_n` are recomputed at classify time from
# WHATEVER mesh is passed in (never hardcoded absolute coordinates), exactly
# the way the donor script's own `_BOOT_FRAC`/`_FACE_FRAC` are fractions of
# "this mesh's own measured height", not absolute metres.
_ROLE_CENTROIDS_14 = np.array(
    [
        (0.463162, 0.378526, 0.289479, 0.408869, 0.068884),  # 0 uniform
        (0.575213, 0.482774, 0.384135, 0.222368, 0.103372),  # 1 uniform
        (0.130903, 0.100492, 0.069659, 0.034788, 0.086519),  # 2 boot
        (0.565367, 0.476684, 0.380656, 0.095818, 0.084658),  # 3 uniform
        (0.259638, 0.224436, 0.186505, 0.148291, 0.237528),  # 4 uniform (arm-ish, dark trim -- not boot/webbing tight enough)
        (0.152998, 0.120732, 0.083400, 0.353906, 0.089291),  # 5 webbing (harness strap, lit side)
        (0.569889, 0.483242, 0.387931, 0.367791, 0.088044),  # 6 uniform
        (0.639285, 0.576442, 0.509611, 0.436727, 0.057101),  # 7 uniform
        (0.351453, 0.283779, 0.203001, 0.315213, 0.106510),  # 8 uniform
        (0.513104, 0.411756, 0.307730, 0.248004, 0.128587),  # 9 uniform
        (0.266737, 0.210071, 0.141672, 0.323022, 0.101169),  # 10 uniform
        (0.288032, 0.219462, 0.154282, 0.042050, 0.086030),  # 11 boot (ankle trim)
        (0.115150, 0.093561, 0.070107, 0.193567, 0.219969),  # 12 webbing (hip pouch, high radial)
        (0.035426, 0.029638, 0.022686, 0.349448, 0.090726),  # 13 webbing (harness strap, shadow side)
    ]
)
_BOOT_CLUSTERS = (2, 11)
_WEBBING_CLUSTERS = (5, 12, 13)
_ZFRAC_WEIGHT = 0.5
_RADIAL_WEIGHT = 0.3
#: Core-torso height band used only to estimate the figure's own centerline
#: (x, y) for the radial feature -- a median over this band, not a single
#: point, and recomputed per-mesh exactly like every other spatial threshold
#: here.
_CORE_BAND_ZFRAC = (0.35, 0.55)

#: Face/keffiyeh are NOT decided by the k=14 clusters above (colour-only
#: clustering, even combined with position, did not isolate the small
#: visible-skin sliver from the surrounding lit keffiyeh cloth -- both are
#: warm-toned at similar value). Decided instead by two direct spatial+colour
#: rules, applied only to vertices the k=14 pass left as tentative `uniform`
#: (boot/webbing already claimed by cluster membership take priority and are
#: anatomically nowhere near the head anyway). `face`: a tight, CONFIRMED
#: (top-20-warmest-by-R-minus-B vertices in the head band all land within
#: this exact box) spatial+warmth window at the wrap's own eye gap. Fractions
#: of the mesh's own zmax and RAW y (this rig's head geometry already sits
#: close to global x=y=0, unlike the full body's swinging-arm-shifted
#: centerline, so no centering is needed here -- verified against the sample
#: coordinates in the task report, not assumed).
_FACE_ZFRAC_RANGE = (0.87, 0.98)
_FACE_Y_MAX = -6.5
_FACE_WARMTH_MIN = 0.10  # (R - B), linear
_KEFFIYEH_ZFRAC_MIN = 0.82


def _basecolor_image_array(mesh_obj):
    """(H, W, 4) float32 array of `mesh_obj`'s own Base-Color texture --
    identical method and identical V-flip reasoning to
    `import_meshy_soldier.py`'s own `_basecolor_image_array`; see that
    function's docstring for the calibration this relies on. Resolves the
    image via the BSDF's own `Base Color` link explicitly (this asset's
    material has TWO image-texture nodes feeding the same single image
    datablock, one for Base Color and one for Emission -- confirmed by
    inspection; resolving through the BSDF link rather than "the first
    TEX_IMAGE node found" is what makes that fact irrelevant)."""
    mat = mesh_obj.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    image = bsdf.inputs["Base Color"].links[0].from_node.image
    w, h = image.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4), w, h


def classify_vertex_roles(mesh_obj):
    """Per-vertex role for every vertex of `mesh_obj`. MUST run before
    `mesh.data.materials.clear()` -- the material is this function's only
    route to the texture. See the module-level comment above
    `_ROLE_CENTROIDS_14` for the full method and how it was confirmed."""
    mesh = mesh_obj.data
    img, w, h = _basecolor_image_array(mesh_obj)

    uv_layer = mesh.uv_layers.active.data
    vertex_uv = [None] * len(mesh.vertices)
    for loop in mesh.loops:
        vi = loop.vertex_index
        if vertex_uv[vi] is None:
            vertex_uv[vi] = uv_layer[loop.index].uv

    n = len(mesh.vertices)
    xs = np.array([v.co.x for v in mesh.vertices])
    ys = np.array([v.co.y for v in mesh.vertices])
    zs = np.array([v.co.z for v in mesh.vertices])
    zmax = zs.max()
    zfrac = zs / zmax

    colors = np.zeros((n, 3), dtype=np.float32)
    for v in mesh.vertices:
        u, vv = vertex_uv[v.index]
        px = min(max(int(round(u * (w - 1))), 0), w - 1)
        py = min(max(int(round(vv * (h - 1))), 0), h - 1)
        colors[v.index] = img[py, px, :3]

    core = (zfrac > _CORE_BAND_ZFRAC[0]) & (zfrac < _CORE_BAND_ZFRAC[1])
    cx, cy = np.median(xs[core]), np.median(ys[core])
    radial = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    radial_n = radial / radial.max()

    feat = np.concatenate(
        [colors, (zfrac * _ZFRAC_WEIGHT)[:, None], (radial_n * _RADIAL_WEIGHT)[:, None]], axis=1
    )
    d = np.linalg.norm(feat[:, None, :] - _ROLE_CENTROIDS_14[None, :, :], axis=2)
    cluster = np.argmin(d, axis=1)

    warmth = colors[:, 0] - colors[:, 2]
    face_mask = (
        (zfrac > _FACE_ZFRAC_RANGE[0])
        & (zfrac < _FACE_ZFRAC_RANGE[1])
        & (ys < _FACE_Y_MAX)
        & (warmth > _FACE_WARMTH_MIN)
    )
    keffiyeh_mask = (zfrac > _KEFFIYEH_ZFRAC_MIN) & ~face_mask

    roles = []
    for i in range(n):
        if cluster[i] in _BOOT_CLUSTERS:
            roles.append("boot")
        elif cluster[i] in _WEBBING_CLUSTERS:
            roles.append("webbing")
        elif face_mask[i]:
            roles.append("face")
        elif keffiyeh_mask[i]:
            roles.append("keffiyeh")
        else:
            roles.append("uniform")
    return roles


def separate_by_role(mesh_obj, vertex_roles):
    """Identical to `import_meshy_soldier.py`'s own `separate_by_role` --
    vertex-group-scoped `mesh.separate`, never raw index-based bmesh
    selection. See that function's docstring for the full reasoning."""
    present = sorted(set(vertex_roles) - {"uniform"})
    for role in present:
        vg = mesh_obj.vertex_groups.new(name=f"_role_{role}")
        idxs = [i for i, r in enumerate(vertex_roles) if r == role]
        vg.add(idxs, 1.0, "REPLACE")

    by_role = {}
    for role in present:
        before = set(bpy.data.objects.keys())
        bpy.context.view_layer.objects.active = mesh_obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="VERT")
        bpy.ops.mesh.select_all(action="DESELECT")
        mesh_obj.vertex_groups.active_index = mesh_obj.vertex_groups[f"_role_{role}"].index
        bpy.ops.object.vertex_group_select()
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        new_name = next(iter(set(bpy.data.objects.keys()) - before))
        new_obj = bpy.data.objects[new_name]
        new_obj["rl_role"] = role
        by_role[role] = new_obj

    mesh_obj["rl_role"] = "uniform"
    by_role["uniform"] = mesh_obj

    for obj in by_role.values():
        for role in present:
            gname = f"_role_{role}"
            if gname in obj.vertex_groups:
                obj.vertex_groups.remove(obj.vertex_groups[gname])

    return by_role


def _new_objects_and_action(before_objs, before_actions):
    new_objs = [bpy.data.objects[n] for n in (set(bpy.data.objects.keys()) - before_objs)]
    new_actions = [a for a in bpy.data.actions if a.name not in before_actions]
    if len(new_actions) != 1:
        raise RuntimeError(f"expected exactly 1 new action, got {[a.name for a in new_actions]}")
    return new_objs, new_actions[0]


def _real_mesh(new_objs):
    """The actual character mesh among an import's new objects -- picked by
    HIGHEST vertex count, not by name or iteration order. Same defensive
    pattern as `import_meshy_soldier.py`'s own `_real_mesh` -- this rig's own
    seven source files ALSO carry a 42-vert "Icosphere" placeholder alongside
    the real ~16.5k-vert "char1" mesh (confirmed by inspection)."""
    meshes = [o for o in new_objs if o.type == "MESH"]
    return max(meshes, key=lambda o: len(o.data.vertices))


def import_clip(path, target_name):
    before_objs = set(bpy.data.objects.keys())
    before_actions = set(a.name for a in bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new_objs, action = _new_objects_and_action(before_objs, before_actions)
    action.name = target_name
    action.use_fake_user = True
    for obj in new_objs:
        bpy.data.objects.remove(obj, do_unlink=True)
    return action


def import_base_clip(path, target_name):
    before_objs = set(bpy.data.objects.keys())
    before_actions = set(a.name for a in bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new_objs, action = _new_objects_and_action(before_objs, before_actions)
    action.name = target_name
    action.use_fake_user = True
    arm = next(o for o in new_objs if o.type == "ARMATURE")
    mesh = _real_mesh(new_objs)
    for obj in new_objs:
        if obj not in (arm, mesh):
            bpy.data.objects.remove(obj, do_unlink=True)
    return arm, mesh, action


#: Kept at 0 (inert), same reasoning as `import_meshy_soldier.py`'s own
#: `_FIX_FORWARD_DEG` -- `bpy.ops.object.transform_apply` cannot touch this
#: asset's exported facing at any angle (it preserves the ARMATURE's own
#: `matrix_world`, and the scratch MESH -- a parented child, never itself
#: touched -- is left exactly where it was). The real fix is
#: `FORWARD_FIX_DEG`/`apply_forward_fix`, far below.
_FIX_FORWARD_DEG = 0.0


def fix_forward(arm_obj):
    """No-op at `_FIX_FORWARD_DEG=0`. Kept, not deleted -- see
    `import_meshy_soldier.py`'s own `fix_forward` docstring for the full
    account of why this mechanism cannot fix exported facing at any angle."""
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.rotation_euler = (0.0, 0.0, math.radians(_FIX_FORWARD_DEG))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


#: Copied verbatim from `import_meshy_soldier.py` -- same bone names, same
#: rig family, and the resulting pose was rendered and inspected on THIS
#: rig (not assumed to transfer) before being accepted. See the task report.
_FIRE_RECOIL_BONES = {
    "RightForeArm": (0, -14.0),
    "RightArm": (0, -6.0),
    "RightShoulder": (2, -6.0),
    "Spine02": (0, -3.0),
}
_FIRE_CYCLE = ((0, 0.0), (2, 1.0), (6, -0.12), (12, 0.0))
_FIRE_AXIS_VEC = {0: (1.0, 0.0, 0.0), 1: (0.0, 1.0, 0.0), 2: (0.0, 0.0, 1.0)}


#: The bones `build_move_fire_src` takes from the firing pose: the spine root
#: down through both arms to both hands. `Spine02` is the child of `Hips` on
#: this rig (verified from the armature, not assumed -- the three spine bones
#: are named root-to-tip `Spine02` -> `Spine01` -> `Spine`, which reads
#: backwards); `neck`/`Head`/`head_end`/`headfront` hang off `Spine` and are
#: deliberately NOT in this list.
#:
#: Taking BOTH arm chains whole is what keeps the grip intact: both hang off
#: `Spine`, so copying every bone between `Spine` and each hand preserves the
#: two hands' positions relative to each other exactly. Measured: the hand
#: separation through the whole synthesized clip is a constant 0.3761 m,
#: inside the supplied source's own 0.3711-0.3840 m band.
_FIRING_TORSO_BONES = (
    "Spine02", "Spine01", "Spine",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
)


def _lock_armature_rotation(scratch_arm, bone, target_matrix):
    """Give `bone` `target_matrix`'s ROTATION in ARMATURE space, keeping the
    translation and scale it currently has.

    `pose_bone.matrix` is armature space and Blender's setter derives the local
    basis from it, so this re-seats a bone's world orientation regardless of
    what its parent is doing -- which is the whole mechanism
    `build_move_fire_src` is built on. The armature carries one
    `matrix_world`, so armature space and world space differ by a constant here
    and "hold this orientation" means the same thing in either.

    **Build the matrix and assign it ONCE.** `pb.matrix` returns a COPY, so the
    obvious two-step -- assign the rotation, then set `pb.matrix.translation` --
    writes the second half into a temporary and silently does nothing. A first
    version of this measurement did exactly that and reported three distinct
    "variants" that were all quietly the same unlocked graft."""
    from mathutils import Quaternion  # noqa: PLC0415

    pb = scratch_arm.pose.bones[bone]
    loc = pb.matrix.copy().to_translation()
    _l, rot, _s = target_matrix.decompose()
    m = Quaternion(rot).to_matrix().to_4x4()
    m.translation = loc
    pb.matrix = m
    bpy.context.view_layer.update()


def _pose_rig(scratch_arm, pose):
    """Write a sampled pose onto the rig and evaluate it."""
    for name, (q, loc, sc) in pose.items():
        pb = scratch_arm.pose.bones[name]
        pb.rotation_quaternion = q
        pb.location = loc
        pb.scale = sc
    bpy.context.view_layer.update()


def _capture_pose(scratch_arm):
    """The rig's current pose, in `sample_clip`'s own plain-data shape."""
    return {
        pb.name: (tuple(pb.rotation_quaternion), tuple(pb.location), tuple(pb.scale))
        for pb in scratch_arm.pose.bones
    }


def _representative_firing_frame(scratch_arm, firing_action):
    """Which frame of the supplied walk-and-shoot to take the firing upper body
    from: the one whose WEAPON bearing sits closest to that clip's own circular
    mean.

    Computed on every build and printed, never a remembered frame number -- the
    same discipline `import_meshy_soldier.find_hold_window` applies to its hold
    window, and for the same reason: a re-supplied source whose aim wanders to a
    different part of the clip would otherwise silently keep a number fitted to
    the old one.

    The weapon rather than the face, because the weapon is what this pose is
    being borrowed FOR. Measured on the shipped source: frame 49 of 79, weapon
    -1.92 against a clip mean of -1.92."""
    frames = sample_clip(scratch_arm, firing_action)
    weapon = []
    for pose in frames:
        _pose_rig(scratch_arm, pose)
        weapon.append(_weapon_bearing_deg(scratch_arm))
    mean = soldier._circular_mean_deg(weapon)[0]
    best = min(range(len(weapon)), key=lambda i: abs(soldier._wrap_deg(weapon[i] - mean)))
    print(
        f"moveFire: firing pose taken from frame {best} of {len(weapon)} of "
        f"{FIRING_POSE_SOURCE.split('Animation_')[-1]} -- weapon {weapon[best]:+.2f} deg "
        f"against that clip's own mean {mean:+.2f}"
    )
    return frames[best]


def build_move_fire_src(scratch_arm, run_action, firing_action):
    """`moveFire` = the RUN's legs carrying the walk-and-shoot's firing upper
    body, with the torso holding its aim while the pelvis swings under it.

    ## Why this is synthesized rather than bound

    The Meshy pack for this rig ships no run-and-shoot source -- the KDF rig's
    `Run_and_Shoot_withSkin.glb` has no counterpart here, and that asymmetry is
    the whole reason this function exists. `moveFire` bound
    `Walk_Forward_While_Shooting` whole until 2026-09-16, which was consistent
    while `move` was also a walk and stopped being so the moment `move` became
    `Running`. Measured on the shipped bytes, that clip declares a stride of
    **0.6614 m over a 3.25 s cycle** -- one real gait cycle of a 0.2 m/s
    creeping advance, on a unit whose own speed is 2.7 m/s. The design's D4
    rate-match reads that declaration and would have to play the clip at
    **13.27x**, finishing a 3.25 s animation in 245 ms; the next worst
    multiplier in the whole tree is 2.60. A Sarim fighter advancing under fire
    would either creep or flicker.

    ## The construction, and why each half comes from where it does

    The LEGS and the pelvis come from `Running` -- the same clip `move` binds --
    so the ground speed is correct BY CONSTRUCTION rather than by tuning, and
    `measureRoleTravel` reads `moveFire` and `move` as the same gait.

    The TORSO and both ARMS come from ONE frame of the supplied walk-and-shoot
    (`_representative_firing_frame`), because that is real authored firing
    geometry: two hands on the weapon, and the weapon measured at **-1.92 deg**
    with a spread of 1.16 over its own clip -- on the axis a tracer flies down.
    Grafting both arm chains whole preserves the grip exactly (see
    `_FIRING_TORSO_BONES`).

    A graft alone is not enough and the number says why. The arms' LOCAL
    rotations composed onto the run's own spine put the weapon at **-37.55
    deg**, because the run's pelvis and spine are oriented differently from the
    walk's. So `Spine02` -- the spine's root, the only child of `Hips` in that
    chain -- is re-seated to the ARMATURE-SPACE orientation it held in the
    firing pose. That cancels whatever the pelvis is doing, and the weapon
    comes back to the firing pose's own -1.92 with a spread of 0.00: the upper
    body holds its aim while the waist visibly counter-rotates through the
    stride, which is what a man firing on the move actually does.

    The HEAD is then re-seated the other way, to the orientation it holds in
    `Running`'s own frame. Without that it rides the firing pose's blade and
    reads +23.55 (the whole upper body borrowed) or +45.62 (the run's local
    head angles composed onto the borrowed spine, which is worse than either
    source). With it the face reads **-0.10**, and the face-to-weapon gap is
    **-1.82 deg** -- against -26.78 on the clip this replaces, and -10.51 on
    the KDF rig's own authored `Run_and_Shoot`. The complaint this whole branch
    answers is "shooting with their faces not in front of the gun"; this is the
    one clip in the file where the game draws a straight line out of a moving
    figure, and it now has the smallest face-to-weapon gap of any firing clip
    in the tree.

    ## What was tried and rejected, so nobody pays for it twice

    `import_meshy_soldier.solve_fire_aim`'s arm-chain aim -- the mechanism that
    fixed the KDF `fire` clip -- was measured here first and does NOT transfer,
    because the offset is in the TORSO and not in the arms. Solved per frame
    against the -30..-59 deg pre-graft offset it returns magnitudes of +20 to
    +38 deg on the well-behaved frames and diverges outright on four of sixteen
    (+543, -1794), since a three-joint chain's contribution to a ground-plane
    bearing is periodic and a secant solve can jump a branch. Worse, the
    convergent frames drive the two hands 0.44-0.49 m apart against this
    figure's own 0.3985 m arm reach -- past
    `import_meshy_soldier.fire_aim_hand_separation_limit_m`'s cap, which is to
    say past two hands on one rifle. Re-seating the torso costs nothing and
    keeps the grip untouched.

    No synthesized recoil. `_FIRE_CYCLE` pulses the weapon-side arm once per
    clip, which is right for `fire` (one clip, one shot) and would be wrong
    here: a stride and a rate of fire are unrelated, and the supplied firing
    pose is already a firing pose."""
    firing_pose = _representative_firing_frame(scratch_arm, firing_action)

    _pose_rig(scratch_arm, firing_pose)
    firing_torso_rest = scratch_arm.pose.bones["Spine02"].matrix.copy()

    run_frames = sample_clip(scratch_arm, run_action)
    frames = []
    for pose in run_frames:
        # The run's OWN head orientation, read before anything is grafted.
        _pose_rig(scratch_arm, pose)
        run_head = scratch_arm.pose.bones["Head"].matrix.copy()

        grafted = dict(pose)
        for name in _FIRING_TORSO_BONES:
            grafted[name] = firing_pose[name]
        _pose_rig(scratch_arm, grafted)

        _lock_armature_rotation(scratch_arm, "Spine02", firing_torso_rest)
        _lock_armature_rotation(scratch_arm, "Head", run_head)
        frames.append(_capture_pose(scratch_arm))

    move_fire = bpy.data.actions.new("move_fire_src")
    move_fire.use_fake_user = True
    scratch_arm.animation_data.action = move_fire
    scratch_arm.animation_data.action_slot = None
    for step, pose in enumerate(frames):
        for name, (q, loc, sc) in pose.items():
            pb = scratch_arm.pose.bones[name]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.scale = sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=step)
            pb.keyframe_insert(data_path="location", frame=step)
            pb.keyframe_insert(data_path="scale", frame=step)
    return move_fire


def build_fire_src(scratch_arm, idle_action):
    """Identical mechanism to `import_meshy_soldier.py`'s own
    `build_fire_src` -- see that function's docstring for the full
    reasoning. Base pose is `idle_action`'s own last frame; recoil is
    confined to the weapon-side arm/shoulder/spine; Hips is never touched."""
    scratch_arm.animation_data.action = idle_action
    scratch_arm.animation_data.action_slot = idle_action.slots[0] if idle_action.slots else None
    f0, f1 = idle_action.frame_range
    bpy.context.scene.frame_set(int(f1), subframe=f1 - int(f1))
    bpy.context.view_layer.update()

    from mathutils import Quaternion  # noqa: PLC0415

    base = {
        pb.name: (
            Quaternion(pb.rotation_quaternion),
            tuple(pb.location),
            tuple(pb.scale),
        )
        for pb in scratch_arm.pose.bones
    }

    fire = bpy.data.actions.new("fire_src")
    fire.use_fake_user = True
    scratch_arm.animation_data.action = fire
    scratch_arm.animation_data.action_slot = None

    for frame, fraction in _FIRE_CYCLE:
        for pb in scratch_arm.pose.bones:
            base_q, base_loc, base_sc = base[pb.name]
            if pb.name in _FIRE_RECOIL_BONES:
                axis_idx, peak_deg = _FIRE_RECOIL_BONES[pb.name]
                delta = Quaternion(_FIRE_AXIS_VEC[axis_idx], math.radians(peak_deg * fraction))
                pb.rotation_quaternion = base_q @ delta
            else:
                pb.rotation_quaternion = base_q
            pb.location = base_loc
            pb.scale = base_sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            pb.keyframe_insert(data_path="location", frame=frame)
            pb.keyframe_insert(data_path="scale", frame=frame)
    return fire


#: Copied verbatim from `import_meshy_soldier.py`.
_CROUCH_BENDS = (
    ("LeftUpLeg", 0, +1, 50.0),
    ("RightUpLeg", 0, +1, 50.0),
    ("LeftLeg", 0, +1, 70.0),
    ("RightLeg", 0, +1, 70.0),
    ("Spine02", 0, -1, 15.0),
    ("Spine01", 0, -1, 10.0),
    ("neck", 0, +1, 25.0),
)
_CROUCH_HIPS_DROP_M = 0.15


def build_down_src(scratch_arm, idle_action):
    """Identical mechanism to `import_meshy_soldier.py`'s own
    `build_down_src` -- a synthesized low, held crouch, not a fall. See that
    function's docstring for the full reasoning (a SLERP blend toward a fall
    clip was rejected there for reading as "the fall caught mid-flight", not
    a controlled crouch, at every fraction tried)."""
    from mathutils import Quaternion, Vector  # noqa: PLC0415

    scratch_arm.animation_data.action = idle_action
    scratch_arm.animation_data.action_slot = idle_action.slots[0] if idle_action.slots else None
    f0, f1 = idle_action.frame_range
    bpy.context.scene.frame_set(int(f1), subframe=f1 - int(f1))
    bpy.context.view_layer.update()

    base = {
        pb.name: (
            Quaternion(pb.rotation_quaternion),
            tuple(pb.location),
            tuple(pb.scale),
        )
        for pb in scratch_arm.pose.bones
    }

    down = bpy.data.actions.new("down_src")
    down.use_fake_user = True
    scratch_arm.animation_data.action = down
    scratch_arm.animation_data.action_slot = None

    bends = {name: (axis_idx, math.radians(peak_deg * sign)) for name, axis_idx, sign, peak_deg in _CROUCH_BENDS}

    hips_rest = scratch_arm.data.bones["Hips"].matrix_local
    arm_scale = scratch_arm.matrix_world.to_scale()[0]
    local_hips_drop = hips_rest.to_3x3().inverted() @ (Vector((0.0, 0.0, -_CROUCH_HIPS_DROP_M)) / arm_scale)

    for frame in (0, 1):
        for pb in scratch_arm.pose.bones:
            base_q, base_loc, base_sc = base[pb.name]
            if pb.name in bends:
                axis_idx, angle = bends[pb.name]
                delta = Quaternion(_FIRE_AXIS_VEC[axis_idx], angle)
                pb.rotation_quaternion = base_q @ delta
            else:
                pb.rotation_quaternion = base_q
            pb.location = tuple(Vector(base_loc) + local_hips_drop) if pb.name == "Hips" else base_loc
            pb.scale = base_sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            pb.keyframe_insert(data_path="location", frame=frame)
            pb.keyframe_insert(data_path="scale", frame=frame)
    return down


def duplicate_figure(scratch_arm, scratch_role_meshes, prefix, dx, dy):
    """Identical to `import_meshy_soldier.py`'s own `duplicate_figure`."""
    bpy.context.preferences.edit.use_duplicate_mesh = True
    bpy.context.preferences.edit.use_duplicate_armature = True
    bpy.context.preferences.edit.use_duplicate_action = False

    bpy.ops.object.select_all(action="DESELECT")
    scratch_arm.select_set(True)
    for mesh_obj in scratch_role_meshes.values():
        mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = scratch_arm
    bpy.ops.object.duplicate(linked=False)

    selected = list(bpy.context.selected_objects)
    dup_arm = next(o for o in selected if o.type == "ARMATURE")
    dup_meshes_by_role = {}
    for o in selected:
        if o.type == "MESH":
            role = o.get("rl_role")
            if role is None:
                raise RuntimeError(f"{o.name}: duplicate lost its rl_role tag")
            dup_meshes_by_role[role] = o
    if set(dup_meshes_by_role) != set(scratch_role_meshes):
        raise RuntimeError(
            f"duplicate role mismatch: expected {sorted(scratch_role_meshes)}, "
            f"got {sorted(dup_meshes_by_role)}"
        )

    orig_names = [b.name for b in dup_arm.data.bones]
    for name in orig_names:
        for mesh_obj in dup_meshes_by_role.values():
            mesh_obj.vertex_groups[name].name = f"{prefix}_{name}"
    for name in orig_names:
        dup_arm.data.bones[name].name = f"{prefix}_{name}"

    dup_arm.animation_data_clear()
    dup_arm.location = (dx, dy, 0.0)

    return dup_arm, dup_meshes_by_role


def sample_clip(scratch_arm, src_action):
    """Identical to `import_meshy_soldier.py`'s own `sample_clip` -- see that
    function's docstring for why `action_slot` is reassigned explicitly
    rather than left stale or cleared to `None`.

    The frame positions come from `soldier._clip_frame_positions` rather than
    being re-derived here, which they used to be. Two callers in this file now
    need the SAME list -- this one and `measure_clip_bearings` -- and a
    bearing measured at one function's frame 12 has to be the pose another
    function writes as frame 12, or the whole table below is comparing
    different instants."""
    scratch_arm.animation_data.action = src_action
    scratch_arm.animation_data.action_slot = src_action.slots[0] if src_action.slots else None
    bpy.context.view_layer.update()
    bone_names = [pb.name for pb in scratch_arm.pose.bones]

    frames = []
    for src_frame in soldier._clip_frame_positions(src_action):
        bpy.context.scene.frame_set(int(src_frame), subframe=src_frame - int(src_frame))
        bpy.context.view_layer.update()
        frames.append(
            {
                name: (
                    tuple(scratch_arm.pose.bones[name].rotation_quaternion),
                    tuple(scratch_arm.pose.bones[name].location),
                    tuple(scratch_arm.pose.bones[name].scale),
                )
                for name in bone_names
            }
        )
    return frames


#: Identical to `import_meshy_soldier.py`'s own `GAIT_PHASE_FRACTIONS` --
#: see that constant's docstring, and `tools/units/rig.py`'s own
#: `GAIT_PHASE_FRACTIONS` for why both asset families use the same three
#: fractions.
GAIT_PHASE_FRACTIONS = (0.0, 1.0 / 3.0, 2.0 / 3.0)


def write_combined_clip(merged_arm, figures, clip_name, frames, cyclic=False, stagger=0):
    """Identical to `import_meshy_soldier.py`'s own `write_combined_clip`,
    `cyclic` and `stagger` included -- see that function's docstring for what
    it does and why."""
    combined = bpy.data.actions.new(clip_name)
    combined.use_fake_user = True
    if merged_arm.animation_data is None:
        merged_arm.animation_data_create()
    merged_arm.animation_data.action = combined
    merged_arm.animation_data.action_slot = None

    n = len(frames)
    total = n + stagger * (len(figures) - 1)
    for step in range(total):
        for i, (prefix, _dx, _dy) in enumerate(figures):
            if cyclic:
                shift = round(n * GAIT_PHASE_FRACTIONS[i % len(GAIT_PHASE_FRACTIONS)])
                sampled = frames[(step + shift) % n]
            else:
                # `stagger` frames per figure, first frame held until its turn.
                sampled = frames[min(n - 1, max(0, step - stagger * i))]
            for name, (q, loc, sc) in sampled.items():
                pb = merged_arm.pose.bones[f"{prefix}_{name}"]
                pb.rotation_quaternion = q
                pb.location = loc
                pb.scale = sc
                pb.keyframe_insert(data_path="rotation_quaternion", frame=step)
                pb.keyframe_insert(data_path="location", frame=step)
                pb.keyframe_insert(data_path="scale", frame=step)

    return combined


# --- bearings ----------------------------------------------------------
#
# Two ground-plane headings per frame, both expressed in the EXPORTED file's
# own convention so a build-time number and a `tools/src/mesh_gait.ts` number
# off the shipped bytes can be put side by side. The conversion is the two
# fixed steps `import_meshy_soldier.py`'s own block comment derives and
# cross-checks live: Blender is Z-up and its glTF exporter writes Y-up as
# `(x, z, -y)`, which negates a ground bearing, and `apply_forward_fix`'s
# wrapper node then subtracts `FORWARD_FIX_DEG` from every bearing in the
# file.
#
# Cross-checked on THIS asset rather than inherited: the probe run predicted
# `idle` at -1.07 with a spread of 0.64, and `measureFacing` reads the shipped
# `sarim_rifles.glb`'s `idle` at +11.1 with a spread of 0.7. The SPREADS agree;
# the MEANS differ by ~12 deg, and that offset is a property of this rig rather
# than of the conversion -- see `_face_bearing_deg` below.


def _exported_bearing_deg(dx, dy):
    """A Blender WORLD ground-plane vector, as the exported file will read it.

    Local, not imported, because it closes over THIS file's own
    `FORWARD_FIX_DEG`. Both files happen to carry 90.0 today; sharing the
    function would make that coincidence load-bearing."""
    return soldier._wrap_deg(math.degrees(math.atan2(-dy, dx)) - FORWARD_FIX_DEG)


def _face_bearing_deg(scratch_arm):
    """Where the FACE points, from the currently evaluated pose.

    The `Head` -> `headfront` marker pair, the supplier's own -- `headfront`
    is a leaf marker bone in front of the skull. Same probe, same reasoning as
    `import_meshy_soldier._face_bearing_deg`, and the two rigs really do share
    the marker: this file's own module docstring records the identical bone
    names and hierarchy as the first thing it verified.

    **The offset from `measureFacing` is much larger here than on the KDF rig,
    and that is a property of the ASSET, not a bug in either instrument.** The
    shipped gate centroids the `face` ROLE MESH against the head joint; on the
    KDF soldier that role is a whole face and the two readings agree to 1-3
    deg, but on this rig `face` is the small visible-skin sliver at the
    keffiyeh's eye gap (see `_FACE_ZFRAC_RANGE`), whose centroid sits off the
    skull's own axis. Measured 2026-09-16: `idle` -1.07 here against +11.1
    there, `moveFire` +24.86 here against +41.8 there -- 12 and 17 deg.
    So the ceilings in `CLIP_SEMANTICS` below are set from the numbers THIS
    function produces, and a test asserting against `measureFacing` must not
    reuse them. `tools/src/mesh_gait.test.ts` parses the KDF table for exactly
    that purpose and deliberately does NOT parse this one."""
    world = scratch_arm.matrix_world
    head = world @ scratch_arm.pose.bones["Head"].matrix.translation
    front = world @ scratch_arm.pose.bones["headfront"].matrix.translation
    return _exported_bearing_deg(front.x - head.x, front.y - head.y)


def _weapon_bearing_deg(scratch_arm):
    """Where the WEAPON points: `RightHand`'s own bone direction, head to tail.

    Same definition, same justification as
    `import_meshy_soldier._weapon_bearing_deg` -- read that one for why a
    hand-to-hand vector and a mesh-centroid pair were both measured and
    rejected. The rifle here is likewise sculpted into the one skinned mesh
    and carries no `weapon` rl_role of its own (the module comment above
    `_ROLE_CENTROIDS_14` records that it shades through `webbing`), so it
    cannot be isolated by role and the bearing comes off the rig.

    VALIDATED INDEPENDENTLY ON THIS RIG, not inherited. `moveFire` is the
    supplier's own authored `Walk_Forward_While_Shooting`, untouched by
    anything in this file, and it measures **-1.92 deg with a spread of
    1.16** on this axis -- a real walk-and-shoot puts the weapon on the axis
    of travel, so a proxy reading zero there is reading a weapon. Its FACE
    over the same frames sits at +24.86, which is the blade. Same result the
    KDF rig gave (+0.31 / 1.63), from a different mocap.

    NOT meaningful on `move`: `Running` carries the rifle one-handed at the
    side and swings that arm through the stride, so this measures a pumping
    arm. Spread over the cycle: **203.38 deg**. (The retired `Walking` source
    was no better -- 148.43.) Hence `CLIP_SEMANTICS['move']['weapon']` is
    `None`."""
    world = scratch_arm.matrix_world
    pb = scratch_arm.pose.bones["RightHand"]
    grip = world @ pb.matrix.translation
    muzzle = world @ pb.tail
    return _exported_bearing_deg(muzzle.x - grip.x, muzzle.y - grip.y)


def measure_clip_bearings(scratch_arm, action):
    """Replays `action` and returns `(face, weapon)`, one bearing per frame.

    Sampled at exactly `sample_clip`'s own frame positions -- both call
    `soldier._clip_frame_positions`, which is the single definition, so an
    index into either list is the same frame as the same index into
    `sample_clip`'s output.

    Reassigns `action_slot` explicitly for the reason `sample_clip`'s own
    docstring records: this function READS pose values back through
    `frame_set` without writing a keyframe, so a stale slot left bound by a
    previous action silently freezes every reading at that action's pose."""
    scratch_arm.animation_data.action = action
    scratch_arm.animation_data.action_slot = action.slots[0] if action.slots else None
    bpy.context.view_layer.update()
    face, weapon = [], []
    for src_frame in soldier._clip_frame_positions(action):
        bpy.context.scene.frame_set(int(src_frame), subframe=src_frame - int(src_frame))
        bpy.context.view_layer.update()
        face.append(_face_bearing_deg(scratch_arm))
        weapon.append(_weapon_bearing_deg(scratch_arm))
    return face, weapon


def _hips_world_z_travel(frames, hips_rest, arm_world):
    """Identical to `import_meshy_soldier.py`'s own `_hips_world_z_travel`."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    zs = []
    for f in frames:
        q, loc, sc = f["Hips"]
        basis = Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))
        world = arm_world @ (hips_rest @ basis)
        zs.append(world.translation.z)
    return (max(zs) - min(zs)) * 100.0


def _hips_armature_translation(pose, hips_rest):
    """Identical to `import_meshy_soldier.py`'s own `_hips_armature_translation`."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    q, loc, sc = pose["Hips"]
    return (hips_rest @ Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))).translation


def hold_hips_horizontal(frames, hips_rest, anchor_pose):
    """Identical to `import_meshy_soldier.py`'s own `hold_hips_horizontal`: a
    copy of `frames` with every frame's Hips armature-space x/y replaced by
    `anchor_pose`'s own, z (height) kept -- `import_meshy_yahalom.py`'s
    `build_wreck_src` re-centring, applied to EVERY frame of a fall rather
    than only its last. Hips is a root bone, so its own (quat, loc, scale)
    alone determines its pose matrix and the inverse is exact."""
    from mathutils import Vector  # noqa: PLC0415

    rot3 = hips_rest.to_3x3()
    inv = rot3.inverted()
    t_live = _hips_armature_translation(anchor_pose, hips_rest)
    out = []
    for pose in frames:
        t = _hips_armature_translation(pose, hips_rest)
        target = Vector((t_live.x, t_live.y, t.z))
        q, _loc, sc = pose["Hips"]
        held = dict(pose)
        held["Hips"] = (q, tuple(inv @ (target - hips_rest.translation)), sc)
        out.append(held)
    return out


def _hips_horizontal_travel_m(frames, hips_rest, arm_world):
    """Identical to `import_meshy_soldier.py`'s own `_hips_horizontal_travel_m`."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    pts = []
    for f in frames:
        q, loc, sc = f["Hips"]
        world = arm_world @ (hips_rest @ Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc)))
        pts.append((world.translation.x, world.translation.y))
    x0, y0 = pts[0]
    return max(math.hypot(x - x0, y - y0) for x, y in pts)


def write_pose_action(arm, name, frames):
    """Identical to `import_meshy_soldier.py`'s own `write_pose_action` --
    `import_meshy_yahalom.py`'s `_write_pose_action`, copied verbatim."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data.action = action
    arm.animation_data.action_slot = None
    for i, pose in enumerate(frames):
        for pb in arm.pose.bones:
            q, loc, sc = pose[pb.name]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.scale = sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=i)
            pb.keyframe_insert(data_path="location", frame=i)
            pb.keyframe_insert(data_path="scale", frame=i)
    return action


def check_clip_semantics(frames_by_clip, hips_rest, arm_world, bearings_by_clip):
    """Identical to `import_meshy_soldier.py`'s own `check_clip_semantics`:
    enforces `CLIP_SEMANTICS`' numeric halves at BUILD time, before any of the
    expensive downstream work (duplicate x3, seven-way export, GLB merge)
    runs. Raises loudly, naming the clip, the measured number, the ceiling and
    the entry's own `means`, rather than passing a build whose motion
    contradicts its own clip name.

    `bearings_by_clip` is `{clip: (face_list, weapon_list)}` from
    `measure_clip_bearings`. THREE independent checks, and each exists because
    the one before it was blind to a real defect that shipped on this project:

      * Hips travel -- "does this clip move the body when it should not". It
        cannot see a figure standing perfectly still while facing 156 deg away
        from what it is shooting: that travels exactly zero.
      * FACE bearing, mean and spread -- the mean catches a clip bound facing
        the wrong way, the spread catches a clip that TURNS.
      * WEAPON bearing, mean and spread -- because a face reading says nothing
        about where the rifle points, and the complaint this work answers is
        "shooting with their faces not in front of the gun". On this rig both
        halves are independent readings of supplied mocap; see
        `CLIP_SEMANTICS`' own comment for why that is NOT true of the donor
        script and what it had to add to compensate.

    Exemptions are `None` in the table and are printed by name on the passing
    path, the way `pnpm validate:meshes` prints its own -- never silent."""
    travel = {name: _hips_world_z_travel(frames_by_clip[name], hips_rest, arm_world) for name in CLIP_ORDER}
    idle_travel = travel["idle"]
    print("Hips world-z travel x100, by clip:", {k: round(v, 3) for k, v in travel.items()})

    stats = {}
    for name in CLIP_ORDER:
        face, weapon = bearings_by_clip[name]
        stats[name] = {
            "heading": soldier._circular_mean_deg(face),
            "weapon": soldier._circular_mean_deg(weapon),
        }
    print("bearings deg (exported convention, +X = 0, + is the figure's left), by clip:")
    for name in CLIP_ORDER:
        line = []
        for kind in ("heading", "weapon"):
            mean, lo, hi = stats[name][kind]
            label = "face" if kind == "heading" else "weapon"
            line.append(f"{label} {mean:+7.2f} [{lo:+7.2f},{hi:+7.2f}] spread {hi - lo:6.2f}")
        gap = soldier._wrap_deg(stats[name]["weapon"][0] - stats[name]["heading"][0])
        print(f"  {name:10s} {'   '.join(line)}   face-to-weapon gap {gap:+7.2f}")

    for name in CLIP_ORDER:
        ceiling = CLIP_SEMANTICS[name]["ceiling"](idle_travel)
        if ceiling is not None and travel[name] > ceiling:
            raise RuntimeError(
                f"{name}: Hips travel {travel[name]:.3f} exceeds {ceiling:.3f} -- "
                f"CLIP_SEMANTICS['{name}']['means'] = {CLIP_SEMANTICS[name]['means']!r}"
            )
        horizontal_ceiling = CLIP_SEMANTICS[name].get("horizontal_m")
        if horizontal_ceiling is not None:
            drift = _hips_horizontal_travel_m(frames_by_clip[name], hips_rest, arm_world)
            print(f"  {name}: Hips horizontal drift {drift:.4f} m (ceiling {horizontal_ceiling})")
            if drift > horizontal_ceiling:
                raise RuntimeError(
                    f"{name}: Hips drift {drift:.3f} m exceeds {horizontal_ceiling} m -- "
                    "the horizontal hold is not holding"
                )
        for kind, label in (("heading", "face"), ("weapon", "weapon")):
            bound = CLIP_SEMANTICS[name][kind]
            mean, lo, hi = stats[name][kind]
            if bound is None:
                print(f"  {name}: {label} bearing NOT gated (exempt) -- "
                      f"mean {mean:+.1f} deg, spread {hi - lo:.1f} deg")
                continue
            if abs(mean) > bound["mean_deg"]:
                raise RuntimeError(
                    f"{name}: {label} bearing {mean:+.1f} deg exceeds "
                    f"+-{bound['mean_deg']:.1f} deg -- "
                    f"CLIP_SEMANTICS['{name}']['means'] = {CLIP_SEMANTICS[name]['means']!r}"
                )
            if hi - lo > bound["spread_deg"]:
                raise RuntimeError(
                    f"{name}: {label} bearing sweeps {hi - lo:.1f} deg "
                    f"([{lo:+.1f},{hi:+.1f}]) exceeds {bound['spread_deg']:.1f} deg -- "
                    f"CLIP_SEMANTICS['{name}']['means'] = {CLIP_SEMANTICS[name]['means']!r}"
                )
    return travel


def export_glb(arm_obj, path):
    """Identical to `import_meshy_soldier.py`'s own `export_glb` -- see that
    function's docstring for why every clip must be exported completely
    alone (a shared multi-action armature at export time silently collapses
    every clip's every channel to two identical keyframes)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    for child in arm_obj.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_extras=True,
        export_materials="NONE",
        export_rest_position_armature=True,
        export_optimize_animation_size=False,
    )


def _read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise RuntimeError(f"{path}: not a GLB (bad magic)")
    offset = 12
    gltf = None
    bin_data = b""
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, offset)
        chunk_data = data[offset + 8 : offset + 8 + chunk_len]
        if chunk_type == b"JSON":
            gltf = json.loads(chunk_data)
        elif chunk_type == b"BIN\x00":
            bin_data = chunk_data
        offset += 8 + chunk_len
    if gltf is None:
        raise RuntimeError(f"{path}: no JSON chunk")
    return gltf, bytearray(bin_data)


def _write_glb(gltf, bin_data, path):
    json_bytes = json.dumps(gltf).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    bin_bytes = bytes(bin_data)
    bin_bytes += b"\x00" * ((4 - len(bin_bytes) % 4) % 4)
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
        f.write(bin_bytes)


#: Degrees about glTF/three.js +Y needed to turn this asset's own exported
#: facing into the contract's local +X. WORKING HYPOTHESIS at the same value
#: `import_meshy_soldier.py` measured for its own KDF source (+90, live
#: in-game measurement, `face` mesh world-offset vs a walked bearing) --
#: this rig shares that source's exact bone names, hierarchy, armature
#: scale, and `headfront`/`Head` marker relationship, which is suggestive
#: but per that same file's own docstring is NOT sufficient on its own (a
#: still render or a marker-bone read answers "which end is +X", never
#: "which end is forward while walking"). CONFIRMED for THIS asset by the
#: identical live measurement before this value was accepted -- see
#: `.superpowers/sarim-irregular-report.md` for the actual measured angle.
FORWARD_FIX_DEG = 90.0


def _quat_y(deg):
    half = math.radians(deg) / 2.0
    return [0.0, math.sin(half), 0.0, math.cos(half)]


def apply_forward_fix(gltf, deg):
    """Identical to `import_meshy_soldier.py`'s own `apply_forward_fix`."""
    scene_idx = gltf.get("scene", 0)
    scene = gltf["scenes"][scene_idx]
    old_top_nodes = list(scene["nodes"])
    wrapper = {"name": "forward_fix", "rotation": _quat_y(deg), "children": old_top_nodes}
    wrapper_idx = len(gltf["nodes"])
    gltf["nodes"].append(wrapper)
    scene["nodes"] = [wrapper_idx]


def merge_clip_glbs(clip_paths, out_path, forward_fix_deg=0.0):
    """Identical to `import_meshy_soldier.py`'s own `merge_clip_glbs`."""
    names = list(clip_paths.keys())
    base_gltf, base_bin = _read_glb(clip_paths[names[0]])
    base_node_names = [n.get("name") for n in base_gltf["nodes"]]
    if len(base_gltf["animations"]) != 1:
        raise RuntimeError(
            f"{names[0]}: expected exactly 1 animation in the base file, "
            f"got {len(base_gltf['animations'])}"
        )
    base_gltf["animations"][0]["name"] = names[0]

    for clip_name in names[1:]:
        gltf, bin_data = _read_glb(clip_paths[clip_name])
        node_names = [n.get("name") for n in gltf["nodes"]]
        if node_names != base_node_names:
            raise RuntimeError(
                f"{clip_name}: node name/order differs from the base file "
                f"({names[0]}) -- cannot merge by index"
            )
        if len(gltf["animations"]) != 1:
            raise RuntimeError(
                f"{clip_name}: expected exactly 1 animation, got {len(gltf['animations'])}"
            )
        anim = gltf["animations"][0]

        bufferview_remap = {}

        def remap_bufferview(old_idx):
            if old_idx in bufferview_remap:
                return bufferview_remap[old_idx]
            bv = dict(gltf["bufferViews"][old_idx])
            start = bv.get("byteOffset", 0)
            length = bv["byteLength"]
            chunk = bytes(bin_data[start : start + length])
            base_bin.extend(b"\x00" * ((4 - len(base_bin) % 4) % 4))
            bv["byteOffset"] = len(base_bin)
            bv["buffer"] = 0
            base_bin.extend(chunk)
            new_idx = len(base_gltf["bufferViews"])
            base_gltf["bufferViews"].append(bv)
            bufferview_remap[old_idx] = new_idx
            return new_idx

        accessor_remap = {}

        def remap_accessor(old_idx):
            if old_idx in accessor_remap:
                return accessor_remap[old_idx]
            acc = dict(gltf["accessors"][old_idx])
            if "bufferView" in acc:
                acc["bufferView"] = remap_bufferview(acc["bufferView"])
            new_idx = len(base_gltf["accessors"])
            base_gltf["accessors"].append(acc)
            accessor_remap[old_idx] = new_idx
            return new_idx

        new_samplers = []
        for samp in anim["samplers"]:
            new_samp = dict(samp)
            new_samp["input"] = remap_accessor(samp["input"])
            new_samp["output"] = remap_accessor(samp["output"])
            new_samplers.append(new_samp)

        new_channels = [dict(ch) for ch in anim["channels"]]

        base_gltf["animations"].append(
            {"name": clip_name, "channels": new_channels, "samplers": new_samplers}
        )

    if forward_fix_deg:
        apply_forward_fix(base_gltf, forward_fix_deg)

    base_gltf["buffers"][0]["byteLength"] = len(base_bin)
    _write_glb(base_gltf, base_bin, out_path)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- 1. import: base rig from Running (the `move` source -- it brings the
    # mesh and the armature every other clip is replayed onto, and it carries
    # byte-identical geometry and texture to the retired Walking source, which
    # is what makes `_ROLE_CENTROIDS_14` indifferent to the swap), then idle,
    # the firing POSE source (one frame of it, see `build_move_fire_src`),
    # and both fall clips.
    scratch_arm, scratch_mesh, move_src = import_base_clip(
        os.path.join(SRC_DIR, CLIP_SOURCES["move"]), "move_src"
    )
    idle_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["idle"]), "idle_src")
    firing_pose_src = import_clip(os.path.join(SRC_DIR, FIRING_POSE_SOURCE), "firing_pose_src")
    fall_src = import_clip(os.path.join(SRC_DIR, FALL_SOURCE), "fall_src")
    fall_alt_src = import_clip(os.path.join(SRC_DIR, FALL_SOURCE_ALT), "fall_alt_src")

    # --- 2. classify every vertex's rl_role from the mesh's OWN base-color
    # texture, BEFORE the material is stripped.
    vertex_roles = classify_vertex_roles(scratch_mesh)
    role_counts = {role: vertex_roles.count(role) for role in sorted(set(vertex_roles))}
    total = len(vertex_roles)
    print(
        "rl_role classification (single figure, "
        f"{total} verts): "
        + ", ".join(f"{role}={n} ({n / total:.1%})" for role, n in role_counts.items())
    )

    # --- 3. zero materials ---------------------------------------------------
    scratch_mesh.data.materials.clear()

    # --- 4. fix forward -- documented no-op, see `fix_forward`'s docstring.
    fix_forward(scratch_arm)
    hips_rest = scratch_arm.data.bones["Hips"].matrix_local.copy()
    arm_world = scratch_arm.matrix_world.copy()

    # --- 4.5. synthesize fire, moveFire and down --------------------------
    fire_src = build_fire_src(scratch_arm, idle_src)
    move_fire_src = build_move_fire_src(scratch_arm, move_src, firing_pose_src)
    down_src = build_down_src(scratch_arm, idle_src)

    # --- 5. bind both supplied falls whole, horizontal root motion held, and
    # derive wreck/wreckAlt as each held clip's own last frame ---------------
    idle_frames = sample_clip(scratch_arm, idle_src)
    fall_frames = hold_hips_horizontal(sample_clip(scratch_arm, fall_src), hips_rest, idle_frames[0])
    fall_alt_frames = hold_hips_horizontal(sample_clip(scratch_arm, fall_alt_src), hips_rest, idle_frames[0])
    fall_held_src = write_pose_action(scratch_arm, "fall_held_src", fall_frames)
    fall_alt_held_src = write_pose_action(scratch_arm, "fall_alt_held_src", fall_alt_frames)
    wreck_src = write_pose_action(scratch_arm, "wreck_src", [fall_frames[-1], fall_frames[-1]])
    wreck_alt_src = write_pose_action(scratch_arm, "wreck_alt_src", [fall_alt_frames[-1], fall_alt_frames[-1]])

    # --- 6. sample all seven clips into plain Python data, off the scratch
    # rig, BEFORE any duplication happens.
    src_by_clip = {
        "idle": idle_src,
        "move": move_src,
        "fire": fire_src,
        "moveFire": move_fire_src,
        "down": down_src,
        "wreck": wreck_src,
        "wreckAlt": wreck_alt_src,
        "fall": fall_held_src,
        "fallAlt": fall_alt_held_src,
    }
    frames_by_clip = {
        clip_name: sample_clip(scratch_arm, src_by_clip[clip_name]) for clip_name in CLIP_ORDER
    }
    bearings_by_clip = {
        clip_name: measure_clip_bearings(scratch_arm, src_by_clip[clip_name])
        for clip_name in CLIP_ORDER
    }

    # --- 6.5. enforce CLIP_SEMANTICS before any expensive downstream work --
    check_clip_semantics(frames_by_clip, hips_rest, arm_world, bearings_by_clip)

    # --- 7. delete every `*_src` action BEFORE duplicating/renaming --------
    # See `import_meshy_soldier.py`'s own `main()` for the full account of
    # why this ordering is load-bearing (Blender's bone-rename callback is
    # not scoped to the object being renamed).
    for action in (
        move_src, idle_src, move_fire_src, fire_src, down_src,
        wreck_src, wreck_alt_src, fall_src, fall_alt_src, firing_pose_src,
        fall_held_src, fall_alt_held_src,
    ):
        action.use_fake_user = False
        bpy.data.actions.remove(action)

    # --- 8. split the scratch mesh by role, BEFORE duplication -------------
    # No webbing graft here -- `webbing` is real source geometry, already
    # produced by `classify_vertex_roles` above.
    scratch_role_meshes = separate_by_role(scratch_mesh, vertex_roles)
    print(f"roles present: {sorted(scratch_role_meshes)}")

    # --- 9. duplicate x3 (armature + every role mesh together), prefix
    # bones/vgroups, spread -----------------------------------------------
    figures = []
    dup_arms = []
    from collections import defaultdict  # noqa: PLC0415

    role_dup_meshes = defaultdict(list)
    for prefix, dx, dy in FIGURE_SPREAD:
        dup_arm, dup_meshes_by_role = duplicate_figure(
            scratch_arm, scratch_role_meshes, prefix, dx, dy
        )
        figures.append((prefix, dx, dy))
        dup_arms.append(dup_arm)
        for role, mesh_obj in dup_meshes_by_role.items():
            role_dup_meshes[role].append(mesh_obj)

    # --- 10. join each role's three duplicates into one mesh FIRST, THEN
    # join the armatures -- load-bearing ordering, see
    # `import_meshy_soldier.py`'s own `main()` step 10 for the full account
    # of what joining armatures first silently corrupts.
    merged_meshes = {}
    for role, meshes in role_dup_meshes.items():
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = role
        merged.data.name = role
        merged["rl_role"] = role
        merged_meshes[role] = merged

        if len(merged.vertex_groups) != 24 * 3:
            raise RuntimeError(
                f"{role}: expected 72 vertex groups after join, got {len(merged.vertex_groups)}"
            )

    # --- 11. now join the armatures -----------------------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for arm in dup_arms:
        arm.select_set(True)
    bpy.context.view_layer.objects.active = dup_arms[0]
    bpy.ops.object.join()
    merged_arm = dup_arms[0]

    if len(merged_arm.data.bones) != 24 * 3:
        raise RuntimeError(f"expected 72 bones after join, got {len(merged_arm.data.bones)}")
    for role, merged in merged_meshes.items():
        if merged.modifiers[0].object != merged_arm:
            raise RuntimeError(f"{role}: Armature modifier does not target the merged armature")

    total_verts = sum(len(m.data.vertices) for m in merged_meshes.values())
    print(
        f"merged: {len(merged_meshes)} role mesh(es) {sorted(merged_meshes)}, "
        f"{total_verts} verts total"
    )

    # --- 12. scratch rig no longer needed -- delete it ----------------------
    for mesh_obj in scratch_role_meshes.values():
        bpy.data.objects.remove(mesh_obj, do_unlink=True)
    bpy.data.objects.remove(scratch_arm, do_unlink=True)
    bpy.data.orphans_purge(do_recursive=True)

    # --- 13. write + export each clip ALONE, one export call per clip ------
    tmp_dir = tempfile.mkdtemp(prefix="meshy_irregular_clips_")
    clip_paths = {}
    for clip_name in CLIP_ORDER:
        combined = write_combined_clip(
            merged_arm, figures, clip_name, frames_by_clip[clip_name],
            cyclic=clip_name in CYCLIC_CLIPS,
            stagger=round(FALL_STAGGER_S * bpy.context.scene.render.fps) if clip_name in STAGGERED_CLIPS else 0,
        )
        tmp_path = os.path.join(tmp_dir, f"{clip_name}.glb")
        export_glb(merged_arm, tmp_path)
        clip_paths[clip_name] = tmp_path

        merged_arm.animation_data.action = None
        combined.use_fake_user = False
        bpy.data.actions.remove(combined)

    # --- 14. merge the five single-clip temp files into the real output ----
    merge_clip_glbs(
        {name: clip_paths[name] for name in CLIP_ORDER}, OUT_PATH, forward_fix_deg=FORWARD_FIX_DEG
    )
    for path in clip_paths.values():
        os.remove(path)
    os.rmdir(tmp_dir)

    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), clips={list(CLIP_ORDER)}, "
          f"bones={len(merged_arm.data.bones)}, roles={sorted(merged_meshes)}, "
          f"verts={total_verts}")


if __name__ == "__main__":
    main()
