"""Nature-sound candidates (GH-984 N4 step 1), for the lead's ear.

    python3 docs/polish/audio/nature/nature_candidates.py            # build files + listening page
    python3 docs/polish/audio/nature/nature_candidates.py --check    # rebuild in a temp dir, compare hashes

CANDIDATES ONLY, the route PR 597 and PR 665 took: nothing here is wired into the
game and nothing ships. No change to packages/render/src/audio.ts,
data/audio.json or tools/gen_audio.py. `wiring.md` is the plan for AFTER the
lead has picked.

Why these. The reactive-nature design (GH-984, design section 10) wants four
sounds the picture already implies: gravel under a track or a wheel, a bush or
reed brushed by infantry, water on a wetland `~` cluster, and a wind bed whose
gain can follow the visual gust envelope. This page puts 2-3 of each beside
each other:

  * stones_trickle_a/b  -- 1.6 / 2.0 s, a short trickle under a track;
  * stones_crunch_a/b   -- 1.2 / 1.3 s, the wheel's crunch;
  * rustle_a/b/c        -- 1.0 s each, bush, reed and dry brush as a man passes;
  * water_a/b/c         -- 10.008 s seamless loops (431 x 1024 samples);
  * wind_a/b/c          -- 14.999 s seamless loops (646 x 1024 samples), each also
                           baked once with its gain following the real gust
                           envelope (`wind_*_gust_follow`, 33 s, not a loop).

CC0 by construction: numpy/scipy noise, envelopes and short sine glides, no
sample, no download and no generative model. Every candidate draws from its
OWN fixed-seed generator (`SEEDS`), so a re-run is byte-identical whatever the
order, and `--check` proves it: it rebuilds every candidate in a temp dir and
compares the sha256 of the 16-bit PCM and of the OGG and M4A with
`nature_manifest.json`. Changing one seed turns it red (see the PR).

The GH-483 rule holds: nothing above 200 Hz is a sustained tone. A pebble, a
bubble and a drip are short (a bubble is a 10-50 ms rising glide, never held);
everything held is filtered noise. The whine detector (the engines', imported)
reads every candidate.

Loudness. Every file is normalised to the shipped ambience beds' own
integrated level, -26 LUFS (BS.1770, the engines' meter, imported), with a
true-peak ceiling of -6 dBTP (the beds' own, validate:audio's). The game's gain
sets what is heard; the beds are heard at -34 LUFS. A one-shot at the beds'
integrated level is a level reference for the A/B, not the level it will play
at.

Encoded the way PR 665 encoded the beds: OGG (libvorbis q3) + M4A (AAC 160k),
`-map_metadata -1 -fflags +bitexact`. The WAVs are measured and deleted.
"""
import argparse
import hashlib
import html
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "docs", "polish", "audio", "engines"))
import engine_candidates as ec  # noqa: E402  (the meters, the whine detector, the loop helpers)

SR = ec.SR
OUT_DIR = os.path.join(HERE, "sounds")
MANIFEST = os.path.join(HERE, "nature_manifest.json")

BED_LUFS = -26.0            # the shipped beds' integrated level (open -26.0, town -26.8, ridge -26.0)
TP_MAX = -6.0               # the beds' true-peak ceiling (validate:audio AMB_MAX_TRUE_PEAK_DBTP): the loops
ONE_SHOT_TP_MAX = -1.0      # a one-shot's: gen_audio's 0.89 peak, as PR 665 read its one-shots
LEVEL_TOL = 0.5

WATER_FRAMES = 431          # 431 x 1024 = 441,344 samples = 10.008 s
WIND_FRAMES = 646           # 646 x 1024 = 661,504 samples = 14.999 s
WATER_N = WATER_FRAMES * 1024
WIND_N = WIND_FRAMES * 1024

# The gust the picture shows (packages/render/src/three/terrain/wind.ts): a
# sin^2 bump every 11 s, 2.5 s wide, peaking at 1.4 times the rest sway.
GUST_EVERY_S, GUST_WIDTH_S, GUST_PEAK = 11.0, 2.5, 1.4
GUST_SOUND_PEAK = 1.6       # a STARTING number for the sound's gain at a gust's peak (+4.1 dB)
DEMO_S = 33.0               # three gusts

# One fixed seed per candidate (and per demo). Change one and `--check` goes red.
SEEDS = {
    "stones_trickle_a_scatter": 0x5101,
    "stones_trickle_b_slide": 0x5102,
    "stones_crunch_a_tyre": 0x5111,
    "stones_crunch_b_heavy": 0x5112,
    "rustle_a_bush": 0x5201,
    "rustle_b_reed": 0x5202,
    "rustle_c_dry_brush": 0x5203,
    "water_a_lap": 0x5301,
    "water_b_flow": 0x5302,
    "water_c_marsh_seep": 0x5303,
    "wind_a_flat_bed": 0x5401,
    "wind_b_airy_foliage": 0x5402,
    "wind_c_low_exposed": 0x5403,
}


