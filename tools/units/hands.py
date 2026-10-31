"""The infantry hand generator (GH-826 F1, spec 1.1): a modelled, gloved, closed hand.

Plain numpy. No bpy, no noise of any kind, nothing random: the same call gives the
same bytes. `tools/units/hands_blender.py` turns the result into a Blender mesh.

HAND-LOCAL FRAME (right hand; the left hand is its mirror in x, winding flipped)
  origin  the wrist crease centre (the hand bone's head)
  +Y      distal, along the bone, wrist to fingers
  +Z      dorsal (the back of the hand)
  -X      radial: the thumb side of a right hand held palm down
Everything is metres. A figure of height S gets the hand scaled by S / 1.778.

WHAT IS BUILT, in triangles (the spec's cap is 256 per living hand, 48 per corpse fist):
  palm and back   3 bands of an 8-gon + the knuckle cap
  knuckle pad     a raised slab on the back of the hand
  4 fingers       5-sided tubes, 3 phalanges, a rounded tip
  thumb           2 visible phalanges (the metacarpal is the palm's thenar mass)
  cuff            a 12-sided gauntlet band with a rolled hem

CLOSING. A pose names the joint angles as CEILINGS. Each phalanx closes, knuckle first,
until its inner surface stands `CLEARANCE` (1 mm) off the proxy it grips, then stops;
the proxy is the real section the hand closes on (a rectangle for the pistol grip, a
circle for the handguard and the shield's handle). The fingers wrap the section as it
is, not a guessed one.
"""
import math

import numpy as np

REF_STATURE = 1.778          # the three bodies' S; the hand is built at this size and scaled
CLEARANCE = 0.001

# -- the spec's numbers, gloved (1.1) -----------------------------------------
HAND_LENGTH = 0.194          # wrist crease to the middle fingertip, if extended
PALM_BREADTH = 0.094         # at the knuckles, thumb excluded
PALM_THICK = 0.035
KNUCKLE_THICK = 0.030
WRIST = (0.068, 0.050)       # the cuff's section: breadth, thickness
CUFF_LEN = 0.045
CUFF_HEM = 0.003
FINGER_LEN = (0.081, 0.087, 0.083, 0.066)       # index, middle, ring, little
FINGER_W = (0.021, 0.022, 0.021, 0.018)
FINGER_T = 0.92              # thickness / width
TIP_TAPER = 0.85
PHALANX = (0.50, 0.30, 0.20)
THUMB_LEN = (0.034, 0.027)
THUMB_W = 0.024
KNUCKLE_PAD = (0.075, 0.014, 0.0025)
FINGER_X = (-0.0355, -0.0120, 0.0120, 0.0355)   # index .. little, thumb at -x
KNUCKLE_Y = (0.104, 0.107, 0.103, 0.095)        # the knuckle arc; middle: 0.107 + 0.087 = 0.194
FINGER_Z = -0.0045           # the finger axis sits palm-side of the palm's mid-plane
TRIANGLE_CAP = 256
FIST_CAP = 48


class Mesh:
    """Vertices, triangles, and a group name per triangle."""

    def __init__(self):
        self.v = []
        self.t = []
        self.g = []
        self.bands = []          # (group, vertex ids): each is a convex piece of the hand, for the penetration census

    def vert(self, p):
        self.v.append(tuple(float(x) for x in p))
        return len(self.v) - 1

    def tri(self, a, b, c, group):
        self.t.append((a, b, c))
        self.g.append(group)

    def arrays(self):
        return np.array(self.v, dtype=float).reshape(-1, 3), np.array(self.t, dtype=int).reshape(-1, 3)

    def count(self, group=None):
        return sum(1 for g in self.g if group is None or g == group)


def _poly(n, w, h, phase_deg=0.0):
    """n points of an n-gon with half-extents (w/2, h/2) in the section plane."""
    out = []
    for k in range(n):
        a = math.radians(phase_deg + 360.0 * k / n)
        out.append((math.cos(a) * w / 2.0, math.sin(a) * h / 2.0))
    return out


def _octagon(w, h):
    """An 8-gon whose flats reach exactly w/2 and h/2."""
    c = math.cos(math.radians(22.5))
    return [(x / c, y / c) for (x, y) in _poly(8, w, h, 22.5)]


