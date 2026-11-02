#!/usr/bin/env python3
"""L3 (GH-943): the Lavi's normal map and its occlusion-roughness-metal (ORM) map,
authored as a TABLE and computed with numpy -- no Blender, no `mathutils.noise`.

    python3 tools/vehicles/lavi_maps.py --glb art/meshes/vehicles/mbt_lavi.glb \
        --kit art/parts/kit/mbt_lavi.glb --out <dir> [--size 2048]

It reads the Lavi's shipped geometry (after `pnpm running-gear:meshes`, before
`kit:meshes`), maps every covered texel of the 2048 atlas back to its 3D position
on that geometry, in metres, and evaluates the detail table `DETAIL` there with
hand-rolled, seeded value noise (`vnoise`/`fbm` below). Nothing is painted and
nothing is baked: like the rig's bones and clips, the detail is DATA you can diff.

Writes `<out>/normal.png` (RGB, glTF tangent space, green up) and `<out>/orm.png`
(RGBA: R occlusion, G roughness, B metalness, **A inverted team mask**: 255 for the
bake, 0 for team colour) plus `<out>/report.json` (everything the maps pass stamps
into the GLB: the team-region luma, the swatches, the probe table).

THE FRAME (the load-bearing part). three.js has no tangents on this asset, so its
fragment shader derives the frame from screen-space derivatives (`getTangentFrame`,
`normalmap_pars_fragment.glsl.js`). Worked through, that frame is exactly
`(grad u, grad v, N)` -- the SURFACE gradients of the two texture coordinates, each
divided by the larger of their lengths -- whatever the UV winding. `GLTFLoader`
then negates `normalScale.y` (no tangent attribute), which is what makes a glTF map
"green up". So a height field `h` is stored as

    mx = -h_u * M          my = +h_v * M          (then normalised with z = 1)

with `M = max(|grad u|, |grad v|)` and `h_u = dh/du` per UV unit. `tangent_frame()`
below is the GLSL transliterated, NOT the closed form, so the closed form used for
speed (`dual_basis`) is checked against it in `selfcheck()` and again, by a second
transliteration, in `tools/src/meshes/lavi-maps.test.ts`.
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glb_read import Glb  # noqa: E402

# ---------------------------------------------------------------------------
# The detail table. Every number is metres unless it says otherwise.
# ---------------------------------------------------------------------------

#: Texture edge, texels. 2048 is the lead's ruling (2 Nov, GH-943).
SIZE = 2048

#: The four LIVE meshes the maps cover. The kit parts are UV-pinned to flat swatches
#: and the wreck twins share these meshes' texels.
PARTS = ("hull_hull", "hull_rubber", "turret_hull", "turret_metal")

#: Base surface response per part: roughness, metalness (0..1 of the MAP; the runtime
#: factors are 1 and the metal cap, 0.7), and the amplitude of the roughness noise.
BASE = {
    "hull_hull": dict(rough=0.80, metal=0.0, rough_noise=0.10),
    "turret_hull": dict(rough=0.80, metal=0.0, rough_noise=0.10),
    # The barrel and the antennas: gunmetal. 0.64 x the 0.7 cap = the 0.45 gunmetal class.
    "turret_metal": dict(rough=0.42, metal=0.64, rough_noise=0.05),
    # Track rubber and road wheels: FLAT. The running-gear shader owns the tread motion.
    "hull_rubber": dict(rough=0.95, metal=0.0, rough_noise=0.0),
}

DETAIL = dict(
    seed=1311,
    # Panel seams: a 15 mm groove 2 mm deep along panel borders. Cells are (along, across)
    # sizes per dominant surface orientation; each row is offset and each line jittered.
    seam=dict(width=0.015, depth=0.002, cell_top=(0.85, 0.62), cell_side=(1.05, 0.46), cell_end=(0.62, 0.40)),
    # Welds: a 9 mm bead 2.5 mm proud on every mesh edge sharper than 35 degrees.
    weld=dict(width=0.009, height=0.0025, min_dihedral_deg=35.0, min_normal_split_deg=20.0, min_edge_len=0.08, ripple=0.0055,
              parts=("hull_hull", "turret_hull")),
    # M20 bolts: hex heads on a 150 mm pitch beside the seams.
    bolt=dict(pitch=0.15, head_radius=0.0135, height=0.0045, offset=0.032),
    # Dents: 80..300 mm across, 2..8 mm deep, one candidate per 0.55 m cell.
    dents=dict(cell=0.55, radius=(0.08, 0.30), depth=(0.002, 0.008), keep=0.62),
    # Plate undulation and fine grain.
    undulation=dict(amp=0.0011, scale=0.42),
    grain=dict(amp=0.00022, scale=0.011),
    # The step of the 3D central differences that give the surface gradient, and the steepest tilt a texel may hold.
    gradient_eps=0.003,
    max_tilt_deg=62.0,
    # Edge wear: bare steel along convex edges, chipped by noise.
    wear=dict(width=0.012, rough=0.35, metal=1.0),
    # Dust in cavities.
    dust=dict(rough=0.90, depth=0.0016),
    # AO is micro-cavity only (the bake and GTAO supply the macro AO).
    ao=dict(strength=0.55, floor=0.38),
)

#: The team mask, ~2% of the live surface: a roof recognition panel and a turret-side
#: band. Boxes in the hull frame (X forward, Y up, Z lateral), with a surface-normal gate.
#: The mask is `A = 0` in the ORM map (INVERTED: 255 is "bake"), strength set at runtime.
TEAM_MASK = dict(
    roof_panel=dict(part="turret_hull", x=(-1.65, -0.35), z=(-0.62, 0.62), min_ny=0.80),
    side_band=dict(part="turret_hull", x=(-1.80, -0.30), y=(2.08, 2.32), min_nz=0.55),
    # Texels within this of the mask edge are not blended away (a hard edge reads as a painted marking).
    feather=0.006,
)

#: Kit swatch tone -> the ORM it pins: AO 1, roughness, metalness, A 255. The kit's own
#: UVs collapse onto three bake texels (`export_vehicle_kit.py`); the maps must be FLAT
#: and unmasked there or a kit part inherits a dent or a team stripe. `window` is the
#: flat block, in texels, centred on the pinned texel (the bake's own window is 16).
KIT_SWATCH = dict(
    paint=dict(rough=0.78, metal=0.0),
    metal=dict(rough=0.42, metal=0.64),
    dark=dict(rough=0.25, metal=0.0),
    window=16,
)

#: The pinned UVs (literals): a change to the kit source must come through here.
KIT_UVS = {
    "paint": (0.28149, 0.21069),
    "dark": (0.26978, 0.26538),
    "metal": (0.86938, 0.82397),
}

#: Texels of gutter filled outward from each island, so a mip level or a bilinear tap
#: across an island border never reads the neutral fill.
GUTTER = 16

# ---------------------------------------------------------------------------
# Hand-rolled seeded noise. NEVER `mathutils.noise`: Blender 5.2 reseeds it per process.
# ---------------------------------------------------------------------------


def _hash_u32(x):
    """A 32-bit integer hash (the lowbias32 finaliser), vectorised; `x` is uint32."""
    x = x.astype(np.uint32)
    x ^= x >> np.uint32(16)
    x *= np.uint32(0x7FEB352D)
    x ^= x >> np.uint32(15)
    x *= np.uint32(0x846CA68B)
    x ^= x >> np.uint32(16)
    return x


def hash01(ix, iy, iz, seed):
    """Uniform [0, 1) per integer lattice point, deterministic across processes and platforms."""
    h = _hash_u32(ix.astype(np.int64).astype(np.uint32) * np.uint32(73856093) + np.uint32(seed & 0xFFFFFFFF))
    h = _hash_u32(h ^ (iy.astype(np.int64).astype(np.uint32) * np.uint32(19349663)))
    h = _hash_u32(h ^ (iz.astype(np.int64).astype(np.uint32) * np.uint32(83492791)))
    return h.astype(np.float64) / 4294967296.0


def vnoise(p, seed):
    """3D value noise in [0, 1] at points `p` (N x 3), smooth-stepped trilinear."""
    f = np.floor(p)
    t = p - f
    t = t * t * (3.0 - 2.0 * t)
    i = f.astype(np.int64)
    out = 0.0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                out = out + w * hash01(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, seed, octaves=4):
    """Fractal value noise in [0, 1]."""
    amp, total, norm, q = 0.5, 0.0, 0.0, p
    for o in range(octaves):
        total = total + amp * vnoise(q, seed + 101 * o)
        norm += amp
        amp *= 0.5
        q = q * 2.03 + 17.0
    return total / norm


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# Geometry: rasterise the atlas
# ---------------------------------------------------------------------------


def load_parts(glb_path):
    g = Glb(glb_path)
    parts = []
    for name in PARTS:
        pos, nrm, uv, tri = g.primitive(name)
        t = g.node_translation(name)
        # Mesh-local -> hull frame. The turret's node chain nets to the identity
        # (pivot +T, mesh -T), so this is a no-op there; kept honest rather than assumed.
        parts.append(dict(name=name, pos=pos + t, nrm=nrm, uv=uv, tri=tri))
    return parts


def rasterise(parts, size):
    """Every texel whose centre lies inside a UV triangle, with its 3D position, normal
    and triangle id. Later triangles win an overlap (0.9% of texels, measured)."""
    owner = np.full((size, size), -1, dtype=np.int64)
    recs = []  # per triangle: (ys, xs, bary(3 x n), tri_global)
    tri_global = 0
    tris_meta = []  # (part_index, local tri index)
    for pi, p in enumerate(parts):
        uv = p["uv"] * size
        for ti, (a, b, c) in enumerate(p["tri"]):
            ua, ub, uc = uv[a], uv[b], uv[c]
            x0 = int(max(0, np.floor(min(ua[0], ub[0], uc[0]) - 0.5)))
            x1 = int(min(size - 1, np.ceil(max(ua[0], ub[0], uc[0]) - 0.5)))
            y0 = int(max(0, np.floor(min(ua[1], ub[1], uc[1]) - 0.5)))
            y1 = int(min(size - 1, np.ceil(max(ua[1], ub[1], uc[1]) - 0.5)))
            d = (ub[1] - uc[1]) * (ua[0] - uc[0]) + (uc[0] - ub[0]) * (ua[1] - uc[1])
            if abs(d) < 1e-12 or x1 < x0 or y1 < y0:
                tris_meta.append((pi, ti))
                tri_global += 1
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            l1 = ((ub[1] - uc[1]) * (gx - uc[0]) + (uc[0] - ub[0]) * (gy - uc[1])) / d
            l2 = ((uc[1] - ua[1]) * (gx - uc[0]) + (ua[0] - uc[0]) * (gy - uc[1])) / d
            l3 = 1.0 - l1 - l2
            m = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
            if m.any():
                ys, xs = np.nonzero(m)
                ys = ys + y0
                xs = xs + x0
                owner[ys, xs] = tri_global
                recs.append((ys, xs, np.stack([l1[m], l2[m], l3[m]]), tri_global))
            tris_meta.append((pi, ti))
            tri_global += 1
    ys_l, xs_l, bl, tl = [], [], [], []
    for ys, xs, bary, tg in recs:
        keep = owner[ys, xs] == tg
        if keep.any():
            ys_l.append(ys[keep])
            xs_l.append(xs[keep])
            bl.append(bary[:, keep])
            tl.append(np.full(int(keep.sum()), tg, dtype=np.int64))
    ys = np.concatenate(ys_l)
    xs = np.concatenate(xs_l)
    bary = np.concatenate(bl, axis=1)
    tg = np.concatenate(tl)
    return dict(ys=ys, xs=xs, bary=bary, tri=tg, owner=owner, meta=tris_meta)


def dual_basis(Pu, Pv, N):
    """`grad u`, `grad v` on the plane normal to N (closed form of the GLSL frame)."""
    D = np.einsum("ij,ij->i", N, np.cross(Pu, Pv))
    D = np.where(np.abs(D) < 1e-12, 1e-12, D)
    gu = np.cross(Pv, N) / D[:, None]
    gv = -np.cross(Pu, N) / D[:, None]
    return gu, gv


def tangent_frame(Pu, Pv, N):
    """three's `getTangentFrame`, transliterated line for line, for ONE point.

    The 'screen' is an orthographic view down -N with x, y a right-handed basis of the
    plane normal to N, so a front-facing triangle is seen from outside. Returns the
    3x3 matrix whose COLUMNS are T*scale, B*scale, N."""
    N = N / np.linalg.norm(N)
    e1 = np.cross(N, [1.0, 0.0, 0.0] if abs(N[0]) < 0.9 else [0.0, 1.0, 0.0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(N, e1)  # e1 x e2 = N
    A = np.array([[e1 @ Pu, e1 @ Pv], [e2 @ Pu, e2 @ Pv]])
    inv = np.linalg.inv(A)  # (dx, dy) -> (du, dv)
    st0 = inv[:, 0]  # d(u,v)/dx
    st1 = inv[:, 1]  # d(u,v)/dy
    q0 = Pu * st0[0] + Pv * st0[1]  # dFdx(eye_pos)
    q1 = Pu * st1[0] + Pv * st1[1]  # dFdy(eye_pos)
    q1perp = np.cross(q1, N)
    q0perp = np.cross(N, q0)
    T = q1perp * st0[0] + q0perp * st1[0]
    B = q1perp * st0[1] + q0perp * st1[1]
    det = max(T @ T, B @ B)
    scale = 0.0 if det == 0.0 else 1.0 / np.sqrt(det)
    return np.stack([T * scale, B * scale, N], axis=1)


def selfcheck():
    """The closed-form frame against the transliterated GLSL, on random triangles."""
    rng = np.random.default_rng(7)
    worst = 0.0
    for _ in range(200):
        Pu, Pv = rng.normal(size=3), rng.normal(size=3)
        N = np.cross(Pu, Pv)
        N /= np.linalg.norm(N)
        if rng.random() < 0.5:
            N = N + 0.15 * rng.normal(size=3)  # interpolated normals are not the face normal
            N /= np.linalg.norm(N)
            if N @ np.cross(Pu, Pv) < 0:
                N = -N
        tbn = tangent_frame(Pu, Pv, N)
        gu, gv = dual_basis(Pu[None], Pv[None], N[None])
        M = max(np.linalg.norm(gu[0]), np.linalg.norm(gv[0]))
        worst = max(worst, np.abs(tbn[:, 0] - gu[0] / M).max(), np.abs(tbn[:, 1] - gv[0] / M).max())
    if worst > 1e-9:
        raise SystemExit(f"selfcheck: closed-form frame disagrees with the GLSL by {worst:g}")
    return worst


def triangle_vectors(parts):
    """Per global triangle: Pu, Pv (metres per UV unit), the face normal; plus the
    SHARP-EDGE table: per triangle, the creases it owns as `(a, b, convex)` world endpoints.

    Vertices are WELDED by position before edges are paired: this asset splits vertices
    heavily (6,290 vertices over 2,429 positions on the hull), so pairing by index would
    miss every real crease. A crease is a welded edge with exactly two faces whose face
    normals differ by more than `min_dihedral_deg` AND whose vertex normals disagree across
    the edge (a faceted-but-smooth curve, such as the barrel, is shaded as one surface and
    is not a weld)."""
    Pu_l, Pv_l, Fn_l, tri_pos = [], [], [], []
    edges = {}  # (part, weld a, weld b) -> [(tri_global, face normal, (a, b) positions, (na, nb) vertex normals)]
    tg = 0
    for pi, p in enumerate(parts):
        _, inv = np.unique(p["pos"].round(5), axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        for ti, (a, b, c) in enumerate(p["tri"]):
            P0, P1, P2 = p["pos"][a], p["pos"][b], p["pos"][c]
            t0, t1, t2 = p["uv"][a], p["uv"][b], p["uv"][c]
            e1, e2 = P1 - P0, P2 - P0
            d1, d2 = t1 - t0, t2 - t0
            det = d1[0] * d2[1] - d2[0] * d1[1]
            if abs(det) < 1e-14:
                Pu = Pv = np.zeros(3)
            else:
                Pu = (e1 * d2[1] - e2 * d1[1]) / det
                Pv = (e2 * d1[0] - e1 * d2[0]) / det
            fn = np.cross(e1, e2)
            ln = np.linalg.norm(fn)
            fn = fn / ln if ln > 0 else np.array([0.0, 1.0, 0.0])
            Pu_l.append(Pu)
            Pv_l.append(Pv)
            Fn_l.append(fn)
            tri_pos.append((P0, P1, P2))
            for (u, v) in ((a, b), (b, c), (c, a)):
                wu, wv = inv[u], inv[v]
                if wu == wv:
                    continue
                key = (pi, min(wu, wv), max(wu, wv))
                lo, hi = (u, v) if wu < wv else (v, u)
                edges.setdefault(key, []).append((tg, fn, (p["pos"][lo], p["pos"][hi]), (p["nrm"][lo], p["nrm"][hi])))
            tg += 1
    sharp = [[] for _ in range(tg)]
    cos_min = np.cos(np.radians(DETAIL["weld"]["min_dihedral_deg"]))
    cos_hard = np.cos(np.radians(DETAIL["weld"]["min_normal_split_deg"]))
    for key, lst in edges.items():
        if len(lst) != 2:
            continue
        (t_a, n_a, seg, nv_a), (t_b, n_b, seg_b, nv_b) = lst
        if n_a @ n_b > cos_min:
            continue
        split = 0.5 * (nv_a[0] @ nv_b[0] + nv_a[1] @ nv_b[1])
        if split > cos_hard:
            continue
        # Convex when the neighbour's far corner lies below this face's plane.
        pb = tri_pos[t_b]
        seg_set = {tuple(np.round(seg[0], 5)), tuple(np.round(seg[1], 5))}
        far_b = next((q for q in pb if tuple(np.round(q, 5)) not in seg_set), pb[0])
        convex = bool((far_b - seg[0]) @ n_a < 0)
        sharp[t_a].append((seg[0], seg[1], convex))
        sharp[t_b].append((seg[0], seg[1], convex))
    return np.array(Pu_l), np.array(Pv_l), np.array(Fn_l), sharp


# ---------------------------------------------------------------------------
# The detail field
# ---------------------------------------------------------------------------


def _line_dist(a, cell, jitter, seed):
    """Distance to the nearest of a set of jittered, regularly spaced lines along axis `a`."""
    k = np.floor(a / cell + 0.5)
    pos = (k + (hash01(k, np.zeros_like(k), np.zeros_like(k), seed) - 0.5) * jitter) * cell
    d = np.abs(a - pos)
    k2 = np.where(a > pos, k + 1, k - 1)
    pos2 = (k2 + (hash01(k2, np.zeros_like(k2), np.zeros_like(k2), seed) - 0.5) * jitter) * cell
    return np.minimum(d, np.abs(a - pos2)), k


def _plate_grid(a, b, cell, seed):
    """Panel borders on a plane: rows across `b`, jittered columns along `a` with a per-row offset.
    Returns the distance to the nearest border, the along-border coordinate and a border id."""
    d_row, row = _line_dist(b, cell[1], 0.18, seed)
    off = hash01(row, row * 0 + 1, row * 0 + 2, seed + 5) * cell[0]
    d_col, col = _line_dist(a + off, cell[0], 0.22, seed + 9)
    return d_row, d_col, a + off, b


def planar_projections(P, N):
    """The three axis-aligned projections with triplanar weights. (a, b, weight, kind)."""
    w = np.abs(N) ** 4
    w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
    return [
        (P[:, 0], P[:, 2], w[:, 1], "top"),  # normal ~ Y: grid in X, Z
        (P[:, 0], P[:, 1], w[:, 2], "side"),  # normal ~ Z: grid in X, Y
        (P[:, 2], P[:, 1], w[:, 0], "end"),  # normal ~ X: grid in Z, Y
    ]


def height_and_materials(P, N, part, tri, sharp, want_materials=True):
    """The per-texel height (metres, +out), cavity (0..1), wear (0..1), dust (0..1).

    `want_materials=False` returns only the height (the four displaced evaluations that
    give the surface gradient never need the material masks)."""
    n = len(P)
    seed = DETAIL["seed"]
    h = np.zeros(n)
    cav = np.zeros(n)
    seam_amount = np.zeros(n)
    flat = part == PARTS.index("hull_rubber")  # track rubber carries no relief
    weldable = np.isin(part, [PARTS.index(x) for x in DETAIL["weld"]["parts"]])
    live = ~flat

    # Plate undulation and fine grain (every non-rubber texel).
    u = DETAIL["undulation"]
    h += live * u["amp"] * (fbm(P / u["scale"], seed + 1, 3) - 0.5) * 2.0
    g = DETAIL["grain"]
    h += live * g["amp"] * (fbm(P / g["scale"], seed + 2, 2) - 0.5) * 2.0

    # Panel seams, bolts (triplanar).
    s = DETAIL["seam"]
    b = DETAIL["bolt"]
    for a_, b_, w, kind in planar_projections(P, N):
        cell = s["cell_" + kind]
        d_row, d_col, aa, bb = _plate_grid(a_, b_, cell, seed + 31 + len(kind))
        d = np.minimum(d_row, d_col)
        half = s["width"] * 0.5
        groove = 1.0 - smoothstep(half * 0.55, half * 1.15, d)
        h -= live * w * s["depth"] * groove
        cav += live * w * groove
        seam_amount += live * w * groove
        # Bolts: on the along-row border, offset into the plate, every `pitch`.
        d_to_row = d_row
        ls = bb  # across; bolts line up along the row border, running along `aa`
        k = np.floor(aa / b["pitch"] + 0.5)
        along = aa - k * b["pitch"]
        across = d_to_row - b["offset"]
        r = np.sqrt(along ** 2 + across ** 2)
        bolt = np.sqrt(np.clip(1.0 - (r / b["head_radius"]) ** 2, 0.0, 1.0))
        keep = hash01(k.astype(np.int64), np.floor(ls / cell[1]).astype(np.int64), np.zeros(n, np.int64), seed + 77) < 0.85
        h += live * w * b["height"] * bolt * keep
        cav += live * w * 0.8 * smoothstep(b["head_radius"] * 2.0, b["head_radius"] * 1.05, r) * keep * (r > b["head_radius"])

    # Dents: one jittered candidate per cell, evaluated over the 27 neighbouring cells.
    dn = DETAIL["dents"]
    q = P / dn["cell"]
    base = np.floor(q).astype(np.int64)
    for dz in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ci = base + np.array([dx, dy, dz])
                keep = hash01(ci[:, 0], ci[:, 1], ci[:, 2], seed + 201) < dn["keep"]
                cx = (ci[:, 0] + hash01(ci[:, 0], ci[:, 1], ci[:, 2], seed + 202)) * dn["cell"]
                cy = (ci[:, 1] + hash01(ci[:, 0], ci[:, 1], ci[:, 2], seed + 203)) * dn["cell"]
                cz = (ci[:, 2] + hash01(ci[:, 0], ci[:, 1], ci[:, 2], seed + 204)) * dn["cell"]
                rad = dn["radius"][0] + (dn["radius"][1] - dn["radius"][0]) * hash01(ci[:, 0], ci[:, 1], ci[:, 2], seed + 205) ** 1.6
                dep = dn["depth"][0] + (dn["depth"][1] - dn["depth"][0]) * hash01(ci[:, 0], ci[:, 1], ci[:, 2], seed + 206)
                dist = np.sqrt((P[:, 0] - cx) ** 2 + (P[:, 1] - cy) ** 2 + (P[:, 2] - cz) ** 2)
                prof = np.exp(-((dist / rad) ** 2) * 2.2)
                # A dent also lifts a faint rim around itself.
                rim = np.exp(-(((dist - rad * 1.05) / (rad * 0.22)) ** 2))
                h += live * keep * (-dep * prof + 0.18 * dep * rim)
                cav += live * keep * 0.7 * prof * (dep / dn["depth"][1])

    # Welds and edge wear along sharp mesh edges, per triangle.
    wd = DETAIL["weld"]
    wr = DETAIL["wear"]
    wear = np.zeros(n)
    edge_prox = np.zeros(n)
    order = np.argsort(tri, kind="stable")
    tri_sorted = tri[order]
    uniq, first = np.unique(tri_sorted, return_index=True)
    last = np.append(first[1:], len(tri_sorted))
    for tg, lo, hi in zip(uniq.tolist(), first.tolist(), last.tolist()):
        segs = sharp[tg]
        if not segs:
            continue
        idx = order[lo:hi]
        pp = P[idx]
        for (a0, a1, convex) in segs:
            ev = a1 - a0
            ln2 = ev @ ev
            if ln2 < 1e-12:
                continue
            t = np.clip(((pp - a0) @ ev) / ln2, 0.0, 1.0)
            dist = np.linalg.norm(pp - (a0 + t[:, None] * ev), axis=1)
            s_along = t * np.sqrt(ln2)
            long_enough = ln2 >= wd["min_edge_len"] ** 2
            rip = 0.5 + 0.5 * np.sin(s_along * (2.0 * np.pi / wd["ripple"]))
            bead = np.exp(-((dist / (wd["width"] * 0.55)) ** 2) * 1.6) * (0.78 + 0.22 * rip)
            ok = weldable[idx] & long_enough
            h[idx] += ok * wd["height"] * bead
            cav[idx] += ok * 0.55 * smoothstep(wd["width"] * 1.8, wd["width"] * 0.9, dist) * (dist > wd["width"] * 0.6)
            if convex:
                edge_prox[idx] = np.maximum(edge_prox[idx], 1.0 - np.clip(dist / wr["width"], 0.0, 1.0))
    chip = fbm(P / 0.035, seed + 41, 3)
    wear = smoothstep(0.42, 0.62, edge_prox * 0.95 + (chip - 0.5) * 0.9 + 0.1) * (edge_prox > 0)
    wear *= live

    if not want_materials:
        return h, None, None, None, None
    # Dust settles in the grooves and the dents.
    dust = np.clip(cav * 1.3, 0.0, 1.0) * smoothstep(0.35, 0.65, fbm(P / 0.09, seed + 51, 3))
    return h, np.clip(cav, 0.0, 1.0), wear, dust, seam_amount


def team_mask(P, N, part):
    """True where the ORM alpha is 0 (team colour)."""
    m = np.zeros(len(P), dtype=bool)
    r = TEAM_MASK["roof_panel"]
    m |= (
        (part == PARTS.index(r["part"]))
        & (P[:, 0] >= r["x"][0]) & (P[:, 0] <= r["x"][1])
        & (P[:, 2] >= r["z"][0]) & (P[:, 2] <= r["z"][1])
        & (N[:, 1] >= r["min_ny"])
    )
    s = TEAM_MASK["side_band"]
    m |= (
        (part == PARTS.index(s["part"]))
        & (P[:, 0] >= s["x"][0]) & (P[:, 0] <= s["x"][1])
        & (P[:, 1] >= s["y"][0]) & (P[:, 1] <= s["y"][1])
        & (np.abs(N[:, 2]) >= s["min_nz"])
    )
    return m


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def dilate(img, valid, iters):
    """Fill uncovered texels from their covered neighbours, `iters` rings deep (in place)."""
    valid = valid.copy()
    for _ in range(iters):
        grow = np.zeros_like(valid)
        acc = np.zeros(img.shape, dtype=np.float64)
        cnt = np.zeros(valid.shape, dtype=np.float64)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv = np.roll(valid, (dy, dx), axis=(0, 1))
            si = np.roll(img, (dy, dx), axis=(0, 1))
            take = sv & ~valid
            acc += np.where(take[..., None], si, 0.0)
            cnt += take
            grow |= take
        if not grow.any():
            break
        fill = grow
        img[fill] = (acc[fill] / cnt[fill][:, None])
        valid |= fill
    return img


def kit_uvs_from_source(kit_path):
    """The distinct pinned UVs of the kit source, to be checked against `KIT_UVS`."""
    g = Glb(kit_path)
    seen = set()
    for n in g.js["nodes"]:
        if "mesh" not in n:
            continue
        pr = g.js["meshes"][n["mesh"]]["primitives"][0]
        for uv in g.accessor(pr["attributes"]["TEXCOORD_0"]):
            seen.add((round(float(uv[0]), 5), round(float(uv[1]), 5)))
    return seen


def generate(glb_path, kit_path, size=SIZE):
    selfcheck()
    parts = load_parts(glb_path)
    pinned = kit_uvs_from_source(kit_path)
    expect = {(round(a, 5), round(b, 5)) for a, b in KIT_UVS.values()}
    if pinned != expect:
        raise SystemExit(f"kit source pins {sorted(pinned)}, the table expects {sorted(expect)} -- review KIT_UVS")

    r = rasterise(parts, size)
    ys, xs, bary, tri = r["ys"], r["xs"], r["bary"], r["tri"]
    meta = r["meta"]
    tri_part = np.array([m[0] for m in meta])
    Pu_t, Pv_t, Fn_t, sharp = triangle_vectors(parts)

    # Per-texel position and normal by barycentric interpolation.
    n = len(ys)
    P = np.zeros((n, 3))
    N = np.zeros((n, 3))
    for pi, p in enumerate(parts):
        sel = tri_part[tri] == pi
        if not sel.any():
            continue
        local = np.array([meta[t][1] for t in tri[sel]])
        corners = p["tri"][local]
        b = bary[:, sel]
        P[sel] = b[0][:, None] * p["pos"][corners[:, 0]] + b[1][:, None] * p["pos"][corners[:, 1]] + b[2][:, None] * p["pos"][corners[:, 2]]
        N[sel] = b[0][:, None] * p["nrm"][corners[:, 0]] + b[1][:, None] * p["nrm"][corners[:, 1]] + b[2][:, None] * p["nrm"][corners[:, 2]]
    ln = np.linalg.norm(N, axis=1, keepdims=True)
    N = N / np.where(ln > 0, ln, 1.0)
    part = tri_part[tri]

    h, cav, wear, dust, seam_amount = height_and_materials(P, N, part, tri, sharp)

    # The surface gradient by CENTRAL DIFFERENCES IN 3D: the detail table is a function of
    # position, so it is evaluated at P +- eps along each UV axis' own direction on the
    # surface. That needs no neighbouring texel, so an island border, an overlap or a
    # sliver triangle cannot poison it. h_u = dh/du, in metres per UV unit.
    Pu_n, Pv_n = Pu_t[tri], Pv_t[tri]
    lu = np.linalg.norm(Pu_n, axis=1)
    lv = np.linalg.norm(Pv_n, axis=1)
    eps = DETAIL["gradient_eps"]
    du = Pu_n / np.maximum(lu, 1e-9)[:, None]
    dv = Pv_n / np.maximum(lv, 1e-9)[:, None]
    hp_u = height_and_materials(P + eps * du, N, part, tri, sharp, False)[0]
    hm_u = height_and_materials(P - eps * du, N, part, tri, sharp, False)[0]
    hp_v = height_and_materials(P + eps * dv, N, part, tri, sharp, False)[0]
    hm_v = height_and_materials(P - eps * dv, N, part, tri, sharp, False)[0]
    h_u = (hp_u - hm_u) / (2.0 * eps) * lu  # dh/du per UV unit
    h_v = (hp_v - hm_v) / (2.0 * eps) * lv
    gu_t, gv_t = dual_basis(Pu_n, Pv_n, N)
    M = np.maximum(np.linalg.norm(gu_t, axis=1), np.linalg.norm(gv_t, axis=1))
    mx = -h_u * M
    my = h_v * M
    nm = np.stack([mx, my, np.ones(n)], axis=1)
    # A texel cannot encode more than MAX_TILT; a sliver triangle's frame is extreme.
    tilt_cap = np.tan(np.radians(DETAIL["max_tilt_deg"]))
    mag = np.linalg.norm(nm[:, :2], axis=1)
    nm[:, :2] *= np.where(mag > tilt_cap, tilt_cap / np.maximum(mag, 1e-12), 1.0)[:, None]
    nm /= np.linalg.norm(nm, axis=1, keepdims=True)
    cover = r["owner"] >= 0

    # --- ORM ---------------------------------------------------------------
    seed = DETAIL["seed"]
    base_rough = np.array([BASE[p]["rough"] for p in PARTS])[part]
    base_metal = np.array([BASE[p]["metal"] for p in PARTS])[part]
    base_noise = np.array([BASE[p]["rough_noise"] for p in PARTS])[part]
    rough = base_rough + base_noise * (fbm(P / 0.18, seed + 61, 3) - 0.5) * 2.0
    rough = rough + 0.04 * (fbm(P / 0.02, seed + 62, 2) - 0.5)
    rough = np.where(dust > 0, rough + (DETAIL["dust"]["rough"] - rough) * dust * 0.8, rough)
    metal = base_metal * np.ones(n)
    wr = DETAIL["wear"]
    rough = rough + (wr["rough"] - rough) * wear
    metal = metal + (wr["metal"] - metal) * wear
    ao = 1.0 - DETAIL["ao"]["strength"] * cav
    ao = np.clip(ao, DETAIL["ao"]["floor"], 1.0)
    # Bare steel is not occluded.
    ao = np.where(wear > 0.5, np.maximum(ao, 0.9), ao)
    alpha = np.where(team_mask(P, N, part), 0, 255)

    ORM = np.zeros((size, size, 4))
    ORM[ys, xs, 0] = ao
    ORM[ys, xs, 1] = np.clip(rough, 0.02, 1.0)
    ORM[ys, xs, 2] = np.clip(metal, 0.0, 1.0)
    ORM[ys, xs, 3] = alpha / 255.0
    NMAP = np.zeros((size, size, 3))
    NMAP[ys, xs] = nm * 0.5 + 0.5

    # Neutral fill, then a gutter dilated out of the covered texels.
    ORM[~cover] = [1.0, 0.8, 0.0, 1.0]
    NMAP[~cover] = [0.5, 0.5, 1.0]
    NMAP = dilate(NMAP, cover, GUTTER)
    ORM = dilate(ORM, cover, GUTTER)
    ORM[..., 3] = np.where(ORM[..., 3] > 0.5, 1.0, 0.0)  # binary alpha, also after the gutter

    # --- Kit swatches ---------------------------------------------------------
    sw = KIT_SWATCH
    half = sw["window"] // 2
    swatches = {}
    for tone, (u, v) in KIT_UVS.items():
        px, py = int(np.floor(u * size)), int(np.floor(v * size))
        y0, y1, x0, x1 = py - half + 1, py + half + 1, px - half + 1, px + half + 1
        NMAP[y0:y1, x0:x1] = [0.5, 0.5, 1.0]
        ORM[y0:y1, x0:x1] = [1.0, sw[tone]["rough"], sw[tone]["metal"], 1.0]
        swatches[tone] = dict(uv=[u, v], texel=[px, py], window=sw["window"], rough=sw[tone]["rough"], metal=sw[tone]["metal"])

    to8 = lambda a: np.clip(np.rint(a * 255.0), 0, 255).astype(np.uint8)
    normal8 = to8(NMAP)
    orm8 = to8(ORM)

    # The team-region luma of the BASE colour is stamped by the maps pass (it owns the bake decode).
    # Surface area per texel = |Pu x Pv| / size^2.
    texel_area = np.linalg.norm(np.cross(Pu_t[tri], Pv_t[tri]), axis=1) / float(size * size)
    total_area = float(texel_area.sum())
    team_area = float(texel_area[alpha == 0].sum())

    # --- Probes: a frozen table of (uv, target object-space normal) for the frame check ------
    # Chosen deterministically among the texels with the strongest tilt, spread over the parts.
    tilt = np.arccos(np.clip(nm[:, 2], -1, 1))
    probes = []
    rng = np.random.default_rng(11)
    for pi, pn in enumerate(PARTS):
        sel = np.nonzero((part == pi) & (tilt > np.radians(6.0)) & (tilt < np.radians(DETAIL["max_tilt_deg"] - 4.0)))[0]
        if len(sel) == 0:
            continue
        take = rng.choice(sel, size=min(60, len(sel)), replace=False)
        for i in sorted(take.tolist()):
            gu, gv = gu_t[i], gv_t[i]
            target = N[i] - h_u[i] * gu - h_v[i] * gv
            target = target / np.linalg.norm(target)
            probes.append(dict(
                part=pn, x=int(xs[i]), y=int(ys[i]),
                pos=[round(float(c), 5) for c in P[i]],
                n=[round(float(c), 5) for c in N[i]],
                target=[round(float(c), 5) for c in target],
                tri=int(meta[tri[i]][1]),
            ))

    report = dict(
        size=size,
        parts=list(PARTS),
        team_area_m2=round(team_area, 4),
        surface_area_m2=round(total_area, 4),
        team_fraction=round(team_area / total_area, 5),
        covered_fraction=round(float(cover.mean()), 5),
        swatches=swatches,
        probes=probes,
        detail=DETAIL,
        team_mask=TEAM_MASK,
    )
    return normal8, orm8, report


def source_hash():
    """The hash of everything that decides the output: this file, the GLB reader and the kit UV pins."""
    h = hashlib.sha256()
    for f in ("lavi_maps.py", "glb_read.py"):
        h.update(open(os.path.join(HERE, f), "rb").read())
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--kit", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=SIZE)
    a = ap.parse_args()
    normal8, orm8, report = generate(a.glb, a.kit, a.size)
    os.makedirs(a.out, exist_ok=True)
    # PIL's default PNG encoder is deterministic for a given zlib; compress_level pinned.
    Image.fromarray(normal8, "RGB").save(os.path.join(a.out, "normal.png"), compress_level=9)
    Image.fromarray(orm8, "RGBA").save(os.path.join(a.out, "orm.png"), compress_level=9)
    report["generator_sha256"] = source_hash()
    with open(os.path.join(a.out, "report.json"), "w") as f:
        json.dump(report, f, sort_keys=True)
    print(
        f"LAVI_MAPS_OK {a.size}px covered {report['covered_fraction']:.1%}, "
        f"team mask {report['team_area_m2']} of {report['surface_area_m2']} m2 = {report['team_fraction']:.2%}, "
        f"{len(report['probes'])} probes"
    )


if __name__ == "__main__":
    main()
