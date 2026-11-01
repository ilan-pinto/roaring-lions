"""The `kdf_carbine`'s pistol grip, reshaped for a gloved hand (GH-826 F4, spec 1.6).

Blender-only. Called by `export_kdf_carbine_part.py` on the carbine in the part
frame (x forward, y across, z up, bore centreline on z = 0, butt plate at
x = -0.425). Deterministic: no noise of any kind.

WHY. The Meshy remesh's pistol grip is a stippled block 0.136 x 0.129 x 0.070 m
(u 0.237 to 0.372, 48 triangles): the size of a fist, a second fist beside the
hand that is supposed to hold it. This deletes that block and builds, in its
place, a grip a gloved hand closes on:

  * a pistol grip 0.105 long, 0.030 wide and 0.050 deep at mid-height, raked 20
    degrees (bottom back) from the bore normal; a 0.012 beavertail at the top,
    a 3 mm flare at the bottom, two finger swells on the front strap;
  * a trigger guard, a 0.075 x 0.030 loop of 4 mm bar from the grip's front to
    the magazine well, 0.015 clear of the magazine;
  * a trigger blade inside the guard, 0.008 thick.

The old block's own polymer texel colours all of it (no texture edit). The
triangle budget is the spec's 380 for the whole part: the old part has 315, the
block is 48, and what is added here is counted and printed, never assumed.

Frame notes (the spec's 1.3): u is metres from the butt plate along the long
axis, s = u / 0.845. `stations` are written in the part's own frame.
"""
import math

import bmesh
import numpy as np
from mathutils import Vector

# -- the spec's numbers (1.6) -------------------------------------------------
BUTT_X = -0.425
RAKE_DEG = 20.0
GRIP_LEN = 0.105
GRIP_WIDTH = 0.030
GRIP_DEPTH_MID = 0.050
GRIP_DEPTH_TOP = 0.048
GRIP_DEPTH_BOTTOM = 0.053            # "bottom flare 3 mm" over the mid depth
BEAVERTAIL = 0.012
SWELL = 0.0015                       # shallow finger swells on the front strap
GUARD_LEN = 0.075
GUARD_DEPTH = 0.030
GUARD_BAR = 0.004
MAG_CLEAR = 0.015
TRIGGER_THICK = 0.008
LOP_BAND = (0.33, 0.38)              # butt plate to trigger face, refused outside
MAX_TRIS = 380
GRIP_STATION_BELOW_TOP = 0.045       # the middle finger's line
GRIP_RINGS = 5
# The block to delete, in the part frame: centroid x in (-0.20, -0.040) and
# below the receiver. Measured on the shipped bytes: 48 faces, u 0.237 to 0.372.
BLOCK_X = (-0.200, -0.040)
BLOCK_Z_BELOW = -0.040
BLOCK_FACES = 48
# the receiver's belly sits near here where the grip meets it
GRIP_TOP_Z = -0.036
GUARD_TOP_Z = -0.062
GRIP_VISIBLE_TOP_Z = GUARD_TOP_Z + 0.006   # where the axis leaves the receiver's belly: the grip's top as a hand sees it


def _octagon(depth, width, chamfer_frac=0.38):
    """Ring of 8 (d, y) points, counter-clockwise from the front-right corner's chamfer."""
    hd, hw = depth / 2.0, width / 2.0
    c = chamfer_frac * min(hd, hw) * 2.0
    return [(hd, -(hw - c)), (hd - c, -hw), (-(hd - c), -hw), (-hd, -(hw - c)),
            (-hd, hw - c), (-(hd - c), hw), (hd - c, hw), (hd, hw - c)]


def handguard_centre_y(co):
    """The bore's lateral centre: the median centre of the handguard's section."""
    ys = []
    for x0 in np.arange(0.10, 0.27, 0.02):
        s = co[(co[:, 0] >= x0) & (co[:, 0] < x0 + 0.02)]
        if len(s):
            ys.append((s[:, 1].min() + s[:, 1].max()) / 2.0)
    return float(np.median(ys))


def handguard_section(co):
    """Median handguard section (width y, height z) and its bottom z, from the
    vertices between u 0.52 and 0.745 (the spec's handguard)."""
    sel = co[(co[:, 0] > BUTT_X + 0.52 + 0.04) & (co[:, 0] < BUTT_X + 0.745 - 0.02)]
    return (float(np.ptp(sel[:, 1])), float(np.ptp(sel[:, 2])), float(sel[:, 2].min()),
            float((sel[:, 1].min() + sel[:, 1].max()) / 2.0))


