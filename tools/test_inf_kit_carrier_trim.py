#!/usr/bin/env python3
"""A ratchet on what `carrier_trim.drop` controls (GH-1574, the GH-826 follow-up). Plain python3 and numpy; no Blender.

    python3 tools/test_inf_kit_carrier_trim.py

`inf_kit_parts.py` cuts the fitted v7 carrier to a plate carrier's outline: above `drop` under the carrier's top the wall is
kept only within `half_w` of the centre line (`inf_kit_v7._carrier_trim`). Both Combat Engineer teams (demo_squad,
yahalom_squad) ship `drop` 0.26. No other gate held the VALUE (PR 1537, "Gate blind spots" 1): 0.26 -> 0.20 brings back the
open lip under the raised arm and the carrier max, p90 and pierce readings do not move; `test_yahalom_back_plate.py` holds
the plate table and the kit TOGETHER, so a changed `drop` followed by `--write` passes it.

This reads the kit's own source (`art/parts/inf_kit/<team>.glb`, the node `kit_armour_1_carrier_<man>`), per figure:

  rim     the height of the carrier's lowest outer edge under the armholes: the highest vertex of the wall further than
          `half_w + corner` (+ 5 mm) from the centre line. Nothing there stands above the cut line, so it IS the cut line.
  drop    the carrier's top minus that rim: the value `drop` sets (the top stays inside `half_w`, so the cut never takes it).

and holds each in a two-sided band about its reading of 19 Nov 2026 (drop +-4 mm, rim +-5 mm). The reading is per figure:
the shells are fitted per man, so the cut line sits a few mm off 0.26 and not at the same place on all four. The band is
two-sided on purpose: a larger `drop` cuts away more of the wall, a smaller one brings the open lip back.

Falsified (19 Nov 2026): see the commit message that added this file (`drop` 0.26 -> 0.20, the kit rebuilt per team).
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "units"))
import yahalom_back_plate as bp  # noqa: E402  (its GLB reader; plain numpy)

REPO = os.path.dirname(HERE)
HALF_W, CORNER = 0.13, 0.03          # the shipped `carrier_trim` (`inf_kit_parts.py`); the selection below needs them only to skip the chamfer
DROP_TOL, RIM_TOL = 0.004, 0.005     # metres
#: team -> man -> (drop, rim height about the man's root), metres, as read 19 Nov 2026
READINGS = {
    "demo_squad": {"demo_a": (0.2592, 1.1606), "demo_b": (0.2534, 1.0867)},
    "yahalom_squad": {"yah_a": (0.2586, 1.0974), "yah_b": (0.2553, 1.1800)},
}


def read(team, fig, path=None):
    """(drop, rim) in metres of one man's carrier, off the kit source."""
    j, bn = bp._glb(path or os.path.join(REPO, "art", "parts", "inf_kit", f"{team}.glb"))
    names = {n.get("name"): i for i, n in enumerate(j["nodes"])}
    node = j["nodes"][names[f"kit_armour_1_carrier_{fig}"]]
    root = j["nodes"][names[f"{fig}_root"]].get("translation", [0, 0, 0])
    P = np.vstack([bp._acc(j, bn, p["attributes"]["POSITION"]) for p in j["meshes"][node["mesh"]]["primitives"]])
    y = -(P[:, 2] - root[2]); z = P[:, 1] - root[1]
    off = np.abs(y - 0.5 * (y.min() + y.max()))
    wing = off > HALF_W + CORNER + 0.005
    if int(wing.sum()) < 50:
        raise ValueError(f"{team} {fig}: only {int(wing.sum())} vertices outside the plate bag: nothing to read a cut line from")
    rim = float(z[wing].max())
    return float(z.max()) - rim, rim


def failures(team, fig, drop, rim):
    want_d, want_r = READINGS[team][fig]
    bad = []
    if abs(drop - want_d) > DROP_TOL:
        bad.append(f"{team} {fig}: the cut is {1000 * drop:.1f} mm under the carrier's top, held {1000 * want_d:.1f} +-{1000 * DROP_TOL:.0f} (`carrier_trim.drop` changed?)")
    if abs(rim - want_r) > RIM_TOL:
        bad.append(f"{team} {fig}: the carrier's lowest outer edge is at {rim:.4f} m, held {want_r:.4f} +-{1000 * RIM_TOL:.0f} mm")
    return bad


def main():
    bad = []
    for team, figs in READINGS.items():
        for fig in figs:
            d, r = read(team, fig)
            f = failures(team, fig, d, r)
            print(("ok   " if not f else "FAIL ") + f"{team} {fig}: cut {1000 * d:.1f} mm under the top, rim {r:.4f} m")
            bad += f
    # the check can fail, on both sides: the cut line moved 60 mm (drop 0.26 -> 0.20 is about that), up and down
    for tag, dd in (("shallower", -0.06), ("deeper", +0.06)):
        d, r = read("demo_squad", "demo_a")
        if not failures("demo_squad", "demo_a", d + dd, r - dd):
            bad.append(f"control {tag}: a 60 mm move of the cut line passed")
        else:
            print(f"ok   control {tag}: a 60 mm move is refused")
    if bad:
        print("\n".join("FAIL " + b for b in bad))
        sys.exit(1)
    print("carrier_trim.drop: 4 figures held")


if __name__ == "__main__":
    main()
