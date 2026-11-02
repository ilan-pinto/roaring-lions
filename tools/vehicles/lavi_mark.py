#!/usr/bin/env python3
"""L3 (GH-943): the Lavi's TEAM MARK -- where it is, how much of the surface it covers, and how bright the
bake is under it.

    python3 tools/vehicles/lavi_mark.py --id mbt_lavi --glb art/meshes/vehicles/mbt_lavi.glb --kit art/parts/kit/mbt_lavi.glb [--size 1024]
    python3 tools/vehicles/lavi_mark.py --id officer_armour --glb art/meshes/vehicles/officer_armour.glb

Three vehicles share one hull and one bake and each has its OWN boxes (`MARKS`): the Lavi, the Ambush Tank
(`mbt_lavi_camo`, a draped net on the same hull) and the command Lavi (`officer_armour`, a raised cupola on the
same turret). The two variants have no kit, so they take no `--kit` and their exclusion pins are `NO_PIN`.

The mark is a clean rectangular roof recognition panel plus a band on each side of the turret. It is NOT a
texture: the shader (`packages/render/src/three/units/team-mask.ts`) tests the fragment's OBJECT-space position
and normal against the boxes in `MARK` below, so its edges are straight lines in the Lavi's own frame and cannot
follow a UV seam, and it costs no texture memory. The boxes ride in the GLB as `material.extras.rl_team_mark`
(`tools/src/meshes/mark-pass.ts` writes them from here). Because the test is on the mesh-local position, the mark
turns with the turret: the turret meshes hang off `turret_pivot` and the shader never sees a world matrix.

What this script measures (the shader needs only the numbers in `MARK`):
  - `team_fraction`: the share of the covered surface (texel areas, like the shader sees it) the mark covers;
  - `luma`: the mean LINEAR luminance of the BASE COLOUR under the mark (texels for the Lavi; area-weighted over
    the triangles' own UV texels for a variant, whose added parts have no texel area), which the hook divides by so the
    panel keeps the bake's grime and averages to the team colour;
  - the kit source still pins its parts to the three UVs the shader excludes (the kit is merged INTO the host
    geometry at runtime, so a kit part inside a box would otherwise be painted).

`mask_np` is the numpy twin of the GLSL; `team-mask.test.ts` holds the two to the same boxes.
"""
import argparse
import io
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glb_read import Glb  # noqa: E402

SIZE = 1024

#: A kit-less vehicle's exclusion pin: a UV outside [0, 1], which no fragment ever has.
NO_PIN = [-1.0, -1.0]

#: The Lavi's mark, metres, in the SHIPPED mesh-local frame (X forward, Y up, Z lateral; the turret's meshes carry
#: the hull frame, so the mark turns with the turret). Only meshes whose `rl_role` is `hull` carry it: the barrel,
#: the antennas and the tracks are other roles.
MARK = dict(
    # An up-facing box on the turret roof. `z_half`: the box is symmetric about the centreline.
    roof=dict(x=[-1.70, -0.40], z_half=0.70, y=[2.28, 2.56], min_ny=0.60),
    # A band on each flank of the turret: side-facing surfaces (|nz|), either side.
    band=dict(x=[-1.70, -0.40], y=[2.12, 2.30], min_nz=0.60),
    # The kit is merged INTO the host geometry at runtime, and its parts have no UVs of their own: the kit pass
    # collapses every one onto one of three bake texels (`export_vehicle_kit.py`: paint, dark, metal). A fragment whose
    # UV is within `exclude_radius` of one of them is a kit part and is never marked.
    exclude_uv=[[0.28149, 0.21069], [0.26978, 0.26538], [0.86938, 0.82397]],
    exclude_radius=0.0002,
    # The edge is a hard line anti-aliased over this many screen pixels.
    edge_px=1.0,
)

#: The command Lavi's mark. Same hull and turret as the Lavi, but its raised commander's cupola (x -1.38..-0.63,
#: z -0.03..0.74, to y 2.96) stands in the middle of the Lavi's roof box and would hide about a third of that panel,
#: leaving an L. So the ROOF panel moves FORWARD of the cupola, onto the clean forward roof (up-facing, y 2.2-2.4),
#: wider in z to make up the area the lower roof gives (2.45 m2 against the Lavi's 2.27). The flank band is the
#: Lavi's: the cupola's walls stand above it (y > 2.4) and its x range is the turret's flank under the cupola.
#: The antenna stubs, whips and mast are `turret_metal`, a role the mark never touches.
MARK_OFFICER = dict(
    roof=dict(x=[-0.55, 0.60], z_half=0.80, y=[2.18, 2.50], min_ny=0.60),
    band=dict(x=[-1.70, -0.40], y=[2.12, 2.30], min_nz=0.60),
    exclude_uv=[NO_PIN, NO_PIN, NO_PIN],
    exclude_radius=0.0002,
    edge_px=1.0,
)

