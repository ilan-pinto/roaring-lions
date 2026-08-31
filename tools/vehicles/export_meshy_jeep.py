"""Export the Meshy-generated Shoded Jeep as a hull-only glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_jeep.py

Writes `art/meshes/vehicles/jeep_shoded.glb`.

SOURCE: art/blend/KDF/Shodeed jeep/Meshy_AI_military_vehicle_spli_0830115629_part-segmentation.blend
-- AI-generated (Meshy), **part-segmentation** export, disclosed per
CONTRIBUTING.md. Unlike every other Meshy source this pipeline has cut
(`export_meshy_tank.py`, `export_meshy_truck.py`, `export_meshy_namer.py`, all
`image-to-3d-texture` single welded shells), Meshy has ALREADY split this one:
three mesh objects, zero materials, no modifiers.

  model_part0  942,257 verts / 1,885,899 polys -- the whole body: hull, floor,
               frame AND all six wheels, still one connected component (a
               "separate loose parts" check on the raw mesh returns exactly
               ONE piece -- Meshy's part-segmentation split the WEAPON and the
               STOWAGE BOX off as their own objects, but never split the
               wheels from the hull they're welded to). This is the risk this
               task's brief called out by name, and is decimated before
               anything else touches it -- see DECIMATION below.
  model_part1  29,646 verts / 59,329 polys -- a complete pintle-mounted heavy
               machine gun: mount box, cradle, barrel. Verified by an isolated
               colour-coded render (see the report), not assumed from vertex
               count alone.
  model_part2   7,227 verts / 14,454 polys -- a small wedge-shaped box bolted
               to the driver's door, at real-world size ~0.46 m (see SCALE
               below) -- read as a jerry can / stowage box, verified the same
               way.

**This contradicts the sprite pipeline's own claim.** `tools/render_jeep.py`'s
docstring says the jeep "carries no separately modelled weapon station -- no
turret, no gun, no pintle mount". This supplied model has one, fully modelled
(model_part1). See "NO TURRET PIVOT" below for why that finding does not
change this export's shape.

DECIMATION, same reasoning as `export_meshy_namer.py` and
`export_meshy_truck.py` for an oversized single welded shell: Blender's
Decimate modifier (COLLAPSE), applied ONCE to model_part0 before any cut,
ratio measured against this specific mesh. `model_part1` and `model_part2`
are each their own standalone object (never merged with the hull), so each
gets its own whole-object decimate at its own ratio -- no cut, no boundary-
loop fill needed for either, unlike the tank/truck/Namer's turret geometry,
which was always a SUBSET carved out of a bigger decimated shell.

  model_part0  ratio 0.02  942,257 -> 18,158 verts, 1,885,899 -> 37,716 polys
               (matches export_meshy_namer.py's own ratio and landed vertex
               count almost exactly -- 18,431 there, 18,158 here -- for a
               source of the same order of magnitude).
  model_part1  ratio 0.05   29,646 ->  1,463 verts,    59,329 ->  2,966 polys
               (comparable to the Namer's own cut-and-decimated turret_metal,
               1,828 faces -- a standalone weapon prop needs no more).
  model_part2  ratio 0.08    7,227 ->    578 verts,    14,454 ->  1,156 polys
               (a simple wedge box; decimates cleanly at this ratio -- see the
               report for the before/after silhouette renders that confirmed
               this, at both ratios, before committing to them).

CONNECTIVITY. `model_part0` alone, checked with Blender's own
`mesh.separate(type='LOOSE')` (an exact, built-in connected-component split --
faster and no less rigorous than this pipeline's usual weld-then-flood-fill
census, and used here for that reason): exactly ONE piece, 942,257 of 942,257
verts. No free split for the wheels. `model_part1` and `model_part2` are
already their own objects by construction (Meshy's part-segmentation did that
work) -- nothing to check there.

THE CUT: HULL vs RUBBER (wheels), inside `model_part0`, on the DECIMATED
mesh. This source is WHEELED, not tracked, so the y-histogram-at-low-z signal
`export_meshy_namer.py` used for a tracked vehicle's open belly does not
apply directly -- a wheeled hull's flanks (door sills, fender flares) sit at
the SAME high-|y| band as the wheels themselves, all the way up past the
wheel's own radius, so a plain |y|-threshold cannot separate "wheel" from
"body panel at wheel height" the way it could for a track. What DOES
separate them is that a wheel's own vertices exist ONLY inside its own
narrow X-band (one per axle), while flank/sill body panels run the full
length of the hull. A per-facing-region scan (see the report for the full
table) found six-wheel geometry sitting inside exactly two X-clusters -- the
front axle and a close-set rear tandem pair that the |y|,z-restricted vertex
count never fully separates from each other (a small dip, not a full gap,
between them; both wheels are kept together in one `X_REAR` band because the
role classification does not care how many wheels sit inside it, only that
non-wheel geometry is excluded):

  X_REAR  = (-0.125, -0.030)   -- rear tandem pair, both wheels
  X_FRONT = ( 0.038,  0.125)   -- front axle

Combined with `Y_WHEEL_MIN = 0.045` (a vertex must sit at least this far from
centreline -- the wheel's own outer face) and `Z_WHEEL_CUT = 0.065` (below
this height -- above it the classification is picking up fender-flare
greebles rather than tyre, confirmed by a render sweep at Y_WHEEL_MIN 0.045
vs 0.050: raising the threshold to 0.050 did NOT remove the flare
contamination but DID punch a hole through the wheel's own recessed hub cap,
so 0.045 is the kept value). This cut is NOT perfectly clean -- a small
fender-flare wedge at each wheel arch's forward/rear edge falls inside the
X-band and gets classified `rubber` rather than `hull` (visible in the
report's crop renders) -- the same class of imprecision
`export_meshy_namer.py`'s own turret cut accepted at its own edges, ceded
rather than chased further given how little of the silhouette it touches at
gameplay zoom.

NO TURRET PIVOT. The pintle MG (`model_part1`) is real, modelled geometry --
see above -- but this export does NOT give it a `turret_pivot` node. Three
reasons, all pointing the same way: `jeep_shoded.json`'s own `pintle_mg`
weapon carries no separate traverse data (no turret bearing anywhere in the
unit's sim data); `render_jeep.py`'s own docstring already commits to "the
unit's pintle_mg fires from the hull" as this vehicle's design, which this
export should not silently overrule; and the mesh contract's own vehicle
shape ("at most two rigid bodies: a hull, and A turret") makes omitting the
pivot the same hull-only branch `dozer_d9.glb` already exercises (six
`hull_*` meshes, no `rl_pivot` node at all) -- not a new case, a repeat of an
existing one. So `model_part1` becomes `hull_metal`: fixed geometry, still
correctly shaded as gunmetal hardware via its OWN role, just not an
articulating part. Flagged here and in this task's report for whoever next
touches this unit's turn/traverse behaviour -- the geometry to build a real
pivot onto is already sitting in the export if that design changes.

ROLES. Two roles the sprite pipeline never needed: `model_part1` -> `metal`
(mount, cradle and barrel, matching `tools/vehicles/kit.py`'s own `rws()`
convention -- a weapon station's mount AND barrel are both `metal`) and
`model_part2` -> `plate` (a bolted-on box, closer to kit.py's own "bolt-on
armour and hatches" description than to a `metal` barrel/rail/mount).
`model_part0` splits into `hull` (body) and `rubber` (wheels) as above.
`glass` and `recess` are not present in this source -- no windscreen glazing
was found (a canvas soft-top, not a windscreen, sits over the cab) and no
comparable shadowed-gap signal to the tank/Namer's hull remainder was looked
for, matching their own reports' same conclusion for the same reason (one
continuous welded body panel with no isolated small block or open gap to cut
along). `vehicle-mesh-role.ts` still declares a COMPLETE six-role
`jeep_shoded` table regardless (see that file's own top comment for why: a
partial table turns a future role into a boot-time crash, not a load-time
gap).

ORIENTATION. **Corrected 2026-08-30 -- the reading below the line replaces a
wrong one that shipped first.** The original version of this script applied
no rotation, on the strength of a colour-coded x-sign render that seemed to
show a hood and grille sitting at +X. That render answered the wrong
question: it identifies which half of the mesh sits at positive X, not which
half is the front. A colour-coded still frame cannot tell a bonnet from a
cargo bed on a source this low-poly, and it didn't. The project lead caught
it live ("jeep front is reversed") after this shipped and drove backwards in
game.

The corrected method: DRIVE IT, and read the result off something a still
render cannot fake. A `renderer.worldToScreen`-projected "direction of
travel" arrow, checked first, gave a run of CONTRADICTORY readings across
several attempts on the very same exported file -- not because the maths was
wrong (`root.rotation.y`, the vertex data, and `worldToScreen`'s own output
were each independently re-verified and were all self-consistent every
time), but because a hand-picked reference point on the mesh is exactly the
same "which end looks right" guess the whole exercise was meant to replace,
just moved one layer down. What actually settled it, with no guessing left
in the loop: order the unit onto a long straight move, let the sim's own
`drawTrail` decal lay itself down behind the vehicle as it travels (a real
gameplay feature, not a debug aid, and unambiguous -- the decal marks where
the unit HAS BEEN, full stop), and read which end of the model sits over the
fresh trail versus which end sits at the untouched leading edge. Two builds
were compared directly, back to back, in one script, each re-verified by its
OWN network response `content-length` and by a live vertex-count fingerprint
of `hull_rubber` (3337 verts on the tandem-wheel cluster, 3674 on the single-
wheel cluster -- stable across independent exports, and read fresh from the
live THREE.js geometry each time, not assumed from an earlier run) --
removing any possibility of comparing a screenshot against a stale or
mis-swapped file. Result: with NO rotation applied (the original, wrong
build the project lead actually saw), the TANDEM-wheel end (a wide two-wheel
cluster plus the wedge stowage box, this source's own -X half) is the end
that LEADS -- it drives away from the trail it lays down, front-first,
cargo-bed-forward -- while the single-wheel end with the pintle MG mount and
canvas roof sits over the trail, trailing behind, which is exactly the
"reversed" the project lead reported. With the 180-degree Z rotation below
applied, that inverts: the single-wheel/cab end now leads (clear of the
trail, at the advancing edge) and the tandem-wheel end trails (sitting over
the fresh trail behind it). **The single-wheel, MG-and-canvas-roof end is
the front.** This also matches the project lead's own independent check ("a
jeep's windscreen/cab sits FORWARD of its load bed") -- the cab now sits
forward of the tandem-wheel cargo bed, which it did not before this fix.

Baked as a final 180-degree Z rotation on the already-cut, already-scaled
geometry, exactly where the tank, truck and Namer scripts apply theirs --
meaning it is now four Meshy sources in this pipeline that needed this flip,
not three, and the pattern is worth stating as a fact about the pipeline
rather than re-deriving per asset: **a Meshy export's own "which half sits
at +X" is not evidence of which half is the front, and neither is a single
projected reference point -- both are still guesses about which end looks
right.** A real, in-game motion cue with no interpretation left in it (a
trail decal, not a hand-picked vertex) is the check that cannot be fooled,
and is the one to reach for first on the next asset, not last.

GROUND. `model_part0`'s own lowest vertex sits at z=6.2e-5 model units --
already ground-aligned, unlike every other Meshy source in this pipeline
(each of which had its origin at the vehicle's vertical midpoint and needed
shifting). The export still computes and applies the shift from the actual
combined minimum across all three parts rather than assuming zero, so a
future re-export of a differently-aligned source needs no code change here.

SCALE. `real_metres = 4.8` read from the shipped `JEEP_HULL/manifest.json`
(this unit's own declared length, from `render_jeep.py`'s own SPEC -- never
hand-typed). Model extent (pooled across all three parts, longest axis) is
the X span of `model_part0` alone, ~0.2511 model units -> mpu ~19.11 m/unit.
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

from export_mesh_vehicle import _bake_scale, _extent  # noqa: E402 -- shared helpers

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(
    REPO, "art", "blend", "jeep",
    "Meshy_AI_military_vehicle_spli_0830115629_part-segmentation.blend",
)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "jeep_shoded.glb")

#: jeep_shoded's own declared real-world size -- read from the sprite sheet it
#: currently ships with (JEEP_HULL), never hand-typed. See module docstring
#: "SCALE".
JEEP_HULL_MANIFEST = os.path.join(REPO, "assets", "sprites", "JEEP_HULL", "manifest.json")

#: Decimate ratios, each measured against its own part -- see module
#: docstring "DECIMATION".
DECIMATE_RATIO_HULL = 0.02
DECIMATE_RATIO_MG = 0.05
DECIMATE_RATIO_BOX = 0.08

#: Wheel cut (source frame, on the DECIMATED model_part0) -- see module
#: docstring "THE CUT" for the derivation and the render sweep that picked
#: these specific values.
X_REAR = (-0.125, -0.030)
X_FRONT = (0.038, 0.125)
Y_WHEEL_MIN = 0.045
Z_WHEEL_CUT = 0.065

#: Same purpose and same value as export_meshy_namer.py's own constant of
#: this name -- see that script's doc comment. The decimated hull here
#: (18,158 verts) is the same order of magnitude as the Namer's (18,431), so
#: its own measured ceiling applies unchanged.
MAX_SANE_LOOP = 1200


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
    """Identical to export_meshy_namer.py's own helper of the same name --
    every closed boundary-edge loop in `bm`, flagged open/closed so
    `_fill_holes` never hands a non-loop to `triangle_fill`."""
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
    """Cap every closed boundary loop, one `triangle_fill` call per loop --
    see export_meshy_namer.py's own helper of the same name."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    loops = _trace_boundary_loops(bm)
    print(f"[{label}] {len(loops)} boundary loop(s), lengths={[len(e) for e, _ in loops]}")
    for loop_edges, closed in loops:
        if not closed or len(loop_edges) < 3:
            print(f"[{label}]   skip loop len={len(loop_edges)} closed={closed}")
            continue
        if len(loop_edges) > MAX_SANE_LOOP:
            raise SystemExit(
                f"[{label}] boundary loop of {len(loop_edges)} edges exceeds MAX_SANE_LOOP "
                f"({MAX_SANE_LOOP}) -- this is not a small cap fix, stop and re-examine the cut"
            )
        bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=loop_edges)
    remaining = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    ob.data.update()
    bm.free()
    if remaining:
        print(f"[{label}] WARNING: {remaining} boundary edge(s) remain open after fill")
    return remaining


