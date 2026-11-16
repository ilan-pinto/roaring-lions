"""The v7 kit parts fitted to the Meshy Rifle Squad (GH-746 / GH-826). Blender only.

`inf_kit.build` swaps a part's procedural builder for the one here when `kp.TEAM.v7` is set (the Rifle Squad). Each builder
keeps the signature `(f, side) -> Piece` and REUSES the procedural builder's own anchor maths (the weapon frame and rail,
the helmet front, the belt wrap, the pouch clearing turn), swapping only the geometry: the approved part from
`art/parts/inf_kit/v7/<part>.glb` placed by `inf_kit_mesh`. The parts not in v7 (helmet cover, yoke, foregrip, the two
whips) stay procedural.

Soft goods on the skinned torso (carrier, belt) are scaled per axis to THIS figure's own ring and pushed out of the body
to a clearance; the throat and the groin hang from the FITTED carrier (its collar and its hem) and are checked not to
cross it; pouches and the radio stand on the fitted belt / carrier / body by their back faces.
Every vertex stays rigid on the row's one bone (weight 1), every UV is pinned to the row's texel: no material, no texture.
"""
import math

import numpy as np
from mathutils import Matrix, Vector

import inf_kit as ik
import inf_kit_geo as geo
import inf_kit_mesh as km
import inf_kit_parts as kp
from inf_kit_geo import Piece

# ------------------------------------------------------------ constants

CARRIER_TOP, CARRIER_BOT = 1.42, 1.055       # the procedural carrier's rows (CARRIER_ROWS[-1], [0]): collar and hem
CARRIER_NATIVE = (0.2189, 0.2653, 0.4197)    # the part's size (x, y, z)
CARRIER_PLATE = 0.022                        # the plate standoff the spec states (PLATE_OFF)
BODY_CLEAR = 0.006                           # nothing of the carrier within this of the body
BELT_THICK = 0.012                           # the belt's padded thickness (the procedural belt's middle-row offset)
BELT_CLEAR = 0.003
BELT_NATIVE = (0.285, 0.356, 0.0544)
BELT_Z = 0.9125
GAP = 0.001                                  # a placed rigid piece stands this far off the surface it sits on
LENS_DEG = 25.0                              # a face whose normal is within this of the bore, at the extreme end, is glass
UP = (0.0, 0.0, 1.0)


def _cache(f):
    return f.__dict__.setdefault("_v7", {})


def _stats(f, **kw):
    ik.REPORT.append({"part": "v7", "figure": f.prefix, **kw})


# ------------------------------------------------------------ piece making

def lens_faces(V, T, ends):
    """Per face: True when its normal is within LENS_DEG of the bore axis ('+' front, '-' rear) and it sits at that end of the part."""
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    n = np.cross(b - a, c - a)
    ln = np.linalg.norm(n, axis=1)
    n = n / np.maximum(ln, 1e-12)[:, None]
    cen = (a + b + c) / 3.0
    cs = math.cos(math.radians(LENS_DEG))
    out = np.zeros(len(T), bool)
    if "+" in ends:
        out |= (n[:, 0] > cs) & (cen[:, 0] > V[:, 0].max() - 0.006)
    if "-" in ends:
        out |= (n[:, 0] < -cs) & (cen[:, 0] < V[:, 0].min() + 0.006)
    return out


def add_mesh(pc, W, T, tex, glass=None):
    """The world vertices `W` and triangles `T` into `pc`, source winding kept, one texel (`glass` faces the glass texel)."""
    for i, t in enumerate(T):
        pc.face([W[t[0]], W[t[1]], W[t[2]]], "glass" if glass is not None and glass[i] else tex, hint=2)


def count_faces(pc):
    return len(pc.bm.faces)


# ------------------------------------------------------------ the fitted soft goods

def spine_only_zone(f):
    """A BVH of the trunk's own skin: triangles whose three vertices are spine-dominant AND carry no arm weight (upper arm, forearm,
    hand: under 2%). The Meshy figure's upper arms are welded to the ribs, so the plain spine zone (and the ring a wrap reads off
    it) includes the shoulder weld and its shards; this one is the ribcage and the vest Meshy sculpted on it (GH-746 fix round)."""
    c = _cache(f)
    if "spine_zone" not in c:
        W = f.W
        armw = sum(W[f"{f.prefix}_{b}"] for b in ("upperarm_L", "upperarm_R", "forearm_L", "forearm_R", "hand_L", "hand_R"))
        ok = (f.dom == f"{f.prefix}_spine") & (armw < 0.02) & f.mine
        t = f.tris[ok[f.tris].all(1)]
        c["spine_zone"] = geo.bvh_from(f.co, t)
    return c["spine_zone"]


def _carrier_ring(f):
    wr = ik.torso_wrap(f, [f.tz(r) for r in ik.CARRIER_ROWS], 16, fill_below=f.tz(1.24), zone=spine_only_zone(f))
    wr.sample()
    return wr


