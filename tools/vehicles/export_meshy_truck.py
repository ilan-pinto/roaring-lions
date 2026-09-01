"""Export the Meshy-generated armed technical as a hull+turret glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_truck.py

Writes `art/meshes/vehicles/technical.glb`.

SOURCES (two separate files, unlike the tank -- see this task's report,
`.superpowers/f-meshy-truck-report.md`, for the full reasoning):

  art/blend/enemy/truck/Meshy_AI_Technical_Truck_Body_0829203857_image-to-3d-texture.blend
      single mesh object `mesh_node`, 983,143 verts, one material,
      three packed 4096/2048 textures -- the truck bed already carries
      modelled jerry cans, no gun.

  art/blend/enemy/truck/Meshy_AI_Pintle_Mount_Machine__0829203951_image-to-3d-texture.blend
      single mesh object `mesh_node`, 987,449 verts, one material, its own
      three packed textures -- a complete pedestal-mounted DShK: base
      plate, post, cradle, gun body, barrel.

Both AI-generated (Meshy), disclosed per CONTRIBUTING.md.

Why two files is a GOOD thing here, and simpler than the tank. The tank's
one welded mesh needed a geometric face-cut with hole-filling
(`export_meshy_tank.py`) to separate hull from turret. This source is
already split at the object level -- no cut, no boundary-loop fill, no
geometric ambiguity. What replaces that complexity is a different problem:
**the two files are independently Meshy-normalised and share no common
scale.** Measured: the pintle mount's own longest axis is 1.905 model
units, against the truck body's 1.896 -- nearly identical, despite one
being a full pickup and the other a machine gun on a pedestal. That is a
Meshy export-normalisation coincidence, not a real-world size relationship,
confirmed by rendering both (see the report) -- the pintle mount is
obviously a gun-sized object, not truck-sized, and applying the hull's
scale factor to it would produce a gun mount roughly 3 m tall. So this
script derives TWO independent metres-per-unit factors, one per source,
each declared against its own real-world reference (see REAL_METRES_HULL /
REAL_METRES_TURRET below), and manually places the resulting turret at an
authored position on the hull -- there is no geometric information in
either file that relates one to the other's coordinate frame.

DECIMATION. Both sources are Meshy's refined/textured output, not its
low-poly mode: ~985k verts each, roughly 100x this pipeline's other
vehicles (mbt_lavi's cut geometry ships at 9,349; apc_eitan at 61,887).
Blender's Decimate modifier (COLLAPSE, edge-collapse) is applied directly
to each whole object before any other processing -- ratios measured against
this specific pair of meshes (see the report for the vertex-count table and
before/after silhouette renders), landing hull at ~13.8k verts and turret
at ~9.7k verts, both inside this pipeline's 8-20k order of magnitude and
both silhouette-preserving at the render sizes checked.

ORIENTATION. Neither source points +X. Measured independently (not
assumed) by binning vertices along each model's own long axis: the truck's
cab/hood sits at negative X and its loaded cargo bed at positive X, so its
nose faces -X; the pintle mount's thin barrel-tip cross-section sits at
extreme negative X (elevated in Z) while its base-plate/post cluster sits
near positive X, so its muzzle also points -X. Both get the same baked
180-degree Z rotation, independently, in their own local frames, after
their own scale bake.

ROLE SPLIT (added after the first export shipped, GH #148 -- "the technical
is the only vehicle with one role"). The first version of this script emitted
BOTH parts as `hull`, so all 49,096 vertices drew in one flat colour and no
repaint of `limestone` could help. Three roles ship now, each measured on the
DECIMATED mesh in its own (pre-scale, pre-rotation) source frame, and each
verified by rendering the classification back onto the model in false colour
(see this task's report for the images):

  - `turret_metal` -- the WHOLE pintle mount, wholesale. This file's own
    docstring already describes that source as "a complete pedestal-mounted
    DShK: base plate, post, cradle, gun body, barrel", and
    `tools/vehicles/author_technical.py` -- the authored sprite for this same
    unit -- tags essentially every `turret_*` part `metal` (its own
    `turret_pintle_plate`, `turret_post`, `turret_receiver`, `turret_jacket`,
    `turret_muzzle_tube` and the rest). So this is a rename, not a cut, and
    it needs no measurement. The `turret` PART prefix is kept: the renderer
    finds the turret to rotate by that prefix, and emitting a bare `metal`
    would break turret traverse.

  - `hull_rubber` -- the four tyres. GEOMETRY did this, and the source's own
    base-colour texture did NOT: sampled through the UVs, the front tyre
    reads luminance 0.293 against 0.300 for the rocker panel directly above
    it and 0.356 for the rear tyre -- no separation at all (this asset is
    uniformly dust-covered in base colour; its visible contrast lives in the
    normal map). What is decisive instead is that each wheel is a disc about
    the Y axis: a radial histogram around each axle centre shows a filled
    disc out to r~0.12 model units, a sharp drop at r=0.13-0.15 (the wheel
    arch clearance gap: 84 and 72 faces in those bins against 282 and 399
    just inside), then the arch itself. `WHEEL_R`/`WHEEL_CZ`/`AXLE_F`/
    `AXLE_R` below are that fit; `WHEEL_AY` keeps the axle, diff, springs and
    underbody -- which sit inside the same disc but inboard of the tyre --
    out of it.

  - `hull_metal` -- the bed's lashed jerry-can load, plus the front
    bumper/grille/brush-guard assembly and the rear step bumper. Here
    geometry and texture AGREE, which is why this one is shipped and `plate`
    is not. The can load is a dark, uniform mass (luminance p10/p50/p90 =
    0.233/0.268/0.311) sitting inside the bed walls; the bed floor
    immediately below it reads 0.478 and the bed walls immediately outboard
    read 0.303-0.556, so the box below has bright material on every side of
    it. Same at both ends: everything forward of x=-0.84 below the bonnet
    line reads 0.25-0.28 against 0.675 for the bonnet directly above, and
    everything aft of x=+0.84 below z=-0.037 reads 0.29 against 0.49-0.57
    above. Calling a jerry can `metal` is an authored judgement, not a
    derived fact -- it is a steel can, and `metal` ("gun, bars, chassis" in
    `tools/render_technical.py`'s own ROLE_PALETTE) is the only role in the
    closed vehicle vocabulary that means "dark steel fitting". The
    alternative was leaving the biggest dark mass on the vehicle painted as
    body limestone.

NOT SHIPPED, both checked and rejected rather than assumed:

  - `glass`. **This vehicle has no glazing.** Its windscreen is a bolted
    twin steel plate with two letterbox vision slits, and every side window
    is plated over the same way -- read off a textured Workbench render of
    the source's own -X and -Y facades, the same instrument
    `export_meshy_house.py` used to find ITS windows. There is nothing
    glass-like left on the model except the headlight lenses, which are a
    few faces inside the front bumper assembly and ship as `metal` with it.
    A `glass` role here would have to be invented.

  - `plate`, the improvised bolted armour -- which is this vehicle's single
    most characteristic feature and would have been the biggest win of the
    four. It has a real boundary in the SOURCE and no boundary at all in the
    SHIPPED mesh. At full resolution the door plates stand proud of the door
    skin across a genuinely empty air gap: binning the cab side by |y| finds
    dense material to |y|=0.260, then ZERO faces from 0.260 to 0.285, then
    the plate itself at 0.285-0.310. `DECIMATE_RATIO_HULL` closes that gap
    -- the same bins on the decimated mesh run continuously from 0.18 to
    0.305 with no empty band anywhere. Base colour cannot rescue it either:
    it works on the side (front wing 0.65-0.73 against door plate 0.25) and
    fails completely at the nose, where the windscreen armour reads 0.302
    against 0.313 for the bonnet beside it. A luminance threshold rendered
    onto the model produces torn, jagged patches across the bonnet, wing,
    tailgate and bed sides while leaving triangular holes INSIDE the plates
    -- exactly the speckle a role split must not have. And a rule tuned to
    catch only the door plates would paint half of one continuous armour kit
    dark and leave the windscreen plate -- the panel this vehicle most shows
    the dimetric camera -- as body limestone, which reads as a bug rather
    than as a partial answer. Recovering it needs a coarser
    `DECIMATE_RATIO_HULL` or a full-resolution classify-then-transfer pass,
    not a better threshold.

GROUND / PLACEMENT. The hull's own origin sits at its vertical midpoint
(z range roughly symmetric before ground-align), same defect as every
other Meshy source in this pipeline -- shifted up by its own lowest vertex
so the wheels touch z=0, the kit-vehicle convention. The turret has no
natural relationship to the hull's coordinate frame at all (two unrelated
files), so its placement on the truck bed is an authored decision, not a
derived one: see WORLD_PLACEMENT_M below for the measurement that produced
it (a histogram of the hull's own cargo-bed region, converted through the
hull's own mpu) and the sanity check against real truck-bed height.
"""
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper

