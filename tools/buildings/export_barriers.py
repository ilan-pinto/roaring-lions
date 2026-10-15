"""Export the GH-66 field-works barriers built in Blender from code: the precast
T-wall, the sandbag wall and the sandbag post, each a `per_tile` building pair
(mesh contract v2, BUILDINGS), palette-painted, zero materials.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_barriers.py -- all
    ... -- t_wall | sandbag_wall | sandbag_post

Writes `art/meshes/buildings/<id>.glb` and `<id>_wreck.glb`, and the standing
scene as `art/src/buildings/<id>.blend` (the mesh's `.blend` source).

WHY CODE AND NOT MESHY (2026-10-15). Both Meshy routes failed their preview
and their one re-roll on the checklist (`docs/ASSET_PROVENANCE.md`, "GH-66
field works"): the T-wall came back as offset square blocks, then as a bench;
the post as a roofed arch, then as a closed ring. The coordinator's ruling,
under the lead's delegation: build both here at 0 credits, palette colour,
maximum detail, and lay the sandbag wall from the post's own bags.

THE PARTS.
  * T-wall: two precast sections per 3 m tile (1.47 m wide, a 30 mm joint),
    each the real inverted-T profile -- a 1.2 m foot 0.3 m thick with a
    chamfered edge, a haunch, a stem tapering 0.30 -> 0.22 m to a chamfered
    top at 3.0 m (the lead's height) -- two lifting loops in each top, rust
    bleeding down both faces under each loop, and form-tie dimples. Role
    `wall` takes the type's own `color` (`gunmetal.0`, pale concrete); loops
    and ties `metal`; streaks `rust`.
  * Sandbags: `kit.sandbag`, a pillow (superquadric, pinched sewn ends, a
    settled top, a flat belly) jittered per bag by a deterministic integer
    hash, role `wood` (`dust.4`, the kit's sandbag role). The wall and the
    post are laid from the SAME bag, course by course, stretcher and header,
    so a run of wall beside a post reads as one material.
  * Sandbag wall: 7 courses (1.09 m), two bags deep for the bottom four,
    one above -- a tapered parapet -- with half bags at the butt ends of the
    offset courses so a run joins flush at x = +-1.5.
  * Sandbag post: a horseshoe laid along a U path (0.85 m arc, short arms),
    turned -45 deg so the closed front faces the camera corner (Blender +X/-Y,
    glTF +X/+Z, `building_facing.py`) and the entrance the hidden corner. A
    firing aperture in the top two courses at the front, with a dark `glass`
    pane set back in it so the facing gate can JUDGE the front. Three loose
    bags at the entrance.

WRECKS (no `collapse()` here: a sandbag wall does not dice like masonry).
  * T-wall: one section standing, leaning; the other snapped at 1.6 m, its
    top slab lying face-down in front of its stub, rebar stubs and rubble.
  * Sandbag wall: down to two courses with a deterministic spill both sides.
  * Sandbag post: the front breached to one course, the rest at two, a spill
    of bags thrown forward.

DETERMINISM: no `random`, no `mathutils.noise`; every jitter is `kit._jit`.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
SRC_DIR = os.path.join(REPO, "art", "src", "buildings")
# Spelled out per type so `tools/src/mesh_ownership.test.ts` can read, from the
# source alone, which files this script writes.
OUT_T_WALL = os.path.join(OUT_DIR, "t_wall.glb")
OUT_T_WALL_WRECK = os.path.join(OUT_DIR, "t_wall_wreck.glb")
OUT_SANDBAG_WALL = os.path.join(OUT_DIR, "sandbag_wall.glb")
OUT_SANDBAG_WALL_WRECK = os.path.join(OUT_DIR, "sandbag_wall_wreck.glb")
OUT_SANDBAG_POST = os.path.join(OUT_DIR, "sandbag_post.glb")
OUT_SANDBAG_POST_WRECK = os.path.join(OUT_DIR, "sandbag_post_wreck.glb")
SRC_T_WALL = os.path.join(SRC_DIR, "t_wall.blend")
SRC_SANDBAG_WALL = os.path.join(SRC_DIR, "sandbag_wall.blend")
SRC_SANDBAG_POST = os.path.join(SRC_DIR, "sandbag_post.blend")

HALF = 1.5  # half a tile, metres
CREDIT = ("Field works (GH-66): {name} -- built in Blender from code "
          "(tools/buildings/export_barriers.py, tools/buildings/kit.py), project original")

#: Triangle caps, set from the first export and kept a little above it: every
#: one of these is instanced on every tile of an authored run.
TRI_CAP = {"t_wall": 2500, "sandbag_wall": 9000, "sandbag_post": 12000}

# The bag every sandbag part is laid from (kit.sandbag's own default).
BAG = (0.58, 0.34, 0.17)
COURSE = BAG[2] * 0.92  # a laid bag settles into the one below


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def mesh_from(name, verts, faces, role):
    return kit._mesh(name, verts, faces, role)


def transform(ob, m):
    ob.data.transform(m)
    ob.data.update()


def tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def bounds(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    return (Vector([min(p[i] for p in pts) for i in range(3)]),
            Vector([max(p[i] for p in pts) for i in range(3)]))


def extrude_profile(name, profile, x0, x1, role):
    """A prism: the YZ `profile` (a closed polygon, counter-clockwise seen
    from +X) swept from x0 to x1, capped at both ends."""
    n = len(profile)
    v = [(x0, y, z) for y, z in profile] + [(x1, y, z) for y, z in profile]
    f = []
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    f.append(tuple(range(n - 1, -1, -1)))
    f.append(tuple(range(n, 2 * n)))
    ob = mesh_from(name, v, f, role)
    # Normals out: a profile wound the other way would turn every face in.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def torus(name, centre, major, minor, axis="y", role="metal", seg=14, ring=6):
    """A lifting loop: a torus standing in the XZ plane (axis = its normal)."""
    cx, cy, cz = centre
    v, f = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(ring):
            b = 2 * math.pi * j / ring
            r = major + minor * math.cos(b)
            x, z, y = r * math.cos(a), r * math.sin(a), minor * math.sin(b)
            if axis == "x":
                x, y = y, x
            v.append((cx + x, cy + y, cz + z))
    for i in range(seg):
        for j in range(ring):
            a0 = i * ring + j
            a1 = i * ring + (j + 1) % ring
            b0 = ((i + 1) % seg) * ring + j
            b1 = ((i + 1) % seg) * ring + (j + 1) % ring
            f.append((a0, b0, b1, a1))
    return mesh_from(name, v, f, role)


def quad(name, pts, role):
    return mesh_from(name, pts, [(0, 1, 2, 3)], role)


def tilt_bag(ob, seed, max_deg):
    """Rotate a lying bag about its own centre by a jittered tilt."""
    lo, hi = bounds([ob])
    c = (lo + hi) / 2.0
    ax = Vector((kit._jit(seed, 11) - 0.5, kit._jit(seed, 12) - 0.5, 0.0))
    if ax.length < 1e-6:
        ax = Vector((1.0, 0.0, 0.0))
    ang = math.radians(max_deg * (0.4 + 0.6 * kit._jit(seed, 13)))
    m = Matrix.Translation(c) @ Matrix.Rotation(ang, 4, ax.normalized()) @ Matrix.Translation(-c)
    transform(ob, m)
    lo, _ = bounds([ob])
    if lo.z < 0.0:
        transform(ob, Matrix.Translation((0.0, 0.0, -lo.z)))


# --------------------------------------------------------------------------
# T-wall
# --------------------------------------------------------------------------

H_TW = 3.0          # the lead's ruling (3.6 asked first)
FOOT_D = 1.2
FOOT_T = 0.30
STEM_B = 0.15       # half thickness at the haunch
STEM_T = 0.11       # half thickness at the top
HAUNCH_Z = 0.52
SECTION_W = 1.47    # two per tile, a 30 mm joint
X_CENTRES = (-0.75, 0.75)


def tw_half_thickness(z):
    return STEM_B + (STEM_T - STEM_B) * (z - HAUNCH_Z) / (H_TW - 0.04 - HAUNCH_Z)


def tw_profile(top=H_TW):
    f = FOOT_D / 2.0
    p = [(-f, 0.0), (f, 0.0), (f, FOOT_T - 0.06), (f - 0.03, FOOT_T),
         (0.30, FOOT_T), (STEM_B, HAUNCH_Z)]
    if top >= H_TW - 1e-6:
        p += [(STEM_T, H_TW - 0.04), (STEM_T - 0.03, H_TW), (-(STEM_T - 0.03), H_TW), (-STEM_T, H_TW - 0.04)]
    else:
        t = tw_half_thickness(top)
        p += [(t, top), (-t, top)]
    p += [(-STEM_B, HAUNCH_Z), (-0.30, FOOT_T), (-(f - 0.03), FOOT_T), (-f, FOOT_T - 0.06)]
    return p


def tw_stem_slab(name, z0, z1, x0, x1):
    """The stem alone between z0 and z1 (the snapped top of a wreck)."""
    p = [(-tw_half_thickness(z0), z0), (tw_half_thickness(z0), z0),
         (tw_half_thickness(z1), z1), (-tw_half_thickness(z1), z1)]
    return extrude_profile(name, p, x0, x1, "wall")


def tw_dressing(k, cx, z_top=H_TW):
    """Loops, rust bleed and form-tie dimples for one section."""
    parts = []
    for j, ex in enumerate((-0.40, 0.40)):
        if z_top >= H_TW - 1e-6:
            parts.append(torus(f"tw_loop_{k}_{j}", (cx + ex, 0.0, H_TW - 0.005), 0.075, 0.014))
        # Rust bleed on both faces under each loop: a tapering streak 0.05 m
        # proud by 4 mm, following the stem's taper.
        for side in (-1.0, 1.0):
            za, zb = max(HAUNCH_Z + 0.2, z_top - 0.65 - 0.25 * kit._jit(k, j, side > 0)), min(z_top - 0.03, H_TW - 0.05)
            if zb <= za:
                continue
            w0, w1 = 0.022, 0.034
            ya = side * (tw_half_thickness(za) + 0.004)
            yb = side * (tw_half_thickness(zb) + 0.004)
            pts = [(cx + ex - w0, ya, za), (cx + ex + w0, ya, za), (cx + ex + w1, yb, zb), (cx + ex - w1, yb, zb)]
            if side < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            parts.append(quad(f"tw_rust_{k}_{j}_{int(side)}", pts, "rust"))
    # Form-tie dimples: a 3 x 2 grid of 40 mm squares on each face.
    for side in (-1.0, 1.0):
        for a, zt in enumerate((0.95, 1.85, 2.65)):
            if zt > z_top - 0.1:
                continue
            for b, xt in enumerate((-0.45, 0.45)):
                y = side * (tw_half_thickness(zt) + 0.003)
                s = 0.02
                pts = [(cx + xt - s, y, zt - s), (cx + xt + s, y, zt - s), (cx + xt + s, y, zt + s), (cx + xt - s, y, zt + s)]
                if side < 0:
                    pts = [pts[1], pts[0], pts[3], pts[2]]
                parts.append(quad(f"tw_tie_{k}_{a}_{b}_{int(side)}", pts, "metal"))
    return parts


def build_t_wall(state):
    parts = []
    for k, cx in enumerate(X_CENTRES):
        x0, x1 = cx - SECTION_W / 2.0, cx + SECTION_W / 2.0
        if state == "idle" or k == 0:
            sec = extrude_profile(f"tw_section_{k}", tw_profile(), x0, x1, "wall")
            dress = tw_dressing(k, cx)
            group = [sec] + dress
            if state == "wreck":
                # The survivor leans 4 deg back about its rear foot edge.
                piv = Vector((cx, FOOT_D / 2.0, 0.0))
                m = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-4.0), 4, "X") @ Matrix.Translation(-piv)
                for o in group:
                    transform(o, m)
            parts += group
            continue
        # The broken section: a stub to 1.6 m, tilted 7 deg forward, ...
        snap = 1.6
        stub = extrude_profile(f"tw_stub_{k}", tw_profile(top=snap), x0, x1, "wall")
        stub_parts = [stub] + tw_dressing(k, cx, z_top=snap)
        for r in range(5):
            rx = x0 + 0.15 + (SECTION_W - 0.3) * (r + 0.5) / 5
            stub_parts.append(kit.box(f"tw_rebar_{k}_{r}", (0.016, 0.016, 0.22 + 0.15 * kit._jit(r, 7)),
                                      (rx, 0.0, snap + 0.1), "rust"))
        piv = Vector((cx, -FOOT_D / 2.0, 0.0))
        m = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(7.0), 4, "X") @ Matrix.Translation(-piv)
        for o in stub_parts:
            transform(o, m)
        parts += stub_parts
        # ... and its top 1.4 m lying face-down in front, on the foot's edge.
        slab = tw_stem_slab(f"tw_fallen_{k}", snap, H_TW, x0 + 0.05, x1 - 0.05)
        loops = [torus(f"tw_floop_{k}_{j}", (cx + ex, 0.0, H_TW - 0.005), 0.075, 0.014) for j, ex in enumerate((-0.4, 0.4))]
        # +86 deg about X lays the slab's top toward -Y, the camera's side,
        # resting on the foot's front edge and reaching to the tile's edge.
        lie = (Matrix.Translation((0.0, -0.10, 0.16)) @ Matrix.Rotation(math.radians(86.0), 4, "X")
               @ Matrix.Translation((0.0, 0.0, -snap)))
        yaw = Matrix.Translation((cx, 0.0, 0.0)) @ Matrix.Rotation(math.radians(-5.0), 4, "Z") @ Matrix.Translation((-cx, 0.0, 0.0))
        for o in [slab] + loops:
            transform(o, yaw @ lie)
        parts += [slab] + loops
        for r in range(9):
            sz = 0.08 + 0.10 * kit._jit(r, 21)
            parts.append(kit.box(f"tw_rubble_{r}", (sz, sz * 0.8, sz * 0.6),
                                 (x0 + SECTION_W * kit._jit(r, 22), -0.2 - 1.1 * kit._jit(r, 23), sz * 0.3), "wall"))
    return parts


# --------------------------------------------------------------------------
# sandbags
# --------------------------------------------------------------------------

def lay_run(label, x0, x1, y, z, offset, seed, full_len=BAG[0] + 0.02):
    """Stretchers along x from x0 to x1 at (y, z). `offset` courses start with
    a half bag so the bond breaks joints, and the ends stay inside [x0, x1]."""
    out = []
    length = x1 - x0
    n = max(1, int(round(length / full_len)))
    step = length / n
    starts = []
    if offset:
        starts.append((x0, x0 + step / 2.0))
        for i in range(n - 1):
            starts.append((x0 + step / 2.0 + i * step, x0 + step / 2.0 + (i + 1) * step))
        starts.append((x1 - step / 2.0, x1))
    else:
        starts = [(x0 + i * step, x0 + (i + 1) * step) for i in range(n)]
    for i, (a, b) in enumerate(starts):
        L = (b - a) - 0.02
        bag = kit.sandbag(f"{label}_{i}", ((a + b) / 2.0, y, z), 0.0, "wood",
                          (L, BAG[1], BAG[2]), seed=seed * 101 + i)
        out.append(bag)
    return out


def lay_headers(label, x0, x1, y, z, seed):
    out = []
    n = max(1, int(round((x1 - x0) / (BAG[1] + 0.01))))
    step = (x1 - x0) / n
    for i in range(n):
        out.append(kit.sandbag(f"{label}_{i}", (x0 + step * (i + 0.5), y, z), math.pi / 2, "wood",
                               (BAG[0], step - 0.01, BAG[2]), seed=seed * 101 + i))
    return out


#: The wall's courses, bottom up: (kind, rows' y offsets). Two bags deep for
#: the first four (headers on 1 and 3 tie the two rows), one above.
WALL_COURSES = [
    ("str", (-0.18, 0.18)), ("hdr", (0.0,)), ("str", (-0.18, 0.18)), ("hdr", (0.0,)),
    ("str", (0.0,)), ("str", (0.0,)), ("str", (0.0,)),
]


def build_sandbag_wall(state):
    parts = []
    if state != "wreck":
        for c, (kind, rows) in enumerate(WALL_COURSES):
            z = c * COURSE
            if kind == "hdr":
                parts += lay_headers(f"sw_{c}", -HALF, HALF, 0.0, z, seed=c + 1)
            else:
                for r, y in enumerate(rows):
                    parts += lay_run(f"sw_{c}_{r}", -HALF, HALF, y, z, offset=(c // 2 + r) % 2 == 1, seed=c * 7 + r + 1)
    else:
        for c, (kind, rows) in enumerate(WALL_COURSES[:2]):
            z = c * COURSE
            if kind == "hdr":
                parts += lay_headers(f"sw_{c}", -HALF, HALF, 0.0, z, seed=c + 31)
            else:
                for r, y in enumerate(rows):
                    parts += lay_run(f"sw_{c}_{r}", -HALF, HALF, y, z, offset=r % 2 == 1, seed=c * 7 + r + 31)
        parts += spill("sw_spill", 14, (-1.3, 1.3), (-1.2, 1.2), 0.3, seed=61)
    return parts


def spill(label, n, xr, yr, keep_out, seed):
    """Bags thrown down on the ground in the box xr x yr, clear of |y| <
    keep_out (the standing courses), tilted."""
    out = []
    for i in range(n):
        x = xr[0] + (xr[1] - xr[0]) * kit._jit(seed, i, 1)
        side = -1.0 if kit._jit(seed, i, 2) < 0.6 else 1.0  # more of it toward the camera
        y = side * (keep_out + (max(abs(yr[0]), abs(yr[1])) - keep_out) * kit._jit(seed, i, 3))
        b = kit.sandbag(f"{label}_{i}", (x, y, 0.0), math.pi * kit._jit(seed, i, 4), "wood", seed=seed * 131 + i)
        tilt_bag(b, seed * 17 + i, 25.0)
        out.append(b)
    return out


# The post's U path, before the -45 deg turn: an arc of radius R about
# (CX, 0) facing +X, and two arms running back to ARM_X.
R_POST = 0.85
CX_POST = 0.10
ARM_X = -0.55
POST_YAW = math.radians(-45.0)


def u_length():
    return 2 * (CX_POST - ARM_X) + math.pi * R_POST


def u_at(s, d=0.0):
    """Point and tangent angle on the U at arc length s (0 = the -y arm's
    open end), offset d outward from the centreline."""
    arm = CX_POST - ARM_X
    if s <= arm:
        return Vector((ARM_X + s, -(R_POST + d), 0.0)), 0.0
    s -= arm
    arc = math.pi * R_POST
    if s <= arc:
        a = -math.pi / 2 + s / R_POST
        p = Vector((CX_POST + (R_POST + d) * math.cos(a), (R_POST + d) * math.sin(a), 0.0))
        return p, a + math.pi / 2
    s -= arc
    return Vector((CX_POST - s, R_POST + d, 0.0)), math.pi


def front_angle(p):
    """Angle of a point about the arc centre, 0 = straight ahead (+X)."""
    return math.degrees(math.atan2(p.y, p.x - CX_POST))


#: The post's courses: (kind, outward row offsets).
POST_COURSES = [
    ("str", (-0.17, 0.17)), ("hdr", (0.0,)), ("str", (-0.17, 0.17)), ("hdr", (0.0,)),
    ("str", (0.0,)), ("str", (0.0,)), ("str", (0.0,)),
]
APERTURE_DEG = 13.0
APERTURE_COURSES = (5, 6)


def build_sandbag_post(state):
    parts = []
    L = u_length()
    wreck = state == "wreck"
    for c, (kind, rows) in enumerate(POST_COURSES):
        z = c * COURSE
        if wreck and c >= 2:
            break
        if kind == "hdr":
            n = int(round(L / (BAG[1] + 0.01)))
            for i in range(n):
                p, t = u_at(L * (i + 0.5) / n)
                if wreck and abs(front_angle(p)) < 40 and c >= 1:
                    continue
                parts.append(kit.sandbag(f"sp_{c}_{i}", (p.x, p.y, z), t + math.pi / 2, "wood",
                                         (BAG[0], L / n - 0.01, BAG[2]), seed=c * 1000 + i))
            continue
        for r, d in enumerate(rows):
            row_len = L + math.pi * d
            n = max(1, int(round(row_len / (BAG[0] + 0.02))))
            off = 0.5 if (c // 2 + r) % 2 else 0.0
            for i in range(n):
                s = L * min(max((i + 0.5 + off) / n, 0.0), 1.0)
                if off and i == n - 1:
                    continue  # the offset course runs one short; the U's ends are open
                p, t = u_at(s, d)
                fa = front_angle(p)
                if c in APERTURE_COURSES and abs(fa) < APERTURE_DEG and p.x > CX_POST:
                    continue
                if wreck and abs(fa) < 40 and c >= 1 and p.x > CX_POST:
                    continue
                parts.append(kit.sandbag(f"sp_{c}_{r}_{i}", (p.x, p.y, z), t, "wood",
                                         (row_len / n - 0.02, BAG[1], BAG[2]), seed=c * 1000 + r * 100 + i))
    if not wreck:
        # The aperture's pane: dark, set back at the inner face, facing out.
        r_in = R_POST - 0.05
        z0, z1 = APERTURE_COURSES[0] * COURSE, (APERTURE_COURSES[-1] + 1) * COURSE
        w = math.tan(math.radians(APERTURE_DEG * 0.8)) * r_in
        x = CX_POST + r_in
        # Wound so its normal is +X (outward): the facing gate counts a pane
        # by the side its FRONT face shows to, and wound the other way it
        # read 113 px on the hidden half and 0 on the camera half.
        parts.append(quad("sp_aperture", [(x, -w, z0), (x, w, z0), (x, w, z1), (x, -w, z1)], "glass"))
        # Three loose bags at the entrance.
        for i in range(3):
            b = kit.sandbag(f"sp_loose_{i}", (ARM_X - 0.15 - 0.1 * i, -0.35 + 0.35 * i, 0.0),
                            math.pi * (0.3 + 0.4 * kit._jit(i, 41)), "wood", seed=900 + i)
            tilt_bag(b, 900 + i, 12.0)
            parts.append(b)
    else:
        # The front thrown forward and out: a spill beyond the breach.
        for i in range(16):
            a = math.radians(-50 + 100 * kit._jit(i, 51))
            r = R_POST + 0.25 + 0.45 * kit._jit(i, 52)
            b = kit.sandbag(f"sp_spill_{i}", (CX_POST + r * math.cos(a), r * math.sin(a), 0.0),
                            math.pi * kit._jit(i, 53), "wood", seed=950 + i)
            tilt_bag(b, 950 + i, 30.0)
            parts.append(b)
    turn = Matrix.Rotation(POST_YAW, 4, "Z")
    for o in parts:
        transform(o, turn)
    return parts


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

BUILDERS = {
    "t_wall": ("T-wall segment", build_t_wall, OUT_T_WALL, OUT_T_WALL_WRECK, SRC_T_WALL),
    "sandbag_wall": ("Sandbag wall segment", build_sandbag_wall, OUT_SANDBAG_WALL, OUT_SANDBAG_WALL_WRECK, SRC_SANDBAG_WALL),
    "sandbag_post": ("Sandbag post", build_sandbag_post, OUT_SANDBAG_POST, OUT_SANDBAG_POST_WRECK, SRC_SANDBAG_POST),
}


def join_by_role(objs):
    by = {}
    for o in objs:
        role = o.get("rl_role")
        if role not in kit.ROLES:
            raise SystemExit(f"{o.name}: missing or unknown rl_role {role!r}")
        by.setdefault(role, []).append(o)
    out = {}
    for role, group in by.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group) > 1:
            bpy.ops.object.join()
        m = bpy.context.view_layer.objects.active
        m.name = m.data.name = role
        m["rl_role"] = role
        out[role] = m
    return out


def export_state(bid, state):
    name, build, out_idle, out_wreck, src = BUILDERS[bid]
    kit.new_scene()
    parts = build(state)
    lo, hi = bounds(parts)
    if state == "wreck" and lo.z < 0.0:
        # A leaning or toppled piece swings a corner under the ground; seat
        # the whole wreck on it rather than bury that corner.
        for o in parts:
            transform(o, Matrix.Translation((0.0, 0.0, -lo.z)))
        lo, hi = bounds(parts)
    if lo.z < -1e-4:
        raise SystemExit(f"[{bid} {state}] geometry under the ground: z {lo.z:.4f}")
    if state == "idle" and (lo.x < -HALF - 1e-3 or hi.x > HALF + 1e-3 or lo.y < -HALF - 1e-3 or hi.y > HALF + 1e-3):
        raise SystemExit(f"[{bid}] standing mesh leaves its tile: x[{lo.x:.3f},{hi.x:.3f}] y[{lo.y:.3f},{hi.y:.3f}]")
    merged = join_by_role(parts)
    for o in merged.values():
        o.data.materials.clear()
    t = tris(merged.values())
    if t > TRI_CAP[bid]:
        raise SystemExit(f"[{bid} {state}] {t} triangles over the cap {TRI_CAP[bid]}")
    if state == "idle":
        kit.save(src)
    path = out_idle if state == "idle" else out_wreck
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=False, export_apply=True,
        export_yup=True, export_skins=False, export_animations=False, export_extras=True,
        export_materials="NONE", export_copyright=CREDIT.format(name=name),
    )
    lo, hi = bounds(list(merged.values()))
    print(f"[{bid}{'' if state == 'idle' else '_wreck'}] wrote {os.path.relpath(path, REPO)}: {t} tris, "
          f"roles {sorted(merged)}, x[{lo.x:+.2f},{hi.x:+.2f}] y[{lo.y:+.2f},{hi.y:+.2f}] z[{lo.z:+.2f},{hi.z:+.2f}], "
          f"{os.path.getsize(path)} bytes")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    want = list(BUILDERS) if not argv or argv == ["all"] else argv
    for bid in want:
        if bid not in BUILDERS:
            raise SystemExit(f"unknown barrier {bid!r}; known: {sorted(BUILDERS)}")
        export_state(bid, "idle")
        export_state(bid, "wreck")