#: The Ambush Tank's mark. Its draped net (3,594 turret triangles against the Lavi's 943) is lumpy and carries 59
#: foliage tufts, thin blades standing up to y ~3.4. Painted with the Lavi's clean thresholds the panel came out as
#: blue spikes (first cut, looked at on the garage bay: every tuft in the box turned blue). So the roof panel stays
#: BELOW the tuft tips (`y` top 2.95; the net's own hump tops out near 2.8) and wants a steeper surface than the
#: Lavi's (`min_ny` 0.55, a blade is near vertical), and it is wider (x -1.55..-0.50, |z| <= 0.55) to take the area the
#: stricter normal test gives back. The band is the Lavi's flank band, narrowed to the same x range; the net hangs
#: over the flank there, so its faces are lumpier (`min_nz` 0.45). A few band faces fall on `hull_hull`: the net draped
#: beside the turret ring (about 14% of the marked area, which is why the test allows 80% on the turret, not 95%).
MARK_CAMO = dict(
    roof=dict(x=[-1.55, -0.50], z_half=0.55, y=[2.28, 2.95], min_ny=0.55),
    band=dict(x=[-1.55, -0.50], y=[2.12, 2.30], min_nz=0.45),
    exclude_uv=[NO_PIN, NO_PIN, NO_PIN],
    exclude_radius=0.0002,
    edge_px=1.0,
)

MARKS = {"mbt_lavi": MARK, "mbt_lavi_camo": MARK_CAMO, "officer_armour": MARK_OFFICER}
PARTS = ("hull_hull", "hull_rubber", "turret_hull", "turret_metal")
MARK_ROLES = ("hull_hull", "turret_hull")  # `rl_role` hull meshes; everything else is untouched


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




def mask_np(P, N, mark=None):
    """True where the mark covers a point with object-space position `P` (n x 3) and normal `N`."""
    m = MARK if mark is None else mark
    r, b = m["roof"], m["band"]
    roof = (
        (P[:, 0] >= r["x"][0]) & (P[:, 0] <= r["x"][1]) & (np.abs(P[:, 2]) <= r["z_half"])
        & (P[:, 1] >= r["y"][0]) & (P[:, 1] <= r["y"][1]) & (N[:, 1] >= r["min_ny"])
    )
    band = (
        (P[:, 0] >= b["x"][0]) & (P[:, 0] <= b["x"][1])
        & (P[:, 1] >= b["y"][0]) & (P[:, 1] <= b["y"][1]) & (np.abs(N[:, 2]) >= b["min_nz"])
    )
    return roof | band


def triangle_fraction(parts, mark_def, luma_img=None):
    """The mark's share of the TRIANGLE area of every live mesh, ADDED GEOMETRY INCLUDED.

    `measure` counts texels, and a part UV-pinned to one bake texel (the Ambush Tank's net, the command Lavi's
    cupola) has no UV area: its 9,626 / 92 triangles are invisible to the texel count, so on those two the
    texel share says nothing about the surface the shader paints. This is that share by the per-triangle
    centroid and mean vertex normal, the same oracle `mark-pass.test.ts` re-derives in TypeScript.
    """
    total = 0.0
    marked = 0.0
    luma_sum = 0.0
    for p in parts:
        t = p["pos"][p["tri"]]
        n = p["nrm"][p["tri"]].mean(axis=1)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        area = 0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
        total += float(area.sum())
        if p["name"] in MARK_ROLES:
            hit = mask_np(t.mean(axis=1), n, mark_def)
            marked += float(area[hit].sum())
            if luma_img is not None and hit.any():
                # the bake under a (pinned) triangle is the texel at its UV centroid
                uv = p["uv"][p["tri"]].mean(axis=1)[hit]
                size = luma_img.shape[0]
                xs = np.clip((uv[:, 0] * size).astype(int), 0, size - 1)
                ys = np.clip((uv[:, 1] * size).astype(int), 0, size - 1)
                luma_sum += float((area[hit] * luma_img[ys, xs]).sum())
    return marked / total, marked, total, (luma_sum / marked if marked > 0 else 0.0)


#: Which count a vehicle DECLARES as `team_fraction`. The Lavi keeps the texel share it shipped with (PR 958); a
#: variant declares the triangle share, the only one that sees the geometry it adds.
BASIS = {"mbt_lavi": "texel", "mbt_lavi_camo": "triangle", "officer_armour": "triangle"}


