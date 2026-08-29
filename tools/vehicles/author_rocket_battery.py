"""Build the enemy rocket battery: a 6x6 truck with an elevated launcher rack.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_rocket_battery.py

Writes art/src/vehicles/rocket_battery.blend.

BUILDS THE STARTING POINT, same convention as author_technical.py and
author_d9.py: this script lays down the shape from tools/vehicles/kit.py
primitives; nothing downloaded, nothing textured. `credit`: "Rocket battery --
authored from primitives for this repository, CC BY-SA 4.0".

A BM-21 Grad-on-Ural-375D's real proportions (7.3m x 2.4m; the design docs
name the weapon `grad_122` but state no physical size for the platform
itself) -- built here as a cab-forward 6x6 chassis with a boxy, angled rack
mounted over the rear bed, tubes elevated toward the nose. Three things
decided against the two wheeled vehicles already in this directory
(technical.blend, gun_truck.blend):

* **Three axles, not two.** `wheels_in_pairs` places a front steering axle
  and a tight-spaced rear bogie (tandem axle) -- six wheels total. Wheel
  *count* is this kit's own cheapest silhouette cue (see kit.py's own
  `wheels_in_pairs` docstring), and nothing else on the roster carries six.

* **The rack, not a turret.** `render_rocket_battery.py` renders this as a
  hull-only sheet -- the tube pack is fixed to the bed, not a separately
  traversing weapon station, so there is no `turret_meshes` set and no second
  pass. The distinguishing silhouette is the rack's fixed angle, not a
  tracked one.

* **`angled_box`, not an object-level rotation.** The rack's elevation is
  baked into its vertex coordinates directly, the same "real vertex
  coordinates, object scale always 1" discipline kit.py states for every
  other part -- render_gun_truck.py's cannon elevation was modelled the same
  way (baked into the source, not applied by the render rig), and this keeps
  that precedent rather than introducing object rotation as a second way to
  tilt a part.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/vehicles/rocket_battery.blend")

# Metres, nose along +x -- same convention as author_technical.py. One kit
# unit is one metre (kit.py's own UNITS_PER_TILE comment).
NOSE = 3.65
TAIL = -3.65
HALF_W = 1.05             # body half-width; overall body ~2.1m, wheels track wider
DECK = 0.95                # chassis rail top -- where the cab, bed and rack all sit

WHEEL_R = 0.55
WHEEL_W = 0.34
Y_TRACK = 1.15             # wheel hub offset from centreline -- wider than the body
AXLE_FRONT = 2.45
AXLE_REAR_1 = -2.05
AXLE_REAR_2 = -2.95        # 0.90m from AXLE_REAR_1 -- a tight tandem bogie, not an
                            # evenly-spaced third axle.

CAB_LEN = 1.55
CAB_X = 2.75               # centre; cab nose sits at NOSE
CAB_HEIGHT = 1.55

RACK_HINGE = (-1.75, 0.0, DECK)
RACK_LEN = 3.05
RACK_ELEV_DEG = 38.0
RACK_WIDTH = 1.85
RACK_THICK = 0.85


def angled_box(name, length, width, height, base, pitch_deg, role="metal"):
    """A box whose length axis runs from `base`, tilted `pitch_deg` up (toward
    +z) from local +x. `width` is along y, untouched by the tilt. `height` is
    the box's thickness measured perpendicular to the length axis within the
    tilt plane, centred on it. Structurally box() with (length, width, height)
    standing in for box()'s own (x, y, z) -- same vertex order, same faces --
    and anchored at its near end like barrel(), since `base` is a hinge, not a
    centre.
    """
    bx, by, bz = base
    p = math.radians(pitch_deg)
    ux, uz = math.cos(p), math.sin(p)
    hx, hz = -uz, ux
    hw, hh = width / 2.0, height / 2.0

    def pt(l, y, h):
        return (bx + ux * l + hx * h, by + y, bz + uz * l + hz * h)

    l0, l1 = 0.0, length
    y0, y1 = -hw, hw
    h0, h1 = -hh, hh
    v = [
        pt(l0, y0, h0), pt(l1, y0, h0), pt(l1, y1, h0), pt(l0, y1, h0),
        pt(l0, y0, h1), pt(l1, y0, h1), pt(l1, y1, h1), pt(l0, y1, h1),
    ]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return kit._mesh(name, v, f, role)


def build():
    kit.new_scene()

    # Chassis rail / frame -- one low box the cab, bed and rack all stand on.
    kit.box("CHASSIS", (NOSE - TAIL - 0.3, HALF_W * 2.0, DECK),
            ((NOSE + TAIL) / 2.0, 0.0, DECK / 2.0), role="hull")

    # Cab, sloped like the technical's for a broken silhouette rather than a
    # shipping-container front.
    kit.hull_box("CAB", CAB_LEN, HALF_W * 1.9, CAB_HEIGHT,
                 (CAB_X - CAB_LEN / 2.0, 0.0, DECK), slope_deg=14.0, nose_deg=16.0,
                 role="hull")
    kit.box("CAB_GLASS", (0.06, HALF_W * 1.5, 0.55),
            (CAB_X - CAB_LEN * 0.28, 0.0, DECK + CAB_HEIGHT * 0.62), role="glass")

    # Bonnet ahead of the cab, closing the gap to NOSE.
    bonnet_len = NOSE - (CAB_X - CAB_LEN / 2.0)
    kit.box("BONNET", (bonnet_len, HALF_W * 1.7, 0.55),
            (NOSE - bonnet_len / 2.0, 0.0, DECK + 0.275), role="plate")

    # Bed -- the flat load area behind the cab, under the rack's hinge end.
    bed_len = (CAB_X - CAB_LEN / 2.0) - TAIL - 0.15
    kit.box("BED", (bed_len, HALF_W * 1.9, 0.12),
            (TAIL + bed_len / 2.0 + 0.15, 0.0, DECK + 0.06), role="plate")

    # Rack cradle -- the mount the tube pack pivots from, small and grounded.
    kit.box("RACK_CRADLE", (0.5, RACK_WIDTH * 0.55, 0.35),
            (RACK_HINGE[0], 0.0, DECK + 0.18), role="plate")

    # The tube pack itself -- one boxy angled mass, standing in for the
    # 40-tube rack. Individual tubes are sub-pixel at gameplay zoom; the box
    # is what a 64px silhouette actually shows.
    angled_box("RACK", RACK_LEN, RACK_WIDTH, RACK_THICK, RACK_HINGE,
               RACK_ELEV_DEG, role="metal")

    kit.wheels_in_pairs("WHEEL", [AXLE_FRONT, AXLE_REAR_1, AXLE_REAR_2],
                        Y_TRACK, WHEEL_R, WHEEL_W, WHEEL_R, role="rubber")

    length = NOSE - TAIL
    print(f"nose-to-tail length: {length:.3f} m (target 7.3)")
    print(f"body half-width: {HALF_W:.3f} m (target ~1.2, overall 2.4)")
    print(f"wheel axles: front {AXLE_FRONT}, rear bogie {AXLE_REAR_1}/{AXLE_REAR_2}"
          f" (spacing {AXLE_REAR_1 - AXLE_REAR_2:.2f} m) -- 6 wheels total")

    kit.save(OUT)


if __name__ == "__main__":
    build()