REPO = os.path.dirname(TOOLS)
SRC_HULL = os.path.join(
    REPO, "art", "blend", "truck",
    "Meshy_AI_Technical_Truck_Body_0829203857_image-to-3d-texture.blend",
)
SRC_TURRET = os.path.join(
    REPO, "art", "blend", "truck",
    "Meshy_AI_Pintle_Mount_Machine__0829203951_image-to-3d-texture.blend",
)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "technical.glb")

#: technical's own declared real-world size -- read from the sprite sheet it
#: currently ships with (TECH_HULL/render_technical.py's own VehicleSpec),
#: same pattern as export_meshy_tank.py reading TNK_HULL's manifest. This is
#: the hull's longest axis (nose to tailgate).
TECH_HULL_MANIFEST = os.path.join(REPO, "assets", "sprites", "TECH_HULL", "manifest.json")

#: The pintle mount has no manifest of its own to read and no geometric
#: relationship to the hull's scale (see module docstring). Declared instead
#: from the unit's own weapon data: data/units/enemy/technical.json's single
#: weapon is `dshk` (a real DShK 12.7mm HMG, overall gun length 1.625 m).
#: 1.8 m adds the pedestal cradle's reach beyond the gun body itself, which
#: the model's own longest axis (barrel-to-rear-fitting) includes. This is a
#: declared editorial figure, not a derived one -- flagged here rather than
#: hidden, the same way mbt_lavi's inherited 6.32 m was flagged rather than
#: silently accepted.
REAL_METRES_TURRET = 1.8