def _median_radii(wr, rows, ks, clamp=None):
    """The ring's radius at each column of `ks`: the median over `rows` and a window of columns round it that widens until it
    holds a value the sampler really measured. `clamp` = (rmin, rmax) of the wrap's `rlim`: a radius AT a limit is the limit, not
    a measurement (f0's belt read 0.12 at its front for want of a ray that hit, and the belt came out 312 mm deep against 431 and
    465 on f1 and f2: the fix round, 9 Nov)."""
    n = len(wr.cols)
    out = []
    for k in ks:
        val = None
        for half in range(0, n // 4 + 1):
            vals = []
            for j in rows:
                for dk in range(-half, half + 1):
                    r = wr.R[j][(k + dk) % n]
                    if r is None or (clamp is not None and (abs(r - clamp[0]) < 1e-6 or abs(r - clamp[1]) < 1e-6)):
                        continue
                    vals.append(r)
            if vals:
                val = float(np.median(vals))
                break
        out.append(val)
    return out


def carrier_fit(f):
    """(vertices, triangles, bvh) of the carrier fitted to this figure at rest, in world coordinates."""
    c = _cache(f)
    if "carrier" in c:
        return c["carrier"]
    wr = _carrier_ring(f)
    rows = range(1, len(wr.rows_t) - 1)            # the 1.12 .. 1.34 rows: the plate's zone
    rf, rb, rl, rr = _median_radii(wr, rows, (0, 8, 4, 12))
    V0, T = km.source("carrier")
    nx, ny, nz = CARRIER_NATIVE
    sx = (rf + rb + 2 * CARRIER_PLATE) / nx
    sy = (rl + rr + 2 * 0.010) / ny
    sz = (f.tz(CARRIER_TOP) - f.tz(CARRIER_BOT)) / nz
    cen = wr.centre(f.tz(1.24))
    origin = np.array([cen.x + (rf - rb) / 2.0, cen.y + (rl - rr) / 2.0, f.tz(CARRIER_TOP)])
    V = km.place(V0, origin, (1, 0, 0), UP, (sx, sy, sz))
    V, st = km.ring_fit(wr, V, T, BODY_CLEAR)
    bvh = geo.bvh_from(V, T)
    c["carrier_hull"] = (V, T, bvh)          # the uncut shell: what the parts hung on it stand on (a hole is not a surface)
    _stats(f, name="carrier", body_depth_mm=round(1000 * (rf + rb), 1), body_width_mm=round(1000 * (rl + rr), 1),
           scale=[round(sx, 3), round(sy, 3), round(sz, 3)], origin=[round(float(x), 4) for x in origin], **st)
    if kp.TEAM.carrier_trim:
        V, T, ts = _carrier_trim(f, V, T, (float(cen.x), float(cen.y)), kp.TEAM.carrier_trim)
        _stats(f, name="carrier_trim", **ts)
        bvh = geo.bvh_from(V, T)
    c["carrier"] = (V, T, bvh)
    return c["carrier"]


def _carrier_trim(f, V, T, cen, cfg):
    """A team's `carrier_trim`: the fitted shell is cut to a plate carrier's own outline (round 3, GH-826).

    The v7 shell is a vest: its walls run up to the collar all the way round, and they are scaled per axis to the ring of the
    trunk's own skin and only ever pushed OUT of it. Where this body is narrower than the scaled part the wall stands in the
    air: on the Combat Engineers the back's upper corners and the rear lips of both armholes (|y| 0.15-0.17 m off the centre
    line, from 0.18 m under the collar up) stood 60-96 mm off the body AT REST (the aimed clips add under 20 mm), a hollow wing
    the hanging arm hides and the raised arm of every aimed clip opens to a camera behind the man; and an upper arm comes
    within 12 mm of the front's upper corners and of the armholes' lower lips. A real plate carrier is a plate bag front and
    back, no wider than its plate, on a cummerbund that passes UNDER the arm. So above `drop` under the collar the wall is
    kept only within `half_w` of the centre line (a SAPI plate is 0.24-0.28 m wide), the inner corner clipped by `corner`:
    three straight lines a side, the same front and back. A triangle a line crosses is clipped on it, not dropped whole.
    The cut is left OPEN: the part is a solid (an outer and an inner wall) with T-junctions at its straps, the outline falls
    into some sixty open chains (two clean loops), and a cap by fill or ear-clipping closed 7-27 triangles of ~440 edges
    (tried 16 Nov). So the trimmed shell is not a closed volume: `inf_kit_clash.py`'s parity test over-reads its rows.
    Returns (V', T', stats: the standoff from the man's own skin at rest before and after, and how near an upper arm comes in
    any sampled key of any living clip). The uncut shell stays what the parts hung on the carrier stand on (`carrier_hull`)."""
    n = len(V)
    d0 = np.array([f.zone_all.find_nearest(Vector(p))[3] for p in V])
    yc = 0.5 * (float(V[:, 1].min()) + float(V[:, 1].max()))
    zc = float(V[:, 2].max()) - cfg["drop"]
    a_ = np.abs(V[:, 1] - yc) - cfg["half_w"]; b_ = V[:, 2] - zc
    s = np.maximum(np.maximum(-a_, -b_), cfg["corner"] - a_ - b_)
    s = np.where(np.abs(s) < 1e-6, 1e-6, s)
    cut = s <= 0.0

    def arm_near(P):
        lo = P.min(0) - 0.05; hi = P.max(0) + 0.05
        pts, who = f.bank.blockers(f.prefix, "spine", lo, hi)
        arm = np.array([str(w).startswith("upperarm") for w in who], bool)
        if not arm.any():
            return np.full(len(P), 9.0)
        from mathutils.kdtree import KDTree
        A = pts[arm]; kd = KDTree(len(A))
        for i, q in enumerate(A):
            kd.insert(q, i)
        kd.balance()
        return np.array([kd.find(Vector(p))[2] for p in P])
    da = arm_near(V)
    Vn = [tuple(p) for p in V]; onedge = {}; newrim = set()
    # clip every triangle on the outline s = 0

    def mid(i, j):
        k = (min(i, j), max(i, j))
        if k not in onedge:
            t_ = s[i] / (s[i] - s[j])
            Vn.append(tuple(V[i] + (V[j] - V[i]) * t_)); onedge[k] = len(Vn) - 1; newrim.add(len(Vn) - 1)
        return onedge[k]
    Tn = []
    for t in T:
        keep = [s[i] > 0 for i in t]
        if all(keep):
            Tn.append(tuple(t))
        elif any(keep):
            for r in range(3):
                a_, b_, c_ = t[r], t[(r + 1) % 3], t[(r + 2) % 3]
                if keep[r] and not keep[(r + 1) % 3] and not keep[(r + 2) % 3]:
                    Tn.append((a_, mid(a_, b_), mid(a_, c_)))
                elif keep[r] and keep[(r + 1) % 3] and not keep[(r + 2) % 3]:
                    mb, ma = mid(b_, c_), mid(a_, c_)
                    Tn.append((a_, b_, mb)); Tn.append((a_, mb, ma))
    Vn = np.array(Vn); Tn = np.array(Tn, int)
    used = np.unique(Tn)
    remap = np.full(len(Vn), -1); remap[used] = np.arange(len(used))
    Vn = Vn[used]; Tn = remap[Tn]
    area = lambda V_, T_: float(0.5 * np.linalg.norm(np.cross(V_[T_[:, 1]] - V_[T_[:, 0]], V_[T_[:, 2]] - V_[T_[:, 0]]), axis=1).sum())  # noqa: E731
    d1 = np.array([f.zone_all.find_nearest(Vector(p))[3] for p in Vn])
    da1 = arm_near(Vn)
    q3 = lambda d: [round(1000 * float(np.median(d)), 1), round(1000 * float(np.percentile(d, 90)), 1), round(1000 * float(d.max()), 1)]  # noqa: E731
    stats = {"vertices_cut": int(cut.sum()), "triangles": [int(len(T)), int(len(Tn))],
             "area_cm2": [round(1e4 * area(V, T), 1), round(1e4 * area(Vn, Tn), 1)],
             "rest_standoff_mm_before": q3(d0), "rest_standoff_mm_after": q3(d1),
             "over_35mm_before_after": [int((d0 > 0.035).sum()), int((d1 > 0.035).sum())],
             "upper_arm_within_12mm_before_after": [int((da < 0.012).sum()), int((da1 < 0.012).sum())]}
    print(f"[inf_kit] R3 {f.prefix}: carrier trim {stats}", flush=True)
    return Vn, Tn, stats


def carrier_hull(f):
    """(vertices, triangles, bvh) of the fitted carrier BEFORE its limb openings are cut: the surface throat, groin and radio stand on."""
    carrier_fit(f)
    return _cache(f)["carrier_hull"]


def belt_fit(f):
    c = _cache(f)
    if "belt" in c:
        return c["belt"]
    wr = ik._belt_wrap(f, [0.885 + f.belt_dz, 0.9125 + f.belt_dz, 0.94 + f.belt_dz], 16)
    wr.sample()
    rf, rb, rl, rr = _median_radii(wr, (0, 1, 2), (0, 8, 4, 12), clamp=(0.12, 0.26))
    V0, T = km.source("battle_belt")
    nx, ny, _nz = BELT_NATIVE
    sx = (rf + rb + 2 * BELT_THICK) / nx
    sy = (rl + rr + 2 * BELT_THICK) / ny
    origin = np.array([f.O[0] + f.belt_c[0] + (rf - rb) / 2.0, f.O[1] + f.belt_c[1] + (rl - rr) / 2.0, BELT_Z + f.belt_dz])
    V = km.place(V0, origin, (1, 0, 0), UP, (sx, sy, 1.0))
    V, st = km.ring_fit(wr, V, T, BELT_CLEAR)
    bvh = geo.bvh_from(V, T)
    _stats(f, name="battle_belt", body_depth_mm=round(1000 * (rf + rb), 1), body_width_mm=round(1000 * (rl + rr), 1),
           scale=[round(sx, 3), round(sy, 3), 1.0], **st)
    c["belt"] = (V, T, bvh)
    return c["belt"]


def v7_carrier(f, side=None):
    V, T, _bvh = carrier_fit(f)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote")
    return pc


def v7_battle_belt(f, side=None):
    V, T, _bvh = belt_fit(f)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote_shade")
    return pc


def _front_frame(f, bvhs, y, z, du=0.04, dv=0.04):
    """(point on the outermost surface at height z, abeam y, outward normal) from the +X side."""
    p = np.array([f.O[0], y, z])
    return km.surf_frame(bvhs, p, (-1, 0, 0), du, dv)


def _centre_xy(f):
    cen = _carrier_ring(f).centre(f.tz(1.24))
    return float(cen.x), float(cen.y)


def _unbend(V0, c):
    """Flatten a curved hanging plate (its inner face a parabola x = -c y^2 about its centre) onto a plane: the carrier's
    front is a plate, and a plate bent round a torso would cross it at both edges (ruling, 9 Nov)."""
    V = V0.copy()
    V[:, 0] += c * V[:, 1] ** 2
    return V


PLATE_MAX_TILT_DEG = 20.0   # a hanging plate's thin axis stands within this of horizontal (its long face of vertical)
FORWARD = np.array([1.0, 0.0, 0.0])    # a figure's front in the bind frame (the wraps' own 0 degrees)


def thin_axis_tilt_deg(V):
    """Angle of a plate's THIN axis (the smallest principal axis of its placed vertices) from horizontal: 0 = hangs vertically."""
    X = np.asarray(V, dtype=float)
    X = X - X.mean(0)
    w, vec = np.linalg.eigh(X.T @ X)
    axis = vec[:, 0]
    return math.degrees(math.asin(min(1.0, abs(float(axis[2])))))


def assert_hangs(name, f, V, min_height, limit=PLATE_MAX_TILT_DEG):
    """Export-time refusal on the PLACED geometry (review 10 Nov: the first assert read a normal one line after it was levelled,
    so it read 0 by construction). A throat or groin whose placed thin axis is more than `limit` degrees off horizontal, or
    which hangs less than `min_height` tall, is a plate lying down (the first v7 fit: 78 degrees, 32 mm tall). Returns (tilt, height)."""
    t = thin_axis_tilt_deg(V)
    h = float(V[:, 2].max() - V[:, 2].min())
    if t > limit or h < min_height:
        raise ValueError(f"{f.prefix}: {name} placed with its thin axis {t:.1f} degrees off horizontal (limit {limit}) and "
                         f"{1000 * h:.0f} mm tall (minimum {1000 * min_height:.0f}): it lies down; its frame came from a tilted normal")
    return t, h


def overlap_pairs(V, T, bvhs):
    """Triangle pairs of the placed plate (both faces, every triangle) that cross any of `bvhs`."""
    b = geo.bvh_from(V, T)
    return sum(len(b.overlap(o)) for o in bvhs)


def throat_fit(f):
    """(vertices, triangles) of the placed throat. Hangs from the fitted carrier's collar, facing FORWARD (the carrier front's own
    normal is yawed by the Meshy sculpt: f1's was 6.6 degrees), its inner face 2.5 mm off the carrier's front AT THE COLLAR (the
    wave-3 plate stood a median 36-50 mm off it); moved out in 1 mm steps only until no triangle of it crosses the carrier.
    `assert_hangs` is a regression guard here: the frame is the constant FORWARD, so the tilt moves only if the part or this code does."""
    c = _cache(f)
    if "throat" in c:
        return c["throat"]
    cv, _ct, cb = carrier_hull(f)
    cx, cy = _centre_xy(f)
    sel = (np.abs(cv[:, 1] - cy) < 0.04) & (cv[:, 0] > cx)
    ztop = float(cv[sel, 2].max())
    V0, T = km.source("throat_protector")
    hit, _n = _front_frame(f, [cb], cy, ztop - 0.02)
    if hit is None:
        raise ValueError(f"{f.prefix}: the throat found no carrier front at the collar")
    n = FORWARD
    origin = np.array([hit[0] + THROAT_GAP, hit[1], ztop - 0.004])      # the plate hangs from the collar along -z
    V0 = _unbend(V0, 0.0298 / 0.0983 ** 2)
    # The carrier's front stands ahead of its collar below it, so a plumb plate touching at the collar crosses it lower down. The plate
    # leans out at the bottom, up to 19 degrees (inside assert_hangs' 20), and the lean with the SMALLEST outward shift wins (ties: the
    # smaller lean). Lean 0 is searched too.
    best = None
    for deg in range(0, 20):
        t = math.radians(deg)
        x = n * math.cos(t) + np.array(UP) * math.sin(t)
        base = km.place(V0, origin - x * 0.0005, x, UP)
        shift = 0.0
        while overlap_pairs(base + n * shift, T, [cb]) and shift < 0.08:
            shift += 0.001
        if overlap_pairs(base + n * shift, T, [cb]) == 0 and (best is None or shift < best[0] - 1e-9):
            best = (shift, deg, base)
    if best is None:
        raise ValueError(f"{f.prefix}: the throat clears the carrier at no lean under 20 degrees and 80 mm")
    shift, lean, base = best
    V = base + n * shift
    pairs = overlap_pairs(V, T, [cb])
    if pairs:
        raise ValueError(f"{f.prefix}: the throat still crosses the carrier in {pairs} triangle pairs at {1000 * shift:.0f} mm")
    tilt, h = assert_hangs("throat", f, V, 0.09)
    inner = V0[:, 0] < 0.004
    g = km.outer_gap([cb], V, n)
    gi = g[inner & ~np.isnan(g)]
    _stats(f, name="throat", collar_z=round(ztop, 4), lean_deg=lean, shift_mm=round(1000 * shift, 2), thin_axis_deg=round(tilt, 1), z_span_mm=round(1000 * h, 1),
           carrier_pairs=pairs, collar_gap_mm=round(1000 * float(g[inner & ~np.isnan(g) & (V[:, 2] > ztop - 0.03)].min()), 1) if (inner & ~np.isnan(g) & (V[:, 2] > ztop - 0.03)).any() else None,
           gap_median_mm=round(1000 * float(np.median(gi)), 1), gap_max_mm=round(1000 * float(gi.max()), 1))
    c["throat"] = (V, T)
    return c["throat"]


def v7_throat(f, side=None):
    V, T = throat_fit(f)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote")
    return pc


GROIN_BELT_GAP = 0.001    # the apron's inner face stands this far off the belt's front (was 0.0025 in wave 4; 0.001 from wave 5)
GROIN_TOP_GAP_LIMIT = 0.005   # contact: its top edge within this of the belt front at rest


def assert_groin_contact(name, f, V, T, bb, cb):
    """Export-time refusal on the PLACED apron: its top edge within GROIN_TOP_GAP_LIMIT of the belt's front, and no triangle of it
    (both faces) crossing the belt or the carrier. The wave-3 groin, hung from the hem at up to 19 degrees, stood 35-76 mm off the
    belt and touched neither: a board floating ahead of the thigh. Returns (top-edge gap m, belt pairs, carrier pairs)."""
    top = V[V[:, 2] > V[:, 2].max() - 0.003]
    gap = min(float(bb.find_nearest(Vector(p))[3]) for p in top)
    pb, pc_ = overlap_pairs(V, T, [bb]), overlap_pairs(V, T, [cb])
    if gap > GROIN_TOP_GAP_LIMIT or pb or pc_:
        raise ValueError(f"{f.prefix}: {name} top edge {1000 * gap:.1f} mm off the belt front (limit {1000 * GROIN_TOP_GAP_LIMIT:.0f}), "
                         f"{pb} triangle pairs with the belt, {pc_} with the carrier")
    return gap, pb, pc_


def groin_fit(f, V0=None):
    """The apron hangs from the BELT's front band: vertical, its top edge at the belt's top, its inner face 1 mm ahead of the belt's
    most forward point under it (the buckle; GROIN_BELT_GAP, 2.5 mm in wave 4). Hung from the carrier hem it could only float, 12 cm
    above the belt and 42-74 mm behind the belt's front (v7c review M1). No lean, no search."""
    c = _cache(f)
    if "groin" in c and V0 is None:
        return c["groin"]
    BV, _bt, bb = belt_fit(f)
    cb = carrier_hull(f)[2]
    src, T = km.source("groin_apron")
    src = src if V0 is None else V0      # the approved part's OWN curvature (36.6 mm at its edge): it wraps the curved belt
    top = float(BV[:, 2].max())
    ib = int(np.argmax(BV[:, 0]))                       # the buckle: the belt's most forward vertex
    yb = float(BV[ib, 1])
    near = (np.abs(BV[:, 1] - yb) < 0.125) & (BV[:, 2] > top - float(-src[:, 2].min()))
    x_front = float(BV[near, 0].max())
    inner = src[:, 0] < 0.004
    def hang(face):
        last = None
        for drop in (GROIN_DROP, 0.006, 0.010, 0.015, 0.020):     # a little lower under the buckle's top if the belt makes the plate stand out
            V = km.place(src, np.array([x_front + GROIN_BELT_GAP, yb, top - drop]), face, UP)
            shift = 0.0
            while overlap_pairs(V + FORWARD * shift, T, [bb, cb]) and shift < 0.05:    # the curved plate's centre can sit on the buckle: out until clear
                shift += 0.0005
            V = V + FORWARD * shift
            try:
                return (V,) + assert_groin_contact("groin", f, V, T, bb, cb)
            except ValueError as e:
                last = e
        raise last

    V, gap, pb, pc_ = hang(FORWARD)
    yaw = None
    if kp.TEAM.groin_wrap and V0 is None:
        # The apron faces the way the BELT's front faces under it. The Combat Engineers' body stands with its hips turned
        # (Meshy's low ready, the firing-side foot back), so its belt's front is not square to the figure's +X: hung square,
        # the apron touched the belt at one edge and stood 33-43 mm off it at the other (a median 21.2 mm, over the 20 mm
        # bar; two clusters, which is a turn and not a curvature). The turn is read off the hung apron itself: the slope of
        # its inner face's gap to the belt across y, top 6 cm (rays, not the belt's sparse vertices). Turned once and hung
        # again. The Rifle Squad's flag is off: its apron is placed as it shipped.
        g0 = km.outer_gap([bb], V, FORWARD)
        m0 = inner & ~np.isnan(g0) & (V[:, 2] > top - 0.06)
        if int(m0.sum()) < 12:
            raise ValueError(f"{f.prefix}: {int(m0.sum())} rays from the apron's inner face reach the belt: its turn is not measured")
        slope = float(np.polyfit(V[m0, 1] - yb, g0[m0], 1)[0])
        yaw = math.degrees(math.atan(slope))
        if abs(yaw) > 20.0:
            raise ValueError(f"{f.prefix}: the belt's front reads {yaw:.1f} degrees off the figure's front: not a turn of the hips")
        t_ = math.radians(yaw)
        V, gap, pb, pc_ = hang(np.array([math.cos(t_), math.sin(t_), 0.0]))
    tilt, h = assert_hangs("groin", f, V, GROIN_MIN_HEIGHT)
    g = km.outer_gap([bb], V, FORWARD)
    band = inner & ~np.isnan(g) & (V[:, 2] > 0.86 + f.belt_dz) & (V[:, 2] < 0.96 + f.belt_dz)
    # The bar is the OUTER EDGES' gap to the belt (lateral offset over 90 mm from the buckle), where a flattened plate stands off a
    # curving belt: 35-37 mm for wave 4's unbent apron, 9-15 mm for the approved curvature (the earlier band-median gate, 25 mm, sat
    # 1.2 mm above the measured maximum and the flattened apron passed it). Both selections REFUSE an empty set rather than read 0.0
    # and pass: no edge ray hitting the belt is the vacuous pass the 10 Nov review found.
    edge = inner & ~np.isnan(g) & (np.abs(V[:, 1] - yb) > 0.09) & (V[:, 2] > top - 0.06)
    edge_med = km.masked_median(g, edge, "the groin's outer edge set (over 90 mm from the buckle, top 6 cm)", f.prefix)
    if edge_med > GROIN_EDGE_GAP_LIMIT:
        raise ValueError(f"{f.prefix}: groin outer edges stand a median {1000 * edge_med:.1f} mm off the belt (limit {1000 * GROIN_EDGE_GAP_LIMIT:.0f}): "
                         f"a flat board on a curving belt, not an apron"
                         + ("" if yaw is None else f" (turned {yaw:.1f} deg to the belt's front; edge gaps mm "
                            f"{np.round(1000 * np.sort(g[edge]), 1).tolist()[::max(1, int(edge.sum()) // 12)]})"))
    band_med = km.masked_median(g, band, "the groin's inner-face band (0.86-0.96 m, buckle side)", f.prefix)
    _stats(f, name="groin", top_edge_gap_mm=round(1000 * gap, 2), inner_face_band_median_mm=round(1000 * band_med, 1), outer_edge_gap_mm=round(1000 * edge_med, 1),
           belt_pairs=pb, carrier_pairs=pc_, thin_axis_deg=round(tilt, 1), z_span_mm=round(1000 * h, 1),
           **({} if yaw is None else dict(belt_front_yaw_deg=round(yaw, 1))))
    if V0 is None:
        c["groin"] = (V, T)
    return V, T


GROIN_MIN_HEIGHT = 0.15
GROIN_EDGE_GAP_LIMIT = 0.020   # the apron's outer edges' median gap to the belt along -X (approved curvature 9-15 mm; flattened 35-37 mm)
GROIN_DROP = 0.002     # the apron's top edge starts this far below the belt's top (0.004 in wave 4; 0.002 from wave 5); the loop below lowers it to 6 / 10 / 15 / 20 mm if the belt makes the plate stand out
THROAT_GAP = 0.0025


def v7_groin(f, side=None):
    V, T = groin_fit(f)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "coyote")
    return pc


