#!/usr/bin/env python3
"""
Roaring Lions -- procedural battle SFX and UI cue generator.

    python tools/gen_audio.py [--only=name,name,...] [-h | --help]

Synthesises the placeholder sound library offline and encodes it to OGG + M4A
(Safari) via ffmpeg. Everything here is generated from noise and envelopes, so
the project owns the output outright -- there is no third-party provenance to
audit, which is exactly the licensing problem that sinks most game audio.

`--only` restricts the run to the named sets (from SETS, UI_SETS or
STINGER_SETS) -- use it
for a UI cue so a run never touches the battle clips' RNG draws or re-encodes
their Ogg streams for nothing (a full run gives every clip a new random Ogg
stream serial, which rewrites all of them even when the samples are
unchanged).

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


# --- UI voices (garage uplift §3.5, §6) -------------------------------------
# Dry and RNG-free: a UI cue is "nowhere" (BattleAudio.playUi has no panner),
# and drawing nothing from RNG means generating these can never shift a battle
# clip's noise, and `--only` and a full run write the same samples.
UI_PEAK = 0.5   # -6 dBFS
UI_MAX_S = 0.25


def _at(n, start_s, voice):
    out = np.zeros(n)
    s = int(SR * start_s)
    out[s:s + len(voice)] = voice[: max(0, n - s)]
    return out


def ui_purchase(seed_shift=0.0):
    """A low clunk under a rising pair: a shop, not an alarm."""
    n = int(SR * 0.24)
    clunk = sine(n, 110, 70) * env(n, 0.002, 0.06, 4.0)
    m1, m2 = int(SR * 0.08), int(SR * 0.10)
    note1 = _at(n, 0.07, sine(m1, 330) * env(m1, 0.004, 0.07, 2.0))
    note2 = _at(n, 0.13, sine(m2, 494) * env(m2, 0.004, 0.09, 2.0))
    return norm(clunk + 0.6 * note1 + 0.6 * note2, UI_PEAK)


def ui_upgrade(seed_shift=0.0):
    """A ratchet (three pawl clicks, 30 ms apart), then the higher note."""
    n = int(SR * 0.24)
    m = int(SR * 0.012)
    click = np.sign(sine(m, 1800)) * env(m, 0.0005, 0.01, 6.0) * 0.5
    out = sum(_at(n, 0.03 * i, click) for i in range(3))
    k = int(SR * 0.13)
    out = out + _at(n, 0.10, sine(k, 880) * env(k, 0.004, 0.12, 2.0))
    return norm(out, UI_PEAK)


def _strike(n, partials, decay, power=3.0, attack=0.0008):
    """A struck steel part: inharmonic partials, each its own decay."""
    out = np.zeros(n)
    for f, a, dk in partials:
        out += a * sine(n, f) * env(n, attack, decay * dk, power)
    return out


def _pawl(ms=10, f=2200, gain=0.5):
    m = int(SR * ms / 1000)
    return np.sign(sine(m, f)) * env(m, 0.0004, ms / 1000, 6.0) * gain


def ui_kit_fitted(seed_shift=0.0):
    """Bolt-on (GH-238 plan 3, K10): an impact-wrench rattle of five pawl
    clicks 25 ms apart (2.6 -> 2.36 kHz, gain 0.35 -> 0.47), then at 150 ms a
    steel plate clank (inharmonic strike over a 120 -> 70 Hz thud). Played
    instead of ui_upgrade when the tier bought adds a part to a vehicle."""
    n = int(SR * 0.24)
    out = sum(_at(n, 0.012 + 0.025 * i, _pawl(8, 2600 - 60 * i, 0.35 + 0.03 * i)) for i in range(5))
    k = int(SR * 0.09)
    clank = _strike(k, [(420, 1.0, 1.0), (1130, 0.55, 0.7), (2090, 0.35, 0.5), (3310, 0.2, 0.35)], 0.09)
    thud = sine(k, 120, 70) * env(k, 0.001, 0.05, 4.0) * 0.8
    out = out + _at(n, 0.15, clank + thud)
    return norm(out, UI_PEAK)


# --- critical cues (polish pass F, docs/polish/audio-plan.md section 4) ------
# The lead's picks (6 Oct 2026): candidate A for every cue. Ported from
# docs/polish/audio/cue_candidates.py UNCHANGED -- the same blocks, the same
# numbers, the same per-cue seeds -- so each file matches the WAV the lead
# auditioned. The candidate script reseeded the module RNG and left it there;
# here a cue that draws noise borrows its own stream for the call and hands
# the battle stream back untouched (`_own_rng`), so generating a cue never
# shifts a battle clip's noise, and `--only` and a full run write the same
# samples.

# Length ceilings by tier (seconds). A UI tick must be over before the next
# click can land; an outcome stinger may take a breath, never a bar of music.
CUE_CEILING_S = {
    "ui": UI_MAX_S,   # confirm, deny, minor alert
    "cue": 0.8,       # objective new/complete/failed, important alert
    "major": 1.0,     # major alert
    "start": 1.5,     # mission start
    "stinger": 2.5,   # victory, defeat
}


class _own_rng:
    """Run a cue on its own fixed noise stream, then restore the battle one."""

    def __init__(self, seed):
        self.seed = seed

    def __enter__(self):
        global RNG
        self.saved = RNG
        RNG = np.random.default_rng(self.seed)

    def __exit__(self, *exc):
        global RNG
        RNG = self.saved
        return False


def _tone(dur, f0, f1=None, attack=0.002, power=2.0):
    n = int(SR * dur)
    return sine(n, f0, f1) * env(n, attack, dur, power)


def _struck(dur, partials, power=2.6, attack=0.0008):
    """A struck bell or plate: (freq, amp, life) partials, life a 0..1 share
    of `dur` -- a short partial is a short `env` placed at the start."""
    n = int(SR * dur)
    out = np.zeros(n)
    for f, a, life in partials:
        k = max(1, int(n * life))
        out[:k] += a * sine(k, f) * env(k, attack, life * dur, power)
    return out


def _bell(dur, f, power=2.6, bright=1.0):
    """A small bell: the classic 1 / 2.76 / 5.40 / 8.93 inharmonic series."""
    return _struck(dur, [(f, 1.0, 1.0), (f * 2.76, 0.42 * bright, 0.6),
                         (f * 5.40, 0.20 * bright, 0.35), (f * 8.93, 0.08 * bright, 0.2)], power)


def _brass(dur, f, attack=0.18, power=1.6, cutoff=1400.0):
    """A soft brass-like voice: a harmonic stack, low-passed, slow attack."""
    n = int(SR * dur)
    x = sum(sine(n, f * h) / h ** 1.1 for h in range(1, 7))
    return lowpass(x, cutoff) * env(n, attack, dur, power)


def _square(dur, f, cutoff=2400.0, power=3.0):
    n = int(SR * dur)
    return lowpass(np.sign(sine(n, f)), cutoff) * env(n, 0.002, dur, power)


def _drum(dur, f0=95.0, f1=45.0, body=0.6):
    """A frame-drum hit: a falling sine under a darkened noise slap."""
    n = int(SR * dur)
    boom = sine(n, f0, f1) * env(n, 0.002, dur, 2.4)
    slap = lowpass(noise(n), 520) * env(n, 0.001, dur, 5.0) * body
    return boom + slap


def _squelch(dur=0.012, burst=0.08, burst_gain=0.35):
    """The radio's key-up: a click, then a short burst of band static (the
    shape N19 gives the voice chain, so a cue reads as 'the net')."""
    k = int(SR * dur)
    click = highpass(noise(k), 2500) * env(k, 0.0003, dur, 6.0)
    m = int(SR * burst)
    stat = highpass(lowpass(noise(m), 3000), 500) * env(m, 0.004, burst, 1.5) * burst_gain
    out = np.zeros(k + m)
    out[:k] += click
    out[k:] += stat
    return out


def _mix(total_s, *parts):
    """`parts` are (start_s, gain, voice); returns the summed, unnormalised mix."""
    n = int(SR * total_s)
    out = np.zeros(n)
    for start, gain, v in parts:
        out += gain * _at(n, start, v)
    return out


def _finish(x, ms=12):
    """A 12 ms fade-out, then the -6 dBFS peak every cue shares."""
    k = min(len(x), int(SR * ms / 1000))
    x = x.copy()
    x[-k:] *= np.linspace(1.0, 0.0, k)
    return norm(x, UI_PEAK)


# The theme is D minor at 92 BPM (docs/audio/main-theme-prompt.md); both
# outcomes speak its key so the music and the verdict never argue.
D2, D3, F3, A3, D4, Fs4, A4, D5, Fs5, A5 = 73.42, 146.83, 174.61, 220.0, 293.66, 369.99, 440.0, 587.33, 739.99, 880.0


def victory(seed_shift=0.0):
    """'Perimeter held': a frame-drum hit, then a low brass chord that opens
    on D minor's fifth and lands on a D MAJOR third (a Picardy close) -- the
    theme's own key, resolved. Second drum on the land."""
    with _own_rng(0x5101):
        x = _mix(2.3,
                 (0.00, 1.0, _drum(0.7, 100, 46)),
                 (0.04, 0.55, _brass(2.2, D3, attack=0.20)),
                 (0.04, 0.45, _brass(2.2, A3, attack=0.24)),
                 (0.04, 0.35, _brass(2.2, D4, attack=0.28)),
                 (0.62, 0.70, _drum(0.6, 90, 44, body=0.4)),
                 (0.62, 0.42, _brass(1.65, Fs4, attack=0.10, power=1.8)),
                 (0.62, 0.18, _bell(1.6, A5, power=2.2, bright=0.6)))
        return _finish(tail(x, 0.25, 0.5)[: int(SR * 2.45)])


