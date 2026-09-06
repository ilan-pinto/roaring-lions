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

    Walking_withSkin.glb                       -> move     (real gait, 6.371)
    Idle_02_withSkin.glb                       -> idle     (near-zero, 0.955)
    Walk_Forward_While_Shooting_withSkin.glb   -> moveFire (real gait, 5.53 --
                                                             bound 2026-09-06;
                                                             see below for why
                                                             this needed a new
                                                             `ClipName`, not a
                                                             `fire` slot)
    Shot_and_Slow_Fall_Backward_withSkin.glb   -> wreck    (last frame only)
    Shot_and_Fall_Forward_withSkin.glb         -> wreckAlt (last frame only --
                                                             bound 2026-09-06,
                                                             free variation,
                                                             see FALL_SOURCE_ALT)
    Running_withSkin.glb                        UNUSED    (needs a "fleeing"
                                                          signal that does not
                                                          reach the renderer --
                                                          GH-152's blocker, the
                                                          same reason the KDF
                                                          source's own `Running`
                                                          stays unused. Do not
                                                          bind this until that
                                                          signal exists.)
    Side_Shot_withSkin.glb                      UNUSED  (measured 14.14 x100
                                                          Hips travel, ~15x
                                                          idle -- a hit
                                                          reaction, same trap
                                                          as the KDF source's
                                                          identically-named
                                                          clip. Read by
                                                          nothing here.)

`Walk_Forward_While_Shooting` measured 5.53 x100 Hips travel -- real gait
travel, disqualified from `fire`'s near-zero-Hips ceiling by the same logic
`move` itself would be, and a glTF animation can only be bound under ONE
`ClipName` per file (`buildMeshUnitTemplate`'s `clips` is a `Map` keyed by
name, so a second `move`-named or `fire`-named clip would silently overwrite
whichever import ran first, never coexist). It therefore binds under a new
`ClipName` member, `moveFire`, added to `packages/render/src/sheet.ts` the
same way `work` was added for `yahalom_squad` -- an extension proposed and
documented against the pinned contract, not an improvisation outside it. The
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
import tempfile

import bpy
import numpy as np

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
CLIP_ORDER = ("idle", "move", "fire", "moveFire", "down", "wreck", "wreckAlt")

#: The clips that actually loop at runtime. Identical shape to
#: `import_meshy_soldier.py`'s own `CYCLIC_CLIPS` -- see that file's
#: `write_combined_clip` for why this is what makes a per-figure phase
#: shift well-defined, and why `fire`/`down`/`wreck`/`wreckAlt` are excluded.
#: `moveFire` is a real gait cycle (same shape as `move`, just with the rifle
#: raised) so it gets the same per-figure phase offset `move` does.
CYCLIC_CLIPS = frozenset({"idle", "move", "moveFire"})

CLIP_SOURCES = {
    "move": "Meshy_AI_irregular_fighter_rig_biped_Animation_Walking_withSkin.glb",
    "idle": "Meshy_AI_irregular_fighter_rig_biped_Animation_Idle_02_withSkin.glb",
    "moveFire": "Meshy_AI_irregular_fighter_rig_biped_Animation_Walk_Forward_While_Shooting_withSkin.glb",
}

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

