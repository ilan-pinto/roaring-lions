#!/usr/bin/env python3
"""The worn kit sits ON the body and the foregrip ON the handguard (GH-826, infantry upgrade unit 1). Plain python3 plus
Blender, wired into `pnpm validate:meshes` (CI runs it).

    python3 tools/test_inf_kit_standoff.py

Why it exists. The Opus review of 13 Nov 2026 found the Combat Engineers' first v7 fit wearing its belt off the body:
demo_a's battle belt stood a median 93 mm from him (90th percentile 180, maximum 190) and his groin apron 186 mm, demo_b's
belt 54 mm, and the tier-1 foregrip hung 15.4 / 10.9 mm under the handguard. Every gate was green: the fitter's own
refusals measure a part against the RING IT SAMPLED (which, on that body, was the tops of the thighs from a centre in
front of the hips), and nothing measured the shipped part against the shipped body. This does, off the bytes
(`tools/inf_kit_standoff.py`: nearest distance from every belt and apron vertex to the `uniform` mesh at the first frame
of `idle`; the foregrip's nearest point to its own gun at rest).

The limits are literals, the Rifle Squad's own readings on its accepted v7 fit (the lead, 12 Nov) rounded up, and both
kitted teams are held to them:
                              Rifle Squad f0 / f1 / f2      limit
    belt median, mm           34.3 / 33.5 / 28.7            40
    belt 90th percentile, mm  70.4 / 74.2 / 62.0            80
    groin median, mm          105.9 / 66.6 / 68.3           110
    foregrip to gun, mm       1.0 / 1.3 / 0.5               3
(The apron hangs from the belt's front and stands off the thighs behind it: its median is a hanging plate's, not a wrap's.)

Falsified (13 Nov 2026) on the bytes the review read: `RL_STANDOFF_GLB=<the first fit's demo_squad.glb>
RL_STANDOFF_TEAM=demo_squad` reads belt 93.3 / 179.6, groin 185.7 and foregrip 15.4 on demo_a, belt 53.7 / 96.4 and
foregrip 10.9 on demo_b: seven reds. The fit that turned them green is `belt_from_spine` and the foregrip's surface ray in
demo_squad's row (`inf_kit_parts.py`): the first fit is that row without them.

Round 3 (16 Nov 2026, the lead's list after the second Opus review): four rows of the Combat Engineers' OWN
(`TEAM_LIMITS`), read off the same bytes by the same tool. The limit column is the LIVE one (round 4, the lead's ruling of
17 Nov 2026); round 3's own limits for the two rows that changed are in the last column, for the record:
                                               round 2 bytes (44942becd)     round 3      limit (demo_a / demo_b)       round 3's limit
    carrier wall off the body, p90, mm          47.1 / 47.1                   28 / 28      40
    carrier wall off the body, max, mm          93.2 / 96.2                   70 / 63      70.0 / 63.5                   75
    ear cups' centroid under the face's
      middle, mm (negative: over it)            +27 / -58                     -80 / -86    -79.5 +-5 / -85.6 +-5         a ceiling at 0
    gun triangles crossing an ear cup, worst
      sampled frame of the aimed clips          197 / 86                      0 / 0        0
Round 4 also holds the tier-2 seats per man (`FIGURE_LIMITS`, the comments beside it): the scope over the gun 14.5 / 13.0 mm
and the laser box 13.0 / 10.0 mm. With the per-man rows the round-2 bytes read EIGHT reds (demo_b's cups, -58, are under
their band now).
The carrier's upper back corners and armhole lips stood in the air behind the firing shoulder (the "cavity" of the aimed
back views); the cups hung at 1.572 m, the Rifle Squad's ear height, on men whose helmet rims stand at 1.71 / 1.63, and
the stock's comb ran through the firing-side cup at the cheek weld. Falsified on the round-2 bytes
(`RL_STANDOFF_GLB=<44942becd's art/meshes/demo_squad.glb> RL_STANDOFF_TEAM=demo_squad`): seven reds (carrier p90 and
max on both men, the gun through a cup on both men, demo_a's cups under his face's middle). demo_b's cup-height row did
not go red on those bytes (-58) under round 3's ceiling at 0; round 4's band is what holds it. The Rifle Squad reads over three of the four
(carrier 52-59 / 102-117, the gun through a cup 110 / 8 / 0 triangles) and is printed, not held: its fit is the lead's
accepted one and not this unit's to move.
Needs Blender (`BLENDER_BIN`, PATH, or the macOS app); exits 2 without it.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

TEAMS = ("inf_squad", "demo_squad", "yahalom_squad")
#: metres
LIMITS = {("belt", "median"): 0.040, ("belt", "p90"): 0.080, ("groin", "median"): 0.110, ("foregrip", "min"): 0.003}
FIGURES = {"inf_squad": ("f0", "f1", "f2"), "demo_squad": ("demo_a", "demo_b"), "yahalom_squad": ("yah_a", "yah_b")}
#: Round 3 (16 Nov 2026), a team's OWN limits, metres (and a count): see "Round 3" in the header. The Rifle Squad is read and
#: printed beside them and NOT held (its accepted fit reads over every one of them: a named finding, not this unit's to move).
TEAM_LIMITS = {
    "demo_squad": {("carrier", "p90"): 0.040, ("headset", "gun_pairs"): 0},
    # GH-826 unit "Yahalom" (17 Nov 2026): the same body and the same carrier and headset rows, so the same limits
    "yahalom_squad": {("carrier", "p90"): 0.040, ("headset", "gun_pairs"): 0},
}
#: Round 4 (16 Nov 2026), a FIGURE's own rows: a ceiling (one number), or a band (lo, hi) that is red on BOTH sides.
#:   carrier max: a ratchet at the round-3 reading (the lead's L4: the plate bag's worst point off the firing shoulder blade is
#:     an accepted, named item; it may not grow). Round 3's ceiling was 75 mm for both men, 5 and 12 mm of air over the readings.
#:   headset below_face_mid: a band of +-5 mm about the reading (the lead's L3: the cups ride about 2-3 cm above the ear, over
#:     the stock's comb, an accepted, named item). Round 3's row was a ceiling at 0, which a cup at the crown of the helmet
#:     passed, and which demo_b's reading had never tripped (-58 on the round-2 bytes).
#:   lpvo / laser_box min: a ratchet on how far the tier-2 scope and the laser box stand over the gun at rest (readings
#:     14.2 / 12.6 and 12.9 / 9.9 mm; the ceiling is the reading rounded up to the next half millimetre). Round 3's rail bar is
#:     2.5 mm higher than round 2's plate and the scope sits on the highest point under it: 11.6 / 10.2 -> 14.2 / 12.6. A named
#:     item, not a fit: the Rifle Squad's scope reads 3.7-6.7. It may not grow.
FIGURE_LIMITS = {
    "demo_squad": {
        # readings on the round-4 bytes: carrier max 69.7 / 63.1 mm (the ceiling is the reading rounded up to the next half
        # millimetre: the tool rounds to 0.1 mm and CI's Blender is another build), cups -79.5 / -85.6 mm
        "demo_a": {("carrier", "max"): 0.0700, ("headset", "below_face_mid"): (-0.0845, -0.0745), ("lpvo", "min"): 0.0145, ("laser_box", "min"): 0.0130},
        "demo_b": {("carrier", "max"): 0.0635, ("headset", "below_face_mid"): (-0.0906, -0.0806), ("lpvo", "min"): 0.0130, ("laser_box", "min"): 0.0100},
    },
    # GH-826 unit "Yahalom" (17 Nov 2026), the same rows by the same rule (a ceiling is the reading rounded up to the next
    # half millimetre; the cup band is +-5 mm about the reading). Readings on the round-1 bytes: carrier max 65.3 / 69.7 mm,
    # cups -63.5 / -48.3 mm (yah_a's raised 20 mm over the stock's comb, yah_b's not raised), scope 13.6 / 3.0 mm, laser
    # 12.4 / 13.7 mm. APPROVED by the lead on 17 Nov 2026 ("Approve all", the round-1 review's row 16) once watched red:
    # round 2 (17 Nov), one kit build with `headset_below_rim` 0.048 -> 0.070 in the team's row and the scope and the laser
    # box seated 4 mm higher (`inf_kit_v7.v7_lpvo`, `v7_laser_box`): yah_a's cups -51.6 mm, "LOWER on the head than the band"
    # (the band's low side, which round 1 never tripped), scope 17.6 / 7.0 mm and laser 14.9 / 16.2 mm: five reds, and a
    # sixth with them (36 gun triangles through yah_a's lowered cup). SURVIVORS, disclosed: yah_b's cups (-50 mm, inside
    # his band: his are not raised, and 22 mm under the rim moved the centroid 2 mm); and `carrier_trim.drop` 0.26 -> 0.20,
    # which moved neither carrier row (65 / 70 mm before and after) and was seen by `test_yahalom_back_plate.py` alone.
    # yah_b's scope at 3.0 mm, SIGNED (the review, section 6: an unsigned row passes a scope sunk in the rail): 0 of its 443
    # vertices are inside the gun and its lower face stands +5.1 mm (least) over the gun's top surface under it; the other
    # three men's stand +14.4 to +15.4 (`_coord/infantry-upgrade/yahalom/gates-r2/scope_signed.txt`). Not sunk: a lower seat.
    "yahalom_squad": {
        "yah_a": {("carrier", "max"): 0.0655, ("headset", "below_face_mid"): (-0.0685, -0.0585), ("lpvo", "min"): 0.0140, ("laser_box", "min"): 0.0125},
        "yah_b": {("carrier", "max"): 0.0700, ("headset", "below_face_mid"): (-0.0533, -0.0433), ("lpvo", "min"): 0.0035, ("laser_box", "min"): 0.0140},
    },
}


def blender():
    import shutil
    for cand in (os.environ.get("BLENDER_BIN", ""), "blender", "/Applications/Blender.app/Contents/MacOS/Blender"):
        if cand:
            p = shutil.which(cand) or (cand if os.path.exists(cand) else None)
            if p:
                return p
    return None


def read(glb):
    exe = blender()
    if exe is None:
        print("FAIL no Blender (BLENDER_BIN)")
        sys.exit(2)
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "standoff.json")
        r = subprocess.run([exe, "-b", "--factory-startup", "-P", os.path.join(HERE, "inf_kit_standoff.py"), "--", glb, out],
                           capture_output=True, text=True, cwd=REPO)
        if not os.path.exists(out):
            print("FAIL the standoff probe wrote nothing:\n" + r.stdout[-2000:] + r.stderr[-1000:])
            sys.exit(1)
        return json.load(open(out))


def failures(team, reading):
    bad = []
    if sorted(reading) != sorted(FIGURES[team]):
        bad.append(f"{team}: read figures {sorted(reading)}, the team's are {sorted(FIGURES[team])}")
    for fig, row in sorted(reading.items()):
        for (part, stat), limit in LIMITS.items():
            v = row.get(part, {}).get(stat)
            if v is None:
                bad.append(f"{team} {fig}: {part} {stat} not read")
            elif v > limit:
                bad.append(f"{team} {fig}: {part} {stat} {1000 * v:.1f} mm, limit {1000 * limit:.0f}")
        for (part, stat), limit in TEAM_LIMITS.get(team, {}).items():
            v = row.get(part, {}).get(stat)
            if v is None:
                bad.append(f"{team} {fig}: {part} {stat} not read")
            elif v > limit:
                bad.append(f"{team} {fig}: {part} {stat} {v:g}, limit {limit:g}" if stat == "gun_pairs" else
                           f"{team} {fig}: {part} {stat} {1000 * v:.1f} mm, limit {1000 * limit:.0f}")
        for (part, stat), limit in FIGURE_LIMITS.get(team, {}).get(fig, {}).items():
            v = row.get(part, {}).get(stat)
            if v is None:
                bad.append(f"{team} {fig}: {part} {stat} not read")
            elif isinstance(limit, tuple):
                if not limit[0] <= v <= limit[1]:
                    bad.append(f"{team} {fig}: {part} {stat} {1000 * v:+.1f} mm, outside its band {1000 * limit[0]:+.1f} .. {1000 * limit[1]:+.1f}"
                               + (" (HIGHER on the head than the band)" if v < limit[0] else " (LOWER on the head than the band)"))
            elif v > limit:
                bad.append(f"{team} {fig}: {part} {stat} {1000 * v:.1f} mm, this figure's ceiling {1000 * limit:.1f}")
        if team in FIGURE_LIMITS and fig not in FIGURE_LIMITS[team]:
            bad.append(f"{team} {fig}: no row of its own in FIGURE_LIMITS")
        if ("headset", "gun_pairs") in TEAM_LIMITS.get(team, {}) and row.get("headset", {}).get("frames", 0) < 20:
            bad.append(f"{team} {fig}: the headset was read against the gun in {row.get('headset', {}).get('frames', 0)} frames: not a reading")
    return bad


def main():
    only = os.environ.get("RL_STANDOFF_TEAM")
    rc = 0
    for team in TEAMS:
        if only and team != only:
            continue
        glb = os.environ.get("RL_STANDOFF_GLB") if only else None
        glb = glb or os.path.join(REPO, "art", "meshes", f"{team}.glb")
        reading = read(glb)
        bad = failures(team, reading)
        for b in bad:
            print("FAIL", b)
        print(f"{team}: " + "; ".join(f"{f} belt {1000 * r['belt']['median']:.0f}/{1000 * r['belt']['p90']:.0f} groin {1000 * r['groin']['median']:.0f} "
                                       f"foregrip {1000 * r['foregrip']['min']:.1f}" for f, r in sorted(reading.items()))
              + " mm (belt median/p90, groin median, foregrip to gun): " + ("FAIL" if bad else "ok"))
        if team in FIGURE_LIMITS:
            print(f"{team}: " + "; ".join(f"{f} scope {1000 * r['lpvo']['min']:.1f} laser {1000 * r['laser_box']['min']:.1f}" for f, r in sorted(reading.items()) if "lpvo" in r and "laser_box" in r)
                  + " mm (the tier-2 scope and the laser box over the gun at rest): " + ("FAIL" if bad else "held"))
        print(f"{team}: " + "; ".join(f"{f} carrier {1000 * r['carrier']['median']:.0f}/{1000 * r['carrier']['p90']:.0f}/{1000 * r['carrier']['max']:.0f} "
                                       + (f"cups {1000 * r['headset']['below_face_mid']:+.0f} gun x cup {r['headset']['gun_pairs']}" if "headset" in r else "no headset")
                                       for f, r in sorted(reading.items()))
              + " (carrier off the body median/p90/max mm; ear cups under the face's middle mm; gun triangles through a cup, worst aimed frame): "
              + ("held" if team in TEAM_LIMITS else "read, not held"))
        rc = rc or (1 if bad else 0)
    return rc


if __name__ == "__main__":
    sys.exit(main())
