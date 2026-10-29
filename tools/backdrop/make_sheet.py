"""Contact sheets for the kit's approval render (system python with PIL, not Blender).

    python3 tools/backdrop/make_sheet.py DIR      # DIR holds plates/ turntables/ mock/ work/stats.json

Writes DIR/sheet.png (plates + six mock views), sheet_wire.png, sheet_turntables.png,
sheet_mock.png. Captions carry the triangle counts from stats.json.
"""
import glob
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def font(size):
    for f in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def cell(im, w, h, text, fnt, sub=None):
    c = Image.new("RGB", (w, h + 44), (24, 24, 22))
    c.paste(im.resize((w, h), Image.LANCZOS), (0, 0))
    d = ImageDraw.Draw(c)
    d.text((8, h + 4), text, fill=(235, 230, 215), font=fnt)
    if sub:
        d.text((8, h + 24), sub, fill=(170, 165, 150), font=font(15))
    return c


def grid(cells, cols, w, h):
    rows = (len(cells) + cols - 1) // cols
    ch = cells[0].size[1]
    out = Image.new("RGB", (cols * w, rows * ch), (24, 24, 22))
    for i, c in enumerate(cells):
        out.paste(c, ((i % cols) * w, (i // cols) * ch))
    return out


def main():
    D = sys.argv[1]
    st = json.load(open(os.path.join(D, "work", "stats.json")))["pieces"]
    order = list(st.keys())
    f = font(22)

    def cap(n):
        s = st[n]
        if "cap" in s and n != "bd_olive":
            tt = s["texels_per_tile"]
            return n, "%d tris (cap %d)   LOD1 %d   %s tex/tile" % (s["tris_lod0"], s["cap"], s["tris_lod1"], ("%.0f-%.0f" % tuple(tt)) if tt[0] != tt[1] else "%.0f" % tt[0])
        return n, "%d tris (cap %d)" % (s["tris_lod0"], s["cap"])

    plates = [cell(Image.open(os.path.join(D, "plates", n + ".png")), 600, 375, *[cap(n)[0], ], sub=cap(n)[1], fnt=f) for n in order]
    top = grid(plates, 4, 600, 375)
    mock = []
    for n, t in (("z0.35-centre-day", "WH IV  zoom 0.35  day"), ("z0.35-centre-dusk", "WH IV  zoom 0.35  dusk"), ("z0.35-centre-day-floor-only", "zoom 0.35  floor only (no kit)"),
                 ("z1-west-day", "zoom 1  west rim"), ("z1-north-day", "zoom 1  north rim (head wall)"), ("z2.5-west-day", "zoom 2.5  west rim")):
        mock.append(cell(Image.open(os.path.join(D, "mock", n + ".png")), 800, 514, t, f))
    bottom = grid(mock, 3, 800, 514)
    sheet = Image.new("RGB", (2400, top.size[1] + bottom.size[1] + 60), (24, 24, 22))
    ImageDraw.Draw(sheet).text((8, 8), "Wadi Halam backdrop kit: second pass (render-2)", fill=(235, 230, 215), font=font(30))
    sheet.paste(top.resize((2400, int(top.size[1] * 2400 / top.size[0]))), (0, 50))
    sheet = sheet.crop((0, 0, 2400, 50 + top.size[1] + bottom.size[1]))
    sheet.paste(bottom, (0, 50 + top.size[1]))
    sheet.save(os.path.join(D, "sheet.png"))

    wires = [cell(Image.open(os.path.join(D, "plates", n + "_wire.png")), 600, 375, cap(n)[0], f, sub=cap(n)[1]) for n in order]
    grid(wires, 4, 600, 375).save(os.path.join(D, "sheet_wire.png"))

    rows = []
    for n in ("bd_wall_far_a", "bd_wall_far_b", "bd_wall_far_c", "bd_head_wall"):
        cs = [cell(Image.open(os.path.join(D, "turntables", "%s_r%03d.png" % (n, a))), 400, 250, "%s  %d deg" % (n, a), font(18)) for a in range(0, 360, 45)]
        rows.append(grid(cs, 8, 400, 250))
    tt = Image.new("RGB", (3200, sum(r.size[1] for r in rows)))
    y = 0
    for r in rows:
        tt.paste(r, (0, y))
        y += r.size[1]
    tt.save(os.path.join(D, "sheet_turntables.png"))

    allm = [cell(Image.open(p), 700, 450, os.path.basename(p)[:-4], font(20)) for p in sorted(glob.glob(os.path.join(D, "mock", "*.png")))]
    grid(allm, 4, 700, 450).save(os.path.join(D, "sheet_mock.png"))
    print("sheets written")


if __name__ == "__main__":
    main()
