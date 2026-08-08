"""Render the Namer IFV as separate hull and turret sprite sheets.

Output:
  assets/sprites/NAMER_HULL/idle_f{facing}_000.png    (16 facings)
  assets/sprites/NAMER_HULL/wreck_f{facing}_000.png   (16 facings)
  assets/sprites/NAMER_TURR/idle_f{facing}_000.png    (16 facings)

Must be followed by the quantizer, or `pnpm validate:assets` rejects every
frame:

    blender --background --python tools/render_namer.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/ifv_dmm08.blend (gitignored -- .blend sources are too large to
track; see .gitignore). Licence page committed at
art/src/ifv_dmm08_LICENSE.html.

LICENCE: VEHICLE IFV DMM08 by Mutte, BlendSwap #75225, Creative Commons
Attribution 3.0. Any purpose, attribution required.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/ifv_dmm08.blend"),
    out_hull=os.path.abspath("assets/sprites/NAMER_HULL"),
    out_turr=os.path.abspath("assets/sprites/NAMER_TURR"),
    # The cannon turret and the secondary remote station traverse together.
    # "TURRENT" is the model's own spelling.
    turret_meshes={
        "TURRENT_BODY",
        "CANNON",
        "CANNON_BASE",
        "REMOT_BODY",
        "REMOT_GUN",
    },
    # A Namer is 7.5m long. This model is already in real metres and measures
    # 6.92, so the derivation scales it up by 8% to the vehicle it represents.
    real_metres=7.5,
    size_class="heavy_vehicle",
    credit="Mutte (CC-BY 3.0, BlendSwap #75225)",
    hull_unit="namer_ifv_hull",
    turret_unit="namer_ifv_turret",
    # No backdrop or emitter planes in this file.
    exclude_prefixes=(),
    # This source's own Sun + two Hemi lights mix with the rig's key/fill to
    # cast a visible blue-navy patch on the lower front glacis in every
    # facing (checked idle f00, f08, and wreck f00). Stripped, the hull reads
    # as one consistent olive/gunmetal tone with no colour cast.
    strip_source_lights=True,
)

render_vehicle(SPEC)
