"""Geometry primitives for the infantry upgrade kit redesign (GH-826, "real gear, fitted").

Blender-only. No figure knowledge lives here: `inf_kit.py` measures the figure
and calls these. Everything is deterministic and hand-rolled (no
`mathutils.noise`).

What a `Piece` is: one kit part's faces, authored in a local frame `M` (a 4x4
into the GLB's bind frame) with shared vertices (merged to 0.1 mm), SMOOTH
shading everywhere, and sharp edges only at a fold of `SHARP_DEG` (40) or more
(rims, box ends, lens faces). Each face carries a texel name; `finish` writes a
UV on that texel of the team's own atlas for every loop (pinned UVs: no new
texture, no new material).

Primitives:
  * `lathe`   a surface of revolution with a profile of (t, radius) rings
  * `rbox`    a rounded box: an octagon (corner chamfers) prism, optional end chamfers
  * `grid`    a quad grid of 3D points, optionally with a mask (soft goods, pads)
  * `rim`     a rolled rim along a grid's open edges (the edge turned in)
  * `Wrap`    a shrink-wrap: a regular grid projected onto a body zone along rays
              (the "fitted to the figure's own surface" soft goods), with a
              radial poke-through check and fixer
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

SHARP_DEG = 40.0

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import inf_kit_parts as kp  # noqa: E402


def texel_uv(name):
    px, py = kp.TEXELS[name]
    return ((px + 0.5) / kp.ATLAS_W, 1.0 - (py + 0.5) / kp.ATLAS_H)


class Piece:
    """One part's faces. `M` takes authored (local) coordinates into the bind frame."""

    def __init__(self, frame=None, open_thick=None):
        self.M = frame if frame is not None else Matrix.Identity(4)
        self.bm = bmesh.new()
        self.layer = self.bm.faces.layers.int.new("tex")
        self.hlayer = self.bm.faces.layers.int.new("hint")   # 1: oriented by `outward` (open shells), 0: by closed-volume recalculation
        self.texels = []
        self._vmap = {}
        self.open_thick = open_thick      # set for an open soft-goods shell: its solid depth for the clash census
        self.outward = None               # optional hint for open shells: world pos -> outward Vector
        self.vthick = {}                  # world point key -> the part's physical depth there (an open shell's solid, for the clash census)

    # -- vertices and faces -------------------------------------------------
    def _tex(self, name):
        if name not in self.texels:
            self.texels.append(name)
        return self.texels.index(name)

    def V(self, p):
        w = self.M @ Vector(p)
        key = (round(w.x * 1e4), round(w.y * 1e4), round(w.z * 1e4))
        v = self._vmap.get(key)
        if v is None:
            v = self.bm.verts.new(w)
            self._vmap[key] = v
        return v

    @staticmethod
    def key(w):
        return (round(w.x * 1e4), round(w.y * 1e4), round(w.z * 1e4))

    def set_thick(self, p, t):
        """Record the part's physical depth below world point `p` (frame-local p is mapped through M)."""
        self.vthick[self.key(self.M @ Vector(p))] = float(t)

    def face(self, pts, tex, flip=False, hint=False):
        vs = [self.V(p) for p in pts]
        out = []
        for v in vs:
            if not out or out[-1] is not v:
                out.append(v)
        if len(out) > 1 and out[0] is out[-1]:
            out.pop()
        if len(set(id(v) for v in out)) < 3:
            return None
        if flip:
            out.reverse()
        try:
            f = self.bm.faces.new(out)
        except ValueError:
            return None
        f[self.layer] = self._tex(tex)
        f[self.hlayer] = 1 if hint else 0
        return f

    # -- finishing ----------------------------------------------------------
    def finish(self, name):
        bm = self.bm
        closed = [f for f in bm.faces if not f[self.hlayer]]
        if closed:
            bmesh.ops.recalc_face_normals(bm, faces=closed)
        for f in bm.faces:
            if f[self.hlayer] and self.outward is not None:
                if f.normal.dot(self.outward(f.calc_center_median())) < 0:
                    f.normal_flip()
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
        cos_lim = math.cos(math.radians(SHARP_DEG))
        for e in bm.edges:
            if len(e.link_faces) == 2:
                a, b = e.link_faces
                e.smooth = a.normal.dot(b.normal) > cos_lim
            else:
                e.smooth = True
        for f in bm.faces:
            f.smooth = True
        me = bpy.data.meshes.new(name)
        uv = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            u, v = texel_uv(self.texels[f[self.layer]])
            for lp in f.loops:
                lp[uv].uv = (u, v)
        tris = len(bm.faces)
        bm.to_mesh(me)
        bm.free()
        if self.open_thick:
            attr = me.attributes.new("rl_thick", "FLOAT", "POINT")
            for i, v in enumerate(me.vertices):
                attr.data[i].value = self.vthick.get(self.key(v.co), self.open_thick)
        return me, tris


