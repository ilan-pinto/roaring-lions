#!/usr/bin/env python3
"""The Yahalom Engineers' pack lies on the back, its straps lie on the shoulders, and its seat is over the plate (GH-826
unit "Yahalom", round 2). Plain python3 plus Blender, wired into `pnpm validate:meshes` (CI runs it).

    python3 tools/test_yahalom_gear_standoff.py

Why it exists. The Opus review of the unit's round 1 (17 Nov 2026, section 6, "Cannot fail: nothing gates these"):
  * "The pack lift: nothing measures pack-to-back standoff. 181 / 155 mm in `pinned` passes every gate."
  * "The strap hoop: the only strap row counts samples INSIDE the trunk. A strap 5 cm off the shoulder passes."
  * "Pack against the kit carrier: the pack is seated 6 mm off the bare back, so its face is inside the plate: hidden."
Round 1's 0.50 m pack hung 0.21 / 0.19 m under the spine bone's pivot and its lower third swung off the lumbar when the spine
folds; its flat 50 mm straps stood off the shoulder as hoops; its bag stood in the kit's plate bag at armour 1 and up; and the
gas detector lay under the firing forearm. Every gate was green. This reads the shipped bytes (`tools/yahalom_gear_standoff.py`:
nothing of the gear's builder is imported) and holds, per man:

  PACK_BOTTOM   the pack's lower third off the trunk, the median over its cells, per clip: a CEILING. The clips that fold
                the spine are where round 1 failed; every living clip is held, the rest pose too.
  PACK_UPPER    its top and middle thirds, the median, every clip: one ceiling a man (they are rigid with the spine).
  PACK_MIN      the least signed gap anywhere on the pack's face, every clip: a FLOOR (a pack sunk in the back reads negative).
  BAG_IN_PLATE  cells of the pack's face, its back pad left out, that read INSIDE the kit's carrier or yoke: 0, every clip.
  STRAP         the straps' body-side vertices over the shoulder's crest off the body: a ceiling on the median and on the
                90th percentile, every clip (the strap is rigid on the spine and the shoulder moves under it in the aimed clips).
  GAS           the kit's gas detector against the man's own arms: 0 crossing triangle pairs at rest, in idle and in move,
                and a named ceiling per man on the pairs in the other clips (the lead's ruling of 17 Nov 2026: "its
                support-arm intrusion named as a ceiling"). A COUNT, as the carrier's pierce ratchet is; how DEEP the arm
                lies in it is the clash census's reading (`inf_kit_clash.py`, the sheet's file 19: the review's "20 mm or less").
  DETECTOR_FOOT the leader's detector hangs under the pack now: its lowest 0.20 m off the body, a ceiling on the maximum.
  and the READING ITSELF: two straps a man, a pad, the leader's detector and no other, at least 150 cells of pack face,
  no third with fewer than 40 cells read, no more than 10 misses in a third: an empty selection is a red, not a pass.

The ceilings are the readings on the round-2 bytes rounded up (a median to the next 5 mm, a floor down to the next
millimetre): ratchets. NOT ruled on by the lead as numbers (his ruling is the sizes they follow from).

FALSIFIED, row by row (17 Nov 2026; each run, watched red, put back; the bytes rebuilt to the same hash, 1e6783f18577):
  on the ROUND-1 bytes (`RL_GEAR_GLB=<38d13bae6's art/meshes/yahalom_squad.glb>`): 56 reds.
    PACK_BOTTOM   12 reds: pinned 170.8 / 150.1 mm (ceilings 85 / 65), kneel 102.4 / 96.5 (70 / 60), work 112.8 / 98.3 (90 / 55),
                  kneelIn and kneelOut 100.9 / 96.1 (90 / 85), yah_b's move 75.3 (65) and fire 85.0 (65).
                  NOT red on those bytes: the REST pose and idle (round 1 reads 62 / 56 and 87 / 76 mm there against round
                  2's own 72 / 75 and 88 / 87: seated over the plate, the round-2 pack stands 22 / 20 mm further off the BARE
                  back, and its lower third is no nearer at rest. The row holds the fold, not the rest).
    BAG_IN_PLATE  20 reds: 78 of 134 and 75 of 142 cells of the bag's face inside the plate (18.7 / 14.8 mm deep), every row.
    PACK_MIN      20 reds: round 1's pad stood 4.0-6.1 mm off the trunk (floors 8 / 7).
    GAS           5 reds, yah_b only (82 pairs against 80: the right-strap detector under the firing forearm). yah_a's
                  round-1 detector reads 33-41 pairs, under his ceiling: his row needed the mutation below. And this row is
                  BLIND to a detector wholly inside an arm (no surface crosses): round 1's idle reads 0 pairs, where the
                  clash census read it 19.3 mm in the forearm. Idle and move are held at 0 for a detector that grazes an arm.
    NOT red on the round-1 bytes at all: STRAP (round 1 reads 16-24 mm median, 33-40 mm p90, UNDER round 2's 22-27 and 28-40:
    the ruled clearance is 27 mm, more than round 1's 16), PACK_UPPER (18-25 mm against 20-35), DETECTOR_FOOT (223 against 237).
  by mutation, one build (`gates-r2/mutation_M1_RED.txt`): the strap's `clear` 0.027 -> 0.037, the pad's `clear` 0.012 -> 0.050,
  DET_GAP_M 0.004 -> 0.060, the kit's STRAP_Y 0.085 -> 0.120:
    STRAP         median red in 17 of 20 rows (30.2-35.7 mm against 30), p90 red in 12 (41.1-49.1 against 45 / 40);
    PACK_UPPER    top third 51.3-51.8 mm, red in all 20 rows; middle 39.2-43.4 (35 / 40), red in 18 (yah_b's idle and work
                  survived); and PACK_BOTTOM with it, 15 rows (the pad's clearance is the pack's);
    DETECTOR_FOOT 242.6-254.4 mm against 240: red in 8 of 10 rows (fire and moveFire survived);
    GAS           kneelIn / kneelOut 150 / 144 (yah_a) and 110 / 113 (yah_b) pairs against 79 / 80.
  NOT falsified: the reading's own refusals (two straps, one pad, the cell counts): no input was built for them.
Needs Blender (`BLENDER_BIN`, PATH, or the macOS app); exits 2 without it.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FIGURES = ("yah_a", "yah_b")
LEADER = "yah_a"
CLIPS = ("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "work")
ROWS = ("rest",) + CLIPS

#: metres. See the header: each is the round-2 reading rounded up.
PACK_BOTTOM = {
    "yah_a": {"rest": 0.075, "idle": 0.090, "move": 0.090, "fire": 0.085, "moveFire": 0.085, "kneel": 0.070, "kneelIn": 0.090, "kneelOut": 0.090, "pinned": 0.085, "work": 0.090},
    "yah_b": {"rest": 0.080, "idle": 0.090, "move": 0.065, "fire": 0.065, "moveFire": 0.075, "kneel": 0.060, "kneelIn": 0.085, "kneelOut": 0.085, "pinned": 0.065, "work": 0.055},
}
PACK_UPPER = {"yah_a": 0.035, "yah_b": 0.040}
PACK_MIN = {"yah_a": 0.008, "yah_b": 0.007}
STRAP = {"yah_a": {"median": 0.030, "p90": 0.045}, "yah_b": {"median": 0.030, "p90": 0.040}}
GAS_CLEAR_CLIPS = ("rest", "idle", "move")
GAS_ARM_PAIRS = {"yah_a": 79, "yah_b": 80}
DETECTOR_FOOT_MAX = 0.240
MIN_CELLS, MIN_THIRD, MAX_MISSES = 150, 40, 10


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
        out = os.path.join(tmp, "gear.json")
        r = subprocess.run([exe, "-b", "--factory-startup", "-P", os.path.join(HERE, "yahalom_gear_standoff.py"), "--", glb, out],
                           capture_output=True, text=True, cwd=REPO)
        if not os.path.exists(out):
            print("FAIL the gear probe wrote nothing:\n" + r.stdout[-2000:] + r.stderr[-1000:])
            sys.exit(1)
        return json.load(open(out))


def failures(reading):
    bad = []
    mm = lambda v: f"{1000 * v:.1f}"  # noqa: E731
    if sorted(reading) != sorted(FIGURES):
        return [f"read figures {sorted(reading)}, the team's are {sorted(FIGURES)}"]
    for fig in FIGURES:
        r = reading[fig]
        isl = r["islands"]
        want_det = fig == LEADER
        if isl["straps"] != 2 or isl["pad"] != 1 or (isl["detector"] > 0) != want_det:
            bad.append(f"{fig}: the gear reads {isl['straps']} shoulder straps, {isl['pad']} back pad and {isl['detector']} detector islands "
                       f"(two, one and {'some' if want_det else 'none'}): the reading does not know this gear")
        if r["cells"] < MIN_CELLS:
            bad.append(f"{fig}: {r['cells']} cells of pack face, under {MIN_CELLS}: not a reading")
        if r["kit_back_triangles"] < 500:
            bad.append(f"{fig}: {r['kit_back_triangles']} triangles of kit carrier and yoke found: the plate is not read")
        rows = dict(r["clips"], rest=r["rest"])
        for clip in ROWS:
            row = rows.get(clip)
            if row is None:
                bad.append(f"{fig} {clip}: not read")
                continue
            p = row["pack"]
            for third in ("top", "middle", "bottom"):
                if p[third]["n"] < MIN_THIRD or p[third]["misses"] > MAX_MISSES:
                    bad.append(f"{fig} {clip}: the pack's {third} third read {p[third]['n']} cells and missed the trunk in {p[third]['misses']}: not a reading")
            if any(p[t]["n"] < MIN_THIRD for t in ("top", "middle", "bottom")):
                continue
            if p["bottom"]["median"] > PACK_BOTTOM[fig][clip]:
                bad.append(f"{fig} {clip}: the pack's lower third stands a median {mm(p['bottom']['median'])} mm off the back, ceiling {mm(PACK_BOTTOM[fig][clip])}")
            for third in ("top", "middle"):
                if p[third]["median"] > PACK_UPPER[fig]:
                    bad.append(f"{fig} {clip}: the pack's {third} third stands a median {mm(p[third]['median'])} mm off the back, ceiling {mm(PACK_UPPER[fig])}")
            least = min(p[t]["min"] for t in ("top", "middle", "bottom"))
            if least < PACK_MIN[fig]:
                bad.append(f"{fig} {clip}: the pack's face comes to {mm(least)} mm of the trunk (negative: inside it), floor {mm(PACK_MIN[fig])}")
            bp_ = row.get("bag_plate")
            if bp_ is None or bp_["n"] < 80:
                bad.append(f"{fig} {clip}: the bag against the kit's plate: {0 if bp_ is None else bp_['n']} cells read: not a reading")
            elif bp_["inside"] > 0:
                bad.append(f"{fig} {clip}: {bp_['inside']} of {bp_['n']} cells of the bag's face are INSIDE the kit's plate (deepest {mm(-bp_['min'])} mm): the pack is not seated over it")
            s = row.get("strap")
            if s is None or s["n"] < 100:
                bad.append(f"{fig} {clip}: the straps over the shoulder: {0 if s is None else s['n']} body-side vertices: not a reading")
            else:
                for stat in ("median", "p90"):
                    if s[stat] > STRAP[fig][stat]:
                        bad.append(f"{fig} {clip}: the shoulder straps stand {mm(s[stat])} mm off the shoulder ({stat}), ceiling {mm(STRAP[fig][stat])}")
            g = row.get("gas_detector")
            if g is None or g["n"] < 100:
                bad.append(f"{fig} {clip}: the gas detector: {0 if g is None else g['n']} vertices: not a reading")
            elif clip in GAS_CLEAR_CLIPS and g["arm_pairs"] > 0:
                bad.append(f"{fig} {clip}: {g['arm_pairs']} triangle pairs of the gas detector and an arm cross: it is clear of the arms at rest, in idle and in move")
            elif g["arm_pairs"] > GAS_ARM_PAIRS[fig]:
                bad.append(f"{fig} {clip}: {g['arm_pairs']} triangle pairs of the gas detector and the support arm cross, this man's ceiling {GAS_ARM_PAIRS[fig]}")
            if fig == LEADER:
                d = row.get("detector_foot")
                if d is None or d["n"] < 50:
                    bad.append(f"{fig} {clip}: the detector's foot: not read")
                elif d["max"] > DETECTOR_FOOT_MAX:
                    bad.append(f"{fig} {clip}: the detector's foot stands {mm(d['max'])} mm off the body at its furthest, ceiling {mm(DETECTOR_FOOT_MAX)}")
    return bad


def main():
    glb = os.environ.get("RL_GEAR_GLB") or os.path.join(REPO, "art", "meshes", "yahalom_squad.glb")
    reading = read(glb)
    bad = failures(reading)
    for b in bad:
        print("FAIL", b)
    for fig in FIGURES:
        if fig not in reading:
            continue
        r = reading[fig]
        rows = dict(r["clips"], rest=r["rest"])
        g = lambda c, t: (f"{1000 * rows[c]['pack'][t]['median']:.0f}" if rows[c]["pack"][t]["n"] else "-")  # noqa: E731
        print(f"yahalom_squad {fig}: pack off the back, median mm top/middle/bottom: " + "; ".join(f"{c} {g(c, 'top')}/{g(c, 'middle')}/{g(c, 'bottom')}" for c in ROWS if c in rows))
        print(f"yahalom_squad {fig}: bag cells inside the plate " + "/".join(str(rows[c].get("bag_plate", {}).get("inside", "-")) for c in ROWS if c in rows)
              + "; straps off the shoulder median/p90 mm " + "; ".join(f"{c} {1000 * rows[c]['strap']['median']:.0f}/{1000 * rows[c]['strap']['p90']:.0f}" for c in ROWS if c in rows and "strap" in rows[c])
              + "; gas detector x arm triangle pairs " + "; ".join(f"{c} {rows[c]['gas_detector']['arm_pairs']}" for c in ROWS if c in rows and "gas_detector" in rows[c]))
    print("yahalom_squad gear standoff: " + ("FAIL" if bad else "held"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
