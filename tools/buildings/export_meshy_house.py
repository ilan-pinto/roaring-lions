"""Export the Meshy-generated Levantine house as the `house` building pair,
mesh contract v2's BUILDINGS section.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_house.py

Writes `art/meshes/buildings/house.glb` (standing) and
`art/meshes/buildings/house_wreck.glb` (destroyed), REPLACING the kit-built
pair `tools/buildings/author_house.py`/`export_mesh_building.py` currently
ship. Not a new type: `packages/render/src/three/units/building-mesh-role.ts`
already carries a `house` entry (`limestone.3` wall colour, resolved at
runtime from `data/structures.json`, not by this script).

SOURCES (both AI-generated, Meshy, image-to-3D-texture mode -- disclosed per
CONTRIBUTING.md; see this task's report for the full licensing note):

    art/blend/enemy/enemy building 1/Meshy_AI_levantine_house_intac_0830152052_image-to-3d-texture.blend
    art/blend/enemy/enemy building 1/Meshy_AI_levantine_house_destr_0830152122_image-to-3d-texture.blend

Each is a single mesh object `mesh_node`, one material, baked 4096/2048
textures (discarded -- zero materials ship, per contract). Intact: 975,406
verts / 1,950,940 polys. Destroyed: 917,021 verts / 1,840,842 polys.

WHY THIS IS ITS OWN SCRIPT rather than a new `BuildingMeshSpec` entry in
`export_mesh_building.py`. That module's `_join_by_role` groups by an
`rl_role` a KIT AUTHOR already set per object -- every kit part is a
separate Blender object carrying its own role from construction
(`tools/buildings/kit.py`: "Every part declares `rl_role`"). This source has
none of that: it is ONE welded mesh with no per-part name or role to key on,
the same situation `tools/vehicles/export_meshy_tank.py` and
`export_meshy_namer.py` solved for vehicles -- geometric role assignment
(face selection by position/connectivity), not name matching. And unlike
those two, THIS asset ships as a genuine sibling PAIR: the destroyed state is
not derived (`render_building.py`'s `collapse()`/`_dice`/`_punch`, which this
script does NOT use) but a SEPARATELY Meshy-generated collapse of the same
building, processed by (almost) the same pipeline as the intact state so the
two align spatially when the runtime swaps between them.

CONNECTIVITY, checked first exactly like the tank/Namer. Intact: a
weld-then-flood-fill census (thresholds 1e-6/1e-4, agreeing) found TWO
components -- a dominant 1,926,058-face shell and a 24,882-face piece that
isolating and rendering alone identified as the satellite dish + its
mounting pole (see this task's report). Destroyed: ONE component -- collapse
welds the dish into the general rubble, so it cannot be isolated the same
way.

ROLE SPLIT -- geometric, not name-based, per building. Both passes start
from `tools/buildings/kit.py`'s ROLES (`wall, roof, trim, dome, wood, glass,
metal, rust`); neither uses all eight, because not all eight have a
geometric signal on this asset (see the report -- ship fewer honest roles
rather than inventing boundaries, the same judgement call already on record
for `technical.glb`).

  INTACT (measured on the DECIMATED main shell, source frame, before scale/
  rotate/ground-shift -- see DECIMATION below for why):

  - `roof`: the LARGEST connected component among upward-facing
    (normal.z > NZ_THRESH) faces -- the flat roof deck + parapet cap. Clean
    connectivity signal: at this asset's decimation level it is 353 faces,
    roughly 3x its nearest rival, and reads in isolation as exactly the
    building's own flat roof top (see the report's flat-shaded visualisation).
  - `trim`: every OTHER upward-facing component whose own XY bounding box
    spans more than WIDE_SPAN of the building's footprint -- a horizontal
    ledge running most of a facade's width is architecturally a coping or a
    floor string-course, not a fixture, matching `kit.py`'s own
    `trim_band()` (used by `author_house.py` for exactly this shape:
    "Coping" and "Band_1"). Two such ledges were found, at two different
    storey heights, matching the two-floor elevation seen in the source's
    own renders.
  - `metal`: the satellite dish (separate component, tagged whole) plus
    every remaining upward-facing component that is NOT wide (a tank top, a
    stair tread, a landing, a rebar tip...), grown by a small bounded local
    BFS (radius GROW_RADIUS, GROW_ROUNDS rounds, over a vertex KDTree) so a
    tread's own riser and a tank's own cylindrical wall come along with its
    flat top -- connectivity first, one measured spatial parameter second,
    the same "BARREL_BAND"-style combination export_meshy_tank.py already
    established. A window SILL is geometrically identical to a tank top at
    this resolution (small, flat, upward-facing) and an early pass without a
    position filter grew window recesses into `metal` blobs on the front
    facade (see the report). What separates a genuine fixture from a sill:
    every confirmed fixture in this asset sits either above the two-storey
    window band (z > METAL_Z_MIN, rooftop clutter) or hugging the external
    stair's own +X edge (x > METAL_X_MIN, measured against this asset's own
    seed list -- every stair-tread seed found sits in that range). A tight
    seed at window-band height, away from that edge, reverts to `wall`
    rather than being forced into either bucket.
  - `glass` (GH #142, added after the rest of this split -- see GLASS below):
    three of the four window openings plus the ground-floor door, out of
    `wall`'s own window/door recesses. NOT depth -- a recess-along-the-wall-
    normal signal was tried first and re-conflates with the sill problem
    directly above (a window recess and a sill are both "a shallow dip in an
    otherwise flat wall" at this decimation), which is why the original pass
    shipped none. Colour SATURATION is a different signal in a different
    domain and does not have that collision.
  - `wall`: everything else -- the base masonry, the fourth window opening
    (see GLASS -- entangled with a tank-support strut, not shipped), the
    lower single-storey wing. Coloured from this building's own
    `wallColorKey` at runtime (`data/structures.json` `house.color` =
    `limestone.3`), unchanged by this script.

GLASS (GH #142 -- "house.glb ships no glass role"; added in a later pass over
the same source, after the rest of the split above already shipped). The
signal this asset carries is colour SATURATION, not luminance
(`export_meshy_warehouse.py`'s own signal for its own Meshy source) and not
depth (tried and rejected for `wall` above, in the original pass): a real
textured render of this source's own -Y facade (Workbench TEXTURE, the same
instrument that settled FORWARD REORIENTATION below) shows the three closed
window shutters at roughly a FIFTH of the surrounding limestone wall's own
saturation (~0.016-0.020 sampled on the shutters against ~0.06-0.13 on wall/
trim/door-opening in that render) while sitting close to the wall's own
LUMINANCE (shutter ~0.46-0.68, wall ~0.49-0.68 -- badly overlapping, which is
why a luminance threshold in warehouse's own style found almost nothing here:
at warehouse's own 0.32 cut, only ~1% of this asset's `wall` faces qualified
and the largest connected cluster was 28 faces, nowhere near a real window).
`_detect_glass` samples SATURATION (max channel minus min) at each `wall`
face's own UV centroid against the DECIMATED mesh's `base_color` bake (the
same per-face-UV sampling `_sample_uv_luminance` uses in warehouse, just a
different statistic), takes mesh-topology connected components among faces
below SAT_GLASS_THRESH (bmesh edge adjacency -- this asset's own
`_flood_components`, not warehouse's position grid: house is not a simple
box the way warehouse is -- a two-storey main block, a single-storey wing
and an external stair mean there is no single global per-side "slab" to grid
against, and normal-direction bucketing was tried and tested WORSE, pooling
faces from spatially distant, differently-offset walls into one grid whose
window signal drowned in wall-sized cells: 0 glass candidates found -- see
the report), then grows every seed at or above GLASS_MIN_FACES into its own
surrounding `wall` faces with the SAME bounded KDTree BFS `metal` already
uses (`_grow_metal_seeds`, now taking an optional `allowed_idx` so growth
can never cross into a face `roof`/`trim`/`metal` already claimed) -- so a
window ships with its visible frame, not just the darkest-saturation core.

Four openings clear GLASS_MIN_FACES cleanly and were confirmed by a coloured
role render from all 4 cardinal directions (glass painted red against the
other roles' own tones, the same "render the role alone, check it by eye"
verification `export_meshy_apartment.py`'s own docstring used for its stair
corner): the three -Y (front) window shutters and the -Y door -- eight seed
components total (536-577 faces per shutter-pair, 202 for the door), every
one landing exactly on its own opening with no bleed into the surrounding
wall in any of the four views. A FIFTH opening -- a shuttered window on the
+Y (back) facade, matching this script's own earlier note of "a boarded
window" on one of the three non-front sides -- was found by the same signal
(a 166-face seed, cleanly square in isolation) but is NOT shipped: at every
growth radius and padding tried, it also pulls in a sliver of the water
tank's OWN support strut sitting close above it, because that strut reads
just as low-saturation as the window itself (grey structural metal, not
glass) and the two are close enough in the mesh that no radius/padding
choice separated "capture this window's frame" from "capture the strut too"
without either failing to bleed or getting too aggressive elsewhere.
GLASS_MIN_FACES=200 is the line that keeps that one out while keeping every
other confirmed opening (whose own seeds run 202-577 faces, well clear) --
raising it further would not lose anything else, and 91 is the largest
surviving noise seed excluded at that floor. Shipping the back window would
mean either inventing a boundary the geometry does not cleanly support, or
also (wrongly) recolouring a piece of the tank's own strut as `glass` --
this script does neither, and ships four openings honestly rather than five
with one visibly wrong.

DESTROYED PASS: NO `glass`, checked and rejected rather than assumed. The
same saturation detector run against the wreck's own decimated `wall` faces
finds nothing to grow: collapse damage and dust roughen this source's own
saturation into a tight, uniformly LOW band (p10 0.075 against the intact
source's own p10 of 0.020 -- the wreck is more uniform, not less, because
dust flattens the colour variation a shutter would stand out against) and
the largest connected low-saturation component is 43 faces against
GLASS_MIN_FACES's 200. The same call `export_meshy_apartment.py`'s and
`export_meshy_warehouse.py`'s own destroyed passes already made for glass,
for the same reason -- collapse does not preserve this signal.

  DESTROYED (measured on the DECIMATED wreck mesh directly -- no main-
  component isolation needed, see CONNECTIVITY above):

  - `roof`: the UNION of every upward-facing component at or above a small
    noise floor (SIZE_FLOOR faces) -- post-collapse there is no single
    dominant flat plane the way the intact roof deck was one (top three
    upward components come out within 2x of each other, not the intact
    model's ~3x-clear winner), so treating every non-trivial debris-facet
    patch as one `roof` (rubble/debris) tag is the honest read, not a
    fabricated per-chunk distinction.
  - `wall`: everything else -- standing wall remnants (with their windows
    still recognisable), the water tank and satellite dish (still
    shape-recognisable but no longer cleanly colour-separable from the
    rubble around them -- see the report), ground-level debris. No `trim`,
    no `metal`: the floor bands and any tank/dish material distinction do
    not survive collapse as a separable geometric signal, so this pass ships
    two roles where the intact pass ships four.

DECIMATION. ~1.9-2.0M polys each is two to three orders of magnitude past
this pipeline's shipped building sizes and would trace boundary loops (this
asset has none to trace -- no hull/turret style cut, only a role split that
keeps every face) at a scale nothing here needs. Both sources are decimated
ONCE (COLLAPSE, DECIMATE_RATIO, ~the same order of magnitude as
`export_meshy_namer.py`'s own ~992k-verts-to-~19k pass) BEFORE any role
analysis, and every threshold above is measured against the ALREADY-
DECIMATED mesh's own histograms/components, not the raw source's -- the
Namer script's own rule, for the same reason. Confirmed by inspection, not
assumed: this source is ~100% smooth-shaded with no vertex-colour layer (the
`export_meshy_jeep.py` "flat-shaded, unshared-vertex explosion" trap does
not apply here -- that was a `part-segmentation`-mode defect, and this
source, like the tank's and Namer's, is `image-to-3d-texture` mode), so no
`_strip_split_normals_and_colour`-equivalent step runs.

SCALE, per this task's own instruction: "Derive the scale from how the
existing `house.glb` relates to its footprint -- do not guess it." There is
no `realMetres` manifest field for a building the way `TNK_HULL_MANIFEST`
supplies one for a vehicle, so `REAL_METRES_HOUSE` was DERIVED by measuring
the pre-replacement, kit-built `house.glb` directly (imported fresh,
evaluated extent -- `_measure_existing_extent`, kept in this file for
provenance and re-verification but not called by `export()`) rather than
hand-typed -- `dimetric.metres_per_unit`'s own "real_metres is the unit's
longest dimension on any axis" convention, applied identically to how every
Meshy vehicle export here already reads its own ground truth rather than
retyping it. It is then FROZEN as a constant rather than re-measured on
every run, because this script overwrites that same path -- see
`REAL_METRES_HOUSE`'s own comment for the self-reference this avoids. The
measured value (12.7900, confirmed against `render_building.py`'s own
comment that the kit house is "four columns" wide on the map, i.e. this IS
the footprint width, not an arbitrary axis) sets `real_metres`;
`extent_model` is the intact source's own
longest axis-aligned extent (the whole `mesh_node`, matching
`export_meshy_tank.py`'s `_extent_of` convention of measuring the object
being exported, not a sub-piece). The SAME resulting `mpu` is applied to
BOTH files -- the wreck's own extent is a collapsed, not a ground-truth,
measurement, so recalibrating from it independently would let the two
states drift out of scale with each other, defeating the "same building,
collapsed" pairing the whole task turns on. Axis bookkeeping, since the
building forward-reorientation below rotates which source axis becomes
which world axis: `real_metres` measured off the OLD house's own WIDTH
(column direction) is compared against the NEW house's own extent along
whichever source axis becomes world-X (the sim's column/width direction)
AFTER the 90-degree bake below -- see the report for the full derivation and
the two other candidate figures (matching depth-to-depth, and matching
footprint AREA) it was cross-checked against, all within about 14% of each
other and all mutually consistent with the source NOT being unusually
distorted relative to the old kit house's own proportions.

FORWARD REORIENTATION. The door is the measurable signal, per this task's
instruction. Six axis-aligned textured stills (the source's own baked
material, Workbench TEXTURE colour mode -- see the report) found the ground-
floor door and three of the house's windows on the source's -Y face, with
nothing but a blank service side, a boarded window and the external stair on
the other three; -Y is therefore the front. Baked as a 90-degree +Z
rotation, mapping source -Y to the contract's +X-forward, applied AFTER the
role split (every threshold above is measured in the source frame) and
BEFORE the ground shift below -- the identical ordering
`export_meshy_tank.py` uses and for the identical reason.

GROUND ALIGNMENT. Like every Meshy `image-to-3d-texture` source in this
pipeline, the model's own origin sits near its vertical midpoint, not at
grade (`export_meshy_tank.py`'s own "not at ground level the way every
kit-built vehicle... is authored"). Each file is shifted up by its OWN
lowest vertex (after scale + rotation), independently -- not a shared shift
-- so each file's own world origin lands at z=0, the contract's "the
model's own world origin at z ~ 0" anchor convention, on both the standing
and the collapsed geometry separately. No X/Y shift: both sources' own
origins already sit within about 0.02 units (about 13cm at this scale) of
their own footprint's XY centre (see the report), well inside the
`GROUND_TOLERANCE`-style slack `export_mesh_building.py`'s own footprint-
anchor check allows, so -- exactly like every kit-built building already
shipped through that script -- the source's own origin is trusted as the
anchor rather than recomputed from a bounding box, which is deliberate: an
overhang or an asymmetric collapse should be able to drag the bbox off the
anchor without the anchor chasing it.
"""
import json
import os
import sys
from collections import defaultdict

