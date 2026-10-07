"""The per-vehicle kit tables at detail -- GH-238 plan 3, Task 4.

`PARTS_DETAILED[vid](H)` returns `(track, tier, host, label, builder)`
entries in the shape of `kit_blockout.PARTS`, where `builder()` returns a
list of `kit_parts.Piece`s in WORLD space. A part that spans two hosts (the
Lavi's A3 and S3) is two entries, one per host: the contract is one node per
(track, tier, host).

THE NUMBERS ARE THE MOCK'S. Every position, size and angle below is
`kit_blockout.parts_<vid>`'s, and every MEASURED number -- the turret roof,
the hull's side, the barrel axis, the deck under a camera -- is read the same
way the blockout reads it (`Hull`, `barrel`, the same ray casts), never
retyped. `export_vehicle_kit.py` builds the blockout's own part beside each
detailed one and refuses a bounding box that moved (see `BLOCKOUT_SPLIT`,
`DEVIATIONS` and the exporter's `check_against_blockout`).

What the detail ADDS to the mock is hardware that reaches the hull where the
blockout's box floated: risers, flanges, hangers, brackets, a chain rail.
Those pieces are flagged `mount` or `ground` in `kit_parts` and the
comparison treats them as stated there.
"""
import math
import os
import sys

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import kit_parts as kp  # noqa: E402
from kit_blockout import Hull, barrel  # noqa: E402,F401 -- read-only: the measuring instrument

TRACKS = ("armour", "sensors", "firepower")

#: Spec section 3 / the plan's Budgets table: triangles per PART (track,
#: tier) at maximum detail. The exporter refuses a part over 1.10x its
#: budget and a vehicle over VEHICLE_CAP.
BUDGETS = {
    "mbt_lavi": {("armour", 1): 300, ("armour", 2): 900, ("armour", 3): 1800,
                 ("sensors", 1): 260, ("sensors", 2): 320, ("sensors", 3): 480,
                 ("firepower", 1): 260, ("firepower", 2): 300, ("firepower", 3): 260},
    "ifv_namer": {("armour", 1): 280, ("armour", 2): 980, ("armour", 3): 800,
                  ("sensors", 1): 260, ("sensors", 2): 320, ("sensors", 3): 320,
                  ("firepower", 1): 160, ("firepower", 2): 220, ("firepower", 3): 240},
    "apc_eitan": {("armour", 1): 360, ("armour", 2): 880, ("armour", 3): 1100,
                  ("sensors", 1): 250, ("sensors", 2): 320, ("sensors", 3): 360,
                  ("firepower", 1): 140, ("firepower", 2): 240, ("firepower", 3): 200},
    "apc_kipod": {("armour", 1): 560, ("armour", 2): 840, ("armour", 3): 800,
                  ("sensors", 1): 250, ("sensors", 2): 220, ("sensors", 3): 340,
                  ("firepower", 1): 140, ("firepower", 2): 240, ("firepower", 3): 200},
    "jeep_shoded": {("armour", 1): 360, ("armour", 2): 300, ("armour", 3): 560,
                    ("sensors", 1): 200, ("sensors", 2): 220, ("sensors", 3): 300,
                    ("firepower", 1): 220, ("firepower", 2): 200, ("firepower", 3): 200},
    "scout_shachaf": {("armour", 1): 280, ("armour", 2): 360, ("armour", 3): 600,
                      ("sensors", 1): 160, ("sensors", 2): 140, ("sensors", 3): 300,
                      ("firepower", 1): 120, ("firepower", 2): 200, ("firepower", 3): 180},
    "dozer_d9": {("armour", 1): 400, ("armour", 2): 700, ("armour", 3): 1300,
                 ("sensors", 1): 300, ("sensors", 2): 260, ("sensors", 3): 400},
    "heli_peten": {("armour", 1): 120, ("armour", 2): 160, ("armour", 3): 240,
                   ("sensors", 1): 200, ("sensors", 2): 240, ("sensors", 3): 220,
                   ("firepower", 1): 180, ("firepower", 2): 160, ("firepower", 3): 160},
}
VEHICLE_BUDGET = {"mbt_lavi": 4880, "ifv_namer": 3580, "apc_eitan": 3850, "apc_kipod": 3590,
                  "jeep_shoded": 2560, "scout_shachaf": 2340, "dozer_d9": 3360, "heli_peten": 1680}
VEHICLE_CAP = 5000
PART_SLACK = 1.10

#: A part that spans two hosts is compared host by host against the blockout
#: objects whose names start with these prefixes (the blockout built it as
#: one entry under one host).
BLOCKOUT_SPLIT = {
    "mbt_lavi": {
        ("armour", 3): {"hull_hull": ("a3_sl",), "turret_hull": ("a3_ch",)},
        ("sensors", 3): {"turret_metal": ("s3_ped", "s3_drum"), "hull_hull": ("s3_cam",)},
    },
}

#: Deliberate departures from the mock, per NODE and axis, each with the
#: measurement that forced it. The exporter prints every one on every run and
#: skips only that axis of that node's comparison.
DEVIATIONS = {
    "heli_peten": {
        ("armour", 1, "hull_hull"): (
            "y",
            "the mock's cockpit plates (|y| 0.235-0.265) lie 7-13 cm INSIDE the fuselage side at "
            "z 0.74 (|y| 0.33-0.35 over x 0.14-0.69) and would never be seen; seated on the real "
            "side, the part widens by 0.27 m"),
        ("armour", 2, "hull_hull"): (
            "z",
            "the mock's engine-bay panels stood 6-7 cm above the nacelles; seated 4 mm proud they "
            "sit 0.067 m lower (tolerance 0.055)"),
        ("armour", 3, "hull_hull"): (
            "z",
            "the mock's floor plate hung 8.5 cm under the belly; seated against it the part's "
            "bottom rises 0.07 m"),
        ("sensors", 3, "hull_hull"): (
            "z",
            "the mock's roof sensor fairing (z 1.08-1.18) is INSIDE the rotor disc (z 1.04-1.29, "
            "0.8 m from the hub): the spinning blades would cut through it. It sits on the engine "
            "hump instead, under the disc"),
    },
    "scout_shachaf": {
        ("armour", 1, "hull_hull"): (
            "z",
            "the mock's nose plate (20 degrees, centre z 1.78) stood 8-9 cm clear of the nose it "
            "armours; seated 4 mm proud along its own normal it sits lower, and the part's top -- "
            "that plate's top edge -- drops 0.085 m"),
    },
    "mbt_lavi": {
        ("sensors", 3, "hull_hull"): (
            "z",
            "the mock's four corner cameras sit on single ray hits at the glacis crest (x 1.85: the "
            "deck falls 1.32 -> 1.16 across the 0.16 m housing) and the rear-plate crest (x -2.95: "
            "0.90 -> 1.34), so each housing was buried up to 0.21 m on one side and floating up to "
            "0.22 m on the other; each now sits on the nearest deck spot inboard that is flat "
            "to 3 cm (_flat_spot): x/y stay inside the mock's tolerance, the set's z-centre rises 0.14 m"),
        ("armour", 3, "turret_hull"): (
            "z",
            "the mock hangs the chains from z 1.642, which is INSIDE the engine deck on the centre "
            "line (deck 1.70 at x -2.15) and puts the balls 4-20 cm into it at |y| 0.3-0.9 (deck "
            "1.71 -> 1.34); this turret has no bustle overhang to hang them from (its underside "
            "meets the deck). Hung instead from a rail bracketed to the turret's rear face at z 1.96, "
            "each chain as long as the deck under it allows (<= the mock's 0.30): the curtain keeps "
            "the mock's depth (0.371 vs 0.355 m) and its x/y, and sits 0.33 m higher"),
    },
}


# ---------------------------------------------------------------------------
# hull reads (the blockout's Hull, plus two trees it does not keep)
# ---------------------------------------------------------------------------

def _tree(H, names):
    key = "_tree_" + "_".join(names)
    if not hasattr(H, key):
        bm = bmesh.new()
        for n in names:
            o = H.objs[n]
            me = o.data.copy()
            me.transform(o.matrix_world)
            bm.from_mesh(me)
            import bpy
            bpy.data.meshes.remove(me)
        setattr(H, key, BVHTree.FromBMesh(bm))
        bm.free()
    return getattr(H, key)


def _tops(tree, pts):
    out = []
    for x, y in pts:
        hit = tree.ray_cast(Vector((x, y, 20.0)), Vector((0.0, 0.0, -1.0)))
        if hit[0] is not None:
            out.append(hit[0].z)
    return out


def _disc(x, y, r, n=8):
    return [(x, y)] + [(x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n))
                       for k in range(n)]


def _seat(tree, x, y, r):
    """(lowest, highest) surface z under a disc of radius r."""
    zs = _tops(tree, _disc(x, y, r))
    return min(zs), max(zs)


def _seat_below(tree, x, y, r, z_from):
    """(lowest, highest) of the FIRST surface under z_from, over a disc: what a
    chain hanging from z_from would land on (a whip antenna leaning over the
    chain line, above it, is not the deck)."""
    zs = []
    for px, py in _disc(x, y, r):
        hit = tree.ray_cast(Vector((px, py, z_from)), Vector((0.0, 0.0, -1.0)))
        if hit[0] is not None:
            zs.append(hit[0].z)
    return min(zs), max(zs)


def _surface(tree, x, y, r=0.05):
    """The hit point under (x, y) and the mean surface normal of a small
    disc around it (ray-cast face normals, averaged) -- for seating a part
    on a slope."""
    pt, ns = None, Vector()
    for i, (px, py) in enumerate(_disc(x, y, r)):
        hit = tree.ray_cast(Vector((px, py, 20.0)), Vector((0.0, 0.0, -1.0)))
        if hit[0] is None:
            continue
        if i == 0:
            pt = hit[0]
        ns += hit[1] if hit[1].z > 0 else -hit[1]
    return pt, ns.normalized()


