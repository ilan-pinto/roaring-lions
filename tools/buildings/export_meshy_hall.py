"""Export the supplied Meshy civic-hall shell as the `hall` building pair --
mesh contract v2's BUILDINGS section, matching the pattern
`export_meshy_house.py`/`_apartment.py`/`_warehouse.py`/`_clinic.py` already
ship.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_hall.py

Writes `art/meshes/buildings/hall.glb` (standing) and
`art/meshes/buildings/hall_wreck.glb` (destroyed).

THIS IS A RENAME, NOT A NEW TYPE -- task O10. `mosque` was a structure type
named for a place of worship of a real faith, which GDD Section 2 forbids
("never a faith"; see `docs/campaign/storyline.md` O10). The project lead
generated a replacement asset, the civic hall, and this script retires
`mosque` in favour of it. `data/structures.json`'s entry is RENAMED in place
(same position, id `hall`, symbol `m` unchanged, same `hp_per_tile` 900,
`garrison_slots` 3, `rubble_cover` 2, `color` limestone.1, `roe_penalty` 30 --
this IS the protected type, unlike the clinic, which the lead separately ruled
should not be). `art/meshes/buildings/mosque.glb`, `mosque_wreck.glb`, the
billboard sheet `assets/sprites/BLD_MOSQUE/`, the kit source
`art/src/buildings/mosque.blend` and `tools/buildings/patch_mosque.py` are all
deleted alongside this script landing -- git history keeps them. No new
billboard sheet ships: like the clinic, `hall`'s Pixi / `&nomesh` fallback is
the generic extruded box.

SOURCE (AI-generated, Meshy, image-to-3D-texture mode -- disclosed per
CONTRIBUTING.md), generated from a civic-hall prompt (the mosque prompt's
replacement, `docs/art/meshy-prompts-buildings.md` Prompt 2 / Open Decision 1):

    art/blend/enemy/civic hall/Meshy_AI_civic_hall_intact_3d_0906112753_image-to-3d-texture.blend
    art/blend/enemy/civic hall/Meshy_AI_civic_hall_destroyed__0906113210_image-to-3d-texture.blend

Each is a single mesh object `mesh_node`, one material (`base_color` 4096,
`metallic_roughness` 2048, `normal` 4096 -- the latter two dropped at export,
see `tools/buildings/textured.py`), one UV map (`UVMap`). Census (this
session, fresh per-file Blender process, raw un-decimated): intact 974,541
verts / 1,949,370 polys, source extent x=1.6669 y=1.9043 z=0.9031 model
units, lowest vertex z=-0.4501. Destroyed 952,925 verts / 1,922,562 polys,
extent x=1.9210 y=1.8226 z=1.1565, lowest vertex z=-0.5796.

THIRD SOURCE, REJECTED, for the identical reason `export_meshy_clinic.py`
rejects its own third source:
`Meshy_AI_civic_hall_destroyed__0906113558_part-segmentation.blend`. Censused
and NOT used. It carries 13 objects named `model_partN` (0 through 12, no
semantic label at all), zero materials and zero images (vertex colours only
-- a `Color` layer, no `base_color`), and its own bbox sits in a completely
unrelated normalised space (each part's extent is on the order of 0.01-0.2
model units, against the textured pair's ~1.7-1.9) -- guessing a
part-to-role correspondence from position alone would be inventing one the
source does not carry, and using it would forfeit the photographed wreck bake
entirely. The plain textured destroyed blend is used instead.

ORIENTATION -- MEASURED, not assumed, three independent ways, because this
building (unlike the clinic) has a real facade with actual doors as well as
a colonnaded portico, and getting this wrong is exactly the mistake this
task's brief calls out by name.

1. Four dimetric Workbench-TEXTURE renders of the intact source at the real
   render/game camera geometry (`tools/dimetric.py`: azimuth 225 degrees,
   elevation 30 degrees), at azimuth 45/135/225/315 -- the four camera
   corners a dimetric view can stand at. At IDENTITY rotation (no bake at
   all), az225 -- the exact camera this game ships -- shows a colonnaded
   portico as one of its two near walls, with a plain masonry wall (bearing
   the raised rooftop tower) as the other. az315 shows the SAME portico
   continuing around the corner, now paired with a wall of six shuttered
   windows. az135 (the corner diagonally opposite az315) shows two
   completely blank walls -- no doors, no windows, no portico.

2. Four colour-coded marker spheres (`+X` red, `-X` green, `+Y` blue, `-Y`
   yellow) placed just outside each wall and re-rendered at the same four
   azimuths to read wall identity unambiguously off the photograph rather
   than off the arithmetic. This confirms wall-for-wall: `-Y` carries the
   portico, `+X` carries the six-window wall (plus a ground-level archway/
   passage at its far end), `-X` and `+Y` are the two blank elevations.

3. Four straight-on orthographic elevations (one per wall) at higher
   resolution than the dimetric previews, to check for doors specifically
   rather than trusting a dimetric silhouette. `-Y` is the real entrance:
   a four-bay open colonnade at one end, then a plain-doored facade (two
   wooden doors, one shuttered window, one wide blank-doored bay) at the
   other. `+X` is genuine windows (six shuttered openings) plus the
   ground-level archway. `-X` and `+Y` are confirmed blank -- no cut
   geometry, no UV variation reading as an opening.

So `-Y` (Blender) is the true front (the only wall with real doors) and `+X`
(Blender) is a secondary, still-legitimate opening wall. glTF's axis
conversion (Blender Z-up -> glTF Y-up: glTF_X = Blender_X, glTF_Z =
-Blender_Y) sends Blender `-Y` to glTF `+Z` and Blender `+X` to glTF `+X` --
both of `tools/building_facing.py`'s own `CAMERA_FACING = ("+X", "+Z")` pair,
at IDENTITY rotation. `WRECK_ROT_Z = 0.0` is therefore the working
hypothesis, exactly mirroring `export_meshy_clinic.py`'s own finding -- BUT
per this pipeline's own house rule, the true authority is
`tools/building_facing.py`'s `facing_report()` run against the EXPORTED GLB,
not this preview. See the task report for that verdict.

ROLE SPLIT -- geometric, identical technique to `export_meshy_clinic.py`
(up-facing connected components classified by z-fraction and a hollowness/
"ring" test), from a decimated pass: 209 up-facing components, the largest
(n=2418, inner_frac 0.34, zfrac 0.57) the main roof deck -- coincidentally
the SAME zfrac the clinic's own deck measured. A raised tower cap
(n=137+101, zfrac 0.99-1.00, centroid toward `-X`) clears `METAL_ZFRAC` and
lands in `metal` alongside the water tank, satellite dish and railings the
same threshold already catches. Because this is a textured building
(`tools/buildings/textured.py`), the whole split is COLOUR-INERT exactly as
`export_meshy_clinic.py`'s own docstring explains -- the only role that
matters functionally is `glass`, which `building_facing.py` reads to find
the opening. `NZ_THRESH`/`RING_INNER_FRAC`/`METAL_ZFRAC` are carried over
unchanged from the clinic script rather than re-derived, since nothing about
this measurement is building-specific and re-sweeping them here would
re-spend a threshold this pipeline already owns.

GLASS -- per-wall (threshold, min_faces), swept 0.20-0.40 in steps of 0.05
exactly as `export_meshy_clinic.py`'s own sweep (see this task's report for
the full table). `-Y` (the door wall) and `+X` (the window wall) both show a
clean population of components in the tens-to-low-hundreds of faces at
threshold 0.30, comfortably separated from single-digit UV noise at lower
thresholds. `-X` and `+Y` -- confirmed blank by all three orientation checks
above -- never produce a component larger than single digits at ANY swept
threshold, which is the sweep AGREEING with the photograph rather than a
threshold invented to force a null result: their `GLASS_PARAMS` entries are
therefore set so nothing can qualify (`min_faces` far above what a real
texture-noise blob reaches on this asset), rather than omitted, so the
per-wall loop stays uniform across all four walls like the clinic's own.

DESTROYED ROLE SPLIT AND GLASS -- mirrors `export_meshy_clinic.py`'s own
destroyed-pass call exactly: no glass is attempted on the wreck (a decimated
collapse mesh does not carry a trustworthy window boundary), every up-facing
component at or above `WRECK_SIZE_FLOOR` unions into `metal`, everything else
is `wall`. `tools/building_facing.py` is expected to report `hall_wreck` as
`unchecked` -- the same bucket `clinic_wreck`/`apartment`/`camp`/`wall`/
`house_wreck` already sit in, named on the passing path, not a defect.

GROUND ALIGNMENT / #143 FLOAT CHECK. Measured BEFORE any shift: intact
lowest vertex -0.4501, destroyed -0.5796 -- a difference of 0.1295 source
units. This is LARGER than the clinic's own 0.0785 (itself already widened
from the house/apartment pairs' 0.0017-00019), so `GRADE_TOL` here is 0.15
rather than carried over at 0.10 -- the destroyed pass plausibly reaches
deeper rubble than the intact model's own foundation lip, exactly the same
kind of real difference the clinic's own docstring records, just a little
larger. Checked and reported rather than silently assumed away; each file is
still independently grounded (its OWN lowest vertex to z=0), so the exact
number is moot for where either file actually sits once exported.

REGISTRATION (dx, dy). Wall-plane-mode measurement, identical technique to
`export_meshy_clinic.py`, generalised via SLAB fractions of this building's
own measured extent.

DECIMATION. `DECIMATE_RATIO = 0.01`, matching `house`/`apartment`/
`warehouse`/`clinic` at a comparable raw density (974k/953k verts against
clinic's 961k/927k) -- not re-swept from scratch, for the identical reason
the clinic script gives. Verified after the fact by `pnpm validate:meshes`.

CUSTOM SPLIT NORMALS are kept, UVs SHIP (textured building, per
`tools/buildings/textured.py`).

SCALE. `REAL_METRES_HALL = 9.0000`. This is NOT an independent choice the
way the clinic's 12.0 was (a brand-new type with a brand-new footprint) --
`hall` keeps `mosque`'s exact symbol (`m`) and exact map footprint (a 3x3
tile block on every map that authors one), so it keeps `mosque`'s exact real
size too. `tools/dimetric.py`'s own `UNITS_PER_TILE` comment records where
that size came from: "the mosque set it: its `Hall` [the interior object
inside the old mosque.blend] is 9.0 units across a 3-tile footprint" -- i.e.
UNITS_PER_TILE (3.0) times the 3-tile footprint. Re-deriving a new footprint
size for the SAME symbol on the SAME maps would silently resize every `m`
block on `beit_sahwan_outskirts`, `marj_perimeter` and `wadi_halam_basin`
(and their variants) relative to the ground around them; 9.0 is therefore
the one number that keeps every map's rows byte-identical in effect, not
merely in symbol.
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

from dimetric import metres_per_unit  # noqa: E402  (unused directly here, kept for parity with siblings)
import kit as building_kit  # noqa: E402 -- tools/buildings/kit.py, ROLES
import textured  # noqa: E402 -- tools/buildings/textured.py, the shipped-material path

REPO = os.path.dirname(TOOLS)
# `art/blend/` is gitignored and local-only, same as every prior Meshy source
# in this pipeline.
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/enemy/civic hall"
SRC_INTACT = os.path.join(SRC_DIR, "Meshy_AI_civic_hall_intact_3d_0906112753_image-to-3d-texture.blend")
SRC_WRECK = os.path.join(SRC_DIR, "Meshy_AI_civic_hall_destroyed__0906113210_image-to-3d-texture.blend")

#: See docstring SCALE.
REAL_METRES_HALL = 9.0000

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
OUT_IDLE = os.path.join(OUT_DIR, "hall.glb")
OUT_WRECK = os.path.join(OUT_DIR, "hall_wreck.glb")

#: See docstring DECIMATION.
DECIMATE_RATIO = 0.01
#: The wreck's weight is the SOURCE's, not the ratio's -- measured 2026-09-06
#: before anyone reaches for this number again. At 0.01 the destroyed pass
#: exports at 20,992 verts / 47,860 polys / 3.96 MB, twice the idle and 2.5x
#: `clinic_wreck`. Every cheaper route was tried on the raw source and every
#: one lands on the same floor: ratio 0.005 -> 47,861 polys (byte-identical
#: GLB); validate + merge-by-distance + dissolve-degenerate then 0.01 ->
#: 47,867; a second collapse pass -> 46,491; planar dissolve (68 min) then
#: collapse -> 46,910; two-stage 0.1 x 0.1 -> 48,065. Collapse decimation
#: cannot take an island below its last few faces, and this pass is shattered
#: into thousands of small debris islands. The GLB then carries 88k vertex
#: entries for 48k triangles because the exporter splits flat-shaded shards
#: per face. Getting lighter means DELETING islands below a face count at
#: export -- an art decision about how much rubble the wreck keeps, the
#: lead's call -- so the shared ratio stays and the wreck ships as measured.
WRECK_DECIMATE_RATIO = DECIMATE_RATIO

#: Upward-facing threshold (normal.z). See docstring ROLE SPLIT.
NZ_THRESH = 0.7

#: See docstring ROLE SPLIT -- carried over from export_meshy_clinic.py.
RING_INNER_FRAC = 0.30

#: See docstring ROLE SPLIT -- carried over from export_meshy_clinic.py.
METAL_ZFRAC = 0.68

#: Fraction of the bbox range marking "near this wall's own edge" for slab
#: membership. Carried over from export_meshy_clinic.py.
SLAB_FRAC = 0.75

#: Per-wall (threshold, min_faces) pairs. See docstring GLASS. `-X`/`+Y` are
#: confirmed blank by three independent orientation checks, so their pairs
#: are set so nothing on this asset can qualify (the largest same-cell blob
#: measured on either wall, at any swept threshold, is 17 faces).
GLASS_PARAMS = {
    "+X": (0.30, 20),
    "-X": (0.20, 500),
    "+Y": (0.20, 500),
    "-Y": (0.30, 20),
}
GLASS_GRID = 90
#: Padding applied to a detected window's own measured bounding box before
#: re-selecting every face (any normal) inside it. Matches
#: export_meshy_clinic.py's identical constant.
GLASS_PAD = 0.02

#: See docstring ORIENTATION -- the working hypothesis, checked against the
#: real export by tools/building_facing.py per this task's own report.
ROT_Z = 0.0

#: z-fraction bands for wall-plane-mode registration, mirroring
#: export_meshy_clinic.py's own REGISTRATION_BANDS.
REGISTRATION_BANDS = ((0.10, 0.40), (0.20, 0.50), (0.30, 0.60), (0.40, 0.70), (0.15, 0.85))
BAND_SPAN_MIN = 0.75
REGISTRATION_SPREAD_MAX = 0.05

#: See docstring GROUND ALIGNMENT / #143.
GRADE_TOL = 0.15

WRECK_SIZE_FLOOR = 10

CREDIT = (
    "Civic hall shell (standing + destroyed) -- AI-generated (Meshy), disclosed "
    "per CONTRIBUTING.md; role-split, glass detected via per-wall texture-"
    "luminance thresholding, re-scaled for Roaring Lions. Replaces the retired "
    "mosque type (GDD Section 2, task O10)."
)


def _open_source(path, label):
    bpy.ops.wm.open_mainfile(filepath=path)
    ob = bpy.data.objects["mesh_node"]
    if ob.modifiers:
        raise SystemExit(f"hall {label}: mesh_node carries {len(ob.modifiers)} modifier(s)")
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
        f"[hall] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, "
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
            print(f"[hall intact] glass {wall}: EMPTY slab, skipped")
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
            f"[hall intact] glass {wall}: thresh={thresh} n={len(members)} "
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
        raise SystemExit("hall intact: decimated mesh has no UV layer -- glass detection needs one")

    xlo, xhi, ylo, yhi = _face_bbox(bm)
    zs = [v.co.z for v in bm.verts]
    zlo, zhi = min(zs), max(zs)

    up_idx = [f.index for f in bm.faces if f.normal.z > NZ_THRESH]
    comps = _components(bm, up_idx)
    cx, cy = (xlo + xhi) / 2, (ylo + yhi) / 2
    half_x, half_y = (xhi - xlo) / 2, (yhi - ylo) / 2

    roof_idx, trim_idx, metal_up_idx = set(), set(), set()
    print(f"[hall intact] {len(comps)} up-facing component(s) (NZ>{NZ_THRESH})")
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
        f"[hall intact] roof={len(roof_idx)} trim={len(trim_idx)} "
        f"metal(rooftop)={len(metal_up_idx)} glass={len(glass_idx)}"
    )

    used = roof_idx | trim_idx | metal_up_idx | glass_idx
    wall_idx = {f.index for f in bm.faces} - used
    print(f"[hall intact] wall={len(wall_idx)} (of {len(bm.faces)} total faces)")
    bm.free()
    return {"roof": roof_idx, "trim": trim_idx, "metal": metal_up_idx, "glass": glass_idx, "wall": wall_idx}


def _split_wreck_roles(wreck_obj):
    """Mirrors export_meshy_clinic.py's own destroyed-pass call -- see
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
        f"[hall_wreck] upward faces {len(up_idx)}, {len(comps)} components, "
        f"top sizes {[len(c) for c in comps[:6]]}"
    )
    print(f"[hall_wreck] roles: metal(roof/debris)={len(metal_idx)} wall={len(wall_idx)}")
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
                f"[hall] registration {axis} band {zf0:.2f}-{zf1:.2f} side {sign:+d}: "
                f"intact {ic:+.4f}/{ispan:.4f} wreck {wc:+.4f}/{wspan:.4f} d={d:+.4f} "
                f"{'' if ok else '-- REJECTED'}"
            )
            if ok:
                deltas.append(d)
    if not deltas:
        print(f"[hall] registration {axis}: no band survived, applying 0.0")
        return 0.0
    deltas.sort()
    n = len(deltas)
    dv = deltas[n // 2] if n % 2 else (deltas[n // 2 - 1] + deltas[n // 2]) / 2
    spread = deltas[-1] - deltas[0]
    print(f"[hall] registration {axis}: {n} band(s) kept, median {dv:+.4f} m, spread {spread:.4f} m")
    if spread > REGISTRATION_SPREAD_MAX:
        print(f"[hall] registration {axis}: spread {spread:.4f} exceeds {REGISTRATION_SPREAD_MAX}, applying 0.0")
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

    textured.split_textured_roles(role_objs, "hall")
    tex_px = textured.prepare_textured_images()
    print(f"[hall] shipping base_color at {tex_px[0]}x{tex_px[1]}, JPEG q{textured.JPEG_QUALITY}")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**textured.gltf_kwargs(out_path, CREDIT))
    size = os.path.getsize(out_path)
    verts = sum(len(ob.data.vertices) for ob in role_objs.values())
    polys = sum(len(ob.data.polygons) for ob in role_objs.values())
    return size, verts, polys, sorted(role_objs)


