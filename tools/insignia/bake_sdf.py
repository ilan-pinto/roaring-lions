#!/usr/bin/env python3
"""GH-1096 S0: bake the Roaring Lion insignia into its two-channel signed-distance texture.

    python3 tools/insignia/bake_sdf.py [--svg art/src/insignia/roaring_lion.svg]
                                       [--out assets/textures/insignia/roaring_lion_sdf.png]

The source is the hand-authored `art/src/insignia/roaring_lion.svg`. The bake reads exactly two groups of it:
`<g id="silhouette">` and `<g id="cutouts">`. Each holds `<path>`s, and each path is ONE closed polygon written
with absolute `M`, `L` and `Z` only. Every vertex sits in the RIGHT half of the 200 x 200 viewBox (x >= 100), and
a polygon that reaches the centreline closes along it. The bake mirrors that half, so the emblem is symmetric by
construction. Anything else inside those two groups is refused with an error. A layer is the union of its
polygons, and each polygon fills even-odd. The preview `<use>`/`<mask>` elements outside the two groups are for
people. The bake never reads them.

The output (spec section 3.2, step 3) is a 256 x 256 RGBA PNG:
  - R: the signed distance to the silhouette's edge.
  - G: the signed distance to the cut-outs' edge.
  - B: 0. A: 255.
  - Each distance is in texels. It is stored as `128 + 16 * d`, rounded and clamped to 0..255, so 128 is the edge,
    the spread is +/-8 texels, inside is above 128 and outside below it.
  - The 200-unit viewBox spans texels 8..248 (1.2 texels per unit), which leaves the 8-texel border for the spread.

How, and why it is reproducible to the byte:
  - Each layer is rasterised at 17 x 17 sub-pixels per texel (4352 x 4352) by an even-odd scanline fill in
    INTEGER arithmetic. A coordinate is read as an exact number of hundredths, so a crossing is never rounded.
    Only the right half is filled; its columns are mirrored onto the left.
  - A texel centre is a sub-pixel centre (17 is odd). The distance there is an exact Euclidean distance transform
    in integers, capped beyond the spread, then one square root. sd = d - 0.5 sub-pixels, because the edge lies
    half-way between two sub-pixel centres.
  - The PNG is written here with the standard library's zlib, with no timestamp and no text chunk. There is no
    PIL, no randomness, no clock and no `mathutils`.
  - A re-run in one environment is byte-identical. The DECODED pixels do not depend on the numpy version or the
    zlib build. The compressed bytes can differ between zlib builds, so `tools/src/insignia_bake.test.ts`
    compares pixels with the committed file and bytes between two fresh bakes.

The spec's sketch rasterised with PIL at 4096 x 4096. This bake does not use PIL: Pillow's wheels bundle their
own zlib (zlib-ng from Pillow 11), and its polygon fill has changed between releases. 17 sub-pixels per texel
puts each texel centre on a sub-pixel centre, so the sampled distance is exact and the mirror is exact.
"""
import argparse
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from decimal import Decimal

import numpy as np

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SVG = os.path.join(REPO, 'art', 'src', 'insignia', 'roaring_lion.svg')
OUT = os.path.join(REPO, 'assets', 'textures', 'insignia', 'roaring_lion_sdf.png')

TEX = 256  # texture size, texels
SUB = 17  # sub-pixels per texel (odd: a texel centre is a sub-pixel centre)
N = TEX * SUB  # 4352, the raster
BORDER_TEX = 8  # viewBox 0..200 -> texels 8..248
VIEW = 200
AXIS_HUNDREDTHS = 100 * 100  # x = 100, in hundredths of a unit
# One unit is 1.2 texels = 20.4 sub-pixels. Positions are kept as integers in 1/500 sub-pixel:
#   500 * X = 500 * 136 + 10200 * u = 68000 + 102 * (hundredths of a unit).
Q = 500
ORIGIN_Q = Q * BORDER_TEX * SUB  # 68000
PER_HUNDREDTH_Q = 102
HALF = N // 2  # 2176: the axis falls on a sub-pixel boundary
SPREAD_TEX = 8
CAP = SPREAD_TEX * SUB + 4  # distances past the spread saturate; 140 sub-pixels is enough to saturate both ends