# --- building blocks (one-shots; not periodic) ---------------------------------------------

def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def band(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def low(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "low", fs=SR, output="sos"), x)


def high(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "high", fs=SR, output="sos"), x)


def poisson_times(r, dur, rate_fn):
    """Event times (s) of a Poisson process whose rate (per second) is rate_fn(t):
    the cumulative rate, inverted at sorted uniform draws. Deterministic given r."""
    tg = np.arange(0, dur, 0.001)
    rate = np.maximum(rate_fn(tg), 0.0)
    cum = np.concatenate([[0.0], np.cumsum(rate) * 0.001])
    n = int(r.poisson(cum[-1]))
    if n == 0:
        return np.zeros(0)
    u = np.sort(r.uniform(0, cum[-1], n))
    return np.interp(u, cum, np.concatenate([tg, [dur]]))


def lg(r, sigma, cap=1.8):
    """A stone's strength: log-normal, capped so one lucky stone cannot own the peak."""
    return float(min(r.lognormal(0, sigma), cap))


def log_uniform(r, lo, hi):
    return float(np.exp(r.uniform(np.log(lo), np.log(hi))))


def pebble(r, fc, dur, q=2.2):
    """One stone on another: noise through a band at fc (q 2.2), a fast attack and a short decay."""
    n = max(8, int(SR * dur))
    t = np.arange(n) / SR
    x = band(r.standard_normal(n), fc * (1 - 0.5 / q), min(fc * (1 + 0.5 / q), 20000.0))
    return x * (1 - np.exp(-t / 0.0002)) * np.exp(-t / (dur / 4))


def tock(f, decay=0.005, dur=0.03):
    """The body of a bigger stone: a damped sine, a few ms. Short on purpose: never a held tone."""
    t = np.arange(int(SR * dur)) / SR
    return np.sin(2 * np.pi * f * t) * (1 - np.exp(-t / 0.0004)) * np.exp(-t / decay)


def drop_in(out, start_s, voice, gain=1.0):
    s = int(start_s * SR)
    n = min(len(voice), len(out) - s)
    if n > 0:
        out[s:s + n] += gain * voice[:n]


def bump(t, dur, rise=0.3):
    """0..1 swell, rising over `rise` of `dur` and falling over the rest: brushing past, a wheel rolling by."""
    u = np.clip(t / dur, 0, 1)
    return np.sin(np.pi * u ** (np.log(0.5) / np.log(rise))) ** 2


def fade_out(x, ms=15):
    n = int(SR * ms / 1000)
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n) ** 2
    return x


def finish_one_shot(x):
    """DC and sub-bass out, a short fade, then the beds' -26 LUFS by the engines' meter."""
    x = high(x - np.mean(x), 22.0)
    x = fade_out(x)
    return x * 10 ** ((BED_LUFS - ec.lufs(x)) / 20)


def finish_loop(x):
    x = ec.hp(x - np.mean(x), 22.0)
    x = x * 10 ** ((BED_LUFS - ec.lufs(x)) / 20)
    return x


# --- stones ---------------------------------------------------------------------------------

def stones_trickle_a():
    """Scatter: a few stones tick down and the rate dies away, then a small second slip. A track settling on loose gravel."""
    r = np.random.default_rng(SEEDS["stones_trickle_a_scatter"])
    dur = 1.6
    out = np.zeros(int(SR * dur))
    times = poisson_times(r, dur, lambda t: 70 * np.exp(-t / 0.45) + 30 * np.exp(-((t - 0.9) / 0.2) ** 2))
    for ts in times:
        drop_in(out, ts, pebble(r, log_uniform(r, 1800, 6500), r.uniform(0.003, 0.010)), lg(r, 0.5))
        if r.random() < 0.15:
            drop_in(out, ts, tock(r.uniform(250, 800)), 0.5 * lg(r, 0.4))
    t = t_axis(dur)
    out += 0.05 * band(r.standard_normal(len(t)), 1500, 6000) * np.exp(-t / 0.5)
    return finish_one_shot(out)


def stones_trickle_b():
    """Slide: finer, denser grains build to a hush and fade, with a handful of bigger stones knocking through it. A bank giving way."""
    r = np.random.default_rng(SEEDS["stones_trickle_b_slide"])
    dur = 2.0
    out = np.zeros(int(SR * dur))
    times = poisson_times(r, dur, lambda t: 420 * np.sin(np.pi * np.clip(t / dur, 0, 1) ** 0.7) ** 2.5)
    for ts in times:
        drop_in(out, ts, pebble(r, log_uniform(r, 2200, 8000), r.uniform(0.002, 0.005)), lg(r, 0.45))
    for ts in np.sort(r.uniform(0.35, 1.7, 5)):
        drop_in(out, ts, pebble(r, log_uniform(r, 900, 2200), 0.012), 3.0 * r.uniform(0.7, 1.2))
        drop_in(out, ts, tock(r.uniform(200, 450)), 0.9)
    return finish_one_shot(out)


