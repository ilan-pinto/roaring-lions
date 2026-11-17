"""inf_kit_yahalom.py -- the Yahalom Engineers' own kit builders (GH-826, infantry upgrade unit "Yahalom").

Blender-only. `inf_kit.build` asks this module first for a team whose row names it (`Team.own_builders`); a part it
does not build falls through to the v7 set and the procedural builders, as on every other team.

Two kinds of part:
  * what stands on the team's BASE GEAR (`yahalom_gear.py`: the assault pack, the stowed detector), read back from the
    file's `extras.rl_gear`: yah_b's radio pouch on his pack's left side and his whips off its top (the 30 Oct "baked
    gear wins" rule: the pack holds the back radio's slot), and yah_a's mast sensor on the detector's search head;
  * the specialist items of the lead's approval of 30 Oct 2026: the respirator carrier on the left thigh (armour 2),
    the headlamp on the left helmet rail (sensors 1), the gas detector on the LEFT carrier strap (sensors 2; the lead's
    ruling of 17 Nov 2026: on the right it lay under the firing forearm in every clip, seen from no heading).
Sizes and places are the approved ones (`inf_kit_parts._YAHALOM_PARTS`); what is chosen here beside them is listed in
the sheet's README for the lead. No mathutils.noise.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import inf_kit as ik
import inf_kit_geo as geo
import inf_kit_mesh as km
import inf_kit_parts as kp
import inf_kit_v7 as v7
from inf_kit_geo import Piece
from yahalom_gear import plain_box, soft_box, strip

GAP = v7.GAP
UP = Vector((0.0, 0.0, 1.0))

#: APPROVED (30 Oct, the seven-teams spec's table; the plan of 15 Nov, section 2): height, width, depth.
RESPIRATOR = (0.22, 0.16, 0.10)
HEADLAMP = (0.065, 0.040, 0.035)        # length along the rail, height, depth off the shell
GAS_DETECTOR = (0.11, 0.07, 0.04)
GAS_DETECTOR_TOP_Z = 1.40               # the kit's torso metres (`Fit.tz`): "carrier strap, about 1.40 m"
#: RULED (17 Nov 2026, the round-1 review's row 12b): the LEFT strap, top at 1.40 m. On the right (the 30 Oct place) it lay
#: 7-19 mm inside the firing forearm in every clip, idle included, and showed from no heading. On the left the support
#: upper arm covers it in the aimed clips alone, and comes into it there: how deep is a named ceiling per man, under the
#: ruling's 20 mm, held by `tools/test_yahalom_gear_standoff.py` (`gas_detector`). +1: the man's left (Blender +y).
GAS_DETECTOR_SIDE = +1.0
MAST_SENSOR = (0.10, 0.08, 0.08)        # APPROVED envelope. RULED (17 Nov, row 13): a camera cylinder 80 mm across, 100 mm long
#: The CARRIER's shoulder strap: this far either side of the spine's line (`yahalom_gear.PACK_STRAP["y"]`, the nearest a
#: pack strap may lie to it, is the same literal). It is NOT where the pack's shoulder strap ended up: that was moved
#: outboard until its inner edge cleared the collar (0.150 on yah_a, 0.145 on yah_b), so the gas detector sits 65 / 60 mm
#: medial of the pack's strap, on the plate carrier's own (round 1's comment here said "the pack's shoulder strap": stale).
STRAP_Y = 0.085
#: REAL (not in the plan): the respirator's flap and its one thigh strap, the lamp's lens, the detector's display.
RESPIRATOR_RADIUS = 0.028
#: RULED (17 Nov, row 10b): its top 85 mm under the belt's lower edge, a drop-leg carrier (at the belt it stood 14-36 mm
#: in the firepower-3 grenade pouches and 6-13 mm in the battle belt).
RESPIRATOR_DROP = 0.085
#: The flap stands `proud` of the carrier's body on its three free sides and its top, all the way down to its hem (round
#: 1's was a second rounded box: its lower corners curved back INTO the body and met it in a sawtooth). `tools/
#: test_inf_kit_parts.py`-style reading in the kit export's log: `flap_proud_mm`, the least of it over the hem's free sides.
RESPIRATOR_FLAP = dict(height=0.075, proud=0.004)
RESPIRATOR_STRAP = dict(width=0.030, thick=0.004, off=0.004, up=0.055, points=14)     # `up`: over the carrier's lower edge
HEADLAMP_LENS_R = 0.015
GAS_DISPLAY = (0.040, 0.034)             # height, width, on the upper half of its face
MAST_LENS_R = 0.026
MAST_BEZEL = 0.006                       # RULED with the cylinder: "lens on the end (r 26 mm, a 6 mm bezel) and a seam ring"
MAST_SIDES = 12


def _gear(f):
    g = bpy.context.scene.get("rl_gear")
    if g is None:
        raise ValueError(f"{f.prefix}: the file carries no `rl_gear` (the importer stamps it): nothing for the kit to stand on")
    g = g.to_dict() if hasattr(g, "to_dict") else g
    if f.prefix not in g["figures"]:
        raise ValueError(f"{f.prefix}: `rl_gear` has no row for him")
    return g["figures"][f.prefix]


def _pack(f):
    p = _gear(f)["pack"]
    o = Vector(p["origin"]) + Vector((float(f.O[0]), float(f.O[1]), 0.0))
    return o, Matrix(p["R"]), p["bag"]


def _frame(out, up=UP):
    out = Vector(out).normalized()
    u = (Vector(up) - out * Vector(up).dot(out)).normalized()
    across = u.cross(out).normalized()
    return Matrix((out, across, u)).transposed()


# ------------------------------------------------------------------ on the pack

def build_radio_pouch(f, side=None):
    """The v7 radio pouch, its back on the pack's LEFT side face, its middle at the pack's (the plan, section 2)."""
    o, R, (bd, bw, _bh) = _pack(f)
    n = -R.col[1]                                    # the pack's left: R's +y is the man's right
    c = o + R @ Vector((bd / 2.0, -bw / 2.0, 0.0))
    V0, T = km.source("radio_pouch")
    V0 = V0 - np.array([0.0, 0.0, 0.5 * (V0[:, 2].min() + V0[:, 2].max())])
    V = km.place(V0, np.array(c + n * GAP), np.array(n), np.array(R.col[2]))
    v7._stats(f, name="radio_pouch", on="pack", at=[round(float(x), 3) for x in c])
    pc = Piece(f.world())
    v7.add_mesh(pc, V, T, "olive")
    return pc


def _whip_base(f):
    o, R, (bd, bw, bh) = _pack(f)
    return o + R @ Vector((bd / 2.0, -(bw / 2.0 - 0.045), bh / 2.0))


def build_whip_short(f, side=None):
    pc = Piece(f.world())
    ik._whip(pc, _whip_base(f), 8.0, 0.85)
    return pc


def build_whip_long(f, side=None):
    pc = Piece(f.world())
    ik._whip(pc, _whip_base(f), 8.0, 1.25)
    return pc


def build_mast_sensor(f, side=None):
    """The probe camera head, clamped on the stowed detector's search head, its lens up the rod."""
    d = _gear(f).get("detector")
    if d is None:
        raise ValueError(f"{f.prefix}: no stowed detector in `rl_gear`: the mast sensor has nothing to ride")
    hc = Vector(d["head_centre"]) + Vector((float(f.O[0]), float(f.O[1]), 0.0))
    out = Vector(d["head_out"]).normalized()
    _o, R, _bag = _pack(f)
    Rm = _frame(out, R.col[2])
    L_, W_, D_ = MAST_SENSOR
    c = hc + out * (d["head_thick"] / 2.0 + GAP + D_ / 2.0)
    pc = Piece(f.world())
    # a camera cylinder W_ across and L_ long, its axis up the rod, the lens on its upper end: the barrel, a seam groove
    # two fifths up it, a chamfer to the bezel, the bezel's face, the lens set 4 mm into it (round 1: a rounded box with
    # the lens let INTO its top, which read as a jar)
    r = W_ / 2.0
    rb = MAST_LENS_R + MAST_BEZEL
    geo.lathe(pc, c - Rm.col[2] * (L_ / 2.0), Rm.col[2], Rm.col[0],
              [(0.0, r), (0.040, r), (0.043, r - 0.0025), (0.046, r), (L_ - 0.006, r), (L_, rb), (L_, MAST_LENS_R), (L_ - 0.004, MAST_LENS_R)],
              MAST_SIDES, ["olive_dark", "glass", "glass", "olive_dark", "olive_dark", "olive", "olive_dark"], cap0="olive_dark", cap1="glass")
    # the clamp on the head's spar
    plain_box(pc, hc + out * (d["head_thick"] / 2.0 + GAP / 2.0), Rm, (GAP + 0.012, 0.050, 0.050), "olive_dark")
    v7._stats(f, name="mast_sensor", shape="cylinder", across_mm=round(1000 * W_, 1), long_mm=round(1000 * L_, 1), lens_r_mm=round(1000 * MAST_LENS_R, 1))
    return pc