def defeat(seed_shift=0.0):
    """'Unresolved': a dull drum, a D-minor chord in the low brass whose top
    voice sinks a semitone (A -> G#) while the filter closes. No cadence: the
    theme's key, left open. Same instruments as victory, opposite close."""
    with _own_rng(0x5103):
        n = int(SR * 2.3)
        top = lowpass(sum(sine(n, A3 * h, A3 * 0.944 * h) / h ** 1.1 for h in range(1, 7)), 900) \
            * env(n, 0.25, 2.3, 1.5)
        x = _mix(2.4,
                 (0.00, 1.0, _drum(0.9, 80, 38, body=0.5)),
                 (0.03, 0.55, _brass(2.3, D3, attack=0.22, cutoff=900)),
                 (0.03, 0.45, _brass(2.3, F3, attack=0.26, cutoff=900)),
                 (0.03, 0.40, top),
                 (0.03, 0.30, sine(n, D2) * env(n, 0.3, 2.3, 1.2)))
        return _finish(tail(x, 0.2, 0.4)[: int(SR * 2.45)])


# Objectives: one family, three shapes. NEW is level (attention), COMPLETE
# rises, FAILED falls -- the rule the old synth kept ("an objective rises").
# Bells, so none of the three can be mistaken for ui_purchase (pure sines over
# a clunk) or for an alert (squares).

