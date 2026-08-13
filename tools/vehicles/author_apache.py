"""Build the KDF AH-64 Peten: a tandem-seat assault helicopter.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/author_apache.py

Writes art/src/aircraft/apache.blend.

BUILDS THE STARTING POINT, like author_technical.py and author_d9.py. Refinement
afterwards lives in the .blend, which is then the authority.

`kit.py` is a ground-vehicle kit -- hull_box, wheel, wheels_in_pairs, rws, barrel.
An airframe needs a tapering boom and a rotor, and neither is a vehicle part, so
those two helpers live here rather than being pushed into the shared kit. The roles
carry over unchanged: `hull` is the painted airframe, `glass` the canopy, `metal`
the rotor, mast and gun, `plate` panels and exhausts, `rubber` the wheels.

Three numbers come from the design spec (docs/superpowers/specs/2026-08-13-apache-
and-d9-design.md), and the massing preview that fixed them:

* **Rotor span 9.6 m, four discrete blades** -- not a solid disc at the true 14.6 m.
  At sprite size the true disc is a grey pancake that swallows the entire airframe.
  Four blades also give the sheet something to animate: a 4-blade rotor has 90 deg
  rotational symmetry, so `idle`'s four phases at 22.5 deg each cover exactly one
  visual cycle and loop seamlessly.
* **Overall length ~11.5 m, against 15 m true.** At full length the tailboom drives
  the sprite frame and the frame comes out mostly empty, which is a MIN_FILL >= 6%
  risk. 77% foreshortening is ordinary RTS convention.
* **Nose along +X**, so the rig's `facingOffset` is 12 -- matching every other
  vehicle in the repository.

The airframe carries no turret sheet. The chin gun is about three pixels at
gameplay size, so it is modelled fixed to the nose and `turret_meshes` stays empty.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

OUT = os.path.abspath("art/src/aircraft/apache.blend")

BELLY = 1.28            # underside of the forward fuselage; the gear sets this
ROTOR_SPAN = 9.60
ROTOR_Z = 3.46


def taper(name, x0, x1, w0, w1, h0, h1, z0, z1, role="hull"):
    """A box that tapers in width, height and centreline between two stations.

    The tailboom is the reason this exists: a constant-section boom reads as a
    plank, and kit.hull_box only leans its flanks outward toward a flat roof.
    """
    def ring(x, w, h, z):
        hw, hh = w / 2.0, h / 2.0
        return [(x, -hw, z - hh), (x, hw, z - hh), (x, hw, z + hh), (x, -hw, z + hh)]
    a, b = ring(x0, w0, h0, z0), ring(x1, w1, h1, z1)
    v = a + b
    f = [(0, 1, 2, 3), (7, 6, 5, 4)]
    for i in range(4):
        j = (i + 1) % 4
        f.append((i, j, j + 4, i + 4))
    return kit._mesh(name, v, f, role)


def tube(name, radius, length, at, axis="x", role="metal", segments=10):
    """A cylinder along x, y or z. kit.wheel is y-only and kit.barrel is x-only;
    the mast stands up and the tail-rotor hub lies across."""
    cx, cy, cz = at
    ring = [(radius * math.cos(2 * math.pi * i / segments),
             radius * math.sin(2 * math.pi * i / segments)) for i in range(segments)]
    h = length / 2.0
    if axis == "x":
        v = [(cx - h, cy + a, cz + b) for a, b in ring] + [(cx + h, cy + a, cz + b) for a, b in ring]
    elif axis == "y":
        v = [(cx + a, cy - h, cz + b) for a, b in ring] + [(cx + a, cy + h, cz + b) for a, b in ring]
    else:
        v = [(cx + a, cy + b, cz - h) for a, b in ring] + [(cx + a, cy + b, cz + h) for a, b in ring]
    f = [tuple(range(segments)), tuple(range(2 * segments - 1, segments - 1, -1))]
    for i in range(segments):
        j = (i + 1) % segments
        f.append((i, j, j + segments, i + segments))
    return kit._mesh(name, v, f, role)


def rotor(prefix, span, chord, thickness, at, blades=4, role="metal"):
    """`blades` aerofoils as full-diameter bars, so an even count is `blades//2`
    bars crossed at equal angles. Vertices carry the angle -- never an unapplied
    object rotation, which render_vehicle would size the frame from wrongly."""
    cx, cy, cz = at
    made = []
    for k in range(blades // 2):
        a = math.pi * k / (blades // 2)
        ca, sa = math.cos(a), math.sin(a)
        hl, hw, hh = span / 2.0, chord / 2.0, thickness / 2.0
        corners = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
        rot = [(cx + u * ca - w * sa, cy + u * sa + w * ca) for u, w in corners]
        v = [(x, y, cz - hh) for x, y in rot] + [(x, y, cz + hh) for x, y in rot]
        f = [(0, 1, 2, 3), (7, 6, 5, 4)]
        for i in range(4):
            j = (i + 1) % 4
            f.append((i, j, j + 4, i + 4))
        made.append(kit._mesh(f"{prefix}_{k}", v, f, role))
    return made


def build():
    kit.new_scene()

    # ---- fuselage: three overlapping masses reading as one body -------------
    kit.hull_box("fuse", 5.20, 1.34, 1.50, (-0.50, 0.0, BELLY + 0.10), slope_deg=9.0)
    kit.hull_box("fwd", 2.60, 1.18, 1.32, (2.30, 0.0, BELLY - 0.02), slope_deg=11.0, nose_deg=7.0)
    taper("nose", 3.45, 4.60, 1.10, 0.72, 0.95, 0.62, BELLY + 0.42, BELLY + 0.30, "plate")
    tube("tads", 0.30, 0.44, (4.62, 0.0, BELLY + 0.16), "y", "glass", 12)

    # ---- tandem canopy: gunner low and forward, pilot stepped up behind -----
    kit.hull_box("canopy_f", 1.30, 1.04, 0.56, (2.62, 0.0, BELLY + 1.28), slope_deg=16.0, role="glass")
    kit.hull_box("canopy_a", 1.34, 1.10, 0.66, (1.32, 0.0, BELLY + 1.46), slope_deg=14.0, role="glass")
    kit.box("spine", (2.10, 0.90, 0.34), (-0.20, 0.0, BELLY + 1.72), "plate")

    # ---- engine nacelles, low on the deck so they widen the body ------------
    for side, sy in (("l", -0.86), ("r", 0.86)):
        # taper() builds on the centreline, so the pair is offset in vertex data
        # rather than by an object transform the render rig would not see.
        ob = taper(f"nacelle_{side}", -1.90, 0.60, 0.62, 0.78, 0.72, 0.80,
                   BELLY + 1.18, BELLY + 1.10, "plate")
        for v in ob.data.vertices:
            v.co.y += sy
        ob.data.update()
    tube("exhaust_l", 0.22, 0.70, (-2.05, -0.86, BELLY + 1.16), "x", "metal", 8)
    tube("exhaust_r", 0.22, 0.70, (-2.05, 0.86, BELLY + 1.16), "x", "metal", 8)

    # ---- stub wings pass THROUGH the fuselage -------------------------------
    kit.box("wing", (1.28, 5.20, 0.26), (-0.35, 0.0, BELLY + 0.62), "hull")
    for side, sy in (("ol", -2.34), ("il", -1.42), ("ir", 1.42), ("or", 2.34)):
        kit.box(f"pylon_{side}", (0.92, 0.38, 0.42), (-0.35, sy, BELLY + 0.28), "plate")
    # Hellfire quad racks outboard, rocket pods inboard.
    for sy in (-2.34, 2.34):
        for dz in (0.0, -0.32):
            for dy in (-0.17, 0.17):
                tube(f"hf{sy:+.2f}{dz:+.2f}{dy:+.2f}", 0.085, 1.28,
                     (-0.35, sy + dy, BELLY - 0.06 + dz), "x", "plate", 8)
    for sy in (-1.42, 1.42):
        tube(f"pod{sy:+.2f}", 0.30, 1.42, (-0.35, sy, BELLY - 0.04), "x", "plate", 12)

    # ---- tailboom, fin, stabilator ------------------------------------------
    taper("boom", -5.95, -2.20, 0.38, 0.60, 0.44, 0.68, BELLY + 0.90, BELLY + 0.82, "hull")
    taper("fin", -6.90, -5.70, 0.26, 0.30, 1.90, 1.30, BELLY + 1.60, BELLY + 1.10, "hull")
    kit.box("stabilator", (0.78, 3.10, 0.16), (-6.05, 0.0, BELLY + 0.78), "hull")
    # Tail rotor: a 2.0 m cross in the x-normal plane, never a solid disc.
    kit.box("trotor_h", (0.07, 2.00, 0.17), (-6.62, 0.26, BELLY + 1.68), "metal")
    kit.box("trotor_v", (0.07, 0.17, 2.00), (-6.62, 0.26, BELLY + 1.68), "metal")
    tube("trotor_hub", 0.20, 0.34, (-6.62, 0.16, BELLY + 1.68), "y", "metal", 10)

    # ---- chin gun, fixed to the nose ----------------------------------------
    tube("gun_mount", 0.27, 0.32, (3.42, 0.0, BELLY - 0.14), "z", "metal", 12)
    tube("gun_barrel", 0.075, 1.32, (4.08, 0.0, BELLY - 0.26), "x", "metal", 8)

    # ---- main rotor ----------------------------------------------------------
    tube("mast", 0.21, 0.80, (-0.35, 0.0, ROTOR_Z - 0.42), "z", "metal", 12)
    tube("hub", 0.42, 0.24, (-0.35, 0.0, ROTOR_Z), "z", "metal", 12)
    rotor("blade", ROTOR_SPAN, 0.46, 0.07, (-0.35, 0.0, ROTOR_Z), 4, "metal")

    # ---- gear ----------------------------------------------------------------
    for side, sy in (("l", -1.24), ("r", 1.24)):
        kit.wheel(f"wheel_{side}", 0.38, 0.26, (1.62, sy, 0.38), "rubber", 12)
        kit.box(f"leg_{side}", (0.20, 0.20, 0.94), (1.62, sy, 0.83), "metal")
    kit.wheel("tailwheel", 0.22, 0.18, (-5.72, 0.0, 0.22), "rubber", 10)
    kit.box("tailleg", (0.16, 0.16, 1.55), (-5.72, 0.0, 0.98), "metal")

    # ---- wreck --------------------------------------------------------------
    # Down on its belly with the rotor sheared: two stub blades at an angle
    # rather than four level ones, which is what stops the wreck reading as a
    # parked aircraft at 128 px.
    kit.hull_box("WRECK_fuse", 5.00, 1.40, 1.05, (-0.40, 0.0, 0.10), slope_deg=14.0)
    taper("WRECK_boom", -5.60, -2.10, 0.36, 0.58, 0.40, 0.62, 0.55, 0.72, "hull")
    taper("WRECK_fin", -6.40, -5.60, 0.24, 0.28, 1.10, 0.80, 1.15, 0.95, "hull")
    kit.box("WRECK_wing", (1.20, 4.60, 0.24), (-0.30, 0.0, 0.42), "hull")
    for k, ang in enumerate((0.35, 2.30)):
        ca, sa = math.cos(ang), math.sin(ang)
        hl, hw, hh = 2.60, 0.23, 0.05
        pts = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
        rot = [(-0.30 + u * ca - w * sa, u * sa + w * ca) for u, w in pts]
        v = [(x, y, 1.28 - hh) for x, y in rot] + [(x, y, 1.28 + hh) for x, y in rot]
        f = [(0, 1, 2, 3), (7, 6, 5, 4)]
        for i in range(4):
            j = (i + 1) % 4
            f.append((i, j, j + 4, i + 4))
        kit._mesh(f"WRECK_blade_{k}", v, f, "metal")
    tube("WRECK_hub", 0.40, 0.22, (-0.30, 0.0, 1.22), "z", "metal", 10)

    kit.save(OUT)


if __name__ == "__main__":
    build()
