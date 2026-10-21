"""Combat-sound and ambience-bed candidates (audio candidates 2), for the lead's ear.

    python3 docs/polish/audio/combat/combat_candidates.py

CANDIDATES ONLY, the route #597 took for the engines: nothing here is wired
into the game and nothing ships. No change to packages/render/src/audio.ts,
data/audio.json or tools/gen_audio.py. A chosen candidate moves into
gen_audio.py later, unchanged.

Why these. Audio is the lowest polish category (3 of 5, commercial-polish-audit
§16). Every combat sound the player hears most is still a tools/gen_audio.py
placeholder, and the ambience beds have been off since 9 Oct because a
synthesised bed was "never approved by ear" (#483). This page puts an A and a
B beside the sound that ships today, for:

  * eight one-shot sets, the most-heard combat sounds: small_arms, hmg,
    autocannon, tank_gun, mortar_thump (mortar and rocket launch),
    impact_pen, destroyed, near_miss -- WAV + spectrogram each, in sfx/;
  * the three ambience beds, open / town / ridge -- a 40.008 s seamless loop
    each (the shipped beds' own length, so a pick drops in unchanged),
    encoded OGG (q3) + M4A like the shipped beds, spectrogram each, in beds/.
    The WAVs are measured and then deleted: 21 MB of PCM is not worth the
    repo. Re-running regenerates them byte-identically.

CC0 by construction: numpy/scipy noise, envelopes and sines, no sample and no
generative model. Every candidate draws from its OWN fixed-seed generator, so
a re-run is byte-identical whatever the order.

The rule from #483 holds here too: nothing above 200 Hz is a sustained tone.
A gun's body and a bed's rumble may sit under 200 Hz; above it every layer is
noise, shaped -- a crack, a blast, an echo, wind -- and the metal of an
impact is noise through resonances whose centres move per hit (the engines'
`resonant_hit`), so it can clang but cannot ring a held note.

Measured, using the engines' own meters (imported, not copied, from
docs/polish/audio/engines/engine_candidates.py, whose self-tests run first):
  * one-shots: the maximum momentary loudness (BS.1770 K-weighting, 400 ms),
    normalised to the SHIPPED placeholder's own reading of the same set (so
    data/audio.json's gain means the same thing for a pick, and the A/B is
    character, not level); true peak <= -1 dBTP (gen_audio's 0.89 peak);
    the whine detector, read as a one-shot (not wrapped); the tail, the time
    to fall 60 dB under the peak;
  * beds: integrated loudness normalised to the shipped beds' -26 LUFS; true
    peak <= -6 dBTP; the loop seam (spectral correlation of the last and first
    250 ms >= 0.9, the wrap step no bigger than any inside the file, and
    validate:audio's own 250 ms level step and gap); the whine detector read
    wrapped; and the steady low note under 200 Hz printed, not gated (the
    shipped town bed's 50 Hz generator was the one steady tone the engines'
    calibration found).

Self-tests added here, each shown an input that must fail it:
  * the momentary-max meter: a 997 Hz sine at -20 dBFS held 1 s reads
    -23.0 LUFS, and the same sine for 0.2 s reads lower (a 400 ms window
    half filled), so a short click cannot meter like a held tone;
  * the tail meter: an exponential decay with a known 60 dB time reads it;
  * a constructed clang that rings one 1.2 kHz partial for 1.5 s reads
    WHINE as a one-shot, and the same partial cut to 0.5 s reads clean.
"""
import html
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from scipy import ndimage, signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "docs", "polish", "audio", "engines"))
import engine_candidates as ec  # noqa: E402  (the meters, the whine detector, the loop helpers)

SR = ec.SR
SFX_DIR = os.path.join(HERE, "sfx")
BED_DIR = os.path.join(HERE, "beds")
SHIPPED = os.path.join(ROOT, "assets", "audio")

ONE_SHOT_TP_MAX = -1.0      # gen_audio's norm() peak 0.89 is -1.0 dBFS
BED_LUFS = -26.0            # the shipped beds' own integrated level (open -26.0, town -26.8, ridge -26.0)
BED_TP_MAX = ec.MAX_TRUE_PEAK_DBTP
BED_FRAMES = 1723           # 1723 x 1024 = 1,764,352 samples = 40.008 s, the shipped beds' loop_s
BED_N = BED_FRAMES * 1024


# --- one-shot building blocks (not periodic) --------------------------------------------

def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def sos(kind, f, order=2):
    return signal.butter(order, f, kind, fs=SR, output="sos")


def env(t, attack, decay):
    return (1 - np.exp(-t / max(attack, 1e-5))) * np.exp(-t / decay)


def crack(r, dur, decay, lo=1800.0):
    """The supersonic crack / muzzle report: broadband, a few ms."""
    t = t_axis(dur)
    return signal.sosfilt(sos("high", lo), r.standard_normal(len(t))) * env(t, 0.00015, decay)


