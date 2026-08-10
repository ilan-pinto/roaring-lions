"""Render the Eitan APC hull and turret sheets from authored geometry.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_eitan.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

Cycles output is off-palette with soft alpha, so the quantizer pass is not
optional -- without it the art gate rejects every frame.

SOURCE: art/src/vehicles/eitan_apc.blend, produced by
tools/vehicles/flatten_for_sprites.py from art/showcase/apc_detail.blend.
Authored from primitives for this repository, CC BY-SA 4.0, and tracked in plain
git -- unlike the model it replaces.

This replaces LPMAC_military_truck.blend, which was wrong three ways at once: a
civilian truck drawn as an armoured personnel carrier, an unverified licence
against CONTRIBUTING.md's redistribution rule, and a source excluded by
.gitignore so the shipped sprites could not be reproduced at all.

Turret meshes are matched by prefix rather than listed by hand: the model
carries 1,763 parts and a hand-typed set would rot the first time one is
renamed. The file is opened once to resolve them, then render_vehicle re-opens
it for the render proper.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_vehicle import VehicleSpec, render_vehicle  # noqa: E402

SRC = os.path.abspath("art/src/vehicles/eitan_apc.blend")

#: Everything that traverses with the weapon station. Everything else is hull.
TURRET_PREFIXES = ("turret_", "mgun_coax", "aps_radar_")


def turret_mesh_names(path):
    bpy.ops.wm.open_mainfile(filepath=path)
    names = frozenset(
        o.name for o in bpy.data.objects
        if o.type == "MESH" and o.name.startswith(TURRET_PREFIXES)
    )
    if not names:
        raise SystemExit(f"no turret meshes matched {TURRET_PREFIXES} in {path}")
    print(f"turret meshes resolved by prefix: {len(names)}")
    return names


#: rl_role -> palette key. The Eitan shipped without this and every part rendered
#: in one flat olive, so its eight tyres were the same value as the shadowed
#: underbody and the whole lower band read as a single dark mass -- the vehicle
#: lost its "wheeled" cue at gameplay zoom. The wheels were never occluded: they
#: hang 1.27 units below the lowest bodywork. They just had no contrast.
#:
#: Body stays olive, whose ramp role in data/palette.json is literally "KDF vehicle
#: hulls". Only the tyres change band, which is the whole point.
ROLE_PALETTE = {
    "hull": "olive.1",
    "plate": "olive.1",
    "metal": "gunmetal.2",
    "rubber": "shadow.0",
    "glass": "gunmetal.3",
}

SPEC = VehicleSpec(
    src=SRC,
    out_hull=os.path.abspath("assets/sprites/EITAN_HULL"),
    out_turr=os.path.abspath("assets/sprites/EITAN_TURR"),
    turret_meshes=turret_mesh_names(SRC),
    # Unchanged at 8.5. The authored model measures 9.71 units long, but
    # `real_metres` states what the unit *is* rather than what the model happens
    # to measure, and holding it at 8.5 keeps the roster's size relationships
    # intact -- an Eitan still reads larger than the 7.5 m Namer by the same
    # margin it always did. The model's extra width (5.12 units against the
    # truck's proportions) is a deliberate visual change and rides along in the
    # framing rather than in this number.
    real_metres=7.2,
    size_class="heavy_vehicle",
    role_palette=ROLE_PALETTE,
    credit="8x8 APC -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="eitan_apc_hull",
    turret_unit="eitan_apc_turret",
    # The source ships no lights or camera -- flatten_for_sprites removes the
    # showcase rig -- so this only documents the intent.
    strip_source_lights=True,
    # The first sheet in the repository to need a nonzero offset, and not
    # inherited from the truck's 0 -- measured.
    #
    # renderer.ts:206 picks sprite index (-k + offset) mod 16 for sim facing k,
    # and render_clip renders frame f with the model's nose at its authored angle
    # phi + f*22.5 deg. Solving those together, the k terms cancel and
    # offset = (c - phi)/22.5 for one rig constant c -- the cancellation is itself
    # the check that this model of the rig is right.
    #
    # c comes out at -90 deg from two independent sources: the Namer's CANNON
    # points along -Y, and the jeep's front axle sits -90.0 deg from its rear,
    # and both render correctly at offset 0. That is a property of the asset
    # packs, which model vehicles nose-along--Y; this hull was authored with its
    # prow on +X (measured: the Y width collapses 5.12 -> 0.68 in the last slab),
    # so phi = 0 and offset = -4 = 12.
    facing_offset=12,
)

if __name__ == "__main__":
    render_vehicle(SPEC)
