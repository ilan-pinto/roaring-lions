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


def sheet_dirs(root):
    """Every directory that directly holds at least one PNG.

    This is the gate's notion of "a sheet" -- a unit or a composite layer.
    Walking directories rather than reusing `sprite_paths`' flat file list
    means an interrupted render job that left a directory with PNGs but no
    `manifest.json` is still visited, even though it has nothing else in
    common with a real sheet.
    """
    out = []
    for dirpath, _, files in os.walk(root):
        if any(f.lower().endswith(".png") for f in files):
            out.append(dirpath)
    return sorted(out)


def check_manifest_completeness(sheet_dir):
    """A sheet must declare exactly the frames it ships -- both directions.

    A manifest promising frames that are not on disk (an interrupted render
    job, or hand-edited JSON) is exactly as broken as frames on disk the
    manifest never mentions (a probe render, or a frame nobody wired up):
    either way, the frame set the game will actually load does not match the
    frame set anyone signed off on. Below that: a manifest is also checked
    against itself, since `facings x clip-frames` and the length of its own
    `files` list are two ways of saying the same number and can disagree.
    """
    errs = []
    on_disk = {
        f for f in os.listdir(sheet_dir) if f.lower().endswith(".png")
    }
    mf = os.path.join(sheet_dir, "manifest.json")

    if not os.path.exists(mf):
        errs.append(
            f"{sheet_dir}: no manifest.json for {len(on_disk)} PNG(s) -- "
            f"incomplete sheet (probe render or interrupted job)"
        )
        return errs

    with open(mf) as fh:
        try:
            manifest = json.load(fh)
        except json.JSONDecodeError as e:
            errs.append(f"{mf}: unreadable JSON ({e})")
            return errs

    declared_entries = manifest.get("files", [])
    declared = {entry["file"] for entry in declared_entries}

    for f in sorted(declared - on_disk):
        errs.append(
            f"{sheet_dir}: manifest declares {f} but it is not on disk"
        )
    for f in sorted(on_disk - declared):
        errs.append(
            f"{sheet_dir}: {f} is on disk but manifest.json does not "
            f"declare it"
        )

    facings = manifest.get("facings")
    clips = manifest.get("clips")
    if facings and clips:
        frames_per_facing = sum(c.get("frames", 0) for c in clips.values())
        expected = facings * frames_per_facing
        if expected != len(declared_entries):
            errs.append(
                f"{sheet_dir}: manifest lists {len(declared_entries)} files "
                f"but facings({facings}) x clip-frames({frames_per_facing}) "
                f"= {expected}"
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


# The DRAWN GROUND is the fourth named exemption from data/palette.json, and
# this gate is the one that says so out loud on its passing path -- the same
# shape `render_mesh_gate.py` uses for the six textured buildings.
#
# Nothing in this file can check it: terrain is generated at runtime by
# `packages/render/src/three/terrain/`, not shipped as a PNG, so there is no
# image here to walk. What this gate CAN do, and what a silent exemption
# would not, is make sure a reader of the art gate's output knows the ground
# is no longer palette-bound and knows exactly how far that goes.
#
# Kept in step with the renderer's own `SURFACE_SHADING_EXEMPTION`
# (`terrain/surface.ts`) by `terrain/surface.test.ts`, which parses this list
# out of this file and compares them -- the same pinning
# `textured-building.test.ts` does across the same language boundary for
# TEXTURED_MESH_EXEMPT. A line added on one side and not the other fails
# `pnpm test`.
TERRAIN_PALETTE_EXEMPTION = (
    "NOT palette-checked -- the drawn ground, at the fragment stage only:",
    "a smooth normal-driven shade on INTERPOLATED open ground, plus ONE",
    "sampled albedo per surface, each applied as a ratio to its own measured",
    "mean so the surface still AVERAGES to its data/palette.json tone:",
    "  open ground   desert_sand_tile (arid) / green_basin_tile (green)",
    "  ^ rock ridge  rock_ground_tile",
    "  r dirt road   road_track_tile",
    "  1/2/3 cover   rough_scrub_tile, at a per-tier strength",
    "  o grove floor orchard_floor_tile",
    "STILL palette-only, and still asserted directly: every vertex colour and",
    "litColor buildGround emits, cover tiers included (groundTone does not",
    "branch on cover -- a tier reads as texture contrast, never as a tint);",
    "terrace tops and terrace/rim walls; walls, which take bedrock or nothing;",
    "building footprints; knoll tiles; scatter, groves, building boxes and the",
    "residual layer -- the olive trees standing on an orchard floor and the",
    "tuft marks on a cover tile are both still palette-only geometry.",
    "Flat ground keeps an up normal, so its SHADE term is exactly 1.0 -- but it",
    "does take its surface albedo, by the project lead's call: the default",
    "sandbox map is a flat one, and flat sand is still sand.",
)


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

    incomplete_dirs = set()
    for d in sheet_dirs(args.sprites):
        errs = check_manifest_completeness(d)
        if errs:
            failures.extend(errs)
            incomplete_dirs.add(d)

    reps = representative(sprites)
    # Composite layers (a turret drawn onto its hull) are not units. They are
    # still checked for palette, alpha and framing above; the two checks below
    # ask "does this read as a unit at gameplay zoom", which a layer never
    # answers meaningfully. A sheet that failed the manifest-completeness
    # check above is excluded the same way: it is already a reported
    # failure, and comparing a probe render's one frame against shipped
    # units' silhouettes answers a question nobody asked and would only
    # bury the real error under a coincidental IoU collision.
    reps = {
        u: p
        for u, p in reps.items()
        if not is_layer(p) and os.path.dirname(p) not in incomplete_dirs
    }
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
    for line in TERRAIN_PALETTE_EXEMPTION:
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
