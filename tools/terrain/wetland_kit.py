"""Shared geometry kit for the wetland P3 builders (GH-871): reeds, winter grass,
the round bale and the culvert.

Pure Python at the top (no `bpy` import until `to_object`), so every count and
every bound below is testable with plain `python3` -- see
`tools/terrain/test_wetland_kit.py`. The builders in `build_reeds.py`,
`build_wet_grass.py` and `build_wetland_props.py` assemble `TriSoup`s, one per
`rl_role`; `to_object` turns a soup into a Blender mesh only when a script is
running inside Blender.

## Determinism -- no `mathutils.noise`, ever

Blender 5.2 reseeds `mathutils.noise` per process, so a reed built from it would
shape-shift between runs and yesterday's output could not be reproduced. Every
irregular touch here reads from `hash01`, an FNV-1a style integer hash (the same
shape `props.py` and `render_building.py` use), or from `vnoise2`/`fbm2`, which
are value noise over that hash. Same inputs, same floats, on any machine.

## Why the blades are closed cones, not cards

The decor material is a `MeshStandardMaterial` with the default `FrontSide`
(`world-materials.ts` `rampMaterial`; nothing under `terrain/` sets `DoubleSide`).
A single-sided card therefore vanishes from behind. A blade is built as a thin
three-sided cone instead (3 triangles, open base): from any direction at least
one face looks at the camera, and the count is honest. A culm is the same cone.

Every vertex is Z-up metres. `to_object` is the only place Blender enters.
"""
import math

# --- deterministic noise ----------------------------------------------------


_M32 = 0xFFFFFFFF


def _fmix32(h):
    """The murmur3 32-bit finaliser: every input bit reaches every output bit."""
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & _M32
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & _M32
    h ^= h >> 16
    return h


def hash01(*ints):
    """Deterministic 0..1 from integers: FNV-style fold, murmur3 finaliser per
    step (a bare FNV step left consecutive inputs 0.94 correlated). Never
    `mathutils.noise`."""
    h = 2166136261
    for v in ints:
        h ^= int(v) & _M32
        h = (h * 16777619) & _M32
        h = _fmix32(h)
    return h / 4294967295.0


class Stream:
    """A counted stream of `hash01` draws: `Stream(seed).u()` is the k-th draw."""

    def __init__(self, *seed):
        self.seed = tuple(int(s) for s in seed)
        self.k = 0

    def u(self):
        self.k += 1
        return hash01(*self.seed, self.k)

    def span(self, lo, hi):
        return lo + (hi - lo) * self.u()

    def sym(self, half):
        return (self.u() * 2.0 - 1.0) * half

    def pick(self, n):
        return min(n - 1, int(self.u() * n))


def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def vnoise2(x, y, seed=0):
    """2D value noise in [-1, 1]: bilinear over a hashed lattice, quintic fade."""
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = _fade(x - ix), _fade(y - iy)

    def lat(i, j):
        return hash01(seed, i, j) * 2.0 - 1.0

    a = lat(ix, iy) + (lat(ix + 1, iy) - lat(ix, iy)) * fx
    b = lat(ix, iy + 1) + (lat(ix + 1, iy + 1) - lat(ix, iy + 1)) * fx
    return a + (b - a) * fy


def fbm2(x, y, seed=0, octaves=3):
    """Fractional Brownian motion over `vnoise2`, normalised to [-1, 1]."""
    total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
    for o in range(octaves):
        total += amp * vnoise2(x * freq, y * freq, seed + o)
        norm += amp
        amp *= 0.5
        freq *= 2.0
    return total / norm


# --- small vector helpers (tuples, no mathutils) ----------------------------


def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def v_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def v_len(a):
    return math.sqrt(v_dot(a, a))


def v_norm(a):
    n = v_len(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 1.0)


def v_lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def dir_from(azimuth, elevation):
    """Unit vector from a horizontal azimuth (radians, 0 = +X, CCW) and an
    elevation above the horizon (radians, negative = drooping)."""
    ce = math.cos(elevation)
    return (math.cos(azimuth) * ce, math.sin(azimuth) * ce, math.sin(elevation))


