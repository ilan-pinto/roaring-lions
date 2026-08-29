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

No `mathutils.noise` anywhere in this file (nothing here needs randomness).
"""
import json
import math
import os
import struct
import sys
import tempfile

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO, "art", "blend", "soldier")
OUT_PATH = os.path.join(REPO, "art", "meshes", "meshy_soldier.glb")

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

ROLE = "uniform"


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


def duplicate_figure(scratch_arm, scratch_mesh, prefix, dx, dy):
    """One full-copy duplicate of the scratch rig, bones+vertex-groups
    prefixed, translated to its rest position. Mirrors `tools/units/rig.py`'s
    "no weight painting, rigid bind" spirit -- this is a rename, not a
    reweight; every vertex keeps whatever single group it was already
    rigidly bound to."""
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
    scratch_mesh.select_set(True)
    bpy.context.view_layer.objects.active = scratch_arm
    bpy.ops.object.duplicate(linked=False)

    dup_arm = next(o for o in bpy.context.selected_objects if o.type == "ARMATURE")
    dup_mesh = next(o for o in bpy.context.selected_objects if o.type == "MESH")

    orig_names = [b.name for b in dup_arm.data.bones]
    for name in orig_names:
        dup_mesh.vertex_groups[name].name = f"{prefix}_{name}"
    for name in orig_names:
        dup_arm.data.bones[name].name = f"{prefix}_{name}"

    dup_arm.animation_data_clear()
    dup_arm.location = (dx, dy, 0.0)

    return dup_arm, dup_mesh


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


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- 1. import: base rig from Walking.glb, then the other three -------
    scratch_arm, scratch_mesh, move_src = import_base_clip(
        os.path.join(SRC_DIR, CLIP_SOURCES["move"]), "move_src"
    )
    idle_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["idle"]), "idle_src")
    fire_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["fire"]), "fire_src")
    down_src = import_clip(os.path.join(SRC_DIR, CLIP_SOURCES["down"]), "down_src")

    # --- 2. zero materials --------------------------------------------------
    scratch_mesh.data.materials.clear()

    # --- 3. fix forward to +X -----------------------------------------------
    fix_forward(scratch_arm)

    # --- 4. derive wreck from down's last frame -----------------------------
    wreck_src = build_wreck_src(scratch_arm, down_src)

    # --- 5. sample all five clips into plain Python data, off the scratch
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

    # --- 6. delete every `*_src` action BEFORE duplicating/renaming --------
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

    # --- 7. duplicate x3, prefix bones/vgroups, spread ----------------------
    figures = []
    dup_pairs = []
    for prefix, dx, dy in FIGURE_SPREAD:
        dup_arm, dup_mesh = duplicate_figure(scratch_arm, scratch_mesh, prefix, dx, dy)
        figures.append((prefix, dx, dy))
        dup_pairs.append((dup_arm, dup_mesh))

    # --- 8. join meshes, join armatures, tag role ---------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for _arm, mesh in dup_pairs:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = dup_pairs[0][1]
    bpy.ops.object.join()
    merged_mesh = dup_pairs[0][1]

    bpy.ops.object.select_all(action="DESELECT")
    for arm, _mesh in dup_pairs:
        arm.select_set(True)
    bpy.context.view_layer.objects.active = dup_pairs[0][0]
    bpy.ops.object.join()
    merged_arm = dup_pairs[0][0]

    if len(merged_arm.data.bones) != 24 * 3:
        raise RuntimeError(f"expected 72 bones after join, got {len(merged_arm.data.bones)}")
    if len(merged_mesh.vertex_groups) != 24 * 3:
        raise RuntimeError(
            f"expected 72 vertex groups after join, got {len(merged_mesh.vertex_groups)}"
        )
    if merged_mesh.modifiers[0].object != merged_arm:
        raise RuntimeError("merged mesh's Armature modifier does not target the merged armature")

    merged_mesh.name = ROLE
    merged_mesh.data.name = ROLE
    merged_mesh["rl_role"] = ROLE

    # --- 9. scratch rig no longer needed -- delete it -----------------------
    bpy.data.objects.remove(scratch_mesh, do_unlink=True)
    bpy.data.objects.remove(scratch_arm, do_unlink=True)
    bpy.data.orphans_purge(do_recursive=True)

    # --- 10. write + export each clip ALONE, one export call per clip ------
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

    # --- 11. merge the five single-clip temp files into the real output ----
    merge_clip_glbs({name: clip_paths[name] for name in CLIP_ORDER}, OUT_PATH)
    for path in clip_paths.values():
        os.remove(path)
    os.rmdir(tmp_dir)

    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), clips={list(CLIP_ORDER)}, "
          f"bones={len(merged_arm.data.bones)}, verts={len(merged_mesh.data.vertices)}")


if __name__ == "__main__":
    main()