def _flat_spot(tree, x, y, half, step=0.02, flat=0.03, reach=(0.5, 0.3)):
    """The nearest point inboard of (x, y) -- toward the hull's middle in x
    and y -- where the surface under a square of half-width `half` is flat to
    `flat`: (x, y, lo, hi). Nearest first, ties broken by the smaller x step."""
    sx, sy = -math.copysign(1.0, x), -math.copysign(1.0, y)
    cands = sorted(((i * step) ** 2 + (j * step) ** 2, i, j)
                   for i in range(int(reach[0] / step) + 1) for j in range(int(reach[1] / step) + 1))
    for _d, i, j in cands:
        xx, yy = x + sx * i * step, y + sy * j * step
        zs = _tops(tree, [(xx + dx, yy + dy) for dx in (-half, 0, half) for dy in (-half, 0, half)])
        if len(zs) == 9 and max(zs) - min(zs) < flat:
            return xx, yy, min(zs), max(zs)
    raise RuntimeError(f"no deck flat to {flat} m within {reach} m inboard of ({x}, {y})")


def _seat_shift(tree, M, size, into, proud=0.004, grid=3, reach=0.3, max_out=0.03):
    """How far to move a part in its local frame `M` (a box of `size`)
    along the local unit direction `into` (pointing INTO the hull) so that
    its hull-facing face touches the hull at the nearest point, `proud`
    clear: positive moves it in, negative out. (shift, (min gap, max gap))."""
    into = Vector(into)
    ax = max(range(3), key=lambda i: abs(into[i]))
    others = [i for i in range(3) if i != ax]
    R = M.to_3x3()
    t = (R @ into).normalized()
    gaps = []
    for a in range(grid):
        for b in range(grid):
            lp = Vector((0.0, 0.0, 0.0))
            lp[ax] = math.copysign(size[ax] / 2, into[ax])
            lp[others[0]] = size[others[0]] * (a / (grid - 1) - 0.5) * 0.9
            lp[others[1]] = size[others[1]] * (b / (grid - 1) - 0.5) * 0.9
            p = M @ lp
            hit = tree.ray_cast(p - t * reach, t)
            if hit[0] is not None:
                gaps.append(hit[3] - reach)
    if not gaps:
        return 0.0, (None, None)
    # never pushed out more than `max_out`: a ledge or a stowage box standing
    # proud of the side would otherwise throw a whole brick off the hull
    return max(min(gaps) - proud, -max_out), (min(gaps), max(gaps))


def _shifted(M, into, d):
    from mathutils import Matrix
    return Matrix.Translation((M.to_3x3() @ Vector(into)).normalized() * d) @ M


def _barrel_r(H, node, gun, x):
    """The barrel's own radius at station x (rays in from 12 directions
    round the axis `gun` reads), so a shroud closes onto it."""
    tree = _tree(H, (node,))
    rs = []
    for k in range(12):
        a = 2.0 * math.pi * k / 12
        d = Vector((0.0, math.cos(a), math.sin(a)))
        hit = tree.ray_cast(Vector((x, gun[2], gun[3])) + d * 0.5, -d)
        if hit[0] is not None:
            rs.append(0.5 - hit[3])
    return max(rs)


def _side_slope(H, x, s, z0, z1):
    """The hull side's lean between heights z0 and z1 at station x, in
    degrees from vertical (positive: leaning in toward the top)."""
    y0, y1 = H.side(x, z0, s, None), H.side(x, z1, s, None)
    return math.degrees(math.atan2(y0 - y1, z1 - z0))


def _toward(tree, origin, direction, default):
    hit = tree.ray_cast(Vector(origin), Vector(direction).normalized())
    return hit[0] if hit[0] is not None else Vector(default)


# ---------------------------------------------------------------------------
# mbt_lavi
# ---------------------------------------------------------------------------

def parts_mbt_lavi(H):
    if not isinstance(H, Hull):
        raise TypeError("parts_mbt_lavi reads the blockout's own instrument: pass a kit_blockout.Hull")
    tlo, thi = H.bounds("turret_hull")
    roof = thi.z
    gun = barrel(H, "turret_metal", 2.3)
    sy = H.side(-0.5, 0.9, 1, 1.44)
    turret = _tree(H, ("turret_hull",))
    turret_all = _tree(H, ("turret_hull", "turret_metal"))

    # -- A1: turret cheek wedge modules, 22 degrees back ------------------------
    def a1():
        out = []
        for tag, s, at in (("L", 1, (0.40, 0.70, 1.86)), ("R", -1, (0.40, -0.70, 1.86))):
            out += kp.wedge_module(f"a1_cheek{tag}", (0.95, 0.42, 0.40), kp.place(at, rz=-22 * s), s)
        return out

    # -- A2: skirt modules, 5 a side, 0.06 proud of the skirt -------------------
    def a2():
        out = []
        x0, x1, n = -2.75, 1.25, 5
        step = (x1 - x0) / n
        size = (min(0.80, step * 0.94), 0.10, 0.56)
        zc = 0.86
        for tag, s in (("L", 1), ("R", -1)):
            for i in range(n):
                xc = x0 + step * (i + 0.5)
                skin = H.side(xc, zc + size[2] / 2 + 0.01, s, sy)   # the skirt under the hangers
                out += kp.hung_module(f"a2_sk{tag}{i}", size, (xc, s * (sy + 0.11), zc), s, skin)
        return out

    # -- A3 (hull): rear slat cage returning along each side --------------------
    def a3_cage():
        out = []
        z0, z1 = 0.42, 1.42
        rear, rposts = kp.slat_panel("a3_slR", (-3.58, 1.62), (-3.58, -1.62), z0, z1)
        sideL, lposts = kp.slat_panel("a3_slSL", (-3.58, 1.62), (-2.30, 1.62), z0, z1, skip_posts=(0,))
        sideR, rposts2 = kp.slat_panel("a3_slSR", (-3.58, -1.62), (-2.30, -1.62), z0, z1, skip_posts=(0,))
        out += rear + sideL + sideR
        hull = H.hull
        # rear brackets: from the three inner posts forward to the rear plate, two heights
        for i, p in enumerate(rposts[1:-1]):
            for k, z in enumerate((0.70, 1.12)):
                hit = _toward(hull, (p.x + 0.03, p.y, z), (1, 0, 0), (p.x + 0.5, p.y, z))
                out += kp.strut(f"a3_brR{i}{k}", (p.x + 0.024, p.y, z), hit, pad=0)
        # side brackets: from each side panel's middle and front posts in to the hull side
        for tag, s, posts in (("L", 1, lposts), ("R", -1, rposts2)):
            for i, p in enumerate(posts[1:]):
                for k, z in enumerate((0.80, 1.12)):
                    hit = _toward(hull, (p.x, p.y - s * 0.03, z), (0, -s, 0), (p.x, s * 1.44, z))
                    if abs(hit.y - p.y) > 0.6:     # nothing to weld to at the rear corner
                        continue
                    out += kp.strut(f"a3_brS{tag}{i}{k}", (p.x, p.y - s * 0.024, z), hit, pad=0)
        return out

    # -- A3 (turret): ball-and-chain curtain on a rail behind the turret --------
    RAIL_Z = 1.96
    BALL_R = 0.055

    def a3_chains():
        x = tlo.x + 0.02
        y0, y1, n = 0.85, -0.85, 13
        ys = [y0 + (y1 - y0) * i / (n - 1) for i in range(n)]
        # each chain as long as the deck under its ball allows, up to the mock's
        # 0.30 (measured from under the rail: the turret's own whip antenna
        # leans back over chain 9, 0.35 m ABOVE the rail)
        drops = [min(0.30, RAIL_Z - _seat_below(H.all, x, y, BALL_R, RAIL_Z - 0.03)[1] - BALL_R - 0.02) for y in ys]
        # rail brackets to the turret's rear face (three), measured by ray
        brackets = []
        for i, y in enumerate((0.55, 0.0, -0.55)):
            hit = _toward(turret, (x - 0.02, y, RAIL_Z), (1, 0, 0), (x + 0.3, y, RAIL_Z))
            brackets += kp.strut(f"a3_rb{i}", (x, y, RAIL_Z), hit, t=0.028, pad=0.06, pad_normal=(-1, 0, 0),
                                 tone="metal")
        return kp.chain_curtain("a3_ch", x, ys, drops, RAIL_Z, BALL_R, brackets=brackets)

    # -- S1: commander's panoramic sight on a pedestal ---------------------------
    def s1():
        px, py = -0.55, 0.42
        lo, hi = _seat(turret_all, px, py, 0.15)
        head_bottom = roof + 0.34 - 0.14       # the blockout head: centre roof + 0.34, 0.28 tall
        return (kp.pedestal("s1_ped", (px, py), lo, hi, head_bottom + 0.01, 0.12, 0.15, bolts=3, bolt_r=0.135)
                + kp.sight_head("s1_head", (-0.52, 0.42), head_bottom))

    # -- S2: four panoramic camera heads on the turret faces ---------------------
    def s2():
        out = []
        for i, (x, s, a) in enumerate([(0.15, 1, -20), (0.15, -1, 20), (-1.45, 1, 20), (-1.45, -1, -20)]):
            at = (x, s * (H.side(x, 1.9, s, 1.0) + 0.06), 1.90)
            M = kp.place(at, rz=s * a)
            out.append(kp.camera_head(f"s2_cam{i}", (0.46, 0.08, 0.38), M, face=(0, s, 0), window=(0.30, 0.07),
                                      centre=(0.0, 0.09)))
            # two mounting arms from the head's back, high up, to the turret face
            for j, u in enumerate((-0.15, 0.15)):
                a0 = M @ Vector((u, -s * 0.04, 0.11))
                d = M.to_3x3() @ Vector((0, -s, 0))
                hit = _toward(turret, a0, d, a0 + d * 0.1)
                if (hit - a0).length > 0.004:
                    out.append(kp.bar(f"s2_arm{i}{j}", a0, hit + d * 0.01, 0.03, tone="metal", mount=True))
        return out

    # -- S3 (turret): raised 360-degree EO/IR drum on a pedestal -----------------
    def s3_drum():
        px, py = -1.15, 0.72
        lo, hi = _seat(turret_all, px, py, 0.12)
        top_ped = roof + 0.55
        # the drum reads (0.5 m across): 16 sides, a recessed dark window band
        return (kp.pedestal("s3_ped", (px, py), lo, hi, top_ped + 0.01, 0.08, 0.12, flange_h=0.016)
                + kp.eo_drum("s3_drum", (px, py), top_ped, r=0.25, h=0.22))

    # -- S3 (hull): four hull-corner cameras, on the deck inboard of the crest ---
    def s3_cams():
        out = []
        half = 0.08
        for i, (x, y) in enumerate([(1.85, 1.25), (1.85, -1.25), (-2.95, 1.25), (-2.95, -1.25)]):
            # the mock's point sits on the glacis / rear-plate crest (45-68 deg);
            # take the nearest spot inboard that is flat to 3 cm under the housing
            xx, yy, lo, hi = _flat_spot(H.hull, x, y, half)
            look = Vector((math.copysign(1.0, x), math.copysign(0.6, y), 0.0)).normalized()
            M = kp.frame((xx, yy, hi + 0.07), look, (0, 0, 1))
            out.append(kp.camera_head(f"s3_cam{i}", (0.16, 0.16, 0.14), M, window=(0.08, 0.05),
                                      centre=(0.0, 0.01), drop=((0, 0, -1),)))
            if hi - lo > 0.004:
                out.append(kp.plain_box(f"s3_plinth{i}", (0.14, 0.14, hi - lo + 0.01),
                                        M @ kp.place((0, 0, -0.07 - (hi - lo + 0.01) / 2 + 0.002)), tone="metal",
                                        drop=((0, 0, 1), (0, 0, -1)), mount=True))
        return out

    # -- F1: barrel thermal sleeve, three clamp bands, muzzle reference sensor --
    def f1():
        x0g, x1g, gy, gz = gun
        a = x0g + (x1g - x0g) * 0.05
        c = x0g + (x1g - x0g) * 0.92
        # the barrel's root collar (r 0.135, x 0.9-1.42) swallows the sleeve's
        # first 0.45 m, so the first band sits where the root ends
        out = kp.thermal_sleeve("f1_sleeve", gy, gz, a, c, root_end=1.43, rs=0.105, rb=0.131)
        mrs = Vector((x1g - 0.12, gy, gz + 0.15))
        top = _toward(turret_all, (mrs.x, gy, mrs.z - 0.06), (0, 0, -1), (mrs.x, gy, gz + 0.085))
        return out + kp.muzzle_sensor("f1_mrs", mrs, post_to=top)

    # -- F2: enlarged gunner's primary sight + crosswind sensor ------------------
    def f2():
        c = Vector((0.50, -0.52, roof + 0.16))
        out = kp.sight_box("f2_gps", c, (0.55, 0.40, 0.36), (0.30, 0.10))
        # riser under the sight's inner rear quarter, clear of the A1 cheek
        rx0, rx1, ry0, ry1 = 0.24, 0.48, -0.42, -0.33
        lo = min(_tops(turret_all, [(rx0, ry0), (rx1, ry0), (rx0, ry1), (rx1, ry1), ((rx0 + rx1) / 2, (ry0 + ry1) / 2)]))
        zb = c.z - 0.18
        out.append(kp.plain_box("f2_riser", (rx1 - rx0, ry1 - ry0, zb - lo + 0.02),
                                kp.place(((rx0 + rx1) / 2, (ry0 + ry1) / 2, (zb + lo) / 2)), tone="metal",
                                drop=((0, 0, 1), (0, 0, -1)), mount=True))
        px, py = -1.55, -0.78
        lo, hi = _seat(turret_all, px, py, 0.06)
        return out + kp.crosswind_sensor("f2_xw", (px, py), lo, hi, roof + 0.56)

    # -- F3: armoured ready-round container on the bustle -----------------------
    def f3():
        cx, cy = -1.85, 0.0
        zb = roof
        # the body stops 2 mm under the lid's underside (the blockout's lid sits at roof + 0.44)
        out = kp.ammo_container("f3", (cx, cy), zb, size=(0.80, 1.40, 0.413), lid=(0.84, 1.44, 0.05), lid_z=zb + 0.44)
        # skids down to the roof (the container sits 0-9 cm above it)
        for j, yy in enumerate((-0.45, 0.45)):
            xs0, xs1 = cx - 0.15, cx + 0.38
            lo = min(_tops(turret_all, [(xs0, yy), (xs1, yy), ((xs0 + xs1) / 2, yy)]))
            out.append(kp.plain_box(f"f3_skid{j}", (xs1 - xs0, 0.06, zb - lo + 0.02),
                                    kp.place(((xs0 + xs1) / 2, yy, (zb + lo) / 2)), tone="paint",
                                    drop=((0, 0, 1), (0, 0, -1)), mount=True))
        return out

    return [
        ("armour", 1, "turret_hull", "turret cheek wedge modules", a1),
        ("armour", 2, "hull_hull", "hull side skirt modules, 5 a side", a2),
        ("armour", 3, "hull_hull", "rear slat cage", a3_cage),
        ("armour", 3, "turret_hull", "ball-and-chain curtain behind the turret", a3_chains),
        ("sensors", 1, "turret_metal", "commander's panoramic sight", s1),
        ("sensors", 2, "turret_hull", "four panoramic camera heads on the turret faces", s2),
        ("sensors", 3, "turret_metal", "raised 360-degree EO/IR drum", s3_drum),
        ("sensors", 3, "hull_hull", "four hull-corner cameras", s3_cams),
        ("firepower", 1, "turret_metal", "barrel thermal sleeve + muzzle reference sensor", f1),
        ("firepower", 2, "turret_metal", "enlarged gunner's primary sight + crosswind sensor", f2),
        ("firepower", 3, "turret_hull", "armoured ready-round container on the turret bustle", f3),
    ]


