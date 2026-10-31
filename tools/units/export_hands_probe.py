"""The hand generator's own output, on bones, in a GLB (GH-826 F1, step 1).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/units/export_hands_probe.py [-- OUT_DIR]

Writes `art/parts/hands/hands_probe.glb` and its source `hands_probe.blend`. It is a PART for
the checks, not a unit: nothing draws it. Each hand of `hands.py` hangs at its figure's wrist
height (S = 1.778) on the bones the real pass will add,

    {prefix}_forearm_{L|R}   head at the elbow, 0.268 above the wrist crease
    {prefix}_hand_{L|R}      a child of the forearm, head at the wrist crease, rigid weight 1.0

named as the Meshy rigs name them (`_L` is the figure's anatomical RIGHT hand, so the firing
hand is `_L`). The corpse fist binds to `{prefix}_death_root`. So `tools/src/mesh_hands.ts`
reads the probe with the same code that will read a figure.

  p0  grip (anatomical right, firing) + the trigger finger as its own part on `p0_finger_L`
  p1  support (anatomical left)
  p2  handle (anatomical left, the Breach point man's shield hand)
  p3  the corpse fist (anatomical right), on `p3_death_root`

Deterministic: no noise of any kind. Procedural geometry, not AI-generated, 0 Meshy credits.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hands as H  # noqa: E402
import hands_blender as HB  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT_OUT = os.path.join(REPO, "art", "parts", "hands")
STATURE = 1.778
ELBOW_Z = 0.615 * STATURE             # the spec's hung elbow height
FOREARM = 0.268
SPACING = 0.40


def hang_matrix(side, x):
    """Hand-local -> Blender world for a hand hanging at the figure's side (y_h down, thumb forward)."""
    if side == "R":      # anatomical right: lateral = -x of a figure facing -y
        cols = ((0, 1, 0), (0, 0, -1), (-1, 0, 0))
    else:
        cols = ((0, -1, 0), (0, 0, -1), (1, 0, 0))
    M = Matrix.Identity(4)
    for j, c in enumerate(cols):
        for i in range(3):
            M[i][j] = c[i]
    M[0][3], M[2][3] = x, ELBOW_Z - FOREARM
    return M


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = argv[0] if argv else DEFAULT_OUT
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm_data = bpy.data.armatures.new("hands_probe")
    arm = bpy.data.objects.new("hands_probe", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    specs = [("p0", "grip", "R", "L"), ("p1", "support", "L", "R"), ("p2", "handle", "L", "R"), ("p3", "fist", "R", "L")]
    placed = []
    for k, (pf, pose, anat, bside) in enumerate(specs):
        x = (k - 1.5) * SPACING
        wrist = Vector((x, 0.0, ELBOW_Z - FOREARM))
        if pose != "fist":
            fa = arm_data.edit_bones.new(f"{pf}_forearm_{bside}")
            fa.head, fa.tail = wrist + Vector((0, 0, FOREARM)), wrist
            hb = arm_data.edit_bones.new(f"{pf}_hand_{bside}")
            hb.head, hb.tail = wrist, wrist + Vector((0, 0, -0.11))
            # the bone's frame IS the hand's: x across the palm, y distal, z dorsal (what the hands pass authors)
            hb.matrix = hang_matrix(anat, x)
            hb.parent = fa
            if pose == "grip":
                fb = arm_data.edit_bones.new(f"{pf}_finger_{bside}")
                # the trigger finger's knuckle (index, abducted), in world
                fb.head = hang_matrix(anat, x) @ Vector((H.FINGER_X[0] * (1 if anat == 'R' else -1), H.KNUCKLE_Y[0], H.FINGER_Z))
                fb.tail = fb.head + Vector((0, 0, -0.08))
                fb.matrix = hang_matrix(anat, x) @ Matrix.Translation((H.FINGER_X[0] * (1 if anat == 'R' else -1), H.KNUCKLE_Y[0], H.FINGER_Z))
                fb.parent = hb
        else:
            db = arm_data.edit_bones.new(f"{pf}_death_root")
            db.head, db.tail = wrist, wrist + Vector((0, 0, -0.1))
        placed.append((pf, pose, anat, bside, x))
    bpy.ops.object.mode_set(mode="OBJECT")
    summary = []
    for pf, pose, anat, bside, x in placed:
        hand = H.build("x", anat, kind="fist") if pose == "fist" else H.build(pose, anat, S=STATURE)
        M = hang_matrix(anat, x)
        parts = [("hand", None)]
        if pose == "grip":
            parts = [("hand", "index"), ("finger", "index")]
        for kind, grp in parts:
            sel = [i for i, g in enumerate(hand["groups"]) if (g == "index") == (kind == "finger")]
            sub = dict(hand, tris=hand["tris"][sel], groups=[hand["groups"][i] for i in sel])
            if not len(sel):
                continue
            name = f"{pf}_{pose}_{kind}"
            ob = HB.to_object(sub, name, uv=(0.5, 0.5))
            ob.data.transform(M)
            ob.parent = arm
            bone = (f"{pf}_death_root" if pose == "fist" else (f"{pf}_finger_{bside}" if kind == "finger" else f"{pf}_hand_{bside}"))
            vg = ob.vertex_groups.new(name=bone)
            vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
            mod = ob.modifiers.new("Armature", "ARMATURE")
            mod.object = arm
            ob["rl_role"] = "uniform"
        summary.append((pf, pose, anat, hand["triangles"], hand["by_group"]))
    for line in summary:
        print(f"[hands_probe] {line}")
    blend = os.path.join(out_dir, "hands_probe.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.object.select_all(action="SELECT")
    glb = os.path.join(out_dir, "hands_probe.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_skins=True,
                              export_materials="NONE", export_extras=True, export_animations=False, export_apply=False)
    print(f"[hands_probe] wrote {glb} ({os.path.getsize(glb)} bytes) and {blend}")


if __name__ == "__main__":
    main()
