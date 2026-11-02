"""Look uplift L1 (GH-943): the side-by-side mock sheet.

    python3 tools/look_l1_sheet.py <dir holding the stills> [--map=beit_sahwan_outskirts]

Reads `<map>_<preset>_<subject>_z<zoom>_<arm>.png` written by
`tools/src/perf/look-l1-captures.ts` (arms: off, on, start) and writes
`sheet_<preset>.png` per preset and `sheet.png` (all three presets, smaller).
Columns: today (flag off) | L1 on, hemisphere census-solved | L1 on, the
lead's approved starting hemisphere (0.5 / 0.6 / 0.47). Rows: vehicle group,
infantry, buildings, each at zoom 1 and 2.5. Pure layout: no colour is
changed, so what is on the sheet is what the renderer drew.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

src = Path(sys.argv[1])
map_id = next((a.split("=", 1)[1] for a in sys.argv[2:] if a.startswith("--map=")), "beit_sahwan_outskirts")
PRESETS = ["dawn", "day", "dusk"]
SUBJECTS = [("vehicles", "vehicle group"), ("infantry", "infantry"), ("buildings", "buildings")]
ZOOMS = ["1", "2.5"]
ARMS = [("off", "TODAY (flag off)"), ("on", "L1 ON, hemisphere census-solved"), ("start", "L1 ON, approved start hemisphere")]


def font(size: int) -> ImageFont.ImageFont:
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf", "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def preset_sheet(preset: str, thumb_w: int) -> Image.Image:
    first = Image.open(src / f"{map_id}_{preset}_vehicles_z1_off.png")
    thumb_h = round(first.height * thumb_w / first.width)
    pad, head, side = 8, 56, 150
    w = side + len(ARMS) * (thumb_w + pad) + pad
    h = head + len(SUBJECTS) * len(ZOOMS) * (thumb_h + pad) + pad + 30
    sheet = Image.new("RGB", (w, h), (24, 24, 22))
    d = ImageDraw.Draw(sheet)
    f, fs = font(18), font(15)
    d.text((pad, 8), f"{map_id} / {preset}", fill=(235, 230, 215), font=f)
    for c, (_, label) in enumerate(ARMS):
        d.text((side + c * (thumb_w + pad) + pad, 32), label, fill=(235, 230, 215), font=fs)
    r = 0
    for sid, slabel in SUBJECTS:
        for z in ZOOMS:
            y = head + r * (thumb_h + pad) + pad
            d.text((pad, y + 6), f"{slabel}", fill=(235, 230, 215), font=fs)
            d.text((pad, y + 28), f"zoom {z}", fill=(190, 185, 170), font=fs)
            for c, (arm, _) in enumerate(ARMS):
                im = Image.open(src / f"{map_id}_{preset}_{sid}_z{z}_{arm}.png").convert("RGB")
                sheet.paste(im.resize((thumb_w, thumb_h), Image.LANCZOS), (side + c * (thumb_w + pad) + pad, y))
            r += 1
    d.text((pad, h - 24), "ANGLE/Metal, 1400x900 @2x, tick 200, frame loop frozen, same camera per row; arms differ by the flag (and hemisphere) alone", fill=(150, 145, 130), font=fs)
    return sheet


sheets = []
for p in PRESETS:
    s = preset_sheet(p, 760)
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