def _loft(mesh, group, rings, apex=None, flip=False):
    """Bands between consecutive rings (each a list of 3D points, same length), with
    outward-facing triangles; `apex` closes the last ring with a fan to that point."""
    ids = [[mesh.vert(p) for p in r] for r in rings]
    for k in range(len(ids) - 1):
        mesh.bands.append((group, ids[k] + ids[k + 1]))
    cents = [np.mean(np.array(r), axis=0) for r in rings]
    tris = []
    for k in range(len(ids) - 1):
        n = len(ids[k])
        for i in range(n):
            j = (i + 1) % n
            tris.append((ids[k][i], ids[k + 1][i], ids[k + 1][j], (cents[k] + cents[k + 1]) / 2.0))
            tris.append((ids[k][i], ids[k + 1][j], ids[k][j], (cents[k] + cents[k + 1]) / 2.0))
    if apex is not None:
        a = mesh.vert(apex)
        mesh.bands.append((group, ids[-1] + [a]))
        n = len(ids[-1])
        for i in range(n):
            tris.append((ids[-1][i], a, ids[-1][(i + 1) % n], cents[-1]))
    for (a, b, c, ctr) in tris:
        pa, pb, pc = (np.array(mesh.v[i]) for i in (a, b, c))
        nrm = np.cross(pb - pa, pc - pa)
        out = ((pa + pb + pc) / 3.0 - ctr)
        if (np.dot(nrm, out) < 0.0) != flip:
            b, c = c, b
        mesh.tri(a, b, c, group)


def _unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


# -- proxies: the shape a hand closes on, in the hand's own (y, z) plane ---------
class Circle:
    kind = "circle"

    def __init__(self, cy, cz, r):
        self.cy, self.cz, self.r = cy, cz, r

    def sdf(self, y, z):
        return np.hypot(np.asarray(y) - self.cy, np.asarray(z) - self.cz) - self.r

    def describe(self):
        return dict(kind=self.kind, centre_yz=(round(self.cy, 4), round(self.cz, 4)), diameter=round(2 * self.r, 4))


class Rect:
    kind = "rect"

    def __init__(self, y0, y1, z0, z1, rad=0.004):
        self.y0, self.y1, self.z0, self.z1, self.rad = y0, y1, z0, z1, rad

    def sdf(self, y, z):
        cy, cz = (self.y0 + self.y1) / 2.0, (self.z0 + self.z1) / 2.0
        hy, hz = (self.y1 - self.y0) / 2.0 - self.rad, (self.z1 - self.z0) / 2.0 - self.rad
        qy = np.abs(np.asarray(y) - cy) - hy
        qz = np.abs(np.asarray(z) - cz) - hz
        out = np.hypot(np.maximum(qy, 0.0), np.maximum(qz, 0.0)) + np.minimum(np.maximum(qy, qz), 0.0)
        return out - self.rad

    def describe(self):
        return dict(kind=self.kind, y=(round(self.y0, 4), round(self.y1, 4)), z=(round(self.z0, 4), round(self.z1, 4)))

    @property
    def cy(self):
        return (self.y0 + self.y1) / 2.0

    @property
    def cz(self):
        return (self.z0 + self.z1) / 2.0


class Polygon:
    """A convex polygon proxy in the hand's (y, z) plane, from a measured weapon section (the handguard's own)."""
    kind = "polygon"

    def __init__(self, pts, cy, cz):
        P = np.asarray(pts, dtype=float)
        c = P.mean(axis=0)
        ang = np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0])
        self.P = P[np.argsort(ang)]
        self.cy, self.cz = cy, cz

    def sdf(self, y, z):
        y = np.asarray(y, dtype=float); z = np.asarray(z, dtype=float)
        Q = np.stack((y, z), axis=-1).reshape(-1, 2)
        A = self.P; B = np.roll(self.P, -1, axis=0)
        E = B - A
        L2 = (E * E).sum(axis=1)
        d = np.full(len(Q), np.inf)
        inside = np.ones(len(Q), dtype=bool)
        for a, e, l2 in zip(A, E, L2):
            t = np.clip(((Q - a) @ e) / l2, 0.0, 1.0)
            d = np.minimum(d, np.linalg.norm(Q - (a + t[:, None] * e), axis=1))
            cr = e[0] * (Q[:, 1] - a[1]) - e[1] * (Q[:, 0] - a[0])
            inside &= cr >= 0.0
        return np.where(inside, -d, d).reshape(y.shape)

    def describe(self):
        return dict(kind=self.kind, n=len(self.P), y=(round(float(self.P[:, 0].min()), 4), round(float(self.P[:, 0].max()), 4)),
                    z=(round(float(self.P[:, 1].min()), 4), round(float(self.P[:, 1].max()), 4)))


