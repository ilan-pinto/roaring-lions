"""Render the Eitan APC as separate hull and turret sprite sheets.

Output:
  assets/sprites/EITAN_HULL/idle_f{facing}_000.png    (16 facings)
  assets/sprites/EITAN_HULL/wreck_f{facing}_000.png   (16 facings)
  assets/sprites/EITAN_TURR/idle_f{facing}_000.png    (16 facings)

Must be followed by the quantizer, or `pnpm validate:assets` rejects every
frame:

    blender --background --python tools/render_eitan.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/LPMAC_military_truck.blend (gitignored -- .blend sources are
too large to track; see .gitignore)
LICENCE UNVERIFIED -- downloaded without licence, readme or attribution.
Do not redistribute until the terms are established.
"""
import os
import sys

# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/LPMAC_military_truck.blend"),
    out_hull=os.path.abspath("assets/sprites/EITAN_HULL"),
    out_turr=os.path.abspath("assets/sprites/EITAN_TURR"),
    # The traversing weapon station. Everything else is hull.
    turret_meshes={"turret high", "gun high", "turret mantlet high"},
    # How many tiles wide the sprite draws. The tank is 1.8; an Eitan is a
    # little shorter than a Merkava.
    scale=1.6,
    credit="LPMAC military truck. LICENCE UNVERIFIED, see tools/render_eitan.py",
    hull_unit="eitan_apc_hull",
    turret_unit="eitan_apc_turret",
    # Studio backdrop, 134 units long. Rendering it fills the entire frame.
    exclude_prefixes=("Plane",),
)

render_vehicle(SPEC)
