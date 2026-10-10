"""Candidate cues for the polish lane's audio plan (pass F, PA-02):
`docs/polish/audio-plan.md` section 4.

    python3 docs/polish/audio/cue_candidates.py docs/polish/audio

Two candidates for each critical missing cue, for the lead to audition. Built
ONLY from tools/gen_audio.py's own primitives (env, noise, lowpass, highpass,
sine, tail, norm, _at, UI_PEAK), so every file is CC0 by construction: noise,
envelopes and sine partials synthesised here, no sample, no generative model,
no third-party provenance. A chosen candidate moves into gen_audio.py's
UI_SETS (or a new STINGER_SETS) unchanged and is encoded there like every
other set; NOTHING in this folder ships.

Deterministic: every candidate that draws noise reseeds gen_audio's RNG with
its own fixed seed first, so a re-run writes byte-identical WAVs whatever the
order. Every file peaks at exactly -6 dBFS (UI_PEAK) and stays under the
length ceiling its tier is allowed (CEILING_S below). Writes 16-bit mono
44.1 kHz WAVs (QuickLook and every browser play them) and prints a table of
duration, peak, RMS over the audible span, audible length and spectral
centroid, beside the two shipped garage cues for reference."""
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "tools"))
import gen_audio as ga  # noqa: E402

SR = ga.SR
PEAK = ga.UI_PEAK  # -6 dBFS

# Length ceilings by tier (seconds). A UI tick must be over before the next
# click can land; an outcome stinger may take a breath, never a bar of music.
CEILING_S = {
    "ui": ga.UI_MAX_S,          # 0.25: confirm, deny, minor alert
    "cue": 0.8,                 # objective new/complete/failed, important alert
    "major": 1.0,               # major alert
    "start": 1.5,               # mission start
    "stinger": 2.5,             # victory, defeat
}


# --- small instruments on top of gen_audio's blocks ------------------------

def seed(n):
    """Give a noise-drawing candidate its own stream (order-independent)."""
    ga.RNG = np.random.default_rng(n)


def tone(dur, f0, f1=None, attack=0.002, power=2.0):
    n = int(SR * dur)
    return ga.sine(n, f0, f1) * ga.env(n, attack, dur, power)


def strike(dur, partials, power=2.6, attack=0.0008):
    """A struck bell or plate: (freq, amp, life) partials, life a 0..1 share
    of `dur` -- a short partial is a short `env` placed at the start."""
    n = int(SR * dur)
    out = np.zeros(n)
    for f, a, life in partials:
        k = max(1, int(n * life))
        out[:k] += a * ga.sine(k, f) * ga.env(k, attack, life * dur, power)
    return out


def bell(dur, f, power=2.6, bright=1.0):
    """A small bell: the classic 1 / 2.76 / 5.40 / 8.93 inharmonic series."""
    return strike(dur, [(f, 1.0, 1.0), (f * 2.76, 0.42 * bright, 0.6),
                        (f * 5.40, 0.20 * bright, 0.35), (f * 8.93, 0.08 * bright, 0.2)], power)


def brass(dur, f, attack=0.18, power=1.6, cutoff=1400.0):
    """A soft brass-like voice: a harmonic stack, low-passed, slow attack."""
    n = int(SR * dur)
    x = sum(ga.sine(n, f * h) / h ** 1.1 for h in range(1, 7))
    return ga.lowpass(x, cutoff) * ga.env(n, attack, dur, power)


def square(dur, f, cutoff=2400.0, power=3.0):
    n = int(SR * dur)
    return ga.lowpass(np.sign(ga.sine(n, f)), cutoff) * ga.env(n, 0.002, dur, power)


def drum(dur, f0=95.0, f1=45.0, body=0.6):
    """A frame-drum hit: a falling sine under a darkened noise slap."""
    n = int(SR * dur)
    boom = ga.sine(n, f0, f1) * ga.env(n, 0.002, dur, 2.4)
    slap = ga.lowpass(ga.noise(n), 520) * ga.env(n, 0.001, dur, 5.0) * body
    return boom + slap


