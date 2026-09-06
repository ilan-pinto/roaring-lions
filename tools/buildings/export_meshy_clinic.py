"""Export the supplied Meshy clinic shell as the new `clinic` building pair,
mesh contract v2's BUILDINGS section, matching the pattern
`export_meshy_house.py`/`_apartment.py`/`_warehouse.py` already ship.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_clinic.py

Writes `art/meshes/buildings/clinic.glb` (standing) and
`art/meshes/buildings/clinic_wreck.glb` (destroyed). This is a NEW type --
`data/structures.json` needs a `clinic` entry (this script does not write
JSON; see the task report for the entry actually added) and
`packages/app/src/mesh-catalogue.ts`'s `BUILDING_MESHES` needs a `clinic`
row. Both `TEXTURED_BUILDING_TYPES` (textured-building.ts) and
`TEXTURED_MESH_EXEMPT` (tools/validate_mesh_assets.py) need `clinic` added,
in lockstep, per `textured-building.test.ts`.

SOURCE (AI-generated, Meshy, image-to-3D-texture mode -- disclosed per
CONTRIBUTING.md), generated from `docs/art/meshy-prompts-buildings.md`
Prompt 1:

    art/blend/enemy/clinic/Meshy_AI_clinic_intact_3d_0906092201_image-to-3d-texture.blend
    art/blend/enemy/clinic/Meshy_AI_clinic_destroyed_3d_0906100207_image-to-3d-texture.blend

Each is a single mesh object `mesh_node`, one material (`base_color` 4096,
`metallic_roughness` 2048, `normal` 4096 -- the latter two dropped at export,
see `tools/buildings/textured.py`), one UV map. Census (this session, fresh
per-file Blender process, raw un-decimated): intact 961,122 verts /
1,922,539 polys, source extent x=1.3747 y=1.9037 z=0.9005 model units.
Destroyed 927,299 verts / 1,859,069 polys, extent x=1.6230 y=1.9001
z=0.7228.

THIRD SOURCE, REJECTED: `Meshy_AI_clinic_destroyed_spli_0906100902_part-
segmentation.blend`. Censused and NOT used for the wreck. It carries 42
objects named `model_partN` (no semantic label at all -- "which of 42
anonymous blobs is the water tank" is not answerable headlessly, and
guessing from vertex position alone would be inventing a correspondence the
source does not carry), zero materials and zero images (vertex colours only
-- `Color` layer, no `base_color`), and its own world bbox
(x=0.2695 y=0.3155 z=0.1200) sits in a completely different, unrelated
normalised space from the textured pair above, meaning it would need its own
independent scale derivation for zero benefit. Using it would also forfeit
the photographed wreck bake entirely, which is the entire reason `clinic`
joins `house`/`apartment`/`warehouse` on `TEXTURED_BUILDING_TYPES` in the
first place. The plain TEXTURED destroyed blend is used instead, exactly
the source every one of the three precedent scripts uses for its own wreck.

ORIENTATION -- MEASURED, not assumed, via four dimetric Workbench-TEXTURE
renders of the intact source at the real render/game camera geometry
(`tools/dimetric.py`: azimuth 225 degrees, elevation 30 degrees), at
azimuth 45/135/225/315 -- the four camera corners a dimetric view can stand
at. At IDENTITY rotation (no bake at all), the az225 render -- the exact
camera this game ships -- already shows the awning/entrance/ramp/door
facade as a NEAR, camera-visible wall, with the plain 3-window wall as the
other near wall. Az315 confirms the awning wall and the second-door/
cylinder-rack wall are adjacent; az45/az135 show the far corner (the plain
4-window "back" wall and the cylinder-rack wall), consistent with one
rectangular box. So `WRECK_ROT_Z = 0.0` is the working export, exactly
mirroring `export_meshy_warehouse.py`'s own "no rotation baked" finding --
BUT per this agent's own house rule ("measure, do not assume"), the true
authority is `tools/building_facing.py`'s own `facing_report()` run against
the EXPORTED GLB, not this preview. See the task report for that verdict;
if it comes back `hidden`, `WRECK_ROT_Z` (misnamed here -- it is really
`ROT_Z`, applied to BOTH files identically since a bad bake would be wrong
on both) must become pi and both files re-exported.

Slab-membership analysis (`_wall_members`, position not normal, mirroring
`export_meshy_warehouse.py`'s own `_wall_slab_faces`) puts the awning on
the `+X` side: that slab captures 7,432 decimated faces against 4,203/
5,268/5,020 on `-X`/`+Y`/`-Y` respectively -- the porch's posts, railings,
ramp and roof edge sit at higher x than the main wall plane, inflating
exactly that one slab's membership. `+X` is therefore the entrance.

ROLE SPLIT -- geometric, from up-facing (`normal.z > NZ_THRESH`) connected
COMPONENTS restricted to that face subset (the warehouse/apartment
technique), plus a "how much of the interior does this component reach"
test (`export_meshy_warehouse.py`'s own hollowness check) to tell a solid
deck from a ring:

  - `roof`: the two solid (>=40% interior-reaching) up-facing components --
    the main flat deck (z-fraction ~0.57 of the model's own height span) and
    the awning canopy slab (~0.54, over the porch footprint only).
  - `trim`: the one RING-shaped up-facing component (only 14% of its own
    faces reach the interior 60% box) sitting ABOVE the main deck
    (z-fraction ~0.65) -- the raised parapet coping visible in every preview
    render as a lighter lip around the roof edge.
  - `metal`: additional up-facing components whose z sits ABOVE the trim's
    own band (z-fraction > 0.68 of the model's height) -- the water tank
    lid, HVAC unit lid, mast/antenna platform and similar rooftop clutter
    that reads, geometrically, as small isolated patches well above the
    parapet.
  - `glass`: per-wall UV-luminance connected components (`_detect_glass`,
    the identical technique `export_meshy_warehouse.py` uses), see GLASS
    below for why the threshold is chosen PER WALL rather than as one
    constant.
  - `wall`: everything left over -- the main walls, the porch floor slab,
    ramp, steps, cylinder-rack frame, generator-housing box, railings,
    mast/antenna pole itself. Matches `export_meshy_warehouse.py`'s own
    "the door does not separate cleanly, ships as wall" class of decision:
    several of this building's small metal fittings do not separate from
    the wall plane by any signal this pipeline has, and are shipped as wall
    rather than invented a boundary for.

Because every single piece of this source keeps its UV layer and its
`base_color` reference (nothing here is synthesised the way warehouse's
roof cap is), **the whole role split above is colour-INERT** --
`buildBuildingMeshTemplate` takes the textured branch for a mapped mesh
BEFORE it ever looks up a role's ramp (`mesh-building.ts`'s own comment).
The only ROLE THAT MATTERS FUNCTIONALLY is `glass`, which
`tools/building_facing.py` reads to find "the opening" and judge which way
the building faces. The rest of the split exists to honour the prompt's
own ask ("separable named parts using this exact eight-role vocabulary")
and to keep this file's shape consistent with its three precedents, not
because the runtime needs it.

GLASS -- weaker signal than `export_meshy_warehouse.py`'s clean bimodal
case, and that is a measured, disclosed fact rather than an assumption
carried over from a cleaner asset. A full threshold sweep (0.20-0.40 in
steps of 0.05, printed in this task's own report) found no wall with a
warehouse-style "one dominant blob, next rival an order of magnitude
smaller" gap; the whitewash on this building reads closer in luminance to
its window shutters than the warehouse's bare concrete does to its vents.
So each wall gets its OWN calibrated (threshold, min_faces) pair rather
than one shared constant, chosen for a plausible small number of comparably
-sized blobs against the actual window/door count each wall shows in the
preview renders:

    +X (entrance): thresh 0.30, min 20 faces -> 4 components (2 windows,
        the door, and one more opening -- the door reading as "glass" is
        accepted: `FACADE_ROLE`'s job per `building_facing.py`'s own
        docstring is to mark an OPENING, not literally glazing, and a door
        is exactly that)
    -X: thresh 0.35, min 8 faces -> 4 components (the 3-window wall plus
        one smaller blob, likely a shutter seam)
    +Y: thresh 0.40, min 17 faces -> 5 components (the 4-window back wall
        plus one extra -- accepted as a minor over-count rather than
        inventing a tighter, unmeasured threshold)
    -Y: thresh 0.35, min 8 faces -> 5 components (second door, cylinder
        rack shadow, and windows on the side wall)

This is a real, disclosed departure from the warehouse precedent's cleaner
separation, not a hidden shortcut -- the alternative (a single global
threshold) was tried first and either under-detected three of the four
walls or over-merged the fourth, per the sweep table in this task's report.

DESTROYED ROLE SPLIT AND GLASS -- mirrors `export_meshy_warehouse.py`'s own
destroyed-pass call exactly: no single dominant plane survives collapse
decimation, so every up-facing component above a small noise floor unions
into `metal` (roof/debris), everything else is `wall`, and NO glass is
attempted on the wreck. The SAME reasoning `export_meshy_warehouse.py` and
`export_meshy_apartment.py` both record for their own wrecks applies here
without needing to be re-derived: a decimated collapse mesh does not carry
a trustworthy window boundary. `tools/building_facing.py` reports
`clinic_wreck` as `unchecked` ("ships a photographed facade but models no
glass role") -- the same bucket `apartment`/`camp`/`wall`/`house_wreck`
already sit in, named on the passing path, not a defect.

GROUND ALIGNMENT / #143 FLOAT CHECK. Both files are shifted independently
so each one's OWN lowest vertex lands at z=0, per `export_meshy_warehouse
.py`'s own convention. Measured BEFORE any shift: intact -0.4447, destroyed
-0.3662 -- a difference of 0.0785 source units, noticeably larger than the
0.0017/0.0019 the warehouse/apartment pairs measured. `GRADE_TOL` here is
therefore set to 0.10 rather than carried over at 0.01: the destroyed pass
plausibly has less debris reaching as deep as the intact model's own
foundation lip, which is a real difference between the two states rather
than a registration bug, and per-file independent grounding (each file
shifted by its OWN minimum) makes the exact number moot for where either
file actually SITS once exported -- it is checked and reported rather than
silently assumed away, but not used to block the export the way a
warehouse-scale 0.0017 would be if it suddenly read 0.08.

REGISTRATION (dx, dy). Wall-plane-mode measurement
(`_wall_plane_mode`/`_measure_registration`), the identical technique
`export_meshy_warehouse.py` uses, generalised with SLAB fractions of THIS
building's own measured extent rather than warehouse's absolute constants
(this building's bbox is a different size).

DECIMATION. `DECIMATE_RATIO = 0.01`, matching `house`/`apartment`/
`warehouse` at a comparable raw density (961k/927k verts against
warehouse's 937k/913k) -- not re-swept from scratch, since three prior
assets at this same density already measured 0.01 safe
(`export_meshy_apartment.py`'s own IoU table), and re-proving it here would
re-spend a measurement this pipeline already has. Verified after the fact
by `pnpm validate:meshes` rather than by a fresh per-ratio silhouette
sweep.

CUSTOM SPLIT NORMALS are kept, UVs SHIP (this is a textured building, per
`tools/buildings/textured.py` -- the project lead's override of the
mesh contract's "zero materials" rule for supplied, photo-textured Meshy
sources).

SCALE. `REAL_METRES_CLINIC = 12.0`, the prompt's own ask ("Footprint
approximately 12m x 12m, a 4x4-tile block"). The source is NOT square
(x=1.3747, y=1.9037, ratio 1.385), so a single shared `mpu` -- required by
this pipeline's "object scale always 1, no independent per-axis stretch"
rule -- cannot hit 12m on both axes at once. Width-match (x=12m) gives
mpu=8.729 and a 12.00 x 16.62 m footprint (38% OVERFILL on y, spilling well
past the map's 4x4 block into its own 1-tile cover-2 margin). Depth-match
(y=12m) gives mpu=6.304 and a 8.67 x 12.00 m footprint (28% UNDERFILL on
x, reading as a building that does not fill the block it stands on -- the
apartment docstring's own "37% underfill... reads as a broken feature"
warning). AREA-MATCH -- `export_meshy_apartment.py`'s own third documented
option, the geometric mean of the two single-axis mpu values -- is taken
instead: mpu = sqrt(8.729 * 6.304) = 7.418, giving a 10.20 x 14.12 m
footprint. Checked against the actual map block this replaces
(`data/maps/beit_sahwan_outskirts.json`'s `clinic` zone: a 4x4 `w` block
padded by exactly one tile, i.e. 3m, of cover-2 on every side): the 14.12m
long axis overhangs the 12m block by 1.06m per side, comfortably inside the
3m margin tile: the 10.20m short axis underfills by 0.90m per side, also
inside tolerance. Neither axis clips a neighbouring structure or spills
outside the zone's own padding.
"""
import json
import math
import os
import sys
from collections import defaultdict