def objective_complete(seed_shift=0.0):
    """'Rise': a struck D-major triad, D5 F#5 A5, 70 ms apart."""
    return _finish(_mix(0.75,
                        (0.00, 0.80, _bell(0.5, D5)),
                        (0.07, 0.80, _bell(0.5, Fs5)),
                        (0.14, 1.00, _bell(0.6, A5))))


def objective_failed(seed_shift=0.0):
    """'Fall': a darker bell, A4 then D#4 -- a tritone down, low-passed."""
    x = _mix(0.8,
             (0.00, 0.9, _bell(0.55, A4, bright=0.6)),
             (0.14, 1.0, _bell(0.65, A4 / 1.414, bright=0.5)))
    return _finish(lowpass(x, 2600))


def objective_new(seed_shift=0.0):
    """'Tasking': the net keys up, then two identical G5 pips -- level, not
    rising or falling: 'listen, there is something new'."""
    with _own_rng(0x5109):
        return _finish(_mix(0.45,
                            (0.00, 0.45, _squelch(burst=0.05)),
                            (0.07, 0.85, _bell(0.16, 784.0, bright=0.4)),
                            (0.20, 0.85, _bell(0.22, 784.0, bright=0.4))))


# Alerts, three tiers. Squares and woodblocks, never bells: an alert is a
# different instrument from an objective. Tier is carried by length, pulse
# count and register, so it reads with the screen out of sight; the manifest
# gain adds loudness.

