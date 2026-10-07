#!/usr/bin/env python3
"""
Roaring Lions -- audio CI gate.

The audio equivalent of validate_assets.py, and it exists for the same reason:
the failure mode of accepting sound from many hands is not bad taste, it is a
contributor committing a file nobody is allowed to redistribute. Six months
later the project has a licensing problem it cannot untangle.

    python tools/validate_audio.py

Checks (all fail the build):
  1. LICENSE   -- every variant declares a redistribution-safe license and a
                  source URL. This is the load-bearing check.
  2. RESOLVES  -- every declared file exists; every set has a known event.
  3. FORMAT    -- .ogg or .m4a/.mp3 only, under the size ceiling. Browsers
                  differ: OGG everywhere except Safari, M4A/MP3 for Safari.
  4. SANITY    -- pitch jitter and gains inside sane bounds, so one bad number
                  cannot blow out a player's ears.
  5. MUSIC     -- the `music` section, if present: the same license/source/
                  exists/format checks as a clip, with its own size ceiling.
                  A one-shot has no business over 512 KB; a looping track is
                  minutes long and streams, so it gets 8 MB.
  7. CUES      -- the `cues` table (polish pass F, AU-1): every cue id names
                  a declared `ui` set, or `{"silent": reason}` with a reason.
  8. LEVELS    -- music `battle_gain` 0..1, a track's `trim_db` in -12..0,
                  and, when ffmpeg is on PATH, the track's measured true
                  peak plus its trim at or under -1 dBTP (the skip is named).
  9. COMMERCIAL (`--commercial` only) -- no variant whose `source` says its
                  licence is not yet confirmed: the four ElevenLabs takes
                  (D5, A3) stay out of a commercial build until it is.
  10. AMBIENCE -- the `ambience.beds` table (polish pass F, A11): licence,
                  source, files and gain always; with ffmpeg and ffprobe, BOTH
                  encodings of every bed decoded and measured -- the decoded
                  length against the declared `loop_s` (to 1 ms), the channel
                  count against `channels`, the true peak (<= -6 dBTP), the
                  loudness as heard (-34 +- 2 LUFS) and the seam (no level
                  step, no gap). Without ffmpeg the skip is named.
  6. VOICES    -- licence/source/generator/text/translit/en on every voice
                  variant; ASCII voice/<lang>/<class>/<trigger>_<nn><take>.ogg|m4a
                  paths filed under their own key; keys in a language some
                  faction speaks; civilians silent. Duration and loudness
                  (N9, N10) are measured by the asset plan's tool, not here.
  10. UI CUES  -- every `ui` set whose source is tools/gen_audio.py: mono,
                  at most 250 ms -- or its own tier's ceiling for the longer
                  pass-F cues, UI_CUE_CEILING_S, which mirrors gen_audio.py's
                  STINGER_SETS/CUE_CEILING_S and is pinned to them by
                  test_validate_audio_ui.py -- (read from the OGG's own header
                  and last page, no decoder), and a decoded peak under -5 dBFS
                  (needs ffmpeg; without it the gate says so by name rather
                  than passing quietly). gen_audio.py asserts the same limits
                  when it generates, which a stale or hand-dropped file never
                  passes through.

Empty variant lists are legal and expected: BattleAudio falls back to its
procedural synth, so the game ships with sound from day one and real
recordings can land one file at a time.
"""

import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "data", "audio.json")
AUDIO_DIR = os.path.join(ROOT, "assets", "audio")

# Licenses that permit redistribution of the source file in a public repo.
# CC-BY is allowed but obliges attribution -- the credit line is mandatory.
ALLOWED_LICENSES = {
    "CC0-1.0": False,
    "public-domain": False,
    "CC-BY-3.0": True,
    "CC-BY-4.0": True,
}

