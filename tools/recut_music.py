#!/usr/bin/env python3
"""
Roaring Lions -- re-cut the main theme into the mission's two music beds (AU-7).

    python tools/recut_music.py

The lead's ruling (2026-10-09): mission music comes from re-cutting the
existing theme, `assets/audio/music/holding_the_perimeter.mp3`, into a calm
bed and a battle loop that crossfade with the fighting -- no new licence, no
new generation. Both beds inherit the theme's provenance exactly
(docs/ASSET_PROVENANCE.md, item 3: AI-generated, generator unrecorded).
The lead picked these two by ear from the phase-1 listening samples.

  calm   the theme's own sparse intro (drone, ney, a distant radio click),
         bars 2-8 at 92 BPM: 2.658 -> 20.920 s, 7 bars. Bar 1 is a fade-in
         from silence and would dip at every wrap, so it is left out.
  battle the theme's heaviest section, 16 bars: 93.961 -> 135.700 s. It ends
         on its own two-beat fill, so the wrap is the fill landing on the
         section's entrance, as it does in the theme.

The bar lines are the measured onsets of the section entrances (spectral flux
peaks at 20.920, 93.961, 114.831 and 135.700 s); 93.961 -> 135.700 is 41.739 s,
16 bars at exactly 92.00 BPM. Each loop's last 40 ms is crossfaded into the
40 ms of the theme that precede the loop's first sample, so the wrap is the
theme's own continuity rather than a cut. The loop is then resampled
(circularly, by FFT -- a loop IS periodic) to the nearest whole number of
1024-sample AAC frames: an AAC file is padded out to a frame boundary and
ffmpeg's m4a carries no end trim, so any other length decodes 10 ms long and
loops with a gap (`pnpm validate:audio` decodes both encodings to check). The
stretch is under 0.03% -- under one cent of pitch, and 10 ms over a loop. Loudness is set by linear gain only
(no limiter): battle -15.0 LUFS integrated, calm 2 LU under it at -17.0
(audio plan section 6.1: tension -26, calm -28 LUFS as heard at battle_gain
0.26). Encoded as OGG Vorbis (an <audio loop> over MP3 gaps at the wrap) and
an m4a for Safari. Prints the `music.beds` entries for data/audio.json.

Needs numpy, scipy and ffmpeg on PATH.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np
from scipy.signal import resample

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME = os.path.join(ROOT, "assets", "audio", "music", "holding_the_perimeter.mp3")
OUT = os.path.join(ROOT, "assets", "audio", "music")
SR = 44100
SEAM_S = 0.040
AAC_FRAME = 1024
# name -> (start s, end s, integrated LUFS)
BEDS = {
    "calm": (2.658, 20.920, -17.0),
    "battle": (93.961, 135.700, -15.0),
}
CODECS = {".ogg": ["-c:a", "libvorbis", "-q:a", "5"], ".m4a": ["-c:a", "aac", "-b:a", "160k"]}


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "2", "-ar", str(SR), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<i2").reshape(-1, 2).astype(np.float64) / 32768.0


def write_wav(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).round().astype("<i2").tobytes())


def ebur128(path):
    err = subprocess.run(
        ["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    ).stderr
    s = err[err.rfind("Summary"):]
    return float(re.search(r"I:\s+(-?[\d.]+)", s).group(1)), float(re.search(r"Peak:\s+(-?[\d.]+)", s).group(1))


def cut_loop(x, a, b):
    i0, i1, n = round(a * SR), round(b * SR), round(SEAM_S * SR)
    loop = x[i0:i1].copy()
    ramp = np.linspace(0, np.pi / 2, n)[:, None]
    loop[-n:] = loop[-n:] * np.cos(ramp) + x[i0 - n:i0] * np.sin(ramp)
    frames = max(1, round(len(loop) / AAC_FRAME))
    return resample(loop, frames * AAC_FRAME, axis=0)


def main():
    theme = decode(THEME)
    entries = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name, (a, b, lufs) in BEDS.items():
            loop = cut_loop(theme, a, b)
            wav = os.path.join(tmp, f"{name}.wav")
            write_wav(wav, loop)
            measured, _ = ebur128(wav)
            write_wav(wav, loop * 10 ** ((lufs - measured) / 20))
            got, tp = ebur128(wav)
            base = os.path.join(OUT, f"holding_the_perimeter_{name}")
            for ext, args in CODECS.items():
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, *args, base + ext], check=True)
            print(f"{name}: {len(loop) / SR:.6f} s, {got:.1f} LUFS, true peak {tp:+.1f} dBTP", file=sys.stderr)
            entries[name] = {
                "file": f"music/holding_the_perimeter_{name}.ogg",
                "alt": f"music/holding_the_perimeter_{name}.m4a",
                "loop_s": round(len(loop) / SR, 6),
                "channels": 2,
            }
    print(json.dumps(entries, indent=2))


if __name__ == "__main__":
    main()
