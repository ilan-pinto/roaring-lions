"""Guards validate_audio.py's music-bed check (AU-7, the calm and battle beds
re-cut from the theme by tools/recut_music.py).

Run: python3 tools/test_validate_audio_music.py
Exits non-zero on failure. Dependency-free, like the ambience test beside it:
every case builds a manifest fragment over a scratch directory, and the
decoder (`measure`) is replaced by fixed readings, so neither ffmpeg nor
anything under assets/ is touched.
"""
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    spec = importlib.util.spec_from_file_location("validate_audio", os.path.join(HERE, "validate_audio.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# What the shipped files read: battle -15.0 LUFS, calm -17.0, heard at
# battle_gain 0.26 and master 0.9 as -27.6 and -29.6.
READ = {
    "calm": {"channels": 2, "seconds": 18.2509, "integrated": -17.0, "true_peak": -2.7, "seam_level_db": 0.9, "seam_gap_db": 6.9},
    "battle": {"channels": 2, "seconds": 41.7495, "integrated": -15.0, "true_peak": -3.0, "seam_level_db": 4.8, "seam_gap_db": 2.6},
}


def main():
    mod = load()
    bad = []

    def check(label, failures, want):
        ok = (not failures) if want is None else any(want in f for f in failures)
        print(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f" -- got {failures}"))
        if not ok:
            bad.append(label)

    def bed(name, **over):
        b = {
            "file": f"music/t_{name}.ogg", "alt": f"music/t_{name}.m4a", "trim_db": 0, "loop_s": READ[name]["seconds"],
            "channels": 2, "license": "CC-BY-4.0", "credit": "Ilan Pinto", "source": "re-cut from the theme",
        }
        b.update(over)
        return b

    def beds(**over):
        return {"calm": over.pop("calm", bed("calm")), "battle": over.pop("battle", bed("battle"))}

    def run(the_beds, reading=None, music=None, master=0.9):
        """(failures, notes, declared). `reading` maps a bed name to what its
        files decode to; None stands for no ffmpeg on PATH."""
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "music"))
            for name in ("t_calm.ogg", "t_calm.m4a", "t_battle.ogg", "t_battle.m4a"):
                with open(os.path.join(d, "music", name), "wb") as fh:
                    fh.write(b"OggS")
            failures, notes = [], []
            man = {"master_gain": master, "music": dict(music or {"gain": 0.4, "battle_gain": 0.26}, beds=the_beds)}

            def measure(path):
                if reading is None:
                    return None
                return reading["calm" if "calm" in os.path.basename(path) else "battle"]

            declared = mod.check_music_beds(man, failures, notes, audio_dir=d, measure=measure)
            return failures, notes, declared

    def reading(name, **over):
        r = {k: dict(v) for k, v in READ.items()}
        r[name].update(over)
        return r

    f, n, declared = run(beds(), READ)
    check("the shipped readings pass", f, None)
    ok = declared == {"music/t_calm.ogg", "music/t_calm.m4a", "music/t_battle.ogg", "music/t_battle.m4a"}
    print(f"{'ok  ' if ok else 'FAIL'} all four encodings are declared for the undeclared-file sweep")
    if not ok:
        bad.append("declared")
    ok = any("heard -27.6 LUFS" in x for x in n) and any("heard -29.6 LUFS" in x for x in n)
    print(f"{'ok  ' if ok else 'FAIL'} the heard level is file + trim + battle_gain + master")
    if not ok:
        bad.append("heard arithmetic")
    ok = any("seam step 4.8 dB (reported)" in x for x in n)
    print(f"{'ok  ' if ok else 'FAIL'} the battle loop's fill-into-downbeat step is reported, not failed")
    if not ok:
        bad.append("step reported")

    check("no beds is fine (the theme plays in a mission)", run(None, READ)[0], None)
    check("calm alone fails", run({"calm": bed("calm")}, READ)[0], "exactly `calm` and `battle`")
    check("a third bed fails", run(dict(beds(), tension=bed("battle")), READ)[0], "exactly `calm` and `battle`")
    check("a bed with no file fails", run(beds(calm={"loop_s": 18.25}), READ)[0], "no file")
    check("a non-CC licence fails", run(beds(calm=bed("calm", license="royalty-free")), READ)[0], "not redistribution-safe")
    check("CC-BY with no credit fails", run(beds(calm=bed("calm", credit=None)), READ)[0], "requires a 'credit'")
    check("a missing encoding fails", run(beds(battle=bed("battle", alt="music/gone.m4a")), READ)[0], "missing from assets/audio/")
    check("a trim over 0 dB fails", run(beds(calm=bed("calm", trim_db=3)), READ)[0], "trim_db 3 outside")
    check("a 4 s loop fails", run(beds(calm=bed("calm", loop_s=4.0)), READ)[0], "loop_s 4.0 outside")
    check("three channels fail", run(beds(calm=bed("calm", channels=3)), READ)[0], "is not 1 (mono) or 2")

    check("a mono file declared stereo fails", run(beds(), reading("calm", channels=1))[0], "decodes to 1 channel(s)")
    check("AAC padding left in (10 ms long) fails", run(beds(), reading("battle", seconds=41.7600))[0], "priming or padding")
    check("a peak over -1 dBTP fails", run(beds(), reading("battle", true_peak=-0.5))[0], "over -1.0 dBTP")
    check("a gap at the seam fails", run(beds(), reading("calm", seam_gap_db=-20.0))[0], "a gap at the loop's seam")
    check("battle 4 LU too loud fails", run(beds(), reading("battle", integrated=-11.0))[0], "outside -26.0 +- 2.0")
    check("calm 3 LU too quiet fails", run(beds(), reading("calm", integrated=-21.5))[0], "outside -28.0 +- 2.0")
    check(
        "calm louder than battle fails",
        run(beds(), reading("calm", integrated=-14.5) | {"battle": dict(READ["battle"], integrated=-15.3)})[0],
        "louder than battle",
    )

    f, n, _ = run(beds(), None)
    check("no ffmpeg is a named skip, not a pass or a failure", f, None)
    ok = any("NOT measured" in x for x in n)
    print(f"{'ok  ' if ok else 'FAIL'} the skip is named in the notes")
    if not ok:
        bad.append("skip named")

    if bad:
        print(f"\n{len(bad)} music-bed case(s) failed", file=sys.stderr)
        return 1
    print("validate_audio music beds: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
