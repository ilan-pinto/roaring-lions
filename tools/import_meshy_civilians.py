"""Turn the four supplied Meshy civilian figures into four contract-compliant
single-figure meshes under `art/meshes/civilians/`, per
`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` (v1, infantry) and
GH-149.

Run headless:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/import_meshy_civilians.py

    # one figure, while iterating:
    ... --python tools/import_meshy_civilians.py -- --only civilian_child

    # print each figure's island table instead of building anything -- what a
    # re-supplied source is measured with before `civilian_roles.FIGURES` is
    # updated:
    ... --python tools/import_meshy_civilians.py -- --islands

## What the source is

Four `rig_biped` exports, gitignored under `art/blend/civilian/`, one GLB per
animation, each carrying one `char1` mesh (2 968-4 255 verts), one material
with one 4096x4096 base-colour texture, and one 24-joint armature. The four
skeletons are topologically IDENTICAL -- same bone names, same hierarchy,
verified rather than assumed.

    civilian_woman   Crawl_and_Look_Back, Idle_9, Running, Walking
    office_worker    Crawl_and_Look_Back, Idle_9, Running, Walking
    farm_worker      Crawl_and_Look_Back, Idle_9, Running, Walking
    civilian_child   Running, Walking          <- no Idle, no Crawl

This is a sibling of `tools/import_meshy_soldier.py` and shares its machinery
(`import_base_clip`, `import_clip`, `separate_by_role`, `export_glb`,
`merge_clip_glbs`, `apply_forward_fix`) by importing it rather than copying
it. Three things are genuinely different, and each has its own section below:
what the clips are, how roles are found, and what happens to the child.

## The clips: three, not five, and `down` is a HELD pose

`Idle_9` -> `idle`, `Walking` -> `move`, `Crawl_and_Look_Back` -> `down`.
`fire` and `work` are not authored at all: a civilian neither shoots nor digs,
and `meshClipOrFallback` degrades both to `idle` by design. `wreck` is not
authored either, so `mesh-death.ts` fades a killed civilian out rather than
leaving a body -- see the task report, where that is recorded as a choice
rather than an oversight.

`down` is ONE HELD FRAME of the crawl, not the crawl cycle, and the reason is
a measurement rather than taste. `Crawl_and_Look_Back` carries ROOT MOTION:
its Hips travel 369-414 model units forward over 6.93 s, roughly four metres.
`resolveClip` returns `down` for a PINNED unit, and `applyMeshClip` loops
whatever is showing -- so the cycle would drag a stationary civilian four
metres and snap it back, forever. `mesh-death.ts` plays `down` with
`{ once: true }`, so a killed one would instead crawl four metres away from
its own corpse and stop there. `CIVILIAN_CLIP_SEMANTICS` below enforces the
held-pose requirement at build time, in both axes, so this cannot be undone
by accident.

The held frame is chosen per figure (`DOWN_FRAME_SECONDS`), by scoring the
crawl's own frames on two things: all four ground contacts (both hands, both
knees) close to the ground, and the head yawed at least 75% of that clip's
peak yaw away from the hips -- i.e. actually looking back, which is the
readable half of the pose. The Hips' HORIZONTAL travel is then zeroed
(`_hold_pose`), keeping only the vertical drop, so the crawling figure stays
over its own entity root instead of standing a third of a tile away from it.

## Roles come from mesh ISLANDS, not from colour centroids

`tools/civilian_roles.py`, whose own docstring is the full argument: these
figures carry accessories (a satchel, a messenger bag with buckles, a straw
hat, a headscarf, two ponytails, a farm tool), Meshy bakes lighting into the
texture, and colour clustering scattered the satchel across three clusters
while never once isolating the tool. Connected components do neither.

This file's job at that boundary is only to gather the inputs: per-vertex
position, triangle list, per-vertex sampled base colour, and the bone each
vertex is weighted to most heavily. The colour is sampled through
`import_meshy_soldier._basecolor_image_array` (whose docstring records why
Blender's own unflipped pixel buffer must be paired with Blender's own
already-flipped UV, and not with an externally loaded image) and converted
back to sRGB 0-255 before classification, so the numbers the classifier's
thresholds are documented against mean the same thing on both sides.

## The child, which has neither an idle nor a crawl

GH-149: "Do not silently substitute one -- a walk cycle as a rest pose makes
it moonwalk." It does not get one. It gets the woman's `Idle_9` and her
chosen crawl frame RETARGETED onto its own rig (`tools/civilian_retarget.py`),
which is a different thing from the borrow the issue warns about, and the
difference was measured against ground truth before it shipped: all three
ADULT idles are the same 2.03 s animation Meshy retargeted onto three rigs,
so retargeting the woman's onto the office worker's rig can be compared
against his own supplied idle. Over 21 times x 24 joints, this method lands
2.31 deg mean / 8.55 max from Meshy's own; the naive local-rotation copy
lands 19.57 mean / 140.49 max. See `civilian_retarget.py` for the derivation
and the rest of the numbers.

The woman is the donor because she is closest in stature (1.64 m against the
child's 1.20 m; the office worker is 1.75 and the farm worker 1.72), and her
Hips translation is scaled by that height ratio so the child's root does not
fly.

The alternatives were considered and are recorded in the task report: asking
Meshy for the child's own Idle (blocks the whole figure on a re-supply),
holding the child back entirely (loses the crowd's most distinctive
silhouette, and the child is 1.20 m against three adults at 1.64-1.75 -- the
one variant nobody can mistake for a fighter), and freezing a passing-pose
frame of its own Walking as a static idle (its own body, but a statue among
three breathing adults, and still no answer at all for `down`).

## Forward, and why the fix is post-export

`FORWARD_FIX_DEG = 90.0`, the same value every other Meshy import in this
repo uses, applied to the merged glTF node graph by
`import_meshy_soldier.apply_forward_fix` rather than inside Blender -- see
that function's and `fix_forward`'s own docstrings for the live measurement
showing a Blender-side armature bake cannot touch the exported facing at any
angle. These figures face glTF +Z (measured: the crawl advances along +Z and
the head leads), and +90 about +Y carries +Z to +X, the contract's forward.
"""
import argparse
import math
import os
import sys
import tempfile

