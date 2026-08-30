"""Export the Meshy-generated Namer IFV as a hull+turret glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_namer.py

Writes `art/meshes/vehicles/ifv_namer.glb`.

SOURCE: art/blend/namer/Meshy_AI_heavy_ifv_multigun_mo_0830112110_image-to-3d-texture.blend
-- AI-generated (Meshy), image-to-3D, single mesh object `mesh_node`, 992,444
verts / 1,987,781 polys (a full-resolution Meshy export, NOT its low-poly
mode -- same situation as `export_meshy_truck.py`'s two sources, not
`export_meshy_tank.py`'s 3,906-vert one), one material, no modifiers.
Disclosed per CONTRIBUTING.md; see this task's report
(`.superpowers/namer-integration-report.md`) for the full licensing note --
in particular, this replacement is what makes retiring the current
third-party CC BY 3.0 `ifv_dmm08.blend` sheets possible (not performed by
this script).

DECIMATION, same reasoning as export_meshy_truck.py. At ~992k verts this
pipeline's usual approach for a WELDED single-shell source
(export_meshy_tank.py's per-loop `triangle_fill` hole-filling after a
geometric face cut) would trace and cap boundary loops an order of magnitude
larger than the tank's 86-edge loops -- impractical to verify by hand and
slow to compute. So, like the truck, this source is decimated ONCE (COLLAPSE,
ratio measured against this specific mesh -- see DECIMATE_RATIO) before any
cut, and every threshold below is measured against the ALREADY-DECIMATED
mesh's own histograms, not the raw source's -- unlike export_meshy_tank.py's
thresholds, which were measured on its (never decimated) full-resolution
mesh. Decimate COLLAPSE preserves overall shape and does not merge originally
disjoint geometry, so the classification signal survives the reduction; this
was checked, not assumed -- see the report for the before/after histogram
comparison.

CONNECTIVITY, checked first exactly like the tank. A weld-then-flood-fill
component census at four thresholds (1e-6 to 1e-2) on the decimated mesh
found ONE component at every threshold below 1e-2 (39,710-39,755 of 39,755
faces) -- no free split, same conclusion as the tank and for the same
underlying reason (an image-to-3D result has no modelled seam between hull,
turret and running gear). Every cut below is therefore geometric (face
position), not topological. Unlike the tank, no small disconnected
components (antenna stubs, greebles) turned up at any weld threshold either
-- see the report.

THE CUTS. All four measured on the decimated mesh, in its own (pre-scale,
pre-rotation) source frame:

  - HULL vs TURRET (RWS + gun): a Z histogram is decisive. The hull roof's
    own vertex density peaks in a wide band z=[0.13,0.16] (the flat troop
    compartment roof); above z~0.19 the vertex count collapses to a narrow
    cluster whose own XY footprint (measured at z>=0.19: x=[-0.506,0.286],
    y=[-0.232,0.327]) sits well inside the hull's own XY extent
    (x=[-0.952,0.951]) -- i.e. it is a small, centrally-located turret
    assembly, not a hull-edge artefact. Z_CUT=0.19 was chosen from a sweep
    (0.16 through 0.21): at 0.16-0.18 the turret set's own XY footprint
    still reaches the hull's own extreme corners (x up to 0.75+), meaning
    those cuts catch stray hull-roof greebles (antenna mounts, hooks) along
    with the RWS; by 0.19 those stragglers (whose own z max was measured at
    0.188) drop out and the remaining set is cleanly the RWS+gun. See the
    report for the full sweep table.

  - BARREL/RWS-appendages vs MOUNT-BOX, inside the turret set (`metal` vs
    the small `glass` sensor block below): a per-x-slice y/z-width scan
    (0.01-unit steps) of the turret set shows a genuine narrow tube
    (y-width 0.02-0.07, z-width 0.02-0.06) running from x=-0.46 to x=-0.09,
    plus a symmetric PAIR of equally narrow appendages at y~=+-0.30 spanning
    x=-0.52 to -0.46 (most likely twin smoke-grenade dischargers or sensor
    stalks flanking the mount -- "multigun" in the source filename is
    consistent with more than one weapon/sensor on this station, though
    nothing in the geometry names which). All of that -- barrel, both side
    appendages, and the mount box itself -- sits at x < -0.09; the mount box
    (x=[-0.09,0.21], y-width 0.27-0.55, clearly NOT tube-shaped) picks up
    immediately past that line. `tools/vehicles/kit.py`'s own authored
    `rws()` helper tags its mount and its barrel BOTH `metal` (only the
    forward shield plate is `plate`), so treating the whole "everything
    except the sensor block" region as one `metal` mesh matches that
    convention rather than inventing a new hull/metal split for an RWS this
    small -- there is no turret_hull mesh in this export for that reason,
    matching dozer_d9's own precedent of a legitimate role/part absence.

  - The `glass` SENSOR BLOCK: a separate, small, consistently-negative-y
    block appears once x >= 0.21 (y=[-0.23,-0.11], clearly split off from
    the mount body, which has already ended by that x) -- read as a
    side-mounted sight/thermal-imager pod, the kind of hardware `glass`
    exists for ("vision blocks" per kit.py). GLASS_X_MIN sits at 0.205,
    inside the small ambiguous strip (x=[0.19,0.21)) where the block and the
    mount body's own tail overlap in the same x-slice -- ceded to `metal`
    rather than guessed at, the same kind of conservative call the tank's
    antenna/barrel boxes made.

  - TRACKS/WHEELS (`hull` -> `rubber`): the same y-histogram-at-low-z
    signal the tank's report already used, and just as decisive here. Below
    z=-0.245 (source frame) the hull's own CENTRE (|y| < ~0.20) is
    completely empty across every sub-band tried -- the open belly between
    the two track runs -- while the flanks (|y| in [0.25,0.42]) are dense.
    The signal degrades gradually as z rises: by z=[-0.145,-0.045) the
    centre has filled in with hull-floor noise and a NEW extreme band
    appears at |y|>=0.47 (the fender/hull-side skirt, not track). Z_WHEEL_CUT
    =-0.145 sits at the point the open-belly signal stops being clean;
    Y_TRACK_MIN=0.22 sits with margin inside the empirical gap (dense flank
    data starts at |y|~=0.25, centre noise stays below |y|~=0.20). See the
    report for the full z-sub-band sweep.

Not attempted: `plate`/`recess` on the hull remainder. Past tracks and the
turret assembly, the hull body is one continuous, heavily detailed welded
surface with no comparable large-scale geometric signal (no open gap, no
disjoint component, no isolated small block) to cut a bolt-on-armour region
along -- the same conclusion `export_meshy_tank.py` reached for its own hull
remainder, for the same reason.

FORWARD REORIENTATION. Verified with coloured axis markers against the
DECIMATED preview mesh (not assumed) -- see the report for the renders. The
model's engine-deck-style roof grille sits at +X, which would read as "front"
on a real front-engined Namer/Merkava-pattern hull, but the RWS's own gun
tube (the one unambiguous, geometrically measured directional feature on
this asset) currently points -X, mirroring BOTH prior Meshy vehicles in this
pipeline (`export_meshy_tank.py`'s gun, `export_meshy_truck.py`'s DShK): both
also pointed -X pre-rotation and were flipped 180 degrees so their armament
faces +X post-export. This script follows the same rule for the same
consistency reason -- the gun is the one signal every vehicle in this family
has used and verified, where the grille reading is inferred from real-world
vehicle knowledge this asset is not guaranteed to reproduce faithfully. Baked
as a final 180-degree Z rotation on the already-cut, already-scaled geometry,
exactly where the tank and truck scripts apply theirs.

ROLE PALETTE. `packages/render/src/three/units/vehicle-mesh-role.ts` needs a
COMPLETE `ifv_namer` entry (all six vehicle roles, matching `apc_eitan`'s own
KDF-olive table verbatim -- both are native KDF armour) regardless of which
roles this GLB actually uses, exactly as `mbt_lavi`'s table is complete
despite its GLB shipping only three of six -- `rampForVehicleRole` throws at
BOOT for any role missing from a vehicle's table, not at asset load, so a
partial table is a loud failure waiting to happen the moment a future export
of this vehicle adds a role its table does not yet cover.
"""
import json
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(
    REPO, "art", "blend", "namer",
    "Meshy_AI_heavy_ifv_multigun_mo_0830112110_image-to-3d-texture.blend",
)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "ifv_namer.glb")

