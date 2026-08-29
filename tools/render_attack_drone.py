"""Render the KDF attack drone as an animated sprite sheet.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_attack_drone.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/drones/attack_drone.blend, built by
tools/drones/author_attack_drone.py -- authored from primitives for this
repository, CC BY-SA 4.0, and tracked in plain git (unlike the vehicle
sources, art/src/drones/ is not gitignored; see that directory's own comment
in .gitignore).

This is `attack_drone`'s hull: the KDF's loitering munition ("kamikaze",
`data/units/kdf/attack_drone.json`). It shares render_loiter.py's reasoning
for its clip set -- `idle` only, no `move` (a munition in transit is doing
exactly what its idle shows -- `clipOrFallback` resolves a missing `move`
back to `idle`), no `fire` (this weapon *is* the warhead, so there is no
firing pose distinct from flying) -- plus `wreck`, since a drone that is shot
down before impact needs a downed state same as the loitering munition does.

Unlike render_loiter.py's wreck, which was modelled as separate WRECK_*
debris in the source file, this one follows render_gun_truck.py's simpler
wreck pattern: burn the same hull, pitch and sink it into the ground. No
second geometry set to author or keep in sync with the live hull.

Two things this sheet is NOT, on purpose, against the two drones already in
this directory:

  loiter_drone (loitering_munition.blend)  -- a broad swept-delta flying wing
  recon_drone  (recon_drone.blend)         -- a quadcopter, four rotor arms

`attack_drone` is a blunt cylindrical fuselage with a small cruciform ("+")
tail and a tapered nose sensor pod -- reusing either existing source verbatim
would have been a guaranteed IoU ~= 1.0 collision (identical geometry, and
the silhouette gate reads alpha only, never colour); this is why a new
source was authored rather than one of the two adapted.
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
    write_manifest,
)

FRAMES, FPS = 4, 8
BOB = 0.04
#: Degrees of bank, either side -- render_loiter.py's reasoning: a 3px
#: fin is not going to read, but the whole silhouette rocking is.
ROLL_DEG = 4.0

ROLE_PALETTE = {
    "hull": "olive.1",      # fuselage
    "plate": "limestone.1", # nose pod housing and cruciform fins
    "metal": "gunmetal.2",  # seeker tip
    "recess": "shadow.1",   # pod collar seam
}

SPEC = VehicleSpec(
    src=os.path.abspath("art/src/drones/attack_drone.blend"),
    out_hull=os.path.abspath("assets/sprites/DRONE_ATTACK"),
    # Never written: turret_meshes is empty, so there is no second pass, same
    # as every other drone sheet.
    out_turr=os.path.abspath("assets/sprites/DRONE_ATTACK_TURR_UNUSED"),
    # The model is built at 1:1 (see author_attack_drone.py) -- 1.05 here is
    # the same number the source's own nose-to-tail extent measures, not a
    # separately chosen figure.
    real_metres=1.05,
    size_class="air",
    credit="Attack drone -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="attack_drone",
    turret_unit="attack_drone_turret_unused",
    # Authored nose along +x, so sprite 0 already faces +x -- matches every
    # other drone source in this directory.
    facing_offset=0,
    role_palette=ROLE_PALETTE,
    # The bob moves the whole airframe vertically; framing to the rest pose
    # alone would crop it on the frames where it has risen.
    bounds_z_pad=BOB,
    # Defaults (wreck_pitch_deg=4, wreck_sink=0.25) are sized for a multi-metre
    # vehicle. At 1.05m nose-to-tail, 0.25 is a quarter of the whole airframe
    # -- it would bury the wreck in the ground plane. A downed drone reads as
    # a small, sharply-tipped-over hulk, not a vehicle settling on its axles.
    wreck_pitch_deg=22.0,
    wreck_sink=0.03,
)


def main():
    pivot, hull, _turret, _olive, framing = setup(SPEC)
    base_z = pivot.location.z

    def pose(piv, k):
        piv.location.z = base_z + BOB * math.sin(2.0 * math.pi * k / FRAMES)
        piv.rotation_euler.x = math.radians(ROLL_DEG) * math.sin(2.0 * math.pi * k / FRAMES)

    files = []
    render_clip(pivot, hull, [], SPEC.out_hull, "idle", files, frames=FRAMES, pose=pose)

    # Absolute reset before the wreck pass -- render_clip's own exit pose
    # already restores frame 0's bob and roll, but the wreck must sit
    # deliberately pitched, not at whatever the last idle frame left it at.
    pivot.location.z = base_z
    pivot.rotation_euler.x = 0.0

    burnt = burnt_material()
    for o in hull:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    pivot.rotation_euler.x += math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z -= SPEC.wreck_sink
    render_clip(pivot, hull, [], SPEC.out_hull, "wreck", files)
    pivot.rotation_euler.x -= math.radians(SPEC.wreck_pitch_deg)
    pivot.location.z += SPEC.wreck_sink
    # Restore roles for good measure, though nothing renders again after this.
    role_materials(hull, SPEC.role_palette)

    write_manifest(
        SPEC,
        SPEC.out_hull,
        SPEC.hull_unit,
        {
            "idle": {"frames": FRAMES, "fps": FPS, "loop": True},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        files,
        framing,
    )
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


if __name__ == "__main__":
    main()
