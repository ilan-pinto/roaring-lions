"""Author art/src/buildings/apartment.blend.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_apartment.py

Four storeys: 520 HP a tile, four garrison slots, 14 ROE points. The most
valuable thing on the map to hold and the second most expensive to destroy, so it
has to look worth both.

Footprint is 5x4 tiles from data/maps ('a' appears as five columns across four
rows, and elsewhere as six across three -- both project to 4.5 tiles of screen
width, since a w x h footprint spans (w + h) / 2, so one sprite serves both).

Its silhouette job is to separate from the house and the concrete block, the
other two flat-roofed masses. A first pass at two storeys put all three at 0.45 to
0.50 height over projected width and pairwise IoU up to 0.860, past the 0.85
ceiling. So this is now unambiguously the tall one, and the concrete block is
unambiguously the squat one, with the house between them.

Shape carries the rest: a stepped setback on the top floor, a stair tower
breaking the roofline, roof tanks, and triangular merlons where every other flat
roof in the set has square ones.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

W = kit.tiles(5) - 0.9   # 14.1
D = kit.tiles(4) - 0.9   # 11.1
F = 3.00                 # storey

# Three full floors, not two. The first pass came out at 0.50 height over
# projected width, against 0.45 for the house and 0.47 for the concrete block --
# three buildings of one shape, and pairwise IoU of 0.849 to 0.860 against a 0.85
# ceiling. Absolute height cannot fix that, because the render frame is sized to
# each building's own reach and downsampling normalises height away; that is what
# put the discarded generator at 0.950. Proportion is the lever, so this becomes
# unambiguously the tall one at about 0.66, and four garrison slots against the
# house's two supports it.
LOW_ROOF = 3 * F         # 9.00, top of the three full floors
TOP_H = 2.80
TOP_ROOF = LOW_ROOF + TOP_H   # 11.80
PARAPET = 0.78

S = -D / 2
N = D / 2
WW = -W / 2
E = W / 2

# The top floor steps back from the south and east faces, so the setback is on
# the two sides the camera sees.
TW = W - 4.10
TD = D - 3.00
TCX = WW + TW / 2 + 0.30
TCY = N - TD / 2 - 0.30

kit.new_scene()

# --- the three full floors ----------------------------------------------------
kit.box("Floor_0", (W, D, F), (0, 0, F / 2), "wall")
kit.box("Floor_1", (W, D, F), (0, 0, F + F / 2), "wall")
kit.box("Floor_2", (W, D, F), (0, 0, 2 * F + F / 2), "wall")
kit.trim_band("Band_0", (W, D), F - 0.16, height=0.30, overhang=0.17)
kit.trim_band("Band_1", (W, D), 2 * F - 0.16, height=0.30, overhang=0.17)
kit.trim_band("Band_2", (W, D), LOW_ROOF - 0.34, height=0.34, overhang=0.22)

# The exposed roof of floor 2, an L around the setback.
kit.roof_deck("Roof_low", (W, D), LOW_ROOF, inset=0.34)
kit.ring("Parapet_low", (W, D), PARAPET, 0.34, LOW_ROOF, "wall")
# Triangular merlons -- the house has square ones, and this is the cheapest way
# to make two flat roofs read as different buildings.
kit.merlon_row("Merlon_low_S", (WW + 0.8, S - 0.10), (E - 0.8, S - 0.10), LOW_ROOF + PARAPET, 9, 0.46, "triangle")
kit.merlon_row("Merlon_low_E", (E + 0.10, S + 0.8), (E + 0.10, N - 0.8), LOW_ROOF + PARAPET, 7, 0.46, "triangle")
kit.merlon_row("Merlon_low_N", (WW + 0.8, N + 0.10), (E - 0.8, N + 0.10), LOW_ROOF + PARAPET, 9, 0.46, "triangle")
kit.merlon_row("Merlon_low_W", (WW - 0.10, S + 0.8), (WW - 0.10, N - 0.8), LOW_ROOF + PARAPET, 7, 0.46, "triangle")

# --- the setback storey -----------------------------------------------------
kit.box("Floor_3", (TW, TD, TOP_H), (TCX, TCY, LOW_ROOF + TOP_H / 2), "wall")
kit.roof_deck("Roof_top", (TW, TD), TOP_ROOF, inset=0.30, centre=(TCX, TCY))
kit.ring("Parapet_top", (TW, TD), PARAPET, 0.32, TOP_ROOF, "wall", centre=(TCX, TCY))
kit.trim_band("Band_top", (TW, TD), TOP_ROOF - 0.32, height=0.32, overhang=0.20, centre=(TCX, TCY))
kit.merlon_row(
    "Merlon_top_S", (TCX - TW / 2 + 0.7, TCY - TD / 2 - 0.10), (TCX + TW / 2 - 0.7, TCY - TD / 2 - 0.10),
    TOP_ROOF + PARAPET, 6, 0.44, "triangle",
)
kit.merlon_row(
    "Merlon_top_E", (TCX + TW / 2 + 0.10, TCY - TD / 2 + 0.7), (TCX + TW / 2 + 0.10, TCY + TD / 2 - 0.7),
    TOP_ROOF + PARAPET, 5, 0.44, "triangle",
)

# --- stair tower: breaks the roofline on the far corner ---------------------
TOWER = 2.55
kit.box("Tower", (TOWER, TOWER, TOP_H + 0.70), (E - TOWER / 2 - 0.5, S + TOWER / 2 + 0.5, LOW_ROOF + (TOP_H + 0.70) / 2), "wall")
kit.ring("Tower_cap", (TOWER, TOWER), 0.55, 0.26, LOW_ROOF + TOP_H + 0.70, "wall",
         centre=(E - TOWER / 2 - 0.5, S + TOWER / 2 + 0.5))
kit.arch_opening("Tower_win", 0.70, 1.30, (E - TOWER / 2 - 0.5, S + 0.5, LOW_ROOF + 0.85), face="S")

# --- roof clutter -----------------------------------------------------------
kit.roof_tank("Tank_0", (WW + 2.2, S + 1.9, LOW_ROOF))
kit.roof_tank("Tank_1", (WW + 3.9, S + 1.9, LOW_ROOF))

# --- openings and balconies -------------------------------------------------
kit.arch_opening("Entry", 1.45, 2.55, (-3.6, S, 0.0), face="S")
kit.window_row("Win_S0", (-1.5, S), (E - 1.1, S), 1.15, 3, (0.60, 1.25), face="S")
kit.window_row("Win_S1", (WW + 1.1, S), (E - 1.1, S), F + 0.95, 5, (0.58, 1.20), face="S")
kit.window_row("Win_W0", (WW, S + 1.3), (WW, N - 1.3), 1.15, 3, (0.60, 1.25), face="W")
kit.window_row("Win_W1", (WW, S + 1.3), (WW, N - 1.3), F + 0.95, 3, (0.58, 1.20), face="W")
kit.window_row("Win_S2", (WW + 1.1, S), (E - 1.1, S), 2 * F + 0.95, 5, (0.58, 1.20), face="S")
kit.window_row("Win_W2", (WW, S + 1.3), (WW, N - 1.3), 2 * F + 0.95, 3, (0.58, 1.20), face="W")
kit.window_row(
    "Win_S3", (TCX - TW / 2 + 1.0, TCY - TD / 2), (TCX + TW / 2 - 1.0, TCY - TD / 2),
    LOW_ROOF + 0.95, 4, (0.56, 1.15), face="S",
)

# Balconies on the first floor, low enough to read against the wall behind.
for i, x in enumerate((-4.3, 0.4, 4.6)):
    kit.stilted_balcony(f"Balcony_{i}", (2.35, 1.10), (x, S - 0.52, F + 0.22), post_height=0.0, posts=0)
    kit.box(f"Balcony_{i}_bracket", (0.20, 0.55, 0.42), (x, S - 0.30, F - 0.05), "wood")

kit.save(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "art", "src", "buildings", "apartment.blend",
))