def blast(r, dur, cutoff, decay, attack=0.0008):
    """The muzzle blast or detonation: low-passed noise on a fast envelope."""
    t = t_axis(dur)
    return signal.sosfilt(sos("low", cutoff, 3), r.standard_normal(len(t))) * env(t, attack, decay)


def body(dur, f0, f1, decay, attack=0.002):
    """A low thump under 200 Hz, pitch falling f0 -> f1: what makes a big gun big."""
    t = t_axis(dur)
    f = f1 + (f0 - f1) * np.exp(-t / (decay * 0.6))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, attack, decay)


def tail(r, dur, cutoff, decay, delay=0.0, attack=0.03):
    """Outdoor reverb: the report coming back off the ground, low-passed noise that dies away."""
    t = t_axis(dur)
    x = signal.sosfilt(sos("low", cutoff, 2), r.standard_normal(len(t))) * env(t, attack, decay)
    return np.concatenate([np.zeros(int(delay * SR)), x])[: len(t)]


def crackle(r, dur, rate, decay, lo=1500.0, hi=7000.0):
    """Sparse debris and burning: random clicks thinning out over `decay`."""
    t = t_axis(dur)
    hits = r.random(len(t)) < (rate / SR) * np.exp(-t / decay)
    x = np.zeros(len(t))
    for i in np.nonzero(hits)[0]:
        n = min(int(0.004 * SR), len(t) - i)
        x[i:i + n] += r.uniform(0.3, 1.0) * r.choice([-1, 1]) * np.exp(-np.arange(n) / (0.0007 * SR))
    return signal.sosfilt(sos("band", [lo, hi]), x)


def clang(r, dur, centres, decay, spread=0.04, q=9.0):
    """A metal strike: noise through moving resonances (the engines' resonant_hit), so it cannot ring."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for fc, g in centres:
        c = fc * (1 + r.uniform(-spread, spread))
        out += g * signal.sosfilt(sos("band", [c * (1 - 0.5 / q), c * (1 + 0.5 / q)]), r.standard_normal(n))
    return out * env(t, 0.0004, decay)


def at(total, start, voice):
    out = np.zeros(int(SR * total))
    s = int(start * SR)
    n = min(len(voice), len(out) - s)
    out[s:s + n] += voice[:n]
    return out


def mix(total, *parts):
    """parts: (start_s, gain, voice)."""
    out = np.zeros(int(SR * total))
    for start, gain, voice in parts:
        out += gain * at(total, start, voice)
    return out


def fade_out(x, ms=15):
    n = int(SR * ms / 1000)
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n) ** 2
    return x


def ndimage_min(x, n):
    """A running minimum over n samples: the gain dip held across the transient."""
    return ndimage.minimum_filter1d(x, n)


# --- one-shot meters ------------------------------------------------------------------------

def momentary_max(x):
    """The loudest 400 ms window, BS.1770 K-weighted (ungated): how loud a one-shot sounds."""
    y = signal.sosfilt(ec.k_weighting(SR), np.concatenate([x, np.zeros(int(0.4 * SR))]))
    block, hop = int(0.4 * SR), int(0.01 * SR)
    sq = np.concatenate([[0.0], np.cumsum(y * y)])
    starts = np.arange(0, len(y) - block + 1, hop)
    z = (sq[starts + block] - sq[starts]) / block
    return float(-0.691 + 10 * np.log10(np.max(z) + 1e-20))


def one_shot_tp(x):
    """True peak of a one-shot: 4x oversampled, padded (not wrapped like a loop)."""
    up = signal.resample_poly(np.concatenate([np.zeros(64), x, np.zeros(64)]), 4, 1)
    return float(20 * np.log10(np.max(np.abs(up)) + 1e-20))


def tail_s(x):
    """Seconds from the peak until a 10 ms RMS window last stands within 60 dB of the loudest."""
    w = int(0.01 * SR)
    rms = np.sqrt(np.convolve(x * x, np.ones(w) / w, mode="same"))
    top = np.max(rms)
    alive = np.nonzero(rms >= top * 1e-3)[0]
    return float((alive[-1] - np.argmax(rms)) / SR)


def shipped_level(set_id):
    """The shipped placeholder's momentary max and true peak, decoded by ffmpeg (variant 01)."""
    src = os.path.join(SHIPPED, set_id, f"{set_id}_01.ogg")
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "x.wav")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", str(SR), wav], check=True)
        x, _ = ec.read_wav(wav)
    return momentary_max(x), one_shot_tp(x), len(x) / SR