import bpy
import numpy as np  # noqa: F401 -- pulled in by import_meshy_soldier's own use
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import civilian_retarget as retarget  # noqa: E402
import civilian_roles as roles  # noqa: E402
import import_meshy_soldier as soldier  # noqa: E402

SRC_DIR = os.path.join(REPO, "art", "blend", "civilian")
OUT_DIR = os.path.join(REPO, "art", "meshes", "civilians")

#: See the module docstring. Same value as every other Meshy import here.
FORWARD_FIX_DEG = 90.0

#: Clip build order. Three, not the contract's six -- `fire`, `work` and
#: `wreck` are deliberately unauthored, see the module docstring.
CLIP_ORDER = ("idle", "move", "down")

#: Which supplied file feeds which clip, by filename fragment.
CLIP_SOURCES = {
    "idle": "Animation_Idle_9_withSkin",
    "move": "Animation_Walking_withSkin",
    "down": "Animation_Crawl_and_Look_Back_withSkin",
}

#: The crawl frame each figure's `down` holds, in seconds into the 6.93 s
#: clip. Chosen by the scoring described in the module docstring and pinned
#: here rather than recomputed at build time, so the shipped pose is a
#: decision on the record and not a function of whatever the scoring
#: function happens to prefer after an edit. Measured contacts (both hands,
#: both knees, metres above ground) and head-vs-hips yaw at each:
#:
#:   civilian_woman  2.070  [0.057, 0.041, -0.025, -0.045]  55 deg
#:   office_worker   2.105  [0.026, 0.008,  0.039,  0.029]  71 deg
#:   farm_worker     2.130  [0.048, 0.043,  0.093,  0.074]  77 deg
DOWN_FRAME_SECONDS = {
    "civilian_woman": 2.070,
    "office_worker": 2.105,
    "farm_worker": 2.130,
}

