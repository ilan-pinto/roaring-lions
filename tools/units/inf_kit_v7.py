"""The v7 kit parts fitted to the Meshy Rifle Squad (GH-746 / GH-826). Blender only.

`inf_kit.build` swaps a part's procedural builder for the one here when `kp.TEAM.v7` is set (the Rifle Squad). Each builder
keeps the signature `(f, side) -> Piece` and REUSES the procedural builder's own anchor maths (the weapon frame and rail,
the helmet front, the belt wrap, the pouch clearing turn), swapping only the geometry: the approved part from
`art/parts/inf_kit/v7/<part>.glb` placed by `inf_kit_mesh`. The parts not in v7 (helmet cover, yoke, foregrip, the two
whips) stay procedural.

Soft goods on the skinned torso (carrier, belt) are scaled per axis to THIS figure's own ring and pushed out of the body
to a clearance; the throat and the groin hang from the FITTED carrier (its collar and its hem) and are checked not to
cross it; pouches, the radio and the phone case stand on the fitted belt / carrier / body by their back faces.
Every vertex stays rigid on the row's one bone (weight 1), every UV is pinned to the row's texel: no material, no texture.
"""
import math

import numpy as np
from mathutils import Matrix, Vector

import inf_kit as ik
import inf_kit_geo as geo
import inf_kit_mesh as km
import inf_kit_parts as kp
from inf_kit_geo import Piece

# ------------------------------------------------------------ constants

CARRIER_TOP, CARRIER_BOT = 1.42, 1.055       # the procedural carrier's rows (CARRIER_ROWS[-1], [0]): collar and hem
CARRIER_NATIVE = (0.2189, 0.2653, 0.4197)    # the part's size (x, y, z)
CARRIER_PLATE = 0.022                        # the plate standoff the spec states (PLATE_OFF)
BODY_CLEAR = 0.006                           # nothing of the carrier within this of the body
BELT_THICK = 0.012                           # the belt's padded thickness (the procedural belt's middle-row offset)
BELT_CLEAR = 0.003
BELT_NATIVE = (0.285, 0.356, 0.0544)
BELT_Z = 0.9125
GAP = 0.001                                  # a placed rigid piece stands this far off the surface it sits on
LENS_DEG = 25.0                              # a face whose normal is within this of the bore, at the extreme end, is glass
UP = (0.0, 0.0, 1.0)


def _cache(f):
    return f.__dict__.setdefault("_v7", {})


def _stats(f, **kw):
    ik.REPORT.append({"part": "v7", "figure": f.prefix, **kw})


# ------------------------------------------------------------ piece making

def lens_faces(V, T, ends):
    """Per face: True when its normal is within LENS_DEG of the bore axis ('+' front, '-' rear) and it sits at that end of the part."""
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    n = np.cross(b - a, c - a)
    ln = np.linalg.norm(n, axis=1)
    n = n / np.maximum(ln, 1e-12)[:, None]
    cen = (a + b + c) / 3.0
    cs = math.cos(math.radians(LENS_DEG))
    out = np.zeros(len(T), bool)
    if "+" in ends:
        out |= (n[:, 0] > cs) & (cen[:, 0] > V[:, 0].max() - 0.006)
    if "-" in ends:
        out |= (n[:, 0] < -cs) & (cen[:, 0] < V[:, 0].min() + 0.006)
    return out


def add_mesh(pc, W, T, tex, glass=None):
    """The world vertices `W` and triangles `T` into `pc`, source winding kept, one texel (`glass` faces the glass texel)."""
    for i, t in enumerate(T):
        pc.face([W[t[0]], W[t[1]], W[t[2]]], "glass" if glass is not None and glass[i] else tex, hint=2)


def count_faces(pc):
    return len(pc.bm.faces)


# ------------------------------------------------------------ the fitted soft goods

def _carrier_ring(f):
    wr = ik.torso_wrap(f, ik.CARRIER_ROWS, 16, fill_below=1.24)
    wr.sample()
    return wr


