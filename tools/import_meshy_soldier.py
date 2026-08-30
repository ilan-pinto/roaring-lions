"""Retarget the supplied Meshy soldier (five single-clip GLBs, one mesh, one
24-joint Mixamo-style skeleton) into ONE contract-compliant team file:
`art/meshes/meshy_soldier.glb`, per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` (v1, infantry).

Usage (headless, matching `tools/export_mesh_team.py`'s own invocation shape):

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/import_meshy_soldier.py

Source files, gitignored (`art/blend/` -- never committed), read from
`art/blend/soldier/*.glb`:

    Walking.glb              (action "...|walking_man|...")   -> move
    Gun_Hold_Left_Turn.glb   (action "...|Gun_Hold_Left_Turn|...") -> idle
    Side_Shot.glb            (action "...|Side_Shot|...")      -> fire
    Shot_and_Blown_Back.glb  (action "...|Shot_and_Blown_Back|...") -> down

`Running.glb` is the brief's own named spare (a faster `move`) and is not
built here -- nothing in the contract asks for a second `move`, and
`ClipName` has no slot for one.

## What this script does, in order

1.  Imports each of the four required GLBs into ONE continuous Blender
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

3.  Fixes forward. The contract requires local +X; this asset's own
    "headfront" marker bone (present nowhere else in the roster -- a Meshy
    convention, not ours) sits at LOWER local Y than "Head" at import time,
    confirmed by reading `Bone.head_local` directly rather than guessed --
    i.e. forward is -Y in Blender's post-import (Z-up) frame. A +90 degree
    rotation about Z maps -Y to +X. Applied to the scratch ARMATURE object
    only (its child mesh follows via ordinary object parenting, and Blender
    compensates the parent-inverse automatically on Apply Transform, so nothing
    visually jumps) and then baked in (`transform_apply`) so the exported
    rig's own rest bones encode +X-forward directly, matching `kit.py`'s
    convention of building geometry with no separate node-level rotation.

4.  Derives a `wreck` source action from `down`'s own LAST frame -- the
    brief's own suggestion -- by sampling that pose once and keying it
    static at two frames (frame 0 and 1, mirroring `rig.py`'s own
    `_VIS_FRAMES` convention for a well-formed, non-degenerate static clip).

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

7.  Builds each of the five clips (`idle`, `move`, `fire`, `down`, `wreck`)
    ONE AT A TIME by replaying its `*_src` action on the (still-original-
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
    -- see `export_glb`'s own docstring for why building all five actions on
    one armature and exporting once (the obvious approach, and this script's
    first one) silently produces a file where every clip's every channel
    collapses to two identical keyframes.

8.  Merges the five single-clip temporary GLBs into ONE file in pure Python
    (`merge_clip_glbs`, no `bpy`) -- the first file's mesh/skin/node graph
    is kept as-is, and each other file's one animation is re-homed into it:
    its sampler accessors and their backing bufferViews are copied into the
    base file's buffer (4-byte aligned) under fresh indices, while
    `channel.target.node` and `sampler` indices are left untouched, because
    every temporary file was exported from the SAME rig with nothing but
    the active action differing between exports, so node ordering is
    identical across all five -- verified by comparing node name lists
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
SRC_DIR = os.path.join(REPO, "art", "blend", "soldier")
OUT_PATH = os.path.join(REPO, "art", "meshes", "meshy_soldier.glb")

sys.path.insert(0, os.path.join(REPO, "tools", "units"))
import kit  # noqa: E402 -- the webbing graft below builds real kit.py geometry

#: Clip build order -- also the order clips appear in the merged file.
#: Arbitrary (the runtime reads clips by name, `mesh-unit.ts`'s own
#: `buildMeshUnitTemplate` builds a `Map<ClipName, AnimationClip>`), kept
#: fixed only so a rerun's temp-file names are predictable.
CLIP_ORDER = ("idle", "move", "fire", "down", "wreck")

# --- source clip mapping, per the task brief's own table --------------------
CLIP_SOURCES = {
    "move": "Walking.glb",
    "idle": "Gun_Hold_Left_Turn.glb",
    "fire": "Side_Shot.glb",
    "down": "Shot_and_Blown_Back.glb",
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
    five files carries a second, 42-vert "Icosphere" placeholder alongside
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


def fix_forward(arm_obj):
    """+90 deg about Z, applied and baked -- see module docstring point 3
    for the "headfront" bone evidence this rotation is derived from, not
    guessed."""
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.rotation_euler = (0.0, 0.0, math.radians(90.0))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def build_wreck_src(scratch_arm, down_action):
    """A static two-frame action holding DOWN's own last frame -- the
    brief's suggested `wreck` candidate. `_VIS_FRAMES`-style (frame 0 and 1,
    matching `tools/units/rig.py`'s own convention for a non-degenerate
    static clip) rather than a single keyframe."""
    scratch_arm.animation_data.action = down_action
    f0, f1 = down_action.frame_range
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


def write_combined_clip(merged_arm, figures, clip_name, frames):
    """Keys `frames` (from `sample_clip`) onto every figure's `f{n}_`-
    prefixed bones on `merged_arm`, under one new action named `clip_name`
    -- exactly the canonical name the contract and `mesh-anim.ts`'s
    `isMeshClipName` both require."""
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

    for step, sampled in enumerate(frames):
        for prefix, _dx, _dy in figures:
            for name, (q, loc, sc) in sampled.items():
                pb = merged_arm.pose.bones[f"{prefix}_{name}"]
                pb.rotation_quaternion = q
                pb.location = loc
                pb.scale = sc
                pb.keyframe_insert(data_path="rotation_quaternion", frame=step)
                pb.keyframe_insert(data_path="location", frame=step)
                pb.keyframe_insert(data_path="scale", frame=step)

    return combined


def export_glb(arm_obj, path):
    """`tools/units/rig.py`'s own `export_glb` settings, plus
    `export_optimize_animation_size=False`, and called ONCE PER CLIP against
    an armature carrying exactly one action at a time -- see `main()`'s own
    comment for why, and the paragraph below for what "why" turned out to be.

    This function used to be called once, after building all five combined
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
    recombines the five temp files into one in pure Python, after Blender's
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
# Five temporary files, each the SAME rig (mesh, skin, node graph -- nothing
# but the active action differs between the five export calls that produced
# them) plus exactly one animation. `merge_clip_glbs` keeps the first file's
# mesh/skin/nodes/buffer as the base and re-homes each other file's one
# animation into it: its sampler accessors and their backing bufferViews are
# copied into the base's buffer (4-byte aligned, per the glTF spec) under
# fresh indices, while `channel.target.node` and each channel's `sampler`
# index are left untouched -- the first because node ordering is identical
# across all five files BY CONSTRUCTION and is verified below rather than
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