#: Source directory per figure, and (for the child alone) which figure
#: donates the clips it was never supplied.
FIGURES = {
    "civilian_woman": {"dir": "Meshy_AI_civilian_woman_rig_biped"},
    "office_worker": {"dir": "Meshy_AI_office_worker_rig_biped"},
    "farm_worker": {"dir": "Meshy_AI_farm_worker_rig_biped"},
    "civilian_child": {
        "dir": "Meshy_AI_civilian_child_rig_biped",
        "donor": "civilian_woman",
        "donor_clips": ("idle", "down"),
    },
}

#: What each clip must MEAN, and the measurable property `check_clip_semantics`
#: holds it to -- the civilian counterpart of `import_meshy_soldier.py`'s own
#: `CLIP_SEMANTICS`, and it exists for the same reason: a supplied clip mapped
#: onto a contract name whose MOTION does not match it has shipped twice on
#: this project already, and the name always looked plausible.
#:
#: The one that matters here is `down`. It is BOTH the suppression pose
#: (looped for as long as a civilian stays pinned) and the first phase of
#: death (`mesh-death.ts`, `{ once: true }`), and its supplied source travels
#: four metres. `flat` is the Hips' horizontal travel across the clip's own
#: frames, `rise` the vertical -- in centimetres. `None` means unbounded.
CIVILIAN_CLIP_SEMANTICS = {
    "idle": {
        "means": "a standing hold -- the baseline the other two are measured against.",
        "flat": None,
        "rise": None,
    },
    "move": {
        "means": "a real gait cycle, played in place while the sim moves the unit.",
        "flat": None,
        "rise": None,
    },
    "down": {
        "means": (
            "a HELD crawl pose -- looped indefinitely while pinned, and clamped on its "
            "last frame while dying. Both axes must be flat: the SOURCE clip travels "
            "~400 cm and shipping it whole is the mistake this bound exists to stop."
        ),
        "flat": 1.0,
        "rise": 1.0,
    },
}

#: The scene frame rate is pinned to the SOURCE clips' own 30 fps before the
#: first import, not left at Blender's factory 24. Blender's glTF importer
#: converts a clip's keyframe TIMES to frames using the scene fps at import
#: time, so 30 puts the supplied 209-key / 6.93 s crawl and 61-key / 2.03 s
#: idle back on whole frames -- which is what makes `DOWN_FRAME_SECONDS`
#: (expressed in seconds, measured against the source's own timeline) land on
#: the frame it was measured at rather than between two.
SOURCE_FPS = 30

#: A held pose is written as two identical frames rather than one --
#: `tools/units/rig.py`'s own `_VIS_FRAMES` convention for a well-formed,
#: non-degenerate static clip.
HELD_FRAMES = 2


# --- source discovery --------------------------------------------------------

def source_path(figure, clip):
    """The supplied GLB feeding `clip` for `figure`, or None when that figure
    was not supplied one (the child's `idle` and `down`)."""
    directory = os.path.join(SRC_DIR, FIGURES[figure]["dir"])
    fragment = CLIP_SOURCES[clip]
    for name in sorted(os.listdir(directory)):
        if fragment in name and name.endswith(".glb"):
            return os.path.join(directory, name)
    return None


# --- colour -----------------------------------------------------------------

#: `image.pixels` for a byte image is the RAW buffer scaled to 0-1 -- already
#: sRGB-encoded, NOT scene-linear. So a sampled pixel times 255 IS the byte
#: PIL reads out of the same PNG, and `civilian_roles`' thresholds (documented
#: in sRGB 0-255, fit offline against a PIL read) mean the same thing on both
#: sides with no conversion at all.
#:
#: This is asserted rather than assumed, because assuming the other way
#: shipped once in this file's own history: a linear-to-sRGB conversion here
#: double-encoded every sample, brightened the whole texture, and pushed the
#: office worker's dark hair back above `HAIR_LUMA_FRAC` -- 432 hair vertices
#: became 14, silently, with the build reporting success. Checked against a
#: PIL read of the same GLB's raw bytes at seven vertices spread through the
#: mesh, Blender's buffer x255 matched to the byte at every one.
PIXEL_BYTE_SCALE = 255.0