def _median_radii(wr, rows, ks):
    out = []
    for k in ks:
        vals = [wr.R[j][k] for j in rows if wr.R[j][k] is not None]
        out.append(float(np.median(vals)) if vals else None)
    return out


def carrier_fit(f):
    """(vertices, triangles, bvh) of the carrier fitted to this figure at rest, in world coordinates."""
    c = _cache(f)
    if "carrier" in c:
        return c["carrier"]
    wr = _carrier_ring(f)
    rows = range(1, len(wr.rows_t) - 1)            # the 1.12 .. 1.34 rows: the plate's zone
    rf, rb, rl, rr = _median_radii(wr, rows, (0, 8, 4, 12))
    V0, T = km.source("carrier")
    nx, ny, nz = CARRIER_NATIVE
    sx = (rf + rb + 2 * CARRIER_PLATE) / nx
    sy = (rl + rr + 2 * 0.010) / ny
    sz = (CARRIER_TOP - CARRIER_BOT) / nz
    cen = wr.centre(1.24)
    origin = np.array([cen.x + (rf - rb) / 2.0, cen.y + (rl - rr) / 2.0, CARRIER_TOP])
    V = km.place(V0, origin, (1, 0, 0), UP, (sx, sy, sz))
    V, st = km.ring_fit(wr, V, T, BODY_CLEAR)
    bvh = geo.bvh_from(V, T)
    _stats(f, name="carrier", body_depth_mm=round(1000 * (rf + rb), 1), body_width_mm=round(1000 * (rl + rr), 1),
           scale=[round(sx, 3), round(sy, 3), round(sz, 3)], origin=[round(float(x), 4) for x in origin], **st)
    c["carrier"] = (V, T, bvh)
    return c["carrier"]


def belt_fit(f):
    c = _cache(f)
    if "belt" in c:
        return c["belt"]
    wr = ik._belt_wrap(f, [0.885, 0.9125, 0.94], 16)
    wr.sample()
    rf, rb, rl, rr = _median_radii(wr, (1,), (0, 8, 4, 12))
    V0, T = km.source("battle_belt")
    nx, ny, _nz = BELT_NATIVE
    sx = (rf + rb + 2 * BELT_THICK) / nx
    sy = (rl + rr + 2 * BELT_THICK) / ny
    origin = np.array([f.O[0] + (rf - rb) / 2.0, f.O[1] + (rl - rr) / 2.0, BELT_Z])
    V = km.place(V0, origin, (1, 0, 0), UP, (sx, sy, 1.0))
    V, st = km.ring_fit(wr, V, T, BELT_CLEAR)
    bvh = geo.bvh_from(V, T)
    _stats(f, name="battle_belt", body_depth_mm=round(1000 * (rf + rb), 1), body_width_mm=round(1000 * (rl + rr), 1),
           scale=[round(sx, 3), round(sy, 3), 1.0], **st)
    c["belt"] = (V, T, bvh)
    return c["belt"]


def v7_carrier(f, side=None):
    V, T, _bvh = carrier_fit(f)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote")
    return pc


def v7_battle_belt(f, side=None):
    V, T, _bvh = belt_fit(f)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote_shade")
    return pc


def _front_frame(f, bvhs, y, z, du=0.04, dv=0.04):
    """(point on the outermost surface at height z, abeam y, outward normal) from the +X side."""
    p = np.array([f.O[0], y, z])
    return km.surf_frame(bvhs, p, (-1, 0, 0), du, dv)


def _centre_xy(f):
    cen = _carrier_ring(f).centre(1.24)
    return float(cen.x), float(cen.y)


def _unbend(V0, c):
    """Flatten a curved hanging plate (its inner face a parabola x = -c y^2 about its centre) onto a plane: the carrier's
    front is a plate, and a plate bent round a torso would cross it at both edges (ruling, 9 Nov)."""
    V = V0.copy()
    V[:, 0] += c * V[:, 1] ** 2
    return V