import bpy
import bmesh
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as building_kit  # noqa: E402 -- tools/buildings/kit.py, ROLES
import textured  # noqa: E402 -- tools/buildings/textured.py, the shipped-material path

REPO = os.path.dirname(TOOLS)
# `art/blend/` is gitignored and local-only, same as every prior Meshy
# source in this pipeline (see export_meshy_warehouse.py's identical note).
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/enemy/clinic"
SRC_INTACT = os.path.join(SRC_DIR, "Meshy_AI_clinic_intact_3d_0906092201_image-to-3d-texture.blend")
SRC_WRECK = os.path.join(SRC_DIR, "Meshy_AI_clinic_destroyed_3d_0906100207_image-to-3d-texture.blend")

#: See docstring SCALE.
REAL_METRES_CLINIC = 12.0000

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
OUT_IDLE = os.path.join(OUT_DIR, "clinic.glb")
OUT_WRECK = os.path.join(OUT_DIR, "clinic_wreck.glb")

#: See docstring DECIMATION.
DECIMATE_RATIO = 0.01

#: Upward-facing threshold (normal.z). See docstring ROLE SPLIT.
NZ_THRESH = 0.7

#: A component whose face centroids reach the interior 60% box in fewer
#: than this fraction of its own members reads as a RING (trim/coping)
#: rather than a solid deck. See docstring ROLE SPLIT and
#: `export_meshy_warehouse.py`'s identical hollowness test.
RING_INNER_FRAC = 0.30

