"""Render the AH-64 Peten to assets/sprites/APACHE_HULL.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_apache.py

Hull sheet only. The chin gun is about three pixels at gameplay size, so it is
fixed to the nose and there is no turret layer.

`idle` carries four rotor phases and there is deliberately no `fire` clip. A
4-blade rotor has 90 deg rotational symmetry, so four phases at 22.5 deg cover
exactly one visual cycle and loop seamlessly. Giving `fire` its own four phases
would cost another 64 renders; giving it one would freeze the rotor the instant
the aircraft shoots. Omitted, clipOrFallback resolves `fire` back to `idle` and
the shot is carried by the muzzle flash, firingTimer and recoil the renderer
already runs. Same reasoning drops `move`.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_vehicle import (  # noqa: E402
    VehicleSpec, burnt_material, render_clip, setup, write_manifest,
)

FRAMES = 4
FPS = 12
BLADE_BARS = 2                      # two full-diameter bars = four blades
SPIN_DEG = 90.0 / FRAMES            # 22.5 deg per phase closes the cycle
BOB = 0.06                          # a hover is never perfectly still

ROLE_PALETTE = {
    "hull": "olive.1",
    "plate": "olive.2",
    "metal": "gunmetal.2",   # rotor, mast, gun, gear legs
    "rubber": "shadow.0",
    "glass": "gunmetal.3",   # tandem canopy
    "recess": "shadow.1",
}


def _spin(k):
    """Pose both rotor bars for frame k. Absolute, never a delta -- render_clip
    calls this once per facing per frame, so deltas would accumulate."""
    for i in range(BLADE_BARS):
        ob = bpy.data.objects.get(f"blade_{i}")
        if ob is None:
            raise SystemExit(f"rotor bar missing from the source: blade_{i}")
        ob.rotation_euler.z = math.radians(SPIN_DEG) * k


SPEC = VehicleSpec(
    src=os.path.abspath("art/src/aircraft/apache.blend"),
    out_hull=os.path.abspath("assets/sprites/APACHE_HULL"),
    out_turr=os.path.abspath("assets/sprites/APACHE_TURR_UNUSED"),  # never written
    real_metres=None,
    target_scale=2.00,
    size_class="air",
    credit="AH-64 assault helicopter -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="apache_hull",
    turret_unit="apache_turret_unused",
    role_palette=ROLE_PALETTE,
    # Nose along +X and the rig constant is -90 deg, so offset 12.
    facing_offset=12,
    # The rotor sweeps outside its rest silhouette as it turns.
    bounds_poses=tuple((lambda k: (lambda: _spin(k)))(k) for k in range(FRAMES)),
    bounds_z_pad=BOB,
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
    base_z = pivot.location.z

    def air_pose(piv, k):
        piv.location.z = base_z + BOB * math.sin(2.0 * math.pi * k / FRAMES)
        _spin(k)

    files = []
    render_clip(pivot, live, debris, SPEC.out_hull, "idle", files,
                frames=FRAMES, pose=air_pose)

    # Absolute reset: render_clip's exit pose restores frame 0's bob, but the
    # wreck must sit level on the ground.
    pivot.location.z = base_z
    _spin(0)

    burnt = burnt_material()
    for o in debris:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    render_clip(pivot, debris, live, SPEC.out_hull, "wreck", files)

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