# ------------------------------------------------------------------ helpers

def basis(axis, up=None):
    """(e1, e2, a) right-handed orthonormal frame with `a` = axis, e1 toward `up` when given."""
    a = Vector(axis).normalized()
    ref = Vector(up) if up is not None else (Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0)))
    e1 = (ref - a * ref.dot(a))
    if e1.length < 1e-6:
        e1 = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 1, 0))
    e1.normalize()
    e2 = a.cross(e1).normalized()
    return e1, e2, a


def lathe(pc, origin, axis, up, profile, sides, tex, cap0=None, cap1=None, squash=1.0, phase=0.0):
    """A surface of revolution. `profile` = [(t, r), ...] along `axis` from `origin`;
    r == 0 closes the end to a point. `tex` is a name or a list per band;
    `cap0`/`cap1` name the texel of a flat end cap when that end has r > 0."""
    e1, e2, a = basis(axis, up)
    o = Vector(origin)
    rings = []
    for (t, r) in profile:
        c = o + a * t
        if r <= 1e-9:
            rings.append([c])
        else:
            rings.append([c + e1 * (r * math.cos(phase + 2 * math.pi * k / sides)) +
                          e2 * (r * squash * math.sin(phase + 2 * math.pi * k / sides)) for k in range(sides)])
    nb = len(profile) - 1
    texs = tex if isinstance(tex, (list, tuple)) else [tex] * nb
    for i in range(nb):
        A, B = rings[i], rings[i + 1]
        t_i = texs[i]
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1:
            for k in range(sides):
                pc.face([A[0], B[(k + 1) % sides], B[k]], t_i)
        elif len(B) == 1:
            for k in range(sides):
                pc.face([A[k], A[(k + 1) % sides], B[0]], t_i)
        else:
            for k in range(sides):
                k2 = (k + 1) % sides
                pc.face([A[k], A[k2], B[k2], B[k]], t_i)
    if cap0 and len(rings[0]) > 1:
        pc.face(list(reversed(rings[0])), cap0)
    if cap1 and len(rings[-1]) > 1:
        pc.face(rings[-1], cap1)


def rbox(pc, centre, R, size, ch, tex, cz_top=0.0, cz_bot=0.0, tex_top=None, tex_bot=None, cap_bot=True, cap_top=True, taper=0.0):
    """A rounded box: an octagonal prism (corners of the xy section chamfered by
    `ch`; ch = 0 gives a plain rectangle), extruded along local z, with optional
    end chamfers (`cz_top` / `cz_bot`: the end ring pulled in by that much in xy
    and stepped by it in z). `R` is a 3x3 (local -> frame)."""
    a, b, h = size[0] / 2, size[1] / 2, size[2] / 2
    ch = min(ch, a * 0.95, b * 0.95)
    c = Vector(centre)

    def section(inset):
        aa, bb = a - inset, b - inset
        cc = max(ch - inset * 0.5, 0.0)
        if cc <= 1e-6:
            return [(aa, -bb), (aa, bb), (-aa, bb), (-aa, -bb)]
        return [(aa, -(bb - cc)), (aa, bb - cc), (aa - cc, bb), (-(aa - cc), bb),
                (-aa, bb - cc), (-aa, -(bb - cc)), (-(aa - cc), -bb), (aa - cc, -bb)]

    levels = []
    if cz_bot > 0:
        levels += [(-h, cz_bot), (-h + cz_bot, 0.0)]
    else:
        levels += [(-h, 0.0)]
    if cz_top > 0:
        levels += [(h - cz_top, 0.0), (h, cz_top)]
    else:
        levels += [(h, taper)]
    rings = [[c + R @ Vector((x, y, z)) for (x, y) in section(inset)] for (z, inset) in levels]
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            pc.face([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], tex)
    if cap_bot:
        pc.face(list(reversed(rings[0])), tex_bot or tex)
    if cap_top:
        pc.face(rings[-1], tex_top or tex)