# ------------------------------------------------------------------ the specialist items

def _thigh_zone(f, bone):
    key = ("thigh", bone)
    c = v7._cache(f)
    if key not in c:
        ok = f.wz(bone, 0.5) & f.mine
        t = f.tris[ok[f.tris].all(1)]
        if len(t) < 20:
            raise ValueError(f"{f.prefix}: {len(t)} triangles of the {bone} zone: the respirator has no thigh to hang on")
        c[key] = geo.bvh_from(f.co, t)
    return c[key]


def _respirator_flap(pc, centre, R, size):
    """The carrier's flap: a cap over the body's upper RESPIRATOR_FLAP["height"], `proud` of it on its outer face, its two
    sides and its top, straight down to an open hem (a ring closes the hem back to the body). The thigh side is flush, less
    half a millimetre (it lies against the leg). Returns the least distance, mm, from the hem's free edge to the body's wall."""
    D, W, H = size
    fl = RESPIRATOR_FLAP
    p, r, segs = fl["proud"], RESPIRATOR_RADIUS, 2
    c = Vector(centre)
    a_out, a_in, b = D / 2.0 + p, D / 2.0 - 0.0005, W / 2.0 + p        # local x: +out of the thigh; y across; z up
    h = H / 2.0 + p
    rr0 = r + p

    def ring(z, inset):
        rr = max(rr0 - inset, 0.0)
        pts = []
        for cx, cy, a0 in ((a_out - inset - rr, b - inset - rr, 0.0), (-(a_in - inset) + rr, b - inset - rr, 90.0),
                           (-(a_in - inset) + rr, -(b - inset) + rr, 180.0), (a_out - inset - rr, -(b - inset) + rr, 270.0)):
            for i in range(segs + 1):
                t = math.radians(a0 + 90.0 * i / segs)
                pts.append(c + R @ Vector((cx + rr * math.cos(t), cy + rr * math.sin(t), z)))
        return pts
    z_hem = H / 2.0 - fl["height"]
    rings = [ring(z_hem, 0.0), ring(h - rr0, 0.0)]
    for i in range(1, segs + 1):
        t = 0.5 * math.pi * i / segs
        rings.append(ring(h - rr0 + rr0 * math.sin(t), rr0 - rr0 * math.cos(t)))
    n = len(rings[0])
    for A, B in zip(rings[:-1], rings[1:]):
        for k in range(n):
            k2 = (k + 1) % n
            pc.face([A[k], A[k2], B[k2], B[k]], "olive_dark")
    pc.face(rings[-1], "olive_dark")
    # the hem: from the flap's lower edge in to the body's own section at that height
    body = []
    for cx, cy, a0 in ((D / 2.0 - r, W / 2.0 - r, 0.0), (-(D / 2.0 - r), W / 2.0 - r, 90.0), (-(D / 2.0 - r), -(W / 2.0 - r), 180.0), (D / 2.0 - r, -(W / 2.0 - r), 270.0)):
        for i in range(segs + 1):
            t = math.radians(a0 + 90.0 * i / segs)
            body.append(c + R @ Vector((cx + r * math.cos(t), cy + r * math.sin(t), z_hem)))
    for k in range(n):
        k2 = (k + 1) % n
        pc.face([body[k], body[k2], rings[0][k2], rings[0][k]], "olive_dark")
    # how proud the hem's free edge stands: each of its points whose local x is ahead of the body's middle, to the body's
    # rounded-rectangle section (the same radius everywhere along the body's straight walls)
    Rt = R.transposed()
    least = None
    for q in rings[0]:
        l = Rt @ (q - c)
        if l.x < 0.0:
            continue                          # the thigh side: flush by design
        dx, dy = max(abs(l.x) - (D / 2.0 - r), 0.0), max(abs(l.y) - (W / 2.0 - r), 0.0)
        dist = math.hypot(dx, dy) - r if (dx > 0.0 or dy > 0.0) else -min(D / 2.0 - abs(l.x), W / 2.0 - abs(l.y))
        least = dist if least is None or dist < least else least
    return round(1000 * least, 2)


