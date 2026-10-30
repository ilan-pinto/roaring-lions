"""Author the five wetland ground tiles (GH-871 P3, spec 2.1). Procedural, 0 credits.

    python3 tools/textures/author_wetland_tiles.py --out <dir> [--master 4096]
        [--only wetland_open_tile,basalt_rock_tile,...] [--swatches]

Writes, for each tile, `<dir>/<name>.png` (1024^2, the source of record), the
shipped-form `<dir>/<name>.jpg` (q90, 4:4:4, as `encode_ground_tiles.py`), and
with `--swatches` a 3 x 3 repeat. Prints, per tile: the mean rgb that goes into
`GROUND_ALBEDOS`, the repeat seam ratio, the visible contrast at the zoom-1 mip,
and for the open and scrub tiles the figure-ground share.

This script writes nothing under `art/` or `assets/` by default: `--out` is
required, because a PNG under `art/textures/` without its `GROUND_ALBEDOS` row
fails `tools/src/ground-albedo.test.ts`, and the table row is the export
commit's job.

## What the numbers are

The five tiles, their real-world size, texels per metre and the repeat / gain they
will carry (art-numbers.md section 3, approved 28 Oct):

    wetland_open_tile   18 x 18 m 57 texels/m    repeat 6   gain 1.0   (v2, 30 Oct: was 9 m, repeat 3, gain 1.25)
    basalt_rock_tile    6 x 6 m   171 texels/m   repeat 2   gain 1
    wet_scrub_tile      6 x 6 m   171 texels/m   repeat 2   gain 2
    oak_litter_tile     6 x 6 m   171 texels/m   repeat 2   gain 1.5
    basalt_scree_tile   9 x 9 m   114 texels/m   repeat 3   gain 1

Every tile is a 4096^2 master (`--master`) box-filtered to 1024^2. Each image is
a RATIO to its own mean in the ground shader (`1 + gain * (texel / mean - 1)`,
terrain/mesh.ts), so only hue and structure matter here; `tones.open` and friends
set the average.

## Seamless by construction, and deterministic

Every noise call is PERIODIC value noise (`pnoise`): the lattice wraps, so the
image tiles with no edge work. Strokes and discs are drawn with wrapped indices.
All randomness is a hand-rolled integer hash (`hash_u32`), never `mathutils.noise`
and never a clock: the script run twice gives byte-identical PNGs
(`test_author_wetland_tiles.py`).

## The figure-ground rule (spec 2.1, rev. 3)

At the zoom-1 mip, at most 5% of the open and scrub tiles' composed texels
(`tone * (1 + gain * (texel / mean - 1))`) may lie within CIEDE2000 12 of KDF
`olive.1` (#6E7449). A mixture of green and brown is olive drab, so the open
tile keeps mud and sward apart at clump scale with hard edges and a dark-green
understorey. The tool prints the share and exits non-zero above 5% when the tone
it is given is one the spec says should pass.
"""
import argparse
import hashlib
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image

# --- the numbers -------------------------------------------------------------

TILES = {
    "wetland_open_tile": dict(metres=18.0, repeat=6, gain=1.0),
    "basalt_rock_tile": dict(metres=6.0, repeat=2, gain=1.0),
    "wet_scrub_tile": dict(metres=6.0, repeat=2, gain=2.0),
    "oak_litter_tile": dict(metres=6.0, repeat=2, gain=1.5),
    "basalt_scree_tile": dict(metres=9.0, repeat=3, gain=1.0),
}
FINAL = 1024
TILE_PIXELS = 64  # a tile is 64 css px wide at zoom 1 (project.ts TILE_W)
OLIVE_1 = "#6E7449"  # the KDF uniform
FG_LIMIT = 0.05
FG_DELTA = 12.0
MIN_VISIBLE_CONTRAST = 0.05  # tools/src/ground-albedo.test.ts

# The tones the theme composes onto each image (data/palette.json, post S-6).
TONES = {
    "open": ("fen.0", "#7F9F57"),
    "cover1": ("fen.1", "#4F6732"),
    "cover2": ("scrub.1", "#3E5C2E"),
    "cover3": ("olive.3", "#333821"),
}


# --- hand-rolled hash and PERIODIC noise --------------------------------------


def _fmix(h):
    """murmur3's 32-bit finaliser over a uint32 array."""
    h = h ^ (h >> np.uint32(16))
    h = h * np.uint32(0x85EBCA6B)
    h = h ^ (h >> np.uint32(13))
    h = h * np.uint32(0xC2B2AE35)
    return h ^ (h >> np.uint32(16))


def hash_u32(a, b, seed):
    """FNV-style fold with a murmur finaliser per step, over uint32 arrays ->
    uint32. Deterministic; the same mixing as `wetland_kit.hash01`."""
    shape = np.broadcast(a, b).shape
    h = np.full(shape, np.uint32(2166136261), dtype=np.uint32)
    with np.errstate(over="ignore"):  # uint32 wraparound is the point
        for v in (seed, a, b):
            v = np.asarray(v).astype(np.uint32)
            h = h ^ v
            h = h * np.uint32(16777619)
            h = _fmix(h)
    return h


