"""Fix round 1, item 7: one side-by-side comparison image for the lead's
sign-off on the weld-then-decimate method (D8) and the whole-tree footprint
shift item 1 found.

Plain `python3` (NOT Blender's bundled interpreter, which has no PIL/Pillow --
confirmed by hand: `blender --background --python-expr "import PIL"` raises
`ModuleNotFoundError`), run AFTER `tools/terrain/preview_trees.py` has written
its zoom4 renders:

    python3 tools/terrain/preview_trees.py    # (via Blender, see that file's own header)
    python3 tools/terrain/compose_tree_compare.py

Reads `tree_{0,1}_{before,after}_zoom4.png` from
`.superpowers/ground2/trees-preview/` (git-ignored, not shipped) and writes a
single labelled 2x2 grid, `.../trees-preview/compare.png` -- tree_0 on the
left, tree_1 on the right, before on top, after on the bottom, so the
trunk/foliage colour boundary (green foliage, brown trunk -- see
`preview_trees.py`'s own debug materials) is visible at the same crop and
zoom in all four panels.
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PREVIEW = os.path.join(REPO, ".superpowers", "ground2", "trees-preview")

LABEL_H = 28
PAD = 6


def _panel(path, label):
    im = Image.open(path).convert("RGBA")
    canvas = Image.new("RGBA", (im.width, im.height + LABEL_H), (255, 255, 255, 255))
    canvas.paste(im, (0, LABEL_H))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, 0, im.width, LABEL_H], fill=(20, 20, 20, 255))
    font = ImageFont.load_default()
    draw.text((PAD, PAD), label, fill=(255, 255, 255, 255), font=font)
    return canvas


def main():
    cells = [
        ("tree_0_before_zoom4.png", "tree_0 -- BEFORE (13,383 tris)"),
        ("tree_1_before_zoom4.png", "tree_1 -- BEFORE (13,383 tris)"),
        ("tree_0_after_zoom4.png", "tree_0 -- AFTER (2,998 tris)"),
        ("tree_1_after_zoom4.png", "tree_1 -- AFTER (2,999 tris)"),
    ]
    panels = []
    for name, label in cells:
        path = os.path.join(PREVIEW, name)
        if not os.path.exists(path):
            raise SystemExit(f"missing {path} -- run tools/terrain/preview_trees.py first")
        panels.append(_panel(path, label))

    w = max(p.width for p in panels)
    h = max(p.height for p in panels)
    grid = Image.new("RGBA", (w * 2 + PAD, h * 2 + PAD), (255, 255, 255, 255))
    grid.paste(panels[0], (0, 0))
    grid.paste(panels[1], (w + PAD, 0))
    grid.paste(panels[2], (0, h + PAD))
    grid.paste(panels[3], (w + PAD, h + PAD))

    out_path = os.path.join(PREVIEW, "compare.png")
    grid.convert("RGB").save(out_path)
    print(f"wrote {out_path} ({grid.width}x{grid.height})")


if __name__ == "__main__":
    main()
