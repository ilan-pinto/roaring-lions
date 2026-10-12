#!/usr/bin/env python3
"""Paint `bake_fix`'s metal patch into a SHIPPED vehicle GLB's own images --
for a vehicle whose Meshy remesh source is no longer on disk and cannot be
re-exported (A3.2 phase 2, 2026-10-11: `ifv_namer`, whose B8 v2 remesh
download is gitignored and past Meshy's three-day retention).

    python3 tools/vehicles/patch_metal_glb.py art/meshes/vehicles/ifv_namer.glb

Byte-level, no Blender: the GLB's JSON chunk is parsed, every live (non
`WRECK_`, non `kit_`) textured primitive's UV triangles are rasterised onto
the base colour's grid to find the first empty 8-aligned 32x32 block with a
4-texel guard (`bake_fix.find_patch_block`, the same rule the exporters
use), the three images are decoded, painted (`bake_fix.paint_patch_arrays`:
gunmetal.2 base colour, neutral normal, metallic 1.0 / roughness 0.6) and
re-encoded as JPEG at `textured.JPEG_QUALITY`, and the BIN chunk is
rebuilt with every bufferView re-laid in its original order and 4-byte
padded. Geometry accessors are copied byte-for-byte. A second run finds the
same block (scan order) and repaints the same texels; the only drift is one
more JPEG generation, which is why the provenance records the run.

    python3 tools/vehicles/patch_metal_glb.py --metallic-only art/meshes/vehicles/<id>.glb

(GH-238 leftovers, 2026-10-12) rewrites ONLY the patch's `metallic_roughness`
texels to `bake_fix.METAL_METALLIC` / `METAL_ROUGHNESS` on a file that already
carries the patch: the block is found by its COLOUR (the one 8-aligned square
off every live face whose `base_color` is gunmetal.2 within `PATCH_TOL` a
channel -- the exporters placed it against their pre-split source, so the
first-hole rule need not find it), and only
the `metallic_roughness` image is re-encoded -- `base_color` and `normal` are
copied byte for byte. `kit_*` nodes are left out of the atlas mask (their UVs
are PINNED inside the patch, so counting them would move the block).
"""
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bake_fix  # noqa: E402

#: `tools/vehicles/textured.py::JPEG_QUALITY`, which imports bpy and so cannot
#: be imported here; the same 85 every shipped bake was re-encoded at.
JPEG_QUALITY = 85

CT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _read(path):
    d = open(path, "rb").read()
    if d[:4] != b"glTF":
        raise SystemExit(f"{path}: not a GLB")
    ln = struct.unpack_from("<I", d, 12)[0]
    j = json.loads(d[20:20 + ln])
    bl, bt = struct.unpack_from("<II", d, 20 + ln)
    if bt != 0x004E4942:
        raise SystemExit(f"{path}: second chunk is not BIN")
    return j, d[28 + ln:28 + ln + bl]


