"""Author `ditch_lod1`: the lower-detail twin of the anti-tank / irrigation ditch segment (GH-974).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/author_ditch_lod1.py

Writes art/src/decor/ditch_lod1.blend and art/meshes/decor/ditch_lod1.glb.

Why. `ditch_0.glb` is 38,240 triangles a segment and a map draws one per `d` tile run: Milh Flats (large) has 44
in a frame, 5.05 M of its 8.4 M triangles. Measured (GH-974 step 0, hiding every ditch chunk): -1.1 ms at centre
zoom 1, -0.8 ms at 1.6. Below zoom 2.0 the pebbles and rocks in the berm are under 2 px, so this twin keeps the
OUTLINE and the cut profile and drops the relief.

How. Nothing here is a decimate. The ditch is a heightfield pressed into a flat ground patch (see
`tools/terrain/export_meshy_ditch.py`), so the twin is that heightfield re-sampled on a tensor grid, MEASURED by
ray-casting the full mesh's surface from above:

  - y lines: the x-averaged cross-section reduced by Douglas-Peucker to PROFILE_TOL (every corner of the cut is
    a line, so the apron, the trench floor, the far wall, the shelf and the berm keep their exact edges), then any
    span wider than MAX_DY is split so the berm's rocks keep their height;
  - x lines: every STEP_X metres, with both tile ends at the measured end profile (a segment butts against its
    neighbour: the two end profiles are what must meet);
  - the sides (y = +-0.635) and the two ends are sealed down to the measured underside, so the twin is closed;
  - roles: ONE node `ditch` carrying `rl_textured: true` and no `rl_role`, exactly as the full mesh.

Colour: ZERO materials, UV0 sampled off the full ditch's bake (see lod_twin_common.py), so at runtime the twin takes
the full template's material (the textured-decor family `ditch`). Normals are averaged within 35 degrees, so the
berm reads smooth, not faceted, while the bank edges stay crisp.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lod_twin_common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
SRC_FULL = os.path.join(REPO, "art", "meshes", "decor", "ditch_0.glb")
OUT_GLB = os.path.join(REPO, "art", "meshes", "decor", "ditch_lod1.glb")
OUT_BLEND = os.path.join(REPO, "art", "src", "decor", "ditch_lod1.blend")

HALF_X = 1.5
HALF_Y = 0.635
STEP_X = 0.1
PROFILE_TOL = 0.004
MAX_DY = 0.07
TRI_CEILING = 2500
CREDIT = ("Ditch LOD1 (GH-974) -- built in Blender from code (tools/buildings/author_ditch_lod1.py), "
          "derived from art/meshes/decor/ditch_0.glb, project original")


def top(tree, x, y):
    for dx, dy in ((0, 0), (7e-4, 3e-4), (-3e-4, 7e-4), (-7e-4, -3e-4)):   # a ray down a mesh edge can miss
        h = tree.ray_cast(Vector((x + dx, y + dy, 2.0)), Vector((0, 0, -1)))
        if h[0] is not None:
            return h[0].z
    return None


def bottom(tree, x, y):
    h = tree.ray_cast(Vector((x, y, -2.0)), Vector((0, 0, 1)))
    return None if h[0] is None else h[0].z


def dp(pts, tol):
    """Douglas-Peucker on (y, z) points, returns the kept y values."""
    if len(pts) < 3:
        return [p[0] for p in pts]
    (y0, z0), (y1, z1) = pts[0], pts[-1]
    worst, wi = -1.0, 0
    for i in range(1, len(pts) - 1):
        t = (pts[i][0] - y0) / (y1 - y0)
        d = abs(pts[i][1] - (z0 + t * (z1 - z0)))
        if d > worst:
            worst, wi = d, i
    if worst <= tol:
        return [y0, y1]
    return dp(pts[: wi + 1], tol)[:-1] + dp(pts[wi:], tol)


def first(vals):
    """Replace None by the nearest valid neighbour."""
    out = list(vals)
    last = None
    for i, v in enumerate(out):
        if v is None:
            out[i] = last
        else:
            last = v
    nxt = None
    for i in range(len(out) - 1, -1, -1):
        if out[i] is None:
            out[i] = nxt
        else:
            nxt = out[i]
    return out


def main():
    sampler, tree, pts, full_tris, _ = C.import_full(SRC_FULL)
    # the x-averaged cross-section, every 5 mm
    prof_y = [-HALF_Y + 0.005 * i for i in range(int(2 * HALF_Y / 0.005) + 1)]
    xs_avg = [-1.4 + 0.2 * k for k in range(15)]
    mean_z = []
    for y in prof_y:
        zs = [z for z in (top(tree, x, y) for x in xs_avg) if z is not None]
        mean_z.append(sum(zs) / len(zs) if zs else None)
    ok = [(y, z) for y, z in zip(prof_y, mean_z) if z is not None]
    lines = dp(ok, PROFILE_TOL)
    lines = sorted(set([-HALF_Y] + lines + [HALF_Y]))
    ylines = []
    for a, b in zip(lines, lines[1:]):
        n = max(1, int(-(-(b - a) // MAX_DY)))
        ylines += [a + (b - a) * k / n for k in range(n)]
    ylines.append(lines[-1])
    nxs = int(round(2 * HALF_X / STEP_X))
    xlines = [-HALF_X + 2 * HALF_X * i / nxs for i in range(nxs + 1)]

    def zt(x, y):
        # clamp into the mesh by a hair so the rays at the very border still hit it
        xc = max(-HALF_X + 5e-4, min(HALF_X - 5e-4, x))
        yc = max(-HALF_Y + 5e-4, min(HALF_Y - 5e-4, y))
        return top(tree, xc, yc)

    grid = []
    for x in xlines:
        grid.append(first([zt(x, y) for y in ylines]))
    bot = first([bottom(tree, 0.3, max(-HALF_Y + 5e-4, min(HALF_Y - 5e-4, y))) for y in ylines])

    Q = C.Quads()
    R = "ditch"
    for i in range(nxs):
        for j in range(len(ylines) - 1):
            Q.add(R, [(xlines[i], ylines[j], grid[i][j]), (xlines[i + 1], ylines[j], grid[i + 1][j]),
                      (xlines[i + 1], ylines[j + 1], grid[i + 1][j + 1]), (xlines[i], ylines[j + 1], grid[i][j + 1])], (0, 0, 1))
        for s, yy, ji in ((-1, ylines[0], 0), (1, ylines[-1], len(ylines) - 1)):
            Q.add(R, [(xlines[i], yy, grid[i][ji]), (xlines[i + 1], yy, grid[i + 1][ji]),
                      (xlines[i + 1], yy, bot[ji]), (xlines[i], yy, bot[ji])], (0, s, 0))
    for j in range(len(ylines) - 1):
        for s, xx, ii in ((-1, xlines[0], 0), (1, xlines[-1], nxs)):
            Q.add(R, [(xx, ylines[j], grid[ii][j]), (xx, ylines[j + 1], grid[ii][j + 1]),
                      (xx, ylines[j + 1], bot[j + 1]), (xx, ylines[j], bot[j])], (s, 0, 0))
        Q.add(R, [(-HALF_X, ylines[j], bot[j]), (HALF_X, ylines[j], bot[j]),
                  (HALF_X, ylines[j + 1], bot[j + 1]), (-HALF_X, ylines[j + 1], bot[j + 1])], (0, 0, -1))
    total = Q.tri_count()
    if total > TRI_CEILING:
        raise SystemExit(f"ditch_lod1: {total} triangles over the ceiling {TRI_CEILING}")
    objs = C.build_and_export(Q, sampler, OUT_BLEND, OUT_GLB, CREDIT, smooth_roles=(R,),
                              node_props={R: {"rl_textured": True}})
    pts2 = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo, hi = C.bounds(pts2)
    flo, fhi = C.bounds(pts)
    print(f"[ditch_lod1] {total} tris ({len(ylines) - 1} y cells x {nxs} x strips); y lines {[round(v, 3) for v in lines]}")
    print(f"[ditch_lod1] bounds lo {[round(v, 3) for v in lo]} hi {[round(v, 3) for v in hi]}; "
          f"full lo {[round(v, 3) for v in flo]} hi {[round(v, 3) for v in fhi]}; {os.path.getsize(OUT_GLB)} bytes")


if __name__ == "__main__":
    main()
