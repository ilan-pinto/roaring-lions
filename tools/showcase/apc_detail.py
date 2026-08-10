"""Base geometry for the 8x8 APC hero asset.

    BUILDS THE STARTING POINT, NOT THE SHIPPED ASSET.

art/showcase/apc_detail.blend is the source of truth. This script produces about
460 parts and 9k triangles; the .blend carries roughly 1,800 parts and 150k,
because everything after the base was refined interactively -- bevels throughout,
hull faceting, two widening passes, machine guns, the standoff cage, reactive
bricks, truck wheels, the triangular prow, larger wheels, and the animation rig.

Edit the .blend. See art/showcase/README.md for why this deliberately differs
from art/src/buildings/ and art/src/drones/, where the script IS the source.

--- original design notes follow ---

A detailed 8x8 APC, authored to the reference truck's level of decomposition.

Measured target, from inspecting LPMAC_military_truck.blend read-only:

    620,126 triangles   22 named mesh subassemblies   15 procedural materials
    chassis, suspension, shafts, transfercases, wheel, mudgrds, runninboards,
    steps, drvercab, cargo pod, flatbed, load slots, armour slabs, engine
    housing, engine component box, exhuast, antena, turret, turret mantlet,
    gun, rotating sensor

That list is the actual spec. Its realism is mechanical decomposition -- a
separate chassis, live suspension, drive shafts and transfer cases under the
body -- not shading tricks: the file carries zero image textures, all 15
materials are procedural.

Nothing here derives from that file. A derivative would inherit its unverified
licence, and the whole point of replacing it is that CONTRIBUTING.md forbids
shipping an asset without demonstrable redistribution rights. The breakdown is
information; the geometry is new.

Triangle budget is deliberately under the reference. 192k triangles for drive
shafts is a 64-segment tube where 20 reads identically, so this targets the same
apparent detail at a fraction of the count, and reports what it actually built.
"""
import math

import bpy

# --- dimensions, metres ----------------------------------------------------
HULL_L, HULL_W = 8.4, 2.90
TUB_H = 1.05                      # lower armoured tub
UPPER_H = 0.95                    # troop compartment above it
GLACIS = 34.0                     # nose rake, degrees
WHEEL_R, TYRE_W = 0.62, 0.40
AXLES = (-3.02, -1.52, 1.38, 2.96)
TRACK = 1.28                      # wheel centre from centreline
# The hull floor has to clear the top of the tyres. At the first pass the floor
# sat at 0.76 while the tyres topped out at 1.24, so every wheel drove through
# the crew compartment. Raised so the overlap is the 10 cm the mudguards cover.
CHASSIS_Z = 0.80
SEG = 20                          # default round-part segments


def _mesh(name, verts, faces, role):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = role
    bpy.context.collection.objects.link(ob)
    return ob


