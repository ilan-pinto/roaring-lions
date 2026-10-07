"""The kit's clash refusal -- GH-238 plan 3, called by `export_vehicle_kit.py`.

Spec section 2.1: "parts of different tracks never share space, so every one
of the 64 tier combinations a vehicle can hold is a valid model". Tiers are
cumulative, so tier 1 and tier 3 of ONE track are drawn together as well. This
module turns that sentence into triangle-intersection tests (mathutils BVH
`overlap`, which reports every pair of intersecting triangles) and the
exporter refuses a vehicle with any un-exempted hit.

Four checks, over the kit NODES (one per (track, tier, host)) the exporter is
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

TOLERANT is how "a part may sit on or touch its mounting surface" is made
exact. The shipped node is SHRUNK by TOUCH (1 cm) and the kit node tested
against the shrunk copy: a plate seated 4 mm proud, a bolt sunk 2 mm, a
bracket welded 6 mm into its face all stay outside the shrunk surface and
pass; anything more than 1 cm into the shipped body reaches it and fails.
The shrink moves every vertex (welded by position, so a UV seam does not
tear the shell) inward by TOUCH / min(n_v . n_f) over its faces, capped at
3x, so every face plane moves in by TOUCH, corners included (Blender's "even
thickness"). A thin shipped feature collapses toward its own middle, so a
part passing THROUGH it still meets the collapsed sheet.

Which side of a scan's face is "in" cannot be read off its winding alone
(the Lavi's glacis carries patches wound into the hull, and
`recalc_face_normals` cannot repair an open shell), nor off where a ray
escapes alone (a skirt's inner face sees the open air through its own thin
lip). A face moved the wrong way moves TOWARD the kit and can only invent a
clash, never hide one, so the hull is shrunk twice -- inward by the winding,
and inward by the escape test (the side a ray from the face's centre travels
further along before meeting the shell again) -- and a triangle pair counts
only when the kit meets BOTH shrunk copies: a real penetration deeper than
1 cm meets whichever copy is right.

`mount`, `ground` and `weld` pieces (brackets, straps, risers, pedestal
feet, feed chutes: the hardware that exists to reach into the vehicle,
`kit_parts`) may weld into a steel node (`*_hull`, `*_metal`, `*_plate`) in (d); they are held to (d) against a
tyre, a track or a window (`*_rubber`, `*_glass`), and to (a), (b) and (c)
in full -- which is where the Lavi's S2 arms, long mount bars crossing the
turret roof, were caught (into the F2 riser, the F3 skids, the S3 pedestal).

BASELINED is the shipped vehicle's own contact. These are scan-derived
meshes: the Lavi's `hull_hull` carries a ghost of the turret's footprint up
to z 1.83 that the real turret cuts through at all 72 headings (326 triangle
pairs), and every RWS base sits in the roof it stands on. That is not the
kit's to fix. So, per shipped node on the far side of a pivot, the triangles
the SHIPPED nodes on the near side intersect (shrunk, at any heading) form
its seat set, printed with its count; a kit triangle pair whose shipped
triangle is in that seat set is the seat's, not the kit's. Kit x kit is
never baselined.

Exemptions are a named list (`kit_vehicles.CLASH_EXEMPTIONS`), each with its
reason, printed on every run like DEVIATIONS; an exemption that no longer
excuses anything is itself a refusal, so the list cannot rot.
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
#: The shipped nodes `mount`/`ground` hardware may be welded into in (d):
#: steel (`*_hull`, `*_metal`, `*_plate`). A bracket through a tyre, a track
#: or a window (`*_rubber`, `*_glass`) is a clash like any other.
MOUNT_INTO = ("_hull", "_metal", "_plate")


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


def live_geo(o, shrink=0.0, mode="escape"):
    """A shipped node's world-space shell; `shrink` > 0 moves it inward,
    `mode` deciding each face's inside: "winding" (its normal) or "escape"
    (the side a ray from its centre travels further along before meeting the
    shell again). See the module docstring for why both are used."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    if shrink > 0:
        # weld by position so a UV seam does not split the shell into two
        # sheets that would each shrink along their own half of the normal
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.normal_update()
        bm.faces.ensure_lookup_table()
        tree = BVHTree.FromBMesh(bm)
        far = 1e3
        out_n = []
        for f in bm.faces:
            n = f.normal.copy()
            if n.length < 1e-9:
                out_n.append(Vector())
                continue
            if mode == "winding":
                out_n.append(n)
                continue
            c = f.calc_center_median()
            hp = tree.ray_cast(c + n * 1e-4, n)
            hm = tree.ray_cast(c - n * 1e-4, -n)
            dp = far if hp[0] is None else hp[3]
            dm = far if hm[0] is None else hm[3]
            out_n.append(n if dp >= dm else -n)
        moves = []
        for v in bm.verts:
            ns = [out_n[f.index] for f in v.link_faces if out_n[f.index].length > 0]
            if not ns:
                moves.append(Vector())
                continue
            n = sum(ns, Vector())
            if n.length < 1e-9:
                moves.append(Vector())
                continue
            n.normalize()
            c = min(max(n.dot(m), 1e-6) for m in ns)
            moves.append(-n * (shrink / max(c, 1.0 / 3.0)))
        for v, m in zip(bm.verts, moves):
            v.co += m
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    polys = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    return Geo(o.name, verts, polys, [o.name] * len(polys))


