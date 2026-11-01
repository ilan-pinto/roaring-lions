#!/usr/bin/env python3
"""Checks for the store-card pose maths and numbers (GH-746 SC1). Plain python3 + numpy, no bpy.

    python3 tools/cards/test_card_poses.py

Every literal below is the design's (`_coord/store-cards/design.md` section 6, N2-N5), written out here and not read
back from card_poses.py, so a table that drifts from the approved numbers goes red. Each check has a `bad_*`
input that must fail it: the file ends by running them.
"""
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import card_poses as cp  # noqa: E402

FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)


def approved_numbers(spec=None):
    """Returns the list of table violations against the approved numbers."""
    spec = spec or cp.RIFLE_SQUAD
    bad = []
    if (cp.CARD_W, cp.CARD_H) != (1536, 1024):
        bad.append("N1 card is 1536 x 1024")
    if cp.CAM_PITCH_DEG != 8.0 or cp.CAM_VFOV_DEG != 30.0 or cp.TURN_DEG != 35.0:
        bad.append("N2 camera 8 deg down, FOV 30, turn 35")
    if not (0.74 <= spec["team_height"] <= 0.80):
        bad.append("N2 team height 74-80 %")
    if cp.FEET_TARGET < 0.86 or cp.FEET_TARGET > 0.90:
        bad.append("N2 feet line 86-90 %")
    if (cp.KEY_AZ_DEG, cp.KEY_EL_DEG, cp.KEY_TONE, cp.FILL_TONE) != (40.0, 50.0, "limestone.0", "water.0"):
        bad.append("N3 key 40/50 limestone.0, fill water.0")
    if abs(cp.FILL_ENERGY / cp.KEY_ENERGY - 0.22) > 0.01:
        bad.append("N3 fill is 0.22 of the key")
    if cp.SAFE_KIT_MARK != (0.0, 0.0, 0.24, 0.20):
        bad.append("N4 kit mark zone 24 x 20 % top-left")
    if cp.SAFE_MAXED_STAMP != (0.74, 0.84, 1.0, 1.0):
        bad.append("N4 Maxed stamp zone 26 x 16 % bottom-right")
    if cp.HAND_CLEAR_FRAC != 0.04:
        bad.append("N4 hands 4 % of the width from any other figure")
    if not (40.0 <= spec["muzzle_elevation_deg"] <= 45.0):
        bad.append("N5 rifle 40-45 deg")
    if spec["firing_hand_height_m"] != (1.18, 1.25) or spec["firing_hand_ahead_m"] != (0.15, 0.20) or spec["support_hand_height_m"] != (1.40, 1.48):
        bad.append("N5 hand ranges")
    if not (1.18 <= spec["firing_hand_height_target"] <= 1.25) or not (0.15 <= spec["firing_hand_ahead_target"] <= 0.20):
        bad.append("N5 targets inside their ranges")
    if spec["line_gap_m"] != 1.1 or spec["leader"] != "f1" or spec["line_order"][0] != "f1":
        bad.append("N5 line 1.1 m apart, f1 in front")
    if (cp.DELTA_E, cp.DILATE_PX, cp.FEATHER_PX, cp.OVERLAP_MAX) != (2.0, 4, 6, 0.01):
        bad.append("N7 masks dE 2, 4 px, 6 px, 1 %")
    return bad


def test_numbers():
    check(approved_numbers() == [], f"approved numbers: {approved_numbers()}")


