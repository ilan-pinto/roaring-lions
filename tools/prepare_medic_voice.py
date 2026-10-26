#!/usr/bin/env python3
"""
Roaring Lions -- prepare the "Medic!" voice call (GH-753).

    python3 tools/prepare_medic_voice.py --src=~/Downloads/medic --paid-plan
    python3 tools/prepare_medic_voice.py -h

The lead generates the takes himself in ElevenLabs, on his PAID plan, from the
prompt sheet `_coord/medic-voice/prompts.md`, and saves them as

    medic_he_01  "chovesh"                    (Hebrew, one shout)
    medic_he_02  "patzu'a, chovesh"           (Hebrew, two beats)
    medic_he_03  "chovesh, chovesh"           (Hebrew, called twice)
    medic_en_01  "Medic!"                     (English; prepared, NOT wired)

as .wav (best) or .mp3/.flac/.m4a, in one folder. This script turns them into the
voice slot `he.common.announce_medic` that `data/audio.json` already declares empty
(an empty `variants` list plays nothing) and that the announcement `medic`
(`voices.announcements.events.medic`, one call per 8 s, raised from the sim's
`woundedDown` on the viewer's own side) will play once it is named:

  1. Checks EVERY take before writing anything: not clipped (a run of three or more
     samples at full scale: normalising bakes the distortion in), at least 0.25 s and
     at most 2.0 s once the silence either side is trimmed, not silent.
  2. Cuts and levels them with `tools/voice_prep.py` (the encoding of every voice line:
     silence trimmed to a 20 ms margin, two-pass loudnorm to -18 LUFS with a -3 dBTP
     ceiling, mono 44.1 kHz, OGG q4 and M4A 64 kb/s). It reuses that module, it does not
     copy its chain, so a take sits where the other voice lines sit in the mix.
  3. Measures the SHIPPED encodings (both decoded): true peak at or under -1 dBTP and
     integrated loudness within 4 LU of -18. A take that is out refuses the run.
  4. Writes assets/audio/voice/he/common/announce_medic_0Na.{ogg,m4a}, replaces the
     slot's `variants` (a re-run with other takes converges, and removes a take that
     is no longer there), names the slot in the announcement's `audio` (the gate refuses
     a name with no take, and a take with no name), and updates the provenance
     register row and status line in docs/ASSET_PROVENANCE.md.
  5. Runs `python3 tools/validate_audio.py` on the result.

The licence statement is the lead's word, and it is only recorded when he gives it:
`--paid-plan` says the takes were generated on a paid ElevenLabs plan. Without it the
script refuses. The generation date recorded is the date of the INPUT FILES
(modification time of the oldest), or `--generated=YYYY-MM-DD`; each input's sha256 goes
into the variant's `source`, so the committed files trace to the lead's files without
committing them. The English take goes to `<src>/held/` next to his files: no faction
speaks English today, so it has no key to live under.

Needs numpy and ffmpeg, like gen_audio.py.
"""
import argparse
import contextlib
import datetime
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import voice_prep  # noqa: E402  (the encoding of every voice line: trim, loudnorm, OGG + M4A)

ROOT = os.path.dirname(HERE)
MANIFEST_REL = os.path.join("data", "audio.json")
PROVENANCE_REL = os.path.join("docs", "ASSET_PROVENANCE.md")

EVENT = "medic"
LANG = "he"
KEY = f"{LANG}.common.announce_{EVENT}"
STEM_DIR = f"{LANG}/common"
STEM = f"announce_{EVENT}"

# The words of each take, as the prompt sheet writes them. `text` is what is SAID (no points, no
# tags): validate_audio requires it, with a transliteration and a meaning. Change a take's words
# here and in the sheet together.
TAKES = {
    "medic_he_01": dict(lang="he", n=1, text="חובש", translit="chovesh",
                        en='Medic! (one hard shout; the sheet\'s take 1)'),
    "medic_he_02": dict(lang="he", n=2, text="פצוע, חובש", translit="patzu'a, chovesh",
                        en='Casualty! Medic! (two beats; the sheet\'s take 2)'),
    "medic_he_03": dict(lang="he", n=3, text="חובש, חובש", translit="chovesh, chovesh",
                        en='Medic! Medic! (the second louder; the sheet\'s take 3)'),
    "medic_en_01": dict(lang="en", n=1, text="Medic", translit="medic", en="Medic! (English; held, not wired)"),
}
EXTS = (".wav", ".mp3", ".flac", ".m4a")

