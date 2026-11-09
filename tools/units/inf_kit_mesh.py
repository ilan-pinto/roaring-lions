"""Placed mesh parts for the infantry kit (GH-746 / GH-826, the v7 set). Blender only for `piece_from`.

The approved v7 parts live in `art/parts/inf_kit/v7/<part>.glb` (+ the `.blend` that made each), authored in the
KIT FRAME: metres, +X front / outward / bore, +Y left, +Z up, the mount at the origin (the mount is described per
part in `kit_parts_report.json`), no material, no UV. This module

  * reads one (a plain glTF parse: no importer, no scene, cached by name; glTF y-up -> the kit's z-up),
  * places it: a per-axis scale in the kit frame, then a rotation that takes kit +X / +Z onto two world axes, then
    a translation (`place`),
  * fits a soft good to a figure: `ring_fit` pushes every vertex that lies inside the body, or within a clearance of
    it, out to that clearance along the radius of the figure's own ring sampler (`inf_kit_geo.Wrap`, the one the
    procedural soft goods were built on); `conform_shift` / `seat_shift` move a rigid piece out along a direction
    until nothing of it is inside the surfaces it stands on,
  * and turns the result into a `Piece` the exporter accepts as it accepts the procedural ones (rigid weight 1 to the
    row's bone, every UV pinned to the row's texel, no material).

Everything here is deterministic and hand-rolled; no `mathutils.noise`.
"""
import json
import math
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
V7_DIR = os.path.join(REPO, "art", "parts", "inf_kit", "v7")

#: part names -> source file stems, where they differ
#: `headset_l_built` is outboard +Y (the kit frame's LEFT, +Y); the rig's `_L` bone side stands at NEGATIVE y, so the
#: rig's L cup is `headset_r_built` (outboard -Y) and the rig's R cup is `headset_l_built` (ruling, 9 Nov).
SOURCES = ("carrier", "throat_protector", "groin_apron", "battle_belt", "mag_pouch", "grenade_pouch", "radio_pack",
           "radio_pouch", "radio_panel", "phone_case", "red_dot", "scope", "laser", "suppressor", "weapon_light",
           "nvg_mono", "nvg_bino", "headset_l_built", "headset_r_built", "counterweight", "ir_strobe")

_CACHE = {}


def read_glb(path):
    """(vertices (n, 3) in the kit frame, triangles (m, 3) int) of a one-mesh GLB."""
    with open(path, "rb") as fh:
        data = fh.read()
    jlen, _jt = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, _bt = struct.unpack("<II", data[off:off + 8])
    blob = data[off + 8:off + 8 + blen]
    prims = [p for m in gltf["meshes"] for p in m["primitives"]]
    if len(prims) != 1:
        raise ValueError(f"{path}: {len(prims)} primitives, a kit part is one")
    prim = prims[0]

    def accessor(i):
        a = gltf["accessors"][i]
        bv = gltf["bufferViews"][a["bufferView"]]
        dt = {5126: "<f4", 5123: "<u2", 5125: "<u4", 5121: "u1"}[a["componentType"]]
        n = {"SCALAR": 1, "VEC3": 3}[a["type"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(blob, dtype=dt, count=a["count"] * n, offset=start).reshape(a["count"], n).astype(np.float64)

    pos = accessor(prim["attributes"]["POSITION"])
    idx = accessor(prim["indices"]).reshape(-1).astype(np.int64)
    # glTF is y-up: (x, y, z) -> the kit's (x, -z, y)
    kit = np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], axis=1)
    return kit, idx.reshape(-1, 3)


def source(name):
    """The part's vertices and triangles in the kit frame (a copy: callers move them)."""
    if name not in _CACHE:
        if name not in SOURCES:
            raise KeyError(f"{name}: not a v7 kit part")
        _CACHE[name] = read_glb(os.path.join(V7_DIR, name + ".glb"))
    v, t = _CACHE[name]
    return v.copy(), t.copy()


