#!/usr/bin/env python3
"""Lay the infantry-kit approval frames into contact sheets (plain python3 + PIL).

    python3 tools/inf_kit_sheet.py grid  <frames dir> <zoom> <scale> <out.png>
    python3 tools/inf_kit_sheet.py turn  <frames dir> <name> <scale> <out.png>

Upscaling is nearest-neighbour and an integer, so a zoom-1 figure is still the
22 px figure the game draws, only bigger on the lead's screen. Every grid is
also written at scale 1 (`*_native.png`) so the true pixels are on disk.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

TRACKS = ("armour", "sensors", "firepower")
LETTER = {"armour": "a", "sensors": "s", "firepower": "f"}


def font(n):
    for p in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(p):
            return ImageFont.truetype(p, n)
    return ImageFont.load_default()


def load(d, zoom, label, hd):
    return Image.open(os.path.join(d, f"grid_z{zoom}_{label}_{hd:03d}.png")).convert("RGB")


def grid(d, zoom, scale, out, headings=(0, 180)):
    probe = load(d, zoom, "none", headings[0])
    cw, ch = probe.size
    sw, sh = cw * scale, ch * scale
    pad, head, side = 6, 26, 96
    cell_w = sw * len(headings) + pad
    rows = [(t, [None] + [f"{LETTER[t]}{n}" for n in (1, 2, 3)]) for t in TRACKS]
    W = side + 4 * cell_w + pad
    H = head + 4 * (sh + pad) + pad + 20
    sheet = Image.new("RGB", (W, H), (24, 24, 24))
    dr = ImageDraw.Draw(sheet)
    f, f2 = font(15), font(12)
    for c, name in enumerate(("T0 none", "T1", "T2", "T3")):
        dr.text((side + c * cell_w + 4, 5), name, fill=(235, 235, 235), font=f)
    for r, (track, labels) in enumerate(rows):
        y = head + r * (sh + pad)
        dr.text((6, y + sh // 2 - 8), track, fill=(235, 235, 235), font=f)
        for c, lab in enumerate(labels):
            for k, hd in enumerate(headings):
                im = load(d, zoom, lab or "none", hd)
                if scale != 1:
                    im = im.resize((sw, sh), Image.NEAREST)
                sheet.paste(im, (side + c * cell_w + k * sw, y))
    y = head + 3 * (sh + pad)
    dr.text((6, y + sh // 2 - 8), "full kit", fill=(235, 235, 235), font=f)
    for k, hd in enumerate(headings):
        im = load(d, zoom, "full", hd)
        if scale != 1:
            im = im.resize((sw, sh), Image.NEAREST)
        sheet.paste(im, (side + k * sw, y))
    dr.text((side + cell_w + 4, y + 4),
            f"zoom {zoom}  {scale}x nearest  headings {headings[0]} / {headings[1]} deg", fill=(180, 180, 180), font=f2)
    sheet.save(out)
    print(out, sheet.size)


def turn(d, name, scale, out):
    rows = []
    for label in ("none", "full"):
        rows.append([Image.open(os.path.join(d, f"turn_{name}_{label}_{hd:03d}.png")).convert("RGB")
                     for hd in range(0, 360, 45)])
    w, h = rows[0][0].size
    w, h = int(w * scale), int(h * scale)
    sheet = Image.new("RGB", (w * 8, h * 2), (24, 24, 24))
    dr = ImageDraw.Draw(sheet)
    f = font(14)
    for r, row in enumerate(rows):
        for c, im in enumerate(row):
            if scale != 1:
                im = im.resize((w, h), Image.LANCZOS)
            sheet.paste(im, (c * w, r * h))
            dr.text((c * w + 6, r * h + 4), f"{('none', 'full kit')[r]}  {c * 45} deg", fill=(255, 255, 255), font=f)
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "grid":
        d, zoom, scale, out = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
        grid(d, zoom, scale, out)
    elif mode == "sheet":
        # sheet <render-1 dir> : the one contact sheet, from files the other modes wrote
        d = sys.argv[2]
        fr = os.path.join(d, "frames")
        grid(fr, "1", 3, os.path.join(d, "_g1.png"))
        grid(fr, "2.5", 1, os.path.join(d, "_g25.png"))
        turn(fr, "squad", 1, os.path.join(d, "_ts.png"))
        parts = [Image.open(os.path.join(d, n)) for n in ("_ts.png", "_g1.png", "_g25.png")]
        W = max(p.width for p in parts)
        parts[0] = parts[0].resize((W, int(parts[0].height * W / parts[0].width)), Image.LANCZOS)
        head = 70
        sheet = Image.new("RGB", (W, head + sum(p.height + 8 for p in parts)), (24, 24, 24))
        dr = ImageDraw.Draw(sheet)
        dr.text((8, 6), "GH-826 approval render 1: inf_squad kit (Blender, Cycles 128 spl, game camera az 315 el 30, sun SUN_DIRECTION 2.6 + hemi 0.9, ACES)", fill=(255, 255, 255), font=font(16))
        dr.text((8, 30), "top: squad turntable none / full kit, 8 headings (75 px/m).  middle: tier grid at zoom 1 (3x nearest).  bottom: tier grid at zoom 2.5 (1x native).", fill=(200, 200, 200), font=font(14))
        y = head
        for p in parts:
            sheet.paste(p, (0, y))
            y += p.height + 8
        sheet.save(os.path.join(d, "sheet.png"))
        print(os.path.join(d, "sheet.png"), sheet.size)
        for n in ("_g1.png", "_g25.png", "_ts.png"):
            os.remove(os.path.join(d, n))
    elif mode == "turn":
        d, name, scale, out = sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
        turn(d, name, scale, out)