def perp_basis(axis):
    """Two unit vectors perpendicular to `axis` and to each other."""
    up = (0.0, 0.0, 1.0) if abs(axis[2]) < 0.95 else (1.0, 0.0, 0.0)
    u = v_norm(v_cross(axis, up))
    w = v_norm(v_cross(axis, u))
    return u, w


# --- the triangle soup ------------------------------------------------------


class TriSoup:
    """Vertices and triangles, nothing else. Triangles are wound by the builder
    helpers so the normal points away from an interior reference point."""

    def __init__(self):
        self.verts = []
        self.tris = []

    def vert(self, p):
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.verts) - 1

    def tri_out(self, a, b, c, inside):
        """Add triangle (a, b, c) wound so its normal faces away from `inside`."""
        pa, pb, pc = self.verts[a], self.verts[b], self.verts[c]
        n = v_cross(v_sub(pb, pa), v_sub(pc, pa))
        centre = v_mul(v_add(v_add(pa, pb), pc), 1.0 / 3.0)
        if v_dot(n, v_sub(centre, inside)) < 0.0:
            b, c = c, b
        self.tris.append((a, b, c))

    def tri_facing(self, a, b, c, toward):
        """Add triangle (a, b, c) wound so its normal faces `toward` (a direction)."""
        pa, pb, pc = self.verts[a], self.verts[b], self.verts[c]
        n = v_cross(v_sub(pb, pa), v_sub(pc, pa))
        if v_dot(n, toward) < 0.0:
            b, c = c, b
        self.tris.append((a, b, c))

    def quad_facing(self, a, b, c, d, toward):
        """Two triangles for the quad a-b-c-d (in order), both facing `toward`."""
        self.tri_facing(a, b, c, toward)
        self.tri_facing(a, c, d, toward)

    @property
    def count(self):
        return len(self.tris)

    def bounds(self):
        xs = [p[0] for p in self.verts]
        ys = [p[1] for p in self.verts]
        zs = [p[2] for p in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def clamp_z(self, lo, hi):
        """Flatten any vertex outside [lo, hi] onto the limit (a ribbon's base corner
        tilting a centimetre below the ground, a tip a centimetre over the model height)."""
        self.verts = [(x, y, min(max(z, lo), hi)) for x, y, z in self.verts]

    def merge(self, other):
        base = len(self.verts)
        self.verts.extend(other.verts)
        self.tris.extend((a + base, b + base, c + base) for a, b, c in other.tris)

    # -- shapes ---------------------------------------------------------------

    def cone(self, base, axis, length, radius, sides=3, phase=0.0, flat_base=False):
        """A thin cone: a ring of `sides` vertices of circumradius `radius`
        around `base`, perpendicular to `axis` (or in the horizontal plane when
        `flat_base`), and an apex `length` along `axis`. `sides` triangles, open
        at the base (the base sits in the ground or on a stem and is never seen).
        Returns the apex position."""
        axis = v_norm(axis)
        if flat_base:
            u, w = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
        else:
            u, w = perp_basis(axis)
        apex = v_add(base, v_mul(axis, length))
        ring = []
        for s in range(sides):
            ang = phase + 2.0 * math.pi * s / sides
            off = v_add(v_mul(u, math.cos(ang) * radius), v_mul(w, math.sin(ang) * radius))
            ring.append(self.vert(v_add(base, off)))
        top = self.vert(apex)
        inside = v_add(base, v_mul(axis, length * 0.35))
        for s in range(sides):
            self.tri_out(ring[s], ring[(s + 1) % sides], top, inside)
        return apex

    def ribbon(self, base, axis, length, width, roll=0.0):
        """A flat tapering blade, base `width` wide at `base`, an apex `length` along
        `axis`, DOUBLE-SIDED: a front triangle and a back triangle on their own vertices
        (so each keeps its own normal), 2 triangles. Under the decor material's
        `FrontSide` exactly one of the pair draws from any direction, so it is never
        invisible and never z-fights. A reed or bulrush leaf is flat, so this is also the
        truer shape. `roll` turns the blade's face about its axis. Returns the apex."""
        axis = v_norm(axis)
        u, w = perp_basis(axis)
        side = v_add(v_mul(u, math.cos(roll)), v_mul(w, math.sin(roll)))
        apex = v_add(base, v_mul(axis, length))
        l = v_add(base, v_mul(side, -width / 2.0))
        r = v_add(base, v_mul(side, width / 2.0))
        n = v_norm(v_cross(side, axis))
        for sign in (1.0, -1.0):
            a, b, c = self.vert(l), self.vert(r), self.vert(apex)
            self.tri_facing(a, b, c, v_mul(n, sign))
        return apex

    def bent_ribbon(self, base, axis, length, width, bend, t_bend=0.55, roll=0.0, taper=0.65):
        """A two-segment double-sided blade (an arching strap leaf): base edge, a
        narrower mid edge displaced by `bend`, an apex. 3 triangles a side, 6 in all."""
        axis = v_norm(axis)
        u, w = perp_basis(axis)
        side = v_add(v_mul(u, math.cos(roll)), v_mul(w, math.sin(roll)))
        mid = v_add(v_add(base, v_mul(axis, length * t_bend)), bend)
        apex = v_add(v_add(base, v_mul(axis, length)), v_mul(bend, 2.4))
        n = v_norm(v_cross(side, axis))
        for sign in (1.0, -1.0):
            toward = v_mul(n, sign)
            bl, br = self.vert(v_add(base, v_mul(side, -width / 2.0))), self.vert(v_add(base, v_mul(side, width / 2.0)))
            ml, mr = self.vert(v_add(mid, v_mul(side, -width * taper / 2.0))), self.vert(v_add(mid, v_mul(side, width * taper / 2.0)))
            top = self.vert(apex)
            self.quad_facing(bl, br, mr, ml, toward)
            self.tri_facing(ml, mr, top, toward)
        return apex

    def spindle(self, p0, p1, radius, t_mid=0.4, sides=3, phase=0.0):
        """A double cone from `p0` to `p1` with its widest ring at `t_mid`:
        `2 * sides` triangles, closed. A plume or a bulrush spike."""
        axis = v_norm(v_sub(p1, p0))
        u, w = perp_basis(axis)
        centre = v_lerp(p0, p1, t_mid)
        a = self.vert(p0)
        b = self.vert(p1)
        ring = []
        for s in range(sides):
            ang = phase + 2.0 * math.pi * s / sides
            off = v_add(v_mul(u, math.cos(ang) * radius), v_mul(w, math.sin(ang) * radius))
            ring.append(self.vert(v_add(centre, off)))
        inside = v_lerp(p0, p1, 0.5)
        for s in range(sides):
            self.tri_out(a, ring[s], ring[(s + 1) % sides], inside)
            self.tri_out(b, ring[s], ring[(s + 1) % sides], inside)

    def bent_cone(self, base, axis, length, radius, bend, t_bend=0.55, sides=3, phase=0.0, taper=0.7):
        """A two-segment strap: ring at `base`, a second smaller ring at
        `t_bend` of the length displaced by `bend` (a vector), then an apex.
        `sides * 3` triangles. A bulrush leaf, arching."""
        axis = v_norm(axis)
        u, w = perp_basis(axis)
        mid = v_add(v_add(base, v_mul(axis, length * t_bend)), bend)
        apex = v_add(v_add(base, v_mul(axis, length)), v_mul(bend, 2.4))
        r0, r1 = [], []
        for s in range(sides):
            ang = phase + 2.0 * math.pi * s / sides
            o = v_add(v_mul(u, math.cos(ang)), v_mul(w, math.sin(ang)))
            r0.append(self.vert(v_add(base, v_mul(o, radius))))
            r1.append(self.vert(v_add(mid, v_mul(o, radius * taper))))
        top = self.vert(apex)
        inside = v_add(base, v_mul(axis, length * 0.3))
        for s in range(sides):
            n = (s + 1) % sides
            self.tri_out(r0[s], r0[n], r1[n], inside)
            self.tri_out(r0[s], r1[n], r1[s], inside)
            self.tri_out(r1[s], r1[n], top, inside)
        return apex

    def lathe(self, profile, segments, phase=0.0):
        """Revolve `profile` (a list of (radius, z) from bottom to top) about Z.
        Radius 0 collapses to an apex vertex. Triangles face outward. No bottom
        cap (the prop stands on the ground)."""
        rings = []
        for r, z in profile:
            if r <= 1e-9:
                rings.append([self.vert((0.0, 0.0, z))])
            else:
                rings.append(
                    [
                        self.vert((r * math.cos(phase + 2 * math.pi * s / segments), r * math.sin(phase + 2 * math.pi * s / segments), z))
                        for s in range(segments)
                    ]
                )
        zc = sum(z for _, z in profile) / len(profile)
        inside = (0.0, 0.0, zc)
        for i in range(len(rings) - 1):
            lo, hi = rings[i], rings[i + 1]
            for s in range(segments):
                n = (s + 1) % segments
                if len(lo) == 1:
                    self.tri_out(lo[0], hi[n], hi[s], inside)
                elif len(hi) == 1:
                    self.tri_out(lo[s], lo[n], hi[0], inside)
                else:
                    self.tri_out(lo[s], lo[n], hi[n], inside)
                    self.tri_out(lo[s], hi[n], hi[s], inside)
        return rings

    def box(self, lo, hi, skip=()):
        """An axis-aligned box from `lo` to `hi`; `skip` names faces left out
        ('-x', '+x', '-y', '+y', '-z', '+z'). 2 triangles per face."""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        c = {
            (0, 0, 0): self.vert((x0, y0, z0)),
            (1, 0, 0): self.vert((x1, y0, z0)),
            (1, 1, 0): self.vert((x1, y1, z0)),
            (0, 1, 0): self.vert((x0, y1, z0)),
            (0, 0, 1): self.vert((x0, y0, z1)),
            (1, 0, 1): self.vert((x1, y0, z1)),
            (1, 1, 1): self.vert((x1, y1, z1)),
            (0, 1, 1): self.vert((x0, y1, z1)),
        }
        faces = {
            "-z": ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, -1)),
            "+z": ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1), (0, 0, 1)),
            "-y": ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1), (0, -1, 0)),
            "+y": ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0), (0, 1, 0)),
            "-x": ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0), (-1, 0, 0)),
            "+x": ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1), (1, 0, 0)),
        }
        for name, (a, b, cc, d, n) in faces.items():
            if name in skip:
                continue
            self.quad_facing(c[a], c[b], c[cc], c[d], n)


# --- Blender side -----------------------------------------------------------


def to_object(name, soup, smooth=True, sharp_degrees=None, collection=None):
    """Turn a soup into a Blender mesh object. `smooth` shades every polygon
    smooth; `sharp_degrees` then marks edges between faces more than that many
    degrees apart as sharp (a bale's shoulder, a headwall's corner)."""
    import bpy  # only inside Blender

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(soup.verts, [], soup.tris)
    mesh.update()
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
        if sharp_degrees is not None:
            limit = math.cos(math.radians(sharp_degrees))
            by_edge = {}
            for p in mesh.polygons:
                for ek in p.edge_keys:
                    by_edge.setdefault(tuple(sorted(ek)), []).append(p.normal.copy())
            for e in mesh.edges:
                ns = by_edge.get(tuple(sorted(e.vertices)), [])
                if len(ns) == 2 and ns[0].dot(ns[1]) < limit:
                    e.use_edge_sharp = True
    ob = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.collection).objects.link(ob)
    return ob
