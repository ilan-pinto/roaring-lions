#!/usr/bin/env python3
"""The glove contrast check (GH-826 step 2), with a constructed failing input for each way it can go red. Plain python3.

    python3 tools/test_glove_contrast.py

The check is `validate_mesh_assets.check_glove_contrast`: the atlas sampled at every hand-bone vertex's UV against the sleeve,
the vest and the weapon (dE76 >= 15), the glove's L* in 30 to 48 and its C* at most 30. A failing input is the shipped
`inf_squad.glb` with the hand vertices' UVs rewritten, in the BYTES, to a texel of the atlas that breaks one rule, so the
reader, the sampler and the rule all have to work for it to go red:

  1. the sleeve's own texel      -> dE against the sleeve about 0
  2. today's orange claw colour  -> C* about 38 (the texel nearest Lab 42.1, 18.2, 33.0)
  3. Breach's black              -> L* about 12, and dE to the carbine under 15
"""
import io
import os
import shutil
import struct
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import validate_mesh_assets as v  # noqa: E402

REPO = os.path.dirname(HERE)
SHIPPED = os.path.join(REPO, "art", "meshes", "inf_squad.glb")


def atlas_of(js, bin_):
    img = js["images"][0]
    bv = js["bufferViews"][img["bufferView"]]
    raw = bin_[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
    return np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))


def nearest_texel(atlas, lab):
    """(x, y) of the solid texel nearest `lab`, searched on a 5-pixel grid so that it is a block and not an edge pixel."""
    best = None
    for y in range(2, atlas.shape[0] - 2, 5):
        for x in range(2, atlas.shape[1] - 2, 5):
            block = atlas[y - 2:y + 3, x - 2:x + 3].reshape(-1, 3).astype(float)
            if block.std(0).max() > 4:
                continue
            d = v._delta_e76(v._lab_of_rgb(block.mean(0)), lab)
            if best is None or d < best[0]:
                best = (d, x, y)
    return best[1], best[2]


def write_patched(js, bin_, uv_xy, dst_dir):
    """A copy of the shipped GLB whose hand-bone vertices (hand and finger bones, `uniform` primitive) have their UV
    rewritten to the texel `uv_xy` (pixels), returned as the directory holding it."""
    atlas = atlas_of(js, bin_)
    nodes = js["nodes"]
    node = next(n for n in nodes if n.get("name") == "uniform")
    skin = js["skins"][node["skin"]]
    joints = [nodes[j]["name"] for j in skin["joints"]]
    prim = js["meshes"][node["mesh"]]["primitives"][0]
    jj = v._glb_accessor(js, bin_, prim["attributes"]["JOINTS_0"]).astype(int)
    ww = v._glb_accessor(js, bin_, prim["attributes"]["WEIGHTS_0"]).astype(float)
    dom = jj[np.arange(len(jj)), ww.argmax(1)]
    rows = [i for i, k in enumerate(dom) if "_hand_" in joints[k] or "_finger_" in joints[k]]
    assert len(rows) > 200, len(rows)
    acc = js["accessors"][prim["attributes"]["TEXCOORD_0"]]
    bv = js["bufferViews"][acc["bufferView"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or 8
    patched = bytearray(bin_)
    u = (uv_xy[0] + 0.5) / atlas.shape[1]
    w = (uv_xy[1] + 0.5) / atlas.shape[0]
    for i in rows:
        struct.pack_into("<ff", patched, base + i * stride, u, w)
    # write the GLB back: JSON chunk unchanged, BIN chunk replaced
    with open(SHIPPED, "rb") as fh:
        data = bytearray(fh.read())
    jlen = struct.unpack("<I", data[12:16])[0]
    bin_off = 20 + jlen + 8
    data[bin_off:bin_off + len(bin_)] = patched
    os.makedirs(dst_dir, exist_ok=True)
    with open(os.path.join(dst_dir, "inf_squad.glb"), "wb") as fh:
        fh.write(data)
    return dst_dir


def main():
    bad = []
    js, bin_ = v._read_glb_chunks(SHIPPED)
    atlas = atlas_of(js, bin_)

    failures, lines = v.check_glove_contrast(os.path.dirname(SHIPPED))
    mine = [f for f in failures if f.startswith(os.path.join("art", "meshes", "inf_squad.glb"))]
    if mine:
        bad.append(f"the shipped inf_squad.glb fails its own gate: {mine[:2]}")
    if not any(line.startswith("inf_squad.glb") for line in lines):
        bad.append("the gate did not read inf_squad.glb at all (a gate that reads nothing passes everything)")

    sleeve = (339 + 2, 370 + 2)                                  # the sleeve's solid block (hands-pass.ts HANDS_TEAMS.sleeve.L)
    orange = nearest_texel(atlas, (42.1, 18.2, 33.0))            # the review's measured claw
    black = nearest_texel(atlas, (12.0, 0.0, 0.0))
    cases = [
        ("the sleeve's own texel", sleeve, "against the sleeve"),
        ("today's orange", orange, "C*"),
        ("Breach's black", black, "L*"),
    ]
    for label, xy, expect in cases:
        d = tempfile.mkdtemp(prefix="glove_")
        try:
            write_patched(js, bin_, xy, d)
            f, _ = v.check_glove_contrast(d)
            if not f:
                bad.append(f"{label}: the gate did not go red")
            elif not any(expect in line for line in f):
                bad.append(f"{label}: red, but not for {expect!r}: {f[:2]}")
        finally:
            shutil.rmtree(d, ignore_errors=True)
    if bad:
        print("FAIL")
        for b in bad:
            print("  " + b)
        sys.exit(1)
    print("ok: inf_squad passes; the sleeve texel, the orange claw and Breach's black each go red")


if __name__ == "__main__":
    main()