class Shrunk:
    """A shipped node shrunk both ways (winding, escape): a kit triangle pair
    counts only where it meets both."""

    def __init__(self, o, shrink):
        self.w = live_geo(o, shrink, "winding")
        self.e = live_geo(o, shrink, "escape")
        self.labels = self.e.labels
        self.verts, self.polys = self.e.verts, self.e.polys
        self._t = None

    def trees(self, M=None):
        if M is None:
            if self._t is None:
                self._t = (self.w.tree(), self.e.tree())
            return self._t
        return (self.w.tree(M), self.e.tree(M))


def overlap(tree, trees):
    """Triangle pairs of `tree` meeting BOTH shrunk copies."""
    a = tree.overlap(trees[0])
    if not a:
        return []
    b = set(tree.overlap(trees[1]))
    return [p for p in a if p in b]


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


class Finding:
    def __init__(self, check, a, b):
        self.check, self.a, self.b = check, a, b
        self.headings = []          # degrees with an un-excused hit
        self.pairs = 0              # max triangle pairs at one heading
        self.pieces = set()         # kit pieces on side a involved
        self.other = set()          # pieces (or node) on side b
        self.span = None            # kit-side triangles' world box at the first hit
        self.ospan = None           # the other side's triangles' world box at the first hit

    def add(self, deg, ov, ga, gb, Ma=None, Mb=None):
        self.headings.append(deg)
        self.pairs = max(self.pairs, len(ov))
        self.pieces |= {ga.labels[i] for i, _ in ov}
        self.other |= {gb.labels[j] for _, j in ov}
        if self.span is None:
            self.span = _span(ga, sorted({i for i, _ in ov}), Ma)
            self.ospan = _span(gb, sorted({j for _, j in ov}), Mb)

    def line(self):
        hd = ("at rest" if self.headings == [0] and self.check in ("a", "d")
              else f"{len(self.headings)}/{SWEEP_STEPS} headings {self.headings[:6]}{'...' if len(self.headings) > 6 else ''}")
        pa = ",".join(sorted(self.pieces)[:6]) + ("..." if len(self.pieces) > 6 else "")
        pb = ",".join(sorted(self.other)[:6]) + ("..." if len(self.other) > 6 else "")
        dp = ""
        return (f"CLASH ({self.check}) {self.a} x {self.b}: {hd}, max {self.pairs} tri pairs; "
                f"pieces [{pa}] x [{pb}]; kit span {self.span} other {self.ospan}{dp}")