def lattice(cells, seed):
    """cells x cells floats in [-1, 1) from the hash."""
    i = np.arange(cells, dtype=np.uint32)
    return (hash_u32(i[:, None], i[None, :], seed).astype(np.float32) / np.float32(4294967296.0)) * 2.0 - 1.0


def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def pnoise(n, cells, seed):
    """n x n periodic value noise in [-1, 1] with `cells` lattice cells across.
    Wraps with period n, so it tiles seamlessly."""
    lat = lattice(cells, seed)
    p = (np.arange(n, dtype=np.float32) * (cells / n))
    i0 = np.floor(p).astype(np.int64)
    f = _fade(p - i0).astype(np.float32)
    i0 %= cells
    i1 = (i0 + 1) % cells
    v00 = lat[i0[:, None], i0[None, :]]
    v10 = lat[i0[:, None], i1[None, :]]
    v01 = lat[i1[:, None], i0[None, :]]
    v11 = lat[i1[:, None], i1[None, :]]
    fx = f[None, :]
    fy = f[:, None]
    a = v00 + (v10 - v00) * fx
    b = v01 + (v11 - v01) * fx
    return a + (b - a) * fy


def fbm(n, cells, seed, octaves=4):
    total = np.zeros((n, n), np.float32)
    amp, norm = 1.0, 0.0
    c = cells
    for o in range(octaves):
        if c > n // 2:
            break
        total += amp * pnoise(n, c, seed + 31 * o)
        norm += amp
        amp *= 0.5
        c *= 2
    return total / norm if norm > 0 else total


