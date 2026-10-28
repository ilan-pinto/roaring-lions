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


def bake(pieces, atlas_px=K.ATLAS_PX, verbose=True):
    """Shade every piece, lay the charts out, fill the atlas.

    Returns (atlas float [px, px, 3] top-down, info) and sets on each piece:
    `uv` ([N, 2], glTF/Blender v up), `chart` (x, y, w, h) and `texels_per_m`.
    """
    sizes = {}
    axes = {}
    for p in pieces:
        p.rgb = P.apply_edges(p, P.SHADERS[P.shader_for(p.name)](p.M, p.f, p.seed))
        cs, ct = K.chart_axes(p.M, p.f["H"], p.gm, 1.0)   # surface metres
        axes[p.name] = (cs, ct)
        sizes[p.name] = (cs[-1] * p.ppm, ct[-1] * p.ppm)
    sizes["__olive"] = (48.0, 48.0)
    k = 1.0
    pos = None
    for _ in range(80):
        scaled = {n: (w * k, h * k) if n != "__olive" else (w, h) for n, (w, h) in sizes.items()}
        pos, used = K.pack_charts(scaled, atlas_px, PAD)
        if pos is not None:
            break
        k *= 0.985
    if pos is None:
        raise RuntimeError("atlas will not fit")
    if verbose:
        print("atlas pack: density scale %.3f, %d px of %d rows used" % (k, used, atlas_px))
    atlas = np.empty((atlas_px, atlas_px, 3))
    atlas[:] = K.LIME.at(4.0)
    for p in pieces:
        cs, ct = axes[p.name]
        cs, ct = cs * p.ppm * k, ct * p.ppm * k
        w, h = int(math.ceil(cs[-1])), int(math.ceil(ct[-1]))
        x0, y0, rot = pos[p.name]
        xs = np.arange(-PAD, w + PAD) + 0.5
        ys = np.arange(-PAD, h + PAD) + 0.5
        sv = np.interp(np.clip(xs, 0, cs[-1]), cs, p.gm.sv)
        tv = np.interp(np.clip(ys, 0, ct[-1]), ct, p.gm.tv)
        cols = (sv - p.M.s[0]) / p.M.h
        rows = (tv - p.M.t[0]) / p.M.h
        tile = K.bilinear(p.rgb, rows, cols)
        SS, TT = np.meshgrid(cs, ct)
        if rot:
            # the chart is stored turned a quarter: chart x runs down the atlas
            atlas[y0 - PAD:y0 + w + PAD, x0 - PAD:x0 + h + PAD] = tile.transpose(1, 0, 2)
            ax, ay = TT, SS
        else:
            atlas[y0 - PAD:y0 + h + PAD, x0 - PAD:x0 + w + PAD] = tile
            ax, ay = SS, TT
        u = (x0 + ax.ravel()) / atlas_px
        v = 1.0 - (y0 + ay.ravel()) / atlas_px
        p.uv = np.stack([u, v], axis=1)
        p.chart = (x0, y0, w, h, rot)
        p.texels_per_m = p.ppm * k
        p.chart_axes = (cs, ct)
    ox, oy, _ = pos["__olive"]
    atlas[oy:oy + 48, ox:ox + 48] = olive_patch()
    return atlas, {"scale": k, "rows_used": used, "olive_chart": (ox, oy, 48, 48)}