#: Wheel fit, source frame, measured on the DECIMATED hull -- see the module
#: docstring's ROLE SPLIT section for the radial histogram this came from.
#: Each wheel is a disc about the Y axis; `WHEEL_CZ` is the axle height
#: (= the ground plane at z=-0.289 plus the tyre radius) and `WHEEL_R` sits
#: in the empty band between the tyre's own outer edge and the wheel arch.
WHEEL_R = 0.135
WHEEL_CZ = -0.166
AXLE_F = -0.636
AXLE_R = 0.451
#: Inboard limit of a wheel. The disc also contains the axle, differential,
#: leaf springs and a slice of underbody floor, all of which sit inboard of
#: the tyre and are NOT rubber.
WHEEL_AY = 0.190

#: The bed's lashed jerry-can load -- source frame, same decimated mesh. The
#: box is bounded on every side by material that measures brighter than it
#: (bed floor below, bed walls outboard, cab rear wall forward); see the
#: module docstring for the numbers. `CARGO_Z1` is generous: the load's own
#: top sits at z=0.225, so the ceiling never clips anything.
CARGO_X0, CARGO_X1 = 0.24, 0.88
CARGO_AY = 0.245
CARGO_Z0, CARGO_Z1 = 0.085, 0.30

#: Front bumper/grille/brush-guard, and the rear step bumper. Both are dark
#: structures that stop cleanly at a body line -- the bonnet lip forward, the
#: tailgate lip aft -- rather than fading into the panel above.
NOSE_X, NOSE_Z = -0.84, 0.037
TAIL_X, TAIL_Z = 0.84, -0.037

