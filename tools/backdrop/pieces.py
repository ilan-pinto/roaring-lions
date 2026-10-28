"""The Wadi Halam backdrop kit: the pieces (kit-spec.md section 1).

Each piece is a master heightfield (`kitlib.Master`) plus the masks its colour
needs, a game mesh cut from it on a tensor grid, and a chart in the shared
2048 atlas. Everything is deterministic: noise is `kitlib.vnoise`/`fbm`
(a port of the renderer's own), randomness is `kitlib.tile_hash`, nothing reads
a clock or `mathutils.noise`.

Local frame, as the spec pins it: metres, +Z up in Blender (+Y up in the GLB),
the origin on the floor at the midpoint of the piece's map-facing edge, the
piece extending along local -X (away from the map). In (s, t) terms:
local Y = s (along the edge), local X = -t (out from the map).

The wall family shares "profile W": the cross-section (height against the
distance `t` out from the map) that BOTH ends of every wall variant, the
corner, the head wall and the taper carry exactly, so any piece abuts any other
and mirrors cleanly. Variation lives in the interior and fades to zero at the
nominal ends (|s| = 24 m); a 3 m skirt past each end dips 0.6 m under the
profile so the neighbour's surface hides it.
"""
import math

import numpy as np

import kitlib as K
from kitlib import (worley_edge, CREST_M, KARST, LIME, LIME_LIT, SCRUB, SCRUB_LIT, GRASS, DUST, OLIVE_CANOPY,
                    Master, fbm, vnoise, worley, smooth, tile_hash, box_blur, gradient, horizon_ao)

HALF = 24.0          # a 16-tile module is +-24 m
SKIRT = 3.0          # the 1-tile overlap skirt
SKIRT_DIP = 0.6      # how far under the profile it sits
D_MAX = 135.0