# -- poses -----------------------------------------------------------------------
# angles are CEILINGS, degrees: (knuckle, middle, tip) for fingers 3 to 5 (middle, ring, little).
POSES = {
    "grip": dict(ceil=(70.0, 90.0, 35.0), index=(0.0, 0.0, 0.0), index_abd=20.0, index_trigger_deg=15.0,
                 thumb=dict(base_flex=40.0, base_abd=30.0, mcp=25.0, ip=20.0), proxy="rect", x_ref=FINGER_X[1]),
    "support": dict(ceil=(45.0, 65.0, 30.0), index="same", thumb=dict(base_flex=0.0, base_abd=50.0, mcp=0.0, ip=5.0),
                    proxy="circle", x_ref=0.0),
    "handle": dict(ceil=(70.0, 90.0, 40.0), index="same", thumb=dict(base_flex=30.0, base_abd=20.0, mcp=30.0, ip=20.0),
                   proxy="circle", x_ref=0.0),
}


def default_proxy(pose, s=1.0):
    """The proxy a pose closes on, in hand-local (y, z), at scale `s`.

    grip     the carbine's pistol grip, 0.030 wide x 0.050 deep (spec 1.6): the palm lies on its
             side face, the fingers wrap its front strap. Its depth runs along the hand's y.
    support  the handguard. The spec says a 0.046 cylinder; the part's measured section is
             0.068 x 0.076, a 0.0345 radius, and that is what the hand closes on.
    handle   the shield's rear handle, a 0.028 bar.
    """
    z_palm = -(PALM_THICK / 2.0) * s - CLEARANCE
    if pose == "grip":
        w, dp = 0.030 * s, 0.050 * s
        y_front = KNUCKLE_Y[1] * s + 0.014 * s       # the strap's front face stands just ahead of the middle knuckle
        return Rect(y_front - dp, y_front, z_palm - w, z_palm)
    r = (0.0345 if pose == "support" else 0.014) * s
    return Circle((0.086 if pose == "support" else 0.085) * s, z_palm - r, r)


def _chain(K, lens, angles, dirs_out=False):
    """Centreline points of a planar chain in (y, z): start K, segment i of length lens[i] at the
    cumulative flexion angles[0..i] (degrees, toward -z). Returns the points (len+1, 3)."""
    p = [np.array(K, dtype=float)]
    cum = 0.0
    dirs = []
    for L, a in zip(lens, angles):
        cum += a
        d = np.array((0.0, math.cos(math.radians(cum)), -math.sin(math.radians(cum))))
        dirs.append(d)
        p.append(p[-1] + d * L)
    return (np.array(p), dirs) if dirs_out else np.array(p)


def close_finger(K, lens, radius, proxy, ceil, step=0.5):
    """Flex each phalanx, knuckle first, until its tube stands CLEARANCE off the proxy or its
    ceiling is reached. Returns (angles, contact flags)."""
    angles = [0.0, 0.0, 0.0]
    hit = [False, False, False]
    for j in range(3):
        a = 0.0
        while a + step <= ceil[j] + 1e-9:
            trial = list(angles)
            trial[j] = a + step
            pts = _chain(K, lens[: j + 1], trial[: j + 1])
            seg = np.linspace(pts[-2], pts[-1], 12)
            if proxy is not None and np.min(proxy.sdf(seg[:, 1], seg[:, 2])) - radius <= CLEARANCE:
                hit[j] = True
                break
            a += step
        angles[j] = a
    return angles, hit


def _ring_pts(C, nrm, u, sec, scale_v=1.0):
    """3D points of a 2D section (a, b) at centre C: a along `u` (the width axis, x), b along the in-plane
    normal of the sweep (dorsal)."""
    v = np.cross(nrm, u)
    return [C + u * a + v * b * scale_v for (a, b) in sec]