def squelch(dur=0.012, burst=0.08, burst_gain=0.35):
    """The radio's key-up: a click, then a short burst of band static (the
    shape N19 gives the voice chain, so a cue reads as 'the net')."""
    k = int(SR * dur)
    click = ga.highpass(ga.noise(k), 2500) * ga.env(k, 0.0003, dur, 6.0)
    m = int(SR * burst)
    stat = ga.highpass(ga.lowpass(ga.noise(m), 3000), 500) * ga.env(m, 0.004, burst, 1.5) * burst_gain
    out = np.zeros(k + m)
    out[:k] += click
    out[k:] += stat
    return out


def mix(total_s, *parts):
    """`parts` are (start_s, gain, voice); returns the summed, unnormalised mix."""
    n = int(SR * total_s)
    out = np.zeros(n)
    for start, gain, v in parts:
        out += gain * ga._at(n, start, v)
    return out


def fade_out(x, ms=12):
    k = min(len(x), int(SR * ms / 1000))
    x = x.copy()
    x[-k:] *= np.linspace(1.0, 0.0, k)
    return x


def finish(x):
    return ga.norm(fade_out(x), PEAK)


# --- victory / defeat (stinger) ---------------------------------------------
# The theme is D minor at 92 BPM (docs/audio/main-theme-prompt.md); both
# outcomes speak its key so the music and the verdict never argue.

D2, D3, F3, A3, D4, Fs4, A4, D5, Fs5, A5 = 73.42, 146.83, 174.61, 220.0, 293.66, 369.99, 440.0, 587.33, 739.99, 880.0


def victory_a():
    """'Perimeter held': a frame-drum hit, then a low brass chord that opens
    on D minor's fifth and lands on a D MAJOR third (a Picardy close) --
    the theme's own key, resolved. Second drum on the land."""
    seed(0x5101)
    x = mix(2.3,
            (0.00, 1.0, drum(0.7, 100, 46)),
            (0.04, 0.55, brass(2.2, D3, attack=0.20)),
            (0.04, 0.45, brass(2.2, A3, attack=0.24)),
            (0.04, 0.35, brass(2.2, D4, attack=0.28)),
            (0.62, 0.70, drum(0.6, 90, 44, body=0.4)),
            (0.62, 0.42, brass(1.65, Fs4, attack=0.10, power=1.8)),
            (0.62, 0.18, bell(1.6, A5, power=2.2, bright=0.6)))
    return finish(ga.tail(x, 0.25, 0.5)[: int(SR * 2.45)])


def victory_b():
    """'All clear on the net': the radio keys up, two rising call tones
    (D5 then A5), then a soft D-major pad settles under them. The same
    radio the voice lines use, saying the fighting is over."""
    seed(0x5102)
    x = mix(1.9,
            (0.00, 0.55, squelch()),
            (0.12, 0.60, bell(0.45, D5, bright=0.5)),
            (0.30, 0.65, bell(0.9, A5, bright=0.5)),
            (0.30, 0.35, brass(1.55, D4, attack=0.35, cutoff=1100)),
            (0.30, 0.30, brass(1.55, Fs4, attack=0.40, cutoff=1100)),
            (0.30, 0.25, brass(1.55, A4, attack=0.45, cutoff=1100)))
    return finish(x)


def defeat_a():
    """'Unresolved': a dull drum, a D-minor chord in the low brass whose top
    voice sinks a semitone (A -> G#) while the filter closes. No cadence:
    the theme's key, left open."""
    seed(0x5103)
    n = int(SR * 2.3)
    top = ga.lowpass(sum(ga.sine(n, A3 * h, A3 * 0.944 * h) / h ** 1.1 for h in range(1, 7)), 900) \
        * ga.env(n, 0.25, 2.3, 1.5)
    x = mix(2.4,
            (0.00, 1.0, drum(0.9, 80, 38, body=0.5)),
            (0.03, 0.55, brass(2.3, D3, attack=0.22, cutoff=900)),
            (0.03, 0.45, brass(2.3, F3, attack=0.26, cutoff=900)),
            (0.03, 0.40, top),
            (0.03, 0.30, ga.sine(n, D2) * ga.env(n, 0.3, 2.3, 1.2)))
    return finish(ga.tail(x, 0.2, 0.4)[: int(SR * 2.45)])