def stones_crunch_a():
    """Tyre: dense small grains with a crushing squash about nine times a second. A wheeled vehicle rolling onto gravel and off."""
    r = np.random.default_rng(SEEDS["stones_crunch_a_tyre"])
    dur = 1.2
    out = np.zeros(int(SR * dur))
    times = poisson_times(r, dur, lambda t: 240 * bump(t, dur, 0.35) ** 0.5)
    for ts in times:
        drop_in(out, ts, pebble(r, log_uniform(r, 500, 3500), r.uniform(0.004, 0.012)), lg(r, 0.6))
    t = t_axis(0.03)
    for ts in poisson_times(r, dur, lambda t: 9 * bump(t, dur, 0.35)):
        squash = band(r.standard_normal(len(t)), 200, 1200) * np.exp(-t / 0.012) * (1 - np.exp(-t / 0.0015))
        drop_in(out, ts, squash, 1.2 * r.uniform(0.7, 1.3))
    return finish_one_shot(out)


def stones_crunch_b():
    """Heavy: fewer, bigger stones with a low knock in each and a dull rumble under the lot. A loaded wheeled vehicle on coarse gravel."""
    r = np.random.default_rng(SEEDS["stones_crunch_b_heavy"])
    dur = 1.3
    out = np.zeros(int(SR * dur))
    times = poisson_times(r, dur, lambda t: 55 * bump(t, dur, 0.4))
    for ts in times:
        drop_in(out, ts, pebble(r, log_uniform(r, 250, 1800), r.uniform(0.010, 0.030), q=1.6), lg(r, 0.5))
        drop_in(out, ts, tock(r.uniform(150, 400), decay=0.008), 0.7 * lg(r, 0.4))
    t = t_axis(dur)
    out += 0.25 * low(r.standard_normal(len(t)), 300, 3) * bump(t, dur, 0.4)
    return finish_one_shot(out)


# --- rustle ---------------------------------------------------------------------------------

def _texture(r, n, cut):
    """A positive, unit-mean modulator: |low-passed noise|, the rough on-off of leaves."""
    m = np.abs(low(r.standard_normal(n), cut))
    return m / np.mean(m)


def rustle_a():
    """Bush: leafy hiss torn into a rough 25 Hz flutter, one swell, two or three twig snaps. A rifle squad pushing through scrub."""
    r = np.random.default_rng(SEEDS["rustle_a_bush"])
    dur = 1.0
    t = t_axis(dur)
    out = band(r.standard_normal(len(t)), 1800, 7500) * _texture(r, len(t), 28) ** 1.2 * bump(t, dur, 0.3) ** 0.75
    for ts in np.sort(r.uniform(0.15, 0.7, 3)):
        drop_in(out, ts, pebble(r, log_uniform(r, 3000, 6000), 0.003), 1.4 * r.uniform(0.7, 1.2))
    return finish_one_shot(out)


def rustle_b():
    """Reed: a softer, higher swish in two lobes over a faint stalk friction. A man wading through tall reed."""
    r = np.random.default_rng(SEEDS["rustle_b_reed"])
    dur = 1.0
    t = t_axis(dur)
    lobes = bump(t, 0.5, 0.35) + 0.8 * np.concatenate([np.zeros(int(0.4 * SR)), bump(t[:len(t) - int(0.4 * SR)], 0.55, 0.45)])
    carrier = band(r.standard_normal(len(t)), 3000, 10000) + 0.5 * band(r.standard_normal(len(t)), 600, 1800)
    flutter = np.maximum(0.6 + 0.4 * low(r.standard_normal(len(t)), 45) / 0.25, 0.0)
    return finish_one_shot(carrier * flutter * lobes)


def rustle_c():
    """Dry brush: a crackle of tiny clicks, 160 a second at the peak, over a thin hiss. Dead scrub that snaps."""
    r = np.random.default_rng(SEEDS["rustle_c_dry_brush"])
    dur = 1.0
    t = t_axis(dur)
    swell = bump(t, dur, 0.35)
    out = np.zeros(len(t))
    for ts in poisson_times(r, dur, lambda u: 160 * bump(u, dur, 0.35)):
        drop_in(out, ts, pebble(r, log_uniform(r, 2500, 7000), r.uniform(0.002, 0.006)), lg(r, 0.7))
    out += 0.12 * band(r.standard_normal(len(t)), 3000, 8000) * swell
    return finish_one_shot(out)


# --- loops (periodic, built with the engines' circular helpers at the file's length) --------

def _loop_mode(n):
    """Point the engines' periodic helpers (noise, circ, lp, hp, bp, cycles, place) at this file's length."""
    ec.LOOP_N = n


def _unit(x):
    return x / np.std(x)


def _glide(r, f0, ratio, dur, tail=0.0):
    """A bubble or a drip: a sine gliding up exponentially over `dur` under a Hann (or a decay when tail > 0).
    10-50 ms, so it can never be a held tone."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = f0 * ratio ** (t / dur)
    env = np.hanning(n) if tail == 0 else (1 - np.exp(-t / 0.002)) * np.exp(-t / tail)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env


def _wash(r, dur, lo, hi):
    """One lap of water: band noise swelling and sliding away."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    return band(r.standard_normal(n), lo, hi) * np.sin(np.pi * (t / dur) ** 0.6) ** 2


