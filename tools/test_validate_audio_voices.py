"""Guards validate_audio.py's voice half (WP-AU1 §6, R-6, R-7, R-8).

Run: python3 tools/test_validate_audio_voices.py
Exits non-zero on failure. Dependency-free, like test_gen_audio_args.py.
Every case builds a manifest fragment and a scratch audio directory, so
nothing under assets/ is read or written, and no sample is ever touched (D5).
"""
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FACTIONS = {"kdf", "ashwar", "sarim", "rif", "civilian"}


def load():
    spec = importlib.util.spec_from_file_location("validate_audio", os.path.join(HERE, "validate_audio.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def variant(**over):
    v = {
        "file": "voice/he/infantry/move_01a.ogg",
        "license": "LicenseRef-owned",
        "source": "session record 2026-10-01, release form RL-V-001",
        "generator": "recorded",
        "text": "זזים",
        "translit": "zazim",
        "en": "moving",
    }
    v.update(over)
    return {k: x for k, x in v.items() if x is not None}


def voices(lines, languages=None, gain=0.8):
    return {"gain": gain, "languages": languages or {"kdf": "he", "sarim": "ar"}, "lines": lines}


def run(mod, section, files=()):
    with tempfile.TemporaryDirectory() as d:
        for rel in files:
            p = os.path.join(d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as fh:
                fh.write(b"OggS")
        failures = []
        declared = mod.check_voices(section, failures, FACTIONS, audio_dir=d)
        return failures, declared


def main():
    mod = load()
    bad = []

    def check(label, failures, want):
        ok = (not failures) if want is None else any(want in f for f in failures)
        print(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f" -- got {failures}"))
        if not ok:
            bad.append(label)

    good = variant()
    f, declared = run(mod, voices({"he.infantry.move": {"variants": [good]}}), [good["file"]])
    check("an owned, sourced, scripted line passes", f, None)
    if declared != {good["file"]}:
        print(f"FAIL the passing line is returned for the undeclared-file sweep -- got {declared}")
        bad.append("declared")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": []}, "ar.crew.death": {"variants": []}}))
    check("every line empty passes -- the engine ships with no assets", f, None)

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(license=None)]}}), [good["file"]])
    check("no licence fails", f, "not redistribution-safe")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(license="ElevenLabs-free")]}}), [good["file"]])
    check("an unlisted licence fails (D5: the free tier is not commercial)", f, "not redistribution-safe")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(source=None)]}}), [good["file"]])
    check("no source fails", f, "no 'source'")

    for field in ("generator", "text", "translit", "en"):
        f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(**{field: None})]}}), [good["file"]])
        check(f"no {field} fails", f, f"no '{field}'")

    # This fixture has no underscore anywhere, not merely a space standing in
    # for one -- it exercises the missing `_<nn><take>` delimiter, not space
    # rejection specifically. Kept as its own case; see the two below for the
    # space itself, which review (fix round 1) found this one did not cover.
    no_underscore = variant(file="voice/he/infantry/move 01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [no_underscore]}}), [no_underscore["file"]])
    check("a filename missing the _<nn><take> delimiter fails", f, "not voice/")

    # A space where an ASCII path character is otherwise legal, with the
    # `_<nn><take>.ext` suffix left intact -- isolates space rejection from
    # the missing-underscore case above (fix round 1, review finding).
    spaced_trigger = variant(file="voice/he/infantry/move x_01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [spaced_trigger]}}), [spaced_trigger["file"]])
    check("a space in the trigger segment fails", f, "not voice/")

    spaced_segment = variant(file="voice/he/infan try/move_01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [spaced_segment]}}), [spaced_segment["file"]])
    check("a space in the class segment fails", f, "not voice/")

    hebrew = variant(file="voice/he/infantry/זזים_01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [hebrew]}}), [hebrew["file"]])
    check("a Hebrew filename fails", f, "not voice/")

    wrong = variant(file="voice/he/crew/move_01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [wrong]}}), [wrong["file"]])
    check("a file filed under another key fails", f, "different key")

    outside = variant(file="battle/x_01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [outside]}}), [outside["file"]])
    check("a file outside voice/ entirely fails", f, "not voice/")

    alt = variant(alt="voice/he/infantry/move_01a.m4a")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [alt]}}), [alt["file"], alt["alt"]])
    check("an m4a alt of the same key passes", f, None)

    f, _ = run(mod, voices({"fr.infantry.move": {"variants": []}}))
    check("a key in a language no faction speaks fails", f, "no faction speaks")

    f, _ = run(mod, voices({"he.infantry": {"variants": []}}))
    check("a key that is not <lang>.<class>.<trigger> fails", f, "is not <lang>")

    f, _ = run(mod, voices({}, languages={"kdf": "he", "civilian": "ar"}))
    check("civilians mapped to a language fail (D10)", f, "civilians never speak")

    f, _ = run(mod, voices({}, languages={"kdf": "he", "martians": "ar"}))
    check("an unknown faction fails", f, "unknown faction")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [good]}}))
    check("a declared file missing on disk fails", f, "missing from assets/audio/")

    f, _ = run(mod, voices({}, gain=1.2))
    check("a voice gain above 1 fails -- a voice is unplaced, like a UI cue", f, "outside 0..1")

    # R-7: the owned licence is for voices only; a battle clip stays CC0/CC-BY.
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "battle"))
        with open(os.path.join(d, "battle", "x.ogg"), "wb") as fh:
            fh.write(b"OggS")
        failures = []
        mod.check_licensed_file(
            {"file": "battle/x.ogg", "license": "LicenseRef-owned", "source": "x"}, failures, mod.MAX_BYTES, audio_dir=d
        )
        check("LicenseRef-owned stays voice-only", failures, "not redistribution-safe")

    if bad:
        print(f"\n{len(bad)} voice gate case(s) failed")
        return 1
    print("\nvoice gate: all cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