def _tube(mesh, group, pts, dirs, widths, thick_ratio, base_back, s_scale, n=5, phase=90.0, tip_round=0.0055, u=(1.0, 0.0, 0.0)):
    """A swept tube along a planar centreline in (y, z): rings at the base (buried `base_back` into the palm),
    each interior joint, and just short of the tip, then an apex."""
    u = np.array(u, dtype=float)
    rings = []
    # base
    d0 = dirs[0]
    C = pts[0] - d0 * base_back
    rings.append(_section_ring(C, d0, u, widths[0], thick_ratio, n, phase, 1.0))
    for k in range(1, len(pts) - 1):
        dm = _unit(dirs[k - 1] + dirs[k])
        half = math.acos(max(-1.0, min(1.0, float(np.dot(dirs[k - 1], dirs[k]))))) / 2.0
        miter = min(1.0 / max(math.cos(half), 1e-6), 1.3)
        rings.append(_section_ring(pts[k], dm, u, widths[k], thick_ratio, n, phase, miter))
    dl = dirs[-1]
    rings.append(_section_ring(pts[-1] - dl * tip_round, dl, u, widths[-1], thick_ratio, n, phase, 1.0, taper=0.82))
    _loft(mesh, group, rings, apex=pts[-1] + dl * 0.0004)
    return rings


def _section_ring(C, nrm, u, width, thick_ratio, n, phase, miter, taper=1.0):
    sec = _poly(n, width * taper, width * taper * thick_ratio * miter, phase)
    v = np.cross(u, nrm)      # dorsal: for a sweep along +y with u = +x, u x nrm = +z
    return [C + u * a + v * b for (a, b) in sec]