def signed_volume(V, T):
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def frame_axes(x_axis, z_axis):
    """(X, Y, Z) orthonormal and right-handed: X as given, Z as close to `z_axis` as stays perpendicular to X."""
    X = unit(x_axis)
    Z = np.asarray(z_axis, dtype=float)
    Z = unit(Z - X * float(Z @ X))
    Y = np.cross(Z, X)
    return X, Y, Z


def place(V, origin, x_axis, z_axis, scale=(1.0, 1.0, 1.0)):
    """Kit-frame vertices -> world: per-axis scale, then the rotation taking kit +X / +Z to `x_axis` / `z_axis`, then `origin`."""
    X, Y, Z = frame_axes(x_axis, z_axis)
    R = np.stack([X, Y, Z], axis=1)
    return (V * np.asarray(scale, dtype=float)) @ R.T + np.asarray(origin, dtype=float)


# ------------------------------------------------------------ ring fitting

def ring_radius_fn(wr):
    """f(points (n, 3)) -> (radius of the wrap's body ring at each point's height and angle, the point's own radius, angle).
    The ring is the sampler's `R[j][k]` (radii from the wrap's centre line), bilinear between rows and cyclic between
    columns; a missing sample takes the mean of the valid ones at its row. Rows above and below the last are clamped."""
    wr.sample()
    rows = np.array(wr.rows_t, dtype=float)
    cols = np.array(wr.cols, dtype=float)
    ncol = len(cols)
    R = np.full((len(rows), ncol), np.nan)
    for j in range(len(rows)):
        for k in range(ncol):
            if wr.R[j][k] is not None:
                R[j, k] = wr.R[j][k]
    for j in range(len(rows)):
        if np.isnan(R[j]).all():
            R[j] = np.nanmean(R) if not np.isnan(R).all() else 0.18
        elif np.isnan(R[j]).any():
            R[j, np.isnan(R[j])] = np.nanmean(R[j])
    e1 = np.array(wr.e1)
    e2 = np.array(wr.e2)
    a = np.array(wr.a)
    o = np.array(wr.o)

    def centre(t):
        c = wr.centre(float(t))
        return np.array(c)

    def fn(P):
        P = np.asarray(P, dtype=float)
        out_r = np.empty(len(P))
        rad = np.empty(len(P))
        ang = np.empty(len(P))
        cache = {}
        for i, p in enumerate(P):
            t = float((p - o) @ a)
            key = round(t, 3)
            if key not in cache:
                cache[key] = centre(t)
            d = p - cache[key]
            d = d - a * float(d @ a)
            r = float(np.linalg.norm(d))
            g = math.degrees(math.atan2(float(d @ e2), float(d @ e1))) % 360.0
            jf = float(np.interp(t, rows, np.arange(len(rows))))
            j0 = int(math.floor(jf))
            j1 = min(j0 + 1, len(rows) - 1)
            u = jf - j0
            kf = g / (360.0 / ncol)
            k0 = int(math.floor(kf)) % ncol
            k1 = (k0 + 1) % ncol
            w = kf - math.floor(kf)
            r0 = R[j0, k0] * (1 - w) + R[j0, k1] * w
            r1 = R[j1, k0] * (1 - w) + R[j1, k1] * w
            out_r[i] = r0 * (1 - u) + r1 * u
            rad[i] = r
            ang[i] = g
        return out_r, rad, ang

    return fn


def vertex_neighbours(T, n):
    nb = [set() for _ in range(n)]
    for a, b, c in T:
        nb[a].update((b, c))
        nb[b].update((a, c))
        nb[c].update((a, b))
    return [sorted(s) for s in nb]