def water_a():
    """Lap: six soft waves a loop wash in and back over a low sheen, a few small plips. Still water at a reedy edge."""
    _loop_mode(WATER_N)
    r = ec.gen(SEEDS["water_a_lap"])
    base = _unit(ec.lp(ec.noise(r), 600)) * ec.cycles([(5, 0.3), (11, 0.2)])
    out = 0.35 * base
    spacing = WATER_N / 6
    for k in range(6):
        at = k * spacing + r.uniform(-0.12, 0.12) * spacing
        ec.place(out, at, r.uniform(0.8, 1.2) * 0.9 * _wash(r, r.uniform(1.0, 1.6), r.uniform(200, 300), r.uniform(1400, 2000)) / 0.3)
    for at in r.uniform(0, WATER_N, 16):
        f0 = r.uniform(500, 1000)
        ec.place(out, at, 0.5 * r.uniform(0.5, 1.0) * _glide(r, f0, r.uniform(1.8, 2.6), r.uniform(0.02, 0.05)))
    return finish_loop(out)


def water_b():
    """Flow: a continuous rush with a turbulent 2-6 Hz boil, a hiss on top and about a hundred small bubbles. A ditch or a shallow stream."""
    _loop_mode(WATER_N)
    r = ec.gen(SEEDS["water_b_flow"])
    rush = _unit(ec.bp(ec.noise(r), 350, 3200)) * ec.cycles([(23, 0.22), (37, 0.14), (61, 0.10)])
    hiss = _unit(ec.hp(ec.noise(r), 3500)) * ec.cycles([(29, 0.3)])
    out = rush + 0.25 * hiss
    for at in r.uniform(0, WATER_N, 110):
        ec.place(out, at, 0.35 * r.uniform(0.3, 1.0) * _glide(r, r.uniform(700, 2400), r.uniform(1.6, 2.4), r.uniform(0.008, 0.025)))
    return finish_loop(out)


def water_c():
    """Seep: a dark, slow slosh and a drip now and then; the quietest of the three. Black marsh water barely moving."""
    _loop_mode(WATER_N)
    r = ec.gen(SEEDS["water_c_marsh_seep"])
    out = _unit(ec.lp(ec.noise(r), 420, order=3)) * ec.cycles([(3, 0.3), (7, 0.2)])
    for k in range(5):
        at = k * WATER_N / 5 + r.uniform(-0.1, 0.1) * WATER_N / 5
        ec.place(out, at, r.uniform(0.9, 1.3) * _wash(r, r.uniform(1.5, 2.2), 120, 700) / 0.2)
    for at in r.uniform(0, WATER_N, 9):
        ec.place(out, at, 0.8 * r.uniform(0.5, 1.0) * _glide(r, r.uniform(900, 1400), 2.0, 0.03, tail=0.012))
    return finish_loop(out)


def wind_a():
    """Flat bed: a low breath and a thin hiss with almost no swell of its own, so the game's gust gain does all the moving."""
    _loop_mode(WIND_N)
    r = ec.gen(SEEDS["wind_a_flat_bed"])
    out = _unit(ec.lp(ec.noise(r), 420)) + 0.4 * _unit(ec.lp(ec.noise(r), 1300)) + 0.1 * _unit(ec.bp(ec.noise(r), 2500, 6500))
    return finish_loop(out * ec.cycles([(7, 0.04), (13, 0.03)]))


def wind_b():
    """Airy: wind through foliage; a mid-band rush and a leafy 3-8 kHz hiss that flutters at 3-6 Hz. Reads as the grass and trees moving."""
    _loop_mode(WIND_N)
    r = ec.gen(SEEDS["wind_b_airy_foliage"])
    rush = _unit(ec.bp(ec.noise(r), 500, 3000))
    leaf = _unit(ec.bp(ec.noise(r), 3500, 8000)) * ec.cycles([(41, 0.18), (73, 0.12), (97, 0.08)])
    return finish_loop((rush + 0.5 * leaf) * ec.cycles([(5, 0.05)]))


def wind_c():
    """Low and exposed: dark, mostly under 800 Hz, a slow 3-8 cycle breathing at 6%. Open ridge or a bare plain."""
    _loop_mode(WIND_N)
    r = ec.gen(SEEDS["wind_c_low_exposed"])
    out = _unit(ec.lp(ec.noise(r), 260, order=3)) + 0.4 * _unit(ec.lp(ec.noise(r), 800)) + 0.05 * _unit(ec.bp(ec.noise(r), 2000, 5000))
    return finish_loop(out * ec.cycles([(3, 0.06), (8, 0.04)]))


