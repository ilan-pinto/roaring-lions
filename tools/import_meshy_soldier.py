"""Retarget the supplied Meshy soldier (six single-clip GLBs, one mesh, one
24-joint Mixamo-style skeleton) into ONE contract-compliant team file:
`art/meshes/meshy_soldier.glb`, per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` (v1, infantry).

Usage (headless, matching `tools/export_mesh_team.py`'s own invocation shape):

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/import_meshy_soldier.py

Source files, gitignored (`art/blend/` -- never committed), read from
`art/blend/KDF/soldier/Meshy_AI_lowpoly_mideast_soldi_biped/*.glb` (see
`SRC_DIR`; the short-name `art/blend/soldier/` path this docstring used to
claim exists in no checkout):

    Running_withSkin.glb        ("...|running|...")        -> move
    Run_and_Shoot_withSkin.glb  ("...|Run_and_Shoot|...")  -> moveFire
    Gun_Hold_Left_Turn_withSkin.glb ("...|Gun_Hold_Left_Turn|...")
                                                           -> idle, HOLD ONLY
    Shot_and_Blown_Back_withSkin.glb ("...|Shot_and_Blown_Back|...")
                                                           -> wreck, LAST FRAME ONLY

    (`fire` and `down` are synthesized, not retargeted from any of the six --
    see point 4 below and `build_fire_src`'s/`build_down_src`'s own
    docstrings for why.)

`Walking_withSkin.glb` is READ BY NOTHING here as of 2026-09-15. It was
`move`'s source and is retired in favour of the run, and NOT because a run
looks better: `data/units/kdf/inf_squad.json` moves at 0.9 tiles/s against
`MESH_UNITS_PER_TILE` 3.0, so this unit's one and only speed is 2.7 m/s.
Measured on the shipped file, the walk's boots described 0.315 of the ground
the body crossed, so the figure glided. There is no second, slower speed for
a walk to be the honest rendering of, and no "fleeing" state is needed to
justify binding the run -- see
`docs/superpowers/specs/2026-09-15-infantry-gait-design.md` section 3.2.

`Side_Shot.glb` is READ BY NOTHING in this file. It was `fire`'s source
through R1/R2 and is retired here: measured, it is a HIT reaction ("shot in
the side", not "shooting sideways") with roughly double `idle`'s own vertical
hip travel, and looping it continuously produced a visible up-down bob on
every firing unit -- see `build_fire_src`'s own docstring and the task report
for the measurement. None of the six supplied clips is an actual firing
animation, so `fire` is synthesized instead of retargeted: a held-aim pose
(borrowed from `idle`'s own settled stance) plus an authored recoil-and-settle
impulse confined to the weapon-side arm, shoulder and upper spine.

## Facing: the hold, the yaw, and the gate (2026-09-15)

`idle` used to bind the WHOLE of `Gun_Hold_Left_Turn`, which is what its name
says: a figure holding a gun that then turns roughly 180 degrees. `idle`
loops, so a standing rifleman rotated on the spot for ever -- and because
`build_fire_src` and `build_down_src` both took their base pose from that
clip's LAST frame, ONE mis-binding produced THREE clips facing backwards.
Measured on the shipped file with `tools/src/mesh_gait.ts`'s `measureFacing`:
`fire` -156 deg, `down` -163, `idle` sweeping +23 to -159, against `move`'s
correct -5.

Four mechanisms replace it, and every one computes its numbers per build
rather than carrying a typed constant. `measure_clip_bearings` reads TWO
ground-plane bearings per frame in the exported file's own convention: where
the FACE points (`Head` -> `headfront`) and where the WEAPON points
(`RightHand`'s own bone direction -- the rifle IS modelled, but it carries no
`weapon` rl_role of its own, so it cannot be isolated and measured directly;
see `_weapon_bearing_deg`).
`find_hold_window` finds where the turn begins and where a loop can close.
`build_idle_src` binds that window with one root yaw so the held stance's
face points along `+X`. And `solve_fire_aim` brings the WEAPON onto the same
axis, for `fire` alone.

That last one is a separate mechanism because it has to be. A root yaw is a
RIGID rotation of the whole figure, so it cannot change the angle BETWEEN the
face and the weapon -- it only chooses which end of a pre-existing gap reads
zero. The gap is a property of the supplied hold, which is a CARRY pose:
rifle across the body at low ready, weapon about 37 degrees off the face, and
it was there long before this work (nobody could see it because both ends
were backwards). The weapon follows the ARMS, so only an arm-chain
adjustment can reach it, and `_FIRE_AIM_BONES` is that.

**`fire` aims; `idle` and `down` keep the carry.** That split is a decision,
not an omission: a soldier standing at ease or gone to ground holds his rifle
across his body, and neither clip draws a tracer that contradicts it. `fire`
is the one clip the game draws a straight line out of, so `fire` is the one
clip whose rifle has to be on that line.

`check_clip_semantics` gates all of it: Hips travel, FACE bearing and WEAPON
bearing, each on its mean AND its spread. The weapon half is the one that can
actually go red -- the face half is zero by construction on `idle`, `fire`
and `down`, since the yaw is computed from exactly the bearings it then
tests. `wreck` is exempt from both, for two reasons recorded in the table.

## What this script does, in order

1.  Imports each of the three required GLBs into ONE continuous Blender
    session (never resetting between them -- `wm.read_factory_settings`
    would drop already-collected action data blocks), and keeps only the
    action each one contributes (`*_src`, `use_fake_user=True`). Every
    import's own mesh/armature/"Icosphere" placeholder scaffolding (a
    42-vert unit icosphere Meshy's own export carries alongside the real
    13,910-vert "char1" mesh in every file -- confirmed once by inspection,
    never assumed) is deleted; only the FIRST import's mesh+armature survive
    as the scratch reference rig actions are sampled from later.

2.  Strips the material (`mesh.data.materials.clear()` -- zero materials is
    the contract's own "not negotiable", see module docstring in
    `tools/units/rig.py` for the reasoning this pipeline shares).

3.  Fixes forward -- but NOT the way this step used to. The contract
    requires local +X, and the ORIGINAL mechanism here baked a rotation into
    the scratch ARMATURE object's rest data via `transform_apply`
    (`fix_forward`, still present, now a documented no-op -- see its own
    docstring for the full account). That mechanism cannot touch this
    asset's exported facing at all, at any angle: `bpy.ops.object.
    transform_apply` always preserves the ARMATURE's own `matrix_world`, and
    the scratch MESH -- a plain parented child, never itself touched -- is
    left exactly where it was regardless of what gets baked into the
    bones. Live-measured (walking due east, `simFacing=0`/`meshYaw=0`,
    `renderer.meshUnitEntities`, the `face` mesh's world-space offset from
    its own entity root, `at_team` as a known-correct control): the ORIGINAL
    `+90` bake measured +89.9 degrees off (pointing +Z, not +X), and 0/180
    candidates -- rebuilt and re-exported, not merely recomputed -- measured
    the IDENTICAL +89.9, to 13 significant figures, confirming the
    mechanism is inert regardless of angle. The real fix
    (`FORWARD_FIX_DEG`/`apply_forward_fix`, far below, called from
    `merge_clip_glbs`) rotates the EXPORTED glTF node graph directly, after
    Blender is out of the picture: a three.js/glTF scene graph has no
    "Apply Transform"-style compensation, so wrapping the whole exported
    hierarchy in one new rotated parent node unconditionally propagates to
    every descendant, mesh and joints alike.

4.  Derives TWO held-pose source actions, from two DIFFERENT bases -- they
    are deliberately not the same pose, see the note below on why. `wreck`
    (`build_wreck_src`, UNCHANGED) samples the imported `Shot_and_Blown_Back`
    clip's own LAST frame -- the brief's own original suggestion, and the
    only thing this function has ever done -- once, and keys it static at
    two frames (frame 0 and 1, mirroring `rig.py`'s own `_VIS_FRAMES`
    convention for a well-formed, non-degenerate static clip). `down`
    (`build_down_src`, new) does NOT sample `Shot_and_Blown_Back` at all --
    it starts from `idle`'s own base pose and adds authored leg/spine/head
    bends, kept static the same `_VIS_FRAMES`-style way.

    `down` USED to be retargeted from that same `Shot_and_Blown_Back` clip in
    full (a multi-frame violent fall) -- wrong, because `resolveClip`
    (`clip.ts`) returns `down` for suppression (`pinned`) as much as for
    death, and `applyMeshClip` loops whatever is showing unless told
    `once: true`. A suppressed soldier played the fall on repeat: shot and
    blown back, again and again, for as long as he stayed pinned -- the
    project lead's own "animation of getting hit runs more than once".
    `build_down_src` synthesizes a crouch instead, from `idle`'s own base
    pose plus authored leg/spine/head bends -- see its own docstring for why
    a SLERP blend toward the fall (tried first) was rejected, and for the
    axis/sign measurements the bends are built from.

    Also derives a `fire` source action -- `build_fire_src`, same step,
    same "sample one pose from another clip" idiom as `wreck` above, but
    NOT a static hold: a held-aim base pose plus a short, authored
    recoil-and-settle cycle confined to `RightForeArm`/`RightArm`/
    `RightShoulder`/`Spine02`. See `build_fire_src`'s own docstring for why
    this is synthesized rather than retargeted from a supplied clip.

4b. And BEFORE all of that (step 4.5 in `main()`, which runs first), derives
    `idle` itself -- `build_idle_src`, new 2026-09-15. `idle` is no longer a
    whole supplied file: `measure_clip_bearings` walks
    `Gun_Hold_Left_Turn` frame by frame, `find_hold_window` locates where its
    turn begins, and only the pre-turn hold is bound, with one measured root
    yaw so that hold faces `+X`. `build_fire_src` and `build_down_src` then
    take their base pose from a frame INSIDE that window rather than from
    `frame_range[1]`. See the "Facing" section above for what the old
    arrangement cost.

5.  Duplicates the scratch rig three times (full independent mesh+armature
    data per copy -- forced via `preferences.edit.use_duplicate_mesh` /
    `use_duplicate_armature`, not left to whatever the factory default
    happens to be), renames every bone and matching vertex group with an
    `f0_`/`f1_`/`f2_` prefix, and places each copy at the SAME lateral
    spread `tools/units/teams.py`'s own `inf_squad` uses for its three
    riflemen: `(0.0, -0.78)`, `(0.20, 0.0)`, `(0.0, 0.78)` -- x is the small
    forward/depth nudge `teams.py` gives its middle "leader" figure, y is
    lateral spacing, matching the contract's forward=+X convention exactly
    the way `teams.py`'s own figures are placed.

6.  Joins the three meshes into ONE mesh object (72 vertex groups, one per
    bone) and the three armatures into ONE armature object (72 bones) --
    the contract's "one skin... rather than three". Names/tags that single
    mesh `uniform`, in both the node name and `extras.rl_role` (object
    custom property `ob["rl_role"]`, exported via `export_extras=True`,
    matching `tools/units/rig.py`'s own `join_by_role`). One role, not
    seven, because this asset ships with exactly one material/UV island --
    see the task report for what that costs.

7.  Builds each of the six clips (`idle`, `move`, `fire`, `moveFire`,
    `down`, `wreck`) ONE AT A TIME by replaying its `*_src` action on the (still-original-
    named) SCRATCH rig frame by frame and copying the evaluated pose onto
    all three `f{n}_`-prefixed bone sets via `keyframe_insert` -- the same
    "author with pb.keyframe_insert on a freshly created action" idiom
    `tools/units/rig.py` uses throughout, applied here to a RETARGET rather
    than a hand-authored pose. All three figures perform synchronised (this
    is a supplied mocap clip replayed three times, not independently
    varied) -- acceptable per the brief, which only asks for "three
    figures... with a sensible spread", not desynchronised timing.

    Each clip is exported to its OWN temporary single-animation GLB
    IMMEDIATELY after being built, and the action is then torn back off the
    armature before the next clip starts. This is not incidental structure
    -- see `export_glb`'s own docstring for why building all six actions on
    one armature and exporting once (the obvious approach, and this script's
    first one) silently produces a file where every clip's every channel
    collapses to two identical keyframes.

8.  Merges the six single-clip temporary GLBs into ONE file in pure Python
    (`merge_clip_glbs`, no `bpy`) -- the first file's mesh/skin/node graph
    is kept as-is, and each other file's one animation is re-homed into it:
    its sampler accessors and their backing bufferViews are copied into the
    base file's buffer (4-byte aligned) under fresh indices, while
    `channel.target.node` and `sampler` indices are left untouched, because
    every temporary file was exported from the SAME rig with nothing but
    the active action differing between exports, so node ordering is
    identical across all six -- verified by comparing node name lists
    before trusting index equivalence, never assumed.

## rl_role -- recovered from the source texture, not guessed

R0/this file used to ship the whole figure under a single `uniform` role --
see the task report for why that reads as a flat blob. This revision
recovers the artist's own material zoning by sampling the mesh's OWN
base-color texture at each vertex's own UV (`classify_vertex_roles`) and
clustering the result, instead of inventing a part-level seam the source
never drew. Full cluster analysis (fractions, spatial coherence evidence, and
the one cluster that reads as a lighting artifact vs a real paint zone) is in
`.superpowers/f-meshy-soldier-roles-report.md`, not repeated here -- this
docstring only records WHAT the pipeline does, not the evidence for why.

Four roles come out: `uniform` (bulk fabric, ~90%), `boot` (~3.4%, tight
foot-shaped cluster at the lowest ~12% of standing height), `face` (~4.5%,
tight head-shaped cluster at the top ~22% of standing height -- this asset
DOES show skin, unlike our own fully-covered `kit.py` figures; see the
report's recommendation on `render_team.py`'s terracotta-quantization risk
before treating it as equivalent to a `kit.py` face), and `keffiyeh` (~2.0%,
an unusually-blue but spatially tight, bilaterally symmetric patch at the
head crown and both sides of the neck -- geometrically a headwrap-shaped
region, though the source hue is not the traditional keffiyeh check; see the
report for the confidence call). All four are in the contract's closed role
set (`tools/units/kit.py`'s `ROLES`). No `webbing`/`metal`/`weapon` signal
was found -- see the report for why (every other color cluster is scattered
across the whole body, tracking directional-light shading rather than any
material boundary, confirmed at k up to 10).

Classification runs ONCE against the scratch mesh's bind-pose vertices,
BEFORE duplication (`main()`'s ordering: classify while the material is
still attached, since it is the only route to the texture -- then strip it,
per contract). The resulting per-vertex role list drives `separate_by_role`,
which splits the one scratch mesh into up to four role objects (via
vertex-group-scoped `mesh.separate`, never raw index-based bmesh selection --
index-based selection would break the moment the first separate call
renumbers the remaining object's vertices). `duplicate_figure` then
duplicates the armature and ALL role objects together per figure (so each
mesh's Armature modifier retargets to the right duplicate automatically,
generalising the original single-mesh idiom to N), and the final join step
mirrors `tools/units/rig.py`'s own `join_by_role`: one merged mesh per role,
each carrying all three figures' worth of vertices for that role.

No `mathutils.noise` anywhere in this file (nothing here needs randomness).
Nor does the role classifier: it is nearest-centroid against FOUR FIXED
centroids fit once, externally, against this exact texture (see the report)
-- not a fresh k-means run inside Blender, so there is no ML dependency and
no run-to-run variance to worry about.
"""
import json
import math
import os
import struct
import sys
import tempfile
from collections import defaultdict

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
#: Corrected 2026-09-15, the same correction `import_meshy_soldier_irregular.py`
#: already records making for the Sarim asset: the supplied character sits two
#: grouping folders deeper than this constant used to claim (`art/blend/
#: soldier/` exists in NO checkout, so every path built from the old value
#: was a `FileNotFoundError` waiting for the first person to re-run this
#: script), under Meshy's own full export names. Verified against the real
#: directory -- all seven files listed and their mesh bytes compared -- not
#: assumed.
SRC_DIR = os.path.join(
    REPO, "art", "blend", "KDF", "soldier", "Meshy_AI_lowpoly_mideast_soldi_biped"
)
#: Meshy's own per-animation filename prefix, factored out only because it is
#: 44 characters long and repeated on every source below.
_SRC = "Meshy_AI_lowpoly_mideast_soldi_biped_Animation_"
OUT_PATH = os.path.join(REPO, "art", "meshes", "meshy_soldier.glb")

sys.path.insert(0, os.path.join(REPO, "tools", "units"))
import kit  # noqa: E402 -- the webbing graft below builds real kit.py geometry

#: Clip build order -- also the order clips appear in the merged file.
#: Arbitrary (the runtime reads clips by name, `mesh-unit.ts`'s own
#: `buildMeshUnitTemplate` builds a `Map<ClipName, AnimationClip>`), kept
#: fixed only so a rerun's temp-file names are predictable.
CLIP_ORDER = ("idle", "move", "fire", "moveFire", "down", "wreck")

#: The three clips that actually loop at runtime (`LoopRepeat`, see
#: `write_combined_clip`'s own docstring for why that is what makes a
#: per-figure phase shift well-defined). Passed as `write_combined_clip`'s
#: `cyclic` argument -- `fire`/`down`/`wreck` are not cycles and stay
#: synchronised across figures. `moveFire` is a real gait cycle (the same
#: shape as `move`, with the rifle up) so it gets the same per-figure phase
#: offset `move` does, matching `import_meshy_soldier_irregular.py`.
CYCLIC_CLIPS = frozenset({"idle", "move", "moveFire"})

