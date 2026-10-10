"""Measure and sheet the kitted-vehicle blockout (`kit_blockout.py`).

    python3 tools/vehicles/kit_blockout_measure.py --run <blockout out dir> \
        [--neighbours <out dir of a base-only run>] --sheets <dir> [--json <path>]

Reads the masks and renders `kit_blockout.py` wrote and prints, per vehicle:

  * per variant (each track at tiers 1-3 alone, and the even levels L1-L3)
    and per camera zoom (1.0, 2.5), the silhouette pixels the kit ADDS over
    the base vehicle -- mean and minimum over eight headings -- and how many
    of them are SOLID: they survive a 3x3 morphological opening, so they
    belong to a blob at least 3 px thick. A whip antenna or a slat bar adds
    pixels that a 1-2 px line cannot make read; the solid count is the part
    of the change a player can actually see as a shape.
  * the growth of the whole silhouette in percent, the same way.
  * the kit surface a player SEES (the `coverage/` pass: base drawn black,
    kit white, so a part counts wherever it is the front-most surface, inside
    the outline as well as outside it), and its solid share. A plate on a
    glacis changes no silhouette pixel at all; this is the number that says
    whether it shows.
  * the mesh gate's own IoU (`validate_assets.silhouette` + `iou`, 64 px
    masks from 256 px renders framed to each variant's own bounds) of every
    variant against every shipped vehicle's base, so a kit that makes one
    unit read as another is caught at design time.

And writes the mock sheet PNGs to --sheets, at 1:1 game pixels.
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
import validate_assets as va  # noqa: E402

ZOOMS = ("1.0", "2.5")
HEADINGS = (0, 45, 90, 135, 180, 225, 270, 315)
SAND = (196, 180, 150, 255)   # a plate-like ground; the sheet is a mock, not a capture
INK = (40, 36, 30, 255)
VEHICLES = ["mbt_lavi", "ifv_namer", "apc_eitan", "apc_kipod",
            "jeep_shoded", "scout_shachaf", "dozer_d9", "heli_peten"]
NAMES = {"mbt_lavi": "Lavi MBT", "ifv_namer": "Namer IFV", "apc_eitan": "Eitan APC",
         "apc_kipod": "Kipod Screen Carrier", "jeep_shoded": "Shoded Jeep",
         "scout_shachaf": "Shachaf Scout Car", "dozer_d9": "D9 Dov", "heli_peten": "AH-64 Peten"}


def mask(path):
    return np.array(Image.open(path).convert("RGBA"))[..., 3] > 127


def erode(m):
    out = m.copy()
    out[1:, :] &= m[:-1, :]
    out[:-1, :] &= m[1:, :]
    out[:, 1:] &= m[:, :-1]
    out[:, :-1] &= m[:, 1:]
    out[1:, 1:] &= m[:-1, :-1]
    out[:-1, :-1] &= m[1:, 1:]
    out[1:, :-1] &= m[:-1, 1:]
    out[:-1, 1:] &= m[1:, :-1]
    return out


def dilate(m):
    out = m.copy()
    out[1:, :] |= m[:-1, :]
    out[:-1, :] |= m[1:, :]
    out[:, 1:] |= m[:, :-1]
    out[:, :-1] |= m[:, 1:]
    out[1:, 1:] |= m[:-1, :-1]
    out[:-1, :-1] |= m[1:, 1:]
    out[1:, :-1] |= m[:-1, 1:]
    out[:-1, 1:] |= m[1:, :-1]
    return out


def measure_vehicle(run, vid):
    rows = {}
    for z in ZOOMS:
        d = os.path.join(run, "masks", vid, f"z{z}")
        variants = sorted({os.path.basename(p).split("_h")[0] for p in glob.glob(os.path.join(d, "*.png"))})
        base = {h: mask(os.path.join(d, f"L0_h{h:03d}.png")) for h in HEADINGS}
        for v in variants:
            if v == "L0":
                continue
            added, solid, growth, height = [], [], [], []
            for h in HEADINGS:
                m = mask(os.path.join(d, f"{v}_h{h:03d}.png"))
                add = m & ~base[h]
                added.append(int(add.sum()))
                solid.append(int((dilate(erode(add)) & add).sum()))
                growth.append(100.0 * (m.sum() - base[h].sum()) / max(base[h].sum(), 1))
                ys = np.where(m.any(axis=1))[0]
                yb = np.where(base[h].any(axis=1))[0]
                height.append(int((ys[-1] - ys[0]) - (yb[-1] - yb[0])))
            vis, vis_solid = [], []
            cdir = os.path.join(run, "coverage", vid, f"z{z}")
            for h in HEADINGS:
                cp = os.path.join(cdir, f"{v}_h{h:03d}.png")
                if not os.path.exists(cp):
                    continue
                a = np.array(Image.open(cp).convert("RGBA"))
                cov = (a[..., 0] > 127) & (a[..., 3] > 127)
                vis.append(int(cov.sum()))
                vis_solid.append(int((dilate(erode(cov)) & cov).sum()))
            rows.setdefault(v, {})[z] = {
                "kit_visible_mean": round(float(np.mean(vis)), 1) if vis else None,
                "kit_visible_solid_mean": round(float(np.mean(vis_solid)), 1) if vis else None,
                "added_mean": round(float(np.mean(added)), 1), "added_min": int(min(added)),
                "solid_mean": round(float(np.mean(solid)), 1), "solid_min": int(min(solid)),
                "growth_pct_mean": round(float(np.mean(growth)), 1),
                "height_px_max": int(max(height)),
                "base_px_mean": round(float(np.mean([base[h].sum() for h in HEADINGS])), 1),
            }
    return rows


def gate_iou(run, neighbours_runs, vid):
    """IoU of each variant against every shipped vehicle base, the gate's way."""
    bases = {}
    for r in [run] + neighbours_runs:
        for p in glob.glob(os.path.join(r, "gate", "*", "L0.png")):
            bases[p.split(os.sep)[-2]] = va.silhouette(p)
    out = {}
    own = bases.get(vid)
    for p in sorted(glob.glob(os.path.join(run, "gate", vid, "*.png"))):
        v = os.path.splitext(os.path.basename(p))[0]
        s = va.silhouette(p)
        others = [(round(va.iou(s, b), 3), u) for u, b in bases.items() if u != vid]
        others.sort(reverse=True)
        out[v] = {"own_base": round(va.iou(s, own), 3) if own is not None else None,
                  "nearest": others[0][1], "nearest_iou": others[0][0],
                  "top3": others[:3]}
    return out


