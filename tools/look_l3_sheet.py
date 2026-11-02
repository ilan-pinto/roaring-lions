#!/usr/bin/env python3
"""Composes the L3 approval sheets (GH-943) from `tools/src/perf/look-l3-captures.ts` output.

    python3 tools/look_l3_sheet.py <raw dir> <out dir>

Sheet A (garage): three headings x {today, maps, maps + mask}, whole frame and a 2x turret crop.
Sheet B (in game): the gated `vehicle` framing at zoom 1 and 2.5, day / dawn / dusk, today against L3
with the mask on, the mask off and the normal maps off, and the mask as own / hostile / deuteranopia
beside a mask-off column. Crops are NATIVE resolution (2800x1800 frames, DPR 2); nothing is resampled
except the whole-frame overview of sheet A.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

raw, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
meta = json.load(open(os.path.join(raw, "capture.json")))
FONT = ImageFont.load_default(size=28)
SMALL = ImageFont.load_default(size=22)
PAD = 16
BG = (24, 24, 24)


def label(img, text, small=False):
    f = SMALL if small else FONT
    h = 44 if not small else 36
    tile = Image.new("RGB", (img.width, img.height + h), BG)
    tile.paste(img, (0, h))
    ImageDraw.Draw(tile).text((10, 5 if not small else 4), text, fill=(235, 235, 235), font=f)
    return tile


def grid(rows, header_cols=None, row_labels=None, footer=None):
    cell_w = max(t.width for r in rows for t in r)
    cell_h = max(t.height for r in rows for t in r)
    left = 150 if row_labels else 0
    top = 50 if header_cols else 0
    foot = 60 if footer else 0
    W = left + len(rows[0]) * (cell_w + PAD) + PAD
    H = top + len(rows) * (cell_h + PAD) + PAD + foot
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    if header_cols:
        for c, text in enumerate(header_cols):
            d.text((left + PAD + c * (cell_w + PAD), 10), text, fill=(255, 220, 120), font=FONT)
    for r, row in enumerate(rows):
        if row_labels:
            d.text((10, top + PAD + r * (cell_h + PAD) + 8), row_labels[r], fill=(255, 220, 120), font=FONT)
        for c, tile in enumerate(row):
            sheet.paste(tile, (left + PAD + c * (cell_w + PAD), top + PAD + r * (cell_h + PAD)))
    if footer:
        for i, line in enumerate(footer):
            d.text((10, H - foot + 4 + i * 26), line, fill=(180, 180, 180), font=SMALL)
    return sheet


def cond_footer(extra=None):
    g = meta.get("gpu", "?")
    return [f"GPU {g}", extra or ""]


# ------------------------------------------------------------------ Sheet A
yaws = [30, 150, 270]
arms = [("today", "today"), ("maps", "maps (no mask)"), ("maps_mask", "maps + team mask")]
whole = []
crops = []
for yaw in yaws:
    row_w, row_c = [], []
    for arm, _ in arms:
        im = Image.open(os.path.join(raw, f"garage_{arm}_yaw{yaw}.png")).convert("RGB")
        row_w.append(im.resize((im.width // 2, im.height // 2), Image.LANCZOS))
        row_c.append(Image.open(os.path.join(raw, f"garage_{arm}_yaw{yaw}_turret.png")).convert("RGB"))
    whole.append(row_w)
    crops.append(row_c)
foot = cond_footer("garage bay (mountGarageView) 1440x960 CSS px, DPR 2 (frames 2880x1920; this overview halved, the crops native), unkitted, tier 0; today = the Lavi GLB at main, same page code")
a1 = grid(whole, [a[1] for a in arms], [f"yaw {y}" for y in yaws], foot)
a1.save(os.path.join(out, "sheetA_garage_overview.png"))
a2 = grid(crops, [a[1] for a in arms], [f"yaw {y}" for y in yaws], cond_footer("2x turret crops, native device pixels (the overview's crop window: 44% x 40% of the 2880x1920 frame)"))
a2.save(os.path.join(out, "sheetA_garage_turret_2x.png"))

# ------------------------------------------------------------------ Sheet B
S = meta["ingame"]["sheetB"]
CROP = {1: (726, 872, 1426, 1272), 2.5: (150, 1120, 1000, 1580)}


def tile(name, z, cap):
    im = Image.open(os.path.join(raw, name)).convert("RGB").crop(CROP[z])
    return label(im, cap, small=True)


rows, names = [], []
for tod, z in [("day", 1), ("day", 2.5), ("dawn", 1), ("dusk", 1)]:
    k = f"{tod}/{z}"
    rows.append([
        tile(S[f"{k}/today"], z, "today"),
        tile(S[f"{k}/l3"], z, "L3 maps + mask"),
        tile(S[f"{k}/maskoff"], z, "maps, mask OFF"),
        tile(S[f"{k}/nomaps"], z, "mask, normal maps OFF"),
    ])
    names.append(f"{tod} z{z}")
b1 = grid(rows, None, names, cond_footer(f"sandbox beit_sahwan_outskirts, tick {meta.get('tick')}, goto(4.5, 20.5), 1400x900 CSS px DPR 2 (2800x1800), crops native; the bottom-left tank of the 2.5 frame is the Lavi"))
b1.save(os.path.join(out, "sheetB_ingame_today_vs_L3.png"))

mask = [
    tile(S["mask/own"], 2.5, "mask: OWN (team.kedem #2F6FD9)"),
    tile(S["mask/hostile"], 2.5, "mask: HOSTILE (#D93A2B)*"),
    tile(S["mask/deuteranopia_own"], 2.5, "mask: OWN, deuteranopia (#0072B2)"),
    tile(S["mask/off"], 2.5, "mask OFF"),
]
b2 = grid([mask], None, ["zoom 2.5"], cond_footer("* hostile = the hostile hex written into the OWN slot (the hook reads one shared uniform per slot, so it is pixel-identical to a hostile hull)"))
b2.save(os.path.join(out, "sheetB_ingame_mask_own_hostile_deuteranopia.png"))
print("wrote sheets to", out)
