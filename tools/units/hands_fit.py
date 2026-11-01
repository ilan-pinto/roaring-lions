"""Where the hands sit on the reshaped `kdf_carbine` (GH-826 step 2). numpy only, no Blender.

The weapon's stations are measured by `export_kdf_carbine_part.py` (`stations.json`), the hands are built by
`hands.py` to close on the proxy each station names, and this module is the one place that joins them: it places
the firing hand ("grip") and the support hand ("support") on the part and returns each hand with the rigid
transform (hand-local -> part frame, x forward, y across (left), z up, metres) it was placed with. The hands pass
(`hands-pass.ts`) reads that transform from `art/parts/hands/hands_lib.glb`; `export_hands_lib.py` writes it.

Not a solver for a clip: that is the motion pass (`motion/hold.ts`), which keeps these transforms as the hand's
rest relation to the weapon and moves the weapon.
"""
import json
import os
import struct

import numpy as np

import hands as H

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PART_DIR = os.path.join(REPO, "art", "parts", "kdf_carbine")

_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_W = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_part(path=None):
    """The carbine part's vertices (Blender part frame: x forward, y across, z up) and triangles, from the GLB."""
    path = path or os.path.join(PART_DIR, "kdf_carbine.glb")
    d = open(path, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack("<I", d[off:off + 4])[0]
    b = d[off + 8:off + 8 + bl]

    def acc(i):
        a = g["accessors"][i]
        bv = g["bufferViews"][a["bufferView"]]
        w, t = _W[a["type"]], _CT[a["componentType"]]
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(b, dtype=t, count=a["count"] * w, offset=o).reshape(a["count"], w)

    p = g["meshes"][0]["primitives"][0]
    P = acc(p["attributes"]["POSITION"]).astype(float)
    return np.c_[P[:, 0], -P[:, 2], P[:, 1]], acc(p["indices"]).reshape(-1, 3).astype(int)


def stations(path=None):
    path = path or os.path.join(PART_DIR, "stations.json")
    return json.load(open(path))["stations"]


def hull2d(pts):
    pts = sorted(set(map(tuple, np.round(pts, 5))))
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def place_grip(side="R", st=None):
    """The firing hand on the pistol grip: (hand, R, t), hand-local -> part frame."""
    st = st or stations()
    a = np.array(st["grip"]["axis"])
    gp = np.array(st["grip"]["point"])
    h = H.build("grip", side)
    R, t = H.place_matrix(h, a, (0, -1, 0), gp)
    return h, R, t


#: How far the support hand is turned about its palm normal from "knuckle line parallel to the bore", degrees. The spec
#: asked for 15 at most; with this rig's 0.117 m upper arm the forearm cannot come from the side (see `hold.ts`,
#: HANDS_*), so the hand lies at the angle a real C-clamp does, the fingers pointing forward across the handguard.
SUPPORT_YAW_DEG = 35.0


def place_support(verts=None, st=None, yaw_deg=None):
    """The support hand under the handguard, closed on the handguard's REAL section: (hand, R, t).

    The hand is turned `yaw_deg` about its palm normal (fingertips forward), so the finger plane cuts the handguard
    obliquely: the section the fingers close on is the plane's own cut of the handguard's extrusion, taken from the
    part's vertices, stretched by 1 / cos(yaw) along the fingers."""
    st = st or stations()
    yaw = np.radians(SUPPORT_YAW_DEG if yaw_deg is None else yaw_deg)
    if verts is None:
        verts, _ = read_part()
    sup = st["support"]
    hgw, hgh = sup["section"]
    ctr = np.array(sup["axis_point"])
    r0 = (hgw + hgh) / 4.0
    cy = H.PROXY_Y["support"]
    h0 = H.build("support", "L", proxy=H.Circle(cy, -(H.PALM_THICK / 2) - H.CLEARANCE - r0, r0))
    R, t = H.place_matrix(h0, (-1, 0, 0), (0, 0.70710678, -0.70710678), ctr)
    ref = H.grasp_frame(h0)[2]
    c, s_ = np.cos(yaw), -np.sin(yaw)          # positive yaw turns the fingertips FORWARD
    Rz = np.array(((c, -s_, 0.0), (s_, c, 0.0), (0.0, 0.0, 1.0)))
    R = R @ Rz
    t = ctr - R @ ref                                   # the reference point stays on the handguard's axis
    win = verts[(verts[:, 0] > 0.10) & (verts[:, 0] < 0.20)]
    sec = hull2d(win[:, 1:3])
    # the handguard, extruded along the bore, in hand-local coordinates; the finger plane is x_h = 0 plus the ref's x
    pts = []
    for a in np.linspace(-0.12, 0.12, 241):
        for (y, z) in sec:
            pts.append((ctr[0] + a, y, z))
    loc = (np.array(pts) - t) @ R
    cut = loc[np.abs(loc[:, 0] - ref[0]) < 0.0015]
    ph = np.array(hull2d(cut[:, 1:3]))
    z_palm = -(H.PALM_THICK / 2) - H.CLEARANCE
    gap = float(ph[:, 1].max() - z_palm)
    ph[:, 1] -= gap
    t = t + R @ np.array((0.0, 0.0, gap))
    poly = H.Polygon([(p[0], p[1]) for p in ph], cy, float(ph[:, 1].mean()))
    return H.build("support", "L", proxy=poly), R, t


def transform4(R, t):
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = t
    return M
