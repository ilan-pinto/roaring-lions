"""Author art/src/buildings/warehouse.blend.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_warehouse.py

A clear-span shed: 340 HP a tile, three garrison slots, and only 3 ROE points --
the cheapest thing in the set to flatten. A player has to be able to see that,
which is the practical argument for distinctness over consistency.

Footprint is 4x4 tiles from data/maps ('w' as four columns across four rows), so
12x12 units square -- the only square footprint besides the 3x3s.

Its silhouette job is the hard one. Height-to-width is 0.53 against the house's
0.56, so proportion cannot separate them and the roof has to. Everything else in
the set is flat-topped behind a parapet; this is a gabled ridge with no parapet
at all, plus a roller door wide enough to read at gameplay zoom.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

W = kit.tiles(4) - 0.8   # 11.2
D = kit.tiles(4) - 0.8   # 11.2
EAVE = 4.30
RISE = 2.10              # ridge at 6.40

S = -D / 2
N = D / 2
WW = -W / 2
E = W / 2

kit.new_scene()

# --- the box ----------------------------------------------------------------
kit.box("Hall", (W, D, EAVE), (0, 0, EAVE / 2), "wall")
kit.trim_band("Eave_band", (W, D), EAVE - 0.34, height=0.34, overhang=0.26)

# --- the gable --------------------------------------------------------------
# Two pitches meeting on a ridge along x at y = 0. Sheet metal, so it reads as a
# different material from every masonry roof in the set as well as a different
# shape.
kit.wedge("Roof_S", (W + 0.7, D / 2 + 0.35, RISE), (0, -(D / 2 + 0.35) / 2, EAVE), "metal", axis="y")
kit.wedge("Roof_N", (W + 0.7, D / 2 + 0.35, RISE), (0, (D / 2 + 0.35) / 2, EAVE), "metal", axis="y", flip=True)
kit.box("Ridge_cap", (W + 0.8, 0.34, 0.22), (0, 0, EAVE + RISE + 0.02), "trim")

# Ventilators along the ridge: cheap, and roof clutter is silhouette.
for i, x in enumerate((-3.4, 0.0, 3.4)):
    kit.ventilator(f"Vent_{i}", (x, 0.0, EAVE + RISE))

# --- the working face -------------------------------------------------------
# Roller door, deliberately oversized: at ~300px on screen a normal door would be
# 12px and read as nothing.
kit.roller_door("Door", (4.10, 3.40), (-0.6, S - 0.11, 0.0), face="S")
kit.box("Dock", (5.00, 1.55, 0.55), (-0.6, S - 0.78, 0.275), "wall")
kit.box("Dock_lip", (5.00, 0.20, 0.16), (-0.6, S - 1.50, 0.55), "metal")

# A pedestrian door, so the roller door has something to be bigger than.
kit.box("Door_man", (1.00, 0.14, 2.05), (4.10, S, 1.02), "wood")

# Clerestory strip: high windows are what an industrial shed has instead of
# domestic ones, and they sit above the door head so the two do not compete.
kit.window_row("Win_S", (WW + 1.3, S), (E - 1.3, S), 3.20, 5, (0.66, 0.72), face="S")
kit.window_row("Win_W", (WW, S + 1.3), (WW, N - 1.3), 3.20, 5, (0.66, 0.72), face="W")

kit.save(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "art", "src", "buildings", "warehouse.blend",
))