def sample_vertex_colours(mesh_obj):
    """Per-vertex base-colour, sRGB 0-255.

    UV is read per-VERTEX, taking the first loop touching each vertex --
    the identical idiom (and the identical justification) as
    `import_meshy_soldier.classify_vertex_roles`: the source glTF carries one
    UV per vertex, seam-split at export rather than shared, so every loop
    touching a vertex agrees.

    MUST run before `mesh.data.materials.clear()`: the material is the only
    route to the texture."""
    img, w, h = soldier._basecolor_image_array(mesh_obj)  # noqa: SLF001 -- intentional reuse
    mesh = mesh_obj.data
    uv_layer = mesh.uv_layers.active.data
    vertex_uv = [None] * len(mesh.vertices)
    for loop in mesh.loops:
        vi = loop.vertex_index
        if vertex_uv[vi] is None:
            vertex_uv[vi] = uv_layer[loop.index].uv

    colours = []
    for v in mesh.vertices:
        u, vv = vertex_uv[v.index]
        px = min(max(int(round(u * (w - 1))), 0), w - 1)
        py = min(max(int(round(vv * (h - 1))), 0), h - 1)
        colours.append(tuple(float(c) * PIXEL_BYTE_SCALE for c in img[py, px, :3]))
    return colours


def dominant_bones(mesh_obj):
    """The bone each vertex is weighted to most heavily.

    Blender stores skin weights as vertex groups named after bones, so this
    reads the same data the glTF's `JOINTS_0`/`WEIGHTS_0` carry -- which is
    what makes the offline analysis that produced `civilian_roles.FIGURES`
    and this build agree on which island is which."""
    names = {vg.index: vg.name for vg in mesh_obj.vertex_groups}
    out = []
    for v in mesh_obj.data.vertices:
        best, best_w = None, -1.0
        for g in v.groups:
            if g.weight > best_w:
                best, best_w = g.group, g.weight
        if best is None:
            raise RuntimeError(f"vertex {v.index} carries no skin weight at all")
        out.append(names[best])
    return out


def mesh_inputs(mesh_obj):
    """`(positions, triangles, colours, bones)` for `civilian_roles`."""
    mesh = mesh_obj.data
    mesh.calc_loop_triangles()
    positions = [tuple(v.co) for v in mesh.vertices]
    triangles = [tuple(t.vertices) for t in mesh.loop_triangles]
    return positions, triangles, sample_vertex_colours(mesh_obj), dominant_bones(mesh_obj)


# --- pose capture ------------------------------------------------------------

def _capture(arm):
    """The armature's current evaluated pose, in the plain-data shape
    `import_meshy_soldier.sample_clip` uses and `write_clip` consumes."""
    return {
        pb.name: (tuple(pb.rotation_quaternion), tuple(pb.location), tuple(pb.scale))
        for pb in arm.pose.bones
    }


def _bind_action(arm, action):
    """Assigns `action` AND its own slot. `.action` alone is not enough once
    the armature has held a different action -- `sample_clip`'s own docstring
    in `import_meshy_soldier.py` is the full account of the silent frozen-pose
    failure that causes, found there the hard way."""
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0] if action.slots else None
    bpy.context.view_layer.update()


def _hold_pose(arm, keep_height):
    """Zero the Hips' HORIZONTAL travel in armature space, leaving its height
    alone, then return the resulting pose.

    This is what makes a single crawl frame usable as a held clip. The
    supplied crawl has root motion (see the module docstring), so the frame
    chosen for `down` sits over a metre in front of where the figure started
    -- and a mesh unit's root is placed at its entity's own tile, so that
    offset would draw the civilian a third of a tile away from itself, at
    every zoom, for as long as it stayed pinned.

    `pose_bone.matrix` is armature space and Blender's setter computes the
    basis for us; Hips is a root bone, so there is no parent chain to
    re-evaluate first. The vertical component is deliberately KEPT: it is the
    pelvis dropping from standing height to crawling height, which is most of
    what makes the pose read."""
    pb = arm.pose.bones["Hips"]
    rest = arm.data.bones["Hips"].matrix_local.translation
    m = pb.matrix.copy()
    m.translation = Vector((rest.x, rest.y, m.translation.z if keep_height else rest.z))
    pb.matrix = m
    bpy.context.view_layer.update()
    return _capture(arm)