KNOWN_EVENTS = {
    "fire", "penetration", "ricochet", "near_miss", "aps_intercept", "destroyed",
    # Not a thing happening on the map: the mixer plays this unpositioned, so
    # it has no weapon class and no distance -- an alert or an objective cue,
    # about the player rather than about a place.
    "ui",
}
KNOWN_WEAPON_CLASSES = {
    "apfsds", "heat", "he", "atgm", "rpg", "small_arms", "hmg", "autocannon",
    "mortar", "rocket", "interceptor", "demolition",
}
ALLOWED_EXT = {".ogg", ".m4a", ".mp3"}
MAX_BYTES = 512 * 1024      # a battlefield one-shot has no business being bigger
MAX_MUSIC_BYTES = 8 * 1024 * 1024  # a looping track streams; it is never decoded whole
MAX_GAIN = 1.5
MAX_JITTER = 0.5

UNIT_SCHEMA = os.path.join(ROOT, "data", "schemas", "unit.schema.json")
# D9 (WP-AU1 R-7): owned or commissioned voice is neither CC0 nor CC-BY. It is
# allowed HERE and nowhere else, and its `source` must name the release or
# session record -- or, for generated speech, the plan and the date (D5).
VOICE_LICENSES = dict(ALLOWED_LICENSES, **{"LicenseRef-owned": False})
VOICE_KEY = re.compile(r"^([a-z]{2})\.(infantry|crew|engineer|air|common)\.([a-z_]+)$")
VOICE_PATH = re.compile(r"^voice/([a-z]{2})/([a-z]+)/([a-z_]+)_(\d{2})([a-z])\.(ogg|m4a)$")
VOICE_TEXT_FIELDS = ("generator", "text", "translit", "en")


# Polish pass F (F4): a music file's true peak, after its trim, sits at or
# under this. The theme read +0.2 dBTP; `trim_db` -1.2 takes it to -1.0.
MAX_TRUE_PEAK_DBTP = -1.0
TRIM_DB_RANGE = (-12.0, 0.0)
# A3: the marker every unconfirmed-licence variant carries in its `source`.
UNCONFIRMED_LICENCE = re.compile(r"licen[cs]e not (yet )?confirmed", re.IGNORECASE)


def check_cues(man, failures):
    """AU-1: the cue map. Its COVERAGE (every id the app asks for) is a vitest
    (packages/app/src/ui/cues.test.ts) because the ids live in TypeScript;
    this checks each entry's shape against the manifest's own sets."""
    cues = man.get("cues")
    if cues is None:
        return 0
    sets = man.get("sets", {})
    n = 0
    for cid, entry in cues.items():
        if cid.startswith("$"):
            continue
        n += 1
        if isinstance(entry, str):
            spec = sets.get(entry)
            if spec is None:
                failures.append(f"cues '{cid}': set '{entry}' is not declared in sets")
            elif spec.get("event") != "ui":
                failures.append(f"cues '{cid}': set '{entry}' is on event '{spec.get('event')}', not 'ui' -- a cue plays unplaced")
        elif isinstance(entry, dict) and isinstance(entry.get("silent"), str) and entry["silent"].strip():
            pass
        else:
            failures.append(f"cues '{cid}': must be a set name or {{\"silent\": reason}}, got {entry!r}")
    return n