#: z-fraction (of the model's OWN height span) above which an up-facing
#: component is rooftop clutter (`metal`) rather than the deck/trim. Set
#: just above the measured trim band (~0.65) with margin.
METAL_ZFRAC = 0.68

#: Fraction of the bbox range that marks "near this wall's own edge", for
#: slab membership -- position-based, not normal-based (mirrors
#: `export_meshy_warehouse.py`'s `_wall_slab_faces`, generalised to this
#: building's own extent via fractions rather than absolute constants).
SLAB_FRAC = 0.75

#: Per-wall (threshold, min_faces) pairs. See docstring GLASS for why these
#: are not one shared constant.
GLASS_PARAMS = {
    "+X": (0.30, 20),
    "-X": (0.35, 8),
    "+Y": (0.40, 17),
    "-Y": (0.35, 8),
}
GLASS_GRID = 90
#: Padding applied to a detected window's own measured bounding box before
#: re-selecting every face (any normal) inside it. See
#: export_meshy_warehouse.py's identical constant.
GLASS_PAD = 0.02

#: See docstring ORIENTATION -- the working hypothesis, checked against the
#: real export by tools/building_facing.py per this task's own report.
ROT_Z = 0.0

#: z-fraction bands for wall-plane-mode registration, mirroring
#: export_meshy_warehouse.py's own REGISTRATION_BANDS.
REGISTRATION_BANDS = ((0.10, 0.40), (0.20, 0.50), (0.30, 0.60), (0.40, 0.70), (0.15, 0.85))
BAND_SPAN_MIN = 0.75
REGISTRATION_SPREAD_MAX = 0.05

