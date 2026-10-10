"""The kit's clash refusal -- GH-238 plan 3, called by `export_vehicle_kit.py`.

Spec section 2.1: "parts of different tracks never share space, so every one
of the 64 tier combinations a vehicle can hold is a valid model". Tiers are
cumulative, so tier 1 and tier 3 of ONE track are drawn together as well. This
module turns that sentence into triangle-intersection tests (mathutils BVH
`overlap`, which reports every pair of intersecting triangles) plus a
containment test, and the exporter refuses a vehicle with any un-exempted hit.

Five checks, over the kit NODES (one per (track, tier, host)) the exporter is
about to write and the shipped vehicle's live nodes:

  (a) kit x kit, same side, at rest: every pair of nodes of different
      (track, tier). STRICT -- any intersecting triangle pair.
  (b) turret kit x hull, swept: every node hosted under a rotating pivot
      (`turret_pivot`) against every hull-side kit node (STRICT) and every
      hull-side shipped node (TOLERANT, BASELINED), the pivot turned through
      SWEEP_STEPS headings (every 5 degrees).
  (c) hull kit x turret, swept: every hull-side kit node against the shipped
      nodes under the pivot (TOLERANT, BASELINED), same headings. On the
      Peten the pivot is the rotor's: a part the blades pass through fails.
  (d) kit x shipped, same side, at rest: every node against its own host and
      every other shipped node on its side (TOLERANT).
  (e) CONTAINMENT, which no triangle test can see: a kit piece that crosses
      no surface at all because it sits wholly INSIDE a shipped body or
      wholly inside another (track, tier)'s closed part. Every connected
      piece of every kit node is tested by point-in-solid at up to
      `CONTAIN_SAMPLES` of its vertices, all of which must be inside (a
      piece only partly inside crosses a surface, and (a)-(d) own that),
      against the TOLERANT shipped shells (same side at rest; the far side
      at every swept heading, less the seat below) and against every CLOSED
      piece of a kit node of a different (track, tier) (same side at rest;
      the far side swept). Strict against kit, tolerant against shipped.

TOLERANT is how "a part may sit on or touch its mounting surface" is made
exact. The shipped node is SHRUNK by TOUCH (1 cm) and the kit node tested
against the shrunk copy: a plate seated 4 mm proud, a bolt sunk 2 mm, a
bracket welded 6 mm into its face all stay outside the shrunk surface and
pass; anything more than 1 cm into the shipped body reaches it and fails.
The shrink moves every vertex (welded by position, so a UV seam does not
tear the shell) inward by TOUCH / min(n_v . n_f) over its faces, capped at
3x, so every face plane moves in by TOUCH, corners included (Blender's "even
thickness") -- and never past half the shell's own thickness under it (a ray
from the vertex, inward): a feature thinner than 2 x TOUCH collapses to its
own middle and stops there, so a part passing THROUGH it still meets the
collapsed sheet, and a part merely resting on it does not meet a copy that
came out through the far face. (Uncapped, the jeep's 2 cm cowl lip came out
through its own top and "met" the windscreen frame standing on it.)

Which side of a scan's face is "in" cannot be read off its winding (the
Lavi's glacis carries patches wound into the hull, and `recalc_face_normals`
cannot repair an open shell), so every face is decided by an ESCAPE VOTE
(`escape_side`): nine rays into each half-space (the normal and a ring of
eight at 45 degrees round it), and the side from which at least
ESCAPE_MARGIN more rays leave the node without meeting it again is "out".
Short of that margin the winding stands: a sheet open to the air on both
sides (a fender, a skirt's lip) escapes from both, and a one-ray difference
there is noise, not an inside -- the Shachaf's fenders read 5 against 6 and
6 against 7, and a 1-ray vote put them inside out. One ray along the normal
alone was fooled by a skirt's inner face, which sees open air through its
own thin lip. There is ONE shrunk copy, every face moved inward by that
decision.

What that guarantees, and what it does not. A face moved the wrong way can
HIDE a clash, not only invent one: it stands 1 cm proud instead of 1 cm
deep, and a thin plate sunk 1.5 cm and proud 0.5 cm meets a correct copy
but never the proud one. (This module used to shrink each node twice, by
the winding and by one escape ray, and count a pair only where the kit met
BOTH copies, on the belief that a wrong-way face could only invent a clash
-- so it hid exactly that plate wherever the two disagreed.) The guarantee
is per face: a penetration deeper than TOUCH into any face whose inside was
decided correctly (by the vote, or by the winding where the vote is short
of its margin) is caught, and so is a part passing through a feature
thinner than 2 x TOUCH. The exposure is the faces decided wrongly, and every
run prints, per shipped node, how many faces the vote put AGAINST their
winding and how many only the winding could settle. Read those before
trusting a pass near such faces. What the old pair-level AND hid, this
catches: a 12 cm plate sunk 1.5 cm into a Lavi glacis patch wound into the
hull, 0.5 cm proud, passed the old module and is refused by this one.

Containment (e) reads the same per-face vote, so the two can never disagree
about which side is solid: a point is inside a shipped shell when most of
`CONTAIN_DIRS`' rays first meet a face from behind (the vote's outward
normal pointing along the ray) -- ray parity, made robust for an open scan
by asking each ray only which side of its first face it started on. A
point is inside a closed kit piece by plain ray parity over `PARITY_DIRS`
(generated geometry, closed, so parity is exact bar a grazing ray, hence
the majority). An OPEN kit piece (a sleeve, a chute, a bar whose ends are
welded in) is never a container: it encloses no solid.

`mount`, `ground` and `weld` pieces (brackets, straps, risers, pedestal
feet, feed chutes: the hardware that exists to reach into the vehicle,
`kit_parts`) may weld into, or sit inside, a steel node (`*_hull`,
`*_metal`, `*_plate`) in (d) and (e); they are held to (d) and (e) against
a tyre, a track or a window (`*_rubber`, `*_glass`), and to (a), (b) and (c)
in full -- which is where the Lavi's S2 arms, long mount bars crossing the
turret roof, were caught (into the F2 riser, the F3 skids, the S3 pedestal).

BASELINED is the shipped vehicle's own contact. These are scan-derived
meshes: the Lavi's `hull_hull` carries a ghost of the turret's footprint up
to z 1.83 that the real turret cuts through at all 72 headings, and every
RWS base sits in the roof it stands on. That is not the kit's to fix. So,
per shipped node on the far side of a pivot, the (triangle, heading) pairs
the SHIPPED nodes on the near side (as shipped) cut in the far side (shrunk)
form its seat set, printed with its count; a kit triangle pair is the
seat's only when the shipped vehicle cuts that triangle AT THAT SAME
HEADING. (It used to be any triangle the shipped vehicle cut at ANY heading,
which excused a part sweeping through a hull feature at 120 degrees because
the turret clipped the same triangle at 5.) A kit pair on a triangle the
shipped vehicle cuts only at OTHER headings is still a refusal, reported
with that said; only a named exemption scoped "seat" (below) may excuse it.
For (e) the swept seat is the piece's own side: a piece inside its OWN
side's shipped body (grown by TOUCH) is judged at rest, by (e) against that
body, and never against the far side. Kit x kit is never baselined.

Exemptions are a named list (`kit_vehicles.CLASH_EXEMPTIONS`), each with its
reason and, where it applies, the headings, printed on every run like
DEVIATIONS; scoped "seat", one excuses only pairs whose shipped triangle the
shipped vehicle itself cuts at another heading (the Lavi's turret ghost, the
Shachaf's whip antenna in its own station's sweep), never anything else of
that node. An exemption that no longer excuses anything is itself a
refusal, and so is a listed heading that excuses nothing: an exemption can
neither rot nor be wider than what it excuses.
"""
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

