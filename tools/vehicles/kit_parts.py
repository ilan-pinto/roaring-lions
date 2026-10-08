"""Kit parts at maximum detail -- the hard-surface builders behind GH-238
plan 3 (`docs/superpowers/plans/2026-10-07-kitted-vehicles.md`, Task 4).

Every builder here returns a list of `Piece`s: real-metre vertex positions in
WORLD space (Blender's: Z up, +X forward), faces, and a TONE per face. Nothing
is an object until `export_vehicle_kit.py` joins one (track, tier, host)'s
pieces into one node. There are no object transforms anywhere, the same rule
`tools/units/kit.py` follows: a transform left on an object would lie to every
probe that reads vertex data.

TONE is what colour a face draws, decided once per vehicle by the exporter:
`paint` (the hull's 25th-percentile paint texel), `metal` (the bake's own
metal) and `dark` (lenses, windows, apertures). The builders' own choice is
kept only for `dark`: the exporter gives every other face its TRACK's tone
(`export_vehicle_kit.TRACK_TONE` -- armour `paint`, sensors and firepower
`metal`, the approved colour study's "L3 shade" column).

Three flags per piece. `weld` is read only by the clash check (`kit_clash`,
check (d)): a piece that exists to enter the vehicle (a feed chute into the
gun's port) may weld into a steel node, as `mount` and `ground` pieces may.
The other two are read by the exporter's mock-number check as well:
  * `mount`  -- hardware that exists only to reach the hull (brackets, hangers,
               rails, risers): excluded from the comparison with the blockout
               part, because the blockout floated where the detailed part
               stands on a bracket.
  * `ground` -- a piece that runs down to the hull surface (a pedestal, a pole
               base): for the comparison its bottom is clipped at the blockout
               part's own bottom, so standing on the real roof is not counted
               as a size change.

Detail stops at 1 cm (spec section 2.3): 1 cm chamfers, 30 mm hex bolt heads,
lens recesses, hinge knuckles, lifting eyes, chain links. Curves under about
5 px in the garage take 6-10 sides; the drum and the balls take more.

`mathutils.noise` is never used (nondeterministic per process in Blender 5.2):
every number here is a function of its arguments, so two runs of the exporter
write the same bytes.
"""
import math

import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

TONES = ("paint", "metal", "dark")
TONE_INDEX = {t: i for i, t in enumerate(TONES)}

#: Chamfer on every plate edge (spec section 2.3: modelled down to 1 cm).
CHAMFER = 0.01
#: Hex bolt head: 30 mm across flats-ish, 12 mm proud, sunk 2 mm into its face.
BOLT_ACROSS = 0.03
BOLT_HEIGHT = 0.012
BOLT_SINK = 0.002


class Piece:
    """One closed (or deliberately open, where buried) shell."""

    __slots__ = ("name", "verts", "faces", "tones", "smooth", "mount", "ground", "weld")

    def __init__(self, name, verts, faces, tones, smooth=False, mount=False, ground=False):
        if isinstance(tones, str):
            tones = [tones] * len(faces)
        if len(tones) != len(faces):
            raise ValueError(f"{name}: {len(tones)} tones for {len(faces)} faces")
        for t in tones:
            if t not in TONES:
                raise ValueError(f"{name}: tone {t!r} outside {TONES}")
        self.name = name
        self.verts = [Vector(v) for v in verts]
        self.faces = [tuple(f) for f in faces]
        self.tones = list(tones)
        self.smooth = smooth
        self.mount = mount
        self.ground = ground
        self.weld = False

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def bounds(self):
        lo = Vector((min(v.x for v in self.verts), min(v.y for v in self.verts), min(v.z for v in self.verts)))
        hi = Vector((max(v.x for v in self.verts), max(v.y for v in self.verts), max(v.z for v in self.verts)))
        return lo, hi


def tris(pieces):
    return sum(p.tris for p in pieces)


def tagged(pieces, mount=None, ground=None):
    """Return `pieces` with their mount/ground flags set (for builders that
    do not take the flags themselves)."""
    for p in pieces:
        if mount is not None:
            p.mount = mount
        if ground is not None:
            p.ground = ground
    return pieces


# ---------------------------------------------------------------------------
# frames
# ---------------------------------------------------------------------------

def place(at, rz=0.0, ry=0.0, rx=0.0):
    """Local -> world: translate to `at`, rotated by Euler XYZ degrees about
    the local centre (kit_blockout.box's own convention, so a part built in a
    local frame sits exactly where the blockout's box sat)."""
    return (Matrix.Translation(Vector(at))
            @ Matrix.Rotation(math.radians(rz), 4, "Z")
            @ Matrix.Rotation(math.radians(ry), 4, "Y")
            @ Matrix.Rotation(math.radians(rx), 4, "X"))


def frame(at, x, z=(0.0, 0.0, 1.0)):
    """Local -> world with local X along `x` and local Z as close to `z` as
    orthogonality allows."""
    xa = Vector(x).normalized()
    za = Vector(z)
    za = (za - xa * za.dot(xa))
    if za.length < 1e-6:
        za = Vector((0.0, 0.0, 1.0)) if abs(xa.z) < 0.9 else Vector((1.0, 0.0, 0.0))
        za = (za - xa * za.dot(xa))
    za.normalize()
    ya = za.cross(xa)
    m = Matrix((xa, ya, za)).transposed().to_4x4()
    m.translation = Vector(at)
    return m


def _perp(d):
    """Two unit vectors perpendicular to `d` (and to each other), chosen
    deterministically so a horizontal tube's flats face up."""
    d = Vector(d).normalized()
    up = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.95 else Vector((1.0, 0.0, 0.0))
    v = (up - d * up.dot(d)).normalized()
    u = v.cross(d).normalized()
    return u, v


# ---------------------------------------------------------------------------
# bmesh plumbing
# ---------------------------------------------------------------------------

def _new_bm():
    bm = bmesh.new()
    bm.faces.layers.int.new("tone")
    return bm


def _to_piece(name, bm, tone, M=None, smooth=False, mount=False, ground=False, recalc=True):
    """Freeze a bmesh into a Piece. Every face takes `tone` unless the
    builder already wrote a different one into the `tone` layer (value + 1,
    so 0 means 'unset')."""
    lay = bm.faces.layers.int["tone"]
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
        if M.determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.verts.index_update()
    verts = [v.co.copy() for v in bm.verts]
    faces, tones = [], []
    for f in bm.faces:
        faces.append(tuple(v.index for v in f.verts))
        t = f[lay]
        tones.append(TONES[t - 1] if t > 0 else tone)
    bm.free()
    return Piece(name, verts, faces, tones, smooth=smooth, mount=mount, ground=ground)


def _face_toward(bm, direction):
    """The largest face whose normal points along `direction` (local)."""
    d = Vector(direction).normalized()
    best, area = None, -1.0
    for f in bm.faces:
        if f.normal.dot(d) > 0.999 and f.calc_area() > area:
            best, area = f, f.calc_area()
    return best


