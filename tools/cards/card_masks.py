#!/usr/bin/env python3
"""Store-card layouts, second stage (GH-746 SC1): plain python3 + numpy + PIL, no Blender.

    python3 tools/cards/card_masks.py <out dir>        # the dir `render_card_guide.py` wrote raw/ into

Reads `raw/*_rgba.png` and writes, next to it:

  <level>_layout.png          the card, 1536 x 1024: the sky composited behind the render, no alpha
  base_layout_4x3.png         the base layout at 1536 x 1152 for a model that only takes 4:3
  <track>_t<n>_mask.png       the difference mask of (base + that track at that tier) against the base:
                              pixels that differ by more than dE 2 (CIE76), dilated 4 px, feathered about 6 px.
                              It includes the parts' shadows, which is why it is a difference mask, not a part mask.
  figures.png                 the figure-id map of the card (0 background, bodies 30/70/110, hands +10/+20)
  zone_<track>.png            the union over tiers of where the track's parts project
  crops.json                  per track: the zone's bounding box padded to 3:2, in card pixels and fractions
  report.json                 hand numbers, hand visibility and clearance, safe-zone coverage, mask overlap
  layouts_sheet.png, masks_sheet.png   contact sheets for a human look

The numbers are the design's (N4, N7): `card_poses.py` holds them. Every check here is also a function with a
test (`tools/cards/test_card_masks.py`), each with an input that makes it fail.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import card_poses as cp  # noqa: E402

TRACKS = ("armour", "sensors", "firepower")
BODY_CODES = {"f0": 30, "f1": 70, "f2": 110}
PALETTE = os.path.join(os.path.dirname(os.path.dirname(HERE)), "data", "palette.json")


def tone(key):
    with open(PALETTE) as fh:
        ramp, idx = key.split(".")
        h = json.load(fh)["ramps"][ramp]["colors"][int(idx)].lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ------------------------------------------------------------------------------- images

def load_rgba(path):
    return np.array(Image.open(path).convert("RGBA"))


def card_rows(a):
    """The 3:2 card is the middle `CARD_H` rows of a 4:3 render."""
    off = (a.shape[0] - cp.CARD_H) // 2
    return a[off:off + cp.CARD_H]


def sky(h, w):
    """A flat vertical gradient, water.0 at the top to limestone.1 at the bottom: only the ground and the figures
    matter to the guide, the painter invents the backdrop (design 1.1)."""
    top = np.array(tone("water.0"), float)
    bot = np.array(tone("limestone.1"), float)
    t = np.linspace(0.0, 1.0, h)[:, None, None]
    return np.broadcast_to(top * (1 - t) + bot * t, (h, w, 3))


def composite(rgba):
    a = rgba[..., 3:4].astype(float) / 255.0
    bg = sky(rgba.shape[0], rgba.shape[1])
    return np.clip(rgba[..., :3] * a + bg * (1 - a), 0, 255).round().astype(np.uint8)


# ------------------------------------------------------------------------------- colour and masks

def srgb_to_lab(rgb):
    """sRGB uint8 (..., 3) -> CIE L*a*b* (D65), float64."""
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def delta_e76(a_rgb, b_rgb):
    return np.linalg.norm(srgb_to_lab(a_rgb) - srgb_to_lab(b_rgb), axis=-1)


def disc_offsets(r):
    return [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if dy * dy + dx * dx <= r * r]


def dilate(mask, r):
    """Binary dilation by a disc of radius `r` px (shifts and ORs; no scipy)."""
    h, w = mask.shape
    out = np.zeros_like(mask, dtype=bool)
    pad = np.pad(mask.astype(bool), r)
    for dy, dx in disc_offsets(r):
        out |= pad[r + dy:r + dy + h, r + dx:r + dx + w]
    return out


def box_blur(a, r):
    """Separable box blur of radius r over a float array, edges replicated."""
    k = 2 * r + 1
    p = np.pad(a, ((r, r), (0, 0)), mode="edge")
    c = np.cumsum(np.pad(p, ((1, 0), (0, 0))), axis=0)
    a = (c[k:] - c[:-k]) / k
    p = np.pad(a, ((0, 0), (r, r)), mode="edge")
    c = np.cumsum(np.pad(p, ((0, 0), (1, 0))), axis=1)
    return (c[:, k:] - c[:, :-k]) / k


def feather(mask, px):
    """Soft edge about `px` px wide: three box passes (a smooth bell), radius px/3 each."""
    a = mask.astype(float)
    r = max(1, int(round(px / 3.0)))
    for _ in range(3):
        a = box_blur(a, r)
    return a


def diff_mask(base_rgb, level_rgb, de=cp.DELTA_E, dilate_px=cp.DILATE_PX, feather_px=cp.FEATHER_PX):
    """(hard mask, soft mask). Hard: dE > `de`, dilated. Soft: the hard mask feathered, 0..1."""
    d = delta_e76(base_rgb, level_rgb) > de
    hard = dilate(d, dilate_px)
    return hard, feather(hard, feather_px)


def mask_overlap(masks, area):
    """Pairwise intersection of boolean masks as a fraction of `area`: {(a, b): fraction}."""
    names = list(masks)
    out = {}
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            out[(names[i], names[j])] = float((masks[names[i]] & masks[names[j]]).sum()) / area
    return out


def bbox_padded_32(mask, w=cp.CARD_W, h=cp.CARD_H, pad=0.08):
    """The mask's bounding box padded by `pad` of its larger side, then grown to 3:2 inside the card."""
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    bw, bh = (x1 - x0), (y1 - y0)
    side = max(bw, bh * 1.5) * (1.0 + 2.0 * pad)
    cw = min(side, w)
    ch = cw / 1.5
    x0 = int(round(min(max(cx - cw / 2.0, 0), w - cw)))
    y0 = int(round(min(max(cy - ch / 2.0, 0), h - ch)))
    return [x0, y0, int(round(cw)), int(round(ch))]