def grid(pc, P, tex, mask=None, cyclic=False, row_tex=None):
    """Quads over a grid of points P[j][k] (None = missing). `mask[j][k]` (cells,
    rows-1 x cols[-1]) False drops a cell. `row_tex[j]` overrides the texel per row."""
    rows = len(P)
    cols = len(P[0])
    ncell = cols if cyclic else cols - 1
    for j in range(rows - 1):
        for k in range(ncell):
            k2 = (k + 1) % cols
            q = [P[j][k], P[j][k2], P[j + 1][k2], P[j + 1][k]]
            if any(v is None for v in q):
                continue
            if mask is not None and not mask[j][k]:
                continue
            t = row_tex[j] if row_tex else tex
            pc.face(q, t, hint=True)


def surf_normals(P, cyclic):
    """Vertex normals of a grid by finite differences (right-handed in (k, j))."""
    rows, cols = len(P), len(P[0])
    N = [[None] * cols for _ in range(rows)]
    for j in range(rows):
        for k in range(cols):
            if P[j][k] is None:
                continue
            k0, k1 = (k - 1) % cols, (k + 1) % cols
            if not cyclic:
                k0, k1 = max(k - 1, 0), min(k + 1, cols - 1)
            j0, j1 = max(j - 1, 0), min(j + 1, rows - 1)
            a, b = P[j][k0], P[j][k1]
            c, d = P[j0][k], P[j1][k]
            if None in (a, b, c, d):
                a = a if a is not None else P[j][k]
                b = b if b is not None else P[j][k]
                c = c if c is not None else P[j][k]
                d = d if d is not None else P[j][k]
            n = (b - a).cross(d - c)
            N[j][k] = n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))
    return N


def boundary_edges(mask, rows, cols, cyclic):
    """Open edges of the valid cells: list of ((j, k), (j, k2)) vertex pairs."""
    out = []
    ncell = cols if cyclic else cols - 1

    def ok(j, k):
        if j < 0 or j >= rows - 1:
            return False
        if cyclic:
            k %= cols
        elif k < 0 or k >= ncell:
            return False
        return bool(mask[j][k]) if mask is not None else True
    for j in range(rows - 1):
        for k in range(ncell):
            if not ok(j, k):
                continue
            k2 = (k + 1) % cols
            if not ok(j - 1, k):
                out.append(((j, k), (j, k2)))                    # bottom edge of the cell
            if not ok(j + 1, k):
                out.append(((j + 1, k), (j + 1, k2)))            # top edge
            if not ok(j, k - 1):
                out.append(((j, k), (j + 1, k)))                 # left edge
            if not ok(j, k + 1):
                out.append(((j, k2), (j + 1, k2)))               # right edge
    return out


def rim(pc, P, N, edges, depth, tex, skip=None):
    """A rolled rim: each open edge's vertices turned in by `depth` along -normal
    (a quad strip). `depth` may be a number or f(j, k) -> metres."""
    d = depth if callable(depth) else (lambda j, k: depth)
    for (a, b) in edges:
        if skip is not None and skip(a, b):
            continue
        pa, pb = P[a[0]][a[1]], P[b[0]][b[1]]
        if pa is None or pb is None:
            continue
        qa = pa - N[a[0]][a[1]] * d(*a)
        qb = pb - N[b[0]][b[1]] * d(*b)
        pc.face([pa, pb, qb, qa], tex(a, b) if callable(tex) else tex, hint=True)