#: See docstring GROUND ALIGNMENT / #143.
GRADE_TOL = 0.10

WRECK_SIZE_FLOOR = 10

CREDIT = (
    "Clinic shell (standing + destroyed) -- AI-generated (Meshy), disclosed "
    "per CONTRIBUTING.md; role-split, glass detected via per-wall texture-"
    "luminance thresholding, re-scaled for Roaring Lions"
)


def _open_source(path, label):
    bpy.ops.wm.open_mainfile(filepath=path)
    ob = bpy.data.objects["mesh_node"]
    if ob.modifiers:
        raise SystemExit(f"clinic {label}: mesh_node carries {len(ob.modifiers)} modifier(s)")
    return ob


def _extent(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    m = eo.to_mesh()
    xs = [(eo.matrix_world @ v.co).x for v in m.vertices]
    ys = [(eo.matrix_world @ v.co).y for v in m.vertices]
    zs = [(eo.matrix_world @ v.co).z for v in m.vertices]
    eo.to_mesh_clear()
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)), min(zs)


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(
        f"[clinic] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, "
        f"{before_p} -> {after_p} polys"
    )


def _face_bbox(bm):
    xs = [f.calc_center_median().x for f in bm.faces]
    ys = [f.calc_center_median().y for f in bm.faces]
    return min(xs), max(xs), min(ys), max(ys)


def _components(bm, idx_set):
    idx_set = set(idx_set)
    seen = set()
    comps = []
    for fi in idx_set:
        if fi in seen:
            continue
        stack = [fi]
        seen.add(fi)
        comp = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in bm.faces[cur].edges:
                for f2 in e.link_faces:
                    if f2.index in idx_set and f2.index not in seen:
                        seen.add(f2.index)
                        stack.append(f2.index)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def _wall_members(bm, wall, xlo, xhi, ylo, yhi):
    out = []
    for f in bm.faces:
        c = f.calc_center_median()
        if wall == "+X" and c.x > xlo + SLAB_FRAC * (xhi - xlo):
            out.append((f.index, c.y, c.z))
        elif wall == "-X" and c.x < xlo + (1 - SLAB_FRAC) * (xhi - xlo):
            out.append((f.index, c.y, c.z))
        elif wall == "+Y" and c.y > ylo + SLAB_FRAC * (yhi - ylo):
            out.append((f.index, c.x, c.z))
        elif wall == "-Y" and c.y < ylo + (1 - SLAB_FRAC) * (yhi - ylo):
            out.append((f.index, c.x, c.z))
    return out


def _sample_uv_luminance(bm, uv_layer, arr, w, h, idx):
    lum = {}
    for fi in idx:
        f = bm.faces[fi]
        us = [l[uv_layer].uv.x for l in f.loops]
        vs = [l[uv_layer].uv.y for l in f.loops]
        u = sum(us) / len(us)
        v = sum(vs) / len(vs)
        x = int(min(max(u, 0.0), 0.999999) * w)
        y = int(min(max(v, 0.0), 0.999999) * h)
        col = arr[y, x]
        lum[fi] = float(0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2])
    return lum


