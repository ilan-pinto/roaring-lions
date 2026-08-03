#!/usr/bin/env python3
"""
Roaring Lions -- procedural battle SFX generator.

    python tools/gen_audio.py

Synthesises the placeholder sound library offline and encodes it to OGG + M4A
(Safari) via ffmpeg. Everything here is generated from noise and envelopes, so
the project owns the output outright -- there is no third-party provenance to
audit, which is exactly the licensing problem that sinks most game audio.

Offline synthesis buys what the realtime WebAudio fallback cannot afford:
layered transient + body + tail, per-variant character, and a convolution-ish
reverb tail so shots sound like they happened in a town rather than in a box.

These are PLACEHOLDERS in the same sense the coloured shapes are placeholders.
Real recordings, when they arrive, replace them file for file -- the manifest
does not change shape. Regenerate any time: the seed is fixed, so output is
stable and diffs stay meaningful.
"""

import json
import os
import subprocess
import sys

import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "audio")
MANIFEST = os.path.join(ROOT, "data", "audio.json")
RNG = np.random.default_rng(0x110115)  # fixed seed: regeneration is stable


def env(n, attack, decay, power=2.0):
    """Percussive envelope: near-instant attack, exponential decay."""
    a = max(1, int(SR * attack))
    d = max(1, n - a)
    return np.concatenate([
        np.linspace(0.0, 1.0, a) ** 0.5,
        np.linspace(1.0, 0.0, d) ** power,
    ])[:n]


def noise(n, color=0.0):
    """White noise, optionally darkened by a one-pole low-pass."""
    x = RNG.standard_normal(n)
    if color > 0:
        a = np.exp(-1.0 / (SR * color))
        y = np.zeros(n)
        acc = 0.0
        for i in range(n):
            acc = a * acc + (1 - a) * x[i]
            y[i] = acc
        return y / (np.max(np.abs(y)) + 1e-9)
    return x


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = a * acc + (1 - a) * x[i]
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def sine(n, f0, f1=None):
    t = np.arange(n) / SR
    if f1 is None:
        return np.sin(2 * np.pi * f0 * t)
    f = np.linspace(f0, f1, n)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def tail(x, amount=0.25, length=0.35):
    """Cheap room tail: a decaying noise convolution stand-in."""
    n = int(SR * length)
    ir = RNG.standard_normal(n) * np.linspace(1.0, 0.0, n) ** 3
    total = len(x) + n
    wet = np.convolve(x, ir) / (np.sqrt(n) * 2)
    out = np.zeros(total)
    out[: len(x)] += x
    out[: min(total, len(wet))] += wet[:total] * amount
    return out


def norm(x, peak=0.89):
    m = np.max(np.abs(x)) + 1e-9
    return x * (peak / m)


# --- weapon voices ---------------------------------------------------------

def rifle(seed_shift=0.0):
    n = int(SR * 0.14)
    crack = highpass(noise(n), 1800) * env(n, 0.0004, 0.05, 5.0)
    body = lowpass(noise(n), 700 + 120 * seed_shift) * env(n, 0.001, 0.09, 3.0) * 0.7
    thump = sine(n, 140 + 20 * seed_shift, 60) * env(n, 0.001, 0.05, 4.0) * 0.35
    return norm(tail(crack + body + thump, 0.22, 0.28), 0.8)


def hmg(seed_shift=0.0):
    n = int(SR * 0.2)
    crack = highpass(noise(n), 1100) * env(n, 0.0006, 0.07, 4.0)
    body = lowpass(noise(n), 380) * env(n, 0.001, 0.14, 2.5)
    thump = sine(n, 95 + 12 * seed_shift, 45) * env(n, 0.001, 0.1, 3.0) * 0.8
    return norm(tail(crack * 0.8 + body + thump, 0.3, 0.34), 0.85)


def autocannon(seed_shift=0.0):
    n = int(SR * 0.22)
    crack = highpass(noise(n), 900) * env(n, 0.0005, 0.06, 4.0)
    body = lowpass(noise(n), 260) * env(n, 0.002, 0.16, 2.2)
    thump = sine(n, 78 + 10 * seed_shift, 38) * env(n, 0.001, 0.13, 2.6)
    return norm(tail(crack * 0.7 + body + thump, 0.32, 0.4), 0.88)


def tank_gun(seed_shift=0.0):
    n = int(SR * 0.75)
    blast = lowpass(noise(n), 160) * env(n, 0.002, 0.5, 1.7)
    crack = highpass(noise(n), 2200) * env(n, 0.0004, 0.05, 6.0) * 0.55
    boom = sine(n, 62 + 8 * seed_shift, 26) * env(n, 0.003, 0.55, 1.6)
    return norm(tail(blast + crack + boom, 0.45, 0.75), 0.95)


