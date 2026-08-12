"""Author art/src/buildings/wall.blend.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_wall.py

The compound wall: 90 HP a tile, no garrison slots, no ROE cost. The first
structure in the set you cannot fight from, and the first drawn per tile
rather than per footprint -- a wall run is any length, so one sprite has to
serve every tile of it.

Square in plan on purpose. In dimetric an east-west wall and a north-south
wall are different shapes, so a single sprite can only serve both if the
segment has no long axis. Authored a full tile across (3.0 units) so
consecutive tiles abut with no seam.

Silhouette: nothing else in the set is a low flat bar. The five authored
buildings occupy 0.28 (shanty), 0.41 (warehouse), 0.45 (house), 0.66
(apartment) and ~0.85 (concrete) against their nearest neighbour; a segment
1.75 units tall on a 3.0-unit base is far below all of them, so the IoU gate
has room. The coping is the only feature, and it is what stops this reading
as an untextured block.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

W = kit.tiles(1)          # 3.0 -- full tile, so runs abut
D = kit.tiles(1)          # 3.0 -- square, so one sprite reads in both directions
BODY = 1.55
COPING_H = 0.20
COPING_OVER = 0.12

kit.new_scene()
kit.box("Body", (W, D, BODY), (0.0, 0.0, BODY / 2.0), role="wall")
kit.box(
    "Coping",
    (W + COPING_OVER * 2.0, D + COPING_OVER * 2.0, COPING_H),
    (0.0, 0.0, BODY + COPING_H / 2.0),
    role="trim",
)

kit.save(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "art", "src", "buildings", "wall.blend",
))
