"""Export the Meshy-generated BM-21 Grad rocket truck as a glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/vehicles/export_meshy_rocket_battery.py

Writes `art/meshes/vehicles/rocket_battery.glb`.

The asset was supplied as "truck mortor". It is not a mortar: it is a
**BM-21 Grad on a 6x6 truck chassis**, and it maps to the existing enemy unit
`rocket_battery` (`data/units/enemy/rocket_battery.json` -- artillery, one
`grad_122` rocket at 20 tiles, speed 0.5, crew 4). Nothing about the mortar
label survives into this file.

SOURCES (two .blend files supplied; both inspected, both used -- see
2026-09-07 UPDATE below)

  art/blend/enemy/truck mortor/
      Meshy_AI_grad_rocket_truck_3d_0831111455_image-to-3d-texture.blend
          one welded object `mesh_node`, 982,804 verts, ONE material with
          packed textures. GEOMETRY SOURCE as of 2026-09-07.

  art/blend/enemy/truck mortor/
      Meshy_AI_grad_rocket_truck_par_0831111722_part-segmentation.blend
          twelve objects `model_part0`..`model_part11`, 983,597 verts in
          total, ZERO materials and ZERO images. Read-only census source as
          of 2026-09-07 -- see below.

Both AI-generated (Meshy), disclosed per CONTRIBUTING.md.

2026-09-07 UPDATE -- GEOMETRY SOURCE CHANGED. Project lead direction: a
supplied Meshy asset ships its own bake, "used as is unless ill provide
other instruction" (the rule already applied to the three textured
buildings, and to `mbt_lavi`/`ifv_namer`/`technical`/`paramotor` the same
day). The part-segmentation file above carries NO material and NO image --
there is nothing in it to ship -- so the geometry this export cuts from is
now the sibling `image-to-3d-texture` file. The part-segmentation file is
NOT discarded: it is opened FIRST, read-only, to CENSUS where each of its
twelve parts sits, exactly the technique
`tools/vehicles/export_meshy_apache.py` uses (see that file's own docstring,
"GEOMETRY SOURCE, 2026-09-07", for the affine-fit argument this shares
verbatim) -- and this file's OWN pre-2026-09-07 paragraph two above already
did half that work by hand: it measured the two files' aggregate bboxes
(1.901 x 0.677 x 1.013 vs 0.2252 x 0.08028 x 0.12000) and found them the
SAME model at one uniform per-axis scale, agreeing to three decimal places.
`_fit_affine` below re-derives that at runtme rather than hand-copying it,
for the same reason `export_meshy_apache.py` does.

TWELVE PARTS DOWN TO FOUR CUTS. The part-by-part census below (`PARTS`,
unchanged) still describes which SOURCE OBJECT carries which role -- that
fact did not change. What changed is that the new geometry has no
pre-existing seams to cut along, only positions to threshold, and a dozen
position-based cuts each need their own hole-fill; three of the twelve
parts are small enough (bulkhead, toolbox, rail -- 46,633 / 3,140 / 414 of
the model's ~983k verts, 5.1% combined) and geometrically ADJACENT enough to
a larger neighbour that a clean independent threshold for them was not
found, and ceding them to that neighbour was judged cheaper than a
false-boundary risk on a part invisible at gameplay zoom (`author_apache.py`
makes this identical call for the tank's own antenna vs turret body, and
`export_meshy_apache.py`'s gun/nose-fin box makes it for a metal detail
against its own hull). Concretely:

  - The bulkhead (`model_part3`, `plate`) sits AT the cab's own rear face
    (source-frame x=[-0.037,-0.024], against the cab's own x up to -0.025)
    -- ceded to `hull` by widening `CAB_X_MAX_PARTSEG` from the cab's own
    -0.025 to -0.020 to cover it, rather than split from a cab it is welded
    flush against in this reconstruction.
  - The toolbox (`model_part10`, `plate`) and the thin rail beside it
    (`model_part9`, `metal`, 414 verts -- "nothing to collapse" even in the
    ORIGINAL pipeline) sit inside the chassis's own z-range at the
    chassis's own x/y -- ceded to `plate` (the chassis/frame catch-all
    below), which is `model_part10`'s own role already and a two-mm rail's
    only visible neighbour.

That leaves four real cuts, in PEEL ORDER (each removes its own faces from
what earlier cuts left behind, so order matters where boxes are not fully
disjoint): WHEELS (`rubber`, a RADIAL distance test in the XZ/side-view
plane around each of three axle hub centres -- see
`WHEEL_HUB_X_PARTSEG`'s own comment for why a circle rather than a flat
x-band/z-ceiling box, which was tried first and measured catching 31% of
the model against six wheels' own real ~17% share, because this truck's
chassis rails run its full length at a low height and a flat Z ceiling
cannot exclude them the way a circle around a ROUND wheel can), RACK
(`metal`, x at or behind the chassis midpoint AND above the chassis's own
deck height), CAB (`hull`, x ahead of the chassis midpoint, widened to
absorb the bulkhead per above), and whatever remains is CHASSIS (`plate` --
frame, deck, toolbox, rail). This is exactly `ROLE_ORDER` (`hull, plate,
metal, rubber`) unchanged: four cuts, four final meshes, the same shape
this file shipped before 2026-09-07.

The two are the SAME model at two uniform scales, confirmed by axis ratios
rather than assumed: the textured file measures 1.901 x 0.677 x 1.013 and the
segmentation file 0.2252 x 0.08028 x 0.12000, giving X:Y:Z of
1 : 0.3561 : 0.5329 and 1 : 0.3565 : 0.5329 respectively -- agreeing to three
decimal places on both ratios -- and their vertex counts differ by 793 in
983k (0.08%). So the segmentation pass drops no geometry, and choosing it
costs nothing. It is strictly better for this pipeline: it needs no
geometric cut (unlike `export_meshy_tank.py`'s hull/turret face-cut with
hole fill, or `export_meshy_jeep.py`'s wheel cut), and it already satisfies
the contract's zero-materials rule at the source rather than by stripping.

ROLES. The palette for this vehicle was already decided --
`tools/render_rocket_battery.py`'s own `ROLE_PALETTE`, restated in
`tools/vehicles/preview_rocket_battery.py`'s `PAL`: hull dust.1 (chassis,
cab), plate dust.2 (bonnet, bed, cradle), metal gunmetal.2 (rack), rubber
shadow.0 (tyres), glass gunmetal.3 (windscreen). This script only decides
which SEGMENTED PART carries which of those roles, which it does from
measured geometry, not from the part numbering:

  model_part0  144,198v  x[-0.113,-0.025] z[0.011,0.084]   -> hull
      the forward mass: cab plus bonnet, the tallest thing ahead of the
      deck, sitting over the lone steering axle.
  model_part11 329,884v  x[-0.037,+0.112] z[0.011,0.065]   -> plate
      the full-length chassis frame and cargo/bed deck behind the cab.
  model_part6  295,920v  x[+0.023,+0.106] z[0.049,0.120]   -> metal
      the elevated rocket rack. Its z reaches the model's own maximum and
      its floor (0.0485) sits on top of model_part11 -- it is the tube pack,
      not a bed, which is where the prior inspection pass had it.
  model_part3   46,633v  x[-0.037,-0.024] y-span 0.064     -> plate
      a thin full-width bulkhead standing at the cab's rear face. Prior
      inspection called this the rocket rack; it is 13 mm deep and 64 mm
      wide and cannot be.
  model_part1/2/4/5/7/8  ~27,000v each                     -> rubber
      six tyres. Pair at x = -0.081 (front, steering); tandem bogie pairs at
      x = +0.035 and x = +0.0735. Six wheels in a 1 + 2 layout is the
      Ural-375D arrangement `author_rocket_battery.py` also builds, and is
      the cheapest silhouette cue this roster has (nothing else carries six).
  model_part10   3,140v  x[-0.006,+0.015] y[+0.026,+0.032] -> plate
      a small box bolted to one chassis rail (toolbox / battery box).
  model_part9      414v  same region, 2 mm thick in y      -> metal
      a thin rail beside it.

`model_part0` and `model_part11` each straddle two of the palette's own
descriptions -- the cab part contains the bonnet, the chassis part contains
the bed -- so neither can match the palette comment word for word. They are
split by VISIBLE SURFACE instead: what you see of the forward part is cab
body, what you see of the rear part is deck and side rails. That also keeps
the two dominant masses in the two DIFFERENT dust tones, which is the point
of the palette carrying two of them.

NO `glass`, and NO `recess`. Looked for, not skipped: the windscreen is
painted into this model's texture, not modelled. Binning every `model_part0`
polygon whose normal points forward (normal.x < -0.45, |normal.z| < 0.75)
found 0.006576 of forward-facing area spread over more than thirty separate
1 mm x-bands with no planar cluster anywhere above the bonnet line -- the
largest single band holds 12% of it and sits at the grille. There is no
windscreen patch to cut. `jeep_shoded` and `heli_peten` both already ship
with roles their source had no geometry for, and
`packages/render/src/three/units/vehicle-mesh-role.ts` holds each vehicle's
table COMPLETE regardless, so a later re-export that does model a windscreen
needs no renderer change.

NO TURRET PIVOT. `tools/render_rocket_battery.py` states the reason for the
sprite sheet and it holds identically here: "the rack is fixed to the bed,
not a separately traversing weapon station like the gun truck's cannon or
the technical's pintle gun, so `turret_meshes` stays empty". The sprite this
mesh stands in for is hull-only across all sixteen facings; giving the mesh a
traversing rack would make it behave unlike the art it replaces. A future
traversing rack wants an `rl_pivot` empty at the cradle, roughly
(-0.9, 0, 1.2) m in this file's final frame -- not authored here.

ORIENTATION. Established by measurement against already-shipped GLBs, in two
steps, because no single statistic transfers cleanly across vehicle classes
(the obvious "tallest mass leads" is wrong on three of the four shipped
vehicles -- a turret or a pintle gun outranks the cab).

  1. THE PIPELINE PRESERVES +X. Binned every vertex of the shipped
     `art/meshes/vehicles/dozer_d9.glb` into 14 bins along glTF X and took
     each bin's max height (glTF Y) and max across-vehicle half-span
     (|glTF Z|). The two +X-most bins (x = +2.73, +3.22 m) hold the model's
     widest half-span, 2.01 m against 1.76-1.84 m everywhere else, at low
     height (1.95 m then 0.92 m): a wide, low, thin-in-X mass at the +X end,
     which is a dozer blade and nothing else. `tools/vehicles/author_d9.py`
     builds that blade at x = +3.08..+3.56 with its `blade_link` at
     x = +2.25. The end the author script calls the front is the +X end of
     the shipped glTF, so Blender +X survives `export_yup=True` as glTF +X --
     which is what `packages/render/src/three/units/mesh-anim.ts`'s
     `meshYawFromFacing` requires ("The contract builds a mesh unit's rest
     pose facing LOCAL +X").

  2. WHICH END OF A TRUCK LEADS. Same 14-bin X profile on the shipped
     `art/meshes/vehicles/technical.glb`, restricted to its `hull` node so
     the pintle gun cannot confound it. Height falls monotonically across
     the four +X-most bins -- 1.58, 1.30, 1.10, 1.03, 0.99 m -- and stays
     flat at 1.35-1.36 m all the way to the -X end. A truck's nose tapers
     down over its bonnet; its tailgate is a vertical wall. On a shipped
     wheeled truck, therefore, +X is the cab end.

  3. APPLIED TO THIS SOURCE. Its six tyres sit at x = -0.081 (one axle,
     both sides) and x = +0.035 / +0.0735 (a tandem bogie, both sides). A
     6x6 truck steers on the lone axle, so the lone axle is the front; the
     cab mass (`model_part0`) sits over it, and the elevated rack
     (`model_part6`) sits over the bogie at the other end. The source's nose
     is therefore at -X, and a baked 180-degree Z rotation is needed -- the
     same correction `export_meshy_tank.py`, `export_meshy_truck.py`,
     `export_meshy_namer.py` and `export_meshy_jeep.py` each make in their
     own frames.

  4. CHECKED AFTER THE FACT, not assumed: `_assert_forward` below re-measures
     the final Blender scene and raises unless the `hull` (cab) centroid is
     ahead of the `metal` (rack) centroid on +X. Re-running step 2's profile
     on the written GLB reproduces the same taper at its +X end.

Incidentally, the rack fires over the TAIL in this model, which is correct
for a real BM-21 and is the opposite of `author_rocket_battery.py`, whose
rack elevates toward the nose. Nothing here corrects the authored sprite;
it is recorded so the difference is not read later as an export bug.

SCALE. `assets/sprites/ROCKETBATTERY_HULL/manifest.json`'s own `realMetres`,
5.688 m, read at runtime -- the same source `export_meshy_tank.py` and
`export_meshy_truck.py` read for their vehicles, and for the same reason:
the game already draws this unit at that size, and a mesh replacing a
billboard must not change how big the unit is. That figure is the sprite
pipeline's COMPRESSED size, not a BM-21's real 7.35 m
(`render_rocket_battery.py` declares `target_scale=2.15` rather than
`real_metres`, because the rack's elevation blows up the turning frame);
matching the sprite is the point, so the compressed figure is the right one.

DECIMATION. 983,597 source verts, ~16x the heaviest thing this pipeline
ships (`apc_eitan` at 61,887) and ~100x the lightest. Per-part COLLAPSE
ratios below, not one global ratio: six wheels carrying 163k verts between
them are round cylinders that survive heavy collapse, while the rack's tube
pack is the silhouette and gets more budget.

SPLIT NORMALS. Stripped, with the vertex-colour layer, before anything else
-- the same defect and the same fix `export_meshy_jeep.py` documents at
length for the other part-segmentation source in this tree. Every part here
reports `has_custom_normals=True` with 94-95% of its polygons flat-shaded,
and left alone the glTF exporter must split a vertex at nearly every loop.
"""
import json
import os
import sys
from collections import defaultdict

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper
import textured as vehicle_textured  # noqa: E402 -- 2026-09-07: ship the source's own base_color bake

