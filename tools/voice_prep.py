#!/usr/bin/env python3
"""Trim, normalise and encode one voice sample (WP-AU1 N9, N10, N14).

    python3 tools/voice_prep.py SRC.mp3 he/infantry/move_01a [--to SECONDS]

--to cuts the source there first, for a sample whose tail carries a click that
the silence trim reads as speech (inshouts3 has one at 3.37 s).

writes assets/audio/voice/he/infantry/move_01a.{ogg,m4a}: mono 44.1 kHz,
leading/trailing silence trimmed to a 20 ms margin, two-pass loudnorm to
-18 LUFS integrated with a -3 dBTP ceiling, OGG q4 plus M4A 64 kb/s. Prints the
measured result of the ENCODED ogg so the numbers are the shipped ones.
"""
import json, os, re, subprocess, sys

FFMPEG = os.environ.get("FFMPEG", "/opt/homebrew/bin/ffmpeg")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET_I, TARGET_TP = -18.0, -3.0
TRIM = ("silenceremove=start_periods=1:start_silence=0.02:start_threshold=-38dB,"
        "areverse,silenceremove=start_periods=1:start_silence=0.02:start_threshold=-38dB,areverse")


def run(args):
    return subprocess.run([FFMPEG, "-hide_banner", "-nostdin", *args], capture_output=True, text=True)


def measure(src, pre):
    r = run(["-i", src, "-af", f"{pre}loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA=11:print_format=json", "-f", "null", "-"])
    return json.loads(re.search(r"\{[^{}]*\}", r.stderr[r.stderr.rindex("Parsed_loudnorm") :] if "Parsed_loudnorm" in r.stderr else r.stderr, re.S).group(0))


def main(src, stem, to=None):
    global TRIM
    if to is not None:
        TRIM = f"atrim=0:{to}," + TRIM
    out_dir = os.path.join(ROOT, "assets", "audio", "voice", os.path.dirname(stem))
    os.makedirs(out_dir, exist_ok=True)
    m = measure(src, TRIM + ",")
    ln = (f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
          f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    # loudnorm resamples to 192 kHz internally; bring it back before encoding.
    chain = f"{TRIM},{ln},aresample=44100,alimiter=limit=0.63:level=disabled"
    for ext, codec in (("ogg", ["-c:a", "libvorbis", "-q:a", "4"]), ("m4a", ["-c:a", "aac", "-b:a", "64k"])):
        dst = os.path.join(ROOT, "assets", "audio", "voice", f"{stem}.{ext}")
        r = run(["-y", "-i", src, "-map_metadata", "-1", "-af", chain, "-ac", "1", "-ar", "44100", *codec, dst])
        if r.returncode:
            sys.exit(r.stderr)
        print(dst, os.path.getsize(dst), "bytes")
    e = run(["-i", os.path.join(ROOT, "assets", "audio", "voice", f"{stem}.ogg"), "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    tail = e[e.rindex("Summary"):]
    print(re.search(r"I:\s+(\S+) LUFS", tail).group(0), "|", re.search(r"Peak:\s+(\S+) dBFS", tail).group(0))
    d = run(["-i", os.path.join(ROOT, "assets", "audio", "voice", f"{stem}.ogg")]).stderr
    print(re.search(r"Duration: (\S+),", d).group(0))


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) not in (2, 4) or (len(a) == 4 and a[2] != "--to"):
        sys.exit(__doc__)
    main(a[0], a[1], a[3] if len(a) == 4 else None)