# (family, stem, builder, kind) -- kind: "one" (a one-shot) or "loop"
CANDIDATES = [
    ("stones", "stones_trickle_a_scatter", stones_trickle_a, "one"),
    ("stones", "stones_trickle_b_slide", stones_trickle_b, "one"),
    ("stones", "stones_crunch_a_tyre", stones_crunch_a, "one"),
    ("stones", "stones_crunch_b_heavy", stones_crunch_b, "one"),
    ("rustle", "rustle_a_bush", rustle_a, "one"),
    ("rustle", "rustle_b_reed", rustle_b, "one"),
    ("rustle", "rustle_c_dry_brush", rustle_c, "one"),
    ("water", "water_a_lap", water_a, "loop"),
    ("water", "water_b_flow", water_b, "loop"),
    ("water", "water_c_marsh_seep", water_c, "loop"),
    ("wind", "wind_a_flat_bed", wind_a, "loop"),
    ("wind", "wind_b_airy_foliage", wind_b, "loop"),
    ("wind", "wind_c_low_exposed", wind_c, "loop"),
]
WIND_STEMS = [s for fam, s, _f, _k in CANDIDATES if fam == "wind"]


def gust_gain(t):
    """The picture's gust (wind.ts gustFactor: 1 outside, a sin^2 bump to 1.4 inside), mapped to a
    sound gain: 1 at rest, GUST_SOUND_PEAK at a gust's peak. Pure function of time, as it must be in the game."""
    phase = np.mod(t, GUST_EVERY_S)
    s = np.where(phase < GUST_WIDTH_S, np.sin(np.pi * phase / GUST_WIDTH_S) ** 2, 0.0)
    factor = 1.0 + (GUST_PEAK - 1.0) * s
    return 1.0 + (factor - 1.0) / (GUST_PEAK - 1.0) * (GUST_SOUND_PEAK - 1.0)


def gust_demo(bed):
    """The bed tiled to 33 s with its gain following gust_gain: three gusts, peaks at 1.25, 12.25 and 23.25 s."""
    n = int(DEMO_S * SR)
    x = bed[np.arange(n) % len(bed)]
    return x * gust_gain(np.arange(n) / SR)


# --- measurement ----------------------------------------------------------------------------

def wander_db(x, loop):
    """The bed's own level movement: max - min of the RMS over 1 s windows (hop 0.25 s), dB.
    A bed the game's gain will ride should move little by itself."""
    w, hop = SR, SR // 4
    xs = np.concatenate([x, x[:w]]) if loop else x
    sq = np.concatenate([[0.0], np.cumsum(xs * xs)])
    starts = np.arange(0, len(xs) - w + 1, hop)
    if loop:
        starts = starts[starts < len(x)]
    rms = 10 * np.log10((sq[starts + w] - sq[starts]) / w + 1e-20)
    return float(rms.max() - rms.min())


def one_shot_tp(x):
    up = signal.resample_poly(np.concatenate([np.zeros(64), x, np.zeros(64)]), 4, 1)
    return float(20 * np.log10(np.max(np.abs(up)) + 1e-20))


def quantise(x):
    return np.round(np.clip(x, -1, 1) * 32767).astype("<i2")


def pcm_hash(x):
    return hashlib.sha256(quantise(x).tobytes()).hexdigest()