REPO = os.path.dirname(TOOLS)
SRC_PARTSEG = os.path.join(
    REPO, "art", "blend", "enemy", "truck mortor",
    "Meshy_AI_grad_rocket_truck_par_0831111722_part-segmentation.blend",
)
#: The geometry that actually ships, as of 2026-09-07 -- see module
#: docstring's top update note.
SRC_TEXTURED = os.path.join(
    REPO, "art", "blend", "enemy", "truck mortor",
    "Meshy_AI_grad_rocket_truck_3d_0831111455_image-to-3d-texture.blend",
)
#: The .blend files are gitignored and live in the MAIN checkout, not in a
#: worktree. Fall back to it so this script runs from either.
SRC_FALLBACK_ROOTS = (REPO, "/Users/ilpinto/dev/roaring-lions")
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "rocket_battery.glb")
MANIFEST = os.path.join(REPO, "assets", "sprites", "ROCKETBATTERY_HULL", "manifest.json")

#: source object -> (rl_role, decimate ratio) -- the part-by-part census,
#: UNCHANGED since it still names which SOURCE REGION carries which role.
#: See the module docstring for how each part was identified (measured
#: extents, not the part numbering) and why each ratio is what it is. Three
#: entries (bulkhead/toolbox/rail) are read by the 2026-09-07 census below
#: but ceded to a larger neighbour rather than cut independently -- see
#: module docstring "TWELVE PARTS DOWN TO FOUR CUTS".
PARTS = {
    "model_part0":  ("hull",   0.035),   # cab + bonnet
    "model_part11": ("plate",  0.018),   # chassis frame + bed deck
    "model_part6":  ("metal",  0.020),   # rocket rack
    "model_part3":  ("plate",  0.040),   # bulkhead behind the cab -- ceded to hull, 2026-09-07
    "model_part1":  ("rubber", 0.022),   # front axle, left
    "model_part2":  ("rubber", 0.022),   # front axle, right
    "model_part4":  ("rubber", 0.022),   # bogie 1, right
    "model_part5":  ("rubber", 0.022),   # bogie 1, left
    "model_part7":  ("rubber", 0.022),   # bogie 2, right
    "model_part8":  ("rubber", 0.022),   # bogie 2, left
    "model_part10": ("plate",  0.300),   # chassis-rail box -- ceded to plate, 2026-09-07 (already its role)
    "model_part9":  ("metal",  1.000),   # thin rail -- ceded to plate, 2026-09-07 (see module docstring)
}

