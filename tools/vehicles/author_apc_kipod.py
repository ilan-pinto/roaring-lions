"""Author art/src/vehicles/apc_kipod.blend -- the KDF screen carrier.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_apc_kipod.py

Star-gated special unit (`docs/campaign/special_units/design.md` unit III,
`stars_min: 44`). Built from `tools/vehicles/kit.py` primitives, the same
authored-not-Meshy pipeline `author_eitan.py` uses, for the same reason: no
supplied carrier `.blend` exists in `art/blend/` at all.

Proportions come from the unit's own data (`design.md` §5), sitting between
`apc_eitan` (520 cost, 220mm front, 2 seats) and `ifv_namer` (630 cost,
420mm front, 5 seats) on every axis:

    hp 1750, front 260      between the two -- a heavier hull than the
                            Eitan's, not the Namer's turretless-IFV bulk
    transport_slots 6       protected CAPACITY is the whole point ("nothing
                            the KDF fields is protected capacity" --
                            design.md §5) -- a full-length raised roof, not
                            the Eitan's rear-only cab, is what a 6-seat
                            compartment actually needs
    hull.era true           reactive plate -- modelled as slab screens
                            standing PROUD of the hull flanks, the visible
                            read for "carries its protection" (the unit's
                            own blurb) that a flush skirt (the Eitan's own
                            side treatment) cannot give
    weapon remote_mg        a defensive gun that "cannot kill a truck" --
                            small and fixed, the same unarmed-turret
                            simplification `author_scout_shachaf.py` takes
                            (no turret split; `turret_prefixes=()`)

Distinctness from the Eitan is carried on three independent levers, not one:
wheel count (3 axles/6, evenly spaced, against the Eitan's 4/8 uneven-spaced
"a real carrier's crew door" pattern), the screens standing proud rather than
flush, and a roof spanning most of the hull rather than only its rear third
-- so the Eitan's two-tier stepped profile becomes a flatter, boxier one here
even before the screens are added. Height/length is 2.75/7.2 = 0.38 hull+roof
alone (screens do not add height), against the Eitan's 0.26 -- taller for its
length, which is the "raised troop compartment" read design.md asks for.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/vehicles/apc_kipod.blend")

# --- the approved numbers --------------------------------------------------
L, W, H = 7.2, 2.7, 1.85       # hull length, width, height in metres
SLOPE = 10.0
NOSE = 14.0
WHEEL_R, WHEEL_W = 0.60, 0.36   # bigger than the Eitan's 0.55/0.34 -- a heavier hull
GROUND = 0.11
AXLES_X = (-2.6, 0.0, 2.6)      # 3 axles, EVENLY spaced -- against the Eitan's
                                 # 4, deliberately uneven ("an even spacing
                                 # reads as a trailer" is the Eitan's own
                                 # reasoning; the inversion is this vehicle's
                                 # own lever, on top of the axle-count drop)

ROOF_L, ROOF_W, ROOF_H = L * 0.82, W * 0.90, 0.55   # full-length troop compartment
ROOF_X = -0.20                   # near hull centre, not the Eitan's rear third

SCREEN_L, SCREEN_H, SCREEN_THICK = L * 0.70, 1.30, 0.06   # slab side-screens
SCREEN_STANDOFF = 0.18            # gap between hull flank and screen -- what
                                   # makes it read as standing PROUD, not a skirt
SCREEN_X = -0.10

RWS_SIZE = (0.85, 0.65, 0.42)      # remote_mg mount -- bigger than the
                                    # Eitan's rws (0.9, 0.7, 0.45) is close on
                                    # purpose: same weapon CLASS, heavier hull
RWS_AT_X = 1.1                     # forward on the roof

STOWAGE_SIZE = (0.55, W * 0.62, 0.30)   # rear recess -- front/rear asymmetry


def build():
    kit.new_scene()

    floor_z = GROUND + WHEEL_R * 0.35

    kit.hull_box("kipod_hull", L, W, H, (0.0, 0.0, floor_z),
                 slope_deg=SLOPE, nose_deg=NOSE)

    # Full-length raised troop compartment -- the "protected capacity" read,
    # against the Eitan's rear-only cab. Six seats live under this roof.
    kit.hull_box("kipod_roof", ROOF_L, ROOF_W, ROOF_H,
                 (ROOF_X, 0.0, floor_z + H), slope_deg=6.0)

    # Three axles, six wheels, evenly spaced -- both levers against the
    # Eitan's 4/8 uneven layout.
    kit.wheels_in_pairs("kipod_wheel", AXLES_X, W / 2.0 - WHEEL_W * 0.35,
                        WHEEL_R, WHEEL_W, GROUND + WHEEL_R)

    # Slab side-screens: standoff plate standing PROUD of the hull, running
    # most of its length -- "carries its protection" (design.md's own
    # blurb), and the lever that separates ERA slabs from the Eitan's flush
    # bolt-on skirts.
    screen_y = W / 2.0 + SCREEN_STANDOFF + SCREEN_THICK / 2.0
    screen_z = floor_z + 1.05
    for sy, tag in ((-1, "l"), (1, "r")):
        kit.box(f"kipod_screen_{tag}", (SCREEN_L, SCREEN_THICK, SCREEN_H),
                (SCREEN_X, sy * screen_y, screen_z), role="plate")

    # Vision glass at the roof's own front edge.
    glass_x = ROOF_X + ROOF_L / 2.0
    kit.box("kipod_glass", (0.10, W * 0.46, 0.18),
            (glass_x, 0.0, floor_z + H + 0.20), role="glass")

    # Remote weapon station on the roof -- fixed, no turret split (matches
    # `author_scout_shachaf.py`'s own "cannot kill a truck" defensive mount).
    kit.rws("kipod_rws", RWS_SIZE, (RWS_AT_X, 0.0, floor_z + H + ROOF_H),
            barrel_len=1.0)

    # A rear stowage recess -- front/rear asymmetry, the same trick the
    # Eitan's own basket gives it.
    kit.box("kipod_stowage", STOWAGE_SIZE,
            (-L / 2.0 + 0.35, 0.0, floor_z + H * 0.68), role="recess")

    kit.save(OUT)


if __name__ == "__main__":
    build()