def mag_rear_x(co, z):
    """The magazine's rearmost x at height z, from the vertices of its slanted
    body (x > -0.06, z below the receiver)."""
    band = co[(co[:, 2] < z + 0.012) & (co[:, 2] > z - 0.012) & (co[:, 0] > -0.07) & (co[:, 0] < 0.08)]
    if not len(band):
        raise SystemExit(f"[grip] no magazine vertices near z {z:+.3f}")
    return float(band[:, 0].min())


def block_faces(bm):
    return [f for f in bm.faces
            if BLOCK_X[0] < f.calc_center_median().x < BLOCK_X[1] and f.calc_center_median().z < BLOCK_Z_BELOW]


def reshape(ob, uv_texel):
    """Delete the fist block, build the new grip, guard and trigger. `uv_texel`
    is the (u, v) of the polymer texel. Returns a report dict (numbers only)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    tris0 = len(bm.faces)
    kill = block_faces(bm)
    if len(kill) != BLOCK_FACES:
        raise SystemExit(f"[grip] the fist block is {len(kill)} faces, expected {BLOCK_FACES}: the part moved -- look at it")
    bk = np.array([v.co[:] for f in kill for v in f.verts])
    block_dims = (float(np.ptp(bk[:, 0])), float(np.ptp(bk[:, 2])), float(np.ptp(bk[:, 1])))
    block_u = (float(bk[:, 0].min() - BUTT_X), float(bk[:, 0].max() - BUTT_X))
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    # close the receiver's belly where the block was: one hole, an 8-edge loop
    # (measured on the shipped bytes), filled before anything is added
    uvl = bm.loops.layers.uv.active
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)   # the glTF import splits verts at UV seams
    bm.edges.ensure_lookup_table()
    hole = [e for e in bm.edges if len(e.link_faces) == 1 and all(BLOCK_X[0] + 0.05 < v.co.x < BLOCK_X[1] and v.co.z < -0.01 for v in e.verts)]
    if len(hole) != 8:
        raise SystemExit(f"[grip] the block's hole is {len(hole)} edges, expected 8: look at it")
    n_before = len(bm.faces)
    res = bmesh.ops.triangle_fill(bm, edges=hole, use_beauty=True)
    belly = [f for f in res["geom"] if isinstance(f, bmesh.types.BMFace)]
    for f in belly:
        for lp in f.loops:
            lp[uvl].uv = uv_texel
        f.smooth = True
    belly_tris = len(belly)
    co_all = np.array([v.co[:] for v in bm.verts])

    y_c = handguard_centre_y(co_all)
    hg_w, hg_h, hg_bottom, _ = handguard_section(co_all)

    # -- layout (all numbers derive from the spec's, none are tuned) ----------
    r = math.radians(RAKE_DEG)
    a = Vector((-math.sin(r), 0.0, -math.cos(r)))          # axis, top to bottom
    d = Vector((math.cos(r), 0.0, -math.sin(r)))           # forward, normal to the axis
    z_a = GUARD_TOP_Z - GUARD_DEPTH * 0.5                  # the guard rear anchor's height
    mag_x = mag_rear_x(co_all, GUARD_TOP_Z - 0.010)
    x_gf = mag_x - MAG_CLEAR                               # guard front end (the bar's front extreme)
    x_ga = x_gf - GUARD_LEN                                # guard rear end, on the grip's front strap
    # front strap line through (x_ga + inset, z_a): solve the top ring's centre
    c0 = Vector((0.0, y_c, GRIP_TOP_Z))
    depth = lambda s: np.interp(s, [0.0, GRIP_LEN * 0.5, GRIP_LEN], [GRIP_DEPTH_TOP, GRIP_DEPTH_MID, GRIP_DEPTH_BOTTOM])
    s_a = (c0.z - z_a) / math.cos(r)                       # arc length down the axis to the anchor height
    front_at_a = (c0 + a * s_a + d * (depth(s_a) / 2.0))
    c0.x += (x_ga + 0.003) - front_at_a.x                  # bar buried 3 mm in the strap
    # rings along the axis: top (buried in the belly), swell, valley, swell, bottom flare
    s_rings = [GRIP_LEN * k / (GRIP_RINGS - 1) for k in range(GRIP_RINGS)]
    swell = [0.0, SWELL, -SWELL * 0.3, SWELL, 0.0]
    rings = []
    for s, sw in zip(s_rings, swell):
        D = float(depth(s))
        pts = []
        for (pd, py) in _octagon(D, GRIP_WIDTH):
            q = pd + (sw if pd > 0.0 else 0.0)
            if s == 0.0 and pd < 0.0:                      # the beavertail: the top's rear lip stands proud
                q -= BEAVERTAIL * 0.5
            pts.append(c0 + a * s + d * q + Vector((0.0, py, 0.0)))
        rings.append(pts)
    u_grip_top = c0.x - BUTT_X

    # -- faces ---------------------------------------------------------------
    uvl = bm.loops.layers.uv.active
    grip_faces, guard_faces, trig_faces = [], [], []
    cur = [grip_faces]

    def tri(v0, v1, v2):
        try:
            f = bm.faces.new((v0, v1, v2))
        except ValueError:
            return None
        for lp in f.loops:
            lp[uvl].uv = uv_texel
        cur[0].append(f)
        return f

    def band(ra, rb, sharp=False):
        n = len(ra)
        va = [bm.verts.new(p) for p in ra] if not isinstance(ra[0], bmesh.types.BMVert) else ra
        vb = [bm.verts.new(p) for p in rb]
        for i in range(n):
            j = (i + 1) % n
            tri(va[i], vb[i], vb[j])
            tri(va[i], vb[j], va[j])
        return va, vb

    # the grip: bands between consecutive rings, then the bottom cap
    prev = [bm.verts.new(p) for p in rings[0]]
    for k in range(1, len(rings)):
        _, prev = band(prev, rings[k])
    cap_c = bm.verts.new(sum(rings[-1], Vector()) / len(rings[-1]))
    n = len(prev)
    for i in range(n):
        tri(prev[i], cap_c, prev[(i + 1) % n])
    # the top is inside the receiver's belly; no cap (it would be hidden), the
    # belly is closed below by `close_belly`
    # trigger guard: a 4 mm square bar along a polyline in (x, z)
    cur[0] = guard_faces
    gx0, gx1 = x_ga, x_gf
    path = [(gx0 - 0.004, GUARD_TOP_Z - 0.003), (gx0 + 0.010, GUARD_TOP_Z - GUARD_DEPTH),
            (gx1 - 0.020, GUARD_TOP_Z - GUARD_DEPTH), (gx1 - GUARD_BAR / 2.0, GUARD_TOP_Z + 0.002)]
    bar = GUARD_BAR / 2.0
    gr = []
    for i, (px, pz) in enumerate(path):
        if i == 0:
            t = Vector((path[1][0] - px, 0.0, path[1][1] - pz))
        elif i == len(path) - 1:
            t = Vector((px - path[i - 1][0], 0.0, pz - path[i - 1][1]))
        else:
            t = Vector((path[i + 1][0] - path[i - 1][0], 0.0, path[i + 1][1] - path[i - 1][1]))
        t.normalize()
        nrm = Vector((-t.z, 0.0, t.x))                     # in-plane normal
        c = Vector((px, y_c, pz))
        gr.append([c + nrm * bar + Vector((0, bar, 0)), c - nrm * bar + Vector((0, bar, 0)),
                   c - nrm * bar - Vector((0, bar, 0)), c + nrm * bar - Vector((0, bar, 0))])
    prevg = [bm.verts.new(p) for p in gr[0]]
    for k in range(1, len(gr)):
        _, prevg = band(prevg, gr[k])
    # trigger: one slanted band + tip cap (a blade 8 mm thick, 12 mm wide)
    cur[0] = trig_faces
    trig_front_clear = 0.048                               # grip front strap to the blade's rear face
    x_strap_at_trig = (c0 + a * ((c0.z - (GUARD_TOP_Z - 0.006)) / math.cos(r)) + d * (depth(0.04) / 2.0)).x
    x_tr = x_strap_at_trig + trig_front_clear              # trigger's rear face, at the top
    top = [Vector((x_tr, y_c - 0.006, GUARD_TOP_Z + 0.004)), Vector((x_tr + TRIGGER_THICK, y_c - 0.006, GUARD_TOP_Z + 0.004)),
           Vector((x_tr + TRIGGER_THICK, y_c + 0.006, GUARD_TOP_Z + 0.004)), Vector((x_tr, y_c + 0.006, GUARD_TOP_Z + 0.004))]
    tip_shift = 0.007
    tip = [Vector((p.x + tip_shift - (0.001 if p.x == x_tr else 0.0), p.y * 0.8, GUARD_TOP_Z - 0.022)) for p in top]
    tv0, tv1 = band(top, tip)
    tri(tv1[0], tv1[1], tv1[2])
    tri(tv1[0], tv1[2], tv1[3])
    x_trig_face = x_tr
    lop = x_trig_face - BUTT_X
    if not LOP_BAND[0] <= lop <= LOP_BAND[1]:
        raise SystemExit(f"[grip] length of pull {lop:.3f} m is outside {LOP_BAND}: refused")

    # orient every new face outward (the original faces keep the importer's winding)
    def orient(faces, centre):
        for f in faces:
            if f.is_valid and f.normal.dot(f.calc_center_median() - centre(f.calc_center_median())) < 0.0:
                f.normal_flip()
    bm.normal_update()
    orient(grip_faces, lambda p: c0 + a * float((p - c0).dot(a)))
    def bar_centre(p):
        best, bd = None, 1e9
        for (x0, z0), (x1, z1) in zip(path[:-1], path[1:]):
            A, B = Vector((x0, y_c, z0)), Vector((x1, y_c, z1))
            t = max(0.0, min(1.0, float((p - A).dot(B - A)) / float((B - A).length_squared)))
            q = A + (B - A) * t
            if (p - q).length < bd:
                best, bd = q, (p - q).length
        return best
    orient(guard_faces, bar_centre)
    tc = sum((f.calc_center_median() for f in trig_faces), Vector()) / len(trig_faces)
    orient(trig_faces, lambda p: tc)
    for f in grip_faces + guard_faces + trig_faces:
        f.smooth = f in grip_faces
    bm.normal_update()
    tris1 = len(bm.faces)
    tag = bm.faces.layers.int.new("rl_new")
    for f in belly + grip_faces + guard_faces + trig_faces:
        if f.is_valid:
            f[tag] = 1
    bm.to_mesh(me)
    bm.free()
    me.update()
    if tris1 > MAX_TRIS:
        raise SystemExit(f"[grip] {tris1} triangles, the spec's cap is {MAX_TRIS}: refused")

    # -- stations, in the part frame (the spec's 1.3) -------------------------
    s_vis = (c0.z - GRIP_VISIBLE_TOP_Z) / math.cos(r)       # the ring-0 centre is buried above the belly
    grip_axis_pt = c0 + a * (s_vis + GRIP_STATION_BELOW_TOP)
    sup_x = BUTT_X + 0.54
    stations = {
        "grip": dict(point=tuple(round(float(v), 4) for v in grip_axis_pt), axis=tuple(round(float(v), 4) for v in a),
                     u=round(grip_axis_pt.x - BUTT_X, 4), s=round((grip_axis_pt.x - BUTT_X) / 0.845, 3)),
        "support": dict(point=(round(sup_x, 4), round(y_c, 4), round(hg_bottom, 4)),
                        axis_point=(round(sup_x, 4), round(y_c, 4), round(hg_bottom + hg_h / 2.0, 4)), axis=(1.0, 0.0, 0.0),
                        u=0.54, s=round(0.54 / 0.845, 3), section=(round(hg_w, 4), round(hg_h, 4))),
    }
    return dict(tris_before=tris0, tris_after=tris1, block_faces=len(kill), block_dims=block_dims, block_u=block_u,
                added=tris1 - (tris0 - len(kill)), belly_tris=belly_tris, lop=lop,
                trigger_face_u=lop, grip_top_u=u_grip_top, guard_front_x=x_gf, guard_rear_x=x_ga, mag_rear_x=mag_x,
                mag_clear=mag_x - x_gf, y_centre=y_c, rake=RAKE_DEG, depth_mid=float(depth(GRIP_LEN / 2)),
                width=GRIP_WIDTH, length=GRIP_LEN, grip_c0=tuple(c0), grip_axis=tuple(a), stations=stations,
                handguard_section=(hg_w, hg_h))
