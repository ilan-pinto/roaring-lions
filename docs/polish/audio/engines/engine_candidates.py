"""Engine-loop candidates for GH-35 ("vehicles are silent"), for the lead's ear.

    python3 docs/polish/audio/engines/engine_candidates.py

CANDIDATES ONLY. Nothing here is wired into the game and nothing ships: no
change to packages/render/src/audio.ts, data/audio.json or tools/gen_audio.py.
A chosen candidate moves into gen_audio.py later, unchanged, the way the
pass-F cues did (docs/polish/audio/cue_candidates.py).

What it writes, next to this file:
  * an A and a B variant of five loops -- tracked-heavy idle, tracked-heavy
    moving, a separate track-clank layer, wheeled idle, wheeled moving -- plus
    a rotor A/B in rotor/. 16-bit mono 44.1 kHz WAV, each LOOP_N samples
    (a whole number of 1024-sample frames, like the ambience beds, so an AAC
    encoding needs no padding inside the loop);
  * a spectrogram PNG per WAV, with the whine detector's band and anything it
    flagged drawn on it;
  * index.html, the one listening page: a looping player per WAV, its
    spectrogram and its verdict.

CC0 by construction: noise, envelopes and sines synthesised here with numpy and
scipy, no sample, no generative model, no third-party provenance. Deterministic:
every candidate draws from its OWN fixed-seed generator, so a re-run writes
byte-identical files whatever the order.

Seamless by construction, not by a crossfade. Everything is periodic in LOOP_N:
every slow movement is a whole number of cycles per loop, a firing train has a
whole number of pulses per loop and its pulses are placed on the loop's circle
(what runs past the end comes in at the head), every noise layer is a noise
exactly LOOP_N long filtered CIRCULARLY (the filter runs over two periods and
the second is kept, so its state at the head is the state the tail left), and
the deterministic engine pulse is low-passed the same circular way.

The whine rule, from #483 (the ambience beds the lead switched off as "an
annoying sound that sounds like whining"): above WHINE_BAND_HZ[0] nothing in
an engine loop is a sustained tone. The firing pulse that gives an engine its
pitch is kept under DET_LP_HZ, and everything above it is NOISE shaped by the
firing envelope -- amplitude-modulated noise has a continuous spectrum, so it
can roar and rattle but cannot ring. The detector below checks that claim on
every file instead of trusting it.

Measured per file, and printed:
  * integrated loudness, ITU-R BS.1770-4 (K-weighting derived for 44.1 kHz,
    400 ms blocks, absolute and relative gates), implemented here and cross-
    checked against ffmpeg's ebur128 when ffmpeg is on PATH;
  * true peak, 4x polyphase oversampling, beside ffmpeg's own;
  * the loop seam, end to start: the spectral correlation of the last and the
    first SEAM_W_S (AU-8's "last and first 50 ms correlate >= 0.9"), beside
    the same reading taken at ordinary junctions inside the file, plus the
    house seam check from tools/validate_audio.py (level step, gap);
  * the whine detector: a spectral peak more than WHINE_PROMINENCE_DB above the
    local median, inside WHINE_BAND_HZ, persisting WHINE_MIN_S or longer.

Self-tests run first and the script stops on any of them: a pure 440 Hz tone
MUST read as a whine; white and pink noise must not; a 440 Hz tone 0.4 s long
must not (persistence matters); the K-weighting must reproduce BS.1770's own
48 kHz coefficients; a 997 Hz sine at -20 dBFS must meter -20.0 LUFS (+-0.1);
a loop that ends bright and starts dark must fail the seam. The shipped
ambience beds (docs/polish/audio/ambience/) are then measured as calibration
against the lead's own ear.
"""
import html
import os
import shutil
import subprocess
import sys
import wave

import numpy as np
from scipy import ndimage, signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import validate_audio as va  # noqa: E402  (the house seam check and ffmpeg reading)

SR = 44100
LOOP_FRAMES = 345                    # 345 x 1024 = 353,280 samples = 8.011 s
LOOP_N = LOOP_FRAMES * 1024

# File level. Every loop is normalised to the same integrated loudness, so the
# lead compares character, not volume; the game's gains set the level heard
# (see the numbers sheet in the PR). The ceiling is the ambience beds' own.
FILE_LUFS = -24.0
LAYER_LUFS = -27.0                   # the track clank, a layer UNDER a moving engine: 3 LU down
MAX_TRUE_PEAK_DBTP = -6.0

# The playback rate the numbers sheet proposes at full speed (rate = 0.9 + 0.3 x
# speed share). The whine check is run at 1x AND at this rate: a tone just
# under the band at rest must not cross into it when the vehicle speeds up.
RATE_MAX = 1.2

# The deterministic (pitched) half of an engine stays under this.
DET_LP_HZ = 150.0

# The whine detector. Fixed before any candidate was measured; see whine().
WHINE_BAND_HZ = (200.0, 8000.0)      # under 200 Hz a steady pitch is the engine's own rumble
WHINE_PROMINENCE_DB = 10.0           # N: dB over the local median
WHINE_MIN_S = 1.0                    # M: seconds the peak must persist
WHINE_NPERSEG = 4096                 # 93 ms, 10.8 Hz bins
WHINE_HOP = 1024                     # 23 ms
WHINE_MEDIAN_BINS = 31               # +-15 bins = +-161 Hz around each bin
WHINE_AUDIBLE_DB = 50.0              # a peak this far under the file's loudest bin is not heard
WHINE_GAP_FRAMES = 2                 # a run survives a dip this long (a tone in noise flickers)

# The seam: the last and first SEAM_W_S's spectra correlate >= 0.9 (AU-8's
# number). AU-8 wrote 50 ms; two 50 ms windows of the SAME stationary noise
# correlate only ~0.9 (a 50 ms window resolves 20 Hz, so its low bands are a
# coin toss), so the window is the house seam check's own 250 ms
# (tools/validate_audio.py, AMB seam level), where a seamless loop reads ~0.99.
SEAM_W_S = 0.25
SEAM_MIN_CORR = 0.9


# --- periodic building blocks -------------------------------------------------

def gen(seed):
    """Each candidate's own stream: order-independent, byte-stable."""
    return np.random.default_rng(seed)


def per(f):
    """`f` rounded to a whole number of cycles per loop."""
    return max(1, round(f * LOOP_N / SR)) * SR / LOOP_N


def cycles(terms):
    """A slow movement, 1 + sum(a cos(2 pi k i / LOOP_N)) over (k, a): whole k,
    so periodic. A COSINE, so every movement turns at the seam and the 250 ms
    either side of the wrap hear the same level: validate_audio's seam step
    reads exactly those two windows, and a swell crossing the wrap at full
    slope reads as a step there though nothing is discontinuous."""
    i = np.arange(LOOP_N)
    out = np.ones(LOOP_N)
    for k, a in terms:
        out += a * np.cos(2 * np.pi * k * i / LOOP_N)
    return out


