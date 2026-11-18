#!/usr/bin/env python3
"""The carrier-piercing RATCHET (GH-746). Plain python3 plus Blender, wired into `pnpm validate:meshes` (CI runs it).

    python3 tools/test_inf_kit_pierce.py

OPEN ITEM, ACCEPTED BY THE LEAD (option b, 9 Nov 2026): the support arm passes through the Rifle Squad's carrier in the aimed
and kneel clips (the Meshy body carries it across its own chest: `launcher_arms.test.ts` exempts the same clips for arm-in-torso).
It is a NAMED, DISCLOSED defect, to be fixed in the arm-path art pass. Until then it must not GROW: for every figure, clip and limb
segment (upperarm, forearm, hand) the worst-frame count of limb mesh edges that cross carrier triangles
(`tools/inf_kit_pierce.py`, independent of any hollow predicate, so a cut cannot read it zero) must not exceed the value in
`tools/inf_kit_pierce_ratchet.json`, measured on the final wave-4 bytes. Lowering the ceilings when the arm path is fixed is
the point of the file; raising one is a ruling, not an edit.

What the ceilings also freeze (both ACCEPTED by the lead, 10 Nov 2026, GH-746): the idle / move SUPPORT-HAND rows, part of the
accepted arm-through-carrier item and fixed in the same later motion pass, (247-288 edges on f0 and f1, mostly
hidden inside the carrier's doubled front relief), and the third kind of row, `groin_thigh`: thigh and shin mesh edges crossing the
groin apron's triangles (the apron hangs 20 cm below the belt, in the legs' way in move and the kneel clips; hidden from the front;
24-222 edges in wave 4), frozen at its post-wave-5 value: a named open item the lead ACCEPTED on 10 Nov, to be fixed in the
later art pass.
The kneel-family groin_thigh rows SATURATE: the thigh is already through the apron's whole depth there, so pushing the apron
deeper into the leg (the review's 10 mm and 30 mm mutations) does not raise them. Only move / moveFire, where the leg just grazes it, react to
the apron's depth; the kneel, kneelIn, kneelOut and pinned ceilings guard a drop in coverage, not a deeper apron.

Disclosed here because the gates that guard them cannot: f2's throat reads a 19.9 degree thin axis against the 20 degree limit of
`assert_hangs` (a 0.1 degree margin: a small change to the part refuses the export), and f1's collar gap is 37 mm (a hinged throat
resting on the carrier's forward relief would lean past 20; the lead ACCEPTED the gap as a named open item, 10 Nov; not widened).

`RL_PIERCE_GLB=<file>` reads another GLB (a scratch copy, for the falsification: `inf_squad.glb` with the carrier's depth shrunk
10% reads over the ceilings and this goes red). Needs Blender (`BLENDER_BIN`, PATH, or the macOS app); exits 2 without it.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

RATCHET = os.path.join(HERE, "inf_kit_pierce_ratchet.json")
GLB = os.environ.get("RL_PIERCE_GLB") or os.path.join(REPO, "art", "meshes", "inf_squad.glb")

#: Every team the ratchet holds: (ratchet file, figures, clips). The Rifle Squad is the pilot (GH-746). The Combat Engineers
#: (GH-826, infantry upgrade unit 1, 13 Nov 2026) are the same kind of body in the same v7 carrier, so the pilot's named items
#: came back on them as the lead's approval of 12 Nov expected ("the pilot's named items are expected, each with a ratchet"):
#: their ceilings are their own file, measured on their own bytes, and `work` is one of their living clips.
#: `RL_PIERCE_TEAM=<team>` with `RL_PIERCE_GLB=<file>` reads a scratch copy of that team for a falsification.
#: The Combat Engineers' file was falsified on 13 Nov 2026: with `demo_b|fire|forearm` lowered 124 -> 123 this goes red
#: ("124 edges cross the carrier, ceiling 123"); put back. Their rows read at or under the Rifle Squad's in most clips
#: (idle forearm 113-133 against 86-153, fire forearm 54-124 against 179-189); the groin apron's rows are the same named item.
TEAMS = {
    "inf_squad": ("inf_kit_pierce_ratchet.json", ("f0", "f1", "f2"), None),
    "demo_squad": ("inf_kit_pierce_ratchet_demo_squad.json", ("demo_a", "demo_b"),
                   ("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "work")),
    # GH-826 unit "Yahalom" (17 Nov 2026): the Combat Engineers' body in its own two scalings, in the same carrier: the same
    # named item (the lead's decision 9 of 15 Nov), its own ceilings, read on its own bytes (72 rows).
    "yahalom_squad": ("inf_kit_pierce_ratchet_yahalom_squad.json", ("yah_a", "yah_b"),
                      ("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "work")),
}


def blender():
    for cand in (os.environ.get("BLENDER_BIN", ""), "blender", "/Applications/Blender.app/Contents/MacOS/Blender"):
        if cand:
            import shutil
            p = shutil.which(cand) or (cand if os.path.exists(cand) else None)
            if p:
                return p
    return None


def read(glb, figs=None, clips=None):
    exe = blender()
    if exe is None:
        print("FAIL no Blender (BLENDER_BIN)")
        sys.exit(2)
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "pierce.json")
        extra = (["--figs", ",".join(figs)] if figs else []) + (["--clips", ",".join(clips)] if clips else [])
        r = subprocess.run([exe, "-b", "--factory-startup", "-P", os.path.join(HERE, "inf_kit_pierce.py"), "--", glb, out] + extra,
                           capture_output=True, text=True, cwd=REPO)
        if not os.path.exists(out):
            print("FAIL the pierce probe wrote nothing:\n" + r.stdout[-2000:] + r.stderr[-1000:])
            sys.exit(1)
        return json.load(open(out))


def failures(reading, ratchet):
    bad = []
    for key, row in sorted(reading.items()):
        clip, fig = key.split("|")
        for seg, n in {**row["segments"], "groin_thigh": row["groin_thigh"]}.items():
            ceil = ratchet.get(f"{fig}|{clip}|{seg}")
            if ceil is None:
                bad.append(f"{fig} {clip} {seg}: no ceiling in the ratchet")
            elif n > ceil:
                bad.append(f"{fig} {clip} {seg}: {n} edges cross the {'groin apron' if seg == 'groin_thigh' else 'carrier'}, ceiling {ceil}")
    missing = set(ratchet) - {f"{k.split('|')[1]}|{k.split('|')[0]}|{s}" for k, r in reading.items() for s in (*r["segments"], "groin_thigh")}
    bad += [f"{m}: in the ratchet, not read" for m in sorted(missing)]
    return bad


def main():
    only = os.environ.get("RL_PIERCE_TEAM") or ("inf_squad" if os.environ.get("RL_PIERCE_GLB") else None)
    rc = 0
    for team, (ratchet_file, figs, clips) in TEAMS.items():
        if only and team != only:
            continue
        glb = GLB if os.environ.get("RL_PIERCE_GLB") else os.path.join(REPO, "art", "meshes", f"{team}.glb")
        ratchet = json.load(open(os.path.join(HERE, ratchet_file)))
        reading = read(glb, figs, clips)
        bad = failures(reading, ratchet)
        for b in bad:
            print("FAIL", b)
        print(f"{team}: {len(ratchet)} ceilings, {len(reading)} figure-clips read from {os.path.relpath(glb, REPO) if glb.startswith(REPO) else glb}: "
              + ("FAIL" if bad else "ok (the open item has not grown)"))
        rc = rc or (1 if bad else 0)
    return rc


if __name__ == "__main__":
    sys.exit(main())
