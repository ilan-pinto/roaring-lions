"""Render the Shoded Jeep as a hull sprite sheet.

Hull only: this model carries no separately modelled weapon station -- no
turret, no gun, no pintle mount -- so there is nothing to render as an
independently traversing layer. The unit's pintle_mg fires from the hull.

Output:
  assets/sprites/JEEP_HULL/idle_f{facing}_000.png    (16 facings)
  assets/sprites/JEEP_HULL/wreck_f{facing}_000.png   (16 facings)

Must be followed by the quantizer, or `pnpm validate:assets` rejects every
frame:

    blender --background --python tools/render_jeep.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/jeep_shoded.blend (gitignored -- .blend sources are too large
to track; see .gitignore)
LICENCE UNVERIFIED -- downloaded without licence, readme or attribution.
Do not redistribute until the terms are established.
"""
import os
import sys

# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/jeep_shoded.blend"),
    out_hull=os.path.abspath("assets/sprites/JEEP_HULL"),
    # Never written: turret_meshes is empty, so render_vehicle stops after the
    # hull sheet. The path is required by the dataclass, not used.
    out_turr=os.path.abspath("assets/sprites/JEEP_TURR_UNUSED"),
    # The body measures about 4.6m against the Eitan's 8m at 1.6, and a jeep
    # has to read visibly smaller than an APC at a glance.
    scale=1.1,
    credit="Military jeep. LICENCE UNVERIFIED, see tools/render_jeep.py",
    hull_unit="jeep_shoded_hull",
    turret_unit="jeep_shoded_turret",
    # Ground is a 153x89 backdrop; LightSource is an 8x8 emitter plane sitting
    # directly over the roof, which rendered as a grey slab and threw the whole
    # vehicle into shadow.
    exclude_prefixes=("Ground", "LightSource"),
    # This file's own lights blow the roof and bonnet to pure white on top of
    # the rig's key and fill. Confirmed by comparing test renders both ways.
    strip_source_lights=True,
)

render_vehicle(SPEC)