def box(name, size, at, role="hull"):
    sx, sy, sz = (s / 2.0 for s in size)
    cx, cy, cz = at
    v = [(cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
         (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
         (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
         (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz)]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return _mesh(name, v, f, role)


def tube(name, r, length, at, axis="x", role="metal", segments=SEG, r2=None):
    """A capped cylinder along `axis`. `at` is the centre."""
    r2 = r if r2 is None else r2
    cx, cy, cz = at
    half = length / 2.0
    v, f = [], []
    for end, (rad, off) in enumerate(((r, -half), (r2, half))):
        for i in range(segments):
            a = 2.0 * math.pi * i / segments
            c, s = rad * math.cos(a), rad * math.sin(a)
            if axis == "x":
                v.append((cx + off, cy + c, cz + s))
            elif axis == "y":
                v.append((cx + c, cy + off, cz + s))
            else:
                v.append((cx + c, cy + s, cz + off))
    for i in range(segments):
        j = (i + 1) % segments
        f.append((i, j, segments + j, segments + i))
    f.append(tuple(range(segments - 1, -1, -1)))
    f.append(tuple(range(segments, 2 * segments)))
    return _mesh(name, v, f, role)


def bolts(prefix, count, start, end, r=0.028, h=0.022, role="metal", axis="y"):
    """A row of hex bolt heads between two points. Rivet rows are most of what
    reads as 'engineered' on a flat plate, and they cost 8 triangles each."""
    out = []
    for i in range(count):
        t = i / max(1, count - 1)
        p = tuple(s + (e - s) * t for s, e in zip(start, end))
        out.append(tube(f"{prefix}_{i}", r, h, p, axis=axis, role=role, segments=6))
    return out


# --------------------------------------------------------------- chassis ---
def build_chassis():
    """Two ladder rails with crossmembers, visible under the tub."""
    parts = []
    for sy, tag in ((-1, "l"), (1, "r")):
        y = sy * 0.72
        parts.append(box(f"chassis_rail_{tag}", (HULL_L * 0.94, 0.14, 0.26),
                         (0.0, y, CHASSIS_Z), role="plate"))
        # web stiffeners along the rail
        for i in range(9):
            x = -HULL_L * 0.42 + i * (HULL_L * 0.84 / 8.0)
            parts.append(box(f"chassis_web_{tag}{i}", (0.05, 0.20, 0.18),
                             (x, y, CHASSIS_Z), role="plate"))
    for i, x in enumerate((-2.9, -1.4, 0.2, 1.7, 3.0)):
        parts.append(box(f"chassis_cross_{i}", (0.16, 1.60, 0.16),
                         (x, 0.0, CHASSIS_Z), role="plate"))
    return parts


def build_driveline():
    """Propshaft runs, transfer cases and differentials.

    The reference spends a third of its triangles here, under the hull where it
    is only ever half-seen. It still matters: a hull floating above wheels with
    nothing between them is the single clearest tell of a toy model.
    """
    parts = [tube("driveline_shaft_main", 0.075, HULL_L * 0.80, (0.1, 0.0, CHASSIS_Z - 0.12),
                  axis="x", role="metal", segments=14)]
    for i, x in enumerate(AXLES):
        parts.append(tube(f"driveline_diff_{i}", 0.20, 0.34, (x, 0.0, CHASSIS_Z - 0.16),
                          axis="x", role="metal", segments=14))
        parts.append(box(f"driveline_case_{i}", (0.30, 0.42, 0.30),
                         (x, 0.0, CHASSIS_Z - 0.16), role="metal"))
        for sy, tag in ((-1, "l"), (1, "r")):
            parts.append(tube(f"driveline_half_{i}{tag}", 0.055, TRACK - 0.22,
                              (x, sy * (TRACK / 2.0 + 0.05), CHASSIS_Z - 0.16),
                              axis="y", role="metal", segments=10))
    return parts


def build_suspension():
    """Trailing arm, coil and damper per wheel station -- eight of each."""
    parts = []
    for i, x in enumerate(AXLES):
        for sy, tag in ((-1, "l"), (1, "r")):
            y = sy * (TRACK - 0.30)
            parts.append(box(f"susp_arm_{i}{tag}", (0.62, 0.11, 0.13),
                             (x - 0.28, y, CHASSIS_Z - 0.22), role="metal"))
            parts.append(tube(f"susp_coil_{i}{tag}", 0.135, 0.46,
                              (x, y, CHASSIS_Z - 0.02), axis="z",
                              role="metal", segments=12))
            parts.append(tube(f"susp_damper_{i}{tag}", 0.055, 0.54,
                              (x + 0.19, y, CHASSIS_Z + 0.02), axis="z",
                              role="metal", segments=10))
            parts.append(box(f"susp_hubcarrier_{i}{tag}", (0.24, 0.16, 0.30),
                             (x, sy * TRACK, WHEEL_R), role="metal"))
    return parts


def build_wheel(name_prefix, at):
    """Tyre with real tread blocks, dished rim, hub and eight studs."""
    parts = []
    cx, cy, cz = at
    # tyre carcass: two shoulder rings plus a tread band carrying blocks
    parts.append(tube(f"{name_prefix}_carcass", WHEEL_R * 0.94, TYRE_W * 0.98,
                      at, axis="y", role="rubber", segments=SEG))
    # tread blocks around the circumference, alternating inboard/outboard
    n = 18
    for i in range(n):
        a = 2.0 * math.pi * i / n
        r = WHEEL_R * 0.97
        off = (TYRE_W * 0.22) * (1 if i % 2 == 0 else -1)
        parts.append(box(f"{name_prefix}_lug_{i}", (0.15, TYRE_W * 0.44, 0.09),
                         (cx + r * math.cos(a), cy + off, cz + r * math.sin(a)),
                         role="rubber"))
    # rim, dished, with a hub and studs
    parts.append(tube(f"{name_prefix}_rim", WHEEL_R * 0.60, TYRE_W * 0.72,
                      at, axis="y", role="metal", segments=SEG))
    parts.append(tube(f"{name_prefix}_hub", 0.13, TYRE_W * 0.92, at,
                      axis="y", role="metal", segments=12))
    for i in range(8):
        a = 2.0 * math.pi * i / 8
        parts.append(tube(f"{name_prefix}_stud_{i}", 0.026, TYRE_W * 1.02,
                          (cx + 0.24 * math.cos(a), cy, cz + 0.24 * math.sin(a)),
                          axis="y", role="metal", segments=6))
    return parts


def build_wheels():
    out = []
    for i, x in enumerate(AXLES):
        for sy, tag in ((-1, "l"), (1, "r")):
            out += build_wheel(f"wheel_{i}{tag}", (x, sy * TRACK, WHEEL_R))
    return out


# ------------------------------------------------------------------ body ---
def build_hull():
    """Lower tub with a raked glacis, troop compartment above, roof detail."""
    parts = []
    z0 = CHASSIS_Z + 0.34
    hl, hw = HULL_L / 2.0, HULL_W / 2.0
    inset = 0.16
    rake = math.tan(math.radians(GLACIS)) * TUB_H

    # Glacis: the FLOOR reaches furthest forward and the roof is pulled back, so
    # the nose slopes up and away from the driver. The first version had these
    # swapped, which built a forward overhang -- it rendered as a plough blade
    # hanging off the front rather than as sloped armour.
    v = [(-hl, -hw, z0), (hl, -hw, z0), (hl, hw, z0), (-hl, hw, z0),
         (-hl + 0.08, -hw + inset, z0 + TUB_H), (hl - rake, -hw + inset, z0 + TUB_H),
         (hl - rake, hw - inset, z0 + TUB_H), (-hl + 0.08, hw - inset, z0 + TUB_H)]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    parts.append(_mesh("hull_tub", v, f, "hull"))

    zt = z0 + TUB_H
    ul, uw = HULL_L * 0.40, HULL_W * 0.44
    v2 = [(-ul - 0.9, -uw, zt), (ul - 0.9, -uw, zt), (ul - 0.9, uw, zt), (-ul - 0.9, uw, zt),
          (-ul - 0.9 + 0.10, -uw + 0.10, zt + UPPER_H), (ul - 0.9 - 0.16, -uw + 0.10, zt + UPPER_H),
          (ul - 0.9 - 0.16, uw - 0.10, zt + UPPER_H), (-ul - 0.9 + 0.10, uw - 0.10, zt + UPPER_H)]
    parts.append(_mesh("hull_upper", v2, f, "hull"))

    # roof: hatches, grab rails, vision blocks
    zr = zt + UPPER_H
    for i, x in enumerate((-2.5, -1.5)):
        parts.append(tube(f"hull_hatch_{i}", 0.30, 0.09, (x, 0.42, zr),
                          axis="z", role="plate", segments=16))
        parts.append(tube(f"hull_hatch_ring_{i}", 0.34, 0.05, (x, 0.42, zr),
                          axis="z", role="metal", segments=16))
    for sy, tag in ((-1, "l"), (1, "r")):
        parts.append(tube(f"hull_rail_{tag}", 0.022, 2.0,
                          (-1.7, sy * (uw - 0.16), zr + 0.06), axis="x",
                          role="metal", segments=8))
    for i in range(3):
        parts.append(box(f"hull_vision_{i}", (0.07, 0.30, 0.16),
                         (ul - 0.9 - 0.20, -0.5 + i * 0.5, zr - 0.28), role="glass"))
    return parts


def build_appliqué():
    """Bolt-on armour panels with visible fastener rows, plus slat sides."""
    parts = []
    z0 = CHASSIS_Z + 0.34
    for sy, tag in ((-1, "l"), (1, "r")):
        y = sy * (HULL_W / 2.0 + 0.03)
        for i, x in enumerate((-2.9, -1.65, -0.4, 0.85, 2.1)):
            parts.append(box(f"armour_{tag}{i}", (1.15, 0.06, 0.62),
                             (x, y, z0 + 0.52), role="plate"))
            parts += bolts(f"armour_bolt_{tag}{i}", 5,
                           (x - 0.48, y + sy * 0.04, z0 + 0.30),
                           (x + 0.48, y + sy * 0.04, z0 + 0.30), axis="y")
        # slat armour over the rear flank
        for i in range(11):
            parts.append(box(f"slat_{tag}{i}", (0.05, 0.16, 0.70),
                             (-3.4 + i * 0.20, y + sy * 0.16, z0 + 0.55), role="metal"))
    return parts


def build_running_gear():
    """Mudguards, running boards, steps -- the parts that make a hull look like
    it is meant to be climbed on."""
    parts = []
    z0 = CHASSIS_Z + 0.34
    for sy, tag in ((-1, "l"), (1, "r")):
        y = sy * (TRACK + 0.06)
        parts.append(box(f"runningboard_{tag}", (HULL_L * 0.62, 0.34, 0.05),
                         (-0.2, y, z0 - 0.10), role="plate"))
        for i, x in enumerate(AXLES):
            parts.append(box(f"mudguard_{tag}{i}", (WHEEL_R * 1.9, 0.42, 0.06),
                             (x, y, WHEEL_R + 0.50), role="plate"))
            parts.append(box(f"mudflap_{tag}{i}", (0.06, 0.40, 0.26),
                             (x + WHEEL_R * 0.95, y, WHEEL_R + 0.34), role="rubber"))
        for i in range(2):
            parts.append(box(f"step_{tag}{i}", (0.34, 0.26, 0.04),
                             (-HULL_L * 0.42 + i * 0.0, y, z0 - 0.34 - i * 0.26),
                             role="metal"))
    return parts


def build_powerpack():
    """Engine deck louvres, exhaust stack with heat shield."""
    parts = []
    z0 = CHASSIS_Z + 0.34
    for i in range(7):
        parts.append(box(f"louvre_{i}", (0.09, 1.10, 0.07),
                         (2.35 + i * 0.13, 0.0, z0 + TUB_H + 0.02), role="metal"))
    parts.append(tube("exhaust_stack", 0.085, 1.15, (1.9, -1.30, z0 + TUB_H + 0.55),
                      axis="z", role="metal", segments=12))
    parts.append(tube("exhaust_shield", 0.135, 0.85, (1.9, -1.30, z0 + TUB_H + 0.50),
                      axis="z", role="metal", segments=12))
    parts.append(tube("exhaust_tip", 0.10, 0.16, (1.9, -1.30, z0 + TUB_H + 1.16),
                      axis="z", role="metal", segments=12))
    return parts


def build_turret():
    """Remote weapon station: faceted mount, mantlet, barrel, sensor pod."""
    parts = []
    zr = CHASSIS_Z + 0.14 + TUB_H + UPPER_H
    base = zr + 0.06
    parts.append(tube("turret_ring", 0.46, 0.10, (-1.15, 0.0, base),
                      axis="z", role="metal", segments=16))
    parts.append(tube("turret_body", 0.42, 0.40, (-1.15, 0.0, base + 0.24),
                      axis="z", role="plate", segments=8, r2=0.31))
    parts.append(box("turret_mantlet", (0.26, 0.34, 0.26), (-0.92, 0.0, base + 0.30),
                     role="plate"))
    parts.append(tube("turret_gun", 0.048, 1.30, (-0.28, 0.0, base + 0.30),
                      axis="x", role="metal", segments=12))
    parts.append(tube("turret_gun_jacket", 0.068, 0.34, (-0.62, 0.0, base + 0.30),
                      axis="x", role="metal", segments=12))
    parts.append(box("turret_ammo", (0.30, 0.14, 0.22), (-1.36, 0.22, base + 0.28),
                     role="metal"))
    parts.append(tube("turret_sensor", 0.11, 0.20, (-1.15, -0.30, base + 0.52),
                      axis="z", role="metal", segments=12))
    parts.append(box("turret_sensor_face", (0.05, 0.16, 0.14), (-1.05, -0.30, base + 0.52),
                     role="glass"))
    return parts


def build_fittings():
    """Antennae, lights, stowage, tow points."""
    parts = []
    z0 = CHASSIS_Z + 0.34
    zr = z0 + TUB_H + UPPER_H
    for i, y in ((0, -0.9), (1, 0.9)):
        parts.append(tube(f"antenna_{i}", 0.014, 1.55, (-2.9, y, zr + 0.78),
                          axis="z", role="metal", segments=6))
        parts.append(tube(f"antenna_base_{i}", 0.045, 0.12, (-2.9, y, zr + 0.06),
                          axis="z", role="metal", segments=8))
    for sy, tag in ((-1, "l"), (1, "r")):
        parts.append(tube(f"headlight_{tag}", 0.115, 0.10,
                          (HULL_L / 2.0 - 0.28, sy * 1.02, z0 + 0.34),
                          axis="x", role="glass", segments=14))
        parts.append(tube(f"headlight_guard_{tag}", 0.155, 0.16,
                          (HULL_L / 2.0 - 0.30, sy * 1.02, z0 + 0.34),
                          axis="x", role="metal", segments=14))
        parts.append(box(f"towpoint_{tag}", (0.22, 0.10, 0.16),
                         (HULL_L / 2.0 - 0.12, sy * 0.55, z0 + 0.06), role="metal"))
    parts.append(box("stowage_basket", (1.20, 1.90, 0.42), (-3.3, 0.0, zr - 0.24),
                     role="metal"))
    for i in range(6):
        parts.append(tube(f"basket_bar_{i}", 0.020, 1.90, (-3.9 + i * 0.24, 0.0, zr - 0.03),
                          axis="y", role="metal", segments=6))
    return parts


def build_all():
    """Every subassembly, returned grouped so the caller can join or keep split."""
    groups = {
        "chassis": build_chassis(),
        "driveline": build_driveline(),
        "suspension": build_suspension(),
        "wheels": build_wheels(),
        "hull": build_hull(),
        "armour": build_appliqué(),
        "running_gear": build_running_gear(),
        "powerpack": build_powerpack(),
        "turret": build_turret(),
        "fittings": build_fittings(),
    }
    tris = 0
    for name, parts in groups.items():
        g = sum(max(1, len(p.vertices) - 2) for ob in parts for p in ob.data.polygons)
        tris += g
        print(f"  {name:14} {len(parts):4} parts  {g:8} tris")
    print(f"  {'TOTAL':14} {sum(len(p) for p in groups.values()):4} parts  {tris:8} tris")
    return groups