def export():
    real_metres = REAL_METRES_HALL

    # ---------------- INTACT ----------------
    src_obj = _open_source(SRC_INTACT, "intact")
    img = bpy.data.images["base_color"]
    (ex, ey, ez), idle_grade = _extent(src_obj)
    mpu_width = real_metres / ex
    mpu_depth = real_metres / ey
    mpu = math.sqrt(mpu_width * mpu_depth)
    print(
        f"[hall] intact source extent {ex:.4f} x {ey:.4f} x {ez:.4f} model units; "
        f"width-match mpu={mpu_width:.4f} depth-match mpu={mpu_depth:.4f} "
        f"area-match mpu={mpu:.4f} (see docstring SCALE)"
    )

    src_obj.name = "intact_main"
    _decimate(src_obj, DECIMATE_RATIO, "intact")

    role_faces = _split_intact_roles(src_obj, img)
    role_objs = _tag_and_split_objects(src_obj, role_faces, "idle")
    bpy.data.objects.remove(src_obj, do_unlink=True)

    idle_objs = list(role_objs.values())
    _bake_scale_rot(idle_objs, mpu, ROT_Z, "hall")
    _bake_shift_and_ground(idle_objs, 0.0, 0.0, "hall")
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
        f"[hall] wrote {OUT_IDLE} ({idle_size} bytes, {idle_v} verts, {idle_p} polys, roles={idle_roles})\n"
        f"  BOUNDING BOX: min=({idle_min[0]:.3f},{idle_min[1]:.3f},{idle_min[2]:.3f}) "
        f"max=({idle_max[0]:.3f},{idle_max[1]:.3f},{idle_max[2]:.3f}) "
        f"extent={idle_extent[0]:.3f} x {idle_extent[1]:.3f} x {idle_extent[2]:.3f} m"
    )
    idle_pts = [(p.x, p.y, p.z) for p in idle_world]

    # ---------------- DESTROYED ----------------
    wreck_src = _open_source(SRC_WRECK, "destroyed")
    (wx, wy, wz), wreck_grade = _extent(wreck_src)
    print(f"[hall_wreck] source extent {wx:.4f} x {wy:.4f} x {wz:.4f} model units")
    grade_diff = abs(wreck_grade - idle_grade)
    if grade_diff > GRADE_TOL:
        raise SystemExit(
            f"hall: grades disagree -- intact lowest vertex {idle_grade:.4f}, wreck "
            f"{wreck_grade:.4f}, difference {grade_diff:.4f} > {GRADE_TOL}. See docstring "
            "GROUND ALIGNMENT / #143."
        )
    print(
        f"[hall] grades checked (#143): intact {idle_grade:.4f}, wreck {wreck_grade:.4f} "
        f"(difference {grade_diff:.4f} source units, within {GRADE_TOL} tolerance -- see docstring)"
    )

    wreck_src.name = "wreck_main"
    _decimate(wreck_src, WRECK_DECIMATE_RATIO, "wreck")

    wreck_role_faces = _split_wreck_roles(wreck_src)
    wreck_role_objs = _tag_and_split_objects(wreck_src, wreck_role_faces, "wreck")
    bpy.data.objects.remove(wreck_src, do_unlink=True)

    wreck_objs = list(wreck_role_objs.values())
    _bake_scale_rot(wreck_objs, mpu, ROT_Z, "hall_wreck")

    wreck_pts = [(p.x, p.y, p.z) for p in _all_world_verts(wreck_objs)]
    dx = _measure_registration(idle_pts, wreck_pts, "x", mpu)
    dy = _measure_registration(idle_pts, wreck_pts, "y", mpu)
    _bake_shift_and_ground(wreck_objs, dx, dy, "hall_wreck")

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
        f"[hall] wrote {OUT_WRECK} ({wreck_size} bytes, {wreck_v} verts, {wreck_p} polys, roles={wreck_roles})\n"
        f"  BOUNDING BOX: min=({wreck_min[0]:.3f},{wreck_min[1]:.3f},{wreck_min[2]:.3f}) "
        f"max=({wreck_max[0]:.3f},{wreck_max[1]:.3f},{wreck_max[2]:.3f}) "
        f"extent={wreck_extent[0]:.3f} x {wreck_extent[1]:.3f} x {wreck_extent[2]:.3f} m"
    )

    if wreck_min[2] > 0.05:
        raise SystemExit(
            f"hall_wreck: FLOATS -- lowest vertex sits at z={wreck_min[2]:.3f} m, more than "
            "5cm above ground. See #143."
        )
    print(f"[hall] wreck grounding VERIFIED: lowest vertex z={wreck_min[2]:.4f} m (#143 satisfied)")

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