#: ifv_namer's own declared real-world size -- read from the sprite sheet it
#: currently ships with (NAMER_HULL), the same "read the shipped manifest,
#: never hand-type" convention export_meshy_tank.py uses for TNK_HULL.
NAMER_HULL_MANIFEST = os.path.join(REPO, "assets", "sprites", "NAMER_HULL", "manifest.json")

#: Decimate ratio, measured against THIS mesh (see module docstring) --
#: 992,444 verts / 1,987,781 polys down to ~18-19k verts / ~40k polys, the
#: same order of magnitude as export_meshy_truck.py's own two decimated
#: parts combined (~23.5k) and well inside apc_eitan's shipped 61,887.
DECIMATE_RATIO = 0.02

#: Hull/turret split (source frame, on the DECIMATED mesh) -- see module
#: docstring for the z-sweep this was measured against.
Z_CUT = 0.19

#: Turret role split: metal (mount + barrel + side appendages) vs glass (the
#: small sensor block) -- source frame, same decimated mesh. See module
#: docstring.
GLASS_X_MIN = 0.205
GLASS_X_MAX = 0.31   # generous; the turret set's own x max is ~0.307
GLASS_Y_MIN = -0.26
GLASS_Y_MAX = -0.09

#: Track/wheel role split (hull -> rubber), source frame, same decimated
#: mesh -- see module docstring for the y-histogram-at-low-z evidence.
Z_WHEEL_CUT = -0.145
Y_TRACK_MIN = 0.22

