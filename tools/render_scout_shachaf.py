"""Render the Shachaf scout car's hull sheet.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_scout_shachaf.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

Hull sheet only: `shachaf_pintle` (cupola_mg) is a small, fixed pintle mount,
not a manned turret, so `turret_meshes` stays empty -- the same "unarmed"
branch `render_d9.py`'s own SPEC takes, and the same reasoning
`export_mesh_vehicle.py`'s `SPECS["scout_shachaf"]` records for its own
`turret_prefixes=()`.

SOURCE: art/src/vehicles/scout_shachaf.blend, built by
tools/vehicles/author_scout_shachaf.py from tools/vehicles/kit.py primitives.
Authored from primitives for this repository, CC BY-SA 4.0, and tracked in
plain git -- unlike the downloaded vehicle sources, which .gitignore excludes
because they cannot be reproduced.

Star-gated special unit (`docs/campaign/special_units/design.md` unit II)
that shipped mesh-only -- no `SPRITE_MAP` entry, so no portrait, billboard or
`&nomesh`/Pixi draw -- until this sheet.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle  # noqa: E402

#: rl_role -> palette key, hand-copied from tools/render_mesh_gate.py's own
#: VEHICLE_ROLE_PALETTES["scout_shachaf"] (itself hand-copied from
#: author_scout_shachaf.py's KDF olive tones) so the sprite and the mesh
#: export shade the same roles the same tones. No `plate`/`recess`: this hull
#: authors neither part.
ROLE_PALETTE = {
    "hull": "olive.0", "metal": "gunmetal.2",
    "rubber": "shadow.0", "glass": "gunmetal.3",
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/scout_shachaf.blend"),
    out_hull=os.path.abspath("assets/sprites/SHACHAF_HULL"),
    out_turr=os.path.abspath("assets/sprites/SHACHAF_TURR_UNUSED"),  # never written
    turret_meshes=frozenset(),
    # Hull length is this model's longest axis on any of the three world axes
    # (author_scout_shachaf.py's own L=4.6 vs W=2.0 and the mast-topped
    # height of ~2.87 m above the wheel line) -- the same 4.6 declared in
    # export_mesh_vehicle.py's SPECS["scout_shachaf"], so billboard and mesh
    # agree in size.
    real_metres=4.6,
    # "jeep-class": the roster's other light wheeled utility/scout hulls
    # (render_jeep.py, render_gun_truck.py, render_technical.py) all use
    # light_vehicle, against apc_eitan/ifv_namer/dozer_d9's heavy_vehicle --
    # and at 4.6 m over 2 axles this hull sits with them, not with the 7-8 m
    # 8x8/tracked heavies.
    size_class="light_vehicle",
    credit="Light scout car -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="scout_shachaf_hull",
    turret_unit="scout_shachaf_turret_unused",
    role_palette=ROLE_PALETTE,
    # Measured, not assumed: author_scout_shachaf.py builds the hull with
    # kit.hull_box, whose own `nose_deg` rake narrows the roof only on the
    # +hl (+x) side of the box (kit.py's hull_box, the `rake` term applied to
    # vertices 5 and 6 only) -- so this hull's prow sits on +X, exactly the
    # convention render_eitan.py and render_d9.py measured for their own
    # kit-built/authored hulls. Prow on +X, rig constant -90 deg:
    # (c - phi)/22.5 = -4 = 12. Same derivation as render_eitan.py.
    facing_offset=12,
)


def main():
    render_vehicle(SPEC)


# Guarded, per render_technical.py's own note: an unguarded module-scope
# render lets an import (e.g. a probe script reading SPEC) silently re-render
# every frame over the quantized ones.
if __name__ == "__main__":
    main()
