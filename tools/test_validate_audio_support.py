"""Guards validate_audio.py's fire-support rules (GH-782).

Run: python3 tools/test_validate_audio_support.py
Exits non-zero on failure. Dependency-free, like the other validate_audio
guards: the per-rule cases call the check functions over manifest fragments
with the decoder (`measure`) and the length probe replaced by fixed readings,
and the whole-gate cases run a COPY of validate_audio.py over a scratch tree,
so nothing under assets/ is touched and the CLI's own wiring is what is judged.
Each case is one input a rule must turn red on, beside the passing one it was
cut from.
"""
import copy
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load():
    spec = importlib.util.spec_from_file_location("validate_audio", os.path.join(HERE, "validate_audio.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


OWNED = {"license": "LicenseRef-owned", "credit": "Ilan Pinto", "source": "AI-generated with ElevenLabs Sound Effects"}


def variant(path):
    stem = path.rsplit(".", 1)[0]
    return {"file": path, "alt": stem + ".m4a", **OWNED}


def strike_set(**over):
    s = {"event": "strike", "profiles": ["mortar_barrage"], "gain": 1.0, "pitch_jitter": 0.1,
         "variants": [variant("barrage_impact/barrage_impact_01.ogg")]}
    s.update(over)
    return s


def flyby_set(**over):
    s = {"event": "flyby", "profiles": ["air_strike"], "radius_tiles": 40, "crest_s": 1.8, "gain": 1.0, "pitch_jitter": 0.04,
         "variants": [variant("jet_flyby/jet_flyby_01.ogg")]}
    s.update(over)
    return s


def incoming_set(**over):
    s = {"event": "incoming", "profiles": ["mortar_barrage"], "gain": 1.0, "pitch_jitter": 0.05,
         "variants": [variant("incoming_whistle/incoming_whistle_01.ogg")]}
    s.update(over)
    return s


# A rotor loop as shipped: -23.6 LUFS file, gain 0.5, master 0.9, on station
# 4 of 30 tiles out (attenuation 0.751) is heard at -33.0 LUFS.
GOOD_READING = {"channels": 1, "seconds": 5.805, "integrated": -23.6, "true_peak": -8.5, "seam_level_db": 1.0, "seam_gap_db": 1.0}


def rotor(**over):
    r = {"file": "support/rotor_loop.ogg", "alt": "support/rotor_loop.m4a", "loop_s": 5.805, "channels": 1, "gain": 0.5,
         "radius_tiles": 30, **OWNED}
    r.update(over)
    return r


def main():
    mod = load()
    bad = []

    def check(label, failures, want):
        """want None: no failures; else some failure contains `want`."""
        ok = (not failures) if want is None else any(want in f for f in failures)
        print(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f" -- got {failures}"))
        if not ok:
            bad.append(label)

    def fields(name, spec):
        f = []
        mod.check_set_fields(name, spec, f)
        return f

    # --- profiles -------------------------------------------------------------
    check("a strike set keyed on a profile is clean", fields("barrage_impact", strike_set()), None)
    check("a strike set with no profiles is the default and is clean", fields("s", {k: v for k, v in strike_set().items() if k != "profiles"}), None)
    check("profiles on a fire set is refused", fields("tank_gun", {"event": "fire", "weapon_classes": ["he"], "profiles": ["air_strike"]}),
          "profiles is only for")
    check("profiles on a destroyed set is refused", fields("d", {"event": "destroyed", "profiles": ["air_strike"]}), "profiles is only for")
    check("smoke_screen is refused by name", fields("s", strike_set(profiles=["smoke_screen"])), "can never play")
    check("an unknown profile is refused", fields("s", strike_set(profiles=["drone_sweep"])), "unknown profile")
    check("an empty profile list is refused", fields("s", strike_set(profiles=[])), "non-empty list")
    check("a flyby set must name its profiles", fields("j", {k: v for k, v in flyby_set().items() if k != "profiles"}), "names its profiles")
    check("an incoming set must name its profiles", fields("w", {k: v for k, v in incoming_set().items() if k != "profiles"}), "names its profiles")

    # --- weapon classes are for fire sets ---------------------------------------
    for mk, ev in ((strike_set, "strike"), (flyby_set, "flyby"), (incoming_set, "incoming")):
        check(f"weapon_classes on a {ev} set is refused", fields("x", mk(weapon_classes=["he"])), "weapon_classes is for fire sets")

    # --- radius_tiles -----------------------------------------------------------
    check("radius_tiles 40 on a positional set is clean", fields("j", flyby_set()), None)
    check("radius_tiles on a fire set is clean", fields("t", {"event": "fire", "weapon_classes": ["he"], "radius_tiles": 30}), None)
    check("radius_tiles on a ui set is refused", fields("u", {"event": "ui", "radius_tiles": 20}), "ui set")
    check("radius_tiles 0 is refused", fields("j", flyby_set(radius_tiles=0)), "outside (0, 48]")
    check("radius_tiles 49 is refused", fields("j", flyby_set(radius_tiles=49)), "outside (0, 48]")
    check("radius_tiles 48 is the ceiling and is clean", fields("j", flyby_set(radius_tiles=48)), None)
    check("a string radius_tiles is refused", fields("j", flyby_set(radius_tiles="40")), "outside (0, 48]")

    # --- crest_s ------------------------------------------------------------------
    check("a flyby set without crest_s is refused", fields("j", {k: v for k, v in flyby_set().items() if k != "crest_s"}), "needs crest_s")
    check("crest_s 0 is refused", fields("j", flyby_set(crest_s=0)), "needs crest_s")
    check("crest_s on a strike set is refused", fields("s", strike_set(crest_s=1.0)), "only for a flyby set")
    check("crest_s on a fire set is refused", fields("t", {"event": "fire", "crest_s": 1.0}), "only for a flyby set")

    # --- one profile, one set, per event -------------------------------------------
    def claims(sets):
        f = []
        mod.check_profile_claims(sets, f)
        return f

    check("two strike sets on one profile are refused",
          claims({"a": strike_set(), "b": strike_set(variants=[variant("x/x_01.ogg")])}), "claimed by more than one set")
    check("two default strike sets are refused",
          claims({"a": {"event": "strike"}, "b": {"event": "strike"}}), "default")
    check("a profile set and a default set coexist",
          claims({"a": strike_set(), "b": {"event": "strike"}}), None)
    check("one profile on two EVENTS is fine (the strike and the flyby are different sounds)",
          claims({"a": strike_set(profiles=["air_strike"]), "b": flyby_set()}), None)
    check("a profile listed twice is a duplicate claim", claims({"a": strike_set(profiles=["air_strike", "air_strike"])}), "claimed by more than one set")
    check("fire sets are not profile claims", claims({"a": {"event": "fire"}, "b": {"event": "fire"}}), None)

    # --- crest_s inside every clip --------------------------------------------------
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "jet_flyby"))
        for ext in ("ogg", "m4a"):
            open(os.path.join(d, f"jet_flyby/jet_flyby_01.{ext}"), "wb").write(b"x")

        def crest(spec, seconds):
            f, n = [], []
            mod.check_crest("jet_flyby", spec, f, n, audio_dir=d, probe=lambda p: seconds)
            return f, n

        check("crest_s inside the clip is clean", crest(flyby_set(), 5.0)[0], None)
        check("crest_s past the end of the clip is refused", crest(flyby_set(crest_s=5.5), 5.0)[0], "not inside the clip")
        check("crest_s equal to the clip's length is refused", crest(flyby_set(crest_s=5.0), 5.0)[0], "not inside the clip")
        f, n = crest(flyby_set(), None)
        check("without ffprobe the check says so by name", f, None)
        print(f"{'ok  ' if any('NOT checked' in x for x in n) else 'FAIL'} ...and the note names the skip")
        if not any("NOT checked" in x for x in n):
            bad.append("crest skip note")

    # --- the rotor block ----------------------------------------------------------------
    def rotor_run(spec, reading=GOOD_READING, files=True, extra=None):
        with tempfile.TemporaryDirectory() as d:
            if files:
                os.makedirs(os.path.join(d, "support"))
                for ext in ("ogg", "m4a"):
                    open(os.path.join(d, f"support/rotor_loop.{ext}"), "wb").write(b"x")
            block = {"rotor": spec}
            block.update(extra or {})
            f, n = [], []
            declared = mod.check_support_air({"master_gain": 0.9, "support_air": block}, f, n, audio_dir=d, measure=lambda p: reading)
            return f, n, declared

    f, n, declared = rotor_run(rotor())
    check("the rotor as shipped is clean", f, None)
    print(f"{'ok  ' if declared == {'support/rotor_loop.ogg', 'support/rotor_loop.m4a'} else 'FAIL'} ...and both its files are declared")
    if declared != {"support/rotor_loop.ogg", "support/rotor_loop.m4a"}:
        bad.append("rotor declared files")
    check("a rotor heard louder than -30 LUFS on station is refused",
          rotor_run(rotor(), dict(GOOD_READING, integrated=-19.0))[0], "over the rotor ceiling")
    check("a rotor at exactly the ceiling is clean (-30.0 on station)",
          rotor_run(rotor(), dict(GOOD_READING, integrated=-20.6))[0], None)
    check("the ceiling is the level ON STATION: a short radius (6 tiles, 4 out) lets a louder file through",
          rotor_run(rotor(radius_tiles=6), dict(GOOD_READING, integrated=-12.0))[0], None)
    check("a rotor of the wrong channel count is refused", rotor_run(rotor(), dict(GOOD_READING, channels=2))[0], "decodes to 2 channel")
    check("a rotor whose decoded length differs from loop_s is refused", rotor_run(rotor(), dict(GOOD_READING, seconds=5.9))[0], "the loop is")
    check("a rotor over the -6 dBTP ceiling is refused", rotor_run(rotor(), dict(GOOD_READING, true_peak=-3.0))[0], "rotor ceiling")
    check("a rotor whose seam steps is refused", rotor_run(rotor(), dict(GOOD_READING, seam_level_db=3.5))[0], "seam steps")
    check("a rotor with a gap at the seam is refused", rotor_run(rotor(), dict(GOOD_READING, seam_gap_db=-9.0))[0], "gap at the loop's seam")
    check("a rotor gain over 1 is refused", rotor_run(rotor(gain=1.2))[0], "outside (0, 1]")
    check("a rotor loop outside 4..8 s is refused", rotor_run(rotor(loop_s=2.0))[0], "loop_s")
    check("a stereo rotor declaration is refused", rotor_run(rotor(channels=2))[0], "mono")
    check("a rotor radius that cannot reach its station is refused", rotor_run(rotor(radius_tiles=4))[0], "radius_tiles")
    check("a rotor with no radius is refused", rotor_run({k: v for k, v in rotor().items() if k != "radius_tiles"})[0], "radius_tiles")
    check("an unlicensed rotor is refused", rotor_run(rotor(license="proprietary"))[0], "not redistribution-safe")
    check("a rotor with no source is refused", rotor_run({k: v for k, v in rotor().items() if k != "source"})[0], "no 'source'")
    check("a missing rotor file is refused", rotor_run(rotor(), files=False)[0], "missing from assets/audio/")
    check("an unknown support_air entry is refused", rotor_run(rotor(), extra={"gunship": {}})[0], "unknown entry")
    f = []
    mod.check_support_air({"support_air": {"$comment": "x"}}, f, [])
    check("a support_air block without a rotor is legal (a commercial build strips it)", f, None)

    # --- the commercial gate -----------------------------------------------------------------
    unconfirmed = dict(OWNED, source="ElevenLabs; plan and date not recorded, commercial licence NOT yet confirmed")
    man = {"sets": {"barrage_impact": strike_set(variants=[dict(variant("barrage_impact/barrage_impact_01.ogg"), **unconfirmed)])},
           "support_air": {"rotor": rotor(**unconfirmed)}}
    f = []
    mod.check_commercial(man, f)
    check("the commercial gate sees a strike variant", [x for x in f if "barrage_impact" in x], "licence not confirmed")
    check("the commercial gate sees the rotor", [x for x in f if "rotor_loop" in x], "licence not confirmed")
    stripped, excluded = mod.commercial_manifest(copy.deepcopy(man))
    ok = ("rotor" not in stripped["support_air"] and stripped["sets"]["barrage_impact"]["variants"] == []
          and "support/rotor_loop.ogg" in excluded and "support/rotor_loop.m4a" in excluded
          and "barrage_impact/barrage_impact_01.ogg" in excluded)
    print(f"{'ok  ' if ok else 'FAIL'} the commercial manifest leaves the rotor and the strike variants out")
    if not ok:
        bad.append("commercial strip")
    f = []
    mod.check_commercial(stripped, f)
    check("...and the stripped manifest is clean", f, None)

    # --- the whole gate, over a scratch tree --------------------------------------------------
    def wav_bytes(seconds):
        import io
        import wave
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(8000)
            w.writeframes(b"\x00\x00" * int(8000 * seconds))
        return buf.getvalue()

    def gate(sets, rotor_spec=None, on_disk=(), audio_seconds=None):
        """Run a COPY of validate_audio.py over a scratch tree; (exit code, output)."""
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "tools"))
            os.makedirs(os.path.join(d, "data", "schemas"))
            shutil.copy(os.path.join(HERE, "validate_audio.py"), os.path.join(d, "tools", "validate_audio.py"))
            shutil.copy(os.path.join(ROOT, "data", "schemas", "unit.schema.json"), os.path.join(d, "data", "schemas"))
            man = {"version": 1, "master_gain": 0.9, "sets": sets}
            if rotor_spec is not None:
                man["support_air"] = {"rotor": rotor_spec}
            with open(os.path.join(d, "data", "audio.json"), "w") as fh:
                json.dump(man, fh)
            paths = set(on_disk)
            for s in sets.values():
                for v in s.get("variants", []):
                    paths |= {v["file"], v["alt"]}
            if rotor_spec:
                paths |= {rotor_spec["file"], rotor_spec["alt"]}
            for rel in paths:
                os.makedirs(os.path.dirname(os.path.join(d, "assets", "audio", rel)), exist_ok=True)
                with open(os.path.join(d, "assets", "audio", rel), "wb") as fh:
                    # ffprobe sniffs content, not the extension: a real WAV under an .ogg name has a real length
                    fh.write(b"x" if audio_seconds is None else wav_bytes(audio_seconds))
            r = subprocess.run([sys.executable, os.path.join(d, "tools", "validate_audio.py")], capture_output=True, text=True)
            return r.returncode, r.stdout + r.stderr

    owned_battle = {"event": "fire", "weapon_classes": ["small_arms"], "variants": [variant("small_arms/small_arms_01.ogg")]}
    code, out = gate({"small_arms": owned_battle})
    check("an ordinary battle set may NOT declare LicenseRef-owned", [out] if code == 1 else [], "not redistribution-safe")
    code, out = gate({"barrage_impact": strike_set()})
    check("a strike set may declare LicenseRef-owned", [] if code == 0 else [out], None)
    code, out = gate({"jet_flyby": flyby_set()})
    check("a flyby set may declare LicenseRef-owned", [] if code == 0 else [out], None)
    code, out = gate({"incoming_whistle": incoming_set()})
    check("an incoming set may declare LicenseRef-owned", [] if code == 0 else [out], None)
    code, out = gate({"ui_x": {"event": "ui", "variants": [variant("ui_x/ui_x_01.ogg")]}})
    check("a ui set may NOT declare LicenseRef-owned", [out] if code == 1 else [], "not redistribution-safe")
    if shutil.which("ffprobe") is None:
        print("skip crest_s in the whole gate: no ffprobe on PATH (the per-rule cases above ran with a fake probe)")
    else:
        code, out = gate({"jet_flyby": flyby_set(crest_s=1.8)}, audio_seconds=1.0)
        check("the gate fails a crest_s past a real clip's length (ffprobe)", [out] if code == 1 else [], "not inside the clip")
        code, out = gate({"jet_flyby": flyby_set(crest_s=0.5)}, audio_seconds=1.0)
        check("...and passes one inside it", [] if code == 0 else [out], None)
    code, out = gate({"a": strike_set(), "b": strike_set(variants=[variant("barrage_impact/barrage_impact_02.ogg")])})
    check("the gate fails on a duplicate profile claim", [out] if code == 1 else [], "claimed by more than one set")
    code, out = gate({"barrage_impact": strike_set()}, rotor_spec=rotor())
    check("the gate passes a declared rotor (its files are not 'on disk but not declared')", [] if code == 0 else [out], None)
    code, out = gate({"barrage_impact": strike_set()}, on_disk=["support/rotor_loop.ogg"])
    check("a rotor file on disk with no rotor block is undeclared", [out] if code == 1 else [], "on disk but not declared")
    code, out = gate({"barrage_impact": strike_set(profiles=["smoke_screen"])})
    check("the gate fails on smoke_screen", [out] if code == 1 else [], "smoke_screen")

    # --- the pins against TypeScript ----------------------------------------------------------
    ts = open(os.path.join(ROOT, "packages", "render", "src", "audio.ts")).read()
    m = re.search(r"export const AUDIO_SUPPORT_PROFILES[^{]*\{([^}]*)\}", ts)
    names = set(re.findall(r"(\w+)\s*:", m.group(1))) if m else set()
    ok = names == mod.KNOWN_PROFILES
    print(f"{'ok  ' if ok else 'FAIL'} AUDIO_SUPPORT_PROFILES (audio.ts) names exactly KNOWN_PROFILES -- {sorted(names)}")
    if not ok:
        bad.append("profile pin")
    air = open(os.path.join(ROOT, "packages", "render", "src", "three", "support-air.ts")).read()
    m = re.search(r"export const HELI_STATION_TILES\s*=\s*([\d.]+)", air)
    ok = bool(m) and float(m.group(1)) == mod.ROTOR_STATION_TILES
    print(f"{'ok  ' if ok else 'FAIL'} HELI_STATION_TILES (support-air.ts) is ROTOR_STATION_TILES -- {m.group(1) if m else None}")
    if not ok:
        bad.append("station pin")
    ok = mod.SUPPORT_EVENTS <= mod.KNOWN_EVENTS
    print(f"{'ok  ' if ok else 'FAIL'} the support events are known events")
    if not ok:
        bad.append("events known")

    # --- the shipped manifest ---------------------------------------------------------------------
    with open(os.path.join(ROOT, "data", "audio.json")) as fh:
        shipped = json.load(fh)
    f = []
    mod.check_profile_claims(shipped["sets"], f)
    for name, spec in shipped["sets"].items():
        mod.check_set_fields(name, spec, f)
    check("the shipped manifest passes the support rules", f, None)
    events = {spec["event"] for spec in shipped["sets"].values()}
    print(f"{'ok  ' if {'strike', 'flyby', 'incoming'} <= events else 'FAIL'} the shipped manifest declares strike, flyby and incoming sets")
    if not {"strike", "flyby", "incoming"} <= events:
        bad.append("shipped support sets")
    claimed = {p for s in shipped["sets"].values() if s["event"] in ("strike", "flyby") for p in s.get("profiles", [])}
    print(f"{'ok  ' if claimed == mod.KNOWN_PROFILES else 'FAIL'} both profiles have a strike or flyby set -- {sorted(claimed)}")
    if claimed != mod.KNOWN_PROFILES:
        bad.append("profile coverage")

    if bad:
        print(f"\n{len(bad)} support case(s) failed", file=sys.stderr)
        return 1
    print("validate_audio support: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