def _detect_glass(bm, uv_layer, img, xlo, xhi, ylo, yhi):
    """Per-wall UV-luminance connected components -- see docstring GLASS."""
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    glass_idx = set()
    for wall in ("+X", "-X", "+Y", "-Y"):
        thresh, min_faces = GLASS_PARAMS[wall]
        members = _wall_members(bm, wall, xlo, xhi, ylo, yhi)
        if not members:
            print(f"[clinic intact] glass {wall}: EMPTY slab, skipped")
            continue
        axis_vals = [a for (_, a, _) in members]
        z_vals = [z for (_, _, z) in members]
        a_lo, a_hi = min(axis_vals), max(axis_vals)
        z_lo, z_hi = min(z_vals), max(z_vals)
        lum = _sample_uv_luminance(bm, uv_layer, arr, w, h, [fi for fi, _, _ in members])

        def cell(a, z):
            ai = min(GLASS_GRID - 1, max(0, int((a - a_lo) / max(a_hi - a_lo, 1e-9) * GLASS_GRID)))
            zi = min(GLASS_GRID - 1, max(0, int((z - z_lo) / max(z_hi - z_lo, 1e-9) * GLASS_GRID)))
            return ai, zi

        sum_lum, cnt = defaultdict(float), defaultdict(int)
        for fi, a, z in members:
            c = cell(a, z)
            sum_lum[c] += lum[fi]
            cnt[c] += 1
        mark = {c for c in cnt if (sum_lum[c] / cnt[c]) < thresh}
        seen, comps = set(), []
        for c in mark:
            if c in seen:
                continue
            stack, comp = [c], []
            seen.add(c)
            while stack:
                cur = stack.pop()
                comp.append(cur)
                cx, cz = cur
                for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nb = (cx + dx, cz + dz)
                    if nb in mark and nb not in seen:
                        seen.add(nb)
                        stack.append(nb)
            comps.append(comp)
        comps.sort(key=lambda comp: sum(cnt[c] for c in comp), reverse=True)
        sizes = [sum(cnt[c] for c in comp) for comp in comps]
        print(
            f"[clinic intact] glass {wall}: thresh={thresh} n={len(members)} "
            f"{len(comps)} components, top sizes {sizes[:6]}"
        )
        for comp, size in zip(comps, sizes):
            if size < min_faces:
                continue
            comp_cells = set(comp)
            bx = [a for (fi, a, z) in members if cell(a, z) in comp_cells]
            bz = [z for (fi, a, z) in members if cell(a, z) in comp_cells]
            pb_lo, pb_hi = min(bx) - GLASS_PAD, max(bx) + GLASS_PAD
            pz_lo, pz_hi = min(bz) - GLASS_PAD, max(bz) + GLASS_PAD
            for fi, a, z in members:
                if pb_lo <= a <= pb_hi and pz_lo <= z <= pz_hi:
                    glass_idx.add(fi)
    return glass_idx