#: Order the joined role nodes are built in, so the export is byte-stable
#: across runs regardless of dict iteration.
ROLE_ORDER = ("hull", "plate", "metal", "rubber")

#: Final per-ROLE decimate ratio, 2026-09-07 -- one cut per role now (see
#: module docstring "TWELVE PARTS DOWN TO FOUR CUTS"), each reusing its
#: dominant original part's own ratio rather than inventing a new number:
#: `hull` reuses the cab's (now also covering the bulkhead it absorbed),
#: `plate` the chassis's (now also covering the toolbox/rail it absorbed),
#: `metal` the rack's, `rubber` the shared wheel ratio all six already had.
ROLE_DECIMATE_RATIO = {
    "hull": PARTS["model_part0"][1],
    "plate": PARTS["model_part11"][1],
    "metal": PARTS["model_part6"][1],
    "rubber": PARTS["model_part1"][1],
}

#: A small, explicit slop added to every transferred threshold for the
#: affine fit's own measured residual -- see
#: `export_meshy_apache.py`'s own `_TRANSFER_MARGIN` for the identical
#: reasoning. Model units, textured frame.
_TRANSFER_MARGIN = 0.02

#: Above this many boundary-loop edges, a "cap" is not a small fix -- see
#: `export_meshy_tank.py`'s own constant of the same name and purpose.
MAX_SANE_LOOP = 1200

