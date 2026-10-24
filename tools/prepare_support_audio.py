#!/usr/bin/env python3
"""
Roaring Lions -- prepare the fire-support sounds (GH-782).

    python3 tools/prepare_support_audio.py --src=<dir of the lead's WAVs>
    python3 tools/prepare_support_audio.py -h

The lead generated the sounds with ElevenLabs Sound Effects (14 takes, 48 kHz
16-bit stereo, 29 MB). They are not committed: `tools/support_audio_sources.json`
lists every input's filename, sha256 and role, and this script REFUSES an input
whose hash differs. Needs numpy and ffmpeg, like gen_audio.py, and encodes with
gen_audio.py's CLIP_CODECS (OGG Vorbis q3) plus AAC M4A at 160 kb/s (see SUPPORT_CODECS).

Per take: downmix to mono as (L+R)/2, resample to 44.1 kHz, trim, fade,
normalise to the approved HEARD level of its set, encode. "Heard" is the file
level + 20 log10(set gain) + 20 log10(master_gain), measured as the maximum
momentary loudness (ffmpeg ebur128 M); the rotor loop, a bed, is measured as
integrated loudness at the camera with the Peten on station.

    set                 heard target    approved gain
    barrage_impact      -15.8 LUFS M    0.85
    strike_impact       about -11       1.1
    jet_flyby (crest)   -15.2           0.8
    incoming_whistle    -21.8 (6 LU under a barrage round)    1.0
    rotor loop          -33 (integrated, Peten 4 tiles out, R 30)   0.5

Rules this script enforces and reports:
  * A take with a clipped sample (|x| >= 0.999) is not clean and is dropped.
  * The true peak of a shipped file (BOTH encodings, decoded) stays at or under
    -1 dBTP. When the heard target cannot be reached under that ceiling, the SET
    GAIN is raised and the files scaled down instead (reported). When even that
    needs a gain over 1.5 (validate_audio's ceiling), the gain is 1.5 and a take
    that still cannot reach the target is set to its own ceiling: quieter than
    the set by a reported number of dB. Nothing is limited or compressed.
  * The jet: every take is trimmed so its loudness peak (the centre of its
    maximum 400 ms momentary window) lands at one set-level `crest_s`.
  * The rotor loop: the steadiest stretch of a clean helicopter take, cut at
    positive-going zero crossings a whole number of 1024-sample frames apart
    (the AAC frame rule, as the ambience beds), best waveform match across the
    seam, an equal-power crossfade of a few hundred samples, and a seam check
    that FAILS the run on a click.

Writes assets/audio/{barrage_impact,strike_impact,jet_flyby,incoming_whistle}/
<set>_0N.{ogg,m4a}, assets/audio/support/rotor_loop.{ogg,m4a}, and the matching
entries of data/audio.json (formatted as gen_audio.py does). Deterministic: the
same inputs give the same samples.
"""
import hashlib
import json
import math
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_audio  # noqa: E402  (CLIP_CODECS, encode, SR: the encoding is gen_audio's, not a copy)
from validate_audio import seam_metrics  # noqa: E402  (the ambience validator's seam measure)

ROOT = gen_audio.ROOT
SR = gen_audio.SR
MANIFEST = gen_audio.MANIFEST
AUDIO_DIR = gen_audio.OUT
SOURCES = os.path.join(HERE, "support_audio_sources.json")

# gen_audio.py's CLIP_CODECS, with the M4A at 160 kb/s as encode_engine_loops.py does for the same reason: at the
# clips' 96 kb/s ffmpeg's AAC encoder overshoots a sharp transient (barrage take 3: +4.0 dB true peak over its PCM,
# at 128 kb/s +4.2, at 160 kb/s 0.0), which with the -1 dBTP ceiling would cost that take 4 dB of level. The OGG
# is gen_audio's CLIP_CODECS exactly, plus `-fflags +bitexact` (no random Ogg serial: a re-run writes the same bytes).
SUPPORT_CODECS = {".ogg": ["-fflags", "+bitexact", *gen_audio.CLIP_CODECS[".ogg"]], ".m4a": ["-c:a", "aac", "-b:a", "160k"]}

MASTER = 0.9                      # data/audio.json master_gain
MASTER_DB = 20 * math.log10(MASTER)
TP_CEILING = -1.0                 # dBTP, shipped files
TP_MARGIN = 0.1                   # ebur128 prints a peak to 0.1 dB; the shipped files are re-measured after encoding
MAX_GAIN = 1.5                    # validate_audio.MAX_GAIN
CLIP_LIMIT = 0.999

PROVENANCE = (
    "AI-generated with ElevenLabs Sound Effects, supplied by the lead; commercial-use licence per the lead's "
    "ElevenLabs plan (GH-782); prepared by tools/prepare_support_audio.py"
)
UNCONFIRMED = "; plan and date not recorded, commercial licence NOT yet confirmed (docs/ASSET_PROVENANCE.md item 2)"
LICENSE = "LicenseRef-owned"
CREDIT = "Ilan Pinto"

