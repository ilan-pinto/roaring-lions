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
                  licence is not yet confirmed: the five ElevenLabs takes on
                  four voice keys (D5, A3) stay out of a commercial build
                  until it is. `--commercial-manifest OUT` writes the
                  manifest a commercial build ships -- every such variant
                  taken out, its key kept with what is left (an empty list
                  plays nothing) -- checks it against this gate, and prints
                  the files the bundle must leave out (AU-10).
  10. AMBIENCE -- the `ambience.beds` table (polish pass F, A11): licence,
                  source, files and gain always; with ffmpeg and ffprobe, BOTH
                  encodings of every bed decoded and measured -- the decoded
                  length against the declared `loop_s` (to 1 ms), the channel
                  count against `channels`, the true peak (<= -6 dBTP), the
                  loudness as heard (-34 +- 2 LUFS) and the seam (no level
                  step, no gap). Without ffmpeg the skip is named.
  11. BEDS    -- `music.beds` (AU-7): both `calm` and `battle` or neither;
                  the theme's licence/source bar, the music size ceiling, a
                  trim in range; with ffmpeg and ffprobe BOTH encodings decoded
                  -- length against `loop_s` (to 1 ms), channels, true peak
                  plus trim at or under -1 dBTP, no codec gap at the wrap, and
                  the loudness as heard (file + trim + battle_gain +
                  master_gain): battle -26 +- 2 LUFS, calm -28 +- 2 and not
                  louder than battle (audio plan section 6.1). The level step
                  at the wrap is printed, not gated: a musical loop may wrap
                  from a fill into a downbeat.
  12. ENGINES -- `engines` (GH-35): every loop declares both candidates, `a`
                  and `b`, each with the clip licence/source bar and both
                  encodings on disk; `pick` is `a` or `b`; a gain in (0, 1];
                  every family layer names a declared loop and only the
                  `tracked` family carries a `clank`; every `by_type` id is a
                  shipped unit and every value a family or `none`; the cap,
                  radius and hysteresis in range. With ffmpeg and ffprobe BOTH
                  encodings of every candidate decoded: length against
                  `loop_s` (to 1 ms), channels, true peak <= -6 dBTP, no level
                  step or gap at the wrap, and heard (file + gain + master) at
                  or under -36 LUFS -- about 10 LU under the firefight's -26,
                  where the numbers sheet put one moving vehicle at -38.
  13. SUPPORT  -- the fire-support sounds (GH-782). Events `strike` (the sim's),
                  `flyby` and `incoming` (a support plan's aircraft pass and the
                  whistle before a known round; not sim events). `profiles`
                  (`air_strike`, `mortar_barrage`; `smoke_screen` refused by
                  name) only on those three; a `strike` set without it is the
                  default, `flyby` and `incoming` must name theirs; one profile
                  claimed twice on one event fails; `weapon_classes` is refused
                  on them. `radius_tiles` (0, 48] on any positional set, refused
                  on `ui`. `crest_s` is required on `flyby` and only there, and
                  under every variant's decoded length (ffprobe). These sets
                  and the `support_air.rotor` block may declare `LicenseRef-owned`
                  (the lead's ElevenLabs Sound Effects, ASSET_PROVENANCE item 2);
                  an ordinary battle set may not. The rotor block gets the bed
                  checks (loop length, channels, true peak, seam) through the
                  same code and its own ceiling: heard at -30 LUFS or under at
                  its station (4 tiles out, R `radius_tiles`).
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

import copy
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
    # GH-782: fire support. `strike` is the sim's own event (a round landing);
    # `flyby` and `incoming` are NOT sim events -- a support plan's aircraft pass
    # and the whistle before a known round -- played from the plan, not from a
    # sim event, and keyed by `profiles`.
    "strike", "flyby", "incoming",
    # Not a thing happening on the map: the mixer plays this unpositioned, so
    # it has no weapon class and no distance -- an alert or an objective cue,
    # about the player rather than about a place.
    "ui",
}
KNOWN_WEAPON_CLASSES = {
    "apfsds", "heat", "he", "atgm", "rpg", "small_arms", "hmg", "autocannon",
    "mortar", "rocket", "interceptor", "demolition",
}
# GH-782: the fire-support events, and the profiles they are keyed by. The names
# map to the sim's FIRE_SUPPORT indices in packages/render/src/audio.ts's
# AUDIO_SUPPORT_PROFILES; test_validate_audio_support.py pins the two together.
# `smoke_screen` is refused by name: the sim never raises `strike` for a smoke
# round, so a set keyed on it could never play. `drone_sweep` is not a profile.
SUPPORT_EVENTS = {"strike", "flyby", "incoming"}
KNOWN_PROFILES = {"air_strike", "mortar_barrage"}
RADIUS_MAX_TILES = 48
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
ANNOUNCER_LINE = re.compile(r"^[a-z]{2}\.common\.announce_([a-z_]+)$")   # GH-110/GH-753: an announcement's voice slot
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


def check_loop(rel, got, channels, loop_s, peak_ceiling, kind, failures):
    """The checks every looping file gets, read off one decoded measurement
    (`measure_bed`): the channel count the manifest declares, the decoded length
    against `loop_s` (to 1 ms), a true-peak ceiling, and the seam (no level step,
    no gap). Shared by the ambience beds, the engine loops and the support-air
    rotor, which differ in the ceiling and in how loud they may be heard."""
    if got["channels"] != channels:
        failures.append(f"{rel}: decodes to {got['channels']} channel(s), the manifest declares {channels}")
    if abs(got["seconds"] - loop_s) > AMB_LOOP_TOL_S:
        failures.append(
            f"{rel}: decodes to {got['seconds']:.4f} s, the loop is {loop_s:.4f} s -- "
            "an encoder's priming or padding left in loops with a gap"
        )
    if got["true_peak"] > peak_ceiling + 1e-9:
        failures.append(f"{rel}: true peak {got['true_peak']:+.1f} dBTP, over the {kind} ceiling {peak_ceiling} dBTP")
    if got["seam_level_db"] > AMB_SEAM_LEVEL_DB:
        failures.append(f"{rel}: the loop's seam steps {got['seam_level_db']:.1f} dB (over {AMB_SEAM_LEVEL_DB})")
    if got["seam_gap_db"] < -AMB_SEAM_GAP_DB:
        failures.append(f"{rel}: a gap at the loop's seam, {got['seam_gap_db']:.1f} dB under the file's own floor")


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
            check_loop(rel, got, channels, loop_s, AMB_MAX_TRUE_PEAK_DBTP, "bed", failures)
            heard = got["integrated"] + _db(gain * master)
            if abs(heard - AMB_HEARD_LUFS) > AMB_HEARD_TOL_LU + 1e-9:
                failures.append(
                    f"{rel}: heard at {heard:.1f} LUFS ({got['integrated']:.1f} LUFS, gain {gain}, master {master}), "
                    f"outside {AMB_HEARD_LUFS} +- {AMB_HEARD_TOL_LU}"
                )
            notes.append(
                f"{rel}: {got['seconds']:.3f} s loop, {got['channels']} ch, {got['true_peak']:+.1f} dBTP, "
                f"heard {heard:.1f} LUFS, seam {got['seam_level_db']:.1f} dB / gap {got['seam_gap_db']:+.1f} dB"
            )
    return declared


# GH-35: the engine loops. PR #597's numbers sheet: one moving vehicle at the
# camera centre is heard about 12 LU under combat (-38 against the firefight's
# -26). The gate is a CEILING with 2 LU of room, not a band: an idle loop is
# meant to sit 6 LU under its moving loop, and a clank 3 LU under that.
ENGINE_HEARD_MAX_LUFS = -36.0
ENGINE_MAX_TRUE_PEAK_DBTP = -6.0
ENGINE_LOOP_RANGE_S = (2.0, 30.0)
ENGINE_VARIANTS = ("a", "b")
ENGINE_LAYERS = ("idle", "move", "clank", "rotor")
ENGINE_CAP_RANGE = (1, 8)
ENGINE_RADIUS_RANGE = (4.0, 26.0)
UNITS_DIR = os.path.join(ROOT, "data", "units")


def shipped_unit_ids(units_dir=UNITS_DIR):
    """Every unit id under data/units/, read off the JSON."""
    ids = set()
    for dirpath, _, files in os.walk(units_dir):
        for fn in files:
            if fn.endswith(".json"):
                with open(os.path.join(dirpath, fn)) as fh:
                    uid = json.load(fh).get("id")
                if uid:
                    ids.add(uid)
    return ids


def _num(v):
    return not isinstance(v, bool) and isinstance(v, (int, float))


def check_engines(man, failures, notes, audio_dir=AUDIO_DIR, measure=measure_bed, unit_ids=None):
    """GH-35: the `engines` section. The shape always; with ffmpeg, both
    encodings of both candidates of every loop decoded and measured. Returns
    every file declared. Which family a unit type gets, and the mix maths, are
    vitests (packages/render/src/engines.test.ts)."""
    declared = set()
    eng = man.get("engines")
    if eng is None:
        return declared
    if not isinstance(eng, dict):
        failures.append("engines: not an object")
        return declared
    cap = eng.get("voice_cap")
    if not _num(cap) or cap != int(cap) or not ENGINE_CAP_RANGE[0] <= cap <= ENGINE_CAP_RANGE[1]:
        failures.append(f"engines: voice_cap {cap!r} is not a whole number in {ENGINE_CAP_RANGE[0]}..{ENGINE_CAP_RANGE[1]}")
    radius = eng.get("radius_tiles")
    if not _num(radius) or not ENGINE_RADIUS_RANGE[0] <= radius <= ENGINE_RADIUS_RANGE[1]:
        failures.append(f"engines: radius_tiles {radius!r} outside {ENGINE_RADIUS_RANGE[0]}..{ENGINE_RADIUS_RANGE[1]}")
    hyst = eng.get("hysteresis_tiles")
    if not _num(hyst) or not 0 <= hyst <= 6:
        failures.append(f"engines: hysteresis_tiles {hyst!r} outside 0..6")

    loops = eng.get("loops")
    if not isinstance(loops, dict) or not [k for k in loops if not k.startswith("$")]:
        failures.append("engines: no loops declared")
        loops = {}
    master = man.get("master_gain", 1.0)
    for loop, spec in loops.items():
        if loop.startswith("$"):
            continue
        label = f"engines loop '{loop}'"
        if not isinstance(spec, dict):
            failures.append(f"{label}: not an object")
            continue
        gain = spec.get("gain")
        if not _num(gain) or not 0 < gain <= 1:
            failures.append(f"{label}: gain {gain!r} outside (0, 1]")
            gain = None
        if spec.get("pick") not in ENGINE_VARIANTS:
            failures.append(f"{label}: pick {spec.get('pick')!r} is not one of {', '.join(ENGINE_VARIANTS)}")
        for variant in ENGINE_VARIANTS:
            v = spec.get(variant)
            vlabel = f"{label} candidate {variant}"
            if not isinstance(v, dict) or not v.get("file"):
                failures.append(f"{vlabel}: not declared (both candidates ship until the lead picks)")
                continue
            check_licensed_file(v, failures, MAX_BYTES, audio_dir=audio_dir)
            declared |= {v[r] for r in ("file", "alt") if v.get(r)}
            loop_s, channels = v.get("loop_s"), v.get("channels")
            if not _num(loop_s) or not ENGINE_LOOP_RANGE_S[0] <= loop_s <= ENGINE_LOOP_RANGE_S[1]:
                failures.append(f"{vlabel}: loop_s {loop_s!r} outside {ENGINE_LOOP_RANGE_S[0]}..{ENGINE_LOOP_RANGE_S[1]} s")
                continue
            if channels != 1 or isinstance(channels, bool):
                failures.append(f"{vlabel}: channels {channels!r} -- an engine is a placed sound, mono")
                continue
            for role in ("file", "alt"):
                rel = v.get(role)
                path = os.path.join(audio_dir, rel) if rel else None
                if not path or not os.path.exists(path):
                    continue  # check_licensed_file already names a missing file
                got = measure(path)
                if got is None:
                    notes.append(f"{rel}: engine loop NOT measured (no ffmpeg/ffprobe on PATH) -- loop, channels, peak, level and seam unchecked")
                    continue
                check_loop(rel, got, channels, loop_s, ENGINE_MAX_TRUE_PEAK_DBTP, "engine", failures)
                heard = None
                if gain is not None:
                    heard = got["integrated"] + _db(gain * master)
                    if heard > ENGINE_HEARD_MAX_LUFS + 1e-9:
                        failures.append(
                            f"{rel}: heard at {heard:.1f} LUFS at the camera ({got['integrated']:.1f} LUFS, gain {gain}, "
                            f"master {master}), over the engine ceiling {ENGINE_HEARD_MAX_LUFS}"
                        )
                notes.append(
                    f"{rel}: {got['seconds']:.3f} s loop, {got['true_peak']:+.1f} dBTP, "
                    + (f"heard {heard:.1f} LUFS, " if heard is not None else "")
                    + f"seam {got['seam_level_db']:.1f} dB / gap {got['seam_gap_db']:+.1f} dB"
                )

    families = eng.get("families")
    if not isinstance(families, dict) or not families:
        failures.append("engines: no families declared")
        families = {}
    for fam, layers in families.items():
        if not isinstance(layers, dict) or not layers:
            failures.append(f"engines family '{fam}': no layers")
            continue
        for layer, loop in layers.items():
            if layer not in ENGINE_LAYERS:
                failures.append(f"engines family '{fam}': unknown layer '{layer}' (one of {', '.join(ENGINE_LAYERS)})")
            elif loop not in loops:
                failures.append(f"engines family '{fam}': layer '{layer}' names loop '{loop}', which is not declared")
        if "clank" in layers and fam != "tracked":
            failures.append(f"engines family '{fam}': only the tracked family carries a track clank")

    by_type = eng.get("by_type") or {}
    if not isinstance(by_type, dict):
        failures.append("engines: by_type is not an object")
        by_type = {}
    ids = shipped_unit_ids() if unit_ids is None else unit_ids
    for uid, fam in by_type.items():
        if uid.startswith("$"):
            continue
        if uid not in ids:
            failures.append(f"engines by_type: '{uid}' is not a shipped unit id")
        if fam != "none" and fam not in families:
            failures.append(f"engines by_type: '{uid}' names family '{fam}', which is not declared (or 'none')")
    return declared


# GH-782: the fire-support sounds.
SUPPORT_LICENSES = dict(ALLOWED_LICENSES, **{"LicenseRef-owned": False})
ROTOR_LOOP_RANGE_S = (4.0, 8.0)
ROTOR_MAX_TRUE_PEAK_DBTP = AMB_MAX_TRUE_PEAK_DBTP
# The Peten holds station this many tiles from the aim point
# (packages/render/src/three/support-air.ts HELI_STATION_TILES; pinned by
# test_validate_audio_support.py). Heard there, in a mix where one moving
# vehicle is -38 and the battle bed -26, the rotor sits at -30 LUFS or under.
ROTOR_STATION_TILES = 4.0
ROTOR_HEARD_MAX_LUFS = -30.0


def probe_seconds(path):
    """The decoded length of a file in seconds (ffprobe), or None without ffprobe."""
    if shutil.which("ffprobe") is None:
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout.strip()
        return float(out)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


# The takes of one support set are heard within this many dB of each other (maximum
# momentary loudness x set gain x master). The shipped barrage reads 2.5 and the
# bomb 3.3: the lead's takes differ in crest and are left unequal on purpose.
SUPPORT_SPREAD_MAX_DB = 3.5


def momentary_max(path):
    """ffmpeg ebur128's maximum momentary (400 ms) loudness in LUFS, or None
    without ffmpeg or when the read fails."""
    if shutil.which("ffmpeg") is None:
        return None
    try:
        out = subprocess.run(
            ["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        ).stderr
    except (OSError, subprocess.SubprocessError):
        return None
    vals = [float(v) for v in re.findall(r"M:\s*(-?[\d.]+)", out)]
    return max(vals) if vals else None


def check_heard_spread(name, spec, failures, notes, audio_dir=AUDIO_DIR, measure=momentary_max):
    """GH-782: a strike, flyby or incoming set's takes are heard within
    SUPPORT_SPREAD_MAX_DB of one another. The set gain is common to its takes, so
    this is the spread of their file momentary maxima. Named skip without ffmpeg."""
    if spec.get("event") not in SUPPORT_EVENTS:
        return
    heard = {}
    for v in spec.get("variants", []):
        rel = v.get("file")
        path = os.path.join(audio_dir, rel) if rel else None
        if not path or not os.path.exists(path):
            continue  # check_licensed_file already names a missing file
        m = measure(path)
        if m is None:
            notes.append(f"set '{name}': heard-level spread NOT checked (no ffmpeg on PATH)")
            return
        gain = spec.get("gain", 1.0)
        heard[rel] = m + _db(gain)
    if len(heard) < 2:
        return
    lo, hi = min(heard.values()), max(heard.values())
    if hi - lo > SUPPORT_SPREAD_MAX_DB + 1e-9:
        loud = max(heard, key=heard.get)
        quiet = min(heard, key=heard.get)
        failures.append(
            f"set '{name}': its takes are heard {hi - lo:.1f} dB apart ({loud} at {hi:+.1f}, {quiet} at {lo:+.1f}), "
            f"over {SUPPORT_SPREAD_MAX_DB} dB -- level them to one momentary max"
        )
    else:
        notes.append(f"set '{name}': takes heard within {hi - lo:.1f} dB of each other (limit {SUPPORT_SPREAD_MAX_DB})")


def check_set_fields(name, spec, failures):
    """GH-782: the per-set fields the support events add, and the two they refuse."""
    event = spec.get("event")
    support = event in SUPPORT_EVENTS
    if "radius_tiles" in spec:
        r = spec["radius_tiles"]
        if event == "ui":
            failures.append(f"set '{name}': radius_tiles on a ui set, which has no position to fall off from")
        elif not _num(r) or not 0 < r <= RADIUS_MAX_TILES:
            failures.append(f"set '{name}': radius_tiles {r!r} outside (0, {RADIUS_MAX_TILES}]")
    if support and "weapon_classes" in spec:
        failures.append(f"set '{name}': weapon_classes is for fire sets; a {event} set is keyed by profiles")
    if "profiles" in spec:
        profiles = spec["profiles"]
        if not support:
            failures.append(f"set '{name}': profiles is only for strike, flyby and incoming sets, not '{event}'")
        elif not isinstance(profiles, list) or not profiles or not all(isinstance(p, str) for p in profiles):
            failures.append(f"set '{name}': profiles must be a non-empty list of profile names")
        else:
            for prof in profiles:
                if prof == "smoke_screen":
                    failures.append(f"set '{name}': profile 'smoke_screen' can never play -- the sim raises no strike for a smoke round")
                elif prof not in KNOWN_PROFILES:
                    failures.append(f"set '{name}': unknown profile '{prof}' (one of {', '.join(sorted(KNOWN_PROFILES))})")
    elif event in ("flyby", "incoming"):
        failures.append(f"set '{name}': a {event} set names its profiles (only a strike set has a default)")
    crest = spec.get("crest_s")
    if "crest_s" in spec and event != "flyby":
        failures.append(f"set '{name}': crest_s is only for a flyby set, not '{event}'")
    if event == "flyby" and (not _num(crest) or crest <= 0):
        failures.append(f"set '{name}': a flyby set needs crest_s > 0 (where in the clip its pass peaks), got {crest!r}")


def check_profile_claims(sets, failures):
    """GH-782: one profile, one set, per event. `weapon_classes` lets the last
    set win silently; that is not copied here. A strike set with no `profiles`
    is the default, and there is at most one."""
    claims = {}
    for name, spec in sets.items():
        event = spec.get("event")
        if event not in SUPPORT_EVENTS:
            continue
        profiles = spec.get("profiles")
        if profiles is None:
            claims.setdefault((event, None), []).append(name)
        elif isinstance(profiles, list):
            for prof in profiles:
                claims.setdefault((event, prof), []).append(name)
    for (event, prof), names in claims.items():
        if len(names) > 1:
            what = "the default (no profiles)" if prof is None else f"profile '{prof}'"
            failures.append(f"{event}: {what} is claimed by more than one set ({', '.join(names)})")


def check_crest(name, spec, failures, notes, audio_dir=AUDIO_DIR, probe=probe_seconds):
    """GH-782: a flyby's `crest_s` lies inside every variant's decoded length."""
    crest = spec.get("crest_s")
    if spec.get("event") != "flyby" or not _num(crest) or crest <= 0:
        return
    for v in spec.get("variants", []):
        for role in ("file", "alt"):
            rel = v.get(role)
            path = os.path.join(audio_dir, rel) if rel else None
            if not path or not os.path.exists(path):
                continue  # check_licensed_file already names a missing file
            seconds = probe(path)
            if seconds is None:
                notes.append(f"{rel}: crest_s {crest} NOT checked against the clip's length (no ffprobe on PATH)")
            elif crest >= seconds:
                failures.append(f"{rel}: crest_s {crest} is not inside the clip, which decodes to {seconds:.3f} s")


def check_support_air(man, failures, notes, audio_dir=AUDIO_DIR, measure=measure_bed):
    """GH-782: `support_air.rotor`, the loop the Peten plays over a mortar
    barrage. Shape always; with ffmpeg and ffprobe both encodings decoded and
    given the bed checks (`check_loop`) plus a ceiling of its own: heard at
    ROTOR_HEARD_MAX_LUFS or under at its station. Returns every file declared."""
    declared = set()
    block = man.get("support_air")
    if block is None:
        return declared
    if not isinstance(block, dict):
        failures.append("support_air: not an object")
        return declared
    for key in block:
        if key != "rotor" and not key.startswith("$"):
            failures.append(f"support_air: unknown entry '{key}' (only `rotor`)")
    spec = block.get("rotor")
    if spec is None:
        return declared
    label = "support_air rotor"
    if not isinstance(spec, dict) or not spec.get("file"):
        failures.append(f"{label}: no file")
        return declared
    check_licensed_file(spec, failures, MAX_BYTES, licenses=SUPPORT_LICENSES, audio_dir=audio_dir)
    declared |= {spec[r] for r in ("file", "alt") if spec.get(r)}
    master = man.get("master_gain", 1.0)
    gain, loop_s, channels, radius = spec.get("gain"), spec.get("loop_s"), spec.get("channels"), spec.get("radius_tiles")
    if not _num(gain) or not 0 < gain <= 1:
        failures.append(f"{label}: gain {gain!r} outside (0, 1]")
        return declared
    if not _num(loop_s) or not ROTOR_LOOP_RANGE_S[0] <= loop_s <= ROTOR_LOOP_RANGE_S[1]:
        failures.append(f"{label}: loop_s {loop_s!r} outside {ROTOR_LOOP_RANGE_S[0]}..{ROTOR_LOOP_RANGE_S[1]} s")
        return declared
    if channels != 1 or isinstance(channels, bool):
        failures.append(f"{label}: channels {channels!r} -- the rotor is a placed sound, mono")
        return declared
    if not _num(radius) or not ROTOR_STATION_TILES < radius <= RADIUS_MAX_TILES:
        failures.append(f"{label}: radius_tiles {radius!r} outside ({ROTOR_STATION_TILES:g}, {RADIUS_MAX_TILES}] (it must reach its station)")
        return declared
    atten = (1 - ROTOR_STATION_TILES / radius) ** 2
    for role in ("file", "alt"):
        rel = spec.get(role)
        path = os.path.join(audio_dir, rel) if rel else None
        if not path or not os.path.exists(path):
            continue  # check_licensed_file already names a missing file
        got = measure(path)
        if got is None:
            notes.append(f"{rel}: rotor loop NOT measured (no ffmpeg/ffprobe on PATH) -- loop, channels, peak, level and seam unchecked")
            continue
        check_loop(rel, got, channels, loop_s, ROTOR_MAX_TRUE_PEAK_DBTP, "rotor", failures)
        heard = got["integrated"] + _db(gain * master * atten)
        if heard > ROTOR_HEARD_MAX_LUFS + 1e-9:
            failures.append(
                f"{rel}: heard at {heard:.1f} LUFS on station ({got['integrated']:.1f} LUFS, gain {gain}, master {master}, "
                f"{ROTOR_STATION_TILES:g} of {radius} tiles out), over the rotor ceiling {ROTOR_HEARD_MAX_LUFS}"
            )
        notes.append(
            f"{rel}: {got['seconds']:.3f} s loop, {got['true_peak']:+.1f} dBTP, heard on station {heard:.1f} LUFS, "
            f"seam {got['seam_level_db']:.1f} dB / gap {got['seam_gap_db']:+.1f} dB"
        )
    return declared


# AU-7: the mission beds as heard, audio plan section 6.1.
BED_HEARD_LUFS = {"calm": -28.0, "battle": -26.0}
BED_HEARD_TOL_LU = 2.0
BED_LOOP_RANGE_S = (8.0, 120.0)


def check_music_beds(man, failures, notes, audio_dir=AUDIO_DIR, measure=measure_bed):
    """AU-7: `music.beds`. Returns every file declared. Which beds the
    mixer asks for is a vitest (packages/render/src/audio.test.ts)."""
    declared = set()
    music = man.get("music") or {}
    beds = music.get("beds")
    if beds is None:
        return declared
    if not isinstance(beds, dict) or set(k for k in beds if not k.startswith("$")) != {"calm", "battle"}:
        failures.append("music.beds: declares exactly `calm` and `battle`, or is absent (the mixer needs both)")
        return declared
    gain = music.get("battle_gain", music.get("gain", 1.0))
    master = man.get("master_gain", 1.0)
    heard = {}
    for bed in ("calm", "battle"):
        spec = beds[bed]
        label = f"music bed '{bed}'"
        if not isinstance(spec, dict) or not spec.get("file"):
            failures.append(f"{label}: no file")
            continue
        check_licensed_file(spec, failures, MAX_MUSIC_BYTES, audio_dir=audio_dir)
        declared |= {spec[r] for r in ("file", "alt") if spec.get(r)}
        trim = spec.get("trim_db", 0.0)
        loop_s = spec.get("loop_s")
        channels = spec.get("channels")
        if isinstance(trim, bool) or not isinstance(trim, (int, float)) or not TRIM_DB_RANGE[0] <= trim <= TRIM_DB_RANGE[1]:
            failures.append(f"{label}: trim_db {trim!r} outside {TRIM_DB_RANGE[0]}..{TRIM_DB_RANGE[1]} dB")
            continue
        if isinstance(loop_s, bool) or not isinstance(loop_s, (int, float)) or not BED_LOOP_RANGE_S[0] <= loop_s <= BED_LOOP_RANGE_S[1]:
            failures.append(f"{label}: loop_s {loop_s!r} outside {BED_LOOP_RANGE_S[0]}..{BED_LOOP_RANGE_S[1]} s")
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
            if got["true_peak"] + trim > MAX_TRUE_PEAK_DBTP + 1e-9:
                failures.append(f"{rel}: true peak {got['true_peak'] + trim:+.1f} dBTP after trim, over {MAX_TRUE_PEAK_DBTP} dBTP")
            if got["seam_gap_db"] < -AMB_SEAM_GAP_DB:
                failures.append(f"{rel}: a gap at the loop's seam, {got['seam_gap_db']:.1f} dB under the file's own floor")
            level = got["integrated"] + trim + _db(gain * master)
            if role == "file":
                heard[bed] = level
            if abs(level - BED_HEARD_LUFS[bed]) > BED_HEARD_TOL_LU + 1e-9:
                failures.append(
                    f"{rel}: heard at {level:.1f} LUFS ({got['integrated']:.1f} LUFS, trim {trim}, battle_gain {gain}, "
                    f"master {master}), outside {BED_HEARD_LUFS[bed]} +- {BED_HEARD_TOL_LU}"
                )
            notes.append(
                f"{rel}: {got['seconds']:.3f} s loop, {got['channels']} ch, {got['true_peak'] + trim:+.1f} dBTP, "
                f"heard {level:.1f} LUFS, seam step {got['seam_level_db']:.1f} dB (reported) / gap {got['seam_gap_db']:+.1f} dB"
            )
    if "calm" in heard and "battle" in heard and heard["calm"] > heard["battle"] + 1e-9:
        failures.append(f"music.beds: calm is heard at {heard['calm']:.1f} LUFS, louder than battle's {heard['battle']:.1f}")
    return declared


def check_commercial(man, failures):
    """A3: what a commercial build may not carry. Every variant, in every
    section, whose `source` records an unconfirmed licence."""
    found = []
    for spec in man.get("sets", {}).values():
        found += [v for v in spec.get("variants", [])]
    found += list((man.get("music") or {}).get("tracks", []))
    found += [b for b in ((man.get("music") or {}).get("beds") or {}).values() if isinstance(b, dict)]
    found += [b for b in ((man.get("ambience") or {}).get("beds") or {}).values() if isinstance(b, dict)]
    for loop in ((man.get("engines") or {}).get("loops") or {}).values():
        if isinstance(loop, dict):
            found += [loop[v] for v in ENGINE_VARIANTS if isinstance(loop.get(v), dict)]
    for line in ((man.get("voices") or {}).get("lines") or {}).values():
        found += line.get("variants", [])
    rotor = (man.get("support_air") or {}).get("rotor")
    if isinstance(rotor, dict):
        found.append(rotor)
    for v in found:
        if UNCONFIRMED_LICENCE.search(v.get("source", "") or ""):
            failures.append(f"{v.get('file')}: licence not confirmed -- it cannot ship in a commercial build (D5, A3)")


def commercial_manifest(man):
    """AU-10: the manifest a commercial build ships, and the files it leaves
    out. A deep copy of `man` with every variant whose `source` records an
    unconfirmed licence removed, in every section `check_commercial` reads;
    a voice key keeps its declaration with the takes that remain (an empty
    `variants` list plays nothing). `man` itself is not touched. Returns
    `(stripped, excluded)`, `excluded` being every `file` and `alt` removed."""
    out = copy.deepcopy(man)
    excluded = []

    def keep(v):
        if isinstance(v, dict) and UNCONFIRMED_LICENCE.search(v.get("source", "") or ""):
            excluded.extend(f for f in (v.get("file"), v.get("alt")) if f)
            return False
        return True

    for spec in out.get("sets", {}).values():
        spec["variants"] = [v for v in spec.get("variants", []) if keep(v)]
    music = out.get("music")
    if music:
        music["tracks"] = [t for t in music.get("tracks", []) if keep(t)]
        beds = music.get("beds")
        if isinstance(beds, dict):
            for name in [n for n, b in beds.items() if not keep(b)]:
                del beds[name]
    amb = (out.get("ambience") or {}).get("beds")
    if isinstance(amb, dict):
        for name in [n for n, b in amb.items() if not keep(b)]:
            del amb[name]
    for loop in ((out.get("engines") or {}).get("loops") or {}).values():
        if isinstance(loop, dict):
            for v in [v for v in ENGINE_VARIANTS if isinstance(loop.get(v), dict) and not keep(loop[v])]:
                del loop[v]
    for line in ((out.get("voices") or {}).get("lines") or {}).values():
        line["variants"] = [v for v in line.get("variants", []) if keep(v)]
    air = out.get("support_air")
    if isinstance(air, dict) and isinstance(air.get("rotor"), dict) and not keep(air["rotor"]):
        del air["rotor"]
    return out, excluded


def write_commercial_manifest(path):
    """`--commercial-manifest OUT`: write the stripped manifest, prove it
    clean against the commercial gate, and print what the bundle leaves out."""
    with open(MANIFEST) as fh:
        man = json.load(fh)
    stripped, excluded = commercial_manifest(man)
    failures = []
    check_commercial(stripped, failures)
    if failures:
        print("commercial manifest still carries an unconfirmed licence:\n  " + "\n  ".join(failures), file=sys.stderr)
        return 1
    with open(path, "w") as fh:
        json.dump(stripped, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {path}: commercial gate clean; leave these {len(excluded)} file(s) out of the bundle (assets/audio/...):")
    for f in sorted(excluded):
        print(f"  {f}")
    return 0


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


ANNOUNCE_PRIORITIES = ("high", "normal", "low", "outcome")
EN_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "packages", "app", "src", "i18n", "en.json")


def check_announcements(voices, failures, captions=None):
    """GH-110: the announcement table. A caption is an i18n key that must exist
    in en.json (`captions`, a set; read from EN_JSON when None); `audio` is empty
    until a line is recorded, else a key declared in voices.lines with at least
    one recorded take (its files are check_voices' to find on disk)."""
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
        elif audio != "" and not (lines[audio] or {}).get("variants"):
            # A key is named only once a take is recorded: an announcement
            # pointing at an empty line would read as voiced and play nothing.
            failures.append(f"announcements '{name}': audio '{audio}' has no recorded take -- leave audio '' until one is")
        cd = ev.get("cooldown_s")
        if isinstance(cd, bool) or not isinstance(cd, (int, float)) or cd < 0:
            failures.append(f"announcements '{name}': cooldown_s {cd!r} is not a non-negative number")
        if ev.get("priority") not in ANNOUNCE_PRIORITIES:
            failures.append(f"announcements '{name}': priority {ev.get('priority')!r} is not one of {ANNOUNCE_PRIORITIES}")
    # GH-753: the other direction. An announcer line (`<lang>.common.announce_<event>`) may be declared
    # EMPTY -- a slot waiting for its recording (an empty `variants` list plays nothing) -- but it must name
    # an event the table declares, and once it holds a take the event's `audio` must name it: otherwise the
    # take is shipped and never played.
    for key, line in lines.items():
        m = ANNOUNCER_LINE.match(key)
        if not m:
            continue
        ev = events.get(m.group(1))
        if ev is None:
            failures.append(f"voices '{key}': an announcer line for event '{m.group(1)}', which the announcements table does not declare")
        elif (line or {}).get("variants") and ev.get("audio") != key:
            failures.append(
                f"voices '{key}': has recorded take(s) but announcements '{m.group(1)}' audio is {ev.get('audio')!r} "
                f"-- set it to '{key}', or the take ships and never plays"
            )


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
            # GH-753: ElevenLabs speech carries its licence state in `source`: either the plan was paid (cleared)
            # or the licence is not confirmed (kept out of a commercial build by check_commercial). A source that
            # says neither would slip past that gate, so it fails here.
            src = v.get("source", "") or ""
            if "elevenlabs" in str(v.get("generator", "")).lower() and not UNCONFIRMED_LICENCE.search(src) \
                    and "paid elevenlabs plan" not in src.lower():
                failures.append(f"{f}: generator is ElevenLabs but the source neither says it was a paid ElevenLabs plan "
                                "nor that the licence is not confirmed (D5)")
            check_licensed_file(v, failures, MAX_BYTES, licenses=VOICE_LICENSES, audio_dir=audio_dir)
    return declared


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) == 2 and argv[0] == "--commercial-manifest":
        return write_commercial_manifest(argv[1])
    commercial = "--commercial" in argv
    unknown = [a for a in argv if a != "--commercial"]
    if unknown:
        print(
            f"unknown argument(s): {' '.join(unknown)}\n"
            "usage: python tools/validate_audio.py [--commercial | --commercial-manifest OUT]",
            file=sys.stderr,
        )
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
        check_set_fields(name, spec, failures)
        check_crest(name, spec, failures, notes)
        check_heard_spread(name, spec, failures, notes)

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
            check_licensed_file(v, failures, MAX_BYTES, licenses=SUPPORT_LICENSES if event in SUPPORT_EVENTS else ALLOWED_LICENSES)
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

    check_profile_claims(man.get("sets", {}), failures)
    check_music_levels(music, failures, notes)
    declared_amb = check_ambience(man, failures, notes)
    declared_support = check_support_air(man, failures, notes)
    declared_beds = check_music_beds(man, failures, notes)
    declared_engines = check_engines(man, failures, notes)
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
        declared |= declared_beds
        declared |= declared_engines
        declared |= declared_support
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
    voice_note += f", {len(declared_beds) // 2} music bed(s)" if declared_beds else ""
    voice_note += f", {len(declared_engines) // 2} engine loop candidate(s)" if declared_engines else ""
    voice_note += ", commercial build clean" if commercial else ""
    if total_variants == 0:
        print(f"audio gate passed: manifest valid, no recordings yet (procedural synth in use){music_note}{voice_note}")
    else:
        print(f"audio gate passed: {total_variants} clip(s){ui_note}{music_note}{voice_note}, all licensed for redistribution")
    return 0


if __name__ == "__main__":
    sys.exit(main())