def v7_throat(f, side=None):
    """Hangs from the fitted carrier's collar: top edge at the collar's front top, inner surface on the carrier's front."""
    cv, _ct, cb = carrier_fit(f)
    cx, cy = _centre_xy(f)
    sel = (np.abs(cv[:, 1] - cy) < 0.04) & (cv[:, 0] > cx)
    ztop = float(cv[sel, 2].max())
    c, n = _front_frame(f, [cb], cy, ztop - 0.004)
    if c is None:
        raise ValueError(f"{f.prefix}: the throat found no carrier front at its collar")
    V0, T = km.source("throat_protector")
    V0 = _unbend(V0, 0.0298 / 0.0983 ** 2)
    V = km.place(V0, c - n * 0.0005, n, UP)
    shift, _g = km.clear_shift([cb, f.zone_torso], V, n, gap=GAP, mask=V0[:, 0] < 0.004)
    V = V + n * shift
    _stats(f, name="throat", collar_z=round(ztop, 4), shift_mm=round(1000 * shift, 2))
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote")
    return pc


def v7_groin(f, side=None):
    """Hangs from the fitted carrier's hem: top edge just inside the hem's front, apron in front of the belt."""
    cv, _ct, cb = carrier_fit(f)
    _bv, _bt, bb = belt_fit(f)
    cx, cy = _centre_xy(f)
    sel = (np.abs(cv[:, 1] - cy) < 0.06) & (cv[:, 0] > cx)
    zhem = float(cv[sel, 2].min())
    c, n = _front_frame(f, [cb], cy, zhem + 0.012)
    if c is None:
        raise ValueError(f"{f.prefix}: the groin found no carrier front at its hem")
    V0, T = km.source("groin_apron")
    V0 = _unbend(V0, 0.0366 / 0.1236 ** 2)
    V = km.place(V0, c - n * 0.0005, n, UP)
    shift, _g = km.clear_shift([cb, bb, f.zone_lower], V, n, gap=GAP, mask=V0[:, 0] < 0.004)
    V = V + n * shift
    _stats(f, name="groin", hem_z=round(zhem, 4), shift_mm=round(1000 * shift, 2))
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote")
    return pc


# ------------------------------------------------------------ belt pouches

def _belt_pouches(f, src, degs, size, z, z_top, tex):
    pc = Piece(f.world())
    V0, T = km.source(src)
    _bv, _bt, bb = belt_fit(f)
    shifts = []
    for deg in ik._clear_pouches(f, degs, size, z):
        th = math.radians(deg)
        d = np.array([math.cos(th), math.sin(th), 0.0])
        origin = np.array([f.O[0], f.O[1], z_top]) + d * 0.13
        V = km.place(V0, origin, d, UP)
        shift, _g = km.clear_shift([bb, f.zone_lower], V, d, gap=GAP, mask=V0[:, 0] < 0.004)
        V = V + d * shift
        shifts.append(round(1000 * shift, 1))
        add_mesh(pc, V, T, tex)
    _stats(f, name=src, shifts_mm=shifts)
    return pc


def v7_mag_pouches(f, side=None):
    return _belt_pouches(f, "mag_pouch", (270.0, 240.0), (0.06, 0.08, 0.12), ik.MAG_Z, ik.MAG_Z + 0.06, "coyote")


def v7_grenade_pouches(f, side=None):
    return _belt_pouches(f, "grenade_pouch", (120.0, 150.0), (0.055, 0.075, 0.11), 0.855, 0.855 + 0.055, "coyote")


# ------------------------------------------------------------ back and chest

def _back_bvhs(f):
    return [carrier_fit(f)[2]]


