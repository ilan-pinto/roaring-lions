"""Render the enemy tandem paramotor as an animated sprite sheet.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_paramotor.py
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

SOURCE: art/src/drones/paramotor.blend, authored from the vehicle and infantry
kits in a live Blender session for this repository, CC BY-SA 4.0.

Three clips:

    idle   4 frames -- airframe bob, canopy sway, propeller spin
    down   hit and spilling air: still flying, canopy stalled, cart swung
    wreck  burnt, canopy crumpled on the ground

**`down` is not the landed state**, though it was authored as one first. The
renderer resolves `down` for a *pinned or routed* unit, not a landed one, so a
merely suppressed paramotor rendered as parked in mid-air. A suppressed
aircraft does not land -- it spills air and dives away. The landed geometry
(CANOPY_DOWN) stays in the .blend, unused, for the land-and-dismount behaviour
that does not exist yet.

**No `fire` clip, deliberately.** The gunner's machine gun is part of him and
never stows, so firing changes no geometry. `clipOrFallback` resolves a missing
clip back to `idle`, and the firing read comes from muzzle-flash VFX -- which
ART_PIPELINE.md section 5 says is where it belongs anyway.

Two things here are unlike every other vehicle sheet:

* **`target_scale`, not `real_metres`.** The canopy really spans 9.5 m, which in
  the `air` class (multiplier 1.5, sized to rescue a 0.9 m quadcopter) derives a
  296 px unit -- larger than a mosque and 2.4x a tank, for one soldier under a
  wing. Declaring the drawn size instead and letting the metres follow is exactly
  what target_scale exists for. The manifest's realMetres is therefore a drawing
  decision, not a physical claim.

* **`lit_gain`.** This sheet carries human figures, and render_team.py measured
  that a figure lights to roughly half its palette base. This rig is darker still
  -- black world, no ambient, tuned for vehicles, which are mostly horizontal
  surface -- so without the gain the crew render as silhouettes.
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
#: Vertical travel of the whole airframe across the loop.
BOB = 0.12
#: Lateral canopy swing. The wing leads the cart in a turn, so it sways in y
#: while the cart stays put -- one part moving relative to another is what makes
#: this read as flight rather than as a sprite being nudged up and down.
SWAY = 0.16
#: Degrees of propeller yaw per frame. FRAMES * this must equal 360 / blades,
#: or the loop visibly jumps on wrap-around. Three blades, four frames: 30 deg.
#: render_drone.py records the same constraint for its two-blade quad.
BLADES = 3
SPIN_DEG = (360.0 / BLADES) / FRAMES

#: The `down` pose: hit and spilling air. Large enough to read at 96 px as
#: "this one is in trouble" without leaving the frame the idle loop sized.
DOWN_CANOPY_SWING = 0.55
DOWN_CANOPY_DROP = 0.42
DOWN_PITCH_DEG = 13.0
DOWN_SINK = 0.30

ROLE_PALETTE = {
    # airframe
    "hull": "dust.0",       # canopy
    "plate": "dust.1",      # seats, prop blades, cart panels
    "metal": "gunmetal.2",  # cage, frame tubes, rigging
    "rubber": "shadow.0",   # tyres
    "glass": "gunmetal.3",
    "recess": "shadow.1",   # engine cylinder, exhaust
    # crew, following render_team.py's enemy convention -- tan clothes with
    # scavenged olive webbing, which keeps the two factions' dominant tones
    # apart without any team-band colour entering static art.
    "uniform": "dust.3",    # mid tan: the figures must read against a dust.0 canopy
    "webbing": "olive.1",
    "boot": "terracotta.2",
    "face": "skin.0",
    "skin_shadow": "skin.1",
    "keffiyeh": "limestone.0",
    "weapon": "gunmetal.3",
    "wood": "dust.4",
}

#: Ported from render_team.py, whose comments explain each number. Without it
#: the crew are black cut-outs under this rig.
LIT_GAIN = {"face": 1.95, "skin_shadow": 1.85, "boot": 1.35}


def _spin(k):
    """Pose all three blades for frame k. Absolute, never a delta."""
    for i in range(BLADES):
        ob = bpy.data.objects.get(f"CART_blade{i}")
        if ob is None:
            raise SystemExit(f"propeller blade missing from the source: CART_blade{i}")
        ob.rotation_euler.x = math.radians(SPIN_DEG) * k


def _sway(k):
    ob = bpy.data.objects.get("CANOPY_FLY")
    if ob is None:
        raise SystemExit("CANOPY_FLY missing from the source file")
    ob.location.y = SWAY * math.sin(2.0 * math.pi * k / FRAMES + math.pi / 2.0)


def _down_pose():
    """The stalled-canopy pose, included when the frame is measured -- it swings
    further off-centre than any frame of the idle loop."""
    ob = bpy.data.objects.get("CANOPY_FLY")
    if ob is None:
        raise SystemExit("CANOPY_FLY missing from the source file")
    ob.location = (0.0, DOWN_CANOPY_SWING, -DOWN_CANOPY_DROP)


def _bounds_pose(k):
    def go():
        _spin(k)
        _sway(k)
    return go


SPEC = VehicleSpec(
    src=os.path.abspath("art/src/drones/paramotor.blend"),
    out_hull=os.path.abspath("assets/sprites/PARA_MOTOR"),
    # Never written: turret_meshes is empty, so there is no second pass. The
    # field is required by the dataclass, not used.
    out_turr=os.path.abspath("assets/sprites/PARA_MOTOR_TURR_UNUSED"),
    real_metres=None,
    target_scale=1.5,       # 96 px -- a touch above the technical's 89. See the docstring.
    size_class="air",
    credit="Tandem paramotor -- authored from primitives for this repository, CC BY-SA 4.0",
    hull_unit="paramotor",
    turret_unit="paramotor_turret_unused",
    # The model is authored nose along +x, so sprite 0 already faces +x.
    facing_offset=0,
    role_palette=ROLE_PALETTE,
    lit_gain=LIT_GAIN,
    # The canopy swings and the blades sweep, both outside their rest
    # silhouette. Framing to the rest pose alone crops a wingtip on half the
    # frames -- render_drone.py hit exactly this with its props.
    bounds_poses=tuple(_bounds_pose(k) for k in range(FRAMES)) + (_down_pose,),
    bounds_z_pad=BOB + DOWN_SINK,
)


def groups():
    """Split the model by name into the sets each clip shows.

    Both canopy states live in one file on purpose: `setup()` measures bounds
    over every mesh, so one frame holds the flying wing and the landed sheet
    alike and the unit cannot resize when it lands. That is the same union
    framing render_team.py applies across clips, obtained here for free.
    """
    fly, down, body = [], [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.name.startswith("CANOPY_DOWN"):
            down.append(o)
        elif o.name.startswith(("CANOPY_FLY", "LINE_")):
            fly.append(o)
        else:
            body.append(o)
    if not fly or not down or not body:
        raise SystemExit(f"unexpected grouping: fly={len(fly)} down={len(down)} body={len(body)}")
    print(f"groups: fly={len(fly)} down={len(down)} body={len(body)}")
    return fly, down, body


def main():
    pivot, _hull, _turret, _olive, framing = setup(SPEC)
    fly, down, body = groups()
    base_z = pivot.location.z

    def air_pose(piv, k):
        piv.location.z = base_z + BOB * math.sin(2.0 * math.pi * k / FRAMES)
        _spin(k)
        _sway(k)

    files = []
    render_clip(pivot, body + fly, down, SPEC.out_hull, "idle", files,
                frames=FRAMES, pose=air_pose)

    # Absolute reset before the ground clips. render_clip calls pose(pivot, 0)
    # on the way out, and air_pose(_, 0) leaves the canopy swung fully to one
    # side -- without this, `down` and `wreck` inherit a lean from the last
    # frame of the flying loop.
    pivot.location.z = base_z
    _spin(0)
    bpy.data.objects["CANOPY_FLY"].location.y = 0.0

    # `down` = hit, not landed. The canopy stalls (swung hard to one side and
    # dropped) and the cart yaws under it, while the whole thing stays airborne.
    canopy = bpy.data.objects["CANOPY_FLY"]
    canopy.location = (0.0, DOWN_CANOPY_SWING, -DOWN_CANOPY_DROP)
    pivot.rotation_euler.y = math.radians(DOWN_PITCH_DEG)
    pivot.location.z = base_z - DOWN_SINK
    render_clip(pivot, body + fly, down, SPEC.out_hull, "down", files)
    canopy.location = (0.0, 0.0, 0.0)
    pivot.rotation_euler.y = 0.0
    pivot.location.z = base_z

    burnt = burnt_material()
    for o in body + down:
        o.data.materials.clear()
        o.data.materials.append(burnt)
    pivot.rotation_euler.y = math.radians(7.0)
    render_clip(pivot, body + down, fly, SPEC.out_hull, "wreck", files)
    pivot.rotation_euler.y = 0.0

    write_manifest(
        SPEC, SPEC.out_hull, SPEC.hull_unit,
        {
            "idle": {"frames": FRAMES, "fps": FPS, "loop": True},
            "down": {"frames": 1, "fps": 0, "loop": False},
            "wreck": {"frames": 1, "fps": 0, "loop": False},
        },
        files, framing,
    )
    print(f"DONE {len(files)} frames -> {SPEC.out_hull}")


# Guarded so a probe can import SPEC without firing a 96-frame render -- the
# hazard render_technical.py records having been bitten by.
if __name__ == "__main__":
    main()