def defeat_b():
    """'The net goes dead': the radio keys up, static rises, and is CUT --
    no squelch tail, the sender did not let go. Then one low tolled bell,
    falling a tritone into its own decay."""
    seed(0x5104)
    stat_n = int(SR * 0.55)
    stat = ga.highpass(ga.lowpass(ga.noise(stat_n), 3000), 400) * np.linspace(0.3, 1.0, stat_n) ** 1.5
    x = mix(2.2,
            (0.00, 0.5, squelch()),
            (0.09, 0.32, stat),
            (0.70, 1.00, bell(1.5, D3, power=2.0, bright=0.7)),
            (0.70, 0.35, tone(1.5, D2, D2 * 0.707, attack=0.01, power=1.4)))
    return finish(x)


# --- objectives (cue) --------------------------------------------------------
# One family, three shapes: NEW is level (attention), COMPLETE rises, FAILED
# falls -- the rule the shipped synth already keeps ("an objective rises").
# Bells, so none of the three can be mistaken for ui_purchase (pure sines
# over a clunk) or for an alert (squares).

def objective_complete_a():
    """'Rise': a struck D-major triad, D5 F#5 A5, 70 ms apart."""
    return finish(mix(0.75,
                      (0.00, 0.80, bell(0.5, D5)),
                      (0.07, 0.80, bell(0.5, Fs5)),
                      (0.14, 1.00, bell(0.6, A5))))


def objective_complete_b():
    """'Stamp': a firm low stamp, then one bright bell a fifth above with its
    octave shimmering over it: filed, done."""
    seed(0x5106)
    k = int(SR * 0.09)
    stamp = ga.sine(k, 140, 70) * ga.env(k, 0.001, 0.09, 4.0) + \
        ga.lowpass(ga.noise(k), 900) * ga.env(k, 0.0005, 0.09, 6.0) * 0.6
    return finish(mix(0.7,
                      (0.00, 1.00, stamp),
                      (0.08, 0.85, bell(0.6, A5)),
                      (0.08, 0.25, bell(0.6, A5 * 2.0, bright=0.3))))


def objective_failed_a():
    """'Fall': a darker bell, A4 then D#4 -- a tritone down."""
    x = mix(0.8,
            (0.00, 0.9, bell(0.55, A4, bright=0.6)),
            (0.14, 1.0, bell(0.65, A4 / 1.414, bright=0.5)))
    return finish(ga.lowpass(x, 2600))


def objective_failed_b():
    """'Sink': two muffled low hits a minor second apart, falling, with a
    breath of noise under the second."""
    seed(0x5108)
    k = int(SR * 0.5)
    breath = ga.lowpass(ga.noise(k), 400) * ga.env(k, 0.03, 0.5, 2.0) * 0.25
    return finish(mix(0.75,
                      (0.00, 1.0, drum(0.35, 165, 110, body=0.3)),
                      (0.16, 1.0, drum(0.5, 155, 82, body=0.3)),
                      (0.16, 1.0, breath)))


def objective_new_a():
    """'Tasking': the net keys up, then two identical G5 pips -- level, not
    rising or falling: 'listen, there is something new'."""
    seed(0x5109)
    return finish(mix(0.45,
                      (0.00, 0.45, squelch(burst=0.05)),
                      (0.07, 0.85, bell(0.16, 784.0, bright=0.4)),
                      (0.20, 0.85, bell(0.22, 784.0, bright=0.4))))