# --- source clip mapping ------------------------------------------------
# `fire` is deliberately absent: none of the six supplied Meshy clips is a
# firing animation, and `Side_Shot.glb` -- the original task brief's `fire`
# mapping -- is a HIT reaction (measured: ~2x `idle`'s own vertical hip
# travel), not a firing stance. Looping it produced the visible bob this
# file now exists to remove. `build_fire_src` synthesizes `fire` instead,
# from `idle`'s own base pose -- see its docstring. `Side_Shot.glb` is READ
# BY NOTHING in this file any more.
#
# `down` is ALSO deliberately absent now, for the same class of reason:
# `Shot_and_Blown_Back.glb` -- this pipeline's ORIGINAL `down` mapping -- is
# a one-shot death fall, not the HELD "gone to ground" pose `resolveClip`
# (`clip.ts`) also plays on a LOOP for suppression (`pinned`). Looping it
# played a suppressed soldier being blown backwards, on repeat. See
# `build_down_src`'s own docstring. `FALL_SOURCE` below keeps the SAME file
# imported, under a name that says what it is now used for: `wreck` alone.
#
# `idle` is deliberately absent as of 2026-09-15, for a third reason of the
# same family: `Gun_Hold_Left_Turn.glb` -- this pipeline's ORIGINAL `idle`
# mapping, bound WHOLE -- is a figure holding a gun that then turns roughly
# 180 degrees, and `idle` loops. A standing rifleman therefore rotated on the
# spot, for ever. Worse, `build_fire_src` and `build_down_src` both took
# their base pose from that clip's LAST frame, so ONE mis-binding produced
# THREE clips facing backwards (measured on the shipped file: `fire` -156
# deg, `down` -163 deg, `idle` sweeping +23 -> -159, against `move`'s
# correct -5). `TURN_SOURCE` below keeps the same file imported under a name
# that says what it is, and `build_idle_src` binds only its measured pre-turn
# HOLD -- see that function, `find_hold_window`, and
# `docs/superpowers/specs/2026-09-15-infantry-gait-design.md` section 3.1.
#
# `move` is `Running_withSkin.glb` as of the same date, not `Walking`. Not a
# style preference and not a new "fleeing" state: `data/units/kdf/inf_squad
# .json` moves at 0.9 tiles/s and one tile is 3 m (`MESH_UNITS_PER_TILE`), so
# this unit's ONE speed is 2.7 m/s. `move` IS the run. The walk described a
# third of the ground the body crossed (measured ratio 0.315) and the figure
# glided; see the design doc's section 3.2. `Walking.glb` is now read by
# nothing in this file.
CLIP_SOURCES = {
    "move": _SRC + "Running_withSkin.glb",
    "moveFire": _SRC + "Run_and_Shoot_withSkin.glb",
}

#: `Gun_Hold_Left_Turn`, imported under a name that does not claim `idle`.
#: Read by exactly one caller: `build_idle_src`, which binds only the
#: pre-turn hold this clip OPENS on and discards the turn. Not folded into
#: `CLIP_SOURCES` above for the same reason `FALL_SOURCE` is not: that dict's
#: keys are canonical `ClipName`s (`mesh-anim.ts`'s `isMeshClipName`) whose
#: source file is bound whole, and this one is not.
TURN_SOURCE = _SRC + "Gun_Hold_Left_Turn_withSkin.glb"

#: `Shot_and_Blown_Back.glb`, imported under a name that does not claim
#: `down`. Read by exactly one caller now: `build_wreck_src`, for `wreck`'s
#: own last-frame corpse pose -- the SAME use `CLIP_SOURCES["down"]` used to
#: serve before this revision, unchanged in every respect except that `down`
#: itself no longer shares it. Not folded into `CLIP_SOURCES` above: that
#: dict's own keys are canonical `ClipName`s (`mesh-anim.ts`'s
#: `isMeshClipName`), and this source no longer maps to one directly.
FALL_SOURCE = _SRC + "Shot_and_Blown_Back_withSkin.glb"

#: What each of the SIX canonical clips must MEAN, and the measurable
#: property `check_clip_semantics` (below `write_combined_clip`) checks it
#: against -- added so a THIRD instance of this exact mistake is caught
#: here, at build time, rather than by the project lead watching his
#: soldiers fall over. Twice now, a supplied Meshy clip was mapped onto a
#: contract clip name whose SEMANTICS it did not match, and in both cases
#: the NAME looked plausible while the MOTION was wrong:
#:
#:   `Side_Shot.glb`          -> `fire`  (a hit reaction, not a firing stance)
#:   `Shot_and_Blown_Back.glb` -> `down` (a one-shot fall, not a held pose)
#:
#: `hips_travel` is `_hips_world_z_travel`'s own number for that clip
#: (max(z)-min(z) of Hips' WORLD z across the clip's own sampled frames,
#: x100 -- the exact metric `.superpowers/meshy-fire-clip-report.md`'s own
#: comparison table uses). `ceiling(idle_travel)` returns `None` for "no
#: meaningful bound" (idle defines the baseline; move is SUPPOSED to move).
#:
#: `heading` is the SECOND half, added 2026-09-15 after the THIRD instance of
#: this defect class shipped -- and this one was the worst, because it was
#: one mis-binding producing three broken clips rather than one (see
#: `CLIP_SOURCES`' own comment). A Hips-travel ceiling cannot see it at all:
#: a figure standing perfectly still while facing 156 degrees away from what
#: it is shooting has a Hips travel of exactly zero and passes. `heading` is
#: `{mean_deg, spread_deg}` in the EXPORTED file's own convention
#: (`_exported_bearing_deg`: forward is `+X` is 0, positive is the figure's
#: left), or `None` for exempt. BOTH halves are checked and both are needed:
#:
#:   * `mean_deg` catches a clip bound facing the wrong way (the -156 above).
#:   * `spread_deg` catches a clip that TURNS. The whole of
#:     `Gun_Hold_Left_Turn` has a circular mean near -57 and would slip a
#:     generous mean-only bound on some rigs while sweeping 182 degrees; a
#:     mean is exactly the wrong summary for a sweep, which is also why
#:     `tools/src/mesh_gait.ts`'s own `circularMeanDeg` reports min/max
#:     beside it.
#:
#: `weapon` is the same shape again, measured on `_weapon_bearing_deg`, and
#: it exists because `heading` ALONE CANNOT FAIL on three of these six clips.
#: `build_idle_src` yaws the hold by the circular mean of exactly the face
#: bearings this table then tests, so `idle`'s heading mean is 0 BY
#: CONSTRUCTION; `find_hold_window` keeps every bound frame within
#: `LOOP_SEAM_DEG` of the opening, so its spread is bounded by construction
#: too; and `fire` and `down` inherit both from that same base pose. A gate
#: that can only pass is not a gate. The weapon axis is independent of the
#: correction -- a root yaw is a RIGID rotation, so it cannot change the
#: angle between the face and the weapon, only which end of it reads zero --
#: which is what makes this half real, and it is what holds `fire`'s aim in
#: place.
#:
#: Every ceiling below is set from a measurement of THIS asset's own sources
#: (Blender probe, 2026-09-15), not guessed, and each is recorded beside the
#: value it bounds. `tools/src/mesh_gait.test.ts` READS the `heading`
#: `mean_deg` values out of this file rather than restating them, so there is
#: one ceiling per clip and not two.
CLIP_SEMANTICS = {
    "idle": {
        "means": "standing hold, minimal motion -- the baseline every other clip is measured against.",
        "ceiling": lambda idle_travel: None,
        # The bound hold measures mean +0.00 (yaw-corrected to it by
        # construction, which is why this half cannot fail here) and spread
        # 2.68 deg.
        "heading": {"mean_deg": 20.0, "spread_deg": 20.0},
        # Measured -37.34, spread 1.49, and KEPT. The supplied hold is a
        # CARRY -- rifle across the body at low ready -- and a soldier
        # standing at ease holds his rifle across his body. `idle` draws no
        # tracer, so nothing on screen contradicts it. This ceiling therefore
        # has to admit the carry, and says so rather than pretending to be
        # tight: it bounds the DEFECT class (the -166 that shipped) and not
        # the carry. `fire` is the only clip the game draws a straight line
        # out of and the only one that aims -- see `_FIRE_AIM_BONES`.
        "weapon": {"mean_deg": 50.0, "spread_deg": 20.0},
    },
    "move": {
        "means": "a real gait cycle -- Hips travel is EXPECTED here, unlike every other clip in this table.",
        "ceiling": lambda idle_travel: None,
        # `Running` measures mean -0.15, spread 6.13. A head bobs and counter-
        # rotates through a stride, so the spread bound is looser than idle's.
        "heading": {"mean_deg": 20.0, "spread_deg": 30.0},
        # EXEMPT, and measured rather than waved through. NOT because there
        # is no rifle -- there is, in every clip, since this is ONE skinned
        # mesh: 3,248 of `uniform`'s vertices are dominantly weighted to
        # `f0_RightHand` and span 0.692 m in bind pose, which is a rifle and
        # not a hand. The reason is that `Running` swings that arm freely
        # through the stride, so the weapon bearing measures a spread of
        # 154.51 deg over the cycle. There is no single heading here for a
        # ceiling to mean anything against.
        "weapon": None,
    },
    "fire": {
        "means": "stand and shoot; recoil is upper-body only, so Hips travel must not exceed idle's own.",
        "ceiling": lambda idle_travel: idle_travel + 0.5,
        # Measures +0.76, spread 0.09. Synthesized from a frame of the
        # bound hold, so ~0 by construction; `_FIRE_AIM_BONES` deliberately
        # touches no bone above the shoulder, so the aim does not move it
        # either (that is why `Spine02` is not in that table -- see its own
        # comment). The spread ceiling was briefly 20 during the round that
        # added the aim, widened defensively for the `Spine02` variant that
        # was then rejected; it is back at 15, where the measurement puts it,
        # because a ceiling with no measurement beside it is exactly what
        # this table exists to stop.
        "heading": {"mean_deg": 20.0, "spread_deg": 15.0},
        # The tight one, and the whole point of this half of the table.
        # `solve_fire_aim` drives the weapon onto the facing axis and
        # re-measures; the clip then measures mean +1.14 with spread 2.48,
        # the spread being `_FIRE_CYCLE`'s own recoil. 5/15 is real margin
        # over that and nowhere near the -36.65 the carry starts at, so this
        # gate fails loudly the moment the aim stops working. Falsified by
        # hand, not assumed: re-measured with the aim removed it raises at
        # -36.65, and with the clip bound backwards it raises at +143.
        "weapon": {"mean_deg": 5.0, "spread_deg": 15.0},
    },
    "moveFire": {
        "means": (
            "a real gait cycle WHILE firing -- the source's own Run_and_Shoot clip. Hips travel "
            "is EXPECTED here, exactly like `move`; this is NOT `fire`'s near-zero-Hips shape."
        ),
        "ceiling": lambda idle_travel: None,
        # `Run_and_Shoot` measures face mean +10.82, spread 8.42 -- a
        # genuinely BLADED stance, which is what a real walk-and-shoot is; the
        # sibling Sarim rig's own `moveFire` measures +42 and the design doc
        # records it as "bladed but not broken". So this ceiling deliberately
        # bounds the DEFECT class (a clip bound backwards) and not the blade.
        "heading": {"mean_deg": 35.0, "spread_deg": 30.0},
        # THE CONTROL for this whole half of the table, and it was not
        # designed as one -- it is the supplier's own authored firing clip,
        # untouched by anything in this file, and its weapon measures mean
        # +0.31 with spread 1.63. A real walk-and-shoot puts the weapon on the
        # axis of travel and blades the body behind it. That is independent
        # evidence that `_weapon_bearing_deg` measures a weapon rather than an
        # arbitrary bone, and that 0 is the right target for `fire`'s solve.
        "weapon": {"mean_deg": 10.0, "spread_deg": 15.0},
    },
    "down": {
        "means": (
            "a HELD pose -- suppression, looped indefinitely, AND the first phase of death "
            "(mesh-death.ts plays this before wreck) -- near-zero Hips travel, well under idle's."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
        # Two identical keyframes, so the spread is 0 by construction; the
        # mean measures -5.89, the bound hold's own, moved only by
        # `_CROUCH_BENDS`' spine and neck flexion, which is pitch not yaw.
        "heading": {"mean_deg": 25.0, "spread_deg": 5.0},
        # Measured -46.18, and KEPT for the same reason `idle`'s is -- a man
        # gone to ground holds his rifle across him, and `down` draws no
        # tracer either. Slightly wider than `idle`'s because `_CROUCH_BENDS`
        # folds the torso on top of the carry.
        "weapon": {"mean_deg": 55.0, "spread_deg": 10.0},
    },
    "wreck": {
        "means": "a HELD corpse pose -- same requirement as down: static, near-zero Hips travel.",
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
        # EXEMPT from BOTH bearing checks, deliberately, and this is not an
        # oversight to tidy up later. Two independent reasons:
        #
        #   1. `wreck` is the last frame of `Shot_and_Blown_Back` and measures
        #      -166 deg (face). A body thrown round by the round that killed
        #      it is a corpse lying where the blast put it, not a clip bound
        #      backwards. The design doc records the number so the next reader
        #      does not "fix" it.
        #   2. Neither bearing is MEASURABLE on a body lying on the ground:
        #      both forward vectors are then nearly vertical, and the ground
        #      projection of a nearly-vertical vector is noise. Measured, the
        #      two instruments disagree by 40 deg on this one pose (this file
        #      reads face +154.1 where `measureFacing` reads -166.0) against
        #      1-3 deg on every standing clip. A "wider ceiling" would be
        #      gating noise; exempt is the correct answer, here and for any
        #      future `wreckAlt`.
        "heading": None,
        "weapon": None,
    },
}

#: `teams.inf_squad`'s own spread, copied verbatim -- see module docstring
#: point 5. (prefix, dx forward/depth, dy lateral)
FIGURE_SPREAD = (
    ("f0", 0.0, -0.78),
    ("f1", 0.20, 0.0),
    ("f2", 0.0, 0.78),
)

#: k=4 KMeans centroids (linear RGB, 0-1) fit ONCE, externally (scikit-learn,
#: `random_state=0`), against every vertex of Walking.glb's own scratch mesh
#: sampled at its own UV against its own base-color texture -- see the task
#: report for the full analysis. Nearest-centroid classification against
#: these FIXED values reproduces the fitted KMeans labels exactly (verified
#: during analysis: 0 mismatches against `.labels_`), so this file never
#: re-clusters at export time and carries no ML dependency.
_ROLE_CENTROIDS = np.array(
    [
        (0.778843, 0.703726, 0.540231),  # 0: tan   -- split by height, see below
        (0.301201, 0.295605, 0.249430),  # 1: olive, mid-shadow      -> uniform
        (0.499632, 0.474519, 0.362418),  # 2: olive, lit             -> uniform
        (0.136867, 0.253264, 0.792401),  # 3: blue                   -> keffiyeh
    ]
)
_TAN_CENTROID = 0
_BLUE_CENTROID = 3

#: The tan centroid is bimodal in POSITION -- boots at the bottom, face at
#: the top, plus a scatter of bright-highlight false positives across the
#: torso that agree with neither. Fractions of standing height (matching the
#: brief's own "boots are dark AND at the bottom, so both agree" -- here tan
#: agrees with position for boot/face and disagrees for the torso scatter,
#: which is why it folds back to `uniform` rather than getting its own role).
#: Expressed as fractions of the mesh's own measured height rather than an
#: absolute metre threshold, so this does not depend on whatever unit scale
#: Blender's importer happens to apply to this particular file.
_BOOT_FRAC = 0.20 / 1.67  # ~0.1198 -- below this, a tan vertex is a boot
_FACE_FRAC = 1.30 / 1.67  # ~0.7784 -- above this, a tan vertex is skin


def _basecolor_image_array(mesh_obj):
    """(H, W, 4) float32 array of `mesh_obj`'s own Base-Color texture, read
    via `foreach_get` (`image.pixels[i]` one at a time is unusably slow at
    4096x4096 -- ~67M floats). Row 0 is whatever Blender's own internal
    buffer calls row 0 -- deliberately NOT flipped. Confirmed empirically
    (see the task report): Blender's glTF importer flips V on import
    relative to the source glTF's own V convention, and sampling Blender's
    OWN unflipped pixel buffer with Blender's OWN already-flipped
    `uv_layers` V reproduces the source glTF's per-vertex colour to within
    float32 rounding (mean abs error 2e-6 against an independent PIL-based
    read of the raw glTF bytes, across a mismatched-convention control that
    came out 46/255 wrong). Mixing this array with an externally-sourced UV,
    or an externally-loaded (PIL, row-0-top) image, is the bug this
    docstring exists to prevent someone from reintroducing."""
    mat = mesh_obj.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    image = bsdf.inputs["Base Color"].links[0].from_node.image
    w, h = image.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4), w, h