def font(size):
    for p in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def union_bbox(paths):
    box = None
    for p in paths:
        b = Image.open(p).getbbox()
        if b is None:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def vehicle_sheet(run, vid, out_dir):
    """Columns L0-L3; rows: zoom 1.0 and 2.5, each at both headings. 1:1 px."""
    d = os.path.join(run, "mock", vid)
    f_t, f_s = font(22), font(15)
    blocks = []
    for z in ZOOMS:
        for h in (240, 60):
            paths = [os.path.join(d, f"z{z}_L{L}_h{h:03d}.png") for L in range(4)]
            bb = union_bbox(paths)
            pad = 6
            tiles = [Image.open(p).crop((bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad)) for p in paths]
            blocks.append((z, h, tiles))
    col_w = max(t.size[0] for _z, _h, ts in blocks for t in ts) + 24
    label_w = 150
    head_h = 70
    heights = [max(t.size[1] for t in ts) + 16 for _z, _h, ts in blocks]
    title = f"{NAMES[vid]} ({vid}) -- kit level 0 / 1 / 2 / 3, every track at tier L. Kit parts in steel."
    foot = ("Blender blockout (boxes and bars at proposed size and place), Cycles, the game's sun "
            "(az 135, alt 55), dimetric camera az 225 / el 30, 15.085 px/m at zoom 1.0, 37.712 at 2.5.")
    W = max(label_w + col_w * 4, int(f_t.getlength(title)) + 30, int(font(13).getlength(foot)) + 30)
    H = head_h + sum(heights) + 30
    sheet = Image.new("RGBA", (W, H), SAND)
    dr = ImageDraw.Draw(sheet)
    dr.text((12, 10), title, fill=INK, font=f_t)
    for L in range(4):
        dr.text((label_w + col_w * L + 8, 44), f"L{L}" + (" (shipped)" if L == 0 else ""), fill=INK, font=f_s)
    y = head_h
    for (z, h, tiles), rh in zip(blocks, heights):
        dr.text((10, y + 6), f"zoom {z}\nheading {h}\n1:1 px", fill=INK, font=f_s)
        for L, t in enumerate(tiles):
            x = label_w + col_w * L + (col_w - t.size[0]) // 2
            sheet.alpha_composite(t, (x, y + (rh - t.size[1]) // 2))
        y += rh
    dr.text((10, H - 24), foot, fill=INK, font=font(13))
    p = os.path.join(out_dir, f"{vid}.png")
    sheet.convert("RGB").save(p, optimize=True)
    return p


def overview_sheet(run, out_dir, zoom="1.0", heading=240, name="overview-zoom1.png"):
    f_t, f_s = font(22), font(15)
    rows = []
    for vid in VEHICLES:
        paths = [os.path.join(run, "mock", vid, f"z{zoom}_L{L}_h{heading:03d}.png") for L in range(4)]
        bb = union_bbox(paths)
        rows.append((vid, [Image.open(p).crop((bb[0] - 4, bb[1] - 4, bb[2] + 4, bb[3] + 4)) for p in paths]))
    col_w = max(t.size[0] for _v, ts in rows for t in ts) + 30
    label_w = 210
    rh = [max(t.size[1] for t in ts) + 14 for _v, ts in rows]
    title = f"All eight at camera zoom {zoom}, heading {heading}, 1:1 game pixels -- L0 / L1 / L2 / L3"
    W, H = max(label_w + col_w * 4, int(f_t.getlength(title)) + 30), 64 + sum(rh) + 10
    sheet = Image.new("RGBA", (W, H), SAND)
    dr = ImageDraw.Draw(sheet)
    dr.text((12, 8), title, fill=INK, font=f_t)
    y = 52
    for (vid, tiles), h in zip(rows, rh):
        dr.text((10, y + h // 2 - 9), NAMES[vid], fill=INK, font=f_s)
        for L, t in enumerate(tiles):
            sheet.alpha_composite(t, (label_w + col_w * L + (col_w - t.size[0]) // 2, y + (h - t.size[1]) // 2))
        y += h
    p = os.path.join(out_dir, name)
    sheet.convert("RGB").save(p, optimize=True)
    return p


def legend_sheet(run, out_dir):
    f_t, f_s = font(22), font(16)
    tiles = []
    for vid in VEHICLES:
        for h in (240, 60):
            im = Image.open(os.path.join(run, "mock", vid, f"legend_h{h:03d}.png"))
            tiles.append((vid, h, im.crop(im.getbbox())))
    cw = max(t.size[0] for *_x, t in tiles) + 20
    ch = max(t.size[1] for *_x, t in tiles) + 40
    W, H = max(cw * 4, 1500), ch * 4 + 60
    sheet = Image.new("RGBA", (W, H), SAND)
    dr = ImageDraw.Draw(sheet)
    dr.text((12, 10), "Kit level 3 by TRACK (mock colours only): armour steel, sensors teal, firepower red. "
            "2x the zoom-2.5 scale.", fill=INK, font=f_t)
    for i, (vid, h, t) in enumerate(tiles):
        x, y = (i % 4) * cw, 50 + (i // 4) * ch
        dr.text((x + 8, y + 4), f"{NAMES[vid]}, heading {h}", fill=INK, font=f_s)
        sheet.alpha_composite(t, (x + (cw - t.size[0]) // 2, y + 28 + (ch - 40 - t.size[1]) // 2))
    p = os.path.join(out_dir, "legend-by-track.png")
    sheet.convert("RGB").save(p, optimize=True)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--neighbours", action="append", default=[])
    ap.add_argument("--sheets", required=True)
    ap.add_argument("--json")
    a = ap.parse_args()
    os.makedirs(a.sheets, exist_ok=True)
    result = {}
    for vid in VEHICLES:
        if not os.path.isdir(os.path.join(a.run, "masks", vid)):
            continue
        result[vid] = {"px": measure_vehicle(a.run, vid), "gate": gate_iou(a.run, a.neighbours, vid)}
        print(f"== {vid}")
        for v, zs in result[vid]["px"].items():
            z1, z25 = zs["1.0"], zs["2.5"]
            g = result[vid]["gate"].get(v, {})
            print(f"  {v:3s}  seen z1 {z1['kit_visible_mean']} ({z1['kit_visible_solid_mean']}) z2.5 {z25['kit_visible_mean']} "
                  f"({z25['kit_visible_solid_mean']}) | outline z1 +{z1['added_mean']:7.1f} px (solid {z1['solid_mean']:6.1f}, min {z1['added_min']:5d}) "
                  f"{z1['growth_pct_mean']:+5.1f}%  |  z2.5 +{z25['added_mean']:7.1f} (solid {z25['solid_mean']:7.1f}) "
                  f"{z25['growth_pct_mean']:+5.1f}%  | IoU own {g.get('own_base')} nearest {g.get('nearest')} "
                  f"{g.get('nearest_iou')}")
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(result, fh, indent=1)
    # Sheets need the mock pass; a numbers-only run (--skip-mock) has none.
    mocked = [v for v in result if os.path.isdir(os.path.join(a.run, "mock", v))]
    for vid in mocked:
        vehicle_sheet(a.run, vid, a.sheets)
    if len(mocked) == len(VEHICLES):  # the side-by-side sheets need all eight
        overview_sheet(a.run, a.sheets)
        overview_sheet(a.run, a.sheets, zoom="2.5", name="overview-zoom2.5.png")
        legend_sheet(a.run, a.sheets)


if __name__ == "__main__":
    main()