def objective_new_b():
    """'Up and hold': three soft mallet notes, A4 D5 D5 -- up a fourth, then
    level, which reads as a question being put rather than answered."""
    return finish(mix(0.6,
                      (0.00, 0.8, strike(0.25, [(A4, 1.0, 1.0), (A4 * 4.0, 0.25, 0.25)], 3.0)),
                      (0.11, 0.9, strike(0.25, [(D5, 1.0, 1.0), (D5 * 4.0, 0.25, 0.25)], 3.0)),
                      (0.22, 0.9, strike(0.35, [(D5, 1.0, 1.0), (D5 * 4.0, 0.25, 0.25)], 3.0))))


# --- alerts, three tiers -----------------------------------------------------
# Squares and woodblocks, never bells: an alert is a different instrument
# from an objective. Tier is carried by length, pulse count and register, so
# it reads with the screen out of sight; the mix table adds gain.

def alert_minor_a():
    """MINOR 'Tick': one soft woodblock knock (under fire, a re-sighting)."""
    seed(0x5111)
    k = int(SR * 0.05)
    knock = strike(0.12, [(880, 1.0, 1.0), (2380, 0.35, 0.4)], 4.0)
    tick = ga.highpass(ga.noise(k), 1500) * ga.env(k, 0.0003, 0.05, 6.0) * 0.4
    return finish(mix(0.14, (0.0, 1.0, knock), (0.0, 1.0, tick)))


def alert_minor_b():
    """MINOR 'Tap tap': two muffled clicks 60 ms apart."""
    seed(0x5112)
    k = int(SR * 0.04)
    c = ga.lowpass(ga.noise(k), 1800) * ga.env(k, 0.0004, 0.04, 5.0) + \
        ga.sine(k, 620) * ga.env(k, 0.0004, 0.04, 5.0) * 0.6
    return finish(mix(0.13, (0.0, 1.0, c), (0.06, 0.8, c)))


def alert_important_a():
    """IMPORTANT 'Falls': two falling tones, G5 to D5 -- the shipped synth's
    shape (an alert falls) in a rounder voice."""
    return finish(mix(0.45,
                      (0.00, 1.0, square(0.14, 784.0, cutoff=1600, power=2.5)),
                      (0.12, 1.0, square(0.30, 587.33, cutoff=1400, power=2.2))))


def alert_important_b():
    """IMPORTANT 'Net beep': the net keys up and beeps twice, A5."""
    seed(0x5114)
    return finish(mix(0.45,
                      (0.00, 0.45, squelch(burst=0.05)),
                      (0.08, 1.00, square(0.09, 880.0, cutoff=2600, power=1.5)),
                      (0.22, 1.00, square(0.12, 880.0, cutoff=2600, power=1.8))))


def alert_major_a():
    """MAJOR 'Three down': three falling square pulses (E5 D5 B4) over a low
    thud on the first -- longer, lower and one pulse more than important."""
    seed(0x5115)
    return finish(mix(0.95,
                      (0.00, 0.9, drum(0.35, 110, 55, body=0.3)),
                      (0.00, 1.0, square(0.16, 659.25, cutoff=1500, power=1.8)),
                      (0.20, 1.0, square(0.16, 587.33, cutoff=1400, power=1.8)),
                      (0.40, 1.0, square(0.42, 493.88, cutoff=1300, power=2.0))))


def alert_major_b():
    """MAJOR 'Stab': a low brass cluster (D3 + Eb3) on a drum hit, then a
    single falling call A4 -> A3."""
    seed(0x5116)
    return finish(mix(0.95,
                      (0.00, 1.0, drum(0.5, 95, 45, body=0.4)),
                      (0.00, 0.7, brass(0.5, D3, attack=0.01, power=2.4, cutoff=1600)),
                      (0.00, 0.6, brass(0.5, 155.56, attack=0.01, power=2.4, cutoff=1600)),
                      (0.35, 0.8, square(0.55, A4, cutoff=1300, power=2.0)),
                      (0.35, 0.5, tone(0.55, A4, A3, attack=0.004, power=1.6))))


