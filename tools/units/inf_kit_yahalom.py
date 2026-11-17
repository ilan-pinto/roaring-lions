"""inf_kit_yahalom.py -- the Yahalom Engineers' own kit builders (GH-826, infantry upgrade unit "Yahalom").

Blender-only. `inf_kit.build` asks this module first for a team whose row names it (`Team.own_builders`); a part it
does not build falls through to the v7 set and the procedural builders, as on every other team.

Two kinds of part:
  * what stands on the team's BASE GEAR (`yahalom_gear.py`: the assault pack, the stowed detector), read back from the
    file's `extras.rl_gear`: yah_b's radio pouch on his pack's left side and his whips off its top (the 30 Oct "baked
    gear wins" rule: the pack holds the back radio's slot), and yah_a's mast sensor on the detector's search head;
  * the specialist items of the lead's approval of 30 Oct 2026: the respirator carrier on the left thigh (armour 2),
    the headlamp on the left helmet rail (sensors 1), the gas detector on the right carrier strap (sensors 2).
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
from yahalom_gear import soft_box, strip

GAP = v7.GAP
UP = Vector((0.0, 0.0, 1.0))

#: APPROVED (30 Oct, the seven-teams spec's table; the plan of 15 Nov, section 2): height, width, depth.
RESPIRATOR = (0.22, 0.16, 0.10)
HEADLAMP = (0.065, 0.040, 0.035)        # length along the rail, height, depth off the shell
GAS_DETECTOR = (0.11, 0.07, 0.04)
GAS_DETECTOR_TOP_Z = 1.40               # the kit's torso metres (`Fit.tz`): "right carrier strap, about 1.40 m"
MAST_SENSOR = (0.10, 0.08, 0.08)
#: CARRIED: the pack's shoulder strap stands this far off the spine's line (`yahalom_gear.PACK_STRAP`), and the baked
#: carrier's strap under it: the "right carrier strap".
STRAP_Y = 0.085
#: REAL (not in the plan): the respirator's flap and its one thigh strap, the lamp's lens, the detector's display.
RESPIRATOR_RADIUS = 0.028
RESPIRATOR_FLAP = dict(height=0.075, proud=0.004)
RESPIRATOR_STRAP = dict(width=0.030, thick=0.004, off=0.004, up=0.055, points=14)     # `up`: over the carrier's lower edge
HEADLAMP_LENS_R = 0.015
GAS_DISPLAY = (0.040, 0.034)             # height, width, on the upper half of its face
MAST_LENS_R = 0.026


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
    soft_box(pc, c, Rm, (D_, W_, L_), 0.014, "olive_dark", segs=2)
    geo.lathe(pc, c + Rm.col[2] * (L_ / 2.0 - 0.001), Rm.col[2], Rm.col[0], [(0.0, MAST_LENS_R + 0.006), (0.010, MAST_LENS_R + 0.006), (0.010, MAST_LENS_R)],
              12, "olive_dark", cap1="glass")
    # the clamp on the head's spar
    soft_box(pc, hc + out * (d["head_thick"] / 2.0 + GAP / 2.0), Rm, (GAP + 0.012, 0.050, 0.050), 0.004, "olive_dark", segs=1)
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


def build_respirator(f, side=None):
    """The gas-mask carrier on the LEFT outer thigh (the rig's `thigh_R`), its top at the belt's lower edge."""
    H, W, D = RESPIRATOR
    bone = f.bones[f"{f.prefix}_thigh_R"]
    hx, hy = float(bone.head_local.x), float(bone.head_local.y)
    z_top = 0.9125 + f.belt_dz - 0.0275
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
    fl = RESPIRATOR_FLAP
    soft_box(pc, centre + R @ Vector((fl["proud"] / 2.0, 0.0, H / 2.0 - fl["height"] / 2.0)), R,
             (D + fl["proud"], W + 2 * fl["proud"], fl["height"]), RESPIRATOR_RADIUS, "olive_dark", segs=2)
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
    v7._stats(f, name="respirator", top_z=round(z_top, 3), at=[round(float(x), 3) for x in centre], strap_points=len(pts))
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
    """The multi-gas clip on the RIGHT carrier strap, its top at the kit's 1.40 m."""
    H, W, D = GAS_DETECTOR
    _cx, cy = v7._centre_xy(f)
    zc = f.tz(GAS_DETECTOR_TOP_Z) - H / 2.0
    y = cy - STRAP_Y
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
    v7._stats(f, name="gas_detector", on=on, at=[round(float(v), 3) for v in centre])
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
