#!/usr/bin/env python3
"""
Unit icon builder -- crops the unit out of its own portrait frame at build time.

The shell shows a unit's picture by picking ONE frame of its directional
sprite sheet (`packages/app/src/ui/portrait.ts`'s `portraitFile`) and scaling
the whole 256px frame down to a 40px chip, which makes the unit itself a
~20px smudge inside a mostly-transparent square. This script reimplements
that same frame-choice rule in Python, composites the turret sheet over the
hull for the five turreted vehicles, crops to the unit's own alpha bounding
box (padded to a square), and writes a 128x128 icon plus a manifest that
records exactly what it was built from -- so a re-rendered sheet that never
got a matching `pnpm icons:units` run is a loud, mechanical failure
(`--check`) rather than a stale picture nobody notices.

    python3 tools/crop_unit_icons.py
    python3 tools/crop_unit_icons.py --check

Dependencies: pillow, numpy (both already used by tools/validate_assets.py).
"""

import argparse
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image

# The roster-wide portrait facing (packages/app/src/ui/portrait.ts's
# PORTRAIT_FACING), used unless a sheet's own manifest overrides it via
# `portraitFacing`.
PORTRAIT_FACING = 3

# Alpha values at or below this are treated as fully clear -- the same
# threshold tools/validate_assets.py uses for its own alpha checks.
ALPHA_CUT = 8

HULL_SUFFIX = "_HULL"
TURRET_SUFFIX = "_TURR"


def discover_sheets(sprites_dir):
    """Every directory under sprites_dir with a manifest.json, excluding
    buildings (`BLD_*`) and turret layers (`*_TURR`) -- those never get an
    icon of their own; a turret is composited into its hull's icon instead."""
    names = []
    for entry in sorted(os.listdir(sprites_dir)):
        path = os.path.join(sprites_dir, entry)
        if not os.path.isdir(path):
            continue
        if entry.startswith("BLD_") or entry.endswith(TURRET_SUFFIX):
            continue
        if not os.path.isfile(os.path.join(path, "manifest.json")):
            continue
        names.append(entry)
    return names


def load_manifest(sprites_dir, name):
    with open(os.path.join(sprites_dir, name, "manifest.json")) as fh:
        return json.load(fh)


def pick_frame(files, facing):
    """Reimplements portraitFile's picking rule exactly, given the resolved
    target facing (a sheet's own `portraitFacing` or the roster default).

    `clip` absent on a file record means the sheet has no clips at all and
    every frame in it is the idle pose -- not that the frame belongs to some
    other clip -- which is why the filter defaults a missing `clip` to
    'idle' rather than excluding it.
    """
    if not files:
        return None
    idle = [f for f in files if f.get("clip", "idle") == "idle"]
    pool = idle if idle else files
    for f in pool:
        if f["facing"] == facing and f["frame"] == 0:
            return f
    for f in pool:
        if f["frame"] == 0:
            return f
    return pool[0]


def alpha_bbox(image, threshold=ALPHA_CUT):
    """(x0, y0, x1, y1) -- half-open -- of pixels whose alpha exceeds
    `threshold`, or None if nothing does."""
    arr = np.asarray(image)
    mask = arr[:, :, 3] > threshold
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def square_crop_box(bbox, margin, frame_size):
    """Pad `bbox` by `margin` of its larger side, square it about its own
    centre, then clamp into [0, frame_size) -- by SHIFTING, never shrinking,
    unless the padded square is itself larger than the frame, in which case
    it is clamped down to the whole frame (shifting cannot help there).
    Returns an integer (x, y, w, w)."""
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    pad = margin * max(w, h)
    fx0, fy0, fx1, fy1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    cx, cy = (fx0 + fx1) / 2.0, (fy0 + fy1) / 2.0
    side = max(fx1 - fx0, fy1 - fy0)
    side = min(side, float(frame_size))  # a box bigger than the frame clamps to it
    half = side / 2.0
    sx0, sy0 = cx - half, cy - half

    iw = min(int(round(side)), frame_size)
    ix = max(0, min(int(round(sx0)), frame_size - iw))
    iy = max(0, min(int(round(sy0)), frame_size - iw))
    return ix, iy, iw, iw