def _chamfered_box_bm(size, chamfer=CHAMFER, keep_sharp=()):
    """A cuboid with every edge chamfered except those of the faces facing
    `keep_sharp` (local directions): a face about to be dropped against the
    host needs no chamfer round it, and saves its triangles."""
    bm = _new_bm()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if chamfer > 0:
        bm.edges.index_update()
        skip = set()
        for d in keep_sharp:
            f = _face_toward(bm, d)
            if f is not None:
                skip.update(e.index for e in f.edges)
        sel = [e for e in bm.edges if e.index not in skip]
        bmesh.ops.bevel(bm, geom=sel, offset=chamfer, offset_type="OFFSET", segments=1,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _drop_faces(bm, directions):
    """Delete the main face(s) pointing along each local direction -- only
    where the face is buried against the host and can never be seen."""
    for d in directions:
        f = _face_toward(bm, d)
        if f is not None:
            bmesh.ops.delete(bm, geom=[f], context="FACES_ONLY")


def _recess(bm, face, size, depth, centre=(0.0, 0.0), rim=0.004):
    """Cut a window of `size` (width along the face's local U, height along
    its V) into `face`, recessed by `depth`, its floor tagged `dark`. Two
    insets: a flat border out to the window, then a near-vertical wall."""
    lay = bm.faces.layers.int["tone"]
    n = face.normal.copy()
    c = face.calc_center_median()
    # face axes: U is the face's longer horizontal-ish edge direction
    vs = [v.co.copy() for v in face.verts]
    u = (vs[1] - vs[0])
    if abs(u.normalized().dot(Vector((0, 0, 1)))) > 0.7:
        u = (vs[2] - vs[1])
    u.normalize()
    v = n.cross(u).normalized()
    if v.z < 0:
        v = -v
        u = v.cross(n).normalized()
    bmesh.ops.inset_individual(bm, faces=[face], thickness=0.002, depth=0.0)
    cc = c + u * centre[0] + v * centre[1]
    hw, hh = size[0] / 2.0, size[1] / 2.0
    corners = []
    for vert in face.verts:
        d = vert.co - c
        su = 1.0 if d.dot(u) > 0 else -1.0
        sv = 1.0 if d.dot(v) > 0 else -1.0
        corners.append((vert, su, sv))
    for vert, su, sv in corners:
        vert.co = cc + u * (su * hw) + v * (sv * hh)
    bmesh.ops.inset_individual(bm, faces=[face], thickness=rim, depth=-depth)
    face[lay] = TONE_INDEX["dark"] + 1
    return face


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------

def chamfered_box(name, size, M, tone="paint", chamfer=CHAMFER, drop=(), mount=False, ground=False,
                  windows=()):
    """A cuboid of `size` (local x, y, z) centred on the local origin, every
    edge chamfered, `drop` faces (local directions) removed where buried.
    `windows`: [(direction, (w, h), depth, (cu, cv))] dark recessed windows."""
    bm = _chamfered_box_bm(size, chamfer, keep_sharp=drop)
    for d, wsize, depth, centre in windows:
        f = _face_toward(bm, d)
        _recess(bm, f, wsize, depth, centre)
    _drop_faces(bm, drop)
    return _to_piece(name, bm, tone, M, mount=mount, ground=ground, recalc=False)


def plain_box(name, size, M, tone="metal", drop=(), mount=False, ground=False):
    """An unchamfered cuboid: for parts under 3 cm, where a 1 cm chamfer
    would eat the part."""
    bm = _new_bm()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _drop_faces(bm, drop)
    return _to_piece(name, bm, tone, M, mount=mount, ground=ground, recalc=False)


def polyhedron(name, verts, faces, tone, chamfer=CHAMFER, mount=False, ground=False, drop=()):
    """A convex solid from WORLD vertices, chamfered; `drop` (world
    directions) faces are left unchamfered and removed, where buried."""
    bm = _new_bm()
    bv = [bm.verts.new(Vector(v)) for v in verts]
    for f in faces:
        bm.faces.new([bv[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if chamfer > 0:
        bm.edges.index_update()
        skip = set()
        for d in drop:
            f = _face_toward(bm, d)
            if f is not None:
                skip.update(e.index for e in f.edges)
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.index not in skip], offset=chamfer,
                        offset_type="OFFSET", segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _drop_faces(bm, drop)
    return _to_piece(name, bm, tone, mount=mount, ground=ground, recalc=False)


def wedge(name, size, M, tone="paint", setback=0.15, chamfer=CHAMFER, drop=()):
    """An angled armour module: a block of `size` (local x long, y thick, z
    high) whose front (+x) face leans back by `setback` at the top. The
    blockout's box, with the face that takes fire sloped."""
    sx, sy, sz = (s / 2.0 for s in size)
    lv = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
          (-sx, -sy, sz), (sx - setback, -sy, sz), (sx - setback, sy, sz), (-sx, sy, sz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    R = M.to_3x3()
    return polyhedron(name, [M @ Vector(v) for v in lv], faces, tone, chamfer,
                      drop=[(R @ Vector(d)).normalized() for d in drop])


def hex_bolt(name, at, normal, across=BOLT_ACROSS, height=BOLT_HEIGHT, spin=0.0, tone="metal", ground=False):
    """A hex bolt head standing on a surface: six flats, a flat top, no
    underside (it is sunk BOLT_SINK into the face it holds). 16 triangles."""
    n = Vector(normal).normalized()
    u, v = _perp(n)
    r = across / math.sqrt(3.0)  # across flats -> corner radius
    base = Vector(at) - n * BOLT_SINK
    top = Vector(at) + n * height
    verts, faces = [], []
    for c in (base, top):
        for k in range(6):
            a = math.radians(spin) + 2.0 * math.pi * k / 6.0
            verts.append(c + (u * math.cos(a) + v * math.sin(a)) * r)
    for k in range(6):
        faces.append((k, (k + 1) % 6, 6 + (k + 1) % 6, 6 + k))
    faces.append(tuple(range(6, 12)))
    p = Piece(name, verts, faces, tone, ground=ground)
    _orient_convex(p)
    return p


def bolt_row(name, p0, p1, n, normal, **kw):
    p0, p1 = Vector(p0), Vector(p1)
    return [hex_bolt(f"{name}{i}", p0.lerp(p1, (i + 0.5) / n if n > 1 else 0.5), normal, **kw)
            for i in range(n)]


def tube(name, p0, p1, r, sides=10, tone="metal", cap0=True, cap1=True, r1=None,
         mount=False, ground=False, smooth=True, spin=0.0):
    """A straight round tube from p0 to p1 (radius r, r1 at p1), optional
    flat caps. `sides` 8-12: under ~5 px in the garage a curve takes few."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    return lathe(name, [(0.0, r), (d.length, r if r1 is None else r1)], p0, d, sides=sides,
                 tones=[tone], cap0=cap0, cap1=cap1, mount=mount, ground=ground, smooth=smooth, spin=spin)


def lathe(name, profile, axis_p0, axis_dir, sides=12, tones=None, cap0=True, cap1=True,
          mount=False, ground=False, smooth=True, spin=0.0):
    """A surface of revolution: `profile` is [(t, r)] along the axis from
    `axis_p0` in `axis_dir`; one tone per profile SEGMENT (`tones`, default
    all metal). Caps close the first/last rings where r > 0."""
    o = Vector(axis_p0)
    d = Vector(axis_dir).normalized()
    u, v = _perp(d)
    tones = tones or ["metal"] * (len(profile) - 1)
    if len(tones) != len(profile) - 1:
        raise ValueError(f"{name}: {len(tones)} tones for {len(profile) - 1} segments")
    verts, faces, ftones = [], [], []
    for t, r in profile:
        c = o + d * t
        for k in range(sides):
            a = math.radians(spin) + 2.0 * math.pi * k / sides
            verts.append(c + (u * math.cos(a) + v * math.sin(a)) * r)
    for i in range(len(profile) - 1):
        a0, a1 = i * sides, (i + 1) * sides
        for k in range(sides):
            faces.append((a0 + k, a1 + k, a1 + (k + 1) % sides, a0 + (k + 1) % sides))
            ftones.append(tones[i])
    if cap0 and profile[0][1] > 0:
        faces.append(tuple(range(sides)))
        ftones.append(tones[0])
    last = (len(profile) - 1) * sides
    if cap1 and profile[-1][1] > 0:
        faces.append(tuple(range(last + sides - 1, last - 1, -1)))
        ftones.append(tones[-1])
    # Outward, from the profile: a segment (dt, dr) walked up the axis has
    # its outside at (-dr) along the axis plus (dt) radially.
    expected = []
    for i in range(len(profile) - 1):
        dt = profile[i + 1][0] - profile[i][0]
        dr = profile[i + 1][1] - profile[i][1]
        expected += [(-dr, dt)] * sides
    if cap0 and profile[0][1] > 0:
        expected.append((-1.0, 0.0))
    if cap1 and profile[-1][1] > 0:
        expected.append((1.0, 0.0))
    out = []
    for f, (ea, er) in zip(faces, expected):
        cen = sum((verts[i] for i in f), Vector()) / len(f)
        rad = cen - o - d * (cen - o).dot(d)
        rad = rad.normalized() if rad.length > 1e-9 else Vector()
        want = d * ea + rad * er
        va, vb, vc = verts[f[0]], verts[f[1]], verts[f[2]]
        nn = (vb - va).cross(vc - va)
        out.append(tuple(reversed(f)) if nn.dot(want) < 0 else f)
    return Piece(name, verts, out, ftones, smooth=smooth, mount=mount, ground=ground)


def _orient_convex(piece):
    """Point every face of a CONVEX piece away from its centroid."""
    cen0 = sum(piece.verts, Vector()) / len(piece.verts)
    out = []
    for f in piece.faces:
        va, vb, vc = piece.verts[f[0]], piece.verts[f[1]], piece.verts[f[2]]
        nn = (vb - va).cross(vc - va)
        cen = sum((piece.verts[i] for i in f), Vector()) / len(f)
        out.append(tuple(reversed(f)) if nn.dot(cen - cen0) < 0 else f)
    piece.faces = out


def bar(name, a, b, w, h=None, tone="paint", cap_a=False, cap_b=False, up=None, mount=False):
    """A rectangular bar from point `a` to point `b`: `w` wide, `h` high
    (square when h is None). Flats aligned to world Z where possible so slat
    reads as slat. Ends open by default: a bar's ends are welded into posts."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    if up is None:
        u, v = _perp(d)
    else:
        v = (Vector(up) - d * Vector(up).dot(d)).normalized()
        u = v.cross(d).normalized()
    h = w if h is None else h
    off = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    verts = [c + u * ou + v * ov for c in (a, b) for ou, ov in off]
    faces = [(k, (k + 1) % 4, 4 + (k + 1) % 4, 4 + k) for k in range(4)]
    if cap_a:
        faces.append((3, 2, 1, 0))
    if cap_b:
        faces.append((4, 5, 6, 7))
    p = Piece(name, verts, faces, tone, mount=mount)
    _orient_convex(p)
    return p


def uv_ball(name, centre, r, segments=8, rings=4, tone="metal"):
    """A UV sphere (poles top and bottom, `rings` bands), smooth-shaded.
    Built vertex by vertex: `bmesh.ops.create_uvsphere` was measured to emit
    its faces in a different ORDER from one Blender process to the next, which
    made two exports of the same kit differ in their index buffers."""
    c = Vector(centre)
    verts = [c + Vector((0.0, 0.0, r))]
    for i in range(1, rings):
        th = math.pi * i / rings
        for k in range(segments):
            ph = 2.0 * math.pi * k / segments
            verts.append(c + Vector((r * math.sin(th) * math.cos(ph), r * math.sin(th) * math.sin(ph), r * math.cos(th))))
    verts.append(c + Vector((0.0, 0.0, -r)))
    bottom = len(verts) - 1
    faces = []
    for k in range(segments):
        faces.append((0, 1 + k, 1 + (k + 1) % segments))
    for i in range(rings - 2):
        a0, a1 = 1 + i * segments, 1 + (i + 1) * segments
        for k in range(segments):
            faces.append((a0 + k, a1 + k, a1 + (k + 1) % segments, a0 + (k + 1) % segments))
    last = 1 + (rings - 2) * segments
    for k in range(segments):
        faces.append((last + (k + 1) % segments, last + k, bottom))
    p = Piece(name, verts, faces, tone, smooth=True)
    _orient_convex(p)
    return p


# ---------------------------------------------------------------------------
# hardware
# ---------------------------------------------------------------------------

def lifting_eye(name, at, normal, along, r=0.028, t=0.009, segs=3, tone="metal"):
    """A welded lifting eye: a half-ring arch of round-ish (3-sided) bar
    standing on a surface, in the plane of `normal` and `along`."""
    n = Vector(normal).normalized()
    a = Vector(along)
    a = (a - n * a.dot(n)).normalized()
    pts = []
    for k in range(segs + 1):
        th = math.pi * k / segs
        pts.append(Vector(at) + a * (r * math.cos(th)) + n * (r * math.sin(th) - t))
    return sweep(name, pts, t, sides=3, closed=False, tone=tone, normal_hint=n.cross(a))


def sweep(name, pts, wire_r, sides=3, closed=True, tone="metal", normal_hint=None, smooth=True, spin=0.0):
    """A `sides`-gon section swept along the polyline `pts` (closed loop or
    open). The section is mitred at each vertex (bisector frame)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    hint = Vector(normal_hint) if normal_hint is not None else None
    rings = []
    for i in range(n):
        if closed:
            tin = (pts[i] - pts[i - 1]).normalized()
            tout = (pts[(i + 1) % n] - pts[i]).normalized()
        else:
            tin = (pts[i] - pts[max(i - 1, 0)]).normalized() if i > 0 else (pts[1] - pts[0]).normalized()
            tout = (pts[min(i + 1, n - 1)] - pts[i]).normalized() if i < n - 1 else tin
        tan = (tin + tout)
        tan = tan.normalized() if tan.length > 1e-9 else tout
        if hint is not None:
            b = hint.cross(tan)
            b = b.normalized() if b.length > 1e-9 else _perp(tan)[0]
            c = tan.cross(b).normalized()
        else:
            b, c = _perp(tan)
        # mitre: scale the ring by 1/cos(half-angle) in the bend plane
        cosh = max(tin.dot(tan), 0.5)
        ring = []
        for k in range(sides):
            ang = 2.0 * math.pi * k / sides + math.radians(spin)
            off = b * math.cos(ang) + c * math.sin(ang)
            # stretch the component lying in the bend plane
            bend = (tout - tin)
            if bend.length > 1e-9:
                bend.normalize()
                comp = off.dot(bend)
                off = off + bend * comp * (1.0 / cosh - 1.0)
            ring.append(pts[i] + off * wire_r)
        rings.append(ring)
    verts = [p for ring in rings for p in ring]
    faces, refs = [], []
    segs = n if closed else n - 1
    for i in range(segs):
        a0, a1 = i * sides, ((i + 1) % n) * sides
        mid = (pts[i] + pts[(i + 1) % n]) / 2.0     # a wall: away from its segment's axis
        for k in range(sides):
            faces.append((a0 + k, a1 + k, a1 + (k + 1) % sides, a0 + (k + 1) % sides))
            refs.append(mid)
    if not closed:                                  # end caps: away from the neighbouring ring
        faces.append(tuple(range(sides - 1, -1, -1)))
        refs.append(pts[1])
        last = (n - 1) * sides
        faces.append(tuple(range(last, last + sides)))
        refs.append(pts[n - 2])
    out = []
    for f, ref in zip(faces, refs):
        va, vb, vc = verts[f[0]], verts[f[1]], verts[f[2]]
        nn = (vb - va).cross(vc - va)
        cen = sum((verts[i] for i in f), Vector()) / len(f)
        out.append(tuple(reversed(f)) if nn.dot(cen - ref) < 0 else f)
    return Piece(name, verts, out, tone, smooth=smooth)


def chain_link(name, centre, axis_down, plane_dir, length, width, wire_r, segs=6, tone="metal"):
    """One oval chain link: an elongated `segs`-gon loop of 3-sided wire,
    `length` along `axis_down`, `width` along `plane_dir`. 36 triangles."""
    c = Vector(centre)
    d = Vector(axis_down).normalized()
    w = Vector(plane_dir)
    w = (w - d * w.dot(d)).normalized()
    hl, hw = length / 2.0 - wire_r, width / 2.0 - wire_r
    pts = []
    for k in range(segs):
        th = 2.0 * math.pi * k / segs
        s_ = math.sin(th)
        side = 0.0 if abs(s_) < 1e-6 else math.copysign(min(1.0, abs(s_) * 1.6), s_)
        pts.append(c + d * (hl * math.cos(th)) + w * (hw * side))  # an elongated, stadium-like loop
    return sweep(name, pts, wire_r, sides=3, closed=True, tone=tone, normal_hint=d.cross(w))


def chain(name, top, drop, ball_r, pitch=0.085, width=0.048, wire_r=0.008, spin_axis=(0.0, 1.0, 0.0)):
    """A hanging chain from `top` down `drop` to the CENTRE of an end ball of
    radius `ball_r`: oval links alternating 90 degrees, the top link looped
    over the rail at `top`, the last link biting into the ball."""
    top = Vector(top)
    span = drop - ball_r
    if span < pitch * 0.5:
        raise ValueError(f"{name}: a {drop:.3f} m drop leaves {span:.3f} m of chain above a {ball_r} m ball "
                         f"(less than half a link) -- what is under it?")
    n = max(1, int(round(span / pitch)))
    p = span / n
    down = Vector((0.0, 0.0, -1.0))
    a = Vector(spin_axis)
    b = down.cross(a)
    out = []
    for j in range(n):
        cz = top + down * (p * (j + 0.5))
        out.append(chain_link(f"{name}_l{j}", cz, down, a if j % 2 == 0 else b,
                              p + 4.0 * wire_r, width, wire_r))
    out.append(uv_ball(f"{name}_ball", top + down * drop, ball_r, segments=6, rings=4))
    return out


def hinge(name, a, b, r=0.014, sides=6, tone="metal"):
    """A hinge knuckle: a capped round barrel from a to b."""
    return [tube(name, a, b, r, sides=sides, tone=tone)]


def latch(name, at, normal, up, size=(0.05, 0.016, 0.07), tone="metal"):
    """A box latch: hasp body on the face, a lip over the joint above."""
    n = Vector(normal).normalized()
    upv = Vector(up)
    upv = (upv - n * upv.dot(n)).normalized()
    M = frame(Vector(at) + n * (size[1] / 2 - 0.002), n.cross(upv), upv)
    # local x across, local y = -n? frame gives local Z = up, local X = across; local Y = Z x X
    return [plain_box(name, (size[0], size[1], size[2]), M, tone=tone, drop=())]


# ---------------------------------------------------------------------------
# assemblies
# ---------------------------------------------------------------------------

def slat_panel(name, p0, p1, z0, z1, pitch=0.12, bar_t=0.03, post_every=1.0, skip_posts=(),
               tone="paint"):
    """Bar (slat) armour per K7: posts and top/bottom rails 48 mm (1.6x the
    bar), horizontal bars 30 mm at `pitch`, the SAME layout as
    kit_blockout.slat_panel (posts every <= post_every, bars at z0 + k*pitch).
    The rails are 48 mm high and 40 mm deep and the posts stand 6 mm proud of
    them, so no rail face is coplanar with a post face (a shared plane
    z-fights). `skip_posts`: post indices a neighbouring panel already built."""
    p0, p1 = Vector((p0[0], p0[1], 0.0)), Vector((p1[0], p1[1], 0.0))
    post_t = bar_t * 1.6
    rail_d = post_t - 0.008
    out = []
    span = (p1 - p0).length
    n_posts = max(2, int(math.ceil(span / post_every)) + 1)
    posts = []
    for i in range(n_posts):
        p = p0.lerp(p1, i / (n_posts - 1))
        posts.append(p)
        if i in skip_posts:
            continue
        out.append(bar(f"{name}_post{i}", (p.x, p.y, z0 - post_t / 2 - 0.006), (p.x, p.y, z1 + post_t / 2 + 0.006),
                       post_t, tone=tone, cap_a=True, cap_b=True, up=(p1 - p0)))
    flat = Vector((0.0, 0.0, 1.0))
    for z in (z0, z1):
        out.append(bar(f"{name}_rail{z:.2f}", (p0.x, p0.y, z), (p1.x, p1.y, z), rail_d, post_t, tone=tone, up=flat))
    n = int((z1 - z0) / pitch)
    for k in range(1, n):
        z = z0 + k * pitch
        out.append(bar(f"{name}_slat{k}", (p0.x, p0.y, z), (p1.x, p1.y, z), bar_t, tone=tone, up=flat))
    return out, posts


def strut(name, a, b, t=0.03, pad=0.07, pad_normal=None, tone="paint"):
    """A welded bracket: a square bar from the armour at `a` back to the hull
    at `b`, with a foot pad on the hull. Mount hardware."""
    a, b = Vector(a), Vector(b)
    # run 1 cm into the hull, so a slanted surface never shows the open end
    out = [bar(f"{name}_bar", a, b + (b - a).normalized() * 0.01, t, tone=tone, mount=True)]
    if pad:
        n = Vector(pad_normal) if pad_normal is not None else (a - b).normalized()
        M = frame(b + n * 0.004, _perp(n)[0], n)
        out.append(plain_box(f"{name}_pad", (pad, pad, 0.01), M, tone=tone, drop=((0, 0, -1),), mount=True))
    return out


def pedestal(name, xy, lo, hi, top, r, flange_r, sides=10, flange_h=0.014, sink=0.005, bolts=0,
             bolt_r=None, bolt_deg=30.0, bolt_across=0.024, bolt_height=0.01, tone="metal"):
    """A round pedestal standing on uneven roof: a flange from just under the
    lowest roof point (`lo`) to `flange_h` over the highest (`hi`), the post
    up to `top`, and `bolts` hex bolts round the flange. GROUND pieces: they
    reach the hull wherever the blockout's box floated over it."""
    x, y = xy
    ft = hi + flange_h
    prof = [(lo - sink, flange_r), (ft, flange_r), (ft, r), (top, r)]
    out = [lathe(name, [(z - lo, rr) for z, rr in prof], (x, y, lo), (0, 0, 1), sides=sides,
                 tones=[tone] * 3, cap0=False, cap1=False, ground=True)]
    br = (r + flange_r) / 2 if bolt_r is None else bolt_r
    for i in range(bolts):
        a = math.radians(bolt_deg + 360.0 * i / bolts)
        out.append(hex_bolt(f"{name}_b{i}", (x + br * math.cos(a), y + br * math.sin(a), ft), (0, 0, 1),
                            across=bolt_across, height=bolt_height, ground=True))
    return out


def telescoping_mast(name, xy, lo, hi, heights, radii, flange_r, sides=10, collar=0.012, collar_h=0.03,
                     bolts=4, tone="metal"):
    """A telescoping mast on a bolted base flange: stepped tubes (`heights`,
    `radii`, bottom up, the first standing on the flange), a clamp collar at
    every joint, a capped top. Returns (pieces, top_z)."""
    x, y = xy
    ft = hi + 0.014
    prof = [(lo - 0.005, flange_r), (ft, flange_r), (ft, radii[0])]
    z = ft
    for i, (h, r) in enumerate(zip(heights, radii)):
        z_end = z + h
        if i + 1 < len(heights):
            prof += [(z_end - collar_h, r), (z_end - collar_h, r + collar), (z_end, r + collar),
                     (z_end, radii[i + 1])]
        else:
            prof.append((z_end, r))
        z = z_end
    out = [lathe(name, [(t - lo, rr) for t, rr in prof], (x, y, lo), (0, 0, 1), sides=sides,
                 tones=[tone] * (len(prof) - 1), cap0=False, cap1=True, ground=True)]
    br = (radii[0] + flange_r) / 2
    for i in range(bolts):
        a = 2.0 * math.pi * i / bolts + math.pi / 4
        out.append(hex_bolt(f"{name}_b{i}", (x + br * math.cos(a), y + br * math.sin(a), ft), (0, 0, 1),
                            across=0.024, height=0.01, ground=True))
    return out, z


def camera_head(name, size, M, face=(1, 0, 0), window=(0.08, 0.05), depth=0.014, centre=(0.0, 0.0),
                drop=(), tone="metal"):
    """A camera / sensor housing: a chamfered box with a recessed dark window
    on `face` (local direction)."""
    return chamfered_box(name, size, M, tone=tone, drop=drop, windows=((face, window, depth, centre),))


def sight_head(name, centre, bottom, size=(0.40, 0.32, 0.28), body_h=0.22, window=(0.24, 0.07),
               window_depth=0.016, hood=(0.39, 0.34, 0.06), hood_shift=0.025,
               door=(0.014, 0.22, 0.13), tone="metal"):
    """A periscopic sight head facing +X: a body with a recessed dark window,
    a hood cap overhanging the window, an access door on the back. `centre`
    is the head's plan centre (x, y), `bottom` its underside."""
    cx, cy = centre[0], centre[1]
    body = Vector((cx, cy, bottom + body_h / 2))
    return [
        chamfered_box(f"{name}_body", (size[0], size[1], body_h), place(body), tone=tone,
                      windows=(((1, 0, 0), window, window_depth, (0.0, 0.01)),)),
        chamfered_box(f"{name}_hood", hood, place((cx + hood_shift, cy, bottom + body_h + hood[2] / 2)), tone=tone),
        chamfered_box(f"{name}_door", door, place((cx - size[0] / 2 - 0.005, cy, body.z - 0.01)),
                      tone=tone, chamfer=0.005, drop=((1, 0, 0),)),
    ]


def sight_box(name, centre, size, window, window_depth=0.018, window_centre=(0.0, 0.03),
              visor=(0.10, 0.44, 0.035), visor_drop=0.135, tone="metal"):
    """A gunner's sight box facing +X: chamfered body, a wide recessed dark
    window, a visor plate over it standing proud of the front face."""
    c = Vector(centre)
    return [
        chamfered_box(f"{name}_body", size, place(c), tone=tone,
                      windows=(((1, 0, 0), window, window_depth, window_centre),)),
        chamfered_box(f"{name}_visor", visor, place((c.x + size[0] / 2 - 0.005, c.y, c.z + visor_drop)),
                      tone=tone, chamfer=0.006),
    ]


def eo_drum(name, xy, z0, r=0.25, h=0.22, sides=16, band=(0.06, 0.145), inset=0.014, crown=0.012,
            tone="metal"):
    """A 360-degree EO/IR drum: a round housing with a recessed dark window
    band all round and a chamfered crown; its underside a flat plate."""
    z1 = z0 + h
    prof = [(z0, r), (z0 + band[0], r), (z0 + band[0], r - inset),
            (z0 + band[1], r - inset), (z0 + band[1], r), (z1 - crown, r), (z1, r - crown)]
    tones = [tone, tone, "dark", tone, tone, tone]
    return [lathe(name, [(z - z0, rr) for z, rr in prof], (xy[0], xy[1], z0), (0, 0, 1), sides=sides,
                  tones=tones)]


def thermal_sleeve(name, axis_y, axis_z, a, c, root_end, rs, rb, w=0.05, end_r=0.088, sides=10,
                   start_r=None, tone="metal"):
    """A barrel thermal sleeve along +X from `a` to `c` on the barrel axis
    (y, z): radius `rs`, three clamp bands of radius `rb` (a ridged band where
    the barrel's root ends, one midway, a flat one at the muzzle end), closed
    down to the barrel at the muzzle end (`end_r`). With `start_r` (the
    barrel's radius at `a`) its rear end is a closed collar against the
    barrel's root; without, its start is hidden inside the root."""
    mid = (root_end + c) / 2
    prof = [(a, rs), (root_end, rs), (root_end + w / 2, rb), (root_end + w, rs),
            (mid - w / 2, rs), (mid, rb), (mid + w / 2, rs),
            (c - w, rs), (c - w, rb), (c, rb), (c, end_r)]
    if start_r is not None:
        prof = [(a, start_r), (a, rb), (a + w, rb), (a + w, rs),
                (mid - w / 2, rs), (mid, rb), (mid + w / 2, rs),
                (c - w, rs), (c - w, rb), (c, rb), (c, end_r)]
    return [lathe(name, [(x - a, r) for x, r in prof], (a, axis_y, axis_z), (1, 0, 0), sides=sides,
                  tones=[tone] * (len(prof) - 1), cap0=False, cap1=False)]


def muzzle_sensor(name, centre, size=(0.14, 0.10, 0.10), post_to=None, tone="metal"):
    """A muzzle reference sensor: a small chamfered housing whose dark window
    looks back (-X) at the turret, on a post down to the barrel at `post_to`."""
    c = Vector(centre)
    out = [chamfered_box(name, size, place(c), tone=tone, chamfer=0.006,
                         windows=(((-1, 0, 0), (0.06, 0.05), 0.01, (0.0, 0.0)),))]
    if post_to is not None:
        out.append(bar(f"{name}_post", (c.x, c.y, c.z - size[2] / 2), Vector(post_to) - Vector((0, 0, 0.01)),
                       0.03, 0.05, tone=tone, mount=True, up=(1, 0, 0)))
    return out


def crosswind_sensor(name, xy, lo, hi, head_z, pole_r=0.025, flange_r=0.06, span=0.13, pod_r=0.025,
                     pod_len=0.06, tone="metal"):
    """A crosswind sensor: a pole on a bolted flange, a T-head bar with a
    hub, and a sensor pod at each end of the T."""
    x, y = xy
    out = pedestal(name, xy, lo, hi, head_z, pole_r, flange_r, sides=8, sink=0.004, bolts=2,
                   bolt_r=0.045, bolt_deg=0.0, bolt_across=0.02, bolt_height=0.008, tone=tone)
    out.append(tube(f"{name}_bar", (x, y + span, head_z), (x, y - span, head_z), 0.016, sides=8, tone=tone))
    out.append(plain_box(f"{name}_hub", (0.05, 0.05, 0.05), place((x, y, head_z)), tone=tone))
    for i, yy in enumerate((y + span + 0.02, y - span - 0.02)):
        out.append(tube(f"{name}_pod{i}", (x - pod_len / 2, yy, head_z), (x + pod_len / 2, yy, head_z), pod_r,
                        sides=8, tone=tone))
    return out


def ammo_container(name, centre_xy, bottom, size=(0.80, 1.40, 0.413), lid=(0.84, 1.44, 0.05), lid_z=None,
                   hinge_y=(-0.42, 0.42), ribs_x=(-0.2, 0.2), tone="paint"):
    """An armoured ammunition container: a chamfered body, a lid overlapping
    it, two hinge knuckles on the rear edge, two latches across the front
    joint, a lifting eye on the lid over each latch, stiffening ribs on the
    long sides. Front is +X."""
    cx, cy = centre_xy
    lid_z = bottom + size[2] + lid[2] / 2 if lid_z is None else lid_z
    out = [chamfered_box(f"{name}_body", size, place((cx, cy, bottom + size[2] / 2)), tone=tone),
           chamfered_box(f"{name}_lid", lid, place((cx, cy, lid_z)), tone=tone)]
    for i, yy in enumerate(hinge_y):
        out += hinge(f"{name}_hinge{i}", (cx - lid[0] / 2, yy - 0.09, lid_z - 0.03),
                     (cx - lid[0] / 2, yy + 0.09, lid_z - 0.03))
        out += latch(f"{name}_latch{i}", (cx + size[0] / 2, yy, lid_z - 0.045), (1, 0, 0), (0, 0, 1))
        out.append(lifting_eye(f"{name}_eye{i}", (cx, yy * 1.35, lid_z + lid[2] / 2), (0, 0, 1), (1, 0, 0)))
    for tag, s in (("L", 1), ("R", -1)):
        for j, dx in enumerate(ribs_x):
            out.append(plain_box(f"{name}_rib{tag}{j}", (0.04, 0.02, size[2] - 0.04),
                                 place((cx + dx, cy + s * (size[1] / 2 + 0.008), bottom + size[2] / 2)), tone=tone,
                                 drop=((0, -s, 0),)))
    return out


def wedge_module(name, size, M, side, setback=0.14, plate=(0.66, 0.016, 0.27), plate_at=(-0.07, -0.02),
                 bolts=((-0.36, 0.09), (0.22, 0.09), (-0.36, -0.13), (0.22, -0.13)), eye_u=-0.22,
                 tone="paint"):
    """An add-on armour module in the local frame `M` (x long, y thick, z
    high; its outer face is local `side` * +Y): a block whose front face
    leans back by `setback` (0 makes it an ERA brick), a chamfered face plate
    on the outer face, hex bolts through the plate, and a lifting eye on top
    (`eye_u` None for none). The inner face is buried and left out."""
    s = side
    out = [wedge(f"{name}_body", size, M, tone=tone, setback=setback, drop=((0, -s, 0),))]
    pM = M @ place((plate_at[0], s * (size[1] / 2 + plate[1] / 2), plate_at[1]))
    out.append(chamfered_box(f"{name}_plate", plate, pM, tone=tone, chamfer=0.006, drop=((0, -s, 0),)))
    n_out = (M.to_3x3() @ Vector((0, s, 0))).normalized()
    for i, (u, w) in enumerate(bolts):
        out.append(hex_bolt(f"{name}_bolt{i}", M @ Vector((u, s * (size[1] / 2 + plate[1]), w)), n_out))
    if eye_u is not None:
        out.append(lifting_eye(f"{name}_eye", M @ Vector((eye_u, 0.0, size[2] / 2)), (0, 0, 1),
                               M.to_3x3() @ Vector((1, 0, 0))))
    return out


def era_brick(name, size, M, side, bolts=((-0.25, 0.12), (0.25, 0.12), (-0.25, -0.12), (0.25, -0.12)),
              plate_inset=0.05, plate=True, tone="paint"):
    """An ERA / armour brick in frame `M` (x long, y thick, z high; outer
    face local `side` * +Y): a chamfered body (its buried inner face left
    out), a face plate inset `plate_inset` from its edges (`plate` False for
    none), bolt heads at fractions (u, w) of the face."""
    s = side
    out = [wedge(f"{name}_body", size, M, tone=tone, setback=0.0, drop=((0, -s, 0),))]
    t = 0.0
    if plate:
        t = 0.012
        pM = M @ place((0.0, s * (size[1] / 2 + t / 2), 0.0))
        out.append(plain_box(f"{name}_plate", (size[0] - 2 * plate_inset, t, size[2] - 2 * plate_inset), pM,
                             tone=tone, drop=((0, -s, 0),)))
    n_out = (M.to_3x3() @ Vector((0, s, 0))).normalized()
    for i, (u, w) in enumerate(bolts):
        out.append(hex_bolt(f"{name}_bolt{i}", M @ Vector((u * size[0], s * (size[1] / 2 + t), w * size[2])), n_out))
    return out


def armour_plate(name, size, M, bolts=(), eyes=(), panel_inset=None, tone="paint"):
    """A bolt-on applique plate in frame `M` (x, y in the plate, local +Z its
    outer normal): a chamfered slab whose inner face is left out, an optional
    raised face panel inset `panel_inset`, hex bolts and lifting eyes at
    fractions (u, v) of the plate."""
    out = [chamfered_box(f"{name}", size, M, tone=tone, drop=((0, 0, -1),))]
    top = size[2] / 2
    if panel_inset is not None:
        out.append(plain_box(f"{name}_panel", (size[0] - 2 * panel_inset, size[1] - 2 * panel_inset, 0.012),
                             M @ place((0, 0, top + 0.006)), tone=tone, drop=((0, 0, -1),)))
        top += 0.012
    n = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
    for i, (u, v) in enumerate(bolts):
        out.append(hex_bolt(f"{name}_b{i}", M @ Vector((u * size[0], v * size[1], top)), n))
    for i, (u, v) in enumerate(eyes):
        out.append(lifting_eye(f"{name}_e{i}", M @ Vector((u * size[0], v * size[1], top)), n,
                               M.to_3x3() @ Vector((1, 0, 0))))
    return out


def bent_arm(name, pts, w=0.03, tone="metal"):
    """A bent bracket: a square bar `w` across swept along a polyline, both
    ends capped. `mount` hardware: its far end enters the part it holds."""
    p = sweep(name, pts, w / math.sqrt(2.0), sides=4, closed=False, tone=tone, smooth=False, spin=45.0)
    p.mount = True
    return [p]


def feed_chute(name, pts, w=0.08, tone="metal"):
    """An ammunition feed chute: a square section `w` across swept along a
    polyline, open at both ends where it enters the magazine and the gun.
    It welds into the gun's feed port (`weld`), and is part of the mock's
    shape (the blockout drew its chutes), so it is not `mount`."""
    p = sweep(name, pts, w / math.sqrt(2.0), sides=4, closed=False, tone=tone, smooth=False, spin=45.0)
    p.weld = True
    return [p]


def radar_array(name, M, size, hinge_knuckle=True, tone="metal"):
    """A flat radar antenna in frame `M` (x thick, y wide, z high; its face
    toward local +X): a chamfered body, a raised face panel (in the body's
    tone: a radome is not a lens), and a rear hinge knuckle along the top."""
    out = [chamfered_box(f"{name}", size, M, tone=tone)]
    out.append(chamfered_box(f"{name}_face", (0.012, size[1] - 0.06, size[2] - 0.06),
                             M @ place((size[0] / 2 + 0.006, 0, 0)), tone=tone, chamfer=0.004,
                             drop=((-1, 0, 0),)))
    if hinge_knuckle:
        R = M.to_3x3()
        c = M.translation
        a = c + R @ Vector((-size[0] / 2 - 0.012, -size[1] * 0.3, size[2] * 0.3))
        b = c + R @ Vector((-size[0] / 2 - 0.012, size[1] * 0.3, size[2] * 0.3))
        out += hinge(f"{name}_hinge", a, b, r=0.016)
    return out


def barrel_shroud(name, axis_y, axis_z, a, c, rs, rb, r_in, w=0.05, sides=8, spin=0.0, tone="metal"):
    """A heat shroud over a barrel from x=a to x=c: radius `rs`, a clamp band
    of radius `rb` at each end, closed down to the barrel (`r_in`) at both.
    `sides=4, spin=45` makes it a square sleeve with flat faces on Y and Z
    (the radii are then half-diagonals), for a barrel that is a square bar."""
    prof = [(a, r_in), (a, rb), (a + w, rb), (a + w, rs), (c - w, rs), (c - w, rb), (c, rb), (c, r_in)]
    return [lathe(name, [(x - a, r) for x, r in prof], (a, axis_y, axis_z), (1, 0, 0), sides=sides,
                  tones=[tone] * (len(prof) - 1), cap0=False, cap1=False, spin=spin, smooth=sides > 4)]


def cowl(name, at, w, l, h, t=0.05, bolts=True, port=None, port_chamfer=True, tone="paint"):
    """An armoured cowl round a weapon station (kit_blockout.cowl's layout):
    a front plate across +X and two cheeks along X, chamfered, the cheeks
    bolted to the front plate. `port` (y0, y1, z0, z1), world: a real
    opening in the front plate for the barrel -- the plate is then four
    pieces round it (two sides, chamfered unless `port_chamfer` is False,
    and a plain sill and lintel)."""
    x, y, z = at
    fx = x + l / 2
    if port is None:
        front = [chamfered_box(f"{name}_f", (t, w, h), place((fx, y, z)), tone=tone, chamfer=0.008)]
    else:
        y0, y1, z0, z1 = port
        ylo, yhi, zlo, zhi = y - w / 2, y + w / 2, z - h / 2, z + h / 2
        side = ((lambda n, sz, M: chamfered_box(n, sz, M, tone=tone, chamfer=0.008)) if port_chamfer
                else (lambda n, sz, M: plain_box(n, sz, M, tone=tone)))
        front = [side(f"{name}_f0", (t, y0 - ylo, h), place((fx, (ylo + y0) / 2, z))),
                 side(f"{name}_f1", (t, yhi - y1, h), place((fx, (y1 + yhi) / 2, z))),
                 plain_box(f"{name}_f2", (t, y1 - y0, z0 - zlo), place((fx, (y0 + y1) / 2, (zlo + z0) / 2)), tone=tone),
                 plain_box(f"{name}_f3", (t, y1 - y0, zhi - z1), place((fx, (y0 + y1) / 2, (z1 + zhi) / 2)), tone=tone)]
    out = front + [chamfered_box(f"{name}_l", (l, t, h), place((x, y + w / 2, z)), tone=tone, chamfer=0.008),
                   chamfered_box(f"{name}_r", (l, t, h), place((x, y - w / 2, z)), tone=tone, chamfer=0.008)]
    if bolts:
        for s in (1, -1):
            for k, dz in enumerate((-h * 0.3, h * 0.3)):
                out.append(hex_bolt(f"{name}_b{s}{k}", (x + l / 2 - t / 2 - 0.03, y + s * (w / 2 + t / 2), z + dz),
                                    (0, s, 0), across=0.024, height=0.01))
    return out


def sensor_ball(name, centre, r, segments=10, rings=6, window=True, yoke=True, tone="metal"):
    """A stabilised sensor ball: a UV sphere, a dark window band set into its
    front (+X) face, and a yoke collar under it."""
    c = Vector(centre)
    out = [uv_ball(f"{name}", c, r, segments=segments, rings=rings, tone=tone)]
    if window:
        out.append(chamfered_box(f"{name}_win", (0.02, r * 0.9, r * 0.55), place((c.x + r * 0.93, c.y, c.z)),
                                 tone="dark", chamfer=0.004))
    if yoke:
        out.append(tube(f"{name}_yoke", (c.x, c.y, c.z - r * 1.05), (c.x, c.y, c.z - r * 0.8), r * 0.45,
                        sides=segments, r1=r * 0.55))
    return out


def ammo_box(name, size, M, lid_h=0.04, latches=True, handle=True, tone="metal"):
    """A small ammunition box in frame `M` (local Z up): a chamfered body, a
    lid lip, two latches on the front (+X) face and a carry handle."""
    out = [chamfered_box(f"{name}", (size[0], size[1], size[2] - lid_h), M @ place((0, 0, -lid_h / 2)), tone=tone,
                         chamfer=0.008),
           chamfered_box(f"{name}_lid", (size[0] + 0.012, size[1] + 0.012, lid_h), M @ place((0, 0, size[2] / 2 - lid_h / 2)),
                         tone=tone, chamfer=0.006)]
    R = M.to_3x3()
    if latches:
        for i, v in enumerate((-0.3, 0.3)):
            out += latch(f"{name}_latch{i}", M @ Vector((size[0] / 2, v * size[1], size[2] / 2 - lid_h - 0.01)),
                         R @ Vector((1, 0, 0)), R @ Vector((0, 0, 1)), size=(0.035, 0.012, 0.05), tone=tone)
    if handle:
        out.append(lifting_eye(f"{name}_handle", M @ Vector((0, 0, size[2] / 2)), R @ Vector((0, 0, 1)),
                               R @ Vector((0, 1, 0)), r=min(0.05, size[1] * 0.3), t=0.008))
    return out


def hung_module(name, size, at, side, skin, hangers=(-0.25, 0.25), tree=None, tone="paint"):
    """A stand-off armour module hung on the hull: a closed chamfered box
    centred on `at` (it stands off the side, so its back is seen), and per
    hanger a flat strap from the middle of its top inward and up onto the
    deck at |y| `skin` - 0.04 (the deck measured in `tree`), bolted there.
    +Y * `side` faces out."""
    s = side
    c = Vector(at)
    # closed but for its underside, which no camera above the ground sees
    out = [chamfered_box(f"{name}", size, place(at), tone=tone, drop=((0, 0, -1),))]
    top = c.z + size[2] / 2
    for j, dx in enumerate(hangers):
        x = c.x + dx
        yi = s * (skin - 0.04)
        zd = top
        if tree is not None:
            hit = tree.ray_cast(Vector((x, yi, top + 1.0)), Vector((0.0, 0.0, -1.0)))
            if hit[0] is not None:
                zd = max(top, hit[0].z)
        # (its module end sunk 3 mm into the module's top: welded, not resting)
        out.append(bar(f"{name}_hang{j}", (x, c.y, top + 0.003), (x, yi, zd + 0.006), 0.07, 0.012, tone=tone,
                       cap_a=True, cap_b=True, up=(0, 0, 1), mount=True))
        bolt = hex_bolt(f"{name}_bolt{j}", (x, yi, zd + 0.012), (0, 0, 1))
        bolt.mount = True                 # it holds the strap to the deck
        out.append(bolt)
    return out


def chain_curtain(name, x, ys, drops, rail_z, ball_r=0.055, rail_r=0.02, overhang=0.05, brackets=()):
    """A ball-and-chain curtain: a round rail along Y at (x, rail_z) running
    `overhang` past the outer chains, the `brackets` (mount pieces, built by
    the caller against the hull) and one chain per `ys`/`drops`."""
    out = [tube(f"{name}_rail", (x, ys[0] + math.copysign(overhang, ys[0] - ys[-1]), rail_z),
                (x, ys[-1] - math.copysign(overhang, ys[0] - ys[-1]), rail_z), rail_r, sides=8, mount=True)]
    out += list(brackets)
    for i, (y, d) in enumerate(zip(ys, drops)):
        out += chain(f"{name}{i}", (x, y, rail_z), d, ball_r, spin_axis=(0, 1, 0))
    return out


# ---------------------------------------------------------------------------
# conformal armour: a flat outer face, a back that follows the hull
# ---------------------------------------------------------------------------

def _newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def conform_slab(name, centre, U, V, N, length, height, thick, tree, nu=5, nv=3, proud=0.004, t_min=0.012,
                 max_fill=0.04, chamfer=CHAMFER, setback=0.0, reach=0.6, tone="paint"):
    """An armour slab whose OUTER face is flat and whose BACK follows the
    surface in `tree` -- a plate or a module bolted onto a curved or sloped
    hull face without ever passing into it (the clash check's 1 cm rule).

    The outer face is the rectangle `length` x `height` centred on `centre`,
    spanned by unit axes U (length) and V (height), facing out along N; with
    `setback` its +U edge leans back toward -U by that much at the +V edge
    (a wedge module's sloped front). The back is sampled on an nu x nv grid:
    each grid point is ray-cast inward along -N and its back vertex set
    `proud` clear of the surface, never thinner than `t_min` behind the 1 cm
    chamfer, never deeper than `thick` + `max_fill` (a plate seated at its
    nearest point fills down onto the hull up to `max_fill` and leaves a gap
    beyond -- its back is closed, so a gap never shows a hollow), and at the
    nominal `thick` where the ray finds nothing. Where the surface stands
    higher than the outer face allows, the WHOLE slab is lifted out along N.

    Returns (piece, outer_centre): the second is the outer face's centre
    after any lift, for the panel, bolts and eyes that sit on it."""
    U, V, N = Vector(U).normalized(), Vector(V).normalized(), Vector(N).normalized()
    c0 = Vector(centre)
    hu, hv = length / 2.0, height / 2.0

    def umax(v):
        return hu - setback * (v + hv) / height

    vs = [-hv + height * j / (nv - 1) for j in range(nv)]
    uv = {}
    for j, v in enumerate(vs):
        for i in range(nu):
            uv[i, j] = (-hu + (umax(v) + hu) * i / (nu - 1), v)
    # each back vertex takes the SHALLOWEST surface within half a cell of it
    # (5 x 5 rays), so a bump between grid points cannot pierce the back
    du = (2 * hu) / (nu - 1)
    dv = height / (nv - 1)
    raw = {}
    for k, (u, v) in uv.items():
        best = None
        for a in (-0.5, -0.25, 0.0, 0.25, 0.5):
            for b in (-0.5, -0.25, 0.0, 0.25, 0.5):
                uu = min(max(u + a * du, -hu), umax(min(max(v + b * dv, -hv), hv)))
                vv = min(max(v + b * dv, -hv), hv)
                p = c0 + U * uu + V * vv
                hit = tree.ray_cast(p + N * reach, -N)
                if hit[0] is not None:
                    d = hit[3] - reach
                    best = d if best is None else min(best, d)
        raw[k] = best
    need = chamfer + t_min + proud
    lift = max([0.0] + [need - d for d in raw.values() if d is not None])
    depth = {}
    for k, d in raw.items():
        if d is None:
            depth[k] = thick
        else:
            depth[k] = min(max(d + lift - proud, chamfer + t_min), thick + max_fill)

    def build(lift, depth):
        c = c0 + N * lift
        verts, faces, want, kinds = [], [], [], []

        def add(p):
            verts.append(p)
            return len(verts) - 1

        def at(u, v, d):
            return c + U * u + V * v - N * d

        back = {k: add(at(uv[k][0], uv[k][1], depth[k])) for k in uv}
        sh = {}
        for k in uv:
            i, j = k
            if i in (0, nu - 1) or j in (0, nv - 1):
                sh[k] = add(at(uv[k][0], uv[k][1], chamfer))
        ci = {}
        for (i, j, su, sv) in ((0, 0, 1, 1), (nu - 1, 0, -1, 1), (nu - 1, nv - 1, -1, -1), (0, nv - 1, 1, -1)):
            u, v = uv[i, j]
            ci[i, j] = add(at(u + su * chamfer, v + sv * chamfer, 0.0))
        faces.append([ci[0, 0], ci[nu - 1, 0], ci[nu - 1, nv - 1], ci[0, nv - 1]])
        want.append(N)
        kinds.append(())
        edges = [
            ([(i, 0) for i in range(nu)], (0, 0), (nu - 1, 0), -V),
            ([(i, nv - 1) for i in range(nu)], (0, nv - 1), (nu - 1, nv - 1), V),
            ([(0, j) for j in range(nv)], (0, 0), (0, nv - 1), -U),
            ([(nu - 1, j) for j in range(nv)], (nu - 1, 0), (nu - 1, nv - 1),
             (U + V * (setback / height)).normalized()),
        ]
        for run, ka, kb, out in edges:
            faces.append([ci[ka], ci[kb]] + [sh[k] for k in reversed(run)])
            want.append((out + N).normalized())
            kinds.append(())
            for a, b in zip(run, run[1:]):
                faces.append([sh[a], sh[b], back[b], back[a]])
                want.append(out)
                kinds.append((a, b))
        for j in range(nv - 1):
            for i in range(nu - 1):
                faces.append([back[i, j], back[i + 1, j], back[i + 1, j + 1], back[i, j + 1]])
                want.append(-N)
                kinds.append(((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)))
        out_faces = []
        for f, w in zip(faces, want):
            n = _newell([verts[i] for i in f])
            out_faces.append(tuple(reversed(f)) if n.dot(w) < 0 else tuple(f))
        return c, verts, out_faces, kinds

    # The rays read the surface along -N only; an underside or a lip the
    # back's faces cross BETWEEN rays is found by testing the slab itself
    # against the surface, and the back vertices of every face that still
    # meets it step 5 mm toward the outer face (or, where a face that cannot
    # move -- the outer face, a chamfer -- meets it, the whole slab steps
    # out), until nothing meets it.
    for _it in range(60):
        c, verts, faces, kinds = build(lift, depth)
        hit = BVHTree.FromPolygons([tuple(v) for v in verts], faces).overlap(tree)
        if not hit:
            break
        bad = {i for i, _ in hit}
        keys = {k for i in bad for k in kinds[i]}
        movable = {k for k in keys if depth[k] > chamfer + t_min + 1e-9}
        if any(not kinds[i] for i in bad) or not movable:
            lift += 0.005
            for k in depth:
                depth[k] += 0.005
        else:
            for k in movable:
                depth[k] = max(depth[k] - 0.005, chamfer + t_min)
    else:
        raise ValueError(f"{name}: the slab still meets the surface after 60 steps")
    return Piece(name, verts, faces, tone), c


def conform_plate(name, size, M, tree, bolts=(), eyes=(), panel_inset=None, nu=5, nv=3, max_fill=0.04,
                  tone="paint"):
    """`armour_plate` with a conformal back: frame `M` (x, y in the plate,
    local +Z its outer normal, the plate's centre at the origin)."""
    R = M.to_3x3()
    U, V, N = R @ Vector((1, 0, 0)), R @ Vector((0, 1, 0)), R @ Vector((0, 0, 1))
    slab, oc = conform_slab(name, M.translation + N * (size[2] / 2), U, V, N, size[0], size[1], size[2], tree,
                            nu=nu, nv=nv, max_fill=max_fill, tone=tone)
    out = [slab]
    Mo = Matrix.Translation(oc) @ R.to_4x4()
    top = 0.0
    if panel_inset is not None:
        out.append(plain_box(f"{name}_panel", (size[0] - 2 * panel_inset, size[1] - 2 * panel_inset, 0.012),
                             Mo @ place((0, 0, 0.006)), tone=tone, drop=((0, 0, -1),)))
        top = 0.012
    for i, (u, v) in enumerate(bolts):
        out.append(hex_bolt(f"{name}_b{i}", Mo @ Vector((u * size[0], v * size[1], top)), N))
    for i, (u, v) in enumerate(eyes):
        out.append(lifting_eye(f"{name}_e{i}", Mo @ Vector((u * size[0], v * size[1], top)), N, U))
    return out


def conform_module(name, size, M, side, tree, setback=0.0, plate=None, plate_at=(0.0, 0.0), bolts=(),
                   eye_u=None, nu=5, nv=3, max_fill=0.04, plate_chamfer=0.006, tone="paint"):
    """`wedge_module` / `era_brick` with a conformal back: frame `M` (x long,
    y thick, z high; outer face local `side` * +Y). `plate` (w, t, h): a face
    plate on the outer face at `plate_at` (u, w); `bolts` [(u, w)] in metres
    on the face (through the plate where there is one); `eye_u` a lifting eye
    on top."""
    s = side
    R = M.to_3x3()
    U, V, N = R @ Vector((1, 0, 0)), R @ Vector((0, 0, 1)), (R @ Vector((0, s, 0))).normalized()
    slab, oc = conform_slab(f"{name}_body", M.translation + N * (size[1] / 2), U, V, N, size[0], size[2], size[1],
                            tree, nu=nu, nv=nv, setback=setback, max_fill=max_fill, tone=tone)
    out = [slab]
    t = 0.0
    if plate is not None:
        pc = oc + U * plate_at[0] + V * plate_at[1] + N * (plate[1] / 2)
        if plate_chamfer > 0:
            out.append(chamfered_box(f"{name}_plate", (plate[0], plate[2], plate[1]), _uvn_frame(pc, U, V, N),
                                     tone=tone, chamfer=plate_chamfer, drop=((0, 0, -1),)))
        else:
            out.append(plain_box(f"{name}_plate", (plate[0], plate[2], plate[1]), _uvn_frame(pc, U, V, N),
                                 tone=tone, drop=((0, 0, -1),)))
        t = plate[1]
    for i, (u, w) in enumerate(bolts):
        out.append(hex_bolt(f"{name}_bolt{i}", oc + U * u + V * w + N * t, N))
    if eye_u is not None:
        topc = oc + V * (size[2] / 2) - N * (size[1] / 2)
        out.append(lifting_eye(f"{name}_eye", topc + U * eye_u, V, U))
    return out


def _uvn_frame(c, U, V, N):
    """Local -> world with local X along U, Y along V, Z along N (a plate
    frame: x, y in the face, +z out). U, V, N must be orthonormal; a
    left-handed set is made right-handed by flipping V."""
    U, V, N = Vector(U).normalized(), Vector(V).normalized(), Vector(N).normalized()
    if U.cross(V).dot(N) < 0:
        V = -V
    m = Matrix((U, V, N)).transposed().to_4x4()
    m.translation = Vector(c)
    return m


def arc_wall(name, centre, r_in, r_out, z0, z1, a0, a1, segs=12, tone="metal"):
    """A curved wall standing on the vertical axis through `centre` (x, y):
    the ring between `r_in` and `r_out`, from z0 to z1, swept from angle a0
    to a1 (degrees, 0 along +X, counter-clockwise), closed at both ends -- a
    housing round a turret with an opening where its gun comes out."""
    cx, cy = centre
    verts = []
    for k in range(segs + 1):
        a = math.radians(a0 + (a1 - a0) * k / segs)
        ca, sa = math.cos(a), math.sin(a)
        for r in (r_in, r_out):
            for z in (z0, z1):
                verts.append(Vector((cx + r * ca, cy + r * sa, z)))
    # per station k: 4 verts: (in, z0), (in, z1), (out, z0), (out, z1)
    faces, want = [], []
    for k in range(segs):
        i0, i1 = 4 * k, 4 * (k + 1)
        am = math.radians(a0 + (a1 - a0) * (k + 0.5) / segs)
        radial = Vector((math.cos(am), math.sin(am), 0.0))
        faces += [(i0 + 2, i1 + 2, i1 + 3, i0 + 3),      # outer
                  (i0 + 0, i0 + 1, i1 + 1, i1 + 0),      # inner
                  (i0 + 1, i0 + 3, i1 + 3, i1 + 1),      # top
                  (i0 + 0, i1 + 0, i1 + 2, i0 + 2)]      # bottom
        want += [radial, -radial, Vector((0, 0, 1)), Vector((0, 0, -1))]
    last = 4 * segs
    for i, ang in ((0, a0), (last, a1)):
        t = Vector((-math.sin(math.radians(ang)), math.cos(math.radians(ang)), 0.0))
        faces.append((i + 0, i + 2, i + 3, i + 1))
        want.append(-t if i == 0 else t)
    out = []
    for f, w in zip(faces, want):
        n = _newell([verts[i] for i in f])
        out.append(tuple(reversed(f)) if n.dot(w) < 0 else f)
    return [Piece(name, verts, out, tone, smooth=True)]
