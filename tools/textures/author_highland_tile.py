"""Author the Sur highland's open-ground albedo (GH-322, "V2").

    python3 tools/textures/author_highland_tile.py "<repo>/art/blend/terrain tiles /Meshy_AI_image_rock.png"
    python3 tools/textures/encode_ground_tiles.py

Source: the supplied `Meshy_AI_image_rock.png` (1024^2, broken limestone
chips with thin earth between -- the image the lead fed to Meshy, unused
until GH-322; `art/blend/` is gitignored like every supplied Meshy source,
md5 ccd28b05894a57bb5c9f8483981372ad). Output: `art/textures/
highland_v2_tile.png`, the tracked source of record that
`encode_ground_tiles.py` turns into the shipped JPEG. No Meshy call, 0 credits.

The lead's pick (1 Oct, "ground V2"): brown terra rossa earth DOMINANT
between grey limestone chips. The image carries the two materials itself,
because the ground shader is a RATIO form (texel / mean): it keeps each
texel's per-channel hue relative to the mean, so chips stay grey and earth
stays red-brown while `tones.open` sets only the average.

  1. Luminance, Gaussian-blurred (sigma 3 px, wrapped so the tile stays
     seamless) separates chips (bright) from the earth between them (dark).
     A smoothstep between 0.608 and 0.743 of full scale is the earth weight;
     47% of the area lands on the earth side.
  2. Earth: 95% terra rossa (140, 84, 54) scaled by the texel's own
     luminance / 174.07, 5% the source -- the source's shading survives.
  3. Chips: 40% a warm neutral grey (luminance x (0.981, 0.963, 0.934)),
     60% the source.

The constants were fitted to the approved mock tile (least squares over all
1,048,576 texels, RMS 5.8 per channel against a q90 JPEG; mean rgb within
0.2 of it), because the mock's own one-off script was not kept. Deterministic:
same PNG in, same bytes out.
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "art", "textures", "highland_v2_tile.png")
EXPECTED_MD5 = "ccd28b05894a57bb5c9f8483981372ad"

SIGMA = 3.0
EARTH_LO, EARTH_HI = 0.608, 0.743
TERRA_ROSSA = np.array([140.0, 84.0, 54.0])
EARTH_WEIGHT, EARTH_LREF = 0.95, 174.07
CHIP_WEIGHT = 0.4
CHIP_GREY = np.array([0.981, 0.963, 0.934])


def author(src: np.ndarray) -> np.ndarray:
    lum = src @ np.array([0.299, 0.587, 0.114])
    blurred = gaussian_filter(lum / 255.0, SIGMA, mode="wrap")
    t = np.clip((blurred - EARTH_LO) / (EARTH_HI - EARTH_LO), 0.0, 1.0)
    earth = 1.0 - t * t * (3.0 - 2.0 * t)
    earth_rgb = EARTH_WEIGHT * TERRA_ROSSA[None, None, :] * (lum / EARTH_LREF)[..., None] + (1.0 - EARTH_WEIGHT) * src
    chip_rgb = CHIP_WEIGHT * lum[..., None] * CHIP_GREY[None, None, :] + (1.0 - CHIP_WEIGHT) * src
    out = earth[..., None] * earth_rgb + (1.0 - earth[..., None]) * chip_rgb
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = sys.argv[1]
    import hashlib

    with open(path, "rb") as fh:
        digest = hashlib.md5(fh.read()).hexdigest()
    if digest != EXPECTED_MD5:
        print(f"{path}: md5 {digest}, expected {EXPECTED_MD5} -- not the supplied rock tile", file=sys.stderr)
        return 1
    src = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    out = author(src)
    Image.fromarray(out, "RGB").save(OUT, "PNG", optimize=True)
    mean = out.reshape(-1, 3).mean(axis=0)
    print(f"{os.path.relpath(OUT, REPO)}: {out.shape[1]}x{out.shape[0]}, mean rgb {mean[0]:.1f} / {mean[1]:.1f} / {mean[2]:.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