def normalise_one_shot(x, target_m):
    """Returns (x, dB the limiter took off the transient at the shipped loudness)."""
    x = signal.sosfilt(sos("high", 25.0), x - np.mean(x))
    x = fade_out(x)
    raw = one_shot_tp(x * 10 ** ((target_m - momentary_max(x)) / 20))
    for _round in range(4):     # level, then the transient limiter, then level again, until both hold
        x = x * 10 ** ((target_m - momentary_max(x)) / 20)
        x = limit_transient(x)
        if abs(momentary_max(x) - target_m) <= 0.25:
            break
    return x, max(0.0, raw - ONE_SHOT_TP_MAX)


def limit_transient(x):
    # A transient (the crack) that peaks over the ceiling at the shipped loudness:
    # a brickwall on those few milliseconds only -- a gain envelope that dips
    # where the oversampled wave is over, held 2 ms and smoothed 1 ms either
    # side -- never a level change for the whole sound. Re-read until under.
    ceiling = 10 ** ((ONE_SHOT_TP_MAX - 0.15) / 20)
    for _ in range(6):
        if one_shot_tp(x) <= ONE_SHOT_TP_MAX:
            break
        up = np.abs(signal.resample_poly(np.concatenate([np.zeros(64), x, np.zeros(64)]), 4, 1))[256:-256]
        peak = np.maximum.reduceat(up, np.arange(0, len(up), 4))[: len(x)]
        g = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
        g = ndimage_min(g, int(0.002 * SR))
        g = np.convolve(g, np.hanning(int(0.002 * SR)) / np.hanning(int(0.002 * SR)).sum(), mode="same")
        x = x * np.minimum(g, 1.0)
    return x


# --- the one-shot candidates ------------------------------------------------------------------
# (set id, stem, function). Each function's docstring is "title: what to listen for".

def small_arms_a():
    """5.56 crack: a sharp supersonic crack, a short bright blast, the report slapping back off the
    ground at 180 ms. The rifle that fires most in the game; it should be light."""
    r = ec.gen(0xC01)
    return mix(0.9, (0, 1.0, crack(r, 0.02, 0.0012)), (0, 0.8, blast(r, 0.12, 4200, 0.022)),
               (0, 0.5, body(0.12, 140, 95, 0.03)), (0.004, 0.35, tail(r, 0.7, 2600, 0.16)),
               (0.18, 0.18, tail(r, 0.5, 1800, 0.12)))


def small_arms_b():
    """7.62, heavier: less crack, more chest, a longer and darker tail with a second echo at 320 ms."""
    r = ec.gen(0xC02)
    return mix(1.1, (0, 0.6, crack(r, 0.02, 0.0010)), (0, 1.0, blast(r, 0.16, 2600, 0.04)),
               (0, 0.8, body(0.18, 110, 70, 0.05)), (0.005, 0.45, tail(r, 0.9, 1700, 0.22)),
               (0.32, 0.2, tail(r, 0.6, 1200, 0.15)))


def hmg_a():
    """.50 thump: a deep blast with a real low body, the report rolling for most of a second."""
    r = ec.gen(0xC11)
    return mix(1.2, (0, 0.7, crack(r, 0.02, 0.0015)), (0, 1.0, blast(r, 0.2, 2200, 0.05)),
               (0, 1.0, body(0.25, 95, 55, 0.08)), (0.006, 0.5, tail(r, 1.1, 1500, 0.28)))


def hmg_b():
    """Valley echo: the same gun heard further off, the crack dulled and two echoes at 220 and 480 ms."""
    r = ec.gen(0xC12)
    return mix(1.4, (0, 0.35, crack(r, 0.02, 0.0012, lo=1200)), (0, 1.0, blast(r, 0.22, 1600, 0.06)),
               (0, 0.9, body(0.25, 85, 50, 0.09)), (0.22, 0.32, tail(r, 0.7, 1100, 0.18)),
               (0.48, 0.2, tail(r, 0.7, 900, 0.2)))


def autocannon_a():
    """30 mm bark: a hard low punch, a short bright crack and the breech's steel clack 45 ms after."""
    r = ec.gen(0xC21)
    return mix(1.3, (0, 0.8, crack(r, 0.025, 0.002)), (0, 1.0, blast(r, 0.25, 1800, 0.06)),
               (0, 1.0, body(0.3, 75, 45, 0.1)),
               (0.045, 0.3, clang(r, 0.12, [(950, 1.0), (1720, 0.7), (2650, 0.5)], 0.025)),
               (0.006, 0.45, tail(r, 1.2, 1300, 0.3)))


def autocannon_b():
    """Dull thud and link clatter: less crack, a rounder thump, the spent links rattling down."""
    r = ec.gen(0xC22)
    return mix(1.3, (0, 0.4, crack(r, 0.02, 0.0015)), (0, 1.0, blast(r, 0.25, 1300, 0.07)),
               (0, 1.0, body(0.3, 70, 42, 0.11)), (0.06, 0.25, crackle(r, 0.35, 260, 0.1, 2500, 7000)),
               (0.006, 0.45, tail(r, 1.2, 1100, 0.32)))


