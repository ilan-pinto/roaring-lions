"""Guards tools/prepare_support_audio.py (GH-782): the rules that decide what
the lead's takes become. Run: python3 tools/test_prepare_support_audio.py

Exits non-zero on failure. Needs numpy (as gen_audio.py does) and nothing else:
no ffmpeg and no audio files, every case builds its samples. Each case is one
input a rule must turn red on, beside the passing one it was cut from.
"""
import importlib.util
import json
import os
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("prepare_support_audio", os.path.join(HERE, "prepare_support_audio.py"))
psa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(psa)
SR = psa.SR


def raises(fn, text=None):
    try:
        fn()
    except psa.Refusal as e:
        return text is None or text in str(e)
    return False


def helicopter(seconds, period_s=0.0553, seed=1):
    """Thump train at a fixed blade period over a little noise: periodic enough to loop."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    thump = np.sin(2 * np.pi * 70 * t) * np.exp(-((t % period_s) / 0.012))
    return 0.5 * thump + 0.02 * rng.standard_normal(n)


def main():
    bad = []

    def check(label, ok, detail=""):
        print(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f" -- {detail}"))
        if not ok:
            bad.append(label)

    # --- inputs are the lead's files, by hash ---------------------------------
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "a.wav")
        with open(wav, "wb") as fh:
            fh.write(b"RIFFxxxx")
        sources = os.path.join(d, "sources.json")
        good = psa.sha256(wav)
        for label, digest, want_ok in (("a file with the recorded sha256 is accepted", good, True),
                                       ("a file whose sha256 differs is refused", "0" * 64, False)):
            with open(sources, "w") as fh:
                json.dump({"inputs": [{"file": "a.wav", "sha256": digest, "role": "x", "take": 1}]}, fh)
            try:
                psa.load_sources(d, sources)
                got = True
            except psa.Refusal:
                got = False
            check(label, got == want_ok)
        with open(sources, "w") as fh:
            json.dump({"inputs": [{"file": "missing.wav", "sha256": good, "role": "x", "take": 1}]}, fh)
        check("a missing input is refused", raises(lambda: psa.load_sources(d, sources), "not in"))

    # --- the rotor loop's seam: a click fails the run -------------------------
    t = np.arange(int(2.0 * SR)) / SR
    smooth = 0.3 * np.sin(2 * np.pi * 50 * t)
    smooth = smooth[: int(round(2.0 * 50)) * (SR // 50)]            # a whole number of cycles: last sample runs into the first
    check("a loop of whole cycles passes the seam check", not raises(lambda: psa.check_seam(smooth)))
    stepped = smooth.copy()
    stepped[len(stepped) // 2:] += 0.25                              # the end sits 0.25 above the start: a click
    check("a loop whose last sample jumps to the first is a click", raises(lambda: psa.check_seam(stepped), "click"))
    rng = np.random.default_rng(3)
    noise = 0.1 * rng.standard_normal(len(smooth))
    quiet_start = noise.copy()
    quiet_start[: int(0.010 * SR)] *= 0.01                           # 10 ms of near-silence at the head: an RMS cliff at the wrap
    check("a 10 ms level drop at the wrap is refused", raises(lambda: psa.check_seam(quiet_start), "dB over 10 ms"))
    check("steady noise passes the seam check", not raises(lambda: psa.check_seam(noise)))

    # --- the rotor loop is cut on frames, zero crossings and the blade period --
    x = helicopter(12.0)
    loop, rep = psa.cut_loop(x)
    check("the loop is a whole number of 1024-sample frames", len(loop) % 1024 == 0 and len(loop) == rep["frames"] * 1024)
    check("84 blade periods of 55.3 ms is a whole number of them, 84.5 is not",
          psa.whole_periods(int(84 * 0.0553 * SR), 0.0553) and not psa.whole_periods(int(84.5 * 0.0553 * SR), 0.0553))
    check("the loop is a whole number of blade periods (to a tenth)", abs(rep["periods"] - round(rep["periods"])) <= 0.1 + 1e-9,
          f"{rep['periods']}")
    check("the blade period is found within 5%", abs(rep["period_s"] - 0.0553) / 0.0553 < 0.05, f"{rep['period_s']}")
    s = int(round(rep["start_s"] * SR))
    check("the cut starts on a positive-going zero crossing", x[s - 1] <= 0 < x[s])
    check("the cut ends on one too", x[s + len(loop) - 1] <= 0 < x[s + len(loop)])
    check("the loop length is inside 4 to 6 s", 4.0 <= rep["loop_s"] <= 6.0 + 1e-9, f"{rep['loop_s']}")

    # --- the jet is aligned on its loudness peak -------------------------------
    series = [(0.4 + 0.1 * i, -30.0 + (i if i < 25 else 50 - i)) for i in range(50)]        # M peaks at i = 25
    peak = psa.loudness_peak_s(series)
    check("the loudness peak is the centre of the maximum window", abs(peak - (series[25][0] - 0.2)) < 1e-9, f"{peak}")
    flat = [(0.4 + 0.1 * i, -20.0 if 10 <= i <= 20 else -40.0) for i in range(40)]
    check("a plateau's peak is the plateau's centre", abs(psa.loudness_peak_s(flat) - (0.4 + 0.1 * 15 - 0.2)) < 1e-9)
    clip = np.zeros(int(8 * SR))
    clip[:] = 0.1
    out, pk, lead = psa.take_jet(clip, series, 1.8, 5.0, 0.3, 1.0)
    check("a jet take is cut to the clip length", len(out) == int(5.0 * SR))
    check("its lead-in is peak - crest_s", abs(lead - (peak - 1.8)) < 1e-9, f"{lead}")
    check("a jet whose peak is earlier than crest_s cannot align and is refused",
          raises(lambda: psa.take_jet(clip, [(0.4 + 0.1 * i, -30.0 + (5 - abs(i - 5))) for i in range(40)], 1.8, 5.0, 0.3, 1.0), "cannot align"))
    check("the jet starts silent (0.3 s fade-in)", abs(out[0]) < 1e-9 and abs(out[int(0.31 * SR)]) > 0.09)

    # --- a hit starts on its first sample --------------------------------------
    take = np.zeros(int(4 * SR))
    take[int(0.114 * SR):] = 0.5 * np.exp(-np.arange(len(take) - int(0.114 * SR)) / (0.3 * SR)) * np.sign(np.sin(np.arange(len(take) - int(0.114 * SR)) * 0.3) + 1e-9)
    hit, onset = psa.take_hit(take, 2.5, 0.8)
    check("a lead-in is trimmed to a few ms before the hit", abs(onset - 0.114) < 0.001 and np.abs(hit[: int(0.003 * SR)]).max() < 0.01,
          f"onset {onset}")
    check("a hit is the clip length and its tail fades to silence", len(hit) == int(2.5 * SR) and abs(hit[-1]) < 1e-6)
    check("a take shorter than the clip is refused", raises(lambda: psa.take_hit(take[: int(1.0 * SR)], 2.5, 0.8), "shorter"))
    on_the_hit = take.copy()
    on_the_hit[:] = 0.5
    h2, o2 = psa.take_hit(on_the_hit, 2.5, 0.8)
    pre = int(psa.PRE_ROLL_S * SR)
    check("a take that starts on the hit gets pre-roll silence", o2 == 0 and np.abs(h2[:pre]).max() == 0)
    check("...and its first 2 ms are faded in, not a click", abs(h2[pre]) < 1e-9 and 0.2 < abs(h2[pre + 44]) < 0.3 and abs(h2[pre + 200]) > 0.49,
          f"{h2[pre]} {h2[pre + 44]} {h2[pre + 200]}")

    # --- the whistle ends where it ends ----------------------------------------
    n = int(4 * SR)
    tt = np.arange(n) / SR
    f = 3000 * np.exp(-tt * 0.5)                                       # falls from 3 kHz
    amp = np.clip(1.0 - np.maximum(tt - 2.4, 0) / 0.4, 0.0, 1.0) * 0.3   # gone by 2.8 s
    chirp = amp * np.sin(2 * np.pi * np.cumsum(f) / SR) + 1e-5 * np.random.default_rng(2).standard_normal(n)
    st, en, rep = psa.whistle_span(chirp)
    check("a whistle that fades by 2.8 s ends there, not at the file's end", 2.4 <= en <= 2.95, f"{en}")
    check("a whistle starts at its first audible frame", st < 0.1, f"{st}")
    check("its start pitch is above its end pitch", rep["f_start"] > rep["f_end"] * 1.5, f"{rep}")

    # --- levels: the gain and the ceiling ---------------------------------------
    def take(n, crest):
        return {"take": n, "crest": crest, "TPe": 0.0, "M": -20.0}

    notes = []
    ts = [take(1, 8.0), take(2, 9.0)]
    gain, lv = psa.fit_set("s", ts, -15.8, 0.85, notes)
    want = -15.8 - 20 * np.log10(0.85) - psa.MASTER_DB
    check("when every take can reach the target the approved gain stays", gain == 0.85 and not notes)
    check("every take of the set sits at one momentary max", all(abs(v - want) < 1e-9 for v in lv.values()))
    notes = []
    ts = [take(1, 8.0), take(2, 13.2)]
    gain, lv = psa.fit_set("s", ts, -15.2, 0.8, notes)
    peak_limit = psa.TP_CEILING - psa.TP_MARGIN - 13.2
    check("a peaky take raises the set gain (rounded up) instead of lowering the target", 0.8 < gain <= 1.5, f"{gain}")
    check("...and the heard level still lands on the target", all(abs(v + 20 * np.log10(gain) + psa.MASTER_DB + 15.2) < 0.1 for v in lv.values()))
    check("...with the peaky take under its own ceiling", all(v <= peak_limit + 1e-9 for v in lv.values()))
    notes = []
    ts = [take(1, 11.0), take(2, 19.3)]
    gain, lv = psa.fit_set("s", ts, -15.8, 0.85, notes)
    check("a take too peaky even at gain 1.5 sets the gain to the ceiling", gain == psa.MAX_GAIN, f"{gain}")
    check("...and the peaky take sits under its own true-peak ceiling, quieter than its neighbour",
          lv[id(ts[1])] <= psa.TP_CEILING - psa.TP_MARGIN - 19.3 + 1e-9 and lv[id(ts[0])] > lv[id(ts[1])])
    check("...and says so", any("cannot reach heard" in n for n in notes))

    if bad:
        print(f"\n{len(bad)} prepare_support_audio case(s) failed", file=sys.stderr)
        return 1
    print("prepare_support_audio: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
