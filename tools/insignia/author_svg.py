#!/usr/bin/env python3
"""GH-1096 S0: write the Roaring Lion insignia's SVG from its control points.

    python3 tools/insignia/author_svg.py [--out art/src/insignia/roaring_lion.svg]
    python3 tools/insignia/bake_sdf.py      # then re-bake the distance field

This is the editable source of the emblem's geometry. The committed SVG is the source of record: the bake reads it,
never this script. To change the art, edit a control point below, run this, look at the SVG, and re-bake. The
coordinates are chosen by hand. Nothing is traced from an image, and no generative tool is involved. The script
does three things:
  - it samples the curves (Catmull-Rom for the head, quadratic for the mane's locks) into straight segments;
  - it writes the circles out as polygons;
  - it offsets the face outline into the face gap.

Everything is built as RIGHT halves (x >= 100), with the y axis pointing down. A shape that crosses the centreline
closes along it, and the bake mirrors it. The rules the art keeps:
  - Paint and cut-outs are at least 5 units wide (2.5% of the 200-unit diameter), except where a mane stroke, the
    whisker line or a fang tapers to its point, and at the V of a notch.
  - `VALS` keeps the valley over the eye's corner shallow, because the face gap runs close there.

Python standard library only.
"""
import argparse
import math
import os

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(REPO, 'art', 'src', 'insignia', 'roaring_lion.svg')
C = 100.0

# the roundel and its ring gap
R_OUT = 98.0  # the silhouette: a disc
R_RING_IN = 90.0  # the ring's inner edge
# the mane: 18 flame locks, tips at 12.5 + 20k degrees clockwise from the top, valleys at 20k
TIP, VAL = 84.5, 70.0
VALS = {20: 74.0}  # a shallower valley over the eye's corner, where the face gap runs close
W0 = 3.2  # a mane stroke's half-width at its root
FACE_GAP = 9.5


def P(r, deg):
    """The point at radius r, deg clockwise from the top (y down)."""
    a = math.radians(deg)
    return (C + r * math.sin(a), C - r * math.cos(a))


def arc(r, d0, d1, step):
    n = max(1, round(abs(d1 - d0) / step))
    return [P(r, d0 + (d1 - d0) * i / n) for i in range(n + 1)]


def quad(a, c, b, n):
    return [((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
             (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1])
            for t in (i / n for i in range(n + 1))]


def catmull(pts, n):
    out = [pts[0]]
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for j in range(1, n + 1):
            t = j / n
            out.append(tuple(0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t
                                    + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t
                                    + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t ** 3) for d in (0, 1)))
    return out