def build_respirator(f, side=None):
    """The gas-mask carrier on the LEFT outer thigh (the rig's `thigh_R`), its top RESPIRATOR_DROP under the belt's lower edge."""
    H, W, D = RESPIRATOR
    bone = f.bones[f"{f.prefix}_thigh_R"]
    hx, hy = float(bone.head_local.x), float(bone.head_local.y)
    z_top = 0.9125 + f.belt_dz - 0.0275 - RESPIRATOR_DROP
    zc = z_top - H / 2.0
    zone = _thigh_zone(f, "thigh_R")
    c, n = km.surf_frame([zone, f.zone_lower], np.array([hx, hy, zc]), (0, -1, 0), 0.03, 0.05)
    if c is None:
        raise ValueError(f"{f.prefix}: no outer thigh at z {zc:.3f}")
    n = Vector((float(n[0]), float(n[1]), 0.0)).normalized()
    R = _frame(n)
    centre = Vector(c) + n * (GAP + D / 2.0)
    pc = Piece(f.world())
    soft_box(pc, centre, R, (D, W, H), RESPIRATOR_RADIUS, "olive")
    proud = _respirator_flap(pc, centre, R, (D, W, H))
    # the thigh strap: a ring on the thigh's own surface, `up` over the carrier's lower edge
    st = RESPIRATOR_STRAP
    zs = z_top - H + st["up"]
    axis = Vector((hx, hy, zs))
    pts, nrm = [], []
    for k in range(st["points"] + 1):
        a = 2.0 * math.pi * k / st["points"]
        d = Vector((math.cos(a), math.sin(a), 0.0))
        hit = zone.ray_cast(axis + d * 0.35, -d, 0.35)
        if hit[0] is None:
            continue
        pts.append(hit[0] + d * st["off"]); nrm.append(d)
    if len(pts) >= st["points"] - 2:
        strip(pc, pts, nrm, UP, st["width"], st["thick"], "olive_dark")
    v7._stats(f, name="respirator", top_z=round(z_top, 3), under_belt_mm=round(1000 * RESPIRATOR_DROP, 1), at=[round(float(x), 3) for x in centre],
              strap_points=len(pts), flap_proud_mm=proud)
    print(f"[inf_kit] {f.prefix}: respirator top at z {z_top:.3f} ({1000 * RESPIRATOR_DROP:.0f} mm under the belt's lower edge); its flap's hem stands "
          f"{proud:.2f} mm proud of the body at its least, the three free sides (ruled: at least 2 mm)")
    if proud < 2.0:
        raise ValueError(f"{f.prefix}: the respirator's flap stands {proud:.2f} mm proud at its least: under the ruled 2 mm")
    return pc