def _back_piece(f, src, y, z_origin, tex, stand=()):
    """A part whose back face stands on the carrier's back at (y, z_origin): origin on the surface, +X out of the back."""
    cb = carrier_fit(f)[2]
    c, n = km.surf_frame([cb], np.array([f.O[0], f.O[1] + y, z_origin]), (1, 0, 0), 0.04, 0.05)
    on = "carrier"
    if c is None:
        # the carrier has no back there (an opening in the Meshy shell): the part stands on the body
        c, n = km.surf_frame([f.zone_torso], np.array([f.O[0], f.O[1] + y, z_origin]), (1, 0, 0), 0.04, 0.05)
        on = "body"
    if c is None:
        raise ValueError(f"{f.prefix}: {src} found no carrier or body back at y {y} z {z_origin}")
    V0, T = km.source(src)
    V = km.place(V0, c - n * 0.0005, n, UP)
    shift, _g = km.clear_shift([cb, f.zone_torso], V, n, gap=GAP, mask=V0[:, 0] < 0.012)
    V = V + n * shift
    _stats(f, name=src, on=on, shift_mm=round(1000 * shift, 2), at=[round(float(x), 3) for x in c])
    pc = Piece(f.world())
    add_mesh(pc, V, T, tex)
    return pc


def v7_radio_pouch(f, side=None):
    return _back_piece(f, "radio_pouch", ik.RADIO_POUCH_Y, 1.17, "olive")


def v7_radio_panel(f, side=None):
    return _back_piece(f, "radio_panel", 0.0, 1.38, "olive")


def v7_radio_pack(f, side=None):
    return _back_piece(f, "radio_pack", 0.0, 1.40, "olive")


def v7_eud(f, side=None):
    ey, ez = ik.EUD_AT
    cb = carrier_fit(f)[2]
    c, n = km.surf_frame([cb], np.array([f.O[0], f.O[1] + ey, ez]), (-1, 0, 0), 0.04, 0.05)
    if c is None:
        raise ValueError(f"{f.prefix}: the EUD found no carrier front at y {ey} z {ez}")
    V0, T = km.source("phone_case")
    V = km.place(V0, c - n * 0.0005, n, UP)
    shift, _g = km.clear_shift([cb, f.zone_torso], V, n, gap=GAP, mask=V0[:, 0] < 0.004)
    V = V + n * shift
    _stats(f, name="phone_case", shift_mm=round(1000 * shift, 2))
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive_dark")
    return pc


# ------------------------------------------------------------ the helmet

def _flip(n, deg):
    """(x, z) kit axes of a device flipped `deg` up from the helmet front's normal `n` (the bore tilts up and, past 90, back)."""
    t = math.radians(deg)
    up = np.array(UP)
    nn = np.array([n.x, n.y, n.z]) if hasattr(n, "x") else np.asarray(n, dtype=float)
    x = nn * math.cos(t) + up * math.sin(t)
    z = -nn * math.sin(t) + up * math.cos(t)
    return x, z


def _nvg(f, src, ends):
    tip, n = ik._mono_axis(f)
    if kp.TEAM.baked_mount:
        origin = np.array([tip.x, tip.y, tip.z]) + np.array(UP) * (0.020 + kp.TEAM.nvg_lift)
    else:
        raise ValueError("v7 NVG parts are fitted to a baked mount only")
    x, z = _flip(n, kp.TEAM.flip_deg)
    V0, T = km.source(src)
    g = lens_faces(V0, T, ends)
    V = km.place(V0, origin, x, z)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive_dark", g)
    return pc


def v7_nvg_mono(f, side=None):
    return _nvg(f, "nvg_mono", "+")


def v7_nvg_bino(f, side=None):
    return _nvg(f, "nvg_bino", "+")


def v7_ir_strobe(f, side=None):
    o = Vector((f.O[0] + f.hel_c.x - 0.03, f.O[1] + f.hel_c.y, 2.5))
    loc, n = geo.surface_hit(f.zone_helmet, o, (0, 0, -1))
    x = np.array([1.0, 0.0, 0.0]) - np.array([n.x, n.y, n.z]) * n.x
    V0, T = km.source("ir_strobe")
    V = km.place(V0, np.array([loc.x, loc.y, loc.z]) - np.array([n.x, n.y, n.z]) * 0.001, x, [n.x, n.y, n.z])
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive_dark")
    return pc


