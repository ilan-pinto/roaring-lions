"""Build the enemy armed technical: a slab-sided pickup with a pintle-mounted HMG.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_technical.py

Writes art/src/vehicles/technical.blend.

BUILDS THE STARTING POINT. Like tools/showcase/apc_detail.py, this lays down the
base and the proportions; anything refined afterwards in a live session lives in
the .blend, which is then the authority. Check the file's own object count against
this script's before assuming they agree.

The shape follows a late-1970s single-cab light pickup, supplied as visual
reference only -- no geometry, texture or file from it enters this repository.
What that reference decides, against the rounder truck this script first built:

* **Slab flanks with squared arch cut-outs**, not bulging round fenders. The body
  side is one flat panel and the wheel opening is a notch in its bottom edge,
  which is why `prism` does the work here and boxes do not.
* **An upright windscreen.** About 26 degrees off vertical. The first build raked
  it near 35 and the cab read as a wedge rather than a box.
* **A level bonnet into a flat rectangular nose**, wide grille with the headlights
  inboard of it, and a straight bumper. No bull bar: the reference has none, and
  the raised gun is a stronger silhouette separator than a bar was.
* **Small wheels, tall body.** Plenty of painted flank below the belt line, which
  is most of what dates the shape.

Three things are decided by constraints elsewhere, not by taste:

* **Nose along +X.** The sprite rig's `facingOffset` is `(c - phi)/22.5` with the
  rig constant `c` at -90 deg, so a +X nose means offset 12 -- the same as the
  Eitan. Authoring nose-along--Y instead would mean offset 0 but disagree with the
  vehicle already in the repository.

* **The gun sits at the front of the bed, over the model's centre, above the cab
  roof.** The renderer composites the turret sheet at the *hull's* screen position
  with no anchor offset (renderer.ts:1342) while traversing it independently onto
  its target, so a turret's rotation centre is the model's pivot: a gun mounted at
  the tailgate would visibly swing off the truck while tracking. Measured, the
  pintle sits 4.7% of hull length from the pivot against the shipped Eitan's 4.2%.
  Height is a separate trap -- the first build put the barrel axis at 1.58 with the
  cab spanning 0.78-1.95, so it ran through the rear window and the truck read as
  unarmed.

* **Dark accents are load-bearing, not decoration.** The body is limestone, and
  the terrain's primary ramp is *also* limestone, so a uniformly pale truck would
  vanish on pale ground where every olive vehicle reads clearly. Tyres, bed floor,
  gun, glazing and the shut lines carry the contrast, so their roles matter as
  much as their shapes.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/vehicles/technical.blend")

# A light pickup of this era is about 5.0 m long, 1.70 wide, 1.80 to the cab roof.
# One unit is one metre, per kit.py.
#
# Proportions come off the reference: cab plus bonnet is about the same length as
# the bed. The first pass put the cab at a third of the body and the truck read as
# a flatbed, so the cab moved back and grew a taller greenhouse.
NOSE = 2.50
TAIL = -2.50
HALF_W = 0.85
SKIN = 0.06            # body panel thickness
WHEEL_R = 0.36
AXLE_F = 1.42
AXLE_R = -1.30         # 2.85 m wheelbase, as the reference
SILL = 0.58            # bottom of the painted flank
# The tyre nearly fills its opening on the reference. The first pass left the arch
# top 0.20 above the tyre, which read as a truck sagging inside oversized arches.
ARCH_TOP = 0.78
ARCH_HALF = 0.46       # half-width of the cut-out along x
BED_FLOOR = 0.80
BED_TOP = 1.26
CAB_BACK = 0.02
CAB_FRONT = 1.32       # windscreen base
BELT = 1.20            # window sill: painted body below, glass above
CAB_ROOF = 1.80
BONNET = 1.12
# High enough for the jacket to clear the cab roof, no higher. At BED_FLOOR+1.42
# the truck stood 2.62 -- taller than the Eitan APC -- and read as a mast vehicle
# rather than a pickup with a gun on it. The cure for that was never height: it was
# making the weapon big and the post short, so the gun dominates the mount.
GUN_AXIS = BED_FLOOR + 1.18


def bx(name, x0, x1, y0, y1, z0, z1, role="hull"):
    """A box from its bounds, which is how a vehicle is easier to reason about."""
    return kit.box(
        name,
        (x1 - x0, y1 - y0, z1 - z0),
        ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0),
        role,
    )


def prism(name, profile_xz, y0, y1, role="hull"):
    """Extrude an X-Z profile along Y.

    The primitive a slab-sided truck actually needs. A flank with a squared wheel
    cut-out, an upright windscreen and a level bonnet are all profiles, and none
    can be a rotated box: every part keeps its origin at the world origin, so an
    object-level rotation would pivot about the world origin rather than the part.
    Same trap that scattered the APC's tread blocks twice.
    """
    n = len(profile_xz)
    verts = [(x, y0, z) for x, z in profile_xz] + [(x, y1, z) for x, z in profile_xz]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    return kit._mesh(name, verts, faces, role)


def taper(name, r0, r1, length, at, role="metal", segments=12):
    """A truncated cone along +x. `at` is the centre of its r0 end.

    kit.barrel gives cylinders, which is most of a gun -- but a heavy weapon reads
    heavy largely through its muzzle brake, and that is a cone.
    """
    cx, cy, cz = at
    verts, faces = [], []
    for i in range(segments):
        a = 2.0 * math.pi * i / segments
        verts.append((cx, cy + math.cos(a) * r0, cz + math.sin(a) * r0))
    for i in range(segments):
        a = 2.0 * math.pi * i / segments
        verts.append((cx + length, cy + math.cos(a) * r1, cz + math.sin(a) * r1))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, j + segments, i + segments))
    faces.append(tuple(range(segments))[::-1])
    faces.append(tuple(range(segments, 2 * segments)))
    return kit._mesh(name, verts, faces, role)


def arch_notch(x_axle):
    """The bottom edge of a flank as it steps up over a wheel, front to back."""
    return [
        (x_axle - ARCH_HALF - 0.06, SILL),
        (x_axle - ARCH_HALF, ARCH_TOP),
        (x_axle + ARCH_HALF, ARCH_TOP),
        (x_axle + ARCH_HALF + 0.06, SILL),
    ]


def flanks():
    """The two slab sides. This is the shape the reference is really about."""
    # Forward flank: cab door and front wing in one panel, notched over the front
    # wheel, stepping down from the belt line to the bonnet at the windscreen.
    fwd = (
        [(CAB_BACK, SILL)]
        + arch_notch(AXLE_F)
        + [(NOSE - 0.06, SILL), (NOSE - 0.06, BONNET), (CAB_FRONT, BONNET),
           (CAB_FRONT, BELT), (CAB_BACK, BELT)]
    )
    # Bed flank: one plain panel, notched over the rear wheel, with a flat top rail.
    aft = (
        [(TAIL + 0.06, SILL)]
        + arch_notch(AXLE_R)
        + [(CAB_BACK - 0.08, SILL), (CAB_BACK - 0.08, BED_TOP), (TAIL + 0.06, BED_TOP)]
    )
    for tag, sign in (("l", 1.0), ("r", -1.0)):
        y_out = sign * HALF_W
        y_in = sign * (HALF_W - SKIN)
        prism(f"flank_fwd_{tag}", fwd, min(y_out, y_in), max(y_out, y_in), "hull")
        prism(f"flank_bed_{tag}", aft, min(y_out, y_in), max(y_out, y_in), "hull")
        # Top rail: the hard horizontal the bed reads by from above.
        bx(f"bed_rail_{tag}", TAIL + 0.04, CAB_BACK - 0.06,
           sign * (HALF_W - SKIN - 0.02), sign * (HALF_W + 0.02),
           BED_TOP, BED_TOP + 0.045, "plate")
        # Rubbing strip: one crease down a flat slab, and most of what dates it.
        bx(f"strip_{tag}", TAIL + 0.10, NOSE - 0.20,
           sign * HALF_W, sign * (HALF_W + 0.018), 0.94, 1.00, "plate")
        # Door shut lines, so a door reads as a door at 60 px.
        for i, x in enumerate((CAB_BACK + 0.04, CAB_FRONT - 0.06)):
            bx(f"door_seam_{i}_{tag}", x, x + 0.035,
               sign * HALF_W, sign * (HALF_W + 0.012), 0.62, BELT, "recess")


def body():
    """Floor, bulkheads and the closed volumes the flanks hang on."""
    bx("underbody", TAIL + 0.10, NOSE - 0.20, -HALF_W + SKIN, HALF_W - SKIN, 0.50, SILL + 0.04, "recess")
    bx("cab_floor", CAB_BACK, CAB_FRONT, -HALF_W + SKIN, HALF_W - SKIN, SILL, 0.74, "hull")
    bx("cab_back", CAB_BACK, CAB_BACK + 0.07, -HALF_W, HALF_W, 0.74, CAB_ROOF - 0.06, "hull")
    bx("bed_floor", TAIL + 0.06, CAB_BACK - 0.08, -HALF_W + SKIN, HALF_W - SKIN,
       BED_FLOOR - 0.055, BED_FLOOR, "recess")
    for i in range(7):
        x = TAIL + 0.24 + i * 0.36
        bx(f"bed_rib_{i}", x, x + 0.05, -HALF_W + SKIN, HALF_W - SKIN,
           BED_FLOOR, BED_FLOOR + 0.028, "metal")
    bx("tailgate", TAIL, TAIL + 0.07, -HALF_W, HALF_W, SILL, BED_TOP, "hull")
    bx("tailgate_rail", TAIL - 0.02, TAIL + 0.09, -HALF_W - 0.02, HALF_W + 0.02,
       BED_TOP, BED_TOP + 0.045, "plate")
    bx("tailgate_seam", TAIL - 0.01, TAIL + 0.08, -0.30, 0.30, SILL + 0.10, SILL + 0.14, "recess")
    # Bulkhead to rail height only. Taller and it reads as a wall closing the bed
    # off, which fights the one thing an open bed is there to say.
    bx("bed_front", CAB_BACK - 0.08, CAB_BACK - 0.01, -HALF_W, HALF_W, BED_FLOOR - 0.06, BED_TOP, "hull")


def greenhouse():
    """Upright glass in a thin roof. The cab has to read as a box, not a wedge."""
    bx("roof", CAB_BACK + 0.03, CAB_FRONT - 0.26, -HALF_W + 0.02, HALF_W - 0.02,
       CAB_ROOF - 0.055, CAB_ROOF, "hull")
    prism(
        "glass_windscreen",
        [(CAB_FRONT - 0.02, BELT), (CAB_FRONT + 0.02, BELT + 0.03),
         (CAB_FRONT - 0.22, CAB_ROOF - 0.04), (CAB_FRONT - 0.27, CAB_ROOF - 0.07)],
        -HALF_W + 0.05, HALF_W - 0.05, "glass",
    )
    for tag, sign in (("l", 1.0), ("r", -1.0)):
        y = sign * (HALF_W - 0.035)
        bx(f"glass_side_{tag}", CAB_BACK + 0.10, CAB_FRONT - 0.30,
           min(y, sign * HALF_W), max(y, sign * HALF_W), BELT, CAB_ROOF - 0.07, "glass")
        # Pillars over the glass, so the greenhouse is framed rather than floating.
        for name, x0, x1 in (("a", CAB_FRONT - 0.31, CAB_FRONT - 0.22),
                             ("b", CAB_BACK + 0.02, CAB_BACK + 0.10)):
            bx(f"pillar_{name}_{tag}", x0, x1,
               min(y, sign * HALF_W), max(y, sign * HALF_W), BELT - 0.02, CAB_ROOF, "hull")
        bx(f"mirror_arm_{tag}", CAB_FRONT - 0.30, CAB_FRONT - 0.24,
           sign * HALF_W, sign * (HALF_W + 0.16), BELT + 0.04, BELT + 0.09, "metal")
        bx(f"mirror_{tag}", CAB_FRONT - 0.31, CAB_FRONT - 0.25,
           sign * (HALF_W + 0.12), sign * (HALF_W + 0.20), BELT + 0.02, BELT + 0.22, "metal")
    bx("glass_rear", CAB_BACK + 0.03, CAB_BACK + 0.08, -HALF_W + 0.14, HALF_W - 0.14,
       BELT + 0.04, CAB_ROOF - 0.12, "glass")


def front():
    """A flat rectangular nose: wide grille, square headlights inboard, straight bar."""
    bx("bonnet", CAB_FRONT, NOSE - 0.06, -HALF_W + 0.01, HALF_W - 0.01, BONNET - 0.05, BONNET, "hull")
    bx("cowl", CAB_FRONT - 0.06, CAB_FRONT + 0.04, -HALF_W, HALF_W, BONNET - 0.04, BELT, "recess")
    bx("bonnet_seam", CAB_FRONT + 0.30, CAB_FRONT + 0.36, -HALF_W + 0.02, HALF_W - 0.02,
       BONNET - 0.01, BONNET + 0.012, "recess")
    bx("nose_panel", NOSE - 0.10, NOSE - 0.04, -HALF_W, HALF_W, 0.78, BONNET, "hull")
    # Grille: recessed, with the lights inside its rectangle rather than beside it.
    bx("grille_recess", NOSE - 0.09, NOSE - 0.03, -0.68, 0.68, 0.86, 1.10, "recess")
    for i in range(3):
        z = 0.90 + i * 0.06
        bx(f"grille_bar_{i}", NOSE - 0.10, NOSE - 0.02, -0.42, 0.42, z, z + 0.028, "metal")
    bx("grille_surround_t", NOSE - 0.11, NOSE - 0.02, -0.70, 0.70, 1.10, 1.14, "plate")
    bx("grille_surround_b", NOSE - 0.11, NOSE - 0.02, -0.70, 0.70, 0.82, 0.86, "plate")
    for tag, sign in (("l", 1.0), ("r", -1.0)):
        bx(f"light_{tag}", NOSE - 0.10, NOSE - 0.02,
           sign * 0.44, sign * 0.66, 0.90, 1.08, "glass")
        bx(f"indicator_{tag}", NOSE - 0.09, NOSE - 0.03,
           sign * 0.46, sign * 0.64, 0.80, 0.85, "plate")
    bx("bumper", NOSE - 0.13, NOSE, -HALF_W - 0.02, HALF_W + 0.02, 0.62, 0.76, "plate")
    bx("bumper_gap", NOSE - 0.12, NOSE - 0.05, -0.30, 0.30, 0.66, 0.72, "recess")
    for tag, sign in (("l", 1.0), ("r", -1.0)):
        bx(f"bumper_stay_{tag}", NOSE - 0.26, NOSE - 0.11,
           sign * 0.40, sign * 0.48, 0.64, 0.72, "metal")


def running_gear():
    bx("chassis_rail_l", TAIL + 0.10, NOSE - 0.24, 0.32, 0.44, 0.34, 0.50, "metal")
    bx("chassis_rail_r", TAIL + 0.10, NOSE - 0.24, -0.44, -0.32, 0.34, 0.50, "metal")
    bx("axle_f", AXLE_F - 0.06, AXLE_F + 0.06, -0.70, 0.70, 0.28, 0.40, "metal")
    bx("axle_r", AXLE_R - 0.07, AXLE_R + 0.07, -0.70, 0.70, 0.28, 0.40, "metal")
    bx("diff_r", AXLE_R - 0.15, AXLE_R + 0.15, -0.16, 0.16, 0.22, 0.48, "metal")
    bx("exhaust", TAIL + 0.24, AXLE_R, -0.36, -0.27, 0.20, 0.29, "metal")
    bx("fuel_tank", AXLE_R + 0.34, AXLE_R + 0.92, 0.26, 0.56, 0.32, 0.56, "metal")
    # Four wheels, not six: wheel count is the cheapest silhouette cue a wheeled
    # hull has, and it is what separates this from the eight-wheeled APC.
    for tag, x in (("f", AXLE_F), ("r", AXLE_R)):
        for side, y in (("l", 0.74), ("r", -0.74)):
            kit.wheel(f"tyre_{tag}{side}", WHEEL_R, 0.24, (x, y, WHEEL_R), "rubber", 12)
            kit.wheel(f"rim_{tag}{side}", WHEEL_R * 0.52, 0.26, (x, y, WHEEL_R), "plate", 10)
            kit.wheel(f"hub_{tag}{side}", WHEEL_R * 0.18, 0.28, (x, y, WHEEL_R), "metal", 8)


def gun(pivot_x=-0.30):
    """A heavy 14.5 mm machine gun on a pintle. `turret_*` so render_vehicle splits it.

    Sized up hard from the DShK-scale weapon of the previous pass, which read
    modest -- correct for a 12.7 but not what this unit wants. The cues that make a
    weapon read *heavy* are proportional, not additive: a long thick perforated
    jacket, a large conical muzzle brake, a big flat drum, and a short post so the
    gun dominates the mount rather than perching on it. Barrel reach is 1.75 m from
    the breech face, against 1.07 before.

    Built from cylinders and a cone where the weapon is round. Two earlier passes
    were boxes throughout and read as a dark blocky cluster; at 80 px the drum, the
    jacket and the muzzle brake are what carry it, because the barrel is nearly
    end-on in half the sixteen facings and cannot carry it alone.
    """
    zb = BED_FLOOR + 0.02
    zg = GUN_AXIS
    ax = zg + 0.02                       # bore axis

    # Mount: deliberately short and stout. Every centimetre of post is a
    # centimetre the weapon is not.
    bx("turret_pintle_plate", pivot_x - 0.26, pivot_x + 0.26, -0.26, 0.26, zb, zb + 0.06, "metal")
    bx("turret_pintle_post", pivot_x - 0.105, pivot_x + 0.105, -0.105, 0.105,
       zb + 0.06, zg - 0.34, "metal")
    for tag, sign in (("f", 1.0), ("a", -1.0)):
        prism(
            f"turret_gusset_{tag}",
            [(pivot_x + sign * 0.105, zb + 0.06),
             (pivot_x + sign * 0.42, zb + 0.06),
             (pivot_x + sign * 0.105, zb + 0.50)],
            -0.065, 0.065, "metal",
        )
    bx("turret_collar", pivot_x - 0.16, pivot_x + 0.16, -0.16, 0.16, zg - 0.34, zg - 0.24, "metal")
    for tag, sign in (("l", 1.0), ("r", -1.0)):
        bx(f"turret_trunnion_{tag}", pivot_x - 0.13, pivot_x + 0.13,
           sign * 0.145, sign * 0.20, zg - 0.26, zg + 0.08, "metal")
    bx("turret_elev_screw", pivot_x - 0.40, pivot_x - 0.28, -0.045, 0.045, zg - 0.28, zg - 0.02, "metal")
    bx("turret_elev_wheel", pivot_x - 0.48, pivot_x - 0.40, -0.10, 0.10, zg - 0.22, zg - 0.06, "metal")

    # Receiver: a big square-section body, which is what a 14.5 has.
    bx("turret_receiver", pivot_x - 0.42, pivot_x + 0.30, -0.135, 0.135, ax - 0.125, ax + 0.125, "metal")
    bx("turret_top_cover", pivot_x - 0.36, pivot_x + 0.12, -0.115, 0.115, ax + 0.125, ax + 0.185, "plate")
    bx("turret_feed_tray", pivot_x - 0.16, pivot_x + 0.12, 0.135, 0.40, ax - 0.02, ax + 0.07, "metal")
    bx("turret_ejector", pivot_x - 0.20, pivot_x + 0.02, -0.34, -0.135, ax - 0.09, ax + 0.02, "metal")

    # The flat drum: reads at a handful of pixels because it is a disc among boxes.
    kit.wheel("turret_ammo_drum", 0.225, 0.11, (pivot_x - 0.04, 0.45, ax - 0.03), "metal", 14)
    kit.wheel("turret_drum_face", 0.11, 0.125, (pivot_x - 0.04, 0.45, ax - 0.03), "plate", 10)

    # Barrel: breech, long perforated jacket, muzzle tube, conical brake.
    kit.barrel("turret_breech", 0.085, 0.24, (pivot_x + 0.30, 0.0, ax), "metal", 12)
    kit.barrel("turret_jacket", 0.105, 0.80, (pivot_x + 0.54, 0.0, ax), "metal", 14)
    for i in range(8):
        x = pivot_x + 0.60 + i * 0.090
        kit.barrel(f"turret_jacket_slot_{i}", 0.110, 0.034, (x, 0.0, ax), "recess", 14)
    kit.barrel("turret_muzzle_tube", 0.062, 0.34, (pivot_x + 1.34, 0.0, ax), "metal", 12)
    taper("turret_brake_cone", 0.072, 0.125, 0.20, (pivot_x + 1.68, 0.0, ax), "metal", 14)
    kit.barrel("turret_brake_mouth", 0.125, 0.055, (pivot_x + 1.88, 0.0, ax), "metal", 14)
    for i in range(3):
        x = pivot_x + 1.72 + i * 0.05
        kit.barrel(f"turret_brake_slot_{i}", 0.132, 0.022, (x, 0.0, ax), "recess", 14)

    # Controls and the gunner's station.
    for tag, sign in (("l", 1.0), ("r", -1.0)):
        prism(
            f"turret_grip_{tag}",
            [(pivot_x - 0.42, ax - 0.08), (pivot_x - 0.34, ax - 0.08),
             (pivot_x - 0.52, ax - 0.40), (pivot_x - 0.60, ax - 0.40)],
            sign * 0.11, sign * 0.165, "metal",
        )
    bx("turret_grip_bar", pivot_x - 0.62, pivot_x - 0.50, -0.165, 0.165, ax - 0.43, ax - 0.35, "metal")
    bx("turret_seat_post", pivot_x - 0.74, pivot_x - 0.64, -0.06, 0.06, zb + 0.06, zg - 0.62, "metal")
    bx("turret_seat", pivot_x - 0.86, pivot_x - 0.54, -0.19, 0.19, zg - 0.62, zg - 0.55, "plate")

    # Shield: sized to the weapon. A small plate behind a big gun reads as a sign.
    bx("turret_shield", pivot_x + 0.22, pivot_x + 0.30, -0.36, 0.36, ax - 0.28, ax + 0.34, "plate")
    for tag, sign in (("l", 1.0), ("r", -1.0)):
        bx(f"turret_shield_lip_{tag}", pivot_x + 0.06, pivot_x + 0.30,
           sign * 0.31, sign * 0.38, ax - 0.28, ax + 0.24, "plate")
    bx("turret_shield_slot", pivot_x + 0.21, pivot_x + 0.31, -0.12, 0.12, ax - 0.10, ax + 0.14, "recess")


def stowage():
    """Enough to read as improvised, not enough to bury the bed."""
    for i, y in enumerate((-0.52, -0.22)):
        bx(f"jerry_{i}", TAIL + 0.22, TAIL + 0.50, y - 0.13, y + 0.13,
           BED_FLOOR, BED_FLOOR + 0.40, "metal")
    bx("crate", TAIL + 0.64, TAIL + 1.10, 0.20, 0.68, BED_FLOOR, BED_FLOOR + 0.26, "plate")


def bevel_all(width=0.010):
    """One bevel per part, as on the APC. Flat-shaded boxes read as cardboard; a
    bevel catches the key light and gives every panel an edge."""
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = width
        m.segments = 2
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40.0)


def report():
    xs, ys, zs = [], [], []
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        for v in ob.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    xs.sort(); ys.sort(); zs.sort()
    mid = len(xs) // 2
    turret = [o.name for o in bpy.data.objects if o.name.startswith("turret_")]
    length = xs[-1] - xs[0]
    print(f"objects {len(bpy.data.objects)}  turret parts {len(turret)}")
    print(f"extent  L {length:.3f}  W {ys[-1] - ys[0]:.3f}  H {zs[-1] - zs[0]:.3f}")
    print(f"median centre (the rig's pivot)  x {xs[mid]:+.3f}  z {zs[mid]:+.3f}")
    post = [o for o in bpy.data.objects if o.name == "turret_pintle_post"][0]
    axis = sum(v.co.x for v in post.data.vertices) / len(post.data.vertices)
    off = abs(axis - xs[mid])
    print(f"gun traverse axis {axis:+.3f}, offset from pivot {off:.3f} = "
          f"{off / length * 100:.1f}% of length (Eitan ships at 4.2%)")
    print(f"gun clears cab roof by {GUN_AXIS - CAB_ROOF:+.2f}")


def main():
    kit.new_scene()
    running_gear()
    flanks()
    body()
    greenhouse()
    front()
    gun()
    stowage()
    bevel_all()
    report()
    kit.save(OUT)


if __name__ == "__main__":
    main()