# --- mission start ----------------------------------------------------------

def mission_start_a():
    """'Radio check': the net keys up, two rising call tones (D5, A5), and a
    drum hit with a low D under it: the company is on the net."""
    seed(0x5121)
    return finish(mix(1.35,
                      (0.00, 0.5, squelch()),
                      (0.10, 0.65, bell(0.25, D5, bright=0.4)),
                      (0.24, 0.65, bell(0.30, A5, bright=0.4)),
                      (0.40, 1.00, drum(0.8, 96, 44, body=0.45)),
                      (0.40, 0.35, tone(0.9, D2, attack=0.05, power=1.5))))


def mission_start_b():
    """'Deploy': a frame-drum roll that quickens (six strokes) into a full
    hit with a low D-A fifth: the move off the start line."""
    seed(0x5122)
    times = [0.0, 0.16, 0.29, 0.39, 0.47, 0.53]
    parts = [(t, 0.30 + 0.08 * i, drum(0.15, 140, 90, body=0.9)) for i, t in enumerate(times)]
    parts += [(0.62, 1.0, drum(0.8, 96, 44, body=0.5)),
              (0.62, 0.40, brass(0.8, D3, attack=0.03, power=2.0, cutoff=1000)),
              (0.62, 0.30, brass(0.8, A3, attack=0.03, power=2.0, cutoff=1000))]
    return finish(mix(1.45, *parts))


# --- UI confirm / deny (ui) ---------------------------------------------------

def ui_confirm_a():
    """'Click': a crisp 1.3 kHz tick with a breath of air on its front."""
    seed(0x5131)
    k = int(SR * 0.006)
    air = ga.highpass(ga.noise(k), 3000) * ga.env(k, 0.0003, 0.006, 4.0) * 0.4
    return finish(mix(0.07, (0.0, 1.0, air), (0.0, 1.0, strike(0.06, [(1320, 1.0, 1.0), (2640, 0.2, 0.4)], 3.5))))


def ui_confirm_b():
    """'Up-tick': two short rising ticks, 1.1 then 1.48 kHz."""
    return finish(mix(0.11,
                      (0.000, 0.8, strike(0.035, [(1100, 1.0, 1.0)], 3.5)),
                      (0.045, 1.0, strike(0.06, [(1480, 1.0, 1.0)], 3.0))))


def ui_deny_a():
    """'Buzz-buzz': two low dull square pulses, 147 Hz (D3)."""
    return finish(mix(0.2,
                      (0.00, 1.0, square(0.065, D3, cutoff=900, power=1.0)),
                      (0.10, 1.0, square(0.075, D3, cutoff=900, power=1.4))))


def ui_deny_b():
    """'Thunk': a short dull thud falling 300 -> 180 Hz, then a softer
    lower one -- a door that does not open."""
    seed(0x5134)
    k = int(SR * 0.08)
    def thunk(f0, f1):
        return ga.sine(k, f0, f1) * ga.env(k, 0.001, 0.08, 3.0) + \
            ga.lowpass(ga.noise(k), 700) * ga.env(k, 0.0005, 0.08, 6.0) * 0.4
    return finish(mix(0.2, (0.0, 1.0, thunk(300, 180)), (0.09, 0.6, thunk(240, 150))))


# --- the table -----------------------------------------------------------------