TAG = "rocket_battery"


def _resolve(path):
    if os.path.exists(path):
        return path
    tail = os.path.relpath(path, REPO)
    for root in SRC_FALLBACK_ROOTS:
        alt = os.path.join(root, tail)
        if os.path.exists(alt):
            return alt
    raise SystemExit(f"source not found: {path} (also tried {SRC_FALLBACK_ROOTS})")


def _obj_bbox(ob):
    """This object's own world-space bbox -- see
    `export_meshy_apache.py`'s own `_obj_bbox` for the identical reasoning
    (every part-segmentation object here sits at the origin with an
    identity transform)."""
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    return ((min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs)))


def _union_bbox(boxes):
    xs = [b[0] for b in boxes]
    ys = [b[1] for b in boxes]
    zs = [b[2] for b in boxes]
    return (
        (min(x[0] for x in xs), max(x[1] for x in xs)),
        (min(y[0] for y in ys), max(y[1] for y in ys)),
        (min(z[0] for z in zs), max(z[1] for z in zs)),
    )


def _partseg_bboxes(path):
    """Opens the part-segmentation source and returns `{name: bbox}` for
    every object in `PARTS` -- READ ONLY, nothing from this file ships. See
    `export_meshy_apache.py`'s own function of this name."""
    bpy.ops.wm.open_mainfile(filepath=_resolve(path))
    present = {o.name for o in bpy.data.objects if o.type == "MESH"}
    if present != set(PARTS):
        raise SystemExit(
            f"{TAG}: part-segmentation source object set changed -- expected {sorted(PARTS)}, "
            f"found {sorted(present)}"
        )
    non_mesh = [o.name for o in bpy.data.objects if o.type != "MESH"]
    if non_mesh:
        raise SystemExit(f"{TAG}: unexpected non-mesh objects in part-segmentation source: {non_mesh}")
    boxes = {}
    for name in PARTS:
        ob = bpy.data.objects[name]
        if ob.modifiers:
            raise SystemExit(f"{name} carries {len(ob.modifiers)} modifier(s) in the part-segmentation census")
        boxes[name] = _obj_bbox(ob)
    return boxes