# The approved mix (design.md section 3, the lead's levels).
SETS = {
    "barrage_impact": dict(event="strike", profiles=["mortar_barrage"], target=-15.8, gain=0.85, jitter=0.12,
                           radius=None, length_s=2.5, fade_out_s=0.8),
    "strike_impact": dict(event="strike", profiles=["air_strike"], target=-11.0, gain=1.1, jitter=0.06,
                          radius=40, length_s=5.0, fade_out_s=1.0),
    "jet_flyby": dict(event="flyby", profiles=["air_strike"], target=-15.2, gain=0.8, jitter=0.04,
                      radius=40, length_s=5.0, fade_out_s=1.0, crest_s=1.8, fade_in_s=0.3),
    "incoming_whistle": dict(event="incoming", profiles=["mortar_barrage"], target=-21.8, gain=1.0, jitter=0.05,
                             radius=None),
}
PRE_ROLL_S = 0.004                # silence kept before a hit's first sample
HIT_FADE_IN_S = 0.002             # 2 ms raised-cosine fade-in on a hit
ONSET_REL = 0.03                  # the hit starts where |x| first passes this fraction of the take's peak
WHISTLE_FADE_IN_S = 0.08
WHISTLE_FADE_OUT_S = 0.04

ROTOR = dict(target=-33.0, gain=0.5, radius=30, station_tiles=4, loop_s_range=(4.0, 6.0), xfade=256,
             window_s=8.0, file="support/rotor_loop.ogg", alt="support/rotor_loop.m4a")
# The seam must be no worse than the loop's own ordinary variation: the step
# from the last sample to the first against 1.5x the 99th percentile of the loop's
# sample-to-sample steps, and the 10 ms RMS either side against the 95th
# percentile of the dB change between adjacent 10 ms windows.
SEAM_STEP_RATIO_MAX = 1.5
SEAM_RMS_PCT = 95


class Refusal(Exception):
    """A rule of this script, not a bug: reported and exit 1."""


# --- reading ------------------------------------------------------------------
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load_sources(src_dir, sources_path=SOURCES):
    """The inputs by role, each hash-checked. A missing or changed file refuses."""
    with open(sources_path) as fh:
        doc = json.load(fh)
    by_role = {}
    for entry in doc["inputs"]:
        path = os.path.join(src_dir, entry["file"])
        if not os.path.exists(path):
            raise Refusal(f"{entry['file']}: not in {src_dir}")
        got = sha256(path)
        if got != entry["sha256"]:
            raise Refusal(f"{entry['file']}: sha256 {got} differs from {entry['sha256']} in {os.path.basename(sources_path)} "
                          "-- not the lead's file; refusing")
        by_role.setdefault(entry["role"], []).append({**entry, "path": path})
    for takes in by_role.values():
        takes.sort(key=lambda e: e["take"])
    return by_role


def read_wav(path):
    """(float samples [n, channels] in -1..1, rate) of a 16-bit PCM WAV."""
    import wave
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise Refusal(f"{path}: not 16-bit PCM")
        n, ch, rate = w.getnframes(), w.getnchannels(), w.getframerate()
        raw = w.readframes(n)
    return np.frombuffer(raw, dtype="<i2").reshape(-1, ch).astype(np.float64) / 32768.0, rate


def to_mono_44k(x, rate):
    """(L+R)/2, then resampled to 44.1 kHz with ffmpeg's soxr like every shipped clip."""
    m = x.mean(axis=1)
    if rate == SR:
        return m
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "-",
         "-af", f"aresample={SR}:resampler=soxr", "-f", "f32le", "-"],
        input=m.astype("<f4").tobytes(), capture_output=True, check=True,
    ).stdout
    return np.frombuffer(out, dtype="<f4").astype(np.float64)


# --- measuring ----------------------------------------------------------------
def ebur(x):
    """ffmpeg ebur128 on mono samples at SR: integrated LUFS, the maximum
    momentary (400 ms) loudness, the M series as (window end s, M), true peak dBTP."""
    text = subprocess.run(
        ["ffmpeg", "-nostats", "-hide_banner", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
         "-af", "ebur128=peak=true", "-f", "null", "-"],
        input=np.asarray(x, dtype="<f4").tobytes(), capture_output=True,
    ).stderr.decode()
    series = [(float(t), float(m)) for t, m in re.findall(r"t:\s*([\d.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?[\d.]+)", text)]
    summary = text[text.rfind("Summary:"):]
    integrated = float(re.search(r"I:\s*(-?[\d.]+)\s*LUFS", summary).group(1))
    tp = re.search(r"Peak:\s*(-?[\d.]+|-inf)\s*dBFS", summary).group(1)
    return {
        "I": integrated,
        "M": max(m for _, m in series),
        "series": series,
        "TP": float("-inf") if tp == "-inf" else float(tp),
    }


