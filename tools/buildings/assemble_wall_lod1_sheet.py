"""Assemble the wall vs wall_lod1 approval sheet and its IoU table (GH-974).

    python3 -I tools/buildings/assemble_wall_lod1_sheet.py <pieces dir> <sheet.png> [<iou.json>]

`<pieces dir>` is what tools/buildings/render_wall_lod1_pieces.py wrote. IoU is
over the alpha>=128 mask of the black silhouette renders, same camera, same
frame for both models.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

pieces, out = sys.argv[1], sys.argv[2]
iou_out = sys.argv[3] if len(sys.argv) > 3 else None
BG = (205, 205, 198)
INK = (30, 30, 28)
tris = json.load(open(os.path.join(pieces, "tris.json")))


def font(size):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


F, FS, FB = font(15), font(12), font(22)


def load(name):
    return Image.open(os.path.join(pieces, name)).convert("RGBA")


def mask(name):
    return np.array(load(name))[:, :, 3] >= 128


def iou(a, b):
    u = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / u) if u else 1.0


ious = {}
for tag, layouts in (("s64", ("tile", "tile_ns")), ("sil_z1", ("run", "corner", "tee")),
                     ("sil_z1.6", ("run", "corner", "tee")), ("sil_mag", ("run", "corner", "tee"))):
    for lay in layouts:
        stem = f"{tag}_{lay}" if tag == "s64" else f"{tag}_{lay}"
        ious[f"{tag}:{lay}"] = iou(mask(f"{stem}_full.png"), mask(f"{stem}_lod1.png"))
if iou_out:
    json.dump(ious, open(iou_out, "w"), indent=1)

W = 1380
H = 5400
sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)
y = 14


def text(x, yy, s, f=F, fill=INK):
    d.text((x, yy), s, font=f, fill=fill)


def paste(img, x, yy):
    sheet.paste(img.convert("RGB"), (x, yy), img)


text(14, y, "wall vs wall_lod1  -  GH-974 close-up approval sheet  |  authored in Blender by code, no Meshy credits", FB)
y += 30
text(14, y, f"triangles: wall (full) {tris['full']:,}   |   wall_lod1 {tris['lod1']:,}   ({tris['lod1'] / tris['full'] * 100:.1f}% of the full wall; hard ceiling 350)", F)
y += 20
text(14, y, "Deliberate simplification to a measured budget, not a replacement: walls were about 2.3 ms of the Rujm redo's centre frame; the standing art keeps wall.glb, "
     "LOD1 swaps in below zoom 2.0.", FS)
y += 16
text(14, y, "Same outline, footprint 3.0 x 0.6 m, height 1.40 m, coping line, role split roof/wall, zero materials. Loses: stone-by-stone relief and the protruding quoins at the tile ends. "
     "Flat palette role colour (wall limestone.5, coping limestone.3), not the in-game toon ramp.", FS)
y += 16
text(14, y, "Camera: the game's, 30 deg dimetric, tile diamond 64 px at zoom 1 (px per metre = 15.085 x zoom). Map +x runs right-down; a north-south tile turns a quarter, as units/run-direction.ts does it.", FS)
y += 30

# ---- A: true in-game size ----
text(14, y, "A.  TRUE IN-GAME PIXEL SIZE (1 sheet px = 1 screen px).  For each layout: the full wall above, wall_lod1 below.  "
     "Zoom 2.5 draws the full wall only in game; LOD1 shown for reference.", F)
y += 26
for zoom in ("1.0", "1.6", "2.5"):
    text(14, y, f"zoom {zoom}", FB)
    y += 28
    x = 14
    row_h = 0
    for lay in ("run", "corner", "tee"):
        a, b = load(f"z{zoom}_{lay}_full.png"), load(f"z{zoom}_{lay}_lod1.png")
        paste(a, x, y)
        paste(b, x, y + a.height + 18)
        text(x, y + a.height + 1, f"{lay} - full" if lay != "run" else "run of 4 - full", FS)
        text(x, y + a.height + 18 + b.height + 1, "wall_lod1" + ("  (reference, not used at 2.5)" if zoom == "2.5" else ""), FS)
        x += max(a.width, b.width) + 40
        row_h = max(row_h, a.height + b.height + 50)
    y += row_h + 14

# ---- B: magnified ----
y += 6
text(14, y, "B.  CLOSE-UP, 4x the zoom-1 scale (about zoom 4): the same layouts, full left, wall_lod1 right.", F)
y += 26
for lay in ("run", "corner", "tee"):
    a, b = load(f"mag_{lay}_full.png"), load(f"mag_{lay}_lod1.png")
    paste(a, 14, y)
    paste(b, 14 + a.width + 20, y)
    text(14, y + a.height + 1, f"{lay} - full ({tris['full']:,} tris / tile)", FS)
    text(14 + a.width + 20, y + a.height + 1, f"{lay} - wall_lod1 ({tris['lod1']} tris / tile)", FS)
    y += a.height + 24

# ---- C: 64 px frames and silhouettes ----
y += 6
text(14, y, "C.  64 PX GAMEPLAY FRAME (one tile at zoom 1, its true size on screen) AND PURE-BLACK SILHOUETTES.  Top row native 64 px, bottom row the same frames at x4 (nearest).", F)
y += 26
S = 4
for lay, label in (("tile", "tile, east-west facing"), ("tile_ns", "tile, north-south (quarter turn)")):
    text(14, y, label, F)
    y += 22
    a, b = mask(f"s64_{lay}_full.png"), mask(f"s64_{lay}_lod1.png")
    ov = np.full((64, 64, 3), BG, dtype=np.uint8)
    ov[a & ~b] = (200, 40, 40)
    ov[b & ~a] = (40, 70, 200)
    ov[a & b] = (20, 20, 20)
    cells = []
    for nm, kind, model in (("colour, full", "f64", "full"), ("colour, wall_lod1", "f64", "lod1"),
                            ("silhouette, full", "s64", "full"), ("silhouette, wall_lod1", "s64", "lod1")):
        flat = Image.new("RGBA", (64, 64), BG + (255,))
        flat.alpha_composite(load(f"{kind}_{lay}_{model}.png"))
        cells.append((nm, flat.convert("RGB")))
    cells.append(("overlay: black both, red only full, blue only LOD1", Image.fromarray(ov)))
    x = 14
    for nm, img in cells:
        sheet.paste(img, (x, y))
        sheet.paste(img.resize((64 * S, 64 * S), Image.NEAREST), (x, y + 64 + 12))
        text(x, y + 64 + 12 + 64 * S + 2, nm, FS)
        x += 64 * S + 16
    y += 64 + 12 + 64 * S + 22
    text(14, y, f"silhouette IoU at 64 px = {ious['s64:' + lay]:.4f}", FB)
    y += 36

# ---- D: IoU table ----
text(14, y, "D.  SILHOUETTE IoU, full vs wall_lod1 (pure black, same camera, alpha >= 128):", F)
y += 24
rows = [("one tile, 64 px frame, east-west", "s64:tile"), ("one tile, 64 px frame, north-south", "s64:tile_ns"),
        ("run of 4, zoom 1", "sil_z1:run"), ("corner, zoom 1", "sil_z1:corner"), ("T junction, zoom 1", "sil_z1:tee"),
        ("run of 4, zoom 1.6", "sil_z1.6:run"), ("corner, zoom 1.6", "sil_z1.6:corner"), ("T junction, zoom 1.6", "sil_z1.6:tee"),
        ("run of 4, 4x", "sil_mag:run"), ("corner, 4x", "sil_mag:corner"), ("T junction, 4x", "sil_mag:tee")]
for label, key in rows:
    text(30, y, f"{label:<40s}  {ious[key]:.4f}", F)
    y += 19
text(14, y + 6, "IoU gate reference for distinct units is < 0.88; this is the same unit, so higher is the goal.", FS)
y += 30
sheet.crop((0, 0, W, y)).save(out)
print("sheet", out, "height", y)
print(json.dumps(ious, indent=1))
