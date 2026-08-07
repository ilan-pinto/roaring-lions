"""Author art/src/buildings/house.blend.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_house.py

The house is the reference pack's archetype and carries most of its vocabulary:
two storeys of coursed masonry, a parapet with square merlons, a terracotta trim
band, a zigzag frieze, an external stair to the roof, and a projecting latticed
mashrabiya bay on stilts.

Footprint is 4x3 tiles, taken from data/maps/beit_sahwan_outskirts.json where
'h' appears as four columns across three rows -- not invented. At 3.0 units per
tile that is 12 x 9 units, and the parapet tops out at 6.7: two storeys at about
3 units each, which is what `height_px` 16 against a 64px tile has always meant
proportionally.

Its silhouette job is to separate from the warehouse, whose height-to-width is
0.54 against this one's 0.56. Proportion cannot do that, so the stair and the
projecting bay do: both break the outline in ways a long ridged shed does not.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

# 4x3 tiles at 3.0 units. Kept a little inside the footprint so neighbouring
# buildings on adjacent tiles do not visually collide.
W = kit.tiles(4) - 0.9   # 11.1
D = kit.tiles(3) - 0.9   # 8.1

F0 = 3.05                # ground storey height
F1 = 2.85                # upper storey height
ROOF = F0 + F1           # 5.90 -- top of the walls
PARAPET = 0.80           # so the building tops out at 6.70

S = -D / 2               # south face, toward the camera
N = D / 2
WW = -W / 2
E = W / 2

kit.new_scene()

# --- mass -------------------------------------------------------------------
kit.box("Floor_0", (W, D, F0), (0, 0, F0 / 2), "wall")
kit.box("Floor_1", (W, D, F1), (0, 0, F0 + F1 / 2), "wall")

# The roof deck is its own object on a darker tone. As the top face of a wall
# cube it took the wall material and the key light blew it to bare white.
kit.roof_deck("Roof", (W, D), ROOF, inset=0.30)

# --- parapet and coping -----------------------------------------------------
kit.ring("Parapet", (W, D), PARAPET, 0.34, ROOF, "wall")
kit.trim_band("Coping", (W, D), ROOF + PARAPET - 0.30, height=0.30, overhang=0.20)

# Square merlons on all four edges. The camera at azimuth 225 sees the south and
# west walls, but it is the FAR parapets -- north and east -- that stand
# silhouetted above the roof, so crowning only the near two wastes the feature.
# Merlons are four verts each; there is no reason to be frugal.
kit.merlon_row("Merlon_S", (WW + 0.7, S - 0.10), (E - 0.7, S - 0.10), ROOF + PARAPET, 7, 0.46, "square")
kit.merlon_row("Merlon_N", (WW + 0.7, N + 0.10), (E - 0.7, N + 0.10), ROOF + PARAPET, 7, 0.46, "square")
kit.merlon_row("Merlon_E", (E + 0.10, S + 0.7), (E + 0.10, N - 0.7), ROOF + PARAPET, 5, 0.46, "square")
kit.merlon_row("Merlon_W", (WW - 0.10, S + 0.7), (WW - 0.10, N - 0.7), ROOF + PARAPET, 5, 0.46, "square")

# --- storey division --------------------------------------------------------
kit.trim_band("Band_1", (W, D), F0 - 0.15, height=0.28, overhang=0.16)
kit.zigzag_frieze("Frieze_S", (WW + 0.8, S - 0.07), (E - 0.8, S - 0.07), F0 + F1 - 0.55, 13)

# --- openings ---------------------------------------------------------------
# Ground floor: the arched door, off-centre so the elevation is not symmetrical.
kit.arch_opening("Door", 1.30, 2.35, (-2.4, S, 0.0), face="S")
kit.window_row("Win_S0", (0.4, S), (E - 1.0, S), 1.20, 2, (0.62, 1.20), face="S")
kit.window_row("Win_S1", (WW + 1.0, S), (E - 1.0, S), F0 + 0.95, 4, (0.58, 1.15), face="S")
kit.window_row("Win_E1", (E, S + 1.2), (E, N - 1.2), F0 + 0.95, 2, (0.58, 1.15), face="E")

# --- the two outline-breakers ----------------------------------------------
# Stair climbing the WEST face, hugging the wall so it projects only its own
# width and the footprint does not grow.
#
# West, not east. The camera sits at azimuth 225 and therefore sees the south and
# west walls; an earlier pass put the stair on the east face, where it rendered
# entirely behind the building and contributed nothing. West also earns its keep
# twice, because that wall is otherwise blank.
kit.external_stair(
    "Stair", (WW - 0.68, N - 0.7), (WW - 0.68, S + 0.7), ROOF, width=1.36, steps=10
)
kit.window_row("Win_W1", (WW, S + 1.4), (WW, N - 1.4), F0 + 0.95, 3, (0.58, 1.15), face="W")

# The mashrabiya bay, carried on posts over the south face at first-floor level.
kit.mashrabiya("Bay", (3.20, 1.35, 2.35), (1.9, S - 0.62, F0 + 0.20))
kit.stilted_balcony("Bay_stilts", (3.20, 1.35), (1.9, S - 0.62, F0 + 0.20), post_height=F0 + 0.20, posts=2)

kit.save(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "art", "src", "buildings", "house.blend",
))
