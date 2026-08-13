"""Build the KDF D9 Dov: an armoured bulldozer with a full-width moldboard.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_d9.py

Writes art/src/vehicles/d9.blend.

BUILDS THE STARTING POINT, like author_technical.py. This lays down the base and
the proportions; anything refined afterwards in a live session lives in the
.blend, which is then the authority.

The whole design problem is that this is a **tracked olive box next to three other
tracked olive boxes** -- TNK_HULL, EITAN_HULL and NAMER_HULL all draw at 125-126 px
and the art gate rejects a pairwise silhouette IoU at or above 0.88. Four decisions
exist only to break that:

* **The moldboard sits clear of the tracks, on visible push arms.** Not a bumper.
  The gap between blade and hull is the single most distinctive thing in the
  outline, so the arms are thin and the gap is real.
* **The cab is set back and stands tall**, roughly over the rear third, where a
  tank's turret sits over the middle. Its roofline is a flat overhanging plate,
  not a dome.
* **A tall exhaust stack breaks the roofline** beside the cab. It is the one
  vertical line no tank in the set has.
* **A ripper tine projects behind.** Tanks end at the hull; this does not, so the
  silhouette is asymmetric front-to-back at every facing.

Two things are decided by constraints elsewhere:

* **Blade along +X.** The rig's `facingOffset` is `(c - phi)/22.5` with the rig
  constant `c` at -90 deg, so a +X front means offset 12 -- matching the Eitan, the
  technical and the gun truck.
* **No turret sheet.** The D9 is unarmed (see the design spec), so this writes a
  hull sheet only and `turret_meshes` stays empty.

Geometry is authored from real dimensions. A D9R is about 8.1 m over the blade and
ripper, 4.1 m wide, 3.9 m to the cab roof. One unit is one metre, per kit.py.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/vehicles/d9.blend")

TRACK_Y = 1.55          # track centreline; outer face lands at 2.02, so 4.05 wide
TRACK_L = 5.40
TRACK_H = 1.25
DECK_Z = 1.32           # floor of the upper body
CAB_Z = 2.37            # floor of the cab, i.e. the deck roof

# The one unresolved tension in this model, named so it can be dialled.
#
# From three-quarter facings the deck crowds the moldboard, and the two ways out
# pull against each other: raise BLADE_TOP and the machine stops looking like a
# D9R, which has a notably low blade against a tall cab; drop CAB_H and the
# roofline stops separating it from TNK_HULL, which is the whole reason the cab
# is tall. Env overrides exist so variants can be rendered without editing this
# file -- D9_BLADE_TOP=2.15 D9_CAB_H=1.45, and so on.
# 2.20 chosen against 1.88 and against a 1.15 cab, rendered side by side
# (art/showcase/d9_var_*.png). It is the only one of the three where the blade
# clears the deck from the default facing; dropping the cab instead loses the
# roofline separation without buying any blade back. A real D9R carries a lower
# blade than this -- that is the realism given up, deliberately, for the gate.
BLADE_TOP = float(os.environ.get("D9_BLADE_TOP", 2.20))
CAB_H = float(os.environ.get("D9_CAB_H", 1.45))


def plate(name, verts_xz, half_width, role="metal"):
    """A flat panel of arbitrary profile in the x-z plane, extruded across y.

    The moldboard and the ripper both lean, and an unapplied object rotation is a
    trap here: render_vehicle sizes the sprite frame from vertex positions, so a
    rotated-but-unapplied part reports its unrotated extent and the frame comes out
    wrong. Same rule teams._lean_forward exists for. Building the lean into the
    vertices sidesteps it entirely.
    """
    n = len(verts_xz)
    v = [(x, -half_width, z) for x, z in verts_xz] + [(x, half_width, z) for x, z in verts_xz]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    return kit._mesh(name, v, faces, role)


def pipe(name, radius, height, at, role="metal", segments=10):
    """A vertical cylinder. kit.wheel lies on its side and kit.barrel points along
    +x; the exhaust stack is the first part here that stands up."""
    cx, cy, cz = at
    ring = [(cx + radius * math.cos(2 * math.pi * i / segments),
             cy + radius * math.sin(2 * math.pi * i / segments)) for i in range(segments)]
    v = [(x, y, cz) for x, y in ring] + [(x, y, cz + height) for x, y in ring]
    faces = [tuple(range(segments)), tuple(range(2 * segments - 1, segments - 1, -1))]
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, j + segments, i + segments))
    return kit._mesh(name, v, faces, role)


def build():
    kit.new_scene()

    # ---- running gear -------------------------------------------------------
    for side, sy in (("l", -TRACK_Y), ("r", TRACK_Y)):
        kit.box(f"track_{side}", (TRACK_L, 0.95, TRACK_H), (-0.30, sy, TRACK_H / 2), "rubber")
        # The fender is `plate`, not `hull`: a lighter band along the top of a dark
        # track is what stops the running gear reading as one black slab.
        kit.box(f"fender_{side}", (4.60, 1.12, 0.26), (-0.30, sy, TRACK_H + 0.13), "plate")
        # Sprocket and idler stand a little proud of the track box so their curve
        # breaks the rectangle at the ends. Flush they did nothing and the running
        # gear stayed one black slab; at 0.66 they read as oil drums bolted on.
        # 0.56 against the box's 0.625 half-height is the band that works.
        kit.wheel(f"sprocket_{side}", 0.56, 0.92, (2.28, sy, 0.58), "metal", 12)
        kit.wheel(f"idler_{side}", 0.52, 0.92, (-2.80, sy, 0.54), "metal", 12)
        # A pale skid under the belly line, catching the sun between the tracks.
        kit.box(f"roller_{side}", (3.60, 1.00, 0.22), (-0.30, sy, 0.20), "metal")

    # ---- body ---------------------------------------------------------------
    # Lower frame between the tracks, then the deck. Both sloped: kit.hull_box's
    # 12 deg is what puts a third tone between flank and roof under a 55 deg sun.
    # Two masses, not three. The first build stacked frame -> deck -> bonnet ->
    # cab, every one of them tapered, and the result read as a wedding cake: four
    # shrinking tiers with no dominant form. The deck is now the single body mass
    # with only a token slope, and the bonnet is a low run flush into its front
    # rather than a tier sitting on top of it.
    kit.hull_box("frame", 4.70, 2.45, 0.80, (-0.35, 0.0, 0.52), slope_deg=4.0)
    kit.hull_box("deck", 4.60, 3.00, 1.20, (-0.30, 0.0, DECK_Z), slope_deg=4.0, nose_deg=6.0)
    kit.box("bonnet", (1.70, 2.50, 0.42), (1.65, 0.0, DECK_Z + 0.98), "plate")

    # ---- armoured cab, set back and tall ------------------------------------
    # Slope and rake both pulled back: at 7/20 the cab was a pyramid, and a
    # pyramid on a tapered deck is the wedding cake again.
    kit.hull_box("cab", 2.05, 2.35, CAB_H, (-1.20, 0.0, CAB_Z), slope_deg=3.0, nose_deg=9.0)
    kit.box("cab_roof", (2.25, 2.52, 0.14), (-1.18, 0.0, CAB_Z + CAB_H + 0.14), "plate")
    # Slit glazing, inset into the raked front face so it reads as a recess.
    kit.box("cab_visor", (0.18, 1.95, 0.52), (-0.32, 0.0, CAB_Z + CAB_H * 0.72), "glass")
    kit.box("cab_sill", (0.30, 2.34, 0.12), (-0.28, 0.0, CAB_Z + CAB_H * 0.50), "recess")

    # ---- moldboard ----------------------------------------------------------
    # Profile in x-z: cutting edge forward and low, curving up and back. The lean
    # lives in the vertices, never in a rotation.
    # Half-width 2.30 against a 2.02 track half-span: the blade **overhangs the
    # tracks**. That overhang is the dozer read. The first build made it 2.05,
    # flush with the running gear, and it looked like a fence panel parked
    # alongside the machine rather than part of it.
    # Height went 1.95 -> 1.62 to stop it reading as a fence panel, which
    # overcorrected: from three-quarter facings the machine hid its own defining
    # feature behind the deck. 1.88 and pushed forward clears the hull at every
    # facing while staying visibly a blade rather than a wall.
    plate("moldboard", [
        (3.68, 0.02), (3.96, 0.28),                    # cutting edge, forward and low
        (3.56, BLADE_TOP * 0.45), (3.40, BLADE_TOP),   # concave face up and back
        (3.08, BLADE_TOP), (3.24, BLADE_TOP * 0.44), (3.40, 0.10),
    ], 2.30, "metal")
    # Arms thick enough to read at 131 px, and they run from inside the track
    # line out to the blade so the gap between the two is legible.
    for side, sy in (("l", -TRACK_Y), ("r", TRACK_Y)):
        kit.box(f"pusharm_{side}", (3.20, 0.38, 0.38), (1.85, sy, 0.86), "metal")
    kit.box("blade_link", (1.90, 0.30, 0.26), (2.25, 0.0, 2.10), "metal")

    # ---- exhaust stack: the vertical no tank in the set has -----------------
    pipe("stack", 0.17, 1.62, (0.62, -0.92, CAB_Z), "metal", 10)
    pipe("stack_cap", 0.23, 0.13, (0.62, -0.92, CAB_Z + 1.58), "metal", 10)
    pipe("precleaner", 0.15, 0.55, (0.62, 0.92, CAB_Z), "metal", 8)

    # ---- ripper -------------------------------------------------------------
    kit.box("ripper_beam", (1.35, 1.90, 0.34), (-3.05, 0.0, 1.34), "metal")
    plate("ripper_tine", [
        (-3.42, 1.42), (-3.20, 1.42), (-3.62, 0.06), (-3.86, 0.14),
    ], 0.17, "metal")

    # ---- wreck: a separate group the renderer swaps in ----------------------
    # render_clip hides one group while drawing the other, split on this prefix.
    # A dead D9 is not a scorched D9: the blade drops flat, the cab folds toward
    # the tracks, and the stack goes over. Sitting lower than the live model is
    # most of what reads at 131 px.
    kit.box("WRECK_hull", (4.40, 2.90, 1.05), (-0.40, 0.0, 0.90), "hull")
    for side, sy in (("l", -TRACK_Y), ("r", TRACK_Y)):
        kit.box(f"WRECK_track_{side}", (5.20, 0.95, 0.95), (-0.30, sy, 0.47), "rubber")
    kit.box("WRECK_cab", (1.85, 2.10, 0.85), (-1.30, 0.10, 1.85), "hull")
    plate("WRECK_blade", [
        (3.30, 0.02), (3.90, 0.10), (3.86, 0.46), (3.26, 0.38),
    ], 2.30, "metal")
    kit.box("WRECK_stack", (1.30, 0.34, 0.32), (0.90, -1.05, 1.55), "metal")
    kit.box("WRECK_ripper", (1.30, 0.42, 0.34), (-3.05, 0.0, 0.60), "metal")

    kit.save(OUT)


if __name__ == "__main__":
    build()
