"""The Wadi Halam backdrop kit: numerics shared by every piece.

Lane B, 2026-10 (GH-161). Pure python + numpy and NO bpy, so it runs inside
Blender (`build_kit.py`) and under the system python for fast iteration.

What lives here, and why each is hand-rolled:

* `tile_hash` / `vnoise` / `fbm`: a vectorised port of the renderer's own
  `tile-hash.ts` and `terrain/noise.ts` (value noise, quintic fade). NEVER
  `mathutils.noise`: Blender 5.2 reseeds it per process, so the kit would
  shape-shift between runs. `tools/backdrop/test_build_kit.py` pins this port
  against the TypeScript's own numbers.
* The palette: every colour the kit bakes is a `data/palette.json` key, read at
  run time. There is no hex literal anywhere in `tools/backdrop/` (a test greps
  for one). Ladders (`Ladder`) turn a list of keys into a brightness-ordered
  ramp that a float index walks, so "darker in a cavity" is "a higher index",
  never an arbitrary multiply. Ramps DESCEND in brightness (index 0 is the
  lightest): every ladder below is listed light to dark.
* A master heightfield (`Master`): the high-resolution surface a piece is cut
  from. It is a regular grid held in numpy (1-4 M triangles' worth, at 0.04-0.14
  m), not a Blender mesh: the game mesh is cut from it, and its detail is baked
  into the atlas (albedo + ambient occlusion only, no directional light).
"""
import json
import math
import os

import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

#: 1 world unit (a tile) in metres: MESH_UNITS_PER_TILE.
M_PER_TILE = 3.0
#: One elevation level in metres: WORLD_PER_LEVEL (0.2552 tiles) x 3.
LEVEL_M = 0.2552 * M_PER_TILE
#: Crest 48 levels, the Wadi Halam crest, in metres (12.25 tiles).
CREST_M = 48 * LEVEL_M

ATLAS_PX = 2048


# --------------------------------------------------------------------------
# noise: a port of tile-hash.ts and terrain/noise.ts
# --------------------------------------------------------------------------
TILE_HASH_MX = 374761393
TILE_HASH_MY = 668265263
TILE_HASH_MIX = 1274126177


def tile_hash(x, y):
    """`tileHash(x, y)` in [0, 1): integer lattice in, float64 out."""
    x = np.asarray(x, dtype=np.int64)
    y = np.asarray(y, dtype=np.int64)
    h = ((x * TILE_HASH_MX + y * TILE_HASH_MY) & 0xFFFFFFFF).astype(np.uint64)
    h = h ^ (h >> np.uint64(13))
    h = (h * np.uint64(TILE_HASH_MIX)) & np.uint64(0xFFFFFFFF)
    h = h ^ (h >> np.uint64(16))
    return h.astype(np.float64) / 4294967296.0


def lattice_value(i, j, seed):
    return tile_hash(i + seed * 7919, j - seed * 6151) * 2.0 - 1.0


def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def vnoise(x, z, period, seed):
    """`valueNoise2` with `cyclesPerTile = 1 / period` (period in metres)."""
    f = 1.0 / period
    sx = np.asarray(x, dtype=np.float64) * f
    sz = np.asarray(z, dtype=np.float64) * f
    ix = np.floor(sx)
    iz = np.floor(sz)
    tx = _fade(sx - ix)
    tz = _fade(sz - iz)
    ixi = ix.astype(np.int64)
    izi = iz.astype(np.int64)
    v00 = lattice_value(ixi, izi, seed)
    v10 = lattice_value(ixi + 1, izi, seed)
    v01 = lattice_value(ixi, izi + 1, seed)
    v11 = lattice_value(ixi + 1, izi + 1, seed)
    vx0 = v00 + (v10 - v00) * tx
    vx1 = v01 + (v11 - v01) * tx
    return vx0 + (vx1 - vx0) * tz


def fbm(x, z, period, octaves, seed):
    """`fbm2`: octaves of vnoise, each its own lattice, normalised."""
    freq = 1.0 / period
    amp = 1.0
    s = 0.0
    a = 0.0
    for o in range(octaves):
        s = s + amp * vnoise(x, z, 1.0 / freq, seed + o)
        a += amp
        freq *= 2.0
        amp *= 0.5
    return s / a


