"""Before/after sheets for A3.2 phase 2 from render_ref.py stills.

    composite_ba.py <before_dir> <after_dir> <out_dir>

fleet.jpg   -- the five KDF hulls (Eitan, Kipod, D9, Shachaf, Namer) beside
               the Lavi and the jeep, before (top) and after (bottom), 512 px
               each with the 64 px gameplay-zoom tile and register numbers.
shanty.jpg  -- the shanty v1 (red tile roof) and v2 (corrugated lean-to), with
               the house and the concrete/wall warm pass before/after beside.
"""
import colorsys
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

before, after, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
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
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in rgb[::3]])
    lum = (0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2])
    ang = hsv[:, 0] * 2 * np.pi
    hue = (np.degrees(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) + 360) % 360
    return lum.mean(), hsv[:, 1].mean(), hue


def tile(d, uid, tag):
    p = os.path.join(d, uid + ".png")
    h = LABEL + BIG + PAD + SMALL + LABEL
    t = Image.new("RGBA", (BIG, h), (236, 232, 224, 255))
    dr = ImageDraw.Draw(t)
    if not os.path.exists(p):
        dr.text((4, 2), f"{uid} ({tag}) -- no still", fill=(120, 20, 20), font=FONT)
        return t, None
    img = Image.open(p).convert("RGBA")
    small = img.resize((SMALL, SMALL), Image.LANCZOS)
    L, S, H = stats(img)
    dr.text((4, 2), f"{uid}  ({tag})", fill=(20, 20, 20), font=FONT)
    t.alpha_composite(img, (0, LABEL))
    y = LABEL + BIG + PAD
    t.alpha_composite(small, (0, y))
    dr.text((SMALL + PAD, y + 4), "64 px (gameplay zoom)", fill=(60, 60, 60), font=FONT_S)
    dr.text((SMALL + PAD, y + 24), f"mean L {L:.3f}  sat {S:.3f}  hue {H:.0f} deg", fill=(60, 60, 60), font=FONT_S)
    print(f"{tag:6s} {uid:14s} L={L:.3f} S={S:.3f} hue={H:5.1f}")
    return t, (L, S, H)


def sheet(name, ids, title):
    rows = [[tile(before, u, "before")[0] for u in ids], [tile(after, u, "after")[0] for u in ids]]
    th = rows[0][0].height
    W = len(ids) * (BIG + PAD) + PAD
    H = 2 * (th + PAD) + PAD + 28
    s = Image.new("RGBA", (W, H), (250, 248, 244, 255))
    ImageDraw.Draw(s).text((PAD, 6), title, fill=(20, 20, 20), font=FONT)
    for r, row in enumerate(rows):
        for i, t in enumerate(row):
            s.alpha_composite(t, (PAD + i * (BIG + PAD), 28 + PAD + r * (th + PAD)))
    s.convert("RGB").save(os.path.join(out, name), quality=88)
    print("wrote", os.path.join(out, name), s.size)


sheet("fleet.jpg", ["apc_eitan", "apc_kipod", "dozer_d9", "scout_shachaf", "ifv_namer", "mbt_lavi", "jeep_shoded"],
      "A3.2 phase 2 -- the KDF fleet: origin/main (top) against this branch (bottom). Shipped GLBs with their own bake, "
      "kit hidden, dimetric camera, sun az 135 / alt 55, Eevee. 2026-10-11")
sheet("shanty.jpg", ["shanty", "house", "concrete", "wall"],
      "A3.2 phase 2 -- the shanty v2 (Meshy, max detail) and the concrete / wall warm pass: origin/main (top) against "
      "this branch (bottom); the house is the unchanged reference. Same capture conditions. 2026-10-11")
