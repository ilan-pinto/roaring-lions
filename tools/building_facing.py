#!/usr/bin/env python3
"""
Roaring Lions -- the building FACING gate (GH-142).

`packages/render/src/three/units/mesh-building.ts` translates a cloned
building root to its footprint and "leaves rotation at identity (a building
never turns; the sim tracks no orientation for one)". Every instance of a
type therefore draws at exactly one, permanently fixed world orientation:
whatever its export script happened to bake. Two of those export scripts
(`tools/buildings/export_meshy_house.py`, `..._apartment.py`) measured the
right answer by hand and wrote it down in prose. Nothing anywhere checked
it, so "the front faces the player" was a coincidence maintained by two
comments.

## Why it stopped being harmless

While the buildings were palette-painted boxes, a wrong bake was invisible:
colour came from `rl_role` and a face normal, so no side of the mesh carried
a picture and no side could be "the front". `d63cd36` changed that --
`house`, `apartment` and `warehouse` now ship their supplied Meshy
`base_color` bake, and a photographed facade has a door, shuttered windows
and an external stair painted onto SPECIFIC faces. Flipping a live house
180 degrees in the running renderer used to be "visually indistinguishable"
(GH-142's own finding); on the textured mesh it now swaps a clean entrance
elevation for the fire stair and a wall of weathering stains. A bad bake is
a player-visible defect, and there is no other gate that would notice.

## What "has a facade" means here, and why it is that

The one piece of a building's geometry that marks an OPENING rather than a
surface material is the `glass` role -- already a member of
`building-mesh-role.ts`'s closed eight-role vocabulary, already authored by
every export script that models windows, and not invented for this check.
Windows and doors are what a facade IS; masonry, roofing and trim wrap the
whole building and say nothing about which way it faces.

So: **facade-bearing geometry is the `glass`-role meshes, and a building's
front is the side you can see them from.**

That is deliberately not a texture statistic. Several were measured first
and every one of them failed, because they score CLUTTER rather than
frontage: on `house.glb` the mean/contrast/dark-fraction/edge-energy of each
elevation all pick the fire-stair side over the entrance side, and the
whole-building numbers for the four 90-degree yaws separate by less than 5%.
The report has the tables.

## How it is measured

Per cardinal horizontal direction, this module rasterises the mesh
orthographically into a fixed `RASTER` square with a depth buffer, front
faces only (three.js materials default to `FrontSide`, so a back face never
draws in the game either), and counts the pixels whose NEAREST surface
belongs to a `glass` node. Occlusion is the point: a window on the far wall,
or one behind the stair, is not frontage. The projection is orthographic
because the game's is (`camera.ts`'s `OrthographicCamera`) -- there is no
perspective term to approximate.

`camera.ts`'s `VIEW_DIRECTION` has strictly positive X and Z ground
components, so `+X` and `+Z` are the two elevations this fixed dimetric
camera can see and `-X`/`-Z` are the two it never can. `CAMERA_FACING`
below is that pair, and `building-facing.test.ts` pins it against
`VIEW_DIRECTION` itself rather than against a copy of it -- if the azimuth
ever moves, `pnpm test` goes red here instead of this file quietly checking
the wrong two sides.

## The verdict has three outcomes, on purpose

A check that demanded a front from every building would be a false-positive
factory: `wall` is a fence segment, `camp` is a HESCO compound its own
exporter describes as having no front, and `warehouse` carries a roller
shutter on BOTH gable ends, so its 180-degree rotation is genuinely not a
defect. Measured on the shipped tree, the camera-half / hidden-half ratio
separates cleanly into three populations rather than two:

    hall        3880 /   15    directional, and correct  (258.67x)
    house       5708 /    0    directional, and correct  (inf)
    shanty_wr    607 /  130    directional, and correct  ( 4.67x)
    ------------------------------------------- FRONT_MARGIN = 2.0
    shanty      1215 /  922    glazed both halves        ( 1.32x)
    warehouse   1946 / 1757    glazed both halves        ( 1.11x)
    concrete    1080 / 1080    glazed both halves        ( 1.00x)
    concrete_wr  333 /  370    glazed both halves        ( 0.90x)
    apartment, camp, wall, house_wreck, clinic, clinic_wreck,
    hall_wreck, ...   no glass role at all

`hall` replaces the retired `mosque` in this table (task O10, GDD Section 2:
"never a faith") -- the old `mosque`/`mosque_wr` rows (15.51x / 15.80x, from
the procedural kit pipeline's own glass roles, present on both idle and
wreck) are gone with that asset. `hall`'s glass comes from the new Meshy
textured pipeline instead, which -- like `clinic`'s -- ships no glass role on
its wreck at all (see `hall_wreck` in the bottom bucket), so there is only
one `hall` row rather than a pair.

Note the gap the margin sits in: nothing shipped reads between 1.32 and
4.67, so 2.0 is not fitted to the closest asset on either side of it.

So `FRONT_MARGIN` is the boundary between "this building has a front" and
"this building is glazed all round". Above it the front MUST be the camera
half; inside it there is no front to get wrong and the building passes with
its ratio printed. A 180-degree yaw swaps the two halves exactly, which is
what makes this falsifiable rather than decorative: any building that passes
directionally fails when flipped, and the two that pass as symmetric are the
two whose flip is genuinely harmless.

## What it does NOT check, stated plainly

* A building with no `glass` role is UNCHECKED, and named as such on the
  passing path -- the same loudness `TEXTURED_MESH_EXEMPT` gets, and for the
  same reason. `apartment` is the one shipped textured building in that list:
  its windows are painted into the bake and modelled with no separate pane,
  so this gate cannot see its front. See the report.
* It checks the glazing's side, not the DOOR's. On `house` those coincide;
  on a building whose entrance is unglazed they would not.
* It is a 90-degree-resolution check. A facade baked 45 degrees off is not
  something this can express, and no shipped export does it.
"""
import glob
import json
import os
import struct
import sys