def worley(x, z, cell, seed):
    """Cellular noise: (F1 distance in cell units, a hash in [0,1) per cell)."""
    sx = np.asarray(x, dtype=np.float64) / cell
    sz = np.asarray(z, dtype=np.float64) / cell
    ix = np.floor(sx).astype(np.int64)
    iz = np.floor(sz).astype(np.int64)
    best = np.full(sx.shape, 9.0)
    ident = np.zeros(sx.shape)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            cx = ix + di
            cz = iz + dj
            px = cx + tile_hash(cx + seed * 31, cz + 7) * 0.8 + 0.1
            pz = cz + tile_hash(cx + 13, cz + seed * 37) * 0.8 + 0.1
            d = np.hypot(sx - px, sz - pz)
            closer = d < best
            best = np.where(closer, d, best)
            ident = np.where(closer, tile_hash(cx * 3 + seed, cz * 5 + 11), ident)
    return best, ident


def worley_edge(x, z, cell, seed):
    """Cellular noise with the border: (F1, F2, id), distances in cell units.
    F2 - F1 is ~0 along the borders between cells: a block-fracture network."""
    sx = np.asarray(x, dtype=np.float64) / cell
    sz = np.asarray(z, dtype=np.float64) / cell
    ix = np.floor(sx).astype(np.int64)
    iz = np.floor(sz).astype(np.int64)
    f1 = np.full(sx.shape, 9.0)
    f2 = np.full(sx.shape, 9.0)
    ident = np.zeros(sx.shape)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            cx = ix + di
            cz = iz + dj
            px = cx + tile_hash(cx + seed * 31, cz + 7) * 0.8 + 0.1
            pz = cz + tile_hash(cx + 13, cz + seed * 37) * 0.8 + 0.1
            d = np.hypot(sx - px, sz - pz)
            new1 = d < f1
            new2 = (~new1) & (d < f2)
            f2 = np.where(new1, f1, np.where(new2, d, f2))
            ident = np.where(new1, tile_hash(cx * 3 + seed, cz * 5 + 11), ident)
            f1 = np.where(new1, d, f1)
    return f1, f2, ident


def smooth(a, b, x):
    """GLSL smoothstep. a > b gives the reversed ramp."""
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# --------------------------------------------------------------------------
# the palette
# --------------------------------------------------------------------------
_PALETTE = None


def palette():
    global _PALETTE
    if _PALETTE is None:
        with open(os.path.join(REPO, "data", "palette.json")) as f:
            _PALETTE = json.load(f)
    return _PALETTE


def key_rgb(key):
    """`limestone.2` -> (r, g, b) floats in 0..1, sRGB-encoded."""
    ramp, idx = key.split(".")
    s = palette()["ramps"][ramp]["colors"][int(idx)]
    s = s.lstrip("#")
    return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


def key_luma(key):
    r, g, b = key_rgb(key)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


class Ladder:
    """A brightness-ordered list of palette keys, walked by a float index.

    `at(i)` is a linear blend in sRGB between neighbouring keys (the prototype
    mixed in sRGB too). Index 0 is the first key listed; list them light to
    dark, because every ramp in `data/palette.json` descends.
    """

    def __init__(self, keys):
        self.keys = list(keys)
        self.rgb = np.stack([key_rgb(k) for k in self.keys])
        self.luma = np.array([key_luma(k) for k in self.keys])
        if np.any(np.diff(self.luma) > 1e-6):
            raise ValueError("ladder %s does not descend in luma: %s" % (self.keys, self.luma.round(3)))

    def at(self, idx):
        idx = np.clip(np.asarray(idx, dtype=np.float64), 0.0, len(self.keys) - 1.0)
        i0 = np.floor(idx).astype(np.int64)
        i1 = np.minimum(i0 + 1, len(self.keys) - 1)
        t = (idx - i0)[..., None]
        return self.rgb[i0] * (1.0 - t) + self.rgb[i1] * t


def mix(a, b, t):
    """Blend two [..., 3] colour fields by a [...] weight."""
    t = np.asarray(t, dtype=np.float64)[..., None]
    return a * (1.0 - t) + b * t


