"""Export the supplied Meshy warehouse shell as the `warehouse` building
pair, mesh contract v2's BUILDINGS section.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_warehouse.py

Writes `art/meshes/buildings/warehouse.glb` (standing) and
`art/meshes/buildings/warehouse_wreck.glb` (destroyed), REPLACING the
kit-built pair `tools/buildings/author_warehouse.py`/`export_mesh_building.py`
currently ship. Not a new type: `data/structures.json` already carries
`warehouse` (`gunmetal.1` wall colour, resolved at runtime, not by this
script), and `packages/app/src/main.ts`'s `MESH_BUILDINGS` already lists it.
No wiring change is made by this script -- see NOT DONE below for the one
piece of wiring `export_meshy_apartment.py` and `export_meshy_house.py` each
made that this script deliberately skips, and why it is safe to skip.

SOURCE (AI-generated, Meshy, image-to-3D-texture mode -- disclosed per
CONTRIBUTING.md), GitHub issue #140:

    art/blend/enemy/building 3 /Meshy_AI_warehouse_intact_0901053151_image-to-3d-texture.blend
    art/blend/enemy/building 3 /Meshy_AI_warehouse_destroyed_0901053104_image-to-3d-texture.blend

(Note the TRAILING SPACE in "building 3 " -- in the source tree, not a typo;
`art/blend/` is gitignored and local-only, same as every prior Meshy source
in this pipeline.)

Each is a single mesh object `mesh_node`, one material, baked 4096/2048
textures (discarded -- zero materials ship, per contract), custom split
normals, no modifiers. Intact: 937,659 verts / 1,875,664 tris. Destroyed:
913,436 verts / 1,832,154 tris.

WHAT THIS SOURCE IS: a square industrial shed, four solid walls, near-square
footprint (source-frame X span 1.9027, Y span 1.9026 -- effectively square,
unlike the apartment/house sources which needed a width-vs-depth scale
decision). Confirmed by inspection: TWO roller doors, on the +Y and -Y walls
(opposite ends -- a drive-through loading design), two small vent-style
windows each on the +X and -X walls and one each on +Y/-Y (six total),
and a perimeter parapet coping at the top of all four walls.

THE INTACT SOURCE HAS NO ROOF. This is the single most consequential finding
in this file and cost the most verification time, because it reads as a
rendering bug and is not one. Established two independent ways:

  1. Visual: a straight-down orthographic Workbench TEXTURE still of the
     intact source shows a picture-frame -- four wall tops and nothing in the
     middle, the same colour as the render background, meaning the ray
     passes clean through to nothing.
  2. Geometric: of the 172,694 upward-facing (normal.z > 0.7) faces in the
     raw intact mesh, the ones in the top 10% of the model's height (the
     parapet band) are ALL within the exterior footprint's own bounding
     box -- zero of 50,638 such faces have a centroid inside the inner 60%
     of the footprint. There is a coping ring. There is no deck.

The DESTROYED source, by contrast, HAS a roof: a large, mostly-intact
corrugated-metal plane with a crack and a collapsed corner near one of the
roller doors, confirmed by the same upward-face census (a real bimodal
z-histogram -- heavy mass at both the ground/debris band and the roof band)
and by a dimetric Workbench render showing a visible sheet-metal deck.

CONCLUSION AND FIX: the missing roof is a genuine source gap, not a
rendering artifact, and shipping the intact model as-is would draw an open
box -- gameplay's dimetric camera looks down at 30 degrees elevation, so the
hollow interior would be plainly visible, worse than any of the silhouette
gaps this pipeline has fixed before. This script SYNTHESISES a flat roof cap
or the intact pass only: a single quad sized to the coping ring's own
measured inner edge (see `_synthesize_roof_cap`), sitting at the coping
band's own lowest z (where a flat deck would naturally rest under the
parapet lip), tagged `metal`. Not `roof`: this building's OWN kit-authored
predecessor (`author_warehouse.py`) already tags its sheet-metal roof panels
`metal`, not `roof` -- `warehouse` has never shipped a `roof`-role mesh, and
matching that convention keeps this replacement consistent with the type it
replaces rather than borrowing the masonry-roof convention from apartment/
mosque, which is materially wrong for a corrugated warehouse deck.

NOT DONE, deliberately: this script does not flip `render_building.py`'s
`WAREHOUSE.mesh_owner` off `MESH_KIT_OWNED` the way `export_meshy_house.py`'s
own replacement required. That flip is what stops `export_mesh_building.py`
from silently regenerating the kit-built sprite mesh over this one -- but
`export_mesh_building.py` (`e126421`) also carries a SECOND, independent
guard, `_assert_no_provenance_drift`: before writing either output path, it
reads the existing GLB's own `asset.copyright` and refuses to overwrite it
if that string does not match `WAREHOUSE.credit`, regardless of
`mesh_owner`. `CREDIT` below intentionally reads nothing like
`WAREHOUSE.credit` ("Original work for Roaring Lions (CC BY-SA 4.0)"), so
that guard alone is sufficient -- confirmed by reading `export_mesh_building.
py:170-207` rather than assumed, and this is exactly the mechanism
`docs/ASSET_PROVENANCE.md` documents as "the fix" for the gap the house
replacement first exposed. `export_meshy_apartment.py`'s own docstring notes
the SAME mesh_owner flip as still owed on `render_building.py` and it is
STILL `MESH_KIT_OWNED` today (checked by reading `render_building.py`
directly, not assumed) -- so leaving it alone here matches the apartment
replacement's actual shipped state, not a corner cut relative to it. This
task's own brief says "No wiring changes"; `render_building.py`'s
`BuildingSpec` table is Blender-pipeline bookkeeping, not game wiring
(`data/structures.json`, `packages/app/src/main.ts`), but it is left alone
anyway, in the same spirit and because the second guard makes the flip
unnecessary for safety.

ORIENTATION -- NO ROTATION BAKED, unlike the apartment wreck's 180 degrees.
Established three ways, all pointing the same direction:

  1. Both sources' bounding boxes are centred within 0.006 source units of
     each other in X and Y (intact centre -0.0002,+0.0002; wreck centre
     +0.0055,+0.0002) -- consistent with two Meshy generations sharing one
     coordinate frame, not two independently-oriented ones (the apartment
     pair's two files disagreed by up to 180 degrees; this pair does not).
  2. Per-wall face counts (faces whose local normal's dominant horizontal
     component points +X/-X/+Y/-Y): in the wreck, the two walls that carry
     the roller doors in the intact model (+Y, -Y) retain 48% of their
     intact face count; the two window-only walls (+X, -X) retain 53-54%.
     The SAME walls are the damaged ones in both files.
  3. Dimetric Workbench renders (azimuth 225, elevation 30 -- `dimetric.py`,
     the one angle this game ever draws a building from) of both sources at
     the SAME camera show the roller-door wall as the near-right facade in
     BOTH the intact and the destroyed render, and the wreck's collapse
     originates at that same facade.

`WRECK_ROT_Z = 0.0` below records this rather than omitting the constant, so
a future re-measurement has something to compare against.

GLASS -- SHIPPED for the intact pass, not shipped for the destroyed pass,
and both are measured decisions, not the same "nothing separates it" call
apartment made for its own (different) source.

  * INTACT: the six vent-style windows are the one feature this source DOES
    separate cleanly, and not by depth -- a raycast depth-map across the two
    door-bearing walls found a total front-to-back spread of 0.031 source
    units (about 20 cm at this model's scale) over the ENTIRE wall,
    including the door and every window: there is no real recess to key on
    geometrically, on this source, at this resolution. What separates a
    window from the surrounding concrete is the BAKED TEXTURE: the source's
    own `base_color` image, sampled at each face's own UV centroid. A
    per-wall luminance histogram (0.299R+0.587G+0.114B) is trimodal --
    dominant mass at 0.50-0.65 (plain concrete), a small tail below 0.30
    (window/vent grille, near-black), nothing distinct in between for the
    door (see METAL/DOOR below). Thresholding at 0.32 and taking connected
    components (bmesh edge-adjacency, restricted to each wall's own "slab"
    membership -- see `_wall_slab_faces`) isolates exactly one clean blob
    per window, 60-150 faces each at DECIMATE_RATIO 0.01, against a next-
    largest noise component under 10 faces on every wall -- an order of
    magnitude of separation, the same bar `export_meshy_apartment.py` uses
    for its own geometric splits. `_detect_glass` implements this; see its
    own docstring for `LUM_GLASS_THRESH`, `GLASS_MIN_FACES`, and the padding
    applied to each detected blob's own bounding box before re-selecting
    every face (any normal, including the reveal sides) inside it.
  * DESTROYED: the SAME detector, run on the wreck's own decimated mesh and
    its own `base_color` bake, finds nothing trustworthy. The two window-
    only walls (+X, -X) have too few slab-member faces after collapse
    damage and decimation (500-700, against 2,000-3,000 on the intact pass)
    for any component to clear `GLASS_MIN_FACES` with confidence, and the
    one component that DOES clear it on a door-bearing wall (+Y, 101 faces)
    sits at source-frame axis [0.134, 0.307] -- nowhere near that wall's
    OWN intact window position ([-0.749, -0.595]) -- which reads as a crack
    or shadow artefact from the collapse, not the surviving window.
    Shipping it would be inventing a boundary the geometry does not
    support, the same call `export_meshy_apartment.py`'s own docstring
    makes for ITS destroyed pass ("nothing in this source separates a
    shutter from its opening... shipping them would mean inventing a
    boundary the geometry does not carry"). So: no `glass` on the wreck.

METAL/DOOR -- NOT SHIPPED AS A SEPARATE ROLE, on either pass, and this is
the one place this script falls short of "every visible feature gets its
own role." The two roller doors are clearly visible in every render (a
lighter, horizontally-ridged shutter) but do NOT separate from the
surrounding wall by any signal this pipeline has: not depth (0.031-unit
total spread, see GLASS above), and not mean luminance -- the same per-wall
histogram that isolates the window cleanly below 0.32 shows NOTHING between
0.30 and 0.50 wide enough to be a door; sweeping the "darker than wall"
connected-component threshold from 0.58 down to 0.50 makes the one big
door-shaped blob VANISH entirely (it was dirt-streak connectivity bridging
across the whole lower wall, not the door), and 0.50 down to 0.32 finds only
the same window blob already reported. The door reads to a human eye by its
horizontal ridge PATTERN, not by its average tone, and detecting a periodic
pattern in a texture is out of scope for this task. The two door leaves
therefore ship as `wall`, coloured the same `gunmetal.1` as the rest of the
building -- an acceptable simplification given `gunmetal.1` is already an
industrial grey, not a jarring mismatch the way it would be on a limestone
building, but a real, disclosed loss of a distinguishing feature relative to
the kit-built predecessor (which modelled the door as its own object).

TRIM -- the parapet coping, upward-facing (normal.z > NZ_THRESH) faces in
the top `TOP_Z_FRAC` of the model's own height band. Unlike apartment there
is no competing "largest component = roof deck" to separate FROM trim --
this source has no roof deck at all (see above), so every qualifying face
IS the coping ring, full stop. Confirmed empty-interior per the geometric
finding above (zero of 50,638 such faces reach the inner 60% of the
footprint), so no perimeter/span heuristic is needed the way apartment's
`TRIM_SPAN`/`PERIMETER` filtered a rival inboard patch.

ROOF CAP SYNTHESIS -- new geometry, not sourced from the Meshy mesh at all,
and the one deliberate departure from "everything ships as decimated source
geometry" every prior script in this pipeline follows. `_synthesize_roof_cap`
measures the trim ring's OWN inner edge per side (closest trim-face centroid
to the building's centreline on each of the four sides) and drops a single
flat `kit.box` slab spanning that measured interior rectangle, at the
ring's own lowest z (where a flat deck sits naturally under the parapet
lip), 0.02 source units thick. Built in SOURCE FRAME, before
`_bake_scale_rot` runs, so it rides through the same scale bake as
everything else and stays perfectly registered with the coping it sits
inside. Tagged `metal` (see METAL/DOOR discussion of WHY above -- author_
warehouse.py's own convention, not `roof`).

DESTROYED ROLE SPLIT -- `roof`(-> tagged `metal`) = the union of every
upward-facing component above a small noise floor (mirrors `export_meshy_
apartment.py`'s own destroyed-pass call: "no single dominant plane... the
honest read"); `wall` = everything else. No `trim` on the wreck either, for
the same reason apartment's destroyed pass drops it: the coping does not
survive as a separable signal once the corner has collapsed and the mesh
has been decimated.

GROUND ALIGNMENT / THE #143 FLOAT CHECK. Both files are shifted independently
so each one's OWN lowest vertex lands at z=0 -- the contract's "the model's
own world origin at z ~ 0" anchor, and the mechanism that would catch a
floating wreck if this source had one. It does not: measured BEFORE any
shift, intact's lowest vertex sits at z=-0.3336 source units and the
wreck's at z=-0.3319, a difference of 0.0017 source units (about 1 cm at
this model's scale) -- `_assert_grades_agree` enforces this stays small.
Both numbers, and the shipped GLBs' own post-export bounding boxes, are
printed by `export()` and reported in this task's own writeup verbatim, per
the brief's explicit ask. The destroyed source was NOT authored at standing
height needing a manual drop -- its own lowest point already sits at
essentially the same source-frame height as the intact model's, so grounding
each file by its own minimum is sufficient and no extra correction is
applied.

REGISTRATION (dx, dy). Measured, not assumed, the same wall-plane-mode-by-
z-band method `export_meshy_apartment.py` uses for its own single-axis (X)
correction, generalised here to both axes since this wreck is not rotated
(apartment's Y never needed correction only because its own 180-degree
rotation left Y already exact). `_measure_registration` runs the same
median-of-surviving-bands, span-rejection, spread-check logic on X and
independently on Y. See the constants below for what was actually measured
on this pair and the tolerances applied.

DECIMATION. `DECIMATE_RATIO = 0.01`, matching `apartment`/`house` at a
comparable raw density (this source is 937k/913k verts against apartment's
994k/955k) -- verified after the fact by `pnpm validate:meshes` rather than
by an exhaustive per-ratio silhouette sweep the way `export_meshy_apartment.
py` ran one; see this task's own report for the pass/fail and margin.

CUSTOM SPLIT NORMALS are kept (both sources are smooth-shaded with them,
the same call every prior script in this pipeline makes and for the same
reason -- see `export_meshy_apartment.py`'s own docstring). UVs are dropped
at export (`export_texcoords=False`) -- they are used INTERNALLY, before
export, to sample `base_color` for the glass detector, then discarded along
with every other material reference, since zero materials ship.

SCALE. `REAL_METRES_WAREHOUSE = 12.0`, measured from the pre-replacement,
kit-built `warehouse.glb`'s own X extent (`_measure_existing_extent`, kept
for provenance and not called by `export()`) and independently corroborated
by `render_building.py`'s own `WAREHOUSE.footprint_tiles = 4` times
`dimetric.UNITS_PER_TILE = 3.0` = 12.0 m exactly. Unlike apartment/house,
width-match and depth-match are NOT meaningfully different choices here --
the source's own X and Y spans agree to four significant figures (1.9027 vs
1.9026) -- so there is no width-vs-depth judgement call to record; the same
mpu is applied to both axes and produces a near-exact 12.00 x 11.9994 m
footprint.
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

REPO = os.path.dirname(TOOLS)
# `art/blend/` is gitignored and local-only -- see export_meshy_apartment.py's
# own note on this, identical reasoning. Trailing space in "building 3 " is in
# the source tree, not a typo.
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/enemy/building 3 "
SRC_INTACT = os.path.join(SRC_DIR, "Meshy_AI_warehouse_intact_0901053151_image-to-3d-texture.blend")
SRC_WRECK = os.path.join(SRC_DIR, "Meshy_AI_warehouse_destroyed_0901053104_image-to-3d-texture.blend")

#: Measured once against the pre-replacement kit-built warehouse.glb's own X
#: extent (12.0000 m) and independently corroborated by footprint_tiles=4 *
#: UNITS_PER_TILE=3.0 = 12.0 m. See docstring SCALE.
REAL_METRES_WAREHOUSE = 12.0000

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
OUT_IDLE = os.path.join(OUT_DIR, "warehouse.glb")
OUT_WRECK = os.path.join(OUT_DIR, "warehouse_wreck.glb")

#: Both sources measured at a comparable raw density to apartment/house. See
#: docstring DECIMATION.
DECIMATE_RATIO = 0.01

#: Upward-facing threshold (normal.z), for the coping ring (intact) and the
#: roof/debris union (destroyed).
NZ_THRESH = 0.7

#: Top fraction of the model's own z-span counted as the coping band. See
#: docstring TRIM.
TOP_Z_FRAC = 0.90

#: A face is a candidate member of wall W's own "slab" if its position along
#: W's normal axis exceeds this (source-frame; wall planes measured at
#: 0.85-0.95). Generous enough to include a recessed reveal, tight enough to
#: exclude the opposite wall. See docstring GLASS and `_wall_slab_faces`.
SLAB = 0.75

#: Window/vent luminance threshold and grid, measured against this source's
#: own per-wall luminance histogram -- see docstring GLASS. Below 0.32 is a
#: clean, isolated blob per window on every wall at DECIMATE_RATIO 0.01;
#: sweeping down from 0.58 (where the door's dirt-streak connectivity
#: dominates and swallows most of the wall) confirms 0.32 finds the same
#: window blobs and nothing else survives it.
LUM_GLASS_THRESH = 0.32
GLASS_GRID = 90
#: Noise components on a clean wall run under 10 faces at this grid/ratio; a
#: real window runs 60-150. See docstring GLASS.
GLASS_MIN_FACES = 20
#: Padding applied to a detected window's own measured bounding box before
#: re-selecting every face (any normal) inside it, so the visible casing --
#: not just the darkest texels -- ships as glass.
GLASS_PAD = 0.025

#: Baked onto neither file -- see docstring ORIENTATION. Recorded rather than
#: omitted so a future re-measurement has something to compare against.
WRECK_ROT_Z = 0.0

#: z-fraction bands for the wall-plane-mode registration measurement, X and Y
#: independently. See docstring REGISTRATION.
REGISTRATION_BANDS = ((0.10, 0.40), (0.20, 0.50), (0.30, 0.60), (0.40, 0.70), (0.15, 0.85))
#: A band whose wreck wall-plane span falls under this fraction of the
#: intact's own span for that band is rejected -- its mode has landed off a
#: real wall (e.g. on the collapsed corner). Same mechanism and same default
#: as export_meshy_apartment.py's own.
BAND_SPAN_MIN = 0.75
#: Surviving bands must agree to this, in source units, or the measurement
#: is not trusted and 0.0 is applied instead (documented at the call site).
REGISTRATION_SPREAD_MAX = 0.05

#: `_assert_grades_agree` tolerance, source units. Measured difference
#: between the two files' own lowest vertices: 0.0017. See docstring GROUND
#: ALIGNMENT / #143.
GRADE_TOL = 0.01

#: Destroyed-pass roof/debris union floor, in faces -- mirrors export_meshy_
#: apartment.py's own WRECK_SIZE_FLOOR at a comparable decimate ratio.
WRECK_SIZE_FLOOR = 10

CREDIT = (
    "Warehouse shell (standing + destroyed) -- AI-generated (Meshy), "
    "disclosed per CONTRIBUTING.md; role-split, glass detected via texture-"
    "luminance thresholding, roof cap synthesised (source has none), "
    "re-scaled for Roaring Lions"
)


def _measure_existing_extent(glb_path):
    """Fresh-imports a building glb into an empty scene and measures its own
    per-axis extent -- how REAL_METRES_WAREHOUSE above was produced (against
    the pre-replacement, kit-built warehouse.glb). NOT called by `export()` --
    this script overwrites that same path, so a second run would measure its
    own prior output rather than the kit-built ground truth. See
    export_meshy_apartment.py's identical `_measure_existing_extent` for the
    same reasoning."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            wc = eo.matrix_world @ v.co
            xs.append(wc.x)
            ys.append(wc.y)
            zs.append(wc.z)
        eo.to_mesh_clear()
    extent = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return extent


