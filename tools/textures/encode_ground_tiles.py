"""Encode the ground tiles that ship: art/textures/*.png -> assets/textures/*.jpg.

    python3 tools/textures/encode_ground_tiles.py

The six 1024^2 tiles are opaque photographic noise; stored losslessly they
were 2.2-2.5 MB each and the four a map fetches were 9.4 MiB of a 115 MiB
level (docs/superpowers/specs/2026-09-07-level-load-time-design.md, step 2).
JPEG q90 with NO chroma subsampling (4:4:4 -- a tile is sampled at every
zoom and subsampled chroma smears on a repeat seam) reads 490-680 KB each,
measured on all six; q85 saves another 20% and q95 costs 40% more for
nothing this camera can show. The PNG in art/textures/ is the source of
record (the image the lead fed to Meshy, the one that measured seamless --
see CLAUDE.md, "For a texture, the image fed to Meshy is the asset"); this
script is how the shipped file is reproduced from it. Deterministic: same
PNG in, same bytes out.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(REPO, "art", "textures")
OUT = os.path.join(REPO, "assets", "textures")
QUALITY = 90


def main() -> int:
    names = sorted(n for n in os.listdir(SRC) if n.endswith(".png"))
    if not names:
        print(f"no PNG tiles under {SRC}", file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        src = os.path.join(SRC, name)
        dst = os.path.join(OUT, name[:-4] + ".jpg")
        im = Image.open(src)
        if im.mode not in ("RGB", "L"):
            print(f"{name}: mode {im.mode} -- ground tiles are opaque, refusing to drop a channel silently", file=sys.stderr)
            return 1
        im.convert("RGB").save(dst, "JPEG", quality=QUALITY, subsampling=0, optimize=True)
        print(f"{name} {os.path.getsize(src) / 1048576:.2f} MiB -> {os.path.basename(dst)} {os.path.getsize(dst) / 1024:.0f} KiB (q{QUALITY}, 4:4:4)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