def classify_vertex_roles(mesh_obj):
    """Per-vertex role for every vertex of `mesh_obj`, derived from the
    mesh's OWN base-color texture (the artist's own material zoning) plus a
    position tiebreak -- never guessed. See the task report for the
    clustering analysis this reuses. MUST run before
    `mesh.data.materials.clear()` -- the material is this function's only
    route to the texture.

    UV is read per-VERTEX, taking the first loop touching each vertex
    (confirmed, not assumed: every vertex in this mesh with >1 loop has ALL
    its loops agreeing on UV to floating-point exactness -- the source glTF
    already carries one UV per vertex, seam-split at export rather than
    shared, so there is no ambiguity to average away)."""
    mesh = mesh_obj.data
    img, w, h = _basecolor_image_array(mesh_obj)

    uv_layer = mesh.uv_layers.active.data
    vertex_uv = [None] * len(mesh.vertices)
    for loop in mesh.loops:
        vi = loop.vertex_index
        if vertex_uv[vi] is None:
            vertex_uv[vi] = uv_layer[loop.index].uv

    zmax = max(v.co.z for v in mesh.vertices)

    roles = []
    for v in mesh.vertices:
        u, vv = vertex_uv[v.index]
        px = min(max(int(round(u * (w - 1))), 0), w - 1)
        py = min(max(int(round(vv * (h - 1))), 0), h - 1)
        rgb = img[py, px, :3]
        nearest = int(np.argmin(np.linalg.norm(_ROLE_CENTROIDS - rgb, axis=1)))
        if nearest == _BLUE_CENTROID:
            roles.append("keffiyeh")
        elif nearest == _TAN_CENTROID:
            height_frac = v.co.z / zmax
            if height_frac < _BOOT_FRAC:
                roles.append("boot")
            elif height_frac > _FACE_FRAC:
                roles.append("face")
            else:
                roles.append("uniform")
        else:
            roles.append("uniform")
    return roles


def separate_by_role(mesh_obj, vertex_roles):
    """Splits `mesh_obj` into one object per NON-uniform role present in
    `vertex_roles`, via vertex-group-scoped `mesh.separate` -- never raw
    index-based bmesh selection, which would break the instant the first
    separate call renumbers the remaining object's vertex indices. A
    temporary `_role_<name>` vertex group is created per role and used only
    to drive selection; every one is removed again afterward so the
    per-figure vertex-group count (24 bones -- see `main()`'s own assertion)
    is not polluted.

    Whatever is left in `mesh_obj` once every non-uniform role has been
    peeled off IS the `uniform` role -- boundary triangles whose three
    vertices disagree on role (never fully selected for any one role's
    separate call) fall back here too, which is the right default: a stray
    edge triangle shading through the broad `uniform` ramp is harmless,
    where inventing a fifth sliver role would not be.

    Returns `{role: mesh_obj}`, covering every role including `uniform`.
    Each object carries `rl_role` as an object custom property (exported via
    `export_extras=True`, matching the contract) -- this is also how
    `duplicate_figure` recovers which duplicate is which role after a
    multi-object `bpy.ops.object.duplicate()`, since neither object name nor
    `bpy.context.selected_objects` order is a index a multi-object duplicate
    guarantees."""
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
    HIGHEST vertex count, not by name or iteration order. Every one of these
    supplied files carries a second, 42-vert "Icosphere" placeholder alongside
    the real 13,910-vert "char1" mesh (confirmed once by direct inspection,
    see module docstring point 1); a plain `set` difference iterates in
    arbitrary hash order, so picking "the first MESH" silently grabbed the
    icosphere on one run -- this is the fix, not a defensive guess."""
    meshes = [o for o in new_objs if o.type == "MESH"]
    return max(meshes, key=lambda o: len(o.data.vertices))


def import_clip(path, target_name):
    """Imports `path`, renames its lone new action to `target_name` (fake
    user, so it survives the scaffolding cleanup below), and deletes every
    object the import created -- the real mesh, the "Icosphere" placeholder,
    and the armature alike (this path is for the three non-base clips, whose
    mesh+armature this script never uses -- only their action)."""
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
    """Same as `import_clip`, but KEEPS the real mesh+armature (the very
    first import -- this pair becomes the scratch reference rig every other
    clip is sampled onto). Still deletes the "Icosphere" placeholder."""
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


#: Kept at 0 (inert) -- see `fix_forward`'s own docstring for why baking a
#: rotation into the ARMATURE OBJECT here, the mechanism this pipeline
#: shipped with originally (`+90`, derived from comparing the "headfront"
#: marker bone's `head_local.y` against "Head"'s), cannot fix this asset's
#: facing at all, in either direction: it was live-measured, at THREE
#: different candidate angles (0/90/180), to have IDENTICAL, ZERO effect on
#: the exported bind-pose facing every time. The real fix is
#: `FORWARD_FIX_DEG`/`apply_forward_fix` far below, a POST-EXPORT glTF-level
#: correction. This constant and `fix_forward` are kept, at 0, rather than
#: deleted: a future Meshy source might genuinely need a bone-rest
#: correction for some OTHER reason (e.g. to keep `move`/`idle`'s own
#: retargeted pose data legible against a differently-oriented rest bone in
#: Blender's own viewport while authoring), and the mechanism itself is not
#: wrong -- only "this is where the exported FACING direction lives" was.
_FIX_FORWARD_DEG = 0.0


def fix_forward(arm_obj):
    """Bake `_FIX_FORWARD_DEG` (currently 0, i.e. a no-op) about Z into the
    scratch rig's rest pose. Applied and baked (`transform_apply`) to the
    scratch ARMATURE object only -- its child mesh follows via ordinary
    object parenting.

    ## Why this cannot fix the exported facing direction, at any angle

    This was the pipeline's ORIGINAL forward-correction mechanism (shipped
    at `+90`, derived from a STATIC bind-pose bone-position comparison --
    "headfront" marker bone's `head_local.y` below "Head"'s, see git
    history). A live walking measurement (`renderer.meshUnitEntities`, the
    `face` mesh's world-space offset from its own entity root, unit walking
    due east at `simFacing=0`/`meshYaw=0`, `at_team` as a known-correct
    control) showed the shipped `+90` still 90 degrees off: this figure's
    face measured +89.9 deg (+Z) against the control's -0.9 deg (+X,
    correct). Candidates 0 and 180 were then tried -- REBUILDING AND
    RE-EXPORTING the asset for each -- and BOTH measured the exact same
    +89.9 deg, to 13 significant figures, as the shipped +90 (confirmed via
    a network capture that the live page really was loading each freshly
    rebuilt file, not a cached one -- md5 differed between builds; only the
    MEASURED ANGLE did not).

    The reason is `bpy.ops.object.transform_apply`'s own, documented
    contract: applying a transform on an object always preserves THAT
    object's own `matrix_world` (the transform moves from the object
    property to the object's data; nothing about where the object itself
    sits changes), and for a PARENT with children, Blender adjusts nothing
    about the children either -- they stay visually put as a direct
    consequence, needing no special-cased compensation. Baking a rotation
    into the ARMATURE this way therefore rotates every BONE's own rest
    matrix (real, and load-bearing for `sample_clip`'s pose evaluation,
    which is why this function still runs before `build_fire_src`/
    `build_wreck_src`/`sample_clip` below) but leaves the scratch MESH's own
    vertex data and object transform completely untouched, at every angle --
    and this pipeline's live measurement reads the `face` role MESH's own
    geometry (`boundingSphere.center` through `localToWorld`), which
    reflects the MESH's rigid placement, never the bones'. A three.js/glTF
    scene graph has no equivalent "apply" step with this compensating
    behaviour -- a parent node's rotation always visually propagates to
    every descendant -- which is why the real fix (`apply_forward_fix`,
    below) rotates the EXPORTED node graph directly instead of anything
    inside Blender."""
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.rotation_euler = (0.0, 0.0, math.radians(_FIX_FORWARD_DEG))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


# --- forward bearing, measured -----------------------------------------
#
# Every number below is in the EXPORTED file's own convention, not Blender's,
# so it can be compared directly against `tools/src/mesh_gait.ts`'s
# `measureFacing` and against the design doc's section 2.1 table: forward is
# `+X` is 0 degrees, and positive is the figure's own LEFT.
#
# The conversion is two fixed steps and both were verified live rather than
# derived and trusted. Blender is Z-up and its glTF exporter writes Y-up as
# `(x, z, -y)`, so a ground-plane vector `(dx, dy)` here becomes `(dx, -dy)`
# in glTF's own `(x, z)` ground plane -- which NEGATES the bearing. Then
# `apply_forward_fix` wraps the whole merged graph in one node rotated
# `FORWARD_FIX_DEG` about `+Y`, which SUBTRACTS that angle from every bearing
# in the file. Cross-check (Blender probe against the already-shipped
# `art/meshes/meshy_soldier.glb`, 2026-09-15): `Gun_Hold_Left_Turn`'s opening
# frame predicts +22.67 here and the shipped `idle` clip's own first sample
# reads +22.7 through the same `Head`->`headfront` pair in the exported file.


def _wrap_deg(deg):
    """`deg` folded into `(-180, 180]`."""
    while deg > 180.0:
        deg -= 360.0
    while deg <= -180.0:
        deg += 360.0
    return deg


def _circular_mean_deg(values):
    """`(mean, lo, hi)` of a list of bearings in degrees, where `lo`/`hi` are
    the mean plus the smallest/largest signed deviation from it.

    A plain arithmetic mean is wrong at exactly the place this file most
    needs to be right -- +179 and -179 are two degrees apart on the circle
    and average to 0, "facing forward", for a figure facing backward -- and
    the defects this gate exists for cluster at that discontinuity. Same
    reasoning, same shape and the same reported window as
    `tools/src/mesh_gait.ts`'s own `circularMeanDeg`, deliberately, so a
    build-time number and a shipped-file number can be compared without
    anyone having to ask which kind of mean each one is."""
    sx = sum(math.cos(math.radians(v)) for v in values)
    sy = sum(math.sin(math.radians(v)) for v in values)
    mean = math.degrees(math.atan2(sy, sx))
    devs = [_wrap_deg(v - mean) for v in values]
    return mean, mean + min(devs), mean + max(devs)


def _exported_bearing_deg(dx, dy):
    """A Blender WORLD ground-plane vector, as the exported file will read
    it. See the block comment above for the two steps and the live
    cross-check."""
    return _wrap_deg(math.degrees(math.atan2(-dy, dx)) - FORWARD_FIX_DEG)


def _clip_frame_positions(action):
    """Exactly the frame positions `sample_clip` visits, in order.

    THREE functions need this and it has to be the same list in all three,
    which is precisely when two copies should be one: `sample_clip` writes
    output frame `step` from the pose at position `step`, `measure_clip_
    bearings` reports a bearing per `step`, and `build_idle_src` trims by a
    window expressed in `step`. If any of them derived its own positions, an
    index measured by one would silently mean a different frame in another --
    and the whole hold-window mechanism is nothing but an index passed
    between them."""
    f0, f1 = action.frame_range
    n_steps = max(1, round(f1 - f0))
    return [f0 + (f1 - f0) * step / n_steps for step in range(n_steps + 1)]


def _face_bearing_deg(scratch_arm):
    """Where the FACE points, from the currently evaluated pose.

    The `Head` -> `headfront` marker pair is this rig's own, authored by the
    supplier: `headfront` is a leaf marker bone in front of the skull, and it
    is what the original (wrong, now inert) `fix_forward` derived its angle
    from. Two reasons it is the right probe rather than, say, the hips: it is
    a HEAD reading, the same thing `tools/src/mesh_gait.ts`'s `measureFacing`
    reads in the shipped file, so the two instruments can be compared
    directly (measured offset on this asset: 1-3 degrees); and the complaint
    this work answers is about faces not being in front of guns."""
    world = scratch_arm.matrix_world
    head = world @ scratch_arm.pose.bones["Head"].matrix.translation
    front = world @ scratch_arm.pose.bones["headfront"].matrix.translation
    return _exported_bearing_deg(front.x - head.x, front.y - head.y)


def _weapon_bearing_deg(scratch_arm):
    """Where the WEAPON points, from the currently evaluated pose.

    `RightHand`'s own bone direction -- head to tail.

    **The figure really does carry a rifle**, and a reader who assumes
    otherwise will draw the wrong conclusion from this whole file: the
    supplied `char1` mesh models one, skinned to the arm bones like the rest
    of the body. What it does NOT have is a `weapon` rl_role of its own --
    `classify_vertex_roles` splits this mesh by sampling its own base-colour
    texture, the rifle is the same olive as the uniform, and so it lands in
    `uniform` with ~90% of the vertices. It therefore cannot be isolated by
    role and measured directly, which is why the bearing is taken off the rig
    instead. (An earlier revision of this comment said the asset "ships no
    weapon mesh at all". That was wrong, and the renders under
    `.superpowers/sdd/2026-09-15-infantry-gait/` show the rifle plainly.)

    The rig proxy is not a fresh invention: `_FIRE_RECOIL_BONES`' own
    docstring already established `RightHand`'s TAIL as the closest available
    proxy for muzzle position when the recoil impulse was measured, so
    head->tail is the line from grip to muzzle under that same proxy.

    It is validated three independent ways, none of them circular. The
    supplier's own authored firing clip, `Run_and_Shoot` -> `moveFire`,
    untouched by anything in this file, measures +0.31 deg with spread 1.63
    on it -- a real walk-and-shoot puts its weapon on the axis of travel, so
    a proxy that reads 0 there is reading a weapon. The review's own
    independent reading of the same quantity on the pre-fix file's `fire`
    agrees to a few degrees (+159.2 here against their +163.4, gap -38.5
    against their -40.6). And the before/after renders of `fire` show the
    DRAWN rifle going from held diagonally across the chest, muzzle up and
    across, to levelled along the facing axis -- which is what this number
    going from -36.65 to +1.14 claims happened.

    Two definitions were measured and REJECTED, recorded so nobody pays for
    them twice. `RightHand` -> `LeftHand` is not the barrel: in this pose the
    support hand sits 0.166 m from the trigger hand and almost entirely
    PERPENDICULAR to the hand-bone axis, so it says where the support hand is
    and not where the weapon points. And a mesh-centroid pair is not a
    heading at all -- `measureFacing`'s own docstring records that negative
    result for the face, and here the weapon shares a role mesh with the
    entire uniform, so there is no centroid to take.

    NOT meaningful on `move`: `Running` is a free-swinging run mocap in which
    the figure carries the rifle in one hand at his side, so `RightHand`
    tracks a pumping arm. Its weapon spread measures 154.51 deg over the
    cycle. That is why `CLIP_SEMANTICS['move']['weapon']` is `None`."""
    world = scratch_arm.matrix_world
    pb = scratch_arm.pose.bones["RightHand"]
    grip = world @ pb.matrix.translation
    muzzle = world @ pb.tail
    return _exported_bearing_deg(muzzle.x - grip.x, muzzle.y - grip.y)


#: How far a frame's forward bearing may drift from the source clip's OWN
#: OPENING bearing before that frame counts as part of the turn rather than
#: part of the hold. `build_idle_src` reports the first frame past this and
#: never binds it. Ten degrees is large enough that idle sway, breathing and
#: the weapon settling do not read as a turn (the bound hold's own total
#: spread is 1.2 deg) and small enough to bound a 182-degree sweep to within
#: a handful of frames of where it starts.
HOLD_TOLERANCE_DEG = 10.0

#: The SECOND, tighter tolerance, and the one that actually bounds `idle`.
#: `HOLD_TOLERANCE_DEG` asks "has the turn begun"; this asks "does the
#: trimmed clip LOOP". `idle` plays on `LoopRepeat` (`mesh-unit.ts`'s
#: `applyMeshClip`), so its last frame runs straight into its first, and the
#: source is a one-way clip that never returns to its opening pose -- binding
#: every frame inside the 10-degree window would put a 7-degree head snap on
#: the seam, once every 1.3 s, for ever. Measured on this source: the 10-deg
#: window ends at frame 33 (bearing +15.5, a 7.1-deg seam) and the 2-deg one
#: at frame 30 (+21.0, a 1.7-deg seam). Both numbers are printed on every
#: build; only this one is bound.
LOOP_SEAM_DEG = 2.0


def measure_clip_bearings(scratch_arm, action):
    """Replays `action` on the scratch rig and returns `(face, weapon)` --
    two lists of ground-plane bearings, one per frame, in the exported file's
    own convention. See `_face_bearing_deg` and `_weapon_bearing_deg` for
    what each vector is and why.

    BOTH are needed and the second is the load-bearing one. `build_idle_src`
    yaws the hold by the circular mean of exactly the FACE bearings that
    `check_clip_semantics` then tests, so a face-only gate is zero by
    construction on `idle` and, through the base pose, on `fire` and `down`
    too -- it could not fire on the three clips it was added for. A root yaw
    is a RIGID rotation of the whole figure (`Hips` is the root), so it
    cannot change the angle BETWEEN the face and the weapon; it only chooses
    which of the two gets to be zero. The weapon bearing is therefore
    genuinely independent of the correction, and gating it is what makes the
    check real rather than self-satisfying.

    Sampled at exactly `sample_clip`'s own frame positions
    (`_clip_frame_positions`), so an index into either list is the same frame
    as the same index into that function's output, and a window measured here
    can be applied there without any re-mapping.

    Reassigns `action_slot` explicitly, for the reason `sample_clip`'s own
    docstring records at length: this function READS pose values back through
    `frame_set` without ever writing a keyframe, so a stale slot left bound by
    a previous action silently freezes every reading at that action's pose."""
    scratch_arm.animation_data.action = action
    scratch_arm.animation_data.action_slot = action.slots[0] if action.slots else None
    bpy.context.view_layer.update()
    face, weapon = [], []
    for src_frame in _clip_frame_positions(action):
        bpy.context.scene.frame_set(int(src_frame), subframe=src_frame - int(src_frame))
        bpy.context.view_layer.update()
        face.append(_face_bearing_deg(scratch_arm))
        weapon.append(_weapon_bearing_deg(scratch_arm))
    return face, weapon