# The ladders. Light to dark, keys the spec names (kit-spec 1b):
LIME = Ladder(["limestone.%d" % i for i in range(9)])             # cliff, crest, risers, gully shade
LIME_LIT = Ladder(["limestone.%d" % i for i in range(5)])        # lit cliff and crest, 0-4
KARST = Ladder(["karst.%d" % i for i in range(5)])                # scree and the bare upper wall
SCRUB = Ladder(["scrub.0", "olive.1", "scrub.1", "olive.2", "olive.3"])
SCRUB_LIT = Ladder(["grass.3", "scrub.0", "olive.1", "scrub.1", "olive.2", "olive.3"])
GRASS = Ladder(["grass.2", "grass.3", "grass.4", "scrub.0", "scrub.1", "olive.2"])
DUST = Ladder(["dust.0", "dust.1", "dust.2", "dust.3", "dust.4", "dust.5", "dust.6"])
OLIVE_CANOPY = Ladder(["grass.4", "scrub.0", "olive.1", "scrub.1"])
TRUNK = Ladder(["limestone.5", "limestone.6", "limestone.7"])


# --------------------------------------------------------------------------
# a master heightfield and what is derived from it
# --------------------------------------------------------------------------
class Master:
    """A regular grid over (s, t). `s` runs along local +Y (the along-edge axis
    of a wall), `t` runs along local -X (the distance out from the map). Rows
    are t, columns are s: every array is shaped [nt, ns]."""

    def __init__(self, s0, s1, t0, t1, h):
        self.h = float(h)
        self.ns = int(round((s1 - s0) / h)) + 1
        self.nt = int(round((t1 - t0) / h)) + 1
        self.s = s0 + h * np.arange(self.ns)
        self.t = t0 + h * np.arange(self.nt)
        self.S, self.T = np.meshgrid(self.s, self.t)

    @property
    def tri_count(self):
        return 2 * (self.ns - 1) * (self.nt - 1)


def box_blur(a, r):
    """Separable box blur, edge-replicated, window 2r+1 cells."""
    r = int(r)
    if r <= 0:
        return a.copy()
    out = a
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        p = np.pad(out, pad, mode="edge")
        c = np.cumsum(p, axis=axis, dtype=np.float64)
        n = out.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        out = (hi - lo) / (2 * r + 1)
    return out


def gradient(H, h):
    gt, gs = np.gradient(H, h)
    return gs, gt  # d/ds, d/dt


def _shift(P, pad, dy, dx, ny, nx):
    return P[pad + dy: pad + dy + ny, pad + dx: pad + dx + nx]


def horizon_ao(H, h, radii=(0.12, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0), ndir=12):
    """Sky visibility of a heightfield: 1 open, towards 0 deep in a gorge.

    Non-directional (no light direction anywhere): for each of `ndir`
    azimuths, march outwards, take the steepest elevation angle to a higher
    cell, and average 1 - sin(angle). Edges replicate, so a wall's end
    continues as the same cross-section, which is what its neighbour is.
    """
    ny, nx = H.shape
    cells = [max(1, int(round(r / h))) for r in radii]
    pad = max(cells)
    P = np.pad(H, pad, mode="edge")
    occ = np.zeros_like(H)
    for k in range(ndir):
        az = 2.0 * math.pi * (k + 0.5) / ndir
        ca, sa = math.cos(az), math.sin(az)
        tmax = np.zeros_like(H)
        for r, c in zip(radii, cells):
            dx = int(round(ca * c))
            dy = int(round(sa * c))
            dist = math.hypot(dx, dy) * h
            if dist <= 0:
                continue
            tmax = np.maximum(tmax, (_shift(P, pad, dy, dx, ny, nx) - H) / dist)
        occ += tmax / np.sqrt(1.0 + tmax * tmax)
    return np.clip(1.0 - occ / ndir, 0.0, 1.0)


def bilinear(F, rows, cols):
    """Sample F[nt, ns(, c)] at float row/col index vectors -> [len(rows), len(cols)(, c)]."""
    nt, ns = F.shape[0], F.shape[1]
    r = np.clip(rows, 0, nt - 1 - 1e-9)
    c = np.clip(cols, 0, ns - 1 - 1e-9)
    r0 = np.floor(r).astype(np.int64)
    c0 = np.floor(c).astype(np.int64)
    wr = (r - r0)
    wc = (c - c0)
    if F.ndim == 3:
        wr = wr[:, None, None]
        wc = wc[None, :, None]
    else:
        wr = wr[:, None]
        wc = wc[None, :]
    A = F[r0][:, c0]
    B = F[r0][:, c0 + 1]
    C = F[r0 + 1][:, c0]
    D = F[r0 + 1][:, c0 + 1]
    return (A * (1 - wc) + B * wc) * (1 - wr) + (C * (1 - wc) + D * wc) * wr