SVG_NS = '{http://www.w3.org/2000/svg}'
LAYERS = ('silhouette', 'cutouts')
TOKEN = re.compile(r'[MLZ]|-?\d+(?:\.\d+)?')


def hundredths(text, where):
    d = Decimal(text) * 100
    if d != d.to_integral_value():
        raise SystemExit(f'{where}: {text} has more than two decimals')
    return int(d)


def parse_path(d, where):
    """One closed polygon from `M x,y L x,y ... Z`, as [(x, y)] in hundredths of a unit."""
    rest = TOKEN.sub(' ', d.replace(',', ' ')).strip()
    if rest:
        raise SystemExit(f'{where}: unsupported path data {rest!r} (only absolute M, L, Z)')
    toks = TOKEN.findall(d.replace(',', ' '))
    if not toks or toks[0] != 'M' or toks[-1] != 'Z':
        raise SystemExit(f'{where}: a path must be one "M ... Z" polygon')
    pts, i = [], 1
    while i < len(toks) - 1:
        if toks[i] in ('M', 'Z'):
            raise SystemExit(f'{where}: one closed polygon per path (found a second {toks[i]})')
        if toks[i] == 'L':
            i += 1
            continue
        if i + 1 >= len(toks) - 1 or toks[i + 1] in 'MLZ':
            raise SystemExit(f'{where}: odd coordinate count')
        pts.append((hundredths(toks[i], where), hundredths(toks[i + 1], where)))
        i += 2
    if len(pts) < 3:
        raise SystemExit(f'{where}: a polygon needs three vertices')
    for x, y in pts:
        if x < AXIS_HUNDREDTHS:
            raise SystemExit(f'{where}: vertex ({x / 100}, {y / 100}) is left of the centreline; '
                             'author the right half only (x >= 100), the bake mirrors it')
        if x > VIEW * 100 or y < 0 or y > VIEW * 100:
            raise SystemExit(f'{where}: vertex ({x / 100}, {y / 100}) is outside the 200 x 200 viewBox')
    return pts


def read_layers(path):
    """{layer: [polygon]} from the SVG's two named groups. Refuses anything it would otherwise skip."""
    root = ET.parse(path).getroot()
    found = {}
    for g in root.iter(f'{SVG_NS}g'):
        lid = g.get('id')
        if lid not in LAYERS:
            continue
        if lid in found:
            raise SystemExit(f'{path}: two groups with id="{lid}"')
        polys = []
        for el in g:
            tag = el.tag.replace(SVG_NS, '')
            if tag != 'path':
                raise SystemExit(f'{path}: <{tag}> inside <g id="{lid}">; only <path> is read')
            if el.get('transform'):
                raise SystemExit(f'{path}: a transform on {el.get("id")}; write the coordinates out')
            polys.append(parse_path(el.get('d', ''), f'{lid}/{el.get("id")}'))
        if not polys:
            raise SystemExit(f'{path}: <g id="{lid}"> holds no polygon')
        found[lid] = polys
    missing = [lid for lid in LAYERS if lid not in found]
    if missing:
        raise SystemExit(f'{path}: no <g id="{missing[0]}">')
    return found


