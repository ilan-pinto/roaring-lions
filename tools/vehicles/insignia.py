#!/usr/bin/env python3
"""GH-1096: where the Roaring Lion insignia sits on each KDF vehicle, and what the runtime table says about it.

    python3 tools/vehicles/insignia.py            measure every frame and print the numbers (no file written)
    python3 tools/vehicles/insignia.py --write    ... and write packages/render/src/three/units/insignia-frames.ts
    python3 tools/vehicles/insignia.py --check    exit 1 if the committed table differs from a fresh --write

The insignia is NOT in any GLB. It is a planar frame in the vehicle's own mesh-local space (X forward, Y up, Z lateral),
a flank pair mirrored about the centreline, and the fragment shader (`packages/render/src/three/units/insignia.ts`) samples
one shared distance-field texture on it. So a placement change touches no binary: change a number in `FRAMES`, run
`--write`, look again (the spec's decision 16).

`FRAMES` holds the numbers the lead approves; everything else the table carries is MEASURED here:
  - `luma`: the mean LINEAR luminance of the base colour under the disc, read on the visible host surface of both flanks
    (the front-most `rl_role: hull` face at each point, no kit), which the shader divides by so the stencil keeps 30% of
    the bake's grime and averages to its own colour.
  - `host_sha256`: the sha256 of the host hull POSITION accessors (`host_position_sha256`). The kit pass keeps those
    byte-identical, so a re-exported or re-shaped hull changes it, and `validate:meshes` (`check_insignia_frames`)
    refuses the table until the frame is re-measured. An emblem cannot silently float off a changed hull.

The frame's fields (`insignia-frames.ts`'s `InsigniaFrame`):
  centre  [cx, cy, cz]  metres; the disc on the +z flank, its twin at -cz. The shader reads cx and cy; cz is documentation
  d                     the roundel's diameter (decision 10: 0.60 m standard)
  slab    [zlo, zhi]    the |z| range a painted fragment must be in: the host flank AND the outermost flat kit plate
                        standing over it (decision 14), nothing behind
  min_n                 flank faces only: |n.z| above this. NOT sign(z) * n.z: the Lavi's -z flank is mirrored geometry on a
                        double-sided material, so its normals point +z (inward), mean n.z 0.984 under the disc

Reads the UNCOMPRESSED GLBs in `art/meshes/vehicles/` (numpy + PIL, as `lavi_mark.py`). No randomness, no Blender.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from glb_read import Glb  # noqa: E402

VEHICLES = os.path.join(REPO, "art", "meshes", "vehicles")
OUT = os.path.join(REPO, "packages", "render", "src", "three", "units", "insignia-frames.ts")
BEGIN = "// BEGIN rl-insignia-frames (strict JSON; tools/validate_mesh_assets.py reads it)"
END = "// END rl-insignia-frames"

#: The lead-approved placements (spec section 6, decisions 10-14). S1: the Lavi pilot alone.
#:
#: `mbt_lavi`: the forward skirt panel of the hull flank (x 0.5..1.4 between the panel seams), 0.60 m, measured. The host
#: flank stands at |z| 1.693..1.707 under the disc and the tier-2 skirt plate (`kit_armour_2_hull_hull`) at |z| 1.888, so the
#: slab takes both: on an upgraded tank the stencil sits on the outer plate, as on a real skirt. Nothing else stands in the
#: disc and slab (no rubber, metal or plate face; `tools/src/insignia.test.ts`).
FRAMES = {
    "mbt_lavi": dict(centre=[0.95, 1.00, 1.70], d=0.60, slab=[1.60, 1.95], min_n=0.60),
}

#: Points per metre when the disc is sampled (a 1 cm grid).
GRID = 100


def host_nodes(js):
    """The host hull meshes: `rl_role: hull`, not a kit part, not a wreck twin. Sorted by name."""
    out = []
    for nd in js["nodes"]:
        ex = nd.get("extras") or {}
        if "mesh" not in nd or ex.get("rl_role") != "hull" or "rl_kit" in ex or ex.get("rl_wreck"):
            continue
        out.append(nd["name"])
    return sorted(out)


def host_position_sha256(glb):
    """sha256 over each host hull mesh's POSITION, as tightly packed little-endian float32 x, y, z, in name order."""
    h = hashlib.sha256()
    for name in host_nodes(glb.js):
        nd = next(n for n in glb.js["nodes"] if n.get("name") == name)
        prim = glb.js["meshes"][nd["mesh"]]["primitives"][0]
        h.update(np.ascontiguousarray(glb.accessor(prim["attributes"]["POSITION"]), dtype="<f4").tobytes())
    return h.hexdigest()