def tank_gun_a():
    """120 mm boom: a pressure wave you feel more than hear, the report rolling 2.5 s, a far echo at 0.6 s."""
    r = ec.gen(0xC31)
    return mix(3.0, (0, 0.6, crack(r, 0.03, 0.003, lo=1000)), (0, 1.0, blast(r, 0.5, 1400, 0.12, attack=0.0015)),
               (0, 1.0, body(0.8, 55, 32, 0.25, attack=0.004)), (0.01, 0.6, tail(r, 2.6, 900, 0.7)),
               (0.6, 0.25, tail(r, 1.6, 600, 0.45)))


def tank_gun_b():
    """Sharper crack: more of the muzzle's crack and blast, a shorter tail: reads at a distance."""
    r = ec.gen(0xC32)
    return mix(2.4, (0, 1.0, crack(r, 0.03, 0.004, lo=800)), (0, 1.0, blast(r, 0.4, 2200, 0.09)),
               (0, 0.8, body(0.6, 60, 36, 0.18)), (0.008, 0.55, tail(r, 2.0, 1200, 0.5)))


def mortar_thump_a():
    """Tube thoonk: the hollow cough of a round leaving the tube (a short tube resonance, noise-made), then the thump."""
    r = ec.gen(0xC41)
    tube = clang(r, 0.18, [(310, 1.0), (620, 0.4)], 0.045, spread=0.02, q=5.0)
    return mix(1.4, (0, 1.0, tube), (0, 0.8, blast(r, 0.25, 900, 0.06, attack=0.003)),
               (0, 0.9, body(0.35, 80, 50, 0.1, attack=0.004)), (0.01, 0.4, tail(r, 1.2, 900, 0.3)))


def mortar_thump_b():
    """Launch with a rush: a deeper thump and the rocket/round's hiss tailing off (the rocket battery shares this set)."""
    r = ec.gen(0xC42)
    t = t_axis(1.3)
    rush = signal.sosfilt(sos("band", [900, 5000]), r.standard_normal(len(t))) * env(t, 0.04, 0.35)
    return mix(1.6, (0, 1.0, blast(r, 0.3, 700, 0.08, attack=0.004)), (0, 1.0, body(0.4, 70, 40, 0.13, attack=0.005)),
               (0.02, 0.45, rush), (0.01, 0.4, tail(r, 1.4, 800, 0.35)))


def impact_pen_a():
    """Hard clang: steel struck through -- a crack and a short, inharmonic clang that dies before it can ring."""
    r = ec.gen(0xC51)
    return mix(1.0, (0, 0.8, crack(r, 0.02, 0.002)),
               (0, 1.0, clang(r, 0.6, [(610, 1.0), (1430, 0.8), (2310, 0.6), (3700, 0.4)], 0.11)),
               (0, 0.6, body(0.2, 120, 80, 0.05)), (0.005, 0.3, tail(r, 0.8, 2000, 0.2)))


def impact_pen_b():
    """Punch and spall: a dull punch through armour and the spall rattling inside, no bell at all."""
    r = ec.gen(0xC52)
    return mix(1.0, (0, 1.0, blast(r, 0.15, 1500, 0.035)), (0, 0.9, body(0.2, 100, 60, 0.06)),
               (0.01, 0.6, crackle(r, 0.4, 900, 0.09, 1800, 8000)),
               (0, 0.35, clang(r, 0.25, [(820, 1.0), (2100, 0.6)], 0.05, spread=0.08)))


def destroyed_a():
    """Fireball: a deep boom, a roaring blast and burning crackle that thins out over two seconds."""
    r = ec.gen(0xC61)
    return mix(3.2, (0, 1.0, blast(r, 0.9, 700, 0.25, attack=0.004)), (0, 1.0, body(1.0, 50, 28, 0.35, attack=0.006)),
               (0, 0.4, crack(r, 0.03, 0.004, lo=900)), (0.05, 0.35, crackle(r, 2.8, 120, 0.9)),
               (0.02, 0.6, tail(r, 3.0, 600, 0.9)))


def destroyed_b():
    """Cook-off: the kill, then two late secondary pops as the ammunition goes."""
    r = ec.gen(0xC62)
    pop = lambda s: blast(r, 0.4, 1600, 0.06) + 0.6 * body(0.4, 80, 50, 0.08)  # noqa: E731
    return mix(3.2, (0, 1.0, blast(r, 0.7, 900, 0.18, attack=0.003)), (0, 1.0, body(0.8, 55, 30, 0.28, attack=0.005)),
               (0.62, 0.45, pop(0)), (1.15, 0.35, pop(1)), (0.03, 0.3, crackle(r, 2.5, 160, 0.7)),
               (0.02, 0.5, tail(r, 3.0, 700, 0.8)))