def merge_clip_glbs(clip_paths, out_path):
    """`clip_paths`: ordered `{clip_name: path}`. Raises loudly (never
    silently drops a clip or mismatches a node) if any file's node graph
    does not match the base file's exactly."""
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

    # --- 1. import: base rig from Walking.glb, then the other three -------
    scratch_arm, scratch_mesh, move_src = import_base_clip(
        os.path.join(SRC_DIR, CLIP_SOURCES["move"]), "move_src"
    )
    idle_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["idle"]), "idle_src")
    fire_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["fire"]), "fire_src")
    down_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["down"]), "down_src")

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

    # --- 4. fix forward to +X -----------------------------------------------
    fix_forward(scratch_arm)

    # --- 5. derive wreck from down's last frame -----------------------------
    wreck_src = build_wreck_src(scratch_arm, down_src)

    # --- 6. sample all five clips into plain Python data, off the scratch
    # rig, BEFORE any duplication happens -- order is load-bearing, see the
    # long comment on step 6 below for why. ----------------------------------
    src_by_clip = {
        "idle": idle_src,
        "move": move_src,
        "fire": fire_src,
        "down": down_src,
        "wreck": wreck_src,
    }
    frames_by_clip = {
        clip_name: sample_clip(scratch_arm, src_by_clip[clip_name]) for clip_name in CLIP_ORDER
    }

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
    for action in (move_src, idle_src, fire_src, down_src, wreck_src):
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
        combined = write_combined_clip(merged_arm, figures, clip_name, frames_by_clip[clip_name])
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

    # --- 14. merge the five single-clip temp files into the real output ----
    merge_clip_glbs({name: clip_paths[name] for name in CLIP_ORDER}, OUT_PATH)
    for path in clip_paths.values():
        os.remove(path)
    os.rmdir(tmp_dir)

    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), clips={list(CLIP_ORDER)}, "
          f"bones={len(merged_arm.data.bones)}, roles={sorted(merged_meshes)}, "
          f"verts={total_verts}")


if __name__ == "__main__":
    main()