def build(pose="grip", side="R", S=REF_STATURE, proxy=None, kind="living", verbose=False):
    """One hand. Returns dict(mesh, tris, groups, report). `side` is the ANATOMICAL side: 'R' builds as
    documented, 'L' is the mirror. `kind`: 'living' (<= 256 triangles) or 'fist' (the corpse's, <= 48)."""
    s = S / REF_STATURE
    if kind == "fist":
        return _fist(side, s)
    P = POSES[pose]
    m = Mesh()
    rep = {"pose": pose, "side": side, "scale": s}

    # ---------------------------------------------------------------- proxy and fingers
    if proxy is None:
        proxy = default_proxy(pose, s)
    fingers = []
    for i in range(4):
        K = np.array((FINGER_X[i] * s, KNUCKLE_Y[i] * s, FINGER_Z * s))
        L = FINGER_LEN[i] * s
        lens = [L * f for f in PHALANX]
        radius = FINGER_W[i] * s * FINGER_T / 2.0
        ceil = P["ceil"]
        if i == 0 and pose == "grip":
            ang, hit = [0.0, 0.0, 0.0], [False] * 3          # the trigger finger lies straight along the receiver
        else:
            ang, hit = close_finger(K, lens, radius, proxy, ceil)
        pts, dirs = _chain(K, lens, ang, dirs_out=True)
        uvec = np.array((1.0, 0.0, 0.0))
        if i == 0 and pose == "grip" and P.get("index_abd"):
            al = math.radians(P["index_abd"])
            Rz = np.array(((math.cos(al), -math.sin(al), 0.0), (math.sin(al), math.cos(al), 0.0), (0.0, 0.0, 1.0)))
            pts = (pts - K) @ Rz.T + K
            dirs = [Rz @ d for d in dirs]
            uvec = Rz @ uvec
        w0 = FINGER_W[i] * s
        widths = [w0, w0 * 1.03, w0 * 0.96, w0 * TIP_TAPER]
        fingers.append(dict(K=K, pts=pts, dirs=dirs, widths=widths, angles=ang, hit=hit, radius=radius, u=uvec))

    # ---------------------------------------------------------------- palm and back: 3 bands + cap
    ys = (0.0, 0.036, 0.072, 0.107)
    br = (0.060, 0.078, 0.090, PALM_BREADTH)
    th = (0.033, PALM_THICK, 0.034, KNUCKLE_THICK)
    xc = (0.0, -0.005, -0.004, 0.0)                    # the thenar mass widens the radial (thumb) side
    arc = lambda x: float(np.interp(x / s, [-0.047, -0.0355, -0.0120, 0.0120, 0.0355, 0.047],
                                    [KNUCKLE_Y[0] - 0.004, KNUCKLE_Y[0], KNUCKLE_Y[1], KNUCKLE_Y[2], KNUCKLE_Y[3], KNUCKLE_Y[3] - 0.005]))
    rings = []
    for k in range(4):
        pts = []
        for (a, b) in _octagon(br[k] * s, th[k] * s):
            y = ys[k] * s if k < 3 else arc(a) * s
            pts.append(np.array((a + xc[k] * s, y, b)))
        rings.append(pts)
    last = np.mean(np.array(rings[-1]), axis=0)
    _loft(m, "palm", rings, apex=last + np.array((0.0, 0.004 * s, 0.0)))
    # knuckle pad: a raised roof on the back of the hand across the knuckle line (6 triangles)
    pw, pl, ph = (v * s for v in KNUCKLE_PAD)
    zt = KNUCKLE_THICK * s / 2.0
    y_mid = 0.098 * s
    r0 = [np.array((-pw / 2, y_mid - pl / 2, zt - 0.0015 * s)), np.array((pw / 2, y_mid - pl / 2, zt - 0.0015 * s)),
          np.array((pw / 2, y_mid + pl / 2, zt - 0.0015 * s)), np.array((-pw / 2, y_mid + pl / 2, zt - 0.0015 * s))]
    ridge = [np.array((-pw / 2 * 0.80, y_mid, zt + ph)), np.array((pw / 2 * 0.80, y_mid, zt + ph))]
    rid = [m.vert(p) for p in ridge]
    b = [m.vert(p) for p in r0]
    ctr = np.mean(np.array([m.v[q] for q in b + rid]), axis=0)
    m.bands.append(("pad", b + rid))
    for (a, bb, c) in ((b[0], b[1], rid[1]), (b[0], rid[1], rid[0]), (b[3], rid[0], rid[1]), (b[3], rid[1], b[2]),
                       (b[0], rid[0], b[3]), (b[1], b[2], rid[1])):
        pa, pb, pc = (np.array(m.v[q]) for q in (a, bb, c))
        if np.dot(np.cross(pb - pa, pc - pa), (pa + pb + pc) / 3.0 - ctr) < 0:
            bb, c = c, bb
        m.tri(a, bb, c, "pad")

    # ---------------------------------------------------------------- fingers (index may be its own part: the trigger finger)
    for i, f in enumerate(fingers):
        grp = "index" if (i == 0 and pose == "grip") else f"finger{i}"
        _tube(m, grp, f["pts"], f["dirs"], f["widths"], FINGER_T, 0.006 * s, s, n=(4 if i == 3 else 5), phase=(45.0 if i == 3 else 90.0), u=f["u"])

    # ---------------------------------------------------------------- thumb: CMC at the palm's radial edge
    tp = P["thumb"]
    cmc = np.array((-0.027 * s, 0.014 * s, -0.007 * s))
    bf, ba = math.radians(tp["base_flex"]), math.radians(tp["base_abd"])
    # metacarpal direction: out along y, abducted toward -x, flexed toward -z
    meta = _unit((-math.sin(ba) * math.cos(bf), math.cos(ba) * math.cos(bf), -math.sin(bf)))
    mcp = cmc + meta * 0.046 * s
    zdown = np.array((0.0, 0.0, -1.0))
    n1 = _unit(zdown - np.dot(zdown, meta) * meta)

    def rot(dirv, nrm, deg):
        a = math.radians(deg)
        return _unit(dirv * math.cos(a) + nrm * math.sin(a))

    d1 = rot(meta, n1, tp["mcp"])
    p1 = mcp + d1 * THUMB_LEN[0] * s
    n2 = _unit(zdown - np.dot(zdown, d1) * d1)
    d2 = rot(d1, n2, tp["ip"])
    p2 = p1 + d2 * THUMB_LEN[1] * s
    tpts = np.array([cmc, mcp, p1, p2])
    w = THUMB_W * s
    _thumb_tube(m, tpts, [meta, d1, d2], [w * 1.25, w * 1.08, w * 0.98, w * TIP_TAPER], s)

    # ---------------------------------------------------------------- cuff: 12-sided gauntlet band with a rolled hem
    cw, ch = WRIST[0] * s, WRIST[1] * s
    hem = CUFF_HEM * s
    ringA = [np.array((a, -0.030 * s, b)) for (a, b) in _poly(12, cw + 2 * hem, ch + 2 * hem, 15.0)]
    ringB = [np.array((a, 0.015 * s, b)) for (a, b) in _poly(12, 0.063 * s, 0.040 * s, 15.0)]
    _loft(m, "cuff", [ringA, ringB])

    # ---------------------------------------------------------------- mirror for the left hand
    verts, tris = m.arrays()
    if side == "L":
        verts = verts * np.array((-1.0, 1.0, 1.0))
        tris = tris[:, ::-1]
        proxy_out = _mirror_proxy(proxy)
    else:
        proxy_out = proxy
    out = dict(verts=verts, tris=tris, groups=list(m.g), bands=list(m.bands), proxy=proxy_out, pose=pose, side=side, scale=s,
               fingers=[dict(angles=f["angles"], hit=f["hit"], K=f["K"].tolist(), pts=f["pts"].tolist()) for f in fingers],
               thumb=dict(mcp=mcp.tolist(), p1=p1.tolist(), p2=p2.tolist()), x_ref=P["x_ref"] * s,
               triangles=len(tris))
    out["by_group"] = {g: out["groups"].count(g) for g in dict.fromkeys(out["groups"])}
    if out["triangles"] > TRIANGLE_CAP:
        raise SystemExit(f"[hands] {pose} {side}: {out['triangles']} triangles, the cap is {TRIANGLE_CAP}")
    return out


