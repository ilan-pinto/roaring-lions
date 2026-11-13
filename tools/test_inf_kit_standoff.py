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
Needs Blender (`BLENDER_BIN`, PATH, or the macOS app); exits 2 without it.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

TEAMS = ("inf_squad", "demo_squad")
#: metres
LIMITS = {("belt", "median"): 0.040, ("belt", "p90"): 0.080, ("groin", "median"): 0.110, ("foregrip", "min"): 0.003}
FIGURES = {"inf_squad": ("f0", "f1", "f2"), "demo_squad": ("demo_a", "demo_b")}


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
        rc = rc or (1 if bad else 0)
    return rc


if __name__ == "__main__":
    sys.exit(main())