# ---------------------------------------------------------------------------
# ifv_namer
# ---------------------------------------------------------------------------

def parts_ifv_namer(H):
    if not isinstance(H, Hull):
        raise TypeError("pass a kit_blockout.Hull")
    sy2 = H.side(0, 2.1, 1, 1.70)
    roof = 3.06
    gun = barrel(H, "turret_metal", 1.55)
    rws = _tree(H, ("turret_metal",))
    hull = H.hull

    # -- A1: glacis applique plates on the 31 degree glacis ----------------------
    def a1():
        out = []
        size = (1.30, 1.40, 0.14)
        for tag, y in (("L", 0.78), ("R", -0.78)):
            M = kp.place((2.75, y, 2.66), ry=31)
            d, _g = _seat_shift(hull, M, size, (0, 0, -1))
            out += kp.armour_plate(f"a1_gl{tag}", size, _shifted(M, (0, 0, -1), d),
                                   bolts=((-0.4, -0.4), (0.4, -0.4), (-0.4, 0.4), (0.4, 0.4)), eyes=((-0.32, 0.0),),
                                   panel_inset=0.08)
        return out

    # -- A2: ERA bricks along each upper side, 7 a side --------------------------
    def a2():
        out = []
        x0, x1, n = -3.0, 2.4, 7
        step = (x1 - x0) / n
        size = (min(0.74, step * 0.94), 0.18, 0.46)
        for tag, s in (("L", 1), ("R", -1)):
            # the upper side leans IN by ~20 degrees (measured); the blockout's
            # bricks leaned 12 degrees OUT, standing 5-13 cm off it
            lean = sum(_side_slope(H, x0 + step * (i + 0.5), s, 1.95, 2.35) for i in range(n)) / n
            for i in range(n):
                xc = x0 + step * (i + 0.5)
                M = kp.place((xc, s * (sy2 + 0.12), 2.15), rx=s * lean)
                # a smooth side with nothing standing proud of it: let a
                # brick come out as far as its lower edge needs
                d, _g = _seat_shift(hull, M, size, (0, -s, 0), max_out=0.10)
                out += kp.era_brick(f"a2_era{tag}{i}", size, _shifted(M, (0, -s, 0), d), s,
                                    bolts=((-0.3, 0.3), (0.3, 0.3)), plate_inset=0.06)
        return out

    # -- A3: rear slat cage round the ramp and the rear quarters -----------------
    def a3():
        out = []
        z0, z1, xr, xf = 0.95, 2.65, -4.10, -2.30
        # the side panels stand clear of the track's own outer face
        widest = max(H.side(x, z, s, 0.0) for x in (xr, (xr + xf) / 2, xf, -3.65, -3.4) for z in (1.0, 1.4, 1.8)
                     for s in (1, -1))
        ys = max(2.05, widest + 0.06)
        rear, rposts = kp.slat_panel("a3_slR", (xr, ys), (xr, -ys), z0, z1)
        sideL, lposts = kp.slat_panel("a3_slSL", (xr, ys), (xf, ys), z0, z1, skip_posts=(0,))
        sideR, rposts2 = kp.slat_panel("a3_slSR", (xr, -ys), (xf, -ys), z0, z1, skip_posts=(0,))
        out += rear + sideL + sideR
        for i, p in enumerate(rposts[1:-1]):
            for k, z in enumerate((1.45, 2.25)):
                hit = _toward(hull, (p.x + 0.03, p.y, z), (1, 0, 0), (p.x + 0.5, p.y, z))
                if hit.x - p.x < 1.0:
                    out += kp.strut(f"a3_brR{i}{k}", (p.x + 0.024, p.y, z), hit, pad=0)
        for tag, s, posts in (("L", 1, lposts), ("R", -1, rposts2)):
            for i, p in enumerate(posts[1:]):
                for k, z in enumerate((1.45, 2.25)):
                    hit = _toward(hull, (p.x, p.y - s * 0.03, z), (0, -s, 0), (p.x, s * 1.6, z))
                    if abs(hit.y - p.y) < 0.8:
                        out += kp.strut(f"a3_brS{tag}{i}{k}", (p.x, p.y - s * 0.024, z), hit, pad=0)
        return out

    # -- S1: commander's sight head beside the RWS -------------------------------
    def s1():
        px, py = 0.05, 0.95
        lo, hi = _seat(H.all, px, py, 0.15)
        bottom = 3.24 + 0.22                      # the blockout's pedestal top
        return (kp.pedestal("s1_ped", (px, py), lo, hi, bottom + 0.01, 0.12, 0.15, bolts=3, bolt_r=0.135)
                + kp.sight_head("s1_head", (0.08, 0.95), bottom, size=(0.40, 0.32, 0.30), body_h=0.24))

    # -- S2: four panoramic camera heads at the roof corners, on posts ----------
    def s2():
        out = []
        for i, (x, y, a) in enumerate([(2.0, 1.45, 45), (2.0, -1.45, -45), (-2.7, 1.45, -45), (-2.7, -1.45, 45)]):
            c = Vector((x, y, roof + 0.22))
            M = kp.place(c, rz=a)
            out.append(kp.camera_head(f"s2_cam{i}", (0.50, 0.10, 0.40), M, face=(0, math.copysign(1, y), 0),
                                      window=(0.30, 0.07), centre=(0.0, 0.08)))
            ground = H.top(x, y, roof - 0.5)
            out.append(kp.tube(f"s2_post{i}", (x, y, c.z - 0.19), (x, y, ground - 0.01), 0.035, sides=8,
                               cap0=False, cap1=False, ground=True))
        return out

    # -- S3: folding EO mast with a sensor ball, rear roof -----------------------
    def s3():
        px, py = -2.9, -0.95
        lo, hi = _seat(H.all, px, py, 0.11)
        r = 0.07
        mast, top = kp.telescoping_mast("s3_mast", (px, py), lo, hi, (1.15 / 3,) * 3,
                                        (r, r * 0.78, r * 0.56), 0.11, sides=8, bolts=0)
        return mast + kp.sensor_ball("s3_ball", (px, py, top + 0.21), 0.21, segments=8, rings=5)

    # -- F1: gunner's thermal sight block on the RWS -----------------------------
    def f1():
        c = Vector((0.72, -0.30, 3.88 - 0.003))
        out = kp.sight_box("f1_th", c, (0.40, 0.28, 0.28), (0.20, 0.08), window_centre=(0.0, 0.02),
                           visor=(0.08, 0.30, 0.03), visor_drop=0.10)
        for i, yy in enumerate((c.y - 0.10, c.y + 0.10)):
            out.append(kp.hex_bolt(f"f1_b{i}", (c.x - 0.12, yy, c.z + 0.14), (0, 0, 1), across=0.024, height=0.01))
        return out

    # -- F2: 30 mm barrel thermal shroud + muzzle-velocity radar ------------------
    def f2():
        x0, x1, gy, gz = gun
        a, c = x0 + (x1 - x0) * 0.15, x0 + (x1 - x0) * 0.85
        out = kp.barrel_shroud("f2_sh", gy, gz, a, c, 0.085, 0.106, 0.058)
        out += kp.radar_array("f2_mvr", kp.place((1.15, 0.0, gz + 0.17)), (0.20, 0.16, 0.14))
        return out

    # -- F3: armoured dual-feed magazine on the RWS's left side ------------------
    def f3():
        size = (0.95, 0.42, 0.50)
        M = kp.place((0.72, 0.64, 3.50))
        d, _g = _seat_shift(rws, M, size, (0, -1, 0))
        M = _shifted(M, (0, -1, 0), d)
        out = kp.ammo_box("f3_mag", size, M, lid_h=0.05, tone="paint")
        y_in = M.translation.y - size[1] / 2
        out += kp.feed_chute("f3_chute", [(0.80, y_in + 0.02, 3.62), (0.92, y_in - 0.04, 3.62), (1.00, y_in - 0.12, 3.62)],
                             w=0.10)
        return out

    return [
        ("armour", 1, "hull_hull", "glacis applique plates", a1),
        ("armour", 2, "hull_hull", "ERA bricks along the upper sides, 7 a side", a2),
        ("armour", 3, "hull_hull", "rear slat cage", a3),
        ("sensors", 1, "hull_hull", "commander's sight head beside the RWS", s1),
        ("sensors", 2, "hull_hull", "four panoramic camera heads at the roof corners", s2),
        ("sensors", 3, "hull_hull", "folding EO mast with a sensor ball", s3),
        ("firepower", 1, "turret_metal", "gunner's thermal sight block on the RWS", f1),
        ("firepower", 2, "turret_metal", "30 mm barrel thermal shroud + muzzle-velocity radar", f2),
        ("firepower", 3, "turret_metal", "armoured dual-feed magazine", f3),
    ]