CANDIDATES = [
    # (file stem, tier, fn)
    ("victory_a_perimeter_held", "stinger", victory_a),
    ("victory_b_all_clear", "stinger", victory_b),
    ("defeat_a_unresolved", "stinger", defeat_a),
    ("defeat_b_net_dead", "stinger", defeat_b),
    ("objective_complete_a_rise", "cue", objective_complete_a),
    ("objective_complete_b_stamp", "cue", objective_complete_b),
    ("objective_failed_a_fall", "cue", objective_failed_a),
    ("objective_failed_b_sink", "cue", objective_failed_b),
    ("objective_new_a_tasking", "cue", objective_new_a),
    ("objective_new_b_up_and_hold", "cue", objective_new_b),
    ("alert_minor_a_tick", "ui", alert_minor_a),
    ("alert_minor_b_tap_tap", "ui", alert_minor_b),
    ("alert_important_a_falls", "cue", alert_important_a),
    ("alert_important_b_net_beep", "cue", alert_important_b),
    ("alert_major_a_three_down", "major", alert_major_a),
    ("alert_major_b_stab", "major", alert_major_b),
    ("mission_start_a_radio_check", "start", mission_start_a),
    ("mission_start_b_deploy", "start", mission_start_b),
    ("ui_confirm_a_click", "ui", ui_confirm_a),
    ("ui_confirm_b_up_tick", "ui", ui_confirm_b),
    ("ui_deny_a_buzz", "ui", ui_deny_a),
    ("ui_deny_b_thunk", "ui", ui_deny_b),
]


def write(path, x):
    pcm16 = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm16.tobytes())


def centroid(x):
    sp = np.abs(np.fft.rfft(x))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float((sp * f).sum() / sp.sum())


def measure(x):
    peak = 20 * np.log10(np.max(np.abs(x)))
    nz = np.where(np.abs(x) > PEAK * 10 ** (-40 / 20))[0]
    span = x[nz[0]: nz[-1] + 1]
    rms = 20 * np.log10(np.sqrt(np.mean(span ** 2)))
    return peak, rms, nz[-1] / SR, centroid(x)


def main(out):
    os.makedirs(out, exist_ok=True)
    print(f"{'file':34s} {'tier':7s} {'len':>6s} {'peak':>6s} {'rms':>6s} {'-40dB':>6s} {'centroid':>8s}")
    rows = [(stem, tier, fn) for stem, tier, fn in CANDIDATES]
    rows += [("ui_purchase (shipped)", "ref", ga.ui_purchase), ("ui_upgrade (shipped)", "ref", ga.ui_upgrade)]
    for stem, tier, fn in rows:
        x = fn()
        if tier != "ref":
            assert len(x) <= int(CEILING_S[tier] * SR), f"{stem}: {len(x) / SR:.3f}s over the {tier} ceiling"
            assert abs(np.max(np.abs(x)) - PEAK) < 1e-9, f"{stem}: peak is not -6 dBFS"
            write(os.path.join(out, stem + ".wav"), x)
        peak, rms, audible, cen = measure(x)
        print(f"{stem:34s} {tier:7s} {len(x) / SR * 1000:5.0f}ms {peak:5.1f} {rms:6.1f} "
              f"{audible * 1000:5.0f}ms {cen:7.0f}Hz")


def sheet(out):
    """candidates-spectrograms.png: every candidate on one 2.5 s axis, so the
    shapes (rise / level / fall, pulse count, length) can be compared by eye
    before by ear. Optional: skipped when matplotlib is not installed."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed: no spectrogram sheet")
        return
    fig, axes = plt.subplots(len(CANDIDATES) // 2, 2, figsize=(12, 1.25 * len(CANDIDATES) // 2))
    for ax, (stem, _tier, _fn) in zip(axes.flat, CANDIDATES):
        with wave.open(os.path.join(out, stem + ".wav")) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), "<i2") / 32768
        with np.errstate(divide="ignore"):
            ax.specgram(x, NFFT=512, Fs=SR, noverlap=384, cmap="magma", vmin=-120)
        ax.set_ylim(0, 8000)
        ax.set_xlim(0, 2.5)
        ax.set_title(stem, fontsize=8, loc="left")
        ax.tick_params(labelsize=6)
    fig.suptitle("PA-02 cue candidates: spectrograms, 0-8 kHz, common 2.5 s time axis", fontsize=10)
    fig.tight_layout()
    fig.savefig(os.path.join(out, "candidates-spectrograms.png"), dpi=80)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else HERE
    main(target)
    sheet(target)
