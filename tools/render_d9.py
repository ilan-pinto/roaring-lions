"""Render the D9 Dov to assets/sprites/D9_HULL.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_d9.py

Hull sheet only: the D9 is unarmed, so `turret_meshes` stays empty and
render_vehicle never runs a second pass. Clips are `idle` and `wreck`, one frame
each -- the same shape as TECH_HULL and GUNTRUCK_HULL.

`target_scale`, not `real_metres`. The machine is 7.8 m over blade and ripper,
which would derive well past the main battle tank's 126 px; 2.05 draws it at
131 px, marginally the largest ground silhouette in the set, which is what a
62-tonne dozer should be.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_vehicle import (  # noqa: E402
    VehicleSpec, burnt_material, render_clip, setup, write_manifest,
)

ROLE_PALETTE = {
    "hull": "olive.1",      # KDF vehicle body
    "plate": "olive.2",     # fenders, bonnet, cab roof
    "metal": "gunmetal.1",  # moldboard, push arms, stack, ripper
    "rubber": "shadow.0",   # tracks
    "glass": "gunmetal.3",  # cab glazing
    "recess": "shadow.1",   # the gaps a flat box does not have
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/d9.blend"),
    out_hull=os.path.abspath("assets/sprites/D9_HULL"),
    out_turr=os.path.abspath("assets/sprites/D9_TURR_UNUSED"),  # never written
    real_metres=None,
    target_scale=2.05,
    size_class="heavy_vehicle",
    credit="D9 armoured dozer -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="d9_hull",
    turret_unit="d9_turret_unused",
    role_palette=ROLE_PALETTE,
    # Blade on +X and the rig constant is -90 deg, so (c - phi)/22.5 = -4 = 12.
    facing_offset=12,
)


def groups():
    live, debris = [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        (debris if o.name.startswith("WRECK_") else live).append(o)
    if not live or not debris:
        raise SystemExit(f"unexpected grouping: live={len(live)} debris={len(debris)}")
    print(f"groups: live={len(live)} debris={len(debris)}")
    return live, debris


def main():
    pivot, _hull, _turret, _olive, framing = setup(SPEC)
    live, debris = groups()

    files = []
    render_clip(pivot, live, debris, SPEC.out_hull, "idle", files)

    burnt = burnt_material()
    for o in debris:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    render_clip(pivot, debris, live, SPEC.out_hull, "wreck", files)

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
