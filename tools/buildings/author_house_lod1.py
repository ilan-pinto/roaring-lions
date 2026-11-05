"""Author `house_lod1`: the lower-detail twin of the two-storey house (GH-974).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_house_lod1.py

Writes art/src/buildings/house_lod1.blend and art/meshes/buildings/house_lod1.glb.

Why. `house.glb` is a Meshy remesh of 39,016 triangles (glass 4,084, metal 11,714, roof 353, trim 746, wall 22,119) and a
town like Milh Flats draws six of them. Measured (GH-974 step 0, hiding every house): -0.6 ms at centre zoom 1 and
-0.7 at 1.6. At zoom 1 a metre is 15 px: the stone coursing (0.3 m) is 4 px and the rebar and the cables are under one.
This twin keeps what IS visible below zoom 2.0 -- the massing, the parapets, the window and door reveals, the two roof
tanks -- and is made of planar quads and short prisms.

How. Not a decimate. Every number below was MEASURED off `house.glb` by ray-casting its surface (not its vertices), in
Blender's frame (the GLB's -z is Blender +y; the house is a box with its door on the +x face):

  main block   x -3.95..5.60, y -5.52..4.20, roof deck 9.20, parapet 0.35-0.38 thick to 9.70
  annex        x -6.38..-3.95, y -5.52..5.55: a 5.10 deck (5.60 for the landing at y > 3.72), walled 2.3 m high on the
               west and south sides, open to the north (an external stair climbs from its landing, +y side)
  windows      east face, 0.22 m reveals: y -3.98..-2.34 at z 1.98..3.50 and 6.38..7.90; y 0.94..2.66 at 6.38..7.90;
               the door y 0.82..2.30, z 0.34..3.26; a 0.34 m step slab on the +x side
  tanks        T1 r 0.70 at (-2.80, 2.75) to z 10.46; T2 r 0.64 at (3.22, 3.27), drum z 10.55..11.50 on four legs
  mast         a pole at (-1.62, 3.00) to z 12.71

Roles: the full mesh's five (`glass`, `metal`, `roof`, `trim`, `wall`), same node names and `rl_role`.

What it drops: stone coursing, the band-course relief (2 cm), the cables, the loose rebar of the annex, the stair TREADS
(a ramp), and every bevel under 5 cm.

Colour (the wall's rule): ZERO materials, UV0 sampled off the full house's bake. Faces are cut into CELL m cells so the
twin keeps the bake's low-frequency mottling (the dark floor band, the lighter quoins) rather than one flat colour.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lod_twin_common as C  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
SRC_FULL = os.path.join(REPO, "art", "meshes", "buildings", "house.glb")
OUT_GLB = os.path.join(REPO, "art", "meshes", "buildings", "house_lod1.glb")
OUT_BLEND = os.path.join(REPO, "art", "src", "buildings", "house_lod1.blend")

CELL = 0.6          # the stone is ~0.3 m: a 0.9 m cell lost the coursing and read as plaster from zoom 1.6
HIDDEN_CELL = 1.0   # the north and west faces never face the camera; coarse ALONG the run, the same CELL up the edge
TRI_CEILING = 4000
CREDIT = ("House LOD1 (GH-974) -- built in Blender from code (tools/buildings/author_house_lod1.py), "
          "derived from art/meshes/buildings/house.glb, project original")

X_W, X_MAIN_W, X_E = -6.38, -3.95, 5.60
Y_S, Y_MAIN_N, Y_N = -5.52, 4.20, 5.55
Y_LAND = 3.72
Z_DECK, Z_ANNEX, Z_LAND, Z_PAR, Z_ANNEX_PAR = 9.20, 5.10, 5.60, 9.70, 7.40
REVEAL = 0.22
WINDOWS = [(-3.98, -2.34, 1.98, 3.50), (-3.98, -2.34, 6.38, 7.90), (0.94, 2.66, 6.38, 7.90)]
DOOR = (0.82, 2.30, 0.34, 3.26)


class Box:
    def __init__(self, x0, x1, y0, y1, z0, z1):
        self.x0, self.x1, self.y0, self.y1, self.z0, self.z1 = x0, x1, y0, y1, z0, z1

    def contains(self, p):
        return self.x0 < p[0] < self.x1 and self.y0 < p[1] < self.y1 and self.z0 < p[2] < self.z1


class Ramp:
    """The north stair: a prism over y y0..y1 under the line from (xa, za) down to (xb, zb)."""

    def __init__(self, xa, xb, y0, y1, za, zb):
        self.xa, self.xb, self.y0, self.y1, self.za, self.zb = xa, xb, y0, y1, za, zb

    def contains(self, p):
        if not (self.xa < p[0] < self.xb and self.y0 < p[1] < self.y1 and p[2] > 0):
            return False
        t = (p[0] - self.xa) / (self.xb - self.xa)
        return p[2] < self.za + t * (self.zb - self.za)


def lines(lo, hi, cell, extras=()):
    n = max(1, int(round((hi - lo) / cell)))
    ls = [lo + (hi - lo) * k / n for k in range(n + 1)]
    for e in extras:
        if lo + 1e-6 < e < hi - 1e-6 and all(abs(e - v) > 0.02 for v in ls):
            ls.append(e)
    return sorted(ls)


def point(axis, plane, a, b):
    return (plane, a, b) if axis == "x" else (a, plane, b) if axis == "y" else (a, b, plane)


def face(Q, solids, own, role, axis, sign, plane, ra, rb, extras_a=(), extras_b=(), holes=(), cell=CELL):
    """A grid of quads on the plane `axis`=plane facing `sign`, spanning ra x rb. A cell is dropped when it lies inside
    another solid or inside a hole. Returns the (a-lines, b-lines) used so a reveal can share its edge vertices."""
    ca_, cb_ = cell if isinstance(cell, tuple) else (cell, cell)
    la, lb = lines(ra[0], ra[1], ca_, extras_a), lines(rb[0], rb[1], cb_, extras_b)
    nrm = {"x": (sign, 0, 0), "y": (0, sign, 0), "z": (0, 0, sign)}[axis]
    for i in range(len(la) - 1):
        for j in range(len(lb) - 1):
            ca, cb = (la[i] + la[i + 1]) / 2, (lb[j] + lb[j + 1]) / 2
            if any(h[0] < ca < h[1] and h[2] < cb < h[3] for h in holes):
                continue
            c = point(axis, plane, ca, cb)
            probe = tuple(c[k] + 0.03 * nrm[k] for k in range(3))
            back = tuple(c[k] - 0.03 * nrm[k] for k in range(3))
            if any(s is not own and s.contains(probe) for s in solids):
                continue
            if not own.contains(back):      # a cell off its own box (a face spanning a notch): never emit
                continue
            Q.add(role, [point(axis, plane, la[i], lb[j]), point(axis, plane, la[i + 1], lb[j]),
                         point(axis, plane, la[i + 1], lb[j + 1]), point(axis, plane, la[i], lb[j + 1])], nrm)
    return la, lb


def box(Q, solids, bx, role_side, role_top, extra=None, cell=CELL):
    """Five faces of a box (never the underside). `extra[face]` = (extras_a, extras_b, holes)."""
    extra = extra or {}
    spec = {
        "x-": ("x", -1, bx.x0, (bx.y0, bx.y1), (bx.z0, bx.z1)),
        "x+": ("x", 1, bx.x1, (bx.y0, bx.y1), (bx.z0, bx.z1)),
        "y-": ("y", -1, bx.y0, (bx.x0, bx.x1), (bx.z0, bx.z1)),
        "y+": ("y", 1, bx.y1, (bx.x0, bx.x1), (bx.z0, bx.z1)),
        "z+": ("z", 1, bx.z1, (bx.x0, bx.x1), (bx.y0, bx.y1)),
    }
    out = {}
    for k, (axis, sign, plane, ra, rb) in spec.items():
        ea, eb, holes = extra.get(k, ((), (), ()))
        role = role_top if k == "z+" else role_side
        c = (HIDDEN_CELL, cell) if (k in ("x-", "y+") and cell == CELL and axis == "x") else \
            (HIDDEN_CELL, cell) if (k in ("x-", "y+") and cell == CELL) else cell
        out[k] = face(Q, solids, bx, role, axis, sign, plane, ra, rb, ea, eb, holes, c)
    return out


def prism(Q, role, cx, cy, r, z0, z1, n=12, top=True):
    """A regular n-gon drum. One quad per side, a fan on top."""
    ring = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
    for k in range(n):
        (xa, ya), (xb, yb) = ring[k], ring[(k + 1) % n]
        mx, my = (xa + xb) / 2 - cx, (ya + yb) / 2 - cy
        Q.add(role, [(xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1)], (mx, my, 0))
        if top:
            Q.add(role, [(cx, cy, z1), (xa, ya, z1), (xb, yb, z1)], (0, 0, 1))


def build():
    Q = C.Quads()
    main = Box(X_MAIN_W, X_E, Y_S, Y_MAIN_N, 0.0, Z_DECK)
    par = [Box(X_MAIN_W, -3.58, Y_S, Y_MAIN_N, Z_DECK, Z_PAR), Box(5.22, X_E, Y_S, Y_MAIN_N, Z_DECK, Z_PAR),
           Box(-3.58, 5.22, Y_S, -5.14, Z_DECK, Z_PAR), Box(-3.58, 5.22, 3.85, Y_MAIN_N, Z_DECK, Z_PAR)]
    deck = Box(X_W, X_MAIN_W, Y_S, Y_LAND, 0.0, Z_ANNEX)
    land = Box(X_W, X_MAIN_W, Y_LAND, Y_N, 0.0, Z_LAND)
    wpar1 = Box(X_W, -6.03, Y_S, Y_LAND, Z_ANNEX, Z_ANNEX_PAR)
    wpar2 = Box(X_W, -6.03, Y_LAND, Y_N, Z_LAND, Z_ANNEX_PAR)
    spar = Box(-6.03, X_MAIN_W, Y_S, -5.17, Z_ANNEX, Z_ANNEX_PAR)
    step = Box(X_E, 6.39, 0.10, 3.10, 0.0, 0.34)
    ramp = Ramp(-3.90, 3.60, Y_MAIN_N, Y_N, 5.50, 0.10)
    solids = [main, *par, deck, land, wpar1, wpar2, spar, step, ramp]

    # the main block. East face: the window and door holes, with their edges as lines so the reveals share vertices.
    holes = [w for w in WINDOWS] + [DOOR]
    ea = sorted({v for h in holes for v in (h[0], h[1])})
    eb = sorted({v for h in holes for v in (h[2], h[3])})
    laa, lbb = {}, {}
    sides = box(Q, solids, main, "wall", "wall", extra={
        "x+": (ea, sorted(set(eb) | {4.30, 5.00}), holes),
        "y-": ((), (4.30, 5.00), ()),
        "z+": ((-3.58, 5.22), (-5.14, 3.85), ()),
    })
    la, lb = sides["x+"]
    for (y0, y1, z0, z1) in holes:
        deep = 0.30 if (y0, y1, z0, z1) == DOOR else REVEAL
        xb = X_E - deep
        ys = [v for v in la if y0 - 1e-6 <= v <= y1 + 1e-6]
        zs = [v for v in lb if z0 - 1e-6 <= v <= z1 + 1e-6]
        for i in range(len(ys) - 1):                       # sill and head
            Q.add("wall", [(X_E, ys[i], z0), (X_E, ys[i + 1], z0), (xb, ys[i + 1], z0), (xb, ys[i], z0)], (0, 0, 1))
            Q.add("wall", [(X_E, ys[i], z1), (X_E, ys[i + 1], z1), (xb, ys[i + 1], z1), (xb, ys[i], z1)], (0, 0, -1))
        for j in range(len(zs) - 1):                       # jambs
            Q.add("wall", [(X_E, y0, zs[j]), (X_E, y0, zs[j + 1]), (xb, y0, zs[j + 1]), (xb, y0, zs[j])], (0, 1, 0))
            Q.add("wall", [(X_E, y1, zs[j]), (X_E, y1, zs[j + 1]), (xb, y1, zs[j + 1]), (xb, y1, zs[j])], (0, -1, 0))
        Q.add("glass", [(xb, y0, z0), (xb, y1, z0), (xb, y1, z1), (xb, y0, z1)], (1, 0, 0))
        f, t = 0.10, 0.03                                  # frame: a 10 cm border, 3 cm proud
        for (a0, a1, b0, b1) in ((y0 - f, y1 + f, z1, z1 + f), (y0 - f, y1 + f, z0 - f, z0),
                                 (y0 - f, y0, z0, z1), (y1, y1 + f, z0, z1)):
            Q.add("trim", [(X_E + t, a0, b0), (X_E + t, a1, b0), (X_E + t, a1, b1), (X_E + t, a0, b1)], (1, 0, 0))
            for (p0, p1, q0, q1, nrm) in ((a0, a1, b1, b1, (0, 0, 1)), (a0, a1, b0, b0, (0, 0, -1)),
                                          (a0, a0, b0, b1, (0, -1, 0)), (a1, a1, b0, b1, (0, 1, 0))):
                Q.add("trim", [(X_E, p0, q0), (X_E + t, p0, q0), (X_E + t, p1, q1), (X_E, p1, q1)], nrm)
    # parapet: sides are wall, caps are roof
    for p in par:
        box(Q, solids, p, "wall", "roof")
    # annex
    box(Q, solids, deck, "wall", "wall", extra={"z+": ((), (), ())})
    box(Q, solids, land, "wall", "wall")
    for p in (wpar1, wpar2, spar):
        box(Q, solids, p, "wall", "roof")
    box(Q, solids, step, "wall", "wall")
    # the stair, as a ramp
    n = max(1, int(round(math.hypot(7.5, 5.4) / CELL)))
    for k in range(n):
        xa, xb = -3.90 + 7.5 * k / n, -3.90 + 7.5 * (k + 1) / n
        za, zb = 5.50 - 5.40 * k / n, 5.50 - 5.40 * (k + 1) / n
        Q.add("wall", [(xa, Y_MAIN_N, za), (xb, Y_MAIN_N, zb), (xb, Y_N, zb), (xa, Y_N, za)], (5.4, 0, 7.5))
        Q.add("wall", [(xa, Y_N, 0.0), (xb, Y_N, 0.0), (xb, Y_N, zb), (xa, Y_N, za)], (0, 1, 0))
    Q.add("wall", [(3.60, Y_MAIN_N, 0.0), (3.60, Y_N, 0.0), (3.60, Y_N, 0.10), (3.60, Y_MAIN_N, 0.10)], (1, 0, 0))
    # roof tanks, mast, rebar
    prism(Q, "metal", -2.80, 2.75, 0.70, Z_DECK, 10.46)
    prism(Q, "metal", 3.22, 3.27, 0.64, 10.55, 11.50)
    for dx in (-0.42, 0.42):
        for dy in (-0.42, 0.42):
            lx, ly = 3.22 + dx, 3.27 + dy
            lg = Box(lx - 0.035, lx + 0.035, ly - 0.035, ly + 0.035, Z_DECK, 10.55)
            box(Q, [], lg, "metal", "metal", cell=4.0)
    mast = Box(-1.655, -1.585, 2.965, 3.035, Z_DECK, 12.71)
    box(Q, [], mast, "metal", "metal", cell=4.0)
    for (rx, ry) in ((-3.65, -5.00), (-3.65, 3.90), (5.35, -4.80), (5.50, -4.85)):
        box(Q, [], Box(rx - 0.03, rx + 0.03, ry - 0.03, ry + 0.03, Z_PAR, 10.70), "metal", "metal", cell=4.0)
    return Q


def main():
    sampler, tree, full_pts, full_tris, full_roles = C.import_full(SRC_FULL)
    Q = build()
    total = Q.tri_count()
    if total > TRI_CEILING:
        raise SystemExit(f"house_lod1: {total} triangles over the ceiling {TRI_CEILING}")
    objs = C.build_and_export(Q, sampler, OUT_BLEND, OUT_GLB, CREDIT)
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo, hi = C.bounds(pts)
    flo, fhi = C.bounds(full_pts)
    per = {o.name: len(o.data.polygons) for o in objs}
    print(f"[house_lod1] {total} tris of {full_tris} ({100 * total / full_tris:.1f}%); roles {per}")
    print(f"[house_lod1] bounds lo {[round(v, 3) for v in lo]} hi {[round(v, 3) for v in hi]}; "
          f"full lo {[round(v, 3) for v in flo]} hi {[round(v, 3) for v in fhi]}; {os.path.getsize(OUT_GLB)} bytes")


if __name__ == "__main__":
    main()
