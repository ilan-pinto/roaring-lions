"""Runs the wrist-mount EUD (`units/inf_kit_wrist.py`, unregistered) on the shipped figures and prints what it finds. Blender; report only.

    blender -b --factory-startup -P tools/inf_kit_wrist_probe.py

1. RANKING: per figure and per bone (forearm_R, then the upper arm's outer face), the three spots with the smallest back-face gap to the sleeve
   (the gap bar lifted), each with its worst count over the clips against the weapon, the other kit parts, the firing hand, head and neck, and torso.
2. FALSIFICATION of the refusal: (a) wave 5's chest placement (bone spine), (b) a wrist spot deliberately rolled into the handguard: the roll that
   puts the case most in the weapon's way at 40% along the forearm. Each must read non-zero.
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import inf_kit as ik  # noqa: E402
import inf_kit_fit as kf  # noqa: E402
import inf_kit_geo as geo  # noqa: E402
import inf_kit_mesh as km  # noqa: E402
import inf_kit_parts as kp  # noqa: E402
import inf_kit_scene as scn  # noqa: E402
import inf_kit_v7 as v7  # noqa: E402
import inf_kit_wrist as wr  # noqa: E402


def worst(scan):
    return {k: max(r[k] for r in scan.values()) for k in ("weapon", "kit", "hand", "head", "torso")}


def main():
    kp.use_team("inf_squad")
    arm, meshes, _mat = scn.load_squad(REPO, "inf_squad")
    fits = {p: kf.Fit(arm, meshes, p) for p in kp.ALL}
    bank = kf.PoseBank(arm, meshes, fits)
    for f in fits.values():
        f.bank = bank
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    V0, T = km.source("phone_case")
    bar = (wr.SLEEVE_GAP_LIMIT, wr.SLEEVE_GAP_MAX)
    wr.SLEEVE_GAP_LIMIT = wr.SLEEVE_GAP_MAX = 1.0
    for pf, f in fits.items():
        for bone in ("forearm_R", "upperarm_R"):
            c = []
            for t in [0.2 + 0.05 * k for k in range(13)]:
                for r in range(-180, 180, 15):
                    V, info = wr.wrist_try(f, bone, t, r, V0, T)
                    if V is not None:
                        c.append((info["sleeve_gap_mm"], info, V))
            c.sort(key=lambda x: x[0])
            for gap, info, V in c[:3]:
                print(f"RANK {pf} {bone} t {info['t']} roll {info['roll_deg']}: gap median {gap} worst {info['sleeve_gap_worst_mm']} mm; worst over clips {worst(wr.eud_scan(f, bone, V, T))}")
    # (a) wave 5's chest placement
    for pf, dy in (("f0", 0.11), ("f1", 0.10), ("f2", 0.10)):
        f = fits[pf]
        cb = v7.carrier_hull(f)[2]
        ey, ez = ik.EUD_AT
        c, n = km.surf_frame([cb], np.array([f.O[0], f.O[1] + ey + dy, ez]), (-1, 0, 0), 0.04, 0.05)
        V = km.place(V0, c - n * 0.0005, n, v7.UP)
        sh, _ = km.clear_shift([cb, f.zone_torso], V, n, gap=v7.GAP, mask=V0[:, 0] < 0.004)
        V = V + n * sh
        sc = wr.eud_scan(f, "spine", V, T)
        print(f"FALSIFY chest (wave 5) {pf}: worst over clips {worst(sc)}  -> {'REFUSED' if wr.scan_total(sc) else 'NOT REFUSED'}")
    # (b) a wrist spot rolled into the handguard
    for pf, f in fits.items():
        best = None
        for r in range(-180, 180, 15):
            V, _info = wr.wrist_try(f, "forearm_R", wr.EUD_T, r, V0, T)
            if V is None:
                continue
            sc = wr.eud_scan(f, "forearm_R", V, T)
            if best is None or sc and sum(x["weapon"] for x in sc.values()) > best[0]:
                best = (sum(x["weapon"] for x in sc.values()), r, sc)
        if best:
            print(f"FALSIFY wrist rolled into the handguard {pf} (roll {best[1]}): worst over clips {worst(best[2])}  -> {'REFUSED' if wr.scan_total(best[2]) else 'NOT REFUSED'}")
        else:
            print(f"FALSIFY wrist {pf}: no roll lands on the sleeve with the bar lifted")
    wr.SLEEVE_GAP_LIMIT, wr.SLEEVE_GAP_MAX = bar


main()