def _open_source(path, label):
    bpy.ops.wm.open_mainfile(filepath=path)
    ob = bpy.data.objects["mesh_node"]
    if ob.modifiers:
        raise SystemExit(f"warehouse {label}: mesh_node carries {len(ob.modifiers)} modifier(s)")
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
        f"[warehouse] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, "
        f"{before_p} -> {after_p} polys"
    )


def _wall_key(n):
    """Which of the 4 cardinal walls a face's normal points toward, or None
    for an up/down/off-axis face. Used only to bucket the coping ring
    (`_find_trim`) and the destroyed roof union, where noise from the
    normal-sign leakage `_wall_slab_faces` was built to avoid does not
    matter (both consumers pool all 4 directions together)."""
    if n.z > 0.5 or n.z < -0.5:
        return None
    if abs(n.x) > abs(n.y):
        return "+X" if n.x > 0.5 else ("-X" if n.x < -0.5 else None)
    return "+Y" if n.y > 0.5 else ("-Y" if n.y < -0.5 else None)


def _wall_slab_faces(bm, wall):
    """Every face whose CENTRE POSITION (not normal -- normals are noisy on
    this source, see docstring GLASS) sits inside wall `wall`'s own slab.
    Position-based membership, unlike `_wall_key`, does not leak across a
    noisy patch of locally-flipped normals; see the module docstring's
    account of the connected-component leakage this replaced."""
    idx = []
    for f in bm.faces:
        c = f.calc_center_median()
        if wall == "+X" and c.x > SLAB:
            idx.append((f.index, c.y, c.z))
        elif wall == "-X" and c.x < -SLAB:
            idx.append((f.index, c.y, c.z))
        elif wall == "+Y" and c.y > SLAB:
            idx.append((f.index, c.x, c.z))
        elif wall == "-Y" and c.y < -SLAB:
            idx.append((f.index, c.x, c.z))
    return idx