def bake_luma(glb):
    """The base colour as LINEAR luminance, full resolution."""
    js, bin_ = glb.js, glb.bin
    mat = js["materials"][0]
    tex = js["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    im = js["images"][tex["source"]]
    bv = js["bufferViews"][im["bufferView"]]
    off = bv.get("byteOffset", 0)
    img = Image.open(io.BytesIO(bin_[off:off + bv["byteLength"]])).convert("RGB")
    px = np.asarray(img).astype(np.float64) / 255.0
    lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def surfaces(glb, names):
    out = []
    for name in names:
        pos, nrm, uv, tri = glb.primitive(name)
        pos = pos + glb.node_translation(name)
        out.append(dict(name=name, T=pos[tri], N=nrm[tri], U=uv[tri]))
    return out


def front_faces(parts, frame, side):
    """At each 1 cm point of the disc on one flank: the visible (front-most, largest side * z) face, as
    (|z|, |n.z| interpolated and normalised, uv). Points with no face under them are dropped."""
    cx, cy, _cz = frame["centre"]
    r = frame["d"] / 2
    n = int(round(frame["d"] * GRID))
    xs = cx - r + (np.arange(n) + 0.5) / GRID
    ys = cy - r + (np.arange(n) + 0.5) / GRID
    out = []
    for y in ys:
        for x in xs:
            if np.hypot(x - cx, y - cy) > r:
                continue
            best = None
            for p in parts:
                a, b, c = p["T"][:, 0], p["T"][:, 1], p["T"][:, 2]
                d = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
                ok = np.abs(d) > 1e-12
                dd = np.where(ok, d, 1.0)
                l1 = ((b[:, 1] - c[:, 1]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (y - c[:, 1])) / dd
                l2 = ((c[:, 1] - a[:, 1]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (y - c[:, 1])) / dd
                l3 = 1.0 - l1 - l2
                hit = ok & (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
                if not hit.any():
                    continue
                idx = np.nonzero(hit)[0]
                z = l1[idx] * a[idx, 2] + l2[idx] * b[idx, 2] + l3[idx] * c[idx, 2]
                k = int(np.argmax(side * z))
                if best is not None and side * z[k] <= side * best[0]:
                    continue
                i = idx[k]
                w = np.array([l1[i], l2[i], l3[i]])
                nn = w @ p["N"][i]
                uv = w @ p["U"][i]
                best = (float(z[k]), abs(float(nn[2])) / max(float(np.linalg.norm(nn)), 1e-12), uv)
            if best is not None:
                out.append((abs(best[0]), best[1], best[2]))
    return out


def measure(vehicle):
    frame = FRAMES[vehicle]
    path = os.path.join(VEHICLES, f"{vehicle}.glb")
    glb = Glb(path)
    hosts = host_nodes(glb.js)
    luma_img = bake_luma(glb)
    h, w = luma_img.shape
    parts = surfaces(glb, hosts)
    lumas, flank = [], {}
    for side in (1, -1):
        faces = front_faces(parts, frame, side)
        good = [f for f in faces if frame["slab"][0] <= f[0] <= frame["slab"][1] and f[1] >= frame["min_n"]]
        flank["+z" if side > 0 else "-z"] = dict(points=len(faces), painted=len(good))
        for _z, _n, uv in good:
            x = min(w - 1, max(0, int(uv[0] * w)))
            y = min(h - 1, max(0, int(uv[1] * h)))
            lumas.append(luma_img[y, x])
    if not lumas:
        raise SystemExit(f"{vehicle}: no host face in the disc and slab -- the frame is off the hull")
    lumas = np.array(lumas)
    # The kit plates' pinned texels: on an upgraded tank the stencil on the outer plate keeps mix(1, pin / luma, 0.3).
    pins = sorted({(round(float(u), 5), round(float(v), 5)) for nd in glb.js["nodes"]
                   if nd.get("name", "").startswith("kit_") and "mesh" in nd
                   for u, v in glb.accessor(glb.js["meshes"][nd["mesh"]]["primitives"][0]["attributes"]["TEXCOORD_0"])})
    pin_luma = {f"{u},{v}": round(float(luma_img[min(h - 1, int(v * h)), min(w - 1, int(u * w))]), 5) for u, v in pins}
    entry = dict(
        centre=frame["centre"],
        d=frame["d"],
        slab=frame["slab"],
        min_n=frame["min_n"],
        luma=round(float(lumas.mean()), 5),
        host_sha256=host_position_sha256(glb),
    )
    report = dict(hosts=hosts, flanks=flank, luma_std=round(float(lumas.std()), 5), kit_pin_luma=pin_luma)
    return entry, report


def render_table(entries):
    body = json.dumps(entries, indent=2, sort_keys=True)
    # Number arrays on one line, so a placement change is a one-line diff (still strict JSON).
    body = re.sub(r"\[\s*([-0-9.e,\s]+?)\s*\]", lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", body)
    return f"""/**
 * GH-1096: the Roaring Lion insignia's frame per vehicle TYPE id. GENERATED by `python3 tools/vehicles/insignia.py --write`:
 * never hand-edit. The placements are `FRAMES` in that script (the lead-approved numbers); `luma` and `host_sha256` are measured
 * there. `validate:meshes` re-hashes each GLB's host hull positions against `host_sha256` (`check_insignia_frames`), and
 * `insignia-frames.test.ts` pins the scope to a literal list.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type {{ InsigniaFrame }} from './insignia';

{BEGIN}
const FRAMES: Readonly<Record<string, InsigniaFrame>> = {body};
{END}

/** Every framed type, by its unit type id. */
export const INSIGNIA_FRAMES: Readonly<Record<string, InsigniaFrame>> = FRAMES;

/** The frame of EXACTLY this type id, or null: a variant sharing the hull (`mbt_lavi_camo`, `officer_armour`) is its own type and needs its own entry. */
export function insigniaFrameOf(typeId: string): InsigniaFrame | null {{
  return Object.prototype.hasOwnProperty.call(FRAMES, typeId) ? FRAMES[typeId] : null;
}}
"""


def main(argv=None):
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--write", action="store_true")
    g.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    entries, reports = {}, {}
    for vehicle in sorted(FRAMES):
        entries[vehicle], reports[vehicle] = measure(vehicle)
    print(json.dumps(dict(entries=entries, reports=reports), indent=2, sort_keys=True))
    text = render_table(entries)
    if a.write:
        with open(OUT, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {os.path.relpath(OUT, REPO)}")
    elif a.check:
        have = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if have != text:
            print(f"{os.path.relpath(OUT, REPO)} is stale: run python3 tools/vehicles/insignia.py --write", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
