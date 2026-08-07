"""Author art/src/buildings/shanty.blend.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_shanty.py

The breeze-block shed: 120 HP a tile, one garrison slot, 2 ROE points. The
cheapest thing on the map and it should look it.

Footprint is 3x3 tiles from data/maps ('s' as three columns across three rows),
so 9x9 units, but the shanty deliberately does NOT fill it. A compound of a shed,
a lean-to annex and a scrap of yard wall reads as improvised where a single block
would read as a small house.

Its silhouette job is the easiest in the set: at 2.5 units over a 9-unit
footprint its height-to-width is 0.28, against 0.53 for the warehouse and 0.56
for the house, and it is one of only two buildings with a pitched roof. Sloped,
low and asymmetric separates it from everything.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

kit.new_scene()

# --- the shed ---------------------------------------------------------------
SHED_H = 1.90
kit.box("Shed", (5.60, 4.20, SHED_H), (-1.10, 0.50, SHED_H / 2), "wall")
# Corrugated mono-pitch, falling toward the south so the low eave faces the
# camera. Metal, not masonry: it is the one roof in the set that is sheet.
#
# The pitch is 1.15 over 4.32, steeper than a real shanty would bother with, for a
# measured reason: at 0.62 the roof was near enough horizontal to take the key's
# full ~2.5x boost, and a near-horizontal plane climbs about two steps up whatever
# ramp it is on. Steepening also earns silhouette, since pitched-and-low is what
# separates this building from everything else in the set.
#
# The main planes use `roof`, not `metal` or `rust`, and both alternatives were
# tried and measured. `metal` came back 8.8% olive.2 -- gunmetal is already
# slightly green and drifts into the olive ramp in shadow, which is moss on a
# desert shed. `rust` came back 42.6% terracotta, because a three-step ramp has
# nowhere to climb: terracotta.2 lands on terracotta.0 and reads as glazed Spanish
# tile. `roof` lands in warm sand like every other roof here, and the pitch
# carries the distinction on its own.
kit.wedge("Shed_roof", (5.75, 4.32, 1.15), (-1.10, 0.50, SHED_H), "roof", axis="y")
kit.box("Shed_eave", (5.75, 0.16, 0.13), (-1.10, 0.50 - 2.16, SHED_H + 0.07), "rust")
# Sheets lifted proud of the rest, because a patched roof is the whole point.
# Small and part-vertical, so `rust` reads as rusted sheet here rather than tile.
kit.box("Sheet_0", (1.50, 1.25, 0.10), (-3.00, 1.30, SHED_H + 0.80), "rust")
kit.box("Sheet_1", (1.15, 1.00, 0.10), (0.55, -0.35, SHED_H + 0.38), "metal")

# --- the lean-to annex ------------------------------------------------------
ANNEX_H = 1.45
kit.box("Annex", (3.20, 2.45, ANNEX_H), (2.85, -1.45, ANNEX_H / 2), "wall")
kit.wedge("Annex_roof", (3.34, 2.62, 0.80), (2.85, -1.45, ANNEX_H), "metal", axis="x", flip=True)

# --- awning over the door: breaks the roof plane -----------------------------
# Flush against the south wall at y = -1.60. Detached, it read as a bench.
kit.box("Awning", (2.60, 1.30, 0.10), (-1.90, -2.25, 1.52), "rust")
kit.box("Awning_post_W", (0.13, 0.13, 1.47), (-3.10, -2.84, 0.735), "wood")
kit.box("Awning_post_E", (0.13, 0.13, 1.47), (-0.70, -2.84, 0.735), "wood")

# --- yard -------------------------------------------------------------------
# A stub of wall and nothing behind it. Breaks the outline and says "compound".
kit.box("Yard_wall", (0.28, 3.40, 1.05), (4.15, 2.50, 0.53), "wall")
kit.box("Yard_post", (0.24, 0.24, 1.30), (4.15, 0.72, 0.65), "wood")

# --- openings: plain holes, no arches --------------------------------------
kit.box("Door", (0.88, 0.14, 1.48), (-1.90, -1.62, 0.74), "glass")
kit.window_row("Win_S", (0.10, -1.62), (1.30, -1.62), 1.05, 1, (0.52, 0.62), face="S")
kit.window_row("Win_W", (-3.92, -0.30), (-3.92, 1.60), 1.05, 2, (0.48, 0.58), face="W")

# --- clutter ----------------------------------------------------------------
# Drums and patches. Roof clutter is silhouette, and at 0.28 height-to-width the
# shanty has little else to offer the outline.
kit.oil_drum("Drum_0", (1.95, 1.85, 0.0), radius=0.38, height=1.05)
kit.oil_drum("Drum_1", (2.78, 2.42, 0.0), radius=0.38, height=1.05)
kit.oil_drum("Drum_2", (-4.10, -2.05, 0.0), radius=0.38, height=1.05)
kit.oil_drum("Drum_3", (-4.10, -2.05, 1.05), radius=0.38, height=1.05)
kit.box("Patch_0", (1.05, 0.10, 0.80), (-2.90, -1.66, 1.15), "rust")
kit.box("Patch_1", (0.72, 0.10, 0.55), (0.05, -1.66, 0.32), "metal")
kit.box("Water_can", (0.42, 0.42, 0.52), (3.60, 0.35, 0.26), "metal")

kit.save(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "art", "src", "buildings", "shanty.blend",
))