def find_hold_window(bearings):
    """`(departure, hold_end)` -- both indices into `bearings`.

    `departure` is the FIRST frame whose bearing has left the clip's own
    opening bearing by more than `HOLD_TOLERANCE_DEG` (`None` if the clip
    never turns at all); `hold_end` is the last frame BEFORE it that is still
    within `LOOP_SEAM_DEG`, i.e. the last frame that can end a loop without a
    visible snap back to frame 0.

    Computed on every build, never hand-entered. That is the point: a
    re-supplied `Gun_Hold_Left_Turn` whose turn starts earlier or later would
    otherwise silently keep a frame number fitted to the old one, which is the
    exact shape of bug this whole gate exists to make unshippable. Relative to
    the clip's OWN opening bearing rather than to absolute forward for the
    same reason -- the question here is "where does the TURN begin", which is
    a property of the clip; where the hold points is a separate question and
    `build_idle_src` answers it separately.

    `hold_end` needs no empty-list fallback and deliberately has none: index
    0 IS the opening bearing, so its own deviation is exactly 0 and it passes
    both tolerances unconditionally. A guard there would read as a real case
    and is not one."""
    opening = bearings[0]
    departure = None
    for i, deg in enumerate(bearings):
        if abs(_wrap_deg(deg - opening)) > HOLD_TOLERANCE_DEG:
            departure = i
            break
    limit = len(bearings) if departure is None else departure
    seam = [i for i in range(limit) if abs(_wrap_deg(bearings[i] - opening)) <= LOOP_SEAM_DEG]
    return departure, seam[-1]


def build_idle_src(scratch_arm, turn_action, hold_end, forward_yaw_deg):
    """`idle` = `turn_action`'s own PRE-TURN HOLD, frames `[0, hold_end]`,
    re-keyed as its own action with one root yaw applied.

    ## The trim

    `Gun_Hold_Left_Turn` is what its name says and the whole of it used to be
    bound to `idle`, which loops -- so a standing KDF rifleman turned 180
    degrees on the spot and started again, and `build_fire_src` and
    `build_down_src` both sampled the far end of that turn as their base
    pose. Binding only the hold fixes all three at once, which is the point:
    ONE mechanism was producing three broken clips.

    ## The yaw, and why the body is left bladed

    The hold is not merely trimmed, it is turned to face forward. Measured on
    this source, the held stance stands at hips +48 deg with the head at +22
    -- the man stands quarter-left of the contract's `+X`. `move` (from a
    different supplied file) stands at 0. So the two clips disagree about
    which way forward is by the better part of a quarter turn, and the
    renderer yaws the ROOT at the unit's heading: whatever this clip believes
    is forward is what the player sees him shoot along.

    `forward_yaw_deg` -- the circular mean of the bound window's own measured
    bearings, computed by the caller, never typed -- is applied to `Hips`
    alone. `Hips` is this rig's single root bone, so one rotation there turns
    the entire figure rigidly, and because it is a ROOT rotation every other
    bone's local axes are untouched: `_FIRE_RECOIL_BONES` and `_CROUCH_BENDS`
    keep acting in exactly the same body-relative directions they were
    measured in, and `_CROUCH_HIPS_DROP_M`'s basis-space conversion is
    likewise unaffected (a delta in a root bone's basis translation maps to
    `rest.to_3x3() @ delta` in armature space regardless of what that basis's
    rotation is).

    The yaw is set from the HEAD, so after it the head reads ~0 and the hips
    ~+26. **It does not put the weapon at 0, and cannot.** A root yaw is a
    RIGID rotation of the whole figure, so the angle BETWEEN the face and the
    weapon is invariant under it: the yaw only chooses which end of a
    pre-existing gap gets to be zero. That gap is a property of the supplied
    hold, which is a CARRY pose -- rifle across the body at low ready -- and
    it was there before any of this work (measured on the pre-trim file's own
    `fire`: face -156.0, weapon +159.2, gap -38.5; nobody could see it
    because both ends were backwards). The three available outcomes are
    exactly determined and none fixes both:

        trim only          face +22.3   weapon -10.4
        yaw from the head  face  ~0     weapon ~-37    <- this function
        yaw from the hips  face ~+33    weapon  ~0

    Choosing the head is deliberate: a shooter blades his body to the target
    and squares his eyes to the sights, and the instrument that gates this
    (`measureFacing`) reads the head. The WEAPON is brought onto the axis
    separately, and only for `fire`, by `_FIRE_AIM_BONES` in
    `build_fire_src` -- which reaches it because the weapon follows the ARMS,
    which no root rotation can address.

    `idle` and `down` keep the carry, and that is a DECISION rather than an
    oversight: a soldier standing at ease or gone to ground holds his rifle
    across his body, face forward and weapon across is correct for both, and
    neither clip draws a tracer that contradicts it. `fire` is the only one
    the game draws a straight line out of, so `fire` is the only one that has
    to aim. `CLIP_SEMANTICS`' `weapon` ceilings encode exactly that split.

    This is NOT `fix_forward` reaching for the mechanism its own docstring
    spends two paragraphs proving inert. That one baked a rotation into the
    scratch ARMATURE OBJECT's rest data via `transform_apply`, which preserves
    the object's `matrix_world` and never touches the parented mesh, so it
    could not move the exported facing at any angle. This writes POSE data --
    the same `pb.keyframe_insert` authoring idiom `build_fire_src` and
    `build_down_src` already use -- into one clip's own keyframes, which is
    exactly what does get exported. Nor does it replace `FORWARD_FIX_DEG`,
    which is a whole-FILE correction calibrated against the walk; this is a
    per-clip correction for one source that disagrees with it."""
    from mathutils import Matrix  # noqa: PLC0415 -- only this function needs it

    scratch_arm.animation_data.action = turn_action
    scratch_arm.animation_data.action_slot = (
        turn_action.slots[0] if turn_action.slots else None
    )
    bpy.context.view_layer.update()
    hips_rest = scratch_arm.data.bones["Hips"].matrix_local
    yaw = Matrix.Rotation(math.radians(forward_yaw_deg), 4, "Z")
    rebase = hips_rest.inverted() @ yaw @ hips_rest

    snapshots = []
    for src_frame in _clip_frame_positions(turn_action)[: hold_end + 1]:
        bpy.context.scene.frame_set(int(src_frame), subframe=src_frame - int(src_frame))
        bpy.context.view_layer.update()
        frame = {}
        for pb in scratch_arm.pose.bones:
            if pb.name == "Hips":
                loc, quat, scale = (rebase @ pb.matrix_basis).decompose()
                frame[pb.name] = (tuple(quat), tuple(loc), tuple(scale))
            else:
                frame[pb.name] = (
                    tuple(pb.rotation_quaternion),
                    tuple(pb.location),
                    tuple(pb.scale),
                )
        snapshots.append(frame)

    idle = bpy.data.actions.new("idle_src")
    idle.use_fake_user = True
    scratch_arm.animation_data.action = idle
    scratch_arm.animation_data.action_slot = None
    for step, frame in enumerate(snapshots):
        for pb in scratch_arm.pose.bones:
            q, loc, sc = frame[pb.name]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.scale = sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=step)
            pb.keyframe_insert(data_path="location", frame=step)
            pb.keyframe_insert(data_path="scale", frame=step)
    return idle


def build_wreck_src(scratch_arm, fall_action):
    """A static two-frame action holding `fall_action`'s own last frame --
    the imported `Shot_and_Blown_Back` clip, the brief's own suggested
    `wreck` candidate. `_VIS_FRAMES`-style (frame 0 and 1, matching
    `tools/units/rig.py`'s own convention for a non-degenerate static clip)
    rather than a single keyframe.

    Parameter renamed from `down_action` -- this function's own logic is
    UNCHANGED, but what gets passed to it is not: `down` used to BE this
    same clip (retargeted in full, not just its last frame), and is now a
    synthesized crouch (`build_down_src`) instead. `main()` now passes the
    raw imported `fall_src` here, not the `down_src` action it builds for
    the `down` clip -- see the module docstring's "what this script does"
    point 4 for why `wreck` alone still needs this exact source."""
    scratch_arm.animation_data.action = fall_action
    f0, f1 = fall_action.frame_range
    bpy.context.scene.frame_set(int(f1), subframe=f1 - int(f1))
    bpy.context.view_layer.update()

    snapshot = {}
    for pb in scratch_arm.pose.bones:
        snapshot[pb.name] = (
            tuple(pb.rotation_quaternion),
            tuple(pb.location),
            tuple(pb.scale),
        )

    wreck = bpy.data.actions.new("wreck_src")
    wreck.use_fake_user = True
    scratch_arm.animation_data.action = wreck
    for pb in scratch_arm.pose.bones:
        q, loc, sc = snapshot[pb.name]
        pb.rotation_quaternion = q
        pb.location = loc
        pb.scale = sc
        for frame in (0, 1):
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            pb.keyframe_insert(data_path="location", frame=frame)
            pb.keyframe_insert(data_path="scale", frame=frame)
    return wreck


#: Recoil bones, local axis (0=X/1=Y/2=Z in POSE space -- i.e. `Quaternion`
#: composed as `base_quat @ Quaternion(axis, angle)`, NOT a world axis) and
#: PEAK angle in degrees. Values and axis choice are measured, not guessed:
#: a standalone forward-kinematics probe (`.superpowers/meshy-fire-clip-
#: report.md` carries the numbers) applied +-15deg about each local axis of
#: every candidate bone to this exact rig's own idle-last-frame pose and
#: read back the resulting WORLD-space displacement of `RightHand`'s tail
#: (the closest available proxy for muzzle position -- the rifle IS modelled
#: in the supplied mesh, but it carries no `weapon` rl_role of its own and so
#: cannot be isolated; see `_weapon_bearing_deg`). Local -X on `RightForeArm`/`RightArm`/`Spine02` and local
#: -Z on `RightShoulder` were the ones that move that point mostly in world
#: +Z (muzzle rises) with a small world -X companion (pulls back, not
#: forward) and little lateral drift -- i.e. "up and back", the shape a
#: braced-weapon recoil actually has, not a guess from bone naming.
#: Magnitude falls off going up the chain (forearm carries most of the kick,
#: shoulder and spine react less) the way a real recoil transmits through a
#: braced weapon rather than snapping the whole arm as one rigid unit.
_FIRE_RECOIL_BONES = {
    "RightForeArm": (0, -14.0),
    "RightArm": (0, -6.0),
    "RightShoulder": (2, -6.0),
    "Spine02": (0, -3.0),
}

#: (frame, fraction of each bone's own peak angle in `_FIRE_RECOIL_BONES`).
#: Frame 0 IS the base pose (idle's own held-aim stance, fraction 0). Frame
#: 2 is the sharp kick-out (fraction 1, full peak) -- a 2-frame attack reads
#: as "sharp" rather than a slow wind-up. Frame 6 is a small rebound
#: UNDERSHOOT (fraction -0.12, past centre the other way) -- a spring
#: settling, not a linear decay, for a touch of "settling back" rather than
#: a robotic snap-to-rest. Frame 12 returns EXACTLY to the base pose
#: (fraction 0) so the clip loops with no seam pop: `fire` is never played
#: with `once: true` (`mesh-unit.ts`'s `applyMeshClip` -- `idle`/`move`/
#: `fire`/`work` all keep three.js's own `LoopRepeat` default), so this
#: clip plays back to back for as long as a unit keeps firing.
_FIRE_CYCLE = ((0, 0.0), (2, 1.0), (6, -0.12), (12, 0.0))

_FIRE_AXIS_VEC = {0: (1.0, 0.0, 0.0), 1: (0.0, 1.0, 0.0), 2: (0.0, 0.0, 1.0)}

#: The AIM adjustment: (bone, local axis, SHARE of the solved magnitude).
#: The ARM half of the chain `_FIRE_RECOIL_BONES` already poses -- the weapon
#: follows the arms, and a root yaw cannot reach it because a root rotation
#: moves the whole figure rigidly (see `build_idle_src`).
#:
#: The supplied hold is a CARRY -- rifle across the body at low ready -- and
#: `fire` is the one clip the game draws a straight line out of, so `fire` is
#: the one clip that has to bring the weapon onto that line. Measured on this
#: source's own base pose, the weapon starts at -36.65 deg with the face at
#: +0.75, a gap of -37.40.
#:
#: Axis choice per bone is MEASURED, the same way `_FIRE_RECOIL_BONES`' was:
#: a standalone probe applied +15 deg about each local axis of every
#: candidate bone to this exact base pose and read back the change in weapon
#: bearing, in FACE bearing, and in the distance between the two hands.
#: Degrees of weapon bearing per +15 deg of bone, with what each costs:
#:
#:   Spine02 axis Z     +7.93   face -0.29   hands +0.0000   <- REJECTED, see
#:   Spine01 axis Z     +8.69   face +0.65   hands -0.0000      below
#:   RightShoulder X   +11.10   face  0.00   hands +0.0453
#:   RightShoulder Z   +11.05   face  0.00   hands +0.0766
#:   RightArm Y        +10.11   face  0.00   hands +0.0573
#:   RightArm Z        +10.95   face  0.00   hands +0.0801
#:   RightForeArm Z    +14.82   face  0.00   hands +0.0513
#:
#: Each of the three arm bones is on the axis with the best weapon-per-hand-
#: drift ratio available to it, and they share the solved magnitude equally.
#:
#: **`Spine02` was tried, and REJECTED on a measurement of the EXPORTED
#: file** -- which is the whole reason this pipeline verifies the export and
#: not the script. On the probe table above it looks like the obvious first
#: choice: it moves the weapon nearly as well as an arm bone, costs 0.019 deg
#: of face per degree (a 27:1 ratio), and carries BOTH arms so it cannot
#: separate the hands at all. A build with it carrying double share solved to
#: 9.54 deg and passed every build-time check -- and then `measureFacing`
#: read `fire`'s face at **+15.2** against the arm-only build's **+0.3**.
#: The two instruments disagreed by 14 deg on one clip where they agree to
#: 1-3 on every other, because a `Spine02` local-Z rotation is not about the
#: vertical: it TILTS the head rather than yawing it, and the ground-plane
#: bearing of a tilted vector depends on which vector you measure.
#: `headfront` lies along the head's own forward axis and barely moved; the
#: face mesh's centroid does not, and swung 14 deg. The arms move the weapon
#: and leave the head alone -- measured face delta 0.00 for all three -- so
#: they are the whole table.
#:
#: The hand separation rising from 0.166 m to about 0.32 m is NOT damage and
#: was checked rather than assumed: a carry holds the hands close together,
#: and an aim spreads them along the weapon. The rifle is real geometry and
#: the player really does see this -- it is modelled in the supplied mesh and
#: skinned to these same arm bones, it just has no `weapon` rl_role of its
#: own (see `_weapon_bearing_deg`). Photographed before and after at 1400 px
#: through the game's own camera, `.superpowers/sdd/2026-09-15-infantry-gait/
#: fire-pose-{before,after}.png`: it goes from held diagonally across the
#: chest with the muzzle up and across -- port arms, while tracers leave
#: along `+X` -- to levelled down the facing axis.
_FIRE_AIM_BONES = (
    ("RightShoulder", 0, 1.0),
    ("RightArm", 1, 1.0),
    ("RightForeArm", 2, 1.0),
)

#: How close the solved aim must bring the weapon to the facing axis before
#: this script will ship the clip. This checks CONVERGENCE and nothing else,
#: and it is worth being precise about that because an earlier version of
#: this comment claimed it guarded against "the chain being unable to reach
#: the axis". It does not and cannot: the three bones move the weapon about
#: 2.4 deg of bearing per degree of magnitude, with no bound of their own, so
#: the chain can reach ANY bearing and this residual is effectively
#: unreachable. What bounds the solve is `_FIRE_AIM_MAX_HAND_SEPARATION_M`
#: below.
_FIRE_AIM_RESIDUAL_DEG = 1.0