def ring_fit(wr, V, T, clear, smooth=3, cap=0.06):
    """Push every vertex that lies inside the body ring, or within `clear` of it, out along its radius to `clear`.
    The displacement field is relaxed over the mesh edges (a vertex never takes less than its own need), so the
    shell does not kink where one vertex was pushed and its neighbour was not. Returns (V', stats)."""
    fn = ring_radius_fn(wr)
    ring_r, rad, ang = fn(V)
    need = np.clip(ring_r + clear - rad, 0.0, cap)
    nb = vertex_neighbours(T, len(V))
    d = need.copy()
    for _ in range(smooth):
        nd = d.copy()
        for i in range(len(V)):
            if nb[i]:
                nd[i] = max(need[i], 0.5 * d[i] + 0.5 * float(np.mean(d[nb[i]])) * 0.85)
        d = nd
    # out along the radius: from the centre line through the vertex
    o = np.array(wr.o)
    a = np.array(wr.a)
    e1, e2 = np.array(wr.e1), np.array(wr.e2)
    W = V.copy()
    for i, p in enumerate(V):
        t = float((p - o) @ a)
        c = np.array(wr.centre(t))
        dv = p - c
        dv = dv - a * float(dv @ a)
        n = np.linalg.norm(dv)
        if n > 1e-9 and d[i] > 0:
            W[i] = p + dv / n * d[i]
    r2, rad2, _ = fn(W)
    stats = {"vertices": int(len(V)), "pushed": int((d > 1e-5).sum()), "max_push_mm": round(1000 * float(d.max()), 2),
             "inside_before": int((ring_r - rad > 0).sum()), "inside_after": int((r2 - rad2 > 1e-4).sum()),
             "min_clear_after_mm": round(1000 * float((rad2 - r2).min()), 2)}
    return W, stats


# ------------------------------------------------------- rigid clearance

def outer_gap(bvhs, V, d, reach=0.25, near=0.15):
    """For each vertex, how far it stands OUTBOARD of the outermost surface of `bvhs` along `d` (metres; negative when it
    is inside it). A ray from `reach` outboard of the vertex, down -d, first hit over all the BVHs. NaN where no hit lies
    within `near` of the vertex (a surface elsewhere is not what the part stands on)."""
    from mathutils import Vector
    d = unit(d)
    dv = Vector(d)
    gaps = np.full(len(V), np.nan)
    for i, p in enumerate(V):
        o = Vector(p) + dv * reach
        best = None
        for b in bvhs:
            loc, _n, _i, dist = b.ray_cast(o, -dv, reach + near)
            if loc is not None and (best is None or dist < best):
                best = dist
        if best is not None:
            g = best - reach          # the hit lies `best` down the ray from reach out: the vertex is (best - reach) outboard of it
            if abs(g) <= near:
                gaps[i] = g
    return gaps


def clear_shift(bvhs, V, d, gap=0.001, mask=None, **kw):
    """The shift along `d` (>= 0) that leaves every vertex of V (of `mask`, the part's body-side face; all when None) at least
    `gap` outboard of the surfaces it stands on."""
    g = outer_gap(bvhs, V, d, **kw)
    ok = ~np.isnan(g)
    if mask is not None:
        ok &= np.asarray(mask)
    if not ok.any():
        return 0.0, g
    return max(0.0, gap - float(g[ok].min())), g


def surf_frame(bvhs, p, direction, du, dv_, up=(0, 0, 1), reach=0.5):
    """(point, outward normal) of the outermost surface of `bvhs` at p (cast down `direction` from `reach` off), the normal
    from a small cross of neighbouring hits (`du` across, `dv_` up), so a noisy face does not decide the frame. None when it misses."""
    from mathutils import Vector
    direction = unit(direction)
    u_ax = unit(np.cross(up, direction))
    v_ax = np.asarray(up, dtype=float)

    def hit(q):
        o = Vector(q) - Vector(direction) * reach
        best = None
        for b in bvhs:
            loc, _n, _i, dist = b.ray_cast(o, Vector(direction), reach * 2)
            if loc is not None and (best is None or dist < best[0]):
                best = (dist, np.array(loc))
        return None if best is None else best[1]
    c = hit(p)
    if c is None:
        return None, None
    a = hit(np.asarray(p) + u_ax * du)
    b = hit(np.asarray(p) - u_ax * du)
    e = hit(np.asarray(p) + v_ax * dv_)
    f = hit(np.asarray(p) - v_ax * dv_)
    tu = (a - b) if a is not None and b is not None else u_ax * 2 * du
    tv = (e - f) if e is not None and f is not None else v_ax * 2 * dv_
    n = unit(np.cross(tu, tv))
    if n @ direction > 0:
        n = -n
    return c, n


