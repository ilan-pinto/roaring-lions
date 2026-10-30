"""The wetland's spring-flush sward tuft, `wet_grass_0/1/2` (GH-871 P3).
Procedural, 0 Meshy credits.

    blender -b --factory-startup -P tools/terrain/build_wet_grass.py -- \\
        --blend-dir art/src/terrain/wetland [--report out.json]

or, for the counts alone, in plain Python:

    python3 tools/terrain/build_wet_grass.py

The numbers are the lead's, approved 28 Oct (`art-numbers.md` row 5):

  * at most 0.40 m tall, the same as the shipped grass (N-4: grass is drawn at
    most 0.36 m after `GRASS_SCALE_MAX` 0.9, so it never hides a unit). "Lusher"
    is blade count and blade width, never height;
  * a tuft 0.5 m wide (the shipped grass is 0.4);
  * at most 200 triangles a variant (the shipped grass ships 142-168);
  * `foliage` is tinted `grass.3`.

## The geometry

A true 3D tuft: 56 green blades and 10 straw blades from last year, each a thin
three-sided cone of 3 triangles (`wetland_kit.py`: a card would vanish under the
decor material's `FrontSide`), so 66 blades is 198 triangles. Blades stand in a
disc 0.24 m across and lean outward, more the farther from the heart, so the
middle is tall and upright and the rim floppy; the heart is the tallest.

## One proposal for the lead: the straw in the `trunk` role

The sheet's 15% straw blades only show if they are not the tuft's colour, and a
`decorColors` tint is one tone per family and role. Putting the straw blades in
the `trunk` role lets them draw the role's own untinted tone (`dust.4`, a dry
straw) with no new tint and no new draw call (the `trunk` batch exists wherever
a tree does). The alternative is all 66 in `foliage` (identical geometry, the
straw the same green as the rest). `--straw-role foliage` builds that.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from wetland_kit import Stream, TriSoup, dir_from  # noqa: E402

CAP = 200
MAX_HEIGHT = 0.40
HALF_WIDTH = 0.25  # a 0.5 m tuft
GREEN = 56
STRAW = 10

VARIANTS = {
    # seed, tallest, spread of bases, extra lean
    0: dict(seed=7401, tall=0.40, base_r=0.12, lean=1.10),
    1: dict(seed=7503, tall=0.38, base_r=0.15, lean=1.25),
    2: dict(seed=7607, tall=0.40, base_r=0.09, lean=0.95),
}


def _blade(soup, s, p, tall_scale, radius, straw=False, heart=False):
    r = 0.0 if heart else p["base_r"] * math.sqrt(s.u())
    a = s.u() * 2.0 * math.pi
    bx, by = r * math.cos(a), r * math.sin(a)
    rn = r / p["base_r"]
    lean = math.radians((5.0 + 33.0 * rn + s.sym(6.0)) * p["lean"]) if not straw else math.radians(s.span(10.0, 30.0))
    # Tip height: tall at the heart, shorter at the rim, never above the cap.
    z = p["tall"] * tall_scale * (1.0 - 0.50 * rn**1.1) * s.span(0.80, 1.0)
    if heart:
        lean, z = math.radians(3.0), p["tall"]
    z = max(0.10, min(MAX_HEIGHT, z))
    length = z / max(0.2, math.cos(lean))
    # Keep the tip inside the 0.5 m tuft.
    for _ in range(30):
        reach = math.hypot(bx + math.sin(lean) * length * math.cos(a), by + math.sin(lean) * length * math.sin(a))
        if reach <= HALF_WIDTH:
            break
        length *= 0.94
    soup.cone((bx, by, 0.0), dir_from(a, math.pi / 2 - lean), length, radius, flat_base=True, phase=s.u() * 6.28)


def build(variant, straw_role="trunk"):
    """`(foliage_soup, trunk_soup)`; with `straw_role='foliage'` the straw blades
    join the foliage and the trunk soup is empty."""
    p = VARIANTS[variant]
    s = Stream(p["seed"])
    foliage, trunk = TriSoup(), TriSoup()
    for k in range(GREEN):
        _blade(foliage, s, p, 1.0, 0.013, heart=(k == 0))
    straw = trunk if straw_role == "trunk" else foliage
    for _ in range(STRAW):
        _blade(straw, s, p, 0.9, 0.010, straw=True)
    total = foliage.count + trunk.count
    assert total <= CAP, f"wet_grass_{variant}: {total} triangles, cap {CAP}"
    return foliage, trunk


def measure(foliage, trunk):
    both = TriSoup()
    both.merge(foliage)
    both.merge(trunk)
    (x0, y0, z0), (x1, y1, z1) = both.bounds()
    return {
        "tris": both.count,
        "foliage_tris": foliage.count,
        "trunk_tris": trunk.count,
        "height_m": z1,
        "lowest_z_m": z0,
        "extent_x_m": x1 - x0,
        "extent_y_m": y1 - y0,
    }


def main():
    import argparse

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend-dir", default=None)
    ap.add_argument("--report", default=None)
    ap.add_argument("--straw-role", default="trunk", choices=["trunk", "foliage"])
    args = ap.parse_args(argv)

    report = {}
    for v in sorted(VARIANTS):
        foliage, trunk = build(v, args.straw_role)
        m = measure(foliage, trunk)
        report[f"wet_grass_{v}"] = m
        print(
            f"wet_grass_{v}: {m['tris']} tris (foliage {m['foliage_tris']}, trunk {m['trunk_tris']}), "
            f"height {m['height_m']:.3f} m, width {max(m['extent_x_m'], m['extent_y_m']):.3f} m, lowest z {m['lowest_z_m']:+.4f}"
        )
        if args.blend_dir:
            save_blend(v, foliage, trunk, args.blend_dir)
    if args.report:
        with open(args.report, "w") as fh:
            json.dump(report, fh, indent=2)


def save_blend(variant, foliage, trunk, out_dir):
    import bpy
    from wetland_kit import to_object

    bpy.ops.wm.read_factory_settings(use_empty=True)
    f = to_object("foliage", foliage)
    f["rl_role"] = "foliage"
    if trunk.count:
        t = to_object("trunk", trunk)
        t["rl_role"] = "trunk"
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"wet_grass_{variant}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
