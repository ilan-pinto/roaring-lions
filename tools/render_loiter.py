"""Render the enemy loitering munition as an animated sprite sheet.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_loiter.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/drones/loitering_munition.blend, authored from primitives in a
live Blender session for this repository, CC BY-SA 4.0.

Two clips:

    idle   4 frames -- bob, bank wobble, propeller spin
    wreck  charred debris on the ground

No `move`, for render_drone.py's reason: `clipOrFallback` resolves a missing
clip back to `idle`, and a munition in transit is doing exactly what its idle
shows. No `fire` either -- this weapon *is* the warhead, so there is no firing
pose distinct from flying.

Unlike the paramotor and the gun truck, this sheet declares honest metres. A
1.62 m airframe in the `air` class derives 45 px, which sits correctly between
the recon drone's 31 px at 0.9 m and the infantry band -- so there is nothing
for `target_scale` to fix.
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
    setup,
    write_manifest,
)

FRAMES, FPS = 4, 8
BOB = 0.05
#: Degrees of bank, either side. The wobble is what reads at this size -- a
#: 3 px propeller is not, whatever it does.
ROLL_DEG = 5.0
#: Two blades, so the disc repeats every 180 deg. FRAMES * SPIN_DEG must equal
#: that or the loop jumps on wrap-around, exactly as render_drone.py records.
BLADES = 2
SPIN_DEG = (360.0 / BLADES) / FRAMES

ROLE_PALETTE = {
    "hull": "dust.1",       # wing
    "plate": "dust.2",      # fuselage, fins, prop blades
    "metal": "gunmetal.2",  # warhead, hub
    "rubber": "shadow.0",
    "glass": "gunmetal.3",  # seeker
    "recess": "shadow.1",
}


def _spin(k):
    """Pose both blades for frame k. Absolute, never a delta -- render_clip
    calls this once per facing per frame, so deltas would accumulate."""
    for i in range(BLADES):
        ob = bpy.data.objects.get(f"PROP_blade{i}")
        if ob is None:
            raise SystemExit(f"propeller blade missing from the source: PROP_blade{i}")
        ob.rotation_euler.x = math.radians(SPIN_DEG) * k


SPEC = VehicleSpec(
    src=os.path.abspath("art/src/drones/loitering_munition.blend"),
    out_hull=os.path.abspath("assets/sprites/DRONE_LOITER"),
    # Never written: turret_meshes is empty, so there is no second pass.
    out_turr=os.path.abspath("assets/sprites/DRONE_LOITER_TURR_UNUSED"),
    real_metres=1.62,
    size_class="air",
    credit="Loitering munition -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="loitering_munition",
    turret_unit="loitering_munition_turret_unused",
    # Authored nose along +x, so sprite 0 already faces +x.
    facing_offset=0,
    role_palette=ROLE_PALETTE,
    # Blades sweep outside their rest silhouette as they turn.
    bounds_poses=tuple((lambda k: (lambda: _spin(k)))(k) for k in range(FRAMES)),
    bounds_z_pad=BOB,
)


def groups():
    air, debris = [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        (debris if o.name.startswith("WRECK_") else air).append(o)
    if not air or not debris:
        raise SystemExit(f"unexpected grouping: air={len(air)} debris={len(debris)}")
    print(f"groups: air={len(air)} debris={len(debris)}")
    return air, debris


def main():
    pivot, _hull, _turret, _olive, framing = setup(SPEC)
    air, debris = groups()
    base_z = pivot.location.z

    def air_pose(piv, k):
        t = 2.0 * math.pi * k / FRAMES
        piv.location.z = base_z + BOB * math.sin(t)
        piv.rotation_euler.x = math.radians(ROLL_DEG) * math.sin(t)
        _spin(k)

    files = []
    render_clip(pivot, air, debris, SPEC.out_hull, "idle", files,
                frames=FRAMES, pose=air_pose)

    # Absolute reset: render_clip's exit pose(pivot, 0) restores the bob and
    # roll of frame 0, but the wreck must sit level on the ground.
    pivot.location.z = base_z
    pivot.rotation_euler.x = 0.0
    _spin(0)

    burnt = burnt_material()
    for o in debris:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    render_clip(pivot, debris, air, SPEC.out_hull, "wreck", files)

    write_manifest(
        SPEC, SPEC.out_hull, SPEC.hull_unit,
        {
            "idle": {"frames": FRAMES, "fps": FPS, "loop": True},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        files, framing,
    )
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


if __name__ == "__main__":
    main()