import bpy
import bmesh
import numpy as np
from mathutils import kdtree

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as building_kit  # noqa: E402 -- tools/buildings/kit.py, ROLES
import textured  # noqa: E402 -- tools/buildings/textured.py, the shipped-material path

REPO = os.path.dirname(TOOLS)
# `art/blend/` is gitignored (blanket rule, too large for git) and therefore
# does not exist inside a worktree checkout at all -- these sources live
# only in the main repo's own local, untracked working directory, the exact
# absolute path this task was given. NOT derived from REPO for that reason.
# Corrected during GH #142's glass-role pass: this constant had drifted to
# ".../art/blend/enemy building 1" (missing the "enemy/" segment), a stale
# path from before the source tree was reorganised into one "enemy/" parent
# alongside apartment's and warehouse's own siblings -- confirmed against
# the actual tree (`ls art/blend/enemy/`) rather than assumed, and the
# script would not run at all against the old value.
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/enemy/enemy building 1"
SRC_INTACT = os.path.join(SRC_DIR, "Meshy_AI_levantine_house_intac_0830152052_image-to-3d-texture.blend")
SRC_DESTR = os.path.join(SRC_DIR, "Meshy_AI_levantine_house_destr_0830152122_image-to-3d-texture.blend")

#: The file THIS script replaces. Measured ONCE (`_measure_existing_extent`,
#: run against the pre-replacement kit-built house.glb) rather than hand-
#: typed, per this task's own instruction not to guess the scale -- but
#: frozen here as a constant rather than re-measured on every run, because
#: this script OVERWRITES that same path: a second run after the first
#: successful replacement would otherwise measure ITS OWN prior output
#: instead of the kit-built ground truth, silently drifting the scale a
#: little further from that ground truth on every re-run. 12.7900 (the
#: kit-built house's own longest axis-aligned extent, its X/width -- see
#: module docstring "SCALE") is the number every run of this script has
#: measured against and should keep measuring against.
REAL_METRES_HOUSE = 12.7900