def sample_supplied(arm, action):
    """Every frame of a supplied clip, replayed on `arm`. A thin wrapper over
    `import_meshy_soldier.sample_clip` so this file has one name for "turn a
    clip into frames" regardless of whether it came from a file or a
    retarget."""
    return soldier.sample_clip(arm, action)


def sample_held(arm, action, seconds):
    """`HELD_FRAMES` copies of one frame of `action`, at `seconds` into it,
    with the root's horizontal travel removed."""
    _bind_action(arm, action)
    fps = bpy.context.scene.render.fps
    frame = action.frame_range[0] + seconds * fps
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))
    bpy.context.view_layer.update()
    pose = _hold_pose(arm, keep_height=True)
    return [pose for _ in range(HELD_FRAMES)]


# --- retarget ---------------------------------------------------------------

def _armature_space_quats(arm, at_rest):
    """`{bone: (x, y, z, w)}` in ARMATURE space -- the pose if `at_rest` is
    False, the rest orientation if it is. `mathutils.Quaternion` is
    `(w, x, y, z)`; `civilian_retarget` is `(x, y, z, w)`, so the conversion
    happens here, once, at the boundary."""
    out = {}
    for pb in arm.pose.bones:
        source = arm.data.bones[pb.name].matrix_local if at_rest else pb.matrix
        q = source.to_quaternion()
        out[pb.name] = (q.x, q.y, q.z, q.w)
    return out


def _parents(arm):
    return {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}


def retarget_frames(donor_arm, donor_action, target_arm, height_ratio, held_seconds=None):
    """The donor's motion, expressed on the target rig.

    Rotations go through `civilian_retarget.retarget_local` -- an
    armature-space delta-from-rest transfer, which is what makes this valid
    between rigs whose rest bone frames differ by up to 45 degrees (measured;
    see that module). The root's TRANSLATION is handled here rather than
    there: its delta from rest is taken in armature space, scaled by
    `height_ratio`, and added to the TARGET's own rest position, so a 1.20 m
    child driven by a 1.64 m donor neither floats nor sinks.

    `held_seconds` builds a held pose from one frame instead of the whole
    clip -- the child's `down`, the same shape `sample_held` gives an adult."""
    _bind_action(donor_arm, donor_action)
    donor_rest = _armature_space_quats(donor_arm, at_rest=True)
    target_rest = _armature_space_quats(target_arm, at_rest=True)
    parents = _parents(target_arm)

    donor_hips_rest = donor_arm.data.bones["Hips"].matrix_local.translation.copy()
    target_hips_rest = target_arm.data.bones["Hips"].matrix_local.translation.copy()

    f0, f1 = donor_action.frame_range
    if held_seconds is None:
        n_steps = max(1, round(f1 - f0))
        times = [f0 + (f1 - f0) * step / n_steps for step in range(n_steps + 1)]
    else:
        times = [f0 + held_seconds * bpy.context.scene.render.fps]

    frames = []
    for t in times:
        bpy.context.scene.frame_set(int(t), subframe=t - int(t))
        bpy.context.view_layer.update()

        donor_pose = _armature_space_quats(donor_arm, at_rest=False)
        basis = retarget.retarget_local(donor_pose, donor_rest, target_rest, parents)
        for pb in target_arm.pose.bones:
            x, y, z, w = basis[pb.name]
            pb.rotation_quaternion = Quaternion((w, x, y, z))
            pb.location = Vector((0.0, 0.0, 0.0))
            pb.scale = Vector((1.0, 1.0, 1.0))
        bpy.context.view_layer.update()

        hips_delta = donor_arm.pose.bones["Hips"].matrix.translation - donor_hips_rest
        want = target_hips_rest + hips_delta * height_ratio
        pb = target_arm.pose.bones["Hips"]
        m = pb.matrix.copy()
        m.translation = want
        pb.matrix = m
        bpy.context.view_layer.update()

        if held_seconds is None:
            frames.append(_capture(target_arm))
        else:
            frames.append(_hold_pose(target_arm, keep_height=True))

    if held_seconds is not None:
        frames = [frames[0] for _ in range(HELD_FRAMES)]
    return frames


# --- clip semantics ----------------------------------------------------------