def near_miss_a():
    """Supersonic snap: the round's own crack passing a metre off, then a short whip of air."""
    r = ec.gen(0xC71)
    t = t_axis(0.25)
    whip = signal.sosfilt(sos("band", [2500, 9000]), r.standard_normal(len(t))) * env(t, 0.004, 0.04)
    return mix(0.5, (0, 1.0, crack(r, 0.015, 0.0008, lo=2500)), (0.003, 0.5, whip), (0.01, 0.15, tail(r, 0.4, 3000, 0.08)))


def near_miss_b():
    """Whizz-by: a subsonic fragment's falling whizz (band-limited noise sweeping down), no crack."""
    r = ec.gen(0xC72)
    t = t_axis(0.4)
    x = r.standard_normal(len(t))
    out = np.zeros(len(t))
    # a moving band: 6 kHz -> 1.5 kHz over 0.35 s, in 40 short blocks
    edges = np.linspace(0, len(t), 41).astype(int)
    for k in range(40):
        c = 6000 * (1.5 / 6) ** (k / 39)
        seg = signal.sosfilt(sos("band", [c * 0.7, c * 1.3]), x[max(0, edges[k] - 256):edges[k + 1]])
        out[edges[k]:edges[k + 1]] = seg[-(edges[k + 1] - edges[k]):]
    return out * env(t, 0.03, 0.12)


SFX = [
    ("small_arms", "small_arms_a_556_crack", small_arms_a), ("small_arms", "small_arms_b_762_heavier", small_arms_b),
    ("hmg", "hmg_a_50_thump", hmg_a), ("hmg", "hmg_b_valley_echo", hmg_b),
    ("autocannon", "autocannon_a_30mm_bark", autocannon_a), ("autocannon", "autocannon_b_thud_links", autocannon_b),
    ("tank_gun", "tank_gun_a_120mm_boom", tank_gun_a), ("tank_gun", "tank_gun_b_sharper_crack", tank_gun_b),
    ("mortar_thump", "mortar_thump_a_tube", mortar_thump_a), ("mortar_thump", "mortar_thump_b_rush", mortar_thump_b),
    ("impact_pen", "impact_pen_a_clang", impact_pen_a), ("impact_pen", "impact_pen_b_spall", impact_pen_b),
    ("destroyed", "destroyed_a_fireball", destroyed_a), ("destroyed", "destroyed_b_cook_off", destroyed_b),
    ("near_miss", "near_miss_a_snap", near_miss_a), ("near_miss", "near_miss_b_whizz", near_miss_b),
]


# --- ambience beds (periodic, built with the engines' circular helpers at BED_N) -------------

def _bed_mode():
    """Point the engines' periodic helpers (noise, circ, lp, hp, bp, cycles, place) at the bed's length."""
    ec.LOOP_N = BED_N


def _wind(r, cut, swells, gusts=()):
    """Wind: low-passed noise breathing with slow whole-cycle swells; gusts are brighter noise on a cosine."""
    base = ec.lp(ec.noise(r), cut, order=2) * ec.cycles(swells)
    out = base / np.std(base)
    for k, depth, lo, hi in gusts:
        g = ec.bp(ec.noise(r), lo, hi) * np.maximum(0, ec.cycles([(k, depth)]) - 1)
        out += g / (np.std(g) + 1e-12) * 0.35
    return out


def _events(r, n, voice_fn, gain, spread=(0.8, 1.2)):
    out = np.zeros(BED_N)
    for at_s in np.sort(r.uniform(0, BED_N / SR, n)):
        ec.place(out, at_s * SR, gain * r.uniform(*spread) * voice_fn())
    return out


def bed_open_a():
    """Open ground, still: a soft wind that rises and falls twice a minute and dry grass hiss, nothing else."""
    _bed_mode()
    r = ec.gen(0xB01)
    wind = _wind(r, 500, [(1, 0.35), (3, 0.15)])
    grass = ec.bp(ec.noise(r), 2500, 7000) * ec.cycles([(2, 0.4), (5, 0.2)])
    return wind + 0.25 * grass / np.std(grass)


def bed_open_b():
    """Open ground, breezier: more wind with gusts, a bird's two short calls now and then (each under a second)."""
    _bed_mode()
    r = ec.gen(0xB02)
    wind = _wind(r, 700, [(1, 0.4), (4, 0.2)], gusts=[(3, 0.6, 600, 2400)])

    def call():
        t = np.arange(int(0.18 * SR)) / SR
        f = 2900 + 900 * np.sin(2 * np.pi * 9 * t)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.hanning(len(t))
    return wind + _events(r, 6, call, 0.06)


def bed_town_a():
    """Town, empty streets: wind between buildings, a far-off engine idling and a metal door now and then."""
    _bed_mode()
    r = ec.gen(0xB11)
    wind = _wind(r, 450, [(1, 0.3), (2, 0.15)])
    far = ec.lp(ec.noise(r), 160, order=4) * ec.cycles([(3, 0.3)])

    def door():
        return clang(r, 0.35, [(380, 1.0), (920, 0.6), (1700, 0.3)], 0.06, spread=0.06) + 0.5 * blast(r, 0.35, 700, 0.03)
    return wind + 0.5 * far / np.std(far) + _events(r, 5, door, 0.5)


