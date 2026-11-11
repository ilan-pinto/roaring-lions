#!/usr/bin/env python3
"""The groin gate's empty-set refusal (GH-746, review 10 Nov 2026 should-fix 1). Plain python3, no bpy.

    python3 tools/test_inf_kit_mesh.py

`inf_kit_v7.groin_fit` took `float(np.median(g[edge])) if edge.any() else 0.0`, so an apron whose edge rays ALL missed the belt
read 0.0 mm and passed the 20 mm limit. `inf_kit_mesh.masked_median` is the seam both selections (the edge gate and the
inner-face band stat) now go through: it refuses a selection with no vertex. Each case below is one input:

  0. a real gap array with the edge mask on three of six vertices      -> the median of exactly those three (15 mm)
  1. the SAME gaps, every edge vertex outside the selection             -> refuses: "selects no vertex" (was 0.0, a pass)
  2. the groin's real shape: rays that missed, so `~isnan(g)` is empty  -> refuses, naming 0 of N
  3. the selection is non-empty but every gap is NaN                    -> refuses: "no finite median"
  4. a single selected vertex (a degenerate but honest median)          -> its own gap, no refusal

and the call site, read as text because `inf_kit_v7` imports bpy:

  5. `groin_fit` sends BOTH its edge and band selections through `masked_median` -> the vacuous `else 0.0`/`else None` shapes are gone
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "units"))
import inf_kit_mesh as km  # noqa: E402


def main():
    bad = []

    def expect(name, fn, needle):
        try:
            out = fn()
        except ValueError as e:
            out, err = None, str(e)
        else:
            err = None
        ok = (needle is None and err is None) or (needle is not None and err is not None and needle in err)
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" -- got {out!r} / {err!r}"))
        if not ok:
            bad.append(name)

    # metres, as `outer_gap` returns them; NaN where a ray missed (the groin's own units)
    g = np.array([0.009, 0.015, 0.030, np.nan, np.nan, np.nan])
    near = np.array([True, True, True, False, False, False])           # the three vertices whose ray hit the belt
    edge = near & ~np.isnan(g) & np.array([True, True, True, False, False, False])   # the gate's lateral/height selection

    expect("0 control: median over the selected vertices", lambda: km.masked_median(g, edge, "edge", "f0"), None)
    assert km.masked_median(g, edge, "edge", "f0") == 0.015, "case 0 must be the masked median, not the whole array"
    expect("1 empty edge set refuses (was 0.0 mm, a pass)", lambda: km.masked_median(g, np.zeros(len(g), bool), "edge", "f0"),
           "selects no vertex")
    missed = near & ~np.isnan(g) & np.zeros(len(g), bool)   # every edge ray missed: the real vacuous case
    expect("2 every ray missed", lambda: km.masked_median(g, missed, "edge", "f0"), "0 of 6")
    expect("3 selected but all NaN", lambda: km.masked_median(g, np.ones(len(g), bool), "edge", "f0"), "no finite median")
    expect("4 one selected vertex", lambda: km.masked_median(g, np.array([1, 0, 0, 0, 0, 0], bool), "edge", "f0"), None)

    src = open(os.path.join(HERE, "units", "inf_kit_v7.py"), encoding="utf-8").read()
    call = lambda what: f"km.masked_median(g, {what}," in src
    site_bad = []
    if not (call("edge") and call("band")):
        site_bad.append("groin_fit does not send both selections through masked_median")
    body = src.split("def groin_fit")[1].split("def v7_groin")[0]
    if "else 0.0" in body or "if band.any() else None" in src:
        site_bad.append("the vacuous empty-set pass is back in groin_fit")
    print(("ok   " if not site_bad else "FAIL ") + "5 groin_fit routes both selections through the refusal")
    bad += [f"5 {b}" for b in site_bad]
    for b in bad:
        print("FAIL", b)
    print(f"6 checks: " + ("FAIL" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
