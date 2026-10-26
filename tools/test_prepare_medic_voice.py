"""Guards tools/prepare_medic_voice.py (GH-753): what the lead's "Medic!" takes become.
Run: python3 tools/test_prepare_medic_voice.py

Exits non-zero on failure. Needs numpy and ffmpeg (as the audio gate does in CI). Every case
builds synthetic WAVs in a scratch folder and runs the prepare step against a scratch COPY of
the repository's audio tree, manifest and provenance register, so nothing in the checkout is
written. Each rule has an input that turns it red beside the passing input it was cut from.
"""
import copy
import datetime
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pmv = load("prepare_medic_voice")
va = load("validate_audio")
cpr = load("check_provenance_register")
SR = 48000


def shout(seconds=0.8, lead=0.3, tail=0.3, peak=0.5, seed=1):
    """A voiced burst (150 Hz, harmonics, a little vibrato and noise) between two silences."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f0 = 150 + 20 * np.sin(2 * np.pi * 5 * t)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    x = sum(np.sin(h * phase) / h for h in range(1, 9)) + 0.05 * rng.standard_normal(n)
    x *= np.minimum(1, np.minimum(t / 0.03, (t[-1] - t) / 0.08))
    x = x / np.abs(x).max() * peak
    return np.concatenate([np.zeros(int(lead * SR)), x, np.zeros(int(tail * SR))])


def write_wav(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        s = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
        w.writeframes(np.stack([s, s], axis=1).tobytes())


def tree(root):
    """A scratch copy of what the prepare step reads and writes."""
    for rel in ("data/audio.json", "docs/ASSET_PROVENANCE.md", "tools/validate_audio.py", "packages/app/src/i18n/en.json", "data/schemas/unit.schema.json"):
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        shutil.copyfile(os.path.join(REPO, rel), os.path.join(root, rel))
    shutil.copytree(os.path.join(REPO, "assets", "audio"), os.path.join(root, "assets", "audio"))
    shutil.copytree(os.path.join(REPO, "data", "units"), os.path.join(root, "data", "units"))   # the gate reads the unit factions
    return root


def snapshot(root):
    out = {}
    for base, _, names in os.walk(root):
        for n in names:
            p = os.path.join(base, n)
            out[os.path.relpath(p, root)] = os.path.getmtime(p), os.path.getsize(p)
    return out


def run(src, root, **kw):
    log = []
    try:
        own = kw.pop("own", False)
        pmv.run(src, kw.pop("paid", not own), root=root, log=log.append, gate=kw.pop("gate", False), own_recording=own, **kw)
        return None, log
    except pmv.Refusal as e:
        return str(e), log


def main():
    bad = []

    def check(label, ok, detail=""):
        print(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f" -- {detail}"))
        if not ok:
            bad.append(label)

    if not shutil.which("ffmpeg"):
        print("FAIL ffmpeg is not on PATH; the audio gate needs it (CI installs it)")
        return 1

    # --- pure rules ---------------------------------------------------------------
    flat = np.zeros(1000)
    check("no samples at full scale: no clipped run", pmv.clipped_run(flat) == 0)
    one = flat.copy(); one[10] = 1.0
    check("one sample at full scale is not a run", pmv.clipped_run(one) == 1)
    two = flat.copy(); two[10:13] = -1.0
    check("three in a row is a run of three", pmv.clipped_run(two) == 3, pmv.clipped_run(two))
    check("a run at the very end is counted", pmv.clipped_run(np.concatenate([flat, [1.0, 1.0, 1.0, 1.0]])) == 4)
    check("a future generation date is refused", _raises(lambda: pmv.generated_date([], "2099-01-01"), "future"))
    check("a malformed --generated is refused", _raises(lambda: pmv.generated_date([], "26/10/2026"), "not a date"))

    with tempfile.TemporaryDirectory() as d:
        work = os.path.join(d, "medic")
        os.makedirs(os.path.join(work, "held"))
        for n in ("medic_he_01.wav", "medic_he_02.mp3", "medic_extra.wav", "notes.txt"):
            open(os.path.join(work, n), "wb").write(b"x")
        found, stray = pmv.find_inputs(work)
        check("find_inputs reads wav and mp3 by take name", sorted(found) == ["medic_he_01", "medic_he_02"], sorted(found))
        check("a medic file that is not a take is reported, not used", stray == ["medic_extra.wav"], stray)
        open(os.path.join(work, "medic_he_01.mp3"), "wb").write(b"x")
        check("two files for one take are refused", _raises(lambda: pmv.find_inputs(work), "two files"))

    # --- refusals write nothing ---------------------------------------------------
    with tempfile.TemporaryDirectory() as d:
        root = tree(os.path.join(d, "root"))
        src = os.path.join(d, "src")
        os.makedirs(src)
        write_wav(os.path.join(src, "medic_he_01.wav"), shout())
        before = snapshot(root)
        err, _ = run(src, root, paid=False)
        check("without --paid-plan the run is refused", err is not None and "--paid-plan" in err, err)
        check("... and nothing is written", snapshot(root) == before)
        err, _ = run(src, root, paid=False, own=False)
        check("with neither source mode the run is refused", err is not None and "--own-recording" in err and "exactly one" in err, err)
        err, _ = run(src, root, paid=True, own=True)
        check("both source modes together are refused", err is not None and "exclusive" in err, err)
        check("... and nothing is written by either refusal", snapshot(root) == before)

        write_wav(os.path.join(src, "medic_he_02.wav"), shout(seed=2))
        for label, x, want in (
            ("a clipped take is refused", np.concatenate([shout(), np.ones(5), shout()]), "clipped"),
            ("a silent take is refused", np.zeros(SR), "silent"),
            ("a 0.1 s click is refused", shout(seconds=0.1, lead=0.2, tail=0.2), "under"),
            ("a 3 s speech is refused", shout(seconds=3.0), "over"),
        ):
            write_wav(os.path.join(src, "medic_he_03.wav"), x)
            err, _ = run(src, root)
            check(label, err is not None and want in err and "medic_he_03" in err, err)
            check("... and the good takes beside it write nothing either", snapshot(root) == before)
        # the same take, unclipped and in range, passes (the case each refusal was cut from)
        write_wav(os.path.join(src, "medic_he_03.wav"), shout(seconds=1.0, seed=3))
        err, _ = run(src, root)
        check("the in-range take beside the refused ones is accepted", err is None, err)

    # --- the whole run ------------------------------------------------------------
    with tempfile.TemporaryDirectory() as d:
        root = tree(os.path.join(d, "root"))
        src = os.path.join(d, "src")
        os.makedirs(src)
        names = {"medic_he_01": 0.7, "medic_he_02": 1.1, "medic_he_03": 1.3, "medic_en_01": 0.6}
        for i, (n, secs) in enumerate(names.items()):
            p = os.path.join(src, n + ".wav")
            write_wav(p, shout(seconds=secs, seed=i))
            stamp = datetime.datetime(2026, 10, 20, 12, 0).timestamp()
            os.utime(p, (stamp, stamp))
        man_before = json.load(open(os.path.join(root, "data", "audio.json"), encoding="utf-8"))
        # the shipped slot may already be filled (the lead's own take): what must not move is everything BESIDE it
        man_before["voices"]["lines"][pmv.KEY]["variants"] = []
        man_before["voices"]["announcements"]["events"]["medic"]["audio"] = ""
        text_before = open(os.path.join(root, "data", "audio.json"), encoding="utf-8").read()
        err, log = run(src, root, today=datetime.date(2026, 10, 27))
        check("three Hebrew takes and an English one are prepared", err is None, err)
        man = json.load(open(os.path.join(root, "data", "audio.json"), encoding="utf-8"))
        slot = man["voices"]["lines"][pmv.KEY]["variants"]
        check("the slot holds three variants", [v["file"] for v in slot] == [
            f"voice/he/common/announce_medic_0{n}a.ogg" for n in (1, 2, 3)], [v["file"] for v in slot])
        check("the announcement names the slot", man["voices"]["announcements"]["events"]["medic"]["audio"] == pmv.KEY)
        check("every encoding is on disk, mono-sized and non-empty",
              all(os.path.getsize(os.path.join(root, "assets", "audio", v[k])) > 500 for v in slot for k in ("file", "alt")))
        check("the generation date is the files' date, not the run's", all("2026-10-20" in v["source"] for v in slot), slot[0]["source"])
        check("each source carries its input's sha256", all(pmv.sha256(os.path.join(src, f"medic_he_0{i + 1}.wav")) in v["source"]
                                                          for i, v in enumerate(slot)))
        check("no variant reads as an unconfirmed licence", not any(va.UNCONFIRMED_LICENCE.search(v["source"]) for v in slot))
        check("the English take is held beside the lead's files, not wired",
              os.path.exists(os.path.join(src, "held", "medic_en_01.ogg")) and
              not os.path.exists(os.path.join(root, "assets", "audio", "voice", "en")) and
              all("en" not in v["file"].split("/")[1:2] for v in slot))
        # nothing else in the manifest moved
        man_after = copy.deepcopy(man)
        man_after["voices"]["lines"][pmv.KEY]["variants"] = []
        man_after["voices"]["announcements"]["events"]["medic"]["audio"] = ""
        check("nothing but the slot and the announcement's audio changed in data/audio.json", man_after == man_before)
        text_after = open(os.path.join(root, "data", "audio.json"), encoding="utf-8").read()
        check("... and the \\u-escaped line the file already carries is byte-identical", "\\u05e2\\u05d5\\u05d3" in text_after
              and "\\u05e2\\u05d5\\u05d3" in text_before)

        # the audio gate, run for real on the scratch tree (its own copy of validate_audio.py)
        r = subprocess.run([sys.executable, os.path.join(root, "tools", "validate_audio.py")], capture_output=True, text=True)
        check("validate_audio.py passes on the filled tree", r.returncode == 0, (r.stdout + r.stderr)[-600:])
        failures = []
        va.check_commercial({"voices": {"lines": {pmv.KEY: {"variants": slot}}}}, failures)
        check("the commercial gate passes the new takes", failures == [], failures)
        # ... and the register row covers exactly the files written
        doc = open(os.path.join(root, "docs", "ASSET_PROVENANCE.md"), encoding="utf-8").read()
        pats = [cpr.glob_re(p) for _, p in cpr.register_patterns(doc) if "announce_medic" in p]
        written = sorted(f"assets/audio/{v[k]}" for v in slot for k in ("file", "alt"))
        check("the provenance row covers each written file once",
              all(sum(bool(p.match(f)) for p in pats) == 1 for f in written) and len(pats) == len(written), (len(pats), written))
        check("the status line says filled", "Status: **filled 2026-10-27**" in doc and "empty slot" not in doc)
        check("the row says paid plan, with the date of the takes", "paid ElevenLabs plan" in doc and "2026-10-20" in doc)
        before_doc_rows = doc.count("announce_medic_0{1,2,3}a")
        # --- a re-run with fewer takes converges and removes the stale one
        os.remove(os.path.join(src, "medic_he_03.wav"))
        err, log = run(src, root, today=datetime.date(2026, 10, 27))
        man2 = json.load(open(os.path.join(root, "data", "audio.json"), encoding="utf-8"))
        slot2 = man2["voices"]["lines"][pmv.KEY]["variants"]
        check("a re-run with two takes leaves two variants", err is None and len(slot2) == 2, err)
        check("... and removes the third take's files", not os.path.exists(os.path.join(root, "assets", "audio", "voice", "he", "common", "announce_medic_03a.ogg"))
              and not os.path.exists(os.path.join(root, "assets", "audio", "voice", "he", "common", "announce_medic_03a.m4a")))
        doc2 = open(os.path.join(root, "docs", "ASSET_PROVENANCE.md"), encoding="utf-8").read()
        check("... and the register keeps ONE medic row", sum(1 for l in doc2.splitlines() if l.startswith("|") and "announce_medic" in l.split("|")[1]) == 1
              and before_doc_rows == 1)

        # --- the gate itself goes red on the failure this wiring exists to prevent
        broken = copy.deepcopy(man2)
        broken["voices"]["announcements"]["events"]["medic"]["audio"] = ""
        json.dump(broken, open(os.path.join(root, "data", "audio.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        r = subprocess.run([sys.executable, os.path.join(root, "tools", "validate_audio.py")], capture_output=True, text=True)
        check("takes the announcement does not name turn the gate red", r.returncode != 0 and "never plays" in r.stdout + r.stderr, (r.stdout + r.stderr)[-400:])

    # --- the lead's own recording (--own-recording) -------------------------------
    with tempfile.TemporaryDirectory() as d:
        root = tree(os.path.join(d, "root"))
        src = os.path.join(d, "src")
        os.makedirs(src)
        p = os.path.join(src, "medic_he_01.wav")
        write_wav(p, shout(seconds=1.0, seed=7))
        err, log = run(src, root, own=True, generated="2026-10-26", today=datetime.date(2026, 10, 26))
        check("an own recording of one take is prepared", err is None, err)
        man = json.load(open(os.path.join(root, "data", "audio.json"), encoding="utf-8"))
        slot = man["voices"]["lines"][pmv.KEY]["variants"]
        check("the slot holds the one variant and the announcement names it",
              [v["file"] for v in slot] == ["voice/he/common/announce_medic_01a.ogg"]
              and man["voices"]["announcements"]["events"]["medic"]["audio"] == pmv.KEY)
        v = slot[0]
        check("the provenance says the lead's own voice, all rights reserved, not AI-generated, with the date",
              all(w in v["source"] for w in ("own voice", "all rights reserved", "not AI-generated", "2026-10-26")), v["source"])
        check("the generator is a human voice and never ElevenLabs", "elevenlabs" not in (v["generator"] + v["source"]).lower()
              and v["generator"].startswith("none (human voice"), v["generator"])
        check("licence LicenseRef-owned, credit Ilan Pinto", v["license"] == "LicenseRef-owned" and v["credit"] == "Ilan Pinto")
        check("the source carries the input's sha256", pmv.sha256(p) in v["source"])
        r = subprocess.run([sys.executable, os.path.join(root, "tools", "validate_audio.py")], capture_output=True, text=True)
        check("validate_audio.py passes on an own recording (the ElevenLabs-source rule does not fire)", r.returncode == 0, (r.stdout + r.stderr)[-600:])
        failures = []
        va.check_commercial({"voices": {"lines": {pmv.KEY: {"variants": slot}}}}, failures)
        check("the commercial gate passes it", failures == [], failures)
        stripped, excluded = va.commercial_manifest(man)
        check("the commercial manifest INCLUDES the take and excludes neither of its files",
              stripped["voices"]["lines"][pmv.KEY]["variants"] == slot and not any("announce_medic" in f for f in excluded), excluded)
        doc = open(os.path.join(root, "docs", "ASSET_PROVENANCE.md"), encoding="utf-8").read()
        row = next(l for l in doc.splitlines() if l.startswith("|") and "announce_medic" in l.split("|")[1])
        check("the register row says a human voice, not AI, and carries no ElevenLabs wording",
              "No: a human voice" in row and "ElevenLabs" not in row and "own voice" in row, row)
        check("the status line says filled, the lead's own voice",
              "Status: **filled 2026-10-26**" in doc and "own voice" in doc.split("Status: **filled")[1].split("\n")[0] and "empty slot" not in doc)
        pats = [cpr.glob_re(q) for _, q in cpr.register_patterns(doc) if "announce_medic" in q]
        written = sorted(f"assets/audio/{v[k]}" for k in ("file", "alt"))
        check("the provenance row covers each written file once",
              all(sum(bool(q.match(f)) for q in pats) == 1 for f in written) and len(pats) == len(written), (len(pats), written))
        # the same recording under --paid-plan is the ElevenLabs path and still carries ElevenLabs wording
        root2 = tree(os.path.join(d, "root2"))
        err, _ = run(src, root2, paid=True, generated="2026-10-26", today=datetime.date(2026, 10, 26))
        v2 = json.load(open(os.path.join(root2, "data", "audio.json"), encoding="utf-8"))["voices"]["lines"][pmv.KEY]["variants"][0]
        check("--paid-plan still writes ElevenLabs provenance", err is None and "paid ElevenLabs plan" in v2["source"] and "ElevenLabs" in v2["generator"], err)

    print("\nmedic voice prepare: " + ("all cases pass" if not bad else f"{len(bad)} case(s) failed"))
    return 1 if bad else 0


def _raises(fn, text):
    try:
        fn()
    except pmv.Refusal as e:
        return text in str(e)
    return False


if __name__ == "__main__":
    sys.exit(main())