def build_headlamp(f, side=None):
    """The helmet light on the LEFT rail, its rear face against the headset cup's front edge, the lens ahead."""
    L_, H_, D_ = HEADLAMP
    _inner, zc, dx = ik.HEADSET_AT
    if kp.TEAM.headset_below_rim is not None:
        zc = f.hel_bot - kp.TEAM.headset_below_rim
    zc += v7._headset_lift(f)
    zp = zc + 0.075                                  # the rail: the cup's own pivot height (`inf_kit_v7._headset_at`)
    cup_half = 0.070 / 2.0                           # the v7 cup is 0.070 fore and aft
    x = f.O[0] + f.hel_c.x + dx + cup_half + GAP + L_ / 2.0
    cy = f.O[1] + f.hel_c.y
    loc, n = geo.surface_hit(f.zone_helmet, Vector((x, cy + 0.5, zp)), (0, -1, 0))
    if loc is None:
        loc, n = geo.surface_hit(f.zone_all, Vector((x, cy + 0.5, zp)), (0, -1, 0))
    if loc is None:
        raise ValueError(f"{f.prefix}: no helmet side at x {x:.3f} z {zp:.3f}")
    n = Vector((n.x, n.y, 0.0)).normalized()
    fwd = (Vector((1.0, 0.0, 0.0)) - n * n.x).normalized()
    up = n.cross(fwd).normalized()
    if up.z < 0:
        up = -up
    R = Matrix((n, fwd, up)).transposed()
    c = loc + n * (GAP + D_ / 2.0)
    pc = Piece(f.world())
    soft_box(pc, c, R, (D_, L_, H_), 0.008, "olive_dark", segs=2)
    geo.lathe(pc, c + fwd * (L_ / 2.0 - 0.002), fwd, up, [(0.0, HEADLAMP_LENS_R + 0.003), (0.008, HEADLAMP_LENS_R + 0.003), (0.008, HEADLAMP_LENS_R)],
              10, "olive_dark", cap1="glass")
    v7._stats(f, name="headlamp", at=[round(float(v), 3) for v in c], rail_z=round(zp, 3))
    return pc


