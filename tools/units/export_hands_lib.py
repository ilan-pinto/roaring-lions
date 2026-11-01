"""The hand library the hands pass grafts (GH-826 step 2).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/units/export_hands_lib.py [-- OUT_DIR]

Writes `art/parts/hands/hands_lib.glb` and its source `hands_lib.blend`: the generator's (`hands.py`) living and
corpse hands, each in its OWN hand-local frame (wrist crease at the origin, +y distal, +z dorsal; the left hand
is the right one mirrored), UNSKINNED, with smooth normals and every UV on one texel (the pass re-pins it to
the team's glove texel). Because the frame is the hand's, the file is written with `export_yup=False`: the
numbers in it are the hand-local numbers, whatever axes the figure uses.

    inf_grip_R          the firing hand's palm, three fingers, thumb, cuff (anatomical right, bone `_L`)
    inf_grip_R_index    its trigger finger, a part of its own (the `{prefix}_finger_L` bone)
    inf_support_L       the support hand (anatomical left, bone `_R`), closed on the handguard's real section
    inf_fist_R/_L       the corpse fists

Scene extras `rl_hands_lib` (a JSON string): per hand, the transform that places it on the reshaped carbine
part (hand-local -> part frame: x forward, y across, z up) as `hands_fit.py` solved it, the trigger finger's
pivot and axis, and the numbers the checks quote. Procedural, deterministic, no `mathutils.noise`, 0 Meshy.
"""
import json
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hands as H  # noqa: E402
import hands_blender as HB  # noqa: E402
import hands_fit as F  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT_OUT = os.path.join(REPO, "art", "parts", "hands")


def split(hand, want_index):
    keep = [(g == "index") == want_index for g in hand["groups"]]
    return dict(hand, tris=hand["tris"][keep], groups=[g for g, k in zip(hand["groups"], keep) if k])


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = argv[0] if argv else DEFAULT_OUT
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lib = {"version": 1, "stations": {}, "notes": "hand-local -> part frame (x forward, y across, z up), metres"}
    hg, Rg, tg = F.place_grip("R")
    hs, Rs, ts = F.place_support()
    parts = [("inf_grip_R", split(hg, False), "grip", "R"), ("inf_grip_R_index", split(hg, True), "grip", "R_index"),
             ("inf_support_L", hs, "support", "L"),
             ("inf_fist_R", H.build("x", "R", kind="fist"), "fist", "R"), ("inf_fist_L", H.build("x", "L", kind="fist"), "fist", "L")]
    for name, hand, pose, side in parts:
        ob = HB.to_object(hand, name, uv=(0.5, 0.5))
        ob["rl_hand"] = json.dumps({"pose": pose, "side": side, "triangles": int(len(hand["tris"]))})
    sgn = 1.0
    K = np.array((H.FINGER_X[0] * sgn, H.KNUCKLE_Y[0], H.FINGER_Z))
    al = np.radians(H.POSES["grip"]["index_abd"])
    ref_g = H.grasp_frame(hg)[2]
    ref_s = H.grasp_frame(hs)[2]
    lib["stations"]["grip"] = {"R": Rg.tolist(), "t": tg.tolist(), "x_ref": hg["x_ref"], "ref": [float(v) for v in ref_g], "proxy": hg["proxy"].describe(),
                               "finger": {"pivot": K.tolist(), "axis": [float(np.cos(al)), float(np.sin(al)), 0.0],
                                          "trigger_deg": H.POSES["grip"]["index_trigger_deg"]}}
    lib["stations"]["support"] = {"R": Rs.tolist(), "t": ts.tolist(), "x_ref": hs["x_ref"], "ref": [float(v) for v in ref_s], "proxy": hs["proxy"].describe()}
    lib["triangles"] = {"living": int(hg["triangles"]), "fist": int(H.build("x", "R", kind="fist")["triangles"])}
    lib["hand_length_m"] = H.hand_length_extended()
    lib["palm_breadth_m"] = H.PALM_BREADTH
    bpy.context.scene["rl_hands_lib"] = json.dumps(lib, sort_keys=True)
    blend = os.path.join(out_dir, "hands_lib.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.object.select_all(action="SELECT")
    glb = os.path.join(out_dir, "hands_lib.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_yup=False, export_materials="NONE",
                              export_extras=True, export_animations=False, export_skins=False)
    print(f"[hands_lib] wrote {glb} ({os.path.getsize(glb)} bytes) and {blend}")
    print(f"[hands_lib] grip wrist in the part frame {np.round(tg, 4).tolist()}, support wrist {np.round(ts, 4).tolist()}")


if __name__ == "__main__":
    main()