def _mirror_proxy(p):
    return p      # the proxies are extruded along x, so a mirror does not change their (y, z) shape


def _thumb_tube(m, pts, dirs, widths, s, n=5):
    """The thumb: the metacarpal's root (buried in the palm's thenar mass), the MCP joint, the IP joint and
    the tip. The flat of the thumb faces the palm."""
    rings = []
    rings.append(_ring3(pts[0] - dirs[0] * 0.004 * s, dirs[0], widths[0], n))
    for k in (1, 2):
        rings.append(_ring3(pts[k], _unit(dirs[k - 1] + dirs[k]), widths[k], n))
    rings.append(_ring3(pts[3] - dirs[2] * 0.0035, dirs[2], widths[3] * 0.82, n))
    _loft(m, "thumb", rings, apex=pts[3] + dirs[2] * 0.0004)


def _ring3(C, d, width, n, thick_ratio=0.9):
    palm_n = np.array((0.0, 0.0, 1.0))
    u = _unit(np.cross(d, palm_n))
    if abs(float(np.dot(d, palm_n))) > 0.98:
        u = np.array((1.0, 0.0, 0.0))
    v = _unit(np.cross(u, d))
    sec = _poly(n, width, width * thick_ratio, 90.0)
    return [C + u * a + v * b for (a, b) in sec]


def _fist(side, s):
    """The corpse's fist: an 8-sided closed fist and a thumb lump, at most 48 triangles."""
    m = Mesh()
    ys = (0.0, 0.040, 0.082)
    br = (0.060, 0.088, 0.082)
    th = (0.034, 0.060, 0.056)
    rings = []
    for k in range(3):
        rings.append([np.array((a, ys[k] * s, b)) for (a, b) in _octagon(br[k] * s, th[k] * s)])
    _loft(m, "fist", rings, apex=np.array((0.0, 0.098 * s, -0.004 * s)))
    # thumb lump: a 4-triangle tetrahedron on the radial side
    b0 = m.vert((-0.040 * s, 0.040 * s, -0.012 * s))
    b1 = m.vert((-0.040 * s, 0.075 * s, -0.012 * s))
    b2 = m.vert((-0.036 * s, 0.058 * s, 0.014 * s))
    b3 = m.vert((-0.058 * s, 0.058 * s, -0.006 * s))
    lump = [(b0, b2, b1), (b0, b1, b3), (b1, b2, b3), (b2, b0, b3)]
    ctr = np.mean(np.array([m.v[q] for q in (b0, b1, b2, b3)]), axis=0)
    for (a, b, c) in lump:
        pa, pb, pc = (np.array(m.v[q]) for q in (a, b, c))
        if np.dot(np.cross(pb - pa, pc - pa), (pa + pb + pc) / 3.0 - ctr) < 0:
            b, c = c, b
        m.tri(a, b, c, "fist")
    verts, tris = m.arrays()
    if side == "L":
        verts = verts * np.array((-1.0, 1.0, 1.0))
        tris = tris[:, ::-1]
    if len(tris) > FIST_CAP:
        raise SystemExit(f"[hands] fist {len(tris)} triangles, the cap is {FIST_CAP}")
    return dict(verts=verts, tris=tris, groups=list(m.g), bands=list(m.bands), proxy=None, pose="fist", side=side, scale=s, fingers=[], thumb={},
                x_ref=0.0, triangles=len(tris), by_group={"fist": len(tris)})