# ---------------------------------------------------------------------------
# shared by the wheeled carriers
# ---------------------------------------------------------------------------

def _corner_cams(H, specs, size, roof_tree, face_lateral=True, post=False, prefix="s2_cam"):
    """Panoramic camera heads at `specs` [(x, y, angle, z_centre)], each a
    housing with a recessed window looking out sideways, on a plinth or a
    post down to the roof."""
    out = []
    for i, (x, y, a, zc) in enumerate(specs):
        M = kp.place((x, y, zc), rz=a)
        out.append(kp.camera_head(f"{prefix}{i}", size, M, face=(0, math.copysign(1, y), 0),
                                  window=(size[0] * 0.6, 0.07), centre=(0.0, size[2] * 0.2)))
        ground = roof_tree.ray_cast(Vector((x, y, zc - size[2] / 2 - 0.002)), Vector((0, 0, -1)))
        gz = ground[0].z if ground[0] is not None else zc - size[2] / 2 - 0.05
        bottom = zc - size[2] / 2
        if bottom - gz > 0.004:
            if post:
                out.append(kp.tube(f"{prefix}_post{i}", (x, y, bottom + 0.005), (x, y, gz - 0.01), 0.035, sides=8,
                                   cap0=False, cap1=False, ground=True))
            else:
                out.append(kp.plain_box(f"{prefix}_plinth{i}", (size[0] * 0.8, size[1] * 0.8, bottom - gz + 0.02),
                                        kp.place((x, y, (bottom + gz) / 2), rz=a), tone="metal",
                                        drop=((0, 0, 1), (0, 0, -1)), mount=True))
    return out


def _cage(H, prefix, panels, brackets_z, side_reach=0.8, rear_reach=1.0):
    """Slat panels [(name, p0, p1, z0, z1, kwargs)] and welded struts from
    their posts back to the hull at `brackets_z` heights: rear panels (p0.x ==
    p1.x) strut forward along +X, side panels inward along -Y*sign."""
    out = []
    hull = H.hull
    for name, p0, p1, z0, z1, kw in panels:
        pieces, posts = kp.slat_panel(f"{prefix}{name}", p0, p1, z0, z1, **kw)
        out += pieces
        skip = set(kw.get("skip_posts", ()))
        rear = abs(p0[0] - p1[0]) < 1e-6
        for i, p in enumerate(posts):
            if i in skip or (rear and i in (0, len(posts) - 1)):
                continue
            for k, z in enumerate(brackets_z):
                if not (z0 < z < z1):
                    continue
                if rear:
                    sgn = 1.0 if p.x < 0 else -1.0
                    hit = _toward(hull, (p.x + sgn * 0.03, p.y, z), (sgn, 0, 0), (p.x + sgn * 9, p.y, z))
                    if abs(hit.x - p.x) < rear_reach:
                        out += kp.strut(f"{prefix}{name}_br{i}{k}", (p.x + sgn * 0.024, p.y, z), hit, pad=0)
                else:
                    sg = 1.0 if p.y > 0 else -1.0
                    hit = _toward(hull, (p.x, p.y - sg * 0.03, z), (0, -sg, 0), (p.x, p.y - sg * 9, z))
                    if abs(hit.y - p.y) < side_reach:
                        out += kp.strut(f"{prefix}{name}_br{i}{k}", (p.x, p.y - sg * 0.024, z), hit, pad=0)
    return out


def _mast_head(H, prefix, xy, top_z, radii, flange_r, head=None, ball=None, drum=None, sections=3, bolts=2,
               sides=8, tree=None, drum_sides=12):
    """A telescoping mast standing on the roof under `xy`, its stages sized so
    its top is the blockout's mast top `top_z`, with a box head (size), a
    sensor ball (radius) or an EO drum ((r, h)) on top."""
    lo, hi = _seat(tree or H.all, xy[0], xy[1], flange_r)
    ft = hi + 0.014
    h = (top_z - ft) / sections
    out, top = kp.telescoping_mast(f"{prefix}_mast", xy, lo, hi, (h,) * sections, radii, flange_r, sides=sides,
                                   bolts=bolts)
    if head is not None:
        c = Vector((xy[0], xy[1], top + head[2] / 2 - 0.004))
        out.append(kp.camera_head(f"{prefix}_head", head, kp.place(c), window=(head[1] * 0.6, head[2] * 0.3),
                                  centre=(0.0, head[2] * 0.08)))
        out.append(kp.chamfered_box(f"{prefix}_win2", (0.012, head[1] * 0.5, head[2] * 0.3),
                                    kp.place((c.x - head[0] / 2 - 0.004, c.y, c.z + head[2] * 0.08)), tone="dark",
                                    chamfer=0.004, drop=((1, 0, 0),)))
    if ball is not None:
        out += kp.sensor_ball(f"{prefix}_ball", (xy[0], xy[1], top + ball), ball, segments=8, rings=5)
    if drum is not None:
        r, dh = drum
        out += kp.eo_drum(f"{prefix}_drum", xy, top - 0.004, r=r, h=dh, sides=drum_sides)
    return out


# ---------------------------------------------------------------------------
# apc_eitan
# ---------------------------------------------------------------------------