def decode_file(path):
    """An encoded file as mono floats at SR, the way a player decodes it."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def db(v):
    return 20 * math.log10(v) if v > 0 else float("-inf")


def loudness_peak_s(series, within_db=0.5):
    """Time (s) of a take's loudness peak: the centre of the maximum momentary
    window; across a plateau (every window within `within_db` of the maximum and
    contiguous with it) the centre of the plateau."""
    mmax = max(m for _, m in series)
    top = max(range(len(series)), key=lambda i: series[i][1])
    lo = hi = top
    while lo > 0 and series[lo - 1][1] >= mmax - within_db:
        lo -= 1
    while hi < len(series) - 1 and series[hi + 1][1] >= mmax - within_db:
        hi += 1
    return (series[lo][0] + series[hi][0]) / 2 - 0.2


# --- editing ------------------------------------------------------------------
def fade_in(x, seconds):
    n = min(len(x), max(1, int(seconds * SR)))
    out = x.copy()
    out[:n] *= 0.5 * (1 - np.cos(np.pi * np.arange(n) / n))
    return out


def fade_out(x, seconds):
    """A cos^2 (equal-power) fade over the last `seconds`."""
    n = min(len(x), max(1, int(seconds * SR)))
    out = x.copy()
    out[-n:] *= np.cos(0.5 * np.pi * np.arange(n) / n) ** 2
    return out


def onset_index(x):
    """First sample of the hit: |x| passes ONSET_REL of the take's peak."""
    return int(np.argmax(np.abs(x) >= ONSET_REL * np.abs(x).max()))


def take_hit(x, length_s, fade_out_s):
    """A hit starting on its first sample: PRE_ROLL_S of lead-in (the source's own
    when it has that much, zeros when the take starts on the hit), a 2 ms
    raised-cosine fade-in, and `length_s` in all with an equal-power fade over the
    tail. A take that starts ON the hit has its first 2 ms faded (the source
    itself starts abruptly); one with a lead-in is faded over the lead-in."""
    start = onset_index(x)
    pre = int(PRE_ROLL_S * SR)
    seg = x[max(0, start - pre):]
    fade_from = 0
    if start < pre:
        seg = np.concatenate([np.zeros(pre - start), seg])
        fade_from = pre - start
    n = int(length_s * SR)
    seg = seg[:n]
    if len(seg) < n:
        raise Refusal(f"take is {len(seg) / SR:.2f} s after the hit, shorter than the {length_s} s clip")
    faded = seg.copy()
    faded[fade_from:] = fade_in(seg[fade_from:], HIT_FADE_IN_S)
    return fade_out(faded, fade_out_s), start / SR


def take_jet(x, series, crest_s, length_s, fade_in_s, fade_out_s):
    """A pass whose loudness peak sits at `crest_s`: the lead-in before
    (peak - crest_s) is cut and a 0.3 s fade-in laid on what is left."""
    peak_s = loudness_peak_s(series)
    lead = peak_s - crest_s
    if lead < 0:
        raise Refusal(f"loudness peak at {peak_s:.2f} s is earlier than crest_s {crest_s} s: cannot align")
    seg = x[int(round(lead * SR)):]
    n = int(length_s * SR)
    if len(seg) < n:
        raise Refusal(f"jet take has {len(seg) / SR:.2f} s after the cut, shorter than the {length_s} s clip")
    return fade_out(fade_in(seg[:n], fade_in_s), fade_out_s), peak_s, lead


def pitch_track(x, lo_hz=700.0, hi_hz=4500.0, n=2048, hop=512):
    """(frame centre s, dominant frequency Hz, band level dB) of the strongest
    partial between lo and hi, parabolic-interpolated, 5-frame median."""
    win = np.hanning(n)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    band = (freqs >= lo_hz) & (freqs <= hi_hz)
    idx = np.nonzero(band)[0]
    t, f, lv = [], [], []
    for i in range(0, len(x) - n, hop):
        mag = np.abs(np.fft.rfft(x[i:i + n] * win))
        k = idx[int(np.argmax(mag[idx]))]
        a, b, c = np.log(mag[k - 1] + 1e-12), np.log(mag[k] + 1e-12), np.log(mag[k + 1] + 1e-12)
        shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
        t.append((i + n / 2) / SR)
        f.append((k + shift) * SR / n)
        lv.append(db(float(np.sqrt((mag[idx] ** 2).sum())) + 1e-12))
    f = np.array(f)
    med = np.array([np.median(f[max(0, j - 2):j + 3]) for j in range(len(f))])
    return np.array(t), med, np.array(lv)


WHISTLE_BELOW_DB = 20.0           # the whistle is the stretch within this of its loudest band level


def whistle_span(x):
    """(start s, end s, report) of a descending whistle: from the first to the
    last frame whose band level is within WHISTLE_BELOW_DB of the loudest. The
    descent ends where the tone does (the pitch track is reported, not gated:
    its slope is too noisy to cut on -- measured at 0.2 to 0.4 octave per second
    along the whole of take 4 -- while its level is not). A whistle still
    sounding at the file's end ends at the file's end."""
    t, f, lv = pitch_track(x)
    live = np.nonzero(lv >= lv.max() - WHISTLE_BELOW_DB)[0]
    start = float(t[live[0]])
    end = min(float(t[live[-1]]) + 0.05, len(x) / SR)
    return start, end, {"f_start": float(f[live[0]]), "f_end": float(f[live[-1]])}