# ------------------------------------------------------------------------------- checks on the id map

def figure_mask(ids):
    """Any figure (body or hand) in a 3:2 id map."""
    return ids[..., 0] > 0


def safe_zone_coverage(fig_mask, zone):
    x0, y0, x1, y1 = cp.safe_zone_px(zone, fig_mask.shape[1], fig_mask.shape[0])
    sub = fig_mask[y0:y1, x0:x1]
    return float(sub.sum()) / float(sub.size)


def codes_of(ids_r, fig, kind):
    """Pixels of a figure's body (kind 'body'), firing hand ('L') or support hand ('R')."""
    base = BODY_CODES[fig]
    code = base + {"body": 0, "L": 10, "R": 20}[kind]
    return np.abs(ids_r.astype(int) - code) <= 2


def edge_pixels(mask):
    """The boundary of a boolean mask (pixels with a non-member 4-neighbour)."""
    p = np.pad(mask, 1)
    inner = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return mask & ~inner


def min_distance(a_mask, b_mask, stride=2):
    """Smallest distance in px between any pixel of `a_mask` and any pixel of `b_mask` (brute force over the
    boundary pixels, subsampled by `stride`). inf when either is empty."""
    A = np.argwhere(edge_pixels(a_mask))[::stride].astype(np.float32)
    B = np.argwhere(edge_pixels(b_mask))[::stride].astype(np.float32)
    if len(A) == 0 or len(B) == 0:
        return float("inf")
    best = float("inf")
    for i in range(0, len(A), 512):
        chunk = A[i:i + 512]
        d2 = ((chunk[:, None, :] - B[None, :, :]) ** 2).sum(axis=2)
        best = min(best, float(d2.min()))
    return best ** 0.5


def hand_report(ids_r, hands_r, figs=("f0", "f1", "f2")):
    """Per figure and hand: pixels seen, pixels it would show unoccluded, the visible fraction, and the clearance
    (px) from every OTHER figure's silhouette (body and hands)."""
    out = {}
    others_cache = {}
    for pf in figs:
        others = np.zeros(ids_r.shape, bool)
        for o in figs:
            if o == pf:
                continue
            for k in ("body", "L", "R"):
                others |= codes_of(ids_r, o, k)
        others_cache[pf] = others
    for pf in figs:
        out[pf] = {}
        for side in ("L", "R"):
            seen = codes_of(ids_r, pf, side)
            full = codes_of(hands_r, pf, side)
            n_seen, n_full = int(seen.sum()), int(full.sum())
            clr = min_distance(seen, others_cache[pf], stride=1) if n_seen else float("inf")
            out[pf][side] = dict(seen_px=n_seen, unoccluded_px=n_full,
                                 visible_frac=round(n_seen / n_full, 3) if n_full else 0.0,
                                 clearance_px=round(clr, 1), clearance_frac_of_width=round(clr / cp.CARD_W, 4))
    return out


# ------------------------------------------------------------------------------- sheets