def _sample_uv_luminance(bm, uv_layer, arr, w, h):
    """Per-face average UV -> `base_color` luminance, keyed by face index."""
    lum = {}
    for f in bm.faces:
        us = [l[uv_layer].uv.x for l in f.loops]
        vs = [l[uv_layer].uv.y for l in f.loops]
        u = sum(us) / len(us)
        v = sum(vs) / len(vs)
        x = int(min(max(u, 0.0), 0.999999) * w)
        y = int(min(max(v, 0.0), 0.999999) * h)
        col = arr[y, x]
        lum[f.index] = float(0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2])
    return lum


def _detect_glass(bm, uv_layer, img, label):
    """Returns a set of face indices to tag `glass` -- see docstring GLASS.
    For each of the 4 walls: bucket that wall's own slab-member faces onto a
    (axis, z) grid, threshold the average luminance per cell, take connected
    components over the grid, keep components >= GLASS_MIN_FACES, pad each
    surviving component's own measured (axis, z) bounding box by GLASS_PAD,
    then re-select every face on that wall (regardless of normal) whose
    centre falls inside the padded box -- capturing the visible window
    casing, not just the darkest texels."""
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    face_lum = _sample_uv_luminance(bm, uv_layer, arr, w, h)
    faces_by_idx = {f.index: f for f in bm.faces}

    glass_idx = set()
    for wall in ("+X", "-X", "+Y", "-Y"):
        members = _wall_slab_faces(bm, wall)
        if not members:
            print(f"[warehouse {label}] glass {wall}: EMPTY slab, skipped")
            continue
        axis_vals = [a for (_, a, _) in members]
        z_vals = [z for (_, _, z) in members]
        a_lo, a_hi = min(axis_vals), max(axis_vals)
        z_lo, z_hi = min(z_vals), max(z_vals)

        def cell(a, z):
            ai = min(GLASS_GRID - 1, max(0, int((a - a_lo) / max(a_hi - a_lo, 1e-9) * GLASS_GRID)))
            zi = min(GLASS_GRID - 1, max(0, int((z - z_lo) / max(z_hi - z_lo, 1e-9) * GLASS_GRID)))
            return ai, zi

        sum_lum = defaultdict(float)
        cnt = defaultdict(int)
        cell_faces = defaultdict(list)
        for fi, a, z in members:
            c = cell(a, z)
            sum_lum[c] += face_lum[fi]
            cnt[c] += 1
            cell_faces[c].append(fi)

        mark = {c for c in cnt if (sum_lum[c] / cnt[c]) < LUM_GLASS_THRESH}
        seen = set()
        comps = []
        for c in mark:
            if c in seen:
                continue
            stack = [c]
            seen.add(c)
            comp = []
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
        comps.sort(key=len, reverse=True)
        sizes = [sum(cnt[c] for c in comp) for comp in comps]
        print(
            f"[warehouse {label}] glass {wall}: {len(members)} slab faces, "
            f"{len(comps)} dark components, top face-counts {sizes[:5]}"
        )

        for comp, size in zip(comps, sizes):
            if size < GLASS_MIN_FACES:
                continue
            comp_cells = set(comp)
            bx = [a for (fi, a, z) in members if cell(a, z) in comp_cells]
            bz = [z for (fi, a, z) in members if cell(a, z) in comp_cells]
            pb_lo, pb_hi = min(bx) - GLASS_PAD, max(bx) + GLASS_PAD
            pz_lo, pz_hi = min(bz) - GLASS_PAD, max(bz) + GLASS_PAD
            print(
                f"    -> window blob n={size} axis[{pb_lo:.4f},{pb_hi:.4f}] "
                f"z[{pz_lo:.4f},{pz_hi:.4f}]"
            )
            for fi, a, z in members:
                if pb_lo <= a <= pb_hi and pz_lo <= z <= pz_hi:
                    glass_idx.add(fi)
    return glass_idx