# -- measuring (the same L x W x T the review used, numpy only) ------------------
def measure(hand, wrist_y=0.0):
    """Principal-axis extents (0.5 to 99.5 percentile) of the vertices past the wrist plane."""
    V = hand["verts"]
    H = V[V[:, 1] >= wrist_y]
    Hm = H - H.mean(axis=0)
    ev, evec = np.linalg.eigh(np.cov(Hm.T))
    ext = []
    for k in np.argsort(ev)[::-1]:
        pr = Hm @ evec[:, k]
        ext.append(float(np.percentile(pr, 99.5) - np.percentile(pr, 0.5)))
    return tuple(ext)


def hand_length_extended(s=1.0):
    return (KNUCKLE_Y[1] + FINGER_LEN[1]) * s


def trigger_pose(hand, deg=None):
    """The firing hand with its trigger finger rotated about the knuckle axis (the `{prefix}_finger_L` bone's
    one degree of freedom): a copy of `hand` whose 'index' vertices are flexed `deg` toward the palm."""
    if deg is None:
        deg = POSES["grip"]["index_trigger_deg"]
    out = dict(hand)
    V = hand["verts"].copy()
    sgn = -1.0 if hand["side"] == "L" else 1.0
    s = hand["scale"]
    K = np.array((sgn * FINGER_X[0] * s, KNUCKLE_Y[0] * s, FINGER_Z * s))
    idx = np.unique(hand["tris"][[g == "index" for g in hand["groups"]]].ravel())
    # flexion about the finger's own width axis (x, turned by the abduction), toward the palm
    al = math.radians(POSES["grip"].get("index_abd", 0.0)) * sgn
    ax = np.array((math.cos(al), math.sin(al), 0.0))
    th = math.radians(deg) * (1.0)
    # Rodrigues, rotating +y toward -z about `ax`
    Kx = np.array(((0.0, -ax[2], ax[1]), (ax[2], 0.0, -ax[0]), (-ax[1], ax[0], 0.0)))
    R = np.eye(3) + math.sin(-th) * Kx + (1 - math.cos(-th)) * (Kx @ Kx)
    V[idx] = (V[idx] - K) @ R.T + K
    out["verts"] = V
    return out


def grasp_frame(hand):
    """(axis_h, c_h, P_h): the hand-local axis index-to-little along the proxy, the direction from the proxy
    toward the palm (+z, the dorsal side), and the reference point on the proxy (x_ref, proxy centre)."""
    sgn = -1.0 if hand["side"] == "L" else 1.0
    pr = hand["proxy"]
    return np.array((sgn, 0.0, 0.0)), np.array((0.0, 0.0, 1.0)), np.array((sgn * hand["x_ref"], pr.cy, pr.cz))


def place_matrix(hand, axis_w, c_w, P_w):
    """The rigid transform (3x3 R, translation t) taking this hand-local hand onto a weapon station: its index-to-little
    axis onto `axis_w` and its palm direction onto `c_w`, its reference point onto `P_w`."""
    axis_h, c_h, P_h = grasp_frame(hand)
    Bh = np.column_stack((axis_h, np.cross(c_h, axis_h), c_h))
    a = _unit(axis_w)
    c = _unit(np.asarray(c_w, dtype=float) - np.dot(c_w, a) * a)
    Bw = np.column_stack((a, np.cross(c, a), c))
    R = Bw @ Bh.T
    return R, np.asarray(P_w, dtype=float) - R @ P_h


def volume_pieces(hand, R=None, t=None):
    """The hand as a union of convex pieces (a ring pair of a tube, the palm's bands), each (group, scipy hull
    equations): the weapon-in-hand census asks whether a weapon surface point is inside any piece and how deep."""
    from scipy.spatial import ConvexHull
    V = hand["verts"] if R is None else hand["verts"] @ R.T + t
    out = []
    for g, ids in hand["bands"]:
        P = V[sorted(set(ids))]
        try:
            hull = ConvexHull(P)
        except Exception:
            continue
        out.append((g, hull.equations))
    return out


def weapon_in_hand(pieces, points):
    """Per group, the deepest a weapon point sits inside the hand's volume, metres."""
    depth = {}
    for g, eq in pieces:
        # inside when every plane's signed distance is <= 0; depth = -max over planes
        d = points @ eq[:, :3].T + eq[:, 3]
        inside = np.all(d <= 0.0, axis=1)
        dep = np.where(inside, -d.max(axis=1), 0.0)
        depth[g] = max(depth.get(g, 0.0), float(dep.max()) if len(dep) else 0.0)
    return depth
