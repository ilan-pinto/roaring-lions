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


def decode_rgba(data):
    """(size, pixel_bytes) for PNG `data`, decoded through RGBA -- never the raw
    encoded bytes. Two Pillow versions can encode identical pixels to different
    PNG bytes (measured: 10.3.0 vs 12.3.0 disagree on every shipped icon), so
    `--check` must compare what a decoder sees, not what an encoder wrote."""
    image = Image.open(io.BytesIO(data)).convert("RGBA")
    try:
        pixels = np.asarray(image).tobytes()
    except Exception:
        pixels = image.tobytes()
    return image.size, pixels


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


def process_sheet(sprites_dir, name, size, margin, problems):
    manifest = load_manifest(sprites_dir, name)
    files = manifest.get("files", [])
    # A JSON `null` reads back as Python `None` via `.get`, which is not the
    # same as the key being absent -- `.get(key, DEFAULT)` only supplies
    # DEFAULT in the latter case. Treat both alike, matching TS's `??`
    # (portrait.ts's `manifest.portraitFacing ?? PORTRAIT_FACING`) -- and
    # unlike a plain `or`, which would also coalesce a legitimately authored
    # facing of 0.
    target_facing = manifest.get("portraitFacing")
    if target_facing is None:
        target_facing = PORTRAIT_FACING
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
    turret_facing = None

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
                if turret_pick["facing"] != hull_pick["facing"]:
                    # pick_frame falls back to a different facing when the
                    # turret sheet does not carry the hull's resolved one --
                    # composited, that draws a turret aimed nowhere near the
                    # hull's own three-quarter view, silently.
                    raise ValueError(
                        f"{name}: turret frame facing {turret_pick['facing']} != "
                        f"hull facing {hull_pick['facing']}"
                    )
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
                turret_facing = turret_pick["facing"]

    bbox = alpha_bbox(image)
    if bbox is None:
        # Collected rather than raised: one badly-authored portrait frame
        # should not take an uncaught traceback through the whole batch and
        # hide every other sheet's result behind it.
        problems.append(f"{name}: portrait frame has no opaque pixel")
        return None

    box = square_crop_box(bbox, margin, image.width)
    x, y, w, _ = box
    cropped = image.crop((x, y, x + w, y + w))
    icon = build_icon(cropped, size)

    extent_bbox = alpha_bbox(icon)
    extent = (0, 0) if extent_bbox is None else (extent_bbox[2] - extent_bbox[0], extent_bbox[3] - extent_bbox[1])

    result = {
        "name": name,
        "file": f"{name}.png",
        "sources": sources,
        "facing": hull_pick["facing"],
        "box": list(box),
        "extent": list(extent),
        "image": icon,
    }
    if turret_facing is not None:
        result["turretFacing"] = turret_facing
    return result


def format_log_line(result):
    x, y, w, h = result["box"]
    ew, eh = result["extent"]
    return f"{result['name']} facing {result['facing']} box {x},{y},{w},{h} extent {ew},{eh}"


def build_all(sprites_dir, size, margin):
    """Recomputes every icon in memory.
    Returns (manifest_dict, {name: png_bytes}, [log lines], [problem lines])."""
    icons = {}
    icon_bytes = {}
    log_lines = []
    problems = []
    for name in discover_sheets(sprites_dir):
        result = process_sheet(sprites_dir, name, size, margin, problems)
        if result is None:
            continue
        icons[name] = {
            "file": result["file"],
            "sources": result["sources"],
            "facing": result["facing"],
            "box": result["box"],
            "extent": result["extent"],
        }
        if "turretFacing" in result:
            icons[name]["turretFacing"] = result["turretFacing"]
        buf = io.BytesIO()
        result["image"].save(buf, format="PNG", optimize=False)
        icon_bytes[name] = buf.getvalue()
        log_lines.append(format_log_line(result))
    # "size" is the one place the icon's pixel dimensions are recorded --
    # packages/app/src/ui/portrait.ts and unit_icons.test.ts both read it back
    # rather than carrying their own copy of this script's --size default.
    manifest = {"version": 1, "size": size, "icons": icons}
    return manifest, icon_bytes, log_lines, problems