def measure(glb_path, kit_path, size=SIZE, vehicle="mbt_lavi"):
    mark_def = MARKS[vehicle]
    parts = load_parts(glb_path)
    g = Glb(glb_path)
    r = rasterise(parts, size)
    ys, xs, bary, tri, meta = r["ys"], r["xs"], r["bary"], r["tri"], r["meta"]
    n = len(ys)
    P = np.zeros((n, 3))
    N = np.zeros((n, 3))
    tri_part = np.array([m[0] for m in meta])
    part = tri_part[tri]
    for pi, p in enumerate(parts):
        sel = part == pi
        if not sel.any():
            continue
        local = np.array([meta[t][1] for t in tri[sel]])
        c = p["tri"][local]
        b = bary[:, sel]
        P[sel] = b[0][:, None] * p["pos"][c[:, 0]] + b[1][:, None] * p["pos"][c[:, 1]] + b[2][:, None] * p["pos"][c[:, 2]]
        N[sel] = b[0][:, None] * p["nrm"][c[:, 0]] + b[1][:, None] * p["nrm"][c[:, 1]] + b[2][:, None] * p["nrm"][c[:, 2]]
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    carries = np.isin(part, [PARTS.index(x) for x in MARK_ROLES])
    mask = mask_np(P, N, mark_def) & carries
    # texel surface area = |Pu x Pv| / size^2 per triangle
    area_tri = []
    for p in parts:
        t = p["pos"][p["tri"]]
        uv = p["uv"][p["tri"]]
        e1, e2 = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]
        d1, d2 = uv[:, 1] - uv[:, 0], uv[:, 2] - uv[:, 0]
        det = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
        det = np.where(np.abs(det) < 1e-14, 1.0, det)
        pu = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / det[:, None]
        pv = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) / det[:, None]
        area_tri.append(np.linalg.norm(np.cross(pu, pv), axis=1))
    offs = np.cumsum([0] + [len(a) for a in area_tri])
    flat = np.concatenate(area_tri)
    gidx = np.array([offs[tri_part[t]] + meta[t][1] for t in tri])
    texel_area = flat[gidx] / float(size * size)
    total = float(texel_area.sum())
    marked = float(texel_area[mask].sum())

    # the bake under the mark
    js, bin_ = g.js, g.bin
    mat = js["materials"][0]
    tex = js["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    im = js["images"][tex["source"]]
    bv = js["bufferViews"][im["bufferView"]]
    off = bv.get("byteOffset", 0)
    img = Image.open(io.BytesIO(bin_[off:off + bv["byteLength"]])).convert("RGB")
    if img.size != (size, size):
        img = img.resize((size, size), Image.LANCZOS)
    px = np.asarray(img).astype(float) / 255.0
    lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
    luma_img = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    luma = float(luma_img[ys[mask], xs[mask]].mean()) if mask.any() else 0.0

    # the kit source must still pin to exactly the UVs the shader excludes
    pinned = {(round(a, 5), round(b, 5)) for a, b in mark_def["exclude_uv"]}
    if kit_path is None:
        # a kit-less vehicle (the variants) excludes nothing: every pin is `NO_PIN`
        if pinned != {tuple(NO_PIN)}:
            raise SystemExit(f"{vehicle}: no kit source given, but its exclude_uv {sorted(pinned)} are not NO_PIN")
    else:
        kit_uvs = set()
        kit = Glb(kit_path)
        for nd in kit.js["nodes"]:
            if "mesh" in nd:
                pr = kit.js["meshes"][nd["mesh"]]["primitives"][0]
                for uv in kit.accessor(pr["attributes"]["TEXCOORD_0"]):
                    kit_uvs.add((round(float(uv[0]), 5), round(float(uv[1]), 5)))
        if kit_uvs != pinned:
            raise SystemExit(f"the kit source pins {sorted(kit_uvs)}, MARK excludes {sorted(pinned)} -- review exclude_uv")
    tri_fraction, tri_marked, tri_total, tri_luma = triangle_fraction(parts, mark_def, luma_img)
    if BASIS[vehicle] == "triangle":
        luma = tri_luma
    texel_fraction = marked / total
    return dict(
        size=size,
        team_fraction=round(tri_fraction if BASIS[vehicle] == "triangle" else texel_fraction, 5),
        team_fraction_basis=BASIS[vehicle],
        team_fraction_texel=round(texel_fraction, 5),
        team_fraction_triangle=round(tri_fraction, 5),
        team_area_tri_m2=round(tri_marked, 4),
        surface_area_tri_m2=round(tri_total, 4),
        team_area_m2=round(marked, 4),
        surface_area_m2=round(total, 4),
        luma=round(luma, 5),
        luma_texel=round(float(luma_img[ys[mask], xs[mask]].mean()) if mask.any() else 0.0, 5),
        mark=mark_def,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--id", default="mbt_lavi", choices=sorted(MARKS))
    ap.add_argument("--kit", default=None, help="the kit source; omit for a kit-less vehicle")
    ap.add_argument("--size", type=int, default=SIZE)
    a = ap.parse_args()
    print(json.dumps(measure(a.glb, a.kit, a.size, a.id), sort_keys=True))


if __name__ == "__main__":
    main()