def smin(a, b, k):
    """Smooth minimum (polynomial), `k` metres of rounding."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def env(s, half=HALF, ramp=9.0):
    """1 in the interior, 0 at |s| >= half: where variant detail is allowed."""
    return smooth(half, half - ramp, np.abs(s))


def skirt_dip(s, half=HALF):
    return SKIRT_DIP * smooth(half, half + 1.2, np.abs(s))


# --------------------------------------------------------------------------
# profile W
# --------------------------------------------------------------------------
#: where the second band of wall variant c and of the head wall's cirque step up: shared
#: rows, so every wall-family piece has a vertex on each riser (the profile between them is
#: a straight line, so a neighbour without that detail still meets this one without a crack)
BAND_C_STEPS = [(45.0, 46.4), (46.6, 47.8), (48.0, 49.2)]
BAND_HEAD_STEPS = [(48.0, 49.5), (50.0, 51.0)]
#: texel-density breaks along the distance out (metres): the foot that fills the screen at
#: zoom 2.5, the face and the slope above it, and the far slope that only shows at zoom 0.35
DENS_BREAKS = (24.0, 36.0, 60.0)


class Profile:
    """The wall cross-section as 1D tables over the distance `d` out (metres)."""

    STEP = 0.02
    SIGMA = 0.10           # corner rounding: small enough that a ledge reads as a ledge

    def __init__(self):
        d = np.arange(0.0, D_MAX + 1e-9, self.STEP)
        self.d = d
        anchors = [(0.0, 0.0), (21.0, 4.6), (27.0, 6.0)]
        # the sheer band: five strata, each a steep face and a short bench
        face_h = np.array([1.9, 1.5, 1.8, 1.4, 1.4])
        bench_w = np.array([0.8, 0.55, 0.9, 0.5, 0.0])
        face_w = face_h / 3.2
        x, y = 27.0, 6.0
        bench_mask = []
        face_span = []
        cliff_span = [x]
        corners = [21.0, 27.0]
        for k in range(5):
            face_span.append((x, x + face_w[k]))
            x += face_w[k]
            y += face_h[k]
            anchors.append((x, y))
            corners.append(x)
            if bench_w[k] > 0:
                bench_mask.append((x, x + bench_w[k]))
                x += bench_w[k]
                y += 0.07 * bench_w[k]
                anchors.append((x, y))
                corners.append(x)
        cliff_top_d, cliff_top_y = x, y
        cliff_span.append(x)
        up_a, up_b = 66.0, 69.5
        y_up_a = cliff_top_y + 0.45 * (up_a - cliff_top_d)
        anchors += [(up_a, y_up_a), (up_b, y_up_a + 4.5), (84.0, CREST_M), (D_MAX, CREST_M + 0.04 * (D_MAX - 84.0))]
        corners += [up_a, up_b]
        ad = np.array([a[0] for a in anchors])
        ay = np.array([a[1] for a in anchors])
        # y is piecewise linear between anchors; the crest must land on CREST_M, so the
        # slope above the cliff absorbs any difference
        y = np.interp(d, ad, ay)
        k = int(round(self.SIGMA / self.STEP * 3))
        ker = np.exp(-0.5 * (np.arange(-k, k + 1) * self.STEP / self.SIGMA) ** 2)
        ker /= ker.sum()
        yp = np.pad(y, k, mode="edge")
        self.y = np.convolve(yp, ker, mode="valid")
        self.y -= self.y[0]
        self.slope = np.gradient(self.y, self.STEP)
        bench = np.zeros_like(d)
        for a, b in bench_mask:
            bench[(d >= a - 0.05) & (d <= b + 0.05)] = 1.0
        self.bench = np.convolve(np.pad(bench, k, mode="edge"), ker, mode="valid")
        self.cliff = (smooth(cliff_span[0] - 0.4, cliff_span[0] + 0.2, d) * smooth(cliff_span[1] + 0.4, cliff_span[1] - 0.2, d))
        self.upper = smooth(up_a - 0.5, up_a + 1.0, d)
        self.upper_band = smooth(up_a - 0.4, up_a + 0.2, d) * smooth(up_b + 0.5, up_b - 0.2, d)
        self.foot = smooth(26.0, 19.0, d)
        self.talus = smooth(19.0, 23.5, d) * smooth(cliff_span[0] + 0.5, cliff_span[0] - 0.8, d)
        self.cliff_base_d = cliff_span[0]
        self.cliff_top_d = cliff_top_d
        self.cliff_top_y = cliff_top_y
        self.face_w = face_w
        self.face_span = face_span
        #: every profile kink, then the extra risers, then the density breaks: all are row anchors
        extra = [a for st in BAND_C_STEPS + BAND_HEAD_STEPS for a in st]
        self.anchor_d = sorted(set(round(c, 6) for c in corners + extra + list(DENS_BREAKS)))
        self.lod_anchor_d = sorted(set([21.0, 27.0, round(cliff_top_d, 6), up_a, up_b] + list(DENS_BREAKS)))
        # the stratum step tables: 0 below a face, 1 above it (ledges vary in height along the wall)
        self.strata = [smooth(a, b, d) for a, b in face_span]

    def at(self, dw):
        """Evaluate every table at (an array of) distances."""
        dw = np.clip(dw, 0.0, D_MAX)
        return {
            "y": np.interp(dw, self.d, self.y),
            "bench": np.interp(dw, self.d, self.bench),
            "cliff": np.interp(dw, self.d, self.cliff),
            "upper": np.interp(dw, self.d, self.upper),
            "upper_band": np.interp(dw, self.d, self.upper_band),
            "foot": np.interp(dw, self.d, self.foot),
            "talus": np.interp(dw, self.d, self.talus),
        }

    def strata_steps(self, dw):
        dw = np.clip(dw, 0.0, D_MAX)
        return [np.interp(dw, self.d, t) for t in self.strata]

    def row_importance(self, d):
        """Where spare rows go once every kink has a vertex: the profile is a polyline, so its
        straight runs need none (a face or a bench is exactly one row-interval wide), and the
        rest buys the ribs, rubble and gullies that ride on it."""
        d = np.asarray(d, dtype=np.float64)
        imp = np.full_like(d, 0.6)
        imp = np.where(d >= self.cliff_top_d, 1.0, imp)
        imp = np.where(d >= 66.0, 0.7, imp)
        in_cliff = (d >= self.cliff_base_d) & (d <= self.cliff_top_d)
        return np.where(in_cliff, 0.0, imp)


PROFILE = Profile()

# the rows every wall-family piece shares along t, so neighbours' seam vertices agree
_ROW_D = np.arange(0.0, 84.0 + 1e-9, 0.05)
ROWS_W = K.warped_axis(PROFILE.row_importance(_ROW_D), _ROW_D, 70, 0.0, 84.0, anchors=tuple(PROFILE.anchor_d))


def rows_with_skirt(rows, lo=-SKIRT):
    return np.concatenate([[lo], rows])


# --------------------------------------------------------------------------
# helpers shared by the wall family
# --------------------------------------------------------------------------
def _warp_amp(D, warp_amp):
    return smooth(5.0, 26.0, D) * warp_amp * (0.55 + 0.45 * smooth(26.0, 40.0, D)) + 0.25 * smooth(2.0, 12.0, D)


WARP = 3.6          # metres of rim meander at full strength (the first pass's lookup warp was 1.5, and read as +-0.3)


def rim_shift(S, D, seed, e, warp_amp=WARP):
    """How far (metres, towards the map) the rim of the parameter row `D` sits from where
    a straight wall would put it. The rows of the game mesh follow this, so every ledge is
    exactly one row-interval wide at every column: the meander lives in the vertex positions,
    not in the height field, and so survives the triangle cap."""
    wander = 0.65 * fbm(S, D * 1.0, 24.0, 3, seed + 1) + 0.35 * fbm(S, D * 0.7, 9.0, 2, seed + 2)
    return e * _warp_amp(D, warp_amp) * wander


def strata_offset(S, D, seed, amp):
    """Each stratum's face is taller or shorter from place to place, so the ledges of a
    wall step in and out along it instead of running level. The offsets fade out over the
    scrub slope above, so the crest line stays where profile W puts it."""
    st = PROFILE.strata_steps(D)
    out = np.zeros_like(D)
    for k, step in enumerate(st):
        out += amp * (0.8 * vnoise(S, 40.0 * (k + 1), 7.0 + 2.0 * k, seed + 30 + k) + 0.5 * vnoise(S, 17.0 * (k + 1), 2.9, seed + 50 + k)) * step
    return out * (1.0 - smooth(38.0, 84.0, D))


def wall_surface(M, seed, e_fn, warp_amp=WARP, rib_amp=0.5, strata_amp=0.42):
    """Profile W with variant detail scaled by `e_fn(s)` (0 at the nominal ends).

    Returns (H, fields) over the PARAMETER plane (s, d): d is the profile distance, and the
    rim meander is `f["shift"]` / `f["world"]` (vertex positions), not a lookup warp.
    """
    return wall_field(M.S, M.T, seed, e_fn, warp_amp, rib_amp, strata_amp)


def wall_field(S, T, seed, e_fn, warp_amp=WARP, rib_amp=0.5, strata_amp=0.42):
    e = e_fn(S)
    shift = rim_shift(S, T, seed, e, warp_amp)
    f = PROFILE.at(T)
    H = f["y"].copy()
    # ribs and swales that run down the fall line, strongest on the scrub slope
    slopezone = smooth(30.0, 38.0, T) * (1.0 - 0.6 * f["upper_band"])
    rib = vnoise(S, T * 0.12, 4.2, seed + 3) * 0.7 + vnoise(S, T * 0.12, 9.0, seed + 4) * 0.3
    H += e * rib_amp * slopezone * rib * (1.0 + 0.8 * smooth(30, 60, T))
    # rubble scale: broad on the scrub, fine in the foot
    H += e * 0.16 * fbm(S, T, 2.4, 3, seed + 5) * (0.3 + 0.7 * smooth(10, 35, T))
    # fine grain: the shared 1D grain at the ends, the 2D grain inside
    H += 0.05 * (e * fbm(S, T, 0.9, 2, seed + 6) + (1.0 - e) * fbm(0.0 * S, T, 0.9, 2, 6))
    # columnar jointing in the sheer band: narrow grooves, a colour attribute too
    jn = vnoise(S * 1.0, T * 4.0, 2.1, seed + 7)
    joint = e * smooth(0.80, 0.97, 1.0 - np.abs(jn)) * f["cliff"] * (1.0 - f["bench"])
    H -= 0.16 * joint
    H += e * strata_offset(S, T, seed, strata_amp)
    f["joint"] = joint
    f["dw"] = T
    f["shift"] = shift
    f["world"] = lambda SS, VV: (SS, VV - rim_shift(SS, VV, seed, e_fn(SS), warp_amp))
    f["e"] = e
    return H, f


def finish_wall(M, H, f, seed, half=HALF, front_dip=True):
    """Front and end skirts, then the derived fields every shader needs."""
    S, T = M.S, M.T
    H = H - skirt_dip(S, half)
    if front_dip:
        H = H - 0.5 * smooth(2.5, 0.0, T)
    return H


def add_boulders(M, H, centres_fn, seed, n, rmin, rmax, smin_t, smax_t, smax_s):
    """Strew boulders: spherical caps on the existing surface. Deterministic."""
    mask = np.zeros_like(H)
    for k in range(n):
        s0 = (tile_hash(k, seed) * 2 - 1) * smax_s
        t0 = smin_t + tile_hash(k + 97, seed + 1) * (smax_t - smin_t)
        r = rmin + (rmax - rmin) * tile_hash(k + 211, seed + 2) ** 1.7
        i0 = int((s0 - r - M.s[0]) / M.h)
        i1 = int((s0 + r - M.s[0]) / M.h) + 2
        j0 = int((t0 - r - M.t[0]) / M.h)
        j1 = int((t0 + r - M.t[0]) / M.h) + 2
        i0, j0 = max(i0, 0), max(j0, 0)
        i1, j1 = min(i1, M.ns), min(j1, M.nt)
        if i1 <= i0 or j1 <= j0:
            continue
        ss = M.S[j0:j1, i0:i1] - s0
        tt = M.T[j0:j1, i0:i1] - t0
        # a lumpy, slightly flattened block rather than a ball
        lump = 1.0 + 0.16 * vnoise(ss, tt, r * 0.9, seed + k)
        q = np.hypot(ss, tt * 1.15) / (r * lump)
        cap = np.sqrt(np.clip(1.0 - q * q, 0.0, 1.0))
        base = H[j0 + (j1 - j0) // 2, i0 + (i1 - i0) // 2]
        top = base + (0.75 * r * cap - 0.25 * r)
        inside = q < 1.0
        newH = np.where(inside, np.maximum(H[j0:j1, i0:i1], top), H[j0:j1, i0:i1])
        H[j0:j1, i0:i1] = newH
        mask[j0:j1, i0:i1] = np.maximum(mask[j0:j1, i0:i1], inside * (0.6 + 0.4 * tile_hash(k, 5)))
    return H, mask


def fan(M, s_apex, t_apex, R, height, toward=-1.0, spread=1.0):
    """A scree cone: highest at the apex, thinning out `R` metres away towards the map."""
    ds = (M.S - s_apex) / spread
    dt = (M.T - t_apex) * toward
    r = np.hypot(ds, dt)
    sector = smooth(-4.0, 3.0, dt)  # only on the downhill side of the apex line
    return height * (1.0 - smooth(R * 0.1, R, r)) ** 1.15 * sector


def derive(M, H, f, seed, extra=None):
    """Slope, ambient occlusion and the rest of the shading inputs."""
    Hb = box_blur(H, 2)
    gs, gt = gradient(Hb, M.h)
    f = dict(f)
    f["H"] = H
    f["sl"] = np.hypot(gs, gt)
    f["ao"] = horizon_ao(H, M.h)
    f["ao_f"] = horizon_ao(H, M.h, radii=(0.16, 0.32, 0.64, 1.3), ndir=12)
    if extra:
        f.update(extra)
    return f


# --------------------------------------------------------------------------
# shading: palette keys only
# --------------------------------------------------------------------------
def olive_dots(S, T, seed, spacing=4.4, radius=1.5, mask=None):
    """Olive canopies on a jittered grid. Returns (canopy weight, shade weight, tone)."""
    cx = np.floor(S / spacing)
    cz = np.floor(T / spacing)
    wgt = np.zeros_like(S)
    shd = np.zeros_like(S)
    tone = np.zeros_like(S)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ix = cx + di
            iz = cz + dj
            px = (ix + 0.2 + 0.6 * tile_hash(ix + seed, iz + 3)) * spacing
            pz = (iz + 0.2 + 0.6 * tile_hash(ix + 5, iz + seed)) * spacing
            has = tile_hash(ix * 3 + seed, iz * 7 + 1) < 0.78
            r = radius * (0.8 + 0.5 * tile_hash(ix + 19, iz + 23))
            d = np.hypot(S - px, T - pz)
            w = smooth(r, r * 0.55, d) * has
            sd = smooth(r * 1.15, r * 0.6, np.hypot(S - px + 0.6, T - pz - 0.5)) * has
            upd = w > wgt
            tone = np.where(upd, tile_hash(ix + 41, iz + 43), tone)
            wgt = np.maximum(wgt, w)
            shd = np.maximum(shd, sd)
    return wgt, shd, tone


def shade_land(M, f, seed, style="wall", rock_bias=0.0):
    """Colour for terrain pieces: cliff, scrub, scree streaks, foot pasture.

    Everything is a palette ladder walked by a float index; ambient occlusion
    pushes the index darker. Shapes are domain-warped so nothing reads as a
    grid of dots; strata band the rock by height; scree runs down the fall line.
    """
    S, T, H, sl, ao = M.S, M.T, f["H"], f["sl"], f["ao"]
    wS = S + 6.0 * fbm(S, T, 19.0, 2, seed + 90)
    wT = T + 6.0 * fbm(S + 31.0, T, 19.0, 2, seed + 91)
    n_big = fbm(wS, wT, 40.0, 3, seed + 11)
    n_mid = fbm(wS, wT, 12.0, 3, seed + 12)
    n_fine = vnoise(S, T, 2.3, seed + 13)
    n_tiny = vnoise(S, T, 0.55, seed + 14)
    fall = vnoise(wS, wT * 0.11, 6.5, seed + 15) * 0.65 + vnoise(wS, wT * 0.08, 16.0, seed + 16) * 0.5
    z = lambda k: f.get(k, np.zeros_like(H))
    bench, cliff, upper, upper_band = z("bench"), z("cliff"), z("upper"), z("upper_band")
    foot, talus, joint, gully, scree_x = z("foot"), z("talus"), z("joint"), z("gully"), z("scree")
    boulder = z("boulder")
    hn = np.clip(H / CREST_M, 0.0, 1.4)
    if style == "crest":
        hn = np.full_like(H, 1.0)
        foot = np.zeros_like(H)
    dark = (1.0 - ao)

    # ---- vegetation: dark maquis with olive-grey clearings, ravines and sunlit ribs
    shrub_d, shrub_id = worley(wS, wT, 1.1, seed + 17)
    shrub = smooth(0.75, 0.3, shrub_d)
    idx_v = 1.75 + 0.85 * n_big + 0.6 * n_mid + 0.25 * n_fine + 0.12 * n_tiny + 0.55 * shrub * (shrub_id - 0.5)
    ravine = smooth(0.30, 0.75, -fall) * smooth(0.25, 0.5, sl)
    ribs = smooth(0.40, 0.85, fall) * smooth(0.55, 0.3, sl)
    idx_v += 1.5 * ravine - 0.45 * ribs + 2.6 * dark ** 1.2
    veg = SCRUB_LIT.at(np.clip(idx_v, 0, 5))

    # ---- strata: the rock bands by height, wandering with the noise
    ph = H / 2.3 + 1.1 * n_mid + 0.35 * n_big
    bnd = np.abs((ph - np.floor(ph)) - 0.5) * 2.0
    ph2 = H / 0.55 + 2.0 * n_fine
    bnd2 = np.abs((ph2 - np.floor(ph2)) - 0.5) * 2.0

    # ---- the bare rock of the upper wall, and the crest: grey karst over warm limestone
    bare_w = smooth(0.50 + rock_bias * 0.5, 0.78, hn + 0.16 * n_big + 0.08 * n_mid)
    bare_w = np.maximum(bare_w, 0.85 * upper_band)
    if style == "crest":
        bare_w = np.clip(0.6 + 0.5 * smooth(-0.3, 0.4, n_big), 0, 1)
    idx_k = 0.55 + 1.15 * bnd + 0.9 * n_mid + 0.35 * n_fine + 0.15 * bnd2 + 2.8 * dark ** 1.25
    k1, k2, kid = worley_edge(S, H * 1.1, 2.6, seed + 26)
    idx_k += 0.8 * (kid - 0.5) + 0.8 * smooth(0.06, 0.0, k2 - k1) + 1.8 * (1 - f["ao_f"]) ** 1.2
    karst = KARST.at(np.clip(idx_k, 0, 4))
    warm = LIME_LIT.at(np.clip(1.0 + 1.3 * bnd + 0.8 * n_mid + 3.0 * dark ** 1.2, 0, 8))
    bare = K.mix(karst, warm, 0.38 + 0.3 * smooth(-0.2, 0.5, n_big))
    veg_keep = smooth(0.45, 0.15, sl) * smooth(0.0, 0.7, -n_big + 0.35) * (1.0 - upper_band)
    bare_w = bare_w * (1.0 - 0.7 * veg_keep) * smooth(0.12, 0.35, sl + 0.25)
    col = K.mix(veg, bare, bare_w)

    # ---- scree: pale streaks down the fall line, wider as they go
    st = vnoise(wS, wT * 0.07, 2.6, seed + 18) * 0.7 + vnoise(wS, wT * 0.05, 7.0, seed + 19) * 0.5
    width = 0.20 + 0.16 * smooth(0, 1, fbm(wS, wT, 25.0, 2, seed + 20) + 0.5)
    streak = smooth(width + 0.06, width + 0.30, st)
    zone = smooth(0.30, 0.5, sl) * smooth(1.05, 1.45, sl) ** 0 * (1.0 - smooth(1.0, 1.5, sl)) * smooth(18.0, 30.0, T if style != "crest" else T + 60)
    chips_d, chips_id = worley(S, T, 0.34, seed + 20)
    idx_c = 0.25 + 1.2 * chips_id + 1.0 * smooth(0.5, 1.0, chips_d) + 0.5 * n_fine + 2.4 * dark ** 1.3
    chip = KARST.at(np.clip(idx_c, 0, 4))
    sc_w = np.clip(streak * zone * (1.0 - 0.7 * foot) + 0.9 * talus + 0.85 * gully + scree_x, 0.0, 1.0)
    col = K.mix(col, chip, sc_w * (0.85 + 0.15 * n_fine))

    # ---- the rock face: steep ground, outcrops on mid slopes, the sheer band
    rock = smooth(0.78 + rock_bias, 1.30 + rock_bias, sl + 0.25 * n_mid + 0.12 * n_fine)
    rock = np.maximum(rock, 0.7 * cliff * (1 - bench))
    rock *= (1.0 - 0.85 * bench)
    stain = smooth(0.28, 0.70, vnoise(S, T * 0.17, 1.2, seed + 21) + 0.3 * n_mid) * smooth(0.9, 1.6, sl)
    ironw = smooth(0.35, 0.8, fbm(S, T * 1.7, 14.0, 2, seed + 22))
    idx_r = 0.55 + 0.95 * bnd + 0.8 * n_big + 0.5 * n_mid + 0.28 * n_fine + 0.12 * n_tiny + 0.35 * bnd2 - 0.5 * bench
    b1, b2, bid = worley_edge(S, H * 1.35, 1.7, seed + 25)
    blk = smooth(0.07, 0.0, b2 - b1) * smooth(-0.3, 0.4, n_mid)
    idx_r += 1.9 * stain + 2.2 * joint + 3.1 * dark ** 1.15 + 0.9 * (bid - 0.5) + 1.1 * blk + 2.4 * (1 - f["ao_f"]) ** 1.2
    face = LIME.at(np.clip(idx_r, 0, 8))
    face = K.mix(face, DUST.at(np.clip(0.8 + 1.0 * n_mid + 2.0 * dark, 0, 6)), 0.45 * ironw * (1 - 0.6 * stain))
    col = K.mix(col, face, rock * (1.0 - 0.45 * sc_w))

    # ---- a slot cut into the wall (wall b): the deeper, the darker, down to the shadow ramp
    sdark = z("slot_dark")
    if np.any(sdark > 0):
        sdep = z("slot_depth")
        idx_s = 0.3 + 2.5 * smooth(0.4, 6.0, sdep) + 0.55 * n_fine + 0.4 * n_mid + 0.9 * dark
        slot_c = K.SLOT.at(np.clip(idx_s, 0, 4))
        col = K.mix(col, slot_c, np.clip(sdark * 1.2, 0, 1) * 0.97)

    # ---- scrub tufts on the ledges of the sheer band
    tuft = smooth(0.2, 0.7, bench * (0.5 + 0.5 * n_fine + 0.3 * shrub))
    col = K.mix(col, SCRUB.at(np.clip(0.6 + 1.0 * n_fine + 2.0 * dark, 0, 4)), tuft * 0.8)

    # ---- boulders from a rockfall
    if np.any(boulder > 0):
        b_idx = 1.3 + 1.1 * n_fine + 2.8 * dark ** 1.2
        col = K.mix(col, LIME.at(np.clip(b_idx, 0, 8)), np.clip(boulder, 0, 1) * 0.95)

    # ---- foot pasture with olive dots
    if np.any(foot > 0):
        pas_p = smooth(-0.3, 0.5, n_big)
        pas = K.mix(GRASS.at(np.clip(2.2 + 1.2 * n_mid + 0.6 * n_fine + 2.0 * dark, 0, 5)),
                    DUST.at(np.clip(1.4 + 1.5 * n_mid + 0.5 * n_fine, 0, 6)), 0.5 * pas_p)
        con = 0.5 + 0.5 * np.sin(2 * math.pi * (T / 2.3 + 0.7 * vnoise(S, T, 14.0, seed + 23)))
        pas = K.mix(pas, GRASS.at(np.clip(3.4 + 0.5 * n_fine, 0, 5)), 0.10 * smooth(0.90, 1.0, con))
        w_o, w_s, t_o = olive_dots(S, T, seed + 24, spacing=4.0, radius=1.2)
        pas = K.mix(pas, SCRUB.at(np.full_like(H, 2.4)), 0.30 * w_s * (1 - w_o))
        pas = K.mix(pas, GRASS.at(np.clip(3.0 + 1.6 * t_o + 0.5 * n_tiny + 1.2 * dark, 0, 5)), w_o * 0.7)
        fw = foot * (1.0 - smooth(0.4, 0.8, sl))
        col = K.mix(col, pas, fw)
    return np.clip(col, 0.0, 1.0)


def shade_near(M, f, seed):
    """Rolling scrub hills with olive stands, terrace patches and a track."""
    S, T, H, sl, ao = M.S, M.T, f["H"], f["sl"], f["ao"]
    n_big = fbm(S, T, 40.0, 3, seed + 31)
    n_mid = fbm(S, T, 9.0, 3, seed + 32)
    n_fine = vnoise(S, T, 1.7, seed + 33)
    n_tiny = vnoise(S, T, 0.5, seed + 34)
    shrub_d, shrub_id = worley(S, T, 1.7, seed + 35)
    shrub = smooth(0.8, 0.4, shrub_d)
    idx = 1.8 + 0.9 * n_big + 0.8 * n_mid + 0.3 * n_fine + 0.7 * shrub * (shrub_id - 0.3) + 2.0 * (1 - ao) ** 1.2
    col = SCRUB_LIT.at(np.clip(idx, 0, 5))
    # pasture and ploughed patches where it is flat
    flat = smooth(0.42, 0.18, sl) * smooth(-0.1, 0.45, n_mid)
    pas = K.mix(GRASS.at(np.clip(2.1 + 1.1 * n_mid + 0.5 * n_fine, 0, 5)), DUST.at(np.clip(1.5 + 1.1 * n_mid, 0, 6)), 0.55 * smooth(-0.1, 0.6, n_big))
    col = K.mix(col, pas, flat * 0.9)
    # terrace patch edges: the risers bake as pale stone lines
    ter = f.get("terrace", np.zeros_like(H))
    riser = f.get("riser", np.zeros_like(H))
    col = K.mix(col, LIME.at(np.clip(4.0 + 1.2 * n_fine + 2.4 * (1 - ao), 0, 8)), np.clip(riser, 0, 1) * 0.45)
    # olive stands
    w_o, w_s, t_o = olive_dots(S, T, seed + 36, spacing=4.6, radius=1.5)
    stand = smooth(0.0, 0.55, fbm(S, T, 24.0, 2, seed + 37)) * smooth(12.0, 30.0, T)
    col = K.mix(col, SCRUB.at(np.full_like(H, 2.8)), 0.55 * w_s * (1 - w_o) * stand)
    col = K.mix(col, OLIVE_CANOPY.at(0.2 + 1.2 * t_o + 0.6 * n_tiny + 1.0 * (1 - ao)), w_o * stand * 0.9)
    # the track: a dust ribbon
    tr = f.get("track", np.zeros_like(H))
    col = K.mix(col, DUST.at(np.clip(0.9 + 1.4 * n_fine + 2.0 * (1 - ao), 0, 6)), np.clip(tr, 0, 1) * 0.85)
    # bare limestone outcrops
    out = smooth(0.62, 0.95, sl + 0.25 * n_mid)
    col = K.mix(col, LIME.at(np.clip(2.0 + 1.0 * n_fine + 3.0 * (1 - ao), 0, 8)), out * 0.7)
    return np.clip(col, 0.0, 1.0)


def shade_terrace(M, f, seed):
    """Treads with furrows and olives; risers of dry-stone courses."""
    S, T, H, sl, ao = M.S, M.T, f["H"], f["sl"], f["ao"]
    n_mid = fbm(S, T, 7.0, 3, seed + 41)
    n_fine = vnoise(S, T, 1.2, seed + 42)
    n_tiny = vnoise(S, T, 0.4, seed + 43)
    riser = smooth(0.7, 1.7, sl)
    # --- tread: grass and dust, ploughed along the contour
    furrow = 0.5 + 0.5 * np.sin(2 * math.pi * (T / 0.95 + 0.25 * vnoise(S, T, 6.0, seed + 44)))
    p = smooth(-0.2, 0.5, n_mid + 0.25 * f.get("tread_bias", 0.0))
    tread = K.mix(GRASS.at(np.clip(2.0 + 1.0 * n_fine + 0.8 * n_mid, 0, 5)), DUST.at(np.clip(1.3 + 1.0 * n_fine + 0.9 * (1 - furrow), 0, 6)), 0.62 * p)
    tread = K.mix(tread, DUST.at(np.clip(2.6 + 0.8 * n_tiny, 0, 6)), 0.25 * smooth(0.55, 0.95, furrow) * (1 - p))
    # olive trunks stand in a row along each tread; their canopies bake as dots
    w_o, w_s, t_o = olive_dots(S, T, seed + 45, spacing=3.6, radius=1.25)
    tread = K.mix(tread, SCRUB.at(np.full_like(H, 2.2)), 0.35 * w_s * (1 - w_o))
    tread = K.mix(tread, OLIVE_CANOPY.at(0.0 + 1.0 * t_o + 0.4 * n_tiny + 1.0 * (1 - ao)), w_o * 0.75)
    # --- riser: dry-stone courses, each course a ring of stones of varied size
    ch = H / 0.30
    cid = np.floor(ch)
    cf = ch - cid
    off = tile_hash(cid.astype(np.int64), 3) * 0.9
    sidx = np.floor((S + off) / (0.5 + 0.25 * tile_hash(cid.astype(np.int64), 9)))
    sf = ((S + off) / (0.5 + 0.25 * tile_hash(cid.astype(np.int64), 9))) - sidx
    tone = tile_hash(sidx.astype(np.int64) * 7, cid.astype(np.int64) + 5)
    mortar = np.maximum(smooth(0.16, 0.0, cf), smooth(0.07, 0.0, sf))
    stone_idx = 1.9 + 1.5 * tone + 0.5 * n_fine + 0.9 * (cf - 0.5) ** 2 * 4 * 0.3
    stone_idx = stone_idx + 2.6 * mortar + 1.6 * (1 - ao) ** 1.2
    stone = LIME.at(np.clip(stone_idx, 0, 8))
    moss = smooth(0.5, 0.9, vnoise(S, T, 2.5, seed + 46)) * smooth(0.3, 0.0, cf)
    stone = K.mix(stone, SCRUB.at(np.full_like(H, 1.0)), 0.3 * moss)
    col = K.mix(tread, stone, riser)
    # the foot of each riser is shaded, the rim of each tread a touch lit
    return np.clip(col, 0.0, 1.0)


def shade_scree(M, f, seed):
    S, T, H, sl, ao = M.S, M.T, f["H"], f["sl"], f["ao"]
    n_mid = fbm(S, T, 6.0, 3, seed + 51)
    chips_d, chips_id = worley(S, T, 0.34, seed + 52)
    blocks_d, blocks_id = worley(S, T, 1.4, seed + 53)
    rill = vnoise(S * 1.0, T * 0.5, 1.6, seed + 54)
    idx = 0.4 + 1.3 * chips_id + 1.0 * smooth(0.5, 1.0, chips_d) + 0.9 * n_mid + 0.6 * smooth(0.1, 0.7, blocks_d) * (blocks_id - 0.5)
    idx += 1.1 * smooth(0.2, 0.7, np.abs(rill)) * 0.0 + 1.3 * smooth(0.3, -0.5, rill) + 2.4 * (1 - ao) ** 1.2
    col = KARST.at(np.clip(idx, 0, 4))
    # boulders
    bo = f.get("boulder", np.zeros_like(H))
    col = K.mix(col, LIME.at(np.clip(1.7 + 1.2 * chips_id + 3.0 * (1 - ao) ** 1.2, 0, 8)), np.clip(bo, 0, 1) * 0.9)
    # the fringe blends into scrub: a ring of low, green rubble
    rim = smooth(0.7, 0.0, f["Hcone"])
    idxs = 1.0 + 1.0 * n_mid + 2.0 * (1 - ao)
    col = K.mix(col, SCRUB_LIT.at(np.clip(idxs, 0, 5)), rim * 0.85)
    return np.clip(col, 0.0, 1.0)


# --------------------------------------------------------------------------
# the pieces
# --------------------------------------------------------------------------
def wall_dens(s0, s1, v0, v1):
    """Texel density multiple by distance out. The ramp (0-24 m) is mostly under the terrace
    pieces; the sheer band and the shelf at its foot (24-36 m) are what zoom 1 and 2.5 look
    at; the scrub slope above is seen at 0.35 and 1 only, the far slope at 0.35 alone."""
    if v1 <= DENS_BREAKS[0] + 1e-6:
        return 1.0
    if v1 <= DENS_BREAKS[1] + 1e-6:
        return 1.6
    if v1 <= DENS_BREAKS[2] + 1e-6:
        return 0.7
    return 0.45


WALL_BLUR = (0.45, 0.14)     # along the wall (columns are 0.75 m apart) and across it (a ledge is 0.5 m)


class Piece:
    """One kit piece, built. See `build`.

    `axes(M, f)` gives the parameter axes (s, v) of the game mesh; `f["world"]` (if the
    builder sets one) maps a parameter point to where it stands in the piece's plan, so
    the rows of a wall can follow its meandering rim. `v_breaks` / `s_breaks` cut the
    parameter plane into atlas charts, each at its own density (`dens`).
    """

    def __init__(self, name, side, cap, ppm, builder, seed, s_range, t_range, cell, axes, desc, anchors=None,
                 blur=(0.45, 0.45), s_breaks=(), v_breaks=(), dens=None, lod_s=(), lod_v=()):
        self.name, self.side, self.cap, self.ppm = name, side, cap, ppm
        self.builder, self.seed = builder, seed
        self.s_range, self.t_range, self.cell = s_range, t_range, cell
        self.axes = axes
        self.desc = desc
        self.anchors = anchors or []
        self.blur = blur
        self.s_breaks, self.v_breaks = tuple(s_breaks), tuple(v_breaks)
        self.dens = dens or (lambda s0, s1, v0, v1: 1.0)
        self.lod_s, self.lod_v = tuple(lod_s), tuple(lod_v)
        self.M = self.f = self.gm = self.rgb = None
        self.charts = None
        self.extra = {}

    def build(self):
        M = Master(self.s_range[0], self.s_range[1], self.t_range[0], self.t_range[1], self.cell)
        self.M = M
        out = self.builder(M, self.seed)
        H, f = out[0], out[1]
        self.f = derive(M, H, f, self.seed)
        sv, vv = self.axes(M, self.f)
        self.world = self.f.get("world")
        self.gm = K.GameMesh(M, H, sv, vv, self.blur, self.world)
        if self.gm.tri_count > self.cap:
            raise RuntimeError("%s: %d tris over its cap %d" % (self.name, self.gm.tri_count, self.cap))
        self.charts = K.make_charts(self.name, self.gm, self.s_breaks, self.v_breaks, self.dens)
        return self

    def lod1(self, ratio=0.59):
        """The LOD1 mesh over the same parameter plane (chart breaks and seams are vertices)."""
        sv1, vv1 = K.lod_axes(self.M, self.f["H"], self.gm, ratio,
                              s_anchors=tuple(self.lod_s) + tuple(self.s_breaks), v_anchors=tuple(self.lod_v) + tuple(self.v_breaks))
        return K.GameMesh(self.M, self.f["H"], sv1, vv1, self.blur, self.world)


def axis(*parts):
    """parts: (lo, hi, step) segments joined; seams are shared vertices."""
    out = [np.linspace(lo, hi, int(round((hi - lo) / step)) + 1) for lo, hi, step in parts]
    v = out[0]
    for o in out[1:]:
        v = np.concatenate([v, o[1:]])
    return v


# ---- walls ---------------------------------------------------------------
def wall_cols(dense=None):
    """The columns of a wall-family piece: coarse near the two ends (where the surface is the
    shared profile and carries no variant detail), 0.75 m inside, and, where a variant has
    a feature narrower than that (wall b's gully), 0.5 m across it. Same count either way."""
    end = np.linspace(HALF, 15.0, 7)                    # 1.5 m steps over the envelope's ramp
    if dense is None:
        mid = np.linspace(-15.0, 15.0, 41)
    else:
        lo, hi = dense
        mid = np.concatenate([np.arange(-15.0, lo, 1.0), np.arange(lo, hi, 0.5), np.arange(hi, 15.0 + 1e-9, 1.0)])
        mid = np.unique(np.round(mid, 6))
    left = -end
    cols = np.concatenate([[-HALF - SKIRT], left, mid, end[::-1], [HALF + SKIRT]])
    return np.unique(np.round(cols, 6))


def _wall_axes(variant):
    def fn(M, f):
        return wall_cols((-7.0, 3.0) if variant == "b" else None), ROWS_W.copy()
    return fn


def gully_centre(T, amp=2.2):
    return -2.0 + amp * np.sin(T / 15.0 + 0.6)


def build_wall(variant):
    def builder(M, seed):
        S, T = M.S, M.T
        H, f = wall_surface(M, seed, env)
        e = f["e"]
        gully = np.zeros_like(H)
        scree = np.zeros_like(H)
        boulder = np.zeros_like(H)
        slot = np.zeros_like(H)
        slot_floor = np.zeros_like(H)
        if variant == "b":
            # a slot cut back into the wall: narrow, steep-sided, floor climbing slower than the
            # wall so it deepens up the slope; a scree cone at its mouth
            s0 = gully_centre(T)
            x = S - s0
            x = x + 0.5 * vnoise(S, T, 5.0, seed + 62) * smooth(24, 40, T)
            w = 1.6 + 0.032 * np.clip(T - 22.0, 0, 60)
            floor = PROFILE.at(np.full_like(T, 22.0))["y"] + 0.30 * np.clip(T - 22.0, 0, None)
            floor = floor + 0.14 * vnoise(S, T, 3.0, seed + 61)
            out = np.maximum(np.abs(x) - w / 2, 0.0)
            bank = 2.7 * out * (1.0 + 0.45 * smooth(0.0, 4.0, out))
            Hg = smin(H, floor + bank, 0.30)
            cut = e * smooth(24.0, 30.0, T)
            H = H * (1 - cut) + Hg * cut
            depth = f["y"] - H
            slot = np.clip(smooth(0.4, 2.0, depth) * cut, 0, 1) * smooth(w / 2 + 3.4, w / 2 + 0.8, np.abs(x))
            slot_floor = np.clip(cut * smooth(w / 2 + 0.7, w / 2 - 0.1, np.abs(x)), 0, 1)
            f["slot_depth"] = np.clip(depth * cut, 0.0, None)
            fa = fan(M, float(gully_centre(26.0)), 27.0, 17.0, 3.0, spread=0.7)
            fa *= e
            # the cone rides the foot slope
            H = H + fa
            scree = np.clip(smooth(0.35, 1.6, fa), 0, 1)
            f["anchor_gully"] = (float(gully_centre(26.0)), 26.0)
        if variant == "c":
            # a second band with a rockfall below it: three risers, each its own height along the wall
            hts = [0.55, 0.25, 0.20]
            sh = np.zeros_like(H)
            for k, ((a0, a1), h0) in enumerate(zip(BAND_C_STEPS, hts)):
                sh += 5.6 * h0 * (0.72 + 0.36 * (0.5 + 0.5 * vnoise(S, 9.0 * k + 3.0, 8.0, seed + 66 + k))) * smooth(a0, a1, T)
            sh *= (1.0 - smooth(52.0, 66.0, T)) * e
            H = H + sh
            f["cliff"] = np.maximum(f["cliff"], smooth(44.8, 45.6, T) * smooth(49.8, 49.0, T) * e)
            f["bench"] = np.maximum(f["bench"], smooth(46.1, 46.6, T) * smooth(46.9, 46.6, T) * e * 0.7)
            H, bo1 = add_boulders(M, H, None, seed + 64, 34, 0.5, 1.7, 36.0, 45.0, 16.0)
            H, bo2 = add_boulders(M, H, None, seed + 65, 18, 0.45, 1.3, 20.0, 27.0, 14.0)
            boulder = np.maximum(bo1, bo2) * e
            scree = np.clip(smooth(36, 44, T) * smooth(48, 44.5, T) * 0.55 * e, 0, 1)
            f["anchor_gully"] = None
        H = finish_wall(M, H, f, seed)
        f["gully"], f["scree"], f["boulder"] = gully, scree, boulder
        f["slot_dark"], f["slot_floor"] = slot, slot_floor
        f["edge_w"], f["edge_d"], f["edge_family"] = smooth(24.0, 18.0, np.abs(S)), T, "wall"
        return H, f
    return builder


def wall(variant, seed):
    descr = {"a": "continuous cliff band", "b": "a narrow slot cut back into the wall, a scree cone at its mouth",
             "c": "double band with a rockfall"}[variant]
    p = Piece("bd_wall_far_" + variant, "far", 8000, 8.0, build_wall(variant), seed,
              (-SKIRT - HALF, SKIRT + HALF), (0.0, 84.0), 0.08, _wall_axes(variant), descr,
              blur=WALL_BLUR, v_breaks=DENS_BREAKS, dens=wall_dens, lod_s=(-HALF, HALF), lod_v=tuple(PROFILE.lod_anchor_d))
    return p


# ---- corner ---------------------------------------------------------------
def _corner_axes(M, f):
    a = rows_with_skirt(ROWS_W)
    return a, a


def _corner_e(along, out):
    """Variant detail for the corner: none on the two faces (s = 0, t = 0: profile W exactly)
    and none on the mitre (a = b, where the two walls meet and the mesh has a vertex), so the
    faces and the crease are exact and everything between them meanders."""
    return smooth(0.0, 14.0, along) * smooth(0.0, 10.0, out - along)


CORNER_SEED = 404


def build_corner(M, seed):
    S, T = M.S, M.T          # s = b (out from the head edge), t = a (out from the west edge)
    A = np.maximum(T, 0.0)
    B = np.maximum(S, 0.0)
    # a concave corner is the union of two walls: height = profile of the larger distance. The
    # surface is one wall's field with (along, out) = (min, max), mirrored across the diagonal,
    # so each half is a wall the mesh rows follow, and the diagonal is a clean mitre crease.
    along = np.minimum(S, T)
    out = np.maximum(S, T)

    H, f = wall_field(along, out, seed, lambda al: _corner_e(al, out), WARP, 0.55)
    e = f["e"]
    dn = np.maximum(out, 0.0)
    # the couloir: a scree-filled gully down the diagonal, a fan at its mouth
    c = (T - S) / math.sqrt(2.0)
    c = c + 0.9 * vnoise(S, T, 8.0, seed + 9)
    w = 3.4 + 0.09 * np.clip(dn - 22.0, 0, 60)
    floor = PROFILE.at(np.full_like(dn, 23.0))["y"] + 0.33 * np.clip(dn - 23.0, 0, None) + 0.25 * vnoise(S, T, 3.0, seed + 8)
    bank = 1.35 * np.maximum(np.abs(c) - w / 2, 0.0) * (1.0 + 0.5 * smooth(0.0, 6.0, np.maximum(np.abs(c) - w / 2, 0.0)))
    Hg = smin(H, floor + bank, 0.45)
    cut = smooth(24.0, 31.0, dn) * smooth(0, 12, np.minimum(S, T))
    H = H * (1 - cut) + Hg * cut
    gully = np.clip(smooth(0.3, 1.6, f["y"] - H) * cut, 0, 1) * smooth(w / 2 + 3.5, w / 2 - 0.5, np.abs(c))
    # the fan
    ap = 17.0
    r = np.hypot(T - ap, S - ap)
    sector = smooth(5.0, -2.0, (T + S) - 2 * ap + 8.0)
    fa = 3.6 * (1.0 - smooth(1.5, 17.0, r)) ** 1.15 * sector * smooth(0, 10, np.minimum(S, T))
    H += fa
    scree = np.clip(smooth(0.35, 1.6, fa), 0, 1)
    # skirts: dip under the profile past both open faces; and the front corner
    dip = SKIRT_DIP * np.maximum(smooth(0.0, -1.2, S), smooth(0.0, -1.2, T))
    H = H - dip - 0.5 * smooth(2.5, 0.0, dn)
    f["gully"], f["scree"] = gully, scree
    f["boulder"] = np.zeros_like(H)
    f["anchor_gully"] = (ap * 0.98, ap * 0.98)
    f["edge_w"], f["edge_d"], f["edge_family"] = smooth(0.0, 8.0, S) * smooth(0.0, 8.0, T), dn, "wall"

    def world(SS, VV):
        al, ou = np.minimum(SS, VV), np.maximum(SS, VV)
        sh = rim_shift(al, ou, seed, _corner_e(al, ou), WARP)
        return np.where(VV >= SS, SS, SS - sh), np.where(VV >= SS, VV - sh, VV)
    f["world"] = world
    return H, f


def corner_dens(s0, s1, v0, v1):
    lo = max(s0, v0)
    if lo < DENS_BREAKS[1] - 1e-6:
        return 1.2
    if lo < DENS_BREAKS[2] - 1e-6:
        return 0.7
    return 0.45


# ---- head wall ------------------------------------------------------------
HEAD_HALF = 48.0
HEAD_DEPTH = 72.0


def head_cols():
    """Dense around the slot, sparse where the surface is the shared profile."""
    return axis((-HEAD_HALF - SKIRT, -HEAD_HALF, 1.5), (-HEAD_HALF, -20.0, 1.4), (-20.0, 20.0, 0.8), (20.0, HEAD_HALF, 1.4), (HEAD_HALF, HEAD_HALF + SKIRT, 1.5))


def head_rows():
    rows = ROWS_W[ROWS_W < HEAD_DEPTH - 0.8]
    return np.concatenate([rows, [HEAD_DEPTH], [HEAD_DEPTH + SKIRT]])


def _head_axes(M, f):
    return head_cols(), head_rows()


def build_head(M, seed):
    S, T = M.S, M.T
    H, f = wall_surface(M, seed, lambda s: env(s, half=HEAD_HALF, ramp=14.0), warp_amp=WARP + 0.2)
    e = f["e"]
    # the cirque: a bowl that rises to crest + 2 tiles at the back centre, with
    # its own second band (two risers, rows anchored on them)
    bowl = 6.0 * smooth(30.0, 66.0, T) * smooth(44.0, 14.0, np.abs(S)) * e
    band2 = np.zeros_like(H)
    for k, ((a0, a1), h0) in enumerate(zip(BAND_HEAD_STEPS, (0.6, 0.4))):
        band2 += 5.0 * h0 * (0.75 + 0.3 * (0.5 + 0.5 * vnoise(S, 9.0 * k + 5.0, 9.0, seed + 75 + k))) * smooth(a0, a1, T)
    band2 = band2 * smooth(36.0, 12.0, np.abs(S)) * e
    H = H + bowl + band2
    f["cliff"] = np.maximum(f["cliff"], smooth(47.8, 48.8, T) * smooth(51.6, 50.4, T) * smooth(36, 12, np.abs(S)) * e)
    f["upper"] = np.maximum(f["upper"], smooth(44.0, 56.0, T) * smooth(40, 12, np.abs(S)) * e)
    # the dark slot, running back into the wall: the wadi carries on beyond sight
    x = S + 1.4 * vnoise(S, T, 11.0, seed + 72) * smooth(8.0, 40.0, T) + 1.8 * np.sin(T / 21.0 + 0.4)
    w = 6.4 + 1.6 * smooth(0.0, 25.0, T) - 1.0 * smooth(40, 72, T)
    floor = 0.075 * T + 0.2 * vnoise(S, T, 4.0, seed + 73) - 0.05
    ax = np.maximum(np.abs(x) - w / 2.0, 0.0)
    bank = 1.0 * np.minimum(ax, 2.2) + 4.4 * np.maximum(ax - 2.2, 0.0) * (1.0 + 0.35 * vnoise(S, T, 3.0, seed + 74))
    Hs = floor + bank
    Hn = smin(H, Hs, 0.5)
    cut = e * smooth(6.0, 16.0, T) * smooth(34.0, 20.0, np.abs(S))
    H = H * (1 - cut) + Hn * cut
    slot = np.clip(smooth(0.5, 2.5, f["y"] + bowl + band2 - H) * cut, 0, 1)
    # a scree cone at the slot's mouth
    fa = fan(M, 0.0, 17.0, 20.0, 3.6, spread=1.1) * e
    H += fa
    scree = np.clip(smooth(0.35, 1.8, fa), 0, 1)
    # skirts: end dips, front dip, back dip
    H = H - skirt_dip(S, HEAD_HALF) - 0.5 * smooth(2.5, 0.0, T) - 3.0 * smooth(HEAD_DEPTH, HEAD_DEPTH + 1.5, T)
    f["gully"], f["scree"] = slot * 0.35, scree
    f["boulder"] = np.zeros_like(H)
    f["slot"] = slot
    f["anchor_gully"] = (0.0, 17.0)
    f["edge_w"], f["edge_d"], f["edge_family"] = smooth(HEAD_HALF, HEAD_HALF - 7.0, np.abs(S)), T, "wall"
    return H, f


# ---- taper -----------------------------------------------------------------
TAPER_SEED = 606 + 7


def taper_e(S):
    return smooth(-HALF, -HALF + 10.0, S)                 # 0 at the profile end, 1 inside


def taper_g(S):
    return 1.0 - 0.62 * smooth(-18.0, 22.0, S)            # 1 at the wall end, 0.38 at the free end


def build_taper(M, seed):
    S, T = M.S, M.T
    H, f = wall_surface(M, TAPER_SEED, taper_e)
    g = taper_g(S)
    H = H * g
    # the foot keeps its terraced ramp, the cliff softens as the wall falls
    f["cliff"] = f["cliff"] * g
    H = H - SKIRT_DIP * (smooth(-HALF, -HALF - 1.2, S) + smooth(HALF, HALF + 1.2, S)) - 0.5 * smooth(2.5, 0.0, T)
    f["gully"] = np.zeros_like(H)
    f["scree"] = np.zeros_like(H)
    f["boulder"] = np.zeros_like(H)
    f["edge_w"], f["edge_d"], f["edge_family"] = smooth(-HALF, -HALF + 6.0, S), T, "wall"
    return H, f


def _taper_axes(M, f):
    return axis((-SKIRT - HALF, -HALF, SKIRT), (-HALF, HALF, 4.0 / 3.0), (HALF, HALF + SKIRT, SKIRT)), ROWS_W.copy()


# ---- outer corner (SW and NE) ----------------------------------------------------
OC_LEN = 90.0                  # metres past the taper's free end
OC_NEAR0 = 48.0                # the taper is 16 tiles long: the south edge is 48 m behind its free end


def build_outer_corner(M, seed):
    """Where a far wall turns the corner onto a near side. The taper's free end is a cross-section
    of 0.38 x profile W; this piece CONTINUES the same noise field past it (its parameter `s` is
    the taper's own, offset by 24 m, so colour and detail are continuous), lets the spur fall away
    to the south, and carries the near slope's rolling foreground along its inner edge
    (`t = 0`, which is where the south slopes' west end stands). Free height: from the camera
    nothing here can stand between it and the map.
    """
    S, T = M.S, M.T                       # S = the taper's s: 24 at the seam, up to 24 + OC_LEN
    H, f = wall_field(S, T, TAPER_SEED, taper_e, WARP, 0.5, 0.42)
    u = S - HALF                          # metres past the seam
    g = 0.38 * (1.0 - 0.72 * smooth(0.0, 80.0, u))
    A = H * g
    f["cliff"] = f["cliff"] * g
    # the near slope's own field, evaluated for the outer corner's frame: `tm` is the distance
    # south of the south edge, `-T` the distance along it (west is negative), and the hills
    # start growing from the slope's own end at t = 0 where it meets the south slopes exactly
    tm = OC_NEAR0 + np.maximum(u, 0.0)
    e_n = smooth(0.0, 24.0, T)
    B, ter, riser, track = _near_field(-T, tm, 4400 + 5, e_n, tm)
    B = B * (1.0 - 0.8 * smooth(8.0, 50.0, T)) * smooth(0.0, 20.0, u)
    H = np.maximum(A, B)
    H = H - SKIRT_DIP * smooth(0.0, -1.2, u) - 0.5 * smooth(2.5, 0.0, T) * (1.0 - smooth(0.0, 8.0, u)) - 4.0 * smooth(OC_LEN - 3.0, OC_LEN, u)
    f["gully"] = np.zeros_like(H)
    f["scree"] = np.zeros_like(H)
    f["boulder"] = np.zeros_like(H)
    f["world"] = lambda SS, VV: (SS - HALF, VV - rim_shift(SS, VV, TAPER_SEED, taper_e(SS), WARP))
    return H, f


def _oc_axes(M, f):
    return np.concatenate([[HALF - SKIRT], np.linspace(HALF, HALF + OC_LEN, 41)]), ROWS_W.copy()


def oc_dens(s0, s1, v0, v1):
    if v1 <= DENS_BREAKS[0] + 1e-6:
        return 0.9
    if v1 <= DENS_BREAKS[1] + 1e-6:
        return 1.1
    if v1 <= DENS_BREAKS[2] + 1e-6:
        return 0.6
    return 0.4


# ---- crest -------------------------------------------------------------------
CREST_RISERS = [(1.6, 2.2), (3.6, 4.2), (5.6, 6.2), (7.6, 8.2)]
CREST_RISER_H = [0.20, 0.22, 0.24, 0.22]          # of the ridge height; the treads carry the other 12%
CREST_V = 9.0                                     # where the crest line stands in the parameter plane


def crest_peaks(variant):
    """Summit positions (m along the ridge), heights (0..1) and half-widths (m): irregular on
    purpose, so the skyline is a broken line of summits and notches and not a loaf."""
    if variant == "a":
        return [(-16.5, 0.58, 8.5), (-5.0, 0.80, 7.0), (4.0, 1.00, 9.5), (13.5, 0.62, 6.5), (21.0, 0.40, 6.0)]
    return [(-17.0, 0.72, 7.5), (-9.0, 1.00, 8.0), (-1.0, 0.46, 5.5), (7.5, 0.88, 7.0), (16.0, 0.55, 8.0), (22.0, 0.34, 5.0)]


def crest_ridge(S, variant, seed):
    """The ridge line r(s) (metres above the piece's base), a union of summits with teeth."""
    r = np.zeros_like(S)
    for (sk, hk, wk) in crest_peaks(variant):
        r = np.maximum(r, hk * np.clip(1.0 - np.abs(S - sk) / wk, 0.0, 1.0) ** 1.15)
    teeth = (1.0 - np.abs(vnoise(S, 17.0, 2.6, seed + 11))) ** 3.0 * 0.12 + (1.0 - np.abs(vnoise(S, 5.0, 1.2, seed + 12))) ** 4.0 * 0.05
    r = (0.10 + 0.90 * r) * (1.0 + teeth * smooth(0.15, 0.6, r)) * smooth(26.0, 18.0, np.abs(S))
    return r


def crest_vc(S, seed):
    return CREST_V + 2.2 * vnoise(S, 3.0, 14.0, seed + 7)


def _crest_shear(S, V, seed):
    w = smooth(0.0, CREST_V, V) * (1.0 - smooth(CREST_V, 30.0, V))
    return (crest_vc(S, seed) - CREST_V) * w


def build_crest(variant):
    amp = 18.0 if variant == "a" else 15.5

    def builder(M, seed):
        S, V = M.S, M.T
        r = crest_ridge(S, variant, seed) * amp
        front = 0.12 * np.clip(V / CREST_V, 0.0, 1.0)
        for (a0, a1), h0 in zip(CREST_RISERS, CREST_RISER_H):
            front = front + h0 * smooth(a0, a1, V)
        t = np.clip((V - CREST_V) / 27.0, 0.0, 1.0)
        back = 1.0 - 0.78 * t
        prof = np.where(V <= CREST_V, front, back)
        H = r * prof
        # chutes down the fall line, cut deepest under the summits
        chute = smooth(0.80, 0.96, 1.0 - np.abs(vnoise(S, V * 0.22, 3.4, seed + 5)))
        H = H * (1.0 - 0.34 * chute * smooth(0.12, 0.5, prof))
        # shelves: the harder beds stand proud of the scarp
        H += 0.30 * fbm(S, V, 2.4, 2, seed + 3) * smooth(1.0, 5.0, H) + 0.10 * fbm(S, V, 0.9, 2, seed + 4)
        H = H - skirt_dip(S) - 0.5 * smooth(2.0, 0.0, V) - 2.5 * smooth(36.0, 37.5, V)
        f = {"cliff": np.zeros_like(H)}
        f["world"] = lambda SS, VV: (SS, VV + _crest_shear(SS, VV, seed))
        return H, f
    return builder


def crest_rows():
    """A vertex at both ends of every riser, one between them, then the long back slope."""
    rows = [0.0, 1.6, 2.2, 2.9, 3.6, 4.2, 4.9, 5.6, 6.2, 6.9, 7.6, 8.2, CREST_V]
    back = np.linspace(CREST_V, 39.0, 12)[1:]
    return np.concatenate([rows, back])


def _crest_axes(M, f):
    return axis((-SKIRT - HALF, SKIRT + HALF, 1.0)), crest_rows()


# ---- near slopes ---------------------------------------------------------
NEAR_K = 0.38
NEAR_BREAK = 46.0              # texel-density break on the near slopes: the first 46 m show at zoom 1 and 2.5
NEAR_BASE = 0.55
NEAR_SPAN = 0.35


def _near_field(S, T, seed, e, tm):
    hill = 0.5 + 0.5 * np.clip(1.25 * fbm(S, T, 46.0, 3, seed + 1), -1, 1)
    hill = smooth(0.1, 0.9, hill) * e
    C = NEAR_BASE + NEAR_SPAN * hill
    H = NEAR_K * tm * C
    # terrace patches: shallow treads where the hill is gentle
    patchmask = smooth(0.0, 0.5, fbm(S, T, 28.0, 2, seed + 2)) * smooth(10.0, 24.0, tm) * e
    q = (H / 0.9)
    stairs = (np.floor(q) + smooth(0.78, 1.0, q - np.floor(q))) * 0.9
    amp = np.minimum(0.4, 0.04 * tm)
    H = H + (stairs - H) * 0.0
    ter = patchmask
    Hq = H * (1 - ter) + (np.floor(H / 1.1) * 1.1 + 1.1 * smooth(0.82, 1.0, H / 1.1 - np.floor(H / 1.1))) * ter
    Hq = np.minimum(Hq, H)       # a terrace only ever steps DOWN from the rolling surface
    riser = ter * smooth(0.7, 0.99, H / 1.1 - np.floor(H / 1.1)) * smooth(1.0, 0.82, H / 1.1 - np.floor(H / 1.1))
    H = Hq
    H += 0.06 * fbm(S, T, 3.0, 3, seed + 3) * e * smooth(2.0, 10.0, tm)
    # a track winding down the slope
    cx = 6.0 * np.sin(tm / 31.0 + 1.1) + 3.0 * np.sin(tm / 11.0)
    track = smooth(1.5, 0.5, np.abs(S - cx)) * smooth(8.0, 18.0, tm) * e
    H -= 0.10 * track
    return H, ter, riser, track


def build_slope_near(variant):
    def builder(M, seed):
        S, T = M.S, M.T
        e = env(S, ramp=10.0)
        H, ter, riser, track = _near_field(S + (10 if variant == "b" else 0), T, seed + (17 if variant == "b" else 0), e, T)
        H = np.minimum(H, NEAR_K * T)
        H = H - skirt_dip(S) - 0.4 * smooth(2.5, 0.0, T) - 4.0 * smooth(120.0, 121.5, T)
        return H, {"terrace": ter, "riser": riser, "track": track,
                   "edge_w": smooth(24.0, 18.0, np.abs(S)), "edge_d": T, "edge_family": "near"}
    return builder


def _slope_axes(M, f):
    return axis((-SKIRT - HALF, SKIRT + HALF, 1.5)), axis((0.0, NEAR_BREAK, 2.0), (NEAR_BREAK, 123.0, 77.0 / 38.0))


def build_slope_corner(M, seed):
    S, T = M.S, M.T
    Sp, Tp = np.maximum(S, 0.0), np.maximum(T, 0.0)
    k = 12.0
    smax_ = (Sp + Tp + np.sqrt((Sp - Tp) ** 2 + k * k) - k) / 2.0    # a smooth max that never exceeds max(S, T)
    wface = smooth(0.0, 14.0, np.minimum(Sp, Tp))                     # 0 on the two faces: there tm IS max(S, T)
    tm = np.maximum(Sp, Tp) * (1.0 - wface) + smax_ * wface
    e = smooth(0.0, 20.0, S) * smooth(0.0, 20.0, T)
    H, ter, riser, track = _near_field(S, T, seed, e, tm)
    H = np.minimum(H, NEAR_K * np.maximum(Sp, Tp))
    dip = SKIRT_DIP * np.maximum(smooth(0.0, -1.2, S), smooth(0.0, -1.2, T))
    H = H - dip - 4.0 * np.maximum(smooth(120.0, 121.5, S), smooth(120.0, 121.5, T))
    return H, {"terrace": ter, "riser": riser, "track": track,
               "edge_w": smooth(0.0, 9.0, S) * smooth(0.0, 9.0, T), "edge_d": np.maximum(Sp, Tp), "edge_family": "near"}


def _slope_corner_axes(M, f):
    a = axis((-SKIRT, NEAR_BREAK, (NEAR_BREAK + SKIRT) / 21.0), (NEAR_BREAK, 123.0, (123.0 - NEAR_BREAK) / 33.0))
    return a, a


# ---- terraces -------------------------------------------------------------
def foot_ramp(t):
    return 4.6 * (np.clip(t, 0, 21.0) / 21.0) ** 1.2 + 0.28 * np.clip(t - 21.0, 0, None)


TERRACE_EDGES = [0.0, 6.0, 12.0, 18.0, 24.0]


def build_terrace(kind):
    """Four treads at the same depths on every variant, so a, b and end are flush at
    their ends and chain in any order; they differ inside: a rolls, b has a stone stair
    cut through its risers, end closes against a bank of rock on the +s side."""
    def builder(M, seed):
        S, T = M.S, M.T
        half = 12.0
        e = smooth(half, half - 6.0, np.abs(S))
        edges = TERRACE_EDGES
        n_tread = 4
        hts = [float(foot_ramp(np.array(edges[i + 1]))) + 0.18 + 0.05 * i for i in range(n_tread)]
        wob = (1.1 if kind != "b" else 1.6) * fbm(S, T * 0.0, 9.0, 2, seed + 1) * e
        H = np.full_like(S, hts[0])
        for i in range(1, n_tread):
            H = H + (hts[i] - hts[i - 1]) * smooth(edges[i] - 0.35, edges[i] + 0.35, T + wob * 0.9)
        for i in range(n_tread):
            inside = smooth(edges[i] - 0.1, edges[i] + 0.4, T) * smooth(edges[i + 1] + 0.1, edges[i + 1] - 0.3, T)
            H = H - 0.035 * (T - edges[i]) * inside
        if kind == "b":
            # a stair: a ramp through every riser, 2.4 m wide, off-centre
            lin = np.interp(T, [0.0, 3.0, 9.0, 15.0, 21.0], [hts[0], hts[0], hts[1], hts[2], hts[3]]) + 0.0
            m = smooth(1.5, 0.7, np.abs(S - 3.5)) * e
            H = H * (1.0 - m) + lin * m
        H += 0.05 * e * fbm(S, T, 2.0, 3, seed + 2) + 0.012 * (e * fbm(S, T, 0.4, 2, seed + 3) + (1 - e) * fbm(0.0 * S, T, 0.4, 2, 3))
        slope_guess = np.abs(np.gradient(H, M.h, axis=0))
        courses = (H / 0.30)
        bulge = 0.018 * (0.5 - np.abs(courses - np.floor(courses) - 0.5)) * smooth(0.6, 1.5, slope_guess)
        H = H + bulge
        end_bank = np.zeros_like(H)
        if kind == "end":
            xe = S - 8.0
            bank = 3.4 * smooth(0.0, 7.0, xe) ** 0.8 + 1.4 * smooth(0.0, 4.0, xe)
            bank = bank + 0.6 * fbm(S, T, 2.2, 3, seed + 4) * smooth(0, 3, xe)
            H = H + bank
            end_bank = smooth(0.3, 2.0, bank)
            H = H - 0.5 * smooth(half, half + 1.2, -S) - 0.0
            end_w = smooth(-half, -half + 3.5, S)
        else:
            H = H - 0.4 * smooth(half, half + 1.2, np.abs(S))
            end_w = smooth(half, half - 3.5, np.abs(S))
        H = H - 0.5 * smooth(24.0, 26.0, T) - 0.5 * smooth(0.0, -1.5, T)
        f = {"tread_bias": 0.0, "bank": end_bank, "edges": edges, "hts": hts,
             "edge_w": end_w, "edge_d": T, "edge_family": "terrace"}
        return H, f
    return builder


def _terrace_axes(kind):
    def fn(M, f):
        ncell = 24 if kind == "end" else 40
        sv = axis((-15.0, 15.0, 1.0))
        # rows dense on the risers
        slope = np.abs(np.gradient(box_blur(f["H"], 3), M.h, axis=0)).mean(axis=1)
        imp = 1.0 + 7.0 * smooth(0.4, 1.4, slope)
        tv = K.warped_axis(imp, M.t, ncell + 1, M.t[0], M.t[-1], anchors=(0.0, 24.0))
        return sv, tv
    return fn


# ---- scree -----------------------------------------------------------------
def build_scree(kind):
    def builder(M, seed):
        S, T = M.S, M.T
        if kind == "a":
            W, L, Hh, lobes = 24.0, 21.0, 9.0, [(0.0, 1.0)]
        elif kind == "b":
            W, L, Hh, lobes = 12.0, 15.0, 9.0, [(0.0, 1.0)]
        else:
            W, L, Hh, lobes = 18.0, 24.0, 13.5, [(-4.2, 0.78), (4.4, 1.0)]
        H = np.full_like(S, -2.0)
        cone = np.zeros_like(S)
        for (c, k) in lobes:
            tau = np.clip(T / L, 0.0, 1.0)
            half = (W / 2.0 * (1.0 - 0.8 * tau)) * (0.62 if len(lobes) > 1 else 1.0) + 1e-6
            lam = np.clip(np.abs(S - c + 1.3 * fbm(S, T, 7.0, 2, seed + 1)) / half, 0.0, 1.0)
            Hc = Hh * k * (tau ** 0.85) * (1.0 - lam ** 2) ** 0.95
            Hc = np.where(T < 0, 0.0, Hc)
            cone = np.maximum(cone, Hc)
        # chips and blocks
        chips, cid = worley(S, T, 0.34, seed + 2)
        blocks, bid = worley(S, T, 1.5, seed + 3)
        rough = 0.07 * (smooth(0.1, 0.8, chips) - 0.5) + 0.20 * (smooth(0.0, 0.7, blocks) - 0.5) * smooth(0.0, 1.5, cone)
        rill = 0.18 * vnoise(S * 1.0, T * 0.35, 1.7, seed + 4) * smooth(0.5, 3.0, cone)
        Hc = cone + (rough + rill) * smooth(0.05, 0.8, cone) + 0.1 * fbm(S, T, 4.0, 2, seed + 5) * smooth(0.05, 1.0, cone)
        # perimeter sinks under whatever it lies on
        sink = -1.9 * smooth(1.4, 0.0, cone)
        H = Hc + sink
        H, bo = add_boulders(M, H, None, seed + 9, 10 if kind == "c" else 6, 0.5, 1.3, 4.0, L * 0.85, W * 0.28)
        f = {"Hcone": np.maximum(cone, 0.0), "boulder": bo * smooth(0.5, 2.0, cone)}
        return H, f
    return builder


def _scree_axes(M, f):
    return axis((-12.0, 12.0, 24.0 / 22.0)), axis((-3.0, 24.0, 27.0 / 22.0))


# --------------------------------------------------------------------------
def near_dens(s0, s1, v0, v1):
    return 1.3 if v1 <= NEAR_BREAK + 1e-6 else 0.6


def near_corner_dens(s0, s1, v0, v1):
    return 1.3 if max(s0, v0) < NEAR_BREAK - 1e-6 else 0.6


def all_pieces():
    P = []
    for v, sd in (("a", 101), ("b", 202), ("c", 303)):
        P.append(wall(v, sd))
    P.append(Piece("bd_wall_corner", "far", 10000, 8.0, build_corner, CORNER_SEED, (-SKIRT, 84.0), (-SKIRT, 84.0), 0.08, _corner_axes,
                   "concave inner corner: a true mitre with a diagonal couloir", blur=(0.14, 0.14),
                   s_breaks=DENS_BREAKS[1:], v_breaks=DENS_BREAKS[1:], dens=corner_dens, lod_s=tuple(PROFILE.lod_anchor_d), lod_v=tuple(PROFILE.lod_anchor_d)))
    P.append(Piece("bd_head_wall", "far", 12000, 8.0, build_head, 505, (-HEAD_HALF - SKIRT, HEAD_HALF + SKIRT), (0.0, HEAD_DEPTH + SKIRT), 0.08, _head_axes,
                   "cirque with a dark slot and its own scree cone", blur=WALL_BLUR, v_breaks=DENS_BREAKS, dens=wall_dens,
                   lod_s=(-HEAD_HALF, HEAD_HALF), lod_v=tuple(PROFILE.lod_anchor_d)))
    P.append(Piece("bd_taper", "far", 6000, 8.0, build_taper, 606, (-SKIRT - HALF, SKIRT + HALF), (0.0, 84.0), 0.08, _taper_axes,
                   "profile W at one end, falling under the near envelope at the other", blur=WALL_BLUR, v_breaks=DENS_BREAKS, dens=wall_dens,
                   lod_s=(-HALF, HALF), lod_v=tuple(PROFILE.lod_anchor_d)))
    P.append(Piece("bd_outer_corner", "far", 6000, 8.0, build_outer_corner, 4400, (HALF - SKIRT, HALF + OC_LEN), (0.0, 84.0), 0.08, _oc_axes,
                   "the outer corner (SW, NE): the taper's spur continued, falling away into the near foreground", blur=WALL_BLUR,
                   v_breaks=DENS_BREAKS, dens=oc_dens, lod_s=(HALF,), lod_v=tuple(PROFILE.lod_anchor_d)))
    P.append(Piece("bd_crest_a", "far", 2500, 4.0, build_crest("a"), 707, (-SKIRT - HALF, SKIRT + HALF), (0.0, 39.0), 0.06, _crest_axes,
                   "broken ridge, five summits and notches", blur=(0.4, 0.2), lod_s=(), lod_v=(CREST_V,)))
    P.append(Piece("bd_crest_b", "far", 2500, 4.0, build_crest("b"), 808, (-SKIRT - HALF, SKIRT + HALF), (0.0, 39.0), 0.06, _crest_axes,
                   "broken ridge, twin main summits and a minor notch", blur=(0.4, 0.2), lod_s=(), lod_v=(CREST_V,)))
    P.append(Piece("bd_slope_near_a", "near", 5000, 4.0, build_slope_near("a"), 909, (-SKIRT - HALF, SKIRT + HALF), (0.0, 123.0), 0.12, _slope_axes,
                   "rolling scrub hills, terrace patches, a track", v_breaks=(NEAR_BREAK,), dens=near_dens))
    P.append(Piece("bd_slope_near_b", "near", 5000, 4.0, build_slope_near("b"), 1010, (-SKIRT - HALF, SKIRT + HALF), (0.0, 123.0), 0.12, _slope_axes,
                   "rolling scrub hills, other seed", v_breaks=(NEAR_BREAK,), dens=near_dens))
    P.append(Piece("bd_slope_corner", "near", 6000, 4.0, build_slope_corner, 1111, (-SKIRT, 123.0), (-SKIRT, 123.0), 0.14, _slope_corner_axes,
                   "the near-near corner, radial", s_breaks=(NEAR_BREAK,), v_breaks=(NEAR_BREAK,), dens=near_corner_dens))
    P.append(Piece("bd_terrace_a", "any", 2500, 8.0, build_terrace("a"), 1212, (-15.0, 15.0), (-1.5, 26.0), 0.04, _terrace_axes("a"), "four treads", dens=lambda *a: 2.3))
    P.append(Piece("bd_terrace_b", "any", 2500, 8.0, build_terrace("b"), 1313, (-15.0, 15.0), (-1.5, 26.0), 0.04, _terrace_axes("b"), "three wide treads", dens=lambda *a: 2.3))
    P.append(Piece("bd_terrace_end", "any", 1500, 8.0, build_terrace("end"), 1414, (-15.0, 15.0), (-1.5, 26.0), 0.04, _terrace_axes("end"), "closes a run against a bank", dens=lambda *a: 2.3))
    P.append(Piece("bd_scree_a", "any", 1000, 8.0, build_scree("a"), 1515, (-13.0, 13.0), (-3.5, 25.0), 0.04, _scree_axes, "wide fan", dens=lambda *a: 1.5))
    P.append(Piece("bd_scree_b", "any", 1000, 8.0, build_scree("b"), 1616, (-13.0, 13.0), (-3.5, 25.0), 0.04, _scree_axes, "tight cone", dens=lambda *a: 1.5))
    P.append(Piece("bd_scree_c", "any", 1000, 8.0, build_scree("c"), 1717, (-13.0, 13.0), (-3.5, 25.0), 0.04, _scree_axes, "double tongue with boulders", dens=lambda *a: 1.5))
    return P


SHADERS = {
    "wall": lambda M, f, seed: shade_land(M, f, seed, "wall"),
    "crest": lambda M, f, seed: shade_land(M, f, seed, "crest", rock_bias=-0.25),
    "near": shade_near,
    "terrace": shade_terrace,
    "scree": shade_scree,
}


def shader_for(name):
    if name == "bd_outer_corner":
        return "wall"
    if name.startswith("bd_terrace"):
        return "terrace"
    if name.startswith("bd_scree"):
        return "scree"
    if name.startswith("bd_slope"):
        return "near"
    if name.startswith("bd_crest"):
        return "crest"
    return "wall"


def olive_positions(p, seed_off, spacing, radius):
    """Local positions (x, y, z) of the real olives on a terrace piece's treads: the
    same jittered grid `olive_dots` bakes, kept where the tread is flat and the olive
    stands inside the nominal footprint."""
    M, H, sl = p.M, p.f["H"], p.f["sl"]
    seed = p.seed + seed_off
    out = []
    ix0, ix1 = int(math.floor(-12.0 / spacing)) - 1, int(math.ceil(12.0 / spacing)) + 1
    iz0, iz1 = int(math.floor(0.0 / spacing)) - 1, int(math.ceil(24.0 / spacing)) + 1
    for iz in range(iz0, iz1 + 1):
        for ix in range(ix0, ix1 + 1):
            if not tile_hash(ix * 3 + seed, iz * 7 + 1) < 0.78:
                continue
            ps = float((ix + 0.2 + 0.6 * tile_hash(ix + seed, iz + 3)) * spacing)
            pt = float((iz + 0.2 + 0.6 * tile_hash(ix + 5, iz + seed)) * spacing)
            if abs(ps) > 11.0 or pt < 1.0 or pt > 23.0:
                continue
            r = int(round((pt - M.t[0]) / M.h))
            c = int(round((ps - M.s[0]) / M.h))
            if sl[r, c] > 0.30:
                continue
            out.append([-pt, ps, float(H[r, c])])
    return out


# --------------------------------------------------------------------------
# the colour at a seam: pieces that abut blend to ONE colour table per family
# --------------------------------------------------------------------------
_EDGE = {}


class _NoS:
    """A Master view whose S is the constant 0: noise that does not vary along the edge."""

    def __init__(self, M):
        self.__dict__.update(M.__dict__)
        self.S = np.zeros_like(M.S)


def edge_table(family):
    """(t, rgb[n, 3]) of the colour a seam of `family` carries, a function of the distance
    out only. Built on a narrow strip of the pure profile, shaded with S held at 0."""
    if family in _EDGE:
        return _EDGE[family]
    if family == "wall":
        M = Master(-4.0, 4.0, 0.0, 135.0, 0.08)
        H, f = wall_surface(M, 77, lambda s: 0.0 * s)
        H = H - 0.5 * smooth(2.5, 0.0, M.T)
        f.update({"gully": np.zeros_like(H), "scree": np.zeros_like(H), "boulder": np.zeros_like(H)})
        shader = "wall"
    elif family == "near":
        M = Master(-4.0, 4.0, 0.0, 135.0, 0.12)
        H, ter, riser, track = _near_field(M.S, M.T, 88, np.zeros_like(M.S), M.T)
        f = {"terrace": ter, "riser": riser, "track": track}
        shader = "near"
    else:
        M = Master(-4.0, 4.0, -1.5, 26.0, 0.04)
        H, f = build_terrace("a")(M, 99)
        f = {k: v for k, v in f.items() if not k.startswith("edge")}
        shader = "terrace"
    f = derive(M, H, f, 77)
    M2 = _NoS(M)
    rgb = SHADERS[shader](M2, f, 77)
    mid = M.ns // 2
    _EDGE[family] = (M.t.copy(), rgb[:, mid, :].copy())
    return _EDGE[family]


def apply_edges(p, rgb):
    """Blend a piece's colour toward its family's seam colour as the seam nears."""
    f = p.f
    if "edge_w" not in f:
        return rgb
    t, tab = edge_table(f["edge_family"])
    d = np.clip(f["edge_d"], t[0], t[-1])
    edge = np.stack([np.interp(d, t, tab[:, c]) for c in range(3)], axis=-1)
    return K.mix(edge, rgb, np.clip(f["edge_w"], 0.0, 1.0))