#: The real bound on the aim, and the reason it needs one: a solve with no
#: cap will always hit its target. Because the chain can reach any bearing, a
#: re-supplied source with a much larger carry offset would simply solve to a
#: much larger magnitude and ship an implausibly posed arm with every gate
#: green -- the weapon bearing would be correct BY CONSTRUCTION, and
#: `pnpm validate:meshes` photographs only `idle`, so nothing downstream ever
#: looks at the firing pose. "It converged" is not "it is a pose".
#:
#: The cap is on the physical consequence rather than on the angle, because
#: the angle alone does not say whether the result is a person: what makes an
#: over-solved arm read as broken is the two hands coming off the same
#: weapon. It is DERIVED from the figure, not picked -- the hands may not end
#: up further apart than the weapon-side arm is long (`RightArm` joint to
#: `RightHand` joint, measured on the rig at build time), because two hands
#: further apart than one arm's reach are not holding one rifle between them.
#: It therefore scales with a differently-proportioned re-supplied figure
#: instead of going stale.
#:
#: Measured on this source (`fire_aim_hand_separation_limit_m`, no export
#: needed): the aim takes the hands from 0.166 m to 0.315 m against an arm
#: reach of 0.4685 m, so the shipped input clears the cap by 0.154 m and
#: adding this guard changed no output -- verified by re-running the solve
#: against the identical base pose and reading the identical 14.72 deg.
#: Swept across magnitude, the separation goes 0.166 / 0.268 / 0.315 / 0.365 /
#: 0.448 / 0.481 m at 0 / 10 / 14.72 / 20 / 30 / 35 deg, so the cap bites at
#: about 33 deg -- roughly 2.2x what this source needs.
#:
#: Falsified through the real `solve_fire_aim` path by moving the target axis
#: away from the weapon, which is exactly "a re-supplied source with a bigger
#: carry offset". A carry 30 deg worse than this one solves to 26.69 deg with
#: the hands 0.423 m apart and PASSES -- deliberately: that is a wide but
#: physically possible two-handed grip, and this cap bounds the implausible
#: rather than rejecting everything unfamiliar. 60 deg worse (magnitude 44.79)
#: and 90 deg worse (magnitude 158.84, each joint wrapped most of the way
#: round) both raise.

#: Iterations for the secant solve. The bone-to-weapon gains above are close
#: to linear over the range involved, so this converges in three or four; ten
#: is a ceiling, not an expectation.
_FIRE_AIM_MAX_ITERS = 10


def _apply_pose(scratch_arm, base, deltas):
    """Write `base` (a `{bone: (Quaternion, loc, scale)}` snapshot) onto the
    rig, post-multiplying `deltas` (`{bone: (axis_index, degrees)}`) in each
    bone's own LOCAL space, and evaluate. The same `base_q @ Quaternion(axis,
    angle)` convention `build_fire_src` and `build_down_src` both author
    with, factored out so the aim SOLVE poses the rig exactly the way the
    final keyframes will be written -- a solve against a different
    composition would converge on a number that does not hold."""
    from mathutils import Quaternion  # noqa: PLC0415 -- only this helper needs it

    for pb in scratch_arm.pose.bones:
        base_q, base_loc, base_sc = base[pb.name]
        delta = deltas.get(pb.name)
        if delta is None:
            pb.rotation_quaternion = base_q
        else:
            axis_idx, deg = delta
            pb.rotation_quaternion = base_q @ Quaternion(_FIRE_AXIS_VEC[axis_idx], math.radians(deg))
        pb.location = base_loc
        pb.scale = base_sc
    bpy.context.view_layer.update()


def _aim_deltas(magnitude_deg):
    """`_FIRE_AIM_BONES` at one scalar magnitude, as `_apply_pose` deltas."""
    return {name: (axis_idx, share * magnitude_deg) for name, axis_idx, share in _FIRE_AIM_BONES}


def fire_aim_hand_separation_limit_m(scratch_arm):
    """How far apart `solve_fire_aim` may leave the two hands: the weapon-side
    arm's own full reach, upper arm plus forearm.

    Summed SEGMENT by segment (shoulder joint -> elbow joint -> hand joint),
    not taken as the straight-line `RightArm`-to-`RightHand` distance, and
    that distinction is the point of the function rather than a detail. The
    straight line is the arm's CHORD, which grows as the elbow straightens --
    on this rig it reads 0.396 m at rest and 0.411 m in the solved aim -- so a
    cap built on it LOOSENS in exactly the direction the failure it guards
    against pushes, since an over-solved arm is a straighter one. The two
    segment lengths are fixed by the skeleton (each joint's head sits at a
    fixed offset in its parent's frame), so this is pose-invariant and can be
    called from any pose.

    NOT `data.bones[...].length`, which would be the obvious way to get a
    rest-pose number and is useless on this asset: its auto-rigged bone TAILS
    do not sit at the child joint, and summing the two reads 46.9 m on a
    1.67 m figure. `_CROUCH_BENDS`' own docstring already records the same
    trap from the other side (`LeftUpLeg.tail` swinging through several metres
    for a 30-degree test) -- caught the same way both times, by comparing the
    number against the figure's own height before trusting it.

    Derived from the figure rather than picked, so a differently-proportioned
    re-supplied character scales with it instead of inheriting a number fitted
    to this one. See `solve_fire_aim`'s own docstring for why the cap is on
    the hands rather than on the solved angle."""
    return (
        _joint_distance_m(scratch_arm, "RightArm", "RightForeArm")
        + _joint_distance_m(scratch_arm, "RightForeArm", "RightHand")
    )


def _joint_distance_m(scratch_arm, a, b):
    """World-space distance between two pose bones' own heads, in metres.
    `matrix_world` carries this rig's 0.01 import scale, so going through it
    is what makes the result metres rather than raw units -- the same reason
    `_hips_world_z_travel` composes through it."""
    world = scratch_arm.matrix_world
    return (
        (world @ scratch_arm.pose.bones[a].matrix.translation)
        - (world @ scratch_arm.pose.bones[b].matrix.translation)
    ).length


def solve_fire_aim(scratch_arm, base):
    """Solve `_FIRE_AIM_BONES`' single magnitude so the WEAPON bearing lands
    on the facing axis, and return it.

    Measure, compute, apply, RE-MEASURE -- the aim is never authored by eye.
    A secant solve on the measured `_weapon_bearing_deg`, because a local-axis
    rotation does not compose linearly into a ground-plane bearing (only a
    rotation about the vertical does, and none of these bones' local axes is
    vertical), so a single division by a gain would land close and not on.

    Deliberately NOT a hand-entered angle. A re-supplied `Gun_Hold_Left_Turn`
    with a different carry angle re-solves to a different magnitude on the
    next build, which is the same reason `find_hold_window` computes its
    window instead of remembering one.

    ## Two guards, and they check different things

    `_FIRE_AIM_RESIDUAL_DEG` checks CONVERGENCE. It is NOT, as an earlier
    version of this docstring claimed, a check that "the chain can reach the
    axis" -- the chain moves the weapon about 2.4 deg of bearing per degree of
    magnitude and has no bound of its own, so it can reach any bearing at all
    and that residual is effectively unreachable. It fires only if the secant
    iteration itself fails (a degenerate gain, a source whose weapon bearing
    does not respond to these bones).

    `fire_aim_hand_separation_limit_m` is the guard that can actually bite,
    and the reason a solve like this needs one: **an uncapped solve always
    hits its target**. A re-supplied source with a much larger carry offset
    would solve to a much larger magnitude and ship an implausibly posed arm
    with every gate green, because the weapon bearing would then be correct
    BY CONSTRUCTION and `pnpm validate:meshes` photographs `idle` only -- so
    nothing downstream ever looks at the firing pose. The cap is on the
    physical consequence rather than the angle, and derived from the figure
    rather than picked: the hands may not go further apart than the
    weapon-side arm is long, because two hands further apart than one arm's
    reach are not holding one rifle.

    It is checked along the WHOLE path from 0 to the solved magnitude rather
    than at the endpoint, because separation is not monotonic in magnitude and
    an endpoint test is therefore not a bound at all -- falsified, not
    reasoned: a source needing 90 deg more correction than this one solves to
    158.84 deg, wrapping each of three joints most of the way round, and its
    endpoint separation comes back INSIDE the cap at 0.368 m because the hand
    has swung past the far side. See that function, and the note beside
    `_FIRE_AIM_RESIDUAL_DEG`, for the measured numbers and for how much
    headroom this source has."""
    target = _face_bearing_deg(scratch_arm)  # the axis the tracer flies down

    def residual(magnitude_deg):
        _apply_pose(scratch_arm, base, _aim_deltas(magnitude_deg))
        return _wrap_deg(_weapon_bearing_deg(scratch_arm) - target)

    x0, r0 = 0.0, residual(0.0)
    base_weapon = _wrap_deg(r0 + target)
    x1, r1 = 10.0, residual(10.0)
    for _ in range(_FIRE_AIM_MAX_ITERS):
        if abs(r1) <= _FIRE_AIM_RESIDUAL_DEG * 0.1 or abs(r1 - r0) < 1e-9:
            break
        x0, r0, x1 = x1, r1, x1 - r1 * (x1 - x0) / (r1 - r0)
        r1 = residual(x1)
    if abs(r1) > _FIRE_AIM_RESIDUAL_DEG:
        raise RuntimeError(
            f"fire aim: the solve did not converge -- magnitude {x1:.3f} deg still "
            f"leaves the weapon {r1:+.2f} deg off the facing axis "
            f"(limit +-{_FIRE_AIM_RESIDUAL_DEG:.1f}). This source's weapon bearing "
            f"does not respond to _FIRE_AIM_BONES the way the table's gains assume."
        )

    # The cap. Swept along the WHOLE path from 0 to the solved magnitude, not
    # tested at the endpoint alone, because hand separation is NOT monotonic
    # in magnitude and an endpoint test is therefore not a bound. Falsified:
    # a source needing +90 deg more correction than this one solves to 158.84
    # deg -- each of three joints wrapped most of the way round -- and its
    # ENDPOINT separation comes back down to 0.368 m, inside the 0.469 m
    # reach, because the hand has swung past the far side. Sweeping catches it
    # where it crosses, at about 35 deg. The criterion is the same one either
    # way: the arm has to reach the aim along a path a body could take.
    reach = fire_aim_hand_separation_limit_m(scratch_arm)
    _apply_pose(scratch_arm, base, {})
    rest_separation = _joint_distance_m(scratch_arm, "LeftHand", "RightHand")
    steps = max(2, int(abs(x1)))  # at least one sample per degree
    worst, worst_at = rest_separation, 0.0
    for i in range(steps + 1):
        magnitude = x1 * i / steps
        _apply_pose(scratch_arm, base, _aim_deltas(magnitude))
        separation = _joint_distance_m(scratch_arm, "LeftHand", "RightHand")
        if separation > worst:
            worst, worst_at = separation, magnitude
        if separation > reach:
            _apply_pose(scratch_arm, base, {})
            raise RuntimeError(
                f"fire aim: reaching the solved magnitude {x1:.2f} deg takes the hands "
                f"{separation:.3f} m apart at {magnitude:.2f} deg, past this figure's own "
                f"arm reach of {reach:.3f} m -- two hands further apart than one arm is "
                f"long are not holding one rifle. The weapon bearing lands on the axis "
                f"({r1:+.2f} deg residual) and the pose is still wrong, which is exactly "
                f"what an uncapped solve buys. Re-check this source's carry offset "
                f"({base_weapon:+.2f} deg) before widening anything."
            )
    _apply_pose(scratch_arm, base, {})
    print(
        f"fire aim: the carry holds the weapon at {base_weapon:+.2f} deg against a face at "
        f"{target:+.2f}; solved magnitude {x1:.2f} deg over {len(_FIRE_AIM_BONES)} bones "
        f"({', '.join(f'{n} {s * x1:+.1f}' for n, _a, s in _FIRE_AIM_BONES)}), "
        f"re-measured residual {r1:+.2f} deg; hands {rest_separation:.3f} -> "
        f"{worst:.3f} m worst (at {worst_at:.2f} deg) against an arm reach of {reach:.3f} m"
    )
    return x1


def build_fire_src(scratch_arm, idle_action, base_frame):
    """Synthesizes a `fire` source action -- none of the six supplied Meshy
    clips is a firing animation, so this is authored, not retargeted.

    Base pose is frame `base_frame` of `idle_action`, which since 2026-09-15
    is `build_idle_src`'s trimmed, yaw-corrected HOLD rather than the whole
    `Gun_Hold_Left_Turn`. It used to be `idle_action.frame_range[1]` -- the
    LAST frame -- and that one line is why a KDF rifleman fired at -156
    degrees: the last frame of a clip that turns 180 degrees is the far end
    of the turn. `main()` passes the middle of the bound hold window, which
    is "inside that window" in the strongest available sense: as far as this
    clip can get from both the raw opening frame and the turn.

    TWO authored layers sit on top of that base, in order.

    First a static AIM adjustment (`_FIRE_AIM_BONES`, magnitude solved by
    `solve_fire_aim`), because the supplied hold is a CARRY -- rifle across
    the body at low ready -- and this is the one clip the game draws a
    straight line out of. `build_idle_src`'s root yaw cannot reach it: a root
    rotation moves the whole figure rigidly, so it leaves the angle between
    the face and the weapon exactly as it found it. The weapon follows the
    ARMS, so the arms are what has to move, and `_FIRE_AIM_BONES` is the arm
    half of the chain `_FIRE_RECOIL_BONES` already poses. `idle` and `down`
    deliberately do NOT get this and keep the carry -- see `build_idle_src`.

    Then the short, sharp recoil-and-settle cycle (`_FIRE_CYCLE`) on the four
    `_FIRE_RECOIL_BONES`: the weapon-side forearm/upper arm/shoulder and the
    upper spine. The recoil composes ON TOP of the aim, not instead of it, so
    the kick acts in the aimed frame rather than the carried one. Every OTHER
    bone -- Hips included -- is keyed at the SAME base-pose value on every
    frame of this clip, never touched. That is deliberate, not an oversight:
    "stay up and shoot" taken literally means nothing about this clip should
    move the body's root at all, so this clip's own measured vertical Hips
    travel is exactly zero -- against the previous `fire` source
    (`Side_Shot.glb`, a HIT reaction, 13.37, looped continuously) that
    produced the reported up-down bob. Zero is at-or-below whatever `idle`
    measures by construction; no fixed baseline is quoted here because
    trimming `idle` to its hold moved that number (it was 7.33 when `idle`
    was the whole 182-degree turn, and is a small fraction of that now).

    Composition is `base_quat @ Quaternion(aim) @ Quaternion(recoil)` --
    POST-multiply throughout, in each bone's own local (rest-relative) space,
    matching this file's own "author with pb.keyframe_insert" idiom elsewhere
    (`build_wreck_src`, `write_combined_clip`) rather than a world-space
    rotation, which would need decomposing each bone's current armature-space
    orientation out of the pose chain first. Both tables' own docstrings
    record how the axis per bone was chosen from measurement, not guessed.

    Mirrors `sample_clip`'s explicit `action_slot` reassignment (`action =
    X` alone can leave the PREVIOUS action's stale slot bound -- see that
    function's own docstring for the confirmed failure mode) rather than
    `build_wreck_src`'s bare `.action = X`, since this function -- like
    `sample_clip` -- reads pose values back via `frame_set` before writing
    anything, so a stale slot here would read the wrong pose silently."""
    scratch_arm.animation_data.action = idle_action
    scratch_arm.animation_data.action_slot = idle_action.slots[0] if idle_action.slots else None
    bpy.context.scene.frame_set(int(base_frame), subframe=base_frame - int(base_frame))
    bpy.context.view_layer.update()

    from mathutils import Quaternion  # noqa: PLC0415 -- only this function needs it

    base = {
        pb.name: (
            Quaternion(pb.rotation_quaternion),
            tuple(pb.location),
            tuple(pb.scale),
        )
        for pb in scratch_arm.pose.bones
    }

    # Solve the aim against the SAME base snapshot and the same composition
    # the keyframes below use, then fold it into the base the recoil is
    # authored on. `solve_fire_aim` leaves the rig back on the unaimed base,
    # so nothing here depends on the pose it happened to end on.
    aim_magnitude = solve_fire_aim(scratch_arm, base)
    aim = {
        name: Quaternion(_FIRE_AXIS_VEC[axis_idx], math.radians(share * aim_magnitude))
        for name, axis_idx, share in _FIRE_AIM_BONES
    }

    fire = bpy.data.actions.new("fire_src")
    fire.use_fake_user = True
    scratch_arm.animation_data.action = fire
    scratch_arm.animation_data.action_slot = None

    for frame, fraction in _FIRE_CYCLE:
        for pb in scratch_arm.pose.bones:
            base_q, base_loc, base_sc = base[pb.name]
            aimed_q = base_q @ aim[pb.name] if pb.name in aim else base_q
            if pb.name in _FIRE_RECOIL_BONES:
                axis_idx, peak_deg = _FIRE_RECOIL_BONES[pb.name]
                delta = Quaternion(_FIRE_AXIS_VEC[axis_idx], math.radians(peak_deg * fraction))
                pb.rotation_quaternion = aimed_q @ delta
            else:
                pb.rotation_quaternion = aimed_q
            pb.location = base_loc
            pb.scale = base_sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            pb.keyframe_insert(data_path="location", frame=frame)
            pb.keyframe_insert(data_path="scale", frame=frame)
    return fire