import numpy as np

# The role that marks an opening rather than a surface material. Must stay a
# member of `BUILDING_MESH_ROLES` in
# `packages/render/src/three/units/building-mesh-role.ts`; pinned there by
# `building-facing.test.ts`.
FACADE_ROLE = "glass"

# The two horizontal directions this game's fixed dimetric camera can see,
# derived from `camera.ts`'s `VIEW_DIRECTION = (cos(EL)*SQRT1_2, sin(EL),
# cos(EL)*SQRT1_2)` -- both ground components strictly positive, so a face
# whose outward normal is +X or +Z has a positive dot product with it and
# sits on the camera-facing side of a solid. Pinned against the real
# `VIEW_DIRECTION` by `building-facing.test.ts`.
CAMERA_FACING = ("+X", "+Z")
CAMERA_HIDDEN = ("-X", "-Z")
DIRECTIONS = CAMERA_FACING + CAMERA_HIDDEN
# Opposed pairs adjacent, for every human-readable rendering of a result --
# `DIRECTIONS` groups by camera half instead, and printing in THAT order once
# produced a table whose column headings and columns disagreed.
DISPLAY_ORDER = ("+X", "-X", "+Z", "-Z")

# Square edge of the orthographic raster, per direction. Fixed rather than
# per-asset so `MIN_JUDGED_PIXELS` below means one thing. Verdicts were
# checked identical at 192, 256 and 384 across all sixteen shipped building
# GLBs; only the raw counts scale.
RASTER = 256

# Below this many glazed pixels on the larger half, there is not enough
# frontage to judge a direction from and the building is reported unchecked
# rather than given a verdict off a handful of stray pixels. The smallest
# shipped building that IS judged reads 322 (`concrete_wreck`).
MIN_JUDGED_PIXELS = 96

# How much more glazing the front half must show before a building counts as
# having a front at all. Below it the building is glazed on both halves and
# has no orientation to get wrong -- see the table in this module's docstring
# for the two populations this separates. Nothing shipped reads between 1.32
# and 4.67, so this is a gap rather than a fitted threshold.
FRONT_MARGIN = 2.0

_COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
              5125: ("I", 4), 5126: ("f", 4)}