# --------------------------------------------------------------------------
# the game mesh: a tensor grid cut from a master
# --------------------------------------------------------------------------
def warped_axis(importance, coords, n, lo, hi, anchors=()):
    """`n` vertices on [lo, hi], dense where `importance` is high.

    `importance` is sampled at `coords` (ascending). `anchors` are positions
    that must be vertices (seams): the range is split at them and each part
    gets vertices in proportion to its importance mass.
    """
    cuts = sorted(set([lo, hi] + [a for a in anchors if lo < a < hi]))
    imp = np.maximum(importance, 1e-6)
    cum = np.concatenate([[0.0], np.cumsum(0.5 * (imp[1:] + imp[:-1]) * np.diff(coords))])
    mass = lambda x: np.interp(x, coords, cum)
    total = mass(hi) - mass(lo)
    parts = len(cuts) - 1
    alloc = []
    for i in range(parts):
        m = (mass(cuts[i + 1]) - mass(cuts[i])) / total
        alloc.append(max(1, int(round(m * (n - 1)))))
    # fix rounding so the total is exactly n - 1 intervals
    while sum(alloc) > n - 1:
        alloc[int(np.argmax(alloc))] -= 1
    while sum(alloc) < n - 1:
        alloc[int(np.argmax([(mass(cuts[i + 1]) - mass(cuts[i])) / alloc[i] for i in range(parts)]))] += 1
    out = [cuts[0]]
    for i in range(parts):
        a, b = cuts[i], cuts[i + 1]
        qa, qb = mass(a), mass(b)
        for k in range(1, alloc[i] + 1):
            q = qa + (qb - qa) * k / alloc[i]
            out.append(float(np.interp(q, cum, coords)))
        out[-1] = b
    return np.array(out)


def uniform_axis(lo, hi, step):
    n = int(round((hi - lo) / step))
    return np.linspace(lo, hi, n + 1)


class GameMesh:
    """Vertices on a tensor grid over (s, t); heights from the (blurred) master."""

    def __init__(self, M, H, sv, tv, blur_m=0.45, diag="adaptive"):
        self.sv = np.asarray(sv, dtype=np.float64)
        self.tv = np.asarray(tv, dtype=np.float64)
        Hb = box_blur(H, int(round(blur_m / M.h / 2)))
        rows = (self.tv - M.t[0]) / M.h
        cols = (self.sv - M.s[0]) / M.h
        self.z = bilinear(Hb, rows, cols)  # [nt_v, ns_v]
        self.M = M
        nt, ns = len(self.tv), len(self.sv)
        idx = np.arange(nt * ns).reshape(nt, ns)
        a = idx[:-1, :-1].ravel()
        b = idx[:-1, 1:].ravel()
        c = idx[1:, :-1].ravel()
        d = idx[1:, 1:].ravel()
        z = self.z.ravel()
        # split each quad on the diagonal that follows the surface best
        flip = np.abs(z[a] - z[d]) > np.abs(z[b] - z[c])
        t1 = np.where(flip[:, None], np.stack([a, b, c], 1), np.stack([a, b, d], 1))
        t2 = np.where(flip[:, None], np.stack([b, d, c], 1), np.stack([a, d, c], 1))
        self.tris = np.concatenate([t1, t2]).astype(np.int64)
        # vertex positions in the piece's local frame: X = -t, Y = s, Z = height
        SS, TT = np.meshgrid(self.sv, self.tv)
        self.pos = np.stack([-TT.ravel(), SS.ravel(), self.z.ravel()], axis=1)

    @property
    def tri_count(self):
        return len(self.tris)


