"""yahalom_gear.py -- the Yahalom Engineers' base gear, built in code (GH-826, infantry upgrade unit "Yahalom").

Blender-only. The lead's decisions of 15 Nov 2026 (the unit's plan, section 2 and decisions 11 and 12): a real assault
pack on both men's backs, over the carrier (the black 0.30 x 0.46 x 0.44 box goes), and the mine detector COLLAPSED,
strapped upright to the leader's pack's side with its search head below the helmet line (the 1.53 m level pole goes).
No Meshy call made either (the lead's ruling of 15 Nov: the body is the fallback; the part references were never
bought): both are modelled here, at real size, from the kit's own primitives plus the three below, and painted with
the kit's five pinned texels of the team's own atlas (`inf_kit_parts.TEAMS["yahalom_squad"].texels`): no texture, no
material and no palette primitive of their own.

`import_meshy_skinned_team._team_extras` calls `build`, binds what it returns rigidly to each man's spine (`rig.rig_parts`)
and ships it as the file's `webbing` role, so the kit's fitter and its clash census see it as body (`Team.prims`,
`Team.bank_prims`) and the kit's radio pouch, whips and mast sensor stand on it (`inf_kit_v7`).

Every literal that decides what is drawn is in the tables below, with where it comes from: the PLAN (approved), a
literal CARRIED from the kit or from demo_squad's row, or a REAL object's dimension chosen here (those are listed for
the lead in the sheet's README: he has not ruled on them). Nothing is hand-placed: the pack's seat is measured on each
man's own back. No mathutils.noise (Blender 5.2 reseeds it per process).
"""
import math

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import inf_kit_geo as geo
import inf_kit_parts as kp
from inf_kit_geo import Piece

# ----------------------------------------------------------------------------- the pack
#: RULED (the lead, 17 Nov 2026, "Approve all": the round-1 review's size table, row 1): 0.40 x 0.30 x 0.20 m, the small
#: assault-pack class. Round 1 built the plan's 0.50 m: its lower third hung 0.21 / 0.19 m under the spine bone's pivot (the
#: belt joint) and swung 154-181 mm off the lumbar when `pinned` folds the spine (the review, section 1). The top stays.
PACK_H, PACK_W, PACK_D = 0.40, 0.30, 0.20
#: CARRIED: the v7 radio pack's row, "top at z <= 1.40" on a trunk whose collar is 1.42 = 0.040 under the shoulder joints
#: (`Team.torso_from_joints`), so the pack's top is 0.060 under each man's own shoulder joints.
PACK_TOP_UNDER_SHOULDER_M = 0.060
#: CARRIED: `inf_kit_v7.BODY_CLEAR`, "nothing of the carrier within this of the body".
PACK_CLEAR_M = 0.006
#: REAL (not in the plan): how the 0.50 x 0.30 x 0.20 envelope is divided. The bag's own depth and the pocket on its
#: outer face add up to PACK_D; the lid is the envelope's full width and stands the bag's depth plus 5 mm.
#: RULED (rows 3 and 4): the bag 0.39 tall, the pocket 0.20 tall, 25 x 4 mm webbing, compression straps +65 / -90.
#: DERIVED from those, not ruled (each keeps round 1's margin to the same edge): the pocket's `drop` 0.085 -> 0.065 (its
#: lower edge stays 35 mm over the bag's).
PACK_BAG = dict(depth=0.155, width=0.29, height=0.39, radius=0.040)
PACK_POCKET = dict(depth=0.045, width=0.22, height=0.20, radius=0.020, drop=0.065)     # its centre this far under the pack's
PACK_LID = dict(depth=0.160, width=0.30, height=0.075, radius=0.030)
#: RULED (row 5): the back pad is the bag's own conforming back, in the bag's colour, inset from its outline, as deep as
#: the back needs, tapered to nothing over its last `taper` (not stepped). `width` and `clear` are round 1's. DERIVED: its
#: height 0.44 -> 0.34 (30 mm inside the pack's top and bottom, as round 1's was). It follows the BARE back (at tier 0 it
#: fills what the kit's back plate fills at armour 1 and up, where it stands inside the plate bag, hidden: named).
PACK_PAD = dict(width=0.24, height=0.34, cols=6, rows=8, clear=0.012, taper=0.05)
PACK_WEBBING_W = 0.025        # REAL: 25 mm webbing (the lid's two straps, the two compression straps a side)
PACK_WEBBING_T = 0.004
PACK_LID_STRAP_Y = 0.065      # either side of the centre line
PACK_COMPRESSION_Z = (0.065, -0.090)    # about the pack's centre (RULED, row 4)
#: RULED (row 6): a 60 x 12 mm padded shoulder strap, CONFORMED (round 1's was a flat 50 x 8 band set 16 mm over the
#: highest point under its whole width: it stood 27-30 mm off the shoulder's crest, 45-47 at the 90th percentile, a hoop).
#: It runs from the lid's front edge over the shoulder and ends at the carrier's collar line on the chest (CARRIED: 0.040
#: under the shoulder joints). Its section is `lateral` vertices across the width, EACH on the body's own surface under it
#: plus `clear`, and a padded back `thick` over them (half of it at the two edges).
#: `y`: the nearest it may lie to the spine's line; it is moved outboard, 5 mm at a time and both sides together (at most
#: to `y_max`), until its inner edge is on the shoulder and not under the collar (`crest_max`). RULED: "the same lateral
#: position", so the search still reads round 1's 50 mm band (`search_width`): 0.150 on yah_a, 0.145 on yah_b.
#: `clear`: RULED as "the smallest value that keeps idle and move at 0" (`launcher_clearance.test.ts`, `YAHALOM_GEAR`: the
#: gear's samples inside the bare trunk). READ, 17 Nov 2026, by a sweep on the final seat (the importer, the motion and gait
#: passes, then the gate's own instrument, for each value: `_coord/infantry-upgrade/yahalom/gates-r2/strap_clear_sweep*.txt`),
#: samples inside as yah_a idle / move, yah_b idle / move:
#:     0 mm 155 / 127, 153 / 113     12 mm 13 / 0, 6 / 10      22 mm 0 / 0, 0 / 3      27 mm 0 / 0, 0 / 0   <- the smallest
#:     4 mm  66 /  35,  59 /  22     16 mm  2 / 0, 0 /  8      24 mm 0 / 0, 0 / 2      28 mm 0 / 0, 0 / 0
#:     8 mm  32 /   3,  21 /  10     20 mm  0 / 0, 0 /  5      26 mm 0 / 0, 0 / 2
#: So 27 mm: MORE than round 1's 16 mm. The strap is rigid on the spine and the shoulder, collar and neck move under it; the
#: last samples to leave are on its INNER edge, 0.120 / 0.115 m off the spine's line, where the neck's root comes back at it
#: in the run. A 60 mm band at round 1's centre has its inner edge 5 mm nearer the collar than the 50 mm band the centre was
#: found for. MEASURED, NOT BUILT (a number the lead has not ruled): the same search run on the 60 mm band puts the centre at
#: 0.155 / 0.150 m, and there idle and move read 0 at 20 mm (16 mm: 2 / 0, 0 / 0).
PACK_STRAP = dict(width=0.060, thick=0.012, y=0.085, y_max=0.18, crest_max=0.14, search_width=0.050, step_deg=9.0, lateral=5,
                  clear=0.027)
