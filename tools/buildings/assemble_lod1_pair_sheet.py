"""Assemble the full-vs-LOD1 approval sheet and IoU table for the house or the ditch (GH-974).

    python3 -I tools/buildings/assemble_lod1_pair_sheet.py house|ditch <pieces dir> <sheet.png> [<iou.json>]

`<pieces dir>` is what tools/buildings/render_lod1_pair.py wrote.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

kind, pieces, out = sys.argv[1:4]
iou_out = sys.argv[4] if len(sys.argv) > 4 else None
BG, INK = (205, 205, 198), (30, 30, 28)
tris = json.load(open(os.path.join(pieces, "tris.json")))
lays = sorted({f.split("_")[2] if f.split("_")[2] not in ("seg",) else "seg" for f in []}) or None
lays = {"house": ["one", "pair"], "ditch": ["seg", "seg_ns", "run", "bend"]}[kind]
name = {"house": "house", "ditch": "ditch_0"}[kind]


def font(n):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, n)
    return ImageFont.load_default()


F, FS, FB = font(15), font(12), font(20)
load = lambda n: Image.open(os.path.join(pieces, n)).convert("RGBA")  # noqa: E731
mask = lambda n: np.array(load(n))[:, :, 3] >= 128  # noqa: E731
iou = lambda a, b: float(np.logical_and(a, b).sum() / max(1, np.logical_or(a, b).sum()))  # noqa: E731
ious = {f"{t}:{l}": iou(mask(f"sil_{t}_{l}_full.png"), mask(f"sil_{t}_{l}_lod1.png"))
        for l in lays for t in ("f64", "z1", "z1.6", "mag")}
if iou_out:
    json.dump(ious, open(iou_out, "w"), indent=1)

W, H = 2300, 9000
sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)
y = 14
T = lambda x, yy, s, f=F: d.text((x, yy), s, font=f, fill=INK)  # noqa: E731


def paste(img, x, yy):
    sheet.paste(img.convert("RGB"), (x, yy), img)


T(14, y, f"{name} vs {kind}_lod1 - GH-974 close-up approval sheet | authored in Blender by code, 0 Meshy credits", FB)
y += 28
T(14, y, f"triangles: full {tris['full']:,}  |  lod1 {tris['lod1']:,} ({tris['lod1'] / tris['full'] * 100:.1f}%).  Both drawn with the FULL mesh's own bake "
  "(the twin's UV0 samples it), Workbench studio light, not the in-game toon ramp.", FS)
y += 16
T(14, y, "Camera: the game's, 30 deg dimetric, 64 px tile diamond at zoom 1 (15.085 px/m x zoom). Left/top = full, right/bottom = twin.", FS)
y += 28
T(14, y, "A. TRUE IN-GAME SIZE (1 sheet px = 1 screen px). Full above, twin below.", F)
y += 24
for tag in ("z1", "z1.6"):
    T(14, y, f"zoom {tag[1:]}", FB)
    y += 26
    x, rh = 14, 0
    for l in lays:
        a, b = load(f"col_{tag}_{l}_full.png"), load(f"col_{tag}_{l}_lod1.png")
        paste(a, x, y)
        paste(b, x, y + a.height + 8)
        T(x, y + a.height + 8 + b.height + 1, f"{l}: full / twin", FS)
        x += a.width + 30
        rh = max(rh, a.height + b.height + 30)
    y += rh + 10
T(14, y, "B. CLOSE-UP, 4x the zoom-1 scale: full left, twin right.", F)
y += 24
for l in lays:
    a, b = load(f"col_mag_{l}_full.png"), load(f"col_mag_{l}_lod1.png")
    sc = 2 if kind == "ditch" else 1
    a, b = a.resize((a.width * sc, a.height * sc)), b.resize((b.width * sc, b.height * sc))
    paste(a, 14, y)
    paste(b, 14 + a.width + 20, y)
    T(14, y + a.height + 1, f"{l}: full ({tris['full']:,} tris)    twin ({tris['lod1']:,} tris)", FS)
    y += a.height + 22
T(14, y, "C. 64 PX GATE FRAME (whole subject fitted into 64 px) and PURE-BLACK SILHOUETTE; row 2 = x4 nearest. Overlay: black both, red only full, blue only twin.", F)
y += 24
for l in lays:
    a, b = mask(f"sil_f64_{l}_full.png"), mask(f"sil_f64_{l}_lod1.png")
    ov = np.full((64, 64, 3), BG, dtype=np.uint8)
    ov[a & ~b], ov[b & ~a], ov[a & b] = (200, 40, 40), (40, 70, 200), (20, 20, 20)
    cells = []
    for nm, pre, m in (("colour full", "col", "full"), ("colour twin", "col", "lod1"), ("silhouette full", "sil", "full"), ("silhouette twin", "sil", "lod1")):
        fl = Image.new("RGBA", (64, 64), BG + (255,))
        fl.alpha_composite(load(f"{pre}_f64_{l}_{m}.png"))
        cells.append((nm, fl.convert("RGB")))
    cells.append(("overlay", Image.fromarray(ov)))
    T(14, y, f"{l}   IoU at 64 px = {ious['f64:' + l]:.4f}", F)
    y += 20
    x = 14
    for nm, im in cells:
        sheet.paste(im, (x, y))
        sheet.paste(im.resize((256, 256), Image.NEAREST), (x, y + 72))
        T(x, y + 72 + 258, nm, FS)
        x += 276
    y += 72 + 280
T(14, y, "D. SILHOUETTE IoU, full vs twin (pure black, same camera and frame, alpha >= 128):", F)
y += 24
for l in lays:
    T(30, y, f"{l:<8s} 64 px frame {ious['f64:' + l]:.4f}   zoom 1 {ious['z1:' + l]:.4f}   zoom 1.6 {ious['z1.6:' + l]:.4f}   4x {ious['mag:' + l]:.4f}", F)
    y += 19
T(14, y + 6, "Gate reference for DISTINCT units is < 0.88; a twin is the same mesh, so higher is the goal.", FS)
y += 30
sheet.crop((0, 0, W, y)).save(out)
print(out, json.dumps({k: round(v, 4) for k, v in ious.items()}))
