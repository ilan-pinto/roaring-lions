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
               sides=8, tree=None):
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
        out += kp.eo_drum(f"{prefix}_drum", xy, top - 0.004, r=r, h=dh, sides=12)
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


PARTS_DETAILED = {"mbt_lavi": parts_mbt_lavi, "ifv_namer": parts_ifv_namer,
                  "apc_eitan": parts_apc_eitan, "apc_kipod": parts_apc_kipod}