def alert_minor(seed_shift=0.0):
    """MINOR 'Tick': one soft woodblock knock (your men are taking fire)."""
    with _own_rng(0x5111):
        k = int(SR * 0.05)
        knock = _struck(0.12, [(880, 1.0, 1.0), (2380, 0.35, 0.4)], 4.0)
        tick = highpass(noise(k), 1500) * env(k, 0.0003, 0.05, 6.0) * 0.4
        return _finish(_mix(0.14, (0.0, 1.0, knock), (0.0, 1.0, tick)))


def alert_important(seed_shift=0.0):
    """IMPORTANT 'Falls': two falling tones, G5 to D5 -- the old synth's
    shape (an alert falls) in a rounder voice."""
    return _finish(_mix(0.45,
                        (0.00, 1.0, _square(0.14, 784.0, cutoff=1600, power=2.5)),
                        (0.12, 1.0, _square(0.30, 587.33, cutoff=1400, power=2.2))))


def alert_major(seed_shift=0.0):
    """MAJOR 'Three down': three falling square pulses (E5 D5 B4) over a low
    thud on the first -- longer, lower and one pulse more than important."""
    with _own_rng(0x5115):
        return _finish(_mix(0.95,
                            (0.00, 0.9, _drum(0.35, 110, 55, body=0.3)),
                            (0.00, 1.0, _square(0.16, 659.25, cutoff=1500, power=1.8)),
                            (0.20, 1.0, _square(0.16, 587.33, cutoff=1400, power=1.8)),
                            (0.40, 1.0, _square(0.42, 493.88, cutoff=1300, power=2.0))))


def mission_start(seed_shift=0.0):
    """'Radio check': the net keys up, two rising call tones (D5, A5), and a
    drum hit with a low D under it: the company is on the net."""
    with _own_rng(0x5121):
        return _finish(_mix(1.35,
                            (0.00, 0.5, _squelch()),
                            (0.10, 0.65, _bell(0.25, D5, bright=0.4)),
                            (0.24, 0.65, _bell(0.30, A5, bright=0.4)),
                            (0.40, 1.00, _drum(0.8, 96, 44, body=0.45)),
                            (0.40, 0.35, _tone(0.9, D2, attack=0.05, power=1.5))))


def ui_confirm(seed_shift=0.0):
    """'Click': a crisp 1.3 kHz tick with a breath of air on its front."""
    with _own_rng(0x5131):
        k = int(SR * 0.006)
        air = highpass(noise(k), 3000) * env(k, 0.0003, 0.006, 4.0) * 0.4
        return _finish(_mix(0.07, (0.0, 1.0, air),
                            (0.0, 1.0, _struck(0.06, [(1320, 1.0, 1.0), (2640, 0.2, 0.4)], 3.5))))


def ui_deny(seed_shift=0.0):
    """'Buzz-buzz': two low dull square pulses, 147 Hz (D3)."""
    return _finish(_mix(0.2,
                        (0.00, 1.0, _square(0.065, D3, cutoff=900, power=1.0)),
                        (0.10, 1.0, _square(0.075, D3, cutoff=900, power=1.4))))


