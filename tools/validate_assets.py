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
import re
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


def is_layer(path):
    """True when a sheet declares itself a composite layer, not a unit."""
    mf = os.path.join(os.path.dirname(path), "manifest.json")
    if not os.path.exists(mf):
        return False
    with open(mf) as fh:
        return "layer" in json.load(fh)


def check_framing(path):
    """Opaque pixels must not touch the frame edge.

    A sprite that runs off its own canvas has been cropped by the render
    camera -- most often the model is mispositioned rather than merely large.
    The fill and silhouette checks both miss this: a decapitated soldier still
    fills its frame and still has a distinct outline, so nothing else in this
    gate would notice that the head is gone.
    """
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[:, :, 3] > 128
    if not a.any():
        return ["sprite is fully transparent"]
    errs = []
    for edge, hit in (
        ("top", a[0, :].any()),
        ("bottom", a[-1, :].any()),
        ("left", a[:, 0].any()),
        ("right", a[:, -1].any()),
    ):
        if hit:
            errs.append(f"silhouette touches the {edge} edge -- cropped by the render camera")
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


# Sprite filenames are either legacy flat -- f<NN>_<FFF>.png -- or
# clip-prefixed -- <clip>_f<NN>_<FFF>.png. The clip migration introduced the
# second form, and this function used to recognise only the first.
SPRITE_RE = re.compile(r"^(?:(?P<clip>[a-z_]+)_)?f(?P<facing>\d{2})_(?P<frame>\d{3})\.png$")


def representative(sprites):
    """One canonical sprite per unit -- the idle pose at facing 00, frame 000.

    The silhouette check asks "do two units read as the same thing at
    gameplay zoom", so it has to compare like with like. Comparing one unit's
    idle against another's crouch answers a question nobody asked.
    """
    best = {}
    seen_clipped = set()
    for p in sorted(sprites):
        unit = os.path.basename(os.path.dirname(p))
        m = SPRITE_RE.match(os.path.basename(p))
        if not m:
            best.setdefault(unit, p)
            continue
        clip = m.group("clip")
        canonical = m.group("facing") == "00" and m.group("frame") == "000"
        if clip:
            seen_clipped.add(unit)
            if clip == "idle" and canonical:
                best[unit] = p
                continue
        elif canonical:
            best[unit] = p
            continue
        best.setdefault(unit, p)

    for unit in seen_clipped:
        chosen = os.path.basename(best[unit])
        if not chosen.startswith("idle_f00_000"):
            sys.exit(
                f"{unit}: sheet uses clip-prefixed names but has no "
                f"idle_f00_000.png. The silhouette gate has nothing canonical "
                f"to compare and would otherwise measure an arbitrary pose."
            )
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
        for e in check_framing(p):
            failures.append(f"{p}: {e}")

    reps = representative(sprites)
    # Composite layers (a turret drawn onto its hull) are not units. They are
    # still checked for palette, alpha and framing above; the two checks below
    # ask "does this read as a unit at gameplay zoom", which a layer never
    # answers meaningfully.
    reps = {u: p for u, p in reps.items() if not is_layer(p)}
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