#: The turret source ships wholesale as `metal`; see the module docstring.
TURRET_ROLE = "metal"

#: Decimate ratios, measured against THESE two meshes (see report for the
#: vertex-count table and before/after silhouette renders) -- not a general
#: formula, because Decimate's COLLAPSE algorithm's actual output count
#: depends on mesh topology, not just target ratio.
DECIMATE_RATIO_HULL = 0.015
DECIMATE_RATIO_TURRET = 0.010

#: Where the turret_pivot lands in the FINAL (rotated, ground-aligned, +X
#: forward) hull frame, in metres. Derived from a histogram of the hull's
#: OWN cargo-bed region (x > 0.30 model units in the hull's pre-rotation
#: source frame, where the loaded jerry cans sit) -- centred left-right,
#: biased toward the rear (65% of the way from bed-front to tailgate), at
#: the bed-floor height read from the low-density valley in that region's
#: z-histogram (~0.02 model units, between the floor/wall cluster and the
#: jerry-can mass above it). After the hull's own 180-degree rotation and
#: ground shift this works out to (-1.635, 0.0, 0.819) m -- sanity-checked
#: against the hull's own 5.0 m declared length (65% into the rear half, not
#: at the very tailgate edge) and against a real pickup's bed-floor height
#: (~0.8-0.9 m), both plausible. See the report for the full derivation;
#: this is an authored placement, not something either source file encodes.
WORLD_PLACEMENT_M = (-1.635, 0.0, 0.819)


def _read_real_metres(manifest_path):
    import json
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _extent_of(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    m = eo.to_mesh()
    xs, ys, zs = [], [], []
    for v in m.vertices:
        wc = eo.matrix_world @ v.co
        xs.append(wc.x)
        ys.append(wc.y)
        zs.append(wc.z)
    eo.to_mesh_clear()
    return max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def _load_object(path, new_name):
    """Append `mesh_node` from `path` into the CURRENT scene, renamed so two
    files' identically-named root objects don't collide once both are
    loaded together."""
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "mesh_node"]
    if not dst.objects or dst.objects[0] is None:
        raise SystemExit(f"{path}: no 'mesh_node' object found")
    ob = dst.objects[0]
    bpy.context.collection.objects.link(ob)
    ob.name = new_name
    ob.data.name = new_name
    if ob.modifiers:
        raise SystemExit(f"{new_name}: carries {len(ob.modifiers)} modifier(s) on load -- unexpected")
    return ob


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(f"[{label}] decimate ratio={ratio}: {before_v} -> {after_v} verts, {before_p} -> {after_p} polys")


def _turret_pivot_local(ob, eps=0.05):
    """Horizontal centroid of the lowest-z vertex layer -- the base plate's
    underside, the same "lowest contact layer" convention
    `export_mesh_vehicle.py`'s `_turret_pivot` uses for a turret ring.
    Measured on the FULL (pre-decimate) mesh so it is not sensitive to which
    exact verts survive decimation; decimate preserves the overall silhouette
    (see the report) so the post's footprint centre does not move materially.
    """
    zmin = min(v.co.z for v in ob.data.vertices)
    layer = [v.co for v in ob.data.vertices if v.co.z <= zmin + eps]
    cx = sum(p.x for p in layer) / len(layer)
    cy = sum(p.y for p in layer) / len(layer)
    return (cx, cy, zmin)


