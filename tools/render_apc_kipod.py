"""Render the Kipod screen carrier's hull sheet.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_apc_kipod.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

Hull sheet only: `kipod_rws` (remote_mg) is a small, fixed remote weapon
station, not a manned turret, so `turret_meshes` stays empty -- the same
"unarmed" branch `render_d9.py`'s own SPEC takes, and the same reasoning
`export_mesh_vehicle.py`'s `SPECS["apc_kipod"]` records for its own
`turret_prefixes=()`.

SOURCE: art/src/vehicles/apc_kipod.blend, built by
tools/vehicles/author_apc_kipod.py from tools/vehicles/kit.py primitives.
Authored from primitives for this repository, CC BY-SA 4.0, and tracked in
plain git -- unlike the downloaded vehicle sources, which .gitignore excludes
because they cannot be reproduced.

Star-gated special unit (`docs/campaign/special_units/design.md` unit III)
that shipped mesh-only -- no `SPRITE_MAP` entry, so no portrait, billboard or
`&nomesh`/Pixi draw -- until this sheet.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle  # noqa: E402

#: rl_role -> palette key, hand-copied from tools/render_mesh_gate.py's own
#: VEHICLE_ROLE_PALETTES["apc_kipod"] (itself hand-copied from
#: author_apc_kipod.py's KDF olive tones) so the sprite and the mesh export
#: shade the same roles the same tones. `plate` is this unit's slab
#: side-screens (its own reactive-plate read); `recess` is the rear stowage
#: box.
ROLE_PALETTE = {
    "hull": "olive.0", "plate": "olive.1", "metal": "gunmetal.2",
    "rubber": "shadow.0", "glass": "gunmetal.3", "recess": "shadow.1",
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/apc_kipod.blend"),
    out_hull=os.path.abspath("assets/sprites/KIPOD_HULL"),
    out_turr=os.path.abspath("assets/sprites/KIPOD_TURR_UNUSED"),  # never written
    turret_meshes=frozenset(),
    # Hull length is this model's longest axis on any of the three world axes
    # (author_apc_kipod.py's own L=7.2 vs W=2.7 and a roof+RWS height of
    # roughly 3.1 m above the wheel line) -- the same 7.2 declared in
    # export_mesh_vehicle.py's SPECS["apc_kipod"], so billboard and mesh
    # agree in size.
    real_metres=7.2,
    # "Sits between apc_eitan (heavy_vehicle) and ifv_namer (heavy_vehicle)":
    # both neighbours the design doc places this hull between already use
    # heavy_vehicle, and at 7.2 m over 3 axles this hull is closer to the
    # roster's 7-8 m tracked/8x8 heavies than to the 4.6-5.5 m light hulls.
    size_class="heavy_vehicle",
    credit="Screen carrier APC -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="apc_kipod_hull",
    turret_unit="apc_kipod_turret_unused",
    role_palette=ROLE_PALETTE,
    # Measured, not assumed: author_apc_kipod.py builds the hull with
    # kit.hull_box, whose own `nose_deg` rake narrows the roof only on the
    # +hl (+x) side of the box (kit.py's hull_box, the `rake` term applied to
    # vertices 5 and 6 only) -- so this hull's prow sits on +X, exactly the
    # convention render_eitan.py and render_d9.py measured for their own
    # kit-built/authored hulls (kit.rws's own barrel, "along +x", agrees: the
    # remote_mg mounts forward on the roof at RWS_AT_X=+1.1). Prow on +X, rig
    # constant -90 deg: (c - phi)/22.5 = -4 = 12. Same derivation as
    # render_eitan.py.
    facing_offset=12,
)


def main():
    render_vehicle(SPEC)


# Guarded, per render_technical.py's own note: an unguarded module-scope
# render lets an import (e.g. a probe script reading SPEC) silently re-render
# every frame over the quantized ones.
if __name__ == "__main__":
    main()
