"""Load the shipped inf_squad GLB into a Blender scene for the kit render.

Blender-only. Shared by `units/inf_kit.py` (fits the parts against the bind
pose) and `render_inf_kit.py` (poses and photographs them).
"""
import os
import sys

import bpy

GLB = "art/meshes/inf_squad.glb"
FIGURES = ("f0", "f1", "f2")

# The squad's centre on the ground, from the shipped bind pose (figures stand
# at x -0.37 / 0.5 / -0.37 and y -1.04 / 0.0 / 1.05).
SQUAD_CENTRE = (0.0, 0.0, 0.0)


def load_squad(repo):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(repo, GLB), import_scene_extras=True)
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
    return arm, meshes, mat


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
