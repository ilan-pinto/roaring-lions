"""Report what probe_part_visibility.py rendered. Plain python, no Blender.

    python3 tools/vehicles/report_part_visibility.py wheel_

Reads /tmp/probe_{all,without,control} and prints the pixel contribution per facing.
The control line comes first on purpose: if removing a known-visible part changes
nothing, the run is broken and the numbers below it mean nothing.
"""
import sys

import numpy as np
from PIL import Image

THRESHOLD = 18          # per-pixel RGB sum difference that counts as a change
STEP = 2


def rgb(tag, f):
    return np.array(
        Image.open(f"/tmp/probe_{tag}/idle_f{f:02d}_000.png").convert("RGB")
    ).astype(int)


def opaque(tag, f):
    return np.array(
        Image.open(f"/tmp/probe_{tag}/idle_f{f:02d}_000.png").convert("RGBA")
    )[:, :, 3] > 128


def changed(a, b):
    return int((np.abs(a - b).sum(axis=2) > THRESHOLD).sum())


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "the parts"

    control = changed(rgb("all", 0), rgb("control", 0))
    ok = control > 100
    print(f"CONTROL  removing hull_upper changes {control} px -> "
          f"{'probe is measuring' if ok else 'PROBE IS BROKEN, ignore everything below'}")
    if not ok:
        return 1

    print()
    print(f" facing | {label} px | share of hull")
    total = 0
    for f in range(0, 16, STEP):
        n = changed(rgb("all", f), rgb("without", f))
        total += n
        hull = max(int(opaque("all", f).sum()), 1)
        print(f"   {f:3d}  | {n:8d}  | {n * 100.0 / hull:5.1f}%")
    print()
    print(f"total {total} px across {16 // STEP} facings")
    # Over 100% is expected rather than a bug: removing a part also removes the
    # ground shadow it cast, so the compared masks differ in area too.
    if total == 0:
        print("-> these parts contribute nothing to the sprite; they are occluded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
