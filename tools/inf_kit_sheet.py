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


STATE_ORDER = ["none", "a1", "a2", "a3", "s1", "s2", "s3", "f1", "f2", "f3", "full"]
STATE_NAME = {"none": "T0 (none)", "a1": "armour T1", "a2": "armour T2", "a3": "armour T3", "s1": "sensors T1",
              "s2": "sensors T2", "s3": "sensors T3", "f1": "firepower T1", "f2": "firepower T2",
              "f3": "firepower T3", "full": "full kit"}


def garage_sheet(d, heading, out, cols=3, scale=0.5):
    """The eleven states of one heading, at the garage framing, as a labelled contact sheet."""
    ims = [Image.open(os.path.join(d, f"garage_{s}_{heading:03d}.png")).convert("RGB") for s in STATE_ORDER]
    w, h = ims[0].size
    w2, h2 = int(w * scale), int(h * scale)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w2, rows * h2), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    f = font(16)
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        sheet.paste(im.resize((w2, h2), Image.LANCZOS), (c * w2, r * h2))
        dr.text((c * w2 + 8, r * h2 + 6), f"{STATE_NAME[STATE_ORDER[i]]}   heading {heading}", fill=(255, 255, 255), font=f)
    sheet.save(out)
    print(out, sheet.size)


def pair_sheet(d, out, team, a_state="none", b_state="full", headings=(0, 180), pad=110):
    """The contact sheet for a team: tier 0 beside the full kit, front (heading 0) above back (180), at the garage framing.
    The crop is the union of everything the kit adds (plus `pad` px) so the figures are as large as the frame allows."""
    import numpy as np
    ims = {(s, h): Image.open(os.path.join(d, f"garage_{s}_{h:03d}.png")).convert("RGB") for s in (a_state, b_state) for h in headings}
    x0 = y0 = 10 ** 9
    x1 = y1 = 0
    for h in headings:
        diff = np.abs(np.array(ims[(b_state, h)]).astype(int) - np.array(ims[(a_state, h)]).astype(int)).max(2) > 6
        ys, xs = np.where(diff)
        x0, x1, y0, y1 = min(x0, xs.min()), max(x1, xs.max()), min(y0, ys.min()), max(y1, ys.max())
    # the T0 figures themselves, from the garage background: take the whole row band of the sand and figures
    w, hh = ims[(a_state, headings[0])].size
    x0, x1 = max(0, x0 - pad), min(w, x1 + pad)
    y0, y1 = max(0, y0 - 30), min(hh, y1 + 150)
    cw, ch = x1 - x0, y1 - y0
    head = 34
    sheet = Image.new("RGB", (cw * 2 + 6, (ch + head) * len(headings)), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    f = font(19)
    for r, h in enumerate(headings):
        for c, st in enumerate((a_state, b_state)):
            sheet.paste(ims[(st, h)].crop((x0, y0, x1, y1)), (c * (cw + 6), r * (ch + head) + head))
            name = "tier 0" if st == "none" else "full kit (3 x tier 3)"
            dr.text((c * (cw + 6) + 8, r * (ch + head) + 6), f"{team}  {name}  {'front' if h == 0 else 'back'}  heading {h}", fill=(255, 255, 255), font=f)
    sheet.save(out)
    print(out, sheet.size, "crop", (x0, y0, x1, y1))


def compare(old, new, out, label_old, label_new, scale_old=2):
    """Old kit beside the new kit at the same framing: the old capture is upscaled to the new's size."""
    o = Image.open(old).convert("RGB")
    n = Image.open(new).convert("RGB")
    o = o.resize((n.width, n.height), Image.LANCZOS)
    head = 34
    sheet = Image.new("RGB", (n.width * 2 + 8, n.height + head), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    f = font(18)
    sheet.paste(o, (0, head))
    sheet.paste(n, (n.width + 8, head))
    dr.text((8, 6), label_old, fill=(255, 255, 255), font=f)
    dr.text((n.width + 16, 6), label_new, fill=(255, 255, 255), font=f)
    sheet.save(out)
    return sheet


def zones_sheet(d, fig, out):
    """Track close-ups: rows = tracks (armour torso, sensors head, firepower weapon), columns T1-T3."""
    tracks = ("armour", "sensors", "firepower")
    probe = Image.open(os.path.join(d, f"zone_{fig}_armour_T1.png")).convert("RGB")
    w, h = probe.size
    sheet = Image.new("RGB", (w * 3, (h + 24) * 3), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    f = font(15)
    for r, tr in enumerate(tracks):
        for c, t in enumerate((1, 2, 3)):
            im = Image.open(os.path.join(d, f"zone_{fig}_{tr}_T{t}.png")).convert("RGB")
            sheet.paste(im, (c * w, r * (h + 24) + 24))
            dr.text((c * w + 8, r * (h + 24) + 4), f"{fig}  {tr} T{t}", fill=(255, 255, 255), font=f)
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "garage":
        garage_sheet(sys.argv[2], int(sys.argv[3]), sys.argv[4])
        sys.exit(0)
    if mode == "pair":
        pair_sheet(sys.argv[2], sys.argv[3], sys.argv[4])
        sys.exit(0)
    if mode == "zones":
        zones_sheet(sys.argv[2], sys.argv[3], sys.argv[4])
        sys.exit(0)
    if mode == "compare":
        # compare <old png> <new png> <out png>
        compare(sys.argv[2], sys.argv[3], sys.argv[4], "OLD full kit (PR 885, garage-1)", "NEW full kit (redesign R1, same framing)")
        sys.exit(0)
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