#: Penetration into a SHIPPED node that is still "sitting on it" (metres).
TOUCH = 0.01
#: Headings of the pivot sweep: 72, every 5 degrees.
SWEEP_STEPS = 72
#: The nodes a vehicle turns (spec: turrets; the Peten's rotor spins).
PIVOTS = ("turret_pivot", "rotor_pivot")
#: The shipped nodes `mount`/`ground` hardware may be welded into in (d) and
#: (e): steel (`*_hull`, `*_metal`, `*_plate`). A bracket through a tyre, a
#: track or a window (`*_rubber`, `*_glass`) is a clash like any other.
MOUNT_INTO = ("_hull", "_metal", "_plate")
#: The escape vote: rays into each half-space of a face, the normal and a
#: ring of ESCAPE_RING at ESCAPE_TILT_DEG from it.
ESCAPE_RING = 8
ESCAPE_TILT_DEG = 45.0
#: The vote decides a face only when one side lets at least this many more
#: of its nine rays escape than the other; otherwise the winding stands.
ESCAPE_MARGIN = 3
#: Containment: vertices sampled per connected piece (all must be inside),
#: and the fixed ray fan a point is tested along (6 axes, 8 diagonals).
CONTAIN_SAMPLES = 4
CONTAIN_DIRS = tuple(Vector(d).normalized() for d in (
    (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
    (1, 1, 1), (1, 1, -1), (1, -1, 1), (1, -1, -1),
    (-1, 1, 1), (-1, 1, -1), (-1, -1, 1), (-1, -1, -1)))
#: Ray parity in a closed kit piece: skewed directions (none axis-aligned,
#: so a ray seldom runs along a box's edge or face).
PARITY_DIRS = tuple(Vector(d).normalized() for d in (
    (0.31, 0.52, 0.79), (-0.67, 0.23, 0.70), (0.13, -0.88, 0.45),
    (0.58, 0.41, -0.70), (-0.36, -0.61, -0.71)))


def log(msg):
    print(f"[kit] {msg}", flush=True)


class Geo:
    """World-space vertices (N, 3) and polygons, plus a label per polygon
    (the kit piece it came from, or the node name for a shipped node)."""

    def __init__(self, name, verts, polys, labels):
        self.name = name
        self.verts = np.asarray(verts, dtype=np.float64).reshape(-1, 3)
        self.polys = [tuple(p) for p in polys]
        self.labels = labels

    def tree(self, M=None):
        v = self.verts if M is None else self.verts @ M[:3, :3].T + M[:3, 3]
        return BVHTree.FromPolygons([tuple(x) for x in v], self.polys, all_triangles=False)


def kit_geo(name, pieces, body_only=False):
    """`body_only`: leave out `mount`, `ground` and `weld` pieces (check (d))."""
    verts, polys, labels = [], [], []
    for p in pieces:
        if body_only and (p.mount or p.ground or p.weld):
            continue
        off = len(verts)
        verts += [tuple(v) for v in p.verts]
        for f in p.faces:
            polys.append(tuple(i + off for i in f))
            labels.append(p.name)
    return Geo(name, verts, polys, labels)


def _ring(n):
    """The escape vote's directions round unit vector `n`."""
    u = n.orthogonal().normalized()
    v = n.cross(u).normalized()
    t = math.radians(ESCAPE_TILT_DEG)
    out = [n.copy()]
    for k in range(ESCAPE_RING):
        a = 2.0 * math.pi * k / ESCAPE_RING
        out.append((n * math.cos(t) + (u * math.cos(a) + v * math.sin(a)) * math.sin(t)).normalized())
    return out


def escape_side(tree, c, n):
    """(+1 if the face at `c` with winding normal `n` has its outside along
    +n, else -1; "vote" if the escape vote settled it, "winding" if not).
    The vote settles it only by a margin of ESCAPE_MARGIN rays: a sheet open
    to the air on both sides (a fender, a skirt's lip) escapes from both, and
    a one-ray difference there is noise, not an inside."""
    esc = {}
    for s in (1.0, -1.0):
        esc[s] = sum(1 for d in _ring(n * s) if tree.ray_cast(c + n * (s * 1e-4), d)[0] is None)
    if abs(esc[1.0] - esc[-1.0]) >= ESCAPE_MARGIN:
        return (1 if esc[1.0] > esc[-1.0] else -1), "vote"
    return 1, "winding"


class Shell:
    """A shipped node's world-space shell. With `shrink` > 0 every face is
    moved inward by that much (< 0: outward, the seat's grown body), its inside decided by `escape_side`, and
    `out_n[j]` keeps polygon j's outward normal by that vote (containment
    reads it). `against` / `by_winding` count the faces the vote put against
    their winding and those only the winding could settle."""

    def __init__(self, o, shrink=0.0):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        self.out_n = None
        self.against = self.by_winding = 0
        if shrink != 0:
            # weld by position so a UV seam does not split the shell into two
            # sheets that would each shrink along their own half of the normal
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            bm.normal_update()
            bm.faces.index_update()
            bm.faces.ensure_lookup_table()
            tree = BVHTree.FromBMesh(bm)
            out_n = []
            for f in bm.faces:
                n = f.normal.copy()
                if n.length < 1e-9:
                    out_n.append(Vector())
                    continue
                side, how = escape_side(tree, f.calc_center_median(), n)
                self.against += side < 0
                self.by_winding += how == "winding"
                out_n.append(n if side > 0 else -n)
            moves = []
            for v in bm.verts:
                ns = [out_n[f.index] for f in v.link_faces if out_n[f.index].length > 0]
                if not ns:
                    moves.append(Vector())
                    continue
                m = sum(ns, Vector())
                if m.length < 1e-9:
                    moves.append(Vector())
                    continue
                m.normalize()
                c = min(max(m.dot(k), 1e-6) for k in ns)
                step = shrink / max(c, 1.0 / 3.0)
                # a feature thinner than twice the step collapses to its own
                # middle and stops there: past it, the copy would come out
                # through the far face and meet a part merely resting on it
                d = -m if step > 0 else m
                h = tree.ray_cast(v.co + d * 1e-5, d)
                if h[0] is not None and h[3] < 2.0 * abs(step):
                    step = math.copysign(h[3] / 2.0, step)
                moves.append(-m * step)
            for v, m in zip(bm.verts, moves):
                v.co += m
            self.out_n = out_n
        bm.verts.index_update()
        verts = [tuple(v.co) for v in bm.verts]
        polys = [tuple(v.index for v in f.verts) for f in bm.faces]
        bm.free()
        self.name = o.name
        self.geo = Geo(o.name, verts, polys, [o.name] * len(polys))
        self._t = None

    def tree(self, M=None):
        if M is None:
            if self._t is None:
                self._t = self.geo.tree()
            return self._t
        return self.geo.tree(M)

    def contains(self, p):
        """`p` (world, this shell at rest) is inside: more than half of
        CONTAIN_DIRS first meet a face from behind by the escape vote's own
        normal. A ray that meets nothing votes "outside", which leans every
        doubt toward outside -- the right way for both readers: (e) refuses
        on "inside", and the seat excuses on it."""
        tree = self.tree()
        inside = 0
        for d in CONTAIN_DIRS:
            h = tree.ray_cast(p, d)
            if h[0] is not None and self.out_n[h[2]].dot(d) > 0:
                inside += 1
        return 2 * inside > len(CONTAIN_DIRS)


# ---------------------------------------------------------------------------
# containment helpers
# ---------------------------------------------------------------------------

def components(piece):
    """[(vertex indices, face indices)] of a Piece's connected shells."""
    parent = list(range(len(piece.verts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for f in piece.faces:
        r = find(f[0])
        for i in f[1:]:
            q = find(i)
            if q != r:
                parent[q] = r
    groups = {}
    for fi, f in enumerate(piece.faces):
        g = groups.setdefault(find(f[0]), (set(), []))
        g[0].update(f)
        g[1].append(fi)
    return [(sorted(v), fs) for v, fs in groups.values()]


def samples(piece, vids):
    """Up to CONTAIN_SAMPLES of a component's vertices, spread over it: the
    first, then repeatedly the one farthest from those already taken."""
    pts = [piece.verts[i] for i in vids]
    out = [pts[0]]
    while len(out) < min(CONTAIN_SAMPLES, len(pts)):
        far = max(pts, key=lambda p: min((p - q).length for q in out))
        if min((far - q).length for q in out) < 1e-6:
            break
        out.append(far)
    return [p.copy() for p in out]


def closed(piece, fids):
    """Every edge of the component used by exactly two of its faces."""
    count = {}
    for fi in fids:
        f = piece.faces[fi]
        for a, b in zip(f, f[1:] + f[:1]):
            k = (a, b) if a < b else (b, a)
            count[k] = count.get(k, 0) + 1
    return bool(count) and all(c == 2 for c in count.values())


class Solid:
    """One CLOSED connected piece of a kit node, for parity containment."""

    def __init__(self, piece, fids):
        self.name = piece.name
        used = sorted({i for fi in fids for i in piece.faces[fi]})
        remap = {i: k for k, i in enumerate(used)}
        self.tree = BVHTree.FromPolygons([tuple(piece.verts[i]) for i in used],
                                         [tuple(remap[i] for i in piece.faces[fi]) for fi in fids],
                                         all_triangles=False)

    def contains(self, p):
        inside = 0
        for d in PARITY_DIRS:
            q, n = p.copy(), 0
            for _ in range(256):
                h = self.tree.ray_cast(q, d)
                if h[0] is None:
                    break
                n += 1
                q = h[0] + d * 1e-6
            inside += n % 2
        return 2 * inside > len(PARITY_DIRS)


def _apply(M, p):
    return Vector((M @ np.array((p[0], p[1], p[2], 1.0)))[:3])


def _under(o, pivot):
    p = o.parent
    while p is not None:
        if p == pivot:
            return True
        p = p.parent
    return False


def _rot(pivot, deg):
    """4x4 numpy: rotate world space about the pivot's own up axis."""
    mw = pivot.matrix_world
    axis = (mw.to_3x3() @ Vector((0.0, 0.0, 1.0))).normalized()
    c = mw.translation
    M = Matrix.Translation(c) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-c)
    return np.array(M)


def _span(geo, idx, M=None):
    v = geo.verts if M is None else geo.verts @ M[:3, :3].T + M[:3, 3]
    pts = np.array([v[i] for k in idx for i in geo.polys[k]])
    return (tuple(round(float(x), 3) for x in pts.min(axis=0)), tuple(round(float(x), 3) for x in pts.max(axis=0)))


def _box(pts):
    a = np.array([tuple(p) for p in pts])
    return (tuple(round(float(x), 3) for x in a.min(axis=0)), tuple(round(float(x), 3) for x in a.max(axis=0)))


class Finding:
    def __init__(self, check, a, b, scope=""):
        self.check, self.a, self.b = check, a, b
        self.scope = scope          # "seat": every shipped triangle in it is one the
                                    # shipped vehicle itself cuts at another heading
        self.headings = []          # degrees with an un-excused hit
        self.pairs = 0              # max triangle pairs (or pieces) at one heading
        self.pieces = set()         # kit pieces on side a involved
        self.other = set()          # pieces (or node) on side b
        self.span = None            # kit-side world box at the first hit
        self.ospan = None           # the other side's world box at the first hit

    def add(self, deg, ov, ga, gb, Ma=None, Mb=None):
        self.headings.append(deg)
        self.pairs = max(self.pairs, len(ov))
        self.pieces |= {ga.labels[i] for i, _ in ov}
        self.other |= {gb.labels[j] for _, j in ov}
        if self.span is None:
            self.span = _span(ga, sorted({i for i, _ in ov}), Ma)
            self.ospan = _span(gb, sorted({j for _, j in ov}), Mb)

    def add_contained(self, deg, ins, container):
        """(e): `ins` [(piece, its sample points at this heading)] wholly
        inside `container`."""
        self.headings.append(deg)
        self.pairs = max(self.pairs, len(ins))
        self.pieces |= {p.name for p, _ in ins}
        self.other.add(container)
        if self.span is None:
            self.span = _box([q for _, pts in ins for q in pts])

    def line(self):
        hd = ("at rest" if self.headings == [0] and self.check in ("a", "d", "e")
              else f"{len(self.headings)}/{SWEEP_STEPS} headings {self.headings[:6]}{'...' if len(self.headings) > 6 else ''}")
        pa = ",".join(sorted(self.pieces)[:6]) + ("..." if len(self.pieces) > 6 else "")
        pb = ",".join(sorted(self.other)[:6]) + ("..." if len(self.other) > 6 else "")
        what = "pieces wholly inside" if self.check == "e" else "tri pairs"
        sc = (" [every shipped triangle one the shipped vehicle itself cuts at another heading]"
              if self.scope == "seat" else "")
        return (f"CLASH ({self.check}) {self.a} x {self.b}: {hd}, max {self.pairs} {what}; "
                f"pieces [{pa}] x [{pb}]; kit span {self.span} other {self.ospan}{sc}")


def check(vid, live, built, exemptions=None):
    """Run (a)-(e); return (refusals, summary dict). `built` is
    {(track, tier, host): [Piece]} in world space, `live` the shipped
    mesh objects (wreck, clips and old kit already gone)."""
    import bpy
    exemptions = exemptions or {}
    hosts = {o.name: o for o in live}
    pivot = next((bpy.data.objects.get(n) for n in PIVOTS if bpy.data.objects.get(n) is not None), None)

    def side_of_live(o):
        return "turret" if pivot is not None and _under(o, pivot) else "hull"

    kit = {}
    body = {}
    kside = {}
    khost = {}
    subjects = {}       # kit node -> [(piece, sample points)], one per connected piece
    solids = {}         # kit node -> [Solid], its CLOSED connected pieces
    for (track, tier, host), pieces in built.items():
        name = f"kit_{track}_{tier}_{host}"
        kit[name] = kit_geo(name, pieces)
        body[name] = kit_geo(name, pieces, body_only=True)
        kside[name] = side_of_live(hosts[host])
        khost[name] = host
        subjects[name], solids[name] = [], []
        for p in pieces:
            for vids, fids in components(p):
                subjects[name].append((p, samples(p, vids)))
                if closed(p, fids):
                    solids[name].append(Solid(p, fids))
    tt = {name: tuple(name.split("_")[1:3]) for name in kit}          # track, tier
    lside = {o.name: side_of_live(o) for o in live}
    shell = {o.name: Shell(o, TOUCH) for o in live}
    for n, s in sorted(shell.items()):
        log(f"  CLASH shell {n}: {len(s.geo.polys)} faces shrunk {TOUCH * 100:.0f} cm by the escape vote; "
            f"{s.against} against their winding, {s.by_winding} settled only by the winding")
    T_shell = {n: s.tree() for n, s in shell.items()}
    T_kit = {n: g.tree() for n, g in kit.items()}
    # (e)'s seat: each shipped node GROWN by TOUCH (the same vote, outward)
    grown = {o.name: Shell(o, -TOUCH) for o in live}

    def in_body(names_, p):
        """`p` (that side's rest frame) inside one of `names_`' shipped
        bodies, or within TOUCH of its surface."""
        return any(grown[n].contains(p) for n in names_)

    findings = {}

    def hit(chk, a, b, deg, ov, ga, gb, Ma=None, Mb=None, scope=""):
        f = findings.setdefault((chk, a, b, scope), Finding(chk, a, b, scope))
        f.add(deg, ov, ga, gb, Ma, Mb)

    def hit_far(chk, a, b, deg, ov, ga, gb, Ma, Mb, seat_b):
        """A swept kit x shipped hit, its pairs outside the (triangle,
        heading) seat already; split by whether each shipped triangle is one
        the shipped vehicle cuts at ANOTHER heading -- the only kind a
        "seat"-scoped exemption may excuse."""
        cut = {j for j, _ in seat_b}
        on = [(i, j) for i, j in ov if j in cut]
        off = [(i, j) for i, j in ov if j not in cut]
        if on:
            hit(chk, a, b, deg, on, ga, gb, Ma, Mb, scope="seat")
        if off:
            hit(chk, a, b, deg, off, ga, gb, Ma, Mb)

    def may_sit_in(piece, live_name):
        return (piece.mount or piece.ground or piece.weld) and live_name.endswith(MOUNT_INTO)

    def in_shell(a, subj, sname, deg):
        ins = [(p, pts) for p, pts in subj
               if not may_sit_in(p, sname) and all(shell[sname].contains(q) for q in pts)]
        if ins:
            findings.setdefault(("e", a, sname, ""), Finding("e", a, sname)).add_contained(deg, ins, sname)

    def in_kit(a, subj, b, deg):
        ins = [(p, pts) for p, pts in subj
               if any(all(s.contains(q) for q in pts) for s in solids[b])]
        if ins:
            findings.setdefault(("e", a, b, ""), Finding("e", a, b)).add_contained(deg, ins, b)

    names = sorted(kit)
    # (a) kit x kit, same side, at rest, different (track, tier)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if tt[a] == tt[b] or kside[a] != kside[b]:
                continue
            ov = T_kit[a].overlap(T_kit[b])
            if ov:
                hit("a", a, b, 0, ov, kit[a], kit[b])
    # (d) kit x shipped, same side, at rest, 1 cm tolerance; `mount`/`ground`
    # hardware may weld into a steel node (MOUNT_INTO), never a tyre or glass
    for a in names:
        for o in live:
            if lside[o.name] != kside[a]:
                continue
            g = body[a] if o.name.endswith(MOUNT_INTO) else kit[a]
            if not g.polys:
                continue
            ov = g.tree().overlap(T_shell[o.name])
            if ov:
                hit("d", a, o.name, 0, ov, g, shell[o.name].geo)
    # (e) at rest, same side: inside a shipped shell, or inside a closed piece
    # of another (track, tier)
    for a in names:
        for o in live:
            if lside[o.name] == kside[a]:
                in_shell(a, subjects[a], o.name, 0)
        for b in names:
            if b != a and tt[a] != tt[b] and kside[a] == kside[b] and solids[b]:
                in_kit(a, subjects[a], b, 0)

    if pivot is not None:
        tur_live = [o.name for o in live if lside[o.name] == "turret"]
        hul_live = [o.name for o in live if lside[o.name] == "hull"]
        tur_kit = [n for n in names if kside[n] == "turret"]
        hul_kit = [n for n in names if kside[n] == "hull"]
        # (e)'s seat is heading-free: a piece inside its OWN side's shipped
        # body (grown by TOUCH) is at-rest (e)'s to judge, never the far side's
        sub_far = {a: [(p, pts) for p, pts in subjects[a]
                       if not all(in_body(tur_live if kside[a] == "turret" else hul_live, q) for q in pts)]
                   for a in names}
        n_seat_e = sum(len(subjects[a]) - len(sub_far[a]) for a in names)

        # the seat, per (triangle, heading): the shipped near side, as
        # shipped, into the far side shrunk, both ways, at each heading
        plain = {n: Shell(hosts[n]).geo for n in tur_live + hul_live}
        T_plain_hull = {n: plain[n].tree() for n in hul_live}
        seat = {n: set() for n in tur_live + hul_live}
        rows = []
        for k in range(SWEEP_STEPS):
            deg = k * 360.0 / SWEEP_STEPS
            M = _rot(pivot, deg)
            Tt_shr = {n: shell[n].tree(M) for n in tur_live}
            for t in tur_live:
                Tt_pl = plain[t].tree(M)
                for h in hul_live:
                    seat[h] |= {(j, deg) for _, j in Tt_pl.overlap(T_shell[h])}
                    seat[t] |= {(j, deg) for _, j in T_plain_hull[h].overlap(Tt_shr[t])}
            rows.append((deg, M, Tt_shr))
        for n in tur_live + hul_live:
            log(f"  CLASH seat {n}: {len(seat[n])} (triangle, heading) pairs -- "
                f"{len({j for j, _ in seat[n]})} triangles, {len({d for _, d in seat[n]})} headings -- "
                f"the shipped {'hull' if n in tur_live else 'turret'} already cuts in the sweep (baseline)")
        log(f"  CLASH seat (e): {n_seat_e} kit piece(s) inside their own side's shipped body, judged at "
            f"rest only (baseline for the sweep)")
        for deg, M, Tt_shr in rows:
            Minv = np.linalg.inv(M)
            Tt_kit = {n: kit[n].tree(M) for n in tur_kit}
            # (b) turret kit x hull kit (strict) and x hull shipped (tolerant, baselined)
            for a in tur_kit:
                for b in hul_kit:
                    ov = Tt_kit[a].overlap(T_kit[b])
                    if ov:
                        hit("b", a, b, deg, ov, kit[a], kit[b], M)
                for h in hul_live:
                    ov = [(i, j) for i, j in Tt_kit[a].overlap(T_shell[h]) if (j, deg) not in seat[h]]
                    if ov:
                        hit_far("b", a, h, deg, ov, kit[a], shell[h].geo, M, None, seat[h])
            # (c) hull kit x turret shipped (tolerant, baselined)
            for a in hul_kit:
                for t in tur_live:
                    ov = [(i, j) for i, j in T_kit[a].overlap(Tt_shr[t]) if (j, deg) not in seat[t]]
                    if ov:
                        hit_far("c", a, t, deg, ov, kit[a], shell[t].geo, None, M, seat[t])
            # (e) swept: the turret's kit (turned) inside a hull shell or a
            # closed hull kit piece; the hull's kit inside the turned turret
            # (tested as the hull point turned back into the turret's rest pose)
            for a in tur_kit:
                moved = [(p, [_apply(M, q) for q in pts]) for p, pts in sub_far[a]]
                for h in hul_live:
                    in_shell(a, moved, h, deg)
                moved = [(p, [_apply(M, q) for q in pts]) for p, pts in subjects[a]]
                for b in hul_kit:
                    if solids[b]:
                        in_kit(a, moved, b, deg)
            for a in hul_kit:
                moved = [(p, [_apply(Minv, q) for q in pts]) for p, pts in sub_far[a]]
                for t in tur_live:
                    in_shell(a, moved, t, deg)
                moved = [(p, [_apply(Minv, q) for q in pts]) for p, pts in subjects[a]]
                for b in tur_kit:
                    if solids[b]:
                        in_kit(a, moved, b, deg)

    def spec_of(spec):
        """(reason, headings or None, scope or None) from an exemption entry:
        a reason, (reason, headings), or (reason, headings, "seat")."""
        if isinstance(spec, str):
            return spec, None, None
        return (tuple(spec) + (None,))[:3]

    refusals = []
    used = {}
    for key in sorted(findings):
        f = findings[key]
        why = None
        for (ea, eb, prefix), spec in exemptions.items():
            reason, at, scope = spec_of(spec)
            if (ea == f.a and eb == f.b and all(p.startswith(prefix) for p in f.pieces)
                    and (scope is None or scope == f.scope)
                    and (at is None or set(f.headings) <= set(at))):
                why = reason
                used.setdefault((ea, eb, prefix), set()).update(f.headings)
        if why:
            log(f"  EXEMPT {f.line()}")
            log(f"      because: {why}")
        else:
            log(f"  {f.line()}")
            refusals.append(f"clash ({f.check}) {f.a} x {f.b}"
                            + (" (on the shipped vehicle's own sweep contact)" if f.scope == "seat" else ""))
    for key, spec in exemptions.items():
        reason, at, scope = spec_of(spec)
        log(f"  CLASH EXEMPTION {key[0]} x {key[1]} (pieces '{key[2]}*'"
            + (f", headings {sorted(at)}" if at is not None else "")
            + (", only on triangles the shipped vehicle cuts at another heading" if scope == "seat" else "")
            + f"): {reason}")
        if key not in used:
            refusals.append(f"clash exemption {key} excuses nothing any more: delete it")
        elif at is not None and set(at) - used[key]:
            refusals.append(f"clash exemption {key} lists heading(s) {sorted(set(at) - used[key])} "
                            f"that excuse nothing: narrow it to {sorted(used[key])}")
    n_pairs = {"a": 0, "b": 0, "c": 0, "d": 0}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if tt[a] != tt[b] and kside[a] == kside[b]:
                n_pairs["a"] += 1
    for a in names:
        n_pairs["d"] += sum(1 for o in live if lside[o.name] == kside[a])
    if pivot is not None:
        nt = sum(1 for n in names if kside[n] == "turret")
        nh = len(names) - nt
        n_pairs["b"] = nt * (nh + sum(1 for o in live if lside[o.name] == "hull"))
        n_pairs["c"] = nh * sum(1 for o in live if lside[o.name] == "turret")
    n_sub = sum(len(v) for v in subjects.values())
    n_sol = sum(len(v) for v in solids.values())
    summary = {"pairs": n_pairs, "findings": len(findings), "refused": len(refusals),
               "pivot": pivot.name if pivot is not None else None}
    log(f"CLASH {vid}: pairs tested a={n_pairs['a']} b={n_pairs['b']}x{SWEEP_STEPS if pivot else 0} "
        f"c={n_pairs['c']}x{SWEEP_STEPS if pivot else 0} d={n_pairs['d']}; e={n_sub} connected pieces "
        f"vs {len(live)} shells and {n_sol} closed kit pieces; "
        f"{len(findings)} with contact, {len(findings) - sum(1 for r in refusals if r.startswith('clash ('))} exempted, "
        f"{len(refusals)} refused (touch {TOUCH * 100:.0f} cm, pivot {summary['pivot']})")
    return refusals, summary
