#!/usr/bin/env python3
"""
Roaring Lions -- palette quantizer.

ART_PIPELINE.md §3 says the render rig emits on-palette art. Sprites that
arrive from anywhere else (a hand render, a downloaded model, a one-off
Blender export) do not, and validate_assets.py rejects them by name -- which
is correct, and useless on its own. This is the missing step: it snaps art
onto the locked palette so it can pass the gate instead of being argued with.

    python tools/quantize_sprites.py --sprites assets/sprites
    python tools/quantize_sprites.py --sprites assets/sprites --check

Two rules, both from the art gate:

  * Every opaque pixel becomes its nearest palette entry. Nearest is measured
    in a luma-weighted RGB space, because the eye cares far more about
    getting the value right than the hue -- a shadow that snaps to the wrong
    brightness reads as a hole in the model.

  * The vfx and team bands are excluded as targets. They are runtime-only:
    baking fire-orange into a hull destroys the contrast rule the whole
    palette exists to protect, and baking team magenta breaks the remap.

Alpha is forced binary (0 or 255) at the same time, since soft edges fight
quantization and cost fill rate for nothing at gameplay zoom.

Dependencies: pillow, numpy
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ALPHA_CUT = 128
# Perceptual weights (ITU-R BT.601 luma). Distance is computed on weighted
# channels so value errors dominate the choice, not hue errors.
LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float64)


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_targets(path):
    """Palette entries legal in static art: the ramps, never the reserved bands."""
    with open(path) as fh:
        pal = json.load(fh)
    targets, names = [], []
    for ramp, spec in pal["ramps"].items():
        for i, hexcode in enumerate(spec["colors"]):
            targets.append(hex_to_rgb(hexcode))
            names.append(f"{ramp}.{i}")
    return np.array(targets, dtype=np.float64), names


def quantize(path, targets, check_only):
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    rgb = arr[..., :3].astype(np.float64)
    a = arr[..., 3]

    opaque = a >= ALPHA_CUT
    new_a = np.where(opaque, 255, 0).astype(np.uint8)

    out = arr.copy()
    out[..., 3] = new_a
    if opaque.any():
        # Map only the distinct colours present, then scatter the result back:
        # a 256x256 sprite has thousands of pixels but only hundreds of colours.
        px = rgb[opaque]
        uniq, inverse = np.unique(px, axis=0, return_inverse=True)
        d = (uniq[:, None, :] - targets[None, :, :]) * LUMA
        nearest = np.argmin((d * d).sum(axis=2), axis=1)
        mapped = targets[nearest][inverse].astype(np.uint8)
        out[..., :3][opaque] = mapped

    changed = not np.array_equal(out, arr)
    if changed and not check_only:
        Image.fromarray(out, "RGBA").save(path)
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--palette", default="data/palette.json")
    ap.add_argument("--sprites", default="assets/sprites")
    ap.add_argument(
        "--check",
        action="store_true",
        help="report what would change and exit nonzero, without writing",
    )
    args = ap.parse_args()

    targets, _ = load_targets(args.palette)
    files = []
    for dirpath, _, names in os.walk(args.sprites):
        for n in sorted(names):
            if n.lower().endswith(".png"):
                files.append(os.path.join(dirpath, n))
    if not files:
        print("no sprites found -- nothing to quantize")
        return 0

    changed = [f for f in files if quantize(f, targets, args.check)]
    verb = "would be rewritten" if args.check else "rewritten"
    print(f"{len(changed)}/{len(files)} sprite(s) {verb} onto the palette")
    if args.check and changed:
        for f in changed[:10]:
            print(f"  - {f}")
        if len(changed) > 10:
            print(f"  ... and {len(changed) - 10} more")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
