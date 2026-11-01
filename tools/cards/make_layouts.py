#!/usr/bin/env python3
"""Store-card layouts end to end (GH-746 SC1): Blender stage, then the mask stage.

    python3 tools/cards/make_layouts.py --out <dir> [--team inf_squad] [--blender <bin>] [-- extra render_card_guide flags]

`pnpm cards:guide -- --out <dir>` is the same. 0 credits: headless Blender and numpy, no browser, no Meshy.
"""
import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = (os.environ.get("BLENDER_BIN", ""), "blender", "/Applications/Blender.app/Contents/MacOS/Blender")


def find_blender(explicit):
    for c in ((explicit,) if explicit else ()) + CANDIDATES:
        if not c:
            continue
        p = shutil.which(c) or (c if os.path.exists(c) else None)
        if p:
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--team", default="inf_squad")
    ap.add_argument("--blender", default="")
    args, extra = ap.parse_known_args()
    extra = [e for e in extra if e != "--"]
    blender = find_blender(args.blender)
    if not blender:
        sys.exit("no Blender binary found: set BLENDER_BIN or pass --blender")
    out = os.path.abspath(args.out)
    subprocess.run([blender, "-b", "-P", os.path.join(HERE, "render_card_guide.py"), "--", "--team", args.team, "--out", out, *extra], check=True)
    subprocess.run([sys.executable, os.path.join(HERE, "card_masks.py"), out], check=True)


if __name__ == "__main__":
    main()
