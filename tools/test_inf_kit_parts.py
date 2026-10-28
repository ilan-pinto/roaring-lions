#!/usr/bin/env python3
"""Manifest checks for the infantry kit parts (GH-826). Plain python3, no bpy.

    python3 tools/test_inf_kit_parts.py

Pins what `units/inf_kit_parts.py` promises the rest of the pipeline: every
suffix is unique and maps to a bone, texels exist, tiers run 1-3 per track,
a slot never holds two parts of one tier, and `units/rig.py`'s PART_BONE is
EXTENDED from the manifest (it is read as text, because rig.py imports bpy).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "units"))
import inf_kit_parts as kp  # noqa: E402


def main():
    bad = []
    sufs = [s for p in kp.PARTS for s, _ in kp.object_suffixes(p)]
    if len(sufs) != len(set(sufs)):
        bad.append("duplicate kit suffix")
    for p in kp.PARTS:
        if p.texel not in kp.TEXELS:
            bad.append(f"{p.name}: texel {p.texel!r} not pinned")
        if p.tier not in (1, 2, 3) or p.track not in kp.TRACKS:
            bad.append(f"{p.name}: track/tier")
        if not set(p.figs) <= set(kp.ALL):
            bad.append(f"{p.name}: figures")
    for track in kp.TRACKS:
        tiers = {p.tier for p in kp.PARTS if p.track == track}
        if tiers != {1, 2, 3}:
            bad.append(f"{track}: tiers {sorted(tiers)}")
    seen = {}
    for p in kp.PARTS:
        if p.slot:
            k = (p.slot, p.tier)
            if k in seen:
                bad.append(f"slot {p.slot} tier {p.tier}: {seen[k]} and {p.name}")
            seen[k] = p.name
    # a slot's parts belong to one track, and a higher tier always exists to supersede a lower
    for slot in {p.slot for p in kp.PARTS if p.slot}:
        group = [p for p in kp.PARTS if p.slot == slot]
        if len({p.track for p in group}) != 1 or len(group) < 2:
            bad.append(f"slot {slot}: needs >= 2 tiers of one track")
    rig = open(os.path.join(HERE, "units", "rig.py")).read()
    if not re.search(r"from inf_kit_parts import KIT_PART_BONE", rig) or "PART_BONE[_suffix] = _bone" not in rig:
        bad.append("rig.py no longer extends PART_BONE from the kit manifest")
    for b in bad:
        print("FAIL", b)
    print(f"{len(kp.PARTS)} parts, {len(sufs)} object suffixes per figure: " + ("FAIL" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
