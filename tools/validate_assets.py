#!/usr/bin/env python3
"""
Roaring Lions -- art CI gate.

Runs on every PR that touches assets/sprites/. Four checks, all mechanical,
all fail-the-build. This is what lets you accept art from strangers without
the roster drifting into visual mush.

    python tools/validate_assets.py \
        --palette data/palette.json \
        --sprites assets/sprites \
        --roster  assets/sprites            # existing art to compare against

Checks:
  1. PALETTE  -- every opaque pixel is exactly a palette entry.
  2. RESERVED -- no VFX or team-colour band in static art. Those are runtime
                 only; if a contributor bakes fire-orange into a hull, the
                 explosion pop is gone and team remap breaks.
  3. ALPHA    -- binary alpha only. Soft edges destroy palette quantization
                 and cost fill rate for nothing at 40-80px.
  4. SILHOUETTE -- rendered at gameplay zoom and reduced to pure black, every
                 unit must be distinguishable from every other unit. Enforced
                 as pairwise IoU below threshold. This is the single check
                 that most protects readability in a busy fight.

Dependencies: pillow, numpy
"""

import argparse
import itertools
import json
import os
import sys

import numpy as np
from PIL import Image

IOU_LIMIT = 0.88          # above this, two silhouettes read as the same unit
GAMEPLAY_ZOOM = 64        # px -- the size a unit actually occupies on screen
MIN_FILL = 0.06           # silhouette must occupy >=6% of its box
ALPHA_CUT = 8             # anything under this is treated as fully clear


def load_palette(path):
    with open(path) as fh:
        pal = json.load(fh)
    allowed, reserved = set(), {}
    for ramp in pal["ramps"].values():
        for hexcode in ramp["colors"]:
            allowed.add(hex_to_rgb(hexcode))
    for band, spec in pal["reserved"].items():
        for name, hexcode in spec["colors"].items():
            rgb = hex_to_rgb(hexcode)
            reserved[rgb] = f"{band}.{name}"
            allowed.add(rgb)          # legal in the file format, illegal in art
    return allowed, reserved


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def sprite_paths(root):
    out = []
    for dirpath, _, files in os.walk(root):
        for f in sorted(files):
            if f.lower().endswith(".png"):
                out.append(os.path.join(dirpath, f))
    return out


def check_image(path, allowed, reserved):
    errs = []
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    a = arr[..., 3]
    rgb = arr[..., :3]

    opaque = a >= 255
    partial = (a > ALPHA_CUT) & (a < 255)
    if partial.any():
        errs.append(
            f"soft alpha on {int(partial.sum())} px -- alpha must be 0 or 255"
        )

    px = rgb[opaque].reshape(-1, 3)
    if px.size:
        uniq = np.unique(px, axis=0)
        for row in uniq:
            t = tuple(int(v) for v in row)
            if t not in allowed:
                errs.append(f"off-palette colour #{'%02X%02X%02X' % t}")
            elif t in reserved:
                errs.append(
                    f"reserved colour #{'%02X%02X%02X' % t} "
                    f"({reserved[t]}) baked into static art"
                )
    return errs


def silhouette(path, size=GAMEPLAY_ZOOM):
    """Downsample to gameplay zoom, return a boolean occupancy mask."""
    img = Image.open(path).convert("RGBA")
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(
        img, ((size - img.width) // 2, (size - img.height) // 2)
    )
    return np.array(canvas)[..., 3] > 96


def iou(a, b):
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter) / float(union) if union else 0.0


def representative(sprites):
    """One canonical facing per unit -- facing 00, frame 000."""
    best = {}
    for p in sprites:
        unit = os.path.basename(os.path.dirname(p))
        name = os.path.basename(p)
        if name.startswith("f00_000") or unit not in best:
            best.setdefault(unit, p)
            if name.startswith("f00_000"):
                best[unit] = p
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--palette", default="data/palette.json")
    ap.add_argument("--sprites", default="assets/sprites")
    ap.add_argument("--iou-limit", type=float, default=IOU_LIMIT)
    args = ap.parse_args()

    allowed, reserved = load_palette(args.palette)
    sprites = sprite_paths(args.sprites)
    if not sprites:
        print("no sprites found -- nothing to validate")
        return 0

    failures = []

    for p in sprites:
        for e in check_image(p, allowed, reserved):
            failures.append(f"{p}: {e}")

    reps = representative(sprites)
    masks = {}
    for unit, p in reps.items():
        m = silhouette(p)
        fill = m.sum() / float(m.size)
        if fill < MIN_FILL:
            failures.append(
                f"{unit}: silhouette fills {fill:.1%} of frame "
                f"(min {MIN_FILL:.0%}) -- unreadable at gameplay zoom"
            )
        masks[unit] = m

    for (ua, ma), (ub, mb) in itertools.combinations(masks.items(), 2):
        score = iou(ma, mb)
        if score > args.iou_limit:
            failures.append(
                f"silhouette collision: {ua} vs {ub} IoU={score:.3f} "
                f"(limit {args.iou_limit:.2f}) -- these read as the same unit"
            )

    if failures:
        print(f"\nART GATE FAILED -- {len(failures)} issue(s):\n")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"art gate passed: {len(sprites)} sprites, {len(masks)} units")
    return 0


if __name__ == "__main__":
    sys.exit(main())