def file_hash(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def encode(x, stem, directory):
    """The candidate as OGG (q3) and M4A (160k), like PR 665's beds. Returns (ogg, m4a) paths."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, stem + ".wav")
        ec.write_wav(wav, x)
        ogg, m4a = os.path.join(directory, stem + ".ogg"), os.path.join(directory, stem + ".m4a")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-map_metadata", "-1", "-fflags", "+bitexact",
                        "-c:a", "libvorbis", "-q:a", "3", ogg], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-map_metadata", "-1", "-fflags", "+bitexact",
                        "-c:a", "aac", "-b:a", "160k", m4a], check=True)
    return ogg, m4a


def build_all():
    """Every candidate and every wind demo as float arrays, keyed by stem. Pure given the seeds."""
    out = {}
    for _fam, stem, fn, _kind in CANDIDATES:
        out[stem] = fn()
    for stem in WIND_STEMS:
        out[stem.replace("wind_", "wind_demo_", 1) + "_gust_follow"] = gust_demo(out[stem])
    return out


def ffmpeg_version():
    first = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True).stdout.splitlines()[0]
    return " ".join(first.split()[:3])


# --- self-tests specific to this page ---------------------------------------------------------

def selftest():
    res = []
    r = np.random.default_rng(0x7E57)
    n = len(poisson_times(r, 10.0, lambda t: np.full_like(t, 100.0)))
    res.append(("poisson_times: 100/s for 10 s gives about 1000 events", abs(n - 1000) < 100, f"{n} events"))
    res.append(("poisson_times: a zero rate gives none", len(poisson_times(r, 10.0, lambda t: 0 * t)) == 0, "0 events"))
    # A loop whose length is not a whole number of cycles steps at the wrap; one that is does not.
    tt = np.arange(2 * 44100) / SR
    shaped = lambda cyc: 0.5 * np.sin(2 * np.pi * (cyc / 2.0) * tt) + 0.002 * np.random.default_rng(1).standard_normal(len(tt))
    ec.LOOP_N = len(tt)
    torn = ec.seam(shaped(120.25))
    whole = ec.seam(shaped(120.0))
    res.append(("a 120.25-cycle loop clicks at the wrap, a 120-cycle loop does not",
                torn["click"] > 1.0 and whole["click"] < 0.5, f"click {torn['click']:.1f} vs {whole['click']:.2f}"))
    flat = wander_db(np.random.default_rng(2).standard_normal(5 * SR), loop=True)
    swell = wander_db(np.random.default_rng(2).standard_normal(5 * SR) * (1 + 0.8 * np.sin(2 * np.pi * np.arange(5 * SR) / (5 * SR))), loop=True)
    res.append(("wander_db: steady noise < 1 dB, a +-80% swell > 6 dB", flat < 1.0 and swell > 6.0, f"{flat:.2f} / {swell:.1f} dB"))
    g = gust_gain(np.array([0.0, 1.25, 2.5, 5.0, 12.25]))
    res.append(("gust_gain: 1 at 0, 2.5 and 5 s; the peak at 1.25 and 12.25 s",
                np.allclose(g, [1, GUST_SOUND_PEAK, 1, 1, GUST_SOUND_PEAK]), np.array2string(g, precision=2)))
    print("self-tests (this page):")
    for name, ok, note in res:
        print(f"  {'ok  ' if ok else 'FAIL'} {name:62s} {note}")
    assert all(ok for _n, ok, _x in res), "self-test failed"
    return res


# --- --check ----------------------------------------------------------------------------------

def digests(audio, directory):
    """sha256 of the PCM, OGG and M4A of every file, encoding into `directory`."""
    rows = {}
    for stem, x in audio.items():
        ogg, m4a = encode(x, stem, directory)
        rows[stem] = {"pcm_sha256": pcm_hash(x), "ogg_sha256": file_hash(ogg), "m4a_sha256": file_hash(m4a), "samples": len(x)}
    return rows


def compare(fresh, manifest, ffmpeg, on_disk=None):
    """The mismatches between a rebuild and the manifest, as strings. PCM must match always; the encoded files
    must match when ffmpeg is the manifest's version (an encoder is allowed to differ between versions, the PCM is not).
    `on_disk`, when given, is the committed files' hashes and must equal the manifest."""
    bad = []
    if set(fresh) != set(manifest["files"]):
        bad.append(f"file set differs: {sorted(set(fresh) ^ set(manifest['files']))}")
    same_encoder = ffmpeg == manifest["ffmpeg"]
    for stem, row in fresh.items():
        want = manifest["files"].get(stem)
        if want is None:
            continue
        for key in ("pcm_sha256", "samples") + (("ogg_sha256", "m4a_sha256") if same_encoder else ()):
            if row[key] != want[key]:
                bad.append(f"{stem}: {key} {str(row[key])[:12]} != manifest {str(want[key])[:12]}")
        if on_disk is not None:
            for key in ("ogg_sha256", "m4a_sha256"):
                if on_disk.get(stem, {}).get(key) != want[key]:
                    bad.append(f"{stem}: committed file differs from the manifest ({key})")
    return bad


def check():
    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    ffmpeg = ffmpeg_version()
    audio = build_all()
    with tempfile.TemporaryDirectory() as tmp:
        fresh = digests(audio, tmp)
    disk = {stem: {"ogg_sha256": file_hash(os.path.join(OUT_DIR, stem + ".ogg")),
                   "m4a_sha256": file_hash(os.path.join(OUT_DIR, stem + ".m4a"))} for stem in fresh
            if os.path.exists(os.path.join(OUT_DIR, stem + ".ogg")) and os.path.exists(os.path.join(OUT_DIR, stem + ".m4a"))}
    bad = compare(fresh, manifest, ffmpeg, disk if ffmpeg == manifest["ffmpeg"] else None)
    for line in bad:
        print("MISMATCH", line)
    note = "" if ffmpeg == manifest["ffmpeg"] else f" (encoded files not compared: ffmpeg is {ffmpeg}, the manifest's is {manifest['ffmpeg']})"
    print(f"check: {len(fresh)} files rebuilt, {'all hashes equal' if not bad else str(len(bad)) + ' mismatch(es)'}{note}")
    return 1 if bad else 0


# --- run --------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="rebuild into a temp dir and compare with nature_manifest.json")
    args = ap.parse_args()
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} is required (it encodes the files and reads them back)")
    if args.check:
        return check()
    tests = ec.selftest() + selftest()
    os.makedirs(OUT_DIR, exist_ok=True)
    audio = build_all()
    rows = []
    print("\ncandidates (-26 LUFS like the shipped beds):")
    for fam, stem, fn, kind in CANDIDATES:
        x = audio[stem]
        ogg, _m4a = encode(x, stem, OUT_DIR)
        wav_back = quantise(x).astype(float) / 32768
        loop = kind == "loop"
        ec.LOOP_N = len(x)
        lu = ec.lufs(wav_back)
        tp = ec.true_peak(wav_back) if loop else one_shot_tp(wav_back)
        w = ec.whine(wav_back, loop=loop)
        lo = ec.whine(wav_back, loop=loop, band_hz=ec.LOW_BAND_HZ)
        sm = ec.seam(wav_back) if loop else None
        dec = ec.ffmpeg_reading(ogg)
        checks = {"level": abs(lu - BED_LUFS) <= LEVEL_TOL, "peak": tp <= (TP_MAX if loop else ONE_SHOT_TP_MAX), "whine": not w["whine"]}
        if loop:
            checks["seam"] = ec.seam_ok(sm)
            checks["length"] = len(x) % 1024 == 0
        fails = [k for k, ok in checks.items() if not ok]
        verdict = "PASS" if not fails else "FAIL: " + ", ".join(fails)
        ec.spectrogram_png(os.path.join(OUT_DIR, stem + ".png"), wav_back, stem, f"{verdict}; {ec.tone_text(w)}", w)
        row = {"fam": fam, "stem": stem, "doc": fn.__doc__, "kind": kind, "lufs": lu, "tp": tp, "whine": w, "low": lo,
               "seam": sm, "dec": dec, "secs": len(x) / SR, "wander": wander_db(wav_back, loop), "verdict": verdict}
        rows.append(row)
        print(f"  {stem:26s} {lu:6.1f} LUFS TP {tp:5.1f} {len(x) / SR:6.3f} s wander {row['wander']:4.1f} dB  {verdict}; "
              f"{ec.tone_text(w)}" + (f"; seam {sm['corr']:.3f} step {sm['step']:.2f}" if loop else ""))
    demos = []
    for stem in WIND_STEMS:
        d = stem.replace("wind_", "wind_demo_", 1) + "_gust_follow"
        x = audio[d]
        encode(x, d, OUT_DIR)
        demos.append((stem, d, float(20 * np.log10(np.max(np.abs(quantise(x).astype(float) / 32768))))))
        print(f"  {d:36s} sample peak {demos[-1][2]:5.1f} dBFS (gain 1 to {GUST_SOUND_PEAK} on the gust)")
    manifest = {"ffmpeg": ffmpeg_version(), "numpy": np.__version__, "scipy": __import__("scipy").__version__,
                "files": digests(audio, tempfile.mkdtemp())}
    # The committed encodes are the ones just written; hash those, not a second encode of the same bytes.
    for stem in audio:
        manifest["files"][stem]["ogg_sha256"] = file_hash(os.path.join(OUT_DIR, stem + ".ogg"))
        manifest["files"][stem]["m4a_sha256"] = file_hash(os.path.join(OUT_DIR, stem + ".m4a"))
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write("\n")
    write_page(rows, demos, tests)
    failed = [r["stem"] for r in rows if r["verdict"] != "PASS"]
    print(f"\n{len(rows) - len(failed)} of {len(rows)} candidates pass" + (f"; FAIL: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


# --- the listening page ---------------------------------------------------------------------

FAMILIES = [
    ("stones", "Stones and gravel under tracks and wheels",
     "Tracked and wheeled vehicles moving over <code>b</code> boulder fields, <code>^</code> ridge and knoll tiles. "
     "The trickle is the short sound of a track settling; the crunch is the wheel's. One-shots, 1.2 to 2 s."),
    ("rustle", "Bush and reed rustle as infantry pass",
     "A disturber inside a bush or reed tile. One-shots, 1 s, heard once per pass."),
    ("water", "Water on wetland <code>~</code> clusters",
     "Positional loops at the nearest few clusters on a wetland map. Seamless loops of 10.008 s, to be heard through the same "
     "distance and bearing as an engine loop. Let each run round."),
    ("wind", "Wind bed that follows the gust",
     "A 15 s seamless loop meant to sit under the visual gust: the game would ride its gain on the same sin&sup2; bump the "
     "grass and trees follow, so a gust you SEE is a gust you HEAR. So the bed itself should barely move. Each card has the "
     "bare loop and a 33 s preview with the gain following three gusts (gain 1 at rest to "
     f"{GUST_SOUND_PEAK}, about +{20 * np.log10(GUST_SOUND_PEAK):.0f} dB, at a gust's peak, peaks at 1.25, 12.25 and 23.25 s)."),
]


def write_page(rows, demos, tests):
    e = html.escape
    head = ec.PAGE_HEAD.replace("<title>Engine Loop Candidates</title>", "<title>Nature Sound Candidates</title>")
    out = [head]
    out.append("<h1>Nature sound candidates</h1>")
    out.append("<p>GH-984 N4, step 1: four sounds the reactive-nature picture already implies, 2 to 4 of each, for your ear. "
               "<b>Nothing here is wired into the game.</b> After you pick, <code>wiring.md</code> (beside this page) "
               "says how a pick gets in.</p>")
    out.append('<p class="muted">Every file is at the shipped ambience beds\' own loudness, -26 LUFS integrated, so you compare '
               "character and not volume; in the game each would be set by a gain on the sfx or amb bus. Synthesised, CC0, "
               "byte-identical on every run of <code>nature_candidates.py</code> (<code>--check</code> proves it). OGG with an "
               "M4A fallback, as the shipped beds are. Nothing above 200 Hz is a held tone.</p>")
    for fam, title, blurb in FAMILIES:
        out.append(f"<h2>{title}</h2><p>{blurb}</p>")
        for r in [r for r in rows if r["fam"] == fam]:
            cls = "pass" if r["verdict"] == "PASS" else "fail"
            name, _, rest = " ".join(r["doc"].split()).partition(":")
            loop = r["kind"] == "loop"
            src = f'<source src="sounds/{e(r["stem"])}.ogg" type="audio/ogg"><source src="sounds/{e(r["stem"])}.m4a" type="audio/mp4">'
            card = (f'<section class="card" id="{e(r["stem"])}"><div class="family">{e(fam)} &middot; '
                    f'{"loop" if loop else "one-shot"} &middot; {r["secs"]:.3f} s</div>'
                    f"<h3>{e(r['stem'])} &mdash; {e(name)}</h3><p>{e(rest.strip())}</p>"
                    f'<audio controls {"loop " if loop else ""}preload="none">{src}</audio>')
            if fam == "wind":
                d = next(d for s, d, _p in demos if s == r["stem"])
                card += (f'<p class="muted">With the gain following the gust (33 s, not a loop):</p><audio controls preload="none">'
                         f'<source src="sounds/{e(d)}.ogg" type="audio/ogg"><source src="sounds/{e(d)}.m4a" type="audio/mp4"></audio>')
            card += f'<img src="sounds/{e(r["stem"])}.png" alt="Spectrogram of {e(r["stem"])}" loading="lazy">'
            seam = f" &middot; seam {r['seam']['corr']:.3f}, step {r['seam']['step']:.2f} dB" if loop else ""
            dec = f" &middot; ffmpeg reads the OGG at {r['dec'][0]:.1f} LUFS" if r["dec"] else ""
            card += (f'<p class="verdict"><span class="{cls}">{e(r["verdict"])}</span> &middot; {r["lufs"]:.1f} LUFS &middot; '
                     f"true peak {r['tp']:.1f} dBTP{seam}{dec} &middot; {e(ec.tone_text(r['whine']))} &middot; "
                     f"{e(ec.low_text(r['low']))}"
                     + (f" &middot; its own level moves {r['wander']:.1f} dB over 1 s windows" if fam in ("wind", "water") else "")
                     + "</p></section>")
            out.append(card)
    out.append("<h2>How it was made</h2><ul>"
               "<li><b>Stones</b>: a Poisson process of pebbles (a rate profile, inverted from its cumulative sum at sorted "
               "uniform draws), each a short noise burst through one band with a fast attack and a decay a quarter of its "
               "length; bigger stones add a 5 to 8 ms damped sine (a knock, never a held note). The crunch adds a wide "
               "'squash' burst about nine times a second, or a low rumble under it.</li>"
               "<li><b>Rustle</b>: band noise multiplied by the rough on-off of |low-passed noise| (leaves), under one "
               "or two swells; the reed is two lobes of a higher band; the dry brush is a crackle of tiny clicks.</li>"
               "<li><b>Water</b>: whole-cycle swells on band noise (so the loop is periodic), washes placed on the loop's "
               "circle, and short rising sine glides (10 to 50 ms) for bubbles, plips and drips.</li>"
               "<li><b>Wind</b>: low-passed noise with 3 to 7% swell of its own, so a gain from outside does the moving. "
               "The airy bed adds a 3 to 8 kHz hiss fluttering at 3 to 6 Hz.</li>"
               "<li>Filters are the engines' circular ones for loops, so a loop's end is the start of the next.</li></ul>")
    out.append("<h2>How it was checked</h2>")
    out.append("<p>The meters and the whine detector are the engines' own (<code>../engines/engine_candidates.py</code>, imported). "
               "Pass means: integrated loudness within 0.5 LU of -26, true peak at or under -6 dBTP (a loop, the beds' ceiling) or -1 dBTP (a one-shot, gen_audio's 0.89 peak), no whine (a spectral peak "
               "10 dB over its &plusmn;161 Hz neighbourhood, 200 Hz to 8 kHz, held 1 s or longer), and for a loop a seam with "
               "spectral correlation of 0.9 or more, no click and validate:audio's own 250 ms level step and gap. A loop's length "
               "is a whole number of 1024-sample frames. Each check was first shown an input built to fail it:</p><ul>")
    for name, ok, note in tests:
        out.append(f"<li>{e(name)}: {e(note)} {'&check;' if ok else '&cross;'}</li>")
    out.append("</ul></main>\n</body>\n</html>\n")
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out))


if __name__ == "__main__":
    sys.exit(main())
