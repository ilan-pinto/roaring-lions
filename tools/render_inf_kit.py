"""Approval render 1 for the infantry upgrade kit (GH-826): `inf_squad`.

    blender -b -P tools/render_inf_kit.py -- --out <dir> --mode build|turntable|grid|close \\
        [--figure f1] [--tiers a,s,f]

Blender only, no browser, no Meshy. Imports the SHIPPED art/meshes/inf_squad.glb,
adds the kit (`units/inf_kit.py`), poses `idle` frame 0 and photographs it in
the game's camera and light (`inf_kit_stage.py`). The object turns (the squad's
parent empty); the camera and the sun never do.

Frames are written as 8-bit PNGs, tone-mapped the way the game's OutputPass
does (ACES, exposure 1.0). `tools/inf_kit_sheet.py` (plain python3 + PIL)
lays them into the contact sheet.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import inf_kit  # noqa: E402
import inf_kit_parts as kp  # noqa: E402
import inf_kit_scene as scn  # noqa: E402
import inf_kit_stage as st  # noqa: E402

# (label, {track: tier}) -- the eleven states of the approval grid.
STATES = [("none", {})] + [
    (f"{t[0]}{n}", {t: n}) for t in kp.TRACKS for n in (1, 2, 3)
] + [("full", {t: 3 for t in kp.TRACKS})]


def isolate(arm, keep):
    """Send every figure but `keep` far below the ground (a pose offset on its
    root bone), so a close-up is one soldier, not three overlapping."""
    from mathutils import Matrix, Vector
    for pf in kp.ALL:
        if pf == keep:
            continue
        pb = arm.pose.bones[f"{pf}_root"]
        pb.matrix = Matrix.Translation(Vector((0, 0, -40.0))) @ pb.matrix
    bpy.context.view_layer.update()


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {}
    for i in range(0, len(argv) - 1, 2):
        a[argv[i].lstrip("-")] = argv[i + 1]
    return a


def main():
    a = parse()
    out = os.path.abspath(a["out"])
    os.makedirs(out, exist_ok=True)
    mode = a.get("mode", "build")
    arm, meshes, mat = scn.load_squad(REPO)
    rows = inf_kit.build(REPO, arm, meshes, mat)
    turn = bpy.data.objects.new("turn", None)
    bpy.context.collection.objects.link(turn)
    arm.parent = turn
    report = {}
    for ob, part, pf, tris in rows:
        report.setdefault(part.name, {})[ob.name] = tris
    with open(os.path.join(out, "tris.json"), "w") as fh:
        json.dump(report, fh, indent=1, sort_keys=True)
    scn.pose(arm, a.get("pose", "idle") if a.get("pose", "idle") != "rest" else None, 0)
    samples = int(a.get("samples", 96))
    if mode == "build":
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "inf_squad_kit.blend"))
        return
    if mode == "census":
        # nothing a living team draws is under the ground: lowest kit vertex per clip
        import numpy as np
        inf_kit.show(rows, {t: 3 for t in kp.TRACKS})
        res = {}
        kitobs = [ob for ob, _, _, _ in rows if not ob.hide_render]
        for clip in ("idle", "fire", "move", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "down"):
            act = bpy.data.actions[clip]
            n = int(act.frame_range[1] - act.frame_range[0])
            lo, who, tot = 9.0, None, 0
            for fr in range(0, n + 1, max(1, n // 14)):
                arm.data.pose_position = "POSE"
                arm.animation_data_create()
                arm.animation_data.action = act
                arm.animation_data.action_slot = act.slots[0] if act.slots else None
                bpy.context.scene.frame_set(int(act.frame_range[0]) + fr)
                bpy.context.view_layer.update()
                dg = bpy.context.evaluated_depsgraph_get()
                for ob in kitobs:
                    e = ob.evaluated_get(dg)
                    m = e.to_mesh()
                    z = min((ob.matrix_world @ v.co).z for v in m.vertices)
                    e.to_mesh_clear()
                    if z < lo:
                        lo, who = z, ob.name
                tot += 1
            res[clip] = {"frames": tot, "lowest_kit_z_m": round(lo, 4), "part": who}
        with open(os.path.join(out, "census.json"), "w") as fh:
            json.dump(res, fh, indent=1)
        print(json.dumps(res, indent=1))
        return
    if mode == "close":
        # development view: one figure's kit at a given zoom, several headings
        tiers = {t: int(v) for t, v in zip(kp.TRACKS, a.get("tiers", "3,3,3").split(","))}
        inf_kit.show(rows, tiers)
        fig = a.get("figure", "f1")
        zoom = float(a.get("zoom", 14))
        centre = tuple(arm.data.bones[f"{fig}_root"].head_local)
        cx, cy = centre[0], centre[1]
        turn.location = (0, 0, 0)
        w, h = int(a.get("w", 420)), int(a.get("h", 520))
        if a.get("isolate", "1") == "1":
            isolate(arm, fig)
        cam, sun, ground = st.setup_scene(w, h, zoom, (cx, cy, float(a.get("cz", 1.0))), samples=samples)
        for hd in [int(x) for x in a.get("headings", "0,90,180,270").split(",")]:
            # turn about the figure, not the squad centre: parent the turntable there
            turn.location = (cx, cy, 0.0)
            turn.rotation_euler[2] = math.radians(hd)
            arm.location = (-cx, -cy, 0.0)
            bpy.context.view_layer.update()
            lin = st.render_npy(os.path.join(out, "tmp.npy"))
            st.save_png(lin, os.path.join(out, f"close_{fig}_{a.get('tag', 'x')}_{hd:03d}.png"))
        return
    if mode == "grid":
        # the eleven states at game scale: zoom 1 and zoom 2.5, two headings each
        zoom = float(a.get("zoom", 1.0))
        w, h = int(a.get("w", 120)), int(a.get("h", 96))
        cam, sun, ground = st.setup_scene(w, h, zoom, (0.0, 0.0, 0.85), samples=samples)
        for label, tiers in STATES:
            inf_kit.show(rows, tiers)
            for hd in [int(x) for x in a.get("headings", "0,180").split(",")]:
                turn.rotation_euler[2] = math.radians(hd)
                bpy.context.view_layer.update()
                lin = st.render_npy(os.path.join(out, "tmp.npy"))
                st.save_png(lin, os.path.join(out, f"grid_z{zoom:g}_{label}_{hd:03d}.png"))
        return
    if mode == "turntable":
        # none vs full kit at 8 headings; the whole squad, or one figure
        fig = a.get("figure")
        zoom = float(a.get("zoom", 5.0))
        w, h = int(a.get("w", 360)), int(a.get("h", 330))
        if fig:
            isolate(arm, fig)
            c = tuple(arm.data.bones[f"{fig}_root"].head_local)
            centre = (c[0], c[1], float(a.get("cz", 1.0)))
            turn.location = (c[0], c[1], 0.0)
            arm.location = (-c[0], -c[1], 0.0)
        else:
            centre = (0.0, 0.0, 0.85)
        cam, sun, ground = st.setup_scene(w, h, zoom, centre, samples=samples)
        for label, tiers in (("none", {}), ("full", {t: 3 for t in kp.TRACKS})):
            inf_kit.show(rows, tiers)
            for hd in range(0, 360, 45):
                turn.rotation_euler[2] = math.radians(hd)
                bpy.context.view_layer.update()
                lin = st.render_npy(os.path.join(out, "tmp.npy"))
                st.save_png(lin, os.path.join(out, f"turn_{fig or 'squad'}_{label}_{hd:03d}.png"))
        return
    raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