def chart_axes(M, H, gm, ppm):
    """Surface-length coordinates (in texels) of the mesh's two axes.

    The texel density follows the SURFACE, not the plan, so a 70-degree cliff
    gets the same texels per metre as a meadow. Each axis integrates
    sqrt(1 + g^2) over the cross-axis mean of its own gradient; the grid
    lines of the UV are therefore straight and the bake is separable.
    """
    gs, gt = gradient(box_blur(H, 3), M.h)
    stretch_s = np.sqrt(1.0 + np.mean(gs * gs, axis=0))      # per column
    stretch_t = np.sqrt(1.0 + np.mean(gt * gt, axis=1))      # per row
    cum_s = np.concatenate([[0.0], np.cumsum(0.5 * (stretch_s[1:] + stretch_s[:-1]) * M.h)])
    cum_t = np.concatenate([[0.0], np.cumsum(0.5 * (stretch_t[1:] + stretch_t[:-1]) * M.h)])
    cs = np.interp(gm.sv, M.s, cum_s) * ppm
    ct = np.interp(gm.tv, M.t, cum_t) * ppm
    return cs - cs[0], ct - ct[0]


def pack_charts(sizes, atlas=ATLAS_PX, pad=6):
    """MaxRects (best short side fit, 90-degree rotation allowed), largest first.

    Returns ({name: (x, y, rotated)}, used_rows) or (None, None) if it will not fit.
    A chart is placed with `pad` texels of bleed on every side.
    """
    free = [(0, 0, atlas, atlas)]
    pos = {}
    used = 0
    order = sorted(sizes, key=lambda k: (-sizes[k][0] * sizes[k][1], k))
    for k in order:
        w, h = sizes[k]
        w, h = int(math.ceil(w)) + 2 * pad, int(math.ceil(h)) + 2 * pad
        best = None
        for rot in (False, True):
            cw, ch = (h, w) if rot else (w, h)
            for (fx, fy, fw, fh) in free:
                if cw <= fw and ch <= fh:
                    score = (min(fw - cw, fh - ch), max(fw - cw, fh - ch), fy, fx)
                    if best is None or score < best[0]:
                        best = (score, fx, fy, cw, ch, rot)
        if best is None:
            return None, None
        _, x, y, cw, ch, rot = best
        pos[k] = (x + pad, y + pad, rot)
        used = max(used, y + ch)
        nxt = []
        for (fx, fy, fw, fh) in free:
            if x >= fx + fw or x + cw <= fx or y >= fy + fh or y + ch <= fy:
                nxt.append((fx, fy, fw, fh))
                continue
            if x > fx:
                nxt.append((fx, fy, x - fx, fh))
            if x + cw < fx + fw:
                nxt.append((x + cw, fy, fx + fw - (x + cw), fh))
            if y > fy:
                nxt.append((fx, fy, fw, y - fy))
            if y + ch < fy + fh:
                nxt.append((fx, y + ch, fw, fy + fh - (y + ch)))
        # prune rectangles contained in another
        pr = []
        for i, r in enumerate(nxt):
            if r[2] <= 0 or r[3] <= 0:
                continue
            inside = False
            for j, q in enumerate(nxt):
                if i != j and q[0] <= r[0] and q[1] <= r[1] and q[0] + q[2] >= r[0] + r[2] and q[1] + q[3] >= r[1] + r[3] and (q != r or j < i):
                    inside = True
                    break
            if not inside:
                pr.append(r)
        free = pr
    return pos, used


def lod_axes(M, H, gm, ratio=0.59, s_anchors=()):
    """The LOD1 grid: ~ratio^2 of LOD0's triangles, importance-warped.

    New vertices need not coincide with LOD0's; the chart (UV) is the
    piecewise-linear interpolation of LOD0's, so a LOD1 vertex lands on the
    texel its LOD0 neighbours' surface does.
    """
    Hb = box_blur(H, 4)
    gs, gt = gradient(Hb, M.h)
    imp_s = 1.0 + 6.0 * np.mean(np.abs(gs), axis=0)
    imp_t = 1.0 + 6.0 * np.mean(np.abs(gt), axis=1)
    ns = max(3, int(round(1 + (len(gm.sv) - 1) * ratio)))
    nt = max(3, int(round(1 + (len(gm.tv) - 1) * ratio)))
    sv = warped_axis(imp_s, M.s, ns, float(gm.sv[0]), float(gm.sv[-1]), anchors=s_anchors)
    tv = warped_axis(imp_t, M.t, nt, float(gm.tv[0]), float(gm.tv[-1]))
    return sv, tv