def bed_town_b():
    """Town, inhabited: the A bed plus distant voices' murmur (formant-band noise, no pitch) and a dog barking twice."""
    _bed_mode()
    r = ec.gen(0xB12)
    wind = _wind(r, 450, [(1, 0.3), (2, 0.15)])
    murmur = sum(ec.bp(ec.noise(r), lo, hi) for lo, hi in ((300, 700), (900, 1500), (2200, 3000)))
    murmur = murmur * ec.cycles([(5, 0.5), (7, 0.3)])

    def bark():
        t = np.arange(int(0.12 * SR)) / SR
        return signal.sosfilt(sos("band", [500, 1800]), r.standard_normal(len(t))) * env(t, 0.005, 0.04)
    barks = _events(r, 4, lambda: np.concatenate([bark(), np.zeros(int(0.15 * SR)), bark()]), 0.5)
    return wind + 0.3 * murmur / np.std(murmur) + barks


def bed_ridge_a():
    """Ridge: high, exposed wind -- darker and stronger, long gusts that roar across the rock."""
    _bed_mode()
    r = ec.gen(0xB21)
    return _wind(r, 380, [(1, 0.45), (2, 0.25)], gusts=[(2, 0.7, 250, 1400), (5, 0.4, 400, 2000)])


def bed_ridge_b():
    """Ridge, gentler: the same exposure with less roar and loose stones trickling now and then."""
    _bed_mode()
    r = ec.gen(0xB22)
    wind = _wind(r, 420, [(1, 0.3), (3, 0.2)], gusts=[(3, 0.5, 300, 1600)])
    stones = _events(r, 7, lambda: crackle(r, 0.6, 400, 0.15, 1200, 6000), 1.4)
    return wind + stones


BEDS = [
    ("open", "amb_open_a_still", bed_open_a), ("open", "amb_open_b_breeze", bed_open_b),
    ("town", "amb_town_a_empty", bed_town_a), ("town", "amb_town_b_inhabited", bed_town_b),
    ("ridge", "amb_ridge_a_exposed", bed_ridge_a), ("ridge", "amb_ridge_b_gentler", bed_ridge_b),
]


def finish_bed(x):
    x = ec.hp(x - np.mean(x), 22.0)
    x = x * 10 ** ((BED_LUFS - ec.lufs(x)) / 20)
    assert len(x) == BED_N
    return x


# --- self-tests specific to this page ---------------------------------------------------------

def selftest():
    res = []
    m = momentary_max(ec._sine(997.0, 1.0, -20.0))
    res.append(("997 Hz at -20 dBFS held 1 s: momentary max -23.0", abs(m + 23.01) < 0.1, f"{m:.2f} LUFS"))
    m2 = momentary_max(ec._sine(997.0, 0.2, -20.0))
    res.append(("same sine for 0.2 s reads lower (window half filled)", m2 < m - 2.5, f"{m2:.2f} LUFS"))
    t = t_axis(3.0)
    decay = np.sin(2 * np.pi * 60 * t) * np.exp(-t / 0.2)       # 60 dB = ln(1000) x 0.2 = 1.38 s
    ts = tail_s(decay)
    res.append(("exponential decay, 60 dB in 1.38 s: tail reads it", abs(ts - 1.38) < 0.06, f"{ts:.2f} s"))
    r = np.random.default_rng(0x7E57)
    ring = mix(2.0, (0, 1.0, crack(r, 0.02, 0.002)), (0, 0.5, np.sin(2 * np.pi * 1200 * t_axis(1.5)) * np.exp(-t_axis(1.5) / 3)))
    w = ec.whine(ring, loop=False)
    res.append(("clang ringing 1.2 kHz for 1.5 s: WHINE", w["whine"] and abs(w["hz"] - 1200) < 15,
                f"{w['hz']:.0f} Hz held {w['secs']:.2f} s"))
    short = mix(2.0, (0, 1.0, crack(r, 0.02, 0.002)), (0, 0.5, np.sin(2 * np.pi * 1200 * t_axis(0.5))))
    w = ec.whine(short, loop=False)
    res.append(("the same partial cut to 0.5 s: clean", not w["whine"], f"longest {w['secs']:.2f} s"))
    print("self-tests (this page):")
    for name, ok, note in res:
        print(f"  {'ok  ' if ok else 'FAIL'} {name:56s} {note}")
    assert all(ok for _n, ok, _x in res), "self-test failed"
    return res


# --- run ----------------------------------------------------------------------------------