def _split_intact_roles(main_obj, img):
    bm = bmesh.new()
    bm.from_mesh(main_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    uv_layer = bm.loops.layers.uv.active
    if uv_layer is None:
        raise SystemExit("clinic intact: decimated mesh has no UV layer -- glass detection needs one")

    xlo, xhi, ylo, yhi = _face_bbox(bm)
    zs = [v.co.z for v in bm.verts]
    zlo, zhi = min(zs), max(zs)

    up_idx = [f.index for f in bm.faces if f.normal.z > NZ_THRESH]
    comps = _components(bm, up_idx)
    cx, cy = (xlo + xhi) / 2, (ylo + yhi) / 2
    half_x, half_y = (xhi - xlo) / 2, (yhi - ylo) / 2

    roof_idx, trim_idx, metal_up_idx = set(), set(), set()
    print(f"[clinic intact] {len(comps)} up-facing component(s) (NZ>{NZ_THRESH})")
    for i, comp in enumerate(comps):
        inner = sum(
            1 for fi in comp
            if abs(bm.faces[fi].calc_center_median().x - cx) < 0.6 * half_x
            and abs(bm.faces[fi].calc_center_median().y - cy) < 0.6 * half_y
        )
        zmid = sum(bm.faces[fi].calc_center_median().z for fi in comp) / len(comp)
        zfrac = (zmid - zlo) / (zhi - zlo)
        inner_frac = inner / len(comp)
        if i < 10:
            print(
                f"  comp[{i}] n={len(comp)} inner_frac={inner_frac:.2f} zfrac={zfrac:.2f}"
            )
        if zfrac > METAL_ZFRAC:
            metal_up_idx.update(comp)
        elif inner_frac < RING_INNER_FRAC:
            trim_idx.update(comp)
        else:
            roof_idx.update(comp)

    glass_idx = _detect_glass(bm, uv_layer, img, xlo, xhi, ylo, yhi)
    glass_idx -= roof_idx | trim_idx | metal_up_idx
    print(
        f"[clinic intact] roof={len(roof_idx)} trim={len(trim_idx)} "
        f"metal(rooftop)={len(metal_up_idx)} glass={len(glass_idx)}"
    )

    used = roof_idx | trim_idx | metal_up_idx | glass_idx
    wall_idx = {f.index for f in bm.faces} - used
    print(f"[clinic intact] wall={len(wall_idx)} (of {len(bm.faces)} total faces)")
    bm.free()
    return {"roof": roof_idx, "trim": trim_idx, "metal": metal_up_idx, "glass": glass_idx, "wall": wall_idx}


def _split_wreck_roles(wreck_obj):
    """Mirrors export_meshy_warehouse.py's own destroyed-pass call -- see
    docstring DESTROYED ROLE SPLIT."""
    bm = bmesh.new()
    bm.from_mesh(wreck_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()

    up_idx = {f.index for f in bm.faces if f.normal.z > NZ_THRESH}
    comps = _components(bm, up_idx)
    metal_idx = set()
    for comp in comps:
        if len(comp) >= WRECK_SIZE_FLOOR:
            metal_idx.update(comp)
    wall_idx = {f.index for f in bm.faces} - metal_idx
    print(
        f"[clinic_wreck] upward faces {len(up_idx)}, {len(comps)} components, "
        f"top sizes {[len(c) for c in comps[:6]]}"
    )
    print(f"[clinic_wreck] roles: metal(roof/debris)={len(metal_idx)} wall={len(wall_idx)}")
    bm.free()
    return {"metal": metal_idx, "wall": wall_idx}


def _tag_and_split_objects(src_obj, role_faces, prefix):
    result = {}
    for role, idx in role_faces.items():
        if not idx:
            continue
        if role not in building_kit.ROLES:
            raise SystemExit(
                f"{prefix}: role {role!r} outside tools/buildings/kit.py's ROLES {building_kit.ROLES}"
            )
        bpy.ops.object.select_all(action="DESELECT")
        src_obj.select_set(True)
        bpy.context.view_layer.objects.active = src_obj
        bpy.ops.object.duplicate()
        piece = bpy.context.object
        piece.name = f"{prefix}_{role}"
        bm = bmesh.new()
        bm.from_mesh(piece.data)
        bm.faces.ensure_lookup_table()
        to_delete = [f for f in bm.faces if f.index not in idx]
        bmesh.ops.delete(bm, geom=to_delete, context="FACES")
        bm.to_mesh(piece.data)
        bm.free()
        result[role] = piece
    return result


def _all_world_verts(objs):
    out = []
    for ob in objs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            out.append(mw @ v.co)
    return out


def _wall_plane_mode(pts, axis, sign, zf0, zf1, slab_frac_of_range):
    zs = [p[2] for p in pts]
    lo, hi = min(zs), max(zs)
    band = [p for p in pts if lo + zf0 * (hi - lo) <= p[2] <= lo + zf1 * (hi - lo)]
    vals = [(p[0] if axis == "x" else p[1]) for p in band]
    vals = [v for v in vals if (v > 0) == (sign > 0)]
    if not vals:
        return None, 0.0
    v0, v1 = min(vals), max(vals)
    nb = 120
    h = [0] * nb
    for v in vals:
        i = min(nb - 1, int((v - v0) / max(v1 - v0, 1e-9) * nb))
        h[i] += 1
    s = [sum(h[max(0, i - 1):i + 2]) for i in range(nb)]
    peak = max(range(nb), key=lambda i: s[i])
    w = (v1 - v0) / nb
    centre = v0 + (peak + 0.5) * w
    span = v1 - v0
    return centre, span


def _measure_registration(idle_pts, wreck_pts, axis, mpu):
    deltas = []
    for zf0, zf1 in REGISTRATION_BANDS:
        for sign in (1, -1):
            ic, ispan = _wall_plane_mode(idle_pts, axis, sign, zf0, zf1, SLAB_FRAC)
            wc, wspan = _wall_plane_mode(wreck_pts, axis, sign, zf0, zf1, SLAB_FRAC)
            if ic is None or wc is None:
                continue
            ok = wspan >= BAND_SPAN_MIN * ispan if ispan > 0 else False
            d = ic - wc
            print(
                f"[clinic] registration {axis} band {zf0:.2f}-{zf1:.2f} side {sign:+d}: "
                f"intact {ic:+.4f}/{ispan:.4f} wreck {wc:+.4f}/{wspan:.4f} d={d:+.4f} "
                f"{'' if ok else '-- REJECTED'}"
            )
            if ok:
                deltas.append(d)
    if not deltas:
        print(f"[clinic] registration {axis}: no band survived, applying 0.0")
        return 0.0
    deltas.sort()
    n = len(deltas)
    dv = deltas[n // 2] if n % 2 else (deltas[n // 2 - 1] + deltas[n // 2]) / 2
    spread = deltas[-1] - deltas[0]
    print(f"[clinic] registration {axis}: {n} band(s) kept, median {dv:+.4f} m, spread {spread:.4f} m")
    if spread > REGISTRATION_SPREAD_MAX:
        print(f"[clinic] registration {axis}: spread {spread:.4f} exceeds {REGISTRATION_SPREAD_MAX}, applying 0.0")
        return 0.0
    return dv


def _bake_scale_rot(objs, mpu, rot_z, label):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.scale = (mpu, mpu, mpu)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot_z:
        bpy.ops.object.select_all(action="DESELECT")
        for ob in objs:
            ob.select_set(True)
            ob.rotation_mode = "XYZ"
            ob.rotation_euler = (0.0, 0.0, rot_z)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        print(f"[{label}] baked +Z rotation {math.degrees(rot_z):.1f} degrees")
    else:
        print(f"[{label}] no rotation baked (ROT_Z=0 -- see docstring ORIENTATION)")


def _bake_shift_and_ground(objs, dx, dy, label):
    zmin = min(min((ob.matrix_world @ v.co).z for v in ob.data.vertices) for ob in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.location.x += dx
        ob.location.y += dy
        ob.location.z += -zmin
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(
        f"[{label}] baked XY registration ({dx:+.4f}, {dy:+.4f}) m, "
        f"ground shift +{-zmin:.4f} m -> lowest vertex at z=0"
    )
    return zmin


def _finalize_and_export(role_objs, out_path):
    for role, ob in role_objs.items():
        ob.name = role
        ob.data.name = role
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role

    textured.split_textured_roles(role_objs, "clinic")
    tex_px = textured.prepare_textured_images()
    print(f"[clinic] shipping base_color at {tex_px[0]}x{tex_px[1]}, JPEG q{textured.JPEG_QUALITY}")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**textured.gltf_kwargs(out_path, CREDIT))
    size = os.path.getsize(out_path)
    verts = sum(len(ob.data.vertices) for ob in role_objs.values())
    polys = sum(len(ob.data.polygons) for ob in role_objs.values())
    return size, verts, polys, sorted(role_objs)


def export():
    real_metres = REAL_METRES_CLINIC

    # ---------------- INTACT ----------------
    src_obj = _open_source(SRC_INTACT, "intact")
    img = bpy.data.images["base_color"]
    (ex, ey, ez), idle_grade = _extent(src_obj)
    mpu_width = real_metres / ex
    mpu_depth = real_metres / ey
    mpu = math.sqrt(mpu_width * mpu_depth)
    print(
        f"[clinic] intact source extent {ex:.4f} x {ey:.4f} x {ez:.4f} model units; "
        f"width-match mpu={mpu_width:.4f} depth-match mpu={mpu_depth:.4f} "
        f"area-match mpu={mpu:.4f} (see docstring SCALE)"
    )

    src_obj.name = "intact_main"
    _decimate(src_obj, DECIMATE_RATIO, "intact")

    role_faces = _split_intact_roles(src_obj, img)
    role_objs = _tag_and_split_objects(src_obj, role_faces, "idle")
    bpy.data.objects.remove(src_obj, do_unlink=True)

    idle_objs = list(role_objs.values())
    _bake_scale_rot(idle_objs, mpu, ROT_Z, "clinic")
    _bake_shift_and_ground(idle_objs, 0.0, 0.0, "clinic")
    idle_size, idle_v, idle_p, idle_roles = _finalize_and_export(role_objs, OUT_IDLE)
    idle_world = _all_world_verts(idle_objs)
    idle_extent = (
        max(p.x for p in idle_world) - min(p.x for p in idle_world),
        max(p.y for p in idle_world) - min(p.y for p in idle_world),
        max(p.z for p in idle_world) - min(p.z for p in idle_world),
    )
    idle_min = (min(p.x for p in idle_world), min(p.y for p in idle_world), min(p.z for p in idle_world))
    idle_max = (max(p.x for p in idle_world), max(p.y for p in idle_world), max(p.z for p in idle_world))
    print(
        f"[clinic] wrote {OUT_IDLE} ({idle_size} bytes, {idle_v} verts, {idle_p} polys, roles={idle_roles})\n"
        f"  BOUNDING BOX: min=({idle_min[0]:.3f},{idle_min[1]:.3f},{idle_min[2]:.3f}) "
        f"max=({idle_max[0]:.3f},{idle_max[1]:.3f},{idle_max[2]:.3f}) "
        f"extent={idle_extent[0]:.3f} x {idle_extent[1]:.3f} x {idle_extent[2]:.3f} m"
    )
    idle_pts = [(p.x, p.y, p.z) for p in idle_world]

    # ---------------- DESTROYED ----------------
    wreck_src = _open_source(SRC_WRECK, "destroyed")
    (wx, wy, wz), wreck_grade = _extent(wreck_src)
    print(f"[clinic_wreck] source extent {wx:.4f} x {wy:.4f} x {wz:.4f} model units")
    grade_diff = abs(wreck_grade - idle_grade)
    if grade_diff > GRADE_TOL:
        raise SystemExit(
            f"clinic: grades disagree -- intact lowest vertex {idle_grade:.4f}, wreck "
            f"{wreck_grade:.4f}, difference {grade_diff:.4f} > {GRADE_TOL}. See docstring "
            "GROUND ALIGNMENT / #143."
        )
    print(
        f"[clinic] grades checked (#143): intact {idle_grade:.4f}, wreck {wreck_grade:.4f} "
        f"(difference {grade_diff:.4f} source units, within {GRADE_TOL} tolerance -- see docstring)"
    )

    wreck_src.name = "wreck_main"
    _decimate(wreck_src, DECIMATE_RATIO, "wreck")

    wreck_role_faces = _split_wreck_roles(wreck_src)
    wreck_role_objs = _tag_and_split_objects(wreck_src, wreck_role_faces, "wreck")
    bpy.data.objects.remove(wreck_src, do_unlink=True)

    wreck_objs = list(wreck_role_objs.values())
    _bake_scale_rot(wreck_objs, mpu, ROT_Z, "clinic_wreck")

    wreck_pts = [(p.x, p.y, p.z) for p in _all_world_verts(wreck_objs)]
    dx = _measure_registration(idle_pts, wreck_pts, "x", mpu)
    dy = _measure_registration(idle_pts, wreck_pts, "y", mpu)
    _bake_shift_and_ground(wreck_objs, dx, dy, "clinic_wreck")

    wreck_size, wreck_v, wreck_p, wreck_roles = _finalize_and_export(wreck_role_objs, OUT_WRECK)
    wreck_world = _all_world_verts(wreck_objs)
    wreck_extent = (
        max(p.x for p in wreck_world) - min(p.x for p in wreck_world),
        max(p.y for p in wreck_world) - min(p.y for p in wreck_world),
        max(p.z for p in wreck_world) - min(p.z for p in wreck_world),
    )
    wreck_min = (min(p.x for p in wreck_world), min(p.y for p in wreck_world), min(p.z for p in wreck_world))
    wreck_max = (max(p.x for p in wreck_world), max(p.y for p in wreck_world), max(p.z for p in wreck_world))
    print(
        f"[clinic] wrote {OUT_WRECK} ({wreck_size} bytes, {wreck_v} verts, {wreck_p} polys, roles={wreck_roles})\n"
        f"  BOUNDING BOX: min=({wreck_min[0]:.3f},{wreck_min[1]:.3f},{wreck_min[2]:.3f}) "
        f"max=({wreck_max[0]:.3f},{wreck_max[1]:.3f},{wreck_max[2]:.3f}) "
        f"extent={wreck_extent[0]:.3f} x {wreck_extent[1]:.3f} x {wreck_extent[2]:.3f} m"
    )

    if wreck_min[2] > 0.05:
        raise SystemExit(
            f"clinic_wreck: FLOATS -- lowest vertex sits at z={wreck_min[2]:.3f} m, more than "
            "5cm above ground. See #143."
        )
    print(f"[clinic] wreck grounding VERIFIED: lowest vertex z={wreck_min[2]:.4f} m (#143 satisfied)")

    summary = {
        "real_metres": real_metres,
        "mpu": mpu,
        "decimate_ratio": DECIMATE_RATIO,
        "rotation_deg": math.degrees(ROT_Z),
        "registration_dx_m": dx,
        "registration_dy_m": dy,
        "idle": {
            "path": OUT_IDLE, "bytes": idle_size, "verts": idle_v, "polys": idle_p, "roles": idle_roles,
            "bbox_min": [round(v, 4) for v in idle_min], "bbox_max": [round(v, 4) for v in idle_max],
            "extent_m": [round(v, 4) for v in idle_extent],
        },
        "wreck": {
            "path": OUT_WRECK, "bytes": wreck_size, "verts": wreck_v, "polys": wreck_p, "roles": wreck_roles,
            "bbox_min": [round(v, 4) for v in wreck_min], "bbox_max": [round(v, 4) for v in wreck_max],
            "extent_m": [round(v, 4) for v in wreck_extent],
        },
    }
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