def read_bytes(path):
    with open(path, "rb") as fh:
        return fh.read()


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def _premultiply(image):
    arr = np.asarray(image).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3] * alpha
    out = np.concatenate([rgb, arr[:, :, 3:4]], axis=2)
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8), "RGBA")


def _unpremultiply(image):
    arr = np.asarray(image).astype(np.float32)
    alpha = arr[:, :, 3:4]
    safe = np.where(alpha == 0, 255.0, alpha)  # avoid divide-by-zero
    rgb = arr[:, :, :3] * (255.0 / safe)
    rgb = np.where(alpha == 0, 0.0, rgb)  # fully-clear pixels carry no colour
    out = np.concatenate([rgb, alpha], axis=2)
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8), "RGBA")


def resize_premultiplied(image, size):
    pre = _premultiply(image)
    pre = pre.resize((size, size), Image.LANCZOS)
    return _unpremultiply(pre)


def build_icon(cropped, size):
    """Downsample only if the cropped square is larger than `size`; otherwise
    paste at native resolution, centred, never upscaling past 1:1."""
    w = cropped.width
    if w > size:
        return resize_premultiplied(cropped, size)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - w) // 2, (size - w) // 2)
    canvas.alpha_composite(cropped, offset)
    return canvas


def process_sheet(sprites_dir, name, size, margin):
    manifest = load_manifest(sprites_dir, name)
    files = manifest.get("files", [])
    target_facing = manifest.get("portraitFacing", PORTRAIT_FACING)
    hull_pick = pick_frame(files, target_facing)
    if hull_pick is None:
        return None  # no art at all -- none of the shipped hull sheets hit this

    hull_path = os.path.join(sprites_dir, name, hull_pick["file"])
    hull_bytes = read_bytes(hull_path)
    image = Image.open(io.BytesIO(hull_bytes)).convert("RGBA")
    sources = [
        {
            "path": f"assets/sprites/{name}/{hull_pick['file']}",
            "sha256": sha256_hex(hull_bytes),
        }
    ]

    if name.endswith(HULL_SUFFIX):
        turret_name = name[: -len(HULL_SUFFIX)] + TURRET_SUFFIX
        turret_manifest_path = os.path.join(sprites_dir, turret_name, "manifest.json")
        if os.path.isfile(turret_manifest_path):
            turret_manifest = load_manifest(sprites_dir, turret_name)
            # Same choice rule, anchored on the hull's OWN resolved facing --
            # not the turret's independent default -- so a fallback on the
            # hull side still lands the turret at the identical facing.
            turret_pick = pick_frame(turret_manifest.get("files", []), hull_pick["facing"])
            if turret_pick is not None:
                turret_path = os.path.join(sprites_dir, turret_name, turret_pick["file"])
                turret_bytes = read_bytes(turret_path)
                turret_image = Image.open(io.BytesIO(turret_bytes)).convert("RGBA")
                if turret_image.size != image.size:
                    raise ValueError(
                        f"{name}: turret frame {turret_pick['file']} is {turret_image.size}, "
                        f"hull frame {hull_pick['file']} is {image.size} -- expected equal"
                    )
                image = Image.alpha_composite(image, turret_image)
                sources.append(
                    {
                        "path": f"assets/sprites/{turret_name}/{turret_pick['file']}",
                        "sha256": sha256_hex(turret_bytes),
                    }
                )

    bbox = alpha_bbox(image)
    if bbox is None:
        raise ValueError(f"{name}: composited frame has no pixel above the alpha threshold")

    box = square_crop_box(bbox, margin, image.width)
    x, y, w, _ = box
    cropped = image.crop((x, y, x + w, y + w))
    icon = build_icon(cropped, size)

    extent_bbox = alpha_bbox(icon)
    extent = (0, 0) if extent_bbox is None else (extent_bbox[2] - extent_bbox[0], extent_bbox[3] - extent_bbox[1])

    return {
        "name": name,
        "file": f"{name}.png",
        "sources": sources,
        "facing": hull_pick["facing"],
        "box": list(box),
        "extent": list(extent),
        "image": icon,
    }


def format_log_line(result):
    x, y, w, h = result["box"]
    ew, eh = result["extent"]
    return f"{result['name']} facing {result['facing']} box {x},{y},{w},{h} extent {ew},{eh}"