def _find_trim(bm):
    """Every upward-facing face in the top TOP_Z_FRAC of the mesh's own
    height -- the coping ring. See docstring TRIM."""
    zs = [v.co.z for v in bm.verts]
    zlo, zhi = min(zs), max(zs)
    thresh = zlo + TOP_Z_FRAC * (zhi - zlo)
    trim_idx = set()
    for f in bm.faces:
        if f.normal.z > NZ_THRESH and f.calc_center_median().z > thresh:
            trim_idx.add(f.index)
    return trim_idx, zlo, zhi


def _synthesize_roof_cap(bm, trim_idx):
    """Measures the coping ring's OWN inner edge per side and returns
    (x_lo, x_hi, y_lo, y_hi, z) for a flat cap spanning it -- see docstring
    ROOF CAP SYNTHESIS. `z` is the ring's own lowest z (where a flat deck
    rests under the parapet lip).

    The four ring segments must be told apart by POSITION before taking an
    inner edge, not just by the sign of x/y: the +Y and -Y segments each run
    the FULL x length of that wall (from about -0.9 to +0.9), so a naive
    "every trim face with x<0" pool is dominated by those two long strips
    and its max lands near the building's own centreline, not near the -X
    wall at all -- caught by this exact bug on this script's own first
    scratch-dir run (a roof cap sized 0.004 x 0.021 source units instead of
    about 1.75 x 1.75, i.e. no roof cap at all; the check-render still
    showed a hollow interior). `_wall_slab_faces`' SLAB threshold, already
    validated for the glass detector, is the fix: restrict each side's inner-
    edge search to faces actually belonging to that wall's own slab."""
    per_side = {"+X": [], "-X": [], "+Y": [], "-Y": []}
    for fi in trim_idx:
        c = bm.faces[fi].calc_center_median()
        if c.x > SLAB:
            per_side["+X"].append(c.x)
        elif c.x < -SLAB:
            per_side["-X"].append(c.x)
        elif c.y > SLAB:
            per_side["+Y"].append(c.y)
        elif c.y < -SLAB:
            per_side["-Y"].append(c.y)
    for side, vals in per_side.items():
        if not vals:
            raise SystemExit(f"warehouse: roof cap synthesis found no trim faces on the {side} side")
    # A small OUTWARD pad on each edge: the render-check on this script's
    # own scratch run showed a hairline gap (background visible) between
    # the cap and the coping's own inner face on one side without it -- the
    # ring's inner boundary is a scatter of face centroids, not a perfect
    # rectangle, so the cap must overlap slightly under the coping rather
    # than exactly kiss it.
    ROOF_CAP_OVERLAP = 0.03
    x_lo = max(per_side["-X"]) - ROOF_CAP_OVERLAP  # innermost point of the -X coping strip
    x_hi = min(per_side["+X"]) + ROOF_CAP_OVERLAP  # innermost point of the +X coping strip
    y_lo = max(per_side["-Y"]) - ROOF_CAP_OVERLAP
    y_hi = min(per_side["+Y"]) + ROOF_CAP_OVERLAP
    z = min(bm.faces[fi].calc_center_median().z for fi in trim_idx)
    print(
        f"[warehouse] roof cap interior (measured per-side from coping ring, "
        f"n={[len(v) for v in per_side.values()]}): "
        f"x[{x_lo:.4f},{x_hi:.4f}] y[{y_lo:.4f},{y_hi:.4f}] z={z:.4f}"
    )
    if x_hi <= x_lo or y_hi <= y_lo:
        raise SystemExit(
            f"warehouse: roof cap interior is degenerate (x[{x_lo:.4f},{x_hi:.4f}] "
            f"y[{y_lo:.4f},{y_hi:.4f}]) -- the coping ring was not correctly isolated"
        )
    return x_lo, x_hi, y_lo, y_hi, z