#: Same semantics table `import_meshy_soldier.py` already built and proved.
#: See that file's own `CLIP_SEMANTICS` docstring for the two prior
#: instances this exists to catch a third of; this task found and avoided a
#: THIRD-AND-FOURTH instance on ITS OWN source before ever touching this
#: table (`Side_Shot` -> hit reaction again, `Walk_Forward_While_Shooting`
#: -> real gait, neither mapped to `fire`).
CLIP_SEMANTICS = {
    "idle": {
        "means": "standing hold, minimal motion -- the baseline every other clip is measured against.",
        "ceiling": lambda idle_travel: None,
    },
    "move": {
        "means": "a real gait cycle -- Hips travel is EXPECTED here, unlike every other clip in this table.",
        "ceiling": lambda idle_travel: None,
    },
    "fire": {
        "means": "stand and shoot; recoil is upper-body only, so Hips travel must not exceed idle's own.",
        "ceiling": lambda idle_travel: idle_travel + 0.5,
    },
    "moveFire": {
        "means": (
            "a real gait cycle WHILE firing -- the source's own "
            "Walk_Forward_While_Shooting clip. Hips travel is EXPECTED here, "
            "exactly like `move` -- this is NOT `fire`'s near-zero-Hips shape."
        ),
        "ceiling": lambda idle_travel: None,
    },
    "down": {
        "means": (
            "a HELD pose -- suppression, looped indefinitely, AND the first phase of death "
            "(mesh-death.ts plays this before wreck) -- near-zero Hips travel, well under idle's."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
    },
    "wreck": {
        "means": "a HELD corpse pose -- same requirement as down: static, near-zero Hips travel.",
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
    },
    "wreckAlt": {
        "means": (
            "a SECOND held corpse pose (the forward fall, free variation) -- "
            "same requirement as wreck: static, near-zero Hips travel."
        ),
        "ceiling": lambda idle_travel: max(1.0, idle_travel * 0.5),
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


def build_wreck_src(scratch_arm, fall_action):
    """Identical to `import_meshy_soldier.py`'s own `build_wreck_src`: a
    static two-frame hold of `fall_action`'s own last frame. `fall_action`
    here is `Shot_and_Slow_Fall_Backward`'s imported action -- see the module
    docstring for why that file, not `Shot_and_Fall_Forward`, was chosen."""
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
    rather than left stale or cleared to `None`."""
    scratch_arm.animation_data.action = src_action
    scratch_arm.animation_data.action_slot = src_action.slots[0] if src_action.slots else None
    bpy.context.view_layer.update()
    f0, f1 = src_action.frame_range
    n_steps = max(1, round(f1 - f0))
    bone_names = [pb.name for pb in scratch_arm.pose.bones]

    frames = []
    for step in range(n_steps + 1):
        src_frame = f0 + (f1 - f0) * step / n_steps
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


def write_combined_clip(merged_arm, figures, clip_name, frames, cyclic=False):
    """Identical to `import_meshy_soldier.py`'s own `write_combined_clip`,
    `cyclic` included -- see that function's docstring for what it does and
    why."""
    combined = bpy.data.actions.new(clip_name)
    combined.use_fake_user = True
    if merged_arm.animation_data is None:
        merged_arm.animation_data_create()
    merged_arm.animation_data.action = combined
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
    """Identical to `import_meshy_soldier.py`'s own `_hips_world_z_travel`."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    zs = []
    for f in frames:
        q, loc, sc = f["Hips"]
        basis = Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))
        world = arm_world @ (hips_rest @ basis)
        zs.append(world.translation.z)
    return (max(zs) - min(zs)) * 100.0


def check_clip_semantics(frames_by_clip, hips_rest, arm_world):
    """Identical to `import_meshy_soldier.py`'s own `check_clip_semantics`."""
    travel = {name: _hips_world_z_travel(frames_by_clip[name], hips_rest, arm_world) for name in CLIP_ORDER}
    idle_travel = travel["idle"]
    print("Hips world-z travel x100, by clip:", {k: round(v, 3) for k, v in travel.items()})

    for name in CLIP_ORDER:
        ceiling = CLIP_SEMANTICS[name]["ceiling"](idle_travel)
        if ceiling is not None and travel[name] > ceiling:
            raise RuntimeError(
                f"{name}: Hips travel {travel[name]:.3f} exceeds {ceiling:.3f} -- "
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

    # --- 1. import: base rig from Walking, then idle, the moving-fire gait,
    # and both fall clips.
    scratch_arm, scratch_mesh, move_src = import_base_clip(
        os.path.join(SRC_DIR, CLIP_SOURCES["move"]), "move_src"
    )
    idle_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["idle"]), "idle_src")
    move_fire_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["moveFire"]), "move_fire_src")
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

    # --- 4.5. synthesize fire and down -----------------------------------
    fire_src = build_fire_src(scratch_arm, idle_src)
    down_src = build_down_src(scratch_arm, idle_src)

    # --- 5. derive wreck/wreckAlt from each imported fall clip's own last
    # frame ------------------------------------------------------------------
    wreck_src = build_wreck_src(scratch_arm, fall_src)
    wreck_alt_src = build_wreck_src(scratch_arm, fall_alt_src)

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
    }
    frames_by_clip = {
        clip_name: sample_clip(scratch_arm, src_by_clip[clip_name]) for clip_name in CLIP_ORDER
    }

    # --- 6.5. enforce CLIP_SEMANTICS before any expensive downstream work --
    check_clip_semantics(frames_by_clip, hips_rest, arm_world)

    # --- 7. delete every `*_src` action BEFORE duplicating/renaming --------
    # See `import_meshy_soldier.py`'s own `main()` for the full account of
    # why this ordering is load-bearing (Blender's bone-rename callback is
    # not scoped to the object being renamed).
    for action in (
        move_src, idle_src, move_fire_src, fire_src, down_src,
        wreck_src, wreck_alt_src, fall_src, fall_alt_src,
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