PACK_SEGS = 3                 # rounded edges: segments a quarter turn (the bag; the lid and the pocket take 2)

# ----------------------------------------------------------------------------- the stowed detector
#: PLAN (section 2): "shaft about 0.65 m, oval head about 0.28 m [verify]". Verified against a collapsible military
#: detector of the VMH3CS class: transport length 0.60-0.70 m with the rod telescoped and the head folded flat against
#: it, the oval search head 0.28-0.31 m long. The plan's numbers stand.
DET_SHAFT_M = 0.65
DET_HEAD_LEN_M = 0.28
#: REAL (not in the plan): the rest of that detector. The head is an oval RING (0.17 wide, a 30 mm band 22 mm thick)
#: with a spar down its long axis; the rod is two telescoped tubes (32 and 26 mm); the electronics and the grip are a
#: 0.16 x 0.05 x 0.045 box at the rod's lower end.
DET_HEAD = dict(width=0.17, band=0.030, thick=0.022, sides=20, section=8)
DET_ROD = dict(r_low=0.016, r_high=0.013, low_frac=0.55, sides=10)
DET_BOX = dict(height=0.16, depth=0.050, width=0.045, radius=0.012, up=0.03)     # its lower end this far over the rod's
DET_GAP_M = 0.004              # between the pack's side and the rod, and between the rod and the folded head
#: RULED (row 8): "the detector keeps its make-up and its round-1 height (top at 1.49 m or lower)". Round 1's foot stood
#: 20 mm over the 0.50 m pack's lower edge, which is 0.48 m under the pack's top; the top did not move, so that is where it
#: stays: 80 mm UNDER the 0.40 m pack's lower edge along the pack (the review's "about 9 cm").
DET_FOOT_UNDER_PACK_TOP_M = 0.48
#: DERIVED, not ruled: the two straps that hold it to the pack, up the rod from its foot. Round 1's stood 0.12 m over the
#: pack's lower edge and 0.12 m under its top; they keep both margins on the shorter pack (0.10 -> 0.20; 0.36 stays).
DET_STRAP_Z = (0.20, 0.36)
DET_SIDE = +1.0                # anatomical LEFT (Blender +y): the firing elbow swings back on the right