# ------------------------------------------------------------ belt pouches

def _belt_pouches(f, src, degs, size, z, z_top, tex):
    z, z_top = z + f.belt_dz, z_top + f.belt_dz      # the figure's own belt line (`Team.belt_from_spine`; 0 otherwise)
    pc = Piece(f.world())
    V0, T = km.source(src)
    _bv, _bt, bb = belt_fit(f)
    shifts = []
    for deg in ik._clear_pouches(f, degs, size, z):
        th = math.radians(deg)
        d = np.array([math.cos(th), math.sin(th), 0.0])
        origin = np.array([f.O[0] + f.belt_c[0], f.O[1] + f.belt_c[1], z_top]) + d * 0.13
        V = km.place(V0, origin, d, UP)
        shift, _g = km.clear_shift([bb, f.zone_lower], V, d, gap=GAP, mask=V0[:, 0] < 0.004)
        V = V + d * shift
        shifts.append(round(1000 * shift, 1))
        add_mesh(pc, V, T, tex)
    _stats(f, name=src, shifts_mm=shifts)
    return pc


def v7_mag_pouches(f, side=None):
    return _belt_pouches(f, "mag_pouch", (270.0, 240.0), (0.06, 0.08, 0.12), ik.MAG_Z, ik.MAG_Z + 0.06, "coyote")


