#!/usr/bin/env python3
"""Composes sheet D (GH-943): the crisp team mark on the camo Lavi and the officer tank.

    python3 tools/look_l3b_sheet.py <raw camo dir> <raw officer dir> <out png>

Garage at three headings, today against the mark, for both variants side by side; in game at zoom 1 and 2.5,
the mark as own, hostile and deuteranopia beside the mark off, one row group per variant. Raw frames come from
`tools/src/perf/look-l3-captures.ts --id=<vehicle>`. In-game crops are native resolution (2800x1800 frames, DPR 2);
the garage frames (2880x1920) are scaled to 1080 wide.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

camo, officer, out = sys.argv[1], sys.argv[2], sys.argv[3]
FONT = ImageFont.load_default(size=28)
SMALL = ImageFont.load_default(size=22)
PAD = 16
BG = (24, 24, 24)
LEFT = 150
GARAGE_W = 1080
CROP = {1: (726, 872, 1426, 1272), 2.5: (150, 1120, 1000, 1580)}
VARIANTS = [("mbt_lavi_camo", "camo Lavi", camo), ("officer_armour", "officer tank", officer)]


def label(img, text):
    tile = Image.new("RGB", (img.width, img.height + 36), BG)
    tile.paste(img, (0, 36))
    ImageDraw.Draw(tile).text((10, 4), text, fill=(235, 235, 235), font=SMALL)
    return tile


def sheet_of(rows, left_labels, col_w):
    cell_h = [max(t.height for t in r) for r in rows]
    W = LEFT + max(len(r) for r in rows) * (col_w + PAD) + PAD
    H = sum(cell_h) + PAD * (len(rows) + 1)
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    y = PAD
    for r, row in enumerate(rows):
        d.text((10, y + 8), left_labels[r], fill=(255, 220, 120), font=FONT)
        for c, tile in enumerate(row):
            sheet.paste(tile, (LEFT + PAD + c * (col_w + PAD), y))
        y += cell_h[r] + PAD
    return sheet


metas = {vid: json.load(open(os.path.join(raw, "capture.json"))) for vid, _, raw in VARIANTS}

# garage: camo today | camo mark | officer today | officer mark, three headings
g_rows, g_labels = [], []
for yaw in (30, 150, 270):
    row = []
    for vid, name, raw in VARIANTS:
        for arm, cap in (("today", f"{name}: today"), ("mark", f"{name}: crisp team mark")):
            im = Image.open(os.path.join(raw, f"garage_{arm}_yaw{yaw}.png")).convert("RGB")
            row.append(label(im.resize((GARAGE_W, GARAGE_W * im.height // im.width), Image.LANCZOS), cap))
    g_rows.append(row)
    g_labels.append(f"garage\nyaw {yaw}")
garage = sheet_of(g_rows, g_labels, GARAGE_W)

# in game: per variant, zoom 1 then 2.5
b_rows, b_labels = [], []
for vid, name, raw in VARIANTS:
    S = metas[vid]["ingame"]["sheetB"]
    for z in (1, 2.5):
        row = []
        for key, cap in (
            ("own", f"{name}: OWN (#2F6FD9)"),
            ("hostile", f"{name}: HOSTILE (#D93A2B)*"),
            ("deuteranopia", f"{name}: OWN, deuteranopia (#0072B2)"),
            ("off", f"{name}: mark OFF"),
        ):
            im = Image.open(os.path.join(raw, S[f"{key}/{z}"])).convert("RGB").crop(CROP[z])
            row.append(label(im, cap))
        b_rows.append(row)
        b_labels.append(f"{name}\nzoom {z}")
ingame = sheet_of(b_rows, b_labels, max(t.width for r in b_rows for t in r))

W = max(garage.width, ingame.width)
m = metas["mbt_lavi_camo"]
foot = [
    f"GPU {m.get('gpu', '?')}",
    f"garage: mountGarageView 1440x960 CSS px, DPR 2, unkitted; today = the variant GLB at origin/main (before the mark), same page code, frames scaled to {GARAGE_W} px wide.",
    f"in game: sandbox beit_sahwan_outskirts, tick {m.get('tick')}, goto(4.5, 20.5), 1400x900 CSS px, DPR 2, crops native. The sandbox places no variant: the variant's shipped GLB is served",
    "at the sandbox Lavi's path (both Lavis in frame draw as the variant), so the mark takes the same code path; the lower-left unit is the one cropped.",
    "* hostile = the hostile hex written into the OWN slot (the hook reads one shared uniform per slot, so it is pixel-identical to a hostile hull).",
    "officer_armour has no roster entry (a held unit), so the bay is mounted on its GLB directly; the bay frames it smaller than the Lavi because its mast sets the bounds.",
]
sheet = Image.new("RGB", (W, garage.height + ingame.height + 40 + len(foot) * 28), BG)
sheet.paste(garage, (0, 0))
sheet.paste(ingame, (0, garage.height + 20))
d = ImageDraw.Draw(sheet)
for i, line in enumerate(foot):
    d.text((10, garage.height + ingame.height + 30 + i * 28), line, fill=(180, 180, 180), font=SMALL)
sheet.save(out)
print("wrote", out, sheet.size)
