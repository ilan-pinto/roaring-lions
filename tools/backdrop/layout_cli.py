"""`pnpm backdrop:layout -- --map=<id> [--write]`: the explicit piece list of a map's `backdrop` block.

Lane B (GH-161). Kit-spec section 2: the runtime never seeds a placement. This tool runs the slot grammar of
`layout.py` for a map and prints (or, with `--write`, commits into `data/maps/<id>.json`) the `backdrop`
block: `valley`, `crest`, `seed`, `kit` and `pieces` (`id`, `at` in map tiles, `rot`, `mirror`, `ys`, and
`lift`, in tiles, where a piece does not stand on the floor). A person then hand-edits the list; nothing regenerates it
behind their back (a second `--write` overwrites it, which is why that is a flag and not the default).

Only a valley that runs north-south (`ns`) has a grammar so far. The block's `y` pairs of the render-2 mock are
not written: the runtime bakes the height of every vertex from the floor at load, so the kit meets the rim with
no seam.

    python3 tools/backdrop/layout_cli.py --map=wadi_halam_4             # print the block
    python3 tools/backdrop/layout_cli.py --map=wadi_halam_4 --write     # put it in the map file
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import kitlib as K  # noqa: E402
import layout as L  # noqa: E402
import pieces as P  # noqa: E402

KIT_ID = "wadi_halam_kit"


def tidy(v):
    """Whole floats print as ints: `[0.0, 76.0]` -> `[0, 76]`."""
    if isinstance(v, float) and v == int(v):
        return int(v)
    if isinstance(v, list):
        return [tidy(x) for x in v]
    return v


def build_block(w, h, valley="ns", crest=48, seed=7):
    if valley != "ns":
        raise SystemExit("backdrop:layout: only an 'ns' valley has a slot grammar so far (got %r)" % valley)
    pr = P.PROFILE
    profile = lambda d: float(np.interp(d, pr.d, pr.y))  # noqa: E731
    pieces = L.layout_ns(w, h, seed=seed, profile=profile, corner_lifts=L.corner_terrace_lifts())
    out = []
    for pl in pieces:
        row = {"id": pl["id"], "at": tidy(pl["at"]), "rot": pl["rot"]}
        if pl["mirror"]:
            row["mirror"] = True
        if abs(pl["ys"] - 1.0) > 1e-9:
            row["ys"] = pl["ys"]
        if pl.get("lift"):
            # the layout works in metres (the kit's authoring unit); the map file, like `at`, in tiles
            row["lift"] = round(pl["lift"] / K.M_PER_TILE, 3)
        out.append(row)
    return {"valley": valley, "crest": crest, "seed": seed, "kit": KIT_ID, "pieces": out}


def main():
    argv = [a for a in sys.argv[1:] if a != "--"]
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    path = os.path.join(K.REPO, "data", "maps", args.map + ".json")
    with open(path) as fh:
        text = fh.read()
    m = json.loads(text)
    old = m.get("backdrop") or {}
    block = build_block(m["width"], m["height"], old.get("valley", "ns"), old.get("crest", 48), old.get("seed", 7))
    if not args.write:
        print(json.dumps(block, indent=2))
        return
    # keep the file's key order: the block goes after `terrain`/`grove` (or where it already was)
    new = {}
    placed = False
    for k, v in m.items():
        if k == "backdrop":
            new[k] = block
            placed = True
        else:
            new[k] = v
        if not placed and k in ("terrain", "grove") and "backdrop" not in m:
            new["backdrop"] = block
            placed = True
    if not placed:
        new["backdrop"] = block
    with open(path, "w") as fh:
        fh.write(json.dumps(new, indent=2) + "\n")
    print("wrote %d pieces into %s" % (len(block["pieces"]), os.path.relpath(path, K.REPO)))


if __name__ == "__main__":
    main()