def hips_travel(frames, hips_rest, arm_world):
    """`(horizontal, vertical)` travel of the Hips bone across `frames`, in
    centimetres -- the same "compose the sampled basis back through the bone's
    own rest matrix, then through the armature's world matrix" formula
    `import_meshy_soldier._hips_world_z_travel` documents at length (reading
    `pb.location` raw is 7x wrong, and its docstring records why).

    Both axes, not just the vertical one that file measures: the failure this
    gate exists to catch here is a `down` clip that CRAWLS, which is
    horizontal travel and would pass a vertical-only bound untouched."""
    xs, ys, zs = [], [], []
    for f in frames:
        q, loc, sc = f["Hips"]
        basis = Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))
        t = (arm_world @ (hips_rest @ basis)).translation
        xs.append(t.x)
        ys.append(t.y)
        zs.append(t.z)
    flat = math.hypot(max(xs) - min(xs), max(ys) - min(ys)) * 100.0
    return flat, (max(zs) - min(zs)) * 100.0


def check_clip_semantics(figure, frames_by_clip, hips_rest, arm_world):
    """Enforce `CIVILIAN_CLIP_SEMANTICS` at build time, before the expensive
    per-clip export and merge run. Raises loudly, naming the clip and both
    numbers, rather than shipping a clip whose motion contradicts its name."""
    for clip in CLIP_ORDER:
        flat, rise = hips_travel(frames_by_clip[clip], hips_rest, arm_world)
        rule = CIVILIAN_CLIP_SEMANTICS[clip]
        print(f"  {figure}/{clip}: Hips travel flat={flat:.3f} cm rise={rise:.3f} cm")
        for axis, value in (("flat", flat), ("rise", rise)):
            ceiling = rule[axis]
            if ceiling is not None and value > ceiling:
                raise RuntimeError(
                    f"{figure}/{clip}: Hips {axis} travel {value:.3f} cm exceeds "
                    f"{ceiling:.3f} -- CIVILIAN_CLIP_SEMANTICS['{clip}']['means'] = "
                    f"{rule['means']!r}"
                )


# --- clip writing ------------------------------------------------------------

def write_clip(arm, clip_name, frames):
    """Key `frames` onto `arm` under one new action named exactly
    `clip_name` -- the canonical name the contract and `mesh-anim.ts`'s
    `isMeshClipName` both require.

    Simpler than `import_meshy_soldier.write_combined_clip` because there is
    nothing to combine: a civilian is ONE figure, not a three-man team, so
    there are no `f0_`/`f1_`/`f2_` bone prefixes and no per-figure gait phase
    offset to desynchronise (that exists to stop three men in one GLB
    marching in lockstep; four separate GLBs playing on four independently
    spawned mixers are already out of phase with each other by construction).
    """
    action = bpy.data.actions.new(clip_name)
    action.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    # Blender 4.4+ slotted actions: `.action_slot` is a separate pointer and
    # reassigning `.action` does not clear it. Clearing forces a fresh slot to
    # bind on the first `keyframe_insert` below -- see `write_combined_clip`'s
    # own comment for the stale-slot failure this avoids.
    arm.animation_data.action_slot = None

    for step, pose in enumerate(frames):
        for name, (q, loc, sc) in pose.items():
            pb = arm.pose.bones[name]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.scale = sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=step)
            pb.keyframe_insert(data_path="location", frame=step)
            pb.keyframe_insert(data_path="scale", frame=step)

    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = max(1, len(frames) - 1)
    return action


# --- one figure --------------------------------------------------------------

def import_donor(figure):
    """Import a donor figure's armature (and nothing else) plus the actions
    the child needs from it.

    Unlike `import_meshy_soldier.import_clip`, which keeps only the action,
    the donor's ARMATURE has to survive: the retarget reads its rest matrices
    and its evaluated pose, neither of which an action alone carries."""
    arm = None
    actions = {}
    for clip in FIGURES["civilian_child"]["donor_clips"]:
        path = source_path(figure, clip)
        if path is None:
            raise RuntimeError(f"donor {figure} has no source for {clip!r}")
        if arm is None:
            arm, mesh, action = soldier.import_base_clip(path, f"donor_{clip}_src")
            bpy.data.objects.remove(mesh, do_unlink=True)
            arm.name = "donor_armature"
        else:
            action = soldier.import_clip(path, f"donor_{clip}_src")
        actions[clip] = action
    return arm, actions