def font(n):
    for p in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(p):
            return ImageFont.truetype(p, n)
    return ImageFont.load_default()


def sheet(tiles, labels, cols, tile_w, path):
    rows = (len(tiles) + cols - 1) // cols
    th = int(tile_w * cp.CARD_H / cp.CARD_W)
    pad, lab = 6, 22
    W = cols * (tile_w + pad) + pad
    H = rows * (th + lab + pad) + pad
    im = Image.new("RGB", (W, H), (28, 28, 26))
    dr = ImageDraw.Draw(im)
    f = font(14)
    for i, (t, l) in enumerate(zip(tiles, labels)):
        x = pad + (i % cols) * (tile_w + pad)
        y = pad + (i // cols) * (th + lab + pad)
        im.paste(Image.fromarray(t).resize((tile_w, th), Image.LANCZOS), (x, y + lab))
        dr.text((x + 2, y + 2), l, fill=(230, 230, 220), font=f)
    im.save(path)


def levels_all():
    out = ["base"]
    for t in TRACKS:
        for n in (1, 2, 3):
            out.append(f"{t}_t{n}")
    return out


def main(argv):
    out = os.path.abspath(argv[0])
    raw = os.path.join(out, "raw")
    with open(os.path.join(raw, "report_blender.json")) as fh:
        report = json.load(fh)
    levels = [l for l in levels_all() if os.path.exists(os.path.join(raw, f"{l}_rgba.png"))]

    card = {}
    for lvl in levels:
        full = load_rgba(os.path.join(raw, f"{lvl}_rgba.png"))
        card[lvl] = composite(card_rows(full))
        Image.fromarray(card[lvl]).save(os.path.join(out, f"{lvl}_layout.png"))
        if lvl == "base":
            Image.fromarray(composite(full)).save(os.path.join(out, "base_layout_4x3.png"))

    ids = card_rows(load_rgba(os.path.join(raw, "ids_rgba.png")))
    hands = card_rows(load_rgba(os.path.join(raw, "hands_rgba.png")))
    # an id pixel is meaningful only where the render is opaque; alpha 0 is background (code 0)
    ids_r = np.where(ids[..., 3] > 127, ids[..., 0], 0).astype(np.uint8)
    hands_r = np.where(hands[..., 3] > 127, hands[..., 0], 0).astype(np.uint8)
    Image.fromarray(ids_r).save(os.path.join(out, "figures.png"))

    rep = {"blender": report, "camera_card": report.get("camera")}
    fig_mask = ids_r > 0
    rep["safe_zones"] = {
        "kit_mark_top_left": round(safe_zone_coverage(fig_mask, cp.SAFE_KIT_MARK), 4),
        "maxed_stamp_bottom_right": round(safe_zone_coverage(fig_mask, cp.SAFE_MAXED_STAMP), 4),
        "limit": cp.SAFE_ZONE_FIGURE_MAX,
    }
    rep["hands_visibility"] = hand_report(ids_r, hands_r)
    rep["hand_clear_limit_px"] = round(cp.HAND_CLEAR_FRAC * cp.CARD_W, 1)

    masks, hard, raw_d = {}, {}, {}
    for lvl in levels:
        if lvl == "base":
            continue
        raw_d[lvl] = delta_e76(card["base"], card[lvl]) > cp.DELTA_E
        h, s = diff_mask(card["base"], card[lvl])
        hard[lvl] = h
        masks[lvl] = s
        Image.fromarray((s * 255).round().astype(np.uint8)).save(os.path.join(out, f"{lvl}_mask.png"))
    rep["mask_area_frac"] = {l: round(float(hard[l].sum()) / (cp.CARD_W * cp.CARD_H), 5) for l in hard}

    # tracks' union masks (over tiers), the overlap gate, the zones and crops
    union = {}
    for t in TRACKS:
        ms = [hard[f"{t}_t{n}"] for n in (1, 2, 3) if f"{t}_t{n}" in hard]
        if ms:
            union[t] = np.logical_or.reduce(ms)
    area = cp.CARD_W * cp.CARD_H
    ov = mask_overlap(union, area)
    rep["track_overlap"] = {f"{a}|{b}": round(v, 5) for (a, b), v in ov.items()}
    rep["track_overlap_limit"] = cp.OVERLAP_MAX
    # per-tier too: the layers that can be on screen together are one tier per track, so test every combination of tiers
    worst = 0.0
    for a_i in (1, 2, 3):
        for b_i in (1, 2, 3):
            for ta, tb in (("armour", "sensors"), ("armour", "firepower"), ("sensors", "firepower")):
                ka, kb = f"{ta}_t{a_i}", f"{tb}_t{b_i}"
                if ka in hard and kb in hard:
                    worst = max(worst, float((hard[ka] & hard[kb]).sum()) / area)
    rep["tier_overlap_worst"] = round(worst, 5)
    # diagnosis: the same pairs on the raw dE > 2 pixels, before the 4 px dilation, so a pair over the limit can be
    # told apart: parts that really share pixels, or masks that only touch once they are grown
    worst_raw, who = 0.0, None
    for a_i in (1, 2, 3):
        for b_i in (1, 2, 3):
            for ta, tb in (("armour", "sensors"), ("armour", "firepower"), ("sensors", "firepower")):
                ka, kb = f"{ta}_t{a_i}", f"{tb}_t{b_i}"
                if ka in raw_d and kb in raw_d:
                    v = float((raw_d[ka] & raw_d[kb]).sum()) / area
                    if v > worst_raw:
                        worst_raw, who = v, (ka, kb)
    rep["tier_overlap_worst_undilated"] = dict(frac=round(worst_raw, 5), pair=who)
    wd, whod = 0.0, None
    for a_i in (1, 2, 3):
        for b_i in (1, 2, 3):
            for ta, tb in (("armour", "sensors"), ("armour", "firepower"), ("sensors", "firepower")):
                ka, kb = f"{ta}_t{a_i}", f"{tb}_t{b_i}"
                if ka in hard and kb in hard:
                    v = float((hard[ka] & hard[kb]).sum()) / area
                    if v > wd:
                        wd, whod = v, (ka, kb)
    rep["tier_overlap_worst_pair"] = whod

    crops, zones = {}, {}
    for t in TRACKS:
        zs = []
        for n in (1, 2, 3):
            p = os.path.join(raw, f"zone_{t}_t{n}_rgba.png")
            if os.path.exists(p):
                z = card_rows(load_rgba(p))
                zs.append((z[..., 3] > 127) & (z[..., 0] > 200))
        if zs:
            zones[t] = np.logical_or.reduce(zs)
            Image.fromarray((zones[t] * 255).astype(np.uint8)).save(os.path.join(out, f"zone_{t}.png"))
            bb = bbox_padded_32(zones[t])
            crops[t] = dict(px=bb, frac=[round(bb[0] / cp.CARD_W, 4), round(bb[1] / cp.CARD_H, 4), round(bb[2] / cp.CARD_W, 4), round(bb[3] / cp.CARD_H, 4)]) if bb else None
            rep.setdefault("zone_area_frac", {})[t] = round(float(zones[t].sum()) / area, 5)
    # the safe zones again with the MAXIMUM kit: a layer must not put gear into the kit-mark or stamp corner either
    full = fig_mask.copy()
    for z in zones.values():
        full |= z
    rep["safe_zones_with_kit"] = {
        "kit_mark_top_left": round(safe_zone_coverage(full, cp.SAFE_KIT_MARK), 4),
        "maxed_stamp_bottom_right": round(safe_zone_coverage(full, cp.SAFE_MAXED_STAMP), 4),
    }
    # and the card edges: does any figure or kit pixel touch the frame (a cropped silhouette)?
    rep["edge_touch"] = {
        "figures": {k: bool(v) for k, v in dict(top=fig_mask[0].any(), bottom=fig_mask[-1].any(), left=fig_mask[:, 0].any(), right=fig_mask[:, -1].any()).items()},
        "with_kit": {k: bool(v) for k, v in dict(top=full[0].any(), bottom=full[-1].any(), left=full[:, 0].any(), right=full[:, -1].any()).items()},
    }
    with open(os.path.join(out, "crops.json"), "w") as fh:
        json.dump(crops, fh, indent=1)
    rep["crops"] = crops

    with open(os.path.join(out, "report.json"), "w") as fh:
        json.dump(rep, fh, indent=1, sort_keys=True, default=float)

    sheet([card[l] for l in levels], levels, 4, 560, os.path.join(out, "layouts_sheet.png"))
    if masks:
        sheet([np.dstack([(masks[l] * 255).astype(np.uint8)] * 3) for l in masks], list(masks), 3, 560, os.path.join(out, "masks_sheet.png"))
    print(json.dumps({k: rep[k] for k in ("safe_zones", "track_overlap", "tier_overlap_worst", "mask_area_frac")}, indent=1))
    print(json.dumps(rep["hands_visibility"], indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