def check(vid, live, built, exemptions=None):
    """Run (a)-(d); return (refusals, summary dict). `built` is
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
    for (track, tier, host), pieces in built.items():
        name = f"kit_{track}_{tier}_{host}"
        kit[name] = kit_geo(name, pieces)
        body[name] = kit_geo(name, pieces, body_only=True)
        kside[name] = side_of_live(hosts[host])
    tt = {name: name.split("_")[1:3] for name in kit}          # track, tier
    lside = {o.name: side_of_live(o) for o in live}
    shrunk = {o.name: Shrunk(o, TOUCH) for o in live}
    plain = {o.name: live_geo(o) for o in live}
    T_shrunk = {n: g.trees() for n, g in shrunk.items()}
    T_kit = {n: g.tree() for n, g in kit.items()}

    findings = {}

    def hit(chk, a, b, deg, ov, ga, gb, Ma=None, Mb=None):
        f = findings.setdefault((chk, a, b), Finding(chk, a, b))
        f.add(deg, ov, ga, gb, Ma, Mb)

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
            ov = overlap(g.tree(), T_shrunk[o.name])
            if ov:
                hit("d", a, o.name, 0, ov, g, shrunk[o.name])

    seat = {}
    if pivot is not None:
        tur_live = [o.name for o in live if lside[o.name] == "turret"]
        hul_live = [o.name for o in live if lside[o.name] == "hull"]
        tur_kit = [n for n in names if kside[n] == "turret"]
        hul_kit = [n for n in names if kside[n] == "hull"]
        T_plain_hull = {n: plain[n].tree() for n in hul_live}
        seat = {n: set() for n in tur_live + hul_live}
        rows = []
        for k in range(SWEEP_STEPS):
            deg = k * 360.0 / SWEEP_STEPS
            M = _rot(pivot, deg)
            Tt_shr = {n: shrunk[n].trees(M) for n in tur_live}
            Tt_pl = {n: plain[n].tree(M) for n in tur_live}
            Tt_kit = {n: kit[n].tree(M) for n in tur_kit}
            # the shipped seat: near side (plain) into far side (shrunk), both ways
            for t in tur_live:
                for h in hul_live:
                    seat[h] |= {j for _, j in overlap(Tt_pl[t], T_shrunk[h])}
                    seat[t] |= {j for _, j in overlap(T_plain_hull[h], Tt_shr[t])}
            rows.append((deg, M, Tt_shr, Tt_kit))
        for t in tur_live + hul_live:
            log(f"  CLASH seat {t}: {len(seat[t])} triangles the shipped "
                f"{'hull' if t in tur_live else 'turret'} already cuts in the sweep (baseline)")
        for deg, M, Tt_shr, Tt_kit in rows:
            # (b) turret kit x hull kit (strict) and x hull shipped (tolerant, baselined)
            for a in tur_kit:
                for b in hul_kit:
                    ov = Tt_kit[a].overlap(T_kit[b])
                    if ov:
                        hit("b", a, b, deg, ov, kit[a], kit[b], M)
                for h in hul_live:
                    ov = [(i, j) for i, j in overlap(Tt_kit[a], T_shrunk[h]) if j not in seat[h]]
                    if ov:
                        hit("b", a, h, deg, ov, kit[a], shrunk[h], M)
            # (c) hull kit x turret shipped (tolerant, baselined)
            for a in hul_kit:
                for t in tur_live:
                    ov = [(i, j) for i, j in overlap(T_kit[a], Tt_shr[t]) if j not in seat[t]]
                    if ov:
                        hit("c", a, t, deg, ov, kit[a], shrunk[t], None, M)

    refusals = []
    used = set()
    for key in sorted(findings, key=lambda k: (k[0], k[1], k[2])):
        f = findings[key]
        why = None
        for (ea, eb, prefix), spec in exemptions.items():
            reason, at = (spec, None) if isinstance(spec, str) else spec
            if (ea == f.a and eb == f.b and all(p.startswith(prefix) for p in f.pieces)
                    and (at is None or set(f.headings) <= set(at))):
                why = reason
                used.add((ea, eb, prefix))
        if why:
            log(f"  EXEMPT {f.line()}")
            log(f"      because: {why}")
        else:
            log(f"  {f.line()}")
            refusals.append(f"clash ({f.check}) {f.a} x {f.b}")
    for key, spec in exemptions.items():
        reason, at = (spec, None) if isinstance(spec, str) else spec
        log(f"  CLASH EXEMPTION {key[0]} x {key[1]} (pieces '{key[2]}*'"
            + (f", headings {sorted(at)}" if at is not None else "") + f"): {reason}")
        if key not in used:
            refusals.append(f"clash exemption {key} excuses nothing any more: delete it")
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
    summary = {"pairs": n_pairs, "findings": len(findings), "refused": len(refusals),
               "pivot": pivot.name if pivot is not None else None}
    log(f"CLASH {vid}: pairs tested a={n_pairs['a']} b={n_pairs['b']}x{SWEEP_STEPS if pivot else 0} "
        f"c={n_pairs['c']}x{SWEEP_STEPS if pivot else 0} d={n_pairs['d']}; "
        f"{len(findings)} with contact, {len(findings) - sum(1 for r in refusals if r.startswith('clash ('))} exempted, "
        f"{len(refusals)} refused (touch {TOUCH * 100:.0f} cm, pivot {summary['pivot']})")
    return refusals, summary
