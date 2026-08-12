"""Render the enemy AA gun truck's hull and turret sheets.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_gun_truck.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

Cycles output is off-palette with soft alpha, so the quantizer pass is not
optional -- without it the art gate rejects every frame.

SOURCE: art/src/vehicles/gun_truck.blend, authored from primitives in a live
Blender session for this repository, CC BY-SA 4.0, and tracked in plain git.

Two things differ from render_technical.py, both forced by the weapon:

* **A custom main, not `render_vehicle()`.** The shared entry point renders a
  turret `idle` only. This gun gets a `fire` clip with the barrels recoiled
  along their own axis, which needs its own pass.

* **The body is `dust`, not `limestone`.** The technical already owns the
  sun-bleached white; a second enemy truck in the same tone would throw away
  the read that colour is carrying. Faded ochre is how "old and sun-rotted" is
  said in a locked 42-colour palette that has no rust.

The gun's 28 degree elevation is load-bearing rather than styling. A turret
sheet traverses independently of its hull, so the barrels point forward on some
facings and must clear the cab roof there. At 15 degrees they pass through it --
the technical's first failure, recorded in its own spec. The mount height was
solved for >= 0.10 m of clearance measured on the barrel *surface*, not its
centre line: perpendicular radius projects into z as r / cos(pitch), so the
jacket eats roughly half the axis figure.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from render_vehicle import (  # noqa: E402
    VehicleSpec,
    burnt_material,
    render_clip,
    role_materials,
    setup,
    turret_axis_px,
    write_manifest,
)

#: rl_role -> palette key. Matches the live-session preview that was approved,
#: so what was signed off is what ships.
ROLE_PALETTE = {
    "hull": "dust.1",       # faded ochre body
    "plate": "dust.2",      # drop sides, mudguards, stowage
    "metal": "gunmetal.2",  # cannon, bumper, axles
    "rubber": "shadow.0",   # tyres
    "glass": "gunmetal.3",  # glazing
    "recess": "shadow.1",   # chassis rails and the gaps a flat box does not have
}

#: Barrel recoil for the `fire` clip, in metres along the bore.
RECOIL = 0.11
#: The elevation the model was built at. Recoil runs along the barrel, not along
#: x -- a gun that recoils horizontally while pointing up looks broken.
ELEV_DEG = 28.0

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/vehicles/gun_truck.blend"),
    out_hull=os.path.abspath("assets/sprites/GUNTRUCK_HULL"),
    out_turr=os.path.abspath("assets/sprites/GUNTRUCK_TURR"),
    # Filled in main() by prefix. Naming them by hand rots on the first rename,
    # which is the reasoning render_technical.py already records.
    turret_meshes=frozenset(),
    # Declared drawn size, not declared metres -- and this vehicle is the reason
    # the field exists. `scale` is proportional to the measured frame, and the
    # frame has to hold the elevated gun at every facing, so declaring
    # real_metres=6.8 derived 158 px: larger than the main battle tank at 126 and
    # the 8x8 APC at 126, for a light truck. Neither size class restrains it --
    # light_vehicle and heavy_vehicle are both multiplier 1.0 -- so a tall
    # protrusion silently inflates the unit.
    #
    # 1.84 -> 118 px: clearly above the technical's 89, just under the tank.
    # The largest enemy vehicle, not the largest vehicle.
    real_metres=None,
    target_scale=1.84,
    size_class="light_vehicle",
    credit="AA gun truck -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="gun_truck_hull",
    turret_unit="gun_truck_turret",
    role_palette=ROLE_PALETTE,
    # The mount ring's centre, from the live session's cannon(pivot_x=-1.65).
    turret_axis=(-1.65, 0.0),
    # Prow on +X and the rig constant is -90 deg, so (c - phi)/22.5 = -4 = 12.
    # Same derivation as the Eitan and the technical; see tools/render_eitan.py.
    facing_offset=12,
    strip_source_lights=True,
)


def main():
    bpy.ops.wm.open_mainfile(filepath=SPEC.src)
    names = frozenset(
        o.name for o in bpy.data.objects
        if o.type == "MESH" and o.name.startswith("turret_")
    )
    if not names:
        raise SystemExit(f"no turret_* meshes in {SPEC.src}")
    print(f"turret meshes resolved by prefix: {len(names)}")
    SPEC.turret_meshes = names

    pivot, hull, turret, _olive, framing = setup(SPEC)

    hull_files = []
    render_clip(pivot, hull, turret, SPEC.out_hull, "idle", hull_files)

    # Wreck: burnt out, mount knocked askew, settled on its axles. The renderer
    # draws only the hull's wreck clip and hides the turret sprite, so the
    # destroyed weapon has to be baked into this pass.
    burnt = burnt_material()
    for o in hull + turret:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    for o in turret:
        o.rotation_euler.z += math.radians(SPEC.wreck_turret_yaw_deg)
        o.rotation_euler.x += math.radians(SPEC.wreck_turret_pitch_deg)
    pivot.rotation_euler.x += math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z -= SPEC.wreck_sink
    render_clip(pivot, hull + turret, [], SPEC.out_hull, "wreck", hull_files)
    pivot.rotation_euler.x -= math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z += SPEC.wreck_sink
    for o in turret:
        o.rotation_euler.z -= math.radians(SPEC.wreck_turret_yaw_deg)
        o.rotation_euler.x -= math.radians(SPEC.wreck_turret_pitch_deg)
    # Restore roles rather than olive: a role-painted model repainted flat would
    # make the two sheets of one vehicle disagree on colour.
    role_materials(hull + turret, SPEC.role_palette, SPEC.lit_gain)

    write_manifest(
        SPEC, SPEC.out_hull, SPEC.hull_unit,
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        hull_files, framing,
    )

    # Everything that slides in the cradle when the gun fires.
    recoiling = [o for o in turret
                 if any(t in o.name for t in ("jacket", "barrel", "brake"))]
    if not recoiling:
        raise SystemExit("no recoiling barrel parts matched -- check the model naming")
    print(f"recoiling parts: {len(recoiling)}")
    p = math.radians(ELEV_DEG)
    back = (-RECOIL * math.cos(p), 0.0, -RECOIL * math.sin(p))

    def recoil_pose(_pivot, _k):
        # Absolute, never a delta: render_clip calls this once per facing, so a
        # delta would accumulate 16 times across the sheet.
        for o in recoiling:
            o.location = back

    turr_files = []
    render_clip(pivot, turret, hull, SPEC.out_turr, "idle", turr_files)
    render_clip(pivot, turret, hull, SPEC.out_turr, "fire", turr_files,
                frames=1, pose=recoil_pose)
    for o in recoiling:
        o.location = (0.0, 0.0, 0.0)

    write_manifest(
        SPEC, SPEC.out_turr, SPEC.turret_unit,
        {
            "idle": {"frames": 1, "fps": 0, "loop": False},
            "fire": {"frames": 1, "fps": 12, "loop": False},
        },
        turr_files, framing,
        layer="turret",
        axis_px=turret_axis_px(SPEC, framing),
    )
    print(f"DONE {len(hull_files)} hull + {len(turr_files)} turret frames")


# Guarded, like render_technical.py. A probe script that imported that module to
# read its SPEC silently re-rendered 48 frames over the quantized ones, and the
# art gate then failed on off-palette frames with nothing in the diff to explain
# it.
if __name__ == "__main__":
    main()
