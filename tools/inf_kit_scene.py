"""Load a shipped infantry team GLB into a Blender scene for the kit render.

Blender-only. Shared by `units/inf_kit.py` (fits the parts against the bind
pose) and `render_inf_kit.py` (poses and photographs them).
"""
import os
import sys

import bpy

GLB = "art/meshes/{team}.glb"
FIGURES = ("f0", "f1", "f2")

# A GLB carries zero materials; the game colours a PALETTE primitive (no UVs) from a gunmetal slice of
# `data/palette.json` (mesh-role.ts: `weapon` and `metal` ramp slice 2..4, `charge` slice 1..3). The
# approval render stands in the LIT end of that slice as the albedo (the way an atlas texel is an albedo here):
# gunmetal.2 for weapon and metal, gunmetal.1 for the charge.
PALETTE_PRIM_COLOUR = {"weapon": "#5C625F", "metal": "#5C625F", "charge": "#8E9491"}

# The squad's centre on the ground, from the shipped bind pose (figures stand
# at x -0.37 / 0.5 / -0.37 and y -1.04 / 0.0 / 1.05).
SQUAD_CENTRE = (0.0, 0.0, 0.0)


def load_squad(repo, team="inf_squad"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(repo, GLB.format(team=team)), import_scene_extras=True)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.parent is None and o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o)
    # Main's team GLB already carries the PR 885 kit (`kit_uniform`, `kit_weapon`
    # grafted nodes). The redesign builds its own parts on the BASE figure, so
    # drop them: the base primitives are byte-identical to the pre-graft file.
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name.startswith("kit_"):
            bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
    # one material in the file: the textured bake. Set it to the game's
    # cloth-ish surface (unit-surface.ts: roughness 0.8-0.92, no metal).
    mat = bpy.data.materials["BakedMaterial"]
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    mat.use_backface_culling = False
    # palette primitives (no UVs, no material in the file): the colour the game gives them, flat
    for name, ob in meshes.items():
        if name in PALETTE_PRIM_COLOUR and not ob.data.materials:
            h = PALETTE_PRIM_COLOUR[name].lstrip("#")
            lin = [((int(h[i:i + 2], 16) / 255.0) / 12.92 if int(h[i:i + 2], 16) / 255.0 <= 0.04045
                    else ((int(h[i:i + 2], 16) / 255.0 + 0.055) / 1.055) ** 2.4) for i in (0, 2, 4)]
            pm = bpy.data.materials.new(f"pal_{name}")
            pm.use_nodes = True
            b = pm.node_tree.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = (*lin, 1.0)
            b.inputs["Roughness"].default_value = 0.6
            b.inputs["Metallic"].default_value = 0.0
            b.inputs["Specular IOR Level"].default_value = 0.35
            ob.data.materials.append(pm)
    return arm, meshes, mat


def clip_keys(act, step, dense=False):
    """Frames of `act` to sample: every integer frame on the stride, every keyframe (rounded to an integer, as the
    Rifle Squad's census always did), and with `dense` also the exact (fractional) keyframes of a clip of 8 frames or
    fewer and the clip's last frame, which an integer cap silently drops (kneelIn / kneelOut run 0..4.8).
    Returns (sorted list of floats, first frame)."""
    frames = set()
    try:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    for fc in cb.fcurves:
                        for kp_ in fc.keyframe_points:
                            frames.add(int(round(kp_.co[0])))
                            if dense and act.frame_range[1] - act.frame_range[0] <= 8.0:
                                frames.add(round(float(kp_.co[0]), 3))
    except AttributeError:
        for fc in getattr(act, "fcurves", []):
            for kp_ in fc.keyframe_points:
                frames.add(int(round(kp_.co[0])))
    flo, fhi = act.frame_range
    lo, hi = int(flo), int(fhi)
    frames |= set(range(lo, hi + 1, max(1, step)))
    if dense:
        frames.add(round(float(fhi), 3))
    return sorted(f for f in frames if flo <= f <= fhi + 1e-6), lo


def set_frame(frame):
    """`scene.frame_set` for a fractional frame."""
    f = float(frame)
    bpy.context.scene.frame_set(int(f // 1), subframe=f - (f // 1))


def pose(arm, clip, frame=0):
    """Pose the armature at `clip` frame `frame` (0-based from the clip start)."""
    if clip is None:
        arm.data.pose_position = "REST"
        bpy.context.view_layer.update()
        return
    arm.data.pose_position = "POSE"
    act = bpy.data.actions[clip]
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    # Blender 4.4+ slotted actions: a stale slot leaves the rig un-posed.
    arm.animation_data.action_slot = act.slots[0] if act.slots else None
    bpy.context.scene.frame_set(int(act.frame_range[0]) + frame)
    bpy.context.view_layer.update()
    # Freeze: the pose bones keep what the clip just wrote, and a later edit
    # (isolating one figure) is not overwritten by the next evaluation.
    arm.animation_data.action = None
    bpy.context.view_layer.update()
