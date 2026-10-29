"""Infantry upgrade kit parts for `inf_squad` (GH-826), built in Blender.

    blender -b -P tools/render_inf_kit.py -- ...      (the render tool calls build())

This is the *part build*: it imports the SHIPPED team GLB, measures each
figure at its bind pose, and adds every kit part of `inf_kit_parts.PARTS` as a
skinned object, rigidly bound (one part, one vertex group, one bone, weight 1)
through `rig.rig_parts`, so a part with no `PART_BONE` entry raises exactly as
for any other part. No hand posing, no weight painting, no clips: parts ride
the shipped bones in every shipped clip.

Rules kept (spec 26 Oct, §2.1):
  * additive only: nothing of the base figure is touched;
  * real vertex coordinates, object scale 1, no `mathutils.noise`;
  * pinned UVs on a texel of the team's own atlas, zero new textures or
    materials (every kit object uses the file's one `BakedMaterial`);
  * no lower-leg kit; parts stay out of the boot zone (z > 0.55).

Coordinates. The GLB's forward is +x and the importer keeps it (Blender Z up,
figures stand at x -0.45/0.45, y -1.05/0/1.05). A part is authored in one of
two frames: FIGURE (origin on the ground under the figure's root, x forward,
y to the figure's left, z up) or WEAPON (origin at the muzzle, u along the
barrel, w to the weapon's left, v up), both measured per figure from the
shipped geometry, so a part follows each figure's own build.
"""
import hashlib
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import inf_kit_parts as kp  # noqa: E402

ATLAS_W, ATLAS_H = 2048, 1024
HELMET_Z0 = 1.56      # above this, head-bound uniform verts are the helmet
ARM_RADIUS = 0.06


def texel_uv(name):
    px, py = kp.TEXELS[name]
    return ((px + 0.5) / ATLAS_W, 1.0 - (py + 0.5) / ATLAS_H)


# --------------------------------------------------------------- primitives