#: Triangle ceilings: the PLAN's (section 4, "Base gear at most 1,500 for a pack, 900 for the stowed detector").
PACK_MAX_TRIS = 1500
DET_MAX_TRIS = 900


def soft_box(pc, centre, R, size, radius, tex, segs=PACK_SEGS):
    """A box with every edge rounded by `radius` (a quarter turn of `segs` segments): `size` along R's three columns."""
    a, b, h = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    r = min(radius, a * 0.98, b * 0.98, h * 0.98)
    c = Vector(centre)

    def section(inset):
        rr = max(r - inset, 0.0)
        aa, bb = a - inset, b - inset
        pts = []
        for cx, cy, a0 in ((aa - rr, bb - rr, 0.0), (-(aa - rr), bb - rr, 90.0), (-(aa - rr), -(bb - rr), 180.0), (aa - rr, -(bb - rr), 270.0)):
            for i in range(segs + 1):
                t = math.radians(a0 + 90.0 * i / segs)
                pts.append((cx + rr * math.cos(t), cy + rr * math.sin(t)))
        return pts
    levels = []
    for i in range(segs + 1):
        t = 0.5 * math.pi * i / segs
        levels.append((-h + r - r * math.cos(t), r - r * math.sin(t)))
    for i in range(segs + 1):
        t = 0.5 * math.pi * i / segs
        levels.append((h - r + r * math.sin(t), r - r * math.cos(t)))
    rings = [[c + R @ Vector((x, y, z)) for (x, y) in section(inset)] for (z, inset) in levels]
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            pc.face([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], tex)
    pc.face(list(reversed(rings[0])), tex)
    pc.face(rings[-1], tex)


def strip(pc, pts, normals, lateral, width, thick, tex):
    """A flat strap along `pts`: `width` across `lateral`, `thick` up each point's normal, closed at both ends."""
    lat = Vector(lateral).normalized() * (width / 2.0)
    rows = []
    for p, n in zip(pts, normals):
        p, n = Vector(p), Vector(n).normalized()
        rows.append((p - lat, p + lat, p + lat + n * thick, p - lat + n * thick))
    for a, b in zip(rows[:-1], rows[1:]):
        for k in range(4):
            k2 = (k + 1) % 4
            pc.face([a[k], a[k2], b[k2], b[k]], tex)
    pc.face(list(reversed(rows[0])), tex)
    pc.face(list(rows[-1]), tex)


def oval_ring(pc, centre, R, half_long, half_wide, band, thick, sides, section, tex):
    """An oval ring in R's x-z plane (z the long axis), its band `band` wide in the plane and `thick` across it (R's y)."""
    c = Vector(centre)
    a, b = half_long - band / 2.0, half_wide - band / 2.0      # the band's centre line
    rings = []
    for i in range(sides):
        t = 2.0 * math.pi * i / sides
        p = Vector((b * math.sin(t), 0.0, a * math.cos(t)))
        n = Vector((math.sin(t) / b, 0.0, math.cos(t) / a)).normalized()      # the ellipse's outward normal, in the plane
        ring = []
        for k in range(section):
            u = 2.0 * math.pi * k / section
            ring.append(c + R @ (p + n * (0.5 * band * math.cos(u)) + Vector((0.0, 0.5 * thick * math.sin(u), 0.0))))
        rings.append(ring)
    for i in range(sides):
        A, B = rings[i], rings[(i + 1) % sides]
        for k in range(section):
            k2 = (k + 1) % section
            pc.face([A[k], A[k2], B[k2], B[k]], tex)


def _lower_hull(pts):
    """The lower convex hull of (t, v) points, by increasing t."""
    out = []
    for p in sorted(pts):
        while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
            out.pop()
        out.append(p)
    return out


def _back_x(bvh, cx, y, z):
    """The back's own surface at (y, z): where a ray from the spine's line straight back leaves the trunk (None: no trunk there)."""
    hit = bvh.ray_cast(Vector((cx, y, z)), Vector((-1.0, 0.0, 0.0)))
    return None if hit[0] is None or hit[3] > 0.30 else float(hit[0].x)


def plate_reader(rows, shift):
    """The kit's back plate as the seat reads it: (y, z) -> the rear-most x of the plate bag within a cell of that point, or
    None where there is no plate. `rows`: one man's table of `yahalom_back_plate.json` (metres about his slot: a grid of
    the rear face's x, `null` where the carrier has no wall); `shift`: his slot."""
    if rows is None:
        return lambda y, z: None
    y0, dy, z0, dz, grid = rows["y0"], rows["dy"], rows["z0"], rows["dz"], rows["x"]

    def at(y, z):
        k = int(round((y - shift[1] - y0) / dy)); j = int(round((z - z0) / dz))
        if 0 <= j < len(grid) and 0 <= k < len(grid[j]) and grid[j][k] is not None:
            return grid[j][k] + shift[0]
        return None
    return at


