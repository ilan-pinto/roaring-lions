"""Extract the motion-captured clips of the three pre-B7 Meshy bipeds into
compact JSON, so `tools/units/mocap.py` can retarget them onto the textured
rig.py figures that replaced them (the B7 motion regression, 2026-10-05).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/extract_mocap.py

Reads each source GLB straight out of git history -- `meshy_soldier.glb`,
`sarim_rifles.glb` and `yahalom_engineer.glb` as they stood at `e31ebdf3`,
the last commit before B7 (#335/#337) deleted or replaced them -- and writes
`art/mocap/<source>.json`. Nothing on disk under `art/meshes/` is read or
touched. AI-generated (Meshy rig + animation library), disclosed per
CONTRIBUTING.md; the clips are the ones those files shipped with.

What is written, per clip and per figure (`f0`, `f1`, `f2`): every mapped
bone's WORLD rotation per frame as a quaternion (w, x, y, z), in Blender's
own frame after import -- Z up, the figure facing +X, its left at +Y -- and
`Hips`' world position per frame. Plus each bone's REST world rotation and
head position, so the retarget can form `delta = world(t) * rest^-1` without
re-importing anything. World rather than local on purpose: the source chain
(Hips > Spine02 > Spine01 > Spine > shoulders) and the target chain (pelvis >
spine > upperarm) do not match bone for bone, and a world rotation is the one
quantity both sides agree on.
"""
import json
import os
import subprocess
import sys
import tempfile

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(REPO, "art", "mocap")

#: The last commit before B7 replaced these files (#335 4071c95f, #337 632e04ba).
SOURCE_REV = "e31ebdf3"
SOURCES = ("meshy_soldier", "sarim_rifles", "yahalom_engineer")

BONES = (
    "Hips", "Spine02", "Spine01", "Spine", "neck", "Head",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
)
DIGITS = 5


def _q(m):
    _loc, rot, _scale = m.decompose()
    q = rot.normalized()
    if q.w < 0.0:   # one hemisphere, so a reader may lerp neighbouring frames
        q = -q
    return [round(v, DIGITS) for v in (q.w, q.x, q.y, q.z)]


def _v(m):
    return [round(v, DIGITS) for v in m.translation]


def extract(name):
    blob = subprocess.check_output(["git", "-C", REPO, "show", f"{SOURCE_REV}:art/meshes/{name}.glb"])
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as fh:
        fh.write(blob)
        path = fh.name
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    os.unlink(path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    W = arm.matrix_world
    figures = sorted({b.name.split("_", 1)[0] for b in arm.data.bones if b.name.endswith("_Hips")})
    rest = {}
    for fig in figures:
        rest[fig] = {
            b: {"q": _q(W @ arm.data.bones[f"{fig}_{b}"].matrix_local),
                "head": _v(W @ arm.data.bones[f"{fig}_{b}"].matrix_local)}
            for b in BONES
        }
    sc = bpy.context.scene
    clips = {}
    for act in sorted(bpy.data.actions, key=lambda a: a.name):
        arm.animation_data.action = act
        if arm.animation_data.action_slot is None and act.slots:
            arm.animation_data.action_slot = act.slots[0]
        f0, f1 = (int(round(v)) for v in act.frame_range)
        frames = {fig: {b: [] for b in BONES} for fig in figures}
        hips = {fig: [] for fig in figures}
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            for fig in figures:
                for b in BONES:
                    frames[fig][b].append(_q(W @ arm.pose.bones[f"{fig}_{b}"].matrix))
                hips[fig].append(_v(W @ arm.pose.bones[f"{fig}_Hips"].matrix))
        clips[act.name] = {"frames": f1 - f0 + 1, "rot": frames, "hips": hips}
        print(f"[mocap] {name} {act.name}: {f1 - f0 + 1} frames, {len(figures)} figures")
    doc = {
        "source": f"git show {SOURCE_REV}:art/meshes/{name}.glb",
        "fps": sc.render.fps,
        "frame": "Blender world after glTF import: Z up, figures face +X, their left at +Y",
        "figures": figures,
        "bones": list(BONES),
        "rest": rest,
        "clips": clips,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{name}.json")
    with open(out, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), sort_keys=True)
        fh.write("\n")
    print(f"[mocap] wrote {out} ({os.path.getsize(out)} bytes)")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for name in argv or SOURCES:
        extract(name)


if __name__ == "__main__":
    main()