MIN_S, MAX_S = 0.25, 2.0          # a trimmed shout: shorter is a click, longer is a speech
CLIP_RUN = 3                      # this many consecutive samples at full scale is a clipped take
CLIP_LEVEL = 0.999
TP_CEILING = -1.0                 # dBTP, both shipped encodings
TARGET_I, I_TOL = voice_prep.TARGET_I, 4.0   # the voice lines sit between -17.9 and -21.3 LUFS

LICENSE = "LicenseRef-owned"
CREDIT = "Ilan Pinto"
SR = 44100

STATUS_EMPTY = "Status: **empty slot, no takes yet** (the voice key and the announcement are wired; `python3 tools/prepare_medic_voice.py --src=<dir> --paid-plan` fills them)."
STATUS_RE = re.compile(r"^Status: \*\*(empty slot, no takes yet|filled \d{4}-\d{2}-\d{2}).*$", re.M)
ROW_ANCHOR = "| `assets/audio/voice/he/common/announce_{defeat,mission_start,objective_active,objective_complete,reinforcements}_01a.{ogg,m4a}`"


class Refusal(Exception):
    """A rule of this script, not a bug: reported and exit 1."""


# --- reading -----------------------------------------------------------------
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def find_inputs(src):
    """{take: path} for every take of TAKES present in `src`, plus the names that look
    like a medic file and are not a take (reported, never silently used)."""
    if not os.path.isdir(src):
        raise Refusal(f"{src}: not a folder")
    found, stray = {}, []
    for name in sorted(os.listdir(src)):
        stem, ext = os.path.splitext(name)
        if os.path.isdir(os.path.join(src, name)):
            continue
        if stem in TAKES and ext.lower() in EXTS:
            if stem in found:
                raise Refusal(f"{stem}: two files ({os.path.basename(found[stem])} and {name}); keep one")
            found[stem] = os.path.join(src, name)
        elif stem.lower().startswith("medic"):
            stray.append(name)
    return found, stray


def decode(path, ffmpeg):
    """Native-rate mono floats of any input, the way ffmpeg reads it."""
    raw = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-i", path, "-f", "f32le", "-ac", "1", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def clipped_run(x):
    """Longest run of consecutive samples at full scale."""
    hot = np.abs(x) >= CLIP_LEVEL
    if not hot.any():
        return 0
    edges = np.diff(np.concatenate(([0], hot.astype(np.int8), [0])))
    starts, ends = np.where(edges == 1)[0], np.where(edges == -1)[0]
    return int((ends - starts).max())


def trimmed_seconds(path, ffmpeg):
    """Seconds of speech once voice_prep's silence trim has run (what the game would play)."""
    raw = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-i", path, "-af", voice_prep.TRIM,
                          "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return len(raw) / 4 / SR


def check_take(name, path, ffmpeg):
    """Refuse a take that cannot be shipped. Returns the trimmed length in seconds."""
    x = decode(path, ffmpeg)
    if len(x) == 0 or float(np.abs(x).max()) < 1e-4:
        raise Refusal(f"{name}: silent")
    run = clipped_run(x)
    if run >= CLIP_RUN:
        raise Refusal(f"{name}: clipped ({run} consecutive samples at full scale); generate it again, "
                      "because normalising would bake the distortion in")
    s = trimmed_seconds(path, ffmpeg)
    if s < MIN_S:
        raise Refusal(f"{name}: {s:.2f} s of speech after trimming, under {MIN_S} s")
    if s > MAX_S:
        raise Refusal(f"{name}: {s:.2f} s of speech after trimming, over {MAX_S} s; a call heard every 8 s must be short")
    return s