def _accessor(j, b, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    fmt, sz = CT[a["componentType"]]
    n = NC[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", sz * n)
    if stride == sz * n:
        return np.frombuffer(b, dtype=np.dtype("<" + fmt), count=a["count"] * n, offset=off).reshape(a["count"], n)
    out = np.zeros((a["count"], n))
    for k in range(a["count"]):
        out[k] = struct.unpack_from("<" + fmt * n, b, off + k * stride)
    return out


def _view_bytes(j, b, idx):
    bv = j["bufferViews"][idx]
    off = bv.get("byteOffset", 0)
    return b[off:off + bv["byteLength"]]


def _image_name(j, idx):
    img = j["images"][idx]
    name = img.get("name") or ""
    for key in ("base_color", "normal", "metallic_roughness"):
        if key in name:
            return key
    raise SystemExit(f"image {idx} {name!r}: not one of base_color / normal / metallic_roughness")


#: Largest per-channel byte difference from gunmetal.2 a texel of an existing
#: patch's INTERIOR may show in the decoded JPEG (8 measured on the Kipod).
PATCH_TOL = 12


def patch(path, metallic_only=False):
    j, b = _read(path)
    mat = j["materials"][0]
    base_idx = j["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]["source"]
    images = {}
    for idx, img in enumerate(j["images"]):
        images[idx] = np.array(Image.open(io.BytesIO(_view_bytes(j, b, img["bufferView"]))).convert("RGB"))
    h, w = images[base_idx].shape[:2]
    mask = np.zeros((h, w), dtype=bool)
    tris = 0
    for node in j["nodes"]:
        if "mesh" not in node:
            continue
        name = node.get("name", "")
        if name.startswith("WRECK_"):
            continue            # the same meshes as their live twins
        if name.startswith("kit_"):
            continue            # pinned INTO the patch: not atlas, and would move the block
        for pr in j["meshes"][node["mesh"]]["primitives"]:
            if "TEXCOORD_0" not in pr["attributes"]:
                continue
            uv = _accessor(j, b, pr["attributes"]["TEXCOORD_0"])
            idx = _accessor(j, b, pr["indices"])[:, 0] if "indices" in pr else np.arange(len(uv))
            for t in range(0, len(idx), 3):
                bake_fix.raster_tri(mask, np.array([(uv[idx[t + k]][0] * w, uv[idx[t + k]][1] * h) for k in range(3)]))
                tris += 1
    at = bake_fix.find_patch_block(mask)
    if at is None and not metallic_only:
        raise SystemExit(f"{path}: no {bake_fix.PATCH + 2 * bake_fix.GUARD}-texel hole in the {w}x{h} atlas")
    x, y = at if at is not None else (0, 0)
    named = {_image_name(j, idx): arr for idx, arr in images.items()}
    if metallic_only:
        # The EXISTING patch, found by its colour: the exporters placed it
        # against their own pre-split source object's atlas, which is not
        # this file's node set, so the first-hole rule above need not land on
        # it. Every PATCH square at 8k + GUARD whose texels all sit within
        # PATCH_TOL of gunmetal.2 and that no live face covers; exactly one.
        want = np.array([int(round(c * 255)) for c in bake_fix._hex_bytes(bake_fix.METAL_HEX)])
        base = named["base_color"][..., :3].astype(int)
        P = bake_fix.PATCH
        near = (np.abs(base - want).max(axis=-1) <= PATCH_TOL)
        # The interior only: JPEG rings the patch's outer 2-3 texels against
        # whatever lies beside it (measured up to 22 levels on the Eitan).
        r = 4
        # `find_patch_block` returns the 8-aligned hole PLUS its 4-texel guard.
        hits = [(xx, yy) for yy in range(bake_fix.GUARD, h - P + 1, 8) for xx in range(bake_fix.GUARD, w - P + 1, 8)
                if near[yy + r:yy + P - r, xx + r:xx + P - r].all() and not mask[yy:yy + P, xx:xx + P].any()]
        if len(hits) != 1:
            raise SystemExit(f"{path}: {len(hits)} gunmetal patch block(s) found by colour ({hits[:4]}), "
                             f"want exactly one -- run without --metallic-only to paint one")
        x, y = hits[0]
        named = {"metallic_roughness": named["metallic_roughness"]}
    painted = bake_fix.paint_patch_arrays(named, x, y, (w, h))

    # Rebuild the BIN chunk: every bufferView in its original order, image
    # views re-encoded, everything else copied.
    by_image = {img["bufferView"]: idx for idx, img in enumerate(j["images"])}
    out = bytearray()
    for vi, bv in enumerate(j["bufferViews"]):
        if vi in by_image and _image_name(j, by_image[vi]) in named:
            buf = io.BytesIO()
            Image.fromarray(named[_image_name(j, by_image[vi])]).save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            data = buf.getvalue()
            j["images"][by_image[vi]]["mimeType"] = "image/jpeg"
        else:
            data = _view_bytes(j, b, vi)
        while len(out) % 4:
            out += b"\x00"
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out += data
    while len(out) % 4:
        out += b"\x00"
    j["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(j, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A))
        fh.write(js)
        fh.write(struct.pack("<II", len(out), 0x004E4942))
        fh.write(out)
    uv = ((x + bake_fix.PATCH / 2.0) / w, (y + bake_fix.PATCH / 2.0) / h)
    print(f"[{os.path.basename(path)}] metal patch: {bake_fix.PATCH}x{bake_fix.PATCH} {bake_fix.METAL_HEX} at texel "
          f"({x}, {y}) of {w}x{h}, uv ({uv[0]:.5f}, {uv[1]:.5f}), guard {bake_fix.GUARD}; {tris} live triangles "
          f"rasterised, atlas coverage {100.0 * mask.mean():.1f}%; painted {', '.join(painted)}; "
          f"{'metallic_roughness' if metallic_only else 'images'} re-encoded JPEG q{JPEG_QUALITY} "
          f"(metallic {bake_fix.METAL_METALLIC}, roughness {bake_fix.METAL_ROUGHNESS}); wrote {total} bytes")


if __name__ == "__main__":
    argv = sys.argv[1:]
    only = "--metallic-only" in argv
    files = [a for a in argv if a != "--metallic-only"]
    if len(files) != 1 or any(a.startswith("--") for a in files):
        raise SystemExit("usage: patch_metal_glb.py [--metallic-only] <vehicle.glb>")
    patch(files[0], metallic_only=only)
