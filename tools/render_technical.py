"""Render the enemy technical's hull and turret sheets.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_technical.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

Cycles output is off-palette with soft alpha, so the quantizer pass is not
optional -- without it the art gate rejects every frame.

SOURCE: art/src/vehicles/technical.blend, built by
tools/vehicles/author_technical.py. Authored from primitives for this repository,
CC BY-SA 4.0, and tracked in plain git.

This is the first sheet to use two features the rig did not have:

* **`role_palette`.** Every other vehicle renders in one flat olive, whose ramp
  role in data/palette.json is literally "KDF vehicle hulls". Painting an enemy
  pickup olive would throw away the faction read that its sun-bleached limestone
  body exists to carry. Note the terrain's primary ramp is limestone too, so the
  dark roles here are load-bearing: without gunmetal fittings and shadow tyres a
  pale truck disappears on pale ground.

* **`turret_axis`.** A pintle gun sits nowhere near the model's centre, and the
  renderer used to composite turret sheets as though every weapon rotated about
  that centre. Measured on this truck the gun sat 16.2% of hull length off it,
  about 16 px of swing whenever it tracked away from the hull's heading. Declaring
  the axis makes the rig emit `turretAxisPx` and the renderer put it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle  # noqa: E402

#: rl_role -> palette key. Kept identical to tools/vehicles/preview_technical.py,
#: so what was approved in the mockup is what ships.
ROLE_PALETTE = {
    # Repainted 2026-09-01 from the Meshy source's own base-colour texture
    # (mean #A9A094). limestone.4 is its nearest palette entry; limestone.0 was
    # eight times further away and read as a white truck. `plate` goes DARKER
    # than the hull now -- at limestone.2 it would be lighter and invert the
    # "breaking up the body" relationship this comment describes.
    "hull": "limestone.4",    # weathered body, matched to the source texture
    "plate": "limestone.6",   # bolt-ons, breaking up the body
    "metal": "gunmetal.2",    # gun, bars, chassis
    "rubber": "shadow.0",     # tyres
    "glass": "gunmetal.3",    # glazing
    "recess": "shadow.1",     # the gaps a flat box does not have
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/technical.blend"),
    out_hull=os.path.abspath("assets/sprites/TECH_HULL"),
    out_turr=os.path.abspath("assets/sprites/TECH_TURR"),
    # Everything that traverses with the gun. Matched by prefix rather than listed:
    # the author script names them, and a hand-typed set rots on the first rename.
    turret_meshes=frozenset(),   # filled below, from the model
    real_metres=5.0,
    size_class="light_vehicle",
    credit="Armed technical -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="technical_hull",
    turret_unit="technical_turret",
    role_palette=ROLE_PALETTE,
    # The pintle post's centre, from author_technical.py's `gun(pivot_x=-0.30)`.
    turret_axis=(-0.30, 0.0),
    # Prow on +X, and the rig constant is -90 deg, so (c - phi)/22.5 = -4 = 12.
    # Same as the Eitan; see tools/render_eitan.py for the derivation.
    facing_offset=12,
    strip_source_lights=True,
)


def main():
    import bpy

    bpy.ops.wm.open_mainfile(filepath=SPEC.src)
    names = frozenset(
        o.name for o in bpy.data.objects
        if o.type == "MESH" and o.name.startswith("turret_")
    )
    if not names:
        raise SystemExit(f"no turret_* meshes in {SPEC.src}")
    print(f"turret meshes resolved by prefix: {len(names)}")
    SPEC.turret_meshes = names
    render_vehicle(SPEC)


# Guarded, unlike the older vehicle scripts which render at module scope. A probe
# script imported this one to read SPEC, and the import silently re-rendered all
# 48 frames straight over the quantized ones -- the art gate then failed on
# off-palette wreck frames with nothing in the diff to explain it. render_team.py
# already carries a note about render_building.py having the same hazard.
if __name__ == "__main__":
    main()
