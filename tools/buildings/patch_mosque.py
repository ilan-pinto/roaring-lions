"""Bring art/src/buildings/mosque.blend up to the kit's conventions.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/patch_mosque.py

The mosque was hand-modelled before material roles existed, so render_building.py
falls back to a name heuristic for it: everything gets coursed brick except a few
name fragments. That has two visible costs.

  * **Its roof is the top face of the `Hall` cube**, so it takes the wall material
    and the 55-degree key blows it out. 16.2% of the shipped sprite is bare
    limestone.0 -- the largest single band, and it is glare. Every kit building
    solves this with a separate roof deck on a darker tone; this adds one.

  * **Its doors and windows are brick.** `Door_rect`, `Win_rect_*` and friends are
    thin boxes standing proud of the wall, and with brick on them they read as
    slabs rather than openings. The arch over the door came out as a black blob for
    the same reason -- nothing told the renderer it was a hole.

Run once. It is idempotent: re-running finds the deck already present and only
refreshes the role tags, so it is safe to run after editing the mosque by hand.

This edits a hand-modelled source, so it only ever ADDS a roof deck and sets
custom properties. It moves nothing, deletes nothing, and changes no geometry.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "art", "src", "buildings", "mosque.blend")

DECK = "Hall_roof_deck"

# Role per object, by exact name. Anything not listed keeps the name-heuristic
# fallback, which is correct for the masonry it was written for.
ROLES = {
    "Hall": "wall",
    "Portal": "wall",
    "Hall_roof_trim": "trim",
    "Portal_frame": "trim",
    "Dome_drum": "wall",
    "Dome_main": "dome",
    "Dome_finial": "trim",
    "Minaret_base": "wall",
    "Minaret_shaft": "wall",
    "Minaret_balcony": "trim",
    "Minaret_top": "wall",
    "Minaret_dome": "dome",
    "Minaret_finial": "trim",
    # Openings: dark, so they read as depth rather than as proud brick slabs.
    "Door_rect": "glass",
    "Door_arch": "glass",
}
for i in range(4):
    ROLES[f"Corner_drum_{i}"] = "wall"
    ROLES[f"Corner_dome_{i}"] = "dome"
for i in range(3):
    ROLES[f"Merlon_{i}"] = "wall"
for i in range(4):
    ROLES[f"Win_rect_{i}"] = "glass"
    ROLES[f"Win_arch_{i}"] = "glass"

bpy.ops.wm.open_mainfile(filepath=SRC)

hall = bpy.data.objects.get("Hall")
if hall is None:
    raise SystemExit("mosque.blend has no object named 'Hall' -- has it been restructured?")

added = False
if bpy.data.objects.get(DECK) is None:
    # Sit the deck on the hall's top face, inset so Hall_roof_trim still shows as a
    # coping around it. The hall is 9.0 x 6.5 x 3.0 centred on the origin.
    top = hall.location.z + hall.dimensions.z / 2.0
    kit.box(
        DECK,
        (hall.dimensions.x - 0.20, hall.dimensions.y - 0.20, 0.18),
        (hall.location.x, hall.location.y, top + 0.09),
        "roof",
    )
    added = True

tagged = 0
missing = []
for name, role in ROLES.items():
    ob = bpy.data.objects.get(name)
    if ob is None:
        missing.append(name)
        continue
    ob["rl_role"] = role
    tagged += 1

if missing:
    # Not fatal: the mosque is hand-modelled and may legitimately have been
    # reorganised. Say so rather than failing or silently skipping.
    print(f"  note: {len(missing)} named object(s) absent: {', '.join(sorted(missing))}")

print(f"  roof deck {'added' if added else 'already present'}, {tagged} object(s) tagged")
bpy.ops.wm.save_as_mainfile(filepath=SRC)
print(f"saved {SRC} ({len(bpy.data.objects)} objects)")