def v7_grenade_pouches(f, side=None):
    return _belt_pouches(f, "grenade_pouch", (120.0, 150.0), (0.055, 0.075, 0.11), 0.855, 0.855 + 0.055, "coyote")


# ------------------------------------------------------------ back and chest

def _back_bvhs(f):
    return [carrier_fit(f)[2]]


def _back_piece(f, src, y, z_origin, tex, stand=()):
    """A part whose back face stands on the carrier's back at (y, z_origin): origin on the surface, +X out of the back."""
    cb = carrier_hull(f)[2]
    c, n = km.surf_frame([cb], np.array([f.O[0], f.O[1] + y, z_origin]), (1, 0, 0), 0.04, 0.05)
    on = "carrier"
    if c is None:
        # the carrier has no back there (an opening in the Meshy shell): the part stands on the body
        c, n = km.surf_frame([f.zone_torso], np.array([f.O[0], f.O[1] + y, z_origin]), (1, 0, 0), 0.04, 0.05)
        on = "body"
    if c is None:
        raise ValueError(f"{f.prefix}: {src} found no carrier or body back at y {y} z {z_origin}")
    V0, T = km.source(src)
    V = km.place(V0, c - n * 0.0005, n, UP)
    shift, _g = km.clear_shift([cb, f.zone_torso], V, n, gap=GAP, mask=V0[:, 0] < 0.012)
    V = V + n * shift
    _stats(f, name=src, on=on, shift_mm=round(1000 * shift, 2), at=[round(float(x), 3) for x in c])
    pc = Piece(f.world())
    add_mesh(pc, V, T, tex)
    return pc