# --- measuring ---------------------------------------------------------------
def measure_file(path, ffmpeg):
    """(integrated LUFS, true peak dBTP, seconds) of an encoded file, decoded."""
    text = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-nostdin", "-i", path, "-af", "ebur128=peak=true",
                           "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = text[text.rfind("Summary:"):]
    i = float(re.search(r"I:\s*(-?[\d.]+)\s*LUFS", summary).group(1))
    tp = float(re.search(r"Peak:\s*(-?[\d.]+)\s*dBFS", summary).group(1))
    d = re.search(r"Duration: (\d+):(\d+):([\d.]+)", text)
    return i, tp, int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))


def check_shipped(name, rel_paths, base, ffmpeg):
    """Both encodings of a take within the level rules. Returns report lines."""
    out = []
    for rel in rel_paths:
        i, tp, secs = measure_file(os.path.join(base, rel), ffmpeg)
        if tp > TP_CEILING:
            raise Refusal(f"{name}: {os.path.basename(rel)} true peak {tp:+.1f} dBTP, over {TP_CEILING:+.1f}")
        if abs(i - TARGET_I) > I_TOL:
            raise Refusal(f"{name}: {os.path.basename(rel)} integrated {i:.1f} LUFS, more than {I_TOL:.0f} LU from {TARGET_I:.0f}")
        out.append(f"{os.path.basename(rel)}: {secs:.2f} s, {i:.1f} LUFS, {tp:+.1f} dBTP")
    return out


def encode_into(stage, stem, src, ffmpeg):
    """voice_prep's encode of one take into `stage`/assets/audio/voice/<stem>.{ogg,m4a}."""
    voice_prep.ROOT = stage
    voice_prep.FFMPEG = ffmpeg
    os.makedirs(os.path.join(stage, "assets", "audio", "voice", os.path.dirname(stem)), exist_ok=True)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            voice_prep.main(src, stem)
    except SystemExit as e:                       # voice_prep exits with ffmpeg's stderr
        raise Refusal(f"{os.path.basename(src)}: ffmpeg could not encode it: {e.code}")
    return [f"voice/{stem}.ogg", f"voice/{stem}.m4a"]


# --- writing -----------------------------------------------------------------
def variant_for(name, take, filename, digest, date):
    n = take["n"]
    base = f"voice/{STEM_DIR}/{STEM}_{n:02d}a"
    return {
        "file": f"{base}.ogg",
        "alt": f"{base}.m4a",
        "license": LICENSE,
        "source": (
            f"ElevenLabs speech generated by the project lead on {date} on a paid ElevenLabs plan (tier not named; "
            f"the lead passed --paid-plan to tools/prepare_medic_voice.py, GH-753), so commercial use is cleared; "
            f"input {filename}, sha256 {digest}, not committed; trimmed and normalised by tools/voice_prep.py"
        ),
        "credit": CREDIT,
        "generator": f"ElevenLabs (AI-generated speech), generated by the project lead on {date} on a paid plan",
        "text": take["text"],
        "translit": take["translit"],
        "en": take["en"],
    }


def dump_manifest(man, original_path):
    """json.dumps as the file is written, leaving every line this script does not own
    byte-identical (a line the file writes with \\u escapes keeps them)."""
    text = json.dumps(man, indent=2, ensure_ascii=False) + "\n"
    with open(original_path, encoding="utf-8") as fh:
        for line in fh.read().splitlines():
            if "\\u" not in line:
                continue
            indent = line[: len(line) - len(line.lstrip())]
            tail = "," if line.rstrip().endswith(",") else ""
            decoded = json.dumps(json.loads("{" + line.strip().rstrip(",") + "}"), ensure_ascii=False)[1:-1].strip()
            text = text.replace(indent + decoded + tail + "\n", line + "\n")
    return text


