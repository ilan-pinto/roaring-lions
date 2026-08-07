"""Guards the render camera's geometry against the bug it just had.

Run: python3 tools/test_dimetric.py
Exits non-zero on failure. Dependency-free, matching test_representative.py --
the repo's test runner is vitest, and pytest for two tools would be heavier than
the thing it tests.
"""
import importlib.util
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("dimetric", os.path.join(HERE, "dimetric.py"))
dm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dm)

failures = []


def check(label, got, want, tol=1e-9):
    if abs(got - want) > tol:
        failures.append(f"{label}: got {got!r}, want {want!r}")


# The bug itself. A ground square projects with height/width = sin(elevation),
# and the renderer's grid is 32/64, so anything but 0.5 puts sprites on a ground
# plane that does not match the tiles they are drawn on.
check("sin(ELEVATION) must equal the tile aspect", math.sin(dm.ELEVATION), 0.5)
check("ELEVATION in degrees", math.degrees(dm.ELEVATION), 30.0, tol=1e-9)
if abs(dm.ELEVATION - math.atan(0.5)) < 1e-6:
    failures.append(
        "ELEVATION has regressed to atan(0.5) = 26.565 deg. That is the bug this "
        "module exists to prevent: its sine is 0.4472, not 0.5."
    )

# The scale formula, against the one building already in the tree. The mosque's
# measured render extent is 10.800 units and it shipped a hand-tuned scale of
# 3.6, so the old framing (extent * 1.30) must produce 3.309 -- the mosque draws
# about 9% too large today.
check("tiles_across(mosque's old frame)", dm.tiles_across(10.800 * 1.30), 3.309, tol=5e-4)
check(
    "tiles_across keeps 3 units to a tile",
    # A frame exactly sqrt(2) * 3 units wide must draw as one tile.
    dm.tiles_across(dm.UNITS_PER_TILE * math.sqrt(2)),
    1.0,
)
check("tiles_across is linear in the frame", dm.tiles_across(20.0) / dm.tiles_across(10.0), 2.0)

# The projection itself. A ground square's diagonal corners must land at the same
# |u| and the tile aspect must fall out of v.
u1, v1 = dm.camera_uv(1, 0, 0)
u2, v2 = dm.camera_uv(0, 1, 0)
check("camera_uv is symmetric in x and y", u1, -u2)
check("camera_uv lifts x and y equally", v1, v2)
check("a ground square projects at the tile aspect", v1 / u1, 0.5)
_, vz = dm.camera_uv(0, 0, 1)
check("world z is foreshortened by cos(elevation)", vz, math.cos(dm.ELEVATION))

# Frame sizing must respect height, not just width. A tall thin mast is the case
# that broke the house: wide by nothing, tall by a lot.
mast = [(0, 0, 0), (0, 0, 10)]
check("ortho_scale_for sizes on vertical reach", dm.ortho_scale_for(mast, 1.0), 2 * 10 * math.cos(dm.ELEVATION))
flat = [(-3, -3, 0), (3, 3, 0)]
# |u| is 0 along the x=y diagonal, so this one is sized purely by v.
check("ortho_scale_for sizes on horizontal reach", dm.ortho_scale_for(flat, 1.0), 2 * dm.camera_uv(3, 3, 0)[1])
check("ortho_scale_for applies the margin", dm.ortho_scale_for(mast, 1.5) / dm.ortho_scale_for(mast, 1.0), 1.5)
check(
    "ortho_scale_for measures from the aim point, not the origin",
    dm.ortho_scale_for([(5, 5, 0)], 1.0, aim=(5, 5, 0)),
    0.0,
)

# The badge fix, against the measured mosque sprite: opaque rows start at 2 of
# 256, scale 3.6, so the art's top is 113.4px above the anchor -- against the 46px
# (heightPx 34 + 12) the renderer used, hence 67px buried.
check("badge_top_px on the shipped mosque", dm.badge_top_px(2, 256, 3.6), 113.4, tol=0.05)
check("badge_top_px at the canvas centre is zero", dm.badge_top_px(128, 256, 3.6), 0.0)

# Framing, against the same sprite: rows 2..212, cols 5..249 of 256.
check("framing_clearance on the shipped mosque", dm.framing_clearance(2, 5, 212, 249, 256), 2)
check("framing_clearance when art touches an edge", dm.framing_clearance(0, 5, 212, 249, 256), 0)

# Every render script must take the elevation from here rather than keeping its
# own copy. Six of them had one, and all six were wrong.
own_constant = re.compile(r"DIMETRIC_ELEVATION\s*=\s*math\.(atan|asin|radians)")
for name in sorted(os.listdir(HERE)):
    if not (name.startswith("render_") and name.endswith(".py")):
        continue
    with open(os.path.join(HERE, name)) as fh:
        src = fh.read()
    if own_constant.search(src):
        failures.append(
            f"{name} computes its own DIMETRIC_ELEVATION. Import ELEVATION from "
            f"dimetric.py instead -- six local copies is how this got wrong."
        )

if failures:
    print(f"FAIL ({len(failures)})")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ok -- dimetric geometry, scale, badge and framing arithmetic")