#: Turret pivot: horizontal centroid of the mount box's OWN footprint only
#: (excludes the barrel/side-appendages at x<-0.09 and the glass block at
#: x>=0.205, both of which would drag a naive bbox centre off-axis the same
#: way export_mesh_vehicle.py's own _turret_pivot excludes a tank barrel).
MOUNT_X_MIN = -0.09
MOUNT_X_MAX = 0.21

#: Above this many boundary-loop edges, a "cap" is not a small fix -- see
#: export_meshy_tank.py's own constant of the same name and purpose. Higher
#: here because the decimated mesh (still ~40k polys) has proportionally
#: more boundary detail than the tank's never-decimated 3,906-vert source;
#: checked against the actual loop sizes this export produces, not guessed.
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
    """Identical to export_meshy_tank.py's own helper of the same name --
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
    same per-loop-not-per-mesh reasoning as export_meshy_tank.py (a combined
    multi-island `holes_fill` call silently returns zero faces)."""
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


def _read_real_metres():
    with open(NAMER_HULL_MANIFEST) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _is_turret_face(f):
    return f.calc_center_median().z >= Z_CUT


def _is_glass_face(f):
    c = f.calc_center_median()
    return GLASS_X_MIN <= c.x <= GLASS_X_MAX and GLASS_Y_MIN <= c.y <= GLASS_Y_MAX


def _is_wheel_face(f):
    c = f.calc_center_median()
    return c.z < Z_WHEEL_CUT and abs(c.y) >= Y_TRACK_MIN


def _turret_pivot(turret_obj):
    """Horizontal centroid of the mount box's own footprint (MOUNT_X_MIN..
    MOUNT_X_MAX), excluding the barrel/side-appendages and the glass sensor
    block -- see module docstring."""
    bm = bmesh.new()
    bm.from_mesh(turret_obj.data)
    pts = [v.co.copy() for v in bm.verts]
    bm.free()
    core = [p for p in pts if MOUNT_X_MIN <= p.x <= MOUNT_X_MAX]
    if not core:
        raise SystemExit("turret pivot: no core (mount-box) vertices found")
    xs = [p.x for p in core]
    ys = [p.y for p in core]
    zs = [p.z for p in core]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    cz = min(zs)
    return (cx, cy, cz)