#: Crouch bends for `down` -- (bone, axis 0=X/2=Z in POSE space -- `Y` is
#: never a candidate, since Y is always a bone's OWN length axis in
#: Blender's pose space, and a "bend" is never a twist along it -- sign,
#: peak degrees). Measured the same way `_FIRE_RECOIL_BONES` were: a
#: standalone FK probe rotated each candidate bone +-30deg about its own
#: local X and Z against this exact rig's own idle-last-frame base pose and
#: read back the resulting WORLD-space displacement of the relevant CHILD
#: bone's own HEAD (`LeftLeg.head` for `LeftUpLeg`, `LeftFoot.head` for
#: `LeftLeg`, `Spine.head` for `Spine02`, `Head.tail` for `neck`) -- not
#: each bone's OWN tail, which for this asset's auto-rigged skeleton sits
#: absurdly far from the joint for several bones (`LeftUpLeg.tail` swings
#: through several METRES for a 30deg hip test, on a figure 1.67m tall --
#: caught by comparing the raw number against the figure's own height
#: before trusting it, not assumed away). Left and Right do NOT share a
#: mirrored axis/sign convention here -- each was measured independently
#: (`.superpowers/` probe transcript, not reproduced in full here), and
#: this pass happened to land on matching signs for the hips anyway, which
#: is a property of this measurement, not an assumption it was built on.
#:
#: The combination below -- not each bend in isolation -- is what was
#: rendered and inspected (three angles: back, side, front-quarter) before
#: being accepted: legs fold without self-intersecting, and the figure's
#: own silhouette drops well below `idle`'s standing height. See
#: `build_down_src`'s own docstring for why this crouch/kneel shape was
#: chosen over attempting a literal prone (CLAUDE.md already records a
#: prior attempt at posing THIS rig family flat folding into a
#: self-intersecting heap).
_CROUCH_BENDS = (
    ("LeftUpLeg", 0, +1, 50.0),
    ("RightUpLeg", 0, +1, 50.0),
    ("LeftLeg", 0, +1, 70.0),
    ("RightLeg", 0, +1, 70.0),
    ("Spine02", 0, -1, 15.0),
    ("Spine01", 0, -1, 10.0),
    ("neck", 0, +1, 25.0),
)

#: Metres the Hips bone drops (world -Z), on top of `_CROUCH_BENDS`' own leg
#: fold -- converted to Hips' own LOCAL space in `build_down_src` (Hips'
#: rest orientation is not axis-aligned with world Z, so this cannot be a
#: bare component assignment; see that function's own `local_hips_drop`
#: line). Chosen, not measured: `_CROUCH_BENDS` alone already drops Hips
#: some distance as a side effect of the leg fold, and this adds a further
#: deliberate sink on top so the crouch reads as WEIGHT DOWN rather than
#: merely bent knees. The combined result (Hips world z 0.674 against
#: `idle`'s own 0.824 -- a real ~0.15m drop) is what was actually rendered
#: and accepted, not this constant read in isolation.
_CROUCH_HIPS_DROP_M = 0.15


def build_down_src(scratch_arm, idle_action, base_frame):
    """Synthesizes a `down` source action: a LOW, HELD crouch -- gone to
    ground, not a fall.

    `resolveClip` (`packages/render/src/clip.ts`) returns `down` for
    `pinned` (suppression, GDD 5.5) as much as for death, and
    `applyMeshClip` LOOPS whichever clip is currently showing unless told
    `once: true` (`mesh-death.ts` is the only caller that does). `down`
    USED to be the imported `Shot_and_Blown_Back` clip retargeted in full --
    a multi-frame violent fall -- so a suppressed soldier played it on
    loop: shot and blown back, again and again, for as long as he stayed
    pinned. That is the project lead's own "animation of getting hit runs
    more than once", and the flicker between pinned and firing states is
    the "up and down in a weird way".

    None of the six supplied Meshy clips is a "gone to ground" pose, so
    this is authored -- the same category of move as `build_fire_src` --
    but NOT by blending `idle` toward `Shot_and_Blown_Back`'s own ending
    pose, which was tried FIRST and rejected: a per-bone SLERP blend at
    three fractions (0.15 / 0.2 / 0.4), rendered and inspected at each, read
    as a snapshot of the ACTUAL FALL caught mid-flight every time -- weight
    pitching backward, one leg kicking out, the arm flung up rather than
    held -- never as a controlled crouch, at any fraction tried. A violent
    fall's own rotational path does not pass through anything resembling
    "deliberately getting low"; blending toward it more gently does not fix
    that, it only reduces how far along the same wrong path the pose sits.

    `_CROUCH_BENDS` is authored directly instead: hip and knee flexion on
    BOTH legs (a kneeling-height squat, not a one-legged kneel -- simpler to
    author symmetrically and lower risk of the two legs colliding with each
    other), a modest forward spine lean, a head-down tilt ("heads down" per
    `resolveClip`'s own comment), and a Hips location drop
    (`_CROUCH_HIPS_DROP_M`). Composition is `base_quat @ Quaternion(axis,
    angle)` -- POST-multiply, in the bone's own local (rest-relative) space,
    the same convention `build_fire_src` uses and for the same reason
    (matches this file's own "author with pb.keyframe_insert" idiom
    throughout, no world-space decomposition needed).

    Rendered and inspected from three angles (back, side, front-quarter)
    before being accepted: legs fold without visibly self-intersecting, the
    profile reads as a genuine low stance, and the figure's own silhouette
    drops well below `idle`'s standing height (Hips world z 0.674 vs
    `idle`'s own 0.824 -- a real ~0.15m drop, not merely a claimed one).
    Deliberately NOT the "pose the standing rig into prone" CLAUDE.md
    already records failing once for this rig family ("folds into a
    self-intersecting heap") -- this is a moderate crouch/kneel, well short
    of prone, and every angle here was chosen small enough to render
    cleanly, not maximised for realism.

    Base pose is frame `base_frame` of `idle_action`, matching
    `build_fire_src`'s identical choice for the identical reason: the settled
    stance every other synthesized clip already starts from. It used to be
    `idle_action.frame_range[1]`, the LAST frame, which is why a suppressed
    rifleman went to ground at -163 degrees -- see `build_fire_src`'s own
    paragraph on the same line, and `build_idle_src` for the trim and yaw
    this frame now comes from. Keyed as a STATIC two-frame
    hold (`_VIS_FRAMES`-style, `build_wreck_src`'s own convention) -- nothing
    in this clip's own keyframes has any per-frame motion to record, so its
    vertical Hips travel is exactly 0 by construction, the same way `wreck`
    already measures 0 -- matching the semantics `CLIP_SEMANTICS['down']`
    states and `check_clip_semantics` enforces."""
    from mathutils import Quaternion, Vector  # noqa: PLC0415 -- only this function needs them

    scratch_arm.animation_data.action = idle_action
    scratch_arm.animation_data.action_slot = idle_action.slots[0] if idle_action.slots else None
    bpy.context.scene.frame_set(int(base_frame), subframe=base_frame - int(base_frame))
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

    # Hips' rest orientation is not axis-aligned with world Z, so "drop by
    # `_CROUCH_HIPS_DROP_M` in world -Z" needs converting into Hips' own
    # LOCAL space before it can be added to `pb.location` (which `sample_clip`/
    # `write_combined_clip` elsewhere in this file always treat as bone-local,
    # never world). `arm_scale` divides it back out: `pb.location` and the
    # bone's own rest data share the RAW, pre-0.01-armature-scale units
    # (confirmed against the same calibration `check_clip_semantics`'s own
    # `_hips_world_z_travel` uses), so a WORLD-metres offset must be
    # unscaled before it is expressed in that same raw local space.
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
    """One full-copy duplicate of the scratch rig -- now the armature PLUS
    every role mesh `separate_by_role` produced (a dict `{role: mesh_obj}`),
    duplicated together in ONE `bpy.ops.object.duplicate()` call so each
    mesh's Armature modifier retargets to the freshly-duplicated armature
    automatically, generalising the original single-mesh idiom to N meshes.
    Bones+vertex-groups prefixed, translated to its rest position. Mirrors
    `tools/units/rig.py`'s "no weight painting, rigid bind" spirit -- this is
    a rename, not a reweight; every vertex keeps whatever single group it
    was already rigidly bound to.

    Which duplicate is which role is recovered via the `rl_role` object
    custom property `separate_by_role` set (itself duplicated along with the
    object) -- NOT object name or `bpy.context.selected_objects` order,
    neither of which a multi-object `duplicate()` guarantees."""
    bpy.context.preferences.edit.use_duplicate_mesh = True
    bpy.context.preferences.edit.use_duplicate_armature = True
    # This factory profile defaults `use_duplicate_action` ON, which
    # duplicates whatever action `scratch_arm` happens to be pointing at
    # (by the time this runs, `wreck_src` -- see `build_wreck_src`) once per
    # figure, leaving three stray `wreck_src.001/.002/.003` actions that
    # later got swept into an export via `__get_blender_actions`'s own
    # scan of `bpy.data.actions` -- verified once (a first run's "idle" temp
    # file carried 9 animations instead of 1) and fixed by forcing this off
    # explicitly rather than leaving it to whatever the factory default is.
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
    """Replays `src_action` on the scratch (original-named) rig frame by
    frame and returns the evaluated pose as plain Python data -- one dict of
    `{bone_name: (quat, loc, scale)}` per sampled frame. Deliberately NOT a
    Blender action: `write_combined_clip` below needs `src_action` gone
    (deleted from `bpy.data.actions`) before its own clip exports, because
    the glTF exporter's "ACTIONS" mode exports every slotted action
    COMPATIBLE with the object being exported, not merely whichever one is
    currently assigned (`__get_blender_actions`, `io_scene_gltf2/blender/
    exp/animation/action.py`) -- confirmed once the hard way, a temp export
    scoped to `merged_arm` alone still carried six animations, one per
    surviving `*_src` action plus the one actually wanted. Caching the pose
    as data lets every `*_src` action be deleted before any export runs.

    Reassigns `action_slot` explicitly to `src_action`'s OWN slot, not to
    `None`. `.action` alone is not enough to rebind evaluation once
    `scratch_arm` has already had a DIFFERENT action assigned (true from the
    second `sample_clip` call onward in a real run -- `build_wreck_src`
    alone leaves it on `wreck_src`): the stale `.action_slot` from
    whichever action was assigned before stays bound, and every bone read
    back through `frame_set` here comes back frozen at that stale pose,
    `src_action`'s own frame range notwithstanding. `None` was the first
    fix tried and is WRONG for this function specifically, even though it
    is exactly right for `write_combined_clip` below: that function's very
    next line is a `keyframe_insert`, which auto-creates and binds a fresh
    slot the moment it runs. This function never writes a keyframe -- it
    only reads pose-bone properties -- so clearing the slot to `None` and
    never re-establishing it left NOTHING bound to evaluate against for the
    entire sampling loop, and every read came back as whatever pose was
    already sitting in memory before this call, for every clip, at every
    frame. Confirmed the hard way (again): a five-clip debug run with the
    `None` version read back the SAME quaternion for `idle`, `move`,
    `fire`, `down` AND `wreck`, at every sampled frame of each -- not just
    "stale between clips" but frozen WITHIN a single clip too. Each
    imported action already carries exactly one slot from its own glTF
    import (`src_action.slots[0]`); assigning that directly is the fix."""
    scratch_arm.animation_data.action = src_action
    scratch_arm.animation_data.action_slot = src_action.slots[0] if src_action.slots else None
    bpy.context.view_layer.update()
    bone_names = [pb.name for pb in scratch_arm.pose.bones]

    frames = []
    # `_clip_frame_positions` is THE definition of which frames a clip is
    # sampled at -- see its own docstring for why this must not be re-derived
    # here, in `measure_clip_bearings` or in `build_idle_src`.
    for src_frame in _clip_frame_positions(src_action):
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


#: Per-figure gait-phase offset, as a FRACTION of a clip's own frame count,
#: keyed by a figure's 0-based position in `FIGURE_SPREAD` (`f0`/`f1`/`f2`).
#: Matches `tools/units/rig.py`'s own `GAIT_PHASE_FRACTIONS` exactly, so both
#: asset families desync a squad the same way: `f0` unshifted, `f1` a third
#: of the cycle ahead, `f2` two thirds -- rather than each of the three
#: figures replaying the SAME mocap frame at the SAME output frame, which is
#: what `write_combined_clip` used to do unconditionally, and which is why
#: `f0_LeftUpLeg`/`f1_LeftUpLeg`/`f2_LeftUpLeg` on the shipped
#: `meshy_soldier.glb` all reported the same 26 frames AND the same first
#: quaternion -- three figures playing one mocap clip in perfect unison.
GAIT_PHASE_FRACTIONS = (0.0, 1.0 / 3.0, 2.0 / 3.0)


def write_combined_clip(merged_arm, figures, clip_name, frames, cyclic=False):
    """Keys `frames` (from `sample_clip`) onto every figure's `f{n}_`-
    prefixed bones on `merged_arm`, under one new action named `clip_name`
    -- exactly the canonical name the contract and `mesh-anim.ts`'s
    `isMeshClipName` both require.

    `cyclic`, True only for `idle`/`move` (the two clips that actually loop
    at runtime -- see `main()`'s own call site): each figure reads `frames`
    from a different, WRAPPED starting index -- `GAIT_PHASE_FRACTIONS[i]` of
    the way around the clip -- instead of every figure reading the exact
    same sampled pose at the same output frame. `frames` is already a full,
    loop-safe cycle (it is a direct replay of a supplied mocap clip authored
    to loop), so a per-figure ROTATION of which sample lands on which output
    frame changes what value each figure's keyframes carry, never how many
    frames exist or the clip's own loop point -- it costs nothing at
    runtime, still one mixer and one clip. `fire`'s synthesized recoil and
    `down`/`wreck`'s held poses are not cycles -- there is no "a third of
    the way around" for a single impulse or a static hold to mean -- so
    every figure keeps reading frame `step` unshifted for those, exactly as
    before.
    """
    combined = bpy.data.actions.new(clip_name)
    combined.use_fake_user = True
    if merged_arm.animation_data is None:
        merged_arm.animation_data_create()
    merged_arm.animation_data.action = combined
    # Blender 4.4+'s "slotted actions": `animation_data.action_slot` is a
    # SEPARATE pointer from `animation_data.action`, and reassigning `.action`
    # alone does NOT clear it -- a slot left over from a PREVIOUSLY built clip
    # stays bound otherwise. Explicitly clearing it forces Blender to bind a
    # fresh slot to `combined` on the very next `keyframe_insert` below.
    merged_arm.animation_data.action_slot = None

    n = len(frames)
    for step in range(n):
        for i, (prefix, _dx, _dy) in enumerate(figures):
            if cyclic:
                shift = round(n * GAIT_PHASE_FRACTIONS[i % len(GAIT_PHASE_FRACTIONS)])
                sampled = frames[(step + shift) % n]
            else:
                sampled = frames[step]
            for name, (q, loc, sc) in sampled.items():
                pb = merged_arm.pose.bones[f"{prefix}_{name}"]
                pb.rotation_quaternion = q
                pb.location = loc
                pb.scale = sc
                pb.keyframe_insert(data_path="rotation_quaternion", frame=step)
                pb.keyframe_insert(data_path="location", frame=step)
                pb.keyframe_insert(data_path="scale", frame=step)

    return combined