def figure_height(mesh_obj):
    """Standing height in METRES.

    Through `matrix_world`, not off `vertex.co` directly: these sources are
    authored in centimetres with a 0.01 scale on the object, so raw local
    coordinates give 175 for a 1.75 m man. Reading them raw made the child's
    donor height ratio come out as 73.171 instead of 0.732, which multiplied
    the retargeted idle's root motion by that factor and walked the child four
    metres off its own tile -- caught by `CIVILIAN_CLIP_SEMANTICS` only
    because that gate measures the flat axis too."""
    zs = [(mesh_obj.matrix_world @ v.co).z for v in mesh_obj.data.vertices]
    return max(zs) - min(zs)


#: Standing height in metres per donor figure, measured off the supplied mesh
#: -- the denominator of the child's Hips translation scale. Pinned rather
#: than measured at build time because the donor's mesh is deleted right
#: after its armature is imported (the retarget needs the rig, not the body),
#: and re-importing 24 MB of texture to read one bounding box would be a poor
#: trade for a number that cannot change without the source changing.
DONOR_HEIGHTS = {"civilian_woman": 1.640}


def build_figure(figure, print_islands=False):
    """Build and write `art/meshes/civilians/<figure>.glb`."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Before the first import -- see SOURCE_FPS.
    bpy.context.scene.render.fps = SOURCE_FPS
    bpy.context.scene.render.fps_base = 1.0
    spec = FIGURES[figure]

    # --- 1. import. `move` is always supplied, so its file is the base: it
    # brings the mesh and the armature every other clip is replayed onto.
    scratch_arm, scratch_mesh, move_src = soldier.import_base_clip(
        source_path(figure, "move"), "move_src"
    )
    src_actions = {"move": move_src}
    for clip in ("idle", "down"):
        path = source_path(figure, clip)
        if path is not None:
            src_actions[clip] = soldier.import_clip(path, f"{clip}_src")

    # --- 2. roles, from the mesh's own islands and its own texture. Runs
    # BEFORE the material is stripped -- the material is the only route to
    # the texture (`sample_vertex_colours`).
    positions, triangles, colours, bones = mesh_inputs(scratch_mesh)
    if print_islands:
        keys = roles.island_keys(positions, triangles, bones)
        print(f"\n### {figure}: {len(keys)} islands, {len(positions)} verts")
        for key in sorted(keys, key=lambda k: (k[0], k[1])):
            print(f"    {key!r}: {len(keys[key])} verts")
        return None
    vertex_roles = roles.classify(figure, positions, triangles, colours, bones)
    counts = {r: vertex_roles.count(r) for r in sorted(set(vertex_roles))}
    total = len(vertex_roles)
    print(
        f"{figure}: {total} verts -- "
        + ", ".join(f"{r}={n} ({n / total:.1%})" for r, n in counts.items())
    )

    # --- 3. zero materials (the contract's own "not negotiable").
    scratch_mesh.data.materials.clear()

    hips_rest = scratch_arm.data.bones["Hips"].matrix_local.copy()
    arm_world = scratch_arm.matrix_world.copy()

    # --- 4. frames per clip. Supplied clips are replayed; the child's two
    # missing ones are retargeted from the donor. `down` is always held.
    frames_by_clip = {}
    donor_arm = None
    for clip in CLIP_ORDER:
        if clip in src_actions:
            if clip == "down":
                frames_by_clip[clip] = sample_held(
                    scratch_arm, src_actions[clip], DOWN_FRAME_SECONDS[figure]
                )
            else:
                frames_by_clip[clip] = sample_supplied(scratch_arm, src_actions[clip])
            continue

        donor_name = spec.get("donor")
        if donor_name is None:
            raise RuntimeError(f"{figure}: no source for {clip!r} and no donor declared")
        if donor_arm is None:
            donor_arm, donor_actions = import_donor(donor_name)
        ratio = figure_height(scratch_mesh) / DONOR_HEIGHTS[donor_name]
        frames_by_clip[clip] = retarget_frames(
            donor_arm,
            donor_actions[clip],
            scratch_arm,
            ratio,
            held_seconds=DOWN_FRAME_SECONDS[donor_name] if clip == "down" else None,
        )
        print(f"  {figure}/{clip}: retargeted from {donor_name} (height ratio {ratio:.3f})")

    # --- 5. semantics, before any export work.
    check_clip_semantics(figure, frames_by_clip, hips_rest, arm_world)

    # --- 6. every `*_src` action must be gone before the clips are written.
    # `sample_clip`/`retarget_frames` already turned each into plain data, and
    # the glTF exporter's ACTIONS mode exports every action COMPATIBLE with
    # the object, not just the assigned one -- see `export_glb`'s docstring.
    scratch_arm.animation_data.action = None
    if donor_arm is not None:
        bpy.data.objects.remove(donor_arm, do_unlink=True)
    for action in list(bpy.data.actions):
        action.use_fake_user = False
        bpy.data.actions.remove(action)

    # --- 7. split the mesh into one object per role.
    role_meshes = soldier.separate_by_role(scratch_mesh, vertex_roles)
    # A role can be assigned to vertices without owning a single whole
    # TRIANGLE -- `separate_by_role` selects by vertex, so a role that only
    # ever appears on the boundary between two others separates into an
    # object with geometry Blender's exporter then omits ("Mesh 'x' has no
    # primitives and will be omitted"). Dropping those here rather than
    # letting the exporter drop them keeps the role list this prints, and the
    # role list the shipped GLB carries, the same thing.
    empty = [r for r, obj in role_meshes.items() if not obj.data.polygons]
    for role in empty:
        bpy.data.objects.remove(role_meshes.pop(role), do_unlink=True)
    if empty:
        print(f"  {figure}: dropped role(s) with no whole triangle: {sorted(empty)}")
    for role, obj in role_meshes.items():
        obj.name = role
        obj.data.name = role
    print(f"  {figure}: roles present {sorted(role_meshes)}")

    # --- 8. write + export each clip ALONE, one export call per clip, then
    # merge in pure Python -- `export_glb`'s own docstring records why more
    # than one action on the armature at export time silently collapses every
    # clip to two identical keyframes.
    tmp_dir = tempfile.mkdtemp(prefix=f"civilian_{figure}_")
    clip_paths = {}
    for clip in CLIP_ORDER:
        action = write_clip(scratch_arm, clip, frames_by_clip[clip])
        tmp_path = os.path.join(tmp_dir, f"{clip}.glb")
        soldier.export_glb(scratch_arm, tmp_path)
        clip_paths[clip] = tmp_path
        scratch_arm.animation_data.action = None
        action.use_fake_user = False
        bpy.data.actions.remove(action)

    out_path = os.path.join(OUT_DIR, f"{figure}.glb")
    soldier.merge_clip_glbs(
        {name: clip_paths[name] for name in CLIP_ORDER},
        out_path,
        forward_fix_deg=FORWARD_FIX_DEG,
    )
    for path in clip_paths.values():
        os.remove(path)
    os.rmdir(tmp_dir)

    verts = sum(len(m.data.vertices) for m in role_meshes.values())
    print(
        f"  wrote {out_path} ({os.path.getsize(out_path)} bytes), "
        f"clips={list(CLIP_ORDER)}, roles={sorted(role_meshes)}, verts={verts}"
    )
    return out_path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="build one figure instead of all four")
    ap.add_argument(
        "--islands",
        action="store_true",
        help="print each figure's island table and build nothing -- what a re-supplied "
             "source is measured with before civilian_roles.FIGURES is updated",
    )
    args = ap.parse_args(argv)

    os.makedirs(OUT_DIR, exist_ok=True)
    names = [args.only] if args.only else list(FIGURES)
    unknown = [n for n in names if n not in FIGURES]
    if unknown:
        raise SystemExit(f"unknown figure(s) {unknown}; known: {sorted(FIGURES)}")

    for figure in names:
        build_figure(figure, print_islands=args.islands)


if __name__ == "__main__":
    main()
