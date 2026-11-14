#!/usr/bin/env python3
"""Unit busts for the avatar presets (GH-1075 P3).

    python3 tools/avatars/crop_busts.py [--sheet-dir <dir>]

Writes assets/ui/avatars/units/<id>.webp, 256 x 256, for the twelve units named in
data/avatars/presets.json (the `unit` presets). Source: the 512 px portrait masters,
art/portraits/masters/lead/<id>.png for a figure team and art/portraits/masters/<id>.png for a vehicle.
No Blender, no Meshy: a crop of art that already ships.

Numbers (spec 2026-11-14-avatars-and-profile-design.md, 3.3, approved by the lead 14 Nov):

- Figure: a 256 px square cut at NATIVE resolution (no resampling). Its top edge sits 12 px above the figure's alpha
  bounding box; it is centred on the head column, the horizontal extent of the first 48 rows that hold an opaque
  pixel. The box is clamped inside the 512 px master.
- Vehicle: the whole master, Lanczos-downscaled to 256 on premultiplied alpha (it is already framed at 88%).
- Output: WebP, lossy quality 85, lossless alpha, method 6; transparent outside the subject.

Deterministic: Pillow only, no noise, no clock; a re-run is byte-identical on one machine and one libwebp.
`--sheet-dir` also writes bust-sheet.png there (a contact sheet for the lead: never into the repo).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'ui', 'avatars', 'units')
MASTERS = os.path.join(ROOT, 'art', 'portraits', 'masters')

SIZE = 256            # output side, px
MARGIN = 12           # px of headroom above the figure's bounding box
HEAD_ROWS = 48        # the head column is read from this many opaque rows
OPAQUE = 128          # alpha at or above this counts as the figure
QUALITY = 85          # WebP lossy quality (0.85), alpha lossless


def units():
    with open(os.path.join(ROOT, 'data', 'avatars', 'presets.json')) as f:
        presets = json.load(f)['presets']
    return [(p['unit'], p['side']) for p in presets if p['family'] == 'unit']


def master_path(unit):
    """(path, is_figure): the lead-figure master when one exists, else the vehicle master."""
    lead = os.path.join(MASTERS, 'lead', unit + '.png')
    if os.path.exists(lead):
        return lead, True
    return os.path.join(MASTERS, unit + '.png'), False


def figure_box(im):
    """The 256 px crop box (left, top) for a figure master, by the rule above."""
    alpha = np.asarray(im)[..., 3]
    opaque = alpha >= OPAQUE
    rows = np.flatnonzero(opaque.any(axis=1))
    top_row = int(rows[0])
    head = opaque[rows[:HEAD_ROWS]]
    cols = np.flatnonzero(head.any(axis=0))
    cx = (int(cols[0]) + int(cols[-1]) + 1) // 2
    left = min(max(cx - SIZE // 2, 0), im.width - SIZE)
    top = min(max(top_row - MARGIN, 0), im.height - SIZE)
    return left, top, top_row, cx


def make(unit):
    path, is_figure = master_path(unit)
    im = Image.open(path).convert('RGBA')
    if is_figure:
        left, top, top_row, cx = figure_box(im)
        out = im.crop((left, top, left + SIZE, top + SIZE))
        note = f'figure  box=({left},{top},{left + SIZE},{top + SIZE})  top_row={top_row}  head_cx={cx}'
    else:
        out = im.convert('RGBa').resize((SIZE, SIZE), Image.LANCZOS).convert('RGBA')
        note = f'vehicle {im.width}->{SIZE} Lanczos'
    return out, note


def save(img, unit):
    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(OUT, unit + '.webp')
    img.save(dest, 'WEBP', quality=QUALITY, alpha_quality=100, method=6)
    return dest


def sheet(entries, dest):
    """Each bust at 256, 72 and 28 px on its side's ground (olive.3 for the KDF, dust.6 for Sarim)."""
    with open(os.path.join(ROOT, 'data', 'palette.json')) as f:
        ramps = json.load(f)['ramps']
    ground = {'kdf': ramps['olive']['colors'][3], 'sarim': ramps['dust']['colors'][6]}
    cols, cw, ch = 4, 290, 360
    rows = (len(entries) + cols - 1) // cols
    img = Image.new('RGB', (cols * cw, rows * ch), (40, 40, 40))
    d = ImageDraw.Draw(img)
    for i, (unit, side, bust) in enumerate(entries):
        x0, y0 = (i % cols) * cw, (i // cols) * ch
        g = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        ImageDraw.Draw(g).ellipse((0, 0, SIZE - 1, SIZE - 1), fill=ground[side])
        g.alpha_composite(bust)
        # round off to the roundel the app draws behind a bust
        mask = Image.new('L', (SIZE, SIZE), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, SIZE - 1, SIZE - 1), fill=255)
        for px, ox, oy in ((256, 17, 6), (72, 17, 270), (28, 105, 292)):
            t = g.resize((px, px), Image.LANCZOS)
            m = mask.resize((px, px), Image.LANCZOS)
            img.paste(t, (x0 + ox, y0 + oy), m)
        d.text((x0 + 140, y0 + 280), f'{unit}\n256 / 72 / 28 px', fill=(230, 230, 230))
    img.save(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet-dir', default=None)
    args = ap.parse_args()
    entries = []
    for unit, side in units():
        img, note = make(unit)
        dest = save(img, unit)
        print(f'{unit:18s} {note}  {os.path.getsize(dest)} bytes')
        entries.append((unit, side, Image.open(dest).convert('RGBA')))
    if args.sheet_dir:
        os.makedirs(args.sheet_dir, exist_ok=True)
        sheet(entries, os.path.join(args.sheet_dir, 'bust-sheet.png'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