def _read_real_metres():
    with open(JEEP_HULL_MANIFEST) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _strip_split_normals_and_colour(ob, label):
    """Clear this source's baked custom split normals and vertex-colour
    layer, and shade-smooth the result, BEFORE any decimate or cut.

    Not part of any prior export in this pipeline because no prior source
    needed it: `ob.data.has_custom_normals` was True and >95% of every one
    of this vehicle's three parts' own polygons carried `use_smooth=False`
    (confirmed by inspection, not assumed) -- a `part-segmentation` Meshy
    export apparently ships flat-shaded, unlike the `image-to-3d-texture`
    sources the tank/truck/Namer scripts cut. Left alone, glTF export must
    split a vertex everywhere its per-loop normal (and, before this fix, its
    per-loop vertex colour) differs from its neighbour's -- which is nearly
    every loop on a flat-shaded mesh. Measured on model_part0 alone: WITHOUT
    this step, decimate-then-export produced 112,881 position entries for
    37,701 triangles (ratio 2.99, essentially unshared) and a 4.07 MB single-
    part file; WITH it, 18,121 positions for the same 37,701 triangles (ratio
    0.48, in line with every other vehicle this pipeline ships -- see this
    task's report for the comparison table) and 662 KB. The vertex-colour
    layer (`Color`) is dropped for the same reason the contract already
    forbids materials: colour is the palette's job at runtime, never the
    source's."""
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
    print(f"[jeep_shoded] {label}: stripped custom split normals + vertex colour, shade-smoothed")


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(f"[jeep_shoded] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, {before_p} -> {after_p} polys")


