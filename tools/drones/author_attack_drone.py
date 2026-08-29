"""Build the KDF attack drone: a blunt cylindrical body, cruciform tail, nose pod.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/drones/author_attack_drone.py

Writes art/src/drones/attack_drone.blend.

BUILDS THE STARTING POINT, same convention as tools/vehicles/author_*.py --
this script lays down the shape from primitives; nothing downloaded, nothing
textured. `credit`: "Attack drone -- authored from primitives for this
repository, CC BY-SA 4.0".

Why this shape, against the two drones already in art/src/drones/:

* `loiter_drone`'s source (loitering_munition.blend) is a broad swept-delta
  flying wing -- most of its silhouette area is the wing.
* `recon_drone`'s source is a quadcopter: four splayed rotor arms.
* This unit is neither. It is a short, blunt fuselage (a stubby cylinder, not
  a wing) with a small cruciform ("+") tail -- four flat fins at 90 degrees --
  and a tapered nose sensor pod. Silhouette area concentrates along the body's
  centreline instead of spreading into a wing or rotor arms, which is what
  keeps it apart from both existing air units at gameplay zoom.

Nose along +x, matching every other drone source in this directory --
render_drone.py and render_loiter.py both declare `facing_offset=0` for that
reason, and a new drone disagreeing with that convention would need a reason
this shape does not have.

Overall nose-to-tail length is 1.05 (this script's own units are declared
metres directly -- render_attack_drone.py's `real_metres=1.05` is this exact
number, not a derived one, so there is nothing to reconcile between the model
and the manifest).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vehicles"))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/drones/attack_drone.blend")

# All lengths in metres directly -- this source is built at 1:1 scale, unlike
# the vehicle kit's "roughly a metre per unit" convention that still needs
# metres_per_unit() to convert. real_metres=1.05 in render_attack_drone.py is
# this number verbatim.
#
# BODY_R is deliberately fat for the airframe's length (0.32m diameter on a
# 1.05m body, an aspect ratio no real loitering munition has) -- the first cut
# used a slender 0.12m diameter and rendered at 5.0-5.4% fill, under
# validate_assets.py's 6% MIN_FILL floor. ortho_scale_for_turning frames a
# rotating body from its axial reach (the nose/tail tips, at radius ~0.87 from
# the model's median vertex) almost independently of BODY_R -- radius 0.06 ->
# 0.16 grew the frame only 1.8% (checked against dimetric.py's own function
# before re-rendering) while roughly tripling the body's frontal silhouette.
# A frame sized for the worst-case rotation of a long thin shape is mostly
# empty at any single broadside facing; fattening the one dimension that does
# not drive that worst case is the fix, not lengthening or shortening the
# airframe itself.
BODY_R = 0.16
TAIL_X = -0.50
BODY_LEN = 0.85          # tail -> pod join,     x -0.50 .. 0.35
COLLAR_LEN = 0.02         # pod join lip,          x  0.35 .. 0.37
POD_LEN = 0.12            # sensor pod housing,    x  0.37 .. 0.49
TIP_LEN = 0.06            # seeker tip,            x  0.49 .. 0.55
POD_R0 = BODY_R + 0.006
POD_R1 = BODY_R * 0.55
TIP_R0 = BODY_R * 0.55
TIP_R1 = 0.004            # near-point, never exactly zero -- degenerate faces
                           # quantize unpredictably at render time.

# Cruciform tail fins, "+" pattern -- top/bottom/left/right, each an
# axis-aligned flat plate. No rotation needed: a "+" cross is already aligned
# to the body's own y/z axes, unlike an "x" cross would be. FIN_SPAN pulled in
# from the first cut's 0.20 to 0.16 alongside the BODY_R increase above, so
# the fins' own diagonal reach does not become the new frame driver.
FIN_X0 = -0.46
FIN_X1 = -0.30
FIN_MID = (FIN_X0 + FIN_X1) / 2.0
FIN_CHORD = FIN_X1 - FIN_X0
FIN_THICK = 0.02
FIN_SPAN = 0.16            # radiates outward from the body surface
FIN_CENTRE = BODY_R + FIN_SPAN / 2.0


def taper(name, r0, r1, length, at, role="metal", segments=10):
    """A cylinder along +x from `at`, radius r0 at the near end, r1 at the far
    end -- barrel() with independent end radii, for a nose that narrows.
    `at` is the near (r0) end's centre, matching barrel()'s own convention."""
    cx, cy, cz = at
    v, f = [], []
    for end, (x_off, rad) in enumerate(((0.0, r0), (length, r1))):
        for i in range(segments):
            a = 2 * math.pi * i / segments
            v.append((cx + x_off, cy + rad * math.cos(a), cz + rad * math.sin(a)))
    for i in range(segments):
        j = (i + 1) % segments
        f.append((i, j, segments + j, segments + i))
    f.append(tuple(range(segments - 1, -1, -1)))
    f.append(tuple(range(segments, 2 * segments)))
    return kit._mesh(name, v, f, role)


def build():
    kit.new_scene()

    kit.barrel("BODY", BODY_R, BODY_LEN, (TAIL_X, 0.0, 0.0), role="hull")
    taper("COLLAR", POD_R0 + 0.003, POD_R0 + 0.003, COLLAR_LEN,
          (TAIL_X + BODY_LEN, 0.0, 0.0), role="recess")
    taper("POD", POD_R0, POD_R1, POD_LEN,
          (TAIL_X + BODY_LEN + COLLAR_LEN, 0.0, 0.0), role="plate")
    taper("TIP", TIP_R0, TIP_R1, TIP_LEN,
          (TAIL_X + BODY_LEN + COLLAR_LEN + POD_LEN, 0.0, 0.0), role="metal")

    kit.box("FIN_TOP", (FIN_CHORD, FIN_THICK, FIN_SPAN),
            (FIN_MID, 0.0, FIN_CENTRE), role="plate")
    kit.box("FIN_BOTTOM", (FIN_CHORD, FIN_THICK, FIN_SPAN),
            (FIN_MID, 0.0, -FIN_CENTRE), role="plate")
    kit.box("FIN_RIGHT", (FIN_CHORD, FIN_SPAN, FIN_THICK),
            (FIN_MID, FIN_CENTRE, 0.0), role="plate")
    kit.box("FIN_LEFT", (FIN_CHORD, FIN_SPAN, FIN_THICK),
            (FIN_MID, -FIN_CENTRE, 0.0), role="plate")

    nose_x = TAIL_X + BODY_LEN + COLLAR_LEN + POD_LEN + TIP_LEN
    length = nose_x - TAIL_X
    fin_tip = FIN_CENTRE + FIN_SPAN / 2.0
    print(f"nose-to-tail length: {length:.3f} m (target 1.05)")
    print(f"fin tip radius: {fin_tip:.3f} m, body radius: {BODY_R:.3f} m")

    kit.save(OUT)


if __name__ == "__main__":
    build()