def pack_seat(bvh, cx, cy, z_top, plate=None):
    """Where a pack PACK_H tall rests on this back: (origin, R, readings).

    The bag's body-side face is flat, and nothing of the bag is inside the man: it rests the way a board does, on the
    rear-most point above its middle and the rear-most point below it (the supporting line of the back's rear profile
    over the bag's whole width, read in 2 cm steps), PACK_CLEAR_M off both. What that leaves open between the face and
    the back is the pack's own back pad (`_back_pad`), which follows the back. The profile is read from INSIDE the trunk
    (rays from the spine's line `cx`, `cy` straight back: the first surface they leave through is the back's own,
    whatever the shell carries in front of it or welded to its sides).
    RULED (17 Nov 2026, row 7): the pack is seated over the bare back AND the kit's back plate together. `plate` is the
    plate bag's rear face (`plate_reader`): at each station the profile takes the rear-most of the two, so the same pack
    is clear of the plate at armour 1 and up and stands that much further off the bare back at tier 0 (the pad fills it).
    `origin` is the middle of that face; R's columns are (out of the back, the man's right, up the pack)."""
    z_bot = z_top - PACK_H
    prof, over, bare_prof = [], [], []
    n_st = len(np.arange(z_bot + 0.01, z_top, 0.02))
    for z0 in np.arange(z_bot + 0.01, z_top, 0.02):
        xs, ps = [], []
        for dy in np.linspace(-PACK_W / 2, PACK_W / 2, 13):
            x = _back_x(bvh, cx, cy + dy, z0)
            if x is not None:
                xs.append(x)
            p = plate(cy + dy, float(z0)) if plate else None
            if p is not None:
                ps.append(p)
        if xs:
            bare = float(min(xs))
            both = min(bare, float(min(ps))) if ps else bare
            prof.append((float(z0), both))
            bare_prof.append(bare)
            over.append(bare - both)
    if len(prof) < 0.48 * n_st + 1:
        raise SystemExit(f"the back reads {len(prof)} of {n_st} stations between z {z_bot:.3f} and {z_top:.3f}: the pack has no seat")
    hull = _lower_hull(prof)
    zm = 0.5 * (z_top + z_bot)
    a, b = next(((p, q) for p, q in zip(hull[:-1], hull[1:]) if p[0] <= zm <= q[0]), (hull[0], hull[-1]))
    slope = (b[1] - a[1]) / (b[0] - a[0])                       # dx / dz of the supporting line
    up = Vector((slope, 0.0, 1.0)).normalized()
    out = Vector((-1.0, 0.0, slope)).normalized()
    right = Vector((0.0, -1.0, 0.0))
    x_mid = a[1] + slope * (zm - a[0])
    origin = Vector((x_mid, cy, zm)) + out * PACK_CLEAR_M
    R = Matrix((out, right, up)).transposed()
    gaps = [(x - (a[1] + slope * (z - a[0]))) for z, x in prof]
    bare_gaps = [(x - (a[1] + slope * (z - a[0]))) for (z, _x), x in zip(prof, bare_prof)]
    read = dict(pitch_deg=round(math.degrees(math.atan(slope)), 1), rests_at_z=(round(a[0], 3), round(b[0], 3)), back_x=round(float(x_mid), 3),
                back_off_face_mm=[round(1000 * float(v), 1) for v in (min(gaps), np.median(gaps), max(gaps))],
                bare_back_off_face_mm=[round(1000 * float(v), 1) for v in (min(bare_gaps), np.median(bare_gaps), max(bare_gaps))],
                plate_over_bare_mm=[round(1000 * float(v), 1) for v in (min(over), np.median(over), max(over))], plate_stations=int(sum(1 for v in over if v > 0)),
                stations=len(prof), z=(round(z_bot, 3), round(z_top, 3)))
    return origin, R, read


