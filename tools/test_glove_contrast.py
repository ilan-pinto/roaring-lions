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
  0. the face's skin (the lead, 9 Nov: dark brown, not skin) -> dE against the skin under 15

The relaxed sleeve floor (the lead, 9 Nov 2026: GLOVE_SLEEVE_FLOOR_BAKED, the Rifle Squad's baked Meshy glove only) is
held three more ways, each watched red:

  4. a glove texel 11-14 dE from the sleeve (every other rule kept) passes as inf_squad, and the SAME bytes under another
     team's name go red at 15: the relaxation is the one team's, not the gate's;
  5. the sleeve's own texel still goes red as inf_squad (case 1): the relaxed floor is a floor;
  6. the same bytes with `rl_hands.source` rewritten off "meshy" go red: the entry dies with the baked figure.
"""
import json
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


def sleeve_texel(js, bin_, atlas):
    """(x, y) of the solid block nearest the mean colour the gate reads as the sleeve (no atlas literal: the baked figure's
    atlas is not the old one)."""
    r = v.glove_contrast_reading(SHIPPED, js, bin_, atlas)
    return nearest_texel(atlas, sleeve_lab(js, bin_, atlas, r))


def sleeve_lab(js, bin_, atlas, reading):
    """The first hand's sleeve Lab, read as the gate reads it: the forearm skin within GLOVE_SLEEVE_REACH_M of the
    wrist."""
    nodes = js["nodes"]
    node = next(n for n in nodes if n.get("name") == "uniform")
    skin = js["skins"][node["skin"]]
    joints = [nodes[j]["name"] for j in skin["joints"]]
    ibm = v._glb_accessor(js, bin_, skin["inverseBindMatrices"]).reshape(-1, 16)
    prim = js["meshes"][node["mesh"]]["primitives"][0]
    pos = v._glb_accessor(js, bin_, prim["attributes"]["POSITION"]).astype(float)
    uv = v._glb_accessor(js, bin_, prim["attributes"]["TEXCOORD_0"]).astype(float)
    jj = v._glb_accessor(js, bin_, prim["attributes"]["JOINTS_0"]).astype(int)
    ww = v._glb_accessor(js, bin_, prim["attributes"]["WEIGHTS_0"]).astype(float)
    names = np.array([joints[k] for k in jj[np.arange(len(jj)), ww.argmax(1)]])
    key = sorted(reading)[0]
    fig, side = key[:-2], key[-1]

    def head(j):
        m = ibm[joints.index(j)].reshape(4, 4).T
        return -(m[:3, :3].T @ m[:3, 3])
    wrist, elbow = head(f"{fig}_hand_{side}"), head(f"{fig}_forearm_{side}")
    axis = (wrist - elbow) / np.linalg.norm(wrist - elbow)
    t = (pos - wrist) @ axis
    m = (names == f"{fig}_forearm_{side}") & (t > -v.GLOVE_SLEEVE_REACH_M) & (t <= 0.0)
    ah, aw = atlas.shape[:2]
    px = np.clip((uv[m, 0] * aw).astype(int), 0, aw - 1)
    py = np.clip((uv[m, 1] * ah).astype(int), 0, ah - 1)
    return v._lab_of_rgb(atlas[py, px].astype(float).mean(0))


def near_sleeve_texel(js, bin_, atlas, lo, hi):
    """Solid blocks (x, y) whose Lab is `lo`..`hi` dE from the first hand's sleeve, inside the L* band and under the C*
    ceiling; the caller keeps the first that every other rule (vest, weapon) also passes: the input only the sleeve floor
    can judge."""
    reading = v.glove_contrast_reading(SHIPPED, js, bin_, atlas)
    sl = sleeve_lab(js, bin_, atlas, reading)
    out = []
    for y in range(2, atlas.shape[0] - 2, 5):
        for x in range(2, atlas.shape[1] - 2, 5):
            block = atlas[y - 2:y + 3, x - 2:x + 3].reshape(-1, 3).astype(float)
            if block.std(0).max() > 4:
                continue
            lab = v._lab_of_rgb(block.mean(0))
            if not (lo <= v._delta_e76(lab, sl) <= hi):
                continue
            if not (v.GLOVE_L_BAND[0] + 1 <= lab[0] <= v.GLOVE_L_BAND[1] - 1) or (lab[1] ** 2 + lab[2] ** 2) ** 0.5 > v.GLOVE_MAX_CHROMA - 1:
                continue
            out.append((x, y))
    return out


def with_source(path, source):
    """Rewrite `rl_hands.source` in the JSON chunk of the GLB at `path`, in place."""
    with open(path, "rb") as fh:
        data = fh.read()
    jlen = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + jlen])
    js["scenes"][0]["extras"]["rl_hands"]["source"] = source
    j = json.dumps(js, separators=(",", ":")).encode()
    j += b" " * ((4 - len(j) % 4) % 4)
    rest = data[20 + jlen:]
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(j) + len(rest)) + struct.pack("<I4s", len(j), b"JSON") + j + rest
    with open(path, "wb") as fh:
        fh.write(out)


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

    sleeve = sleeve_texel(js, bin_, atlas)                       # the solid block nearest what the gate reads as the sleeve
    orange = nearest_texel(atlas, (42.1, 18.2, 33.0))            # the review's measured claw
    black = nearest_texel(atlas, (12.0, 0.0, 0.0))
    skin = nearest_texel(atlas, (40.0, 16.0, 20.0))                # the face's mean skin (Lab 40, 16, 20 on the Meshy squad)
    cases = [
        # the lead, 9 Nov: a glove is "dark brown", never the face's own colour (round 3's dusky rose read 11.4 from it)
        ("the face's skin texel", skin, "against the skin"),
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
    # 4. between the relaxed floor and 15: green as inf_squad, red as anyone else; 6. red once the file is not Meshy's
    floor = v.GLOVE_SLEEVE_FLOOR_BAKED["inf_squad"]
    found = False
    for xy in near_sleeve_texel(js, bin_, atlas, floor + 1.0, v.GLOVE_MIN_DE - 1.0):
        d = tempfile.mkdtemp(prefix="glove_")
        try:
            write_patched(js, bin_, xy, d)
            f, _ = v.check_glove_contrast(d)
            if f:
                continue           # some other rule (vest / weapon) reads this texel: try the next
            found = True
            shutil.move(os.path.join(d, "inf_squad.glb"), os.path.join(d, "not_inf_squad.glb"))
            f, _ = v.check_glove_contrast(d)
            if not any("against the sleeve, under 15" in line for line in f):
                bad.append(f"a glove {floor + 1:g}-{v.GLOVE_MIN_DE - 1:g} dE from the sleeve did not go red under another team's name: {f[:2]}")
            shutil.move(os.path.join(d, "not_inf_squad.glb"), os.path.join(d, "inf_squad.glb"))
            with_source(os.path.join(d, "inf_squad.glb"), "hands-pass")
            f, _ = v.check_glove_contrast(d)
            if not any("delete the entry" in line for line in f):
                bad.append(f"rl_hands.source off 'meshy' did not refuse the relaxed floor: {f[:2]}")
            break
        finally:
            shutil.rmtree(d, ignore_errors=True)
    if not found:
        bad.append("no atlas texel sits between the relaxed sleeve floor and 15 with every other rule kept: case 4 never ran")
    if bad:
        print("FAIL")
        for b in bad:
            print("  " + b)
        sys.exit(1)
    print("ok: inf_squad passes; the face's skin, the sleeve texel, the orange claw and Breach's black each go red; the relaxed sleeve "
          "floor is inf_squad's alone and dies with its Meshy source")


if __name__ == "__main__":
    main()