def _hull_role(c):
    """The role for one decimated hull face, from its centroid in the SOURCE
    frame (nose -X, bed +X, ground z=-0.289). See the module docstring's
    ROLE SPLIT section for how every constant below was measured."""
    for cx in (AXLE_F, AXLE_R):
        if abs(c.y) >= WHEEL_AY and (c.x - cx) ** 2 + (c.z - WHEEL_CZ) ** 2 <= WHEEL_R ** 2:
            return "rubber"
    if CARGO_X0 <= c.x <= CARGO_X1 and abs(c.y) < CARGO_AY and CARGO_Z0 <= c.z <= CARGO_Z1:
        return "metal"
    if c.x < NOSE_X and c.z < NOSE_Z:
        return "metal"
    if c.x > TAIL_X and c.z < TAIL_Z:
        return "metal"
    return "hull"


def _classify_hull(ob):
    """{role: set(face_index)} over the decimated hull. Every role must be
    non-empty: an empty one would mean a constant above has drifted off the
    geometry it was fitted to, which is a silent flat-colour regression --
    the exact bug this split exists to fix -- so it raises instead."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    out = {}
    for f in bm.faces:
        out.setdefault(_hull_role(f.calc_center_median()), set()).add(f.index)
    total = len(bm.faces)
    bm.free()
    for role in ("hull", "metal", "rubber"):
        if not out.get(role):
            raise SystemExit(
                f"[technical] hull role {role!r} came out EMPTY -- the cut constants no "
                f"longer match the geometry; re-measure before shipping"
            )
    for role in sorted(out):
        n = len(out[role])
        print(f"[technical] hull role {role}: {n} faces ({100.0 * n / total:.1f}%)")
    return out


def _keep_only(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _split_hull(hull_obj, role_faces):
    """Duplicate the decimated hull once per role and cut each copy down to
    its own faces. Boundaries are deliberately left OPEN, the way
    `tools/buildings/export_meshy_house.py` leaves its own role cuts open:
    every cut here runs along a real material seam (tyre against wheel arch,
    can load against bed floor, bumper against bonnet lip), so the two sides
    of a cut are separate surfaces that were never one closed shell. There
    is no boundary loop to cap the way `export_meshy_tank.py`'s mid-hull
    face cut had."""
    pieces = []
    for role in ("hull", "metal", "rubber"):
        bpy.ops.object.select_all(action="DESELECT")
        hull_obj.select_set(True)
        bpy.context.view_layer.objects.active = hull_obj
        bpy.ops.object.duplicate()
        piece = bpy.context.object
        piece.name = f"hull_{role}"
        _keep_only(piece, role_faces[role])
        pieces.append((piece, role))
    bpy.data.objects.remove(hull_obj, do_unlink=True)
    return pieces


def _rotate_180z(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def export():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    hull_obj = _load_object(SRC_HULL, "hull_src")
    turret_obj = _load_object(SRC_TURRET, "turret_src")

    # Real-world scale, independently per source (see module docstring).
    real_metres_hull = _read_real_metres(TECH_HULL_MANIFEST)
    extent_hull = _extent_of(hull_obj)
    mpu_hull = metres_per_unit(extent_hull, real_metres_hull)
    print(
        f"[technical] hull extent {extent_hull:.4f} model units -> {real_metres_hull:.3f} m declared "
        f"({mpu_hull:.5f} m/unit, real_metres from {TECH_HULL_MANIFEST})"
    )

    extent_turret = _extent_of(turret_obj)
    mpu_turret = metres_per_unit(extent_turret, REAL_METRES_TURRET)
    print(
        f"[technical] turret extent {extent_turret:.4f} model units -> {REAL_METRES_TURRET:.3f} m declared "
        f"({mpu_turret:.5f} m/unit, dshk-derived, see module docstring)"
    )

    # Turret pivot, measured in the turret's OWN pre-scale, pre-rotate,
    # pre-decimate frame (see _turret_pivot_local docstring).
    pivot_local = _turret_pivot_local(turret_obj)
    print(f"[technical] turret pivot (source frame, model units): {tuple(round(c, 4) for c in pivot_local)}")

    # Decimate. Order: after measuring extent/pivot on the full mesh, before
    # everything else -- so every later step (rotate, bake scale, ground
    # align) operates on the cheap mesh.
    _decimate(hull_obj, DECIMATE_RATIO_HULL, "hull")
    _decimate(turret_obj, DECIMATE_RATIO_TURRET, "turret")

    # Role split. Measured in the SOURCE frame on the DECIMATED mesh, so it
    # has to run here -- after decimate, before the scale bake and the
    # 180-degree rotation move every coordinate the constants were fitted to.
    role_faces = _classify_hull(hull_obj)
    hull_pieces = _split_hull(hull_obj, role_faces)

    # Contract naming and role, before bake/rotate so nothing downstream
    # needs to remember which object is which.
    tagged = [(ob, role, "hull") for ob, role in hull_pieces]
    tagged.append((turret_obj, TURRET_ROLE, "turret"))
    for ob, role, part in tagged:
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")
        name = f"{part}_{role}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = part

    hull_objs = [ob for ob, _role in hull_pieces]

    # Bake scale into vertex data, independently per part (object scale
    # stays 1, the mesh contract's convention). Every hull piece shares the
    # hull's own factor; the turret has its own (see module docstring).
    _bake_scale(hull_objs, mpu_hull)
    _bake_scale([turret_obj], mpu_turret)
    pivot_scaled = tuple(c * mpu_turret for c in pivot_local)

    # Reorient. Both sources point -X (verified independently, see module
    # docstring); bake 180 degrees about Z into each, AFTER its own scale
    # bake, in its own local frame.
    _rotate_180z(hull_objs)
    _rotate_180z([turret_obj])
    pivot_rotated = (-pivot_scaled[0], -pivot_scaled[1], pivot_scaled[2])

    # Ground-align the hull: its own origin sits at the vertical midpoint
    # (same defect as every other Meshy source in this pipeline), not at
    # ground level. Shift up by its own lowest vertex -- the lowest across
    # ALL hull pieces, applied to all of them together, so the split cannot
    # move the vehicle off the ground or shear its parts apart. In practice
    # the lowest vertex is a tyre's contact patch, i.e. `hull_rubber`'s.
    hull_zmin = min(min(v.co.z for v in ob.data.vertices) for ob in hull_objs)
    shift_hull = -hull_zmin
    bpy.ops.object.select_all(action="DESELECT")
    for ob in hull_objs:
        ob.location.z = shift_hull
        ob.select_set(True)
    bpy.context.view_layer.objects.active = hull_objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[technical] hull ground shift +{shift_hull:.4f} m (lowest vertex -> z=0)")

    # Place the turret on the truck bed. No geometric relationship between
    # the two source frames exists (see module docstring) -- translate the
    # turret so its own pivot point lands exactly at the authored
    # WORLD_PLACEMENT_M, in the hull's now-final (rotated, ground-aligned)
    # frame.
    delta = tuple(WORLD_PLACEMENT_M[i] - pivot_rotated[i] for i in range(3))
    bpy.ops.object.select_all(action="DESELECT")
    turret_obj.location = delta
    turret_obj.select_set(True)
    bpy.context.view_layer.objects.active = turret_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    pivot_world = WORLD_PLACEMENT_M
    print(f"[technical] turret translated by {tuple(round(c, 4) for c in delta)} m -> pivot at {pivot_world}")

    pivot_obj = bpy.data.objects.new("turret_pivot", None)
    pivot_obj.empty_display_size = 0.15
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot_world
    inv = Matrix.Translation(Vector(pivot_world) * -1.0)
    turret_obj.parent = pivot_obj
    turret_obj.matrix_parent_inverse = inv

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
            "Armed technical hull+turret -- AI-generated (Meshy), disclosed per "
            "CONTRIBUTING.md; truck body and pintle-mounted DShK from two separate "
            "Meshy exports, combined for this repository"
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(f"[technical] wrote {OUT_PATH} ({size} bytes)")
    return OUT_PATH


if __name__ == "__main__":
    export()