#: Output directory -- overridable via `-- --out-dir <path>` so a
#: verification pass can write to a scratch location without touching the
#: shipped pair until confirmed drawing (this task's own constraint: "Do NOT
#: delete the existing house.glb/house_wreck.glb until the replacement is
#: confirmed drawing").
_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
OUT_IDLE = os.path.join(OUT_DIR, "house.glb")
OUT_WRECK = os.path.join(OUT_DIR, "house_wreck.glb")

#: Decimate ratio, both sources -- ~the same order of magnitude as
#: export_meshy_namer.py's own 992k-verts-to-~19k/~40k pass. See module
#: docstring "DECIMATION".
DECIMATE_RATIO = 0.02

#: Upward-facing threshold (normal.z), used to seed both the `roof`/`trim`/
#: `metal` split (intact) and the `roof` union (destroyed). See docstring.
NZ_THRESH = 0.7

#: An upward-facing component whose own XY bbox spans more than this
#: fraction... no -- this is an absolute span in model units (source frame,
#: ~1.9 units end to end), not a fraction: WIDE_SPAN=0.8 is ~42% of the
#: building's own longest axis. See docstring "ROLE SPLIT / INTACT / trim".
WIDE_SPAN = 0.8

#: Tight-seed position filter for `metal` vs reverting to `wall` -- source
#: frame, pre-rotation. See docstring "ROLE SPLIT / INTACT / metal".
METAL_Z_MIN = 0.30
METAL_X_MIN = 0.55