class Piece:
    """One part's geometry, authored in a frame and appended as faces."""

    def __init__(self, frame):
        self.M = frame
        self.bm = bmesh.new()
        self.layer = self.bm.faces.layers.int.new("tex")
        self.texels = []

    def _tex(self, name):
        if name not in self.texels:
            self.texels.append(name)
        return self.texels.index(name)

    def _emit(self, verts, faces, texel, face_texels=None):
        t = self._tex(texel)
        vs = [self.bm.verts.new(self.M @ Vector(v)) for v in verts]
        for i, f in enumerate(faces):
            face = self.bm.faces.new([vs[k] for k in f])
            face[self.layer] = self._tex(face_texels[i]) if face_texels and face_texels[i] else t

    # -- a bevelled box: 8 corners chamfered to 44 triangles -----------------
    def box(self, size, centre, texel, bevel=0.012, rot=None):
        sx, sy, sz = (s / 2 for s in size)
        b = min(bevel, sx * 0.9, sy * 0.9, sz * 0.9)
        R = rot if rot is not None else Matrix.Identity(3)
        c = Vector(centre)
        if bevel <= 0.0:                      # a plain 12-triangle cuboid
            verts = [tuple(c + R @ Vector((sx * a, sy * b_, sz * c_)))
                     for a in (-1, 1) for b_ in (-1, 1) for c_ in (-1, 1)]
            faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
            self._orient(verts, faces)
            self._emit(verts, faces, texel)
            return

        def P(x, y, z):
            return tuple(c + R @ Vector((x, y, z)))
        # chamfered cube: each of the 8 corners becomes a triangle, each edge a quad
        verts, idx = [], {}

        def V(ix, iy, iz, ax):
            key = (ix, iy, iz, ax)
            if key not in idx:
                dx = (sx - (b if ax != 0 else 0)) * ix
                dy = (sy - (b if ax != 1 else 0)) * iy
                dz = (sz - (b if ax != 2 else 0)) * iz
                idx[key] = len(verts)
                verts.append(P(dx, dy, dz))
            return idx[key]
        faces = []
        signs = (-1, 1)
        # big faces: normal axis `a`, sign s
        for a in range(3):
            for s in signs:
                others = [i for i in range(3) if i != a]
                quad = []
                for (p, q) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    cs = [0, 0, 0]
                    cs[a] = s
                    cs[others[0]] = p
                    cs[others[1]] = q
                    quad.append(V(cs[0], cs[1], cs[2], a))
                if s < 0:
                    quad.reverse()
                if a == 1:
                    quad.reverse()
                faces.append(quad)
        # edge strips between two big faces (a, sa) and (b2, sb)
        for a in range(3):
            for b2 in range(a + 1, 3):
                c3 = 3 - a - b2
                for sa in signs:
                    for sb in signs:
                        for_edge = []
                        for sc in signs:
                            cs = [0, 0, 0]
                            cs[a] = sa
                            cs[b2] = sb
                            cs[c3] = sc
                            for_edge.append((V(*cs, a), V(*cs, b2)))
                        (a0, b0), (a1, b1) = for_edge
                        quad = [a0, b0, b1, a1]
                        # orient outward
                        n = Vector((0, 0, 0))
                        n[a] = sa
                        n[b2] = sb
                        vs = [Vector(verts[i]) for i in quad]
                        fn = (vs[1] - vs[0]).cross(vs[2] - vs[1])
                        if fn.dot(R @ n) < 0:
                            quad.reverse()
                        faces.append(quad)
        # corner triangles
        for sx_ in signs:
            for sy_ in signs:
                for sz_ in signs:
                    tri = [V(sx_, sy_, sz_, 0), V(sx_, sy_, sz_, 1), V(sx_, sy_, sz_, 2)]
                    vs = [Vector(verts[i]) for i in tri]
                    fn = (vs[1] - vs[0]).cross(vs[2] - vs[1])
                    if fn.dot(R @ Vector((sx_, sy_, sz_))) < 0:
                        tri.reverse()
                    faces.append(tri)
        self._emit(verts, faces, texel)

    # -- a frustum between two points, optionally capped ---------------------
    def cyl(self, p0, p1, r0, r1, texel, sides=12, caps=(True, True), squash=1.0, cap1_texel=None):
        a, b = Vector(p0), Vector(p1)
        ax = (b - a).normalized()
        ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
        e1 = ax.cross(ref).normalized()
        e2 = ax.cross(e1).normalized() * squash
        verts, faces = [], []
        for (p, r) in ((a, r0), (b, r1)):
            for k in range(sides):
                t = 2 * math.pi * k / sides
                verts.append(tuple(p + e1 * (r * math.cos(t)) + e2 * (r * math.sin(t))))
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append([k, k2, sides + k2, sides + k])
        if caps[0]:
            faces.append(list(reversed(range(sides))))
        ftex = [None] * len(faces)
        if caps[1]:
            faces.append([sides + k for k in range(sides)])
            ftex.append(cap1_texel)
        self._orient(verts, faces)
        self._emit(verts, faces, texel, ftex)

    # -- a hollow ring (collar): outer and inner frusta joined --------------
    def ring(self, centre, r_out, r_in, height, texel, sides=16, ry_scale=1.0, bottom=True):
        c = Vector(centre)
        verts, faces = [], []
        for z in (-height / 2, height / 2):
            for r in (r_out, r_in):
                for k in range(sides):
                    t = 2 * math.pi * k / sides
                    verts.append(tuple(c + Vector((r * math.cos(t), r * ry_scale * math.sin(t), z))))
        n = sides

        def v(zi, ri, k):
            return (zi * 2 + ri) * n + k % n
        for k in range(n):
            faces.append([v(0, 0, k), v(0, 0, k + 1), v(1, 0, k + 1), v(1, 0, k)])      # outer wall
            faces.append([v(0, 1, k + 1), v(0, 1, k), v(1, 1, k), v(1, 1, k + 1)])      # inner wall
            faces.append([v(1, 0, k), v(1, 0, k + 1), v(1, 1, k + 1), v(1, 1, k)])      # top
            if bottom:
                faces.append([v(0, 0, k + 1), v(0, 0, k), v(0, 1, k), v(0, 1, k + 1)])  # bottom
        self._emit(verts, faces, texel)

    # -- a dome / ellipsoid, open below the clamp surface --------------------
    def dome(self, centre, radii, texel, seg=14, rings=6, z_clamp=None, rot=None):
        """Upper ellipsoid (z >= centre.z - clamp). `z_clamp(x, y) -> absolute z`
        lifts the rim onto a slanted plane (the front brim sits higher)."""
        c = Vector(centre)
        R = rot if rot is not None else Matrix.Identity(3)
        rx, ry, rz = radii
        verts, faces = [], []
        verts.append(tuple(c + R @ Vector((0, 0, rz))))
        for j in range(1, rings + 1):
            phi = (math.pi / 2) * (1 - j / rings * 1.18)       # past the equator, a little skirt
            for k in range(seg):
                t = 2 * math.pi * k / seg
                p = Vector((rx * math.cos(phi) * math.cos(t), ry * math.cos(phi) * math.sin(t), rz * math.sin(phi)))
                w = c + R @ p
                if z_clamp is not None:
                    w.z = max(w.z, z_clamp(w.x, w.y))
                verts.append(tuple(w))
        for k in range(seg):
            faces.append([0, 1 + (k + 1) % seg, 1 + k])
        for j in range(rings - 1):
            for k in range(seg):
                a = 1 + j * seg + k
                b = 1 + j * seg + (k + 1) % seg
                faces.append([a, b, b + seg, a + seg])
        self._orient(verts, faces)
        self._emit(verts, faces, texel)

    def _orient(self, verts, faces):
        # make every face wind outward from the part's own centroid
        cen = Vector((0, 0, 0))
        for v in verts:
            cen += Vector(v)
        cen /= len(verts)
        for f in faces:
            vs = [Vector(verts[i]) for i in f]
            fc = sum(vs, Vector()) / len(vs)
            n = (vs[1] - vs[0]).cross(vs[2] - vs[1])
            if n.dot(fc - cen) < 0 and len(f) >= 3:
                # caps: the centroid test is right for convex parts only
                f.reverse()

    def finish(self, name):
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name)
        uv = self.bm.loops.layers.uv.new("UVMap")
        for f in self.bm.faces:
            u, v = texel_uv(self.texels[f[self.layer]])
            for lp in f.loops:
                lp[uv].uv = (u, v)
        tris = len(self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for p in me.polygons:
            p.use_smooth = False
        return me, tris


# ------------------------------------------------------------------ fitting

def _dominant(ob):
    names = {vg.index: vg.name for vg in ob.vertex_groups}
    return np.array([names[max(v.groups, key=lambda g: g.weight).group] for v in ob.data.vertices])


def _co(ob):
    return np.array([v.co[:] for v in ob.data.vertices])


class Fit:
    """Per-figure anchors, measured from the shipped bind pose."""

    def __init__(self, arm, meshes, prefix):
        self.prefix = prefix
        bones = arm.data.bones
        self.O = np.array(bones[f"{prefix}_root"].head_local)
        self.O[2] = 0.0
        U = meshes["uniform"]
        co, dom = _co(U) - self.O, _dominant(U)
        head = co[dom == f"{prefix}_head"]
        hel = head[head[:, 2] >= HELMET_Z0]
        lo, hi = np.percentile(hel, 1, axis=0), np.percentile(hel, 99, axis=0)
        self.hel_c = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0.0))
        self.hel_rx, self.hel_ry = (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2
        self.hel_top = float(hel[:, 2].max())
        self.hel_rz = 0.15
        self.hel_cz = self.hel_top - self.hel_rz
        sp = co[dom == f"{prefix}_spine"]
        ch = sp[(sp[:, 2] >= 1.28) & (sp[:, 2] <= 1.40)]
        self.chest_x = (float(np.percentile(ch[:, 0], 1)), float(np.percentile(ch[:, 0], 99)))
        self.chest_y = (float(np.percentile(ch[:, 1], 1)), float(np.percentile(ch[:, 1], 99)))
        pv = co[dom == f"{prefix}_pelvis"]
        bt = pv[(pv[:, 2] >= 0.85) & (pv[:, 2] <= 0.98)]
        self.belt_x = (float(np.percentile(bt[:, 0], 1)), float(np.percentile(bt[:, 0], 99)))
        self.belt_y = (float(np.percentile(bt[:, 1], 1)), float(np.percentile(bt[:, 1], 99)))
        self.sh = {s: Vector(np.array(bones[f"{prefix}_upperarm_{s}"].head_local) - self.O) for s in "LR"}
        self.el = {s: Vector(np.array(bones[f"{prefix}_upperarm_{s}"].tail_local) - self.O) for s in "LR"}
        W = meshes["weapon"]
        wco, wdom = _co(W), _dominant(W)
        w = wco[wdom == f"{prefix}_weapon"]
        c = w.mean(0)
        u = np.linalg.svd(w - c, full_matrices=False)[2][0]
        if u[0] < 0:
            u = -u
        u = Vector(u).normalized()
        v = (Vector((0, 0, 1)) - u * u.z).normalized()
        wv = v.cross(u).normalized()
        proj = (w - c) @ np.array(u)
        muz = w[proj >= proj.max() - 0.02].mean(0)
        self.wM = Vector(muz)
        self.wu, self.ww, self.wv = u, wv, v
        self.wlen = float(proj.max() - proj.min())
        # weapon verts in the weapon frame, for station queries
        d = w - muz
        self.wl = np.stack([d @ np.array(u), d @ np.array(wv), d @ np.array(v)], axis=1)

    # frames
    def fig(self):
        m = Matrix.Identity(4)
        m.translation = Vector(self.O)
        return m

    def wpn(self):
        m = Matrix.Identity(4)
        for i in range(3):
            m[i][0], m[i][1], m[i][2] = self.wu[i], self.ww[i], self.wv[i]
        m.translation = self.wM
        return m

    def station(self, back):
        """(top, bottom, w_lo, w_hi) of the weapon `back` metres behind the muzzle."""
        s = self.wl[np.abs(self.wl[:, 0] + back) < 0.025]
        if len(s) == 0:
            s = self.wl[np.abs(self.wl[:, 0] + back) < 0.06]
        return float(s[:, 2].max()), float(s[:, 2].min()), float(s[:, 1].min()), float(s[:, 1].max())


# -------------------------------------------------------------------- parts

def _rot_x(a):
    return Matrix.Rotation(a, 3, "X")


def _rot_y(a):
    return Matrix.Rotation(a, 3, "Y")


def _rot_z(a):
    return Matrix.Rotation(a, 3, "Z")


def _toward(a, b):
    """Rotation taking local +x onto the direction a->b (no roll)."""
    d = (Vector(b) - Vector(a)).normalized()
    return d.to_track_quat("X", "Z").to_matrix()


def build_part(name, f, side=None):
    """Return the Piece for part `name` on figure fit `f` (`side` for sided parts)."""
    T = TRACK_OF[name].texel          # the manifest's primary texel; extras are named inline
    hc, hrx, hry = f.hel_c, f.hel_rx, f.hel_ry
    hz = f.hel_cz
    cx0, cx1 = f.chest_x
    cy0, cy1 = f.chest_y
    cxm = (cx0 + cx1) / 2
    cyh = (cy1 - cy0) / 2
    cym = (cy0 + cy1) / 2
    sgn = {"L": -1.0, "R": 1.0}.get(side, 0.0)      # the rig's _L side is -y
    fx = hc.x + hrx                                  # helmet front
    zt = hz + f.hel_rz * 0.80                        # NVG mount height
    # ---------------------------------------------------------------- ARMOUR
    if name == "helmet_cover":
        p = Piece(f.fig())
        e = 0.045
        brim = lambda x, y: 1.585 + 0.16 * max(0.0, (x - hc.x) / max(hrx, 1e-3)) ** 1.5   # front rim lifted off the face
        p.dome((hc.x, hc.y, hz), (hrx + e, hry + e, f.hel_rz + e), T, seg=10, rings=4, z_clamp=brim)
        zb = hz + 0.05
        k = math.sqrt(max(0.0, 1 - ((zb - hz) / (f.hel_rz + e)) ** 2))
        ro = (hrx + e) * k + 0.007
        sq = (hry + e) / (hrx + e)
        p.cyl((hc.x, hc.y, zb - 0.022), (hc.x, hc.y, zb + 0.022), ro, ro, "orange", sides=10, caps=(False, False), squash=sq)
        p.box((0.06, 0.24, 0.12), (hc.x - hrx - e + 0.01, hc.y, 1.59), T, bevel=0.0, rot=_rot_y(math.radians(-14)))
        return p
    if name == "side_plates":
        p = Piece(f.fig())
        # clear of the thigh in kneel/pinned and of the belt pouches (clash census, 28 Oct): shorter, a hand higher, rearward and outboard of the upper arm, which hangs flush with the flank
        p.box((0.24, 0.09, 0.28), (cxm - 0.045, sgn * (cyh + 0.105), 1.12), T, bevel=0.02)
        return p
    if name == "shoulder":
        p = Piece(f.fig())
        sh = f.sh[side]
        for i, (dz, ang, wd) in enumerate(((0.10, 0.0, 0.26), (0.045, 28.0, 0.28), (-0.015, 52.0, 0.28))):
            R = _rot_x(sgn * math.radians(-ang)) if sgn else Matrix.Identity(3)
            off = Vector((0.0, sgn * (0.04 + 0.05 * i), dz + 0.10))
            p.box((wd, 0.08, 0.08 if i else 0.10), tuple(sh + off), T, bevel=0.018 if i == 0 else 0.0, rot=R)
        return p
    if name == "groin_flap":
        p = Piece(f.fig())
        p.box((0.07, 0.26, 0.22), (f.belt_x[1] + 0.03, 0.0, 0.83), T, bevel=0.0, rot=_rot_y(math.radians(8)))
        return p
    if name == "collar":
        p = Piece(f.fig())
        p.ring((cxm, 0.0, 1.475), 0.160, 0.100, 0.10, T, sides=8, bottom=False)
        return p
    if name == "plate_front":
        p = Piece(f.fig())
        p.box((0.08, 0.36, 0.42), (cx1 + 0.035, cym, 1.20), T, bevel=0.022)
        return p
    if name == "plate_back":
        p = Piece(f.fig())
        p.box((0.08, 0.36, 0.42), (cx0 - 0.035, cym, 1.20), T, bevel=0.0)
        return p
    if name == "upperarm_guard":
        p = Piece(f.fig())
        sh, el = f.sh[side], f.el[side]
        p.cyl(sh + Vector((0, 0, 0.10)), el, 0.105, 0.085, T, sides=8, caps=(False, True))
        p.dome(tuple(sh + Vector((0, 0, 0.08))), (0.115, 0.115, 0.085), T, seg=8, rings=3)
        return p
    # --------------------------------------------------------------- SENSORS
    if name == "nvg_mount":
        p = Piece(f.fig())
        p.box((0.12, 0.14, 0.12), (fx + 0.025, hc.y, zt), T, bevel=0.018)
        p.box((0.06, 0.06, 0.11), (fx - 0.04, hc.y, zt + 0.05), T, bevel=0.0)
        return p
    if name == "counterweight":
        p = Piece(f.fig())
        p.box((0.15, 0.19, 0.15), (hc.x - hrx - 0.06, hc.y, hz + 0.03), "khaki", bevel=0.024)
        return p
    if name == "ir_strobe":
        p = Piece(f.fig())
        p.cyl((hc.x, hc.y, f.hel_top + 0.02), (hc.x, hc.y, f.hel_top + 0.055), 0.014, 0.014, T, sides=6, caps=(False, False))
        p.box((0.11, 0.11, 0.07), (hc.x, hc.y, f.hel_top + 0.09), "cream", bevel=0.0)
        return p
    if name == "nvg_mono":
        # a monocular flipped up on its mount: a short, fat tube tilted up and forward
        p = Piece(f.fig())
        base = Vector((fx + 0.04, hc.y, zt + 0.05))
        tip = base + Vector((0.09, 0.0, 0.105))
        p.cyl(base, tip, 0.050, 0.057, T, sides=8, caps=(False, True), cap1_texel="grey")
        return p
    if name == "radio_pouch":
        p = Piece(f.fig())
        p.box((0.10, 0.16, 0.28), (cx0 - 0.045, 0.09, 1.16), T, bevel=0.018)
        return p
    if name == "assault_pack":
        p = Piece(f.fig())
        p.box((0.22, 0.42, 0.50), (cx0 - 0.105, 0.0, 1.14), T, bevel=0.032)
        p.box((0.06, 0.34, 0.08), (cx0 - 0.105, 0.0, 1.42), T, bevel=0.0)      # top lid
        return p
    if name in ("antenna_short", "antenna_long"):
        p = Piece(f.fig())
        L = 0.85 if name == "antenna_short" else 1.25
        base = Vector((cx0 - 0.17, -0.12, 1.34))
        p.cyl(base, base + Vector((0, 0, 0.07)), 0.025, 0.025, T, sides=6)
        tip = base + Vector((-0.04, -0.03, 0.07 + L))
        p.cyl(base + Vector((0, 0, 0.07)), tip, 0.016, 0.009, T, sides=6, caps=(False, False))
        return p
    if name == "nvg_quad":
        # four-tube panoramic goggles flipped up: a wide bar, two fat tubes each side
        p = Piece(f.fig())
        base = Vector((fx + 0.04, hc.y, zt + 0.05))
        p.box((0.08, 0.32, 0.07), tuple(base), T, bevel=0.0)
        for yy in (-0.11, -0.04, 0.04, 0.11):
            a = base + Vector((0.0, yy, 0.03))
            tip = a + Vector((0.09, 0.0, 0.105))
            p.cyl(a, tip, 0.032, 0.038, T, sides=8, caps=(False, True), cap1_texel="grey")
        return p
    if name == "eud_tablet":
        p = Piece(f.fig())
        p.box((0.09, 0.28, 0.19), (cx1 + 0.035, cym, 1.25), "grey", bevel=0.014)
        p.box((0.02, 0.22, 0.13), (cx1 + 0.083, cym, 1.25), T, bevel=0.0)
        return p
    # ------------------------------------------------------------- FIREPOWER
    if name == "optic_dot":
        top, bot, wlo, whi = f.station(0.34)
        wc = (wlo + whi) / 2
        p = Piece(f.wpn())
        # T1 bolder (lead, 28 Oct): housing 0.19 x 0.115 x 0.125, lens 0.09 x 0.10
        p.box((0.19, 0.115, 0.125), (-0.34, wc, top + 0.057), "grey", bevel=0.02)
        p.box((0.02, 0.09, 0.10), (-0.34 + 0.10, wc, top + 0.062), T, bevel=0.0)
        return p
    if name == "foregrip":
        top, bot, wlo, whi = f.station(0.17)
        p = Piece(f.wpn())
        p.box((0.105, 0.105, 0.24), (-0.17, (wlo + whi) / 2, bot - 0.11), "tan", bevel=0.02)
        return p
    if name == "optic_mag":
        top, bot, wlo, whi = f.station(0.30)
        wc = (wlo + whi) / 2
        p = Piece(f.wpn())
        p.box((0.13, 0.08, 0.08), (-0.30, wc, top + 0.035), T, bevel=0.0)
        a, b = Vector((-0.48, wc, top + 0.12)), Vector((-0.14, wc, top + 0.12))
        p.cyl(a, b, 0.052, 0.052, "grey", sides=8, caps=(False, False))
        p.cyl(b, b + Vector((0.05, 0, 0)), 0.052, 0.072, T, sides=8, caps=(False, True), cap1_texel="grey")
        p.cyl(a - Vector((0.04, 0, 0)), a, 0.066, 0.052, T, sides=8, caps=(True, False))
        p.box((0.065, 0.06, 0.065), (-0.27, wc, top + 0.19), T, bevel=0.0, rot=_rot_x(math.radians(45)))
        return p
    if name == "weapon_light":
        top, bot, wlo, whi = f.station(0.19)
        zc = (top + bot) / 2
        p = Piece(f.wpn())
        p.box((0.15, 0.10, 0.10), (-0.19, whi + 0.046, zc), "tan", bevel=0.0)
        p.cyl(Vector((-0.115, whi + 0.046, zc)), Vector((-0.085, whi + 0.046, zc)), 0.044, 0.044, "black", sides=8, caps=(False, True))
        return p
    if name == "mag_pouches":
        p = Piece(f.fig())
        for i in (-1, 0, 1):
            p.box((0.09, 0.11, 0.22), (f.belt_x[1] + 0.04, i * 0.12, 1.01), "khaki", bevel=0.0)
        return p
    if name == "suppressor":
        p = Piece(f.wpn())
        p.cyl(Vector((-0.01, 0, 0.0)), Vector((0.30, 0, 0.0)), 0.047, 0.047, T, sides=8, caps=(False, True))
        for x0 in (0.03, 0.12, 0.21):
            p.cyl(Vector((x0, 0, 0)), Vector((x0 + 0.04, 0, 0)), 0.055, 0.055, "grey", sides=8, caps=(False, False))
        return p
    if name == "grenade_pouches":
        p = Piece(f.fig())
        p.box((0.13, 0.13, 0.22), (f.belt_x[1] - 0.03, sgn * 0.225, 0.97), "khaki", bevel=0.026)
        return p
    raise KeyError(name)


# --------------------------------------------------------------------- build

def build(repo, arm, meshes, mat):
    """Add every kit object to the scene, bound to the shipped skin. Returns the table."""
    sys.path.insert(0, os.path.join(repo, "tools"))
    sys.path.insert(0, os.path.join(repo, "tools", "units"))
    import rig  # noqa: E402  (PART_BONE, rig_parts)

    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    fits = {p: Fit(arm, meshes, p) for p in kp.ALL}
    objs, rows, forced = [], [], {}
    for part in kp.PARTS:
        for pf in kp.ALL:
            if pf not in part.figs:
                continue
            for suf, _base in kp.object_suffixes(part):
                side = suf[-1] if suf[-2] == "_" and suf[-1] in "LR" else None
                piece = build_part(part.name, fits[pf], side)
                oname = f"{pf}_{suf}"
                me, tris = piece.finish(oname)
                me.materials.append(bpy.data.materials["BakedMaterial"])
                ob = bpy.data.objects.new(oname, me)
                bpy.context.collection.objects.link(ob)
                ob["rl_role"] = part.role
                ob["rl_kit"] = json.dumps({"track": part.track, "tier": part.tier, "slot": part.slot,
                                           "part": part.name, "figure": pf})
                objs.append(ob)
                rows.append((ob, part, pf, tris))
    rig.rig_parts(objs, arm, forced, list(kp.ALL))
    return rows


# ------------------------------------------------------------- state / views

TRACK_OF = {p.name: p for p in kp.PARTS}


def show(rows, tiers):
    """Show the kit a squad with `tiers` ({track: 0..3}) has bought: every part
    at or below its track's tier, but only the HIGHEST tier in each slot
    (a red dot gives way to the magnified optic; spec §2.1, slot supersession)."""
    best = {}
    for ob, part, pf, _ in rows:
        if part.tier > tiers.get(part.track, 0):
            continue
        if part.slot:
            key = (pf, part.slot, ob.name[-2:] if ob.name[-2] == "_" and ob.name[-1] in "LR" else "")
            if key not in best or part.tier > best[key]:
                best[key] = part.tier
    for ob, part, pf, _ in rows:
        on = part.tier <= tiers.get(part.track, 0)
        if on and part.slot:
            key = (pf, part.slot, ob.name[-2:] if ob.name[-2] == "_" and ob.name[-1] in "LR" else "")
            on = part.tier == best[key]
        ob.hide_render = not on
        ob.hide_viewport = not on