def _fit_affine(partseg_boxes, textured_box):
    """One GLOBAL (scale, per-axis offset) mapping the part-segmentation
    file's own model units into the textured file's own -- see
    `export_meshy_apache.py`'s own function of this name, and this file's
    own module docstring "2026-09-07 UPDATE" for the measurement (this
    file's pre-2026-09-07 docstring already found the same ratio by hand,
    to three decimal places)."""
    agg = _union_bbox(partseg_boxes.values())
    axis_scales = [
        (textured_box[ax][1] - textured_box[ax][0]) / (agg[ax][1] - agg[ax][0])
        for ax in range(3)
    ]
    scale = sum(axis_scales) / 3.0
    offsets = tuple(textured_box[ax][0] - scale * agg[ax][0] for ax in range(3))
    print(
        f"[{TAG}] partseg->textured affine: per-axis scale {[round(s,4) for s in axis_scales]}, "
        f"mean {scale:.4f}, offsets {tuple(round(o,4) for o in offsets)}"
    )
    return scale, offsets


def _transform_axis(v, axis, scale, offset):
    return v * scale + offset[axis]


# ---------------------------------------------------------------------
# The four cuts' own thresholds, in the PART-SEGMENTATION source's frame
# (model units, pre-affine) -- see module docstring "TWELVE PARTS DOWN TO
# FOUR CUTS" for how each was chosen from the per-part census. Transformed
# through `_fit_affine`'s own (scale, offset) at runtime, never hand-copied
# into the textured frame, so a future re-export of either source
# re-derives them rather than silently drifting from a stale constant.

#: Cab cut: `model_part0`'s own x_max is -0.0252; widened to -0.020 to also
#: absorb `model_part3` (the bulkhead, x up to -0.0238), which sits flush
#: against the cab's own rear face in this reconstruction with no clean
#: independent boundary -- see module docstring.
CAB_X_MAX_PARTSEG = -0.020

#: Rack cut: `model_part6`'s own x_min (0.0227) and z_min (0.0485), the
#: latter given a small MARGIN DOWN (0.045) rather than up, to keep the
#: rack's own support structure where it meets the chassis deck -- at the
#: cost of some risk the chassis's own raised deck/side rails in the same
#: x>=RACK_X_MIN region are pulled into `metal` instead of `plate`. Verified
#: acceptable by rendering the result (this task's own report); tightening
#: this margin is the first thing to try if a render shows otherwise.
RACK_X_MIN_PARTSEG = 0.020
RACK_Z_MIN_PARTSEG = 0.045

#: Wheel cut: a RADIAL distance test in the XZ (side-view) plane around each
#: of three axle hub centres, not a flat x-band/z-ceiling box. The box shape
#: was tried first and measured wrong by two orders of magnitude: this
#: truck's CHASSIS RAILS run the vehicle's full length at a low height, so
#: at every axle's own x-band the rail sits at a z the box's flat ceiling
#: could not exclude -- 608,561 of 1,967,685 faces (31%) claimed as "wheel"
#: against six wheels' own real share of the source (~163k verts, ~17%). A
#: wheel is round; a rail passing near a hub is not, so a CIRCLE around each
#: hub excludes the rail's own straight run outside a small neighbourhood of
#: the hub, where the box could not. Hub Z is the wheel's own radius above
#: the ground (z=0 in this source, where the wheels themselves sit): all six
#: wheels' own z-ranges span ~0.0000-0.0350 (source units), so radius
#: 0.0175, hub_z 0.0175. Hub X is each axle pair's own measured centre --
#: front (model_part1+2, centre -0.0804), bogie 1 (model_part4+5, centre
#: 0.0353), bogie 2 (model_part7+8, centre 0.0736). Margin (1.4x radius) is
#: generous rather than tight, verified against the render this task's own
#: report shows.
WHEEL_HUB_X_PARTSEG = (-0.0804, 0.0353, 0.0736)
WHEEL_HUB_Z_PARTSEG = 0.0175
WHEEL_RADIUS_PARTSEG = 0.0175
WHEEL_RADIUS_MARGIN_FACTOR = 1.1


