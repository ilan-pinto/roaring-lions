"""Guards the render camera's geometry against the bug it just had.

Run: python3 tools/test_dimetric.py
Exits non-zero on failure. Dependency-free, matching test_representative.py --
the repo's test runner is vitest, and pytest for two tools would be heavier than
the thing it tests.
"""
import importlib.util
import json
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

# The scale contract. A unit's manifest scale is the canvas width in tiles,
# compressed by its size class -- no longer a hand-typed number per sheet.
check(
    "unit_scale is tiles_across times the class multiplier",
    dm.unit_scale(10.0, "heavy_vehicle"),
    dm.tiles_across(10.0) * dm.SIZE_CLASS["heavy_vehicle"],
)
check("infantry draws at life size", dm.SIZE_CLASS["infantry"], 1.0)
try:
    dm.unit_scale(10.0, "spaceship")
    failures.append("unit_scale accepted an unknown size class")
except KeyError:
    pass

# metres_per_unit is a conversion, not a transform: a model measuring 6.32 of its
# own units and declared as 6.32 m is already in metres.
check("metres_per_unit on a model already in metres", dm.metres_per_unit(6.32, 6.32), 1.0)
check("metres_per_unit scales up a small model", dm.metres_per_unit(2.0, 8.0), 4.0)
try:
    dm.metres_per_unit(0.0, 8.0)
    failures.append("metres_per_unit accepted a zero extent")
except ValueError:
    pass

# The margin must not change a unit's size on screen. This is the property that
# lets the frame be driven by whatever the geometry needs: on-screen width is
# scale * TILE_W * (object / frame), and scale rises with the frame, so the frame
# cancels. Got wrong once while designing this, hence the test.
def on_screen_px(object_u, ortho_scale, size_class):
    return dm.unit_scale(ortho_scale, size_class) * dm.TILE_W * (object_u / ortho_scale)


check(
    "a wider margin does not change on-screen size",
    on_screen_px(4.0, 4.24, "infantry"),
    on_screen_px(4.0, 8.48, "infantry"),
    tol=1e-9,
)

# Frame sizing for a unit must hold at every facing, because a unit turns. A long
# hull reaches its full length across the frame at one facing and much less at
# another; framing one orientation crops the others.
long_hull = [(-3.8, 0.0, 0.0), (3.8, 0.0, 0.0)]
check(
    "a turning frame is sized on horizontal radius, not current bearing",
    dm.ortho_scale_for_turning(long_hull, 1.0),
    2 * 3.8,
)
check(
    "ortho_scale_for_turning is invariant to bearing",
    dm.ortho_scale_for_turning([(0.0, 3.8, 0.0), (0.0, -3.8, 0.0)], 1.0),
    dm.ortho_scale_for_turning(long_hull, 1.0),
)
# ortho_scale_for would report less for the same hull at this bearing, which is
# exactly the cropping bug. Along x=y, |u| is 0 and only v carries the extent.
if dm.ortho_scale_for([(3.8, 3.8, 0.0), (-3.8, -3.8, 0.0)], 1.0) >= 2 * 3.8:
    failures.append(
        "ortho_scale_for now covers a rotated hull, so ortho_scale_for_turning "
        "may be redundant -- check before removing it."
    )
check(
    "z_pad extends vertical reach",
    dm.ortho_scale_for_turning([(0.0, 0.0, 0.0)], 1.0, z_pad=2.0),
    4.0,
)

# Every render script must take the elevation and the sun from here rather than
# keeping its own copy. Six had their own elevation and all six were wrong; four
# had their own sun, and those agreed only by luck.
own_constant = re.compile(r"DIMETRIC_ELEVATION\s*=\s*math\.(atan|asin|radians)")
own_sun = re.compile(r"lights\.new\(\s*[\"'](KEY|Key|FILL|Fill|Sun|SUN)")
# render_building.py is the one legitimate exception and says why in its own
# header: a vehicle is mostly horizontal surface and a 55-degree key against a
# black world works, whereas a building is mostly vertical wall and comes out
# near-black without ambient. That is a real difference, not drift.
SUN_EXEMPT = {"render_building.py"}
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
    if name not in SUN_EXEMPT and own_sun.search(src):
        failures.append(
            f"{name} builds its own sun. Call dimetric.build_lights() instead -- "
            f"four copies of azimuth 135 / altitude 55 / key 4.0 agreed by luck, "
            f"which is how the elevation bug hid."
        )

# The facing offset, and the shipped manifests that must declare it. Nine infantry
# sheets went out with 0, so every team was drawn a quarter-turn short of three
# quarters -- 270 degrees off the direction the sim had it facing.
check("facing_offset is three quarters of a turn", dm.facing_offset(16), 12)
check("facing_offset scales with the sheet", dm.facing_offset(8), 6)

_sprites = os.path.join(os.path.dirname(HERE), "assets", "sprites")
if os.path.isdir(_sprites):
    want = dm.facing_offset(16)
    for name in sorted(os.listdir(_sprites)):
        if not name.startswith("INF_"):
            continue
        mf = os.path.join(_sprites, name, "manifest.json")
        if not os.path.isfile(mf):
            continue
        with open(mf) as fh:
            man = json.load(fh)
        if man.get("facings") != 16:
            continue
        got = man.get("facingOffset")
        if got != want:
            failures.append(
                f"{name}/manifest.json declares facingOffset={got}, expected {want}. "
                f"A kit figure's forward is +x, so it takes the rig offset unmodified; "
                f"see dimetric.facing_offset."
            )

if failures:
    print(f"FAIL ({len(failures)})")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ok -- dimetric geometry, scale, badge and framing arithmetic")
