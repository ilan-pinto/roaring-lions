"""Author art/src/vehicles/scout_shachaf.blend -- the KDF light scout car.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_scout_shachaf.py

Star-gated special unit (`docs/campaign/special_units/design.md` unit II,
`stars_min: 30`). Built the same way `author_eitan.py` builds the Eitan --
from `tools/vehicles/kit.py` primitives, not Meshy -- because there is no
supplied scout-car or carrier `.blend` in `art/blend/` at all (that design
doc's own asset-manifest row), and the one candidate that exists (a supplied
Meshy jeep source) collides with `jeep_shoded.glb` on silhouette IoU rather
than standing in for a distinct hull.

Proportions come from the unit's own data (`design.md` §4), not a reference
photo, the same rule `author_eitan.py` states for itself:

    sight_tiles 16       the roster's longest ground eye -- so the tell has to
                          be an ANTENNA/mast, not a gun; nothing about size says
                          "sensor platform" at 25-80 px the way a raised mast does
    hull.armor 130/75/50  a fifth of the Eitan's 220 front -- thin plating, so a
                          LOW, slim hull rather than a boxy armoured one
    weapon cupola_mg      a defensive .50, not a main gun -- small and fixed
                          (this pass omits a turret split entirely, the same
                          "unarmed" branch `author_d9.py`'s sibling export takes:
                          `turret_prefixes=()` in export_mesh_vehicle.py)
    mobility.wheeled      2 axles / 4 wheels, not the Eitan's 8x8 -- wheel COUNT
                          is `tools/vehicles/kit.py`'s own cheapest silhouette
                          lever, and a lighter car reads lighter with fewer of them

Height/length is 2.75/4.6 = 0.60 (mast included) -- taller for its length than
every other vehicle in the roster, which is deliberate: the mast is the whole
point, and it has to clear the hull roof by enough to read as a mast and not a
roof fitting. Hull-only height/length (1.15/4.6 = 0.25) sits close to the
Eitan's own 0.26, which is the read this vehicle should NOT stand out on --
it is a light hull with a tall thing on top of it, not a short one.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/vehicles/scout_shachaf.blend")

# --- the approved numbers --------------------------------------------------
L, W, H = 4.6, 2.0, 1.15      # hull length, width, height in metres
SLOPE = 12.0                   # flank lean, degrees (same as Eitan -- the
                                # angle that separates armour from a shipping
                                # container at gameplay zoom, not a per-vehicle taste)
NOSE = 20.0                    # front plate rake, degrees -- steeper than the
                                # Eitan's 18: a scout car's nose reads sleeker
WHEEL_R, WHEEL_W = 0.42, 0.26  # smaller than the Eitan's 0.55/0.34 -- a lighter car
GROUND = 0.09
AXLES_X = (-1.35, 1.35)        # 2 axles, not 4 -- the wheel-count lever

CAB_L, CAB_W, CAB_H = L * 0.39, W * 0.84, 0.34   # raised observation cab, rear half
CAB_X = -0.55                   # centre, aft of hull centre

MAST_W, MAST_H = 0.07, 1.05      # the unit's own tell: a mast standing this
                                  # tall off the cab roof is not on any other
                                  # vehicle in the roster
MAST_X = -0.85                   # near the rear of the cab roof
HEAD_SIZE = (0.24, 0.24, 0.18)    # sensor head atop the mast

PINTLE_SIZE = (0.12, 0.12, 0.10)  # cupola_mg -- small and fixed, not a manned turret


def build():
    kit.new_scene()

    floor_z = GROUND + WHEEL_R * 0.35   # hull sits into the wheel line, not on top

    # Body. Steeper nose rake than the Eitan reads sleeker at this length.
    kit.hull_box("shachaf_hull", L, W, H, (0.0, 0.0, floor_z),
                 slope_deg=SLOPE, nose_deg=NOSE)

    # Raised observation cab over the rear half -- where the mast plants,
    # and the one shape that keeps the profile from being a single wedge.
    kit.hull_box("shachaf_cab", CAB_L, CAB_W, CAB_H,
                 (CAB_X, 0.0, floor_z + H), slope_deg=8.0)

    # Two axles, four wheels -- half the Eitan's count, the cheapest lever
    # `tools/vehicles/kit.py`'s own docstring names for reading as a lighter
    # vehicle: "wheel COUNT is the cheapest silhouette cue... and it survives
    # being 100px wide".
    kit.wheels_in_pairs("shachaf_wheel", AXLES_X, W / 2.0 - WHEEL_W * 0.35,
                        WHEEL_R, WHEEL_W, GROUND + WHEEL_R)

    # Vision glass at the cab's own front edge (cab centre + half its length),
    # the same "front edge, not front face" placement author_eitan.py uses.
    glass_x = CAB_X + CAB_L / 2.0
    kit.box("shachaf_glass", (0.08, W * 0.50, 0.16),
            (glass_x, 0.0, floor_z + H + 0.17), role="glass")

    # The mast: the unit's whole silhouette tell, standing off the cab roof.
    cab_roof_z = floor_z + H + CAB_H
    kit.box("shachaf_mast", (MAST_W, MAST_W, MAST_H),
            (MAST_X, 0.0, cab_roof_z + MAST_H / 2.0), role="metal")
    kit.box("shachaf_sensor_head", HEAD_SIZE,
            (MAST_X, 0.0, cab_roof_z + MAST_H + HEAD_SIZE[2] / 2.0), role="metal")

    # A small fixed pintle mount (cupola_mg) on the cab roof, forward of the
    # mast -- no turret split, matching the dozer's own "unarmed" hull-only
    # branch in export_mesh_vehicle.py (turret_prefixes=()).
    kit.box("shachaf_pintle", PINTLE_SIZE,
            (glass_x - 0.10, 0.0, cab_roof_z + PINTLE_SIZE[2] / 2.0), role="metal")

    kit.save(OUT)


if __name__ == "__main__":
    build()