# One variant per UI set is deliberate: a UI cue should be recognisable on
# repeat, not varied like a battlefield one-shot -- the README's "3-4
# variants" guidance is for battle clips only.
UI_SETS = {
    "ui_purchase": (ui_purchase, 1),
    "ui_upgrade": (ui_upgrade, 1),
    "ui_kit_fitted": (ui_kit_fitted, 1),
    "ui_confirm": (ui_confirm, 1),
    "ui_deny": (ui_deny, 1),
    "alert_minor": (alert_minor, 1),
}

# Cues longer than UI_MAX_S, each held to its own tier's ceiling.
STINGER_SETS = {
    "victory": (victory, 1, "stinger"),
    "defeat": (defeat, 1, "stinger"),
    "objective_complete": (objective_complete, 1, "cue"),
    "objective_failed": (objective_failed, 1, "cue"),
    "objective_new": (objective_new, 1, "cue"),
    "alert_important": (alert_important, 1, "cue"),
    "alert_major": (alert_major, 1, "major"),
    "mission_start": (mission_start, 1, "start"),
}


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


USAGE = """usage: python tools/gen_audio.py [--only=name,name,...] [-h | --help]

Regenerates the placeholder sound library into assets/audio/ and rewrites the
variants in data/audio.json. With no --only it re-encodes EVERY set.

  --only=a,b   generate only the named sets (from SETS, UI_SETS or STINGER_SETS)
  -h, --help   print this and exit without generating anything
"""


def parse_args(argv):
    """(only, exit_code): `only` is None for every set, or the named ones;
    `exit_code` is set when the run must stop BEFORE generating anything.

    Every argument is accounted for. Anything unrecognised -- a typo such as
    `--onyl=`, a bare word, `--only` without its `=` -- is exit 2, never
    ignored: the old loop ignored it and ran the full generator, which
    re-encodes all 31 clips (final review, parked item (b))."""
    if any(a in ("-h", "--help") for a in argv):
        print(USAGE, end="")
        return None, 0
    only = None
    for arg in argv:
        if arg.startswith("--only="):
            only = [s.strip() for s in arg[len("--only="):].split(",") if s.strip()]
        else:
            print(f"unknown argument: {arg}\n\n{USAGE}", end="", file=sys.stderr)
            return None, 2
    return only, None


def main():
    all_sets = {**SETS, **UI_SETS, **{k: (fn, n) for k, (fn, n, _tier) in STINGER_SETS.items()}}

    only, stop = parse_args(sys.argv[1:])
    if stop is not None:
        return stop
    if only is not None:
        unknown = [name for name in only if name not in all_sets]
        if unknown:
            print(f"unknown set(s): {', '.join(unknown)}", file=sys.stderr)
            return 2
        selected = {name: all_sets[name] for name in only}
    else:
        selected = all_sets

    variants = {}
    for name, (fn, count) in selected.items():
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        entries = []
        for i in range(count):
            base = os.path.join(d, f"{name}_{i + 1:02d}")
            x = fn(seed_shift=i * 0.7)
            if name in UI_SETS:
                assert len(x) <= int(UI_MAX_S * SR), \
                    f"{name}: {len(x) / SR:.3f}s exceeds {UI_MAX_S}s"
                assert np.max(np.abs(x)) <= UI_PEAK + 1e-9
            if name in STINGER_SETS:
                tier = STINGER_SETS[name][2]
                ceiling = CUE_CEILING_S[tier]
                assert len(x) <= int(ceiling * SR), \
                    f"{name}: {len(x) / SR:.3f}s exceeds the {tier} ceiling {ceiling}s"
                assert np.max(np.abs(x)) <= UI_PEAK + 1e-9
            encode(x, base)
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
        json.dump(man, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"\nwrote {sum(len(v) for v in variants.values())} files and updated data/audio.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
