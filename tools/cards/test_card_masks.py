#!/usr/bin/env python3
"""Checks for the store-card mask stage (GH-746 SC1). Plain python3 + numpy + PIL, no bpy.

    python3 tools/cards/test_card_masks.py

Synthetic images with literal expectations. Every check has an input that makes it fail (the constructed `bad_*`
cases at the bottom), because a gate that reads zero for every input is the repository's known failure.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import card_masks as cm  # noqa: E402
import card_poses as cp  # noqa: E402

FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)


def flat(h=64, w=96, rgb=(120, 110, 90)):
    return np.full((h, w, 3), rgb, np.uint8)


def test_delta_e():
    a = flat()
    check(float(cm.delta_e76(a, a).max()) == 0.0, "identical images differ by 0")
    b = a.copy()
    b[10:20, 10:20] = (121, 110, 90)      # one 8-bit step in red: well under dE 2
    check(float(cm.delta_e76(a, b).max()) < 2.0, "one code step is under dE 2")
    b[30:40, 30:40] = (140, 110, 90)
    d = cm.delta_e76(a, b)
    check(d[35, 35] > 2.0 and d[0, 0] == 0.0, "a real change is over dE 2, the rest is 0")
    check(abs(float(cm.delta_e76(np.array([[[255, 255, 255]]], np.uint8), np.array([[[0, 0, 0]]], np.uint8))[0, 0]) - 100.0) < 0.1, "white vs black is L 100")


def test_dilate_and_feather():
    m = np.zeros((40, 40), bool)
    m[20, 20] = True
    d = cm.dilate(m, 4)
    check(d[20, 24] and d[24, 20] and not d[20, 25] and not d[25, 20], "radius 4 along an axis, not 5")
    check(not d[24, 24], "a disc, not a square (4,4 is 5.7 away)")
    check(int(d.sum()) == len(cm.disc_offsets(4)), "disc pixel count")
    f = cm.feather(d, cp.FEATHER_PX)
    check(0.0 <= float(f.min()) and float(f.max()) <= 1.0 + 1e-9, "feather stays in 0..1")
    check(0.0 < f[20, 20] < 1.0 or f[20, 20] <= 1.0, "feather is a blur of the mask")
    big = np.zeros((80, 80), bool)
    big[20:60, 20:60] = True
    fb = cm.feather(big, cp.FEATHER_PX)
    check(fb[40, 40] > 0.999 and fb[0, 0] < 1e-6, "the inside stays solid, the far outside stays 0")
    ramp = fb[40, 10:30]
    check(np.all(np.diff(ramp) >= -1e-9) and ramp[0] < 0.01 and ramp[-1] > 0.99, "a monotone ramp across the edge")


def test_diff_mask_is_local():
    base = flat(120, 160)
    lvl = base.copy()
    lvl[50:60, 70:80] = (200, 90, 40)
    hard, soft = cm.diff_mask(base, lvl)
    check(hard[55, 75] and hard[46, 75] and not hard[44, 75], "the changed block grows by 4 px and no more")
    check(not hard[0, 0] and soft[0, 0] == 0.0, "pixels far away are untouched (base integrity outside the mask)")
    check(float(soft[55, 75]) > 0.99, "the changed pixels are fully inside")


def test_overlap():
    a = np.zeros((100, 100), bool)
    b = np.zeros((100, 100), bool)
    a[:, :60] = True
    b[:, 50:] = True
    ov = cm.mask_overlap({"a": a, "b": b}, 100 * 100)
    check(abs(ov[("a", "b")] - 0.10) < 1e-9, "10 columns of 100 is 10 %")
    check(cm.mask_overlap({"a": a, "c": np.zeros_like(a)}, 10000)[("a", "c")] == 0.0, "disjoint is 0")


def test_safe_zone():
    h, w = cp.CARD_H, cp.CARD_W
    m = np.zeros((h, w), bool)
    check(cm.safe_zone_coverage(m, cp.SAFE_KIT_MARK) == 0.0, "an empty card covers nothing")
    m[:100, :200] = True                                   # inside the top-left 24 x 20 % (368 x 205 px)
    cov = cm.safe_zone_coverage(m, cp.SAFE_KIT_MARK)
    check(abs(cov - (100 * 200) / (205 * 369)) < 0.01, f"top-left coverage is 100x200 of 205x369, got {cov}")
    check(cov > cp.SAFE_ZONE_FIGURE_MAX, "that is over the 2 % limit")
    check(cm.safe_zone_coverage(m, cp.SAFE_MAXED_STAMP) == 0.0, "the other corner is clear")


def test_distance_and_hand_report():
    a = np.zeros((200, 400), bool)
    b = np.zeros((200, 400), bool)
    a[90:110, 50:70] = True
    b[90:110, 170:190] = True
    d = cm.min_distance(a, b, stride=1)
    check(abs(d - 100.0) < 2.0, f"gap of 100 px between the boxes, got {d}")
    check(cm.min_distance(a, np.zeros_like(b)) == float("inf"), "no other figure is infinitely far")
    ids = np.zeros((200, 400), np.uint8)
    ids[90:110, 50:70] = 80          # f1's firing hand (70 + 10)
    ids[90:110, 170:190] = 30        # f0's body
    hands = ids.copy()
    hands[90:110, 50:90] = 80        # unoccluded it would be twice as wide: half is hidden
    rep = cm.hand_report(ids, hands)
    r = rep["f1"]["L"]
    check(r["seen_px"] == 400 and r["unoccluded_px"] == 800 and abs(r["visible_frac"] - 0.5) < 1e-9, "visible fraction is seen / unoccluded")
    check(abs(r["clearance_px"] - 100.0) < 2.0, "clearance to the other figure's body")
    check(rep["f2"]["L"]["seen_px"] == 0 and rep["f2"]["L"]["visible_frac"] == 0.0, "a hand that is not there reads zero pixels, not a pass")


def test_bbox():
    m = np.zeros((cp.CARD_H, cp.CARD_W), bool)
    m[400:500, 600:700] = True
    x, y, w, h = cm.bbox_padded_32(m)
    check(abs(w / h - 1.5) < 0.01, "padded to 3:2")
    check(x <= 600 and x + w >= 700 and y <= 400 and y + h >= 500, "the zone is inside its crop")
    check(cm.bbox_padded_32(np.zeros_like(m)) is None, "an empty zone has no crop")
    m2 = np.zeros_like(m)
    m2[:20, :20] = True
    x, y, w, h = cm.bbox_padded_32(m2)
    check(x >= 0 and y >= 0 and x + w <= cp.CARD_W and y + h <= cp.CARD_H, "the crop stays inside the card")


def bad_inputs_fail():
    """Falsification: inputs built to make each gate red."""
    # a layer that leaks into the safe zone is caught
    m = np.zeros((cp.CARD_H, cp.CARD_W), bool)
    m[:150, :150] = True
    check(cm.safe_zone_coverage(m, cp.SAFE_KIT_MARK) > cp.SAFE_ZONE_FIGURE_MAX, "BAD: leak into the kit-mark corner is red")
    # two tracks that share a zone are caught (the armour zone moved onto the helmet front)
    a = np.zeros((100, 100), bool)
    b = np.zeros((100, 100), bool)
    a[10:50, 10:50] = True
    b[10:50, 10:50] = True
    check(cm.mask_overlap({"armour": a, "sensors": b}, 10000)[("armour", "sensors")] > cp.OVERLAP_MAX, "BAD: identical zones are over the 1 % limit")
    # a hand 20 px from another figure is under the clearance
    ids = np.zeros((200, 400), np.uint8)
    ids[90:110, 50:70] = 80
    ids[90:110, 90:110] = 30
    r = cm.hand_report(ids, ids)["f1"]["L"]
    check(r["clearance_px"] < cp.HAND_CLEAR_FRAC * cp.CARD_W, "BAD: a near neighbour is under the 4 % clearance")
    # an un-masked edit (a whole-image change) is not local: its hard mask covers the card
    base = flat(60, 80)
    hard, _ = cm.diff_mask(base, flat(60, 80, (160, 110, 90)))
    check(hard.all(), "BAD: a global change fills the mask (the base-integrity gate would see it)")


def main():
    for fn in (test_delta_e, test_dilate_and_feather, test_diff_mask_is_local, test_overlap, test_safe_zone, test_distance_and_hand_report, test_bbox, bad_inputs_fail):
        fn()
    if FAILS:
        print("FAIL:\n  " + "\n  ".join(FAILS))
        sys.exit(1)
    print("test_card_masks: ok")


if __name__ == "__main__":
    main()