def v7_radio_pouch(f, side=None):
    return _back_piece(f, "radio_pouch", ik.RADIO_POUCH_Y, f.tz(1.17), "olive")


def v7_radio_panel(f, side=None):
    return _back_piece(f, "radio_panel", 0.0, f.tz(1.38), "olive")


def v7_radio_pack(f, side=None):
    return _back_piece(f, "radio_pack", 0.0, f.tz(1.40), "olive")


# ------------------------------------------------------------ the helmet

def _flip(n, deg):
    """(x, z) kit axes of a device flipped `deg` up from the helmet front's normal `n` (the bore tilts up and, past 90, back)."""
    t = math.radians(deg)
    up = np.array(UP)
    nn = np.array([n.x, n.y, n.z]) if hasattr(n, "x") else np.asarray(n, dtype=float)
    x = nn * math.cos(t) + up * math.sin(t)
    z = -nn * math.sin(t) + up * math.cos(t)
    return x, z


def _nvg(f, src, ends):
    tip, n = ik._mono_axis(f)
    if kp.TEAM.baked_mount:
        origin = np.array([tip.x, tip.y, tip.z]) + np.array(UP) * (0.020 + kp.TEAM.nvg_lift)
    else:
        raise ValueError("v7 NVG parts are fitted to a baked mount only")
    x, z = _flip(n, kp.TEAM.flip_deg)
    V0, T = km.source(src)
    g = lens_faces(V0, T, ends)
    V = km.place(V0, origin, x, z)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive_dark", g)
    return pc


