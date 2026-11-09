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
sys.path.insert(0, HERE)
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
    # every team's table: figures, leader, armed men, and (for the teams after the Rifle Squad) the pinned texels are the ones
    # `inf_kit_texels.py` finds in the shipped atlas today, so a re-baked atlas turns this red instead of shifting a colour
    base_parts = [(p.name, p.figs, p.role) for p in kp.PARTS]
    for tid, team in kp.TEAMS.items():
        kp.use_team(tid)
        if not set(team.leader) <= set(team.figs) or not set(team.armed) <= set(team.figs):
            bad.append(f"{tid}: leader/armed not among the figures")
        for p in kp.PARTS:
            if not p.figs:
                bad.append(f"{tid}: {p.name} has no figure")
            if not set(p.figs) <= set(team.figs):
                bad.append(f"{tid}: {p.name} figures {p.figs}")
            if p.bone == "weapon" and not set(p.figs) <= set(team.armed):
                bad.append(f"{tid}: weapon part {p.name} on an unarmed figure")
        if set(team.texels) != set(kp.PALETTE_KEY):
            bad.append(f"{tid}: texel names")
        if True:   # every team, the Rifle Squad included since its atlas is the Meshy bake (9 Nov 2026)
            try:
                import inf_kit_texels as tx
            except ImportError:
                print(f"  (scipy/PIL missing: {tid} texels not re-searched)")
            else:
                found = tx.search(tid, 5, 4.0)
                for name, xy in team.texels.items():
                    if list(xy) != found[name]["texel"]:
                        bad.append(f"{tid}: texel {name} pinned {xy}, atlas search finds {found[name]['texel']}")
                    if found[name]["dE76"] > tx.DE_CAP or abs(found[name]["dHue_deg"]) > tx.HUE_CAP:
                        bad.append(f"{tid}: texel {name} outside the deviation cap")
    kp.use_team("inf_squad")
    # the Rifle Squad's per-node rows for the v7 parts are the v7 report's own triangle counts (a sided part: one node per side; the
    # pouches: two in one node), and no other team has any (demo_squad keeps the shared limits)
    import json
    rep = json.load(open(os.path.join(HERE, "..", "art", "parts", "inf_kit", "v7", "kit_parts_report.json")))
    src_of = {"throat": ["throat_protector"], "groin": ["groin_apron"], "mag_pouches": ["mag_pouch"] * 2, "grenade_pouches": ["grenade_pouch"] * 2,
              "eud": ["phone_case"], "lpvo": ["scope"], "laser_box": ["laser"], "headset": ["headset_l_built"]}
    for name, rows in kp.TEAMS["inf_squad"].part_tris.items():
        srcs = src_of.get(name, [name])
        want = sum(rep[s]["tris"] for s in srcs)
        if rows != want:
            bad.append(f"inf_squad part_tris[{name}] = {rows}, the v7 report's {srcs} gives {want}")
    if {p.name for p in kp.PARTS} - set(kp.TEAMS["inf_squad"].part_tris) != {"helmet_cover", "yoke", "foregrip", "whip_short", "whip_long"}:
        bad.append("inf_squad part_tris: the parts left procedural are not exactly the helmet cover, yoke, foregrip and whips")
    if kp.TEAMS["demo_squad"].part_tris:
        bad.append("demo_squad has per-part triangle rows: it must keep the shared limits")
    # the table is the shipped part files' own counts
    if rep["carrier"]["tris"] != 2299:
        bad.append("kit_parts_report.json: the carrier is not the decimated 2,299")
    # the Rifle Squad's table is the template less what its own bake shows (since the Meshy figure, 9 Nov 2026: the
    # helmet's NVG mount, and no deltoid or sleeve armour on a skinned arm)
    want = [t for t in base_parts if t[0] not in kp.TEAMS["inf_squad"].drop]
    if want != [(p.name, p.figs, p.role) for p in kp.PARTS]:
        bad.append("use_team('inf_squad') does not restore the Rifle Squad table")
    rig = open(os.path.join(HERE, "units", "rig.py")).read()
    if not re.search(r"from inf_kit_parts import KIT_PART_BONE", rig) or "PART_BONE[_suffix] = _bone" not in rig:
        bad.append("rig.py no longer extends PART_BONE from the kit manifest")
    for b in bad:
        print("FAIL", b)
    print(f"{len(kp.PARTS)} parts, {len(sufs)} object suffixes per figure: " + ("FAIL" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