def _back_pad(pc, bvh, origin, R, cx, deepest):
    """The pack's conforming back: a panel PACK_PAD wide and tall on the bag's body-side face, in the bag's own colour, its
    inner face on the man's BARE back (`clear` off it, at each node the rear-most of nine readings of the cell about it), so
    the pack is seen to lie on the back from the side instead of standing on two points of it. As deep as the back needs
    ("depth as measured": never deeper than `deepest`, the most the bare back stands off the pack's face along the seat's
    own profile, the reading the ruling names; a node past it is at the trunk's side, where the back has turned away from
    the pack, and the pad ends in the air there as round 1's did at its 70 mm). Over its last `taper` at the lower end the
    depth runs out to nothing (round 1's stopped in a step at the belt line, and read as a wedge)."""
    pad = PACK_PAD
    ny, nz = pad["cols"], pad["rows"]
    out = R.col[0]
    P = [[None] * (ny + 1) for _ in range(nz + 1)]
    F = [[None] * (ny + 1) for _ in range(nz + 1)]
    worst = 0.0
    for j in range(nz + 1):
        for k in range(ny + 1):
            ly = -pad["width"] / 2 + pad["width"] * k / ny
            lz = -pad["height"] / 2 + pad["height"] * j / nz
            f = origin + R @ Vector((0.004, ly, lz))                       # on the bag's face, 4 mm inside it
            ds = []
            for dy, dz in ((a_, b_) for a_ in (-1, 0, 1) for b_ in (-1, 0, 1)):
                q = f + R @ Vector((0.0, dy * 0.5 * pad["width"] / ny, dz * 0.5 * pad["height"] / nz))
                x = _back_x(bvh, cx, q.y, q.z)
                if x is not None:
                    ds.append((x - q.x) / max(-out.x, 0.5))            # from the face forward to the back's surface (out is nearly -x)
            deep = min(max(min(ds) - pad["clear"], 0.0), deepest) if ds else 0.0
            deep *= min(1.0, (pad["height"] * j / nz) / pad["taper"])   # the lower end: nothing at the edge, all of it `taper` up
            worst = max(worst, deep)
            F[j][k] = f
            P[j][k] = f - out * deep
    for j in range(nz):
        for k in range(ny):
            pc.face([P[j][k], P[j][k + 1], P[j + 1][k + 1], P[j + 1][k]], "coyote", hint=True)
    # the rim, down to the bag's face
    for j in range(nz):
        pc.face([F[j][0], P[j][0], P[j + 1][0], F[j + 1][0]], "coyote", hint=True)
        pc.face([F[j][ny], F[j + 1][ny], P[j + 1][ny], P[j][ny]], "coyote", hint=True)
    for k in range(ny):
        pc.face([F[0][k], F[0][k + 1], P[0][k + 1], P[0][k]], "coyote", hint=True)
        pc.face([F[nz][k], P[nz][k], P[nz][k + 1], F[nz][k + 1]], "coyote", hint=True)
    c = origin + R @ Vector((PACK_BAG["depth"] / 2, 0.0, 0.0))
    pc.outward = lambda p_: (Vector(p_) - c)
    return round(1000 * worst, 1)


def plain_box(pc, centre, R, size, tex):
    """A 12-triangle box: `size` along R's three columns (25 x 4 mm webbing: a rounded edge on it is under a millimetre)."""
    c = Vector(centre)
    h = [v / 2.0 for v in size]
    P = {(i, j, k): c + R @ Vector((i * h[0], j * h[1], k * h[2])) for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)}
    for ax in range(3):
        for s in (-1, 1):
            a_, b_ = [x for x in range(3) if x != ax]
            ring = []
            for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                key = [0, 0, 0]; key[ax] = s; key[a_] = u; key[b_] = v
                ring.append(P[tuple(key)])
            pc.face(ring, tex)