# ---------------------------------------------------------------- shrink wraps

def bvh_from(verts, tris):
    return BVHTree.FromPolygons([Vector(v) for v in verts], [tuple(t) for t in tris], epsilon=1e-6)


class Wrap:
    """A regular grid fitted to a body zone: rows along an axis, columns around it.

    `zone` is a BVH of the base figure's faces for this wrap. Each grid vertex is
    the OUTERMOST zone surface along a ray from the axis (cast inward from outside,
    so the first hit is the outermost), dilated over the cell's own footprint (the
    maximum of a 3 x 3 sub-sample, so the wrap clears the relief inside the cell),
    plus the part's offset. Nothing is placed in a box: the soft goods ARE the
    figure's surface, offset by the real fabric and plate thickness."""

    def __init__(self, zone, axis_o, axis_d, up, rows_t, cols_deg, centre_fn=None, r_out=0.9,
                 col_span=None, dilate=(0.5, 0.5), fill_rows=None, clamp=None, ellipse=None, rlim=None, default_r=None, fill_vertical=False, ring_cap=False, back_plate=False):
        self.zone = zone
        self.o = Vector(axis_o)
        self.e1, self.e2, self.a = basis(axis_d, up)
        self.rows_t = list(rows_t)
        self.cols = list(cols_deg)
        self.centre_fn = centre_fn
        self.r_out = r_out
        self.cyclic = col_span is None
        self.dil = dilate
        self.fill_rows = fill_rows     # f(j) -> True: a missing vertex in this row is bridged from its neighbours
        self.fill_vertical = fill_vertical   # a vertex no ray reached copies the nearest valid vertex above or below it
        self.default_r = default_r     # radius for a vertex no ray reached and no neighbour could bridge
        self.rlim = rlim               # (rmin, rmax): sampled radii are clamped (tames the base mesh's loose shards)
        self.ellipse = ellipse         # f(t) -> (ax, ay): a bridged vertex stays inside this section ellipse
        self.back_plate = back_plate     # flatten the columns nearest 180 deg (the back) onto a plane fitted to the row back walls
        self.ring_cap = ring_cap         # a cyclic wrap's SAMPLED radii are capped by the ring the row's own front and back walls imply
        self.clamp = clamp             # BVH: a bridged vertex stays inside its first surface from the axis
        self.R = None      # radius per vertex (without offset)

    def centre(self, t):
        c = self.o + self.a * t
        if self.centre_fn is not None:
            c = c + self.centre_fn(t)
        return c

    def dir(self, deg):
        r = math.radians(deg)
        return self.e1 * math.cos(r) + self.e2 * math.sin(r)

    def _hit(self, t, deg):
        c = self.centre(t)
        d = self.dir(deg)
        loc, nor, idx, dist = self.zone.ray_cast(c + d * self.r_out, -d, self.r_out + 0.05)
        if loc is None:
            return None
        return self.r_out - dist

    def sample(self):
        rows, cols = len(self.rows_t), len(self.cols)
        dts = [(self.rows_t[min(j + 1, rows - 1)] - self.rows_t[max(j - 1, 0)]) / 2 for j in range(rows)]
        dds = [(self.cols[min(k + 1, cols - 1)] - self.cols[max(k - 1, 0)]) / 2 for k in range(cols)]
        if self.cyclic:
            dds = [360.0 / cols] * cols
        self.R = [[None] * cols for _ in range(rows)]
        for j in range(rows):
            for k in range(cols):
                best = self._hit(self.rows_t[j], self.cols[k])
                if best is None:
                    continue
                for dj in (-self.dil[0], 0.0, self.dil[0]):
                    for dk in (-self.dil[1], 0.0, self.dil[1]):
                        if dj == 0.0 and dk == 0.0:
                            continue
                        r = self._hit(self.rows_t[j] + dj * dts[j], self.cols[k] + dk * dds[k])
                        if r is not None and r > best:
                            best = r
                if self.rlim is not None:
                    best = min(max(best, self.rlim[0]), self.rlim[1])
                self.R[j][k] = best
        if self.ring_cap and self.cyclic:
            self._apply_ring_cap()
        if self.fill_vertical:
            for k in range(cols):
                for j in range(rows - 2, -1, -1):
                    if self.R[j][k] is None and self.R[j + 1][k] is not None:
                        self.R[j][k] = self.R[j + 1][k]
                for j in range(1, rows):
                    if self.R[j][k] is None and self.R[j - 1][k] is not None:
                        self.R[j][k] = self.R[j - 1][k]
        if self.fill_rows is not None:
            for j in range(rows):
                if not self.fill_rows(j):
                    continue
                row = self.R[j]
                have = [k for k in range(cols) if row[k] is not None]
                if len(have) < 2 and self.default_r is not None:
                    for k in range(cols):
                        if row[k] is None:
                            row[k] = self.default_r
                    continue
                if len(have) < 2 or len(have) == cols:
                    continue
                for k in range(cols):
                    if row[k] is not None:
                        continue
                    # nearest valid on each side (cyclic when the ring is closed)
                    lo = hi = None
                    for d in range(1, cols):
                        kk = k - d
                        if kk < 0 and not self.cyclic:
                            break
                        if row[kk % cols] is not None:
                            lo = (d, row[kk % cols])
                            break
                    for d in range(1, cols):
                        kk = k + d
                        if kk >= cols and not self.cyclic:
                            break
                        if row[kk % cols] is not None:
                            hi = (d, row[kk % cols])
                            break
                    if lo and hi:
                        r = (lo[1] * hi[0] + hi[1] * lo[0]) / (lo[0] + hi[0])
                        if self.clamp is not None:
                            c = self.centre(self.rows_t[j])
                            d = self.dir(self.cols[k])
                            loc, nor, idx, dist = self.clamp.ray_cast(c, d, self.r_out)
                            if loc is not None:
                                r = min(r, dist - 0.003)
                            if self.ellipse is not None:
                                ax, ay = self.ellipse(self.rows_t[j])
                                th = math.radians(self.cols[k])
                                r = min(r, 1.0 / math.sqrt((math.cos(th) / ax) ** 2 + (math.sin(th) / ay) ** 2))
                        self.R[j][k] = r
                    elif self.default_r is not None:
                        self.R[j][k] = self.default_r
        return self.R

    def _apply_ring_cap(self, side_gain=1.08):
        """A baked figure's spine zone carries loose shards and spine-bound hands, so the outermost hit at the sides
        of a row can stand 0.15 m beyond the body. A torso section is a rounded box, not a free curve: take the row's FRONT
        wall (the MEDIAN sampled radius over the three columns nearest 0 deg, so one spike cannot set it) and BACK wall
        (nearest 180 deg), let the sides stand at most `side_gain` x the larger of the two, blend with cos^2 / sin^2, and let
        no sampled radius exceed that profile. Real radii below it (a narrow waist, a real armhole) are kept."""
        n = len(self.cols)
        self.ring_params = {}
        for j, row in enumerate(self.R):
            def wall(deg):
                ks = sorted(range(n), key=lambda k: abs(((self.cols[k] - deg + 180.0) % 360.0) - 180.0))[:3]
                v = sorted(row[k] for k in ks if row[k] is not None)
                return v[len(v) // 2] if v else None
            rf, rb = wall(0.0), wall(180.0)
            if rf is None or rb is None:
                continue
            rs = side_gain * max(rf, rb)
            self.ring_params[j] = (rf, rb, rs)
            for k in range(n):
                if row[k] is None:
                    continue
                th = math.radians(self.cols[k])
                c2, s2 = math.cos(th) ** 2, math.sin(th) ** 2
                row[k] = min(row[k], s2 * rs + c2 * (rf if math.cos(th) >= 0 else rb))
        if self.back_plate:
            self._flatten_back()

    def _flatten_back(self, zmin=1.15, half_deg=24.0):
        """The back of a vest is a plate, not a barrel: fit a plane (radius = a + b z) to the rows' back walls above `zmin` and
        put the columns within `half_deg` of 180 deg on it, at plane / cos(angle off the back)."""
        js = [j for j, t in enumerate(self.rows_t) if t >= zmin and j in self.ring_params]
        if len(js) < 2:
            return
        a, b = np.polyfit([self.rows_t[j] for j in js], [self.ring_params[j][1] for j in js], 1)
        for j in js:
            plane = a * self.rows_t[j] + b
            for k, c in enumerate(self.cols):
                off = abs(((c - 180.0 + 180.0) % 360.0) - 180.0)
                if off <= half_deg:
                    self.R[j][k] = plane / math.cos(math.radians(off))

    def ring_radius(self, p):
        """The capped ring's radius at the world point `p`'s height and direction (None when the wrap has no ring cap)."""
        if not getattr(self, "ring_params", None):
            return None, None
        v = Vector(p) - self.o
        t = v.dot(self.a)
        c = self.centre(t)
        d = Vector(p) - c
        d -= self.a * d.dot(self.a)
        r = d.length
        if r < 1e-9:
            return None, r
        j = int(np.argmin([abs(t - rt) for rt in self.rows_t]))
        if j not in self.ring_params:
            return None, r
        rf, rb, rs = self.ring_params[j]
        th = math.atan2(d.dot(self.e2), d.dot(self.e1))
        c2, s2 = math.cos(th) ** 2, math.sin(th) ** 2
        return s2 * rs + c2 * (rf if math.cos(th) >= 0 else rb), r

    def points(self, off):
        """Grid of world points; `off` is a number or f(j, k) -> metres outward."""
        f = off if callable(off) else (lambda j, k: off)
        rows, cols = len(self.rows_t), len(self.cols)
        P = [[None] * cols for _ in range(rows)]
        for j in range(rows):
            for k in range(cols):
                if self.R[j][k] is None:
                    continue
                P[j][k] = self.centre(self.rows_t[j]) + self.dir(self.cols[k]) * (self.R[j][k] + f(j, k))
        return P

    # -- poke-through ---------------------------------------------------------
    def shell_radius(self, shell_bvh, p):
        """Radial distance from the axis at which the shell is hit along the ray to `p`."""
        v = Vector(p) - self.o
        t = v.dot(self.a)
        c = self.centre(t)
        d = Vector(p) - c
        d -= self.a * d.dot(self.a)
        r = d.length
        if r < 1e-9:
            return None, 0.0
        d /= r
        loc, nor, idx, dist = shell_bvh.ray_cast(c + d * self.r_out, -d, self.r_out + 0.05)
        if loc is None:
            return None, r
        return self.r_out - dist, r


def shell_bvh(P, mask, cyclic):
    verts, tris, index = [], [], {}
    rows, cols = len(P), len(P[0])

    def vid(j, k):
        if (j, k) not in index:
            index[(j, k)] = len(verts)
            verts.append(P[j][k])
        return index[(j, k)]
    ncell = cols if cyclic else cols - 1
    for j in range(rows - 1):
        for k in range(ncell):
            k2 = (k + 1) % cols
            if mask is not None and not mask[j][k]:
                continue
            q = [(j, k), (j, k2), (j + 1, k2), (j + 1, k)]
            if any(P[a][b] is None for a, b in q):
                continue
            ids = [vid(a, b) for a, b in q]
            tris.append((ids[0], ids[1], ids[2]))
            tris.append((ids[0], ids[2], ids[3]))
    if not tris:
        return None
    return bvh_from(verts, tris)


def surface_hit(zone, origin, direction, maxd=2.0):
    """(location, normal opposing the ray) of the first hit of a ray on a zone, or (None, None)."""
    d = Vector(direction).normalized()
    loc, nor, idx, dist = zone.ray_cast(Vector(origin), d, maxd)
    if loc is None:
        return None, None
    n = Vector(nor).normalized()
    if n.dot(d) > 0:
        n = -n
    return Vector(loc), n


def pad(pc, zone, centre, d_in, u_axis, v_axis, w, h, thick, cols, rows, tex, base_off=0.0,
        gap=0.001, rim_frac=0.35, skirt=True, rim_tex=None, vertex_fn=None):
    """A conformed pillow (bent pad): a w x h grid projected along `d_in` onto a zone,
    standing `thick` proud of the surface at its middle and `rim_frac * thick` at its
    edge (a rolled rim), with a skirt down to the surface. Open on its underside
    (`pc.open_thick` is set by the caller). Returns (outer grid, base-hit grid, mean normal)."""
    d_in = Vector(d_in).normalized()
    u, v, c = Vector(u_axis).normalized(), Vector(v_axis).normalized(), Vector(centre)
    H, N = [], []
    for j in range(rows + 1):
        rowH, rowN = [], []
        for i in range(cols + 1):
            uu = (i / cols - 0.5) * w
            vv = (j / rows - 0.5) * h
            # dilated: the outermost of five samples over the cell's own footprint, so a ridge between
            # two grid lines (the base helmet's pyramid) cannot stand through the pad
            best = None
            for du, dv in ((0, 0), (0.5, 0), (-0.5, 0), (0, 0.5), (0, -0.5)):
                p0 = c + u * (uu + du * w / cols) + v * (vv + dv * h / rows)
                l2, n2 = surface_hit(zone, p0 - d_in * 0.5, d_in)
                if l2 is not None and (best is None or (l2 - p0).dot(d_in) < (best[0] - best[2]).dot(d_in)):
                    best = (l2, n2, p0)
            nominal = c + u * uu + v * vv
            loc, n = ((nominal + d_in * (best[0] - nominal).dot(d_in), best[1]) if best else (None, None))
            if loc is None:
                loc, n = c + u * uu + v * vv, -d_in
            rowH.append(loc)
            rowN.append(n)
        H.append(rowH)
        N.append(rowN)
    nm = sum((n for r in N for n in r), Vector()).normalized()
    O = []
    BOFF = {}
    for j in range(rows + 1):
        row = []
        for i in range(cols + 1):
            prof = rim_frac + (1.0 - rim_frac) * math.sqrt(max(0.0, math.sin(math.pi * i / cols) * math.sin(math.pi * j / rows)))
            if vertex_fn is None:
                b_ij, t_ij = base_off, thick * prof
            else:
                b_ij, t_ij = vertex_fn(j, i, H[j][i], N[j][i])    # per-vertex base height and thickness
            BOFF[(j, i)] = b_ij
            row.append(H[j][i] + N[j][i] * (b_ij + gap + t_ij))
            pc.set_thick(row[-1], gap + t_ij)
        O.append(row)
    for j in range(rows):
        for i in range(cols):
            pc.face([O[j][i], O[j][i + 1], O[j + 1][i + 1], O[j + 1][i]], tex, hint=True)
    if skirt:
        loop = [(0, i) for i in range(cols)] + [(j, cols) for j in range(rows)] + \
               [(rows, i) for i in range(cols, 0, -1)] + [(j, 0) for j in range(rows, 0, -1)]
        for idx in range(len(loop)):
            (j0, i0), (j1, i1) = loop[idx], loop[(idx + 1) % len(loop)]
            a, b = O[j0][i0], O[j1][i1]
            a_s = H[j0][i0] + N[j0][i0] * (BOFF[(j0, i0)] + gap * 0.5)
            b_s = H[j1][i1] + N[j1][i1] * (BOFF[(j1, i1)] + gap * 0.5)
            pc.set_thick(a_s, 0.0015)
            pc.set_thick(b_s, 0.0015)
            pc.face([a, b, b_s, a_s], rim_tex or tex, hint=True)
    cavity = sum((x for r in H for x in r), Vector()) / ((rows + 1) * (cols + 1)) - nm * (base_off + 0.05)
    pc.outward = lambda p, cav=cavity: p - cav
    return O, H, nm
