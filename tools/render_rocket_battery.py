"""Render the enemy rocket battery to assets/sprites/ROCKETBATTERY_HULL.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_rocket_battery.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

Cycles output is off-palette with soft alpha, so the quantizer pass is not
optional -- without it the art gate rejects every frame.

SOURCE: art/src/vehicles/rocket_battery.blend, built by
tools/vehicles/author_rocket_battery.py. Authored from primitives for this
repository, CC BY-SA 4.0, and tracked in plain git.

Hull sheet only, same shape as render_d9.py: the rack is fixed to the bed,
not a separately traversing weapon station like the gun truck's cannon or the
technical's pintle gun, so `turret_meshes` stays empty and there is no second
pass. Clips are `idle` and `wreck`, one frame each.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_vehicle import (  # noqa: E402
    VehicleSpec, burnt_material, render_clip, setup, write_manifest,
)

#: rl_role -> palette key. dust hull for a truck the Grad drives -- the enemy
#: convention gun_truck.py already carries: sun-rotted ochre, not the KDF's
#: olive.
ROLE_PALETTE = {
    "hull": "dust.1",       # chassis and cab body
    "plate": "dust.2",      # bonnet, bed, rack cradle
    "metal": "gunmetal.2",  # the rack -- tube pack and frame
    "rubber": "shadow.0",   # tyres
    "glass": "gunmetal.3",  # windscreen
    "recess": "shadow.1",   # unused on this model, kept for role_materials parity
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/rocket_battery.blend"),
    out_hull=os.path.abspath("assets/sprites/ROCKETBATTERY_HULL"),
    out_turr=os.path.abspath("assets/sprites/ROCKETBATTERY_TURR_UNUSED"),  # never written
    # target_scale, not real_metres -- render_gun_truck.py's own pattern for
    # exactly this problem. author_rocket_battery.py builds the truck at its
    # literal 7.3m x 2.4m (a BM-21 Grad-on-Ural-375D's real proportions), but
    # declaring real_metres=7.3 here derived a 177px canvas: the rack's 38deg
    # elevation reaches far outside the hull's own length in the frame's
    # worst-case rotation (ortho_scale_for_turning sizes for it, the same way
    # the gun truck's raised cannon did), well past D9_HULL's 131px, which is
    # otherwise the largest ground silhouette in the roster. 2.15 draws it at
    # 138px -- clearly the largest, not implausibly so.
    real_metres=None,
    target_scale=2.15,
    size_class="heavy_vehicle",
    credit="Rocket battery -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="rocket_battery_hull",
    turret_unit="rocket_battery_turret_unused",
    role_palette=ROLE_PALETTE,
    # Prow on +X and the rig constant is -90 deg, so (c - phi)/22.5 = -4 = 12.
    # Same derivation as every other kit-built vehicle; see render_eitan.py.
    facing_offset=12,
)


def groups():
    live, debris = [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        (debris if o.name.startswith("WRECK_") else live).append(o)
    if not live:
        raise SystemExit("no live meshes found")
    print(f"groups: live={len(live)} debris={len(debris)}")
    return live, debris


def main():
    pivot, hull, _turret, _olive, framing = setup(SPEC)
    live, debris = groups()  # debris is empty -- no WRECK_* meshes authored;
                              # the wreck pass below burns and settles `live`
                              # itself, same as render_gun_truck.py's wreck.

    files = []
    render_clip(pivot, live, [], SPEC.out_hull, "idle", files)

    burnt = burnt_material()
    for o in live:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    pivot.rotation_euler.x += math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z -= SPEC.wreck_sink
    render_clip(pivot, live, [], SPEC.out_hull, "wreck", files)
    pivot.rotation_euler.x -= math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z += SPEC.wreck_sink

    write_manifest(
        SPEC, SPEC.out_hull, SPEC.hull_unit,
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        files, framing,
    )
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


if __name__ == "__main__":
    main()