def parts_apc_eitan(H):
    if not isinstance(H, Hull):
        raise TypeError("pass a kit_blockout.Hull")
    roof = 2.62
    tlo, thi = H.bounds("turret_metal")
    gun = barrel(H, "turret_metal", 1.05)
    hull = H.hull
    rws = _tree(H, ("turret_metal", "turret_plate"))

    def a1():
        out = []
        for tag, y in (("L", 0.62), ("R", -0.62)):
            size = (0.95, 1.05, 0.09)
            M = kp.place((2.55, y, 2.00), ry=13)
            d, _g = _seat_shift(hull, M, size, (0, 0, -1))
            out += kp.armour_plate(f"a1_nose{tag}", size, _shifted(M, (0, 0, -1), d),
                                   bolts=((-0.4, -0.4), (0.4, -0.4), (-0.4, 0.4), (0.4, 0.4)), panel_inset=0.07)
        # the bow plate stands in front of the nose: local Z is its face, +X
        size = (0.50, 2.30, 0.10)
        M = kp.frame((3.62, 0.0, 1.25), (0, 0, 1), (1, 0, 0))
        d, _g = _seat_shift(hull, M, (0.50, 2.30, 0.10), (0, 0, -1))
        out += kp.armour_plate("a1_bow", (0.50, 2.30, 0.10), _shifted(M, (0, 0, -1), d),
                               bolts=((-0.3, -0.42), (0.3, -0.42), (-0.3, 0.42), (0.3, 0.42), (0.0, 0.0)))
        return out

    def a2():
        out = []
        size = (1.05, 0.12, 0.50)
        for i, x in enumerate((-2.05, -0.95, 0.75, 2.45)):
            for tag, s in (("L", 1), ("R", -1)):
                lean = _side_slope(H, x, s, 1.55, 1.90)
                M = kp.place((x, s * 1.56, 1.72), rx=s * lean)
                d, _g = _seat_shift(hull, M, size, (0, -s, 0))
                out += kp.era_brick(f"a2_m{i}{tag}", size, _shifted(M, (0, -s, 0), d), s,
                                    bolts=((-0.38, 0.3), (0.38, 0.3), (-0.38, -0.3), (0.38, -0.3)), plate_inset=0.07)
        return out

    def a3():
        return _cage(H, "a3_", [
            ("sL", (-3.25, 2.00), (3.05, 2.00), 0.95, 2.05, {"post_every": 1.05}),
            ("sR", (-3.25, -2.00), (3.05, -2.00), 0.95, 2.05, {"post_every": 1.05}),
            ("rr", (-3.95, 2.00), (-3.95, -2.00), 0.65, 2.25, {}),
        ], (1.10, 1.85))

    def s1():
        px, py = 1.25, 0.62
        lo, hi = _seat(H.all, px, py, 0.14)
        bottom = roof + 0.20
        return (kp.pedestal("s1_ped", (px, py), lo, hi, bottom + 0.01, 0.11, 0.14, bolts=3, bolt_r=0.125)
                + kp.sight_head("s1_head", (1.28, 0.62), bottom, size=(0.38, 0.30, 0.28), body_h=0.22,
                                window=(0.22, 0.07), hood=(0.37, 0.32, 0.06), door=(0.014, 0.20, 0.12)))

    def s2():
        specs = [(x, y, a, H.top(x, y, roof, hull) + 0.20)
                 for (x, y, a) in [(1.95, 1.05, 45), (1.95, -1.05, -45), (-2.95, 1.0, -45), (-2.95, -1.0, 45)]]
        return _corner_cams(H, specs, (0.46, 0.10, 0.38), hull)

    def s3():
        r = 0.075
        return _mast_head(H, "s3", (-3.05, -0.80), roof + 2.0, (r, r * 0.78, r * 0.56), 0.11,
                          head=(0.50, 0.38, 0.30))

    # F1 hangs OUTBOARD of the station, below its top: on top it raised the
    # station's bounds 0.24 m and the gate's IoU against gun_truck read 0.8804
    # (spec section 4); hung here it read 0.8326
    def f1():
        c = Vector((-0.60, 0.88, thi.z - 0.14))
        out = kp.sight_box("f1_th", c, (0.32, 0.24, 0.24), (0.16, 0.07), window_centre=(0.0, 0.02),
                           visor=(0.07, 0.26, 0.025), visor_drop=0.085)
        a0 = c - Vector((0, 0.12, 0))
        hit = _toward(rws, a0, (0, -1, 0), a0 - Vector((0, 0.1, 0)))
        if (hit - a0).length > 0.004:
            out.append(kp.bar("f1_arm", a0, hit - Vector((0, 0.01, 0)), 0.03, tone="metal", mount=True))
        return out

    def f2():
        x0, x1, gy, gz = gun
        a, c = x0 + (x1 - x0) * 0.15, x0 + (x1 - x0) * 0.85
        r_in = _barrel_r(H, "turret_metal", gun, (a + c) / 2) * 0.97
        out = kp.barrel_shroud("f2_sh", gy, gz, a, c, 0.05, 0.062, r_in)
        out += kp.ammo_box("f2_box", (0.52, 0.24, 0.36), kp.place((-0.85, 0.90, 3.06)), lid_h=0.04, handle=False)
        out += kp.feed_chute("f2_chute", [(-0.70, 0.80, 3.16), (-0.62, 0.74, 3.16), (-0.52, 0.70, 3.14)], w=0.08)
        return out

    def f3():
        return kp.cowl("f3_cowl", (-0.55, 0.40, 3.08), 0.95, 1.05, 0.46)

    return [
        ("armour", 1, "hull_hull", "nose applique plates + bow plate", a1),
        ("armour", 2, "hull_hull", "upper-side armour modules, 4 a side", a2),
        ("armour", 3, "hull_hull", "slat cage over the sides and rear", a3),
        ("sensors", 1, "hull_hull", "commander's sight head", s1),
        ("sensors", 2, "hull_hull", "four panoramic camera heads at the roof corners", s2),
        ("sensors", 3, "hull_hull", "telescopic sensor mast with a sensor head", s3),
        ("firepower", 1, "turret_metal", "thermal sight block outboard of the RWS", f1),
        ("firepower", 2, "turret_metal", ".50 heat shroud + ammunition box with feed chute", f2),
        ("firepower", 3, "turret_metal", "armoured cowl round the weapon station", f3),
    ]


# ---------------------------------------------------------------------------
# apc_kipod
# ---------------------------------------------------------------------------

def parts_apc_kipod(H):
    if not isinstance(H, Hull):
        raise TypeError("pass a kit_blockout.Hull")
    roof = 2.96
    tlo, thi = H.bounds("turret_metal")
    gun = barrel(H, "turret_metal", 1.05)
    hull = H.hull
    rws = _tree(H, ("turret_metal", "turret_plate"))

    def a1():
        out = []
        size = (0.55, 0.62, 0.13)
        for r in range(2):
            for c in range(4):
                M = kp.place((2.35 + 0.55 * r, -0.99 + 0.66 * c, 2.42 - 0.30 * r), ry=25)
                d, _g = _seat_shift(hull, M, size, (0, 0, -1))
                out += kp.armour_plate(f"a1_era{r}{c}", size, _shifted(M, (0, 0, -1), d),
                                       bolts=((-0.3, -0.3), (0.3, 0.3)), panel_inset=0.05)
        return out

    def a2():
        out = []
        x0, x1, n = -2.7, 2.4, 6
        step = (x1 - x0) / n
        size = (min(0.78, step * 0.94), 0.16, 0.42)
        for tag, s in (("L", 1), ("R", -1)):
            for i in range(n):
                M = kp.place((x0 + step * (i + 0.5), s * 1.64, 1.82))
                d, _g = _seat_shift(hull, M, size, (0, -s, 0))
                out += kp.era_brick(f"a2_era{tag}{i}", size, _shifted(M, (0, -s, 0), d), s,
                                    bolts=((-0.3, 0.3), (0.3, 0.3)), plate_inset=0.06)
        return out

    def a3():
        return _cage(H, "a3_", [
            ("slR", (-4.00, 2.05), (-4.00, -2.05), 0.70, 2.55, {}),
            ("slSL", (-4.00, 2.05), (-2.40, 2.05), 0.70, 2.55, {"skip_posts": (0,)}),
            ("slSR", (-4.00, -2.05), (-2.40, -2.05), 0.70, 2.55, {"skip_posts": (0,)}),
        ], (1.20, 2.10))

    def s1():
        px, py = 1.55, 0.70
        lo, hi = _seat(H.all, px, py, 0.14)
        bottom = roof + 0.20
        return (kp.pedestal("s1_ped", (px, py), lo, hi, bottom + 0.01, 0.11, 0.14, bolts=3, bolt_r=0.125)
                + kp.sight_head("s1_head", (1.58, 0.70), bottom, size=(0.38, 0.30, 0.28), body_h=0.22,
                                window=(0.22, 0.07), hood=(0.37, 0.32, 0.06), door=(0.014, 0.20, 0.12)))

    def s2():
        px, py = 1.85, -0.70
        lo, hi = _seat(H.all, px, py, 0.104)
        ant = Vector((px, py, roof + 0.62))
        out = kp.pedestal("s2_ped", (px, py), lo, hi, ant.z - 0.20, 0.08, 0.104, sides=8, bolts=2, bolt_r=0.092)
        out += kp.radar_array("s2_ant", kp.place(ant, ry=-12), (0.10, 0.92, 0.44), hinge_knuckle=False)
        out.append(kp.chamfered_box("s2_yoke", (0.12, 0.20, 0.06), kp.place((px, py, ant.z - 0.225)), tone="metal",
                                    chamfer=0.006))
        return out

    def s3():
        r = 0.07
        return _mast_head(H, "s3", (-2.95, 0.55), roof + 1.70, (r, r * 0.78, r * 0.56), 0.10, drum=(0.22, 0.26),
                          bolts=0)

    def f1():
        c = Vector((-1.25, -0.24, thi.z + 0.12 - 0.003))
        out = kp.sight_box("f1_th", c, (0.32, 0.24, 0.24), (0.16, 0.07), window_centre=(0.0, 0.02),
                           visor=(0.07, 0.26, 0.025), visor_drop=0.085)
        for i, yy in enumerate((c.y - 0.08, c.y + 0.08)):
            out.append(kp.hex_bolt(f"f1_b{i}", (c.x - 0.10, yy, c.z + 0.12), (0, 0, 1), across=0.022, height=0.008))
        return out

    def f2():
        x0, x1, gy, gz = gun
        a, c = x0 + (x1 - x0) * 0.15, x0 + (x1 - x0) * 0.85
        r_in = _barrel_r(H, "turret_metal", gun, (a + c) / 2) * 0.97
        out = kp.barrel_shroud("f2_sh", gy, gz, a, c, 0.045, 0.056, r_in)
        size = (0.50, 0.24, 0.34)
        M = kp.place((-1.45, 0.48, 3.62))
        d, _g = _seat_shift(rws, M, size, (0, -1, 0))
        out += kp.ammo_box("f2_box", size, _shifted(M, (0, -1, 0), d), lid_h=0.04, handle=False)
        out += kp.feed_chute("f2_chute", [(-1.30, 0.38, 3.72), (-1.20, 0.32, 3.72), (-1.10, 0.26, 3.70)], w=0.08)
        return out

    def f3():
        return kp.cowl("f3_cowl", (-1.10, 0.0, 3.66), 0.95, 1.05, 0.44)

    return [
        ("armour", 1, "hull_hull", "ERA bank on the nose slope, 2 rows of 4", a1),
        ("armour", 2, "hull_hull", "second ERA row along each side, 6 a side", a2),
        ("armour", 3, "hull_hull", "rear slat cage and rear quarters", a3),
        ("sensors", 1, "hull_hull", "commander's sight head", s1),
        ("sensors", 2, "hull_hull", "ground-surveillance radar on a roof pedestal", s2),
        ("sensors", 3, "hull_hull", "telescopic mast with an EO drum", s3),
        ("firepower", 1, "turret_metal", "thermal sight block on the RWS", f1),
        ("firepower", 2, "turret_metal", "heat shroud + ammunition box with feed chute", f2),
        ("firepower", 3, "turret_metal", "armoured cowl round the weapon station", f3),
    ]


# ---------------------------------------------------------------------------
# scout_shachaf
# ---------------------------------------------------------------------------

