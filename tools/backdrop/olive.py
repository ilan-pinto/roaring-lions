"""The 64-triangle olive (kit-spec 1: `bd_olive`, 64 triangles), pure numpy: no bpy.

Second pass: the first olive was two big icospheres and an octahedron, which read as a
lumpy ball at the in-game size; five big upright octahedra read as a row of little roofs,
and thirteen free-floating tetrahedra as scattered shards (both rendered, both rejected).
An olive is a broad, scalloped crown of many small lobes on a short
trunk, so this one is a three-sided tapered trunk (6 triangles) under a crown of seven
overlapping lobes (octahedra, 8 each, 56), each turned and jittered. 62 triangles, the
in-map olive's measured bounds (decor/tree_0.glb:
3.4 m tall, a crown about 3 m across, a 1.3 m trunk). Nothing of the Meshy mesh is kept.
Every jitter is `kitlib.tile_hash`: no noise module.
"""
import math

import numpy as np

import kitlib as K

TRUNK, CANOPY = 0, 1

#: the crown: (centre, radii, tilt seed). Seven overlapping lobes, each an octahedron turned
#: at random and pushed about, so the outline is a scalloped polygon of twenty-odd corners
#: (the first olive's two icospheres gave about ten) and every lobe overlaps its neighbours:
#: no daylight inside the crown, and no two lobes alike.
LOBES = [
    ((0.00, 0.00, 2.72), (1.00, 0.95, 0.68)),
    ((-0.82, -0.15, 2.28), (1.00, 0.95, 0.66)),
    ((0.82, 0.20, 2.32), (1.00, 0.90, 0.64)),
    ((-0.15, -0.82, 2.18), (0.95, 0.90, 0.60)),
    ((0.25, 0.82, 2.22), (0.92, 0.88, 0.60)),
    ((-0.50, 0.45, 2.80), (0.78, 0.74, 0.54)),
    ((0.55, -0.45, 2.84), (0.76, 0.72, 0.52)),
]


def _prism(verts, tris, tag, p0, p1, r0, r1, phase):
    """A three-sided tapered limb from p0 to p1 (open ends): 6 triangles."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    axis = p1 - p0
    axis /= np.linalg.norm(axis)
    helper = np.array([0.0, 1.0, 0.0]) if abs(axis[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    base = len(verts)
    for p, r in ((p0, r0), (p1, r1)):
        for k in range(3):
            a = phase + k * 2.0 * math.pi / 3.0
            verts.append(p + r * (math.cos(a) * u + math.sin(a) * v))
    for k in range(3):
        j = (k + 1) % 3
        a, b, c, d = base + k, base + j, base + 3 + j, base + 3 + k
        tris += [(a, b, c), (a, c, d)]
        tag += [TRUNK, TRUNK]


def _rot(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def _lobe(verts, tris, tag, centre, radii, k):
    """An octahedron, turned about all three axes and with each corner pushed in or out."""
    base = len(verts)
    R = _rot(0.9 * float(K.tile_hash(k, 5)), 0.9 * float(K.tile_hash(k, 6)), 6.28 * float(K.tile_hash(k, 7)))
    for i, d in enumerate(((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))):
        j = 1.0 + 0.34 * (float(K.tile_hash(k * 7 + i, 11 + k)) - 0.5) * 2.0
        p = np.array(d, float) * j * 0.86
        p = R @ p
        verts.append(np.array(centre) + p * np.array(radii))
    for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
        tris.append((base + a, base + b, base + 4))
        tris.append((base + b, base + a, base + 5))
        tag += [CANOPY, CANOPY]


def build():
    """(verts [n, 3], tris [m, 3], tag [m]) with tag TRUNK / CANOPY."""
    verts, tris, tag = [], [], []
    _prism(verts, tris, tag, (0.0, 0.0, 0.0), (0.12, 0.05, 1.9), 0.34, 0.14, 0.2)
    for k, (c, r) in enumerate(LOBES):
        _lobe(verts, tris, tag, c, r, k)
    return np.array(verts), np.array(tris, dtype=np.int64), np.array(tag)
