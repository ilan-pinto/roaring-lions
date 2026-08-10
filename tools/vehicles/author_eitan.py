"""Author art/src/vehicles/eitan.blend -- the KDF wheeled APC.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_eitan.py

Replaces LPMAC_military_truck.blend, which stood in for this unit and was wrong
three ways at once: a civilian truck drawn as an armoured carrier, an unverified
licence against CONTRIBUTING.md's redistribution rule, and a source excluded by
.gitignore so the shipped sprites could not be reproduced at all.

The vehicle is a generic 8x8 wheeled APC. CONTRIBUTING.md keeps every faction
fictional and defined by doctrine, so this is not a replica of any real
vehicle -- the same rule that had the infantry parts named descriptively.

Proportions come from the unit's own data rather than a reference photo:

    transport_slots 2   a section carrier, not a squad bus -- so 8.5 m of hull
                        with a short crew compartment, not a long bus body
    rws_50              a remote station, so a small mount high on the roof and
                        no manned turret basket
    armor 220/140/90/40 front nearly 2.5x the side, which is what the raked
                        nose plate says visually
    speed 1.8 tiles/s   wheeled, and 8 wheels is the silhouette cue that reads
                        against the tracked Namer at gameplay zoom

Height/length is 2.2/8.5 = 0.26. The truck it replaces sat near 0.40, which is
why its sprite carried 18% more empty canvas than the Namer's for the same
class: frameMetres/realMetres was 1.34 against the Namer's 1.14.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/vehicles/eitan.blend")

# --- the approved numbers --------------------------------------------------
L, W, H = 8.5, 2.9, 2.2      # hull length, width, height in metres
SLOPE = 12.0                  # flank lean, degrees
NOSE = 18.0                   # front plate rake, degrees
WHEEL_R, WHEEL_W = 0.55, 0.34
GROUND = 0.10                 # ground clearance under the hull floor
# Four axles. Front pair close together, rear pair spread: an even spacing reads
# as a trailer, and the gap behind the second axle is where a real carrier puts
# its crew door.
AXLES_X = (-3.05, -1.55, 1.35, 2.95)
RWS = (0.9, 0.7, 0.45)        # remote weapon station, l x w x h
RWS_AT = (0.6, 0.0, H)        # 0.6 forward of hull centre, on the roof


def build():
    kit.new_scene()

    floor_z = GROUND + WHEEL_R * 0.35   # hull sits into the wheel line, not on top

    # Body. The nose rakes back so the front is legible from every facing, not
    # only in profile.
    kit.hull_box("eitan_hull", L, W, H, (0.0, 0.0, floor_z),
                 slope_deg=SLOPE, nose_deg=NOSE)

    # A raised crew compartment over the rear two thirds. This is the one shape
    # that keeps the profile from being a single wedge, and it is where the
    # two-slot capacity actually lives.
    kit.hull_box("eitan_cab", L * 0.46, W * 0.86, 0.42,
                 (-0.9, 0.0, floor_z + H), slope_deg=8.0)

    # Bolt-on side skirts over the wheel arches: the horizontal band that stops
    # the flank reading as one tall slab.
    for sy, tag in ((-1, "l"), (1, "r")):
        kit.box(f"eitan_skirt_{tag}", (L * 0.86, 0.16, 0.52),
                (-0.1, sy * (W / 2.0 - 0.06), floor_z + 0.46), role="plate")

    # Eight road wheels.
    kit.wheels_in_pairs("eitan_wheel", AXLES_X, W / 2.0 - WHEEL_W * 0.35,
                        WHEEL_R, WHEEL_W, GROUND + WHEEL_R)

    # Remote weapon station on the roof of the raised compartment.
    kit.rws("eitan_rws", RWS, (RWS_AT[0], RWS_AT[1], floor_z + H + 0.42),
            barrel_len=0.95)

    # Vision blocks across the front of the compartment, and a stowage basket
    # at the tail: two small asymmetries so the front and rear are never
    # confusable at 100px.
    kit.box("eitan_glass", (0.10, W * 0.52, 0.20),
            (-0.9 + L * 0.23, 0.0, floor_z + H + 0.24), role="glass")
    kit.box("eitan_basket", (0.7, W * 0.74, 0.34),
            (-L / 2.0 + 0.45, 0.0, floor_z + H * 0.72), role="recess")

    kit.save(OUT)


if __name__ == "__main__":
    build()