def build_all(sprites_dir, size, margin):
    """Recomputes every icon in memory. Returns (manifest_dict, {name: png_bytes}, [log lines])."""
    icons = {}
    icon_bytes = {}
    log_lines = []
    for name in discover_sheets(sprites_dir):
        result = process_sheet(sprites_dir, name, size, margin)
        if result is None:
            continue
        icons[name] = {
            "file": result["file"],
            "sources": result["sources"],
            "facing": result["facing"],
            "box": result["box"],
            "extent": result["extent"],
        }
        buf = io.BytesIO()
        result["image"].save(buf, format="PNG", optimize=False)
        icon_bytes[name] = buf.getvalue()
        log_lines.append(format_log_line(result))
    manifest = {"version": 1, "icons": icons}
    return manifest, icon_bytes, log_lines


def manifest_json_bytes(manifest):
    return (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")


def run_write(sprites_dir, out_dir, size, margin):
    manifest, icon_bytes, log_lines = build_all(sprites_dir, size, margin)
    os.makedirs(out_dir, exist_ok=True)

    for name, data in icon_bytes.items():
        with open(os.path.join(out_dir, f"{name}.png"), "wb") as fh:
            fh.write(data)

    # Remove icons for sheets no longer discovered (e.g. a sheet was deleted),
    # so the directory never carries an orphan the manifest doesn't mention.
    wanted_files = {f"{name}.png" for name in icon_bytes}
    for entry in os.listdir(out_dir):
        if entry.endswith(".png") and entry not in wanted_files:
            os.remove(os.path.join(out_dir, entry))

    with open(os.path.join(out_dir, "manifest.json"), "wb") as fh:
        fh.write(manifest_json_bytes(manifest))

    for line in log_lines:
        print(line)
    print(f"{len(icon_bytes)} icon(s) written to {out_dir}")
    return 0


def run_check(sprites_dir, out_dir, size, margin):
    manifest, icon_bytes, _log_lines = build_all(sprites_dir, size, margin)

    manifest_path = os.path.join(out_dir, "manifest.json")
    existing_manifest = {}
    if os.path.isfile(manifest_path):
        with open(manifest_path) as fh:
            existing_manifest = json.load(fh)
    existing_icons = existing_manifest.get("icons", {})

    computed_names = set(manifest["icons"].keys())
    existing_names = set(existing_icons.keys())

    problems = []
    for name in sorted(computed_names - existing_names):
        problems.append(f"missing: {name} (in sprites, not in manifest)")
    for name in sorted(existing_names - computed_names):
        problems.append(f"extra: {name} (in manifest, no such sprite sheet)")
    for name in sorted(computed_names & existing_names):
        if manifest["icons"][name] != existing_icons[name]:
            problems.append(f"stale: {name} (manifest entry does not match sprites)")
            continue
        icon_path = os.path.join(out_dir, manifest["icons"][name]["file"])
        if not os.path.isfile(icon_path):
            problems.append(f"missing: {name} (manifest entry has no PNG on disk)")
            continue
        if read_bytes(icon_path) != icon_bytes[name]:
            problems.append(f"stale: {name} (PNG on disk does not match sprites)")

    accounted_files = {f"{name}.png" for name in computed_names | existing_names}
    if os.path.isdir(out_dir):
        for entry in sorted(os.listdir(out_dir)):
            if entry.endswith(".png") and entry not in accounted_files:
                problems.append(f"extra: {entry} (PNG on disk, no manifest entry)")

    if problems:
        for p in problems:
            print(f"  - {p}")
        print(f"unit icons out of date: {len(problems)} issue(s)")
        return 1

    print(f"unit icons up to date: {len(icon_bytes)} icon(s)")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sprites", default="assets/sprites")
    ap.add_argument("--out", default="assets/ui/icons/units")
    ap.add_argument("--size", type=int, default=128)
    ap.add_argument("--margin", type=float, default=0.08)
    ap.add_argument(
        "--check",
        action="store_true",
        help="recompute every icon in memory and compare against the manifest and PNG bytes "
             "on disk; exit 1 listing every stale/missing/extra icon; writes nothing",
    )
    args = ap.parse_args()

    if args.check:
        return run_check(args.sprites, args.out, args.size, args.margin)
    return run_write(args.sprites, args.out, args.size, args.margin)


if __name__ == "__main__":
    sys.exit(main())