_TYPE_LEN = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    """The glTF JSON chunk and the BIN chunk. Same minimal parse
    `validate_mesh_assets.check_decor_meshes` uses, extended with the binary
    half because this check reads real geometry rather than only `extras`.
    Deliberately no `bpy`: this runs in the gate's own plain-`python3`
    process, and a software rasteriser needs nothing else."""
    with open(path, "rb") as fh:
        data = fh.read()
    _magic, _version, length = struct.unpack("<III", data[0:12])
    offset, gltf, binary = 12, None, None
    while offset < length:
        chunk_len, chunk_type = struct.unpack("<II", data[offset:offset + 8])
        chunk = data[offset + 8:offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:      # 'JSON'
            gltf = json.loads(chunk)
        elif chunk_type == 0x004E4942:    # 'BIN\0'
            binary = chunk
        offset += 8 + chunk_len
    if gltf is None:
        raise ValueError(f"{path}: no JSON chunk found -- not a valid glb")
    return gltf, binary


def _accessor(gltf, binary, index):
    """One glTF accessor as an (count, components) array. Handles the
    interleaved case (`byteStride`) even though nothing in `art/meshes/`
    currently exports interleaved, because getting that silently wrong would
    read as scrambled geometry rather than as an error."""
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = _COMPONENT[acc["componentType"]]
    ncomp = _TYPE_LEN[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or (size * ncomp)
    count = acc["count"]
    if stride == size * ncomp:
        flat = np.frombuffer(binary, dtype=np.dtype("<" + fmt),
                             count=count * ncomp, offset=start)
        return flat.reshape(count, ncomp)
    out = np.empty((count, ncomp), dtype=np.dtype("<" + fmt))
    for i in range(count):
        out[i] = struct.unpack_from("<" + fmt * ncomp, binary, start + i * stride)
    return out


def load_triangles(path):
    """Every triangle in the GLB as (N, 3, 3) world-space vertices, plus a
    parallel boolean array marking the ones that belong to a `FACADE_ROLE`
    node. Node transforms are not composed: `export_mesh_building.py` writes
    a flat scene of untransformed mesh nodes, and `mesh-building.ts` scales
    the root uniformly and never rotates it, so vertex positions ARE the
    orientation this gate is about."""
    gltf, binary = read_glb(path)
    # Whether this GLB carries a photographed facade at all, from the GLB's
    # own evidence -- the same per-MESH test `mesh-building.ts` uses to pick
    # the textured material path, so there is no list to keep in step.
    textured = len(gltf.get("textures", [])) > 0
    tris, facade = [], []
    for node in gltf.get("nodes", []):
        if "mesh" not in node:
            continue
        role = (node.get("extras") or {}).get("rl_role") or node.get("name")
        mesh = gltf["meshes"][node["mesh"]]
        for prim in mesh["primitives"]:
            if "POSITION" not in prim["attributes"] or "indices" not in prim:
                continue
            pos = _accessor(gltf, binary, prim["attributes"]["POSITION"]).astype(np.float64)
            idx = _accessor(gltf, binary, prim["indices"]).astype(np.int64).ravel()
            corners = pos[idx[: (len(idx) // 3) * 3].reshape(-1, 3)]
            tris.append(corners)
            facade.append(np.full(len(corners), role == FACADE_ROLE, dtype=bool))
    if not tris:
        return np.zeros((0, 3, 3)), np.zeros(0, dtype=bool), textured
    return np.concatenate(tris), np.concatenate(facade), textured


def _project(tris, direction, size):
    """Screen x/y and depth for every vertex, viewed orthographically from
    `direction`. Depth increases toward the viewer, so a larger value wins
    the buffer. Framing is the mesh's own bounds, uniformly scaled, so a
    small building is not measured at a coarser effective resolution than a
    large one."""
    if direction in ("+X", "-X"):
        sign = 1.0 if direction == "+X" else -1.0
        right, up, depth = tris[:, :, 2] * -sign, tris[:, :, 1], tris[:, :, 0] * sign
    else:
        sign = 1.0 if direction == "+Z" else -1.0
        right, up, depth = tris[:, :, 0] * sign, tris[:, :, 1], tris[:, :, 2] * sign
    span = max(right.max() - right.min(), up.max() - up.min()) * 1.05
    if span <= 0:
        span = 1.0
    rc = (right.min() + right.max()) / 2
    uc = (up.min() + up.max()) / 2
    sx = (right - (rc - span / 2)) / span * size
    sy = ((uc + span / 2) - up) / span * size
    return sx, sy, depth


def _raster_depth(sx, sy, depth, size, gate=None):
    """Nearest-surface depth buffer for the given triangles. `gate`, when
    supplied, is a boolean mask of pixels worth filling -- the occluder pass
    only ever needs the pixels some glass triangle already claimed, which is
    what keeps this affordable in pure python."""
    buf = np.full((size, size), -np.inf)
    lo_x = np.floor(sx.min(axis=1)).astype(int)
    hi_x = np.ceil(sx.max(axis=1)).astype(int)
    lo_y = np.floor(sy.min(axis=1)).astype(int)
    hi_y = np.ceil(sy.max(axis=1)).astype(int)
    np.clip(lo_x, 0, size - 1, out=lo_x)
    np.clip(hi_x, 0, size - 1, out=hi_x)
    np.clip(lo_y, 0, size - 1, out=lo_y)
    np.clip(hi_y, 0, size - 1, out=hi_y)

    if gate is not None:
        # Summed-area table over the gate, so "does this triangle's bounding
        # box touch a pixel anyone cares about" is O(1) and vectorised.
        sat = np.zeros((size + 1, size + 1), dtype=np.int64)
        sat[1:, 1:] = np.cumsum(np.cumsum(gate.astype(np.int64), axis=0), axis=1)
        touched = (sat[hi_y + 1, hi_x + 1] - sat[lo_y, hi_x + 1]
                   - sat[hi_y + 1, lo_x] + sat[lo_y, lo_x]) > 0
        candidates = np.nonzero(touched)[0]
    else:
        candidates = np.arange(len(sx))

    for i in candidates:
        x0, x1, x2 = sx[i]
        y0, y1, y2 = sy[i]
        d0, d1, d2 = depth[i]
        min_x, max_x, min_y, max_y = lo_x[i], hi_x[i], lo_y[i], hi_y[i]
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if den == 0.0:
            continue
        gx, gy = np.meshgrid(np.arange(min_x, max_x + 1) + 0.5,
                             np.arange(min_y, max_y + 1) + 0.5)
        l0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
        l1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
        l2 = 1.0 - l0 - l1
        inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        if not inside.any():
            continue
        z = l0 * d0 + l1 * d1 + l2 * d2
        window = buf[min_y:max_y + 1, min_x:max_x + 1]
        win = inside & (z > window)
        if win.any():
            window[win] = z[win]
    return buf


def visible_facade_pixels(tris, facade, direction, size=RASTER):
    """Pixels whose nearest front-facing surface is `FACADE_ROLE` geometry,
    seen orthographically from `direction`."""
    if not facade.any():
        return 0
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    normal = np.cross(b - a, c - a)
    axis = {"+X": (0, 1.0), "-X": (0, -1.0), "+Z": (2, 1.0), "-Z": (2, -1.0)}[direction]
    # Front faces only. three.js materials default to `side: FrontSide`, so a
    # back face is not drawn in the game either and must not occlude here.
    front = normal[:, axis[0]] * axis[1] > 0
    if not front.any():
        return 0

    sx, sy, depth = _project(tris, direction, size)
    glass = front & facade
    if not glass.any():
        return 0

    glass_depth = _raster_depth(sx[glass], sy[glass], depth[glass], size)
    claimed = np.isfinite(glass_depth)
    if not claimed.any():
        return 0

    solid = front & ~facade
    if solid.any():
        occluder = _raster_depth(sx[solid], sy[solid], depth[solid], size, gate=claimed)
    else:
        occluder = np.full((size, size), -np.inf)
    return int((claimed & (glass_depth > occluder)).sum())


def facing_report(path):
    """One building GLB's verdict. Returns a dict; `status` is one of
    `unchecked` (no facade geometry, or too little of it to judge),
    `directional` (has a front, and it faces the camera), `symmetric`
    (glazed on both halves -- no front to get wrong), or `hidden` (has a
    front and it faces AWAY from the camera: the GH-142 defect)."""
    name = os.path.basename(path)[: -len(".glb")]
    tris, facade, textured = load_triangles(path)
    if len(tris) == 0 or not facade.any():
        # The two cases are not the same size of gap, and collapsing them
        # would bury the one that matters. A palette-painted `wall` segment
        # has no picture on any face and no front to bake wrong. A TEXTURED
        # building has a photographed facade -- door, shutters, stair -- and
        # models no pane, so it has a front this gate simply cannot see.
        # `apartment` is the shipped instance of the second case.
        reason = (f"ships a photographed facade but models no {FACADE_ROLE} role -- "
                  f"this gate cannot see its front"
                  if textured else f"no {FACADE_ROLE}-role geometry, and no baked facade either")
        return dict(name=name, status="unchecked", reason=reason, textured=textured,
                    per_direction={}, camera=0, hidden=0)

    per = {d: visible_facade_pixels(tris, facade, d) for d in DIRECTIONS}
    camera = sum(per[d] for d in CAMERA_FACING)
    hidden = sum(per[d] for d in CAMERA_HIDDEN)
    if max(camera, hidden) < MIN_JUDGED_PIXELS:
        return dict(name=name, status="unchecked", per_direction=per, camera=camera, hidden=hidden,
                    textured=textured,
                    reason=f"only {max(camera, hidden)} glazed px on the larger half "
                           f"(min {MIN_JUDGED_PIXELS}) -- too little frontage to judge")

    if camera >= hidden * FRONT_MARGIN:
        status = "directional"
    elif hidden >= camera * FRONT_MARGIN:
        status = "hidden"
    else:
        status = "symmetric"
    return dict(name=name, status=status, per_direction=per, camera=camera, hidden=hidden,
                textured=textured, reason="")


def check_building_facing(buildings_root):
    """Every `art/meshes/buildings/*.glb`. Returns (failures, notes) -- notes
    are printed on the PASSING path, naming the buildings this gate could not
    judge, so a green tick never reads as "every building's facing is
    guaranteed"."""
    failures, notes = [], []
    for path in sorted(glob.glob(os.path.join(buildings_root, "*.glb"))):
        r = facing_report(path)
        per = r["per_direction"]
        if r["status"] == "unchecked":
            notes.append(f"{r['name']}: {r['reason']}")
            continue
        shape = " ".join(f"{d}={per[d]}" for d in DISPLAY_ORDER)
        if r["status"] == "hidden":
            failures.append(
                f"{r['name']}: facade faces AWAY from the camera -- {r['hidden']} glazed px on "
                f"the hidden half ({', '.join(CAMERA_HIDDEN)}) against {r['camera']} on the "
                f"camera-facing half ({', '.join(CAMERA_FACING)}); [{shape}]. "
                f"camera.ts's VIEW_DIRECTION sees {'/'.join(CAMERA_FACING)} only, so this bake "
                f"shows the player its back wall. Rotate the export, do not rotate at runtime."
            )
        elif r["status"] == "symmetric":
            notes.append(f"{r['name']}: glazed on both halves "
                         f"({r['camera']} vs {r['hidden']} px) -- no front to get wrong")
    return failures, notes


def main():
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "art", "meshes", "buildings")
    if len(sys.argv) > 1:
        root = sys.argv[1]
    print(f"{'building':>18} " + " ".join(f"{d:>7}" for d in DISPLAY_ORDER)
          + f" {'camera':>8} {'hidden':>8} {'ratio':>8}  status")
    for path in sorted(glob.glob(os.path.join(root, "*.glb"))):
        r = facing_report(path)
        per = r["per_direction"]
        cells = " ".join(f"{per.get(d, 0):7d}" for d in DISPLAY_ORDER)
        if not per:
            ratio_s = "-"
        elif r["hidden"] == 0:
            ratio_s = "inf"
        else:
            ratio_s = f"{r['camera'] / r['hidden']:.2f}"
        print(f"{r['name']:>18} {cells} {r['camera']:8d} {r['hidden']:8d} {ratio_s:>8}  "
              f"{r['status']}{(' -- ' + r['reason']) if r['reason'] else ''}")
    failures, notes = check_building_facing(root)
    for n in notes:
        print(f"  [note] {n}")
    for f in failures:
        print(f"  [FAIL] {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