def _side_plate(H, name, size, at, s, bolts=(), panel_inset=None, max_out=0.03, tree=None):
    """A plate hung on a hull side (+Y * s out): local X along the hull,
    local Y up, local Z out; seated against the side, bolted."""
    M = kp.frame(at, (1, 0, 0), (0, s, 0))
    sz = (size[0], size[2], size[1])           # (long, high, thick) in the plate's frame
    d, _g = _seat_shift(tree or H.hull, M, sz, (0, 0, -1), max_out=max_out)
    return kp.armour_plate(name, sz, _shifted(M, (0, 0, -1), d), bolts=bolts, panel_inset=panel_inset)


def parts_scout_shachaf(H):
    if not isinstance(H, Hull):
        raise TypeError("pass a kit_blockout.Hull")
    hv = H.verts("hull_hull", lambda c: c.z > 2.75)
    mx = sum(c.x for c in hv) / len(hv)
    my = sum(c.y for c in hv) / len(hv)
    mtop = max(c.z for c in hv)
    gun = barrel(H, "turret_metal", 0.75)
    hull = H.hull

    def a1():
        size = (1.00, 1.10, 0.08)
        M = kp.place((1.25, 0.0, 1.78), ry=20)
        d, _g = _seat_shift(hull, M, size, (0, 0, -1))
        out = kp.armour_plate("a1_nose", size, _shifted(M, (0, 0, -1), d),
                              bolts=((-0.4, -0.4), (0.4, -0.4), (-0.4, 0.4), (0.4, 0.4)), panel_inset=0.07)
        for tag, s in (("L", 1), ("R", -1)):
            out += _side_plate(H, f"a1_d{tag}", (0.82, 0.06, 0.58), (0.20, s * 0.74, 1.60), s,
                               bolts=((-0.4, 0.38), (0.4, 0.38)), panel_inset=0.06)
        return out

    def a2():
        out = []
        for tag, s in (("L", 1), ("R", -1)):
            out += _side_plate(H, f"a2_s{tag}", (1.90, 0.08, 0.66), (-0.05, s * 0.80, 1.12), s,
                               bolts=((-0.45, 0.38), (0.0, 0.38), (0.45, 0.38)), panel_inset=0.08)
        for i, (x, sg) in enumerate([(1.62, 1), (1.62, -1), (-1.70, 1), (-1.70, -1)]):
            out.append(kp.chamfered_box(f"a2_ag{i}", (0.80, 0.30, 0.06), kp.place((x, sg * 1.10, 1.24), rx=sg * -10),
                                        tone="paint", chamfer=0.01))
        return out

    def a3():
        return _cage(H, "a3_", [
            ("gL", (-1.85, 0.98), (1.05, 0.98), 1.35, 2.15, {"pitch": 0.13}),
            ("gR", (-1.85, -0.98), (1.05, -0.98), 1.35, 2.15, {"pitch": 0.13}),
            ("gF", (2.40, 0.65), (2.40, -0.65), 0.55, 1.15, {"pitch": 0.13}),
        ], (1.60, 1.95, 0.85), side_reach=0.6, rear_reach=0.6)

    def s1():
        c = Vector((mx + 0.05, my - 0.24, mtop - 0.12))
        out = [kp.camera_head("s1_lrf", (0.32, 0.22, 0.20), kp.place(c), window=(0.10, 0.06), centre=(0.0, 0.02))]
        out.append(kp.chamfered_box("s1_lens2", (0.012, 0.07, 0.07), kp.place((c.x + 0.166, c.y + 0.06, c.z - 0.03)),
                                    tone="dark", chamfer=0.003, drop=((-1, 0, 0),)))
        a0 = c + Vector((0, 0.11, 0))
        hit = _toward(H.all, a0, (0, 1, 0), a0 + Vector((0, 0.1, 0)))
        if (hit - a0).length > 0.004:
            out.append(kp.bar("s1_arm", a0, hit + Vector((0, 0.01, 0)), 0.03, tone="metal", mount=True))
        return out

    def s2():
        c = Vector((mx + 0.12, my, mtop - 0.50))
        out = kp.radar_array("s2_rad", kp.place(c), (0.10, 0.78, 0.34), hinge_knuckle=False)
        a0 = c - Vector((0.05, 0, 0))
        hit = _toward(H.all, a0, (-1, 0, 0), a0 - Vector((0.1, 0, 0)))
        if (hit - a0).length > 0.004:
            out.append(kp.bar("s2_arm", a0, hit - Vector((0.01, 0, 0)), 0.04, tone="metal", mount=True))
        return out

    def s3():
        out, top = kp.telescoping_mast("s3_ext", (mx, my), mtop - 0.01, mtop - 0.014, (0.5, 0.5), (0.05, 0.039), 0.07,
                                       sides=8, bolts=2)
        head = (0.46, 0.32, 0.30)
        hc = Vector((mx, my, top + head[2] / 2 - 0.004))
        out.append(kp.camera_head("s3_head", head, kp.place(hc), window=(0.20, 0.08), centre=(0.0, 0.03)))
        out.append(kp.chamfered_box("s3_hood", (0.10, 0.34, 0.025), kp.place((hc.x + 0.215, hc.y, hc.z + 0.09)),
                                    tone="metal", chamfer=0.006))
        return out

    def f1():
        return kp.sight_box("f1_th", (-0.95, -0.20, 2.62 - 0.003), (0.28, 0.20, 0.20), (0.14, 0.06),
                            window_centre=(0.0, 0.02), visor=(0.06, 0.22, 0.02), visor_drop=0.07)

    def f2():
        x0, x1, gy, gz = gun
        a, c = x0 + (x1 - x0) * 0.15, x0 + (x1 - x0) * 0.85
        r_in = _barrel_r(H, "turret_metal", gun, (a + c) / 2) * 0.97
        out = kp.barrel_shroud("f2_sh", gy, gz, a, c, 0.04, 0.05, r_in, sides=6)
        out += kp.ammo_box("f2_box", (0.44, 0.22, 0.30), kp.place((-1.05, 0.36, 2.40)), lid_h=0.035, handle=False)
        return out

    def f3():
        out = kp.cowl("f3_cowl", (-0.85, 0.0, 2.36), 0.80, 0.85, 0.40, bolts=False)
        for i, yy in enumerate((-0.25, 0.25)):
            out.append(kp.hex_bolt(f"f3_b{i}", (-0.85 + 0.425 + 0.025, yy, 2.36 + 0.12), (1, 0, 0), across=0.024,
                                   height=0.01))
        return out

    return [
        ("armour", 1, "hull_hull", "nose plate + door plates", a1),
        ("armour", 2, "hull_hull", "side armour panels + arch guards", a2),
        ("armour", 3, "hull_hull", "grille cage along the sides + front grille", a3),
        ("sensors", 1, "hull_hull", "laser-rangefinder/thermal box beside the mast head", s1),
        ("sensors", 2, "hull_hull", "ground-surveillance radar under the mast head", s2),
        ("sensors", 3, "hull_hull", "second mast stage with a sensor head", s3),
        ("firepower", 1, "turret_metal", "thermal sight block on the RWS", f1),
        ("firepower", 2, "turret_metal", "barrel heat shroud + ammunition box", f2),
        ("firepower", 3, "turret_metal", "armoured cowl round the weapon station", f3),
    ]


# ---------------------------------------------------------------------------
# jeep_shoded
# ---------------------------------------------------------------------------

