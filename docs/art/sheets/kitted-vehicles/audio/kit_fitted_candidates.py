"""Three candidate `ui_kit_fitted` cues for the lead to audition (GH-238 plan 3,
`docs/superpowers/specs/2026-10-06-kitted-vehicles.md` section 8).

    python3 docs/art/sheets/kitted-vehicles/audio/kit_fitted_candidates.py \
        docs/art/sheets/kitted-vehicles/audio

Built ONLY from tools/gen_audio.py's own primitives (env, sine, norm, _at,
UI_PEAK, UI_MAX_S) and RNG-free like its two UI voices, so the chosen one
moves into gen_audio.py's UI_SETS unchanged. Writes 16-bit mono WAVs for
audition (nothing here ships; the chosen cue is encoded by gen_audio.py into
assets/audio/ like every other set) and prints duration, peak, tail and
spectral centroid beside the two shipped garage cues for comparison."""
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "..", "tools"))
import gen_audio as ga  # noqa: E402

SR = ga.SR


def strike(n, partials, decay, power=3.0, attack=0.0008):
    """A struck steel part: inharmonic partials, each its own decay."""
    out = np.zeros(n)
    for f, a, dk in partials:
        out += a * ga.sine(n, f) * ga.env(n, attack, decay * dk, power)
    return out


def click(ms=10, f=2200, gain=0.5):
    m = int(SR * ms / 1000)
    return np.sign(ga.sine(m, f)) * ga.env(m, 0.0004, ms / 1000, 6.0) * gain


def cand_a_bolt_on():
    """A: 'Bolt-on' -- an impact-wrench rattle (8 clicks at 40 Hz), then a
    steel plate clank landing at 150 ms."""
    n = int(SR * 0.24)
    out = sum(ga._at(n, 0.012 + 0.025 * i, click(8, 2600 - 60 * i, 0.35 + 0.03 * i)) for i in range(5))
    k = int(SR * 0.09)
    clank = strike(k, [(420, 1.0, 1.0), (1130, 0.55, 0.7), (2090, 0.35, 0.5), (3310, 0.2, 0.35)], 0.09)
    thud = ga.sine(k, 120, 70) * ga.env(k, 0.001, 0.05, 4.0) * 0.8
    out = out + ga._at(n, 0.15, clank + thud)
    return ga.norm(out, ga.UI_PEAK)


def cand_b_plate_set():
    """B: 'Plate set' -- a low thud with a bright plate ring over it, then one
    rising note a fifth above the ring's root (a 'done' cadence)."""
    n = int(SR * 0.245)
    k = int(SR * 0.14)
    thud = ga.sine(k, 95, 55) * ga.env(k, 0.002, 0.07, 4.0)
    ring = strike(k, [(760, 0.6, 1.0), (1910, 0.4, 0.7), (3150, 0.25, 0.45)], 0.13, power=2.5)
    m = int(SR * 0.10)
    note = ga.sine(m, 1140) * ga.env(m, 0.004, 0.10, 2.0) * 0.45
    out = ga._at(n, 0.0, thud + ring) + ga._at(n, 0.135, note)
    return ga.norm(out, ga.UI_PEAK)


def cand_c_torque_lock():
    """C: 'Torque and lock' -- a ratchet whose pawl clicks speed up (40, 31,
    24, 18 ms apart), ending on a struck 'ting' at 1760 Hz with a 2.76x
    partial: the ui_upgrade ratchet, finished in metal."""
    n = int(SR * 0.245)
    gaps = [0.0, 0.040, 0.071, 0.095, 0.113]
    out = sum(ga._at(n, t, click(9, 1800 + 120 * i, 0.45)) for i, t in enumerate(gaps))
    k = int(SR * 0.11)
    ting = strike(k, [(1760, 1.0, 1.0), (4858, 0.35, 0.5), (980, 0.25, 0.8)], 0.11, power=2.2)
    out = out + ga._at(n, 0.13, ting)
    return ga.norm(out, ga.UI_PEAK)


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


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, fn in (("kit_fitted_a_bolt_on", cand_a_bolt_on), ("kit_fitted_b_plate_set", cand_b_plate_set),
                     ("kit_fitted_c_torque_lock", cand_c_torque_lock),
                     ("ui_upgrade_shipped", ga.ui_upgrade), ("ui_purchase_shipped", ga.ui_purchase)):
        x = fn()
        assert len(x) <= int(ga.UI_MAX_S * SR) and np.max(np.abs(x)) <= ga.UI_PEAK + 1e-9
        p = os.path.join(out, name + ".wav")
        write(p, x)
        nz = np.where(np.abs(x) > 0.5 * 10 ** (-40 / 20))[0]
        print(f"{name:28s} {len(x) / SR * 1000:5.0f} ms  peak {20 * np.log10(np.max(np.abs(x))):5.1f} dBFS  "
              f"audible to -40 dB {nz[-1] / SR * 1000:5.0f} ms  centroid {centroid(x):6.0f} Hz  {os.path.getsize(p)} B")
