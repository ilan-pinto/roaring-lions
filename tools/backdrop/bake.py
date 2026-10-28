"""Bake the kit's one shared atlas (kit-spec 1b): albedo + ambient occlusion only.

No directional light enters the bake (the runtime lights pieces with the side
`SUN_DIRECTION`, and they rotate in 90-degree steps), and every colour is a
`data/palette.json` key read at run time. Pure numpy: no bpy.

Deviation from the spec's section 3, recorded in notes.md: the spec says
"Cycles selected-to-active from master to game mesh". The masters here are
heightfields held in numpy, and the game mesh is a tensor grid cut from them,
so the bake is analytic: each atlas texel is mapped back through the chart's
two monotone axes to the master cell it lies over, and takes that cell's colour
(palette ladder, shifted along the ladder by the master's horizon occlusion).
That is the same albedo + AO a selected-to-active bake would store, with no
sampling noise and no animated seed, so it is byte-reproducible.
"""
import math

import numpy as np

import kitlib as K
import pieces as P

PAD = 6


def olive_patch(w=48, h=48, seed=4242):
    """A 48x48 patch for the instanced olive: canopy tones left, trunk right."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    n = K.fbm(xs, ys, 9.0, 3, seed)
    canopy = K.OLIVE_CANOPY.at(np.clip(2.6 - 2.2 * (ys / h) + 0.5 * n, 0, 3))
    trunk = K.TRUNK.at(np.clip(0.6 + 0.8 * K.fbm(xs, ys, 5.0, 2, seed + 1), 0, 2))
    out = np.where((xs < w // 2)[..., None], canopy, trunk)
    return out


def plan(pieces, atlas_px=K.ATLAS_PX):
    """The atlas layout alone (no shading): `(pos, used_rows, k, sizes)`. `k` is the density
    scale the packer settled on (1.0 when every chart fits at its full density)."""
    sizes = {}
    for p in pieces:
        for c in p.charts:
            sizes[c.name] = (c.cs[-1] * p.ppm * c.dens, c.ct[-1] * p.ppm * c.dens)
    sizes["__olive"] = (48.0, 48.0)

    def pack(k):
        scaled = {n: (w * k, h * k) if n != "__olive" else (w, h) for n, (w, h) in sizes.items()}
        return K.pack_charts(scaled, atlas_px, PAD)
    k = 1.0
    pos, used = pack(k)
    if pos is None:
        lo, hi = 0.2, 1.0                # bisect on the density scale: largest k that fits, to 0.2%
        for _ in range(12):
            mid = 0.5 * (lo + hi)
            if pack(mid)[0] is None:
                hi = mid
            else:
                lo = mid
        k = lo
        pos, used = pack(k)
    if pos is None:
        raise RuntimeError("atlas will not fit")
    return pos, used, k, sizes


def bake(pieces, atlas_px=K.ATLAS_PX, verbose=True):
    """Shade every piece, lay every chart out, fill the atlas.

    A piece is one or more charts (rectangles of its parameter plane, each at its own texel
    density), so the foot of a wall can carry 2x the texels of the slope above it. Returns
    (atlas float [px, px, 3] top-down, info) and sets on each `Chart`: `x0`, `y0`, `w`, `h`,
    `rot` and `k` (texels per surface metre of the chart's own axes), which `kitlib.corner_uv`
    turns into UVs for any mesh over the same parameter plane.
    """
    for p in pieces:
        p.rgb = P.apply_edges(p, P.SHADERS[P.shader_for(p.name)](p.M, p.f, p.seed))
    pos, used, k, sizes = plan(pieces, atlas_px)
    if verbose:
        print("atlas pack: density scale %.3f, %d px of %d rows used, %d charts" % (k, used, atlas_px, len(sizes) - 1))
    atlas = np.empty((atlas_px, atlas_px, 3))
    atlas[:] = K.LIME.at(4.0)
    for p in pieces:
        for c in p.charts:
            c.k = p.ppm * c.dens * k
            cs, ct = c.cs * c.k, c.ct * c.k
            w, h = int(math.ceil(cs[-1])), int(math.ceil(ct[-1]))
            x0, y0, rot = pos[c.name]
            xs = np.arange(-PAD, w + PAD) + 0.5
            ys = np.arange(-PAD, h + PAD) + 0.5
            sv = np.interp(np.clip(xs, 0, cs[-1]), cs, c.s_nodes)
            vv = np.interp(np.clip(ys, 0, ct[-1]), ct, c.v_nodes)
            cols = (sv - p.M.s[0]) / p.M.h
            rows = (vv - p.M.t[0]) / p.M.h
            tile = K.bilinear(p.rgb, rows, cols)
            if rot:
                # the chart is stored turned a quarter: chart x runs down the atlas
                atlas[y0 - PAD:y0 + w + PAD, x0 - PAD:x0 + h + PAD] = tile.transpose(1, 0, 2)
            else:
                atlas[y0 - PAD:y0 + h + PAD, x0 - PAD:x0 + w + PAD] = tile
            c.x0, c.y0, c.w, c.h, c.rot = x0, y0, w, h, bool(rot)
    ox, oy, _ = pos["__olive"]
    atlas[oy:oy + 48, ox:ox + 48] = olive_patch()
    return atlas, {"scale": k, "rows_used": used, "olive_chart": (ox, oy, 48, 48)}
