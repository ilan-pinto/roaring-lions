"""Measure whether Meshy's two AH-64 passes are the same mesh -- the fact
`export_meshy_apache.py`'s rotor cut rests on (its docstring, second pass).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/probe_apache_segmentation.py

Read-only; writes nothing. Opens the part-segmentation file, carries its
rotor (`model_part0`) through the same aggregate-bbox affine the export
fits, then opens the textured file and reports, for a 1-in-3 sample of its
vertices, the distance to the nearest part-segmentation rotor vertex --
split into vertices that are unambiguously rotor (above z 0.205 and more
than 0.3 from the hub axis), unambiguously hull (below z 0.14) and the band
between. It also fits the rotor's disc plane and prints its tilt.

2026-09-07 reading, 262,296 vertices sampled: rotor p99.9 = 0.0002,
p100 = 0.0004; hull minimum 0.0171; tilt 3.27 degrees, normal leaning
toward -X (the nose). Those four numbers are what let the export label the
textured mesh vertex by vertex instead of cutting it with planes and boxes,
and what put the `rotor_tilt` node above the pivot. If a re-supplied source
moves them, re-measure before trusting `SEGMENT_MATCH_RADIUS`.
"""
import math
import os
import time

import bpy
import numpy as np
from mathutils import Vector, kdtree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ROOTS = (REPO, "/Users/ilpinto/dev/roaring-lions")
SRC_DIR = os.path.join("art", "blend", "KDF", "AH-64 attack helicopter")
PARTSEG = "Meshy_AI_attack_helicopter_spl_0830150207_part-segmentation.blend"
TEXTURED = "Meshy_AI_attack_helicopter_3d_0830150132_image-to-3d-texture.blend"


def _resolve(name):
    for root in ROOTS:
        p = os.path.join(root, SRC_DIR, name)
        if os.path.exists(p):
            return p
    raise SystemExit(f"source not found: {name} (tried {ROOTS})")


def _coords(ob):
    me = ob.data
    a = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", a)
    a = a.reshape(-1, 3).astype(np.float64)
    m = np.array(ob.matrix_world)
    return a @ m[:3, :3].T + m[:3, 3]


def _pct(a):
    return " ".join(f"p{q}={np.percentile(a, q):.4f}" for q in (50, 90, 95, 99, 99.9, 100))


def main():
    bpy.ops.wm.open_mainfile(filepath=_resolve(PARTSEG))
    parts = {o.name: _coords(o) for o in bpy.data.objects if o.type == "MESH"}
    allp = np.vstack(list(parts.values()))
    ps_min, ps_max = allp.min(0), allp.max(0)
    rotor_ps = parts["model_part0"]

    bpy.ops.wm.open_mainfile(filepath=_resolve(TEXTURED))
    tex = _coords(bpy.data.objects["mesh_node"])
    tx_min, tx_max = tex.min(0), tex.max(0)
    ratios = (tx_max - tx_min) / (ps_max - ps_min)
    scale = ratios.mean()
    offset = tx_min - ps_min * scale
    print(f"affine: per-axis ratios {ratios.round(4)}, mean scale {scale:.4f}, offset {offset.round(4)}")
    print(f"vertex counts: part-segmentation {len(allp)} across {len(parts)} parts, textured {len(tex)} (difference {len(allp) - len(tex)})")

    rotor = rotor_ps * scale + offset
    cx = (rotor[:, 0].min() + rotor[:, 0].max()) / 2.0
    cy = (rotor[:, 1].min() + rotor[:, 1].max()) / 2.0
    span = max(np.ptp(rotor[:, 0]), np.ptp(rotor[:, 1]))
    hub = rotor[np.hypot(rotor[:, 0] - cx, rotor[:, 1] - cy) <= span * 0.10].mean(0)
    radial = np.hypot(rotor[:, 0] - hub[0], rotor[:, 1] - hub[1])
    blade = rotor[radial > 0.35 * radial.max()]
    centred = blade - blade.mean(0)
    _, _, vt = np.linalg.svd(centred[::7], full_matrices=False)
    normal = vt[2] if vt[2][2] > 0 else -vt[2]
    tilt = math.degrees(math.acos(min(1.0, normal[2])))
    print(f"rotor: hub {hub.round(4)}, disc normal {normal.round(4)}, tilt {tilt:.2f} deg, plane residual sd {(centred @ normal).std():.4f}")

    t0 = time.time()
    kd = kdtree.KDTree(len(rotor))
    for i, p in enumerate(rotor):
        kd.insert(Vector(p), i)
    kd.balance()
    sample = tex[::3]
    dist = np.empty(len(sample))
    for k, p in enumerate(sample):
        dist[k] = kd.find(Vector(p))[2]
    print(f"{len(sample)} nearest-neighbour queries in {time.time() - t0:.1f}s")

    z = sample[:, 2]
    r = np.hypot(sample[:, 0] - hub[0], sample[:, 1] - hub[1])
    sure_rotor = (z >= 0.205) & (r > 0.3)
    sure_hull = z < 0.14
    band = ~sure_rotor & ~sure_hull
    print(f"distance to the part-segmentation rotor, textured vertices:")
    print(f"  unambiguous rotor (z>=0.205, R>0.3) n={sure_rotor.sum()}: {_pct(dist[sure_rotor])}")
    print(f"  unambiguous hull  (z<0.14)          n={sure_hull.sum()}: min {dist[sure_hull].min():.4f}, p1 {np.percentile(dist[sure_hull], 1):.4f}")
    print(f"  the band between                     n={band.sum()}: {_pct(dist[band])}")
    for eps in (0.001, 0.005, 0.010, 0.020):
        inside = dist <= eps
        caught = inside & sure_hull
        print(
            f"  radius {eps:.3f}: rotor captured {100.0 * (inside & sure_rotor).sum() / max(1, sure_rotor.sum()):.1f}%, "
            f"hull vertices caught {caught.sum()}"
            + (f" (all within R {r[caught].max():.3f} of the hub axis -- the mast)" if caught.any() else "")
        )


if __name__ == "__main__":
    main()
