"""Placed-decor triangle census for Ein Qasab (GH-871 P3), against the 0.9 M ceiling (spec 3, decision 11).

    python3 tools/terrain/wetland_census.py --dump window.json

`window.json` is written by tools/src/wetland_p3_dump.test.ts (its `variantCounts` is the whole
map). Triangles per placement are read from the shipped GLBs' accessors (the P2 stand-ins) and
from the P3 builders (reeds, wet grass); the Meshy trees are not made yet, so they are counted AT
THEIR CAPS (oak 2,500, willow 2,500, shrub 600), the worst case.
"""
import argparse
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

STAND_IN = {"oak": "cedar", "willow": "desert_tree", "shrub": "bush", "rock": "rock", "slab": "slab", "boulder": "boulder"}
CAPS = {"oak": 2500, "willow": 2500, "shrub": 600}
CEILING = 900_000


def glb_tris(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20 : 20 + n])
    return sum(j["accessors"][p["indices"]]["count"] // 3 for m in j["meshes"] for p in m["primitives"])


def tris(family, variant):
    import build_reeds, build_wet_grass

    if family == "reed":
        f, t = build_reeds.build(variant)
        return f.count + t.count
    if family == "wet_grass":
        f, t = build_wet_grass.build(variant)
        return f.count + t.count
    return glb_tris(os.path.join(REPO, "art", "meshes", "decor", f"{STAND_IN[family]}_{variant}.glb"))


def census(variant_counts, art):
    """art = 'p2' (every family a stand-in GLB) or 'p3' (new reeds and grass; trees at their caps)."""
    rows = {}
    for key, n in variant_counts.items():
        fam, v = key.rsplit("_", 1)
        v = int(v)
        if art == "p3" and fam in CAPS:
            t = CAPS[fam]
        elif art == "p2" and fam == "reed":
            t = glb_tris(os.path.join(REPO, "art", "meshes", "decor", f"bush_{v}.glb"))
        elif art == "p2" and fam == "wet_grass":
            t = glb_tris(os.path.join(REPO, "art", "meshes", "decor", f"grass_{v}.glb"))
        else:
            t = tris(fam, v)
        rows.setdefault(fam, [0, 0])
        rows[fam][0] += n
        rows[fam][1] += n * t
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    vc = json.load(open(a.dump))["variantCounts"]
    out = {}
    for art in ("p2", "p3"):
        rows = census(vc, art)
        total = sum(t for _, t in rows.values())
        out[art] = dict(rows=rows, total=total, ceiling=CEILING, share_of_ceiling=total / CEILING)
        print(f"{art}: {total:,} triangles ({total / CEILING * 100:.0f}% of the 0.9 M ceiling)")
        for fam, (n, t) in sorted(rows.items(), key=lambda kv: -kv[1][1]):
            print(f"   {fam:10s} {n:5d} placements  {t:9,d} tris")
    if a.json:
        json.dump(out, open(a.json, "w"), indent=2)


if __name__ == "__main__":
    main()