def offset(poly, d):
    """An open polyline travelled clockwise, offset outward by d. Centreline points stay on the centreline."""
    out = []
    n = len(poly)
    for i, p in enumerate(poly):
        a, b = poly[max(i - 1, 0)], poly[min(i + 1, n - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        length = math.hypot(tx, ty)
        tx, ty = tx / length, ty / length
        q = (p[0] + ty * d, p[1] - tx * d)
        out.append((C, q[1]) if abs(p[0] - C) < 1e-9 else q)
    return out


def stroke(centre, w0):
    """A closed brush stroke along `centre`: pointed at both ends, half-width w0 near the start, tapering out."""
    n = len(centre)
    left, right = [], []
    for i, p in enumerate(centre):
        a, b = centre[max(i - 1, 0)], centre[min(i + 1, n - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        length = math.hypot(tx, ty)
        tx, ty = tx / length, ty / length
        t = i / (n - 1)
        w = w0 * min(1.0, t / 0.15) ** 0.5 * (1.0 - t) ** 0.45
        left.append((p[0] - ty * w, p[1] + tx * w))
        right.append((p[0] + ty * w, p[1] - tx * w))
    return [centre[0]] + left[1:-1] + [centre[-1]] + list(reversed(right[1:-1]))


def radius_at(poly, deg):
    """The distance from the centre to the polyline, along the ray at deg."""
    a = math.radians(deg)
    dx, dy = math.sin(a), -math.cos(a)
    best = None
    for (x0, y0), (x1, y1) in zip(poly, poly[1:]):
        ex, ey = x1 - x0, y1 - y0
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((x0 - C) * ey - (y0 - C) * ex) / den
        u = ((x0 - C) * dy - (y0 - C) * dx) / den
        if 0 <= u <= 1 and t > 0:
            best = t if best is None else min(best, t)
    return best


def T(p, keep_x=False):
    """Place a face point: 92% about the centre, 2 units up. keep_x holds a width that must stay 5 units."""
    return (p[0] if keep_x else C + (p[0] - C) * 0.92, C + (p[1] - C) * 0.92 - 2.0)


def layers():
    vr = lambda deg: VALS.get(deg, VAL)  # noqa: E731
    sil, cut = [], []
    sil.append(('roundel', arc(R_OUT, 0, 180, 5)))

    # the ring gap, bounded inside by the mane's outline
    sun = [P(vr(0), 0)]
    for k in range(9):
        a, tip, b = P(vr(20 * k), 20 * k), P(TIP, 20 * k + 12.5), P(vr(20 * k + 20), 20 * k + 20)
        sun += quad(a, P(TIP - 2.0, 20 * k + 5.0), tip, 6)[1:]
        sun += quad(tip, P(vr(20 * k + 20) + 9.0, 20 * k + 17.5), b, 6)[1:]
    cut.append(('ring_gap', arc(R_RING_IN, 0, 180, 5) + list(reversed(sun))))

    # the head (paint), top centre clockwise round to the chin; the face gap is its outward offset
    head_keys = [(100.0, 44.0), (117.0, 46.5), (130.0, 55.0), (141.0, 67.0), (146.5, 81.0), (148.0, 96.0),
                 (146.0, 111.0), (141.0, 125.0), (134.5, 139.0), (123.5, 150.5), (110.0, 157.5), (100.0, 159.5)]
    head = catmull([T(p) for p in head_keys], 3)
    gap_out = offset(head, FACE_GAP)
    cut.append(('face_gap', gap_out + list(reversed(head))))

    # mane strokes: from each valley, curling in toward the face (none on the axis, none where VALS is shallow)
    for k in range(1, 9):
        v = 20 * k
        if v in VALS:
            continue
        r_end = radius_at(gap_out, v - 9.0) + 7.5
        centre = catmull([P(VAL + 5.0, v + 0.5), P(VAL - 1.0, v - 1.0), P((VAL + r_end) / 2, v - 4.5),
                          P(r_end, v - 9.0)], 4)
        cut.append((f'lock_{k}', stroke(centre, W0)))

    cut += [
        # the eye: one bold angry wedge, the brow's slant built into its upper edge
        ('eye', [T(p) for p in [(104.5, 78.5), (115.5, 69.0), (133.5, 64.0), (132.5, 76.0), (116.0, 87.5)]]),
        # the nose pad
        ('nose', [T(p) for p in [(100.0, 99.5), (116.0, 98.5), (119.0, 102.0), (113.0, 110.0), (104.0, 116.5),
                                 (100.0, 117.0)]]),
        # the philtrum, nose to mouth
        ('philtrum', [T(p, True) for p in [(100.0, 114.0), (102.6, 114.0), (102.6, 124.0), (100.0, 124.0)]]),
        # the whisker line: tapered, from the nose's corner down round the muzzle
        ('muzzle', stroke(catmull([T(p) for p in [(116.5, 100.5), (125.0, 106.0), (129.5, 114.0),
                                                  (130.0, 121.5)]], 4), 2.6)),
        # the open mouth: the two fangs on this side are left standing as paint
        ('mouth', [T(p) for p in [
            (100.0, 121.0), (104.0, 122.5), (108.5, 126.5), (113.0, 128.5),
            (115.0, 129.0), (118.0, 141.0), (120.5, 130.0),  # upper fang
            (125.0, 128.0), (131.0, 124.5),  # mouth corner
            (128.0, 133.5), (122.5, 141.5), (117.0, 147.0),
            (113.5, 150.5), (110.0, 139.5), (107.0, 151.5),  # lower fang
            (100.0, 152.0),
        ]]),
    ]
    return {'silhouette': sil, 'cutouts': cut}


HEADER = '''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="400" viewBox="0 0 200 200">
  <title>The Roaring Lion insignia (GH-1096)</title>
  <!--
    The KDF unit insignia: a front-facing roaring lion's head with its mane, in a roundel.
    It is a one-colour stencil with no keyline. It is drawn, not traced: not from the Meshy relief, not from
    the favicon, not from any image. The coordinates are written by tools/insignia/author_svg.py from
    control points chosen by hand: curves sampled to straight segments, circles written out as polygons.
    Edit the control points there, re-run it, then re-bake. This file is the source of record.

    Two layers, read by tools/insignia/bake_sdf.py into assets/textures/insignia/roaring_lion_sdf.png:
      silhouette (R)  the roundel. Below 11 px on screen it is all that draws: a clean disc.
      cutouts    (G)  the ring gap with the mane's 18 locks, the mane strokes, the face gap, the eyes
                      (the brow's slant is their upper edge), the nose, the philtrum, the whisker lines and
                      the open mouth with its four fangs. Where they lie, the hull shows through.
                      Paint = silhouette minus cutouts.

    The format: every path is ONE closed polygon in absolute M/L/Z, written as its RIGHT half (x >= 100).
    A polygon that reaches the centreline closes along it. The bake mirrors each half about x = 100, so the
    emblem is symmetric by construction, and tools/src/insignia_bake.test.ts checks both the format and the
    baked texture. Within a layer, polygons are unioned. No gap, stroke or cut-out is narrower than 5 units
    (2.5% of the diameter), except where a mane stroke, a whisker line or a fang tapers to its point.

    Everything after </defs> is a PREVIEW for people. The bake never reads it. The paint is limestone.1
    (#E6D8BE) and the ground is the Lavi bake's median (#544F41).
  -->
  <defs>
'''
MIRROR = 'transform="matrix(-1 0 0 1 200 0)"'
FOOTER = f'''    <mask id="stencil" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
      <g fill="#FFFFFF"><use xlink:href="#silhouette"/><use xlink:href="#silhouette" {MIRROR}/></g>
      <g fill="#000000"><use xlink:href="#cutouts"/><use xlink:href="#cutouts" {MIRROR}/></g>
    </mask>
  </defs>
  <rect id="preview-ground" width="200" height="200" fill="#544F41"/>
  <rect id="preview-paint" width="200" height="200" fill="#E6D8BE" mask="url(#stencil)"/>
</svg>
'''


def svg_text():
    lines = []
    for layer, shapes in layers().items():
        lines.append(f'    <g id="{layer}">')
        for name, poly in shapes:
            if any(x < C - 1e-9 for x, _ in poly):
                raise SystemExit(f'{layer}/{name}: a vertex left of the centreline')
            d = ' L '.join(f'{x:.2f},{y:.2f}' for x, y in poly)
            lines.append(f'      <path id="{layer[:3]}-{name}" d="M {d} Z"/>')
        lines.append('    </g>')
    return HEADER + '\n'.join(lines) + '\n' + FOOTER


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args(argv)
    text = svg_text()
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'wrote {a.out}: {len(text)} bytes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