def _delete_faces(ob, keep_fn, invert=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    to_delete = []
    for f in bm.faces:
        keep = keep_fn(f)
        if invert:
            keep = not keep
        if not keep:
            to_delete.append(f)
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _trace_boundary_loops(bm):
    """Identical to `export_meshy_tank.py`'s own helper of the same name."""
    boundary = set(e for e in bm.edges if len(e.link_faces) == 1)
    vadj = defaultdict(list)
    for e in boundary:
        v0, v1 = e.verts
        vadj[v0].append((v1, e))
        vadj[v1].append((v0, e))
    unvisited = set(boundary)
    loops = []
    while unvisited:
        e0 = next(iter(unvisited))
        unvisited.discard(e0)
        v0, v1 = e0.verts
        cur = v1
        loop_edges = [e0]
        closed = False
        while True:
            nxts = [(v, e) for (v, e) in vadj[cur] if e in unvisited]
            if not nxts:
                break
            v, e = nxts[0]
            unvisited.discard(e)
            loop_edges.append(e)
            cur = v
            if cur == v0:
                closed = True
                break
        loops.append((loop_edges, closed))
    return loops


def _fill_holes(ob, label):
    """Cap every closed boundary loop -- identical to `export_meshy_tank.py`'s
    own helper of the same name."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    loops = _trace_boundary_loops(bm)
    print(f"[{TAG}][{label}] {len(loops)} boundary loop(s), lengths={[len(e) for e, _ in loops]}")
    for loop_edges, closed in loops:
        if not closed or len(loop_edges) < 3:
            print(f"[{TAG}][{label}]   skip loop len={len(loop_edges)} closed={closed}")
            continue
        if len(loop_edges) > MAX_SANE_LOOP:
            raise SystemExit(
                f"[{TAG}][{label}] boundary loop of {len(loop_edges)} edges exceeds MAX_SANE_LOOP "
                f"({MAX_SANE_LOOP}) -- this is not a small cap fix, stop and re-examine the cut"
            )
        bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=loop_edges)
    remaining = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    ob.data.update()
    bm.free()
    if remaining:
        print(f"[{TAG}][{label}] WARNING: {remaining} boundary edge(s) remain open after fill")
    return remaining


def _make_wheel_face_test(hubs_xz, radius):
    """A face is `wheel` if its centre sits within `radius` of ANY hub, in
    the XZ (side-view) plane -- see `WHEEL_HUB_X_PARTSEG`'s own comment for
    why a circle, not a box."""
    def test(f):
        c = f.calc_center_median()
        for hub_x, hub_z in hubs_xz:
            if (c.x - hub_x) ** 2 + (c.z - hub_z) ** 2 <= radius * radius:
                return True
        return False
    return test


def _make_rack_face_test(x_min, z_min):
    def test(f):
        c = f.calc_center_median()
        return c.x >= x_min and c.z >= z_min
    return test


def _make_cab_face_test(x_max):
    def test(f):
        return f.calc_center_median().x <= x_max
    return test


def _read_real_metres():
    with open(MANIFEST) as fh:
        return json.load(fh)["realMetres"]


def _world_extent(objs):
    """Longest axis of the combined bounding box, in the objects' own units."""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for ob in objs:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return max(hi[i] - lo[i] for i in range(3)), lo, hi


def _strip_split_normals_and_colour(ob):
    """Clear this source's baked custom split normals and vertex-colour
    layer, and shade-smooth the result, BEFORE any decimate.

    Verbatim the treatment `export_meshy_jeep.py` applies to the other
    part-segmentation source in this tree, for the identical measured
    reason: every one of these twelve parts reports
    `has_custom_normals=True` with 94-95% of its polygons `use_smooth=False`,
    and the glTF exporter must then split a vertex wherever a per-loop
    normal (or vertex colour) differs from its neighbour's, which on
    flat-shaded geometry is nearly every loop. The `Color` layer goes for
    the same reason the contract forbids materials: colour is the palette's
    job at runtime."""
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.shade_smooth()


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    if ratio >= 1.0:
        print(f"[{TAG}] {label}: kept at {before_v} verts (no decimate)")
        return
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"[{TAG}] {label} decimate ratio={ratio}: {before_v} -> {len(ob.data.vertices)} verts, "
          f"{before_p} -> {len(ob.data.polygons)} polys")