def write_manifest(root, variants):
    path = os.path.join(root, MANIFEST_REL)
    with open(path, encoding="utf-8") as fh:
        man = json.load(fh)
    voices = man["voices"]
    if KEY not in voices["lines"]:
        raise Refusal(f"{KEY}: the slot is not declared in {MANIFEST_REL}")
    ev = voices["announcements"]["events"].get(EVENT)
    if ev is None:
        raise Refusal(f"announcements.events.{EVENT}: not declared in {MANIFEST_REL}")
    voices["lines"][KEY]["variants"] = variants
    ev["audio"] = KEY if variants else ""
    text = dump_manifest(man, path)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def register_row(variants, date, run_date):
    nums = [int(re.search(r"_(\d\d)a\.ogg$", v["file"]).group(1)) for v in variants]
    names = (f"announce_medic_0{{{','.join(str(n) for n in nums)}}}a" if len(nums) > 1 else f"announce_medic_{nums[0]:02d}a")
    return (
        f"| `assets/audio/voice/he/common/{names}.{{ogg,m4a}}` | The \"Medic!\" call (GH-753): {len(nums)} Hebrew take(s), ogg and m4a "
        f"| ElevenLabs speech generated by the project lead on {date} (his own Voice Design voice; the WAVs are not committed, "
        f"each input's sha256 is in the variant's `source` in `data/audio.json`); trimmed, mono 44.1 kHz, -18 LUFS by "
        f"`tools/voice_prep.py`, checked and written by `tools/prepare_medic_voice.py` | ElevenLabs; ffmpeg "
        f"| **Yes**: ElevenLabs speech "
        f"| Declared `LicenseRef-owned`, credit Ilan Pinto; commercial use cleared: a paid ElevenLabs plan (tier not named), "
        f"stated by the lead when he ran the prepare step with `--paid-plan` on {run_date} (the five older voice takes, "
        f"item 2, stay unconfirmed) | `data/audio.json` `voices.lines[\"{KEY}\"]`, `voices.announcements.events.medic` |"
    )


def write_provenance(root, variants, date, run_date):
    path = os.path.join(root, PROVENANCE_REL)
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    lines = [l for l in lines if not (l.startswith("|") and "announce_medic" in l.split("|")[1])]
    at = next((i for i, l in enumerate(lines) if l.startswith(ROW_ANCHOR)), None)
    if at is None:
        raise Refusal(f"{PROVENANCE_REL}: the register row to insert after was not found")
    lines.insert(at + 1, register_row(variants, date, run_date))
    text = "\n".join(lines)
    status = (f"Status: **filled {run_date}**: {len(variants)} take(s), generated {date} on a paid ElevenLabs plan "
              f"(the lead's word, `--paid-plan`); cleared for a commercial build.")
    if not STATUS_RE.search(text):
        raise Refusal(f"{PROVENANCE_REL}: the 'Status:' line of the Medic! section was not found")
    text = STATUS_RE.sub(lambda _m: status, text, count=1)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


# --- the run -----------------------------------------------------------------
def generated_date(paths, override=None, today=None):
    today = today or datetime.date.today()
    if override is not None:
        try:
            d = datetime.date.fromisoformat(override)
        except ValueError:
            raise Refusal(f"--generated={override}: not a date (YYYY-MM-DD)")
    else:
        d = datetime.date.fromtimestamp(min(os.path.getmtime(p) for p in paths))
    if d > today:
        raise Refusal(f"generation date {d} is in the future")
    return d.isoformat()


