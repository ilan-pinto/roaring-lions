"""Look uplift L2 (GH-943): the side-by-side mock sheet for the colour grade.

    python3 tools/look_l2_sheet.py <dir holding the stills> [--map=beit_sahwan_outskirts]

Reads `<map>_<preset>_<subject>_z<zoom>_<column>.png` written by
`tools/src/perf/look-l2-captures.ts` (columns: identity, s0.5, s1, s1.5) and writes
`sheet_<preset>.png` per preset (dawn, dusk) and `sheet.png` (both, smaller).
Columns: IDENTITY (today) | grade at 0.5 | at 1.0 (as authored) | at 1.5. Rows: vehicle group,
infantry, buildings, each at zoom 1 and 2.5. Pure layout: no colour is changed, so what is on
the sheet is what the renderer drew.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

src = Path(sys.argv[1])
map_id = next((a.split("=", 1)[1] for a in sys.argv[2:] if a.startswith("--map=")), "beit_sahwan_outskirts")
PRESETS = ["dawn", "dusk"]
SUBJECTS = [("vehicles", "vehicle group"), ("infantry", "infantry"), ("buildings", "buildings")]
ZOOMS = ["1", "2.5"]
COLS = [("identity", "IDENTITY (today)"), ("s0.5", "{p} grade x0.5"), ("s1", "{p} grade x1.0 (as authored)"), ("s1.5", "{p} grade x1.5")]


def font(size: int) -> ImageFont.ImageFont:
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf", "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def preset_sheet(preset: str, thumb_w: int) -> Image.Image:
    first = Image.open(src / f"{map_id}_{preset}_vehicles_z1_identity.png")
    thumb_h = round(first.height * thumb_w / first.width)
    pad, head, side = 8, 56, 150
    w = side + len(COLS) * (thumb_w + pad) + pad
    h = head + len(SUBJECTS) * len(ZOOMS) * (thumb_h + pad) + pad + 30
    sheet = Image.new("RGB", (w, h), (24, 24, 22))
    d = ImageDraw.Draw(sheet)
    f, fs = font(18), font(15)
    d.text((pad, 8), f"{map_id} / {preset}", fill=(235, 230, 215), font=f)
    for c, (_, label) in enumerate(COLS):
        d.text((side + c * (thumb_w + pad) + pad, 32), label.format(p=preset), fill=(235, 230, 215), font=fs)
    r = 0
    for sid, slabel in SUBJECTS:
        for z in ZOOMS:
            y = head + r * (thumb_h + pad) + pad
            d.text((pad, y + 6), f"{slabel}", fill=(235, 230, 215), font=fs)
            d.text((pad, y + 28), f"zoom {z}", fill=(190, 185, 170), font=fs)
            for c, (col, _) in enumerate(COLS):
                im = Image.open(src / f"{map_id}_{preset}_{sid}_z{z}_{col}.png").convert("RGB")
                sheet.paste(im.resize((thumb_w, thumb_h), Image.LANCZOS), (side + c * (thumb_w + pad) + pad, y))
            r += 1
    d.text((pad, h - 24), "ANGLE/Metal (Apple M3 Pro), 1400x900 css @2x, sim tick 200, frame loop frozen, same camera per row; columns differ by setGrade alone", fill=(150, 145, 130), font=fs)
    return sheet


sheets = []
for p in PRESETS:
    s = preset_sheet(p, 620)
    s.save(src / f"sheet_{p}.png")
    sheets.append(s)
    print("wrote", src / f"sheet_{p}.png", s.size)
total = Image.new("RGB", (max(s.width for s in sheets), sum(s.height for s in sheets)), (24, 24, 22))
y = 0
for s in sheets:
    total.paste(s, (0, y))
    y += s.height
total = total.resize((total.width * 2 // 3, total.height * 2 // 3), Image.LANCZOS)
total.save(src / "sheet.png")
print("wrote", src / "sheet.png", total.size)
