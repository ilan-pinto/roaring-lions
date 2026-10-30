"""Compose the R3 ground texture (GH-871 P3 approval render): the wetland tiles,
laid over a window of Ein Qasab the way the ground shader will lay them.

    python3 tools/terrain/wetland_r3_ground.py --window window.json \\
        --tiles <dir with the five PNGs> --out ground.png [--per-tile 192] \\
        [--crop x0,y0,x1,y1]

`window.json` is written by `tools/src/wetland_p3_dump.test.ts` (the real tile
grid, the real `marshWaterAt` field, the real tones). The output is an sRGB PNG
of the window, `per-tile` texels to a tile, for a plane in Blender.

This is a PREVIEW composition for the approval render, in the shader's own form:
each surface is its tone times `1 + strength * gain * (texel / mean - 1)` of its
image (terrain/mesh.ts), repeated at its declared tile count. It is not the
shader: the marsh shoreline is a noise-wandered blend (the P2b shoreline's shape
in spirit), the water is the spec's proxy at R = 0.25 (`(1 - R) x 0.55 x mud.3`
as albedo, `R x overcast.0` as an unlit reflection, written as a second PNG, the
water mask), flat, with no ripple and no sheen, because the puddle-reflectance
A/B is P4's.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "textures"))
from author_wetland_tiles import TILES, hash_u32  # noqa: E402

# Post S-6 palette (data/palette.json).
FEN0 = (0x7F, 0x9F, 0x57)
MUD1 = (0x72, 0x59, 0x44)
MUD2 = (0x58, 0x45, 0x35)
MUD3 = (0x41, 0x33, 0x27)
OVERCAST0 = (0xC4, 0xC8, 0xC9)
WATER_R = 0.25
SCRUB_TIER1 = 0.4  # marsh = scrub image at the cover-1 strength (control-map.ts)


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055) * 255.0


def smoothstep(lo, hi, v):
    t = np.clip((v - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lattice_noise(shape, cell_px, seed):
    """Smooth value noise over `shape`, one lattice cell per `cell_px` texels."""
    h, w = shape
    gh, gw = int(math.ceil(h / cell_px)) + 3, int(math.ceil(w / cell_px)) + 3
    a = np.arange(gh, dtype=np.uint32)[:, None]
    b = np.arange(gw, dtype=np.uint32)[None, :]
    lat = hash_u32(a, b, seed).astype(np.float64) / 4294967296.0 * 2.0 - 1.0
    ys = (np.arange(h) / cell_px)[:, None] + 1.0
    xs = (np.arange(w) / cell_px)[None, :] + 1.0
    return map_coordinates(lat, [np.broadcast_to(ys, (h, w)), np.broadcast_to(xs, (h, w))], order=3, mode="nearest")


def load_ratio_image(tiles_dir, name):
    img = np.asarray(Image.open(os.path.join(tiles_dir, name + ".png")).convert("RGB")).astype(np.float32)
    return img, img.reshape(-1, 3).mean(axis=0)


def sample_ratio(img, mean, metres, gain, strength, world_x, world_y):
    """tile image sampled at world metres (wrapping), as the shader's ratio
    `1 + strength * gain * (texel / mean - 1)`; bilinear on the repeat."""
    n = img.shape[0]
    u = (world_x / metres) % 1.0 * n
    v = (world_y / metres) % 1.0 * n
    out = np.empty(world_x.shape + (3,), np.float32)
    for c in range(3):
        out[..., c] = map_coordinates(img[..., c], [v, u], order=1, mode="wrap")
    ratio = out / mean
    return 1.0 + strength * gain * (ratio - 1.0)


def build(window, tiles_dir, per_tile, crop=None):
    x0, y0 = window["x0"], window["y0"]
    nx, ny = window["x1"] - x0 + 1, window["y1"] - y0 + 1
    S = window["S"]
    rows = window["rows"]
    # texel grid over the crop (default the whole window), in tile units
    cx0, cy0, cx1, cy1 = crop if crop else (x0, y0, window["x1"] + 1, window["y1"] + 1)
    w = int(round((cx1 - cx0) * per_tile))
    h = int(round((cy1 - cy0) * per_tile))
    tx = cx0 + (np.arange(w) + 0.5) / per_tile
    ty = cy0 + (np.arange(h) + 0.5) / per_tile
    TX, TY = np.meshgrid(tx, ty)
    # nearest-tile classes
    tix = np.clip(np.floor(TX - x0).astype(int), 0, nx - 1)
    tiy = np.clip(np.floor(TY - y0).astype(int), 0, ny - 1)
    sym = np.array([[ord(rows[j][i]) for i in range(nx)] for j in range(ny)])[tiy, tix]
    marsh_t = sym == ord("~")
    road_t = sym == ord("r")
    grove_t = sym == ord("o")

    def soft(mask, sigma_tiles, wobble_tiles, wobble_amp, seed):
        f = gaussian_filter(mask.astype(np.float32), sigma_tiles * per_tile, mode="nearest")
        n1 = lattice_noise((h, w), wobble_tiles * per_tile, seed) * wobble_amp
        return smoothstep(0.35, 0.65, f + n1)

    marsh = soft(marsh_t, 0.30, 0.9, 0.10, 9101)
    road = soft(road_t, 0.14, 0.7, 0.05, 9203)
    grove = soft(grove_t, 0.22, 0.8, 0.07, 9307)

    # the water field, the real one, bilinear from its 32 samples a tile
    water_raw = np.array(window["water"], dtype=np.float32).reshape(ny * S, nx * S)
    wy = (TY - y0) * S - 0.5
    wx = (TX - x0) * S - 0.5
    water = map_coordinates(water_raw, [wy, wx], order=1, mode="nearest")
    water_w = smoothstep(0.38, 0.62, water) * marsh_t.astype(np.float32)
    # world metres
    WX, WY = TX * 3.0, TY * 3.0

    open_img, open_mean = load_ratio_image(tiles_dir, "wetland_open_tile")
    scrub_img, scrub_mean = load_ratio_image(tiles_dir, "wet_scrub_tile")
    litter_img, litter_mean = load_ratio_image(tiles_dir, "oak_litter_tile")
    scree_img, scree_mean = load_ratio_image(tiles_dir, "basalt_scree_tile")
    # Pre-filter the images to the texel density, so a 64 texel/m ground does not
    # alias a 114 texel/m image.
    def prefilter(img, metres):
        tpm = per_tile / 3.0
        factor = img.shape[0] / metres / tpm
        if factor > 1.2:
            img = gaussian_filter(img, (factor / 2.0, factor / 2.0, 0), mode="wrap")
        return img

    open_img = prefilter(open_img, TILES["wetland_open_tile"]["metres"])
    scrub_img = prefilter(scrub_img, TILES["wet_scrub_tile"]["metres"])
    litter_img = prefilter(litter_img, TILES["oak_litter_tile"]["metres"])
    scree_img = prefilter(scree_img, TILES["basalt_scree_tile"]["metres"])

    t_open = np.array(FEN0, np.float32) * sample_ratio(open_img, open_mean, 9.0, TILES["wetland_open_tile"]["gain"], 1.0, WX, WY)
    t_grove = np.array(FEN0, np.float32) * sample_ratio(litter_img, litter_mean, 6.0, TILES["oak_litter_tile"]["gain"], 1.0, WX, WY)
    t_marsh = np.array(MUD2, np.float32) * sample_ratio(scrub_img, scrub_mean, 6.0, TILES["wet_scrub_tile"]["gain"], SCRUB_TIER1, WX, WY)
    road_tone = 0.85 * np.array(MUD1, np.float32) + 0.15 * np.array(FEN0, np.float32)
    t_road = road_tone * sample_ratio(scree_img, scree_mean, 6.0, TILES["basalt_scree_tile"]["gain"], 1.0, WX, WY)

    col = t_open * (1 - grove[..., None]) + t_grove * grove[..., None]
    col = col * (1 - marsh[..., None]) + t_marsh * marsh[..., None]
    col = col * (1 - road[..., None]) + t_road * road[..., None]

    # Water. The spec's proxy is `(1 - R) x 0.55 x mud.3 + R x overcast.0`: the first
    # term is an ALBEDO (lit like any ground), the second a scene-referred
    # reflection that is NOT dimmed by the light. So the texture carries the wet
    # albedo, and the reflection goes out as a mask for an emission term.
    wet_albedo = (1 - WATER_R) * 0.55 * np.array(MUD3, np.float32)
    rim = smoothstep(0.38, 0.5, water) * (1 - smoothstep(0.5, 0.62, water))
    col = col * (1 - water_w[..., None]) + wet_albedo[None, None, :] * water_w[..., None]
    col = col * (1 - 0.35 * rim[..., None] * marsh_t[..., None])
    mask = np.clip(np.rint(water_w * 255.0), 0, 255).astype(np.uint8)
    return (
        np.clip(np.rint(col), 0, 255).astype(np.uint8),
        mask,
        dict(
            x0=cx0,
            y0=cy0,
            x1=cx1,
            y1=cy1,
            per_tile=per_tile,
            width_px=w,
            height_px=h,
            water_share_marsh=float(((water >= 0.5) & marsh_t).sum() / max(1, marsh_t.sum())),
            reflectance=WATER_R,
        ),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", required=True)
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-tile", type=int, default=192)
    ap.add_argument("--crop", default=None)
    args = ap.parse_args()
    d = json.load(open(args.window))
    window = {**d["window"], "rows": d["rows"], "water": d["water"]}
    crop = tuple(float(v) for v in args.crop.split(",")) if args.crop else None
    img, mask, meta = build(window, args.tiles, args.per_tile, crop)
    Image.fromarray(img, "RGB").save(args.out)
    Image.fromarray(mask, "L").save(os.path.splitext(args.out)[0] + "_water.png")
    json.dump(meta, open(os.path.splitext(args.out)[0] + ".json", "w"))
    print(args.out, img.shape, meta)


if __name__ == "__main__":
    main()