def atgm_launch(seed_shift=0.0):
    n = int(SR * 0.9)
    whoosh = lowpass(noise(n), 900 + 200 * seed_shift) * env(n, 0.02, 0.7, 1.3)
    pop = highpass(noise(int(SR * 0.1)), 1200) * env(int(SR * 0.1), 0.001, 0.06, 4.0)
    x = whoosh
    x[: len(pop)] += pop * 0.9
    return norm(tail(x, 0.25, 0.5), 0.85)


def mortar_thump(seed_shift=0.0):
    n = int(SR * 0.45)
    thump = sine(n, 110 + 12 * seed_shift, 42) * env(n, 0.004, 0.32, 2.0)
    air = lowpass(noise(n), 420) * env(n, 0.002, 0.28, 2.4) * 0.6
    return norm(tail(thump + air, 0.3, 0.45), 0.82)


def impact_pen(seed_shift=0.0):
    n = int(SR * 0.35)
    clang = (sine(n, 2400 + 300 * seed_shift, 900) + sine(n, 1500, 600) * 0.6) * env(n, 0.0004, 0.1, 4.0)
    spall = highpass(noise(n), 2500) * env(n, 0.0005, 0.16, 3.0) * 0.7
    body = lowpass(noise(n), 300) * env(n, 0.002, 0.2, 2.0) * 0.8
    return norm(tail(clang * 0.8 + spall + body, 0.3, 0.4), 0.85)


def impact_bounce(seed_shift=0.0):
    n = int(SR * 0.3)
    ric = sine(n, 3200 + 400 * seed_shift, 700) * env(n, 0.0004, 0.14, 3.0)
    clang = highpass(noise(n), 3000) * env(n, 0.0004, 0.08, 4.0) * 0.8
    return norm(tail(ric * 0.7 + clang, 0.28, 0.35), 0.7)


def near_miss(seed_shift=0.0):
    n = int(SR * 0.25)
    dirt = lowpass(noise(n), 500 + 100 * seed_shift) * env(n, 0.002, 0.2, 2.2)
    snap = highpass(noise(n), 2000) * env(n, 0.0005, 0.05, 5.0) * 0.5
    return norm(tail(dirt + snap, 0.2, 0.3), 0.6)


def aps_intercept(seed_shift=0.0):
    n = int(SR * 0.3)
    zap = sine(n, 2600 + 200 * seed_shift, 260) * env(n, 0.0008, 0.12, 3.0)
    burst = highpass(noise(n), 1600) * env(n, 0.0006, 0.1, 3.5) * 0.9
    return norm(tail(zap * 0.7 + burst, 0.3, 0.35), 0.8)


def destroyed(seed_shift=0.0):
    n = int(SR * 1.5)
    blast = lowpass(noise(n), 130) * env(n, 0.004, 1.1, 1.4)
    boom = sine(n, 52 + 6 * seed_shift, 20) * env(n, 0.006, 1.2, 1.3)
    debris = highpass(noise(n), 1400) * env(n, 0.05, 1.2, 2.2) * 0.35
    return norm(tail(blast + boom + debris, 0.5, 1.0), 0.97)


SETS = {
    "small_arms": (rifle, 4),
    "hmg": (hmg, 3),
    "autocannon": (autocannon, 3),
    "tank_gun": (tank_gun, 3),
    "atgm_launch": (atgm_launch, 2),
    "mortar_thump": (mortar_thump, 2),
    "impact_pen": (impact_pen, 3),
    "impact_bounce": (impact_bounce, 3),
    "near_miss": (near_miss, 3),
    "aps_intercept": (aps_intercept, 2),
    "destroyed": (destroyed, 3),
}


def encode(samples, base):
    """Write a temp WAV, then encode OGG (everyone) and M4A (Safari)."""
    import wave

    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype("<i2")
    wav = f"{base}.wav"
    with wave.open(wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm16.tobytes())
    for ext, args in (
        (".ogg", ["-c:a", "libvorbis", "-q:a", "3"]),
        (".m4a", ["-c:a", "aac", "-b:a", "96k"]),
    ):
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, *args, base + ext],
            check=True,
        )
    os.remove(wav)


def main():
    variants = {}
    for name, (fn, count) in SETS.items():
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        entries = []
        for i in range(count):
            base = os.path.join(d, f"{name}_{i + 1:02d}")
            encode(fn(seed_shift=i * 0.7), base)
            # One variant, two encodings: OGG everywhere, M4A for Safari.
            entries.append({
                "file": os.path.relpath(base + ".ogg", OUT),
                "alt": os.path.relpath(base + ".m4a", OUT),
                "license": "CC0-1.0",
                "source": "generated by tools/gen_audio.py",
            })
            print(f"  {name}_{i + 1:02d}: ogg + m4a")
        variants[name] = entries

    with open(MANIFEST) as fh:
        man = json.load(fh)
    for name, entries in variants.items():
        if name in man.get("sets", {}):
            man["sets"][name]["variants"] = entries
    with open(MANIFEST, "w") as fh:
        json.dump(man, fh, indent=2)
        fh.write("\n")
    print(f"\nwrote {sum(len(v) for v in variants.values())} files and updated data/audio.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