def v7_counterweight(f, side=None):
    o = Vector((f.O[0] + f.hel_c.x - 0.6, f.O[1] + f.hel_c.y, f.hel_top - 0.105))
    loc, n = geo.surface_hit(f.zone_helmet, o, (1, 0, 0))
    nn = np.array([n.x, n.y, n.z])
    V0, T = km.source("counterweight")
    # the part bulges toward its -X: its -X is the outward normal
    V = km.place(V0, np.array([loc.x, loc.y, loc.z]) + nn * 0.001, -nn, UP)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive")
    return pc


def v7_headset(f, side):
    sg = -1.0 if side == "L" else 1.0
    # the rig's L side is at -y; `headset_l_built` is outboard +y, so the rig's L cup is the `_r_` file
    src = "headset_r_built" if side == "L" else "headset_l_built"
    inner, zc, dx = ik.HEADSET_AT
    cx = f.O[0] + f.hel_c.x + dx
    cy = f.O[1] + f.hel_c.y
    V0, T = km.source(src)
    # the cup hangs ~75 mm below the rail pivot: the pivot stands that far above the ear-level cup centre, on the helmet's side
    zp = zc + 0.075
    probe = Vector((cx, cy + sg * 0.5, zp))
    loc, _n = geo.surface_hit(f.zone_all, probe, (0, -sg, 0))
    yp = loc.y if loc is not None else cy + sg * (inner + 0.01)
    V = km.place(V0, np.array([cx, yp, zp]), (1, 0, 0), UP)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive_dark")
    return pc


# ------------------------------------------------------------ the weapon

def _weapon_piece(f, src, u, lat, z, tex, ends=""):
    V0, T = km.source(src)
    g = lens_faces(V0, T, ends) if ends else None
    V = km.place(V0, np.array([u, lat, z]), (1, 0, 0), UP)
    pc = Piece(f.wpn())
    add_mesh(pc, V, T, tex, g)
    return pc


def v7_red_dot(f, side=None):
    top = ik._rail_top(f, ik.RED_DOT_REAR, ik.RED_DOT_REAR + 0.10)
    return _weapon_piece(f, "red_dot", ik.RED_DOT_REAR + 0.0325, 0.0, top - GAP, "coyote", "+-")


def v7_lpvo(f, side=None):
    top = ik._rail_top(f, ik.LPVO_REAR + 0.05, ik.LPVO_REAR + 0.25)
    return _weapon_piece(f, "scope", ik.LPVO_REAR + 0.1331, 0.0, top - GAP, "coyote", "+-")


def v7_laser_box(f, side=None):
    top = ik._rail_top(f, ik.LASER_FRONT - 0.109, ik.LASER_FRONT)
    return _weapon_piece(f, "laser", ik.LASER_FRONT - 0.0567, 0.0, top - GAP, "coyote", "+")


def v7_weapon_light(f, side=None):
    top, bot, wlo, _whi = f.station(0.19)
    return _weapon_piece(f, "weapon_light", ik.WEAPON_LIGHT_REAR + 0.07, wlo - 0.0125, (top + bot) / 2, "coyote", "+")


def v7_suppressor(f, side=None):
    return _weapon_piece(f, "suppressor", -0.015, 0.0, 0.0, "coyote", "+")


V7_BUILDERS = {
    "carrier": v7_carrier,
    "throat": v7_throat,
    "groin": v7_groin,
    "battle_belt": v7_battle_belt,
    "mag_pouches": v7_mag_pouches,
    "grenade_pouches": v7_grenade_pouches,
    "radio_pouch": v7_radio_pouch,
    "radio_panel": v7_radio_panel,
    "radio_pack": v7_radio_pack,
    "eud": v7_eud,
    "nvg_mono": v7_nvg_mono,
    "nvg_bino": v7_nvg_bino,
    "ir_strobe": v7_ir_strobe,
    "counterweight": v7_counterweight,
    "headset": v7_headset,
    "red_dot": v7_red_dot,
    "lpvo": v7_lpvo,
    "laser_box": v7_laser_box,
    "weapon_light": v7_weapon_light,
    "suppressor": v7_suppressor,
}