def _is_wheel_face(f):
    c = f.calc_center_median()
    if abs(c.y) < Y_WHEEL_MIN or c.z >= Z_WHEEL_CUT:
        return False
    if X_REAR[0] <= c.x <= X_REAR[1]:
        return True
    if X_FRONT[0] <= c.x <= X_FRONT[1]:
        return True
    return False


def export():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    hull_obj = bpy.data.objects["model_part0"]
    mg_obj = bpy.data.objects["model_part1"]
    box_obj = bpy.data.objects["model_part2"]
    all_src = [hull_obj, mg_obj, box_obj]
    for ob in all_src:
        if ob.modifiers:
            raise SystemExit(f"{ob.name} carries {len(ob.modifiers)} modifier(s) -- apply before cutting")

    extent_model = _extent(all_src)
    real_metres = _read_real_metres()
    mpu = metres_per_unit(extent_model, real_metres)
    print(
        f"[jeep_shoded] extent {extent_model:.4f} model units -> {real_metres:.3f} m declared "
        f"({mpu:.5f} m/unit, real_metres from {JEEP_HULL_MANIFEST})"
    )

    # Strip baked custom split normals + vertex colour, per part, BEFORE any
    # decimate or cut -- see _strip_split_normals_and_colour's own doc
    # comment for why this source needs it and no prior one did.
    for ob, label in ((hull_obj, "model_part0"), (mg_obj, "model_part1"), (box_obj, "model_part2")):
        _strip_split_normals_and_colour(ob, label)

    # Decimate each part ONCE, before any cut -- see module docstring
    # "DECIMATION". model_part1/model_part2 are never cut, so this is their
    # only geometry-reduction step.
    _decimate(hull_obj, DECIMATE_RATIO_HULL, "model_part0")
    _decimate(mg_obj, DECIMATE_RATIO_MG, "model_part1")
    _decimate(box_obj, DECIMATE_RATIO_BOX, "model_part2")

    # -- Hull role split: rubber (wheels) vs hull (body) -- see module
    # docstring "THE CUT".
    for role in ("hull", "rubber", "metal", "plate"):
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    bpy.ops.object.select_all(action="DESELECT")
    hull_obj.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.duplicate()
    wheel_obj = bpy.context.object
    wheel_obj.name = "hull_rubber"
    _delete_faces(wheel_obj, _is_wheel_face, invert=False)
    _delete_faces(hull_obj, _is_wheel_face, invert=True)
    print(
        f"[jeep_shoded] pre-fill wheel faces={len(wheel_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )
    _fill_holes(wheel_obj, "wheel")
    _fill_holes(hull_obj, "hull-post-wheel-cut")
    print(
        f"[jeep_shoded] post-fill wheel faces={len(wheel_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )
    hull_obj.name = "hull_hull"

    # Contract naming and role tagging: {part}_{role} -- every mesh here uses
    # part="hull" (no turret_pivot -- see module docstring "NO TURRET PIVOT").
    for ob, role in ((hull_obj, "hull"), (wheel_obj, "rubber"), (mg_obj, "metal"), (box_obj, "plate")):
        name = f"hull_{role}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = "hull"

    all_parts = [hull_obj, wheel_obj, mg_obj, box_obj]

    # Bake model-units -> metres into vertex data (object scale stays 1).
    _bake_scale(all_parts, mpu)

    # Reorient: this source's own single-wheel end (pintle MG mount, canvas
    # roof) is the front -- empirically verified by driving the exported unit
    # and comparing it against the sim's own `drawTrail` decal, NOT by
    # identifying a hood in a still render (see module docstring
    # "ORIENTATION" for the correction and why the original still-frame
    # method, and a first attempt at a `worldToScreen`-projected reference
    # point, were both wrong or unreliable). That end sits at this source's
    # own +X pre-rotation (the tandem-wheel end sits at -X); a 180-degree Z
    # flip is needed to make it lead -- same bake point as the tank, truck
    # and Namer scripts (after cut and scale bake, before ground alignment).
    bpy.ops.object.select_all(action="DESELECT")
    for ob in all_parts:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    # Ground alignment. Computed from the ACTUAL combined minimum, not
    # assumed zero -- see module docstring "GROUND".
    zmins = [min(v.co.z for v in ob.data.vertices) for ob in all_parts]
    shift_z = -min(zmins)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in all_parts:
        ob.location.z = shift_z
        ob.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[jeep_shoded] ground shift +{shift_z:.6f} m (lowest vertex -> z=0)")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=(
            "Shoded Jeep -- AI-generated (Meshy), part-segmentation export, disclosed per "
            "CONTRIBUTING.md; re-split into hull_hull/hull_rubber/hull_metal/hull_plate for "
            "this repository. Replaces a jeep_shoded.blend sourced with LICENCE UNVERIFIED "
            "(see tools/render_jeep.py); retiring that source is possible once this mesh "
            "ships, and is not performed by this script."
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(
        f"[jeep_shoded] wrote {OUT_PATH} ({size} bytes) meshes: "
        f"hull_hull={len(hull_obj.data.polygons)} hull_rubber={len(wheel_obj.data.polygons)} "
        f"hull_metal={len(mg_obj.data.polygons)} hull_plate={len(box_obj.data.polygons)}"
    )
    return OUT_PATH


if __name__ == "__main__":
    export()