#: Local growth for a `metal` seed -- source frame. See docstring.
GROW_RADIUS = 0.025
GROW_ROUNDS = 2

#: Destroyed-pass `roof` union floor -- filters single-triangle noise, keeps
#: every real debris facet. See docstring "ROLE SPLIT / DESTROYED".
WRECK_SIZE_FLOOR = 15

#: `glass` detection (GH #142), intact pass only -- source frame, against the
#: DECIMATED main shell's own `base_color` bake. See docstring "GLASS".
#: A face's colour SATURATION (max channel minus min), not luminance: the
#: shutters read close to the wall's own brightness but at roughly a fifth
#: of its saturation (measured ~0.016-0.02 on the shutters against a
#: ~0.06-0.13 wall/trim range on a real textured render of this asset's own
#: front facade) -- see the report for the sampled RGB triples.
SAT_GLASS_THRESH = 0.03
#: A seed component below this many faces is noise (a dirt fleck, a stray
#: dark grout line) at DECIMATE_RATIO's density -- every confirmed window
#: pane and the door seed clear 200; the largest noise seed found was 91 (a
#: sliver of the water tank's own support strut, entangled with a real
#: window seed above this floor -- see docstring GLASS for why that one
#: window is NOT shipped).
GLASS_MIN_FACES = 200
#: Local growth for a `glass` seed, restricted to the `wall` idx set -- same
#: mechanism and same defaults as `_grow_metal_seeds`'s own fixture growth,
#: reused here (see `allowed_idx`) so a window ships with its visible frame/
#: casing, not just the darkest-saturation core.
GLASS_GROW_RADIUS = 0.025
GLASS_GROW_ROUNDS = 2