def export():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    src_obj = bpy.data.objects["mesh_node"]
    if src_obj.modifiers:
        raise SystemExit(f"mesh_node carries {len(src_obj.modifiers)} modifier(s) -- apply before cutting")

    extent_model = _extent_of(src_obj)
    real_metres = _read_real_metres()
    mpu = metres_per_unit(extent_model, real_metres)
    print(
        f"[ifv_namer] extent {extent_model:.4f} model units -> {real_metres:.3f} m declared "
        f"({mpu:.5f} m/unit, real_metres from {NAMER_HULL_MANIFEST})"
    )

    # Decimate ONCE, on the whole welded shell, before any cut -- see module
    # docstring "DECIMATION".
    before_v, before_p = len(src_obj.data.vertices), len(src_obj.data.polygons)
    mod = src_obj.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = DECIMATE_RATIO
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(src_obj.data.vertices), len(src_obj.data.polygons)
    print(f"[ifv_namer] decimate ratio={DECIMATE_RATIO}: {before_v} -> {after_v} verts, {before_p} -> {after_p} polys")

    # Duplicate into hull/turret working copies, then cut each to its half.
    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    turret_obj = bpy.context.object
    turret_obj.name = "turret_cut"
    hull_obj = src_obj
    hull_obj.name = "hull_cut"

    _delete_faces(turret_obj, _is_turret_face, invert=False)
    _delete_faces(hull_obj, _is_turret_face, invert=True)
    print(f"[ifv_namer] pre-fill hull faces={len(hull_obj.data.polygons)} turret faces={len(turret_obj.data.polygons)}")

    _fill_holes(turret_obj, "turret")
    _fill_holes(hull_obj, "hull")
    print(f"[ifv_namer] post-fill hull faces={len(hull_obj.data.polygons)} turret faces={len(turret_obj.data.polygons)}")

    # Turret pivot, in the SOURCE (pre-rotation, pre-bake) frame -- rotated
    # below alongside the geometry itself.
    pivot_local = _turret_pivot(turret_obj)
    print(f"[ifv_namer] turret pivot (source frame, model units): {tuple(round(c, 4) for c in pivot_local)}")

    # -- Turret role split: glass (sensor block) vs metal (everything else:
    # mount box, barrel, side appendages) -- see module docstring.
    for role in ("glass", "metal"):
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    bpy.ops.object.select_all(action="DESELECT")
    turret_obj.select_set(True)
    bpy.context.view_layer.objects.active = turret_obj
    bpy.ops.object.duplicate()
    glass_obj = bpy.context.object
    glass_obj.name = "turret_glass"
    _delete_faces(glass_obj, _is_glass_face, invert=False)
    _delete_faces(turret_obj, _is_glass_face, invert=True)
    print(
        f"[ifv_namer] pre-fill glass faces={len(glass_obj.data.polygons)} "
        f"turret-metal-remaining faces={len(turret_obj.data.polygons)}"
    )
    _fill_holes(glass_obj, "glass")
    _fill_holes(turret_obj, "turret-post-glass-cut")
    print(
        f"[ifv_namer] post-fill glass faces={len(glass_obj.data.polygons)} "
        f"turret-metal-remaining faces={len(turret_obj.data.polygons)}"
    )
    turret_obj.name = "turret_metal"

    # -- Hull role split: rubber (tracks/wheels) vs hull (body) -- see
    # module docstring.
    if "rubber" not in vehicle_kit.ROLES:
        raise SystemExit(f"role 'rubber' outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    bpy.ops.object.select_all(action="DESELECT")
    hull_obj.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.duplicate()
    wheel_obj = bpy.context.object
    wheel_obj.name = "hull_rubber"
    _delete_faces(wheel_obj, _is_wheel_face, invert=False)
    _delete_faces(hull_obj, _is_wheel_face, invert=True)
    print(
        f"[ifv_namer] pre-fill wheel faces={len(wheel_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )
    _fill_holes(wheel_obj, "wheel")
    _fill_holes(hull_obj, "hull-post-wheel-cut")
    print(
        f"[ifv_namer] post-fill wheel faces={len(wheel_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )
    hull_obj.name = "hull_hull"

    # Contract naming and role tagging: {part}_{role}, extras.rl_role /
    # extras.rl_part on each.
    for ob, role, part in (
        (hull_obj, "hull", "hull"),
        (wheel_obj, "rubber", "hull"),
        (turret_obj, "metal", "turret"),
        (glass_obj, "glass", "turret"),
    ):
        name = f"{part}_{role}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = part

    all_parts = [hull_obj, wheel_obj, turret_obj, glass_obj]

    # Bake model-units -> metres into vertex data (object scale stays 1).
    _bake_scale(all_parts, mpu)
    pivot_world_src = tuple(c * mpu for c in pivot_local)

    # Reorient: source's own gun points -X (verified with coloured axis
    # markers -- see module docstring), contract wants +X. 180-degree Z
    # rotation, applied and baked in AFTER the cuts and the scale bake, on
    # every piece and on the pivot location alike.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in all_parts:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    pivot_world = (-pivot_world_src[0], -pivot_world_src[1], pivot_world_src[2])

    # Ground alignment. This source's own origin sits at the vehicle's
    # vertical MIDPOINT, same defect as every other Meshy source in this
    # pipeline -- shift every piece (and the pivot) up by the combined
    # lowest vertex, in the SAME already-scaled, already-rotated frame.
    zmins = [min(v.co.z for v in ob.data.vertices) for ob in all_parts]
    shift_z = -min(zmins)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in all_parts:
        ob.location.z = shift_z
        ob.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    pivot_world = (pivot_world[0], pivot_world[1], pivot_world[2] + shift_z)
    print(f"[ifv_namer] ground shift +{shift_z:.4f} m (lowest vertex -> z=0)")
    print(f"[ifv_namer] turret pivot (export frame, +X forward, metres): {tuple(round(c, 4) for c in pivot_world)}")

    pivot_obj = bpy.data.objects.new("turret_pivot", None)
    pivot_obj.empty_display_size = 0.15
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot_world
    inv = Matrix.Translation(Vector(pivot_world) * -1.0)
    for ob in (turret_obj, glass_obj):
        ob.parent = pivot_obj
        ob.matrix_parent_inverse = inv

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
            "Namer IFV hull+turret -- AI-generated (Meshy), disclosed per CONTRIBUTING.md; "
            "cut into hull_hull/hull_rubber/turret_metal/turret_glass for this repository"
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(
        f"[ifv_namer] wrote {OUT_PATH} ({size} bytes) meshes: "
        f"hull_hull={len(hull_obj.data.polygons)} hull_rubber={len(wheel_obj.data.polygons)} "
        f"turret_metal={len(turret_obj.data.polygons)} turret_glass={len(glass_obj.data.polygons)}"
    )
    return OUT_PATH


if __name__ == "__main__":
    export()
