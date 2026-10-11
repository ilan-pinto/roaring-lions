"""Compose the A3.2 phase-1 reference sheets from render_ref.py's 512 px stills.

Two sheets (buildings, vehicles). Per asset: the 512 px render, the same
render at gameplay zoom (64 px, GAMEPLAY_ZOOM in validate_assets.py), and its
pure-black silhouette at 64 px. The eight A3.2 assets sit left of a divider,
the photographed/supplied comparators right of it. Also prints per-asset
register numbers (mean L, S, hue over opaque pixels) for the plan's table.
"""
import colorsys
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

raw = sys.argv[1]
out = sys.argv[2]
os.makedirs(out, exist_ok=True)

SHEETS = {
    "buildings": (["concrete", "shanty", "wall", "camp"], ["house", "apartment", "warehouse"]),
    "vehicles": (["apc_eitan", "dozer_d9", "apc_kipod", "scout_shachaf"], ["mbt_lavi", "ifv_namer", "jeep_shoded"]),
}
BIG, SMALL, PAD, LABEL = 512, 64, 12, 22
try:
    FONT = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
    FONT_S = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
except OSError:
    FONT = FONT_S = ImageFont.load_default()


def stats(img):
    a = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    m = a[..., 3] > 0.5
    rgb = a[m][:, :3]
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in rgb])
    lum = (0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2])
    # circular hue mean
    ang = hsv[:, 0] * 2 * np.pi
    hue = (np.degrees(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) + 360) % 360
    return lum.mean(), hsv[:, 1].mean(), hue, m.mean()


def tile(uid):
    img = Image.open(os.path.join(raw, uid + ".png")).convert("RGBA")
    small = img.resize((SMALL, SMALL), Image.LANCZOS)
    a = np.asarray(small)[..., 3] >= 128
    sil = np.zeros((SMALL, SMALL, 4), np.uint8)
    sil[a] = (0, 0, 0, 255)
    sil = Image.fromarray(sil)
    w = BIG
    h = LABEL + BIG + PAD + SMALL + LABEL
    t = Image.new("RGBA", (w, h), (236, 232, 224, 255))
    d = ImageDraw.Draw(t)
    L, S, H, fill = stats(img)
    d.text((4, 2), f"{uid}", fill=(20, 20, 20), font=FONT)
    t.alpha_composite(img, (0, LABEL))
    y = LABEL + BIG + PAD
    t.alpha_composite(small, (0, y))
    t.alpha_composite(sil, (SMALL + PAD, y))
    d.text((2 * SMALL + 2 * PAD, y + 4), "64 px (gameplay zoom)  |  silhouette", fill=(60, 60, 60), font=FONT_S)
    d.text((2 * SMALL + 2 * PAD, y + 24), f"mean L {L:.3f}  sat {S:.3f}  hue {H:.0f} deg", fill=(60, 60, 60), font=FONT_S)
    print(f"{uid:14s} L={L:.3f} S={S:.3f} hue={H:5.1f} fill={fill:.3f}")
    return t


for name, (left, right) in SHEETS.items():
    tiles_l = [tile(u) for u in left]
    tiles_r = [tile(u) for u in right]
    th = tiles_l[0].height
    cols = max(len(left), len(right))
    W = cols * (BIG + PAD) + PAD
    H = 2 * (th + PAD) + PAD + 28
    sheet = Image.new("RGBA", (W, H), (250, 248, 244, 255))
    d = ImageDraw.Draw(sheet)
    d.text((PAD, 6), f"A3.2 phase 1 -- {name}: the A3.2 set (top row) against the photographed / supplied set (bottom row). "
           f"Shipped GLBs, own bake, dimetric camera, sun az 135 / alt 55, Eevee. 2026-10-11", fill=(20, 20, 20), font=FONT)
    y0 = 28 + PAD
    for i, t in enumerate(tiles_l):
        sheet.alpha_composite(t, (PAD + i * (BIG + PAD), y0))
    y1 = y0 + th + PAD
    for i, t in enumerate(tiles_r):
        sheet.alpha_composite(t, (PAD + i * (BIG + PAD), y1))
    sheet.convert("RGB").save(os.path.join(out, f"{name}.jpg"), quality=88)
    print("wrote", os.path.join(out, f"{name}.jpg"), sheet.size)