def manifest_json_bytes(manifest):
    return (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")


def run_write(sprites_dir, out_dir, size, margin, prune):
    """Writes every icon plus manifest.json to out_dir.

    `prune` controls whether stray `*.png` files under `out_dir` with no
    current manifest entry are deleted (e.g. a sheet was renamed or removed).
    It is only ever True by default when `out_dir` is left at its own default
    value (see `main`) -- pointing `--out` somewhere else (a scratch
    directory, a review copy) must never make this script start deleting
    files it did not write, so a caller who wants that has to ask for it with
    an explicit `--prune`.
    """
    manifest, icon_bytes, log_lines, problems = build_all(sprites_dir, size, margin)
    os.makedirs(out_dir, exist_ok=True)

    for name, data in icon_bytes.items():
        with open(os.path.join(out_dir, f"{name}.png"), "wb") as fh:
            fh.write(data)

    if prune:
        wanted_files = {f"{name}.png" for name in icon_bytes}
        for entry in os.listdir(out_dir):
            if entry.endswith(".png") and entry not in wanted_files:
                os.remove(os.path.join(out_dir, entry))

    with open(os.path.join(out_dir, "manifest.json"), "wb") as fh:
        fh.write(manifest_json_bytes(manifest))

    for line in log_lines:
        print(line)
    print(f"{len(icon_bytes)} icon(s) written to {out_dir}")
    if problems:
        for p in problems:
            print(f"  - {p}")
        print(f"{len(problems)} sheet(s) skipped")
        return 1
    return 0


def run_check(sprites_dir, out_dir, size, margin):
    manifest, icon_bytes, _log_lines, problems = build_all(sprites_dir, size, margin)

    manifest_path = os.path.join(out_dir, "manifest.json")
    existing_manifest = {}
    if os.path.isfile(manifest_path):
        with open(manifest_path) as fh:
            existing_manifest = json.load(fh)
    existing_icons = existing_manifest.get("icons", {})

    computed_names = set(manifest["icons"].keys())
    existing_names = set(existing_icons.keys())

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
        on_disk = decode_rgba(read_bytes(icon_path))
        fresh = decode_rgba(icon_bytes[name])
        if on_disk != fresh:
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


DEFAULT_OUT_DIR = "assets/ui/icons/units"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sprites", default="assets/sprites")
    ap.add_argument(
        "--out",
        default=DEFAULT_OUT_DIR,
        help=f"output directory for icon PNGs and manifest.json (default: {DEFAULT_OUT_DIR}); "
             "stray *.png files here with no current manifest entry are only pruned when this "
             "is left at its default, or --prune is passed explicitly (see --prune)",
    )
    ap.add_argument("--size", type=int, default=128)
    ap.add_argument("--margin", type=float, default=0.08)
    ap.add_argument(
        "--check",
        action="store_true",
        help="recompute every icon in memory and compare against the manifest and PNG bytes "
             "on disk; exit 1 listing every stale/missing/extra icon; writes nothing",
    )
    ap.add_argument(
        "--prune",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="remove stray *.png files under --out that have no current manifest entry. "
             "Defaults to on when --out is left at its default value and off otherwise, so "
             "pointing --out at some other directory never deletes files this script didn't "
             "write unless asked to; pass --prune or --no-prune to override either way. "
             "Ignored with --check, which never writes anything.",
    )
    args = ap.parse_args()

    if args.check:
        return run_check(args.sprites, args.out, args.size, args.margin)
    prune = args.prune
    if prune is None:
        prune = args.out == DEFAULT_OUT_DIR
    return run_write(args.sprites, args.out, args.size, args.margin, prune)


if __name__ == "__main__":
    sys.exit(main())