def true_peak_dbtp(path):
    """ffmpeg's ebur128 true peak in dBTP, or None when ffmpeg is absent or
    the read fails. Takes about a second for the 2:41 theme."""
    if shutil.which("ffmpeg") is None:
        return None
    try:
        out = subprocess.run(
            ["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        ).stderr
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.findall(r"True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS", out)
    if not m:
        return None
    return float("-inf") if m[-1] == "-inf" else float(m[-1])


def check_music_levels(music, failures, notes, audio_dir=AUDIO_DIR, measure=true_peak_dbtp):
    """F4 / A10: the scene gains and each track's trim, and the measured peak."""
    if music is None:
        return
    bg = music.get("battle_gain")
    if bg is not None and (isinstance(bg, bool) or not isinstance(bg, (int, float)) or not 0 <= bg <= 1):
        failures.append(f"music: battle_gain {bg!r} outside 0..1")
    for t in music.get("tracks", []):
        f = t.get("file")
        trim = t.get("trim_db", 0.0)
        if isinstance(trim, bool) or not isinstance(trim, (int, float)) or not TRIM_DB_RANGE[0] <= trim <= TRIM_DB_RANGE[1]:
            failures.append(f"{f}: trim_db {trim!r} outside {TRIM_DB_RANGE[0]}..{TRIM_DB_RANGE[1]} dB")
            continue
        if not f or not os.path.exists(os.path.join(audio_dir, f)):
            continue  # check_licensed_file already names a missing file
        tp = measure(os.path.join(audio_dir, f))
        if tp is None:
            notes.append(f"{f}: true peak NOT measured (no ffmpeg on PATH) -- trim_db {trim} is unchecked")
            continue
        heard = tp + trim
        if heard > MAX_TRUE_PEAK_DBTP + 1e-9:
            failures.append(
                f"{f}: true peak {tp:+.1f} dBTP with trim_db {trim} is {heard:+.1f}, over {MAX_TRUE_PEAK_DBTP} dBTP "
                f"-- trim it by at least {heard - MAX_TRUE_PEAK_DBTP:.1f} dB more"
            )
        else:
            notes.append(f"{f}: true peak {tp:+.1f} dBTP, {heard:+.1f} after trim_db {trim}")


# Polish pass F, A11: the ambience beds. A bed is heard at -34 LUFS at default
# sliders (audio-plan.md section 2.1, rank 6), well under a voice line's -21
# and a cue's -14 dBFS peak; the tolerance is the plan's own +-2.
AMB_HEARD_LUFS = -34.0
AMB_HEARD_TOL_LU = 2.0
AMB_MAX_TRUE_PEAK_DBTP = -6.0
AMB_LOOP_RANGE_S = (20.0, 90.0)
# Both encodings must decode to the declared loop, to the millisecond: an AAC
# file whose priming or padding is not trimmed loops with a gap in it.
AMB_LOOP_TOL_S = 0.001
# The seam, measured on the decoded file, wrapped. LEVEL: the 250 ms either
# side of the wrap within 2 dB of each other (a swell that is not periodic, or
# an event cut off). GAP: no 5 ms window within 100 ms of the wrap more than
# 6 dB under the file's own quietest 1% of 5 ms windows (a codec's silence).
AMB_SEAM_LEVEL_DB = 2.0
AMB_SEAM_GAP_DB = 6.0


def _db(v):
    import math
    return 20 * math.log10(v) if v > 0 else float("-inf")


def _rms(xs):
    return (sum(v * v for v in xs) / len(xs)) ** 0.5 if len(xs) else 0.0


def seam_metrics(pcm, rate):
    """(level step dB, gap dB) at the loop's wrap, for mono float samples.
    The gap is the quietest 5 ms window near the wrap against the file's 1st
    percentile 5 ms window: negative means quieter than the file ever is."""
    k = int(0.25 * rate)
    level = abs(_db(_rms(pcm[-k:])) - _db(_rms(pcm[:k])))
    w = max(1, int(0.005 * rate))
    near = int(0.1 * rate)
    # The floor is the file AWAY from the seam: what is under test is not
    # allowed to set its own bar.
    windows = sorted(_db(_rms(pcm[i:i + w])) for i in range(near, len(pcm) - near - w + 1, w))
    floor = windows[int(0.01 * (len(windows) - 1))]
    around = list(pcm[-near:]) + list(pcm[:near])
    nearest = min(_db(_rms(around[i:i + w])) for i in range(0, len(around) - w + 1, w))
    return level, nearest - floor


def measure_bed(path):
    """What the gate needs from one encoded bed, decoded by ffmpeg the way a
    player decodes it: channels, decoded length, integrated loudness, true
    peak and the seam. None when ffmpeg or ffprobe is not on PATH."""
    import array
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        return None
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate",
             "-of", "default=noprint_wrappers=1", path],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout
        info = dict(line.split("=", 1) for line in probe.split() if "=" in line)
        channels, rate = int(info["channels"]), int(info["sample_rate"])
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-acodec", "pcm_s16le", "-"],
            capture_output=True, timeout=120, check=True,
        ).stdout
        loud = subprocess.run(
            ["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        ).stderr
    except (OSError, subprocess.SubprocessError, KeyError, ValueError):
        return None
    pcm16 = array.array("h")
    pcm16.frombytes(raw[: len(raw) // 2 * 2])
    if sys.byteorder == "big":
        pcm16.byteswap()
    frames = len(pcm16) // channels
    if channels == 1:
        mono = [v / 32768.0 for v in pcm16]
    else:
        mono = [sum(pcm16[i * channels:(i + 1) * channels]) / (32768.0 * channels) for i in range(frames)]
    integrated = re.findall(r"Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-inf)\s*LUFS", loud)
    peak = re.findall(r"True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS", loud)
    if not integrated or not peak or frames == 0:
        return None
    level, gap = seam_metrics(mono, rate)
    return {
        "channels": channels,
        "seconds": frames / rate,
        "integrated": float(integrated[-1]),
        "true_peak": float(peak[-1]),
        "seam_level_db": level,
        "seam_gap_db": gap,
    }


def check_ambience(man, failures, notes, audio_dir=AUDIO_DIR, measure=measure_bed):
    """A11: the `ambience.beds` table. The shape always; with ffmpeg, both
    encodings of every bed decoded and measured. Returns every file declared.
    Which beds the app can ask for is a vitest (packages/app/src/ambience.test.ts),
    because the ids live in TypeScript."""
    declared = set()
    amb = man.get("ambience")
    if amb is None:
        return declared
    beds = amb.get("beds")
    if not isinstance(beds, dict) or not beds:
        failures.append("ambience: no beds declared")
        return declared
    master = man.get("master_gain", 1.0)
    for bed, spec in beds.items():
        label = f"ambience '{bed}'"
        if not isinstance(spec, dict) or not spec.get("file"):
            failures.append(f"{label}: no file")
            continue
        check_licensed_file(spec, failures, MAX_BYTES, audio_dir=audio_dir)
        declared |= {spec[r] for r in ("file", "alt") if spec.get(r)}
        gain = spec.get("gain")
        loop_s = spec.get("loop_s")
        channels = spec.get("channels")
        if isinstance(gain, bool) or not isinstance(gain, (int, float)) or not 0 < gain <= 1:
            failures.append(f"{label}: gain {gain!r} outside (0, 1] -- a bed is never louder than its file")
            continue
        if isinstance(loop_s, bool) or not isinstance(loop_s, (int, float)) or not AMB_LOOP_RANGE_S[0] <= loop_s <= AMB_LOOP_RANGE_S[1]:
            failures.append(f"{label}: loop_s {loop_s!r} outside {AMB_LOOP_RANGE_S[0]}..{AMB_LOOP_RANGE_S[1]} s")
            continue
        if channels not in (1, 2) or isinstance(channels, bool):
            failures.append(f"{label}: channels {channels!r} is not 1 (mono) or 2 (stereo)")
            continue
        for role in ("file", "alt"):
            rel = spec.get(role)
            path = os.path.join(audio_dir, rel) if rel else None
            if not path or not os.path.exists(path):
                continue  # check_licensed_file already names a missing file
            got = measure(path)
            if got is None:
                notes.append(f"{rel}: bed NOT measured (no ffmpeg/ffprobe on PATH) -- loop, channels, peak, loudness and seam unchecked")
                continue
            if got["channels"] != channels:
                failures.append(f"{rel}: decodes to {got['channels']} channel(s), the manifest declares {channels}")
            if abs(got["seconds"] - loop_s) > AMB_LOOP_TOL_S:
                failures.append(
                    f"{rel}: decodes to {got['seconds']:.4f} s, the loop is {loop_s:.4f} s -- "
                    "an encoder's priming or padding left in loops with a gap"
                )
            if got["true_peak"] > AMB_MAX_TRUE_PEAK_DBTP + 1e-9:
                failures.append(f"{rel}: true peak {got['true_peak']:+.1f} dBTP, over the bed ceiling {AMB_MAX_TRUE_PEAK_DBTP} dBTP")
            heard = got["integrated"] + _db(gain * master)
            if abs(heard - AMB_HEARD_LUFS) > AMB_HEARD_TOL_LU + 1e-9:
                failures.append(
                    f"{rel}: heard at {heard:.1f} LUFS ({got['integrated']:.1f} LUFS, gain {gain}, master {master}), "
                    f"outside {AMB_HEARD_LUFS} +- {AMB_HEARD_TOL_LU}"
                )
            if got["seam_level_db"] > AMB_SEAM_LEVEL_DB:
                failures.append(f"{rel}: the loop's seam steps {got['seam_level_db']:.1f} dB (over {AMB_SEAM_LEVEL_DB})")
            if got["seam_gap_db"] < -AMB_SEAM_GAP_DB:
                failures.append(f"{rel}: a gap at the loop's seam, {got['seam_gap_db']:.1f} dB under the file's own floor")
            notes.append(
                f"{rel}: {got['seconds']:.3f} s loop, {got['channels']} ch, {got['true_peak']:+.1f} dBTP, "
                f"heard {heard:.1f} LUFS, seam {got['seam_level_db']:.1f} dB / gap {got['seam_gap_db']:+.1f} dB"
            )
    return declared


def check_commercial(man, failures):
    """A3: what a commercial build may not carry. Every variant, in every
    section, whose `source` records an unconfirmed licence."""
    found = []
    for spec in man.get("sets", {}).values():
        found += [v for v in spec.get("variants", [])]
    found += list((man.get("music") or {}).get("tracks", []))
    found += [b for b in ((man.get("ambience") or {}).get("beds") or {}).values() if isinstance(b, dict)]
    for line in ((man.get("voices") or {}).get("lines") or {}).values():
        found += line.get("variants", [])
    for v in found:
        if UNCONFIRMED_LICENCE.search(v.get("source", "") or ""):
            failures.append(f"{v.get('file')}: licence not confirmed -- it cannot ship in a commercial build (D5, A3)")


def unit_factions():
    with open(UNIT_SCHEMA) as fh:
        return set(json.load(fh)["properties"]["faction"]["enum"])


def check_licensed_file(entry, failures, max_bytes, roles=("file", "alt"), licenses=ALLOWED_LICENSES, audio_dir=AUDIO_DIR):
    """The load-bearing checks, shared by battle clips and music tracks:
    redistribution-safe license (with credit where the license obliges it),
    a checkable source, and every declared encoding present, playable and
    under the ceiling. `entry` is one manifest object carrying `file`."""
    f = entry.get("file")
    lic = entry.get("license")
    if lic not in licenses:
        failures.append(
            f"{f}: license '{lic}' is not redistribution-safe "
            f"(allowed: {', '.join(sorted(licenses))})"
        )
    elif licenses[lic] and not entry.get("credit"):
        failures.append(f"{f}: license {lic} requires a 'credit' line")
    if not entry.get("source"):
        failures.append(f"{f}: no 'source' URL -- provenance must be checkable")

    for role in roles:
        rel = entry.get(role)
        if rel is None:
            continue
        ext = os.path.splitext(rel)[1].lower()
        if ext not in ALLOWED_EXT:
            failures.append(f"{rel}: extension {ext} not one of {sorted(ALLOWED_EXT)} ({role})")
        path = os.path.join(audio_dir, rel)
        if not os.path.exists(path):
            failures.append(f"{rel}: declared in the manifest but missing from assets/audio/")
        elif os.path.getsize(path) > max_bytes:
            kb = os.path.getsize(path) // 1024
            failures.append(f"{rel}: {kb} KB exceeds the {max_bytes // 1024} KB ceiling")


# A UI cue is one short mono one-shot at -6 dBFS (garage uplift section 3.5,
# GH-238 section 8). The peak ceiling is 1 dB above that: Vorbis q3 overshoots
# a -6.0 dBFS source by up to ~0.1 dB, so the room is for the codec and not
# for a loud clip.
UI_MAX_S = 0.25
UI_PEAK_CEILING_DB = -5.0
UI_GENERATOR = "tools/gen_audio.py"
# The pass-F cues (polish pass F, section 4) that are longer than a UI tick,
# each held to its tier's ceiling exactly as gen_audio.py's STINGER_SETS and
# CUE_CEILING_S hold them at generation. A mirror, not an import: this gate
# runs without numpy. test_validate_audio_ui.py pins the two tables together.
UI_CUE_CEILING_S = {
    "victory": 2.5,
    "defeat": 2.5,
    "objective_complete": 0.8,
    "objective_failed": 0.8,
    "objective_new": 0.8,
    "alert_important": 0.8,
    "alert_major": 1.0,
    "mission_start": 1.5,
}


def ogg_vorbis_info(path):
    """(channels, sample_rate, seconds) of an Ogg Vorbis file, from its first
    packet's identification header and the last page's granule position --
    no decoder. None if the file is not Ogg Vorbis."""
    with open(path, "rb") as fh:
        data = fh.read()
    channels = rate = None
    granule = None
    i = 0
    while i + 27 <= len(data) and data[i:i + 4] == b"OggS":
        nseg = data[i + 26]
        if i + 27 + nseg > len(data):
            break
        body = sum(data[i + 27:i + 27 + nseg])
        start = i + 27 + nseg
        if channels is None:
            h = data[start:start + 16]
            if h[:7] != b"\x01vorbis":
                return None
            channels = h[11]
            (rate,) = struct.unpack("<I", h[12:16])
        (g,) = struct.unpack("<q", data[i + 6:i + 14])
        if g >= 0:
            granule = g
        i = start + body
    if channels is None or granule is None or not rate:
        return None
    return channels, rate, granule / rate


def ogg_peak_db(path):
    """Decoded peak of a clip in dBFS through ffmpeg, or None when ffmpeg is
    not installed."""
    if shutil.which("ffmpeg") is None:
        return None
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-"],
        check=True, capture_output=True,
    ).stdout
    n = len(raw) // 4
    peak = max((abs(v) for (v,) in struct.iter_unpack("<f", raw[:n * 4])), default=0.0)
    return 20 * math.log10(peak) if peak > 0 else float("-inf")


def check_ui_cue(entry, failures, audio_dir=AUDIO_DIR, notes=None, max_s=UI_MAX_S):
    """Section 10: a generated UI cue is mono, <= max_s (UI_MAX_S unless its
    set has a longer tier in UI_CUE_CEILING_S), and under the peak
    ceiling. Judged on the OGG, the primary encoding (an AAC file carries
    encoder padding that a duration check would have to excuse)."""
    rel = entry.get("file")
    if not rel or UI_GENERATOR not in str(entry.get("source", "")):
        return
    path = os.path.join(audio_dir, rel)
    if not os.path.exists(path):
        return  # reported by check_licensed_file
    info = ogg_vorbis_info(path)
    if info is None:
        failures.append(f"{rel}: a ui cue must be Ogg Vorbis")
        return
    channels, _rate, seconds = info
    if channels != 1:
        failures.append(f"{rel}: ui cue has {channels} channels, must be mono")
    if seconds > max_s:
        failures.append(f"{rel}: ui cue is {seconds * 1000:.0f} ms, over the {max_s * 1000:.0f} ms ceiling")
    peak = ogg_peak_db(path)
    if peak is None:
        if notes is not None:
            notes.append(f"{rel}: peak NOT checked (no ffmpeg on PATH)")
    elif peak > UI_PEAK_CEILING_DB:
        failures.append(f"{rel}: ui cue peaks at {peak:.2f} dBFS, over the {UI_PEAK_CEILING_DB} dBFS ceiling")


ANNOUNCE_PRIORITIES = ("high", "normal", "low")
EN_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "packages", "app", "src", "i18n", "en.json")


def check_announcements(voices, failures, captions=None):
    """GH-110: the announcement table. A caption is an i18n key that must exist
    in en.json (`captions`, a set; read from EN_JSON when None); `audio` is empty
    until a line is recorded, else a key declared in voices.lines."""
    table = voices.get("announcements")
    if table is None:
        return
    if captions is None:
        with open(EN_JSON) as fh:
            captions = set(json.load(fh))
    for field in ("hold_s", "caption_s"):
        v = table.get(field)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0:
            failures.append(f"announcements: {field} {v!r} is not a non-negative number")
    events = table.get("events", {})
    if not events:
        failures.append("announcements: no events declared")
    lines = voices.get("lines", {})
    for name, ev in events.items():
        if not ev.get("caption"):
            failures.append(f"announcements '{name}': no caption key -- the caption is the fallback and the only line today")
        elif ev["caption"] not in captions:
            failures.append(f"announcements '{name}': caption key '{ev['caption']}' is not in en.json")
        audio = ev.get("audio")
        if not isinstance(audio, str):
            failures.append(f"announcements '{name}': audio must be a string ('' until recorded)")
        elif audio != "" and audio not in lines:
            failures.append(f"announcements '{name}': audio '{audio}' is not declared in voices.lines")
        cd = ev.get("cooldown_s")
        if isinstance(cd, bool) or not isinstance(cd, (int, float)) or cd < 0:
            failures.append(f"announcements '{name}': cooldown_s {cd!r} is not a non-negative number")
        if ev.get("priority") not in ANNOUNCE_PRIORITIES:
            failures.append(f"announcements '{name}': priority {ev.get('priority')!r} is not one of {ANNOUNCE_PRIORITIES}")


def check_voices(voices, failures, factions, audio_dir=AUDIO_DIR):
    """The `voices` section (WP-AU1 §6). Returns every file it declares, for
    the undeclared-file sweep. Key COMPLETENESS is a vitest (lines.test.ts,
    R-6): the vocabulary lives in TypeScript, and this file does not copy it."""
    declared = set()
    if voices is None:
        return declared
    gain = voices.get("gain", 1.0)
    if isinstance(gain, bool) or not isinstance(gain, (int, float)):
        failures.append(f"voices: gain {gain!r} is not a number")
    elif not 0 <= gain <= 1:
        failures.append(f"voices: gain {gain} outside 0..1 (a voice is unplaced, like a UI cue)")
    langs = voices.get("languages", {})
    for faction, lang in langs.items():
        if faction == "civilian":
            failures.append("voices: civilians never speak (D10) -- 'civilian' must not map to a language")
        elif faction not in factions:
            failures.append(f"voices: language for unknown faction '{faction}'")
        if not re.fullmatch(r"[a-z]{2}", str(lang)):
            failures.append(f"voices: faction '{faction}' maps to '{lang}', not a two-letter language")
    check_announcements(voices, failures)
    spoken = set(langs.values())
    for key, line in voices.get("lines", {}).items():
        m = VOICE_KEY.match(key)
        if not m:
            failures.append(f"voices: key '{key}' is not <lang>.<class>.<trigger>")
            continue
        if m.group(1) not in spoken:
            failures.append(f"voices: key '{key}' is in a language no faction speaks")
        for v in line.get("variants", []):
            f = v.get("file")
            if not f:
                failures.append(f"voices '{key}': variant with no file")
                continue
            for field in VOICE_TEXT_FIELDS:
                if not v.get(field):
                    failures.append(f"{f}: no '{field}' -- a voice line carries its script, transliteration, meaning and generator")
            for role in ("file", "alt"):
                rel = v.get(role)
                if rel is None:
                    continue
                pm = VOICE_PATH.match(rel)
                if not pm:
                    failures.append(f"{rel}: not voice/<lang>/<class>/<trigger>_<nn><take>.ogg|m4a in ASCII [a-z0-9_]")
                    continue
                if pm.group(1, 2, 3) != m.group(1, 2, 3):
                    failures.append(f"{rel}: filed under a different key than '{key}'")
                declared.add(rel)
            check_licensed_file(v, failures, MAX_BYTES, licenses=VOICE_LICENSES, audio_dir=audio_dir)
    return declared


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    commercial = "--commercial" in argv
    unknown = [a for a in argv if a != "--commercial"]
    if unknown:
        print(f"unknown argument(s): {' '.join(unknown)}\nusage: python tools/validate_audio.py [--commercial]", file=sys.stderr)
        return 2
    failures = []
    notes = []

    if not os.path.exists(MANIFEST):
        print(f"no manifest at {MANIFEST} -- nothing to validate")
        return 0

    with open(MANIFEST) as fh:
        man = json.load(fh)

    master = man.get("master_gain", 1.0)
    if not 0 <= master <= MAX_GAIN:
        failures.append(f"master_gain {master} outside 0..{MAX_GAIN}")

    total_variants = 0
    total_ui = 0
    for name, spec in man.get("sets", {}).items():
        event = spec.get("event")
        if event not in KNOWN_EVENTS:
            failures.append(f"set '{name}': unknown event '{event}'")
        for cls in spec.get("weapon_classes", []):
            if cls not in KNOWN_WEAPON_CLASSES:
                failures.append(f"set '{name}': unknown weapon class '{cls}'")

        gain = spec.get("gain", 1.0)
        if not 0 <= gain <= MAX_GAIN:
            failures.append(f"set '{name}': gain {gain} outside 0..{MAX_GAIN}")
        jitter = spec.get("pitch_jitter", 0.0)
        if not 0 <= jitter <= MAX_JITTER:
            failures.append(f"set '{name}': pitch_jitter {jitter} outside 0..{MAX_JITTER}")

        for v in spec.get("variants", []):
            total_variants += 1
            f = v.get("file")
            if not f:
                failures.append(f"set '{name}': variant with no file")
                continue

            # `file` is the primary encoding, `alt` the Safari fallback of the
            # same sound — both must exist and both must be playable formats.
            check_licensed_file(v, failures, MAX_BYTES)
            if event == "ui":
                total_ui += 1
                check_ui_cue(v, failures, notes=notes, max_s=UI_CUE_CEILING_S.get(name, UI_MAX_S))

    # Music: same provenance bar as a clip, larger ceiling, and a 0..1 gain
    # because it is an <audio> element's volume rather than a GainNode.
    music = man.get("music")
    total_tracks = 0
    if music is not None:
        mgain = music.get("gain", 1.0)
        if not 0 <= mgain <= 1:
            failures.append(f"music: gain {mgain} outside 0..1")
        for t in music.get("tracks", []):
            total_tracks += 1
            if not t.get("file"):
                failures.append("music: track with no file")
                continue
            check_licensed_file(t, failures, MAX_MUSIC_BYTES)

    check_music_levels(music, failures, notes)
    declared_amb = check_ambience(man, failures, notes)
    total_cues = check_cues(man, failures)
    if commercial:
        check_commercial(man, failures)

    # Voices: WP-AU1 §6. Key completeness is a vitest (lines.test.ts, R-6);
    # this checks each key's shape and each variant's rights.
    voices = man.get("voices")
    declared_voice = check_voices(voices, failures, unit_factions())
    total_voice_variants = sum(
        len(line.get("variants", [])) for line in (voices or {}).get("lines", {}).values()
    )

    # Files on disk that nothing references are dead weight nobody will notice.
    if os.path.isdir(AUDIO_DIR):
        declared = {
            rel
            for spec in man.get("sets", {}).values()
            for v in spec.get("variants", [])
            for rel in (v.get("file"), v.get("alt"))
            if rel
        }
        declared |= {
            rel
            for t in (man.get("music") or {}).get("tracks", [])
            for rel in (t.get("file"), t.get("alt"))
            if rel
        }
        declared |= declared_voice
        declared |= declared_amb
        for dirpath, _, files in os.walk(AUDIO_DIR):
            for fn in files:
                if os.path.splitext(fn)[1].lower() not in ALLOWED_EXT:
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), AUDIO_DIR)
                if rel not in declared:
                    failures.append(f"{rel}: on disk but not declared in data/audio.json")

    for n in notes:
        print(f"  {n}")
    if failures:
        print(f"\nAUDIO GATE FAILED -- {len(failures)} issue(s):\n")
        for f in failures:
            print(f"  - {f}")
        return 1

    ui_note = f", {total_ui} ui cue(s) mono/length/peak-checked" if total_ui else ""
    music_note = f", {total_tracks} music track(s)" if total_tracks else ""
    voice_note = f", {total_voice_variants} voice variant(s)" if total_voice_variants else ""
    voice_note += f", {total_cues} cue(s) mapped" if total_cues else ""
    voice_note += f", {len(declared_amb) // 2} ambience bed(s)" if declared_amb else ""
    voice_note += ", commercial build clean" if commercial else ""
    if total_variants == 0:
        print(f"audio gate passed: manifest valid, no recordings yet (procedural synth in use){music_note}{voice_note}")
    else:
        print(f"audio gate passed: {total_variants} clip(s){ui_note}{music_note}{voice_note}, all licensed for redistribution")
    return 0


if __name__ == "__main__":
    sys.exit(main())
