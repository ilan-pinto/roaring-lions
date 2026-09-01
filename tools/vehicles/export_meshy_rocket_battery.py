"""Export the Meshy-generated BM-21 Grad rocket truck as a glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/vehicles/export_meshy_rocket_battery.py

Writes `art/meshes/vehicles/rocket_battery.glb`.

The asset was supplied as "truck mortor". It is not a mortar: it is a
**BM-21 Grad on a 6x6 truck chassis**, and it maps to the existing enemy unit
`rocket_battery` (`data/units/enemy/rocket_battery.json` -- artillery, one
`grad_122` rocket at 20 tiles, speed 0.5, crew 4). Nothing about the mortar
label survives into this file.

SOURCES (two .blend files supplied; both inspected, one used)

  art/blend/enemy/truck mortor/
      Meshy_AI_grad_rocket_truck_3d_0831111455_image-to-3d-texture.blend
          one welded object `mesh_node`, 982,804 verts, ONE material with
          packed textures. NOT USED.

  art/blend/enemy/truck mortor/
      Meshy_AI_grad_rocket_truck_par_0831111722_part-segmentation.blend
          twelve objects `model_part0`..`model_part11`, 983,597 verts in
          total, ZERO materials and ZERO images. USED.

Both AI-generated (Meshy), disclosed per CONTRIBUTING.md.

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

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(
    REPO, "art", "blend", "enemy", "truck mortor",
    "Meshy_AI_grad_rocket_truck_par_0831111722_part-segmentation.blend",
)
#: The .blend files are gitignored and live in the MAIN checkout, not in a
#: worktree. Fall back to it so this script runs from either.
SRC_FALLBACK = os.path.join(
    "/Users/ilpinto/dev/roaring-lions", "art", "blend", "enemy", "truck mortor",
    "Meshy_AI_grad_rocket_truck_par_0831111722_part-segmentation.blend",
)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "rocket_battery.glb")
MANIFEST = os.path.join(REPO, "assets", "sprites", "ROCKETBATTERY_HULL", "manifest.json")

#: source object -> (rl_role, decimate ratio). See the module docstring for
#: how each part was identified (measured extents, not the part numbering)
#: and why each ratio is what it is.
PARTS = {
    "model_part0":  ("hull",   0.035),   # cab + bonnet
    "model_part11": ("plate",  0.018),   # chassis frame + bed deck
    "model_part6":  ("metal",  0.020),   # rocket rack
    "model_part3":  ("plate",  0.040),   # bulkhead behind the cab
    "model_part1":  ("rubber", 0.022),   # front axle, left
    "model_part2":  ("rubber", 0.022),   # front axle, right
    "model_part4":  ("rubber", 0.022),   # bogie 1, right
    "model_part5":  ("rubber", 0.022),   # bogie 1, left
    "model_part7":  ("rubber", 0.022),   # bogie 2, right
    "model_part8":  ("rubber", 0.022),   # bogie 2, left
    "model_part10": ("plate",  0.300),   # chassis-rail box
    "model_part9":  ("metal",  1.000),   # thin rail -- 414 verts, nothing to collapse
}

#: Order the joined role nodes are built in, so the export is byte-stable
#: across runs regardless of dict iteration.
ROLE_ORDER = ("hull", "plate", "metal", "rubber")

TAG = "rocket_battery"


def _src_path():
    for path in (SRC, SRC_FALLBACK):
        if os.path.exists(path):
            return path
    raise SystemExit(f"neither source path exists:\n  {SRC}\n  {SRC_FALLBACK}")


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
    src = _src_path()
    bpy.ops.wm.open_mainfile(filepath=src)

    for role, _ratio in PARTS.values():
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    present = {o.name for o in bpy.data.objects if o.type == "MESH"}
    if present != set(PARTS):
        raise SystemExit(
            f"{TAG}: source object set changed -- expected {sorted(PARTS)}, found {sorted(present)}"
        )
    non_mesh = [o.name for o in bpy.data.objects if o.type != "MESH"]
    if non_mesh:
        raise SystemExit(f"{TAG}: unexpected non-mesh objects in source: {non_mesh}")
    if bpy.data.materials or bpy.data.images:
        raise SystemExit(
            f"{TAG}: source carries {len(bpy.data.materials)} material(s) and "
            f"{len(bpy.data.images)} image(s) -- expected none from a part-segmentation export"
        )

    objs = [bpy.data.objects[n] for n in PARTS]
    for ob in objs:
        if ob.modifiers:
            raise SystemExit(f"{ob.name}: carries {len(ob.modifiers)} modifier(s) on load -- unexpected")

    # Real-world scale, measured on the FULL mesh before any collapse so the
    # figure does not depend on which verts decimation happens to keep.
    extent, lo, hi = _world_extent(objs)
    real_metres = _read_real_metres()
    mpu = metres_per_unit(extent, real_metres)
    print(f"[{TAG}] source bbox lo={[round(v, 5) for v in lo]} hi={[round(v, 5) for v in hi]}")
    print(f"[{TAG}] extent {extent:.5f} model units -> {real_metres:.3f} m declared "
          f"({mpu:.5f} m/unit, realMetres from {MANIFEST})")

    total_before = sum(len(o.data.vertices) for o in objs)
    for ob in objs:
        _strip_split_normals_and_colour(ob)
    print(f"[{TAG}] stripped custom split normals + vertex colour on {len(objs)} parts, shade-smoothed")

    for ob in objs:
        _decimate(ob, PARTS[ob.name][1], ob.name)
    total_after = sum(len(o.data.vertices) for o in objs)
    print(f"[{TAG}] decimation total: {total_before} -> {total_after} verts")

    # Join by role -- one node per role, named {part}_{role}, the shape every
    # other vehicle in art/meshes/vehicles/ already has (`hull_hull`,
    # `hull_rubber`, ...). part is always "hull": no turret pivot, see the
    # module docstring.
    by_role = {}
    for role in ROLE_ORDER:
        members = [bpy.data.objects[n] for n in PARTS if PARTS[n][0] == role]
        if not members:
            continue
        merged = _join(members, f"hull_{role}")
        merged.data.materials.clear()
        for k in list(merged.keys()):
            if k != "_RNA_UI":
                del merged[k]
        merged["rl_role"] = role
        merged["rl_part"] = "hull"
        by_role[role] = merged
        print(f"[{TAG}] hull_{role}: joined {len(members)} part(s) -> "
              f"{len(merged.data.vertices)} verts, {len(merged.data.polygons)} polys")

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
            "BM-21 Grad rocket truck -- AI-generated (Meshy), part-segmentation export, "
            "disclosed per CONTRIBUTING.md; twelve segmented parts joined into "
            "hull_hull/hull_plate/hull_metal/hull_rubber for this repository. Stands in "
            "for the ROCKETBATTERY_HULL billboard authored from primitives by "
            "tools/vehicles/author_rocket_battery.py (CC BY-SA 4.0), which is not "
            "retired by this script."
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(f"[{TAG}] wrote {OUT_PATH} ({size} bytes) meshes: "
          + ", ".join(f"{ob.name}={len(ob.data.vertices)}v" for ob in parts))
    return OUT_PATH


if __name__ == "__main__":
    export()