CREDIT = (
    "Levantine house (standing + destroyed) -- AI-generated (Meshy), disclosed "
    "per CONTRIBUTING.md; role-split and re-scaled for Roaring Lions"
)


def _measure_existing_extent(glb_path):
    """Fresh-imports a house.glb into an empty scene and measures its own
    longest axis-aligned extent -- how `REAL_METRES_HOUSE` above was
    produced (against the pre-replacement, kit-built house.glb) and how it
    can be re-verified from a git-history checkout of that same file
    (`git show <rev-before-this-change>:art/meshes/buildings/house.glb`).
    NOT called by `export()` -- see `REAL_METRES_HOUSE`'s own comment for
    why re-measuring from the live path on every run is wrong once this
    script has already overwritten it once. Leaves the scene empty
    afterward so a caller can open a Meshy source next."""
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
    extent = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return extent


def _flood_components(bm, idx_subset=None):
    """Connected components over `bm.faces`, restricted to `idx_subset` if
    given (shared-edge adjacency, restricted to the subset on both ends) --
    the one census routine every Meshy export in this pipeline re-derives;
    kept local rather than imported so this file's own thresholds stay
    checkable against its own source, per export_mesh_building.py's own
    stated reasoning for not sharing helpers across asset classes."""
    faces_by_idx = {f.index: f for f in bm.faces}
    pool = set(idx_subset) if idx_subset is not None else set(faces_by_idx)
    seen = set()
    comps = []
    for fi in pool:
        if fi in seen:
            continue
        stack = [fi]
        comp = []
        seen.add(fi)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            f = faces_by_idx[cur]
            for e in f.edges:
                for f2 in e.link_faces:
                    if f2.index in pool and f2.index not in seen:
                        seen.add(f2.index)
                        stack.append(f2.index)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps, faces_by_idx


def _delete_faces(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    to_delete = [f for f in bm.faces if f.index not in keep_idx]
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(f"[house] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, {before_p} -> {after_p} polys")


def _centroid_bbox(faces_by_idx, idx_list):
    xs, ys, zs = [], [], []
    for i in idx_list:
        c = faces_by_idx[i].calc_center_median()
        xs.append(c.x); ys.append(c.y); zs.append(c.z)
    return (
        (sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs)),
        (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)),
    )