def _strap(pc, bvh, pivot, lat, root, st, tex):
    """One shoulder strap, conformed: (number of rings, its end, the readings).

    Stations: a half turn about `pivot` in the plane y = const, from straight back, over the shoulder, to straight ahead
    (every ray leaves from INSIDE the trunk, so the first surface it passes is the trunk's own). At each station the band's
    `lateral` vertices each take the body's surface under THEM (the outermost of three readings half a step either side: a
    chord between two stations must not cut a shoulder that curves under it) plus `clear`; a vertex whose ray finds no
    trunk takes its neighbour's. The padded back stands `thick` over the highest of the middle three, half of it at the edges.
    The root is on the lid's front edge; from it a Hermite run of three rings reaches the first station and ARRIVES along
    the band's own direction there (round 1 joined the two by one chord: the Z-kink), taking up the conformed section on the way."""
    nl = st["lateral"]
    offs = [(j / (nl - 1) - 0.5) * st["width"] for j in range(nl)]
    step = math.radians(st["step_deg"])
    rings, dirs = [], []
    borrowed = [0] * nl                  # per lateral vertex (0: the band's edge at the lower y): stations where it is NOT on its own surface
    for i in range(int(round(180.0 / st["step_deg"])) + 1):
        ang = math.pi - step * i
        d = Vector((math.cos(ang), 0.0, math.sin(ang)))
        far = []
        for off in offs:
            best = None
            for da_ in (-0.5, 0.0, 0.5):
                a_ = ang + step * da_
                dd = Vector((math.cos(a_), 0.0, math.sin(a_)))
                h_ = bvh.ray_cast(pivot + lat * off, dd)
                if h_[0] is not None and h_[3] <= 0.25:
                    r_ = h_[3] * max(dd.dot(d), 0.5)                     # along this station's own direction
                    best = r_ if best is None or r_ > best else best
            far.append(best)
        mid = bvh.ray_cast(pivot, d)
        if mid[0] is None or mid[3] > 0.25 or far[nl // 2] is None:
            if d.x > 0.0 and len(rings) > 3:
                break                    # the trunk's own surface ends here (a forearm or the carbine welded to the chest): so does the strap
            continue
        for j in range(nl):              # a ray that found no trunk: its nearest neighbour's reading (counted: `borrowed`)
            if far[j] is None:
                far[j] = next(far[k] for k in sorted(range(nl), key=lambda k_: abs(k_ - j)) if far[k] is not None)
                borrowed[j] += 1
        inner = [pivot + lat * off + d * (f_ + st["clear"]) for off, f_ in zip(offs, far)]
        rings.append(inner); dirs.append(d)
    if len(rings) < 5:
        return 0, None, None

    def section(inner, d):
        top = max((p - pivot).dot(d) for p in inner[1:-1])
        o_mid = inner[nl // 2] + d * (top - (inner[nl // 2] - pivot).dot(d) + st["thick"])
        return list(inner) + [inner[-1] + d * (st["thick"] / 2.0), o_mid, inner[0] + d * (st["thick"] / 2.0)]

    secs = [section(r_, d) for r_, d in zip(rings, dirs)]
    # the root: a flat section on the lid's front edge, and three rings from it onto the first station along the band's own way
    d0 = dirs[0]
    flat = [root + lat * off for off in offs]
    s_root = section(flat, d0)
    tan = [(b - a) for a, b in zip(secs[0], secs[1])]
    run = []
    for u in (0.25, 0.5, 0.75):
        h00, h10, h01, h11 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
        ring = []
        for p0, p1, t_ in zip(s_root, secs[0], tan):
            m0 = p1 - p0                                                  # it leaves the lid on its way to the shoulder...
            m1 = t_.normalized() * m0.length if t_.length > 1e-6 else m0   # ...and arrives along the band's own direction there
            ring.append(p0 * h00 + m0 * h10 + p1 * h01 + m1 * h11)
        run.append(ring)
    secs = [s_root] + run + secs
    n = len(secs[0])
    for a, b in zip(secs[:-1], secs[1:]):
        for k in range(n):
            k2 = (k + 1) % n
            pc.face([a[k], a[k2], b[k2], b[k]], tex)
    pc.face(list(reversed(secs[0])), tex)
    pc.face(list(secs[-1]), tex)
    end = secs[-1][nl // 2]
    return len(secs), end, dict(stations=len(rings), borrowed_per_lateral_vertex=borrowed, first_station_over_root_mm=round(1000 * (rings[0][nl // 2].z - root.z), 1),
                                first_station_ahead_of_root_mm=round(1000 * (rings[0][nl // 2].x - root.x), 1))


def build_pack(name, body_bvh, origin, R, cx, cy, z_collar, pad_deepest):
    """One man's pack, in world coordinates: (Piece, readings). `origin` / `R` from `pack_seat`."""
    pc = Piece()
    bag, pocket, lid = PACK_BAG, PACK_POCKET, PACK_LID
    L = lambda x, y, z: origin + R @ Vector((x, y, z))  # noqa: E731
    soft_box(pc, L(bag["depth"] / 2, 0, -(PACK_H - bag["height"]) / 2), R, (bag["depth"], bag["width"], bag["height"]), bag["radius"], "coyote")
    soft_box(pc, L(PACK_D - pocket["depth"] / 2, 0, -pocket["drop"]), R, (pocket["depth"], pocket["width"], pocket["height"]), pocket["radius"], "coyote_shade", segs=2)
    soft_box(pc, L(lid["depth"] / 2, 0, PACK_H / 2 - lid["height"] / 2), R, (lid["depth"], lid["width"], lid["height"]), lid["radius"], "coyote_shade", segs=2)
    pad_mm = _back_pad(pc, body_bvh, origin, R, cx, pad_deepest)
    # the lid's two straps down the outer face to the pocket, and a buckle on each
    z_hi = PACK_H / 2 - lid["height"] + 0.01
    z_lo = -pocket["drop"] + pocket["height"] / 2 - 0.02
    for sy in (-1.0, 1.0):
        y = sy * PACK_LID_STRAP_Y
        plain_box(pc, L(bag["depth"] + PACK_WEBBING_T / 2, y, (z_hi + z_lo) / 2), R, (PACK_WEBBING_T, PACK_WEBBING_W, z_hi - z_lo), "olive_dark")
        plain_box(pc, L(bag["depth"] + 0.006, y, z_hi - 0.035), R, (0.012, 0.034, 0.030), "glass")
    # two compression straps a side
    for sy in (-1.0, 1.0):
        for z in PACK_COMPRESSION_Z:
            plain_box(pc, L(bag["depth"] / 2 + 0.01, sy * (bag["width"] / 2 + PACK_WEBBING_T / 2), z), R,
                      (bag["depth"] * 0.80, PACK_WEBBING_T, PACK_WEBBING_W), "olive_dark")
    # the shoulder straps: off the lid's front edge, over the shoulder on the body's own surface, to the collar line
    st = PACK_STRAP
    lat = Vector((0.0, 1.0, 0.0))
    top_front = L(0.0, 0.0, PACK_H / 2 - 0.02)
    ends, depth, runs = [], [], []
    # ...clear of the neck: the shell is one closed body, so a ray that goes up inside the collar leaves through the
    # helmet. The straps move outboard together, in 5 mm steps, until the surface over BOTH is the shoulder's (within
    # `crest_max` over the collar line): one spacing, the same either side.
    y_off = st["y"]
    while y_off < st["y_max"]:
        # (read at the INNER edge of round 1's 50 mm band, `search_width`: the ruled lateral position is that search's)
        ups = [body_bvh.ray_cast(Vector((cx, cy + sy * (y_off - st["search_width"] / 2.0), z_collar)), Vector((0.0, 0.0, 1.0))) for sy in (-1.0, 1.0)]
        if all(u[0] is not None and u[3] < st["crest_max"] for u in ups):
            break
        y_off += 0.005
    else:
        raise SystemExit(f"{name}: no shoulder within {st['y_max']} of the spine's line")
    for sy in (-1.0, 1.0):
        y = cy + sy * y_off
        back = body_bvh.ray_cast(Vector((cx, y, z_collar)), Vector((-1.0, 0.0, 0.0)))
        front = body_bvh.ray_cast(Vector((cx, y, z_collar)), Vector((1.0, 0.0, 0.0)))
        if back[0] is None:
            raise SystemExit(f"{name}: no back at y {y:.3f}, z {z_collar:.3f}: the strap has no path")
        depth.append(front[3] + back[3] if front[0] is not None and front[3] < 0.25 else None)
        d_ = depth[-1] if depth[-1] is not None else next((v for v in depth if v is not None), 0.24)
        pivot = Vector((back[0].x + d_ / 2.0, y, z_collar))
        root = top_front + lat * (sy * y_off) - R.col[0] * 0.004        # the lid's front edge, 2 cm under its top
        n, end, read = _strap(pc, body_bvh, pivot, lat, root, st, "coyote_shade")
        if n < 8:
            raise SystemExit(f"{name}: the shoulder strap at y {y:.3f} found {n} rings of the body")
        ends.append((round(y_off, 3), round(end.x, 3), round(end.z, 3), n)); runs.append(read)
    me, tris = pc.finish(name)
    return me, tris, dict(strap_y_endx_endz_n=ends, strap_root_run=runs, strap_clear_mm=round(1000 * st["clear"], 1), pad_deepest_mm=pad_mm)


def build_detector(name, origin, R, z_limit):
    """The collapsed detector on the pack's side, head up: (mesh, triangles, readings). `origin` / `R` are the PACK's.
    `z_limit`: nothing of it above this (the helmet's rim: "head below the helmet line")."""
    pc = Piece()
    rod, head, box = DET_ROD, DET_HEAD, DET_BOX
    side = -DET_SIDE                      # R's +y is the man's right
    L = lambda x, y, z: origin + R @ Vector((x, y, z))  # noqa: E731
    up = R.col[2]
    x_mid = PACK_BAG["depth"] / 2
    y_rod = side * (PACK_BAG["width"] / 2 + DET_GAP_M + rod["r_low"])
    z_foot = PACK_H / 2 - DET_FOOT_UNDER_PACK_TOP_M
    top = L(x_mid, y_rod, z_foot + DET_SHAFT_M)
    drop = max(0.0, top.z - z_limit)
    z_foot -= drop / max(up.z, 0.5)
    foot = L(x_mid, y_rod, z_foot)
    l_low = DET_SHAFT_M * rod["low_frac"]
    geo.lathe(pc, foot, up, R.col[0], [(0.0, rod["r_low"]), (l_low, rod["r_low"]), (l_low + 0.004, rod["r_high"] + 0.004),
                                       (l_low + 0.022, rod["r_high"] + 0.004), (l_low + 0.026, rod["r_high"]), (DET_SHAFT_M, rod["r_high"])],
              rod["sides"], "olive_dark", cap0="olive_dark", cap1="olive_dark")
    # the electronics and grip, on the rod's outer side at its foot
    soft_box(pc, L(x_mid + rod["r_low"] + box["depth"] / 2 - 0.004, y_rod, z_foot + box["up"] + box["height"] / 2), R,
             (box["depth"], box["width"], box["height"]), box["radius"], "olive", segs=2)
    # the search head, folded flat against the rod's outboard side, its top level with the rod's
    y_head = y_rod + side * (rod["r_low"] + DET_GAP_M + head["thick"] / 2)
    zc = z_foot + DET_SHAFT_M - DET_HEAD_LEN_M / 2
    c = L(x_mid, y_head, zc)
    oval_ring(pc, c, R, DET_HEAD_LEN_M / 2, head["width"] / 2, head["band"], head["thick"], head["sides"], head["section"], "glass")
    soft_box(pc, c, R, (0.022, head["thick"] * 0.6, DET_HEAD_LEN_M - head["band"]), 0.004, "glass", segs=1)                 # the spar
    soft_box(pc, L(x_mid, (y_rod + y_head) / 2, zc - DET_HEAD_LEN_M / 2 + 0.03), R,
             (0.034, abs(y_head - y_rod) + 0.01, 0.040), 0.006, "olive_dark", segs=1)                                    # the hinge
    for z in DET_STRAP_Z:                                                                                              # the two straps
        soft_box(pc, L(x_mid, side * (PACK_BAG["width"] / 2) + side * (DET_GAP_M + rod["r_low"]) * 0.5 + side * 0.006, z_foot + z), R,
                 (2 * rod["r_low"] + 0.012, 2 * rod["r_low"] + DET_GAP_M + 0.012, PACK_WEBBING_W), 0.004, "coyote_shade", segs=1)
    me, tris = pc.finish(name)
    return me, tris, dict(foot_z=round(foot.z, 3), top_z=round((foot + up * DET_SHAFT_M).z, 3), lowered_mm=round(1000 * drop, 1),
                          head_centre=tuple(round(v, 4) for v in c), head_out=tuple(round(v, 6) for v in (R.col[1] * side)))


def body_bvh(co, tris):
    return BVHTree.FromPolygons([Vector(p) for p in co], [tuple(int(i) for i in t) for t in tris])


def build(team_id, prefix, body, tris, cx, cy, z_shoulder, z_rim, detector, plate=None):
    """A man's pack (and the leader's detector) on his own back. `body`: his shell's vertices at his slot; `cx`, `cy`: his
    spine's line; `z_shoulder`: his shoulder joints' height; `z_rim`: his helmet's rim; `plate`: the kit's back plate over
    his back (`plate_reader`). Returns ([(name, mesh, tris)], readings, the frame the kit stands on)."""
    kp.use_team(team_id)
    z_top = z_shoulder - PACK_TOP_UNDER_SHOULDER_M
    bvh = body_bvh(body, tris)
    origin, R, seat = pack_seat(bvh, cx, cy, z_top, plate)
    out = []
    # the pad's depth "as measured": the bare back's largest distance from the pack's face along the seat's own profile
    # (the face stands PACK_CLEAR_M off the supporting line and the pad's nodes 4 mm inside the face), less the pad's `clear`
    pad_deepest = seat["bare_back_off_face_mm"][2] / 1000.0 + PACK_CLEAR_M + 0.004 - PACK_PAD["clear"]
    me, n, read = build_pack(f"{prefix}_pack", bvh, origin, R, cx, cy, z_shoulder - 0.040, pad_deepest)
    if n > PACK_MAX_TRIS:
        raise SystemExit(f"{prefix}: the pack is {n} triangles, over the plan's {PACK_MAX_TRIS}")
    out.append((f"{prefix}_pack", me, n))
    readings = dict(pack=dict(seat, tris=n, **read))
    # what the kit stands on (`inf_kit_yahalom.py` reads it back from `extras.rl_gear`): the pack's frame, world metres
    frame = dict(pack=dict(origin=[round(float(v), 5) for v in origin], R=[[round(float(R[i][j]), 7) for j in range(3)] for i in range(3)],
                           bag=[PACK_BAG["depth"], PACK_BAG["width"], PACK_H]))
    if detector:
        me, n, read = build_detector(f"{prefix}_detector", origin, R, z_rim)
        if n > DET_MAX_TRIS:
            raise SystemExit(f"{prefix}: the stowed detector is {n} triangles, over the plan's {DET_MAX_TRIS}")
        out.append((f"{prefix}_detector", me, n))
        readings["detector"] = dict(read, tris=n)
        frame["detector"] = dict(head_centre=list(read["head_centre"]), head_out=list(read["head_out"]), head_thick=DET_HEAD["thick"])
    kp.use_team("inf_squad")
    return out, readings, frame