def circ(sos, x):
    """Filter a periodic signal circularly: run two periods, keep the second,
    so the filter's state at the head is the state the tail left it in."""
    return signal.sosfilt(sos, np.concatenate([x, x]))[LOOP_N:]


def lp(x, fc, order=2):
    return circ(signal.butter(order, fc, "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return circ(signal.butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return circ(signal.butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def noise(r):
    """White noise exactly one loop long: periodic once filtered with circ()."""
    return r.standard_normal(LOOP_N)


def place(out, at, voice):
    """Add `voice` at sample `at` on the loop's circle."""
    s = int(round(at)) % LOOP_N
    n = len(voice)
    head = min(n, LOOP_N - s)
    out[s:s + head] += voice[:head]
    if head < n:
        out[:n - head] += voice[head:]


def train(r, f, wander=(), jitter=0.0, multiple=1):
    """Pulse times (samples) of a firing train with a WHOLE number of pulses
    per loop (a multiple of `multiple`, so a per-cylinder pattern repeats
    exactly), on a slow periodic rate wander (k, depth, phase), each pulse
    then jittered by `jitter` of its local period."""
    p = max(multiple, round(f * LOOP_N / SR / multiple) * multiple)
    i = np.arange(LOOP_N + 1, dtype=float)
    phase = p * i / LOOP_N
    for k, d, ph in wander:
        phase += p * d / (2 * np.pi * k) * (np.cos(ph) - np.cos(2 * np.pi * k * i / LOOP_N + ph))
    assert np.all(np.diff(phase) > 0), "rate wander deeper than the rate"
    times = np.interp(np.arange(p), phase, i)
    times += r.normal(0.0, jitter * LOOP_N / p, p)
    return np.mod(times, LOOP_N)


def burst(r, dur, lo, hi, decay, attack=0.0006, order=2):
    """A noise burst through a band: the broadband half of a firing pulse."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = signal.sosfilt(signal.butter(order, [lo, hi], "band", fs=SR, output="sos"), r.standard_normal(n))
    return x * (1 - np.exp(-t / attack)) * np.exp(-t / decay)


def kick(r, dur, f, decay, detune=0.06, attack=0.0015):
    """The pitched half of a firing pulse: a damped low sine, detuned per pulse."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    ff = f * (1 + r.uniform(-detune, detune))
    return np.sin(2 * np.pi * ff * t) * (1 - np.exp(-t / attack)) * np.exp(-t / decay)


def resonant_hit(r, dur, centres, q, decay, spread):
    """A metal strike as NOISE through resonances whose centres move per hit
    (`spread`, a share): a clank that cannot ring the same note twice."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for fc, gain in centres:
        c = fc * (1 + r.uniform(-spread, spread))
        lo, hi = c * (1 - 0.5 / q), c * (1 + 0.5 / q)
        x = signal.sosfilt(signal.butter(2, [lo, hi], "band", fs=SR, output="sos"), r.standard_normal(n))
        out += gain * x
    return out * (1 - np.exp(-t / 0.0004)) * np.exp(-t / decay)


def engine(r, f, *, cylinders, imbalance, wander, jitter, thump, crack, crack_gain, amp_jitter=0.12):
    """A firing train: one pulse per cylinder firing, `cylinders` per engine
    cycle, each cylinder with its own fixed strength (`imbalance`), so the idle
    lopes at the cycle rate and not only at the firing rate. Returns
    (pitched, crack, envelope): the pitched kicks low-passed under DET_LP_HZ;
    the crack, noise bursts on the same pulses; and the firing envelope (a
    bump per pulse, 0..1) for a noise layer to breathe with -- exhaust noise
    pulsed by the firing is what makes an engine read on a small speaker that
    cannot play its 40-110 Hz note at all. thump: (freq, decay); crack: (lo,
    hi, decay)."""
    times = train(r, f, wander, jitter, multiple=cylinders)
    strength = 1 + imbalance * r.uniform(-1, 1, cylinders)
    det = np.zeros(LOOP_N)
    brd = np.zeros(LOOP_N)
    env = np.zeros(LOOP_N)
    w = max(8, int(0.7 * LOOP_N / len(times)))
    bump = np.hanning(w)
    for m, at in enumerate(times):
        a = strength[m % cylinders] * (1 + amp_jitter * r.uniform(-1.732, 1.732))  # bounded, sd = amp_jitter
        place(det, at, a * kick(r, 0.09, thump[0], thump[1]))
        place(brd, at, a * crack_gain * burst(r, 0.06, crack[0], crack[1], crack[2]))
        place(env, at - w // 4, a * bump)
    det = lp(det, DET_LP_HZ, order=6)
    # 0..1, a strong pulse's bump at the top; the few strongest are capped, so
    # every layer breathing with it cannot stack the same pulse into a peak.
    return det, brd, np.minimum(env / np.percentile(env, 99), 1.0)


def finish(x, target=FILE_LUFS):
    """Every loop: DC out, then normalised to `target` by this file's meter."""
    x = hp(x - np.mean(x), 22.0)
    x = x * 10 ** ((target - lufs(x)) / 20)
    assert len(x) == LOOP_N
    return x


# --- tracked heavy (Lavi, Namer, Eitan, Kipod, D9) ----------------------------
# A big V12 diesel. Its pitch is low and stays low; what changes with load is
# the roar ABOVE it -- intake and exhaust noise -- and how hard each pulse
# hits. The track is a separate layer (track_clank_*), so the hull can idle
# with its tracks still and the clank can follow speed on its own.

def tracked_idle_a():
    """'V12 at idle': 650 rpm, twelve cylinders, so a 65 Hz firing note
    lopes at the 5.4 Hz engine cycle; a deep exhaust pulsing with it and a
    soft breath of the cooling air. Steady, heavy, unhurried."""
    r = gen(0xE101)
    det, brd, env = engine(r, 65.0, cylinders=12, imbalance=0.22, wander=[(3, 0.010, 0.4), (5, 0.006, 2.1)],
                           jitter=0.012, thump=(58.0, 0.020), crack=(110.0, 1100.0, 0.012), crack_gain=1.0)
    exhaust = bp(noise(r), 90, 520) * (0.35 + 0.65 * env) * 0.9
    air = bp(noise(r), 400, 2600) * 0.06 * cycles([(2, 0.15)])
    return finish(0.45 * det + brd + exhaust + air)


def tracked_idle_b():
    """'Lumpy and lower': a slower, rougher idle -- 40 Hz firing with a big
    cylinder-to-cylinder spread, so it chugs at 5 Hz -- with a heavier
    exhaust and a cooling-fan rush that swells and settles twice a loop."""
    r = gen(0xE102)
    det, brd, env = engine(r, 40.0, cylinders=8, imbalance=0.35, wander=[(2, 0.015, 1.0), (7, 0.006, 0.2)],
                           jitter=0.018, thump=(47.0, 0.028), crack=(90.0, 800.0, 0.016), crack_gain=1.1)
    exhaust = bp(noise(r), 70, 420) * (0.25 + 0.75 * env) * 1.1
    fan = bp(noise(r), 500, 3000) * 0.08 * cycles([(2, -0.35)])
    return finish(0.4 * det + brd + exhaust + fan)


def tracked_move_a():
    """'Pulling': the same V12 under load, 105 Hz firing, its harder pulses
    driving a broad intake roar; a slow surge as the driver works the
    throttle. The pitch is still under 150 Hz; the weight is in the roar."""
    r = gen(0xE103)
    det, brd, env = engine(r, 105.0, cylinders=12, imbalance=0.15, wander=[(2, 0.025, 0.5), (5, 0.010, 1.2)],
                           jitter=0.015, thump=(70.0, 0.016), crack=(140.0, 1200.0, 0.008), crack_gain=0.9)
    surge = cycles([(2, 0.18), (5, -0.06)])
    roar = bp(noise(r), 160, 900) * (0.6 + 0.4 * env) * 0.5 * surge
    exhaust = bp(noise(r), 60, 380) * (0.4 + 0.6 * env) * 0.6 * surge
    return finish((0.6 * det + brd) * surge + roar + exhaust)


def tracked_move_b():
    """'Low gear, labouring': 80 Hz firing, heavy and uneven -- big pulse-to-
    pulse spread, a lug twice a second as the load comes on and off -- with a
    darker roar. A tank climbing, not cruising."""
    r = gen(0xE104)
    det, brd, env = engine(r, 80.0, cylinders=12, imbalance=0.28, wander=[(16, 0.020, 0.0), (3, 0.015, 2.0)],
                           jitter=0.020, thump=(62.0, 0.022), crack=(110.0, 1000.0, 0.011), crack_gain=1.0,
                           amp_jitter=0.2)
    lug = cycles([(16, 0.22), (3, -0.08)])
    roar = bp(noise(r), 130, 800) * (0.5 + 0.5 * env) * 0.6 * lug
    exhaust = bp(noise(r), 50, 320) * (0.3 + 0.7 * env) * 0.7 * lug
    return finish((0.45 * det + brd) * lug + roar + exhaust)


# --- the track (tracked vehicles only, under the moving engine) ----------------
# A separate layer, so the game can scale it with speed (silent at rest) while
# the engine idles on. Strikes are noise through resonances that move per hit:
# metal, never a bell.

def track_clank_a():
    """'Links on the sprocket': 11 link strikes a second, every fourth one a
    road wheel landing on a pin (heavier, lower), over the rumble of the road
    wheels on the ground. Dry and mechanical."""
    r = gen(0xE105)
    times = train(r, 11.0, wander=[(2, 0.03, 0.0)], jitter=0.04, multiple=4)
    out = np.zeros(LOOP_N)
    for m, at in enumerate(times):
        heavy = m % 4 == 0
        a = (1.0 if heavy else 0.65) * r.uniform(0.75, 1.15)
        centres = [(520, 1.0), (1350, 0.6), (2900, 0.3)] if heavy else [(900, 1.0), (2300, 0.5), (4100, 0.25)]
        place(out, at, a * resonant_hit(r, 0.08, centres, q=3.0, decay=0.018 if heavy else 0.011, spread=0.18))
        place(out, at, a * 0.6 * burst(r, 0.05, 60, 220, 0.02))
    rumble = bp(noise(r), 35, 160) * 0.5 * cycles([(3, 0.2)])
    grind = bp(noise(r), 250, 900, order=1) * 0.12
    return finish(out + rumble + grind, LAYER_LUFS)


def track_clank_b():
    """'Slack track': two tracks a beat apart (15 and 14 strikes a second),
    lighter, rattling links with a high jingle of pins, over a softer rumble.
    Busier and thinner than A: lighter armour, or a faster pace."""
    r = gen(0xE106)
    out = np.zeros(LOOP_N)
    for f, pan_gain in ((15.0, 1.0), (14.0, 0.8)):
        for at in train(r, f, wander=[(3, 0.02, 1.0)], jitter=0.05):
            a = pan_gain * r.uniform(0.7, 1.2)
            place(out, at, 0.6 * a * resonant_hit(r, 0.06, [(1100, 1.0), (2700, 0.6), (5200, 0.3)],
                                                  q=2.5, decay=0.009, spread=0.22))
    ticks = np.zeros(LOOP_N)
    for at in train(r, 37.0, jitter=0.35):
        place(ticks, at, (0.2 + 0.2 * r.random()) * burst(r, 0.012, 3000, 9000, 0.0025))
    rumble = bp(noise(r), 40, 180) * 0.35
    return finish(out + ticks + rumble, LAYER_LUFS)


# --- wheeled (jeep, technical, Shachaf) ----------------------------------------
# A smaller engine: a lighter body, a higher idle note -- still under 150 Hz --
# and no track. Moving, the road and the tyres carry as much as the engine.

def wheeled_idle_a():
    """'Petrol four at idle': 800 rpm, 27 Hz firing, smooth and light, a
    tailpipe puttering with it, the tick of the valve train over it."""
    r = gen(0xE107)
    det, brd, env = engine(r, 27.0, cylinders=4, imbalance=0.10, wander=[(4, 0.012, 0.0)],
                           jitter=0.010, thump=(85.0, 0.018), crack=(180.0, 1800.0, 0.007), crack_gain=1.0)
    ticks = np.zeros(LOOP_N)
    for at in train(r, 54.0, jitter=0.03):
        place(ticks, at, (0.12 + 0.06 * r.random()) * burst(r, 0.01, 2500, 7000, 0.0018))
    exhaust = bp(noise(r), 120, 700) * (0.2 + 0.8 * env) * 0.75
    return finish(0.45 * det + brd + ticks + exhaust)


def wheeled_idle_b():
    """'Diesel clatter': a four-cylinder diesel at 750 rpm (the technical's
    pickup), 25 Hz firing with the hard knock of injection on every pulse --
    the rattle a Hilux makes at a checkpoint."""
    r = gen(0xE108)
    det, brd, env = engine(r, 25.0, cylinders=4, imbalance=0.18, wander=[(3, 0.015, 0.8)],
                           jitter=0.014, thump=(72.0, 0.022), crack=(200.0, 1400.0, 0.008), crack_gain=0.9)
    knock = np.zeros(LOOP_N)
    for at in train(r, 25.0, wander=[(3, 0.015, 0.8)], jitter=0.014, multiple=4):
        place(knock, at + SR * 0.004, r.uniform(0.3, 0.5) * burst(r, 0.02, 1200, 5000, 0.004))
    exhaust = bp(noise(r), 100, 600) * (0.25 + 0.75 * env) * 0.75
    return finish(0.45 * det + brd + knock + exhaust)


def wheeled_move_a():
    """'Cruise': 70 Hz firing at a steady road speed, tyre roar and a little
    wind round the cab. Smooth, level, a car-sized engine."""
    r = gen(0xE109)
    det, brd, env = engine(r, 70.0, cylinders=4, imbalance=0.08, wander=[(2, 0.015, 0.0), (5, 0.006, 1.4)],
                           jitter=0.012, thump=(95.0, 0.014), crack=(200.0, 1800.0, 0.006), crack_gain=0.8)
    exhaust = bp(noise(r), 100, 600) * (0.4 + 0.6 * env) * 0.4
    tyres = bp(noise(r), 90, 700) * 0.4 * cycles([(3, 0.08)])
    wind = bp(noise(r), 600, 3000) * 0.05 * cycles([(2, -0.25)])
    return finish(0.6 * det + brd + exhaust + tyres + wind)


def wheeled_move_b():
    """'Off the road': 55 Hz firing under load, on gravel -- a dense crunch
    under the tyres and the suspension knocking over ruts four times a loop."""
    r = gen(0xE10A)
    det, brd, env = engine(r, 55.0, cylinders=4, imbalance=0.14, wander=[(4, 0.03, 0.6)],
                           jitter=0.018, thump=(80.0, 0.02), crack=(160.0, 1500.0, 0.008), crack_gain=0.9,
                           amp_jitter=0.18)
    gravel = np.zeros(LOOP_N)
    for at in train(r, 140.0, jitter=0.45):
        place(gravel, at, (0.04 + 0.08 * r.random()) * burst(r, 0.015, 1500, 6000, 0.003))
    thumps = np.zeros(LOOP_N)
    for c in (0.9, 3.1, 5.0, 6.8):
        place(thumps, c * SR, (0.8 + 0.2 * r.random()) * burst(r, 0.25, 40, 200, 0.06))
    exhaust = bp(noise(r), 90, 550) * (0.35 + 0.65 * env) * 0.5
    tyres = bp(noise(r), 70, 600) * 0.35
    return finish(0.6 * det + brd + gravel + thumps + exhaust + tyres)


# --- rotor (Peten) ---------------------------------------------------------------
# A gunship, not a drone: blade slap from the main rotor, the tail rotor's
# faster buzz and the turbines as BROADBAND hiss. A turbine's whine is exactly
# the narrow-band tone the lead switched the ambience off for, so it is left out.

def rotor_a():
    """'Blade slap': a four-blade main rotor (19 passes a second) slapping,
    with the tail rotor's buzz over it and turbine hiss on top. Close by."""
    r = gen(0xE10B)
    slap = np.zeros(LOOP_N)
    for at in train(r, 19.25, jitter=0.01):
        a = 1 + 0.08 * r.standard_normal()
        place(slap, at, a * burst(r, 0.06, 70, 900, 0.016))
        place(slap, at, a * 0.8 * kick(r, 0.08, 38.0, 0.03, detune=0.03))
    tail = np.zeros(LOOP_N)
    for at in train(r, 93.5, jitter=0.03):
        place(tail, at, (0.25 + 0.05 * r.standard_normal()) * burst(r, 0.012, 300, 1500, 0.003))
    hiss = hp(noise(r), 2500) * 0.035 * cycles([(2, 0.1)])
    wash = lp(noise(r), 180) * 0.3
    return finish(lp(slap, 1800) + tail + hiss + wash)


def rotor_b():
    """'Overhead, further off': the same rotor heard from a few hundred
    metres -- the slap rounded to a beat, the highs gone, more of the air it
    moves, a slow swell as the wind carries it."""
    r = gen(0xE10C)
    slap = np.zeros(LOOP_N)
    for at in train(r, 19.25, jitter=0.012):
        place(slap, at, (1 + 0.1 * r.standard_normal()) * burst(r, 0.08, 50, 500, 0.024))
    tail = np.zeros(LOOP_N)
    for at in train(r, 93.5, jitter=0.03):
        place(tail, at, (0.15 + 0.04 * r.standard_normal()) * burst(r, 0.012, 250, 900, 0.003))
    swell = cycles([(1, 0.15), (3, -0.05)])
    wash = lp(noise(r), 140) * 0.45
    return finish(lp(slap + tail, 1100) * swell + wash * swell)


# family, file stem, function, file loudness. The family is what the game will
# map a vehicle to later, in data/audio.json -- never by a new unit-JSON field.
CANDIDATES = [
    ("tracked heavy, idle", "tracked_idle_a_v12", tracked_idle_a, FILE_LUFS),
    ("tracked heavy, idle", "tracked_idle_b_lumpy", tracked_idle_b, FILE_LUFS),
    ("tracked heavy, moving", "tracked_move_a_pulling", tracked_move_a, FILE_LUFS),
    ("tracked heavy, moving", "tracked_move_b_low_gear", tracked_move_b, FILE_LUFS),
    ("track clank layer", "track_clank_a_sprocket", track_clank_a, LAYER_LUFS),
    ("track clank layer", "track_clank_b_slack", track_clank_b, LAYER_LUFS),
    ("wheeled, idle", "wheeled_idle_a_petrol", wheeled_idle_a, FILE_LUFS),
    ("wheeled, idle", "wheeled_idle_b_diesel", wheeled_idle_b, FILE_LUFS),
    ("wheeled, moving", "wheeled_move_a_cruise", wheeled_move_a, FILE_LUFS),
    ("wheeled, moving", "wheeled_move_b_gravel", wheeled_move_b, FILE_LUFS),
    ("rotor (optional)", "rotor/rotor_a_blade_slap", rotor_a, FILE_LUFS),
    ("rotor (optional)", "rotor/rotor_b_overhead", rotor_b, FILE_LUFS),
]


# --- measurement ------------------------------------------------------------------

def k_weighting(fs):
    """BS.1770-4's K-weighting as two biquads, derived for any rate from the
    analogue prototype by the bilinear transform (the published table is 48 kHz
    only) -- the derivation libebur128, and so ffmpeg's ebur128, uses: a high
    shelf (+4 dB, 1682 Hz) and the RLB high-pass (38 Hz)."""
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / fs)
    vh = 10 ** (g / 20)
    vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0,
             1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    f0, q = 38.13547087613982, 0.5003270373253953
    k = np.tan(np.pi * f0 / fs)
    a0 = 1 + k / q + k * k
    rlb = [1.0, -2.0, 1.0, 1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    return np.array([shelf, rlb])


def lufs(x, fs=SR):
    """Integrated loudness, BS.1770-4, mono."""
    y = signal.sosfilt(k_weighting(fs), x)
    block, hop = int(0.4 * fs), int(0.1 * fs)
    sq = np.concatenate([[0.0], np.cumsum(y * y)])
    starts = np.arange(0, len(y) - block + 1, hop)
    z = (sq[starts + block] - sq[starts]) / block
    with np.errstate(divide="ignore"):
        lk = -0.691 + 10 * np.log10(z)
    z = z[lk > -70.0]
    rel = -0.691 + 10 * np.log10(np.mean(z)) - 10.0
    with np.errstate(divide="ignore"):
        z = z[-0.691 + 10 * np.log10(z) > rel]
    return float(-0.691 + 10 * np.log10(np.mean(z)))


def true_peak(x):
    """dBTP: 4x polyphase oversampling. Taken on the loop as it plays, wrapped,
    so an over at the seam is not missed."""
    k = 64
    up = signal.resample_poly(np.concatenate([x[-k:], x, x[:k]]), 4, 1)[4 * k:-4 * k]
    return float(20 * np.log10(np.max(np.abs(up))))


def _bands(seg):
    """Third-octave band DENSITIES (dB), 50 Hz to 12 kHz, Welch-averaged over
    the window: the spectral shape, not where the pulses fall in it. Density,
    not band sum: a sum grows with the band's width and lends every signal the
    same slope, which would make any two spectra correlate."""
    f, p = signal.welch(seg, fs=SR, window="hann", nperseg=4096, noverlap=2048)
    edges = 50.0 * 2 ** (np.arange(0, 3 * np.log2(12000 / 50) + 1) / 3)
    lev = [np.mean(p[(f >= lo) & (f < hi)]) for lo, hi in zip(edges[:-1], edges[1:])]
    return 10 * np.log10(np.asarray(lev) + 1e-20)


def seam(x):
    """The loop's seam, end to start, as it plays.
    corr: the correlation of the last and first SEAM_W_S's spectral shape, and
    the same reading at 64 ordinary junctions inside the file for scale (the
    file does not set its own bar; it shows what 'ordinary' reads). It assumes
    a shaped spectrum, which every engine loop has: a flat one has no shape to
    correlate. click: the sample step across the wrap against the largest step
    anywhere inside the file. step, gap: tools/validate_audio.py's own seam
    check (250 ms level step; a codec gap)."""
    w = int(SEAM_W_S * SR)
    at_seam = float(np.corrcoef(_bands(x[-w:]), _bands(x[:w]))[0, 1])
    inside = [np.corrcoef(_bands(x[j - w:j]), _bands(x[j:j + w]))[0, 1]
              for j in np.linspace(w, len(x) - w, 64).astype(int)]
    click = float(abs(x[0] - x[-1]) / np.max(np.abs(np.diff(x))))
    level, gap = va.seam_metrics([float(v) for v in x], SR)
    return {"corr": at_seam, "inside_med": float(np.median(inside)), "inside_min": float(np.min(inside)),
            "click": click, "step": level, "gap": gap}


def seam_ok(s):
    return (s["corr"] >= SEAM_MIN_CORR and s["click"] <= 1.0
            and s["step"] <= va.AMB_SEAM_LEVEL_DB and s["gap"] >= -va.AMB_SEAM_GAP_DB)


def whine(x, loop=True, band_hz=WHINE_BAND_HZ):
    """The whine detector. A STFT (Hann, WHINE_NPERSEG, hop WHINE_HOP); each
    bin's level against the MEDIAN of the +-15 bins around it; a cell is a
    candidate tone when it stands WHINE_PROMINENCE_DB or more above that median,
    sits inside `band_hz` (the gate: WHINE_BAND_HZ) and is within
    WHINE_AUDIBLE_DB of the file's loudest in-band cell. A tone is allowed to drift one bin and to dip for
    WHINE_GAP_FRAMES; it is a whine when one bin stays flagged WHINE_MIN_S or
    longer. A loop is read wrapped, so a tone across the seam is one tone.
    Returns the verdict, the held tone's bin (Hz), how long it held (s), its
    median prominence (dB) and the mask of every cell in a whine-long run.""" 
    xs = np.concatenate([x, x[:WHINE_NPERSEG]]) if loop else x
    f, t, z = signal.stft(xs, fs=SR, window="hann", nperseg=WHINE_NPERSEG, noverlap=WHINE_NPERSEG - WHINE_HOP,
                          boundary=None, padded=False)
    p = 10 * np.log10(np.abs(z) ** 2 + 1e-20)
    med = ndimage.median_filter(p, size=(WHINE_MEDIAN_BINS, 1), mode="nearest")
    prom = p - med
    band = (f >= band_hz[0]) & (f <= band_hz[1])
    loudest = np.max(p[band])
    flag = (prom >= WHINE_PROMINENCE_DB) & band[:, None] & (p >= loudest - WHINE_AUDIBLE_DB)
    flag = ndimage.binary_dilation(flag, structure=np.ones((3, 1), bool))
    flag = ndimage.binary_closing(flag, structure=np.ones((1, WHINE_GAP_FRAMES + 1), bool)) | flag
    frames = flag.shape[1]
    wrapped = np.concatenate([flag, flag], axis=1) if loop else flag
    need = int(np.ceil(WHINE_MIN_S * SR / WHINE_HOP))
    held = np.zeros_like(flag)
    # The longest-held bin; among equally long ones the loudest, so a tone is
    # named by its own bin and not by the window's skirt beside it. `held`
    # keeps every cell of every run long enough to be a whine (drawn in cyan).
    best, best_bin = (0, -np.inf), 0
    for k in np.nonzero(flag.any(axis=1))[0]:
        row = np.concatenate([[False], wrapped[k], [False]]).astype(np.int8)
        d = np.diff(row)
        ups, downs = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
        runs = downs - ups
        for u, n in zip(ups, runs):
            if n >= need:
                held[k, np.arange(u, u + min(n, frames)) % frames] = True
        key = (min(int(runs.max()), frames), float(np.mean(p[k][flag[k]])))
        if key > best:
            best, best_bin = key, k
    secs = best[0] * WHINE_HOP / SR
    on = flag[best_bin]
    level = float(np.median(prom[best_bin][on])) if on.any() else 0.0
    hz = float(f[best_bin])
    if on.any() and 0 < best_bin < len(f) - 1:
        # Name the tone between bins (a bin is 10.8 Hz wide): the vertex of a
        # parabola through its bin and the two beside it, in dB, over the
        # frames it held -- the usual peak interpolation for a Hann window.
        a_, b_, c_ = 10 * np.log10(np.mean(np.abs(z[best_bin - 1:best_bin + 2][:, on]) ** 2, axis=1) + 1e-20)
        d = 0.5 * (a_ - c_) / (a_ - 2 * b_ + c_) if a_ - 2 * b_ + c_ < 0 else 0.0
        hz = float(f[best_bin] + np.clip(d, -1.0, 1.0) * (f[1] - f[0]))
    return {"whine": secs >= WHINE_MIN_S, "hz": hz, "secs": secs, "prom": level,
            "held": held, "f": f, "t": t}


def ffmpeg_reading(path):
    """ffmpeg's own ebur128 reading of the file (the meter validate:audio uses),
    or None when ffmpeg is not on PATH."""
    got = va.measure_bed(path)
    return None if got is None else (got["integrated"], got["true_peak"])


# --- self-tests: every check is shown an input that must make it fail ---------

def _sine(f, secs, dbfs):
    n = int(secs * SR)
    return 10 ** (dbfs / 20) * np.sin(2 * np.pi * f * np.arange(n) / SR)


def _pink(r, n):
    w = np.fft.rfft(r.standard_normal(n))
    fr = np.fft.rfftfreq(n, 1 / SR)
    w[1:] /= np.sqrt(fr[1:])
    w[0] = 0
    x = np.fft.irfft(w, n)
    return x / np.std(x) * 0.1


def selftest():
    r = np.random.default_rng(0x5E1F)
    results = []

    # The K-weighting at 48 kHz against BS.1770-4's own table.
    itu = np.array([[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
                    [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])
    err = float(np.max(np.abs(k_weighting(48000) - itu)))
    results.append(("K-weighting = BS.1770-4 table at 48 kHz", err < 1e-6, f"max coefficient error {err:.1e}"))
    # BS.1770's own reference: a 997 Hz sine at 0 dBFS in one channel reads -3.01 LKFS, so -20 dBFS reads -23.01.
    lu = lufs(_sine(997.0, 5.0, -20.0))
    results.append(("997 Hz sine at -20 dBFS meters -23.01 LUFS", abs(lu + 23.01) < 0.05, f"{lu:.2f} LUFS"))
    # The relative gate: 5 s at -20 dBFS then 5 s at -40 dBFS. The quiet half
    # sits 20 LU under, past the -10 LU gate, so it is not counted; the three
    # 400 ms blocks that straddle the step are, which is -23.14 (ffmpeg's
    # ebur128 reads the same file -23.1). Ungated, the two halves read -25.98.
    lu = lufs(np.concatenate([_sine(997.0, 5.0, -20.0), _sine(997.0, 5.0, -40.0)]))
    results.append(("same, then 5 s at -40 dBFS: gated out, -23.14", abs(lu + 23.14) < 0.05, f"{lu:.2f} LUFS"))

    # True peak: a sine at a quarter of the rate, sampled 45 degrees off its
    # crest, never lands a sample above 0.707 -- yet the wave peaks at 1.0.
    n = np.arange(SR)
    x = np.sin(2 * np.pi * (SR / 4) * n / SR + np.pi / 4)
    tp, sp = true_peak(x), 20 * np.log10(np.max(np.abs(x)))
    results.append(("fs/4 sine, 45 deg off crest: 0.0 dBTP", abs(tp) < 0.1, f"{tp:+.2f} dBTP (sample peak {sp:+.2f})"))

    # The whine detector: the brief's falsification, then the two ways it could over-call.
    tone = _sine(440.0, 3.0, -12.0)
    w = whine(tone, loop=False)
    results.append(("pure 440 Hz tone, 3 s: WHINE", w["whine"] and abs(w["hz"] - 440) < 11,
                    f"{w['hz']:.0f} Hz for {w['secs']:.2f} s, {w['prom']:.0f} dB over its neighbours"))
    pink = _pink(r, 3 * SR)
    w = whine(pink + _sine(440.0, 3.0, -30.0), loop=False)
    results.append(("440 Hz 3 s under pink noise: WHINE", w["whine"] and abs(w["hz"] - 440) < 11,
                    f"{w['hz']:.0f} Hz for {w['secs']:.2f} s, {w['prom']:.0f} dB"))
    short = np.zeros(3 * SR)
    short[SR:SR + int(0.4 * SR)] = _sine(440.0, 0.4, -12.0)
    w = whine(pink + short, loop=False)
    results.append(("440 Hz for 0.4 s in pink noise: clean", not w["whine"], f"longest {w['secs']:.2f} s"))
    w = whine(r.standard_normal(3 * SR) * 0.1, loop=False)
    results.append(("white noise: clean", not w["whine"], f"longest {w['secs']:.2f} s"))
    w = whine(pink, loop=False)
    results.append(("pink noise: clean", not w["whine"], f"longest {w['secs']:.2f} s"))

    # The seam: a loop that starts dark and ends bright, and one whose ends do
    # not meet (a slow ramp under it), must each fail it; a periodic one passes.
    dark, bright = lp(noise(r), 300)[: LOOP_N // 2], hp(noise(r), 3000)[: LOOP_N // 2]
    bright_dark = np.concatenate([dark / np.std(dark), bright / np.std(bright)]) * 0.1  # same level: only shape differs
    s = seam(bright_dark)
    results.append(("loop that starts dark and ends bright: seam FAILS", not seam_ok(s),
                    f"corr {s['corr']:.2f}, step {s['step']:.2f} dB"))
    base = lp(noise(r), 800)
    s = seam(base + np.linspace(-1, 1, LOOP_N) * np.std(base))
    results.append(("loop whose ends do not meet: seam FAILS", not seam_ok(s), f"click {s['click']:.1f}x"))
    s = seam(base)
    results.append(("periodic noise loop: seam passes", seam_ok(s),
                    f"corr {s['corr']:.3f}, click {s['click']:.2f}x, step {s['step']:.2f} dB"))

    print("self-tests (each a constructed input the check must call right):")
    for name, ok, note in results:
        print(f"  {'ok  ' if ok else 'FAIL'} {name:52s} {note}")
    bad = [n for n, ok, _ in results if not ok]
    assert not bad, f"self-test failed: {bad}"
    return results


# --- output ---------------------------------------------------------------------------

def write_wav(path, x):
    pcm16 = np.round(np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm16.tobytes())


def read_wav(path):
    with wave.open(path) as w:
        assert w.getsampwidth() == 2
        ch = w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32768
        return (x.reshape(-1, ch).mean(axis=1) if ch > 1 else x), w.getframerate()


def spectrogram_png(path, x, title, verdict, wh):
    """Log-frequency spectrogram, 20 Hz-10 kHz, with the whine band's floor and
    every cell the detector flagged."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    f, t, s = signal.spectrogram(x, fs=SR, window="hann", nperseg=4096, noverlap=3072)
    keep = (f >= 20) & (f <= 10000)
    fig, ax = plt.subplots(figsize=(8, 2.9))
    db = 10 * np.log10(s[keep] + 1e-14)
    ax.pcolormesh(t, f[keep], db, shading="auto", cmap="magma", vmin=db.max() - 80, vmax=db.max())
    ax.set_yscale("log")
    ax.set_ylim(20, 10000)
    ax.axhline(WHINE_BAND_HZ[0], color="white", lw=0.8, ls="--")
    ax.text(t[-1], WHINE_BAND_HZ[0] * 1.06, "whine band above ", color="white", fontsize=7, ha="right", va="bottom")
    ff, tt = np.nonzero(wh["held"])
    if len(ff):
        ax.scatter(wh["t"][tt], wh["f"][ff], s=3, c="#2ee6d6", marker="s", linewidths=0)
    ax.set_xlim(0, len(x) / SR)
    ax.set_xlabel("s", fontsize=8)
    ax.set_ylabel("Hz", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.set_title(f"{title}   {verdict}", fontsize=8, loc="left")
    fig.tight_layout()
    fig.savefig(path, dpi=100, metadata={"Software": None})
    plt.close(fig)


LOW_BAND_HZ = (30.0, WHINE_BAND_HZ[0])


def tone_text(wh):
    return (f"WHINE {wh['hz']:.0f} Hz held {wh['secs']:.1f} s, +{wh['prom']:.0f} dB" if wh["whine"]
            else f"no whine (longest tone {wh['secs']:.2f} s)")


def low_text(lo):
    """The pitched note under the whine band: not gated -- it is the engine's
    own rumble -- but printed, because the town bed's 50 Hz generator was the
    one sustained tone in the beds the lead switched off."""
    return (f"low note {lo['hz']:.0f} Hz held {lo['secs']:.1f} s, +{lo['prom']:.0f} dB" if lo["secs"] > 0
            else "no steady low note")


def at_rate(x, rate):
    """The loop as it sounds played `rate` times faster (what playbackRate does):
    resampled to len / rate samples and heard at SR. RATE_MAX must divide the
    loop exactly, so the result is still a whole loop."""
    up, down = 5, round(5 * rate)
    assert abs(up * rate - down) < 1e-9 and LOOP_N % down == 0
    return signal.resample_poly(np.concatenate([x[-512:], x, x[:512]]), up, down)[512 * up // down:][: LOOP_N * up // down]


def measure(path, x, ff, target):
    lu, tp = lufs(x), true_peak(x)
    sm = seam(x)
    wh = whine(x)
    fast = whine(at_rate(x, RATE_MAX))
    lo = whine(x, band_hz=LOW_BAND_HZ)
    ffm = ff(path) if ff else None
    checks = {
        "level": abs(lu - target) <= 0.5,
        "peak": max(tp, ffm[1] if ffm else tp) <= MAX_TRUE_PEAK_DBTP,
        "seam": seam_ok(sm),
        "whine": not wh["whine"],
        f"whine at {RATE_MAX:g}x": not fast["whine"],
    }
    fails = [k for k, ok in checks.items() if not ok]
    return {"lufs": lu, "tp": tp, "ffmpeg": ffm, "seam": sm, "whine": wh, "fast": fast, "low": lo,
            "checks": checks,
            "verdict": "PASS" if not fails else "FAIL: " + ", ".join(fails)}


def main():
    tests = selftest()
    ff = ffmpeg_reading if shutil.which("ffmpeg") and shutil.which("ffprobe") else None
    if ff is None:
        print("ffmpeg/ffprobe not on PATH: the ebur128 cross-check is skipped (named, not passed)")
    rows = []
    print()
    print(f"{'file':26s} {'LUFS':>6s} {'ffmpeg':>6s} {'dBTP':>5s} {'ffmpeg':>6s} {'seam':>5s} {'inside':>6s} "
          f"{'click':>5s} {'step':>4s}  verdict; whine check; low note (not gated)")
    for family, stem, fn, target in CANDIDATES:
        x = fn()
        wav = os.path.join(HERE, stem + ".wav")
        write_wav(wav, x)
        x, _ = read_wav(wav)              # measure what was written, quantised
        m = measure(wav, x, ff, target)
        if m["ffmpeg"]:
            assert abs(m["ffmpeg"][0] - m["lufs"]) <= 0.3, f"{stem}: this meter and ffmpeg disagree on loudness"
            assert abs(m["ffmpeg"][1] - m["tp"]) <= 0.5, f"{stem}: this meter and ffmpeg disagree on true peak"
        spectrogram_png(os.path.join(HERE, stem + ".png"), x, os.path.basename(stem),
                        f"{m['verdict']}; {tone_text(m['whine'])}", m["whine"])
        rows.append((family, stem, fn.__doc__, m))
        e = m["ffmpeg"] or (float("nan"), float("nan"))
        sm = m["seam"]
        print(f"{os.path.basename(stem):26s} {m['lufs']:6.1f} {e[0]:6.1f} {m['tp']:5.1f} {e[1]:6.1f} "
              f"{sm['corr']:5.3f} {sm['inside_med']:6.3f} {sm['click']:5.2f} {sm['step']:4.2f}  "
              f"{m['verdict']}; {tone_text(m['whine'])}; at {RATE_MAX:g}x {tone_text(m['fast'])}; "
              f"{low_text(m['low'])}")

    print()
    print("calibration: the ambience beds the lead switched off as 'whining' (#483), same detector")
    calib = []
    amb_dir = os.path.join(ROOT, "docs", "polish", "audio", "ambience")
    for name in ("amb_open", "amb_town", "amb_ridge"):
        path = os.path.join(amb_dir, name + ".wav")
        if not os.path.exists(path):
            print(f"  {name}: not on disk, skipped")
            continue
        x, rate = read_wav(path)
        assert rate == SR
        wh, lo = whine(x), whine(x, band_hz=LOW_BAND_HZ)
        calib.append((name, wh, lo))
        print(f"  {name:10s} {tone_text(wh)}; {low_text(lo)}")

    write_page(rows, calib, tests)
    failed = [stem for _f, stem, _d, m in rows if m["verdict"] != "PASS"]
    print()
    print(f"{len(rows) - len(failed)} of {len(rows)} candidates pass level, peak, seam and whine"
          + (f"; FAIL: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


# --- the listening page ------------------------------------------------------------------

PAGE_HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engine Loop Candidates</title>
<style>
:root { --bg: #f6f4ef; --card: #ffffff; --ink: #1f1d1a; --muted: #6b665d; --line: #dcd7cc;
        --good: #2f6b3a; --bad: #a3322a; --accent: #7a5c1e; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #171614; --card: #211f1c; --ink: #ece8df; --muted: #a39d92; --line: #36332e;
          --good: #7cc48a; --bad: #e9897f; --accent: #d9b56a; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
       font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 32px 0 8px; }
p { margin: 6px 0; }
.muted { color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
.card h3 { font-size: 16px; margin: 0 0 2px; }
.card .family { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); }
audio { width: 100%; margin: 8px 0 6px; }
img { width: 100%; height: auto; border-radius: 6px; display: block; }
.verdict { font-variant-numeric: tabular-nums; font-size: 13px; margin-top: 6px; }
.pass { color: var(--good); font-weight: 600; }
.fail { color: var(--bad); font-weight: 600; }
table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.scroll { overflow-x: auto; }
code { font-size: 13px; }
</style>
</head>
<body>
<main>
"""


def write_page(rows, calib, tests):
    e = html.escape

    def anchor(stem):
        return os.path.basename(stem)

    out = [PAGE_HEAD]
    out.append("<h1>Engine loop candidates</h1>")
    out.append("<p>GH-35: vehicles are silent. Two candidates for each engine sound, for your ear. Nothing here is "
               "wired into the game; the one you pick moves into <code>gen_audio.py</code> unchanged.</p>")
    out.append('<p class="muted">Each file is a seamless 8 s loop, so let it play round a few times (the players '
               "loop). A browser's <code>&lt;audio loop&gt;</code> can leave a hair of a gap at the wrap; the game "
               "would loop it sample-exact. Engines and rotors are normalised to "
               f"{FILE_LUFS:.0f} LUFS and the track layer to {LAYER_LUFS:.0f}, so you compare character, not "
               "volume. In the game they would sit about 12 LU under the combat sound and come and go with speed, "
               "distance and the four-vehicle cap. Synthesised, CC0, byte-identical on every run of "
               "<code>engine_candidates.py</code>.</p>")
    out.append('<div class="card"><h3>What to listen for</h3>'
               "<p>You switched the ambience off for whining (#483). The check on this page looks for the kind of "
               "whine that can be measured: a narrow tone that holds. It finds none in the three beds above 200 Hz "
               "(see the bottom of the page). The one steady tone in them is the town bed's generator: a 50 Hz "
               "hum and the 38 Hz chug beside it, +11 dB, all the way round the loop. So if it was that hum, listen "
               "hard to the low note here: every engine has one, steadier and stronger (+20 to +29 dB), because it "
               "is the engine. If it was the wind rising and falling, two candidates carry a slow swell (tracked "
               "idle B's fan, wheeled moving A's wind).</p></div>")
    out.append('<h2>Verdicts</h2><div class="scroll"><table><tr><th>Candidate</th><th>Family</th><th>LUFS</th>'
               f"<th>True peak</th><th>Seam</th><th>Whine check, 1x and {RATE_MAX:g}x</th>"
               "<th>Low note (not gated)</th><th>Verdict</th></tr>")
    for family, stem, _doc, m in rows:
        cls = "pass" if m["verdict"] == "PASS" else "fail"
        out.append(f'<tr><td><a href="#{e(anchor(stem))}">{e(anchor(stem))}</a></td><td>{e(family)}</td>'
                   f"<td>{m['lufs']:.1f}</td><td>{m['tp']:.1f} dBTP</td><td>{m['seam']['corr']:.3f}</td>"
                   f"<td>{e(tone_text(m['whine']))}; {e(tone_text(m['fast']))}</td><td>{e(low_text(m['low']))}</td>"
                   f'<td class="{cls}">{e(m["verdict"])}</td></tr>')
    out.append("</table></div>")
    family = None
    for fam, stem, doc, m in rows:
        if fam != family:
            out.append(f"<h2>{e(fam[0].upper() + fam[1:])}</h2>")
            family = fam
        cls = "pass" if m["verdict"] == "PASS" else "fail"
        sm = m["seam"]
        title, _, rest = " ".join(doc.split()).partition(":")
        out.append(f'<section class="card" id="{e(anchor(stem))}"><div class="family">{e(fam)}</div>'
                   f"<h3>{e(anchor(stem))} &mdash; {e(title.strip().strip(chr(39)))}</h3>"
                   f"<p>{e(rest.strip())}</p>"
                   f'<audio controls loop preload="none" src="{e(stem)}.wav"></audio>'
                   f'<img src="{e(stem)}.png" alt="Spectrogram of {e(anchor(stem))}" loading="lazy">'
                   f'<p class="verdict"><span class="{cls}">{e(m["verdict"])}</span> &middot; '
                   f"{m['lufs']:.1f} LUFS &middot; true peak {m['tp']:.1f} dBTP &middot; seam {sm['corr']:.3f} "
                   f"(an ordinary junction inside the file reads {sm['inside_med']:.3f}) &middot; "
                   f"{e(tone_text(m['whine']))}; at {RATE_MAX:g}x {e(tone_text(m['fast']))} &middot; "
                   f"{e(low_text(m['low']))}</p></section>")
    out.append("<h2>How it was checked</h2>")
    out.append(f"<p><b>Whine.</b> A spectral peak {WHINE_PROMINENCE_DB:.0f} dB or more above the median of the "
               f"&plusmn;161 Hz around it, between {WHINE_BAND_HZ[0]:.0f} Hz and {WHINE_BAND_HZ[1] / 1000:.0f} kHz, "
               f"that holds {WHINE_MIN_S:.0f} s or longer, read at normal speed and at {RATE_MAX:g}x (the fastest "
               f"the game would play a moving loop). Under {WHINE_BAND_HZ[0]:.0f} Hz a steady pitch is the engine's "
               "own note, so every candidate keeps its pitched part there and builds everything above it from "
               "noise; that low note is printed, not gated. On a spectrogram the dashed line is the band's floor "
               "and a held tone would be drawn in cyan. None is.</p>")
    out.append("<p><b>Level.</b> Integrated loudness by ITU-R BS.1770-4, measured here and checked against "
               "ffmpeg's own meter on every file; true peak at 4x oversampling. <b>Seam.</b> The spectral shape of "
               "the last and first 250 ms must correlate 0.9 or better, the sample step across the wrap must be no "
               "bigger than any step inside the file, and the 250 ms either side must sit within 2 dB "
               "(validate:audio's own bed check).</p>")
    out.append("<p>Each check was first shown an input built to fail it:</p><ul>")
    for name, ok, note in tests:
        out.append(f"<li>{e(name)}: {e(note)} {'&check;' if ok else '&cross;'}</li>")
    out.append("</ul>")
    out.append("<p>The same whine check on the three ambience beds you switched off (#483):</p><ul>")
    for name, wh, lo in calib:
        out.append(f'<li><a href="../ambience/{e(name)}.wav">{e(name)}</a>: {e(tone_text(wh))}; '
                   f"{e(low_text(lo))}</li>")
    out.append("</ul></main>\n</body>\n</html>\n")
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out))


if __name__ == "__main__":
    sys.exit(main())
