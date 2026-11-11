#!/usr/bin/env python3
"""The glove contrast check (GH-826 step 2), with a constructed failing input for each way it can go red. Plain python3.

    python3 tools/test_glove_contrast.py

The check is `validate_mesh_assets.check_glove_contrast`: the atlas sampled INSIDE the hand's faces (and the sleeve's, B3,
round 5) against the sleeve, the vest and the weapon (dE76 >= 15), the glove's L* in 30 to 48 and its C* at most 30. A failing input is the shipped
`inf_squad.glb` with the hand vertices' UVs rewritten, in the BYTES, to a texel of the atlas that breaks one rule, so the
reader, the sampler and the rule all have to work for it to go red:

  1. the sleeve's own texel      -> dE against the sleeve about 0
  2. today's orange claw colour  -> C* about 38 (the texel nearest Lab 42.1, 18.2, 33.0)
  3. Breach's black              -> L* about 12, and dE to the carbine under 15
  0. the face's skin (the lead, 9 Nov: dark brown, not skin) -> dE against the skin under 15

The lead's dark brown (9 Nov 2026, GH-746, B1: sRGB (70, 48, 32), GLOVE_BAKED_TONE: L* floor 20 and hue 40-75 for
inf_squad alone), each watched red on bytes:

  7. a PINK glove -- round 4's (34, 12, 3), sRGB (100, 73, 76), painted into the atlas -> red for its hue (5 deg);
  8. a BLACK glove -- sRGB (24, 20, 18), L* about 7, painted into the atlas -> red for its L*;
  9. the shipped glove (L* ~22) under another team's name -> red at that team's L* 30: the floor is inf_squad's;
     and the same bytes with `rl_hands.source` rewritten off "meshy" -> red: the entry dies with the baked figure;
 10. the shipped bytes with the hand-adjacent sleeve vertices' UVs rewritten to the glove's own texel (the whole cuff
     triangle painted glove, round 4's wedges) -> red for glove paint on the sleeve (B3: read inside the faces).
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


def write_patched(js, bin_, uv_xy, dst_dir, src=SHIPPED):
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
    with open(src, "rb") as fh:
        data = bytearray(fh.read())
    jlen = struct.unpack("<I", data[12:16])[0]
    bin_off = 20 + jlen + 8
    data[bin_off:bin_off + len(bin_)] = patched
    os.makedirs(dst_dir, exist_ok=True)
    with open(os.path.join(dst_dir, "inf_squad.glb"), "wb") as fh:
        fh.write(data)
    return dst_dir


def write_painted(js, bin_, rgb, dst_dir, block=(8, 8, 24)):
    """A copy of the shipped GLB whose atlas has a solid `rgb` block painted at (x, y, size) (re-encoded as PNG, the BIN
    chunk rebuilt) and whose hand-bone vertices' UVs point at its middle: a glove of exactly that colour."""
    atlas = atlas_of(js, bin_).copy()
    x0, y0, n = block
    atlas[y0:y0 + n, x0:x0 + n] = np.array(rgb, np.uint8)
    buf = io.BytesIO(); Image.fromarray(atlas).save(buf, "PNG"); png = buf.getvalue()
    js2 = json.loads(json.dumps(js))
    img = js2["images"][0]
    ib = img["bufferView"]
    bv = js2["bufferViews"][ib]
    off, old = bv.get("byteOffset", 0), bv["byteLength"]
    pad = (4 - len(png) % 4) % 4
    delta = len(png) + pad - old - ((4 - old % 4) % 4)
    new_bin = bytes(bin_[:off]) + png + b"\0" * pad + bytes(bin_[off + old + ((4 - old % 4) % 4):])
    bv["byteLength"] = len(png)
    img["mimeType"] = "image/png"
    for i, other in enumerate(js2["bufferViews"]):
        if i != ib and other.get("byteOffset", 0) > off:
            other["byteOffset"] = other["byteOffset"] + delta
    js2["buffers"][0]["byteLength"] = len(new_bin)
    d = write_glb(js2, new_bin, dst_dir)
    js3, bin3 = v._read_glb_chunks(os.path.join(d, "inf_squad.glb"))
    write_patched(js3, bin3, (x0 + n // 2, y0 + n // 2), dst_dir, src=os.path.join(d, "inf_squad.glb"))
    return dst_dir


def write_glb(js, bin_, dst_dir, name="inf_squad.glb"):
    """`js` + `bin_` written as a GLB at dst_dir/name."""
    j = json.dumps(js, separators=(",", ":")).encode()
    j += b" " * ((4 - len(j) % 4) % 4)
    b_ = bytes(bin_) + b"\0" * ((4 - len(bin_) % 4) % 4)
    out = (struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(j) + 8 + len(b_)) + struct.pack("<I4s", len(j), b"JSON") + j
           + struct.pack("<I4s", len(b_), b"BIN\0") + b_)
    os.makedirs(dst_dir, exist_ok=True)
    with open(os.path.join(dst_dir, name), "wb") as fh:
        fh.write(out)
    return dst_dir


def write_sleeve_painted(js, bin_, dst_dir):
    """A copy of the shipped GLB whose `uniform` vertices that share a face with a hand-weighted vertex but carry little
    hand weight themselves (under GLOVE_SPILL_HW: the sleeve side of each cuff triangle) have their UVs rewritten to the
    glove's own texel: every cuff triangle painted glove whole, as round 4 did (B3)."""
    nodes = js["nodes"]
    node = next(n for n in nodes if n.get("name") == "uniform")
    skin = js["skins"][node["skin"]]
    joints = [nodes[j]["name"] for j in skin["joints"]]
    prim = js["meshes"][node["mesh"]]["primitives"][0]
    jj = v._glb_accessor(js, bin_, prim["attributes"]["JOINTS_0"]).astype(int)
    ww = v._glb_accessor(js, bin_, prim["attributes"]["WEIGHTS_0"]).astype(float)
    idx = v._glb_accessor(js, bin_, prim["indices"]).reshape(-1, 3).astype(int)
    hand_j = [i for i, n in enumerate(joints) if "_hand_" in n or "_finger_" in n]
    hw = (ww * np.isin(jj, hand_j)).sum(1)
    faces = idx[(hw[idx] >= 0.5).any(1)]
    rows = sorted({int(i) for f in faces for i in f if hw[i] < v.GLOVE_SPILL_HW})
    assert len(rows) > 50, len(rows)
    # the glove's own texel, as the importer stamped it (`rl_hands.glove`, pixels of the atlas)
    gx, gy = js["scenes"][0]["extras"]["rl_hands"]["glove"]
    atlas = atlas_of(js, bin_)
    target = ((gx + 0.5) / atlas.shape[1], (gy + 0.5) / atlas.shape[0])
    acc = js["accessors"][prim["attributes"]["TEXCOORD_0"]]
    bv = js["bufferViews"][acc["bufferView"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or 8
    patched = bytearray(bin_)
    for i in rows:
        struct.pack_into("<ff", patched, base + i * stride, float(target[0]), float(target[1]))
    return write_glb(js, patched, dst_dir)


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
    # 7. a PINK glove (round 4's target), 8. a BLACK one: painted into the atlas, each red for its own rule
    for label, rgb, expect in (("a pink glove, sRGB (100, 73, 76)", (100, 73, 76), "hue"),
                               ("a black glove, sRGB (24, 20, 18)", (24, 20, 18), "L*")):
        d = tempfile.mkdtemp(prefix="glove_")
        try:
            write_painted(js, bin_, rgb, d)
            f, _ = v.check_glove_contrast(d)
            if not any(expect in line for line in f):
                bad.append(f"{label}: not red for {expect!r}: {f[:2]}")
        finally:
            shutil.rmtree(d, ignore_errors=True)
    # 9. the dark-brown floor is inf_squad's alone, and dies with its Meshy source
    d = tempfile.mkdtemp(prefix="glove_")
    try:
        shutil.copy(SHIPPED, os.path.join(d, "not_inf_squad.glb"))
        f, _ = v.check_glove_contrast(d)
        if not any("outside 30" in line for line in f):
            bad.append(f"the shipped dark brown under another team's name did not go red at L* 30: {f[:2]}")
        os.remove(os.path.join(d, "not_inf_squad.glb"))
        shutil.copy(SHIPPED, os.path.join(d, "inf_squad.glb"))
        with_source(os.path.join(d, "inf_squad.glb"), "hands-pass")
        f, _ = v.check_glove_contrast(d)
        if not any("delete the entry" in line for line in f):
            bad.append(f"rl_hands.source off 'meshy' did not refuse GLOVE_BAKED_TONE: {f[:2]}")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    # 10. glove paint up the sleeve (every cuff triangle painted whole, round 4's wedges)
    d = tempfile.mkdtemp(prefix="glove_")
    try:
        write_sleeve_painted(js, bin_, d)
        f, _ = v.check_glove_contrast(d)
        if not any("glove paint on the sleeve" in line for line in f):
            bad.append(f"the cuff triangles painted glove did not go red for the spill: {f[:2]}")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    if bad:
        print("FAIL")
        for b in bad:
            print("  " + b)
        sys.exit(1)
    print("ok: inf_squad passes; the face's skin, the sleeve texel, the orange claw, Breach's black, a pink glove, a black glove "
          "and glove paint up the sleeve each go red; the dark-brown L* floor and hue band are inf_squad's alone and die with "
          "its Meshy source")


if __name__ == "__main__":
    main()