def parts_jeep_shoded(H):
    if not isinstance(H, Hull):
        raise TypeError("pass a kit_blockout.Hull")
    cab = 1.73
    gun = barrel(H, "hull_metal", 1.0)

    def a1():
        out = []
        for i, x in enumerate((-0.55, 0.30)):
            for tag, s in (("L", 1), ("R", -1)):
                out += _side_plate(H, f"a1_d{i}{tag}", (0.78, 0.06, 0.58), (x, s * 1.04, 1.22), s,
                                   bolts=((-0.4, 0.38), (0.4, 0.38)), panel_inset=0.06,
                                   tree=_tree(H, ("hull_hull",)))
        return out

    def a2():
        out = [kp.chamfered_box("a2_shF", (0.05, 0.95, 0.55), kp.place((0.80, 0.0, 2.06)), tone="paint", chamfer=0.008,
                                windows=(((1, 0, 0), (0.30, 0.04), 0.02, (0.0, 0.12)),))]
        for tag, s in (("L", 1), ("R", -1)):
            out.append(kp.chamfered_box(f"a2_sh{tag}", (0.05, 0.48, 0.50), kp.place((0.62, s * 0.63, 2.04), rz=s * 40),
                                        tone="paint", chamfer=0.008))
            for k, dz in enumerate((-0.15, 0.15)):
                out.append(kp.hex_bolt(f"a2_b{tag}{k}", (0.80 + 0.026, s * 0.40, 2.06 + dz), (1, 0, 0),
                                       across=0.024, height=0.01))
        # two struts from the shield down to the ring
        for tag, s in (("L", 1), ("R", -1)):
            a0 = Vector((0.775, s * 0.30, 1.80))
            hit = _toward(H.all, a0, (-1, 0, -0.3), a0 + Vector((-0.2, 0, -0.06)))
            if (hit - a0).length < 0.4:
                out.append(kp.bar(f"a2_st{tag}", a0, hit, 0.03, tone="paint", mount=True))
        return out

    def a3():
        out = _cage(H, "a3_", [("bb", (2.48, 0.95), (2.48, -0.95), 0.45, 1.02, {"pitch": 0.11})], (0.75,),
                    rear_reach=0.6)
        for tag, s in (("L", 1), ("R", -1)):
            out += _side_plate(H, f"a3_bed{tag}", (0.92, 0.05, 0.46), (-1.55, s * 1.02, 1.02), s,
                               bolts=((-0.42, 0.36), (0.42, 0.36)), panel_inset=0.06)
        # windscreen louvres: a frame and five louvres, leaning back 30 degrees
        M = kp.place((0.78, 0.0, 1.52), ry=-30)
        R = M.to_3x3()
        hy, hz = 0.85, 0.20
        for k, (p0, p1, w, h) in enumerate([((0, -hy, -hz), (0, hy, -hz), 0.04, 0.04), ((0, -hy, hz), (0, hy, hz), 0.04, 0.04),
                                            ((0, -hy, -hz), (0, -hy, hz), 0.04, 0.04), ((0, hy, -hz), (0, hy, hz), 0.04, 0.04)]):
            out.append(kp.bar(f"a3_wsf{k}", M @ Vector(p0), M @ Vector(p1), w, h, tone="paint",
                              cap_a=k >= 2, cap_b=k >= 2))
        for k in range(5):
            z = -hz + 2 * hz * (k + 1) / 6
            out.append(kp.bar(f"a3_wsl{k}", M @ Vector((0, -hy, z)), M @ Vector((0, hy, z)), 0.06, 0.01, tone="paint",
                              up=R @ Vector((1, 0, 1))))
        return out

    def s1():
        px, py = -0.62, -0.62
        lo, hi = _seat(H.all, px, py, 0.07)
        out = kp.pedestal("s1_post", (px, py), lo, hi, cab + 0.24, 0.04, 0.07, sides=8)
        out += kp.sensor_ball("s1_ball", (px, py, cab + 0.37), 0.14, segments=8, rings=5)
        return out

    def s2():
        out = []
        rx, ry, rz = -0.45, -0.25, cab + 0.08
        h = 0.45
        for k, (a, b) in enumerate([((-h, -h), (h, -h)), ((-h, h), (h, h)), ((-h, -h), (-h, h)), ((h, -h), (h, h)),
                                    ((0.0, -h), (0.0, h))]):
            out.append(kp.bar(f"s2_rack{k}", (rx + a[0], ry + a[1], rz), (rx + b[0], ry + b[1], rz), 0.035,
                              tone="metal", cap_a=k >= 2, cap_b=k >= 2))
        for k, (fx, fy) in enumerate([(-h, -h), (h, -h), (-h, h), (h, h)]):
            g = H.top(rx + fx, ry + fy, rz - 0.1)
            out.append(kp.plain_box(f"s2_foot{k}", (0.05, 0.05, rz - g + 0.02), kp.place((rx + fx, ry + fy, (rz + g) / 2)),
                                    tone="metal", drop=((0, 0, 1), (0, 0, -1)), mount=True))
        pod = kp.place((-0.45, -0.45, cab + 0.27))
        out.append(kp.camera_head("s2_pod", (0.55, 0.36, 0.32), pod, window=(0.20, 0.08), centre=(0.0, 0.04)))
        out.append(kp.chamfered_box("s2_hood", (0.10, 0.38, 0.025), kp.place((-0.45 + 0.30, -0.45, cab + 0.39)),
                                    tone="metal", chamfer=0.006))
        return out

    def s3():
        return _mast_head(H, "s3", (-1.55, -0.55), 0.80 + 2.3, (0.06, 0.047, 0.034), 0.09, head=(0.42, 0.30, 0.26))

    def f1():
        x0, x1, gy, gz = gun
        out = kp.sight_box("f1_sight", (0.10, 0.13, gz + 0.13), (0.26, 0.14, 0.16), (0.10, 0.06),
                           window_centre=(0.0, 0.01), visor=(0.05, 0.16, 0.02), visor_drop=0.06)
        for i, x in enumerate((-0.15, 0.20)):
            out.append(kp.chamfered_box(f"f1_can{i}", (0.30, 0.13, 0.20), kp.place((x, 0.62, 1.88)), tone="metal",
                                        chamfer=0.008))
            out.append(kp.lifting_eye(f"f1_h{i}", (x, 0.62, 1.98), (0, 0, 1), (1, 0, 0), r=0.04, t=0.008))
        return out

    def f2():
        x0, x1, gy, gz = gun
        a, c = x0 + (x1 - x0) * 0.15, x0 + (x1 - x0) * 0.85
        # the MG's barrel runs inside a gas tube and a body: close the shroud
        # onto the measured radius, never wider than the shroud itself
        r_in = min(_barrel_r(H, "hull_metal", gun, (a + c) / 2) * 0.97, 0.036)
        out = kp.barrel_shroud("f2_sh", gy, gz, a, c, 0.04, 0.05, r_in, sides=6)
        out += kp.ammo_box("f2_box", (0.40, 0.22, 0.30), kp.place((-0.05, -0.30, 2.10)), lid_h=0.035, handle=False)
        return out

    def f3():
        x0, x1, gy, gz = gun
        xa, xb = x1 + 0.45 - 0.675, x1 + 0.45 + 0.675
        prof = [(xa, 0.05), (xb - 0.16, 0.05), (xb - 0.16, 0.062), (xb - 0.02, 0.062), (xb, 0.05)]
        out = [kp.lathe("f3_hb", [(x - xa, r) for x, r in prof], (xa, gy, gz), (1, 0, 0), sides=8,
                        tones=["metal"] * 4, cap0=False, cap1=True)]
        out.append(kp.chamfered_box("f3_brake_port", (0.06, 0.13, 0.02), kp.place((xb - 0.09, gy, gz + 0.06)), tone="dark",
                                    chamfer=0.004))
        rc = Vector((x0 + 0.15, gy, gz - 0.02))
        out.append(kp.camera_head("f3_rcv", (0.65, 0.26, 0.26), kp.place(rc), face=(0, 1, 0), window=(0.36, 0.06),
                                  centre=(0.0, 0.05)))
        out.append(kp.lifting_eye("f3_handle", (rc.x, rc.y, rc.z + 0.13), (0, 0, 1), (1, 0, 0), r=0.03, t=0.008))
        return out

    return [
        ("armour", 1, "hull_hull", "door armour kits, 2 a side", a1),
        ("armour", 2, "hull_metal", "gunner's shield round the roof MG", a2),
        ("armour", 3, "hull_hull", "bull-bar grille, bed armour, windscreen louvres", a3),
        ("sensors", 1, "hull_hull", "roof EO ball on a post", s1),
        ("sensors", 2, "hull_hull", "surveillance pod on a roof rack", s2),
        ("sensors", 3, "hull_hull", "telescopic mast with a radar head in the bed", s3),
        ("firepower", 1, "hull_metal", "MG sight + two ready ammunition cans", f1),
        ("firepower", 2, "hull_metal", "barrel shroud + 400-round box", f2),
        ("firepower", 3, "hull_metal", "heavy-barrel conversion", f3),
    ]


# ---------------------------------------------------------------------------
# dozer_d9 (no firepower track)
# ---------------------------------------------------------------------------

def parts_dozer_d9(H):
    if not isinstance(H, Hull):
        raise TypeError("pass a kit_blockout.Hull")
    croof = 3.09
    hull = H.hull

    def a1():
        return _cage(H, "a1_", [
            ("gL", (-1.62, 1.30), (-0.38, 1.30), 2.05, 2.85, {"pitch": 0.10, "bar_t": 0.025}),
            ("gR", (-1.62, -1.30), (-0.38, -1.30), 2.05, 2.85, {"pitch": 0.10, "bar_t": 0.025}),
        ], (2.45,), side_reach=0.5)

    def a2():
        return _cage(H, "a2_", [
            ("cL", (-1.95, 1.62), (-0.20, 1.62), 1.90, 3.00, {"skip_posts": (0,)}),
            ("cR", (-1.95, -1.62), (-0.20, -1.62), 1.90, 3.00, {"skip_posts": (0,)}),
            ("cB", (-1.95, 1.62), (-1.95, -1.62), 1.90, 3.00, {}),
        ], (2.20, 2.75), side_reach=0.8, rear_reach=0.9)

    def a3():
        out = []
        x0, x1, n = -2.6, 2.0, 5
        step = (x1 - x0) / n
        size = (min(0.90, step * 0.94), 0.08, 0.60)
        for tag, s in (("L", 1), ("R", -1)):
            for i in range(n):
                xc = x0 + step * (i + 0.5)
                M = kp.place((xc, s * 2.24, 1.55))
                out.append(kp.chamfered_box(f"a3_sk{tag}{i}", size, M, tone="paint"))
                for k, dx in enumerate((-0.28, 0.28)):
                    out.append(kp.hex_bolt(f"a3_skb{tag}{i}{k}", (xc + dx, s * (2.24 + 0.04), 1.75), (0, s, 0),
                                           across=0.026, height=0.01))
                    # struts in and down from the plate's back to the fender or the track
                    a0 = Vector((xc + dx, s * (2.24 - 0.04), 1.40))
                    d = Vector((0, -s, -0.45)).normalized()
                    hit = _toward(H.all, a0, d, a0 + d * 2.0)
                    if (hit - a0).length < 0.9:
                        out += kp.strut(f"a3_skst{tag}{i}{k}", a0, hit, t=0.03, pad=0)
        # the rear slat stands 6 cm clear of the rear corners (the mock's
        # x -3.25 was 3.5 cm inside them at |y| 0.7)
        rear = min(_toward(hull, (-20, y, z), (1, 0, 0), (9, y, z)).x for y in (-1.2, -0.7, 0.7, 1.2) for z in (1.3, 1.7, 2.1))
        xr = min(-3.25, rear - 0.06)
        out += _cage(H, "a3_", [("rr", (xr, 1.40), (xr, -1.40), 1.10, 2.20, {})], (1.45, 1.95), rear_reach=0.9)
        return out

    def s1():
        out = [kp.chamfered_box("s1_bar", (0.22, 1.80, 0.12), kp.place((-0.55, 0.0, croof + 0.08)), tone="metal",
                                chamfer=0.01)]
        for i in range(4):
            y = -0.75 + 0.5 * i
            out.append(kp.camera_head(f"s1_l{i}", (0.14, 0.22, 0.16), kp.place((-0.45, y, croof + 0.20)),
                                      window=(0.13, 0.08), centre=(0.0, 0.0)))
        for k, y in enumerate((-0.6, 0.6)):
            g = H.top(-0.55, y, croof - 0.2)
            out.append(kp.plain_box(f"s1_foot{k}", (0.12, 0.08, croof + 0.02 - g + 0.02),
                                    kp.place((-0.55, y, (croof + 0.02 + g) / 2)), tone="metal",
                                    drop=((0, 0, 1), (0, 0, -1)), mount=True))
        return out

    def s2():
        return _mast_head(H, "s2", (-1.45, 0.75), croof + 0.80, (0.06, 0.047), 0.09, ball=0.16, sections=2, bolts=0)

    def s3():
        rc = Vector((-0.30, 0.0, croof + 0.24))
        out = kp.radar_array("s3_rad", kp.place(rc, ry=-10), (0.10, 0.85, 0.36), hinge_knuckle=False)
        for k, y in enumerate((-0.25, 0.25)):
            g = H.top(-0.30, y, croof - 0.2)
            out.append(kp.tube(f"s3_leg{k}", (-0.30, y, rc.z - 0.16), (-0.30, y, g - 0.01), 0.02, sides=6,
                               cap0=False, cap1=False, ground=True))
        out += _mast_head(H, "s3", (-1.45, -0.75), croof + 1.30, (0.06, 0.047, 0.034), 0.09, drum=(0.18, 0.22),
                          bolts=0, drum_sides=10)
        return out

    return [
        ("armour", 1, "hull_hull", "cab window grilles", a1),
        ("armour", 2, "hull_hull", "slat cage round the cab", a2),
        ("armour", 3, "hull_hull", "track-top skirt plates + rear slat round the ripper", a3),
        ("sensors", 1, "hull_hull", "work-light bar with IR camera heads", s1),
        ("sensors", 2, "hull_hull", "remote-operation camera mast", s2),
        ("sensors", 3, "hull_hull", "forward obstacle radar + a second camera mast", s3),
    ]