def encode_bed(wav, stem):
    ogg, m4a = os.path.join(BED_DIR, stem + ".ogg"), os.path.join(BED_DIR, stem + ".m4a")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-map_metadata", "-1", "-fflags", "+bitexact",
                    "-c:a", "libvorbis", "-q:a", "3", ogg], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-map_metadata", "-1", "-fflags", "+bitexact",
                    "-c:a", "aac", "-b:a", "160k", m4a], check=True)


def main():
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} is required (it decodes the shipped placeholders and encodes the beds)")
    engine_tests = ec.selftest()
    tests = engine_tests + selftest()
    os.makedirs(SFX_DIR, exist_ok=True)
    os.makedirs(BED_DIR, exist_ok=True)

    print("\none-shots (normalised to the shipped placeholder's momentary max):")
    shipped = {}
    sfx_rows = []
    for set_id, stem, fn in SFX:
        if set_id not in shipped:
            shipped[set_id] = shipped_level(set_id)
        target, ship_tp, ship_len = shipped[set_id]
        x, gr = normalise_one_shot(fn(), target)
        wav = os.path.join(SFX_DIR, stem + ".wav")
        ec.write_wav(wav, x)
        x, _ = ec.read_wav(wav)
        m, tp, tl = momentary_max(x), one_shot_tp(x), tail_s(x)
        w = ec.whine(x, loop=False)
        checks = {"level": abs(m - target) <= 0.5, "peak": tp <= ONE_SHOT_TP_MAX + 0.05, "whine": not w["whine"]}
        fails = [k for k, ok in checks.items() if not ok]
        verdict = "PASS" if not fails else "FAIL: " + ", ".join(fails)
        ec.spectrogram_png(os.path.join(SFX_DIR, stem + ".png"), x, stem, f"{verdict}; {ec.tone_text(w)}", w)
        sfx_rows.append((set_id, stem, fn.__doc__, {"m": m, "tp": tp, "tail": tl, "len": len(x) / SR, "whine": w,
                                                     "verdict": verdict, "ship": shipped[set_id], "gr": gr}))
        print(f"  {stem:28s} M {m:6.1f} (shipped {target:6.1f}) TP {tp:5.1f}  limiter {gr:3.1f} dB  tail {tl:4.2f} s  "
              f"{verdict}; {ec.tone_text(w)}")

    print("\nbeds (40.008 s loops, -26 LUFS like the shipped beds):")
    bed_rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for kind, stem, fn in BEDS:
            x = finish_bed(fn())
            wav = os.path.join(tmp, stem + ".wav")
            ec.write_wav(wav, x)
            x, _ = ec.read_wav(wav)
            ec.LOOP_N = BED_N
            lu, tp = ec.lufs(x), ec.true_peak(x)
            sm = ec.seam(x)
            w = ec.whine(x)
            lo = ec.whine(x, band_hz=ec.LOW_BAND_HZ)
            checks = {"level": abs(lu - BED_LUFS) <= 0.5, "peak": tp <= BED_TP_MAX, "seam": ec.seam_ok(sm),
                      "whine": not w["whine"]}
            fails = [k for k, ok in checks.items() if not ok]
            verdict = "PASS" if not fails else "FAIL: " + ", ".join(fails)
            ec.spectrogram_png(os.path.join(BED_DIR, stem + ".png"), x, stem, f"{verdict}; {ec.tone_text(w)}", w)
            encode_bed(wav, stem)
            bed_rows.append((kind, stem, fn.__doc__, {"lufs": lu, "tp": tp, "seam": sm, "whine": w, "low": lo,
                                                      "verdict": verdict}))
            print(f"  {stem:26s} {lu:6.1f} LUFS TP {tp:5.1f} seam {sm['corr']:.3f} step {sm['step']:.2f}  {verdict}; "
                  f"{ec.tone_text(w)}; {ec.low_text(lo)}")

    write_page(sfx_rows, bed_rows, tests)
    failed = [s for _k, s, _d, m in sfx_rows + bed_rows if m["verdict"] != "PASS"]
    print(f"\n{len(sfx_rows) + len(bed_rows) - len(failed)} of {len(sfx_rows) + len(bed_rows)} candidates pass"
          + (f"; FAIL: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


# --- the listening page ---------------------------------------------------------------------

def write_page(sfx_rows, bed_rows, tests):
    e = html.escape
    head = ec.PAGE_HEAD.replace("<title>Engine Loop Candidates</title>", "<title>Combat Sound and Ambience Candidates</title>")
    out = [head]
    out.append("<h1>Combat sound and ambience candidates</h1>")
    out.append("<p>Audio is the lowest polish category (3 of 5). The combat sounds you hear most are still the "
               "placeholders <code>tools/gen_audio.py</code> wrote, and the ambience beds have been off since "
               "9 Oct (#483). For each, the sound that ships today and an A and a B. Nothing here is wired into "
               "the game; a pick moves into <code>gen_audio.py</code> unchanged.</p>")
    out.append('<p class="muted">One-shots are normalised to the shipped placeholder\'s own loudness (the loudest '
               "400 ms, K-weighted), so you compare character, not volume, and the game's gains stay right for a "
               "pick. In the game each plays with a little random pitch per shot and is placed by distance and "
               "bearing. Beds are 40 s seamless loops at the shipped beds' -26 LUFS (heard at about -34 LUFS "
               "behind everything); let them run round. Synthesised, CC0, byte-identical on every run of "
               "<code>combat_candidates.py</code>.</p>")
    out.append("<h2>Combat one-shots</h2>")
    sid = None
    for set_id, stem, doc, m in sfx_rows:
        if set_id != sid:
            sid = set_id
            ship_m, ship_tp, ship_len = m["ship"]
            out.append(f'<section class="card"><div class="family">shipped today</div><h3>{e(set_id)}</h3>'
                       f'<audio controls preload="none"><source src="../../../../assets/audio/{e(set_id)}/{e(set_id)}_01.ogg" '
                       f'type="audio/ogg"><source src="../../../../assets/audio/{e(set_id)}/{e(set_id)}_01.m4a" '
                       f'type="audio/mp4"></audio><p class="verdict">placeholder from gen_audio.py &middot; '
                       f"momentary max {ship_m:.1f} LUFS &middot; true peak {ship_tp:.1f} dBTP &middot; "
                       f"{ship_len:.2f} s</p></section>")
        cls = "pass" if m["verdict"] == "PASS" else "fail"
        title, _, rest = " ".join(doc.split()).partition(":")
        out.append(f'<section class="card" id="{e(stem)}"><div class="family">{e(set_id)}</div>'
                   f"<h3>{e(stem)} &mdash; {e(title)}</h3><p>{e(rest.strip())}</p>"
                   f'<audio controls preload="none" src="sfx/{e(stem)}.wav"></audio>'
                   f'<img src="sfx/{e(stem)}.png" alt="Spectrogram of {e(stem)}" loading="lazy">'
                   f'<p class="verdict"><span class="{cls}">{e(m["verdict"])}</span> &middot; momentary max '
                   f"{m['m']:.1f} LUFS &middot; true peak {m['tp']:.1f} dBTP &middot; {m['len']:.2f} s, tail "
                   f"{m['tail']:.2f} s &middot; {e(ec.tone_text(m['whine']))}"
                   + (f" &middot; the transient limiter takes {m['gr']:.1f} dB off its first milliseconds" if m["gr"] > 0.05 else "")
                   + "</p></section>")
    out.append("<h2>Ambience beds</h2>")
    kind = None
    for k, stem, doc, m in bed_rows:
        if k != kind:
            kind = k
            out.append(f'<section class="card"><div class="family">shipped today (off since 9 Oct, #483)</div>'
                       f"<h3>{e(k)}</h3><audio controls loop preload=\"none\" src=\"../ambience/amb_{e(k)}.wav\"></audio>"
                       "</section>")
        cls = "pass" if m["verdict"] == "PASS" else "fail"
        title, _, rest = " ".join(doc.split()).partition(":")
        sm = m["seam"]
        out.append(f'<section class="card" id="{e(stem)}"><div class="family">bed &middot; {e(k)}</div>'
                   f"<h3>{e(stem)} &mdash; {e(title)}</h3><p>{e(rest.strip())}</p>"
                   f'<audio controls loop preload="none"><source src="beds/{e(stem)}.ogg" type="audio/ogg">'
                   f'<source src="beds/{e(stem)}.m4a" type="audio/mp4"></audio>'
                   f'<img src="beds/{e(stem)}.png" alt="Spectrogram of {e(stem)}" loading="lazy">'
                   f'<p class="verdict"><span class="{cls}">{e(m["verdict"])}</span> &middot; {m["lufs"]:.1f} LUFS '
                   f"&middot; true peak {m['tp']:.1f} dBTP &middot; seam {sm['corr']:.3f} &middot; "
                   f"{e(ec.tone_text(m['whine']))} &middot; {e(ec.low_text(m['low']))}</p></section>")
    out.append("<h2>How it was checked</h2>")
    out.append("<p>The meters and the whine detector are the engines' own (<code>../engines/engine_candidates.py</code>, "
               "imported). A one-shot is read as a one-shot (not wrapped); a bed is read wrapped, as it loops. "
               "<b>Whine</b>: a spectral peak 10 dB or more over the &plusmn;161 Hz around it, 200 Hz to 8 kHz, held "
               "1 s or longer. Each check was first shown an input built to fail it:</p><ul>")
    for name, ok, note in tests:
        out.append(f"<li>{e(name)}: {e(note)} {'&check;' if ok else '&cross;'}</li>")
    out.append("</ul></main>\n</body>\n</html>\n")
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out))


if __name__ == "__main__":
    sys.exit(main())
