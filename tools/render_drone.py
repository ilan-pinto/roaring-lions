"""Render the recon drone as an animated hull sprite sheet.

The first sheet in this repository with more than one frame per facing, and the
first whose source model was authored here rather than downloaded.

Output:
  assets/sprites/DRONE_RECON/idle_f{facing}_{frame}.png   (16 facings x 4 frames)

One clip, `idle`, looping at 8 fps. Two things move per frame:

  bob    the whole airframe rises and falls on a sine, +/-9cm
  spin   each prop yaws 45 degrees, counter-rotating in pairs

The bob is what actually reads. At the 40-80px the game draws units at, a
rotor blade is about three pixels and whatever happens to it is nearly
invisible, whereas the entire silhouette translating vertically is obvious.
45 degrees per frame closes the loop exactly: a 2-blade prop is 180-degree
symmetric, so four steps is one full apparent revolution and frame 3 -> frame 0
has no visible jump.

`idle` is the only clip, and that is the whole correct set for this unit:

  - `move` is unnecessary. resolveClip asks for it whenever a unit has measured
    speed, but clipOrFallback resolves a missing clip back to idle, so a drone
    in transit keeps playing the hover loop. For a multirotor that is not a
    compromise -- hovering is what it does whether or not it is translating.
  - `wreck` is skipped. renderer.ts keeps the old cross marker for unit types
    with no wreck art, and a downed drone is scattered debris rather than a
    recognisable burnt-out hull.

Cycles output is not on-palette and has soft alpha, so a render must always be
followed by the quantizer, or `pnpm validate:assets` rejects every frame:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_drone.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/drones/recon_drone.blend -- tracked in plain git, unlike the
vehicle sources. Modelled from primitives for this repository and therefore
CC BY-SA 4.0 like the rest of the project's art, with none of the licence
doubt hanging over the downloaded tank, jeep, Eitan and Namer models.
"""
import math
import os
import sys

# Blender's --python does not put the script's own directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from render_vehicle import VehicleSpec, render_clip, setup, write_manifest

FRAMES = 4
FPS = 8
# Vertical travel, in world units, on a model that stands 0.63 tall. Large
# enough to read after quantization, small enough that the drone still sits on
# its own tile rather than appearing to climb.
BOB = 0.09
# Degrees of prop yaw per frame. FRAMES * this must be 180 for a 2-blade prop,
# or the loop visibly jumps on wrap-around.
SPIN_DEG = 45.0

# Counter-rotating pairs, as a real quadrotor flies: diagonals share a
# direction. Nobody will consciously notice; it costs nothing to be right.
PROP_SPIN = {
    "PROP_FL": 1.0,
    "PROP_RR": 1.0,
    "PROP_FR": -1.0,
    "PROP_RL": -1.0,
}


def _yaw_props(k):
    """Pose every prop for frame k. Absolute, never a delta."""
    for name, direction in PROP_SPIN.items():
        ob = bpy.data.objects.get(name)
        if ob is None:
            raise SystemExit(f"prop object missing from the source file: {name}")
        ob.rotation_euler.z = direction * math.radians(SPIN_DEG) * k


SPEC = VehicleSpec(
    src=os.path.abspath("art/src/drones/recon_drone.blend"),
    out_hull=os.path.abspath("assets/sprites/DRONE_RECON"),
    # Never written: turret_meshes is empty, so there is no second pass. The
    # field is required by the dataclass, not used.
    out_turr=os.path.abspath("assets/sprites/DRONE_RECON_TURR_UNUSED"),
    # Literal scale would be about 0.37: the frame spans ~1.43 world units and
    # the tank sheet establishes ~3.9 m per tile. Drawn that small the drone is
    # a 24px smudge the player cannot track, and tracking it is the entire
    # mission. 0.50 is a deliberate ~35% over life size, the same legibility
    # trade the jeep's 1.1 makes in the other direction.
    scale=0.50,
    credit="Recon drone -- modelled from primitives for this repository, CC BY-SA 4.0",
    hull_unit="recon_drone",
    # Also never written, for the same reason as out_turr.
    turret_unit="recon_drone_turret_unused",
    # The model is authored nose along +x, so sprite 0 already faces +x.
    facing_offset=0,
    # Props sweep outside their rest silhouette as they yaw, and the bob moves
    # the whole airframe vertically. Framing to the rest pose alone clips blade
    # tips on half the frames.
    bounds_poses=tuple(
        (lambda k: (lambda: _yaw_props(k)))(k) for k in range(FRAMES)
    ),
    bounds_z_pad=BOB,
)


def main():
    pivot, hull, turret, _olive = setup(SPEC)
    base_z = pivot.location.z

    def pose(piv, k):
        piv.location.z = base_z + BOB * math.sin(2.0 * math.pi * k / FRAMES)
        _yaw_props(k)

    files = []
    render_clip(
        pivot, hull, turret, SPEC.out_hull, "idle", files,
        frames=FRAMES, pose=pose,
    )
    write_manifest(
        SPEC,
        SPEC.out_hull,
        SPEC.hull_unit,
        {"idle": {"frames": FRAMES, "fps": FPS, "loop": True}},
        files,
    )
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


# Guarded so the framing and fill checks can import SPEC and the pose helper
# without firing a 64-frame render. `blender --python` runs this as __main__.
if __name__ == "__main__":
    main()