def v7_nvg_mono(f, side=None):
    return _nvg(f, "nvg_mono", "+")


def v7_nvg_bino(f, side=None):
    return _nvg(f, "nvg_bino", "+")


def v7_ir_strobe(f, side=None):
    o = Vector((f.O[0] + f.hel_c.x - 0.03, f.O[1] + f.hel_c.y, 2.5))
    loc, n = geo.surface_hit(f.zone_helmet, o, (0, 0, -1))
    x = np.array([1.0, 0.0, 0.0]) - np.array([n.x, n.y, n.z]) * n.x
    V0, T = km.source("ir_strobe")
    V = km.place(V0, np.array([loc.x, loc.y, loc.z]) - np.array([n.x, n.y, n.z]) * 0.001, x, [n.x, n.y, n.z])
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive_dark")
    return pc


def v7_counterweight(f, side=None):
    o = Vector((f.O[0] + f.hel_c.x - 0.6, f.O[1] + f.hel_c.y, f.hel_top - 0.105))
    loc, n = geo.surface_hit(f.zone_helmet, o, (1, 0, 0))
    nn = np.array([n.x, n.y, n.z])
    V0, T = km.source("counterweight")
    # the part bulges toward its -X: its -X is the outward normal
    V = km.place(V0, np.array([loc.x, loc.y, loc.z]) + nn * 0.001, -nn, UP)
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive")
    return pc