def _grow_metal_seeds(bm, faces_by_idx, seed_comps, radius, rounds, allowed_idx=None):
    """Local BFS from each seed component's own vertices, over a KDTree of
    every mesh vertex -- see module docstring "ROLE SPLIT / INTACT / metal".
    `allowed_idx`, if given, restricts every grown face to that set -- used
    by `_detect_glass` (GH #142) to grow a window/door seed into its own
    surrounding `wall` faces without ever reaching into a face another role
    already claimed; left `None` (unrestricted) for the original `metal`
    caller, which runs before roof/trim/wall are finalised and has nothing
    to restrict against yet."""
    all_verts = list(bm.verts)
    kd = kdtree.KDTree(len(all_verts))
    for i, v in enumerate(all_verts):
        kd.insert(v.co, i)
    kd.balance()

    vert_to_faces = defaultdict(set)
    for f in bm.faces:
        for v in f.verts:
            vert_to_faces[v.index].add(f.index)

    grown_total = set()
    for comp in seed_comps:
        grown_verts = set()
        for fi in comp:
            for v in faces_by_idx[fi].verts:
                grown_verts.add(v.index)
        frontier_pts = [all_verts[i].co for i in grown_verts]
        grown_faces = set(comp) if allowed_idx is None else {fi for fi in comp if fi in allowed_idx}
        for _round in range(rounds):
            new_verts = set()
            for p in frontier_pts:
                for (co, idx, dist) in kd.find_range(p, radius):
                    new_verts.add(idx)
            newly_added = False
            for vi in new_verts:
                for fi in vert_to_faces[vi]:
                    if allowed_idx is not None and fi not in allowed_idx:
                        continue
                    if fi not in grown_faces:
                        grown_faces.add(fi)
                        newly_added = True
            if not newly_added:
                break
            frontier_pts = [all_verts[i].co for i in new_verts if i not in grown_verts]
            grown_verts |= new_verts
        grown_total |= grown_faces
    return grown_total


def _detect_glass(bm, uv_layer, img, wall_idx, faces_by_idx):
    """Returns a set of face indices to tag `glass`, out of `wall_idx` --
    see module docstring "GLASS". Per-face colour SATURATION (max channel
    minus min), sampled from `base_color` at each face's own UV centroid --
    NOT luminance (`export_meshy_warehouse.py`'s own signal): this asset's
    shutters read close to the wall's own brightness and are told apart by
    being far LESS saturated, not darker. Seed components come from mesh-
    topology adjacency among below-threshold `wall` faces (not a position
    grid -- house is not a simple box the way warehouse is, so there is no
    single global per-side slab to grid against); surviving seeds (>=
    GLASS_MIN_FACES) are grown into their own surrounding `wall` faces by
    the same bounded KDTree BFS `metal` uses, restricted to `wall_idx` so
    growth can never cross into a face another role already claimed."""
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    face_sat = {}
    for fi in wall_idx:
        f = faces_by_idx[fi]
        us = [l[uv_layer].uv.x for l in f.loops]
        vs = [l[uv_layer].uv.y for l in f.loops]
        u = sum(us) / len(us)
        v = sum(vs) / len(vs)
        x = int(min(max(u, 0.0), 0.999999) * w)
        y = int(min(max(v, 0.0), 0.999999) * h)
        col = arr[y, x]
        r, g, b = float(col[0]), float(col[1]), float(col[2])
        face_sat[fi] = max(r, g, b) - min(r, g, b)

    low_idx = {fi for fi in wall_idx if face_sat[fi] < SAT_GLASS_THRESH}
    comps, _ = _flood_components(bm, low_idx)
    print(f"[house] glass seed components (sat<{SAT_GLASS_THRESH}): {len(comps)}, "
          f"top sizes {[len(c) for c in comps[:12]]}")

    seed_comps = [c for c in comps if len(c) >= GLASS_MIN_FACES]
    glass_idx = _grow_metal_seeds(
        bm, faces_by_idx, seed_comps, GLASS_GROW_RADIUS, GLASS_GROW_ROUNDS, allowed_idx=wall_idx
    )
    print(f"[house] glass: kept {len(seed_comps)} of {len(comps)} seed components, "
          f"{len(glass_idx)} faces after growth")
    return glass_idx