def test_two_bone_ik():
    P, a, b = np.array([0.0, 0.0, 0.0]), 0.12, 0.27
    for W in ([0.3, 0.1, 0.0], [0.2, -0.1, 0.2], [0.0, 0.0, -0.35]):
        E, d, short = cp.solve_two_bone(P, W, a, b, (0, 0, -1))
        check(abs(np.linalg.norm(E - P) - a) < 1e-9, f"upper arm length kept for {W}")
        check(abs(np.linalg.norm(np.array(W) - E) - b) < 1e-9, f"forearm length kept for {W}")
        check(short == 0.0, f"{W} is reachable")
    # beyond full extension: the shortfall is reported, never silently absorbed
    _, _, short = cp.solve_two_bone(P, [0.5, 0, 0], a, b, (0, 0, -1))
    check(abs(short - (0.5 - (a + b))) < 1e-3, "an out-of-reach target reports its shortfall")
    # the elbow follows the pole: pole down puts the elbow below the shoulder-wrist line
    E_dn, _, _ = cp.solve_two_bone(P, [0.3, 0, 0], a, b, (0, 0, -1))
    E_up, _, _ = cp.solve_two_bone(P, [0.3, 0, 0], a, b, (0, 0, 1))
    check(E_dn[2] < 0 < E_up[2], "the elbow follows the pole")


def test_protraction():
    P, W = np.array([0.0, 0, 0]), np.array([0.45, 0, 0])
    s = cp.protraction_needed(P, W, 0.12, 0.27, W - P, 0.11)
    check(abs(np.linalg.norm(W - (P + (W - P) / 0.45 * s)) - (0.39 - 1e-3)) < 2e-4, "protraction is the least that reaches")
    check(cp.protraction_needed(P, [0.3, 0, 0], 0.12, 0.27, [1, 0, 0], 0.11) == 0.0, "no protraction when reachable")
    check(cp.protraction_needed(P, [0.9, 0, 0], 0.12, 0.27, [1, 0, 0], 0.11) == 0.11, "capped at the cap")


def test_frames_and_swing():
    rng = np.random.default_rng(1)       # a fixed generator: this file is deterministic
    for _ in range(20):
        a0, u0, a1, u1 = rng.normal(size=(4, 3))
        R = cp.rigid_between(a0, u0, a1, u1)
        check(abs(np.linalg.det(R) - 1.0) < 1e-9, "a rotation, not a reflection")
        check(np.allclose(R @ cp.unit(a0), cp.unit(a1), atol=1e-9), "axis lands on the axis")
        check(np.allclose(R @ R.T, np.eye(3), atol=1e-9), "orthonormal")
        S = cp.swing(a0, a1)
        check(np.allclose(S @ cp.unit(a0), cp.unit(a1), atol=1e-9), "swing lands")
    check(np.allclose(cp.swing([0, 0, 1], [0, 0, -1]) @ [0, 0, 1], [0, 0, -1]), "swing through 180")
    check(abs(cp.signed_angle([1, 0, 0], [0, 1, 0], [0, 0, 1]) - 90.0) < 1e-9, "signed angle sign")
    check(np.allclose(cp.axis_angle([0, 0, 1], 90) @ [1, 0, 0], [0, 1, 0], atol=1e-9), "axis_angle sign")


def test_hand_number_check():
    ok = cp.check_hand_numbers(dict(firing_height=1.215, firing_ahead=0.175, support_height=1.46), cp.RIFLE_SQUAD)
    check(all(r[4] for r in ok), "in-range hand numbers pass")
    low = cp.check_hand_numbers(dict(firing_height=1.10, firing_ahead=0.175, support_height=1.46), cp.RIFLE_SQUAD)
    check(not low[0][4] and low[1][4], "a low firing hand fails only its own row")


def bad_numbers_are_caught():
    """Falsification: a table that drifts must make `approved_numbers` return something."""
    for key, val in (("muzzle_elevation_deg", 60.0), ("line_gap_m", 1.5), ("team_height", 0.5)):
        spec = dict(cp.RIFLE_SQUAD)
        spec[key] = val
        check(approved_numbers(spec) != [], f"drift in {key} is caught")


def main():
    for fn in (test_numbers, test_two_bone_ik, test_protraction, test_frames_and_swing, test_hand_number_check, bad_numbers_are_caught):
        fn()
    if FAILS:
        print("FAIL:\n  " + "\n  ".join(FAILS))
        sys.exit(1)
    print("test_card_poses: ok")


if __name__ == "__main__":
    main()