def _headset_at(f, side, lift=0.0):
    """(vertices, triangles) of one ear cup and its rail arm, placed. `lift` raises it (metres)."""
    sg = -1.0 if side == "L" else 1.0
    # the rig's L side is at -y; `headset_l_built` is outboard +y, so the rig's L cup is the `_r_` file
    src = "headset_r_built" if side == "L" else "headset_l_built"
    inner, zc, dx = ik.HEADSET_AT
    if kp.TEAM.headset_below_rim is not None:
        # round 3 (GH-826): 1.572 m is the Rifle Squad's ear height about the ground. On a man whose helmet rim stands at
        # 1.710 the cups hung at his NECK, 9 cm under his ears, their pivot's ray found his collar and not his helmet, and
        # the head's turn onto the stock swung the firing-side cup into the stock's comb. The ear is under each man's own rim.
        zc = f.hel_bot - kp.TEAM.headset_below_rim
    zc += lift
    cx = f.O[0] + f.hel_c.x + dx
    cy = f.O[1] + f.hel_c.y
    V0, T = km.source(src)
    # the cup hangs ~75 mm below the rail pivot: the pivot stands that far above the ear-level cup centre, on the helmet's side
    zp = zc + 0.075
    probe = Vector((cx, cy + sg * 0.5, zp))
    loc, _n = geo.surface_hit(f.zone_all, probe, (0, -sg, 0))
    yp = loc.y if loc is not None else cy + sg * (inner + 0.01)
    return km.place(V0, np.array([cx, yp, zp]), (1, 0, 0), UP), T