# ---------------------------------------------------------------------------
# heli_peten (the model's own metres, ~0.28 of an airframe -- spec 2.4)
# ---------------------------------------------------------------------------

def parts_heli_peten(H):
    if not isinstance(H, Hull):
        raise TypeError("pass a kit_blockout.Hull")
    gun = barrel(H, "hull_metal", 0.55)
    hull = H.hull

    def a1():
        out = []
        for tag, s in (("L", 1), ("R", -1)):
            # the cockpit side is 7 cm OUTSIDE the mock's plates (they were buried)
            out += _side_plate(H, f"a1_p{tag}", (0.55, 0.03, 0.22), (0.42, s * 0.25, 0.74), s,
                               bolts=((-0.38, 0.0), (0.38, 0.0)), max_out=0.15)
        return out

    def a2():
        out = []
        size = (0.55, 0.18, 0.16)
        for tag, s in (("L", 1), ("R", -1)):
            M = kp.place((-0.30, s * 0.35, 0.95), ry=-10)
            d, _g = _seat_shift(hull, M, size, (0, 0, -1))
            M = _shifted(M, (0, 0, -1), d)
            out.append(kp.chamfered_box(f"a2_ir{tag}", size, M, tone="paint", chamfer=0.01, drop=((0, 0, -1),)))
            for k, u in enumerate((-0.2, 0.2)):
                out.append(kp.hex_bolt(f"a2_b{tag}{k}", M @ Vector((u, 0.0, 0.08)), M.to_3x3() @ Vector((0, 0, 1)),
                                       across=0.02, height=0.008))
        return out

    def a3():
        out = []
        for tag, s in (("L", 1), ("R", -1)):
            M = kp.place((0.95, s * 0.31, 0.42))
            d, _g = _seat_shift(hull, M, (0.90, 0.12, 0.20), (0, -s, 0), max_out=0.0)
            M = _shifted(M, (0, -s, 0), d)
            out.append(kp.wedge(f"a3_sp{tag}", (0.90, 0.12, 0.20), M, tone="paint", setback=0.10, drop=((0, -s, 0),)))
            n_out = (M.to_3x3() @ Vector((0, s, 0))).normalized()
            for k, u in enumerate((-0.28, 0.12)):
                out.append(kp.hex_bolt(f"a3_spb{tag}{k}", M @ Vector((u, s * 0.06, 0.0)), n_out, across=0.02,
                                       height=0.008))
        size = (1.30, 0.42, 0.05)
        M = kp.place((0.60, 0.0, 0.12))
        d, _g = _seat_shift(hull, M, size, (0, 0, 1), max_out=0.0)
        M = _shifted(M, (0, 0, 1), d)
        out.append(kp.chamfered_box("a3_fl", size, M, tone="paint", chamfer=0.01, drop=((0, 0, 1),)))
        for k, (u, v) in enumerate(((-0.55, -0.15), (0.55, -0.15), (-0.55, 0.15), (0.55, 0.15))):
            out.append(kp.hex_bolt(f"a3_flb{k}", M @ Vector((u, v, -0.025)), (0, 0, -1), across=0.02, height=0.008))
        return out

    def s1():
        c = Vector((1.98, 0.0, 0.42))
        prof = [(-0.15, 0.13), (-0.14, 0.14), (0.14, 0.14), (0.15, 0.13)]
        out = [kp.lathe("s1_tads", [(t + 0.15, r) for t, r in prof], c - Vector((0, 0.15, 0)), (0, 1, 0), sides=12,
                        tones=["metal"] * 3)]
        out.append(kp.chamfered_box("s1_win", (0.03, 0.20, 0.12), kp.place((c.x + 0.13, c.y, c.z)), tone="dark",
                                    chamfer=0.006))
        out.append(kp.chamfered_box("s1_hub", (0.10, 0.10, 0.08), kp.place((c.x - 0.10, c.y, c.z + 0.10)), tone="metal",
                                    chamfer=0.008))
        return out

    def s2():
        out = []
        for i, (x, y) in enumerate([(1.30, 0.20), (1.30, -0.20), (-1.40, 0.14), (-1.40, -0.14)]):
            z = 0.80
            if x < 0:
                # the tail boom is ~0.1 m wide here: the mock's heads (|y| 0.14,
                # z 0.80) hung in the air beside it; they sit ON the boom
                half = H.side(x, 0.55, 1, 0.10)
                y = math.copysign(min(abs(y), half * 0.6), y)
                z = H.top(x, y, 0.6, hull) + 0.05 - 0.004
            look = Vector((math.copysign(1, x), math.copysign(0.8, y), 0)).normalized()
            M = kp.frame((x, y, z), look)
            out.append(kp.chamfered_box(f"s2_maw{i}", (0.10, 0.10, 0.10), M, tone="metal", drop=((0, 0, -1),)))
            out.append(kp.plain_box(f"s2_lens{i}", (0.012, 0.06, 0.05), M @ kp.place((0.054, 0.0, 0.005)), tone="dark",
                                    drop=((-1, 0, 0),)))
        for tag, s in (("L", 1), ("R", -1)):
            y = s * 0.46
            out.append(kp.tube(f"s2_ew{tag}", (0.12, y, 0.50), (0.48, y, 0.50), 0.04, sides=6))
            a0 = Vector((0.30, y - s * 0.035, 0.50))
            hit = _toward(H.all, a0, (0, -s, 0), a0 - Vector((0, s * 0.2, 0)))
            if (hit - a0).length < 0.4:
                out.append(kp.bar(f"s2_ewst{tag}", a0, hit - Vector((0, s * 0.01, 0)), 0.025, tone="metal", mount=True))
        return out

    def s3():
        out = kp.sensor_ball("s3_ball", (-1.05, 0.0, 0.88), 0.12, segments=10, rings=6, yoke=True)
        g = H.top(-1.05, 0.0, 0.7, hull)
        out.append(kp.tube("s3_post", (-1.05, 0.0, 0.88 - 0.12 * 0.9), (-1.05, 0.0, g - 0.01), 0.03, sides=8,
                           cap0=False, cap1=False, ground=True))
        # the fairing sits ON the engine hump, under the rotor disc
        g2 = H.top(-0.40, 0.0, 1.0, hull)
        out += kp.armour_plate("s3_fair", (0.36, 0.20, 0.10), kp.place((-0.40, 0.0, g2 + 0.05 - 0.004)), tone="metal",
                               panel_inset=0.04)
        return out

    def f1():
        x0, x1, gy, gz = gun
        r_in = min(_barrel_r(H, "hull_metal", gun, x1 - 0.05) * 0.97, 0.028)
        out = kp.barrel_shroud("f1_sh", gy, gz, x0 + (x1 - x0) * 0.15, x0 + (x1 - x0) * 0.85, 0.045, 0.056, r_in,
                               sides=8)
        xa = x1 - 0.06
        prof = [(xa, 0.03), (x1 + 0.22 + 0.24, 0.03), (x1 + 0.22 + 0.24, 0.036), (x1 + 0.22 + 0.275, 0.036)]
        out.append(kp.lathe("f1_brl", [(x - xa, r) for x, r in prof], (xa, gy, gz), (1, 0, 0), sides=8,
                            tones=["metal"] * 3, cap0=False, cap1=True))
        return out

    def f2():
        M = kp.place((0.45, 0.0, 0.16))
        out = kp.ammo_box("f2_mag", (0.70, 0.24, 0.17), M, lid_h=0.03, handle=False)
        out += kp.feed_chute("f2_chute", [(0.85, 0.0, 0.20), (1.10, 0.0, 0.20), (1.33, 0.0, 0.215)], w=0.06)
        return out

    def f3():
        x0, x1, gy, gz = gun
        c = Vector((x0 - 0.05, gy, gz + 0.02))
        prof = [(-0.13, 0.15), (-0.11, 0.17), (0.09, 0.17), (0.13, 0.13)]
        return [kp.lathe("f3_turret", [(t + 0.13, r) for t, r in prof], c - Vector((0, 0, 0.13)), (0, 0, 1), sides=14,
                         tones=["metal"] * 3),
                kp.chamfered_box("f3_sight", (0.03, 0.10, 0.05), kp.place((c.x + 0.165, c.y, c.z + 0.05)), tone="dark",
                                 chamfer=0.005)]

    return [
        ("armour", 1, "hull_hull", "cockpit side armour panels", a1),
        ("armour", 2, "hull_hull", "engine-bay armour panels", a2),
        ("armour", 3, "hull_hull", "armoured sponson fairings + floor plate", a3),
        ("sensors", 1, "hull_glass", "enlarged nose sensor turret", s1),
        ("sensors", 2, "hull_hull", "four warning-sensor heads + two sensor pods", s2),
        ("sensors", 3, "hull_hull", "sensor ball on the boom + sensor fairing on the engine hump", s3),
        ("firepower", 1, "hull_metal", "chin-gun barrel extension with a shroud", f1),
        ("firepower", 2, "hull_metal", "ammunition magazine pod + feed chute", f2),
        ("firepower", 3, "hull_metal", "enlarged chin-turret housing", f3),
    ]


PARTS_DETAILED = {"mbt_lavi": parts_mbt_lavi, "ifv_namer": parts_ifv_namer,
                  "apc_eitan": parts_apc_eitan, "apc_kipod": parts_apc_kipod,
                  "scout_shachaf": parts_scout_shachaf, "jeep_shoded": parts_jeep_shoded,
                  "dozer_d9": parts_dozer_d9, "heli_peten": parts_heli_peten}