def _hips_world_z_travel(frames, hips_rest, arm_world):
    """max(z) - min(z) of the Hips bone's WORLD z position across `frames`
    (a `sample_clip`-style list of per-bone `{name: (quat, loc, scale)}`
    dicts, sampled off the SCRATCH rig before duplication), x100 -- the
    EXACT metric `.superpowers/meshy-fire-clip-report.md`'s own comparison
    table uses (`arm.matrix_world @ pose_bone.matrix.translation`, evaluated
    live in Blender there; this is the identical formula computed directly
    from already-sampled data, since re-entering pose context per clip per
    frame here would mean re-sampling work `sample_clip` already did once).

    Calibrated against that report's own two independently-known numbers
    BEFORE being trusted as a gate, not assumed correct by construction: run
    against real `idle_src`/`move_src` sampled frames, this exact function
    reproduces 7.204139... and 6.699657..., matching the report's own
    7.204/6.699 to six decimal places (a standalone calibration script, not
    reproduced here). An earlier, WRONG version of this idea read
    `pb.location.z` directly (Hips' own raw pose-space translation, no rest
    composition) and came out at 50.05 for idle against a 7.2 target -- 7x
    off -- because a POSE bone's `location` is expressed relative to the
    bone's own REST-relative axes, not world Z; only composing it back
    through the bone's actual rest matrix (`hips_rest @ Matrix.LocRotScale(
    loc, quat, scale)`, then through the armature's own world matrix)
    reproduces the report's real number. Hips is a ROOT bone (no parent), so
    its own sampled (quat, loc, scale) alone determines its evaluated pose
    matrix -- no other bone's sampled data is needed here."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415 -- only this function needs them

    zs = []
    for f in frames:
        q, loc, sc = f["Hips"]
        basis = Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))
        world = arm_world @ (hips_rest @ basis)
        zs.append(world.translation.z)
    return (max(zs) - min(zs)) * 100.0


def check_clip_semantics(frames_by_clip, hips_rest, arm_world, bearings_by_clip):
    """Enforces `CLIP_SEMANTICS`'s numeric halves at BUILD time -- see that
    table's own comment for the three prior instances (`Side_Shot` -> `fire`,
    `Shot_and_Blown_Back` -> `down`, `Gun_Hold_Left_Turn` -> `idle` and via
    it `fire` and `down` again) this exists to make a FOURTH of impossible to
    ship silently. Raises loudly, naming the offending clip, the measured
    number and the ceiling, rather than passing a build whose motion
    contradicts its own clip name. Called from `main()` right after
    `frames_by_clip` is complete, before duplication/export -- so a violation
    is caught before any of the expensive downstream work (webbing graft,
    six-way export, GLB merge) runs at all, not after.

    `bearings_by_clip` is `{clip: (face_list, weapon_list)}` from
    `measure_clip_bearings`. THREE independent checks, and each exists
    because the one before it was blind to a real defect that shipped:

      * Hips travel -- "does this clip move the body when it should not". It
        could not see a figure standing perfectly still while facing 156 deg
        away from what it is shooting: that has a Hips travel of zero.
      * FACE bearing, mean and spread -- the mean catches a clip bound facing
        the wrong way, the spread catches a clip that TURNS (which is what
        `Gun_Hold_Left_Turn` did, and which no mean can express).
      * WEAPON bearing, mean and spread -- because the face check CANNOT FAIL
        on `idle`, `fire` or `down`: `build_idle_src` yaws the hold by the
        circular mean of exactly the face bearings tested here, and the other
        two inherit that base pose. See `CLIP_SEMANTICS`' own comment. The
        weapon axis is invariant under that yaw, so it is the half that can
        actually go red -- and it is what holds `solve_fire_aim`'s aim in
        place once it is right.

    Exemptions are `None` in the table, printed by name on the passing path
    the way `pnpm validate:meshes` prints its own, never silent."""
    travel = {name: _hips_world_z_travel(frames_by_clip[name], hips_rest, arm_world) for name in CLIP_ORDER}
    idle_travel = travel["idle"]
    print("Hips world-z travel x100, by clip:", {k: round(v, 3) for k, v in travel.items()})

    stats = {}
    for name in CLIP_ORDER:
        face, weapon = bearings_by_clip[name]
        stats[name] = {"heading": _circular_mean_deg(face), "weapon": _circular_mean_deg(weapon)}
    print("bearings deg (exported convention, +X = 0, + is the figure's left), by clip:")
    for name in CLIP_ORDER:
        line = []
        for kind in ("heading", "weapon"):
            mean, lo, hi = stats[name][kind]
            label = "face" if kind == "heading" else "weapon"
            line.append(f"{label} {mean:+7.2f} [{lo:+7.2f},{hi:+7.2f}] spread {hi - lo:6.2f}")
        gap = _wrap_deg(stats[name]["weapon"][0] - stats[name]["heading"][0])
        print(f"  {name:10s} {'   '.join(line)}   face-to-weapon gap {gap:+7.2f}")

    for name in CLIP_ORDER:
        ceiling = CLIP_SEMANTICS[name]["ceiling"](idle_travel)
        if ceiling is not None and travel[name] > ceiling:
            raise RuntimeError(
                f"{name}: Hips travel {travel[name]:.3f} exceeds {ceiling:.3f} -- "
                f"CLIP_SEMANTICS['{name}']['means'] = {CLIP_SEMANTICS[name]['means']!r}"
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
    """`tools/units/rig.py`'s own `export_glb` settings, plus
    `export_optimize_animation_size=False`, and called ONCE PER CLIP against
    an armature carrying exactly one action at a time -- see `main()`'s own
    comment for why, and the paragraph below for what "why" turned out to be.

    This function used to be called once, after building every combined
    actions on the merged armature (`rig.py`'s own shape, which this script
    first copied verbatim). That produced a file where EVERY clip's EVERY
    channel collapsed to two identical keyframes -- confirmed by parsing the
    exported GLB's own JSON+binary chunks directly, not by trusting a
    Blender reimport (which round-trips through the same importer/exporter
    code and would hide the defect). `export_optimize_animation_size=False`
    (this function's one addition over `rig.py`'s copy) was the first fix
    tried, and it is real -- Blender's exporter runs a per-channel "is this
    constant" check when the option is on (`gather_bone_sampled_keyframes`,
    `io_scene_gltf2/blender/exp/animation/sampled/armature/keyframes.py`)
    and collapses anything it believes constant to two keys -- but turning
    it off did not fully fix multi-action export: with two actions on one
    armature, disabling it left exactly ONE of the two genuinely varying
    (25 unique quaternions) while the other still came out constant (1
    unique value repeated for its whole length); with five, it made no
    difference at all -- every clip came back constant regardless. The
    pattern implicates Blender's own multi-action baking cache
    (`sampling_cache.py`'s `get_cache_data`, `@datacache`-memoized, keyed in
    part by `animation_data.action_slot` -- the NEW Blender 4.4+ "slotted
    actions" system) rather than anything this script's own keyframe
    authoring gets wrong: a single action, built and exported completely
    alone, always came out with full per-frame fidelity, every time it was
    tried. Root cause not chased into Blender's C internals -- `action.py`'s
    own "workaround Blender bug 107030" comment on the adjacent frame-range
    code path is the closest thing to a citation available -- but the
    empirical fix holds: never let more than one action exist on the
    armature at export time. `main()` now builds and exports each clip to
    its own temporary single-animation file immediately, tearing the action
    back off before the next one starts, and `merge_clip_glbs` below
    recombines the temp files into one in pure Python, after Blender's
    own multi-action path is out of the picture entirely.

    One more consequence of exporting per-clip while the scratch rig is
    still alive (it has to be -- every clip is sampled off it): `rig.py`'s
    own `use_selection=False` exports the WHOLE SCENE regardless of
    selection, which during this loop also contains the scratch armature,
    still holding whichever `*_src` action it last replayed. That produced
    a first temp file with TWO animations, not one. Selecting only `arm_obj`
    and its own children and switching to `use_selection=True` scopes each
    export to the merged rig alone."""
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


# --- pure-Python GLB merge (no bpy) -----------------------------------------
#
# One temporary file per clip, each the SAME rig (mesh, skin, node graph --
# nothing but the active action differs between the export calls that
# produced them) plus exactly one animation. `merge_clip_glbs` keeps the first file's
# mesh/skin/nodes/buffer as the base and re-homes each other file's one
# animation into it: its sampler accessors and their backing bufferViews are
# copied into the base's buffer (4-byte aligned, per the glTF spec) under
# fresh indices, while `channel.target.node` and each channel's `sampler`
# index are left untouched -- the first because node ordering is identical
# across all of them BY CONSTRUCTION and is verified below rather than
# assumed, the second because a channel's `sampler` index is local to its
# OWN animation's samplers list, unaffected by renumbering accessors in the
# shared, global accessors array.


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
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)  # glTF pads JSON with spaces
    bin_bytes = bytes(bin_data)
    bin_bytes += b"\x00" * ((4 - len(bin_bytes) % 4) % 4)  # and BIN with zeros
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
        f.write(bin_bytes)


#: Degrees about glTF/three.js +Y (NOT Blender's Z-up frame -- this applies
#: after export) needed to turn this asset's own exported facing into the
#: contract's local +X. Live-measured, not guessed: with no correction, the
#: `face` mesh's world-space offset from its own entity root -- walking due
#: east, `simFacing=0`/`meshYaw=0` -- reads +89.9 deg (`atan2(z, x)`, i.e.
#: pointing +Z) against the `at_team` control's -0.9 deg (pointing +X,
#: correct). `apply_forward_fix` rotates by `θ` about +Y, which (per
#: `Matrix4.makeRotationY`'s own convention, `mesh-anim.ts`'s
#: `meshYawFromFacing` docstring already works this out) sends a vector
#: currently at angle `φ` to `φ - θ` -- so `θ = +90` takes the measured
#: +89.9 to within a tenth of a degree of the target 0, the same size
#: residual the control itself already carries (bounding-sphere centres of
#: an asymmetric vertex cluster are never perfectly on-axis; the control's
#: own -0.9 is that same noise floor, not a defect).
FORWARD_FIX_DEG = 90.0


def _quat_y(deg):
    """XYZW glTF node-rotation quaternion for `deg` about +Y. glTF's own
    rotation convention needs no axis/sign conversion to match three.js's
    `Quaternion.setFromAxisAngle((0,1,0), radians(deg))` (and therefore
    `Matrix4.makeRotationY`) -- both are the same right-handed, Y-up
    convention by construction; the Z-up/Y-up conversion this pipeline cares
    about happens once, on Blender's own export side, before any of this
    runs."""
    half = math.radians(deg) / 2.0
    return [0.0, math.sin(half), 0.0, math.cos(half)]


def apply_forward_fix(gltf, deg):
    """Wraps every node the CURRENT scene lists at the top level (this
    asset's merged armature, and any top-level sibling) under one new
    synthetic node carrying a rotation of `deg` about +Y, then repoints the
    scene at that new node alone. Only ever called once, on the fully
    merged `base_gltf` (every clip's channels/samplers already in place),
    immediately before it is written: inserting the wrapper AFTER assembly
    means every existing `channel.target.node` and skin `joints` index
    stays valid, since this function only ever APPENDS one new node and
    reassigns `scene.nodes` -- it never renumbers or moves anything that
    already existed.

    This is the real forward-correction, in place of a Blender-side bone
    rotation (`fix_forward`'s own docstring has the full account of why
    that mechanism cannot touch this asset's exported facing at all, at any
    angle): a three.js/glTF scene graph has no "Apply Transform"-style
    compensation, so a parent's rotation always, unconditionally, propagates
    to every descendant -- mesh nodes and joint nodes alike."""
    scene_idx = gltf.get("scene", 0)
    scene = gltf["scenes"][scene_idx]
    old_top_nodes = list(scene["nodes"])
    wrapper = {"name": "forward_fix", "rotation": _quat_y(deg), "children": old_top_nodes}
    wrapper_idx = len(gltf["nodes"])
    gltf["nodes"].append(wrapper)
    scene["nodes"] = [wrapper_idx]


def merge_clip_glbs(clip_paths, out_path, forward_fix_deg=0.0):
    """`clip_paths`: ordered `{clip_name: path}`. Raises loudly (never
    silently drops a clip or mismatches a node) if any file's node graph
    does not match the base file's exactly. `forward_fix_deg`: see
    `apply_forward_fix`'s own docstring -- applied once, to the fully
    merged result, right before it is written."""
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

        # `channel.sampler` indexes THIS animation's own samplers list --
        # unaffected by the global accessors-array renumbering above, since
        # `new_samplers` preserves `anim["samplers"]`'s own order 1:1.
        new_channels = [dict(ch) for ch in anim["channels"]]

        base_gltf["animations"].append(
            {"name": clip_name, "channels": new_channels, "samplers": new_samplers}
        )

    if forward_fix_deg:
        apply_forward_fix(base_gltf, forward_fix_deg)

    base_gltf["buffers"][0]["byteLength"] = len(base_bin)
    _write_glb(base_gltf, base_bin, out_path)


# --- the webbing graft: real kit.py geometry, fit to this figure's own
# measured proportions and skinned to its own rig -- see
# `.superpowers/f-meshy-soldier-webbing-graft-report.md` for the measurements
# and the render-based visual verification this fit was checked against.
#
# `uniform`/`boot`/`face`/`keffiyeh` above all came from the source texture --
# this is the first role built from GEOMETRY THIS SCRIPT AUTHORS, because the
# source mesh has none to recover (see the two predecessor reports: colour
# clustering found no fifth material zone past shading, and connectivity
# found one welded shell with no separable vest/rifle island).

#: Measured directly off THIS figure's own bind-pose mesh (never kit.py's own
#: 1.8 m proportions -- "fit to the measured body" is the whole point of this
#: graft). Both z heights are bone `head_local.z` (Hips, Spine02), scaled by
#: the armature's own 0.01 import scale to metres. The chest width is the
#: lateral (X) span of vertices whose SINGLE DOMINANT vertex group is
#: Spine02 -- real torso surface, not a guess, and not contaminated by the
#: T-pose's outstretched arms the way a plain height-band bounding box was
#: (that first attempt returned an X span of 0.86 m, obviously arms, not
#: torso -- see the report).
_MEASURED_BELT_Z = 0.9272
_MEASURED_CHEST_Z = 1.0471
_MEASURED_CHEST_WIDTH = 0.3607

#: kit.py's own irregular-loadout figure, at its own 1.8 m proportions, for
#: the SAME two reference points -- what a straight, unfit kit.py build
#: would place them at.
_KIT_BELT_Z = 0.52 * kit.FIGURE_H
_KIT_CHEST_Z = 0.62 * kit.FIGURE_H
_KIT_CHEST_WIDTH = 2.0 * kit.R_CHEST

#: Uniform height scale -- this figure is 1.67 m tall, not kit.py's 1.8 m --
#: plus a residual shift so BOTH the belt and the chest land on their
#: measured heights rather than only their ratio-scaled ones. Solved as the
#: average of the two anchors' post-scale residuals (belt +0.058 m, chest
#: +0.011 m -- same sign, both small, so one shared shift is a defensible
#: single-number fit rather than a per-part correction this task has no
#: measurement to justify).
_WEBBING_Z_SCALE = 1.67 / kit.FIGURE_H
_WEBBING_Z_SHIFT = (
    (_MEASURED_BELT_Z - _KIT_BELT_Z * _WEBBING_Z_SCALE)
    + (_MEASURED_CHEST_Z - _KIT_CHEST_Z * _WEBBING_Z_SCALE)
) / 2.0

#: Horizontal (lateral AND depth) scale, from the one measurement least
#: likely to be contaminated by the rifle/arms welded into the same mesh --
#: the chest-width dominant-vertex-group bbox. A separate front-to-back
#: DEPTH measurement came out much larger (0.39 m against kit.py's 0.244 m,
#: a 1.6x ratio) but is NOT corroborated the way width is by a second,
#: independent method, and applying it literally would stretch every pouch
#: and strap 60% deeper than wide. Using the width ratio for both axes keeps
#: every part's own proportions intact; the fit checked out visually (see
#: the report) with this choice.
_WEBBING_XY_SCALE = _MEASURED_CHEST_WIDTH / _KIT_CHEST_WIDTH

#: `elbowpad`/`gauntlet`/`glove` are placed by kit.py relative to the ARM,
#: assuming kit.py's own "arms bent, rifle at the ready" standing pose. This
#: asset's own bind pose is a T-pose (arms straight out to the sides --
#: confirmed by rendering the two together, see the report) -- a completely
#: different arm position kit.py has no parameter to produce. Left in, those
#: parts land nowhere near the real arm at bind time, and the nearest-
#: surface weight transfer below binds them to whatever body surface IS
#: nearest instead (torso, not the arm) -- which then does not track the arm
#: once animated. Excluded rather than forced: the torso/leg items are pose-
#: independent (a T-pose and a standing pose share the same leg/hip layout)
#: and are unaffected, so only the arm-relative parts are dropped.
_WEBBING_ARM_POSE_MISMATCH = ("elbowpad", "gauntlet", "glove")


def _barycentric(p, a, b, c):
    """Barycentric coordinates of `p` in triangle `a, b, c`, assuming `p`
    already lies in (or on) the triangle -- true here since `p` always comes
    from `BVHTree.find_nearest`, which returns the closest point ON the
    triangle, never off its plane."""
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    denom = d00 * d11 - d01 * d01
    if abs(denom) < 1e-12:
        return (1.0, 0.0, 0.0)
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    return (1.0 - v - w, v, w)


def _transfer_webbing_weights(webbing_obj, body_obj, bone_names):
    """Nearest-surface, barycentric-interpolated vertex-group weight
    transfer from `body_obj` to `webbing_obj` -- hand-rolled rather than
    `bpy.ops.object.data_transfer` (the standard, intended tool for exactly
    this). That operator returns `{'FINISHED'}` with no exception and
    transfers NOTHING in this Blender 5.2 headless environment -- confirmed
    on a minimal two-cube case with no armature involved at all (one cube, a
    fully-weighted vertex group; a second cube 0.1 units away; the operator
    finishes and the destination gains zero vertex groups), so this is an
    environment fact rather than a mistake in how it was being invoked here
    (context override via `temp_override` with a real VIEW_3D area/region
    was also tried and made no difference). See the task report.

    A convex (barycentric) combination of three already-normalised weight
    vectors is itself normalised, so every destination vertex's weights sum
    to exactly 1.0 by construction -- the caller still verifies this rather
    than trusting the construction alone."""
    body_obj.data.calc_loop_triangles()
    tris = body_obj.data.loop_triangles
    mw = body_obj.matrix_world
    src_verts_world = [mw @ v.co for v in body_obj.data.vertices]
    bvh = BVHTree.FromPolygons(
        src_verts_world, [tuple(t.vertices) for t in tris], all_triangles=True
    )

    bone_idx = {n: i for i, n in enumerate(bone_names)}
    n_bones = len(bone_names)
    src_weights = np.zeros((len(body_obj.data.vertices), n_bones), dtype=np.float64)
    for v in body_obj.data.vertices:
        for g in v.groups:
            gname = body_obj.vertex_groups[g.group].name
            if gname in bone_idx:
                src_weights[v.index, bone_idx[gname]] = g.weight

    for v in webbing_obj.data.vertices:
        loc, _normal, tri_idx, _dist = bvh.find_nearest(v.co)
        if tri_idx is None:
            raise RuntimeError(f"webbing vertex {v.index}: no nearest triangle found")
        i0, i1, i2 = tris[tri_idx].vertices
        u, w0, w1 = _barycentric(
            loc, src_verts_world[i0], src_verts_world[i1], src_verts_world[i2]
        )
        w = u * src_weights[i0] + w0 * src_weights[i1] + w1 * src_weights[i2]
        for bi, weight in enumerate(w):
            if weight > 1e-5:
                webbing_obj.vertex_groups[bone_names[bi]].add([v.index], float(weight), "REPLACE")

    sums = np.array([sum(g.weight for g in v.groups) for v in webbing_obj.data.vertices])
    if len(sums) == 0 or sums.min() < 0.999 or sums.max() > 1.001:
        raise RuntimeError(
            "webbing weight transfer: sums out of [0.999, 1.001] -- "
            f"min={sums.min() if len(sums) else 'n/a'} max={sums.max() if len(sums) else 'n/a'}"
        )
    print(f"webbing weight transfer: {len(sums)} verts, sums [{sums.min():.6f}, {sums.max():.6f}]")


def build_webbing(scratch_mesh, scratch_arm):
    """Builds kit.py's irregular-loadout webbing (`militia_cell`'s own
    loadout/headgear -- olive gear over tan cloth, the look this graft is
    reaching for), fits it to this figure's own measured proportions, and
    skins it to `scratch_arm` via nearest-surface weight transfer.

    Calls `kit.figure(..., yaw=-90deg, ...)`. kit.py's own `place()` computes
    `(x0 + dx*cos(yaw) - dy*sin(yaw), y0 + dx*sin(yaw) + dy*cos(yaw), z0+dz)`;
    at yaw=-90 that reduces to exactly `(dy, -dx, dz)`, which maps kit.py's
    own +X-forward convention onto THIS mesh's own pre-`fix_forward`
    convention (forward = -Y, per `import_clip`'s own docstring) with no
    further coordinate surgery needed -- so every part comes out already
    positioned in the scratch mesh's own raw*0.01-scale world frame, in
    metres, matching `scratch_mesh.matrix_world`'s own scale exactly (`kit.py`
    already builds at real metres; the 0.01 factor is the ARMATURE's import
    scale, not a unit mismatch to correct for).

    Must be called BEFORE `separate_by_role` peels boot/face/keffiyeh off
    `scratch_mesh` -- the weight-transfer source here is the FULL, still-
    unsplit body.

    Returns one joined mesh object, `rl_role="webbing"`, carrying all 24 of
    `scratch_arm`'s bones as vertex groups (weight sums exactly 1.0),
    parented to `scratch_arm` the same way the imported mesh already is --
    needed so `duplicate_figure`'s per-figure lateral spread (applied via
    `dup_arm.location`) carries this mesh along the same way it carries the
    other four roles.
    """
    before = set(bpy.data.objects.keys())
    kit.figure(
        "webgraft", (0.0, 0.0, 0.0), posture="standing", yaw=math.radians(-90.0),
        stride=0.0, arms=True, leader=False, mirror=False,
        loadout="irregular", headgear="keffiyeh", smoke=None,
    )
    new_objs = [bpy.data.objects[n] for n in (set(bpy.data.objects.keys()) - before)]
    webbing_parts = [
        o for o in new_objs
        if o.get("rl_role") == "webbing"
        and not any(tag in o.name for tag in _WEBBING_ARM_POSE_MISMATCH)
    ]
    if not webbing_parts:
        raise RuntimeError("build_webbing: kit.figure() produced no usable webbing parts")
    webbing_part_names = sorted(o.name for o in webbing_parts)  # join() below invalidates o.name
    for o in new_objs:
        if o not in webbing_parts:
            bpy.data.objects.remove(o, do_unlink=True)

    for o in webbing_parts:
        for v in o.data.vertices:
            x, y, z = v.co
            v.co = (
                x * _WEBBING_XY_SCALE,
                y * _WEBBING_XY_SCALE,
                z * _WEBBING_Z_SCALE + _WEBBING_Z_SHIFT,
            )
        o.data.update()

    bpy.ops.object.select_all(action="DESELECT")
    for o in webbing_parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = webbing_parts[0]
    if len(webbing_parts) > 1:
        bpy.ops.object.join()
    webbing_obj = bpy.context.view_layer.objects.active
    # NOT named "webbing" here -- this is still the SCRATCH object (like the
    # other four roles' scratch objects, which also keep whatever name
    # `mesh.separate`/import gave them). `main()`'s step 10 renames the
    # final, post-duplication merged mesh to "webbing"; naming this one that
    # too pre-empts the name and step 10's rename collides, silently
    # suffixing the REAL exported mesh to "webbing.001" -- caught by parsing
    # the exported GLB directly, not by any in-Blender check, since Blender
    # itself resolves the collision without complaint.
    webbing_obj.name = "webbing_scratch"
    webbing_obj.data.name = "webbing_scratch"
    webbing_obj["rl_role"] = "webbing"
    print(f"webbing graft: {len(webbing_obj.data.vertices)} verts from "
          f"{len(webbing_part_names)} part(s): {webbing_part_names}")

    bone_names = [b.name for b in scratch_arm.data.bones]
    for name in bone_names:
        if name not in webbing_obj.vertex_groups:
            webbing_obj.vertex_groups.new(name=name)
    mod = webbing_obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = scratch_arm

    # Parent to the SAME armature the scratch mesh already follows, so
    # `duplicate_figure`'s per-figure lateral spread (`dup_arm.location =
    # (dx, dy, 0.0)`) carries this mesh the same way it carries the other
    # four roles. `keep_transform=True` is load-bearing: without it
    # `parent_set` leaves no compensating inverse, and every vertex authored
    # above (in real-metre world coordinates) would jump by whatever the
    # armature's own scale-0.01 transform puts it at.
    bpy.ops.object.select_all(action="DESELECT")
    webbing_obj.select_set(True)
    scratch_arm.select_set(True)
    bpy.context.view_layer.objects.active = scratch_arm
    bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

    _transfer_webbing_weights(webbing_obj, scratch_mesh, bone_names)
    return webbing_obj


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- 1. import: base rig from Running.glb, then the other three. No
    # `fire` import (`CLIP_SOURCES` has no "fire" key), and `Side_Shot.glb`
    # and `Walking.glb` are read by nothing: `fire` is synthesized in step
    # 4.6 below and `move` is the run now, per `CLIP_SOURCES`' own comment.
    # `Gun_Hold_Left_Turn.glb` arrives as `turn_src`, not `idle_src`, and
    # `Shot_and_Blown_Back.glb` as `fall_src`, not `down_src` -- neither maps
    # to a clip name whole any more; `idle` is trimmed out of the first
    # (step 4.5) and `wreck` sampled out of the second (step 5).
    #
    # The base rig comes from whichever file `CLIP_SOURCES["move"]` names,
    # and that changing from `Walking` to `Running` changes NOTHING about
    # `classify_vertex_roles`' fixed centroids, which were fit against
    # `Walking`'s own scratch mesh: all seven supplied files carry a
    # byte-identical mesh (POSITION, JOINTS_0, WEIGHTS_0 and TEXCOORD_0
    # hashed and compared, 2026-09-15) and a byte-identical 18.7 MB
    # `texture_0`. Measured, not assumed, because a silent vertex reorder
    # here would silently reassign every role. -----------------------------
    scratch_arm, scratch_mesh, move_src = import_base_clip(
        os.path.join(SRC_DIR, CLIP_SOURCES["move"]), "move_src"
    )
    move_fire_src = import_clip(
        os.path.join(SRC_DIR, CLIP_SOURCES["moveFire"]), "move_fire_src"
    )
    turn_src = import_clip(os.path.join(SRC_DIR, TURN_SOURCE), "turn_src")
    fall_src = import_clip(os.path.join(SRC_DIR, FALL_SOURCE), "fall_src")

    # --- 2. classify every vertex's rl_role from the mesh's OWN base-color
    # texture, BEFORE the material is stripped -- it is the only route to
    # the texture. See `classify_vertex_roles`'s own docstring and the task
    # report for the clustering analysis this reuses. -----------------------
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

    # --- 4. fix forward -- now a documented no-op (see `fix_forward`'s own
    # docstring for why baking a rotation into the ARMATURE object cannot
    # touch this asset's exported facing at all). The real correction is
    # POST-export (`FORWARD_FIX_DEG`/`apply_forward_fix`, applied inside
    # `merge_clip_glbs` at the very end of `main()`, step 14 below). Still
    # called here, in the same place, because `build_fire_src`/
    # `build_down_src`/`sample_clip` all read pose data relative to
    # whatever this leaves as the scratch rig's rest state, and keeping the
    # call site fixed means their own "runs after fix_forward" ordering
    # comments stay accurate regardless of what `_FIX_FORWARD_DEG` is set
    # to. --------------------------------------------------------------
    fix_forward(scratch_arm)
    hips_rest = scratch_arm.data.bones["Hips"].matrix_local.copy()
    arm_world = scratch_arm.matrix_world.copy()

    # --- 4.5. measure where `Gun_Hold_Left_Turn`'s own turn begins, and bind
    # `idle` to the hold before it. The window is COMPUTED here on every
    # build and printed in full -- never a frame number typed into this
    # file, because a re-supplied source whose turn starts elsewhere would
    # otherwise inherit a number fitted to the old one in silence. See
    # `find_hold_window` and `build_idle_src`. Must run after fix_forward,
    # for the same reason step 4.6 must. ----------------------------------
    turn_bearings, _turn_weapon = measure_clip_bearings(scratch_arm, turn_src)
    departure, hold_end = find_hold_window(turn_bearings)
    print(
        f"{TURN_SOURCE}: {len(turn_bearings)} frames, forward bearing per frame "
        "(exported convention, +X = 0, + is the figure's left), "
        f"dev from the opening {turn_bearings[0]:+.2f}:"
    )
    for i, deg in enumerate(turn_bearings):
        mark = ""
        if i == hold_end:
            mark = "  <- idle ends here (last frame within " f"{LOOP_SEAM_DEG:.0f} deg of the opening)"
        elif i == departure:
            mark = f"  <- the turn has begun (past {HOLD_TOLERANCE_DEG:.0f} deg)"
        print(f"  {i:4d} {deg:+8.2f} {_wrap_deg(deg - turn_bearings[0]):+8.2f}{mark}")
    hold_mean, hold_lo, hold_hi = _circular_mean_deg(turn_bearings[: hold_end + 1])
    print(
        f"hold window: frames 0..{hold_end} of {len(turn_bearings) - 1}, "
        f"turn begins at frame {departure}; bearing mean {hold_mean:+.2f} deg "
        f"[{hold_lo:+.2f},{hold_hi:+.2f}], spread {hold_hi - hold_lo:.2f} deg -- "
        f"root yaw {hold_mean:+.2f} deg applied so the hold faces +X"
    )
    idle_src = build_idle_src(scratch_arm, turn_src, hold_end, hold_mean)

    # --- 4.6. synthesize fire and down, each from a frame INSIDE that hold
    # window plus an authored motion -- see `build_fire_src`'s and
    # `build_down_src`'s own docstrings for why each is built rather than
    # retargeted from a supplied clip, and for what taking the base from
    # `frame_range[1]` instead (this file's own previous behaviour) cost.
    # Must run after fix_forward (like wreck, below): `idle_src`'s fcurves
    # only encode the rest state `sample_clip` will read once
    # `transform_apply` above has run. -----------------------------------
    hold_base_frame = hold_end // 2
    print(f"fire/down base pose: frame {hold_base_frame} of the bound hold window")
    fire_src = build_fire_src(scratch_arm, idle_src, hold_base_frame)
    down_src = build_down_src(scratch_arm, idle_src, hold_base_frame)

    # --- 5. derive wreck from the imported fall clip's own last frame ------
    wreck_src = build_wreck_src(scratch_arm, fall_src)

    # --- 6. sample all six clips into plain Python data, off the scratch
    # rig, BEFORE any duplication happens -- order is load-bearing, see the
    # long comment on step 6 below for why. ----------------------------------
    src_by_clip = {
        "idle": idle_src,
        "move": move_src,
        "fire": fire_src,
        "moveFire": move_fire_src,
        "down": down_src,
        "wreck": wreck_src,
    }
    frames_by_clip = {
        clip_name: sample_clip(scratch_arm, src_by_clip[clip_name]) for clip_name in CLIP_ORDER
    }
    bearings_by_clip = {
        clip_name: measure_clip_bearings(scratch_arm, src_by_clip[clip_name])
        for clip_name in CLIP_ORDER
    }

    # --- 6.5. enforce CLIP_SEMANTICS before any expensive downstream work
    # (webbing graft, six-way duplicate/export, GLB merge) runs at all --
    # see check_clip_semantics's own docstring for why this exists and
    # where it is otherwise the project lead's own eyes. ------------------
    check_clip_semantics(frames_by_clip, hips_rest, arm_world, bearings_by_clip)

    # --- 7. delete every `*_src` action BEFORE duplicating/renaming --------
    # `sample_clip` already turned each one into plain data, so none needs
    # to survive -- and NONE MAY survive past this point. Renaming a bone
    # (`duplicate_figure`, next) does not scope its fixup to the object
    # being renamed: Blender's bone-rename callback walks EVERY action in
    # the file and rewrites any fcurve `data_path` matching the OLD name,
    # wherever it appears (`BKE_animdata_fix_paths_rename`-style global
    # fixup, undocumented in the Python API and found the hard way, not
    # read from a changelog). Every `*_src` action's fcurves reference the
    # SAME bone names ("Hips", "LeftUpLeg", ...) the duplicate figures are
    # about to be renamed FROM ("f0_Hips", ...) -- so with the source
    # actions still alive, renaming `f0`'s "Hips" to "f0_Hips" ALSO
    # silently rewrites `move_src`'s own "Hips" fcurve to "f0_Hips", even
    # though `move_src` belongs to `scratch_arm`, which still has a bone
    # actually named "Hips". The effect: `scratch_arm`'s pose freezes at
    # whatever it last evaluated to, no error raised anywhere. Confirmed by
    # bisecting `duplicate_figure` line by line -- pose sampling read back
    # correctly varying values through vertex-group renaming and even after
    # `dup_arm.animation_data_clear()`, and froze at the exact line that
    # renames `dup_arm`'s OWN bones. Deleting the source actions first means
    # there is nothing left in the file for that rewrite to corrupt.
    for action in (
        move_src, move_fire_src, idle_src, fire_src, down_src, wreck_src, turn_src, fall_src
    ):
        action.use_fake_user = False
        bpy.data.actions.remove(action)

    # --- 7.5. graft the webbing role, using the FULL (still unsplit) scratch
    # mesh as the nearest-surface weight-transfer source -- must run before
    # step 8 peels boot/face/keffiyeh off it. See `build_webbing`'s own
    # docstring and the task report for the measurements this fit uses. ----
    webbing_obj = build_webbing(scratch_mesh, scratch_arm)

    # --- 8. split the scratch mesh by role, BEFORE duplication -------------
    # One role classification, reused identically by all three figures --
    # they are pure duplicates of the same bind-pose geometry, so computing
    # this once and splitting before duplicating is equivalent to (and far
    # cheaper than) classifying three times.
    scratch_role_meshes = separate_by_role(scratch_mesh, vertex_roles)
    scratch_role_meshes["webbing"] = webbing_obj
    print(f"roles present: {sorted(scratch_role_meshes)}")

    # --- 9. duplicate x3 (armature + every role mesh together), prefix
    # bones/vgroups, spread -----------------------------------------------
    figures = []
    dup_arms = []
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
    # join the armatures -- this order is load-bearing, not arbitrary
    # (mirrors `tools/units/rig.py`'s own `join_by_role`, but the ORDER
    # relative to the armature join is the whole reason this bug exists to
    # warn about). Each duplicate mesh is PARENTED to its own per-figure
    # `dup_arm` (Blender's own object-duplicate behaviour, generalised from
    # the original single-mesh script). `bpy.ops.object.join()` on
    # armatures DELETES every non-active armature object outright once its
    # bones are absorbed -- and does NOT reparent or otherwise fix up
    # objects still parented to the object it just deleted. Joining the
    # armatures FIRST (this function's first, broken version) left every
    # f1/f2 role-mesh parented to a now-nonexistent object, which silently
    # corrupted their world transform on evaluation -- not a crash, a wrong
    # pose: the exported figure's evaluated bounds ballooned to roughly
    # double the correct standing-figure envelope (z reaching 2.56 instead
    # of ~1.5, x reaching -1.63 instead of ~-0.35) and rendered as a
    # spiked, unrecognisable mess (see the task report for the side-by-side
    # screenshots). Joining meshes per role FIRST consolidates every role's
    # three copies under the ACTIVE (f0) copy alone, which is already
    # parented to `dup_arms[0]` -- the one armature object guaranteed to
    # survive the join below -- so nothing is ever left parented to an
    # object about to be deleted.
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
    # One clip's action exists in `bpy.data.actions` at a time, deleted
    # immediately after its own export -- see `export_glb`'s own docstring
    # for why a shared multi-action armature silently corrupts every clip's
    # sampling on export.
    tmp_dir = tempfile.mkdtemp(prefix="meshy_soldier_clips_")
    clip_paths = {}
    for clip_name in CLIP_ORDER:
        combined = write_combined_clip(
            merged_arm, figures, clip_name, frames_by_clip[clip_name],
            cyclic=clip_name in CYCLIC_CLIPS,
        )
        tmp_path = os.path.join(tmp_dir, f"{clip_name}.glb")
        export_glb(merged_arm, tmp_path)
        clip_paths[clip_name] = tmp_path

        # Tear the action back off before the next clip builds, so no two
        # actions ever coexist in `bpy.data.actions` at once. (Clearing
        # `.action` alone also clears `.action_slot` -- setting the slot
        # afterward raises "Cannot set slot without an assigned Action".)
        merged_arm.animation_data.action = None
        combined.use_fake_user = False
        bpy.data.actions.remove(combined)

    # --- 14. merge the six single-clip temp files into the real output -----
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
