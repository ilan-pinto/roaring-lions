"""Infantry upgrade kit for `inf_squad`, REDESIGNED: "real gear, fitted" (GH-826), built in Blender.

    blender -b -P tools/render_inf_kit.py -- ...      (the render tool calls build())

This is the *part build*: it imports the SHIPPED team GLB, measures each
figure at its bind pose, and adds every kit part of `inf_kit_parts.PARTS` as a
skinned object, rigidly bound (one part, one vertex group, one bone, weight 1)
through `rig.rig_parts`, so a part with no `PART_BONE` entry raises exactly as
for any other part. No hand posing, no weight painting, no clips: parts ride
the shipped bones in every shipped clip.

What changed from the 26 Oct build (PR 885): every part is real size (1.00x,
helmet devices 1.08x), the soft goods are SHRINK-WRAPS of the figure's own
surface (`inf_kit_geo.Wrap`: a regular grid projected onto a body zone, offset by
the real fabric and plate thickness, checked for poke-through), every face is
smooth-shaded with sharp edges only at folds of 40 degrees or more, and the
tones are two families (coyote, olive) pinned to texels of the team's own atlas.

Rules kept (spec 26 Oct section 2.1, redesign 28 Oct):
  * additive only: nothing of the base figure is touched;
  * real vertex coordinates, object scale 1, no `mathutils.noise`;
  * pinned UVs on a texel of the team's own atlas, zero new textures or
    materials (every kit object uses the file's one `BakedMaterial`);
  * no lower-leg kit; parts stay out of the boot zone (z > 0.55).

Coordinates. The GLB's forward is +x and the importer keeps it (Blender Z up,
figures stand at x -0.45/0.45, y -1.05/0/1.05). A part is authored in one of
three frames: WORLD (the bind frame itself, used by the wraps), FIGURE (origin
on the ground under the figure's root) or WEAPON (origin at the muzzle, u along
the barrel toward the muzzle, w to the weapon's left, v up), each measured per
figure from the shipped geometry.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import inf_kit_fit as kf  # noqa: E402
import inf_kit_geo as geo  # noqa: E402
import inf_kit_parts as kp  # noqa: E402
from inf_kit_geo import Piece, Wrap  # noqa: E402

#: Per-wrap build reports (poke-through before and after the fix), filled while building.
REPORT = []


def smoothstep(a, b, x):
    if b == a:
        return 1.0 if x >= b else 0.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def _rot_x(a):
    return Matrix.Rotation(a, 3, "X")


def _rot_y(a):
    return Matrix.Rotation(a, 3, "Y")


def _rot_z(a):
    return Matrix.Rotation(a, 3, "Z")


def _toward(a, b):
    """3x3 whose local +x is the direction a->b."""
    d = (Vector(b) - Vector(a)).normalized()
    return d.to_track_quat("X", "Z").to_matrix()


# ------------------------------------------------------------- wrap plumbing

def fit_wrap(wr, off, mask_fn, zone_pts, name, margin=0.0015, iters=12, tol=0.0003, exempt=None, exempt_fn=None, cap=0.03, extra_cap=None):
    """Sample the zone, build the offset grid and push vertices out until no zone
    point lies outside the shell (the poke-through test, here as a radial ray from
    the wrap's axis). Returns (P, mask, stats)."""
    wr.sample()
    rows, cols = len(wr.rows_t), len(wr.cols)
    extra = [[0.0] * cols for _ in range(rows)]
    f_off = off if callable(off) else (lambda j, k: off)
    ncell = cols if wr.cyclic else cols - 1
    mask = [[False] * ncell for _ in range(rows - 1)]
    for j in range(rows - 1):
        for k in range(ncell):
            k2 = (k + 1) % cols
            if any(wr.R[a][b] is None for a, b in ((j, k), (j, k2), (j + 1, k), (j + 1, k2))):
                continue
            mask[j][k] = bool(mask_fn(j, k)) if mask_fn else True
    stats = {"part": name, "iterations": 0, "first_pokes": None, "first_worst_mm": 0.0,
             "pokes_left": 0, "worst_mm": 0.0, "points": int(len(zone_pts)), "cells": int(sum(map(sum, mask)))}
    P = None
    cc = np.array(wr.cols)
    for it in range(iters + 1):
        P = wr.points(lambda j, k: f_off(j, k) + extra[j][k])
        bvh = geo.shell_bvh(P, mask, wr.cyclic)
        if bvh is None:
            break
        pokes = []
        for p in zone_pts:
            rs, rp = wr.shell_radius(bvh, p)
            if rs is not None and rp > rs - tol:
                if exempt_fn is not None and exempt_fn(Vector(p)):
                    continue
                if exempt is not None:
                    # a point the arm covers (it lies behind the arm's own surface along the ray) is not drawn at rest
                    vv = Vector(p) - wr.o
                    cc0 = wr.centre(vv.dot(wr.a))
                    dd0 = Vector(p) - cc0
                    dd0 -= wr.a * dd0.dot(wr.a)
                    if dd0.length > 1e-9:
                        dd0.normalize()
                        loc, _n, _i, dist = exempt.ray_cast(cc0, dd0, rp)
                        if loc is not None and dist < rp - 0.002:
                            continue
                pokes.append((p, rp - rs))
        worst = round(1000 * max([d for _, d in pokes], default=0.0), 2)
        if stats["first_pokes"] is None:
            stats["first_pokes"] = len(pokes)
            stats["first_worst_mm"] = worst
        stats["pokes_left"] = len(pokes)
        stats["worst_mm"] = worst
        if it == iters or not pokes:
            top = sorted(pokes, key=lambda pd: -pd[1])[:10]
            stats["worst_points"] = [{"z": round(p[2], 3), "angle": round(math.degrees(math.atan2((Vector(p) - wr.centre(Vector(p).z - wr.o.z)).dot(wr.e2), (Vector(p) - wr.centre(Vector(p).z - wr.o.z)).dot(wr.e1))), 0),
                                      "depth_mm": round(1000 * d, 1)} for p, d in top]
        if not pokes or it == iters:
            break
        stats["iterations"] = it + 1
        need = {}
        for p, d in pokes:
            v = Vector(p) - wr.o
            t = v.dot(wr.a)
            jt = int(np.clip(np.searchsorted(wr.rows_t, t) - 1, 0, rows - 2))
            dd = Vector(p) - wr.centre(t)
            ang = math.degrees(math.atan2(dd.dot(wr.e2), dd.dot(wr.e1)))
            if wr.cyclic:
                diff = (cc - ang + 180.0) % 360.0 - 180.0
                kk = sorted(range(cols), key=lambda k: abs(diff[k]))[:2]
            else:
                kk = sorted(range(cols), key=lambda k: abs(cc[k] - ang))[:2]
            for j in (jt, jt + 1):
                for k in kk:
                    if wr.R[j][k] is not None:
                        need[(j, k)] = max(need.get((j, k), 0.0), d + margin)
        for (j, k), v in need.items():
            lim = cap if extra_cap is None else min(cap, extra_cap(j, k))
            extra[j][k] = min(lim, extra[j][k] + v * 0.8)
    REPORT.append(stats)
    return P, mask, stats


def _radial_out(wr, p):
    v = Vector(p) - wr.o
    t = v.dot(wr.a)
    d = Vector(p) - wr.centre(t)
    d -= wr.a * d.dot(wr.a)
    return d if d.length > 1e-9 else Vector((0, 0, 1))


def finish_wrap(pc, wr, P, mask, row_tex, rim_depth, rim_tex, off, rim_filter=None, thick=None):
    """Quads for every valid cell, then a rolled rim on the open edges. `thick(j, k)`
    is the part's physical depth below the vertex (default: its offset)."""
    geo.grid(pc, P, row_tex[0], mask=mask, cyclic=wr.cyclic, row_tex=row_tex)
    th = thick if thick is not None else (off if callable(off) else (lambda j, k: off))
    for j in range(len(P)):
        for k in range(len(P[0])):
            if P[j][k] is not None:
                pc.set_thick(P[j][k], max(0.002, th(j, k)))
    if rim_depth:
        N = geo.surf_normals(P, wr.cyclic)
        for j in range(len(P)):
            for k in range(len(P[0])):
                if P[j][k] is not None and N[j][k] is not None:
                    if _radial_out(wr, P[j][k]).dot(N[j][k]) < 0:
                        N[j][k] = -N[j][k]
        edges = geo.boundary_edges(mask, len(P), len(P[0]), wr.cyclic)
        if rim_filter:
            edges = [e for e in edges if rim_filter(*e)]
        f_off = off if callable(off) else (lambda j, k: off)
        rd = lambda j, k: min(rim_depth, max(0.002, f_off(j, k) - 0.0015))
        geo.rim(pc, P, N, edges, rd, rim_tex)
        for (a_, b_) in edges:
            for (j, k) in (a_, b_):
                if P[j][k] is not None:
                    pc.set_thick(P[j][k] - N[j][k] * rd(j, k), 0.0015)
    pc.outward = lambda p, wr=wr: _radial_out(wr, p)


ALLOW_DEFAULT = 0.0035      # the clash census's tolerance is 4 mm: stay inside it
#: Scoped clash allowances (ruling Q9, 28 Oct) would be {"weapon": 0.022, "upperarm_L": 0.006, "upperarm_R": 0.006}
#: for the carrier, and only if the trims FAIL. They did not: the census is clean for the carrier against the
#: stock and the flush upper arm with none, so the table is EMPTY and no allowance is in force.
CARRIER_ALLOW = {}


def clearance_trim(wr, blockers, allow=None, floor=0.0015, slack=0.002):
    """Largest offset (thickness) each grid vertex may take so that no other bone's geometry,
    in any sampled key of the living clips, ends up deeper in the part than `allow[bone]`
    (default 3.5 mm: inside the census's 4 mm). `blockers` = (points in the wrap's frame, bone
    names). A point inside the bare surface (an embedded base vertex) is ignored; one on or
    outside it caps the offset at its height above the surface plus its allowance."""
    pts, who = blockers
    allow = allow or {}
    rows, cols = len(wr.rows_t), len(wr.cols)
    cc = np.array(wr.cols)
    rt = np.array(wr.rows_t)
    cap_of = {}
    if len(pts) == 0:
        return cap_of
    for q, bn in zip(pts, who):
        v = Vector(q) - wr.o
        t = v.dot(wr.a)
        if t < rt[0] - 0.01 or t > rt[-1] + 0.01:
            continue
        j = int(np.clip(np.searchsorted(rt, t) - 1, 0, rows - 2))
        d = Vector(q) - wr.centre(t)
        d -= wr.a * d.dot(wr.a)
        r = d.length
        if r < 1e-6:
            continue
        ang = math.degrees(math.atan2(d.dot(wr.e2), d.dot(wr.e1)))
        if wr.cyclic:
            diff = (cc - ang + 180.0) % 360.0 - 180.0
            order = sorted(range(cols), key=lambda k: abs(diff[k]))[:2]
            if abs(diff[order[0]]) > 360.0 / cols:
                continue
        else:
            order = sorted(range(cols), key=lambda k: abs(cc[k] - ang))[:2]
            if abs(cc[order[0]] - ang) > (cc[1] - cc[0]):
                continue
        corners = [(jj, k) for jj in (j, j + 1) for k in order]
        Rs = [wr.R[jj][k] for jj, k in corners if wr.R[jj][k] is not None]
        if not Rs:
            continue
        gap = r - sum(Rs) / len(Rs)
        if gap < -slack:
            continue
        cap = max(floor, gap + allow.get(bn, ALLOW_DEFAULT))
        for c in corners:
            if cap < cap_of.get(c, 9.0):
                cap_of[c] = cap
    return cap_of


# ---------------------------------------------------------------- the figure

def _centre_fn(f, bone="spine"):
    cache = {}

    def fn(t):
        key = round(t, 3)
        if key not in cache:
            c = f.centre_at(t, bone)
            cache[key] = c if c is not None else Vector((0.0, 0.0, 0.0))
        return Vector((cache[key].x, cache[key].y, 0.0))
    return fn


def torso_wrap(f, rows, ncols=16, span=None, fill_below=None, whole=False, rlim=None):
    cols = [i * 360.0 / ncols for i in range(ncols)] if span is None else span
    fr = None if fill_below is None else (lambda j: rows[j] <= fill_below)
    return Wrap(f.zone_torso_all if whole else f.zone_torso, (f.O[0], f.O[1], 0.0), (0, 0, 1), (1, 0, 0), rows, cols,
                centre_fn=_centre_fn(f), col_span=None if span is None else True, fill_rows=fr, clamp=f.zone_arms, ellipse=lambda t: kp.TEAM.torso_ellipse,
                ring_cap=kp.TEAM.torso_ring_cap, back_plate=kp.TEAM.carrier_back_plate and not whole, rlim=rlim)


def trimmed(f, wr, bone, zlo, zhi, allow=None, pf_bone=None):
    """`clearance_trim` for a wrap riding `bone`, against everything else that enters the box."""
    wr.sample()
    lo = (f.O[0] - 0.7, f.O[1] - 0.7, zlo)
    hi = (f.O[0] + 0.7, f.O[1] + 0.7, zhi)
    return clearance_trim(wr, f.bank.blockers(f.prefix, bone, lo, hi), allow)


# ================================================================= ARMOUR

CARRIER_ROWS = [1.055, 1.12, 1.20, 1.27, 1.34, 1.42]
CARRIER_ROW_TEX = ["coyote_shade", "coyote", "coyote_shade", "coyote", "coyote_shade"]


def build_carrier(f, side=None):
    wr = torso_wrap(f, CARRIER_ROWS, 16, fill_below=kp.TEAM.carrier_fill)
    cols = wr.cols
    wr.sample()
    cache = {}
    box_lo = (f.O[0] - 0.5, f.O[1] - 0.5, 0.95)
    box_hi = (f.O[0] + 0.5, f.O[1] + 0.5, 1.5)
    trim = clearance_trim(wr, f.bank.blockers(f.prefix, "spine", box_lo, box_hi), CARRIER_ALLOW)

    rows_n, cols_n = len(wr.rows_t), len(wr.cols)
    E = {}
    for j in range(rows_n):
        for k in range(cols_n):
            th = math.radians(cols[k])
            z = wr.rows_t[j]
            plate = smoothstep(0.35, 0.65, abs(math.cos(th))) * smoothstep(1.10, 1.13, z)
            o = 0.006 + 0.016 * plate
            if kp.TEAM.carrier_back_plate and math.cos(th) < -0.35:
                o = 0.010            # a thin flat back plate, not a padded back
            # never touch another bone's geometry in any sampled key of the living clips (arms, hands, the stock)
            E[(j, k)] = min(o, trim.get((j, k), 9.0))
    # a soft good does not step: neighbouring vertices differ by at most 7 mm (a Lipschitz envelope of the trims)
    for _ in range(6):
        for j in range(rows_n):
            for k in range(cols_n):
                for dj, dk in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    jj, kk = j + dj, (k + dk) % cols_n
                    if 0 <= jj < rows_n:
                        E[(j, k)] = min(E[(j, k)], E[(jj, kk)] + 0.007)

    def off(j, k):
        return E[(j, k)]

    def masked(j, k):
        z = 0.5 * (wr.rows_t[j] + wr.rows_t[j + 1])
        th = math.radians(cols[k] + 180.0 / len(cols))
        if z > 1.22 and abs(math.sin(th)) > 0.85:
            return False            # the armholes (spec 3.1)
        # the belly: the figure's hands and forearms live across the front below the chest, in every
        # clip (the support hand, the stock arm). The carrier stops at the plate's lower edge there
        # and leaves the base's own chest rig showing, as a real carrier worn over a rig does.
        if z < 1.19 and math.cos(th) > kp.TEAM.belly_cos:
            return False
        if kp.TEAM.carrier_back_plate and z < 1.15 and math.cos(th) < -0.35:
            return False            # the back is a plate on the upper back, not a skirt down over the baggage
        return True

    def shard(p):
        # a baked figure's loose shards (cloth tatters, spine-bound hands) stand beyond the ring its own front and back
        # walls imply: the cap leaves them out, so the poke-through check does not chase them (they are counted below)
        rr, r = wr.ring_radius(p)
        return rr is not None and r > rr + 0.012

    P, mask, st = fit_wrap(wr, off, masked, f.pts["torso"], "carrier", exempt=f.zone_arms,
                           exempt_fn=lambda p: abs(p.y - f.O[1]) > 0.20 or shard(p),
                           extra_cap=lambda j, k: max(0.0, trim.get((j, k), 9.0) - off(j, k)))
    pc = Piece(f.world(), open_thick=0.022)
    finish_wrap(pc, wr, P, mask, CARRIER_ROW_TEX, 0.008, "coyote_shade", off)
    return pc


HELMET_COLS = 10


def build_helmet_cover(f, side=None):
    if kp.TEAM.baked_mount:
        tip, _n = baked_mount_tip(f)
        # the baked bracket block (5 cm proud of the shell, 4 cm wide): a real cover is cut around it, so it is not "poking through"
        # and the brow shroud plate across the front of the helmet around it (front 9.5 cm, 10 cm to either side)
        in_bracket = lambda p: (p[0] > tip.x - 0.095 and abs(p[1] - tip.y) < 0.10 and tip.z - 0.07 < p[2] < tip.z + 0.03)
    ncol = kp.TEAM.helmet_cols
    hz = f.hel_top - 0.15 + 0.05            # the scrim band's centre
    rows = [f.hel_bot + 0.004, hz - 0.0125, hz + 0.0125, f.hel_top - 0.012]
    offs = [0.003, 0.008, 0.008, 0.005]
    row_tex = ["olive", "coyote_shade", "olive"]
    if kp.TEAM.helmet_dome:
        # one more ring between the scrim band and the crown, so the cover turns over like a dome instead of standing as a wall under a lid
        rows = rows[:3] + [f.hel_top - 0.05] + rows[3:]
        offs = offs[:3] + [0.006] + offs[3:]
        row_tex = row_tex + ["olive"]
    nrow = len(rows)
    cols = [i * 360.0 / ncol for i in range(ncol)]
    wr = Wrap(f.zone_helmet, (f.O[0] + f.hel_c.x, f.O[1] + f.hel_c.y, 0.0), (0, 0, 1), (1, 0, 0), rows, cols,
              fill_vertical=True)
    trim = trimmed(f, wr, "head", 1.5, 1.9)
    off = lambda j, k: min(offs[j], trim.get((j, k), 9.0))
    def open_face(j, k):
        # a baked helmet is open at the face: the cover's lowest band stops where the shell does, so its rim rises over the brow
        if j != 0 or kp.TEAM.helmet_front_trim <= 0:
            return True
        ang = (cols[k] + 180.0 / ncol + 180.0) % 360.0 - 180.0
        return abs(ang) > kp.TEAM.helmet_front_trim

    P, mask, st = fit_wrap(wr, off, open_face, f.pts["helmet"], "helmet_cover", cap=0.012,
                           exempt_fn=(lambda p: f.helmet_hardware(p) or in_bracket(p)) if kp.TEAM.baked_mount else None,
                           extra_cap=lambda j, k: max(0.0, trim.get((j, k), 9.0) - off(j, k)))
    pc = Piece(f.world(), open_thick=0.01)
    geo.grid(pc, P, "olive", mask=mask, cyclic=True, row_tex=row_tex)
    for j in range(nrow):
        for k in range(ncol):
            if P[j][k] is not None:
                pc.set_thick(P[j][k], off(j, k))
    top = [P[nrow - 1][k] for k in range(ncol)]
    cen = sum(top, Vector()) / len(top)
    cen.z = f.O[2] + f.hel_top + 0.006      # a fan to an apex a hair above the crown ring: a dome, not a lid
    for k in range(ncol):
        pc.face([top[k], top[(k + 1) % ncol], cen], "olive", hint=True)
    zc = hz
    pc.outward = lambda p, wr=wr: _radial_out(wr, p) + Vector((0, 0, 1.0)) * max(0.0, (p.z - zc) * 4)
    return pc


def _arm_wrap(f, side, rows, cols_deg):
    sh, el = f.sh[side], f.el[side]
    lat = Vector((0, 1.0 if side == "R" else -1.0, 0))
    # the arm's weight zone is a cloud of shards; the wrap rays read the figure's whole outer surface
    # within 0.14 m of the bone instead (the first hit from outside is the arm's own lateral surface)
    return Wrap(f.zone_all, sh, el - sh, lat, rows, cols_deg, col_span=True, r_out=0.14,
                fill_rows=lambda j: True, rlim=(0.07, 0.09), default_r=0.08)


def build_deltoid(f, side):
    wr = _arm_wrap(f, side, [-0.02, 0.05, 0.12], [-90, -45, 0, 45, 90])
    trim = trimmed(f, wr, "upperarm_" + side, 0.85, 1.5)
    off = lambda j, k: min(0.008, trim.get((j, k), 9.0))
    P, mask, st = fit_wrap(wr, off, None, f.pts["arm" + side], "deltoid_" + side, cap=0.01)
    pc = Piece(f.world(), open_thick=0.010)
    finish_wrap(pc, wr, P, mask, ["coyote", "coyote"], 0.006, "coyote", off,
                rim_filter=lambda a, b: a[0] == b[0] == len(wr.rows_t) - 1)
    return pc


def build_sleeve(f, side):
    L = (f.el[side] - f.sh[side]).length
    wr = _arm_wrap(f, side, [-0.02, 0.05, 0.12, 0.19, L - 0.03], [-100, -50, 0, 50, 100])
    trim = trimmed(f, wr, "upperarm_" + side, 0.85, 1.5)
    off = lambda j, k: min(0.010, trim.get((j, k), 9.0))
    P, mask, st = fit_wrap(wr, off, None, f.pts["arm" + side], "sleeve_" + side, cap=0.01)
    pc = Piece(f.world(), open_thick=0.010)
    finish_wrap(pc, wr, P, mask, ["coyote"] * 4, 0.006, "coyote", off,
                rim_filter=lambda a, b: a[0] == b[0] == len(wr.rows_t) - 1)
    return pc


def build_throat(f, side=None):
    wr = torso_wrap(f, [1.335, 1.38, 1.425], span=[-35, -17.5, 0, 17.5, 35])
    trim = trimmed(f, wr, "spine", 1.2, 1.7)
    off = lambda j, k: min(0.024 + (0.0 if j == 1 else -0.004), trim.get((j, k), 9.0) + 0.022)
    P, mask, st = fit_wrap(wr, off, None, f.pts["torso"], "throat")
    pc = Piece(f.world(), open_thick=0.012)
    finish_wrap(pc, wr, P, mask, ["coyote", "coyote"], 0.005, "coyote", off, rim_filter=lambda a, b: a[0] == b[0] == 0,
                thick=lambda j, k: THROAT_T)
    return pc


def build_yoke(f, side=None):
    ncol = kp.TEAM.yoke_cols            # 9 columns on the Rifle Squad; a figure whose spine zone is complete there needs fewer for the same 24 triangles
    wr = torso_wrap(f, [1.385, 1.415, 1.448], span=[75 + i * (210.0 / (ncol - 1)) for i in range(ncol)], whole=True,
                    rlim=None if kp.TEAM.yoke_rmax is None else (0.06, kp.TEAM.yoke_rmax))   # above the vest: the whole spine zone

    trim = trimmed(f, wr, "spine", 1.2, 1.7)

    def off(j, k):
        o = 0.015 + 0.005 * abs(math.sin(math.radians(wr.cols[k]))) - (0.003 if j == 2 else 0.0)
        return min(o, trim.get((j, k), 9.0) + kp.TEAM.yoke_slack)
    P, mask, st = fit_wrap(wr, off, None, f.pts.get("torso_all", f.pts["torso"]), "yoke")
    pc = Piece(f.world(), open_thick=0.018)
    finish_wrap(pc, wr, P, mask, ["coyote", "coyote"], 0.005, "coyote", off, rim_filter=lambda a, b: a[0] == b[0] == 2,
                thick=lambda j, k: YOKE_T)
    return pc


def build_groin(f, side=None):
    wr = Wrap(f.zone_lower, (f.O[0], f.O[1], 0.0), (0, 0, 1), (1, 0, 0), [0.77, 0.84, 0.905], [-25, -12.5, 0, 12.5, 25],
              centre_fn=lambda t: Vector((0.03, 0.0, 0.0)), col_span=True)
    trim = trimmed(f, wr, "pelvis", 0.6, 1.0)
    off = lambda j, k: min(0.012, trim.get((j, k), 9.0))
    P, mask, st = fit_wrap(wr, off, None, np.zeros((0, 3)), "groin")
    pc = Piece(f.world(), open_thick=0.012)
    finish_wrap(pc, wr, P, mask, ["coyote", "coyote"], 0.005, "coyote", off, rim_filter=lambda a, b: a[0] == b[0] == 0)
    return pc


# ================================================================= SENSORS

MAG_Z = 0.905        # the mag pouches' centre height on the left hip
LPVO_REAR = -0.49       # spec -0.55: moved 6 cm forward, the bowed head's NVG bridge strikes the scope's eyepiece at -0.55
LASER_FRONT = -0.115    # the laser box's front face (spec -0.146), ahead of the moved optic
NVG_DZ = 0.03          # the NVG mount stands this far below the helmet top (kneelIn/kneelOut: lower, and the bow drives the bridge into the throat)
FLIP = 70.0          # a flipped-up tube: degrees up from the helmet front's normal (the Rifle Squad's; `Team.flip_deg` carries it)
EUD_T = 0.025          # the spec's thickness, with its standoff trimmed against the clips (build_eud)
EUD_AT = (-0.045, 1.345)   # y, z on the chest
HEADSET_AT = (0.106, 1.572, -0.03)   # inner |y| of the cup, its centre height, and its offset from the helmet centre
THROAT_T = 0.008
YOKE_T = 0.010
PLATE_OFF = 0.022      # the carrier's plate: the EUD sits flat ON it (spec 3.2)
SENSOR_OFF = 0.012     # standing off the base vest: seated either on the carrier's plate or on the bare vest


def _frame(n, up=(0, 0, 1)):
    """3x3 with local x = n, z as close to `up` as it gets, y = z cross x."""
    n = Vector(n).normalized()
    z = (Vector(up) - n * Vector(up).dot(n))
    z.normalize()
    y = z.cross(n)
    m = Matrix(((n.x, y.x, z.x), (n.y, y.y, z.y), (n.z, y.z, z.z)))
    return m


def helmet_front(f, z, dy=0.0):
    """The most forward point of the figure's own helmet front near height z (the base helmet
    is not watertight there: a ray down the middle can slip through, so take the best of a patch)."""
    best = None
    for oy in (-0.03, -0.02, -0.01, 0.0, 0.01, 0.02, 0.03):
        for oz in (-0.02, 0.0, 0.02):
            o = Vector((f.O[0] + f.hel_c.x + 0.6, f.O[1] + f.hel_c.y + dy + oy, z + oz))
            loc, n = geo.surface_hit(f.zone_all, o, (-1, 0, 0))
            if loc is not None and (best is None or loc.x > best.x):
                best = loc
    return Vector((best.x, f.O[1] + f.hel_c.y + dy, z)), Vector((1.0, 0.0, 0.0))


def build_headset(f, side):
    sg = -1.0 if side == "L" else 1.0
    pc = Piece(f.world())
    inner, zc, dx = HEADSET_AT
    cx = f.O[0] + f.hel_c.x + dx
    cy = f.O[1] + f.hel_c.y
    # a tapered cup: 0.086 tall, 0.070 fore-aft, 0.049 proud of the head
    geo.lathe(pc, (cx, cy + sg * inner, zc), (0, sg, 0), (0, 0, 1), [(0.0, 0.043), (0.049, 0.030)], 8,
              "olive_dark", cap1="olive_dark", squash=0.814)
    # the rail arm up to the helmet's side
    R = Matrix.Identity(3)
    pc.__class__  # (arm: a 0.015 wide slat from the cup top to the shell)
    geo.rbox(pc, (cx, cy + sg * (inner + 0.040), zc + 0.060), R, (0.015, 0.012, 0.052), 0.0, "olive_dark")
    return pc


def build_nvg_mount(f, side=None):
    z = f.hel_top - NVG_DZ
    loc, n = helmet_front(f, z)
    pc = Piece(f.world(), open_thick=0.016)
    fr = _frame(n)
    u, v = fr.col[(1)], fr.col[(2)]
    O, H, nm = geo.pad(pc, f.zone_all, loc - n * 0.0, -n, u, v, 0.076, 0.065, 0.016, 3, 2, "olive_dark", base_off=0.002)
    top = max((p - loc).dot(n) for row in O for p in row)
    c = loc + n * (top + 0.0215)
    geo.rbox(pc, c, fr, (0.043, 0.081, 0.059), 0.0, "olive_dark")
    return pc


def build_ir_strobe(f, side=None):
    o = Vector((f.O[0] + f.hel_c.x - 0.03, f.O[1] + f.hel_c.y, 2.5))
    loc, n = geo.surface_hit(f.zone_helmet, o, (0, 0, -1))
    pc = Piece(f.world())
    x = Vector((1, 0, 0)) - n * n.x
    x.normalize()
    y = n.cross(x)
    R = Matrix(((x.x, y.x, n.x), (x.y, y.y, n.y), (x.z, y.z, n.z)))
    geo.rbox(pc, loc + n * (0.002 + 0.0135), R, (0.059, 0.043, 0.027), 0.0, "olive_dark", taper=0.006)
    return pc


def baked_mount_tip(f):
    """Where a helmet that already carries an NVG mount ends in front: the cluster of the helmet's own forward-most
    vertices (within 2 cm of the front, above the brow). demo_squad's helmet has a 4 cm wide block there, standing
    5 cm proud of the shell (x 0.172 against the shell's 0.126). Returns (point, forward normal)."""
    co, mine = f.co, f.mine
    m = mine & (f.W[f"{f.prefix}_head"] >= 0.5) & (co[:, 2] >= f.O[2] + 1.66)
    pts = co[m]
    xmax = pts[:, 0].max()
    cl = pts[pts[:, 0] >= xmax - 0.02]
    c = cl.mean(0)
    return Vector((float(xmax), float(c[1]), float(c[2]))), Vector((1.0, 0.0, 0.0))


def _mount_top(f):
    """How far the NVG mount's pad stands off the helmet front at its tallest (the base's own shroud block).
    A helmet with a baked mount adds none: the tubes ride the bake's own block."""
    if kp.TEAM.baked_mount:
        return 0.0
    loc, n = helmet_front(f, f.hel_top - NVG_DZ)
    fr = _frame(n)
    pc = Piece(f.world())
    O, H, nm = geo.pad(pc, f.zone_all, loc, -n, fr.col[1], fr.col[2], 0.076, 0.065, 0.016, 3, 2, "olive_dark", base_off=0.002)
    pc.bm.free()
    return max((p - loc).dot(n) for row in O for p in row)


def _mono_axis(f):
    if kp.TEAM.baked_mount:
        return baked_mount_tip(f)
    loc, n = helmet_front(f, f.hel_top - NVG_DZ)
    return loc, n


def build_nvg_mono(f, side=None):
    loc, n = _mono_axis(f)
    fr = _frame(n)
    if kp.TEAM.baked_mount:
        # the tube's lower end rests on the baked bracket's top face and leans forward from it
        base = loc + fr.col[(2)] * (0.020 + kp.TEAM.nvg_lift)
    else:
        base = loc + n * (0.002 + 0.016 + 0.043 * 0.5) + fr.col[(2)] * 0.012
    d = n * math.cos(math.radians(kp.TEAM.flip_deg)) + Vector((0, 0, 1)) * math.sin(math.radians(kp.TEAM.flip_deg))
    d.normalize()
    pc = Piece(f.world())
    geo.lathe(pc, base, d, n, [(0.0, 0.022 * 1.08 / 1.08), (0.014, 0.0275), (0.123, 0.0235)], 8, "olive_dark",
              cap0="olive_dark", cap1="glass")
    return pc


def build_counterweight(f, side=None):
    o = Vector((f.O[0] + f.hel_c.x - 0.6, f.O[1] + f.hel_c.y, f.hel_top - 0.105))
    loc, n = geo.surface_hit(f.zone_helmet, o, (1, 0, 0))
    pc = Piece(f.world(), open_thick=0.02)
    geo.pad(pc, f.zone_helmet, loc, -n, (0, 1, 0), (0, 0, 1), 0.119, 0.065, 0.043, 2, 2, "olive", base_off=0.002, rim_frac=0.85)
    return pc


def build_nvg_bino(f, side=None):
    loc, n = _mono_axis(f)
    fr = _frame(n)
    pc = Piece(f.world())
    bc = loc - n * kp.TEAM.bridge_back + fr.col[(2)] * kp.TEAM.nvg_lift if kp.TEAM.baked_mount else loc + n * (_mount_top(f) + 0.0215)
    geo.rbox(pc, bc, fr, (0.043, 0.124, 0.040), 0.0, "olive_dark", cap_bot=False)
    d = n * math.cos(math.radians(kp.TEAM.flip_deg)) + Vector((0, 0, 1)) * math.sin(math.radians(kp.TEAM.flip_deg))
    d.normalize()
    for sg in (-1.0, 1.0):
        base = bc + fr.col[(1)] * (sg * 0.033) + fr.col[(2)] * 0.012
        geo.lathe(pc, base, d, n, [(0.0, 0.0215), (0.014, 0.0215), (0.100, 0.0215)], 8, "olive_dark", cap1="glass")
    return pc


def _back_hit(f, y, z, base=SENSOR_OFF):
    o = Vector((f.O[0] - 0.6, f.O[1] + y, z))
    return geo.surface_hit(f.zone_torso, o, (1, 0, 0))


def _front_hit(f, y, z):
    o = Vector((f.O[0] + 0.6, f.O[1] + y, z))
    return geo.surface_hit(f.zone_torso, o, (-1, 0, 0))


def build_radio_pouch(f, side=None):
    loc, n = _back_hit(f, -0.13, 1.17)
    pc = Piece(f.world())
    fr = _frame(-n)               # local x = into the body ... keep outward = n
    fr = _frame(n)
    c = loc + n * (SENSOR_OFF + 0.04)
    geo.rbox(pc, c, fr, (0.08, 0.09, 0.21), 0.012, "olive")
    # the stub antenna: dia 0.012, 0.20 tall, off the pouch's top
    base = c + fr.col[(2)] * 0.105 + fr.col[(1)] * 0.02
    geo.lathe(pc, base, (0, 0, 1), (1, 0, 0), [(0.0, 0.006), (0.20, 0.003)], 4, "olive_dark")
    return pc


def build_radio_panel(f, side=None):
    loc, n = _back_hit(f, 0.0, 1.23)
    pc = Piece(f.world(), open_thick=0.03)
    geo.pad(pc, f.zone_torso, loc, -n, (0, 1, 0), (0, 0, 1), 0.25, 0.30, 0.07, 4, 3, "olive", base_off=SENSOR_OFF)
    return pc


def _whip(pc, base, lean_deg, length, tex="olive_dark"):
    lean = math.radians(lean_deg)
    d = Vector((-math.sin(lean), 0, math.cos(lean)))
    # gooseneck base dia 0.03 x 0.08, then the whip dia 0.024 -> 0.012 with a slight droop
    geo.lathe(pc, base, (0, 0, 1), (1, 0, 0), [(0.0, 0.015), (0.08, 0.012)], 4, tex, cap1=tex)
    b2 = base + Vector((0, 0, 0.08))
    mid = b2 + d * (length * 0.5) + Vector((-0.01 * 1.0, 0, 0))
    tip = b2 + d * length + Vector((-0.04, 0, -0.01))
    rings = []
    e1, e2, a = geo.basis(d, (1, 0, 0))
    for (c, r) in ((b2, 0.012), (mid, 0.009), (tip, 0.006)):
        rings.append([c + e1 * r * math.cos(2 * math.pi * k / 4) + e2 * r * math.sin(2 * math.pi * k / 4) for k in range(4)])
    for i in range(2):
        for k in range(4):
            k2 = (k + 1) % 4
            pc.face([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], tex)
    pc.face(rings[2], tex)


def build_whip_short(f, side=None):
    loc, n = _back_hit(f, -0.12, 1.30)
    pc = Piece(f.world())
    _whip(pc, loc + n * (SENSOR_OFF + 0.07), 8.0, 0.85)
    return pc


def build_whip_long(f, side=None):
    loc, n = _back_hit(f, -0.12, 1.30)
    pc = Piece(f.world())
    _whip(pc, loc + n * (SENSOR_OFF + 0.07 + 0.13 * 0.5), 8.0, 1.25)
    return pc


def build_eud(f, side=None):
    """A phone in a frame on the plate, as a conformed pad whose standoff is trimmed against the
    clips: where an arm, the stock or the chin comes within reach in any key it sinks to that
    height plus 3.5 mm (flat on the plate where nothing does: 22 + 16 mm)."""
    ey, ez = EUD_AT
    loc, n = _front_hit(f, ey, ez)
    fr = _frame(n)
    pc = Piece(f.world(), open_thick=EUD_T)
    pts, who = f.bank.blockers(f.prefix, "spine", (f.O[0] - 0.7, f.O[1] - 0.7, ez - 0.2), (f.O[0] + 0.7, f.O[1] + 0.7, ez + 0.2))
    gap = 0.001

    def vfn(j, i, H, N):
        cap = PLATE_OFF + EUD_T
        for qi, q in enumerate(pts):
            d = Vector(q) - H
            g = d.dot(N)
            if g < -0.002 or g > 0.09:
                continue
            lat = (d - N * g).length
            if lat > 0.045:
                continue
            # the sleeve and deltoid stand 10 mm proud of the upper arm: they are part of what sweeps here
            pad_arm = 0.016 if str(who[qi]).startswith("upperarm") else 0.0
            cap = min(cap, g - pad_arm + ALLOW_DEFAULT)
        h_out = max(0.003, cap)
        base = min(PLATE_OFF, h_out - 0.0015)
        return base, h_out - base - gap
    geo.pad(pc, f.zone_torso, loc, -n, fr.col[1], fr.col[2], 0.17, 0.09, EUD_T, 2, 2, "glass", gap=gap, rim_frac=0.9,
            rim_tex="olive_dark", vertex_fn=vfn)
    return pc


def _build_radio_pack_box(f):
    """A man-pack radio as a real object (PRC-117G class in a small pack, 0.13 deep x 0.26 wide x 0.30 tall): a flat-sided body with
    a separate lid, seated flat on the back plate. The plate's plane is read off the vest at two heights, so the box leans with the
    back; nothing is conformed into a hump. The two shoulder straps are the Rifle Squad's."""
    if kp.TEAM.pack_median:
        # a baked back is not watertight: a ray down the middle can pass through a gap and hit the FRONT wall (breach, z 1.40: 30 cm
        # off). The plate's plane is read as the median of five rays across the back at each height, so one gap cannot tilt the pack.
        def _med(z):
            hs = [_back_hit(f, y, z)[0] for y in (-0.10, -0.05, 0.0, 0.05, 0.10)]
            hs = [h for h in hs if h is not None]
            xs = sorted(h.x for h in hs)
            return Vector((xs[len(xs) // 2], f.O[1], z))
        p1, p2 = _med(1.16), _med(1.40)
        t = (p2 - p1).normalized()
    else:
        p1, _n1 = _back_hit(f, 0.0, 1.16)
        p2, _n2 = _back_hit(f, 0.0, 1.40)
        t = (p2 - p1).normalized()                       # up along the plate
    out = Vector((-1.0, 0.0, 0.0))
    nrm = (out - t * out.dot(t)).normalized()        # outward, perpendicular to the plate
    ydir = t.cross(nrm)
    R = Matrix(((nrm.x, ydir.x, t.x), (nrm.y, ydir.y, t.y), (nrm.z, ydir.z, t.z)))
    loc, _n = (_med(1.25), None) if kp.TEAM.pack_median else _back_hit(f, 0.0, 1.25)
    depth, width, height, lid_h = 0.13, 0.26, 0.30, 0.032
    seat = 0.012                                     # the carrier's back plate is 10 mm: the pack stands on it
    base = loc + nrm * (seat + depth / 2)
    pc = Piece(f.world(), open_thick=None)
    body_h = height - lid_h
    # body: flat sides, a 6 mm bevel round the section and the top edge
    geo.rbox(pc, base - t * (lid_h / 2), R, (depth, width, body_h), 0.006, "olive", cz_top=0.004, cap_bot=True)
    # lid: a shallow cover standing 6 mm proud of the body all round, a darker tone
    geo.rbox(pc, base + t * (height / 2 - lid_h / 2), R, (depth + 0.012, width + 0.012, lid_h), 0.0, "olive_dark")
    # two shoulder straps (0.04 wide, 8 mm thick) from the pack top up over the shoulders, standing on the plate
    for sg in (-1.0, 1.0):
        a0, na = _back_hit(f, sg * 0.085, 1.40)
        a1, nb = _back_hit(f, sg * 0.085, 1.45)
        if a0 is None or a1 is None:
            continue
        d = (a1 - a0).normalized()
        nn = ((na + nb) * 0.5)
        nn = (nn - d * nn.dot(d)).normalized()
        yy = d.cross(nn)
        Rs = Matrix(((nn.x, yy.x, d.x), (nn.y, yy.y, d.y), (nn.z, yy.z, d.z)))
        geo.rbox(pc, (a0 + a1) * 0.5 + nn * (0.012 + 0.004), Rs, (0.008, 0.04, (a1 - a0).length + 0.02), 0.0, "coyote_shade")
    return pc


def build_radio_pack(f, side=None):
    if kp.TEAM.pack_box:
        return _build_radio_pack_box(f)
    loc, n = _back_hit(f, 0.0, 1.25)
    pc = Piece(f.world(), open_thick=0.04)
    geo.pad(pc, f.zone_torso, loc, -n, (0, 1, 0), (0, 0, 1), 0.26, 0.30, 0.13, 6, 3, "olive", base_off=SENSOR_OFF)
    for sg in (-1.0, 1.0):
        # shoulder straps: 0.04 wide, over the shoulder, 3 segments each
        pts = []
        for zz in (1.40, 1.42, 1.44, 1.45):
            l2, n2 = _back_hit(f, sg * 0.085, zz)
            if l2 is None:
                l2, n2 = loc, n
            pts.append(l2 + n2 * (0.022 + 0.004))
        for i in range(3):
            a0, a1 = pts[i], pts[i + 1]
            pc.face([a0 - Vector((0, 0.02, 0)), a0 + Vector((0, 0.02, 0)), a1 + Vector((0, 0.02, 0)), a1 - Vector((0, 0.02, 0))], "coyote_shade", hint=True)
    return pc


# ================================================================ FIREPOWER

def _belt_wrap(f, rows, ncols=16, span=None):
    cols = [i * 360.0 / ncols for i in range(ncols)] if span is None else span
    return Wrap(f.zone_lower, (f.O[0], f.O[1], 0.0), (0, 0, 1), (1, 0, 0), rows, cols,
                centre_fn=lambda t: Vector((0.0, 0.0, 0.0)), r_out=0.45, col_span=None if span is None else True,
                fill_rows=lambda j: True, default_r=0.18, rlim=(0.12, kp.TEAM.belt_rmax), ring_cap=kp.TEAM.belt_ring_cap)


def build_battle_belt(f, side=None):
    wr = _belt_wrap(f, [0.885, 0.9125, 0.94], 16)
    offs = [0.006, 0.012, 0.006]
    trim = trimmed(f, wr, "pelvis", 0.6, 1.1)
    off = lambda j, k: min(offs[j], trim.get((j, k), 9.0))
    P, mask, st = fit_wrap(wr, off, None, np.zeros((0, 3)), "battle_belt")
    pc = Piece(f.world(), open_thick=0.012)
    geo.grid(pc, P, "coyote_shade", mask=mask, cyclic=True)
    for j in range(3):
        for k in range(16):
            if P[j][k] is not None:
                pc.set_thick(P[j][k], off(j, k))
    pc.outward = lambda p, wr=wr: _radial_out(wr, p)
    return pc


def _belt_pouch(f, pc, deg, size, tex, ch, z, cz_top=0.0, off=0.03):
    wr = _belt_wrap(f, [z - 0.02, z, z + 0.02], span=[deg - 3, deg, deg + 3])
    wr.sample()
    r = max(x for row in wr.R for x in row if x is not None)
    th = math.radians(deg)
    d = Vector((math.cos(th), math.sin(th), 0))
    t = Vector((-math.sin(th), math.cos(th), 0))
    R = Matrix(((d.x, t.x, 0), (d.y, t.y, 0), (d.z, t.z, 1)))
    c = Vector((f.O[0], f.O[1], z)) + d * (r + off + size[0] * 0.5)
    geo.rbox(pc, c, R, size, ch, tex, cz_top=cz_top)
    return c, R


def _pouch_centre(f, deg, size, z, off=0.03):
    """Where `_belt_pouch` would put a pouch at `deg` (centre and frame), without building it."""
    wr = _belt_wrap(f, [z - 0.02, z, z + 0.02], span=[deg - 3, deg, deg + 3])
    wr.sample()
    r = max(x for row in wr.R for x in row if x is not None)
    th = math.radians(deg)
    d = Vector((math.cos(th), math.sin(th), 0))
    t = Vector((-math.sin(th), math.cos(th), 0))
    R = np.array(((d.x, t.x, 0), (d.y, t.y, 0), (d.z, t.z, 1)))
    return np.array(Vector((f.O[0], f.O[1], z)) + d * (r + off + size[0] * 0.5)), R


def _pouch_clash(pts, c, R, size):
    """Deepest a blocker point (another bone's vertex, in some key of a living clip) lies inside the pouch box, in metres."""
    if len(pts) == 0:
        return 0.0
    h = np.array(size) / 2.0
    loc = (pts - c) @ R
    inside = (np.abs(loc) < h).all(1)
    if not inside.any():
        return 0.0
    return float((h - np.abs(loc[inside])).min(1).max())


def _clear_pouches(f, degs, size, z, off=0.03, ok=0.002):
    """The pouches' angles, shifted together by the smallest turn (0, +-10, +-20 ... +-120 deg) at which no other bone's geometry
    (forearm, hand, spine-bound baggage) comes inside any pouch in any key of any living clip: a pouch sits where it clears, as
    a man wears it. A team whose belt line is already clear keeps the nominal angles (turn 0)."""
    if not kp.TEAM.clear_pouches:
        return list(degs)
    z0 = z - 0.14
    lo = (f.O[0] - 0.7, f.O[1] - 0.7, z0)
    hi = (f.O[0] + 0.7, f.O[1] + 0.7, z + 0.14)
    pts, _who = f.bank.blockers(f.prefix, "pelvis", lo, hi)
    pts = np.array(pts)
    best = None
    for k in range(0, 25):
        turn = 0 if k == 0 else (10 * ((k + 1) // 2)) * (1 if k % 2 else -1)
        worst = 0.0
        for dg in degs:
            c, R = _pouch_centre(f, dg + turn, size, z, off)
            worst = max(worst, _pouch_clash(pts, c, R, size))
        if best is None or worst < best[0] - 1e-9:
            best = (worst, turn)
        if worst <= ok:
            break
    worst, turn = best
    REPORT.append({"part": "pouch angles", "figure": f.prefix, "nominal": list(degs), "turn_deg": turn, "residual_mm": round(1000 * worst, 2)})
    return [dg + turn for dg in degs]


def build_mag_pouches(f, side=None):
    pc = Piece(f.world())
    size = (0.06, 0.08, 0.12)
    for deg in _clear_pouches(f, (270.0, 240.0), size, MAG_Z):          # 9 and 8 o'clock (left hip, rear of it), turned where a hand or the baggage would strike them
        _belt_pouch(f, pc, deg, size, "coyote", 0.012, MAG_Z)
    return pc


def build_grenade_pouches(f, side=None):
    pc = Piece(f.world())
    size = (0.055, 0.075, 0.11)
    for deg in _clear_pouches(f, (120.0, 150.0), size, 0.855):          # 4 and 5 o'clock (right rear), likewise
        _belt_pouch(f, pc, deg, size, "coyote", 0.0, 0.855, cz_top=0.008)
    return pc


def _rail_top(f, u0, u1):
    """Highest weapon point between two stations (u negative = behind the muzzle)."""
    if f.wbvh is not None:
        return f.rail_top(u0, u1)
    m = (f.wl[:, 0] >= u0) & (f.wl[:, 0] <= u1)
    return float(f.wl[m, 2].max()) if m.any() else 0.06


def build_red_dot(f, side=None):
    top = _rail_top(f, -0.46, -0.36)
    ax = top + 0.039 - 0.012
    pc = Piece(f.wpn())
    geo.lathe(pc, (-0.46, 0.0, ax), (1, 0, 0), (0, 0, 1), [(0.0, 0.015), (0.064, 0.015)], 8, "coyote",
              cap0="glass", cap1="glass")
    geo.rbox(pc, (-0.43, 0.0, top + 0.006 + 0.0), Matrix.Identity(3), (0.05, 0.026, 0.012 + (ax - 0.015 - top) * 1.0), 0.0, "coyote")
    return pc


def build_foregrip(f, side=None):
    gb = kp.TEAM.foregrip_back
    top, bot, wlo, whi = f.station(gb)
    wc = (wlo + whi) / 2
    pc = Piece(f.wpn())
    geo.lathe(pc, (-gb, wc, bot + 0.002), (0, 0, -1), (1, 0, 0), [(0.0, 0.016), (0.09, 0.0145), (0.10, 0.0)], 8, "coyote",
              cap0="coyote")
    return pc


def build_lpvo(f, side=None):
    u0 = LPVO_REAR if kp.TEAM.lpvo_rear is None else kp.TEAM.lpvo_rear          # the rear of the eyepiece, metres behind the muzzle (spec: 0.55 to 0.285)
    top = _rail_top(f, u0 + 0.05, u0 + 0.25)
    ax = top + 0.040 + 0.015
    pc = Piece(f.wpn())
    geo.lathe(pc, (u0, 0.0, ax), (1, 0, 0), (0, 0, 1),
              [(0.0, 0.022), (0.06, 0.0150), (0.24, 0.0150), (0.265, 0.019)], 8, "coyote", cap0="glass", cap1="glass")
    # the cantilever mount, and the two turrets (elevation on top, windage on the right)
    um = u0 + 0.12
    geo.rbox(pc, (um, 0.0, ax - 0.0075 - 0.5 * (ax - 0.015 - top)), Matrix.Identity(3), (0.07, 0.022, ax - 0.015 - top), 0.0, "coyote")
    geo.rbox(pc, (um + 0.03, 0.0, ax + 0.0225), Matrix.Identity(3), (0.014, 0.014, 0.017), 0.0, "coyote", cap_bot=False)
    geo.rbox(pc, (um + 0.03, -0.0225, ax), Matrix.Identity(3), (0.014, 0.017, 0.014), 0.0, "coyote", cap_bot=False)
    return pc


def build_laser_box(f, side=None):
    uf = LASER_FRONT if kp.TEAM.laser_front is None else kp.TEAM.laser_front         # the front face, behind the muzzle
    L, Wd, Hh = kp.TEAM.laser_dims or (0.109, 0.069, 0.038)
    where = kp.TEAM.laser_side
    pc = Piece(f.wpn())
    if where == "top":
        top = _rail_top(f, uf - L, uf)
        c = (uf - L / 2, 0.0, top + Hh / 2)
        size = (L, Wd, Hh)
    else:
        # on the handguard's side rail: 9 o'clock (`L`, the gun's left, +w) or 3 o'clock (`R`), standing off the rail's face by half its width
        top, bot, wlo, whi = f.station(-(uf - L / 2))
        sgn = 1.0 if where == "L" else -1.0
        edge = whi if where == "L" else wlo
        c = (uf - L / 2, edge + sgn * Wd / 2, 0.5 * (top + bot) + 0.004)
        size = (L, Wd, Hh)
    geo.rbox(pc, c, Matrix.Identity(3), size, 0.004 if where != "top" else 0.005, "coyote")
    # the aperture faces on the front: a visible window and an IR window, in glass
    if where == "top":
        for sg in (-1.0, 1.0):
            pc.face([(uf + 0.0005, sg * 0.022 - 0.008, top + 0.019 - 0.008), (uf + 0.0005, sg * 0.022 + 0.008, top + 0.019 - 0.008),
                     (uf + 0.0005, sg * 0.022 + 0.008, top + 0.019 + 0.008), (uf + 0.0005, sg * 0.022 - 0.008, top + 0.019 + 0.008)], "glass")
    else:
        for dz in (-0.008, 0.008):
            pc.face([(uf + 0.0005, c[1] - 0.007, c[2] + dz - 0.0045), (uf + 0.0005, c[1] + 0.007, c[2] + dz - 0.0045),
                     (uf + 0.0005, c[1] + 0.007, c[2] + dz + 0.0045), (uf + 0.0005, c[1] - 0.007, c[2] + dz + 0.0045)], "glass")
    return pc


def build_weapon_light(f, side=None):
    top, bot, wlo, whi = f.station(0.19)
    pc = Piece(f.wpn())
    zc = (top + bot) / 2
    geo.lathe(pc, (-0.26, wlo - 0.0125, zc), (1, 0, 0), (0, 0, 1), [(0.0, 0.0125), (0.14, 0.0125)], 8, "coyote",
              cap0="coyote", cap1="glass")
    return pc


def build_suppressor(f, side=None):
    pc = Piece(f.wpn())
    geo.lathe(pc, (-0.015, 0.0, 0.0), (1, 0, 0), (0, 0, 1), [(0.0, 0.019), (0.15, 0.019), (0.165, 0.0155)], 8, "coyote",
              cap0="coyote", cap1="glass")
    return pc


PRISM_REAR = -0.48     # a 4x prism sight's rear, metres behind the muzzle: over the upper receiver (the stock begins behind it)


def build_prism_sight(f, side=None):
    """An ACOG-class 4x prism sight, 0.145 m long: a tapered body (rear eyepiece dia 0.032, front objective dia 0.052) on a rail mount,
    seated on the upper receiver. Lower and shorter than the 0.265 m LPVO, so it sits over the receiver and clear of the thigh in
    the pinned clip (the lead, 30 Oct: real stations, never an unreal one)."""
    u0 = PRISM_REAR
    top = _rail_top(f, u0 + 0.03, u0 + 0.12)
    ax = top + 0.040
    pc = Piece(f.wpn())
    geo.lathe(pc, (u0, 0.0, ax), (1, 0, 0), (0, 0, 1),
              [(0.0, 0.016), (0.03, 0.020), (0.115, 0.020), (0.145, 0.026)], 8, "coyote", cap0="glass", cap1="glass")
    geo.rbox(pc, (u0 + 0.075, 0.0, top + 0.5 * (ax - 0.016 - top) + 0.003), Matrix.Identity(3), (0.07, 0.030, max(0.012, ax - 0.016 - top) + 0.006), 0.0, "coyote")
    return pc


def build_shield_light(f, side=None):
    """A weapon light clamped on the top edge of the ballistic shield, at its right-hand end (the shooter's right is +y),
    pointing forward: 0.15 x dia 0.040 (a handheld-light class body), eight sides, the lens a glass face. Its axis sits 4 mm
    into the shield's top edge, which is the clamp. Riding the shield's own bone, it lifts with the shield in `move`."""
    lo, hi = f.shield
    x = 0.5 * (lo[0] + hi[0]) + 0.02           # the body straddles the shield's thickness, the lens 5 cm proud of its face
    y = hi[1] - 0.05
    z = hi[2] + 0.016
    pc = Piece(f.world())
    geo.lathe(pc, (x - 0.075, y, z), (1, 0, 0), (0, 0, 1), [(0.0, 0.020), (0.15, 0.020)], 8, "olive_dark",
              cap0="olive_dark", cap1="glass")
    return pc


BUILDERS = {
    "shield_light": build_shield_light,
    "prism_sight": build_prism_sight,
    "carrier": build_carrier,
    "helmet_cover": build_helmet_cover,
    "deltoid": build_deltoid,
    "sleeve": build_sleeve,
    "throat": build_throat,
    "yoke": build_yoke,
    "groin": build_groin,
    "headset": build_headset,
    "nvg_mount": build_nvg_mount,
    "ir_strobe": build_ir_strobe,
    "nvg_mono": build_nvg_mono,
    "counterweight": build_counterweight,
    "radio_pouch": build_radio_pouch,
    "radio_panel": build_radio_panel,
    "whip_short": build_whip_short,
    "nvg_bino": build_nvg_bino,
    "eud": build_eud,
    "radio_pack": build_radio_pack,
    "whip_long": build_whip_long,
    "battle_belt": build_battle_belt,
    "mag_pouches": build_mag_pouches,
    "red_dot": build_red_dot,
    "foregrip": build_foregrip,
    "lpvo": build_lpvo,
    "laser_box": build_laser_box,
    "weapon_light": build_weapon_light,
    "suppressor": build_suppressor,
    "grenade_pouches": build_grenade_pouches,
}


# --------------------------------------------------------------------- build

TRACK_OF = {p.name: p for p in kp.PARTS}


def build(repo, arm, meshes, mat, only=None, figs=None):
    """Add every kit object to the scene, bound to the shipped skin. Returns the table."""
    sys.path.insert(0, os.path.join(repo, "tools"))
    sys.path.insert(0, os.path.join(repo, "tools", "units"))
    import rig  # noqa: E402  (PART_BONE, rig_parts)

    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    use = [pf for pf in kp.ALL if figs is None or pf in figs]
    fits = {p: kf.Fit(arm, meshes, p) for p in use}
    bank = kf.PoseBank(arm, meshes, fits, stride=kp.TEAM.bank_stride)
    for p in use:
        fits[p].bank = bank
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    objs, rows, forced = [], [], {}
    if kp.TEAM.weapon_bone != "weapon":
        # a gun bound to the spine carries its accessories in the torso's own frame, so they sweep through the belt and the legs
        # as the pelvis and thighs move: the wraps and pouches on those bones are trimmed against them (built once here, discarded)
        for part in kp.PARTS:
            if part.bone != "weapon" or (only and part.name not in only) or part.name not in BUILDERS:
                continue
            for pf in use:
                if pf in part.figs:
                    pc = BUILDERS[part.name](fits[pf], None)
                    pts = np.array([v.co[:] for v in pc.bm.verts])
                    pc.bm.free()
                    bank.rigid.append((f"{pf}_{kp.TEAM.weapon_bone}", pts, "kit:" + part.name))
    for part in kp.PARTS:
        if only and part.name not in only:
            continue
        if part.name not in BUILDERS:
            continue
        for pf in use:
            if pf not in part.figs:
                continue
            for suf, _base in kp.object_suffixes(part):
                side = suf[-1] if suf[-2] == "_" and suf[-1] in "LR" else None
                piece = BUILDERS[part.name](fits[pf], side)
                oname = f"{pf}_{suf}"
                open_thick = piece.open_thick
                me, tris = piece.finish(oname)
                me.materials.append(bpy.data.materials["BakedMaterial"])
                ob = bpy.data.objects.new(oname, me)
                bpy.context.collection.objects.link(ob)
                if part.bone == "weapon" and kp.TEAM.weapon_bone != "weapon":
                    # the gun is bound to another bone (breach: `spine`): its accessories ride that bone, named here, not guessed
                    forced[ob] = f"{pf}_{kp.TEAM.weapon_bone}"
                ob["rl_role"] = part.role
                ob["rl_kit"] = json.dumps({"track": part.track, "tier": part.tier, "slot": part.slot,
                                           "part": part.name, "figure": pf})
                if open_thick:
                    ob["rl_open"] = 1
                    ob["rl_thick"] = float(open_thick)
                objs.append(ob)
                rows.append((ob, part, pf, tris))
    rig.rig_parts(objs, arm, forced, list(use))
    return rows


# ------------------------------------------------------------- state / views

def _side_of(ob):
    return ob.name[-2:] if ob.name[-2] == "_" and ob.name[-1] in "LR" else ""


def show(rows, tiers):
    """Show the kit a squad with `tiers` ({track: 0..3}) has bought: every part
    at or below its track's tier, but only the HIGHEST tier in each slot
    (a red dot gives way to the LPVO; spec section 2.1, slot supersession)."""
    best = {}
    for ob, part, pf, _ in rows:
        if part.tier > tiers.get(part.track, 0):
            continue
        if part.slot:
            key = (pf, part.slot, _side_of(ob))
            if key not in best or part.tier > best[key]:
                best[key] = part.tier
    for ob, part, pf, _ in rows:
        on = part.tier <= tiers.get(part.track, 0)
        if on and part.slot:
            key = (pf, part.slot, _side_of(ob))
            on = part.tier == best[key]
        ob.hide_render = not on
        ob.hide_viewport = not on