def run(src, paid_plan, root=ROOT, generated=None, log=print, gate=True, today=None):
    if not paid_plan:
        raise Refusal("pass --paid-plan: it is the lead's statement that these takes were generated on his PAID ElevenLabs plan "
                      "(commercial-cleared). Free-tier output cannot be committed (CONTRIBUTING.md); without the statement nothing is written")
    ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or voice_prep.FFMPEG
    if not (os.path.exists(ffmpeg) or shutil.which(ffmpeg)):
        raise Refusal("ffmpeg not found (set FFMPEG)")
    src = os.path.abspath(os.path.expanduser(src))
    found, stray = find_inputs(src)
    he = {n: p for n, p in found.items() if TAKES[n]["lang"] == "he"}
    if not he:
        raise Refusal(f"no Hebrew take in {src} (expected {', '.join(n for n in TAKES if TAKES[n]['lang'] == 'he')} as .wav/.mp3)")
    for s in stray:
        log(f"ignored (not a take name): {s}")
    for n in TAKES:
        if n not in found:
            log(f"absent: {n}")
    date = generated_date(found.values(), generated, today)
    run_date = (today or datetime.date.today()).isoformat()

    log(f"generation date {date} (from the files{'' if generated is None else ', overridden'}); statement: paid ElevenLabs plan")
    # 1. every take is checked before anything is written
    for name in sorted(found):
        secs = check_take(name, found[name], ffmpeg)
        log(f"checked {name}: {secs:.2f} s of speech, not clipped")

    with tempfile.TemporaryDirectory() as stage:
        # 2-3. encode into a staging tree and measure what would ship
        staged = {}
        for name in sorted(found):
            take = TAKES[name]
            stem = f"{STEM_DIR}/{STEM}_{take['n']:02d}a" if take["lang"] == "he" else f"en/{name}"
            rels = encode_into(stage, stem, found[name], ffmpeg)
            for line in check_shipped(name, rels, os.path.join(stage, "assets", "audio"), ffmpeg):
                log(f"  {line}")
            staged[name] = rels
        # 4. write
        voice_dir = os.path.join(root, "assets", "audio")
        keep = set()
        variants = []
        for name in sorted(he):
            rels = staged[name]
            for rel in rels:
                dst = os.path.join(voice_dir, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(os.path.join(stage, "assets", "audio", rel), dst)
                keep.add(rel)
            variants.append(variant_for(name, TAKES[name], os.path.basename(he[name]), sha256(he[name]), date))
        d = os.path.join(voice_dir, "voice", STEM_DIR)
        for f in sorted(os.listdir(d)):
            rel = f"voice/{STEM_DIR}/{f}"
            if f.startswith(f"{STEM}_") and rel not in keep:
                os.remove(os.path.join(d, f))
                log(f"removed stale take {rel}")
        held = [n for n in sorted(found) if TAKES[n]["lang"] != "he"]
        for name in held:
            os.makedirs(os.path.join(src, "held"), exist_ok=True)
            for rel in staged[name]:
                shutil.copyfile(os.path.join(stage, "assets", "audio", rel), os.path.join(src, "held", os.path.basename(rel)))
            log(f"held {name} in {os.path.join(src, 'held')}: no faction speaks {TAKES[name]['lang']}, so it is not wired")
    variants.sort(key=lambda v: v["file"])
    write_manifest(root, variants)
    write_provenance(root, variants, date, run_date)
    log(f"wrote {len(variants)} variant(s) to {KEY} and named it in announcements.events.{EVENT}.audio")
    if gate:
        r = subprocess.run([sys.executable, os.path.join(root, "tools", "validate_audio.py")], capture_output=True, text=True, cwd=root)
        tail = (r.stdout.strip().splitlines() or [""])[-1]
        log(f"validate_audio.py: {'passed' if r.returncode == 0 else 'FAILED'}: {tail if r.returncode == 0 else r.stdout + r.stderr}")
        if r.returncode:
            raise Refusal("the audio gate is red on the result; the files are written, read the output above")
    return variants


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1] + " " + __doc__.split("\n")[2])
    ap.add_argument("--src", required=True, help="the folder of the lead's takes (medic_he_01.wav ...)")
    ap.add_argument("--paid-plan", action="store_true", help="the takes were generated on a PAID ElevenLabs plan (the lead's statement)")
    ap.add_argument("--generated", help="generation date YYYY-MM-DD; default the oldest input file's date")
    ap.add_argument("--no-gate", action="store_true", help="skip running validate_audio.py at the end")
    args = ap.parse_args(argv)
    try:
        run(args.src, args.paid_plan, generated=args.generated, gate=not args.no_gate)
    except Refusal as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print("\nnext: git add the new assets/audio/voice/he/common/announce_medic_* files, then run")
    print("  python3 tools/check_provenance_register.py && pnpm validate:audio && pnpm exec vitest run packages/app/src/voice")
    print("  git commit -- data/audio.json docs/ASSET_PROVENANCE.md assets/audio/voice/he/common/announce_medic_*")
    print("credits.ai.audio (packages/app/src/i18n/en.json, pinned by credits-data.test.ts) still says every ElevenLabs voice is left out of a")
    print("commercial release: it needs a sentence that these Medic! takes ship (they are paid-plan, cleared).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
