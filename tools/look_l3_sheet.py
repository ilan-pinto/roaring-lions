#!/usr/bin/env python3
"""Composes the L3 approval sheet (GH-943) from `tools/src/perf/look-l3-captures.ts` output.

    python3 tools/look_l3_sheet.py <raw dir> <out png>

Sheet C: the garage at three headings, today against the crisp team mark; and in game (the gated `vehicle`
framing) at zoom 1 and 2.5, the mark as own, hostile and deuteranopia beside the mark off. In-game crops are
NATIVE resolution (2800x1800 frames, DPR 2); the garage frames (2880x1920) are halved for the sheet.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

raw, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(raw, "capture.json")))
FONT = ImageFont.load_default(size=28)
SMALL = ImageFont.load_default(size=22)
PAD = 16
BG = (24, 24, 24)


def label(img, text):
    tile = Image.new("RGB", (img.width, img.height + 36), BG)
    tile.paste(img, (0, 36))
    ImageDraw.Draw(tile).text((10, 4), text, fill=(235, 235, 235), font=SMALL)
    return tile


def grid(rows, col_w, left_labels):
    cell_h = max(t.height for r in rows for t in r)
    left = 150
    W = left + max(len(r) for r in rows) * (col_w + PAD) + PAD
    H = len(rows) * (cell_h + PAD) + PAD
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    for r, row in enumerate(rows):
        d.text((10, PAD + r * (cell_h + PAD) + 8), left_labels[r], fill=(255, 220, 120), font=FONT)
        for c, tile in enumerate(row):
            sheet.paste(tile, (left + PAD + c * (col_w + PAD), PAD + r * (cell_h + PAD)))
    return sheet


# garage: today | crisp mark, three headings (whole frames halved)
yaws = [30, 150, 270]
g_rows, g_labels = [], []
for yaw in yaws:
    row = []
    for arm, cap in (("today", "today"), ("mark", "crisp team mark (own colour)")):
        im = Image.open(os.path.join(raw, f"garage_{arm}_yaw{yaw}.png")).convert("RGB")
        row.append(label(im.resize((im.width // 2, im.height // 2), Image.LANCZOS), cap))
    g_rows.append(row)
    g_labels.append(f"garage\nyaw {yaw}")
garage = grid(g_rows, 1440, g_labels)

# in game
S = meta["ingame"]["sheetB"]
CROP = {1: (726, 872, 1426, 1272), 2.5: (150, 1120, 1000, 1580)}
b_rows, b_labels = [], []
for z in (1, 2.5):
    row = []
    for key, cap in (("own", "mark: OWN (#2F6FD9)"), ("hostile", "mark: HOSTILE (#D93A2B)*"), ("deuteranopia", "mark: OWN, deuteranopia (#0072B2)"), ("off", "mark OFF")):
        im = Image.open(os.path.join(raw, S[f"{key}/{z}"])).convert("RGB").crop(CROP[z])
        row.append(label(im, cap))
    b_rows.append(row)
    b_labels.append(f"in game\nzoom {z}")
ingame = grid(b_rows, max(t.width for r in b_rows for t in r), b_labels)

W = max(garage.width, ingame.width)
foot = [
    f"GPU {meta.get('gpu', '?')}",
    f"garage: mountGarageView 1440x960 CSS px, DPR 2, unkitted; today = the Lavi GLB at main, same page code. In game: sandbox beit_sahwan_outskirts, tick {meta.get('tick')}, goto(4.5, 20.5), 1400x900 CSS px, DPR 2, crops native.",
    "* hostile = the hostile hex written into the OWN slot (the hook reads one shared uniform per slot, so it is pixel-identical to a hostile hull).",
]
sheet = Image.new("RGB", (W, garage.height + ingame.height + 40 + 3 * 28), BG)
sheet.paste(garage, (0, 0))
sheet.paste(ingame, (0, garage.height + 20))
d = ImageDraw.Draw(sheet)
for i, line in enumerate(foot):
    d.text((10, garage.height + ingame.height + 30 + i * 28), line, fill=(180, 180, 180), font=SMALL)
sheet.save(out)
print("wrote", out, sheet.size)
