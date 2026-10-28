#!/usr/bin/env python3
"""The zoom-1 readability floors of the infantry kit (GH-826), as a PRINTED report.

    python3 tools/inf_kit_floors.py <frames dir> <zoom> <out.json> [--thr 16] [--headings 0,90,180,270]

Method (the same A/B the 26 Oct spec's floors came from): the pixels that change when the
kit is added, as a percentage of the squad's own pixels in its T0 frame (the figures AND
their shadows, found against an empty-ground frame). A pixel "changes" when any 8-bit
channel differs by more than the threshold (default 16/255, the threshold render-1's
published numbers reproduce at). Per heading; the range over the headings is printed.

Floors (28 Oct ruling: a report, never a gate, and nothing is grown to meet them):
  full kit >= 29 %, each track alone at T3 >= 9 %, each tier step >= 2 points
  (a step is the rise over the tier below: T1 over T0, T2 over T1, T3 over T2).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

STATES = {"armour": ("a1", "a2", "a3"), "sensors": ("s1", "s2", "s3"), "firepower": ("f1", "f2", "f3")}


def load(d, zoom, label, hd):
    return np.array(Image.open(os.path.join(d, f"grid_z{zoom}_{label}_{hd:03d}.png")).convert("RGB")).astype(int)


def main():
    d, zoom, out = sys.argv[1], sys.argv[2], sys.argv[3]
    thr = 16
    headings = [0, 90, 180, 270]
    for i, a in enumerate(sys.argv):
        if a == "--thr":
            thr = int(sys.argv[i + 1])
        if a == "--headings":
            headings = [int(x) for x in sys.argv[i + 1].split(",")]
    res = {}
    n0 = {}
    for hd in headings:
        bg = load(d, zoom, "empty", hd)
        t0 = load(d, zoom, "none", hd)
        mask0 = np.abs(t0 - bg).max(2) > thr
        n0[hd] = int(mask0.sum())
        for label in ["none"] + [s for v in STATES.values() for s in v] + ["full"]:
            im = load(d, zoom, label, hd)
            ch = np.abs(im - t0).max(2) > thr
            res.setdefault(label, {})[hd] = 100.0 * float(ch.sum()) / max(1, n0[hd])
    rows = []

    def rng(label):
        v = [res[label][h] for h in headings]
        return min(v), max(v)
    print(f"zoom {zoom}: threshold {thr}/255 (max channel), headings {headings}, T0 squad pixels {n0}")
    print(f"{'state':<14}{'changed % of T0 (min-max over headings)':<44}")
    for label in ["a1", "a2", "a3", "s1", "s2", "s3", "f1", "f2", "f3", "full"]:
        lo, hi = rng(label)
        print(f"{label:<14}{lo:6.1f} - {hi:6.1f}")
    report = {"zoom": zoom, "threshold": thr, "headings": headings, "t0_pixels": n0, "states": {}, "floors": []}
    for label in res:
        report["states"][label] = {str(h): round(v, 2) for h, v in res[label].items()}

    def verdict(name, value, floor):
        ok = value >= floor
        report["floors"].append({"floor": name, "value": round(value, 2), "min": floor, "ok": ok})
        print(f"  {name:<34} {value:6.1f}  (floor {floor:g})  {'ok' if ok else 'SHORT by %.1f' % (floor - value)}")
    print("floors (worst heading):")
    verdict("full kit", rng("full")[0], 29.0)
    for tr, (t1, t2, t3) in STATES.items():
        verdict(f"{tr} alone at T3", rng(t3)[0], 9.0)
    for tr, (t1, t2, t3) in STATES.items():
        for name, hi_s, lo_s in ((f"{tr} T1 over T0", t1, None), (f"{tr} T2 over T1", t2, t1), (f"{tr} T3 over T2", t3, t2)):
            steps = [res[hi_s][h] - (res[lo_s][h] if lo_s else 0.0) for h in headings]
            verdict(name, min(steps), 2.0)
    with open(out, "w") as fh:
        json.dump(report, fh, indent=1)


if __name__ == "__main__":
    main()
