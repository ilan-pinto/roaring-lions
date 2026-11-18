#!/usr/bin/env python3
"""yahalom_back_plate.py -- the Yahalom Engineers' kit back plate, as their packs' seat reads it (GH-826, round 2).

    python3 tools/units/yahalom_back_plate.py            # print the table read off the kit source
    python3 tools/units/yahalom_back_plate.py --write    # ...and write tools/units/yahalom_back_plate.json

The lead's ruling of 17 Nov 2026 (the round-1 review's size table, row 7): the assault pack is seated over the bare back
AND the kit's back plate together. Round 1 seated it 6 mm off the bare back, and at armour 1 and up the plate bag stood
13-30 mm behind that: the pack's face was inside the plate (151 / 119 samples, hidden).

The pack is built by the importer (`yahalom_gear.py`), the kit is fitted afterwards on the importer's file, so the plate
cannot be read where the pack is seated. This reads it off the kit's own SOURCE (`art/parts/inf_kit/yahalom_squad.glb`,
the nodes `kit_armour_1_carrier_<man>`) and writes it as data the importer loads: per man, the plate bag's REAR face (the
smallest x, the figure faces +x) on a grid of (y, z) cells, metres about his own root, `null` where the carrier has no
wall. Plain python3 and numpy; no Blender.

It is not circular: the carrier is fitted to the `uniform` skin alone (`inf_kit_v7.carrier_fit`: its ring samples the
torso zone; the pack is `webbing`), so a pack that moves does not move the plate. `tools/test_yahalom_back_plate.py` holds
that: the committed table must be what this reads off the committed kit source, to the 0.1 mm it is written in.
"""
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
KIT = os.path.join(REPO, "art", "parts", "inf_kit", "yahalom_squad.glb")
OUT = os.path.join(HERE, "yahalom_back_plate.json")
FIGURES = ("yah_a", "yah_b")
#: the grid: cells DY x DZ, y within +-Y_HALF of the man's root (the pack is 0.30 wide about the SPINE's line, which stands up to 5 cm off the root's)
DY, DZ, Y_HALF = 0.0125, 0.01, 0.25
_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _glb(path):
    b = open(path, "rb").read()
    if b[:4] != b"glTF":
        raise SystemExit(f"{path}: not a GLB")
    o, j, bn = 12, None, None
    while o < len(b):
        ln, ty = struct.unpack("<II", b[o:o + 8])
        d = b[o + 8:o + 8 + ln]; o += 8 + ln
        if ty == 0x4E4F534A:
            j = json.loads(d)
        elif ty == 0x004E4942:
            bn = d
    return j, bn


def _acc(j, bn, i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    dt = _CT[a["componentType"]]; n = _NC[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    if bv.get("byteStride", 0) not in (0, np.dtype(dt).itemsize * n):
        raise SystemExit("an interleaved buffer view: not read here")
    return np.frombuffer(bn, dtype=dt, count=a["count"] * n, offset=off).reshape(a["count"], n).astype(np.float64)


def read(path=KIT):
    """{man: {y0, dy, z0, dz, x: rows of the rear face's x (or None)}}, metres about the man's root, Blender axes (z up)."""
    j, bn = _glb(path)
    names = {n.get("name"): i for i, n in enumerate(j["nodes"])}
    out = {}
    for fig in FIGURES:
        node = j["nodes"][names[f"kit_armour_1_carrier_{fig}"]]
        if any(k in node for k in ("translation", "rotation", "scale", "matrix")):
            raise SystemExit(f"{fig}: the carrier node carries a transform: not read here")
        root = j["nodes"][names[f"{fig}_root"]].get("translation", [0, 0, 0])
        P, I = [], []
        for prim in j["meshes"][node["mesh"]]["primitives"]:
            p = _acc(j, bn, prim["attributes"]["POSITION"])
            I.append(_acc(j, bn, prim["indices"]).astype(int).reshape(-1, 3) + sum(len(q) for q in P))
            P.append(p)
        P = np.vstack(P); I = np.vstack(I)
        P = np.c_[P[:, 0] - root[0], -(P[:, 2] - root[2]), P[:, 1] - root[1]]        # glTF (x, y up, z) -> (x, y, z up), about the root
        a, b, c = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
        pts = [P]
        for u in np.linspace(0.1, 0.9, 5):                    # the walls between the vertices too (a triangle is up to 3 cm)
            for v in np.linspace(0.1, 0.9, 5):
                if u + v < 1.0:
                    pts.append(a * (1 - u - v) + b * u + c * v)
        pts = np.vstack(pts)
        x_mid = 0.5 * (P[:, 0].min() + P[:, 0].max())
        pts = pts[pts[:, 0] < x_mid]                            # the back half
        z0 = round(float(np.floor(P[:, 2].min() / DZ) * DZ), 4)
        nz = int(np.ceil((P[:, 2].max() - z0) / DZ)) + 1
        ny = int(round(2 * Y_HALF / DY)) + 1
        grid = np.full((nz, ny), np.inf)
        k = np.rint((pts[:, 1] + Y_HALF) / DY).astype(int); jz = np.rint((pts[:, 2] - z0) / DZ).astype(int)
        ok = (k >= 0) & (k < ny) & (jz >= 0) & (jz < nz)
        np.minimum.at(grid, (jz[ok], k[ok]), pts[ok, 0])
        rows = [[None if not np.isfinite(v) else round(float(v), 4) for v in row] for row in grid]
        cells = int(np.isfinite(grid).sum())
        if cells < 200:
            raise SystemExit(f"{fig}: the back plate reads {cells} cells: not a plate")
        out[fig] = dict(y0=-Y_HALF, dy=DY, z0=z0, dz=DZ, x=rows)
    return out


def table(path=KIT):
    return dict(version=1, source="art/parts/inf_kit/yahalom_squad.glb, kit_armour_1_carrier_<man>: the rear face's x on (y, z) cells, metres about the man's root",
                figures=read(path))


def dumps(t):
    return json.dumps(t, indent=None, separators=(",", ":"), sort_keys=True).replace('},"', '},\n"').replace("],[", "],\n[") + "\n"


if __name__ == "__main__":
    t = table(sys.argv[sys.argv.index("--kit") + 1] if "--kit" in sys.argv else KIT)
    for fig, r in t["figures"].items():
        g = np.array([[np.nan if v is None else v for v in row] for row in r["x"]])
        print(f"{fig}: {int(np.isfinite(g).sum())} cells, z {r['z0']:.2f} .. {r['z0'] + r['dz'] * (len(g) - 1):.2f}, rear face x {np.nanmin(g):.4f} .. {np.nanmax(g):.4f} about his root")
    if "--write" in sys.argv:
        with open(OUT, "w") as fh:
            fh.write(dumps(t))
        print("wrote", OUT)
