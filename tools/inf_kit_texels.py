#!/usr/bin/env python3
"""Pin the infantry kit's five tones to texels of a team's OWN atlas (GH-826, seven-teams spec section 3).

    python3 tools/inf_kit_texels.py <team> [--block 5] [--std 4] [--json out.json]

Plain python3 (numpy, scipy, PIL): no Blender. Reads the SHIPPED `art/meshes/<team>.glb`, pulls its
baked colour atlas, and for each of the five palette keys the kit uses (`dust.5` coyote, `dust.6`
coyote shade, `olive.2` olive, `olive.3` olive dark, `shadow.0` glass) finds the block x block window
whose per-channel std is below `std`/255 and whose mean is nearest the key in CIE76 dE.

Ruling (GH-826, 30 Oct): a 5 x 5 block (std < 4/255) instead of 9 x 9, because a pinned-UV face has
zero UV derivatives, so it samples mip 0 and the bilinear read touches a 2 x 2 neighbourhood: the
block keeps 1.5 px of margin on every side. The key itself must be within dE 2.4; where no block is,
the NEAREST same-family texel is used, capped at dE 6 and hue +-20 deg, and PRINTED as a DEVIATION.
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = {"coyote": ("dust", 5), "coyote_shade": ("dust", 6), "olive": ("olive", 2),
        "olive_dark": ("olive", 3), "glass": ("shadow", 0)}
DE_OK = 2.4
DE_CAP = 6.0
HUE_CAP = 20.0


def palette_hex(ramp, idx):
    with open(os.path.join(REPO, "data", "palette.json")) as fh:
        pal = json.load(fh)
    h = pal["ramps"][ramp]["colors"][idx].lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def atlas_of(team):
    """The RGB atlas image of a team GLB (first image of the file)."""
    import io
    with open(os.path.join(REPO, "art", "meshes", f"{team}.glb"), "rb") as fh:
        data = fh.read()
    jlen, _ = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, _ = struct.unpack("<II", data[off:off + 8])
    binchunk = data[off + 8:off + 8 + blen]
    img = gltf["images"][0]
    bv = gltf["bufferViews"][img["bufferView"]]
    raw = binchunk[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
    return np.array(Image.open(io.BytesIO(raw)).convert("RGB")).astype(float)


def srgb_to_lab(rgb):
    c = np.asarray(rgb, float) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def hue_deg(lab):
    return float(np.degrees(np.arctan2(lab[..., 2], lab[..., 1])))


def search(team, block=5, std=4.0):
    atlas = atlas_of(team)
    h, w, _ = atlas.shape
    mean = np.stack([uniform_filter(atlas[..., c], block, mode="nearest") for c in range(3)], axis=-1)
    sq = np.stack([uniform_filter(atlas[..., c] ** 2, block, mode="nearest") for c in range(3)], axis=-1)
    sd = np.sqrt(np.maximum(sq - mean ** 2, 0.0))
    solid = (sd.max(-1) < std)
    pad = block // 2 + 1                       # the block and its 1 px bilinear margin stay inside the image
    solid[:pad] = solid[-pad:] = False
    solid[:, :pad] = solid[:, -pad:] = False
    lab = srgb_to_lab(mean)
    out = {}
    for name, (ramp, idx) in KEYS.items():
        key = palette_hex(ramp, idx)
        klab = srgb_to_lab(key)
        de = np.linalg.norm(lab - klab, axis=-1)
        de[~solid] = 1e9
        # ties (a flat region) resolve to the first in raster order: deterministic
        j = int(np.argmin(de))
        y, x = divmod(j, w)
        rgb = mean[y, x]
        out[name] = {"key": f"{ramp}.{idx}", "key_rgb": [int(v) for v in key], "texel": [int(x), int(y)],
                     "texel_rgb": [int(round(v)) for v in rgb], "std": round(float(sd[y, x].max()), 2),
                     "dE76": round(float(de[y, x]), 2),
                     "dL": round(float(lab[y, x, 0] - klab[0]), 2),
                     "dHue_deg": round(((hue_deg(lab[y, x]) - hue_deg(klab) + 180) % 360) - 180, 1),
                     "luminance": round(float(rgb @ np.array([0.2126, 0.7152, 0.0722])), 1)}
        out[name]["deviation"] = out[name]["dE76"] > DE_OK
        out[name]["within_cap"] = out[name]["dE76"] <= DE_CAP and abs(out[name]["dHue_deg"]) <= HUE_CAP
    return out


def main():
    team = sys.argv[1]
    block, std, jpath = 5, 4.0, None
    for i, a in enumerate(sys.argv):
        if a == "--block":
            block = int(sys.argv[i + 1])
        if a == "--std":
            std = float(sys.argv[i + 1])
        if a == "--json":
            jpath = sys.argv[i + 1]
    res = search(team, block, std)
    print(f"{team}: {block} x {block} solid block, per-channel std < {std}/255, dE76 <= {DE_OK} or DEVIATION (cap dE {DE_CAP}, hue +-{HUE_CAP})")
    for name, r in res.items():
        tag = "DEVIATION" if r["deviation"] else "ok"
        if r["deviation"] and not r["within_cap"]:
            tag = "DEVIATION OVER THE CAP"
        print(f"  {name:<13}{r['key']:<9}key {tuple(r['key_rgb'])!s:<16}texel {tuple(r['texel'])!s:<12}rgb {tuple(r['texel_rgb'])!s:<16}"
              f"dE {r['dE76']:5.2f}  dL {r['dL']:+5.2f}  dHue {r['dHue_deg']:+5.1f}  std {r['std']:4.2f}  lum {r['luminance']:5.1f}  {tag}")
    if jpath:
        with open(jpath, "w") as fh:
            json.dump({"team": team, "block": block, "std": std, "texels": res}, fh, indent=1)


if __name__ == "__main__":
    main()