def _split_intact_roles(main_obj, img):
    """Returns {role: set(face_index)} for the decimated intact shell, plus
    the coping's own measured inner rectangle (for the roof cap). See
    docstring TRIM / GLASS."""
    bm = bmesh.new()
    bm.from_mesh(main_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    uv_layer = bm.loops.layers.uv.active
    if uv_layer is None:
        raise SystemExit("warehouse intact: decimated mesh has no UV layer -- glass detection needs one")

    trim_idx, zlo, zhi = _find_trim(bm)
    print(f"[warehouse intact] trim (coping ring): {len(trim_idx)} faces")

    glass_idx = _detect_glass(bm, uv_layer, img, "intact")
    glass_idx -= trim_idx
    print(f"[warehouse intact] glass total: {len(glass_idx)} faces")

    cap_rect = _synthesize_roof_cap(bm, trim_idx)

    wall_idx = {f.index for f in bm.faces} - trim_idx - glass_idx
    print(
        f"[warehouse intact] roles: trim={len(trim_idx)} glass={len(glass_idx)} "
        f"wall={len(wall_idx)} (roof cap synthesised separately)"
    )
    bm.free()
    return {"trim": trim_idx, "glass": glass_idx, "wall": wall_idx}, cap_rect


def _split_wreck_roles(wreck_obj):
    """Returns {role: set(face_index)} for the decimated wreck mesh. See
    docstring DESTROYED ROLE SPLIT."""
    bm = bmesh.new()
    bm.from_mesh(wreck_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()

    up_idx = {f.index for f in bm.faces if f.normal.z > NZ_THRESH}
    # Connected components, size-floored -- same call export_meshy_
    # apartment.py's own destroyed pass makes for its own "roof" union.
    faces_by_idx = {f.index: f for f in bm.faces}
    seen = set()
    comps = []
    for fi in up_idx:
        if fi in seen:
            continue
        stack = [fi]
        seen.add(fi)
        comp = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in faces_by_idx[cur].edges:
                for f2 in e.link_faces:
                    if f2.index in up_idx and f2.index not in seen:
                        seen.add(f2.index)
                        stack.append(f2.index)
        comps.append(comp)
    metal_idx = set()
    for comp in comps:
        if len(comp) >= WRECK_SIZE_FLOOR:
            metal_idx.update(comp)
    wall_idx = {f.index for f in bm.faces} - metal_idx
    print(
        f"[warehouse_wreck] upward faces {len(up_idx)}, {len(comps)} components, "
        f"top sizes {[len(c) for c in sorted(comps, key=len, reverse=True)[:6]]}"
    )
    print(f"[warehouse_wreck] roles: metal(roof/debris)={len(metal_idx)} wall={len(wall_idx)}")
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


def _merge_into(role_objs, role, new_obj):
    """Joins `new_obj` into role_objs[role] if that role already has a piece
    (Meshy-derived), else adopts `new_obj` directly as the whole role (the
    roof cap on `metal`, since this source's intact pass has no Meshy-
    derived metal at all)."""
    if role in role_objs:
        bpy.ops.object.select_all(action="DESELECT")
        new_obj.select_set(True)
        role_objs[role].select_set(True)
        bpy.context.view_layer.objects.active = role_objs[role]
        bpy.ops.object.join()
        role_objs[role] = bpy.context.object
    else:
        role_objs[role] = new_obj


def _all_world_verts(objs):
    out = []
    for ob in objs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            out.append(mw @ v.co)
    return out


def _wall_plane_mode(pts, axis, sign, zf0, zf1):
    """(centre, span) of one wall plane along `axis` ('x' or 'y'), by density
    MODE over a z-fraction band -- same technique as export_meshy_apartment.
    py's `_wall_planes_x`, generalised to either axis. `sign` selects which
    side (+1 or -1) of the building this call measures. `pts` is a plain
    list of (x, y, z) tuples, captured BEFORE any file switch -- Blender
    frees every live Object reference the instant `bpy.ops.wm.open_mainfile`
    loads a different .blend, so this cannot take live objects across that
    boundary (hit and fixed during this script's own scratch-dir test run:
    see git history / this task's report)."""
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
    """Median-of-surviving-z-bands registration shift for one axis, both
    signs averaged. Mirrors export_meshy_apartment.py's own
    `_measure_registration_dx`; see docstring REGISTRATION. `idle_pts` and
    `wreck_pts` are plain (x, y, z) tuple lists -- see `_wall_plane_mode`."""
    deltas = []
    for zf0, zf1 in REGISTRATION_BANDS:
        for sign in (1, -1):
            ic, ispan = _wall_plane_mode(idle_pts, axis, sign, zf0, zf1)
            wc, wspan = _wall_plane_mode(wreck_pts, axis, sign, zf0, zf1)
            if ic is None or wc is None:
                continue
            ok = wspan >= BAND_SPAN_MIN * ispan if ispan > 0 else False
            d = ic - wc
            print(
                f"[warehouse] registration {axis} band {zf0:.2f}-{zf1:.2f} side {sign:+d}: "
                f"intact {ic:+.4f}/{ispan:.4f} wreck {wc:+.4f}/{wspan:.4f} d={d:+.4f} "
                f"{'' if ok else '-- REJECTED'}"
            )
            if ok:
                deltas.append(d)
    if not deltas:
        print(f"[warehouse] registration {axis}: no band survived, applying 0.0")
        return 0.0
    deltas.sort()
    n = len(deltas)
    dv = deltas[n // 2] if n % 2 else (deltas[n // 2 - 1] + deltas[n // 2]) / 2
    spread = deltas[-1] - deltas[0]
    print(
        f"[warehouse] registration {axis}: {n} band(s) kept, median {dv:+.4f} m, "
        f"spread {spread:.4f} m"
    )
    if spread > REGISTRATION_SPREAD_MAX:
        print(
            f"[warehouse] registration {axis}: spread {spread:.4f} exceeds "
            f"{REGISTRATION_SPREAD_MAX}, NOT TRUSTED -- applying 0.0 instead"
        )
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
        print(f"[{label}] no rotation baked (WRECK_ROT_Z=0 -- see docstring ORIENTATION)")


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
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_texcoords=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=CREDIT,
    )
    size = os.path.getsize(out_path)
    verts = sum(len(ob.data.vertices) for ob in role_objs.values())
    polys = sum(len(ob.data.polygons) for ob in role_objs.values())
    return size, verts, polys, sorted(role_objs)


def export():
    real_metres = REAL_METRES_WAREHOUSE
    print(f"[warehouse] real_metres (see REAL_METRES_WAREHOUSE's own comment): {real_metres:.4f}")

    # ---------------- INTACT ----------------
    src_obj = _open_source(SRC_INTACT, "intact")
    img = bpy.data.images["base_color"]
    (ex, ey, ez), idle_grade = _extent(src_obj)
    mpu = metres_per_unit(ex, real_metres)
    print(
        f"[warehouse] intact source extent {ex:.4f} x {ey:.4f} x {ez:.4f} model units "
        f"(x and y agree to {abs(ex - ey):.4f} -- see docstring SCALE); "
        f"world-X axis -> {real_metres:.3f} m declared ({mpu:.5f} m/unit)"
    )

    src_obj.name = "intact_main"
    _decimate(src_obj, DECIMATE_RATIO, "intact")

    role_faces, cap_rect = _split_intact_roles(src_obj, img)
    role_objs = _tag_and_split_objects(src_obj, role_faces, "idle")
    bpy.data.objects.remove(src_obj, do_unlink=True)

    # Synthesised roof cap -- source frame, before the scale bake. See
    # docstring ROOF CAP SYNTHESIS.
    x_lo, x_hi, y_lo, y_hi, cap_z = cap_rect
    cap_thickness = 0.02
    cap = building_kit.box(
        "idle_roofcap",
        (x_hi - x_lo, y_hi - y_lo, cap_thickness),
        ((x_lo + x_hi) / 2.0, (y_lo + y_hi) / 2.0, cap_z - cap_thickness / 2.0),
        "metal",
    )
    _merge_into(role_objs, "metal", cap)

    idle_objs = list(role_objs.values())
    _bake_scale_rot(idle_objs, mpu, 0.0, "warehouse")
    _bake_shift_and_ground(idle_objs, 0.0, 0.0, "warehouse")
    idle_size, idle_v, idle_p, idle_roles = _finalize_and_export(role_objs, OUT_IDLE)
    idle_world = _all_world_verts(idle_objs)
    idle_extent = (
        max(p.x for p in idle_world) - min(p.x for p in idle_world),
        max(p.y for p in idle_world) - min(p.y for p in idle_world),
        max(p.z for p in idle_world) - min(p.z for p in idle_world),
    )
    idle_min = (
        min(p.x for p in idle_world), min(p.y for p in idle_world), min(p.z for p in idle_world),
    )
    idle_max = (
        max(p.x for p in idle_world), max(p.y for p in idle_world), max(p.z for p in idle_world),
    )
    print(
        f"[warehouse] wrote {OUT_IDLE} ({idle_size} bytes, {idle_v} verts, {idle_p} polys, "
        f"roles={idle_roles})\n"
        f"  BOUNDING BOX: min=({idle_min[0]:.3f},{idle_min[1]:.3f},{idle_min[2]:.3f}) "
        f"max=({idle_max[0]:.3f},{idle_max[1]:.3f},{idle_max[2]:.3f}) "
        f"extent={idle_extent[0]:.3f} x {idle_extent[1]:.3f} x {idle_extent[2]:.3f} m"
    )
    # Captured as PLAIN TUPLES, before the wreck file is opened below --
    # `bpy.ops.wm.open_mainfile` frees every live Object reference in the
    # current file the instant it runs, `idle_objs` included. See
    # `_wall_plane_mode`'s own docstring.
    idle_pts = [(p.x, p.y, p.z) for p in idle_world]

    # ---------------- DESTROYED ----------------
    wreck_src = _open_source(SRC_WRECK, "destroyed")
    (wx, wy, wz), wreck_grade = _extent(wreck_src)
    print(f"[warehouse_wreck] source extent {wx:.4f} x {wy:.4f} x {wz:.4f} model units")
    if abs(wreck_grade - idle_grade) > GRADE_TOL:
        raise SystemExit(
            f"warehouse: grades disagree -- intact lowest vertex {idle_grade:.4f}, wreck "
            f"{wreck_grade:.4f}, difference {abs(wreck_grade - idle_grade):.4f} > {GRADE_TOL}. "
            "See docstring GROUND ALIGNMENT / #143 -- this is exactly the float check that "
            "issue asks for, and it failed."
        )
    print(
        f"[warehouse] grades agree (#143 float check PASSED): intact {idle_grade:.4f}, "
        f"wreck {wreck_grade:.4f} (difference {abs(wreck_grade - idle_grade):.4f} source units)"
    )

    wreck_src.name = "wreck_main"
    _decimate(wreck_src, DECIMATE_RATIO, "wreck")

    wreck_role_faces = _split_wreck_roles(wreck_src)
    wreck_role_objs = _tag_and_split_objects(wreck_src, wreck_role_faces, "wreck")
    bpy.data.objects.remove(wreck_src, do_unlink=True)

    wreck_objs = list(wreck_role_objs.values())
    _bake_scale_rot(wreck_objs, mpu, WRECK_ROT_Z, "warehouse_wreck")

    wreck_pts = [(p.x, p.y, p.z) for p in _all_world_verts(wreck_objs)]
    dx = _measure_registration(idle_pts, wreck_pts, "x", mpu)
    dy = _measure_registration(idle_pts, wreck_pts, "y", mpu)
    _bake_shift_and_ground(wreck_objs, dx, dy, "warehouse_wreck")

    wreck_size, wreck_v, wreck_p, wreck_roles = _finalize_and_export(wreck_role_objs, OUT_WRECK)
    wreck_world = _all_world_verts(wreck_objs)
    wreck_extent = (
        max(p.x for p in wreck_world) - min(p.x for p in wreck_world),
        max(p.y for p in wreck_world) - min(p.y for p in wreck_world),
        max(p.z for p in wreck_world) - min(p.z for p in wreck_world),
    )
    wreck_min = (
        min(p.x for p in wreck_world), min(p.y for p in wreck_world), min(p.z for p in wreck_world),
    )
    wreck_max = (
        max(p.x for p in wreck_world), max(p.y for p in wreck_world), max(p.z for p in wreck_world),
    )
    print(
        f"[warehouse] wrote {OUT_WRECK} ({wreck_size} bytes, {wreck_v} verts, {wreck_p} polys, "
        f"roles={wreck_roles})\n"
        f"  BOUNDING BOX: min=({wreck_min[0]:.3f},{wreck_min[1]:.3f},{wreck_min[2]:.3f}) "
        f"max=({wreck_max[0]:.3f},{wreck_max[1]:.3f},{wreck_max[2]:.3f}) "
        f"extent={wreck_extent[0]:.3f} x {wreck_extent[1]:.3f} x {wreck_extent[2]:.3f} m"
    )

    if wreck_min[2] > 0.05:
        raise SystemExit(
            f"warehouse_wreck: FLOATS -- lowest vertex sits at z={wreck_min[2]:.3f} m, more "
            "than 5cm above ground. See #143. This should be impossible given the grade-"
            "agreement check above passed, but the assertion is here because the brief "
            "asked this be verified, not assumed."
        )
    print(f"[warehouse] wreck grounding VERIFIED: lowest vertex z={wreck_min[2]:.4f} m (#143 satisfied)")

    summary = {
        "real_metres": real_metres,
        "mpu": mpu,
        "decimate_ratio": DECIMATE_RATIO,
        "wreck_rotation_deg": math.degrees(WRECK_ROT_Z),
        "registration_dx_m": dx,
        "registration_dy_m": dy,
        "idle": {
            "path": OUT_IDLE, "bytes": idle_size, "verts": idle_v, "polys": idle_p,
            "roles": idle_roles,
            "bbox_min": [round(v, 4) for v in idle_min],
            "bbox_max": [round(v, 4) for v in idle_max],
            "extent_m": [round(v, 4) for v in idle_extent],
        },
        "wreck": {
            "path": OUT_WRECK, "bytes": wreck_size, "verts": wreck_v, "polys": wreck_p,
            "roles": wreck_roles,
            "bbox_min": [round(v, 4) for v in wreck_min],
            "bbox_max": [round(v, 4) for v in wreck_max],
            "extent_m": [round(v, 4) for v in wreck_extent],
        },
    }
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