def _split_intact_roles(main_obj):
    """Returns {role: set(face_index)} for the intact main shell (dish
    handled separately by the caller). See module docstring "ROLE SPLIT /
    INTACT"."""
    bm = bmesh.new()
    bm.from_mesh(main_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    faces_by_idx = {f.index: f for f in bm.faces}

    up_idx = [f.index for f in bm.faces if f.normal.z > NZ_THRESH]
    up_comps, _ = _flood_components(bm, up_idx)
    print(f"[house] intact upward-subset components: {len(up_comps)}, top sizes {[len(c) for c in up_comps[:10]]}")

    roof_idx = set(up_comps[0])
    trim_idx = set()
    metal_seed_comps = []
    for comp in up_comps[1:]:
        centroid, bbox = _centroid_bbox(faces_by_idx, comp)
        dx, dy = bbox[1] - bbox[0], bbox[3] - bbox[2]
        if dx > WIDE_SPAN or dy > WIDE_SPAN:
            trim_idx.update(comp)
            continue
        if centroid[2] > METAL_Z_MIN or centroid[0] > METAL_X_MIN:
            metal_seed_comps.append(comp)
        # else: mid-wall, window-band height -- reverts to wall (see docstring).

    metal_idx = _grow_metal_seeds(bm, faces_by_idx, metal_seed_comps, GROW_RADIUS, GROW_ROUNDS)
    metal_idx -= roof_idx | trim_idx
    trim_idx -= roof_idx
    wall_idx = set(faces_by_idx) - roof_idx - trim_idx - metal_idx

    uv_layer = bm.loops.layers.uv.active
    if uv_layer is None:
        raise SystemExit("house intact: decimated mesh has no UV layer -- glass detection (GH #142) needs one")
    img = bpy.data.images["base_color"]
    glass_idx = _detect_glass(bm, uv_layer, img, wall_idx, faces_by_idx)
    wall_idx -= glass_idx

    print(
        f"[house] intact roles: roof={len(roof_idx)} trim={len(trim_idx)} metal={len(metal_idx)} "
        f"glass={len(glass_idx)} wall={len(wall_idx)}"
    )
    bm.free()
    return {"roof": roof_idx, "trim": trim_idx, "metal": metal_idx, "glass": glass_idx, "wall": wall_idx}


def _split_wreck_roles(wreck_obj):
    """Returns {role: set(face_index)} for the decimated wreck mesh. See
    module docstring "ROLE SPLIT / DESTROYED"."""
    bm = bmesh.new()
    bm.from_mesh(wreck_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    faces_by_idx = {f.index: f for f in bm.faces}

    up_idx = [f.index for f in bm.faces if f.normal.z > NZ_THRESH]
    up_comps, _ = _flood_components(bm, up_idx)
    print(f"[house_wreck] upward-subset components: {len(up_comps)}, top sizes {[len(c) for c in up_comps[:10]]}")

    roof_idx = set()
    for comp in up_comps:
        if len(comp) >= WRECK_SIZE_FLOOR:
            roof_idx.update(comp)
    wall_idx = set(faces_by_idx) - roof_idx
    print(f"[house_wreck] roles: roof={len(roof_idx)} wall={len(wall_idx)}")
    bm.free()
    return {"roof": roof_idx, "wall": wall_idx}


def _tag_and_split_objects(src_obj, role_faces, prefix):
    """Duplicates `src_obj` once per non-empty role, deletes every face not
    in that role, and tags the result -- returns {role: object}."""
    result = {}
    for role, idx in role_faces.items():
        if not idx:
            continue
        if role not in building_kit.ROLES:
            raise SystemExit(f"{prefix}: role {role!r} outside tools/buildings/kit.py's ROLES {building_kit.ROLES}")
        bpy.ops.object.select_all(action="DESELECT")
        src_obj.select_set(True)
        bpy.context.view_layer.objects.active = src_obj
        bpy.ops.object.duplicate()
        piece = bpy.context.object
        piece.name = f"{prefix}_{role}"
        _delete_faces(piece, idx)
        result[role] = piece
    return result


def _bake_scale_rotate_ground(objs, mpu):
    """Bake model-units -> metres (uniform scale), then a 90-degree +Z
    rotation (source -Y front -> contract +X forward), then a ground shift
    so this GROUP's own lowest vertex lands at z=0 -- in that order, for the
    reasons the module docstring's "SCALE" / "FORWARD REORIENTATION" /
    "GROUND ALIGNMENT" sections give. `objs` is one file's worth of pieces
    (idle or wreck), shifted together so they stay coincident with each
    other -- but NOT across files, since idle and wreck are shifted by their
    OWN respective lowest points independently (see docstring)."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.scale = (mpu, mpu, mpu)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 1.5707963267948966)  # +90 degrees
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    zmin = min(min(v.co.z for v in ob.data.vertices) for ob in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.location.z = -zmin
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[house] ground shift +{-zmin:.4f} (source units) -> lowest vertex at z=0")


def _finalize_and_export(role_objs, out_path):
    """Sets rl_role, keeps the source's own baked material, exports one GLB.
    Returns (bytes, total_verts, total_polys, roles).

    The material is KEPT rather than cleared -- see `tools/buildings/
    textured.py`'s own module docstring for the project lead's override of
    the contract's "a GLB carries zero materials" rule, the measured texture
    size table, and why `metallic_roughness`/`normal` are dropped while
    `base_color` ships."""
    for role, ob in role_objs.items():
        ob.name = role
        ob.data.name = role
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role

    textured.split_textured_roles(role_objs, "house")
    tex_px = textured.prepare_textured_images()
    print(f"[house] shipping base_color at {tex_px[0]}x{tex_px[1]}, JPEG q{textured.JPEG_QUALITY}")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**textured.gltf_kwargs(out_path, CREDIT))
    size = os.path.getsize(out_path)
    verts = sum(len(ob.data.vertices) for ob in role_objs.values())
    polys = sum(len(ob.data.polygons) for ob in role_objs.values())
    return size, verts, polys, sorted(role_objs)


def export():
    real_metres = REAL_METRES_HOUSE
    print(f"[house] real_metres (frozen, see REAL_METRES_HOUSE's own comment): {real_metres:.4f}")

    # ---------------- INTACT ----------------
    bpy.ops.wm.open_mainfile(filepath=SRC_INTACT)
    src_obj = bpy.data.objects["mesh_node"]
    if src_obj.modifiers:
        raise SystemExit(f"house intact: mesh_node carries {len(src_obj.modifiers)} modifier(s)")

    dg = bpy.context.evaluated_depsgraph_get()
    eo = src_obj.evaluated_get(dg)
    m = eo.to_mesh()
    xs = [(eo.matrix_world @ v.co).x for v in m.vertices]
    ys = [(eo.matrix_world @ v.co).y for v in m.vertices]
    zs = [(eo.matrix_world @ v.co).z for v in m.vertices]
    eo.to_mesh_clear()
    extent_model = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    mpu = metres_per_unit(extent_model, real_metres)
    print(f"[house] intact extent {extent_model:.4f} model units -> {real_metres:.3f} m declared ({mpu:.5f} m/unit)")

    bm0 = bmesh.new()
    bm0.from_mesh(src_obj.data)
    bm0.faces.ensure_lookup_table()
    whole_comps, _ = _flood_components(bm0)
    bm0.free()
    print(f"[house] intact whole-mesh components: {[len(c) for c in whole_comps[:5]]}")
    if len(whole_comps) < 2:
        raise SystemExit("house intact: expected >=2 whole-mesh components (main shell + dish); found fewer")
    main_face_idx = set(whole_comps[0])
    dish_face_idx = set()
    for c in whole_comps[1:]:
        dish_face_idx.update(c)

    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    main_obj = bpy.context.object
    main_obj.name = "intact_main"
    _delete_faces(main_obj, main_face_idx)

    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    dish_obj = bpy.context.object
    dish_obj.name = "intact_dish"
    _delete_faces(dish_obj, dish_face_idx)

    # Remove the original -- not just hide it. `export_scene.gltf` with
    # `use_selection=False` exports every OBJECT in the scene regardless of
    # hide state, so a hidden-but-present 975k-vert original was silently
    # riding along into the export as an extra "mesh" node (57.7 MB for a
    # nominal 21k-vert result, caught on the first export attempt -- see
    # this task's report).
    bpy.data.objects.remove(src_obj, do_unlink=True)

    _decimate(main_obj, DECIMATE_RATIO, "main")
    _decimate(dish_obj, DECIMATE_RATIO, "dish")

    role_faces = _split_intact_roles(main_obj)
    role_objs = _tag_and_split_objects(main_obj, role_faces, "idle")
    bpy.data.objects.remove(main_obj, do_unlink=True)
    # Dish -> metal wholesale (connectivity already isolated it; see docstring).
    dish_obj.name = "idle_dish_metal"
    if "metal" in role_objs:
        bpy.ops.object.select_all(action="DESELECT")
        role_objs["metal"].select_set(True)
        dish_obj.select_set(True)
        bpy.context.view_layer.objects.active = role_objs["metal"]
        bpy.ops.object.join()
        role_objs["metal"] = bpy.context.view_layer.objects.active
    else:
        role_objs["metal"] = dish_obj

    _bake_scale_rotate_ground(list(role_objs.values()), mpu)
    idle_size, idle_v, idle_p, idle_roles = _finalize_and_export(role_objs, OUT_IDLE)
    print(f"[house] wrote {OUT_IDLE} ({idle_size} bytes, {idle_v} verts, {idle_p} polys, roles={idle_roles})")

    # ---------------- DESTROYED ----------------
    bpy.ops.wm.open_mainfile(filepath=SRC_DESTR)
    wreck_src = bpy.data.objects["mesh_node"]
    if wreck_src.modifiers:
        raise SystemExit(f"house destroyed: mesh_node carries {len(wreck_src.modifiers)} modifier(s)")
    wreck_src.name = "wreck_main"

    _decimate(wreck_src, DECIMATE_RATIO, "wreck")
    wreck_role_faces = _split_wreck_roles(wreck_src)
    wreck_role_objs = _tag_and_split_objects(wreck_src, wreck_role_faces, "wreck")
    bpy.data.objects.remove(wreck_src, do_unlink=True)

    _bake_scale_rotate_ground(list(wreck_role_objs.values()), mpu)
    wreck_size, wreck_v, wreck_p, wreck_roles = _finalize_and_export(wreck_role_objs, OUT_WRECK)
    print(f"[house] wrote {OUT_WRECK} ({wreck_size} bytes, {wreck_v} verts, {wreck_p} polys, roles={wreck_roles})")

    summary = {
        "real_metres": real_metres,
        "mpu": mpu,
        "idle": {"path": OUT_IDLE, "bytes": idle_size, "verts": idle_v, "polys": idle_p, "roles": idle_roles},
        "wreck": {"path": OUT_WRECK, "bytes": wreck_size, "verts": wreck_v, "polys": wreck_p, "roles": wreck_roles},
    }
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