def _join(objs, name):
    """Join `objs` into one object called `name`. Custom properties are set
    AFTER the join, never before -- `object.join` keeps the active object's
    own properties and silently drops the others', which is exactly the kind
    of thing that produces one correctly-roled node and three dropped ones."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name
    merged.data.name = name
    # Decimate leaves degenerate geometry behind on these parts, and joining
    # several of them stacks it up: without this, the glTF exporter printed
    # "Mesh hull_metal is not valid, and may be exported wrongly" (and the
    # same for hull_plate) and exported anyway. `validate` repairs it in
    # place and says whether it had to, so a future source that is CLEAN
    # does not quietly acquire a repair step nobody notices.
    if merged.data.validate(verbose=False):
        print(f"[{TAG}] {name}: mesh.validate() repaired invalid geometry")
    merged.data.update()
    return merged


def _centroid_x(ob):
    return sum(v.co.x for v in ob.data.vertices) / len(ob.data.vertices)


def _assert_forward(by_role):
    """Fail loudly unless the cab leads on +X.

    The whole orientation argument (module docstring, "ORIENTATION") rests on
    the cab being the forward mass and the rack the rear one. This re-measures
    that in the FINAL frame rather than trusting that the 180-degree rotation
    above went the way it was meant to -- a sign error there is invisible in
    every other check this script runs, and would ship a truck that drives
    backwards."""
    cab_x = _centroid_x(by_role["hull"])
    rack_x = _centroid_x(by_role["metal"])
    print(f"[{TAG}] forward check: cab(hull) centroid x={cab_x:+.4f} m, "
          f"rack(metal) centroid x={rack_x:+.4f} m")
    if not cab_x > 0.0 > rack_x:
        raise SystemExit(
            f"{TAG}: orientation wrong -- expected the cab ahead of origin and the rack "
            f"behind it on +X, got cab x={cab_x:+.4f}, rack x={rack_x:+.4f}"
        )


def export():
    for role, _ratio in PARTS.values():
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    # -- GEOMETRY SOURCE, 2026-09-07: census the part-segmentation file
    # FIRST (read-only, nothing from it ships), then open the textured file
    # that actually does. See module docstring's top update note and
    # `export_meshy_apache.py`'s own section of this name.
    partseg_boxes = _partseg_bboxes(SRC_PARTSEG)

    bpy.ops.wm.open_mainfile(filepath=_resolve(SRC_TEXTURED))
    src_obj = bpy.data.objects["mesh_node"]
    if src_obj.modifiers:
        raise SystemExit(f"mesh_node carries {len(src_obj.modifiers)} modifier(s) -- apply before cutting")
    textured_box = _obj_bbox(src_obj)
    scale, offset = _fit_affine(partseg_boxes, textured_box)

    cab_x_max = _transform_axis(CAB_X_MAX_PARTSEG, 0, scale, offset)
    rack_x_min = _transform_axis(RACK_X_MIN_PARTSEG, 0, scale, offset)
    rack_z_min = _transform_axis(RACK_Z_MIN_PARTSEG, 2, scale, offset)
    # The hub height and the radius are LENGTHS above the ground (source
    # z=0), which transforms to `offset[2]` -- transform_axis's own offset
    # term applies to a POSITION, not a length, so a length adds the scaled
    # value on top of the transformed ground instead.
    wheel_hub_z = offset[2] + WHEEL_HUB_Z_PARTSEG * scale
    wheel_hubs_xz = [
        (_transform_axis(hub_x, 0, scale, offset), wheel_hub_z) for hub_x in WHEEL_HUB_X_PARTSEG
    ]
    wheel_radius = WHEEL_RADIUS_PARTSEG * scale * WHEEL_RADIUS_MARGIN_FACTOR
    print(f"[{TAG}] cab_x_max={cab_x_max:.4f} rack_x_min={rack_x_min:.4f} rack_z_min={rack_z_min:.4f}")
    print(f"[{TAG}] wheel_hubs_xz={[tuple(round(v,4) for v in h) for h in wheel_hubs_xz]} "
          f"wheel_radius={wheel_radius:.4f}")

    # Real-world scale, measured on the FULL mesh before any cut or collapse.
    extent, lo, hi = _world_extent([src_obj])
    real_metres = _read_real_metres()
    mpu = metres_per_unit(extent, real_metres)
    print(f"[{TAG}] source bbox lo={[round(v, 5) for v in lo]} hi={[round(v, 5) for v in hi]}")
    print(f"[{TAG}] extent {extent:.5f} model units -> {real_metres:.3f} m declared "
          f"({mpu:.5f} m/unit, realMetres from {MANIFEST})")

    _strip_split_normals_and_colour(src_obj)
    print(f"[{TAG}] stripped custom split normals + vertex colour on mesh_node, shade-smoothed")

    # -- Wheel cut: rubber, one combined pass across all three axle pairs --
    # see module docstring "TWELVE PARTS DOWN TO FOUR CUTS".
    is_wheel_face = _make_wheel_face_test(wheel_hubs_xz, wheel_radius)
    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    wheel_obj = bpy.context.object
    wheel_obj.name = "wheel_cut"
    _delete_faces(wheel_obj, is_wheel_face, invert=False)
    _delete_faces(src_obj, is_wheel_face, invert=True)
    print(f"[{TAG}] pre-fill wheel faces={len(wheel_obj.data.polygons)} remaining={len(src_obj.data.polygons)}")
    _fill_holes(wheel_obj, "wheel")
    _fill_holes(src_obj, "whole-post-wheel-cut")

    # -- Rack cut: metal.
    is_rack_face = _make_rack_face_test(rack_x_min, rack_z_min)
    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    rack_obj = bpy.context.object
    rack_obj.name = "rack_cut"
    _delete_faces(rack_obj, is_rack_face, invert=False)
    _delete_faces(src_obj, is_rack_face, invert=True)
    print(f"[{TAG}] pre-fill rack faces={len(rack_obj.data.polygons)} remaining={len(src_obj.data.polygons)}")
    _fill_holes(rack_obj, "rack")
    _fill_holes(src_obj, "whole-post-rack-cut")

    # -- Cab cut: hull (absorbs the bulkhead, see module docstring).
    is_cab_face = _make_cab_face_test(cab_x_max)
    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    cab_obj = bpy.context.object
    cab_obj.name = "cab_cut"
    _delete_faces(cab_obj, is_cab_face, invert=False)
    _delete_faces(src_obj, is_cab_face, invert=True)
    print(f"[{TAG}] pre-fill cab faces={len(cab_obj.data.polygons)} remaining={len(src_obj.data.polygons)}")
    _fill_holes(cab_obj, "cab")
    _fill_holes(src_obj, "whole-post-cab-cut")

    # `src_obj` is now the chassis remainder: frame, deck, toolbox, rail --
    # `plate`, exactly `model_part11`'s own role (see module docstring).
    chassis_obj = src_obj
    print(f"[{TAG}] chassis (plate) remainder: {len(chassis_obj.data.polygons)} faces")

    role_objs = {"hull": cab_obj, "plate": chassis_obj, "metal": rack_obj, "rubber": wheel_obj}

    # Decimate each final piece at its OWN role's ratio (`ROLE_DECIMATE_RATIO`)
    # -- AFTER the cuts, not before: the thresholds above were derived
    # against the RAW part-segmentation census, and cutting on the
    # full-resolution mesh keeps that census valid.
    total_before = sum(len(role_objs[r].data.vertices) for r in ROLE_ORDER)
    for role in ROLE_ORDER:
        _decimate(role_objs[role], ROLE_DECIMATE_RATIO[role], f"hull_{role}")
    total_after = sum(len(role_objs[r].data.vertices) for r in ROLE_ORDER)
    print(f"[{TAG}] decimation total: {total_before} -> {total_after} verts")

    # Contract naming and role tagging: {part}_{role}. `_join` on a
    # single-object list still renames, validates and repairs -- reused
    # unchanged from the pre-2026-09-07 pipeline for that reason, even
    # though nothing here has more than one object to join any more.
    by_role = {}
    for role in ROLE_ORDER:
        merged = _join([role_objs[role]], f"hull_{role}")
        # 2026-09-07: materials KEPT, not cleared -- see
        # `export_meshy_tank.py`'s identical comment and
        # `tools/vehicles/textured.py`. All four pieces are duplicates of
        # the one source `mesh_node` and still reference the same material.
        for k in list(merged.keys()):
            if k != "_RNA_UI":
                del merged[k]
        merged["rl_role"] = role
        merged["rl_part"] = "hull"
        by_role[role] = merged
        print(f"[{TAG}] hull_{role}: {len(merged.data.vertices)} verts, {len(merged.data.polygons)} polys")

    parts = [by_role[r] for r in ROLE_ORDER if r in by_role]

    # Bake model-units -> metres into vertex data; object scale stays 1.
    _bake_scale(parts, mpu)

    # Reorient: this source's nose is at -X (module docstring, "ORIENTATION"),
    # so bake a 180-degree Z rotation. After the scale bake, before ground
    # alignment -- the same bake point every other Meshy exporter here uses.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    # Ground alignment, from the ACTUAL combined minimum. This source already
    # sits on z=0 (unlike every image-to-3d Meshy source in this tree, which
    # centres on its own vertical midpoint), so the shift is expected to be
    # ~0 -- computed rather than assumed, so a future re-export of a
    # differently-normalised source is not silently left floating.
    shift_z = -min(min(v.co.z for v in ob.data.vertices) for ob in parts)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.location.z = shift_z
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[{TAG}] ground shift {shift_z:+.6f} m (lowest vertex -> z=0)")

    _assert_forward(by_role)

    lo = [min(min((ob.matrix_world @ v.co)[i] for v in ob.data.vertices) for ob in parts) for i in range(3)]
    hi = [max(max((ob.matrix_world @ v.co)[i] for v in ob.data.vertices) for ob in parts) for i in range(3)]
    print(f"[{TAG}] final bbox (Blender, Z-up) lo={[round(v, 4) for v in lo]} "
          f"hi={[round(v, 4) for v in hi]} extent={[round(hi[i] - lo[i], 4) for i in range(3)]}")

    # 2026-09-07: ships the source's own base_color bake -- see
    # `export_meshy_tank.py`'s identical block and `tools/vehicles/textured.py`.
    kept, dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{TAG}] shipping {name!r} at {after[0]}x{after[1]} (was {before[0]}x{before[1]}), JPEG q{vehicle_textured.JPEG_QUALITY}")
    for name, size in dropped:
        print(f"[{TAG}] dropped {name!r} ({size[0]}x{size[1]})")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        **vehicle_textured.gltf_kwargs(
            OUT_PATH,
            "BM-21 Grad rocket truck -- AI-generated (Meshy), image-to-3d-texture export, "
            "disclosed per CONTRIBUTING.md; the geometry is one welded mesh, cut into "
            "hull_hull/hull_plate/hull_metal/hull_rubber for this repository using regions "
            "located from the sibling part-segmentation export (see this file's own "
            "docstring, 'GEOMETRY SOURCE, 2026-09-07'). Stands in for the "
            "ROCKETBATTERY_HULL billboard authored from primitives by "
            "tools/vehicles/author_rocket_battery.py (CC BY-SA 4.0), which is not "
            "retired by this script. Ships the source's own base_color bake (project "
            "lead direction, 2026-09-07)."
        )
    )
    size = os.path.getsize(OUT_PATH)
    print(f"[{TAG}] wrote {OUT_PATH} ({size} bytes) meshes: "
          + ", ".join(f"{ob.name}={len(ob.data.vertices)}v" for ob in parts))
    return OUT_PATH


if __name__ == "__main__":
    export()