def smoothstep(lo, hi, v):
    t = np.clip((v - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


class Rng:
    """A counted stream of floats from the same hash, vectorised."""

    def __init__(self, seed):
        self.seed = seed
        self.k = 0

    def u(self, m):
        self.k += 1
        a = np.arange(m, dtype=np.uint32)
        return hash_u32(a, np.uint32(self.k), self.seed).astype(np.float64) / 4294967296.0


# --- drawing -------------------------------------------------------------------


def disc_offsets(radius):
    r = int(math.ceil(radius))
    pts = [(dx, dy) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if dx * dx + dy * dy <= radius * radius + 0.25]
    return np.array(pts, dtype=np.int64)


def splat(img, xs, ys, rgb, radius):
    """Paint discs of `radius` px at (xs, ys) with colour rgb (M,3 or 3), wrapped."""
    n = img.shape[0]
    offs = disc_offsets(radius)
    xs = np.rint(xs).astype(np.int64)
    ys = np.rint(ys).astype(np.int64)
    rgb = np.asarray(rgb, dtype=np.float32)
    for dx, dy in offs:
        img[(ys + dy) % n, (xs + dx) % n] = rgb


def strokes(img, x0, y0, ang, length, width_px, rgb):
    """Paint straight strokes: start (x0, y0), direction ang (radians), length in
    px, as discs of width `width_px` spaced about 0.6 of their radius apart (a
    brush). `rgb` is (M,3). Painter's order is array order."""
    lmax = float(np.max(length))
    radius = max(0.5, width_px / 2.0)
    step = max(0.7, 0.6 * radius)
    steps = int(math.ceil(lmax / step))
    ca, sa = np.cos(ang), np.sin(ang)
    for k in range(steps + 1):
        d = k * step
        live = d <= length
        if not np.any(live):
            break
        splat(img, x0[live] + ca[live] * d, y0[live] + sa[live] * d, rgb[live], radius)


def to_u8(img):
    return np.clip(np.rint(img), 0, 255).astype(np.uint8)


def box_down(img, factor):
    n = img.shape[0]
    return img.reshape(n // factor, factor, n // factor, factor, -1).mean(axis=(1, 3))


# --- colour science (CIEDE2000, sRGB bytes) -------------------------------------


def srgb_to_lab(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ m.T
    white = np.array([0.95047, 1.0, 1.08883])
    t = xyz / white
    f = np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def de2000(lab1, lab2):
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm**7 / (Cm**7 + 25.0**7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp = L2 - L1
    dCp = C2p - C1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dh = np.where((C1p * C2p) == 0, 0, dh)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh) / 2)
    Lpm = (L1 + L2) / 2
    Cpm = (C1p + C2p) / 2
    hsum = h1p + h2p
    hpm = np.where(np.abs(h1p - h2p) <= 180, hsum / 2, np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2))
    hpm = np.where((C1p * C2p) == 0, hsum, hpm)
    T = 1 - 0.17 * np.cos(np.radians(hpm - 30)) + 0.24 * np.cos(np.radians(2 * hpm)) + 0.32 * np.cos(np.radians(3 * hpm + 6)) - 0.20 * np.cos(np.radians(4 * hpm - 63))
    dTheta = 30 * np.exp(-(((hpm - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cpm**7 / (Cpm**7 + 25.0**7))
    Sl = 1 + 0.015 * (Lpm - 50) ** 2 / np.sqrt(20 + (Lpm - 50) ** 2)
    Sc = 1 + 0.045 * Cpm
    Sh = 1 + 0.015 * Cpm * T
    Rt = -np.sin(np.radians(2 * dTheta)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def hex_rgb(h):
    return np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)


# --- the five tiles --------------------------------------------------------------


def _share_scale(radius, dist, soft, share):
    """The factor on the patch radii that makes the mud cover `share` of the image (bisection on a
    subsample, 24 steps). Coverage is monotone in the factor."""
    sub = (slice(None, None, 4), slice(None, None, 4))
    r, d = radius[sub], dist[sub]
    lo, hi = 0.2, 4.0
    for _ in range(24):
        mid = (lo + hi) / 2
        cov = float((1.0 - smoothstep(r * mid - soft, r * mid + soft, d)).mean())
        lo, hi = (mid, hi) if cov < share else (lo, mid)
    return (lo + hi) / 2


def author_open(n, mud_share=0.0, soft=0.08, regions=1.0, straw=1.0, grid=13, mud_pull=0.75, lift=0.05, sink=0.02, cool=0.08):
    """Spring sward, v4 (the lead's third 30 Oct ruling: "don't like those brown dots").

    There is NO mud in the shipped tile (`mud_share` 0). Its variation lives in the sward itself:
      * GRASS REGIONS: lighter, yellower stretches and darker, cooler-green ones, three scales of fBm
        (15, 31 and 63 cells over 18 m, so 1.2, 0.6 and 0.3 m: nothing larger, so no cloud is a landmark), a lighter tail (+5% per unit of the region field) and a shorter darker one (-2% per unit): the 5% figure-ground rule is what limits how dark the dark regions may go. Lighter
        reads yellow-green and darker reads blue-green ON PURPOSE: a dark yellow-green is the KDF
        uniform's olive, so the darker regions lean away from olive in hue as they go down in value.
      * blade grain (3-4 cm), per-texel speckle, and the mid / tip / understorey ramp of v2;
      * a hint of straw-tone grass: short strokes and a few tufts in a yellow-green of the grass's own
        hue family (not mud brown), `straw` scaling their count.
    v1 (5671bef0a: 9 m, 40% mud, hard edges), v2 (18 m, 20% mud, soft) and v3 (10% scattered mud
    flecks) are in git history. `mud_share` > 0 still builds v3's mud (a small soft fleck scatter) so
    the spec's falsifier input (60% mud, soft edge) stays constructible for the figure-ground test.
    The mean ratio form (`1 + gain * (texel / mean - 1)`) puts every texel near the theme tone
    `fen.0`, 15.8 CIEDE2000 from KDF `olive.1`, above the 12 the rule asks."""
    mpp = TILES["wetland_open_tile"]["metres"] / n  # metres per master px
    px_per_cm = 0.01 / mpp

    # Sward: understorey, mid blades, light tips.
    under = np.array([62.0, 100.0, 44.0])
    mid = np.array([88.0, 128.0, 52.0])
    tip = np.array([112.0, 154.0, 66.0])
    blade = 0.5 + 0.5 * fbm(n, int(18 / 0.04), 127, 2)  # ~4 cm
    depth = 0.5 + 0.5 * fbm(n, 36, 129, 3)
    t = np.clip(0.30 + 0.55 * blade * (0.6 + 0.5 * depth), 0, 1)[..., None]
    sward = under + (mid - under) * np.clip(t * 1.5, 0, 1) + (tip - mid) * np.clip((t - 0.6) * 2.0, 0, 1)
    ii = np.arange(n, dtype=np.uint32)
    sp = hash_u32(ii[:, None], ii[None, :], 131).astype(np.float32) / np.float32(4294967296.0)
    sward = sward * (0.94 + 0.12 * sp[..., None])

    # Grass regions: lighter and yellower, darker and cooler.
    reg = 0.5 * fbm(n, 15, 173, 3) + 0.3 * fbm(n, 31, 177, 3) + 0.2 * fbm(n, 63, 179, 2)
    reg = reg / float(reg.std())  # unit spread, tails to about +-2.5
    reg = np.clip(reg, -2.6, 2.6) * regions
    up_, dn_ = np.clip(reg, 0, None), np.clip(reg, None, 0)
    lum = 1.0 + lift * up_ + sink * dn_  # a lighter tail longer than the darker one
    sward = sward * lum[..., None]
    sward[..., 0] *= 1.0 + 0.030 * reg  # lighter: redder (yellow-green)
    sward[..., 2] *= 1.0 - cool * reg  # darker: bluer (cool green), away from olive

    img = sward.astype(np.float32)
    mud_w = np.zeros((n, n), np.float32)
    if mud_share > 0.0:  # v3's mud, kept only for the falsifier
        f1, _f2, ids = periodic_voronoi(n, grid, 161, jitter=0.9)
        cell_m = TILES["wetland_open_tile"]["metres"] / grid
        dist_m = f1 * cell_m
        h = hash_u32(ids.astype(np.uint32), np.uint32(7), 163).astype(np.float32) / np.float32(4294967296.0)
        h2 = hash_u32(ids.astype(np.uint32), np.uint32(9), 167).astype(np.float32) / np.float32(4294967296.0)
        radius = (0.20 + 0.25 * h2) * np.where(h < 0.25, 0.0, 1.0)
        ragged = 0.30 * fbm(n, 40, 169, 3)
        unit = _share_scale(radius, dist_m + ragged, soft, mud_share)
        mud_w = 1.0 - smoothstep(radius * unit - soft, radius * unit + soft, dist_m + ragged)
        mud0 = np.array([118.0, 96.0, 68.0])
        mud = img + (mud0[None, None, :] - img) * mud_pull
        img = img * (1.0 - mud_w[..., None]) + mud * mud_w[..., None]

    # Straw-tone grass: short strokes, and a few small tufts of them, in a yellow-green of the
    # grass's own hue family (R 142, G 150, B 66 reads as dry grass, not as earth).
    rng = Rng(143)
    cnt = max(1, int(straw * 0.05 * (324.0) / (0.10 * 0.012)))
    x0, y0 = rng.u(cnt) * n, rng.u(cnt) * n
    ang = rng.u(cnt) * math.pi
    ln = (0.04 + 0.07 * rng.u(cnt)) / mpp
    col = np.array([140.0, 150.0, 68.0])[None, :] * (0.90 + 0.20 * rng.u(cnt)[:, None])
    strokes(img, x0, y0, ang, ln, 1.2 * px_per_cm, col)
    tufts = max(1, int(straw * 90))
    tx, ty = rng.u(tufts) * n, rng.u(tufts) * n
    for k in range(5):  # five strokes fanned from each tuft's foot
        a2 = (0.25 + 0.12 * k) * math.pi + rng.u(tufts) * 0.2
        l2 = (0.10 + 0.08 * rng.u(tufts)) / mpp
        c2 = np.array([150.0, 156.0, 72.0])[None, :] * (0.92 + 0.16 * rng.u(tufts)[:, None])
        strokes(img, tx, ty, a2, l2, 1.0 * px_per_cm, c2)
    return img


def periodic_voronoi(n, g, seed, jitter=0.8):
    """F1 and F2 distances (in cell units) and the nearest cell id, periodic, g x g cells."""
    ix = np.arange(g)
    jx = (hash_u32(ix[:, None].astype(np.uint32), ix[None, :].astype(np.uint32), seed).astype(np.float64) / 4294967296.0 - 0.5) * jitter
    jy = (hash_u32(ix[:, None].astype(np.uint32), ix[None, :].astype(np.uint32), seed + 7).astype(np.float64) / 4294967296.0 - 0.5) * jitter
    p = (np.arange(n, dtype=np.float32) + 0.5) * (g / n)
    cx = np.floor(p).astype(np.int64)
    fx = (p - cx).astype(np.float32)
    f1 = np.full((n, n), 9.0, np.float32)
    f2 = np.full((n, n), 9.0, np.float32)
    ids = np.zeros((n, n), np.int64)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx = (cx + dx) % g
            ny = (cx + dy) % g
            # point position relative to the pixel's own cell
            px = (dx + 0.5 + jx[ny[:, None], nx[None, :]]).astype(np.float32)  # rows = y
            py = (dy + 0.5 + jy[ny[:, None], nx[None, :]]).astype(np.float32)
            ddx = px - fx[None, :]
            ddy = py - fx[:, None]
            d = np.sqrt(ddx * ddx + ddy * ddy)
            cid = ny[:, None] * g + nx[None, :]
            better = d < f1
            second = (~better) & (d < f2)
            f2 = np.where(better, f1, np.where(second, d, f2))
            ids = np.where(better, cid, ids)
            f1 = np.where(better, d, f1)
    return f1, f2, ids


def author_rock(n):
    """Wet vesicular basalt: columnar cracks at 0.3-1 m, pits, a few lichen flecks."""
    mpp = 6.0 / n
    g = 10  # ~0.6 m columns
    f1, f2, ids = periodic_voronoi(n, g, 211)
    edge = f2 - f1
    crack = 1.0 - smoothstep(0.0, 0.07, edge)  # thin dark crack lines
    cell_tone = (hash_u32(ids.astype(np.uint32), np.uint32(5), 213).astype(np.float32) / np.float32(4294967296.0))
    base = np.array([74.0, 77.0, 80.0])
    img = base[None, None, :] * (0.86 + 0.28 * cell_tone[..., None])
    # Each column face is a little domed (lighter at its heart), wet and mottled.
    img = img * (0.9 + 0.16 * (1.0 - np.clip(f1 / 0.55, 0, 1)))[..., None]
    mott = 0.5 + 0.5 * fbm(n, 22, 217, 4)
    img = img * (0.88 + 0.24 * mott[..., None])
    # Vesicles: small dark pits (0.5-1.2 cm), a highlight on the lit lip of each.
    pcm_ = 0.01 / mpp
    vr = Rng(221)
    cnt = int(36 * 380)
    vx, vy = vr.u(cnt) * n, vr.u(cnt) * n
    rad = (0.5 + 0.7 * vr.u(cnt)) * pcm_
    dark = np.array([22.0, 24.0, 27.0])
    for lo_, hi_ in ((0.5, 0.8), (0.8, 1.0), (1.0, 1.2)):
        sel = (rad >= lo_ * pcm_) & (rad < hi_ * pcm_ + 1e-9)
        if np.any(sel):
            splat(img, vx[sel], vy[sel], dark, (lo_ + hi_) / 2 * pcm_)
            splat(img, vx[sel] + 0.7 * pcm_ * lo_, vy[sel] + 0.7 * pcm_ * lo_, np.array([96.0, 100.0, 106.0]), 0.3 * pcm_ * lo_)
    img = img * (1.0 - 0.7 * crack)[..., None] + np.array([18.0, 19.0, 20.0]) * (0.7 * crack)[..., None]
    # Wet sheen: a few lighter bluish patches.
    sheen = smoothstep(0.55, 0.8, 0.5 + 0.5 * fbm(n, 5, 223, 3))
    img = img + (np.array([100.0, 108.0, 116.0]) - img) * (0.22 * sheen)[..., None]
    # Lichen flecks: a few small ochre-green clusters on some faces.
    rng = Rng(227)
    cnt = 55
    lx, ly = rng.u(cnt) * n, rng.u(cnt) * n
    for k in range(4):
        cols = np.where((rng.u(cnt) > 0.5)[:, None], np.array([128.0, 130.0, 74.0]), np.array([142.0, 114.0, 70.0]))
        splat(img, lx + (rng.u(cnt) - 0.5) * 0.10 / mpp, ly + (rng.u(cnt) - 0.5) * 0.10 / mpp, cols, (0.7 + 0.5 * k) * pcm_)
    return img.astype(np.float32)


def author_scrub(n):
    """Rush and bramble litter: last year's stems over mud, new green shoots."""
    mpp = 6.0 / n
    pcm = 0.01 / mpp
    mud = np.array([86.0, 68.0, 48.0])
    mott = 0.5 + 0.5 * fbm(n, 16, 311, 4)
    grain = 0.5 + 0.5 * fbm(n, int(6 / 0.02), 313, 2)
    img = mud[None, None, :] * (0.78 + 0.34 * mott[..., None]) * (0.92 + 0.16 * grain[..., None])
    rng = Rng(317)

    def layer(count, seed_off, len_cm, w_cm, colours, jitter):
        r = Rng(317 + seed_off)
        x0, y0 = r.u(count) * n, r.u(count) * n
        ang = r.u(count) * math.pi
        ln = (len_cm[0] + (len_cm[1] - len_cm[0]) * r.u(count)) * pcm
        pick = (r.u(count) * len(colours)).astype(int) % len(colours)
        col = np.array(colours)[pick] * (1.0 - jitter + 2 * jitter * r.u(count)[:, None])
        strokes(img, x0, y0, ang, ln, w_cm * pcm, col)

    # Dead rush stems: long straw strokes; bramble: darker, redder cane.
    layer(int(36 * 260), 1, (14.0, 45.0), 1.1, [(150.0, 126.0, 80.0), (126.0, 102.0, 64.0), (176.0, 150.0, 98.0)], 0.12)
    layer(int(36 * 70), 2, (20.0, 55.0), 1.4, [(78.0, 52.0, 40.0), (96.0, 60.0, 44.0)], 0.12)
    layer(int(36 * 140), 3, (6.0, 16.0), 0.9, [(112.0, 92.0, 58.0), (92.0, 74.0, 50.0)], 0.12)
    # New green shoots: short bright blades, sparse.
    layer(int(36 * 55), 4, (4.0, 11.0), 0.9, [(96.0, 150.0, 58.0), (122.0, 170.0, 70.0), (74.0, 124.0, 48.0)], 0.1)
    return img.astype(np.float32)


def author_litter(n):
    """Oak leaf litter with acorn cups and moss patches."""
    mpp = 6.0 / n
    pcm = 0.01 / mpp
    base = np.array([68.0, 52.0, 36.0])
    mott = 0.5 + 0.5 * fbm(n, 14, 411, 4)
    img = base[None, None, :] * (0.7 + 0.5 * mott[..., None])
    # Leaves, three layers, each a lobed ellipse with a midrib.
    palette = np.array(
        [[112.0, 78.0, 44.0], [138.0, 98.0, 52.0], [86.0, 60.0, 38.0], [154.0, 116.0, 64.0], [100.0, 72.0, 42.0], [124.0, 90.0, 40.0]]
    )
    for layer_i, count in enumerate((int(36 * 190), int(36 * 170), int(36 * 130))):
        r = Rng(417 + 11 * layer_i)
        cx, cy = r.u(count) * n, r.u(count) * n
        ang = r.u(count) * math.pi
        L = (6.0 + 5.0 * r.u(count)) * pcm  # 6-11 cm long
        W = L * (0.38 + 0.12 * r.u(count))
        col = palette[(r.u(count) * len(palette)).astype(int) % len(palette)] * (0.85 + 0.3 * r.u(count)[:, None])
        lob = r.u(count) * 6.28
        for k in range(count):
            half = int(L[k] * 0.5) + 2
            ys = np.arange(-half, half + 1)
            yy, xx = np.meshgrid(ys, ys, indexing="ij")
            ca, sa = math.cos(ang[k]), math.sin(ang[k])
            u = xx * ca + yy * sa
            v = -xx * sa + yy * ca
            tt = u / (L[k] * 0.5)
            wprof = (W[k] * 0.5) * np.sqrt(np.clip(1 - tt**2, 0, 1)) * (1.0 + 0.16 * np.sin(4 * tt * math.pi + lob[k]))
            inside = np.abs(v) <= wprof
            rib = np.abs(v) <= max(1.0, 0.07 * W[k])
            shade = 0.8 + 0.2 * (v / np.maximum(wprof, 1e-3))
            px = (np.rint(cx[k]).astype(int) + xx)[inside] % n
            py = (np.rint(cy[k]).astype(int) + yy)[inside] % n
            c = col[k][None, :] * shade[inside][:, None]
            c[rib[inside]] = c[rib[inside]] * 0.72
            img[py, px] = c
    # Acorn cups: a dark cup with a lighter rim, 3-5 cm, sparse.
    r = Rng(431)
    cnt = 110
    ax, ay = r.u(cnt) * n, r.u(cnt) * n
    rad = (1.6 + 0.9 * r.u(cnt)) * pcm
    for k in range(cnt):
        splat(img, np.array([ax[k]]), np.array([ay[k]]), np.array([58.0, 40.0, 26.0]), rad[k])
        splat(img, np.array([ax[k] - 0.3 * rad[k]]), np.array([ay[k] - 0.3 * rad[k]]), np.array([138.0, 104.0, 66.0]), 0.55 * rad[k])
    # Moss: soft green patches, ~14% of the ground.
    mm = 0.5 + 0.5 * fbm(n, 7, 433, 4)
    moss = smoothstep(0.56, 0.66, mm)
    mtex = 0.8 + 0.4 * (0.5 + 0.5 * fbm(n, int(6 / 0.03), 437, 2))
    mosscol = np.array([76.0, 84.0, 48.0])[None, None, :] * mtex[..., None]
    img = img + (mosscol - img) * (0.7 * moss)[..., None]
    return img.astype(np.float32)


def author_scree(n):
    """Basalt cobbles of 0.1-0.3 m set in mud."""
    mpp = 9.0 / n
    pcm = 0.01 / mpp
    mud = np.array([100.0, 78.0, 54.0])
    mott = 0.5 + 0.5 * fbm(n, 12, 511, 4)
    img = mud[None, None, :] * (0.78 + 0.34 * mott[..., None])
    grain = 0.5 + 0.5 * fbm(n, int(9 / 0.02), 513, 2)
    img = img * (0.92 + 0.16 * grain[..., None])
    gcells = 40  # 0.225 m cells; one cobble each, size 0.09-0.28 m across
    rng = Rng(517)
    order = []
    for j in range(gcells):
        for i in range(gcells):
            order.append((i, j))
    # Paint small cobbles first so large ones overlap them like they lie in a bed.
    spec = []
    for (i, j) in order:
        h = lambda k: float(hash_u32(np.uint32(i), np.uint32(j + 977 * k), 519 + k) / 4294967296.0)
        if h(1) < 0.06:
            continue
        spec.append(
            dict(
                cx=(i + 0.5 + (h(2) - 0.5) * 0.6) / gcells * n,
                cy=(j + 0.5 + (h(3) - 0.5) * 0.6) / gcells * n,
                a=(0.045 + 0.095 * h(4)) / mpp,
                b=(0.045 + 0.095 * h(4)) * (0.62 + 0.38 * h(5)) / mpp,
                ang=h(6) * math.pi,
                tone=0.78 + 0.42 * h(7),
                warm=h(8),
            )
        )
    spec.sort(key=lambda c: c["a"])
    light = np.array([-0.55, -0.70, 0.45])
    light = light / np.linalg.norm(light)
    for c in spec:
        half = int(max(c["a"], c["b"])) + 3
        ys = np.arange(-half, half + 1)
        yy, xx = np.meshgrid(ys, ys, indexing="ij")
        ca, sa = math.cos(c["ang"]), math.sin(c["ang"])
        u = (xx * ca + yy * sa) / c["a"]
        v = (-xx * sa + yy * ca) / c["b"]
        d2 = u * u + v * v
        inside = d2 <= 1.0
        # A dome: height = sqrt(1 - d2); normal from the gradient.
        hgt = np.sqrt(np.clip(1.0 - d2, 0, 1))
        gx = -(u * ca - v * sa) / np.maximum(hgt, 0.15) / c["a"] * half * 0.55
        gy = -(u * sa + v * ca) / np.maximum(hgt, 0.15) / c["a"] * half * 0.55
        nz = 1.0 / np.sqrt(1.0 + gx * gx + gy * gy)
        nx, ny = -gx * nz, -gy * nz
        lam = np.clip(nx * light[0] + ny * light[1] + nz * light[2], 0.05, 1.0)
        basalt = np.array([96.0, 98.0, 102.0]) * (1.0 - 0.08 * c["warm"]) + np.array([16.0, 10.0, 0.0]) * c["warm"]
        shade = (0.5 + 0.7 * lam)[..., None] * c["tone"]
        col = basalt[None, None, :] * shade
        # A dark contact rim where the cobble meets the mud.
        rim = np.clip((d2 - 0.78) / 0.22, 0, 1)[..., None]
        col = col * (1.0 - 0.5 * rim)
        px = (int(round(c["cx"])) + xx)[inside] % n
        py = (int(round(c["cy"])) + yy)[inside] % n
        img[py, px] = col[inside]
        # a soft contact shadow in the mud, to the lower right
        sh_inside = (((u - 0.18) ** 2 + (v - 0.14) ** 2) <= 1.28) & ~inside
        px2 = (int(round(c["cx"])) + xx)[sh_inside] % n
        py2 = (int(round(c["cy"])) + yy)[sh_inside] % n
        img[py2, px2] = img[py2, px2] * 0.72
    return img.astype(np.float32)


AUTHOR = {
    "wetland_open_tile": author_open,
    "basalt_rock_tile": author_rock,
    "wet_scrub_tile": author_scrub,
    "oak_litter_tile": author_litter,
    "basalt_scree_tile": author_scree,
}


# --- the checks -------------------------------------------------------------------


def seam_check(u8):
    """The repeat seam, per axis, against the image's OWN adjacent-line statistics.

    `d_i` is the mean absolute difference between image lines i and i+1 (all
    channels); `d_wrap` is the same between the last and the first line, the
    pair a repeat puts side by side. Returns `(ratio, rank, ok)` for the worse
    axis: `ratio = min(d_wrap, median) / max(d_wrap, median)` (1.0 is a
    perfectly ordinary pair) and `rank`, the share of interior pairs that differ
    MORE than the wrap pair. `ok` is the gate: the wrap pair must not be an
    outlier, i.e. `d_wrap` at most the interior p95.

    Why a rank and not only the spec's ratio of at least 0.9: on a hard-edged
    image the interior pairs themselves spread over p10-p90 = 0.6-1.2 of their
    median (measured on the open tile), so a single pair cannot be held to 0.9
    even when the image is periodic by construction. The ratio is reported; the
    gate is the outlier test, which a step across the wrap fails
    (`test_author_wetland_tiles.py`).
    """
    f = u8.astype(np.float64)
    worst_ratio, worst_rank, ok = 1.0, 1.0, True
    for ax in (0, 1):
        other = (1, 2) if ax == 0 else (0, 2)
        d = np.abs(np.diff(f, axis=ax)).mean(axis=other)
        wrap = float(np.abs(np.take(f, 0, axis=ax) - np.take(f, -1, axis=ax)).mean())
        med = float(np.median(d))
        lo, hi = sorted((wrap, med))
        ratio = lo / hi if hi > 0 else 1.0
        rank = float(np.mean(d >= wrap))
        worst_ratio = min(worst_ratio, ratio)
        worst_rank = min(worst_rank, rank)
        ok = ok and wrap <= float(np.percentile(d, 95))
    return worst_ratio, worst_rank, ok


def mip(u8, spec):
    n = FINAL
    size = spec["repeat"] * TILE_PIXELS
    factor = n / size
    # Box filter to `size` (as the mip chain does); factor is not always an integer.
    img = u8.astype(np.float64)
    edges = np.rint(np.linspace(0, n, size + 1)).astype(int)
    rows = np.add.reduceat(img, edges[:-1], axis=0) / np.diff(edges)[:, None, None]
    return np.add.reduceat(rows, edges[:-1], axis=1) / np.diff(edges)[None, :, None]


def visible_contrast(u8, spec):
    m = mip(u8, spec)
    lum = m.mean(axis=2)
    return float(lum.std() / lum.mean() * spec["gain"])


def composed(u8, spec, tone_hex):
    """The zoom-1 mip, composed the ground shader's way: tone * (1 + gain * (texel/mean - 1))."""
    mean = u8.reshape(-1, 3).astype(np.float64).mean(axis=0)
    m = mip(u8, spec)
    ratio = 1.0 + spec["gain"] * (m / mean - 1.0)
    return np.clip(hex_rgb(tone_hex) * ratio, 0, 255)


def figure_ground(u8, spec, tone_hex):
    """Share of composed zoom-1 texels within CIEDE2000 12 of KDF olive.1, plus the
    share within 8 and the tone's own distance."""
    c = composed(u8, spec, tone_hex)
    lab = srgb_to_lab(c)
    ref = srgb_to_lab(hex_rgb(OLIVE_1))
    d = de2000(lab, np.broadcast_to(ref, lab.shape))
    return float(np.mean(d <= FG_DELTA)), float(np.mean(d <= 8.0)), float(np.median(d))


# --- driver ------------------------------------------------------------------------


def build(name, master):
    spec = TILES[name]
    img = AUTHOR[name](master)
    u8 = to_u8(box_down(img, master // FINAL))
    return u8


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--master", type=int, default=4096)
    ap.add_argument("--only", default=None)
    ap.add_argument("--swatches", action="store_true")
    ap.add_argument("--report", default=None)
    args = ap.parse_args()
    assert args.master % FINAL == 0
    os.makedirs(args.out, exist_ok=True)
    names = args.only.split(",") if args.only else list(TILES)
    report = {}
    status = 0
    for name in names:
        spec = TILES[name]
        u8 = build(name, args.master)
        Image.fromarray(u8, "RGB").save(os.path.join(args.out, name + ".png"), optimize=True)
        buf = io.BytesIO()
        Image.fromarray(u8, "RGB").save(buf, "JPEG", quality=90, subsampling=0, optimize=True)
        with open(os.path.join(args.out, name + ".jpg"), "wb") as fh:
            fh.write(buf.getvalue())
        mean = u8.reshape(-1, 3).astype(np.float64).mean(axis=0)
        seam, seam_rank, seam_ok = seam_check(u8)
        contrast = visible_contrast(u8, spec)
        row = dict(
            mean=[round(float(v), 1) for v in mean],
            seam_ratio=round(seam, 3),
            seam_rank=round(seam_rank, 3),
            seam_ok=bool(seam_ok),
            contrast=round(contrast, 4),
            jpeg_kb=round(len(buf.getvalue()) / 1024),
            md5=hashlib.md5(u8.tobytes()).hexdigest(),
            texels_per_metre=round(FINAL / spec["metres"], 1),
            repeat=spec["repeat"],
            gain=spec["gain"],
        )
        if name in ("wetland_open_tile", "wet_scrub_tile"):
            tones = {"open": TONES["open"]} if name == "wetland_open_tile" else {k: TONES[k] for k in ("cover1", "cover2", "cover3")}
            row["figure_ground"] = {}
            for k, (tname, hexv) in tones.items():
                share, share8, med = figure_ground(u8, spec, hexv)
                row["figure_ground"][k] = dict(tone=tname, share_within_12=round(share, 4), share_within_8=round(share8, 4), median_de=round(med, 2))
        report[name] = row
        flags = []
        if not seam_ok:
            flags.append(f"SEAM: the wrap pair is an outlier (ratio {seam:.3f}, rank {seam_rank:.3f})")
        if contrast < MIN_VISIBLE_CONTRAST:
            flags.append(f"CONTRAST {contrast:.4f} < {MIN_VISIBLE_CONTRAST}")
        print(f"{name}: mean {row['mean']}, seam ratio {seam:.3f} (rank {seam_rank:.2f}, {'ok' if seam_ok else 'FAIL'}), contrast {contrast:.4f}, jpeg {row['jpeg_kb']} KB, md5 {row['md5'][:10]}")
        for k, fgv in row.get("figure_ground", {}).items():
            print(f"    figure-ground on {fgv['tone']}: {fgv['share_within_12']*100:.1f}% within dE12 of olive.1 (median dE {fgv['median_de']})")
        if flags:
            print("    FLAGS:", "; ".join(flags))
            status = 1
        if args.swatches:
            big = np.tile(u8, (3, 3, 1))
            Image.fromarray(big, "RGB").resize((1536, 1536), Image.LANCZOS).save(os.path.join(args.out, name + "_swatch3x3.png"))
    if args.report:
        with open(args.report, "w") as fh:
            json.dump(report, fh, indent=2)
    return status


if __name__ == "__main__":
    sys.exit(main())