def build_gas_detector(f, side=None):
    """The multi-gas clip on the LEFT carrier strap, its top at the kit's 1.40 m."""
    H, W, D = GAS_DETECTOR
    _cx, cy = v7._centre_xy(f)
    zc = f.tz(GAS_DETECTOR_TOP_Z) - H / 2.0
    y = cy + GAS_DETECTOR_SIDE * STRAP_Y
    cb = v7.carrier_hull(f)[2]
    c, n = v7._front_frame(f, [cb], y, zc)
    on = "carrier"
    if c is None:
        c, n = v7._front_frame(f, [f.zone_torso], y, zc)
        on = "body"
    if c is None:
        raise ValueError(f"{f.prefix}: no chest at y {y:.3f} z {zc:.3f}")
    n = Vector((float(n[0]), float(n[1]), float(n[2]))).normalized()
    R = _frame(n)
    centre = Vector(c) + n * (GAP + D / 2.0)
    pc = Piece(f.world())
    soft_box(pc, centre, R, (D, W, H), 0.010, "olive_dark", segs=2)
    dh, dw = GAS_DISPLAY
    soft_box(pc, centre + R @ Vector((D / 2.0, 0.0, H / 4.0)), R, (0.004, dw, dh), 0.0015, "glass", segs=1)
    # the sensor ports under the display: three small caps
    for k in (-1, 0, 1):
        geo.lathe(pc, centre + R @ Vector((D / 2.0 - 0.001, k * 0.020, -H / 4.0)), R.col[0], R.col[2], [(0.0, 0.007), (0.003, 0.007)], 8, "olive", cap1="glass")
    v7._stats(f, name="gas_detector", on=on, side="left" if GAS_DETECTOR_SIDE > 0 else "right", at=[round(float(v), 3) for v in centre])
    print(f"[inf_kit] {f.prefix}: gas detector on the {'LEFT' if GAS_DETECTOR_SIDE > 0 else 'RIGHT'} carrier strap ({on}), its top at z {centre.z + H / 2.0:.3f}")
    return pc


BUILDERS = {
    "radio_pouch": build_radio_pouch,
    "whip_short": build_whip_short,
    "whip_long": build_whip_long,
    "mast_sensor": build_mast_sensor,
    "respirator": build_respirator,
    "headlamp": build_headlamp,
    "gas_detector": build_gas_detector,
}