def _gun_in_head_frame(f):
    """[(vertices, triangles)] of this man's gun in every sampled key of the pose bank's clips, carried into the HEAD's rest frame
    (where a part riding the head stands still): what an ear cup must not be crossed by."""
    c = _cache(f)
    if "gun_head" not in c:
        bank = f.bank
        oi = next(i for i, ob in enumerate(bank.objs) if ob.name == "weapon")
        ob = bank.objs[oi]
        mine = np.array([isinstance(d, str) and d.startswith(f.prefix + "_") for d in bank.dom[oi]])
        tris = np.array([tuple(p.vertices) for p in ob.data.polygons])
        tris = tris[mine[tris].all(1)]
        key = f"{f.prefix}_head"
        out = []
        for mats, W in bank.poses:
            M = bank.rest[key] @ np.linalg.inv(mats[key])
            out.append(W[oi] @ M[:3, :3].T + M[:3, 3])
        c["gun_head"] = (out, tris)
    return c["gun_head"]


def _headset_lift(f):
    """How far both cups are raised so that no gun triangle crosses either in any sampled key (a team's `headset_clear_gun`: the
    most it may be). The cheek weld puts the stock's comb under the firing-side cup; a cup the comb runs through is raised
    until it rides over it, and its pair with it (one headband). Returns (lift, pairs at 0, pairs at lift)."""
    c = _cache(f)
    if "headset_lift" not in c:
        cap = kp.TEAM.headset_clear_gun
        if cap is None:
            c["headset_lift"] = (0.0, None, None)
        else:
            poses, tris = _gun_in_head_frame(f)
            # only the keys that bring the gun near the head at all
            lo = np.array([f.O[0] + f.hel_c.x - 0.25, f.O[1] + f.hel_c.y - 0.25, f.hel_bot - 0.30]); hi = lo + np.array([0.5, 0.5, 0.6])
            near = [geo.bvh_from(P, tris) for P in poses if ((P >= lo) & (P <= hi)).all(1).any()]

            def pairs(lift):
                n_ = 0
                for side in kp.SIDES:
                    V, T = _headset_at(f, side, lift)
                    cup = geo.bvh_from(V, T)
                    n_ = max(n_, max((len(cup.overlap(g)) for g in near), default=0))
                return n_
            p0 = pairs(0.0); lift, p_ = 0.0, p0
            while p_ and lift < cap - 1e-9:
                lift += 0.002; p_ = pairs(lift)
            if not p_ and lift > 0:
                lift += 0.002          # one step of air over the comb
            c["headset_lift"] = (lift, p0, p_)
            _stats(f, name="headset_lift", lift_mm=round(1000 * lift, 1), gun_pairs_at_0=p0, gun_pairs_left=p_, keys_near=len(near))
            print(f"[inf_kit] R3 {f.prefix}: headset raised {1000 * lift:.0f} mm over the stock (worst key: {p0} gun triangle pairs crossing a cup before, {p_} after; {len(near)} keys bring the gun to the head)", flush=True)
    return c["headset_lift"][0]


def v7_headset(f, side):
    V, T = _headset_at(f, side, _headset_lift(f))
    pc = Piece(f.world())
    add_mesh(pc, V, T, "olive_dark")
    return pc


# ------------------------------------------------------------ the weapon

def _weapon_piece(f, src, u, lat, z, tex, ends=""):
    V0, T = km.source(src)
    g = lens_faces(V0, T, ends) if ends else None
    V = km.place(V0, np.array([u, lat, z]), (1, 0, 0), UP)
    pc = Piece(f.wpn())
    add_mesh(pc, V, T, tex, g)
    return pc


def v7_red_dot(f, side=None):
    top = ik._rail_top(f, ik.RED_DOT_REAR, ik.RED_DOT_REAR + 0.10)
    return _weapon_piece(f, "red_dot", ik.RED_DOT_REAR + 0.0325, 0.0, top - GAP, "coyote", "+-")


def v7_lpvo(f, side=None):
    top = ik._rail_top(f, ik.LPVO_REAR + 0.05, ik.LPVO_REAR + 0.25)
    return _weapon_piece(f, "scope", ik.LPVO_REAR + 0.1331, 0.0, top - GAP, "coyote", "+-")


def v7_laser_box(f, side=None):
    top = ik._rail_top(f, ik.LASER_FRONT - 0.109, ik.LASER_FRONT)
    return _weapon_piece(f, "laser", ik.LASER_FRONT - 0.0567, 0.0, top - GAP, "coyote", "+")


def v7_weapon_light(f, side=None):
    top, bot, wlo, _whi = f.station(0.19)
    return _weapon_piece(f, "weapon_light", ik.WEAPON_LIGHT_REAR + 0.07, wlo - 0.0125, (top + bot) / 2, "coyote", "+")


def v7_suppressor(f, side=None):
    return _weapon_piece(f, "suppressor", -0.015, 0.0, 0.0, "coyote", "+")


V7_BUILDERS = {
    "carrier": v7_carrier,
    "throat": v7_throat,
    "groin": v7_groin,
    "battle_belt": v7_battle_belt,
    "mag_pouches": v7_mag_pouches,
    "grenade_pouches": v7_grenade_pouches,
    "radio_pouch": v7_radio_pouch,
    "radio_panel": v7_radio_panel,
    "radio_pack": v7_radio_pack,
    "nvg_mono": v7_nvg_mono,
    "nvg_bino": v7_nvg_bino,
    "ir_strobe": v7_ir_strobe,
    "counterweight": v7_counterweight,
    "headset": v7_headset,
    "red_dot": v7_red_dot,
    "lpvo": v7_lpvo,
    "laser_box": v7_laser_box,
    "weapon_light": v7_weapon_light,
    "suppressor": v7_suppressor,
}