def take_whistle(x):
    start, end, rep = whistle_span(x)
    seg = x[int(start * SR):int(end * SR)]
    return fade_out(fade_in(seg, WHISTLE_FADE_IN_S), WHISTLE_FADE_OUT_S), start, end, rep


# --- levels -------------------------------------------------------------------
def gain_db(g):
    return 20 * math.log10(g)


def encoded_true_peak(x):
    """The worst true peak (dBTP) of `x` after BOTH encodings, decoded the way a
    player decodes them. The AAC encoder overshoots a sharp transient by up to
    several dB (a limited crack measured +3.4 dB), so the ceiling is judged on
    the files that ship, not on the PCM."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        base = os.path.join(d, "probe")
        gen_audio.encode(x, base, SUPPORT_CODECS)
        return max(ebur(decode_file(base + ext))["TP"] for ext in (".ogg", ".m4a"))


def fit_set(name, takes, target, approved_gain, notes):
    """Choose a set's gain and each take's file level.

    A take's CREST is its worst encoded true peak minus its momentary max (both
    encodings; `encoded_true_peak`). The loudest file level it can have under
    TP_CEILING is `allow = TP_CEILING - TP_MARGIN - crest`. The file level that
    hits `target` at gain g is `target - gain_db(g) - master_db`.
      * When every take can reach it at the approved gain, they all do: one
        momentary max for the set, the approved gain kept.
      * Otherwise the set gain is RAISED (rounded up to 0.01) until the peakiest
        take reaches it, the brief's rule. All takes sit at the same level.
      * When that needs a gain over MAX_GAIN, the gain is MAX_GAIN and a take
        that still cannot reach the target is set to its own `allow`: quieter
        than the set by a reported number of dB, not limited and not dropped.
    Returns (gain, {take: file M})."""
    min_allow = min(TP_CEILING - TP_MARGIN - t["crest"] for t in takes)
    want = target - gain_db(approved_gain) - MASTER_DB
    if want <= min_allow + 1e-9:
        return approved_gain, {id(t): want for t in takes}
    peaky = max(takes, key=lambda t: t["crest"])
    need = 10 ** ((target - min_allow - MASTER_DB) / 20)
    gain = math.ceil(need * 100 - 1e-9) / 100
    if gain <= MAX_GAIN + 1e-9:
        file_m = target - gain_db(gain) - MASTER_DB
        notes.append(f"{name}: heard {target} needs a file momentary max of {want:.2f} LUFS at gain {approved_gain}, over the "
                     f"{min_allow:.2f} that take {peaky['take']} (crest {peaky['crest']:.1f} dB) allows under {TP_CEILING} dBTP: "
                     f"SET GAIN RAISED {approved_gain} -> {gain}, every file at {file_m:.2f} LUFS")
        return gain, {id(t): file_m for t in takes}
    gain = MAX_GAIN
    file_m = target - gain_db(gain) - MASTER_DB
    levels = {}
    for t in takes:
        allow = TP_CEILING - TP_MARGIN - t["crest"]
        levels[id(t)] = min(file_m, allow)
        if allow < file_m - 1e-9:
            notes.append(f"{name}: take {t['take']} (crest {t['crest']:.1f} dB, encoded true peak {t['TPe']:+.1f} dBTP at M {t['M']:+.1f}) cannot reach "
                         f"heard {target} under {TP_CEILING} dBTP even at the gain ceiling {MAX_GAIN}: file at {allow:.2f} instead of "
                         f"{file_m:.2f} LUFS, heard {target - (file_m - allow):.2f} ({file_m - allow:.2f} dB under the set)")
    notes.append(f"{name}: heard {target} needs gain {need:.2f} for take {peaky['take']} (crest {peaky['crest']:.1f} dB), over {MAX_GAIN}: "
                 f"SET GAIN RAISED {approved_gain} -> {MAX_GAIN} (the ceiling)")
    return gain, levels


# --- the rotor loop -----------------------------------------------------------
def envelope_db(x, block):
    n = len(x) // block
    r = np.sqrt((x[:n * block].reshape(n, block) ** 2).mean(axis=1))
    return 20 * np.log10(r + 1e-9)


def steadiest_window(x, window_s, hop_s=0.25, block_s=0.05):
    """Start (s) of the window of `window_s` whose 50 ms RMS (dB) varies least."""
    block = int(block_s * SR)
    env = envelope_db(x, block)
    w = int(window_s / block_s)
    best, best_std = 0, float("inf")
    for i in range(0, len(env) - w, int(round(hop_s / block_s))):
        s = float(np.std(env[i:i + w]))
        if s < best_std:
            best, best_std = i, s
    return best * block / SR, best_std


def blade_period(x, lo_s=0.015, hi_s=0.5):
    """The blade period (s): the first strong peak of the autocorrelation of the
    amplitude envelope (4 ms smoothed, 10x decimated)."""
    k = int(0.004 * SR)
    env = np.convolve(np.abs(x), np.ones(k) / k, mode="same")[::10]
    env = env - env.mean()
    n = 1 << (2 * len(env) - 1).bit_length()
    f = np.fft.rfft(env, n)
    ac = np.fft.irfft(f * np.conj(f))[:len(env)]
    ac /= ac[0]
    rate = SR / 10
    lo, hi = int(lo_s * rate), int(hi_s * rate)
    seg = ac[lo:hi]
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] > seg[i - 1] and seg[i] >= seg[i + 1] and seg[i] > 0]
    if not peaks:
        raise Refusal("no blade period in the envelope's autocorrelation")
    strongest = max(seg[i] for i in peaks)
    first = next(i for i in peaks if seg[i] >= 0.7 * strongest)
    return (lo + first) / rate, float(seg[first])


def seam_stats(loop):
    """The loop's seam against its own statistics: (step ratio, rms ratio dB, rms bound dB, step p99).
    step ratio = |last->first step| / p99 of the loop's sample-to-sample steps;
    the 10 ms RMS either side of the wrap changes by `rms ratio dB`, bounded by
    the SEAM_RMS_PCT-th percentile of the dB change between adjacent 10 ms windows."""
    steps = np.abs(np.diff(loop))
    p99 = float(np.percentile(steps, 99))
    seam_step = abs(float(loop[0] - loop[-1]))
    w = int(0.010 * SR)
    seam_db = abs(db(float(np.sqrt((loop[-w:] ** 2).mean()))) - db(float(np.sqrt((loop[:w] ** 2).mean()))))
    n = len(loop) // w
    r = np.sqrt((loop[:n * w].reshape(n, w) ** 2).mean(axis=1))
    own = np.abs(np.diff(20 * np.log10(r + 1e-9)))
    return seam_step / p99, seam_db, float(np.percentile(own, SEAM_RMS_PCT)), p99


def check_seam(loop):
    """Raise Refusal when the seam is a click: a step bigger than the loop's own
    99th-percentile step, or a 10 ms RMS jump bigger than its own ordinary one."""
    step_ratio, seam_db, bound_db, _ = seam_stats(loop)
    if step_ratio > SEAM_STEP_RATIO_MAX:
        raise Refusal(f"loop seam is a click: the last->first step is {step_ratio:.2f}x the loop's own 99th-percentile step (limit {SEAM_STEP_RATIO_MAX}x)")
    if seam_db > bound_db:
        raise Refusal(f"loop seam steps {seam_db:.2f} dB over 10 ms, past the loop's own {SEAM_RMS_PCT}th-percentile {bound_db:.2f} dB")
    return step_ratio, seam_db, bound_db


MATCH_LOWPASS_HZ = 600.0


def lowpass(x, hz, taps=511):
    """A linear-phase windowed-sinc low-pass (no phase shift: the match is by position)."""
    n = np.arange(taps) - taps // 2
    h = np.sinc(2 * hz / SR * n) * np.hamming(taps)
    return np.convolve(x, h / h.sum(), mode="same")


def whole_periods(n_samples, period_s, tol=0.1):
    """Is `n_samples` a whole number of blade periods, to `tol` of one?"""
    periods = n_samples / (period_s * SR)
    return abs(periods - round(periods)) <= tol


def cut_loop(x, spec=ROTOR):
    """One seamless rotor loop from the steadiest stretch of `x` (mono, SR).
    Returns (loop samples, report)."""
    start_s, std_db = steadiest_window(x, spec["window_s"])
    a = int(start_s * SR)
    b = a + int(spec["window_s"] * SR)
    region = x[a:b]
    period, period_corr = blade_period(region)
    # Positive-going zero crossings: x[i-1] <= 0 < x[i].
    zc = np.zeros(len(x), dtype=bool)
    zc[1:] = (x[:-1] <= 0) & (x[1:] > 0)
    # The blade's thump is the periodic part and the noise round it is not, so the
    # waveform match is judged on the low band (the loop's own seam check, below,
    # judges the full band).
    low = lowpass(x, MATCH_LOWPASS_HZ)
    w = 4096
    lo_n = int(round(spec["loop_s_range"][0] * SR / 1024))
    hi_n = int(round(spec["loop_s_range"][1] * SR / 1024))
    best = None
    for frames in range(lo_n, hi_n + 1):
        n = frames * 1024
        if not whole_periods(n, period):
            continue
        for s in np.nonzero(zc[a + w:b - n - w])[0] + a + w:
            if not zc[s + n]:
                continue
            u = low[s - w:s + w]
            v = low[s + n - w:s + n + w]
            nmse = float(((u - v) ** 2).sum() / ((u ** 2).sum() + (v ** 2).sum() + 1e-12))
            if best is None or nmse < best[0]:
                best = (nmse, int(s), n)
    if best is None:
        raise Refusal("no zero-crossing pair a whole number of frames and blade periods apart")
    nmse, s, n = best
    # Equal-power crossfade: the last L samples blend into the L samples BEFORE
    # the cut, so the loop's end runs straight into x[s].
    xf = spec["xfade"]
    loop = x[s:s + n].copy()
    th = 0.5 * np.pi * (np.arange(xf) + 0.5) / xf
    loop[n - xf:] = loop[n - xf:] * np.cos(th) + x[s - xf:s] * np.sin(th)
    step_ratio, seam_db, bound_db = check_seam(loop)
    return loop, {
        "source_window_s": (start_s, start_s + spec["window_s"]), "window_std_db": std_db,
        "period_s": period, "period_corr": period_corr, "start_s": s / SR, "frames": n // 1024, "samples": n,
        "loop_s": n / SR, "periods": n / (period * SR), "nmse": nmse, "xfade_samples": xf,
        "seam_step_ratio": step_ratio, "seam_rms_db": seam_db, "seam_rms_bound_db": bound_db,
    }


def rotor_heard(integrated, gain=ROTOR["gain"]):
    """The loop as heard at the camera with the Peten on station."""
    atten = (1 - ROTOR["station_tiles"] / ROTOR["radius"]) ** 2
    return integrated + gain_db(gain) + MASTER_DB + gain_db(atten)


# --- the run ------------------------------------------------------------------
def prep(by_role, log, notes):
    """All the PCM: {set: {"takes": [...kept], "gain": g}} plus the rotor loop."""
    out = {}
    for name, spec in SETS.items():
        takes, dropped = [], []
        for src in by_role.get(name, []):
            raw, rate = read_wav(src["path"])
            clipped = int((np.abs(raw) >= CLIP_LIMIT).sum())
            peak = float(np.abs(raw).max())
            stats = f"take {src['take']}: peak {db(peak):+.1f} dBFS, {clipped} clipped sample(s), DC {raw.mean():+.5f}"
            if clipped:
                dropped.append((src, f"{clipped} clipped sample(s) (|x| >= {CLIP_LIMIT}); not a clean take"))
                log(f"  {stats} -> DROPPED")
                continue
            m = to_mono_44k(raw, rate)
            info = {"src": src, "take": src["take"]}
            if name == "jet_flyby":
                series = ebur(m)["series"]
                x, peak_s, lead = take_jet(m, series, spec["crest_s"], spec["length_s"], spec["fade_in_s"], spec["fade_out_s"])
                info.update(peak_s=peak_s, lead_s=lead)
                log(f"  {stats}; loudness peak at {peak_s:.2f} s, lead-in cut {lead:.2f} s")
            elif name == "incoming_whistle":
                x, st, en, rep = take_whistle(m)
                info.update(start_s=st, end_s=en, **rep)
                log(f"  {stats}; whistle {st:.2f}..{en:.2f} s ({en - st:.2f} s), {rep['f_start']:.0f} -> {rep['f_end']:.0f} Hz")
            else:
                x, onset = take_hit(m, spec["length_s"], spec["fade_out_s"])
                info.update(onset_s=onset)
                log(f"  {stats}; hit at {onset:.3f} s, kept {spec['length_s']} s")
            e = ebur(x)
            probe = x * 10 ** ((-6.0 - db(float(np.abs(x).max()))) / 20)       # the peak at -6 dBFS: a level a codec treats as it will
            e = ebur(probe)
            tpe = encoded_true_peak(probe)
            info.update(x=probe, M=e["M"], I=e["I"], TP=e["TP"], TPe=tpe, crest=tpe - e["M"])
            takes.append(info)
        gain, levels = fit_set(name, takes, spec["target"], spec["gain"], notes)
        for t in takes:
            t["M0"] = t["M"]
            t["x"] = t["x"] * 10 ** ((levels[id(t)] - t["M"]) / 20)
            t["file_m"] = levels[id(t)]
            e = ebur(t["x"])
            t.update(M=e["M"], I=e["I"], TP=e["TP"])
        out[name] = {"takes": takes, "gain": gain, "dropped": dropped}
    # The rotor loop: the first clean helicopter take, steadiest stretch.
    rotor = None
    for src in by_role.get("rotor_loop", []):
        raw, rate = read_wav(src["path"])
        clipped = int((np.abs(raw) >= CLIP_LIMIT).sum())
        if clipped:
            log(f"  rotor take {src['take']}: {clipped} clipped sample(s) -> DROPPED (not a clean take)")
            out.setdefault("_rotor_dropped", []).append((src, f"{clipped} clipped sample(s); not a clean take"))
            continue
        if rotor is not None:
            continue
        loop, rep = cut_loop(to_mono_44k(raw, rate))
        e = ebur(loop)
        want_i = ROTOR["target"] - gain_db(ROTOR["gain"]) - MASTER_DB - gain_db((1 - ROTOR["station_tiles"] / ROTOR["radius"]) ** 2)
        loop = loop * 10 ** ((want_i - e["I"]) / 20)
        e = ebur(loop)
        rep.update(take=src["take"], I=e["I"], TP=e["TP"])
        rotor = {"x": loop, "report": rep, "src": src}
        log(f"  rotor take {src['take']}: loop {rep['loop_s']:.3f} s from {rep['start_s']:.2f} s "
            f"({rep['periods']:.2f} blade periods of {rep['period_s'] * 1000:.1f} ms)")
    if rotor is None:
        raise Refusal("no clean helicopter take for the rotor loop")
    out["rotor"] = rotor
    return out


def write_sets(out):
    """Encode every kept take; return the manifest entries and the files written."""
    entries, written = {}, []
    for name, spec in SETS.items():
        d = os.path.join(AUDIO_DIR, name)
        os.makedirs(d, exist_ok=True)
        for fn in os.listdir(d):                       # a re-run with fewer takes leaves no stale file
            if re.fullmatch(rf"{name}_\d\d\.(ogg|m4a)", fn):
                os.remove(os.path.join(d, fn))
        variants = []
        for i, t in enumerate(out[name]["takes"]):
            base = os.path.join(d, f"{name}_{i + 1:02d}")
            gen_audio.encode(t["x"], base, SUPPORT_CODECS)
            for _ in range(4):               # the shipped files, not the PCM, answer to the ceiling
                tpe = max(ebur(decode_file(base + ext))["TP"] for ext in (".ogg", ".m4a"))
                if tpe <= TP_CEILING + 1e-9:
                    break
                t["x"] = t["x"] * 10 ** (-(tpe - TP_CEILING + 0.05) / 20)
                gen_audio.encode(t["x"], base, SUPPORT_CODECS)
            t["base"] = base
            variants.append({
                "file": os.path.relpath(base + ".ogg", AUDIO_DIR), "alt": os.path.relpath(base + ".m4a", AUDIO_DIR),
                "license": LICENSE, "credit": CREDIT, "source": PROVENANCE + UNCONFIRMED,
            })
            written += [base + ".ogg", base + ".m4a"]
        entry = {"event": spec["event"], "profiles": spec["profiles"], "gain": out[name]["gain"]}
        if spec["radius"] is not None:
            entry["radius_tiles"] = spec["radius"]
        if "crest_s" in spec:
            entry["crest_s"] = spec["crest_s"]
        entry["pitch_jitter"] = spec["jitter"]
        entry["variants"] = variants
        entries[name] = entry
    d = os.path.join(AUDIO_DIR, "support")
    os.makedirs(d, exist_ok=True)
    base = os.path.join(d, "rotor_loop")
    gen_audio.encode(out["rotor"]["x"], base, SUPPORT_CODECS)
    written += [base + ".ogg", base + ".m4a"]
    rotor = {
        "file": ROTOR["file"], "alt": ROTOR["alt"], "loop_s": round(len(out["rotor"]["x"]) / SR, 6), "channels": 1,
        "gain": ROTOR["gain"], "radius_tiles": ROTOR["radius"],
        "license": LICENSE, "credit": CREDIT, "source": PROVENANCE + UNCONFIRMED,
    }
    return entries, rotor, written


def write_manifest(entries, rotor):
    with open(MANIFEST) as fh:
        man = json.load(fh)
    new = {}
    for key, value in man.items():
        if key == "support_air":
            continue                                   # rewritten below, in its place after `engines`
        new[key] = value
        if key == "engines":                           # the support_air block sits beside the engines
            new["support_air"] = {
                "$comment": "GH-782: the Peten over a mortar barrage plays this loop while it is over the map (a support plan, not a "
                            "unit, so it is not an engine voice). Heard at -30 LUFS or under at its station; "
                            "tools/prepare_support_audio.py writes it.",
                "rotor": rotor,
            }
    if "support_air" not in new:
        new["support_air"] = {"rotor": rotor}
    sets = new["sets"]
    for name, entry in entries.items():
        sets[name] = entry
    with open(MANIFEST, "w") as fh:
        json.dump(new, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def measure_shipped(out, log):
    """Decode every shipped file and report (and check) its levels and peak."""
    log("\nSHIPPED FILES (decoded, both encodings):")
    problems = []
    for name in SETS:
        gain = out[name]["gain"]
        for t in out[name]["takes"]:
            row = []
            for ext in (".ogg", ".m4a"):
                e = ebur(decode_file(t["base"] + ext))
                heard = e["M"] + gain_db(gain) + MASTER_DB
                row.append(f"{ext[1:]}: M {e['M']:+.2f} I {e['I']:+.2f} TP {e['TP']:+.2f} heard M {heard:+.2f}")
                if e["TP"] > TP_CEILING + 1e-9:
                    problems.append(f"{os.path.relpath(t['base'] + ext, ROOT)}: true peak {e['TP']:+.2f} dBTP over {TP_CEILING}")
            log(f"  {os.path.basename(t['base'])}: " + " | ".join(row))
    base = os.path.join(AUDIO_DIR, "support", "rotor_loop")
    for ext in (".ogg", ".m4a"):
        e = ebur(decode_file(base + ext))
        log(f"  rotor_loop{ext}: I {e['I']:+.2f} TP {e['TP']:+.2f} heard at the camera on station {rotor_heard(e['I']):+.2f}")
        if e["TP"] > -6.0:
            problems.append(f"rotor_loop{ext}: true peak {e['TP']:+.2f} dBTP over the -6 bed ceiling")
    return problems


def run(src_dir, log=print):
    for tool in ("ffmpeg", "ffprobe"):
        if subprocess.run(["which", tool], capture_output=True).returncode != 0:
            raise Refusal(f"{tool} is not on PATH")
    notes = []
    by_role = load_sources(src_dir)
    log(f"inputs: {sum(len(v) for v in by_role.values())} files, every sha256 matches tools/support_audio_sources.json\n")
    log("TAKES:")
    out = prep(by_role, log, notes)
    log("\nSETS:")
    for name, spec in SETS.items():
        o = out[name]
        for src, why in o["dropped"]:
            log(f"  {name}: take {src['take']} DROPPED -- {why}")
        kept = ", ".join(f"{t['take']}" for t in o["takes"])
        log(f"  {name}: takes kept [{kept}], gain {o['gain']}, target heard {spec['target']}")
        for t in o["takes"]:
            log(f"    take {t['take']}: file M {t['file_m']:+.2f} (heard {t['file_m'] + gain_db(o['gain']) + MASTER_DB:+.2f}), "
                f"I {t['I']:+.2f}, PCM TP {t['TP']:+.2f}, encoded TP {t['TPe'] + (t['file_m'] - t['M0']):+.2f}, crest {t['crest']:.1f} dB")
    for n in notes:
        log(f"  NOTE {n}")
    if "_rotor_dropped" in out:
        for src, why in out["_rotor_dropped"]:
            log(f"  rotor_loop: take {src['take']} DROPPED -- {why}")
    r = out["rotor"]["report"]
    log(f"\nROTOR LOOP: take {r['take']}, steadiest stretch {r['source_window_s'][0]:.2f}..{r['source_window_s'][1]:.2f} s "
        f"(50 ms RMS std {r['window_std_db']:.2f} dB); blade period {r['period_s'] * 1000:.2f} ms (autocorrelation {r['period_corr']:.2f}); "
        f"cut at {r['start_s']:.3f} s, {r['frames']} frames = {r['samples']} samples = {r['loop_s']:.4f} s = {r['periods']:.2f} blade periods; "
        f"waveform match NMSE {r['nmse']:.4f}; crossfade {r['xfade_samples']} samples")
    log(f"  seam: step {r['seam_step_ratio']:.3f}x the loop's p99 step; 10 ms RMS change {r['seam_rms_db']:.2f} dB "
        f"(own 95th percentile {r['seam_rms_bound_db']:.2f}); integrated {r['I']:+.2f} LUFS, true peak {r['TP']:+.2f} dBTP, "
        f"heard on station {rotor_heard(r['I']):+.2f} LUFS")
    if "jet_flyby" in out:
        log("\nJET: crest_s " + str(SETS["jet_flyby"]["crest_s"]) + " s; measured loudness peaks (source time, s): "
            + ", ".join(f"take {t['take']} {t['peak_s']:.2f}" for t in out["jet_flyby"]["takes"]))
    entries, rotor, written = write_sets(out)
    write_manifest(entries, rotor)
    problems = measure_shipped(out, log)
    # The jet's shipped crest: where the loudest window of each shipped file sits.
    for t in out["jet_flyby"]["takes"]:
        p = loudness_peak_s(ebur(decode_file(t["base"] + ".ogg"))["series"])
        log(f"  {os.path.basename(t['base'])}: shipped loudness peak at {p:.2f} s (crest_s {SETS['jet_flyby']['crest_s']})")
    log(f"\nwrote {len(written)} files and updated data/audio.json")
    if problems:
        raise Refusal("\n  ".join(["shipped files over their ceiling:"] + problems))
    return 0


USAGE = """usage: python3 tools/prepare_support_audio.py --src=<dir> [-h | --help]

Prepares the fire-support sounds (GH-782) from the lead's ElevenLabs WAVs in
<dir> (hash-checked against tools/support_audio_sources.json) into
assets/audio/ and data/audio.json.
"""


def main(argv):
    if any(a in ("-h", "--help") for a in argv):
        print(USAGE, end="")
        return 0
    src = None
    for a in argv:
        if a.startswith("--src="):
            src = a[len("--src="):]
        else:
            print(f"unknown argument: {a}\n\n{USAGE}", end="", file=sys.stderr)
            return 2
    if not src:
        print(USAGE, end="", file=sys.stderr)
        return 2
    try:
        return run(os.path.expanduser(src))
    except Refusal as e:
        print(f"\nREFUSED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