def fill_right_half(polys):
    """Union of the polygons' even-odd fills, over the sub-pixels right of the axis: bool (N, HALF)."""
    out = np.zeros((N, HALF), dtype=bool)
    for poly in polys:
        q = [(ORIGIN_Q + PER_HUNDREDTH_Q * x, ORIGIN_Q + PER_HUNDREDTH_Q * y) for x, y in poly]
        ys = [p[1] for p in q]
        r0 = max(0, (min(ys) - Q // 2) // Q)
        r1 = min(N, -((Q // 2 - max(ys)) // Q) + 1)
        toggles = np.zeros((r1 - r0, HALF + 1), dtype=np.int32)
        for (xa, ya), (xb, yb) in zip(q, q[1:] + q[:1]):
            if ya == yb:
                continue
            lo, hi = min(ya, yb), max(ya, yb)
            # rows whose centre yc = Q*r + Q/2 lies in [lo, hi)
            ra = -((Q // 2 - lo) // Q)
            rb = -((Q // 2 - hi) // Q)
            if rb <= ra:
                continue
            rows = np.arange(ra, rb, dtype=np.int64)
            yc = Q * rows + Q // 2
            num = (yc - ya) * (xb - xa)
            den = yb - ya
            if den < 0:
                num, den = -num, -den
            # first column whose centre Q*i + Q/2 is strictly right of the crossing xa + num/den
            k = (num + (xa - Q // 2) * den) // (Q * den) + 1
            kk = np.clip(k - HALF, 0, HALF)
            np.add.at(toggles, (rows - r0, kk), 1)
        inside = (np.cumsum(toggles, axis=1)[:, :HALF] & 1).astype(bool)
        out[r0:r1] |= inside
    return out


def mirror(right):
    return np.concatenate([right[:, ::-1], right], axis=1)


def signed_distance(mask):
    """Signed distance in texels at the 256 x 256 texel centres; inside positive."""
    samples = SUB * np.arange(TEX, dtype=np.int64) + SUB // 2
    pad = np.zeros((N + 2 * CAP, N + 2 * CAP), dtype=bool)
    pad[CAP:CAP + N, CAP:CAP + N] = mask
    big = CAP + 1
    # vertical pass at the sample rows, every column: distance to the nearest True / False sub-pixel
    rows = samples + CAP
    g_true = np.full((TEX, N + 2 * CAP), big, dtype=np.int64)
    g_false = np.full((TEX, N + 2 * CAP), big, dtype=np.int64)
    for d in range(CAP + 1):
        up, down = pad[rows - d], pad[rows + d]
        hit_t = up | down
        hit_f = ~up | ~down
        g_true[(g_true == big) & hit_t] = d
        g_false[(g_false == big) & hit_f] = d
    # the border is False: past the raster, a False sub-pixel is always found, never a True one
    # horizontal pass at the sample columns
    cols = samples + CAP
    d2_true = np.full((TEX, TEX), big * big * 2, dtype=np.int64)
    d2_false = np.full((TEX, TEX), big * big * 2, dtype=np.int64)
    for dx in range(-CAP, CAP + 1):
        d2_true = np.minimum(d2_true, dx * dx + g_true[:, cols + dx] ** 2)
        d2_false = np.minimum(d2_false, dx * dx + g_false[:, cols + dx] ** 2)
    inside = mask[np.ix_(samples, samples)]
    d_in = np.sqrt(d2_false.astype(np.float64)) - 0.5
    d_out = np.sqrt(d2_true.astype(np.float64)) - 0.5
    sub = np.where(inside, d_in, -d_out)
    return sub / SUB


def quantise(sd_tex):
    return np.clip(np.floor(128.0 + 16.0 * sd_tex + 0.5), 0, 255).astype(np.uint8)


def png_bytes(rgba):
    """A deterministic RGBA8 PNG: filter 0 on every row, zlib level 9, no ancillary chunks."""
    h, w, _ = rgba.shape
    raw = b''.join(b'\x00' + rgba[y].tobytes() for y in range(h))

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def bake(svg_path):
    layers = read_layers(svg_path)
    rgba = np.zeros((TEX, TEX, 4), dtype=np.uint8)
    rgba[..., 0] = quantise(signed_distance(mirror(fill_right_half(layers['silhouette']))))
    rgba[..., 1] = quantise(signed_distance(mirror(fill_right_half(layers['cutouts']))))
    rgba[..., 3] = 255
    return rgba, {lid: len(p) for lid, p in layers.items()}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--svg', default=SVG)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args(argv)
    rgba, counts = bake(a.svg)
    data = png_bytes(rgba)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'wb') as f:
        f.write(data)
    print(f'wrote {a.out}: {TEX}x{TEX} RGBA, {len(data)} bytes; '
          f'silhouette {counts["silhouette"]} polygons, cutouts {counts["cutouts"]} polygons')
    return 0


if __name__ == '__main__':
    sys.exit(main())
